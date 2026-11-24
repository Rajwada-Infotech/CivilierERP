// Maintenance → Security Gates: each project's gates, with coordinates, for the Civilier Security app. A gate is where
// guards are posted and where visitor requests are raised; inactive gates stay on old requests but get no new ones.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, ICON_ACT_RED, SheetBox, TD, TH } from "@/components/maintenance/maintParts";
import { HrStatStrip } from "@/components/hrpayroll/HrUi";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK } from "@/components/sheet/sheetParts";
import { usePageRights } from "@/hooks/usePageRights";
import { createGate, deleteGate, getGates, updateGate, type GateInput, type NoResponsePolicy, type ProjectOption, type SecurityGate } from "@/api/securityIntercomApi";
import { EmptyRow, Field, SheetDialog, fieldCls } from "./securityParts";

const PAGE_KEY = "security-gates";
const POLICIES: { value: NoResponsePolicy; label: string }[] = [
  { value: "HOLD", label: "Don't let in without approval" },
  { value: "ALLOW", label: "May let in after calling the flat" },
  { value: "CALL_OFFICE", label: "Call the security office first" },
];
const OSM = { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' };

/** Click the map to put the gate there. */
function PickPoint({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

export default function SecurityGates() {
  const rights = usePageRights(PAGE_KEY);
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [editing, setEditing] = useState<SecurityGate | "new" | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["security-gates"], queryFn: getGates });

  const remove = async (g: SecurityGate) => {
    if (!window.confirm(`Delete the gate "${g.name}"? This can't be undone. A gate with guards, visitors or zones on record can only be set inactive.`)) return;
    try {
      await deleteGate(g.id);
      toast.success("Gate deleted");
      void qc.invalidateQueries({ queryKey: ["security-gates"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const gates = useMemo(() => (data?.gates ?? []).filter((g) => !projectId || String(g.projectId) === projectId), [data, projectId]);
  const all = data?.gates ?? [];

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Security Gates"]} />
      <MaintenanceShell
        title="Security Gates"
        subtitle="The gates guards are posted at and visitor requests are raised from"
        action={
          rights.canCreate ? (
            <button type="button" onClick={() => setEditing("new")} className={`${KEY_INK} h-9 px-4`}>
              <Plus size={13} /> New Gate
            </button>
          ) : undefined
        }
      >
        <HrStatStrip
          items={[
            { label: "Gates", value: isLoading ? "…" : all.length },
            { label: "Active", value: isLoading ? "…" : all.filter((g) => g.isActive).length },
            { label: "Without a guard", value: isLoading ? "…" : all.filter((g) => g.isActive && !g.guards).length, tone: all.some((g) => g.isActive && !g.guards) ? "hsl(var(--destructive))" : undefined },
          ]}
        />

        <SheetBox
          title="Gates"
          note={gates.length}
          flush
          action={
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${fieldCls} w-auto h-8`} aria-label="Project">
              <option value="">All projects</option>
              {(data?.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Gate</th>
                  <th className={TH}>Project</th>
                  <th className={TH}>Coordinates</th>
                  <th className={TH}>No answer</th>
                  <th className={`${TH} text-right`}>Guards</th>
                  <th className={TH}>Status</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <EmptyRow cols={7}>Reading…</EmptyRow>
                ) : error ? (
                  <EmptyRow cols={7}><span className="text-destructive">{(error as Error).message}</span></EmptyRow>
                ) : gates.length === 0 ? (
                  <EmptyRow cols={7}>No gates yet.{rights.canCreate ? " Add the first one with New Gate." : ""}</EmptyRow>
                ) : (
                  gates.map((g) => (
                    <tr key={g.id} className="hover:bg-primary/5">
                      <td className={`${TD} font-medium`}>{g.name}</td>
                      <td className={TD}>{g.projectName}</td>
                      <td className={`${TD} font-heading tabular-nums text-xs`}>
                        {g.latitude != null && g.longitude != null ? `${Number(g.latitude).toFixed(6)}, ${Number(g.longitude).toFixed(6)}` : <span className="text-muted-foreground">Not set</span>}
                      </td>
                      <td className={`${TD} text-xs`}>{POLICIES.find((p) => p.value === g.noResponsePolicy)?.label ?? "—"}</td>
                      <td className={`${TD} text-right font-heading tabular-nums ${g.isActive && !g.guards ? "text-destructive" : ""}`}>{g.guards}</td>
                      <td className={TD}><SheetMark text={g.isActive ? "Active" : "Inactive"} tone={g.isActive ? "done" : "draft"} /></td>
                      <td className={`${TD} text-right`}>
                        {rights.canEdit && (
                          <button type="button" className={ICON_ACT} onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`}>
                            <Pencil size={13} />
                          </button>
                        )}
                        {rights.canDelete && (
                          <button type="button" className={ICON_ACT_RED} onClick={() => void remove(g)} aria-label={`Delete ${g.name}`}>
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

      {editing && (
        <GateDialog
          gate={editing === "new" ? null : editing}
          projects={data?.projects ?? []}
          defaultProject={projectId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["security-gates"] });
          }}
        />
      )}
    </>
  );
}

function GateDialog({ gate, projects, defaultProject, onClose, onSaved }: { gate: SecurityGate | null; projects: ProjectOption[]; defaultProject: string; onClose: () => void; onSaved: () => void }) {
  const [projectId, setProjectId] = useState(gate ? String(gate.projectId) : defaultProject);
  const [name, setName] = useState(gate?.name ?? "");
  const [lat, setLat] = useState(gate?.latitude != null ? String(gate.latitude) : "");
  const [lng, setLng] = useState(gate?.longitude != null ? String(gate.longitude) : "");
  const [active, setActive] = useState(gate?.isActive ?? true);
  const [policy, setPolicy] = useState<NoResponsePolicy>(gate?.noResponsePolicy ?? "HOLD");
  const [saving, setSaving] = useState(false);
  const point: [number, number] | null = lat.trim() && lng.trim() && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)) ? [Number(lat), Number(lng)] : null;

  const submit = async () => {
    if (!projectId) return toast.error("Choose the project.");
    if (!name.trim()) return toast.error("Enter the gate's name.");
    if (!!lat.trim() !== !!lng.trim()) return toast.error("Enter both latitude and longitude, or neither.");
    const body: GateInput = { projectId: Number(projectId), name: name.trim(), latitude: lat.trim() ? Number(lat) : null, longitude: lng.trim() ? Number(lng) : null, noResponsePolicy: policy, isActive: active };
    if ((body.latitude != null && !Number.isFinite(body.latitude)) || (body.longitude != null && !Number.isFinite(body.longitude))) return toast.error("Coordinates must be numbers.");
    setSaving(true);
    try {
      if (gate) await updateGate(gate.id, body);
      else await createGate(body);
      toast.success(gate ? "Gate saved" : "Gate added");
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetDialog title={gate ? `Edit gate — ${gate.name}` : "New gate"} onClose={onClose} onSubmit={submit} saving={saving} icon={<Save size={13} />} submitLabel={gate ? "Save" : "Add Gate"} wide>
      <Field label="Project">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={fieldCls}>
          <option value="">Choose the project…</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Gate name">
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} className={fieldCls} placeholder="Main Gate" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude">
          <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" className={`${fieldCls} font-heading tabular-nums`} placeholder="22.572600" />
        </Field>
        <Field label="Longitude">
          <input value={lng} onChange={(e) => setLng(e.target.value)} inputMode="decimal" className={`${fieldCls} font-heading tabular-nums`} placeholder="88.363900" />
        </Field>
      </div>
      <div className="border border-foreground" style={{ height: 240 }}>
        <MapContainer center={point ?? [22.5726, 88.3639]} zoom={point ? 18 : 12} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <TileLayer url={OSM.url} attribution={OSM.attribution} maxZoom={20} />
          <PickPoint onPick={(la, lo) => { setLat(la.toFixed(6)); setLng(lo.toFixed(6)); }} />
          {point && <CircleMarker center={point} radius={8} pathOptions={{ weight: 2, fillOpacity: 1 }} />}
        </MapContainer>
      </div>
      <p className="text-[0.6875rem] text-muted-foreground">Click the map on the gate to fill the coordinates, or type them. Leave them empty until you have them.</p>
      <Field label="When nobody at the flat answers">
        <select value={policy} onChange={(e) => setPolicy(e.target.value as NoResponsePolicy)} className={fieldCls}>
          {POLICIES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </Field>
      {gate && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active (inactive gates get no new visitor requests)
        </label>
      )}
    </SheetDialog>
  );
}
