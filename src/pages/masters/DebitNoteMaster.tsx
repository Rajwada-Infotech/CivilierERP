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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDebitNotes,
  addDebitNote,
  updateDebitNote,
  deleteDebitNote,
} from "@/api/debitNoteApi";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface DbDebitNote {
  id: number;
  company_id: number | null;
  project_id: number | null;
  supplier_id: number | null;
  bill_id: number | null;
  is_active: boolean | null;
}

interface BillDiscountGroup {
  billNumber: string;
  billAmount: number | null;
  discMode: "percent" | "amount";
  discPercent: string;
  discAmount: string;
  finalAmount: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function labelById(
  options: { id: number; label: string }[],
  id: number | null,
) {
  return options.find((o) => o.id === id)?.label ?? "—";
}

function idByLabel(options: { id: number; label: string }[], label: string) {
  return options.find((o) => o.label === label)?.id ?? null;
}

function formatINR(amount: number): string {
  return amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Bill & Discount Renderer ─────────────────────────────────────────────────
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

function makeBillRenderer(billOptions: any[]) {
  return function BillDiscountRenderer({ value, onChange, error }: any) {
    const group: BillDiscountGroup =
      value && typeof value === "object"
        ? (value as BillDiscountGroup)
        : { ...EMPTY_GROUP };

    const update = (patch: Partial<BillDiscountGroup>) => {
      const next = { ...group, ...patch };
      next.finalAmount = computeFinal(next);
      onChange(next);
    };

    const handleBillSelect = (bill: string) => {
      update({
        billNumber: bill,
        billAmount: null,
        discPercent: "",
        discAmount: "",
        finalAmount: null,
      });
    };

    const hasBill = !!group.billNumber;
    const discountValue =
      group.discMode === "percent" && group.discPercent && group.billAmount
        ? (group.billAmount * parseFloat(group.discPercent)) / 100
        : group.discMode === "amount" && group.discAmount
          ? parseFloat(group.discAmount)
          : 0;

    const hasDiscount =
      hasBill && discountValue > 0 && group.billAmount !== null;

    return (
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
            Bill / Expense Doc <span className="text-destructive">*</span>
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
              <option value="">Select expense document…</option>
              {billOptions.map((b: any) => (
                <option key={b.id} value={b.value || b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasBill && (
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-4">
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
                      update({ discMode: m, discPercent: "", discAmount: "" })
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
                    onChange={(e) =>
                      update({
                        discMode: "percent",
                        discPercent: e.target.value,
                        discAmount: "",
                      })
                    }
                    placeholder="Enter discount %"
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-card border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground transition-all"
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
                    step="0.01"
                    value={group.discAmount}
                    onChange={(e) =>
                      update({
                        discMode: "amount",
                        discAmount: e.target.value,
                        discPercent: "",
                      })
                    }
                    placeholder="Enter discount amount"
                    className="w-full pl-8 pr-3 py-2 rounded-lg text-sm font-body bg-card border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground transition-all"
                  />
                </div>
              )}

              {hasDiscount && (
                <div className="flex items-center justify-between mt-2 px-1">
                  <span className="text-[11px] text-muted-foreground">
                    Discount applied
                  </span>
                  <span className="text-[12px] font-mono text-destructive font-semibold">
                    − ₹{formatINR(discountValue)}
                  </span>
                </div>
              )}
            </div>

            {group.finalAmount !== null && (
              <div className="border-t border-border/60 pt-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={15} className="text-primary" />
                    <span className="text-[11px] uppercase tracking-widest font-heading text-primary font-semibold">
                      Final Amount
                    </span>
                  </div>
                  <span className="text-xl font-heading font-bold flex items-center gap-1 text-primary">
                    <IndianRupee size={16} />
                    {formatINR(group.finalAmount)}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DebitNoteMaster: React.FC = () => {
  const queryClient = useQueryClient();

  // Data Queries
  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["debit-notes"],
    queryFn: getDebitNotes,
  });

  const { data: enterpriseData } = useQuery({
    queryKey: ["enterprise-options"],
    queryFn: () => fetch("/api/enterprises/options").then((r) => r.json()),
  });

  const { data: accountHeadData } = useQuery({
    queryKey: ["account-head-options"],
    queryFn: () => fetch("/api/account-head/options").then((r) => r.json()),
  });

  const { data: expenseData, refetch: refetchExpenses, error: expenseError } = useQuery({
    queryKey: ["expense-booking-options"],
    queryFn: async () => {
      const r = await fetch("/api/expense-booking/options");
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load expense options (${r.status})`);
      }
      return r.json();
    },
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    gcTime: 0,
  });

  // Options
  const ENTERPRISE_OPTIONS: { id: number; label: string }[] = Array.isArray(
    enterpriseData,
  )
    ? enterpriseData
    : [];
  const COMPANY_OPTIONS = ENTERPRISE_OPTIONS;
  const PROJECT_OPTIONS = ENTERPRISE_OPTIONS;
  const SUPPLIER_OPTIONS: { id: number; label: string }[] = Array.isArray(
    accountHeadData,
  )
    ? accountHeadData
    : [];
  const BILL_OPTIONS: any[] = Array.isArray(expenseData) ? expenseData : [];

  // Lookup Function
  const billIdByValue = (selectedValue: string) =>
    BILL_OPTIONS.find(
      (b: any) => b.value === selectedValue || String(b.id) === selectedValue,
    )?.id ?? null;

  // Map DB data to UI
  const mappedData: RecordWithId[] = Array.isArray(dbData)
    ? dbData.map((item: any) => ({
        _id: String(item.id),
        company: labelById(COMPANY_OPTIONS, item.company_id),
        project: labelById(PROJECT_OPTIONS, item.project_id),
        supplier: labelById(SUPPLIER_OPTIONS, item.supplier_id),
        billDiscountGroup: {
          billNumber:
            BILL_OPTIONS.find((b: any) => b.id === item.bill_id)?.label || "",
          billAmount: null,
          discMode: "percent",
          discPercent: "",
          discAmount: "",
          finalAmount: null,
        } as BillDiscountGroup,
        status: Boolean(item.is_active),
      }))
    : [];

  // Convert form to payload
  const toPayload = (formData: Record<string, unknown>) => {
    const g = formData.billDiscountGroup as BillDiscountGroup | undefined;
    return {
      company_id: idByLabel(COMPANY_OPTIONS, formData.company as string),
      project_id: idByLabel(PROJECT_OPTIONS, formData.project as string),
      supplier_id: idByLabel(SUPPLIER_OPTIONS, formData.supplier as string),
      bill_id: g?.billNumber ? billIdByValue(g.billNumber) : null,
      is_active: formData.status !== false,
    };
  };

  const handleCustomSave = (formData: Record<string, unknown>) => {
    const g = formData.billDiscountGroup as BillDiscountGroup | undefined;
    if (!g?.billNumber) return null;
    return { ...formData, status: formData.status ?? true };
  };

  // Handle Add/Update/Delete
  const handleDataEvent = async (event: any) => {
    if (event.action === "add") {
      try {
        await addDebitNote(toPayload(event.record));
        toast.success("Debit note saved!");
        await refetchExpenses(); // Refresh expense dropdown
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updateDebitNote(Number(event.id), toPayload(event.record));
        toast.success("Debit note updated!");
        await refetchExpenses();
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deleteDebitNote(Number(event.id));
        toast.success("Debit note deleted!");
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const BillDiscountRenderer = makeBillRenderer(BILL_OPTIONS);

  const fields: FieldDef[] = [
    {
      name: "company",
      label: "Company",
      type: "select",
      required: true,
      options: COMPANY_OPTIONS.map((o) => o.label),
    },
    {
      name: "project",
      label: "Project",
      type: "select",
      required: true,
      options: PROJECT_OPTIONS.map((o) => o.label),
    },
    {
      name: "supplier",
      label: "Supplier",
      type: "select",
      required: true,
      options: SUPPLIER_OPTIONS.map((o) => o.label),
    },
    {
      name: "billDiscountGroup",
      label: "Bill & Discount",
      type: "custom",
      required: true,
      fullWidth: true,
      render: BillDiscountRenderer as FieldDef["render"],
    },
    { name: "status", label: "Status", type: "toggle", defaultValue: true },
  ];

  const columns: ColumnDef[] = [
    { key: "company", label: "Company" },
    { key: "project", label: "Project", hideOnMobile: true },
    { key: "supplier", label: "Supplier" },
    { key: "billDiscountGroup", label: "Bill / Doc" },
    { key: "discountDisplay", label: "Discount" },
    { key: "status", label: "Status" },
  ];

  const columnRenderers: Record<string, any> = {
    billDiscountGroup: billDiscountColumnRenderer,
    discountDisplay: (_value: unknown, row: RecordWithId) =>
      discountSummaryRenderer(row.billDiscountGroup),
    status: (value: boolean) => (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
          value
            ? "bg-green-500/10 border-green-500/20 text-green-600"
            : "bg-red-500/10 border-red-500/20 text-red-600"
        }`}
      >
        {value ? "Active" : "Inactive"}
      </span>
    ),
  };

  function billDiscountColumnRenderer(value: unknown) {
    const g = value as BillDiscountGroup | undefined;
    if (!g?.billNumber)
      return <span className="text-muted-foreground text-xs">—</span>;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-xs font-mono text-foreground">
          {g.billNumber}
        </span>
      </div>
    );
  }

  function discountSummaryRenderer(value: unknown) {
    const g = value as BillDiscountGroup | undefined;
    if (!g?.billNumber)
      return <span className="text-muted-foreground text-xs">—</span>;
    return (
      <span className="text-xs text-muted-foreground">Discount Applied</span>
    );
  }

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return (
      <div className="p-6 text-red-500">
        Failed to load debit notes. Check backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs
        items={["Dashboard", "Finance Module", "Debit Note Master"]}
      />
      {expenseError && (
        <div className="mb-3 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          ⚠️ Could not load expense documents:{" "}
          {(expenseError as Error).message}. Bill dropdown will be empty.
        </div>
      )}
      <div className="flex items-center gap-3 mb-4">
        <FileWarning className="w-5 h-5 text-orange-500" />
        <h1 className="text-xl font-heading font-bold text-foreground">
          Debit Note Master
        </h1>
      </div>
      <MasterPage
        title="Debit Note"
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onCustomSave={handleCustomSave}
        onDataEvent={handleDataEvent}
      />
    </>
  );
};

export default DebitNoteMaster;
