// Work Orders. Parts under ./workOrder:
//   config (types, chain-status hook, helpers, styles) · WorkOrdersList · WorkOrderDetailPanel · WorkOrderEditPanel
//   ActivityGroupCard · ActivityRow · MaterialBreakdownModal · HsnPopover
import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EngineeringShell } from "@/components/engineering/EngineeringShell";
import { Plus, Save, RotateCcw, Building2, FolderPlus, Calculator, IndianRupee, FileText, Calendar, Hash, User, Layers, X, Check, Package, Hammer, Receipt, AlertCircle, PenSquare, List, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { usePageRights } from "@/hooks/usePageRights";
import { useFinYear } from "@/contexts/FinYearContext";
import { createWorkOrder, saveFullWorkOrder, fetchCompanies, fetchProjects, fetchContractors, fetchSuppliers, fetchActivityGroups, fetchActivities, fetchItems } from "@/api/workOrderApi";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalActions } from "@/components/ApprovalActions";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getTCRecords } from "@/api/tcMasterApi";
import { useQuery } from "@tanstack/react-query";
import { getHsn } from "@/api/hsnApi";
import { WorkOrderImportButtons } from "./WorkOrderImportModal";
import { DocNumberPreview, fetchNextDocNumber } from "@/pages/material/ExpenseBooking/DocNumberPreview";
import { DateInput } from "@/components/ui/date-input";
import { BodyPortal } from "@/components/ui/body-portal";
import { filterProjectsByCompany, projectBelongsToCompany, type ProjectCompanyLike } from "@/lib/projectBelongsTo";
import { Activity, ActivityGroup, WorkOrderForm, DropdownOption, TCRecord, ItemOption, ActivityOption, fmt, ensureArray, EMPTY_FORM, EMPTY_GROUP, actLabour, matCost, fetchBoqGroups, inputCls, selectCls, FieldLabel, SelectSkeleton } from "./workOrder/config";
import { ActivityGroupCard } from "./workOrder/ActivityGroupCard";
import { WorkOrderDetailPanel } from "./workOrder/WorkOrderDetailPanel";
import { WorkOrdersList } from "./workOrder/WorkOrdersList";
import { WorkOrderEditPanel } from "./workOrder/WorkOrderEditPanel";

// ─── Main Component ───────────────────────────────────────────────────────────

type ViewMode = "create" | "list" | "detail" | "edit";

const WorkOrderMaster: React.FC = () => {
  const { currentUser } = useAuth();
  const woRights = usePageRights("work-order");
  const { finYears } = useFinYear();
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
  const activeFinYear =
    finYears.find((fy) => fy.status === "Active")?.year || undefined;
  const finYearOptions = finYears.filter((fy) => fy.status === "Active" && !fy.locked);
  const [selectedFinYear, setSelectedFinYear] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!selectedFinYear && activeFinYear) {
      setSelectedFinYear(activeFinYear);
    }
  }, [activeFinYear, selectedFinYear]);

  // ── Tab state ─────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>("create");
  const [listKey, setListKey] = useState(0);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  // Deep link from the document chain: /engineering/work-order?view=<id> opens that Work Order.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const viewId = parseInt(searchParams.get("view") ?? "", 10);
    if (!Number.isFinite(viewId)) return;
    setSelectedOrderId(viewId);
    setViewMode("detail");
    searchParams.delete("view");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [form, setForm] = useState<WorkOrderForm>(EMPTY_FORM());
  const [groups, setGroups] = useState<ActivityGroup[]>([EMPTY_GROUP()]);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [savedStatus, setSavedStatus] = useState<string>("Draft");
  const [woDocTypeId, setWoDocTypeId] = useState<number | null>(null);
  const [woDocNo, setWoDocNo] = useState("");
  const [docRefreshTrigger, setDocRefreshTrigger] = useState(0);

  const applyWoDocNumber = (docTypeId: number | null, docNo: string) => {
    setWoDocTypeId(docTypeId);
    setWoDocNo(docNo);
    setForm((prev) => ({ ...prev, docNumber: docNo }));
  };

  const refreshWoDocNumber = async (
    docTypeId: number | null = woDocTypeId,
    finYearOverride = selectedFinYear,
  ) => {
    if (!docTypeId) {
      applyWoDocNumber(null, "");
      return "";
    }
    const nextDocNo = await fetchNextDocNumber(
      docTypeId,
      finYearOverride || undefined,
    );
    applyWoDocNumber(docTypeId, nextDocNo);
    setDocRefreshTrigger((current) => current + 1);
    return nextDocNo;
  };

  // ── Dropdown states ───────────────────────────────────────────────────────
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
  const [loadingItems, setLoadingItems] = useState(true);
  const [dropdownError, setDropdownError] = useState<string | null>(null);
  const [tcRecords, setTcRecords] = useState<TCRecord[]>([]);
  const [selectedTCs, setSelectedTCs] = useState<TCRecord[]>([]);
  const [tcDropdownOpen, setTcDropdownOpen] = useState(false);

  useEffect(() => {
    const loadDropdowns = async () => {
      setLoadingDropdowns(true);
      setDropdownError(null);
      try {
        const [comp, proj, cont, supp, grps, acts, uomsRaw, tcRaw, boqsRaw] =
          await Promise.all([
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
        setUomOptions(ensureArray<DropdownOption>(uomsRaw));
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
      } catch (err) {
        console.error("Failed to fetch dropdown data:", err);
        setDropdownError(
          "Some dropdown data could not be loaded. You can still fill in the form.",
        );
        toast.error("Failed to load some dropdown data");
        setCompanies([]);
        setProjects([]);
        setContractors([]);
        setSuppliers([]);
        setActivityGroupOptions([]);
        setActivityOptions([]);
        setUomOptions([]);
      } finally {
        setLoadingDropdowns(false);
      }
    };

    const loadItems = async () => {
      setLoadingItems(true);
      try {
        const items = await fetchItems();
        setItemOptions(ensureArray<ItemOption>(items));
      } catch {
        setItemOptions([]);
      } finally {
        setLoadingItems(false);
      }
    };

    loadDropdowns();
    loadItems();
  }, []);

  // ── Totals ────────────────────────────────────────────────────────────────
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
    setForm((p) => ({ ...p, [key]: value }));
    setErrors((p) => ({ ...p, [key]: false }));
  };

  const addGroup = () => setGroups((prev) => [...prev, EMPTY_GROUP()]);
  const updateGroup = (idx: number, updated: ActivityGroup) =>
    setGroups((prev) => prev.map((g, i) => (i === idx ? updated : g)));
  const deleteGroup = (idx: number) =>
    setGroups((prev) => prev.filter((_, i) => i !== idx));

  const resetAll = async (keepDocType = false) => {
    const nextDocTypeId = keepDocType ? woDocTypeId : null;
    const nextDocNo = nextDocTypeId
      ? await fetchNextDocNumber(nextDocTypeId, selectedFinYear || undefined)
      : "";
    setForm({ ...EMPTY_FORM(), docNumber: nextDocNo });
    setGroups([EMPTY_GROUP()]);
    setErrors({});
    setSaved(false);
    setSavedId(null);
    setSavedStatus("Draft");
    setWoDocTypeId(nextDocTypeId);
    setWoDocNo(nextDocNo);
    if (nextDocTypeId) {
      setDocRefreshTrigger((current) => current + 1);
    }
  };

  const validate = () => {
    const e: Record<string, boolean> = {};
    if (!form.companyId) e.companyId = true;
    if (!form.projectId) e.projectId = true;
    if (!form.docDate) e.docDate = true;
    if (!form.contractorId) e.contractorId = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) {
      toast.error("Please fill in all required fields.");
      return;
    }
    setSaving(true);
    try {
      const userId = parseInt(currentUser?.id ?? "1");
      const created = await createWorkOrder({
        BoqID: form.boqId ? parseInt(form.boqId) : null,
        CompanyId: parseInt(form.companyId),
        ProjectId: parseInt(form.projectId),
        DocumentNumber: form.docNumber,
        DocumentDate: form.docDate,
        ContractorId: parseInt(form.contractorId),
        SupplierId: form.supplierId ? parseInt(form.supplierId) : null,
        TotalAmount: grandTotal,
        Remarks: form.remarks || null,
        TermsAndConditions:
          selectedTCs.length > 0
            ? selectedTCs.map((tc) => `${tc.name}: ${tc.terms}`).join("\n\n")
            : form.termsAndConditions || null,
        DocTypeId: woDocTypeId,
        DocNo: form.docNumber || woDocNo || null,
        finYear: selectedFinYear || null,
        CreatedBy: userId,
      });
      const newHeaderId: number = created.Id;
      const confirmedDocNumber =
        created.DocumentNumber || created.DocNo || form.docNumber;
      const activities = groups.flatMap((g) =>
        g.activities.map((a) => {
          const labourAmt = actLabour(a);
          const materialAmt = a.materials.reduce(
            (s, m) => s + matCost(m, a),
            0,
          );
          return {
            ActivityGroupId: g.groupId ?? null,
            ActivityId: a.activityId ?? null,
            UOMId: a.uomId ?? null,
            Rate: a.ratePerUnit || null,
            Area: a.area || null,
            LabourAmount: labourAmt || null,
            MaterialAmount: materialAmt || null,
            GrandTotal: labourAmt + materialAmt || null,
            Remarks: null,
            HsnCode: a.hsnCode || null,
            HsnGstRate: a.hsnGstRate || null,
            HsnGstType: a.hsnGstType || null,
            materials: a.materials
              .filter((m) => m.itemId && m.itemId.trim() !== "")
              .map((m) => ({
                ItemId: m.itemId,
                UOMId: m.uomId ?? null,
                Quantity: m.consumptionRatio || null,
                Rate: m.price || null,
                GSTRate: m.gstRate ?? 0,
                SupplierIdPerLine: m.supplierId ?? null,
                Remarks: null,
                CreatedBy: userId,
              })),
          };
        }),
      );
      await saveFullWorkOrder(newHeaderId, {
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
          DocTypeId: woDocTypeId,
          DocNo: confirmedDocNumber || null,
          UpdatedBy: userId,
        },
        activities,
      });
      toast.success("Work order saved successfully!");
      setSaved(true);
      setSavedId(newHeaderId);
      setSavedStatus("Draft");
      await resetAll(!!woDocTypeId);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      let friendly = "Something went wrong. Please try again.";
      if (msg.includes("UNIQUE KEY") || msg.includes("duplicate key"))
        friendly = "A work order with this document number already exists.";
      else if (msg.includes("FK_WorkOrder_Com") || msg.includes("enterprise"))
        friendly = "The selected company doesn't exist.";
      else if (msg.includes("FK_WorkOrder_Project"))
        friendly = "The selected project doesn't exist.";
      else if (
        msg.includes("FK_WorkOrder_Contr") ||
        msg.includes("AccountHeadMaster")
      )
        friendly = "The selected contractor doesn't exist.";
      else if (msg.includes("FK_WOA") || msg.includes("WorkOrderActivities"))
        friendly = "One or more activities could not be saved.";
      else if (
        msg.includes("FK_WOAM") ||
        msg.includes("WorkOrderActivityMaterials")
      )
        friendly = "One or more materials could not be saved.";
      else if (
        msg.includes("FK_WOAM_Item") ||
        msg.includes("Item_Master_Group")
      )
        friendly = "One or more selected items don't exist in the item master.";
      else if (msg.includes("UQ_WOAM_Activity_Item"))
        friendly = "The same item cannot be added twice to the same activity.";
      else if (msg.includes("NOT NULL") || msg.includes("cannot be null"))
        friendly = "Some required fields are missing.";
      else if (msg.includes("FOREIGN KEY"))
        friendly = "A selected value references data that doesn't exist.";
      else if (msg.includes("Cannot insert") || msg.includes("INSERT"))
        friendly = "Could not save the work order. Please check all fields.";
      toast.error(friendly);
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
        className={`${selectCls} ${hasError ? "border-red-400" : ""}`}
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

  return (
    <>
      <style>{`
        .wo-select-arrow {
          appearance: none;
          -webkit-appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
        }
      `}</style>
      <Breadcrumbs items={["Engineering", "Transaction", "Work Order"]} />

      <EngineeringShell
        title="Work Order"
        subtitle="Create and manage work orders with activity-based cost breakdown"
        icon={ClipboardList}
        action={
          <div className="flex items-center gap-2 shrink-0">
            {/* Excel import — Work Orders without a BOQ */}
            {woRights.canCreate && (
              <WorkOrderImportButtons
                onImported={() => {
                  setListKey((k) => k + 1);
                  setViewMode("list");
                }}
              />
            )}
            {/* Tab toggle */}
            <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5">
              {woRights.canCreate && (
                <button
                  onClick={() => setViewMode("create")}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    viewMode === "create"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <PenSquare size={13} />
                  <span className="hidden sm:inline">Create</span>
                </button>
              )}
              <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  viewMode === "list" ||
                  viewMode === "detail" ||
                  viewMode === "edit"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List size={13} />
                <span className="hidden sm:inline">View All</span>
              </button>
            </div>

            {viewMode === "create" && (
              <>
                <button
                  onClick={() => void resetAll()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  <RotateCcw size={13} />
                  <span className="hidden sm:inline">Reset</span>
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || loadingDropdowns}
                  className="gradient-engineering inline-flex items-center gap-1.5 font-heading font-semibold text-white text-xs px-4 py-1.5 rounded-lg disabled:opacity-60 transition-all"
                >
                  {saving ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
                      <span className="hidden sm:inline">Save Work Order</span>
                      <span className="sm:hidden">Save</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        }
      >
        {/* ── VIEW ALL ── */}
        {viewMode === "list" && (
          <WorkOrdersList
            key={listKey}
            onViewDetail={(id) => {
              setSelectedOrderId(id);
              setViewMode("detail");
            }}
          />
        )}

        {/* ── DETAIL VIEW ── */}
        {viewMode === "detail" && selectedOrderId !== null && (
          <WorkOrderDetailPanel
            workOrderId={selectedOrderId}
            onBack={() => setViewMode("list")}
            onDelete={() => setViewMode("list")}
            onEdit={(id) => {
              setSelectedOrderId(id);
              setViewMode("edit");
            }}
          />
        )}

        {/* ── EDIT VIEW ── */}
        {viewMode === "edit" && selectedOrderId !== null && (
          <WorkOrderEditPanel
            workOrderId={selectedOrderId}
            onBack={() => {
              setViewMode("detail");
            }}
            onSaved={(id) => {
              setSelectedOrderId(id);
              setViewMode("detail");
            }}
          />
        )}

        {/* ── CREATE FORM ── */}
        {viewMode === "create" && woRights.canCreate && (
          <>
            {dropdownError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3">
                <AlertCircle
                  size={15}
                  className="text-amber-500 shrink-0 mt-0.5"
                />
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  {dropdownError}
                </p>
              </div>
            )}

            {savedId && (
              <div className="mb-5 rounded-xl border border-border bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-muted-foreground">
                    Approval Status:
                  </span>
                  <StatusBadge status={savedStatus} />
                </div>
                <ApprovalActions
                  status={savedStatus}
                  recordId={savedId}
                  endpoint="/api/work-orders"
                  onSuccess={async () => {
                    try {
                      const res = await fetchWithAuth(
                        `/api/work-orders/${savedId}`,
                      );
                      if (res.ok) {
                        const data = await res.json();
                        setSavedStatus(
                          data.Status || data.status || savedStatus,
                        );
                      }
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </div>
            )}

            {/* ── Unified Work Order Header Card ── */}
            <div className="rounded-2xl border border-border bg-card mb-5 shadow-sm">
              {/* Card Header */}
              <div className="px-5 py-4 border-b border-border bg-muted/20 flex items-center justify-between rounded-t-2xl">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <FileText size={15} className="text-primary" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground tracking-tight">
                      Work Order Details
                    </h2>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5">
                      Configuration, parties &amp; document info
                    </p>
                  </div>
                </div>
                {form.docNumber && (
                  <span className="font-mono text-xs font-bold text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-lg shrink-0">
                    {form.docNumber}
                  </span>
                )}
              </div>

              <div className="divide-y divide-border/60">
                {/* ── Section 1: Project Configuration ── */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3.5">
                    <div className="w-1 h-4 rounded-full bg-primary/60 shrink-0" />
                    <span className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-widest">
                      Project Configuration
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* BOQ Link */}
                    <div>
                      <FieldLabel>
                        <span className="flex items-center gap-1.5">
                          <FileText size={11} />
                          Linked BOQ
                        </span>
                        <span className="invisible text-red-500 ml-0.5">*</span>
                      </FieldLabel>
                      <select
                        value={form.boqId}
                        onChange={async (e) => {
                          const boqId = e.target.value;
                          const boq = approvedBoqs.find(
                            (b) => String(b.id) === boqId,
                          );
                          setForm((prev) => ({
                            ...prev,
                            boqId,
                            companyId: boq?.CompanyId
                              ? String(boq.CompanyId)
                              : prev.companyId,
                            projectId: boq?.ProjectId
                              ? String(boq.ProjectId)
                              : prev.projectId,
                          }));
                          if (boqId) {
                            try {
                              const inheritedGroups = await fetchBoqGroups(boqId);
                        if (inheritedGroups.length > 0) setGroups(inheritedGroups);
                            } catch {
                              /* non-fatal */
                            }
                          }
                        }}
                        className={selectCls}
                      >
                        <option value="">— None —</option>
                        {approvedBoqs.map((b) => (
                          <option key={b.id} value={String(b.id)}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                      {form.boqId && (
                        <p className="text-[0.625rem] text-primary/70 mt-1 flex items-center gap-1">
                          <Check size={9} />
                          Company &amp; Project auto-filled from BOQ
                        </p>
                      )}
                    </div>

                    {/* Company */}
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
                          setForm((p) => p.projectId && !projectBelongsToCompany((projects as ProjectCompanyLike[]).find((x) => String((x as any).id) === p.projectId) ?? {}, v) ? { ...p, projectId: "" } : p);
                          },
                        companies,
                        "Select company",
                        errors.companyId ?? false,
                      )}
                      {errors.companyId && (
                        <p className="text-xs text-red-500 mt-1">Required</p>
                      )}
                    </div>

                    {/* Project */}
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
                        <p className="text-xs text-red-500 mt-1">Required</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Section 2: Document Configuration ── */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3.5">
                    <div className="w-1 h-4 rounded-full bg-indigo-400/70 shrink-0" />
                    <span className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-widest">
                      Document Configuration
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Financial Year */}
                    <div>
                      <FieldLabel>
                        <span className="flex items-center gap-1.5">
                          <Calendar size={11} />
                          Financial Year
                        </span>
                      </FieldLabel>
                      {loadingDropdowns ? (
                        <SelectSkeleton />
                      ) : (
                        <select
                          value={selectedFinYear ?? ""}
                          onChange={(e) => {
                            const nextFinYear = e.target.value || undefined;
                            setSelectedFinYear(nextFinYear);
                            if (woDocTypeId)
                              void refreshWoDocNumber(woDocTypeId, nextFinYear);
                          }}
                          className={selectCls}
                        >
                          <option value="">Select financial year…</option>
                          {finYearOptions.map((fy) => (
                            <option key={fy.id} value={fy.year}>
                              {fy.year}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Document Type */}
                    <div>
                      <FieldLabel>
                        <span className="flex items-center gap-1.5">
                          <Hash size={11} />
                          Document Type
                        </span>
                      </FieldLabel>
                      <DocNumberPreview
                        module="WO"
                        finYear={selectedFinYear || undefined}
                        selectedDocTypeId={woDocTypeId}
                        preview={woDocNo}
                        refreshTrigger={docRefreshTrigger}
                        onSelect={applyWoDocNumber}
                        readOnly={viewMode !== "create"}
                      />
                    </div>

                    {/* Document Number */}
                    <div>
                      <FieldLabel>
                        <span className="flex items-center gap-1.5">
                          <Hash size={11} />
                          Document Number
                        </span>
                      </FieldLabel>
                      <input
                        value={form.docNumber}
                        onChange={(e) => {
                          const nextValue = e.target.value.toUpperCase();
                          setForm((prev) => ({
                            ...prev,
                            docNumber: nextValue,
                          }));
                          setWoDocNo(nextValue);
                        }}
                        className={`${inputCls} font-mono`}
                        placeholder="Auto-generated…"
                      />
                      <p className="text-[0.625rem] text-muted-foreground mt-1">
                        Auto-filled, still editable
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── Section 3: Parties & Amount ── */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3.5">
                    <div className="w-1 h-4 rounded-full bg-emerald-400/70 shrink-0" />
                    <span className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-widest">
                      Parties &amp; Amount
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Document Date */}
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
                          className={`w-full pl-8 pr-3 py-2 rounded-lg text-sm bg-background border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 transition [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:cursor-pointer ${errors.docDate ? "border-red-400" : "border-border"}`}
                        />
                      </div>
                      {errors.docDate && (
                        <p className="text-xs text-red-500 mt-1">Required</p>
                      )}
                    </div>
                    {/* Contractor */}
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
                        <p className="text-xs text-red-500 mt-1">Required</p>
                      )}
                    </div>

                    {/* Supplier */}
                    <div>
                      <FieldLabel>
                        <span className="flex items-center gap-1.5">
                          <User size={11} />
                          Supplier
                        </span>
                        <span className="invisible text-red-500 ml-0.5">*</span>
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

                    {/* Total Amount */}
                    <div>
                      <FieldLabel>
                        <span className="flex items-center gap-1.5">
                          <IndianRupee size={11} />
                          Total Amount
                        </span>
                        <span className="invisible text-red-500 ml-0.5">*</span>
                      </FieldLabel>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium">
                          ₹
                        </span>
                        <input
                          readOnly
                          value={grandTotal > 0 ? grandTotal.toFixed(2) : ""}
                          placeholder="Calculated from activities"
                          className={`${inputCls} pl-7 bg-muted/40 text-foreground font-mono font-semibold cursor-not-allowed`}
                        />
                      </div>
                      <p className="text-[0.625rem] text-muted-foreground mt-1 flex items-center gap-1">
                        <Calculator size={9} />
                        Auto-calculated from activities
                      </p>
                    </div>
                  </div>
                </div>

                {/* ── Section 4: Remarks & T&C ── */}
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-3.5">
                    <div className="w-1 h-4 rounded-full bg-amber-400/70 shrink-0" />
                    <span className="text-[0.6875rem] font-bold text-muted-foreground uppercase tracking-widest">
                      Notes &amp; Terms
                    </span>
                  </div>

                  {/* Remarks */}
                  <div className="mb-4">
                    <FieldLabel>Remarks</FieldLabel>
                    <input
                      value={form.remarks}
                      onChange={(e) => setField("remarks", e.target.value)}
                      placeholder="Any additional remarks…"
                      className={inputCls}
                    />
                  </div>

                  {/* Terms & Conditions */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <FieldLabel>Terms &amp; Conditions</FieldLabel>
                      {/* T&C Picker from TCMaster */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setTcDropdownOpen((o) => !o)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition mb-2"
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
                            <div className="absolute right-0 top-full mt-1 z-[100] w-80 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                              <div className="px-3 py-2 border-b border-border">
                                <p className="text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-wider">
                                  Select Terms &amp; Conditions
                                </p>
                              </div>
                              <div className="max-h-56 overflow-y-auto divide-y divide-border">
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
                                              ? prev.filter(
                                                  (s) => s.id !== tc.id,
                                                )
                                              : [...prev, tc],
                                          )
                                        }
                                        className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-muted/40 transition ${isSelected ? "bg-primary/5" : ""}`}
                                      >
                                        <span
                                          className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition ${isSelected ? "bg-primary border-primary" : "border-border"}`}
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
                              <div className="px-3 py-2 border-t border-border">
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
                    </div>
                    {/* Selected T&C list */}
                    {selectedTCs.length > 0 ? (
                      <div className="space-y-2">
                        {selectedTCs.map((tc, idx) => (
                          <div
                            key={tc.id}
                            className="flex items-start gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3"
                          >
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[0.625rem] font-bold flex items-center justify-center mt-0.5">
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
                              className="flex-shrink-0 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-muted-foreground hover:text-red-500 transition"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        No terms selected. Click &quot;Add T&amp;C&quot; to pick
                        from master.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Activity Details */}
            <div className="rounded-xl border border-border bg-card mb-5">
              <div className="px-4 sm:px-5 py-3.5 border-b border-border flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Calculator size={15} className="text-primary shrink-0" />
                  <h2 className="text-sm font-semibold text-foreground">
                    Activity Details
                  </h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full hidden sm:block">
                    {groups.length}g ·{" "}
                    {groups.reduce((s, g) => s + g.activities.length, 0)}a
                  </span>
                </div>
                <button
                  onClick={addGroup}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors shrink-0"
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
              <div className="border-t border-border bg-muted/10">
                <div className="grid grid-cols-1 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border/50">
                  <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <Package size={11} className="text-amber-500" />
                      Materials
                    </span>
                    <span className="text-base font-bold text-amber-600 dark:text-amber-400">
                      {fmt(grandMaterialsTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <Hammer size={11} className="text-blue-500" />
                      Labour
                    </span>
                    <span className="text-base font-bold text-blue-600 dark:text-blue-400">
                      {fmt(grandLabourTotal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      <Receipt size={11} className="text-violet-500" />
                      SAC GST
                    </span>
                    <span className="text-base font-bold text-violet-600 dark:text-violet-400">
                      {fmt(grandHsnGst)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between sm:justify-center sm:flex-col sm:items-start gap-1 px-4 sm:px-6 py-3 bg-muted/20">
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
                onClick={() => void resetAll()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
              >
                <RotateCcw size={13} />
                Reset
              </button>
              <button
                onClick={handleSave}
                disabled={saving || loadingDropdowns}
                className="gradient-engineering inline-flex items-center gap-1.5 font-heading font-semibold text-white text-xs px-4 py-1.5 rounded-lg disabled:opacity-60 transition-all"
              >
                {saving ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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
                    Save Work Order
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </EngineeringShell>
    </>
  );
};

export default WorkOrderMaster;
