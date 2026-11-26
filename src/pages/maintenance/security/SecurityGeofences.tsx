// Maintenance → Geofences: the zone each gate's guards must stay in while on shift (doc phase 3). A zone is either a
// set of hexagons around the gate (H3 cells: pick a radius and a hexagon size, then add or remove single hexagons by
// clicking them) or a hand-drawn polygon (click the map to add corners). The allowed distance lets a reading just outside
// the line still count as inside, for GPS drift near buildings. A gate's own zones apply to its guards; a project zone
// without a gate applies to gates that have none of their own.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Hexagon, Loader2, Pencil, Plus, Save, Trash2, Undo2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, ICON_ACT_RED, SheetBox, TAG, TD, TH } from "@/components/maintenance/maintParts";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";
import { usePageRights } from "@/hooks/usePageRights";
import {
  createZone,
  deleteZone,
  getGeofences,
  previewHexagons,
  updateZone,
  type GeofenceGate,
  type GeofenceZone,
  type LatLng,
  type ProjectOption,
  type ZoneInput,
} from "@/api/securityIntercomApi";
import { EmptyRow, Field, fieldCls } from "./securityParts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HR_HEAD } from "@/components/hrpayroll/HrUi";

const PAGE_KEY = "security-geofences";
const OSM = { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' };
const SIZES = [
  { res: 12, label: "Small (about 10 m)" },
  { res: 11, label: "Medium (about 29 m)" },
  { res: 10, label: "Large (about 76 m)" },
  { res: 9, label: "Very large (about 200 m)" },
];
function tok(name: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `hsl(${v})` : "#888";
}

function Fit({ points }: { points: LatLng[] }) {
  const map = useMap();
  const key = points.length ? `${points.length}:${points[0][0].toFixed(4)}` : "";
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView(points[0], 18);
    else map.fitBounds(points, { padding: [24, 24], maxZoom: 19 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
function Clicks({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onClick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

export default function SecurityGeofences() {
  const rights = usePageRights(PAGE_KEY);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["security-geofences"], queryFn: getGeofences });
  const [editing, setEditing] = useState<GeofenceZone | "new" | null>(null);
  const zones = data?.zones ?? [];
  const remove = async (z: GeofenceZone) => {
    if (!window.confirm(`Delete the zone "${z.name}"? This can't be undone. A zone that alerts refer to can only be set inactive.`)) return;
    try {
      await deleteZone(z.id);
      toast.success("Zone deleted");
      void qc.invalidateQueries({ queryKey: ["security-geofences"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const gatesWithout = (data?.gates ?? []).filter((g) => !zones.some((z) => z.isActive && (z.gateId === g.id || (z.gateId == null && z.projectId === g.projectId))));

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Geofences"]} />
      <MaintenanceShell
        title="Geofences"
        subtitle="The zone each gate's guards stay in while on shift"
        action={
          rights.canCreate ? (
            <button type="button" onClick={() => setEditing("new")} className={`${KEY_INK} h-9 px-4`}>
              <Plus size={13} /> New Zone
            </button>
          ) : undefined
        }
      >
        {gatesWithout.length > 0 && (
          <p className="text-sm text-destructive border border-destructive bg-destructive/10 px-3 py-2">
            No zone yet for {gatesWithout.map((g) => `${g.projectName} · ${g.name}`).join(", ")}. Guards there are tracked, but "left the zone" can't be raised.
          </p>
        )}
        <SheetBox title="Zones" note={zones.length} flush>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Zone</th>
                  <th className={TH}>Applies to</th>
                  <th className={TH}>Shape</th>
                  <th className={`${TH} text-right`}>Allowed distance</th>
                  <th className={TH}>Status</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <EmptyRow cols={6}>Reading…</EmptyRow>
                ) : error ? (
                  <EmptyRow cols={6}><span className="text-destructive">{(error as Error).message}</span></EmptyRow>
                ) : zones.length === 0 ? (
                  <EmptyRow cols={6}>No zones yet.{rights.canCreate ? " Add one with New Zone." : ""}</EmptyRow>
                ) : (
                  zones.map((z) => (
                    <tr key={z.id} className="hover:bg-primary/5">
                      <td className={`${TD} font-medium`}>{z.name}</td>
                      <td className={TD}>
                        {z.gateName ?? "Every gate without its own zone"}
                        <span className="block text-[0.6875rem] text-muted-foreground">{z.projectName}</span>
                      </td>
                      <td className={TD}>
                        <span className={TAG}>{z.kind === "H3" ? `${z.cells.length} hexagons` : `Polygon · ${z.polygon.length} corners`}</span>
                      </td>
                      <td className={`${TD} text-right font-heading tabular-nums`}>{z.allowedDistanceM ? `${z.allowedDistanceM} m` : "—"}</td>
                      <td className={TD}><SheetMark text={z.isActive ? "Active" : "Inactive"} tone={z.isActive ? "done" : "draft"} /></td>
                      <td className={`${TD} text-right`}>
                        {rights.canEdit && (
                          <button type="button" className={ICON_ACT} onClick={() => setEditing(z)} aria-label={`Edit ${z.name}`}>
                            <Pencil size={13} />
                          </button>
                        )}
                        {rights.canDelete && (
                          <button type="button" className={ICON_ACT_RED} onClick={() => void remove(z)} aria-label={`Delete ${z.name}`}>
                            <Trash2 size={13} />
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
      </MaintenanceShell>
      {editing && data && (
        <ZoneEditor
          zone={editing === "new" ? null : editing}
          gates={data.gates}
          projects={data.projects}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["security-geofences"] });
          }}
        />
      )}
    </>
  );
}

function ZoneEditor({ zone, gates, projects, onClose, onSaved }: { zone: GeofenceZone | null; gates: GeofenceGate[]; projects: ProjectOption[]; onClose: () => void; onSaved: () => void }) {
  const [projectId, setProjectId] = useState(zone ? String(zone.projectId) : "");
  const [gateId, setGateId] = useState(zone?.gateId ? String(zone.gateId) : "");
  const [name, setName] = useState(zone?.name ?? "");
  const [kind, setKind] = useState<"H3" | "POLYGON">(zone?.kind ?? "H3");
  const [allowed, setAllowed] = useState(zone?.allowedDistanceM != null ? String(zone.allowedDistanceM) : "15");
  const [active, setActive] = useState(zone?.isActive ?? true);
  const [cells, setCells] = useState<{ id: string; ring: LatLng[] }[]>(zone && zone.kind === "H3" ? zone.cells.map((id, i) => ({ id, ring: zone.shapes[i] ?? [] })) : []);
  const [polygon, setPolygon] = useState<LatLng[]>(zone?.kind === "POLYGON" ? zone.polygon : []);
  const [radius, setRadius] = useState("60");
  const [res, setRes] = useState(zone?.resolution ?? 11);
  const [making, setMaking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extra, setExtra] = useState<{ id: string; ring: LatLng[] }[]>([]);

  const gate = gates.find((g) => String(g.id) === gateId);
  const projectGates = gates.filter((g) => String(g.projectId) === projectId);
  const centre: LatLng | null = gate?.latitude != null && gate?.longitude != null ? [gate.latitude, gate.longitude] : null;
  const fitPoints = useMemo<LatLng[]>(() => {
    if (kind === "H3" && cells.length) return cells.flatMap((c) => c.ring);
    if (kind === "POLYGON" && polygon.length) return polygon;
    return centre ? [centre] : [];
  }, [kind, cells, polygon, centre]);

  const makeHexagons = async () => {
    if (!centre) return toast.error("This gate has no coordinates. Add them in Security Gates, or draw a polygon.");
    setMaking(true);
    try {
      const r = await previewHexagons({ lat: centre[0], lng: centre[1], radiusM: Number(radius) || 60, resolution: res });
      setCells(r.cells.map((id, i) => ({ id, ring: r.shapes[i] })));
      // A ring of neighbours you can click to add.
      const ring = await previewHexagons({ lat: centre[0], lng: centre[1], radiusM: (Number(radius) || 60) * 1.8, resolution: res });
      setExtra(ring.cells.map((id, i) => ({ id, ring: ring.shapes[i] })).filter((c) => !r.cells.includes(c.id)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMaking(false);
    }
  };

  const toggleCell = (c: { id: string; ring: LatLng[] }) => {
    if (cells.some((x) => x.id === c.id)) {
      setCells(cells.filter((x) => x.id !== c.id));
      setExtra([...extra, c]);
    } else {
      setCells([...cells, c]);
      setExtra(extra.filter((x) => x.id !== c.id));
    }
  };

  const save = async () => {
    if (!projectId) return toast.error("Choose the project.");
    if (!name.trim()) return toast.error("Name the zone.");
    if (kind === "H3" && !cells.length) return toast.error("Make the hexagons around the gate first.");
    if (kind === "POLYGON" && polygon.length < 3) return toast.error("Click at least three corners on the map.");
    const body: ZoneInput = {
      projectId: Number(projectId),
      gateId: gateId ? Number(gateId) : null,
      name: name.trim(),
      kind,
      cells: kind === "H3" ? cells.map((c) => c.id) : undefined,
      polygon: kind === "POLYGON" ? polygon : undefined,
      allowedDistanceM: allowed.trim() === "" ? null : Number(allowed),
      isActive: active,
    };
    setSaving(true);
    try {
      if (zone) await updateZone(zone.id, body);
      else await createZone(body);
      toast.success(zone ? "Zone saved" : "Zone added");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const ink = tok("--foreground");
  const blue = tok("--primary");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sheet-frame rounded-none max-w-5xl" style={{ margin: 0 }}>
        <DialogHeader>
          <DialogTitle className={HR_HEAD}>{zone ? `Edit zone — ${zone.name}` : "New zone"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[300px_1fr]">
          <div className="space-y-3">
            <Field label="Project">
              <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setGateId(""); }} className={fieldCls}>
                <option value="">Choose…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Gate" hint="Leave empty for a project-wide zone used by gates without their own.">
              <select value={gateId} onChange={(e) => setGateId(e.target.value)} className={fieldCls} disabled={!projectId}>
                <option value="">Every gate without its own zone</option>
                {projectGates.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}{g.latitude == null ? " (no coordinates)" : ""}</option>
                ))}
              </select>
            </Field>
            <Field label="Zone name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={fieldCls} placeholder="Main Gate zone" />
            </Field>
            <Field label="Shape">
              <div className="flex border border-foreground">
                {(["H3", "POLYGON"] as const).map((k, i) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={`flex-1 h-9 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] ${i ? "border-l border-foreground" : ""} ${kind === k ? "bg-foreground text-card" : "hover:bg-primary/10"}`}
                  >
                    {k === "H3" ? "Hexagons" : "Polygon"}
                  </button>
                ))}
              </div>
            </Field>
            {kind === "H3" ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Radius (m)">
                    <input value={radius} onChange={(e) => setRadius(e.target.value)} inputMode="numeric" className={`${fieldCls} font-heading tabular-nums`} />
                  </Field>
                  <Field label="Hexagon size">
                    <select value={res} onChange={(e) => setRes(Number(e.target.value))} className={fieldCls}>
                      {SIZES.map((s) => (
                        <option key={s.res} value={s.res}>{s.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>
                <button type="button" onClick={makeHexagons} disabled={making || !centre} className={`${KEY_LINE} h-9 px-3 w-full`}>
                  {making ? <Loader2 size={13} className="animate-spin" /> : <Hexagon size={13} />} Make hexagons around the gate
                </button>
                <p className="text-[0.6875rem] text-muted-foreground">
                  {centre ? "Click a hexagon on the map to remove it, or a faint one to add it." : "Choose a gate that has coordinates (Security Gates), or draw a polygon."} {cells.length} in the zone.
                </p>
              </>
            ) : (
              <>
                <p className="text-[0.6875rem] text-muted-foreground">Click the map to add corners in order. {polygon.length} corners.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPolygon(polygon.slice(0, -1))} disabled={!polygon.length} className={`${KEY_LINE} h-8 px-3`}>
                    <Undo2 size={12} /> Undo
                  </button>
                  <button type="button" onClick={() => setPolygon([])} disabled={!polygon.length} className={`${KEY_LINE} h-8 px-3`}>Clear</button>
                </div>
              </>
            )}
            <Field label="Allowed distance (m)" hint="A reading this close outside the line still counts as inside (GPS drift). 10–20 m is typical.">
              <input value={allowed} onChange={(e) => setAllowed(e.target.value)} inputMode="numeric" className={`${fieldCls} font-heading tabular-nums`} />
            </Field>
            {zone && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
              </label>
            )}
          </div>
          <div className="border border-foreground" style={{ height: 480 }}>
            <MapContainer center={centre ?? [22.5726, 88.3639]} zoom={centre ? 18 : 12} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
              <TileLayer url={OSM.url} attribution={OSM.attribution} maxZoom={20} />
              {kind === "H3" &&
                extra.map((c) => (
                  <Polygon key={`x${c.id}`} positions={c.ring} eventHandlers={{ click: () => toggleCell(c) }} pathOptions={{ color: ink, weight: 0.5, opacity: 0.3, fillOpacity: 0.02, dashArray: "2 3" }} />
                ))}
              {kind === "H3" &&
                cells.map((c) => (
                  <Polygon key={c.id} positions={c.ring} eventHandlers={{ click: () => toggleCell(c) }} pathOptions={{ color: blue, weight: 1, fillColor: blue, fillOpacity: 0.25 }} />
                ))}
              {kind === "POLYGON" && (
                <>
                  <Clicks onClick={(p) => setPolygon([...polygon, p])} />
                  {polygon.length >= 3 ? (
                    <Polygon positions={polygon} pathOptions={{ color: blue, weight: 2, fillColor: blue, fillOpacity: 0.2 }} />
                  ) : polygon.length === 2 ? (
                    <Polyline positions={polygon} pathOptions={{ color: blue, weight: 2 }} />
                  ) : null}
                  {polygon.map((p, i) => (
                    <CircleMarker key={i} center={p} radius={4} pathOptions={{ color: blue, fillColor: blue, fillOpacity: 1 }} />
                  ))}
                </>
              )}
              {centre && <CircleMarker center={centre} radius={6} pathOptions={{ color: ink, weight: 2, fillColor: ink, fillOpacity: 1 }} />}
              <Fit points={fitPoints} />
            </MapContainer>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-foreground/15">
          <button type="button" onClick={onClose} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {zone ? "Save" : "Add Zone"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
