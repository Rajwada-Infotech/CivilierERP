import { ShieldCheck, Search } from "lucide-react";
import type { MenuRightsState } from "./useMenuRights";

// Above the table: who is selected, counts, search, module filter, presets and bulk actions.
export function RightsToolbar({ m }: { m: MenuRightsState }) {
  const { subject, pageSearch, setPageSearch, moduleFilter, setModuleFilter, dirty, selectedUser, selectedRole, modules, stats } = m;
  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 px-5 py-3.5 border-b border-border bg-card/60">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Subject badge */}
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-primary" />
              <span className="text-sm font-heading font-semibold text-foreground">
                {subject === "user" ? selectedUser?.name : selectedRole?.RName}
              </span>
              <span className="text-[0.625rem] font-heading px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground capitalize">
                {subject === "user"
                  ? selectedUser?.role.replace(/_/g, " ")
                  : "role baseline"}
              </span>
            </div>
            {/* Stats */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                {stats.pagesGranted}/{stats.total} pages
              </span>
              <span className="px-2 py-0.5 rounded-full bg-muted border border-border">
                {stats.actionsGranted} actions
              </span>
              {dirty && (
                <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                  Unsaved
                </span>
              )}
            </div>
          </div>

          {/* Page search — its own line-item so it never squeezes the module chips */}
          <div className="relative w-44">
            <Search
              size={11}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              placeholder="Search page…"
              value={pageSearch}
              onChange={(e) => setPageSearch(e.target.value)}
              className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs bg-muted border border-border text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
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
                className={`px-2.5 py-1 text-[0.6875rem] rounded-lg border whitespace-nowrap transition-colors font-medium ${
                  moduleFilter === mod
                    ? mod === "All"
                      ? "btn-module text-white border-transparent font-semibold shadow-sm"
                      : mod === "General"
                        ? "bg-slate-500 text-white border-slate-500 font-semibold"
                        : mod === "Finance"
                          ? "bg-emerald-500 text-white border-emerald-500 font-semibold"
                          : mod === "Material"
                            ? "bg-blue-500 text-white border-blue-500 font-semibold"
                            : mod === "Engineering"
                              ? "bg-orange-500 text-white border-orange-500 font-semibold"
                              : mod === "Follow-Up"
                                ? "btn-module text-white border-purple-500 font-semibold"
                                : mod === "Ticket"
                                  ? "bg-red-500 text-white border-red-500 font-semibold"
                                  : mod === "Sales"
                                    ? "bg-pink-500 text-white border-pink-500 font-semibold"
                                    : mod === "Masters"
                                      ? "bg-cyan-500 text-white border-cyan-500 font-semibold"
                                      : mod === "Reports"
                                        ? "bg-yellow-500 text-white border-yellow-500 font-semibold"
                                        : "btn-module text-white border-transparent font-semibold shadow-sm"
                    : mod === "All"
                      ? "border-border bg-muted text-muted-foreground hover:bg-muted/80"
                      : mod === "General"
                        ? "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400 hover:bg-slate-500/20"
                        : mod === "Finance"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                          : mod === "Material"
                            ? "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20"
                            : mod === "Engineering"
                              ? "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20"
                              : mod === "Follow-Up"
                                ? "border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20"
                                : mod === "Ticket"
                                  ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
                                  : mod === "Sales"
                                    ? "border-pink-500/30 bg-pink-500/10 text-pink-600 dark:text-pink-400 hover:bg-pink-500/20"
                                    : mod === "Masters"
                                      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20"
                                      : mod === "Reports"
                                        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20"
                                        : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
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
