// CRM Property Mutation: the khata transfer that puts the buyer's name on the municipal land records once the sale deed
// is registered. One list; one page per mutation with its application, documents, history and sale deed together, and
// the one next action in the band. The server decides every rule.
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, ExternalLink, FileText, FolderCheck, History, Landmark, Link2, Plus, RefreshCw, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { DateInput } from "@/components/ui/date-input";
import { SearchableSelect } from "@/components/SearchableSelect";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmCompanyProjectBlockFilter } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import {
  CrmGrid, GridDateFilter, GridDialog, GridFacts, GridFormField, GridFormSection, GridRelated, GridSearch, GridTabs, GridToneMark,
  exportGrid, resolveGridDateRange, useGridPrefs, GRID_ANY_DATE, GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_PAGE_SIZES, GRID_SHEET_KEYS,
  type GridCol, type GridDateRange,
} from "@/components/crm/CrmDataTable";
import { usePageRights } from "@/hooks/usePageRights";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useCanApprove } from "@/hooks/useCanApprove";
import { useCrmListState, useSticky, listParams, type CrmListQuery } from "@/hooks/useCrmListState";
import { BAND_DOT, BAND_KEY, BAND_KEY_MAIN, BandNext, CollectionBar, MoneyBand, StepBar, personName, type StepState } from "./payments/parts";
import { fmtShort } from "./payments/config";
import { fmtDate, localDay } from "./salesDeed/config";
import { DocumentCentre } from "./salesDeed/parts";

const API = "/api/crm/mutation";
const KEY = "crm-mutation";
const OTHER_KEYS = ["crm-booking-lifecycle", "crm-legal-milestones"];
const ALL = "All";
const STATUS_LABEL: Record<string, string> = { Applied: "With the authority", QueryRaised: "Query raised", Approved: "Approved" };
const statusText = (s: string) => STATUS_LABEL[s] || s;
const statusTone = (s: string): "done" | "waiting" | "stopped" => (s === "Approved" ? "done" : s === "QueryRaised" ? "stopped" : "waiting");
const APPLICATION_FORM = { type: "MutationApplicationForm", label: "Mutation Application Form" };
const UPLOAD_TYPES = [{ value: "IdentityProof", label: "Identity proof" }, { value: "Other", label: "Other" }];
const DAY_MS = 86_400_000;
const isSynced = (doc: any): boolean => !!doc.Remarks?.startsWith("Synced automatically");
const money = (n: unknown) => (n != null && n !== "" ? fmtRupees(Number(n)) : "—");

/** Days the application has been with the authority (still open), or took (approved). */
const daysOpen = (m: any): number | null => {
  if (!m.ApplicationDate) return null;
  const end = m.Status === "Approved" && m.ApprovedDate ? new Date(m.ApprovedDate) : new Date();
  return Math.max(0, Math.floor((end.getTime() - new Date(m.ApplicationDate).getTime()) / DAY_MS));
};

/** Where a mutation stands, from its status and its mandatory documents. One rule for the list and the record. */
export function mutationSteps(m: any, required: number, verified: number): { label: string; state: StepState }[] {
  const ready = required > 0 && verified >= required;
  const approved = m.Status === "Approved", query = m.Status === "QueryRaised";
  return [
    { label: "Sale deed registered", state: "done" },
    { label: "Applied", state: "done" },
    { label: query ? "Query raised" : "Documents verified", state: query ? "stopped" : ready || approved ? "done" : "active" },
    { label: "New khata issued", state: approved ? "done" : ready && !query ? "active" : "off" },
  ];
}
export function mutationNext(m: any, required: number, verified: number): { text: string; late?: boolean } {
  if (m.Status === "Approved") return { text: `New khata ${m.NewKhataNo || ""} issued${m.ApprovedDate ? ` on ${fmtDate(m.ApprovedDate)}` : ""}`.replace("  ", " ") };
  const ready = required > 0 && verified >= required;
  if (m.Status === "QueryRaised") return ready ? { text: "Documents corrected: resubmit to the authority" } : { text: `Authority raised a query: correct the documents (${verified} of ${required} verified)`, late: true };
  if (!required) return { text: "Request the mutation application form" };
  if (!ready) return { text: `Verify the documents (${verified} of ${required} verified)` };
  return { text: "Waiting for the authority to issue the new khata" };
}

interface ExtraFilters { applied: GridDateRange }
const NO_EXTRA: ExtraFilters = { applied: GRID_ANY_DATE };
function queryString(q: CrmListQuery, x: ExtraFilters): URLSearchParams {
  const p = listParams(q, ALL);
  const { from, to } = resolveGridDateRange(x.applied);
  if (from) p.set("dateFrom", from);
  if (to) p.set("dateTo", to);
  return p;
}
async function send(url: string, method = "GET", body?: unknown): Promise<any> {
  const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.error || `The request could not be completed (${res.status}).`);
  return d;
}
const fetchList = async (q: CrmListQuery, x: ExtraFilters) => {
  const d = await send(`${API}?${queryString(q, x)}`);
  return { rows: (d.rows ?? []) as any[], total: Number(d.total ?? 0), counts: (d.statusCounts ?? {}) as Record<string, number>, feeTotal: Number(d.summary?.feeTotal ?? 0) };
};

const COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, sortKey: "ApplicantName", csv: (m) => personName(m.ApplicantName), cell: (m) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold text-foreground capitalize truncate" title={m.ApplicantName}>{personName(m.ApplicantName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">{m.MutationNo} · {m.BookingNo}</span>
    </span>
  ) },
  { id: "unit", label: "Project and unit", sortKey: "ProjectName", csv: (m) => [m.ProjectName, m.UnitNo].filter(Boolean).join(" / "), cell: (m) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-medium truncate">{m.ProjectName || "—"}</span>
      <span className="block text-xs text-muted-foreground truncate">{[m.UnitNo && `Unit ${m.UnitNo}`, m.Authority].filter(Boolean).join(" · ")}</span>
    </span>
  ) },
  { id: "progress", label: "Progress", sortKey: "Status", csv: (m) => statusText(m.Status), cell: (m) => <span className="block min-w-[16rem] py-1.5"><StepBar steps={mutationSteps(m, m.DocsRequired ?? 0, m.DocsVerified ?? 0)} /></span> },
  { id: "next", label: "Next step", csv: (m) => mutationNext(m, m.DocsRequired ?? 0, m.DocsVerified ?? 0).text, cell: (m) => {
    const n = mutationNext(m, m.DocsRequired ?? 0, m.DocsVerified ?? 0);
    return <span className={cn("block whitespace-normal text-[0.8125rem] leading-snug", n.late && "font-semibold text-destructive")}>{n.text}</span>;
  } },
  { id: "days", label: "Days", align: "right", csv: (m) => daysOpen(m), cell: (m) => <span className="tabular-nums" title={m.Status === "Approved" ? "Days the authority took" : "Days with the authority so far"}>{daysOpen(m) ?? "—"}</span> },
  { id: "fee", label: "Fee", align: "right", sortKey: "MutationFee", csv: (m) => m.MutationFee, cell: (m) => <span className="tabular-nums">{m.MutationFee ? fmtShort(m.MutationFee) : "—"}</span> },
  // In the export only.
  { id: "applied", label: "Applied on", hiddenByDefault: true, csv: (m) => fmtDate(m.ApplicationDate), cell: () => null },
  { id: "oldKhata", label: "Old khata", hiddenByDefault: true, csv: (m) => m.OldKhataNo, cell: () => null },
  { id: "newKhata", label: "New khata", hiddenByDefault: true, csv: (m) => m.NewKhataNo, cell: () => null },
  { id: "approvedNo", label: "Authority's mutation no.", hiddenByDefault: true, csv: (m) => m.ApprovedNo, cell: () => null },
  { id: "approvedOn", label: "Approved on", hiddenByDefault: true, csv: (m) => fmtDate(m.ApprovedDate), cell: () => null },
  { id: "deed", label: "Sale deed", hiddenByDefault: true, csv: (m) => m.DeedNo, cell: () => null },
  { id: "docs", label: "Documents verified", hiddenByDefault: true, csv: (m) => `${m.DocsVerified ?? 0}/${m.DocsRequired ?? 0}`, cell: () => null },
];

const emptyStart = () => ({ BookingId: "", ApplicationNo: "", ApplicationDate: localDay(), Authority: "", OldKhataNo: "", MutationFee: "" });

// ── One mutation ────────────────────────────────────────────────────────────────
function MutationRecord({ id, onBack, refreshAll }: { id: number; onBack: () => void; refreshAll: () => void }) {
  const navigate = useNavigate();
  const rights = usePageRights("crm-mutation");
  // Approval Setup ("CRM Mutation Approve") names who approves; a super admin always can. The server says.
  const canApprove = useCanApprove("crm-mutation-approve") && rights.canEdit;
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: [KEY, "record", id], queryFn: () => send(`${API}/${id}`), retry: false });
  const [dialog, setDialog] = useState<"query" | "approve" | null>(null);
  const [remarks, setRemarks] = useState("");
  const [approve, setApprove] = useState({ NewKhataNo: "", ApprovedNo: "", ApprovedDate: localDay() });
  const [busy, setBusy] = useState(false);
  if (isLoading) return <div className="px-4 py-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (isError || !data?.mutation) return (
    <div className={cn(GRID_CARD, "px-4 py-10 text-center text-sm")}>
      <p className="text-destructive">{isError ? translateError((error as Error)?.message) : "Mutation not found."}</p>
      <button type="button" onClick={onBack} className={cn(GRID_BTN, "mt-3")}>All mutations</button>
    </div>
  );
  const m = data.mutation;
  const documents: any[] = data.documents ?? [];
  const history: any[] = data.history ?? [];
  const required = documents.filter((d) => d.IsMandatory);
  const verified = required.filter((d) => d.Status === "Verified").length;
  const ready = required.length > 0 && verified === required.length;
  const locked = m.Status === "Approved";
  const canDocs = rights.canEdit && !locked;
  const days = daysOpen(m);
  const next = mutationNext(m, required.length, verified);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await work(); toast.success(done); setDialog(null); refreshAll(); return true; }
    catch (e: any) { toast.error(translateError(e.message)); return false; }
    finally { setBusy(false); }
  };
  const requestForm = () => run(() => send(`${API}/${id}/documents/request`, "POST", { DocumentType: APPLICATION_FORM.type, Label: APPLICATION_FORM.label, IsMandatory: true }), "Application form requested");
  const resubmit = () => run(() => send(`${API}/${id}/resubmit`, "PUT"), "Resubmitted to the authority");
  const openApprove = () => { setApprove({ NewKhataNo: "", ApprovedNo: "", ApprovedDate: localDay() }); setDialog("approve"); };
  const upload = (files: File[], documentType: string, label?: string) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    fd.append("DocumentType", documentType);
    if (label) fd.append("Label", label);
    return send(`${API}/${id}/documents/upload`, "POST", fd);
  };
  const review = (doc: any, ok: boolean, why?: string) => send(`${API}/${id}/documents/${doc.Id}`, "PUT", ok ? { Status: "Verified" } : { Status: "Rejected", Remarks: why });

  // The one action that moves it on, when there is one this user may take.
  const action = locked ? null
    : !required.length ? (canDocs ? { label: "Request Application Form", run: requestForm } : null)
    : m.Status === "QueryRaised" ? (ready && rights.canEdit ? { label: "Resubmit to Authority", run: resubmit } : null)
    : ready && canApprove ? { label: "Approve Mutation", run: openApprove } : null;
  const waitingOnApprover = !locked && m.Status === "Applied" && ready && !canApprove && rights.canEdit;
  const sub = `${personName(m.ApplicantName)} · ${m.MutationNo}`;

  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Property Mutation · ${m.MutationNo}`} title={<span className="capitalize">{personName(m.ApplicantName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{statusText(m.Status)}</span>}
        sub={[m.ProjectName, m.UnitNo && `Unit ${m.UnitNo}`, m.BookingNo, m.Mobile].filter(Boolean).join(" · ")}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All mutations</button>
          <button type="button" onClick={() => navigate(`/crm/bookings?view=${m.BookingId}`)} className={BAND_KEY}><ExternalLink size={13} /> Open Booking</button>
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={days != null ? `${days} day${days === 1 ? "" : "s"}` : "—"} leadNote={locked ? "taken by the authority" : `with ${m.Authority || "the authority"}${m.ApplicationDate ? ` since ${fmtDate(m.ApplicationDate)}` : ""}`}
        bar={<StepBar steps={mutationSteps(m, required.length, verified)} onDark />}
        figures={[
          { label: "Documents", dot: ready ? BAND_DOT.collected : BAND_DOT.finance, value: `${verified} of ${required.length}`, note: "Mandatory verified" },
          { label: "Khata", value: m.NewKhataNo || m.OldKhataNo || "—", note: m.NewKhataNo ? `New, was ${m.OldKhataNo || "not recorded"}` : "Old khata, new pending" },
          { label: "Mutation fee", value: m.MutationFee ? fmtShort(m.MutationFee) : "—", exact: m.MutationFee ? money(m.MutationFee) : undefined, note: "Paid to the authority" },
          { label: "Applied on", value: fmtDate(m.ApplicationDate), note: m.ApplicationNo ? `Application ${m.ApplicationNo}` : "Application no. not recorded" },
        ]}
        footer={<BandNext text={waitingOnApprover ? "Documents verified: waiting for the Legal head or an admin to approve" : next.text} finished={locked} action={action} />} />

      <GridRelated icon={Landmark} title="Application" action={m.Status === "Applied" && rights.canEdit ? <button type="button" onClick={() => { setRemarks(""); setDialog("query"); }} className={cn(GRID_SHEET_KEYS.KEY_LINE, "h-8 px-3 text-destructive")}><AlertTriangle size={12} /> Raise Query</button> : <GridToneMark text={statusText(m.Status)} tone={statusTone(m.Status)} />}>
        <GridFacts items={[
          { label: "Application no.", value: m.ApplicationNo },
          { label: "Applied on", value: fmtDate(m.ApplicationDate) },
          { label: "Authority", value: m.Authority },
          { label: "Mutation fee", value: m.MutationFee ? money(m.MutationFee) : null },
          { label: "Old khata no.", value: m.OldKhataNo },
          { label: "New khata no.", value: m.NewKhataNo },
          { label: "Authority's mutation no.", value: m.ApprovedNo },
          { label: "Approved on", value: m.ApprovedDate ? fmtDate(m.ApprovedDate) : null },
          { label: "Last query from the authority", value: m.QueryRemarks ? <span className={cn("whitespace-pre-line", m.Status === "QueryRaised" && "text-destructive")}>{m.QueryRemarks}</span> : null, wide: true },
        ]} />
      </GridRelated>

      <GridRelated icon={FolderCheck} title="Documents" count={documents.length} action={<span className="text-xs text-muted-foreground tabular-nums">{verified} of {required.length} mandatory verified</span>}>
        <div className="p-4">
          <DocumentCentre documents={documents} hasFile={(d) => !!d.HasFile} fileUrl={(d) => `${API}/documents/file/${d.Id}`} onChanged={refreshAll}
            review={review} attach={(d, f) => upload([f], d.DocumentType, d.Label)} upload={{ types: UPLOAD_TYPES, run: upload }}
            canAttach={{ ok: canDocs, reason: locked ? "Approved: the papers are closed." : "Changing papers needs the edit right." }}
            canReview={{ ok: canDocs, reason: locked ? "Approved: the papers are closed." : "Reviewing papers needs the edit right." }}
            nextStep={(d) => (isSynced(d) ? "Pulled from the Registry's own verified copy, nothing to do here." : undefined)}
            extraTag={(d) => (isSynced(d) ? <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full border border-dashed border-border text-[0.6875rem] text-muted-foreground"><Link2 size={10} /> Synced from registry</span> : null)}
            emptyRequired={<p className="text-xs text-muted-foreground">No mandatory document requested yet. Approval waits until one is requested and verified.</p>} />
        </div>
      </GridRelated>

      <GridRelated icon={FileText} title="Property and Sale Deed">
        <GridFacts items={[
          { label: "Buyer", value: <ApplicantNames name={m.ApplicantName} bookingId={m.BookingId} applicationId={m.ApplicationId} /> },
          { label: "Mobile", value: m.Mobile },
          { label: "Booking", value: m.BookingNo },
          { label: "Project and unit", value: [m.ProjectName, m.UnitNo].filter(Boolean).join(" · ") },
          { label: "Sale deed no.", value: m.DeedNo },
          { label: "Registration no.", value: m.RegistrationNo || m.RegNo },
          { label: "Sub-registrar office", value: m.SubRegistrarOffice },
        ]} />
      </GridRelated>

      <GridRelated icon={History} title="History" count={history.length}>
        {history.length ? (
          <ol className="px-4 py-4 relative ml-3 border-l border-border space-y-4">
            {history.map((log: any) => (
              <li key={log.Id} className="relative pl-5">
                <span className="absolute -left-[9px] top-0.5 w-[18px] h-[18px] rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground"><ScrollText size={10} /></span>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-[0.8125rem] font-semibold">{log.Action}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{log.CreatedAt ? new Date(log.CreatedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">By {log.ActorName || "System"}{log.ActorType ? ` · ${log.ActorType}` : ""}</div>
                {log.Remarks && <p className="mt-1 text-xs rounded-md bg-muted/60 px-2 py-1.5 whitespace-pre-line">{log.Remarks}</p>}
              </li>
            ))}
          </ol>
        ) : <p className="px-4 py-4 text-xs text-muted-foreground">No history recorded yet.</p>}
      </GridRelated>

      {dialog === "query" && (
        <GridDialog onClose={() => setDialog(null)} icon={AlertTriangle} width="max-w-2xl" title="Raise Query" description={sub}
          footer={<><button onClick={() => setDialog(null)} className={GRID_BTN}>Cancel</button>
            <button disabled={busy || !remarks.trim()} onClick={() => run(() => send(`${API}/${id}/query`, "PUT", { Remarks: remarks.trim() }), "Query recorded: the documents are reset for correction")} className={cn(GRID_SHEET_KEYS.KEY_RED, "h-9 px-3")}>{busy ? "Saving…" : "Record Query"}</button></>}>
          <GridFormField label="What did the authority flag?" required hint="The mandatory documents are reset, so staff correct and reattach them before resubmitting.">
            <textarea value={remarks} rows={4} onChange={(e) => setRemarks(e.target.value)} className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
          </GridFormField>
        </GridDialog>
      )}
      {dialog === "approve" && (
        <GridDialog onClose={() => setDialog(null)} icon={CheckCircle2} width="max-w-2xl" title="Approve Mutation" description={`${sub} · the authority has issued the new khata`}
          footer={<><button onClick={() => setDialog(null)} className={GRID_BTN}>Cancel</button>
            <button disabled={busy || !approve.NewKhataNo.trim()} onClick={() => run(() => send(`${API}/${id}/approve`, "PUT", approve), "Mutation approved: municipal records updated")} className={GRID_BTN_BRAND}>{busy ? "Saving…" : "Approve Mutation"}</button></>}>
          <GridFormSection>
            <GridFormField label="New khata no." required><input value={approve.NewKhataNo} placeholder="As issued by the authority" onChange={(e) => setApprove((f) => ({ ...f, NewKhataNo: e.target.value }))} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Authority's mutation no."><input value={approve.ApprovedNo} onChange={(e) => setApprove((f) => ({ ...f, ApprovedNo: e.target.value }))} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Approved on"><DateInput value={approve.ApprovedDate} max={localDay()} onChange={(e) => setApprove((f) => ({ ...f, ApprovedDate: e.target.value }))} className={GRID_INPUT} /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
    </div>
  );
}

// ── The page ────────────────────────────────────────────────────────────────────
const CrmMutation: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-mutation");
  const [sp] = useSearchParams();
  const linkedBooking = sp.get("bookingId");
  // The open mutation lives in the address, so a refresh or a shared link keeps it.
  const [idParam, setIdParam] = useUrlParam("mutationId");
  const openId = /^\d+$/.test(idParam) ? Number(idParam) : null;
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);
  const list = useCrmListState({ pageSize, defaultSort: { key: "CreatedAt", dir: "desc" }, defaultStatus: ALL });
  const [extra, setExtraRaw] = useState<ExtraFilters>(NO_EXTRA);
  const setApplied = (applied: GridDateRange) => { setExtraRaw({ applied }); list.setPage(1); };
  const filtered = list.hasFilters || extra.applied.preset !== "any";
  const [prefs, setPrefs] = useGridPrefs("crm-mutation-cols-v2", COLS);
  const [exporting, setExporting] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [start, setStart] = useState(emptyStart);
  const [saving, setSaving] = useState(false);
  const [linkDone, setLinkDone] = useState(false);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({ queryKey: [KEY, "list", list.query, extra], queryFn: () => fetchList(list.query, extra), staleTime: 0, enabled: openId == null });
  const board = useSticky(data);
  const counts = board?.counts ?? {};
  const all = Object.values(counts).reduce((n, x) => n + x, 0);
  const { data: startable = [] } = useQuery({ queryKey: [KEY, "eligible"], queryFn: () => send(`${API}/eligible-bookings`), staleTime: 60_000, enabled: rights.canCreate });
  const refreshAll = () => [KEY, ...OTHER_KEYS].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  // ?bookingId opens the booking's mutation, or Start Mutation for it when it has none and is eligible.
  useEffect(() => {
    if (linkDone || !linkedBooking || openId != null) return;
    let stop = false;
    (async () => {
      const row = await send(`${API}/booking/${linkedBooking}`).catch(() => null);
      if (stop) return;
      if (row?.Id) { setLinkDone(true); setIdParam(String(row.Id)); return; }
      if (rights.canCreate && (startable as any[]).some((b) => String(b.Id) === linkedBooking)) {
        setLinkDone(true);
        setStart({ ...emptyStart(), BookingId: linkedBooking });
        setStartOpen(true);
      }
    })();
    return () => { stop = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedBooking, openId, linkDone, (startable as any[]).length, rights.canCreate]);

  const handleStart = async () => {
    if (!start.BookingId) return void toast.error("Select a booking.");
    setSaving(true);
    try {
      const d = await send(API, "POST", { ...start, BookingId: parseInt(start.BookingId) });
      toast.success(`${d.MutationNo} started`);
      setStartOpen(false);
      setStart(emptyStart());
      refreshAll();
      setIdParam(String(d.id));
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };
  const handleExport = async () => {
    setExporting(true);
    try {
      const p = queryString(list.query, extra);
      p.delete("page"); p.delete("pageSize");
      exportGrid(await send(`${API}?${p}`), COLS, `property-mutations-${list.status.toLowerCase()}`);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setExporting(false); }
  };
  const approved = counts.Approved ?? 0, applied = counts.Applied ?? 0, query = counts.QueryRaised ?? 0;
  const set = (k: keyof ReturnType<typeof emptyStart>, v: string) => setStart((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <Breadcrumbs items={["Dashboard", "CRM", "Property Mutation"]} />
      {openId != null ? <MutationRecord key={openId} id={openId} onBack={() => setIdParam("")} refreshAll={refreshAll} /> : (
        <>
          <MoneyBand eyebrow="CRM" title="Property Mutation" sub="The khata transfer that puts the buyer's name on the municipal land records, once the sale deed is registered."
            actions={<>
              {rights.canCreate && <button type="button" onClick={() => { setStart(emptyStart()); setStartOpen(true); }} className={BAND_KEY_MAIN}><Plus size={13} /> Start Mutation</button>}
              <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            </>}
            lead={`${approved} of ${all}`} leadNote="mutations approved"
            bar={<CollectionBar onDark due={all} collected={approved} finance={applied} recorded={0} />}
            figures={[
              { label: "With the authority", dot: BAND_DOT.finance, value: String(applied), note: "Awaiting the new khata" },
              { label: "Query raised", dot: query > 0 ? BAND_DOT.overdue : undefined, value: String(query), note: "Documents to correct", alert: query > 0 },
              { label: "Ready to start", value: String((startable as any[]).length), note: "Sale deed registered, no mutation yet" },
              { label: "Mutation fees", value: fmtShort(board?.feeTotal ?? 0), exact: money(board?.feeTotal ?? 0), note: "On these mutations" },
            ]} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<string> label="Property Mutation" active={list.status} onChange={list.setStatus}
              tabs={[ALL, "Applied", "QueryRaised", "Approved"].map((k) => ({ key: k, label: k === ALL ? "All mutations" : statusText(k), count: board ? (k === ALL ? all : counts[k] ?? 0) : null }))} />
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch value={list.searchInput} onChange={list.setSearchInput} placeholder="Customer, booking, unit or mutation no." />
              <CrmCompanyProjectBlockFilter value={list.cpb} onChange={list.setCpb} />
              <GridDateFilter label="Applied" value={extra.applied} onChange={setApplied} />
              {filtered && <button type="button" onClick={() => { list.reset(); setExtraRaw(NO_EXTRA); }} className={GRID_BTN}>Clear filters</button>}
              <button type="button" onClick={handleExport} disabled={exporting || !all} className={cn(GRID_BTN, "ml-auto")} title="Export to Excel"><Download size={13} /> <span className="hidden md:inline">{exporting ? "Exporting…" : "Export"}</span></button>
            </div>
            <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={board?.rows ?? []} rowKey={(m) => m.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={isError ? translateError((error as Error)?.message) : null} onRetry={() => refetch()}
              sort={list.sort} onSort={list.toggleSort} onRowClick={(m) => setIdParam(String(m.Id))}
              empty={filtered ? "No mutation matches these filters." : "No mutation yet. Start one once a booking's sale deed is registered."}
              page={list.page} pageSize={pageSize} total={board?.total ?? 0} onPage={list.setPage} onPageSize={(n) => { setPageSize(n); list.setPage(1); }} />
          </div>
        </>
      )}

      {startOpen && (
        <GridDialog onClose={() => setStartOpen(false)} icon={Landmark} title="Start Mutation" description="Record the application filed with the municipal authority for the khata transfer."
          footer={<><button onClick={() => setStartOpen(false)} className={GRID_BTN}>Cancel</button><button onClick={handleStart} disabled={saving || !start.BookingId} className={GRID_BTN_BRAND}>{saving ? "Starting…" : "Start Mutation"}</button></>}>
          <GridFormSection title="Booking">
            <GridFormField label="Booking" required wide hint={(startable as any[]).length ? "Only bookings whose sale deed registry is complete, and with no mutation yet, are listed." : "No booking is eligible yet: the sale deed registry must be completed first."}>
              <SearchableSelect value={start.BookingId} onChange={(v) => set("BookingId", v)} placeholder="Select booking" searchPlaceholder="Search booking or customer…"
                options={(startable as any[]).map((b) => ({ value: String(b.Id), label: [b.BookingNo, personName(b.ApplicantName)].filter(Boolean).join(" · ") }))} />
            </GridFormField>
          </GridFormSection>
          <GridFormSection title="Application">
            <GridFormField label="Application no."><input value={start.ApplicationNo} placeholder="As given by the authority" onChange={(e) => set("ApplicationNo", e.target.value)} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="Application date"><DateInput value={start.ApplicationDate} max={localDay()} onChange={(e) => set("ApplicationDate", e.target.value)} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="Authority"><input value={start.Authority} placeholder="e.g. Municipal Corporation" onChange={(e) => set("Authority", e.target.value)} className={GRID_INPUT} /></GridFormField>
            <GridFormField label="Old khata no."><input value={start.OldKhataNo} onChange={(e) => set("OldKhataNo", e.target.value)} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
            <GridFormField label="Mutation fee"><input type="number" min="0" value={start.MutationFee} onChange={(e) => set("MutationFee", e.target.value)} className={cn(GRID_INPUT, "tabular-nums")} /></GridFormField>
          </GridFormSection>
        </GridDialog>
      )}
    </div>
  );
};

export default CrmMutation;
