// CRM Welcome Calls: the queue of approved bookings still to be welcomed, the recheck queue (checklist items flagged
// for another look) and the call history. A booking opens in IntakeDialog (?bookingId=<id>).
import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChevronRight, FileCheck, Phone, ShieldAlert } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { usePageRights } from "@/hooks/usePageRights";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import {
  KEY_INK, KEY_LINE, OUTCOME_LABEL, PAGE_SIZE, RULE, RULE_SOFT, fetchBookingById, fetchCallsList, fetchQueue, fetchRecheckQueue, outcomeTone,
} from "./welcomeCalls/config";
import { WelcomeCallPdfDialog } from "./welcomeCalls/PreviewDialogs";
import { IntakeDialog } from "./welcomeCalls/IntakeDialog";

type View = "queue" | "recheck" | "history";
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const day = (v: unknown) => (v ? String(v).slice(0, 10) : "");

const CrmWelcomeCall: React.FC = () => {
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => { setSearch(v); setHistoryPage(1); });
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [historyPage, setHistoryPage] = useState(1);
  const [view, setView] = useState<View>("queue");
  const [activeBooking, setActiveBooking] = useState<any | null>(null);
  // Set only when a past call is opened from Call History: IntakeDialog then opens in "Edit call log" mode.
  const [activeCall, setActiveCall] = useState<any | null>(null);
  const [deepLinkOpened, setDeepLinkOpened] = useState(false);
  const [viewingPdf, setViewingPdf] = useState<{ id: number; no: string } | null>(null);

  // The URL carries the open booking (?bookingId=), so a refresh or a shared link reopens it.
  const openBooking = (row: any, call: any | null = null) => {
    setActiveBooking(row);
    setActiveCall(call);
    if (row?.BookingId != null) navigate(`/crm/welcome-calls?bookingId=${row.BookingId}`, { replace: true });
  };

  const queueQ = useQuery({ queryKey: ["crm-welcome-queue", cpb], queryFn: () => fetchQueue(cpb), staleTime: 30_000 });
  const recheckQ = useQuery({ queryKey: ["crm-welcome-recheck-queue", cpb], queryFn: () => fetchRecheckQueue(cpb), staleTime: 30_000 });
  const historyQ = useQuery({
    queryKey: ["crm-welcome-calls-history", cpb, search, historyPage],
    queryFn: () => fetchCallsList(cpb, search, historyPage),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
  const queue = queueQ.data ?? [];
  const recheckQueue = recheckQ.data ?? [];
  const history = historyQ.data?.rows ?? [];
  const historyTotal = historyQ.data?.total ?? 0;

  // ?bookingId=X (e.g. from Bookings' "Welcome call") opens that booking whether or not it is in the queue.
  useEffect(() => {
    if (!bkgFilter || deepLinkOpened || queueQ.isLoading) return;
    setDeepLinkOpened(true);
    const id = parseInt(bkgFilter, 10);
    const fromQueue = queue.find((c: any) => c.BookingId === id);
    if (fromQueue) { setActiveBooking(fromQueue); return; }
    fetchBookingById(id).then((b) => {
      if (b) setActiveBooking(b);
      else { toast.error("That booking could not be opened (not found, or not in your projects)."); navigate("/crm/welcome-calls", { replace: true }); }
    });
  }, [bkgFilter, deepLinkOpened, queue, queueQ.isLoading, navigate]);

  // Queue and Recheck are already server-filtered by Company/Project/Block and are small (open work), so the search
  // narrows them here; History is searched on the server.
  const s = search.trim().toLowerCase();
  const match = (c: any) => !s || c.ApplicantName?.toLowerCase().includes(s) || c.BookingNo?.toLowerCase().includes(s) || c.Mobile?.includes(s);
  const filteredQueue = useMemo(() => queue.filter(match), [queue, s]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredRecheck = useMemo(() => recheckQueue.filter(match), [recheckQueue, s]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = today();
  const overdue = queue.filter((c: any) => c.NextCallDate && day(c.NextCallDate) <= t).length;
  const neverCalled = queue.filter((c: any) => !c.LastCallId).length;
  const flaggedItems = recheckQueue.reduce((n: number, c: any) => n + Number(c.OpenRecheckCount || 0), 0);

  const customerCell = (r: any) => (
    <div className="min-w-0">
      <div className="font-medium truncate"><ApplicantNames name={r.ApplicantName} bookingId={r.BookingId} applicationId={r.ApplicationId} /></div>
      <div className="text-xs text-muted-foreground tabular-nums">{r.Mobile}</div>
    </div>
  );
  const bookingNoCell = (v: unknown) => <span className="font-heading text-xs font-semibold tabular-nums text-foreground">{v as string}</span>;
  const projectCell = (r: any) => <span className="text-xs">{[r.ProjectName, r.UnitNo].filter(Boolean).join(" · ") || "—"}</span>;

  const queueColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking", size: 120, cell: (i) => bookingNoCell(i.getValue()) },
    { accessorKey: "ApplicantName", header: "Customer", size: 180, cell: (i) => customerCell(i.row.original) },
    { id: "projectUnit", header: "Project / unit", size: 180, enableSorting: false, cell: (i) => projectCell(i.row.original) },
    { accessorKey: "LastOutcome", header: "Last call", size: 160,
      cell: (i) => {
        const r = i.row.original;
        if (!r.LastOutcome) return <span className="text-xs text-muted-foreground">Never called</span>;
        return (
          <div className="space-y-0.5">
            <SheetMark text={OUTCOME_LABEL[r.LastOutcome] || r.LastOutcome} tone={outcomeTone(r.LastOutcome)} />
            {r.ConsecutiveNonReached > 1 && <div className="text-[0.625rem] text-destructive">{r.ConsecutiveNonReached} tries without reaching</div>}
          </div>
        );
      } },
    { accessorKey: "NextCallDate", header: "Follow-up due", size: 120,
      cell: (i) => {
        const d = day(i.row.original.NextCallDate);
        if (!d) return <span className="text-xs text-muted-foreground">—</span>;
        return <span className={`text-xs tabular-nums ${d <= t ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{d}{d < t ? " · overdue" : d === t ? " · today" : ""}</span>;
      } },
    { id: "actions", header: "", size: 110, enableSorting: false,
      cell: (i) => <button onClick={(e) => { e.stopPropagation(); openBooking(i.row.original); }} className={`${KEY_INK} h-7 px-2.5`}><Phone size={11} /> Call now</button> },
  ];

  const recheckColumns: ColumnDef<any, unknown>[] = [
    { accessorKey: "BookingNo", header: "Booking", size: 120, cell: (i) => bookingNoCell(i.getValue()) },
    { accessorKey: "ApplicantName", header: "Customer", size: 180, cell: (i) => customerCell(i.row.original) },
    { id: "projectUnit", header: "Project / unit", size: 180, enableSorting: false, cell: (i) => projectCell(i.row.original) },
    { accessorKey: "OpenRecheckCount", header: "Flagged items", size: 120,
      cell: (i) => <SheetMark text={`${i.row.original.OpenRecheckCount} open`} tone="stopped" /> },
    { accessorKey: "OldestFlaggedAt", header: "Flagged since", size: 120,
      cell: (i) => <span className="text-xs text-muted-foreground tabular-nums">{day(i.row.original.OldestFlaggedAt) || "—"}</span> },
    { id: "actions", header: "", size: 110, enableSorting: false,
      cell: (i) => <button onClick={(e) => { e.stopPropagation(); openBooking(i.row.original); }} className={`${KEY_LINE} h-7 px-2.5 !text-destructive !border-destructive`}><ShieldAlert size={11} /> Resolve</button> },
  ];

  usePageRights("crm-welcome-calls");

  const stats: { label: string; value: number; note: string; go: View }[] = [
    { label: "To call", value: queue.length, note: `${neverCalled} never called`, go: "queue" },
    { label: "Due or overdue", value: overdue, note: "Follow-up date today or earlier", go: "queue" },
    { label: "To recheck", value: recheckQueue.length, note: `${flaggedItems} flagged item${flaggedItems === 1 ? "" : "s"}`, go: "recheck" },
    { label: "Calls logged", value: historyTotal, note: search ? "Matching the search" : "Under these filters", go: "history" },
  ];
  const tabs: { key: View; label: string; count: number }[] = [
    { key: "queue", label: "Queue", count: queue.length },
    { key: "recheck", label: "Recheck", count: recheckQueue.length },
    { key: "history", label: "Call history", count: historyTotal },
  ];
  const active = view === "queue" ? queueQ : view === "recheck" ? recheckQ : historyQ;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Welcome Calls"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM"
        title="Welcome Calls"
        subtitle="Call each approved booking, then verify the documents, co-applicants and bank / nominee details on the checklist."
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {stats.map((x) => (
                <div key={x.label}>
                  <button onClick={() => setView(x.go)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{queueQ.isLoading ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="flex items-stretch overflow-x-auto overflow-y-hidden" style={{ borderBottom: RULE }}>
              {tabs.map((tb) => (
                <button key={tb.key} onClick={() => setView(tb.key)}
                  className={`inline-flex items-center gap-2 px-4 h-11 font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${view === tb.key ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`}
                  style={{ borderRight: RULE_SOFT }}>
                  {tb.key === "recheck" && <ShieldAlert size={12} />}{tb.label} <span className="tabular-nums">{tb.count}</span>
                </button>
              ))}
            </div>
            <div className="px-5 py-4 flex flex-wrap items-center gap-3" style={{ borderBottom: RULE }}>
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setHistoryPage(1); } }}
                placeholder="Search customer, mobile or booking no…"
                className="h-9 w-full sm:w-72 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
              <CrmCompanyProjectBlockFilter value={cpb} onChange={(v) => { setCpb(v); setHistoryPage(1); }} />
            </div>

            {active.isError ? (
              <p className="px-5 py-10 text-center text-sm text-destructive">{(active.error as Error)?.message}</p>
            ) : view === "queue" ? (
              <DataTable data={filteredQueue} columns={queueColumns} searchable={false} loading={queueQ.isLoading}
                onRowClick={(row) => openBooking(row.original)} getRowId={(r: any) => String(r.BookingId)}
                emptyMessage={s ? "No booking in the queue matches the search." : "The queue is clear: no calls waiting."} className="border-0" />
            ) : view === "recheck" ? (
              <DataTable data={filteredRecheck} columns={recheckColumns} searchable={false} loading={recheckQ.isLoading}
                onRowClick={(row) => openBooking(row.original)} getRowId={(r: any) => String(r.BookingId)}
                emptyMessage={s ? "No flagged booking matches the search." : "No open recheck flags."} className="border-0" />
            ) : (
              <>
                {historyQ.isLoading ? (
                  <p className="p-8 text-center text-muted-foreground text-sm">Loading…</p>
                ) : history.length === 0 ? (
                  <p className="p-8 text-center text-muted-foreground text-sm">{s ? "No call matches the search." : "No welcome calls logged yet."}</p>
                ) : (
                  <div>
                    {history.map((c: any) => {
                      let custom: { key: string; value: string }[] = [];
                      try { custom = c.CustomFields ? JSON.parse(c.CustomFields) : []; } catch { /* ignore */ }
                      return (
                        <div key={c.Id} role="button" tabIndex={0} onClick={() => openBooking(c, c)}
                          onKeyDown={(e) => e.key === "Enter" && openBooking(c, c)}
                          className="px-5 py-3.5 hover:bg-primary/5 transition-colors cursor-pointer" style={{ borderBottom: RULE_SOFT }}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-foreground"><ApplicantNames name={c.ApplicantName} bookingId={c.BookingId} applicationId={c.ApplicationId} /></span>
                                <span className="text-xs text-muted-foreground font-heading tabular-nums">{c.BookingNo}</span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">{[c.Mobile, c.ProjectName || c.UnitNo].filter(Boolean).join(" · ")}</div>
                            </div>
                            <div className="flex items-center gap-3">
                              {c.Outcome && <SheetMark text={OUTCOME_LABEL[c.Outcome] || c.Outcome} tone={outcomeTone(c.Outcome)} />}
                              <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">{c.CallDate ? String(c.CallDate).slice(0, 16).replace("T", " ") : "—"}</span>
                              {!!c.HasSubmittedChecklist && (
                                <button onClick={(e) => { e.stopPropagation(); setViewingPdf({ id: c.BookingId, no: c.BookingNo }); }} className={`${KEY_LINE} h-7 px-2`}>
                                  <FileCheck size={11} /> PDF
                                </button>
                              )}
                              <ChevronRight size={14} className="text-muted-foreground" />
                            </div>
                          </div>
                          {(c.Notes || c.DurationSeconds || c.NextCallDate || c.PreferredAgreementDate || c.CalledByName || custom.length > 0) && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              {!!c.DurationSeconds && <span className="tabular-nums">{Math.floor(c.DurationSeconds / 60)}m {c.DurationSeconds % 60}s</span>}
                              {c.CalledByName && <span>by {c.CalledByName}</span>}
                              {c.NextCallDate && <span className="text-foreground">Follow-up {day(c.NextCallDate)}</span>}
                              {c.PreferredAgreementDate && <span>Agreement date discussed (note only): {day(c.PreferredAgreementDate)}</span>}
                              {c.Notes && <span className="truncate max-w-xs">{c.Notes}</span>}
                              {custom.map((f, i) => <span key={i}>{f.key}: {f.value}</span>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <CrmPaginationBar page={historyPage} pageSize={PAGE_SIZE} total={historyTotal} onPage={setHistoryPage} />
              </>
            )}
          </div>
        </div>
      </SheetShell>

      {/* Closing clears ?bookingId=; deepLinkOpened stays set, since bkgFilter clears with the URL. */}
      {activeBooking && (
        <IntakeDialog
          key={activeCall ? `call-${activeCall.Id}` : `booking-${activeBooking.BookingId}`}
          booking={activeBooking}
          editingCall={activeCall}
          onCancelEdit={() => setActiveCall(null)}
          onClose={() => {
            setActiveBooking(null);
            setActiveCall(null);
            if (bkgFilter) navigate("/crm/welcome-calls", { replace: true });
          }}
        />
      )}
      {viewingPdf && <WelcomeCallPdfDialog bookingId={viewingPdf.id} bookingNo={viewingPdf.no} onClose={() => setViewingPdf(null)} />}
    </>
  );
};

export default CrmWelcomeCall;
