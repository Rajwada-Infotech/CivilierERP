import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, PageKey } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { getUsers, type User } from "@/api/userApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import { Plus, Pencil, Trash2, ShieldCheck, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ApprovalWorkflow, SquareSwitch, MODULE_OPTIONS, fetchWorkflows, apiSave, apiToggle, apiDelete } from "./approvalSetup/config";
import { ConfigForm } from "./approvalSetup/ConfigForm";
import { RaiserRules } from "./approvalSetup/RaiserRules";

// The page is split into parts under ./approvalSetup. The workflow types and the module selector are
// re-exported here because the approval workflows API and the module-group test import them from this file.
export type { ApprovalLevel, ApprovalWorkflow } from "./approvalSetup/config";
export { ModuleGroupSelector } from "./approvalSetup/ModuleGroupSelector";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY_INK = "rounded-none h-9 px-4 gap-1.5 bg-foreground text-card border border-foreground hover:bg-foreground/85 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]";
const ACT = "rounded-none h-7 w-7 p-0 border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-transparent";
const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";

export default function ApprovalSetup() {
  const qc = useQueryClient();
  const { canDoAction } = useAuth() as any;
  const rights = usePageRights("approval-setup");

  const [mode, setMode] = useState<"list" | "new" | "edit">("list");
  const [editing, setEditing] = useState<ApprovalWorkflow | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: workflows = [], isLoading } = useQuery<ApprovalWorkflow[]>({
    queryKey: ["approval-workflows"],
    queryFn: fetchWorkflows,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    select: (data) => (Array.isArray(data) ? data : []),
  });

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: getUsers,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const handleSave = useCallback(
    async (data: Omit<ApprovalWorkflow, "id" | "createdAt">) => {
      setSaving(true);
      try {
        await apiSave(data, editing?.id);
        toast.success(
          editing ? "Approval rule updated" : "Approval rule created",
        );
        qc.invalidateQueries({ queryKey: ["approval-workflows"] });
        setMode("list");
        setEditing(null);
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setSaving(false);
      }
    },
    [editing, qc],
  );

  const handleToggle = useCallback(
    async (id: number) => {
      try {
        await apiToggle(id);
        qc.invalidateQueries({ queryKey: ["approval-workflows"] });
      } catch (err: any) {
        toast.error(err.message);
      }
    },
    [qc],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (
        !confirm(
          "Are you sure you want to delete this approval rule? This cannot be undone.",
        )
      )
        return;
      try {
        await apiDelete(id);
        toast.success("Approval rule deleted");
        qc.invalidateQueries({ queryKey: ["approval-workflows"] });
      } catch (err: any) {
        toast.error(err.message);
      }
    },
    [qc],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-6 w-48 bg-muted" />
        <div className="h-64 bg-muted" />
      </div>
    );
  }

  const canCreate = canDoAction("admin_approval_setup" as PageKey, "create");
  const canEdit = canDoAction("admin_approval_setup" as PageKey, "edit");
  const canDel = canDoAction("admin_approval_setup" as PageKey, "delete");

  return (
    <>
      <Breadcrumbs items={["Admin", "Approval", "Approval Setup"]} />
      <SheetShell
        eyebrow="CivilierERP · Approvals"
        title="Approval rules"
        subtitle="Who has to approve a request before it goes through — purchase orders, expenses and the rest — level by level."
        action={
          mode === "list" && canCreate && (
            <Button
              className={`${KEY_INK} shrink-0`}
              onClick={() => {
                setEditing(null);
                setMode("new");
              }}
            >
              <Plus className="h-3.5 w-3.5" /> New approval rule
            </Button>
          )
        }
      >
        {/* Form */}
        {(mode === "new" || mode === "edit") && (
          <ConfigForm
            initial={mode === "edit" ? (editing ?? undefined) : undefined}
            users={users}
            onSave={handleSave}
            onCancel={() => {
              setMode("list");
              setEditing(null);
            }}
            saving={saving}
          />
        )}

        {/* List */}
        {mode === "list" && (
          <div className="bg-card" style={{ border: RULE }}>
            <div className="statrow" style={{ padding: "16px 16px 18px" }}>
              {[
                { label: "Rules", value: workflows.length, note: "set up" },
                { label: "On", value: workflows.filter((w) => w.active).length, note: "sending requests for approval" },
                { label: "Modules covered", value: new Set(workflows.filter((w) => w.active).flatMap((w) => w.modules)).size, note: "by a rule that is on" },
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
        {mode === "list" && (
          <div className="bg-card overflow-hidden" style={{ border: RULE }}>
            <div className="flex items-baseline gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
              <div className="flex items-baseline gap-2.5">
                <span className={HEAD}>Approval rules</span>
                <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{workflows.length}</span>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {workflows.length === 0
                    ? "No rules set up yet"
                    : `${workflows.length} rule${workflows.length > 1 ? "s" : ""} — toggle to turn them on or off`}
                </div>
              </div>
            </div>

            {workflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <div className="font-heading text-base font-bold tracking-tight text-foreground mb-1">
                  No approval rules yet
                </div>
                <p className="text-sm text-muted-foreground mb-5 max-w-sm">
                  Once you create a rule, any matching request will
                  automatically be sent for approval before it's processed.
                </p>
                {canCreate && (
                  <Button
                    className={KEY_INK}
                    onClick={() => {
                      setEditing(null);
                      setMode("new");
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" /> Create your first rule
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-foreground/15">
                {workflows.map((wf) => {
                  const allModeSteps = wf.levels.filter(
                    (l) => l.mode === "all" && l.userIds.length > 1,
                  ).length;
                  return (
                    <div
                      key={wf.id}
                      className={cn(
                        "flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-primary/5",
                      )}
                    >
                      {/* Active indicator */}
                      <span className="w-12 shrink-0">
                        {wf.active ? <SheetMark text="On" tone="done" /> : <span className={LBL}>Off</span>}
                      </span>

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-sm font-semibold", wf.active ? "text-foreground" : "text-muted-foreground")}>
                            {wf.name}
                          </span>
                          {allModeSteps > 0 && (
                            <span className={`${TAG} text-foreground border-foreground/50`}>
                              <GitBranch className="w-3 h-3" />
                              {allModeSteps} step{allModeSteps > 1 ? "s" : ""} need everyone
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          {/* Modules */}
                          <div className="flex flex-wrap gap-1">
                            {wf.modules.slice(0, 4).map((mid) => {
                              const m = MODULE_OPTIONS.find(
                                (x) => x.id === mid,
                              );
                              return (
                                <span
                                  key={mid}
                                  className="text-[0.6875rem] px-1.5 py-0.5 border border-foreground/25 text-muted-foreground"
                                >
                                  {m?.label ?? mid}
                                </span>
                              );
                            })}
                            {wf.modules.length > 4 && (
                              <span className="text-[0.6875rem] px-1.5 py-0.5 border border-foreground/25 text-muted-foreground">
                                +{wf.modules.length - 4} more
                              </span>
                            )}
                          </div>
                          {/* Levels summary */}
                          <span className="text-[0.6875rem] text-muted-foreground">
                            {wf.levels.length} approval step
                            {wf.levels.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Toggle + actions */}
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="flex flex-col items-center gap-0.5">
                          <SquareSwitch
                            checked={wf.active}
                            onChange={() => handleToggle(wf.id)}
                            disabled={!canEdit}
                            ariaLabel={`${wf.name}: ${wf.active ? "on" : "off"}`}
                          />
                          <span className={LBL}>
                            {wf.active ? "On" : "Off"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 border-l border-foreground/25 pl-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className={ACT}
                            disabled={!canEdit}
                            title="Edit this rule"
                            onClick={() => {
                              setEditing(wf);
                              setMode("edit");
                            }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`${ACT} hover:!text-destructive hover:!border-destructive`}
                            disabled={!canDel}
                            title="Delete this rule"
                            onClick={() => handleDelete(wf.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {mode === "list" && <RaiserRules canEdit={canEdit} />}
      </SheetShell>
    </>
  );
}
