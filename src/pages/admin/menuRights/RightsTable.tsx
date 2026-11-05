import React from "react";
import { Check } from "lucide-react";
import { ALL_ACTIONS } from "./config";
import type { MenuRightsState } from "./useMenuRights";

// The page × action grid.
export function RightsTable({ m }: { m: MenuRightsState }) {
  const { TIER_ORDER, groupedPages, isChecked, togglePermission, toggleAllForPage, toggleGroup } = m;
  return (
    <>
      {/* Table — scrolls in its own box so the action bar stays pinned above the rows. */}
      <div className="overflow-auto max-h-[calc(100dvh-13rem)] min-h-[16rem] thin-scroll">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-card" style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground))" }}>
            <tr className="font-heading text-[0.5625rem] uppercase tracking-[0.12em]">
              <th className="text-left px-5 py-3 font-heading font-semibold text-muted-foreground min-w-[200px] sm:min-w-[240px] bg-card">
                Menu / Page
              </th>
              {ALL_ACTIONS.map((a) => (
                <th
                  key={a.key}
                  className="px-3 py-3 font-heading font-semibold text-muted-foreground text-center min-w-[64px] whitespace-nowrap bg-card"
                >
                  {a.label}
                </th>
              ))}
              <th className="px-3 py-3 font-heading font-semibold text-muted-foreground text-center min-w-[64px] bg-card">
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
                        <span className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">
                          Module Pages
                        </span>
                      </td>
                    </tr>
                  )}

                  {/* Group header */}
                  <tr>
                    <td
                      colSpan={ALL_ACTIONS.length + 2}
                      className="px-5 py-2 border-b border-foreground/40"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {!isCrossModuleTier && (
                            <span
                              className="inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap text-foreground border-foreground/50"
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
                          className={`h-7 px-2.5 border font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            allGroupChecked
                              ? "border-foreground/40 text-muted-foreground hover:text-destructive hover:border-destructive"
                              : "border-foreground text-foreground hover:bg-primary/10"
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

                    return (
                      <tr
                        key={page.key}
                        className="hover:bg-primary/5 transition-colors [&>td]:border-b [&>td]:border-foreground/10"
                      >
                        <td className="px-5 py-2.5 text-sm font-body text-foreground pl-10">
                          <span className="flex items-center gap-2">
                            {page.label}
                            {isCrossModuleTier && (
                              <span
                                className="inline-flex items-center font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap text-muted-foreground border-foreground/30 shrink-0"
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
                                  role="checkbox"
                                  aria-checked={checked}
                                  aria-label={`${action.label} — ${page.label}`}
                                  className={`inline-flex items-center justify-center w-5 h-5 border transition-colors ${
                                    checked ? "bg-foreground border-foreground text-card" : "border-foreground/40 bg-card hover:border-foreground"
                                  }`}
                                >
                                  {checked && (
                                    <Check className="w-3 h-3" />
                                  )}
                                </button>
                              ) : (
                                <span className="inline-flex items-center justify-center w-5 h-5" title="Not offered on this page">
                                  <span className="w-2 h-px bg-foreground/25 block" />
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
                            role="checkbox"
                            aria-checked={allChecked ? true : someChecked ? "mixed" : false}
                            aria-label={`Every action — ${page.label}`}
                            className={`inline-flex items-center justify-center w-5 h-5 border transition-colors ${
                              allChecked ? "bg-foreground border-foreground text-card" : someChecked ? "border-foreground bg-card" : "border-foreground/40 bg-card hover:border-foreground"
                            }`}
                          >
                            {allChecked && <Check className="w-3 h-3" />}
                            {someChecked && (
                              <span className="w-2 h-0.5 bg-foreground block" />
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
