import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, PageKey } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { getUsers, type User } from "@/api/userApi";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { Plus, Pencil, Trash2, ShieldCheck, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ApprovalWorkflow, MODULE_OPTIONS, fetchWorkflows, apiSave, apiToggle, apiDelete } from "./approvalSetup/config";
import { ConfigForm } from "./approvalSetup/ConfigForm";
import { RaiserRules } from "./approvalSetup/RaiserRules";

// The page is split into parts under ./approvalSetup. The workflow types and the module selector are
// re-exported here because the approval workflows API and the module-group test import them from this file.
export type { ApprovalLevel, ApprovalWorkflow } from "./approvalSetup/config";
export { ModuleGroupSelector } from "./approvalSetup/ModuleGroupSelector";

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
        <div className="h-6 w-48 bg-muted rounded" />
        <div className="h-64 bg-muted rounded-xl" />
      </div>
    );
  }

  const canCreate = canDoAction("admin_approval_setup" as PageKey, "create");
  const canEdit = canDoAction("admin_approval_setup" as PageKey, "edit");
  const canDel = canDoAction("admin_approval_setup" as PageKey, "delete");

  return (
    <>
      <Breadcrumbs items={["Admin", "Approval", "Approval Setup"]} />
      <AdminShell
        title="Approval Rules"
        subtitle="Control who needs to approve requests before they go through — like purchase orders, expenses, and more."
        icon={ShieldCheck}
        action={
          mode === "list" && canCreate && (
            <Button
              className="btn-module shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto"
              onClick={() => {
                setEditing(null);
                setMode("new");
              }}
            >
              <Plus className="h-4 w-4" /> New Approval Rule
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
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/20">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Your Approval Rules
                </div>
                <div className="text-xs text-muted-foreground">
                  {workflows.length === 0
                    ? "No rules set up yet"
                    : `${workflows.length} rule${workflows.length > 1 ? "s" : ""} — toggle to turn them on or off`}
                </div>
              </div>
            </div>

            {workflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center px-6">
                <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                  <ShieldCheck className="w-8 h-8 text-muted-foreground/30" />
                </div>
                <div className="text-base font-semibold text-foreground mb-1">
                  No approval rules yet
                </div>
                <p className="text-sm text-muted-foreground mb-5 max-w-sm">
                  Once you create a rule, any matching request will
                  automatically be sent for approval before it's processed.
                </p>
                {canCreate && (
                  <Button
                    className="btn-module shadow-sm hover:opacity-90 text-white gap-1.5 font-semibold"
                    onClick={() => {
                      setEditing(null);
                      setMode("new");
                    }}
                  >
                    <Plus className="w-4 h-4" /> Create your first rule
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {workflows.map((wf) => {
                  const allModeSteps = wf.levels.filter(
                    (l) => l.mode === "all" && l.userIds.length > 1,
                  ).length;
                  return (
                    <div
                      key={wf.id}
                      className={cn(
                        "flex items-center gap-4 px-5 py-4 transition-colors",
                        wf.active
                          ? "hover:bg-muted/20"
                          : "opacity-60 hover:bg-muted/10",
                      )}
                    >
                      {/* Active indicator */}
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full flex-shrink-0",
                          wf.active ? "bg-green-500" : "bg-muted-foreground/30",
                        )}
                      />

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">
                            {wf.name}
                          </span>
                          {allModeSteps > 0 && (
                            <span className="inline-flex items-center gap-1 text-[0.6875rem] text-violet-600 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">
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
                                  className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground"
                                >
                                  {m?.icon} {m?.label ?? mid}
                                </span>
                              );
                            })}
                            {wf.modules.length > 4 && (
                              <span className="text-[0.6875rem] px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground">
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
                          <Switch
                            checked={wf.active}
                            onCheckedChange={() => handleToggle(wf.id)}
                            disabled={!canEdit}
                          />
                          <span className="text-[0.625rem] text-muted-foreground">
                            {wf.active ? "On" : "Off"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 border-l border-border pl-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
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
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
      </AdminShell>
    </>
  );
}
