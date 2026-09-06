import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UserCircle2,
  Phone,
  Mail,
  Home,
  Building2,
  ArrowLeft,
  Plus,
  Trash2,
  Receipt,
  History,
  Wallet,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlassSection } from "@/components/dashboard/GlassShell";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import { usePageRights } from "@/hooks/usePageRights";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getMaintenanceCustomer,
  getMaintenanceCharges,
  getMaintenancePayments,
  addMaintenanceCharge,
  removeMaintenanceCharge,
} from "@/api/maintenanceApi";
import { getActiveChargeHeads } from "@/api/chargeHeadApi";

const fmt = (n: number | null | undefined) =>
  `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CustomerMaintenanceProfile() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const chargeRights = usePageRights("maintenance-customer-charges");
  const [addOpen, setAddOpen] = useState(false);
  const [selectedChargeHeadId, setSelectedChargeHeadId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: customer, isLoading: customerLoading, error: customerError } = useQuery({
    queryKey: ["maintenance-customer", bookingId],
    queryFn: () => getMaintenanceCustomer(bookingId!),
    enabled: !!bookingId,
  });

  const { data: charges, isLoading: chargesLoading } = useQuery({
    queryKey: ["maintenance-charges", bookingId],
    queryFn: () => getMaintenanceCharges(bookingId!),
    enabled: !!bookingId,
  });

  const { data: payments } = useQuery({
    queryKey: ["maintenance-payments", bookingId],
    queryFn: () => getMaintenancePayments(bookingId!),
    enabled: !!bookingId,
  });

  const { data: chargeHeads } = useQuery({
    queryKey: ["charge-heads", "active"],
    queryFn: getActiveChargeHeads,
    enabled: addOpen,
  });

  const chargeRows = Array.isArray(charges) ? charges : [];
  const paymentRows = Array.isArray(payments) ? payments : [];
  const availableChargeHeads = (chargeHeads || []).filter(
    (ch) => !chargeRows.some((c) => c.ChargeHeadId === ch.Id),
  );
  const totalMonthly = chargeRows.reduce((sum, c) => sum + (Number(c.TotalAmount) || 0), 0);

  const handleAddCharge = async () => {
    if (!bookingId || !selectedChargeHeadId) return;
    setSaving(true);
    try {
      await addMaintenanceCharge(bookingId, Number(selectedChargeHeadId));
      toast.success("Charge added");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-charges", bookingId] });
      setAddOpen(false);
      setSelectedChargeHeadId("");
    } catch (err: any) {
      toast.error(err?.message || "Failed to add charge");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCharge = async (chargeId: number) => {
    if (!bookingId) return;
    try {
      await removeMaintenanceCharge(bookingId, chargeId);
      toast.success("Charge removed");
      await queryClient.invalidateQueries({ queryKey: ["maintenance-charges", bookingId] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to remove charge");
    }
  };

  if (customerLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  if (customerError || !customer)
    return <div className="p-6 text-red-500">Confirmed booking not found.</div>;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Customer Directory", customer.CustomerName || "Profile"]} />
      <MaintenanceShell
        title={customer.CustomerName || "Customer"}
        subtitle={`${customer.BookingNo} — ${[customer.BlockName, customer.UnitNo].filter(Boolean).join(" / ") || "Unit not set"}`}
        icon={UserCircle2}
        action={
          <button
            onClick={() => navigate("/maintenance/directory")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <ArrowLeft size={13} /> Directory
          </button>
        }
      >
        {/* ── Customer info card ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-border bg-muted/10 px-4 py-3.5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <InfoField icon={Phone} label="Contact" value={customer.ContactNumber || "—"} />
          <InfoField icon={Mail} label="Email" value={customer.Email || "—"} />
          <InfoField icon={Home} label="Unit" value={[customer.BlockName, customer.UnitNo].filter(Boolean).join(" / ") || "—"} />
          <InfoField icon={Building2} label="Project" value={customer.ProjectName || "—"} />
        </div>

        {/* ── Maintenance charges ────────────────────────────────────────── */}
        <GlassSection
          title="Maintenance Charges"
          icon={Receipt}
          accentColor={ACCENT}
          action={
            chargeRights.canCreate && (
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-maintenance text-white transition-all"
              >
                <Plus size={13} /> Add Charge
              </button>
            )
          }
        >
          {chargesLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!chargesLoading && chargeRows.length === 0 && (
            <div className="rounded-xl border border-dashed border-border py-8 flex flex-col items-center gap-2 text-center px-6">
              <Receipt size={18} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No maintenance charges applied yet.</p>
            </div>
          )}
          {chargeRows.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground font-heading">
                  <tr>
                    <th className="text-left px-4 py-2.5">Charge Head</th>
                    <th className="text-right px-4 py-2.5">Base</th>
                    <th className="text-right px-4 py-2.5">Tax %</th>
                    <th className="text-right px-4 py-2.5">Tax Amt</th>
                    <th className="text-right px-4 py-2.5">Total</th>
                    {chargeRights.canDelete && <th className="w-10" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {chargeRows.map((c) => (
                    <tr key={c.Id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium text-foreground">{c.ChargeHeadName}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{fmt(c.BaseAmount)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{Number(c.TaxPct) || 0}%</td>
                      <td className="px-4 py-2.5 text-right font-mono">{fmt(c.TaxAmount)}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground">{fmt(c.TotalAmount)}</td>
                      {chargeRights.canDelete && (
                        <td className="px-2 py-2.5 text-right">
                          <button
                            onClick={() => handleRemoveCharge(c.Id)}
                            title="Remove charge"
                            className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-muted/20">
                    <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-heading font-bold uppercase tracking-wider text-muted-foreground">
                      Total per cycle
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-foreground">{fmt(totalMonthly)}</td>
                    {chargeRights.canDelete && <td />}
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </GlassSection>

        {/* ── Payment history ────────────────────────────────────────────── */}
        <GlassSection title="Payment History" icon={History} accentColor={ACCENT}>
          {paymentRows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border py-8 flex flex-col items-center gap-2 text-center px-6">
              <Wallet size={18} className="text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No maintenance payments recorded yet.</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Payment collection for maintenance charges isn't wired up yet — this section is ready for it.
              </p>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{paymentRows.length} payment(s) on file.</div>
          )}
        </GlassSection>
      </MaintenanceShell>

      {/* ── Add Charge modal ───────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading text-base">Add Maintenance Charge</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div>
              <label className="block text-[11px] uppercase tracking-widest font-heading text-muted-foreground mb-1.5">
                Charge Head
              </label>
              <select
                value={selectedChargeHeadId}
                onChange={(e) => setSelectedChargeHeadId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm font-body bg-muted border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
              >
                <option value="">Select…</option>
                {availableChargeHeads.map((ch) => (
                  <option key={ch.Id} value={ch.Id}>
                    {ch.Name} — {fmt(ch.Rate)} ({ch.TaxPct || 0}% tax)
                  </option>
                ))}
              </select>
              {availableChargeHeads.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  All active Charge Heads are already applied to this customer.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <button
                onClick={() => setAddOpen(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCharge}
                disabled={!selectedChargeHeadId || saving}
                className="px-3 py-1.5 rounded-lg text-xs font-heading font-semibold gradient-accent text-primary-foreground hover:shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {saving ? "Adding…" : "Add Charge"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InfoField({ icon: Icon, label, value }: { icon: typeof Phone; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-heading font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        <Icon size={11} /> {label}
      </p>
      <p className="text-sm font-medium text-foreground truncate" title={value}>
        {value}
      </p>
    </div>
  );
}
