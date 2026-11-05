// New inventory import: bring a Fixed Asset item into a godown when there is no GRN to receive it through.
// The stock then follows the same path as a GRN receipt: FA Inventory, tagging, the asset register.
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { getGodowns, type Godown } from "@/api/godownsApi";
import { getItems, type DbItem } from "@/api/itemMasterApi";
import { getActiveDepreciationSetups } from "@/api/depreciationApi";
import { createInventoryImport } from "@/api/fixedAssetInventoryImportApi";
import { DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { godownMatches } from "../faImportValidation";
import { Block, Field, INP, KEY_INK, KEY_LINE, LBL, RULE, ensureArray, fmtCur } from "../record/config";
import { todayLocal } from "../tagging/config";

export function ImportForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [docDate, setDocDate] = useState(todayLocal());
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [godownId, setGodownId] = useState("");
  const [itemId, setItemId] = useState("");
  const [assetCategory, setAssetCategory] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const [remarks, setRemarks] = useState("");

  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: allProjects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const { data: godownsData } = useQuery({ queryKey: ["godowns"], queryFn: getGodowns });
  // The category sets the depreciation rate, so only categories with an active Depreciation Setup are offered.
  const { data: depSetups = [] } = useQuery({ queryKey: ["depreciation-setups-active"], queryFn: getActiveDepreciationSetups });
  const { data: allItems = [], isLoading: loadingItems } = useQuery({ queryKey: ["item-master-all"], queryFn: getItems });

  const categories = useMemo(
    () => Array.from(new Set(ensureArray<{ AssetCategory: string }>(depSetups).map((d) => d.AssetCategory.trim()).filter(Boolean))).sort(),
    [depSetups],
  );
  const projects = useMemo(
    () => (companyId ? ensureArray<ProjectCompanyLike & { id: number; label: string }>(allProjects).filter((p) => projectBelongsToCompany(p, companyId)) : []),
    [allProjects, companyId],
  );
  const godowns = useMemo(
    () =>
      companyId && projectId
        ? ensureArray<Godown>(godownsData?.data).filter((g) => !g.IsDeleted && g.IsActive && godownMatches(g, Number(companyId), Number(projectId)))
        : [],
    [godownsData, companyId, projectId],
  );
  // Only Item Master items marked Fixed Asset belong in fixed-asset inventory.
  const items = useMemo(() => ensureArray<DbItem>(allItems).filter((i) => i.M_Type === "Fixed Asset"), [allItems]);

  const qty = parseFloat(quantity);
  const unitRate = parseFloat(rate);
  const value = Number.isFinite(qty) && Number.isFinite(unitRate) ? qty * unitRate : null;

  const createMut = useMutation({
    mutationFn: createInventoryImport,
    onSuccess: (r) => {
      toast.success(`Imported: ${r.docNo}`, {
        description: r.tagged > 0 ? `${r.tagged} FA Item Code${r.tagged === 1 ? "" : "s"} generated` : "Tag it in FA Inventory once the project has an ID template",
      });
      ["fixed-asset-inventory-imports", "fixed-asset-eligible-items", "fixed-asset-pending-batches", "fixed-asset-taggings", "fa-unassigned-codes", "fixed-assets", "fixed-asset-dashboard"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    if (!docDate) return toast.error("Enter the date.");
    if (!companyId) return toast.error("Pick the company.");
    if (!projectId) return toast.error("Pick the project.");
    if (!godownId) return toast.error("Pick the godown.");
    if (!itemId) return toast.error("Pick the item.");
    if (!assetCategory) return toast.error("Pick the asset category.");
    if (!Number.isFinite(qty) || qty <= 0) return toast.error("Enter the quantity.");
    createMut.mutate({
      docDate, companyId: Number(companyId), projectId: Number(projectId), godownId: Number(godownId), itemId, assetCategory,
      quantity: qty, rate: rate ? unitRate : undefined, remarks: remarks || undefined,
    });
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <Block title="Where it goes">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          <Field label="Company" required>
            <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); setProjectId(""); setGodownId(""); }} className={INP}>
              <option value="">Select company…</option>
              {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Project" required>
            <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setGodownId(""); }} className={INP} disabled={!companyId}>
              <option value="">Select project…</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Godown" required note={projectId && godowns.length === 0 ? "No godown for this project" : undefined}>
            <select value={godownId} onChange={(e) => setGodownId(e.target.value)} className={INP} disabled={!projectId}>
              <option value="">Select godown…</option>
              {godowns.map((g) => <option key={g.GodownID} value={g.GodownID}>{g.GodownName}</option>)}
            </select>
          </Field>
          <Field label="Date" required>
            <DateInput value={docDate} onChange={(e) => setDocDate(e.target.value)} className={INP} />
          </Field>
        </div>
      </Block>

      <Block title="Item">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Field label="Item" required note={!loadingItems && items.length === 0 ? "No Item Master item is marked Fixed Asset yet." : "Item Master items marked Fixed Asset"}>
            <SearchableNativeSelect value={itemId} onChange={(e) => setItemId(e.target.value)} className={INP}>
              <option value="">{loadingItems ? "Loading items…" : "Select item…"}</option>
              {items.map((i) => <option key={i.M_Id} value={i.M_Id}>{i.M_Name}{i.M_Group ? ` (${i.M_Group})` : ""}</option>)}
            </SearchableNativeSelect>
          </Field>
          <Field label="Asset category" required note={categories.length === 0 ? "None active: add one in Depreciation Setup first." : "Sets the depreciation rate; FA Inventory and the asset register take it from here"}>
            <select value={assetCategory} onChange={(e) => setAssetCategory(e.target.value)} className={INP}>
              <option value="">Select category…</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Quantity" required>
            <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" className={`${INP} font-semibold tabular-nums`} />
          </Field>
          <Field label="Unit rate (₹)">
            <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0.00" className={`${INP} tabular-nums`} />
          </Field>
          <Field label="Remarks" className="sm:col-span-2">
            <input type="text" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Why it comes in without a GRN (e.g. the original GRN is not in the system)" className={INP} />
          </Field>
        </div>
      </Block>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-card px-5 py-3" style={{ border: RULE }}>
        <div>
          <p className={LBL}>Value</p>
          <p className="font-heading text-lg font-bold tabular-nums text-foreground">{value != null ? fmtCur(value) : "—"}</p>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground max-w-md">
          It lands in FA Inventory as received stock and is tagged at once when the project has an ID template; otherwise it waits there to be tagged.
        </p>
        <div className="flex gap-2">
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-4`}>Cancel</button>
          <button onClick={handleSave} disabled={createMut.isPending} className={`${KEY_INK} h-10 px-4`}>
            {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {createMut.isPending ? "Importing…" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
