import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Construction, Loader2, Power } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getMaintenanceStatus, setMaintenanceMode } from "@/api/maintenanceModeApi";
import { formatIst, fromIstInputValue, toIstInputValue } from "@/lib/maintenanceTime";

const inp =
  "w-full px-3 py-2 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const chip = (on: boolean) =>
  `${KEY} h-8 px-3 border ${on ? "bg-foreground text-card border-foreground" : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"}`;

const WARNINGS: { label: string; minutes: number }[] = [
  { label: "Right now", minutes: 0 },
  { label: "In 2 min", minutes: 2 },
  { label: "In 5 min", minutes: 5 },
  { label: "In 10 min", minutes: 10 },
];

const PRESETS: { label: string; minutes: number }[] = [
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
];

/** Super admin: switch maintenance on for everyone else (with a message and when it ends), or end it. */
const SystemMaintenance = () => {
  const qc = useQueryClient();
  const { data: state, isLoading } = useQuery({
    queryKey: ["system-maintenance"],
    queryFn: getMaintenanceStatus,
    refetchInterval: 15_000,
  });

  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [endsAtInput, setEndsAtInput] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startIn, setStartIn] = useState(2);

  // Start the form from what is live, so changing the end time is a small edit.
  useEffect(() => {
    if (state?.active) {
      setTitle(state.title ?? "");
      setMessage(state.message ?? "");
      setEndsAtInput(state.endsAt ? toIstInputValue(new Date(state.endsAt)) : "");
    }
  }, [state?.active, state?.title, state?.message, state?.endsAt]);

  const endsAt = fromIstInputValue(endsAtInput);
  const endError =
    endsAtInput && !endsAt ? "Enter a valid date and time." : endsAt && endsAt.getTime() <= Date.now() ? "The end time must be in the future." : null;

  const apply = useMutation({
    mutationFn: (active: boolean) =>
      setMaintenanceMode({ active, title, message, endsAt: active && endsAt ? endsAt.toISOString() : null, startInMinutes: startIn }),
    onSuccess: (next) => {
      qc.setQueryData(["system-maintenance"], next);
      toast.success(
        !next.active
          ? "Maintenance is over. Everyone can sign in again."
          : next.enforced
            ? "Maintenance is on. Everyone except super admins is held on the Maintenance page."
            : "Maintenance announced. Everyone sees a countdown and is held when it reaches zero.",
      );
      setConfirmOpen(false);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmOpen(false);
    },
  });

  const setEndIn = (minutes: number) => setEndsAtInput(toIstInputValue(new Date(Date.now() + minutes * 60_000)));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "System Maintenance"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="System maintenance"
        subtitle="Hold everyone except super admins on a Maintenance page while you work, and tell them when it will be over."
      >
        {isLoading || !state ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid max-w-3xl gap-5">
            <div
              className={`flex flex-wrap items-center justify-between gap-3 bg-card p-4 border ${
                state.active && state.enforced ? "border-destructive" : state.active ? "border-dashed border-foreground" : "border-foreground"
              }`}
            >
              <div>
                <p className={LBL}>Status</p>
                <div className="mt-1.5">
                  {!state.active ? (
                    <SheetMark text="System is live" tone="done" />
                  ) : state.enforced ? (
                    <SheetMark text="Maintenance is on" tone="stopped" />
                  ) : (
                    <SheetMark text="Maintenance announced — not started yet" tone="waiting" />
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {state.active
                    ? !state.enforced && state.startsAt
                      ? `Everyone is held from ${formatIst(state.startsAt)}${state.endsAt ? ` · expected back ${formatIst(state.endsAt)}` : ""}`
                      : state.endsAt
                      ? `Expected back ${formatIst(state.endsAt)}${state.updatedBy ? ` · started by ${state.updatedBy}` : ""}`
                      : `No end time set${state.updatedBy ? ` · started by ${state.updatedBy}` : ""}`
                    : "Everyone can use the system."}
                </p>
              </div>
              {state.active && (
                <button
                  type="button"
                  onClick={() => apply.mutate(false)}
                  disabled={apply.isPending}
                  className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}
                >
                  {apply.isPending ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                  End maintenance now
                </button>
              )}
            </div>

            <div className="grid gap-4 bg-card p-4" style={{ border: RULE }}>
              <p className={`${HEAD} pb-3 -mx-4 px-4`} style={{ borderBottom: RULE }}>{state.active ? "Change what people see" : "What people will see"}</p>

              <label className="grid gap-1.5 text-sm">
                <span className={LBL}>Heading</span>
                <input
                  className={inp}
                  value={title}
                  maxLength={120}
                  placeholder="We're upgrading CivilierERP"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className={LBL}>Message</span>
                <textarea
                  rows={3}
                  className={inp}
                  value={message}
                  maxLength={500}
                  placeholder="The system is offline for a short while so we can make it better. Everything you saved is safe."
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>

              <div className="grid gap-1.5 text-sm">
                <label htmlFor="maintenance-ends" className={LBL}>
                  Expected back <span className="normal-case tracking-normal font-normal">(India time, optional)</span>
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id="maintenance-ends"
                    type="datetime-local"
                    className={`${inp} w-auto`}
                    value={endsAtInput}
                    onChange={(e) => setEndsAtInput(e.target.value)}
                  />
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setEndIn(p.minutes)}
                      className={chip(false)}
                    >
                      In {p.label}
                    </button>
                  ))}
                </div>
                {endError ? (
                  <p className="text-xs text-destructive">{endError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    People see a countdown to this time. Maintenance does not end by itself - you end it with the button above.
                  </p>
                )}
              </div>

              {!state.active && (
                <div className="grid gap-1.5 text-sm">
                  <span className={LBL}>Hold everyone</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {WARNINGS.map((w) => (
                      <button
                        key={w.minutes}
                        type="button"
                        aria-pressed={startIn === w.minutes}
                        onClick={() => setStartIn(w.minutes)}
                        className={chip(startIn === w.minutes)}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {startIn === 0
                      ? <span className="text-destructive">Everyone is held at once - anything unsaved is lost.</span>
                      : `Everyone sees a countdown strip now (also on the login page) and is held when it ends, so they can finish and save what they are doing.`}
                  </p>
                </div>
              )}

              <div className="flex justify-end pt-3 -mx-4 px-4" style={{ borderTop: RULE }}>
                <button
                  type="button"
                  onClick={() => (state.active ? apply.mutate(true) : setConfirmOpen(true))}
                  disabled={apply.isPending || !!endError}
                  className={`${KEY} h-9 px-5 border ${state.active ? "bg-foreground text-card border-foreground" : "bg-destructive text-destructive-foreground border-destructive"}`}
                >
                  {apply.isPending ? <Loader2 size={15} className="animate-spin" /> : <Construction size={15} />}
                  {state.active ? "Update message and end time" : "Start maintenance"}
                </button>
              </div>
            </div>
          </div>
        )}
      </SheetShell>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="sheet-frame" style={{ margin: 0 }}>
          <AlertDialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>System maintenance</p>
              <AlertDialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Start maintenance</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              {startIn === 0
                ? "Every user and role except super admin will be held on the Maintenance page straight away, on the web and in the mobile apps. Anything they have not saved is lost."
                : `Every user and role except super admin sees a countdown now and is held on the Maintenance page in ${startIn} minutes, on the web and in the mobile apps.`}
              {endsAt ? ` They will be told to expect the system back ${formatIst(endsAt.toISOString())}.` : " No end time is set."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-3" style={{ borderTop: RULE }}>
            <AlertDialogCancel className={`${KEY} h-9 px-4 rounded-none border border-foreground text-foreground bg-card hover:bg-primary/10`}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => apply.mutate(true)} className={`${KEY} h-9 px-5 rounded-none !bg-destructive !text-destructive-foreground border border-destructive hover:!bg-destructive/90`}>
              Start maintenance
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SystemMaintenance;
