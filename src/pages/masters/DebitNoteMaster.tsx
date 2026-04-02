import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  FieldDef,
  ColumnDef,
  RecordWithId,
} from "@/components/MasterPage";
import {
  FileWarning,
  Percent,
  IndianRupee,
  Receipt,
  CheckCircle2,
} from "lucide-react";
import { useDebitNote, DebitNoteRecord } from "@/contexts/DebitNoteContext";

// ─── Static seed data ──────────────────────────────────────────────────────────

const COMPANY_OPTIONS = [
  "Civilier Infrastructure Pvt Ltd",
  "Apex Constructions Ltd",
  "SiteCraft Engineers",
  "Raj Builders & Co",
  "Metro Rail Project",
];

const PROJECT_OPTIONS = [
  "Highway NH-48 Widening",
  "Metro Station Phase II",
  "Township Block A",
  "Flyover Bridge Repair",
  "SEZ Infrastructure",
];

const SUPPLIER_OPTIONS = [
  "Metro Hardware",
  "Bharat Steel Traders",
  "Quick Transport Co",
];

// ─── Mock bill data (will be replaced by expense booking integration later) ────
// Key: bill number  →  Value: bill amount in ₹

const BILL_AMOUNT_MAP: Record<string, number> = {
  "BILL-2024-001": 125000,
  "BILL-2024-002": 87500,
  "BILL-2024-003": 210000,
  "BILL-2024-004": 63000,
  "BILL-2024-005": 340000,
  "BILL-2025-001": 155000,
  "BILL-2025-002": 98000,
  "BILL-2025-003": 475000,
};

const BILL_OPTIONS = Object.keys(BILL_AMOUNT_MAP);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatINR(amount: number): string {
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Bill + Discount composite field ─────────────────────────────────────────
// All three steps live in one custom renderer so they can react to each other:
//   Step 1 → pick bill → bill amount appears
//   Step 2 → choose discount mode (% or ₹) and enter value → disc amount computed
//   Step 3 → final bill amount shown read-only

interface BillDiscountGroup {
  billNumber: string;
  billAmount: number | null; // pulled from BILL_AMOUNT_MAP on bill selection
  discMode: "percent" | "amount";
  discPercent: string;
  discAmount: string;
  finalAmount: number | null;
}

const EMPTY_GROUP: BillDiscountGroup = {
  billNumber: "",
  billAmount: null,
  discMode: "percent",
  discPercent: "",
  discAmount: "",
  finalAmount: null,
};

function computeFinal(g: BillDiscountGroup): number | null {
  if (g.billAmount === null) return null;
  let disc = 0;
  if (g.discMode === "percent") {
    const pct = parseFloat(g.discPercent);
    if (!isNaN(pct) && pct >= 0) disc = (g.billAmount * pct) / 100;
  } else {
    const amt = parseFloat(g.discAmount);
    if (!isNaN(amt) && amt >= 0) disc = amt;
  }
  return Math.max(0, g.billAmount - disc);
}

function BillDiscountRenderer({
  value,
  onChange,
  error,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  error: boolean;
  field: FieldDef;
}) {
  const group: BillDiscountGroup =
    value && typeof value === "object"
      ? (value as BillDiscountGroup)
      : { ...EMPTY_GROUP };

  const update = (patch: Partial<BillDiscountGroup>) => {
    const next = { ...group, ...patch };
    // Recompute final whenever anything changes
    next.finalAmount = computeFinal(next);
    onChange(next);
  };

  const handleBillSelect = (bill: string) => {
    const billAmount = BILL_AMOUNT_MAP[bill] ?? null;
    update({
      billNumber: bill,
      billAmount,
      discPercent: "",
      discAmount: "",
      finalAmount: billAmount,
    });
  };

  const handleDiscPercent = (v: string) => {
    update({ discMode: "percent", discPercent: v, discAmount: "" });
  };

  const handleDiscAmount = (v: string) => {
    update({ discMode: "amount", discAmount: v, discPercent: "" });
  };

  const hasBill = !!group.billNumber && group.billAmount !== null;
  const discountValue =
    group.discMode === "percent" && group.discPercent
      ? (group.billAmount! * parseFloat(group.discPercent)) / 100
      : group.discMode === "amount" && group.discAmount
        ? parseFloat(group.discAmount)
        : 0;
  const hasDiscount = hasBill && discountValue > 0;

  return (
    <div className="space-y-4">
      {/* ── Step 1: Bill Selection ───────────────────────────────────────── */}
      <div>
        <label className="block text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
          Bill Number <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <Receipt
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <select
            value={group.billNumber}
            onChange={(e) => handleBillSelect(e.target.value)}
            className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all
              focus:outline-none focus:ring-2 focus:ring-primary text-foreground
              ${error && !group.billNumber ? "border-destructive" : "border-border"}`}
          >
            <option value="">Select bill number…</option>
            {BILL_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Step 2: Bill Amount + Discount ───────────────────────────────── */}
      {hasBill && (
        <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-4">
          {/* Bill amount display */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-widest font-heading text-muted-foreground">
              Bill Amount
            </span>
            <span className="text-lg font-heading font-bold text-foreground flex items-center gap-1">
              <IndianRupee size={15} className="text-muted-foreground" />
              {formatINR(group.billAmount!)}
            </span>
          </div>

          <div className="border-t border-border/60" />

          {/* Discount mode toggle */}
          <div>
            <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-2">
              Apply Discount
            </p>
            <div className="flex gap-2 mb-3">
              {(["percent", "amount"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    update({
                      discMode: m,
                      discPercent: "",
                      discAmount: "",
                    })
                  }
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading border transition-all ${
                    group.discMode === m
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-card text-muted-foreground border-border hover:border-primary/50"
                  }`}
                >
                  {m === "percent" ? (
                    <>
                      <Percent size={11} /> By Percentage
                    </>
                  ) : (
                    <>
                      <IndianRupee size={11} /> By Amount
                    </>
                  )}
                </button>
              ))}
            </div>

            {/* Discount input */}
            {group.discMode === "percent" ? (
              <div className="relative">
                <Percent
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={group.discPercent}
                  onChange={(e) => handleDiscPercent(e.target.value)}
                  placeholder="Enter discount %"
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-card border border-border
                    focus:outline-none focus:ring-2 focus:ring-primary text-foreground transition-all"
                />
              </div>
            ) : (
              <div className="relative">
                <IndianRupee
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="number"
                  min="0"
                  max={group.billAmount!}
                  step="0.01"
                  value={group.discAmount}
                  onChange={(e) => handleDiscAmount(e.target.value)}
                  placeholder="Enter discount amount"
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-card border border-border
                    focus:outline-none focus:ring-2 focus:ring-primary text-foreground transition-all"
                />
              </div>
            )}

            {/* Discount summary line */}
            {hasDiscount && (
              <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-[11px] text-muted-foreground">
                  Discount applied
                </span>
                <span className="text-[12px] font-mono text-destructive font-semibold">
                  − ₹{formatINR(discountValue)}
                  {group.discMode === "percent" && group.discPercent && (
                    <span className="ml-1 text-[10px] font-heading text-muted-foreground">
                      ({group.discPercent}%)
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* ── Step 3: Final Amount ───────────────────────────────────────── */}
          <div className="border-t border-border/60 pt-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="text-primary" />
                <span className="text-[11px] uppercase tracking-widest font-heading text-primary font-semibold">
                  Final Bill Amount
                </span>
              </div>
              <span
                className={`text-xl font-heading font-bold flex items-center gap-1 transition-colors ${
                  hasDiscount ? "text-primary" : "text-foreground"
                }`}
              >
                <IndianRupee size={16} />
                {group.finalAmount !== null
                  ? formatINR(group.finalAmount)
                  : formatINR(group.billAmount!)}
              </span>
            </div>
            {hasDiscount && (
              <p className="text-[10px] text-muted-foreground mt-1 text-right">
                You save ₹{formatINR(discountValue)} on this bill
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Column renderers ─────────────────────────────────────────────────────────

function billDiscountColumnRenderer(value: unknown) {
  const g = value as BillDiscountGroup | undefined;
  if (!g?.billNumber)
    return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-mono text-foreground">{g.billNumber}</span>
      {g.finalAmount !== null && (
        <span className="text-[11px] text-primary font-semibold flex items-center gap-0.5">
          <IndianRupee size={10} />
          {formatINR(g.finalAmount)}
        </span>
      )}
    </div>
  );
}

function discountSummaryRenderer(value: unknown) {
  const g = value as BillDiscountGroup | undefined;
  if (!g?.billAmount)
    return <span className="text-muted-foreground text-xs">—</span>;

  const discountValue =
    g.discMode === "percent" && g.discPercent
      ? (g.billAmount * parseFloat(g.discPercent)) / 100
      : g.discMode === "amount" && g.discAmount
        ? parseFloat(g.discAmount)
        : 0;

  if (!discountValue)
    return <span className="text-muted-foreground text-xs">No discount</span>;

  return (
    <span className="inline-flex items-center gap-1 text-xs font-mono text-destructive">
      {g.discMode === "percent" ? (
        <>
          <Percent size={10} />
          {g.discPercent}%
        </>
      ) : (
        <>
          <IndianRupee size={10} />
          {formatINR(discountValue)}
        </>
      )}
    </span>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

const DebitNoteMaster: React.FC = () => {
  const { setDebitNoteRecords } = useDebitNote();
  const fields: FieldDef[] = [
    {
      name: "company",
      label: "Company",
      type: "select",
      required: true,
      options: COMPANY_OPTIONS,
    },
    {
      name: "project",
      label: "Project",
      type: "select",
      required: true,
      options: PROJECT_OPTIONS,
    },
    {
      name: "supplier",
      label: "Supplier",
      type: "select",
      required: true,
      options: SUPPLIER_OPTIONS,
    },
    {
      // Bill + Discount + Final Amount all in one custom field
      name: "billDiscountGroup",
      label: "Bill & Discount",
      type: "custom",
      required: true,
      fullWidth: true,
      render: BillDiscountRenderer as FieldDef["render"],
    },
    {
      name: "status",
      label: "Status",
      type: "toggle",
      defaultValue: true,
    },
  ];

  // Flatten billDiscountGroup into scalar fields before saving
  const handleCustomSave = (
    formData: Record<string, unknown>,
  ): Record<string, unknown> | null => {
    const g = formData.billDiscountGroup as BillDiscountGroup | undefined;
    if (!g?.billNumber) return null; // bill is required

    return {
      company: formData.company,
      project: formData.project,
      supplier: formData.supplier,
      billDiscountGroup: g, // kept for column renderers
      billNumber: g.billNumber,
      billAmount: g.billAmount,
      discMode: g.discMode,
      discPercent: g.discPercent,
      discAmount: g.discAmount,
      finalAmount: g.finalAmount,
      status: formData.status ?? true,
    };
  };

  // Fix: columns with same key need distinct renderers — override via a wrapper
  const safeColumns: ColumnDef[] = [
    { key: "company", label: "Company" },
    { key: "project", label: "Project", hideOnMobile: true },
    { key: "supplier", label: "Supplier" },
    { key: "billDiscountGroup", label: "Bill / Final Amt" },
    { key: "discountDisplay", label: "Discount" },
    { key: "status", label: "Status" },
  ];

  const safeColumnRenderers: Record<
    string,
    (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode
  > = {
    billDiscountGroup: billDiscountColumnRenderer,
    discountDisplay: (_value, row) =>
      discountSummaryRenderer(row.billDiscountGroup),
  };

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Debit Note Master"]}
      />

      <div className="flex items-center gap-3 mb-4">
        <FileWarning className="w-5 h-5 text-orange-500" />
        <h1 className="text-xl font-heading font-bold text-foreground">
          Debit Note Master
        </h1>
      </div>

      <MasterPage
        title="Debit Note"
        fields={fields}
        columns={safeColumns}
        columnRenderers={safeColumnRenderers}
        initialData={[]}
        onCustomSave={handleCustomSave}
        onDataChange={(records) => setDebitNoteRecords(records as DebitNoteRecord[])}
      />
    </>
  );
};

export default DebitNoteMaster;
