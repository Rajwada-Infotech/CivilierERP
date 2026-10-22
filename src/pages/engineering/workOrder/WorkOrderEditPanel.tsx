// Editing a saved work order.
import React, { useState, useMemo, useEffect } from "react";
import { Plus, Save, Building2, FolderPlus, Calculator, IndianRupee, FileText, Calendar, Hash, User, Layers, X, Check, Package, Hammer, Receipt, AlertCircle, PenSquare, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { saveFullWorkOrder, confirmWorkOrder, fetchCompanies, fetchProjects, fetchContractors, fetchSuppliers, fetchActivityGroups, fetchActivities, fetchItems, getWorkOrder } from "@/api/workOrderApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getTCRecords } from "@/api/tcMasterApi";
import { useQuery } from "@tanstack/react-query";
import { getHsn } from "@/api/hsnApi";
import { DateInput } from "@/components/ui/date-input";
import { BodyPortal } from "@/components/ui/body-portal";
import { filterProjectsByCompany, projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { MaterialItem, WOGSTType, Activity, ActivityGroup, WorkOrderForm, DropdownOption, TCRecord, ItemOption, ActivityOption, WorkOrderMaterialDetail, WorkOrderActivityDetail, uid, fmt, ensureArray, EMPTY_FORM, EMPTY_GROUP, actLabour, matCost, fetchBoqGroups, inputCls, selectCls, FieldLabel, SelectSkeleton } from "./config";
import { ActivityGroupCard } from "./ActivityGroupCard";

// ─── VIEW: Work Order Edit Panel ──────────────────────────────────────────────

export const WorkOrderEditPanel: React.FC<{
  workOrderId: number;
  onBack: () => void;
  onSaved: (id: number) => void;
}> = ({ workOrderId, onBack, onSaved }) => {
  const { currentUser } = useAuth();
  const { data: hsnData } = useQuery({
    queryKey: ["hsn"],
    queryFn: getHsn,
    staleTime: 5 * 60 * 1000,
  });
  // Work Order is engineering-side (services), so only SAC-flagged HSN
  // Master rows are offered here — plain HSN (goods) codes are hidden.
  const hsnRecords = Array.isArray(hsnData)
    ? hsnData
        .filter((h: any) => h.HIsSAC === true)
        .map((h: any) => ({
          code: h.HCode,
          shortDesc: h.HShortDescription || h.HCode,
          description: h.HDescription || "",
          igstRate: h.HIGST ?? 0,
          cgstRate: h.HCGST ?? 0,
          sgstRate: h.HSGST ?? 0,
          status: !!h.HStatus,
        }))
    : [];
  const userId = (currentUser as unknown as { id?: number } | null)?.id ?? 1;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const [form, setFormState] = useState<WorkOrderForm>(EMPTY_FORM());
  const [groups, setGroups] = useState<ActivityGroup[]>([EMPTY_GROUP()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const [companies, setCompanies] = useState<DropdownOption[]>([]);
  const [projects, setProjects] = useState<DropdownOption[]>([]);
  const [contractors, setContractors] = useState<DropdownOption[]>([]);
  const [suppliers, setSuppliers] = useState<DropdownOption[]>([]);
  const [approvedBoqs, setApprovedBoqs] = useState<
    Array<{
      id: number;
      name: string;
      CompanyId: number | null;
      ProjectId: number | null;
      TotalAmount: number;
    }>
  >([]);
  const [activityGroupOptions, setActivityGroupOptions] = useState<
    DropdownOption[]
  >([]);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [uomOptions, setUomOptions] = useState<DropdownOption[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [loadingDropdowns, setLoadingDropdowns] = useState(true);
  const [dropdownError, setDropdownError] = useState<string | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [tcRecords, setTcRecords] = useState<TCRecord[]>([]);
  const [selectedTCs, setSelectedTCs] = useState<TCRecord[]>([]);
  const [tcDropdownOpen, setTcDropdownOpen] = useState(false);

  // Load dropdowns + existing work order data
  useEffect(() => {
    const loadAll = async () => {
      setLoading(true);
      setLoadingDropdowns(true);
      setDropdownError(null);
      try {
        const [
          comp,
          proj,
          cont,
          supp,
          grps,
          acts,
          uomsRaw,
          detail,
          items,
          tcRaw,
          boqsRaw,
        ] = await Promise.all([
          fetchCompanies(),
          fetchProjects(),
          fetchContractors(),
          fetchSuppliers(),
          fetchActivityGroups(),
          fetchActivities(),
          fetchWithAuth("/api/uom-master").then((r) =>
            r.ok
              ? r.json().then((rows: any[]) =>
                  rows
                    .filter((u) => u.IsActive !== false)
                    .map((u) => ({
                      id: u.Id,
                      name: u.UOMName,
                      uomCode: u.UOMCode,
                    })),
                )
              : [],
          ),
          getWorkOrder(workOrderId),
          fetchItems(),
          getTCRecords().catch(() => []),
          fetchWithAuth("/api/engineering/approved-boqs").then((r) =>
            r.ok ? r.json() : [],
          ),
        ]);
        const parsedTCs: TCRecord[] = (Array.isArray(tcRaw) ? tcRaw : [])
          .filter((t: any) => t.isActive !== false)
          .map((t: any) => ({
            id: Number(t.Id),
            name: String(t.Name ?? ""),
            terms: String(t.TermsAndCondition ?? ""),
          }));
        setTcRecords(parsedTCs);
        setCompanies(ensureArray<DropdownOption>(comp));
        setProjects(ensureArray<DropdownOption>(proj));
        setContractors(ensureArray<DropdownOption>(cont));
        setSuppliers(ensureArray<DropdownOption>(supp));
        setApprovedBoqs(Array.isArray(boqsRaw) ? boqsRaw : []);
        setActivityGroupOptions(ensureArray<DropdownOption>(grps));
        const rawActs = ensureArray<ActivityOption>(acts);
        setActivityOptions(
          rawActs.map((a) => ({
            ...a,
            groupId:
              a.groupId !== undefined && a.groupId !== null
                ? Number(a.groupId)
                : undefined,
          })),
        );
        setUomOptions(ensureArray<DropdownOption>(uomsRaw));
        setItemOptions(ensureArray<ItemOption>(items));

        // Pre-populate form from loaded detail
        const compList = ensureArray<DropdownOption>(comp);
        const projList = ensureArray<DropdownOption>(proj);
        const contList = ensureArray<DropdownOption>(cont);
        const suppList = ensureArray<DropdownOption>(supp);
        const compId =
          compList.find((c) => c.name === detail.CompanyName)?.id ?? "";
        const projId =
          projList.find((p) => p.name === detail.ProjectName)?.id ?? "";
        const contId =
          contList.find((c) => c.name === detail.ContractorName)?.id ?? "";
        const suppId =
          suppList.find((s) => s.name === detail.SupplierName)?.id ??
          detail.SupplierId ??
          "";

        setFormState({
          boqId: detail.BoqID ? String(detail.BoqID) : "",
          companyId: compId ? String(compId) : "",
          projectId: projId ? String(projId) : "",
          docNumber: detail.DocumentNumber || "",
          docDate: detail.DocumentDate
            ? detail.DocumentDate.slice(0, 10)
            : new Date().toISOString().slice(0, 10),
          contractorId: contId ? String(contId) : "",
          supplierId: suppId ? String(suppId) : "",
          remarks: detail.Remarks || "",
          termsAndConditions: detail.TermsAndConditions || "",
        });

        // Map server activities → local ActivityGroup[]
        const serverActs: WorkOrderActivityDetail[] =
          ensureArray<WorkOrderActivityDetail>(detail.activities);
        // Group by ActivityGroupName to reconstruct ActivityGroup[]
        const groupMap: Record<string, WorkOrderActivityDetail[]> = {};
        serverActs.forEach((a) => {
          const key = a.ActivityGroupName || "Ungrouped";
          if (!groupMap[key]) groupMap[key] = [];
          groupMap[key].push(a);
        });

        const reconstructed: ActivityGroup[] = Object.entries(groupMap).map(
          ([groupName, acts]) => {
            // Use ActivityGroupId directly from the first activity in this group
            const rawGroupId = acts[0]?.ActivityGroupId ?? null;
            return {
              id: uid(),
              groupId: rawGroupId ? Number(rawGroupId) : null,
              name: groupName,
              expanded: true,
              activities: acts.map((a) => {
                return {
                  id: uid(),
                  // Use raw ActivityId from the DB row — reliable, no name-matching needed
                  activityId: a.ActivityId ? Number(a.ActivityId) : null,
                  // Store the DB row Id so save-full can UPDATE instead of INSERT
                  dbId: a.Id,
                  name: a.ActivityName || "",
                  uomId: a.UOMId ? Number(a.UOMId) : null,
                  unit: a.UOMName || "",
                  ratePerUnit: a.Rate || 0,
                  area: a.Area || 0,
                  hsnCode: a.HsnCode || "",
                  hsnGstRate: a.HsnGstRate ? Number(a.HsnGstRate) : 0,
                  hsnGstType: (a.HsnGstType as WOGSTType) || "cgst_sgst",
                  materials: ensureArray<WorkOrderMaterialDetail>(
                    a.materials,
                  ).map((m) => {
                    return {
                      id: uid(),
                      // Store the DB row Id so save-full can UPDATE instead of INSERT
                      dbId: m.Id,
                      itemId: m.ItemIdStr || (m.ItemId ? String(m.ItemId) : ""),
                      itemName: m.ItemName || "",
                      // Quantity stored in DB is the consumption ratio per unit area
                      consumptionRatio: m.Quantity || 0,
                      uomId: m.UOMId ? Number(m.UOMId) : null,
                      unit: m.UOMName || "",
                      price: m.Rate || 0,
                      gstRate: Number(m.GSTRate) || 0,
                      supplierId: m.SupplierIdPerLine
                        ? Number(m.SupplierIdPerLine)
                        : null,
                      supplierName: m.SupplierNamePerLine || "",
                    };
                  }),
                };
              }),
            };
          },
        );

        setGroups(reconstructed.length > 0 ? reconstructed : [EMPTY_GROUP()]);
      } catch (err) {
        console.error("Failed to load edit data:", err);
        setError("Failed to load work order for editing.");
      } finally {
        setLoading(false);
        setLoadingDropdowns(false);
        setLoadingItems(false);
      }
    };
    loadAll();
  }, [workOrderId]);

  const { grandLabourTotal, grandMaterialsTotal, grandHsnGst, grandTotal } =
    useMemo(() => {
      let labour = 0;
      let materials = 0;
      let hsnGst = 0;
      for (const g of groups) {
        for (const a of g.activities) {
          const aLabour = actLabour(a);
          const aMaterials = a.materials.reduce(
            (s, m) => s + matCost(m, a),
            0,
          );
          const aSubtotal = aLabour + aMaterials;
          labour += aLabour;
          materials += aMaterials;
          hsnGst += a.hsnGstRate > 0 ? (aSubtotal * a.hsnGstRate) / 100 : 0;
        }
      }
      return {
        grandLabourTotal: labour,
        grandMaterialsTotal: materials,
        grandHsnGst: hsnGst,
        grandTotal: labour + materials + hsnGst,
      };
    }, [groups]);

  const setField = (key: keyof WorkOrderForm, value: string) => {
    setFormState((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: false }));
  };

  const addGroup = () => setGroups((prev) => [...prev, EMPTY_GROUP()]);
  const updateGroup = (idx: number, updated: ActivityGroup) =>
    setGroups((prev) => prev.map((g, i) => (i === idx ? updated : g)));
  const deleteGroup = (idx: number) =>
    setGroups((prev) => prev.filter((_, i) => i !== idx));

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.companyId) e.companyId = true;
    if (!form.projectId) e.projectId = true;
    if (!form.docDate) e.docDate = true;
    if (!form.contractorId) e.contractorId = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await confirmWorkOrder(workOrderId, null);
      toast.success("Work order confirmed.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg || "Confirm failed.");
    } finally {
      setConfirming(false);
    }
  };

  const handleSave = async () => {
    if (!validate()) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      const activities = groups.flatMap((g) =>
        g.activities.map((a) => ({
          // Pass the DB row Id so save-full does UPDATE instead of INSERT
          Id: (a as Activity & { dbId?: number }).dbId ?? undefined,
          ActivityGroupId: g.groupId ?? null,
          ActivityId: a.activityId ?? null,
          UOMId: a.uomId ?? null,
          Rate: a.ratePerUnit || null,
          Area: a.area || null,
          LabourAmount: actLabour(a) || null,
          MaterialAmount:
            a.materials.reduce(
              (s, m) => s + matCost(m, a),
              0,
            ) || null,
          GrandTotal:
            actLabour(a) +
              a.materials.reduce(
                (s, m) => s + matCost(m, a),
                0,
              ) || null,
          Remarks: null,
          HsnCode: a.hsnCode || null,
          HsnGstRate: a.hsnGstRate || null,
          HsnGstType: a.hsnGstType || null,
          UpdatedBy: userId,
          materials: a.materials
            .filter((m) => m.itemId && m.itemId.trim() !== "")
            .map((m) => ({
              // Pass the DB row Id so save-full does UPDATE instead of INSERT
              Id: (m as MaterialItem & { dbId?: number }).dbId ?? undefined,
              ItemId: m.itemId,
              UOMId: m.uomId ?? null,
              Quantity: m.consumptionRatio || null,
              Rate: m.price || null,
              GSTRate: m.gstRate ?? 0,
              SupplierIdPerLine: m.supplierId ?? null,
              Remarks: null,
              UpdatedBy: userId,
            })),
        })),
      );
      await saveFullWorkOrder(workOrderId, {
        header: {
          BoqID: form.boqId ? parseInt(form.boqId) : null,
          CompanyId: parseInt(form.companyId),
          ProjectId: parseInt(form.projectId),
          DocumentDate: form.docDate,
          ContractorId: parseInt(form.contractorId),
          SupplierId: form.supplierId ? parseInt(form.supplierId) : undefined,
          TotalAmount: grandTotal,
          Remarks: form.remarks || null,
          TermsAndConditions:
            selectedTCs.length > 0
              ? selectedTCs.map((tc) => `${tc.name}: ${tc.terms}`).join("\n\n")
              : form.termsAndConditions || null,
          UpdatedBy: userId,
        },
        activities,
      });
      toast.success("Work order updated successfully!");
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onSaved(workOrderId);
      }, 1500);
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      toast.error(msg || "Failed to update work order.");
    } finally {
      setSaving(false);
    }
  };

  const renderSelect = (
    id: string,
    value: string,
    onChange: (v: string) => void,
    options: DropdownOption[],
    placeholder: string,
    hasError: boolean,
  ) => {
    if (loadingDropdowns) return <SelectSkeleton />;
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${selectCls} ${hasError ? "border-destructive" : ""}`}
      >
        <option value="">
          {options.length === 0
            ? `No ${placeholder.toLowerCase()} found`
            : `${placeholder}…`}
        </option>
        {options.map((o) => (
          <option key={o.id} value={String(o.id)}>
            {o.name}
          </option>
        ))}
      </select>
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="border border-foreground/30 bg-card p-5 animate-pulse"
          >
            <div className="h-4 bg-card w-1/3 mb-3" />
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((j) => (
                <div key={j} className="h-10 bg-card" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-destructive dark:border-destructive bg-destructive/10 dark:bg-destructive/10 p-6 text-center">
        <AlertCircle size={24} className="text-destructive mx-auto mb-2" />
        <p className="text-sm text-destructive dark:text-destructive">{error}</p>
        <button
          onClick={onBack}
          className="mt-3 text-xs text-primary underline"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Back bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={15} />
          <span>Back to Detail</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 border border-foreground/30 text-sm text-muted-foreground hover:bg-primary/5 transition-colors"
          >
            <X size={13} />
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={confirming || saving}
            className="flex items-center gap-2 px-3 py-2 border border-foreground/40 text-foreground text-sm font-semibold hover:bg-primary/5 disabled:opacity-60 transition-colors"
          >
            {confirming ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-foreground/40 border-t-emerald-500 animate-spin" />
                <span>Confirming…</span>
              </>
            ) : (
              <>
                <Check size={14} />
                <span className="hidden sm:inline">Confirm WO</span>
              </>
            )}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loadingDropdowns}
            className="flex items-center gap-2 px-4 py-2 bg-foreground text-card border border-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {saving ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white animate-spin" />
                <span>Saving…</span>
              </>
            ) : saved ? (
              <>
                <Check size={14} />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <Save size={14} />
                <span>Update Work Order</span>
              </>
            )}
          </button>
        </div>
      </div>

      {dropdownError && (
        <div className="mb-4 flex items-start gap-2 border border-foreground/40 bg-card px-4 py-3">
          <AlertCircle size={15} className="text-foreground shrink-0 mt-0.5" />
          <p className="text-sm text-foreground">
            {dropdownError}
          </p>
        </div>
      )}

      {/* Header card */}
      <div className="border border-foreground/30 bg-card mb-5">
        <div className="px-4 sm:px-5 py-3.5 border-b border-foreground/30 flex items-center gap-2">
          <PenSquare size={15} className="text-primary shrink-0" />
          <h2 className="text-sm font-semibold text-foreground">
            Edit Work Order
          </h2>
          <span className="ml-auto font-heading text-xs text-muted-foreground bg-card px-2 py-0.5 shrink-0">
            {form.docNumber}
          </span>
        </div>
        <div className="divide-y divide-foreground/10">
          {/* ── Section 1: Project Configuration ── */}
          <div className="px-4 sm:px-5 py-4">
            <div className="flex items-center gap-2 mb-3.5">
              <div className="w-1 h-4 bg-primary/60 shrink-0" />
              <span className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-[0.12em]">
                Project Configuration
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* ── BOQ Link ────────────────────────────────────────────── */}
              <div>
                <FieldLabel>
                  <span className="flex items-center gap-1.5">
                    <FileText size={11} />
                    Linked BOQ
                  </span>
                  <span className="invisible text-destructive ml-0.5">*</span>
                </FieldLabel>
                <select
                  value={form.boqId}
                  onChange={async (e) => {
                    const boqId = e.target.value;
                    const boq = approvedBoqs.find(
                      (b) => String(b.id) === boqId,
                    );
                    setFormState((prev) => ({
                      ...prev,
                      boqId,
                      companyId: boq?.CompanyId
                        ? String(boq.CompanyId)
                        : prev.companyId,
                      projectId: boq?.ProjectId
                        ? String(boq.ProjectId)
                        : prev.projectId,
                    }));
                    // Inherit BOQ activities as WO activity groups
                    if (boqId) {
                      try {
                        const inheritedGroups = await fetchBoqGroups(boqId);
                        if (inheritedGroups.length > 0) setGroups(inheritedGroups);
                      } catch {
                        /* non-fatal */
                      }
                    }
                  }}
                  className="w-full border border-input bg-card px-3 py-1.5 text-sm focus:outline-none"
                >
                  <option value="">— None —</option>
                  {approvedBoqs.map((b) => (
                    <option key={b.id} value={String(b.id)}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {form.boqId && (
                  <p className="text-[0.625rem] text-muted-foreground mt-1">
                    Company &amp; Project auto-filled from BOQ
                  </p>
                )}
              </div>
              <div>
                <FieldLabel required>
                  <span className="flex items-center gap-1.5">
                    <Building2 size={11} />
                    Company Name
                  </span>
                </FieldLabel>
                {renderSelect(
                  "companyId",
                  form.companyId,
                  (v) => {
                    setField("companyId", v);
                    setFormState((p) => p.projectId && !projectBelongsToCompany((projects as ProjectCompanyLike[]).find((x) => String((x as any).id) === p.projectId) ?? {}, v) ? { ...p, projectId: "" } : p);
                    },
                  companies,
                  "Select company",
                  errors.companyId ?? false,
                )}
                {errors.companyId && (
                  <p className="text-xs text-destructive mt-1">Required</p>
                )}
              </div>
              <div>
                <FieldLabel required>
                  <span className="flex items-center gap-1.5">
                    <Layers size={11} />
                    Project Name
                  </span>
                </FieldLabel>
                {renderSelect(
                  "projectId",
                  form.projectId,
                  (v) => setField("projectId", v),
                  filterProjectsByCompany(projects as ProjectCompanyLike[], form.companyId) as unknown as DropdownOption[],
                  "Select project",
                  errors.projectId ?? false,
                )}
                {errors.projectId && (
                  <p className="text-xs text-destructive mt-1">Required</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Section 2: Document Configuration ── */}
          <div className="px-4 sm:px-5 py-4">
            <div className="flex items-center gap-2 mb-3.5">
              <div className="w-1 h-4 bg-card shrink-0" />
              <span className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-[0.12em]">
                Document Configuration
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel>
                  <span className="flex items-center gap-1.5">
                    <Hash size={11} />
                    Document Number
                  </span>
                </FieldLabel>
                <input
                  value={form.docNumber}
                  readOnly
                  className={`${inputCls} bg-card text-muted-foreground font-heading cursor-not-allowed`}
                />
                <p className="text-[0.6875rem] text-muted-foreground mt-1">
                  Auto-generated
                </p>
              </div>
              <div>
                <FieldLabel required>
                  <span className="flex items-center gap-1.5">
                    <Calendar size={11} />
                    Document Date
                  </span>
                </FieldLabel>
                <div className="relative">
                  <Calendar
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                    size={14}
                  />
                  <DateInput
                    value={form.docDate}
                    onChange={(e) => setField("docDate", e.target.value)}
                    className={`w-full pl-8 pr-3 py-2 text-sm bg-card border text-foreground focus:outline-none transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${errors.docDate ? "border-destructive" : "border-foreground/30"}`}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Section 3: Parties & Amount ── */}
          <div className="px-4 sm:px-5 py-4">
            <div className="flex items-center gap-2 mb-3.5">
              <div className="w-1 h-4 bg-card shrink-0" />
              <span className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-[0.12em]">
                Parties &amp; Amount
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <FieldLabel required>
                  <span className="flex items-center gap-1.5">
                    <User size={11} />
                    Contractor
                  </span>
                </FieldLabel>
                {renderSelect(
                  "contractorId",
                  form.contractorId,
                  (v) => setField("contractorId", v),
                  contractors,
                  "Select contractor",
                  errors.contractorId ?? false,
                )}
                {errors.contractorId && (
                  <p className="text-xs text-destructive mt-1">Required</p>
                )}
              </div>
              <div>
                <FieldLabel>
                  <span className="flex items-center gap-1.5">
                    <User size={11} />
                    Supplier
                  </span>
                  <span className="invisible text-destructive ml-0.5">*</span>
                </FieldLabel>
                {renderSelect(
                  "supplierId",
                  form.supplierId,
                  (v) => setField("supplierId", v),
                  suppliers,
                  "Select supplier",
                  false,
                )}
              </div>
              <div>
                <FieldLabel>
                  <span className="flex items-center gap-1.5">
                    <IndianRupee size={11} />
                    Total Amount
                  </span>
                  <span className="invisible text-destructive ml-0.5">*</span>
                </FieldLabel>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    ₹
                  </span>
                  <input
                    readOnly
                    value={grandTotal > 0 ? grandTotal.toFixed(2) : ""}
                    placeholder="Calculated from activities"
                    className={`${inputCls} pl-7 bg-card text-muted-foreground cursor-not-allowed`}
                  />
                </div>
                <p className="text-[0.6875rem] text-muted-foreground mt-1">
                  Auto-calculated from activities
                </p>
              </div>
            </div>
          </div>

          {/* ── Section 4: Notes & Terms ── */}
          <div className="px-4 sm:px-5 py-4">
            <div className="flex items-center gap-2 mb-3.5">
              <div className="w-1 h-4 bg-card shrink-0" />
              <span className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-[0.12em]">
                Notes &amp; Terms
              </span>
            </div>
            <div className="mb-4">
              <FieldLabel>Remarks</FieldLabel>
              <input
                value={form.remarks}
                onChange={(e) => setField("remarks", e.target.value)}
                placeholder="Any additional remarks…"
                className={inputCls}
              />
            </div>
            <div>
              <FieldLabel>Terms &amp; Conditions</FieldLabel>
              {/* T&C Picker from TCMaster */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setTcDropdownOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition mb-2"
                >
                  <Plus size={13} />
                  Add T&amp;C
                </button>
                {tcDropdownOpen && (
                  <>
                    <BodyPortal><div
                      className="fixed inset-0 z-[99]"
                      onClick={() => setTcDropdownOpen(false)}
                    /></BodyPortal>
                    <div className="absolute left-0 top-full mt-1 z-[100] w-80 border border-foreground/30 bg-card overflow-hidden">
                      <div className="px-3 py-2 border-b border-foreground/30">
                        <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider">
                          Select Terms &amp; Conditions
                        </p>
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-foreground/10">
                        {tcRecords.length === 0 ? (
                          <p className="px-4 py-6 text-xs text-center text-muted-foreground">
                            No T&amp;C records found
                          </p>
                        ) : (
                          tcRecords.map((tc) => {
                            const isSelected = selectedTCs.some(
                              (s) => s.id === tc.id,
                            );
                            return (
                              <button
                                key={tc.id}
                                type="button"
                                onClick={() =>
                                  setSelectedTCs((prev) =>
                                    isSelected
                                      ? prev.filter((s) => s.id !== tc.id)
                                      : [...prev, tc],
                                  )
                                }
                                className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-primary/5 transition ${isSelected ? "bg-primary/5" : ""}`}
                              >
                                <span
                                  className={`mt-0.5 flex-shrink-0 w-4 h-4 border flex items-center justify-center transition ${isSelected ? "bg-primary border-primary" : "border-foreground/30"}`}
                                >
                                  {isSelected && (
                                    <Check
                                      size={10}
                                      className="text-primary-foreground"
                                    />
                                  )}
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="block text-sm font-medium text-foreground truncate">
                                    {tc.name}
                                  </span>
                                  <span className="block text-[0.6875rem] text-muted-foreground truncate mt-0.5">
                                    {tc.terms}
                                  </span>
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                      <div className="px-3 py-2 border-t border-foreground/30">
                        <button
                          type="button"
                          onClick={() => setTcDropdownOpen(false)}
                          className="w-full text-xs text-center text-muted-foreground hover:text-foreground transition py-1"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
              {/* Selected T&C list */}
              {selectedTCs.length > 0 ? (
                <div className="space-y-2">
                  {selectedTCs.map((tc, idx) => (
                    <div
                      key={tc.id}
                      className="flex items-start gap-3 border border-foreground/30 bg-card px-4 py-3"
                    >
                      <span className="flex-shrink-0 w-5 h-5 bg-primary/10 text-primary text-[0.625rem] font-bold flex items-center justify-center mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {tc.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
                          {tc.terms}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedTCs((prev) =>
                            prev.filter((s) => s.id !== tc.id),
                          )
                        }
                        className="flex-shrink-0 p-1 hover:bg-destructive/10 dark:hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No terms selected. Click &quot;Add T&amp;C&quot; to pick from
                  master.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="border border-foreground/30 bg-card mb-5">
        <div className="px-4 sm:px-5 py-3.5 border-b border-foreground/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Calculator size={15} className="text-primary shrink-0" />
            <h2 className="text-sm font-semibold text-foreground">
              Activity Details
            </h2>
            <span className="text-xs text-muted-foreground bg-card px-2 py-0.5 hidden sm:block">
              {groups.length}g ·{" "}
              {groups.reduce((s, g) => s + g.activities.length, 0)}a
            </span>
          </div>
          <button
            onClick={addGroup}
            className="flex items-center gap-1.5 px-3 py-2 bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors shrink-0"
          >
            <FolderPlus size={13} />
            <span className="hidden sm:inline">Add Group</span>
            <span className="sm:hidden">Group</span>
          </button>
        </div>
        <div className="p-3 space-y-3">
          {groups.map((group, idx) => (
            <ActivityGroupCard
              key={group.id}
              group={group}
              index={idx}
              onUpdate={(updated) => updateGroup(idx, updated)}
              onDelete={() => deleteGroup(idx)}
              canDelete={groups.length > 1}
              activityGroupOptions={activityGroupOptions}
              activityOptions={activityOptions}
              uomOptions={uomOptions}
              itemOptions={itemOptions}
              suppliers={suppliers}
              loadingDropdowns={loadingDropdowns}
              loadingItems={loadingItems}
              hsnRecords={hsnRecords}
            />
          ))}
        </div>
        <div className="border-t border-foreground/30 bg-card">
          <div className="grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-foreground/10">
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Package size={11} className="text-foreground" />
                Raw Materials
              </span>
              <span className="text-base font-bold text-foreground">
                {fmt(grandMaterialsTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Hammer size={11} className="text-foreground" />
                Labour
              </span>
              <span className="text-base font-bold text-foreground">
                {fmt(grandLabourTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Receipt size={11} className="text-foreground" />
                SAC GST
              </span>
              <span className="text-base font-bold text-foreground">
                {fmt(grandHsnGst)}
              </span>
            </div>
            <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3 bg-card">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <Receipt size={11} className="text-primary" />
                Grand Total (incl. GST)
              </span>
              <span className="text-xl font-bold text-foreground">
                {fmt(grandTotal)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-end gap-3 pb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 border border-foreground/30 text-sm text-muted-foreground hover:bg-primary/5 transition-colors"
        >
          <X size={13} />
          Cancel
        </button>
        <button
          onClick={() => void handleConfirm()}
          disabled={confirming || saving}
          className="flex items-center gap-2 px-4 py-2.5 border border-foreground/40 text-foreground text-sm font-semibold hover:bg-primary/5 disabled:opacity-60 transition-colors"
        >
          {confirming ? (
            <>
              <span className="w-4 h-4 border-2 border-foreground/40 border-t-emerald-500 animate-spin" />
              Confirming…
            </>
          ) : (
            <>
              <Check size={14} />
              Confirm WO
            </>
          )}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || loadingDropdowns}
          className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-card border border-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {saving ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
              Saving…
            </>
          ) : saved ? (
            <>
              <Check size={14} />
              Saved!
            </>
          ) : (
            <>
              <Save size={14} />
              Update Work Order
            </>
          )}
        </button>
      </div>
    </>
  );
};
