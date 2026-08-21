import { useQuery } from "@tanstack/react-query";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { usePageRights } from "../hooks/usePageRights";
import { getWidgetsDashboard, WidgetsDashboardData } from "../api/widgetsApi";
import { LayoutDashboard, AlertTriangle, Info } from "lucide-react";

const CommandCenter = () => {
  usePageRights("command-center");
  const { data, isLoading, error } = useQuery<WidgetsDashboardData>({
    queryKey: ["widgets-dashboard"],
    queryFn: getWidgetsDashboard,
    staleTime: 60_000,
  });

  if (isLoading) return <div className="py-20 text-center text-muted-foreground animate-pulse">Loading dashboard...</div>;
  if (error) return <div className="py-20 text-center text-destructive">{(error as Error).message}</div>;
  if (!data) return null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Command Center"]} />

      <div className="flex items-center gap-2 mb-6">
        <LayoutDashboard size={20} className="text-primary" />
        <div>
          <h1 className="text-xl font-heading font-bold text-foreground">{data.experience.title}</h1>
          <p className="text-xs text-muted-foreground">{data.experience.description}</p>
        </div>
      </div>

      {/* Alerts */}
      {data.alerts.length > 0 && (
        <div className="flex flex-col gap-2 mb-6">
          {data.alerts.map((alert, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
              alert.type === "critical" ? "border-destructive/40 bg-destructive/5 text-destructive" :
              alert.type === "warning" ? "border-yellow-400/40 bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300" :
              "border-border bg-muted/40 text-muted-foreground"
            }`}>
              {alert.type === "critical" ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <Info size={14} className="mt-0.5 shrink-0" />}
              <div><strong>{alert.title}</strong> — {alert.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* Module summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        {data.modules.map((mod) => (
          <div key={mod.key} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{mod.title}</p>
            <p className="text-2xl font-bold text-foreground">{mod.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{mod.description}</p>
          </div>
        ))}
      </div>

      {/* Recent activity + tasks side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold mb-3">Recent Activity</p>
          <div className="flex flex-col gap-2">
            {data.recent.activity.slice(0, 8).map((a) => (
              <div key={a.id} className="flex justify-between text-xs text-muted-foreground border-b border-border pb-1.5 last:border-0">
                <span className="truncate mr-2"><span className="text-foreground font-medium">{a.userName}</span> — {a.event}</span>
                <span className="shrink-0">{new Date(a.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold mb-3">Open Tasks</p>
          <div className="flex flex-col gap-2">
            {data.recent.tasks.filter(t => t.status !== "closed").slice(0, 8).map((t) => (
              <div key={t.id} className="flex justify-between text-xs text-muted-foreground border-b border-border pb-1.5 last:border-0">
                <span className="truncate mr-2 text-foreground">{t.title}</span>
                <span className={`shrink-0 font-medium ${t.priority === "high" ? "text-destructive" : t.priority === "medium" ? "text-yellow-600" : ""}`}>{t.priority}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      {data.quickActions.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-semibold mb-3">Quick Actions</p>
          <div className="flex flex-wrap gap-2">
            {data.quickActions.map((qa) => (
              <a key={qa.path} href={qa.path} className="text-xs px-3 py-1.5 rounded-md border border-border bg-muted hover:bg-accent/10 text-foreground transition-colors">
                {qa.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

export default CommandCenter;

