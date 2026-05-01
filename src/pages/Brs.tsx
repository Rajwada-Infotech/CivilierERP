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
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

type Payment = {
  id: number;
  companyName: string;
  bankName: string;
  companyId: number | null;
  bankId: number;
  amount: number;
  docDate: Date;
  transactionId: string | undefined;
  type: "CREDIT" | "DEBIT";
  status: "pending" | "reconciled";
  createdAt: Date;
};

// ─── Columns ─────────────────────────────────────────────────────────────────

function buildColumns(
  togglingId: number | null,
  toggleReconciled: (id: number, status: "pending" | "reconciled") => void,
): ColumnDef<Payment, unknown>[] {
  return [
    {
      id: "reconcile",
      header: "✓",
      enableSorting: false,
      cell: ({ row: { original: p } }) => (
        <Checkbox
          checked={p.status === "reconciled"}
          disabled={togglingId === p.id}
          onCheckedChange={() => toggleReconciled(p.id, p.status)}
          className="data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500"
        />
      ),
    },
    {
      accessorKey: "companyName",
      header: "Company",
      cell: ({ getValue }) => (
        <p className="font-medium text-foreground">{getValue() as string}</p>
      ),
    },
    {
      accessorKey: "bankName",
      header: "Bank",
      cell: ({ getValue }) => (
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blue-500/10 flex items-center justify-center shrink-0">
            <Landmark size={12} className="text-blue-500" />
          </div>
          <p className="text-foreground">{getValue() as string}</p>
        </div>
      ),
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ getValue }) => (
        <span className="font-mono font-medium text-foreground text-right block">
          {formatINR(getValue() as number)}
        </span>
      ),
    },
    {
      accessorKey: "docDate",
      header: "Date",
      cell: ({ getValue }) => (
        <span className="text-muted-foreground tabular-nums">
          {format(getValue() as Date, "dd MMM yyyy")}
        </span>
      ),
    },
    {
      accessorKey: "transactionId",
      header: "Txn ID",
      cell: ({ getValue }) => {
        const v = getValue() as string | undefined;
        return v ? (
          <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
            {v}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        );
      },
    },
    {
      accessorKey: "type",
      header: "Type",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
              v === "CREDIT"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}
          >
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const v = getValue() as string;
        return (
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${
              v === "reconciled"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${v === "reconciled" ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            {v === "reconciled" ? "Reconciled" : "Pending"}
          </span>
        );
      },
    },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Brs() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [companies, setCompanies] = useState<BrsFilterOption[]>([]);
  const [allBanks, setAllBanks] = useState<BrsFilterOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("All");
  const [selectedBankId, setSelectedBankId] = useState<string>("All");
  const [filterStatus, setFilterStatus] = useState<
    "All" | "reconciled" | "pending"
  >("All");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);

  useEffect(() => {
    getBRSFilters()
      .then((res) => {
        setCompanies(res.data.companies);
        setAllBanks(res.data.banks);
      })
      .catch((err) => console.error("BRS filters error", err));
  }, []);

  const visibleBanks = useMemo<BrsFilterOption[]>(() => {
    if (selectedCompanyId === "All") return allBanks;
    return allBanks.filter(
      (b) => b.companyId != null && String(b.companyId) === selectedCompanyId,
    );
  }, [allBanks, selectedCompanyId]);

  useEffect(() => {
    if (
      selectedBankId !== "All" &&
      !visibleBanks.some((b) => String(b.id) === selectedBankId)
    )
      setSelectedBankId("All");
  }, [visibleBanks, selectedBankId]);

  const fetchBRS = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (selectedBankId !== "All") params.bankId = Number(selectedBankId);
      else if (selectedCompanyId !== "All")
        params.companyId = Number(selectedCompanyId);
      if (filterStatus !== "All") params.status = filterStatus;

      const res = await getBRS(params);
      const rows = res.data.data ?? [];
      setPayments(
        rows.map((item) => ({
          id: item.BRSID,
          companyName:
            item.CompanyName ??
            (item.CompanyID ? `Company ${item.CompanyID}` : "—"),
          bankName: item.BankName ?? `Bank ${item.BankID}`,
          companyId: item.CompanyID ?? null,
          bankId: item.BankID,
          amount: Number(item.Amount),
          docDate: new Date(item.BankDate),
          transactionId: item.TransactionID?.toString(),
          type: item.Type,
          status: item.IsMatched ? "reconciled" : "pending",
          createdAt: new Date(item.CreatedAt),
        })),
      );
    } catch (err) {
      console.error("BRS fetch error", err);
    } finally {
      setLoading(false);
    }
  }, [selectedBankId, selectedCompanyId, filterStatus]);

  useEffect(() => {
    fetchBRS();
  }, [fetchBRS]);

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
    [fetchBRS],
  );

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

  // Client-side search on top of server-filtered data
  const filteredPayments = useMemo(() => {
    if (!search) return payments;
    const q = search.toLowerCase();
    return payments.filter(
      (p) =>
        p.companyName.toLowerCase().includes(q) ||
        p.bankName.toLowerCase().includes(q) ||
        (p.transactionId ?? "").toLowerCase().includes(q),
    );
  }, [payments, search]);

  const columns = useMemo(
    () => buildColumns(togglingId, toggleReconciled),
    [togglingId, toggleReconciled],
  );

  const totalAmount = filteredPayments.reduce((s, p) => s + p.amount, 0);
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
      value: formatINR(totalAmount),
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
      value: String(allBanks.length),
      icon: Landmark,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "BRS"]} />

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

      {/* Stats */}
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

      {/* Progress bar */}
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

      {/* Filters — kept manual, server controls search/bank/company/status */}
      <div className="glass rounded-xl px-5 py-4 mb-6">
        <div className="flex flex-wrap gap-3 items-center">
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

          <Select
            value={selectedCompanyId}
            onValueChange={(v) => {
              setSelectedCompanyId(v);
              setSelectedBankId("All");
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

      {/* Table */}
      <div className="glass rounded-xl overflow-hidden">
        <DataTable
          data={filteredPayments}
          columns={columns}
          loading={loading}
          searchable={false}
          paginated={true}
          defaultPageSize={20}
          emptyMessage={
            search ||
            selectedCompanyId !== "All" ||
            selectedBankId !== "All" ||
            filterStatus !== "All"
              ? "No transactions match your filters."
              : "No transactions found."
          }
          rowClassName={(row) =>
            row.original.status === "reconciled"
              ? "hover:bg-emerald-500/5"
              : "hover:bg-muted/30"
          }
        />
      </div>
    </>
  );
}
