// CRM Unit Changes: a buyer moving from their booking's unit to another unit, in the same project or another one.
// One list; one page per request with the money first, its steps and the one next action. Raised from the booking →
// approved in Approval Setup ("CRM Unit Change") → on approval the old booking closes as Unit Changed, a new booking
// opens on the new unit for the same buyer, and every rupee received moves to it in full. Between companies the money
// waits for Finance's Fund Transfer approval. The server decides every rule.
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { useUrlParam } from "@/hooks/useUrlParam";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRightLeft, FileText, Home, Info, RefreshCw, RotateCcw, ShieldCheck, Wallet, XCircle } from "lucide-react";
import { ApprovalActions } from "@/components/ApprovalActions";
import { ApprovalTrailTimeline } from "@/components/ApprovalStatusChain";
import {
  CrmGrid, GridDialog, GridFields, GridFormField, GridRelated, GridSearch, GridStatusPill, GridTabs, useGridPrefs,
  GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, type GridCol,
} from "@/components/crm/CrmDataTable";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { BAND_DOT, BAND_KEY, BandNext, MoneyBand, StepBar, asName, personName, type StepState } from "./payments/parts";
import { fmtShort } from "./payments/config";

const API = "/api/crm/bookings/unit-changes";
const TABS = ["Open", "Pending", "MovingMoney", "Failed", "Completed", "Rejected", "Withdrawn", "All"];
const STATUS_TEXT: Record<string, string> = {
  Open: "Open", Pending: "Awaiting approval", Approved: "Being carried out", MovingMoney: "Money on its way", Failed: "Stopped part-way",
  Completed: "Completed", Rejected: "Rejected", Withdrawn: "Withdrawn", All: "All",
};
const statusText = (s: string) => STATUS_TEXT[s] ?? s;
const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const dt = (v: any) => (v ? new Date(v).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const addOnsOf = (r: any): any[] => { try { return JSON.parse(r.AddOnsJson || "[]"); } catch { return []; } };
const received = (r: any) => Number(r.ClearedAtRequest || 0) + Number(r.AvailableCreditAtRequest || 0);

async function putJson(url: string, body: any) {
  const res = await fetchWithAuth(url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || "Request failed");
  return d;
}

/** The request's steps: raised, approval, new booking, money moved. */
function changeBar(r: any): { label: string; state: StepState }[] {
  const dropped = r.Status === "Rejected" || r.Status === "Withdrawn";
  const approved = ["Approved", "MovingMoney", "Failed", "Completed"].includes(r.Status);
  return [
    { label: "Raised", state: "done" },
    { label: "Approval", state: approved ? "done" : dropped ? "stopped" : "active" },
    { label: "New booking", state: r.TargetBookingId ? "done" : r.Status === "Failed" ? "stopped" : approved ? "active" : "off" },
    { label: "Money moved", state: r.Status === "Completed" ? "done" : r.Status === "Failed" && r.TargetBookingId ? "stopped" : r.TargetBookingId ? "active" : "off" },
  ];
}

const COLS: GridCol<any>[] = [
  { id: "customer", label: "Customer", locked: true, cell: (r) => (
    <span className="block py-1.5 min-w-0">
      <span className="block font-semibold capitalize truncate max-w-[16rem]" title={r.CustomerName}>{asName(r.CustomerName)}</span>
      <span className="block text-xs text-muted-foreground tabular-nums">{r.RequestNo}</span>
    </span>
  ) },
  { id: "from", label: "From", cell: (r) => <span className="block py-1.5"><span className="block tabular-nums">{r.SourceBookingNo || "—"}</span><span className="block text-xs text-muted-foreground truncate max-w-[14rem]">{[r.SourceProjectName, r.SourceUnitName].filter(Boolean).join(" · ")}</span></span> },
  { id: "to", label: "To", cell: (r) => <span className="block py-1.5"><span className="block tabular-nums">{r.TargetBookingNo || "New booking on approval"}</span><span className="block text-xs text-muted-foreground truncate max-w-[14rem]">{[r.TargetProjectName, r.TargetUnitName].filter(Boolean).join(" · ")}</span></span> },
  { id: "progress", label: "Progress", cell: (r) => <span className="block min-w-[15rem] py-1.5"><StepBar steps={changeBar(r)} /></span> },
  { id: "status", label: "Status", cell: (r) => <GridStatusPill status={r.Status} label={statusText(r.Status)} /> },
  { id: "received", label: "Received", align: "right", cell: (r) => <span className="tabular-nums">{r.ClearedAtRequest == null ? "—" : fmt(received(r))}</span> },
  { id: "estimate", label: "New price", align: "right", cell: (r) => <span className="tabular-nums">{fmt(r.TargetEstimateAtRequest)}</span> },
  { id: "raised", label: "Raised", cell: (r) => <span className="tabular-nums">{dt(r.CreatedAt)}</span> },
];

// ── One request ────────────────────────────────────────────────────────────────────────────────────────────────────
function UnitChangeRecord({ id, canEdit, onBack, onWithdraw }: { id: number; canEdit: boolean; onBack: () => void; onWithdraw: (r: any) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const { data: r, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-unit-change", id], staleTime: 15_000, retry: false,
    queryFn: async () => { const res = await fetchWithAuth(`${API}/${id}`); const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error); return d; },
  });
  if (isLoading) return <div className={cn(GRID_CARD, "py-16 text-center text-sm text-muted-foreground")}>Loading…</div>;
  if (isError || !r) return <div className={cn(GRID_CARD, "py-16 text-center text-sm text-destructive")}>{translateError((error as Error)?.message) || "Could not load this unit change."}</div>;

  const refreshAll = () => { refetch(); ["crm-unit-changes", "crm-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  const retry = async () => {
    setRetrying(true);
    try { await putJson(`${API}/${r.Id}/retry`, {}); toast.success("Carried on"); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRetrying(false); refreshAll(); }
  };
  const go = (key: string) => () => document.getElementById(`uc-${key}`)?.scrollIntoView({ block: "start" });
  const addOns = addOnsOf(r);

  let next = ""; let action: { label: string; run: () => void } | null = null; let finished = false;
  if (r.Status === "Pending") { next = `Waiting for approval (Approval Inbox). ${r.TargetUnitName} is held for it; the booking carries on as it is until then.`; action = { label: "Go to Approval", run: go("approval") }; }
  else if (r.Status === "MovingMoney") { next = `New booking ${r.TargetBookingNo} is open. ${fmt(r.MoneyStillToMove)} moves to it once Finance approves Fund Transfer ${r.FundTransferDocNo || ""}.`.replace(/\s+\./, "."); action = r.TargetBookingId ? { label: "Open New Booking", run: () => navigate(`/crm/bookings?view=${r.TargetBookingId}`) } : null; }
  else if (r.Status === "Failed") { next = `Approved, but it stopped part-way: ${r.Note || "see the details"}. Fix the cause, then Retry${r.TargetBookingId ? "" : ", or Withdraw it (nothing has changed yet)"}.`; action = r.canApprove ? { label: retrying ? "Retrying…" : "Retry", run: retry } : null; }
  else if (r.Status === "Completed") { next = `Done: booking ${r.SourceBookingNo} is closed and the sale carries on in ${r.TargetBookingNo}, with ${fmt(r.CreditCarriedAmount)} moved to it.`; action = r.TargetBookingId ? { label: "Open New Booking", run: () => navigate(`/crm/bookings?view=${r.TargetBookingId}`) } : null; finished = true; }
  else if (r.Status === "Rejected" || r.Status === "Withdrawn") { next = `${statusText(r.Status)}${r.Note ? `: ${r.Note}` : ""}. The booking carries on as it was; a new request can be raised.`; finished = true; }

  return (
    <div className="space-y-4">
      <MoneyBand eyebrow={`Unit change · ${r.RequestNo}`} title={<span className="capitalize">{asName(r.CustomerName)}</span>}
        status={<span className="inline-flex items-center h-5 px-2 rounded-full border border-white/30 text-[0.6875rem] font-semibold text-white">{statusText(r.Status)}</span>}
        sub={`${[r.SourceProjectName, r.SourceUnitName].filter(Boolean).join(" · ")} → ${[r.TargetProjectName, r.TargetUnitName].filter(Boolean).join(" · ")}`}
        actions={<>
          <button type="button" onClick={onBack} className={BAND_KEY}><ArrowLeft size={13} /> All Unit Changes</button>
          {r.SourceBookingId && <button type="button" onClick={() => navigate(`/crm/bookings?view=${r.SourceBookingId}`)} className={BAND_KEY}><Home size={13} /> Old Booking</button>}
          {r.TargetBookingId && <button type="button" onClick={() => navigate(`/crm/bookings?view=${r.TargetBookingId}`)} className={BAND_KEY}><Home size={13} /> New Booking</button>}
          {canEdit && (r.Status === "Pending" || (r.Status === "Failed" && !r.TargetBookingId)) && <button type="button" onClick={() => onWithdraw(r)} className={cn(BAND_KEY, "!text-rose-300")}><XCircle size={13} /> Withdraw</button>}
          {r.canApprove && ["Failed", "MovingMoney"].includes(r.Status) && <button type="button" onClick={retry} disabled={retrying} className={BAND_KEY}><RotateCcw size={13} /> Retry</button>}
          <button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
        </>}
        lead={r.ClearedAtRequest == null ? "—" : fmtShort(received(r))} leadNote="Received (moves in full)"
        bar={<StepBar steps={changeBar(r)} onDark />}
        figures={[
          { label: "Old price", value: fmtShort(Number(r.SourceGrandTotalAtRequest || 0)), exact: fmt(r.SourceGrandTotalAtRequest), note: "incl. GST" },
          { label: "New price", dot: BAND_DOT.collected, value: fmtShort(Number(r.TargetEstimateAtRequest || 0)), exact: fmt(r.TargetEstimateAtRequest), note: `${Number(r.RatePerSqFt || 0).toLocaleString("en-IN")}/sq ft · incl. GST` },
          { label: "Moved", dot: BAND_DOT.finance, value: fmtShort(Number(r.CreditCarriedAmount || 0)), exact: fmt(r.CreditCarriedAmount), note: Number(r.MoneyStillToMove) > 0.009 ? `${fmt(r.MoneyStillToMove)} to move` : "" },
          { label: "With Finance", value: fmtShort(Number(r.PendingFinanceAtRequest || 0)), exact: fmt(r.PendingFinanceAtRequest), note: "follows when verified" },
        ]}
        footer={<BandNext text={next} finished={finished} action={action} />} />

      <div id="uc-approval" className="scroll-mt-4">
        <GridRelated icon={ShieldCheck} title="Approval history">
          <div className="px-4 py-3 space-y-3 text-xs">
            {r.Status === "Pending" && <div className="flex flex-wrap items-center gap-2"><ApprovalActions status={r.Status} recordId={r.Id} endpoint={API} module="crm-unit-change" onSuccess={refreshAll} /></div>}
            <ApprovalTrailTimeline table="CrmPropertyChangeRequest" recordId={r.Id} refreshKey={r.UpdatedAt}
              empty={<span className="text-muted-foreground">{r.Status === "Pending" ? "Waiting in the Approval Inbox. No level has acted yet." : "No approval steps recorded."}</span>} />
          </div>
        </GridRelated>
      </div>

      <GridRelated icon={Wallet} title="Money">
        <GridFields fields={[
          { label: "Settled on milestones", value: <span className="tabular-nums">{fmt(r.ClearedAtRequest)}</span> },
          { label: "On account", value: <span className="tabular-nums">{fmt(r.AvailableCreditAtRequest)}</span> },
          { label: "With Finance", value: <span className="tabular-nums">{fmt(r.PendingFinanceAtRequest)} <span className="text-muted-foreground">· moves when Finance verifies it</span></span> },
          { label: "Receipts not sent to Finance", value: <span className="tabular-nums">{fmt(r.PendingCrmReceiptAtRequest)} <span className="text-muted-foreground">· move to the new booking</span></span> },
          { label: "Moved to the new booking", value: <span className="tabular-nums font-semibold">{fmt(r.CreditCarriedAmount)}</span> },
          { label: "Still to move", value: <span className="tabular-nums">{fmt(r.MoneyStillToMove)}{r.FundTransferDocNo ? <span className="text-muted-foreground"> · Fund Transfer {r.FundTransferDocNo}</span> : null}</span> },
        ]} />
      </GridRelated>

      <GridRelated icon={ArrowRightLeft} title="Parking and extra charges">
        {addOns.length === 0 ? <p className="px-4 py-4 text-xs text-muted-foreground">The old booking has no parking or extra charges.</p> : (
          <GridFields fields={addOns.map((a: any) => ({
            label: `${a.kind === "Parking" ? "Parking" : "Extra charge"} · ${a.label}`,
            value: <span className="tabular-nums">{fmt(a.amount)} · {a.keep ? (a.done ? "Moved to the new booking" : "Stays the same") : "Changed: chosen again on the new booking"}</span>,
          }))} />
        )}
      </GridRelated>

      <GridRelated icon={FileText} title="Invoices of the old booking">
        {(r.creditNotes ?? []).length > 0 ? (
          <GridFields fields={(r.creditNotes as any[]).map((n) => ({
            label: `Invoice ${n.AgainstRef}`,
            value: <span className="tabular-nums">{fmt(n.TotalAmount)} · {n.Status === "TimeBarred" ? `past the credit note deadline (${dt(n.DeadlineDate)})` : `credit note ${n.DocNo}`}</span>,
          }))} />
        ) : (r.pendingInvoices ?? []).length > 0 ? (
          <GridFields fields={(r.pendingInvoices as any[]).map((i) => ({
            label: `Invoice ${i.invoiceNo}`,
            value: <span className="tabular-nums">{fmt(i.amount)} · {i.timeBarred ? `past the credit note deadline (${i.deadline})` : "credit note on approval"}</span>,
          }))} />
        ) : <p className="px-4 py-4 text-xs text-muted-foreground">No invoices issued on the old booking.</p>}
      </GridRelated>

      <GridRelated icon={FileText} title="Details">
        <GridFields fields={[
          { label: "Reason", value: r.Reason || "—", wide: true },
          ...(r.Note ? [{ label: r.Status === "Failed" ? "Stopped at" : "Note", value: <span className="whitespace-pre-line">{r.Note}</span>, wide: true }] : []),
          { label: "Old booking", value: <span className="tabular-nums">{r.SourceBookingNo || "—"}</span> },
          { label: "New booking", value: <span className="tabular-nums">{r.TargetBookingNo || "Opens on approval"}</span> },
          { label: "New unit", value: [r.TargetProjectName, r.TargetUnitName].filter(Boolean).join(" · ") || "—" },
          { label: "Payment plan", value: r.PaymentPlanName || "—" },
          { label: "Raised by", value: r.CreatedByName ? `${r.CreatedByName} · ${dt(r.CreatedAt)}` : dt(r.CreatedAt) },
          { label: "Approved by", value: r.ApprovedByName ? `${r.ApprovedByName} · ${dt(r.ApprovedAt)}` : "—" },
        ]} />
      </GridRelated>

      <section className={cn(GRID_CARD, "px-4 py-3 text-xs text-muted-foreground flex gap-2")}>
        <Info size={14} className="shrink-0 mt-0.5 text-primary" />
        <p>No charge is taken on a unit change: every rupee received moves to the new booking. If the new unit costs less, the extra stays on account there as the buyer's credit.</p>
      </section>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export default function CrmUnitChanges() {
  const rights = usePageRights("crm-bookings");
  const qc = useQueryClient();
  const [idParam, setIdParam] = useUrlParam("id");
  const openId = idParam ? Number(idParam) : null;
  const [status, setStatus] = useState("Open");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [withdrawing, setWithdrawing] = useState<any | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [busy, setBusy] = useState(false);
  const search = searchInput.trim();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["crm-unit-changes", status, search, page, pageSize], enabled: openId == null, staleTime: 20_000,
    queryFn: async () => {
      const q = new URLSearchParams({ status, page: String(page), pageSize: String(pageSize) });
      if (search) q.set("search", search);
      const res = await fetchWithAuth(`${API}?${q}`); const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error); return d;
    },
  });
  const [prefs, setPrefs] = useGridPrefs("crm-unit-changes-cols", COLS);
  const counts: Record<string, number> = data?.counts ?? {};
  const openCount = (counts.Pending ?? 0) + (counts.Approved ?? 0) + (counts.MovingMoney ?? 0) + (counts.Failed ?? 0);
  const allCount = Object.values(counts).reduce((n, v) => n + Number(v), 0);
  const tabs = TABS.map((k) => ({ key: k, label: statusText(k), count: data ? (k === "Open" ? openCount : k === "All" ? allCount : counts[k] ?? 0) : null }));
  const doWithdraw = async () => {
    setBusy(true);
    try { await putJson(`${API}/${withdrawing.Id}/withdraw`, { reason: withdrawReason.trim() }); setWithdrawing(null); ["crm-unit-changes", "crm-unit-change", "crm-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
    catch (e: any) { toast.error(translateError(e.message)); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Breadcrumbs items={openId ? ["Dashboard", "CRM", "Unit Changes", "Record"] : ["Dashboard", "CRM", "Unit Changes"]} />
      {openId != null ? (
        <UnitChangeRecord key={openId} id={openId} canEdit={rights.canEdit} onBack={() => setIdParam("")} onWithdraw={(r) => { setWithdrawing(r); setWithdrawReason(""); }} />
      ) : (
        <>
          <MoneyBand eyebrow="CRM · Buyers & Bookings" title="Unit Changes"
            sub="A buyer moving to another unit, in the same project or another one. Raise it from the booking (Change Unit); on approval a new booking opens on the new unit and every rupee received moves to it, with no charge."
            actions={<button type="button" onClick={() => refetch()} disabled={isFetching} className={cn(BAND_KEY, "w-9 !px-0")} title="Refresh" aria-label="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>}
            lead={String(openCount)} leadNote="Open"
            bar={<StepBar steps={[{ label: "Awaiting approval", state: counts.Pending ? "active" : "off" }, { label: "Money on its way", state: counts.MovingMoney ? "active" : "off" }, { label: "Completed", state: counts.Completed ? "done" : "off" }]} onDark />}
            figures={[
              { label: "Awaiting approval", dot: BAND_DOT.finance, value: String(counts.Pending ?? 0), note: "" },
              { label: "Money on its way", value: String(counts.MovingMoney ?? 0), note: "" },
              { label: "Stopped part-way", dot: BAND_DOT.overdue, value: String(counts.Failed ?? 0), note: "", alert: (counts.Failed ?? 0) > 0 },
              { label: "Completed", dot: BAND_DOT.collected, value: String(counts.Completed ?? 0), note: "" },
            ]} />
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs label="Status" tabs={tabs} active={status} onChange={(k) => { setStatus(k); setPage(1); }} />
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
              <GridSearch value={searchInput} onChange={(v) => { setSearchInput(v); setPage(1); }} placeholder="Search customer, booking, unit, request no." />
            </div>
            <CrmGrid cols={COLS} prefs={prefs} onPrefs={setPrefs} rows={data?.rows ?? []} rowKey={(r) => r.Id} noRowNumbers
              loading={isLoading} fetching={isFetching} error={error ? translateError((error as Error).message) : null} onRetry={() => refetch()}
              sort={{ key: "", dir: "desc" }} onSort={() => {}} onRowClick={(r) => setIdParam(String(r.Id))}
              empty={search ? "No unit change matches this search." : "No unit changes here."}
              page={page} pageSize={pageSize} total={data?.total ?? 0} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} />
          </div>
        </>
      )}

      {withdrawing && (
        <GridDialog onClose={() => setWithdrawing(null)} icon={XCircle} width="max-w-xl" title="Withdraw Unit Change" description={`${withdrawing.RequestNo} · ${personName(withdrawing.CustomerName)}`}
          footer={<><button type="button" onClick={() => setWithdrawing(null)} className={GRID_BTN}>Keep It</button><button type="button" onClick={doWithdraw} disabled={busy || !withdrawReason.trim()} className={cn(GRID_BTN_BRAND, "!bg-destructive !border-destructive")}>{busy ? "Withdrawing…" : "Withdraw Request"}</button></>}>
          <p className="mb-3 text-sm text-muted-foreground">The request stays on record as Withdrawn. The new unit's hold is released and the booking carries on as it was.</p>
          <GridFormField label="Why it is withdrawn" required wide>
            <textarea value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} rows={3} autoFocus className={cn(GRID_INPUT, "h-auto py-2 resize-none")} />
          </GridFormField>
        </GridDialog>
      )}
    </div>
  );
}
