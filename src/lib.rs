//! # uthreads — Cooperative User-Space Thread Library
//!
//! `uthreads` provides a minimal cooperative threading runtime built on top of
//! POSIX `ucontext` APIs. Threads voluntarily yield control via [`thread_yield`];
//! there is no preemption.
//!
//! ## Quick start
//!
//! ```rust,no_run
//! use uthreads::{thread_create, thread_join, thread_yield};
//!
//! let t = thread_create(|| {
//!     println!("Hello from a user-space thread!");
//!     thread_yield();
//!     println!("Back in the thread after yielding.");
//! });
//! thread_join(t);
//! ```
//!
//! ## Platform support
//! Only Unix-like targets are supported (Linux, macOS, FreeBSD …).
//! A compile-time error is emitted on non-Unix targets.

// Emit a clear error rather than cryptic linker failures on unsupported targets.
#[cfg(not(unix))]
compile_error!(
    "uthreads relies on POSIX ucontext (getcontext/makecontext/swapcontext) \
     which is not available on Windows. Build on Linux or macOS instead."
);

mod context;
mod mutex;
mod scheduler;
mod thread;

use std::cell::UnsafeCell;

use mutex::Mutex;
use scheduler::SCHEDULER;
use thread::{Tcb, ThreadState};

/// Re-export `ThreadId` so callers do not have to reach into private modules.
pub use thread::ThreadId;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Monotonically increasing counter for assigning unique mutex IDs.
fn next_mutex_id() -> usize {
    static COUNTER: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(1);
    COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
}

// ---------------------------------------------------------------------------
// Thread API
// ---------------------------------------------------------------------------

/// Spawn a new user-space thread that will execute `func`.
///
/// The thread is immediately added to the run queue in the `Ready` state but
/// will not run until the current thread yields or blocks.
///
/// Returns the [`ThreadId`] of the new thread, which can be passed to
/// [`thread_join`].
pub fn thread_create(func: impl FnOnce() + Send + 'static) -> ThreadId {
    SCHEDULER.with(|s| {
        let sched = unsafe { &mut *s.get() };
        let id = sched.next_id;
        sched.next_id += 1;
        let tcb = Box::new(Tcb::new(id, Box::new(func)));
        sched.add_thread(tcb);
        id
    })
}

/// Return the [`ThreadId`] of the currently running thread.
#[must_use]
pub fn thread_self() -> ThreadId {
    SCHEDULER.with(|s| {
        let sched = unsafe { &*s.get() };
        sched.current
    })
}

/// Voluntarily yield the CPU to the next ready thread.
///
/// The calling thread transitions to `Ready` and is re-enqueued at the back of
/// the run queue. Execution resumes here the next time the scheduler picks it.
pub fn thread_yield() {
    SCHEDULER.with(|s| {
        let sched = unsafe { &mut *s.get() };
        sched.yield_current();
    });
}

/// Block the calling thread until the thread identified by `id` has finished.
///
/// If `id` has already finished (or does not exist), this returns immediately.
/// Duplicate calls with the same `id` are idempotent — the caller is only
/// registered as a waiter once.
pub fn thread_join(id: ThreadId) {
    // Fast path: check whether the target is already done without blocking.
    let already_done = SCHEDULER.with(|s| {
        let sched = unsafe { &*s.get() };
        sched.get_thread(id)
            .is_none_or(|t| t.state == ThreadState::Finished) // Thread not found → treat as finished.
    });

    if already_done {
        return;
    }

    // Slow path: register ourselves as a waiter and yield until woken.
    SCHEDULER.with(|s| {
        let sched = unsafe { &mut *s.get() };
        let current_id = sched.current;

        if let Some(target) = sched.get_thread_mut(id) {
            if target.state == ThreadState::Finished {
                return; // Finished just before we got here — nothing to do.
            }
            // Guard against registering the same waiter twice.
            if !target.join_waiting.contains(&current_id) {
                target.join_waiting.push(current_id);
            }
        } else {
            return; // Thread not found — treat as already finished.
        }

        // Block the current thread; finish_current() will unblock it.
        if let Some(current) = sched.get_thread_mut(current_id) {
            current.state = ThreadState::Blocked;
        }
        sched.schedule();
    });
}

/// Terminate the calling thread immediately.
///
/// Equivalent to returning from the thread's entry function. Threads that
/// return normally from their closure also terminate — calling this explicitly
/// is only needed when you want to exit early from inside a nested call.
pub fn thread_exit() {
    SCHEDULER.with(|s| {
        let sched = unsafe { &mut *s.get() };
        sched.finish_current();
    });
}

// ---------------------------------------------------------------------------
// Mutex API
// ---------------------------------------------------------------------------

/// Opaque handle to a cooperative user-space mutex.
///
/// Create one with [`mutex_new`] and operate on it with [`mutex_lock`] /
/// [`mutex_unlock`]. Designed to be wrapped in `Arc` for sharing across threads:
///
/// ```rust,no_run
/// use std::sync::Arc;
/// use uthreads::{mutex_new, mutex_lock, mutex_unlock};
///
/// let mtx = Arc::new(mutex_new());
/// mutex_lock(&mtx);
/// // … critical section …
/// mutex_unlock(&mtx);
/// ```
///
/// > **Note:** `MutexHandle` is tied to the OS thread that created it via
/// > `THREAD_MUTEXES` (a thread-local table). Passing a handle to a *different*
/// > OS thread (not just a different user-space thread) will silently produce
/// > no-ops. Wrap it in `Arc` only for sharing between user-space threads on
/// > the same OS thread.
pub struct MutexHandle(usize);

/// Create a new, unlocked cooperative mutex.
///
/// The returned handle must be used — dropping it immediately leaks the mutex
/// entry in the per-thread table.
#[must_use]
pub fn mutex_new() -> MutexHandle {
    let id = next_mutex_id();
    THREAD_MUTEXES.with(|m| {
        let map = unsafe { &mut *m.get() };
        map.push((id, Mutex::new()));
    });
    MutexHandle(id)
}

/// Acquire the mutex identified by `handle`.
///
/// If the mutex is currently held by another thread, the calling thread is
/// added to the mutex's wait queue, blocked, and will be woken (and granted the
/// lock) by [`mutex_unlock`] when the current owner releases it.
///
/// The lock is **not** recursive — a thread that calls `mutex_lock` while
/// already holding the same mutex will deadlock.
pub fn mutex_lock(handle: &MutexHandle) {
    let mid = handle.0;
    loop {
        let acquired = THREAD_MUTEXES.with(|m| {
            let map = unsafe { &mut *m.get() };
            if let Some((_, mtx)) = map.iter_mut().find(|(id, _)| *id == mid) {
                let current = SCHEDULER.with(|s| unsafe { (*s.get()).current });
                if !mtx.locked {
                    // Mutex is free — acquire it.
                    mtx.locked = true;
                    mtx.owner = Some(current);
                    true
                } else if mtx.owner == Some(current) {
                    // This thread was handed the lock directly by mutex_unlock
                    // (owner is set before unblock). We resume from block_current()
                    // and loop back here — detect this to break out immediately.
                    true
                } else {
                    // Mutex is held by someone else — enqueue and block.
                    // Guard against duplicates in the wait queue.
                    if !mtx.wait_queue.contains(&current) {
                        mtx.wait_queue.push_back(current);
                    }
                    false
                }
            } else {
                false
            }
        });

        if acquired {
            break;
        }

        // Block until mutex_unlock calls sched.unblock() for this thread.
        SCHEDULER.with(|s| {
            let sched = unsafe { &mut *s.get() };
            sched.block_current();
        });
    }
}

/// Release the mutex identified by `handle`.
///
/// If there are threads waiting in the mutex's queue the lock is handed
/// directly to the front of the queue and that thread is unblocked; otherwise
/// the mutex is left unlocked. The scheduler is invoked to give the newly
/// unblocked thread a chance to run immediately.
pub fn mutex_unlock(handle: &MutexHandle) {
    let mid = handle.0;
    let waiter = THREAD_MUTEXES.with(|m| {
        let map = unsafe { &mut *m.get() };
        if let Some((_, mtx)) = map.iter_mut().find(|(id, _)| *id == mid) {
            mtx.locked = false;
            mtx.owner = None;
            if let Some(next) = mtx.wait_queue.pop_front() {
                // Hand the lock directly to the next waiter (no unlock window).
                mtx.locked = true;
                mtx.owner = Some(next);
                Some(next)
            } else {
                None
            }
        } else {
            None
        }
    });

    // Unblock the new owner and yield so it gets CPU time immediately.
    // Using yield_current() (not schedule()) is critical: it first transitions
    // the *current* thread from Running → Ready and re-enqueues it, then calls
    // schedule(). This ensures the unlocking thread is still runnable after the
    // newly-unblocked waiter finishes, preventing a false deadlock detection.
    if let Some(wid) = waiter {
        SCHEDULER.with(|s| {
            let sched = unsafe { &mut *s.get() };
            sched.unblock(wid);
            sched.yield_current();
        });
    }
}

// ---------------------------------------------------------------------------
// Thread-local storage
// ---------------------------------------------------------------------------

// Per-OS-thread table of all cooperative mutexes created on this thread.
// Keyed by a monotonically increasing `usize` ID generated by `next_mutex_id`.
// `UnsafeCell` is safe here for the same reason as `SCHEDULER` — the
// cooperative runtime is single-threaded on each OS thread.
thread_local! {
    static THREAD_MUTEXES: UnsafeCell<Vec<(usize, Mutex)>> = const { UnsafeCell::new(Vec::new()) };
}