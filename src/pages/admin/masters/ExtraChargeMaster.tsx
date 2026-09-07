import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { FollowupShell } from "@/components/followup/FollowupShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/extra-charge-master";

async function fetchChargeTypes(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch extra charge types");
  return res.json().catch(() => ({}));
}

// DefaultAmount is only a suggested starting value shown when the charge is
// added to a booking — the actual amount always stays editable there since
// these are custom, per-customer/per-unit requirements.
const fields: FieldDef[] = [
  {
    name: "chargeName",
    label: "Charge Name",
    type: "text",
    required: true,
  },
  {
    name: "defaultAmount",
    label: "Default Amount (₹) — suggested only",
    type: "number",
  },
  {
    name: "gstRate",
    label: "GST Rate (%)",
    type: "number",
    defaultValue: "18",
  },
  {
    name: "isActive",
    label: "Status",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "chargeName", label: "Charge Name" },
  { key: "defaultAmount", label: "Default Amount (₹)" },
  { key: "gstRate", label: "GST %" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Charge Name", accessor: "chargeName" },
  { header: "Default Amount", accessor: "defaultAmount" },
  { header: "GST %", accessor: "gstRate" },
  { header: "Status", accessor: "isActive" },
];

const ExtraChargeMaster: React.FC = () => {
  const rights = usePageRights("followup-extra-charge-master");
  const queryClient = useQueryClient();

  const { data: types, isLoading, error } = useQuery({
    queryKey: ["extra-charge-master"],
    queryFn: fetchChargeTypes,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(types)) return [];
    return types.map((item) => ({
      _id: String(item.Id),
      chargeName: item.ChargeName ?? "",
      defaultAmount: item.DefaultAmount != null ? String(item.DefaultAmount) : "",
      gstRate: item.GstRate != null ? String(item.GstRate) : "18",
      isActive: Boolean(item.IsActive),
    }));
  }, [types]);

  const toPayload = (r: Record<string, any>) => ({
    ChargeName: r.chargeName?.trim() || null,
    DefaultAmount: r.defaultAmount !== "" && r.defaultAmount != null ? parseFloat(r.defaultAmount) : null,
    GstRate: r.gstRate !== "" ? parseFloat(r.gstRate) : 18,
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add charge type");
        toast.success("Extra charge type added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update charge type");
        toast.success("Extra charge type updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete charge type");
        toast.success("Extra charge type deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["extra-charge-master"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading extra charge types...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load extra charge types.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Extra Charges Master"]} />
      <FollowupShell title="Extra Charges Master">
        <MasterPage
          title="Extra Charge Type"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Extra Charges Master",
            filename: "extra-charge-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Extra Charge Type Details",
            fields: [
              { key: "chargeName", label: "Charge Name" },
              { key: "defaultAmount", label: "Default Amount (₹)" },
              { key: "gstRate", label: "GST %" },
              { key: "isActive", label: "Status" },
            ],
          }}
          onPrint={(row) => {
            const win = window.open("", "_blank", "width=600,height=400");
            if (!win) return;
            win.document.write(safeHtml`
              <html><head><title>Extra Charge — ${row.chargeName}</title>
              <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
              </head><body><h2>Extra Charge Type</h2><table>
                <tr><td>Charge Name</td><td>${row.chargeName || "—"}</td></tr>
                <tr><td>Default Amount</td><td>₹${row.defaultAmount || "0"}</td></tr>
                <tr><td>GST %</td><td>${row.gstRate || "0"}%</td></tr>
                <tr><td>Status</td><td>${row.isActive ? "Active" : "Inactive"}</td></tr>
              </table></body></html>
            `);
            win.document.close();
            win.print();
          }}
        />
      </FollowupShell>
    </>
  );
};

export default ExtraChargeMaster;
