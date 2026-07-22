import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, ChevronRight, MoreHorizontal, CheckCircle2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { CrmBookingDetail } from "./CrmBookingDetail";
import { useAuth } from "@/contexts/AuthContext";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API     = "/api/crm/bookings";
const SA_LEADS_API = "/api/sa/leads";
const UNIT_API = "/api/unit-master";

const STATUSES    = ["Pending", "Approved", "Rejected", "Cancelled"];

const statusColor: Record<string, string> = {
  Pending:   "text-orange-600 bg-orange-50 border-orange-200",
  Approved:  "text-green-600 bg-green-50 border-green-200",
  Rejected:  "text-red-600 bg-red-50 border-red-200",
  Cancelled: "text-muted-foreground bg-muted/50 border-border",
};

async function fetchUnits(): Promise<any[]> {
  try { const r = await fetchWithAuth(`${UNIT_API}?isActive=1`); return r.ok ? r.json() : []; } catch { return []; }
}

// This management page still needs to see and filter to Cancelled/Rejected
// bookings for record-keeping (its own Status filter includes them) — every
// other page's booking-selector dropdown deliberately gets the narrower
// default (see crmBookings.js GET /), so only this one opts back in.
async function fetchBookings(applicationId?: string): Promise<any[]> {
  try {
    const params = new URLSearchParams({ includeCancelled: "1" });
    if (applicationId) params.set("applicationId", applicationId);
    const res = await fetchWithAuth(`${API}?${params}`);
    if (!res.ok) return [];
    return res.json();
  } catch { return []; }
}
async function fetchUsers(): Promise<{ value: string; label: string }[]> {
  try {
    const res = await fetchWithAuth(`${SA_LEADS_API}/users`);
    if (!res.ok) return [];
    const d: any[] = await res.json();
    return d.map((u) => ({ value: String(u.Id), label: u.Name }));
  } catch { return []; }
}

const fmt = (n: number | null | undefined) =>
  n != null ? `₹${(n / 1e5).toFixed(2)}L` : "—";

// The real workflow gate: Welcome Call -> Bank Details -> Agreement (both
// approvals) -> Payments. Only ever surface the ONE step the booking is
// actually sitting at right now — never let staff jump ahead to a later
// step a record hasn't reached yet.
type NextStep = { label: string; color: string; path: string } | null;
function getNextStep(b: any): NextStep {
  if (b.Status !== "Approved") return null; // Pending/Rejected/Cancelled have no forward step
  if (!b.HasWelcomeCall) return { label: "Welcome Call", color: "text-sky-600 border-sky-200 bg-sky-50", path: `/crm/welcome-calls?bookingId=${b.Id}` };
  if (!b.BankDetailsComplete) return { label: "Bank Details", color: "text-amber-600 border-amber-200 bg-amber-50", path: `/crm/customer-bank-details?bookingId=${b.Id}` };
  if (!b.AgreementId || b.SeniorApprovalStatus !== "Approved" || b.CustomerApprovalStatus !== "Approved") {
    return { label: "Agreement", color: "text-purple-600 border-purple-200 bg-purple-50", path: `/crm/agreements?bookingId=${b.Id}` };
  }
  if (b.PendingMilestoneCount > 0) return { label: "Payments", color: "text-primary border-primary/20 bg-primary/5", path: `/crm/payments?bookingId=${b.Id}` };
  return null; // every gated step is complete
}

const CrmBooking: React.FC = () => {
  const qc = useQueryClient();
  const { canDoAction } = useAuth();
  // Bookings only ever auto-create on Application approval — there is no
  // manual/direct creation path. canEdit still gates the other mutating
  // actions on this review page (see CrmBookingDetail.tsx).
  const canEdit = canDoAction("crm-bookings", "edit");
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const appFilter = sp.get("applicationId") || "";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [viewingBookingId, setViewingBookingId] = useState<number | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["crm-bookings", appFilter],
    queryFn: () => fetchBookings(appFilter || undefined),
    staleTime: 60_000,
  });

  // Deep-link support: /crm/bookings?applicationId=X (from "View Booking"
  // elsewhere in the app) opens that booking's detail modal directly in
  // this same tab/page instead of leaving staff to find and click the one
  // filtered row themselves. deepLinkOpened is a one-shot guard — without
  // it, closing the modal would immediately reopen it, since the URL still
  // carries applicationId (same class of bug already fixed on the Bank &
  // Nominee page's own deep link).
  React.useEffect(() => {
    if (!appFilter || deepLinkOpened) return;
    const row = (bookings as any[]).find((b: any) => String(b.ApplicationId) === appFilter);
    if (row) { setViewingBookingId(row.Id); setDeepLinkOpened(true); }
  }, [appFilter, bookings, deepLinkOpened]);

  const { data: users = [] } = useQuery({ queryKey: ["sa-users"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: units = [] } = useQuery({ queryKey: ["unit-master"], queryFn: fetchUnits, staleTime: 5 * 60_000 });

  const filtered = useMemo(() => {
    return (bookings as any[]).filter((b: any) => {
      const s = !search || b.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || b.BookingNo?.includes(search) || b.UnitNo?.includes(search);
      const st = statusFilter === "All" || b.Status === statusFilter;
      return s && st;
    });
  }, [bookings, search, statusFilter]);

  // Unit change is a rare, authorized-only action (admin/super_admin/
  // marketing_head, enforced server-side) — a lightweight prompt flow
  // matches the other one-off actions on this page rather than a full
  // dialog for something this infrequent.
  const handleChangeUnit = async (b: any) => {
    const options = (units as any[])
      .filter((u: any) => u.IsActive && u.Id !== b.UnitId)
      .map((u: any) => `${u.Id}: ${u.ProjectName} — ${u.BlockName} — ${u.UnitName}`)
      .join("\n");
    const newUnitId = window.prompt(`Enter the new Unit ID for ${b.BookingNo}:\n\n${options}`);
    if (!newUnitId) return;
    const reason = window.prompt("Reason for changing the unit (required):");
    if (!reason?.trim()) { toast.error("Reason is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${b.Id}/change-unit`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ NewUnitId: parseInt(newUnitId), Reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Unit changed to ${data.unitNo}`);
      qc.invalidateQueries({ queryKey: ["crm-bookings"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const bookingColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking No", size: 110,
      cell: (i) => (
        <button onClick={() => setViewingBookingId(i.row.original.Id)} className="font-mono text-xs font-semibold text-primary hover:underline">
          {i.row.original.BookingNo}
        </button>
      ) },
    { accessorKey: "ApplicantName", header: "Customer", size: 140,
      cell: (i) => (
        <div>
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.Mobile}</div>
        </div>
      ) },
    { id: "projectUnit", header: "Project / Unit", size: 150, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        return (
          <div>
            <div>{b.ProjectName || "—"}</div>
            <div className="text-xs text-muted-foreground">{[b.UnitNo, b.BlockName, b.FloorName].filter(Boolean).join(" / ")}</div>
            {b.CompanyName && <div className="text-xs text-muted-foreground">{b.CompanyName}</div>}
          </div>
        );
      } },
    { accessorKey: "AreaSqFt", header: "Area", size: 90,
      cell: (i) => <span className="text-sm">{i.row.original.AreaSqFt ? `${i.row.original.AreaSqFt} sqft` : "—"}</span> },
    { id: "value", header: "Value", size: 130, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        return (
          <div>
            <div className="font-semibold">{fmt(b.GrandTotal ?? b.TotalValue)}</div>
            {(b.ParkingTotal > 0 || b.ExtraChargesTotal > 0) && (
              <div className="text-[10px] text-muted-foreground">
                Unit {fmt(b.TotalValue)}
                {b.ParkingTotal > 0 && ` + Parking ${fmt(b.ParkingTotal)}`}
                {b.ExtraChargesTotal > 0 && ` + Extra ${fmt(b.ExtraChargesTotal)}`}
              </div>
            )}
          </div>
        );
      } },
    { accessorKey: "BookingAmount", header: "Booking Amt", size: 100, cell: (i) => <span>{fmt(i.row.original.BookingAmount)}</span> },
    { accessorKey: "Status", header: "Status", size: 100,
      cell: (i) => <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${statusColor[i.row.original.Status] || ""}`}>{i.row.original.Status}</span> },
    { accessorKey: "BookingDate", header: "Date", size: 100,
      cell: (i) => <span className="text-xs text-muted-foreground">{i.row.original.BookingDate ? String(i.row.original.BookingDate).slice(0, 10) : "—"}</span> },
    { id: "actions", header: "Actions", size: 220, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        const step = getNextStep(b);
        return (
          <div className="flex items-center gap-2 flex-wrap">
            {/* submitOnly: Approve/Reject only ever happen from the
                Admin Approval Inbox (admin/super_admin/marketing_head) */}
            <ApprovalActions
              status={b.Status}
              recordId={b.Id}
              endpoint={API}
              submitOnly
              onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-bookings"] })}
            />
            {b.Status === "Pending" && (
              b.UnitReviewConfirmed && b.PlanReviewConfirmed ? (
                <span className="text-xs text-muted-foreground">Pending admin approval</span>
              ) : (
                <button onClick={() => setViewingBookingId(b.Id)}
                  className="text-xs px-2 py-1 rounded-md border text-amber-600 border-amber-200 bg-amber-50 font-medium flex items-center gap-1">
                  Review Checklist Incomplete <ChevronRight size={12} />
                </button>
              )
            )}
            {step ? (
              <button onClick={() => navigate(step.path)}
                className={`text-xs px-2 py-1 rounded-md border font-medium flex items-center gap-1 ${step.color}`}>
                {step.label} <ChevronRight size={12} />
              </button>
            ) : b.Status === "Approved" ? (
              <span className="text-xs px-2 py-1 rounded-md border text-emerald-600 border-emerald-200 bg-emerald-50 font-medium flex items-center gap-1">
                <CheckCircle2 size={12} /> All Steps Complete
              </span>
            ) : null}
            {/* Non-sequential utility actions — not part of the linear
                flow, so they live in an overflow menu instead of competing
                with the one active step. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded-md hover:bg-muted text-muted-foreground" title="More actions">
                  <MoreHorizontal size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setViewingBookingId(b.Id)}>View Details / Invoice / Attachments</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/crm/welcome-calls?bookingId=${b.Id}`)}>Welcome Call</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/crm/communication?bookingId=${b.Id}`)}>Communication</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/crm/customer-bank-details?bookingId=${b.Id}`)}>Bank Details</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/crm/agreements?bookingId=${b.Id}`)}>Agreement</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/crm/payments?bookingId=${b.Id}`)}>Payments</DropdownMenuItem>
                {b.Status !== "Cancelled" && canEdit && (
                  <DropdownMenuItem onClick={() => handleChangeUnit(b)} className="text-rose-600 focus:text-rose-600">
                    Change Unit
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      } },
  ];

  return (
    <SalesAutoShell
      title="CRM — Applications and Bookings"
      subtitle="Bookings auto-create on Application approval but stay Pending until staff confirm the review checklist and an admin approves"
    >
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, booking no, unit..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-border rounded-lg bg-background">
          <option value="All">All Statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <DataTable
        data={filtered}
        columns={bookingColumns}
        searchable={false}
        loading={isLoading}
        emptyMessage="No bookings found"
        className="rounded-xl border border-border overflow-hidden bg-card"
      />

      {viewingBookingId && (
        <CrmBookingDetail bookingId={viewingBookingId} onClose={() => setViewingBookingId(null)} />
      )}
    </SalesAutoShell>
  );
};

export default CrmBooking;
