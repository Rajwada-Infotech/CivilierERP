import React from "react";
import { ChevronDown, Search, Layers, X as XIcon } from "lucide-react";
import type { ExpenseOption } from "../types";
import type { PayableJVLine } from "@/api/journalVoucherApi";

export function ExpenseBookingPicker({
  options,
  value,
  onChange,
  loading,
  contracts = [],
  contractsLoading = false,
  selectedContract = null,
  onContractSelect,
  onContractClear,
  jvLines = [],
  jvLinesLoading = false,
  selectedJVLine = null,
  onJVLineSelect,
  onJVLineClear,
  onMergeConfirm,
  mergedSummary = null,
  onMergeClear,
  onRefreshOptions,
}: {
  options: ExpenseOption[];
  value: string;
  onChange: (id: string, remaining?: number) => void;
  loading?: boolean;
  contracts?: any[];
  contractsLoading?: boolean;
  selectedContract?: any | null;
  onContractSelect?: (c: any) => void;
  onContractClear?: () => void;
  jvLines?: PayableJVLine[];
  jvLinesLoading?: boolean;
  selectedJVLine?: PayableJVLine | null;
  onJVLineSelect?: (line: PayableJVLine) => void;
  onJVLineClear?: () => void;
  /** "Merge invoices into one payment" — called with the full, validated
   *  selection once the user confirms. Only offered for plain Bookings
   *  (not EMI installments), since those pay via their own schedule. */
  onMergeConfirm?: (selected: ExpenseOption[]) => void;
  /** The parent's currently-confirmed merge, if any — `value` alone can't
   *  represent "3 invoices", so the trigger/footer read this instead once
   *  a merge has actually been confirmed and the picker's own in-progress
   *  checkbox state has reset. */
  mergedSummary?: { count: number; totalAmount: number; label: string } | null;
  onMergeClear?: () => void;
  /** Called the moment merge mode is entered, before the user picks
   *  anything. `options` is react-query data with `staleTime: 0` — which
   *  only makes it *eligible* to refetch, not force a refetch on mount —
   *  so a tab left open since before some other fix (a company/project
   *  retag, say) could still be comparing merge candidates against
   *  values that no longer match the database. Confirmed: a reported
   *  "won't merge, says different company/project/supplier" case turned
   *  out to have byte-identical companyId/projectName/supplierId on both
   *  invoices server-side — the only explanation left was a stale cache
   *  in that tab. This closes that gap without needing to chase the
   *  staleness down further. */
  onRefreshOptions?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [source, setSource] = React.useState<"invoice" | "contract" | "jv">("invoice");
  const [typeFilter, setTypeFilter] = React.useState<"all" | "booking" | "emi" | "partial">("all");
  const [mergeMode, setMergeMode] = React.useState(false);
  const [mergeSelected, setMergeSelected] = React.useState<Set<string>>(new Set());
  const ref = React.useRef<HTMLDivElement>(null);

  // Leaving merge mode (or closing the panel) drops whatever was half-picked
  // — reopening always starts fresh rather than surfacing a stale selection.
  const exitMergeMode = () => {
    setMergeMode(false);
    setMergeSelected(new Set());
  };

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = options.find((o) => o.id === value);
  const hasSelection = !!selected || !!selectedContract || !!selectedJVLine || !!mergedSummary;

  const filteredJVLines = jvLines.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (l.JVNo ?? "").toLowerCase().includes(q) ||
      (l.LHeadName ?? "").toLowerCase().includes(q) ||
      (l.Narration ?? "").toLowerCase().includes(q)
    );
  });

  const clearOthers = () => {
    onChange("");
    if (onContractClear) onContractClear();
  };

  // isPartiallyPaid: DB status OR derived from totalPaid/remainingAmount when status is stale
  const isPartiallyPaid = (o: ExpenseOption) =>
    (o as any).billStatus === "Partially Paid" ||
    ((o.totalPaid ?? 0) > 0 && (o.remainingAmount ?? 0) > 0);

  const partialCount = options.filter(isPartiallyPaid).length;

  const filteredInvoices = options
    .filter((o) => {
      if (typeFilter === "partial") return isPartiallyPaid(o);
      if (typeFilter !== "all" && o.type !== typeFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return o.label.toLowerCase().includes(q) || (o.projectName ?? "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aP = isPartiallyPaid(a) ? 0 : 1;
      const bP = isPartiallyPaid(b) ? 0 : 1;
      return aP - bP;
    });

  // Merge mode: only plain bookings (not EMI — those pay via their own
  // installment schedule) are mergeable. The first invoice checked becomes
  // the "anchor" that every other candidate must match on company, project
  // and supplier — see the handler's description for why ("given they have
  // to be of the same company the same project and the same supplier").
  const mergeCandidates = options.filter((o) => o.type !== "emi");
  const mergeAnchor = mergeCandidates.find((o) => mergeSelected.has(o.id)) ?? null;
  // Project match uses the resolved DISPLAY name, not projectId — the
  // backing EProjectName column is stored inconsistently (a numeric
  // enterprise id as text for most bookings, a literal project name for
  // others), so two invoices that plainly show the same project here could
  // carry a mismatched raw id/name shape and be wrongly flagged
  // "different project". projectName is the same resolved value the
  // picker's own company/project/supplier filter above already matched
  // both rows on, so this can never disagree with what the user just saw
  // filtered together.
  //
  // Every comparison below is normalized (numeric coercion for the two
  // ids, trim+lowercase for the name) specifically because this exact
  // field set has already been the source of one "looks identical, compares
  // unequal" bug (the projectId-vs-projectName one above) — a stray type or
  // whitespace mismatch from how a row happened to be fetched/merged into
  // the options list is exactly the kind of thing that bites here again
  // without actually meaning the two invoices differ.
  const normCompanyId = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const normSupplierId = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const normProjectName = (v: unknown) => String(v ?? "").trim().toLowerCase();
  const isMergeCompatible = (o: ExpenseOption) =>
    !mergeAnchor ||
    (normCompanyId(o.companyId) !== null &&
      normCompanyId(o.companyId) === normCompanyId(mergeAnchor.companyId) &&
      normProjectName(o.projectName) === normProjectName(mergeAnchor.projectName) &&
      normSupplierId(o.supplierId) !== null &&
      normSupplierId(o.supplierId) === normSupplierId(mergeAnchor.supplierId));
  // Pinpoints exactly which field disagrees — shown in the UI instead of a
  // generic "different" message, so the NEXT report of this is immediately
  // actionable (what the two actual values were) instead of needing another
  // round of "what does the DB actually say" diagnosis.
  const mergeIncompatibleReason = (o: ExpenseOption): string | null => {
    if (!mergeAnchor || isMergeCompatible(o)) return null;
    if (normCompanyId(o.companyId) !== normCompanyId(mergeAnchor.companyId)) {
      return `Company differs (${o.companyId ?? "—"} vs ${mergeAnchor.companyId ?? "—"})`;
    }
    if (normProjectName(o.projectName) !== normProjectName(mergeAnchor.projectName)) {
      return `Project differs ("${o.projectName ?? "—"}" vs "${mergeAnchor.projectName ?? "—"}")`;
    }
    if (normSupplierId(o.supplierId) === null) return "Could not resolve this invoice's supplier";
    if (normSupplierId(o.supplierId) !== normSupplierId(mergeAnchor.supplierId)) {
      return `Supplier differs (${o.supplierName ?? o.supplierId} vs ${mergeAnchor.supplierName ?? mergeAnchor.supplierId})`;
    }
    return "Different company/project/supplier";
  };
  const toggleMergeSelect = (o: ExpenseOption) => {
    setMergeSelected((prev) => {
      const next = new Set(prev);
      if (next.has(o.id)) next.delete(o.id);
      else if (isMergeCompatible(o)) next.add(o.id);
      return next;
    });
  };
  const mergeSelectedOptions = mergeCandidates.filter((o) => mergeSelected.has(o.id));
  const mergeTotal = mergeSelectedOptions.reduce((sum, o) => {
    const payable = o.amount != null ? Math.max(0, o.amount - (o.tdsAmount ?? 0)) : 0;
    const due = o.remainingAmount != null && o.remainingAmount > 0 && o.remainingAmount < payable ? o.remainingAmount : payable;
    return sum + due;
  }, 0);

  const filteredContracts = contracts.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.DocNo ?? "").toLowerCase().includes(q) ||
      (c.ContactPerson ?? "").toLowerCase().includes(q) ||
      (c.Reason ?? "").toLowerCase().includes(q) ||
      (c.NatureOfContract ?? "").toLowerCase().includes(q)
    );
  });

  const bookingCount = options.filter((o) => o.type === "booking").length;
  const emiCount = options.filter((o) => o.type === "emi").length;

  return (
    <div className="space-y-1.5">
      <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground">
        Select Invoice / Contract
      </label>
      <p className="text-[0.6875rem] text-muted-foreground -mt-1">
        Choose an invoice or contract — auto-fills project, company &amp; amount.
      </p>
      <div className="relative" ref={ref}>
        {/* Trigger */}
        <button
          type="button"
          disabled={loading && contractsLoading}
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 disabled:cursor-wait hover:border-primary/40 transition-colors"
        >
          {loading && !selectedContract && !selectedJVLine ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading…
            </span>
          ) : mergedSummary ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[0.625rem] font-heading font-semibold bg-primary/10 text-primary border border-primary/20">
                <Layers size={9} /> {mergedSummary.count}
              </span>
              <span className="font-mono text-xs text-primary font-semibold truncate">
                {mergedSummary.label} · ₹{mergedSummary.totalAmount.toLocaleString("en-IN")}
              </span>
            </span>
          ) : selectedJVLine ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-heading font-semibold bg-teal-500/10 text-teal-600 border border-teal-500/20">JV</span>
              <span className="font-mono text-xs text-teal-600 dark:text-teal-400 font-semibold truncate">
                {selectedJVLine.JVNo || `JV-${selectedJVLine.JVID}`} · {selectedJVLine.LHeadName}
              </span>
            </span>
          ) : selectedContract ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-heading font-semibold bg-violet-500/10 text-violet-600 border border-violet-500/20">CON</span>
              <span className="font-mono text-xs text-violet-600 dark:text-violet-400 font-semibold truncate">
                {selectedContract.DocNo} · {selectedContract.ContactPerson}
              </span>
            </span>
          ) : selected ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-heading font-semibold ${selected.type === "emi" ? "bg-violet-500/10 text-violet-600 border border-violet-500/20" : "bg-primary/10 text-primary border border-primary/20"}`}>
                {selected.type === "emi" ? "EMI" : "EXB"}
              </span>
              <span className="font-mono text-xs text-primary font-semibold truncate">{selected.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">— Choose invoice or contract —</span>
          )}
          <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {selectedJVLine && (
          <p className="mt-1.5 px-0.5 text-[0.6875rem] flex items-center gap-3">
            <span className="text-muted-foreground">
              Liability <span className="font-mono font-semibold text-foreground/80">₹{Number(selectedJVLine.CreditAmount || 0).toLocaleString("en-IN")}</span>
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">
              Already paid <span className="font-mono font-semibold">₹{Number(selectedJVLine.PaidAmount || 0).toLocaleString("en-IN")}</span>
            </span>
            <span className="text-amber-600 dark:text-amber-400">
              Pending <span className="font-mono font-semibold">₹{Number(Math.max(selectedJVLine.RemainingAmount || 0, 0)).toLocaleString("en-IN")}</span>
            </span>
          </p>
        )}

        {selectedContract && (selectedContract.TotalPaid > 0 || selectedContract.PendingAmount != null) && (
          <p className="mt-1.5 px-0.5 text-[0.6875rem] flex items-center gap-3">
            <span className="text-muted-foreground">
              Contract value <span className="font-mono font-semibold text-foreground/80">₹{Number(selectedContract.ContractAmount || 0).toLocaleString("en-IN")}</span>
            </span>
            <span className="text-emerald-600 dark:text-emerald-400">
              Already paid <span className="font-mono font-semibold">₹{Number(selectedContract.TotalPaid || 0).toLocaleString("en-IN")}</span>
            </span>
            <span className="text-amber-600 dark:text-amber-400">
              Pending <span className="font-mono font-semibold">₹{Number(Math.max(selectedContract.PendingAmount || 0, 0)).toLocaleString("en-IN")}</span>
            </span>
          </p>
        )}

        {/* Dropdown panel */}
        {open && (
          <div className="absolute z-50 mt-1 w-full bg-card border border-border rounded-xl shadow-xl overflow-hidden">
            {/* Source tabs */}
            <div className="flex border-b border-border">
              {(["invoice", "contract", "jv"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setSource(s); setSearch(""); setTypeFilter("all"); }}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${source === s ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"}`}
                >
                  {s === "invoice" ? `Invoices (${options.length})` : s === "contract" ? `Contracts (${contracts.length})` : `Journal Vouchers (${jvLines.length})`}
                </button>
              ))}
            </div>

            {/* Search bar */}
            <div className="p-2.5 border-b border-border space-y-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  placeholder={source === "invoice" ? "Search by ref, project…" : source === "contract" ? "Search by name, reason, doc no…" : "Search by JV no, head, narration…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {/* Type filter pills — only for invoices */}
              {source === "invoice" && (
                <div className="flex gap-1.5 flex-wrap items-center">
                  {(["all", "booking", "emi", "partial"] as const).map((t) => {
                    const count = t === "all" ? options.length : t === "booking" ? bookingCount : t === "emi" ? emiCount : partialCount;
                    if (t === "partial" && count === 0) return null;
                    const isActive = typeFilter === t;
                    const cls = t === "partial"
                      ? isActive ? "bg-amber-500/15 text-amber-600 border-amber-500/40" : "bg-muted text-muted-foreground border-border hover:border-amber-500/30"
                      : t === "emi"
                        ? isActive ? "bg-violet-500/15 text-violet-600 border-violet-500/30" : "bg-muted text-muted-foreground border-border hover:border-primary/20"
                        : isActive ? "bg-primary/10 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border hover:border-primary/20";
                    return (
                      <button key={t} type="button" onClick={() => setTypeFilter(t)}
                        className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.6875rem] font-heading font-semibold transition-all border ${cls}`}
                      >
                        {t === "partial" && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />}
                        {t === "all" ? "All" : t === "booking" ? "Bookings" : t === "emi" ? "EMI" : "Partial"}
                        <span className="opacity-70">{count}</span>
                      </button>
                    );
                  })}
                  {onMergeConfirm && (
                    <button
                      type="button"
                      onClick={() => {
                        if (mergeMode) {
                          exitMergeMode();
                        } else {
                          setMergeMode(true);
                          onRefreshOptions?.();
                        }
                      }}
                      title="Pay off several invoices from the same company, project &amp; supplier in one payment"
                      className={`ml-auto flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[0.6875rem] font-heading font-semibold transition-all border ${
                        mergeMode
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "bg-muted text-muted-foreground border-border hover:border-primary/20"
                      }`}
                    >
                      <Layers size={11} />
                      {mergeMode ? "Cancel merge" : "Merge invoices"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Options list */}
            <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
              {source === "invoice" ? (
                filteredInvoices.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">No matches found</div>
                ) : filteredInvoices.map((o) => {
                  const mergeDisabled = mergeMode && (o.type === "emi" || !isMergeCompatible(o));
                  const mergeChecked = mergeMode && mergeSelected.has(o.id);
                  return (
                  <button key={o.id} type="button"
                    disabled={mergeDisabled}
                    onClick={() => {
                      if (mergeMode) { toggleMergeSelect(o); return; }
                      const remaining = isPartiallyPaid(o) && (o.remainingAmount ?? 0) > 0
                        ? Number(o.remainingAmount)
                        : undefined;
                      onChange(o.id, remaining);
                      if (onContractClear) onContractClear();
                      if (onJVLineClear) onJVLineClear();
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors ${
                      mergeDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted/50"
                    } ${o.id === value || mergeChecked ? "bg-primary/5" : ""}`}
                  >
                    {mergeMode ? (
                      <span
                        className={`shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center ${
                          mergeChecked ? "bg-primary border-primary" : "border-border"
                        }`}
                      >
                        {mergeChecked && <span className="w-2 h-2 rounded-sm bg-white" />}
                      </span>
                    ) : (
                      <span className={`shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-heading font-semibold ${o.type === "emi" ? "bg-violet-500/10 text-violet-600 border border-violet-500/20" : "bg-primary/10 text-primary border border-primary/20"}`}>
                        {o.type === "emi" ? "EMI" : "EXB"}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold text-foreground truncate">{o.label}</p>
                      {o.projectName && <p className="text-[0.625rem] text-muted-foreground mt-0.5 truncate">{o.projectName}</p>}
                      {o.supplierName && o.supplierName !== o.projectName && <p className="text-[0.625rem] text-primary/60 mt-0.5 truncate">{o.supplierName}</p>}
                      {o.type === "emi" && o.installmentNo && <p className="text-[0.625rem] text-violet-500 mt-0.5">Installment #{o.installmentNo}</p>}
                      {mergeMode && o.type === "emi" && <p className="text-[0.625rem] text-muted-foreground mt-0.5 italic">Not mergeable — paid via its own installments</p>}
                      {mergeMode && o.type !== "emi" && mergeAnchor && !mergeChecked && !isMergeCompatible(o) && (
                        <p className="text-[0.625rem] text-amber-600 dark:text-amber-400 mt-0.5 italic">{mergeIncompatibleReason(o)}</p>
                      )}
                      {isPartiallyPaid(o) && (
                        <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full text-[0.625rem] font-heading font-semibold bg-[#ffe2021a] text-amber-600 border border-amber-500/25">
                          <span className="w-1 h-1 rounded-full bg-amber-500 inline-block" />
                          Partial
                          {(o.remainingAmount ?? 0) > 0 && (
                            <span className="opacity-80">· ₹{Number(o.remainingAmount).toLocaleString("en-IN")} left</span>
                          )}
                        </span>
                      )}
                    </div>
                    {(() => {
                      // o.amount is the invoice's gross net amount (pre-TDS).
                      // TDS is withheld at source, so it's never actually
                      // payable — net it out unconditionally before
                      // comparing against remainingAmount (which itself may
                      // or may not already be TDS-net depending on when the
                      // row was last synced).
                      const payable =
                        o.amount != null ? Math.max(0, o.amount - (o.tdsAmount ?? 0)) : o.amount;
                      const displayAmt =
                        o.remainingAmount != null &&
                        o.remainingAmount > 0 &&
                        payable != null &&
                        o.remainingAmount < payable
                          ? o.remainingAmount
                          : payable;
                      return (
                        displayAmt != null && (
                          <span className="shrink-0 text-[0.6875rem] font-mono font-semibold text-foreground/70 mt-0.5">₹{displayAmt.toLocaleString("en-IN")}</span>
                        )
                      );
                    })()}
                  </button>
                  );
                })
              ) : source === "contract" ? (
                contractsLoading ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Loading contracts…
                </div>
              ) : filteredContracts.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">No approved contracts found</div>
              ) : filteredContracts.map((c: any) => (
                <button key={c.ContractId} type="button"
                  onClick={() => {
                    // Just onContractSelect(c) — it already resets the
                    // invoice-side fields itself. Calling onChange("") here
                    // too (the invoice-picker's own clear handler) used to
                    // run right after in the same click and win the race,
                    // wiping out the company/project/party fields
                    // onContractSelect had just set.
                    if (onContractSelect) onContractSelect(c);
                    if (onJVLineClear) onJVLineClear();
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${selectedContract?.ContractId === c.ContractId ? "bg-violet-500/5" : ""}`}
                >
                  <span className="shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-heading font-semibold bg-violet-500/10 text-violet-600 border border-violet-500/20">CON</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold text-foreground truncate">{c.DocNo || `CON-${c.ContractId}`}</p>
                    {c.ContactPerson && <p className="text-[0.625rem] text-muted-foreground mt-0.5 truncate">{c.ContactPerson}</p>}
                    {(c.Reason || c.NatureOfContract) && <p className="text-[0.625rem] text-muted-foreground/70 mt-0.5 truncate">{c.Reason || c.NatureOfContract}</p>}
                    {(c.TotalPaid > 0 || c.PendingAmount != null) && (
                      <p className="text-[0.625rem] mt-1 flex items-center gap-2">
                        <span className="text-emerald-600 dark:text-emerald-400">Paid ₹{Number(c.TotalPaid || 0).toLocaleString("en-IN")}</span>
                        <span className="text-amber-600 dark:text-amber-400">Pending ₹{Number(Math.max(c.PendingAmount || 0, 0)).toLocaleString("en-IN")}</span>
                      </p>
                    )}
                  </div>
                  {c.ContractAmount != null && <span className="shrink-0 text-[0.6875rem] font-mono font-semibold text-violet-600/80 mt-0.5">₹{Number(c.ContractAmount).toLocaleString("en-IN")}</span>}
                </button>
              ))
              ) : (
                jvLinesLoading ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Loading journal vouchers…
                </div>
              ) : filteredJVLines.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">No unpaid Journal Voucher liabilities found</div>
              ) : filteredJVLines.map((l) => (
                <button key={l.LineID} type="button"
                  onClick={() => {
                    clearOthers();
                    if (onJVLineSelect) onJVLineSelect(l);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${selectedJVLine?.LineID === l.LineID ? "bg-teal-500/5" : ""}`}
                >
                  <span className="shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] font-heading font-semibold bg-teal-500/10 text-teal-600 border border-teal-500/20">JV</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold text-foreground truncate">{l.JVNo || `JV-${l.JVID}`} · {l.LHeadName}</p>
                    {(l.ProjectName || l.CompanyName) && <p className="text-[0.625rem] text-muted-foreground mt-0.5 truncate">{l.ProjectName || l.CompanyName}</p>}
                    {l.Narration && <p className="text-[0.625rem] text-teal-600/60 mt-0.5 truncate">{l.Narration}</p>}
                    {l.PaidAmount > 0 && (
                      <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full text-[0.625rem] font-heading font-semibold bg-[#ffe2021a] text-amber-600 border border-amber-500/25">
                        <span className="w-1 h-1 rounded-full bg-amber-500 inline-block" />
                        Partly paid · ₹{Number(l.RemainingAmount).toLocaleString("en-IN")} left
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-[0.6875rem] font-mono font-semibold text-teal-600/80 mt-0.5">₹{Number(l.RemainingAmount).toLocaleString("en-IN")}</span>
                </button>
              ))
              )}
            </div>

            {/* Merge confirm bar — replaces the plain "Clear selection"
                footer while merge mode is active. */}
            {mergeMode ? (
              <div className="border-t border-border p-2.5 flex items-center justify-between gap-2.5 bg-muted/20">
                <span className="text-[0.6875rem] text-muted-foreground">
                  {mergeSelectedOptions.length === 0
                    ? "Check invoices to merge"
                    : <>{mergeSelectedOptions.length} selected · <span className="font-mono font-semibold text-foreground">₹{mergeTotal.toLocaleString("en-IN")}</span></>}
                </span>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={exitMergeMode}
                    className="px-2.5 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  >
                    <XIcon size={11} /> Cancel
                  </button>
                  <button type="button"
                    disabled={mergeSelectedOptions.length < 2}
                    onClick={() => {
                      // No onContractClear/onJVLineClear here — both blank
                      // company/project/party/amount and, running right after
                      // onMergeConfirm, win the race and wipe what it just
                      // filled. onMergeConfirm drops the contract/JV links itself.
                      onMergeConfirm?.(mergeSelectedOptions);
                      exitMergeMode();
                      setOpen(false);
                      setSearch("");
                    }}
                    className="px-3 py-1 rounded-lg text-xs font-heading font-semibold bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                  >
                    Merge {mergeSelectedOptions.length > 0 ? `(${mergeSelectedOptions.length})` : ""}
                  </button>
                </div>
              </div>
            ) : (
              hasSelection && (
                <div className="border-t border-border p-2">
                  <button type="button"
                    onClick={() => { onChange(""); if (onContractClear) onContractClear(); if (onJVLineClear) onJVLineClear(); if (onMergeClear) onMergeClear(); setOpen(false); setSearch(""); }}
                    className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1"
                  >
                    Clear selection
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
