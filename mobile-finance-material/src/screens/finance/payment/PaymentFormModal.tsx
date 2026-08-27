// RN port of Payment.tsx's add-payment form (view="form") — covers the
// core flow: purpose/mode/amount/date, company/project, optional invoice
// link (autofills payee + suggested amount), the mode-specific reference
// panels (ChequePanel/DigitalRefPanel/CardPanel ports below), edit (pass
// `editingRecord` to prefill and PUT instead of POST), re-issue (pass
// `reissueContext`, forwarded from BrsScreen's "Re-issue" action on a
// bounced entry), and on-account-balance auto-apply (fetches the
// supplier's OA balance the moment an invoice is linked, previews how much
// would offset the outstanding via previewOAAdjustment, and lets the user
// toggle whether to apply it — sends oaSkipAutoApply on save, matching
// web's useOnAccountBalance/oaBalance flow). "Invoice outstanding" here is
// the option's own remainingAmount rather than re-deriving it from a live
// payment-chain fetch (web recomputes via formChainData) — a scoped
// simplification since the form doesn't otherwise fetch the chain. Also
// supports Contract-linking as an alternative to invoice-link (mutually
// exclusive — picking one clears the other), prefilling purpose/company/
// project/payee/amount from the contract the same way web's
// handleContractSelect does, defaulting the amount to PendingAmount. And
// the GRN-level GST breakdown preview: when a linked invoice is GRN-
// sourced (single or combined), fetches each GRN's item-level GST
// breakdown, merges them, derives effective CGST/SGST rates, and applies
// the invoice's billing terms via computeBreakdown to arrive at the true
// net payable — same math as web's applyGrnBreakdown/
// applyMultiGrnBreakdown, shown here as a read-only Tax Details card.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, Alert, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Wallet, AlertTriangle, Link2, RefreshCw, CheckCircle2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import {
  addPayment, updatePayment, fetchCompanyOptions, fetchProjectOptions, fetchBankOptions,
  fetchChequeLots, fetchChequeNumbers, deductChequeFromLot, fetchCardsByBank,
  fetchExpenseOptions, maskCardNumber, PAYMENT_MODES,
  type PaymentFormPayload, type PaymentRecord,
} from "@/api/newPaymentApi";
import { getOABalanceByRef, previewOAAdjustment } from "@/api/onAccountApi";
import { getApprovedContractsForLinking, type ContractLinkOption } from "@/api/contractApi";
import { fetchInvoiceById, fetchGrnGstBreakdown, computeBreakdown, type GrnGstBreakdown } from "@/api/invoiceApi";
import { ModeBadge } from "./PaymentBadges";
import { PickerRow, OptionPickerModal, type PickerOption } from "./OptionPicker";

type FormState = {
  paymentName: string;
  mode: string;
  amount: string;
  date: string;
  company: string;
  project: string;
  bankId: number | null;
  bankName: string;
  expenseId: string;
  expenseRef: string;
  parentDocNo: string;
  paidTo: string;
  partyId: number | null;
  chequeNo: string;
  chequeLotId: number | null;
  chequeLotNumber: string;
  chequeAccountNumber: string;
  chequeIfsc: string;
  chequeDate: string;
  isPostDated: boolean;
  neftNumber: string;
  upiTransactionId: string;
  rtgsReference: string;
  impsReference: string;
  cardReference: string;
  cardId: number | null;
  contractId: string;
};

function blankForm(): FormState {
  return {
    paymentName: "", mode: "", amount: "", date: new Date().toISOString().slice(0, 10),
    company: "", project: "", bankId: null, bankName: "",
    expenseId: "", expenseRef: "", parentDocNo: "", paidTo: "", partyId: null,
    chequeNo: "", chequeLotId: null, chequeLotNumber: "", chequeAccountNumber: "", chequeIfsc: "",
    chequeDate: "", isPostDated: false,
    neftNumber: "", upiTransactionId: "", rtgsReference: "", impsReference: "", cardReference: "", cardId: null,
    contractId: "",
  };
}

const DIGITAL_FIELD: Record<string, { key: keyof FormState; label: string; placeholder: string }> = {
  NEFT: { key: "neftNumber", label: "NEFT UTR Number", placeholder: "e.g. HDFC0000012345" },
  UPI: { key: "upiTransactionId", label: "UPI Transaction ID", placeholder: "e.g. 405987654321" },
  RTGS: { key: "rtgsReference", label: "RTGS UTR Reference", placeholder: "e.g. RTGS2026050600001" },
  IMPS: { key: "impsReference", label: "IMPS Reference Number", placeholder: "e.g. 412210987654" },
  Card: { key: "cardReference", label: "Card Transaction / Approval ID", placeholder: "e.g. AUTH123456" },
};

function FieldLabel({ children, required }: { children: string; required?: boolean }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>
      {children}{required ? " *" : ""}
    </Text>
  );
}

function TextField({
  value, onChangeText, placeholder, keyboardType,
}: { value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: "default" | "numeric" }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={`${colors.mutedForeground}99`}
      keyboardType={keyboardType}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
        color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 14,
      }}
    />
  );
}

function validateForm(f: FormState): string | null {
  if (!f.paymentName.trim()) return "Payment purpose is required.";
  if (!f.mode) return "Please select a payment mode.";
  if (!f.date) return "Payment date is required.";
  if (!f.amount || Number(f.amount) <= 0) return "Amount must be greater than zero.";

  const isChequeMode = f.mode === "Cheque" || f.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(f.mode);

  if (isChequeMode) {
    if (!f.bankId) return "Please select a bank account.";
    if (!f.chequeLotId) return "No active cheque lot found for the selected bank.";
    if (!f.chequeNo) return "Please select a cheque number from the lot.";
    if (f.mode === "Post-Dated Cheque") {
      if (!f.chequeDate) return "Post-dated cheque requires a cheque date.";
      const validUntil = new Date(f.chequeDate);
      validUntil.setMonth(validUntil.getMonth() + 3);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (validUntil < today) return "This post-dated cheque has expired. Please select a valid cheque date.";
    }
  }

  if (isDigitalMode) {
    if (!f.bankId) return "Please select a bank account.";
    const cfg = DIGITAL_FIELD[f.mode];
    if (cfg && !(f[cfg.key] as string).trim()) return `${cfg.label} is required.`;
  }

  return null;
}

export interface ReissueContext {
  replacesPaymentId: number;
  replacesDocNo: string;
  amount: number;
  paymentName: string;
  companyName: string;
  bounceReason?: string | null;
}

export function PaymentFormModal({
  visible, onClose, editingRecord, reissueContext,
}: {
  visible: boolean; onClose: () => void;
  /** Present → edit mode: prefill from this record and PUT on save instead of POST. */
  editingRecord?: PaymentRecord | null;
  /** Present → re-issue mode: prefill a fresh payment that replaces a bounced one. */
  reissueContext?: ReissueContext | null;
}) {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const isEditing = !!editingRecord;
  const isReissue = !isEditing && !!reissueContext;
  const [form, setForm] = useState<FormState>(blankForm());
  const [bounceCharge, setBounceCharge] = useState("");
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<"company" | "project" | "bank" | "invoice" | "contract" | "chequeLot" | "chequeNo" | "card" | null>(null);
  const [chequeValidating, setChequeValidating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editingRecord) {
      const r = editingRecord;
      setForm({
        paymentName: r.paymentName, mode: r.mode, amount: r.amount != null ? String(r.amount) : "",
        date: r.date || new Date().toISOString().slice(0, 10),
        company: r.company, project: r.projectSite, bankId: null, bankName: r.bankName,
        expenseId: r.expenseId, expenseRef: r.expenseRef, parentDocNo: r.parentDocNo,
        paidTo: r.paidTo, partyId: null,
        chequeNo: r.chequeNo, chequeLotId: null, chequeLotNumber: r.chequeLotNumber,
        chequeAccountNumber: "", chequeIfsc: "", chequeDate: r.chequeDate, isPostDated: r.mode === "Post-Dated Cheque",
        neftNumber: r.neftNumber, upiTransactionId: r.upiTransactionId, rtgsReference: r.rtgsReference,
        impsReference: r.impsReference, cardReference: r.cardReference, cardId: null,
        contractId: "",
      });
      setBounceCharge("");
    } else if (reissueContext) {
      setForm({
        ...blankForm(),
        paymentName: reissueContext.paymentName || `Re-issue of ${reissueContext.replacesDocNo}`,
        amount: String(reissueContext.amount),
        company: reissueContext.companyName || "",
      });
      setBounceCharge("");
    } else {
      setForm(blankForm());
      setBounceCharge("");
    }
    setSelectedContract(null);
  }, [visible, editingRecord, reissueContext]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const isChequeMode = form.mode === "Cheque" || form.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(form.mode);
  const needsBank = isChequeMode || isDigitalMode;

  const [selectedContract, setSelectedContract] = useState<ContractLinkOption | null>(null);

  const { data: companies = [] } = useQuery({ queryKey: ["form-companies"], queryFn: fetchCompanyOptions, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["form-projects"], queryFn: fetchProjectOptions, enabled: visible });
  const { data: banks = [] } = useQuery({ queryKey: ["form-banks"], queryFn: fetchBankOptions, enabled: visible });
  const { data: contracts = [], isLoading: contractsLoading } = useQuery({
    queryKey: ["form-contracts"], queryFn: getApprovedContractsForLinking, enabled: visible,
  });
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({ queryKey: ["form-invoices"], queryFn: fetchExpenseOptions, enabled: visible });

  const { data: chequeLots = [], isLoading: lotsLoading } = useQuery({
    queryKey: ["form-cheque-lots", form.bankId],
    queryFn: () => fetchChequeLots(form.bankId),
    enabled: visible && isChequeMode && !!form.bankId,
  });
  const { data: chequeNumbers = [], isLoading: numbersLoading } = useQuery({
    queryKey: ["form-cheque-numbers", form.chequeLotId],
    queryFn: () => fetchChequeNumbers(form.chequeLotId!),
    enabled: visible && isChequeMode && !!form.chequeLotId,
  });
  const { data: cards = [] } = useQuery({
    queryKey: ["form-cards", form.bankId],
    queryFn: () => fetchCardsByBank(form.bankId),
    enabled: visible && form.mode === "Card" && !!form.bankId,
  });

  // Auto-select the first active lot once loaded, mirroring ChequePanel.
  useEffect(() => {
    if (chequeLots.length > 0 && !form.chequeLotId) {
      const first = chequeLots[0];
      setForm((f) => ({
        ...f, chequeLotId: first.CId, chequeLotNumber: first.ChequeLotNumber,
        chequeAccountNumber: first.AccountNumber || "", chequeIfsc: first.IFSCCode || "", chequeNo: "",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chequeLots]);

  // Auto-select a lone card, mirroring CardPanel.
  useEffect(() => {
    if (cards.length === 1 && !form.cardId) set("cardId", cards[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards]);

  const activeLot = chequeLots.find((l) => l.CId === form.chequeLotId) ?? null;
  const availableCheques = chequeNumbers.filter((c) => !c.used && !c.bounced);
  const selectedInvoice = invoices.find((o) => o.id === form.expenseId) ?? null;
  const selectedCard = cards.find((c) => c.id === form.cardId) ?? null;

  // On-account balance auto-apply — fetch the supplier's OA balance whenever
  // the linked invoice changes (mirrors web's oaBalance effect, keyed on
  // form.expenseRef).
  const [oaBalance, setOaBalance] = useState(0);
  const [useOnAccountBalance, setUseOnAccountBalance] = useState(true);

  useEffect(() => {
    setUseOnAccountBalance(true);
    if (!form.expenseRef) { setOaBalance(0); return; }
    let cancelled = false;
    getOABalanceByRef(form.expenseRef)
      .then((d) => { if (!cancelled) setOaBalance(d.balance ?? 0); })
      .catch(() => { if (!cancelled) setOaBalance(0); });
    return () => { cancelled = true; };
  }, [form.expenseRef]);

  // GRN-level GST breakdown preview — when the linked invoice is sourced
  // from a GRN (single or combined), fetch the item-level GST breakdown for
  // each linked GRN, merge, derive effective CGST/SGST rates, apply the
  // invoice's billing terms via computeBreakdown, and use that as the true
  // net payable — mirrors web's applyGrnBreakdown/applyMultiGrnBreakdown.
  const [grnGstBreakdown, setGrnGstBreakdown] = useState<GrnGstBreakdown | null>(null);
  const [grnBreakdownLoading, setGrnBreakdownLoading] = useState(false);

  useEffect(() => {
    if (!form.expenseId) { setGrnGstBreakdown(null); return; }
    let cancelled = false;
    setGrnBreakdownLoading(true);
    setGrnGstBreakdown(null);
    (async () => {
      try {
        const detail = await fetchInvoiceById(form.expenseId);
        if (cancelled) return;
        if (detail.eSourceType !== "GRN" || !detail.eSourceId) return;
        const ids = detail.linkedGrnIds && detail.linkedGrnIds.length > 1 ? detail.linkedGrnIds : [detail.eSourceId];
        const results = await Promise.all(ids.map((id) => fetchGrnGstBreakdown(id)));
        if (cancelled) return;
        const valid = results.filter((bd): bd is GrnGstBreakdown => !!bd && bd.totals.totalInclGST > 0);
        if (valid.length === 0) return;
        const totals = valid.reduce((acc, bd) => ({
          totalBase: acc.totalBase + bd.totals.totalBase,
          totalCGST: acc.totalCGST + bd.totals.totalCGST,
          totalSGST: acc.totalSGST + bd.totals.totalSGST,
          totalGST: acc.totalGST + bd.totals.totalGST,
          totalInclGST: acc.totalInclGST + bd.totals.totalInclGST,
        }), { totalBase: 0, totalCGST: 0, totalSGST: 0, totalGST: 0, totalInclGST: 0 });
        const merged: GrnGstBreakdown = { items: valid.flatMap((bd) => bd.items), totals };
        setGrnGstBreakdown(merged);

        const avgCGST = totals.totalBase > 0 ? (totals.totalCGST / totals.totalBase) * 100 : 0;
        const avgSGST = totals.totalBase > 0 ? (totals.totalSGST / totals.totalBase) * 100 : 0;
        const { netAmount } = computeBreakdown(totals.totalBase, avgCGST, avgSGST, 0, detail.billingTerms);
        setForm((f) => (f.expenseId === detail.id ? { ...f, amount: String(netAmount) } : f));
      } catch {
        /* non-fatal — falls back to the option's flat suggested amount */
      } finally {
        if (!cancelled) setGrnBreakdownLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [form.expenseId]);

  const oaInvoiceRemaining = selectedInvoice
    ? (selectedInvoice.remainingAmount != null && selectedInvoice.remainingAmount > 0 ? selectedInvoice.remainingAmount : selectedInvoice.amount) ?? 0
    : 0;
  const oaPreview = oaBalance > 0.01 ? previewOAAdjustment(oaBalance, oaInvoiceRemaining) : null;

  // Real-time: the actual Amount due is the invoice outstanding minus
  // whatever on-account credit is being applied.
  useEffect(() => {
    if (!form.expenseRef || !oaPreview || oaPreview.applyAmount <= 0) return;
    const target = useOnAccountBalance ? oaPreview.invoiceRemainingAfter : oaInvoiceRemaining;
    setForm((f) => (Number(f.amount) === target ? f : { ...f, amount: String(target) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useOnAccountBalance, oaPreview?.applyAmount, oaPreview?.invoiceRemainingAfter, oaInvoiceRemaining, form.expenseRef]);

  const onBankSelect = (key: string) => {
    const bank = banks.find((b) => String(b.id) === key);
    setForm((f) => ({
      ...f, bankId: bank?.id ?? null, bankName: bank?.label?.split(" — ")[0] ?? "",
      chequeLotId: null, chequeLotNumber: "", chequeNo: "", cardId: null,
    }));
    setPicker(null);
  };

  const onLotSelect = (key: string) => {
    const lot = chequeLots.find((l) => String(l.CId) === key);
    if (!lot) return;
    setForm((f) => ({
      ...f, chequeLotId: lot.CId, chequeLotNumber: lot.ChequeLotNumber,
      chequeAccountNumber: lot.AccountNumber || "", chequeIfsc: lot.IFSCCode || "", chequeNo: "",
    }));
    setPicker(null);
  };

  const onChequeNumberSelect = async (chequeNo: string) => {
    setPicker(null);
    if (!chequeNo || !form.chequeLotId) return;
    setChequeValidating(true);
    try {
      await deductChequeFromLot(form.chequeLotId, chequeNo);
      set("chequeNo", chequeNo);
    } catch (err: any) {
      Alert.alert("Cheque unavailable", err.message ?? "Could not reserve this cheque number.");
    } finally {
      setChequeValidating(false);
    }
  };

  const onInvoiceSelect = (key: string) => {
    setPicker(null);
    if (!key) {
      setForm((f) => ({ ...f, expenseId: "", expenseRef: "", parentDocNo: "", paidTo: "", partyId: null }));
      return;
    }
    const o = invoices.find((x) => x.id === key);
    if (!o) return;
    const suggestedAmount = o.remainingAmount != null && o.remainingAmount > 0 ? o.remainingAmount : o.amount;
    setSelectedContract(null);
    setForm((f) => ({
      ...f,
      expenseId: o.id,
      expenseRef: o.refNumber || o.docNo || o.label,
      parentDocNo: o.parentDocNo || "",
      project: o.projectName || f.project,
      company: o.companyName || f.company,
      paidTo: o.supplierName || f.paidTo,
      partyId: o.partyId ?? f.partyId,
      amount: suggestedAmount != null ? String(suggestedAmount) : f.amount,
      contractId: "",
    }));
  };

  const onContractSelect = (key: string) => {
    setPicker(null);
    if (!key) {
      setSelectedContract(null);
      setForm((f) => ({ ...f, contractId: "" }));
      return;
    }
    const c = contracts.find((x) => String(x.ContractId) === key);
    if (!c) return;
    const companyOpt = companies.find((x) => x.id === c.CompanyId);
    const projectOpt = projects.find((x) => x.id === c.ProjectId);
    const companyLabel = companyOpt?.label || c.CompanyName || "";
    const projectLabel = projectOpt?.label || c.ProjectName || "";
    setSelectedContract(c);
    setForm((f) => ({
      ...f,
      paymentName: `Payment to ${c.ContactPerson || "Contractor"} for ${c.Reason || c.NatureOfContract || "contract work"}`,
      expenseRef: c.DocNo || "",
      expenseId: "",
      parentDocNo: "",
      contractId: String(c.ContractId),
      company: companyLabel,
      project: projectLabel,
      partyId: c.ContactPartyId ?? f.partyId,
      paidTo: c.ContactPerson || f.paidTo,
      amount: c.PendingAmount != null ? String(Math.max(Number(c.PendingAmount), 0)) : c.ContractAmount != null ? String(c.ContractAmount) : f.amount,
    }));
  };

  const clearContractLink = () => {
    setSelectedContract(null);
    setForm((f) => ({ ...f, paymentName: "", expenseRef: "", contractId: "", company: "", project: "", partyId: null, paidTo: "" }));
  };

  const handleSave = async () => {
    const error = validateForm(form);
    if (error) {
      Alert.alert("Check the form", error);
      return;
    }
    const payload: PaymentFormPayload = {
      companyId: form.company || null,
      projectId: form.project || null,
      docDate: form.date,
      docTypeId: null,
      remarks: form.paymentName || null,
      supplierId: form.expenseRef || null,
      partyId: form.partyId ?? null,
      bankId: form.bankId ?? null,
      amount: Number(form.amount) || 0,
      bankName: form.bankName || null,
      parentDocNo: form.parentDocNo || null,
      mode: form.mode || null,
      chequeNo: form.chequeNo || null,
      chequeLotId: form.chequeLotId ?? null,
      chequeLotNumber: form.chequeLotNumber || null,
      chequeDate: form.chequeDate || null,
      chequeAccountNumber: form.chequeAccountNumber || null,
      chequeIfsc: form.chequeIfsc || null,
      isPostDated: form.isPostDated,
      neftNumber: form.neftNumber || null,
      upiTransactionId: form.upiTransactionId || null,
      rtgsReference: form.rtgsReference || null,
      impsReference: form.impsReference || null,
      cardReference: form.cardReference || null,
      cardId: form.cardId ?? null,
      ContractId: form.contractId ? Number(form.contractId) : null,
      oaSkipAutoApply: oaBalance > 0.01 ? !useOnAccountBalance : undefined,
      ...(isReissue ? {
        ReplacesPaymentId: reissueContext!.replacesPaymentId,
        BounceCharge: bounceCharge ? Number(bounceCharge) : null,
        amount: (Number(form.amount) || 0) + (bounceCharge ? Number(bounceCharge) : 0),
      } : {}),
    };
    setSaving(true);
    try {
      if (isEditing) {
        await updatePayment(editingRecord!.id, payload);
        queryClient.invalidateQueries({ queryKey: ["payments-mobile"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["payment-detail", editingRecord!.id] });
        Alert.alert("Saved", "Payment updated.");
      } else {
        await addPayment(payload);
        queryClient.invalidateQueries({ queryKey: ["payments-mobile"], exact: false });
        Alert.alert("Saved", isReissue ? "Re-issue payment saved. Linked to the original." : "Payment recorded.");
      }
      onClose();
    } catch (err: any) {
      Alert.alert("Failed to save", err.message ?? "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const companyOptions: PickerOption[] = useMemo(() => companies.map((c) => ({ key: c.label, label: c.label })), [companies]);
  const projectOptions: PickerOption[] = useMemo(() => projects.map((p) => ({ key: p.label, label: p.label })), [projects]);
  const bankOptions: PickerOption[] = useMemo(() => banks.map((b) => ({ key: String(b.id), label: b.label })), [banks]);
  const lotOptions: PickerOption[] = useMemo(() => chequeLots.map((l) => ({
    key: String(l.CId), label: l.ChequeLotNumber, sublabel: l.RemainingCheques != null ? `${l.RemainingCheques} remaining` : undefined,
  })), [chequeLots]);
  const chequeNoOptions: PickerOption[] = useMemo(() => availableCheques.map((c) => ({ key: c.number, label: `# ${c.number}` })), [availableCheques]);
  const cardOptions: PickerOption[] = useMemo(() => cards.map((c) => ({
    key: String(c.id), label: [c.card_network, maskCardNumber(c.card_number), c.card_holder_name].filter(Boolean).join(" · "),
  })), [cards]);
  const invoiceOptions: PickerOption[] = useMemo(() => invoices.map((o) => ({
    key: o.id, label: o.label, sublabel: [o.projectName, o.supplierName].filter(Boolean).join(" · "),
  })), [invoices]);
  const contractOptions: PickerOption[] = useMemo(() => contracts.map((c) => ({
    key: String(c.ContractId), label: c.DocNo || `Contract #${c.ContractId}`,
    sublabel: [c.ContactPerson, c.PendingAmount != null ? `Pending ${formatINR(Math.max(c.PendingAmount, 0))}` : null].filter(Boolean).join(" · "),
  })), [contracts]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#3b82f626" }}>
              <Wallet size={14} color="#3b82f6" />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{isEditing ? "Edit Payment" : isReissue ? "Re-issue Payment" : "New Payment"}</Text>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
          {isReissue && (
            <View className="flex-row items-start gap-2.5 rounded-xl px-3.5 py-3 mb-4" style={{ backgroundColor: "#d9770614", borderWidth: 1, borderColor: "#d9770650" }}>
              <RefreshCw size={14} color="#d97706" style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#d97706", fontSize: 11.5, fontFamily: fonts.heading.semibold }}>Re-issuing bounced payment</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 2 }}>
                  Replaces {reissueContext!.replacesDocNo}{reissueContext!.bounceReason ? ` · ${reissueContext!.bounceReason}` : ""}
                </Text>
              </View>
            </View>
          )}

          <PickerRow label="Company" value={form.company} onPress={() => setPicker("company")} />
          <PickerRow label="Project" value={form.project} onPress={() => setPicker("project")} />

          <FieldLabel required>Payment Date</FieldLabel>
          <TextField value={form.date} onChangeText={(v) => set("date", v)} placeholder="YYYY-MM-DD" />

          {!selectedContract && (
            <Pressable
              onPress={() => setPicker("invoice")}
              className="flex-row items-center gap-2 px-3.5 py-3 rounded-xl mb-3"
              style={{ borderWidth: 1, borderColor: selectedInvoice ? colors.primary : colors.border, backgroundColor: selectedInvoice ? `${colors.primary}12` : `${colors.card}80` }}
            >
              <Link2 size={13} color={selectedInvoice ? colors.primary : colors.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Link to Invoice (optional)</Text>
                <Text numberOfLines={1} style={{ color: selectedInvoice ? colors.primary : `${colors.mutedForeground}99`, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>
                  {selectedInvoice ? selectedInvoice.label : "Autofills payee, company, project & amount"}
                </Text>
              </View>
            </Pressable>
          )}

          {!selectedInvoice && (
            <Pressable
              onPress={() => (selectedContract ? clearContractLink() : setPicker("contract"))}
              className="flex-row items-center gap-2 px-3.5 py-3 rounded-xl mb-3"
              style={{ borderWidth: 1, borderColor: selectedContract ? "#8b5cf6" : colors.border, backgroundColor: selectedContract ? "#8b5cf612" : `${colors.card}80` }}
            >
              <Link2 size={13} color={selectedContract ? "#8b5cf6" : colors.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Link to Contract (optional)</Text>
                <Text numberOfLines={1} style={{ color: selectedContract ? "#8b5cf6" : `${colors.mutedForeground}99`, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>
                  {selectedContract ? (selectedContract.DocNo || `Contract #${selectedContract.ContractId}`) : "Advance/installment against an approved contract"}
                </Text>
              </View>
              {selectedContract && <X size={13} color="#8b5cf6" />}
            </Pressable>
          )}

          {grnBreakdownLoading && (
            <View className="flex-row items-center gap-2 mb-3"><ActivityIndicator size="small" color={colors.mutedForeground} /><Text style={{ color: colors.mutedForeground, fontSize: 11.5 }}>Fetching GRN tax breakdown…</Text></View>
          )}

          {!!grnGstBreakdown && grnGstBreakdown.totals.totalInclGST > 0 && (
            <View className="rounded-2xl mb-4 px-3.5 py-3" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 9.5, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>
                Tax Details (from GRN)
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                <View style={{ width: "50%", marginBottom: 6 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>Taxable Amount</Text>
                  <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{formatINR(grnGstBreakdown.totals.totalBase)}</Text>
                </View>
                <View style={{ width: "50%", marginBottom: 6 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>Total GST</Text>
                  <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{formatINR(grnGstBreakdown.totals.totalGST)}</Text>
                </View>
                {grnGstBreakdown.totals.totalCGST > 0 && (
                  <View style={{ width: "50%", marginBottom: 6 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>CGST</Text>
                    <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{formatINR(grnGstBreakdown.totals.totalCGST)}</Text>
                  </View>
                )}
                {grnGstBreakdown.totals.totalSGST > 0 && (
                  <View style={{ width: "50%", marginBottom: 6 }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>SGST</Text>
                    <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{formatINR(grnGstBreakdown.totals.totalSGST)}</Text>
                  </View>
                )}
              </View>
              <View className="flex-row items-center justify-between pt-2 mt-1" style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>Net Payable (incl. billing terms)</Text>
                <Text style={{ color: colors.primary, fontSize: 14, fontFamily: fonts.heading.bold }}>{formatINR(Number(form.amount) || grnGstBreakdown.totals.totalInclGST)}</Text>
              </View>
            </View>
          )}

          {!!form.expenseRef && oaBalance > 0.01 && oaPreview && oaPreview.applyAmount > 0 && (
            <View className="rounded-2xl overflow-hidden mb-4" style={{ borderWidth: 1, borderColor: "#10b98133" }}>
              <View className="flex-row items-center justify-between gap-3 px-3.5 py-3" style={{ borderBottomWidth: 1, borderBottomColor: "#10b98122", backgroundColor: "#10b9810d" }}>
                <View className="flex-row items-center gap-2.5">
                  <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#10b98126" }}>
                    <Wallet size={14} color="#10b981" />
                  </View>
                  <View>
                    <Text style={{ color: "#10b981", fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6 }}>On Account Balance</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 9.5, marginTop: 1 }}>Available for this supplier</Text>
                  </View>
                </View>
                <Text style={{ color: "#10b981", fontSize: 15, fontFamily: fonts.heading.bold }}>{formatINR(oaBalance)}</Text>
              </View>
              <Pressable onPress={() => setUseOnAccountBalance((v) => !v)} className="flex-row items-start gap-3 px-3.5 py-3">
                <View style={{ width: 36, height: 20, borderRadius: 10, marginTop: 2, backgroundColor: useOnAccountBalance ? "#10b981" : `${colors.mutedForeground}40`, padding: 2 }}>
                  <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: "#fff", marginLeft: useOnAccountBalance ? 16 : 0 }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>Use on-account balance for this payment</Text>
                  {useOnAccountBalance ? (
                    <View className="rounded-lg mt-2 overflow-hidden" style={{ borderWidth: 1, borderColor: "#10b98122" }}>
                      <View className="flex-row items-center justify-between px-3 py-1.5">
                        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>Adjusted from balance</Text>
                        <Text style={{ color: "#10b981", fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{formatINR(oaPreview.applyAmount)}</Text>
                      </View>
                      <View className="flex-row items-center justify-between px-3 py-1.5" style={{ borderTopWidth: 1, borderTopColor: "#10b98122" }}>
                        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{oaPreview.isFullyCovered ? "Invoice status" : "Remaining outstanding"}</Text>
                        {oaPreview.isFullyCovered ? (
                          <View className="flex-row items-center gap-1">
                            <CheckCircle2 size={11} color="#10b981" />
                            <Text style={{ color: "#10b981", fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Fully settled</Text>
                          </View>
                        ) : (
                          <Text style={{ color: "#d97706", fontSize: 10.5, fontFamily: fonts.heading.semibold }}>{formatINR(oaPreview.invoiceRemainingAfter)}</Text>
                        )}
                      </View>
                    </View>
                  ) : (
                    <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 4 }}>
                      Balance stays untouched — {formatINR(oaBalance)} kept on-account.
                    </Text>
                  )}
                </View>
              </Pressable>
            </View>
          )}

          <FieldLabel required>Amount</FieldLabel>
          <TextField value={form.amount} onChangeText={(v) => set("amount", v.replace(/[^0-9.]/g, ""))} placeholder="0.00" keyboardType="numeric" />

          <FieldLabel required>Payment Purpose</FieldLabel>
          <TextField value={form.paymentName} onChangeText={(v) => set("paymentName", v)} placeholder="e.g. Cement advance to ABC Traders" />

          {isReissue && (
            <>
              <FieldLabel>Bank Bounce Charge (optional)</FieldLabel>
              <TextField value={bounceCharge} onChangeText={(v) => setBounceCharge(v.replace(/[^0-9.]/g, ""))} placeholder="Added on top of the original amount" keyboardType="numeric" />
            </>
          )}

          <FieldLabel required>Payment Mode</FieldLabel>
          <View className="flex-row flex-wrap gap-2 mb-4">
            {PAYMENT_MODES.filter((m) => !isReissue || m !== "Cash").map((m) => (
              <Pressable
                key={m}
                onPress={() => set("mode", m === form.mode ? "" : m)}
                style={{ opacity: form.mode && form.mode !== m ? 0.5 : 1 }}
              >
                <ModeBadge mode={m} />
              </Pressable>
            ))}
          </View>

          {!!form.paidTo && (
            <View className="rounded-xl p-3 mb-3" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>Paid To</Text>
              <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{form.paidTo}</Text>
            </View>
          )}

          {needsBank && (
            <PickerRow label="Bank Account" value={form.bankName} onPress={() => setPicker("bank")} />
          )}

          {isChequeMode && form.bankId && (
            <View className="mb-2">
              {lotsLoading ? (
                <View className="flex-row items-center gap-2 mb-3"><ActivityIndicator size="small" color={colors.mutedForeground} /><Text style={{ color: colors.mutedForeground, fontSize: 11.5 }}>Loading cheque lots…</Text></View>
              ) : chequeLots.length === 0 ? (
                <View className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl mb-3" style={{ backgroundColor: "#d9770615", borderWidth: 1, borderColor: "#d9770630" }}>
                  <AlertTriangle size={12} color="#d97706" />
                  <Text style={{ color: "#d97706", fontSize: 11.5, fontFamily: fonts.body.medium }}>No active cheque lots for this bank.</Text>
                </View>
              ) : (
                <PickerRow label="Cheque Lot" value={activeLot ? `${activeLot.ChequeLotNumber}${activeLot.RemainingCheques != null ? ` (${activeLot.RemainingCheques} left)` : ""}` : ""} onPress={() => chequeLots.length > 1 && setPicker("chequeLot")} disabled={chequeLots.length <= 1} />
              )}

              {form.chequeLotId && (
                <>
                  <PickerRow
                    label="Cheque Number"
                    value={form.chequeNo ? `# ${form.chequeNo}` : ""}
                    placeholder={chequeValidating ? "Reserving…" : numbersLoading ? "Loading…" : "Select a cheque number"}
                    onPress={() => setPicker("chequeNo")}
                    disabled={numbersLoading || chequeValidating}
                  />
                  {availableCheques.length === 0 && !numbersLoading && (
                    <Text style={{ color: "#d97706", fontSize: 10.5, marginTop: -6, marginBottom: 10 }}>No available cheques left in this lot.</Text>
                  )}
                  <FieldLabel required={form.mode === "Post-Dated Cheque"}>
                    {form.mode === "Post-Dated Cheque" ? "Post-Dated Cheque Date" : "Cheque Date"}
                  </FieldLabel>
                  <TextField value={form.chequeDate} onChangeText={(v) => { set("chequeDate", v); set("isPostDated", form.mode === "Post-Dated Cheque"); }} placeholder="YYYY-MM-DD" />
                </>
              )}
            </View>
          )}

          {isDigitalMode && DIGITAL_FIELD[form.mode] && (
            <>
              <FieldLabel required>{DIGITAL_FIELD[form.mode].label}</FieldLabel>
              <TextField
                value={form[DIGITAL_FIELD[form.mode].key] as string}
                onChangeText={(v) => set(DIGITAL_FIELD[form.mode].key, v)}
                placeholder={DIGITAL_FIELD[form.mode].placeholder}
              />
            </>
          )}

          {form.mode === "Card" && form.bankId && cards.length > 0 && (
            <PickerRow label="Card Used (optional)" value={selectedCard ? [selectedCard.card_network, maskCardNumber(selectedCard.card_number), selectedCard.card_holder_name].filter(Boolean).join(" · ") : ""} onPress={() => setPicker("card")} />
          )}
        </ScrollView>

        <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Pressable onPress={onClose} className="px-5 py-3 rounded-xl items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
          </Pressable>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            className="flex-1 items-center justify-center py-3 rounded-xl"
            style={{ backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{isEditing ? "Update Payment" : "Save Payment"}</Text>
            )}
          </Pressable>
        </View>
      </View>

      <OptionPickerModal
        visible={picker === "company"} title="Select Company" options={companyOptions}
        selectedKey={form.company} onSelect={(k) => { set("company", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable
      />
      <OptionPickerModal
        visible={picker === "project"} title="Select Project" options={projectOptions}
        selectedKey={form.project} onSelect={(k) => { set("project", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable
      />
      <OptionPickerModal
        visible={picker === "bank"} title="Select Bank Account" options={bankOptions}
        selectedKey={form.bankId ? String(form.bankId) : null} onSelect={onBankSelect} onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "chequeLot"} title="Select Cheque Lot" options={lotOptions}
        selectedKey={form.chequeLotId ? String(form.chequeLotId) : null} onSelect={onLotSelect} onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === "chequeNo"} title="Select Cheque Number" options={chequeNoOptions}
        selectedKey={form.chequeNo} onSelect={onChequeNumberSelect} onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "card"} title="Select Card" options={cardOptions}
        selectedKey={form.cardId ? String(form.cardId) : null}
        onSelect={(k) => { set("cardId", k ? Number(k) : null); setPicker(null); }} onClose={() => setPicker(null)} clearable
      />
      <OptionPickerModal
        visible={picker === "invoice"} title="Link to Invoice" options={invoiceOptions}
        selectedKey={form.expenseId} onSelect={onInvoiceSelect} onClose={() => setPicker(null)} searchable clearable loading={invoicesLoading}
      />
      <OptionPickerModal
        visible={picker === "contract"} title="Link to Contract" options={contractOptions}
        selectedKey={form.contractId} onSelect={onContractSelect} onClose={() => setPicker(null)} searchable clearable loading={contractsLoading}
      />
    </Modal>
  );
}
