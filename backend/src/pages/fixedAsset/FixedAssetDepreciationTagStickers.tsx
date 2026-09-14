import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Tag as TagIcon, Search, X, Calendar, Printer, Check, Boxes, RotateCcw, Filter,
} from "lucide-react";
import { GlassShell, GlassCard } from "@/components/dashboard/GlassShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getTaggedFAItemCodes, type TaggedFAItemCode } from "@/api/fixedAssetTaggingApi";
import { code128SVG } from "@/lib/code128";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

const inputCls = "w-full h-9 px-3 text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 transition-shadow";
const labelCls = "flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1";

function ensureArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

interface FilterState {
  companyId: string;
  fromDate: string;
  toDate: string;
  finYear: string;
  faCode: string;
  itemName: string;
}
const EMPTY: FilterState = { companyId: "", fromDate: "", toDate: "", finYear: "", faCode: "", itemName: "" };

// ── Sticker sheet HTML (opened in a new window and printed) ──────────────────
function buildStickerHtml(rows: TaggedFAItemCode[]): string {
  const stickers = rows.map((r) => {
    const svg = code128SVG(r.FAItemCode, { moduleWidth: 1.5, height: 60, quietZone: 8 });
    return `
      <div class="sticker">
        <div class="tab"><span>FIXED ASSET</span></div>
        <div class="body">
          <div class="prop">PROPERTY OF</div>
          ${r.CompanyName ? `<div class="company">${escapeHtml(r.CompanyName)}</div>` : ""}
          <div class="barcode">${svg}</div>
          <div class="code">${escapeHtml(r.FAItemCode)}</div>
          <div class="name">${escapeHtml(r.ItemName || "")}</div>
        </div>
      </div>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Fixed Asset Stickers</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; padding: 8mm; background: #fff; color: #000; }
    .sheet { display: flex; flex-wrap: wrap; gap: 4mm; }
    .sticker {
      display: flex; width: 76mm; height: 30mm; border: 0.4mm solid #bbb;
      border-radius: 1.5mm; overflow: hidden; page-break-inside: avoid; background: #fff;
    }
    .tab {
      width: 11mm; background: #f4c400; display: flex; align-items: center; justify-content: center;
    }
    .tab span {
      writing-mode: vertical-rl; transform: rotate(180deg);
      font-weight: 800; font-size: 8pt; letter-spacing: 1.5px; color: #222;
    }
    .body {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 1.5mm 2mm; text-align: center; min-width: 0;
    }
    .prop { font-size: 5.5pt; letter-spacing: 1.5px; color: #444; }
    .company { font-size: 10pt; font-weight: 800; line-height: 1.1; margin: 0.3mm 0 0.8mm; }
    .barcode { width: 100%; height: 9mm; }
    .barcode svg { width: 100%; height: 100%; display: block; }
    .code { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.4px; margin-top: 0.6mm; }
    .name { font-size: 6.5pt; color: #333; margin-top: 0.3mm; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    @media print {
      body { padding: 4mm; }
      .sticker { border-color: #999; }
    }
  </style></head>
  <body><div class="sheet">${stickers}</div>
  <script>window.onload = function () { window.focus(); window.print(); };</script>
  </body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function printStickers(rows: TaggedFAItemCode[]) {
  if (rows.length === 0) return;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) {
    toast.error("Pop-up blocked — allow pop-ups for this site to print stickers");
    return;
  }
  w.document.open();
  w.document.write(buildStickerHtml(rows));
  w.document.close();
}

// ── Sticker preview (screen) ────────────────────────────────────────────────
function StickerPreview({ row }: { row: TaggedFAItemCode }) {
  return (
    <div className="flex w-[300px] h-[118px] rounded-md overflow-hidden border border-border bg-white text-black shrink-0">
      <div className="w-11 bg-[#f4c400] flex items-center justify-center">
        <span className="[writing-mode:vertical-rl] rotate-180 font-extrabold text-[10px] tracking-widest text-neutral-800">
          FIXED ASSET
        </span>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-2 py-1.5 text-center min-w-0">
        <span className="text-[7px] tracking-widest text-neutral-500">PROPERTY OF</span>
        {row.CompanyName && <span className="text-[12px] font-extrabold leading-tight my-0.5 truncate max-w-full">{row.CompanyName}</span>}
        <span
          className="w-full h-8"
          dangerouslySetInnerHTML={{ __html: code128SVG(row.FAItemCode, { moduleWidth: 1.4, height: 40, quietZone: 6 }).replace("<svg ", '<svg style="width:100%;height:100%" ') }}
        />
        <span className="text-[10px] font-bold tracking-wide mt-0.5">{row.FAItemCode}</span>
        <span className="text-[8px] text-neutral-600 truncate max-w-full">{row.ItemName}</span>
      </div>
    </div>
  );
}

export default function FixedAssetDepreciationTagStickers() {
  usePageRights("fixed-asset-tagging");
  const { finYears } = useFinYear();

  const [draft, setDraft] = useState<FilterState>(EMPTY);
  const [applied, setApplied] = useState<FilterState>(EMPTY);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [printOpen, setPrintOpen] = useState(false);

  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options-C"],
    queryFn: () => getEnterpriseOptions(undefined, "C"),
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["fa-tagged-codes", applied],
    queryFn: () => getTaggedFAItemCodes({
      companyId: applied.companyId ? Number(applied.companyId) : undefined,
      finYear: applied.finYear || undefined,
      fromDate: applied.fromDate || undefined,
      toDate: applied.toDate || undefined,
      faCode: applied.faCode || undefined,
      itemName: applied.itemName || undefined,
    }),
  });

  const list = ensureArray<TaggedFAItemCode>(rows);
  const hasFilters = Object.values(applied).some(Boolean);

  const apply = () => setApplied(draft);
  const reset = () => { setDraft(EMPTY); setApplied(EMPTY); setSelected(new Set()); };

  const allSelected = list.length > 0 && list.every((r) => selected.has(r.TagId));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(list.map((r) => r.TagId)));
  };
  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(
    () => list.filter((r) => selected.has(r.TagId)),
    [list, selected],
  );

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Fixed Asset", "FA Code Stickers"]} />
      <GlassShell
        title="FA Code Stickers"
        subtitle="View, filter & print stickers for FA Item Codes whose Fixed Asset Depreciation Tag (Asset Register) process is complete"
        icon={TagIcon}
        accentColor="#eab308"
        action={
          <button
            onClick={() => (selectedRows.length ? setPrintOpen(true) : toast.error("Select at least one FA Item Code"))}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all"
          >
            <Printer size={13} /> Print FA Code Stickers{selectedRows.length ? ` (${selectedRows.length})` : ""}
          </button>
        }
      >
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <GlassCard label="Registered FA Item Codes" value={isLoading ? "—" : list.length} icon={Boxes} accentColor="#eab308" />
          <GlassCard label="Selected" value={selected.size} icon={Check} accentColor="#10b981" />
        </div>

        {/* ── Filters ── */}
        <Card className="border-border shadow-sm mt-4 mb-5">
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}><Search size={11} /> FA Item Code</label>
                <div className="relative">
                  <input
                    value={draft.faCode}
                    onChange={(e) => setDraft((p) => ({ ...p, faCode: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && apply()}
                    placeholder="Search FA Item Code…"
                    className={inputCls}
                  />
                  {draft.faCode && (
                    <button onClick={() => setDraft((p) => ({ ...p, faCode: "" }))}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className={labelCls}><Search size={11} /> Item Name</label>
                <div className="relative">
                  <input
                    value={draft.itemName}
                    onChange={(e) => setDraft((p) => ({ ...p, itemName: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && apply()}
                    placeholder="Search Item Name…"
                    className={inputCls}
                  />
                  {draft.itemName && (
                    <button onClick={() => setDraft((p) => ({ ...p, itemName: "" }))}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div>
                <label className={labelCls}>Company</label>
                <select value={draft.companyId} onChange={(e) => setDraft((p) => ({ ...p, companyId: e.target.value }))} className={inputCls}>
                  <option value="">All Companies</option>
                  {ensureArray<{ id: number; label: string }>(companies).map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Financial Year</label>
                <select value={draft.finYear} onChange={(e) => setDraft((p) => ({ ...p, finYear: e.target.value }))} className={inputCls}>
                  <option value="">All Years</option>
                  {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> From Date</label>
                <input type="date" value={draft.fromDate} onChange={(e) => setDraft((p) => ({ ...p, fromDate: e.target.value }))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><Calendar size={11} /> To Date</label>
                <input type="date" value={draft.toDate} onChange={(e) => setDraft((p) => ({ ...p, toDate: e.target.value }))} className={inputCls} />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-muted-foreground">
                {isLoading ? "Loading…" : `${list.length} FA Item Code${list.length === 1 ? "" : "s"}`}
                {hasFilters ? " (filtered)" : ""}
              </span>
              <div className="flex items-center gap-2">
                <button onClick={reset}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors">
                  <RotateCcw size={12} /> Reset Filter
                </button>
                <button onClick={apply}
                  className="inline-flex items-center gap-1.5 text-xs font-heading font-semibold text-white px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all">
                  <Filter size={12} /> Apply Filter
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Results ── */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3 border-b border-border flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">Completed Depreciation Tags</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">FA Item Codes that are Tagged and have a Fixed Asset Record from the Asset Register — always available for sticker reprint</p>
            </div>
            {list.length > 0 && (
              <button onClick={toggleAll}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors shrink-0">
                <Check size={12} /> {allSelected ? "Clear All" : "Select All"}
              </button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">Loading FA Item Codes…</div>
            ) : list.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
No FA Item Codes with a completed Asset Register{hasFilters ? " match these filters" : " yet"}.
              </div>
            ) : (
              <>
                {/* desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                        <th className="px-4 py-3 w-16 text-left">Select</th>
                        <th className="px-4 py-3 text-left">FA Item Code</th>
                        <th className="px-4 py-3 text-left">Item Name</th>
                        <th className="px-4 py-3 text-left w-28">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {list.map((r) => (
                        <tr key={r.TagId} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => toggleOne(r.TagId)}>
                          <td className="px-4 py-2.5">
                            <input type="checkbox" checked={selected.has(r.TagId)} onChange={() => toggleOne(r.TagId)} onClick={(e) => e.stopPropagation()}
                              className="h-4 w-4 rounded border-border accent-yellow-500" />
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs font-semibold text-yellow-600 dark:text-yellow-400">{r.FAItemCode}</td>
                          <td className="px-4 py-2.5">{r.ItemName || "—"}</td>
                          <td className="px-4 py-2.5">
                            <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                              Tagged
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* mobile cards */}
                <div className="sm:hidden divide-y divide-border">
                  {list.map((r) => (
                    <button key={r.TagId} onClick={() => toggleOne(r.TagId)}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors">
                      <input type="checkbox" checked={selected.has(r.TagId)} onChange={() => toggleOne(r.TagId)} onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 mt-0.5 rounded border-border accent-yellow-500 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-semibold text-yellow-600 dark:text-yellow-400 break-all">{r.FAItemCode}</p>
                        <p className="text-sm mt-0.5">{r.ItemName || "—"}</p>
                        <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          Tagged
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </GlassShell>

      {/* ── Sticker print dialog ── */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Print Preview — {selectedRows.length} FA Code Sticker{selectedRows.length === 1 ? "" : "s"}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto flex flex-wrap gap-3 p-1">
            {selectedRows.map((r) => <StickerPreview key={r.TagId} row={r} />)}
          </div>
          <DialogFooter>
            <button onClick={() => setPrintOpen(false)}
              className="text-xs font-medium px-3.5 py-2 rounded-lg border border-border hover:bg-muted transition-colors">
              Cancel
            </button>
            <button
              onClick={() => { printStickers(selectedRows); setPrintOpen(false); }}
              className="inline-flex items-center gap-1.5 text-xs font-heading font-semibold text-white px-4 py-2 rounded-lg bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-600 transition-all"
            >
              <Printer size={13} /> Print {selectedRows.length} Sticker{selectedRows.length === 1 ? "" : "s"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
