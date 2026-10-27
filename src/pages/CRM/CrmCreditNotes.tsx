import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { DateInput } from "@/components/ui/date-input";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell } from "@/components/sheet/Sheet";
import { FileDown, Plus, RefreshCw } from "lucide-react";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";
import {
  API, DeadlineNote, KIND, NoteMark, PAGE_SIZE, PERIOD_LABEL, REQ_LABEL, TABS, day, getJson, inr, kindOf, periods,
  type KindCounts, type Tab,
} from "./creditNotes/config";
import { NewCreditNoteDialog } from "./creditNotes/NewCreditNoteDialog";
import { DetailDialog } from "./creditNotes/DetailDialog";
import { exportCreditNotesXlsx } from "./creditNotes/exportXlsx";

const td = "!px-4 !py-3";
const th = `!px-4 !py-2.5 text-left ${LBL}`;

/** Paid refunds that carried GST but have no live credit note: issue (or re-issue) one. */
function PendingList({ pending, isLoading, isError, error, canEdit, onIssued }: {
  pending: any[]; isLoading: boolean; isError: boolean; error: unknown; canEdit: boolean; onIssued: (firstId?: number) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const issue = async (refundId: number, re: boolean) => {
    setBusy(refundId);
    try {
      const out = await getJson(`${API}/${refundId}/gst-notes${re ? "/reissue" : ""}`, { method: "POST" });
      toast.success("Credit note issued");
      onIssued(Array.isArray(out) ? out.find((x: any) => x.Status !== "Cancelled")?.Id : undefined);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  if (isError) return <p className={`${td} text-center text-sm text-destructive`}>{(error as Error)?.message}</p>;
  if (isLoading) return <p className={`${td} text-center text-sm text-muted-foreground`}>Loading paid refunds…</p>;
  if (!pending.length) return <p className="py-12 text-center text-sm text-muted-foreground">Every paid refund that carried GST has its credit note.</p>;
  return (
    <>
      <p className="px-4 py-3 text-xs text-muted-foreground" style={{ borderBottom: RULE_SOFT }}>
        Paid refunds on bookings charged GST, without a live credit note — paid before credit notes existed, or their credit note was cancelled.
      </p>
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr style={{ borderBottom: RULE }}>
              <th className={th}>Customer · property</th><th className={th}>Refund</th><th className={`${th} !text-right`}>Paid</th><th className={th} />
            </tr>
          </thead>
          <tbody>
            {pending.map((r) => (
              <tr key={r.RefundId} className="align-top" style={{ borderBottom: RULE_SOFT }}>
                <td className={td}>
                  <div className="text-xs font-medium">{r.CustomerName}</div>
                  <div className="mt-1 text-[0.6875rem] text-muted-foreground">{r.Property}{r.ProjectName ? ` · ${r.ProjectName}` : ""}</div>
                </td>
                <td className={td}>
                  <div className="font-heading text-xs tabular-nums">{r.RefundNo}</div>
                  <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">paid {day(r.PaidAt)} · {r.SourceType}{r.CancelledCount ? " · earlier credit note cancelled" : ""}</div>
                </td>
                <td className={`${td} text-right font-heading font-semibold tabular-nums`}>{inr(r.NetAmount)}</td>
                <td className={`${td} text-right`}>
                  {canEdit && (
                    <button onClick={() => issue(r.RefundId, !!r.CancelledCount)} disabled={busy === r.RefundId} className={`${KEY_INK} h-8 px-3`}>
                      {busy === r.RefundId ? "Issuing…" : r.CancelledCount ? "Re-issue" : "Issue credit note"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const CrmCreditNotes: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-refunds");
  const [sp, setSp] = useSearchParams();

  const [selectedId, setSelectedId] = useState<number | null>(sp.get("id") ? Number(sp.get("id")) : null);
  const [tab, setTab] = useState<Tab>("all");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState("fy");
  const P = periods();
  const [custom, setCustom] = useState<[string, string]>(P.month);
  const [from, to] = period === "custom" ? custom : P[period];
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });
  const [creating, setCreating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });

  // One page of the documents, with the counts per kind for the same filters (the tabs and figures).
  const { data: listResponse, isLoading, isError, error, isFetching, refetch } = useQuery<{ rows: any[]; total: number; kindCounts?: KindCounts }>({
    queryKey: ["crm-gst-notes", from, to, tab === "pending" ? "all" : tab, page, search, cpb.companyId, cpb.projectId, cpb.blockId],
    queryFn: async () => {
      const q = new URLSearchParams({ from, to, page: String(page), pageSize: String(PAGE_SIZE) });
      if (tab !== "all" && tab !== "pending") q.set("status", tab);
      if (search.trim()) q.set("search", search.trim());
      if (cpb.companyId) q.set("companyId", cpb.companyId);
      if (cpb.projectId) q.set("projectId", cpb.projectId);
      if (cpb.blockId) q.set("blockId", cpb.blockId);
      const res = await getJson(`${API}/gst-notes?${q.toString()}`);
      return Array.isArray(res) ? { rows: res, total: res.length } : res;
    },
    placeholderData: (prev) => prev,
  });
  const rows = listResponse?.rows || [];
  const total = listResponse?.total || 0;
  const kc = listResponse?.kindCounts || {};

  const pendingQ = useQuery<any[]>({ queryKey: ["crm-credit-notes-pending"], queryFn: () => getJson(`${API}/gst-notes/pending`) });
  const pending = pendingQ.data ?? [];

  const reload = () => {
    for (const k of ["crm-gst-notes", "crm-credit-notes-pending", "crm-credit-note"]) qc.invalidateQueries({ queryKey: [k] });
  };

  // ?refundId= opens that refund's first live credit note
  const refundParam = sp.get("refundId");
  const { data: refundNotes } = useQuery<any[]>({
    queryKey: ["crm-refund-gst-notes", refundParam],
    queryFn: () => getJson(`${API}/${refundParam}/gst-notes`),
    enabled: !!refundParam,
  });
  useEffect(() => {
    if (!refundParam || !refundNotes) return;
    const first = refundNotes.find((x: any) => x.Status !== "Cancelled") || refundNotes[0];
    setSp((p) => { p.delete("refundId"); if (first) p.set("id", String(first.Id)); return p; }, { replace: true });
    if (first) setSelectedId(first.Id);
    else setTab("pending");
  }, [refundParam, refundNotes, setSp]);

  const k = (x: keyof KindCounts) => kc[x] ?? { count: 0, gst: 0, dueSoon: 0 };
  const allCount = Object.values(kc).reduce((s, x) => s + (x?.count ?? 0), 0);
  const dueSoon = k("invoice").dueSoon;
  const goTab = (t: Tab) => { setTab(t); setPage(1); };

  const exportXlsx = async () => {
    setExporting(true);
    try { await exportCreditNotesXlsx(from, to, cpb); }
    catch (e: any) { toast.error(e.message || "Couldn't make the Excel"); }
    finally { setExporting(false); }
  };

  const figures = [
    { label: "On invoices", value: inr(k("invoice").gst), note: `GST reduced · ${k("invoice").count} note${k("invoice").count === 1 ? "" : "s"}${dueSoon ? ` · ${dueSoon} due in 30 days` : ""}`, tab: "invoice" as Tab },
    { label: "On advances", value: inr(k("advance").gst), note: `GST on advances refunded · ${k("advance").count} voucher${k("advance").count === 1 ? "" : "s"}`, tab: "advance" as Tab },
    { label: "Past deadline", value: inr(k("barred").gst), note: `${k("barred").count} GST-paid certificate${k("barred").count === 1 ? "" : "s"} for the buyer`, tab: "barred" as Tab },
    { label: "To issue", value: String(pending.length), note: pending.length ? "paid refunds waiting for a credit note" : "all issued", tab: "pending" as Tab, red: pending.length > 0 },
  ];
  const tabCount = (t: Tab) => (t === "pending" ? pending.length : t === "all" ? allCount : k(t as keyof KindCounts).count);
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const dateInp = "!h-9 !rounded-none !shadow-none border-foreground/40 bg-card !px-2.5 text-xs tabular-nums";

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Credit Notes"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Credit Notes"
        subtitle="The GST documents for money given back: credit notes on invoices, refund vouchers on advances, and GST-paid certificates past the deadline — with the Excel for the GST return."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => { refetch(); pendingQ.refetch(); }} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            <button onClick={exportXlsx} disabled={exporting || !allCount} className={`${KEY_LINE} h-9 px-4`}><FileDown size={13} /> {exporting ? "Preparing…" : "Excel for GST return"}</button>
            {rights.canCreate && <button onClick={() => setCreating(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New credit note</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  <button onClick={() => goTab(x.tab)} className="label link">{x.label}</button>
                  <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9, color: x.red ? "var(--red)" : undefined }}>{isLoading && !listResponse ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                  {Object.keys(PERIOD_LABEL).map((p) => (
                    <button key={p} onClick={() => { setPeriod(p); setPage(1); }} className={tabClass(period === p)} style={{ borderRight: RULE_SOFT }}>{PERIOD_LABEL[p]}</button>
                  ))}
                </div>
                {period === "custom" && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-36"><DateInput value={custom[0]} onChange={(e) => { setCustom([e.target.value, custom[1]]); setPage(1); }} aria-label="From" className={dateInp} /></div>
                    <span className="text-xs text-muted-foreground">–</span>
                    <div className="w-36"><DateInput value={custom[1]} onChange={(e) => { setCustom([custom[0], e.target.value]); setPage(1); }} aria-label="To" className={dateInp} /></div>
                  </div>
                )}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{day(from)} – {day(to)}</span>
              </div>
              <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                {TABS.map(([t, l]) => {
                  const n = tabCount(t);
                  if (t === "request" && !n && tab !== "request") return null;
                  return (
                    <button key={t} onClick={() => goTab(t)} style={{ borderRight: RULE_SOFT }}
                      className={`${tabClass(tab === t)} ${t === "pending" && n > 0 && tab !== t ? "!text-destructive" : ""}`}>
                      {l} <span className="tabular-nums">{n}</span>
                    </button>
                  );
                })}
              </div>
              {tab !== "pending" && (
                <div className="flex gap-2.5 flex-wrap items-center">
                  <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput.trim()); setPage(1); } }}
                    placeholder="Search doc no, customer, property, booking, refund, invoice…"
                    className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                  <CrmCompanyProjectBlockFilter value={cpb} onChange={(v) => { setCpb(v); setPage(1); }} />
                </div>
              )}
            </div>

            {tab === "pending" ? (
              <PendingList pending={pending} isLoading={pendingQ.isLoading} isError={pendingQ.isError} error={pendingQ.error} canEdit={rights.canEdit}
                onIssued={(id) => { reload(); if (id) { setTab("all"); setSelectedId(id); } }} />
            ) : (
              <>
                <div className="overflow-x-auto thin-scroll">
                  <table className="w-full text-sm min-w-[1080px]">
                    <thead>
                      <tr style={{ borderBottom: RULE }}>
                        <th className={th}>Document</th><th className={th}>Type</th><th className={th}>Customer · property</th><th className={th}>Against</th>
                        <th className={`${th} !text-right`}>Taxable</th><th className={`${th} !text-right`}>GST</th><th className={`${th} !text-right`}>Total</th><th className={th}>State</th>
                      </tr>
                    </thead>
                    <tbody>
                      {isError ? (
                        <tr><td colSpan={8} className={`${td} text-center text-destructive`}>{(error as Error)?.message}</td></tr>
                      ) : isLoading && !listResponse ? (
                        <tr><td colSpan={8} className={`${td} text-center text-muted-foreground`}>Loading…</td></tr>
                      ) : rows.length === 0 ? (
                        <tr><td colSpan={8} className={`${td} text-center text-muted-foreground`}>No credit notes for this period and these filters.</td></tr>
                      ) : rows.map((n: any) => {
                        const kind = kindOf(n);
                        const dead = kind === "cancelled";
                        return (
                          <tr key={n.Id} onClick={() => setSelectedId(n.Id)} className={`align-top cursor-pointer hover:bg-primary/5 transition-colors ${dead ? "text-muted-foreground" : ""}`}
                            style={{ borderBottom: RULE_SOFT, boxShadow: n.CancelApprovalStatus === "Pending" ? "inset 3px 0 0 hsl(var(--destructive))" : undefined }}>
                            <td className={td}>
                              <div className={`font-heading text-xs font-semibold tabular-nums ${dead ? "line-through" : "text-foreground"}`}>{n.DocNo || (kind === "request" ? REQ_LABEL[n.Status] : "Certificate")}</div>
                              <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{day(n.DocDate)}</div>
                              {n.CancelApprovalStatus === "Pending" && <div className="mt-1 text-[0.6875rem] font-semibold text-destructive">Cancellation asked</div>}
                            </td>
                            <td className={`${td} text-xs whitespace-nowrap`}>{KIND[kind].short}</td>
                            <td className={`${td} max-w-[240px]`}>
                              <div className="text-xs font-medium truncate text-foreground">{n.CustomerName || "—"}</div>
                              <div className="mt-1 text-[0.6875rem] text-muted-foreground truncate">{n.Property} · <span className="font-heading tabular-nums">{n.BookingNo}</span>{n.ProjectName ? ` · ${n.ProjectName}` : ""}</div>
                            </td>
                            <td className={td}>
                              <div className="font-heading text-xs tabular-nums truncate max-w-[160px]">{n.AgainstRef || n.RefundNo || "—"}</div>
                              {n.AgainstDate && <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{day(n.AgainstDate)}</div>}
                            </td>
                            <td className={`${td} text-right font-heading tabular-nums text-xs`}>{inr(n.TaxableValue)}</td>
                            <td className={`${td} text-right`}>
                              <div className="font-heading tabular-nums text-xs">{inr(n.GstAmount)}</div>
                              {n.GstRate != null && <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{Number(n.GstRate)}%</div>}
                            </td>
                            <td className={`${td} text-right font-heading font-semibold tabular-nums ${dead ? "" : "text-foreground"}`}>{inr(n.TotalAmount)}</td>
                            <td className={td}><NoteMark n={n} /><DeadlineNote n={n} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
              </>
            )}
          </div>
        </div>

        {selectedId && (
          <DetailDialog key={selectedId} id={selectedId} canEdit={rights.canEdit} onClose={() => { setSelectedId(null); setSp((p) => { p.delete("id"); return p; }, { replace: true }); }}
            onChanged={reload} onOpen={(nid) => { setSelectedId(nid); setSp((p) => { p.set("id", String(nid)); return p; }, { replace: true }); }} />
        )}
        {creating && (
          <NewCreditNoteDialog
            onClose={() => setCreating(false)}
            onCreated={(nid) => { setCreating(false); reload(); setTab("all"); setSelectedId(nid); }}
          />
        )}
      </SheetShell>
    </>
  );
};

export default CrmCreditNotes;
