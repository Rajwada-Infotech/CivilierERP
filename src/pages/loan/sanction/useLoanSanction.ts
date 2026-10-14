// Everything the Loan Sanction page holds: the loan list, the open loan, the
// create / edit forms, and the handlers that save them. The page and its
// section components all read from this one object.
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { FileText, Wallet, CalendarClock, History, Scale } from "lucide-react";
import { useTheme, isLightTheme } from "@/contexts/ThemeContext";
import { getCompanyOptions, getBanks, type CompanyOption, type BankRecord } from "@/api/bankMasterApi";
import { friendlyErrorMessage } from "@/lib/friendlyError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { getLoanSanctions, getLoanSchedule, createLoanSanction, updateLoanSanction, deleteLoanSanction, getCustomerOptions, getCompanyExposure, getLoanPayments, uploadLoanNoc, getLoanDocuments, uploadLoanDocument, closeLoan, type LoanSanction, type InterestCalcType, type CustomerOption, type LoanPayment } from "@/api/loanSanctionApi";
import { estimateEmi, EMPTY_FORM } from "./shared";

export function useLoanSanction() {
  const qc = useQueryClient();
  usePageRights("loan-sanction");
  const { theme } = useTheme();
  const isDark = !isLightTheme(theme);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(false);
  const [viewingLoan, setViewingLoan] = useState<LoanSanction | null>(null);
  const [tab, setTab] = useState<"overview" | "exposure" | "schedule" | "chain" | "posting">("overview");
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LoanSanction | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Editing the safe administrative fields on an already-sanctioned loan —
  // deliberately separate from the create form's state — everything here
  // is editable except the parties' identity (loan type, lender/borrower
  // company/bank/customer), which the backend also refuses to touch.
  const [editingDetails, setEditingDetails] = useState(false);
  const [editForm, setEditForm] = useState({
    loanDocNo: "",
    purpose: "",
    remarks: "",
    lenderBankAccountId: "",
    borrowerBankAccountId: "",
    loanDate: "",
    amount: "",
    hasInterest: false,
    interestType: "CI" as InterestCalcType,
    interestRate: "",
    tenureMonths: "",
    dueDate: "",
    lenderCompanyId: "",
    borrowerCompanyId: "",
    paymentMode: "",
    chequeLotId: "",
    chequeLotNumber: "",
    chequeNo: "",
    chequeDate: "",
    isPostDated: false,
    digitalRefNumber: "",
    demandDraftNo: "",
    demandDraftDate: "",
  });
  const [savingDetails, setSavingDetails] = useState(false);

  const [uploadingNoc, setUploadingNoc] = useState(false);

  // GL posting — mirrors GRN's Posting tab: fetch the live preview when the
  // tab opens, then auto-post it to the real ledger (dbo.GeneralLedgerEntry)
  // the moment it's not already posted, so the loan actually shows up in
  // Trial Balance instead of only ever being a client-side preview.
  const [loanPostingData, setLoanPostingData] = useState<any | null>(null);
  const [loanPostingLoading, setLoanPostingLoading] = useState(false);
  const [loanPosting, setLoanPosting] = useState(false);
  const [loanPostingError, setLoanPostingError] = useState<string | null>(null);
  const nocInputRef = useRef<HTMLInputElement>(null);

  // Loan document attachment (agreement / sanction letter etc.)
  const [pendingDocumentFile, setPendingDocumentFile] = useState<File | null>(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const documentInputRef = useRef<HTMLInputElement>(null);

  // Explicit loan closure — separate deliberate step from payment recording
  const [closingLoan, setClosingLoan] = useState(false);

  // null = "All companies" — the dashboard default. Picking one just narrows
  // the same list to loans where that company is lender or borrower.
  const [listCompanyId, setListCompanyId] = useState<number | null>(null);

  const { data: loans = [], isLoading } = useQuery({
    queryKey: ["loan-sanctions", listCompanyId],
    queryFn: () => getLoanSanctions(listCompanyId),
    staleTime: 30_000,
  });

  const { data: companies = [] } = useQuery({
    queryKey: ["company-options-loan"],
    queryFn: getCompanyOptions,
    staleTime: 5 * 60_000,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customer-options-loan"],
    queryFn: getCustomerOptions,
    staleTime: 5 * 60_000,
  });

  // Full bank records (with each bank's own company tag) — used to scope
  // the Inter-Company Lender/Borrower Bank A/C pickers to only that party's
  // own banks, instead of every bank in the system.
  const { data: bankRecords = [] } = useQuery({
    queryKey: ["bank-records-loan"],
    queryFn: getBanks,
    staleTime: 5 * 60_000,
  });
  const banksForCompany = (companyLabel: string) =>
    bankRecords.filter(
      (b: BankRecord) => b.BStatus && (b.BCompanyName || "").trim().toLowerCase() === companyLabel.trim().toLowerCase(),
    );

  const { data: schedule = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ["loan-schedule", viewingLoan?.LoanId],
    queryFn: () => getLoanSchedule(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
    staleTime: 30_000,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["loan-payments", viewingLoan?.LoanId],
    queryFn: () => getLoanPayments(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
    staleTime: 30_000,
  });

  const { data: loanDocuments = [] } = useQuery({
    queryKey: ["loan-documents", viewingLoan?.LoanId],
    queryFn: () => getLoanDocuments(viewingLoan!.LoanId),
    enabled: !!viewingLoan,
    staleTime: 30_000,
  });

  // Exposure tab — live lookup of what's already lent/owed by whichever
  // company is currently selected as Lender / Borrower (create mode) or was
  // sanctioned against (view mode).
  const exposureLenderCompanyId = viewingLoan
    ? viewingLoan.LenderCompanyId
    : form.loanType !== "Bank Loan"
      ? form.lenderCompanyId
      : null;
  const exposureBorrowerCompanyId = viewingLoan
    ? viewingLoan.BorrowerCompanyId
    : form.loanType !== "Customer Loan"
      ? form.borrowerCompanyId
      : null;

  const { data: lenderExposure, isLoading: lenderExposureLoading } = useQuery({
    queryKey: ["loan-company-exposure", exposureLenderCompanyId],
    queryFn: () => getCompanyExposure(Number(exposureLenderCompanyId)),
    enabled: !!exposureLenderCompanyId,
  });
  const { data: borrowerExposure, isLoading: borrowerExposureLoading } = useQuery({
    queryKey: ["loan-company-exposure", exposureBorrowerCompanyId],
    queryFn: () => getCompanyExposure(Number(exposureBorrowerCompanyId)),
    enabled: !!exposureBorrowerCompanyId,
  });

  // Deep-link support for the Reminder Bell ("/loan/sanction?view=<id>")
  const [deepLinkConsumed, setDeepLinkConsumed] = useState(false);
  useEffect(() => {
    // One-shot: only run once after loans load. Using window.location.search
    // directly meant the effect re-read a stale URL on every loans change and
    // never cleared the param, leaving ?view=X stuck in the address bar.
    if (deepLinkConsumed || !loans.length) return;
    const viewId = searchParams.get("view");
    if (viewId) {
      // Clear the param first so back/refresh can't retrigger it.
      setSearchParams((sp) => { sp.delete("view"); return sp; }, { replace: true });
      // Guard against ?view=0 — "0" is truthy but String(loanId) === "0" would
      // match a garbage id. Only search if it looks like a positive integer.
      if (parseInt(viewId, 10) > 0) {
        const match = loans.find((l) => String(l.LoanId) === viewId);
        if (match) openView(match);
      }
    }
    setDeepLinkConsumed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loans]);

  // Fetch live posting data when the Posting tab opens (mirrors GRN.tsx).
  useEffect(() => {
    if (tab !== "posting" || !viewingLoan?.LoanId) return;
    setLoanPostingLoading(true);
    setLoanPostingData(null);
    fetchWithAuth(`/api/loan-sanction/${viewingLoan.LoanId}/posting`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLoanPostingData(d ?? null))
      .catch(() => setLoanPostingData(null))
      .finally(() => setLoanPostingLoading(false));
  }, [tab, viewingLoan?.LoanId]);

  // No auto-post for ANY loan type — disbursement is always a deliberate
  // action now: Inter-Company from Finance > Payment's "Loan Disbursement"
  // picker (POST /:id/post-to-gl), Customer Loan from the same picker
  // (POST /:id/disburse backing a real NewPayment), Bank Loan from
  // Received Payment's "Disburse a Bank Loan" picker (POST /:id/disburse
  // backing a real ReceivedPayment). This used to auto-fire for Bank
  // Loan/Customer Loan the moment anyone opened this tab, silently posting
  // the loan-ledger side with no real bank-side record behind it — see
  // migration 401's writeup for the resulting data-integrity gap it fixed.

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const companyName = (id: string) =>
    companies.find((c: CompanyOption) => String(c.id) === id)?.label ?? "";
  const customerName = (id: string) =>
    customers.find((c: CustomerOption) => String(c.id) === id)?.label ?? "";

  const openCreate = () => {
    setViewingLoan(null);
    setForm(EMPTY_FORM);
    setTab("overview");
    setShowForm(true);
    setPendingDocumentFile(null);
  };

  const openView = (loan: LoanSanction) => {
    setViewingLoan(loan);
    setTab("overview");
    setShowForm(true);
    setEditingDetails(false);
  };

  const openEditDetails = async (loan: LoanSanction) => {
    setViewingLoan(loan);
    setTab("overview");
    setShowForm(true);
    setEditForm({
      loanDocNo: loan.LoanDocNo || "",
      purpose: loan.Purpose || "",
      remarks: loan.Remarks || "",
      lenderBankAccountId: loan.LenderBankAccountId ? String(loan.LenderBankAccountId) : "",
      borrowerBankAccountId: loan.BorrowerBankAccountId ? String(loan.BorrowerBankAccountId) : "",
      loanDate: loan.LoanDate ? loan.LoanDate.slice(0, 10) : "",
      amount: loan.Amount != null ? String(loan.Amount) : "",
      hasInterest: loan.HasInterest !== false,
      interestType: (loan.InterestType as InterestCalcType) || "CI",
      interestRate: loan.InterestRate != null ? String(loan.InterestRate) : "",
      tenureMonths: loan.TenureMonths != null ? String(loan.TenureMonths) : "",
      dueDate: "",
      lenderCompanyId: loan.LenderCompanyId ? String(loan.LenderCompanyId) : "",
      borrowerCompanyId: loan.BorrowerCompanyId ? String(loan.BorrowerCompanyId) : "",
      paymentMode: loan.PaymentMode || "",
      chequeLotId: loan.ChequeLotId ? String(loan.ChequeLotId) : "",
      chequeLotNumber: loan.ChequeLotNumber || "",
      chequeNo: loan.ChequeNo || "",
      chequeDate: loan.ChequeDate ? loan.ChequeDate.slice(0, 10) : "",
      isPostDated: !!loan.IsPostDated,
      digitalRefNumber: loan.DigitalRefNumber || "",
      demandDraftNo: loan.DemandDraftNo || "",
      demandDraftDate: loan.DemandDraftDate ? loan.DemandDraftDate.slice(0, 10) : "",
    });
    setEditingDetails(true);
    // No-breakdown loans (Inter-Company simple transfer) keep their due
    // date on the single EMI row rather than the loan itself — pull it in
    // for the edit form so it isn't blank.
    if (loan.LoanType === "Inter-Company" && loan.HasInterest === false) {
      try {
        const sched = await getLoanSchedule(loan.LoanId);
        if (sched.length === 1) {
          setEditForm((f) => ({ ...f, dueDate: sched[0].DueDate.slice(0, 10) }));
        }
      } catch {
        // non-fatal — the field just stays blank
      }
    }
  };

  const handleSaveDetails = async () => {
    if (!viewingLoan) return;
    setSavingDetails(true);
    try {
      const isInterCompany = viewingLoan.LoanType === "Inter-Company";
      await updateLoanSanction(viewingLoan.LoanId, {
        loanDocNo: editForm.loanDocNo || null,
        purpose: editForm.purpose || null,
        remarks: editForm.remarks || null,
        lenderBankAccountId: editForm.lenderBankAccountId || null,
        borrowerBankAccountId: editForm.borrowerBankAccountId || null,
        paymentMode: editForm.paymentMode || null,
        chequeLotId: editForm.chequeLotId || null,
        chequeLotNumber: editForm.chequeLotNumber || null,
        chequeNo: editForm.chequeNo || null,
        chequeDate: editForm.chequeDate || null,
        isPostDated: editForm.paymentMode === "Post-Dated Cheque",
        digitalRefNumber: editForm.digitalRefNumber || null,
        demandDraftNo: editForm.demandDraftNo || null,
        demandDraftDate: editForm.demandDraftDate || null,
        lenderCompanyId: editForm.lenderCompanyId || null,
        borrowerCompanyId: editForm.borrowerCompanyId || null,
        // The backend treats the mere presence of these as "re-run the
        // schedule", and refuses it on a closed loan, so a closed loan
        // only sends the administrative fields above.
        ...(viewingLoan.Status !== "Closed"
          ? {
              loanDate: editForm.loanDate,
              amount: editForm.amount,
              hasInterest: editForm.hasInterest,
              interestType: editForm.interestType,
              interestRate: editForm.hasInterest ? editForm.interestRate || null : null,
              tenureMonths: editForm.tenureMonths || null,
              dueDate: isInterCompany && !editForm.hasInterest ? editForm.dueDate || null : null,
            }
          : {}),
      });
      toast.success("Loan details updated");
      setEditingDetails(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["loan-sanctions"] }),
        qc.invalidateQueries({ queryKey: ["loan-schedule", viewingLoan.LoanId] }),
        qc.invalidateQueries({ queryKey: ["loan-payments", viewingLoan.LoanId] }),
      ]);
      const fresh = await getLoanSanctions(listCompanyId);
      const updated = fresh.find((l) => l.LoanId === viewingLoan.LoanId);
      if (updated) setViewingLoan(updated);
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Could not update loan details"));
    } finally {
      setSavingDetails(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setViewingLoan(null);
    setEditingDetails(false);
  };

  // Explicit loan closure — called only when the user deliberately clicks
  // "Close Loan". Backend validates all EMIs are paid and total paid >= schedule.
  const handleCloseLoan = async () => {
    if (!viewingLoan) return;
    setClosingLoan(true);
    try {
      const result = await closeLoan(viewingLoan.LoanId);
      toast.success(result.message || `Loan ${viewingLoan.LoanNo} has been closed.`);
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
      const fresh = await getLoanSanctions(listCompanyId);
      const updated = fresh.find((l) => l.LoanId === viewingLoan.LoanId);
      if (updated) setViewingLoan(updated);
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Could not close loan"));
    } finally {
      setClosingLoan(false);
    }
  };

  const handleSave = async () => {
    const isCustomerLoan = form.loanType === "Customer Loan";
    const isBankLoan = form.loanType === "Bank Loan";
    const isCustomerToCompany = isCustomerLoan && form.customerLoanDirection === "toCompany";
    const isExternalLenderLoan = isBankLoan || isCustomerToCompany;
    if (isBankLoan && !form.lenderBankName.trim()) return toast.error("Select or enter the lender bank");
    if (isCustomerToCompany && !form.lenderCustomerId) return toast.error("Select the lender customer");
    if (!isBankLoan && !isCustomerToCompany && !form.lenderCompanyId) return toast.error("Select the lender company");
    if (isCustomerLoan && !isCustomerToCompany && !form.borrowerCustomerId) return toast.error("Select the borrower customer");
    if ((!isCustomerLoan || isCustomerToCompany) && !form.borrowerCompanyId) return toast.error("Select the borrower company");
    if (!form.loanDate) return toast.error("Loan date is required");
    if (!form.amount || Number(form.amount) <= 0) return toast.error("Enter a valid amount");

    setSaving(true);
    try {
      const res = await createLoanSanction({
        loanType: form.loanType,
        loanDocNo: form.loanDocNo || null,
        lenderCompanyId: (isBankLoan || isCustomerToCompany) ? null : form.lenderCompanyId,
        lenderBankName: isBankLoan ? form.lenderBankName.trim() : null,
        lenderCustomerId: isCustomerToCompany ? form.lenderCustomerId : null,
        lenderCustomerSource: isCustomerToCompany ? form.lenderCustomerSource : null,
        lenderCustomerBankName: isCustomerToCompany ? form.lenderCustomerBankName.trim() || null : null,
        lenderBankAccountId: (isInterCompanyType || (isCustomerLoan && !isCustomerToCompany)) ? form.lenderBankAccountId || null : null,
        borrowerCompanyId: (isCustomerLoan && !isCustomerToCompany) ? null : form.borrowerCompanyId,
        borrowerCustomerId: (isCustomerLoan && !isCustomerToCompany) ? form.borrowerCustomerId : null,
        borrowerCustomerSource: (isCustomerLoan && !isCustomerToCompany) ? form.borrowerCustomerSource : null,
        borrowerBankAccountId: (isInterCompanyType || isExternalLenderLoan) ? form.borrowerBankAccountId || null : null,
        loanDate: form.loanDate,
        amount: form.amount,
        hasInterest: form.hasInterest,
        interestType: form.interestType,
        interestRate: form.hasInterest ? form.interestRate || null : null,
        tenureMonths: form.tenureMonths || null,
        dueDate: isInterCompanyType && !form.hasInterest ? form.dueDate || null : null,
        purpose: form.purpose || null,
        remarks: form.remarks || null,
        paymentMode: form.paymentMode || null,
        chequeLotId: form.chequeLotId || null,
        chequeLotNumber: form.chequeLotNumber || null,
        chequeNo: form.chequeNo || null,
        chequeDate: form.chequeDate || null,
        isPostDated: form.isPostDated,
        digitalRefNumber: form.digitalRefNumber || null,
        demandDraftNo: form.demandDraftNo || null,
        demandDraftDate: form.demandDraftDate || null,
      });
      toast.success(`Loan ${res.loanNo} sanctioned`);
      if (res.glError) {
        toast.error(res.glError);
      }
      if (pendingDocumentFile) {
        try {
          await uploadLoanDocument(res.loanId, pendingDocumentFile);
          toast.success("Document attached");
        } catch (docErr: any) {
          toast.error(`Loan sanctioned, but the document could not be attached: ${docErr.message}. Attach it from the loan's detail view.`);
        }
      }
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
      closeForm();
    } catch (e: any) {
      toast.error(e.message ?? "Could not sanction this loan");
    } finally {
      setSaving(false);
    }
  };

  const handleUploadNoc = async (file: File) => {
    if (!viewingLoan) return;
    setUploadingNoc(true);
    try {
      await uploadLoanNoc(viewingLoan.LoanId, file);
      toast.success("NOC uploaded — available in Records module");
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
      const fresh = await getLoanSanctions(listCompanyId);
      const updated = fresh.find((l) => l.LoanId === viewingLoan.LoanId);
      if (updated) setViewingLoan(updated);
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Could not upload NOC"));
    } finally {
      setUploadingNoc(false);
      if (nocInputRef.current) nocInputRef.current.value = "";
    }
  };

  const handleUploadDocument = async (file: File) => {
    if (!viewingLoan) return;
    setUploadingDocument(true);
    try {
      await uploadLoanDocument(viewingLoan.LoanId, file);
      toast.success("Document uploaded — available in Records module");
      await qc.invalidateQueries({ queryKey: ["loan-documents", viewingLoan.LoanId] });
    } catch (e: any) {
      toast.error(friendlyErrorMessage(e, "Could not upload document"));
    } finally {
      setUploadingDocument(false);
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLoanSanction(deleteTarget.LoanId);
      toast.success(`Loan ${deleteTarget.LoanNo} deleted`);
      setDeleteTarget(null);
      if (viewingLoan?.LoanId === deleteTarget.LoanId) closeForm();
      await qc.invalidateQueries({ queryKey: ["loan-sanctions"] });
    } catch (e) {
      toast.error(
        friendlyErrorMessage(e, "Couldn't delete this loan. Please try again."),
      );
    } finally {
      setDeleting(false);
    }
  };


  const readOnly = !!viewingLoan;
  const isInterCompanyType = (viewingLoan?.LoanType ?? form.loanType) === "Inter-Company";
  // Combined create+edit flag, same shape as isInterCompanyType — a
  // Customer Loan's lender bank account matters too (it's who actually
  // receives the repayment), just never the borrower's, since the borrower
  // is external and has no bank account of ours to tag.
  const isCustomerLoanType = (viewingLoan?.LoanType ?? form.loanType) === "Customer Loan";
  // Same view-aware pattern for Bank Loan — read-only display (the Parties
  // labels, GL posting help text) must reflect the loan actually being
  // VIEWED, not whatever form.loanType happens to still hold from the last
  // time the create form was open (it doesn't reset when opening a view).
  const isBankLoanType = (viewingLoan?.LoanType ?? form.loanType) === "Bank Loan";
  const isCustomerLoan = form.loanType === "Customer Loan";
  const isBankLoan = form.loanType === "Bank Loan";
  // Customer Loan's "Customer to Company" direction (migration 402) — a
  // customer as LENDER instead of borrower, same shape as Bank Loan. View
  // mode infers direction from the loaded loan's own LenderCustomerId
  // (can't rely on form.customerLoanDirection there — it doesn't reset for
  // a loaded view the way viewingLoan's own fields do), same pattern
  // isBankLoanType already uses for viewingLoan?.LoanType.
  const isCustomerToCompany = isCustomerLoan && form.customerLoanDirection === "toCompany";
  const isCustomerToCompanyType = isCustomerLoanType && !!(viewingLoan ? viewingLoan.LenderCustomerId : isCustomerToCompany);
  // Bank Loan and Customer-to-Company are the same shape end to end — an
  // external lender, us as borrower, money coming in — so every place that
  // branches on isBankLoan for payment mode / cheque handling / GL posting
  // help text also needs Customer-to-Company. One combined flag instead of
  // repeating "isBankLoan || isCustomerToCompany" everywhere.
  const isExternalLenderLoan = isBankLoan || isCustomerToCompany;

  const displayLender = readOnly
    ? viewingLoan?.LenderCompanyName ?? viewingLoan?.LenderBankName ?? viewingLoan?.LenderCustomerName ?? ""
    : isBankLoan
      ? form.lenderBankName
      : isCustomerToCompany
        ? customerName(form.lenderCustomerId)
        : companyName(form.lenderCompanyId);
  const displayBorrower = readOnly
    ? viewingLoan?.BorrowerCompanyName ?? viewingLoan?.BorrowerCustomerName ?? ""
    : isCustomerLoan && !isCustomerToCompany
      ? customerName(form.borrowerCustomerId)
      : companyName(form.borrowerCompanyId);
  const displayAmount = readOnly ? viewingLoan?.Amount ?? null : Number(form.amount) || null;
  const displayHasInterest = readOnly ? viewingLoan?.HasInterest !== false : form.hasInterest;
  const displayInterestType = readOnly ? viewingLoan?.InterestType ?? "CI" : form.interestType;
  const estimatedEmi = estimateEmi(
    Number(form.amount) || 0,
    form.hasInterest ? Number(form.interestRate) || 0 : 0,
    Number(form.tenureMonths) || 1,
    form.interestType,
  );
  const estimatedTotalRepayable = estimatedEmi * (Number(form.tenureMonths) || 1);
  const estimatedTotalInterest = Math.max(0, estimatedTotalRepayable - (Number(form.amount) || 0));

  const chequeByPaymentId = new Map(
    payments
      .filter((p: any) => p.ChequeNo)
      .map((p: any) => [p.PaymentId, { chequeNo: p.ChequeNo, chequeDate: p.ChequeDate }]),
  );
  const totalEmis = schedule.length;
  const paidEmis = schedule.filter((e) => e.IsPaid).length;
  // BUG 8 FIX: paidAmount from actual LoanPayment records (authoritative) when
  // they exist. Falls back to summing IsPaid EMI rows for loans whose repayments
  // pre-date the LoanPayment table — those old rows won't appear in payments[]
  // at all, so we must use the EMI schedule to avoid wrongly showing ₹0 paid.
  // A loan with no EMI schedule at all (a simple Inter-Company transfer,
  // no interest/tenure) has schedule.length === 0, so summing it gives 0 —
  // which made outstandingAmount always compute to 0 regardless of whether
  // anything was actually paid, since Math.max(0, 0 - paid) is 0 either
  // way. Falls back to the loan's own Amount as the target when there's no
  // schedule to sum against.
  const totalScheduledAmount = schedule.length > 0
    ? schedule.reduce((s, e) => s + Number(e.EMIAmount), 0)
    : Number(displayAmount ?? 0);
  const paidAmount = payments.length > 0
    ? payments.reduce((s, p) => s + Number(p.PrincipalInterestAmount), 0)
    : schedule.filter((e) => e.IsPaid).reduce((s, e) => s + Number(e.EMIAmount), 0);
  const outstandingAmount = Math.max(0, Math.round((totalScheduledAmount - paidAmount) * 100) / 100);
  const nextDue = schedule.find((e) => !e.IsPaid) ?? null;

  const tabs: { id: typeof tab; label: string; icon: typeof FileText }[] = [
    { id: "overview", label: "Overview", icon: FileText },
    { id: "exposure", label: "Exposure", icon: Scale },
    { id: "schedule", label: "EMI Schedule", icon: CalendarClock },
    { id: "chain", label: "Repayment History", icon: History },
    { id: "posting", label: "Posting", icon: Wallet },
  ];

  return {
    qc,
    theme,
    isDark,
    searchParams,
    setSearchParams,
    showForm,
    setShowForm,
    viewingLoan,
    setViewingLoan,
    tab,
    setTab,
    form,
    setForm,
    saving,
    setSaving,
    deleteTarget,
    setDeleteTarget,
    deleting,
    setDeleting,
    editingDetails,
    setEditingDetails,
    editForm,
    setEditForm,
    savingDetails,
    setSavingDetails,
    uploadingNoc,
    setUploadingNoc,
    loanPostingData,
    setLoanPostingData,
    loanPostingLoading,
    setLoanPostingLoading,
    loanPosting,
    setLoanPosting,
    loanPostingError,
    setLoanPostingError,
    nocInputRef,
    pendingDocumentFile,
    setPendingDocumentFile,
    uploadingDocument,
    setUploadingDocument,
    documentInputRef,
    closingLoan,
    setClosingLoan,
    listCompanyId,
    setListCompanyId,
    loans,
    isLoading,
    companies,
    customers,
    bankRecords,
    banksForCompany,
    schedule,
    scheduleLoading,
    payments,
    loanDocuments,
    exposureLenderCompanyId,
    exposureBorrowerCompanyId,
    lenderExposure,
    lenderExposureLoading,
    borrowerExposure,
    borrowerExposureLoading,
    deepLinkConsumed,
    setDeepLinkConsumed,
    set,
    companyName,
    customerName,
    openCreate,
    openView,
    openEditDetails,
    handleSaveDetails,
    closeForm,
    handleCloseLoan,
    handleSave,
    handleUploadNoc,
    handleUploadDocument,
    handleDelete,
    readOnly,
    isInterCompanyType,
    isCustomerLoanType,
    isBankLoanType,
    isCustomerLoan,
    isBankLoan,
    isCustomerToCompany,
    isCustomerToCompanyType,
    isExternalLenderLoan,
    displayLender,
    displayBorrower,
    displayAmount,
    displayHasInterest,
    displayInterestType,
    estimatedEmi,
    estimatedTotalRepayable,
    estimatedTotalInterest,
    chequeByPaymentId,
    totalEmis,
    paidEmis,
    totalScheduledAmount,
    paidAmount,
    outstandingAmount,
    nextDue,
    tabs,
  };
}

export type LoanSanctionState = ReturnType<typeof useLoanSanction>;
