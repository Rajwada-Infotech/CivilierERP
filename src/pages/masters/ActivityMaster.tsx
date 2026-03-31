import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, ColumnDef, RecordWithId } from "@/components/MasterPage";
import { Activity } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Auto-generates a short description from the activity name.
 * Takes up to 3 words, abbreviates each to its first 3 letters (uppercase),
 * and joins with "-".  E.g. "Site Inspection Visit" → "SIT-INS-VIS"
 */
function autoShortDesc(name: string): string {
  if (!name.trim()) return "";
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.slice(0, 3).toUpperCase())
    .join("-");
}

// ─── Short Description renderer ───────────────────────────────────────────────

interface ShortDescGroup {
  mode: "auto" | "custom";
  customValue: string;
}

function makeShortDescRenderer(nameRef: React.RefObject<string>) {
  return function ShortDescRenderer({
    value,
    onChange,
    error,
  }: {
    value: unknown;
    onChange: (v: unknown) => void;
    error: boolean;
    field: FieldDef;
  }) {
    const group: ShortDescGroup =
      value && typeof value === "object"
        ? (value as ShortDescGroup)
        : { mode: "auto", customValue: "" };

    const resolved =
      group.mode === "auto"
        ? autoShortDesc(nameRef.current ?? "")
        : group.customValue;

    const switchMode = (m: "auto" | "custom") =>
      onChange({ mode: m, customValue: group.customValue });

    return (
      <div>
        {/* Mode pills */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-muted-foreground font-heading">Mode:</span>
          {(["auto", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-heading border transition-all ${
                group.mode === m
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border hover:border-primary"
              }`}
            >
              {m === "auto" ? "Auto" : "Custom"}
            </button>
          ))}
        </div>

        {/* Input */}
        <input
          type="text"
          value={resolved}
          readOnly={group.mode === "auto"}
          onChange={(e) =>
            onChange({ mode: "custom", customValue: e.target.value.toUpperCase() })
          }
          placeholder={
            group.mode === "auto"
              ? "Auto-generated from activity name"
              : "Enter short description"
          }
          className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all
            focus:outline-none focus:ring-2 focus:ring-primary text-foreground font-mono tracking-wide
            ${group.mode === "auto" ? "opacity-60 cursor-not-allowed" : ""}
            ${error ? "border-destructive" : "border-border"}`}
        />

        {group.mode === "auto" && nameRef.current && resolved && (
          <p className="text-[11px] text-primary mt-1">
            Generated from:{" "}
            <span className="font-semibold">{nameRef.current}</span>
            <span className="text-muted-foreground ml-1">
              → <span className="font-bold text-foreground">{resolved}</span>
            </span>
          </p>
        )}
      </div>
    );
  };
}

// ─── Type badge column renderer ───────────────────────────────────────────────

function typeRenderer(value: unknown) {
  const v = String(value || "");
  const isGroup = v === "Group";
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-heading border ${
        isGroup
          ? "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400"
          : "bg-teal-500/10 border-teal-500/20 text-teal-600 dark:text-teal-400"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full mr-1.5 ${isGroup ? "bg-violet-500" : "bg-teal-500"}`}
      />
      {v || "—"}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const ActivityMaster: React.FC = () => {
  const nameRef = React.useRef<string>("");
  const ShortDescRenderer = React.useRef(makeShortDescRenderer(nameRef)).current;

  const fields: FieldDef[] = [
    {
      name: "activityName",
      label: "Activity Name",
      type: "text",
      required: true,
    },
    {
      name: "shortDescGroup",
      label: "Short Description",
      type: "custom",
      required: true,
      render: ShortDescRenderer as FieldDef["render"],
    },
    {
      name: "activityType",
      label: "Activity Type",
      type: "select",
      required: true,
      options: ["Group", "Solo"],
    },
    {
      name: "status",
      label: "Status",
      type: "toggle",
      defaultValue: true,
    },
  ];

  const columns: ColumnDef[] = [
    { key: "activityName", label: "Activity Name" },
    { key: "shortDesc", label: "Short Desc" },
    { key: "activityType", label: "Type" },
    { key: "status", label: "Status" },
  ];

  // Sync nameRef on every form change so the auto renderer stays reactive
  const handleFormChange = (
    form: Record<string, unknown>,
    updateForm: (patch: Record<string, unknown>) => void,
  ) => {
    const name = (form.activityName as string) || "";
    nameRef.current = name;

    const group = form.shortDescGroup as ShortDescGroup | undefined;
    const mode = group?.mode ?? "auto";
    if (mode === "auto") {
      // Force a re-render by patching a transient key — the renderer reads the ref
      updateForm({ _nameSync: name });
    }
  };

  // Flatten shortDescGroup → shortDesc before saving
  const handleCustomSave = (
    formData: Record<string, unknown>,
  ): Record<string, unknown> | null => {
    const name = (formData.activityName as string) || "";
    const group = formData.shortDescGroup as ShortDescGroup | undefined;
    const mode = group?.mode ?? "auto";
    const shortDesc =
      mode === "auto" ? autoShortDesc(name) : (group?.customValue ?? "").trim();

    if (!name) return null;

    return {
      activityName: name,
      shortDesc,
      shortDescMode: mode,
      activityType: (formData.activityType as string) || "Solo",
      status: formData.status ?? true,
    };
  };

  const columnRenderers: Record<
    string,
    (value: unknown, row: RecordWithId) => React.ReactNode
  > = {
    activityType: typeRenderer,
    shortDesc: (value) => (
      <span className="font-mono text-xs tracking-wide text-muted-foreground">
        {String(value || "—")}
      </span>
    ),
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Activity Master"]} />

      <div className="flex items-center gap-3 mb-4">
        <Activity className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-heading font-bold text-foreground">
          Activity Master
        </h1>
      </div>

      <MasterPage
        title="Activity"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={[]}
        onFormChange={handleFormChange}
        onCustomSave={handleCustomSave}
      />
    </>
  );
};

export default ActivityMaster;
