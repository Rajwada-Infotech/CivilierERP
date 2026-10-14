import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

// The title block: what this is, then the search line itself.
export function CompassSearchHead({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  return (
    <div className="c-head">
      <p className="c-label">CivilierERP · Compass</p>
      <div className="c-search">
        <Search size={18} strokeWidth={1.75} />
        <CommandPrimitive.Input
          autoFocus
          value={query}
          onValueChange={onQuery}
          placeholder="Search pages… try “invoice”, “brs”, “finance po”"
        />
      </div>
    </div>
  );
}
