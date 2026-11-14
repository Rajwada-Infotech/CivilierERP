import type React from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLegalLookup } from "@/api/legalMastersApi";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

const KEY = "legal.projectId";

/** The project the Legal pages work under (Land Enquiries, Deed Registry Search). Remembered between pages. */
export function useLegalProject(): [number | null, (id: number | null) => void] {
  // A project named in the link (?project=, e.g. from the dashboard report) wins over the remembered one.
  const [id, setId] = useState<number | null>(() => {
    const fromUrl = Number(new URLSearchParams(window.location.search).get("project"));
    if (fromUrl > 0) return fromUrl;
    try { const v = Number(localStorage.getItem(KEY)); return v > 0 ? v : null; } catch { return null; }
  });
  useEffect(() => {
    try { if (id) localStorage.setItem(KEY, String(id)); else localStorage.removeItem(KEY); } catch { /* storage off */ }
  }, [id]);
  return [id, setId];
}

/**
 * Project picker with search: type to narrow the list (by name), pick with a click or the keyboard.
 * `allowAll`: offer "All projects" (value "all") — for pages that read across projects.
 */
export function ProjectPicker({ value, onChange, allowAll, children }: { value: number | "all" | null; onChange: (id: number | null | "all") => void; allowAll?: boolean; children?: React.ReactNode }) {
  const { data: projects = [], isLoading } = useQuery({ queryKey: ["legal-lookup", "project"], queryFn: () => getLegalLookup("project"), staleTime: 5 * 60_000 });
  const [open, setOpen] = useState(false);
  const shown = value === "all" ? "All projects" : projects.find((p) => Number(p.value) === value)?.label;
  const pick = (v: number | "all") => { onChange(v); setOpen(false); };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 border border-border bg-card px-4 py-3">
      <span className="text-sm font-semibold">Project</span>
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
