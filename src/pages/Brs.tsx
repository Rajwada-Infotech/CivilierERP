import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  Landmark,
  IndianRupee,
  ListChecks,
  Clock,
  Search,
  X,
  RefreshCw,
} from "lucide-react";
import { formatINR } from "@/utils/formatCurrency";
import { format } from "date-fns";
import {
  getBRS,
  getBRSFilters,
  matchBRS,
  unmatchBRS,
  autoMatchBRS,
  type BrsFilterOption,
} from "@/api/brsApi";

type Payment = {
  id:            number;
  companyName:   string;
  bankName:      string;
  companyId:     number | null;
  bankId:        number;
  amount:        number;
  docDate:       Date;
  transactionId: string | undefined;
  type:          "CREDIT" | "DEBIT";
  status:        "pending" | "reconciled";
  createdAt:     Date;
};

export default function Brs() {
  const [payments, setPayments] = useState<Payment[]>([]);

  // Raw options from AccountHeadMaster
  const [companies, setCompanies] = useState<BrsFilterOption[]>([]);
  const [allBanks,  setAllBanks]  = useState<BrsFilterOption[]>([]);

  // Selected filter values
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("All");
  const [selectedBankId,    setSelectedBankId]    = useState<string>("All");
  const [filterStatus, setFilterStatus]           = useState<"All" | "reconciled" | "pending">("All");

  const [loading,    setLoading]    = useState(false);
  const [search,     setSearch]     = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [page,       setPage]       = useState(1);
  const PAGE_SIZE = 20;

  // ── Fetch filter options once on mount ──────────────────────────────────────
  useEffect(() => {
    getBRSFilters()
      .then((res) => {
        setCompanies(res.data.companies);
        setAllBanks(res.data.banks);
      })
      .catch((err) => console.error("BRS filters error", err));
  }, []);

  // ── Cascade: when a company is selected, limit the bank dropdown ────────────
  // Banks whose companyId matches the selected company (or all if "All")
  const visibleBanks = useMemo<BrsFilterOption[]>(() => {
    if (selectedCompanyId === "All") return allBanks;
    return allBanks.filter(
      (b) => b.companyId != null && String(b.companyId) === selectedCompanyId
    );
  }, [allBanks, selectedCompanyId]);

  // Reset bank selection if the currently selected bank is no longer visible
  useEffect(() => {
    if (
      selectedBankId !== "All" &&
      !visibleBanks.some((b) => String(b.id) === selectedBankId)
    ) {
      setSelectedBankId("All");
    }
  }, [visibleBanks, selectedBankId]);

  // ── Fetch transactions ───────────────────────────────────────────────────────
  const fetchBRS = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      // If a specific bank is chosen, filter by bankId
      if (selectedBankId    !== "All") params.bankId    = Number(selectedBankId);
      // If only a company is chosen (no specific bank), send companyId —
      // backend resolves this via bank.LParentId
      else if (selectedCompanyId !== "All") params.companyId = Number(selectedCompanyId);

      if (filterStatus !== "All") params.status = filterStatus;

      const res = await getBRS(params);
      const rows = res.data.data ?? [];

      const mapped: Payment[] = rows.map((item) => ({
        id:            item.BRSID,
        companyName:   item.CompanyName ?? (item.CompanyID ? `Company ${item.CompanyID}` : "—"),
        bankName:      item.BankName    ?? `Bank ${item.BankID}`,
        companyId:     item.CompanyID   ?? null,
        bankId:        item.BankID,
        amount:        Number(item.Amount),
        docDate:       new Date(item.BankDate),
        transactionId: item.TransactionID?.toString(),
        type:          item.Type,
        status:        item.IsMatched ? "reconciled" : "pending",
        createdAt:     new Date(item.CreatedAt),
      }));

      setPayments(mapped);
    } catch (err) {
      console.error("BRS fetch error", err);
    } finally {
      setLoading(false);
    }
  }, [selectedBankId, selectedCompanyId, filterStatus]);

  useEffect(() => { fetchBRS(); }, [fetchBRS]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [search, selectedCompanyId, selectedBankId, filterStatus]);

  // ── Client-side search (company/bank/status already filtered server-side) ────
  const filteredPayments = useMemo(() => {
    if (!search) return payments;
    const q = search.toLowerCase();
    return payments.filter(
      (p) =>
        p.companyName.toLowerCase().includes(q) ||
        p.bankName.toLowerCase().includes(q) ||
        (p.transactionId ?? "").toLowerCase().includes(q)
    );
  }, [payments, search]);

  // ── Auto match ───────────────────────────────────────────────────────────────
  const autoMatch = useCallback(async () => {
    setLoading(true);
    try {
      await autoMatchBRS();
      alert("Auto reconciliation completed!");
      fetchBRS();
    } catch (err) {
      console.error("Auto match failed", err);
    } finally {
      setLoading(false);
    }
  }, [fetchBRS]);

  // ── Toggle reconciled ────────────────────────────────────────────────────────
  const toggleReconciled = useCallback(
    async (id: number, status: "pending" | "reconciled") => {
      setTogglingId(id);
      try {
        if (status === "reconciled") await unmatchBRS(id);
        else await matchBRS(id);
        fetchBRS();
      } catch (err) {
        console.error("Toggle error", err);
      } finally {
        setTogglingId(null);
      }
    },
    [fetchBRS]
  );

  // ── Stats ────────────────────────────────────────────────────────────────────
  const totalAmount     = filteredPayments.reduce((s, p) => s + p.amount, 0);
  const reconciledCount = filteredPayments.filter((p) => p.status === "reconciled").length;
  const pendingCount    = filteredPayments.filter((p) => p.status === "pending").length;
  const reconcileRate   =
    filteredPayments.length > 0
      ? Math.round((reconciledCount / filteredPayments.length) * 100)
      : 0;

  const summaryStats = [
    {
      label:     "Total Amount",
      value:     formatINR(totalAmount),
      icon:      IndianRupee,
      iconColor: "text-primary",
      iconBg:    "bg-primary/10",
    },
    {
      label:     "Reconciled",
      value:     String(reconciledCount),
      icon:      CheckCircle,
      iconColor: "text-emerald-500",
      iconBg:    "bg-emerald-500/10",
    },
    {
      label:     "Pending",
      value:     String(pendingCount),
      icon:      Clock,
      iconColor: "text-amber-500",
      iconBg:    "bg-amber-500/10",
    },
    {
      label:     "Banks",
      value:     String(allBanks.length),
      icon:      Landmark,
      iconColor: "text-blue-500",
      iconBg:    "bg-blue-500/10",
    },
  ];

  // ── Paginated slice ──────────────────────────────────────────────────────────
  const pageCount   = Math.ceil(filteredPayments.length / PAGE_SIZE);
  const pageSlice   = filteredPayments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "BRS"]} />

      {/* ── Page header ── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground tracking-tight">
            Bank Reconciliation
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Match and reconcile bank transactions
          </p>
        </div>
        <Button
          onClick={autoMatch}
          disabled={loading}
          className="flex items-center gap-2 h-10 px-4 text-sm font-medium shadow-sm"
        >
          {loading ? (
            <RefreshCw size={15} className="animate-spin" />
          ) : (
            <ListChecks size={15} />
          )}
          Auto Reconcile
        </Button>
      </div>

      {/* ── Stats strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-7">
        {summaryStats.map(({ label, value, icon: Icon, iconColor, iconBg }) => (
          <div key={label} className="glass rounded-xl px-5 py-4 flex items-center gap-4">
            <div className={`p-2.5 rounded-lg ${iconBg} ${iconColor}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className="text-2xl font-bold font-heading text-foreground leading-none">
                {value}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Reconciliation progress bar ── */}
      {filteredPayments.length > 0 && (
        <div className="glass rounded-xl px-5 py-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-muted-foreground">
              Reconciliation Progress
            </span>
            <span className="text-xs font-bold text-foreground">{reconcileRate}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${reconcileRate}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {reconciledCount} of {filteredPayments.length} transactions reconciled
          </p>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="glass rounded-xl px-5 py-4 mb-6">
        <div className="flex flex-wrap gap-3 items-center">

          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search transactions…"
              className="w-full h-9 pl-8 pr-8 bg-input/70 border border-border rounded-lg text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Company — LHeadType='C' from AccountHeadMaster */}
          <Select
            value={selectedCompanyId}
            onValueChange={(v) => {
              setSelectedCompanyId(v);
              setSelectedBankId("All"); // reset bank on company change
            }}
          >
            <SelectTrigger className="h-9 w-44 text-sm bg-input/70 border-border">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Companies</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Bank — LHeadType='B', cascaded by selected company */}
          <Select value={selectedBankId} onValueChange={setSelectedBankId}>
            <SelectTrigger className="h-9 w-44 text-sm bg-input/70 border-border">
              <SelectValue placeholder="All Banks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Banks</SelectItem>
              {visibleBanks.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status filter pills */}
          <div className="flex gap-1.5 ml-auto">
            {(["All", "reconciled", "pending"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 h-9 rounded-lg text-xs font-medium transition-all border ${
                  filterStatus === s
                    ? s === "reconciled"
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                      : s === "pending"
                        ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                        : "bg-primary/10 text-primary border-primary/30"
                    : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {s === "All" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="glass rounded-xl overflow-hidden">
        {loading ? (
          <div className="px-6 py-16 text-center text-muted-foreground text-sm">
            <RefreshCw size={20} className="animate-spin mx-auto mb-3 opacity-50" />
            Loading transactions…
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="w-12 px-5 py-3.5 text-left">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">✓</span>
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Company
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Bank
                </th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Amount
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Date
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Txn ID
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Type
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageSlice.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-muted-foreground text-sm">
                    {search || selectedCompanyId !== "All" || selectedBankId !== "All" || filterStatus !== "All"
                      ? "No transactions match your filters."
                      : "No transactions found."}
                  </td>
                </tr>
              ) : (
                pageSlice.map((p) => (
                  <tr
                    key={p.id}
                    className={`transition-colors group ${
                      p.status === "reconciled" ? "hover:bg-emerald-500/5" : "hover:bg-muted/30"
                    }`}
                  >
                    {/* Checkbox */}
                    <td className="px-5 py-3.5">
                      <Checkbox
                        checked={p.status === "reconciled"}
                        disabled={togglingId === p.id}
                        onCheckedChange={() => toggleReconciled(p.id, p.status)}
                        className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
                      />
                    </td>

                    {/* Company */}
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-foreground">{p.companyName}</p>
                    </td>

                    {/* Bank */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                          <Landmark size={12} className="text-blue-500" />
                        </div>
                        <p className="text-foreground">{p.bankName}</p>
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-3.5 text-right font-mono font-medium text-foreground">
                      {formatINR(p.amount)}
                    </td>

                    {/* Date */}
                    <td className="px-5 py-3.5 text-muted-foreground tabular-nums">
                      {format(p.docDate, "dd MMM yyyy")}
                    </td>

                    {/* Transaction ID */}
                    <td className="px-5 py-3.5">
                      {p.transactionId ? (
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {p.transactionId}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Type */}
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          p.type === "CREDIT"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        }`}
                      >
                        {p.type}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${
                          p.status === "reconciled"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            p.status === "reconciled" ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                        />
                        {p.status === "reconciled" ? "Reconciled" : "Pending"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}

        {/* ── Pagination ── */}
        {filteredPayments.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, filteredPayments.length)}–
              {Math.min(page * PAGE_SIZE, filteredPayments.length)} of {filteredPayments.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === pageCount || Math.abs(n - page) <= 1)
                .map((n, i, arr) => (
                  <React.Fragment key={n}>
                    {i > 0 && arr[i - 1] !== n - 1 && (
                      <span className="px-1 text-muted-foreground text-xs">…</span>
                    )}
                    <button
                      onClick={() => setPage(n)}
                      className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                        page === n
                          ? "bg-primary text-primary-foreground"
                          : "border border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {n}
                    </button>
                  </React.Fragment>
                ))}
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page === pageCount}
                className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}