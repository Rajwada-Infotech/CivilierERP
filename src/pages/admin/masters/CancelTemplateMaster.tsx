import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePageRights } from "@/hooks/usePageRights";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import { type ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/cancel-template-master";

async function fetchCancelTemplates(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch cancel templates");
  return res.json().catch(() => ({}));
}

const fields: FieldDef[] = [
  {
    name: "reason",
    label: "Cancel Reason",
    type: "text",
    required: true,
  },
  {
    name: "isActive",
    label: "Status",
    type: "toggle",
    defaultValue: true,
  },
];

const columns = [
  { key: "reason", label: "Cancel Reason" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Cancel Reason", accessor: "reason" },
  { header: "Status", accessor: "isActive" },
];

const CancelTemplateMaster: React.FC = () => {
  usePageRights("followup-cancel-template-master");
  const queryClient = useQueryClient();

  const { data: templates, isLoading, error } = useQuery({
    queryKey: ["cancel-template-master"],
    queryFn: fetchCancelTemplates,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(templates)) return [];
    return templates.map((item) => ({
      _id: String(item.Id),
      reason: item.Reason ?? "",
      isActive: Boolean(item.IsActive),
    }));
  }, [templates]);

  const toPayload = (r: Record<string, any>) => ({
    Reason: r.reason?.trim() || null,
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
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add cancel template");
        toast.success("Cancel template added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update cancel template");
        toast.success("Cancel template updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete cancel template");
        toast.success("Cancel template deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["cancel-template-master"] });
      // The Cancel Task dialog reads from this same active-templates list.
      await queryClient.invalidateQueries({ queryKey: ["cancel-template-active"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading cancel templates...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load cancel templates.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Cancel Template"]} />
      <FollowupShell title="Cancel Template">
        <MasterPage
          title="Cancel Template"
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Cancel Template Master",
            filename: "cancel-template-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Cancel Template Details",
            fields: [
              { key: "reason", label: "Cancel Reason" },
              { key: "isActive", label: "Status" },
            ],
          }}
        />
      </FollowupShell>
    </>
  );
};

export default CancelTemplateMaster;
