import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshButton } from "@/components/ui/RefreshButton";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { MasterPage, type DataChangeEvent, type FieldDef, type RecordWithId } from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useAuth } from "@/contexts/AuthContext";

const API = "/api/sa/channel-partners";

const fields: FieldDef[] = [
  { name: "PartnerCode", label: "Partner Code", type: "text" },
  { name: "Name", label: "Partner Name", type: "text", required: true },
  { name: "Mobile", label: "Mobile", type: "text" },
  { name: "Email", label: "Email", type: "text" },
  { name: "FirmName", label: "Firm Name", type: "text" },
  { name: "Region", label: "Region", type: "text" },
  { name: "CommissionRate", label: "Commission Rate %", type: "number" },
  { name: "BankDetails", label: "Bank Details", type: "textarea", fullWidth: true },
  { name: "Notes", label: "Notes", type: "textarea", fullWidth: true },
];

const columns = [
  { key: "PartnerCode", label: "Code" },
  { key: "Name", label: "Partner" },
  { key: "FirmName", label: "Firm", hideOnMobile: true },
  { key: "Region", label: "Region", hideOnMobile: true },
  { key: "CommissionRate", label: "Rate %" },
  { key: "TotalLeads", label: "Leads" },
  { key: "TotalBookings", label: "Bookings" },
];

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
  const { canDoAction } = useAuth();
  const queryClient = useQueryClient();
  const { data = [], isLoading, error } = useQuery({ queryKey: ["sa-channel-partners"], queryFn: fetchPartners, staleTime: 30_000 });

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
    try {
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
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading channel partners...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load channel partners.</div>;

  return (
    <SalesAutoShell title="Channel Partners" subtitle="Manage referral partners, broker leads and commission defaults"
      action={<RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />}>
      <MasterPage
        title="Channel Partner"
        fields={fields}
        columns={columns}
        initialData={mappedData}
        canCreate={canDoAction("sa-channel-partners", "create")}
        canEdit={canDoAction("sa-channel-partners", "edit")}
        canDelete={canDoAction("sa-channel-partners", "delete")}
        onDataEvent={handleDataEvent}
        exportConfig={{ title: "Channel Partners", filename: "channel-partners", columns: exportColumns }}
      />
    </SalesAutoShell>
  );
};

export default SaChannelPartners;
