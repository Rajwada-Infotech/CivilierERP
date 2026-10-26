import React from "react";
import { Link } from "react-router-dom";
import { Users, Megaphone, GitBranch } from "lucide-react";

// The 3 SA dashboards (Sales/Marketing/Team Lead) had real, distinct scopes
// but nothing in any of them said so, and none linked to the others — a
// user landing on one had no way to discover the other two exist or how
// their numbers differ. One shared pill strip, used on all three.
const DASHBOARDS = [
  { key: "sales", label: "Sales", path: "/sales-automation/dashboard/sales", icon: Users },
  { key: "marketing", label: "Marketing", path: "/sales-automation/dashboard/marketing", icon: Megaphone },
  { key: "team-lead", label: "Team Lead", path: "/sales-automation/dashboard/team-lead", icon: GitBranch },
] as const;

export const SaDashboardNav: React.FC<{ active: "sales" | "marketing" | "team-lead" }> = ({ active }) => (
  <div className="flex items-center gap-1 p-1 rounded-lg border border-border bg-muted/30 w-fit">
    {DASHBOARDS.map(({ key, label, path, icon: Icon }) => (
      key === active ? (
        <span key={key} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-background text-foreground shadow-sm">
          <Icon size={12} /> {label}
        </span>
      ) : (
        <Link key={key} to={path}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
          <Icon size={12} /> {label}
        </Link>
      )
    ))}
  </div>
);
