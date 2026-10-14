import { ShieldCheck, Search } from "lucide-react";
import type { MenuRightsState } from "./useMenuRights";

// Above the table: who is selected, counts, search, module filter, presets and bulk actions.
export function RightsToolbar({ m }: { m: MenuRightsState }) {
  const { subject, pageSearch, setPageSearch, moduleFilter, setModuleFilter, dirty, selectedUser, selectedRole, modules, stats } = m;
  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 px-4 py-3 border-b border-foreground">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Subject badge */}
            <div className="flex items-center gap-2">
              <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
                {subject === "user" ? selectedUser?.name : selectedRole?.RName}
              </span>
              <span className="inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap text-muted-foreground border-foreground/30 capitalize">
                {subject === "user"
                  ? selectedUser?.role.replace(/_/g, " ")
                  : "role baseline"}
              </span>
            </div>
            {/* Stats */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                <span className="font-heading font-semibold tabular-nums text-foreground">{stats.pagesGranted}</span> of {stats.total} pages
              </span>
              <span>
                <span className="font-heading font-semibold tabular-nums text-foreground">{stats.actionsGranted}</span> actions
              </span>
              {dirty && (
                <span className="inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap text-foreground border-dashed border-foreground">
                  Unsaved
                </span>
              )}
            </div>
          </div>

          {/* Page search — its own line-item so it never squeezes the module chips */}
          <div className="relative w-52">
            <Search
              size={11}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              placeholder="Search page…"
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              className="w-full h-8 pl-7 pr-3 text-xs bg-card border border-foreground/40 focus:border-foreground text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
          </div>
        </div>

        {/* Module filter — wraps across lines instead of clipping/scrolling
            horizontally, so every module chip stays reachable without a
            hidden scrollbar (Sales Automation etc. no longer cut off). */}
        <div className="flex items-center gap-1.5 flex-wrap">
            {modules.map((mod) => (
              <button
                key={mod}
                onClick={() => setModuleFilter(mod)}
                aria-pressed={moduleFilter === mod}
                className={`h-7 px-2.5 border whitespace-nowrap font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  moduleFilter === mod
                    ? "bg-foreground text-card border-foreground"
                    : "border-foreground/40 text-muted-foreground hover:text-foreground hover:border-foreground"
                }`}
              >
                {mod}
              </button>
            ))}
          </div>
      </div>
    </>
  );
}
