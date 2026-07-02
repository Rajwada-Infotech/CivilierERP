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
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

  return (
    <>
      {overlay}
      <AlertDialog open={showWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              <AlertDialogTitle>Are you still there?</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              You've been inactive for a while. For your security, you'll be
              signed out in{" "}
              <span className="font-semibold text-foreground">
                {secondsLeft}
              </span>{" "}
              second{secondsLeft === 1 ? "" : "s"} unless you stay active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={resetTimer}>
              Stay signed in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
