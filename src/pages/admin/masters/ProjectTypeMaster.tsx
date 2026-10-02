import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import {
  MasterPage,
  type DataChangeEvent,
  type RecordWithId,
  type FieldDef,
} from "@/components/MasterPage";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/project-type-master";

// A project type is defined by its BEHAVIOUR FLAGS, not its name. Everything in
// CRM branches on these four — the auto-setup path, the unit matrix view, how
// GST is charged and which income head a sale credits — and never on the Code
// or Name. That is what lets a type added on this screen work immediately,
// without a code change or a deploy.
const fields: FieldDef[] = [
  { name: "Name", label: "Type Name", type: "text", required: true },
  {
    name: "Code",
    label: "Code",
    type: "text",
    required: true,
    uppercase: true,
    placeholder: "e.g. ROW_HOUSING",
  },
  { name: "Description", label: "Description", type: "text", fullWidth: true },
  {
    name: "HasFloors",
    label: "Units stack on floors",
    type: "toggle",
    defaultValue: true,
  },
  {
    name: "SellsLand",
    label: "Sells land (outside GST)",
    type: "toggle",
    defaultValue: false,
  },
  {
    name: "SellsConstruction",
    label: "Sells construction (taxable)",
    type: "toggle",
    defaultValue: true,
  },
  {
    name: "AllowsMultiUnitSale",
    label: "Several units per booking",
    type: "toggle",
    defaultValue: false,
  },
  { name: "SortOrder", label: "Sort Order", type: "number", defaultValue: "100" },
  { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "Name", label: "Type Name" },
  { key: "Code", label: "Code" },
  { key: "HasFloors", label: "Floors" },
  { key: "SellsLand", label: "Land", hideOnMobile: true },
  { key: "SellsConstruction", label: "Construction", hideOnMobile: true },
  { key: "AllowsMultiUnitSale", label: "Multi-unit", hideOnMobile: true },
  { key: "UsedBy", label: "In Use" },
  { key: "IsActive", label: "Status" },
];

async function fetchProjectTypes(): Promise<RecordWithId[]> {
  const res = await fetchWithAuth(API);
  if (!res.ok) throw new Error("Failed to load project types");
  const data = await res.json().catch(() => []);
  return (Array.isArray(data) ? data : []).map((r: any) => ({
    ...r,
    id: r.Id,
    // Surfaced so it is obvious BEFORE trying to delete why a type is locked —
    // the API refuses to remove one that projects or blocks still point at.
    UsedBy:
      r.ProjectCount || r.BlockCount
        ? `${r.ProjectCount} project(s), ${r.BlockCount} block(s)`
        : "—",
  }));
}

const ProjectTypeMaster: React.FC = () => {
  const rights = usePageRights("project-type-master");
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["project-type-master"],
    queryFn: fetchProjectTypes,
    staleTime: 5 * 60 * 1000,
  });

  const handleChange = async (e: DataChangeEvent) => {
    try {
      if (e.action === "add") {
        const res = await fetchWithAuth(API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(e.record),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to create project type");
        toast.success("Project type created");
      } else if (e.action === "update") {
        const res = await fetchWithAuth(`${API}/${e.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(e.record),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to update project type");
        toast.success("Project type updated");
      } else if (e.action === "delete") {
        const res = await fetchWithAuth(`${API}/${e.id}`, { method: "DELETE" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to remove project type");
        toast.success("Project type removed");
      }
      // Both caches matter: this list, and the dropdown Project Master reads.
      queryClient.invalidateQueries({ queryKey: ["project-type-master"] });
      queryClient.invalidateQueries({ queryKey: ["project-master"] });
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
    }
  };

  return (
    <>
      <Breadcrumbs items={["Masters", "Project Type"]} />
      <MasterPage
        title="Project Type"
        canCreate={rights.canCreate}
        canEdit={rights.canEdit}
        canDelete={rights.canDelete}
        fields={fields}
        columns={columns}
        initialData={rows}
        loading={isLoading}
        onDataEvent={handleChange}
        viewConfig={{
          title: "Project Type",
          fields: [
            { key: "Name", label: "Type Name" },
            { key: "Code", label: "Code" },
            { key: "Description", label: "Description" },
            { key: "HasFloors", label: "Units stack on floors" },
            { key: "SellsLand", label: "Sells land (outside GST)" },
            { key: "SellsConstruction", label: "Sells construction (taxable)" },
            { key: "AllowsMultiUnitSale", label: "Several units per booking" },
            { key: "UsedBy", label: "In use by" },
            { key: "IsActive", label: "Status" },
          ],
        }}
      />
    </>
  );
};

export default ProjectTypeMaster;
