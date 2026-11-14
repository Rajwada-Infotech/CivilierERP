import { useMemo, useState } from "react";
import { usePageRights } from "@/hooks/usePageRights";
import { preventEnterSubmit } from "@/hooks/useDraftForm";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/ui/DataTable";
import { Plus, Edit2, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

// Floor Master: the floors of a project. Floors from Auto Project Setup are listed as they are (changed in the
// setup wizard); floors it doesn't have are added here for the project — for one block or all of them. The BOQ
// Floor dropdown offers both.

type Option = { id: number; label: string };
type Block = { id: number; name: string };
type FloorRow = {
  source: "setup" | "manual";
  id: number;
  blockId: number | null;
  blockName: string | null;
  floorNo: number;
  floorLabel: string;
  name: string;
  unitCount: number | null;
  createdBy: string | null;
};

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";
const inputCls = "w-full h-9 border border-foreground/40 focus:border-foreground bg-card px-3 text-sm text-foreground focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-50";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetchWithAuth(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}
async function send(url: string, method: string, data?: unknown) {
  const res = await fetchWithAuth(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body;
}

const toOptions = (rows: any): Option[] =>
  (Array.isArray(rows) ? rows : []).map((r: any) => ({ id: Number(r.id), label: String(r.label ?? r.name ?? "") }));

export default function FloorMaster() {
  const rights = usePageRights("dpr-floor-master");
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");

  const { data: companies = [] } = useQuery({
    queryKey: ["enterprise-options", "C"],
    queryFn: async () => toOptions(await getJson("/api/enterprises/options?business_type=C")),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["enterprise-options", "P", companyId],
    queryFn: async () => toOptions(await getJson(`/api/enterprises/options?business_type=P&enterprise_id=${companyId}`)),
    enabled: !!companyId,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["dpr-floor-master", projectId],
    queryFn: () => getJson<{ blocks: Block[]; floors: FloorRow[] }>(`/api/dpr-floor-master?projectId=${projectId}`),
    enabled: !!projectId,
  });
  const blocks = data?.blocks ?? [];
  const floors = data?.floors ?? [];

  const [blockFilter, setBlockFilter] = useState("");
  const shown = useMemo(
    () => (blockFilter ? floors.filter((f) => f.blockId == null || String(f.blockId) === blockFilter) : floors),
    [floors, blockFilter],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FloorRow | null>(null);
  const [fBlock, setFBlock] = useState("");
  const [fNo, setFNo] = useState("");
  const [fLabel, setFLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dpr-floor-master", projectId] });

  const openCreate = () => { setEditing(null); setFBlock(blockFilter); setFNo(""); setFLabel(""); setOpen(true); };
  const openEdit = (f: FloorRow) => {
    setEditing(f); setFBlock(f.blockId != null ? String(f.blockId) : ""); setFNo(String(f.floorNo)); setFLabel(f.floorLabel); setOpen(true);
  };

  const save = async () => {
    if (fNo.trim() === "" || !Number.isInteger(Number(fNo))) { toast.error("Floor number is required (0 = Ground, -1 = first basement)"); return; }
    setSaving(true);
    try {
      const payload = { projectId: Number(projectId), blockId: fBlock ? Number(fBlock) : null, floorNo: Number(fNo), floorLabel: fLabel.trim() };
      if (editing) await send(`/api/dpr-floor-master/${editing.id}`, "PUT", payload);
      else await send("/api/dpr-floor-master", "POST", payload);
      toast.success(editing ? "Floor updated" : "Floor added");
      await invalidate();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (f: FloorRow) => {
    if (!window.confirm(`Remove "${f.name}"${f.blockName ? ` from ${f.blockName}` : " from all blocks"}?`)) return;
    try {
      await send(`/api/dpr-floor-master/${f.id}`, "DELETE");
      toast.success("Floor removed");
      await invalidate();
    } catch (e: any) {
      toast.error(e.message ?? "Remove failed");
    }
  };

  const columns: ColumnDef<FloorRow, unknown>[] = [
    { id: "block", header: "Block", cell: ({ row }) => row.original.blockName ? <span className="font-medium">{row.original.blockName}</span> : <span className="text-muted-foreground">All blocks</span> },
    { id: "floor", header: "Floor", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "no", header: "No.", cell: ({ row }) => <span className="font-heading text-xs font-semibold tabular-nums">{row.original.floorNo}</span> },
    {
      id: "source",
      header: "From",
      cell: ({ row }) => row.original.source === "setup" ? <span className={LBL}>Auto Project Setup</span> : <SheetMark text="Added here" tone="done" />,
    },
    {
      id: "units",
      header: "Units",
      cell: ({ row }) => <span className="font-heading text-xs tabular-nums text-muted-foreground">{row.original.source === "setup" ? row.original.unitCount ?? 0 : "—"}</span>,
    },
    {
      id: "actions",
      header: "Actions",
      enableSorting: false,
      cell: ({ row }) => row.original.source !== "manual" ? null : (
        <div className="flex items-center gap-1">
          {rights.canEdit && (
            <button onClick={() => openEdit(row.original)} className={ACT} title="Edit" aria-label="Edit">
              <Edit2 size={13} />
            </button>
          )}
          {rights.canDelete && (
            <button onClick={() => remove(row.original)} className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive transition-colors" title="Remove" aria-label="Remove">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];

  const fromSetup = floors.filter((f) => f.source === "setup").length;

  return (
    <>
      <Breadcrumbs items={[{ label: "Civil Work DPR", path: "/civilworkdpr" }, { label: "Floor Master" }]} />
      <SheetShell
        eyebrow="CivilierERP · Civil Work DPR"
        title="Floors"
        subtitle="The floors of a project, read from Auto Project Setup. Add the floors it doesn't have — terrace, basement, podium — for one block or all of them. BOQ offers every floor listed here."
        action={
          rights.canCreate && projectId ? (
            <button onClick={openCreate} className={`${KEY} h-9 px-4 bg-foreground text-card border border-foreground`}>
              <Plus size={13} /> New floor
            </button>
          ) : undefined
        }
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4">
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>Company</label>
              <select className={inputCls} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); setBlockFilter(""); }}>
                <option value="">— Select company —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>Project</label>
              <select className={inputCls} value={projectId} disabled={!companyId} onChange={(e) => { setProjectId(e.target.value); setBlockFilter(""); }}>
                <option value="">{companyId ? (projects.length ? "— Select project —" : "No projects for this company") : "— Select company first —"}</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>Block</label>
              <select className={inputCls} value={blockFilter} disabled={!projectId} onChange={(e) => setBlockFilter(e.target.value)}>
                <option value="">All blocks</option>
                {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        {projectId && (
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Floors", value: floors.length, note: "in this project" },
                { label: "From setup", value: fromSetup, note: "Auto Project Setup" },
                { label: "Added here", value: floors.length - fromSetup, note: "for this project" },
              ].map((x) => (
                <div key={x.label}>
                  <p className="label">{x.label}</p>
                  <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{x.value.toLocaleString("en-IN")}</p>
                  <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <p className="flex items-baseline gap-2.5">
              <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Floors</span>
              <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{shown.length}</span>
            </p>
          </div>
          <DataTable
            columns={columns}
            data={shown}
            loading={!!projectId && isLoading}
            emptyMessage={projectId ? "No floors yet. Set the project up in Auto Project Setup, or add a floor here." : "Select a company and project to see its floors."}
          />
        </div>
      </SheetShell>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sheet-frame max-w-md" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Floor</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">{editing ? "Edit floor" : "New floor"}</DialogTitle>
            </div>
          </DialogHeader>
          <div className="space-y-4 pt-1" onKeyDown={preventEnterSubmit}>
            <div className="space-y-1.5">
              <label className={`${LBL} block`}>Block</label>
              <select className={inputCls} value={fBlock} onChange={(e) => setFBlock(e.target.value)}>
                <option value="">All blocks of the project</option>
                {blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <div className="space-y-1.5">
                <label className={`${LBL} block`}>
                  Floor no. <span className="text-destructive">*</span>
                </label>
                <input className={inputCls} type="number" step={1} min={-10} max={300} placeholder="e.g. 12" value={fNo} onChange={(e) => setFNo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className={`${LBL} block`}>Name</label>
                <input className={inputCls} maxLength={50} placeholder="e.g. Terrace" value={fLabel} onChange={(e) => setFLabel(e.target.value)} />
              </div>
            </div>
            <p className="text-[0.6875rem] text-muted-foreground">0 is the ground floor, negative numbers are basements. Leave the name blank to show "Floor 12".</p>
            <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
              <button onClick={() => setOpen(false)} className={`${KEY} h-9 px-4 border border-foreground text-foreground hover:bg-primary/10`}>Cancel</button>
              <button onClick={save} disabled={saving} className={`${KEY} h-9 px-5 bg-foreground text-card border border-foreground`}>
                {saving ? "Saving…" : editing ? "Update" : "Add"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
