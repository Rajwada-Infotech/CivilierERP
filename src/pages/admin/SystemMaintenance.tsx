import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Construction, Loader2, Power } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
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
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

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
      setMaintenanceMode({ active, title, message, endsAt: active && endsAt ? endsAt.toISOString() : null }),
    onSuccess: (next) => {
      qc.setQueryData(["system-maintenance"], next);
      toast.success(next.active ? "Maintenance is on. Everyone except super admins is held on the Maintenance page." : "Maintenance is over. Everyone can sign in again.");
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
      <AdminShell
        title="System Maintenance"
        subtitle="Hold everyone except super admins on a Maintenance page while you work, and tell them when it will be over."
        icon={Construction}
      >
        {isLoading || !state ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="grid max-w-3xl gap-4">
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 ${
                state.active ? "border-amber-500/50 bg-amber-500/10" : "border-border bg-card/70"
              }`}
            >
              <div>
                <p className="flex items-center gap-2 font-heading font-semibold">
                  <span className={`h-2.5 w-2.5 rounded-full ${state.active ? "bg-amber-500" : "bg-emerald-500"}`} />
                  {state.active ? "Maintenance is ON" : "System is live"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {state.active
                    ? state.endsAt
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
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {apply.isPending ? <Loader2 size={15} className="animate-spin" /> : <Power size={15} />}
                  End maintenance now
                </button>
              )}
            </div>

            <div className="grid gap-4 rounded-2xl border border-border bg-card/70 p-5">
              <p className="font-heading font-semibold">{state.active ? "Change what people see" : "What people will see"}</p>

              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Heading</span>
                <input
                  className={inp}
                  value={title}
                  maxLength={120}
                  placeholder="We're upgrading CivilierERP"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Message</span>
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
                <label htmlFor="maintenance-ends" className="font-medium">
                  Expected back <span className="font-normal text-muted-foreground">(India time, optional)</span>
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
                      className="rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-muted"
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

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => (state.active ? apply.mutate(true) : setConfirmOpen(true))}
                  disabled={apply.isPending || !!endError}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                >
                  {apply.isPending ? <Loader2 size={15} className="animate-spin" /> : <Construction size={15} />}
                  {state.active ? "Update message and end time" : "Start maintenance"}
                </button>
              </div>
            </div>
          </div>
        )}
      </AdminShell>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start maintenance?</AlertDialogTitle>
            <AlertDialogDescription>
              Every user and role except super admin will be held on the Maintenance page straight away, on the web and in the
              mobile apps. Anything they have not saved is lost.
              {endsAt ? ` They will be told to expect the system back ${formatIst(endsAt.toISOString())}.` : " No end time is set."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => apply.mutate(true)}>Start maintenance</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default SystemMaintenance;
