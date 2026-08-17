import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, UserRound, CalendarDays, Package, Loader2, HardHat, FileText, MessageSquare, ChevronDown } from "lucide-react";
import type { LadderActivity, DependencyMasterListRow } from "@/api/dependencyMasterApi";
import {
  getEngineers,
  getProjectContractors,
  getRungAssignment,
  saveRungAssignment,
  SOURCE_META,
  type AssignmentMaterial,
  type SourceType,
  type Engineer,
} from "@/api/dependencyActivityAssignmentApi";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

const inputCls =
  "w-full px-3 py-2.5 rounded-lg text-sm bg-muted border border-border text-foreground transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500/30 disabled:opacity-50 disabled:cursor-not-allowed";
const labelCls = "text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1.5";

// Native <select multiple> renders as a raw OS listbox no amount of CSS can
// soften — this pairs a styled trigger with a checkbox list in a Radix
// popover instead, matching the rest of the app's input styling.
function EngineerMultiSelect({
  engineers, selected, onChange,
}: {
  engineers: Engineer[]; selected: number[]; onChange: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const label =
    selected.length === 0
      ? "Select engineers…"
      : selected.length === 1
        ? engineers.find((e) => e.id === selected[0])?.name || "1 engineer selected"
        : `${selected.length} engineers selected`;

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
        {engineers.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-2 py-1.5">No engineers available.</p>
        ) : (
          engineers.map((eng) => (
            <label
              key={eng.id}
              className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-foreground hover:bg-muted cursor-pointer transition-colors"
            >
              <Checkbox checked={selected.includes(eng.id)} onCheckedChange={() => toggle(eng.id)} />
              {eng.name}
            </label>
          ))
        )}
      </PopoverContent>
    </Popover>
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

// Centered modal opened by clicking an activity chip in Work Reporting's
// linked Dependency chain preview — lets the user assign one or more
// engineers, a start date + duration (auto-fills the end date), who's
// supplying labour/material (Developer or a project-allocated contractor),
// a description, remarks, and the quantities of the activity's own linked
// materials (dbo.ActivityItems) needed for that specific chain rung.
export function RungAssignmentModal({ rung, chain, onClose }: Props) {
  const queryClient = useQueryClient();
  const rungId = rung.rungId!;

  const [engineerIds, setEngineerIds] = useState<number[]>([]);
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
      return;
    }
    const a = detail.assignment;
    setEngineerIds(a.engineerIds);
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
      });
    },
    onSuccess: () => {
      toast.success("Assignment saved.");
      queryClient.invalidateQueries({ queryKey: ["dependency-activity-assignment", rungId] });
      // Prefix match — refreshes Work Reporting's "Saved Flow" list for
      // whichever chain is currently open there, without this modal needing
      // to know that page's exact query key/params.
      queryClient.invalidateQueries({ queryKey: ["civilworkdpr-work-done-saved-flow"] });
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || "Failed to save assignment."),
  });

  const candidateItems = detail?.candidateItems ?? [];

  return (
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
            {/* Engineers — styled multi-select dropdown */}
            <div>
              <label className={labelCls}>
                <UserRound size={11} /> Engineers
              </label>
              <EngineerMultiSelect engineers={engineers} selected={engineerIds} onChange={setEngineerIds} />
            </div>

            {/* Start / Duration / End */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>
                  <CalendarDays size={11} /> Start Date
                </label>
                <input
                  type="date"
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
                <input
                  type="date"
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
                      className={`shrink-0 text-[10px] font-heading font-bold uppercase tracking-wide px-2 py-1 rounded-full ${SOURCE_META[labourSource].className}`}
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
                      className={`shrink-0 text-[10px] font-heading font-bold uppercase tracking-wide px-2 py-1 rounded-full ${SOURCE_META[materialSource].className}`}
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
                <p className="text-[10px] text-muted-foreground mt-1">Auto-filled from location — edit freely.</p>
              )}
            </div>

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
                          <p className="text-[10px] text-muted-foreground">{item.itemCode}</p>
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
                      {item.uom && <span className="text-[10px] text-muted-foreground w-8 shrink-0">{item.uom}</span>}
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
            className="inline-flex items-center gap-1.5 shrink-0 font-heading font-semibold text-white shadow-sm text-xs px-3 sm:px-4 py-1.5 h-auto rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 hover:from-cyan-600 hover:to-teal-500 transition-all disabled:opacity-50"
          >
            {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
