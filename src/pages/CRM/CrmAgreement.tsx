import { useSheetAsk } from "@/components/sheet/SheetAsk";
import { CrmStatus } from "@/constants/crmStatuses";
import { fmtIstIso } from "@/lib/istTime";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { SheetShell, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { KEY_INK, KEY_LINE, KEY_RED, LBL, RULE, RULE_SOFT } from "./customers/config";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ApplicantNames } from "@/components/crm/ApplicantNames";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, Upload, Send, Clock, UserCircle2, Pencil, Lock, Check, ArrowRight, ShieldAlert, Building2, ScrollText, X, FolderClock, CheckCircle2, AlertCircle, Info, CalendarDays, BarChart3, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";
import { promptNextStep } from "@/lib/workflowNav";
import { FinancialStatusBar, fmtRupees } from "@/components/crm/FinancialStatusBar";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { CrmCompanyProjectBlockFilter, type CrmCompanyProjectBlockValue } from "@/components/crm/CrmCompanyProjectBlockFilter";
import { CrmPaginationBar } from "@/components/crm/CrmPaginationBar";
import CrmAfsQueryPayment from "@/pages/CRM/CrmAfsQueryPayment";
import CrmAfsRegistry from "@/pages/CRM/CrmAfsRegistry";
import { AutoInput, DateInput } from "@/components/ui/date-input";
import { SearchableNativeSelect } from "@/components/SearchableNativeSelect";
import { useSearchAsYouType } from "@/hooks/useSearchAsYouType";
import { API, DOC_TYPES, agrStatusColor, isBookingCancelled, unverifiedMandatoryDocs, followupProgress, AGR_TABS, AgrTab, TAB_SLUGS, SLUG_FOR_TAB, agreementStepStates } from "./agreement/config";
import { AgreementStepper, docStatusColor, AgreementTimeline } from "./agreement/Timeline";
import { EMPTY_AGR_FORM, fetchUsers, EMPTY_DOC_FORM, EMPTY_DOC_REQUEST_FORM, mimeIcon, fmtBytes } from "./agreement/forms";
import { DocumentReviewCard } from "./agreement/DocumentReviewCard";
import { PAGE_SIZE, AgreementListFilters, fetchAgreementsList, fetchAgreementDetail, fetchAgreementIdByBooking, fetchDateHistory, fetchRevisions, fetchBookings, fetchWelcomeCallsForBooking } from "./agreement/api";

// Registered is done; Executed is settled for now; Cancelled has stopped; Draft is in hand.
const agrTone = (s: string): "done" | "waiting" | "stopped" => (s === "Registered" || s === "Executed" ? "done" : statusTone(s));

const CrmAgreement: React.FC = () => {
  const ask = useSheetAsk();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const rawIdFilter = sp.get("id") ? parseInt(sp.get("id")!, 10) : null;
  const idFilter = rawIdFilter !== null && rawIdFilter > 0 ? rawIdFilter : null;
  const [searchInput, setSearchInput] = useState("");
  // Searches as you type (after a short pause); Enter still searches at once.
  useSearchAsYouType(searchInput, (v) => updateFilter(setSearch)(v));
  const [search, setSearch] = useState("");
  const [cpb, setCpb] = useState<CrmCompanyProjectBlockValue>({ companyId: "", projectId: "", blockId: "" });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(idFilter);

  const selectAgreement = (id: number) => {
    setSelectedId(id);
    setSp((p) => { p.set("id", String(id)); return p; }, { replace: true });
  };

  const [agrDialog, setAgrDialog] = useState(false);
  const [docDialog, setDocDialog] = useState(false);
  const [docRequestDialog, setDocRequestDialog] = useState(false);
  const [sendDialog, setSendDialog] = useState(false);
  const [proposeDateDialog, setProposeDateDialog] = useState(false);
  const [sendDate, setSendDate] = useState("");
  const [regDialog, setRegDialog] = useState(false);
  const [regForm, setRegForm] = useState({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" });
  const [regFeesLocked, setRegFeesLocked] = useState(false);
  const [regSaving, setRegSaving] = useState(false);
  const [agrForm, setAgrForm] = useState({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
  const [docForm, setDocForm] = useState({ ...EMPTY_DOC_FORM });
  const [docRequestForm, setDocRequestForm] = useState({ ...EMPTY_DOC_REQUEST_FORM });
  const [showUrlField, setShowUrlField] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null);
  // A paper under review belongs to the agreement it was opened on.
  useEffect(() => { setPreviewDoc(null); }, [selectedId]);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [editDialog, setEditDialog] = useState(false);
  const [editForm, setEditForm] = useState({ LegalName: "", LegalAddress: "", PanNo: "", AadhaarNo: "", RevisionReason: "", LegalExecutiveId: "" });
  const [editLocked, setEditLocked] = useState(true);
  const editInputCls = `w-full text-sm border border-border rounded px-2 py-1.5 bg-background ${editLocked ? "opacity-70 cursor-not-allowed bg-muted/30" : ""}`;
  const [saving, setSaving] = useState(false);

  const urlTab = TAB_SLUGS[(sp.get("tab") || "").toLowerCase()];
  const [agrTab, setAgrTabRaw] = useState<AgrTab>(urlTab || "Timeline");
  const setAgrTab = (t: AgrTab) => {
    setAgrTabRaw(t);
    setSp((p) => { p.set("tab", SLUG_FOR_TAB[t]); return p; }, { replace: true });
  };
  useEffect(() => {
    setAgrTabRaw(TAB_SLUGS[(sp.get("tab") || "").toLowerCase()] || "Timeline");
    setEditingLegalExec(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function updateFilter<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }
  const listFilters: AgreementListFilters = useMemo(
    () => ({ search, companyId: cpb.companyId, projectId: cpb.projectId, blockId: cpb.blockId }),
    [search, cpb]
  );
  const { data: listResult, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["crm-agreements", listFilters, page],
    queryFn: () => fetchAgreementsList(listFilters, page),
    staleTime: 30_000,
  });
  const agreements = listResult?.rows ?? [];
  const total = listResult?.total ?? 0;

  const { data: detail } = useQuery({
    queryKey: ["crm-agreement-detail", selectedId],
    queryFn: () => fetchAgreementDetail(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
  });
  // Own keys: this list (eligible bookings) and the legal executives used to share "crm-bookings" and "sa-users" with
  // Bookings' and Welcome Calls' lists, so a visit there could fill the legal-executive pick with salespeople.
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-agreement-eligible-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ["crm-legal-executives"], queryFn: fetchUsers, staleTime: 5 * 60_000 });
  const { data: dateHistory = [] } = useQuery({
    queryKey: ["crm-agreement-date-history", selectedId],
    queryFn: () => fetchDateHistory(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
  });
  const { data: revisions = [] } = useQuery({
    queryKey: ["crm-agreement-revisions", selectedId],
    queryFn: () => fetchRevisions(selectedId!),
    enabled: selectedId != null,
    staleTime: 30_000,
  });
  const { data: welcomeCallsForBkg = [] } = useQuery({
    queryKey: ["crm-welcome-calls-for-bkg", (detail as any)?.BookingId],
    queryFn: () => fetchWelcomeCallsForBooking((detail as any).BookingId),
    enabled: selectedId != null && (detail as any)?.BookingId != null,
    staleTime: 60_000,
  });
  const preferredAgrDate = (() => {
    const hit = (welcomeCallsForBkg as any[]).find((c: any) => c.PreferredAgreementDate);
    return hit ? String(hit.PreferredAgreementDate).slice(0, 10) : "";
  })();

  const filtered = agreements;

  // Nothing opens by itself: the user picks an agreement, or arrives via an
  // ?id= / ?bookingId= link. (It used to open the first row on load.)

  // ?bookingId= deep-link resolver — same as before.
  const handledBkgFilterRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bkgFilter || idFilter) return;
    if (handledBkgFilterRef.current === bkgFilter) return;
    handledBkgFilterRef.current = bkgFilter;
    let cancelled = false;
    (async () => {
      const agId = await fetchAgreementIdByBooking(bkgFilter);
      if (cancelled) return;
      if (agId) {
        setSelectedId(agId);
      } else {
        setAgrForm((f) => ({ ...f, BookingId: bkgFilter }));
        setAgrDialog(true);
      }
    })();
    return () => { cancelled = true; };
  }, [bkgFilter, idFilter]);

  // Auto-fill from booking in the New Agreement dialog.
  useEffect(() => {
    if (!agrForm.BookingId || !agrDialog) return;
    const bkg = (bookings as any[]).find((b) => String(b.Id) === String(agrForm.BookingId));
    if (!bkg) return;
    setAgrForm((f) => ({
      ...f,
      LegalName:    f.LegalName    || bkg.LegalName    || "",
      PanNo:        f.PanNo        || bkg.PanNo        || "",
      AadhaarNo:    f.AadhaarNo    || bkg.AadhaarNo    || "",
      LegalAddress: f.LegalAddress || bkg.LegalAddress || "",
    }));
  }, [agrForm.BookingId, agrDialog]);

  const handleSaveAgreement = async () => {
    if (!agrForm.BookingId) { toast.error("Booking is required"); return; }
    if (agrForm.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(agrForm.PanNo.trim())) { toast.error("Invalid PAN format (e.g. ABCDE1234F)"); return; }
    if (agrForm.AadhaarNo && !/^\d{12}$/.test(agrForm.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...agrForm,
          BookingId: parseInt(agrForm.BookingId),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create agreement");
      toast.success(`Agreement ${data.AgreementNo} created`);
      setAgrDialog(false);
      if (data.id != null) selectAgreement(data.id);
      setAgrForm({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
      ["crm-agreements", "crm-agreement-eligible-bookings"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAddDocument = async () => {
    if (selectedId == null) return;
    if (!docForm.DocumentUrl.trim()) { toast.error("Enter a URL, or use the upload button to attach a file"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add document");
      toast.success("Document added");
      setDocDialog(false);
      setDocForm({ ...EMPTY_DOC_FORM });
      setShowUrlField(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleRequestDocument = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docRequestForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request document");
      toast.success("Document requested — the customer will see it in their portal");
      setDocRequestDialog(false);
      setDocRequestForm({ ...EMPTY_DOC_REQUEST_FORM });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleUploadDocFiles = async (files: FileList | null) => {
    if (selectedId == null || !files?.length) return;
    setUploadingDocs(true);
    try {
      const formData = new FormData();
      formData.append("DocumentType", docForm.DocumentType);
      if (docForm.IssuedBy) formData.append("IssuedBy", docForm.IssuedBy);
      if (docForm.Remarks) formData.append("Remarks", docForm.Remarks);
      Array.from(files).forEach((f) => formData.append("files", f));
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      toast.success(`${data.count} file(s) uploaded`);
      setDocDialog(false);
      setDocForm({ ...EMPTY_DOC_FORM });
      setShowUrlField(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setUploadingDocs(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  };

  const handleDocStatusChange = async (docId: number, status: string) => {
    if (selectedId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update document");
      toast.success(`Marked ${status}`);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleSendToCustomer = async (proposedDate: string) => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/send-to-customer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate: proposedDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agreement sent to customer portal");
      setSendDialog(false);
      setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleProposeDate = async (proposedDate: string) => {
    if (selectedId == null || !proposedDate) { toast.error("Pick a date"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/propose-date`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Proposed date sent to customer");
      setProposeDateDialog(false);
      setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptDate = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/date/accept`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Date accepted — sent for super admin approval");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const handleAgreementAction = async (action: "mark-executed" | "mark-registered" | "cancel") => {
    if (selectedId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/${action}`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Agreement marked ${data.status}`);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
      if (action === "mark-executed") {
        promptNextStep(navigate, "Agreement executed — Legal Milestones and NOC can now begin.", "/crm/legal-milestones", "Go to Legal Milestones");
      } else if (action === "mark-registered") {
        promptNextStep(navigate, "Agreement registered — you may now request NOC and begin the possession process.", "/crm/noc", "Go to NOC");
      }
    } catch (e: any) {
      toast.error(translateError(e.message));
    }
  };

  const handleMarkRegistered = async () => {
    if (selectedId == null) return;
    if (!regForm.AfsRegistrationNo.trim()) { toast.error("AFS Registration No. is required"); return; }
    if (!regForm.AfsRegistrationDate) { toast.error("AFS Registration Date is required"); return; }
    setRegSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/mark-registered`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          AfsRegistrationNo: regForm.AfsRegistrationNo.trim(),
          AfsRegistrationDate: regForm.AfsRegistrationDate,
          AfsStampDuty: regForm.AfsStampDuty !== "" ? regForm.AfsStampDuty : undefined,
          AfsRegistrationFee: regForm.AfsRegistrationFee !== "" ? regForm.AfsRegistrationFee : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agreement marked Registered");
      setRegDialog(false);
      setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
      promptNextStep(navigate, "Agreement registered — you may now request Bank / Organisation NOC.", "/crm/noc", "Go to NOC");
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setRegSaving(false);
    }
  };

  const [proxyApproveDialog, setProxyApproveDialog] = useState(false);
  const [proxyRecheckDialog, setProxyRecheckDialog] = useState(false);
  const [proxyDateDialog, setProxyDateDialog] = useState(false);
  const [proxyProposeDateDialog, setProxyProposeDateDialog] = useState(false);
  const [proxyProposedDate, setProxyProposedDate] = useState("");
  const [proxySaving, setProxySaving] = useState(false);

  const handleProxyCustomerApprove = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-customer-approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer approval recorded on their behalf");
      setProxyApproveDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyDateAccept = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-date-accept`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer date acceptance recorded on their behalf");
      setProxyDateDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyCustomerRecheck = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-customer-recheck`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer recheck request recorded on their behalf");
      setProxyRecheckDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const handleProxyProposeDate = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null || !proxyProposedDate) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-propose-date`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks, ProposedDate: proxyProposedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer's proposed date recorded on their behalf");
      setProxyProposeDateDialog(false);
      setProxyProposedDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setProxySaving(false);
    }
  };

  const [togglingPortal, setTogglingPortal] = useState(false);
  const handleTogglePortalAccess = async (deactivate: boolean) => {
    if (selectedId == null) return;
    setTogglingPortal(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/portal/${deactivate ? "deactivate" : "reactivate"}`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(deactivate ? "Portal access deactivated" : "Portal access reactivated");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setTogglingPortal(false);
    }
  };

  const openEdit = () => {
    if (!detail?.agreement) return;
    setEditForm({
      LegalName: detail.agreement.LegalName || detail.agreement.ApplicantName || "",
      LegalAddress: detail.agreement.LegalAddress || "",
      PanNo: detail.agreement.PanNo || detail.agreement.CustomerPanNo || "",
      AadhaarNo: detail.agreement.AadhaarNo || detail.agreement.CustomerAadhaarNo || "",
      RevisionReason: "",
      LegalExecutiveId: detail.agreement.LegalExecutiveId != null ? String(detail.agreement.LegalExecutiveId) : "",
    });
    setEditLocked(true);
    setEditDialog(true);
  };

  const [assigningLegal, setAssigningLegal] = useState(false);
  const [editingLegalExec, setEditingLegalExec] = useState(false);
  const handleAssignLegal = async (legalExecutiveId: string) => {
    if (selectedId == null) return;
    setAssigningLegal(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/assign-legal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ LegalExecutiveId: legalExecutiveId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(legalExecutiveId ? "Legal executive assigned" : "Legal executive unassigned");
      setEditingLegalExec(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setAssigningLegal(false);
    }
  };

  const handleSaveEdit = async () => {
    if (selectedId == null) return;
    if (editForm.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(editForm.PanNo.trim())) { toast.error("Invalid PAN format (e.g. ABCDE1234F)"); return; }
    if (editForm.AadhaarNo && !/^\d{12}$/.test(editForm.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.versionBumped ? "Details updated — prior version preserved in history" : "Details updated");
      setEditDialog(false);
      setEditLocked(true);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-revisions", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(translateError(e.message));
    } finally {
      setSaving(false);
    }
  };

  const rights = usePageRights("crm-agreements");
  const afsPayRights = usePageRights("crm-afs-query-payment");
  const afsRegRights = usePageRights("crm-afs-registry");
  const tabAllowed = (t: AgrTab): boolean =>
    t === "AFS Payment" ? afsPayRights.canView :
    t === "AFS Registry" ? afsRegRights.canView : true;

  const canWork = rights.canEdit;
  return (
    <>
      <Breadcrumbs items={["Dashboard", "CRM", "Agreements"]} />
      {ask.node}
      <SheetShell
        eyebrow="CivilierERP · CRM · Pre-sale"
        title="Agreements"
        subtitle="The agreement for sale: legal paperwork, senior and customer approval, the signing date, execution, then AFS payment and registry."
        action={
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button onClick={() => refetch()} disabled={isFetching} className={`${KEY_LINE} h-9 w-9`} title="Refresh"><RefreshCw size={13} className={isFetching ? "animate-spin" : ""} /></button>
            {/* The server creates under the create right; the button was offered to everyone. */}
            {rights.canCreate && <button onClick={() => setAgrDialog(true)} className={`${KEY_INK} h-9 px-4`}><Plus size={13} /> New agreement</button>}
          </div>
        }
      >
      <div className="flex flex-col md:flex-row gap-4 md:h-[calc(100vh-220px)]">
        {/* List */}
        <div className="w-full md:w-80 shrink-0 flex flex-col bg-card min-h-0" style={{ border: RULE }}>
          <div className="p-3 space-y-2" style={{ borderBottom: RULE }}>
            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") updateFilter(setSearch)(searchInput); }}
              placeholder="Search customer, agreement or booking…"
              className="h-9 w-full border border-foreground/40 focus:border-foreground bg-card px-3 text-xs text-foreground outline-none" />
            <CrmCompanyProjectBlockFilter stacked value={cpb} onChange={updateFilter(setCpb)} />
          </div>
          <div className="flex-1 overflow-y-auto thin-scroll max-h-[45vh] md:max-h-none">
            {isError ? (
              <p className="p-4 text-center text-sm text-destructive">{(error as Error)?.message}</p>
            ) : isLoading ? (
              <p className="p-4 text-center text-muted-foreground text-sm">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-center text-muted-foreground text-sm">{search || cpb.projectId ? "No agreement matches." : "No agreements yet."}</p>
            ) : (filtered as any[]).map((a: any) => (
              <button key={a.Id} onClick={() => selectAgreement(a.Id)}
                className={`w-full text-left px-3 py-2.5 transition-colors ${selectedId === a.Id ? "bg-foreground text-card" : "hover:bg-primary/5"}`}
                style={{ borderBottom: RULE_SOFT }}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold leading-tight truncate"><ApplicantNames name={a.ApplicantName} bookingId={a.BookingId} applicationId={a.ApplicationId} /></span>
                  <span className={selectedId === a.Id ? "[&_*]:!text-card" : ""}><SheetMark text={a.Status} tone={agrTone(a.Status)} /></span>
                </div>
                <div className={`mt-1 text-[0.6875rem] tabular-nums truncate ${selectedId === a.Id ? "opacity-80" : "text-muted-foreground"}`}>
                  {[a.AgreementNo, a.BookingNo, a.UnitNo].filter(Boolean).join(" · ")} · {a.DocumentCount || 0} doc{a.DocumentCount !== 1 ? "s" : ""}
                </div>
                <div className={`mt-0.5 text-[0.6875rem] truncate ${selectedId === a.Id ? "opacity-80" : ""}`}>
                  {isBookingCancelled(a) ? <span className="text-destructive font-semibold">Booking {a.BookingStatus || "inactive"}: locked</span>
                    : a.LegalExecutiveName ? <span>{a.LegalExecutiveName}</span> : <span className="font-semibold">No legal executive</span>}
                </div>
              </button>
            ))}
          </div>
          <div style={{ borderTop: RULE_SOFT }}><CrmPaginationBar page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} /></div>
        </div>

        {/* Detail */}
        <div className="flex-1 min-w-0 overflow-y-auto thin-scroll space-y-4">
          {selectedId == null ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Select an agreement to view details
            </div>
          ) : !detail ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
          ) : (
            <>
              {detail.agreement?.Status !== CrmStatus.CANCELLED && (
                <div className="bg-card p-4 space-y-3" style={{ border: RULE }}>
                  <AgreementStepper steps={agreementStepStates(detail.agreement, detail.documents)} activeTab={agrTab} onStepClick={setAgrTab} />
                  {(() => {
                    const a = detail.agreement;
                    const pendingDocs = unverifiedMandatoryDocs(detail.documents);
                    const cancelled = isBookingCancelled(a);
                    type BannerVariant = "error" | "warning" | "info" | "success" | "action";
                    let variant: BannerVariant = "info";
                    let text = "";
                    let subtext = "";
                    let cta: { label: string; onClick: () => void } | null = null;
                    if (cancelled) {
                      variant = "error";
                      text = `Booking is ${a?.BookingStatus || "inactive"} — this agreement is locked.`;
                      subtext = "Cancel the agreement to formally close it out.";
                    } else if (a?.Status === CrmStatus.REGISTERED) {
                      variant = "success";
                      text = "Agreement fully complete — Registered at Sub-Registrar.";
                    } else if (a?.Status === CrmStatus.EXECUTED) {
                      variant = "info";
                      text = "Agreement executed.";
                      subtext = "Record the Sub-Registrar Registration No. to mark it Registered.";
                    } else if (a?.LegalExecutiveId == null) {
                      variant = "warning";
                      text = "No Legal Executive assigned.";
                      subtext = "Assign someone responsible for preparing the paperwork — required before execution (server-enforced).";
                    } else if (a?.SeniorApprovalStatus !== CrmStatus.APPROVED) {
                      variant = "warning";
                      text = "Awaiting senior approval.";
                      subtext = "Submit via the Legal & Approval tab, then an admin approves from the Admin Approval Inbox.";
                    } else if (!a?.SentToCustomerAt) {
                      variant = "action";
                      text = "Senior-approved — ready to share with the customer.";
                      cta = { label: "Send to Customer Portal", onClick: () => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setSendDialog(true); } };
                    } else if (a?.CustomerApprovalStatus === "RecheckRequested") {
                      variant = "error";
                      text = "Customer requested a recheck.";
                      subtext = a?.LastRecheckRemarks ? `"${a.LastRecheckRemarks}"` : "Address the issue and resend.";
                      cta = { label: "Resend After Recheck", onClick: () => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : ""); setSendDialog(true); } };
                    } else if (a?.CustomerApprovalStatus !== CrmStatus.APPROVED) {
                      variant = "info";
                      text = "Sent to customer — awaiting their review and approval.";
                      subtext = a?.SentToCustomerAt ? `Sent ${String(a.SentToCustomerAt).slice(0, 10)}` : "";
                    } else if (!a?.AgreementDate) {
                      if (a?.DateApprovalStatus === CrmStatus.PENDING) {
                        variant = "warning";
                        text = "Date agreed by both sides — awaiting super admin confirmation.";
                      } else if (a?.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW) {
                        variant = "info";
                        text = `We proposed ${a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : "a date"} — waiting for customer's response.`;
                      } else if (a?.ProposedDateStatus === "PendingCompanyReview") {
                        variant = "action";
                        text = `Customer proposed ${a?.ProposedDate ? String(a.ProposedDate).slice(0, 10) : "a date"} — your turn to accept or counter.`;
                        cta = { label: "Accept Date", onClick: handleAcceptDate };
                      } else {
                        variant = "action";
                        text = "Customer approved — now propose an agreement signing date.";
                        cta = { label: "Propose Agreement Date", onClick: () => { setSendDate(preferredAgrDate); setProposeDateDialog(true); } };
                      }
                    } else if (pendingDocs.length) {
                      variant = "warning";
                      text = `${pendingDocs.length} mandatory document${pendingDocs.length > 1 ? "s" : ""} still need verification.`;
                      subtext = pendingDocs.map((d: any) => d.Label || d.DocumentType).join(", ");
                    } else {
                      variant = "action";
                      text = "All checks passed — ready to mark this agreement executed.";
                      cta = { label: "Mark Executed", onClick: () => handleAgreementAction("mark-executed") };
                    }
                    // One ruled note; red edge for trouble, ink edge for "your move". The action is offered only with the
                    // edit right (the server refuses otherwise; it used to be offered to anyone).
                    const edge = variant === "error" ? "hsl(var(--destructive))" : variant === "action" ? "hsl(var(--foreground))" : "hsl(var(--foreground) / 0.3)";
                    const icon = variant === "error" || variant === "warning" ? <AlertCircle size={15} className={`shrink-0 mt-0.5 ${variant === "error" ? "text-destructive" : ""}`} />
                      : variant === "success" ? <CheckCircle2 size={15} className="shrink-0 mt-0.5" /> : variant === "action" ? <ArrowRight size={15} className="shrink-0 mt-0.5" /> : <Info size={15} className="shrink-0 mt-0.5" />;
                    return (
                      <div className="flex items-start justify-between gap-3 flex-wrap px-4 py-3 bg-card" style={{ border: RULE_SOFT, borderLeft: `3px solid ${edge}` }}>
                        <div className="flex items-start gap-2.5">
                          {icon}
                          <div>
                            <p className={`text-sm font-semibold leading-snug ${variant === "error" ? "text-destructive" : "text-foreground"}`}>{text}</p>
                            {subtext && <p className="text-xs mt-0.5 text-muted-foreground">{subtext}</p>}
                          </div>
                        </div>
                        {cta && canWork && <button onClick={cta.onClick} className={`${KEY_INK} h-9 px-4 shrink-0`}>{cta.label}</button>}
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="bg-card" style={{ border: RULE }}>
                <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <span className={`block ${LBL}`}>Agreement</span>
                    <h2 className="font-heading font-bold text-lg text-foreground leading-tight truncate flex items-center gap-2">
                      <Building2 size={16} /> <ApplicantNames name={detail.agreement?.ApplicantName} bookingId={detail.agreement?.BookingId} applicationId={detail.agreement?.ApplicationId} />
                    </h2>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">
                      {detail.agreement?.AgreementNo}
                      {detail.agreement?.VersionNo > 1 && <span className="ml-1.5 font-semibold text-foreground">· version {detail.agreement.VersionNo}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <SheetMark text={detail.agreement?.Status || "—"} tone={agrTone(detail.agreement?.Status || "")} />
                    {detail.agreement && isBookingCancelled(detail.agreement) && (
                      <span title={`Booking ${detail.agreement.BookingStatus || "inactive"} — Edit/Send/Mark actions are locked. Cancel the agreement instead.`}
                        className="text-xs font-semibold text-destructive cursor-help">
                        ⚠ Booking {detail.agreement.BookingStatus || "Inactive"}
                      </span>
                    )}
                    {rights.canEdit && detail.agreement?.Status === CrmStatus.DRAFT && (
                      isBookingCancelled(detail.agreement) ? (
                        <span title="Booking is cancelled — cannot edit" className={`${KEY_LINE} h-8 px-2.5 !border-dashed opacity-40 cursor-not-allowed`}>
                          Edit Details
                        </span>
                      ) : (
                        <button onClick={openEdit}
                          className={`${KEY_LINE} h-8 px-2.5`}>
                          Edit Details
                        </button>
                      )
                    )}
                    {canWork && detail.agreement?.Status === CrmStatus.DRAFT && (() => {
                      const pendingDocs = unverifiedMandatoryDocs(detail.documents);
                      if (isBookingCancelled(detail.agreement)) {
                        return (
                          <span title="Booking is cancelled — cannot mark executed" className={`${KEY_LINE} h-8 px-2.5 !border-dashed opacity-40 cursor-not-allowed`}>
                            Mark Executed
                          </span>
                        );
                      }
                      const approvalsReady = detail.agreement?.SeniorApprovalStatus === CrmStatus.APPROVED
                        && detail.agreement?.CustomerApprovalStatus === CrmStatus.APPROVED
                        && detail.agreement?.AgreementDate;
                      if (!approvalsReady) {
                        return (
                          <span title="Requires senior approval, customer approval, and a mutually agreed date"
                            className={`${KEY_LINE} h-8 px-2.5 !border-dashed opacity-60 cursor-help`}>
                            Mark Executed (not ready)
                          </span>
                        );
                      }
                      if (detail.agreement?.LegalExecutiveId == null) {
                        return (
                          <span title="A Legal Executive must be assigned first — pick one from the Legal Executive field above"
                            className={`${KEY_LINE} h-8 px-2.5 !border-dashed opacity-60 cursor-help`}>
                            Mark Executed (legal exec. unassigned)
                          </span>
                        );
                      }
                      if (pendingDocs.length) {
                        return (
                          <span title={`Mandatory document(s) not yet verified: ${pendingDocs.map((d) => d.Label || d.DocumentType).join(", ")}`}
                            className={`${KEY_LINE} h-8 px-2.5 !border-dashed opacity-60 cursor-help`}>
                            Mark Executed (docs pending)
                          </span>
                        );
                      }
                      return (
                        <button onClick={() => handleAgreementAction("mark-executed")}
                          className={`${KEY_LINE} h-8 px-2.5`}>
                          Mark Executed
                        </button>
                      );
                    })()}
                    {canWork && detail.agreement?.Status === CrmStatus.EXECUTED && (
                      isBookingCancelled(detail.agreement) ? (
                        <span title="Booking is cancelled — cannot mark registered" className={`${KEY_LINE} h-8 px-2.5 !border-dashed opacity-40 cursor-not-allowed`}>
                          Mark Registered
                        </span>
                      ) : detail.agreement?.AfsRegistryStatus !== "Completed" ? (
                        <span title="AFS Registry (the Sub-Registrar Visit 1 tracker) must be marked Completed first" className={`${KEY_LINE} h-8 px-2.5 !border-dashed opacity-40 cursor-not-allowed`}>
                          Mark Registered
                        </span>
                      ) : (
                        <button onClick={() => {
                            const ag = detail.agreement;
                            const hasConfirmed = ag?.AfsQpConfirmedAmount != null;
                            let prefillStamp = "";
                            let prefillFee   = "";
                            if (hasConfirmed) {
                              if (ag.AfsQpStampDuty != null && ag.AfsQpRegistrationFee != null) {
                                prefillStamp = String(ag.AfsQpStampDuty);
                                prefillFee   = String(ag.AfsQpRegistrationFee);
                              } else {
                                prefillStamp = String(ag.AfsQpConfirmedAmount);
                              }
                            } else if (ag?.AfsQpStampDuty != null || ag?.AfsQpRegistrationFee != null) {
                              prefillStamp = ag.AfsQpStampDuty   != null ? String(ag.AfsQpStampDuty)        : "";
                              prefillFee   = ag.AfsQpRegistrationFee != null ? String(ag.AfsQpRegistrationFee) : "";
                            } else {
                              prefillStamp = ag?.AfsStampDuty      != null ? String(ag.AfsStampDuty)      : "";
                              prefillFee   = ag?.AfsRegistrationFee != null ? String(ag.AfsRegistrationFee) : "";
                            }
                            setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: prefillStamp, AfsRegistrationFee: prefillFee });
                            setRegFeesLocked(prefillStamp !== "" || prefillFee !== "");
                            setRegDialog(true);
                          }}
                          className={`${KEY_LINE} h-8 px-2.5`}>
                          Mark Registered
                        </button>
                      )
                    )}
                    {canWork && (detail.agreement?.Status === CrmStatus.DRAFT || detail.agreement?.Status === CrmStatus.EXECUTED) && (
                      <button onClick={async () => { if (await ask.confirm(`Cancel agreement ${detail.agreement?.AgreementNo}?`, { okLabel: "Cancel agreement", cancelLabel: "Keep it", danger: true })) handleAgreementAction("cancel"); }}
                        className={`${KEY_LINE} h-8 px-2.5 !text-destructive !border-destructive`}>
                        Cancel agreement
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-stretch overflow-x-auto thin-scroll bg-card" style={{ border: RULE }}>
                {AGR_TABS.filter(tabAllowed).map((t) => (
                  <button key={t} onClick={() => setAgrTab(t)}
                    className={`px-4 h-10 font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] whitespace-nowrap shrink-0 transition-colors ${
                      agrTab === t ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground hover:bg-primary/5"
                    }`} style={{ borderRight: RULE_SOFT }}>
                    {t}
                  </button>
                ))}
              </div>

              {agrTab === "Overview" && (
              <div className="border border-border overflow-hidden space-y-0">
                <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                  <div className="px-4 py-3">
                    <p className="text-[0.6875rem] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Booking</p>
                    <p className="text-sm font-semibold">{detail.agreement?.BookingNo}</p>
                    <p className="text-[0.6875rem] text-muted-foreground">{detail.agreement?.UnitNo}</p>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-[0.6875rem] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Project</p>
                    <p className="text-sm font-semibold truncate">{detail.agreement?.ProjectName || "—"}</p>
                  </div>
                  <div className={`px-4 py-3 ${detail.agreement?.AgreementDate ? "bg-foreground/5" : ""}`}>
                    <p className="text-[0.6875rem] text-muted-foreground uppercase tracking-wide font-medium mb-0.5">Agreement Date</p>
                    {detail.agreement?.AgreementDate ? (
                      <p className="text-sm font-bold text-foreground">{String(detail.agreement.AgreementDate).slice(0, 10)}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground/60 italic">Not set</p>
                    )}
                  </div>
                </div>

                <div className="px-4 py-3 space-y-2 border-b border-border">
                  <p className="text-[0.6875rem] text-muted-foreground uppercase tracking-wide font-medium">Legal Details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  {[
                    ["Legal Name",       detail.agreement?.LegalName || detail.agreement?.ApplicantName || "—"],
                    ["PAN (Permanent Account Number)",              detail.agreement?.PanNo || detail.agreement?.CustomerPanNo || "—"],
                    ["Aadhaar",          detail.agreement?.AadhaarNo || detail.agreement?.CustomerAadhaarNo || "—"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">{k}</span>
                      <span className="font-medium text-sm">{v}</span>
                    </div>
                  ))}
                  {detail.agreement?.LegalAddress && (
                    <div className="col-span-2">
                      <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Legal Address</span>
                      <span className="text-sm text-muted-foreground">{detail.agreement.LegalAddress}</span>
                    </div>
                  )}
                  <div className="col-span-2 pt-1 border-t border-border/60">
                    <span className={`block ${LBL}`}>{detail.agreement?.IsPlotSale ? "Total value (land, no GST)" : "Total value (incl. GST)"}</span>
                    <span className="block font-heading text-xl font-bold tabular-nums text-foreground mt-1">
                      {detail.agreement?.GrandTotal ? fmtRupees(detail.agreement.GrandTotal) : "—"}
                    </span>
                    {detail.agreement?.GrandTotal > 0 && (
                      <span className="text-[0.6875rem] text-muted-foreground block mt-0.5 tabular-nums">
                        {detail.agreement?.IsPlotSale ? "Land" : "Unit"} {fmtRupees(detail.agreement.TotalValue)}
                        {detail.agreement?.UnitGstAmount > 0 && ` + GST ${fmtRupees(detail.agreement.UnitGstAmount)}`}
                        {detail.agreement?.ParkingTotal > 0 && ` + Parking ${fmtRupees(detail.agreement.ParkingTotal)}`}
                        {detail.agreement?.ExtraChargesTotal > 0 && ` + Extra ${fmtRupees(detail.agreement.ExtraChargesTotal)}`}
                      </span>
                    )}
                  </div>
                </div>
                </div>

                {detail?.financialSummary && (() => {
                  const ag = detail.agreement;
                  const storedGrand = Number(ag?.GrandTotal ?? 0);
                  const grandTotal = storedGrand > 0 ? storedGrand : (Number(ag?.TotalValue || 0) + Number(ag?.UnitGstAmount || 0) + Number(ag?.ParkingTotal || 0) + Number(ag?.ExtraChargesTotal || 0));
                  return (
                  <div className="px-4 py-3 border-b border-border">
                  <FinancialStatusBar
                    grandTotal={grandTotal}
                    cleared={Number(detail.financialSummary.cleared || 0)}
                    pendingReceipts={Number(detail.financialSummary.mrOnAccount || 0)}
                    approvedOnAccount={Number(detail.financialSummary.approvedOnAccount || 0)}
                    compact
                  />
                  </div>
                  );
                })()}

                {detail.agreement?.Status === CrmStatus.REGISTERED && (
                  <div className="px-4 py-3 bg-foreground/5 border-b border-foreground/30 space-y-2">
                    <p className="text-[0.6875rem] font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <CheckCircle2 size={12} /> AFS Registration (Sub-Registrar)
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      <div>
                        <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Doc No.</span>
                        <span className="font-semibold font-heading tabular-nums">{detail.agreement.AfsRegistrationNo || "—"}</span>
                      </div>
                      <div>
                        <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Registration Date</span>
                        <span className="font-semibold">{detail.agreement.AfsRegistrationDate ? String(detail.agreement.AfsRegistrationDate).slice(0, 10) : "—"}</span>
                      </div>
                      {detail.agreement.AfsStampDuty != null && (
                        <div>
                          <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Stamp Duty Paid</span>
                          <span className="font-semibold font-heading tabular-nums">{Number(detail.agreement.AfsStampDuty).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                      {detail.agreement.AfsRegistrationFee != null && (
                        <div>
                          <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block">Registration Fee</span>
                          <span className="font-semibold font-heading tabular-nums">{Number(detail.agreement.AfsRegistrationFee).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 })}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {revisions.length > 0 && (
                  <div className="px-4 py-3 border-b border-border">
                    <p className="text-[0.6875rem] text-muted-foreground uppercase tracking-wide font-medium mb-2">Version History (prior to v{detail.agreement?.VersionNo})</p>
                    <div className="space-y-1.5 text-xs">
                      {(revisions as any[]).map((r) => (
                        <div key={r.Id} className="border border-border p-2.5 bg-muted/20">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="px-1.5 py-0.5 border border-foreground/30 bg-card text-foreground text-[0.625rem] font-medium">v{r.VersionNo}</span>
                            <span>{r.Reason}</span>
                            <span className="text-[0.625rem]">({fmtIstIso(r.CreatedAt)}{r.CreatedByName ? ` · ${r.CreatedByName}` : ""})</span>
                          </div>
                          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                            {r.LegalName && <div><span className="text-muted-foreground">Legal Name: </span>{r.LegalName}</div>}
                            {r.AgreementDate && <div><span className="text-muted-foreground">Agreement Date: </span>{String(r.AgreementDate).slice(0,10)}</div>}
                            {r.PanNo && <div><span className="text-muted-foreground">PAN: </span>{r.PanNo}</div>}
                            {r.AadhaarNo && <div><span className="text-muted-foreground">Aadhaar: </span>{r.AadhaarNo}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              )}

              {agrTab === "Legal & Approval" && (() => {
                const a = detail.agreement;
                const cancelled = isBookingCancelled(a);
                const legalAssigned = a?.LegalExecutiveId != null;
                const seniorStatus = a?.SeniorApprovalStatus;
                const seniorApproved = seniorStatus === CrmStatus.APPROVED;
                const seniorPending  = seniorStatus === CrmStatus.PENDING;
                const seniorRejected = seniorStatus === CrmStatus.REJECTED;
                const sent        = !!a?.SentToCustomerAt;
                const custStatus  = a?.CustomerApprovalStatus;
                const custApproved = custStatus === CrmStatus.APPROVED;
                const custRecheck  = custStatus === "RecheckRequested";
                const dated   = !!a?.AgreementDate;
                const executed = [CrmStatus.EXECUTED, CrmStatus.REGISTERED].includes(a?.Status);
                const stepsComplete = [seniorApproved, sent, custApproved, dated, executed].filter(Boolean).length;

                const circleCls = (s: "done"|"active"|"warn"|"upcoming") =>
                  s === "done"     ? "bg-foreground text-card ring-2" :
                  s === "active"   ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                  s === "warn"     ? "bg-destructive text-white ring-2 ring-red-200 dark:ring-red-900" :
                  "bg-muted text-muted-foreground";

                return (
                  <div className="space-y-4">
                    <div className="border border-border overflow-hidden">
                      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                        <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5">
                          <UserCircle2 size={15} className="text-foreground" /> Legal Executive
                        </h3>
                        {legalAssigned
                          ? <span className="text-[0.6875rem] text-foreground bg-card border border-foreground/30 px-2 py-0.5 font-semibold">Assigned</span>
                          : <span className="text-[0.6875rem] text-foreground bg-card border border-foreground/30 px-2 py-0.5 font-semibold">Unassigned</span>
                        }
                      </div>
                      <div className="px-4 py-3 space-y-2">
                        <p className="text-xs text-muted-foreground">The person responsible for preparing this agreement's paperwork. Required before execution (server-enforced).</p>
                        {a?.LegalExecutiveId != null && !editingLegalExec && !["Registered", "Cancelled"].includes(a?.Status) && !cancelled ? (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2 flex-1 bg-muted/40 border border-border px-3 py-1.5">
                              <UserCircle2 size={14} className="text-foreground shrink-0" />
                              <span className="text-sm font-medium">{a.LegalExecutiveName}</span>
                              <Lock size={11} className="text-muted-foreground ml-auto shrink-0" />
                            </div>
                            <button
                              onClick={() => setEditingLegalExec(true)}
                              className="text-xs px-2.5 py-1.5 border border-border text-muted-foreground hover:bg-muted shrink-0">
                              Change
                            </button>
                          </div>
                        ) : ["Registered", "Cancelled"].includes(a?.Status) || cancelled ? (
                          <div className="font-medium text-sm">{a?.LegalExecutiveName || <span className="text-foreground">Unassigned</span>}</div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <SearchableNativeSelect
                              value={a?.LegalExecutiveId != null ? String(a.LegalExecutiveId) : ""}
                              disabled={assigningLegal}
                              onChange={(e) => handleAssignLegal(e.target.value)}
                              className={`flex-1 text-sm border px-2 py-1.5 bg-background disabled:opacity-40 ${
                                a?.LegalExecutiveId != null ? "border-border" : "border-foreground/30 text-foreground"}`}>
                              <option value="">— Unassigned —</option>
                              {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                            </SearchableNativeSelect>
                            {editingLegalExec && (
                              <button
                                onClick={() => setEditingLegalExec(false)}
                                className="text-xs px-2.5 py-1.5 border border-border text-muted-foreground hover:bg-muted shrink-0">
                                Cancel
                              </button>
                            )}
                          </div>
                        )}
                        {a?.LegalExecutiveId == null && !["Registered", "Cancelled"].includes(a?.Status) && !cancelled && (
                          <p className="text-xs text-foreground bg-card border border-foreground/30 px-2 py-1.5">
                            Assign someone now so they receive an immediate notification and can start preparing the paperwork.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="border border-border overflow-hidden">
                      <div className="px-4 py-3 bg-muted/30 border-b border-border flex items-center justify-between">
                        <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5">
                          <ShieldAlert size={15} className="text-foreground" /> Approval Timeline
                        </h3>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            {[0,1,2,3,4].map((i) => (
                              <div key={i} className={`w-2 h-2 ${i < stepsComplete ? "bg-foreground" : "bg-muted"}`} />
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">{stepsComplete}/5</span>
                        </div>
                      </div>

                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${seniorApproved ? "bg-foreground/5" : seniorRejected ? "bg-destructive/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(seniorApproved ? "done" : seniorRejected ? "warn" : seniorPending ? "active" : "upcoming")}`}>
                          {seniorApproved ? <Check size={14} /> : seniorRejected ? <AlertCircle size={13} /> : 1}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Senior Review</span>
                            <span className={`text-[0.6875rem] px-2 py-0.5 border font-semibold ${
                              seniorApproved ? "text-foreground bg-card border-foreground/30"
                              : seniorRejected ? "text-destructive bg-destructive/5 border-destructive/40"
                              : "text-foreground bg-card border-foreground/30"
                            }`}>{seniorStatus || "Pending"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            An admin or super-admin approves this agreement before it's shared with the customer. Once submitted, review happens from the <strong>Admin Approval Inbox</strong>.
                          </p>
                          {seniorApproved && a?.SeniorApprovedAt && (
                            <p className="text-xs text-foreground flex items-center gap-1">
                              <CheckCircle2 size={11} /> Approved {String(a.SeniorApprovedAt).slice(0,10)}
                              {a?.SeniorApprovalRemarks && <span className="text-muted-foreground ml-1">· {a.SeniorApprovalRemarks}</span>}
                            </p>
                          )}
                          {seniorRejected && a?.SeniorApprovalRemarks && (
                            <div className="text-xs text-destructive bg-destructive/5 border border-destructive/40 px-2 py-1.5">
                              <strong>Rejection reason:</strong> {a.SeniorApprovalRemarks}
                            </div>
                          )}
                          {!cancelled && !seniorApproved && (
                            <div className="flex items-center gap-2 flex-wrap pt-0.5">
                              <ApprovalActions
                                status={a?.SeniorApprovalStatus}
                                recordId={a?.Id}
                                endpoint={API}
                                submitOnly
                                onSuccess={() => {
                                  qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                                  qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                                }}
                              />
                              {seniorPending && <span className="text-xs text-muted-foreground">Awaiting review in Admin Inbox</span>}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${sent ? "bg-foreground/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(sent ? "done" : seniorApproved ? "active" : "upcoming")}`}>
                          {sent ? <Check size={14} /> : 2}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Shared with Customer</span>
                            <span className={`text-[0.6875rem] px-2 py-0.5 border font-semibold ${
                              sent ? "text-foreground bg-card border-foreground/30" : "text-muted-foreground bg-muted/30 border-border"
                            }`}>{sent ? "Sent" : "Not sent"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            The customer can view this agreement in their portal and approve it or request a recheck.
                          </p>
                          {sent && a?.SentToCustomerAt && (
                            <p className="text-xs text-foreground flex items-center gap-1">
                              <Send size={11} /> Sent {fmtIstIso(a.SentToCustomerAt)}
                            </p>
                          )}
                          {seniorApproved && !sent && !cancelled && (
                            <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setSendDialog(true); }}
                              className={`${KEY_INK} h-8 px-3`}>
                              Send to Customer Portal
                            </button>
                          )}
                          {custRecheck && seniorApproved && !cancelled && (
                            <div className="space-y-1.5 pt-0.5">
                              <div className="text-xs text-destructive bg-destructive/5 border border-destructive/40 px-2 py-1.5">
                                <strong>Recheck requested ({a.RecheckCount}x):</strong> {a.LastRecheckRemarks || "No remark provided"}
                              </div>
                              <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setSendDialog(true); }}
                                className={`${KEY_INK} h-8 px-3`}>
                                Resend After Recheck
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${custApproved ? "bg-foreground/5" : custRecheck ? "bg-destructive/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(custApproved ? "done" : custRecheck ? "warn" : sent ? "active" : "upcoming")}`}>
                          {custApproved ? <Check size={14} /> : custRecheck ? <AlertCircle size={13} /> : 3}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Customer Approval</span>
                            <span className={`text-[0.6875rem] px-2 py-0.5 border font-semibold ${
                              custApproved ? "text-foreground bg-card border-foreground/30"
                              : custRecheck ? "text-destructive bg-destructive/5 border-destructive/40"
                              : "text-foreground bg-card border-foreground/30"
                            }`}>{custStatus || "Pending"}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Customer reviews the agreement from their portal and approves it or flags issues.
                          </p>
                          {custApproved && a?.CustomerApprovedAt && (
                            <p className="text-xs text-foreground flex items-center gap-1">
                              <CheckCircle2 size={11} /> Approved by customer {String(a.CustomerApprovedAt).slice(0,10)}
                            </p>
                          )}
                          {a?.RecheckCount > 0 && !custApproved && (
                            <p className="text-xs text-destructive">Recheck count: {a.RecheckCount} · Last remark: {a.LastRecheckRemarks || "—"}</p>
                          )}
                          {sent && !custApproved && !custRecheck && !cancelled && (
                            <div className="pt-1 border-t border-border/60 mt-1">
                              <p className="text-[0.6875rem] text-muted-foreground mb-1.5 flex items-center gap-1">
                                <UserCircle2 size={11} /> Customer not on portal?
                              </p>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => setProxyApproveDialog(true)}
                                  className="text-xs px-3 py-1.5 bg-card border border-foreground/30 text-foreground font-semibold hover:bg-primary/10 flex items-center gap-1.5"
                                >
                                  <UserCircle2 size={12} /> Record Approval on Their Behalf
                                </button>
                                <button
                                  onClick={() => setProxyRecheckDialog(true)}
                                  className="text-xs px-3 py-1.5 bg-destructive/5 border border-destructive/40 text-destructive font-semibold hover:bg-destructive/10 flex items-center gap-1.5"
                                >
                                  <UserCircle2 size={12} /> Record Recheck Request on Their Behalf
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`px-4 py-4 border-b border-border flex items-start gap-3 ${dated ? "bg-foreground/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(dated ? "done" : a?.DateApprovalStatus === CrmStatus.PENDING ? "warn" : custApproved ? "active" : "upcoming")}`}>
                          {dated ? <Check size={14} /> : <CalendarDays size={13} />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Agreement Date</span>
                            {dated ? (
                              <span className="text-[0.6875rem] px-2 py-0.5 border font-semibold text-foreground bg-card border-foreground/30">
                                Confirmed: {String(a.AgreementDate).slice(0,10)}
                              </span>
                            ) : a?.ProposedDate ? (
                              <span className="text-[0.6875rem] px-2 py-0.5 border font-semibold text-foreground bg-card border-foreground/30">
                                Proposed: {String(a.ProposedDate).slice(0,10)}
                              </span>
                            ) : (
                              <span className="text-[0.6875rem] px-2 py-0.5 border font-semibold text-muted-foreground bg-muted/30 border-border">Not set</span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Both sides negotiate a mutually acceptable signing date through the portal. A super-admin confirms the final agreed date.
                          </p>
                          {!dated && custApproved && !cancelled && (() => {
                            if (a?.DateApprovalStatus === CrmStatus.PENDING) return (
                              <p className="text-xs text-foreground bg-card border border-foreground/30 px-2 py-1.5 flex items-center gap-1.5">
                                <Clock size={11} /> Date matched — awaiting super admin sign-off
                              </p>
                            );
                            if (a?.ProposedDateStatus === CrmStatus.PENDING_CUSTOMER_REVIEW) return (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={11} /> Awaiting customer's response on proposed date {String(a.ProposedDate).slice(0,10)}</p>
                                <div className="border-t border-border/60 pt-1.5">
                                  <p className="text-[0.6875rem] text-muted-foreground mb-1.5 flex items-center gap-1"><UserCircle2 size={11} /> Customer not on portal?</p>
                                  <button
                                    onClick={() => setProxyDateDialog(true)}
                                    className="text-xs px-3 py-1.5 bg-card border border-foreground/30 text-foreground font-semibold hover:bg-primary/10 flex items-center gap-1.5"
                                  >
                                    <UserCircle2 size={12} /> Accept Date on Their Behalf
                                  </button>
                                </div>
                              </div>
                            );
                            if (a?.ProposedDateStatus === "PendingCompanyReview") return (
                              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                                <button onClick={handleAcceptDate} disabled={saving}
                                  className="text-xs px-3 py-1.5 bg-foreground text-card font-semibold hover:bg-foreground/80 disabled:opacity-40">
                                  Accept {String(a.ProposedDate).slice(0,10)}
                                </button>
                                <button onClick={() => { setSendDate(a?.ProposedDate ? String(a.ProposedDate).slice(0,10) : ""); setProposeDateDialog(true); }}
                                  className="text-xs px-3 py-1.5 border border-border font-medium hover:bg-muted">
                                  Propose Different Date
                                </button>
                              </div>
                            );
                            return (
                              <div className="space-y-2">
                                <button onClick={() => { setSendDate(preferredAgrDate); setProposeDateDialog(true); }}
                                  className={`${KEY_INK} h-8 px-3`}>
                                  Propose Agreement Date
                                </button>
                                <div className="border-t border-border/60 pt-1.5">
                                  <p className="text-[0.6875rem] text-muted-foreground mb-1.5 flex items-center gap-1"><UserCircle2 size={11} /> Customer communicated a date off-portal?</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <DateInput value={proxyProposedDate} onChange={(e) => setProxyProposedDate(e.target.value)}
                                      className="text-xs border border-border px-2 py-1.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
                                    <button onClick={() => proxyProposedDate && setProxyProposeDateDialog(true)}
                                      disabled={!proxyProposedDate}
                                      className="text-xs px-3 py-1.5 bg-card border border-foreground/30 text-foreground font-semibold hover:bg-primary/10 disabled:opacity-40 flex items-center gap-1.5">
                                      <UserCircle2 size={12} /> Record Customer's Proposed Date
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                          {dateHistory.length > 0 && (
                            <div className="mt-1 space-y-1 border-t border-border/60 pt-2">
                              <p className="text-[0.6875rem] text-muted-foreground font-medium flex items-center gap-1"><FolderClock size={11} /> Negotiation history</p>
                              {(dateHistory as any[]).map((h) => (
                                <div key={h.Id} className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
                                  <span className={`px-1.5 py-0.5 border font-medium ${h.ProposedBy === "Company" ? "text-foreground bg-card border-foreground/30" : "text-foreground bg-card border-foreground/30"}`}>
                                    {h.ProposedBy}
                                  </span>
                                  proposed {String(h.ProposedDate).slice(0,10)}
                                  <span className="text-[0.625rem]">· {String(h.CreatedAt).slice(0,10)}{h.CreatedByName ? ` by ${h.CreatedByName}` : ""}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={`px-4 py-4 flex items-start gap-3 ${executed ? "bg-foreground/5" : ""}`}>
                        <div className={`w-8 h-8 flex items-center justify-center text-[0.6875rem] font-bold shrink-0 mt-0.5 ${circleCls(a?.Status === CrmStatus.REGISTERED ? "done" : a?.Status === CrmStatus.EXECUTED ? "active" : dated ? "active" : "upcoming")}`}>
                          {a?.Status === CrmStatus.REGISTERED ? <Check size={14} /> : <BarChart3 size={13} />}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-sm font-semibold">Execution &amp; Registration</span>
                            <span className={`text-[0.6875rem] px-2 py-0.5 border font-semibold ${
                              a?.Status === CrmStatus.REGISTERED ? "text-foreground bg-card border-foreground/30"
                              : a?.Status === CrmStatus.EXECUTED ? "text-foreground bg-card border-foreground/30"
                              : "text-muted-foreground bg-muted/30 border-border"
                            }`}>
                              {a?.Status === CrmStatus.REGISTERED ? "Registered" : a?.Status === CrmStatus.EXECUTED ? "Executed" : "Pending"}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            All mandatory documents verified → signed &amp; executed → registered at the Sub-Registrar's office with a Doc No.
                          </p>
                          {a?.Status === CrmStatus.EXECUTED && (
                            <p className="text-xs text-foreground">Agreement executed. Record the Sub-Registrar Doc No. to mark it Registered.</p>
                          )}
                          {a?.Status === CrmStatus.REGISTERED && a?.AfsRegistrationNo && (
                            <p className="text-xs text-foreground flex items-center gap-1">
                              <CheckCircle2 size={11} /> Reg. No. {a.AfsRegistrationNo} · {a?.AfsRegistrationDate ? String(a.AfsRegistrationDate).slice(0,10) : ""}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {agrTab === "Documents" && (() => {
                const fp = followupProgress(detail.documents);
                const allVerified = (detail.documents || []).filter((d: any) => d.IsMandatory).every((d: any) => d.Status === "Verified");
                return (
              <div className="border border-border overflow-hidden">
                <div className="px-4 py-3 bg-muted/30 border-b border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground flex items-center gap-1.5"><ScrollText size={15} className="text-foreground" /> Agreement Documents ({detail.documents?.length || 0})</h3>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setDocRequestDialog(true)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Send size={12} /> Request from Customer
                      </button>
                      <button onClick={() => setDocDialog(true)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Upload size={12} /> Add Document
                      </button>
                    </div>
                  </div>
                  {fp.required > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[0.6875rem]">
                        <span className="text-muted-foreground">Mandatory docs: {fp.uploaded}/{fp.required} uploaded{allVerified ? "" : ` · ${(detail.documents || []).filter((d: any) => d.IsMandatory && d.Status === "Verified").length} verified`}</span>
                        <span className={`font-semibold ${fp.percent === 100 && allVerified ? "text-foreground" : fp.percent === 100 ? "text-foreground" : "text-muted-foreground"}`}>{fp.percent}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-muted overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            allVerified ? "bg-foreground" : fp.percent === 100 ? "bg-foreground/60" : "bg-foreground/40"
                          }`}
                          style={{ width: `${fp.percent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                {!detail.documents?.length ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">No documents uploaded yet</div>
                ) : (detail.documents as any[]).map((d: any) => {
                  const awaitingUpload = d.Status === "Requested" && !d.FilePath && !d.DocumentUrl;
                  const awaitingCustomer = awaitingUpload && d.UploadedByType === "Customer";
                  const awaitingStaff = awaitingUpload && d.UploadedByType !== "Customer";
                  const statusBg = d.Status === "Verified" ? "bg-foreground/5" : d.Status === "Rejected" ? "bg-destructive/5" : "";
                  const docRail = d.Status === "Verified" ? "hsl(var(--foreground))" : d.Status === "Rejected" ? "hsl(var(--destructive))" : d.Status === "Uploaded" || d.Status === "Submitted" ? "hsl(var(--foreground) / 0.5)" : awaitingUpload ? "hsl(var(--foreground) / 0.35)" : "var(--border)";
                  return (
                    <div key={d.Id} className={`border-b border-border last:border-0 flex ${statusBg}`}>
                      <div className="w-[3px] shrink-0 self-stretch" style={{ background: docRail }} />
                      <div className="flex-1 min-w-0 px-4 py-3.5 flex items-center gap-4">

                        <div className={`w-9 h-9 shrink-0 flex items-center justify-center border ${
                          d.Status === "Verified" ? "bg-card border-foreground/30" :
                          d.Status === "Rejected" ? "bg-destructive/5 border-destructive/40" :
                          awaitingUpload ? "bg-card border-foreground/30" :
                          "bg-muted/60 border-border"
                        }`}>
                          {awaitingUpload
                            ? <Clock size={15} className="text-foreground" />
                            : React.cloneElement(mimeIcon(d.MimeType) as React.ReactElement, { size: 15 })}
                        </div>

                        <button onClick={() => setPreviewDoc(d)} className="flex-1 min-w-0 text-left">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold leading-tight">
                              {d.Label || d.DocumentType.replace(/([A-Z])/g, " $1").trim()}
                            </span>
                            {d.IsMandatory && <span className="text-[0.625rem] text-destructive font-bold">REQUIRED</span>}
                            {d.VersionNo > 1 && <span className="text-[0.625rem] text-foreground border border-foreground/30 bg-card px-1 font-medium">v{d.VersionNo}</span>}
                            {d.UploadedByType === "Customer" && (
                              <span className="flex items-center gap-0.5 text-[0.625rem] text-foreground border border-foreground/30 bg-card px-1.5 py-0.5 font-medium">
                                <UserCircle2 size={9} /> Customer
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                            {awaitingCustomer ? (
                              <span className="text-[0.6875rem] text-foreground">Awaiting customer upload{d.RequestedAt ? ` · requested ${String(d.RequestedAt).slice(0, 10)}` : ""}</span>
                            ) : awaitingStaff ? (
                              <span className="text-[0.6875rem] text-foreground">Pending — Legal Executive to attach{d.RequestedAt ? ` · ${String(d.RequestedAt).slice(0, 10)}` : ""}</span>
                            ) : (
                              <>
                                {d.FileName && <span className="text-[0.6875rem] text-muted-foreground truncate max-w-[200px]">{d.FileName}</span>}
                                {d.FileSize && <span className="text-[0.6875rem] text-muted-foreground">{fmtBytes(d.FileSize)}</span>}
                                {d.IssuedBy && <span className="text-[0.6875rem] text-muted-foreground">by {d.IssuedBy}</span>}
                                
                              </>
                            )}
                          </div>
                        </button>

                        <div className="shrink-0 flex items-center gap-2">
                          <span className={`text-[0.6875rem] px-2.5 py-1 border font-semibold ${docStatusColor[d.Status] || "text-muted-foreground border-border"}`}>
                            {d.Status}
                          </span>
                          {!!d.FilePath && d.Status !== "Verified" && (
                            <button title="Quick verify" onClick={() => handleDocStatusChange(d.Id, "Verified")}
                              className="flex items-center gap-1 text-[0.6875rem] px-2.5 py-1 border border-foreground/30 bg-card text-foreground hover:bg-primary/10 font-semibold">
                              <Check size={11} /> Verify
                            </button>
                          )}
                          {!!d.FilePath && d.Status !== CrmStatus.REJECTED && (
                            <button title="Reject (opens review — a reason is required)" onClick={() => setPreviewDoc(d)}
                              className="flex items-center gap-1 text-[0.6875rem] px-2.5 py-1 border border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10 font-semibold">
                              <X size={11} /> Reject
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {previewDoc && (
                  <div className="p-3" style={{ borderTop: RULE }}>
                    <DocumentReviewCard key={previewDoc.Id}
                      agreementId={previewDoc.AgreementId || selectedId!}
                      doc={previewDoc}
                      onClose={() => setPreviewDoc(null)}
                      onReviewed={() => { setPreviewDoc(null); qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] }); }}
                    />
                  </div>
                )}
              </div>
                );
              })()}

              {agrTab === "Timeline" && (
                <AgreementTimeline
                  agreement={detail.agreement}
                  bookingId={detail.agreement.BookingId}
                  onJump={(t) => setAgrTab(t)}
                  canViewAfsPay={afsPayRights.canView}
                  canViewAfsReg={afsRegRights.canView}
                />
              )}

              {agrTab === "AFS Payment" && (
                afsPayRights.canView ? (
                  <CrmAfsQueryPayment
                    embeddedBookingId={detail.agreement.BookingId}
                    agreementStatus={detail.agreement.Status}
                    onChanged={() => {
                      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                      qc.invalidateQueries({ queryKey: ["crm-afs-query-payment-booking", detail.agreement.BookingId] });
                      qc.invalidateQueries({ queryKey: ["crm-afs-registry-booking", detail.agreement.BookingId] });
                    }}
                  />
                ) : (
                  <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    You don't have access to the AFS Query Payment stage.
                  </div>
                )
              )}

              {agrTab === "AFS Registry" && (
                afsRegRights.canView ? (
                  <CrmAfsRegistry
                    embeddedBookingId={detail.agreement.BookingId}
                    onChanged={() => {
                      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                      qc.invalidateQueries({ queryKey: ["crm-afs-registry-booking", detail.agreement.BookingId] });
                    }}
                  />
                ) : (
                  <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    You don't have access to the AFS Registry stage.
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>

      {/* New Agreement Dialog */}
      <Dialog open={agrDialog} onOpenChange={(o) => { if (!o) setAgrDialog(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-none" style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading">New Agreement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Booking *</label>
              <SearchableNativeSelect value={agrForm.BookingId} onChange={(e) => setAgrForm((f) => ({
                  ...f,
                  BookingId: e.target.value,
                  LegalName: "", PanNo: "", AadhaarNo: "", LegalAddress: "",
                }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </SearchableNativeSelect>
              {bookings.length === 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  No bookings are eligible yet — a booking needs to be Approved, have its welcome call marked
                  Welcomed, and have customer bank/PAN/Aadhaar details on file before an agreement can be created.
                </p>
              )}
              {bkgFilter && !(bookings as any[]).some((b) => String(b.Id) === String(bkgFilter)) && (
                <p className="text-xs text-foreground mt-1">
                  This dialog was opened for a specific booking, but that booking isn't eligible for an agreement yet
                  — pick from the list above, or complete its remaining prerequisites first.
                </p>
              )}
            </div>
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Legal Executive <span className="text-muted-foreground font-normal">(the person preparing the paperwork)</span></label>
              <SearchableNativeSelect value={agrForm.LegalExecutiveId} onChange={(e) => setAgrForm((f) => ({ ...f, LegalExecutiveId: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                <option value="">— Unassigned —</option>
                {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </SearchableNativeSelect>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { key: "LegalName",    label: "Legal Name",      type: "text" },
                { key: "PanNo",        label: "PAN (Permanent Account Number)",          type: "text" },
                { key: "AadhaarNo",    label: "Aadhaar No",      type: "text" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">{label}</label>
                  <AutoInput type={type} value={agrForm[key as keyof typeof agrForm]}
                    onChange={(e) => setAgrForm((f) => ({ ...f, [key]: key === "PanNo" ? e.target.value.toUpperCase() : e.target.value }))}
                    className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
                </div>
              ))}
            </div>
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Legal Address</label>
              <textarea value={agrForm.LegalAddress} onChange={(e) => setAgrForm((f) => ({ ...f, LegalAddress: e.target.value }))}
                rows={2} className="w-full text-sm border border-border px-2 py-1.5 bg-background resize-none" />
            </div>
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Notes</label>
              <textarea value={agrForm.Notes} onChange={(e) => setAgrForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setAgrDialog(false)}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSaveAgreement} disabled={saving}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Creating..." : "Create Agreement"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send to Customer Portal Dialog */}
      <Dialog open={sendDialog} onOpenChange={(o) => { if (!o) { setSendDialog(false); setSendDate(""); } }}>
        <DialogContent className="max-w-sm rounded-none" style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading">Send to Customer Portal</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              The customer will be able to review this agreement and its documents from their portal, and either approve it or request a recheck.
            </p>
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Proposed Agreement Date (optional)</label>
              <DateInput value={sendDate} onChange={(e) => setSendDate(e.target.value)}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
              <p className="text-[0.6875rem] text-muted-foreground mt-1">If the customer proposes the same date, it's confirmed automatically as the Agreement Date.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setSendDialog(false); setSendDate(""); }}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={() => handleSendToCustomer(sendDate)} disabled={saving}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Sending..." : "Send"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {proxyApproveDialog && (
        <ProxyActionDialog
          title="Record Customer Approval"
          description="You are recording that the customer has reviewed and approved the agreement without logging into their portal."
          confirmLabel="Record Approval"
          saving={proxySaving}
          onClose={() => setProxyApproveDialog(false)}
          onConfirm={handleProxyCustomerApprove}
        />
      )}

      {proxyRecheckDialog && (
        <ProxyActionDialog
          title="Record Customer Recheck Request"
          description="You are recording that the customer has flagged an issue or requested changes to the agreement without using the portal."
          confirmLabel="Record Recheck Request"
          saving={proxySaving}
          onClose={() => setProxyRecheckDialog(false)}
          onConfirm={handleProxyCustomerRecheck}
        />
      )}

      {proxyProposeDateDialog && (
        <ProxyActionDialog
          title="Record Customer's Proposed Date"
          description={`You are recording that the customer proposed ${proxyProposedDate} as the agreement signing date without using the portal.`}
          confirmLabel="Record Proposed Date"
          saving={proxySaving}
          onClose={() => setProxyProposeDateDialog(false)}
          onConfirm={handleProxyProposeDate}
        />
      )}

      {proxyDateDialog && (
        <ProxyActionDialog
          title="Accept Date on Customer's Behalf"
          description="You are recording that the customer has agreed to the proposed signing date without using their portal."
          confirmLabel="Confirm Date Acceptance"
          saving={proxySaving}
          onClose={() => setProxyDateDialog(false)}
          onConfirm={handleProxyDateAccept}
        />
      )}

      <Dialog open={proposeDateDialog} onOpenChange={(o) => { if (!o) { setProposeDateDialog(false); setSendDate(""); } }}>
        <DialogContent className="max-w-sm rounded-none" style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading">Propose Agreement Date</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This date goes to the customer for their review. They can accept it as-is, or propose a different one back to you.
            </p>
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Proposed Agreement Date</label>
              <DateInput value={sendDate} onChange={(e) => setSendDate(e.target.value)}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
              {preferredAgrDate && sendDate === preferredAgrDate && (
                <p className="text-[0.6875rem] text-foreground mt-1 flex items-center gap-1">
                  <span>ⓘ</span> Pre-filled from welcome call discussion
                </p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setProposeDateDialog(false); setSendDate(""); }}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={() => handleProposeDate(sendDate)} disabled={saving}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Saving..." : "Propose Date"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={regDialog} onOpenChange={(o) => { if (!o) { setRegDialog(false); setRegFeesLocked(false); setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" }); } }}>
        <DialogContent className="max-w-sm rounded-none" style={{ border: RULE }}>
          <DialogHeader>
            <DialogTitle className="font-heading">Mark Agreement Registered</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 pb-1">
            <p className="text-xs text-muted-foreground">
              Enter the details from the Sub-Registrar's office. The AFS registration is a separate legal event from the Sale Deed — it happens now, early in the process.
            </p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">AFS Registration No. <span className="text-destructive">*</span></label>
              <input
                type="text"
                placeholder="e.g. SRO/MH/2024/001234"
                value={regForm.AfsRegistrationNo}
                onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationNo: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background"
              />
              <p className="text-[0.6875rem] text-muted-foreground mt-1">Doc No. issued by Sub-Registrar at the time of AFS registration.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">AFS Registration Date <span className="text-destructive">*</span></label>
              <DateInput
                value={regForm.AfsRegistrationDate}
                onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationDate: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background"
              />
            </div>
            <div className={`border ${regFeesLocked ? "border-foreground/30 bg-foreground/5" : "border-border"} p-3 space-y-2`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground">Government Fees</p>
                  {regFeesLocked && (
                    <p className="text-[0.6875rem] text-foreground mt-0.5">Pre-filled from confirmed AFS Query Payment — verify against Sub-Registrar receipt</p>
                  )}
                </div>
                {regFeesLocked ? (
                  <button type="button" onClick={() => setRegFeesLocked(false)}
                    className="shrink-0 text-[0.6875rem] px-2 py-1 border border-border text-muted-foreground hover:bg-muted font-medium">
                    Edit amounts
                  </button>
                ) : (regForm.AfsStampDuty !== "" || regForm.AfsRegistrationFee !== "") ? (
                  <button type="button" onClick={() => setRegFeesLocked(true)}
                    className="shrink-0 text-[0.6875rem] px-2 py-1 border border-foreground/30 text-foreground hover:bg-primary/10 font-medium">
                    Lock amounts
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[0.6875rem] text-muted-foreground block mb-1">Stamp Duty (₹)</label>
                  <input
                    type="number" placeholder="0"
                    value={regForm.AfsStampDuty}
                    readOnly={regFeesLocked}
                    onChange={(e) => setRegForm((f) => ({ ...f, AfsStampDuty: e.target.value }))}
                    className={`w-full text-sm border px-2 py-1.5 font-heading tabular-nums ${regFeesLocked ? "bg-muted/30 border-border text-foreground cursor-default select-none" : "bg-background border-border"}`}
                  />
                </div>
                <div>
                  <label className="text-[0.6875rem] text-muted-foreground block mb-1">Registration Fee (₹)</label>
                  <input
                    type="number" placeholder="0"
                    value={regForm.AfsRegistrationFee}
                    readOnly={regFeesLocked}
                    onChange={(e) => setRegForm((f) => ({ ...f, AfsRegistrationFee: e.target.value }))}
                    className={`w-full text-sm border px-2 py-1.5 font-heading tabular-nums ${regFeesLocked ? "bg-muted/30 border-border text-foreground cursor-default select-none" : "bg-background border-border"}`}
                  />
                </div>
              </div>
              <p className="text-[0.6875rem] text-muted-foreground">Stamp duty paid at AFS registration is creditable against Sale Deed stamp duty — the Sale Deed fee calculation will use this figure.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => { setRegDialog(false); setRegFeesLocked(false); setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" }); }}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleMarkRegistered} disabled={regSaving || !regForm.AfsRegistrationNo.trim() || !regForm.AfsRegistrationDate}
              className={`${KEY_INK} h-8 px-3`}>
              {regSaving ? "Saving..." : "Confirm Registration"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={docDialog} onOpenChange={(o) => { if (!o) { setDocDialog(false); setShowUrlField(false); } }}>
        <DialogContent className="max-w-md rounded-none" style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading">Add Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Document Type *</label>
              <select value={docForm.DocumentType} onChange={(e) => setDocForm((f) => ({ ...f, DocumentType: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Issued By</label>
              <input type="text" value={docForm.IssuedBy} onChange={(e) => setDocForm((f) => ({ ...f, IssuedBy: e.target.value }))}
                placeholder="e.g. Legal team, Bank, Registrar office"
                className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
            </div>
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Remarks (optional)</label>
              <textarea value={docForm.Remarks} onChange={(e) => setDocForm((f) => ({ ...f, Remarks: e.target.value }))}
                rows={2} className="w-full text-sm border border-border px-2 py-1.5 bg-background resize-none" />
            </div>

            <input type="file" multiple ref={docFileInputRef}
              onChange={(e) => handleUploadDocFiles(e.target.files)}
              className="hidden" />
            <button onClick={() => docFileInputRef.current?.click()} disabled={uploadingDocs}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:border-primary/50 hover:text-primary disabled:opacity-40">
              <Upload size={14} /> {uploadingDocs ? "Uploading..." : "Upload File(s)"}
            </button>
            <p className="text-[0.6875rem] text-muted-foreground text-center">PDF, images, Word, Excel · up to 10 files, 25 MB each</p>

            {showUrlField ? (
              <div className="flex items-center gap-2 pt-1">
                <input placeholder="https://..." value={docForm.DocumentUrl} onChange={(e) => setDocForm((f) => ({ ...f, DocumentUrl: e.target.value }))}
                  className="flex-1 text-sm border border-border px-2 py-1.5 bg-background" />
                <button onClick={handleAddDocument} disabled={saving}
                  className="text-xs px-3 py-1.5 border border-border hover:bg-muted shrink-0 disabled:opacity-40">
                  {saving ? "Adding..." : "Add Link"}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowUrlField(true)} className="text-xs text-primary hover:underline">
                ...or paste an external document URL instead
              </button>
            )}
          </div>
          <div className="flex justify-end pt-3 border-t border-border">
            <button onClick={() => { setDocDialog(false); setShowUrlField(false); }}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Close</button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={docRequestDialog} onOpenChange={(o) => { if (!o) setDocRequestDialog(false); }}>
        <DialogContent className="max-w-sm rounded-none" style={{ border: RULE }}>
          <DialogHeader><DialogTitle className="font-heading">Request Document from Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Document Type *</label>
              <select value={docRequestForm.DocumentType} onChange={(e) => setDocRequestForm((f) => ({ ...f, DocumentType: e.target.value }))}
                className="w-full text-sm border border-border px-2 py-1.5 bg-background">
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Label shown to customer (optional)</label>
              <input type="text" value={docRequestForm.Label} onChange={(e) => setDocRequestForm((f) => ({ ...f, Label: e.target.value }))}
                placeholder="e.g. Latest bank statement"
                className="w-full text-sm border border-border px-2 py-1.5 bg-background" />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={docRequestForm.IsMandatory}
                onChange={(e) => setDocRequestForm((f) => ({ ...f, IsMandatory: e.target.checked }))} />
              Required before the customer can approve the agreement
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setDocRequestDialog(false)}
              className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleRequestDocument} disabled={saving}
              className={`${KEY_INK} h-8 px-3`}>
              {saving ? "Requesting..." : "Request"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialog} onOpenChange={(o) => { if (!o) { setEditDialog(false); setEditLocked(true); } }}>
        <DialogContent className="max-w-lg rounded-none" style={{ border: RULE }}>
          {(() => {
            const alIssued = false;
            const alIssuedOn = null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="font-heading flex items-center justify-between gap-2 pr-6">
                    <span className="flex items-center gap-1.5">
                      {alIssued && <Lock size={14} className="text-foreground shrink-0" />}
                      {alIssued ? "Amend Agreement Details" : "Edit Agreement Details"}
                    </span>
                    {editLocked && (
                      <button onClick={() => setEditLocked(false)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border hover:bg-muted transition-colors shrink-0 ${
                          alIssued ? "border-foreground/30 text-foreground bg-card hover:bg-primary/10" : "border-border"
                        }`}>
                        <Pencil size={12} /> {alIssued ? "Unlock for Amendment" : "Edit"}
                      </button>
                    )}
                  </DialogTitle>
                </DialogHeader>
                {editLocked ? (
                  alIssued ? (
                    <div className="flex items-start gap-2 text-xs text-foreground bg-card border border-foreground/30 px-3 py-2 -mt-1">
                      <Lock size={12} className="shrink-0 mt-0.5" />
                      <span>
                        Allotment Letter issued{alIssuedOn ? ` on ${String(alIssuedOn).slice(0, 10)}` : ""} — legal details are formally committed.
                        Any change is a recorded amendment and requires a stated reason.
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border px-3 py-1.5 -mt-1">
                      <Lock size={11} /> Locked for viewing — click "Edit" above to make changes.
                    </div>
                  )
                ) : alIssued ? (
                  <div className="flex items-start gap-2 text-xs text-foreground bg-card border border-foreground/30 px-3 py-2 -mt-1">
                    <ShieldAlert size={12} className="shrink-0 mt-0.5" />
                    <span>
                      <strong>Amendment mode</strong> — the Allotment Letter has been issued. Any changes to legal details
                      (name, PAN, Aadhaar, address) will be version-stamped and require a reason.
                      This is recorded in the audit trail.
                    </span>
                  </div>
                ) : null}
                <div className="space-y-3">
                  <div>
                    <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Legal Executive <span className="text-muted-foreground font-normal">(the person preparing the paperwork)</span></label>
                    <SearchableNativeSelect value={editForm.LegalExecutiveId} disabled={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalExecutiveId: e.target.value }))}
                      className={editInputCls}>
                      <option value="">— Unassigned —</option>
                      {users.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </SearchableNativeSelect>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Legal Name</label>
                      <input type="text" value={editForm.LegalName} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalName: e.target.value }))}
                        className={editInputCls} />
                    </div>
                    <div>
                      <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">PAN (Permanent Account Number)</label>
                      <input type="text" value={editForm.PanNo} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, PanNo: e.target.value.toUpperCase() }))}
                        className={editInputCls} />
                    </div>
                    <div>
                      <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Aadhaar No.</label>
                      <input type="text" value={editForm.AadhaarNo} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, AadhaarNo: e.target.value }))}
                        className={editInputCls} />
                    </div>
                  </div>
                  <div>
                    <label className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground block mb-1">Legal Address</label>
                    <textarea value={editForm.LegalAddress} readOnly={editLocked} onChange={(e) => setEditForm((f) => ({ ...f, LegalAddress: e.target.value }))}
                      rows={2} className={`${editInputCls} resize-none`} />
                  </div>
                  {!editLocked && (
                    <div>
                      <label className={`text-xs block mb-1 ${alIssued ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {alIssued ? <>Amendment Reason <span className="text-destructive">*</span></> : "Reason for this revision"}
                      </label>
                      <input type="text" value={editForm.RevisionReason} onChange={(e) => setEditForm((f) => ({ ...f, RevisionReason: e.target.value }))}
                        placeholder={alIssued ? "Required — e.g. Customer requested name correction (affidavit attached)" : "e.g. Customer requested recheck — corrected spelling"}
                        className={`w-full text-sm border px-2 py-1.5 bg-background ${alIssued ? "border-foreground/40 focus:border-foreground" : "border-border"}`} />
                      {alIssued && <p className="text-[0.6875rem] text-foreground mt-1">Required when legal details change after Allotment Letter is issued. Saved permanently in version history.</p>}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-3 border-t border-border">
                  {editLocked ? (
                    <button onClick={() => { setEditDialog(false); setEditLocked(true); }} className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Close</button>
                  ) : (
                    <>
                      <button onClick={() => { setEditDialog(false); setEditLocked(true); }} className="px-3 py-1.5 text-sm border border-border text-muted-foreground hover:bg-muted">Cancel</button>
                      <button onClick={handleSaveEdit} disabled={saving}
                        className={`px-4 py-1.5 text-sm font-medium disabled:opacity-40 ${
                          alIssued ? "bg-foreground text-card" : "bg-foreground text-card"
                        }`}>
                        {saving ? "Saving..." : alIssued ? "Save Amendment" : "Save"}
                      </button>
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </SheetShell>
    </>
  );
};

export default CrmAgreement;
