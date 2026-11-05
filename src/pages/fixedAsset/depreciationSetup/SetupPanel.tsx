// New / edit depreciation rate at the side of the list, and the delete confirmation.
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import {
  createDepreciationSetup, deleteDepreciationSetup, updateDepreciationSetup,
  type DepreciationPayload, type DepreciationSetup,
} from "@/api/depreciationApi";
import { Field, INP, KEY_INK, KEY_LINE, KEY_RED, LBL, RULE } from "../record/config";
import { todayLocal } from "../tagging/config";

/** The list here and the Active rates the asset form / inventory import pick from. */
export const SETUP_REFRESH = ["depreciation-setups", "depreciation-setups-active"];

export const DEPRECIATION_TYPES = [
  { value: "SLM", label: "SLM — Straight Line Method" },
  { value: "WDV", label: "WDV — Written Down Value" },
];

const emptyForm = (): DepreciationPayload => ({
  assetCategory: "",
  depreciationType: "SLM",
  depreciationRate: 15,
  effectiveFrom: todayLocal(),
  status: "Active",
});

export function SetupPanel({ editing, categories, onClose }: { editing: DepreciationSetup | null; categories: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<DepreciationPayload>(() =>
    editing
      ? {
          assetCategory: editing.AssetCategory,
          depreciationType: editing.DepreciationType,
          depreciationRate: editing.DepreciationRate,
          effectiveFrom: editing.EffectiveFrom?.slice(0, 10) || "",
          status: editing.Status,
        }
      : emptyForm(),
  );
  const set = <K extends keyof DepreciationPayload>(k: K, v: DepreciationPayload[K]) => setForm((p) => ({ ...p, [k]: v }));

  const done = (msg: string) => {
    toast.success(msg);
    SETUP_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    onClose();
  };
  const createMut = useMutation({
    mutationFn: createDepreciationSetup,
    onSuccess: () => done("Depreciation rate created"),
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<DepreciationPayload> }) => updateDepreciationSetup(id, data),
    onSuccess: () => done("Depreciation rate updated"),
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    const data = { ...form, assetCategory: form.assetCategory.trim() };
    if (!data.assetCategory) return toast.error("Asset category is required");
    if (!data.depreciationRate) return toast.error("Depreciation rate is required");
    if (data.depreciationRate < 0 || data.depreciationRate > 100) return toast.error("Depreciation rate must be between 0 and 100%");
    if (!data.effectiveFrom) return toast.error("Effective from date is required");
    if (editing) updateMut.mutate({ id: editing.SetupId, data });
    else createMut.mutate(data);
  };
  const saving = createMut.isPending || updateMut.isPending;
  const yearOne = form.depreciationRate > 0 ? (100000 * form.depreciationRate) / 100 : 0;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Depreciation rate" className="w-full max-w-sm bg-card flex flex-col" style={{ borderLeft: RULE }}>
        <div className="flex items-center justify-between gap-2 px-5 py-3" style={{ borderBottom: RULE }}>
          <div className="min-w-0">
            <p className={LBL}>Depreciation setup</p>
            <p className="font-heading text-base font-bold text-foreground truncate">{editing ? `Edit ${editing.AssetCategory}` : "New depreciation rate"}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <Field label="Asset category" required note="Pick one of the usual categories or type a new one.">
            <input type="text" list="depreciation-categories" value={form.assetCategory}
              onChange={(e) => set("assetCategory", e.target.value)} placeholder="e.g. Laptop" className={INP} />
            <datalist id="depreciation-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Depreciation type">
            <select value={form.depreciationType} onChange={(e) => set("depreciationType", e.target.value)} className={INP}>
              {DEPRECIATION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field
            label="Rate (% per year)"
            required
            note={yearOne > 0 ? `₹1,00,000 of cost loses ₹${yearOne.toLocaleString("en-IN", { maximumFractionDigits: 2 })} in its first year${form.depreciationType === "WDV" ? ", less each year after" : ", the same each year"}.` : undefined}
          >
            <input type="number" min="0" max="100" step="0.01" inputMode="decimal"
              value={form.depreciationRate === 0 ? "" : String(form.depreciationRate)}
              onChange={(e) => set("depreciationRate", e.target.value === "" ? 0 : parseFloat(e.target.value))}
              placeholder="e.g. 12.5" className={`${INP} tabular-nums`} />
          </Field>
          <Field label="Effective from" required>
            <DateInput value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} className={INP} />
          </Field>
          <Field label="Status" note="Only one Active rate per category; assets pick from the Active ones.">
            <span className="inline-flex h-10 border border-foreground w-full" role="group" aria-label="Status">
              {(["Active", "Inactive"] as const).map((s) => (
                <button key={s} type="button" onClick={() => set("status", s)} aria-pressed={form.status === s}
                  className={`flex-1 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] transition-colors ${form.status === s ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}>
                  {s}
                </button>
              ))}
            </span>
          </Field>
        </div>

        <div className="px-5 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={`${KEY_INK} h-10 px-3 flex-1`}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function DeleteSetupDialog({ setup, onClose }: { setup: DepreciationSetup; onClose: () => void }) {
  const qc = useQueryClient();
  const del = useMutation({
    mutationFn: () => deleteDepreciationSetup(setup.SetupId),
    onSuccess: () => {
      toast.success("Deleted");
      SETUP_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div role="alertdialog" aria-modal="true" className="relative bg-card max-w-sm w-full" style={{ border: "1.5px solid hsl(var(--foreground))", boxShadow: "6px 6px 0 hsl(var(--foreground) / 0.14)" }}>
        <div className="px-5 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>Depreciation setup</p>
          <p className="font-heading text-base font-bold text-foreground">Delete the {setup.AssetCategory} rate?</p>
        </div>
        <p className="px-5 py-4 text-sm text-muted-foreground">
          This permanently removes it. A rate already used by an asset can't be deleted — set it Inactive instead.
        </p>
        <div className="px-5 py-3 flex gap-2" style={{ borderTop: RULE }}>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3 flex-1`}>Keep</button>
          <button onClick={() => del.mutate()} disabled={del.isPending} className={`${KEY_RED} h-10 px-3 flex-1`}>
            {del.isPending ? "Deleting…" : "Delete rate"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
