import React, { useRef } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useFinYear } from "@/contexts/FinYearContext";
import { MasterPage, FieldDef } from "@/components/MasterPage";
import { Tag } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type EntryType = "Received" | "Payment";

interface NamedEntryTypeRecord {
  _id: string;
  projectName: string;
  entryType: EntryType;
  prefix: string;
  prefixMode: "auto" | "custom";
  serialNumber: number;
  finYear: string;
  documentNumber: string;
  status: boolean;
}

interface PrefixGroupValue {
  mode: "auto" | "custom";
  customPrefix: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT_OPTIONS = [
  "Civilier Infrastructure Pvt Ltd",
  "Apex Constructions Ltd",
  "SiteCraft Engineers",
  "Raj Builders & Co",
  "Metro Rail Project",
];

const SEED: Omit<NamedEntryTypeRecord, "_id">[] = [
  {
    projectName: "Civilier Infrastructure Pvt Ltd",
    entryType: "Payment",
    prefix: "CIPL",
    prefixMode: "auto",
    serialNumber: 1,
    finYear: "2024-25",
    documentNumber: "CIPL/0001/2024-25",
    status: true,
  },
  {
    projectName: "Apex Constructions Ltd",
    entryType: "Received",
    prefix: "ACL",
    prefixMode: "auto",
    serialNumber: 1,
    finYear: "2024-25",
    documentNumber: "ACL/0001/2024-25",
    status: true,
  },
];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Derives the prefix from the project name by taking the first letter of each
 * word (uppercased). E.g. "Civilier Infrastructure Pvt Ltd" → "CIPL".
 */
function autoPrefix(projectName: string): string {
  if (!projectName) return "";
  return projectName
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("");
}

/**
 * Builds the document number in the format: PREFIX/SERIAL/FINYEAR.
 * Serial is zero-padded to 4 digits.
 */
function buildDocNumber(prefix: string, serial: number, finYear: string): string {
  if (!prefix || !finYear) return "";
  return `${prefix}/${String(serial).padStart(4, "0")}/${finYear}`;
}

/**
 * Calculates the next serial number for the given prefix + finYear combination.
 * When in edit mode pass excludeId so the record doesn't count itself.
 */
function nextSerial(
  allRecords: Record<string, unknown>[],
  prefix: string,
  finYear: string,
  excludeId?: string,
): number {
  const count = (allRecords as NamedEntryTypeRecord[]).filter(
    (r) =>
      r.prefix === prefix &&
      r.finYear === finYear &&
      (excludeId ? r._id !== excludeId : true),
  ).length;
  return count + 1;
}

// ─── Prefix renderer factory ──────────────────────────────────────────────────
// Returns a stable renderer that reads the latest projectName via a ref so we
// don't need to recreate the renderer on every parent render cycle.
function makePrefixRenderer(projectNameRef: React.RefObject<string>) {
  return function PrefixFieldRenderer({
    value,
    onChange,
    error,
  }: {
    value: PrefixGroupValue | "";
    onChange: (v: PrefixGroupValue) => void;
    error: boolean;
    field: FieldDef;
  }) {
    const groupVal: PrefixGroupValue =
      value && typeof value === "object"
        ? value
        : { mode: "auto", customPrefix: "" };

    const resolvedPrefix =
      groupVal.mode === "auto"
        ? autoPrefix(projectNameRef.current ?? "")
        : groupVal.customPrefix;

    function switchMode(m: "auto" | "custom") {
      onChange({ mode: m, customPrefix: groupVal.customPrefix });
    }

    function handleCustomInput(e: React.ChangeEvent<HTMLInputElement>) {
      onChange({ mode: "custom", customPrefix: e.target.value.toUpperCase() });
    }

    return (
      <div>
        {/* Mode toggle buttons */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] text-muted-foreground font-heading">Mode:</span>
          {(["auto", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
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

        {/* Prefix input */}
        <div className="relative">
          <Tag
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={resolvedPrefix}
            readOnly={groupVal.mode === "auto"}
            onChange={handleCustomInput}
            placeholder={
              groupVal.mode === "auto"
                ? "Auto-generated from project initials"
                : "Enter custom prefix"
            }
            className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all
              focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${
                groupVal.mode === "auto" ? "opacity-60 cursor-not-allowed" : ""
              } ${error ? "border-destructive" : "border-border"}`}
          />
        </div>

        {/* Auto-prefix source hint with initials breakdown */}
        {groupVal.mode === "auto" && projectNameRef.current && (
          <p className="text-[11px] text-primary mt-1">
            Generated from:{" "}
            <span className="font-semibold">{projectNameRef.current}</span>
            {resolvedPrefix && (
              <span className="ml-1 text-muted-foreground">
                → <span className="font-bold text-foreground">{resolvedPrefix}</span>
              </span>
            )}
          </p>
        )}
      </div>
    );
  };
}

// ─── Document Number Preview renderer ─────────────────────────────────────────
function DocNumberRenderer({
  value,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  error: boolean;
  field: FieldDef;
}) {
  const docNum = typeof value === "string" ? value : "";

  return (
    <div
      className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border
        text-foreground opacity-60 cursor-not-allowed min-h-[38px] flex items-center"
    >
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

// ─── Main component ────────────────────────────────────────────────────────────
const NamedEntryTypeMaster: React.FC = () => {
  const { finYears } = useFinYear();

  // Ref lets the prefix renderer always read the latest projectName
  // without needing to re-create the renderer on every render cycle.
  const projectNameRef = useRef<string>("");
  const PrefixRenderer = useRef(makePrefixRenderer(projectNameRef)).current;

  // ── Financial year dropdown options ─────────────────────────────────────────
  // Show all years from the FinancialYear Master (Active & Closed, locked & unlocked).
  // Sorted descending so the most recent year appears first.
  const activeFinYearOptions = finYears
    .sort((a, b) => b.year.localeCompare(a.year))
    .map((fy) => fy.year);

  // ── Field definitions ────────────────────────────────────────────────────────
  const fields: FieldDef[] = [
    {
      name: "projectName",
      label: "Project Name",
      type: "select",
      required: true,
      options: PROJECT_OPTIONS,
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
      render: PrefixRenderer as FieldDef["render"],
    },
    {
      name: "finYear",
      label: "Financial Year",
      type: "select",
      required: true,
      // Populated exclusively from the FinancialYear Master (Active, unlocked years only).
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
  ];

  const columns = [
    { key: "projectName", label: "Project Name" },
    { key: "entryType", label: "Entry Type" },
    { key: "prefix", label: "Prefix" },
    { key: "finYear", label: "Financial Year", hideOnMobile: true },
    { key: "documentNumber", label: "Document Number" },
    { key: "status", label: "Status" },
  ];

  // ── Reactive form change handler ─────────────────────────────────────────────
  // Called by MasterPage on every field change. Keeps the document number
  // preview (and the projectName ref used by the prefix renderer) in sync.
  const handleFormChange = (
    form: Record<string, unknown>,
    updateForm: (patch: Record<string, unknown>) => void,
    allRecords: Record<string, unknown>[],
  ) => {
    const projectName = (form.projectName as string) || "";
    const finYear = (form.finYear as string) || "";
    const prefixGroup = form.prefixGroup as PrefixGroupValue | undefined;

    // Keep the ref in sync so the prefix renderer shows the correct initials hint
    projectNameRef.current = projectName;

    // Resolve the effective prefix
    const mode = prefixGroup?.mode ?? "auto";
    const prefixStr =
      mode === "auto"
        ? autoPrefix(projectName)
        : (prefixGroup?.customPrefix ?? "").trim();

    // Compute what serial number this new record would receive
    const serial = nextSerial(allRecords, prefixStr, finYear);

    // Build the live preview document number: PREFIX/SERIAL/FINYEAR
    const docNum = buildDocNumber(prefixStr, serial, finYear);

    // Only patch when the computed value actually changed to avoid infinite loops
    if (form.documentNumber !== docNum) {
      updateForm({ documentNumber: docNum });
    }
  };

  // ── Pre-save transform ───────────────────────────────────────────────────────
  // Called by MasterPage just before persisting. Flattens the composite
  // `prefixGroup` field into individual scalar record fields and confirms the
  // final serial number.
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

    // Guard: prefix must be non-empty
    if (!prefixStr) return null;

    // On edit keep the original serial; on create assign the next available one
    const serial = isEdit
      ? ((formData.serialNumber as number) ?? 1)
      : nextSerial(allRecords, prefixStr, finYear);

    return {
      projectName,
      entryType: (formData.entryType as EntryType) || "Payment",
      prefix: prefixStr,
      prefixMode: mode,
      serialNumber: serial,
      finYear,
      documentNumber: buildDocNumber(prefixStr, serial, finYear),
      status: formData.status ?? true,
    };
  };

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
        fields={fields}
        columns={columns}
        initialData={SEED}
        onFormChange={handleFormChange}
        onCustomSave={handleCustomSave}
      />
    </>
  );
};

export default NamedEntryTypeMaster;
