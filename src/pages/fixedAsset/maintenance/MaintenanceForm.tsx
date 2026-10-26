// New / edit Maintenance & Repair on the sheet: the record's blocks on the left (header, fixed asset, repair, and the
// accounting entry it will post, always in view), and a summary with Save / Save & Post on the right.
import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2, Send } from "lucide-react";
import { DateInput } from "@/components/ui/date-input";
import { getEnterpriseOptions } from "@/api/enterpriseApi";
import { projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import {
  createMaintenance, getFaItemCodesByItem, getMaintAssets, getMaintVendors, getMaintenance, postMaintenance, updateMaintenance,
  REPAIR_EXPENSE_LABEL, REPAIR_EXPENSE_TYPES,
  type FAMaintAsset, type RepairExpenseType,
} from "@/api/fixedAssetMaintenanceApi";
import { Block, Field, INP, KEY_INK, KEY_LINE, LBL, READ_ONLY, RULE, ensureArray } from "../record/config";
import { MAINT_REFRESH, emptyForm, fmtAmt, localPostingPreview, round2, type FormState } from "./config";
import { CodePicker, ItemPicker } from "./pickers";
import { PostingTable } from "./PostingTable";

export function MaintenanceForm({ editingId, onClose }: { editingId: number | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isEdit = editingId != null;
  const [form, setForm] = useState<FormState>(emptyForm());
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: companies = [] } = useQuery({ queryKey: ["enterprise-options-C"], queryFn: () => getEnterpriseOptions(undefined, "C") });
  const { data: allProjects = [] } = useQuery({ queryKey: ["enterprise-options-P"], queryFn: () => getEnterpriseOptions(undefined, "P") });
  const { data: vendors = [] } = useQuery({ queryKey: ["fa-maintenance-vendors"], queryFn: getMaintVendors });
  const { data: assets = [], isLoading: loadingAssets } = useQuery({
    queryKey: ["fa-maintenance-assets", form.companyId, form.projectId],
    queryFn: () => getMaintAssets({
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
    }),
  });
  // FA Item Codes for the selected item, filtered server-side to this item / company / project.
  const { data: codesForItem = [], isFetching: loadingCodes } = useQuery({
    queryKey: ["fa-maintenance-codes", form.companyId, form.projectId, form.itemName],
    queryFn: () => getFaItemCodesByItem({
      itemName: form.itemName,
      companyId: form.companyId ? Number(form.companyId) : undefined,
      projectId: form.projectId ? Number(form.projectId) : undefined,
    }),
    enabled: !!form.itemName,
  });
  const { data: editDetail } = useQuery({
    queryKey: ["fa-maintenance", editingId],
    queryFn: () => getMaintenance(editingId!),
    enabled: isEdit,
  });

  React.useEffect(() => {
    if (!editingId || !editDetail) return;
    const d = editDetail;
    setForm({
      companyId: String(d.CompanyId || ""),
      projectId: String(d.ProjectId || ""),
      docNo: d.DocNo || "",
      docDate: d.DocDate?.slice(0, 10) || "",
      itemName: d.ItemName || "",
      assetId: String(d.AssetId != null ? d.AssetId : ""),
      remarks: d.Remarks || "",
      vendorId: String(d.VendorId || ""),
      repairExpenseType: d.RepairExpenseType,
      amount: d.Amount != null ? String(d.Amount) : "",
    });
  }, [editingId, editDetail]);

  const projects = useMemo(() => {
    if (!form.companyId) return [];
    return ensureArray<ProjectCompanyLike & { id: number; label: string }>(allProjects).filter((p) => projectBelongsToCompany(p, form.companyId));
  }, [allProjects, form.companyId]);
  const itemNames = useMemo(
    () => Array.from(new Set(ensureArray<FAMaintAsset>(assets).map((a) => a.AssetName))).sort(),
    [assets],
  );
  const vendorList = ensureArray<{ id: number; label: string; code: string | null }>(vendors);
  const vendorLabel = vendorList.find((v) => String(v.id) === form.vendorId)?.label || "";
  const companyLabel = ensureArray<{ id: number; label: string }>(companies).find((c) => String(c.id) === form.companyId)?.label || "";
  const projectLabel = projects.find((p) => String(p.id) === form.projectId)?.label || "";

  // The chosen FA record carries its configured SAC code and resolved GST rate (Fixed Asset Depreciation Tag / HSN).
  const selectedAsset = useMemo(
    () => ensureArray<FAMaintAsset>(codesForItem).find((a) => String(a.AssetId) === form.assetId) || null,
    [codesForItem, form.assetId],
  );
  const sacInfo = useMemo(() => ({
    code: selectedAsset?.SacCode ?? null,
    ratePct: selectedAsset?.GstRatePct ?? null,
    desc: selectedAsset?.SacDescription ?? null,
  }), [selectedAsset]);

  // ── save / post ───────────────────────────────────────────────────────────
  const refresh = () => MAINT_REFRESH.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const createMut = useMutation({
    mutationFn: createMaintenance,
    onSuccess: (r) => { toast.success(r?.docNo ? `Saved (Draft) — ${r.docNo}` : "Maintenance record saved (Draft)"); refresh(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateMaintenance>[1] }) => updateMaintenance(id, data),
    onSuccess: (r) => {
      toast.success(r?.wasPosted ? "Record updated — previous posting reversed, use Save & Post to post it again" : "Maintenance record updated");
      refresh();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const postMut = useMutation({
    mutationFn: (id: number) => postMaintenance(id),
    onSuccess: (r) => { toast.success(`Posted to GL — voucher ${r.voucherNo}`); refresh(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const validate = (): string | null => {
    if (!form.companyId) return "Company is mandatory";
    if (!form.projectId) return "Project is mandatory";
    if (!form.docDate) return "Doc Date is mandatory";
    if (!form.itemName) return "Item Selection is mandatory";
    if (!form.assetId) return "FA Item Code is mandatory";
    if (!form.vendorId) return "Vendor is mandatory";
    if (!form.repairExpenseType) return "Repair Expense Type is mandatory";
    const amt = Number(form.amount);
    if (!Number.isFinite(amt) || amt <= 0) return "Amount must be greater than zero";
    return null;
  };
  const buildPayload = () => ({
    companyId: Number(form.companyId),
    projectId: Number(form.projectId),
    docDate: form.docDate,
    itemName: form.itemName,
    assetId: Number(form.assetId),
    vendorId: Number(form.vendorId),
    repairExpenseType: form.repairExpenseType as RepairExpenseType,
    amount: Number(form.amount),
    remarks: form.remarks || undefined,
  });
  const handleSave = () => {
    const err = validate();
    if (err) return toast.error(err);
    if (isEdit) updateMut.mutate({ id: editingId!, data: buildPayload() });
    else createMut.mutate(buildPayload());
  };
  const handleSaveAndPost = async () => {
    const err = validate();
    if (err) return toast.error(err);
    try {
      let id = editingId;
      if (id) await updateMaintenance(id, buildPayload());
      else id = (await createMaintenance(buildPayload())).maintenanceId;
      await postMut.mutateAsync(id!);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const busy = createMut.isPending || updateMut.isPending || postMut.isPending;
  const preview = editingId && editDetail?.posting && !editDetail.posting.error && editDetail.AssetId === Number(form.assetId)
    ? editDetail.posting
    : localPostingPreview(form, vendorLabel, sacInfo);
  const wasPosted = isEdit && editDetail?.Status === "Posted";
  const taxable = Number(form.amount) || 0;
  const gst = sacInfo.ratePct != null ? round2((taxable * sacInfo.ratePct) / 100) : null;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
      <div className="space-y-5 min-w-0">
        {wasPosted && (
          <div className="flex items-start gap-2 px-4 py-3 text-xs text-foreground" style={{ border: "1px solid hsl(var(--destructive))", background: "hsl(var(--destructive) / 0.06)" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-destructive" />
            <span>
              This record is <b>posted</b> (voucher {editDetail?.VoucherNo}). Saving reverses that accounting entry and returns it to Draft —
              use <b>Save &amp; Post</b> to post it again with the new values.
            </span>
          </div>
        )}

        <Block title="Header">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <Field label="Company" required>
              <select value={form.companyId} disabled={isEdit} className={INP}
                onChange={(e) => setForm((p) => ({ ...p, companyId: e.target.value, projectId: "", itemName: "", assetId: "" }))}>
                <option value="">Select company…</option>
                {ensureArray<{ id: number; label: string }>(companies).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
            <Field label="Project" required>
              <select value={form.projectId} disabled={!form.companyId || isEdit} className={INP}
                onChange={(e) => setForm((p) => ({ ...p, projectId: e.target.value, itemName: "", assetId: "" }))}>
                <option value="">Select project…</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="Doc number">
              <div className={READ_ONLY} title="Generated by the system when the record is saved">{form.docNo || "Auto-generated on save"}</div>
            </Field>
            <Field label="Doc date" required>
              <DateInput value={form.docDate} onChange={(e) => setField("docDate", e.target.value)} className={INP} />
            </Field>
          </div>
        </Block>

        <Block
          title="Fixed asset"
          note={!form.companyId || !form.projectId ? "Pick the company and project to load their valid, active fixed assets." : undefined}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Item" required>
              <ItemPicker items={itemNames} value={form.itemName} loading={loadingAssets}
                disabled={!form.companyId || !form.projectId || isEdit}
                onSelect={(name) => setForm((p) => ({ ...p, itemName: name, assetId: "" }))} />
            </Field>
            <Field
              label="FA Item Code"
              required
              note={
                form.itemName && !isEdit
                  ? loadingCodes
                    ? "Loading FA Item Codes…"
                    : codesForItem.length === 0
                      ? <span className="text-destructive">No FA Item Code found for this item.</span>
                      : `${codesForItem.length} FA Item Code${codesForItem.length > 1 ? "s" : ""} for “${form.itemName}”.`
                  : undefined
              }
            >
              <CodePicker assets={codesForItem} value={form.assetId} disabled={!form.itemName || isEdit}
                onSelect={(a) => setField("assetId", String(a.AssetId))} />
            </Field>
          </div>
          {form.companyId && form.projectId && itemNames.length === 0 && !loadingAssets && (
            <p className="text-[0.6875rem] text-destructive">No valid, active fixed asset records for this company and project.</p>
          )}
        </Block>

        <Block title="Repair">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Field label="Vendor" required>
              <select value={form.vendorId} onChange={(e) => setField("vendorId", e.target.value)} className={INP}>
                <option value="">Select vendor…</option>
                {vendorList.map((v) => <option key={v.id} value={v.id}>{v.label}{v.code ? ` (${v.code})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Repair expense type" required>
              <select value={form.repairExpenseType} onChange={(e) => setField("repairExpenseType", e.target.value as RepairExpenseType)} className={INP}>
                <option value="">Select…</option>
                {REPAIR_EXPENSE_TYPES.map((t) => <option key={t} value={t}>{REPAIR_EXPENSE_LABEL[t]}</option>)}
              </select>
            </Field>
            <Field
              label="Repair amount (taxable)"
              required
              note={
                form.assetId && !sacInfo.code
                  ? <span className="text-destructive">No SAC Code for this FA Item Code — set it on the Fixed Asset Depreciation Tag before posting.</span>
                  : sacInfo.code && gst != null && taxable > 0
                    ? `SAC ${sacInfo.code} · GST ${sacInfo.ratePct}% = ₹${fmtAmt(gst)} · total ₹${fmtAmt(round2(taxable + gst))}`
                    : undefined
              }
            >
              <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setField("amount", e.target.value)} placeholder="0.00" className={`${INP} tabular-nums`} />
            </Field>
            <Field label="Remarks" className="sm:col-span-2 lg:col-span-3">
              <textarea value={form.remarks} onChange={(e) => setField("remarks", e.target.value)} rows={3}
                placeholder="Nature of the repair or maintenance…" className={`${INP} h-auto py-2`} />
            </Field>
          </div>
        </Block>

        <Block
          title="Accounting entry"
          note="Repair expense Dr · GST credit Dr · Vendor Cr"
        >
          {!preview ? (
            <p className="text-xs text-muted-foreground">Pick the FA Item Code, vendor, repair expense type and amount to see the entry it will post.</p>
          ) : preview.error ? (
            <p className="flex items-center gap-2 text-xs text-destructive"><AlertTriangle size={13} className="shrink-0" /> {preview.error}</p>
          ) : (
            <>
              <PostingTable plan={preview} />
              <p className="text-[0.6875rem] text-muted-foreground">
                The expense account comes from the repair expense type, the GST rate from the SAC Code set against the FA Item Code
                (Fixed Asset Depreciation Tag → HSN master), and the credit goes to the vendor's ledger.
              </p>
            </>
          )}
        </Block>
      </div>

      {/* ── Summary and actions ── */}
      <aside className="bg-card xl:sticky xl:top-20" style={{ border: RULE }}>
        <div className="px-4 py-3" style={{ borderBottom: RULE }}>
          <p className={LBL}>{isEdit ? `Editing ${editDetail?.DocNo || ""}` : "New maintenance & repair"}</p>
          <p className="font-heading text-base font-bold text-foreground truncate">{form.itemName || "No asset yet"}</p>
          <p className="text-[0.6875rem] text-muted-foreground font-heading tabular-nums truncate">{selectedAsset?.FAItemCode || editDetail?.FAItemCode || "Pick an FA Item Code"}</p>
        </div>
        <dl className="px-4 py-2 text-xs">
          {[
            ["Company", companyLabel],
            ["Project", projectLabel],
            ["Vendor", vendorLabel],
            ["Type", form.repairExpenseType ? REPAIR_EXPENSE_LABEL[form.repairExpenseType] : ""],
            ["Taxable", taxable > 0 ? `₹${fmtAmt(taxable)}` : ""],
            ["GST", gst != null && taxable > 0 ? `${sacInfo.ratePct}% · ₹${fmtAmt(gst)}` : ""],
            ["Total", gst != null && taxable > 0 ? `₹${fmtAmt(round2(taxable + gst))}` : ""],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 py-1.5" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.1)" }}>
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="font-medium text-right truncate">{v || "—"}</dd>
            </div>
          ))}
        </dl>
        <div className="px-4 py-3 grid gap-2" style={{ borderTop: RULE }}>
          <button onClick={handleSaveAndPost} disabled={busy} className={`${KEY_INK} h-10 px-3`}>
            {postMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {busy ? "Working…" : "Save & post"}
          </button>
          <button onClick={handleSave} disabled={busy} className={`${KEY_LINE} h-10 px-3`}>
            {createMut.isPending || updateMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {isEdit ? (wasPosted ? "Save & unpost" : "Update draft") : "Save draft"}
          </button>
          <button onClick={onClose} className={`${KEY_LINE} h-10 px-3`}>Cancel</button>
        </div>
      </aside>
    </div>
  );
}
