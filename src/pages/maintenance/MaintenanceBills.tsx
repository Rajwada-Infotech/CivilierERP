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
  UserCircle2,
  ListChecks,
  CheckCircle2,
  Circle,
  Calculator,
} from "lucide-react";
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
    }
  }, [existingBill]);

  const directoryRows = Array.isArray(directory) ? directory : [];
  const chargeHeadRows: ChargeHeadRow[] = chargeHeads || [];

  const toggleChargeHead = (id: number) => {
    setSelectedChargeHeadIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectedRows = chargeHeadRows.filter((ch) => selectedChargeHeadIds.includes(ch.Id));
  const subtotal = selectedRows.reduce((s, ch) => s + (Number(ch.Rate) || 0), 0);
  const totalTax = selectedRows.reduce((s, ch) => s + ((Number(ch.Rate) || 0) * (Number(ch.TaxPct) || 0)) / 100, 0);
  const grandTotal = subtotal + totalTax;

  const handleSave = async () => {
    if (!isEdit && !bookingId) {
      toast.error("Select a customer");
      return;
    }
    if (selectedChargeHeadIds.length === 0) {
      toast.error("Select at least one Charge Head");
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateMaintenanceBill(billId!, selectedChargeHeadIds);
        toast.success("Bill updated");
      } else {
        await createMaintenanceBill(Number(bookingId), selectedChargeHeadIds);
        toast.success("Bill created");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save bill");
    } finally {
      setSaving(false);
    }
  };

  const selectedCustomer = isEdit
    ? existingBill
    : directoryRows.find((c) => String(c.Id) === bookingId);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[88vh] overflow-y-auto p-0 gap-0">
        <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4 flex items-center gap-3">
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
          <div className="px-6 py-5 space-y-5">
            {/* ── Customer ─────────────────────────────────────────────── */}
            <FormSection icon={UserCircle2} label="Customer / Flat" accentColor={ACCENT}>
              {isEdit ? (
                <div className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border bg-muted/20">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-heading font-bold text-xs"
                    style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}30`, color: ACCENT }}
                  >
                    {(existingBill?.CustomerName || "?").trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{existingBill?.CustomerName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[existingBill?.BlockName, existingBill?.UnitNo].filter(Boolean).join(" / ") || "Unit not set"} · {existingBill?.BookingNo}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <select
                    value={bookingId}
                    onChange={(e) => setBookingId(e.target.value)}
                    className="w-full appearance-none px-3.5 py-2.5 rounded-xl text-sm font-body bg-muted/40 border border-border focus:outline-none focus:ring-2 text-foreground"
                    style={{ "--tw-ring-color": ACCENT } as React.CSSProperties}
                  >
                    <option value="">Select customer…</option>
                    {directoryRows.map((c) => (
                      <option key={c.Id} value={c.Id}>
                        {c.CustomerName} — {[c.BlockName, c.UnitNo].filter(Boolean).join(" / ")} ({c.BookingNo})
                      </option>
                    ))}
                  </select>
                  {selectedCustomer && (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      {selectedCustomer.ContactNumber ? `Contact: ${selectedCustomer.ContactNumber}` : ""}
                    </p>
                  )}
                </div>
              )}
            </FormSection>

            {/* ── Charge heads ─────────────────────────────────────────── */}
            <FormSection icon={ListChecks} label="Charge Heads" accentColor={ACCENT}>
              {chargeHeadRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border py-6 flex flex-col items-center gap-1.5 text-center px-6">
                  <ListChecks size={18} className="text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">No active Charge Heads — add one in Setup → Charge Head.</p>
                </div>
              ) : (
                <div className="rounded-xl border border-border divide-y divide-border max-h-52 overflow-y-auto">
                  {chargeHeadRows.map((ch) => {
                    const checked = selectedChargeHeadIds.includes(ch.Id);
                    return (
                      <label
                        key={ch.Id}
                        className={`flex items-center gap-3 px-3.5 py-2.5 text-sm cursor-pointer transition-colors ${checked ? "bg-muted/30" : "hover:bg-muted/15"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleChargeHead(ch.Id)}
                          className="sr-only"
                        />
                        {checked ? (
                          <CheckCircle2 size={17} style={{ color: ACCENT }} className="shrink-0" />
                        ) : (
                          <Circle size={17} className="text-muted-foreground/40 shrink-0" />
                        )}
                        <span className={`flex-1 ${checked ? "font-medium text-foreground" : "text-foreground/90"}`}>{ch.Name}</span>
                        <span className="text-xs text-muted-foreground font-mono tabular-nums">
                          {fmt(ch.Rate)} + {ch.TaxPct || 0}%
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </FormSection>

            {/* ── Bill summary ─────────────────────────────────────────── */}
            {selectedRows.length > 0 && (
              <FormSection icon={Calculator} label="Bill Summary" accentColor={ACCENT}>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 uppercase tracking-widest text-muted-foreground font-heading">
                      <tr>
                        <th className="text-left px-3.5 py-2">Charge Head</th>
                        <th className="text-right px-3.5 py-2">Rate</th>
                        <th className="text-right px-3.5 py-2">Tax</th>
                        <th className="text-right px-3.5 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {selectedRows.map((ch) => {
                        const rate = Number(ch.Rate) || 0;
                        const taxAmt = (rate * (Number(ch.TaxPct) || 0)) / 100;
                        return (
                          <tr key={ch.Id}>
                            <td className="px-3.5 py-1.5">{ch.Name}</td>
                            <td className="px-3.5 py-1.5 text-right font-mono">{fmt(rate)}</td>
                            <td className="px-3.5 py-1.5 text-right font-mono">{fmt(taxAmt)}</td>
                            <td className="px-3.5 py-1.5 text-right font-mono font-medium">{fmt(rate + taxAmt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="border-t border-border px-3.5 py-3 space-y-1.5" style={{ background: `${ACCENT}08` }}>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Subtotal</span>
                      <span className="font-mono">{fmt(subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Total Tax</span>
                      <span className="font-mono">{fmt(totalTax)}</span>
                    </div>
                    <div className="flex justify-between text-sm font-heading font-bold text-foreground pt-1 border-t border-border/60">
                      <span>Bill Total</span>
                      <span className="font-mono tabular-nums">{fmt(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </FormSection>
            )}
          </div>
        )}

        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3.5 flex justify-end gap-2">
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

function FormSection({
  icon: Icon,
  label,
  accentColor,
  children,
}: {
  icon: typeof UserCircle2;
  label: string;
  accentColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `${accentColor}18`, border: `1px solid ${accentColor}30` }}
        >
          <Icon size={11} style={{ color: accentColor }} />
        </div>
        <span className="text-[10px] font-heading font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <div className="flex-1 h-px bg-gradient-to-r from-border to-transparent" />
      </div>
      {children}
    </div>
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
        }
      `}</style>
      <div className="mb-print-modal bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] sm:max-h-[88vh] overflow-y-auto">
        <div className="sticky top-0 bg-card z-10 flex items-center justify-between px-6 py-4 border-b border-border">
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

        <div className="p-5 sm:p-6 space-y-5">
          {isLoading || !bill ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Bill No", value: bill.BillNo, mono: true },
                  { label: "Bill Date", value: fmtDate(bill.BillDate) },
                  { label: "Customer", value: bill.CustomerName || "—" },
                  { label: "Flat/Unit", value: [bill.BlockName, bill.UnitNo].filter(Boolean).join(" / ") || "—" },
                  { label: "Booking No", value: bill.BookingNo, mono: true },
                  { label: "Status", value: bill.Status },
                ].map(({ label, value, mono }) => (
                  <div key={label} className="px-3 py-2.5 rounded-xl bg-muted/30 border border-border/50">
                    <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
                    <p className={`text-xs font-semibold ${mono ? "font-mono" : ""} text-foreground`}>{value}</p>
                  </div>
                ))}
              </div>

              {bill.Status === "Cancelled" && bill.CancelReason && (
                <div className="px-3 py-2.5 rounded-xl bg-destructive/5 border border-destructive/20 text-xs text-destructive">
                  Cancelled — {bill.CancelReason}
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-widest font-heading text-muted-foreground mb-2">Charge Breakdown</p>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 uppercase tracking-widest text-muted-foreground font-heading">
                      <tr>
                        <th className="text-left px-3 py-2">Charge Head</th>
                        <th className="text-right px-3 py-2">Rate</th>
                        <th className="text-right px-3 py-2">Tax %</th>
                        <th className="text-right px-3 py-2">Tax Amt</th>
                        <th className="text-right px-3 py-2">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {bill.items.map((it) => (
                        <tr key={it.Id}>
                          <td className="px-3 py-1.5">
                            {it.ChargeHeadName}
                            {it.HsnCode && <span className="text-muted-foreground ml-1">({it.HsnCode})</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(it.Rate)}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{it.TaxPct}%</td>
                          <td className="px-3 py-1.5 text-right font-mono">{fmt(it.TaxAmount)}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-medium">{fmt(it.TotalAmount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/20">
                      <tr>
                        <td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">Subtotal</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmt(bill.Subtotal)}</td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">Total Tax</td>
                        <td className="px-3 py-1.5 text-right font-mono">{fmt(bill.TotalTax)}</td>
                      </tr>
                      <tr>
                        <td colSpan={4} className="px-3 py-1.5 text-right font-heading font-bold text-foreground">Bill Total</td>
                        <td className="px-3 py-1.5 text-right font-mono font-bold text-foreground">{fmt(bill.GrandTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
