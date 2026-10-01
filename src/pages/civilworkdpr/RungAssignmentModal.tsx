import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, UserRound, CalendarDays, Package, Loader2, HardHat, FileText, MessageSquare, ChevronDown, ListChecks, Check, Timer, ShieldCheck, Plus, Trash2, Users } from "lucide-react";
import type { LadderActivity, DependencyMasterListRow } from "@/api/dependencyMasterApi";
import {
  getEngineers,
  getProjectContractors,
  getRungAssignment,
  saveRungAssignment,
  getBlueprintAnnotation,
  SOURCE_META,
  type AssignmentMaterial,
  type AssignmentCheckpoint,
  type SourceType,
  type Engineer,
  type ApprovalLevel,
} from "@/api/dependencyActivityAssignmentApi";
import { getRoomBlueprint } from "@/api/roomMasterApi";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import BlueprintAnnotationEditor from "./BlueprintAnnotationEditor";
import { DateInput } from "@/components/ui/date-input";

const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

// Native <select multiple> renders as a raw OS listbox no amount of CSS can
// soften — this pairs a styled trigger with a checkbox list in a Radix
// popover instead, matching the rest of the app's input styling. Shared by
// the Engineers dropdown, the QC dropdown, and each Approval Level's own
// picker below — same look everywhere a "pick some people" control appears
// in this modal.
function UserMultiSelect({
  users, selected, onChange, placeholder = "Select…", noneLabel = "No one available.",
}: {
  users: Engineer[]; selected: number[]; onChange: (ids: number[]) => void; placeholder?: string; noneLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? users.find((e) => e.id === selected[0])?.name || "1 selected"
        : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={`${inputCls} flex items-center justify-between gap-2 text-left`}>
          <span className={selected.length ? "text-foreground" : "text-muted-foreground"}>{label}</span>
          <ChevronDown size={14} className={`text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-h-72 overflow-y-auto p-1.5"
      >
        {users.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-2 py-1.5">{noneLabel}</p>
        ) : (
          users.map((u) => (
            <label
              key={u.id}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-foreground hover:bg-muted cursor-pointer transition-colors"
            >
              <Checkbox checked={selected.includes(u.id)} onCheckedChange={() => toggle(u.id)} />
              {u.name}
            </label>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

let levelKeySeq = 0;
const newLevel = (index: number): ApprovalLevel => ({
  id: `level-${Date.now()}-${++levelKeySeq}`,
  label: `Level ${index + 1}`,
  userIds: [],
  mode: "all",
});

// Mini Approval Setup, scoped to just THIS activity assignment — not a
// module-wide workflow like the admin Approval Setup page. Add one level per
// approver for a strict one-by-one sequence; on the LAST level, pick more
// than one person and switch its mode to "any one of them" for a
// "one-by-one, then either" chain. Whoever ends up named here (plus
// super_admin, always) gets the right to approve this activity's finished
// work — enforced where that approval action itself lives (Work Reporting).
function ApprovalLevelsEditor({
  levels, onChange, users,
}: {
  levels: ApprovalLevel[]; onChange: (levels: ApprovalLevel[]) => void; users: Engineer[];
}) {
  const updateLevel = (id: string, patch: Partial<ApprovalLevel>) =>
    onChange(levels.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLevel = (id: string) => onChange(levels.filter((l) => l.id !== id));
  const addLevel = () => onChange([...levels, newLevel(levels.length)]);

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between">
        <label className={`${labelCls} mb-0`}>
          <ShieldCheck size={11} /> Approval Setup
        </label>
        <button
          type="button"
          onClick={addLevel}
          className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300 transition-colors"
        >
          <Plus size={11} /> Add Approver Level
        </button>
      </div>

      {levels.length === 0 ? (
        <p className="text-[0.6875rem] text-muted-foreground italic">
          No approvers set — only super_admin can approve this activity's work. Add a level to name who else can.
        </p>
      ) : (
        <div className="space-y-2">
          {levels.map((level, i) => {
            const isLast = i === levels.length - 1;
            return (
              <div key={level.id} className="flex items-center gap-2">
                <span className="shrink-0 w-16 text-[0.625rem] font-heading font-bold uppercase tracking-wide text-muted-foreground">
                  {isLast ? "Final" : `Step ${i + 1}`}
                </span>
                <div className="flex-1">
                  <UserMultiSelect
                    users={users}
                    selected={level.userIds}
                    onChange={(ids) => updateLevel(level.id, { userIds: ids })}
                    placeholder="Select approver(s)…"
                  />
                </div>
                {level.userIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => updateLevel(level.id, { mode: level.mode === "any" ? "all" : "any" })}
                    title={level.mode === "any" ? "Any one of them can approve — click to require all" : "All must approve — click to allow any one of them"}
                    className={`shrink-0 inline-flex items-center gap-1 text-[0.625rem] font-heading font-bold uppercase tracking-wide px-2 py-1 rounded-full transition-colors ${
                      level.mode === "any"
                        ? "bg-[#ffe2021a] text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <Users size={10} /> {level.mode === "any" ? "Any one" : "All"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeLevel(level.id)}
                  className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Remove level"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
          <p className="text-[0.625rem] text-muted-foreground/70 pt-0.5">
            Steps approve one after another. If the final step has more than one person, toggle "Any one" so just one of them clears it.
          </p>
        </div>
      )}
    </div>
  );
}

// Shows the room's blueprint (annotated thumbnail if this rung already has
// markup on it, the raw blueprint otherwise) and opens the Konva editor on
// click. Two activities in the same chain can mark up the same room's
// blueprint independently — see migration 345.
function BlueprintPreviewSection({ roomId, rungId, roomLabel }: { roomId: number; rungId: number; roomLabel: string }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const { data: blueprint, isLoading: blueprintLoading } = useQuery({
    queryKey: ["room-blueprint", roomId],
    queryFn: () => getRoomBlueprint(roomId),
  });
  const { data: annotation } = useQuery({
    queryKey: ["blueprint-annotation", rungId, roomId, "allocation"],
    queryFn: () => getBlueprintAnnotation(rungId, roomId, "allocation"),
  });

  const thumbnailSrc = annotation?.thumbnailBase64
    ? `data:image/png;base64,${annotation.thumbnailBase64}`
    : blueprint && blueprint.mimeType !== "application/pdf"
      ? `data:${blueprint.mimeType};base64,${blueprint.dataBase64}`
      : null;

  return (
    <div>
      <label className={labelCls}>
        <FileText size={11} /> Reference Blueprint
      </label>
      {blueprintLoading ? (
        <div className="rounded-lg border border-border bg-muted/30 h-24 flex items-center justify-center">
          <Loader2 size={16} className="animate-spin text-muted-foreground" />
        </div>
      ) : !blueprint ? (
        <p className="text-xs text-muted-foreground italic py-1.5">
          No blueprint uploaded for this room yet — upload one from Setup &gt; Flat Master.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="relative w-full max-w-[240px] rounded-lg border border-border overflow-hidden hover:border-primary/40 transition-colors group"
        >
          {thumbnailSrc ? (
            <img src={thumbnailSrc} alt="Blueprint" className="w-full h-32 object-cover bg-white" />
          ) : (
            <div className="w-full h-32 flex items-center justify-center bg-muted/40">
              <FileText size={22} className="text-muted-foreground" />
            </div>
          )}
          {annotation && (
            <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[0.5625rem] font-semibold bg-emerald-500/90 text-white">
              Marked
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[0.625rem] px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
            Click to mark up
          </span>
        </button>
      )}
      {editorOpen && (
        <BlueprintAnnotationEditor
          rungId={rungId}
          roomId={roomId}
          roomLabel={roomLabel}
          editableContext="allocation"
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}

interface Props {
  rung: LadderActivity;
  chain: DependencyMasterListRow;
  onClose: () => void;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(startStr: string, endStr: string): number | null {
  const s = new Date(`${startStr}T00:00:00`);
  const e = new Date(`${endStr}T00:00:00`);
  const diff = Math.round((e.getTime() - s.getTime()) / 86400000);
  return diff >= 0 ? diff : null;
}

// "Given by" is one combined dropdown — Developer (the project itself) or
// one of the contractors already allocated to this project — encoded as a
// single select value so there's one control instead of a
// source-then-contractor two-step. DEVELOPER carries no contractor id.
const DEVELOPER_VALUE = "DEVELOPER";
const contractorValue = (id: number) => `CONTRACTOR:${id}`;
function parseGivenBy(value: string): { source: SourceType | ""; contractorId: number | null } {
  if (!value) return { source: "", contractorId: null };
  if (value === DEVELOPER_VALUE) return { source: "DEVELOPER", contractorId: null };
  const id = parseInt(value.replace("CONTRACTOR:", ""), 10);
  return { source: "CONTRACTOR", contractorId: Number.isFinite(id) ? id : null };
}
function givenByValue(source: SourceType | "", contractorId: number | null): string {
  if (source === "DEVELOPER") return DEVELOPER_VALUE;
  if (source === "CONTRACTOR" && contractorId != null) return contractorValue(contractorId);
  return "";
}

// Centered modal opened by clicking an activity chip in Work Allocation's
// linked Dependency chain preview — lets the user assign one or more
// engineers, a start date + duration (auto-fills the end date), who's
// supplying labour/material (Developer or a project-allocated contractor),
// a description, remarks, and the quantities of the activity's own linked
// materials (dbo.ActivityItems) needed for that specific chain rung.
export function RungAssignmentModal({ rung, chain, onClose }: Props) {
  const queryClient = useQueryClient();
  const rungId = rung.rungId!;

  const [engineerIds, setEngineerIds] = useState<number[]>([]);
  const [qcUserIds, setQcUserIds] = useState<number[]>([]);
  const [approvalLevels, setApprovalLevels] = useState<ApprovalLevel[]>([]);
  const [startDate, setStartDate] = useState<string>("");
  const [days, setDays] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [labourSource, setLabourSource] = useState<SourceType | "">("");
  const [labourContractorId, setLabourContractorId] = useState<number | null>(null);
  const [materialSource, setMaterialSource] = useState<SourceType | "">("");
  const [materialContractorId, setMaterialContractorId] = useState<number | null>(null);
  const [description, setDescription] = useState<string>("");
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [remarks, setRemarks] = useState<string>("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  // Read-only here — see the render block below. Tagged in Activity Master,
  // toggled in Reporting.
  const [checkpoints, setCheckpoints] = useState<AssignmentCheckpoint[]>([]);

  const { data: engineers = [] } = useQuery({
    queryKey: ["dependency-activity-assignment-engineers"],
    queryFn: getEngineers,
  });

  const { data: contractors = [] } = useQuery({
    queryKey: ["dependency-activity-assignment-contractors", chain.projectId],
    queryFn: () => getProjectContractors(chain.projectId),
    enabled: !!chain.projectId,
  });

  const { data: detail, isLoading } = useQuery({
    queryKey: ["dependency-activity-assignment", rungId],
    queryFn: () => getRungAssignment(rungId),
  });

  const defaultDescription = useMemo(
    () =>
      `Work for ${chain.projectName || "—"}, ${chain.towerName || "—"}, Floor ${chain.floor}, ${chain.flatName || "—"}, ${chain.roomName || "—"} and ${rung.activityName}`,
    [chain, rung],
  );

  useEffect(() => {
    if (!detail?.assignment) {
      setDescription(defaultDescription);
      setQcUserIds([]);
      setApprovalLevels([]);
      return;
    }
    const a = detail.assignment;
    setEngineerIds(a.engineerIds);
    setQcUserIds(a.qcUserIds || []);
    setApprovalLevels(a.approvalLevels || []);
    setStartDate(a.startDate ? a.startDate.slice(0, 10) : "");
    setDays(a.days != null ? String(a.days) : "");
    setEndDate(a.endDate ? a.endDate.slice(0, 10) : "");
    setLabourSource(a.labourSource || "");
    setLabourContractorId(a.labourContractorId ?? null);
    setMaterialSource(a.materialSource || "");
    setMaterialContractorId(a.materialContractorId ?? null);
    setDescription(a.description || defaultDescription);
    setRemarks(a.remarks || "");
    const qtyMap: Record<string, string> = {};
    for (const m of a.materials) qtyMap[m.itemId] = String(m.quantity);
    setQuantities(qtyMap);
    setCheckpoints(a.checkpoints || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  // Days drives End Date whenever Start Date is known; editing End Date
  // directly recomputes Days the other way — whichever field the user last
  // touched wins, no fighting over which is "the" source of truth.
  const handleDaysChange = (value: string) => {
    setDays(value);
    const n = parseInt(value, 10);
    if (startDate && Number.isFinite(n) && n >= 0) setEndDate(addDays(startDate, n));
  };
  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    const n = parseInt(days, 10);
    if (value && Number.isFinite(n) && n >= 0) setEndDate(addDays(value, n));
  };
  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    if (startDate && value) {
      const d = diffDays(startDate, value);
      if (d != null) setDays(String(d));
    }
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const materials: AssignmentMaterial[] = Object.entries(quantities)
        .map(([itemId, qty]) => ({ itemId, quantity: parseFloat(qty) }))
        .filter((m) => Number.isFinite(m.quantity) && m.quantity > 0);
      return saveRungAssignment(rungId, {
        engineerIds,
        qcUserIds,
        approvalLevels,
        startDate: startDate || null,
        days: days ? parseInt(days, 10) : null,
        endDate: endDate || null,
        labourSource: labourSource || null,
        materialSource: materialSource || null,
        labourContractorId,
        materialContractorId,
        description: description || null,
        remarks: remarks || null,
        materials,
        checkpoints,
      });
    },
    onSuccess: () => {
      toast.success("Assignment saved.");
      queryClient.invalidateQueries({ queryKey: ["dependency-activity-assignment", rungId] });
      // Prefix match — refreshes Work Allocation's "Saved Flow" list for
      // whichever chain is currently open there, without this modal needing
      // to know that page's exact query key/params.
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-work-done-saved-flow"] });
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to save assignment."),
  });

  const candidateItems = detail?.candidateItems ?? [];

  // Portaled straight to <body> — a plain inline `fixed` div gets trapped
  // inside whatever ancestor stacking context the caller happens to render
  // it under (e.g. EngineeringShell's page header is a z-30 sibling of a
  // z-10 content wrapper; a modal rendered inside that content wrapper can
  // never paint above the header no matter how high its own z-index is).
  // Same fix ActivityDetailModal.tsx already uses.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-card border border-border rounded-xl shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h3 className="font-heading font-semibold text-sm text-foreground">{rung.activityName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Assign engineers & material</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-10">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5 overflow-y-auto">
            {/* Mini Approval Setup — who is allowed to approve THIS activity's
                finished work, scoped to just this assignment. Sits above the
                Engineers/QC pickers since it governs both of them. */}
            <ApprovalLevelsEditor levels={approvalLevels} onChange={setApprovalLevels} users={engineers} />

            {/* Engineers & QC — styled multi-select dropdowns, side by side */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>
                  <UserRound size={11} /> Engineers
                </label>
                <UserMultiSelect users={engineers} selected={engineerIds} onChange={setEngineerIds} placeholder="Select engineers…" noneLabel="No engineers available." />
              </div>
              <div>
                <label className={labelCls}>
                  <ShieldCheck size={11} /> Quality Check
                </label>
                <UserMultiSelect users={engineers} selected={qcUserIds} onChange={setQcUserIds} placeholder="Select QC…" noneLabel="No one available." />
              </div>
            </div>

            {/* Start / Duration / End */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>
                  <CalendarDays size={11} /> Start Date
                </label>
                <DateInput
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Days</label>
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 10"
                  value={days}
                  onChange={(e) => handleDaysChange(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>End Date</label>
                <DateInput
                  value={endDate}
                  onChange={(e) => handleEndDateChange(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            {/* Labour / Material given by — Developer or a project-allocated contractor */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>
                  <HardHat size={11} /> Labour Given By
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={givenByValue(labourSource, labourContractorId)}
                    onChange={(e) => {
                      const { source, contractorId } = parseGivenBy(e.target.value);
                      setLabourSource(source);
                      setLabourContractorId(contractorId);
                    }}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    <option value={DEVELOPER_VALUE}>Developer — {chain.projectName || "Project"}</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={contractorValue(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {labourSource && (
                    <span
                      className={`shrink-0 text-[0.625rem] font-heading font-bold uppercase tracking-wide px-2 py-1 rounded-full ${SOURCE_META[labourSource].className}`}
                    >
                      {SOURCE_META[labourSource].label}
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className={labelCls}>
                  <Package size={11} /> Material Given By
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={givenByValue(materialSource, materialContractorId)}
                    onChange={(e) => {
                      const { source, contractorId } = parseGivenBy(e.target.value);
                      setMaterialSource(source);
                      setMaterialContractorId(contractorId);
                    }}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    <option value={DEVELOPER_VALUE}>Developer — {chain.projectName || "Project"}</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={contractorValue(c.id)}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {materialSource && (
                    <span
                      className={`shrink-0 text-[0.625rem] font-heading font-bold uppercase tracking-wide px-2 py-1 rounded-full ${SOURCE_META[materialSource].className}`}
                    >
                      {SOURCE_META[materialSource].label}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Description — auto-filled from location + activity, editable */}
            <div>
              <label className={labelCls}>
                <FileText size={11} /> Description
              </label>
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDescriptionTouched(true);
                }}
                rows={2}
                className={`${inputCls} resize-none`}
              />
              {!descriptionTouched && (
                <p className="text-[0.625rem] text-muted-foreground mt-1">Auto-filled from location — edit freely.</p>
              )}
            </div>

            {/* Reference blueprint — click to open the markup editor */}
            {rung.rungId != null && chain.roomId != null && (
              <BlueprintPreviewSection
                roomId={chain.roomId}
                rungId={rung.rungId}
                roomLabel={chain.scopePath}
              />
            )}

            {/* Material */}
            <div>
              <label className={labelCls}>
                <Package size={11} /> Material
              </label>
              {candidateItems.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1.5">
                  No materials are linked to this activity yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {candidateItems.map((item) => (
                    <div
                      key={item.itemId}
                      className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{item.itemName}</p>
                        {item.itemCode && (
                          <p className="text-[0.625rem] text-muted-foreground">{item.itemCode}</p>
                        )}
                      </div>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        placeholder="Qty"
                        value={quantities[item.itemId] ?? ""}
                        onChange={(e) =>
                          setQuantities((q) => ({ ...q, [item.itemId]: e.target.value }))
                        }
                        className="w-20 px-2 py-1.5 rounded-md text-xs bg-background border border-border text-foreground text-right focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                      />
                      {item.uom && <span className="text-[0.625rem] text-muted-foreground w-8 shrink-0">{item.uom}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Checkpoints — read-only preview here. These are tagged onto the
                Activity itself in Activity Master (not picked per-rung
                anymore) and auto-seed onto this rung the first time it's
                viewed; checking them off happens in Reporting, not here. */}
            <div>
              <label className={`${labelCls} mb-1.5`}>
                <ListChecks size={11} /> Checkpoints
              </label>
              {checkpoints.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1.5">
                  No checkpoints tagged to this activity — add them in Activity Master.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {checkpoints.map((cp, i) => (
                    <div
                      key={`${cp.checkpointId ?? "custom"}-${i}`}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/40 border border-border/50"
                    >
                      <div
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          cp.isChecked ? "bg-emerald-500 border-emerald-500 text-white" : "bg-background border-border text-transparent"
                        }`}
                      >
                        <Check size={9} strokeWidth={3} />
                      </div>
                      <span className="text-sm text-foreground flex-1 truncate">{cp.fieldName}</span>
                      {cp.isDaily && (
                        <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-cyan-700 dark:text-cyan-300 bg-cyan-500/10 px-1.5 py-0.5 rounded-full shrink-0">
                          <CalendarDays size={9} /> Daily
                        </span>
                      )}
                      {cp.minWaitDays != null && cp.minWaitDays > 0 && (
                        <span className="inline-flex items-center gap-1 text-[0.625rem] font-medium text-amber-600 dark:text-amber-400 bg-[#ffe2021a] px-1.5 py-0.5 rounded-full shrink-0">
                          <Timer size={9} /> {cp.minWaitDays}d wait
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Remarks */}
            <div>
              <label className={labelCls}>
                <MessageSquare size={11} /> Remarks
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                placeholder="Any additional notes…"
                className={`${inputCls} resize-none`}
              />
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-xs font-heading font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || isLoading}
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg btn-module transition-all disabled:opacity-50"
          >
            {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
