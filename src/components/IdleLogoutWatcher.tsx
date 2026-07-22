import { useCallback } from "react";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useGracefulLogout } from "@/hooks/useGracefulLogout";
import { useIdleLogout } from "@/hooks/useIdleLogout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Mirrors COUNTDOWN_SECONDS in useIdleLogout.ts — only used here to size the
// countdown ring's fill, not to drive the timer itself.
const COUNTDOWN_TOTAL = 60;
const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

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

  const progress = secondsLeft != null ? secondsLeft / COUNTDOWN_TOTAL : 1;
  const ringOffset = RING_CIRCUMFERENCE * (1 - progress);

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
        <AlertDialogContent className="max-w-sm gap-0 overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-card to-amber-500/[0.04] p-0 shadow-2xl">
          <div className="flex items-start gap-4 p-5 pb-4">
            {/* Countdown ring — depletes in sync with the number below,
                giving an at-a-glance read on urgency without reading text. */}
            <div className="relative shrink-0">
              <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
                <circle
                  cx="24"
                  cy="24"
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="text-amber-500/15"
                />
                <circle
                  cx="24"
                  cy="24"
                  r={RING_RADIUS}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={ringOffset}
                  className="text-amber-500 transition-[stroke-dashoffset] duration-1000 ease-linear"
                />
              </svg>
              <Clock className="absolute inset-0 m-auto h-5 w-5 text-amber-500" />
            </div>

            <div className="min-w-0 pt-0.5">
              <AlertDialogTitle className="text-base font-semibold text-foreground">
                Are you still there?
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-1 text-sm leading-relaxed text-muted-foreground">
                You've been inactive for a while. For your security, you'll
                be signed out in{" "}
                <span className="font-semibold tabular-nums text-amber-500">
                  {secondsLeft}s
                </span>{" "}
                unless you stay active.
              </AlertDialogDescription>
            </div>
          </div>

          {/* Depleting bar — same countdown, restated as a full-width cue
              that's still visible even if the ring goes unnoticed. */}
          <div className="h-1 w-full bg-amber-500/10">
            <div
              className="h-full bg-amber-500 transition-[width] duration-1000 ease-linear"
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          <div className="p-4">
            <AlertDialogAction
              onClick={resetTimer}
              className="w-full bg-gradient-to-r from-indigo-500 to-violet-500 font-semibold text-white hover:from-indigo-600 hover:to-violet-600"
            >
              Stay signed in
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
