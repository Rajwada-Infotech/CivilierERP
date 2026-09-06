import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { MasterPage, type DataChangeEvent, type RecordWithId } from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ReceiptText } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getChargeHeads,
  addChargeHead,
  updateChargeHead,
  deleteChargeHead,
  type ChargeHeadRow,
} from "@/api/chargeHeadApi";
import { getHsn } from "@/api/hsnApi";

// GST rate for a picked HSN — combined CGST+SGST when it's a domestic HSN,
// IGST when it's not (matches how the rest of the app reads HSN rows, e.g.
// FixedAssetMaintenance's SAC-code lookup). Used to auto-suggest TaxPct the
// moment an HSN/SAC is selected; the field stays user-editable afterward.
function gstPctFromHsn(h: { HCGST?: number | null; HSGST?: number | null; HIGST?: number | null }): number {
  const cgst = Number(h.HCGST) || 0;
  const sgst = Number(h.HSGST) || 0;
  const igst = Number(h.HIGST) || 0;
  return cgst + sgst > 0 ? cgst + sgst : igst;
}

const toPayload = (r: Record<string, unknown>) => ({
  Name: (r.name as string) || "",
  Rate: r.rate ? Number(r.rate) : 0,
  TaxPct: r.taxPct ? Number(r.taxPct) : 0,
  HsnId: r.hsnId ? Number(r.hsnId) : null,
  Status: r.status !== false,
});

const ChargeHeadMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("charge-head-master");

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["charge-heads"],
    queryFn: getChargeHeads,
    staleTime: 5 * 60 * 1000,
  });

  const { data: hsnData } = useQuery({
    queryKey: ["hsn"],
    queryFn: getHsn,
    staleTime: 5 * 60 * 1000,
  });

  const hsnRows: any[] = Array.isArray(hsnData) ? hsnData : [];
  const hsnById = new Map(hsnRows.map((h) => [String(h.HId), h]));

  const dbItems: ChargeHeadRow[] = Array.isArray(dbData) ? dbData : [];
  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: String(item.Id),
    name: item.Name || "",
    rate: item.Rate ?? "",
    taxPct: item.TaxPct ?? "",
    hsnId: item.HsnId ? String(item.HsnId) : "",
    hsnLabel: item.HCode ? `${item.HCode}${item.HDescription ? ` — ${item.HDescription}` : ""}` : "—",
    status: item.Status,
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addChargeHead(toPayload(event.record));
        toast.success("Charge Head saved!");
        await queryClient.invalidateQueries({ queryKey: ["charge-heads"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateChargeHead(event.id, toPayload(event.record));
        toast.success("Charge Head updated!");
        await queryClient.invalidateQueries({ queryKey: ["charge-heads"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        const res = await deleteChargeHead(event.id);
        toast.success(res?.message || "Charge Head removed");
        await queryClient.invalidateQueries({ queryKey: ["charge-heads"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value ? "bg-emerald-500" : "bg-red-500"}`} />
        {value ? "Active" : "Inactive"}
      </span>
    ),
    rate: (value) => (value !== "" ? <span className="font-mono text-sm">₹{Number(value).toLocaleString("en-IN")}</span> : "—"),
    taxPct: (value) => (value !== "" ? <span className="font-mono text-sm">{Number(value)}%</span> : "—"),
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load Charge Heads.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Charge Head Master"]} />
      <MaintenanceShell title="Charge Head Master" subtitle="Standard maintenance service rates & tax" icon={ReceiptText}>
        <MasterPage
          title="Charge Head"
          fields={[
            { name: "name", label: "Charge Head Name", type: "text", required: true, fullWidth: true, placeholder: "e.g. Lift Maintenance" },
            { name: "rate", label: "Standard Rate (₹)", type: "number", required: true },
            {
              name: "hsnId",
              label: "HSN / SAC Code",
              type: "select",
              asyncOptions: async () => {
                const rows = await getHsn();
                const list: any[] = Array.isArray(rows) ? rows : [];
                return list
                  .filter((h) => h.HStatus !== false)
                  .map((h) => ({ value: String(h.HId), label: `${h.HCode}${h.HDescription ? ` — ${h.HDescription}` : ""}` }));
              },
            },
            { name: "taxPct", label: "Tax (%)", type: "number" },
            { name: "status", label: "Status", type: "toggle", defaultValue: true },
          ]}
          onFieldChange={(form, fieldName) => {
            // Auto-suggest the combined GST% the moment an HSN/SAC is picked —
            // still editable afterward, this is just a starting value.
            if (fieldName === "hsnId" && form.hsnId) {
              const h = hsnById.get(String(form.hsnId));
              if (h) return { ...form, taxPct: gstPctFromHsn(h) };
            }
            return form;
          }}
          columns={[
            { key: "name", label: "Charge Head" },
            { key: "rate", label: "Rate" },
            { key: "taxPct", label: "Tax %", hideOnMobile: true },
            { key: "hsnLabel", label: "HSN/SAC", hideOnMobile: true, sortable: false },
            { key: "status", label: "Status" },
          ]}
          columnRenderers={columnRenderers}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={rights.canExport ? {
            title: "Charge Head Master",
            filename: "charge-head-master",
            columns: [
              { header: "Charge Head", accessor: "name" },
              { header: "Rate", accessor: "rate" },
              { header: "Tax %", accessor: "taxPct" },
              { header: "HSN/SAC", accessor: "hsnLabel" },
              { header: "Status", accessor: "status" },
            ],
          } : undefined}
        />
      </MaintenanceShell>
    </>
  );
};

export default ChargeHeadMaster;
