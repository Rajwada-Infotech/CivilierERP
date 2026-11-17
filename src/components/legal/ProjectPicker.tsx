import type React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLegalLookup } from "@/api/legalMastersApi";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const KEY = "legal.projectId";
const SCOPE_KEY = "legal.projectScope";

export type ProjectScope = number | "all" | "none";
type ScopeInput = number | null | "all" | "none";

// One project scope for the whole Legal module, picked in the page header (top right). Every Legal page reads it, so
// changing it changes every list at once. Remembered between visits; a link's ?project= (dashboard reports) wins.
const parse = (v: string | null): ProjectScope | null => (v === "all" || v === "none" ? v : Number(v) > 0 ? Number(v) : null);
let current: ProjectScope = (() => {
  try { return parse(new URLSearchParams(window.location.search).get("project")) ?? parse(localStorage.getItem(SCOPE_KEY)) ?? parse(localStorage.getItem(KEY)) ?? "all"; }
  catch { return "all"; }
})();
const listeners = new Set<() => void>();
export function setLegalScope(v: ScopeInput) {
  const next: ProjectScope = v ?? "all";
  if (next === current) return;
  current = next;
  try { localStorage.setItem(SCOPE_KEY, String(next)); if (typeof next === "number") localStorage.setItem(KEY, String(next)); } catch { /* storage off */ }
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** The Legal module's project scope: `inScope(row.ProjectId)` tells whether a row belongs to what is picked. */
export function useProjectScope(): { scope: ProjectScope; setScope: (id: ScopeInput) => void; inScope: (projectId: unknown) => boolean } {
  const scope = useSyncExternalStore(subscribe, () => current);
  const inScope = (projectId: unknown) => {
    const p = Number(projectId) || 0;
    return scope === "all" ? true : scope === "none" ? !p : p === scope;
  };
  return { scope, setScope: setLegalScope, inScope };
}

/** Header picker (top right of every Legal page). A link's ?project= is applied when the page opens. */
export function LegalProjectSwitch() {
  const { scope } = useProjectScope();
  useEffect(() => { const v = parse(new URLSearchParams(window.location.search).get("project")); if (v !== null) setLegalScope(v); }, []);
  return <ProjectPicker value={scope} onChange={setLegalScope} allowAll compact />;
}

/**
 * Project picker with search: type to narrow the list (by name), pick with a click or the keyboard.
 * `allowAll`: offer "All projects" (value "all") — for pages that read across projects.
 */
export function ProjectPicker({ value, onChange, allowAll, compact, children }: { value: number | "all" | "none" | null; onChange: (id: number | null | "all" | "none") => void; allowAll?: boolean; compact?: boolean; children?: React.ReactNode }) {
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["legal-lookup", "project"], queryFn: () => getLegalLookup("project"), staleTime: 5 * 60_000 });
  const [open, setOpen] = useState(false);
  const shown = value === "all" ? "All projects" : value === "none" ? "Without a project" : projects.find((p) => Number(p.value) === value)?.label;
  const pick = (v: number | "all" | "none") => { onChange(v); setOpen(false); };
  return (
    <div className={compact ? "flex items-center gap-2" : "mb-4 flex flex-wrap items-center gap-3 border border-border bg-card px-4 py-3"}>
      <span className={compact ? "label" : "text-sm font-semibold"}>Project</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" role="combobox" aria-expanded={open}
            className="flex h-9 min-w-[16rem] max-w-full items-center justify-between gap-2 border border-border bg-background px-2 text-left text-sm">
            <span className={`truncate ${shown ? "" : "text-muted-foreground"}`}>{shown ?? (isLoading ? "Loading…" : "Select a project…")}</span>
            <ChevronsUpDown size={14} className="shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,90vw)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search project…" />
            <CommandList>
              <CommandEmpty>No project found</CommandEmpty>
              <CommandGroup>
                {allowAll && (
                  <CommandItem value="All projects" onSelect={() => pick("all")}>
                    <Check size={14} className={`mr-2 ${value === "all" ? "opacity-100" : "opacity-0"}`} /> All projects
                  </CommandItem>
                )}
                {allowAll && (
                  <CommandItem value="Without a project" onSelect={() => pick("none")}>
                    <Check size={14} className={`mr-2 ${value === "none" ? "opacity-100" : "opacity-0"}`} /> Without a project
                  </CommandItem>
                )}
                {projects.map((p) => (
                  <CommandItem key={String(p.value)} value={`${p.label} ${p.value}`} onSelect={() => pick(Number(p.value))}>
                    <Check size={14} className={`mr-2 ${Number(p.value) === value ? "opacity-100" : "opacity-0"}`} /> {p.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {!value && <span className="text-xs text-amber-600">Select the project first</span>}
      {children}
    </div>
  );
}

