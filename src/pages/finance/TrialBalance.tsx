import { useState, useCallback, useRef, useEffect, Fragment } from "react";
import { projectBelongsToCompany, projectCompanyIds } from "@/lib/projectBelongsTo";
import { useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
  CalendarDays,
  Building,
  Briefcase,
  FolderKanban,
  Calendar,
  CalendarRange,
  CalendarCheck,
  Loader2,
  X,
  Target,
} from "lucide-react";
import { DateInput } from "@/components/ui/date-input";

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
  docNo: string | null;
  mode: string | null;
  payment: { id: number; docNo: string | null; mode: string | null; status: string | null } | null;
  costCenter: { id: number; code: string | null; name: string | null } | null;
  fixedAsset: {
    assetId: number;
    assetCode: string | null;
    assetName: string | null;
    faItemCode: string | null;
    finYear: string | null;
  } | null;
  // GRN-sourced legs only — the items that actually made up this leg's
  // bucketed total, e.g. "Fixed Assets A/c" broken back down into CP PLUS
  // DVR 8CH, CP PLUS BULLET CAMERA, etc. with each item's own amount.
  items: { itemName: string; amount: number }[] | null;
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
  tagged_company_ids?: string | null;
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
  const isDrillable = !node.isGroup;

  return (
    <>
    <tr
      onClick={isDrillable ? () => onDrill(node) : undefined}
      className={isDrillable ? "cursor-pointer" : undefined}
      // A top-level group opens with an ink rule; the account whose entries are open carries a rule on its left.
      style={
        node.isGroup && node.level === 0
          ? { boxShadow: "inset 0 1px 0 hsl(var(--foreground))" }
          : isDrillOpen
            ? { boxShadow: "inset 3px 0 0 hsl(var(--primary))" }
            : undefined
      }
    >
      <td className="py-2.5 pr-3" style={{ paddingLeft: `${indent + 14}px` }}>
        <div className="flex items-center gap-2">
          {node.isGroup && hasKids ? (
            <button
              onClick={() => onToggle(node.id)}
              aria-label={isOpen ? "Collapse" : "Expand"}
              className="flex items-center justify-center w-4 h-4 text-foreground shrink-0"
            >
              {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          <span
            className={
              node.isGroup
                ? node.level === 0
                  ? "font-heading font-bold text-foreground tracking-[0.1em] uppercase text-[0.6875rem]"
                  : "font-heading font-semibold text-foreground text-[0.6875rem] uppercase tracking-[0.06em]"
                : "text-foreground text-[0.8125rem] leading-tight"
            }
          >
            {node.name}
          </span>

          {node.code && <span className="font-heading text-[0.625rem] tabular-nums text-muted-foreground">{node.code}</span>}
          {!node.isGroup && node.type && (
            <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{TYPE_LABEL[node.type] ?? node.type}</span>
          )}
          {!node.isGroup && !hasAnyValue && <span className="text-[0.625rem] text-muted-foreground/60 italic ml-0.5">no transactions</span>}
        </div>
      </td>
      {[
        { v: node.opening.debit, cls: "border-l border-border/60" },
        { v: node.opening.credit, cls: "border-r border-border/60" },
        { v: node.transactions.debit, cls: "" },
        { v: node.transactions.credit, cls: "border-r border-border/60" },
        { v: node.closing.debit, cls: "", strong: true },
        { v: node.closing.credit, cls: "", strong: true },
      ].map((c, i) => (
        <td
          key={i}
          className={`px-3 py-2.5 text-right font-heading tabular-nums text-xs ${c.cls} ${
            c.v > 0 ? (c.strong || node.isGroup ? "font-semibold text-foreground" : "text-foreground") : "text-muted-foreground/40"
          }`}
        >
          {fmt(c.v)}
        </td>
      ))}
    </tr>

    {/* ── Inline drill-down panel ───────────────────────────────────── */}
    {isDrillOpen && (
      <tr>
        <td colSpan={7} className="p-0">
          <div className="mx-4 my-2 overflow-hidden bg-card" style={{ border: "1px solid hsl(var(--foreground))" }}>
            {/* Header bar */}
            <div className="flex items-baseline gap-3 px-4 py-2.5" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Entries in the period</span>
              <span className="text-[0.8125rem] font-semibold text-foreground">{node.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onDrill(node); }}
                className="ml-auto w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
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
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="text-left">
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
                      const sourceLabel =
                        st === "newpayment" ? "Payment"
                        : st === "receivedpayment" ? "Received"
                        : st === "expensebooking" ? "Expense booking"
                        : st === "invoiceposting" ? "Invoice"
                        : st === "grn" || st === "grnposting" ? "GRN"
                        : st === "journalvoucher" ? "JV"
                        : st === "onaccountledger" ? "On account"
                        : t.sourceType ?? "Entry";

                      const ref = (t as any).sourceRef as { id: number; docNo: string; type: string } | null;
                      const displayDoc = t.docNo || t.voucherNo || (ref?.docNo) || "—";
                      // Every row with a resolvable source (a linked
                      // payment, or a sourceId) is clickable to open the
                      // GL entry detail dialog — not just payments.
                      const isClickable = (st === "newpayment" && !!t.payment) || !!t.sourceId;

                      return (
                        <Fragment key={t.entryId ?? `direct-${ti}`}>
                        <tr
                          onClick={(e) => { e.stopPropagation(); if (isClickable) onOpenSource(t); }}
                          className={`${isPending ? "opacity-70" : ""} ${isClickable ? "cursor-pointer" : ""}`}
                        >
                          <td className="px-3 py-1.5 font-heading tabular-nums text-[0.6875rem]">{t.voucherNo || "—"}</td>
                          <td className="px-3 py-1.5 whitespace-nowrap">{t.date ? fmtDate(t.date) : "—"}</td>
                          <td className="px-3 py-1.5">
                            <span className="inline-flex items-center gap-2 flex-wrap">
                              <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{sourceLabel}</span>
                              {isPending && <SheetMark text="Pending" tone="waiting" />}
                              <span className={`font-heading text-[0.6875rem] font-semibold tabular-nums ${isClickable ? "text-foreground underline underline-offset-2" : "text-foreground/80"}`}>{displayDoc}</span>
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-[0.6875rem]">{t.invoiceNo || "—"}</td>
                          <td className="px-3 py-1.5 text-[0.6875rem]">{t.mode || t.payment?.mode || "—"}</td>
                          <td className="px-3 py-1.5 text-[0.6875rem] text-muted-foreground">
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
                          <td className="px-3 py-1.5 text-[0.6875rem] text-muted-foreground">
                            {t.costCenter
                              ? `${t.costCenter.code ?? ""}${t.costCenter.code ? " - " : ""}${t.costCenter.name ?? ""}`
                              : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{t.debit ? fmt(t.debit) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-foreground">{t.credit ? fmt(t.credit) : "—"}</td>
                          <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[160px] text-[0.6875rem]">{t.narration || "—"}</td>
                        </tr>
                        {/* Item-level breakdown — this leg's bucketed total
                            split back out by the item that actually earned
                            each share, so e.g. Fixed Assets A/c shows CP
                            PLUS DVR 8CH / CP PLUS BULLET CAMERA separately
                            instead of one lumped GRN figure. */}
                        {t.items && t.items.length > 0 && (
                          <tr className="border-b border-border/30">
                            <td colSpan={10} className="px-3 pb-2 pt-0">
                              <div className="ml-4 overflow-hidden" style={{ border: "1px dashed hsl(var(--border))" }}>
                                {t.items.map((it, ii) => (
                                  <div
                                    key={ii}
                                    className={`flex items-center justify-between px-3 py-1.5 text-[0.6875rem] ${ii > 0 ? "border-t border-border/30" : ""}`}
                                  >
                                    <span className="text-foreground/80">{it.itemName}</span>
                                    <span className="font-heading tabular-nums tabular-nums text-muted-foreground">₹{fmt(it.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
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
      <div className="statrow" style={{ padding: "16px 16px 18px", borderBottom: "1px solid hsl(var(--foreground))" }}>
        {[
          { label: "Cost centre", value: `${data.costCenter.code} - ${data.costCenter.name}` },
          { label: "Total debit", value: fmt(data.totals.debit) },
          { label: "Total credit", value: fmt(data.totals.credit) },
        ].map((x) => (
          <div key={x.label}>
            <p className="label">{x.label}</p>
            <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-left">
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
              <tr key={t.entryId}>
                <td className="px-4 py-2 font-heading tabular-nums text-xs">{t.voucherNo || "—"}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {t.date ? fmtDate(t.date) : "—"}
                </td>
                <td className="px-3 py-2 text-xs">{t.account.name || "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {t.poNo ? (
                    <span className="font-heading font-semibold tabular-nums text-foreground">{t.poNo}</span>
                  ) : (
                    "—"
                  )}
                  {t.docNo && t.docNo !== t.poNo && (
                    <span className="block text-[0.625rem] text-muted-foreground font-heading tabular-nums">
                      {t.docNo}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-foreground">
                  {t.debit ? fmt(t.debit) : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-xs text-foreground">
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
      <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground flex items-center gap-1 mb-0.5">
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
          className="h-9 w-full pl-2.5 pr-7 text-xs bg-card border border-foreground/40 text-foreground focus:outline-none focus:border-foreground appearance-none disabled:opacity-50 cursor-pointer"
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
    <button onClick={onClick} aria-pressed={active} className={active ? "on" : undefined}>
      <span className="inline-flex items-center gap-1.5">
        <Icon size={11} />
        {label}
      </span>
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
    <div className="flex items-center h-9 text-xs overflow-hidden bg-card" style={{ border: `1px solid hsl(var(--foreground) / ${highlight ? 1 : 0.4})` }}>
      <span
        className="flex items-center gap-1 px-2 h-full font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] whitespace-nowrap select-none text-muted-foreground"
        style={{ borderRight: "1px solid hsl(var(--border))" }}
      >
        <CalendarDays size={10} />
        {label}
      </span>
      <DateInput
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
  const navigate = useNavigate();
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

  // ── drill-down (Level 2: entity transactions) ───────────────────────────
  const [drillNode, setDrillNode] = useState<TBNode | null>(null);
  const [drillData, setDrillData] = useState<TBTransactionsResponse | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // ── Level 3: GL entry detail dialog — shows the exact posted leg the user
  // clicked (voucher no., date, debit/credit, narration, this account) using
  // only the fields already on the drill-down row itself. Deliberately does
  // NOT navigate to the source document's own page (Invoice/GRN/JV/Payment
  // forms) — clicking a Trial Balance row should show what actually posted
  // to this account, not pull up an unrelated editable form.
  const [glEntryDetail, setGlEntryDetail] = useState<TBTransaction | null>(null);

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
      ? allProjects.filter((p) => projectBelongsToCompany(p, id))
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
    [drillNode, filterMode, from, to, asOn, selCompany, selProject, selCostCenter],
  );

  // Level 3 — open the source document's own real view (the same rich
  // detail dialog its own page already renders for ?view=<id> — GRN.tsx,
  // JournalVoucher.tsx, Payment.tsx, etc. all already support this deep
  // link), not a generic GL-leg summary. A generic card answers "what did
  // this entry post" but strips every field that isn't a GL column — the
  // full ledger table, status, narration, linked documents — which is
  // usually exactly what someone drilling into an account is after.
  //
  // Only source types with a page confirmed to support ?view= are routed
  // this way; anything else still falls back to the GL-leg card below so a
  // click never silently does nothing.
  const SOURCE_TYPE_ROUTES: Record<string, string> = {
    journalvoucher: "/journal-voucher",
    newpayment: "/payments",
    receivedpayment: "/received-payments",
    expensebooking: "/material/expense-booking",
    invoiceposting: "/material/expense-booking",
    grn: "/material/grn",
    grnposting: "/material/grn",
  };

  const openSourceEntry = useCallback((t: TBTransaction) => {
    const st = (t.sourceType ?? "").toLowerCase();
    const route = SOURCE_TYPE_ROUTES[st];
    const id = st === "newpayment" ? (t.payment?.id ?? t.sourceId) : t.sourceId;
    if (route && id) {
      navigate(`${route}?view=${id}`);
      return;
    }
    setGlEntryDetail(t);
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
        { label: "Opening Balance", value: formatINR(summary.openingDebit + summary.openingCredit) },
        { label: "Transaction Debit", value: formatINR(summary.totalDebit) },
        { label: "Transaction Credit", value: formatINR(summary.totalCredit) },
        { label: "Net Balance", value: formatINR(Math.abs(summary.totalDebit - summary.totalCredit)) },
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
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Trial balance"
        subtitle={
          [periodLabel(), selCompany?.label || selEnterprise?.label, selProject?.label].filter(Boolean).join(" · ") ||
          "Opening, movement and closing balance of every account."
        }
        action={
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <div className="seg">
              <button onClick={expandAll}>Expand all</button>
              <button onClick={() => setExpanded(new Set())}>Collapse</button>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] text-foreground border border-foreground hover:bg-primary/10 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        }
      >
        {/* ── Main card ───────────────────────────────────────────────────── */}
        <div className="bg-card overflow-hidden" style={{ border: "1px solid hsl(var(--foreground))" }}>
          {/* ── Filter bar ─────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 px-4 py-4" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>

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
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground shrink-0">Period</span>
                <div className="seg">
                  <ModeTab active={filterMode === "fy"}    onClick={() => switchMode("fy")}    icon={Calendar}      label="Financial year" />
                  <ModeTab active={filterMode === "range"} onClick={() => switchMode("range")} icon={CalendarRange} label="Date range" />
                  <ModeTab active={filterMode === "ason"}  onClick={() => switchMode("ason")}  icon={CalendarCheck} label="As on" />
                </div>
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
                        className="h-9 pl-2.5 pr-7 text-xs bg-card border border-foreground text-foreground font-semibold focus:outline-none appearance-none cursor-pointer disabled:opacity-50 min-w-[148px]"
                      >
                        <option value="">{finYearsLoading ? "Loading…" : "Select FY"}</option>
                        {finYears.map((fy) => (
                          <option key={fy.FId} value={fy.FId}>{fy.FName}</option>
                        ))}
                      </select>
                      <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                    {selectedFY && (
                      <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
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
              <label className="h-9 flex items-center gap-2 px-3 text-xs bg-card border border-foreground/40 text-foreground cursor-pointer select-none whitespace-nowrap flex-1 sm:flex-none">
                <input
                  type="checkbox"
                  checked={!hideEmpty}
                  onChange={(e) => setHideEmpty(!e.target.checked)}
                  className="accent-foreground"
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
                <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Viewing</span>
                {selEnterprise && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 border border-foreground/40 text-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em]">
                    <Building size={9} /> {selEnterprise.label}
                  </span>
                )}
                {selCompany && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 border border-foreground/40 text-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em]">
                    <Briefcase size={9} /> {selCompany.label}
                  </span>
                )}
                {selProject && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 border border-foreground/40 text-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em]">
                    <FolderKanban size={9} /> {selProject.label}
                  </span>
                )}
                {selCostCenter && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 border border-foreground/40 text-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em]">
                    <Target size={9} /> {selCostCenter.label}
                  </span>
                )}
                {periodLabel() && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 border border-foreground/40 text-foreground font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.08em]">
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
            <div className="statrow four" style={{ padding: "16px 16px 18px", borderBottom: "1px solid hsl(var(--foreground))" }}>
              {statCards.map(({ label, value }) => {
                // The debit and credit movement must agree; if they do not, that difference is the one red figure.
                const isNet = label === "Net Balance";
                return (
                  <div key={label}>
                    <p className="label" style={isNet && !balanced ? { color: "var(--red)" } : undefined}>
                      {isNet ? (balanced ? "Difference" : "Out of balance by") : label}
                    </p>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9, color: isNet && !balanced ? "var(--red)" : undefined, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {value}
                    </p>
                    {isNet && <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{balanced ? "debit equals credit" : "debit and credit do not agree"}</p>}
                  </div>
                );
              })}
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
                              return (
                  <div
                    key={`${node.isGroup ? "g" : "e"}-${node.id}`}
                    style={{ paddingLeft: `${indent + 12}px`, ...(node.isGroup && node.level === 0 ? { borderTop: "1px solid hsl(var(--foreground))" } : {}) }}
                    className={`pr-3 py-2.5 ${node.isGroup ? "" : "cursor-pointer"}`}
                    onClick={!node.isGroup ? () => openDrillDown(node) : undefined}
                  >
                    {/* Name row */}
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {node.isGroup && hasKids ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggle(node.id); }}
                          className="w-4 h-4 flex items-center justify-center text-foreground shrink-0"
                        >
                          {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                      ) : <span className="w-4 shrink-0" />}
                      <span className={`text-xs leading-tight flex-1 ${
                        node.isGroup
                          ? node.level === 0
                            ? "font-bold font-heading uppercase tracking-wide text-foreground text-[0.6875rem]"
                            : "font-semibold font-heading uppercase tracking-wide text-foreground/90 text-[0.6875rem]"
                          : "text-foreground/80"
                      }`}>
                        {node.name}
                      </span>
                      {node.code && (
                        <span className="text-[0.625rem] font-heading tabular-nums text-muted-foreground/40 shrink-0">{node.code}</span>
                      )}
                    </div>
                    {/* Values grid: 3 cols × 2 rows (Dr/Cr per section) */}
                    <div className="grid grid-cols-3 gap-x-2 pl-5 text-[0.625rem] tabular-nums">
                      <span className="text-muted-foreground font-heading font-semibold uppercase tracking-[0.1em] text-[0.5625rem]">Opening</span>
                      <span className="text-muted-foreground font-heading font-semibold uppercase tracking-[0.1em] text-[0.5625rem]">Txn</span>
                      <span className="text-muted-foreground font-heading font-semibold uppercase tracking-[0.1em] text-[0.5625rem]">Closing</span>
                      <div>
                        {node.opening.debit > 0 && <div className="text-foreground">{fmt(node.opening.debit)} <span className="text-muted-foreground font-normal">Dr</span></div>}
                        {node.opening.credit > 0 && <div className="text-foreground">{fmt(node.opening.credit)} <span className="text-muted-foreground font-normal">Cr</span></div>}
                        {node.opening.debit === 0 && node.opening.credit === 0 && <span className="text-muted-foreground/30">—</span>}
                      </div>
                      <div>
                        {node.transactions.debit > 0 && <div className="text-foreground">{fmt(node.transactions.debit)} <span className="text-muted-foreground font-normal">Dr</span></div>}
                        {node.transactions.credit > 0 && <div className="text-foreground">{fmt(node.transactions.credit)} <span className="text-muted-foreground font-normal">Cr</span></div>}
                        {node.transactions.debit === 0 && node.transactions.credit === 0 && <span className="text-muted-foreground/30">—</span>}
                      </div>
                      <div>
                        {node.closing.debit > 0 && <div className="text-foreground font-medium">{fmt(node.closing.debit)} <span className="text-muted-foreground font-normal">Dr</span></div>}
                        {node.closing.credit > 0 && <div className="text-foreground font-medium">{fmt(node.closing.credit)} <span className="text-muted-foreground font-normal">Cr</span></div>}
                        {node.closing.debit === 0 && node.closing.credit === 0 && <span className="text-muted-foreground/30">—</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            {/* Grand total */}
            {summary && !loading && visible.length > 0 && (
              <div className="px-3 py-3" style={{ borderTop: "2px solid hsl(var(--foreground))" }}>
                <p className="font-heading text-[0.6875rem] font-bold text-foreground uppercase tracking-[0.12em] mb-2">Grand total</p>
                <div className="grid grid-cols-3 gap-x-2 text-[0.625rem] tabular-nums">
                  <span className="text-muted-foreground font-heading font-semibold uppercase tracking-[0.1em] text-[0.5625rem]">Opening</span>
                  <span className="text-muted-foreground font-heading font-semibold uppercase tracking-[0.1em] text-[0.5625rem]">Txn</span>
                  <span className="text-muted-foreground font-heading font-semibold uppercase tracking-[0.1em] text-[0.5625rem]">Closing</span>
                  <div>
                    <div className="text-foreground font-bold">{formatINR(summary.openingDebit)} <span className="text-muted-foreground font-normal">Dr</span></div>
                    <div className="text-foreground font-bold">{formatINR(summary.openingCredit)} <span className="text-muted-foreground font-normal">Cr</span></div>
                  </div>
                  <div>
                    <div className="text-foreground font-bold">{formatINR(summary.totalDebit)} <span className="text-muted-foreground font-normal">Dr</span></div>
                    <div className="text-foreground font-bold">{formatINR(summary.totalCredit)} <span className="text-muted-foreground font-normal">Cr</span></div>
                  </div>
                  <div>
                    <div className="text-foreground font-bold">{formatINR(summary.openingDebit + summary.totalDebit)} <span className="text-muted-foreground font-normal">Dr</span></div>
                    <div className="text-foreground font-bold">{formatINR(summary.openingCredit + summary.totalCredit)} <span className="text-muted-foreground font-normal">Cr</span></div>
                  </div>
                </div>
                <div className="mt-3">
                  <SheetMark text={balanced ? "Books balance" : "Books do not balance"} tone={balanced ? "done" : "stopped"} />
                </div>
              </div>
            )}
          </div>

          {/* ── Desktop table (md+) ─────────────────────────────────────────── */}
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left w-[38%]">
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap">Account</span>
                      <div className="relative">
                        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Search…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          className="h-7 pl-6 pr-5 text-[0.6875rem] font-body normal-case tracking-normal bg-card border border-foreground/40 text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground w-40"
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
                    className="px-3 py-2 text-center border-l border-border/60"
                  >
                    Opening Balance
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-2 text-center border-l border-border/60"
                  >
                    Transactions
                  </th>
                  <th
                    colSpan={2}
                    className="px-3 py-2 text-center border-l border-border/60"
                  >
                    Closing Balance
                  </th>
                </tr>
                <tr>
                  <th className="px-4 py-1.5" />
                  {[
                    "Dr",
                    "Cr",
                    "Dr",
                    "Cr",
                    "Dr",
                    "Cr",
                  ].map((h, i) => (
                    <th
                      key={i}
                      className={`px-3 py-1.5 text-right ${i === 0 ? "border-l border-border/60" : ""} ${i === 1 || i === 3 ? "border-r border-border/60" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
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
                  {/* Closed off the way a statement is: a heavy rule above the totals, a double rule beneath */}
                  <tr style={{ boxShadow: "inset 0 2px 0 hsl(var(--foreground)), inset 0 -1px 0 hsl(var(--foreground))" }}>
                    <td className="px-4 py-3 font-heading text-[0.6875rem] font-bold text-foreground uppercase tracking-[0.12em]">Grand total</td>
                    {[
                      { v: summary.openingDebit, cls: "border-l border-border/60" },
                      { v: summary.openingCredit, cls: "border-r border-border/60" },
                      { v: summary.totalDebit, cls: "" },
                      { v: summary.totalCredit, cls: "border-r border-border/60" },
                      { v: summary.openingDebit + summary.totalDebit, cls: "" },
                      { v: summary.openingCredit + summary.totalCredit, cls: "" },
                    ].map((c, i) => (
                      <td key={i} className={`px-3 py-3 text-right font-heading tabular-nums text-xs font-bold text-foreground ${c.cls}`}>{formatINR(c.v)}</td>
                    ))}
                  </tr>
                  <tr style={{ boxShadow: "inset 0 1px 0 hsl(var(--foreground))" }}>
                    <td colSpan={7} className="px-4 py-2.5">
                      {balanced ? (
                        <SheetMark text="Books balance: debit equals credit" tone="done" />
                      ) : (
                        <SheetMark text="Books do not balance: debit and credit differ" tone="stopped" />
                      )}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          </>
          )}
        </div>
      </SheetShell>

      {/* ── Level 3: GL entry detail dialog ──────────────────────────────────
          Shows exactly what this leg posted — voucher, date, debit/credit,
          narration, this account — built entirely from the drill-down row
          already on screen. Deliberately does not navigate to the source
          document's own editable form. */}
      <Dialog open={!!glEntryDetail} onOpenChange={(o) => { if (!o) setGlEntryDetail(null); }}>
        <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: "1px solid hsl(var(--foreground))" }}>
              <p className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ledger entry · {drillNode?.name ?? ""}</p>
              <DialogTitle className="font-heading text-lg font-bold tabular-nums tracking-tight mt-1">
                {glEntryDetail?.voucherNo || glEntryDetail?.docNo || "GL entry"}
              </DialogTitle>
            </div>
          </DialogHeader>

          {glEntryDetail && (
            <div className="space-y-4">
              {/* Amount */}
              <div className="px-4 py-3 flex items-end justify-between" style={{ border: "1.5px solid hsl(var(--foreground))" }}>
                <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{glEntryDetail.debit > 0 ? "Debit" : "Credit"}</span>
                <span className="font-heading text-2xl font-semibold tabular-nums tracking-tight text-foreground leading-none">
                  {formatINR(glEntryDetail.debit > 0 ? glEntryDetail.debit : glEntryDetail.credit)}
                </span>
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
                {[
                  { label: "Account",       value: drillNode?.name },
                  { label: "Date",          value: glEntryDetail.date ? fmtDate(glEntryDetail.date) : "—" },
                  { label: "Voucher No.",   value: glEntryDetail.voucherNo || "—" },
                  { label: "Source Type",   value: glEntryDetail.sourceType || "—" },
                  { label: "Invoice No.",   value: glEntryDetail.invoiceNo || "—" },
                  { label: "Mode",          value: glEntryDetail.mode || glEntryDetail.payment?.mode || "—" },
                  {
                    label: "Cost Centre",
                    value: glEntryDetail.costCenter
                      ? `${glEntryDetail.costCenter.code ?? ""}${glEntryDetail.costCenter.code ? " - " : ""}${glEntryDetail.costCenter.name ?? ""}`
                      : "—",
                  },
                  {
                    label: "Fixed Asset",
                    value: glEntryDetail.fixedAsset
                      ? (glEntryDetail.fixedAsset.faItemCode || glEntryDetail.fixedAsset.assetCode || `Asset #${glEntryDetail.fixedAsset.assetId}`)
                      : "—",
                  },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-1">{label}</p>
                    <p className="text-foreground font-medium truncate">{value || "—"}</p>
                  </div>
                ))}
              </div>

              {/* Narration */}
              {glEntryDetail.narration && (
                <div className="px-3 py-2" style={{ border: "1px solid hsl(var(--border))" }}>
                  <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-1">Narration</p>
                  <p className="text-xs text-foreground">{glEntryDetail.narration}</p>
                </div>
              )}

              {/* Item breakdown, when this leg has one (GRN-sourced) */}
              {glEntryDetail.items && glEntryDetail.items.length > 0 && (
                <div className="overflow-hidden" style={{ border: "1px solid hsl(var(--border))" }}>
                  <p className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground px-3 pt-2 pb-1">Items</p>
                  {glEntryDetail.items.map((it, i) => (
                    <div key={i} className={`flex items-center justify-between px-3 py-1.5 text-xs ${i > 0 ? "border-t border-border/30" : ""}`}>
                      <span className="text-foreground/80">{it.itemName}</span>
                      <span className="font-heading tabular-nums tabular-nums text-muted-foreground">{formatINR(it.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

    </>
  );
}
