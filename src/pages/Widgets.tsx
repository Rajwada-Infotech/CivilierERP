import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { getWidgetsDashboard, type WidgetsDashboardData } from "@/api/widgetsApi";
import {
  Puzzle, BarChart2, TrendingUp, PieChart, Hash, Table2,
  Calendar, Bell, MessageSquare, Map, Paperclip, RefreshCw,
  Calculator, X, Upload, Check, AlertTriangle, Info,
  ChevronLeft, ChevronRight,
} from "lucide-react";

// ─── WIDGET REGISTRY ──────────────────────────────────────────────────────────
const widgetItems = [
  { icon: BarChart2,     label: "Bar Chart" },
  { icon: TrendingUp,    label: "Line Chart" },
  { icon: PieChart,      label: "Pie Chart" },
  { icon: Hash,          label: "Stat Card" },
  { icon: Table2,        label: "Data Table" },
  { icon: Calendar,      label: "Calendar" },
  { icon: Bell,          label: "Notifications" },
  { icon: MessageSquare, label: "Activity Feed" },
  { icon: Map,           label: "Map View" },
  { icon: Paperclip,     label: "File Uploader" },
  { icon: RefreshCw,     label: "Progress Ring" },
  { icon: Calculator,    label: "Calculator" },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtCur = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN").format(n);
const fmtTime = (s: string) => {
  const diff = Math.floor((Date.now() - new Date(s).getTime()) / 60000);
  if (diff < 1) return "just now";
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
};

function Spinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
    </div>
  );
}

function useWidgetsData() {
  const { data, isLoading } = useQuery<WidgetsDashboardData>({
    queryKey: ["widgets-dashboard"],
    queryFn: getWidgetsDashboard,
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });

  return { data, loading: isLoading };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BAR CHART
// ═══════════════════════════════════════════════════════════════════════════════
function BarChartWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const flow = data?.trends?.dailyFlow || [];
  const items = flow.length
    ? flow.map((f: any) => ({ label: f.date?.slice(5) || "—", value: f.activityCount || 0 }))
    : [{ label: "No data", value: 0 }];
  const max = Math.max(...items.map((d: any) => d.value), 1);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">System activity — last 7 days</p>
      <div className="flex items-end gap-2 h-44">
        {items.map((d: any, i: number) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{d.value}</span>
            <div className="w-full rounded-t-md bg-primary/70 hover:bg-primary transition-all"
              style={{ height: `${Math.max(4, (d.value / max) * 140)}px` }} />
            <span className="text-[10px] text-muted-foreground">{d.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Total: {fmtNum(items.reduce((s: number, d: any) => s + d.value, 0))} actions
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. LINE CHART
// ═══════════════════════════════════════════════════════════════════════════════
function LineChartWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const flow = data?.trends?.dailyFlow || [];
  if (!flow.length) return <p className="text-sm text-muted-foreground text-center py-10">No trend data.</p>;
  const items = flow.map((f: any) => ({ label: f.date?.slice(5) || "—", tasks: f.tasksCreated || 0, activity: f.activityCount || 0 }));
  const W = 300, H = 150, pad = 20;
  const maxVal = Math.max(...items.map((d: any) => Math.max(d.tasks, d.activity)), 1);
  const px = (i: number) => pad + (i / Math.max(items.length - 1, 1)) * (W - pad * 2);
  const py = (v: number) => H - pad - (v / maxVal) * (H - pad * 2);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Tasks vs Activity — 7 days</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0.25, 0.5, 0.75, 1].map(r => (
          <line key={r} x1={pad} y1={py(maxVal * r)} x2={W - pad} y2={py(maxVal * r)}
            stroke="currentColor" strokeOpacity="0.1" strokeDasharray="4 4" />
        ))}
        <polyline fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          points={items.map((d: any, i: number) => `${px(i)},${py(d.activity)}`).join(" ")} />
        <polyline fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          points={items.map((d: any, i: number) => `${px(i)},${py(d.tasks)}`).join(" ")} />
        {items.map((d: any, i: number) => (
          <g key={i}>
            <circle cx={px(i)} cy={py(d.activity)} r="3" fill="#34d399" />
            <circle cx={px(i)} cy={py(d.tasks)} r="3" fill="#818cf8" />
            <text x={px(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.5">{d.label}</text>
          </g>
        ))}
      </svg>
      <div className="flex gap-4 justify-center text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400 inline-block rounded" /> Activity</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-400 inline-block rounded" /> Tasks</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PIE CHART
// ═══════════════════════════════════════════════════════════════════════════════
function PieChartWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const s = data?.summary;
  const slices = [
    { label: "Open",        value: s?.openTasks || 0,       color: "#60a5fa" },
    { label: "In Progress", value: s?.inProgressTasks || 0, color: "#a78bfa" },
    { label: "Closed",      value: s?.closedTasks || 0,     color: "#34d399" },
    { label: "Reviewed",    value: s?.reviewedTasks || 0,   color: "#2dd4bf" },
  ].filter(sl => sl.value > 0);
  const total = slices.reduce((acc, sl) => acc + sl.value, 0);
  if (!total) return <p className="text-sm text-muted-foreground text-center py-10">No task data available.</p>;
  let cum = 0;
  const paths = slices.map(sl => {
    const pct = sl.value / total, start = cum, end = cum + pct; cum = end;
    const a1 = (start * 2 - 0.5) * Math.PI, a2 = (end * 2 - 0.5) * Math.PI;
    const r = 70, cx = 90, cy = 90;
    return {
      d: `M${cx},${cy} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} A${r},${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${cx + r * Math.cos(a2)},${cy + r * Math.sin(a2)} Z`,
      ...sl,
    };
  });
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg viewBox="0 0 180 180" className="w-36 h-36 shrink-0">
        {paths.map((p, i) => <path key={i} d={p.d} fill={p.color} opacity="0.85" />)}
        <circle cx="90" cy="90" r="35" fill="hsl(var(--card))" />
        <text x="90" y="86" textAnchor="middle" fontSize="14" fontWeight="bold" fill="currentColor">{total}</text>
        <text x="90" y="100" textAnchor="middle" fontSize="9" fill="currentColor" opacity="0.6">tasks</text>
      </svg>
      <div className="space-y-2 w-full">
        {paths.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: p.color }} />
            <span className="text-muted-foreground flex-1">{p.label}</span>
            <span className="font-semibold">{p.value}</span>
            <span className="text-xs text-muted-foreground">({Math.round(p.value / total * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. STAT CARD
// ═══════════════════════════════════════════════════════════════════════════════
function StatCardWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const s = data?.summary;
  const cards = [
    { label: "Total Users",    value: fmtNum(s?.totalUsers || 0),       tone: "sky" },
    { label: "Active Users",   value: fmtNum(s?.activeUsers || 0),      tone: "emerald" },
    { label: "Open Tasks",     value: fmtNum(s?.openTasks || 0),        tone: s?.overdueTasks > 0 ? "rose" : "emerald" },
    { label: "Open POs",       value: fmtNum(s?.openPOs || 0),          tone: "amber" },
    { label: "PO Exposure",    value: fmtCur(s?.openPOValue || 0),      tone: "violet" },
    { label: "Activity Today", value: fmtNum(s?.activity24h || 0),      tone: "teal" },
  ];
  const tones: Record<string, string> = {
    sky: "bg-sky-500/10 text-sky-400 border-sky-500/20", emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20", amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    violet: "bg-violet-500/10 text-violet-400 border-violet-500/20", teal: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((c, i) => (
        <div key={i} className={`p-3 rounded-xl border ${tones[c.tone]}`}>
          <p className="text-xs opacity-70 mb-1">{c.label}</p>
          <p className="text-xl font-bold">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. DATA TABLE
// ═══════════════════════════════════════════════════════════════════════════════
function DataTableWidget() {
  const { data, loading } = useWidgetsData();
  const [page, setPage] = useState(0);
  if (loading) return <Spinner />;
  const tasks = data?.recent?.tasks || [];
  if (!tasks.length) return <p className="text-sm text-muted-foreground text-center py-10">No tasks found.</p>;
  const PER = 5, pages = Math.ceil(tasks.length / PER);
  const rows = tasks.slice(page * PER, (page + 1) * PER);
  const sc: Record<string, string> = {
    open: "bg-blue-500/20 text-blue-300", in_progress: "bg-violet-500/20 text-violet-300",
    closed: "bg-emerald-500/20 text-emerald-300", reviewed: "bg-teal-500/20 text-teal-300",
  };
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border bg-muted/30">
            <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Title</th>
            <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Assigned</th>
            <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Status</th>
          </tr></thead>
          <tbody>{rows.map((t: any, i: number) => (
            <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
              <td className="px-3 py-2 max-w-[140px] truncate font-medium">{t.title}</td>
              <td className="px-3 py-2 text-muted-foreground truncate">{t.assignedToName || "—"}</td>
              <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sc[t.status] || "bg-muted text-muted-foreground"}`}>{t.status?.replace("_", " ")}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-1 rounded hover:bg-muted/40 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <span>Page {page + 1} of {pages}</span>
          <button onClick={() => setPage(p => Math.min(pages - 1, p + 1))} disabled={page === pages - 1} className="p-1 rounded hover:bg-muted/40 disabled:opacity-30"><ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CALENDAR
// ═══════════════════════════════════════════════════════════════════════════════
function CalendarWidget() {
  const { data, loading } = useWidgetsData();
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear]   = useState(today.getFullYear());
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const tasks = data?.recent?.tasks || [];
  const dueDates = new Set(tasks.filter((t: any) => t.dueDate).map((t: any) => new Date(t.dueDate).toDateString()));
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) => i < firstDay ? null : i - firstDay + 1);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={() => { const d = new Date(year, month - 1); setMonth(d.getMonth()); setYear(d.getFullYear()); }} className="p-1 rounded hover:bg-muted/40"><ChevronLeft size={14} /></button>
        <span className="text-sm font-semibold">{monthNames[month]} {year}</span>
        <button onClick={() => { const d = new Date(year, month + 1); setMonth(d.getMonth()); setYear(d.getFullYear()); }} className="p-1 rounded hover:bg-muted/40"><ChevronRight size={14} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />;
          const ds = new Date(year, month, day).toDateString();
          const isToday = ds === today.toDateString(), hasDue = dueDates.has(ds);
          return (
            <div key={i} className={`flex items-center justify-center h-7 rounded text-xs font-medium transition-colors relative
              ${isToday ? "bg-primary text-primary-foreground" : "hover:bg-muted/40"}
              ${hasDue && !isToday ? "ring-1 ring-amber-500 text-amber-400" : ""}`}>
              {day}
              {hasDue && !isToday && <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-amber-500" />}
            </div>
          );
        })}
      </div>
      {!loading && <p className="text-xs text-muted-foreground text-center">{tasks.filter((t: any) => t.dueDate).length} tasks with due dates</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════
function NotificationsWidget() {
  const { data, loading } = useWidgetsData();
  const navigate = useNavigate();
  if (loading) return <Spinner />;
  const alerts = data?.alerts || [];
  if (!alerts.length) return <p className="text-sm text-muted-foreground text-center py-10">No notifications.</p>;
  const styles: Record<string, { icon: any; cls: string }> = {
    critical: { icon: AlertTriangle, cls: "border-rose-500/30 bg-rose-500/5 text-rose-400" },
    warning:  { icon: AlertTriangle, cls: "border-amber-500/30 bg-amber-500/5 text-amber-400" },
    info:     { icon: Info,          cls: "border-sky-500/30 bg-sky-500/5 text-sky-400" },
  };
  return (
    <div className="space-y-2">
      {alerts.map((a: any, i: number) => {
        const st = styles[a.type] || styles.info;
        const Icon = st.icon;
        return (
          <div key={i} onClick={() => a.action && navigate(a.action)}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:brightness-110 transition-all ${st.cls}`}>
            <Icon size={14} className="mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{a.title}</p>
              <p className="text-xs opacity-70 mt-0.5">{a.description}</p>
            </div>
            {a.count !== undefined && <span className="text-xs font-bold shrink-0">{a.count}</span>}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. ACTIVITY FEED
// ═══════════════════════════════════════════════════════════════════════════════
function ActivityFeedWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const activity = data?.recent?.activity || [];
  if (!activity.length) return <p className="text-sm text-muted-foreground text-center py-10">No activity yet.</p>;
  return (
    <div className="space-y-2">
      {activity.map((a: any, i: number) => (
        <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors">
          <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
            {a.userName?.[0]?.toUpperCase() || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{a.details || `${a.event} — ${a.resource || a.actionType}`}</p>
            <p className="text-xs text-muted-foreground">{a.userName} · {a.userRole}</p>
          </div>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{fmtTime(a.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. MAP VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function MapViewWidget() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Project site locations</p>
      <div className="relative h-48 rounded-xl overflow-hidden border border-border bg-muted/10">
        <svg viewBox="0 0 400 200" className="w-full h-full opacity-20">
          {[50,100,150,200,250,300,350].map(x => <line key={x} x1={x} y1="0" x2={x} y2="200" stroke="currentColor" strokeWidth="0.5" />)}
          {[40,80,120,160].map(y => <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="currentColor" strokeWidth="0.5" />)}
          <path d="M200,40 L220,50 L230,70 L225,90 L240,110 L235,140 L220,160 L200,170 L180,160 L175,140 L180,110 L175,90 L180,70 L190,50 Z"
            fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1" />
        </svg>
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
          <div className="relative">
            <div className="w-5 h-5 rounded-full bg-primary animate-ping absolute opacity-40" />
            <div className="w-5 h-5 rounded-full bg-primary relative flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-white" />
            </div>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-3 flex justify-center">
          <span className="text-xs text-muted-foreground bg-card/80 px-2 py-0.5 rounded backdrop-blur-sm">
            Connect Google Maps API to show real locations
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. FILE UPLOADER
// ═══════════════════════════════════════════════════════════════════════════════
function FileUploaderWidget() {
  const [files, setFiles] = useState<{ name: string; size: string; done: boolean }[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList) => {
    const nf = Array.from(list).map(f => ({
      name: f.name,
      size: f.size < 1048576 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / 1048576).toFixed(1)} MB`,
      done: false,
    }));
    setFiles(prev => [...prev, ...nf]);
    nf.forEach((_, i) => setTimeout(() => {
      setFiles(prev => prev.map((f, j) => j === prev.length - nf.length + i ? { ...f, done: true } : f));
    }, 800 + i * 400));
  };

  return (
    <div className="space-y-3">
      <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
          ${dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20"}`}>
        <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm font-medium">Drop files or click to browse</p>
        <p className="text-xs text-muted-foreground mt-1">Any file type accepted</p>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={e => e.target.files && addFiles(e.target.files)} />
      </div>
      {files.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 text-xs">
              <Paperclip size={12} className="text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-muted-foreground">{f.size}</span>
              {f.done ? <Check size={12} className="text-emerald-400 shrink-0" />
                : <div className="w-3 h-3 rounded-full border border-primary border-t-transparent animate-spin shrink-0" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. PROGRESS RING
// ═══════════════════════════════════════════════════════════════════════════════
function ProgressRingWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const s = data?.summary;
  const total = s?.totalTasks || 0;
  const done = (s?.closedTasks || 0) + (s?.reviewedTasks || 0);
  const inProg = s?.inProgressTasks || 0;
  const completion = total ? Math.round((done / total) * 100) : 0;
  const inProgPct = total ? Math.round((inProg / total) * 100) : 0;
  const userPct = s?.totalUsers ? Math.round((s.activeUsers / s.totalUsers) * 100) : 100;

  const Ring = ({ pct, color, label }: { pct: number; color: string; label: string }) => {
    const r = 32, circ = 2 * Math.PI * r;
    return (
      <div className="flex flex-col items-center gap-2">
        <svg width="80" height="80" className="-rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="6" />
          <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round" />
          <text x="40" y="40" textAnchor="middle" dominantBaseline="middle" fill="currentColor"
            fontSize="13" fontWeight="bold" transform="rotate(90, 40, 40)">{pct}%</text>
        </svg>
        <span className="text-xs text-muted-foreground text-center">{label}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-around">
        <Ring pct={completion} color="#34d399" label="Tasks done" />
        <Ring pct={inProgPct}  color="#a78bfa" label="In progress" />
        <Ring pct={userPct}    color="#60a5fa" label="Users active" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div><p className="font-bold text-emerald-400">{done}</p><p className="text-muted-foreground">Completed</p></div>
        <div><p className="font-bold text-violet-400">{inProg}</p><p className="text-muted-foreground">In Progress</p></div>
        <div><p className="font-bold text-blue-400">{s?.activeUsers || 0}</p><p className="text-muted-foreground">Active Users</p></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════
function CalculatorWidget() {
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<string | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [reset, setReset] = useState(false);

  const press = (val: string) => {
    if (val === "C")  { setDisplay("0"); setPrev(null); setOp(null); setReset(false); return; }
    if (val === "±")  { setDisplay(d => String(-parseFloat(d) || 0)); return; }
    if (val === "%")  { setDisplay(d => String(parseFloat(d) / 100)); return; }
    if (["+","−","×","÷"].includes(val)) { setPrev(display); setOp(val); setReset(true); return; }
    if (val === "=") {
      if (!prev || !op) return;
      const a = parseFloat(prev), b = parseFloat(display);
      const r = op === "+" ? a+b : op === "−" ? a-b : op === "×" ? a*b : b !== 0 ? a/b : 0;
      setDisplay(String(parseFloat(r.toFixed(8))));
      setPrev(null); setOp(null); setReset(false); return;
    }
    if (val === ".") { if (reset) { setDisplay("0."); setReset(false); return; } if (!display.includes(".")) setDisplay(d => d + "."); return; }
    if (reset) { setDisplay(val); setReset(false); return; }
    setDisplay(d => d === "0" ? val : d.length < 12 ? d + val : d);
  };

  const rows = [["C","±","%","÷"],["7","8","9","×"],["4","5","6","−"],["1","2","3","+"],[" ","0",".","="]];
  const isOp = (v: string) => ["+","−","×","÷","="].includes(v);
  const isFn = (v: string) => ["C","±","%"].includes(v);

  return (
    <div className="max-w-[220px] mx-auto space-y-3">
      <div className="bg-muted/30 rounded-xl p-4 text-right min-h-[72px]">
        {op && <p className="text-xs text-muted-foreground">{prev} {op}</p>}
        <p className="text-3xl font-bold tracking-tight truncate">{display}</p>
      </div>
      <div className="space-y-2">
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-4 gap-2">
            {row.map((btn, bi) => btn === " " ? <div key={bi} /> : (
              <button key={btn} onClick={() => press(btn)}
                className={`h-11 rounded-xl text-sm font-semibold transition-all active:scale-95
                  ${isOp(btn) ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : isFn(btn) ? "bg-muted/60 hover:bg-muted"
                    : "bg-muted/30 hover:bg-muted/50"}`}>
                {btn}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── WIDGET MAP ───────────────────────────────────────────────────────────────
const widgetComponents: Record<string, React.ComponentType> = {
  "Bar Chart": BarChartWidget, "Line Chart": LineChartWidget, "Pie Chart": PieChartWidget,
  "Stat Card": StatCardWidget, "Data Table": DataTableWidget, "Calendar": CalendarWidget,
  "Notifications": NotificationsWidget, "Activity Feed": ActivityFeedWidget, "Map View": MapViewWidget,
  "File Uploader": FileUploaderWidget, "Progress Ring": ProgressRingWidget, "Calculator": CalculatorWidget,
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
const Widgets = () => {
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(searchParams.get("w"));
  const ActiveWidget = selected ? widgetComponents[selected] : null;

  return (
    <>
      <Breadcrumbs items={["Dashboard", selected || "Widgets"]} />

      {selected ? (
        <div className="max-w-lg mx-auto mt-4">
          <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                {(() => { const w = widgetItems.find(i => i.label === selected); return w ? <w.icon size={20} className="text-primary" /> : <Puzzle size={20} className="text-primary" />; })()}
                <h1 className="text-base font-bold">{selected}</h1>
              </div>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              {ActiveWidget ? <ActiveWidget /> : <p className="text-sm text-muted-foreground text-center py-8">Widget not found.</p>}
            </div>
          </div>
          <button onClick={() => setSelected(null)} className="mt-4 flex items-center gap-1.5 text-sm text-primary hover:underline font-heading mx-auto">
            <X size={14} /> Back to all widgets
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-6">
            <Puzzle size={20} className="text-primary" />
            <h1 className="text-xl font-heading font-bold text-foreground">Widgets</h1>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {widgetItems.map(({ icon: Icon, label }) => (
              <button key={label} onClick={() => setSelected(label)}
                className="flex flex-col items-center gap-2 p-5 rounded-lg border border-border bg-card transition-all hover:bg-accent/10 hover:shadow-md hover:-translate-y-0.5 hover:border-primary">
                <Icon size={28} className="text-primary" />
                <span className="text-xs text-muted-foreground font-heading">{label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
};

export default Widgets;
