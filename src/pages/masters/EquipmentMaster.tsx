// Engineering → Setup → Equipment Master: machines and plant a BOQ can plan for (the BOQ's Equipment tab picks from
// the active ones; the rate here is the default on a new line).
import React, { useEffect, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { MasterPage, type FieldDef, type ColumnDef, type DataChangeEvent } from "@/components/MasterPage";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getUOMs } from "@/api/purchaseOrdersApi";
import {
  getEquipment,
  addEquipment,
  updateEquipment,
  deleteEquipment,
  type Equipment,
  type EquipmentInput,
} from "@/api/equipmentMasterApi";

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

const mapRow = (e: Equipment): Record<string, unknown> => ({
  _id: String(e.id),
  Name: e.name,
  Code: e.code ?? "",
  Uom: e.uom ?? "",
  Rate: e.rate ?? "",
  Ownership: e.ownership,
  Description: e.description ?? "",
  IsActive: Boolean(e.isActive),
  UsedOnBoqs: e.usedOnBoqs,
});

const toInput = (r: Record<string, unknown>): EquipmentInput => ({
  name: String(r.Name ?? "").trim(),
  code: String(r.Code ?? "").trim() || null,
  uom: String(r.Uom ?? "").trim() || null,
  rate: r.Rate === "" || r.Rate == null ? null : Number(r.Rate),
  ownership: r.Ownership === "Owned" ? "Owned" : "Hired",
  description: String(r.Description ?? "").trim() || null,
  isActive: r.IsActive !== undefined ? Boolean(r.IsActive) : true,
});

const EquipmentMaster: React.FC = () => {
  const rights = usePageRights("equipment-master");
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = async () => setRows((await getEquipment()).map(mapRow));
  useEffect(() => {
    refetch()
      .catch(() => toast.error("Failed to load equipment"))
      .finally(() => setLoading(false));
  }, []);

  const fields: FieldDef[] = [
    { name: "Name", label: "Equipment", type: "text", required: true, fullWidth: true, placeholder: "e.g. JCB 3DX backhoe loader" },
    { name: "Code", label: "Short code", type: "text", placeholder: "e.g. JCB-3DX" },
    {
      name: "Uom",
      label: "Billing unit",
      type: "select",
      asyncOptions: async () => {
        const uoms = await getUOMs().catch(() => [] as any[]);
        const names = (uoms as any[]).map((u) => String(u.UOMName ?? u.name ?? "")).filter(Boolean);
        // The usual hire units first, then the rest of the UOM master.
        const common = ["Hour", "Day", "Month", "Trip"];
        return [...new Set([...common, ...names])].map((n) => ({ value: n, label: n }));
      },
    },
    { name: "Rate", label: "Standard rate (₹ per unit)", type: "number", placeholder: "e.g. 1200" },
    { name: "Ownership", label: "Owned or hired", type: "select", options: ["Hired", "Owned"], defaultValue: "Hired" },
    { name: "Description", label: "Description", type: "textarea", fullWidth: true, placeholder: "Make, capacity, notes" },
    { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
  ];

  const columns: ColumnDef[] = [
    { key: "Name", label: "Equipment" },
    { key: "Code", label: "Code" },
    { key: "Uom", label: "Unit" },
    { key: "Rate", label: "Rate" },
    { key: "Ownership", label: "Owned / hired" },
    { key: "UsedOnBoqs", label: "On BOQs" },
    { key: "IsActive", label: "Status" },
  ];

  const columnRenderers = {
    Name: (v: unknown) => <span className="text-sm font-medium text-foreground">{String(v ?? "")}</span>,
    Code: (v: unknown) => <span className="font-heading text-xs tabular-nums text-muted-foreground">{String(v || "—")}</span>,
    Uom: (v: unknown) => <span className="text-xs text-foreground">{String(v || "—")}</span>,
    Rate: (v: unknown) => (
      <span className="font-heading text-xs font-semibold tabular-nums text-foreground">{v === "" || v == null ? "—" : inr(Number(v))}</span>
    ),
    Ownership: (v: unknown) => <span className="text-xs text-foreground">{String(v ?? "")}</span>,
    UsedOnBoqs: (v: unknown) => <span className="font-heading text-xs tabular-nums text-muted-foreground">{Number(v) || 0}</span>,
    IsActive: (v: unknown) => <SheetMark text={v ? "Active" : "Inactive"} tone={v ? "done" : "waiting"} />,
  };

  const check = (form: Record<string, unknown>) => {
    if (!String(form.Name ?? "").trim()) {
      toast.error("Enter the equipment's name.");
      return null;
    }
    const rate = String(form.Rate ?? "").trim();
    if (rate !== "" && !(Number(rate) >= 0)) {
      toast.error("Rate must be a number of 0 or more.");
      return null;
    }
    return form;
  };

  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") await addEquipment(toInput(event.record as Record<string, unknown>));
      else if (event.action === "update") await updateEquipment(Number(event.id), toInput(event.record as Record<string, unknown>));
      else if (event.action === "delete") await deleteEquipment(Number(event.id));
    } catch (err) {
      toast.error((err as Error).message);
      throw err;
    }
    await refetch();
    // The BOQ's Equipment tab keeps its own copy of the list.
    queryClient.invalidateQueries({ queryKey: ["equipment-options"] });
  };

  return (
    <>
      <Breadcrumbs items={["Engineering", "Setup", "Equipment Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Engineering"
        title="Equipment master"
        subtitle="Machines and plant a BOQ can plan for: the billing unit and standard rate become the defaults on a BOQ's Equipment tab."
      >
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-sm font-heading">Loading equipment…</span>
          </div>
        ) : (
          <MasterPage
            title="Equipment"
            fields={fields}
            columns={columns}
            columnRenderers={columnRenderers}
            initialData={rows}
            onDataEvent={handleDataEvent}
            onCustomSave={check}
            canCreate={rights.canCreate}
            canEdit={rights.canEdit}
            canDelete={rights.canDelete}
            exportConfig={
              rights.canExport
                ? {
                    title: "Equipment Master",
                    filename: "equipment-master",
                    columns: [
                      { header: "Equipment", accessor: "Name" },
                      { header: "Code", accessor: "Code" },
                      { header: "Unit", accessor: "Uom" },
                      { header: "Rate", accessor: "Rate" },
                      { header: "Owned / hired", accessor: "Ownership" },
                      { header: "Description", accessor: "Description" },
                      { header: "Status", accessor: (r) => (r.IsActive ? "Active" : "Inactive") },
                    ],
                  }
                : undefined
            }
          />
        )}
      </SheetShell>
    </>
  );
};

export default EquipmentMaster;
