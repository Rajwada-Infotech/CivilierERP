import React from "react";
import type { EntryRecord } from "@/api/legalFlowApi";

/**
 * Ownership History as a family / chain-of-title tree: each owner hangs under the owner they got the land from
 * (the "Previous owner" field). Owners whose previous owner is not itself an ownership record start from that name
 * (e.g. a deceased owner recorded only under Inheritance), or from the top when there is none.
 */
type Node = { key: string; name: string; share?: string; from?: string; to?: string; type?: string; rel?: string; how?: string; virtual?: boolean; kids: Node[] };

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const fmt = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : s ?? undefined);
const field = (r: EntryRecord, ...labels: string[]) => {
  for (const l of labels) {
    const f = r.fields.find((x) => norm(x.l).startsWith(l));
    if (f?.v != null && f.v !== "") return String(f.v);
  }
  return undefined;
};

function build(records: EntryRecord[]): Node[] {
  const owners: Node[] = records.filter((r) => r.master === "ownership-record").map((r) => ({
    key: `o${r.id}`,
    name: field(r, "owner name", "owner") ?? r.title,
    share: field(r, "ownership share", "share"),
    from: field(r, "ownership start", "start date", "owner since"),
    to: field(r, "ownership end", "end date"),
    type: field(r, "ownership type"),
    rel: field(r, "relationship"),
    how: field(r, "previous owner"),
    kids: [],
  }));
  // How each deceased owner's land passed (Inheritance records), to label the virtual parent.
  const deceased = new Set(records.filter((r) => r.master === "inheritance").map((r) => norm(field(r, "deceased owner name") ?? "")).filter(Boolean));
  const byName = new Map<string, Node[]>();
  owners.forEach((o) => { const k = norm(o.name); byName.set(k, [...(byName.get(k) ?? []), o]); });
  const virtual = new Map<string, Node>();
  const roots: Node[] = [];
  for (const o of owners) {
    const prev = o.how ? norm(o.how) : "";
    const parents = prev ? byName.get(prev) : undefined;
    // The previous owner's holding that started before this one (the one that was given; never a holding kept afterwards).
    const parent = parents?.filter((p) => p !== o && (!o.from || !p.from || String(p.from) < String(o.from)))
      .sort((a, b) => String(b.from ?? "").localeCompare(String(a.from ?? "")))[0];
    if (parent) parent.kids.push(o);
    else if (prev) {
      let v = virtual.get(prev);
      if (!v) { v = { key: `v${prev}`, name: o.how!.trim(), virtual: true, type: deceased.has(prev) ? "Deceased · inherited by" : "Earlier owner", kids: [] }; virtual.set(prev, v); roots.push(v); }
      v.kids.push(o);
    } else roots.push(o);
  }
  const byDate = (a: Node, b: Node) => String(a.from ?? "").localeCompare(String(b.from ?? ""));
  const sort = (ns: Node[]) => { ns.sort(byDate); ns.forEach((n) => sort(n.kids)); };
  sort(roots);
  return roots;
}

function Box({ n }: { n: Node }) {
  const current = !n.virtual && !n.to;
  return (
    <div className={`inline-block min-w-[11rem] max-w-[16rem] border px-3 py-2 text-left text-xs ${n.virtual ? "border-dashed border-foreground/40 bg-muted/40" : current ? "border-2 border-emerald-700 bg-emerald-500/10" : "border-foreground/40 bg-card"}`}>
      <b className="block text-sm">{n.name}</b>
      {n.virtual ? <span className="text-muted-foreground">{n.type}</span> : (
        <>
          <span className="block">{n.share ? `${n.share}% share` : "Share not filled"}{n.type ? ` · ${n.type}` : ""}</span>
          {n.rel && <span className="block text-muted-foreground">{n.rel} of previous owner</span>}
          <span className="block text-muted-foreground">{fmt(n.from) ?? "?"} → {n.to ? fmt(n.to) : <b className="text-emerald-700">current</b>}</span>
        </>
      )}
    </div>
  );
}

function Branch({ n, seen, root }: { n: Node; seen: Set<string>; root?: boolean }) {
  if (seen.has(n.key)) return null;
  const next = new Set(seen).add(n.key);
  return (
    <li className={`relative flex flex-col items-center px-2 ${root ? "pt-0" : "pt-4"} before:absolute before:left-0 before:right-0 before:top-0 before:border-t before:border-foreground/40 first:before:left-1/2 last:before:right-1/2 only:before:hidden after:absolute after:left-1/2 after:top-0 after:h-4 after:border-l after:border-foreground/40 ${root ? "before:hidden after:hidden" : ""}`}>
      <Box n={n} />
      {n.kids.length > 0 && (
        <ul className="relative flex justify-center pt-4 before:absolute before:left-1/2 before:top-0 before:h-4 before:border-l before:border-foreground/40">
          {n.kids.map((k) => <Branch key={k.key} n={k} seen={next} />)}
        </ul>
      )}
    </li>
  );
}

export function OwnershipTree({ records }: { records: EntryRecord[] }) {
  const roots = build(records);
  if (!roots.length) return <p className="text-sm text-muted-foreground">No ownership records yet — add owners to see the tree.</p>;
  return (
    <div className="overflow-x-auto pb-2">
      <ul className="flex min-w-max justify-center">
        {roots.map((r) => <Branch key={r.key} n={r} seen={new Set()} root />)}
      </ul>
      <p className="mt-3 flex flex-wrap justify-center gap-4 text-[0.6875rem] text-muted-foreground">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 border-2 border-emerald-700 bg-emerald-500/10 align-middle" />Current owner</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 border border-foreground/40 align-middle" />Earlier owner</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 border border-dashed border-foreground/40 align-middle" />Named only as previous owner</span>
      </p>
    </div>
  );
}
