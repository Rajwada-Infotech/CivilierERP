import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CheckCircle2, IndianRupee, Clock } from "lucide-react";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { SaTabs } from "@/components/sa/SaTabs";
import { MoneyCell, MoneyView, moneyText, StatusCell, TitleCell } from "@/components/sa/saCells";
import { formatINR } from "@/utils/formatCurrency";
import { usePageRights } from "@/hooks/usePageRights";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";

const API = "/api/sa/commissions";

async function fetchCommissions(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch commissions");
  return res.json().catch(() => []);
}

async function fetchLeadOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/leads");
  if (!res.ok) return [];
  const leads = await res.json().catch(() => []);
  return (leads as any[]).map((l) => ({ value: String(l.Id), label: `${l.LeadUid} - ${l.CustomerName}` }));
}

async function fetchSalespersonOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/leads/users");
  if (!res.ok) return [];
  const users = await res.json().catch(() => []);
  return (users as any[]).filter((u) => u.role === "sales_person").map((u) => ({ value: String(u.Id), label: u.Name }));
}

async function fetchTeamLeadOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/sa/leads/users");
  if (!res.ok) return [];
  const users = await res.json().catch(() => []);
  return (users as any[]).filter((u) => u.role === "sales_team_lead").map((u) => ({ value: String(u.Id), label: u.Name }));
}

// Same field set the old inline form captured — this page only ever created
// commissions (no edit/delete existed before this migration either); status
// moves forward only via the Approve/Paid row actions below.
const fields: FieldDef[] = [
  { name: "BookingValue", label: "Booking Value", type: "number", required: true, prefix: "₹" },
  { name: "LeadId", label: "Lead", type: "select", asyncOptions: fetchLeadOptions, placeholder: "Optional" },
  { name: "BookingId", label: "Booking ID", type: "text", placeholder: "Optional" },
  { name: "SalespersonId", label: "Salesperson", type: "select", asyncOptions: fetchSalespersonOptions },
  { name: "SpRate", label: "Salesperson Rate (%)", type: "number", placeholder: "e.g. 0.5" },
  { name: "TeamLeadId", label: "Team Lead", type: "select", asyncOptions: fetchTeamLeadOptions },
  { name: "TlRate", label: "Team Lead Rate (%)", type: "number", placeholder: "e.g. 0.25" },
  { name: "Notes", label: "Notes", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "leadDisplay", label: "Lead" },
  { key: "BookingValue", label: "Booking Value" },
  { key: "spAmount", label: "Salesperson" },
  { key: "tlAmount", label: "Team Lead", hideOnMobile: true },
  { key: "externalPayout", label: "Channel Partner", sortable: false, hideOnMobile: true },
  { key: "status", label: "Status" },
];

const STATUSES = ["All", "Pending", "Approved", "Paid"] as const;

/** Payee name over their ₹ amount and rate. */
const PayeeCell = (name: unknown, amount: unknown, rate: unknown) => (
  <div className="min-w-0">
    <div className="text-sm text-foreground truncate">{name && name !== "-" ? String(name) : "—"}</div>
    <div className="text-xs text-muted-foreground tabular-nums">
      {moneyText(amount)}{Number(rate) ? ` · ${Number(rate)}%` : ""}
    </div>
  </div>
);

const SaCommissions: React.FC = () => {
  usePageRights("sa-commissions");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]>("All");
  const { data: commissions = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-commissions"], queryFn: fetchCommissions, staleTime: 30_000 });

  const mappedData: RecordWithId[] = useMemo(() => commissions.map((c) => ({
    _id: String(c.Id),
    LeadId: String(c.LeadId ?? ""),
    leadUid: c.LeadUid ?? "",
    customerName: c.CustomerName ?? "",
    leadDisplay: c.CustomerName || c.LeadUid || "",
    BookingId: c.BookingId ?? "",
    BookingValue: c.BookingValue ?? "",
    SalespersonId: String(c.SalespersonId ?? ""),
    salespersonName: c.SalespersonName ?? "-",
    TeamLeadId: String(c.TeamLeadId ?? ""),
    teamLeadName: c.TeamLeadName ?? "-",
    SpRate: c.SpRate ?? "",
    TlRate: c.TlRate ?? "",
    Notes: c.Notes ?? "",
    spAmount: c.SpAmount,
    tlAmount: c.TlAmount,
    cpAmount: c.CpAmount,
    channelPartnerId: c.ChannelPartnerId,
    channelPartnerName: c.ChannelPartnerName,
    status: c.Status ?? "Pending",
  })), [commissions]);

  const createCommission = async (event: DataChangeEvent) => {
    if (event.action !== "add") return;
    const r = event.record;
    const res = await fetchWithAuth(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        LeadId: r.LeadId || null,
        BookingId: r.BookingId || null,
        BookingValue: r.BookingValue || null,
        SalespersonId: r.SalespersonId || null,
        TeamLeadId: r.TeamLeadId || null,
        SpRate: r.SpRate || null,
        TlRate: r.TlRate || null,
        Notes: r.Notes || null,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Failed to create commission");
    toast.success("Commission created");
    await queryClient.invalidateQueries({ queryKey: ["sa-commissions"] });
  };

  const updateStatus = async (commission: RecordWithId, Status: string) => {
    try {
      const res = await fetchWithAuth(`${API}/${commission._id}`, {
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

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Finance", "Commissions"]} title="Commissions">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load commissions. Refresh the page to try again." : "Loading commissions…"}
      </div>
    </SalesAutoShell>
  );

  const payout = (r: RecordWithId) => Number(r.spAmount || 0) + Number(r.tlAmount || 0);
  const totals = Object.fromEntries(STATUSES.slice(1).map((s) => {
    const rows = mappedData.filter((r) => r.status === s);
    return [s, { count: rows.length, amount: rows.reduce((sum, r) => sum + payout(r), 0) }];
  })) as Record<string, { count: number; amount: number }>;
  const shown = statusFilter === "All" ? mappedData : mappedData.filter((r) => r.status === statusFilter);

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Finance", "Commissions"]} title="Commissions"
      subtitle="Salesperson and team-lead commission on each booking: Pending → Approved → Paid. Channel-partner payouts are handled in CRM Brokerage."
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SalesAutoGlassCard label="Waiting for approval" value={formatINR(totals.Pending.amount)} sub={`${totals.Pending.count} commission${totals.Pending.count === 1 ? "" : "s"}`} icon={Clock} accentColor="#d97706" onClick={() => setStatusFilter("Pending")} />
          <SalesAutoGlassCard label="Approved, not paid" value={formatINR(totals.Approved.amount)} sub={`${totals.Approved.count} to pay out`} icon={CheckCircle2} accentColor="#2563eb" onClick={() => setStatusFilter("Approved")} />
          <SalesAutoGlassCard label="Paid" value={formatINR(totals.Paid.amount)} sub={`${totals.Paid.count} settled`} icon={IndianRupee} accentColor="#059669" onClick={() => setStatusFilter("Paid")} />
        </div>
        <SaTabs
          tabs={STATUSES.map((s) => ({ key: s, label: s === "All" ? `All (${mappedData.length})` : `${s} (${totals[s].count})` }))}
          active={statusFilter}
          onChange={(key) => setStatusFilter(key as (typeof STATUSES)[number])}
        />
        <MasterPage
          title="Commission"
          fields={fields}
          columns={columns}
          collapsibleAddForm
          gridCols={3}
          canCreate={canDoAction("sa-commissions", "create")}
          canEdit={false}
          canDelete={false}
          initialData={shown}
          onDataEvent={createCommission}
          columnRenderers={{
            leadDisplay: (v, row) => TitleCell(v || "No lead linked", row.leadUid || (row.BookingId ? `Booking ${row.BookingId}` : "")),
            BookingValue: MoneyCell,
            spAmount: (v, row) => PayeeCell(row.salespersonName, v, row.SpRate),
            tlAmount: (v, row) => PayeeCell(row.teamLeadName, v, row.TlRate),
            status: (value) => StatusCell(value),
            externalPayout: (_value, row) => {
              if (!row.channelPartnerName && !Number(row.cpAmount || 0)) return <span className="text-xs text-muted-foreground">—</span>;
              return <span className="text-xs text-amber-600">{moneyText(row.cpAmount)} (old record) — pay via CRM Brokerage</span>;
            },
          }}
          rowActions={(row) => {
            const hasLegacyChannelPartnerPayout = !!row.channelPartnerId || Number(row.cpAmount || 0) > 0;
            if (hasLegacyChannelPartnerPayout) {
              return <span className="text-xs text-muted-foreground">Use CRM Brokerage</span>;
            }
            return (
              <>
                {canDoAction("sa-commissions", "edit") && row.status === "Pending" && (
                  <button type="button" onClick={() => updateStatus(row, "Approved")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                    <CheckCircle2 size={13} /> Approve
                  </button>
                )}
                {canDoAction("sa-commissions", "edit") && row.status === "Approved" && (
                  <button type="button" onClick={() => updateStatus(row, "Paid")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                    <IndianRupee size={13} /> Mark paid
                  </button>
                )}
              </>
            );
          }}
          viewConfig={{
            title: "Commission Details",
            fields: [
              { key: "leadDisplay", label: "Customer" },
              { key: "leadUid", label: "Lead ID" },
              { key: "BookingId", label: "Booking ID" },
              { key: "BookingValue", label: "Booking Value", render: MoneyView },
              { key: "salespersonName", label: "Salesperson" },
              { key: "spAmount", label: "Salesperson Commission", render: (v, row) => <p className="text-sm tabular-nums">{moneyText(v)}{Number(row.SpRate) ? ` (${row.SpRate}%)` : ""}</p> },
              { key: "teamLeadName", label: "Team Lead" },
              { key: "tlAmount", label: "Team Lead Commission", render: (v, row) => <p className="text-sm tabular-nums">{moneyText(v)}{Number(row.TlRate) ? ` (${row.TlRate}%)` : ""}</p> },
              { key: "status", label: "Status", render: (v) => StatusCell(v) },
              { key: "Notes", label: "Notes" },
            ],
          }}
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaCommissions;
