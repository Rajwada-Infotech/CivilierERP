import React, { useEffect, useRef, useState } from "react";
import { useInSheet } from "@/components/sheet/useInSheet";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Search, Check } from "lucide-react";

interface GLOption {
  id: number;
  label: string;
  code: string | null;
}

/**
 * Custom MasterPage field — lets a Cost Center / Profit Center tag the GL
 * accounts (dbo.AccountHeadMaster WHERE LHeadType='GL') that belong to it.
 * Value is a string[] of LHeadIds. MasterPage's built-in "multiselect" type
 * only supports a static string[] of labels, not id-backed async options, so
 * this is wired up as a "custom" field instead.
 */
export const GLAccountMultiSelect: React.FC<{
  value: unknown;
  onChange: (v: unknown) => void;
}> = ({ value, onChange }) => {
  const [options, setOptions] = useState<GLOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // On a drawing-sheet page the control is squared and inked to match; elsewhere it is drawn as before.
  const rootRef = useRef<HTMLDivElement>(null);
  const sheet = useInSheet(rootRef);

  useEffect(() => {
    fetchWithAuth("/api/general-ledger/options")
      .then((res) => res.json().catch(() => ({})))
      .then((data: GLOption[]) => setOptions(Array.isArray(data) ? data : []))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, []);

  const selected = (value as string[]) || [];
  const toggle = (id: number) => {
    const idStr = String(id);
    const next = selected.includes(idStr)
      ? selected.filter((x) => x !== idStr)
      : [...selected, idStr];
    onChange(next);
  };

  const filtered = options.filter(
    (o) =>
      !search ||
      o.label.toLowerCase().includes(search.toLowerCase()) ||
      o.code?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div ref={rootRef} className={sheet ? "border border-foreground/40 bg-card overflow-hidden" : "rounded-lg border border-border bg-muted/20 overflow-hidden"}>
      <div className={`relative p-2 border-b ${sheet ? "border-foreground/40" : "border-border"}`}>
        <Search
          size={13}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search GL accounts…"
          className={sheet
            ? "w-full pl-7 pr-2 py-1.5 text-xs bg-card border border-foreground/40 focus:border-foreground text-foreground focus:outline-none"
            : "w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary/30"}
        />
      </div>
      <div className="max-h-48 overflow-y-auto p-2">
        {loading ? (
          <p className="text-xs text-muted-foreground px-2 py-3">
            Loading GL accounts…
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-3">
            No matching GL accounts.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {filtered.map((o) => {
              const isSelected = selected.includes(String(o.id));
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  aria-pressed={isSelected}
                  className={sheet
                    ? `flex items-center gap-1.5 px-2.5 py-1.5 text-[0.6875rem] border transition-colors ${
                        isSelected ? "bg-foreground text-card border-foreground" : "text-foreground border-foreground/40 hover:border-foreground"
                      }`
                    : `flex items-center gap-1 px-2.5 py-1 rounded-full text-[0.6875rem] font-heading border transition-all ${
                    isSelected
                      ? "btn-module text-white border-primary"
                      : "bg-background text-muted-foreground border-border hover:border-primary/50"
                  }`}
                >
                  {isSelected && <Check size={10} />}
                  {o.label}
                  {o.code ? <span className="opacity-70">({o.code})</span> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {selected.length > 0 && (
        <p className={sheet ? "px-3 py-1.5 text-[0.6875rem] text-foreground font-medium border-t border-foreground/40" : "px-3 py-1.5 text-[0.6875rem] text-muted-foreground border-t border-border bg-muted/30"}>
          {selected.length} GL account{selected.length === 1 ? "" : "s"} tagged
        </p>
      )}
    </div>
  );
};
