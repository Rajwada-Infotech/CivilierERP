import React from "react";
import { createPortal } from "react-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { safeHtml } from "@/utils/escapeHtml";
import {
  MasterPage,
  FieldDef,
  ColumnDef,
  RecordWithId,
} from "@/components/MasterPage";
import {
  FileWarning,
  ChevronDown,
  Users,
  Receipt,
  IndianRupee,
  Plus,
  Trash2,
} from "lucide-react";
import { MaterialShell } from "@/components/material/MaterialShell";
import { ApprovalActions } from "@/components/ApprovalActions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDebitNotes,
  addDebitNote,
  updateDebitNote,
  deleteDebitNote,
  getDebitNotePartyOptions,
  getInvoicesForParty,
  type DebitNoteInvoiceOption,
} from "@/api/debitNoteApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { toast } from "sonner";
import { getQualityDebitNotes, type QualityDebitNote } from "@/api/qualityRejectionDebitNoteApi";
import { AlertTriangle, Eye, X } from "lucide-react";
import { useState } from "react";

// ─── Party Type → AccountHeadMaster.LHeadType (see accountHeadMaster.js) ─────
const PARTY_TYPES: { code: string; label: string }[] = [
  { code: "S", label: "Supplier" },
  { code: "C", label: "Contractor" },
  { code: "A", label: "Customer" },
  { code: "BR", label: "Broker" },
];
const PARTY_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  PARTY_TYPES.map((p) => [p.code, p.label]),
);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function labelById(options: { id: number; label: string }[], id: number | null) {
  return options.find((o) => o.id === id)?.label ?? "—";
}

function idByLabel(options: { id: number; label: string }[], label: string) {
  return options.find((o) => o.label === label)?.id ?? null;
}

function formatINR(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return "₹" + amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Invoices that came through Material Request -> PO -> GRN, or Work Order ->
// PO, keep the line-item picker (same as the pre-rewrite Debit Note form);
// a direct/TOD invoice (no PO/GRN/WO behind it) gets the value-only amount
// adjuster instead. Mirrors ITEM_MODE_SOURCE_TYPES in backend/routes/debitNote.js.
const ITEM_MODE_SOURCE_TYPES = new Set(["GRN", "PO", "WO_PO", "WORK_DONE", "WO"]);
function isItemModeInvoice(sourceType: string | null | undefined): boolean {
  return !!sourceType && ITEM_MODE_SOURCE_TYPES.has(sourceType);
}

// ─── Line item picker (restored from the pre-rewrite form, unchanged) ───────
interface DebitNoteItem {
  Description: string;
  Quantity: string;
  UOMSymbol: string;
  Rate: string;
  Amount: string;
}

const emptyItem = (): DebitNoteItem => ({
  Description: "", Quantity: "", UOMSymbol: "", Rate: "", Amount: "",
});

function calcAmount(qty: string, rate: string): string {
  const q = parseFloat(qty), r = parseFloat(rate);
  if (!isNaN(q) && !isNaN(r)) return (q * r).toFixed(2);
  return "";
}

function ItemsRenderer({ value, onChange }: { value: DebitNoteItem[]; onChange: (v: DebitNoteItem[]) => void }) {
  const items: DebitNoteItem[] = Array.isArray(value) && value.length ? value : [emptyItem()];

  const update = (idx: number, field: keyof DebitNoteItem, val: string) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it;
      const updated = { ...it, [field]: val };
      if (field === "Quantity" || field === "Rate")
        updated.Amount = calcAmount(
          field === "Quantity" ? val : it.Quantity,
          field === "Rate" ? val : it.Rate,
        );
      return updated;
    });
    onChange(next);
  };

  const addRow = () => onChange([...items, emptyItem()]);
  const removeRow = (idx: number) => {
    const next = items.filter((_, i) => i !== idx);
    onChange(next.length ? next : [emptyItem()]);
  };

  const total = items.reduce((s, it) => s + (parseFloat(it.Amount) || 0), 0);
  const thCls = "text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-2 py-1.5";
  const inp = "w-full text-xs rounded border border-border px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/30";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 border-b border-border">
            <tr>
              <th className={thCls + " w-6 hidden sm:table-cell"}>#</th>
              <th className={thCls}>Description *</th>
              <th className={thCls + " w-16"}>Qty</th>
              <th className={thCls + " w-14 hidden sm:table-cell"}>UOM</th>
              <th className={thCls + " w-20"}>Rate</th>
              <th className={thCls + " w-20"}>Amount</th>
              <th className={thCls + " w-6"}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx} className="border-b border-border/50">
                <td className="px-2 py-1 text-muted-foreground text-center hidden sm:table-cell">{idx + 1}</td>
                <td className="px-2 py-1">
                  <input className={inp} value={it.Description} onChange={(e) => update(idx, "Description", e.target.value)} placeholder="Item / description" />
                </td>
                <td className="px-2 py-1">
                  <input className={inp + " text-right"} type="number" value={it.Quantity} onChange={(e) => update(idx, "Quantity", e.target.value)} placeholder="0" step="any" min={0} />
                </td>
                <td className="px-2 py-1 hidden sm:table-cell">
                  <input className={inp} value={it.UOMSymbol} onChange={(e) => update(idx, "UOMSymbol", e.target.value)} placeholder="Nos" />
                </td>
                <td className="px-2 py-1">
                  <input className={inp + " text-right"} type="number" value={it.Rate} onChange={(e) => update(idx, "Rate", e.target.value)} placeholder="0.00" step="any" min={0} />
                </td>
                <td className="px-2 py-1">
                  <input className={inp + " text-right bg-muted/30"} value={it.Amount} onChange={(e) => update(idx, "Amount", e.target.value)} placeholder="0.00" />
                </td>
                <td className="px-2 py-1 text-center">
                  <button type="button" onClick={() => removeRow(idx)} className="p-1 rounded text-red-400 hover:bg-red-500/10">
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/20">
            <tr>
              <td colSpan={4} className="px-2 py-1.5 text-right text-xs font-semibold text-muted-foreground">Total</td>
              <td className="hidden sm:table-cell" />
              <td className="px-2 py-1.5 text-right text-xs font-bold text-foreground">
                {formatINR(total)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <button type="button" onClick={addRow} className="flex items-center gap-1.5 text-xs text-emerald-600 hover:text-emerald-700 font-medium">
        <Plus size={13} /> Add Row
      </button>
    </div>
  );
}

// ─── Party → Invoice compound field ──────────────────────────────────────────
// One cohesive block (Party Type → Party → Invoice, plus the read-only
// Invoice Value / Previous Debit / Adjusted Value it resolves) — same
// "compound custom field carrying its own related state" convention this
// form already used for the old bill/discount picker, kept as a *stable*
// top-level component (not a per-render factory) so its own useQuery hooks
// for Party/Invoice options don't get torn down and refetched on every
// keystroke elsewhere in the form.
export interface PartyInvoiceGroup {
  partyType: string;
  partyId: number | null;
  partyLabel: string;
  billId: number | null;
  invoiceDocNo: string;
  /** ExpenseBooking.ESourceType for the selected invoice — drives the
   * item-picker-vs-amount-adjuster split (see isItemModeInvoice above). */
  sourceType: string | null;
  companyId: number | null;
  projectId: number | null;
  /** Set only while editing an existing debit note — its own amount must be
   * excluded from "Previous Debit" (the server's per-invoice sum otherwise
   * double-counts the note being edited against itself). */
  originalDebitAmount?: number;
}

const EMPTY_PARTY_INVOICE_GROUP: PartyInvoiceGroup = {
  partyType: "",
  partyId: null,
  partyLabel: "",
  billId: null,
  invoiceDocNo: "",
  sourceType: null,
  companyId: null,
  projectId: null,
};

function PartyInvoiceRenderer({
  value,
  onChange,
  error,
  formData,
  onInvoiceResolved,
}: {
  value: unknown;
  onChange: (v: PartyInvoiceGroup) => void;
  error: boolean;
  formData: Record<string, unknown>;
  onInvoiceResolved: (opt: DebitNoteInvoiceOption | null) => void;
}) {
  const g: PartyInvoiceGroup = value && typeof value === "object" ? (value as PartyInvoiceGroup) : { ...EMPTY_PARTY_INVOICE_GROUP };

  const { data: partyOptions = [], isFetching: loadingParties } = useQuery({
    queryKey: ["debit-note-party-options", g.partyType],
    queryFn: () => getDebitNotePartyOptions(g.partyType),
    enabled: !!g.partyType,
    staleTime: 60 * 1000,
  });

  const { data: invoiceOptions = [], isFetching: loadingInvoices } = useQuery({
    queryKey: ["debit-note-invoices-for-party", g.partyId],
    queryFn: () => getInvoicesForParty(g.partyId as number),
    enabled: !!g.partyId,
    staleTime: 30 * 1000,
  });

  const selectedInvoice = invoiceOptions.find((o) => o.billId === g.billId) ?? null;
  const isItemMode = isItemModeInvoice(g.sourceType);
  const itemsTotal = ((formData.items as DebitNoteItem[] | undefined) ?? []).reduce((s, it) => s + (parseFloat(it.Amount) || 0), 0);
  const enteredAmount = isItemMode ? itemsTotal : parseFloat(String(formData.debitAmount ?? "")) || 0;
  const previousDebit = selectedInvoice
    ? Math.max(0, selectedInvoice.previousDebitAmount - (g.originalDebitAmount ?? 0))
    : 0;
  const invoiceValue = selectedInvoice?.invoiceAmount ?? null;
  const adjustedValue = invoiceValue != null ? invoiceValue + previousDebit + enteredAmount : null;

  const selectCls = "w-full appearance-none pl-9 pr-8 py-2 rounded-lg text-sm font-body bg-muted border border-border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
            Party Type <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <Users size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <select
              value={g.partyType}
              onChange={(e) => onChange({ ...EMPTY_PARTY_INVOICE_GROUP, partyType: e.target.value })}
              className={`${selectCls} ${error && !g.partyType ? "border-destructive" : ""}`}
            >
              <option value="">Select party type…</option>
              {PARTY_TYPES.map((p) => (
                <option key={p.code} value={p.code}>{p.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
            Party <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <Users size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <select
              value={g.partyId ?? ""}
              disabled={!g.partyType}
              onChange={(e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                const opt = partyOptions.find((p) => p.id === id);
                onChange({ ...g, partyId: id, partyLabel: opt?.label ?? "", billId: null, invoiceDocNo: "", sourceType: null, companyId: null, projectId: null });
                onInvoiceResolved(null);
              }}
              className={`${selectCls} ${error && g.partyType && !g.partyId ? "border-destructive" : ""}`}
            >
              <option value="">{loadingParties ? "Loading…" : `Select ${PARTY_TYPE_LABEL[g.partyType] ?? "party"}…`}</option>
              {partyOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
          Invoice <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <Receipt size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <select
            value={g.billId ?? ""}
            disabled={!g.partyId}
            onChange={(e) => {
              const id = e.target.value ? Number(e.target.value) : null;
              const opt = invoiceOptions.find((o) => o.billId === id) ?? null;
              onChange({
                ...g,
                billId: id,
                invoiceDocNo: opt?.docNo ?? "",
                sourceType: opt?.sourceType ?? null,
                companyId: opt?.companyId ?? null,
                projectId: opt?.projectId ?? null,
              });
              onInvoiceResolved(opt);
            }}
            className={`${selectCls} ${error && g.partyId && !g.billId ? "border-destructive" : ""}`}
          >
            <option value="">{loadingInvoices ? "Loading…" : "Select invoice…"}</option>
            {invoiceOptions.map((o) => (
              <option key={o.billId} value={o.billId}>
                {o.docNo} — {formatINR(o.invoiceAmount)} ({o.billStatus ?? "—"})
              </option>
            ))}
            {g.partyId && !loadingInvoices && invoiceOptions.length === 0 && (
              <option disabled value="">No approved invoices found for this party</option>
            )}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>

      {selectedInvoice && (
        <div className="rounded-xl border border-border bg-muted/40 p-4 grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Invoice Value</p>
            <p className="text-sm font-mono font-semibold text-foreground">{formatINR(invoiceValue)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">Previous Debit</p>
            <p className="text-sm font-mono font-semibold text-foreground">{formatINR(previousDebit)}</p>
          </div>
          <div className="rounded-lg bg-primary/5 -m-1 p-1">
            <p className="text-[10px] uppercase tracking-widest text-primary/80 mb-0.5 flex items-center gap-1">
              <IndianRupee size={9} /> Adjusted Value
            </p>
            <p className="text-sm font-mono font-bold text-primary">{formatINR(adjustedValue)}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
const DebitNoteMaster: React.FC = () => {
  const rights = usePageRights("debit-note");
  const queryClient = useQueryClient();
  const [autoFillPatch, setAutoFillPatch] = useState<Record<string, unknown> | null>(null);
  const [autoFillPatchKey, setAutoFillPatchKey] = useState(0);

  const { data: dbData, isLoading, error } = useQuery({
    queryKey: ["debit-notes"],
    queryFn: getDebitNotes,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  // Quality Rejection Debit Notes — a separate feature (raised from Vehicle
  // In/Out & GRN inspections when part of a delivery is below the ordered
  // grade) that lives in its own table, not dbo.DebitNote. Shown here
  // read-only in its own section since both are conceptually "debit notes
  // against a supplier" and people look for them in the same place.
  const { data: qualityDebitNotesRes } = useQuery({
    queryKey: ["quality-debit-notes"],
    queryFn: () => getQualityDebitNotes(),
    staleTime: 60 * 1000,
  });
  const qualityDebitNotes = qualityDebitNotesRes?.data ?? [];
  const [viewingQDN, setViewingQDN] = useState<QualityDebitNote | null>(null);

  const { data: companyData } = useQuery({
    queryKey: ["enterprises-companies"],
    queryFn: () => fetchWithAuth("/api/enterprises/options?business_type=C").then((r) => r.json().catch(() => ({}))),
    staleTime: 5 * 60 * 1000,
  });

  const { data: projectData } = useQuery({
    queryKey: ["enterprises-projects"],
    queryFn: () => fetchWithAuth("/api/enterprises/options?business_type=P").then((r) => r.json().catch(() => ({}))),
    staleTime: 5 * 60 * 1000,
  });

  const COMPANY_OPTIONS: { id: number; label: string }[] = Array.isArray(companyData)
    ? companyData.map((o: any) => ({ id: o.id, label: o.label ?? o.name ?? "" })).filter((o) => o.label)
    : [];

  const PROJECT_OPTIONS: { id: number; label: string; companyId: number | null }[] = Array.isArray(projectData)
    ? projectData.map((o: any) => ({
        id: o.id,
        label: o.label ?? o.name ?? "",
        companyId: o.company_id != null ? Number(o.company_id) : null,
      })).filter((o) => o.label)
    : [];

  // Map DB rows to UI form state
  const mappedData: RecordWithId[] = Array.isArray(dbData)
    ? dbData.map((item: any) => ({
        _id: String(item.id),
        docNo: item.DocNo ?? "",
        company: labelById(COMPANY_OPTIONS, item.company_id),
        project: labelById(PROJECT_OPTIONS, item.project_id),
        partyInvoiceGroup: {
          partyType: item.party_type ?? "",
          partyId: item.party_id ?? null,
          partyLabel: item.party_name ?? "",
          billId: item.bill_id ?? null,
          invoiceDocNo: item.invoice_doc_no ?? "",
          sourceType: item.invoice_source_type ?? null,
          companyId: item.company_id ?? null,
          projectId: item.project_id ?? null,
          originalDebitAmount: item.TotalAmount != null ? Number(item.TotalAmount) : 0,
        } as PartyInvoiceGroup,
        debitAmount: item.TotalAmount != null ? Number(item.TotalAmount) : null,
        items: Array.isArray(item.items)
          ? item.items.map((i: any) => ({
              Description: i.Description || "",
              Quantity: String(i.Quantity ?? ""),
              UOMSymbol: i.UOMSymbol || "",
              Rate: String(i.Rate ?? ""),
              Amount: String(i.Amount ?? ""),
            }))
          : [],
        debitDate: item.DebitDate ? String(item.DebitDate).slice(0, 10) : "",
        reason: item.Reason ?? "",
        status: Boolean(item.is_active),
        // Approval workflow state (Draft/Pending/Approved/Rejected/Cancelled)
        // — separate from `status`/is_active, which only tracks whether the
        // record has been soft-cancelled. Drives both the grid badge and
        // <ApprovalActions> below.
        approvalStatus: item.Status ?? "Draft",
        createdBy: item.created_by_name ?? null,
        createdAt: item.created_at ?? null,
      }))
    : [];

  const toPayload = (formData: Record<string, unknown>) => {
    const g = formData.partyInvoiceGroup as PartyInvoiceGroup | undefined;
    const isItemMode = isItemModeInvoice(g?.sourceType);
    const rawItems = (formData.items as DebitNoteItem[] | undefined) ?? [];
    return {
      company_id: idByLabel(COMPANY_OPTIONS, formData.company as string),
      project_id: idByLabel(PROJECT_OPTIONS, formData.project as string),
      party_id: g?.partyId ?? null,
      party_type: g?.partyType ?? null,
      bill_id: g?.billId ?? null,
      DebitDate: formData.debitDate as string,
      Reason: formData.reason as string,
      DebitAmount: isItemMode ? undefined : (parseFloat(String(formData.debitAmount ?? "")) || 0),
      items: isItemMode ? rawItems.filter((it) => it.Description.trim()) : [],
    };
  };

  const handleCustomSave = (formData: Record<string, unknown>) => {
    const g = formData.partyInvoiceGroup as PartyInvoiceGroup | undefined;
    if (!g?.partyType || !g?.partyId || !g?.billId) return null;
    if (isItemModeInvoice(g.sourceType)) {
      const items = (formData.items as DebitNoteItem[] | undefined) ?? [];
      const valid = items.filter((it) => it.Description.trim() && Number.isFinite(parseFloat(it.Amount)) && parseFloat(it.Amount) >= 0);
      if (!valid.length) return null;
    } else {
      const amt = parseFloat(String(formData.debitAmount ?? ""));
      if (!Number.isFinite(amt) || amt <= 0) return null;
    }
    return { ...formData, status: formData.status ?? true };
  };

  const handleDataEvent = async (event: any) => {
    if (event.action === "add") {
      try {
        await addDebitNote(toPayload(event.record));
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
        toast.success("Debit note saved!");
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
        throw err;
      }
    }
    if (event.action === "update") {
      try {
        await updateDebitNote(Number(event.id), toPayload(event.record));
        toast.success("Debit note updated!");
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
        throw err;
      }
    }
    if (event.action === "delete") {
      try {
        await deleteDebitNote(Number(event.id));
        toast.success("Debit note cancelled!");
        await queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      } catch (err: any) {
        toast.error("Cancel failed: " + err.message);
        throw err;
      }
    }
    return undefined;
  };

  // When an invoice resolves, auto-fill Company/Project from it — same
  // externalFormPatch mechanism the old bill picker used.
  const handleInvoiceResolved = (opt: DebitNoteInvoiceOption | null) => {
    if (!opt) {
      setAutoFillPatch({ company: "", project: "" });
      setAutoFillPatchKey((k) => k + 1);
      return;
    }
    const patch: Record<string, unknown> = {};
    const matchedCompany = opt.companyId != null ? COMPANY_OPTIONS.find((c) => c.id === opt.companyId) : null;
    patch.company = matchedCompany ? matchedCompany.label : "";
    const matchedProject = opt.projectId != null ? PROJECT_OPTIONS.find((p) => p.id === opt.projectId) : null;
    patch.project = matchedProject ? matchedProject.label : "";
    setAutoFillPatch(patch);
    setAutoFillPatchKey((k) => k + 1);
  };

  const fields: FieldDef[] = [
    {
      name: "partiesSection",
      label: "Company & Project",
      type: "section",
    },
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
      optionsProvider: (_data, _currentId, form) => {
        const companyOpt = COMPANY_OPTIONS.find((c) => c.label === (form?.company as string));
        const list = companyOpt
          ? PROJECT_OPTIONS.filter((p) => p.companyId == null || p.companyId === companyOpt.id)
          : PROJECT_OPTIONS;
        return list.map((p) => ({ value: p.label, label: p.label }));
      },
    },
    {
      name: "referenceSection",
      label: "Reference",
      type: "section",
    },
    {
      name: "debitDate",
      label: "Date",
      type: "date",
      required: true,
      defaultValue: new Date().toISOString().slice(0, 10),
    },
    {
      name: "partyInvoiceGroup",
      label: "Party & Invoice",
      type: "custom",
      required: true,
      fullWidth: true,
      render: (({ value, onChange, error, formData }) => (
        <PartyInvoiceRenderer
          value={value}
          onChange={onChange}
          error={error}
          formData={formData}
          onInvoiceResolved={handleInvoiceResolved}
        />
      )) as FieldDef["render"],
    },
    {
      // Amount mode only (direct/TOD invoice) — for a GRN/PO/WO-sourced
      // invoice the total instead comes from the "items" field below, so
      // this renders nothing and toPayload ignores it.
      name: "debitAmount",
      label: "Debit Note Amount",
      type: "custom",
      required: true,
      render: (({ value, onChange, error, formData }) => {
        const g = formData.partyInvoiceGroup as PartyInvoiceGroup | undefined;
        if (isItemModeInvoice(g?.sourceType)) return null;
        return (
          <input
            type="number"
            value={value != null ? (value as string | number) : ""}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border transition-all focus:outline-none focus:ring-2 focus:ring-primary text-foreground ${error ? "border-destructive" : "border-border"}`}
          />
        );
      }) as FieldDef["render"],
    },
    {
      // Item mode only (Material Request -> PO -> GRN, or Work Order -> PO
      // invoice) — the pre-rewrite line-item picker, restored side-by-side
      // with the amount adjuster above rather than replacing it.
      name: "items",
      label: "Items",
      type: "custom",
      fullWidth: true,
      render: (({ value, onChange, formData }) => {
        const g = formData.partyInvoiceGroup as PartyInvoiceGroup | undefined;
        if (!isItemModeInvoice(g?.sourceType)) return null;
        return <ItemsRenderer value={(value as DebitNoteItem[]) ?? []} onChange={onChange} />;
      }) as FieldDef["render"],
    },
    {
      name: "reason",
      label: "Remarks",
      type: "textarea",
    },
  ];

  const columns: ColumnDef[] = [
    { key: "docNo", label: "Doc No" },
    { key: "partyInvoiceGroup", label: "Party" },
    { key: "invoiceDisplay", label: "Invoice", hideOnMobile: true },
    { key: "debitAmount", label: "Debit Amount" },
    { key: "company", label: "Company", hideOnMobile: true },
    { key: "project", label: "Project", hideOnMobile: true },
    { key: "createdBy", label: "Created By", hideOnMobile: true },
    { key: "approvalStatus", label: "Status" },
  ];

  const APPROVAL_STATUS_BADGE: Record<string, string> = {
    Draft: "bg-muted text-muted-foreground border-border",
    Pending: "bg-amber-500/10 border-amber-500/20 text-amber-600",
    Approved: "bg-green-500/10 border-green-500/20 text-green-600",
    Rejected: "bg-red-500/10 border-red-500/20 text-red-600",
    Cancelled: "bg-muted text-muted-foreground border-border line-through",
  };

  const columnRenderers: Record<string, any> = {
    docNo: (value: unknown) =>
      value ? (
        <span className="font-mono text-xs text-primary">{String(value)}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      ),
    partyInvoiceGroup: (value: unknown) => {
      const g = value as PartyInvoiceGroup | undefined;
      if (!g?.partyLabel) return <span className="text-muted-foreground text-xs">—</span>;
      return (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-medium text-foreground">{g.partyLabel}</span>
          <span className="text-[10px] text-muted-foreground">{PARTY_TYPE_LABEL[g.partyType] ?? g.partyType}</span>
        </div>
      );
    },
    invoiceDisplay: (_value: unknown, row: RecordWithId) => {
      const g = row.partyInvoiceGroup as PartyInvoiceGroup | undefined;
      return g?.invoiceDocNo ? (
        <span className="text-xs font-mono text-foreground">{g.invoiceDocNo}</span>
      ) : (
        <span className="text-muted-foreground text-xs">—</span>
      );
    },
    debitAmount: (value: unknown) => (
      <span className="text-xs font-mono font-semibold text-foreground">{formatINR(value as number)}</span>
    ),
    createdBy: (value: unknown) =>
      value ? <span className="text-xs text-foreground font-body">{String(value)}</span> : <span className="text-muted-foreground text-xs">—</span>,
    approvalStatus: (value: unknown, row: RecordWithId) => {
      const status = row.status === false ? "Cancelled" : String(value ?? "Draft");
      return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${APPROVAL_STATUS_BADGE[status] ?? APPROVAL_STATUS_BADGE.Draft}`}>
          {status}
        </span>
      );
    },
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return (
      <div className="p-6 text-red-500">
        Failed to load debit notes. Check backend connection.
      </div>
    );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance Module", "Debit Note"]} />
      <MaterialShell title="Debit Note" subtitle="Value adjustments against Supplier, Contractor, Customer & Broker invoices" icon={FileWarning}>
      <MasterPage
        title="Debit Note"
        gridCols={2}
        fields={fields}
        columns={columns}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        rowActions={(row) => (
          <ApprovalActions
            status={row.status === false ? null : (row.approvalStatus as string)}
            recordId={row._id}
            endpoint="/api/debit-note"
            onSuccess={() => queryClient.invalidateQueries({ queryKey: ["debit-notes"] })}
          />
        )}
        onCustomSave={handleCustomSave}
        onFieldChange={(form, fieldName) => {
          if (fieldName === "company") {
            const companyOpt = COMPANY_OPTIONS.find((c) => c.label === (form.company as string));
            const projectOpt = PROJECT_OPTIONS.find((p) => p.label === (form.project as string));
            if (companyOpt && projectOpt && projectOpt.companyId != null && projectOpt.companyId !== companyOpt.id) {
              return { ...form, project: "" };
            }
          }
          return form;
        }}
        onDataEvent={handleDataEvent}
        externalFormPatch={autoFillPatch}
        externalFormPatchKey={autoFillPatchKey}
        exportConfig={rights.canExport ? {
          title: "Debit Note",
          filename: "debit-note",
          columns: [
            { header: "Doc No", accessor: "docNo" },
            { header: "Company", accessor: "company" },
            { header: "Project", accessor: "project" },
            { header: "Debit Amount", accessor: "debitAmount" },
            { header: "Created By", accessor: "createdBy" },
            { header: "Status", accessor: "approvalStatus" },
          ],
        } : undefined}
        viewConfig={{
          title: "Debit Note Details",
          fields: [
            { key: "docNo", label: "Doc No" },
            { key: "company", label: "Company" },
            { key: "project", label: "Project" },
            { key: "debitAmount", label: "Debit Amount" },
            { key: "reason", label: "Remarks" },
            { key: "createdBy", label: "Created By" },
            { key: "approvalStatus", label: "Status" },
          ],
        }}
        onPrint={(row) => {
          const win = window.open("", "_blank", "width=700,height=550");
          if (!win) return;
          const g = row.partyInvoiceGroup as PartyInvoiceGroup | undefined;
          win.document.write(safeHtml`
            <html><head><title>Debit Note</title>
            <style>body{font-family:sans-serif;padding:24px;color:#111}h2{margin-bottom:16px}table{border-collapse:collapse;width:100%}td{padding:6px 12px;border:1px solid #ddd;font-size:13px}td:first-child{font-weight:600;width:40%;background:#f5f5f5}</style>
            </head><body>
            <h2>Debit Note ${row.docNo || ""}</h2>
            <table>
              <tr><td>Party Type</td><td>${g ? (PARTY_TYPE_LABEL[g.partyType] ?? g.partyType) : "—"}</td></tr>
              <tr><td>Party</td><td>${g?.partyLabel || "—"}</td></tr>
              <tr><td>Invoice</td><td>${g?.invoiceDocNo || "—"}</td></tr>
              <tr><td>Company</td><td>${row.company || "—"}</td></tr>
              <tr><td>Project</td><td>${row.project || "—"}</td></tr>
              <tr><td>Debit Amount</td><td>${formatINR(row.debitAmount as number)}</td></tr>
              <tr><td>Remarks</td><td>${row.reason || "—"}</td></tr>
              <tr><td>Status</td><td>${row.status === false ? "Cancelled" : String(row.approvalStatus ?? "Draft")}</td></tr>
            </table>
            </body></html>
          `);
          win.document.close();
          win.print();
        }}
      />

      {/* ── Quality Rejection Debit Notes ─────────────────────────────────
          Separate feature/table (dbo.QualityRejectionDebitNote) — raised
          from a Vehicle In/Out or GRN entry when part of a delivery is
          found below the ordered grade on inspection. Read-only here;
          create/manage them from the originating Vehicle In/Out or GRN
          entry's "Received Items" list. */}
      <div className="rounded-xl bg-card border border-border overflow-hidden">
        <div className="flex items-center gap-3 px-5 sm:px-6 py-4 border-b border-border bg-muted/20">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-rose-500/10 border border-rose-500/20 shrink-0">
            <AlertTriangle size={14} className="text-rose-500" />
          </div>
          <div>
            <h2 className="font-heading font-semibold text-foreground text-sm">
              Quality Rejection Debit Notes
            </h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Raised from Vehicle In/Out & GRN entries when part of a delivery is below the ordered grade
            </p>
          </div>
        </div>

        {qualityDebitNotes.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No quality rejection debit notes yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Doc No</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Source</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Supplier</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Item</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">% Bad</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Amount</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Status</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {qualityDebitNotes.map((n) => (
                  <tr key={n.DebitNoteId} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">{n.DocNo}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {n.DebitDate ? String(n.DebitDate).slice(0, 10) : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-mono text-foreground">
                        {n.VehicleInOutDocNo ?? n.GRNDocNo ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground">{n.SupplierName ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs font-medium text-foreground">{n.ItemName ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {n.RejectedQty} of {n.ReceivedQty} {n.UomName ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600">
                        {Number(n.PercentBad).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-rose-600">
                      ₹{Number(n.Amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${
                          n.Status === "Cancelled"
                            ? "bg-muted text-muted-foreground line-through"
                            : "bg-emerald-500/10 text-emerald-600"
                        }`}
                      >
                        {n.Status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setViewingQDN(n)}
                        title="View details"
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Quality Rejection Debit Note — view modal ─────────────────── */}
      {/* Portalled to <body> — this page's fixed/z-index modals otherwise
          render behind MaterialShell's animated header, since the
          framer-motion page-transition wrapper somewhere up the tree gives
          `position: fixed` a transformed containing block instead of the
          viewport. */}
      {viewingQDN && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
          <div className="bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-rose-500/10 border border-rose-500/20 shrink-0">
                  <AlertTriangle size={13} className="text-rose-500" />
                </div>
                <div>
                  <h2 className="font-heading font-bold text-sm">{viewingQDN.DocNo}</h2>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                    Quality Rejection Debit Note
                  </p>
                </div>
              </div>
              <button
                onClick={() => setViewingQDN(null)}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Date", value: viewingQDN.DebitDate ? String(viewingQDN.DebitDate).slice(0, 10) : "—" },
                  { label: "Status", value: viewingQDN.Status },
                  { label: "Source Doc", value: viewingQDN.VehicleInOutDocNo ?? viewingQDN.GRNDocNo ?? "—", mono: true },
                  { label: "PO Number", value: viewingQDN.PONumber ?? "—", mono: true },
                  { label: "Supplier", value: viewingQDN.SupplierName ?? "—" },
                  { label: "Item", value: viewingQDN.ItemName ?? "—" },
                ].map(({ label, value, mono }: any) => (
                  <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                    <p className={`text-xs font-semibold ${mono ? "font-mono" : ""} text-foreground`}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Received</p>
                  <p className="text-xs font-semibold font-mono text-foreground">
                    {viewingQDN.ReceivedQty} {viewingQDN.UomName ?? ""}
                  </p>
                </div>
                <div className="px-3 py-2.5 rounded-xl bg-rose-500/5 border border-rose-500/20">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Rejected</p>
                  <p className="text-xs font-semibold font-mono text-rose-600">
                    {viewingQDN.RejectedQty} {viewingQDN.UomName ?? ""}
                  </p>
                </div>
                <div className="px-3 py-2.5 rounded-xl bg-rose-500/5 border border-rose-500/20">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">% Bad</p>
                  <p className="text-xs font-semibold font-mono text-rose-600">
                    {Number(viewingQDN.PercentBad).toFixed(1)}%
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Rate</p>
                  <p className="text-xs font-semibold font-mono text-foreground">
                    ₹{Number(viewingQDN.Rate).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="px-3 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                  <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Debit Amount</p>
                  <p className="text-sm font-bold font-mono text-rose-600">
                    ₹{Number(viewingQDN.Amount).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {viewingQDN.Reason && (
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-2">
                    Reason
                  </p>
                  <p className="text-sm text-foreground bg-muted/40 rounded-xl px-4 py-3 border border-border/50">
                    {viewingQDN.Reason}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
      </MaterialShell>
    </>
  );
};

export default DebitNoteMaster;
