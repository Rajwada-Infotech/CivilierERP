// RN port of Payment.tsx's add-payment form (view="form"), on the drawing sheet (SheetShell, ruled panels, ink keys for
// the modes, a fixed Cancel / Save bar) — covers the
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
import { istToday } from "@/utils/istTime";
import { useEffect, useMemo, useState } from "react";
import { View, Text, Modal, ScrollView, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Wallet, Link2 } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Field, Input, Key, Label, Notice, Panel, Press, Seg, SheetMark, SheetShell, StatGrid } from "@/components/sheet/Sheet";
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
import { getPayableJVLines, type PayableJVLine } from "@/api/journalVoucherApi";
import { fetchInvoiceById, fetchGrnGstBreakdown, computeBreakdown, type GrnGstBreakdown } from "@/api/invoiceApi";
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
  jvLineId: number | null;
};

function blankForm(): FormState {
  return {
    paymentName: "", mode: "", amount: "", date: istToday(),
    company: "", project: "", bankId: null, bankName: "",
    expenseId: "", expenseRef: "", parentDocNo: "", paidTo: "", partyId: null,
    chequeNo: "", chequeLotId: null, chequeLotNumber: "", chequeAccountNumber: "", chequeIfsc: "",
    chequeDate: "", isPostDated: false,
    neftNumber: "", upiTransactionId: "", rtgsReference: "", impsReference: "", cardReference: "", cardId: null,
    contractId: "",
    jvLineId: null,
  };
}

const DIGITAL_FIELD: Record<string, { key: keyof FormState; label: string; placeholder: string }> = {
  NEFT: { key: "neftNumber", label: "NEFT UTR Number", placeholder: "e.g. HDFC0000012345" },
  UPI: { key: "upiTransactionId", label: "UPI Transaction ID", placeholder: "e.g. 405987654321" },
  RTGS: { key: "rtgsReference", label: "RTGS UTR Reference", placeholder: "e.g. RTGS2026050600001" },
  IMPS: { key: "impsReference", label: "IMPS Reference Number", placeholder: "e.g. 412210987654" },
  Card: { key: "cardReference", label: "Card Transaction / Approval ID", placeholder: "e.g. AUTH123456" },
};

function validateForm(f: FormState): string | null {
  if (!f.paymentName.trim()) return "Payment purpose is required.";
  if (!f.mode) return "Please select a payment mode.";
  if (!f.date) return "Payment date is required.";
  if (!f.amount || Number(f.amount) <= 0) return "Amount must be greater than zero.";

  const isChequeMode = f.mode === "Cheque" || f.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(f.mode);

  if (f.mode === "Bank Charges" && !f.bankId) return "Select the bank account that charged it.";

  if (isChequeMode) {
    if (!f.bankId) return "Please select a bank account.";
    if (!f.chequeLotId) return "No active cheque lot found for the selected bank.";
    if (!f.chequeNo) return "Please select a cheque number from the lot.";
    if (f.mode === "Post-Dated Cheque") {
      if (!f.chequeDate) return "Post-dated cheque requires a cheque date.";
      const validUntil = new Date(f.chequeDate); // "YYYY-MM-DD" reads as UTC midnight, so use the UTC month calendar
      validUntil.setUTCMonth(validUntil.getUTCMonth() + 3);
      if (validUntil.toISOString().slice(0, 10) < istToday()) return "This post-dated cheque has expired. Please select a valid cheque date.";
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
  visible, onClose, editingRecord, reissueContext, asScreen,
}: {
  visible: boolean; onClose: () => void;
  /** Drawn as a page of the stack (PaymentFormScreen), under the app's header, instead of a modal over the list. */
  asScreen?: boolean;
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
  const [picker, setPicker] = useState<"company" | "project" | "bank" | "invoice" | "contract" | "jv" | "chequeLot" | "chequeNo" | "card" | null>(null);
  const [chequeValidating, setChequeValidating] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (editingRecord) {
      const r = editingRecord;
      setForm({
        paymentName: r.paymentName, mode: r.mode, amount: r.amount != null ? String(r.amount) : "",
        date: r.date || istToday(),
        company: r.company, project: r.projectSite, bankId: null, bankName: r.bankName,
        expenseId: r.expenseId, expenseRef: r.expenseRef, parentDocNo: r.parentDocNo,
        paidTo: r.paidTo, partyId: null,
        chequeNo: r.chequeNo, chequeLotId: null, chequeLotNumber: r.chequeLotNumber,
        chequeAccountNumber: "", chequeIfsc: "", chequeDate: r.chequeDate, isPostDated: r.mode === "Post-Dated Cheque",
        neftNumber: r.neftNumber, upiTransactionId: r.upiTransactionId, rtgsReference: r.rtgsReference,
        impsReference: r.impsReference, cardReference: r.cardReference, cardId: null,
        contractId: "",
        jvLineId: null,
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
    setSelectedJVLine(null);
    setTagTouched(false);
  }, [visible, editingRecord, reissueContext]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const isChequeMode = form.mode === "Cheque" || form.mode === "Post-Dated Cheque";
  const isDigitalMode = ["NEFT", "UPI", "RTGS", "IMPS", "Card"].includes(form.mode);
  // A bank account for every mode but cash; Bank Charges needs only the account (web shows it whenever the mode isn't Cash).
  const needsBank = isChequeMode || isDigitalMode || form.mode === "Bank Charges";

  const [selectedContract, setSelectedContract] = useState<ContractLinkOption | null>(null);
  // Settling a JV's unpaid liability leg (web: selectedJVLine). On an edit, the link only changes when it is changed here
  // (tagTouched → tagChange on save); otherwise the saved link is left as it is.
  const [selectedJVLine, setSelectedJVLine] = useState<PayableJVLine | null>(null);
  const [tagTouched, setTagTouched] = useState(false);
  const { data: jvLines = [], isLoading: jvLinesLoading } = useQuery({ queryKey: ["payment-payable-jv-lines"], queryFn: getPayableJVLines, enabled: visible, staleTime: 30_000 });

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
  const [useOnAccountBalance, setUseOnAccountBalance] = useState(false);

  useEffect(() => {
    setUseOnAccountBalance(false);
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
      setTagTouched(true);
      setForm((f) => ({ ...f, expenseId: "", expenseRef: "", parentDocNo: "", paidTo: "", partyId: null }));
      return;
    }
    const o = invoices.find((x) => x.id === key);
    if (!o) return;
    const suggestedAmount = o.remainingAmount != null && o.remainingAmount > 0 ? o.remainingAmount : o.amount;
    setSelectedContract(null);
    setSelectedJVLine(null);
    setTagTouched(true);
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
      jvLineId: null,
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
    setSelectedJVLine(null);
    setTagTouched(true);
    setForm((f) => ({
      ...f,
      paymentName: `Payment to ${c.ContactPerson || "Contractor"} for ${c.Reason || c.NatureOfContract || "contract work"}`,
      expenseRef: c.DocNo || "",
      expenseId: "",
      parentDocNo: "",
      contractId: String(c.ContractId),
      jvLineId: null,
      company: companyLabel,
      project: projectLabel,
      partyId: c.ContactPartyId ?? f.partyId,
      paidTo: c.ContactPerson || f.paidTo,
      amount: c.PendingAmount != null ? String(Math.max(Number(c.PendingAmount), 0)) : c.ContractAmount != null ? String(c.ContractAmount) : f.amount,
    }));
  };

  const onJVLineSelect = (key: string) => {
    setPicker(null);
    if (!key) {
      clearJVLink();
      return;
    }
    const line = jvLines.find((l) => String(l.LineID) === key);
    if (!line) return;
    const companyOpt = companies.find((c) => c.id === line.CompanyId);
    const projectOpt = projects.find((p) => p.id === line.ProjectId);
    setSelectedContract(null);
    setSelectedJVLine(line);
    setTagTouched(true);
    setForm((f) => ({
      ...f,
      paymentName: `Payment against ${line.JVNo || `JV-${line.JVID}`} — ${line.LHeadName}`,
      expenseId: "",
      expenseRef: "",
      parentDocNo: "",
      contractId: "",
      jvLineId: line.LineID,
      company: companyOpt?.label || line.CompanyName || String(line.CompanyId ?? ""),
      project: projectOpt?.label || line.ProjectName || String(line.ProjectId ?? ""),
      partyId: line.LHeadId,
      paidTo: line.LHeadName,
      amount: String(Math.max(Number(line.RemainingAmount) || 0, 0)),
    }));
  };

  const clearJVLink = () => {
    setTagTouched(true);
    // Nothing picked here, only the saved link: just drop it.
    if (!selectedJVLine) {
      setForm((f) => ({ ...f, jvLineId: null }));
      return;
    }
    setSelectedJVLine(null);
    setForm((f) => ({ ...f, paymentName: "", jvLineId: null, company: "", project: "", partyId: null, paidTo: "", amount: "" }));
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
      JVLineId: form.jvLineId ?? null,
      tagChange: isEditing && tagTouched,
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
  const jvOptions: PickerOption[] = useMemo(() => jvLines.map((l) => ({
    key: String(l.LineID),
    label: `${l.JVNo || `JV-${l.JVID}`} · ${l.LHeadName}`,
    sublabel: [`Remaining ${formatINR(Math.max(Number(l.RemainingAmount) || 0, 0))}`, l.ProjectName || l.CompanyName].filter(Boolean).join(" · "),
  })), [jvLines]);
  const contractOptions: PickerOption[] = useMemo(() => contracts.map((c) => ({
    key: String(c.ContractId), label: c.DocNo || `Contract #${c.ContractId}`,
    sublabel: [c.ContactPerson, c.PendingAmount != null ? `Pending ${formatINR(Math.max(c.PendingAmount, 0))}` : null].filter(Boolean).join(" · "),
  })), [contracts]);

  // A saved JV link (edit, link not touched) or one picked here.
  const savedJv = isEditing && !tagTouched ? editingRecord?.jvNo || "" : "";
  const jvLinked = !!selectedJVLine || !!savedJv;

  /** A link to an invoice or a contract: a ruled key with the link mark, the chosen document or a hint. */
  const LinkKey = ({ label, value, hint, onPress, onClear }: { label: string; value: string | null; hint: string; onPress: () => void; onClear?: () => void }) => (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <Press
        onPress={onPress}
        style={(pressed) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: value ? S.ink : S.line40, backgroundColor: pressed || value ? S.blueWash : S.paper })}
      >
        <Link2 size={14} color={value ? S.ink : S.graphite} />
        <Text numberOfLines={1} style={{ flex: 1, color: value ? S.ink : S.faint, fontSize: 13.5, fontFamily: value ? fonts.body.semibold : fonts.body.regular }}>{value || hint}</Text>
        {!!value && onClear && <X size={14} color={S.ink} />}
      </Press>
    </View>
  );

  const content = (
    <>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: asScreen ? 0 : insets.top }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <SheetShell
            eyebrow="CivilierERP · Finance · Payment"
            title={isEditing ? "Edit payment" : isReissue ? "Re-issue payment" : "New payment"}
            subtitle="Record a payment, optionally against an invoice or a contract"
            action={<Key label={asScreen ? "Back" : "Close"} icon={<X size={13} color={S.ink} />} onPress={onClose} style={{ alignSelf: "flex-start" }} />}
          >
            {isReissue && (
              <Notice tone="ink">{`Re-issuing a bounced payment. Replaces ${reissueContext!.replacesDocNo}${reissueContext!.bounceReason ? ` · ${reissueContext!.bounceReason}` : ""}`}</Notice>
            )}

            <Panel title="Party & date">
              <View>
                <PickerRow label="Company" value={form.company} onPress={() => setPicker("company")} />
                <PickerRow label="Project" value={form.project} onPress={() => setPicker("project")} />
                <Field label="Payment Date" required>
                  <Input value={form.date} onChangeText={(v) => set("date", v)} placeholder="YYYY-MM-DD" />
                </Field>
              </View>
            </Panel>

            <Panel title="Link (optional)">
              {!selectedContract && !jvLinked && (
                <LinkKey label="Invoice" value={selectedInvoice ? selectedInvoice.label : null} hint="Autofills payee, company, project and amount" onPress={() => setPicker("invoice")} />
              )}
              {!selectedInvoice && !jvLinked && (
                <LinkKey
                  label="Contract"
                  value={selectedContract ? selectedContract.DocNo || `Contract #${selectedContract.ContractId}` : null}
                  hint="An advance or installment against an approved contract"
                  onPress={() => (selectedContract ? clearContractLink() : setPicker("contract"))}
                  onClear={clearContractLink}
                />
              )}
              {!selectedInvoice && !selectedContract && (
                <LinkKey
                  label="Journal voucher"
                  value={selectedJVLine ? `${selectedJVLine.JVNo || `JV-${selectedJVLine.JVID}`} · ${selectedJVLine.LHeadName}` : savedJv ? `${savedJv} (saved)` : null}
                  hint="Settle a JV's unpaid liability leg"
                  onPress={() => (jvLinked ? clearJVLink() : setPicker("jv"))}
                  onClear={clearJVLink}
                />
              )}
              {!!selectedJVLine && (
                <Body size={12} color={S.graphite}>
                  {`Remaining on this JV line: ${formatINR(Math.max(Number(selectedJVLine.RemainingAmount) || 0, 0))} of ${formatINR(Number(selectedJVLine.CreditAmount) || 0)}`}
                </Body>
              )}
              {grnBreakdownLoading && <Body size={12} color={S.graphite}>Fetching the GRN tax breakdown…</Body>}
            </Panel>

            {!!grnGstBreakdown && grnGstBreakdown.totals.totalInclGST > 0 && (
              <Panel title="Tax details (from GRN)">
                <StatGrid
                  size={15}
                  items={[
                    { label: "Taxable amount", value: formatINR(grnGstBreakdown.totals.totalBase) },
                    { label: "Total GST", value: formatINR(grnGstBreakdown.totals.totalGST) },
                    ...(grnGstBreakdown.totals.totalCGST > 0 ? [{ label: "CGST", value: formatINR(grnGstBreakdown.totals.totalCGST) }] : []),
                    ...(grnGstBreakdown.totals.totalSGST > 0 ? [{ label: "SGST", value: formatINR(grnGstBreakdown.totals.totalSGST) }] : []),
                  ]}
                />
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 10, borderTopWidth: 1.5, borderTopColor: S.ink }}>
                  <Label color={S.ink}>Net payable (incl. billing terms)</Label>
                  <Text style={{ color: S.ink, fontSize: 16, fontFamily: fonts.heading.semibold }}>{formatINR(Number(form.amount) || grnGstBreakdown.totals.totalInclGST)}</Text>
                </View>
              </Panel>
            )}

            {!!form.expenseRef && oaBalance > 0.01 && oaPreview && oaPreview.applyAmount > 0 && (
              <Panel title="On-account balance" icon={<Wallet size={14} color={S.ink} />}>
                <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <Body size={12} color={S.graphite}>Available for this supplier</Body>
                  <Text style={{ color: S.ink, fontSize: 18, letterSpacing: -0.3, fontFamily: fonts.heading.semibold }}>{formatINR(oaBalance)}</Text>
                </View>
                <Seg
                  options={[
                    { value: "use", label: "Use it for this payment" },
                    { value: "keep", label: "Keep it" },
                  ]}
                  value={useOnAccountBalance ? "use" : "keep"}
                  onChange={(v) => setUseOnAccountBalance(v === "use")}
                />
                {useOnAccountBalance ? (
                  <View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                      <Body size={12} color={S.ink2}>Adjusted from balance</Body>
                      <Text style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{formatINR(oaPreview.applyAmount)}</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 }}>
                      <Body size={12} color={S.ink2}>{oaPreview.isFullyCovered ? "Invoice status" : "Remaining outstanding"}</Body>
                      {oaPreview.isFullyCovered ? (
                        <SheetMark text="Fully settled" tone="done" />
                      ) : (
                        <Text style={{ color: S.ink, fontSize: 13, fontFamily: fonts.heading.semibold }}>{formatINR(oaPreview.invoiceRemainingAfter)}</Text>
                      )}
                    </View>
                  </View>
                ) : (
                  <Body size={12} color={S.graphite}>{`The balance stays untouched: ${formatINR(oaBalance)} kept on account.`}</Body>
                )}
              </Panel>
            )}

            <Panel title="Payment">
              <Field label="Amount" required>
                <Input value={form.amount} onChangeText={(v) => set("amount", v.replace(/[^0-9.]/g, ""))} placeholder="0.00" keyboardType="numeric" />
              </Field>
              <Field label="Payment Purpose" required>
                <Input value={form.paymentName} onChangeText={(v) => set("paymentName", v)} placeholder="e.g. Cement advance to ABC Traders" />
              </Field>
              {isReissue && (
                <Field label="Bank Bounce Charge (optional)">
                  <Input value={bounceCharge} onChangeText={(v) => setBounceCharge(v.replace(/[^0-9.]/g, ""))} placeholder="Added on top of the original amount" keyboardType="numeric" />
                </Field>
              )}

              <Field label="Payment Mode" required>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {PAYMENT_MODES.filter((m) => !isReissue || m !== "Cash").map((m) => {
                    const on = form.mode === m;
                    return (
                      <Press
                        key={m}
                        onPress={() => set("mode", on ? "" : m)}
                        style={(pressed) => ({ paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: S.ink, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
                      >
                        <Text style={{ color: on ? S.paper : S.ink, fontSize: 10, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold }}>{m}</Text>
                      </Press>
                    );
                  })}
                </View>
              </Field>

              {!!form.paidTo && (
                <View style={{ gap: 4 }}>
                  <Label>Paid To</Label>
                  <Body size={13.5} weight="medium">{form.paidTo}</Body>
                </View>
              )}

              {needsBank && <PickerRow label="Bank Account" value={form.bankName} onPress={() => setPicker("bank")} />}

              {isChequeMode && form.bankId && (
                <View>
                  {lotsLoading ? (
                    <Body size={12} color={S.graphite}>Loading cheque lots…</Body>
                  ) : chequeLots.length === 0 ? (
                    <Notice tone="ink">No active cheque lots for this bank.</Notice>
                  ) : (
                    <PickerRow
                      label="Cheque Lot"
                      value={activeLot ? `${activeLot.ChequeLotNumber}${activeLot.RemainingCheques != null ? ` (${activeLot.RemainingCheques} left)` : ""}` : ""}
                      onPress={() => chequeLots.length > 1 && setPicker("chequeLot")}
                      disabled={chequeLots.length <= 1}
                    />
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
                        <Body size={11.5} color={S.red} style={{ marginTop: -6, marginBottom: 10 }}>No available cheques left in this lot.</Body>
                      )}
                      <Field label={form.mode === "Post-Dated Cheque" ? "Post-Dated Cheque Date" : "Cheque Date"} required={form.mode === "Post-Dated Cheque"}>
                        <Input
                          value={form.chequeDate}
                          onChangeText={(v) => {
                            set("chequeDate", v);
                            set("isPostDated", form.mode === "Post-Dated Cheque");
                          }}
                          placeholder="YYYY-MM-DD"
                        />
                      </Field>
                    </>
                  )}
                </View>
              )}

              {isDigitalMode && DIGITAL_FIELD[form.mode] && (
                <Field label={DIGITAL_FIELD[form.mode].label} required>
                  <Input value={form[DIGITAL_FIELD[form.mode].key] as string} onChangeText={(v) => set(DIGITAL_FIELD[form.mode].key, v)} placeholder={DIGITAL_FIELD[form.mode].placeholder} />
                </Field>
              )}

              {form.mode === "Card" && form.bankId && cards.length > 0 && (
                <PickerRow
                  label="Card Used (optional)"
                  value={selectedCard ? [selectedCard.card_network, maskCardNumber(selectedCard.card_number), selectedCard.card_holder_name].filter(Boolean).join(" · ") : ""}
                  onPress={() => setPicker("card")}
                />
              )}
            </Panel>
          </SheetShell>
        </ScrollView>

        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 12, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1.5, borderTopColor: S.ink, backgroundColor: colors.background }}>
          <Key label="Cancel" onPress={onClose} />
          <Key tone="ink" label={saving ? "Saving…" : isEditing ? "Update payment" : "Save payment"} onPress={handleSave} disabled={saving} style={{ flex: 1 }} />
        </View>
      </View>

      <OptionPickerModal
        visible={picker === "company"} title="Select company" options={companyOptions}
        selectedKey={form.company} onSelect={(k) => { set("company", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable
      />
      <OptionPickerModal
        visible={picker === "project"} title="Select project" options={projectOptions}
        selectedKey={form.project} onSelect={(k) => { set("project", k); setPicker(null); }} onClose={() => setPicker(null)} searchable clearable
      />
      <OptionPickerModal
        visible={picker === "bank"} title="Select bank account" options={bankOptions}
        selectedKey={form.bankId ? String(form.bankId) : null} onSelect={onBankSelect} onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "chequeLot"} title="Select cheque lot" options={lotOptions}
        selectedKey={form.chequeLotId ? String(form.chequeLotId) : null} onSelect={onLotSelect} onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === "chequeNo"} title="Select cheque number" options={chequeNoOptions}
        selectedKey={form.chequeNo} onSelect={onChequeNumberSelect} onClose={() => setPicker(null)} searchable
      />
      <OptionPickerModal
        visible={picker === "card"} title="Select card" options={cardOptions}
        selectedKey={form.cardId ? String(form.cardId) : null}
        onSelect={(k) => { set("cardId", k ? Number(k) : null); setPicker(null); }} onClose={() => setPicker(null)} clearable
      />
      <OptionPickerModal
        visible={picker === "invoice"} title="Link to invoice" options={invoiceOptions}
        selectedKey={form.expenseId} onSelect={onInvoiceSelect} onClose={() => setPicker(null)} searchable clearable loading={invoicesLoading}
      />
      <OptionPickerModal
        visible={picker === "jv"} title="Settle a journal voucher" options={jvOptions}
        selectedKey={form.jvLineId ? String(form.jvLineId) : null} onSelect={onJVLineSelect} onClose={() => setPicker(null)} searchable clearable loading={jvLinesLoading}
      />
      <OptionPickerModal
        visible={picker === "contract"} title="Link to contract" options={contractOptions}
        selectedKey={form.contractId} onSelect={onContractSelect} onClose={() => setPicker(null)} searchable clearable loading={contractsLoading}
      />
    </>
  );

  return asScreen ? (
    <View style={{ flex: 1 }}>{content}</View>
  ) : (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      {content}
    </Modal>
  );
}
