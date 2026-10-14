// Choosing which module a workflow is for, grouped by area.
import React from "react";
import { ChevronDown, Check, Package, HardHat, Wallet, ShoppingBag, Home, Layers, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MODULE_OPTIONS, MODULE_GROUPS } from "./config";

// Each area drawn with an ink line icon rather than its emoji.
const GROUP_ICON: Record<string, LucideIcon> = { material: Package, engineering: HardHat, finance: Wallet, sales: ShoppingBag, crm: Home };

// ─── Module group selector ─────────────────────────────────────────────────────

export function ModuleGroupSelector({
  selectedModules,
  toggleModule,
}: {
  selectedModules: string[];
  toggleModule: (id: string) => void;
}) {
  // Every group starts closed, even ones with areas already selected: the open list drops over the steps below it,
  // so it only opens when the chevron is clicked. (The count badge on each chip already shows what is selected.)
  const [openGroups, setOpenGroups] = React.useState<string[]>([]);

  const toggleGroup = (gid: string) =>
    setOpenGroups((prev) =>
      prev.includes(gid) ? prev.filter((x) => x !== gid) : [...prev, gid],
    );

  const toggleGroupAll = (g: (typeof MODULE_GROUPS)[number]) => {
    const allSelected = g.modules.every((mid) => selectedModules.includes(mid));
    g.modules.forEach((mid) => {
      const isSelected = selectedModules.includes(mid);
      if (allSelected && isSelected) toggleModule(mid);
      else if (!allSelected && !isSelected) toggleModule(mid);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      {MODULE_GROUPS.map((group) => {
        const isOpen = openGroups.includes(group.id);
        const groupMods = MODULE_OPTIONS.filter((m) =>
          (group.modules as readonly string[]).includes(m.id),
        );
        const selectedCount = groupMods.filter((m) =>
          selectedModules.includes(m.id),
        ).length;
        const allSelected = selectedCount === groupMods.length;
        const someSelected = selectedCount > 0 && !allSelected;

        return (
          <div key={group.id} className="relative">
            <div
              className={cn(
                "inline-flex items-center border transition-all overflow-visible",
                someSelected || allSelected
                  ? "border-foreground"
                  : "border-foreground/25",
              )}
            >
              <button
                type="button"
                onClick={() => toggleGroupAll(group)}
                title={allSelected ? "Deselect all" : "Select all"}
                className={cn(
                  "flex items-center gap-1.5 pl-3 pr-2 py-2 text-sm transition-colors",
                  allSelected
                    ? "text-foreground font-medium"
                    : someSelected
                      ? "text-foreground/70 font-medium"
                      : "text-muted-foreground hover:text-foreground",
                )}
              >
                {(() => { const GI = GROUP_ICON[group.id] ?? Layers; return <GI className="w-3.5 h-3.5 shrink-0" />; })()}
                <span>{group.label}</span>
                {selectedCount > 0 && (
                  <span className="font-heading text-[0.5625rem] font-bold tabular-nums bg-foreground text-card px-1.5 py-0.5">
                    {selectedCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={cn(
                  "px-2 py-2 border-l transition-colors",
                  isOpen
                    ? "border-foreground/40 text-foreground"
                    : "border-foreground/25 text-muted-foreground hover:text-foreground",
                )}
              >
                <ChevronDown
                  className={cn(
                    "w-3.5 h-3.5 transition-transform duration-200",
                    isOpen && "rotate-180",
                  )}
                />
              </button>
            </div>

            {isOpen && (
              <div className="absolute top-full left-0 mt-1 z-20 bg-card border border-foreground py-1 min-w-0 sm:min-w-[200px]" style={{ boxShadow: "5px 5px 0 hsl(var(--foreground) / 0.12)" }}>
                {groupMods.map((m) => {
                  const active = selectedModules.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleModule(m.id)}
                      title={m.desc}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left",
                        active
                          ? "text-foreground"
                          : "text-foreground",
                      )}
                    >
                      <span className="flex-1">{m.label}</span>
                      {active && (
                        <Check className="w-3.5 h-3.5 shrink-0 text-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
