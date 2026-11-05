// A workflow's levels: adding one, and each level as a card.
import { useState, useRef, useEffect } from "react";
import { type User } from "@/api/userApi";
import { Pencil, Trash2, ChevronUp, ChevronDown, X, Check, Users, GitBranch, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ApprovalLevel } from "./config";
import { UserMultiSelect } from "./UserMultiSelect";

// ─── AddLevelRow ──────────────────────────────────────────────────────────────

export function AddLevelRow({
  users,
  roleNames,
  levelNumber,
  onConfirm,
  onCancel,
  initial,
}: {
  users: User[];
  /** Every role in Role Master, for the "Everyone with the role" picker. */
  roleNames: string[];
  levelNumber: number;
  onConfirm: (level: Omit<ApprovalLevel, "id">) => void;
  onCancel: () => void;
  /** Prefills the form and switches it to "edit an existing step" mode/copy. */
  initial?: Omit<ApprovalLevel, "id">;
}) {
  const isEdit = !!initial;
  const [label, setLabel] = useState(initial?.label ?? "");
  const [userIds, setUserIds] = useState<number[]>(initial?.userIds ?? []);
  const [roles, setRoles] = useState<string[]>(initial?.roles ?? []);
  const [mode, setMode] = useState<"any" | "all">(initial?.mode ?? "any");
  const sameRole = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const toggleRole = (r: string) =>
    setRoles((prev) => (prev.some((x) => sameRole(x, r)) ? prev.filter((x) => !sameRole(x, r)) : [...prev, r]));
  // A stored role that is no longer in Role Master still shows, so it can be removed.
  const roleChoices = [...roleNames, ...roles.filter((r) => !roleNames.some((n) => sameRole(n, r)))];
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    labelRef.current?.focus();
  }, []);

  function confirm() {
    if (!label.trim()) {
      labelRef.current?.focus();
      return;
    }
    onConfirm({ label: label.trim(), userIds, roles, mode });
  }

  return (
    <div className="border border-foreground p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-6 h-6 bg-foreground text-card text-xs font-bold flex items-center justify-center">
          {levelNumber}
        </div>
        <span className="text-sm font-semibold text-foreground">
          {isEdit ? "Edit approval step" : "New approval step"}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            What is this step called?{" "}
            <span className="text-destructive">*</span>
          </label>
          <Input
            ref={labelRef}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Site Manager, Finance Head, Director…"
            className="h-9 text-sm rounded-none bg-card border-foreground/40 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
              if (e.key === "Escape") onCancel();
            }}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            These people can approve
          </label>
          <UserMultiSelect
            value={userIds}
            onChange={setUserIds}
            users={users}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            …and everyone with these roles
          </label>
          <div className="flex flex-wrap gap-1.5">
            {roleChoices.map((r) => {
              const on = roles.some((x) => sameRole(x, r));
              return (
                <button key={r} type="button" onClick={() => toggleRole(r)} aria-pressed={on}
                  className={cn("px-2 py-1 text-[0.6875rem] border transition-colors",
                    on ? "border-foreground bg-foreground text-card" : "border-foreground/25 text-muted-foreground hover:border-foreground")}>
                  {r}
                </button>
              );
            })}
          </div>
          <p className="text-[0.6875rem] text-muted-foreground mt-1.5">
            Anyone who holds a ticked role can approve this step, including people given the role later.
          </p>
        </div>

        {userIds.length > 1 && (
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              How many of them need to approve?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  {
                    id: "any" as const,
                    icon: Users,
                    label: "Any one of them",
                    desc: "The first person to approve settles this step.",
                  },
                  {
                    id: "all" as const,
                    icon: GitBranch,
                    label: "All of them",
                    desc: "Every person assigned here must approve before it moves on.",
                  },
                ]
              ).map((opt) => {
                const Icon = opt.icon;
                const selected = mode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setMode(opt.id)}
                    className={cn(
                      "text-left p-3 border-2 transition-all",
                      selected
                        ? "border-foreground"
                        : "border-foreground/25 bg-background hover:border-foreground/40",
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className={cn("w-3.5 h-3.5", selected ? "text-foreground" : "text-muted-foreground")} />
                      <span className={cn("text-xs font-semibold", selected ? "text-foreground" : "text-foreground")}>
                        {opt.label}
                      </span>
                    </div>
                    <p className="text-[0.6875rem] text-muted-foreground leading-snug">{opt.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="h-8 px-4 gap-1.5 rounded-none bg-foreground text-card border border-foreground hover:bg-foreground/85 font-heading uppercase tracking-[0.1em] text-[0.625rem] font-semibold"
          onClick={confirm}
        >
          <Check className="w-3.5 h-3.5" /> {isEdit ? "Save changes" : "Add this step"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCancel}
          className="rounded-none h-8 px-4 gap-1.5 bg-card border border-foreground text-foreground hover:bg-primary/10 hover:text-foreground font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em]"
        >
          <X className="w-3.5 h-3.5" /> Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── LevelCard ────────────────────────────────────────────────────────────────

export function LevelCard({
  level,
  index,
  total,
  users,
  onMoveUp,
  onMoveDown,
  onRemove,
  onEdit,
}: {
  level: ApprovalLevel;
  index: number;
  total: number;
  users: User[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onEdit: () => void;
}) {
  function initials(name: string) {
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  const levelUsers = users.filter((u) => level.userIds.includes(u.id));

  return (
    <div className="flex items-stretch gap-3">
      {/* Step number + connector */}
      <div className="flex flex-col items-center flex-shrink-0 w-8">
        {index > 0 && <div className="w-0.5 h-3 bg-foreground/40" />}
        <div className="w-8 h-8 bg-foreground text-card text-sm font-bold flex items-center justify-center">
          {index + 1}
        </div>
        {index < total - 1 && (
          <div className="w-0.5 flex-1 bg-foreground/40 mt-1" />
        )}
      </div>

      {/* Card */}
      <div className="flex-1 flex items-center justify-between gap-3 border border-foreground/25 bg-card px-4 py-3 mb-1 hover:border-foreground/40 transition-all">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-semibold text-foreground">
              {level.label}
            </div>
            {level.mode === "all" && levelUsers.length > 1 && (
              <span className="inline-flex items-center gap-1 text-[0.625rem] font-semibold text-foreground border border-foreground/50 px-2 py-0.5">
                <GitBranch className="w-2.5 h-2.5" /> All must approve
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {(level.roles ?? []).map((r) => (
              <span key={`role-${r}`} className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.6875rem] border border-foreground/50 text-foreground"
                title={`Everyone with the ${r} role`}>
                <ShieldCheck className="w-3 h-3" /> {r}
              </span>
            ))}
            {levelUsers.length === 0 ? (
              !(level.roles ?? []).length && (
                <span className="inline-flex items-center gap-1 text-[0.6875rem] text-foreground border border-dashed border-foreground/50 px-2 py-0.5">
                  <AlertCircle className="w-3 h-3" /> No one assigned yet
                </span>
              )
            ) : (
              levelUsers.map((u) => (
                <span
                  key={u.id}
                  className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 text-[0.6875rem] bg-muted text-muted-foreground border border-foreground/25"
                >
                  <span
                    className="w-4 h-4 flex items-center justify-center text-[0.5rem] font-bold"
                    style={{
                      background: `hsl(${(u.id * 47) % 360} 60% 40% / 0.25)`,
                      color: `hsl(${(u.id * 47) % 360} 60% 55%)`,
                    }}
                  >
                    {initials(u.name)}
                  </span>
                  {u.name}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {total > 1 && (
            <div className="flex flex-col gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                disabled={index === 0}
                onClick={onMoveUp}
                title="Move up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                disabled={index === total - 1}
                onClick={onMoveDown}
                title="Move down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-none border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-transparent ml-1"
            onClick={onEdit}
            title="Edit who's assigned to this step"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-none border border-transparent text-muted-foreground hover:text-destructive hover:border-destructive hover:bg-transparent"
            onClick={onRemove}
            title="Remove this step"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
