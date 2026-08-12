import React from "react";
import { useQuery } from "@tanstack/react-query";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LineChart, Line } from "recharts";
import { IndianRupee } from "lucide-react";

const API = "/api/crm/dashboard";

async function fetchDashboard(): Promise<any> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : {}; } catch { return {}; }
}

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#64748b"];

const Card: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className = "" }) => (
  <div className={`rounded-xl border border-border bg-card p-4 shadow-sm flex flex-col ${className}`}>
    <h3 className="text-sm font-semibold mb-4 text-card-foreground">{title}</h3>
    <div className="flex-1 min-h-[250px] w-full">
      {children}
    </div>
  </div>
);

const CrmDashboard: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ["crm-dashboard"], queryFn: fetchDashboard, staleTime: 60_000 });

  if (isLoading || !data) {
    return <SalesAutoShell title="CRM Dashboard" subtitle="Pipeline overview"><div className="p-8 text-center text-muted-foreground text-sm">Loading...</div></SalesAutoShell>;
  }

  const collectionPct = data.payments?.TotalDue ? Math.round((data.payments.TotalPaid / data.payments.TotalDue) * 100) : 0;

  return (
    <SalesAutoShell title="CRM Dashboard" subtitle="Real-time pipeline, closure, and after-sales health">
      
      {/* Top Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <IndianRupee size={16} className="text-primary" />
            <h3 className="text-sm font-semibold text-card-foreground">Payment Collection</h3>
          </div>
          <div className="text-2xl font-bold mb-1">{collectionPct}%</div>
          <div className="w-full bg-muted rounded-full h-2 mb-2">
            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${collectionPct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">₹{(data.payments?.TotalPaid || 0).toLocaleString("en-IN")} collected of ₹{(data.payments?.TotalDue || 0).toLocaleString("en-IN")}</p>
          {data.payments?.OverdueCount > 0 && (
            <p className="text-xs text-red-600 mt-1 font-medium">{data.payments.OverdueCount} milestone(s) overdue</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
        {/* Inventory Status */}
        <Card title="Inventory Status">
          {data.inventory?.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.inventory} dataKey="Count" nameKey="Status" cx="50%" cy="50%" outerRadius={80} label>
                  {data.inventory.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
             <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No inventory data</div>
          )}
        </Card>

        {/* MoM Collections */}
        <Card title="Month-over-Month Collections">
          {data.collections?.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.collections}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="Month" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `₹${(value / 100000).toFixed(0)}L`} />
                <Tooltip cursor={{ fill: 'hsl(var(--muted)/0.5)' }} formatter={(value: number) => `₹${value.toLocaleString("en-IN")}`} />
                <Bar dataKey="TotalCollected" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No collection data</div>
          )}
        </Card>

        {/* Applications vs Bookings Pipeline */}
        <Card title="Bookings Pipeline">
          {data.bookings?.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.bookings} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis dataKey="Status" type="category" width={80} fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip cursor={{ fill: 'hsl(var(--muted)/0.5)' }} />
                <Bar dataKey="Count" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No bookings yet</div>
          )}
        </Card>
        
        {/* Service Tickets */}
        <Card title="Service Tickets">
          {data.serviceTickets?.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.serviceTickets} dataKey="Count" nameKey="Status" cx="50%" cy="50%" innerRadius={60} outerRadius={80} label>
                  {data.serviceTickets.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
             <div className="h-full flex items-center justify-center text-xs text-muted-foreground">No tickets</div>
          )}
        </Card>

      </div>
    </SalesAutoShell>
  );
};

export default CrmDashboard;
