import React, { useEffect, useState } from "react";

/**
 * A master dropdown with "Other…": picking Other (or a list value named "Other") opens a box to type the value.
 * The typed value is sent as "new:<text>"; on save the server finds it in that master or adds it there, so it is
 * offered in the list next time.
 */
export function OtherSelect({ value, options, onChange, className, inputClassName, error }: {
  value: unknown; options: { value: string; label: string }[]; onChange: (v: string) => void;
  className?: string; inputClassName?: string; error?: boolean;
}) {
  const v = String(value ?? "");
  const typed = v.startsWith("new:");
  const isOtherOpt = (val: string) => /^other$/i.test(options.find((o) => o.value === val)?.label.trim() ?? "");
  const [open, setOpen] = useState(typed);
  useEffect(() => { if (typed) setOpen(true); }, [typed]);
  const text = typed ? v.slice(4) : "";
  const known = text.trim() && options.find((o) => o.label.trim().toLowerCase() === text.trim().toLowerCase());
  return (
    <div>
      <select className={`${className ?? ""} ${error ? "border-destructive" : ""}`} value={open ? "__other" : v}
        onChange={(e) => {
          const x = e.target.value;
          if (x === "__other" || isOtherOpt(x)) { setOpen(true); onChange(""); return; }
          setOpen(false); onChange(x);
        }}>
        <option value="">Select…</option>
        {options.filter((o) => !/^other$/i.test(o.label.trim())).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value="__other">Other…</option>
      </select>
      {open && (
        <>
          <input autoFocus className={`mt-1 ${inputClassName ?? className ?? ""}`} placeholder="Type the new value" maxLength={150} value={text}
            onChange={(e) => onChange(e.target.value.trim() ? `new:${e.target.value}` : "")} />
          <p className="mt-1 text-[0.6875rem] text-muted-foreground">
            {known ? `"${known.label}" is already in the list — it will be used.` : "It will be added to this master list when you save."}
          </p>
        </>
      )}
    </div>
  );
}
