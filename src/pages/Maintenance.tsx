import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { getMaintenanceStatus, type MaintenanceState } from "@/api/maintenanceModeApi";
import { MAINTENANCE_STORAGE_KEY, readStoredMaintenance } from "@/lib/maintenanceRedirect";
import { formatCountdown, formatIst, maintenanceProgress } from "@/lib/maintenanceTime";

const POLL_MS = 10_000;
const DEFAULT_TITLE = "We're upgrading CivilierERP";
const DEFAULT_MESSAGE = "The system is offline for a short while so we can make it better. Everything you saved is safe.";

// This screen takes over the whole window, so it carries its own solid dark palette instead of the app theme's
// tokens (which are translucent or light in some themes and let the page underneath show through).
const PALETTE = {
  "--mt-bg": "#0d0a1b",
  "--mt-surface": "#171230",
  "--mt-border": "#2e2750",
  "--mt-fg": "#f5f3ff",
  "--mt-muted": "#a29bc4",
  "--mt-accent": "#8b5cf6",
} as CSSProperties;

// Gentle motion: things rise in one after another, the glow drifts, the grid pans slowly and a soft highlight
// slides along the progress bar. All of it stops for people who ask their device for reduced motion.
const MOTION_CSS = `
@keyframes mt-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes mt-drift { 0%, 100% { transform: translate3d(0, 0, 0) scale(1); } 50% { transform: translate3d(2.5%, 3%, 0) scale(1.06); } }
@keyframes mt-pan { from { background-position: 0 0; } to { background-position: 48px 48px; } }
@keyframes mt-sheen { from { transform: translateX(-120%); } to { transform: translateX(320%); } }
.mt-rise { opacity: 0; animation: mt-rise 700ms cubic-bezier(0.22, 1, 0.36, 1) var(--d, 0ms) forwards; }
.mt-glow { animation: mt-drift 22s ease-in-out infinite; }
.mt-grid { animation: mt-pan 40s linear infinite; }
.mt-bar::after { content: ""; position: absolute; inset: 0; width: 40%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent); animation: mt-sheen 2.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .mt-rise { opacity: 1; animation: none; }
  .mt-glow, .mt-grid, .mt-bar::after { animation: none; }
}
`;

/**
 * Where everyone but a super admin lands while maintenance is on (Admin > System Maintenance). It shows the
 * message and the expected end, counts down, and sends people back in by itself the moment maintenance is over.
 */
interface OverlayProps {
  /** Maintenance is over: take the screen away without reloading the app. */
  onOver: () => void;
  /** The "Administrator sign in" button, which lets the overlay step aside on the login page. */
  onAdminSignIn: () => void;
}

const Maintenance = ({ overlay }: { overlay?: OverlayProps }) => {
  const [state, setState] = useState<MaintenanceState | null>(() => readStoredMaintenance());
  const [now, setNow] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const next = await getMaintenanceStatus();
      setUnreachable(false);
      setLastChecked(Date.now());
      if (!next.active) {
        try {
          sessionStorage.removeItem(MAINTENANCE_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        if (overlay) overlay.onOver();
        else window.location.replace("/");
        return;
      }
      setState(next);
    } catch {
      setUnreachable(true);
    } finally {
      setChecking(false);
    }
  }, [overlay]);

  useEffect(() => {
    void check();
    const poll = setInterval(() => void check(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [check]);

  const endsAtMs = state?.endsAt ? new Date(state.endsAt).getTime() : null;
  const remaining = endsAtMs === null ? null : endsAtMs - now;
  const overrun = remaining !== null && remaining <= 0;
  const progress = state ? maintenanceProgress(state.startedAt, state.endsAt, now) : null;

  // Plain divs on purpose: the app's themes restyle <header>, <main> and <section> elements globally (frosted
  // glass, greyscale), which turned this screen's top bar white.
  return (
    <div
      role="main"
      style={PALETTE}
      className={`mt-root flex min-h-screen flex-col bg-[var(--mt-bg)] text-[var(--mt-fg)] ${
        overlay ? "fixed inset-0 z-[9999] overflow-y-auto" : "relative"
      }`}
    >
      <style>{MOTION_CSS}</style>
      <div
        aria-hidden
        className="mt-glow pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 38rem at 12% 8%, rgba(139,92,246,0.22), transparent 60%), radial-gradient(44rem 30rem at 95% 100%, rgba(59,130,246,0.14), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="mt-grid pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at 30% 40%, black, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at 30% 40%, black, transparent 70%)",
        }}
      />

      <div className="mt-rise relative z-10 px-6 py-6 sm:px-10" style={{ "--d": "0ms" } as CSSProperties}>
        <span className="font-heading text-lg font-semibold tracking-tight">CivilierERP</span>
      </div>

      <div className="relative z-10 flex flex-1 items-center px-6 pb-16 sm:px-10">
        <div className="w-full max-w-xl">
          <p
            className="mt-rise inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-amber-300"
            style={{ "--d": "80ms" } as CSSProperties}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            Scheduled maintenance
          </p>

          <h1
            className="mt-rise mt-5 text-balance font-heading text-3xl font-semibold leading-tight text-[var(--mt-fg)] sm:text-4xl"
            style={{ "--d": "160ms" } as CSSProperties}
          >
            {state?.title || DEFAULT_TITLE}
          </h1>
          <p
            className="mt-rise mt-4 max-w-prose text-base leading-relaxed text-[var(--mt-muted)]"
            style={{ "--d": "240ms" } as CSSProperties}
          >
            {state?.message || DEFAULT_MESSAGE}
          </p>

          <div
            className="mt-rise mt-8 rounded-xl border border-[var(--mt-border)] bg-[var(--mt-surface)] p-5 shadow-[0_8px_30px_rgba(0,0,0,0.35)]"
            style={{ "--d": "320ms" } as CSSProperties}
          >
            {endsAtMs !== null && state?.endsAt ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-[var(--mt-muted)]">
                      {overrun ? "Planned for" : "Expected back"}
                    </p>
                    <p className="mt-1 font-heading text-lg font-medium text-[var(--mt-fg)]">{formatIst(state.endsAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium uppercase tracking-wider text-[var(--mt-muted)]">
                      {overrun ? "Status" : "Time left"}
                    </p>
                    <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-[var(--mt-fg)]" aria-live="off">
                      {overrun ? "Almost there" : formatCountdown(remaining as number)}
                    </p>
                  </div>
                </div>

                <div
                  className="mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--mt-border)]"
                  role="progressbar"
                  aria-label="Maintenance progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={overrun ? 100 : Math.round((progress ?? 0) * 100)}
                >
                  <div
                    className={`mt-bar relative h-full overflow-hidden rounded-full bg-[var(--mt-accent)] transition-[width] duration-1000 ease-linear ${
                      overrun ? "motion-safe:animate-pulse" : ""
                    }`}
                    style={{ width: `${overrun ? 100 : Math.round((progress ?? 0) * 100)}%` }}
                  />
                </div>
                {overrun && (
                  <p className="mt-3 text-sm text-[var(--mt-muted)]">
                    This is taking a little longer than planned. You will be let back in automatically as soon as it is done.
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Loader2 size={18} className="shrink-0 text-[var(--mt-accent)] motion-safe:animate-spin" />
                <div>
                  <p className="font-heading font-medium text-[var(--mt-fg)]">We'll be back shortly</p>
                  <p className="text-sm text-[var(--mt-muted)]">No end time has been set. You will be let back in automatically.</p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-rise mt-6 flex flex-wrap items-center gap-x-5 gap-y-3" style={{ "--d": "400ms" } as CSSProperties}>
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--mt-accent)] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw size={15} className={checking ? "motion-safe:animate-spin" : ""} />
              Check now
            </button>
            {overlay ? (
              <button
                type="button"
                onClick={overlay.onAdminSignIn}
                className="inline-flex items-center gap-1.5 text-sm text-[var(--mt-muted)] underline-offset-4 hover:text-[var(--mt-fg)] hover:underline"
              >
                <ShieldCheck size={14} /> Administrator sign in
              </button>
            ) : (
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--mt-muted)] underline-offset-4 hover:text-[var(--mt-fg)] hover:underline"
              >
                <ShieldCheck size={14} /> Administrator sign in
              </Link>
            )}
          </div>

          <p className="mt-rise mt-6 text-xs text-[var(--mt-muted)]" role="status" style={{ "--d": "480ms" } as CSSProperties}>
            {unreachable
              ? "Can't reach the server right now - trying again every few seconds."
              : lastChecked
                ? `Checking automatically every ${POLL_MS / 1000} seconds - last checked ${new Date(lastChecked).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}`
                : "Checking the system status..."}
          </p>
        </div>
      </div>
    </div>
  );
};

export default Maintenance;
