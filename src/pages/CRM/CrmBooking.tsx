// CRM Bookings: every booking with what it is waiting on next. Bookings mostly create themselves when an Application
// is approved; New Booking is the manual fallback. The booking itself opens in CrmBookingDetail (?view=<id>).
import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ChevronRight, FileSignature, IndianRupee, Landmark, Lock, MoreHorizontal, Phone, Plus, RefreshCw, Repeat, Trash2,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApprovalActions } from "@/components/ApprovalActions";
import { VillaOffersPanel } from "@/components/crm/VillaOffersPanel";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { CrmBookingDetail } from "./CrmBookingDetail";
import {
  API, KEY_INK, KEY_LINE, PAGE_SIZE, RULE, RULE_SOFT, STATUSES, bookingTone, fetchBookings, fetchBookingsList, fmt, getNextStep, normalizeRole,
  workflowStageLabel, type BookingList, type BookingListFilters,
} from "./bookings/config";
import { NewBookingDialog } from "./bookings/NewBookingDialog";
import { ChangeUnitDialog } from "./bookings/ChangeUnitDialog";

const CrmBooking: React.FC = () => {
  const qc = useQueryClient();
  const { canDoAction, currentUser } = useAuth();
  // The server creates a booking under the create right; it was offered under edit, so a user with one but not the
  // other either saw a button that was refused or never saw it.
  const canCreate = canDoAction("crm-bookings", "create");
  const canEdit = canDoAction("crm-bookings", "edit");
  const canRequestCancellation = canDoAction("crm-cancellations", "create");
  const isAdmin = ["admin", "super_admin"].includes(normalizeRole(currentUser?.role));
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const appFilter = sp.get("applicationId") || "";
  const viewFilter = sp.get("view") || "";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [newOpen, setNewOpen] = useState(false);
  const [viewingBookingId, setViewingBookingId] = useState<number | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);
  const [unitChangeBooking, setUnitChangeBooking] = useState<any | null>(null);

  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));

  // The URL carries the open booking (?view=<id>), so a refresh or a shared link reopens it.
  const openBooking = (id: number) => {
    setViewingBookingId(id);
    navigate(`/crm/bookings?view=${id}`, { replace: true });
  };

  const listFilters: BookingListFilters = useMemo(
    () => ({ search, status: statusFilter, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, statusFilter, cpb],
  );

  // ?applicationId= fetches "the booking(s) for this one application", not a page of the list.
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery<BookingList>({
    queryKey: ["crm-bookings", appFilter, listFilters, page, pageSize],
    queryFn: async () => {
      if (appFilter) { const rows = await fetchBookings(appFilter); return { rows, total: rows.length, statusCounts: {}, frozen: 0 }; }
      return fetchBookingsList(listFilters, page, pageSize);
    },
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
  const bookings = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;
  const counts = listResult?.statusCounts ?? {};

  // Deep links: ?view=<id> opens that booking; ?applicationId=X opens the booking made from that application. The
  // one-shot guard stops closing the card from reopening it while the URL still carries the param.
  useEffect(() => {
    if (viewFilter && !deepLinkOpened) {
      const viewId = parseInt(viewFilter, 10);
      // 0 is a real booking Id (the identity was reseeded to 0 once, see migration 441).
      if (Number.isInteger(viewId) && viewId >= 0) setViewingBookingId(viewId);
      else navigate("/crm/bookings", { replace: true });
      setDeepLinkOpened(true);
      return;
    }
    if (!appFilter || deepLinkOpened || isLoading) return;
    const row = (bookings as any[]).find((b: any) => String(b.ApplicationId) === appFilter);
    if (row) setViewingBookingId(row.Id);
    // No booking yet for that application: offer to make one, filled in from it.
    else if (canCreate) setNewOpen(true);
    setDeepLinkOpened(true);
  }, [appFilter, viewFilter, bookings, deepLinkOpened, isLoading, canCreate, navigate]);

  const canDeleteBooking = (b: any) =>
    isAdmin
    && b.Status !== CrmStatus.APPROVED
    && b.WorkflowStage === "Review"
    && !b.ReadyForApprovalAt
    && !b.AgreementId
    && Number(b.TotalCleared || 0) <= 0
    && Number(b.MRReceivedTotal || 0) <= 0
    && Number(b.ApprovedOnAccount || 0) <= 0;

  const handleDeleteBooking = async (b: any) => {
    if (!window.confirm(`Delete booking ${b.BookingNo}? Only allowed before approval or any progress; the application returns to the pre-booking list.`)) return;
    try {
      const res = await fetchWithAuth(`${API}/${b.Id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not delete the booking.");
      toast.success(data.message || "Booking deleted");
      ["crm-bookings", "crm-apps", "unit-master", "unit-matrix"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (viewingBookingId === b.Id) setViewingBookingId(null);
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking", size: 120,
      cell: (i) => <span className="font-heading text-xs font-semibold tabular-nums text-foreground">{i.row.original.BookingNo}</span> },
    { accessorKey: "ApplicantName", header: "Customer", size: 170,
      cell: (i) => (
        <div className="min-w-0">
          <div className="font-medium truncate"><ApplicantNames name={i.row.original.ApplicantName} bookingId={i.row.original.Id} applicationId={i.row.original.ApplicationId} /></div>
          <div className="text-xs text-muted-foreground tabular-nums">{i.row.original.Mobile}</div>
        </div>
      ) },
    { id: "projectUnit", header: "Project / unit", size: 190, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        return (
          <div className="min-w-0">
            <div className="truncate">{b.ProjectName || "—"}</div>
            <div className="text-xs text-muted-foreground truncate">{[b.UnitNo, b.BlockName, b.FloorName].filter(Boolean).join(" / ")}</div>
          </div>
        );
      } },
    { accessorKey: "AreaSqFt", header: "Area", size: 90,
      cell: (i) => <span className="text-xs tabular-nums">{i.row.original.AreaSqFt ? `${i.row.original.AreaSqFt} sq ft` : "—"}</span> },
    { id: "value", header: "Value / received", size: 190, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        const storedGrand = Number(b.GrandTotal ?? 0);
        const grand = storedGrand > 0 ? storedGrand : (Number(b.TotalValue || 0) + Number(b.UnitGstAmount || 0) + Number(b.ParkingTotal || 0) + Number(b.ExtraChargesTotal || 0));
        const cleared = Number(b.TotalCleared ?? 0);
        // ApprovedOnAccount (CrmOnAccountPayment) alone is "held, not yet applied": adding CrmMoneyReceipt double-counted it.
        const onAcc = Number(b.ApprovedOnAccount ?? 0);
        const outstanding = Math.max(0, grand - cleared - onAcc);
        const clearedPct = grand > 0 ? Math.min(100, Math.round((cleared / grand) * 100)) : 0;
        const onAccPct = grand > 0 ? Math.min(100 - clearedPct, Math.round((onAcc / grand) * 100)) : 0;
        return (
          <div className="space-y-1">
            <div className="font-heading font-semibold tabular-nums">{fmt(grand)}</div>
            {grand > 0 && (
              <>
                <div className="h-1.5 w-full flex" style={{ border: RULE_SOFT }} title={`Cleared ${fmt(cleared)} · on account ${fmt(onAcc)} · outstanding ${fmt(outstanding)}`}>
                  <div className="h-full bg-foreground" style={{ width: `${clearedPct}%` }} />
                  <div className="h-full" style={{ width: `${onAccPct}%`, background: "repeating-linear-gradient(135deg, hsl(var(--foreground)) 0, hsl(var(--foreground)) 1px, transparent 1px, transparent 3px)" }} />
                </div>
                <div className="text-[0.625rem] text-muted-foreground tabular-nums">
                  {fmt(cleared)} cleared{onAcc > 0 ? ` · ${fmt(onAcc)} on account` : ""}{outstanding > 0 ? ` · ${fmt(outstanding)} due` : ""}
                </div>
              </>
            )}
          </div>
        );
      } },
    { accessorKey: "BookingAmount", header: "Booking amt", size: 105,
      cell: (i) => <span className="tabular-nums">{fmt(i.row.original.BookingAmount)}</span> },
    { accessorKey: "Status", header: "Status", size: 120,
      cell: (i) => {
        const b = i.row.original;
        return (
          <div className="space-y-1">
            <SheetMark text={b.Status} tone={bookingTone(b.Status)} />
            {b.IsFrozen && <div className="flex items-center gap-1 text-[0.625rem] font-medium text-destructive"><Lock size={10} /> Frozen</div>}
          </div>
        );
      } },
    { accessorKey: "BookingDate", header: "Date", size: 95,
      cell: (i) => <span className="text-xs text-muted-foreground tabular-nums">{i.row.original.BookingDate ? String(i.row.original.BookingDate).slice(0, 10) : "—"}</span> },
    { id: "actions", header: "Next", size: 230, enableSorting: false,
      cell: (i) => {
        const b = i.row.original;
        const step = getNextStep(b);
        // "Jump to" follows the same order as the next step: Welcome Call first, then Payments (the booking amount)
        // and Agreement. It required Bank Details for the Agreement, which is not a gate, so Agreement was hidden
        // while the next step pointed at it.
        const approved = b.Status === CrmStatus.APPROVED;
        const welcomed = approved && !!b.HasWelcomeCall;
        return (
          <div className="flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
            {/* submitOnly: Approve/Reject happen in the Approval Inbox only. */}
            <ApprovalActions status={b.Status} recordId={b.Id} endpoint={API} submitOnly onSuccess={() => qc.invalidateQueries({ queryKey: ["crm-bookings"] })} />
            {b.Status === CrmStatus.PENDING && (
              b.WorkflowStage && b.WorkflowStage !== "Review" ? (
                <span className="text-[0.6875rem] text-muted-foreground">Waiting: {workflowStageLabel[b.WorkflowStage] || "approval"}</span>
              ) : b.ReadyForApprovalAt ? (
                <span className="text-[0.6875rem] text-muted-foreground">Ready for Marketing Head approval</span>
              ) : (
                <button onClick={() => openBooking(b.Id)} className={`${KEY_LINE} h-7 px-2`}>Review checklist <ChevronRight size={11} /></button>
              )
            )}
            {step ? (
              <button onClick={() => navigate(step.path)} className={`${KEY_INK} h-7 px-2`}>{step.label} <ChevronRight size={11} /></button>
            ) : approved ? (
              <SheetMark text="All steps done" tone="done" />
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10" title="More actions">
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 rounded-none">
                <DropdownMenuItem onClick={() => openBooking(b.Id)}>Open booking</DropdownMenuItem>
                {approved && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[0.6875rem] font-medium text-muted-foreground">Jump to</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => navigate(`/crm/welcome-calls?bookingId=${b.Id}`)} className="gap-2"><Phone size={14} /> Welcome call</DropdownMenuItem>
                  </>
                )}
                {welcomed && (
                  <>
                    <DropdownMenuItem onClick={() => navigate(`/crm/payments?bookingId=${b.Id}`)} className="gap-2"><IndianRupee size={14} /> Payments</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/crm/agreements?bookingId=${b.Id}`)} className="gap-2"><FileSignature size={14} /> Agreement</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/crm/customer-bank-details?bookingId=${b.Id}`)} className="gap-2"><Landmark size={14} /> Bank details</DropdownMenuItem>
                  </>
                )}
                {b.Status !== CrmStatus.CANCELLED && b.DeedStatus !== "Registered" && (canRequestCancellation || canEdit) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate(`/crm/cancellations?bookingId=${b.Id}`)} className="gap-2 text-destructive focus:text-destructive">
                      <AlertTriangle size={14} /> Request cancellation
                    </DropdownMenuItem>
                    {canEdit && !b.IsPlotSale && (
                      <DropdownMenuItem onClick={() => setUnitChangeBooking(b)} className="gap-2 text-destructive focus:text-destructive">
                        <Repeat size={14} /> Change unit
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {canDeleteBooking(b) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleDeleteBooking(b)} className="gap-2 text-destructive focus:text-destructive">
                      <Trash2 size={14} /> Delete booking
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      } },
  ];

  usePageRights("crm-bookings");

  const n = (s: string) => counts[s] || 0;
  const all = Object.values(counts).reduce((s, v) => s + v, 0);
  const pick = (s: string) => () => updateFilter(setStatusFilter)(statusFilter === s ? "All" : s);
  const stats = [
    { label: "Bookings", value: all, note: "Under these filters", go: () => updateFilter(setStatusFilter)("All") },
    { label: "Waiting approval", value: n("Pending"), note: "Review, Marketing Head or Director", go: pick("Pending") },
    { label: "Approved", value: n("Approved"), note: `${n("Transferred")} transferred by resale`, go: pick("Approved") },
    { label: "Cancelled / rejected", value: n("Cancelled") + n("Rejected"), note: listResult?.frozen ? `${listResult.frozen} frozen` : "None frozen", go: pick("Cancelled") },
  ];
  const anyFilter = !!(search || statusFilter !== "All" || cpb.companyId || cpb.projectId || cpb.blockId);

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Bookings"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Bookings"
        subtitle="Approved applications become bookings, then move through Review, Marketing Head and Director approval, and on to the agreement and payments."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {canCreate && <button onClick={() => setNewOpen(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New booking</button>}
          </div>
        }
      >
        <div className="space-y-5">
          {!appFilter && (
            <div className="bg-card" style={{ border: RULE }}>
              <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
                {stats.map((x) => (
                  <div key={x.label}>
                    <button onClick={x.go} className="label link">{x.label}</button>
                    <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                    <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <VillaOffersPanel />

          <div className="bg-card" style={{ border: RULE }}>
            {appFilter ? (
              <div className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ borderBottom: RULE }}>
                <span className="text-muted-foreground">Showing the booking made from one application.</span>
                <button onClick={() => navigate("/crm/bookings", { replace: true })} className={`${KEY_LINE} h-8 px-3`}>All bookings</button>
              </div>
            ) : (
              <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
                  placeholder="Search name, booking no, unit…"
                  className="h-9 w-full sm:w-72 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <Select value={statusFilter} onValueChange={updateFilter(setStatusFilter)}>
                  <SelectTrigger className="w-auto min-w-[140px] h-9 rounded-none border-foreground/40 text-xs"><SelectValue placeholder="All statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="All">All statuses</SelectItem>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <CrmCompanyProjectBlockFilter value={cpb} onChange={updateFilter(setCpb)} />
                {anyFilter && (
                  <button onClick={() => { setSearchInput(""); setSearch(""); setStatusFilter("All"); setCpb({ companyId: "", projectId: "", blockId: "" }); setPage(1); }}
                    className={`${KEY_LINE} h-9 px-3`}>Clear filters</button>
                )}
              </div>
            )}
            {isError ? (
              <p className="px-5 py-10 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : (
              <DataTable
                serverPagination={!appFilter ? { page, pageSize, total, onPageChange: setPage, onPageSizeChange: (s) => { setPageSize(s); setPage(1); } } : undefined}
                data={bookings}
                columns={columns}
                searchable={false}
                loading={isLoading}
                onRowClick={(row) => openBooking(row.original.Id)}
                getRowId={(b: any) => String(b.Id)}
                emptyMessage={appFilter ? "No booking has been made from this application yet." : anyFilter ? "No bookings match these filters." : "No bookings yet. They are made when an application is approved, or with New booking."}
                className="border-0"
              />
            )}
          </div>
        </div>
      </SheetShell>

      {newOpen && canCreate && (
        <NewBookingDialog
          applicationId={appFilter}
          onClose={() => { setNewOpen(false); if (appFilter) navigate("/crm/bookings", { replace: true }); }}
        />
      )}

      {/* Every close path of the booking card funnels through onClose; it also drops ?view= / ?applicationId= so the
          list isn't left filtered to one application. deepLinkOpened stays set: appFilter clears with the URL. */}
      {viewingBookingId != null && (
        <CrmBookingDetail
          bookingId={viewingBookingId}
          onClose={() => {
            setViewingBookingId(null);
            navigate("/crm/bookings", { replace: true });
          }}
        />
      )}

      {unitChangeBooking && <ChangeUnitDialog booking={unitChangeBooking} onClose={() => setUnitChangeBooking(null)} />}
    </>
  );
};

export default CrmBooking;
