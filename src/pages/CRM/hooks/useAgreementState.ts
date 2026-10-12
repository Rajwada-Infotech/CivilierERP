import { useState, useRef } from "react";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { ProxyMethod } from "@/components/crm/ProxyActionDialog";

const API = "/api/crm/agreements";

const EMPTY_AGR_FORM = {
  BookingId: "", LegalName: "", LegalAddress: "",
  PanNo: "", AadhaarNo: "", Notes: "", LegalExecutiveId: "",
};
const EMPTY_DOC_FORM = {
  DocumentType: "SaleAgreement", DocumentUrl: "", IssuedBy: "", Remarks: "",
};
const EMPTY_DOC_REQUEST_FORM = {
  DocumentType: "IdentityProof", Label: "", IsMandatory: true,
};

export function useAgreementState(
  selectedId: number | null,
  bkgFilter: string,
  qc: any,
  navigate: any,
  promptNextStep: (navigate: any, title: string, path: string, buttonText: string) => void
) {
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
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const [editDialog, setEditDialog] = useState(false);
  const [editForm, setEditForm] = useState({ LegalName: "", LegalAddress: "", PanNo: "", AadhaarNo: "", RevisionReason: "", LegalExecutiveId: "" });
  const [editLocked, setEditLocked] = useState(true);
  const [saving, setSaving] = useState(false);

  const [proxyApproveDialog, setProxyApproveDialog] = useState(false);
  const [proxyRecheckDialog, setProxyRecheckDialog] = useState(false);
  const [proxyDateDialog, setProxyDateDialog] = useState(false);
  const [proxyProposeDateDialog, setProxyProposeDateDialog] = useState(false);
  const [proxyProposedDate, setProxyProposedDate] = useState("");
  const [proxySaving, setProxySaving] = useState(false);

  const [editingLegalExec, setEditingLegalExec] = useState(false);

  const handleSaveAgreement = async () => {
    if (!agrForm.BookingId) { toast.error("Booking is required"); return; }
    if (agrForm.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(agrForm.PanNo.trim())) { toast.error("Invalid PAN format (e.g. ABCDE1234F)"); return; }
    if (agrForm.AadhaarNo && !/^\d{12}$/.test(agrForm.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...agrForm, BookingId: parseInt(agrForm.BookingId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create agreement");
      toast.success(`Agreement ${data.AgreementNo} created`);
      setAgrDialog(false);
      setAgrForm({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleAddDocument = async () => {
    if (selectedId == null) return;
    if (!docForm.DocumentUrl.trim()) { toast.error("Enter a URL, or use the upload button to attach a file"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add document");
      toast.success("Document added");
      setDocDialog(false); setDocForm({ ...EMPTY_DOC_FORM }); setShowUrlField(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleRequestDocument = async () => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docRequestForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to request document");
      toast.success("Document requested — the customer will see it in their portal");
      setDocRequestDialog(false); setDocRequestForm({ ...EMPTY_DOC_REQUEST_FORM });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
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
      setDocDialog(false); setDocForm({ ...EMPTY_DOC_FORM }); setShowUrlField(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally {
      setUploadingDocs(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  };

  const handleDocStatusChange = async (docId: number, status: string) => {
    if (selectedId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/documents/${docId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update document");
      toast.success(`Marked ${status}`);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleSendToCustomer = async (proposedDate: string) => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/send-to-customer`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate: proposedDate || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agreement sent to customer portal");
      setSendDialog(false); setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleProposeDate = async (proposedDate: string) => {
    if (selectedId == null || !proposedDate) { toast.error("Pick a date"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/propose-date`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Proposed date sent to customer");
      setProposeDateDialog(false); setSendDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
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
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
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
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleMarkRegistered = async () => {
    if (selectedId == null) return;
    if (!regForm.AfsRegistrationNo.trim()) { toast.error("AFS Registration No. is required"); return; }
    if (!regForm.AfsRegistrationDate) { toast.error("AFS Registration Date is required"); return; }
    setRegSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/mark-registered`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
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
      setRegDialog(false); setRegForm({ AfsRegistrationNo: "", AfsRegistrationDate: "", AfsStampDuty: "", AfsRegistrationFee: "" });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
      promptNextStep(navigate, "Agreement registered — you may now request Bank / Organisation NOC.", "/crm/noc", "Go to NOC");
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRegSaving(false); }
  };

  const handleProxyCustomerApprove = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-customer-approve`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer approval recorded on their behalf");
      setProxyApproveDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const handleProxyDateAccept = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-date-accept`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer date acceptance recorded on their behalf");
      setProxyDateDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const handleProxyCustomerRecheck = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-customer-recheck`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer recheck request recorded on their behalf");
      setProxyRecheckDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const handleProxyProposeDate = async (method: ProxyMethod, remarks: string) => {
    if (selectedId == null || !proxyProposedDate) return;
    setProxySaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/proxy-propose-date`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ProxyMethod: method, ProxyRemarks: remarks, ProposedDate: proxyProposedDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Customer's proposed date recorded on their behalf");
      setProxyProposeDateDialog(false); setProxyProposedDate("");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };

  const handleTogglePortal = async (deactivate: boolean) => {
    if (selectedId == null) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/portal/${deactivate ? "deactivate" : "reactivate"}`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(deactivate ? "Portal link deactivated" : "Portal link reactivated");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  const handleAssignLegal = async (execId: number | null) => {
    if (selectedId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/assign-legal`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ LegalExecutiveId: execId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(execId ? "Legal Executive assigned" : "Legal Executive removed");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleSaveEdit = async () => {
    if (selectedId == null) return;
    if (editForm.PanNo && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(editForm.PanNo.trim())) { toast.error("Invalid PAN format"); return; }
    if (editForm.AadhaarNo && !/^\d{12}$/.test(editForm.AadhaarNo.trim())) { toast.error("Aadhaar must be exactly 12 digits"); return; }
    if (!editLocked && !editForm.RevisionReason.trim()) { toast.error("Reason for revision is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          LegalName: editForm.LegalName, LegalAddress: editForm.LegalAddress,
          PanNo: editForm.PanNo, AadhaarNo: editForm.AadhaarNo,
          LegalExecutiveId: editForm.LegalExecutiveId ? parseInt(editForm.LegalExecutiveId) : null,
          RevisionReason: editLocked ? null : editForm.RevisionReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Agreement details updated");
      setEditDialog(false);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-revisions", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSaving(false); }
  };

  return {
    agrDialog, setAgrDialog,
    docDialog, setDocDialog,
    docRequestDialog, setDocRequestDialog,
    sendDialog, setSendDialog,
    proposeDateDialog, setProposeDateDialog,
    sendDate, setSendDate,
    regDialog, setRegDialog,
    regForm, setRegForm,
    regFeesLocked, setRegFeesLocked,
    regSaving, setRegSaving,
    agrForm, setAgrForm,
    docForm, setDocForm,
    docRequestForm, setDocRequestForm,
    showUrlField, setShowUrlField,
    uploadingDocs, setUploadingDocs,
    previewDoc, setPreviewDoc,
    docFileInputRef,
    editDialog, setEditDialog,
    editForm, setEditForm,
    editLocked, setEditLocked,
    saving, setSaving,
    proxyApproveDialog, setProxyApproveDialog,
    proxyRecheckDialog, setProxyRecheckDialog,
    proxyDateDialog, setProxyDateDialog,
    proxyProposeDateDialog, setProxyProposeDateDialog,
    proxyProposedDate, setProxyProposedDate,
    proxySaving, setProxySaving,
    editingLegalExec, setEditingLegalExec,
    handleSaveAgreement, handleAddDocument, handleRequestDocument,
    handleUploadDocFiles, handleDocStatusChange, handleSendToCustomer,
    handleProposeDate, handleAcceptDate, handleAgreementAction,
    handleMarkRegistered, handleProxyCustomerApprove, handleProxyDateAccept,
    handleProxyCustomerRecheck, handleProxyProposeDate,
    handleTogglePortal, handleAssignLegal, handleSaveEdit
  };
}
