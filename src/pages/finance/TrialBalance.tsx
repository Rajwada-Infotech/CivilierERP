import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FinanceShell } from "@/components/finance/FinanceShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatINR } from "@/utils/formatCurrency";
import { ExportMenu } from "@/components/ExportMenu";
import type { ExportColumn } from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Search,
  TrendingUp,
  TrendingDown,
  Scale,
  IndianRupee,
  CalendarDays,
  Folder,
  FolderOpen,
  Building,
  Briefcase,
  FolderKanban,
  Calendar,
  CalendarRange,
  CalendarCheck,
  Loader2,
  Receipt,
  X,
  Target,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BalancePair {
  debit: number;
  credit: number;
}

interface TBNode {
  id: number;
  name: string;
  code?: string | null;
  level: number;
  isGroup: boolean;
  type?: string;
  children: TBNode[];
  opening: BalancePair;
  transactions: BalancePair;
  closing: BalancePair;
}

interface TBSummary {
  totalDebit: number;
  totalCredit: number;
  openingDebit: number;
  openingCredit: number;
}

interface TBResponse {
  rows: TBNode[];
  summary: TBSummary;
  asOf: string;
  from: string;
  to: string;
}

// ─── Drill-down (Level 2/3) ─────────────────────────────────────────────────
interface TBTransaction {
  entryId: number;
  voucherNo: string | null;
  date: string | null;
  debit: number;
  credit: number;
  narration: string | null;
  sourceType: string | null;
  sourceId: number | null;
  invoiceNo: string | null;
  payment: { id: number; docNo: string | null; mode: string | null; status: string | null } | null;
  costCenter: { id: number; code: string | null; name: string | null } | null;
  fixedAsset: {
    assetId: number;
    assetCode: string | null;
    assetName: string | null;
    faItemCode: string | null;
    finYear: string | null;
  } | null;
}

interface TBTransactionsResponse {
  entity: { id: number; name: string; type: string };
  from: string;
  to: string;
  transactions: TBTransaction[];
}

// One row per GL posting tagged to a Cost Centre — an individual PO/GRN/
// Invoice entry with its own debit/credit, not netted into an account
// group total (see /cost-centre/:id/transactions).
interface CCTransaction {
  entryId: number;
  voucherNo: string | null;
  date: string | null;
  debit: number;
  credit: number;
  narration: string | null;
  sourceType: string | null;
  sourceId: number | null;
  account: { id: number; name: string | null; type: string | null };
  docNo: string | null;
  poNo: string | null;
}

interface CCTransactionsResponse {
  costCenter: { id: number; code: string | null; name: string | null };
  from: string;
  to: string;
  transactions: CCTransaction[];
  totals: { debit: number; credit: number };
}

interface Option {
  id: number;
  label: string;
  belongs_to?: string;
  company_id?: number;
  enterprise_id?: number;
}

interface FinYearRow {
  FId: number;
  FName: string;
  FStartDate: string;
  FEndDate: string;
  FStatus?: number | boolean;
  FisLocked?: number | boolean;
}

type FilterMode = "fy" | "range" | "ason";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) => (n === 0 ? "—" : formatINR(n));

function fmtDate(s: string) {
  if (!s) return "";
  return new Date(s).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function toDateStr(s: string) {
  return s ? s.slice(0, 10) : "";
}

const TYPE_DOT: Record<string, string> = {
  S: "bg-blue-400",
  C: "bg-orange-400",
  B: "bg-emerald-400",
  A: "bg-purple-400",
  GL: "bg-primary/70",
};
const TYPE_LABEL: Record<string, string> = {
  S: "Supplier",
  C: "Contractor",
  B: "Bank",
  A: "Customer",
  GL: "GL",
};

// Does this single node (ignoring children) have any nonzero value?
function nodeHasOwnValue(n: TBNode): boolean {
  return (
    n.opening.debit !== 0 ||
    n.opening.credit !== 0 ||
    n.transactions.debit !== 0 ||
    n.transactions.credit !== 0 ||
    n.closing.debit !== 0 ||
    n.closing.credit !== 0
  );
}

// Prune the tree to only the branches that have activity somewhere in their
// subtree. A group is kept (with ALL of its ancestors) as long as it, or any
// descendant, has a nonzero opening/transaction/closing value — i.e. the
// "whole nest" stays visible whenever there's a transaction anywhere in it.
// Groups whose entire subtree is all-zero are dropped.
function pruneToActive(nodes: TBNode[]): TBNode[] {
  function walk(n: TBNode): TBNode | null {
    const keptChildren = n.children
      .map(walk)
      .filter((c): c is TBNode => c !== null);
    const keep = nodeHasOwnValue(n) || keptChildren.length > 0;
    if (!keep) return null;
    return { ...n, children: keptChildren };
  }
  return nodes.map(walk).filter((n): n is TBNode => n !== null);
}

function flattenVisible(
  nodes: TBNode[],
  expanded: Set<number>,
  search: string,
): TBNode[] {
  const result: TBNode[] = [];
  const q = search.toLowerCase();

  // Returns true if this node or any descendant matches the query
  function hasMatch(n: TBNode): boolean {
    if (!q) return true;
    if (n.name.toLowerCase().includes(q) || (n.code ?? "").toLowerCase().includes(q)) return true;
    return n.children.some(hasMatch);
  }

  // parentMatched: an ancestor already satisfied the query — show all descendants
  function walk(n: TBNode, parentMatched: boolean) {
    const selfMatches = !q || n.name.toLowerCase().includes(q) || (n.code ?? "").toLowerCase().includes(q);
    const visible = parentMatched || selfMatches || n.children.some(hasMatch);
    if (!visible) return;
    result.push(n);
    if (expanded.has(n.id) || q) {
      // If this node itself matched, all its children are shown regardless of query
      const childParentMatched = parentMatched || selfMatches;
      n.children.forEach((c) => walk(c, childParentMatched));
    }
  }

  nodes.forEach((n) => walk(n, false));
  return result;
}

// Flatten entire tree for export (ignores expand state, exports everything)
function flattenAll(nodes: TBNode[]): TBNode[] {
  const result: TBNode[] = [];
  function walk(n: TBNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

// ─── Export column definitions ────────────────────────────────────────────────

const TB_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Account", accessor: "name" },
  { header: "Code", accessor: "code" },
  {
    header: "Type",
    accessor: (r) => ((r as any).isGroup ? "Group" : ((r as any).type ?? "")),
  },
  {
    header: "Opening Dr",
    accessor: (r) => formatINR((r as any).opening?.debit ?? 0),
  },
  {
    header: "Opening Cr",
    accessor: (r) => formatINR((r as any).opening?.credit ?? 0),
  },
  {
    header: "Transaction Dr",
    accessor: (r) => formatINR((r as any).transactions?.debit ?? 0),
  },
  {
    header: "Transaction Cr",
    accessor: (r) => formatINR((r as any).transactions?.credit ?? 0),
  },
  {
    header: "Closing Dr",
    accessor: (r) => formatINR((r as any).closing?.debit ?? 0),
  },
  {
    header: "Closing Cr",
    accessor: (r) => formatINR((r as any).closing?.credit ?? 0),
  },
];

// ─── TBRow ────────────────────────────────────────────────────────────────────

function TBRow({
  node,
  expanded,
  onToggle,
  onDrill,
  isDrillOpen,
  drillLoading,
  drillData,
  onOpenSource,
}: {
  node: TBNode;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onDrill: (node: TBNode) => void;
  isDrillOpen: boolean;
  drillLoading: boolean;
  drillData: TBTransactionsResponse | null;
  onOpenSource: (t: TBTransaction) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasKids = node.children.length > 0;
  const indent = node.level * 20;
  const hasAnyValue =
    node.opening.debit > 0 ||
    node.opening.credit > 0 ||
    node.transactions.debit > 0 ||
    node.transactions.credit > 0;
  const dot = node.type ? TYPE_DOT[node.type] : null;
  const isDrillable = !node.isGroup;

  return (
    <>
    <tr
      onClick={isDrillable ? () => onDrill(node) : undefined}
      className={`border-b border-border/40 transition-colors ${
        node.isGroup
          ? node.level === 0
            ? "bg-muted/35 hover:bg-muted/50"
            : "bg-muted/15 hover:bg-muted/28"
          : isDrillOpen
            ? "bg-primary/8 hover:bg-primary/10"
            : "hover:bg-primary/5 cursor-pointer"
      }`}
    >
      <td className="py-2.5 pr-3" style={{ paddingLeft: `${indent + 14}px` }}>
        <div className="flex items-center gap-2">
          {node.isGroup && hasKids ? (
            <button
              onClick={() => onToggle(node.id)}
              className="flex items-center justify-center w-4 h-4 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {node.isGroup ? (
            <span className="shrink-0 text-amber-400/80">
              {isOpen && hasKids ? (
                <FolderOpen size={13} />
              ) : (
                <Folder size={13} />
              )}
            </span>
          ) : dot ? (
            <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
          ) : (
            <span className="w-2 shrink-0" />
          )}

          <span
            className={`text-sm leading-tight ${
              node.isGroup
                ? node.level === 0
                  ? "font-heading font-bold text-foreground tracking-wide uppercase text-[11px]"
                  : "font-heading font-semibold text-foreground/90 text-xs uppercase tracking-wide"
                : "text-foreground/80 text-xs"
            }`}
          >
            {node.name}
          </span>

          {node.code && (
            <span className="text-[10px] font-mono text-muted-foreground/50">
              {node.code}
            </span>
          )}
          {!node.isGroup && node.type && (
            <span className="text-[9px] font-heading uppercase tracking-wider text-muted-foreground/40">
              {TYPE_LABEL[node.type] ?? node.type}
            </span>
          )}
          {!node.isGroup && !hasAnyValue && (
            <span className="text-[10px] text-muted-foreground/35 italic ml-0.5">
              no transactions
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-l border-border/30">
        {fmt(node.opening.debit)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-r border-border/30">
        {fmt(node.opening.credit)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground">
        {fmt(node.transactions.debit)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-xs text-foreground border-r border-border/30">
        {fmt(node.transactions.credit)}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums text-xs font-medium ${node.closing.debit > 0 ? "text-rose-400" : "text-muted-foreground/35"}`}
      >
        {fmt(node.closing.debit)}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums text-xs font-medium ${node.closing.credit > 0 ? "text-emerald-400" : "text-muted-foreground/35"}`}
      >
        {fmt(node.closing.credit)}
      </td>
    </tr>

    {/* ── Inline drill-down panel ───────────────────────────────────── */}
    {isDrillOpen && (
      <tr>
        <td colSpan={7} className="p-0">
          <div className="mx-4 my-2 rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
            {/* Header bar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/15 bg-primary/8">
              <Receipt size={13} className="text-primary shrink-0" />
              <span className="text-xs font-heading font-semibold text-primary">{node.name}</span>
              <span className="text-[10px] text-muted-foreground/60 ml-1">
                {node.type ? (TYPE_LABEL[node.type] ?? node.type) : ""} · transactions in period
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); onDrill(node); }}
                className="ml-auto w-5 h-5 flex items-center justify-center rounded hover:bg-primary/15 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={11} />
              </button>
            </div>

            {drillLoading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-xs">
                <Loader2 size={14} className="animate-spin" /> Loading transactions…
              </div>
            ) : !drillData || drillData.transactions.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                No transactions found for this entity in the selected period.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card/95 backdrop-blur-sm z-10">
                    <tr className="border-b border-border text-left text-muted-foreground uppercase text-[10px] tracking-wide">
                      <th className="px-3 py-2">Voucher No.</th>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Source / Entry</th>
                      <th className="px-3 py-2">Invoice No.</th>
                      <th className="px-3 py-2">Mode</th>
                      <th className="px-3 py-2">Fixed Asset</th>
                      <th className="px-3 py-2">Cost Centre</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Credit</th>
                      <th className="px-3 py-2">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillData.transactions.map((t, ti) => {
                      const st = (t.sourceType ?? "").toLowerCase();
                      const isPending = (t as any).status !== "posted" && !(t as any).entryId;
                      const badge = st === "newpayment"      ? { label: "Payment",    cls: "bg-blue-500/10 text-blue-500" }
                                  : st === "receivedpayment" ? { label: "Received",   cls: "bg-emerald-500/10 text-emerald-600" }
                                  : st === "expensebooking"  ? { label: "Expense Bkg",cls: "bg-amber-500/10 text-amber-600" }
                                  : st === "invoiceposting"  ? { label: "Invoice",    cls: "bg-amber-500/10 text-amber-600" }
                                  : st === "grn" || st === "grnposting" ? { label: "GRN", cls: "bg-violet-500/10 text-violet-500" }
                                  : st === "journalvoucher"  ? { label: "JV",         cls: "bg-rose-500/10 text-rose-500" }
                                  : st === "onaccountledger" ? { label: "On Account", cls: "bg-cyan-500/10 text-cyan-600" }
                                  : { label: t.sourceType ?? "Entry", cls: "bg-muted text-muted-foreground" };

                      const ref = (t as any).sourceRef as { id: number; docNo: string; type: string } | null;
                      const displayDoc = (t as any).docNo || t.voucherNo || (ref?.docNo) || "—";
                      // Every row with a resolvable source (a linked
                      // payment, or a sourceId the switch in openSourceEntry
                      // knows how to open) drills through — not just
                      // payments.
                      const isClickable = (st === "newpayment" && !!t.payment) || !!t.sourceId;

                      return (
                        <tr
                          key={t.entryId ?? `direct-${ti}`}
                          onClick={(e) => { e.stopPropagation(); if (isClickable) onOpenSource(t); }}
                          className={`border-b border-border/30 ${isPending ? "opacity-70 bg-muted/20" : ""} ${isClickable ? "cursor-pointer hover:bg-primary/8" : ""}`}
                        >
                          <td className="px-3 py-1.5 font-mono text-[11px]">{t.voucherNo || "—"}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{t.date ? fmtDate(t.date) : "—"}</td>
                          <td className="px-3 py-1.5">
                            <span className="inline-flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[9px] font-heading uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>
                                {badge.label}
                              </span>
                              {isPending && (
                                <span className="text-[9px] font-heading uppercase tracking-wide px-1.5 py-0.5 rounded font-medium bg-yellow-500/10 text-yellow-600">
                                  Pending
                                </span>
                              )}
                              <span className={`font-mono text-[11px] ${isClickable ? "text-primary underline" : "text-foreground/70"}`}>
                                {displayDoc}
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-[11px]">{t.invoiceNo || "—"}</td>
                          <td className="px-3 py-1.5 text-[11px]">{(t as any).mode || t.payment?.mode || "—"}</td>
                          <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
                            {t.fixedAsset ? (
                              <span
                                title={[
                                  t.fixedAsset.assetCode,
                                  t.fixedAsset.assetName,
                                  t.fixedAsset.finYear,
                                ].filter(Boolean).join(" · ")}
                              >
                                {t.fixedAsset.faItemCode || t.fixedAsset.assetCode || `Asset #${t.fixedAsset.assetId}`}
                                {t.fixedAsset.finYear ? (
                                  <span className="text-muted-foreground/60"> · {t.fixedAsset.finYear}</span>
                                ) : null}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-[11px] text-muted-foreground">
                            {t.costCenter
                              ? `${t.costCenter.code ?? ""}${t.costCenter.code ? " - " : ""}${t.costCenter.name ?? ""}`
                              : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-rose-400">{t.debit ? fmt(t.debit) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-emerald-400">{t.credit ? fmt(t.credit) : "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[160px] text-[11px]">{t.narration || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

// ─── CostCentrePanel ──────────────────────────────────────────────────────────
// Individual PO/GRN/Invoice postings tagged to a Cost Centre, each with its
// own debit/credit — distinct from the account-group tree above (which nets
// everything into one balance per account). This answers "what did this
// cost centre actually cost, and against which PO", not "what's this
// account's balance".
function CostCentrePanel({
  data,
  loading,
}: {
  data: CCTransactionsResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm">
        <Loader2 className="h-5 w-5 animate-spin inline mb-2" />
        <p>Loading cost centre transactions…</p>
      </div>
    );
  }
  if (!data || data.transactions.length === 0) {
    return (
      <div className="py-16 text-center text-muted-foreground text-sm px-4">
        No postings found for this cost centre in the selected period.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-border border-b border-border">
        <div className="px-5 py-4">
          <p className="text-sm font-bold font-heading leading-none">
            {data.costCenter.code} - {data.costCenter.name}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
            Cost Centre
          </p>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm font-bold font-heading leading-none text-rose-400">
            {fmt(data.totals.debit)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
            Total Debit
          </p>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm font-bold font-heading leading-none text-emerald-400">
            {fmt(data.totals.credit)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
            Total Credit
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-[10px] font-heading uppercase tracking-widest text-muted-foreground">
              <th className="px-4 py-2">Voucher No.</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">PO / Doc</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2">Narration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {data.transactions.map((t) => (
              <tr key={t.entryId} className="hover:bg-muted/10">
                <td className="px-4 py-2 font-mono text-xs">{t.voucherNo || "—"}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {t.date ? fmtDate(t.date) : "—"}
                </td>
                <td className="px-3 py-2 text-xs">{t.account.name || "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {t.poNo ? (
                    <span className="font-mono text-primary">{t.poNo}</span>
                  ) : (
                    "—"
                  )}
                  {t.docNo && t.docNo !== t.poNo && (
                    <span className="block text-[10px] text-muted-foreground font-mono">
                      {t.docNo}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-rose-400">
                  {t.debit ? fmt(t.debit) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-emerald-400">
                  {t.credit ? fmt(t.credit) : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-[200px]">
                  {t.narration || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── FilterSelect ─────────────────────────────────────────────────────────────

function FilterSelect({
  label,
  icon: Icon,
  value,
  onChange,
  options,
  placeholder,
  loading: isLoading,
}: {
  label: string;
  icon: React.ElementType;
  value: number | null;
  onChange: (id: number | null, opt: Option | null) => void;
  options: Option[];
  placeholder: string;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 w-full sm:min-w-[140px] sm:w-auto">
      <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
        <Icon size={9} /> {label}
      </span>
      <div className="relative">
        <select
          value={value ?? ""}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null;
            onChange(
              id,
              id ? (options.find((o) => o.id === id) ?? null) : null,
            );
          }}
          disabled={isLoading}
          className="h-8 w-full pl-2.5 pr-7 rounded-lg text-xs bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 appearance-none disabled:opacity-50 cursor-pointer"
        >
          <option value="">{isLoading ? "Loading…" : placeholder}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={11}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
        />
      </div>
    </div>
  );
}

// ─── Mode Tab ─────────────────────────────────────────────────────────────────

function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-heading font-semibold tracking-wide transition-all border ${
        active
          ? "bg-primary text-white border-primary shadow-sm"
          : "bg-background text-muted-foreground border-border hover:text-foreground hover:bg-muted"
      }`}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

// ─── DateField ────────────────────────────────────────────────────────────────

function DateField({
  label,
  value,
  onChange,
  highlight = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-center h-8 rounded-lg border text-xs overflow-hidden ${
      highlight ? "border-primary/50 ring-1 ring-primary/20" : "border-border"
    } bg-background`}>
      <span className={`flex items-center gap-1 px-2 h-full border-r text-[9px] font-heading uppercase tracking-wider whitespace-nowrap select-none ${
        highlight ? "border-primary/30 text-primary/70 bg-primary/5" : "border-border text-muted-foreground/60 bg-muted/40"
      }`}>
        <CalendarDays size={10} />
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full px-2 text-xs bg-transparent text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:opacity-40 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer"
      />
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TrialBalance() {
  const rights = usePageRights("trial-balance");
  // ── filter mode ───────────────────────────────────────────────────────────
  const [filterMode, setFilterMode] = useState<FilterMode>("fy");

  // ── fin year master ───────────────────────────────────────────────────────
  const [finYears, setFinYears] = useState<FinYearRow[]>([]);
  const [finYearsLoading, setFinYearsLoading] = useState(true);
  const [selectedFYId, setSelectedFYId] = useState<number | null>(null);
  const selectedFY = finYears.find((f) => f.FId === selectedFYId) ?? null;

  // ── period dates ──────────────────────────────────────────────────────────
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [asOn, setAsOn] = useState("");

  // ── entity filters ────────────────────────────────────────────────────────
  const [enterprises, setEnterprises] = useState<Option[]>([]);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [projects, setProjects] = useState<Option[]>([]);
  const [allCompanies, setAllCompanies] = useState<Option[]>([]);
  const [allProjects, setAllProjects] = useState<Option[]>([]);
  const [costCenters, setCostCenters] = useState<Option[]>([]);
  const [selEnterprise, setSelEnterprise] = useState<Option | null>(null);
  const [selCompany, setSelCompany] = useState<Option | null>(null);
  const [selProject, setSelProject] = useState<Option | null>(null);
  const [selCostCenter, setSelCostCenter] = useState<Option | null>(null);

  // ── data ──────────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<TBNode[]>([]);
  const [summary, setSummary] = useState<TBSummary | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  // ── drill-down (Level 2: entity transactions) ───────────────────────────
  const [drillNode, setDrillNode] = useState<TBNode | null>(null);
  const [drillData, setDrillData] = useState<TBTransactionsResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // ── Level 3: payment detail dialog ───────────────────────────────────────
  const [payDetail, setPayDetail] = useState<Record<string, any> | null>(null);
  const [payDetailLoading, setPayDetailLoading] = useState(false);

  // ── Cost Centre view — replaces the account tree when a cost centre is
  // selected, showing individual PO/GRN/Invoice postings instead of an
  // account-group rollup ────────────────────────────────────────────────────
  const [ccData, setCcData] = useState<CCTransactionsResponse | null>(null);
  const [ccLoading, setCcLoading] = useState(false);

  // ── load fin years ────────────────────────────────────────────────────────
  useEffect(() => {
    setFinYearsLoading(true);
    fetchWithAuth("/api/fin-year")
      .then((r) => (r.ok ? r.json().catch(() => ({})) : []))
      .then((data: FinYearRow[]) => {
        // All active fin years are selectable — including locked ones for historical audit
        const unlocked = data.filter(
          (f) => f.FStatus === 1 || f.FStatus === true,
        );
        const sorted = [...unlocked].sort(
          (a, b) =>
            new Date(b.FEndDate).getTime() - new Date(a.FEndDate).getTime(),
        );
        setFinYears(sorted);
        if (sorted.length > 0) {
          const active =
            sorted.find((f) => f.FStatus === 1 || f.FStatus === true) ??
            sorted[0];
          setSelectedFYId(active.FId);
          const f = toDateStr(active.FStartDate);
          const t = toDateStr(active.FEndDate);
          setFrom(f);
          setTo(t);
        }
      })
      .catch(() => {})
      .finally(() => setFinYearsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── load entity options ───────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const [eRes, cRes, pRes, ccRes] = await Promise.all([
          fetchWithAuth("/api/enterprises/options?business_type=E"),
          fetchWithAuth("/api/enterprises/options?business_type=C"),
          fetchWithAuth("/api/enterprises/options?business_type=P"),
          fetchWithAuth("/api/cost-center/options"),
        ]);
        if (eRes.ok) setEnterprises(await eRes.json());
        if (cRes.ok) {
          const d = await cRes.json();
          setAllCompanies(d);
          setCompanies(d);
        }
        if (pRes.ok) {
          const d = await pRes.json();
          setAllProjects(d);
          setProjects(d);
        }
        if (ccRes.ok) {
          const d = await ccRes.json();
          setCostCenters(
            (Array.isArray(d) ? d : []).map((c: any) => ({
              id: c.id,
              label: c.code ? `${c.code} - ${c.label}` : c.label,
            })),
          );
        }
      } catch {
        /* silent */
      }
    }
    load();
  }, []);

  // ── cascade handlers ──────────────────────────────────────────────────────
  // Filters narrow the available options but each is independently selectable.
  // Selecting Enterprise scopes the Company list; selecting Company scopes the
  // Project list. But you can also pick a Company or Project without first
  // choosing a parent — the dropdowns just show their full lists in that case.
  function handleEnterpriseChange(id: number | null, opt: Option | null) {
    setSelEnterprise(opt);
    // Narrow child lists but don't force-clear existing selections
    const filteredCompanies = id ? allCompanies.filter((c) => c.enterprise_id === id) : allCompanies;
    setCompanies(filteredCompanies);
    // Only clear company/project if the current selection is no longer in scope
    if (selCompany && id && !filteredCompanies.some((c) => c.id === selCompany.id)) {
      setSelCompany(null);
      setProjects(allProjects);
      setSelProject(null);
    }
  }
  function handleCompanyChange(id: number | null, opt: Option | null) {
    setSelCompany(opt);
    const filteredProjects = id
      ? allProjects.filter((p) => p.company_id === id)
      : selEnterprise
        ? allProjects.filter((p) =>
            allCompanies
              .filter((c) => c.enterprise_id === selEnterprise.id)
              .some((c) => c.id === p.company_id),
          )
        : allProjects;
    setProjects(filteredProjects);
    if (selProject && id && !filteredProjects.some((p) => p.id === selProject.id)) {
      setSelProject(null);
    }
  }

  // ── FY selection ──────────────────────────────────────────────────────────
  function handleFYChange(id: number | null) {
    setSelectedFYId(id);
    const fy = finYears.find((f) => f.FId === id);
    if (fy) {
      setFrom(toDateStr(fy.FStartDate));
      setTo(toDateStr(fy.FEndDate));
    }
  }

  // ── mode switch ───────────────────────────────────────────────────────────
  function switchMode(mode: FilterMode) {
    setFilterMode(mode);
    if (mode === "fy" && selectedFY) {
      setFrom(toDateStr(selectedFY.FStartDate));
      setTo(toDateStr(selectedFY.FEndDate));
      setAsOn("");
    }
  }

  // ── effective params per mode ─────────────────────────────────────────────
  function getEffectiveParams() {
    if (filterMode === "ason") return { f: from, t: asOn || to, ao: asOn };
    return { f: from, t: to, ao: "" };
  }

  // ── drill-down: Level 1 (ledger) → Level 2 (entity transactions) ─────────
  // Reuses the exact same filters (FY/date range/company/project) the main
  // report is showing, so the transaction list never drifts from what's on
  // screen.
  const openDrillDown = useCallback(
    async (node: TBNode) => {
      // Toggle: clicking the same row closes it
      if (drillNode?.id === node.id) {
        setDrillNode(null);
        setDrillData(null);
        return;
      }
      setDrillNode(node);
      setDrillData(null);
      setDrillLoading(true);
      try {
        const { f, t, ao } = getEffectiveParams();
        const effectiveTo = ao || t;
        let url = `/api/trial-balance/${node.id}/transactions?from=${f}&to=${effectiveTo}`;
        if (selEnterprise?.id) url += `&enterpriseId=${selEnterprise.id}`;
        if (selCompany?.id) url += `&companyId=${selCompany.id}`;
        if (selProject?.id) url += `&projectId=${selProject.id}`;
        if (selCostCenter?.id) url += `&costCenterId=${selCostCenter.id}`;
        const res = await fetchWithAuth(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setDrillData(await res.json());
      } catch {
        setDrillData(null);
      } finally {
        setDrillLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filterMode, from, to, asOn, selCompany, selProject, selCostCenter],
  );

  // Level 3 — open detail dialog for a transaction row.
  const openSourceEntry = useCallback(async (t: TBTransaction) => {
    const srcType = (t.sourceType ?? "").toUpperCase();
    const payId = t.payment?.id ?? (srcType === "NEWPAYMENT" ? t.sourceId : null);

    if (payId) {
      // Payment: fetch full detail and show inline dialog
      setPayDetail(null);
      setPayDetailLoading(true);
      try {
        const res = await fetchWithAuth(`/api/new-payment/${payId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPayDetail(await res.json());
      } catch {
        setPayDetail({ _error: true });
      } finally {
        setPayDetailLoading(false);
      }
      return;
    }

    if (!t.sourceId) return;

    // Every source type navigates straight to that document's own real
    // detail/form view via its ?view= deep link — same pattern across the
    // board (Invoice/Expense Booking used to open its own inline preview
    // popup here instead, which was one extra step short of ever reaching
    // the real form). srcType here is t.sourceType.toUpperCase() straight
    // from GeneralLedgerEntry.SourceType (see backend/routes/trialBalance.js).
    switch (srcType) {
      case "EXPENSEBOOKING":
      case "INVOICEPOSTING":
        navigate(`/material/expense-booking?view=${t.sourceId}`); break;
      case "RECEIVEDPAYMENT":
      case "RECEIPT":
        navigate(`/received-payments?view=${t.sourceId}`); break;
      case "PURCHASE_ORDER":
      case "PO":
        navigate(`/material/purchase-order?view=${t.sourceId}`); break;
      case "GRN":
      case "GRNPOSTING":
        navigate(`/material/grn?view=${t.sourceId}`); break;
      case "JOURNAL":
      case "JV":
      case "JOURNALVOUCHER":
        navigate(`/journal-voucher?view=${t.sourceId}`); break;
      default:
        break;
    }
  }, [navigate]);

  // ── export/refresh disabled? ──────────────────────────────────────────────
  const notReady =
    loading ||
    (filterMode === "fy" && !selectedFYId) ||
    (filterMode === "range" && (!from || !to)) ||
    (filterMode === "ason" && !asOn);

  // ── fetch ─────────────────────────────────────────────────────────────────
  async function fetchDataInner(f: string, t: string, ao: string) {
    if (!f || !t) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const effectiveTo = ao || t;
      let url = `/api/trial-balance?from=${f}&to=${effectiveTo}`;
      if (selEnterprise?.id) url += `&enterpriseId=${selEnterprise.id}`;
      if (selCompany?.id) url += `&companyId=${selCompany.id}`;
      if (selProject?.id) url += `&projectId=${selProject.id}`;
      if (selCostCenter?.id) url += `&costCenterId=${selCostCenter.id}`;
      const res = await fetchWithAuth(url, { signal: abortRef.current.signal });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data: TBResponse = await res.json();
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setAsOf(data.asOf ?? null);
      setExpanded(new Set(data.rows.map((r) => r.id)));
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const fetchData = useCallback(() => {
    const { f, t, ao } = getEffectiveParams();
    fetchDataInner(f, t, ao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterMode, from, to, asOn, selCompany, selProject, selCostCenter]);

  // Auto-fetch whenever filter params change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Cost Centre view — fetch the individual-postings list whenever a cost
  // centre is selected (or the period/company/project it's scoped to
  // changes); cleared the moment the cost centre filter is cleared.
  useEffect(() => {
    if (!selCostCenter?.id) {
      setCcData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setCcLoading(true);
      try {
        const { f, t, ao } = getEffectiveParams();
        const effectiveTo = ao || t;
        let url = `/api/trial-balance/cost-centre/${selCostCenter.id}/transactions?from=${f}&to=${effectiveTo}`;
        if (selCompany?.id) url += `&companyId=${selCompany.id}`;
        if (selProject?.id) url += `&projectId=${selProject.id}`;
        const res = await fetchWithAuth(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) setCcData(await res.json());
      } catch {
        if (!cancelled) setCcData(null);
      } finally {
        if (!cancelled) setCcLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selCostCenter, filterMode, from, to, asOn, selCompany, selProject]);

  // ── expand / collapse ─────────────────────────────────────────────────────
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const expandAll = () => {
    const ids = new Set<number>();
    function collect(n: TBNode) {
      ids.add(n.id);
      n.children.forEach(collect);
    }
    rows.forEach(collect);
    setExpanded(ids);
  };

  // ── derived ───────────────────────────────────────────────────────────────
  const displayRows = hideEmpty ? pruneToActive(rows) : rows;
  const visible = flattenVisible(displayRows, expanded, search);
  const balanced = summary
    ? Math.abs(
        summary.openingDebit +
          summary.totalDebit -
          (summary.openingCredit + summary.totalCredit),
      ) < 1
    : false;

  // Export: flat list of all nodes with a depth-indent prefix so groups are legible in PDF/CSV.
  // NOTE: must be a Latin-1 character — jsPDF's built-in Helvetica font only
  // covers Latin-1, and sanitizeForPdf() replaces anything outside that range
  // with "?". The "▸" glyph used here previously was outside Latin-1, so every
  // group name was getting a literal "?" prefix in the exported PDF.
  const exportData = flattenAll(displayRows).map((n) => ({
    ...n,
    name: `${"  ".repeat(n.level)}${n.isGroup ? "> " : ""}${n.name}`,
  })) as unknown as Record<string, unknown>[];

  // Period label for chips + PDF subtitle
  function periodLabel() {
    if (filterMode === "fy" && selectedFY) return selectedFY.FName;
    if (filterMode === "range" && from && to)
      return `${fmtDate(from)} – ${fmtDate(to)}`;
    if (filterMode === "ason" && asOn) return `As On ${fmtDate(asOn)}`;
    return null;
  }

  const exportSubtitle = [
    selEnterprise ? `Enterprise: ${selEnterprise.label}` : null,
    selCompany ? `Company: ${selCompany.label}` : null,
    selProject ? `Project: ${selProject.label}` : null,
    periodLabel() ? `Period: ${periodLabel()}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const statCards = summary
    ? [
        {
          label: "Transaction Debit",
          value: formatINR(summary.totalDebit),
          Icon: TrendingUp,
          color: "text-rose-400",
          bg: "bg-rose-400/10",
          border: "border-l-rose-400",
        },
        {
          label: "Transaction Credit",
          value: formatINR(summary.totalCredit),
          Icon: TrendingDown,
          color: "text-emerald-400",
          bg: "bg-emerald-400/10",
          border: "border-l-emerald-400",
        },
        {
          label: "Net Balance",
          value: formatINR(Math.abs(summary.totalDebit - summary.totalCredit)),
          Icon: Scale,
          color: balanced ? "text-emerald-400" : "text-amber-400",
          bg: balanced ? "bg-emerald-400/10" : "bg-amber-400/10",
          border: balanced ? "border-l-emerald-400" : "border-l-amber-400",
        },
        {
          label: "Opening Balance",
          value: formatINR(summary.openingDebit + summary.openingCredit),
          Icon: IndianRupee,
          color: "text-primary",
          bg: "bg-primary/10",
          border: "border-l-primary",
        },
      ]
    : [];

  // PDF stat cards (matches PdfStatCard[] shape)
  const pdfStats = summary
    ? [
        {
          label: "Opening Balance",
          value: formatINR(summary.openingDebit + summary.openingCredit),
        },
        { label: "Transaction Debit", value: formatINR(summary.totalDebit) },
        { label: "Transaction Credit", value: formatINR(summary.totalCredit) },
        {
          label: "Net Balance",
          value: formatINR(Math.abs(summary.totalDebit - summary.totalCredit)),
        },
      ]
    : undefined;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Trial Balance"]} />
      <FinanceShell
        title="Trial Balance"
        subtitle={
          asOf
            ? `${visible.length} entries · Refreshed ${fmtDate(asOf)}`
            : "Account-wise opening, transaction and closing balances"
        }
        icon={Scale}
        action={
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={expandAll}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/20 text-muted-foreground hover:text-foreground hover:bg-indigo-500/10 transition-colors"
            >
              <ChevronDown size={13} />
              <span className="hidden sm:inline">Expand All</span>
            </button>
            <button
              onClick={() => setExpanded(new Set())}
              className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/20 text-muted-foreground hover:text-foreground hover:bg-indigo-500/10 transition-colors"
            >
              <ChevronRight size={13} />
              <span className="hidden sm:inline">Collapse</span>
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs rounded-lg border border-indigo-500/30 hover:bg-indigo-500/10 transition-colors disabled:opacity-50"
              style={{ color: "#818cf8" }}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >
        {/* ── Main card ───────────────────────────────────────────────────── */}
        <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
          {/* ── Filter bar ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 px-4 py-3.5 border-b border-border bg-muted/20">

            {/* Row 1 — Enterprise / Company / Project / Cost Centre */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <FilterSelect
                label="Enterprise"
                icon={Building}
                value={selEnterprise?.id ?? null}
                onChange={handleEnterpriseChange}
                options={enterprises}
                placeholder="All enterprises"
              />
              <FilterSelect
                label="Company"
                icon={Briefcase}
                value={selCompany?.id ?? null}
                onChange={handleCompanyChange}
                options={companies}
                placeholder="All companies"
              />
              <FilterSelect
                label="Project"
                icon={FolderKanban}
                value={selProject?.id ?? null}
                onChange={(id, opt) => setSelProject(opt)}
                options={projects}
                placeholder="All projects"
              />
              <FilterSelect
                label="Cost Centre"
                icon={Target}
                value={selCostCenter?.id ?? null}
                onChange={(id, opt) => setSelCostCenter(opt)}
                options={costCenters}
                placeholder="All cost centres"
              />
            </div>

            {/* Row 2 — Period mode tabs + picker */}
            <div className="flex flex-col gap-2">
              {/* Mode tabs row */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/50 shrink-0 mr-0.5">
                  Period:
                </span>
                <ModeTab active={filterMode === "fy"}    onClick={() => switchMode("fy")}    icon={Calendar}      label="FY" />
                <ModeTab active={filterMode === "range"} onClick={() => switchMode("range")} icon={CalendarRange} label="Range" />
                <ModeTab active={filterMode === "ason"}  onClick={() => switchMode("ason")}  icon={CalendarCheck} label="As On" />
              </div>

              {/* Period input row */}
              <div className="flex flex-wrap items-center gap-2">
                {filterMode === "fy" && (
                  <>
                    <div className="relative">
                      <select
                        value={selectedFYId ?? ""}
                        onChange={(e) => handleFYChange(e.target.value ? Number(e.target.value) : null)}
                        disabled={finYearsLoading}
                        className="h-8 pl-2.5 pr-7 rounded-lg text-xs bg-background border border-primary/40 ring-1 ring-primary/20 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none cursor-pointer disabled:opacity-50 min-w-[148px]"
                      >
                        <option value="">{finYearsLoading ? "Loading…" : "Select FY"}</option>
                        {finYears.map((fy) => (
                          <option key={fy.FId} value={fy.FId}>{fy.FName}</option>
                        ))}
                      </select>
                      <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                    {selectedFY && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {fmtDate(toDateStr(selectedFY.FStartDate))} – {fmtDate(toDateStr(selectedFY.FEndDate))}
                      </span>
                    )}
                  </>
                )}
                {filterMode === "range" && (
                  <>
                    <DateField label="From" value={from} onChange={setFrom} />
                    <DateField label="To"   value={to}   onChange={setTo} />
                  </>
                )}
                {filterMode === "ason" && (
                  <>
                    <DateField label="FY Start" value={from} onChange={setFrom} />
                    <DateField label="As On"    value={asOn} onChange={setAsOn} highlight />
                  </>
                )}
              </div>
            </div>

            {/* Row 3 — Show all accounts + Export */}
            <div className="flex items-center gap-2">
              <label className="h-8 flex items-center gap-1.5 px-2.5 rounded-lg text-xs bg-background border border-border text-muted-foreground hover:text-foreground cursor-pointer select-none whitespace-nowrap flex-1 sm:flex-none">
                <input
                  type="checkbox"
                  checked={!hideEmpty}
                  onChange={(e) => setHideEmpty(!e.target.checked)}
                  className="accent-primary"
                />
                Show all accounts
              </label>
              <div className="ml-auto">
                <ExportMenu
                  data={exportData}
                  columns={TB_EXPORT_COLUMNS}
                  title="Trial Balance"
                  filename={`trial-balance-${periodLabel()?.replace(/\s/g, "-").toLowerCase() ?? "report"}`}
                  subtitle={exportSubtitle || undefined}
                  disabled={notReady || rows.length === 0 || !rights.canExport}
                  stats={pdfStats}
                  columnPadding={{ 0: { cellPadding: { top: 5, bottom: 5, left: 2, right: 6 } } }}
                />
              </div>
            </div>

            {/* Viewing chips */}
            {(selEnterprise || selCompany || selProject || selCostCenter || periodLabel()) && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] text-muted-foreground">Viewing:</span>
                {selEnterprise && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <Building size={9} /> {selEnterprise.label}
                  </span>
                )}
                {selCompany && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <Briefcase size={9} /> {selCompany.label}
                  </span>
                )}
                {selProject && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <FolderKanban size={9} /> {selProject.label}
                  </span>
                )}
                {selCostCenter && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <Target size={9} /> {selCostCenter.label}
                  </span>
                )}
                {periodLabel() && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-heading">
                    <CalendarDays size={9} /> {periodLabel()}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 bg-destructive/10 border-b border-destructive/20 text-destructive text-xs">
              {error}
            </div>
          )}

          {selCostCenter ? (
            <CostCentrePanel data={ccData} loading={ccLoading} />
          ) : (
          <>
          {/* Stats */}
          {summary && !loading && (
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border border-b border-border">
              {statCards.map(({ label, value, Icon, color, bg, border }) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 px-5 py-4 border-l-2 ${border}`}
                >
                  <div className={`p-2 rounded-lg ${bg} ${color} shrink-0`}>
                    <Icon size={14} />
                  </div>
                  <div>
                    <p
                      className={`text-sm font-bold font-heading leading-none ${color}`}
                    >
                      {value}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 font-heading uppercase tracking-wide">
                      {label}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Mobile cards (< md) ─────────────────────────────────────────── */}
          <div className="md:hidden divide-y divide-border/40">
            {loading ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin inline mb-2" />
                <p>Loading…</p>
              </div>
            ) : visible.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground text-sm px-4">
                {rows.length === 0
                  ? "No entries found for the selected period."
                  : search
                    ? "No accounts match your search."
                    : "No accounts with activity. Toggle \"Show all accounts\" to see zero-balance accounts."}
              </div>
            ) : (
              visible.map((node) => {
                const indent = node.level * 12;
                const hasKids = node.children.length > 0;
                const isOpen = expanded.has(node.id);
                const dot = node.type ? TYPE_DOT[node.type] : null;
                return (
                  <div
                    key={`${node.isGroup ? "g" : "e"}-${node.id}`}
                    style={{ paddingLeft: `${indent + 12}px` }}
                    className={`pr-3 py-2.5 transition-colors ${
                      node.isGroup
                        ? node.level === 0 ? "bg-muted/35" : "bg-muted/15"
                        : "cursor-pointer hover:bg-primary/5"
                    }`}
                    onClick={!node.isGroup ? () => openDrillDown(node) : undefined}
                  >
                    {/* Name row */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {node.isGroup && hasKids ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                          className="w-4 h-4 flex items-center justify-center rounded text-muted-foreground shrink-0"
                        >
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                      ) : <span className="w-4 shrink-0" />}
                      {node.isGroup ? (
                        <span className="text-amber-400/80 shrink-0">
                          {isOpen && hasKids ? <FolderOpen size={12} /> : <Folder size={12} />}
                        </span>
                      ) : dot ? (
                        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
                      ) : <span className="w-2 shrink-0" />}
                      <span className={`text-xs leading-tight flex-1 ${
                        node.isGroup
                          ? node.level === 0
                            ? "font-bold font-heading uppercase tracking-wide text-foreground text-[11px]"
                            : "font-semibold font-heading uppercase tracking-wide text-foreground/90 text-[11px]"
                          : "text-foreground/80"
                      }`}>
                        {node.name}
                      </span>
                      {node.code && (
                        <span className="text-[10px] font-mono text-muted-foreground/40 shrink-0">{node.code}</span>
                      )}
                    </div>
                    {/* Values grid: 3 cols × 2 rows (Dr/Cr per section) */}
                    <div className="grid grid-cols-3 gap-x-2 pl-5 text-[10px] tabular-nums">
                      <span className="text-muted-foreground/50 font-heading uppercase tracking-wide">Opening</span>
                      <span className="text-muted-foreground/50 font-heading uppercase tracking-wide">Txn</span>
                      <span className="text-muted-foreground/50 font-heading uppercase tracking-wide">Closing</span>
                      <div>
                        {node.opening.debit > 0 && <div className="text-rose-400">{fmt(node.opening.debit)}</div>}
                        {node.opening.credit > 0 && <div className="text-emerald-400">{fmt(node.opening.credit)}</div>}
                        {node.opening.debit === 0 && node.opening.credit === 0 && <span className="text-muted-foreground/30">—</span>}
                      </div>
                      <div>
                        {node.transactions.debit > 0 && <div className="text-rose-400">{fmt(node.transactions.debit)}</div>}
                        {node.transactions.credit > 0 && <div className="text-emerald-400">{fmt(node.transactions.credit)}</div>}
                        {node.transactions.debit === 0 && node.transactions.credit === 0 && <span className="text-muted-foreground/30">—</span>}
                      </div>
                      <div>
                        {node.closing.debit > 0 && <div className="text-rose-400 font-medium">{fmt(node.closing.debit)}</div>}
                        {node.closing.credit > 0 && <div className="text-emerald-400 font-medium">{fmt(node.closing.credit)}</div>}
                        {node.closing.debit === 0 && node.closing.credit === 0 && <span className="text-muted-foreground/30">—</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {/* Grand total */}
            {summary && !loading && visible.length > 0 && (
              <div className="px-3 py-3 bg-muted/40 border-t-2 border-border">
                <p className="text-xs font-heading font-bold text-foreground uppercase tracking-wider mb-2">Grand Total</p>
                <div className="grid grid-cols-3 gap-x-2 text-[10px] tabular-nums">
                  <span className="text-muted-foreground/50 font-heading uppercase">Opening</span>
                  <span className="text-muted-foreground/50 font-heading uppercase">Txn</span>
                  <span className="text-muted-foreground/50 font-heading uppercase">Closing</span>
                  <div>
                    <div className="text-rose-400 font-bold">{formatINR(summary.openingDebit)}</div>
                    <div className="text-emerald-400 font-bold">{formatINR(summary.openingCredit)}</div>
                  </div>
                  <div>
                    <div className="text-rose-400 font-bold">{formatINR(summary.totalDebit)}</div>
                    <div className="text-emerald-400 font-bold">{formatINR(summary.totalCredit)}</div>
                  </div>
                  <div>
                    <div className="text-rose-400 font-bold">{formatINR(summary.openingDebit + summary.totalDebit)}</div>
                    <div className="text-emerald-400 font-bold">{formatINR(summary.openingCredit + summary.totalCredit)}</div>
                  </div>
                </div>
                {balanced && (
                  <p className="mt-2 text-center text-[11px] font-heading text-emerald-500 font-semibold">
                    ✓ Books are balanced — Debit = Credit
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Desktop table (md+) ─────────────────────────────────────────── */}
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2 text-left w-[38%]">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-heading uppercase tracking-widest text-muted-foreground whitespace-nowrap">
                        Account / Description
                      </span>
                      <div className="relative">
                        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Search…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="h-6 pl-6 pr-5 rounded-md text-[11px] bg-background border border-border text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 w-36"
                        />
                        {search && (
                          <button onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40"
                  >
                    Opening Balance
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40"
                  >
                    Transactions
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-2 text-center text-[10px] font-heading uppercase tracking-widest text-muted-foreground border-l border-border/40"
                  >
                    Closing Balance
                  </th>
                </tr>
                <tr className="border-b border-border bg-muted/10">
                  <th className="px-4 py-1.5" />
                  {[
                    "Debit",
                    "Credit",
                    "Debit",
                    "Credit",
                    "Debit",
                    "Credit",
                  ].map((h, i) => (
                    <th
                      key={i}
                      className={`px-3 py-1.5 text-right text-[10px] font-heading font-medium tracking-wider ${h === "Debit" ? "text-rose-400" : "text-emerald-400"} ${i === 0 ? "border-l border-border/30" : ""} ${i === 1 || i === 3 ? "border-r border-border/30" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-border/30">
                {loading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="border-b border-border/30">
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j} className="px-4 py-3">
                          <div
                            className="h-3 rounded bg-muted/60 animate-pulse"
                            style={{
                              width: j === 0 ? `${70 - i * 4}%` : "70%",
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-20 text-center text-muted-foreground text-sm"
                    >
                      {rows.length === 0
                        ? "No entries found for the selected period."
                        : search
                          ? "No accounts match your search."
                          : "No accounts with activity for this period. Toggle \u201cShow all accounts\u201d to see zero-balance accounts."}
                    </td>
                  </tr>
                ) : (
                  visible.map((node) => (
                    <TBRow
                      key={`${node.isGroup ? "g" : "e"}-${node.id}`}
                      node={node}
                      expanded={expanded}
                      onToggle={toggle}
                      onDrill={openDrillDown}
                      isDrillOpen={!node.isGroup && drillNode?.id === node.id}
                      drillLoading={drillLoading}
                      drillData={!node.isGroup && drillNode?.id === node.id ? drillData : null}
                      onOpenSource={openSourceEntry}
                    />
                  ))
                )}
              </tbody>

              {summary && !loading && visible.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td className="px-4 py-3 text-xs font-heading font-bold text-foreground uppercase tracking-wider">
                      Grand Total
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400 border-l border-border/30">
                      {formatINR(summary.openingDebit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400 border-r border-border/30">
                      {formatINR(summary.openingCredit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400">
                      {formatINR(summary.totalDebit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400 border-r border-border/30">
                      {formatINR(summary.totalCredit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-rose-400">
                      {formatINR(summary.openingDebit + summary.totalDebit)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-xs font-bold text-emerald-400">
                      {formatINR(summary.openingCredit + summary.totalCredit)}
                    </td>
                  </tr>
                  {balanced && (
                    <tr className="bg-emerald-500/5">
                      <td
                        colSpan={7}
                        className="px-4 py-2 text-center text-[11px] font-heading text-emerald-500 font-semibold tracking-wide"
                      >
                        ✓ Books are balanced — Debit = Credit
                      </td>
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </div>
          </>
          )}
        </div>
      </FinanceShell>

      {/* ── Level 3: Payment detail dialog ─────────────────────────────────── */}
      <Dialog open={!!payDetail || payDetailLoading} onOpenChange={(o) => { if (!o) setPayDetail(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-primary/10 border border-primary/20">
                <IndianRupee size={15} className="text-primary" />
              </div>
              <div>
                <DialogTitle className="font-heading text-base">
                  {payDetailLoading ? "Loading…" : payDetail?.DocNo ?? "Payment Detail"}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {payDetail?.Status ?? ""}
                </p>
              </div>
            </div>
          </DialogHeader>

          {payDetailLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 size={16} className="animate-spin" /> Fetching payment…
            </div>
          ) : payDetail?._error ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Could not load payment details.</div>
          ) : payDetail ? (
            <div className="space-y-4">
              {/* Amount highlight */}
              <div className="rounded-xl bg-primary/5 border border-primary/15 px-4 py-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-heading uppercase tracking-wide">Amount Paid</span>
                <span className="text-xl font-bold text-primary font-heading">{formatINR(Number(payDetail.PAmount) || 0)}</span>
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {[
                  { label: "Payee / Supplier",  value: payDetail.PSupplierName || payDetail.PPaymentName },
                  { label: "Payment Date",       value: payDetail.PDate ? fmtDate(String(payDetail.PDate).slice(0, 10)) : "—" },
                  { label: "Mode",               value: payDetail.PMode || "—" },
                  { label: "Bank",               value: payDetail.BankAccountName || payDetail.PBankName || "—" },
                  { label: "Cheque / Ref No.",   value: payDetail.PChequeNo || "—" },
                  { label: "Cheque Date",        value: payDetail.PChequeDate ? fmtDate(String(payDetail.PChequeDate).slice(0, 10)) : "—" },
                  { label: "Company",            value: payDetail.PCompanyName || "—" },
                  { label: "Project",            value: payDetail.PProjectName || "—" },
                  { label: "Expense Booking",    value: payDetail.RefDoc || "—" },
                  { label: "EB Date",            value: payDetail.EBDocDate ? fmtDate(String(payDetail.EBDocDate).slice(0, 10)) : "—" },
                  { label: "Taxable Amount",     value: payDetail.TaxableAmount ? formatINR(Number(payDetail.TaxableAmount)) : "—" },
                  { label: "Tax Amount",         value: payDetail.TaxAmount ? formatINR(Number(payDetail.TaxAmount)) : "—" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-0.5">{label}</p>
                    <p className="text-foreground font-medium truncate">{value || "—"}</p>
                  </div>
                ))}
              </div>

              {/* Description */}
              {payDetail.EBDescription && (
                <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                  <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Description</p>
                  <p className="text-xs text-foreground">{payDetail.EBDescription}</p>
                </div>
              )}

              {/* Narration / remarks */}
              {payDetail.PRemarks && (
                <div className="rounded-lg bg-muted/30 border border-border px-3 py-2">
                  <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Remarks</p>
                  <p className="text-xs text-foreground">{payDetail.PRemarks}</p>
                </div>
              )}

              {/* Card info */}
              {payDetail.PCardNumber && (
                <div className="rounded-lg bg-muted/30 border border-border px-3 py-2 text-xs">
                  <p className="text-[9px] font-heading uppercase tracking-widest text-muted-foreground/60 mb-1">Card</p>
                  <p>{payDetail.PCardHolderName} · {payDetail.PCardNetwork} ···· {String(payDetail.PCardNumber).slice(-4)}</p>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

    </>
  );
}
