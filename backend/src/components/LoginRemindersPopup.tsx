import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Notification } from "iconsax-react";
import {
  X,
  ShoppingCart,
  HardHat,
  FileWarning,
  Package,
  Lock,
  ClipboardList,
  Landmark,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useReminders, formatRelative, formatDate } from "@/hooks/useReminders";

type ReminderMeta = { icon: React.ElementType; color: string };

const TYPE_META: Record<string, ReminderMeta> = {
  purchase_order: { icon: ShoppingCart, color: "text-violet-500" },
  work_order: { icon: HardHat, color: "text-orange-500" },
  tds: { icon: FileWarning, color: "text-rose-500" },
  grn: { icon: Package, color: "text-emerald-500" },
  emi_installment: { icon: Lock, color: "text-purple-500" },
  material_request: { icon: ClipboardList, color: "text-blue-500" },
  pdc: { icon: Landmark, color: "text-sky-500" },
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
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setDismissed(true);
      }}
    >
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="relative px-5 py-4 border-b border-border bg-gradient-to-br from-amber-500/10 via-card to-card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg border border-amber-500/30 bg-amber-500/10 flex items-center justify-center shrink-0">
                <Notification size={15} variant="Bold" color="#f59e0b" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground truncate">
                  Welcome back, {currentUser.name?.split(" ")[0]}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {reminders.length} pending alert{reminders.length === 1 ? "" : "s"} need your attention
                </p>
              </div>
            </div>
            <button
              onClick={() => setDismissed(true)}
              className="p-1.5 -mr-1 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2 space-y-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {reminders.slice(0, 8).map((r) => {
            const meta = TYPE_META[r.type];
            const overdue = r.urgency === "overdue";
            return (
              <div
                key={r.id}
                onClick={() => {
                  setDismissed(true);
                  navigate(r.path);
                }}
                className="group flex gap-3 p-3 rounded-xl border border-transparent hover:border-primary/30 hover:bg-muted/40 transition-all cursor-pointer"
              >
                <div
                  className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-current/10 ${meta?.color ?? "text-muted-foreground"}`}
                >
                  {React.createElement(meta?.icon || Package, { size: 15 })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between gap-2 items-baseline">
                    <span className="truncate font-bold text-[11px] text-foreground group-hover:text-primary transition-colors">
                      {r.title}
                    </span>
                    {r.amount && (
                      <span className="text-emerald-600 text-[11px] font-bold shrink-0">
                        ₹{r.amount.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    {r.subtitle}
                  </p>
                  <div className="mt-1.5 flex gap-1.5 items-center flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                        overdue ? "bg-red-500/10 text-red-600" : "bg-amber-500/10 text-amber-600"
                      }`}
                    >
                      <span className={`w-1 h-1 rounded-full ${overdue ? "bg-red-500" : "bg-amber-500"}`} />
                      {formatRelative(r.dueDate)}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60 font-medium">
                      {formatDate(r.dueDate)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          {reminders.length > 8 && (
            <p className="text-center text-[11px] text-muted-foreground py-2">
              +{reminders.length - 8} more — open the bell icon to see all
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <button
            onClick={() => setDismissed(true)}
            className="w-full py-2 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginRemindersPopup;
