import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, Phone, FileText, Home, MessageSquare, Wrench } from "lucide-react";

const API = "/api/crm/customer-360";

async function fetchCustomer360(mobile: string): Promise<any> {
  if (!mobile) return null;
  const r = await fetchWithAuth(`${API}/${mobile}`);
  if (!r.ok) return null;
  return r.json();
}

const fmt = (n: number | null | undefined) => n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—";

const CrmCustomer360: React.FC = () => {
  const [mobileInput, setMobileInput] = useState("");
  const [searchMobile, setSearchMobile] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["crm-customer-360", searchMobile],
    queryFn: () => fetchCustomer360(searchMobile),
    enabled: !!searchMobile,
    staleTime: 30_000,
  });

  return (
    <SalesAutoShell title="CRM — Customer 360" subtitle="Full customer journey — lead to after-sales, in one view">
      <div className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={mobileInput} onChange={(e) => setMobileInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSearchMobile(mobileInput.trim())}
            placeholder="Enter mobile number..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
        </div>
        <button onClick={() => setSearchMobile(mobileInput.trim())}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          Search
        </button>
      </div>

      {!searchMobile ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Enter a mobile number to view the full customer journey</div>
      ) : isLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading...</div>
      ) : isError || !data ? (
        <div className="py-16 text-center text-muted-foreground text-sm">No customer found with this mobile number</div>
      ) : (
        <div className="space-y-5">
          {/* Leads */}
          {data.leads?.length > 0 && (
            <Section icon={Phone} title={`Lead History (${data.leads.length})`}>
              {data.leads.map((l: any) => (
                <Row key={l.Id}>
                  <span className="font-mono text-xs text-muted-foreground">{l.LeadUid}</span>
                  <span className="font-medium">{l.Status}</span>
                  <span className="text-xs">{l.Classification || "—"}</span>
                  <span className="text-xs text-muted-foreground">{l.SourceType || "—"}</span>
                  <span className="text-xs text-muted-foreground">{l.CreatedAt ? String(l.CreatedAt).slice(0, 10) : "—"}</span>
                </Row>
              ))}
            </Section>
          )}

          {/* Applications */}
          {data.applications?.length > 0 && (
            <Section icon={FileText} title={`Applications (${data.applications.length})`}>
              {data.applications.map((a: any) => (
                <Row key={a.Id}>
                  <span className="font-mono text-xs text-primary">{a.ApplicationNo}</span>
                  <span className="font-medium">{a.Status}</span>
                  <span className="text-xs">{[a.InterestedProject, a.PropertyType, a.BhkPreference].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="text-xs text-muted-foreground">{a.AssigneeName || "—"}</span>
                  <span className="text-xs text-muted-foreground">{a.CreatedAt ? String(a.CreatedAt).slice(0, 10) : "—"}</span>
                </Row>
              ))}
            </Section>
          )}

          {/* Bookings */}
          {data.bookings?.length > 0 && (
            <Section icon={Home} title={`Bookings (${data.bookings.length})`}>
              {data.bookings.map((b: any) => (
                <div key={b.Id} className="p-3 rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-mono text-xs font-semibold text-primary">{b.BookingNo}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full border font-medium bg-muted/40">{b.Status}</span>
                  </div>
                  <div className="text-sm font-medium">{b.ProjectName || "—"} · {b.UnitNo}</div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                    <div><span className="text-muted-foreground">Value: </span>{fmt(b.TotalValue)}</div>
                    <div><span className="text-muted-foreground">Paid: </span><span className="text-green-600 font-medium">{fmt(b.TotalPaid)}</span></div>
                    <div><span className="text-muted-foreground">Balance: </span><span className="text-orange-600 font-medium">{fmt(b.TotalOutstanding)}</span></div>
                    <div><span className="text-muted-foreground">Agreement: </span>{b.AgreementStatus || "—"}</div>
                    <div><span className="text-muted-foreground">Handover: </span>{b.HandoverStatus || "—"}</div>
                    <div><span className="text-muted-foreground">Legal: </span>{b.LegalMilestoneStatus || "—"}</div>
                    <div><span className="text-muted-foreground">Pre-Possession: </span>{b.PrePossessionStatus || "—"}</div>
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
                </div>
              ))}
            </Section>
          )}

          {/* Calls */}
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

          {/* Service Tickets */}
          {data.serviceTickets?.length > 0 && (
            <Section icon={Wrench} title={`Service Tickets (${data.serviceTickets.length})`}>
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
    </SalesAutoShell>
  );
};

const Section: React.FC<{ icon: React.ElementType; title: string; children: React.ReactNode }> = ({ icon: Icon, title, children }) => (
  <div className="rounded-xl border border-border overflow-hidden">
    <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center gap-2">
      <Icon size={14} className="text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
    <div className="p-3 space-y-2">{children}</div>
  </div>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-5 gap-3 items-center px-2 py-2 rounded-lg hover:bg-muted/10 text-sm">
    {children}
  </div>
);

export default CrmCustomer360;
