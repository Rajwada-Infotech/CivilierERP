import { ArrowRight } from "lucide-react";
import { formatINR } from "@/utils/formatCurrency";
import type { CascadeEntry } from "@/api/docAmendmentsApi";

type Line = { itemId?: string | null; itemDescription?: string; itemName?: string; quantity?: number | string; rate?: number | string; tax?: number | string; unit?: string };

const parseLines = (v: unknown): Line[] => {
  if (Array.isArray(v)) return v as Line[];
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
};
const nameOf = (l: Line) => String(l.itemDescription || l.itemName || "").trim();
const keyOf = (l: Line) => (l.itemId ? `id:${l.itemId}` : `name:${nameOf(l).toLowerCase()}`);
const n = (v: unknown) => Number(v) || 0;
const inr = (v: number | null | undefined) => (v == null ? "—" : formatINR(v, { decimals: 2 }));

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

/** Old → new, struck through when it changed. */
function Change({ from, to, fmt = (x: number) => String(x) }: { from: number | null; to: number | null; fmt?: (x: number) => string }) {
  if (from == null) return <span className="tabular-nums text-foreground font-semibold">{to == null ? "—" : fmt(to)}</span>;
  if (to == null) return <span className="tabular-nums line-through text-muted-foreground">{fmt(from)}</span>;
  if (Math.abs(from - to) < 0.0001) return <span className="tabular-nums text-muted-foreground">{fmt(to)}</span>;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span className="line-through text-muted-foreground">{fmt(from)}</span>
      <ArrowRight size={10} className="text-muted-foreground" />
      <span className="font-semibold text-foreground">{fmt(to)}</span>
    </span>
  );
}

/**
 * An amendment (dbo.DocAmendment): the reason, the document's old -> new value, line by line what changed (quantity,
 * rate, GST; added and removed lines), and how each GRN down the chain changes once it is approved. Shown in the
 * Approval Inbox review and on the module's Amendment page. Reads the shape of GET /api/doc-amendments/:id.
 */
export type AmendmentDiffData = {
  reason?: string;
  requestedBy?: string;
  oldValue?: number | null;
  newValue?: number | null;
  docNo?: string;
  before?: Record<string, unknown> | null;
  proposed?: Record<string, unknown> | null;
  cascade?: CascadeEntry[];
};

export function AmendmentDiff({ d }: { d: AmendmentDiffData | null }) {
  if (!d) return null;
  const oldLines = parseLines(d.before?.POItems);
  const newLines = parseLines(d.proposed?.POItems);
  const oldByKey = new Map(oldLines.map((l) => [keyOf(l), l]));
  const newKeys = new Set(newLines.map(keyOf));
  const removed = oldLines.filter((l) => !newKeys.has(keyOf(l)));
  const supplierChanged = d.before && d.proposed && String(d.before.SupplierID ?? "") !== String(d.proposed.SupplierID ?? "");
  const grns = (d.cascade ?? []).filter((c) => c.docType === "grn" || c.docType === "work-order" || c.docType === "work-done");
  const vios = (d.cascade ?? []).filter((c) => c.docType === "vehicle-in-out");
  const ledger = (d.cascade ?? []).filter((c) => c.docType === "ledger");

  return (
    <div className="space-y-4">
      <div className="border border-foreground px-3 py-2.5 space-y-1">
        <p className={LBL}>Reason for the amendment</p>
        <p className="text-sm text-foreground whitespace-pre-wrap">{d.reason || "—"}</p>
        {d.requestedBy && <p className="text-[0.6875rem] text-muted-foreground">Raised by {d.requestedBy}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className={LBL}>Value</span>
        <Change from={d.oldValue ?? null} to={d.newValue ?? null} fmt={(x) => inr(x)} />
        {supplierChanged && <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] border border-foreground px-1.5 py-0.5">Supplier changes</span>}
      </div>

      {newLines.length > 0 && (
        <div className="space-y-1.5 min-w-0">
          <p className={LBL}>Lines</p>
          <div className="border border-foreground/30 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-foreground/30 text-left">
                  <th className={`${LBL} px-2.5 py-1.5`}>Item</th>
                  <th className={`${LBL} px-2.5 py-1.5 text-right`}>Qty</th>
                  <th className={`${LBL} px-2.5 py-1.5 text-right`}>Rate</th>
                  <th className={`${LBL} px-2.5 py-1.5 text-right`}>GST %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/15">
                {newLines.map((l, i) => {
                  const o = oldByKey.get(keyOf(l));
                  return (
                    <tr key={i}>
                      <td className="px-2.5 py-1.5 text-foreground">
                        {nameOf(l) || "—"}
                        {!o && <span className="ml-1.5 font-heading text-[0.5rem] font-semibold uppercase tracking-[0.1em] border border-foreground px-1 py-px">New</span>}
                      </td>
                      <td className="px-2.5 py-1.5 text-right"><Change from={o ? n(o.quantity) : null} to={n(l.quantity)} /></td>
                      <td className="px-2.5 py-1.5 text-right"><Change from={o ? n(o.rate) : null} to={n(l.rate)} fmt={(x) => inr(x)} /></td>
                      <td className="px-2.5 py-1.5 text-right"><Change from={o ? n(o.tax) : null} to={n(l.tax)} /></td>
                    </tr>
                  );
                })}
                {removed.map((l, i) => (
                  <tr key={`x${i}`} className="text-muted-foreground">
                    <td className="px-2.5 py-1.5 line-through">{nameOf(l)}</td>
                    <td className="px-2.5 py-1.5 text-right" colSpan={3}>Removed</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <p className={LBL}>When approved, down the chain</p>
        {ledger.length > 0 && grns.length === 0 && vios.length === 0 ? (
          <p className="text-xs text-muted-foreground">Its ledger entry is reversed and posted again at the new value.</p>
        ) : grns.length === 0 && vios.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing follows from it yet — only this document changes.</p>
        ) : (
          <div className="border border-foreground/30 divide-y divide-foreground/15">
            {grns.map((g) => (
              <div key={g.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <span className="text-foreground font-medium">{g.docType === "grn" ? "GRN" : g.docType === "work-order" ? "Work Order" : "Work Done"} {g.docNo}</span>
                <span className="text-muted-foreground">{g.status}</span>
                <span className="ml-auto"><Change from={g.oldValue} to={g.newValue} fmt={(x) => inr(x)} /></span>
              </div>
            ))}
            {vios.map((v) => (
              <div key={v.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
                <span className="text-foreground font-medium">Vehicle In/Out {v.docNo}</span>
                <span className="ml-auto text-muted-foreground">follows the order's rates</span>
              </div>
            ))}
          </div>
        )}
        {grns.some((g) => g.status === "Approved") && (
          <p className="text-[0.6875rem] text-muted-foreground">Approved GRNs are re-posted to the ledger at their new value.</p>
        )}
      </div>
    </div>
  );
}
