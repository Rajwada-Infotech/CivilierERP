// The map part of the Work Location form: pick a point by clicking the map (or dragging the pin, searching an address, or
// using the device location), see the marked area as a circle of RadiusMeters around it, and fetch the street address for the
// point. The whole thing is one value -- { latitude, longitude, radius, address } -- so it fits one MasterPage custom field.
import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Crosshair, Loader2, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import "leaflet/dist/leaflet.css";

export interface GeoValue {
  latitude: string;
  longitude: string;
  radius: string;
  address: string;
}

export const emptyGeo: GeoValue = { latitude: "", longitude: "", radius: "100", address: "" };

// Leaflet's default pin references image files by URL, which bundlers do not resolve -- point them at the CDN once.
let iconPatched = false;
function patchIcon() {
  if (iconPatched) return;
  iconPatched = true;
  delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
    iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
    shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  });
}

const DEFAULT_CENTER: [number, number] = [22.5726, 88.3639]; // Kolkata, until a point is chosen

const inputCls = "w-full h-10 px-3 rounded-md border border-input bg-background text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
const labelCls = "block text-xs font-semibold text-muted-foreground mb-1";

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
const validPoint = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** OpenStreetMap's Nominatim: address for a point. */
async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`);
    if (!r.ok) return null;
    const j = await r.json();
    return typeof j?.display_name === "string" ? j.display_name : null;
  } catch {
    return null;
  }
}

/** Nominatim: the point for a typed address or place name. */
async function searchPlace(q: string): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`);
    if (!r.ok) return null;
    const hit = (await r.json())?.[0];
    return hit ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), name: String(hit.display_name || "") } : null;
  } catch {
    return null;
  }
}

/** Click on the map to move the point; keeps the map sized and centred as the point or the dialog changes. */
function MapBehaviour({ point, radius, onPick }: { point: [number, number] | null; radius: number; onPick: (lat: number, lng: number) => void }) {
  const map = useMap();
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  // The map mounts inside a dialog that is still animating open -- re-measure once it has its real size.
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 250);
    return () => clearTimeout(t);
  }, [map]);
  const key = point ? `${point[0]},${point[1]},${radius}` : "";
  useEffect(() => {
    if (!point) return;
    // Fit the whole marked area on screen (at least street level), not just the pin.
    const bounds = L.circle(point, { radius: Math.max(radius, 30) }).getBounds();
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 18, animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export function LocationAreaPicker({ value, onChange }: { value: GeoValue; onChange: (v: GeoValue) => void }) {
  patchIcon();
  // A new record arrives with an empty default (not an object), so fill any missing part.
  const v: GeoValue = { ...emptyGeo, ...(value && typeof value === "object" ? value : {}) };
  const latest = useRef(v);
  latest.current = v;
  const seq = useRef(0);
  const [busy, setBusy] = useState<"" | "address" | "search" | "gps">("");
  const [query, setQuery] = useState("");

  const lat = num(v.latitude);
  const lng = num(v.longitude);
  const point: [number, number] | null = validPoint(lat, lng) ? [lat, lng] : null;
  const radius = Math.max(10, Number(v.radius) || 100);

  const patch = useCallback((p: Partial<GeoValue>) => onChange({ ...latest.current, ...p }), [onChange]);

  /** Look the address up for a point -- only the newest lookup may write back. */
  const fetchAddress = useCallback(async (la: number, ln: number, announce: boolean) => {
    const my = ++seq.current;
    setBusy("address");
    const addr = await reverseGeocode(la, ln);
    if (my !== seq.current) return;
    setBusy("");
    if (addr) patch({ address: addr });
    else if (announce) toast.error("Could not fetch an address for this point. You can type it in.");
  }, [patch]);

  const setPoint = useCallback((la: number, ln: number) => {
    patch({ latitude: la.toFixed(6), longitude: ln.toFixed(6) });
    void fetchAddress(la, ln, false);
  }, [patch, fetchAddress]);

  const find = async () => {
    if (!query.trim()) return;
    setBusy("search");
    const hit = await searchPlace(query.trim());
    setBusy("");
    if (!hit) return void toast.error("No place found for that search.");
    patch({ latitude: hit.lat.toFixed(6), longitude: hit.lng.toFixed(6), address: hit.name });
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) return void toast.error("This browser cannot share its location.");
    setBusy("gps");
    navigator.geolocation.getCurrentPosition(
      (p) => { setBusy(""); setPoint(p.coords.latitude, p.coords.longitude); },
      () => { setBusy(""); toast.error("Could not read your location. Allow location access and try again."); },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  return (
    <div className="space-y-3 col-span-full">
      <div className="flex flex-wrap gap-2">
        <div className="flex-1 min-w-[14rem] flex gap-2">
          <input className={inputCls} value={query} placeholder="Search an address or place on the map" onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void find(); } }} />
          <button type="button" onClick={find} disabled={busy === "search" || !query.trim()} className="h-10 px-3 rounded-md border border-input text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50 shrink-0">
            {busy === "search" ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find
          </button>
        </div>
        <button type="button" onClick={useMyLocation} disabled={busy === "gps"} className="h-10 px-3 rounded-md border border-input text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50">
          {busy === "gps" ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />} Use my location
        </button>
      </div>

      <div className="rounded-lg overflow-hidden border border-border" style={{ height: 320 }}>
        <MapContainer center={point ?? DEFAULT_CENTER} zoom={point ? 16 : 5} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          {point && (
            <>
              <Circle center={point} radius={radius} pathOptions={{ color: "#b45309", weight: 2, fillColor: "#f59e0b", fillOpacity: 0.2 }} />
              <Marker position={point} draggable eventHandlers={{ dragend: (e) => { const p = (e.target as L.Marker).getLatLng(); setPoint(p.lat, p.lng); } }} />
            </>
          )}
          <MapBehaviour point={point} radius={radius} onPick={setPoint} />
        </MapContainer>
      </div>
      <p className="text-xs text-muted-foreground flex items-center gap-1.5"><MapPin size={12} /> Click the map or drag the pin to set the location. The shaded circle is the marked work area.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Latitude *</label>
          <input className={inputCls} inputMode="decimal" value={v.latitude} placeholder="e.g. 22.572600" onChange={(e) => patch({ latitude: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Longitude *</label>
          <input className={inputCls} inputMode="decimal" value={v.longitude} placeholder="e.g. 88.363900" onChange={(e) => patch({ longitude: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>Area radius (metres) *</label>
          <input className={inputCls} type="number" min={10} max={100000} value={v.radius} onChange={(e) => patch({ radius: e.target.value })} />
        </div>
      </div>
      <input type="range" min={10} max={1000} step={10} value={Math.min(1000, radius)} onChange={(e) => patch({ radius: e.target.value })} className="w-full accent-amber-600" aria-label="Area radius" />

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className={labelCls + " mb-0"}>Address</label>
          <button type="button" disabled={!point || busy === "address"} onClick={() => point && void fetchAddress(point[0], point[1], true)} className="text-xs font-semibold text-primary inline-flex items-center gap-1 disabled:opacity-50">
            {busy === "address" ? <Loader2 size={12} className="animate-spin" /> : <MapPin size={12} />} Fetch address from map
          </button>
        </div>
        <textarea className={inputCls + " h-auto py-2 min-h-[4rem]"} rows={2} maxLength={500} value={v.address} placeholder="Filled from the map point -- you can edit it" onChange={(e) => patch({ address: e.target.value })} />
      </div>
    </div>
  );
}

/** Read-only map of a saved location with its marked area -- used in the View dialog. */
export function LocationMapView({ latitude, longitude, radius }: { latitude: number; longitude: number; radius: number }) {
  patchIcon();
  const point: [number, number] = [Number(latitude), Number(longitude)];
  if (!validPoint(point[0], point[1])) return <span className="text-muted-foreground">No location</span>;
  return (
    <div className="rounded-lg overflow-hidden border border-border" style={{ height: 260 }}>
      <MapContainer center={point} zoom={16} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Circle center={point} radius={radius} pathOptions={{ color: "#b45309", weight: 2, fillColor: "#f59e0b", fillOpacity: 0.2 }} />
        <Marker position={point} />
        <MapBehaviour point={point} radius={radius} onPick={() => undefined} />
      </MapContainer>
    </div>
  );
}
