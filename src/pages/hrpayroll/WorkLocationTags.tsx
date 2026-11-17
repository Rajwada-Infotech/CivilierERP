// Employee Master field: tag the employee to any number of Work Locations (chips, click to add or remove).
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { getWorkLocations } from "@/api/workLocationMasterApi";

export function WorkLocationTags({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ["work-location-master"], queryFn: getWorkLocations, staleTime: 60 * 1000 });
  const all = Array.isArray(data) ? data : [];
  // Inactive locations are offered only if the employee is already tagged to one.
  const list = all.filter((l) => l.IsActive || value.includes(String(l.LocationId)));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1"><MapPin size={12} /> Work Locations <span className="font-normal">(select one or more)</span></p>
      {isLoading ? <p className="text-xs text-muted-foreground">Loading…</p>
        : isError ? <p className="text-xs text-destructive">Could not load work locations.</p>
        : !list.length ? <p className="text-xs text-muted-foreground">No work locations yet. Add them under Setup → Work Location.</p>
        : (
          <div className="flex flex-wrap gap-2">
            {list.map((l) => {
              const id = String(l.LocationId);
              const on = value.includes(id);
              return (
                <button key={id} type="button" onClick={() => toggle(id)} aria-pressed={on}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary"}`}>
                  {l.LocationName} ({l.LocationCode}){l.IsActive ? "" : " - inactive"}
                </button>
              );
            })}
          </div>
        )}
    </div>
  );
}
