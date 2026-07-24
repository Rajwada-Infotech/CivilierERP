// RN port of src/pages/material/MaterialExpenseBooking.tsx's "form" view —
// create AND edit (route param `id` switches modes). Covers PO / Work Done
// / GRN (single or multi-combine off the same PO) / Other Expense (TOD)
// document sources, EMI, and billing terms. Not ported: file attachments
// (the web Invoice form has none either — no backend column for it, unlike
// Contract).
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal, Switch } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Search, X, FileText, Wallet, Receipt, Truck, CreditCard, Check } from "lucide-react-native";
import {
  fetchPOOptions, fetchWorkDoneOptions, fetchExpenseDocTypes, fetchNextExpenseDocNumber,
  fetchSupplierHeads, createExpenseBooking, updateExpenseBooking, fetchInvoiceById,
  fetchGRNOptions, fetchGRNDetail, aggregateGRNsForInvoice,
  fetchBillingTermOptions, billingTermToConfig, fetchCostCenterOptionsInv,
  generateEmiSchedule, computeBreakdown,
  type POOption, type WorkDoneOption, type DocTypeOption, type GRNOption, type GRNDetail,
  type BillingTermOption, type BillingTerm, type GRNItemLine,
} from "@/api/invoiceApi";
import { fetchCompanyOptions, fetchProjectOptions, fetchFinYearOptions } from "@/api/newPaymentApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const ACCENT = "#6467f2";

type SourceKind = "PO" | "WORK_DONE" | "GRN" | "TOD";
const SOURCE_TABS: Array<{ kind: SourceKind; label: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = [
  { kind: "PO", label: "Purchase Order", icon: FileText },
  { kind: "WORK_DONE", label: "Work Done", icon: Wallet },
  { kind: "GRN", label: "GRN", icon: Truck },
  { kind: "TOD", label: "Other Expense", icon: Receipt },
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fieldLabel(text: string) {
  return (
    <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 5 }}>
      {text}
    </Text>
  );
}

function TextField({
  label, value, onChangeText, placeholder, keyboardType, multiline,
}: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: "default" | "numeric"; multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      {fieldLabel(label)}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={`${colors.mutedForeground}80`}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        style={{
          color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular,
          backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border,
          borderRadius: 12, paddingHorizontal: 12, paddingVertical: multiline ? 10 : 11,
          textAlignVertical: multiline ? "top" : "center",
        }}
      />
    </View>
  );
}

function PickerField({
  label, value, placeholder, onPress, disabled, width = "48%",
}: {
  label: string; value: string; placeholder: string; onPress: () => void; disabled?: boolean; width?: string;
}) {
  return (
    <View style={{ width, marginBottom: 14, opacity: disabled ? 0.5 : 1 }}>
      {fieldLabel(label)}
      <Pressable
        onPress={disabled ? undefined : onPress}
        className="flex-row items-center justify-between"
        style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 }}
      >
        <Text numberOfLines={1} style={{ color: value ? colors.foreground : `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular, flexShrink: 1 }}>
          {value || placeholder}
        </Text>
        <ChevronDown size={13} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

function OptionSheet({
  visible, title, options, onSelect, onClose,
}: {
  visible: boolean; title: string; options: Array<{ id: string | number; label: string; sub?: string }>; onSelect: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "70%", borderWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}><X size={16} color={colors.mutedForeground} /></Pressable>
          </View>
          <View className="px-4 py-2.5 flex-row items-center rounded-xl mx-4 mt-2.5" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}>
            <Search size={13} color={colors.mutedForeground} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search…" placeholderTextColor={`${colors.mutedForeground}80`} style={{ flex: 1, color: colors.foreground, fontSize: 12.5, paddingVertical: 8, paddingHorizontal: 8 }} />
          </View>
          <ScrollView style={{ marginTop: 8 }} contentContainerStyle={{ paddingBottom: 24 }}>
            {filtered.length === 0 ? (
              <Text className="text-center py-8" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>No matches found</Text>
            ) : (
              filtered.map((o, i) => (
                <Pressable key={`${o.id}-${i}`} onPress={() => onSelect(String(o.id))} className="px-5 py-3">
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>{o.label}</Text>
                  {!!o.sub && <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 2 }}>{o.sub}</Text>}
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
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

  const { data: companies = [] } = useQuery({ queryKey: ["inv-companies"], queryFn: fetchCompanyOptions });
  const { data: allProjects = [] } = useQuery({ queryKey: ["inv-projects"], queryFn: fetchProjectOptions });
  const { data: finYears = [] } = useQuery({ queryKey: ["inv-finyears"], queryFn: fetchFinYearOptions });
  const { data: supplierHeads = [] } = useQuery({ queryKey: ["inv-supplier-heads"], queryFn: fetchSupplierHeads });
  const { data: poList = [], isLoading: poLoading } = useQuery({ queryKey: ["inv-po-list"], queryFn: fetchPOOptions, enabled: sourceKind === "PO" });
  const { data: wdList = [], isLoading: wdLoading } = useQuery({ queryKey: ["inv-wd-list"], queryFn: fetchWorkDoneOptions, enabled: sourceKind === "WORK_DONE" });
  const { data: grnList = [], isLoading: grnLoading } = useQuery({ queryKey: ["inv-grn-list"], queryFn: fetchGRNOptions, enabled: sourceKind === "GRN" });
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
      <View className="flex-1 items-center justify-center" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <View className="flex-row items-center justify-between mb-1">
        <Pressable onPress={() => navigation.goBack()} className="flex-row items-center gap-1.5">
          <ArrowLeft size={15} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.body.medium }}>Back</Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 19, marginTop: 6 }}>{isEditing ? "Edit Invoice" : "New Invoice"}</Text>

      {/* Party & Project */}
      <View className="rounded-2xl mt-5 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Party & Project</Text>
        <View className="flex-row flex-wrap justify-between">
          <PickerField label="Company *" value={companyLabel} placeholder="Select company…" onPress={() => setCompanyPickerOpen(true)} />
          <PickerField label="Project" value={projectLabel} placeholder="Select project…" onPress={() => setProjectPickerOpen(true)} disabled={!companyId} />
          <PickerField label="Financial Year" value={finYear} placeholder="Select FY…" onPress={() => setFinYearPickerOpen(true)} />
          <PickerField
            label="Supplier / Vendor"
            value={supplier}
            placeholder="Select supplier…"
            onPress={() => setSupplierPickerOpen(true)}
            disabled={!!selectedPO || !!selectedWD || !!grnMerged}
          />
          <PickerField label="Cost Centre" value={costCenterLabel} placeholder="Select cost centre…" onPress={() => setCostCenterPickerOpen(true)} width="100%" />
        </View>
      </View>

      {/* Document Selection */}
      <View className="rounded-2xl mt-4 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Document Selection</Text>

        <View className="flex-row gap-1.5 mb-3.5">
          {SOURCE_TABS.map((t) => {
            const active = sourceKind === t.kind;
            return (
              <Pressable
                key={t.kind}
                onPress={() => { setSourceKind(t.kind); setSelectedPO(null); setSelectedWD(null); setSelectedGRNIds([]); setGrnMerged(null); setTodLabel(""); setDocNo(""); setBasicAmount(""); }}
                className="flex-1 flex-row items-center justify-center gap-1 py-2 rounded-lg"
                style={{ backgroundColor: active ? ACCENT : "transparent", borderWidth: 1, borderColor: active ? ACCENT : colors.border }}
              >
                <t.icon size={12} color={active ? "#fff" : colors.mutedForeground} />
                <Text numberOfLines={1} style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.medium }}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginBottom: 14 }}>
          {fieldLabel("Selected Document")}
          <Pressable
            onPress={() => (sourceKind === "GRN" ? setGrnSheetOpen(true) : setDocPickerOpen(true))}
            className="flex-row items-center justify-between"
            style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 }}
          >
            <Text numberOfLines={1} style={{ color: docLabel ? colors.foreground : `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular, flexShrink: 1 }}>
              {docLabel || (sourceKind === "GRN" ? "Pick one or more GRNs (same PO to combine)…" : `Pick a ${SOURCE_TABS.find((t) => t.kind === sourceKind)?.label.toLowerCase()}…`)}
            </Text>
            <ChevronDown size={13} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {!!docNo && (
          <View className="px-3.5 py-2.5 rounded-xl mb-1" style={{ backgroundColor: `${ACCENT}18`, borderWidth: 1, borderColor: `${ACCENT}33` }}>
            <Text style={{ color: ACCENT, fontSize: 12, fontFamily: fonts.heading.semibold }}>{docNo}</Text>
          </View>
        )}

        {/* GRN Items Summary — only for GRN source; merges every selected GRN's items */}
        {sourceKind === "GRN" && grnMerged && grnMerged.items.length > 0 && (
          <View className="rounded-xl mt-2 overflow-hidden" style={{ borderWidth: 1, borderColor: `${colors.border}80` }}>
            {grnMerged.items.map((it, i) => (
              <View
                key={i}
                className="flex-row items-center justify-between px-3 py-2"
                style={i < grnMerged.items.length - 1 ? { borderBottomWidth: 1, borderBottomColor: `${colors.border}50` } : undefined}
              >
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>{it.itemName || "—"}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{it.receivedQty} {it.uom}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Booking Info */}
      <View className="rounded-2xl mt-4 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Booking Information</Text>
        <View className="flex-row flex-wrap justify-between">
          <View style={{ width: "48%" }}><TextField label="Booking Date" value={bookingDate} onChangeText={setBookingDate} placeholder="YYYY-MM-DD" /></View>
          <View style={{ width: "48%" }}><TextField label="Due Date" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" /></View>
        </View>
        <TextField label="Remarks" value={remarks} onChangeText={setRemarks} placeholder="Internal remarks…" multiline />
      </View>

      {/* Amount & GST */}
      <View className="rounded-2xl mt-4 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>Amount & GST</Text>
        <TextField label="Basic Amount (₹)" value={basicAmount} onChangeText={setBasicAmount} placeholder="0.00" keyboardType="numeric" />
        <View className="flex-row flex-wrap justify-between">
          <View style={{ width: "31%" }}><TextField label="CGST %" value={cgstRate} onChangeText={setCgstRate} keyboardType="numeric" /></View>
          <View style={{ width: "31%" }}><TextField label="SGST %" value={sgstRate} onChangeText={setSgstRate} keyboardType="numeric" /></View>
          <View style={{ width: "31%" }}><TextField label="IGST %" value={igstRate} onChangeText={setIgstRate} keyboardType="numeric" /></View>
        </View>
      </View>

      {/* Billing Terms */}
      <View className="rounded-2xl mt-4 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <View className="flex-row items-center justify-between mb-3">
          <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1 }}>Billing Terms</Text>
          <Pressable onPress={() => setTermsSheetOpen(true)} className="px-2.5 py-1.5 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.heading.medium }}>Add Term</Text>
          </Pressable>
        </View>
        {selectedTerms.length === 0 ? (
          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 11.5, fontFamily: fonts.body.regular }}>No billing terms applied.</Text>
        ) : (
          selectedTerms.map((t, i) => (
            <View key={i} className="flex-row items-center justify-between px-3 py-2 rounded-lg mb-1.5" style={{ backgroundColor: t.deductionType === "Addition" ? "#10b9811a" : "#ef44441a" }}>
              <Text style={{ color: t.deductionType === "Addition" ? "#10b981" : "#ef4444", fontSize: 11.5, fontFamily: fonts.body.medium }}>
                {t.masterTermName} · {t.type === "percentage" ? `${t.value}%` : `₹${t.value}`} · {t.appliedOn === "post-gst" ? "post-GST" : "pre-GST"}
              </Text>
              <Pressable onPress={() => setSelectedTerms((prev) => prev.filter((p) => p !== t))} hitSlop={6}>
                <X size={12} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))
        )}
      </View>

      {/* EMI */}
      <View className="rounded-2xl mt-4 p-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <CreditCard size={13} color={ACCENT} />
            <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1 }}>EMI / Installments</Text>
          </View>
          <Switch value={emiEnabled} onValueChange={setEmiEnabled} trackColor={{ false: colors.muted, true: `${ACCENT}80` }} thumbColor={emiEnabled ? ACCENT : colors.mutedForeground} />
        </View>
        {emiEnabled && (
          <View className="flex-row flex-wrap justify-between mt-3">
            <View style={{ width: "48%" }}><TextField label="Installments" value={emiCount} onChangeText={setEmiCount} keyboardType="numeric" /></View>
            <View style={{ width: "48%" }}><TextField label="Start Date" value={emiStartDate} onChangeText={setEmiStartDate} placeholder="YYYY-MM-DD" /></View>
          </View>
        )}
      </View>

      {/* Net Payable */}
      <View className="flex-row items-center justify-between px-4 py-3 rounded-xl mt-4 mb-2" style={{ backgroundColor: `${ACCENT}18`, borderWidth: 1, borderColor: `${ACCENT}33` }}>
        <Text style={{ color: ACCENT, fontSize: 11, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 0.8 }}>Net Payable</Text>
        <Text style={{ color: ACCENT, fontSize: 15, fontFamily: fonts.heading.bold }}>₹{fmt(netAmount)}</Text>
      </View>

      <Pressable
        onPress={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="rounded-xl items-center mt-1"
        style={{ backgroundColor: ACCENT, paddingVertical: 13, opacity: saveMutation.isPending ? 0.6 : 1 }}
      >
        {saveMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontSize: 13.5, fontFamily: fonts.heading.semibold }}>{isEditing ? "Update Invoice" : "Create Invoice"}</Text>}
      </Pressable>

      {/* ── Pickers ── */}
      <OptionSheet
        visible={companyPickerOpen}
        title="Select Company"
        options={(companies as any[]).map((c) => ({ id: c.id, label: c.label }))}
        onClose={() => setCompanyPickerOpen(false)}
        onSelect={(id) => {
          setCompanyId(id);
          setCompanyLabel((companies as any[]).find((c) => String(c.id) === id)?.label ?? "");
          setProjectId(""); setProjectLabel("");
          setCompanyPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={projectPickerOpen}
        title="Select Project"
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
        title="Select Financial Year"
        options={(finYears as any[]).map((f) => ({ id: f.label, label: f.label }))}
        onClose={() => setFinYearPickerOpen(false)}
        onSelect={(id) => { setFinYear(id); setFinYearPickerOpen(false); }}
      />
      <OptionSheet
        visible={supplierPickerOpen}
        title="Select Supplier"
        options={supplierHeads.map((s) => ({ id: s.id, label: s.label }))}
        onClose={() => setSupplierPickerOpen(false)}
        onSelect={(id) => {
          const head = supplierHeads.find((s) => String(s.id) === id);
          setSupplier(head?.label ?? "");
          setSupplierLHeadId(head?.id ?? null);
          setSupplierPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={costCenterPickerOpen}
        title="Select Cost Centre"
        options={costCenters.map((c) => ({ id: c.id, label: c.label }))}
        onClose={() => setCostCenterPickerOpen(false)}
        onSelect={(id) => {
          setCostCenterLabel(costCenters.find((c) => String(c.id) === id)?.label ?? "");
          setCostCenterPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={docPickerOpen}
        title={`Select ${SOURCE_TABS.find((t) => t.kind === sourceKind)?.label}`}
        options={
          sourceKind === "PO"
            ? (poLoading ? [] : poList.map((po) => ({ id: po.PurchaseOrderID, label: po.PurchaseOrderNo, sub: `${po.SupplierName ?? "—"} · ₹${fmt(po.TotalAmount ?? 0)}` })))
            : sourceKind === "WORK_DONE"
              ? (wdLoading ? [] : wdList.map((wd) => ({ id: wd.ID, label: wd.DocNo ?? `#${wd.ID}`, sub: `${wd.ContractorName ?? "—"} · ₹${fmt(wd.CertifiedAmount ?? 0)}` })))
              : todTypes.map((t) => ({ id: t.TypeOfDocId, label: t.Description, sub: t.DocNoPrefix ?? t.FullPrefix ?? t.Prefix }))
        }
        onClose={() => setDocPickerOpen(false)}
        onSelect={(id) => {
          if (sourceKind === "PO") {
            const po = poList.find((p) => String(p.PurchaseOrderID) === id);
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

      {/* GRN multi-select — check one or more GRNs off the same PO to
          combine into one invoice (aggregateGRNsForInvoice); once a GRN is
          checked, others are narrowed to that same PO. */}
      <Modal visible={grnSheetOpen} transparent animationType="fade" onRequestClose={() => setGrnSheetOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setGrnSheetOpen(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "75%", borderWidth: 1, borderColor: colors.border }}>
            <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View>
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Select GRN(s)</Text>
                <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 1 }}>
                  Check more than one to combine — must share the same PO.
                </Text>
              </View>
              <Pressable onPress={() => setGrnSheetOpen(false)} hitSlop={8}><X size={16} color={colors.mutedForeground} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: 20 }}>
              {grnLoading ? (
                <View className="py-8 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
              ) : grnList.length === 0 ? (
                <Text className="text-center py-8" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>No GRNs found</Text>
              ) : (
                grnList.map((g) => {
                  const isSel = selectedGRNIds.includes(g.GRNID);
                  const anchorPOID = selectedGRNIds.length > 0 ? grnList.find((x) => x.GRNID === selectedGRNIds[0])?.POID : null;
                  const disabled = !isSel && anchorPOID != null && g.POID !== anchorPOID;
                  return (
                    <Pressable
                      key={g.GRNID}
                      disabled={disabled}
                      onPress={() => setSelectedGRNIds((prev) => (isSel ? prev.filter((id) => id !== g.GRNID) : [...prev, g.GRNID]))}
                      className="flex-row items-center gap-2.5 px-5 py-3"
                      style={{ opacity: disabled ? 0.35 : 1, backgroundColor: isSel ? `${ACCENT}0d` : "transparent" }}
                    >
                      <View className="w-4 h-4 rounded items-center justify-center" style={{ backgroundColor: isSel ? ACCENT : "transparent", borderWidth: 1, borderColor: isSel ? ACCENT : colors.border }}>
                        {isSel && <Check size={10} color="#fff" />}
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>{g.GRNNo || g.DocNo || `#${g.GRNID}`}</Text>
                        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 2 }}>{g.SupplierName ?? "—"} · ₹{fmt(g.TotalAmount ?? 0)}</Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <Pressable
              onPress={confirmGrnSelection}
              disabled={grnMerging || selectedGRNIds.length === 0}
              className="items-center py-3 mx-4 mb-4 rounded-xl"
              style={{ backgroundColor: ACCENT, opacity: grnMerging || selectedGRNIds.length === 0 ? 0.5 : 1 }}
            >
              {grnMerging ? <ActivityIndicator color="#fff" /> : (
                <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>
                  {selectedGRNIds.length > 1 ? `Combine ${selectedGRNIds.length} GRNs` : "Use this GRN"}
                </Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Billing terms multi-select */}
      <Modal visible={termsSheetOpen} transparent animationType="fade" onRequestClose={() => setTermsSheetOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setTermsSheetOpen(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "65%", borderWidth: 1, borderColor: colors.border }}>
            <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Billing Terms</Text>
              <Pressable onPress={() => setTermsSheetOpen(false)} hitSlop={8}><X size={16} color={colors.mutedForeground} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: 20 }}>
              {billingTermOptions.length === 0 ? (
                <Text className="text-center py-8" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>No billing terms found</Text>
              ) : (
                billingTermOptions.map((t) => {
                  const isSel = selectedTerms.some((s) => s.masterTermName === t.Name);
                  return (
                    <Pressable key={t.BillingTermID} onPress={() => toggleTerm(t)} className="flex-row items-center gap-2.5 px-5 py-3" style={isSel ? { backgroundColor: `${ACCENT}0d` } : undefined}>
                      <View className="w-4 h-4 rounded items-center justify-center" style={{ backgroundColor: isSel ? ACCENT : "transparent", borderWidth: 1, borderColor: isSel ? ACCENT : colors.border }}>
                        {isSel && <Check size={10} color="#fff" />}
                      </View>
                      <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>{t.Name} ({t.DiscountValue}{t.CalculationType === "flat" ? "₹" : "%"})</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}
