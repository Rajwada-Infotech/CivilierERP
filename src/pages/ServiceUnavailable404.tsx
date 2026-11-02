import type { CSSProperties } from "react";
import { Link } from "react-router-dom";

const DEFAULT_TITLE = "Page not found";
const DEFAULT_MESSAGE = "The page you are looking for is not available right now.";

// Like the Maintenance screen, this takes over the whole window and carries its own solid palette instead of the
// app theme's tokens, which are translucent in some themes and would let the app underneath show through.
const PALETTE = {
  "--nf-bg": "#f4f5f7",
  "--nf-fg": "#15171c",
  "--nf-muted": "#6b7280",
  "--nf-rule": "#cfd3da",
} as CSSProperties;

interface Props {
  title?: string | null;
  message?: string | null;
  /** Covers the running app (fixed, above everything) instead of being a page of its own. */
  overlay?: { onAdminSignIn: () => void };
}

/**
 * What everyone but a super admin sees while System Maintenance is switched to "404 page" (Admin > System
 * Maintenance), e.g. while the cloud bill is unpaid. It looks like any dead link - no countdown, no promise of
 * when it comes back; Maintenance.tsx keeps polling underneath and lets people back in the moment it is switched off.
 */
const ServiceUnavailable404 = ({ title, message, overlay }: Props) => (
  <div
    role="main"
    style={PALETTE}
    className={`flex min-h-screen flex-col bg-[var(--nf-bg)] text-[var(--nf-fg)] ${overlay ? "fixed inset-0 z-[9999] overflow-y-auto" : "relative"}`}
  >
    <div className="flex flex-1 items-center px-6 sm:px-12">
      <div className="w-full max-w-lg">
        <p className="font-heading text-[7rem] font-bold leading-none tracking-tighter tabular-nums sm:text-[10rem]">404</p>
        <div className="my-6 h-px w-24 bg-[var(--nf-rule)]" />
        <h1 className="text-balance font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{title || DEFAULT_TITLE}</h1>
        <p className="mt-3 max-w-prose text-base leading-relaxed text-[var(--nf-muted)]">{message || DEFAULT_MESSAGE}</p>
      </div>
    </div>
    <div className="flex items-center justify-between px-6 py-5 text-xs text-[var(--nf-muted)] sm:px-12">
      <span>CivilierERP</span>
      {overlay ? (
        <button type="button" onClick={overlay.onAdminSignIn} className="underline-offset-4 hover:text-[var(--nf-fg)] hover:underline">
          Administrator sign in
        </button>
      ) : (
        <Link to="/login" className="underline-offset-4 hover:text-[var(--nf-fg)] hover:underline">
          Administrator sign in
        </Link>
      )}
    </div>
  </div>
);

export default ServiceUnavailable404;
