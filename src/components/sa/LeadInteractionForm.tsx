import React, { useState } from "react";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { DateInput } from "@/components/ui/date-input";
import { useLogLeadActivity, type LeadActivityPayload } from "@/hooks/useLeadActivities";

const ACTIVITY_TYPES = ["Call", "WhatsApp", "Email", "Meeting", "Note", "SMS", "SiteVisit"];

const EMPTY: LeadActivityPayload = { ActivityType: "Call", Direction: "Outbound", Outcome: "", Summary: "", NextFollowupDate: "" };

interface LeadInteractionFormProps {
  leadId: number | null;
  /** Compact (Followups' inline panel) hides Direction/Outcome — those two
   * fields aren't part of its original field set; full (Activities' toolbar
   * form) shows everything. Same shared logging call either way. */
  variant?: "full" | "compact";
  onLogged?: () => void;
  submitLabel?: string;
}

/** The one shared "log an interaction against a lead" form — see
 * useLeadActivities.ts for why this replaced two independent copies. */
export const LeadInteractionForm: React.FC<LeadInteractionFormProps> = ({
  leadId, variant = "full", onLogged, submitLabel = "Log",
}) => {
  const [form, setForm] = useState<LeadActivityPayload>({ ...EMPTY });
  const { logActivity, saving } = useLogLeadActivity();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadId) return toast.error("Select a lead");
    if (!form.Summary?.trim()) return toast.error("Add a summary");
    try {
      await logActivity(leadId, form);
      toast.success(form.NextFollowupDate ? "Logged — next reminder set" : "Logged");
      setForm({ ...EMPTY });
      onLogged?.();
    } catch (err: any) {
      toast.error(translateError(err.message));
    }
  };

  if (variant === "compact") {
    return (
      <form onSubmit={submit} className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Type</label>
          <select value={form.ActivityType} onChange={(e) => setForm((f) => ({ ...f, ActivityType: e.target.value }))}
            className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
            {ACTIVITY_TYPES.filter((t) => t !== "SiteVisit").map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Next Reminder Date</label>
          <DateInput value={form.NextFollowupDate || ""} onChange={(e) => setForm((f) => ({ ...f, NextFollowupDate: e.target.value }))}
            className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground block mb-1">Notes *</label>
          <textarea value={form.Summary} onChange={(e) => setForm((f) => ({ ...f, Summary: e.target.value }))}
            rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" placeholder="What was discussed, customer's response..." />
        </div>
        <div className="col-span-2">
          <button type="submit" disabled={saving}
            className="px-4 py-2 btn-module text-white text-sm font-medium rounded-lg disabled:opacity-40 transition-colors">
            {saving ? "Logging..." : submitLabel}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-5 gap-3">
      <select value={form.ActivityType} onChange={(e) => setForm((f) => ({ ...f, ActivityType: e.target.value }))}
        className="border border-border rounded-md bg-background px-3 py-2 text-sm">
        {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={form.Direction || "Outbound"} onChange={(e) => setForm((f) => ({ ...f, Direction: e.target.value }))}
        className="border border-border rounded-md bg-background px-3 py-2 text-sm">
        <option value="Outbound">Outbound</option>
        <option value="Inbound">Inbound</option>
      </select>
      <input value={form.Outcome || ""} onChange={(e) => setForm((f) => ({ ...f, Outcome: e.target.value }))}
        placeholder="Outcome" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
      <DateInput value={form.NextFollowupDate || ""} onChange={(e) => setForm((f) => ({ ...f, NextFollowupDate: e.target.value }))}
        className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
      <button disabled={saving} className="inline-flex items-center justify-center gap-2 h-10 rounded-md btn-module text-white px-4 text-sm font-medium shadow-sm disabled:opacity-40">
        {saving ? "Logging..." : submitLabel}
      </button>
      <textarea value={form.Summary} onChange={(e) => setForm((f) => ({ ...f, Summary: e.target.value }))}
        placeholder="Conversation summary" className="md:col-span-5 min-h-20 border border-border rounded-md bg-background px-3 py-2 text-sm" />
    </form>
  );
};
