import { useEffect, useRef } from "react";

// Full-screen overlays (modals, lightboxes) rendered via a portal don't
// exist as a route, so the browser/hardware "back" action falls straight
// through to real navigation — the overlay was still open, but back took
// you off the page entirely (e.g. from a photo lightbox opened on
// Reporting all the way back to Work Allocation). This makes one "back"
// press close the top-most open overlay instead, by pushing a throwaway
// history entry per overlay and popping it on close.
//
// A module-level stack (not per-hook-instance) so nested overlays (a
// lightbox opened from inside a modal) each consume exactly one back
// press — the browser fires a single global `popstate` for any back
// action, so only the outermost listener should ever act on it.
let stack: Array<() => void> = [];
let listenerAttached = false;
// Calling history.back() ourselves (to consume our own pushed entry when
// the overlay closes via its own UI, not via back) fires its own
// asynchronous popstate — without this guard that event would be
// misread as a real back press and wrongly close whatever overlay is
// still on top of the stack.
let suppressNext = 0;

function ensureListener() {
  if (listenerAttached) return;
  listenerAttached = true;
  window.addEventListener("popstate", () => {
    if (suppressNext > 0) {
      suppressNext -= 1;
      return;
    }
    const top = stack[stack.length - 1];
    if (top) {
      stack = stack.slice(0, -1);
      top();
    }
  });
}

export function useOverlayBackClose(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    ensureListener();
    const handler = () => onCloseRef.current();
    stack.push(handler);
    window.history.pushState({ __overlay: stack.length }, "");

    return () => {
      const idx = stack.lastIndexOf(handler);
      if (idx !== -1) {
        // Still in the stack at unmount time — this overlay was closed via
        // its own Close/X button (or an unrelated unmount), not by a back
        // press that already popped it. Remove ourselves and consume the
        // history entry we pushed so a later back doesn't land on a dead
        // state that just re-closes something already closed.
        stack.splice(idx, 1);
        suppressNext += 1;
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
