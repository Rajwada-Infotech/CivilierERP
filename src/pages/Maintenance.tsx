import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { getMaintenanceStatus, type MaintenanceState } from "@/api/maintenanceModeApi";
import { MAINTENANCE_STORAGE_KEY, readStoredMaintenance } from "@/lib/maintenanceRedirect";
import { formatCountdown, formatIst, maintenanceProgress } from "@/lib/maintenanceTime";

const POLL_MS = 10_000;
const DEFAULT_TITLE = "We're upgrading CivilierERP";
const DEFAULT_MESSAGE = "The system is offline for a short while so we can make it better. Everything you saved is safe.";

/**
 * Where everyone but a super admin lands while maintenance is on (Admin > System Maintenance). It shows the
 * message and the expected end, counts down, and sends people back in by itself the moment maintenance is over.
 */
const Maintenance = () => {
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
        window.location.replace("/");
        return;
      }
      setState(next);
    } catch {
      setUnreachable(true);
    } finally {
      setChecking(false);
    }
  }, []);

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

  return (
    <main className="relative flex min-h-screen flex-col bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at 30% 40%, black, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at 30% 40%, black, transparent 70%)",
        }}
      />

      <header className="relative z-10 px-6 py-6 sm:px-10">
        <span className="font-heading text-lg font-semibold tracking-tight">CivilierERP</span>
      </header>

      <section className="relative z-10 flex flex-1 items-center px-6 pb-16 sm:px-10">
        <div className="w-full max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-amber-700 dark:text-amber-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-60 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            Scheduled maintenance
          </p>

          <h1 className="mt-5 text-balance font-heading text-3xl font-semibold leading-tight sm:text-4xl">
            {state?.title || DEFAULT_TITLE}
          </h1>
          <p className="mt-4 max-w-prose text-base leading-relaxed text-muted-foreground">
            {state?.message || DEFAULT_MESSAGE}
          </p>

          <div className="mt-8 rounded-xl border border-border bg-card/70 p-5">
            {endsAtMs !== null && state?.endsAt ? (
              <>
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {overrun ? "Planned for" : "Expected back"}
                    </p>
                    <p className="mt-1 font-heading text-lg font-medium">{formatIst(state.endsAt)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {overrun ? "Status" : "Time left"}
                    </p>
                    <p className="mt-1 font-heading text-2xl font-semibold tabular-nums" aria-live="off">
                      {overrun ? "Almost there" : formatCountdown(remaining as number)}
                    </p>
                  </div>
                </div>

                <div
                  className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label="Maintenance progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={overrun ? 100 : Math.round((progress ?? 0) * 100)}
                >
                  <div
                    className={`h-full rounded-full bg-primary transition-[width] duration-1000 ease-linear ${
                      overrun ? "motion-safe:animate-pulse" : ""
                    }`}
                    style={{ width: `${overrun ? 100 : Math.round((progress ?? 0) * 100)}%` }}
                  />
                </div>
                {overrun && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    This is taking a little longer than planned. You will be let back in automatically as soon as it is done.
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Loader2 size={18} className="shrink-0 text-primary motion-safe:animate-spin" />
                <div>
                  <p className="font-heading font-medium">We'll be back shortly</p>
                  <p className="text-sm text-muted-foreground">No end time has been set. You will be let back in automatically.</p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <button
              type="button"
              onClick={() => void check()}
              disabled={checking}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw size={15} className={checking ? "motion-safe:animate-spin" : ""} />
              Check now
            </button>
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              <ShieldCheck size={14} /> Administrator sign in
            </Link>
          </div>

          <p className="mt-6 text-xs text-muted-foreground" role="status">
            {unreachable
              ? "Can't reach the server right now - trying again every few seconds."
              : lastChecked
                ? `Checking automatically every ${POLL_MS / 1000} seconds - last checked ${new Date(lastChecked).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true })}`
                : "Checking the system status..."}
          </p>
        </div>
      </section>
    </main>
  );
};

export default Maintenance;
