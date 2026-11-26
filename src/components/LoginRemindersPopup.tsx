import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ShoppingCart, HardHat, FileWarning, Package, Lock, ClipboardList, Landmark } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useReminders, formatRelative, formatDate } from "@/hooks/useReminders";
import { BodyPortal } from "@/components/ui/body-portal";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_LINE } from "@/components/sheet/sheetParts";

// What each reminder is about, as a small graphite icon (the sheet has no colour per module or type).
const TYPE_ICON: Record<string, React.ElementType> = {
  purchase_order: ShoppingCart,
  work_order: HardHat,
  tds: FileWarning,
  grn: Package,
  emi_installment: Lock,
  material_request: ClipboardList,
  pdc: Landmark,
};

const JUST_LOGGED_IN_KEY = "__just_logged_in";

/**
 * Shows the same reminders the bell surfaces, once, right after a fresh
 * login — filtered to whatever the user's page rights already scope
 * useReminders() to (see hasReminderAccess in useReminders.ts). Consumes a
 * one-shot sessionStorage flag set by AuthContext.login(), so it doesn't
 * reappear on every route change or page refresh within the same session,
 * and only every re-shows after the next actual login.
 *
 * Mounted once in AppLayout, alongside IdleLogoutWatcher — same "global,
 * session-scoped" convention.
 */
export function LoginRemindersPopup() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [armed, setArmed] = useState(false);

  // Consume the one-shot flag on mount — regardless of whether we end up
  // showing anything, it must not survive to the next route change.
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.showLoginReminders === false) return;
    if (sessionStorage.getItem(JUST_LOGGED_IN_KEY) !== "1") return;
    sessionStorage.removeItem(JUST_LOGGED_IN_KEY);
    setArmed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const { reminders, loading } = useReminders({ pollingInterval: 0 });
  const [dismissed, setDismissed] = useState(false);

  if (!armed || dismissed || !currentUser) return null;
  // Wait for the first fetch before deciding whether there's anything to
  // show — popping an empty dialog for a beat looks broken.
  if (loading && reminders.length === 0) return null;
  if (reminders.length === 0) return null;

  return (
    <BodyPortal>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) setDismissed(true);
        }}
      >
        <div className="sheet-frame w-full max-w-md bg-card border border-foreground rounded-none overflow-hidden" role="dialog" aria-label="Pending alerts">
          <div className="px-5 py-4 border-b border-foreground/20 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">CivilierERP · Alerts</p>
              <p className="mt-1 font-heading text-[0.8125rem] font-bold uppercase tracking-[0.1em] text-foreground truncate">
                Welcome back, {currentUser.name?.split(" ")[0]}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
                <span className="font-heading tabular-nums text-destructive">{reminders.length}</span> pending alert{reminders.length === 1 ? "" : "s"} need
                {reminders.length === 1 ? "s" : ""} your attention
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Close"
              className="w-7 h-7 -mr-1 inline-flex items-center justify-center border border-transparent text-muted-foreground hover:border-foreground hover:text-foreground transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>

          <div className="max-h-[50vh] overflow-y-auto">
            {reminders.slice(0, 8).map((r, i) => {
              const Icon = TYPE_ICON[r.type] ?? Package;
              const overdue = r.urgency === "overdue";
              return (
                <button
                  type="button"
                  key={r.id}
                  onClick={() => {
                    setDismissed(true);
                    navigate(r.path);
                  }}
                  className={`group w-full text-left flex gap-3 px-5 py-3 hover:bg-primary/5 transition-colors ${i ? "border-t border-foreground/15" : ""}`}
                >
                  <Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 min-w-0">
                    <span className="flex justify-between gap-2 items-baseline">
                      <span className="truncate font-semibold text-[0.75rem] text-foreground group-hover:underline underline-offset-2">{r.title}</span>
                      {r.amount ? (
                        <span className="font-heading tabular-nums text-[0.75rem] font-semibold text-foreground shrink-0">₹{r.amount.toLocaleString("en-IN")}</span>
                      ) : null}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground truncate mt-0.5">{r.subtitle}</span>
                    <span className="mt-1.5 flex gap-2 items-center flex-wrap">
                      <SheetMark text={formatRelative(r.dueDate)} tone={overdue ? "stopped" : "waiting"} />
                      <span className="font-heading tabular-nums text-[0.625rem] text-muted-foreground">{formatDate(r.dueDate)}</span>
                    </span>
                  </span>
                </button>
              );
            })}
            {reminders.length > 8 && (
              <p className="border-t border-foreground/15 px-5 py-2.5 text-[0.6875rem] text-muted-foreground">
                <span className="font-heading tabular-nums">+{reminders.length - 8}</span> more — open the bell to see them all
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-t border-foreground/20 flex justify-end">
            <button type="button" onClick={() => setDismissed(true)} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </BodyPortal>
  );
}

export default LoginRemindersPopup;
