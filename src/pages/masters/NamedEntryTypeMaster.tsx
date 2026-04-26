import React, { useRef, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type FieldDef,
} from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFinYear } from "@/contexts/FinYearContext";
import {
  getEntryTypes,
  addEntryType,
  updateEntryType,
  deleteEntryType,
} from "@/api/entryTypeApi";
import { toast } from "sonner";
import { Tag } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface DbEntryType {
  E_Id: string;
  Epname: string | null;
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
function autoPrefix(projectName: string): string {
  if (!projectName) return "";
  return projectName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function buildDocNumber(
  prefix: string,
  serial: number,
  finYear: string,
): string {
  if (!prefix || !finYear) return "";
  return `${prefix}/${String(serial).padStart(4, "0")}/${finYear}`;
}

function nextSerial(
  allRecords: Record<string, unknown>[],
  prefix: string,
  finYear: string,
  excludeId?: string,
): number {
  const matching = allRecords.filter(
    (r: any) =>
      r.prefix === prefix &&
      r.finYear === finYear &&
      (excludeId ? r._id !== excludeId : true),
  );
  if (matching.length === 0) return 1;
  const maxSerial = Math.max(
    ...matching.map((r: any) => Number(r.serialNumber) || 0),
  );
  return maxSerial + 1;
}

// ── Renderers ─────────────────────────────────────────────────────────────────
function makePrefixRenderer(projectNameRef: React.RefObject<string>) {
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
        ? autoPrefix(projectNameRef.current ?? "")
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
              {m === "auto" ? "Auto (From Initials)" : "Custom"}
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
                customPrefix: e.target.value.toUpperCase(),
              })
            }
            placeholder={
              groupVal.mode === "auto"
                ? "Auto-generated from project initials"
                : "Enter custom prefix"
            }
            className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground
              ${groupVal.mode === "auto" ? "opacity-60 cursor-not-allowed" : ""}
              ${error ? "border-destructive" : "border-border"}`}
          />
        </div>

        {groupVal.mode === "auto" && projectNameRef.current && (
          <p className="text-[11px] text-primary mt-1">
            Generated from:{" "}
            <span className="font-semibold">{projectNameRef.current}</span>
            {resolvedPrefix && (
              <span className="ml-1 text-muted-foreground">
                →{" "}
                <span className="font-bold text-foreground">
                  {resolvedPrefix}
                </span>
              </span>
            )}
          </p>
        )}
      </div>
    );
  };
}

function DocNumberRenderer({ value }: { value: unknown }) {
  const docNum = typeof value === "string" ? value : "";
  return (
    <div className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border text-foreground opacity-60 cursor-not-allowed min-h-[38px] flex items-center">
      {docNum ? (
        <span className="font-mono tracking-wide">{docNum}</span>
      ) : (
        <span className="text-muted-foreground italic">
          Will be generated automatically
        </span>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
const NamedEntryTypeMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const { finYears } = useFinYear();

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

  // Fetch Projects (Fixed 401 + Compatible with MasterPage)
  const {
    data: projectsData = [],
    isLoading: isProjectsLoading,
    error: projectsError,
  } = useQuery({
    queryKey: ["project-master"],
    queryFn: async () => {
      const token =
        localStorage.getItem("token") ||
        localStorage.getItem("accessToken") ||
        localStorage.getItem("authToken");

      if (!token)
        throw new Error("No authentication token found. Please login again.");

      const res = await fetch("/api/project-master", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      if (res.status === 401)
        throw new Error("Session expired. Please login again.");
      if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status}`);

      return res.json() as Promise<Project[]>;
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const dbItems: DbEntryType[] = Array.isArray(dbData) ? dbData : [];

  // Project Options - Now simple strings (MasterPage expects string[])
  const projectOptions = useMemo(() => {
    if (!Array.isArray(projectsData) || projectsData.length === 0) {
      return ["No projects available"];
    }

    return projectsData
      .filter((p: any) => p?.Name || p?.name)
      .map((p: any) => {
        const name = p.Name || p.name || "";
        const code = p.Code || p.code || "";
        return code ? `${code} - ${name}` : name;
      })
      .sort((a, b) => a.localeCompare(b));
  }, [projectsData]);

  const activeFinYearOptions = useMemo(() => {
    return finYears
      .sort((a, b) => b.year.localeCompare(a.year))
      .map((fy) => fy.year);
  }, [finYears]);

  // Mapped Data for Table
  const mappedData = useMemo(() => {
    const currentFinYear = finYears.find((fy) => fy.isActive)?.year || "";

    return dbItems.map((item) => ({
      _id: item.E_Id,
      projectName: item.Epname || "",
      entryType: item.EntryType || "Payment",
      prefix: item.Eprefix || "",
      prefixMode: "auto" as const,
      serialNumber: item.EDoc_N ?? 1,
      finYear: currentFinYear,
      documentNumber: buildDocNumber(
        item.Eprefix || "",
        item.EDoc_N ?? 1,
        currentFinYear,
      ),
      status: true,
    }));
  }, [dbItems, finYears]);

  const projectNameRef = useRef<string>("");
  const PrefixRenderer = useRef(makePrefixRenderer(projectNameRef)).current;

  // ── Payload Builder ───────────────────────────────────────────────────────
  const toPayload = (
    record: Record<string, unknown>,
    allRecords: Record<string, unknown>[],
    isEdit: boolean,
  ) => {
    const projectName = (record.projectName as string) || "";
    const finYear = (record.finYear as string) || "";
    const prefixGroup = record.prefixGroup as PrefixGroupValue | undefined;

    const mode = prefixGroup?.mode ?? "auto";
    const prefixStr =
      mode === "auto"
        ? autoPrefix(projectName)
        : (prefixGroup?.customPrefix ?? "").trim();

    const serial = isEdit
      ? ((record.serialNumber as number) ?? 1)
      : nextSerial(allRecords, prefixStr, finYear);

    return {
      Epname: projectName,
      EntryType: (record.entryType as string) || "Payment",
      Eprefix: prefixStr,
      EDoc_N: serial,
    };
  };

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleDataEvent = async (event: DataChangeEvent) => {
    try {
      if (event.action === "add") {
        await addEntryType(toPayload(event.record, event.records, false));
        toast.success("Entry type added successfully!");
      } else if (event.action === "update") {
        await updateEntryType(
          event.id,
          toPayload(event.record, event.records, true),
        );
        toast.success("Entry type updated successfully!");
      } else if (event.action === "delete") {
        await deleteEntryType(event.id);
        toast.success("Entry type deleted successfully!");
      }
      await queryClient.invalidateQueries({ queryKey: ["entry-types"] });
    } catch (err: any) {
      toast.error(`Operation failed: ${err.message}`);
    }
  };

  const handleFormChange = (
    form: Record<string, unknown>,
    updateForm: (patch: Record<string, unknown>) => void,
    allRecords: Record<string, unknown>[],
  ) => {
    const projectName = (form.projectName as string) || "";
    const finYear = (form.finYear as string) || "";
    const prefixGroup = form.prefixGroup as PrefixGroupValue | undefined;

    projectNameRef.current = projectName;

    const mode = prefixGroup?.mode ?? "auto";
    const prefixStr =
      mode === "auto"
        ? autoPrefix(projectName)
        : (prefixGroup?.customPrefix ?? "").trim();

    const serial = nextSerial(allRecords, prefixStr, finYear);
    const docNum = buildDocNumber(prefixStr, serial, finYear);

    if (form.documentNumber !== docNum) {
      updateForm({ documentNumber: docNum });
    }
  };

  const handleCustomSave = (
    formData: Record<string, unknown>,
    isEdit: boolean,
    allRecords: Record<string, unknown>[],
  ): Record<string, unknown> | null => {
    const projectName = (formData.projectName as string) || "";
    const finYear = (formData.finYear as string) || "";
    const prefixGroup = formData.prefixGroup as PrefixGroupValue | undefined;

    const mode = prefixGroup?.mode ?? "auto";
    const prefixStr =
      mode === "auto"
        ? autoPrefix(projectName)
        : (prefixGroup?.customPrefix ?? "").trim();

    if (!prefixStr) return null;

    const serial = isEdit
      ? ((formData.serialNumber as number) ?? 1)
      : nextSerial(allRecords, prefixStr, finYear);

    return {
      projectName,
      entryType: (formData.entryType as string) || "Payment",
      prefix: prefixStr,
      prefixMode: mode,
      serialNumber: serial,
      finYear,
      documentNumber: buildDocNumber(prefixStr, serial, finYear),
      status: formData.status ?? true,
    };
  };

  // Loading & Error States
  if (isEntryTypesLoading || isProjectsLoading) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[400px] text-muted-foreground">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mb-4" />
        <p>Loading Named Entry Types and Projects...</p>
      </div>
    );
  }

  if (entryTypesError || projectsError) {
    return (
      <div className="p-8 text-red-500 bg-red-50 dark:bg-red-950/30 rounded-xl border border-red-200 mt-8">
        <h2 className="font-semibold mb-2">Failed to Load Data</h2>
        <p>
          {projectsError?.message ||
            entryTypesError?.message ||
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

      <MasterPage
        title="Named Entry Type"
        fields={[
          {
            name: "projectName",
            label: "Project Name",
            type: "select",
            required: true,
            options: projectOptions, // ← Simple string array (Important!)
            placeholder: "Select a project",
          },
          {
            name: "entryType",
            label: "Entry Type",
            type: "select",
            required: true,
            options: ["Received", "Payment"],
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
            name: "finYear",
            label: "Financial Year",
            type: "select",
            required: true,
            options: activeFinYearOptions,
          },
          {
            name: "documentNumber",
            label: "Document Number Preview",
            type: "custom",
            fullWidth: true,
            render: DocNumberRenderer as FieldDef["render"],
          },
          {
            name: "status",
            label: "Status",
            type: "toggle",
            defaultValue: true,
          },
        ]}
        columns={[
          { key: "projectName", label: "Project Name" },
          { key: "entryType", label: "Entry Type" },
          { key: "prefix", label: "Prefix" },
          { key: "finYear", label: "Financial Year", hideOnMobile: true },
          { key: "documentNumber", label: "Document Number" },
          { key: "status", label: "Status" },
        ]}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
        onFormChange={handleFormChange}
        onCustomSave={handleCustomSave}
      />
    </>
  );
};

export default NamedEntryTypeMaster;
