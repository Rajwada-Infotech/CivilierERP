import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { safeHtml } from "@/utils/escapeHtml";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/extra-charge-master";
const RULE = "1px solid hsl(var(--foreground))";
const NUM = "font-heading tabular-nums";

async function fetchChargeTypes(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || "Failed to load extra charge types");
  return Array.isArray(body) ? body : [];
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
    label: "Default amount ₹ — a suggestion, editable on each booking",
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
  { key: "chargeName", label: "Charge" },
  { key: "defaultAmount", label: "Default amount" },
  { key: "gstRate", label: "GST" },
  { key: "useCount", label: "On bookings" },
  { key: "status", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Charge Name", accessor: "chargeName" },
  { header: "Default Amount", accessor: "defaultAmount" },
  { header: "GST %", accessor: "gstRate" },
  { header: "Status", accessor: (r) => (r.isActive ? "Active" : "Inactive") },
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
      // MasterPage only draws a mark for a column keyed "status"; the raw flag used to show as text.
      status: Boolean(item.IsActive),
      useCount: Number(item.UseCount) || 0,
    }));
  }, [types]);

  const toPayload = (r: Record<string, any>) => ({
    ChargeName: r.chargeName?.trim() || null,
    DefaultAmount: r.defaultAmount !== "" && r.defaultAmount != null ? parseFloat(r.defaultAmount) : null,
    GstRate: r.gstRate !== "" ? parseFloat(r.gstRate) : 18,
    IsActive: r.isActive !== false,
  });

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to add charge type");
      toast.success("Extra charge type added!");
    }
    if (event.action === "update") {
      const res = await fetchWithAuth(`${API}/${event.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(event.record)),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to update charge type");
      toast.success("Extra charge type updated!");
    }
    if (event.action === "delete") {
      const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to delete charge type");
      toast.success("Extra charge type deleted!");
    }
    await queryClient.invalidateQueries({ queryKey: ["extra-charge-master"] });
  };

  const rupees = (v: unknown) => (v === "" || v == null ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
  const active = mappedData.filter((r) => r.isActive).length;
  const figures = [
    { label: "Charge types", value: mappedData.length, note: "in all" },
    { label: "Active", value: active, note: "offered when adding a charge to a booking" },
    { label: "On bookings", value: mappedData.filter((r) => Number(r.useCount) > 0).length, note: "used — can't be deleted" },
    { label: "Inactive", value: mappedData.length - active, note: "kept on old bookings" },
  ];
  const statusMark = (v: unknown) => <SheetMark text={v ? "Active" : "Inactive"} tone={v ? "done" : "draft"} />;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Extra Charges Master"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Setup"
        title="Extra charges"
        subtitle="The kinds of extra charge a booking can carry — club membership, legal fees, a corner premium — with a suggested amount (editable on each booking) and their GST."
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {figures.map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading extra charge types…</p>
        ) : error ? (
          <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>
            {(error as Error)?.message || "Failed to load extra charge types."}
          </div>
        ) : (
          <MasterPage
            title="Extra Charge Type"
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            fields={fields}
            columns={columns}
            columnRenderers={{
              chargeName: (v) => <span className="font-medium">{String(v ?? "")}</span>,
              defaultAmount: (v) => <span className={NUM}>{rupees(v)}</span>,
              gstRate: (v) => <span className={NUM}>{v === "" ? "—" : `${Number(v)}%`}</span>,
              useCount: (v) => <span className={`${NUM} text-xs`}>{Number(v) || "—"}</span>,
              status: (v) => statusMark(v),
            }}
            initialData={mappedData}
            onDataEvent={handleDataEvent}
            // Used on a booking: the server refuses the delete (deactivate it instead), so say so before it's tried.
            isDeleteLocked={(row) => (Number(row.useCount) > 0 ? `Used on ${row.useCount} booking charge(s) — deactivate it instead` : null)}
            exportConfig={rights.canExport ? {
              title: "Extra Charges Master",
              filename: "extra-charge-master",
              columns: exportColumns,
            } : undefined}
            viewConfig={{
              title: "Extra Charge Type Details",
              fields: [
                { key: "chargeName", label: "Charge Name" },
                { key: "defaultAmount", label: "Default amount", render: (v) => <span className={NUM}>{rupees(v)}</span> },
                { key: "gstRate", label: "GST", render: (v) => <span className={NUM}>{v === "" ? "—" : `${Number(v)}%`}</span> },
                { key: "useCount", label: "On bookings", render: (v) => <span className={NUM}>{Number(v) || "—"}</span> },
                { key: "isActive", label: "Status", render: (v) => statusMark(v) },
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
        )}
      </SheetShell>
    </>
  );
};

export default ExtraChargeMaster;
