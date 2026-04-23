import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import {
  MasterPage,
  type DataChangeEvent,
  type FieldDef,
  type RecordWithId,
} from "@/components/MasterPage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPayments,
  addPayment,
  updatePayment,
  deletePayment,
} from "@/api/newPaymentApi";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

import { Banknote, Clock, CheckCircle2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";

interface DbPayment {
  PPaymentID: number;
  PPaymentName: string | null;
  PMode: string | null;
  PAmount: number | null;
  PDocType: string | null;
  PDate: string | null;
  PBankID: number | null;
  PBankName: string | null;
  PProject: string | null;
  PCompany: string | null;
}

interface BankOption {
  LHeadId: number;
  LHeadName: string;
}

// ── Fetch banks from API ───────────────────────────────────────────────────────
const fetchBanks = async (): Promise<BankOption[]> => {
  const res = await fetchWithAuth("/api/bank-master");

  if (!res.ok) throw new Error("Failed to fetch banks");
  const data = await res.json();
  // bank-master returns array of account heads with LHeadType = 'B'
  return (Array.isArray(data) ? data : data.data ?? []).map((b: any) => ({
    LHeadId: b.LHeadId,
    LHeadName: b.LHeadName,
  }));
};

const toPayload = (r: Record<string, unknown>) => {
  // bankId is stored as "LHeadId|LHeadName" string from the select
  // OR just the numeric ID if coming from existing record
  let PBankID: number | null = null;
  let PBankName: string | null = null;

  if (r.bank && typeof r.bank === "string" && r.bank.includes("|")) {
    const [idStr, name] = (r.bank as string).split("|");
    PBankID = Number(idStr) || null;
    PBankName = name || null;
  } else if (r.bankId) {
    PBankID = Number(r.bankId) || null;
    PBankName = (r.bankName as string) || null;
  }

  return {
    PPaymentName: (r.paymentName as string) || null,
    PMode: (r.mode as string) || null,
    PAmount: r.amount ? Number(r.amount) : null,
    PDocType: (r.docType as string) || null,
    PDate: (r.date as string) || null,
    PBankID,
    PBankName,
    PProject: (r.project as string) || null,
    PCompany: (r.company as string) || null,
  };
};

// ── Mode badge renderer ────────────────────────────────────────────────────────
function modeRenderer(value: unknown) {
  const v = (value as string) || "";
  const map: Record<string, { bg: string; dot: string }> = {
    Cash: {
      bg: "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
    },
    Cheque: {
      bg: "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400",
      dot: "bg-blue-500",
    },
    UPI: {
      bg: "bg-violet-500/10 border-violet-500/20 text-violet-600 dark:text-violet-400",
      dot: "bg-violet-500",
    },
    Card: {
      bg: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
      dot: "bg-amber-500",
    },
    NEFT: {
      bg: "bg-cyan-500/10 border-cyan-500/20 text-cyan-600 dark:text-cyan-400",
      dot: "bg-cyan-500",
    },
    RTGS: {
      bg: "bg-orange-500/10 border-orange-500/20 text-orange-600 dark:text-orange-400",
      dot: "bg-orange-500",
    },
  };
  const s = map[v] ?? {
    bg: "bg-muted border-border text-muted-foreground",
    dot: "bg-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${s.bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${s.dot}`} />
      {v || "—"}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const Payment: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 20;

  const {
    data: dbData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["payments", page],
    queryFn: () => getPayments(page, PAGE_SIZE),
  });

  // Fetch banks for dropdown
  const { data: banks = [] } = useQuery<BankOption[]>({
    queryKey: ["banks-for-payment"],
    queryFn: fetchBanks,
  });

  const dbItems: DbPayment[] = Array.isArray(dbData?.data) ? dbData.data : [];
  const totalPages: number = dbData?.totalPages ?? 1;
  const totalRecords: number = dbData?.total ?? 0;

  // ── Summary stats ────────────────────────────────────────────────────────────
  const totalAmount = dbItems.reduce((sum, p) => sum + (p.PAmount || 0), 0);
  const cashCount = dbItems.filter((p) => p.PMode === "Cash").length;
  const chequeCount = dbItems.filter((p) => p.PMode === "Cheque").length;

  const mappedData = dbItems.map((item) => ({
    _id: String(item.PPaymentID),
    paymentName: item.PPaymentName || "",
    mode: item.PMode || "",
    amount: item.PAmount ?? "",
    docType: item.PDocType || "",
    date: item.PDate?.slice(0, 10) || "",
    bank: item.PBankID ? `${item.PBankID}|${item.PBankName || ""}` : "",
    bankId: item.PBankID ?? "",
    bankName: item.PBankName || "",
    project: item.PProject || "",
    company: item.PCompany || "",
    status: (item as any).Status || "Draft",
  }));

  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add") {
      try {
await addPayment(toPayload(event.record));
        toast.success("Payment saved!");
        queryClient.invalidateQueries({ queryKey: ["payments"] });
      } catch (err: any) {
        toast.error("Save failed: " + err.message);
      }
    }
    if (event.action === "update") {
      try {
        await updatePayment(event.id, toPayload(event.record));
        toast.success("Payment updated!");
        await queryClient.invalidateQueries({ queryKey: ["payments"] });
      } catch (err: any) {
        toast.error("Update failed: " + err.message);
      }
    }
    if (event.action === "delete") {
      try {
        await deletePayment(event.id);
        toast.success("Payment deleted!");
        await queryClient.invalidateQueries({ queryKey: ["payments"] });
      } catch (err: any) {
        toast.error("Delete failed: " + err.message);
      }
    }
  };

  const columnRenderers: Record<
    string,
    (value: unknown, row: RecordWithId, data: RecordWithId[]) => React.ReactNode
  > = {
    mode: (value) => modeRenderer(value),
    amount: (value) => (
      <span className="font-mono text-sm">
        ₹{Number(value || 0).toLocaleString("en-IN")}
      </span>
    ),
    status: (value, row) => (
      <div className="flex flex-col gap-1.5">
        <StatusBadge status={String(value || "Draft")} />
        <ApprovalActions
          status={String(value || "Draft")}
          recordId={Number(row._id)}
          endpoint="/api/new-payment"
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["payments"] })}
        />
      </div>
    ),
  };

  // Build bank options as "LHeadId|LHeadName" strings so value carries both pieces
  const bankOptions = banks.map((b) => `${b.LHeadId}|${b.LHeadName}`);

  if (isLoading)
    return <div className="p-6 text-muted-foreground">Loading...</div>;
  if (error)
    return <div className="p-6 text-red-500">Failed to load payments.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Finance", "Payments"]} />
      <h1 className="text-xl font-heading font-bold text-foreground mb-4">
        Payment Management
      </h1>

      {/* ── Summary stats ── */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl bg-card border border-border p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <Banknote size={18} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="text-base font-bold">
              ₹{totalAmount.toLocaleString("en-IN")}
            </p>
          </div>
        </div>
        <div className="rounded-xl bg-card border border-border p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Clock size={18} className="text-amber-600" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Cheque</p>
            <p className="text-base font-bold text-amber-600">{chequeCount}</p>
          </div>
        </div>
        <div className="rounded-xl bg-card border border-border p-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/10">
            <CheckCircle2 size={18} className="text-green-600" />
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Cash</p>
            <p className="text-base font-bold text-green-600">{cashCount}</p>
          </div>
        </div>
      </div>

      <MasterPage
        title="Payment"
        fields={[
          {
            name: "paymentName",
            label: "Payment Name",
            type: "text",
            required: true,
          },
          {
            name: "project",
            label: "Project",
            type: "select",
            required: true,
            options: [
              "Civilier Infrastructure Pvt Ltd",
              "Apex Constructions Ltd",
              "SiteCraft Engineers",
              "Raj Builders & Co",
              "Metro Rail Project",
            ],
          },
          { name: "company", label: "Company", type: "text" },
          {
            name: "mode",
            label: "Payment Mode",
            type: "select",
            required: true,
            options: ["Cash", "Cheque", "UPI", "Card", "NEFT", "RTGS"],
          },
          {
            name: "docType",
            label: "Doc Type",
            type: "select",
            required: true,
            options: ["Invoice", "Bill", "Receipt", "Voucher"],
          },
          { name: "date", label: "Payment Date", type: "date", required: true },
          {
            name: "amount",
            label: "Amount (₹)",
            type: "number",
            required: true,
          },
          {
            // Single dropdown: value = "LHeadId|LHeadName", toPayload splits it
            name: "bank",
            label: "Bank",
            type: "select",
            options: bankOptions,
          },
        ]}
        columns={[
          { key: "paymentName", label: "Payment Name" },
          { key: "project", label: "Project", hideOnMobile: true },
          { key: "mode", label: "Mode" },
          { key: "date", label: "Date", hideOnMobile: true },
          { key: "amount", label: "Amount" },
          { key: "bankName", label: "Bank", hideOnMobile: true },
          { key: "docType", label: "Doc Type", hideOnMobile: true },
          { key: "status", label: "Status" },
        ]}
        columnRenderers={columnRenderers}
        initialData={mappedData}
        onDataEvent={handleDataEvent}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-xs text-muted-foreground">
            Showing page {page} of {totalPages} &middot; {totalRecords} total records
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const pg = page <= 3 ? i + 1 : page - 2 + i;
              if (pg < 1 || pg > totalPages) return null;
              return (
                <button
                  key={pg}
                  onClick={() => setPage(pg)}
                  className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                    pg === page
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {pg}
                </button>
              );
            })}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-md text-xs border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Payment;

