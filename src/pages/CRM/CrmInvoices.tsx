import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useAuth } from "@/contexts/AuthContext";
import { Ban, ChevronDown, ChevronRight, ExternalLink, FileText, LayoutGrid, Plus, RefreshCw, Rows3, X } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { SheetShell } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";
import {
  CreditedNote, INVOICE_VOID_ROLES, InvoiceMark, PAGE_SIZE, TYPES, fetchInvoice, fetchInvoiceList, fmtDate, fmtMoney,
  invalidateInvoiceRelatedQueries, type BookingGroup, type InvoiceRow, type InvoiceSummary, type ListFilters,
} from "./invoices/config";
import { InvoicePreviewDialog, VoidInvoiceDialog } from "./invoices/InvoiceDialogs";
import { GenerateInvoiceDialog } from "./invoices/GenerateInvoiceDialog";

const INVOICED_TABS = [
  { value: "", label: "All bookings", key: "all" },
  { value: "none", label: "Not invoiced", key: "none" },
  { value: "partial", label: "Partly invoiced", key: "partial" },
  { value: "full", label: "Fully invoiced", key: "full" },
] as const;
const th = `!px-4 !py-2.5 text-left ${LBL}`;
const td = "!px-4 !py-3";

const CrmInvoices: React.FC = () => {
  const rights = usePageRights("crm-invoices");
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const canVoid = !!currentUser?.role && INVOICE_VOID_ROLES.includes(currentUser.role);
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState<"grouped" | "flat">("grouped");
  const [type, setType] = useState("");
  const [invoicedStatus, setInvoicedStatus] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => { setSearch(v); setPage(1); });
  const [page, setPage] = useState(1);

  const [preview, setPreview] = useState<InvoiceRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<InvoiceRow | null>(null);
  const [genBookingId, setGenBookingId] = useState<number | null | undefined>(undefined); // undefined = closed
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [flatSort, setFlatSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "CreatedAt", dir: "desc" });

  // The Booking page links here with ?bookingId=X to open the Generate dialog on that booking.
  useEffect(() => {
    const bid = searchParams.get("bookingId");
    if (bid) {
      const parsed = parseInt(bid, 10);
      const next = new URLSearchParams(searchParams);
      next.delete("bookingId");
      setSearchParams(next, { replace: true });
      if (parsed > 0 && rights.canCreate) setGenBookingId(parsed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ?invoiceId= stays in the URL while its preview is open, so it can be shared — and is looked up directly
  // (it used to be searched for only in the page already loaded, so a link to an older invoice did nothing).
  const deepId = searchParams.get("invoiceId");
  const { data: deepInvoice, isError: deepError, error: deepErr } = useQuery({
    queryKey: ["crm-invoice", deepId],
    queryFn: () => fetchInvoice(deepId as string),
    enabled: !!deepId && preview?.Id !== Number(deepId),
    retry: false,
  });
  useEffect(() => { if (deepInvoice && preview?.Id !== deepInvoice.Id) setPreview(deepInvoice); }, [deepInvoice]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!deepError) return;
    toast.error((deepErr as Error)?.message || "Invoice not found");
    setSearchParams((sp) => { sp.delete("invoiceId"); return sp; }, { replace: true });
  }, [deepError]); // eslint-disable-line react-hooks/exhaustive-deps
  const openInvoice = (inv: InvoiceRow) => {
    setPreview(inv);
    setSearchParams((sp) => { sp.set("invoiceId", String(inv.Id)); return sp; }, { replace: true });
  };
  const closeInvoice = () => {
    setPreview(null);
    setSearchParams((sp) => { sp.delete("invoiceId"); return sp; }, { replace: true });
  };

  const filters: ListFilters = { type, search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId, invoicedStatus, dateFrom, dateTo };
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-invoices", view, filters, page, flatSort],
    queryFn: () => fetchInvoiceList(view, filters, page, flatSort.key, flatSort.dir),
    placeholderData: (prev) => prev,
  });
  const groups: BookingGroup[] = data?.view === "grouped" ? data.groups : [];
  const flatRows: InvoiceRow[] = data?.view === "flat" ? data.rows : [];
  const total = data?.total || 0;
  const summary: InvoiceSummary | undefined = data?.summary;
  const bk = summary?.bookings;

  const reset = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(1); };
  function toggleFlatSort(key: string) {
    setFlatSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
    setPage(1);
  }
  const toggleCollapsed = (id: number) => setCollapsed((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  function handleGenerated(bookingId: number) {
    setGenBookingId(undefined);
    invalidateInvoiceRelatedQueries(qc, bookingId);
  }
  const hasActiveFilters = !!(type || search || cpb.companyId || cpb.projectId || cpb.blockId || invoicedStatus || dateFrom || dateTo);
  function clearFilters() {
    setType(""); setSearch(""); setSearchInput(""); setCpb({ companyId: "", projectId: "", blockId: "" });
    setInvoicedStatus(""); setDateFrom(""); setDateTo(""); setPage(1);
  }

  const figures = [
    { label: "Invoiced", value: fmtMoney(summary?.liveAmount ?? 0), note: `${summary?.liveCount ?? 0} invoice${summary?.liveCount === 1 ? "" : "s"} in force` },
    { label: "Credited", value: fmtMoney(summary?.credited ?? 0), note: "Taken off by credit notes" },
    { label: "Not invoiced", value: view === "grouped" ? String(bk?.none ?? 0) : "—", note: view === "grouped" ? `of ${bk?.all ?? 0} bookings have no milestone invoiced` : "In the grouped view", onClick: () => { setView("grouped"); reset(setInvoicedStatus)("none"); } },
    { label: "Void", value: String(summary?.voidCount ?? 0), note: "Kept on record, slot freed" },
  ];
  const tabClass = (on: boolean) => `inline-flex items-center gap-2 px-3 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] shrink-0 transition-colors ${on ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"}`;
  const dateInp = "!h-9 !rounded-none !shadow-none border-foreground/40 bg-card !px-2.5 text-xs tabular-nums";

  const actions = (inv: InvoiceRow) => {
    const isVoid = inv.Status === "Void";
    return (
      <div className="inline-flex items-center gap-1.5">
        <button onClick={(e) => { e.stopPropagation(); openInvoice(inv); }} className={`${KEY_LINE} h-8 px-3`}><FileText size={12} /> View</button>
        {!isVoid && canVoid && (
          <button onClick={(e) => { e.stopPropagation(); setVoidTarget(inv); }} className={`${KEY_LINE} h-8 px-3 !text-destructive !border-destructive`}><Ban size={12} /> Void</button>
        )}
      </div>
    );
  };
  const invoiceCell = (inv: InvoiceRow) => (
    <>
      <div className={`font-heading text-xs font-semibold tabular-nums ${inv.Status === "Void" ? "line-through text-muted-foreground" : ""}`}>{inv.InvoiceNo}</div>
      <div className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">{fmtDate(inv.InvoiceDate)}</div>
    </>
  );
  const amountCell = (inv: InvoiceRow) => (
    <>
      <div className={`font-heading font-semibold tabular-nums ${inv.Status === "Void" ? "line-through text-muted-foreground" : ""}`}>{fmtMoney(inv.Amount)}</div>
      <CreditedNote inv={inv} />
    </>
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Invoices"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · Finance"
        title="Invoices"
        subtitle="Every booking's invoices — milestones (the booking amount included), maintenance, other and on-account — and generating them from the payment plan once a demand is raised."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {rights.canCreate && <button onClick={() => setGenBookingId(null)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> Generate invoice</button>}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
              {figures.map((x) => (
                <div key={x.label}>
                  {x.onClick ? <button onClick={x.onClick} className="label link">{x.label}</button> : <span className="label">{x.label}</span>}
                  <p className="figure" style={{ fontSize: "clamp(16px, 1.8vw, 24px)", marginTop: 9 }}>{isLoading && !data ? "…" : x.value}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }} className="tabular-nums">{x.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card" style={{ border: RULE }}>
            <div className="px-5 py-4 space-y-3" style={{ borderBottom: RULE }}>
              <div className="flex flex-wrap items-center gap-2.5">
                {view === "grouped" ? (
                  <div className="inline-flex items-stretch flex-wrap" style={{ border: RULE }}>
                    {INVOICED_TABS.map((t) => (
                      <button key={t.key} onClick={() => reset(setInvoicedStatus)(t.value)} className={tabClass(invoicedStatus === t.value)} style={{ borderRight: RULE_SOFT }}>
                        {t.label} <span className="tabular-nums">{bk ? bk[t.key] : 0}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className={LBL}>Every invoice, newest first — click a heading to sort</span>
                )}
                <div className="ml-auto inline-flex items-stretch" style={{ border: RULE }}>
                  <button onClick={() => { setView("grouped"); setPage(1); }} title="Grouped by booking" className={tabClass(view === "grouped")} style={{ borderRight: RULE_SOFT }}><LayoutGrid size={12} /> By booking</button>
                  <button onClick={() => { setView("flat"); setPage(1); }} title="Every invoice in one sortable table" className={tabClass(view === "flat")}><Rows3 size={12} /> All invoices</button>
                </div>
              </div>
              <div className="flex gap-2.5 flex-wrap items-center">
                <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput.trim()); setPage(1); } }}
                  placeholder="Search invoice no, booking, applicant…"
                  className="h-9 flex-1 min-w-48 border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
                <select value={type} onChange={(e) => reset(setType)(e.target.value)} aria-label="Invoice type"
                  className="h-9 w-36 border border-foreground/40 focus:border-foreground bg-card px-2 text-xs text-foreground outline-none">
                  <option value="">All types</option>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <CrmCompanyProjectBlockFilter value={cpb} onChange={reset(setCpb)} />
                <div className="flex items-center gap-1.5">
                  <div className="w-36"><DateInput value={dateFrom} onChange={(e) => reset(setDateFrom)(e.target.value)} aria-label="Invoiced from" placeholder="Invoiced from" className={dateInp} /></div>
                  <span className="text-xs text-muted-foreground">–</span>
                  <div className="w-36"><DateInput value={dateTo} onChange={(e) => reset(setDateTo)(e.target.value)} aria-label="Invoiced to" placeholder="Invoiced to" className={dateInp} /></div>
                </div>
                {hasActiveFilters && <button onClick={clearFilters} className={`${KEY_LINE} h-9 px-3`}><X size={12} /> Clear</button>}
              </div>
            </div>

            {isError ? (
              <p className="py-12 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : isLoading && !data ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
            ) : view === "grouped" ? (
              groups.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">No booking matches these filters.</p>
              ) : (
                <div className="p-4 space-y-3">
                  {groups.map((g) => {
                    const isCollapsed = collapsed.has(g.BookingId);
                    const live = g.Invoices.filter((i) => i.Status !== "Void");
                    const invoicedTotal = live.reduce((sum, i) => sum + Number(i.Amount || 0), 0);
                    const pct = g.MilestoneTotal ? Math.min(100, Math.round((g.MilestoneInvoiced / g.MilestoneTotal) * 100)) : 0;
                    return (
                      <div key={g.BookingId} className="bg-card" style={{ border: RULE }}>
                        <div role="button" tabIndex={0} onClick={() => toggleCollapsed(g.BookingId)} onKeyDown={(e) => { if (e.key === "Enter") toggleCollapsed(g.BookingId); }}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-primary/5 text-left flex-wrap cursor-pointer transition-colors">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {isCollapsed ? <ChevronRight size={14} className="text-muted-foreground shrink-0" /> : <ChevronDown size={14} className="text-muted-foreground shrink-0" />}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-heading text-sm font-bold tabular-nums">{g.BookingNo}</span>
                                <span className="text-sm font-medium truncate"><ApplicantNames name={g.ApplicantName} bookingId={g.BookingId} /></span>
                              </div>
                              {g.ProjectName && <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{g.ProjectName} · Unit {g.UnitNo}</div>}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 shrink-0 text-xs flex-wrap">
                            <div className="text-right">
                              {g.MilestoneTotal ? (
                                <>
                                  <div className="tabular-nums text-muted-foreground">{g.MilestoneInvoiced} of {g.MilestoneTotal} milestones invoiced</div>
                                  <div className="w-36 h-1.5 mt-1 ml-auto" style={{ border: RULE_SOFT }}><div className="h-full bg-foreground" style={{ width: `${pct}%` }} /></div>
                                </>
                              ) : <div className="text-muted-foreground">No milestone schedule</div>}
                            </div>
                            <div className="text-right tabular-nums">
                              <div className="font-heading font-semibold">{fmtMoney(invoicedTotal)}</div>
                              <div className="mt-0.5 text-[0.6875rem] text-muted-foreground">{live.length} invoice{live.length !== 1 ? "s" : ""}{g.Invoices.length > live.length ? ` · +${g.Invoices.length - live.length} void` : ""}</div>
                            </div>
                            {rights.canCreate && (
                              <button onClick={(e) => { e.stopPropagation(); setGenBookingId(g.BookingId); }} className={`${KEY_LINE} h-8 px-3`}><Plus size={12} /> Add</button>
                            )}
                            <a href={`/crm/bookings?view=${g.BookingId}`} onClick={(e) => e.stopPropagation()} className={`${KEY_LINE} h-8 px-3`}><ExternalLink size={12} /> Booking</a>
                          </div>
                        </div>
                        {!isCollapsed && (
                          g.Invoices.length === 0 ? (
                            <p className="px-4 py-3 text-xs text-muted-foreground" style={{ borderTop: RULE_SOFT }}>No invoices generated yet for this booking.</p>
                          ) : (
                            <div className="overflow-x-auto thin-scroll" style={{ borderTop: RULE_SOFT }}>
                              <table className="w-full text-sm min-w-[640px]">
                                <thead>
                                  <tr style={{ borderBottom: RULE_SOFT }}>
                                    <th className={th}>Invoice</th><th className={th}>Type</th><th className={`${th} !text-right`}>Amount</th>
                                    <th className={th}>State</th><th className={th}>Generated by</th><th className={th} />
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.Invoices.map((inv) => (
                                    <tr key={inv.Id} className="align-top" style={{ borderBottom: RULE_SOFT }}>
                                      <td className={td}>{invoiceCell(inv)}</td>
                                      <td className={`${td} text-xs`}>{inv.InvoiceType}</td>
                                      <td className={`${td} text-right`}>{amountCell(inv)}</td>
                                      <td className={td}><InvoiceMark inv={inv} /></td>
                                      <td className={`${td} text-xs text-muted-foreground`}>{inv.CreatedByName || "—"}</td>
                                      <td className={`${td} text-right`}>{actions(inv)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : flatRows.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No invoice matches these filters.</p>
            ) : (
              <div className="overflow-x-auto thin-scroll">
                <table className="w-full text-sm min-w-[960px]">
                  <thead>
                    <tr style={{ borderBottom: RULE }}>
                      {[
                        { key: "InvoiceNo", label: "Invoice" }, { key: "BookingNo", label: "Booking" }, { key: "ApplicantName", label: "Customer" },
                        { key: "ProjectName", label: "Project · unit" }, { key: "InvoiceType", label: "Type" }, { key: "Amount", label: "Amount", right: true },
                      ].map((col) => (
                        <th key={col.key} onClick={() => toggleFlatSort(col.key)} className={`${th} cursor-pointer select-none hover:text-foreground ${col.right ? "!text-right" : ""}`}>
                          {col.label} {flatSort.key === col.key ? (flatSort.dir === "asc" ? "▲" : "▼") : ""}
                        </th>
                      ))}
                      <th className={th}>State</th><th className={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {flatRows.map((inv) => (
                      <tr key={inv.Id} className="align-top" style={{ borderBottom: RULE_SOFT }}>
                        <td className={td}>{invoiceCell(inv)}</td>
                        <td className={`${td} font-heading text-xs tabular-nums`}>{inv.BookingNo}</td>
                        <td className={`${td} text-xs max-w-[180px] truncate`}><ApplicantNames name={inv.ApplicantName} bookingId={inv.BookingId} /></td>
                        <td className={`${td} text-xs text-muted-foreground max-w-[180px] truncate`}>{inv.ProjectName || "—"} · {inv.UnitNo}</td>
                        <td className={`${td} text-xs`}>{inv.InvoiceType}</td>
                        <td className={`${td} text-right`}>{amountCell(inv)}</td>
                        <td className={td}><InvoiceMark inv={inv} /></td>
                        <td className={`${td} text-right`}>{actions(inv)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!isError && <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>}
          </div>
        </div>

        {preview && <InvoicePreviewDialog invoice={preview} onClose={closeInvoice} />}
        {voidTarget && (
          <VoidInvoiceDialog invoice={voidTarget} onClose={() => setVoidTarget(null)}
            onVoided={() => { const bid = voidTarget.BookingId; setVoidTarget(null); invalidateInvoiceRelatedQueries(qc, bid); }} />
        )}
        {genBookingId !== undefined && (
          <GenerateInvoiceDialog initialBookingId={genBookingId} onClose={() => setGenBookingId(undefined)} onGenerated={handleGenerated} />
        )}
      </SheetShell>
    </>
  );
};

export default CrmInvoices;
