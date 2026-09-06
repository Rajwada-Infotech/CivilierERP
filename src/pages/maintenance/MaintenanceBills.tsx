import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Receipt,
  Search,
  Plus,
  Eye,
  Printer,
  Pencil,
  Ban,
  X,
  Loader2,
  Trash2,
} from "lucide-react";
import { numberToWordsIndian } from "@/lib/numberToWords";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import { ExportMenu } from "@/components/ExportMenu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getMaintenanceBills,
  getMaintenanceBill,
  createMaintenanceBill,
  updateMaintenanceBill,
  cancelMaintenanceBill,
  type MaintenanceBillListRow,
  type MaintenanceBillDetail,
} from "@/api/maintenanceBillApi";
import { getMaintenanceDirectory } from "@/api/maintenanceApi";
import { getActiveChargeHeads, type ChargeHeadRow } from "@/api/chargeHeadApi";

const fmt = (n: number | null | undefined) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

const STATUS_OPTIONS = ["Active", "Cancelled"] as const;

export default function MaintenanceBills() {
  const rights = usePageRights("maintenance-bills");
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editingBillId, setEditingBillId] = useState<number | null>(null);
  const [viewingBillId, setViewingBillId] = useState<number | null>(null);
  const [cancellingBill, setCancellingBill] = useState<MaintenanceBillListRow | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const filters = useMemo(
    () => ({ search, status, dateFrom, dateTo }),
    [search, status, dateFrom, dateTo],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["maintenance-bills", filters],
    queryFn: () => getMaintenanceBills(filters),
    staleTime: 30 * 1000,
  });

  const rows = Array.isArray(data) ? data : [];

  const handleCancel = async () => {
    if (!cancellingBill) return;
    setCancelling(true);
    try {
      await cancelMaintenanceBill(cancellingBill.Id, cancelReason || undefined);
      toast.success("Bill cancelled");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-bills"] });
      setCancellingBill(null);
      setCancelReason("");
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel bill");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Bills"]} />
      <MaintenanceShell
        title="Maintenance Bills"
        subtitle="Generate and manage maintenance bills per customer/unit"
        icon={Receipt}
        action={
          rights.canCreate && (
            <button
              onClick={() => {
                setEditingBillId(null);
                setFormOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white transition-all"
            >
              <Plus size={13} /> Create Bill
            </button>
          )
        }
      >
        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, unit, bill no…"
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground w-56"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
          >
            <option value="">All Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
          />
          {rights.canExport && (
            <div className="ml-auto">
              <ExportMenu
                data={rows as unknown as Record<string, unknown>[]}
                title="Maintenance Bills"
                filename="maintenance-bills"
                columns={[
                  { header: "Bill No", accessor: "BillNo" },
                  { header: "Customer", accessor: "CustomerName" },
                  { header: "Flat/Unit", accessor: (r) => [r.BlockName, r.UnitNo].filter(Boolean).join(" / ") },
                  { header: "Bill Date", accessor: (r) => fmtDate(r.BillDate as string) },
                  { header: "Subtotal", accessor: "Subtotal" },
                  { header: "Total Tax", accessor: "TotalTax" },
                  { header: "Grand Total", accessor: "GrandTotal" },
                  { header: "Status", accessor: "Status" },
                ]}
              />
            </div>
          )}
        </div>

        {/* ── List ────────────────────────────────────────────────────────── */}
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="text-sm text-red-500">Failed to load bills.</div>}

        {!isLoading && !error && rows.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-10 flex flex-col items-center gap-2 text-center px-6">
            <Receipt size={20} className="text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No bills found</p>
            <p className="text-xs text-muted-foreground max-w-sm">
              {rights.canCreate ? "Create a bill for a confirmed customer to get started." : "No maintenance bills match these filters."}
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                <tr>
                  <th className="text-left px-4 py-2.5">Bill No</th>
                  <th className="text-left px-4 py-2.5">Customer</th>
                  <th className="text-left px-4 py-2.5">Flat/Unit</th>
                  <th className="text-left px-4 py-2.5">Bill Date</th>
                  <th className="text-right px-4 py-2.5">Subtotal</th>
                  <th className="text-right px-4 py-2.5">Total Tax</th>
                  <th className="text-right px-4 py-2.5">Grand Total</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((b) => (
                  <tr key={b.Id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-xs font-medium text-foreground">{b.BillNo}</td>
                    <td className="px-4 py-2.5">{b.CustomerName || "—"}</td>
                    <td className="px-4 py-2.5">{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                    <td className="px-4 py-2.5">{fmtDate(b.BillDate)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(b.Subtotal)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{fmt(b.TotalTax)}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground">{fmt(b.GrandTotal)}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-heading border ${
                          b.Status === "Active"
                            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600"
                            : "bg-red-500/10 border-red-500/20 text-red-600"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${b.Status === "Active" ? "bg-emerald-500" : "bg-red-500"}`} />
                        {b.Status}
                      </span>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setViewingBillId(b.Id)}
                          title="View"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                        {rights.canEdit && b.Status === "Active" && (
                          <button
                            onClick={() => {
                              setEditingBillId(b.Id);
                              setFormOpen(true);
                            }}
                            title="Edit"
                            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {rights.canDelete && b.Status === "Active" && (
                          <button
                            onClick={() => setCancellingBill(b)}
                            title="Cancel"
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Ban size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MaintenanceShell>

      {formOpen && (
        <BillFormDialog
          billId={editingBillId}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            queryClient.invalidateQueries({ queryKey: ["maintenance-bills"] });
          }}
        />
      )}

      {viewingBillId !== null && (
        <BillViewModal billId={viewingBillId} onClose={() => setViewingBillId(null)} canPrint={rights.canPrint} canExport={rights.canExport} />
      )}

      {/* ── Cancel confirmation ─────────────────────────────────────────── */}
      <Dialog open={!!cancellingBill} onOpenChange={(open) => !open && setCancellingBill(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">Cancel Bill</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">
              Cancel bill <span className="font-mono font-medium text-foreground">{cancellingBill?.BillNo}</span>? This keeps the record for history but marks it Cancelled.
            </p>
            <div>
              <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                Reason (optional)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setCancellingBill(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                Back
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold bg-destructive text-destructive-foreground hover:opacity-90 transition-all disabled:opacity-60"
              >
                {cancelling ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />}
                Cancel Bill
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Create/Edit dialog ─────────────────────────────────────────────────────

interface LedgerLine {
  chargeHeadId: number;
  description: string;
  amount: number;
}

// ── Shared "printed bill" ledger sheet — a bordered grid matching the
// standard housing-society maintenance bill format (Bill No/Date/Flat/Due
// Date header, Period, Sr.No/Description/Amount table, Total Payable,
// Amount in Words, Notes, signature line). Used read-only by the view/print
// modal and, with the edit props, as the Create/Edit form itself. ──────────
function LedgerSheet({
  companyName,
  companyAddress,
  companyGstNo,
  billNo,
  billDate,
  unitLabel,
  dueDate,
  customerName,
  lines,
  totalPayable,
  notes,
  status,
  cancelReason,
  edit,
}: {
  companyName: string;
  companyAddress: string;
  companyGstNo?: string | null;
  billNo: string;
  billDate: string;
  unitLabel: string;
  dueDate: string;
  customerName: string;
  lines: LedgerLine[];
  totalPayable: number;
  notes: string;
  status?: "Active" | "Cancelled";
  cancelReason?: string | null;
  edit?: {
    availableChargeHeads: ChargeHeadRow[];
    onAddChargeHead: (id: number) => void;
    onRemoveChargeHead: (chargeHeadId: number) => void;
    onDueDateChange: (v: string) => void;
    onNotesChange: (v: string) => void;
  };
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden text-sm">
      {/* Society-style header */}
      <div className="text-center px-4 py-3.5 border-b border-border">
        <p className="font-heading font-bold text-base text-foreground">{companyName}</p>
        {companyAddress && <p className="text-xs text-muted-foreground mt-0.5">{companyAddress}</p>}
        {companyGstNo && <p className="text-xs text-muted-foreground mt-0.5">GSTIN: {companyGstNo}</p>}
      </div>

      {/* Bill No / Bill Date / Flat No / Due Date */}
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
        {[
          { label: "Bill No.", value: billNo, mono: true },
          { label: "Bill Date", value: billDate },
          { label: "Flat No.", value: unitLabel },
        ].map((f) => (
          <div key={f.label} className="px-3 py-2">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground">{f.label}</p>
            <p className={`text-xs font-semibold text-foreground mt-0.5 ${f.mono ? "font-mono" : ""}`}>{f.value || "—"}</p>
          </div>
        ))}
        <div className="px-3 py-2">
          <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Due Date</p>
          {edit ? (
            <input
              type="date"
              value={dueDate}
              onChange={(e) => edit.onDueDateChange(e.target.value)}
              className="w-full mt-0.5 text-xs font-semibold bg-transparent border-none p-0 text-foreground focus:outline-none"
            />
          ) : (
            <p className="text-xs font-semibold text-foreground mt-0.5">{dueDate || "—"}</p>
          )}
        </div>
      </div>

      {/* Name */}
      <div className="px-3 py-2 border-b border-border">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground">Name</p>
        <p className="text-sm font-semibold text-foreground mt-0.5">{customerName || "—"}</p>
      </div>

      {/* Sr.No / Description / Amount */}
      <table className="w-full text-xs">
        <thead className="bg-muted/30">
          <tr>
            <th className="w-10 text-left px-2 py-1.5 border-b border-border text-[9px] uppercase tracking-widest text-muted-foreground">Sr.</th>
            <th className="text-left px-2 py-1.5 border-b border-border text-[9px] uppercase tracking-widest text-muted-foreground">Description</th>
            <th className="w-28 text-right px-3 py-1.5 border-b border-border text-[9px] uppercase tracking-widest text-muted-foreground">Amount</th>
            {edit && <th className="w-8 border-b border-border" />}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <td colSpan={edit ? 4 : 3} className="px-3 py-4 text-center text-muted-foreground">
                No charge heads added yet.
              </td>
            </tr>
          )}
          {lines.map((l, i) => (
            <tr key={l.chargeHeadId} className="border-b border-border/60">
              <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
              <td className="px-2 py-1.5 text-foreground">{l.description}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmt(l.amount)}</td>
              {edit && (
                <td className="px-1 py-1.5 text-center">
                  <button onClick={() => edit.onRemoveChargeHead(l.chargeHeadId)} title="Remove"
                    className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 size={12} />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {edit && (
            <tr>
              <td className="px-2 py-1.5" />
              <td className="px-2 py-1.5" colSpan={edit ? 3 : 2}>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) edit.onAddChargeHead(Number(e.target.value));
                  }}
                  className="w-full text-xs bg-muted/30 border border-dashed border-border rounded px-2 py-1 text-muted-foreground focus:outline-none"
                >
                  <option value="">+ Add Charge Head…</option>
                  {edit.availableChargeHeads.map((ch) => (
                    <option key={ch.Id} value={ch.Id}>
                      {ch.Name} — {fmt(ch.Rate)} ({ch.TaxPct || 0}% tax)
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/20">
            <td colSpan={2} className="px-2 py-2 text-right font-heading font-bold text-foreground">Total Payable</td>
            <td className="px-3 py-2 text-right font-mono font-bold text-foreground tabular-nums">{fmt(totalPayable)}</td>
            {edit && <td />}
          </tr>
        </tfoot>
      </table>

      {/* Amount in words */}
      <div className="px-3 py-2 border-t border-border text-xs">
        <span className="text-muted-foreground">Amount In Words: </span>
        <span className="font-medium text-foreground">{numberToWordsIndian(totalPayable)}</span>
      </div>

      {status === "Cancelled" && (
        <div className="px-3 py-2 border-t border-border bg-destructive/5 text-xs text-destructive">
          Cancelled{cancelReason ? ` — ${cancelReason}` : ""}
        </div>
      )}

      {/* Notes */}
      <div className="px-3 py-2.5 border-t border-border">
        <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Notes</p>
        {edit ? (
          <textarea
            value={notes}
            onChange={(e) => edit.onNotesChange(e.target.value)}
            rows={3}
            placeholder="e.g. Cheque should be drawn in favour of the society only. Interest @ 18% p.a. will be charged for delayed payments."
            className="w-full text-xs bg-muted/20 border border-border rounded px-2 py-1.5 text-foreground focus:outline-none resize-none"
          />
        ) : notes ? (
          <p className="text-xs text-foreground whitespace-pre-line">{notes}</p>
        ) : (
          <p className="text-xs text-muted-foreground italic">—</p>
        )}
      </div>

      {/* Signature footer */}
      <div className="px-3 py-4 border-t border-border text-right">
        <p className="text-sm font-heading font-bold text-foreground">For {companyName}</p>
        <p className="text-[10px] text-muted-foreground mt-6">Secretary / Chairman / Treasurer</p>
      </div>
    </div>
  );
}

function BillFormDialog({
  billId,
  onClose,
  onSaved,
}: {
  billId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = billId !== null;
  const [bookingId, setBookingId] = useState<string>("");
  const [selectedChargeHeadIds, setSelectedChargeHeadIds] = useState<number[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: directory } = useQuery({
    queryKey: ["maintenance-directory", ""],
    queryFn: () => getMaintenanceDirectory(""),
    enabled: !isEdit,
  });

  const { data: chargeHeads } = useQuery({
    queryKey: ["charge-heads", "active"],
    queryFn: getActiveChargeHeads,
  });

  const { data: existingBill, isLoading: loadingExisting } = useQuery({
    queryKey: ["maintenance-bill", billId],
    queryFn: () => getMaintenanceBill(billId!),
    enabled: isEdit,
  });

  React.useEffect(() => {
    if (existingBill) {
      setBookingId(String(existingBill.BookingId));
      setSelectedChargeHeadIds(existingBill.items.map((i) => i.ChargeHeadId));
      setDueDate(existingBill.DueDate ? existingBill.DueDate.slice(0, 10) : "");
      setNotes(existingBill.Notes || "");
    }
  }, [existingBill]);

  const directoryRows = Array.isArray(directory) ? directory : [];
  const chargeHeadRows: ChargeHeadRow[] = chargeHeads || [];
  const selectedCustomer = isEdit
    ? existingBill
    : directoryRows.find((c) => String(c.Id) === bookingId);

  const selectedRows = chargeHeadRows.filter((ch) => selectedChargeHeadIds.includes(ch.Id));
  const availableChargeHeads = chargeHeadRows.filter((ch) => !selectedChargeHeadIds.includes(ch.Id));
  const lines: LedgerLine[] = selectedRows.map((ch) => {
    const rate = Number(ch.Rate) || 0;
    const taxAmt = (rate * (Number(ch.TaxPct) || 0)) / 100;
    return { chargeHeadId: ch.Id, description: ch.Name, amount: rate + taxAmt };
  });
  const grandTotal = lines.reduce((s, l) => s + l.amount, 0);

  const handleSave = async () => {
    if (!isEdit && !bookingId) {
      toast.error("Select a customer");
      return;
    }
    if (selectedChargeHeadIds.length === 0) {
      toast.error("Add at least one Charge Head");
      return;
    }
    setSaving(true);
    const extras = { dueDate: dueDate || null, notes: notes || null };
    try {
      if (isEdit) {
        await updateMaintenanceBill(billId!, selectedChargeHeadIds, extras);
        toast.success("Bill updated");
      } else {
        await createMaintenanceBill(Number(bookingId), selectedChargeHeadIds, extras);
        toast.success("Bill created");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save bill");
    } finally {
      setSaving(false);
    }
  };

  const companyName = (isEdit ? existingBill?.CompanyName : undefined) || "Maintenance Bill";
  const companyAddress = isEdit
    ? [existingBill?.CompanyAddress, existingBill?.CompanyAddressLine2, existingBill?.CompanyCity, existingBill?.CompanyState, existingBill?.CompanyPincode].filter(Boolean).join(", ")
    : "";
  const unitLabel = isEdit
    ? [existingBill?.BlockName, existingBill?.UnitNo].filter(Boolean).join(" / ")
    : [selectedCustomer && "BlockName" in selectedCustomer ? selectedCustomer.BlockName : "", selectedCustomer && "UnitNo" in selectedCustomer ? selectedCustomer.UnitNo : ""].filter(Boolean).join(" / ");
  const customerName = isEdit ? existingBill?.CustomerName || "" : (selectedCustomer as any)?.CustomerName || "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl max-h-[88vh] overflow-hidden p-0 gap-0 flex flex-col"
        style={{ background: "hsl(var(--card))" }}
      >
        <div
          className="shrink-0 border-b border-border pl-6 pr-12 py-4 flex items-center gap-3"
          style={{ background: "hsl(var(--card))" }}
        >
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}30` }}
          >
            <Receipt size={16} style={{ color: ACCENT }} />
          </div>
          <div>
            <DialogTitle className="font-heading font-bold text-base leading-tight">
              {isEdit ? "Edit Bill" : "Create Maintenance Bill"}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isEdit ? "Update the applied charge heads" : "Pick a customer and the charges that apply"}
            </p>
          </div>
        </div>

        {isEdit && loadingExisting ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {!isEdit && (
              <div>
                <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                  Customer / Flat
                </label>
                <select
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  className="w-full appearance-none px-3.5 py-2.5 rounded-xl text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 text-foreground"
                  style={{ "--tw-ring-color": ACCENT } as React.CSSProperties}
                >
                  <option value="">Select customer…</option>
                  {directoryRows.map((c) => (
                    <option key={c.Id} value={c.Id}>
                      {c.CustomerName} — {[c.BlockName, c.UnitNo].filter(Boolean).join(" / ")} ({c.BookingNo})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <LedgerSheet
              companyName={companyName}
              companyAddress={companyAddress}
              companyGstNo={isEdit ? existingBill?.CompanyGstNo : undefined}
              billNo={isEdit ? existingBill?.BillNo || "" : "Auto-generated on save"}
              billDate={isEdit ? fmtDate(existingBill?.BillDate || null) : fmtDate(new Date().toISOString())}
              unitLabel={unitLabel || "—"}
              dueDate={dueDate}
              customerName={customerName}
              lines={lines}
              totalPayable={grandTotal}
              notes={notes}
              edit={{
                availableChargeHeads,
                onAddChargeHead: (id) => setSelectedChargeHeadIds((prev) => [...prev, id]),
                onRemoveChargeHead: (id) => setSelectedChargeHeadIds((prev) => prev.filter((x) => x !== id)),
                onDueDateChange: setDueDate,
                onNotesChange: setNotes,
              }}
            />
          </div>
        )}

        <div className="shrink-0 border-t border-border px-6 py-3.5 flex justify-end gap-2" style={{ background: "hsl(var(--card))" }}>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (isEdit && loadingExisting)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {isEdit ? "Save Changes" : "Create Bill"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── View / Print modal ─────────────────────────────────────────────────────

function BillViewModal({
  billId,
  onClose,
  canPrint,
  canExport,
}: {
  billId: number;
  onClose: () => void;
  canPrint: boolean;
  canExport: boolean;
}) {
  const { data: bill, isLoading } = useQuery<MaintenanceBillDetail>({
    queryKey: ["maintenance-bill", billId],
    queryFn: () => getMaintenanceBill(billId),
  });

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .mb-print-modal, .mb-print-modal * { visibility: visible; }
          .mb-print-modal {
            position: absolute !important;
            inset: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: none !important;
            max-height: none !important;
            overflow: visible !important;
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            background: white !important;
          }
          .mb-print-modal .sticky { position: static !important; }
          /* Force a real black-on-white printed page — the app's theme
             tokens resolve to light text in dark mode, which is invisible
             once forced onto white paper above. */
          .mb-print-modal, .mb-print-modal * { color: #000 !important; border-color: #999 !important; }
        }
      `}</style>
      <div
        className="mb-print-modal border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] sm:max-h-[88vh] overflow-y-auto"
        style={{ background: "hsl(var(--card))" }}
      >
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border"
          style={{ background: "hsl(var(--card))" }}
        >
          <div>
            <h2 className="font-heading font-bold text-base">{bill?.BillNo || "Bill"}</h2>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">Maintenance Bill</p>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            {canExport && bill && (
              <ExportMenu
                data={bill.items as unknown as Record<string, unknown>[]}
                title={`Maintenance Bill ${bill.BillNo}`}
                filename={`maintenance-bill-${bill.BillNo}`}
                columns={[
                  { header: "Charge Head", accessor: "ChargeHeadName" },
                  { header: "HSN/SAC", accessor: "HsnCode" },
                  { header: "Rate", accessor: "Rate" },
                  { header: "Tax %", accessor: "TaxPct" },
                  { header: "Tax Amount", accessor: "TaxAmount" },
                  { header: "Total", accessor: "TotalAmount" },
                ]}
              />
            )}
            {canPrint && (
              <button
                onClick={() => window.print()}
                title="Print Bill"
                className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground"
              >
                <Printer size={18} />
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {isLoading || !bill ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <LedgerSheet
              companyName={bill.CompanyName || "Maintenance Bill"}
              companyAddress={[bill.CompanyAddress, bill.CompanyAddressLine2, bill.CompanyCity, bill.CompanyState, bill.CompanyPincode].filter(Boolean).join(", ")}
              companyGstNo={bill.CompanyGstNo}
              billNo={bill.BillNo}
              billDate={fmtDate(bill.BillDate)}
              unitLabel={[bill.BlockName, bill.UnitNo].filter(Boolean).join(" / ") || "—"}
              dueDate={fmtDate(bill.DueDate)}
              customerName={bill.CustomerName || ""}
              lines={bill.items.map((it) => ({ chargeHeadId: it.ChargeHeadId, description: it.ChargeHeadName, amount: it.TotalAmount }))}
              totalPayable={bill.GrandTotal}
              notes={bill.Notes || ""}
              status={bill.Status}
              cancelReason={bill.CancelReason}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
