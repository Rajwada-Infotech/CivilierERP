import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
// One behaviour switch: a square on / off key with what it means underneath. The shared toggle would label every
// switch "Active" / "Inactive" ("Sells land — Inactive"), which is wrong for a yes / no question.
const flag = (name: string, title: string, hint: string, defaultValue: boolean): FieldDef => ({
  name, label: "", type: "custom", defaultValue,
  render: ({ value, onChange }) => (
    <button type="button" role="switch" aria-checked={!!value} onClick={() => onChange(!value)}
      className="w-full flex items-start gap-3 px-3 py-2.5 text-left border border-foreground/30 hover:border-foreground transition-colors bg-card">
      <span className={`mt-0.5 relative h-4 w-7 shrink-0 border border-foreground transition-colors ${value ? "bg-foreground" : "bg-card"}`}>
        <span className={`absolute top-[2px] h-2.5 w-2.5 transition-all ${value ? "left-[14px] bg-card" : "left-[2px] bg-foreground"}`} />
      </span>
      <span className="min-w-0">
        <span className="flex items-baseline gap-2">
          <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-foreground">{title}</span>
          <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{value ? "Yes" : "No"}</span>
        </span>
        <span className="block mt-0.5 text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  ),
});

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
  flag("HasFloors", "Units stack on floors", "Tower: block › floor › flat. Off = plots on a site map.", true),
  flag("SellsLand", "Sells land", "Plots may be booked — no GST on land.", false),
  flag("SellsConstruction", "Sells construction", "Flats / villas may be booked — GST applies.", true),
  flag("AllowsMultiUnitSale", "Several units per booking", "Off = one unit per booking.", false),
  flag("SellsResidential", "Sells residential", "Flats / villas whose kind isn't commercial.", true),
  flag("SellsCommercial", "Sells commercial", "Shops / offices (kinds marked commercial).", false),
  { name: "SortOrder", label: "Sort Order", type: "number", defaultValue: "100" },
  { name: "IsActive", label: "Status", type: "toggle", defaultValue: true },
];

const columns = [
  { key: "Name", label: "Type Name" },
  { key: "Code", label: "Code" },
  { key: "Behaviour", label: "What it does", sortable: false },
  { key: "UsedBy", label: "Used By" },
  { key: "StatusText", label: "Status" },
];

const RULE = "1px solid hsl(var(--foreground))";
const yesNo = (v: unknown) => (v ? "Yes" : "No");
// One readable line from the flags — the same flags booking and auto-setup
// act on, so this is exactly what the system will do for the type.
const behaviour = (r: any) =>
  [
    r.HasFloors ? "Tower (floors)" : "Site map (plots)",
    [r.SellsLand && "land (no GST)", r.SellsConstruction && "construction (GST)"].filter(Boolean).join(" + ") || "sells nothing",
    [r.SellsResidential && "residential", r.SellsCommercial && "commercial"].filter(Boolean).join(" + ") || "no usage",
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
    StatusText: r.IsActive ? "Active" : "Inactive",
    FloorsText: yesNo(r.HasFloors),
    LandText: yesNo(r.SellsLand),
    ConstructionText: yesNo(r.SellsConstruction),
    MultiText: yesNo(r.AllowsMultiUnitSale),
    ResidentialText: yesNo(r.SellsResidential),
    CommercialText: yesNo(r.SellsCommercial),
  }));
}

const ProjectTypeMaster: React.FC = () => {
  const rights = usePageRights("project-type-master");
  const queryClient = useQueryClient();

  const { data: rows = [], isLoading, isError, error } = useQuery({
    // Its own key: Project Master and Auto Setup cache only the active types, unmapped, under ["project-type-master"],
    // and this page read their copy (no row ids, no "Used by") when opened after them. Their prefix invalidations
    // still refresh this one.
    queryKey: ["project-type-master", "all"],
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
      <SheetShell
        eyebrow="CivilierERP · Masters"
        title="Project types"
        subtitle="What a kind of project is: towers or plots, whether it sells land, construction or both, residential or commercial, and how many units a booking may hold. CRM follows these switches, never the name."
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Types", value: rows.length, note: "in all" },
              { label: "Active", value: rows.filter((r) => r.IsActive).length, note: "offered for projects and blocks" },
              { label: "In use", value: rows.filter((r) => r.ProjectCount || r.BlockCount).length, note: "set on a project or block" },
              { label: "Inactive", value: rows.filter((r) => !r.IsActive).length, note: "kept on old records" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>
        {/* A failed load used to show an empty list, as if no types existed. */}
        {isError && (
          <div className="px-4 py-2.5 text-xs text-destructive bg-card" style={{ border: "1px solid hsl(var(--destructive))" }}>
            {(error as Error)?.message || "Failed to load project types"}
          </div>
        )}
        <MasterPage
          title="Project Type"
          canCreate={rights.canCreate}
          canEdit={rights.canEdit}
          canDelete={rights.canDelete}
          fields={fields}
          columns={columns}
          columnRenderers={{
            Code: (v) => <span className="font-heading text-xs font-semibold tabular-nums">{String(v ?? "")}</span>,
            Behaviour: (v) => <span className="text-xs text-muted-foreground">{String(v ?? "")}</span>,
            UsedBy: (v, r) => (r.ProjectCount || r.BlockCount)
              ? <span className="text-xs">{String(v)}</span>
              : <span className="text-xs text-muted-foreground">{String(v)}</span>,
            StatusText: (_v, r) => <SheetMark text={r.IsActive ? "Active" : "Inactive"} tone={r.IsActive ? "done" : "draft"} />,
          }}
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
              { key: "ResidentialText", label: "Sells residential" },
              { key: "CommercialText", label: "Sells commercial" },
              { key: "UsedBy", label: "Used by" },
              { key: "StatusText", label: "Status" },
            ],
          }}
        />
      </SheetShell>
    </>
  );
};

export default ProjectTypeMaster;
