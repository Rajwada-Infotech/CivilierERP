import { useCallback } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { COUNTDOWN_SECONDS, useIdleLogout } from "@/hooks/useIdleLogout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** One big thin-numeral block ("00" over "Minutes") framed by hairline corner ticks. */
function Digits({ value, label }: { value: number; label: string }) {
  return (
    <div className="relative px-5 pt-4 pb-3">
      <span className="absolute left-0 top-0 h-3 w-3 border-l border-t border-white/40" />
      <span className="absolute right-0 top-0 h-3 w-3 border-r border-t border-white/40" />
      <span className="absolute left-0 bottom-0 h-3 w-3 border-l border-b border-white/40" />
      <span className="absolute right-0 bottom-0 h-3 w-3 border-r border-b border-white/40" />
      <p className="font-sans text-[5.5rem] sm:text-[7rem] font-extralight leading-none tracking-tight tabular-nums text-white">
        {String(value).padStart(2, "0")}
      </p>
      <p className="mt-2 text-[0.625rem] uppercase tracking-[0.3em] text-white/50">{label}</p>
    </div>
  );
}

/**
 * Global inactivity watcher. Mounted once inside AppLayout, so it's alive on
 * every authenticated page but never on /login.
 *
 * Behavior: after WARNING_AFTER_MS (useIdleLogout.ts) of no mouse/keyboard/
 * scroll/touch activity, shows a countdown dialog. If the user doesn't
 * respond (click "Stay signed in" or interact with the page) before the
 * countdown reaches zero, they're logged out automatically — same graceful
 * logout flow (and fade-out overlay) as the manual Logout button uses.
 *
 * Cross-tab aware: activity in any tab of this app resets the idle clock for
 * all of them, so having a second idle tab open doesn't log an actively-used
 * tab out from under the user.
 */
export function IdleLogoutWatcher() {
  const { currentUser } = useAuth();
  const { handleLogout, overlay } = useGracefulLogout();

  const handleTimeout = useCallback(() => {
    toast.error("You were signed out due to inactivity.");
    handleLogout();
  }, [handleLogout]);

  const { secondsLeft, resetTimer } = useIdleLogout(
    !!currentUser,
    handleTimeout,
  );

  const showWarning = secondsLeft !== null && secondsLeft > 0;

  if (!currentUser) return null;

  const left = secondsLeft ?? COUNTDOWN_SECONDS;
  const progress = left / COUNTDOWN_SECONDS;

  return (
    <>
      {overlay}
      <AlertDialog
        open={showWarning}
        onOpenChange={(open) => {
          // Radix may attempt to close the dialog through paths other than
          // our own button (e.g. focus/interaction edge cases inside the
          // primitive) — route any such attempt through the same resetTimer
          // used by the explicit "Stay signed in" click, so the underlying
          // idle clock and the visible dialog state can never disagree.
          if (!open) resetTimer();
        }}
      >
        <AlertDialogContent className="!fixed !inset-0 !left-0 !top-0 !translate-x-0 !translate-y-0 !max-w-none !w-screen !h-screen !rounded-none border-0 p-0 bg-transparent shadow-none flex items-center justify-center">
          {/* Dark stage: near-black radial vignette, a faint grid and a floor glow. */}
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 40%, #2a2c30 0%, #141517 55%, #08090a 100%)" }} />
          <div
            className="absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
              backgroundSize: "80px 80px",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ background: "radial-gradient(ellipse at 50% 100%, rgba(255,255,255,0.10), transparent 70%)" }} />

          <div className="relative flex flex-col items-center px-4 text-center">
            <AlertDialogTitle className="mb-6 text-[0.6875rem] font-medium uppercase tracking-[0.4em] text-white/60">
              Session idle · signing out
            </AlertDialogTitle>

            <div className="flex items-end gap-4 sm:gap-8">
              <Digits value={Math.floor(left / 60)} label="Minutes" />
              <Digits value={left % 60} label="Seconds" />
            </div>

            {/* hairline progress — drains with the countdown */}
            <div className="mt-8 h-px w-64 sm:w-80 bg-white/15">
              <div className="h-full bg-white/80 transition-[width] duration-1000 ease-linear" style={{ width: `${progress * 100}%` }} />
            </div>

            <AlertDialogDescription className="mt-5 max-w-xs text-xs leading-relaxed text-white/55">
              No activity for a while. For your security you'll be signed out when the timer reaches zero.
            </AlertDialogDescription>

            <AlertDialogAction
              onClick={resetTimer}
              className="mt-6 rounded-none border border-white/40 bg-transparent px-8 text-[0.6875rem] font-semibold uppercase tracking-[0.3em] text-white hover:bg-white hover:text-black"
            >
              Stay signed in
            </AlertDialogAction>

            <p className="mt-10 text-[0.625rem] font-bold uppercase tracking-[0.35em] text-white/70">CivilierERP</p>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
