import { CrmStatus } from "@/constants/crmStatuses";
import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CrmShell } from "@/components/crm/CrmShell";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { promptNextStep } from "@/lib/workflowNav";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/ThemeContext";
import { RefreshButton } from "@/components/ui/RefreshButton";
import {
  Plus, CalendarClock, CheckCircle2, Search, MoreHorizontal, Eye, Copy,
  ArrowUpRight, Clock, AlertTriangle, X, Check, ShieldCheck, ChevronRight,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";

const API = "/api/crm/afs-registry";
const BKG_API = "/api/crm/bookings";

// ── Status presentation — same 3 states the backend enforces
// (Pending -> Scheduled -> Completed), pill style matching the
// CrmBooking.tsx / CrmAfsQueryPayment.tsx design system.
const STATUS_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  Pending:   { label: "Pending",   cls: "text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800/60 dark:text-amber-400", dot: "bg-amber-500" },
  Scheduled: { label: "Scheduled", cls: "text-blue-600 bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800/60 dark:text-blue-400",       dot: "bg-blue-500" },
  Completed: { label: "Completed", cls: "text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800/60 dark:text-emerald-400", dot: "bg-emerald-500" },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.Pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-semibold", c.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full", c.dot)} />
      {c.label}
    </span>
  );
}

function daysSince(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.floor(ms / 86_400_000));
}
function isPastDate(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

// ── Timeline strip: Started -> Scheduled -> Completed, with the actual
// dates once each stage happened. Purely presentational — reads the same
// CreatedAt/ScheduledDate/CompletedDate fields already returned by the
// list endpoint, no new data required.
function Timeline({ row }: { row: any }) {
  const stops = [
    { key: "created", label: "Started", at: row.CreatedAt, done: true },
    { key: "scheduled", label: "Scheduled", at: row.ScheduledDate, done: !!row.ScheduledDate },
    { key: "completed", label: "Completed", at: row.CompletedDate, done: !!row.CompletedDate },
  ];
  return (
    <div className="flex items-center">
      {stops.map((s, idx) => (
        <React.Fragment key={s.key}>
          <div className="flex flex-col items-center gap-1 min-w-[68px]">
            <span className={cn(
              "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
              s.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground border border-border",
            )}>
              {s.done ? <Check size={11} /> : idx + 1}
            </span>
            <span className={cn("text-[10px] font-medium text-center leading-tight", s.done ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            <span className="text-[9px] text-muted-foreground">{s.at ? String(s.at).slice(0, 10) : "—"}</span>
          </div>
          {idx < stops.length - 1 && (
            <div className={cn("h-[2px] flex-1 -mt-4 min-w-[16px]", stops[idx + 1].done ? "bg-emerald-500" : "bg-border")} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

async function fetchAll(): Promise<any[]> {
  const r = await fetchWithAuth(API);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load AFS Registry trackers");
  return r.json();
}
async function fetchEligibleBookings(): Promise<any[]> {
  const r = await fetchWithAuth(`${API}/eligible-bookings`);
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error || "Failed to load eligible bookings");
  return r.json();
}

// Small KPI tile for the summary strip — purely derived from the same
// `rows` already fetched for the table, no extra request.
function StatCard({ label, value, sub, icon: Icon, tint }: { label: string; value: string | number; sub?: string; icon: any; tint: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 flex items-center gap-3">
      <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", tint)}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold font-mono leading-none">{value}</p>
        <p className="text-[11px] text-muted-foreground mt-1 truncate">{label}{sub ? ` · ${sub}` : ""}</p>
      </div>
    </div>
  );
}

const CrmAfsRegistry: React.FC = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const deepLinkBookingId = sp.get("bookingId");
  const { canCreate } = usePageRights("crm-afs-registry");
  const { theme } = useTheme();
  const isDark = theme !== "light";

  const [dialogOpen, setDialogOpen] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [scheduleId, setScheduleId] = useState<number | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [completeId, setCompleteId] = useState<number | null>(null);
  const [completedDate, setCompletedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [detailRow, setDetailRow] = useState<any | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "Pending" | "Scheduled" | "Completed">("all");

  const { data: rows = [], isLoading, dataUpdatedAt, isFetching, refetch } = useQuery({ queryKey: ["crm-afs-registry"], queryFn: fetchAll, staleTime: 30_000 });
  const { data: eligibleBookings = [], isFetching: eligFetching } = useQuery({
    queryKey: ["crm-afs-registry-eligible"],
    queryFn: fetchEligibleBookings,
    enabled: dialogOpen,
    staleTime: 0,
  });

  const startableBookings = eligibleBookings as any[];

  // Status breakdown + "awaiting registration no." count for the KPI strip —
  // computed from the same data already fetched for the table.
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { Pending: 0, Scheduled: 0, Completed: 0 };
    (rows as any[]).forEach((r: any) => { c[r.Status] = (c[r.Status] || 0) + 1; });
    return c;
  }, [rows]);
  const awaitingRegNo = useMemo(
    () => (rows as any[]).filter((r: any) => r.Status === "Completed" && !r.AfsRegistrationNo).length,
    [rows],
  );
  const filteredRows = useMemo(() => {
    let out = rows as any[];
    if (filterStatus !== "all") out = out.filter((r: any) => r.Status === filterStatus);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter((r: any) =>
        r.ApplicantName?.toLowerCase().includes(q)
        || r.BookingNo?.toLowerCase().includes(q)
        || r.UnitNo?.toLowerCase().includes(q)
        || r.AfsRegNo?.toLowerCase().includes(q)
        || r.AgreementNo?.toLowerCase().includes(q)
        || r.Mobile?.includes(q)
      );
    }
    return out;
  }, [rows, filterStatus, search]);

  useEffect(() => {
    if (!deepLinkBookingId || dialogOpen) return;
    const existing = (rows as any[]).find((r: any) => String(r.BookingId) === deepLinkBookingId);
    if (existing) { setDetailRow(existing); return; }
    // Open create dialog pre-filled — eligible check happens inside the dialog
    setBookingId(deepLinkBookingId);
    setDialogOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkBookingId, (rows as any[]).length]);

  const handleStart = async () => {
    if (!bookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: parseInt(bookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.AfsRegNo} started`);
      setDialogOpen(false);
      setBookingId("");
      qc.invalidateQueries({ queryKey: ["crm-afs-registry"] });
      qc.invalidateQueries({ queryKey: ["crm-afs-registry-eligible"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleSchedule = async () => {
    if (!scheduleId || !scheduledDate) { toast.error("Date is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/${scheduleId}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ScheduledDate: scheduledDate }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Scheduled");
      setScheduleId(null);
      setScheduledDate("");
      qc.invalidateQueries({ queryKey: ["crm-afs-registry"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleComplete = async () => {
    if (!completeId) return;
    // Capture bookingId before clearing state so promptNextStep can deep-link
    const completingRow = (rows as any[]).find((r: any) => r.Id === completeId);
    const completingBookingId = completingRow?.BookingId;
    try {
      const res = await fetchWithAuth(`${API}/${completeId}/complete`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ CompletedDate: completedDate }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setCompleteId(null);
      qc.invalidateQueries({ queryKey: ["crm-afs-registry"] });
      qc.invalidateQueries({ queryKey: ["crm-booking-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["crm-dashboard"] });
      qc.invalidateQueries({ queryKey: ["crm-pre-possession-gateway"] });
      promptNextStep(
        navigate,
        "AFS Registry visit completed. Next: open the Agreement and click Mark as Registered (enter the AFS Registration No + Date).",
        completingBookingId ? `/crm/agreements?bookingId=${completingBookingId}` : "/crm/agreements",
        "Go to Agreement → Mark Registered",
      );
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Couldn't copy — copy it manually"),
    );
  };

  const columns: ColumnDef<any, unknown>[] = [
    { accessorKey: "AfsRegNo", header: "AREG No", size: 110,
      cell: (i) => (
        <button onClick={() => setDetailRow(i.row.original)} className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline">
          {i.getValue() as string}
        </button>
      ) },
    { accessorKey: "ApplicantName", header: "Customer", size: 170,
      cell: (i) => (
        <div onClick={() => setDetailRow(i.row.original)} className="cursor-pointer">
          <div className="font-medium">{i.row.original.ApplicantName}</div>
          <div className="text-xs text-muted-foreground">{i.row.original.BookingNo} · {i.row.original.UnitNo}</div>
        </div>
      ) },
    { accessorKey: "AgreementNo", header: "Agreement", size: 110,
      cell: (i) => <span onClick={() => setDetailRow(i.row.original)} className="cursor-pointer text-xs font-mono">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "AfsRegistrationNo", header: "AFS Reg No", size: 120,
      cell: (i) => <span onClick={() => setDetailRow(i.row.original)} className="cursor-pointer text-xs">{(i.getValue() as string) || "—"}</span> },
    { accessorKey: "ScheduledDate", header: "Scheduled", size: 120,
      cell: (i) => {
        const r = i.row.original;
        const overdue = r.Status === "Scheduled" && isPastDate(r.ScheduledDate);
        return (
          <div onClick={() => setDetailRow(r)} className="cursor-pointer">
            <span className="text-xs text-muted-foreground">{r.ScheduledDate ? String(r.ScheduledDate).slice(0, 10) : "—"}</span>
            {overdue && (
              <div className="flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 mt-0.5">
                <AlertTriangle size={9} /> Appointment date passed
              </div>
            )}
          </div>
        );
      } },
    { accessorKey: "Status", header: "Status", size: 120,
      cell: (i) => <div onClick={() => setDetailRow(i.row.original)} className="cursor-pointer"><StatusBadge status={i.row.original.Status} /></div> },
    { id: "age", header: "Waiting", size: 100, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        const d = r.Status === "Pending" ? daysSince(r.CreatedAt) : null;
        return d != null && d >= 7 ? (
          <div onClick={() => setDetailRow(r)} className="cursor-pointer flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
            <Clock size={10} /> {d}d
          </div>
        ) : <span onClick={() => setDetailRow(r)} className="cursor-pointer text-xs text-muted-foreground">—</span>;
      } },
    { id: "actions", header: "Actions", size: 210, enableSorting: false,
      cell: (i) => {
        const r = i.row.original;
        return (
          <div className="flex items-center gap-2">
            {r.Status === "Completed" ? (
              r.AfsRegistrationNo
                ? <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium"><ShieldCheck size={12} /> Registered</span>
                : <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium"><AlertTriangle size={12} /> Enter AFS Reg No</span>
            ) : (
              <>
                {r.Status === CrmStatus.PENDING && (
                  <button onClick={() => { setScheduleId(r.Id); setScheduledDate(""); }}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border font-medium text-amber-600 border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800/60 dark:text-amber-400">
                    <CalendarClock size={11} /> Schedule
                  </button>
                )}
                {r.Status === "Scheduled" && (
                  <button onClick={() => { setCompleteId(r.Id); setCompletedDate(new Date().toISOString().slice(0, 10)); }}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-md border font-medium text-emerald-700 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800/60 dark:text-emerald-400">
                    <CheckCircle2 size={11} /> Mark Completed
                  </button>
                )}
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded-md hover:bg-muted text-muted-foreground" title="More actions">
                  <MoreHorizontal size={15} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => setDetailRow(r)} className="gap-2">
                  <Eye size={14} className="text-muted-foreground" /> View Details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => copyToClipboard(r.AfsRegNo, "AREG No.")} className="gap-2">
                  <Copy size={14} className="text-muted-foreground" /> Copy AREG No.
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate(`/crm/bookings?view=${r.BookingId}`)} className="gap-2">
                  <ArrowUpRight size={14} className="text-amber-600 dark:text-amber-400" /> Go to Booking
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      } },
  ];

  const glassStyle: React.CSSProperties = {
    background: isDark ? "rgba(15,12,3,0.5)" : "rgba(255,255,255,0.72)",
    border: isDark ? "1px solid rgba(245,158,11,0.15)" : "1px solid rgba(245,158,11,0.18)",
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
    boxShadow: isDark
      ? "0 4px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)"
      : "0 4px 24px rgba(245,158,11,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
  };
  const borderColor = isDark ? "rgba(245,158,11,0.15)" : "rgba(245,158,11,0.12)";

  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard" }, { label: "CRM" }, { label: "Legal" }, { label: "Agreement Registration Visit" }]} />
      <CrmShell
        title="Agreement Registration — Sub-Registrar Visit 1"
        subtitle="Both parties appear at the Sub-Registrar's Office to officially register the Agreement for Sale — requires registration fees to be confirmed first"
        action={
          <div className="flex items-center gap-3">
            <RefreshButton dataUpdatedAt={dataUpdatedAt} isFetching={isFetching} onRefresh={refetch} />
            {canCreate && (
              <button onClick={() => setDialogOpen(true)}
                className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 transition-all">
                <Plus size={14} /> Start AFS Registry
              </button>
            )}
          </div>
        }
      >
        {/* KPI summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total Trackers" value={(rows as any[]).length} icon={CalendarClock} tint="bg-muted text-foreground" />
          <StatCard label="Pending" value={statusCounts.Pending || 0} icon={Clock} tint="bg-amber-500/10 text-amber-600 dark:text-amber-400" />
          <StatCard label="Scheduled" value={statusCounts.Scheduled || 0} icon={CalendarClock} tint="bg-blue-500/10 text-blue-600 dark:text-blue-400" />
          <StatCard label="Completed" value={statusCounts.Completed || 0} sub={awaitingRegNo > 0 ? `${awaitingRegNo} awaiting Reg No.` : undefined} icon={CheckCircle2} tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" />
        </div>

        {/* Search + status filter + table live in one continuous glass card,
            same convention as CrmBooking.tsx / CrmAfsQueryPayment.tsx. */}
        <div className="rounded-xl overflow-hidden" style={glassStyle}>
          <div className="flex gap-3 flex-wrap items-center px-3.5 py-3 border-b" style={{ borderColor }}>
            <div className="relative flex-1 min-w-48">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, AREG no, booking, unit..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {(["all", "Pending", "Scheduled", "Completed"] as const).map((s) => {
                const label = s === "all" ? "All" : s;
                const count = s === "all" ? (rows as any[]).length : statusCounts[s] || 0;
                const active = filterStatus === s;
                return (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      active ? "text-white border-transparent bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600" : "bg-background border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {label}
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-mono", active ? "bg-white/20" : "bg-muted")}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <DataTable
            data={filteredRows}
            columns={columns}
            searchable={false}
            loading={isLoading}
            emptyMessage={
              filterStatus === "all" && !search
                ? "No AFS Registry trackers yet. Click 'Start AFS Registry' once a booking's AFS Query Payment is Confirmed."
                : `No records match${filterStatus !== "all" ? ` status "${filterStatus}"` : ""}${search ? ` and search "${search}"` : ""}.`
            }
            className="border-0"
          />
        </div>

        {/* Start dialog */}
        <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setBookingId(""); } }}>
          <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-5 py-4 border-b border-border bg-muted/20">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <CalendarClock size={16} className="text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <DialogTitle className="font-heading text-base">Start AFS Registry</DialogTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Requires AFS Query Payment to be Confirmed for this booking first.</p>
                </div>
              </div>
            </DialogHeader>
            <div className="px-5 py-4">
              <label className="text-xs font-semibold text-foreground block mb-1.5">Booking <span className="text-red-500">*</span></label>
              {eligFetching ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock size={12} className="animate-spin" /> Loading eligible bookings…</p>
              ) : startableBookings.length === 0 ? (
                <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 space-y-1.5 dark:bg-amber-900/20 dark:border-amber-800/60">
                  <p className="font-semibold text-amber-800 dark:text-amber-400">No eligible bookings</p>
                  <p className="text-amber-700 dark:text-amber-500">To start an AFS Registry visit, the booking's AFS Query Payment must be <strong>Confirmed</strong> first.</p>
                  <button onClick={() => { setDialogOpen(false); navigate("/crm/afs-query-payment"); }}
                    className="flex items-center gap-1 text-blue-600 hover:underline pt-0.5">
                    Go to AFS Query Payment <ChevronRight size={11} />
                  </button>
                </div>
              ) : (
                <select value={bookingId} onChange={(e) => setBookingId(e.target.value)}
                  className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40">
                  <option value="">Select booking</option>
                  {startableBookings.map((b: any) => (
                    <option key={b.Id} value={String(b.Id)}>{b.BookingNo} · {b.ApplicantName} ({b.UnitNo})</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
              <button onClick={() => { setDialogOpen(false); setBookingId(""); }}
                className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted font-medium">Cancel</button>
              <button onClick={handleStart} disabled={saving || !bookingId}
                className="px-4 py-1.5 text-sm text-white rounded-lg font-semibold bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 disabled:opacity-40 transition-all">
                {saving ? "Starting..." : "Start"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Schedule dialog */}
        <Dialog open={!!scheduleId} onOpenChange={(o) => !o && setScheduleId(null)}>
          <DialogContent className="max-w-xs p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-5 py-4 border-b border-border bg-muted/20">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <CalendarClock size={16} className="text-blue-600 dark:text-blue-400" />
                </div>
                <DialogTitle className="font-heading text-base">Schedule AFS Registration</DialogTitle>
              </div>
            </DialogHeader>
            <div className="px-5 py-4">
              <label className="text-xs text-muted-foreground block mb-1">Appointment Date *</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
              <button onClick={() => setScheduleId(null)}
                className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted font-medium">Cancel</button>
              <button onClick={handleSchedule}
                className="px-4 py-1.5 text-sm text-white rounded-lg font-semibold bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-lg hover:shadow-amber-500/20 transition-all">Save</button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Complete dialog */}
        <Dialog open={!!completeId} onOpenChange={(o) => !o && setCompleteId(null)}>
          <DialogContent className="max-w-xs p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-5 py-4 border-b border-border bg-muted/20">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 shrink-0 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <DialogTitle className="font-heading text-base">Mark AFS Registry Completed</DialogTitle>
              </div>
            </DialogHeader>
            <div className="px-5 py-4">
              <label className="text-xs text-muted-foreground block mb-1">Completed Date</label>
              <input type="date" value={completedDate} onChange={(e) => setCompletedDate(e.target.value)}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
              <p className="text-[11px] text-muted-foreground mt-2">
                After confirming, enter the AFS Registration No on the Agreement record (Mark Registered).
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/10">
              <button onClick={() => setCompleteId(null)}
                className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted font-medium">Cancel</button>
              <button onClick={handleComplete}
                className="px-4 py-1.5 text-sm bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 transition-colors">Confirm Completed</button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Detail dialog — read-only, built entirely from the row data the
            list endpoint already returns (there is no GET /:id route on
            this router), so opening it costs no extra request. */}
        <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
          <DialogContent className="max-w-md p-0 gap-0 overflow-hidden rounded-xl">
            <DialogTitle className="sr-only">{detailRow ? `${detailRow.AfsRegNo} — AFS Registry` : "AFS Registry"}</DialogTitle>
            <DialogDescription className="sr-only">{detailRow ? `${detailRow.ApplicantName} · ${detailRow.BookingNo}` : "Record detail"}</DialogDescription>
            {detailRow && (
              <>
                <div className="px-5 pt-5 pb-4 border-b border-border">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      <CalendarClock size={16} className="text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold font-mono text-foreground">{detailRow.AfsRegNo}</span>
                        <StatusBadge status={detailRow.Status} />
                        <button onClick={() => copyToClipboard(detailRow.AfsRegNo, "AREG No.")} className="text-muted-foreground hover:text-foreground" title="Copy AREG No.">
                          <Copy size={11} />
                        </button>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{detailRow.ApplicantName} · {detailRow.BookingNo} · {detailRow.UnitNo}</p>
                    </div>
                    <DialogClose asChild>
                      <button className="shrink-0 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <X size={14} />
                      </button>
                    </DialogClose>
                  </div>
                  <div className="mt-3"><Timeline row={detailRow} /></div>
                </div>

                <div className="px-5 py-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="rounded-lg border border-border px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">Agreement No</p>
                      <p className="font-mono font-medium mt-0.5">{detailRow.AgreementNo || "—"}</p>
                    </div>
                    <div className="rounded-lg border border-border px-3 py-2">
                      <p className="text-[10px] text-muted-foreground">AFS Registration No</p>
                      <p className="font-mono font-medium mt-0.5">{detailRow.AfsRegistrationNo || "—"}</p>
                    </div>
                  </div>

                  {detailRow.Status === "Completed" && (
                    detailRow.AfsRegistrationNo ? (
                      <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 dark:bg-emerald-900/20 dark:border-emerald-800/60 dark:text-emerald-400">
                        <ShieldCheck size={16} className="shrink-0" /> AFS registered — details recorded on the Agreement.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 dark:bg-amber-900/20 dark:border-amber-800/60 dark:text-amber-400">
                          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                          <span>Registry visit complete. Now open the Agreement and click <strong>Mark as Registered</strong> — enter the AFS Registration No and date from the Sub-Registrar receipt.</span>
                        </div>
                        <button
                          onClick={() => { setDetailRow(null); navigate(`/crm/agreements?bookingId=${detailRow.BookingId}`); }}
                          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors">
                          <ChevronRight size={12} /> Go to Agreement → Mark as Registered
                        </button>
                      </div>
                    )
                  )}

                  {detailRow.Status === "Pending" && (
                    <button onClick={() => { setDetailRow(null); setScheduleId(detailRow.Id); setScheduledDate(""); }}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white rounded-lg bg-gradient-to-r from-amber-500 via-orange-400 to-amber-600 hover:shadow-md hover:shadow-amber-500/20 transition-all">
                      <CalendarClock size={12} /> Schedule Appointment
                    </button>
                  )}
                  {detailRow.Status === "Scheduled" && (
                    <button onClick={() => { setDetailRow(null); setCompleteId(detailRow.Id); setCompletedDate(new Date().toISOString().slice(0, 10)); }}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors">
                      <CheckCircle2 size={12} /> Mark Completed
                    </button>
                  )}

                  {detailRow.Remarks && (
                    <p className="text-[11px] text-muted-foreground italic">&ldquo;{detailRow.Remarks}&rdquo;</p>
                  )}
                </div>

                <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
                  <button onClick={() => navigate(`/crm/bookings?view=${detailRow.BookingId}`)}
                    className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline">
                    Go to Booking <ChevronRight size={12} />
                  </button>
                  <button onClick={() => setDetailRow(null)} className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:bg-muted transition-colors">Close</button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CrmShell>
    </>
  );
};

export default CrmAfsRegistry;