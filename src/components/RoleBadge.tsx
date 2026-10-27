import { cn } from "../lib/utils";

// Single shared source for SA role name -> label, so a role renders the same way everywhere it appears
// (SaTeamManagement's team accordion, etc.). On the sheet the rank reads off the tag: the head in solid ink, a team
// lead ruled in ink, a sales person ruled faint.
const ROLE_CONFIG: Record<string, { label: string; classes: string }> = {
  marketing_head: { label: "Marketing Head", classes: "bg-foreground text-card border-foreground" },
  sales_team_lead: { label: "Sales Team Lead", classes: "text-foreground border-foreground" },
  sales_person: { label: "Sales Person", classes: "text-foreground border-foreground/30" },
};

const FALLBACK = {
  classes: "text-muted-foreground border-foreground/20",
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
        "inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 border whitespace-nowrap",
        config ? config.classes : FALLBACK.classes,
        className,
      )}
    >
      {config ? config.label : role || "Unknown"}
    </span>
  );
}
