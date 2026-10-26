// New tagging: pick received fixed-asset stock at a godown and generate that many FA Item Codes for it.
import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hash, Loader2 } from "lucide-react";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { createFixedAssetTagging, getEligibleAssetItems, type EligibleAssetItem } from "@/api/fixedAssetTaggingApi";
import { DateInput } from "@/components/ui/date-input";
import { godownMatches } from "../faImportValidation";
import { Block, Field, Figures, INP, KEY_INK, KEY_LINE, LBL, READ_ONLY, RULE } from "../record/config";
import { type TaggingPrefill, deriveFinYear, ensureArray, fmt, todayLocal } from "./config";

export function TaggingForm({ prefill, onClose }: { prefill: TaggingPrefill | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { finYears } = useFinYear();
  const [docDate, setDocDate] = useState(todayLocal());
  const [companyId, setCompanyId] = useState(prefill?.companyId ?? "");
  const [projectId, setProjectId] = useState(prefill?.projectId ?? "");
  const [godownId, setGodownId] = useState(prefill?.godownId ?? "");
  const [itemId, setItemId] = useState("");
  const [numberOfItems, setNumberOfItems] = useState(prefill?.numberOfItems ?? "");
  const [remarks, setRemarks] = useState("");
  const finYear = useMemo(() => deriveFinYear(docDate, finYears), [docDate, finYears]);

  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: allProjects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const { data: godownsData } = useQuery({ queryKey: ["godowns"], queryFn: getGodowns });
  // Untagged quantity is worked out per item and godown, so the items wait for a godown.
  const { data: eligibleItems = [], isLoading: loadingEligible } = useQuery({
    queryKey: ["fixed-asset-eligible-items", companyId, projectId, finYear, godownId],
    queryFn: () =>
      getEligibleAssetItems({
        godownId: Number(godownId),
        companyId: companyId ? Number(companyId) : undefined,
        projectId: projectId ? Number(projectId) : undefined,
        finYear: finYear || undefined,
      }),
    enabled: !!godownId,
  });

  const projects = useMemo(
    () => (companyId ? ensureArray<ProjectCompanyLike & { id: number; label: string }>(allProjects).filter((p) => projectBelongsToCompany(p, companyId)) : []),
    [allProjects, companyId],
  );
  const godowns = useMemo(
    () =>
      companyId
        ? ensureArray<Godown>(godownsData?.data)
            .filter((g) => !g.IsDeleted && g.IsActive)
            .filter((g) => godownMatches(g, Number(companyId), projectId ? Number(projectId) : null))
        : [],
    [godownsData, companyId, projectId],
  );
  const items = ensureArray<EligibleAssetItem>(eligibleItems);
  const selected = items.find((i) => i.ItemId === itemId) || null;

  // A batch's row opens the form on its item: pick it once the godown's items load (ids differ only in case).
  useEffect(() => {
    if (!prefill?.itemId || itemId || !items.length) return;
    const match = items.find((i) => i.ItemId.toLowerCase() === prefill.itemId.toLowerCase());
    if (match) setItemId(match.ItemId);
  }, [items, prefill, itemId]);

  const createMut = useMutation({
    mutationFn: createFixedAssetTagging,
    onSuccess: (r) => {
      const preview = r.codes.slice(0, 3).join(", ") + (r.codes.length > 3 ? `, +${r.codes.length - 3} more` : "");
      toast.success(`Generated ${r.codes.length} FA Item Code${r.codes.length === 1 ? "" : "s"}: ${r.docNo}`, { description: preview });
      ["fixed-asset-taggings", "fixed-asset-inventory-imports", "fixed-asset-eligible-items", "fixed-asset-pending-batches", "fixed-assets", "fa-unassigned-codes", "fixed-asset-dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const count = parseInt(numberOfItems, 10);
  const countOk = Number.isFinite(count) && count > 0 && String(count) === numberOfItems.trim();

  const handleSave = () => {
    if (!companyId) return toast.error("Pick the company.");
    if (!docDate) return toast.error("Enter the date.");
    if (!finYear) return toast.error("This date isn't in any financial year set up.");
    if (!projectId) return toast.error("Pick the project.");
    if (!godownId) return toast.error("Pick the godown.");
    if (!itemId) return toast.error("Pick the item.");
    if (!countOk) return toast.error("Enter a whole number of items.");
    if (!selected) return toast.error("That item is no longer available.");
    if (count > selected.UntaggedQty) return toast.error(`Only ${fmt(selected.UntaggedQty)} unit(s) of this item are untagged.`);
    createMut.mutate({ docDate, companyId: Number(companyId), projectId: Number(projectId), finYear, godownId: Number(godownId), itemId, numberOfItems: count, remarks: remarks || undefined });
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <Block title="Where the stock is">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Field label="Company" required>
            <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); setGodownId(""); setItemId(""); }} className={INP}>
              <option value="">Select company…</option>
              {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Project" required>
            <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setGodownId(""); setItemId(""); }} className={INP} disabled={!companyId}>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Godown" required>
            <select value={godownId} onChange={(e) => { setGodownId(e.target.value); setItemId(""); }} className={INP} disabled={!companyId || !projectId}>
              <option value="">Select godown…</option>
              {godowns.map((g) => <option key={g.GodownID} value={g.GodownID}>{g.GodownName}</option>)}
            </select>
          </Field>
          <Field label="Date" required>
            <DateInput value={docDate} onChange={(e) => { setDocDate(e.target.value); setItemId(""); }} className={INP} />
          </Field>
          <Field label="Financial year" note="Follows the date">
            <div className={READ_ONLY}>{finYear || "No financial year for this date"}</div>
          </Field>
        </div>
      </Block>

      <Block title="Item to tag">
        <Field label="Item" required>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={INP} disabled={!godownId}>
            <option value="">{loadingEligible ? "Loading items…" : "Select item…"}</option>
            {items.map((i) => (
              <option key={i.ItemId} value={i.ItemId}>
                {i.ItemName}{i.AssetCategory ? ` (${i.AssetCategory})` : ""} · {fmt(i.UntaggedQty)} untagged
              </option>
            ))}
          </select>
        </Field>
        {godownId && !loadingEligible && items.length === 0 && (
          <p className="text-xs text-destructive">Nothing untagged at this godown.</p>
        )}
        {selected && (
          <>
            <Figures
              items={[
                { label: "In stock", value: fmt(selected.AvailableQty) },
                { label: "Tagged", value: fmt(selected.TaggedQty) },
                { label: "Untagged", value: fmt(selected.UntaggedQty), tone: "blue" },
                { label: "Category", value: selected.AssetCategory || "—" },
              ]}
            />
            <Field label="Number of items" required note="Generate makes this many FA Item Codes, one per unit, and saves them.">
              <input type="number" min="1" step="1" max={selected.UntaggedQty} value={numberOfItems} onChange={(e) => setNumberOfItems(e.target.value)}
                placeholder="0" className={`${INP} font-semibold tabular-nums sm:max-w-[200px]`} />
            </Field>
          </>
        )}
        <Field label="Remarks">
          <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" className={INP} />
        </Field>
      </Block>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-card px-5 py-3" style={{ border: RULE }}>
        <p className={LBL}>{selected && countOk ? `${fmt(count)} code${count === 1 ? "" : "s"} for ${selected.ItemName}` : "Pick an item and how many to tag"}</p>
        <div className="flex gap-2">
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-4`}>Cancel</button>
          <button onClick={handleSave} disabled={createMut.isPending} className={`${KEY_INK} h-10 px-4`}>
            {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Hash size={13} />} {createMut.isPending ? "Generating…" : "Generate IDs"}
          </button>
        </div>
      </div>
    </div>
  );
}
