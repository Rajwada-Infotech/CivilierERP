import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  Search, Phone, FileText, Home, MessageSquare, Wrench, ArrowLeft,
  IndianRupee, Receipt, Wallet, Users2, ChevronDown, ChevronUp, ChevronRight, User,
  CalendarClock, ExternalLink,
} from "lucide-react";

const API = "/api/crm/customer-360";

async function fetchCustomerList(search: string): Promise<any[]> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  const r = await fetchWithAuth(`${API}?${params}`);
  if (!r.ok) return [];
  return r.json();
}
async function fetchCustomer360(mobile: string): Promise<any> {
  if (!mobile) return null;
  const r = await fetchWithAuth(`${API}/${mobile}`);
  if (!r.ok) return null;
  return r.json();
}

const fmt = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";
const dt = (v: any) => v ? String(v).slice(0, 10) : "—";

const CrmCustomer360: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMobile, setSelectedMobile] = useState<string | null>(null);
  const [expandedBookingId, setExpandedBookingId] = useState<number | null>(null);

  const { data: list = [], isLoading: listLoading } = useQuery({
    queryKey: ["crm-customer-360-list", searchTerm],
    queryFn: () => fetchCustomerList(searchTerm),
    enabled: !selectedMobile,
    staleTime: 30_000,
  });

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm-customer-360", selectedMobile],
    queryFn: () => fetchCustomer360(selectedMobile as string),
    enabled: !!selectedMobile,
    staleTime: 30_000,
  });

  const toggleBooking = (id: number) => setExpandedBookingId((cur) => (cur === id ? null : id));
  const openCustomer = (mobile: string) => { setSelectedMobile(mobile); setExpandedBookingId(null); };
  const backToList = () => setSelectedMobile(null);

  return (
    <SalesAutoShell title="CRM — Applicant Ledger" subtitle="Full customer journey and centralized financial ledger — lead to after-sales, in one view">
      {!selectedMobile ? (
        <>
          <div className="flex gap-2 max-w-md">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setSearchTerm(search.trim())}
                placeholder="Filter by name, mobile, or customer no..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
            </div>
            <button onClick={() => setSearchTerm(search.trim())}
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
              Filter
            </button>
          </div>

          {listLoading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Loading...</div>
          ) : list.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground text-sm">No customers found</div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden divide-y divide-border">
              {list.map((c: any) => (
                <button key={c.Id} onClick={() => openCustomer(c.Mobile)}
                  className="w-full text-left flex items-center gap-3 px-5 py-4 hover:bg-muted/20 transition-colors">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                    {(c.CustomerName || "?").trim().charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{c.CustomerName}</div>
                    <div className="text-xs text-muted-foreground">{c.Mobile}</div>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full border border-border bg-muted/30 text-muted-foreground shrink-0">
                    {c.ApplicationCount ?? 0} app{(c.ApplicationCount ?? 0) === 1 ? "" : "s"} · {c.ActiveBookingCount ?? 0} booking{(c.ActiveBookingCount ?? 0) === 1 ? "" : "s"}
                  </span>
                  <div className="text-right shrink-0 w-28">
                    <div className="text-xs text-muted-foreground">Outstanding</div>
                    <div className="text-sm font-semibold text-orange-600">{fmt(c.TotalOutstanding)}</div>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button onClick={backToList} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={14} /> Back to customer list
          </button>

          {isLoading ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Loading...</div>
          ) : isError || !data ? (
            <div className="py-16 text-center text-muted-foreground text-sm">Could not load this customer's ledger</div>
          ) : (
            <div className="space-y-5">
              {data.customer && (
                <div className="rounded-xl border border-border p-4 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0"><User size={18} /></div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold">{data.customer.CustomerName}</h2>
                      <span className="font-mono text-xs text-muted-foreground">{data.customer.CustomerNo}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {[data.customer.Mobile, data.customer.AltMobile, data.customer.Email].filter(Boolean).join(" · ")}
                    </div>
                    {data.customer.Address && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {data.customer.Address}{[data.customer.City, data.customer.State, data.customer.Pincode].filter(Boolean).length ? ` · ${[data.customer.City, data.customer.State, data.customer.Pincode].filter(Boolean).join(", ")}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {data.summary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <SummaryTile label="Total Invoiced" value={fmt(data.summary.totalInvoiced)} />
                  <SummaryTile label="Total Paid" value={fmt(data.summary.totalPaid)} tone="green" />
                  <SummaryTile label="Outstanding" value={fmt(data.summary.totalOutstanding)} tone="orange" />
                  <SummaryTile label="On-Account Balance" value={fmt(data.summary.totalOnAccountBalance)} tone="sky" />
                  <SummaryTile label="Brokerage Paid" value={fmt(data.summary.totalBrokeragePaid)} tone="green" />
                  <SummaryTile label="Brokerage Due" value={fmt(data.summary.totalBrokerageDue)} tone="orange" />
                </div>
              )}

              {data.leads?.length > 0 && (
                <Section icon={Phone} title={`Lead History (${data.leads.length})`}>
                  {data.leads.map((l: any) => (
                    <Row key={l.Id}>
                      <span className="font-mono text-xs text-muted-foreground">{l.LeadUid}</span>
                      <span className="font-medium">{l.Status}</span>
                      <span className="text-xs">{l.Classification || "—"}</span>
                      <span className="text-xs text-muted-foreground">{l.SourceType || "—"}</span>
                      <span className="text-xs text-muted-foreground">{dt(l.CreatedAt)}</span>
                    </Row>
                  ))}
                </Section>
              )}

              {data.applications?.length > 0 && (
                <Section icon={FileText} title={`Applications (${data.applications.length})`}>
                  {data.applications.map((a: any) => (
                    <Row key={a.Id}>
                      <span className="font-mono text-xs text-primary">{a.ApplicationNo}</span>
                      <span className="font-medium">{a.Status}</span>
                      <span className="text-xs">{[a.InterestedProject, a.PropertyType, a.BhkPreference].filter(Boolean).join(" · ") || "—"}</span>
                      <span className="text-xs text-muted-foreground">{a.AssigneeName || "—"}</span>
                      <span className="text-xs text-muted-foreground">{dt(a.CreatedAt)}</span>
                    </Row>
                  ))}
                </Section>
              )}

              {data.bookings?.length > 0 && (
                <Section icon={Home} title={`Bookings & Ledger (${data.bookings.length})`}>
                  {data.bookings.map((b: any) => {
                    const expanded = expandedBookingId === b.Id;
                    const milestones = b.milestones || [];
                    const today = new Date();
                    const overdueCount = milestones.filter((m: any) => m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < today).length;
                    const pendingCount = milestones.filter((m: any) => m.Status !== "Paid" && m.Status !== "Waived").length;
                    const ledgerCount = (b.receipts?.length || 0) + (b.invoices?.length || 0) + (b.onAccount?.length || 0) + (b.brokerage?.length || 0);
                    return (
                      <div key={b.Id} className="rounded-lg border border-border overflow-hidden">
                        {/* A native <button> can't legally contain the nested
                            "Manage Payments" <button> below (invalid HTML —
                            browsers/React don't reconcile a button-in-button
                            the way stopPropagation alone would suggest), so
                            this card header is a div with the same keyboard
                            semantics wired on by hand. */}
                        <div role="button" tabIndex={0} onClick={() => toggleBooking(b.Id)}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleBooking(b.Id); } }}
                          className="w-full text-left p-3 hover:bg-muted/20 transition-colors cursor-pointer">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-mono text-xs font-semibold text-primary">{b.BookingNo}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-muted/40">{b.Status}</span>
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/crm/payments?bookingId=${b.Id}`); }}
                                className="flex items-center gap-1 text-xs text-primary hover:underline">
                                Manage Payments <ExternalLink size={11} />
                              </button>
                              {/* Invoices are generated on the Booking Detail's own
                                  Payment & Invoice tab (Booking is auto-generated;
                                  every milestone-wise invoice after that is manual but
                                  synced to the real paid amount) — this deep-links
                                  there instead of duplicating that dialog here. */}
                              <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/crm/bookings?applicationId=${b.ApplicationId}`); }}
                                className="flex items-center gap-1 text-xs text-primary hover:underline">
                                Invoices <ExternalLink size={11} />
                              </button>
                              {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                            </div>
                          </div>
                          <div className="text-sm font-medium">{b.ProjectName || "—"} · {b.UnitNo}</div>
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2 text-xs">
                            <div><span className="text-muted-foreground">Value: </span>{fmt(b.GrandTotal ?? b.TotalValue)}</div>
                            <div><span className="text-muted-foreground">Paid: </span><span className="text-green-600 font-medium">{fmt(b.TotalPaid)}</span></div>
                            <div><span className="text-muted-foreground">Balance: </span><span className="text-orange-600 font-medium">{fmt(b.TotalOutstanding)}</span></div>
                            <div><span className="text-muted-foreground">Agreement: </span>{b.AgreementStatus || "—"}</div>
                            <div><span className="text-muted-foreground">Handover: </span>{b.HandoverStatus || "—"}</div>
                            <div><span className="text-muted-foreground">Legal: </span>{b.LegalMilestoneStatus || "—"}</div>
                            <div><span className="text-muted-foreground">Pre-Possession: </span>{b.PrePossessionStatus || "—"}</div>
                            {milestones.length > 0 && (
                              <div>
                                <span className="text-muted-foreground">Milestones: </span>
                                <span className={overdueCount > 0 ? "text-red-600 font-medium" : pendingCount > 0 ? "text-orange-600 font-medium" : "text-green-600 font-medium"}>
                                  {milestones.length - pendingCount}/{milestones.length} paid{overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
                                </span>
                              </div>
                            )}
                            {b.NocTotalCount > 0 && (
                              <div>
                                <span className="text-muted-foreground">NOC: </span>
                                <span className={b.NocPendingCount > 0 ? "text-orange-600 font-medium" : "text-green-600 font-medium"}>
                                  {b.NocTotalCount - b.NocPendingCount}/{b.NocTotalCount} issued
                                </span>
                              </div>
                            )}
                            {b.HasCancellation > 0 && <div className="text-red-600 font-medium">Cancellation pending</div>}
                          </div>
                          {!expanded && (
                            <div className="text-[11px] text-muted-foreground mt-1.5">
                              {ledgerCount > 0 ? `${ledgerCount} ledger record${ledgerCount === 1 ? "" : "s"} — click to view` : "No ledger records yet"}
                            </div>
                          )}
                        </div>

                        {expanded && (
                          <div className="border-t border-border bg-muted/10 p-3 space-y-3">
                            <LedgerSubSection icon={CalendarClock} title="Payment Milestones" rows={milestones} empty="No payment plan on this booking">
                              {(m: any) => {
                                const balance = Number(m.AmountDue || 0) - Number(m.AmountPaid || 0);
                                const overdue = m.Status === "Pending" && m.DueDate && new Date(m.DueDate) < today;
                                return (
                                  <Row key={m.Id}>
                                    <span className="text-xs font-medium">#{m.MilestoneNo} {m.MilestoneName}</span>
                                    <span className="text-xs">{fmt(m.AmountDue)}{m.Percent != null ? ` (${m.Percent}%)` : ""}</span>
                                    <span className="text-xs text-green-600">{fmt(m.AmountPaid)} paid</span>
                                    <span className={`text-xs font-medium ${balance > 0 ? "text-orange-600" : "text-muted-foreground"}`}>{fmt(balance)} due</span>
                                    <span className={`text-xs font-medium ${m.Status === "Paid" ? "text-green-600" : overdue ? "text-red-600" : "text-muted-foreground"}`}>
                                      {overdue ? "Overdue" : m.Status}{m.DueDate ? ` · ${dt(m.DueDate)}` : ""}
                                    </span>
                                  </Row>
                                );
                              }}
                            </LedgerSubSection>

                            <LedgerSubSection icon={Receipt} title="Payment Receipts" rows={b.receipts} empty="No payments received yet">
                              {(r: any) => (
                                <Row key={r.Id}>
                                  <span className="font-mono text-xs text-primary">{r.ReceiptNo}</span>
                                  <span className="text-xs">{r.MilestoneName}</span>
                                  <span className="font-semibold text-xs">{fmt(r.Amount)}</span>
                                  <span className="text-xs text-muted-foreground">{r.PaymentMode || "—"}{r.DepositBankName ? ` · ${r.DepositBankName}` : ""}</span>
                                  <span className="text-xs text-muted-foreground">{dt(r.ReceivedDate)}</span>
                                </Row>
                              )}
                            </LedgerSubSection>

                            <LedgerSubSection icon={FileText} title="Invoices" rows={b.invoices} empty="No invoices generated yet">
                              {(inv: any) => (
                                <Row key={inv.Id}>
                                  <span className="font-mono text-xs text-primary">{inv.InvoiceNo}</span>
                                  <span className="text-xs">{inv.InvoiceType}</span>
                                  <span className="font-semibold text-xs">{fmt(inv.Amount)}</span>
                                  <span className="text-xs text-muted-foreground">{inv.Status || "—"}</span>
                                  <span className="text-xs text-muted-foreground">{dt(inv.InvoiceDate)}{inv.CreatedByName ? ` · ${inv.CreatedByName}` : ""}</span>
                                </Row>
                              )}
                            </LedgerSubSection>

                            <LedgerSubSection icon={Wallet} title="On-Account Deposits" rows={b.onAccount} empty="No on-account deposits">
                              {(oa: any) => {
                                const balance = Number(oa.Amount || 0) - Number(oa.AppliedAmount || 0);
                                return (
                                  <Row key={oa.Id}>
                                    <span className="font-mono text-xs text-primary">{oa.ReceiptNo}</span>
                                    <span className="text-xs">{fmt(oa.Amount)} deposited{oa.DepositBankName ? ` · ${oa.DepositBankName}` : ""}</span>
                                    <span className="text-xs">{fmt(oa.AppliedAmount)} applied</span>
                                    <span className={`text-xs font-medium ${balance > 0 ? "text-sky-600" : "text-muted-foreground"}`}>{fmt(balance)} balance</span>
                                    <span className="text-xs text-muted-foreground">{dt(oa.ReceivedDate)}</span>
                                  </Row>
                                );
                              }}
                            </LedgerSubSection>

                            <LedgerSubSection icon={Users2} title="Broker Settlement" rows={b.brokerage} empty="No broker recorded for this booking">
                              {(br: any) => {
                                const balance = Math.max(0, Number(br.ComputedAmount || 0) - Number(br.TotalPaid || 0));
                                return (
                                  <Row key={br.Id}>
                                    <span className="text-xs font-medium">{br.BrokerName}{br.BrokerFirm ? ` (${br.BrokerFirm})` : ""}</span>
                                    <span className="text-xs">{br.RateType === "Percentage" ? `${br.RateValue}%` : fmt(br.RateValue)}</span>
                                    <span className="font-semibold text-xs">{fmt(br.ComputedAmount)}</span>
                                    <span className="text-xs text-green-600">{fmt(br.TotalPaid)} paid</span>
                                    <span className={`text-xs font-medium ${balance > 0 ? "text-orange-600" : "text-muted-foreground"}`}>{fmt(balance)} due · {br.Status}</span>
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
                <Section icon={MessageSquare} title={`Call History (${data.calls.length})`}>
                  {data.calls.slice(0, 10).map((c: any) => (
                    <Row key={c.Id}>
                      <span className="text-xs text-muted-foreground">{c.CallTime ? String(c.CallTime).slice(0, 16).replace("T", " ") : "—"}</span>
                      <span className="font-medium">{c.Outcome || "—"}</span>
                      <span className="text-xs">{c.Classification || "—"}</span>
                      <span className="text-xs text-muted-foreground truncate col-span-2">{c.Remarks || ""}</span>
                    </Row>
                  ))}
                </Section>
              )}

              {data.serviceTickets?.length > 0 && (
                <Section icon={Wrench} title={`Service / Work Tickets (${data.serviceTickets.length})`}>
                  {data.serviceTickets.map((t: any) => (
                    <Row key={t.Id}>
                      <span className="font-mono text-xs text-primary">{t.TicketNo}</span>
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
        </>
      )}
    </SalesAutoShell>
  );
};

const TONE_CLASSES: Record<string, string> = {
  default: "text-foreground",
  green: "text-green-600",
  orange: "text-orange-600",
  sky: "text-sky-600",
};

const SummaryTile: React.FC<{ label: string; value: string; tone?: keyof typeof TONE_CLASSES }> = ({ label, value, tone = "default" }) => (
  <div className="rounded-xl border border-border p-3">
    <div className="text-[11px] text-muted-foreground flex items-center gap-1"><IndianRupee size={11} /> {label}</div>
    <div className={`text-sm font-semibold mt-0.5 ${TONE_CLASSES[tone]}`}>{value}</div>
  </div>
);

const Section: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="rounded-xl border border-border overflow-hidden">
    <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center gap-2">
      <Icon size={14} className="text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
    <div className="p-3 space-y-2">{children}</div>
  </div>
);

function LedgerSubSection<T>({ icon: Icon, title, rows, empty, children }: {
  icon: React.ElementType; title: string; rows: T[] | undefined; empty: string; children: (row: T) => React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card overflow-hidden">
      <div className="px-3 py-1.5 bg-muted/20 border-b border-border/70 flex items-center gap-1.5">
        <Icon size={12} className="text-muted-foreground" />
        <h4 className="text-xs font-semibold text-muted-foreground">{title} {rows && rows.length > 0 ? `(${rows.length})` : ""}</h4>
      </div>
      <div className="p-2">
        {!rows || rows.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-2">{empty}</div>
        ) : (
          <div className="space-y-1">{rows.map(children)}</div>
        )}
      </div>
    </div>
  );
}

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-5 gap-3 items-center px-2 py-2 rounded-lg hover:bg-muted/10 text-sm">
    {children}
  </div>
);

export default CrmCustomer360;