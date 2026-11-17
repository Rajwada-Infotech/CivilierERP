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
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, ICON_ACT_RED, SHEET_DIALOG, TD, TH } from "@/components/maintenance/maintParts";
import { HrEmpty, HrError, HR_FIELD, HR_HEAD, HR_LBL, HR_NUM, HR_RULE } from "@/components/hrpayroll/HrUi";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE, KEY_RED_SOLID } from "@/components/sheet/sheetParts";
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
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";

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
        action={
          rights.canCreate && (
            <button
              onClick={() => {
                setEditingBillId(null);
                setFormOpen(true);
              }}
              className={`${KEY_INK} h-9 px-4`}
            >
              <Plus size={13} /> Create Bill
            </button>
          )
        }
      >
        {/* ── Filters ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customer, unit, bill no…"
              className={`${HR_FIELD} pl-8`}
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={`${HR_FIELD} w-auto`}
          >
            <option value="">All Status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <DateInput
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className={`${HR_FIELD} w-auto ${HR_NUM}`}
          />
          <span className={HR_LBL}>to</span>
          <DateInput
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className={`${HR_FIELD} w-auto ${HR_NUM}`}
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
        {isLoading && <div className="skel" style={{ height: 240 }} />}
        {error && <HrError text="Failed to load bills." />}

        {!isLoading && !error && rows.length === 0 && (
          <div className="bg-card" style={{ border: HR_RULE }}>
            <HrEmpty
              icon={Receipt}
              title="No bills found"
              text={rights.canCreate ? "Create a bill for a confirmed customer to get started." : "No maintenance bills match these filters."}
            />
          </div>
        )}

        {rows.length > 0 && (
          <div className="bg-card overflow-x-auto" style={{ border: HR_RULE }}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Bill No</th>
                  <th className={TH}>Customer</th>
                  <th className={TH}>Flat/Unit</th>
                  <th className={TH}>Bill Date</th>
                  <th className={`${TH} text-right`}>Subtotal</th>
                  <th className={`${TH} text-right`}>Total Tax</th>
                  <th className={`${TH} text-right`}>Grand Total</th>
                  <th className={TH}>Status</th>
                  <th className={`${TH} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.Id} className="hover:bg-primary/5">
                    <td className={`${TD} text-xs font-medium text-foreground ${HR_NUM}`}>{b.BillNo}</td>
                    <td className={TD}>{b.CustomerName || "—"}</td>
                    <td className={TD}>{[b.BlockName, b.UnitNo].filter(Boolean).join(" / ") || "—"}</td>
                    <td className={`${TD} ${HR_NUM}`}>{fmtDate(b.BillDate)}</td>
                    <td className={`${TD} text-right ${HR_NUM}`}>{fmt(b.Subtotal)}</td>
                    <td className={`${TD} text-right ${HR_NUM}`}>{fmt(b.TotalTax)}</td>
                    <td className={`${TD} text-right font-semibold text-foreground ${HR_NUM}`}>{fmt(b.GrandTotal)}</td>
                    <td className={TD}>
                      <SheetMark text={b.Status} tone={b.Status === "Active" ? "done" : "stopped"} />
                    </td>
                    <td className={TD}>
                      <div className="flex items-center justify-end gap-1">
                        <button data-row-view
                          onClick={() => setViewingBillId(b.Id)}
                          title="View"
                          className={ICON_ACT}
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
                            className={ICON_ACT}
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {rights.canDelete && b.Status === "Active" && (
                          <button
                            onClick={() => setCancellingBill(b)}
                            title="Cancel"
                            className={ICON_ACT_RED}
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
        <DialogContent className={`${SHEET_DIALOG} max-w-sm`} style={{ margin: 0 }}>
          <DialogHeader>
            <DialogTitle className={HR_HEAD}>Cancel Bill</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">
              Cancel bill <span className={`font-medium text-foreground ${HR_NUM}`}>{cancellingBill?.BillNo}</span>? This keeps the record for history but marks it Cancelled.
            </p>
            <div>
              <label className={`block mb-1.5 ${HR_LBL}`}>
                Reason (optional)
              </label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={2}
                className={`${HR_FIELD} h-auto py-2 resize-none`}
              />
            </div>
            <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
              <button
                onClick={() => setCancellingBill(null)}
                className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}
              >
                Back
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className={`${KEY_RED_SOLID} h-9 px-5 flex-1 sm:flex-none`}
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
    <div className="border border-foreground bg-card text-sm">
      {/* Society-style header */}
      <div className="text-center px-4 py-3.5 border-b border-foreground/20">
        <p className="font-heading font-bold text-base text-foreground">{companyName}</p>
        {companyAddress && <p className="text-xs text-muted-foreground mt-0.5">{companyAddress}</p>}
        {companyGstNo && <p className={`text-xs text-muted-foreground mt-0.5 ${HR_NUM}`}>GSTIN: {companyGstNo}</p>}
      </div>

      {/* Bill No / Bill Date / Flat No / Due Date */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-foreground/20 border-b border-foreground/20">
        {[
          { label: "Bill No.", value: billNo, num: true },
          { label: "Bill Date", value: billDate, num: true },
          { label: "Flat No.", value: unitLabel },
        ].map((f) => (
          <div key={f.label} className="px-3 py-2">
            <p className={HR_LBL}>{f.label}</p>
            <p className={`text-xs font-semibold text-foreground mt-0.5 ${f.num ? HR_NUM : ""}`}>{f.value || "—"}</p>
          </div>
        ))}
        <div className="px-3 py-2">
          <p className={HR_LBL}>Due Date</p>
          {edit ? (
            <DateInput
              value={dueDate}
              onChange={(e) => edit.onDueDateChange(e.target.value)}
              className={`w-full mt-0.5 text-xs font-semibold bg-transparent border-none p-0 text-foreground focus:outline-none ${HR_NUM}`}
            />
          ) : (
            <p className={`text-xs font-semibold text-foreground mt-0.5 ${HR_NUM}`}>{dueDate || "—"}</p>
          )}
        </div>
      </div>

      {/* Name */}
      <div className="px-3 py-2 border-b border-foreground/20">
        <p className={HR_LBL}>Name</p>
        <p className="text-sm font-semibold text-foreground mt-0.5">{customerName || "—"}</p>
      </div>

      {/* Sr.No / Description / Amount */}
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className={`${TH} w-10`}>Sr.</th>
            <th className={TH}>Description</th>
            <th className={`${TH} w-28 text-right`}>Amount</th>
            {edit && <th className={`${TH} w-8`} />}
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
            <tr key={l.chargeHeadId} className="border-b border-foreground/10">
              <td className={`px-3 py-1.5 text-muted-foreground ${HR_NUM}`}>{i + 1}</td>
              <td className="px-3 py-1.5 text-foreground">{l.description}</td>
              <td className={`px-3 py-1.5 text-right ${HR_NUM}`}>{fmt(l.amount)}</td>
              {edit && (
                <td className="px-1 py-1 text-center">
                  <button onClick={() => edit.onRemoveChargeHead(l.chargeHeadId)} title="Remove" className={ICON_ACT_RED}>
                    <Trash2 size={12} />
                  </button>
                </td>
              )}
            </tr>
          ))}
          {edit && (
            <tr>
              <td className="px-3 py-1.5" />
              <td className="px-3 py-1.5" colSpan={edit ? 3 : 2}>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) edit.onAddChargeHead(Number(e.target.value));
                  }}
                  className={`${HR_FIELD} h-8 border-dashed text-xs text-muted-foreground`}
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
          <tr className="border-t border-foreground bg-foreground/5">
            <td colSpan={2} className="px-3 py-2 text-right font-heading font-bold uppercase tracking-[0.1em] text-[0.6875rem] text-foreground">Total Payable</td>
            <td className={`px-3 py-2 text-right font-bold text-foreground ${HR_NUM}`}>{fmt(totalPayable)}</td>
            {edit && <td />}
          </tr>
        </tfoot>
      </table>

      {/* Amount in words */}
      <div className="px-3 py-2 border-t border-foreground/20 text-xs">
        <span className="text-muted-foreground">Amount In Words: </span>
        <span className="font-medium text-foreground">{numberToWordsIndian(totalPayable)}</span>
      </div>

      {status === "Cancelled" && (
        <div className="px-3 py-2 border-t border-foreground/20 bg-destructive/10 text-xs text-destructive">
          Cancelled{cancelReason ? ` — ${cancelReason}` : ""}
        </div>
      )}

      {/* Notes */}
      <div className="px-3 py-2.5 border-t border-foreground/20">
        <p className={`${HR_LBL} mb-1`}>Notes</p>
        {edit ? (
          <textarea
            value={notes}
            onChange={(e) => edit.onNotesChange(e.target.value)}
            rows={3}
            placeholder="e.g. Cheque should be drawn in favour of the society only. Interest @ 18% p.a. will be charged for delayed payments."
            className={`${HR_FIELD} h-auto py-1.5 text-xs resize-none`}
          />
        ) : notes ? (
          <p className="text-xs text-foreground whitespace-pre-line">{notes}</p>
        ) : (
          <p className="text-xs text-muted-foreground">—</p>
        )}
      </div>

      {/* Signature footer */}
      <div className="px-3 py-4 border-t border-foreground/20 text-right">
        <p className="text-sm font-heading font-bold text-foreground">For {companyName}</p>
        <p className="text-[0.625rem] text-muted-foreground mt-6">Secretary / Chairman / Treasurer</p>
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
        className={`${SHEET_DIALOG} max-w-3xl max-h-[88vh] overflow-hidden p-0 gap-0 flex flex-col`}
        style={{ margin: 0 }}
      >
        <div className="shrink-0 border-b border-foreground pl-6 pr-12 py-4 bg-card">
          <DialogTitle className={HR_HEAD}>
            {isEdit ? "Edit Bill" : "Create Maintenance Bill"}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {isEdit ? "Update the applied charge heads" : "Pick a customer and the charges that apply"}
          </p>
        </div>

        {isEdit && loadingExisting ? (
          <div className="skel m-6" style={{ height: 240 }} />
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {!isEdit && (
              <div>
                <label className={`block mb-1.5 ${HR_LBL}`}>
                  Customer / Flat
                </label>
                <SearchableNativeSelect
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  className={`${HR_FIELD} appearance-none`}
                >
                  <option value="">Select customer…</option>
                  {directoryRows.map((c) => (
                    <option key={c.Id} value={c.Id}>
                      {c.CustomerName} — {[c.BlockName, c.UnitNo].filter(Boolean).join(" / ")} ({c.BookingNo})
                    </option>
                  ))}
                </SearchableNativeSelect>
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

        <div className="shrink-0 border-t border-foreground/20 px-6 py-3.5 flex justify-end gap-2 bg-card">
          <button
            onClick={onClose}
            className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || (isEdit && loadingExisting)}
            className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}
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
    <div className="fixed inset-0 z-[70] flex items-stretch sm:items-center justify-center bg-black/70 p-0 sm:p-4">
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
        className="mb-print-modal bg-card border border-foreground w-full max-w-xl h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[88vh] overflow-y-auto"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-foreground bg-card">
          <div>
            <h2 className={`${HR_HEAD} ${HR_NUM}`}>{bill?.BillNo || "Bill"}</h2>
            <p className={`${HR_LBL} mt-1`}>Maintenance Bill</p>
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
                className={`${KEY_LINE} h-8 px-3`}
              >
                <Printer size={12} /> Print
              </button>
            )}
            <button onClick={onClose} title="Close" className={ICON_ACT}>
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {isLoading || !bill ? (
            <div className="skel" style={{ height: 320 }} />
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
