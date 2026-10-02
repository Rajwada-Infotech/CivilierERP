import * as React from "react";
import { createPortal } from "react-dom";

// Renders full-screen overlays (modals, drawers, backdrops) directly under
// <body>. Page wrappers use their own stacking contexts (relative z-10,
// backdrop-filter, transforms), which otherwise trap a `fixed inset-0`
// overlay beneath the top navbar and sidebars.
export function BodyPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}
