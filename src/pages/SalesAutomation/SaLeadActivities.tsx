import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageCircle, Phone, Plus, Search } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";

const API = "/api/sa/lead-activities";
const ACTIVITY_TYPES = ["Call", "WhatsApp", "Email", "Meeting", "Note", "SMS", "SiteVisit"];

async function fetchActivities(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch activities");
  return res.json().catch(() => []);
}

async function fetchLeads(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/leads");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

const SaLeadActivities: React.FC = () => {
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({
    LeadId: "",
    ActivityType: "Call",
    Direction: "Outbound",
    Outcome: "",
    Summary: "",
    NextFollowupDate: "",
  });
  const { data: activities = [], isLoading, error } = useQuery({ queryKey: ["sa-lead-activities"], queryFn: fetchActivities, staleTime: 30_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-options"], queryFn: fetchLeads, staleTime: 60_000 });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) => [a.LeadUid, a.CustomerName, a.Mobile, a.ActivityType, a.Outcome, a.Summary]
      .some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [activities, query]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.LeadId) return toast.error("Select a lead");
    if (!form.Summary.trim()) return toast.error("Add an activity summary");
    try {
      const res = await fetchWithAuth(`${API}/lead/${form.LeadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ActivityType: form.ActivityType,
          Direction: form.Direction || null,
          Outcome: form.Outcome || null,
          Summary: form.Summary,
          NextFollowupDate: form.NextFollowupDate || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to log activity");
      toast.success("Activity logged");
      setForm((current) => ({ ...current, Outcome: "", Summary: "", NextFollowupDate: "" }));
      await queryClient.invalidateQueries({ queryKey: ["sa-lead-activities"] });
      await queryClient.invalidateQueries({ queryKey: ["sa-leads"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to log activity");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading activities...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load activities.</div>;

  return (
    <SalesAutoShell title="Lead Activities" subtitle="Log calls, WhatsApp, meetings and next follow-up dates against leads">
      <div className="space-y-5">
        {canDoAction("sa-lead-activities", "create") && (
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-6 gap-3 rounded-lg border border-border p-4 bg-background">
            <select value={form.LeadId} onChange={(e) => setForm({ ...form, LeadId: e.target.value })} className="md:col-span-2 border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="">Select lead</option>
              {leads.map((l: any) => <option key={l.Id} value={l.Id}>{l.LeadUid} - {l.CustomerName}</option>)}
            </select>
            <select value={form.ActivityType} onChange={(e) => setForm({ ...form, ActivityType: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm">
              {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={form.Direction} onChange={(e) => setForm({ ...form, Direction: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="Outbound">Outbound</option>
              <option value="Inbound">Inbound</option>
            </select>
            <input value={form.Outcome} onChange={(e) => setForm({ ...form, Outcome: e.target.value })} placeholder="Outcome" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <input type="date" value={form.NextFollowupDate} onChange={(e) => setForm({ ...form, NextFollowupDate: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <textarea value={form.Summary} onChange={(e) => setForm({ ...form, Summary: e.target.value })} placeholder="Conversation summary" className="md:col-span-5 min-h-20 border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <button className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium">
              <Plus size={15} /> Log
            </button>
          </form>
        )}

        <div className="flex items-center gap-2 max-w-md">
          <Search size={16} className="text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search activity timeline" className="w-full border border-border rounded-md bg-background px-3 py-2 text-sm" />
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>{["Lead", "Customer", "Activity", "Outcome", "Summary", "Next Follow-up", "Logged By", "Created"].map((h) => <th key={h} className="p-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No activities yet</td></tr>
              ) : filtered.map((a) => (
                <tr key={a.Id} className="border-t border-border hover:bg-muted/20">
                  <td className="p-3 font-mono text-xs text-muted-foreground">{a.LeadUid}</td>
                  <td className="p-3"><div className="font-medium">{a.CustomerName}</div><div className="text-xs text-muted-foreground">{a.Mobile}</div></td>
                  <td className="p-3"><span className="inline-flex items-center gap-1.5">{a.ActivityType === "Call" ? <Phone size={13} /> : <MessageCircle size={13} />}{a.ActivityType}</span></td>
                  <td className="p-3 text-xs">{a.Outcome || "-"}</td>
                  <td className="p-3 min-w-72">{a.Summary}</td>
                  <td className="p-3 whitespace-nowrap">{a.NextFollowupDate ? String(a.NextFollowupDate).slice(0, 10) : "-"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{a.CreatedByName || "System"}</td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{a.CreatedAt ? new Date(a.CreatedAt).toLocaleString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SalesAutoShell>
  );
};

export default SaLeadActivities;
