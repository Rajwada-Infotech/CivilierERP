import React from "react";
import { ChevronDown, Search } from "lucide-react";
import type { ExpenseOption } from "../types";

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
  loanEmis = [],
  loanEmisLoading = false,
  selectedLoanEmi = null,
  onLoanEmiSelect,
  onLoanEmiClear,
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
  loanEmis?: any[];
  loanEmisLoading?: boolean;
  selectedLoanEmi?: any | null;
  onLoanEmiSelect?: (e: any) => void;
  onLoanEmiClear?: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [source, setSource] = React.useState<"invoice" | "contract" | "loan">("invoice");
  const [typeFilter, setTypeFilter] = React.useState<"all" | "booking" | "emi" | "partial">("all");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selected = options.find((o) => o.id === value);
  const hasSelection = !!selected || !!selectedContract || !!selectedLoanEmi;

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

  const filteredLoanEmis = loanEmis.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (e.LoanNo ?? "").toLowerCase().includes(q) ||
      (e.BorrowerName ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-1.5">
      <label className="block text-xs uppercase tracking-widest font-heading text-muted-foreground">
        Select Invoice / Contract / Loan EMI
      </label>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Choose an invoice, contract, or loan EMI — auto-fills project, company &amp; amount.
      </p>
      <div className="relative" ref={ref}>
        {/* Trigger */}
        <button
          type="button"
          disabled={loading && contractsLoading}
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60 disabled:cursor-wait hover:border-primary/40 transition-colors"
        >
          {loading && !selectedContract && !selectedLoanEmi ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Loading…
            </span>
          ) : selectedLoanEmi ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">LOAN</span>
              <span className="font-mono text-xs text-amber-600 dark:text-amber-400 font-semibold truncate">
                {selectedLoanEmi.LoanNo} · EMI {selectedLoanEmi.InstallmentNo}
              </span>
            </span>
          ) : selectedContract ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-semibold bg-violet-500/10 text-violet-600 border border-violet-500/20">CON</span>
              <span className="font-mono text-xs text-violet-600 dark:text-violet-400 font-semibold truncate">
                {selectedContract.DocNo} · {selectedContract.ContactPerson}
              </span>
            </span>
          ) : selected ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-semibold ${selected.type === "emi" ? "bg-violet-500/10 text-violet-600 border border-violet-500/20" : "bg-primary/10 text-primary border border-primary/20"}`}>
                {selected.type === "emi" ? "EMI" : "EXB"}
              </span>
              <span className="font-mono text-xs text-primary font-semibold truncate">{selected.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">— Choose invoice, contract, or loan EMI —</span>
          )}
          <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {selectedContract && (selectedContract.TotalPaid > 0 || selectedContract.PendingAmount != null) && (
          <p className="mt-1.5 px-0.5 text-[11px] flex items-center gap-3">
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
              {(["invoice", "contract", "loan"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => { setSource(s); setSearch(""); setTypeFilter("all"); }}
                  className={`flex-1 py-2 text-xs font-semibold transition-colors ${source === s ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground border-b-2 border-transparent"}`}
                >
                  {s === "invoice" ? `Invoices (${options.length})` : s === "contract" ? `Contracts (${contracts.length})` : `Loan EMIs (${loanEmis.length})`}
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
                  placeholder={source === "invoice" ? "Search by ref, project…" : source === "contract" ? "Search by name, reason, doc no…" : "Search by loan no, borrower…"}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {/* Type filter pills — only for invoices */}
              {source === "invoice" && (
                <div className="flex gap-1.5 flex-wrap">
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
                        className={`flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-heading font-semibold transition-all border ${cls}`}
                      >
                        {t === "partial" && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />}
                        {t === "all" ? "All" : t === "booking" ? "Bookings" : t === "emi" ? "EMI" : "Partial"}
                        <span className="opacity-70">{count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Options list */}
            <div className="max-h-64 overflow-y-auto divide-y divide-border/50">
              {source === "invoice" ? (
                filteredInvoices.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-muted-foreground">No matches found</div>
                ) : filteredInvoices.map((o) => (
                  <button key={o.id} type="button"
                    onClick={() => {
                      const remaining = isPartiallyPaid(o) && (o.remainingAmount ?? 0) > 0
                        ? Number(o.remainingAmount)
                        : undefined;
                      onChange(o.id, remaining);
                      if (onContractClear) onContractClear();
                      if (onLoanEmiClear) onLoanEmiClear();
                      setOpen(false);
                      setSearch("");
                    }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${o.id === value ? "bg-primary/5" : ""}`}
                  >
                    <span className={`shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-semibold ${o.type === "emi" ? "bg-violet-500/10 text-violet-600 border border-violet-500/20" : "bg-primary/10 text-primary border border-primary/20"}`}>
                      {o.type === "emi" ? "EMI" : "EXB"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-xs font-semibold text-foreground truncate">{o.label}</p>
                      {o.projectName && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{o.projectName}</p>}
                      {o.supplierName && o.supplierName !== o.projectName && <p className="text-[10px] text-primary/60 mt-0.5 truncate">{o.supplierName}</p>}
                      {o.type === "emi" && o.installmentNo && <p className="text-[10px] text-violet-500 mt-0.5">Installment #{o.installmentNo}</p>}
                      {isPartiallyPaid(o) && (
                        <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full text-[10px] font-heading font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/25">
                          <span className="w-1 h-1 rounded-full bg-amber-500 inline-block" />
                          Partial
                          {(o.remainingAmount ?? 0) > 0 && (
                            <span className="opacity-80">· ₹{Number(o.remainingAmount).toLocaleString("en-IN")} left</span>
                          )}
                        </span>
                      )}
                    </div>
                    {o.amount != null && <span className="shrink-0 text-[11px] font-mono font-semibold text-foreground/70 mt-0.5">₹{o.amount.toLocaleString("en-IN")}</span>}
                  </button>
                ))
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
                    if (onLoanEmiClear) onLoanEmiClear();
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${selectedContract?.ContractId === c.ContractId ? "bg-violet-500/5" : ""}`}
                >
                  <span className="shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-semibold bg-violet-500/10 text-violet-600 border border-violet-500/20">CON</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold text-foreground truncate">{c.DocNo || `CON-${c.ContractId}`}</p>
                    {c.ContactPerson && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{c.ContactPerson}</p>}
                    {(c.Reason || c.NatureOfContract) && <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{c.Reason || c.NatureOfContract}</p>}
                    {(c.TotalPaid > 0 || c.PendingAmount != null) && (
                      <p className="text-[10px] mt-1 flex items-center gap-2">
                        <span className="text-emerald-600 dark:text-emerald-400">Paid ₹{Number(c.TotalPaid || 0).toLocaleString("en-IN")}</span>
                        <span className="text-amber-600 dark:text-amber-400">Pending ₹{Number(Math.max(c.PendingAmount || 0, 0)).toLocaleString("en-IN")}</span>
                      </p>
                    )}
                  </div>
                  {c.ContractAmount != null && <span className="shrink-0 text-[11px] font-mono font-semibold text-violet-600/80 mt-0.5">₹{Number(c.ContractAmount).toLocaleString("en-IN")}</span>}
                </button>
              ))
              ) : loanEmisLoading ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                  <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" /> Loading EMIs…
                </div>
              ) : filteredLoanEmis.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">No pending EMIs</div>
              ) : filteredLoanEmis.map((e: any) => (
                <button key={e.EMIId} type="button"
                  onClick={() => {
                    // Clear invoice/contract selections first — they reset
                    // shared form fields (company/project/amount), which
                    // would otherwise stomp on what onLoanEmiSelect sets
                    // if called afterward.
                    onChange("");
                    if (onContractClear) onContractClear();
                    if (onLoanEmiSelect) onLoanEmiSelect(e);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full flex items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors ${selectedLoanEmi?.EMIId === e.EMIId ? "bg-amber-500/5" : ""}`}
                >
                  <span className="shrink-0 mt-0.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-heading font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">LOAN</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-xs font-semibold text-foreground truncate">
                      {e.LoanNo} · EMI {e.InstallmentNo}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{e.BorrowerName} · {e.LoanType}</p>
                    <p className={`text-[10px] mt-0.5 ${e.IsOverdue ? "text-red-500 font-semibold" : "text-muted-foreground/70"}`}>
                      Due {new Date(e.DueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      {e.IsOverdue ? " · OVERDUE" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] font-mono font-semibold text-amber-600/90 mt-0.5">₹{Number(e.EMIAmount).toLocaleString("en-IN")}</span>
                </button>
              ))}
            </div>

            {/* Footer clear */}
            {hasSelection && (
              <div className="border-t border-border p-2">
                <button type="button"
                  onClick={() => { onChange(""); if (onContractClear) onContractClear(); if (onLoanEmiClear) onLoanEmiClear(); setOpen(false); setSearch(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-destructive transition-colors py-1"
                >
                  Clear selection
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
