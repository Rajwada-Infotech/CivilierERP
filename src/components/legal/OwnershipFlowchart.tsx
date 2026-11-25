import React, { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { askLegal } from "@/components/legal/LegalAsk";
import { getFlowVersions, importDeedChain, saveFlowVersion, type ActivityEntry } from "@/api/legalVerificationApi";

type Data = Record<string, string | number | null>;
interface Edge { id: number; from: string; to: string; data: Data }
interface Node { key: string; name: string; col: number; row: number; root: boolean; firstYear: number | null; noEarlier: boolean }

const NODE_W = 190, NODE_H = 46, COL_GAP = 120, ROW_GAP = 26, PAD = 24;
const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const yearOf = (d: Data) => (d.transferDate ? Number(String(d.transferDate).slice(0, 4)) : d.transferYear != null ? Number(d.transferYear) : null);

/** Lay owners out left → right by generation: an owner sits one column after everyone they received land from. */
function layout(rows: { EntryId: number; data: Data }[]) {
  const edges: Edge[] = rows.filter((r) => r.data.fromOwner && r.data.toOwner).map((r) => ({ id: r.EntryId, from: norm(r.data.fromOwner), to: norm(r.data.toOwner), data: r.data }));
  const names = new Map<string, string>();
  for (const r of rows) { names.set(norm(r.data.fromOwner), String(r.data.fromOwner)); names.set(norm(r.data.toOwner), String(r.data.toOwner)); }
  names.delete("");
  const col = new Map<string, number>([...names.keys()].map((k) => [k, 0]));
  for (let i = 0; i < names.size; i++) { // longest-path layering; bounded so a loop in the data cannot hang
    let moved = false;
    for (const e of edges) { const c = (col.get(e.from) ?? 0) + 1; if (c > (col.get(e.to) ?? 0) && c < names.size) { col.set(e.to, c); moved = true; } }
    if (!moved) break;
  }
  const incoming = new Set(edges.map((e) => e.to));
  const firstOut = (k: string) => Math.min(...edges.filter((e) => e.from === k).map((e) => yearOf(e.data) ?? Infinity));
  const years = edges.map((e) => yearOf(e.data)).filter((y): y is number => y != null);
  const minYear = years.length ? Math.min(...years) : null;
  const byCol = new Map<number, string[]>();
  for (const [k, c] of col) byCol.set(c, [...(byCol.get(c) ?? []), k]);
  const nodes: Node[] = [];
  for (const [c, keys] of [...byCol].sort((a, b) => a[0] - b[0])) {
    keys.sort((a, b) => firstOut(a) - firstOut(b) || a.localeCompare(b)).forEach((k, row) => {
      const fy = firstOut(k);
      const root = !incoming.has(k);
      nodes.push({ key: k, name: names.get(k) ?? k, col: c, row, root, firstYear: Number.isFinite(fy) ? fy : null,
        // A first owner whose own transfer is later than the earliest one on record: where did they get it from?
        noEarlier: root && minYear != null && Number.isFinite(fy) && fy > minYear });
    });
  }
  return { nodes, edges };
}

const pos = (n: Node) => ({ x: PAD + n.col * (NODE_W + COL_GAP), y: PAD + n.row * (NODE_H + ROW_GAP) });

function FlowSvg({ rows, svgRef }: { rows: { EntryId: number; data: Data }[]; svgRef?: React.Ref<SVGSVGElement> }) {
  const { nodes, edges } = useMemo(() => layout(rows), [rows]);
  if (!nodes.length) return <p className="p-4 text-xs text-muted-foreground">Add ownership transfers to draw the flowchart.</p>;
  const at = new Map(nodes.map((n) => [n.key, n]));
  const W = PAD * 2 + (Math.max(...nodes.map((n) => n.col)) + 1) * (NODE_W + COL_GAP) - COL_GAP;
  const H = PAD * 2 + (Math.max(...nodes.map((n) => n.row)) + 1) * (NODE_H + ROW_GAP) - ROW_GAP + 30;
  const tone = (v: unknown) => (v === "Verified" ? "#15803d" : v === "Missing Document" ? "#dc2626" : "#b45309");
  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Historical ownership flowchart" style={{ fontFamily: "inherit", maxWidth: "none" }}>
      <defs>{["#15803d", "#dc2626", "#b45309"].map((c) => (
        <marker key={c} id={`arr${c.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill={c} /></marker>
      ))}</defs>
      {edges.map((e, i) => {
        const a = at.get(e.from), b = at.get(e.to);
        if (!a || !b) return null;
        const p = pos(a), q = pos(b);
        const x1 = p.x + NODE_W, y1 = p.y + NODE_H / 2, x2 = q.x, y2 = q.y + NODE_H / 2;
        const back = x2 <= x1; // a loop in the data: draw it as a curve under the boxes
        const d = back ? `M${x1},${y1} C${x1 + 60},${y1 + 80} ${x2 - 60},${y2 + 80} ${x2},${y2}` : `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
        const c = tone(e.data.verification);
        const year = yearOf(e.data);
        const label = `${e.data.transferType ?? ""}${year ? ` ${year}` : ""}${e.data.deedNo ? ` · ${e.data.deedNo}` : ""}`;
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 + (back ? 60 : 0) - 6 + (i % 2) * 12;
        return (
          <g key={e.id}>
            <path d={d} fill="none" stroke={c} strokeWidth={1.6} strokeDasharray={e.data.verification === "Verified" ? undefined : "5 4"} markerEnd={`url(#arr${c.slice(1)})`} />
            <text x={mx} y={my} textAnchor="middle" fontSize={10} fill={c} stroke="hsl(var(--card))" strokeWidth={3} paintOrder="stroke">{label}{e.data.verification === "Missing Document" ? " ⚠" : ""}</text>
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos(n);
        return (
          <g key={n.key}>
            <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} fill="hsl(var(--card))" stroke={n.noEarlier ? "#dc2626" : "currentColor"} strokeWidth={n.root ? 2 : 1} strokeDasharray={n.noEarlier ? "4 3" : undefined} />
            <text x={p.x + 8} y={p.y + 19} fontSize={12} fontWeight={600} fill="currentColor">{n.name.length > 26 ? `${n.name.slice(0, 25)}…` : n.name}</text>
            <text x={p.x + 8} y={p.y + 35} fontSize={10} fill={n.noEarlier ? "#dc2626" : "hsl(var(--muted-foreground))"}>
              {n.noEarlier ? "Earlier owner not on record" : n.root ? "Earliest owner on record" : n.firstYear ? `Transferred ${n.firstYear}` : "Current / last owner"}
            </text>
          </g>
        );
      })}
      <g transform={`translate(${PAD}, ${H - 14})`} fontSize={10}>
        <line x1={0} y1={-3} x2={24} y2={-3} stroke="#15803d" strokeWidth={1.6} /><text x={30} y={0} fill="currentColor">Verified</text>
        <line x1={90} y1={-3} x2={114} y2={-3} stroke="#b45309" strokeWidth={1.6} strokeDasharray="5 4" /><text x={120} y={0} fill="currentColor">Unverified</text>
        <line x1={190} y1={-3} x2={214} y2={-3} stroke="#dc2626" strokeWidth={1.6} strokeDasharray="5 4" /><text x={220} y={0} fill="currentColor">Missing document</text>
      </g>
    </svg>
  );
}

/** Print the drawn flowchart (the browser's Save as PDF). */
function printSvg(svg: SVGSVGElement | null, title: string) {
  if (!svg) return;
  const w = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
  if (!w) { toast.error("Allow pop-ups to print the flowchart"); return; }
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.style.color = "#111";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:system-ui,sans-serif;margin:24px;color:#111} :root{--card:0 0% 100%;--muted-foreground:0 0% 40%} @page{size:landscape}</style></head><body><h2 style="margin:0 0 4px">${title}</h2><p style="margin:0 0 16px;font-size:12px;color:#555">Printed ${new Date().toLocaleString("en-IN")} · links are verified only where marked Verified.</p>${clone.outerHTML}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

/** The historical ownership flowchart of activity 8: drawn from its transfers, with import, versions and print. */
export function OwnershipFlowchart({ activityId, entries, canEdit, title, onChanged }: { activityId: number; entries: ActivityEntry[]; canEdit: boolean; title: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const svgRef = useRef<SVGSVGElement>(null);
  const [showVersion, setShowVersion] = useState<number | null>(null);
  const versions = useQuery({ queryKey: ["legal-flow-versions", activityId], queryFn: () => getFlowVersions(activityId) });
  const shown = showVersion == null ? entries : versions.data?.find((v) => v.HistoryId === showVersion)?.entries ?? [];
  const run = async (fn: () => Promise<{ message: string }>) => {
    try { toast.success((await fn()).message); qc.invalidateQueries({ queryKey: ["legal-flow-versions", activityId] }); onChanged(); } catch (e) { toast.error((e as Error).message); }
  };
  const unverified = entries.filter((e) => e.data.verification !== "Verified").length;
  const missing = entries.filter((e) => e.data.verification === "Missing Document").length;
  return (
    <div className="mb-3 border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <b>Ownership flowchart</b>
        {showVersion == null ? <span className="text-muted-foreground">current · {entries.length} transfers{unverified ? ` · ${unverified} not verified` : ""}{missing ? ` · ${missing} missing documents` : ""}</span>
          : <span className="font-semibold text-amber-700">Showing a saved version</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <select className="h-7 border border-foreground/40 bg-background px-1 text-xs" value={showVersion ?? ""} onChange={(e) => setShowVersion(e.target.value ? Number(e.target.value) : null)} aria-label="Version">
            <option value="">Current</option>
            {(versions.data ?? []).map((v) => <option key={v.HistoryId} value={v.HistoryId}>Version {v.versionNo} · {new Date(v.savedAt).toLocaleDateString("en-IN")}{v.savedBy ? ` · ${v.savedBy}` : ""}</option>)}
          </select>
          {canEdit && showVersion == null && <>
            <button className="h-7 border border-foreground/40 px-2 font-semibold" onClick={() => run(() => importDeedChain(activityId))}>Import from deed chain</button>
            <button className="h-7 border border-foreground/40 px-2 font-semibold" onClick={async () => {
              const note = await askLegal({ title: "Save flowchart version", message: "The current transfers are frozen as a numbered version.", input: { label: "Note (optional)" }, confirmText: "Save version" });
              if (note !== null) run(() => saveFlowVersion(activityId, note));
            }}>Save version</button>
          </>}
          <button className="h-7 bg-foreground px-2 font-semibold text-background" onClick={() => printSvg(svgRef.current, title)}>Print / PDF</button>
        </span>
      </div>
      <div className="overflow-auto bg-card p-1 text-foreground"><FlowSvg rows={shown} svgRef={svgRef} /></div>
    </div>
  );
}
