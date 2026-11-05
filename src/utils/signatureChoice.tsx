// Before a document with an "Authorised Signatory" line is printed or saved as
// PDF, the person printing picks one of the active signatures from the
// Signature library (Admin → Signature) to stamp above that line — or none.
// The choice is made per print, so nothing is stored on the document itself.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export const SIGNED_LABEL = "Authorised Signatory";

interface SignatureRow {
  Id: number;
  Name: string;
  Owner: string | null;
  Status: string;
  ImageData: string;
}

export interface SignatureStamp {
  image: string;
  /** width / height of the image, so Print and PDF keep its shape */
  ratio: number;
}

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40";

async function activeSignatures(): Promise<SignatureRow[]> {
  try {
    const res = await fetchWithAuth("/api/signatures");
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return (Array.isArray(rows) ? rows : []).filter(
      (s: SignatureRow) => s.Status === "active" && /^data:image\/(png|jpe?g)/i.test(s.ImageData || ""),
    );
  } catch {
    return [];
  }
}

const imageRatio = (src: string) =>
  new Promise<number>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3);
    img.onerror = () => resolve(3);
    img.src = src;
  });

function Chooser({ rows, onDone }: { rows: SignatureRow[]; onDone: (row: SignatureRow | null) => void }) {
  const [picked, setPicked] = useState<number>(rows[0].Id);
  const rule = "1px solid hsl(var(--foreground))";
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => e.target === e.currentTarget && onDone(null)}
      onKeyDown={(e) => e.key === "Escape" && onDone(null)}
    >
      <div className="sheet-frame bg-card w-full max-w-lg" style={{ margin: 0 }} role="dialog" aria-modal="true" aria-label="Choose a signature">
        <div className="px-5 py-4" style={{ borderBottom: rule }}>
          <p className={LBL}>Authorised signatory</p>
          <h2 className="font-heading text-lg font-bold tracking-tight mt-1">Sign this document</h2>
          <p className="text-xs text-muted-foreground mt-1">The chosen signature is printed above the signatory line. Nothing is saved on the document.</p>
        </div>
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[55vh] overflow-y-auto" role="radiogroup">
          {rows.map((s) => {
            const on = picked === s.Id;
            return (
              <button
                key={s.Id}
                type="button"
                role="radio"
                aria-checked={on}
                autoFocus={on}
                onClick={() => setPicked(s.Id)}
                onDoubleClick={() => onDone(s)}
                className={`text-left bg-card border transition-colors ${on ? "border-foreground border-2" : "border-foreground/30 hover:border-foreground"}`}
              >
                <span
                  // White, as the signature will print on paper — dark ink vanishes on a dark theme.
                  className="flex h-20 items-center justify-center p-2 bg-white"
                  style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.2)" }}
                >
                  <img src={s.ImageData} alt="" className="max-h-full max-w-full object-contain" />
                </span>
                <span className="block px-2.5 py-2">
                  <span className="block font-heading text-sm font-bold tracking-tight truncate">{s.Name}</span>
                  <span className="block text-xs text-muted-foreground truncate">{s.Owner || "—"}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: rule }}>
          <button type="button" onClick={() => onDone(null)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>
            No signature
          </button>
          <button
            type="button"
            onClick={() => onDone(rows.find((r) => r.Id === picked) ?? null)}
            className={`${KEY} h-9 px-5 bg-foreground text-card border border-foreground`}
          >
            Use signature
          </button>
        </div>
      </div>
    </div>
  );
}

/** Asks for a signature when the document has an Authorised Signatory line and the library has
 *  active signatures. Resolves to the stamp, or null for none (also when closed). */
export async function chooseSignature(signLabel: string): Promise<SignatureStamp | null> {
  if (signLabel !== SIGNED_LABEL) return null;
  const rows = await activeSignatures();
  if (rows.length === 0) return null;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const row = await new Promise<SignatureRow | null>((resolve) => {
    root.render(<Chooser rows={rows} onDone={resolve} />);
  });
  root.unmount();
  host.remove();
  return row ? { image: row.ImageData, ratio: await imageRatio(row.ImageData) } : null;
}

/** Fits a stamp of the given ratio inside maxW × maxH (mm). */
export function fitStamp(ratio: number, maxW: number, maxH: number) {
  let h = maxH;
  let w = h * ratio;
  if (w > maxW) {
    w = maxW;
    h = w / ratio;
  }
  return { w, h };
}
