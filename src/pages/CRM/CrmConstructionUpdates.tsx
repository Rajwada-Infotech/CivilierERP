// Construction Updates: keeps the unified Bookings/Applications card & CrmGrid design system while organizing
// the layout specifically for construction progression (Portfolio -> Project -> Block -> Unit, ordered DPR stages,
// recent site movements, and buyer-facing updates).
import React, { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, Building2, Check, ChevronDown, Clock, Download, Layers, ListChecks, Megaphone, Plus, Printer, RefreshCw,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { printLegalSheet } from "@/lib/legalPrint";
import { cn, naturalCompare } from "@/lib/utils";
import { usePageRights } from "@/hooks/usePageRights";
import type { CrmSort } from "@/hooks/useCrmListState";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DateInput } from "@/components/ui/date-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CrmGrid, GridColumnChooser, GridDialog, GridGuidance, GridSearch, GridSegment, GridTabs, GridToneMark, exportGrid, useGridPrefs,
  GRID_BTN, GRID_BTN_BRAND, GRID_CARD, GRID_INPUT, GRID_KEY, GRID_KEY_BRAND, GRID_PAGE_SIZES, GRID_SHEET_KEYS, type GridCol,
} from "@/components/crm/CrmDataTable";
import { TONE_AMBER_TEXT, TONE_EMERALD_TEXT, TONE_ROSE_TEXT } from "./payments/parts";

const API = "/api/crm/construction-updates";
const { INP, LBL, TEXTAREA } = GRID_SHEET_KEYS;
const PROJECT_PREFS_KEY = "crm-construction-projects-v2";
const UNIT_PREFS_KEY = "crm-construction-units-v6";

type PortfolioTab = "projects" | "late" | "updates";
type ProjectTab = "overview" | "units" | "updates";
type UnitFilter = "all" | "active" | "done" | "late";

const pct = (value: unknown) => Math.min(100, Math.max(0, Number(value) || 0));
const todayIso = () => new Date().toISOString().slice(0, 10);

function fmtDate(value: unknown) {
  if (!value) return "—";
  const dt = new Date(String(value));
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(value: unknown) {
  if (!value) return "";
  const dt = new Date(String(value));
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ago(value: unknown) {
  if (!value) return "—";
  const ms = new Date(String(value)).getTime();
  if (Number.isNaN(ms)) return "—";
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

async function getJson(url: string, what: string) {
  const response = await fetchWithAuth(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Could not load ${what} (${response.status}).`);
  return payload;
}

function ProgressBar({ value, size = "sm", className = "" }: { value: number; size?: "sm" | "md"; className?: string }) {
  const v = pct(value);
  return (
    <div className={cn("overflow-hidden rounded-full bg-muted [[data-theme]_&]:bg-slate-200/80", size === "md" ? "h-2" : "h-1.5", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          v >= 100 ? "bg-emerald-400 [[data-theme]_&]:bg-emerald-500" : "bg-primary",
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

/** Segmented build-order stage bar so a project/block/unit's entire DPR sequence reads at a glance. */
function StageBar({ works, pctFallback = 0 }: { works?: any[]; pctFallback?: number }) {
  if (!works?.length) return <ProgressBar value={pctFallback} size="md" />;
  return (
    <div className="flex h-2 w-full gap-0.5 rounded-full overflow-hidden" role="img" aria-label="Build stage progression">
      {works.map((w) => {
        const wPct = pct(w.pct);
        return (
          <span
            key={w.groupId ?? w.name}
            title={`${w.name}: ${wPct}% (${w.done ?? 0}/${w.steps ?? 0} tasks)`}
            style={{ flex: `${Math.max(Number(w.steps) || 1, 1)} 1 0`, minWidth: 4 }}
            className="h-full overflow-hidden bg-muted [[data-theme]_&]:bg-slate-200/80"
          >
            {wPct > 0 && (
              <span
                className={cn("block h-full", wPct >= 100 ? "bg-emerald-400 [[data-theme]_&]:bg-emerald-500" : "bg-primary")}
                style={{ width: `${wPct}%` }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

type PickOption = { value: string; label: string; pct?: number | null };

function ProgressPicker({ id, label, value, options, onChange, className = "w-64" }: {
  id: string; label?: string; value: string; options: PickOption[]; onChange: (value: string) => void; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const current = options.find((o) => o.value === value) ?? options[0];
  const shown = find.trim()
    ? options.filter((o, i) => i === 0 || o.label.toLowerCase().includes(find.trim().toLowerCase()))
    : options;

  return (
    <div className="min-w-0">
      {label && <label htmlFor={id} className={cn("mb-1 block", LBL)}>{label}</label>}
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFind(""); }}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={label || "Select scope"}
            className={cn(
              "flex h-9 max-w-full items-center gap-2.5 rounded-md border border-border bg-card px-3 text-left text-xs font-medium text-foreground outline-none transition hover:bg-muted/35 focus:border-primary focus:ring-2 focus:ring-primary/20",
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate">{current?.label}</span>
            {current?.pct != null && (
              <>
                <ProgressBar value={current.pct} className="w-14 shrink-0" />
                <span className="w-9 text-right font-semibold tabular-nums">{pct(current.pct)}%</span>
              </>
            )}
            <ChevronDown size={13} className="shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] rounded-xl border border-border bg-card p-0 shadow-lg">
          {options.length > 8 && (
            <div className="border-b border-border p-2">
              <input autoFocus value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search…" className={cn(INP, "h-8 text-xs")} />
            </div>
          )}
          <div role="listbox" aria-label={label || "Options"} className="max-h-72 overflow-y-auto thin-scroll py-1">
            {shown.map((o, i) => {
              const on = o.value === value;
              return (
                <button
                  key={o.value || "all"}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => { onChange(o.value); setOpen(false); setFind(""); }}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-xs transition hover:bg-muted/50 focus:bg-muted/50 focus:outline-none",
                    on && "bg-primary/10 text-foreground",
                    i === 0 && "font-semibold",
                    i === 0 && shown.length > 1 && "border-b border-border",
                  )}
                >
                  <span className="flex items-center gap-2.5">
                    <span className="w-4 shrink-0">{on && <Check size={13} className="text-primary" />}</span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.pct != null && (
                      <>
                        <ProgressBar value={o.pct} className="w-14 shrink-0" />
                        <span className="w-9 text-right font-semibold tabular-nums">{pct(o.pct)}%</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const CrmConstructionUpdates: React.FC = () => {
  const qc = useQueryClient();
  const rights = usePageRights("crm-construction-updates");
  const [searchParams, setSearchParams] = useSearchParams();
  const printHostRef = useRef<HTMLDivElement>(null);

  const selectedId = searchParams.get("projectId") || "";
  const selectedBlockId = searchParams.get("blockId") || "";
  const selectedUnitId = searchParams.get("unitId") || "";

  const setScope = (next: { projectId?: string; blockId?: string; unitId?: string }) => {
    setSearchParams((sp) => {
      const p = new URLSearchParams(sp);
      if (next.projectId !== undefined) {
        if (next.projectId) p.set("projectId", next.projectId); else p.delete("projectId");
      }
      if (next.blockId !== undefined) {
        if (next.blockId) p.set("blockId", next.blockId); else p.delete("blockId");
      }
      if (next.unitId !== undefined) {
        if (next.unitId) p.set("unitId", next.unitId); else p.delete("unitId");
      }
      return p;
    }, { replace: true });
  };

  const [portfolioTab, setPortfolioTab] = useState<PortfolioTab>("projects");
  const [projectTab, setProjectTab] = useState<ProjectTab>("overview");
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState<UnitFilter>("all");
  const [projectSort, setProjectSort] = useState<CrmSort>({ key: "name", dir: "asc" });
  const [unitSort, setUnitSort] = useState<CrmSort>({ key: "unit", dir: "asc" });
  const [simpleSort, setSimpleSort] = useState<CrmSort>({ key: "", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(GRID_PAGE_SIZES[0]);

  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [noteForm, setNoteForm] = useState({ projectId: "", updateDate: todayIso(), percent: "", stage: "", summary: "" });
  const [savingNote, setSavingNote] = useState(false);

  const projectsQ = useQuery({
    queryKey: ["crm-construction-progress"],
    queryFn: () => getJson(`${API}/progress`, "construction progress"),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const notesQ = useQuery({
    queryKey: ["crm-construction-notes"],
    queryFn: () => getJson(API, "buyer construction updates"),
    staleTime: 30_000,
  });

  const allProjects: any[] = projectsQ.data?.projects ?? [];
  const dprProjects = useMemo(() => allProjects.filter((p) => p.hasDpr), [allProjects]);
  const lateProjects = useMemo(() => dprProjects.filter((p) => Number(p.late || 0) > 0), [dprProjects]);
  const selected = selectedId ? allProjects.find((p) => String(p.projectId) === selectedId) : undefined;
  const detailUrl = selected ? `${API}/progress/${selected.projectId}${selectedBlockId ? `?blockId=${selectedBlockId}` : ""}` : "";

  const baseDetailQ = useQuery({
    queryKey: ["crm-construction-detail", selected?.projectId, selectedBlockId],
    queryFn: () => getJson(detailUrl, "project progression"),
    enabled: Boolean(selected?.projectId),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const unitDetailQ = useQuery({
    queryKey: ["crm-construction-unit-detail", selected?.projectId, selectedBlockId, selectedUnitId],
    queryFn: () => getJson(`${detailUrl}${detailUrl.includes("?") ? "&" : "?"}unitId=${selectedUnitId}`, "unit progression"),
    enabled: Boolean(selected?.projectId && selectedUnitId),
    staleTime: 30_000,
    refetchInterval: 120_000,
  });

  const detailQ = selectedUnitId ? unitDetailQ : baseDetailQ;
  const detail = detailQ.data;
  const projectTowers: any[] | undefined = baseDetailQ.data?.towers ?? selected?.towers;
  const selectedBlockName = baseDetailQ.data?.towers?.find((t: any) => String(t.blockId) === selectedBlockId)?.blockName;
  const selectedUnitName = baseDetailQ.data?.units?.find((u: any) => String(u.unitId) === selectedUnitId)?.unitName;
  const focusName = selectedUnitName || selectedBlockName || selected?.projectName;
  const focusType = selectedUnitId ? "Unit" : selectedBlockId ? "Block" : "Project";

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["crm-construction-progress"] });
    qc.invalidateQueries({ queryKey: ["crm-construction-notes"] });
    if (selected?.projectId) {
      qc.invalidateQueries({ queryKey: ["crm-construction-detail", selected.projectId] });
      qc.invalidateQueries({ queryKey: ["crm-construction-unit-detail", selected.projectId] });
    }
  };

  const openNoteDialog = (presetProjectId?: string | number) => {
    setNoteForm({
      projectId: presetProjectId ? String(presetProjectId) : (selected ? String(selected.projectId) : (allProjects[0] ? String(allProjects[0].projectId) : "")),
      updateDate: todayIso(),
      percent: "",
      stage: "",
      summary: "",
    });
    setNoteDialogOpen(true);
  };

  const submitNote = async () => {
    const pid = parseInt(noteForm.projectId, 10);
    if (!pid) { toast.error("Select a project first"); return; }
    if (!noteForm.summary.trim()) { toast.error("Write the update summary for buyers"); return; }
    setSavingNote(true);
    try {
      const targetProj = allProjects.find((p) => p.projectId === pid);
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ProjectId: pid,
          UpdateDate: noteForm.updateDate || undefined,
          PercentComplete: !targetProj?.hasDpr && noteForm.percent !== "" ? Number(noteForm.percent) : undefined,
          Stage: !targetProj?.hasDpr && noteForm.stage.trim() ? noteForm.stage.trim() : undefined,
          Summary: noteForm.summary.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not publish buyer update");
      toast.success("Buyer construction update published");
      setNoteDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["crm-construction-notes"] });
      qc.invalidateQueries({ queryKey: ["crm-construction-progress"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSavingNote(false);
    }
  };

  const completion = useMemo(() => pct(detail?.pct ?? selected?.pct), [detail?.pct, selected?.pct]);
  const portfolioPct = useMemo(() => {
    if (!dprProjects.length) return 0;
    const weighted = dprProjects.reduce((n, p) => n + pct(p.pct) * Number(p.steps || 1), 0);
    const weightSum = dprProjects.reduce((n, p) => n + Number(p.steps || 1), 0);
    return weightSum > 0 ? Math.round((weighted / weightSum) * 10) / 10 : 0;
  }, [dprProjects]);

  const allNotes: any[] = notesQ.data ?? [];
  const projectNotes = useMemo(
    () => (selected ? allNotes.filter((n) => Number(n.ProjectId) === Number(selected.projectId)) : allNotes),
    [allNotes, selected],
  );

  const activeWorks: any[] = useMemo(() => detail?.works ?? selected?.works ?? [], [detail?.works, selected?.works]);
  const visibleTowers = useMemo(() => (
    selectedBlockId
      ? (detail?.towers ?? []).filter((t: any) => String(t.blockId) === selectedBlockId)
      : (detail?.towers ?? selected?.towers ?? [])
  ), [detail?.towers, selected?.towers, selectedBlockId]);
  const allUnits: any[] = useMemo(() => detail?.units ?? [], [detail?.units]);
  const feedRows: any[] = useMemo(() => detail?.feed ?? [], [detail?.feed]);

  const scopeSteps = Number(detail?.steps ?? selected?.steps ?? 0);
  const scopeDone = Number(detail?.done ?? selected?.done ?? 0);
  const scopeMoving = Number(detail?.moving ?? selected?.moving ?? 0);
  const scopeLate = Number(detail?.late ?? selected?.late ?? 0);
  const totalSteps = useMemo(() => dprProjects.reduce((n, p) => n + Number(p.steps || 0), 0), [dprProjects]);
  const totalDone = useMemo(() => dprProjects.reduce((n, p) => n + Number(p.done || 0), 0), [dprProjects]);
  const totalMoving = useMemo(() => dprProjects.reduce((n, p) => n + Number(p.moving || 0), 0), [dprProjects]);
  const totalLate = useMemo(() => dprProjects.reduce((n, p) => n + Number(p.late || 0), 0), [dprProjects]);

  const filteredProjects = useMemo(() => {
    const base = portfolioTab === "late" ? lateProjects : dprProjects;
    const q = search.trim().toLowerCase();
    const list = q
      ? base.filter((p) => {
          const nowText = (p.now || []).map((w: any) => w.name).join(" ").toLowerCase();
          return String(p.projectName || "").toLowerCase().includes(q) || nowText.includes(q) || String(p.next || "").toLowerCase().includes(q);
        })
      : base;
    const dir = projectSort.dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      switch (projectSort.key) {
        case "pct": return (pct(a.pct) - pct(b.pct)) * dir || naturalCompare(a.projectName, b.projectName);
        case "done": return (Number(a.done || 0) - Number(b.done || 0)) * dir || naturalCompare(a.projectName, b.projectName);
        case "late": return (Number(a.late || 0) - Number(b.late || 0)) * dir || naturalCompare(a.projectName, b.projectName);
        default: return naturalCompare(a.projectName, b.projectName) * dir;
      }
    });
  }, [portfolioTab, lateProjects, dprProjects, search, projectSort]);

  const filteredUnits = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = allUnits.filter((u) => {
      if (selectedUnitId && String(u.unitId) !== selectedUnitId) return false;
      if (unitFilter === "done" && pct(u.pct) < 100) return false;
      if (unitFilter === "active" && !(pct(u.pct) < 100 && (pct(u.pct) > 0 || Number(u.moving) > 0))) return false;
      if (unitFilter === "late" && !(Number(u.late || 0) > 0)) return false;
      if (!q) return true;
      const nowText = (u.now || []).map((w: any) => w.name).join(" ").toLowerCase();
      return String(u.unitName || "").toLowerCase().includes(q) || nowText.includes(q) || String(u.next || "").toLowerCase().includes(q);
    });
    const dir = unitSort.dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      switch (unitSort.key) {
        case "pct": return (pct(a.pct) - pct(b.pct)) * dir || naturalCompare(a.unitName, b.unitName);
        case "done": return (Number(a.done || 0) - Number(b.done || 0)) * dir || naturalCompare(a.unitName, b.unitName);
        case "late": return (Number(a.late || 0) - Number(b.late || 0)) * dir || naturalCompare(a.unitName, b.unitName);
        default: return naturalCompare(a.unitName, b.unitName) * dir;
      }
    });
  }, [allUnits, selectedUnitId, unitFilter, search, unitSort]);

  const filteredNotes = useMemo(() => {
    const list = selected ? projectNotes : allNotes;
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((n) =>
      String(n.ProjectName || "").toLowerCase().includes(q)
      || String(n.Stage || "").toLowerCase().includes(q)
      || String(n.Summary || "").toLowerCase().includes(q));
  }, [selected, projectNotes, allNotes, search]);

  const paginate = <T,>(items: T[]) => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  };

  const toggleSort = (setter: React.Dispatch<React.SetStateAction<CrmSort>>) => (key: string) => {
    setter((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
    setPage(1);
  };

  const projectCols: GridCol<any>[] = useMemo(() => [
    {
      id: "project",
      label: "Project",
      locked: true,
      sortKey: "name",
      csv: (p) => p.projectName,
      cell: (p) => (
        <span className="block py-1 min-w-0">
          <span className="block font-semibold text-foreground">{p.projectName}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {(p.towers?.length ?? 0) > 0 ? `${p.towers.length} block${p.towers.length === 1 ? "" : "s"} · ` : ""}
            {p.works?.length ?? 0} work stages
          </span>
        </span>
      ),
    },
    {
      id: "progress",
      label: "Stage progression",
      sortKey: "pct",
      csv: (p) => `${pct(p.pct)}%`,
      cell: (p) => (
        <span className="flex items-center gap-3 min-w-[11rem]">
          <span className="flex-1"><StageBar works={p.works} pctFallback={p.pct} /></span>
          <span className={cn("w-11 text-right text-xs font-semibold tabular-nums", pct(p.pct) >= 100 ? TONE_EMERALD_TEXT : "text-foreground")}>
            {pct(p.pct)}%
          </span>
        </span>
      ),
    },
    {
      id: "tasks",
      label: "Tasks",
      align: "right",
      sortKey: "done",
      csv: (p) => `${p.done ?? 0} of ${p.steps ?? 0}`,
      cell: (p) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{Number(p.done || 0).toLocaleString("en-IN")}</span> / {Number(p.steps || 0).toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      id: "now",
      label: "Active work",
      csv: (p) => (p.now?.length ? p.now.map((w: any) => `${w.name} ${w.pct}%`).join(", ") : p.allDone ? "All complete" : "—"),
      cell: (p) => (
        <span className="block max-w-[17rem] truncate text-xs text-foreground">
          {p.now?.length
            ? p.now.slice(0, 2).map((w: any) => `${w.name} (${w.pct}%)`).join(" · ")
            : <span className="text-muted-foreground">{p.allDone ? "All tasks completed" : "—"}</span>}
        </span>
      ),
    },
    {
      id: "next",
      label: "Next stage",
      csv: (p) => (p.allDone ? "Finished" : p.next || "—"),
      cell: (p) => <span className="block max-w-[13rem] truncate text-xs text-muted-foreground">{p.allDone ? "Finished" : (p.next || "—")}</span>,
    },
    {
      id: "status",
      label: "Schedule",
      sortKey: "late",
      csv: (p) => (Number(p.late || 0) > 0 ? `${p.late} behind` : p.allDone ? "Complete" : "On track"),
      cell: (p) => (Number(p.late || 0) > 0
        ? <GridToneMark text={`${p.late} behind`} tone="stopped" />
        : p.allDone
          ? <GridToneMark text="Complete" tone="done" />
          : <GridToneMark text="On track" tone="moving" />),
    },
    {
      id: "act",
      label: "Actions",
      locked: true,
      cell: (p) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setScope({ projectId: String(p.projectId), blockId: "", unitId: "" }); setProjectTab("overview"); setSearch(""); setPage(1); }}
          className={cn(GRID_KEY, "h-7 px-2.5")}
        >
          Inspect
        </button>
      ),
    },
  ], []); // eslint-disable-line react-hooks/exhaustive-deps

  const unitCols: GridCol<any>[] = useMemo(() => [
    {
      id: "unit",
      label: "Unit",
      locked: true,
      sortKey: "unit",
      csv: (u) => u.unitName,
      cell: (u) => <span className="font-semibold text-foreground tabular-nums">{u.unitName}</span>,
    },
    {
      id: "progress",
      label: "Progress",
      sortKey: "pct",
      csv: (u) => `${pct(u.pct)}%`,
      cell: (u) => (
        <span className="flex items-center gap-3 min-w-[10rem]">
          <ProgressBar value={u.pct} className="flex-1" />
          <span className={cn("w-11 text-right text-xs font-semibold tabular-nums", pct(u.pct) >= 100 ? TONE_EMERALD_TEXT : "text-foreground")}>
            {pct(u.pct)}%
          </span>
        </span>
      ),
    },
    {
      id: "tasks",
      label: "Tasks",
      align: "right",
      sortKey: "done",
      csv: (u) => `${u.done ?? 0} of ${u.steps ?? 0}`,
      cell: (u) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{u.done ?? 0}</span> / {u.steps ?? 0}
        </span>
      ),
    },
    {
      id: "status",
      label: "Schedule",
      sortKey: "late",
      csv: (u) => (Number(u.late || 0) > 0 ? `${u.late} behind` : pct(u.pct) >= 100 ? "Complete" : "On track"),
      cell: (u) => (Number(u.late || 0) > 0
        ? <GridToneMark text={`${u.late} behind`} tone="stopped" />
        : pct(u.pct) >= 100
          ? <GridToneMark text="Complete" tone="done" />
          : <GridToneMark text="On track" tone="moving" />),
    },
    {
      id: "work",
      label: "Current / Next work",
      csv: (u) => (u.now?.length ? u.now.map((w: any) => `${w.name} ${w.pct}%`).join(", ") : u.next ? `Next: ${u.next}` : "No active work"),
      cell: (u) => (
        <span className="block max-w-[20rem] truncate text-xs text-muted-foreground">
          {u.now?.length
            ? u.now.map((w: any) => `${w.name} (${w.pct}%)`).join(" · ")
            : u.next
              ? `Next: ${u.next}`
              : "No active work recorded"}
        </span>
      ),
    },
  ], []);

  const noteCols: GridCol<any>[] = useMemo(() => [
    {
      id: "date",
      label: "Date",
      locked: true,
      csv: (n) => fmtDate(n.UpdateDate),
      cell: (n) => <span className="font-medium text-foreground tabular-nums whitespace-nowrap">{fmtDate(n.UpdateDate)}</span>,
    },
    ...(!selected ? [{
      id: "project",
      label: "Project",
      csv: (n: any) => n.ProjectName || "—",
      cell: (n: any) => <span className="font-medium text-foreground">{n.ProjectName || "—"}</span>,
    }] : []),
    {
      id: "pct",
      label: "Completion",
      csv: (n) => (n.PercentComplete != null ? `${pct(n.PercentComplete)}%` : "—"),
      cell: (n) => (n.PercentComplete != null
        ? <GridToneMark text={`${pct(n.PercentComplete)}% complete`} tone={pct(n.PercentComplete) >= 100 ? "done" : "moving"} />
        : <span className="text-muted-foreground">—</span>),
    },
    {
      id: "stage",
      label: "Stage",
      csv: (n) => n.Stage || "—",
      cell: (n) => <span className="text-xs text-muted-foreground">{n.Stage || "—"}</span>,
    },
    {
      id: "summary",
      label: "Summary for buyers",
      csv: (n) => n.Summary,
      cell: (n) => <p className="max-w-[34rem] text-xs text-foreground whitespace-pre-line leading-relaxed">{n.Summary}</p>,
    },
    {
      id: "by",
      label: "Posted by",
      csv: (n) => n.CreatedByName || "—",
      cell: (n) => <span className="text-xs text-muted-foreground">{n.CreatedByName || "—"}</span>,
    },
  ], [selected]);

  const [projectPrefs, setProjectPrefs] = useGridPrefs(PROJECT_PREFS_KEY, projectCols);
  const [unitPrefs, setUnitPrefs] = useGridPrefs(UNIT_PREFS_KEY, unitCols);
  const [simplePrefs, setSimplePrefs] = useState<{ hidden: string[]; order: string[]; widths: Record<string, number> }>({
    hidden: [], order: [], widths: {},
  });

  const noteTargetProject = allProjects.find((p) => String(p.projectId) === noteForm.projectId);
  const busy = projectsQ.isFetching || detailQ.isFetching || notesQ.isFetching;
  const heroPct = selected ? completion : portfolioPct;
  const heroSteps = selected ? scopeSteps : totalSteps;
  const heroDone = selected ? scopeDone : totalDone;
  const heroMoving = selected ? scopeMoving : totalMoving;
  const heroLate = selected ? scopeLate : totalLate;
  const latestFeedAt = detail?.feed?.[0]?.at;

  const handleExport = () => {
    if (!selected) {
      if (portfolioTab === "updates") exportGrid(filteredNotes, noteCols, "buyer-construction-updates");
      else exportGrid(filteredProjects, projectCols, `construction-progress-${portfolioTab}`);
      return;
    }
    const slug = (selected.projectName || "project").toLowerCase().replace(/\s+/g, "-");
    if (projectTab === "units") exportGrid(filteredUnits, unitCols, `${slug}-units`);
    else if (projectTab === "updates") exportGrid(filteredNotes, noteCols, `${slug}-buyer-updates`);
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Construction Updates"]} />
      <div className="space-y-4">
        {/* 1. Header Card (same clean pattern as Bookings & Applications) */}
        <section className="rounded-xl border border-border bg-card px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              CRM · {selected ? `${focusType} Progress` : "After-Sales"}
            </p>
            <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-foreground truncate">
              {selected ? focusName : "Construction Updates"}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {selected
                ? [selectedBlockName ? selected.projectName : null, `${activeWorks.length} DPR stages`, `${allUnits.length} tracked units`, latestFeedAt ? `Updated ${ago(latestFeedAt).toLowerCase()}` : null].filter(Boolean).join(" · ")
                : "Live site progression from Daily Progress Reports (DPR), paired with buyer-facing updates."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {selected && (
              <button
                type="button"
                onClick={() => { setScope({ projectId: "", blockId: "", unitId: "" }); setSearch(""); setUnitFilter("all"); setPage(1); }}
                className={GRID_BTN}
              >
                <ArrowLeft size={13} /> All projects
              </button>
            )}
            <button
              type="button"
              onClick={() => printHostRef.current && printLegalSheet(printHostRef.current)}
              disabled={!allProjects.length}
              className={GRID_BTN}
              title="Print / Save PDF report"
            >
              <Printer size={13} /> <span className="hidden sm:inline">Print</span>
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={busy}
              className={cn(GRID_BTN, "w-9 !px-0")}
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
            </button>
            {rights.canCreate && allProjects.length > 0 && (
              <button type="button" onClick={() => openNoteDialog(selected?.projectId)} className={cn(GRID_KEY_BRAND, "h-9 px-3")}>
                <Plus size={13} /> Post buyer update
              </button>
            )}
            <span aria-live="polite" aria-atomic="true" className="ml-1 text-xs text-muted-foreground tabular-nums">
              {projectsQ.isLoading
                ? "Loading…"
                : `${heroPct}% complete · ${heroDone.toLocaleString("en-IN")} / ${heroSteps.toLocaleString("en-IN")} tasks`}
            </span>
          </div>
        </section>

        {/* 2. Purpose-Built Scope Bar + Live Telemetry Strip */}
        {!projectsQ.isLoading && allProjects.length > 0 && (
          <section className={cn(GRID_CARD, "rounded-xl overflow-hidden")} aria-label="Scope and completion telemetry">
            {/* Hierarchy Drill-Down Bar */}
            <div className="px-5 py-3 border-b border-border bg-muted/15 flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3 min-w-0">
                <ProgressPicker
                  id="construction-project"
                  label="Project"
                  className="w-64"
                  value={selected ? String(selected.projectId) : ""}
                  onChange={(value) => {
                    setScope({ projectId: value, blockId: "", unitId: "" });
                    setProjectTab("overview");
                    setUnitFilter("all");
                    setSearch("");
                    setPage(1);
                  }}
                  options={[
                    { value: "", label: "All projects (portfolio)" },
                    ...allProjects.map((p) => ({ value: String(p.projectId), label: p.projectName, pct: p.hasDpr ? p.pct : null })),
                  ]}
                />

                {selected && (
                  <ProgressPicker
                    id="construction-block"
                    label="Block / Tower"
                    className="w-52"
                    value={selectedBlockId}
                    onChange={(value) => { setScope({ blockId: value, unitId: "" }); setPage(1); }}
                    options={[
                      { value: "", label: "All blocks", pct: selected.pct },
                      ...(projectTowers ?? []).map((t: any) => ({ value: String(t.blockId), label: t.blockName || `Block ${t.blockId}`, pct: t.pct })),
                    ]}
                  />
                )}

                {selected && selectedBlockId && (baseDetailQ.data?.units?.length ?? 0) > 0 && (
                  <ProgressPicker
                    id="construction-unit"
                    label="Unit"
                    className="w-48"
                    value={selectedUnitId}
                    onChange={(value) => { setScope({ unitId: value }); setPage(1); }}
                    options={[
                      { value: "", label: "All units", pct: baseDetailQ.data?.pct ?? 0 },
                      ...(baseDetailQ.data?.units ?? []).map((u: any) => ({ value: String(u.unitId), label: u.unitName, pct: u.pct })),
                    ]}
                  />
                )}
              </div>

              <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
                {selected && latestFeedAt
                  ? `Latest site log: ${ago(latestFeedAt)} (${fmtDateTime(latestFeedAt)})`
                  : "Auto-synced from DPR every 2 min"}
              </span>
            </div>

            {/* 4-Column Engineering Metrics + Segmented Build Bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-border border-b border-border">
              <div className="px-5 py-3 min-w-0">
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
                  {selected ? `${focusType} completion` : "Portfolio completion"}
                </p>
                <p className={cn("mt-0.5 text-lg font-bold tabular-nums", heroPct >= 100 ? TONE_EMERALD_TEXT : "text-foreground")}>
                  {heroPct}%
                </p>
                <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
                  {selected ? `${activeWorks.length} site stages` : `${dprProjects.length} active DPR project${dprProjects.length === 1 ? "" : "s"}`}
                </p>
              </div>

              <div className="px-5 py-3 min-w-0">
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Tasks completed</p>
                <p className={cn("mt-0.5 text-lg font-bold tabular-nums", TONE_EMERALD_TEXT)}>
                  {heroDone.toLocaleString("en-IN")}
                </p>
                <p className="text-[0.6875rem] text-muted-foreground tabular-nums">
                  of {heroSteps.toLocaleString("en-IN")} scheduled tasks
                </p>
              </div>

              <div className="px-5 py-3 min-w-0">
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">In progress</p>
                <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
                  {heroMoving.toLocaleString("en-IN")}
                </p>
                <p className="text-[0.6875rem] text-muted-foreground">
                  Active site activities
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (heroLate <= 0) return;
                  if (!selected) { setPortfolioTab("late"); setPage(1); }
                  else { setProjectTab("units"); setUnitFilter("late"); setPage(1); }
                }}
                disabled={heroLate <= 0}
                className={cn("px-5 py-3 text-left min-w-0 transition", heroLate > 0 && "hover:bg-muted/35 cursor-pointer")}
              >
                <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">Behind schedule</p>
                <p className={cn("mt-0.5 text-lg font-bold tabular-nums", heroLate > 0 ? TONE_ROSE_TEXT : TONE_EMERALD_TEXT)}>
                  {heroLate.toLocaleString("en-IN")}
                </p>
                <p className="text-[0.6875rem] text-muted-foreground">
                  {heroLate > 0 ? "Click to inspect delayed scope" : "All tasks on schedule"}
                </p>
              </button>
            </div>

            <div className="px-5 py-2.5 space-y-1.5 bg-muted/10">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  {selected
                    ? detail?.allDone
                      ? "All scheduled construction activities in this scope are finished."
                      : detail?.now?.length
                        ? `Active now: ${detail.now.slice(0, 3).map((w: any) => `${w.name} (${w.pct}%)`).join(" · ")}${detail?.next ? ` · Next: ${detail.next}` : ""}`
                        : detail?.next
                          ? `Next stage: ${detail.next}`
                          : "Awaiting DPR site activity progress"
                    : `${allNotes.length} buyer-visible update${allNotes.length === 1 ? "" : "s"} published across projects`}
                </span>
                <span className="font-semibold tabular-nums text-foreground">{heroPct}%</span>
              </div>
              {selected ? <StageBar works={activeWorks} pctFallback={completion} /> : <ProgressBar value={portfolioPct} size="md" />}
            </div>
          </section>
        )}

        {(projectsQ.isError || (selected && detailQ.isError)) && (
          <GridGuidance
            tone="stopped"
            title="Could not load construction progress"
            text={((projectsQ.error || detailQ.error) as Error).message}
          />
        )}

        {/* 3. Main Workbench Card */}
        {!selected ? (
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<PortfolioTab>
              label="Portfolio views"
              active={portfolioTab}
              onChange={(t) => { setPortfolioTab(t); setPage(1); }}
              tabs={[
                { key: "projects", label: "Projects", count: dprProjects.length },
                { key: "late", label: "Behind schedule", count: lateProjects.length },
                { key: "updates", label: "Buyer updates", count: allNotes.length },
              ]}
            />
            <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
              <GridSearch
                value={search}
                onChange={(v) => { setSearch(v); setPage(1); }}
                placeholder={portfolioTab === "updates" ? "Search project, stage, or summary…" : "Search project or active work…"}
              />
              {search.trim() && <button type="button" onClick={() => { setSearch(""); setPage(1); }} className={GRID_BTN}>Clear</button>}
              <div className="ml-auto flex items-center gap-2">
                {portfolioTab !== "updates" && <GridColumnChooser cols={projectCols} prefs={projectPrefs} onChange={setProjectPrefs} />}
                {allProjects.length > 0 && (
                  <button type="button" onClick={handleExport} className={GRID_BTN} title="Export to Excel">
                    <Download size={13} /> <span className="hidden md:inline">Export</span>
                  </button>
                )}
              </div>
            </div>

            {portfolioTab === "updates" ? (
              <CrmGrid
                cols={noteCols}
                prefs={simplePrefs}
                onPrefs={setSimplePrefs}
                rows={paginate(filteredNotes)}
                rowKey={(n) => n.Id}
                noRowNumbers
                loading={notesQ.isLoading}
                fetching={notesQ.isFetching}
                sort={simpleSort}
                onSort={toggleSort(setSimpleSort)}
                empty="No buyer-facing construction updates have been posted yet."
                page={page}
                pageSize={pageSize}
                total={filteredNotes.length}
                onPage={setPage}
                onPageSize={(n) => { setPageSize(n); setPage(1); }}
              />
            ) : (
              <CrmGrid
                cols={projectCols}
                prefs={projectPrefs}
                onPrefs={setProjectPrefs}
                rows={paginate(filteredProjects)}
                rowKey={(p) => p.projectId}
                noRowNumbers
                loading={projectsQ.isLoading}
                fetching={projectsQ.isFetching}
                error={projectsQ.isError ? translateError((projectsQ.error as Error).message) : null}
                onRetry={refresh}
                sort={projectSort}
                onSort={toggleSort(setProjectSort)}
                onRowClick={(p) => { setScope({ projectId: String(p.projectId), blockId: "", unitId: "" }); setProjectTab("overview"); setSearch(""); setPage(1); }}
                empty={portfolioTab === "late" ? "No projects have tasks behind schedule." : "No construction progress recorded yet."}
                page={page}
                pageSize={pageSize}
                total={filteredProjects.length}
                onPage={setPage}
                onPageSize={(n) => { setPageSize(n); setPage(1); }}
              />
            )}
          </div>
        ) : (
          <div className={cn(GRID_CARD, "rounded-xl overflow-hidden")}>
            <GridTabs<ProjectTab>
              label="Project progression views"
              active={projectTab}
              onChange={(t) => { setProjectTab(t); setPage(1); }}
              tabs={[
                { key: "overview", label: "Stages, blocks & activity", count: activeWorks.length },
                { key: "units", label: "Unit breakdown", count: allUnits.length },
                { key: "updates", label: "Buyer progress log", count: projectNotes.length },
              ]}
              end={
                projectTab === "units" && allUnits.length > 0 ? (
                  <button type="button" onClick={handleExport} className={cn(GRID_BTN, "!h-8 px-2.5 text-xs")}>
                    <Download size={12} /> Export CSV
                  </button>
                ) : projectTab === "updates" && rights.canCreate ? (
                  <button type="button" onClick={() => openNoteDialog(selected.projectId)} className={cn(GRID_BTN_BRAND, "!h-8 px-2.5 text-xs")}>
                    <Megaphone size={12} /> Post update
                  </button>
                ) : undefined
              }
            />

            {projectTab === "overview" && (
              detailQ.isLoading ? (
                <div className="p-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                  <RefreshCw size={14} className="animate-spin" /> Loading project progression…
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-[1.35fr_0.95fr] divide-y xl:divide-y-0 xl:divide-x divide-border">
                  {/* Left: Ordered Construction Stages */}
                  <div className="p-5 space-y-3 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        <ListChecks size={14} /> Build stages (site sequence)
                      </h2>
                      <span className="text-xs text-muted-foreground tabular-nums">{activeWorks.length} stages</span>
                    </div>
                    <div className="rounded-lg border border-border divide-y divide-border/70">
                      {activeWorks.map((work: any, index: number) => {
                        const wPct = pct(work.pct);
                        const finished = wPct >= 100;
                        const active = !finished && ((detail?.now ?? selected.now ?? []).some((c: any) => c.name === work.name) || Number(work.moving) > 0);
                        return (
                          <div key={work.groupId ?? work.name} className="grid grid-cols-[2rem_minmax(8rem,1fr)_minmax(6rem,0.85fr)_3.25rem] items-center gap-3 px-3.5 py-2.5">
                            <span
                              className={cn(
                                "grid h-7 w-7 place-items-center rounded-md border text-xs font-semibold",
                                finished
                                  ? cn("border-emerald-500/30 bg-emerald-500/10", TONE_EMERALD_TEXT)
                                  : active
                                    ? "border-primary/25 bg-primary/10 text-primary"
                                    : "border-border bg-muted/40 text-muted-foreground",
                              )}
                            >
                              {finished ? <Check size={14} /> : String(index + 1).padStart(2, "0")}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{work.name}</div>
                              <div className="mt-0.5 flex items-center gap-2 text-[0.6875rem] text-muted-foreground tabular-nums">
                                <span className={finished ? TONE_EMERALD_TEXT : active ? TONE_AMBER_TEXT : undefined}>
                                  {finished ? "Complete" : active ? "In progress" : "Upcoming"}
                                </span>
                                <span>·</span>
                                <span>{work.done} / {work.steps} tasks</span>
                              </div>
                            </div>
                            <ProgressBar value={work.pct} />
                            <span className={cn("text-right text-xs font-semibold tabular-nums", finished ? TONE_EMERALD_TEXT : "text-foreground")}>{wPct}%</span>
                          </div>
                        );
                      })}
                      {!activeWorks.length && (
                        <p className="px-4 py-8 text-center text-xs text-muted-foreground">No DPR work stages recorded in this scope.</p>
                      )}
                    </div>
                  </div>

                  {/* Right: Blocks / Towers + Recent Site Activity */}
                  <div className="divide-y divide-border bg-muted/10 min-w-0">
                    <div className="p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Building2 size={14} /> {selectedUnitId ? "Selected block" : "Blocks & towers"}
                        </h2>
                        {selectedBlockId && (
                          <button type="button" onClick={() => setScope({ blockId: "", unitId: "" })} className="text-xs text-primary font-medium hover:underline">
                            Show all blocks
                          </button>
                        )}
                      </div>
                      <div className="space-y-2">
                        {visibleTowers.length ? visibleTowers.map((tower: any) => {
                          const isFocused = String(tower.blockId) === selectedBlockId;
                          const bPct = pct(tower.pct);
                          return (
                            <button
                              key={tower.blockId ?? tower.blockName}
                              type="button"
                              onClick={() => {
                                if (tower.blockId != null) {
                                  setScope({ blockId: isFocused ? "" : String(tower.blockId), unitId: "" });
                                  setPage(1);
                                }
                              }}
                              className={cn(
                                "w-full text-left rounded-lg border px-3.5 py-2.5 transition hover:bg-muted/40",
                                isFocused ? "border-primary/40 bg-primary/5" : "border-border bg-card",
                              )}
                            >
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className="truncate text-sm font-semibold text-foreground">{tower.blockName || "Unassigned block"}</span>
                                <span className={cn("text-xs font-bold tabular-nums", bPct >= 100 ? TONE_EMERALD_TEXT : "text-foreground")}>{bPct}%</span>
                              </div>
                              <ProgressBar value={tower.pct} />
                              <div className="mt-1.5 flex items-center justify-between text-[0.6875rem] text-muted-foreground tabular-nums">
                                <span>{tower.done ?? 0} of {tower.steps ?? 0} tasks</span>
                                {(tower.late || 0) > 0 && (
                                  <span className={cn("font-semibold inline-flex items-center gap-1", TONE_ROSE_TEXT)}>
                                    <AlertTriangle size={11} /> {tower.late} behind
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        }) : (
                          <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
                            Block-level progression is not recorded in DPR.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Clock size={14} /> Recent site activity
                        </h2>
                        <span className="text-xs text-muted-foreground tabular-nums">{feedRows.length} entries</span>
                      </div>
                      {feedRows.length ? (
                        <div className="rounded-lg border border-border bg-card divide-y divide-border/70">
                          {feedRows.slice(0, 8).map((event: any, index: number) => (
                            <div key={`${event.at}-${event.activity}-${index}`} className="flex items-start gap-2.5 px-3.5 py-2.5">
                              <span
                                className={cn(
                                  "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                                  event.completed ? "bg-emerald-400 [[data-theme]_&]:bg-emerald-500" : "bg-primary",
                                )}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                  <span className="text-xs font-medium text-foreground truncate">{event.activity}</span>
                                  <time dateTime={event.at ? String(event.at) : undefined} title={fmtDateTime(event.at)} className="text-[0.6875rem] text-muted-foreground tabular-nums shrink-0">
                                    {ago(event.at)}
                                  </time>
                                </div>
                                <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
                                  {[event.tower, event.unit, event.room, event.work].filter(Boolean).join(" · ")}
                                </p>
                              </div>
                              <span
                                className={cn(
                                  "shrink-0 self-center rounded border px-1.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums",
                                  event.completed
                                    ? cn("border-emerald-500/30 bg-emerald-500/10", TONE_EMERALD_TEXT)
                                    : "border-border bg-muted/40 text-foreground",
                                )}
                              >
                                {event.completed ? "Done" : event.from != null ? `${event.from}% → ${event.to}%` : `${event.to}%`}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="rounded-lg border border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
                          No recent DPR progression updates in the last 14 days.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            )}

            {projectTab === "units" && (
              <div>
                <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
                  <GridSearch
                    value={search}
                    onChange={(v) => { setSearch(v); setPage(1); }}
                    placeholder="Search unit or active work…"
                  />
                  <GridSegment<UnitFilter>
                    label="Filter units"
                    value={unitFilter}
                    onChange={(f) => { setUnitFilter(f); setPage(1); }}
                    options={[
                      { key: "all", label: "All", count: allUnits.length },
                      { key: "active", label: "In progress" },
                      { key: "done", label: "Complete" },
                      { key: "late", label: "Behind" },
                    ]}
                  />
                  {(search.trim() || selectedUnitId || unitFilter !== "all") && (
                    <button
                      type="button"
                      onClick={() => { setSearch(""); setUnitFilter("all"); setScope({ unitId: "" }); setPage(1); }}
                      className={GRID_BTN}
                    >
                      Clear filters
                    </button>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <GridColumnChooser cols={unitCols} prefs={unitPrefs} onChange={setUnitPrefs} />
                  </div>
                </div>
                <CrmGrid
                  cols={unitCols}
                  prefs={unitPrefs}
                  onPrefs={setUnitPrefs}
                  rows={paginate(filteredUnits)}
                  rowKey={(u) => u.unitId}
                  noRowNumbers
                  loading={detailQ.isLoading}
                  fetching={detailQ.isFetching}
                  sort={unitSort}
                  onSort={toggleSort(setUnitSort)}
                  onRowClick={(u) => {
                    setScope({
                      blockId: u.blockId != null ? String(u.blockId) : selectedBlockId,
                      unitId: String(u.unitId),
                    });
                    setProjectTab("overview");
                    setPage(1);
                  }}
                  activeKey={selectedUnitId ? Number(selectedUnitId) : null}
                  empty={allUnits.length ? "No units match these filters." : "Unit-level progression is not recorded in DPR."}
                  page={page}
                  pageSize={pageSize}
                  total={filteredUnits.length}
                  onPage={setPage}
                  onPageSize={(n) => { setPageSize(n); setPage(1); }}
                />
              </div>
            )}

            {projectTab === "updates" && (
              <div>
                <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-b border-border">
                  <GridSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search stage or update summary…" />
                  {search.trim() && <button type="button" onClick={() => { setSearch(""); setPage(1); }} className={GRID_BTN}>Clear</button>}
                </div>
                <CrmGrid
                  cols={noteCols}
                  prefs={simplePrefs}
                  onPrefs={setSimplePrefs}
                  rows={paginate(filteredNotes)}
                  rowKey={(n) => n.Id}
                  noRowNumbers
                  loading={notesQ.isLoading}
                  fetching={notesQ.isFetching}
                  sort={simpleSort}
                  onSort={toggleSort(setSimpleSort)}
                  empty="No buyer-facing updates published for this project yet."
                  page={page}
                  pageSize={pageSize}
                  total={filteredNotes.length}
                  onPage={setPage}
                  onPageSize={(n) => { setPageSize(n); setPage(1); }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Monochrome Printable A4 Construction Briefing */}
      <div className="hidden" ref={printHostRef} aria-hidden>
        <article className="legal-print space-y-5">
          <header style={{ borderBottom: "2px solid #0f172a", paddingBottom: "10px", marginBottom: "14px" }}>
            <div style={{ fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#555" }}>
              CivilierERP · Construction Engineering Briefing
            </div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "4px 0 2px" }}>
              {selected ? `${focusName} (${focusType} Progress)` : "Portfolio Construction Progress"}
            </h1>
            <div style={{ fontSize: "10px", color: "#555" }}>
              Generated {fmtDateTime(new Date())} · Data source: Live Daily Progress Reports (DPR)
            </div>
          </header>

          <dl className="grid grid-cols-4 gap-4" style={{ marginBottom: "16px" }}>
            <div><dt>Completion</dt><dd><b>{heroPct}%</b></dd></div>
            <div><dt>Scheduled Tasks</dt><dd>{heroSteps.toLocaleString("en-IN")}</dd></div>
            <div><dt>Completed Tasks</dt><dd>{heroDone.toLocaleString("en-IN")}</dd></div>
            <div><dt>Behind Schedule</dt><dd>{heroLate.toLocaleString("en-IN")}</dd></div>
          </dl>

          {selected ? (
            <section>
              <h3>Work Stages</h3>
              <table>
                <thead>
                  <tr><th>#</th><th>Work Stage</th><th style={{ textAlign: "right" }}>Tasks</th><th style={{ textAlign: "right" }}>Completion</th></tr>
                </thead>
                <tbody>
                  {activeWorks.map((w, i) => (
                    <tr key={w.groupId ?? w.name}>
                      <td>{String(i + 1).padStart(2, "0")}</td>
                      <td>{w.name}</td>
                      <td style={{ textAlign: "right" }}>{w.done} / {w.steps}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{pct(w.pct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <section>
              <h3>Projects</h3>
              <table>
                <thead>
                  <tr><th>Project</th><th>Current Work</th><th>Next Stage</th><th style={{ textAlign: "right" }}>Tasks</th><th style={{ textAlign: "right" }}>Behind</th><th style={{ textAlign: "right" }}>Completion</th></tr>
                </thead>
                <tbody>
                  {dprProjects.map((p) => (
                    <tr key={p.projectId}>
                      <td style={{ fontWeight: 600 }}>{p.projectName}</td>
                      <td>{p.now?.length ? p.now.slice(0, 2).map((w: any) => `${w.name} (${w.pct}%)`).join(", ") : (p.allDone ? "Complete" : "—")}</td>
                      <td>{p.allDone ? "Finished" : (p.next || "—")}</td>
                      <td style={{ textAlign: "right" }}>{p.done} / {p.steps}</td>
                      <td style={{ textAlign: "right" }}>{p.late || 0}</td>
                      <td style={{ textAlign: "right", fontWeight: 600 }}>{pct(p.pct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </article>
      </div>

      {/* Publish Buyer-Visible Update Modal */}
      {noteDialogOpen && (
        <GridDialog
          open
          onClose={() => { if (!savingNote) setNoteDialogOpen(false); }}
          icon={Megaphone}
          width="max-w-lg"
          title="Post buyer construction update"
          description="Published notes appear alongside live construction progress in the customer portal."
          footer={
            <>
              <button type="button" onClick={() => setNoteDialogOpen(false)} disabled={savingNote} className={GRID_BTN}>Cancel</button>
              <button type="button" onClick={submitNote} disabled={savingNote || !noteForm.projectId || !noteForm.summary.trim()} className={GRID_BTN_BRAND}>
                <Megaphone size={13} /> {savingNote ? "Publishing…" : "Publish update"}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={cn("block mb-1.5", LBL)}>Project *</label>
                <select
                  value={noteForm.projectId}
                  onChange={(e) => setNoteForm((f) => ({ ...f, projectId: e.target.value }))}
                  className={cn(GRID_INPUT, "w-full")}
                >
                  <option value="">Select project</option>
                  {allProjects.map((p) => (
                    <option key={p.projectId} value={String(p.projectId)}>{p.projectName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={cn("block mb-1.5", LBL)}>Update date</label>
                <DateInput
                  value={noteForm.updateDate}
                  onChange={(e) => setNoteForm((f) => ({ ...f, updateDate: e.target.value }))}
                  className={INP}
                />
              </div>
            </div>

            {noteTargetProject?.hasDpr ? (
              <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/25 px-3.5 py-2.5 text-xs">
                <Layers size={14} className="shrink-0 mt-0.5 text-primary" />
                <p className="text-muted-foreground leading-relaxed">
                  Live DPR completion (<b className="text-foreground tabular-nums">{pct(noteTargetProject.pct)}%</b>
                  {noteTargetProject.now?.[0]?.name ? ` · ${noteTargetProject.now[0].name}` : ""}) will be stamped automatically when saved.
                </p>
              </div>
            ) : noteTargetProject ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={cn("block mb-1.5", LBL)}>Percent complete</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    placeholder="0 – 100"
                    value={noteForm.percent}
                    onChange={(e) => setNoteForm((f) => ({ ...f, percent: e.target.value }))}
                    className={cn(INP, "tabular-nums")}
                  />
                </div>
                <div>
                  <label className={cn("block mb-1.5", LBL)}>Current stage</label>
                  <input
                    placeholder="e.g. Superstructure Slab 4"
                    value={noteForm.stage}
                    onChange={(e) => setNoteForm((f) => ({ ...f, stage: e.target.value }))}
                    className={INP}
                  />
                </div>
              </div>
            ) : null}

            <div>
              <label className={cn("block mb-1.5", LBL)}>Summary for buyers *</label>
              <textarea
                rows={4}
                placeholder="Share milestone highlights, site readiness, or completion forecasts for buyers…"
                value={noteForm.summary}
                onChange={(e) => setNoteForm((f) => ({ ...f, summary: e.target.value }))}
                className={TEXTAREA}
                autoFocus
              />
            </div>
          </div>
        </GridDialog>
      )}
    </>
  );
};

export default CrmConstructionUpdates;
