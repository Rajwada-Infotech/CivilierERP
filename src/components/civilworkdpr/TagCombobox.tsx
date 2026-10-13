import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Tag as TagIcon, X } from "lucide-react";
import { getDprTags } from "@/api/dprTagMasterApi";

/**
 * Tag picker for an activity: search the existing tags, or type a new name and use it — a new tag is
 * saved to the DPR Tag Master when the activity is saved. `value` is the tag's name ("" = no tag).
 */
export function TagCombobox({
  value,
  onChange,
  disabled,
  placeholder = "Search or type a new tag…",
}: {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { data: tags = [] } = useQuery({ queryKey: ["dpr-tags"], queryFn: getDprTags, staleTime: 30_000 });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const box = useRef<HTMLDivElement>(null);

  // Follow the parent when it loads / resets the value.
  useEffect(() => setText(value), [value]);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const q = text.trim().toLowerCase();
  const matches = useMemo(
    () => tags.filter((t) => t.isActive && (!q || t.tagName.toLowerCase().includes(q))).slice(0, 50),
    [tags, q],
  );
  const exact = tags.some((t) => t.tagName.toLowerCase() === q);

  const pick = (name: string) => {
    onChange(name);
    setText(name);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <div className="relative">
        <TagIcon size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          maxLength={100}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            onChange(e.target.value); // typing a new name IS choosing it
            setOpen(true);
          }}
          className={`w-full text-sm rounded-lg border pl-8 pr-8 py-2.5 transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
            disabled ? "border-border bg-muted/40 text-muted-foreground cursor-not-allowed opacity-60" : "border-border bg-background text-foreground"
          }`}
        />
        {text && !disabled && (
          <button type="button" onClick={() => pick("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear tag">
            <X size={13} />
          </button>
        )}
      </div>
      {open && !disabled && (matches.length > 0 || (q && !exact)) && (
        <ul className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border bg-popover shadow-lg text-sm">
          {matches.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => pick(t.tagName)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/60">
                <span>{t.tagName}</span>
                {t.tagName.toLowerCase() === value.trim().toLowerCase() && <Check size={13} className="text-emerald-500" />}
              </button>
            </li>
          ))}
          {q && !exact && (
            <li>
              <button type="button" onClick={() => pick(text.trim())} className="w-full flex items-center gap-2 px-3 py-2 text-left text-cyan-600 dark:text-cyan-400 hover:bg-muted/60 border-t border-border/60">
                <Plus size={13} /> Add new tag “{text.trim()}”
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
