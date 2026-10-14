// The form that sets up (or edits) one module's approval workflow.
import React, { useState, useRef } from "react";
import { toast } from "sonner";
import { type User } from "@/api/userApi";
import { Plus, X, Loader2, Users, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ApprovalLevel, ApprovalWorkflow } from "./config";
import { AddLevelRow, LevelCard } from "./Levels";
import { ModuleGroupSelector } from "./ModuleGroupSelector";

// ─── Step wrapper ─────────────────────────────────────────────────────────────

export function FormStep({
  number,
  title,
  subtitle,
  children,
}: {
  number: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-7 h-7 border border-foreground text-foreground text-xs font-bold flex items-center justify-center">
          {number}
        </div>
        <div className="w-0.5 flex-1 bg-border/50 mt-1" />
      </div>
      <div className="flex-1 pb-6">
        <div className="mb-3">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {subtitle && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── ConfigForm ───────────────────────────────────────────────────────────────

export function ConfigForm({
  initial,
  users,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ApprovalWorkflow;
  users: User[];
  onSave: (data: Omit<ApprovalWorkflow, "id" | "createdAt">) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [selectedModules, setSelectedModules] = useState<string[]>(
    initial?.modules ?? [],
  );
  const [levels, setLevels] = useState<ApprovalLevel[]>(initial?.levels ?? []);
  const [addingLevel, setAddingLevel] = useState(false);
  const [editingLevelId, setEditingLevelId] = useState<number | null>(null);
  const nextId = useRef(Date.now());

  function toggleModule(id: string) {
    setSelectedModules((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function addLevel(lv: Omit<ApprovalLevel, "id">) {
    setLevels((prev) => [...prev, { ...lv, id: nextId.current++ }]);
    setAddingLevel(false);
  }

  function updateLevel(id: number, lv: Omit<ApprovalLevel, "id">) {
    setLevels((prev) => prev.map((p) => (p.id === id ? { ...lv, id } : p)));
    setEditingLevelId(null);
  }

  function moveUp(idx: number) {
    setLevels((prev) => {
      const a = [...prev];
      [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]];
      return a;
    });
  }

  function moveDown(idx: number) {
    setLevels((prev) => {
      const a = [...prev];
      [a[idx], a[idx + 1]] = [a[idx + 1], a[idx]];
      return a;
    });
  }

  function submit() {
    if (!name.trim()) {
      toast.error("Please give this approval rule a name");
      return;
    }
    if (!selectedModules.length) {
      toast.error("Please select at least one area where this applies");
      return;
    }
    if (!levels.length) {
      toast.error("Please add at least one approval step");
      return;
    }
    onSave({
      // Each step now carries its own Anyone/Everyone mode — the workflow
      // itself is always "sequential" (steps happen in the order below).
      name: name.trim(),
      type: "sequential",
      modules: selectedModules,
      levels,
      active: initial?.active ?? true,
    });
  }

  return (
    <div className="border border-foreground/25 bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-foreground">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {initial ? "Edit Approval Rule" : "Create a New Approval Rule"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Follow the steps below — it only takes a minute
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={onCancel}
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </Button>
      </div>

      <div className="p-6">
        {/* Step 1: Name */}
        <FormStep
          number={1}
          title="Give this rule a name"
          subtitle="Something clear so your team knows what it's for"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Site Manager Approval, Finance Sign-off…"
            className="h-10 text-sm max-w-md"
          />
        </FormStep>

        {/* Step 2: Where it applies */}
        <FormStep
          number={2}
          title="Where does this rule apply?"
          subtitle="Choose the areas of the system that need this approval before proceeding"
        >
          <ModuleGroupSelector
            selectedModules={selectedModules}
            toggleModule={toggleModule}
          />
          {selectedModules.length > 0 && (
            <p className="text-xs text-foreground mt-2 font-medium">
              ✓ {selectedModules.length} area
              {selectedModules.length > 1 ? "s" : ""} selected
            </p>
          )}
        </FormStep>

        {/* Step 3: Approval steps */}
        <div className="flex gap-4">
          <div className="flex flex-col items-center flex-shrink-0">
            <div className="w-7 h-7 border border-foreground text-foreground text-xs font-bold flex items-center justify-center">
              3
            </div>
          </div>
          <div className="flex-1 pb-2">
            <div className="mb-3">
              <div className="text-sm font-semibold text-foreground">
                Who needs to approve, and in what order?
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Add approval steps in order. Assign one or more people to
                each — if you assign more than one, choose whether any one of
                them can approve, or all of them must.
              </div>
            </div>

            {/* Empty state */}
            {levels.length === 0 && !addingLevel && (
              <div className="border border-dashed border-foreground/40 px-5 py-8 text-center mb-3">
                <div className="w-12 h-12 flex items-center justify-center mx-auto mb-3">
                  <Users className="w-6 h-6 text-muted-foreground/40" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  No approval steps yet
                </p>
                <p className="text-xs text-muted-foreground mb-4">
                  Click the button below to add your first approver.
                  <br />
                  Example: Step 1 → Head Engineer, Step 2 → Director 1 & Director 2 (all must approve)
                </p>
              </div>
            )}

            {/* Level cards */}
            <div className="space-y-0">
              {levels.map((lv, idx) =>
                editingLevelId === lv.id ? (
                  <AddLevelRow
                    key={lv.id}
                    users={users}
                    levelNumber={idx + 1}
                    initial={{ label: lv.label, userIds: lv.userIds, mode: lv.mode }}
                    onConfirm={(patch) => updateLevel(lv.id, patch)}
                    onCancel={() => setEditingLevelId(null)}
                  />
                ) : (
                  <LevelCard
                    key={lv.id}
                    level={lv}
                    index={idx}
                    total={levels.length}
                    users={users}
                    onMoveUp={() => moveUp(idx)}
                    onMoveDown={() => moveDown(idx)}
                    onRemove={() =>
                      setLevels((prev) => prev.filter((_, i) => i !== idx))
                    }
                    onEdit={() => setEditingLevelId(lv.id)}
                  />
                ),
              )}

              {/* Arrow between last card and add row */}
              {levels.length > 0 && !addingLevel && (
                <div className="flex items-center gap-3 py-1 pl-3.5">
                  <div className="w-0.5 h-5 bg-foreground/40" />
                </div>
              )}

              {addingLevel ? (
                <AddLevelRow
                  users={users}
                  levelNumber={levels.length + 1}
                  onConfirm={addLevel}
                  onCancel={() => setAddingLevel(false)}
                />
              ) : editingLevelId === null ? (
                <button
                  type="button"
                  onClick={() => setAddingLevel(true)}
                  className={cn(
                    "inline-flex items-center gap-2 px-4 py-2.5 border-2 border-dashed text-sm transition-all",
                    "border-foreground/25 text-muted-foreground hover:border-foreground hover:text-foreground",
                    levels.length > 0 && "ml-11",
                  )}
                >
                  <Plus className="w-4 h-4" />
                  {levels.length === 0
                    ? "Add first approval step"
                    : "Add another step"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-foreground">
        <p className="text-xs text-muted-foreground">
          {levels.length > 0 && selectedModules.length > 0
            ? `✓ Ready — ${levels.length} step${levels.length > 1 ? "s" : ""} across ${selectedModules.length} area${selectedModules.length > 1 ? "s" : ""}`
            : "Fill in all steps above to save"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Discard
          </Button>
          <Button
            size="sm"
            className="gap-1.5 rounded-none bg-foreground text-card border border-foreground hover:bg-foreground/85 font-heading uppercase tracking-[0.1em] text-[0.625rem] font-semibold px-5"
            onClick={submit}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            {initial ? "Save Changes" : "Save Rule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
