// New / edit fixed asset: the FA Item Code it is made from, what it is, what it cost, and its depreciation rate.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Loader2, RefreshCw, Save, Trash2, Upload, X } from "lucide-react";
import { useFinYear } from "@/contexts/FinYearContext";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { getSuppliers } from "@/api/grnApi";
import { getActiveDepreciationSetups } from "@/api/depreciationApi";
import { createFixedAsset, getFixedAsset, updateFixedAsset, type FixedAssetDetail } from "@/api/fixedAssetApi";
import { getSacCodes } from "@/api/hsnApi";
import { getUnassignedFAItemCodes, type UnassignedFAItemCode } from "@/api/fixedAssetTaggingApi";
import { fetchDocTypes, fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { DateInput } from "@/components/ui/date-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ASSET_CATEGORIES } from "../assetCategories";
import {
  ASSET_STATUS_OPTIONS, Block, Field, Figures, INP, KEY_INK, KEY_LINE, LBL, READ_ONLY, RULE, ValueBar,
  type FormState, detailToForm, emptyForm, ensureArray, estimateDepreciation, fmt, fmtCur,
} from "./config";

// ── FA Item Code picker: the unassigned codes generated in FA Inventory ──
function FAItemCodePicker({ codes, onSelect, loading }: { codes: UnassignedFAItemCode[]; onSelect: (c: UnassignedFAItemCode) => void; loading?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open} className={`${INP} flex items-center justify-between text-left text-muted-foreground`}>
          <span className="truncate">Search FA Item Code…</span>
          <ChevronsUpDown size={14} className="shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-none" align="start">
        <Command>
          <CommandInput placeholder="Search generated FA Item Codes…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-xs"><Loader2 size={13} className="animate-spin" /> Loading…</div>
            ) : (
              <>
                <CommandEmpty>No unassigned FA Item Codes. Generate one in FA Inventory first.</CommandEmpty>
                <CommandGroup>
                  {codes.map((c) => (
                    <CommandItem key={c.TagId} value={`${c.FAItemCode} ${c.ItemName || ""}`} onSelect={() => { onSelect(c); setOpen(false); }}
                      className="rounded-none data-[selected=true]:bg-primary/10 data-[selected=true]:text-foreground">
                      <span className="flex flex-col min-w-0">
                        <span className="font-heading text-xs font-semibold tabular-nums truncate">{c.FAItemCode}</span>
                        <span className="text-xs truncate">{c.ItemName || "—"}</span>
                        <span className="text-[0.6875rem] text-muted-foreground truncate">{[c.CompanyName, c.ProjectName, c.GodownName].filter(Boolean).join(" · ")}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Item picture ──
const PICTURE_ACCEPT = "image/jpeg,image/jpg,image/png,image/webp";
const PICTURE_MAX_BYTES = 4 * 1024 * 1024;

function PicturePicker({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) && !PICTURE_ACCEPT.includes(file.type)) return void toast.error("Use a JPG, JPEG, PNG or WEBP picture.");
    if (file.size > PICTURE_MAX_BYTES) return void toast.error("The picture is over 4 MB.");
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result || ""));
    reader.onerror = () => toast.error("Could not read the picture.");
    reader.readAsDataURL(file);
  };
  return (
    <div>
      <input ref={inputRef} type="file" accept={PICTURE_ACCEPT} className="hidden" onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ""; }} />
      {value ? (
        <div className="flex items-center gap-4">
          <img src={value} alt="Fixed asset" className="h-20 w-20 shrink-0 object-cover" style={{ border: RULE }} />
          <div className="flex gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} className={`${KEY_LINE} h-9 px-3`}><RefreshCw size={12} /> Change</button>
            <button type="button" onClick={() => onChange("")} className={`${KEY_LINE} h-9 px-3 !text-destructive !border-destructive`}><Trash2 size={12} /> Remove</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1.5 py-6 text-muted-foreground hover:text-foreground hover:bg-primary/5 transition-colors"
          style={{ border: "1px dashed hsl(var(--foreground) / 0.4)" }}>
          <Upload size={16} />
          <span className={LBL}>Upload picture</span>
          <span className="text-[0.6875rem]">JPG, JPEG, PNG or WEBP · up to 4 MB</span>
        </button>
      )}
    </div>
  );
}

export function AssetForm({ editingId, onClose, onSaved }: { editingId: number | null; onClose: () => void; onSaved: (assetId: number) => void }) {
  const qc = useQueryClient();
  const { finYears } = useFinYear();
  const activeFinYear = finYears.find((f) => f.status === "Active")?.year || "";
  const isEdit = editingId != null;
  const [form, setForm] = useState<FormState>(emptyForm(activeFinYear));
  // True when the category came from FA Inventory with the picked FA Item Code: then it is fixed, not picked again.
  const [categoryFromInventory, setCategoryFromInventory] = useState(false);
  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v })), []);

  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: allProjects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const { data: suppliersRaw = [] } = useQuery({ queryKey: ["suppliers"], queryFn: getSuppliers });
  const { data: depSetups = [] } = useQuery({ queryKey: ["depreciation-setups-active"], queryFn: getActiveDepreciationSetups });
  // "Type of Repairs SAC Code": the Material HSN master's rows with "Is SAC Code" on.
  const { data: sacCodes = [] } = useQuery({ queryKey: ["hsn-sac-codes"], queryFn: getSacCodes });
  const { data: unassignedCodes = [], isLoading: codesLoading } = useQuery({ queryKey: ["fa-unassigned-codes"], queryFn: getUnassignedFAItemCodes, enabled: !isEdit });
  const { data: detail } = useQuery<FixedAssetDetail>({ queryKey: ["fixed-asset", editingId], queryFn: () => getFixedAsset(editingId!), enabled: isEdit });

  // The number the next save will take: the server numbers new assets from the first active "FA" document type,
  // in the form's financial year. A preview only; someone else saving first takes it.
  const { data: faDocTypeId } = useQuery({
    queryKey: ["doc-type-id", "FA"],
    queryFn: async () => (await fetchDocTypes()).filter((t) => t.DocNoPrefix === "FA").sort((a, b) => a.TypeOfDocId - b.TypeOfDocId)[0]?.TypeOfDocId ?? null,
    enabled: !isEdit,
    staleTime: 5 * 60 * 1000,
  });
  const { data: nextDocNo, isFetching: nextDocLoading } = useQuery({
    queryKey: ["doc-next-number", faDocTypeId, form.finYear],
    queryFn: () => fetchNextDocNumber(faDocTypeId!, form.finYear || undefined),
    enabled: !isEdit && !!faDocTypeId,
    staleTime: 0,
  });

  // An asset being edited fills the form once it loads.
  useEffect(() => {
    if (isEdit && detail) setForm(detailToForm(detail));
  }, [isEdit, detail]);

  const projects = useMemo(
    () => (form.companyId ? ensureArray<ProjectCompanyLike & { id: number; label: string }>(allProjects).filter((p) => projectBelongsToCompany(p, form.companyId)) : []),
    [allProjects, form.companyId],
  );
  const suppliers = ensureArray<{ LHeadId: number; LHeadName: string }>(suppliersRaw);
  // Categories are the live Depreciation Setup rows; the seed list only until the first rate is set up.
  const categoryOptions = useMemo(() => {
    const fromSetups = Array.from(new Set(depSetups.map((d) => d.AssetCategory))).sort();
    return fromSetups.length > 0 ? fromSetups : ASSET_CATEGORIES;
  }, [depSetups]);

  const handleCategoryChange = (cat: string) => {
    const setup = depSetups.find((d) => d.AssetCategory === cat);
    setForm((p) => ({
      ...p,
      assetCategory: cat,
      depreciationSetupId: setup ? String(setup.SetupId) : "",
      depreciationType: setup?.DepreciationType ?? "",
      depreciationRate: setup ? String(setup.DepreciationRate) : "",
    }));
  };

  const handleSelectCode = (c: UnassignedFAItemCode) => {
    setForm((p) => ({
      ...p,
      sourceTagId: String(c.TagId),
      faItemCode: c.FAItemCode,
      assetName: c.ItemName || "",
      companyId: c.CompanyId ? String(c.CompanyId) : "",
      projectId: c.ProjectId ? String(c.ProjectId) : "",
      godownId: c.GodownId ? String(c.GodownId) : "",
      godownName: c.GodownName || "",
    }));
    // The category was captured at FA Inventory import: take it (and its rate) when it has an active Depreciation Setup.
    const inv = (c.AssetCategory || "").trim().toLowerCase();
    const match = inv ? depSetups.find((d) => d.AssetCategory.trim().toLowerCase() === inv) : undefined;
    if (match) handleCategoryChange(match.AssetCategory);
    setCategoryFromInventory(!!match);
  };

  const clearSelectedCode = () => {
    setForm((p) => ({ ...p, sourceTagId: "", faItemCode: "", assetName: "", godownId: "", godownName: "" }));
    setCategoryFromInventory(false);
  };

  const afterWrite = () => {
    qc.invalidateQueries({ queryKey: ["fixed-assets"] });
    qc.invalidateQueries({ queryKey: ["fa-unassigned-codes"] });
    qc.invalidateQueries({ queryKey: ["fixed-asset-taggings"] });
    qc.invalidateQueries({ queryKey: ["fixed-asset-eligible-items"] });
    qc.invalidateQueries({ queryKey: ["fixed-asset-dashboard"] });
  };
  const createMut = useMutation({
    mutationFn: createFixedAsset,
    onSuccess: (r) => {
      toast.success(`Asset recorded: ${r.docNo} (${r.assetCode})`);
      afterWrite();
      onSaved(r.assetId);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: (data: Parameters<typeof updateFixedAsset>[1]) => updateFixedAsset(editingId!, data),
    onSuccess: () => {
      toast.success("Asset updated");
      afterWrite();
      qc.invalidateQueries({ queryKey: ["fixed-asset", editingId] });
      onSaved(editingId!);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const saving = createMut.isPending || updateMut.isPending;

  const handleSave = () => {
    if (!isEdit && !form.sourceTagId) return toast.error("Pick an FA Item Code.");
    if (!form.assetName.trim()) return toast.error("Enter the asset's name.");
    if (!form.assetCategory) return toast.error("Pick the asset category.");
    if (!form.purchaseCost) return toast.error("Enter the purchase cost.");
    const payload = {
      docDate: form.docDate || undefined,
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
      finYear: form.finYear || undefined,
      assetName: form.assetName,
      sourceTagId: !isEdit && form.sourceTagId ? Number(form.sourceTagId) : undefined,
      assetCategory: form.assetCategory,
      repairType: form.repairType || null,
      brand: form.brand || undefined,
      model: form.model || undefined,
      serialNumber: form.serialNumber || undefined,
      purchaseDate: form.purchaseDate || undefined,
      activationDate: form.activationDate || undefined,
      purchaseInvoiceRef: form.purchaseInvoiceRef || undefined,
      supplierId: form.supplierId ? Number(form.supplierId) : undefined,
      purchaseCost: parseFloat(form.purchaseCost) || 0,
      quantity: parseFloat(form.quantity) || 1,
      depreciationSetupId: form.depreciationSetupId ? Number(form.depreciationSetupId) : undefined,
      depreciationType: form.depreciationType || undefined,
      depreciationRate: form.depreciationRate ? parseFloat(form.depreciationRate) : undefined,
      usefulLife: form.usefulLife ? parseInt(form.usefulLife, 10) : undefined,
      assetStatus: form.assetStatus || "Active",
      sellingPrice: form.sellingPrice ? parseFloat(form.sellingPrice) : undefined,
      saleDate: form.saleDate || undefined,
      buyerName: form.buyerName || undefined,
      saleRemarks: form.saleRemarks || undefined,
      remarks: form.remarks || undefined,
      pictureBase64: form.pictureBase64 || null,
    };
    if (isEdit) updateMut.mutate(payload);
    else createMut.mutate(payload);
  };

  const cost = parseFloat(form.purchaseCost) || 0;
  // Before anything is posted the form can only estimate: straight line from the purchase date.
  const estimate = useMemo(
    () => (cost && form.depreciationRate && form.purchaseDate ? estimateDepreciation(cost, parseFloat(form.depreciationRate), form.purchaseDate) : null),
    [cost, form.depreciationRate, form.purchaseDate],
  );
  // An asset already on the books sells against what is left after posted depreciation.
  const saleBookValue = isEdit && detail ? Math.max(0, cost - (detail.Depreciated || 0)) : estimate?.bookValue ?? null;
  const selling = parseFloat(form.sellingPrice);
  const profitLoss = saleBookValue != null && form.sellingPrice ? selling - saleBookValue : null;
  const showSale = form.assetStatus === "Sold" || !!form.sellingPrice;

  const checklist = [
    { label: "FA Item Code", done: isEdit || !!form.sourceTagId },
    { label: "Category", done: !!form.assetCategory },
    { label: "Purchase cost", done: !!form.purchaseCost },
    { label: "Purchase date", done: !!form.purchaseDate },
    { label: "Depreciation rate", done: !!form.depreciationRate },
  ];
  const required = checklist.slice(0, 3).every((c) => c.done);

  if (isEdit && !detail) return <p className="p-10 text-center text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        <Block title="Document">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            <Field label="Doc no" note={!isEdit && nextDocNo ? "Next number; taken when you save" : undefined}>
              <div className={`${READ_ONLY} font-heading tabular-nums`}>
                {isEdit ? detail?.DocNo || "—" : nextDocNo || (nextDocLoading ? "…" : faDocTypeId === null ? "No active FA document type" : "Given on save")}
              </div>
            </Field>
            <Field label="Document date">
              <DateInput value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={INP} />
            </Field>
            <Field label="Company" note={form.sourceTagId ? "From the FA Item Code" : undefined}>
              <SearchableNativeSelect value={form.companyId} onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, projectId: "" }))} className={INP} disabled={!!form.sourceTagId} searchPlaceholder="Search company…">
                <option value="">Select company…</option>
                {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </SearchableNativeSelect>
            </Field>
            <Field label="Project">
              <SearchableNativeSelect value={form.projectId} onChange={(e) => setField("projectId", e.target.value)} className={INP} disabled={!form.companyId || !!form.sourceTagId} searchPlaceholder="Search project…">
                <option value="">Select project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </SearchableNativeSelect>
            </Field>
            <Field label="Financial year">
              <select value={form.finYear} onChange={(e) => setField("finYear", e.target.value)} className={INP}>
                <option value="">Select year…</option>
                {finYears.map((f) => <option key={f.id} value={f.year}>{f.year}</option>)}
              </select>
            </Field>
            <Field label="Remarks" className="sm:col-span-2 xl:col-span-3">
              <input type="text" value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} placeholder="Optional" className={INP} />
            </Field>
          </div>
        </Block>

        <Block title="Asset">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            <Field label="Fixed asset" required className="sm:col-span-2"
              note={!isEdit && !form.sourceTagId ? "Pick an unassigned FA Item Code from FA Inventory; its item name, company, project and godown fill in." : undefined}>
              {form.sourceTagId ? (
                <div className="flex items-center justify-between gap-2 px-3 py-2 min-h-10" style={{ border: RULE }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{form.assetName}</p>
                    <p className="text-[0.6875rem] font-heading tabular-nums text-muted-foreground truncate">
                      {form.faItemCode}{form.godownName ? ` · ${form.godownName}` : ""}
                    </p>
                  </div>
                  {!isEdit && (
                    <button type="button" onClick={clearSelectedCode} className="shrink-0 p-1 text-muted-foreground hover:text-foreground" title="Pick another code">
                      <X size={13} />
                    </button>
                  )}
                </div>
              ) : isEdit ? (
                <input type="text" value={form.assetName} onChange={(e) => setField("assetName", e.target.value)} className={INP} />
              ) : (
                <FAItemCodePicker codes={unassignedCodes} onSelect={handleSelectCode} loading={codesLoading} />
              )}
            </Field>
            <Field label="Asset category" required note={categoryFromInventory ? "Taken from FA Inventory for this code" : undefined}>
              <select value={form.assetCategory} onChange={(e) => handleCategoryChange(e.target.value)} disabled={categoryFromInventory} className={INP}>
                <option value="">Select category…</option>
                {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Repairs SAC code" note={sacCodes.length === 0 ? "None yet: add one in Material → Setup → HSN with “Is SAC Code” on." : undefined}>
              <select value={form.repairType} onChange={(e) => setField("repairType", e.target.value)} className={INP}>
                <option value="">Select SAC code…</option>
                {sacCodes.map((s) => (
                  <option key={s.HId} value={s.HCode}>{s.HCode}{s.HShortDescription || s.HDescription ? ` — ${s.HShortDescription || s.HDescription}` : ""}</option>
                ))}
                {form.repairType && !sacCodes.some((s) => s.HCode === form.repairType) && <option value={form.repairType}>{form.repairType}</option>}
              </select>
            </Field>
            <Field label="Brand">
              <input type="text" value={form.brand} onChange={(e) => setField("brand", e.target.value)} placeholder="e.g. Dell" className={INP} />
            </Field>
            <Field label="Model">
              <input type="text" value={form.model} onChange={(e) => setField("model", e.target.value)} placeholder="e.g. Latitude 5520" className={INP} />
            </Field>
            <Field label="Serial number">
              <input type="text" value={form.serialNumber} onChange={(e) => setField("serialNumber", e.target.value)} className={INP} />
            </Field>
            <Field label="Status">
              <select value={form.assetStatus} onChange={(e) => setField("assetStatus", e.target.value)} className={INP}>
                {ASSET_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <div>
            <p className={`${LBL} mb-1.5`}>Picture</p>
            <PicturePicker value={form.pictureBase64} onChange={(v) => setField("pictureBase64", v)} />
          </div>
        </Block>

        <Block title="Purchase">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
            <Field label="Purchase cost (₹)" required>
              <input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setField("purchaseCost", e.target.value)} placeholder="0.00" className={`${INP} font-semibold tabular-nums`} />
            </Field>
            <Field label="Purchase date">
              <DateInput value={form.purchaseDate} onChange={(e) => setField("purchaseDate", e.target.value)} className={INP} />
            </Field>
            <Field label="Activation date">
              <DateInput value={form.activationDate} onChange={(e) => setField("activationDate", e.target.value)} className={INP} />
            </Field>
            <Field label="Invoice ref">
              <input type="text" value={form.purchaseInvoiceRef} onChange={(e) => setField("purchaseInvoiceRef", e.target.value)} className={INP} />
            </Field>
            <Field label="Supplier" className="sm:col-span-2">
              <SearchableNativeSelect value={form.supplierId} onChange={(e) => setField("supplierId", e.target.value)} className={INP}>
                <option value="">Select supplier…</option>
                {suppliers.map((s) => <option key={s.LHeadId} value={s.LHeadId}>{s.LHeadName}</option>)}
              </SearchableNativeSelect>
            </Field>
          </div>
        </Block>

        <Block title="Depreciation" note="Type and rate come from Depreciation Setup for the category">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Field label="Type"><div className={READ_ONLY}>{form.depreciationType || "—"}</div></Field>
            <Field label="Rate (% a year)"><div className={READ_ONLY}>{form.depreciationRate ? `${form.depreciationRate}%` : "—"}</div></Field>
            <Field label="Useful life (years, optional)">
              <input type="number" min="1" value={form.usefulLife} onChange={(e) => setField("usefulLife", e.target.value)} className={INP} />
            </Field>
          </div>
          {form.assetCategory && !form.depreciationRate && (
            <p className="text-xs text-destructive">No active depreciation rate for “{form.assetCategory}”. Add one in Depreciation Setup.</p>
          )}
          {isEdit && detail ? (
            <>
              <Figures items={[
                { label: "Purchase cost", value: fmtCur(cost) },
                { label: "Depreciation posted", value: fmtCur(detail.Depreciated) },
                { label: "Book value", value: fmtCur(Math.max(0, cost - (detail.Depreciated || 0))), tone: "blue" },
                { label: "Rate", value: form.depreciationRate ? `${form.depreciationRate}%` : "—" },
              ]} />
              <ValueBar value={Math.max(0, cost - (detail.Depreciated || 0))} cost={cost} />
            </>
          ) : estimate ? (
            <>
              <Figures items={[
                { label: "Purchase cost", value: fmtCur(cost) },
                { label: "A year at this rate", value: fmtCur(estimate.annualDep) },
                { label: "To date, estimated", value: fmtCur(estimate.totalDep) },
                { label: "Book value, estimated", value: fmtCur(estimate.bookValue), tone: "blue" },
              ]} />
              <ValueBar value={estimate.bookValue} cost={cost} />
              <p className="text-[0.6875rem] text-muted-foreground">
                Straight-line estimate over {estimate.years} years since purchase. The books change only when depreciation is posted.
              </p>
            </>
          ) : null}
        </Block>

        {showSale ? (
          <Block title="Sale">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <Field label="Selling price (₹)">
                <input type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(e) => setField("sellingPrice", e.target.value)} placeholder="0.00" className={INP} />
              </Field>
              <Field label="Sale date">
                <DateInput value={form.saleDate} onChange={(e) => setField("saleDate", e.target.value)} className={INP} />
              </Field>
              <Field label="Buyer">
                <input type="text" value={form.buyerName} onChange={(e) => setField("buyerName", e.target.value)} className={INP} />
              </Field>
              <Field label="Sale remarks" className="sm:col-span-3">
                <input type="text" value={form.saleRemarks} onChange={(e) => setField("saleRemarks", e.target.value)} placeholder="Optional" className={INP} />
              </Field>
            </div>
            {profitLoss != null && (
              <p className={`font-heading text-sm font-bold ${profitLoss >= 0 ? "text-foreground" : "text-destructive"}`}>
                {profitLoss >= 0 ? "Profit" : "Loss"} on sale: {fmtCur(Math.abs(profitLoss))}
                <span className="font-normal text-muted-foreground"> against a book value of {fmtCur(saleBookValue)}</span>
              </p>
            )}
          </Block>
        ) : (
          <button type="button" onClick={() => setField("assetStatus", "Sold")} className={`${KEY_LINE} h-9 px-3`}>
            Record a sale
          </button>
        )}
      </div>

      <aside className="bg-card xl:sticky xl:top-20" style={{ border: RULE }}>
        <div className="px-4 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>{isEdit ? "Editing" : "New asset"}</p>
          <p className="font-heading text-base font-bold text-foreground truncate">{form.assetName || "Untitled asset"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{form.faItemCode || "No FA Item Code yet"}</p>
        </div>
        <div className="px-4 py-3 space-y-2">
          {checklist.map((c, i) => (
            <div key={c.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 text-foreground">
                <i className="shrink-0" style={{ width: 8, height: 8, border: "1px solid hsl(var(--foreground))", background: c.done ? "hsl(var(--primary))" : "transparent" }} />
                {c.label}{i < 3 ? " *" : ""}
              </span>
              <span className="text-muted-foreground">{c.done ? "done" : "to do"}</span>
            </div>
          ))}
          <p className="text-[0.6875rem] text-muted-foreground pt-1">{cost ? `Cost ${fmtCur(cost)}` : "No cost yet"}{form.quantity && form.quantity !== "1" ? ` · qty ${fmt(Number(form.quantity))}` : ""}</p>
        </div>
        <div className="px-4 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Cancel</button>
          <button onClick={handleSave} disabled={saving} title={required ? undefined : "Fill the starred items first"} className={`${KEY_INK} h-10 px-3 flex-1`}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : isEdit ? <Save size={13} /> : <Check size={13} />} {saving ? "Saving…" : "Save asset"}
          </button>
        </div>
      </aside>
    </div>
  );
}
