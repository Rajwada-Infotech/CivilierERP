import React from "react";
import { Check } from "lucide-react";
import { ALL_ACTIONS, MODULE_COLORS } from "./config";
import type { MenuRightsState } from "./useMenuRights";

// The page × action grid.
export function RightsTable({ m }: { m: MenuRightsState }) {
  const { TIER_ORDER, groupedPages, isChecked, togglePermission, toggleAllForPage, toggleGroup } = m;
  return (
    <>
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border text-xs uppercase tracking-wide">
              <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground min-w-0 sm:min-w-[240px]">
                Menu / Page
              </th>
              {ALL_ACTIONS.map((a) => (
                <th
                  key={a.key}
                  className="px-3 py-3 font-heading font-semibold text-muted-foreground text-center min-w-[64px]"
                >
                  {a.label}
                </th>
              ))}
              <th className="px-3 py-3 font-heading font-semibold text-muted-foreground text-center min-w-[64px]">
                All
              </th>
            </tr>
          </thead>
          <tbody>
            {groupedPages.map(([group, pages], groupIdx) => {
              // Dashboards/Setup deliberately mix every module in one
              // list — a single group-level module badge would be
              // misleading there, so each row gets its own instead.
              const isCrossModuleTier = TIER_ORDER.includes(group);
              const groupModule = pages[0]?.module ?? "General";
              const colorClass =
                MODULE_COLORS[groupModule] ??
                "bg-muted/30 text-muted-foreground";
              const allGroupChecked = pages.every((p) =>
                p.actions.every((a) => isChecked(p.key, a)),
              );
              // First non-tier group after the two universal ones —
              // marks where "module-wise pages" actually starts.
              const isFirstModuleWiseGroup =
                !isCrossModuleTier &&
                groupedPages.slice(0, groupIdx).every(([g]) => TIER_ORDER.includes(g));

              return (
                <React.Fragment key={group}>
                  {isFirstModuleWiseGroup && (
                    <tr>
                      <td colSpan={ALL_ACTIONS.length + 2} className="px-5 pt-5 pb-1">
                        <span className="text-[0.625rem] font-heading font-bold uppercase tracking-[0.2em] text-muted-foreground/50">
                          Module Pages
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Group header */}
                  <tr>
                    <td
                      colSpan={ALL_ACTIONS.length + 2}
                      className="px-5 py-2 border-y border-border/50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {!isCrossModuleTier && (
                            <span
                              className={`text-[0.625rem] font-heading font-bold px-2 py-0.5 rounded-full border ${colorClass}`}
                            >
                              {groupModule}
                            </span>
                          )}
                          <span className="text-[0.6875rem] font-heading font-semibold text-foreground uppercase tracking-wider">
                            {group}
                          </span>
                          {isCrossModuleTier && (
                            <span className="text-[0.625rem] text-muted-foreground/50">
                              · every module
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => toggleGroup(pages)}
                          className={`text-[0.625rem] px-2.5 py-0.5 rounded-full border transition-colors ${
                            allGroupChecked
                              ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                              : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                          }`}
                        >
                          {allGroupChecked ? "Revoke all" : "Grant all"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Page rows */}
                  {pages.map((page) => {
                    const checkedCount = page.actions.filter((a) =>
                      isChecked(page.key, a),
                    ).length;
                    const allChecked =
                      checkedCount === page.actions.length;
                    const someChecked = checkedCount > 0 && !allChecked;
                    const rowColorClass =
                      MODULE_COLORS[page.module] ?? "bg-muted/30 text-muted-foreground";

                    return (
                      <tr
                        key={page.key}
                        className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                      >
                        <td className="px-5 py-2.5 text-sm font-body text-foreground pl-10">
                          <span className="flex items-center gap-2">
                            {page.label}
                            {isCrossModuleTier && (
                              <span
                                className={`text-[0.5625rem] font-heading font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${rowColorClass}`}
                              >
                                {page.module}
                              </span>
                            )}
                          </span>
                        </td>
                        {ALL_ACTIONS.map((action) => {
                          const available = page.actions.includes(
                            action.key,
                          );
                          const checked = isChecked(page.key, action.key);
                          return (
                            <td
                              key={action.key}
                              className="px-3 py-2.5 text-center"
                            >
                              {available ? (
                                <button
                                  onClick={() =>
                                    togglePermission(page.key, action.key)
                                  }
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-all ${
                                    checked
                                      ? "btn-module border-primary text-white shadow-sm"
                                      : "border-border bg-muted hover:border-primary/50"
                                  }`}
                                >
                                  {checked && (
                                    <Check className="w-3 h-3" />
                                  )}
                                </button>
                              ) : (
                                <span className="inline-flex items-center justify-center w-5 h-5 rounded border border-border/30 bg-muted/20">
                                  <span className="w-1.5 h-px bg-border/40 block rounded" />
                                </span>
                              )}
                            </td>
                          );
                        })}
                        {/* All toggle */}
                        <td className="px-3 py-2.5 text-center">
                          <button
                            onClick={() =>
                              toggleAllForPage(page.key, page.actions)
                            }
                            className={`inline-flex items-center justify-center w-5 h-5 rounded border transition-all ${
                              allChecked
                                ? "btn-module border-primary text-white shadow-sm"
                                : someChecked
                                  ? "bg-primary/20 border-primary/40"
                                  : "border-border bg-muted hover:border-primary/50"
                            }`}
                          >
                            {allChecked && <Check className="w-3 h-3" />}
                            {someChecked && (
                              <span className="w-2 h-0.5 bg-primary block rounded" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
