import React, { useState, useEffect, useCallback } from "react";
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
import { format } from "date-fns";
import { getBRS, matchBRS, unmatchBRS, autoMatchBRS } from "@/api/brsApi";

type Payment = {
  id: number;
  projectName: string;
  amount: number;
  docDate: Date;
  tagDOC?: string;
  bankName?: string;
  transactionId?: string;
  status: "pending" | "reconciled";
  createdAt: Date;
};

export default function Brs() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("All");
  const [selectedBank, setSelectedBank] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  // ================= FETCH =================
  const fetchBRS = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getBRS({});
      const backendData = res.data.data || [];

      const mapped: Payment[] = backendData.map((item: any) => ({
        id: item.BRSID,
        projectName: `Bank ${item.BankID}`,
        amount: Number(item.Amount),
        docDate: new Date(item.BankDate),
        tagDOC: `Txn ${item.TransactionID || ""}`,
        bankName: `Bank ${item.BankID}`,
        transactionId: item.TransactionID?.toString(),
        status: item.IsMatched ? "reconciled" : "pending",
        createdAt: new Date(item.CreatedAt),
      }));

      setPayments(mapped);
    } catch (err) {
      console.error("BRS fetch error", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBRS();
  }, [fetchBRS]);

  // Reset to page 1 when filters change
  React.useEffect(() => { setPage(1); }, [search, selectedCompany, selectedBank, filterStatus]);

  // ================= FILTER =================
  const filteredPayments = payments.filter((p) => {
    const matchCompany =
      selectedCompany === "All" || p.projectName === selectedCompany;
    const matchBank =
      selectedBank === "All" || (p.bankName || "") === selectedBank;
    const matchStatus =
      filterStatus === "All" ||
      p.status === (filterStatus === "reconciled" ? "reconciled" : "pending");
    const matchSearch =
      search === "" ||
      p.projectName.toLowerCase().includes(search.toLowerCase()) ||
      (p.transactionId || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.bankName || "").toLowerCase().includes(search.toLowerCase());
    return matchCompany && matchBank && matchStatus && matchSearch;
  });

  // ================= AUTO MATCH =================
  const autoMatch = useCallback(async () => {
    try {
      setLoading(true);
      await autoMatchBRS();
      alert("Auto reconciliation completed!");
      fetchBRS();
    } catch (err) {
      console.error("Auto match failed", err);
    } finally {
      setLoading(false);
    }
  }, [fetchBRS]);

  // ================= TOGGLE =================
  const toggleReconciled = useCallback(
    async (id: number, status: "pending" | "reconciled") => {
      try {
        setTogglingId(id);
        if (status === "reconciled") {
          await unmatchBRS(id);
        } else {
          await matchBRS(id);
        }
        fetchBRS();
      } catch (err) {
        console.error("Toggle error", err);
      } finally {
        setTogglingId(null);
      }
    },
    [fetchBRS],
  );

  // ================= STATS =================
  const uniqueCompanies = Array.from(
    new Set(payments.map((p) => p.projectName)),
  ).sort();
  const uniqueBanks = Array.from(
    new Set(payments.map((p) => p.bankName).filter(Boolean) as string[]),
  ).sort();

  const totalAmount = filteredPayments.reduce((sum, p) => sum + p.amount, 0);
  const reconciledCount = filteredPayments.filter(
    (p) => p.status === "reconciled",
  ).length;
  const pendingCount = filteredPayments.filter(
    (p) => p.status === "pending",
  ).length;
  const reconcileRate =
    filteredPayments.length > 0
      ? Math.round((reconciledCount / filteredPayments.length) * 100)
      : 0;

  const summaryStats = [
    {
      label: "Total Amount",
      value: `₹${totalAmount.toLocaleString("en-IN")}`,
      icon: IndianRupee,
      iconColor: "text-primary",
      iconBg: "bg-primary/10",
    },
    {
      label: "Reconciled",
      value: String(reconciledCount),
      icon: CheckCircle,
      iconColor: "text-emerald-500",
      iconBg: "bg-emerald-500/10",
    },
    {
      label: "Pending",
      value: String(pendingCount),
      icon: Clock,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-500/10",
    },
    {
      label: "Banks",
      value: String(uniqueBanks.length),
      icon: Landmark,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
  ];

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
          <div
            key={label}
            className="glass rounded-xl px-5 py-4 flex items-center gap-4"
          >
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
            <span className="text-xs font-bold text-foreground">
              {reconcileRate}%
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${reconcileRate}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {reconciledCount} of {filteredPayments.length} transactions
            reconciled
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

          {/* Company */}
          <Select value={selectedCompany} onValueChange={setSelectedCompany}>
            <SelectTrigger className="h-9 w-40 text-sm bg-input/70 border-border">
              <SelectValue placeholder="Company" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Companies</SelectItem>
              {uniqueCompanies.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Bank */}
          <Select value={selectedBank} onValueChange={setSelectedBank}>
            <SelectTrigger className="h-9 w-36 text-sm bg-input/70 border-border">
              <SelectValue placeholder="Bank" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Banks</SelectItem>
              {uniqueBanks.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
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
            <RefreshCw
              size={20}
              className="animate-spin mx-auto mb-3 opacity-50"
            />
            Loading transactions…
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="w-12 px-5 py-3.5 text-left">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    ✓
                  </span>
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Bank / Company
                </th>
                <th className="px-5 py-3.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Amount
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Date
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Transaction ID
                </th>
                <th className="px-5 py-3.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredPayments.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-16 text-center text-muted-foreground text-sm"
                  >
                    {search ||
                    selectedCompany !== "All" ||
                    selectedBank !== "All" ||
                    filterStatus !== "All"
                      ? "No transactions match your filters."
                      : "No transactions found."}
                  </td>
                </tr>
              ) : (
                filteredPayments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p) => (
                  <tr
                    key={p.id}
                    className={`transition-colors group ${
                      p.status === "reconciled"
                        ? "hover:bg-emerald-500/5"
                        : "hover:bg-muted/30"
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

                    {/* Bank / Company */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                          <Landmark size={13} className="text-blue-500" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">
                            {p.projectName}
                          </p>
                          {p.bankName && p.bankName !== p.projectName && (
                            <p className="text-xs text-muted-foreground">
                              {p.bankName}
                            </p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="px-5 py-3.5 text-right font-mono font-medium text-foreground">
                      ₹{p.amount.toLocaleString("en-IN")}
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
                            p.status === "reconciled"
                              ? "bg-emerald-500"
                              : "bg-amber-500"
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
              Showing {Math.min((page - 1) * PAGE_SIZE + 1, filteredPayments.length)}–{Math.min(page * PAGE_SIZE, filteredPayments.length)} of {filteredPayments.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg text-xs border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              {Array.from({ length: Math.ceil(filteredPayments.length / PAGE_SIZE) }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === Math.ceil(filteredPayments.length / PAGE_SIZE) || Math.abs(n - page) <= 1)
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
                onClick={() => setPage((p) => Math.min(Math.ceil(filteredPayments.length / PAGE_SIZE), p + 1))}
                disabled={page === Math.ceil(filteredPayments.length / PAGE_SIZE)}
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
