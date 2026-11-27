// Shared by the Unit and Parking Matrix: the tile, its legend, the customer list a hold or sale is made for, the Place
// hold dialog and the hold / release calls, and the sheet styles. A hold has no end date: it lasts until it is released,
// the application is rejected or cancelled, or it turns into a booking / allotment.
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GRID_KEY, GRID_KEY_BRAND, GRID_KEY_DANGER, GRID_SHEET_KEYS } from "@/components/crm/CrmDataTable";
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
  name: string; status: TileStatus; tag?: string | null; line: React.ReactNode;
  title?: string; disabled?: boolean; onClick?: () => void;
}> = ({ name, status, tag, line, title, disabled, onClick }) => {
  const t = tileStyle(status);
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`text-left px-3 py-2.5 min-w-0 transition-colors ${t.className} ${disabled ? "cursor-default" : "cursor-pointer"}`} style={t.style}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-heading text-sm font-bold truncate tabular-nums">{name}</span>
        {tag && <span className="shrink-0 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] opacity-80">{tag}</span>}
      </div>
      <div className={`mt-1 text-[0.6875rem] truncate ${status === "Booked" ? "opacity-80" : "text-muted-foreground"}`}>{line}</div>
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

/** Hold a unit or parking slot for a customer of the same project, until it is released or booked. */
export function PlaceHoldDialog({ entityType, entityId, label, projectId, canPlace, onDone, onClose }: {
  entityType: "Unit" | "Parking"; entityId: number; label: string; projectId: string; canPlace: boolean; onDone: () => void; onClose: () => void;
}) {
  const [applicationId, setApplicationId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: customers = [], isLoading } = useMatrixCustomers(projectId);

  const place = async () => {
    if (!applicationId) return void toast.error("Select a customer.");
    setSaving(true);
    try {
      await holdCall(HOLDS_API, "POST", { EntityType: entityType, EntityId: entityId, ApplicationId: parseInt(applicationId, 10), Reason: reason || null });
      toast.success(`${label} is on hold`);
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
        <p className="text-[0.6875rem] text-muted-foreground">It stays held until it is released here, the application ends, or it is booked.</p>
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

// ── Modern enterprise grid styles & dialog for Unit Matrix (keeps legacy exports intact for other pages) ──
export const MATRIX_INP = GRID_SHEET_KEYS.INP;
export const MATRIX_TEXTAREA = GRID_SHEET_KEYS.TEXTAREA;
export const MATRIX_BTN = `${GRID_KEY} h-9 px-3`;
export const MATRIX_BTN_BRAND = `${GRID_KEY_BRAND} h-9 px-3.5`;
export const MATRIX_BTN_DANGER = `${GRID_KEY_DANGER} h-9 px-3.5`;

export function fmtHoldRemaining(holdUntil: string | null): string | null {
  if (!holdUntil) return null;
  const diffMs = new Date(holdUntil).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs <= 0) return "Expired";
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 24) return `${Math.ceil(hours / 24)}d left`;
  return `${Math.max(1, hours)}h left`;
}

export function ModernPlaceHoldDialog({ entityType, entityId, label, subtitle, projectId, canPlace, onDone, onClose }: {
  entityType: "Unit" | "Parking"; entityId: number; label: string; subtitle?: string; projectId: string; canPlace: boolean; onDone: () => void; onClose: () => void;
}) {
  const [applicationId, setApplicationId] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const { data: customers = [], isLoading } = useMatrixCustomers(projectId);

  const place = async () => {
    if (!applicationId) return void toast.error("Select a customer.");
    setSaving(true);
    try {
      await holdCall(HOLDS_API, "POST", { EntityType: entityType, EntityId: entityId, ApplicationId: parseInt(applicationId, 10), Reason: reason || null });
      toast.success(`${label} is on hold`);
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
      <DialogContent className="max-w-lg rounded-xl p-5 gap-4">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg font-bold capitalize">Hold {label}</DialogTitle>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </DialogHeader>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground block">
              Customer / Live Application <span className="text-destructive">*</span>
            </span>
            <SearchableSelect
              value={applicationId}
              onChange={setApplicationId}
              placeholder={isLoading ? "Loading customers…" : "Select customer"}
              searchPlaceholder="Search name, mobile or application…"
              options={customerOptions(customers)}
            />
            {!isLoading && customers.length === 0 && (
              <span className="block text-xs text-muted-foreground pt-0.5">
                {`No live application in this project yet — only a customer of the same project can ${entityType === "Parking" ? "hold this parking slot" : "hold this unit"}.`}
              </span>
            )}
          </label>

          <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
            Holds remain active until released here, converted into a booking, or when the application is closed.
          </p>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground block">Reason / remarks (optional)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Token cheque expected tomorrow…"
              className={MATRIX_TEXTAREA}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button type="button" onClick={onClose} className={`${MATRIX_BTN} text-foreground`}>Cancel</button>
          {canPlace && (
            <button type="button" onClick={place} disabled={saving} className={MATRIX_BTN_BRAND}>
              {saving ? "Placing hold…" : "Place hold"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
