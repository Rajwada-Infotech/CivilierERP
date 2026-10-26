import React, { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { CheckCircle2, IndianRupee } from "lucide-react";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";
import { MasterPage, type DataChangeEvent, type RecordWithId, type FieldDef } from "@/components/MasterPage";
import { StatusBadge } from "@/components/StatusBadge";

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

function money(value: any) {
  const n = Number(value || 0);
  return n ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "-";
}

// Same field set the old inline form captured — this page only ever created
// commissions (no edit/delete existed before this migration either); status
// moves forward only via the Approve/Paid row actions below.
const fields: FieldDef[] = [
  { name: "LeadId", label: "Lead (optional)", type: "select", asyncOptions: fetchLeadOptions },
  { name: "BookingId", label: "Booking ID", type: "text" },
  { name: "BookingValue", label: "Booking Value", type: "number", required: true },
  { name: "SalespersonId", label: "Salesperson", type: "select", asyncOptions: fetchSalespersonOptions },
  { name: "TeamLeadId", label: "Team Lead", type: "select", asyncOptions: fetchTeamLeadOptions },
  { name: "SpRate", label: "SP %", type: "number" },
  { name: "TlRate", label: "TL %", type: "number" },
  { name: "Notes", label: "Notes", type: "text", fullWidth: true },
];

const columns = [
  { key: "leadDisplay", label: "Lead" },
  { key: "bookingValue", label: "Booking Value" },
  { key: "salespersonName", label: "Salesperson" },
  { key: "teamLeadName", label: "Team Lead" },
  { key: "amounts", label: "Amounts", sortable: false },
  { key: "externalPayout", label: "External Payout", sortable: false },
  { key: "status", label: "Status" },
];

const SaCommissions: React.FC = () => {
  usePageRights("sa-commissions");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const { data: commissions = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-commissions"], queryFn: fetchCommissions, staleTime: 30_000 });

  const mappedData: RecordWithId[] = useMemo(() => commissions.map((c) => ({
    _id: String(c.Id),
    LeadId: String(c.LeadId ?? ""),
    leadUid: c.LeadUid ?? "",
    customerName: c.CustomerName ?? "",
    leadDisplay: c.LeadUid || c.CustomerName ? `${c.LeadUid || "-"} — ${c.CustomerName || "-"}` : "-",
    BookingId: c.BookingId ?? "",
    BookingValue: c.BookingValue ?? "",
    bookingValue: `Rs ${money(c.BookingValue)}`,
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

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading commissions...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load commissions.</div>;

  return (
    <SalesAutoShell title="Commission Tracking" subtitle="Track internal sales and team-lead commissions from bookings"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <Breadcrumbs items={["Sales Automation", "Commissions"]} />
      <div className="space-y-8">
        <MasterPage
          title="Commission"
          fields={fields}
          columns={columns}
          canCreate={canDoAction("sa-commissions", "create")}
          canEdit={false}
          canDelete={false}
          initialData={mappedData}
          onDataEvent={createCommission}
          columnRenderers={{
            status: (value) => <StatusBadge status={String(value)} />,
            amounts: (_value, row) => (
              <span className="text-xs text-muted-foreground">SP Rs {money(row.spAmount)} | TL Rs {money(row.tlAmount)}</span>
            ),
            externalPayout: (_value, row) => {
              if (!row.channelPartnerName && !Number(row.cpAmount || 0)) return <span className="text-muted-foreground">CRM Brokerage</span>;
              return <span className="text-xs text-amber-600">Legacy CP Rs {money(row.cpAmount)} — use CRM Brokerage</span>;
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
                    <IndianRupee size={13} /> Paid
                  </button>
                )}
              </>
            );
          }}
          viewConfig={{
            title: "Commission Details",
            fields: [
              { key: "leadDisplay", label: "Lead" },
              { key: "BookingId", label: "Booking ID" },
              { key: "bookingValue", label: "Booking Value" },
              { key: "salespersonName", label: "Salesperson" },
              { key: "SpRate", label: "SP %" },
              { key: "teamLeadName", label: "Team Lead" },
              { key: "TlRate", label: "TL %" },
              { key: "status", label: "Status" },
              { key: "Notes", label: "Notes" },
            ],
          }}
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaCommissions;
