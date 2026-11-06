// RN port of src/pages/material/MaterialExpenseBooking.tsx's "form" view, on the drawing sheet (SheetShell, ruled panels,
// the shared FormParts fields and pickers) —
// create AND edit (route param `id` switches modes). Covers PO / Work Done
// / GRN (single or multi-combine off the same PO) / Other Expense (TOD)
// document sources, EMI, and billing terms. Not ported: file attachments
// (the web Invoice form has none either — no backend column for it, unlike
// Contract).
import { istToday } from "@/utils/istTime";
import { useLockedFinYear } from "@/hooks/useLockedFinYear";
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, X, FileText, Wallet, Receipt, Truck, CreditCard, Plus } from "lucide-react-native";
import {
  fetchPOOptions, fetchWorkDoneOptions, fetchExpenseDocTypes, fetchNextExpenseDocNumber,
  fetchSupplierHeads, fetchContractorHeads, fetchBrokerHeads, createExpenseBooking, updateExpenseBooking, fetchInvoiceById,
  fetchGRNOptions, fetchGRNDetail, aggregateGRNsForInvoice,
  fetchBillingTermOptions, billingTermToConfig, fetchCostCenterOptionsInv,
  generateEmiSchedule, computeBreakdown,
  type POOption, type WorkDoneOption, type DocTypeOption, type GRNOption, type GRNDetail,
  type BillingTermOption, type BillingTerm, type GRNItemLine,
} from "@/api/invoiceApi";
import { fetchCompanyOptions, fetchProjectOptions, fetchFinYearOptions } from "@/api/newPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { Body, IconKey, Key, Label, Panel, Seg, SheetShell, Skel } from "@/components/sheet/Sheet";
import { DateField, OptionRow, OptionSheet, PickerField, SheetPicker, TextField } from "@/components/sheet/FormParts";
import { fonts } from "@/theme/fonts";


// A stable reference for "no data yet" — `data: x = []` in a destructure
// evaluates a brand-new array literal every render while `data` is still
// undefined (query pending, or perpetually failing on a flaky connection),
// which breaks referential equality for any effect/memo depending on that
// value and can loop it forever. Reusing one module-level empty array
// keeps the reference stable regardless of how long the query takes.
const EMPTY_LIST: any[] = [];

type SourceKind = "PO" | "WORK_DONE" | "GRN" | "TOD";
const SOURCE_TABS: Array<{ kind: SourceKind; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = [
  { kind: "PO", label: "Purchase Order", icon: FileText },
  { kind: "WORK_DONE", label: "Work Done", icon: Wallet },
  { kind: "GRN", label: "GRN", icon: Truck },
  { kind: "TOD", label: "Other Expense", icon: Receipt },
];

function todayISO() {
  return istToday();
}

function fmt(n: number) {
  return (n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function NewInvoiceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const route = useRoute<RouteProp<MainStackParamList, "NewInvoice">>();
  const editingId = route.params?.id ?? null;
  const isEditing = !!editingId;
  const qc = useQueryClient();

  const [sourceKind, setSourceKind] = useState<SourceKind>("PO");
  const [docTypeId, setDocTypeId] = useState<number | null>(null);
  const [docNo, setDocNo] = useState("");
  const [bookingDate, setBookingDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [finYear, setFinYear] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyLabel, setCompanyLabel] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectLabel, setProjectLabel] = useState("");
  const [supplier, setSupplier] = useState("");
  const [supplierLHeadId, setSupplierLHeadId] = useState<number | null>(null);

  const [selectedPO, setSelectedPO] = useState<POOption | null>(null);
  const [selectedWD, setSelectedWD] = useState<WorkDoneOption | null>(null);
  // GRN supports combining several GRNs off the *same* PO into one invoice
  // (aggregateGRNsForInvoice) — selectedGRNIds is the checked set, and
  // grnMerged holds the fetched+summed result once the sheet is confirmed.
  const [selectedGRNIds, setSelectedGRNIds] = useState<number[]>([]);
  const [grnMerged, setGrnMerged] = useState<{ docLabel: string; items: GRNItemLine[] } | null>(null);
  const [grnMerging, setGrnMerging] = useState(false);
  const [todLabel, setTodLabel] = useState("");
  const [prefillSourceId, setPrefillSourceId] = useState<number | null>(null);

  const [basicAmount, setBasicAmount] = useState("");
  const [cgstRate, setCgstRate] = useState("0");
  const [sgstRate, setSgstRate] = useState("0");
  const [igstRate, setIgstRate] = useState("0");
  const [remarks, setRemarks] = useState("");
  const [costCenterLabel, setCostCenterLabel] = useState("");

  const [emiEnabled, setEmiEnabled] = useState(false);
  const [emiCount, setEmiCount] = useState("3");
  const [emiStartDate, setEmiStartDate] = useState("");

  const [selectedTerms, setSelectedTerms] = useState<BillingTerm[]>([]);

  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [finYearPickerOpen, setFinYearPickerOpen] = useState(false);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [grnSheetOpen, setGrnSheetOpen] = useState(false);
  const [costCenterPickerOpen, setCostCenterPickerOpen] = useState(false);
  const [termsSheetOpen, setTermsSheetOpen] = useState(false);

  const { data: companies = EMPTY_LIST } = useQuery({ queryKey: ["inv-companies"], queryFn: fetchCompanyOptions });
  const { data: allProjects = EMPTY_LIST } = useQuery({ queryKey: ["inv-projects"], queryFn: fetchProjectOptions });
  const { data: finYears = [] } = useQuery({ queryKey: ["inv-finyears"], queryFn: fetchFinYearOptions });
  // New records are locked to the current financial year (else the most
  // recent one); an existing record keeps the year it was saved with.
  const lockedFY = useLockedFinYear(!isEditing);
  const finYearLocked = (!isEditing) && !!lockedFY;
  useEffect(() => {
    if (!(!isEditing) || !lockedFY) return;
    setFinYear(lockedFY.label);
  }, [isEditing, lockedFY?.id]);
  const { data: supplierHeads = [] } = useQuery({ queryKey: ["inv-supplier-heads"], queryFn: fetchSupplierHeads });
  const { data: contractorHeads = [] } = useQuery({ queryKey: ["inv-contractor-heads"], queryFn: fetchContractorHeads });
  const { data: brokerHeads = [] } = useQuery({ queryKey: ["inv-broker-heads"], queryFn: fetchBrokerHeads });
  // "Payable To" spans all three party types — merged once here so the
  // picker and the id lookup on select both read from one combined list.
  const payableParties = useMemo(
    () => [
      ...supplierHeads.map((s) => ({ ...s, group: "Supplier" })),
      ...contractorHeads.map((c) => ({ ...c, group: "Contractor" })),
      ...brokerHeads.map((b) => ({ ...b, group: "Broker" })),
    ],
    [supplierHeads, contractorHeads, brokerHeads],
  );
  const { data: poList = EMPTY_LIST, isLoading: poLoading } = useQuery({ queryKey: ["inv-po-list"], queryFn: fetchPOOptions, enabled: sourceKind === "PO" });
  const { data: wdList = EMPTY_LIST, isLoading: wdLoading } = useQuery({ queryKey: ["inv-wd-list"], queryFn: fetchWorkDoneOptions, enabled: sourceKind === "WORK_DONE" });
  const { data: grnList = EMPTY_LIST, isLoading: grnLoading } = useQuery({ queryKey: ["inv-grn-list"], queryFn: fetchGRNOptions, enabled: sourceKind === "GRN" });
  const { data: todTypes = [] } = useQuery({ queryKey: ["inv-tod-types"], queryFn: fetchExpenseDocTypes, enabled: sourceKind === "TOD" });
  const { data: billingTermOptions = [] } = useQuery({ queryKey: ["inv-billing-terms"], queryFn: fetchBillingTermOptions, enabled: termsSheetOpen });
  const { data: costCenters = [] } = useQuery({ queryKey: ["inv-cost-centers"], queryFn: fetchCostCenterOptionsInv, enabled: costCenterPickerOpen });

  const { data: existing, isLoading: existingLoading } = useQuery({
    queryKey: ["invoice-edit", editingId],
    queryFn: () => fetchInvoiceById(editingId!),
    enabled: isEditing,
  });

  // Prefill the form once the existing record + its lookup lists have loaded
  useEffect(() => {
    if (!existing) return;
    setDocNo(existing.bookingReference);
    setBookingDate(existing.bookingDate || todayISO());
    setDueDate(existing.dueDate);
    setFinYear(existing.financialYear);
    setSupplier(existing.supplier);
    setSupplierLHeadId(existing.supplierLHeadId);
    setBasicAmount(existing.basicAmount ? String(existing.basicAmount) : "");
    setCgstRate(String(existing.cgstRate));
    setSgstRate(String(existing.sgstRate));
    setIgstRate(String(existing.igstRate));
    setRemarks(existing.remarks);
    setCostCenterLabel(existing.costCenter);
    setEmiEnabled(existing.emi.enabled);
    setEmiCount(String(existing.emi.installmentCount || 3));
    setEmiStartDate(existing.emi.startDate);
    setSelectedTerms(existing.billingTerms);
    if (existing.companyId) setCompanyId(String(existing.companyId));
    if (existing.eSourceType === "PO" || existing.eSourceType === "WORK_DONE" || existing.eSourceType === "GRN") {
      setSourceKind(existing.eSourceType);
      setPrefillSourceId(existing.eSourceId);
    } else {
      setSourceKind("TOD");
      setTodLabel(existing.materialCategory);
    }
  }, [existing]);

  // Resolve company/project labels once companies/projects load (edit mode)
  useEffect(() => {
    if (!existing || !companyId) return;
    setCompanyLabel((companies as any[]).find((c) => String(c.id) === companyId)?.label ?? "");
  }, [existing, companyId, companies]);
  useEffect(() => {
    if (!existing || !existing.projectId) return;
    setProjectId(existing.projectId);
    setProjectLabel((allProjects as any[]).find((p) => String(p.id) === existing.projectId)?.label ?? "");
  }, [existing, allProjects]);

  // Attach the previously-linked PO/WorkDone/GRN once its list has loaded
  useEffect(() => {
    if (!prefillSourceId) return;
    if (sourceKind === "PO" && poList.length) {
      const po = poList.find((p) => p.PurchaseOrderID === prefillSourceId);
      if (po) { setSelectedPO(po); setPrefillSourceId(null); }
    } else if (sourceKind === "WORK_DONE" && wdList.length) {
      const wd = wdList.find((w) => w.ID === prefillSourceId);
      if (wd) { setSelectedWD(wd); setPrefillSourceId(null); }
    } else if (sourceKind === "GRN" && grnList.length) {
      const ids = existing?.linkedGrnIds && existing.linkedGrnIds.length > 1 ? existing.linkedGrnIds : [prefillSourceId];
      Promise.all(ids.map((gid) => fetchGRNDetail(gid))).then((details) => {
        const valid = details.filter((d): d is GRNDetail => !!d);
        if (valid.length === 0) return;
        setSelectedGRNIds(ids);
        setGrnMerged({
          docLabel: valid.map((d) => d.GRNNo || d.DocNo || `#${d.GRNID}`).join(" + "),
          items: valid.flatMap((d) => d.items),
        });
        setPrefillSourceId(null);
      });
    }
  }, [prefillSourceId, sourceKind, poList, wdList, grnList, existing]);

  const projects = useMemo(() => (allProjects as any[]).filter((p) => String(p.company_id) === companyId), [allProjects, companyId]);

  // Auto-fetch a doc number preview when switching to Other Expense with a doc type (create mode only)
  useEffect(() => {
    if (isEditing || sourceKind !== "TOD" || !docTypeId) return;
    fetchNextExpenseDocNumber(docTypeId, finYear || undefined).then(setDocNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKind, docTypeId, finYear, isEditing]);

  const applyPO = (po: POOption) => {
    setSelectedPO(po); setSelectedWD(null); setSelectedGRNIds([]); setGrnMerged(null); setTodLabel("");
    setDocNo(po.PurchaseOrderNo);
    setBasicAmount(po.TotalAmount != null ? String(po.TotalAmount) : "");
    if (po.SupplierName) setSupplier(po.SupplierName);
    if (po.CompanyId) { setCompanyId(String(po.CompanyId)); setCompanyLabel((companies as any[]).find((c) => c.id === po.CompanyId)?.label ?? ""); }
    if (po.ProjectId) { setProjectId(String(po.ProjectId)); setProjectLabel((allProjects as any[]).find((p) => p.id === po.ProjectId)?.label ?? ""); }
    if (po.GST?.applicable) {
      if (po.GST.type === "igst") { setIgstRate(String(po.GST.rate ?? 0)); setCgstRate("0"); setSgstRate("0"); }
      else { setCgstRate(String((po.GST.rate ?? 0) / 2)); setSgstRate(String((po.GST.rate ?? 0) / 2)); setIgstRate("0"); }
    }
    setDocPickerOpen(false);
  };

  const applyWD = (wd: WorkDoneOption) => {
    setSelectedWD(wd); setSelectedPO(null); setSelectedGRNIds([]); setGrnMerged(null); setTodLabel("");
    setDocNo(wd.DocNo ?? `WD-${wd.ID}`);
    setBasicAmount(wd.CertifiedAmount != null ? String(wd.CertifiedAmount) : "");
    if (wd.ContractorName) setSupplier(wd.ContractorName);
    if (wd.CompanyId) { setCompanyId(String(wd.CompanyId)); setCompanyLabel((companies as any[]).find((c) => c.id === wd.CompanyId)?.label ?? ""); }
    if (wd.ProjectId) { setProjectId(String(wd.ProjectId)); setProjectLabel((allProjects as any[]).find((p) => p.id === wd.ProjectId)?.label ?? ""); }
    if (wd.GST?.applicable) {
      if (wd.GST.type === "igst") { setIgstRate(String(wd.GST.rate ?? 0)); setCgstRate("0"); setSgstRate("0"); }
      else { setCgstRate(String((wd.GST.rate ?? 0) / 2)); setSgstRate(String((wd.GST.rate ?? 0) / 2)); setIgstRate("0"); }
    }
    setDocPickerOpen(false);
  };

  // GRN — basic amount is qty×rate (no GST, matches web), GST rates come
  // from the live per-item breakdown fetch, not a top-level GST blob (GRNs
  // don't have one — rates are HSN-driven per line item). Supports
  // combining several GRNs off the same PO (aggregateGRNsForInvoice) — the
  // GRN sheet lets the user check multiple, this fires once on "Done".
  const confirmGrnSelection = async () => {
    if (selectedGRNIds.length === 0) { setGrnSheetOpen(false); return; }
    const chosen = grnList.filter((g) => selectedGRNIds.includes(g.GRNID));
    setGrnMerging(true);
    try {
      const agg = await aggregateGRNsForInvoice(chosen);
      if (!agg.valid) {
        Alert.alert("Can't combine these GRNs", agg.error ?? "Unknown error.");
        return;
      }
      setSelectedPO(null); setSelectedWD(null); setTodLabel("");
      setGrnMerged({ docLabel: agg.grnDocNos.join(" + "), items: agg.items });
      setDocNo(agg.grnDocNos.join(" + "));
      setBasicAmount(String(Math.round(agg.basicAmount * 100) / 100));
      setCgstRate(String(agg.cgstRate));
      setSgstRate(String(agg.sgstRate));
      setIgstRate("0");
      const primary = chosen[0];
      if (primary?.SupplierName) setSupplier(primary.SupplierName);
      if (primary?.CompanyId) { setCompanyId(String(primary.CompanyId)); setCompanyLabel((companies as any[]).find((c) => c.id === primary.CompanyId)?.label ?? ""); }
      if (primary?.ProjectId) { setProjectId(String(primary.ProjectId)); setProjectLabel((allProjects as any[]).find((p) => p.id === primary.ProjectId)?.label ?? ""); }
      if (agg.grnDocNos.length > 1) {
        Alert.alert("GRNs combined", `Combined ${agg.grnIds.length} GRNs — total ₹${fmt(agg.totalAmount)}`);
      }
      setGrnSheetOpen(false);
    } finally {
      setGrnMerging(false);
    }
  };

  const applyTod = (dt: DocTypeOption) => {
    setDocTypeId(dt.TypeOfDocId);
    setTodLabel(dt.Description);
    setSelectedPO(null); setSelectedWD(null); setSelectedGRNIds([]); setGrnMerged(null);
    setDocPickerOpen(false);
  };

  const bd = computeBreakdown(Number(basicAmount) || 0, Number(cgstRate) || 0, Number(sgstRate) || 0, Number(igstRate) || 0, selectedTerms);
  const netAmount = bd.netAmount;

  const docLabel = sourceKind === "PO" ? (selectedPO ? `${selectedPO.PurchaseOrderNo} — ${selectedPO.SupplierName ?? ""}` : "") :
    sourceKind === "WORK_DONE" ? (selectedWD ? `${selectedWD.DocNo ?? `#${selectedWD.ID}`} — ${selectedWD.ContractorName ?? ""}` : "") :
    sourceKind === "GRN" ? (grnMerged ? `${grnMerged.docLabel} — ${supplier}` : "") :
    todLabel;

  const toggleTerm = (t: BillingTermOption) => {
    const config = billingTermToConfig(t);
    setSelectedTerms((prev) => {
      const exists = prev.find((p) => p.masterTermName === t.Name);
      return exists ? prev.filter((p) => p.masterTermName !== t.Name) : [...prev, config];
    });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("Please select a company.");
      if (!bookingDate) throw new Error("Booking date is required.");
      if (!docNo.trim()) throw new Error("Please select a document first.");
      const amt = Number(basicAmount) || 0;
      if (amt <= 0) throw new Error("Basic amount must be greater than 0.");
      if (emiEnabled && (!emiStartDate || Number(emiCount) <= 0)) throw new Error("EMI needs an installment count and start date.");

      const emiSchedule = emiEnabled ? generateEmiSchedule(netAmount, Number(emiCount), emiStartDate, docNo) : [];
      const emiData = { enabled: emiEnabled, installmentCount: emiEnabled ? Number(emiCount) : 0, emiAmount: emiEnabled ? (emiSchedule[0]?.amount ?? 0) : 0, startDate: emiEnabled ? emiStartDate : "", schedule: emiSchedule };
      const primaryTerm = selectedTerms[0] ?? null;

      const payload = {
        EName: supplier ? `Payment for ${supplier}` : docNo,
        LHeadId: supplierLHeadId,
        EProjectName: projectId || null,
        EDocumentType: sourceKind === "PO" ? "PO" : sourceKind === "WORK_DONE" ? "WORK_DONE" : sourceKind === "GRN" ? "GRN" : todLabel,
        EDocDate: bookingDate,
        EAmount: amt,
        ENetAmount: netAmount,
        ECgstRate: Number(cgstRate) || 0,
        ESgstRate: Number(sgstRate) || 0,
        EIgstRate: Number(igstRate) || 0,
        EDiscountData: JSON.stringify(primaryTerm ?? { applicable: false, type: "percentage", value: 0, appliedOn: "pre-gst", masterTermId: null, masterTermName: null }),
        EBillingTermsData: JSON.stringify(selectedTerms),
        EDocNo: docNo,
        EDocTypeId: docTypeId,
        EFinYear: finYear || null,
        EEmiPayment: emiEnabled,
        EEmiData: JSON.stringify(emiData),
        EInstallmentCount: emiEnabled ? Number(emiCount) : null,
        EEmiAmount: emiEnabled ? (emiSchedule[0]?.amount ?? 0) : null,
        EEmiStartDate: emiEnabled ? emiStartDate : null,
        EReminder: dueDate || null,
        ERemarks: remarks || null,
        ECompanyId: Number(companyId), // validated non-empty above (line 370 throws if falsy)
        ECostCenter: costCenterLabel || null,
        ESourceType: (selectedPO ? "PO" : selectedWD ? "WORK_DONE" : grnMerged ? "GRN" : sourceKind === "TOD" ? "TOD" : null) as any,
        ESourceId: selectedPO?.PurchaseOrderID ?? selectedWD?.ID ?? selectedGRNIds[0] ?? null,
        linkedGrnIds: selectedGRNIds.length > 1 ? selectedGRNIds : undefined,
      };
      return isEditing ? updateExpenseBooking(editingId!, payload) : createExpenseBooking(payload);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      if (isEditing) qc.invalidateQueries({ queryKey: ["invoice", editingId] });
      Alert.alert(
        isEditing ? "Invoice updated" : "Invoice created",
        result.docNo ? `Reference: ${result.docNo}` : "Sent for approval.",
        [{ text: "OK", onPress: () => navigation.goBack() }],
      );
    },
    onError: (e: Error) => Alert.alert("Save failed", e.message),
  });

  if (isEditing && existingLoading) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
        <SheetShell eyebrow="CivilierERP · Finance" title="Edit invoice" action={<Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} style={{ alignSelf: "flex-start" }} />}>
          <Skel h={160} />
          <Skel h={200} />
        </SheetShell>
      </ScrollView>
    );
  }

  const sourceLabel = SOURCE_TABS.find((t) => t.kind === sourceKind)?.label ?? "";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title={isEditing ? "Edit invoice" : "New invoice"}
        subtitle={docNo || "Book an expense against a purchase order, confirmed work done, a GRN or an invoice document"}
        action={<Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} style={{ alignSelf: "flex-start" }} />}
      >
        <Panel title="Party & project">
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            <PickerField label="Company *" value={companyLabel} placeholder="Select company…" onPress={() => setCompanyPickerOpen(true)} />
            <PickerField label="Project" value={projectLabel} placeholder="Select project…" onPress={() => setProjectPickerOpen(true)} disabled={!companyId} />
            <PickerField label={finYearLocked ? "Financial Year · locked" : "Financial Year"} value={finYear} placeholder="Select FY…" onPress={() => setFinYearPickerOpen(true)} disabled={finYearLocked} />
            <PickerField label="Supplier / Vendor" value={supplier} placeholder="Select payable party…" onPress={() => setSupplierPickerOpen(true)} disabled={!!selectedPO || !!selectedWD || !!grnMerged} />
            <PickerField label="Cost Centre" value={costCenterLabel} placeholder="Select cost centre…" onPress={() => setCostCenterPickerOpen(true)} wide />
          </View>
        </Panel>

        <Panel title="Document selection">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Seg
              options={SOURCE_TABS.map((t) => ({ value: t.kind, label: t.label }))}
              value={sourceKind}
              onChange={(kind) => {
                setSourceKind(kind);
                setSelectedPO(null);
                setSelectedWD(null);
                setSelectedGRNIds([]);
                setGrnMerged(null);
                setTodLabel("");
                setDocNo("");
                setBasicAmount("");
              }}
            />
          </ScrollView>

          <PickerField
            label="Selected Document"
            value={docLabel}
            placeholder={sourceKind === "GRN" ? "Pick one or more GRNs (same PO to combine)…" : `Pick a ${sourceLabel.toLowerCase()}…`}
            onPress={() => (sourceKind === "GRN" ? setGrnSheetOpen(true) : setDocPickerOpen(true))}
            wide
          />

          {!!docNo && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Label>Doc No.</Label>
              <Text style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{docNo}</Text>
            </View>
          )}

          {/* GRN items: only for a GRN source; every selected GRN's items, merged */}
          {sourceKind === "GRN" && grnMerged && grnMerged.items.length > 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
              {grnMerged.items.map((it, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                  <Text numberOfLines={1} style={{ flex: 1, color: S.ink, fontSize: 12.5, fontFamily: fonts.body.medium }}>{it.itemName || "—"}</Text>
                  <Text style={{ color: S.ink2, fontSize: 12, fontFamily: fonts.heading.semibold }}>
                    {it.receivedQty} {it.uom}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Panel>

        <Panel title="Booking information">
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
            <DateField label="Booking Date" value={bookingDate} onChangeText={setBookingDate} />
            <DateField label="Due Date" value={dueDate} onChangeText={setDueDate} />
          </View>
          <TextField label="Remarks" value={remarks} onChangeText={setRemarks} placeholder="Internal remarks…" multiline />
        </Panel>

        <Panel title="Amount & GST">
          <TextField label="Basic Amount (₹)" value={basicAmount} onChangeText={setBasicAmount} placeholder="0.00" keyboardType="numeric" />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <TextField label="CGST %" value={cgstRate} onChangeText={setCgstRate} keyboardType="numeric" width="31%" />
            <TextField label="SGST %" value={sgstRate} onChangeText={setSgstRate} keyboardType="numeric" width="31%" />
            <TextField label="IGST %" value={igstRate} onChangeText={setIgstRate} keyboardType="numeric" width="31%" />
          </View>
        </Panel>

        <Panel title="Billing terms">
          <Key label="Add term" icon={<Plus size={13} color={S.ink} />} onPress={() => setTermsSheetOpen(true)} style={{ alignSelf: "flex-start", minHeight: 36 }} />
          {selectedTerms.length === 0 ? (
            <Body size={12.5} color={S.graphite}>No billing terms applied.</Body>
          ) : (
            <View>
              {selectedTerms.map((t, i) => {
                const add = t.deductionType === "Addition";
                return (
                  <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                    <Text style={{ width: 14, color: add ? S.blue : S.red, fontSize: 15, fontFamily: fonts.heading.semibold }}>{add ? "+" : "−"}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: S.ink, fontSize: 12.5, fontFamily: fonts.body.medium }}>{t.masterTermName}</Text>
                      <Body size={11} color={S.graphite}>{`${t.type === "percentage" ? `${t.value}%` : `₹${t.value}`} · ${t.appliedOn === "post-gst" ? "post-GST" : "pre-GST"}`}</Body>
                    </View>
                    <IconKey onPress={() => setSelectedTerms((prev) => prev.filter((x) => x !== t))} size={30} red>
                      <X size={12} color={S.red} />
                    </IconKey>
                  </View>
                );
              })}
            </View>
          )}
        </Panel>

        <Panel title="EMI / installments" icon={<CreditCard size={14} color={S.ink} />}>
          <Seg
            options={[
              { value: "off", label: "No EMI" },
              { value: "on", label: "Pay by EMI" },
            ]}
            value={emiEnabled ? "on" : "off"}
            onChange={(v) => setEmiEnabled(v === "on")}
          />
          {emiEnabled && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
              <TextField label="Installments" value={emiCount} onChangeText={setEmiCount} keyboardType="numeric" width="48%" />
              <DateField label="Start Date" value={emiStartDate} onChangeText={setEmiStartDate} />
            </View>
          )}
        </Panel>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTopWidth: 1.5, borderTopColor: S.ink }}>
          <Label color={S.ink}>Net payable</Label>
          <Text style={{ color: S.ink, fontSize: 22, letterSpacing: -0.5, fontFamily: fonts.heading.semibold }}>₹{fmt(netAmount)}</Text>
        </View>

        <Key tone="ink" label={saveMutation.isPending ? "Saving…" : isEditing ? "Update invoice" : "Create invoice"} onPress={() => saveMutation.mutate()} disabled={saveMutation.isPending} />
      </SheetShell>

      {/* ── Pickers ── */}
      <OptionSheet
        visible={companyPickerOpen}
        title="Select company"
        options={(companies as any[]).map((c) => ({ id: c.id, label: c.label }))}
        onClose={() => setCompanyPickerOpen(false)}
        onSelect={(id) => {
          setCompanyId(id);
          setCompanyLabel((companies as any[]).find((c) => String(c.id) === id)?.label ?? "");
          setProjectId("");
          setProjectLabel("");
          setCompanyPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={projectPickerOpen}
        title="Select project"
        options={projects.map((p) => ({ id: p.id, label: p.label }))}
        onClose={() => setProjectPickerOpen(false)}
        onSelect={(id) => {
          setProjectId(id);
          setProjectLabel(projects.find((p) => String(p.id) === id)?.label ?? "");
          setProjectPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={finYearPickerOpen}
        title="Select financial year"
        options={(finYears as any[]).map((f) => ({ id: f.label, label: f.label }))}
        onClose={() => setFinYearPickerOpen(false)}
        onSelect={(id) => {
          setFinYear(id);
          setFinYearPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={supplierPickerOpen}
        title="Select payable party"
        options={payableParties.map((p) => ({ id: p.id, label: p.label, sub: p.group }))}
        onClose={() => setSupplierPickerOpen(false)}
        onSelect={(id) => {
          const head = payableParties.find((p) => String(p.id) === id);
          setSupplier(head?.label ?? "");
          setSupplierLHeadId(head?.id ?? null);
          setSupplierPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={costCenterPickerOpen}
        title="Select cost centre"
        options={costCenters.map((c) => ({ id: c.id, label: c.label }))}
        onClose={() => setCostCenterPickerOpen(false)}
        onSelect={(id) => {
          setCostCenterLabel(costCenters.find((c) => String(c.id) === id)?.label ?? "");
          setCostCenterPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={docPickerOpen}
        title={`Select ${sourceLabel.toLowerCase()}`}
        options={
          sourceKind === "PO"
            ? poLoading
              ? []
              : poList.map((po) => ({ id: po.PurchaseOrderID, label: po.PurchaseOrderNo, sub: `${po.SupplierName ?? "—"} · ₹${fmt(po.TotalAmount ?? 0)}` }))
            : sourceKind === "WORK_DONE"
              ? wdLoading
                ? []
                : wdList.map((wd) => ({ id: wd.ID, label: wd.DocNo ?? `#${wd.ID}`, sub: `${wd.ContractorName ?? "—"} · ₹${fmt(wd.CertifiedAmount ?? 0)}` }))
              : todTypes.map((t) => ({ id: t.TypeOfDocId, label: t.Description, sub: t.DocNoPrefix ?? t.FullPrefix ?? t.Prefix }))
        }
        onClose={() => setDocPickerOpen(false)}
        onSelect={(id) => {
          if (sourceKind === "PO") {
            const po = poList.find((x) => String(x.PurchaseOrderID) === id);
            if (po) applyPO(po);
          } else if (sourceKind === "WORK_DONE") {
            const wd = wdList.find((w) => String(w.ID) === id);
            if (wd) applyWD(wd);
          } else {
            const dt = todTypes.find((t) => String(t.TypeOfDocId) === id);
            if (dt) applyTod(dt);
          }
        }}
      />

      {/* GRNs: tick one or more off the same PO to combine into one invoice (aggregateGRNsForInvoice); once one is
          ticked, GRNs from other POs can't be. */}
      <SheetPicker
        visible={grnSheetOpen}
        title="Select GRN(s)"
        note="Tick more than one to combine; they must share the same PO."
        onClose={() => setGrnSheetOpen(false)}
        footer={
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: S.ink }}>
            <Key
              tone="ink"
              label={grnMerging ? "Combining…" : selectedGRNIds.length > 1 ? `Combine ${selectedGRNIds.length} GRNs` : "Use this GRN"}
              onPress={confirmGrnSelection}
              disabled={grnMerging || selectedGRNIds.length === 0}
            />
          </View>
        }
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
          {grnLoading ? (
            <View style={{ padding: 16 }}>
              <Skel h={40} />
              <Skel h={40} />
            </View>
          ) : grnList.length === 0 ? (
            <Body color={S.graphite} style={{ textAlign: "center", paddingVertical: 28 }}>No GRNs found</Body>
          ) : (
            grnList.map((g) => {
              const isSel = selectedGRNIds.includes(g.GRNID);
              const anchorPOID = selectedGRNIds.length > 0 ? grnList.find((x) => x.GRNID === selectedGRNIds[0])?.POID : null;
              const blocked = !isSel && anchorPOID != null && g.POID !== anchorPOID;
              return (
                <OptionRow
                  key={g.GRNID}
                  check
                  disabled={blocked}
                  selected={isSel}
                  label={g.GRNNo || g.DocNo || `#${g.GRNID}`}
                  sub={`${g.SupplierName ?? "—"} · ₹${fmt(g.TotalAmount ?? 0)}`}
                  onPress={() => setSelectedGRNIds((prev) => (isSel ? prev.filter((x) => x !== g.GRNID) : [...prev, g.GRNID]))}
                />
              );
            })
          )}
        </ScrollView>
      </SheetPicker>

      {/* Billing terms: several may be chosen */}
      <SheetPicker
        visible={termsSheetOpen}
        title="Billing terms"
        onClose={() => setTermsSheetOpen(false)}
        footer={
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: S.ink }}>
            <Key tone="ink" label={`Done${selectedTerms.length ? ` · ${selectedTerms.length} applied` : ""}`} onPress={() => setTermsSheetOpen(false)} />
          </View>
        }
      >
        <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
          {billingTermOptions.length === 0 ? (
            <Body color={S.graphite} style={{ textAlign: "center", paddingVertical: 28 }}>No billing terms found</Body>
          ) : (
            billingTermOptions.map((t) => (
              <OptionRow
                key={t.BillingTermID}
                check
                selected={selectedTerms.some((x) => x.masterTermName === t.Name)}
                label={`${t.Name} (${t.DiscountValue}${t.CalculationType === "flat" ? "₹" : "%"})`}
                onPress={() => toggleTerm(t)}
              />
            ))
          )}
        </ScrollView>
      </SheetPicker>
    </ScrollView>
  );
}
