/**
 * useQueryPaymentState — Stamp Duty / Registration Fee payment tracker state + handlers.
 *
 * Extracted from CrmSalesDeed.tsx to keep Query Payment concerns self-contained.
 * All state, refs, queries and API calls for the Query Payment tab live here.
 */

import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { translateError } from "@/lib/translateError";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { CrmStatus } from "@/constants/crmStatuses";
import type { ProxyMethod } from "@/components/crm/ProxyActionDialog";

const API = "/api/crm/sales-deed";
const QP_MAX_FILE = 4 * 1024 * 1024;
const QP_MAX_TOTAL = 6 * 1024 * 1024;

export interface QPStagedFile {
  name: string;
  size: number;
  type: string;
  base64: string;
  dataUri: string;
}

function qpFileToStaged(f: File): Promise<QPStagedFile> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(r.error);
    r.onload = () => {
      const uri = r.result as string;
      res({ name: f.name, size: f.size, type: f.type, base64: uri.slice(uri.indexOf(",") + 1), dataUri: uri });
    };
    r.readAsDataURL(f);
  });
}

const CRM_REGISTRY_APPROVER_ROLES = ["admin", "super_admin", "marketing_head", "legal_head"];

export function useQueryPaymentState(
  detail: any | null,
  currentUser: any,
  canDoAction: (page: any, action: string) => boolean,
  onQpChange: () => void,
) {
  const qc = useQueryClient();

  // ── Dialog / form state ───────────────────────────────────────────────
  const [qpStarting, setQpStarting] = useState(false);
  const [qpStep, setQpStep] = useState<1 | 2>(1);
  const [qpPendingFiles, setQpPendingFiles] = useState<QPStagedFile[]>([]);
  const [qpSendConfirm, setQpSendConfirm] = useState(false);
  const [qpSending, setQpSending] = useState(false);
  const [qpConfirmAmt, setQpConfirmAmt] = useState("");
  const [qpConfirmRem, setQpConfirmRem] = useState("");
  const [qpProofFile, setQpProofFile] = useState<QPStagedFile | null>(null);
  const [qpConfirming, setQpConfirming] = useState(false);
  const [qpProxyFile, setQpProxyFile] = useState<File | null>(null);
  const [qpProxyDialog, setQpProxyDialog] = useState(false);
  const [qpProxySaving, setQpProxySaving] = useState(false);
  const [qpEditingRemarks, setQpEditingRemarks] = useState(false);
  const [qpRemarksText, setQpRemarksText] = useState("");
  const [qpRemarksSaving, setQpRemarksSaving] = useState(false);
  const qpInfoRef = useRef<HTMLInputElement>(null);
  const qpProofRef = useRef<HTMLInputElement>(null);
  const qpProxyRef = useRef<HTMLInputElement>(null);

  // ── Queries ───────────────────────────────────────────────────────────
  const { data: qpDetail, refetch: refetchQp } = useQuery({
    queryKey: ["crm-sales-deed-qp-by-booking", detail ? String(detail.BookingId) : ""],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/query-payment/booking/${detail?.BookingId}`);
      if (!r.ok) return null;
      const row = await r.json();
      if (!row) return null;
      const r2 = await fetchWithAuth(`${API}/query-payment/${row.Id}`);
      if (!r2.ok) return row;
      return r2.json();
    },
    enabled: !!detail?.BookingId,
    staleTime: 15_000,
  });

  const { data: qpEligibleBookings = [] } = useQuery({
    queryKey: ["crm-sales-deed-qp-eligible"],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/query-payment/eligible-bookings`);
      if (!r.ok) return [];
      return r.json();
    },
    staleTime: 60_000,
  });

  // ── Derived values ────────────────────────────────────────────────────
  const qpStartEligible = detail?.BookingId
    ? (qpEligibleBookings as any[]).some((b: any) => String(b.Id) === String(detail.BookingId))
    : false;
  const qpInfoAttachments = (qpDetail?.attachments || []).filter((a: any) => a.DocType === "Info");
  const qpProofAttachments = (qpDetail?.attachments || []).filter((a: any) => a.DocType === "Proof");
  const qpConfirmed = qpDetail?.Status === "Confirmed";
  const canConfirmQueryPayment =
    CRM_REGISTRY_APPROVER_ROLES.includes(String(currentUser?.role || "").toLowerCase()) ||
    canDoAction("approval-inbox" as any, "edit");

  // Reset per-session UI state when the selected QP record changes
  useEffect(() => {
    if (!qpDetail) return;
    setQpStep(qpDetail.Status === CrmStatus.PENDING ? 1 : 2);
    setQpPendingFiles([]); setQpProofFile(null); setQpSendConfirm(false); setQpEditingRemarks(false);
  }, [qpDetail?.Id]);

  const invalidateQp = () => {
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-qp-by-booking"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-qp-eligible"] });
    refetchQp();
  };

  // ── File staging helper ───────────────────────────────────────────────
  const qpStageFiles = async (files: FileList | null, multi = true) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    const big = arr.find((f) => f.size > QP_MAX_FILE);
    if (big) { toast.error(`${big.name} is too large (max 4 MB)`); return; }
    const total = qpPendingFiles.reduce((s, f) => s + f.size, 0) + arr.reduce((s, f) => s + f.size, 0);
    if (total > QP_MAX_TOTAL) { toast.error("Total files can't exceed 6 MB"); return; }
    try {
      const staged = await Promise.all(arr.map(qpFileToStaged));
      if (multi) setQpPendingFiles((p) => [...p, ...staged]);
      else setQpProofFile(staged[0]);
    } catch { toast.error("Failed to read file"); }
  };

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleStartQp = async () => {
    if (!detail?.BookingId) return;
    setQpStarting(true);
    try {
      const res = await fetchWithAuth(`${API}/query-payment`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ BookingId: detail.BookingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`${data.QPNo} started`);
      onQpChange(); invalidateQp();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setQpStarting(false); }
  };

  const handleQpSendInfo = async () => {
    if (!qpDetail?.Id || !qpPendingFiles.length) return;
    setQpSending(true);
    try {
      const res = await fetchWithAuth(`${API}/query-payment/${qpDetail.Id}/info`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: qpPendingFiles.map((f) => ({ fileName: f.name, mimeType: f.type, base64: f.base64 })) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Payment details sent to customer");
      setQpPendingFiles([]); setQpSendConfirm(false);
      invalidateQp(); onQpChange();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setQpSending(false); }
  };

  const handleQpConfirm = async () => {
    if (!qpDetail?.Id) return;
    setQpConfirming(true);
    try {
      const res = await fetchWithAuth(`${API}/query-payment/${qpDetail.Id}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ConfirmedAmount: qpConfirmAmt || undefined,
          Remarks: qpConfirmRem || undefined,
          proof: qpProofFile ? { fileName: qpProofFile.name, mimeType: qpProofFile.type, base64: qpProofFile.base64 } : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Government payment confirmed");
      setQpConfirmAmt(""); setQpConfirmRem(""); setQpProofFile(null);
      invalidateQp(); onQpChange();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setQpConfirming(false); }
  };

  const handleQpSaveRemarks = async () => {
    if (!qpDetail?.Id) return;
    setQpRemarksSaving(true);
    try {
      const res = await fetchWithAuth(`${API}/query-payment/${qpDetail.Id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Remarks: qpRemarksText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Remarks saved");
      setQpEditingRemarks(false);
      invalidateQp();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setQpRemarksSaving(false); }
  };

  const handleQpProxyProof = async (method: ProxyMethod, remarks: string) => {
    if (!qpDetail?.Id || !qpProxyFile) return;
    setQpProxySaving(true);
    try {
      const fd = new FormData();
      fd.append("file", qpProxyFile);
      fd.append("ProxyMethod", method);
      fd.append("ProxyRemarks", remarks);
      const res = await fetchWithAuth(`${API}/query-payment/${qpDetail.Id}/proxy-proof`, { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Proof uploaded on customer's behalf");
      setQpProxyDialog(false); setQpProxyFile(null);
      if (qpProxyRef.current) qpProxyRef.current.value = "";
      invalidateQp();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setQpProxySaving(false); }
  };

  const qpOpenAttachment = async (a: any) => {
    try {
      const res = await fetchWithAuth(`${API}/query-payment/attachment/${a.AttachmentId}`);
      if (!res.ok) throw new Error("Failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) { const anchor = document.createElement("a"); anchor.href = url; anchor.download = a.FileName; anchor.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch { toast.error("Could not open attachment"); }
  };

  return {
    // state
    qpStarting, qpStep, setQpStep,
    qpPendingFiles, setQpPendingFiles,
    qpSendConfirm, setQpSendConfirm,
    qpSending, qpConfirmAmt, setQpConfirmAmt,
    qpConfirmRem, setQpConfirmRem,
    qpProofFile, setQpProofFile,
    qpConfirming, qpProxyFile, setQpProxyFile,
    qpProxyDialog, setQpProxyDialog,
    qpProxySaving, qpEditingRemarks, setQpEditingRemarks,
    qpRemarksText, setQpRemarksText,
    qpRemarksSaving,
    qpInfoRef, qpProofRef, qpProxyRef,
    // data
    qpDetail, qpStartEligible,
    qpInfoAttachments, qpProofAttachments,
    qpConfirmed, canConfirmQueryPayment,
    // handlers
    invalidateQp, qpStageFiles,
    handleStartQp, handleQpSendInfo, handleQpConfirm,
    handleQpSaveRemarks, handleQpProxyProof,
    qpOpenAttachment,
  };
}
