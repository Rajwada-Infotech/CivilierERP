// Maintenance → Security Live: the security supervisor's room (doc phase 3).
//   Live map   every guard on shift: last position (blue in the zone, red outside, grey unjudged or stale), the trail of
//              the shift so far, and the zones; re-read every 15 s.
//   Replay     one guard's route between two times, with a slider that walks the guard along it.
//   Alerts     left the zone / device offline / request unanswered; acknowledge them.
//   Visitor log every visitor request, searchable and filterable, with the photo on request.
//   Complaints  residents' complaints about guards: review them with a note the resident sees in their app.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Check, Download, Image as ImageIcon, Loader2, Pause, Play, Search } from "lucide-react";
import { connectSocket } from "@/lib/socket";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, SheetBox, SheetTabs, TD, TH } from "@/components/maintenance/maintParts";
import { HrStatStrip } from "@/components/hrpayroll/HrUi";
import { SheetMark, type MarkTone } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
import { usePageRights } from "@/hooks/usePageRights";
import {
  acknowledgeAlert,
  fetchVisitorPhoto,
  getAlerts,
  getGates,
  getLive,
  getTrackedGuards,
  getTrail,
  getVisitorLog,
  getComplaints,
  reviewComplaint,
  type ComplaintStatus,
  type SecurityComplaint,
  type LatLng,
  type LiveGuard,
  type LiveZone,
  type VisitorLogRow,
} from "@/api/securityIntercomApi";
import { EmptyRow, SheetDialog, fieldCls, filterCls, flatLabel, inlineFieldCls } from "./securityParts";
import { HR_LBL as LBL } from "@/components/hrpayroll/HrUi";

const PAGE_KEY = "security-live";
type Tab = "map" | "replay" | "alerts" | "log" | "complaints";
const TABS: { value: Tab; label: string }[] = [
  { value: "map", label: "Live map" },
  { value: "replay", label: "Replay" },
  { value: "alerts", label: "Alerts" },
  { value: "log", label: "Visitor log" },
  { value: "complaints", label: "Complaints" },
];
const ALERT_LABEL = { LEFT_ZONE: "Left the zone", DEVICE_OFFLINE: "Device offline", UNANSWERED: "Request unanswered" } as const;
const STATUS: Record<VisitorLogRow["status"], { text: string; tone: MarkTone }> = {
  PENDING: { text: "Waiting", tone: "waiting" },
  APPROVED: { text: "Approved", tone: "done" },
  DENIED: { text: "Denied", tone: "stopped" },
  NO_RESPONSE: { text: "No response", tone: "draft" },
};
const OSM = { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' };
const STALE_MS = 5 * 60 * 1000;

/** A theme colour as a concrete value (SVG attributes on the map can't read CSS variables). */
function tok(name: string) {
  if (typeof window === "undefined") return "#888";
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : "#888";
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};
const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** Fits the map to these points once they first arrive (and when the set changes size a lot). */
function FitTo({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.length ? `${points.length > 1 ? "many" : "one"}:${points[0][0].toFixed(3)}` : "";
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 17);
    else map.fitBounds(points, { padding: [30, 30], maxZoom: 18 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

function ZoneLayer({ zones }: { zones: LiveZone[] }) {
  const ink = tok("--foreground");
  return (
    <>
      {zones.flatMap((z) =>
        z.shapes.map((ring, i) => (
          <Polygon key={`${z.id}-${i}`} positions={ring} pathOptions={{ color: ink, weight: 1, opacity: 0.5, fillColor: ink, fillOpacity: 0.06 }}>
            {i === 0 && <Tooltip sticky>{z.gateName ? `${z.name} · ${z.gateName}` : z.name}</Tooltip>}
          </Polygon>
        )),
      )}
    </>
  );
}

function guardTone(g: LiveGuard) {
  if (!g.last || Date.now() - new Date(g.last.at).getTime() > STALE_MS) return "stale" as const;
  return g.last.inZone === false ? ("out" as const) : g.last.inZone ? ("in" as const) : ("unknown" as const);
}

/** Re-reads the live map and alerts the moment the server reports a ping or an alert (socket room "security-live"). */
function useLiveSocket() {
  const qc = useQueryClient();
  useEffect(() => {
    const s = connectSocket();
    if (!s) return;
    const join = () => s.emit("security:live:join");
    join();
    s.on("connect", join);
    const onLive = () => {
      void qc.invalidateQueries({ queryKey: ["security-complaints"] });
      void qc.invalidateQueries({ queryKey: ["security-live"] });
      void qc.invalidateQueries({ queryKey: ["security-alerts"] });
    };
    s.on("security:live", onLive);
    return () => {
      s.off("connect", join);
      s.off("security:live", onLive);
    };
  }, [qc]);
}

function LiveMapTab() {
  useLiveSocket();
  const { data, isLoading, error, dataUpdatedAt } = useQuery({ queryKey: ["security-live"], queryFn: getLive, refetchInterval: 30000 });
  const guards = data?.guards ?? [];
  const zones = data?.zones ?? [];
  const blue = tok("--primary");
  const red = tok("--destructive");
  const grey = tok("--muted-foreground");
  const points: LatLng[] = useMemo(() => {
    const pts = guards.filter((g) => g.last).map((g) => [g.last!.lat, g.last!.lng] as LatLng);
    return pts.length ? pts : zones.flatMap((z) => z.shapes.flat()).slice(0, 200);
  }, [guards, zones]);
  const counts = { out: guards.filter((g) => guardTone(g) === "out").length, stale: guards.filter((g) => guardTone(g) === "stale").length };

  return (
    <div className="space-y-4">
      <HrStatStrip
        items={[
          { label: "On shift", value: isLoading ? "…" : guards.length },
          { label: "Outside the zone", value: isLoading ? "…" : counts.out, tone: counts.out ? "hsl(var(--destructive))" : undefined },
          { label: "No recent location", value: isLoading ? "…" : counts.stale, tone: counts.stale ? "hsl(var(--destructive))" : undefined, hint: "Nothing in 5 minutes" },
        ]}
      />
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="border border-foreground bg-card" style={{ height: 560 }}>
          <MapContainer center={[22.5726, 88.3639]} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
            <TileLayer url={OSM.url} attribution={OSM.attribution} />
            <ZoneLayer zones={zones} />
            {guards.map((g) => {
              const tone = guardTone(g);
              const c = tone === "out" ? red : tone === "in" ? blue : grey;
              return (
                <Fragment key={g.guardUserId}>
                  {g.trail.length > 1 && <Polyline positions={g.trail} pathOptions={{ color: c, weight: 3, opacity: 0.7 }} />}
                  {g.last && (
                    <CircleMarker center={[g.last.lat, g.last.lng]} radius={9} pathOptions={{ color: tok("--card"), weight: 2, fillColor: c, fillOpacity: 1 }}>
                      <Tooltip direction="top" offset={[0, -8]}>
                        {g.name} · {g.gateName} · {ago(g.last.at)}
                        {g.last.battery != null ? ` · battery ${g.last.battery}%` : ""}
                      </Tooltip>
                    </CircleMarker>
                  )}
                </Fragment>
              );
            })}
            <FitTo points={points} />
          </MapContainer>
        </div>
        <SheetBox title="Guards on shift" note={dataUpdatedAt ? `read ${new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : undefined} flush>
          <div className="max-h-[512px] overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Reading…</p>
            ) : guards.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">No guard is on shift right now.</p>
            ) : (
              guards.map((g) => {
                const tone = guardTone(g);
                return (
                  <div key={g.guardUserId} className="px-4 py-2.5 border-b border-foreground/10 last:border-b-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate">{g.name}</span>
                      <SheetMark
                        text={tone === "out" ? "Outside" : tone === "in" ? "In zone" : tone === "stale" ? "No signal" : "Unjudged"}
                        tone={tone === "out" || tone === "stale" ? "stopped" : tone === "in" ? "done" : "draft"}
                      />
                    </div>
                    <p className="text-[0.6875rem] text-muted-foreground">
                      {g.gateName} · seen {ago(g.last?.at ?? null)}
                      {g.last?.battery != null ? ` · ${g.last.battery}%` : ""}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </SheetBox>
      </div>
      <p className="text-[0.6875rem] text-muted-foreground">
        Blue: inside the zone. Red: outside (an alert is raised after 3 readings in a row). Grey: no location in 5 minutes, or a reading too imprecise to judge.
      </p>
    </div>
  );
}

function ReplayTab() {
  const { data: guards = [] } = useQuery({ queryKey: ["security-tracked-guards"], queryFn: getTrackedGuards });
  const now = new Date();
  const [guardId, setGuardId] = useState("");
  const [from, setFrom] = useState(localInput(new Date(now.getTime() - 8 * 3600000)));
  const [to, setTo] = useState(localInput(now));
  const [asked, setAsked] = useState<{ id: number; from: string; to: string } | null>(null);
  const [pos, setPos] = useState(0);
  const { data: live } = useQuery({ queryKey: ["security-live"], queryFn: getLive });
  const { data, isFetching, error } = useQuery({
    queryKey: ["security-trail", asked],
    queryFn: () => getTrail(asked!.id, new Date(asked!.from).toISOString(), new Date(asked!.to).toISOString()),
    enabled: !!asked,
  });
  useEffect(() => setPos(data ? data.points.length - 1 : 0), [data]);
  const pts = data?.points ?? [];
  // Play: walks the route from where the slider is (from the start when it's at the end). At 1× a whole shift plays
  // in about 30 seconds, whatever its length.
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  useEffect(() => setPlaying(false), [data]);
  useEffect(() => {
    if (!playing || pts.length < 2) return;
    const step = Math.max(1, Math.round((pts.length / 375) * speed));
    const t = setInterval(() => {
      setPos((p) => {
        const next = Math.min(pts.length - 1, p + step);
        if (next >= pts.length - 1) setPlaying(false);
        return next;
      });
    }, 80);
    return () => clearInterval(t);
  }, [playing, speed, pts.length]);
  const togglePlay = () => {
    if (!playing && pos >= pts.length - 1) setPos(0);
    setPlaying(!playing);
  };
  const here = pts[Math.min(pos, pts.length - 1)];
  const blue = tok("--primary");
  const red = tok("--destructive");

  return (
    <div className="space-y-4">
      <SheetBox title="Replay a shift">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs">
            <span className="block mb-1 text-muted-foreground">Guard</span>
            <select value={guardId} onChange={(e) => setGuardId(e.target.value)} className={`${inlineFieldCls} w-56`}>
              <option value="">Choose…</option>
              {guards.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block mb-1 text-muted-foreground">From</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inlineFieldCls} w-52 font-heading tabular-nums`} />
          </label>
          <label className="text-xs">
            <span className="block mb-1 text-muted-foreground">To</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={`${inlineFieldCls} w-52 font-heading tabular-nums`} />
          </label>
          <button
            type="button"
            className={`${KEY_INK} h-9 px-4`}
            disabled={!guardId || !from || !to}
            onClick={() => (new Date(to) <= new Date(from) ? toast.error("The end must be after the start.") : setAsked({ id: Number(guardId), from, to }))}
          >
            {isFetching ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Show route
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{(error as Error).message}</p>}
      </SheetBox>

      {data && (
        <>
          <HrStatStrip
            items={[
              { label: "Readings", value: data.count },
              { label: "Distance", value: data.distanceM >= 1000 ? `${(data.distanceM / 1000).toFixed(1)} km` : `${data.distanceM} m` },
              { label: "Outside the zone", value: data.judged ? `${Math.round((data.outside / data.judged) * 100)}%` : "—", tone: data.outside ? "hsl(var(--destructive))" : undefined },
            ]}
          />
          <div className="border border-foreground bg-card" style={{ height: 520 }}>
            <MapContainer center={[22.5726, 88.3639]} zoom={15} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
              <TileLayer url={OSM.url} attribution={OSM.attribution} />
              <ZoneLayer zones={live?.zones ?? []} />
              {pts.length > 1 && <Polyline positions={pts.map((p) => [p.lat, p.lng] as LatLng)} pathOptions={{ color: blue, weight: 3, opacity: 0.35 }} />}
              {pts.length > 1 && <Polyline positions={pts.slice(0, pos + 1).map((p) => [p.lat, p.lng] as LatLng)} pathOptions={{ color: blue, weight: 4 }} />}
              {here && (
                <CircleMarker center={[here.lat, here.lng]} radius={9} pathOptions={{ color: tok("--card"), weight: 2, fillColor: here.inZone === false ? red : blue, fillOpacity: 1 }} />
              )}
              <FitTo points={pts.map((p) => [p.lat, p.lng] as LatLng)} />
            </MapContainer>
          </div>
          {pts.length > 0 ? (
            <div className="flex items-center gap-3">
              <button type="button" onClick={togglePlay} disabled={pts.length < 2} className={`${KEY_INK} h-8 px-3`} aria-label={playing ? "Pause the replay" : "Play the replay"}>
                {playing ? <Pause size={13} /> : <Play size={13} />} {playing ? "Pause" : "Play"}
              </button>
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className={`${filterCls} w-20`} aria-label="Replay speed">
                {[1, 2, 4, 8].map((x) => (
                  <option key={x} value={x}>{x}×</option>
                ))}
              </select>
              <input
                type="range"
                min={0}
                max={pts.length - 1}
                value={pos}
                onChange={(e) => {
                  setPlaying(false);
                  setPos(Number(e.target.value));
                }}
                className="flex-1"
                aria-label="Time"
              />
              <span className="font-heading tabular-nums text-xs w-44 text-right">
                {here ? `${when(here.at)}${here.inZone === false ? " · outside" : ""}` : ""}
              </span>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No location was recorded for this guard in that time.</p>
          )}
        </>
      )}
    </div>
  );
}

function AlertsTab({ canAck }: { canAck: boolean }) {
  useLiveSocket();
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["security-alerts", openOnly], queryFn: () => getAlerts(openOnly), refetchInterval: 20000 });
  const [busy, setBusy] = useState<number | null>(null);
  const ack = async (id: number) => {
    setBusy(id);
    try {
      await acknowledgeAlert(id);
      toast.success("Acknowledged");
      void qc.invalidateQueries({ queryKey: ["security-alerts"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <SheetBox
      title="Alerts"
      note={data.length}
      flush
      action={
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Not acknowledged only
        </label>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={TH}>Alert</th>
              <th className={TH}>Guard</th>
              <th className={TH}>Raised</th>
              <th className={TH}>Status</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <EmptyRow cols={5}>Reading…</EmptyRow>
            ) : error ? (
              <EmptyRow cols={5}><span className="text-destructive">{(error as Error).message}</span></EmptyRow>
            ) : data.length === 0 ? (
              <EmptyRow cols={5}>{openOnly ? "Nothing waiting for acknowledgement." : "No alerts yet."}</EmptyRow>
            ) : (
              data.map((a) => (
                <tr key={a.id} className="hover:bg-primary/5">
                  <td className={TD}>
                    <span className={`font-semibold ${a.acknowledgedAt ? "" : "text-destructive"}`}>{ALERT_LABEL[a.type] ?? a.type}</span>
                    <span className="block text-[0.6875rem] text-muted-foreground">{[a.detail, a.projectName].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className={TD}>{a.guardName ?? "—"}</td>
                  <td className={`${TD} font-heading tabular-nums whitespace-nowrap`}>
                    {when(a.at)}
                    {a.escalatedAt && !a.acknowledgedAt && <span className="block text-[0.6875rem] text-destructive">Escalated</span>}
                  </td>
                  <td className={TD}>
                    {a.acknowledgedAt ? (
                      <span className="text-xs">
                        <SheetMark text="Acknowledged" tone="done" />
                        <span className="block text-[0.6875rem] text-muted-foreground">{a.acknowledgedBy} · {when(a.acknowledgedAt)}</span>
                      </span>
                    ) : (
                      <SheetMark text="Open" tone="stopped" />
                    )}
                  </td>
                  <td className={`${TD} text-right`}>
                    {canAck && !a.acknowledgedAt && (
                      <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => ack(a.id)} disabled={busy === a.id}>
                        {busy === a.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Acknowledge
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </SheetBox>
  );
}

function PhotoDialog({ row, onClose }: { row: VisitorLogRow; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    fetchVisitorPhoto(row.id)
      .then((x) => {
        u = x;
        setUrl(x);
      })
      .catch((e) => setErr((e as Error).message));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [row.id]);
  return (
    <SheetDialog title={`${row.visitorName || "Visitor"} · flat ${flatLabel(row.block, row.flat)}`} onClose={onClose}>
      {err ? <p className="text-sm text-destructive">{err}</p> : url ? <img src={url} alt="Visitor" className="w-full border border-foreground" /> : <p className="text-sm text-muted-foreground">Reading…</p>}
      <p className="text-xs text-muted-foreground">{row.reason} · {row.gateName} · {when(row.requestedAt)}</p>
    </SheetDialog>
  );
}

const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function VisitorLogTab({ canExport }: { canExport: boolean }) {
  const [exporting, setExporting] = useState(false);
  const today = localInput(new Date()).slice(0, 10);
  const weekAgo = localInput(new Date(Date.now() - 6 * 86400000)).slice(0, 10);
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [status, setStatus] = useState("");
  const [gateId, setGateId] = useState("");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const [photo, setPhoto] = useState<VisitorLogRow | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [from, to, status, gateId, debounced]);
  const { data: gates } = useQuery({ queryKey: ["security-gates"], queryFn: getGates });
  const { data, isLoading, error } = useQuery({
    queryKey: ["security-visitor-log", from, to, status, gateId, debounced, page],
    queryFn: () =>
      getVisitorLog({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
        status: status || undefined,
        gateId: gateId ? Number(gateId) : null,
        q: debounced || undefined,
        page,
      }),
  });
  const rows = data?.rows ?? [];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await getVisitorLog({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
        status: status || undefined,
        gateId: gateId ? Number(gateId) : null,
        q: debounced || undefined,
        exportAll: true,
      });
      const head = ["When", "Project", "Gate", "Flat", "Visitor", "Phone", "Vehicle", "Reason", "Outcome", "Answered by", "Answered at", "Guard"];
      const lines = all.rows.map((r) =>
        [when(r.requestedAt), r.projectName, r.gateName, flatLabel(r.block, r.flat), r.visitorName, r.visitorPhone, r.vehicleNo, r.reason, STATUS[r.status].text, r.decidedBy, r.decidedAt ? when(r.decidedAt) : "", r.guardName]
          .map(csvCell)
          .join(","),
      );
      const blob = new Blob(["\ufeff" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `visitor-log-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      if (all.total > all.rows.length) toast.info(`Exported the latest ${all.rows.length} of ${all.total}. Narrow the dates for the rest.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <SheetBox
        title="Visitor log"
        note={data?.total}
        flush
        action={
          canExport ? (
            <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => void exportCsv()} disabled={exporting || !data?.total}>
              {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Export CSV
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-foreground/20">
          <label className="flex flex-col gap-1">
            <span className={LBL}>From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${filterCls} w-40 font-heading tabular-nums`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LBL}>To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${filterCls} w-40 font-heading tabular-nums`} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={LBL}>Outcome</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${filterCls} w-40`}>
              <option value="">Any outcome</option>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>{v.text}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={LBL}>Gate</span>
            <select value={gateId} onChange={(e) => setGateId(e.target.value)} className={`${filterCls} w-56`}>
              <option value="">All gates</option>
              {(gates?.gates ?? []).map((g) => (
                <option key={g.id} value={g.id}>{g.projectName} · {g.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-[14rem]">
            <span className={LBL}>Search</span>
            <span className="relative">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, flat, vehicle, phone" className={`${filterCls} w-full pl-7`} />
            </span>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>When</th>
                <th className={TH}>Flat</th>
                <th className={TH}>Visitor</th>
                <th className={TH}>Reason</th>
                <th className={TH}>Gate · guard</th>
                <th className={TH}>Outcome</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <EmptyRow cols={7}>Reading…</EmptyRow>
              ) : error ? (
                <EmptyRow cols={7}><span className="text-destructive">{(error as Error).message}</span></EmptyRow>
              ) : rows.length === 0 ? (
                <EmptyRow cols={7}>No visitor matches.</EmptyRow>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-primary/5">
                    <td className={`${TD} font-heading tabular-nums whitespace-nowrap`}>{when(r.requestedAt)}</td>
                    <td className={TD}>
                      <span className="font-heading tabular-nums font-semibold">{flatLabel(r.block, r.flat)}</span>
                      <span className="block text-[0.6875rem] text-muted-foreground">{r.projectName}</span>
                    </td>
                    <td className={TD}>
                      {r.visitorName || "—"}
                      <span className="block text-[0.6875rem] text-muted-foreground font-heading tabular-nums">{[r.visitorPhone, r.vehicleNo].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className={TD}>{r.reason}</td>
                    <td className={TD}>
                      {r.gateName}
                      <span className="block text-[0.6875rem] text-muted-foreground">{r.guardName ?? ""}</span>
                    </td>
                    <td className={TD}>
                      <SheetMark text={STATUS[r.status].text} tone={STATUS[r.status].tone} />
                      <span className="block text-[0.6875rem] text-muted-foreground">
                        {r.status === "NO_RESPONSE" ? (r.noResponseBy === "GUARD" ? "Closed at the gate" : "Timed out") : r.decidedBy ? `${r.decidedBy} · ${when(r.decidedAt)}` : ""}
                      </span>
                    </td>
                    <td className={`${TD} text-right`}>
                      {r.hasPhoto && (
                        <button type="button" className={ICON_ACT} onClick={() => setPhoto(r)} aria-label="Photo" title="Photo">
                          <ImageIcon size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-foreground/20">
            <button type="button" className={`${KEY_LINE} h-8 px-3`} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="font-heading tabular-nums text-xs">{page} / {pages}</span>
            <button type="button" className={`${KEY_LINE} h-8 px-3`} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </SheetBox>
      {photo && <PhotoDialog row={photo} onClose={() => setPhoto(null)} />}
    </>
  );
}

const COMPLAINT_STATUS: Record<ComplaintStatus, { text: string; tone: MarkTone }> = {
  OPEN: { text: "Open", tone: "stopped" },
  IN_REVIEW: { text: "Looking into it", tone: "moving" },
  RESOLVED: { text: "Resolved", tone: "done" },
  DISMISSED: { text: "Closed", tone: "draft" },
};

function ReviewDialog({ c, onClose, onSaved }: { c: SecurityComplaint; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<ComplaintStatus>(c.status === "OPEN" ? "IN_REVIEW" : c.status);
  const [note, setNote] = useState(c.adminNote ?? "");
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      await reviewComplaint(c.id, status, note.trim());
      toast.success("Complaint updated; the resident is told");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <SheetDialog title={`${c.categoryLabel} · flat ${flatLabel(c.block, c.flat)}`} onClose={onClose} onSubmit={submit} saving={saving} submitLabel="Save" icon={<Check size={13} />} wide>
      <p className="text-sm">{c.description}</p>
      <p className="text-xs text-muted-foreground">
        {[c.residentName, c.residentMobile, `guard: ${c.guardName ?? "not named"}`, c.gateName, when(c.createdAt)].filter(Boolean).join(" · ")}
      </p>
      <label className="block text-xs">
        <span className="block mb-1 text-muted-foreground">Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as ComplaintStatus)} className={fieldCls}>
          <option value="IN_REVIEW">Looking into it</option>
          <option value="RESOLVED">Resolved</option>
          <option value="DISMISSED">Closed without action</option>
          <option value="OPEN">Open</option>
        </select>
      </label>
      <label className="block text-xs">
        <span className="block mb-1 text-muted-foreground">Note for the resident (required to resolve or close)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} className={`${fieldCls} h-auto py-2 resize-none`} />
      </label>
    </SheetDialog>
  );
}

function ComplaintsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [openOnly, setOpenOnly] = useState(true);
  const [reviewing, setReviewing] = useState<SecurityComplaint | null>(null);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["security-complaints"], queryFn: () => getComplaints(), refetchInterval: 30000 });
  const rows = openOnly ? data.filter((c) => c.status === "OPEN" || c.status === "IN_REVIEW") : data;
  return (
    <>
      <SheetBox
        title="Complaints about guards"
        note={rows.length}
        flush
        action={
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Open only
          </label>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Complaint</th>
                <th className={TH}>Guard</th>
                <th className={TH}>Resident</th>
                <th className={TH}>Raised</th>
                <th className={TH}>Status</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <EmptyRow cols={6}>Reading…</EmptyRow>
              ) : error ? (
                <EmptyRow cols={6}><span className="text-destructive">{(error as Error).message}</span></EmptyRow>
              ) : rows.length === 0 ? (
                <EmptyRow cols={6}>{openOnly ? "No open complaints." : "No complaints yet."}</EmptyRow>
              ) : (
                rows.map((c) => (
                  <tr key={c.id} className="hover:bg-primary/5 align-top">
                    <td className={TD}>
                      <span className="font-semibold">{c.categoryLabel}</span>
                      <span className="block text-xs text-muted-foreground max-w-md">{c.description}</span>
                      {c.adminNote && <span className="block text-[0.6875rem] mt-1">Note: {c.adminNote}{c.handledBy ? ` (${c.handledBy})` : ""}</span>}
                    </td>
                    <td className={TD}>
                      {c.guardName ?? <span className="text-muted-foreground">Not named</span>}
                      <span className="block text-[0.6875rem] text-muted-foreground">{c.gateName ?? ""}</span>
                    </td>
                    <td className={TD}>
                      {c.residentName ?? "—"}
                      <span className="block text-[0.6875rem] text-muted-foreground font-heading tabular-nums">flat {flatLabel(c.block, c.flat)} · {c.residentMobile ?? ""}</span>
                    </td>
                    <td className={`${TD} font-heading tabular-nums whitespace-nowrap`}>{when(c.createdAt)}</td>
                    <td className={TD}><SheetMark text={COMPLAINT_STATUS[c.status].text} tone={COMPLAINT_STATUS[c.status].tone} /></td>
                    <td className={`${TD} text-right`}>
                      {canEdit && (
                        <button type="button" className={`${KEY_LINE} h-8 px-3`} onClick={() => setReviewing(c)}>
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SheetBox>
      {reviewing && (
        <ReviewDialog
          c={reviewing}
          onClose={() => setReviewing(null)}
          onSaved={() => {
            setReviewing(null);
            void qc.invalidateQueries({ queryKey: ["security-complaints"] });
          }}
        />
      )}
    </>
  );
}

export default function SecurityLive() {
  const rights = usePageRights(PAGE_KEY);
  const [tab, setTab] = useState<Tab>("map");
  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Security Live"]} />
      <MaintenanceShell title="Security Live" subtitle="Guards on shift, their routes, alerts and the visitor log">
        <SheetTabs<Tab> tabs={TABS} value={tab} onChange={setTab} />
        {tab === "map" && <LiveMapTab />}
        {tab === "replay" && <ReplayTab />}
        {tab === "alerts" && <AlertsTab canAck={rights.canEdit} />}
        {tab === "log" && <VisitorLogTab canExport={rights.canExport} />}
        {tab === "complaints" && <ComplaintsTab canEdit={rights.canEdit} />}
      </MaintenanceShell>
    </>
  );
}
