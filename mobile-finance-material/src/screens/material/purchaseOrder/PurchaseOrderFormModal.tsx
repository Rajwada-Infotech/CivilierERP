// RN port of PurchaseOrderMaster.tsx's create/edit form, on the drawing sheet: a page of the stack (asScreen, from
// PurchaseOrderFormScreen) with Cancel / Save along its foot. Scope (agreed):
// Direct entry + "Load from Material Request" dropdown + L1Chart award
// prefill (qtPrefill, passed in the PurchaseOrderForm route's params
// when L1ChartScreen awards a quotation) — Work Order/Work Design prefills
// still arrive via web-only navigation state from pages that don't exist on
// mobile yet. The GST-split resolver and the
// UOM-conversion engine (category-wide + per-item tagged alternates) ARE
// replicated faithfully since they're core to a correct PO total, not
// polish — see purchaseOrdersApi.ts's resolveLineGstSplit/convert* exports.
// Payment Terms is a plain text field here (web also offers a T&C-master
// multi-select — dropped for v1, non-essential to correctness).
import { istToday } from "@/utils/istTime";
import { useLockedFinYear } from "@/hooks/useLockedFinYear";
import { useEffect, useMemo, useRef, useState } from "react";
import { View, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingCart, ClipboardList } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Body, Field, Input, Label, Notice, Panel } from "@/components/sheet/Sheet";
import { TextField } from "@/components/sheet/FormParts";
import { AddLineKey, FormPage, LineBox, LineList, ShownValue } from "@/components/sheet/Register";
import { formatINR } from "@/utils/formatCurrency";
import {
  getPurchaseOrderById, addPurchaseOrder, updatePurchaseOrder,
  getSuppliers, getCompanies, getProjects, getUOMs, getItemMaster, getItemsWithGST,
  getAllItemUomAlternates, getCostCenterOptions, fetchFinYearOptions,
  getSupplierDetails, getCompanyDetails, getApprovedMRList, getMRPOPrefill,
  fetchDocTypes, fetchNextDocNumber,
  resolveLineGstSplit, relevantUOMs, convertRate, alternatesForItem, getItemUomFactor, convertItemRate,
  type CreatePOPayload, type MRPOPrefill, type QTPOPrefill, type ItemUOMAlternate, type UOMOption,
} from "@/api/purchaseOrdersApi";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/screens/finance/payment/OptionPicker";

type LineItem = {
  id: string;
  itemId: string;
  itemName: string;
  itemDescription: string;
  quantity: number;
  uomId: number | null;
  unit: string;
  rate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
  gstRate: number;
  taxAmount: number;
  amount: number;
  mrItemId: number | null;
  mrPendingQty: number | null;
};

let lineSeq = 0;
const uid = () => `ln-${Date.now()}-${lineSeq++}`;

function blankLine(): LineItem {
  return {
    id: uid(), itemId: "", itemName: "", itemDescription: "", quantity: 1, uomId: null, unit: "",
    rate: 0, cgstRate: 0, sgstRate: 0, igstRate: 0, gstRate: 0, taxAmount: 0, amount: 0,
    mrItemId: null, mrPendingQty: null,
  };
}

type FormState = {
  companyId: string; companyName: string;
  projectId: string; projectName: string;
  supplierId: string; supplierName: string;
  costCenterId: string; costCenterName: string;
  finYear: string;
  poDate: string; expectedDate: string;
  paymentTerms: string; remarks: string;
};

function todayISO() { return istToday(); }

function blankForm(): FormState {
  return {
    companyId: "", companyName: "", projectId: "", projectName: "", supplierId: "", supplierName: "",
    costCenterId: "", costCenterName: "", finYear: "", poDate: todayISO(), expectedDate: "", paymentTerms: "", remarks: "",
  };
}

function normState(v?: string | null) { return String(v || "").trim().toLowerCase(); }

export function PurchaseOrderFormModal({
  visible, editingId, qtPrefill, onClose, asScreen,
}: { visible: boolean; editingId: number | null; qtPrefill?: QTPOPrefill | null; onClose: () => void; asScreen?: boolean }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(blankForm());
  const [lineItems, setLineItems] = useState<LineItem[]>([blankLine()]);
  const [sourceMR, setSourceMR] = useState<{ id: number; docNo: string } | null>(null);
  const [sourceQT, setSourceQT] = useState<{ id: number; docNo: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [poDocTypeId, setPoDocTypeId] = useState<number | null>(null);
  const [poDocNo, setPoDocNo] = useState("");
  const [picker, setPicker] = useState<"company" | "project" | "supplier" | "costCenter" | "finYear" | "mrCompany" | "mrProject" | "mrList" | null>(null);
  const [linePicker, setLinePicker] = useState<{ idx: number; kind: "item" | "uom" } | null>(null);
  const [mrFilterCompanyId, setMrFilterCompanyId] = useState("");
  const [mrFilterProjectId, setMrFilterProjectId] = useState("");
  const [mrDropdownLoading, setMrDropdownLoading] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  useEffect(() => {
    if (!visible) return;
    if (editingId == null) {
      setForm(blankForm());
      setLineItems([blankLine()]);
      setSourceMR(null);
      setSourceQT(null);
      setMrFilterCompanyId("");
      setMrFilterProjectId("");
    }
  }, [visible, editingId]);

  const { data: companies = [] } = useQuery({ queryKey: ["po-form-companies"], queryFn: getCompanies, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["po-form-projects"], queryFn: getProjects, enabled: visible });
  const { data: suppliers = [] } = useQuery({ queryKey: ["po-form-suppliers"], queryFn: getSuppliers, enabled: visible });
  const { data: uoms = [] } = useQuery({ queryKey: ["po-form-uoms"], queryFn: getUOMs, enabled: visible });
  const { data: itemMaster = [] } = useQuery({ queryKey: ["po-form-items"], queryFn: getItemMaster, enabled: visible });
  const { data: itemsGst = [] } = useQuery({ queryKey: ["po-form-items-gst"], queryFn: getItemsWithGST, enabled: visible });
  const { data: itemUomAlternates = [] } = useQuery({ queryKey: ["po-form-item-uom-alt"], queryFn: getAllItemUomAlternates, enabled: visible });
  const { data: costCenters = [] } = useQuery({ queryKey: ["po-form-cost-centers"], queryFn: getCostCenterOptions, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["po-form-finyears"], queryFn: fetchFinYearOptions, enabled: visible });
  // New records are locked to the current financial year (else the most
  // recent one); an existing record keeps the year it was saved with.
  const lockedFY = useLockedFinYear(visible && editingId == null);
  const finYearLocked = (visible && editingId == null) && !!lockedFY;
  useEffect(() => {
    if (!(visible && editingId == null) || !lockedFY) return;
    set("finYear", lockedFY.label);
  }, [visible, editingId == null, lockedFY?.id]);

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ["po-editing-record", editingId],
    queryFn: () => getPurchaseOrderById(editingId!),
    enabled: visible && editingId != null,
  });

  const { data: approvedMRs = [], isLoading: approvedMRsLoading } = useQuery({
    queryKey: ["po-form-approved-mrs", mrFilterCompanyId, mrFilterProjectId],
    queryFn: () => getApprovedMRList({ companyId: mrFilterCompanyId || undefined, projectId: mrFilterProjectId || undefined }),
    enabled: visible && editingId == null && !sourceMR && !sourceQT,
  });

  const { data: supplierDetails } = useQuery({
    queryKey: ["po-form-supplier-details", form.supplierId],
    queryFn: () => getSupplierDetails(form.supplierId),
    enabled: !!form.supplierId,
  });
  const { data: companyDetails } = useQuery({
    queryKey: ["po-form-company-details", form.companyId],
    queryFn: () => getCompanyDetails(form.companyId),
    enabled: !!form.companyId,
  });

  const isIntraState = useMemo(() => {
    const sup = normState(supplierDetails?.LGSTState);
    const comp = normState(companyDetails?.state);
    return !sup || !comp || sup === comp;
  }, [supplierDetails?.LGSTState, companyDetails?.state]);

  const itemsGstById = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of itemsGst) map.set(i.id, i.gstRate);
    return map;
  }, [itemsGst]);

  const items = useMemo(() => itemMaster.map((i) => ({ ...i, resolvedGstRate: itemsGstById.get(i.id) ?? null })), [itemMaster, itemsGstById]);

  // Prefill from an existing record when editing.
  useEffect(() => {
    if (!visible || editingId == null || !existing) return;
    setForm({
      companyId: existing.CompanyId ? String(existing.CompanyId) : "", companyName: existing.CompanyName || "",
      projectId: existing.ProjectId ? String(existing.ProjectId) : "", projectName: existing.ProjectName || "",
      supplierId: existing.SupplierID ? String(existing.SupplierID) : "", supplierName: existing.SupplierName || "",
      costCenterId: existing.CostCenterId ? String(existing.CostCenterId) : "", costCenterName: existing.CostCenterName || "",
      finYear: "", poDate: existing.PODate?.slice(0, 10) || todayISO(), expectedDate: existing.ExpectedDeliveryDate?.slice(0, 10) || "",
      paymentTerms: existing.PaymentTerms || "", remarks: existing.Remarks || "",
    });
    setLineItems(
      (existing.POItems ?? []).map((it) => ({
        id: uid(), itemId: it.ItemId || "", itemName: it.ItemName || "", itemDescription: it.Description || "",
        quantity: Number(it.Quantity ?? 0), uomId: null, unit: it.UomName || "", rate: Number(it.Rate ?? 0),
        cgstRate: 0, sgstRate: 0, igstRate: 0, gstRate: Number(it.TaxPct ?? 0),
        taxAmount: (Number(it.Quantity ?? 0) * Number(it.Rate ?? 0) * Number(it.TaxPct ?? 0)) / 100,
        amount: Number(it.LineAmount ?? 0), mrItemId: null, mrPendingQty: null,
      })),
    );
    if (existing.SourceMRId) setSourceMR({ id: existing.SourceMRId, docNo: existing.SourceMRDocNo || "" });
  }, [visible, editingId, existing]);

  // Doc number preview — create mode only. Both calls used to be unhandled
  // — a rejection from either (network blip, or a 403 on a doc-type-scoped
  // right) crashed the whole app the moment this New Purchase Order modal
  // opened. poDocTypeId/poDocNo just stay unset on failure — the backend
  // still accepts the order without a preview.
  useEffect(() => {
    if (!visible || editingId != null) return;
    fetchDocTypes("PO").then((types) => {
      const filtered = types.filter((dt) => !(dt.DocNoPrefix ?? dt.FullPrefix ?? dt.Prefix ?? "").startsWith("ExB-PO"));
      const preferred = filtered.find((dt) => (dt.DocNoPrefix ?? dt.Prefix) === "DPO") ?? filtered[0];
      if (preferred) {
        setPoDocTypeId(preferred.TypeOfDocId);
        fetchNextDocNumber(preferred.TypeOfDocId, form.finYear || undefined).then(setPoDocNo).catch(() => {});
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingId, form.finYear]);

  const filteredProjects = useMemo(
    () => (form.companyId ? projects.filter((p) => p.companyId === form.companyId) : projects),
    [projects, form.companyId],
  );
  const filteredMRProjects = useMemo(
    () => (mrFilterCompanyId ? projects.filter((p) => p.companyId === mrFilterCompanyId) : projects),
    [projects, mrFilterCompanyId],
  );

  const totals = useMemo(() => {
    const sub = lineItems.reduce((s, li) => s + li.quantity * li.rate, 0);
    const cgst = lineItems.reduce((s, li) => (li.cgstRate > 0 ? s + (li.quantity * li.rate * li.cgstRate) / 100 : s), 0);
    const sgst = lineItems.reduce((s, li) => (li.sgstRate > 0 ? s + (li.quantity * li.rate * li.sgstRate) / 100 : s), 0);
    const igst = lineItems.reduce((s, li) => (li.cgstRate > 0 || li.sgstRate > 0 ? s : s + (li.quantity * li.rate * li.igstRate) / 100), 0);
    const tax = cgst + sgst + igst;
    return { subtotal: sub, totalCgst: cgst, totalSgst: sgst, totalIgst: igst, totalTax: tax, grandTotal: sub + tax };
  }, [lineItems]);

  const updateLine = (idx: number, patch: Partial<LineItem>) => {
    setLineItems((prev) => prev.map((li, i) => {
      if (i !== idx) return li;
      const updated = { ...li, ...patch };
      const baseAmount = updated.quantity * updated.rate;
      if (patch.igstRate !== undefined || patch.cgstRate !== undefined || patch.sgstRate !== undefined) {
        updated.gstRate = updated.cgstRate > 0 || updated.sgstRate > 0 ? updated.cgstRate + updated.sgstRate : updated.igstRate;
      }
      updated.taxAmount = (baseAmount * updated.gstRate) / 100;
      updated.amount = baseAmount + updated.taxAmount;
      return updated;
    }));
  };

  const addLine = () => setLineItems((p) => [...p, blankLine()]);
  const removeLine = (idx: number) => {
    if (lineItems.length === 1) return;
    setLineItems((p) => p.filter((_, i) => i !== idx));
  };

  const handleItemSelect = (idx: number, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const itemUomNorm = item.uom.trim().toLowerCase();
    const uomMatch = uoms.find((u) => u.code.toLowerCase() === itemUomNorm || u.name.toLowerCase() === itemUomNorm);
    const { cgstRate, sgstRate, igstRate, gstRate } = resolveLineGstSplit(item.cgst, item.sgst, item.igst, item.resolvedGstRate ?? 0, isIntraState);
    updateLine(idx, {
      itemId, itemName: item.name, itemDescription: item.description,
      uomId: uomMatch?.id ?? null, unit: uomMatch?.name ?? item.uom,
      cgstRate, sgstRate, igstRate, gstRate,
    });
    setLinePicker(null);
  };

  const handleUomChange = (idx: number, uom: UOMOption) => {
    const li = lineItems[idx];
    const currentUom = uoms.find((u) => u.id === li.uomId);
    const lineItem = items.find((i) => i.id === li.itemId);
    const itemFromFactor = lineItem ? getItemUomFactor(itemUomAlternates, lineItem.id, currentUom?.code ?? "", lineItem.uom) : null;
    const itemToFactor = lineItem ? getItemUomFactor(itemUomAlternates, lineItem.id, uom.code, lineItem.uom) : null;
    let nextRate = li.rate;
    if (itemFromFactor != null && itemToFactor != null) {
      nextRate = convertItemRate(li.rate, itemFromFactor, itemToFactor);
    } else if (currentUom?.category && uom.category === currentUom.category && currentUom.baseFactor && uom.baseFactor) {
      nextRate = convertRate(li.rate, currentUom.baseFactor, uom.baseFactor);
    }
    updateLine(idx, { uomId: uom.id, unit: uom.name, rate: nextRate });
    setLinePicker(null);
  };

  const applyMRPrefill = (prefill: MRPOPrefill) => {
    const matchCompany = companies.find((c) => c.id === String(prefill.CompanyId));
    const matchProject = projects.find((p) => p.id === String(prefill.ProjectId));
    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId, companyName: matchCompany?.name ?? prev.companyName,
      projectId: matchProject?.id ?? prev.projectId, projectName: matchProject?.name ?? prev.projectName,
      remarks: prefill.Remarks || prev.remarks,
    }));
    const prefillLines: LineItem[] = prefill.items.map((it) => {
      const { cgstRate, sgstRate, igstRate, gstRate } = resolveLineGstSplit(Number(it.M_CGST ?? 0), Number(it.M_SGST ?? 0), Number(it.M_IGST ?? 0), 0, isIntraState);
      const pendingQty = Number(it.PendingQty ?? it.Quantity ?? 1);
      const uomCodeNorm = (it.UOMCode ?? "").trim().toLowerCase();
      const uomNameNorm = (it.UOMName ?? "").trim().toLowerCase();
      const uomMatch = uoms.find((u) => (uomCodeNorm && u.code.toLowerCase() === uomCodeNorm) || (uomNameNorm && u.name.toLowerCase() === uomNameNorm));
      return {
        id: uid(), itemId: it.ItemId || "", itemName: it.ItemName || "", itemDescription: "",
        quantity: pendingQty, uomId: uomMatch?.id ?? null, unit: uomMatch?.name ?? it.UOMName ?? it.UOMCode ?? "",
        rate: 0, cgstRate, sgstRate, igstRate, gstRate, taxAmount: 0, amount: 0,
        mrItemId: it.MRItemId ?? null, mrPendingQty: pendingQty,
      };
    });
    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceMR({ id: prefill.MRId, docNo: prefill.DocNo });
  };

  const handleMRSelect = async (mrId: string) => {
    setPicker(null);
    if (!mrId) return;
    setMrDropdownLoading(true);
    try {
      const prefill = await getMRPOPrefill(Number(mrId));
      applyMRPrefill(prefill);
    } catch (err: any) {
      Alert.alert("Could not load Material Request", err.message ?? "Something went wrong.");
    } finally {
      setMrDropdownLoading(false);
    }
  };

  // Award from L1Chart's comparison — unlike MR prefill this also carries a
  // chosen supplier and per-line Rate (the winning bid), so it seeds the
  // cart fully priced instead of qty-only. GST split still goes through the
  // same resolveLineGstSplit used everywhere else, not anything QT-specific.
  const applyQTPrefill = (prefill: QTPOPrefill) => {
    const matchCompany = companies.find((c) => c.id === String(prefill.CompanyId));
    const matchProject = projects.find((p) => p.id === String(prefill.ProjectId));
    const matchSupplier = suppliers.find((s) => s.id === String(prefill.SupplierId));
    setForm((prev) => ({
      ...prev,
      companyId: matchCompany?.id ?? prev.companyId, companyName: matchCompany?.name ?? prev.companyName,
      projectId: matchProject?.id ?? prev.projectId, projectName: matchProject?.name ?? prev.projectName,
      supplierId: matchSupplier?.id ?? String(prefill.SupplierId), supplierName: matchSupplier?.name ?? prefill.SupplierName ?? prev.supplierName,
      remarks: prefill.Remarks || prev.remarks,
    }));
    const prefillLines: LineItem[] = prefill.items.map((it) => {
      const { cgstRate, sgstRate, igstRate, gstRate } = resolveLineGstSplit(Number(it.M_CGST ?? 0), Number(it.M_SGST ?? 0), Number(it.M_IGST ?? 0), 0, isIntraState);
      const uomCodeNorm = (it.UOMCode ?? "").trim().toLowerCase();
      const uomNameNorm = (it.UOMName ?? "").trim().toLowerCase();
      const uomMatch = uoms.find((u) => (uomCodeNorm && u.code.toLowerCase() === uomCodeNorm) || (uomNameNorm && u.name.toLowerCase() === uomNameNorm));
      const quantity = Number(it.Quantity) || 1;
      const rate = Number(it.Rate ?? 0);
      const baseAmount = quantity * rate;
      const taxAmount = (baseAmount * gstRate) / 100;
      return {
        id: uid(), itemId: it.ItemId || "", itemName: it.ItemName || "", itemDescription: "",
        quantity, uomId: uomMatch?.id ?? null, unit: uomMatch?.name ?? it.UOMName ?? it.UOMCode ?? "",
        rate, cgstRate, sgstRate, igstRate, gstRate, taxAmount, amount: baseAmount + taxAmount,
        mrItemId: null, mrPendingQty: null,
      };
    });
    if (prefillLines.length > 0) setLineItems(prefillLines);
    setSourceQT({ id: prefill.QuotationId, docNo: prefill.DocNo });
  };

  // Applied once master data (companies/projects/suppliers/uoms) is loaded —
  // qtPrefill arrives as soon as the modal opens (via navigation params),
  // before those queries resolve, so this can't be a plain mount effect.
  const appliedQtPrefillRef = useRef<QTPOPrefill | null>(null);
  useEffect(() => {
    if (!visible) { appliedQtPrefillRef.current = null; return; }
    if (editingId != null || !qtPrefill) return;
    if (appliedQtPrefillRef.current === qtPrefill) return;
    if (companies.length === 0 || uoms.length === 0 || suppliers.length === 0) return;
    applyQTPrefill(qtPrefill);
    appliedQtPrefillRef.current = qtPrefill;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingId, qtPrefill, companies, projects, uoms, suppliers]);

  const validate = (): string | null => {
    if (!form.companyId) return "Company is required.";
    if (!form.projectId) return "Project is required.";
    if (!form.supplierId) return "Supplier is required.";
    if (!form.costCenterId) return "Cost Center is required.";
    if (lineItems.every((li) => !li.itemName && !li.quantity)) return "Add at least one line item.";
    const overCap = lineItems.find((li) => li.mrItemId != null && li.mrPendingQty != null && li.quantity - li.mrPendingQty > 0.0001);
    if (overCap) return `"${overCap.itemName}" exceeds the pending Material Request quantity (max ${overCap.mrPendingQty}).`;
    return null;
  };

  const handleSave = async () => {
    const error = validate();
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const validItems = lineItems.filter((li) => li.itemName || li.quantity > 0);
    const backendNumbered = editingId == null && !!poDocTypeId;
    const payload: CreatePOPayload = {
      PurchaseOrderNo: backendNumbered ? null : poDocNo || null,
      PODate: form.poDate || null,
      ExpectedDeliveryDate: form.expectedDate || null,
      SupplierID: Number(form.supplierId),
      CompanyId: Number(form.companyId),
      ProjectId: Number(form.projectId),
      ItemDescription: validItems.map((li) => li.itemName).join(", ") || null,
      Quantity: validItems.reduce((s, li) => s + li.quantity, 0),
      Unit: validItems[0]?.unit || null,
      Rate: validItems[0]?.rate || 0,
      TotalAmount: totals.grandTotal,
      POItems: validItems.map((li) => ({
        itemId: li.itemId || null, itemDescription: li.itemName, description: li.itemDescription || null,
        unit: li.unit, uomId: li.uomId, quantity: li.quantity, rate: li.rate, tax: li.gstRate,
        cgstRate: li.cgstRate, sgstRate: li.sgstRate, igstRate: li.igstRate,
        gstType: li.igstRate > 0 ? "igst" : "cgst_sgst", amount: li.amount, mrItemId: li.mrItemId,
      })),
      PaymentTerms: form.paymentTerms || null,
      Status: editingId != null ? (existing?.Status ?? "Draft") : "Pending",
      Remarks: form.remarks || null,
      CostCenterId: Number(form.costCenterId),
      DocTypeId: poDocTypeId,
      DocNo: backendNumbered ? null : poDocNo || null,
      finYear: form.finYear || null,
      SourceMRId: sourceMR?.id ?? null,
      SourceMRDocNo: sourceMR?.docNo ?? null,
      SourceQTId: sourceQT?.id ?? null,
      SourceQTDocNo: sourceQT?.docNo ?? null,
      POType: sourceQT ? "QPO" : sourceMR ? "Normal" : "Direct",
    };
    setSaving(true);
    try {
      if (editingId != null) {
        await updatePurchaseOrder(editingId, payload);
        Alert.alert("Saved", "Purchase Order updated.");
      } else {
        const created = await addPurchaseOrder(payload);
        Alert.alert("Saved", `Purchase Order ${created.PurchaseOrderNo} created.`);
      }
      queryClient.invalidateQueries({ queryKey: ["purchase-orders-mobile"], exact: false });
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = companies.map((c) => ({ key: c.id, label: c.name }));
  const projectOptions: PickerOption[] = filteredProjects.map((p) => ({ key: p.id, label: p.name }));
  const mrProjectOptions: PickerOption[] = filteredMRProjects.map((p) => ({ key: p.id, label: p.name }));
  const supplierOptions: PickerOption[] = suppliers.map((s) => ({ key: s.id, label: s.name }));
  const costCenterOptions: PickerOption[] = costCenters.map((c) => ({ key: String(c.id), label: c.label }));
  const finYearOptions: PickerOption[] = finYears.map((f) => ({ key: f.label, label: f.label }));
  const mrOptions: PickerOption[] = approvedMRs.map((mr) => ({ key: String(mr.MRId), label: mr.DocNo, sublabel: mr.ProjectName ?? undefined }));
  const itemOptions: PickerOption[] = items.map((i) => ({ key: i.id, label: i.name, sublabel: i.itemType || undefined }));

  const activeLine = linePicker ? lineItems[linePicker.idx] : null;
  const uomOptionsForLine: PickerOption[] = useMemo(() => {
    if (!activeLine || linePicker?.kind !== "uom") return [];
    const currentUom = uoms.find((u) => u.id === activeLine.uomId);
    const options = relevantUOMs(uoms, currentUom?.category);
    const lineItem = items.find((i) => i.id === activeLine.itemId);
    const itemAlternates = lineItem ? alternatesForItem(itemUomAlternates, lineItem.id) : [];
    const extra = itemAlternates.map((a) => uoms.find((u) => u.code === a.uomCode)).filter((u): u is UOMOption => !!u && !options.some((o) => o.id === u.id));
    return [...options, ...extra].map((u) => ({ key: String(u.id), label: u.name }));
  }, [activeLine, linePicker, uoms, items, itemUomAlternates]);

  return (
    <FormPage
      asScreen={asScreen}
      visible={visible}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Purchase order"
      title={editingId ? "Edit order" : "New order"}
      subtitle={editingId ? existing?.PurchaseOrderNo || undefined : "Place an order with a supplier — direct, or from a material request."}
      loading={editingId != null && loadingExisting}
      saving={saving}
      onSave={handleSave}
      saveLabel={editingId ? "Save changes" : "Save order"}
      overlays={
        <>
          <OptionPickerModal visible={picker === "company"} title="Select company" options={companyOptions} selectedKey={form.companyId}
            onSelect={(k) => { const c = companies.find((x) => x.id === k); setForm((f) => ({ ...f, companyId: k, companyName: c?.name ?? "", projectId: "", projectName: "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "project"} title="Select project" options={projectOptions} selectedKey={form.projectId}
            onSelect={(k) => { const p = projects.find((x) => x.id === k); setForm((f) => ({ ...f, projectId: k, projectName: p?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "supplier"} title="Select supplier" options={supplierOptions} selectedKey={form.supplierId}
            onSelect={(k) => { const s = suppliers.find((x) => x.id === k); setForm((f) => ({ ...f, supplierId: k, supplierName: s?.name ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "costCenter"} title="Select cost centre" options={costCenterOptions} selectedKey={form.costCenterId}
            onSelect={(k) => { const c = costCenters.find((x) => String(x.id) === k); setForm((f) => ({ ...f, costCenterId: k, costCenterName: c?.label ?? "" })); setPicker(null); }}
            onClose={() => setPicker(null)} searchable />
          <OptionPickerModal visible={picker === "finYear"} title="Select financial year" options={finYearOptions} selectedKey={form.finYear}
            onSelect={(k) => { set("finYear", k); setPicker(null); }} onClose={() => setPicker(null)} clearable />
          <OptionPickerModal visible={picker === "mrCompany"} title="Select company" options={companyOptions} selectedKey={mrFilterCompanyId}
            onSelect={(k) => { setMrFilterCompanyId(k); setMrFilterProjectId(""); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
          <OptionPickerModal visible={picker === "mrProject"} title="Select project" options={mrProjectOptions} selectedKey={mrFilterProjectId}
            onSelect={(k) => { setMrFilterProjectId(k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable />
          <OptionPickerModal visible={picker === "mrList"} title="Select material request" options={mrOptions} selectedKey=""
            onSelect={handleMRSelect} onClose={() => setPicker(null)} searchable loading={approvedMRsLoading} />
          <OptionPickerModal
            visible={linePicker?.kind === "item"} title="Select item" options={itemOptions}
            selectedKey={activeLine?.itemId ?? ""} onSelect={(k) => linePicker && handleItemSelect(linePicker.idx, k)}
            onClose={() => setLinePicker(null)} searchable
          />
          <OptionPickerModal
            visible={linePicker?.kind === "uom"} title="Select UOM" options={uomOptionsForLine}
            selectedKey={activeLine?.uomId ? String(activeLine.uomId) : ""}
            onSelect={(k) => { const u = uoms.find((x) => String(x.id) === k); if (u && linePicker) handleUomChange(linePicker.idx, u); }}
            onClose={() => setLinePicker(null)} searchable
          />
        </>
      }
    >
      <Panel title="Document">
        <View>
          <ShownValue label="Doc number" value={editingId ? existing?.PurchaseOrderNo || "—" : poDocNo || "Made on save"} />
          <PickerRow label="Company *" value={form.companyName} placeholder="Select company…" onPress={() => setPicker("company")} />
          <PickerRow label="Project *" value={form.projectName} placeholder="Select project…" onPress={() => setPicker("project")} />
          <PickerRow label="Supplier *" value={form.supplierName} placeholder="Select supplier…" onPress={() => setPicker("supplier")} />
          <PickerRow label="Cost centre *" value={form.costCenterName} placeholder="Select cost centre…" onPress={() => setPicker("costCenter")} />
          <PickerRow label={finYearLocked ? "Financial year · locked to current" : "Financial year"} value={form.finYear} placeholder="Auto" onPress={() => setPicker("finYear")} disabled={finYearLocked} />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Field label="PO date" required style={{ flex: 1 }}>
            <Input value={form.poDate} onChangeText={(v) => set("poDate", v)} placeholder="YYYY-MM-DD" />
          </Field>
          <Field label="Expected delivery" style={{ flex: 1 }}>
            <Input value={form.expectedDate} onChangeText={(v) => set("expectedDate", v)} placeholder="YYYY-MM-DD" />
          </Field>
        </View>
      </Panel>

      {editingId == null && !sourceMR && !sourceQT && (
        <Panel title="Load from material request" icon={<ClipboardList size={14} color={S.ink} />}>
          <View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <PickerRow label="Company" value={companies.find((c) => c.id === mrFilterCompanyId)?.name || ""} placeholder="Any" onPress={() => setPicker("mrCompany")} />
              </View>
              <View style={{ flex: 1 }}>
                <PickerRow label="Project" value={projects.find((p) => p.id === mrFilterProjectId)?.name || ""} placeholder="Any" onPress={() => setPicker("mrProject")} />
              </View>
            </View>
            <PickerRow
              label="Approved request"
              value=""
              placeholder={approvedMRsLoading || mrDropdownLoading ? "Loading…" : approvedMRs.length === 0 ? "No approved requests" : "Select material request…"}
              onPress={() => setPicker("mrList")}
              disabled={approvedMRs.length === 0}
            />
          </View>
        </Panel>
      )}
      {!!sourceMR && <Notice tone="ink">{`Sourced from material request ${sourceMR.docNo}`}</Notice>}
      {!!sourceQT && <Notice tone="ink">{`Awarded from L1 chart ${sourceQT.docNo}`}</Notice>}

      <Panel title={`Line items (${lineItems.length})`} icon={<ShoppingCart size={14} color={S.ink} />}>
        {lineItems.map((li, idx) => {
          const overCap = li.mrPendingQty != null && li.quantity - li.mrPendingQty > 0.0001;
          return (
            <LineBox key={li.id} index={idx} title={`Item ${idx + 1}`} onRemove={lineItems.length > 1 ? () => removeLine(idx) : undefined}>
              <View>
                <PickerRow label="Item" value={li.itemName} placeholder="Select item…" onPress={() => setLinePicker({ idx, kind: "item" })} />
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Field label="Qty" style={{ flex: 1 }}>
                  <Input
                    value={String(li.quantity)}
                    onChangeText={(v) => updateLine(idx, { quantity: parseFloat(v.replace(/[^0-9.]/g, "")) || 0 })}
                    keyboardType="numeric"
                    style={overCap ? { color: S.red } : undefined}
                  />
                </Field>
                <View style={{ flex: 1 }}>
                  <PickerRow label="UOM" value={li.unit} placeholder="—" onPress={() => setLinePicker({ idx, kind: "uom" })} />
                </View>
                <Field label="Rate" style={{ flex: 1 }}>
                  <Input value={String(li.rate)} onChangeText={(v) => updateLine(idx, { rate: parseFloat(v.replace(/[^0-9.]/g, "")) || 0 })} keyboardType="numeric" />
                </Field>
              </View>
              {li.mrPendingQty != null && (
                <Body size={11} color={overCap ? S.red : S.graphite}>{`${Math.max(0, li.mrPendingQty - li.quantity)} left on the request${overCap ? " · more than the request asks for" : ""}`}</Body>
              )}
              <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 8, borderTopWidth: 1, borderTopColor: S.ruleSoft }}>
                <Label>{li.gstRate > 0 ? (li.igstRate > 0 ? `IGST ${li.gstRate}%` : `CGST ${li.cgstRate}% + SGST ${li.sgstRate}%`) : "No GST"}</Label>
                <View style={{ alignItems: "flex-end" }}>
                  <Body size={14} weight="semibold">{formatINR(li.amount)}</Body>
                  {li.taxAmount > 0 && <Body size={10.5} color={S.graphite}>{`+${formatINR(li.taxAmount)} GST`}</Body>}
                </View>
              </View>
            </LineBox>
          );
        })}
        <AddLineKey onPress={addLine} />
      </Panel>

      <Panel title="Totals">
        <LineList
          rows={[
            { key: "sub", title: "Subtotal", right: formatINR(totals.subtotal) },
            ...(totals.totalCgst > 0 ? [{ key: "cgst", title: "CGST", right: formatINR(totals.totalCgst) }] : []),
            ...(totals.totalSgst > 0 ? [{ key: "sgst", title: "SGST", right: formatINR(totals.totalSgst) }] : []),
            ...(totals.totalIgst > 0 ? [{ key: "igst", title: "IGST", right: formatINR(totals.totalIgst) }] : []),
          ]}
        />
        <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1.5, borderTopColor: S.ink }}>
          <Label color={S.ink}>Grand total</Label>
          <Body size={18} weight="semibold">{formatINR(totals.grandTotal)}</Body>
        </View>
      </Panel>

      <View>
        <TextField label="Payment terms" value={form.paymentTerms} onChangeText={(v) => set("paymentTerms", v)} placeholder="e.g. 30 days from delivery" />
        <TextField label="Remarks" value={form.remarks} onChangeText={(v) => set("remarks", v)} placeholder="Optional notes" />
      </View>
    </FormPage>
  );
}
