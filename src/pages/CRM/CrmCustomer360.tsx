import { CrmStatus } from "@/constants/crmStatuses";
import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Phone, FileText, Home, MessageSquare, Wrench, ArrowLeft,
  Receipt, Wallet, Users2, ChevronDown, ChevronUp, ChevronRight, User,
  CalendarClock, ExternalLink, Activity,
} from "lucide-react";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import { SheetShell } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "./customers/config";

const API = "/api/crm/customer-360";

const PAGE_SIZE = 20;
interface Customer360Filters { search: string; companyId: string; projectId: string; blockId: string }
async function fetchCustomerList(filters: Customer360Filters, page: number): Promise<{ rows: any[]; total: number }> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (filters.search) params.set("search", filters.search);
  if (filters.companyId) params.set("companyId", filters.companyId);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.blockId) params.set("blockId", filters.blockId);
  // A failed load used to read as "No customers found".
  const r = await fetchWithAuth(`${API}?${params}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `Could not load the customers (${r.status}).`);
  return { rows: data.rows || [], total: data.total || 0 };
}
async function fetchCustomer360(customerId: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${customerId}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || "Could not load this customer's ledger");
  return data;
}

const fmt = (n: number | null | undefined) => (n != null ? fmtRupees(Number(n)) : "—");
const dt = (v: any) => (v ? String(v).slice(0, 10) : "—");
const tag = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em]";

const CustomerTimeline: React.FC<{ data: any }> = ({ data }) => {
  const events: any[] = [];
  (data.calls || []).forEach((c: any) => {
    if (c.CallTime) events.push({ id: `call-${c.Id}`, date: new Date(c.CallTime), type: "Call", title: c.Outcome, desc: c.Remarks, icon: Phone });
  });
  (data.serviceTickets || []).forEach((t: any) => {
    if (t.CreatedAt) events.push({ id: `ticket-${t.Id}`, date: new Date(t.CreatedAt), type: "Ticket", title: `[${t.TicketNo}] ${t.Category}`, desc: t.Subject, icon: Wrench });
  });
  (data.bookings || []).forEach((b: any) => {
    if (b.CreatedAt) events.push({ id: `bk-${b.Id}`, date: new Date(b.CreatedAt), type: "Booking", title: `Booking ${b.BookingNo}`, desc: `${b.ProjectName} · ${b.UnitNo}`, icon: Home });
    (b.receipts || []).forEach((r: any) => {
      if (r.ReceivedDate) events.push({ id: `rc-${r.Id}`, date: new Date(r.ReceivedDate), type: "Receipt", title: `Receipt ${r.ReceiptNo}`, desc: `${fmt(r.Amount)} via ${r.PaymentMode || "transfer"}`, icon: Receipt });
    });
    (b.invoices || []).forEach((i: any) => {
      if (i.InvoiceDate) events.push({ id: `inv-${i.Id}`, date: new Date(i.InvoiceDate), type: "Invoice", title: `Invoice ${i.InvoiceNo}`, desc: `${fmt(i.Amount)} for ${i.InvoiceType}`, icon: FileText });
    });
    if (b.HasCancellation > 0 && b.UpdatedAt) {
      events.push({ id: `cx-${b.Id}`, date: new Date(b.UpdatedAt), type: "Cancellation", title: "Booking cancelled", desc: `Booking ${b.BookingNo} cancelled`, icon: Wrench, red: true });
    }
  });
  events.sort((a, b) => b.date.getTime() - a.date.getTime());

  if (events.length === 0) return <div className="text-sm text-muted-foreground p-4 text-center">No timeline events yet.</div>;
  return (
    <div className="relative ml-3 mt-1 space-y-5 pb-2" style={{ borderLeft: RULE_SOFT }}>
      {events.map((ev) => {
        const Icon = ev.icon;
        return (
          <div key={ev.id} className="relative pl-6">
            <span className={`absolute -left-3 top-0.5 flex h-6 w-6 items-center justify-center bg-card ${ev.red ? "text-destructive" : ""}`}
              style={{ border: ev.red ? "1px solid hsl(var(--destructive))" : RULE }}>
              <Icon size={12} />
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold ${ev.red ? "text-destructive" : ""}`}>{ev.title}</span>
              <span className={`${tag} px-1.5 py-0.5 border border-foreground/25 text-muted-foreground`}>{ev.type}</span>
            </div>
            <span className="block text-xs text-muted-foreground mt-0.5 tabular-nums">{ev.date.toLocaleString("en-IN")}</span>
            {ev.desc && <p className="text-sm mt-1">{ev.desc}</p>}
          </div>
        );
      })}
    </div>
  );
};

const CrmCustomer360: React.FC = () => {
  usePageRights("crm-customer-360");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [expandedBookingId, setExpandedBookingId] = useState<number | null>(null);
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);

  const listFilters: Customer360Filters = useMemo(
    () => ({ search: searchTerm, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [searchTerm, cpb]
  );
  const { data: listResult, isLoading: listLoading, isError: listIsError, error: listError } = useQuery({
    queryKey: ["crm-customer-360-list", listFilters, page],
    queryFn: () => fetchCustomerList(listFilters, page),
    enabled: selectedCustomerId == null,
    staleTime: 30_000,
  });
  const list = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["crm-customer-360", selectedCustomerId],
    queryFn: () => fetchCustomer360(selectedCustomerId as number),
    enabled: selectedCustomerId != null,
    staleTime: 30_000,
    retry: false,
  });

  const toggleBooking = (id: number) => setExpandedBookingId((cur) => (cur === id ? null : id));
  const openCustomer = (customerId: number) => { setSelectedCustomerId(customerId); setExpandedBookingId(null); };
  const runSearch = () => { setSearchTerm(search.trim()); setPage(1); };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Customer 360"]} />
      <SheetShell
        eyebrow="CivilierERP · CRM · After-sales"
        title="Customer 360"
        subtitle="Every customer's journey, lead to after-sales, with their whole ledger: milestones, receipts, invoices, credit notes, on-account deposits and broker settlement."
        action={selectedCustomerId != null
          ? <button onClick={() => setSelectedCustomerId(null)} className={`${KEY_LINE} h-9 px-3`}><ArrowLeft size={13} /> All customers</button>
          : undefined}
      >
      {selectedCustomerId == null ? (
        <div className="bg-card" style={{ border: RULE }}>
          <div className="px-5 py-4 flex gap-2 flex-wrap items-center" style={{ borderBottom: RULE }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Name, mobile or customer no…"
              className="h-9 flex-1 min-w-56 max-w-md border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
            <button onClick={runSearch} className={`${KEY_INK} h-9 px-4`}>Find</button>
            <CrmCompanyProjectBlockFilter value={cpb} onChange={(v) => { setCpb(v); setPage(1); }} />
          </div>
          {listIsError ? (
            <div className="py-16 text-center text-destructive text-sm">{(listError as Error)?.message}</div>
          ) : listLoading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
          ) : list.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">{searchTerm || cpb.projectId ? "No customer matches." : "No customers yet."}</div>
          ) : list.map((c: any) => (
            <button key={c.Id} onClick={() => openCustomer(c.Id)}
              className="w-full text-left flex items-center gap-4 px-5 py-4 hover:bg-primary/5 transition-colors" style={{ borderBottom: RULE_SOFT }}>
              <div className="w-9 h-9 bg-foreground text-card flex items-center justify-center font-heading text-sm font-bold shrink-0">
                {(c.CustomerName || "?").trim().charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{c.CustomerName}</div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">{c.Mobile}</div>
              </div>
              <span className={`${tag} px-2 py-1 border border-foreground/25 text-muted-foreground shrink-0 tabular-nums`}>
                {c.ApplicationCount ?? 0} app{(c.ApplicationCount ?? 0) === 1 ? "" : "s"} · {c.ActiveBookingCount ?? 0} booking{(c.ActiveBookingCount ?? 0) === 1 ? "" : "s"}
              </span>
              <div className="text-right shrink-0 w-36">
                <div className={LBL}>Outstanding</div>
                <div className="mt-1 text-sm font-heading font-semibold tabular-nums">{fmt(c.TotalOutstanding)}</div>
              </div>
              <ChevronRight size={16} className="text-muted-foreground shrink-0" />
            </button>
          ))}
          <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
        </div>
      ) : isLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
      ) : isError || !data ? (
        <div className="py-16 text-center text-destructive text-sm">{(error as Error)?.message || "Could not load this customer's ledger"}</div>
      ) : (
        <div className="space-y-5">
          {data.customer && (
            <div className="bg-card p-4 flex items-start gap-3" style={{ border: RULE }}>
              <div className="w-10 h-10 bg-foreground text-card flex items-center justify-center shrink-0"><User size={18} /></div>
              <div className="min-w-0">
                <span className={`block ${LBL}`}>Customer</span>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h2 className="font-heading font-bold text-lg leading-tight">{data.customer.CustomerName}</h2>
                  <span className="text-xs text-muted-foreground tabular-nums">{data.customer.CustomerNo}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1 tabular-nums">{[data.customer.Mobile, data.customer.AltMobile, data.customer.Email].filter(Boolean).join(" · ")}</div>
                {data.customer.Address && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {data.customer.Address}{[data.customer.City, data.customer.State, data.customer.Pincode].filter(Boolean).length ? ` · ${[data.customer.City, data.customer.State, data.customer.Pincode].filter(Boolean).join(", ")}` : ""}
                  </div>
                )}
              </div>
            </div>
          )}

          {data.summary && (
            <div className="bg-card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6" style={{ border: RULE }}>
              {([
                ["Total invoiced", data.summary.totalInvoiced],
                ["Total paid", data.summary.totalPaid],
                ["Outstanding", data.summary.totalOutstanding],
                ["On-account balance", data.summary.totalOnAccountBalance],
                ["Brokerage paid", data.summary.totalBrokeragePaid],
                ["Brokerage due", data.summary.totalBrokerageDue],
              ] as [string, number][]).map(([l, v]) => (
                <div key={l} className="px-4 py-3" style={{ borderRight: RULE_SOFT, borderBottom: RULE_SOFT }}>
                  <div className={LBL}>{l}</div>
                  <div className="mt-1.5 font-heading font-semibold tabular-nums">{fmt(v)}</div>
                </div>
              ))}
            </div>
          )}

          {data.leads?.length > 0 && (
            <Section icon={Phone} title={`Lead history (${data.leads.length})`}>
              {data.leads.map((l: any) => (
                <Row key={l.Id}>
                  <span className="text-xs text-muted-foreground tabular-nums">{l.LeadUid}</span>
                  <span className="font-medium">{l.Status}</span>
                  <span className="text-xs">{l.Classification || "—"}</span>
                  <span className="text-xs text-muted-foreground">{l.SourceType || "—"}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{dt(l.CreatedAt)}</span>
                </Row>
              ))}
            </Section>
          )}

          {data.applications?.length > 0 && (
            <Section icon={FileText} title={`Applications (${data.applications.length})`}>
              {data.applications.map((a: any) => (
                <Row key={a.Id}>
                  <span className="font-heading text-xs font-semibold tabular-nums">{a.ApplicationNo}</span>
                  <span className="font-medium">{a.Status}</span>
                  <span className="text-xs">{[a.InterestedProject, a.PropertyType, a.BhkPreference].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="text-xs text-muted-foreground">{a.AssigneeName || "—"}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{dt(a.CreatedAt)}</span>
                </Row>
              ))}
            </Section>
          )}

          <Section icon={Activity} title="Timeline">
            <CustomerTimeline data={data} />
          </Section>

          {data.bookings?.length > 0 && (
            <Section icon={Home} title={`Bookings & ledger (${data.bookings.length})`}>
              {data.bookings.map((b: any) => {
                const expanded = expandedBookingId === b.Id;
                const milestones = b.milestones || [];
                const today = new Date();
                const overdueCount = milestones.filter((m: any) => m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < today).length;
                const pendingCount = milestones.filter((m: any) => m.Status !== CrmStatus.PAID && m.Status !== "Waived").length;
                const ledgerCount = (b.receipts?.length || 0) + (b.invoices?.length || 0) + (b.onAccount?.length || 0) + (b.brokerage?.length || 0);
                return (
                  <div key={b.Id} style={{ border: RULE }}>
                    {/* A <button> can't hold the nested Manage payments / Invoices buttons, so the header is a div with
                        the same keyboard behaviour wired on by hand. */}
                    <div role="button" tabIndex={0} onClick={() => toggleBooking(b.Id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleBooking(b.Id); } }}
                      className="w-full text-left p-4 hover:bg-primary/5 transition-colors cursor-pointer">
                      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                        <span className="font-heading text-xs font-semibold tabular-nums">{b.BookingNo}</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`${tag} px-1.5 py-0.5 border border-foreground/40`}>{b.Status}</span>
                          <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/crm/payments?bookingId=${b.Id}`); }} className={`${KEY_LINE} h-7 px-2`}>
                            Manage payments <ExternalLink size={11} />
                          </button>
                          {/* Invoices are made on the booking's own Payment & Invoice tab: this links there. */}
                          <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/crm/bookings?applicationId=${b.ApplicationId}`); }} className={`${KEY_LINE} h-7 px-2`}>
                            Invoices <ExternalLink size={11} />
                          </button>
                          {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                        </div>
                      </div>
                      <div className="text-sm font-semibold">{b.ProjectName || "—"} · {b.UnitNo}</div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3 text-xs">
                        <Fact l="Value" v={<span className="font-heading tabular-nums">{fmt(b.GrandTotal ?? b.TotalValue)}</span>} />
                        <Fact l="Paid" v={<span className="font-heading tabular-nums">{fmt(b.TotalPaid)}</span>} />
                        <Fact l="Balance" v={<span className="font-heading font-semibold tabular-nums">{fmt(b.TotalOutstanding)}</span>} />
                        <Fact l="Agreement" v={b.AgreementStatus || "—"} />
                        <Fact l="Handover" v={b.HandoverStatus || "—"} />
                        <Fact l="Legal" v={b.LegalMilestoneStatus || "—"} />
                        <Fact l="Pre-possession" v={b.PrePossessionStatus || "—"} />
                        {milestones.length > 0 && (
                          <Fact l="Milestones" v={<span className={`tabular-nums ${overdueCount > 0 ? "text-destructive font-semibold" : ""}`}>
                            {milestones.length - pendingCount}/{milestones.length} paid{overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}</span>} />
                        )}
                        {b.NocTotalCount > 0 && <Fact l="NOC" v={<span className="tabular-nums">{b.NocTotalCount - b.NocPendingCount}/{b.NocTotalCount} issued</span>} />}
                        {b.HasCancellation > 0 && <Fact l="Cancellation" v={<span className="text-destructive font-semibold">Pending</span>} />}
                      </div>
                      {!expanded && (
                        <div className="text-[0.6875rem] text-muted-foreground mt-3">
                          {ledgerCount > 0 ? `${ledgerCount} ledger record${ledgerCount === 1 ? "" : "s"} — open to view` : "No ledger records yet"}
                        </div>
                      )}
                    </div>

                    {expanded && (
                      <div className="p-4 space-y-3" style={{ borderTop: RULE_SOFT }}>
                        <LedgerSubSection icon={CalendarClock} title="Payment milestones" rows={milestones} empty="No payment plan on this booking">
                          {(m: any) => {
                            const balance = Number(m.AmountDue || 0) - Number(m.AmountPaid || 0);
                            const overdue = m.Status === CrmStatus.PENDING && m.DueDate && new Date(m.DueDate) < today;
                            return (
                              <Row key={m.Id}>
                                <span className="text-xs font-medium">#{m.MilestoneNo} {m.MilestoneName}</span>
                                <span className="text-xs font-heading tabular-nums">{fmt(m.AmountDue)}{m.Percent != null ? ` (${m.Percent}%)` : ""}</span>
                                <span className="text-xs font-heading tabular-nums">{fmt(m.AmountPaid)} paid</span>
                                <span className={`text-xs font-heading tabular-nums ${balance > 0 ? "font-semibold" : "text-muted-foreground"}`}>{fmt(balance)} due</span>
                                <span className={`text-xs ${overdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                                  {overdue ? "Overdue" : m.Status}{m.DueDate ? ` · ${dt(m.DueDate)}` : ""}
                                </span>
                              </Row>
                            );
                          }}
                        </LedgerSubSection>

                        <LedgerSubSection icon={Receipt} title="Payment receipts" rows={b.receipts} empty="No payments received yet">
                          {(r: any) => (
                            <Row key={r.Id}>
                              <span className="font-heading text-xs font-semibold tabular-nums">{r.ReceiptNo}</span>
                              <span className="text-xs">{r.MilestoneName}</span>
                              <span className="font-heading font-semibold text-xs tabular-nums">{fmt(r.Amount)}</span>
                              <span className="text-xs text-muted-foreground">{r.PaymentMode || "—"}{r.DepositBankName ? ` · ${r.DepositBankName}` : ""}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">{dt(r.ReceivedDate)}</span>
                            </Row>
                          )}
                        </LedgerSubSection>

                        <LedgerSubSection icon={FileText} title="Invoices" rows={b.invoices} empty="No invoices generated yet">
                          {(inv: any) => (
                            <Row key={inv.Id}>
                              <span className="font-heading text-xs font-semibold tabular-nums">{inv.InvoiceNo}</span>
                              <span className="text-xs">{inv.InvoiceType}</span>
                              <span className="font-heading font-semibold text-xs tabular-nums">{fmt(inv.Amount)}</span>
                              <span className="text-xs text-muted-foreground">{inv.Status || "—"}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">{dt(inv.InvoiceDate)}{inv.CreatedByName ? ` · ${inv.CreatedByName}` : ""}</span>
                            </Row>
                          )}
                        </LedgerSubSection>

                        <LedgerSubSection icon={FileText} title="Credit notes" rows={b.creditNotes || []} empty="No credit notes">
                          {(n: any) => (
                            <Row key={`cn-${n.Id}`}>
                              <Link to={`/crm/credit-notes?id=${n.Id}`} className="font-heading text-xs font-semibold tabular-nums underline underline-offset-2">{n.DocNo || (["Draft", "Pending", "Rejected"].includes(n.Status) ? "Awaiting approval" : "Certificate")}</Link>
                              <span className="text-xs">{n.Source === "Adjustment" ? `Invoice reduced${n.ReasonType ? ` · ${n.ReasonType}` : ""}` : n.DocType === "CreditNote" ? "Refund · on invoice" : "Refund · on advance"}</span>
                              <span className="font-heading font-semibold text-xs tabular-nums">{fmt(n.TotalAmount)}</span>
                              <span className={`text-xs text-muted-foreground ${n.Status === "Cancelled" ? "line-through" : ""}`}>{n.Status}{n.AgainstRef ? ` · ${n.AgainstRef}` : ""}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">{dt(n.DocDate)}</span>
                            </Row>
                          )}
                        </LedgerSubSection>

                        <LedgerSubSection icon={Wallet} title="On-account deposits" rows={b.onAccount} empty="No on-account deposits">
                          {(oa: any) => {
                            const balance = Number(oa.Amount || 0) - Number(oa.AppliedAmount || 0);
                            return (
                              <Row key={oa.Id}>
                                <span className="font-heading text-xs font-semibold tabular-nums">{oa.ReceiptNo}</span>
                                <span className="text-xs"><span className="font-heading tabular-nums">{fmt(oa.Amount)}</span> deposited{oa.DepositBankName ? ` · ${oa.DepositBankName}` : ""}</span>
                                <span className="text-xs font-heading tabular-nums">{fmt(oa.AppliedAmount)} applied</span>
                                <span className={`text-xs font-heading tabular-nums ${balance > 0 ? "font-semibold" : "text-muted-foreground"}`}>{fmt(balance)} balance</span>
                                <span className="text-xs text-muted-foreground tabular-nums">{dt(oa.ReceivedDate)}</span>
                              </Row>
                            );
                          }}
                        </LedgerSubSection>

                        <LedgerSubSection icon={Users2} title="Broker settlement" rows={b.brokerage} empty="No broker recorded for this booking">
                          {(br: any) => {
                            const balance = Math.max(0, Number(br.ComputedAmount || 0) - Number(br.TotalPaid || 0));
                            return (
                              <Row key={br.Id}>
                                <span className="text-xs font-medium">{br.BrokerName}{br.BrokerFirm ? ` (${br.BrokerFirm})` : ""}</span>
                                <span className="text-xs tabular-nums">{br.RateType === "Percentage" ? `${br.RateValue}%` : fmt(br.RateValue)}</span>
                                <span className="font-heading font-semibold text-xs tabular-nums">{fmt(br.ComputedAmount)}</span>
                                <span className="text-xs font-heading tabular-nums">{fmt(br.TotalPaid)} paid</span>
                                <span className={`text-xs ${balance > 0 ? "font-semibold" : "text-muted-foreground"}`}><span className="font-heading tabular-nums">{fmt(balance)}</span> due · {br.Status}</span>
                              </Row>
                            );
                          }}
                        </LedgerSubSection>
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>
          )}

          {data.calls?.length > 0 && (
            <Section icon={MessageSquare} title={`Call history (${data.calls.length})`}>
              {data.calls.slice(0, 10).map((c: any) => (
                <Row key={c.Id}>
                  <span className="text-xs text-muted-foreground tabular-nums">{c.CallTime ? String(c.CallTime).slice(0, 16).replace("T", " ") : "—"}</span>
                  <span className="font-medium">{c.Outcome || "—"}</span>
                  <span className="text-xs">{c.Classification || "—"}</span>
                  <span className="text-xs text-muted-foreground truncate col-span-2">{c.Remarks || ""}</span>
                </Row>
              ))}
            </Section>
          )}

          {data.serviceTickets?.length > 0 && (
            <Section icon={Wrench} title={`Service tickets (${data.serviceTickets.length})`}>
              {data.serviceTickets.map((t: any) => (
                <Row key={t.Id}>
                  <span className="font-heading text-xs font-semibold tabular-nums">{t.TicketNo}</span>
                  <span className="font-medium">{t.Category}</span>
                  <span className="text-xs">{t.Subject}</span>
                  <span className="text-xs text-muted-foreground">{t.Priority}</span>
                  <span className="text-xs">{t.Status}</span>
                </Row>
              ))}
            </Section>
          )}
        </div>
      )}
      </SheetShell>
    </>
  );
};

const Fact: React.FC<{ l: string; v: React.ReactNode }> = ({ l, v }) => (
  <div><div className={LBL}>{l}</div><div className="mt-1">{v}</div></div>
);

const Section: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="bg-card" style={{ border: RULE }}>
    <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: RULE }}>
      <Icon size={13} />
      <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]">{title}</h3>
    </div>
    <div className="p-3 space-y-3">{children}</div>
  </div>
);

function LedgerSubSection<T>({ icon: Icon, title, rows, empty, children }: {
  icon: React.ElementType; title: string; rows: T[] | undefined; empty: string; children: (row: T) => React.ReactNode;
}) {
  return (
    <div className="bg-card" style={{ border: RULE_SOFT }}>
      <div className="px-3 py-2 flex items-center gap-1.5" style={{ borderBottom: RULE_SOFT }}>
        <Icon size={12} className="text-muted-foreground" />
        <h4 className={`${LBL} tabular-nums`}>{title}{rows && rows.length > 0 ? ` (${rows.length})` : ""}</h4>
      </div>
      {!rows || rows.length === 0
        ? <div className="text-xs text-muted-foreground text-center py-3">{empty}</div>
        : <div>{rows.map(children)}</div>}
    </div>
  );
}

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 items-center px-3 py-2.5 hover:bg-primary/5 text-sm" style={{ borderBottom: RULE_SOFT }}>
    {children}
  </div>
);

export default CrmCustomer360;
