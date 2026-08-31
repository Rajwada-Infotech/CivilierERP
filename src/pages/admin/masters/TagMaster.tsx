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
import { type ExportColumn } from "@/lib/export";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/tag-master";

async function fetchTags(): Promise<any[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to fetch tags");
  return res.json().catch(() => ({}));
}

const fields: FieldDef[] = [
  {
    name: "name",
    label: "Tag Name",
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
  { key: "name", label: "Tag Name" },
  { key: "isActive", label: "Status" },
];

const exportColumns: ExportColumn[] = [
  { header: "Tag Name", accessor: "name" },
  { header: "Status", accessor: "isActive" },
];

const TagMaster: React.FC = () => {
  usePageRights("followup-tag-master");
  const queryClient = useQueryClient();

  const { data: tags, isLoading, error } = useQuery({
    queryKey: ["tag-master"],
    queryFn: fetchTags,
    staleTime: 5 * 60 * 1000,
  });

  const mappedData: RecordWithId[] = React.useMemo(() => {
    if (!Array.isArray(tags)) return [];
    return tags.map((item) => ({
      _id: String(item.Id),
      name: item.Name ?? "",
      isActive: Boolean(item.IsActive),
    }));
  }, [tags]);

  const toPayload = (r: Record<string, any>) => ({
    Name: r.name?.trim() || null,
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
        if (!res.ok) throw new Error((await res.json()).error || "Failed to add tag");
        toast.success("Tag added!");
      }
      if (event.action === "update") {
        const res = await fetchWithAuth(`${API}/${event.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(event.record)),
        });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to update tag");
        toast.success("Tag updated!");
      }
      if (event.action === "delete") {
        const res = await fetchWithAuth(`${API}/${event.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error((await res.json()).error || "Failed to delete tag");
        toast.success("Tag deleted!");
      }
      await queryClient.invalidateQueries({ queryKey: ["tag-master"] });
      // The task drawer's tag picker reads from this same active-tags list.
      await queryClient.invalidateQueries({ queryKey: ["tag-master-active"] });
    } catch (err: any) {
      toast.error(err.message || "Operation failed");
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading tags...</div>;
  if (error) return <div className="p-6 text-red-500">Failed to load tags.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Follow-Up", "Setup", "Tag Master"]} />
      <FollowupShell title="Tag Master">
        <MasterPage
          title="Tag"
          fields={fields}
          columns={columns}
          initialData={mappedData}
          onDataEvent={handleDataEvent}
          exportConfig={{
            title: "Tag Master",
            filename: "tag-master",
            columns: exportColumns,
          }}
          viewConfig={{
            title: "Tag Details",
            fields: [
              { key: "name", label: "Tag Name" },
              { key: "isActive", label: "Status" },
            ],
          }}
          onPrint={(row) => {
            const win = window.open("", "_blank", "width=600,height=400");
            if (!win) return;
            win.document.write(safeHtml`
              <html><head><title>Tag — ${row.name}</title>
              <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
              </head><body><h2>Tag</h2><table>
                <tr><td>Tag Name</td><td>${row.name || "—"}</td></tr>
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

export default TagMaster;
