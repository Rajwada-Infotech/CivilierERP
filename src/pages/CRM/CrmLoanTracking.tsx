import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Landmark, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const BKG_API = "/api/crm/bookings";

const SANCTION_STATUSES = ["NotApplied", "Applied", "Sanctioned", "Rejected", "Disbursed"];
const statusColor: Record<string, string> = {
  NotApplied: "text-muted-foreground bg-muted/50 border-border",
  Applied:    "text-blue-600 bg-blue-50 border-blue-200",
  Sanctioned: "text-green-600 bg-green-50 border-green-200",
  Rejected:   "text-red-600 bg-red-50 border-red-200",
  Disbursed:  "text-purple-600 bg-purple-50 border-purple-200",
};

const EMPTY_FORM = {
  BankName: "", BranchName: "", LoanAmount: "", SanctionStatus: "NotApplied",
  SanctionDate: "", DisbursedAmount: "", LoanAccountNo: "", RmName: "", RmContact: "", Notes: "",
};

async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchLoan(bookingId: number): Promise<any> {
  const r = await fetchWithAuth(`${BKG_API}/${bookingId}/loan`);
  return r.ok ? r.json() : null;
}

const fmt = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

const CrmLoanTracking: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingBookingId, setEditingBookingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  const { data: bookings = [], isLoading } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 60_000 });

  // Fetch loan details for all bookings in parallel (small dataset expected)
  const { data: loanMap = {} } = useQuery({
    queryKey: ["crm-loans", (bookings as any[]).map((b) => b.Id).join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        (bookings as any[]).map(async (b) => [b.Id, await fetchLoan(b.Id)] as const)
      );
      return Object.fromEntries(entries);
    },
    enabled: bookings.length > 0,
    staleTime: 30_000,
  });

  const filtered = useMemo(() =>
    (bookings as any[]).filter((b: any) =>
      !search || b.ApplicantName?.toLowerCase().includes(search.toLowerCase()) || b.BookingNo?.includes(search)
    ), [bookings, search]);

  const openEdit = (bookingId: number) => {
    const existing = loanMap[bookingId];
    setForm(existing ? {
      BankName: existing.BankName || "", BranchName: existing.BranchName || "",
      LoanAmount: existing.LoanAmount != null ? String(existing.LoanAmount) : "",
      SanctionStatus: existing.SanctionStatus || "NotApplied",
      SanctionDate: existing.SanctionDate ? String(existing.SanctionDate).slice(0, 10) : "",
      DisbursedAmount: existing.DisbursedAmount != null ? String(existing.DisbursedAmount) : "",
      LoanAccountNo: existing.LoanAccountNo || "", RmName: existing.RmName || "", RmContact: existing.RmContact || "",
      Notes: existing.Notes || "",
    } : { ...EMPTY_FORM });
    setEditingBookingId(bookingId);
  };

  const handleSave = async () => {
    if (!editingBookingId) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${BKG_API}/${editingBookingId}/loan`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Loan details updated");
      setEditingBookingId(null);
      qc.invalidateQueries({ queryKey: ["crm-loans"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking", size: 110, cell: (i) => <span className="font-mono text-xs">{i.getValue() as string}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 150,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>
        </div>
      ) },
    { accessorKey: "TotalValue", header: "Total Value", size: 110, cell: (i) => <span>{fmt(i.row.original.GrandTotal ?? i.row.original.TotalValue)}</span> },
    { id: "bankName", header: "Bank", size: 110, enableSorting: false,
      cell: (i) => <span>{loanMap[i.row.original.Id]?.BankName || "—"}</span> },
    { id: "loanAmount", header: "Loan Amount", size: 110, enableSorting: false,
      cell: (i) => <span>{fmt(loanMap[i.row.original.Id]?.LoanAmount)}</span> },
    { id: "disbursed", header: "Disbursed", size: 110, enableSorting: false,
      cell: (i) => <span className="text-green-600">{fmt(loanMap[i.row.original.Id]?.DisbursedAmount)}</span> },
    { id: "status", header: "Status", size: 100, enableSorting: false,
      cell: (i) => {
        const status = loanMap[i.row.original.Id]?.SanctionStatus || "NotApplied";
        return <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[status]}`}>{status}</span>;
      } },
    { id: "rmContact", header: "RM Contact", size: 130, enableSorting: false,
      cell: (i) => {
        const loan = loanMap[i.row.original.Id];
        return <span className="text-xs">{loan?.RmName ? `${loan.RmName} · ${loan.RmContact || ""}` : "—"}</span>;
      } },
    { id: "actions", header: "", size: 80, enableSorting: false,
      cell: (i) => (
        <button onClick={() => openEdit(i.row.original.Id)} className="flex items-center gap-1 text-xs text-primary hover:underline">
          <Landmark size={12} /> {loanMap[i.row.original.Id] ? "Edit" : "Add"}
        </button>
      ) },
  ];

  return (
    <SalesAutoShell title="CRM — Home Loan Tracking" subtitle="Bank coordination and loan disbursement status per booking">
      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer or booking no..."
          className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No bookings found"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      <Dialog open={!!editingBookingId} onOpenChange={(o) => { if (!o) setEditingBookingId(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">Loan / Bank Details</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: "BankName",     label: "Bank Name",       type: "text"   },
              { key: "BranchName",   label: "Branch",          type: "text"   },
              { key: "LoanAmount",   label: "Loan Amount (₹)", type: "number" },
              { key: "SanctionDate", label: "Sanction Date",   type: "date"   },
              { key: "DisbursedAmount", label: "Disbursed Amount (₹)", type: "number" },
              { key: "LoanAccountNo", label: "Loan Account No", type: "text"  },
              { key: "RmName",       label: "RM Name",         type: "text"   },
              { key: "RmContact",    label: "RM Contact",      type: "text"   },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                <input type={type} value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            ))}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sanction Status</label>
              <select value={form.SanctionStatus} onChange={(e) => setForm((f) => ({ ...f, SanctionStatus: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {SANCTION_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Notes</label>
            <textarea value={form.Notes} onChange={(e) => setForm((f) => ({ ...f, Notes: e.target.value }))}
              rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setEditingBookingId(null)} className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmLoanTracking;
