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
const BASE = "/api/tds-master";

const getTds = () =>
  fetchWithAuth(BASE).then((r) => r.json());
const addTds = (data: object) =>
  fetchWithAuth(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
const updateTds = (id: string, data: object) =>
  fetchWithAuth(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
const deleteTds = (id: string) =>
  fetchWithAuth(`${BASE}/${id}`, { method: "DELETE" }).then(
    (r) => r.json(),
  );

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbTds {
  TDSId: number;
  Nature: string | null;
  Name: string | null;
  Percentage: number | null;
  Status: boolean;
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  Nature: (r.nature as string) || null,
  Name: (r.name as string) || null,
  Percentage: r.percentage ? Number(r.percentage) : 0,
  Status: r.status !== false,
});

// ─── Component ────────────────────────────────────────────────────────────────
const TdsMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["tds"],
    queryFn: getTds,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems: DbTds[] = Array.isArray(dbData) ? dbData : [];

  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: String(item.TDSId),
    nature: item.Nature || "",
    name: item.Name || "",
    percentage: item.Percentage ?? "",
    status: item.Status,
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addTds(toPayload(event.record));
        toast.success("TDS saved!");
        await queryClient.invalidateQueries({ queryKey: ["tds"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateTds(event.id, toPayload(event.record));
        toast.success("TDS updated!");
        await queryClient.invalidateQueries({ queryKey: ["tds"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteTds(event.id);
        toast.success("TDS deleted!");
        await queryClient.invalidateQueries({ queryKey: ["tds"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<string, (value: unknown) => React.ReactNode> = {
    status: (value) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${value ? "bg-green-500/10 border-green-500/20 text-green-600" : "bg-red-500/10 border-red-500/20 text-red-600"}`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full mr-1.5 ${value ? "bg-green-500" : "bg-red-500"}`}
        />
        {value ? "Active" : "Inactive"}
      </span>
    ),
    percentage: (value) => (
      <span className="font-mono text-sm">
        {value !== "" ? `${value}%` : "—"}
      </span>
    ),
    nature: (value) => (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border bg-blue-500/10 border-blue-500/20 text-blue-600">
        {String(value || "—")}
      </span>
    ),
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load TDS records.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "TDS Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        TDS Master
      </h1>
      <MasterPage
        title="TDS"
        fields={[
          {
            name: "nature",
            label: "Nature",
            type: "text",
            required: true,
            uppercase: true,
          },
          { name: "name", label: "Name", type: "text", required: true },
          {
            name: "percentage",
            label: "Percentage (%)",
            type: "number",
            required: true,
          },
          {
            name: "status",
            label: "Status",
            type: "toggle",
            defaultValue: true,
          },
        ]}
        columns={[
          { key: "nature", label: "Nature" },
          { key: "name", label: "Name" },
          { key: "percentage", label: "Rate (%)" },
          { key: "status", label: "Status" },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default TdsMaster;
