import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ListTree, Plus, Trash2, ArrowUp, ArrowDown, Wand2, X } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { CivilWorkDprShell } from "@/components/civilworkdpr/CivilWorkDprShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  getChainTemplates,
  getChainTemplateItems,
  saveChainTemplate,
  deleteChainTemplate,
  generateChains,
  type ChainTemplateSummary,
  type ChainTemplateItem,
} from "@/api/dprActivityChainTemplateApi";

const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

async function fetchActivityOptions(): Promise<{ id: number; name: string }[]> {
  const res = await fetchWithAuth("/api/activity-master");
  if (!res.ok) throw new Error("Failed to fetch activities");
  const data: { id: number; activity_name: string; activity_type: number; is_active: boolean }[] =
    await res.json().catch(() => []);
  return data
    .filter((a) => a.activity_type === 1 && a.is_active !== false)
    .map((a) => ({ id: a.id, name: a.activity_name }));
}

async function fetchProjectOptions(): Promise<{ value: string; label: string }[]> {
  const res = await fetchWithAuth("/api/unit-master/projects");
  if (!res.ok) throw new Error("Failed to fetch projects");
  const data: { Id: number; Name: string }[] = await res.json().catch(() => []);
  return data.map((p) => ({ value: String(p.Id), label: p.Name }));
}

async function fetchBlockOptions(projectId: string): Promise<{ value: string; label: string }[]> {
  if (!projectId) return [];
  const res = await fetchWithAuth(`/api/unit-master/blocks?projectId=${projectId}`);
  if (!res.ok) throw new Error("Failed to fetch blocks");
  const data: { Id: number; Name: string }[] = await res.json().catch(() => []);
  return data.map((b) => ({ value: String(b.Id), label: b.Name }));
}

// ── Chain editor — picks an ordered Activity list for one Room Category ────
function ChainEditor({
  category, activities, onClose, onSaved,
}: {
  category: ChainTemplateSummary;
  activities: { id: number; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [chain, setChain] = React.useState<ChainTemplateItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [addingId, setAddingId] = React.useState("");

  React.useEffect(() => {
    let cancelled = false;
    getChainTemplateItems(category.roomCategoryId)
      .then((r) => { if (!cancelled) setChain(r.items); })
      .catch((e) => toast.error(e.message ?? "Failed to load chain"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category.roomCategoryId]);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...chain];
    const swapWith = index + dir;
    if (swapWith < 0 || swapWith >= next.length) return;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setChain(next);
  };

  const remove = (index: number) => setChain(chain.filter((_, i) => i !== index));

  const addActivity = () => {
    const id = parseInt(addingId, 10);
    if (!Number.isFinite(id)) return;
    const activity = activities.find((a) => a.id === id);
    if (!activity) return;
    setChain([...chain, { Id: -Date.now(), SequenceNo: chain.length + 1, ActivityId: id, activityName: activity.name }]);
    setAddingId("");
  };

  const save = async () => {
    if (!chain.length) { toast.error("Add at least one activity"); return; }
    setSaving(true);
    try {
      await saveChainTemplate(category.roomCategoryId, chain.map((c) => c.ActivityId));
      toast.success("Chain saved!");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove_ = async () => {
    if (!confirm(`Remove the activity chain template for "${category.roomCategoryAlias}"?`)) return;
    try {
      await deleteChainTemplate(category.roomCategoryId);
      toast.success("Template removed");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Delete failed");
    }
  };

  const availableToAdd = activities.filter((a) => !chain.some((c) => c.ActivityId === a.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
          <span className="text-sm font-heading font-semibold text-foreground">
            Activity Chain — {category.roomCategoryAlias}
          </span>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-2">
          {loading ? (
            <div className="h-20 rounded-lg border border-border bg-muted/30 animate-pulse" />
          ) : chain.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activities yet — add the first one below.</p>
          ) : (
            chain.map((item, i) => (
              <div key={item.Id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                <span className="text-[10px] font-semibold text-muted-foreground w-5 shrink-0">{i + 1}</span>
                <span className="flex-1 text-sm text-foreground truncate">{item.activityName}</span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
                  <ArrowUp size={13} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === chain.length - 1} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors">
                  <ArrowDown size={13} />
                </button>
                <button type="button" onClick={() => remove(i)} className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}

          <div className="flex items-center gap-1.5 pt-2">
            <select value={addingId} onChange={(e) => setAddingId(e.target.value)} className={`${inputCls} flex-1`}>
              <option value="">— Select an activity to add —</option>
              {availableToAdd.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={addActivity}
              disabled={!addingId}
              className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 disabled:opacity-50 transition-all"
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-border">
          {category.itemCount > 0 ? (
            <button type="button" onClick={remove_} className="text-xs text-destructive hover:underline">
              Remove template
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={save}
            disabled={saving || !chain.length}
            className="inline-flex items-center gap-1.5 font-heading font-semibold text-white shadow-sm text-xs px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 disabled:opacity-50 transition-all"
          >
            {saving ? "Saving..." : "Save Chain"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Generate panel ───────────────────────────────────────────────────────────
function GeneratePanel() {
  const [projectOptions, setProjectOptions] = React.useState<{ value: string; label: string }[]>([]);
  const [blockOptions, setBlockOptions] = React.useState<{ value: string; label: string }[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [blockId, setBlockId] = React.useState("");
  const [workType, setWorkType] = React.useState<"INTERNAL" | "EXTERNAL">("INTERNAL");
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<string | null>(null);

  React.useEffect(() => { fetchProjectOptions().then(setProjectOptions).catch(() => {}); }, []);
  React.useEffect(() => {
    setBlockId("");
    if (!projectId) { setBlockOptions([]); return; }
    fetchBlockOptions(projectId).then(setBlockOptions).catch(() => {});
  }, [projectId]);

  const run = async () => {
    const pid = parseInt(projectId, 10);
    if (!Number.isFinite(pid)) { toast.error("Select a project"); return; }
    setRunning(true);
    setResult(null);
    try {
      const r = await generateChains(pid, blockId ? parseInt(blockId, 10) : null, workType);
      setResult(`${r.message} — ${r.generated} generated, ${r.skippedExisting} already had a chain, ${r.skippedNoTemplate} had no saved template for their category (out of ${r.totalRoomsInScope} rooms scanned).`);
      toast.success(`Generated ${r.generated} activity chain(s)`);
    } catch (e: any) {
      toast.error(e.message ?? "Generate failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
        <Wand2 size={14} className="text-cyan-600 dark:text-cyan-400" />
        <span className="text-sm font-heading font-semibold text-foreground">Generate Activity Chains</span>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-xs text-muted-foreground">
          Scans every real Room in the chosen Project (optionally one Block) and creates its Activity Chain from
          the saved template for its Room Category — skipping any Room that already has one.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls}>Project</label>
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputCls}>
              <option value="">— Select —</option>
              {projectOptions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Block (optional)</label>
            <select value={blockId} onChange={(e) => setBlockId(e.target.value)} disabled={!projectId} className={inputCls}>
              <option value="">— Whole project —</option>
              {blockOptions.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Work Type</label>
            <select value={workType} onChange={(e) => setWorkType(e.target.value as "INTERNAL" | "EXTERNAL")} className={inputCls}>
              <option value="INTERNAL">Internal</option>
              <option value="EXTERNAL">External</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={running || !projectId}
          className="inline-flex items-center gap-1.5 font-heading font-semibold text-white shadow-sm text-xs px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:opacity-90 disabled:opacity-50 transition-all"
        >
          <Wand2 size={13} /> {running ? "Generating..." : "Generate"}
        </button>
        {result && <p className="text-xs text-foreground bg-muted/40 rounded-lg px-3 py-2">{result}</p>}
      </div>
    </div>
  );
}

export default function ActivityChainTemplate() {
  const rights = usePageRights("dpr-activity-chain-template");
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<ChainTemplateSummary | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["dpr-activity-chain-templates"],
    queryFn: getChainTemplates,
  });
  const { data: activities = [] } = useQuery({
    queryKey: ["dpr-activity-chain-template-activities"],
    queryFn: fetchActivityOptions,
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["dpr-activity-chain-templates"] });

  return (
    <>
      <Breadcrumbs items={[{ label: "Civil Work DPR", path: "/civilworkdpr" }, { label: "Activity Chain Template" }]} />
      <CivilWorkDprShell
        title="Activity Chain Template"
        subtitle="Define the Activity sequence once per Room Category, then Generate stamps it out across every real Room that matches — no more building the same chain by hand, room by room."
        icon={ListTree}
      >
        {!rights.canView ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            You don't have access to this page.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border bg-muted/30">
                <span className="text-sm font-heading font-semibold text-foreground">Room Category Templates</span>
                <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                  {isLoading ? "…" : templates.length}
                </span>
              </div>
              <div className="p-5 space-y-2">
                {isLoading ? (
                  <div className="h-20 rounded-lg border border-border bg-muted/30 animate-pulse" />
                ) : templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No Room Categories set up yet — add some in Room Categories first.</p>
                ) : (
                  templates.map((t) => (
                    <button
                      key={t.roomCategoryId}
                      type="button"
                      onClick={() => rights.canEdit && setEditing(t)}
                      disabled={!rights.canEdit}
                      className="w-full flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-muted/40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
                    >
                      <span className="text-sm font-medium text-foreground">{t.roomCategoryAlias}</span>
                      {t.itemCount > 0 ? (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                          {t.itemCount} activities
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                          No chain yet
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {rights.canCreate && <GeneratePanel />}
          </div>
        )}

        {editing && (
          <ChainEditor
            category={editing}
            activities={activities}
            onClose={() => setEditing(null)}
            onSaved={invalidate}
          />
        )}
      </CivilWorkDprShell>
    </>
  );
}
