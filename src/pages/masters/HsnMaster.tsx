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
const BASE = "/api/hsn";

const getHsn = () =>
  fetchWithAuth(BASE).then((r) => r.json());
const addHsn = (data: object) =>
  fetchWithAuth(BASE, {
    method: "POST",
    body: JSON.stringify(data),
  }).then((r) => r.json());
const updateHsn = (code: string, data: object) =>
  fetchWithAuth(`${BASE}/${code}`, {
    method: "PUT",
    body: JSON.stringify(data),
  }).then((r) => r.json());
const deleteHsn = (code: string) =>
  fetchWithAuth(`${BASE}/${code}`, { method: "DELETE" }).then(
    (r) => r.json(),
  );

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbHsn {
  HCode: string;
  HDescription: string;
  HShortDescription: string | null;
  HCGST: number | null;
  HSGST: number | null;
  HIGST: number | null;
  HStatus: boolean;
}

// ─── Payload ──────────────────────────────────────────────────────────────────
const toPayload = (r: Record<string, unknown>) => ({
  HCode: (r.code as string) || null,
  HDescription: (r.description as string) || null,
  HShortDescription: (r.shortDesc as string) || null,
  HCGST: r.cgstRate ? Number(r.cgstRate) : 0,
  HSGST: r.sgstRate ? Number(r.sgstRate) : 0,
  HIGST: r.igstRate ? Number(r.igstRate) : 0,
  HStatus: r.status !== false,
});

// ─── Component ────────────────────────────────────────────────────────────────
const HsnMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["hsn"],
    queryFn: getHsn,
  });

  const dbItems: DbHsn[] = Array.isArray(dbData) ? dbData : [];

  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: item.HCode,
    code: item.HCode || "",
    description: item.HDescription || "",
    shortDesc: item.HShortDescription || "",
    cgstRate: item.HCGST ?? "",
    sgstRate: item.HSGST ?? "",
    igstRate: item.HIGST ?? "",
    status: item.HStatus,
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
        await addHsn(toPayload(event.record));
        toast.success("HSN saved!");
        await queryClient.invalidateQueries({ queryKey: ["hsn"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateHsn(event.id, toPayload(event.record));
        toast.success("HSN updated!");
        await queryClient.invalidateQueries({ queryKey: ["hsn"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteHsn(event.id);
        toast.success("HSN deleted!");
        await queryClient.invalidateQueries({ queryKey: ["hsn"] });
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
    igstRate: (value) =>
      value !== "" ? (
        <span className="font-mono text-sm">{Number(value)}%</span>
      ) : (
        "—"
      ),
    cgstRate: (value) =>
      value !== "" ? (
        <span className="font-mono text-sm">{Number(value)}%</span>
      ) : (
        "—"
      ),
    sgstRate: (value) =>
      value !== "" ? (
        <span className="font-mono text-sm">{Number(value)}%</span>
      ) : (
        "—"
      ),
  };

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load HSN records.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Masters", "HSN Master"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        HSN Master
      </h1>
      <MasterPage
        title="HSN"
        fields={[
          {
            name: "code",
            label: "HSN Code",
            type: "text",
            required: true,
            uppercase: true,
          },
          {
            name: "shortDesc",
            label: "Short Description",
            type: "text",
            required: true,
          },
          {
            name: "description",
            label: "Full Description",
            type: "textarea",
            fullWidth: true,
          },
          { name: "igstRate", label: "IGST Rate (%)", type: "number" },
          { name: "cgstRate", label: "CGST Rate (%)", type: "number" },
          { name: "sgstRate", label: "SGST Rate (%)", type: "number" },
          {
            name: "status",
            label: "Status",
            type: "toggle",
            defaultValue: true,
          },
        ]}
        columns={[
          { key: "code", label: "HSN Code" },
          { key: "shortDesc", label: "Short Desc" },
          { key: "igstRate", label: "IGST %", hideOnMobile: true },
          { key: "cgstRate", label: "CGST %", hideOnMobile: true },
          { key: "sgstRate", label: "SGST %", hideOnMobile: true },
          { key: "status", label: "Status" },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default HsnMaster;
