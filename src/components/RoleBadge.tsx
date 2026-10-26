import { cn } from "../lib/utils";

// Single shared source for SA role name -> label/color, so a role renders
// the same way everywhere it appears (SaTeamManagement's team accordion,
// etc.) instead of each page hand-rolling its own color map / label map
// for the same three role names.
const ROLE_CONFIG: Record<string, { label: string; classes: string }> = {
  marketing_head: {
    label: "Marketing Head",
    classes: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  },
  sales_team_lead: {
    label: "Sales Team Lead",
    classes: "text-purple-400 bg-purple-500/10 border-purple-500/30",
  },
  sales_person: {
    label: "Sales Person",
    classes: "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
  },
};

const FALLBACK = {
  classes: "text-muted-foreground bg-muted/20 border-border",
};

interface RoleBadgeProps {
  role: string | null | undefined;
  className?: string;
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const config = (role && ROLE_CONFIG[role]) || null;
  return (
    <span
      className={cn(
        "text-xs font-semibold px-2.5 py-1 rounded-full border",
        config ? config.classes : FALLBACK.classes,
        className,
      )}
    >
      {config ? config.label : role || "Unknown"}
    </span>
  );
}
