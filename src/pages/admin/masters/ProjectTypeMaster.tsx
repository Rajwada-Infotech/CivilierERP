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
    label: "Units stack on floors (tower: block › floor › flat) — off = plots on a site map",
    type: "toggle",
    defaultValue: true,
  },
  {
    name: "SellsLand",
    label: "Sells land — plots allowed on bookings (no GST)",
    type: "toggle",
    defaultValue: false,
  },
  {
    name: "SellsConstruction",
    label: "Sells construction — flats / villas allowed on bookings (GST)",
    type: "toggle",
    defaultValue: true,
  },
  {
    name: "AllowsMultiUnitSale",
    label: "Several units per booking — off = one unit per booking",
    type: "toggle",
    defaultValue: false,
  },
  { name: "SortOrder", label: "Sort Order", type: "number", defaultValue: "100" },
  { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "Name", label: "Type Name" },
  { key: "Code", label: "Code" },
  { key: "Behaviour", label: "What it does", sortable: false },
  { key: "UsedBy", label: "Used By" },
  { key: "IsActive", label: "Status" },
];

const yesNo = (v: unknown) => (v ? "Yes" : "No");
// One readable line from the flags — the same flags booking and auto-setup
// act on, so this is exactly what the system will do for the type.
const behaviour = (r: any) =>
  [
    r.HasFloors ? "Tower (floors)" : "Site map (plots)",
    [r.SellsLand && "land (no GST)", r.SellsConstruction && "construction (GST)"].filter(Boolean).join(" + ") || "sells nothing",
    r.AllowsMultiUnitSale ? "many units / booking" : "1 unit / booking",
  ].join(" · ");

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
        ? [r.ProjectNames, r.BlockCount ? `${r.BlockCount} block(s)` : ""].filter(Boolean).join(" · ")
        : "Not used yet",
    Behaviour: behaviour(r),
    FloorsText: yesNo(r.HasFloors),
    LandText: yesNo(r.SellsLand),
    ConstructionText: yesNo(r.SellsConstruction),
    MultiText: yesNo(r.AllowsMultiUnitSale),
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
            { key: "Behaviour", label: "What it does" },
            { key: "FloorsText", label: "Units stack on floors" },
            { key: "LandText", label: "Sells land (no GST)" },
            { key: "ConstructionText", label: "Sells construction (GST)" },
            { key: "MultiText", label: "Several units per booking" },
            { key: "UsedBy", label: "Used by" },
            { key: "IsActive", label: "Status" },
          ],
        }}
      />
    </>
  );
};

export default ProjectTypeMaster;
