import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CheckCircle2, IndianRupee, Plus, Search } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

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

function money(value: any) {
  const n = Number(value || 0);
  return n ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "-";
}

const SaCommissions: React.FC = () => {
  usePageRights("sa-commissions");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({
    LeadId: "",
    BookingId: "",
    BookingValue: "",
    SalespersonId: "",
    TeamLeadId: "",
    SpRate: "",
    TlRate: "",
    Notes: "",
  });
  const { data: commissions = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-commissions"], queryFn: fetchCommissions, staleTime: 30_000 });
  const { data: leads = [] } = useQuery({ queryKey: ["sa-leads-options"], queryFn: fetchLeads, staleTime: 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["sa-users-options"], queryFn: fetchUsers, staleTime: 60_000 });

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
      setForm({ LeadId: "", BookingId: "", BookingValue: "", SalespersonId: "", TeamLeadId: "", SpRate: "", TlRate: "", Notes: "" });
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

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "LeadUid", header: "Lead", size: 130,
      cell: (i) => (<><div className="font-mono text-xs text-muted-foreground">{i.row.original.LeadUid || "-"}</div><div>{i.row.original.CustomerName || "-"}</div></>) },
    { accessorKey: "BookingValue", header: "Booking Value", size: 110,
      cell: (i) => <span className="whitespace-nowrap">Rs {money(i.row.original.BookingValue)}</span> },
    { accessorKey: "SalespersonName", header: "Salesperson", size: 120, cell: (i) => <span>{i.row.original.SalespersonName || "-"}</span> },
    { accessorKey: "TeamLeadName", header: "Team Lead", size: 120, cell: (i) => <span>{i.row.original.TeamLeadName || "-"}</span> },
    { id: "amounts", header: "Amounts", size: 190, enableSorting: false,
      cell: (i) => {
        const c = i.row.original;
        return <span className="text-xs text-muted-foreground">SP Rs {money(c.SpAmount)} | TL Rs {money(c.TlAmount)}</span>;
      } },
    { id: "externalPayout", header: "External Payout", size: 150, enableSorting: false,
      cell: (i) => {
        const c = i.row.original;
        if (!c.ChannelPartnerName && !Number(c.CpAmount || 0)) return <span className="text-muted-foreground">CRM Brokerage</span>;
        return <span className="text-xs text-amber-600">Legacy CP Rs {money(c.CpAmount)} - use CRM Brokerage</span>;
      } },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className="inline-flex items-center gap-1.5"><IndianRupee size={13} />{i.row.original.Status}</span> },
    { id: "actions", header: "Actions", size: 130, enableSorting: false,
      cell: (i) => {
        const c = i.row.original;
        const hasLegacyChannelPartnerPayout = !!c.ChannelPartnerId || Number(c.CpAmount || 0) > 0;
        if (hasLegacyChannelPartnerPayout) {
          return <span className="text-xs text-muted-foreground">Use CRM Brokerage</span>;
        }
        return (
          <>
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
          </>
        );
      } },
  ];

  return (
    <SalesAutoShell title="Commission Tracking" subtitle="Track internal sales and team-lead commissions from bookings"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <Breadcrumbs items={["Sales Automation", "Commissions"]} />
      <div className="space-y-5">
        {canDoAction("sa-commissions", "create") && (
          <form onSubmit={createCommission} className="grid grid-cols-1 md:grid-cols-5 gap-3 rounded-lg border border-border p-4 bg-background">
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
            <input type="number" value={form.SpRate} onChange={(e) => setForm({ ...form, SpRate: e.target.value })} placeholder="SP %" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
            <input type="number" value={form.TlRate} onChange={(e) => setForm({ ...form, TlRate: e.target.value })} placeholder="TL %" className="border border-border rounded-md bg-background px-3 py-2 text-sm" />
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

        <DataTable
          data={filtered}
          columns={columns}
          searchable={false}
          emptyMessage="No commissions yet"
          className="rounded-xl border border-border overflow-hidden bg-card"
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaCommissions;
