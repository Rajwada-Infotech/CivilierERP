// Shared by the Unit and Parking Matrix: the tile, its legend, the hold countdown, the customer list a hold or sale is
// made for, the Place hold dialog and the hold / release / extend calls, and the sheet styles.
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/SearchableSelect";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "../customers/config";

export { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT } from "../customers/config";
export const HOLDS_API = "/api/crm/holds";

export type TileStatus = "Available" | "Booked" | "OnHold" | "Blocked";
export interface Option { Id: number; Name: string }

export const fmtMoney = (n: number | null | undefined) => (n != null ? `₹${Number(n).toLocaleString("en-IN")}` : "—");

export async function fetchOptions<T>(url: string): Promise<T[]> {
  const res = await fetchWithAuth(url);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error((data as any)?.error || `Could not load (${res.status}).`);
  return Array.isArray(data) ? data : [];
}

/** "2d 4h left", "5h left", "expiring" — from a hold's end. */
export function holdLeft(until: string | null | undefined): string | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return "expiring";
  const h = Math.floor(ms / 3_600_000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : h > 0 ? `${h}h left` : "under 1h left";
}

// Tile faces: free is open (ruled), held is hatched, taken is solid ink, blocked is dashed and faint. The same marks
// the legend shows, so the grid reads without colour.
const HATCH = "repeating-linear-gradient(135deg, hsl(var(--foreground) / 0.18) 0, hsl(var(--foreground) / 0.18) 1px, transparent 1px, transparent 6px)";
export const STATUS_LABEL: Record<TileStatus, string> = { Available: "Free", OnHold: "On hold", Booked: "Booked", Blocked: "Blocked" };

export function tileStyle(s: TileStatus): { className: string; style: React.CSSProperties } {
  if (s === "Booked") return { className: "bg-foreground text-card", style: { border: RULE } };
  if (s === "OnHold") return { className: "bg-card text-foreground", style: { border: RULE, backgroundImage: HATCH } };
  if (s === "Blocked") return { className: "bg-card text-muted-foreground opacity-60", style: { border: "1px dashed hsl(var(--foreground) / 0.4)" } };
  return { className: "bg-card text-foreground hover:bg-primary/10", style: { border: RULE } };
}

export const Legend: React.FC<{ counts: Record<TileStatus, number>; bookedLabel?: string }> = ({ counts, bookedLabel }) => (
  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
    {(["Available", "OnHold", "Booked", "Blocked"] as TileStatus[]).map((s) => {
      const t = tileStyle(s);
      return (
        <span key={s} className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <i className={`inline-block w-4 h-4 ${t.className}`} style={t.style} />
          {s === "Booked" && bookedLabel ? bookedLabel : STATUS_LABEL[s]} <span className="tabular-nums text-foreground font-semibold">{counts[s]}</span>
        </span>
      );
    })}
  </div>
);

export const Tile: React.FC<{
  name: string; status: TileStatus; tag?: string | null; line: React.ReactNode; holdUntil?: string | null;
  title?: string; disabled?: boolean; onClick?: () => void;
}> = ({ name, status, tag, line, holdUntil, title, disabled, onClick }) => {
  const t = tileStyle(status);
  const left = status === "OnHold" ? holdLeft(holdUntil) : null;
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`text-left px-3 py-2.5 min-w-0 transition-colors ${t.className} ${disabled ? "cursor-default" : "cursor-pointer"}`} style={t.style}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading text-sm font-bold truncate tabular-nums">{name}</span>
        {tag && <span className="shrink-0 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] opacity-80">{tag}</span>}
      </div>
      <div className={`mt-1 text-[0.6875rem] truncate ${status === "Booked" ? "opacity-80" : "text-muted-foreground"}`}>{line}</div>
      {left && <div className="mt-0.5 flex items-center gap-1 text-[0.625rem] font-semibold"><Clock size={10} /> {left}</div>}
    </button>
  );
};

export const Section: React.FC<{ title: string; note?: React.ReactNode; children: React.ReactNode }> = ({ title, note, children }) => (
  <section className="bg-card" style={{ border: RULE }}>
    <div className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2" style={{ borderBottom: RULE }}>
      <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">{title}</span>
      {note && <span className="text-[0.6875rem] text-muted-foreground">{note}</span>}
    </div>
    <div className="p-4 space-y-4">{children}</div>
  </section>
);

export const TILE_GRID = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2";

export interface MatrixCustomer { Id: number; ApplicationNo: string; ApplicantName: string; Mobile: string | null; Status: string; BookingNo: string | null }
/** Live applications of a project (converted ones included), under the matrix rights. */
export function useMatrixCustomers(projectId: string) {
  return useQuery({
    queryKey: ["matrix-customers", projectId],
    queryFn: () => fetchOptions<MatrixCustomer>(`/api/unit-matrix/customers?projectId=${projectId}`),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}
export const customerOptions = (rows: MatrixCustomer[]) =>
  rows.map((a) => ({ value: String(a.Id), label: [a.ApplicantName, a.Mobile, a.ApplicationNo, a.BookingNo && `booked ${a.BookingNo}`].filter(Boolean).join(" · ") }));

export async function holdCall(url: string, method: "POST" | "PUT", body?: unknown) {
  const res = await fetchWithAuth(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The hold could not be changed.");
  return data;
}

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: React.ReactNode }> = ({ label, children, hint }) => (
  <label className="block space-y-1">
    <span className={`block ${LBL}`}>{label}</span>
    {children}
    {hint && <span className="block text-[0.6875rem] text-muted-foreground">{hint}</span>}
  </label>
);
export const INP = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-2.5 text-sm text-foreground outline-none";

/** Hold a unit or parking slot for a customer of the same project for N days. */
export function PlaceHoldDialog({ entityType, entityId, label, projectId, canPlace, onDone, onClose }: {
  entityType: "Unit" | "Parking"; entityId: number; label: string; projectId: string; canPlace: boolean; onDone: () => void; onClose: () => void;
}) {
  const [applicationId, setApplicationId] = useState("");
  const [holdDays, setHoldDays] = useState("3");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: customers = [], isLoading } = useMatrixCustomers(projectId);

  const place = async () => {
    if (!applicationId) return void toast.error("Select a customer.");
    const days = parseInt(holdDays, 10);
    if (!Number.isFinite(days) || days < 1 || days > 90) return void toast.error("Hold for 1 to 90 days.");
    setSaving(true);
    try {
      await holdCall(HOLDS_API, "POST", { EntityType: entityType, EntityId: entityId, ApplicationId: parseInt(applicationId, 10), HoldDays: days, Reason: reason || null });
      toast.success(`${label} held for ${days} day${days > 1 ? "s" : ""}`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-5 gap-4 rounded-none" style={{ border: RULE }}>
        <DialogHeader>
          <DialogTitle className="font-heading text-[0.75rem] font-bold uppercase tracking-[0.14em]">Hold {label}</DialogTitle>
        </DialogHeader>
        <Field label="Customer *" hint={!isLoading && customers.length === 0 ? "No live application in this project yet: only a customer of the same project can hold it." : undefined}>
          <SearchableSelect value={applicationId} onChange={setApplicationId} placeholder={isLoading ? "Loading customers…" : "Select customer"}
            searchPlaceholder="Search name, mobile or application…" options={customerOptions(customers)} />
        </Field>
        <Field label="Hold for (days) *" hint="It frees itself when the time runs out; a daily reminder goes out until then.">
          <input type="number" min={1} max={90} value={holdDays} onChange={(e) => setHoldDays(e.target.value)} className={INP} />
        </Field>
        <Field label="Reason">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={`${INP} h-auto py-2 resize-none`} />
        </Field>
        <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
          {canPlace && <button onClick={place} disabled={saving} className={`${KEY_INK} h-9 px-4`}>{saving ? "Placing…" : "Place hold"}</button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Two-column facts block used inside the tile dialogs. */
export const Facts: React.FC<{ title: string; rows: [string, React.ReactNode][] }> = ({ title, rows }) => (
  <div className="bg-card" style={{ border: RULE }}>
    <p className="px-3 py-2 font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em]" style={{ borderBottom: RULE }}>{title}</p>
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: "hsl(var(--foreground) / 0.12)" }}>
      {rows.map(([k, v]) => (
        <div key={k} className="bg-card px-3 py-2 min-w-0">
          <dt className={LBL}>{k}</dt>
          <dd className="text-sm font-medium mt-0.5 break-words">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  </div>
);

/** Extend an active hold by N days. */
export const ExtendRow: React.FC<{ holdId: number; onDone: () => void }> = ({ holdId, onDone }) => {
  const [days, setDays] = useState("3");
  const [saving, setSaving] = useState(false);
  const go = async () => {
    const d = parseInt(days, 10);
    if (!Number.isFinite(d) || d < 1 || d > 90) return void toast.error("Extend by 1 to 90 days.");
    setSaving(true);
    try {
      await holdCall(`${HOLDS_API}/${holdId}/extend`, "PUT", { AdditionalDays: d });
      toast.success(`Hold extended by ${d} day${d > 1 ? "s" : ""}`);
      onDone();
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex items-end gap-2 px-3 py-2.5" style={{ border: RULE_SOFT }}>
      <Field label="Extend by (days)"><input type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} className={INP} /></Field>
      <button onClick={go} disabled={saving} className={`${KEY_INK} h-9 px-4 shrink-0`}>{saving ? "Extending…" : "Extend"}</button>
    </div>
  );
};
