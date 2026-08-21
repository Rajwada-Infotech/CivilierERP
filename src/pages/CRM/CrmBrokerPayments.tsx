import { CrmStatus } from "@/constants/crmStatuses";
import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CrmShell } from "@/components/crm/CrmShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, IndianRupee, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";

const API = "/api/crm/brokerage";

async function fetchPayments(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/payments`);
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error || `Failed to load broker payments (${r.status})`);
  }
  return r.json();
}

// This page is tracking/reporting only. Actually paying a broker happens in
// Finance, not here: CRM (crmBrokerage.js) hands each approved brokerage
// record to Finance as a dbo.NewPayment ("PUT /:id/approve" ->
// createFinancePaymentForBrokerage), Finance completes the payment details
// and approves it from the Payments module, and that approval writes back
// into dbo.CrmBrokerPayment / flips the brokerage record to 'Paid'
// automatically. A "Record Payment" action used to live here that inserted
// a second, CRM-originated NewPayment directly (bank picked by CRM staff,
// bypassing Finance's own data entry and approval) — it's removed; this
// page now only reflects what Finance has already done or has pending.
const CrmBrokerPayments: React.FC = () => {
  const navigate = useNavigate();
  usePageRights("crm-brokerage");
  const [search, setSearch] = useState("");

  const { data: payments = [], isLoading, isError, error, refetch } = useQuery({ queryKey: ["crm-broker-payments"], queryFn: fetchPayments, staleTime: 30_000 });

  const filtered = useMemo(() =>
    (payments as any[]).filter((p: any) =>
      !search || p.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || p.BrokerName?.toLowerCase().includes(search.toLowerCase())
        || p.BookingNo?.includes(search)
    ), [payments, search]);

  const totalPaid = filtered
    .filter((p: any) => p.FinancePaymentStatus === CrmStatus.PAID || p.FinancePaymentStatus === undefined)
    .reduce((s: number, p: any) => s + Number(p.Amount || 0), 0);
  const totalPending = filtered
    .filter((p: any) => p.FinancePaymentStatus === CrmStatus.DRAFT || p.FinancePaymentStatus === CrmStatus.PENDING || p.FinancePaymentStatus === CrmStatus.APPROVED)
    .reduce((s: number, p: any) => s + Number(p.Amount || 0), 0);

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BrokerName", header: "Broker", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.BrokerName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BrokerFirm || "—"}</div>
        </div>
      ) },
    { id: "bookingCustomer", header: "Booking / Customer", size: 150, enableSorting: false,
      cell: (i) => (
        <div>
          <div className="font-mono text-xs">{i.row.original.BookingNo}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.ApplicantName}</div>
        </div>
      ) },
    { accessorKey: "Amount", header: "Amount", size: 110, cell: (i) => <span className="font-semibold text-green-600">₹{Number(i.row.original.Amount).toLocaleString("en-IN")}</span> },
    { accessorKey: "PaidDate", header: "Paid Date", size: 100, cell: (i) => <span className="text-xs">{i.row.original.PaidDate ? String(i.row.original.PaidDate).slice(0, 10) : "—"}</span> },
    { accessorKey: "PaymentMode", header: "Mode", size: 90, cell: (i) => <span className="text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "TransactionRef", header: "Ref", size: 110, cell: (i) => <span className="text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { id: "financeStatus", header: "Finance Status", size: 110, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        const status = r.FinancePaymentStatus || "Paid";
        const color = status === CrmStatus.PAID ? "text-green-600 bg-green-50 border-green-200"
          : status === CrmStatus.APPROVED ? "text-blue-600 bg-blue-50 border-blue-200"
          : "text-orange-600 bg-orange-50 border-orange-200";
        return (
          <button
            onClick={() => r.FinancePaymentId && navigate(`/payments?id=${r.FinancePaymentId}`)}
            disabled={!r.FinancePaymentId}
            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${color} disabled:cursor-default`}
          >
            {status} {r.FinancePaymentId && <ExternalLink size={10} />}
          </button>
        );
      } },
    { accessorKey: "CreatedByName", header: "Recorded By", size: 110, cell: (i) => <span className="text-xs text-muted-foreground">{(i.getValue() as string) || "—"}</span> },
  ];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Broker Payments"]} />
      <CrmShell
        title="CRM — Broker Payment"
      subtitle="Tracking only — payouts are recorded and approved in Finance, and reflect here automatically"
    >
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search broker, customer, booking..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        {!isError && (
          <div className="flex items-center gap-1.5 text-sm bg-muted/30 border border-border rounded-lg px-3 py-2">
            <IndianRupee size={14} className="text-muted-foreground" />
            <span className="text-muted-foreground">Paid:</span>
            <span className="font-semibold">₹{totalPaid.toLocaleString("en-IN")}</span>
          </div>
        )}
        {!isError && totalPending > 0 && (
          <div className="flex items-center gap-1.5 text-sm bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
            <IndianRupee size={14} className="text-orange-600" />
            <span className="text-orange-600">Awaiting Finance:</span>
            <span className="font-semibold text-orange-600">₹{totalPending.toLocaleString("en-IN")}</span>
          </div>
        )}
      </div>

      {isError ? (
        <div className="flex items-center justify-between gap-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3">
          <span>Couldn't load broker payments: {(error as Error)?.message || "unknown error"}</span>
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
          emptyMessage="No broker payments recorded"
          className="rounded-xl border border-border overflow-hidden bg-card"
        />
      )}
      </CrmShell>
    </>
  );
};

export default CrmBrokerPayments;