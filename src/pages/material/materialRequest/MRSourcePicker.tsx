// "Source document" on a new Material Request: pick an approved BOQ or Work Order and the form fills with its
// materials. A BOQ and the Work Orders made from it share one request, so a document that already has one,
// or whose BOQ / Work Order does, is listed but can't be picked (the reason is shown).
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getMRSourceOptions,
  getMaterialRequestPrefillFromWO,
  getMaterialRequestPrefillFromBoq,
  MaterialRequestExistsError,
} from "@/api/workOrderApi";
import { selectCls, LBL } from "./config";
import type { MRState } from "./useMaterialRequest";

type Kind = "" | "boq" | "wo";

export function MRSourcePicker({ m }: { m: MRState }) {
  const { woSource, setWoSource, applySourcePrefill } = m;
  const [kind, setKind] = useState<Kind>(woSource?.kind ?? "");
  const [loading, setLoading] = useState(false);
  // Follow the form: opened from a BOQ / Work Order page, or cleared by Reset.
  useEffect(() => {
    if (woSource) setKind(woSource.kind);
  }, [woSource]);

  const { data: options = [], isLoading } = useQuery({
    queryKey: ["mr-source-options", kind],
    queryFn: () => getMRSourceOptions(kind as "wo" | "boq"),
    enabled: kind !== "",
    staleTime: 0,
  });

  const pick = async (idStr: string) => {
    if (!idStr || !kind) return;
    const id = parseInt(idStr, 10);
    setLoading(true);
    try {
      if (kind === "wo") applySourcePrefill("wo", await getMaterialRequestPrefillFromWO(id), true);
      else applySourcePrefill("boq", await getMaterialRequestPrefillFromBoq(id), true);
    } catch (err: unknown) {
      toast.error(err instanceof MaterialRequestExistsError || err instanceof Error ? err.message : "Could not load its materials.");
    } finally {
      setLoading(false);
    }
  };

  const selected = woSource && woSource.kind === kind ? String(woSource.id) : "";
  const blockedCount = options.filter((o) => !o.available).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
      <div className="space-y-1.5">
        <span className={LBL}>Source document</span>
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as Kind;
            setKind(k);
            // Back to a plain request: keep the items as they are, just drop the link.
            if (k === "" || (woSource && woSource.kind !== k)) setWoSource(null);
          }}
          className={selectCls}
        >
          <option value="">None — direct request</option>
          <option value="boq">BOQ</option>
          <option value="wo">Work Order</option>
        </select>
      </div>
      {kind !== "" && (
        <div className="space-y-1.5 min-w-0">
          <span className={LBL}>{kind === "boq" ? "Approved BOQ" : "Approved Work Order"}</span>
          <select
            value={selected}
            onChange={(e) => void pick(e.target.value)}
            disabled={isLoading || loading}
            className={selectCls}
          >
            <option value="">
              {isLoading ? "Loading…" : loading ? "Filling the items…" : options.length ? "Select…" : `No approved ${kind === "boq" ? "BOQs" : "work orders"}`}
            </option>
            {options.map((o) => (
              <option key={o.id} value={String(o.id)} disabled={!o.available}>
                {(o.docNo || `#${o.id}`) + (o.projectName ? ` · ${o.projectName}` : "") + (o.available ? "" : ` — ${o.reason}`)}
              </option>
            ))}
          </select>
          {blockedCount > 0 && (
            <p className="text-[0.6875rem] text-muted-foreground">
              Unavailable entries already have a material request. A BOQ and the work orders raised from it share one request.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
