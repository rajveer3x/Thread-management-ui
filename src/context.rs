//! # Context Module
//!
//! Low-level POSIX `ucontext`-based cooperative context switching.
//!
//! `ucontext_t`, `getcontext`, `makecontext`, and `swapcontext` are POSIX APIs
//! that are **not** available on Windows. This library therefore only compiles
//! on Unix-like targets (Linux, macOS, FreeBSD …). A `cfg` guard at the crate
//! root enforces this at compile time.

use libc::{getcontext, makecontext, swapcontext, ucontext_t};
use std::mem;

/// Default stack size allocated for each user-space thread (1 MiB).
pub const STACK_SIZE: usize = 1024 * 1024;

/// Thin wrapper around a POSIX `ucontext_t`.
///
/// Storing the raw `ucontext_t` in a `repr(C)` struct lets us safely
/// take raw pointers to it for `swapcontext` calls.
#[repr(C)]
pub struct Context {
    pub uctx: ucontext_t,
}

impl Context {
    /// Create a blank context by calling `getcontext` on a zeroed `ucontext_t`.
    ///
    /// The resulting context is not yet executable — it must be configured via
    /// [`make_context`] before it can be switched into.
    pub fn new() -> Self {
        unsafe {
            let mut uctx: ucontext_t = mem::zeroed();
            getcontext(&raw mut uctx);
            Self { uctx }
        }
    }
}

/// Configure `ctx` so that when it is first switched into it will call `func`.
///
/// `link` is the context to restore when `func` returns. Pass a pointer to the
/// main thread's context so that an accidental return from `func` falls through
/// to the scheduler rather than calling `exit()` on the whole process (which
/// is what `uc_link = NULL` would do).
///
/// # Safety
/// - `stack_ptr` must be 16-byte aligned and point to a valid allocation of at
///   least `stack_len` bytes.
/// - The memory backing the stack must remain valid (i.e. the owning `Vec` must
///   not be dropped or reallocated) for the entire lifetime of this context.
/// - `link`, if non-null, must point to a valid `ucontext_t` for the entire
///   lifetime of this context.
pub unsafe fn make_context(
    ctx: &mut Context,
    stack_ptr: *mut u8,
    stack_len: usize,
    func: extern "C" fn(),
    link: *mut ucontext_t,
) {
    // Capture the current machine state into ctx so that the OS-level fields
    // (signal mask, etc.) are populated before we override the stack/link.
    getcontext(&raw mut ctx.uctx);
    ctx.uctx.uc_stack.ss_sp = stack_ptr.cast::<libc::c_void>();
    ctx.uctx.uc_stack.ss_size = stack_len;
    // `uc_link` is set to the caller-supplied context (normally the main
    // thread's context). This ensures that if `func` ever returns without
    // going through `finish_current()`, execution falls back to the scheduler
    // rather than terminating the entire process (which NULL would do).
    ctx.uctx.uc_link = link;
    makecontext(&raw mut ctx.uctx, func, 0);
}

/// Suspend `from` and resume `to`.
///
/// Execution of `from` will continue from this call site the next time
/// `to` calls `swap_context` back (or `from` is directly swapped into).
///
/// # Safety
/// `from` and `to` must be **distinct** (non-aliased) contexts.
pub unsafe fn swap_context(from: &mut Context, to: &mut Context) {
    swapcontext(&raw mut from.uctx, &raw const to.uctx);
}