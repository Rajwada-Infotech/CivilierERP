// Under a write: the record it touched, and on request the values that were submitted.
import React, { useState } from "react";
import type { Described } from "./describeActivity";
import { fieldLabel } from "./describeActivity";
import { LBL } from "./activityShared";

const text = (v: unknown) => (v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${fieldLabel(k)}: ${x}`).join(" · ") : String(v));

export const ChangeDetails: React.FC<{ d: Described }> = ({ d }) => {
  const [open, setOpen] = useState(false);
  const has = !!(d.fields?.length || d.files?.length);
  if (!d.record && !has) return null;
  return (
    <div className="text-[0.6875rem] text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-3">
        {d.record && <span className="font-heading tabular-nums text-foreground">{d.record}</span>}
        {has && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="underline underline-offset-2 hover:text-foreground">
            {open ? "Hide what was entered" : "Show what was entered"}
          </button>
        )}
      </p>
      {open && (
        <dl className="mt-1.5 grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1 border-l border-foreground/25 pl-3">
          {d.fields?.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className={LBL}>{fieldLabel(k)}</dt>
              <dd className="min-w-0 break-words text-foreground">
                {Array.isArray(v) ? (
                  <ol className="list-decimal pl-4 space-y-0.5">
                    {v.map((line, i) => (
                      <li key={i}>{text(line)}</li>
                    ))}
                  </ol>
                ) : (
                  text(v)
                )}
              </dd>
            </React.Fragment>
          ))}
          {d.files?.length ? (
            <>
              <dt className={LBL}>Files</dt>
              <dd className="text-foreground">{d.files.join(", ")}</dd>
            </>
          ) : null}
        </dl>
      )}
    </div>
  );
};
