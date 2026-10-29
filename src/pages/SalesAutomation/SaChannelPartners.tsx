import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell, SalesAutoGlassCard } from "@/components/sa/SalesAutoShell";
import { CountCell, fmtPct, TitleCell } from "@/components/sa/saCells";
import { Handshake, Users, CheckCircle2, Trophy } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { MasterPage, type DataChangeEvent, type FieldDef, type RecordWithId } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";

const API = "/api/sa/channel-partners";

const fields: FieldDef[] = [
  { name: "Name", label: "Partner Name", type: "text", required: true, placeholder: "Person you deal with" },
  { name: "FirmName", label: "Firm", type: "text", placeholder: "Brokerage / agency name" },
  { name: "PartnerCode", label: "Code", type: "text", uppercase: true, placeholder: "Optional" },
  { name: "Mobile", label: "Mobile", type: "text", placeholder: "98765 43210, or +971 50 123 4567 from abroad" },
  { name: "Email", label: "Email", type: "text" },
  { name: "Region", label: "Region", type: "text", placeholder: "Area they cover" },
  { name: "CommissionRate", label: "Default Commission (%)", type: "number", placeholder: "e.g. 2" },
  { name: "BankDetails", label: "Bank Details", type: "textarea", fullWidth: true, placeholder: "Account name, number, IFSC, bank" },
  { name: "Notes", label: "Notes", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "Name", label: "Partner" },
  { key: "Mobile", label: "Contact", hideOnMobile: true },
  { key: "Region", label: "Region", hideOnMobile: true },
  { key: "CommissionRate", label: "Commission" },
  { key: "TotalLeads", label: "Leads" },
  { key: "TotalBookings", label: "Bookings" },
];

const conversion = (r: RecordWithId) =>
  Number(r.TotalLeads) ? (Number(r.TotalBookings) / Number(r.TotalLeads)) * 100 : 0;

const ContactCell = (_: unknown, r: RecordWithId) => (
  <div className="text-xs leading-snug">
    {r.Mobile ? <a href={`tel:${r.Mobile}`} className="text-foreground hover:text-primary">{String(r.Mobile)}</a> : <span className="text-muted-foreground">—</span>}
    {r.Email ? <div><a href={`mailto:${r.Email}`} className="text-muted-foreground hover:text-primary truncate">{String(r.Email)}</a></div> : null}
  </div>
);
const TextView = (v: unknown) => <p className="text-sm whitespace-pre-wrap break-words">{v ? String(v) : "—"}</p>;

const exportColumns: ExportColumn[] = [
  { header: "Partner Code", accessor: "PartnerCode" },
  { header: "Partner Name", accessor: "Name" },
  { header: "Mobile", accessor: "Mobile" },
  { header: "Email", accessor: "Email" },
  { header: "Firm", accessor: "FirmName" },
  { header: "Region", accessor: "Region" },
  { header: "Commission Rate", accessor: "CommissionRate" },
  { header: "Leads", accessor: "TotalLeads" },
  { header: "Bookings", accessor: "TotalBookings" },
];

async function fetchPartners(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch channel partners");
  return res.json().catch(() => []);
}

const SaChannelPartners: React.FC = () => {
  usePageRights("sa-channel-partners");
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const { data = [], isLoading, isFetching, dataUpdatedAt, refetch, error } = useQuery({ queryKey: ["sa-channel-partners"], queryFn: fetchPartners, staleTime: 30_000 });

  const mappedData: RecordWithId[] = React.useMemo(() => data.map((p) => ({
    _id: String(p.Id),
    PartnerCode: p.PartnerCode ?? "",
    Name: p.Name ?? "",
    Mobile: p.Mobile ?? "",
    Email: p.Email ?? "",
    FirmName: p.FirmName ?? "",
    Region: p.Region ?? "",
    CommissionRate: p.CommissionRate ?? "",
    BankDetails: p.BankDetails ?? "",
    Notes: p.Notes ?? "",
    TotalLeads: p.TotalLeads ?? 0,
    TotalBookings: p.TotalBookings ?? 0,
  })), [data]);

  const toPayload = (r: Record<string, any>) => ({
    PartnerCode: r.PartnerCode?.trim() || null,
    Name: r.Name?.trim() || null,
    Mobile: r.Mobile || null,
    Email: r.Email || null,
    FirmName: r.FirmName || null,
    Region: r.Region || null,
    CommissionRate: r.CommissionRate !== "" && r.CommissionRate != null ? parseFloat(r.CommissionRate) : null,
    BankDetails: r.BankDetails || null,
    Notes: r.Notes || null,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    const method = event.action === "add" ? "POST" : event.action === "update" ? "PUT" : "DELETE";
    const url = event.action === "add" ? API : `${API}/${event.id}`;
    const res = await fetchWithAuth(url, {
      method,
      headers: event.action === "delete" ? undefined : { "Content-Type": "application/json" },
      body: event.action === "delete" ? undefined : JSON.stringify(toPayload(event.record)),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Operation failed");
    toast.success(event.action === "delete" ? "Channel partner deleted" : "Channel partner saved");
    await queryClient.invalidateQueries({ queryKey: ["sa-channel-partners"] });
  };

  if (isLoading || error) return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Setup", "Channel Partners"]} title="Channel Partners">
      <div className={`p-6 text-sm ${error ? "text-red-500" : "text-muted-foreground"}`}>
        {error ? "Couldn't load channel partners. Refresh the page to try again." : "Loading channel partners…"}
      </div>
    </SalesAutoShell>
  );

  const leads = mappedData.reduce((s, r) => s + Number(r.TotalLeads || 0), 0);
  const bookings = mappedData.reduce((s, r) => s + Number(r.TotalBookings || 0), 0);
  const top = [...mappedData].sort((a, b) => Number(b.TotalBookings) - Number(a.TotalBookings) || Number(b.TotalLeads) - Number(a.TotalLeads))[0];
  const idle = mappedData.filter((r) => !Number(r.TotalLeads)).length;

  return (
    <SalesAutoShell breadcrumbs={["Sales Automation", "Setup", "Channel Partners"]} title="Channel Partners"
      subtitle="Brokers and referrers who bring you leads. Their payouts are made through CRM Brokerage."
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SalesAutoGlassCard label="Partners" value={mappedData.length} sub={idle ? `${idle} with no leads yet` : "all have sent leads"} icon={Handshake} accentColor="#2563eb" />
          <SalesAutoGlassCard label="Leads sent" value={leads} icon={Users} accentColor="#7c3aed" />
          <SalesAutoGlassCard label="Bookings" value={bookings} sub={leads ? `${fmtPct((bookings / leads) * 100)} of their leads` : undefined} icon={CheckCircle2} accentColor="#059669" />
          <SalesAutoGlassCard label="Top partner" value={top && Number(top.TotalBookings || top.TotalLeads) ? String(top.Name) : "—"} sub={top && Number(top.TotalBookings || top.TotalLeads) ? `${top.TotalBookings} bookings from ${top.TotalLeads} leads` : "no activity yet"} icon={Trophy} accentColor="#d97706" />
        </div>
        <MasterPage
          title="Channel Partner"
          fields={fields}
          columns={columns}
          collapsibleAddForm
          gridCols={3}
          initialData={mappedData}
          canCreate={canDoAction("sa-channel-partners", "create")}
          canEdit={canDoAction("sa-channel-partners", "edit")}
          canDelete={canDoAction("sa-channel-partners", "delete")}
          onDataEvent={handleDataEvent}
          exportConfig={{ title: "Channel Partners", filename: "channel-partners", columns: exportColumns }}
          columnRenderers={{
            Name: (v, r) => TitleCell(v, [r.FirmName, r.PartnerCode].filter(Boolean).join(" · ")),
            Mobile: ContactCell,
            CommissionRate: (v) => <span className="tabular-nums">{v !== "" && v != null ? `${Number(v)}%` : "—"}</span>,
            TotalLeads: CountCell,
            TotalBookings: (v, r) => (
              <span className="tabular-nums">
                <span className="font-semibold">{Number(v || 0)}</span>
                {Number(r.TotalLeads) > 0 && <span className="text-xs text-muted-foreground"> · {fmtPct(conversion(r))}</span>}
              </span>
            ),
          }}
          viewConfig={{
            title: "Channel Partner",
            fields: [
              { key: "Name", label: "Partner" },
              { key: "FirmName", label: "Firm" },
              { key: "PartnerCode", label: "Code" },
              { key: "Region", label: "Region" },
              { key: "Mobile", label: "Mobile" },
              { key: "Email", label: "Email" },
              { key: "CommissionRate", label: "Default Commission", render: (v) => <p className="text-sm">{v !== "" && v != null ? `${Number(v)}%` : "—"}</p> },
              { key: "TotalLeads", label: "Leads Sent" },
              { key: "TotalBookings", label: "Bookings", render: (v, r) => <p className="text-sm">{Number(v || 0)}{Number(r.TotalLeads) ? ` (${fmtPct(conversion(r))} of leads)` : ""}</p> },
              { key: "BankDetails", label: "Bank Details", render: TextView },
              { key: "Notes", label: "Notes", render: TextView },
            ],
          }}
        />
      </div>
    </SalesAutoShell>
  );
};

export default SaChannelPartners;
