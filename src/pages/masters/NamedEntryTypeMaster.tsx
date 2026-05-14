import React, { useRef, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type FieldDef,
} from "@/components/MasterPage";
import type { ExportColumn } from "@/lib/export";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getEntryTypes,
  addEntryType,
  updateEntryType,
  deleteEntryType,
  getProjects,
} from "@/api/entryTypeApi";
import { getMenuMasters } from "@/api/menuMasterApi";
import { toast } from "sonner";
import { Tag } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DbEntryType {
  E_Id: string | number | null;
  project_id: number | null; // FK referencing enterprise.id
  Epname: string | null; // resolved via JOIN at read time
  EntryType: string | null;
  Eprefix: string | null;
  EDoc_N: number | null;
}

interface Project {
  Id?: number | string;
  Name?: string;
  name?: string;
  Code?: string;
  code?: string;
}

interface PrefixGroupValue {
  mode: "auto" | "custom";
  customPrefix: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getProjectTwoInitials(projectName: string): string {
  if (!projectName) return "XX";

  const cleaned = projectName
    .replace(/[^a-zA-Z]/g, "") // Remove everything except letters
    .trim()
    .toUpperCase();

  return cleaned.length >= 2 ? cleaned.slice(0, 2) : cleaned.padEnd(2, "X");
}

function getEntryTypeThreeLetters(entryType: string): string {
  if (!entryType) return "XXX";
  return entryType
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3)
    .padEnd(3, "X");
}

function buildAutoPrefix(projectName: string, entryType: string): string {
  const proj = getProjectTwoInitials(projectName);
  const etype = getEntryTypeThreeLetters(entryType);
  return `${proj}/${etype}`;
}

// ── Prefix Renderer ───────────────────────────────────────────────────────────
function makePrefixRenderer(
  projectNameRef: React.RefObject<string>,
  entryTypeRef: React.RefObject<string>,
) {
  return function PrefixFieldRenderer({
    value,
    onChange,
    error,
  }: {
    value: PrefixGroupValue | "";
    onChange: (v: PrefixGroupValue) => void;
    error: boolean;
  }) {
    const groupVal: PrefixGroupValue =
      value && typeof value === "object"
        ? value
        : { mode: "auto", customPrefix: "" };

    const resolvedPrefix =
      groupVal.mode === "auto"
        ? buildAutoPrefix(
            projectNameRef.current ?? "",
            entryTypeRef.current ?? "",
          )
        : groupVal.customPrefix;

    return (
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-muted-foreground font-heading">
            Mode:
          </span>
          {(["auto", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() =>
                onChange({ mode: m, customPrefix: groupVal.customPrefix })
              }
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-heading border transition-all ${
                groupVal.mode === m
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border hover:border-primary"
              }`}
            >
              {m === "auto" ? "Auto (2+3 Letters)" : "Custom"}
            </button>
          ))}
        </div>

        <div className="relative">
          <Tag
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={resolvedPrefix}
            readOnly={groupVal.mode === "auto"}
            onChange={(e) =>
              onChange({
                mode: "custom",
                customPrefix: e.target.value.toUpperCase().trim(),
              })
            }
            placeholder={
              groupVal.mode === "auto"
                ? "Auto-generated"
                : "Enter custom prefix"
            }
            className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground
              ${groupVal.mode === "auto" ? "opacity-60 cursor-not-allowed" : ""}
              ${error ? "border-destructive" : "border-border"}`}
          />
        </div>

        {groupVal.mode === "auto" && (
          <p className="text-[11px] text-primary mt-1">
            From:{" "}
            <span className="font-semibold">
              {projectNameRef.current || "—"}
            </span>
            {" → "}
            <span className="font-mono font-bold text-foreground">
              {resolvedPrefix}
            </span>
          </p>
        )}
      </div>
    );
  };
}

// ── Main Component ────────────────────────────────────────────────────────────
const NamedEntryTypeMaster: React.FC = () => {
  const queryClient = useQueryClient();

  const projectNameRef = useRef<string>("");
  const entryTypeRef = useRef<string>("");

  // Fetch Entry Types
  const {
    data: dbData,
    isLoading: isEntryTypesLoading,
    error: entryTypesError,
  } = useQuery({
    queryKey: ["entry-types"],
    queryFn: getEntryTypes,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch Projects from enterprise (business_type = 'P') via /api/entry-type/projects
  const {
    data: projectsData = [],
    isLoading: isProjectsLoading,
    error: projectsError,
  } = useQuery({
    queryKey: ["entry-type-projects"],
    queryFn: getProjects,
    staleTime: 10 * 60 * 1000,
  });

  // Fetch Menu Master entries (for Entry Type dropdown)
  const { data: menuMasterData = [], isLoading: isMenuLoading } = useQuery({
    queryKey: ["menuMaster"],
    queryFn: getMenuMasters,
    staleTime: 5 * 60 * 1000,
  });

  const dbItems: DbEntryType[] = Array.isArray(dbData) ? dbData : [];

  // projectsData: [{ id: number, name: string }]
  const projectMap = useMemo(() => {
    const m = new Map<number, string>();
    if (Array.isArray(projectsData)) {
      projectsData.forEach((p: any) => {
        if (p?.id && p?.name) m.set(p.id, p.name);
      });
    }
    return m;
  }, [projectsData]);

  const projectOptions = useMemo(() => {
    if (!Array.isArray(projectsData) || projectsData.length === 0) return [];
    return projectsData
      .filter((p: any) => p?.id && p?.name)
      .map((p: any) => ({ value: String(p.id), label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projectsData]);

  // Entry type options come exclusively from Menu Master — no hardcoded fallback.
  // If Menu Master is empty, the dropdown will be empty and the user must add
  // entries via the Menu Master page first.
  const entryTypeOptions = useMemo(() => {
    if (!Array.isArray(menuMasterData)) return [];
    return menuMasterData.map((m: any) => m?.Name).filter(Boolean) as string[];
  }, [menuMasterData]);

  const mappedData = useMemo(() => {
    return dbItems.map((item) => ({
      _id: String(item.E_Id || ""),
      project_id: String(item.project_id ?? ""), // FK stored/sent to backend
      projectName: item.Epname || "", // resolved at read time via JOIN
      entryType: item.EntryType || "",
      prefix: item.Eprefix || "",
      prefixMode: "auto" as const,
      status: true,
    }));
  }, [dbItems]);

  const PrefixRenderer = useRef(
    makePrefixRenderer(projectNameRef, entryTypeRef),
  ).current;

  // ── Payload Builder ───────────────────────────────────────────────────────
  const toPayload = (record: Record<string, unknown>) => {
    const project_id = Number(record.project_id); // FK — what we persist
    const projectName =
      (record.projectName as string) || projectMap.get(project_id) || "";
    const entryType = (record.entryType as string) || "";
    const prefixGroup = record.prefixGroup as PrefixGroupValue | undefined;

    const mode = prefixGroup?.mode ?? "auto";
    const prefixStr =
      mode === "auto"
        ? buildAutoPrefix(projectName, entryType)
        : (prefixGroup?.customPrefix ?? "").trim();

    return {
      project_id, // ✅ FK stored, not the name string
      EntryType: entryType,
      Eprefix: prefixStr,
      EDoc_N: 1,
    };
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDataEvent = async (event: DataChangeEvent) => {
    console.log("Event:", event.action, "ID:", event.id);
    try {
      if (event.action === "add") {
        await addEntryType(toPayload(event.record));
        toast.success("Entry type added successfully!");
      } else if (event.action === "update") {
        await updateEntryType(event.id, toPayload(event.record));
        toast.success("Entry type updated successfully!");
      } else if (event.action === "delete") {
        await deleteEntryType(event.id);
        toast.success("Entry type deleted successfully!");
      }
      await queryClient.invalidateQueries({ queryKey: ["entry-types"] });
    } catch (err: any) {
      console.error("Full error:", err);
      toast.error(`Operation failed: ${err.message}`);
    }
  };

  const handleFormChange = (
    form: Record<string, unknown>,
    updateForm: (patch: Record<string, unknown>) => void,
  ) => {
    const project_id = Number(form.project_id);
    const projectName =
      projectMap.get(project_id) || (form.projectName as string) || "";
    const entryType = (form.entryType as string) || "";

    projectNameRef.current = projectName;
    entryTypeRef.current = entryType;

    if (form.projectName !== projectName) {
      updateForm({ projectName });
    }

    const prefixGroup = form.prefixGroup as PrefixGroupValue | undefined;
    if (prefixGroup?.mode === "auto") {
      const newPrefix = buildAutoPrefix(projectName, entryType);
      if (form.prefix !== newPrefix) {
        updateForm({ prefix: newPrefix });
      }
    }
  };

  const handleCustomSave = (
    formData: Record<string, unknown>,
  ): Record<string, unknown> | null => {
    const project_id = Number(formData.project_id);
    const projectName =
      projectMap.get(project_id) || (formData.projectName as string) || "";
    const entryType = (formData.entryType as string) || "";
    const prefixGroup = formData.prefixGroup as PrefixGroupValue | undefined;

    const mode = prefixGroup?.mode ?? "auto";
    const prefixStr =
      mode === "auto"
        ? buildAutoPrefix(projectName, entryType)
        : (prefixGroup?.customPrefix ?? "").trim();

    if (!prefixStr || !project_id) return null;

    return {
      project_id,
      projectName,
      entryType,
      prefix: prefixStr,
      prefixMode: mode,
      status: formData.status ?? true,
    };
  };

  if (isEntryTypesLoading || isProjectsLoading || isMenuLoading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mb-4" />
        <p>Loading Named Entry Types...</p>
      </div>
    );
  }

  if (entryTypesError || projectsError) {
    return (
      <div className="p-8 text-red-500 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 mt-8">
        <h2 className="font-semibold mb-2">Failed to Load Data</h2>
        <p>
          {(projectsError || entryTypesError)?.message ||
            "Unknown error occurred"}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-5 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Named Entry Type Master"]}
      />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Named Entry Type Master
      </h1>

      {entryTypeOptions.length === 0 && (
        <div className="mb-4 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-sm font-heading">
          No entry types found in Menu Master. Add entries via{" "}
          <strong>Admin → Menu Master</strong> before creating named entry
          types.
        </div>
      )}

      <MasterPage
        title="Named Entry Type"
        fields={[
          {
            name: "project_id",
            label: "Project",
            type: "select",
            required: true,
            optionsProvider: () => projectOptions,
            placeholder: "Select a project",
          },
          {
            name: "entryType",
            label: "Entry Type",
            type: "select",
            required: true,
            options: entryTypeOptions,
            placeholder:
              entryTypeOptions.length === 0
                ? "No entry types — add via Menu Master"
                : "Select entry type",
          },
          {
            name: "prefixGroup",
            label: "Prefix",
            type: "custom",
            required: true,
            defaultValue: { mode: "auto", customPrefix: "" },
            render: PrefixRenderer as FieldDef["render"],
          },
          {
            name: "status",
            label: "Status",
            type: "toggle",
            defaultValue: true,
          },
        ]}
        columns={[
          { key: "projectName", label: "Project" },
          { key: "entryType", label: "Entry Type" },
          { key: "prefix", label: "Prefix" },
          { key: "status", label: "Status" },
        ]}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        onFormChange={handleFormChange}
        onCustomSave={handleCustomSave}
        exportConfig={{
          title: "Named Entry Type Master",
          filename: "named-entry-type-master",
          columns: [
            { header: "Project", accessor: "projectName" },
            { header: "Entry Type", accessor: "entryType" },
            { header: "Prefix", accessor: "prefix" },
            { header: "Status", accessor: "status" },
          ],
        }}
      />
    </>
  );
};

export default NamedEntryTypeMaster;
