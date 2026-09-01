import { CrmStatus } from "@/constants/crmStatuses";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, IndianRupee, ExternalLink, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const API = "/api/crm/brokerage";

async function fetchBrokerages(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error || `Failed to load broker records (${r.status})`);
  }
  return r.json();
}

const statusColor: Record<string, string> = {
  [CrmStatus.PENDING]:  "text-orange-600 bg-orange-50 border-orange-200",
  [CrmStatus.APPROVED]: "text-blue-600 bg-blue-50 border-blue-200",
  [CrmStatus.PAID]:     "text-green-600 bg-green-50 border-green-200",
};

const finStatusColor: Record<string, string> = {
  [CrmStatus.PENDING]:  "text-orange-600 bg-orange-50 border-orange-200",
  [CrmStatus.APPROVED]: "text-blue-600 bg-blue-50 border-blue-200",
  [CrmStatus.PAID]:     "text-green-600 bg-green-50 border-green-200",
  Deleted:              "text-red-600 bg-red-50 border-red-200",
};

const CrmBrokerPayments: React.FC = () => {
  const navigate = useNavigate();
  usePageRights("crm-brokerage");
  const [search, setSearch] = useState("");

  const { data: records = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ["crm-brokerage"],
    queryFn: fetchBrokerages,
    staleTime: 30_000,
  });

  const filtered = useMemo(() =>
    (records as any[]).filter((r: any) =>
      !search
        || r.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || r.BrokerName?.toLowerCase().includes(search.toLowerCase())
        || r.BookingNo?.includes(search)
    ), [records, search]);

  // Summary totals
  const totalPaid      = filtered.filter((r: any) => r.Status === CrmStatus.PAID).reduce((s: number, r: any) => s + Number((r.NetPayable ?? r.ComputedAmount) || 0), 0);
  const totalPending   = filtered.filter((r: any) => r.Status === CrmStatus.PENDING).reduce((s: number, r: any) => s + Number((r.NetPayable ?? r.ComputedAmount) || 0), 0);
  const totalInFinance = filtered.filter((r: any) => r.Status === CrmStatus.APPROVED).reduce((s: number, r: any) => s + Number((r.NetPayable ?? r.ComputedAmount) || 0), 0);

  const columns: ColumnDef<any, unknown>[] = [
    {
      accessorKey: "BookingNo", header: "Booking", size: 120,
      cell: (i) => (
        <div>
          <div className="font-mono text-xs font-semibold">{i.row.original.BookingNo}</div>
          <div className="text-xs text-muted-foreground truncate max-w-[110px]">{i.row.original.ApplicantName}</div>
        </div>
      ),
    },
    {
      accessorKey: "BrokerName", header: "Broker", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium text-sm">{i.row.original.BrokerName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BrokerFirm || "—"}</div>
        </div>
      ),
    },
    {
      id: "rate", header: "Rate", size: 80, enableSorting: false,
      cell: (i) => (
        <span className="text-xs">
          {i.row.original.RateType === "Percentage"
            ? `${i.row.original.RateValue}%`
            : `₹${Number(i.row.original.RateValue).toLocaleString("en-IN")}`}
        </span>
      ),
    },
    {
      id: "amounts", header: "Gross / TDS / Net", size: 170, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        const gross = Number(r.ComputedAmount || 0);
        const tds   = Number(r.TDSAmount || 0);
        const net   = Number(r.NetPayable ?? gross);
        return (
          <div className="text-xs space-y-0.5">
            <div className="text-muted-foreground">₹{gross.toLocaleString("en-IN")}</div>
            {tds > 0 && <div className="text-orange-600">TDS: ₹{tds.toLocaleString("en-IN")}</div>}
            <div className="font-bold text-foreground">Net: ₹{net.toLocaleString("en-IN")}</div>
          </div>
        );
      },
    },
    {
      accessorKey: "Status", header: "Brokerage Status", size: 120,
      cell: (i) => {
        const r = i.row.original;
        if (r.IsLocked) {
          return (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium text-red-600 bg-red-50 border-red-200">
              <Lock size={10} /> Locked
            </span>
          );
        }
        return (
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[r.Status] || ""}`}>
            {r.Status}
          </span>
        );
      },
    },
    {
      id: "financeStatus", header: "Finance Payment", size: 160, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        if (r.Status === CrmStatus.PENDING) {
          return <span className="text-xs text-muted-foreground italic">Awaiting approval</span>;
        }
        if (r.Status === CrmStatus.PAID) {
          return (
            <div className="text-xs space-y-0.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-medium text-green-600 bg-green-50 border-green-200">Paid</span>
              {Number(r.TotalPaid) > 0 && (
                <div className="text-green-700 font-semibold">₹{Number(r.TotalPaid).toLocaleString("en-IN")}</div>
              )}
            </div>
          );
        }
        // Approved — should have a Finance payment
        if (!r.FinancePaymentId) {
          return <span className="text-xs text-orange-600 italic">Handoff pending — retry needed</span>;
        }
        const fColor = finStatusColor[r.FinancePaymentStatus] || "text-muted-foreground bg-muted border-border";
        return (
          <button
            onClick={() => navigate(`/payments?id=${r.FinancePaymentId}`)}
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${fColor}`}
          >
            {r.FinancePaymentDocNo || `#${r.FinancePaymentId}`}
            <ExternalLink size={10} />
          </button>
        );
      },
    },
    {
      id: "actions", header: "", size: 90, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        return (
          <button
            onClick={() => navigate(`/crm/brokerage?view=${r.Id}`)}
            className="text-xs text-primary hover:underline"
          >
            {r.Status === CrmStatus.PENDING ? "Review" : "View"}
          </button>
        );
      },
    },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Broker Payments"]} />
      <CrmShell
        title="CRM — Broker Payments"
        subtitle="Brokerage amounts approved here flow to Finance as payment orders; Finance completes payout and the status updates automatically"
      >
        <div className="flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search broker, customer, booking..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {!isError && (
            <>
              {totalPending > 0 && (
                <div className="flex items-center gap-1.5 text-sm bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                  <IndianRupee size={14} className="text-orange-600" />
                  <span className="text-orange-600">Pending approval:</span>
                  <span className="font-semibold text-orange-700">₹{totalPending.toLocaleString("en-IN")}</span>
                </div>
              )}
              {totalInFinance > 0 && (
                <div className="flex items-center gap-1.5 text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <IndianRupee size={14} className="text-blue-600" />
                  <span className="text-blue-600">With Finance:</span>
                  <span className="font-semibold text-blue-700">₹{totalInFinance.toLocaleString("en-IN")}</span>
                </div>
              )}
              {totalPaid > 0 && (
                <div className="flex items-center gap-1.5 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <IndianRupee size={14} className="text-green-600" />
                  <span className="text-green-600">Paid:</span>
                  <span className="font-semibold text-green-700">₹{totalPaid.toLocaleString("en-IN")}</span>
                </div>
              )}
            </>
          )}
        </div>

        {isError ? (
          <div className="flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
            <span>Couldn't load broker records: {(error as Error)?.message || "unknown error"}</span>
            <button
              onClick={() => refetch()}
              className="text-xs font-medium underline underline-offset-2 hover:no-underline"
            >
              Retry
            </button>
          </div>
        ) : (
          <DataTable
            data={filtered}
            columns={columns}
            searchable={false}
            loading={isLoading}
            emptyMessage="No brokerage records found"
            className="rounded-xl border border-border overflow-hidden bg-card"
          />
        )}
      </CrmShell>
    </>
  );
};

export default CrmBrokerPayments;
