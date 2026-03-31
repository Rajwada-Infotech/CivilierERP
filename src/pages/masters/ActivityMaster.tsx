import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  FieldDef,
  ColumnDef,
  RecordWithId,
} from "@/components/MasterPage";
import { Activity, Layers, Tag } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type ActivityType = "Group" | "Activity";

interface ActivityRecord {
  _id: string;
  activityName: string;
  shortDesc: string;
  shortDescMode: "auto" | "custom";
  activityType: ActivityType;
  groupId: string; // only set when activityType === "Activity"
  groupName: string; // denormalised for display
  status: boolean;
}

interface ShortDescGroup {
  mode: "auto" | "custom";
  customValue: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Extract all Group-type records from the live data array */
function getGroups(allRecords: RecordWithId[]): RecordWithId[] {
  return allRecords.filter((r) => r.activityType === "Group");
}

// ─── Short Description custom renderer ───────────────────────────────────────

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
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-muted-foreground font-heading">
            Mode:
          </span>
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

        <input
          type="text"
          value={resolved}
          readOnly={group.mode === "auto"}
          onChange={(e) =>
            onChange({
              mode: "custom",
              customValue: e.target.value.toUpperCase(),
            })
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

// ─── "Belongs To" group selector — custom renderer ────────────────────────────
// Needs live access to all records so it can list only Group-type entries.
// We get allRecords via a ref that onFormChange keeps updated.

function makeBelongsToRenderer(allRecordsRef: React.RefObject<RecordWithId[]>) {
  return function BelongsToRenderer({
    value,
    onChange,
    error,
  }: {
    value: unknown;
    onChange: (v: unknown) => void;
    error: boolean;
    field: FieldDef;
  }) {
    const groups = getGroups(allRecordsRef.current ?? []);
    const current = (value as string) || "";

    return (
      <div>
        <div className="relative">
          <Layers
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <select
            value={current}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all
              focus:outline-none focus:ring-2 focus:ring-primary text-foreground
              ${error ? "border-destructive" : "border-border"}`}
          >
            <option value="">— Select a group —</option>
            {groups.map((g) => (
              <option key={g._id} value={g._id}>
                {g.activityName as string}
              </option>
            ))}
          </select>
        </div>

        {groups.length === 0 && (
          <p className="text-[11px] text-amber-500 mt-1 flex items-center gap-1">
            <span>⚠</span> No groups yet — add a Group-type record first.
          </p>
        )}
      </div>
    );
  };
}

// ─── Activity Type selector — custom renderer ─────────────────────────────────
// Shows Group / Activity toggle pills. When "Activity" is selected it exposes
// the Belongs To sub-field inline so both feel like one cohesive control.

function makeActivityTypeRenderer(
  allRecordsRef: React.RefObject<RecordWithId[]>,
) {
  return function ActivityTypeRenderer({
    value,
    onChange,
    error,
  }: {
    value: unknown;
    onChange: (v: unknown) => void;
    error: boolean;
    field: FieldDef;
  }) {
    const composite = (value as {
      type: ActivityType;
      groupId: string;
    } | null) ?? {
      type: "Group" as ActivityType,
      groupId: "",
    };

    const groups = getGroups(allRecordsRef.current ?? []);

    const setType = (t: ActivityType) =>
      onChange({ type: t, groupId: t === "Group" ? "" : composite.groupId });

    const setGroup = (id: string) =>
      onChange({ type: "Activity", groupId: id });

    return (
      <div className="space-y-3">
        {/* Type pills */}
        <div className="flex gap-2">
          {(["Group", "Activity"] as const).map((t) => {
            const isSelected = composite.type === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-heading transition-all ${
                  isSelected
                    ? t === "Group"
                      ? "bg-violet-500/10 border-violet-500/40 text-violet-600 dark:text-violet-400 shadow-sm"
                      : "bg-teal-500/10 border-teal-500/40 text-teal-600 dark:text-teal-400 shadow-sm"
                    : "bg-muted border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {t === "Group" ? <Layers size={14} /> : <Tag size={14} />}
                {t}
              </button>
            );
          })}
        </div>

        {/* Belongs To — shown only when Activity is selected */}
        {composite.type === "Activity" && (
          <div className="ml-2 pl-4 border-l-2 border-teal-500/30 space-y-1">
            <label className="block text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
              Belongs To (Group) <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Layers
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
              <select
                value={composite.groupId}
                onChange={(e) => setGroup(e.target.value)}
                className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all
                  focus:outline-none focus:ring-2 focus:ring-primary text-foreground
                  ${error && !composite.groupId ? "border-destructive" : "border-border"}`}
              >
                <option value="">— Select a group —</option>
                {groups.map((g) => (
                  <option key={g._id} value={g._id}>
                    {g.activityName as string}
                  </option>
                ))}
              </select>
            </div>
            {groups.length === 0 && (
              <p className="text-[11px] text-amber-500 flex items-center gap-1">
                <span>⚠</span> No groups yet — save a Group-type record first.
              </p>
            )}
            {error && composite.type === "Activity" && !composite.groupId && (
              <p className="text-[11px] text-destructive">
                Please select a group.
              </p>
            )}
          </div>
        )}
      </div>
    );
  };
}

// ─── Column renderers ─────────────────────────────────────────────────────────

function typeColumnRenderer(value: unknown) {
  const v = String(value || "");
  const isGroup = v === "Group";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-heading border ${
        isGroup
          ? "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400"
          : "bg-teal-500/10 border-teal-500/20 text-teal-600 dark:text-teal-400"
      }`}
    >
      {isGroup ? <Layers size={10} /> : <Tag size={10} />}
      {v || "—"}
    </span>
  );
}

function nameColumnRenderer(
  value: unknown,
  row: RecordWithId,
  data: RecordWithId[],
) {
  const name = String(value || "");
  const isGroup = row.activityType === "Group";
  const groupId = row.groupId as string | undefined;
  const group = groupId ? data.find((r) => r._id === groupId) : null;

  return (
    <div className="flex flex-col">
      <span
        className={`text-sm ${isGroup ? "font-semibold text-foreground" : "text-foreground"}`}
      >
        {isGroup ? (
          ""
        ) : (
          <span className="inline-block w-4 mr-1 text-muted-foreground/40">
            └
          </span>
        )}
        {name}
      </span>
      {!isGroup && group && (
        <span className="text-[10px] text-muted-foreground ml-5">
          {group.activityName as string}
        </span>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const ActivityMaster: React.FC = () => {
  const nameRef = React.useRef<string>("");
  const allRecordsRef = React.useRef<RecordWithId[]>([]);

  const ShortDescRenderer = React.useRef(
    makeShortDescRenderer(nameRef),
  ).current;
  const ActivityTypeRenderer = React.useRef(
    makeActivityTypeRenderer(allRecordsRef),
  ).current;

  // ── Field definitions ──────────────────────────────────────────────────────
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
      // Single composite field — handles both type pill and Belongs To sub-select
      name: "activityTypeGroup",
      label: "Activity Type",
      type: "custom",
      required: true,
      fullWidth: false,
      render: ActivityTypeRenderer as FieldDef["render"],
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
    { key: "groupName", label: "Group", hideOnMobile: true },
    { key: "status", label: "Status" },
  ];

  // ── onFormChange — keep refs in sync ──────────────────────────────────────
  const handleFormChange = (
    form: Record<string, unknown>,
    updateForm: (patch: Record<string, unknown>) => void,
    allRecords: Record<string, unknown>[],
  ) => {
    // Sync name ref for short-desc auto generation
    const name = (form.activityName as string) || "";
    nameRef.current = name;

    // Sync records ref so the type renderer can list live groups
    allRecordsRef.current = allRecords as RecordWithId[];

    // Force re-render when name changes so auto short-desc updates
    const sdGroup = form.shortDescGroup as ShortDescGroup | undefined;
    if ((sdGroup?.mode ?? "auto") === "auto") {
      updateForm({ _nameSync: name });
    }
  };

  // ── onCustomSave — flatten composite fields into scalar record fields ──────
  const handleCustomSave = (
    formData: Record<string, unknown>,
    _isEdit: boolean,
    allRecords: Record<string, unknown>[],
  ): Record<string, unknown> | null => {
    const name = (formData.activityName as string) || "";
    if (!name) return null;

    // Resolve short description
    const sdGroup = formData.shortDescGroup as ShortDescGroup | undefined;
    const sdMode = sdGroup?.mode ?? "auto";
    const shortDesc =
      sdMode === "auto"
        ? autoShortDesc(name)
        : (sdGroup?.customValue ?? "").trim();

    // Resolve activity type + group
    const typeGroup = formData.activityTypeGroup as
      | { type: ActivityType; groupId: string }
      | undefined;
    const activityType: ActivityType = typeGroup?.type ?? "Group";
    const groupId =
      activityType === "Activity" ? (typeGroup?.groupId ?? "") : "";

    // Activity type must have a group selected
    if (activityType === "Activity" && !groupId) return null;

    // Resolve group name for display
    const groupRecord = groupId
      ? (allRecords as RecordWithId[]).find((r) => r._id === groupId)
      : null;
    const groupName = groupRecord ? (groupRecord.activityName as string) : "";

    return {
      activityName: name,
      shortDesc,
      shortDescMode: sdMode,
      activityType,
      groupId,
      groupName,
      status: formData.status ?? true,
    };
  };

  // ── Column renderers ───────────────────────────────────────────────────────
  const columnRenderers: Record<
    string,
    (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode
  > = {
    activityName: nameColumnRenderer,
    activityType: typeColumnRenderer,
    shortDesc: (value) => (
      <span className="font-mono text-xs tracking-wide text-muted-foreground">
        {String(value || "—")}
      </span>
    ),
    groupName: (value, row) => {
      if (row.activityType !== "Activity") {
        return <span className="text-muted-foreground text-xs">—</span>;
      }
      return (
        <span className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400">
          <Layers size={11} />
          {String(value || "—")}
        </span>
      );
    },
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
