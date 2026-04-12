import { fetchWithAuth } from "@/lib/fetchWithAuth";
import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
} from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE = "/api/billing-terms";

const getBillingTerms = () =>
  fetchWithAuth(BASE).then((r) => r.json());
const addBillingTerm = (data: object) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
const updateBillingTerm = (id: string, data: object) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
const deleteBillingTerm = (id: string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then(
    (r) => r.json(),
  );

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbBillingTerm {
  BillingTermID: number;
  Name: string | null;
  Description: string | null;
  GST: string | null;
  Type: string | null;
  IsActive: boolean;
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  Name: (r.name as string) || null,
  Description: (r.description as string) || null,
  GST: (r.gst as string) || null,
  Type: (r.type as string) || null,
  IsActive: r.isActive !== false,
});

// ─── Component ────────────────────────────────────────────────────────────────
const BillingTermsMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["billing-terms"],
    queryFn: getBillingTerms,
  });

  const dbItems: DbBillingTerm[] = Array.isArray(dbData) ? dbData : [];

  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: String(item.BillingTermID),
    name: item.Name || "",
    description: item.Description || "",
    gst: item.GST || "",
    type: item.Type || "",
    isActive: item.IsActive,
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addBillingTerm(toPayload(event.record));
        toast.success("Billing term saved!");
        await queryClient.invalidateQueries({ queryKey: ["billing-terms"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateBillingTerm(event.id, toPayload(event.record));
        toast.success("Billing term updated!");
        await queryClient.invalidateQueries({ queryKey: ["billing-terms"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteBillingTerm(event.id);
        toast.success("Billing term deleted!");
        await queryClient.invalidateQueries({ queryKey: ["billing-terms"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<
    string,
    (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode
  > = {
    gst: (value) => {
      const cls =
        value === "Before"
          ? "bg-blue-500/10 border-blue-500/20 text-blue-600"
          : "bg-amber-500/10 border-amber-500/20 text-amber-600";
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${cls}`}
        >
          {(value as string) || "—"}
        </span>
      );
    },
    type: (value) => {
      const cls =
        value === "Increase"
          ? "bg-green-500/10 border-green-500/20 text-green-600"
          : "bg-red-500/10 border-red-500/20 text-red-600";
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${cls}`}
        >
          {(value as string) || "—"}
        </span>
      );
    },
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return (
      <div className="p-6 text-red-500">Failed to load billing terms.</div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "Billing Terms Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Billing Terms Master
      </h1>

      <MasterPage
        title="Billing Term"
        fields={[
          { name: "name", label: "Name", type: "text", required: true },
          {
            name: "gst",
            label: "GST",
            type: "select",
            required: true,
            options: ["Before", "After"],
          },
          {
            name: "type",
            label: "Type",
            type: "select",
            required: true,
            options: ["Increase", "Decrease"],
          },
          {
            name: "description",
            label: "Description",
            type: "textarea",
            fullWidth: true,
          },
        ]}
        columns={[
          { key: "name", label: "Name" },
          { key: "gst", label: "GST" },
          { key: "type", label: "Type" },
          { key: "description", label: "Description", hideOnMobile: true },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default BillingTermsMaster;
