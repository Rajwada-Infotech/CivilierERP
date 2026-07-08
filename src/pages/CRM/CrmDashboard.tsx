import React from "react";
import { useQuery } from "@tanstack/react-query";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ClipboardList, BookOpen, IndianRupee, Wrench, XCircle, Scale, FileText, Key } from "lucide-react";

const API = "/api/crm/dashboard";

async function fetchDashboard(): Promise<any> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : {}; } catch { return {}; }
}

const StatCard: React.FC<{ icon: any; label: string; children: React.ReactNode }> = ({ icon: Icon, label, children }) => (
  <div className="rounded-xl border border-border p-4">
    <div className="flex items-center gap-2 mb-3">
      <Icon size={16} className="text-primary" />
      <h3 className="text-sm font-semibold">{label}</h3>
    </div>
    {children}
  </div>
);

const Bar: React.FC<{ label: string; value: number; total: number; color?: string }> = ({ label, value, total, color = "bg-primary" }) => (
  <div className="mb-2">
    <div className="flex justify-between text-xs mb-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
    <div className="w-full bg-muted rounded-full h-1.5">
      <div className={`${color} h-1.5 rounded-full`} style={{ width: total ? `${(value / total) * 100}%` : "0%" }} />
    </div>
  </div>
);

const CrmDashboard: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ["crm-dashboard"], queryFn: fetchDashboard, staleTime: 60_000 });

  if (isLoading || !data) {
    return <SalesAutoShell title="CRM Dashboard" subtitle="Pipeline overview"><div className="p-8 text-center text-muted-foreground text-sm">Loading...</div></SalesAutoShell>;
  }

  const appsTotal = (data.applications || []).reduce((s: number, a: any) => s + a.Count, 0);
  const bookingsTotal = (data.bookings || []).reduce((s: number, b: any) => s + b.Count, 0);
  const collectionPct = data.payments?.TotalDue ? Math.round((data.payments.TotalPaid / data.payments.TotalDue) * 100) : 0;

  return (
    <SalesAutoShell title="CRM Dashboard" subtitle="Real-time pipeline, closure, and after-sales health">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard icon={ClipboardList} label="Applications">
          {(data.applications || []).map((a: any) => <Bar key={a.Status} label={a.Status} value={a.Count} total={appsTotal} />)}
          {!data.applications?.length && <p className="text-xs text-muted-foreground">No applications yet</p>}
        </StatCard>

        <StatCard icon={BookOpen} label="Bookings">
          {(data.bookings || []).map((b: any) => <Bar key={b.Status} label={b.Status} value={b.Count} total={bookingsTotal} />)}
          {!data.bookings?.length && <p className="text-xs text-muted-foreground">No bookings yet</p>}
        </StatCard>

        <StatCard icon={IndianRupee} label="Payment Collection">
          <div className="text-2xl font-bold mb-1">{collectionPct}%</div>
          <div className="w-full bg-muted rounded-full h-2 mb-2">
            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${collectionPct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">₹{(data.payments?.TotalPaid || 0).toLocaleString("en-IN")} collected of ₹{(data.payments?.TotalDue || 0).toLocaleString("en-IN")}</p>
          {data.payments?.OverdueCount > 0 && (
            <p className="text-xs text-red-600 mt-1 font-medium">{data.payments.OverdueCount} milestone(s) overdue</p>
          )}
        </StatCard>

        <StatCard icon={Wrench} label="Service Tickets">
          {(data.serviceTickets || []).map((t: any) => <Bar key={t.Status} label={t.Status} value={t.Count} total={(data.serviceTickets || []).reduce((s: number, x: any) => s + x.Count, 0)} color="bg-orange-500" />)}
          {!data.serviceTickets?.length && <p className="text-xs text-muted-foreground">No tickets</p>}
        </StatCard>

        <StatCard icon={XCircle} label="Cancellations">
          {(data.cancellations || []).map((c: any) => (
            <div key={c.Status} className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{c.Status}</span>
              <span className="font-medium">{c.Count} · ₹{c.TotalRefund?.toLocaleString("en-IN")}</span>
            </div>
          ))}
          {!data.cancellations?.length && <p className="text-xs text-muted-foreground">None</p>}
        </StatCard>

        <StatCard icon={Scale} label="Legal Milestones">
          {(data.legalMilestones || []).map((m: any) => (
            <div key={m.OverallStatus} className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{m.OverallStatus}</span>
              <span className="font-medium">{m.Count}</span>
            </div>
          ))}
          {!data.legalMilestones?.length && <p className="text-xs text-muted-foreground">None started</p>}
        </StatCard>

        <StatCard icon={FileText} label="NOC (Org & Bank)">
          {(data.noc || []).map((n: any) => (
            <div key={`${n.NocType}-${n.Status}`} className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{n.NocType} · {n.Status}</span>
              <span className="font-medium">{n.Count}</span>
            </div>
          ))}
          {!data.noc?.length && <p className="text-xs text-muted-foreground">None</p>}
        </StatCard>

        <StatCard icon={FileText} label="Sale Deeds">
          {(data.salesDeeds || []).map((d: any) => (
            <div key={d.Status} className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{d.Status}</span>
              <span className="font-medium">{d.Count}</span>
            </div>
          ))}
          {!data.salesDeeds?.length && <p className="text-xs text-muted-foreground">None</p>}
        </StatCard>

        <StatCard icon={Key} label="Handovers">
          {(data.handovers || []).map((h: any) => (
            <div key={h.Status} className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">{h.Status}</span>
              <span className="font-medium">{h.Count}</span>
            </div>
          ))}
          {!data.handovers?.length && <p className="text-xs text-muted-foreground">None scheduled</p>}
        </StatCard>
      </div>
    </SalesAutoShell>
  );
};

export default CrmDashboard;
