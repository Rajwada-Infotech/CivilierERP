import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  UserCircle2,
  Phone,
  Mail,
  Home,
  Building2,
  ArrowLeft,
  History,
  Wallet,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlassSection } from "@/components/dashboard/GlassShell";
import { MaintenanceShell, MAINTENANCE_ACCENT as ACCENT } from "@/components/maintenance/MaintenanceShell";
import {
  getMaintenanceCustomer,
  getMaintenancePayments,
} from "@/api/maintenanceApi";

export default function CustomerMaintenanceProfile() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate = useNavigate();

  const { data: customer, isLoading: customerLoading, error: customerError } = useQuery({
    queryKey: ["maintenance-customer", bookingId],
    queryFn: () => getMaintenanceCustomer(bookingId!),
    enabled: !!bookingId,
  });

  const { data: payments } = useQuery({
    queryKey: ["maintenance-payments", bookingId],
    queryFn: () => getMaintenancePayments(bookingId!),
    enabled: !!bookingId,
  });

  const paymentRows = Array.isArray(payments) ? payments : [];

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
