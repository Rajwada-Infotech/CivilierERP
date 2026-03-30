import React, { useRef } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MasterPage, FieldDef, RecordWithId } from "@/components/MasterPage";
import { FileType2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocStatus = "Active" | "Inactive" | "Draft";

interface TypeOfDocRecord {
  _id: string;
  docCode: string;
  name: string;
  description: string;
  status: DocStatus;
  remarks: string;
}

// ─── Seed data (pulled from NamedEntryType document numbers) ─────────────────

const SEED: Omit<TypeOfDocRecord, "_id">[] = [
  {
    docCode: "CIPL/0001/2024-25",
    name: "Payment Voucher",
    description: "Standard payment voucher for outgoing transactions",
    status: "Active",
    remarks: "",
  },
  {
    docCode: "ACL/0001/2024-25",
    name: "Receipt Voucher",
    description: "Standard receipt voucher for incoming transactions",
    status: "Active",
    remarks: "",
  },
];

// ─── Named Entry Type doc codes pulled from localStorage / context ────────────
// We read the same seed the NamedEntryTypeMaster uses so doc codes stay in sync.
// In a real API-backed app this would be a useEffect fetch; here we merge the
// static seed with any records persisted by the MasterPage in state.

const NAMED_ENTRY_SEED_DOC_NUMBERS = ["CIPL/0001/2024-25", "ACL/0001/2024-25"];

// ─── Status Radio renderer ────────────────────────────────────────────────────

function StatusRadioRenderer({
  value,
  onChange,
  error,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  error: boolean;
  field: FieldDef;
}) {
  const current = (value as DocStatus) || "Active";
  const options: {
    value: DocStatus;
    label: string;
    color: string;
    dot: string;
  }[] = [
    {
      value: "Active",
      label: "Active",
      color:
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
    },
    {
      value: "Inactive",
      label: "Inactive",
      color: "border-destructive/40 bg-destructive/10 text-destructive",
      dot: "bg-destructive",
    },
    {
      value: "Draft",
      label: "Draft",
      color:
        "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      dot: "bg-amber-500",
    },
  ];

  return (
    <div
      className={`flex gap-2 flex-wrap ${error ? "ring-1 ring-destructive rounded-lg p-1" : ""}`}
    >
      {options.map((opt) => {
        const isSelected = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg border text-xs font-heading transition-all
              ${isSelected ? opt.color + " shadow-sm scale-[1.02]" : "border-border bg-muted text-muted-foreground hover:border-primary/40"}`}
          >
            {/* Radio circle */}
            <span
              className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-all
                ${isSelected ? "border-current" : "border-muted-foreground/40"}`}
            >
              {isSelected && (
                <span className={`w-1.5 h-1.5 rounded-full ${opt.dot}`} />
              )}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Doc Code select renderer — pulls codes from NamedEntryType ───────────────

function makeDocCodeRenderer(namedEntryCodes: React.RefObject<string[]>) {
  return function DocCodeRenderer({
    value,
    onChange,
    error,
  }: {
    value: unknown;
    onChange: (v: unknown) => void;
    error: boolean;
    field: FieldDef;
  }) {
    const codes = namedEntryCodes.current ?? [];
    const current = (value as string) || "";

    return (
      <div>
        <div className="relative">
          <FileType2
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
            <option value="">Select doc code…</option>
            {codes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
        {codes.length === 0 && (
          <p className="text-[11px] text-amber-500 mt-1">
            No document codes found — add records in Named Entry Type Master
            first.
          </p>
        )}
      </div>
    );
  };
}

// ─── Column renderer for status badge ─────────────────────────────────────────

function statusRenderer(value: unknown) {
  const v = value as DocStatus;
  const map: Record<DocStatus, { bg: string; dot: string; text: string }> = {
    Active: {
      bg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
      text: "Active",
    },
    Inactive: {
      bg: "bg-destructive/10 border-destructive/20 text-destructive",
      dot: "bg-destructive",
      text: "Inactive",
    },
    Draft: {
      bg: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
      dot: "bg-amber-500",
      text: "Draft",
    },
  };
  const s = map[v] ?? map["Active"];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${s.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${s.dot}`} />
      {s.text}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const TypeOfDocMaster: React.FC = () => {
  // Ref holding the current list of document codes from NamedEntryType Master.
  // Initialised from the static seed; in a real app this would be fetched/subscribed.
  const namedEntryCodesRef = useRef<string[]>(NAMED_ENTRY_SEED_DOC_NUMBERS);

  const DocCodeRenderer = useRef(
    makeDocCodeRenderer(namedEntryCodesRef),
  ).current;

  // ── Field definitions ──────────────────────────────────────────────────────
  const fields: FieldDef[] = [
    {
      name: "docCode",
      label: "Doc Code",
      type: "custom",
      required: true,
      render: DocCodeRenderer as FieldDef["render"],
    },
    {
      name: "name",
      label: "Name",
      type: "text",
      required: true,
      uppercase: false,
    },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      required: false,
      fullWidth: true,
    },
    {
      name: "status",
      label: "Status",
      type: "custom",
      required: true,
      defaultValue: "Active",
      render: StatusRadioRenderer as FieldDef["render"],
    },
    {
      name: "remarks",
      label: "Remarks",
      type: "textarea",
      required: false,
      fullWidth: true,
    },
  ];

  const columns = [
    { key: "docCode", label: "Doc Code" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description", hideOnMobile: true },
    { key: "status", label: "Status" },
    { key: "remarks", label: "Remarks", hideOnMobile: true },
  ];

  // Custom column renderers
  const columnRenderers: Record<
    string,
    (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode
  > = {
    status: (value) => statusRenderer(value),
    remarks: (value) => (
      <span className="text-muted-foreground text-xs italic">
        {String(value || "—")}
      </span>
    ),
    description: (value) => (
      <span className="text-muted-foreground text-xs truncate max-w-[180px] block">
        {String(value || "—")}
      </span>
    ),
  };

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Type of Doc Master"]}
      />

      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Type of Doc Master
      </h1>

      <MasterPage
        title="Type of Doc"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={SEED}
      />
    </>
  );
};

export default TypeOfDocMaster;
