/**
 * useRegistryState — Sub-Registrar appointment tracker state + handlers.
 *
 * Extracted from CrmSalesDeed.tsx to keep registry concerns self-contained.
 * All state, refs, queries and API calls for the Registry tab live here.
 */

import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const API = "/api/crm/sales-deed";
const CRM_REGISTRY_APPROVER_ROLES = ["admin", "super_admin", "marketing_head", "legal_head"];

export function useRegistryState(
  detail: any | null,
  currentUser: any,
  canDoAction: (page: any, action: string) => boolean,
  onRegistryChange: () => void,
) {
  const qc = useQueryClient();

  // ── Dialog / form state ───────────────────────────────────────────────
  const [regStarting, setRegStarting] = useState(false);
  const [regScheduleOpen, setRegScheduleOpen] = useState<"first" | "reschedule" | null>(null);
  const [regScheduledDate, setRegScheduledDate] = useState("");
  const [regAppointmentTime, setRegAppointmentTime] = useState("");
  const [regAppointmentOffice, setRegAppointmentOffice] = useState("");
  const [regRescheduleReason, setRegRescheduleReason] = useState("");
  const [regCompleteOpen, setRegCompleteOpen] = useState(false);
  const [regCompleteForm, setRegCompleteForm] = useState({
    RegistrationNo: "", BookNo: "", PartNo: "", SubRegistrarOffice: "",
    RegistrationDate: new Date().toISOString().slice(0, 10),
    WitnessNames: "", BuyerAttended: false, SellerAttended: false,
  });
  const [regCancelOpen, setRegCancelOpen] = useState(false);
  const [regCancelReason, setRegCancelReason] = useState("");
  const [regNewDocType, setRegNewDocType] = useState("Other");
  const [regNewDocLabel, setRegNewDocLabel] = useState("");
  const [regUploadingDoc, setRegUploadingDoc] = useState(false);
  const [regRequestingDoc, setRegRequestingDoc] = useState(false);
  const [previewLoading, setPreviewLoading] = useState<number | null>(null);
  const regFileInputRef = useRef<HTMLInputElement>(null);

  // ── Queries ───────────────────────────────────────────────────────────
  const { data: regByBooking, refetch: refetchRegByBooking } = useQuery({
    queryKey: ["crm-sales-deed-registry-by-booking", detail ? String(detail.BookingId) : ""],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/registry/booking/${detail?.BookingId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: detail?.BookingId != null,
    staleTime: 15_000,
  });
  const registryId = regByBooking?.Id ?? null;

  const { data: regDetailData, refetch: refetchRegDetail } = useQuery({
    queryKey: ["crm-sales-deed-registry-detail", registryId],
    queryFn: async () => {
      if (registryId == null) return null;
      const r = await fetchWithAuth(`${API}/registry/${registryId}`);
      if (!r.ok) return null;
      return r.json();
    },
    enabled: registryId != null,
    staleTime: 15_000,
  });

  const { data: regEligibleBookings = [] } = useQuery({
    queryKey: ["crm-sales-deed-registry-eligible"],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/registry/eligible-bookings`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60_000,
  });

  // ── Derived values ────────────────────────────────────────────────────
  const registry = regDetailData?.registry ?? regByBooking ?? null;
  const registryDocuments: any[] = regDetailData?.documents || [];
  const registryHistory: any[] = regDetailData?.history || [];
  const registryRequired = registryDocuments.filter((d) => d.IsMandatory);
  const registrySupporting = registryDocuments.filter((d) => !d.IsMandatory);
  const registryVerifiedCount = registryRequired.filter((d) => d.Status === "Verified").length;
  const registryLocked = registry && ["Completed", "Cancelled"].includes(registry.Status);
  const canCompleteOrCancelRegistry =
    CRM_REGISTRY_APPROVER_ROLES.includes(String(currentUser?.role || "").toLowerCase()) ||
    canDoAction("approval-inbox" as any, "edit");
  const registryStartEligible = detail?.BookingId
    ? (regEligibleBookings as any[]).some((b: any) => String(b.Id) === String(detail.BookingId))
    : false;

  const invalidateRegistry = () => {
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-registry-by-booking"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-registry-detail", registryId] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-registry-eligible"] });
    refetchRegByBooking();
    if (registryId) refetchRegDetail();
  };

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleStartRegistry = async () => {
    if (detail?.BookingId == null) return;
    setRegStarting(true);
    try {
      const res = await fetchWithAuth(`${API}/registry`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: detail.BookingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.RegNo} started`);
      onRegistryChange(); invalidateRegistry();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRegStarting(false); }
  };

  const handleRegSchedule = async () => {
    if (registryId == null || !regScheduledDate) { toast.error("Date is required"); return; }
    const isReschedule = regScheduleOpen === "reschedule";
    if (!isReschedule && !regAppointmentOffice.trim()) { toast.error("Sub-Registrar Office is required"); return; }
    if (isReschedule && !regRescheduleReason.trim()) { toast.error("A reason is required to reschedule"); return; }
    try {
      const res = await fetchWithAuth(`${API}/registry/${registryId}/${isReschedule ? "reschedule" : "schedule"}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isReschedule
          ? { ScheduledDate: regScheduledDate, AppointmentTime: regAppointmentTime, AppointmentOffice: regAppointmentOffice, Reason: regRescheduleReason.trim() }
          : { ScheduledDate: regScheduledDate, AppointmentTime: regAppointmentTime, AppointmentOffice: regAppointmentOffice.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(isReschedule ? "Appointment rescheduled" : "Appointment scheduled");
      setRegScheduleOpen(null); setRegScheduledDate(""); setRegAppointmentTime(""); setRegAppointmentOffice(""); setRegRescheduleReason("");
      invalidateRegistry();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRegComplete = async () => {
    if (registryId == null) return;
    if (!regCompleteForm.RegistrationNo.trim()) { toast.error("Registration No. is required"); return; }
    if (!regCompleteForm.WitnessNames.trim()) { toast.error("Witness names are required"); return; }
    if (!regCompleteForm.BuyerAttended || !regCompleteForm.SellerAttended) { toast.error("Both parties' attendance must be confirmed"); return; }
    try {
      const res = await fetchWithAuth(`${API}/registry/${registryId}/complete`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regCompleteForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Registry completed — Sale Deed marked Registered");
      setRegCompleteOpen(false);
      setRegCompleteForm({ RegistrationNo: "", BookNo: "", PartNo: "", SubRegistrarOffice: "", RegistrationDate: new Date().toISOString().slice(0, 10), WitnessNames: "", BuyerAttended: false, SellerAttended: false });
      onRegistryChange(); invalidateRegistry();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRegCancel = async () => {
    if (registryId == null || !regCancelReason.trim()) { toast.error("A reason is required"); return; }
    try {
      const res = await fetchWithAuth(`${API}/registry/${registryId}/cancel`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Reason: regCancelReason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Registry cancelled");
      setRegCancelOpen(false); setRegCancelReason("");
      invalidateRegistry();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRegUploadDoc = async (file: File, documentType: string, label?: string) => {
    if (registryId == null) return;
    setRegUploadingDoc(true);
    try {
      const formData = new FormData();
      formData.append("files", file);
      formData.append("DocumentType", documentType);
      if (label) formData.append("Label", label);
      const res = await fetchWithAuth(`${API}/registry/${registryId}/documents/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document uploaded");
      invalidateRegistry();
      setRegNewDocLabel("");
      if (regFileInputRef.current) regFileInputRef.current.value = "";
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRegUploadingDoc(false); }
  };

  const handleRegRequestDoc = async (documentType: string, label?: string) => {
    if (registryId == null) return;
    setRegRequestingDoc(true);
    try {
      const res = await fetchWithAuth(`${API}/registry/${registryId}/documents/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ DocumentType: documentType, Label: label, IsMandatory: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document requested");
      invalidateRegistry();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRegRequestingDoc(false); }
  };

  const handleRegVerifyDoc = async (docId: number) => {
    if (registryId == null) return;
    try {
      const res = await fetchWithAuth(`${API}/registry/${registryId}/documents/${docId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: "Verified" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document verified");
      invalidateRegistry();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRegRejectDoc = async (docId: number) => {
    if (registryId == null) return;
    const remarks = window.prompt("Describe what's wrong with this document (required):");
    if (!remarks?.trim()) return;
    try {
      const res = await fetchWithAuth(`${API}/registry/${registryId}/documents/${docId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: "Rejected", Remarks: remarks.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Document rejected");
      invalidateRegistry();
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  const handleRegPreviewDoc = async (doc: any, setPreviewDoc: (v: any) => void) => {
    setPreviewLoading(doc.Id);
    try {
      const res = await fetchWithAuth(`${API}/registry/documents/file/${doc.Id}`);
      if (!res.ok) throw new Error("Could not load file");
      const blob = await res.blob();
      setPreviewDoc({ url: URL.createObjectURL(blob), mime: doc.MimeType, name: doc.FileName || doc.DocumentType });
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setPreviewLoading(null); }
  };

  const handleRegDownloadDoc = async (doc: any) => {
    try {
      const res = await fetchWithAuth(`${API}/registry/documents/file/${doc.Id}`);
      if (!res.ok) throw new Error("Could not download file");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = doc.FileName || doc.DocumentType || "document";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) { toast.error(translateError(e.message)); }
  };

  return {
    // state
    regStarting, regScheduleOpen, setRegScheduleOpen,
    regScheduledDate, setRegScheduledDate,
    regAppointmentTime, setRegAppointmentTime,
    regAppointmentOffice, setRegAppointmentOffice,
    regRescheduleReason, setRegRescheduleReason,
    regCompleteOpen, setRegCompleteOpen,
    regCompleteForm, setRegCompleteForm,
    regCancelOpen, setRegCancelOpen,
    regCancelReason, setRegCancelReason,
    regNewDocType, setRegNewDocType,
    regNewDocLabel, setRegNewDocLabel,
    regUploadingDoc, regRequestingDoc,
    previewLoading, regFileInputRef,
    // data
    registry, registryDocuments, registryHistory,
    registryRequired, registrySupporting,
    registryVerifiedCount, registryLocked,
    registryId, registryStartEligible,
    canCompleteOrCancelRegistry,
    // handlers
    invalidateRegistry,
    handleStartRegistry, handleRegSchedule, handleRegComplete,
    handleRegCancel, handleRegUploadDoc, handleRegRequestDoc,
    handleRegVerifyDoc, handleRegRejectDoc,
    handleRegPreviewDoc, handleRegDownloadDoc,
  };
}
