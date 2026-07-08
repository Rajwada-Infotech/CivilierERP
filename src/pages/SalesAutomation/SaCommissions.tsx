import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, IndianRupee, Plus, Search } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";

const API = "/api/sa/commissions";

async function fetchCommissions(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch commissions");
  return res.json().catch(() => []);
}

async function fetchLeads(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/leads");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

async function fetchUsers(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/leads/users");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

async function fetchPartners(): Promise<any[]> {
  const res = await fetchWithAuth("/api/sa/channel-partners");
  if (!res.ok) return [];
  return res.json().catch(() => []);
}

function money(value: any) {
  const n = Number(value || 0);
  return n ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "-";
}

const SaCommissions: React.FC = () => {
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({
    LeadId: "",
    BookingId: "",
    BookingValue: "",
    SalespersonId: "",
    TeamLeadId: "",
    ChannelPartnerId: "",
    SpRate: "",
    TlRate: "",
    CpRate: "",
    Notes: "",
  });
  const { data: commissions = [], isLoading, error } = useQuery({ queryKey: ["sa-commissions"], queryFn: fetchCommissions, staleTime: 30_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-options"], queryFn: fetchLeads, staleTime: 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users-options"], queryFn: fetchUsers, staleTime: 60_000 });
  const { data: partners = [] } = useQuery({ queryKey: ["sa-channel-partners"], queryFn: fetchPartners, staleTime: 60_000 });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commissions;
    return commissions.filter((c) => [c.LeadUid, c.CustomerName, c.SalespersonName, c.TeamLeadName, c.ChannelPartnerName, c.Status]
      .some((v) => String(v ?? "").toLowerCase().includes(q)));
  }, [commissions, query]);

  const createCommission = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.BookingValue) return toast.error("Booking value is required");
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to create commission");
      toast.success("Commission created");
      setForm({ LeadId: "", BookingId: "", BookingValue: "", SalespersonId: "", TeamLeadId: "", ChannelPartnerId: "", SpRate: "", TlRate: "", CpRate: "", Notes: "" });
      await queryClient.invalidateQueries({ queryKey: ["sa-commissions"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to create commission");
    }
  };

  const updateStatus = async (commission: any, Status: string) => {
    try {
      const res = await fetchWithAuth(`${API}/${commission.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to update commission");
      toast.success(`Commission marked ${Status.toLowerCase()}`);
      await queryClient.invalidateQueries({ queryKey: ["sa-commissions"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to update commission");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading commissions...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load commissions.</div>;

  return (
    <SalesAutoShell title="Commission Tracking" subtitle="Track sales, team lead and channel partner payouts from bookings">
      <div className="space-y-5">
        {canDoAction("sa-commissions", "create") && (
          <form onSubmit={createCommission} className="grid grid-cols-1 md:grid-cols-6 gap-3 rounded-lg border border-border p-4 bg-background">
            <select value={form.LeadId} onChange={(e) => setForm({ ...form, LeadId: e.target.value })} className="md:col-span-2 border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="">Lead optional</option>
              {leads.map((l: any) => <option key={l.Id} value={l.Id}>{l.LeadUid} - {l.CustomerName}</option>)}
            </select>
            <input value={form.BookingId} onChange={(e) => setForm({ ...form, BookingId: e.target.value })} placeholder="Booking ID" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <input type="number" value={form.BookingValue} onChange={(e) => setForm({ ...form, BookingValue: e.target.value })} placeholder="Booking value" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <select value={form.SalespersonId} onChange={(e) => setForm({ ...form, SalespersonId: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="">Salesperson</option>
              {users.filter((u: any) => u.role === "sales_person").map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
            </select>
            <select value={form.TeamLeadId} onChange={(e) => setForm({ ...form, TeamLeadId: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="">Team lead</option>
              {users.filter((u: any) => u.role === "sales_team_lead").map((u: any) => <option key={u.Id} value={u.Id}>{u.Name}</option>)}
            </select>
            <select value={form.ChannelPartnerId} onChange={(e) => setForm({ ...form, ChannelPartnerId: e.target.value })} className="border border-border rounded-md bg-background px-3 py-2 text-sm">
              <option value="">Channel partner</option>
              {partners.map((p: any) => <option key={p.Id} value={p.Id}>{p.Name}</option>)}
            </select>
            <input type="number" value={form.SpRate} onChange={(e) => setForm({ ...form, SpRate: e.target.value })} placeholder="SP %" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <input type="number" value={form.TlRate} onChange={(e) => setForm({ ...form, TlRate: e.target.value })} placeholder="TL %" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <input type="number" value={form.CpRate} onChange={(e) => setForm({ ...form, CpRate: e.target.value })} placeholder="CP %" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <input value={form.Notes} onChange={(e) => setForm({ ...form, Notes: e.target.value })} placeholder="Notes" className="md:col-span-2 border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <button className="inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium">
              <Plus size={15} /> Add
            </button>
          </form>
        )}

        <div className="flex items-center gap-2 max-w-md">
          <Search size={16} className="text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search commissions" className="w-full border border-border rounded-md bg-background px-3 py-2 text-sm" />
        </div>

        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>{["Lead", "Booking Value", "Salesperson", "Team Lead", "Channel Partner", "Amounts", "Status", "Actions"].map((h) => <th key={h} className="p-3 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No commissions yet</td></tr>
              ) : filtered.map((c) => (
                <tr key={c.Id} className="border-t border-border hover:bg-muted/20">
                  <td className="p-3"><div className="font-mono text-xs text-muted-foreground">{c.LeadUid || "-"}</div><div>{c.CustomerName || "-"}</div></td>
                  <td className="p-3 whitespace-nowrap">Rs {money(c.BookingValue)}</td>
                  <td className="p-3">{c.SalespersonName || "-"}</td>
                  <td className="p-3">{c.TeamLeadName || "-"}</td>
                  <td className="p-3">{c.ChannelPartnerName || "-"}</td>
                  <td className="p-3 min-w-48 text-xs text-muted-foreground">SP Rs {money(c.SpAmount)} | TL Rs {money(c.TlAmount)} | CP Rs {money(c.CpAmount)}</td>
                  <td className="p-3"><span className="inline-flex items-center gap-1.5"><IndianRupee size={13} />{c.Status}</span></td>
                  <td className="p-3">
                    {canDoAction("sa-commissions", "edit") && c.Status === "Pending" && (
                      <button onClick={() => updateStatus(c, "Approved")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                        <CheckCircle2 size={13} /> Approve
                      </button>
                    )}
                    {canDoAction("sa-commissions", "edit") && c.Status === "Approved" && (
                      <button onClick={() => updateStatus(c, "Paid")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                        <IndianRupee size={13} /> Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SalesAutoShell>
  );
};

export default SaCommissions;
