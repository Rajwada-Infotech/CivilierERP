import type React from "react";
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams, useNavigate } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  getWidgetCatalog,
  getWidgetsDashboard,
  type WidgetCatalogItem,
  type WidgetsDashboardData,
} from "@/api/widgetsApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  getPendingVehicleSummary,
  type PendingVehicleInOutSummary,
} from "@/api/vehicleInOutApi";
import { getEnterprisesByType, type Enterprise } from "@/api/enterpriseApi";
import {
  Puzzle,
  BarChart2,
  TrendingUp,
  PieChart,
  Hash,
  Table2,
  Calendar,
  Bell,
  MessageSquare,
  Map as MapIcon,
  Paperclip,
  RefreshCw,
  Calculator,
  Truck,
  X,
} from "lucide-react";

// ─── WIDGET REGISTRY — single source of truth ─────────────────────────────────
// key must exactly match what WidgetsRights.tsx stores in the DB
const widgetIcons: Record<string, React.ElementType> = {
  "bar-chart-2": BarChart2,
  "trending-up": TrendingUp,
  "pie-chart": PieChart,
  hash: Hash,
  "table-2": Table2,
  calendar: Calendar,
  bell: Bell,
  "message-square": MessageSquare,
  map: MapIcon,
  paperclip: Paperclip,
  "refresh-cw": RefreshCw,
  calculator: Calculator,
  truck: Truck,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const fmtCur = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
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

// ─── WIDGET DATA HOOK ─────────────────────────────────────────────────────────
function useWidgetsData() {
  const { data, isLoading } = useQuery<WidgetsDashboardData>({
    queryKey: ["widgets-dashboard"],
    queryFn: getWidgetsDashboard,
    staleTime: 15_000,
    refetchInterval: 20_000,
  });
  return { data, loading: isLoading };
}

function useWidgetCatalog() {
  const {
    data = [],
    isLoading,
    isError,
  } = useQuery<WidgetCatalogItem[]>({
    queryKey: ["widget-catalog"],
    queryFn: getWidgetCatalog,
    staleTime: 5 * 60 * 1000,
  });

  return { catalog: data, loading: isLoading, error: isError };
}

// ─── ALLOWED WIDGETS HOOK — fetches from DB via /api/user-widget-rights/my ───
function useAllowedWidgets() {
  const { data, isLoading, isError } = useQuery<{ allowedWidgets: string[] }>({
    queryKey: ["user-widget-rights-my"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/user-widget-rights/my");
      if (!res.ok) throw new Error("Failed to load widget rights");
      return res.json().catch(() => ({}));
    },
    staleTime: 5 * 60 * 1000, // re-fetch every 5 min
    retry: false, // don't retry on 404 — graceful fallback
  });

  // While loading, show nothing (avoids flash of all widgets then filtered)
  if (isLoading) return { allowedSet: null, loading: true };
  // On error, return null so the catalog falls back to showing everything
  if (isError) return { allowedSet: null, loading: false, error: true };
  const allowed = data?.allowedWidgets ?? [];
  return { allowedSet: new Set(allowed), loading: false, error: false };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WIDGET COMPONENTS (unchanged from original — data layer is the same)
// ═══════════════════════════════════════════════════════════════════════════════

function BarChartWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const flow = data?.trends?.dailyFlow || [];
  const items = flow.length
    ? flow.map((f: any) => ({
        label: f.date?.slice(5) || "—",
        value: f.activityCount || 0,
      }))
    : [{ label: "No data", value: 0 }];
  const max = Math.max(...items.map((d: any) => d.value), 1);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        System activity — last 7 days
      </p>
      <div className="flex items-end gap-2 h-44">
        {items.map((d: any, i: number) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-[10px] text-muted-foreground">{d.value}</span>
            <div
              className="w-full rounded-t-md bg-primary/70 hover:bg-primary transition-all"
              style={{ height: `${Math.max(4, (d.value / max) * 140)}px` }}
            />
            <span className="text-[10px] text-muted-foreground">{d.label}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground text-center">
        Total: {fmtNum(items.reduce((s: number, d: any) => s + d.value, 0))}{" "}
        actions
      </p>
    </div>
  );
}

function LineChartWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const flow = data?.trends?.dailyFlow || [];
  if (!flow.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No trend data.
      </p>
    );
  const items = flow.map((f: any) => ({
    label: f.date?.slice(5) || "—",
    tasks: f.tasksCreated || 0,
    activity: f.activityCount || 0,
  }));
  const W = 300,
    H = 150,
    pad = 20;
  const maxVal = Math.max(
    ...items.map((d: any) => Math.max(d.tasks, d.activity)),
    1,
  );
  const px = (i: number) =>
    pad + (i / Math.max(items.length - 1, 1)) * (W - pad * 2);
  const py = (v: number) => H - pad - (v / maxVal) * (H - pad * 2);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Tasks vs Activity — 7 days
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0.25, 0.5, 0.75, 1].map((r) => (
          <line
            key={r}
            x1={pad}
            y1={py(maxVal * r)}
            x2={W - pad}
            y2={py(maxVal * r)}
            stroke="currentColor"
            strokeOpacity="0.1"
            strokeDasharray="4 4"
          />
        ))}
        <polyline
          fill="none"
          stroke="#34d399"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={items
            .map((d: any, i: number) => `${px(i)},${py(d.activity)}`)
            .join(" ")}
        />
        <polyline
          fill="none"
          stroke="#818cf8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={items
            .map((d: any, i: number) => `${px(i)},${py(d.tasks)}`)
            .join(" ")}
        />
        {items.map((d: any, i: number) => (
          <g key={i}>
            <circle cx={px(i)} cy={py(d.activity)} r="3" fill="#34d399" />
            <circle cx={px(i)} cy={py(d.tasks)} r="3" fill="#818cf8" />
            <text
              x={px(i)}
              y={H - 4}
              textAnchor="middle"
              fontSize="9"
              fill="currentColor"
              opacity="0.5"
            >
              {d.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex gap-4 justify-center text-xs">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-emerald-400 inline-block rounded" />{" "}
          Activity
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-violet-400 inline-block rounded" />{" "}
          Tasks
        </span>
      </div>
    </div>
  );
}

function PieChartWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const s = data?.summary;
  const slices = [
    { label: "Open", value: s?.openTasks || 0, color: "#60a5fa" },
    { label: "In Progress", value: s?.inProgressTasks || 0, color: "#a78bfa" },
    { label: "Closed", value: s?.closedTasks || 0, color: "#34d399" },
    { label: "Reviewed", value: s?.reviewedTasks || 0, color: "#2dd4bf" },
  ].filter((sl) => sl.value > 0);
  const total = slices.reduce((acc, sl) => acc + sl.value, 0);
  if (!total)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No task data available.
      </p>
    );
  let cum = 0;
  const paths = slices.map((sl) => {
    const pct = sl.value / total,
      start = cum,
      end = cum + pct;
    cum = end;
    const a1 = (start * 2 - 0.5) * Math.PI,
      a2 = (end * 2 - 0.5) * Math.PI;
    const r = 70,
      cx = 90,
      cy = 90;
    return {
      d: `M${cx},${cy} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} A${r},${r} 0 ${pct > 0.5 ? 1 : 0} 1 ${cx + r * Math.cos(a2)},${cy + r * Math.sin(a2)} Z`,
      ...sl,
    };
  });
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg viewBox="0 0 180 180" className="w-36 h-36 shrink-0">
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} opacity="0.85" />
        ))}
      </svg>
      <div className="space-y-2">
        {slices.map((sl) => (
          <div key={sl.label} className="flex items-center gap-2 text-sm">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ background: sl.color }}
            />
            <span className="text-muted-foreground">{sl.label}</span>
            <span className="font-bold ml-auto">{sl.value}</span>
          </div>
        ))}
        <p className="text-xs text-muted-foreground pt-1">
          Total: {total} tasks
        </p>
      </div>
    </div>
  );
}

function StatCardWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const s = data?.summary;
  const cards = [
    {
      label: "Total Users",
      value: fmtNum(s?.totalUsers || 0),
      color: "text-blue-400",
    },
    {
      label: "Total Activity",
      value: fmtNum(s?.totalActivity || 0),
      color: "text-violet-400",
    },
    {
      label: "Open Tasks",
      value: fmtNum(s?.openTasks || 0),
      color: "text-amber-400",
    },
    {
      label: "Total Payments",
      value: fmtCur(s?.paymentAmountTotal || 0),
      color: "text-emerald-400",
    },
    {
      label: "Active Leads",
      value: fmtNum(s?.totalLeads || 0),
      color: "text-rose-400",
    },
    {
      label: "Pending Follow-Ups",
      value: fmtNum(s?.pendingFollowups || 0),
      color: "text-orange-400",
    },
    {
      label: "CRM Bookings",
      value: fmtNum(s?.activeCrmBookings || 0),
      color: "text-cyan-400",
    },
    {
      label: "CRM Overdue Payments",
      value: fmtNum(s?.crmOverduePayments || 0),
      color: "text-red-400",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="bg-muted/20 rounded-xl p-3 space-y-1">
          <p className="text-xs text-muted-foreground">{c.label}</p>
          <p className={`text-lg font-bold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function DataTableWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const tasks = data?.recent?.tasks || [];
  if (!tasks.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No tasks found.
      </p>
    );
  const colors: Record<string, string> = {
    High: "text-red-400",
    Medium: "text-amber-400",
    Low: "text-emerald-400",
  };
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        Recent Tasks
      </p>
      <div className="divide-y divide-border">
        {tasks.slice(0, 5).map((t: any) => (
          <div
            key={t.id}
            className="py-2 flex items-center justify-between gap-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{t.title}</p>
              <p className="text-xs text-muted-foreground">
                {t.assignedToName || "Unassigned"}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`text-xs font-semibold ${colors[t.priority] || "text-muted-foreground"}`}
              >
                {t.priority}
              </span>
              <span className="text-xs text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-full">
                {t.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CalendarWidget() {
  const today = new Date();
  const [cur, setCur] = useState(today);
  const year = cur.getFullYear(),
    month = cur.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: first + days }, (_, i) =>
    i < first ? null : i - first + 1,
  );
  while (cells.length % 7 !== 0) cells.push(null);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCur(new Date(year, month - 1, 1))}
          className="p-1 rounded hover:bg-muted/40 text-muted-foreground"
        >
          ‹
        </button>
        <p className="text-sm font-bold">
          {cur.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
        </p>
        <button
          onClick={() => setCur(new Date(year, month + 1, 1))}
          className="p-1 rounded hover:bg-muted/40 text-muted-foreground"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <span
            key={i}
            className="text-[10px] text-muted-foreground font-medium py-1"
          >
            {d}
          </span>
        ))}
        {cells.map((d, i) => (
          <div
            key={i}
            className={`text-xs py-1 rounded-md font-medium transition-colors
            ${
              d === today.getDate() &&
              month === today.getMonth() &&
              year === today.getFullYear()
                ? "bg-primary text-primary-foreground"
                : d
                  ? "hover:bg-muted/40 text-foreground cursor-pointer"
                  : ""
            }`}
          >
            {d || ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationsWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const alerts = data?.alerts || [];
  if (!alerts.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No alerts at this time.
      </p>
    );
  const colors: Record<string, string> = {
    critical: "text-red-400 bg-red-400/10",
    warning: "text-amber-400 bg-amber-400/10",
    info: "text-blue-400 bg-blue-400/10",
  };
  return (
    <div className="space-y-2">
      {alerts.slice(0, 4).map((a: any, i: number) => (
        <div
          key={i}
          className={`flex gap-3 p-3 rounded-lg ${colors[a.type] || "text-muted-foreground bg-muted/20"}`}
        >
          <div className="shrink-0 mt-0.5">
            {a.type === "critical" ? "🔴" : a.type === "warning" ? "⚠️" : "ℹ️"}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{a.title}</p>
            <p className="text-xs opacity-80 mt-0.5">{a.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityFeedWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const activity = data?.recent?.activity || [];
  if (!activity.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No recent activity.
      </p>
    );
  return (
    <div className="space-y-2">
      {activity.slice(0, 5).map((a: any, i: number) => (
        <div key={i} className="flex items-start gap-2 py-1.5">
          <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
            {a.userName?.charAt(0)?.toUpperCase() || "?"}
          </div>
          <div className="min-w-0">
            <p className="text-xs">
              <span className="font-semibold">{a.userName}</span>{" "}
              {a.event?.toLowerCase()}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {fmtTime(a.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── MAP VIEW WIDGET ─────────────────────────────────────────────────────────
// Plots each project (enterprise rows with business_type="P") as a marker on
// an OpenStreetMap tile layer via Leaflet — free, no API key. Projects that
// already have Latitude/Longitude use those directly; projects with only a
// free-text Address are geocoded client-side through Nominatim (OSM's free
// geocoder, results cached in-memory + rate-limited to its ~1 req/sec fair
// use policy). Projects with neither are skipped.
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();
let geocodeQueue: Promise<unknown> = Promise.resolve();
// Stable references for useQuery's default value — `data: x = []` would
// otherwise hand back a brand-new array every render while data is still
// undefined, which retriggers any effect depending on it every render and
// spins into "Maximum update depth exceeded".
const EMPTY_ENTERPRISES: Enterprise[] = [];

interface ProjectMarker {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
  companyName: string | null;
  lat: number;
  lng: number;
}

async function nominatimSearch(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    );
    const results = await res.json();
    const hit = results?.[0];
    return hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function geocodeAddress(addr: string): Promise<{ lat: number; lng: number } | null> {
  if (geocodeCache.has(addr)) return Promise.resolve(geocodeCache.get(addr)!);
  // Nominatim's fair-use policy caps this at ~1 req/sec — chain requests
  // through a single queue (with a trailing delay) so a widget with many
  // un-geocoded projects doesn't fire them all at once. Each lookup is
  // capped at 6s so one slow/unresolvable address can't stall the rest.
  const run = geocodeQueue.then(async () => {
    let coords: { lat: number; lng: number } | null = null;
    // Informal local addresses (e.g. "RATHTOLA EM BYPASS") often only
    // resolve once the leading, non-geographic word is dropped — try the
    // full string first, then progressively fewer leading words.
    const words = addr.split(/\s+/).filter(Boolean);
    const attempts = Math.min(words.length, 4);
    for (let drop = 0; drop < attempts; drop++) {
      coords = await nominatimSearch(words.slice(drop).join(" "));
      if (coords || drop === words.length - 1) break;
      await new Promise((r) => setTimeout(r, 1100));
    }
    geocodeCache.set(addr, coords);
    await new Promise((r) => setTimeout(r, 1100));
    return coords;
  });
  geocodeQueue = run.catch(() => null);
  return run;
}

function useProjectMarkers() {
  const [markers, setMarkers] = useState<ProjectMarker[]>([]);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeFailedCount, setGeocodeFailedCount] = useState(0);

  const { data: projects = EMPTY_ENTERPRISES, isLoading } = useQuery({
    queryKey: ["map-widget-projects"],
    queryFn: () => getEnterprisesByType("P"),
    staleTime: 5 * 60 * 1000,
  });
  const { data: companies = EMPTY_ENTERPRISES } = useQuery({
    queryKey: ["map-widget-companies"],
    queryFn: () => getEnterprisesByType("C"),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (projects.length === 0) {
      setMarkers([]);
      return;
    }
    let alive = true;
    const companyName = (id: number | null) =>
      id ? (companies.find((c) => c.id === id)?.name ?? null) : null;

    const withCoords: ProjectMarker[] = [];
    const needsGeocode: typeof projects = [];
    for (const p of projects) {
      if (p.latitude != null && p.longitude != null) {
        withCoords.push({
          id: p.id,
          name: p.name || `Project #${p.id}`,
          address: p.address,
          city: p.city,
          state: p.state,
          status: p.status,
          companyName: companyName(p.belongs_to),
          lat: Number(p.latitude),
          lng: Number(p.longitude),
        });
      } else if (p.address || p.city) {
        needsGeocode.push(p);
      }
    }

    setMarkers(withCoords);
    if (needsGeocode.length === 0) return;

    setGeocoding(true);
    Promise.all(
      needsGeocode.map(async (p) => {
        const addr = [p.address, p.city, p.state, p.country]
          .filter(Boolean)
          .join(", ");
        if (!addr) return null;
        const coords = await geocodeAddress(addr);
        if (!coords) return null;
        return {
          id: p.id,
          name: p.name || `Project #${p.id}`,
          address: p.address,
          city: p.city,
          state: p.state,
          status: p.status,
          companyName: companyName(p.belongs_to),
          lat: coords.lat,
          lng: coords.lng,
        } as ProjectMarker;
      }),
    ).then((geocoded) => {
      if (!alive) return;
      setMarkers([
        ...withCoords,
        ...geocoded.filter((m): m is ProjectMarker => m !== null),
      ]);
      setGeocodeFailedCount(geocoded.filter((m) => m === null).length);
      setGeocoding(false);
    });

    return () => {
      alive = false;
    };
  }, [projects, companies]);

  return { markers, loading: isLoading, geocoding, geocodeFailedCount };
}

// Leaflet's default marker icon references image files by URL, which
// bundlers like Vite don't resolve automatically — point them at a CDN
// (same approach the Leaflet docs recommend for bundled apps) once, at
// module load.
let leafletIconPatched = false;
function patchLeafletIcon(L: typeof import("leaflet")) {
  if (leafletIconPatched) return;
  leafletIconPatched = true;
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl:
      "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

function MapViewWidget() {
  const { markers, geocoding, geocodeFailedCount } = useProjectMarkers();
  const [LeafletMod, setLeafletMod] = useState<{
    L: typeof import("leaflet");
    RL: typeof import("react-leaflet");
  } | null>(null);

  useEffect(() => {
    Promise.all([import("leaflet"), import("react-leaflet")]).then(
      ([L, RL]) => {
        patchLeafletIcon(L);
        setLeafletMod({ L, RL });
      },
    );
  }, []);

  // Only block on a full-page spinner while nothing has resolved yet — once
  // at least one marker is ready, render the map and let the rest resolve
  // in the background (surfaced via the "Resolving…" note below instead).
  if (geocoding && markers.length === 0) return <Spinner />;

  if (!markers.length) {
    return (
      <div className="h-44 rounded-xl bg-muted/20 border border-border flex items-center justify-center">
        <div className="text-center space-y-2 px-4">
          <MapIcon size={32} className="text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            {geocodeFailedCount > 0
              ? `Couldn't locate ${geocodeFailedCount} project address${geocodeFailedCount > 1 ? "es" : ""}`
              : "No project locations to show"}
          </p>
          <p className="text-xs text-muted-foreground/60">
            {geocodeFailedCount > 0
              ? "Try adding City/State to the project's address, or set GPS coordinates directly."
              : "Add an address or coordinates to a project to see it here."}
          </p>
        </div>
      </div>
    );
  }

  if (!LeafletMod) return <Spinner />;

  const { MapContainer, TileLayer, Marker, Popup } = LeafletMod.RL;
  const center: [number, number] = markers.length
    ? [markers[0].lat, markers[0].lng]
    : [22.5726, 88.3639]; // fallback: Kolkata

  return (
    <div className="space-y-2">
      <div className="rounded-xl overflow-hidden border border-border" style={{ height: 320 }}>
        <MapContainer
          center={center}
          zoom={markers.length > 1 ? 6 : 12}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {markers.map((m) => (
            <Marker key={m.id} position={[m.lat, m.lng]}>
              <Popup>
                <div className="text-xs space-y-1 max-w-[200px]">
                  <p className="font-bold text-sm">{m.name}</p>
                  {m.companyName && <p>{m.companyName}</p>}
                  {(m.address || m.city) && (
                    <p>{[m.address, m.city, m.state].filter(Boolean).join(", ")}</p>
                  )}
                  {m.status && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold">
                      {m.status}
                    </span>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {geocoding && (
        <p className="text-[10px] text-muted-foreground text-center">
          Resolving project addresses…
        </p>
      )}
    </div>
  );
}

function FileUploaderWidget() {
  const [files, setFiles] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const handle = (f: FileList | null) => {
    if (!f) return;
    setFiles((prev) =>
      [...prev, ...Array.from(f).map((x) => x.name)].slice(0, 5),
    );
  };
  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handle(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-all cursor-pointer
          ${drag ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
        onClick={() => document.getElementById("fw-input")?.click()}
      >
        <Paperclip size={24} className="text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Drop files here or click to upload
        </p>
        <input
          id="fw-input"
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handle(e.target.files)}
        />
      </div>
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-xs bg-muted/20 rounded-lg px-3 py-2"
            >
              <span className="truncate text-muted-foreground">{f}</span>
              <button
                onClick={() =>
                  setFiles((prev) => prev.filter((_, j) => j !== i))
                }
                className="ml-2 text-muted-foreground hover:text-foreground shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressRingWidget() {
  const { data, loading } = useWidgetsData();
  if (loading) return <Spinner />;
  const s = data?.summary;
  const total = s?.totalTasks || 0;
  const done = (s?.closedTasks || 0) + (s?.reviewedTasks || 0);
  const inProg = s?.inProgressTasks || 0;
  const completion = total ? Math.round((done / total) * 100) : 0;
  const inProgPct = total ? Math.round((inProg / total) * 100) : 0;
  const userPct = s?.totalUsers
    ? Math.round((s.activeUsers / s.totalUsers) * 100)
    : 100;
  const Ring = ({
    pct,
    color,
    label,
  }: {
    pct: number;
    color: string;
    label: string;
  }) => {
    const r = 32,
      circ = 2 * Math.PI * r;
    return (
      <div className="flex flex-col items-center gap-2">
        <svg width="80" height="80" className="-rotate-90">
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.1"
            strokeWidth="6"
          />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={`${(pct / 100) * circ} ${circ}`}
            strokeLinecap="round"
          />
          <text
            x="40"
            y="40"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="currentColor"
            fontSize="13"
            fontWeight="bold"
            transform="rotate(90, 40, 40)"
          >
            {pct}%
          </text>
        </svg>
        <span className="text-xs text-muted-foreground text-center">
          {label}
        </span>
      </div>
    );
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-around">
        <Ring pct={completion} color="#34d399" label="Tasks done" />
        <Ring pct={inProgPct} color="#a78bfa" label="In progress" />
        <Ring pct={userPct} color="#60a5fa" label="Users active" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <p className="font-bold text-emerald-400">{done}</p>
          <p className="text-muted-foreground">Completed</p>
        </div>
        <div>
          <p className="font-bold text-violet-400">{inProg}</p>
          <p className="text-muted-foreground">In Progress</p>
        </div>
        <div>
          <p className="font-bold text-blue-400">{s?.activeUsers || 0}</p>
          <p className="text-muted-foreground">Active Users</p>
        </div>
      </div>
    </div>
  );
}

function CalculatorWidget() {
  const [display, setDisplay] = useState("0");
  const [prev, setPrev] = useState<string | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [reset, setReset] = useState(false);
  const press = (val: string) => {
    if (val === "C") {
      setDisplay("0");
      setPrev(null);
      setOp(null);
      setReset(false);
      return;
    }
    if (val === "±") {
      setDisplay((d) => String(-parseFloat(d) || 0));
      return;
    }
    if (val === "%") {
      setDisplay((d) => String(parseFloat(d) / 100));
      return;
    }
    if (["+", "−", "×", "÷"].includes(val)) {
      setPrev(display);
      setOp(val);
      setReset(true);
      return;
    }
    if (val === "=") {
      if (!prev || !op) return;
      const a = parseFloat(prev),
        b = parseFloat(display);
      const r =
        op === "+"
          ? a + b
          : op === "−"
            ? a - b
            : op === "×"
              ? a * b
              : b !== 0
                ? a / b
                : 0;
      setDisplay(String(parseFloat(r.toFixed(8))));
      setPrev(null);
      setOp(null);
      setReset(false);
      return;
    }
    if (val === ".") {
      if (reset) {
        setDisplay("0.");
        setReset(false);
        return;
      }
      if (!display.includes(".")) setDisplay((d) => d + ".");
      return;
    }
    if (reset) {
      setDisplay(val);
      setReset(false);
      return;
    }
    setDisplay((d) => (d === "0" ? val : d.length < 12 ? d + val : d));
  };
  const rows = [
    ["C", "±", "%", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "−"],
    ["1", "2", "3", "+"],
    [" ", "0", ".", "="],
  ];
  const isOp = (v: string) => ["+", "−", "×", "÷", "="].includes(v);
  const isFn = (v: string) => ["C", "±", "%"].includes(v);
  return (
    <div className="max-w-[220px] mx-auto space-y-3">
      <div className="bg-muted/30 rounded-xl p-4 text-right min-h-[72px]">
        {op && (
          <p className="text-xs text-muted-foreground">
            {prev} {op}
          </p>
        )}
        <p className="text-3xl font-bold tracking-tight truncate">{display}</p>
      </div>
      <div className="space-y-2">
        {rows.map((row, ri) => (
          <div key={ri} className="grid grid-cols-4 gap-2">
            {row.map((btn, bi) =>
              btn === " " ? (
                <div key={bi} />
              ) : (
                <button
                  key={btn}
                  onClick={() => press(btn)}
                  className={`h-11 rounded-xl text-sm font-semibold transition-all active:scale-95
                  ${
                    isOp(btn)
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : isFn(btn)
                        ? "bg-muted/60 hover:bg-muted"
                        : "bg-muted/30 hover:bg-muted/50"
                  }`}
                >
                  {btn}
                </button>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingVehicleInOutWidget() {
  const navigate = useNavigate();
  const { data: pending = [], isLoading } = useQuery<
    PendingVehicleInOutSummary[]
  >({
    queryKey: ["pending-vehicle-in-out"],
    queryFn: getPendingVehicleSummary,
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });
  if (isLoading) return <Spinner />;
  if (!pending.length)
    return (
      <p className="text-sm text-muted-foreground text-center py-10">
        No pending vehicles — every PO is fully delivered.
      </p>
    );

  const goTo = (row: PendingVehicleInOutSummary) => {
    if (row.lastVehicleInOutId) {
      navigate(`/material/vehicle-in-out?view=${row.lastVehicleInOutId}`);
    } else {
      navigate(`/material/vehicle-in-out?newForPO=${row.poId}`);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide flex items-center justify-between">
        <span>Pending Vehicle In/Out</span>
        <span className="text-foreground font-bold text-sm">
          {pending.length}
        </span>
      </p>
      <div className="divide-y divide-border max-h-80 overflow-y-auto">
        {pending.map((row) => (
          <button
            key={row.poId}
            onClick={() => goTo(row)}
            className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-muted/20 rounded-lg px-2 -mx-2 transition-colors"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {row.poNumber || `PO #${row.poId}`}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {row.supplierName || "—"}
                {row.lastVehicleInOutDocNo
                  ? ` · Last: ${row.lastVehicleInOutDocNo}`
                  : " · No vehicle logged yet"}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-amber-500">
                {fmtNum(row.pendingQty)}
              </p>
              <p className="text-[10px] text-muted-foreground">
                of {fmtNum(row.totalOrdered)} pending
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── WIDGET MAP ───────────────────────────────────────────────────────────────
const widgetComponents: Record<string, React.ComponentType> = {
  "Bar Chart": BarChartWidget,
  "Line Chart": LineChartWidget,
  "Pie Chart": PieChartWidget,
  "Stat Card": StatCardWidget,
  "Data Table": DataTableWidget,
  Calendar: CalendarWidget,
  Notifications: NotificationsWidget,
  "Activity Feed": ActivityFeedWidget,
  "Map View": MapViewWidget,
  "File Uploader": FileUploaderWidget,
  "Progress Ring": ProgressRingWidget,
  Calculator: CalculatorWidget,
  "Pending Vehicle In/Out": PendingVehicleInOutWidget,
};

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
const Widgets = () => {
  const [searchParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(
    searchParams.get("w"),
  );

  const {
    catalog,
    loading: catalogLoading,
  } = useWidgetCatalog();
  const {
    allowedSet,
    loading: rightsLoading,
  } = useAllowedWidgets();

  // allowedSet null = still loading or rights failed → show all catalog widgets as fallback
  const visibleWidgets = catalog.filter(
    (w) => (!allowedSet || allowedSet.has(w.key)) && widgetComponents[w.key],
  );

  const safeSelected =
    selected && (!allowedSet || allowedSet.has(selected)) ? selected : null;
  const ActiveWidget = safeSelected ? widgetComponents[safeSelected] : null;
  const selectedWidget = safeSelected
    ? catalog.find((w) => w.key === safeSelected)
    : null;
  const SelectedIcon = selectedWidget
    ? widgetIcons[selectedWidget.iconKey] || Puzzle
    : Puzzle;
  const loading = rightsLoading || catalogLoading;

  return (
    <>
      <Breadcrumbs items={["Dashboard", safeSelected || "Widgets"]} />

      <AdminShell
        title={selectedWidget ? selectedWidget.label : "Widgets"}
        subtitle={selectedWidget ? "Viewing widget" : "Select a widget to view"}
        icon={Puzzle}
      >
      {loading ? (
        // Skeleton while loading rights — avoid flash
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-lg border border-border bg-muted/20 animate-pulse"
            />
          ))}
        </div>
      ) : safeSelected ? (
        <div className="max-w-lg mx-auto mt-4">
          <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-3">
                {(() => {
                  return <SelectedIcon size={20} className="text-primary" />;
                })()}
                <h1 className="text-base font-bold">
                  {selectedWidget?.label || safeSelected}
                </h1>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              {ActiveWidget ? (
                <ActiveWidget />
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Widget not found.
                </p>
              )}
            </div>
          </div>
          <button
            onClick={() => setSelected(null)}
            className="mt-4 flex items-center gap-1.5 text-sm text-primary hover:underline font-heading mx-auto"
          >
            <X size={14} /> Back to all widgets
          </button>
        </div>
      ) : (
        <>
          {visibleWidgets.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <Puzzle size={32} className="text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">
                No widgets are enabled for your account.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Contact your administrator to enable widget access.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {visibleWidgets.map(({ iconKey, key, label }) => {
                const Icon = widgetIcons[iconKey] || Puzzle;
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(key)}
                    className="flex flex-col items-center gap-2 p-5 rounded-lg border border-border bg-card
                    transition-all hover:bg-accent/10 hover:shadow-md hover:-translate-y-0.5 hover:border-primary"
                  >
                    <Icon size={28} className="text-primary" />
                    <span className="text-xs text-muted-foreground font-heading">
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      </AdminShell>
    </>
  );
};

export default Widgets;
