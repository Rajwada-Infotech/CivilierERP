// The deed's Query Payment tab: the stamp duty and registration fee sent to the customer, then confirmed paid.
// Formerly its own page; now scoped to the deed's booking.
import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CrmStatus } from "@/constants/crmStatuses";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { translateError } from "@/lib/translateError";
import { FileText, Pencil, Send, Upload, X } from "lucide-react";
import { SheetMark } from "@/components/sheet/Sheet";
import { fmtRupees } from "@/components/crm/FinancialStatusBar";
import { ProxyActionDialog, type ProxyMethod } from "@/components/crm/ProxyActionDialog";
import { INP, KEY_INK, KEY_LINE, LBL, RULE, RULE_SOFT } from "../customers/config";
import { API, deedTone, fmtDate } from "./config";
import { AutoStep, Panel } from "./parts";

/** The booking's Query Payment with its attachments, or null. Shared with the page (its timeline badge). */
export function useDeedQueryPayment(bookingId: number | null | undefined) {
  return useQuery({
    queryKey: ["crm-sales-deed-qp-by-booking", bookingId != null ? String(bookingId) : ""],
    queryFn: async () => {
      const r = await fetchWithAuth(`${API}/query-payment/booking/${bookingId}`);
      if (!r.ok) return null;
      const row = await r.json();
      if (!row) return null;
      const r2 = await fetchWithAuth(`${API}/query-payment/${row.Id}`);
      return r2.ok ? r2.json() : row;
    },
    enabled: bookingId != null,
    staleTime: 15_000,
  });
}

interface StagedFile { name: string; size: number; type: string; base64: string }
const toStaged = (f: File): Promise<StagedFile> => new Promise((res, rej) => {
  const r = new FileReader(); r.onerror = () => rej(r.error);
  r.onload = () => { const uri = r.result as string; res({ name: f.name, size: f.size, type: f.type, base64: uri.slice(uri.indexOf(",") + 1) }); };
  r.readAsDataURL(f);
});
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TOTAL = 6 * 1024 * 1024;

export function QueryPaymentTab({ detail, canCreate, canEdit, canConfirm, onChanged }: {
  detail: any; canCreate: boolean; canEdit: boolean; canConfirm: boolean; onChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: qp, refetch } = useDeedQueryPayment(detail.BookingId);
  const { data: eligible = [] } = useQuery({
    queryKey: ["crm-sales-deed-qp-eligible"],
    queryFn: async () => { const r = await fetchWithAuth(`${API}/query-payment/eligible-bookings`); return r.ok ? r.json() : []; },
    staleTime: 60_000,
  });
  const startEligible = (eligible as any[]).some((b: any) => String(b.Id) === String(detail.BookingId));

  const [starting, setStarting] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [pending, setPending] = useState<StagedFile[]>([]);
  const [sendConfirm, setSendConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmAmt, setConfirmAmt] = useState("");
  const [confirmRem, setConfirmRem] = useState("");
  const [proof, setProof] = useState<StagedFile | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [proxyFile, setProxyFile] = useState<File | null>(null);
  const [proxyDialog, setProxyDialog] = useState(false);
  const [proxySaving, setProxySaving] = useState(false);
  const [editingRemarks, setEditingRemarks] = useState(false);
  const [remarksText, setRemarksText] = useState("");
  const [remarksSaving, setRemarksSaving] = useState(false);
  const infoRef = useRef<HTMLInputElement>(null);
  const proofRef = useRef<HTMLInputElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!qp) return;
    setStep(qp.Status === CrmStatus.PENDING ? 1 : 2);
    setPending([]); setProof(null); setSendConfirm(false); setEditingRemarks(false);
  }, [qp?.Id]);

  const infoFiles = (qp?.attachments || []).filter((a: any) => a.DocType === "Info");
  const proofFiles = (qp?.attachments || []).filter((a: any) => a.DocType === "Proof");
  const confirmed = qp?.Status === "Confirmed";

  const changed = (alsoPage = false) => {
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-qp-by-booking"] });
    qc.invalidateQueries({ queryKey: ["crm-sales-deed-qp-eligible"] });
    refetch();
    if (alsoPage) onChanged();
  };

  const stage = async (files: FileList | null, multi = true) => {
    if (!files?.length) return;
    const arr = Array.from(files);
    const big = arr.find((f) => f.size > MAX_FILE);
    if (big) { toast.error(`${big.name} is too large (max 4 MB)`); return; }
    const total = pending.reduce((s, f) => s + f.size, 0) + arr.reduce((s, f) => s + f.size, 0);
    if (total > MAX_TOTAL) { toast.error("Total files can't exceed 6 MB"); return; }
    try {
      const staged = await Promise.all(arr.map(toStaged));
      if (multi) setPending((p) => [...p, ...staged]); else setProof(staged[0]);
    } catch { toast.error("Failed to read file"); }
  };

  const post = async (url: string, body?: any, method = "POST") => {
    const res = await fetchWithAuth(url, body instanceof FormData ? { method, body } : {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      const data = await post(`${API}/query-payment`, { BookingId: detail.BookingId });
      toast.success(`${data.QPNo} started`);
      changed(true);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setStarting(false); }
  };
  const handleSendInfo = async () => {
    if (!qp?.Id || !pending.length) return;
    setSending(true);
    try {
      await post(`${API}/query-payment/${qp.Id}/info`, { files: pending.map((f) => ({ fileName: f.name, mimeType: f.type, base64: f.base64 })) });
      toast.success("Payment details sent to customer");
      setPending([]); setSendConfirm(false);
      changed(true);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setSending(false); }
  };
  const handleConfirm = async () => {
    if (!qp?.Id) return;
    setConfirming(true);
    try {
      await post(`${API}/query-payment/${qp.Id}/confirm`, {
        ConfirmedAmount: confirmAmt || undefined,
        Remarks: confirmRem || undefined,
        proof: proof ? { fileName: proof.name, mimeType: proof.type, base64: proof.base64 } : undefined,
      });
      toast.success("Government payment confirmed");
      setConfirmAmt(""); setConfirmRem(""); setProof(null);
      changed(true);
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setConfirming(false); }
  };
  const handleSaveRemarks = async () => {
    if (!qp?.Id) return;
    setRemarksSaving(true);
    try {
      await post(`${API}/query-payment/${qp.Id}`, { Remarks: remarksText }, "PUT");
      toast.success("Remarks saved");
      setEditingRemarks(false);
      changed();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setRemarksSaving(false); }
  };
  const handleProxyProof = async (method: ProxyMethod, remarks: string) => {
    if (!qp?.Id || !proxyFile) return;
    setProxySaving(true);
    try {
      const fd = new FormData(); fd.append("file", proxyFile); fd.append("ProxyMethod", method); fd.append("ProxyRemarks", remarks);
      await post(`${API}/query-payment/${qp.Id}/proxy-proof`, fd);
      toast.success("Proof uploaded on customer's behalf");
      setProxyDialog(false); setProxyFile(null);
      if (proxyRef.current) proxyRef.current.value = "";
      changed();
    } catch (e: any) { toast.error(translateError(e.message)); }
    finally { setProxySaving(false); }
  };
  const openAttachment = async (a: any) => {
    try {
      const res = await fetchWithAuth(`${API}/query-payment/attachment/${a.AttachmentId}`);
      if (!res.ok) throw new Error("Failed");
      const url = URL.createObjectURL(await res.blob());
      const win = window.open(url, "_blank");
      if (!win) { const anchor = document.createElement("a"); anchor.href = url; anchor.download = a.FileName; anchor.click(); }
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch { toast.error("Could not open attachment"); }
  };

  const fileList = (list: any[]) => (
    <div style={{ border: RULE_SOFT }}>
      {list.map((a: any) => (
        <button key={a.AttachmentId} onClick={() => openAttachment(a)} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[0.6875rem] hover:bg-primary/5 text-left" style={{ borderBottom: RULE_SOFT }}>
          <FileText size={12} className="shrink-0" /><span className="truncate flex-1">{a.FileName}</span>
        </button>
      ))}
    </div>
  );

  return (
    <Panel title="Stamp duty & registration fee" right={qp?.Status ? <SheetMark text={qp.Status} tone={deedTone(qp.Status)} /> : undefined}>
      <div className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">Communicate the government fee to the customer, then confirm once it's paid at the Sub-Registrar.</p>
        <AutoStep n={1} label="Stamp duty payment" done={confirmed} isLast>
          {!qp && (
            <div className="mt-1">
              {detail.DirectorApprovalStatus !== CrmStatus.APPROVED ? (
                <p className="text-xs text-muted-foreground">Unlocks once Director approval (on the Legal & Approval tab) is complete.</p>
              ) : canCreate ? (
                <button onClick={handleStart} disabled={starting || !startEligible} className={`${KEY_INK} h-8 px-3`}>
                  {starting ? "Starting…" : "Start query payment"}
                </button>
              ) : <p className="text-xs text-muted-foreground">Not started yet.</p>}
            </div>
          )}

          {qp && (
            <div className="mt-2 space-y-3">
              {(() => {
                const stamp = Number(qp.StampDuty || 0);
                const reg = Number(qp.RegistrationFee || 0);
                const credit = Number(qp.StampDutyCredit || 0);
                const net = Number(qp.RequiredAmount || 0);
                if (!stamp && !reg) return null;
                const cells: [string, string, boolean][] = [
                  ["Stamp duty", fmtRupees(stamp), false],
                  ["Reg. fee", fmtRupees(reg), false],
                  ...(credit > 0 ? [["AFS credit", "− " + fmtRupees(credit), false] as [string, string, boolean]] : []),
                  ["Net payable", fmtRupees(net), true],
                ];
                return (
                  <div className="grid grid-cols-2 lg:grid-cols-4" style={{ border: RULE }}>
                    {cells.map(([l, v, strong]) => (
                      <div key={l} className={`px-3 py-2 ${strong ? "bg-foreground text-card" : ""}`} style={{ borderRight: RULE_SOFT }}>
                        <p className={`${LBL} ${strong ? "!text-card/80" : ""}`}>{l}</p>
                        <p className="font-heading font-semibold tabular-nums text-sm mt-0.5">{v}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {editingRemarks ? (
                <div className="p-2.5 space-y-1.5" style={{ border: RULE }}>
                  <input autoFocus value={remarksText} onChange={(e) => setRemarksText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSaveRemarks(); if (e.key === "Escape") setEditingRemarks(false); }}
                    className={INP} placeholder="Optional note…" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingRemarks(false)} disabled={remarksSaving} className={`${KEY_LINE} h-7 px-2`}>Cancel</button>
                    <button onClick={handleSaveRemarks} disabled={remarksSaving} className={`${KEY_INK} h-7 px-2`}>{remarksSaving ? "Saving…" : "Save"}</button>
                  </div>
                </div>
              ) : qp.Remarks ? (
                <div className="flex items-start gap-2 text-[0.6875rem] text-muted-foreground italic px-2.5 py-1.5" style={{ border: RULE_SOFT }}>
                  <span className="flex-1">"{qp.Remarks}"</span>
                  {canEdit && qp.Status === CrmStatus.PENDING && <button onClick={() => { setRemarksText(qp.Remarks || ""); setEditingRemarks(true); }} className="hover:text-foreground shrink-0"><Pencil size={10} /></button>}
                </div>
              ) : canEdit && qp.Status === CrmStatus.PENDING ? (
                <button onClick={() => { setRemarksText(""); setEditingRemarks(true); }} className={`${KEY_LINE} h-7 px-2`}><Pencil size={9} /> Add remarks</button>
              ) : null}

              {confirmed ? (
                <div className="space-y-2">
                  <div className="px-3 py-2.5" style={{ border: RULE, borderLeft: "3px solid hsl(var(--foreground))" }}>
                    <p className="text-xs font-semibold">Government payment confirmed</p>
                    <p className="text-[0.6875rem] text-muted-foreground mt-0.5 tabular-nums">{fmtDate(qp.ConfirmedAt)}{qp.ConfirmedAmount ? ` · ${fmtRupees(qp.ConfirmedAmount)} paid` : ""}</p>
                  </div>
                  {proofFiles.length > 0 && <div className="space-y-1"><p className={LBL}>Payment proof</p>{fileList(proofFiles)}</div>}
                  {infoFiles.length > 0 && <div className="space-y-1"><p className={LBL}>Sent to customer</p>{fileList(infoFiles)}</div>}
                </div>
              ) : (
                <>
                  {step === 1 && (
                    <div className="p-2.5 space-y-2" style={{ border: RULE_SOFT }}>
                      <p className={LBL}>1 · Send fee details to customer</p>
                      {infoFiles.length > 0 && fileList(infoFiles)}
                      {pending.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1 text-[0.6875rem]" style={{ border: RULE_SOFT }}>
                          <span className="truncate flex-1 font-medium">{f.name}</span>
                          <button onClick={() => setPending((p) => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><X size={10} /></button>
                        </div>
                      ))}
                      <input type="file" multiple ref={infoRef} className="hidden" onChange={(e) => { stage(e.target.files); e.target.value = ""; }} />
                      {!canEdit ? null : !sendConfirm ? (
                        <div className="flex items-center gap-2">
                          <button onClick={() => infoRef.current?.click()} className={`${KEY_LINE} h-7 px-2 !border-dashed`}><Upload size={10} /> Attach files</button>
                          {pending.length > 0 && <button onClick={() => setSendConfirm(true)} className={`${KEY_INK} h-7 px-2`}><Send size={10} /> Send ({pending.length})</button>}
                        </div>
                      ) : (
                        <div className="px-2.5 py-1.5 flex items-center justify-between gap-2" style={{ border: RULE }}>
                          <p className="text-[0.6875rem] text-muted-foreground">Send {pending.length} file{pending.length === 1 ? "" : "s"} to the customer?</p>
                          <div className="flex gap-1.5">
                            <button onClick={() => setSendConfirm(false)} disabled={sending} className={`${KEY_LINE} h-7 px-2`}>Cancel</button>
                            <button onClick={handleSendInfo} disabled={sending} className={`${KEY_INK} h-7 px-2`}>{sending ? "Sending…" : "Confirm send"}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(step === 2 || qp.Status === "InfoSent") && (
                    <div className="p-2.5 space-y-2" style={{ border: RULE_SOFT }}>
                      <div className="flex items-center justify-between">
                        <p className={LBL}>2 · Confirm customer paid</p>
                        {step === 1 && <button onClick={() => setStep(2)} className={`${KEY_LINE} h-7 px-2`}>Open</button>}
                      </div>
                      {step === 2 && (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <input type="number" className={`${INP} tabular-nums`} placeholder={qp.RequiredAmount ? String(qp.RequiredAmount) : "Amount paid"} value={confirmAmt} onChange={(e) => setConfirmAmt(e.target.value)} />
                            <input className={INP} placeholder="Remarks (optional)" value={confirmRem} onChange={(e) => setConfirmRem(e.target.value)} />
                          </div>
                          {proof ? (
                            <div className="flex items-center gap-2 text-[0.6875rem] px-2 py-1.5" style={{ border: RULE_SOFT }}>
                              <span className="truncate flex-1">{proof.name}</span>
                              <button onClick={() => { setProof(null); if (proofRef.current) proofRef.current.value = ""; }} className="text-muted-foreground hover:text-destructive"><X size={10} /></button>
                            </div>
                          ) : (
                            <>
                              <input type="file" ref={proofRef} className="hidden" onChange={(e) => stage(e.target.files, false)} />
                              <button onClick={() => proofRef.current?.click()} className={`${KEY_LINE} h-8 w-full !border-dashed`}><Upload size={10} /> Attach receipt / challan</button>
                            </>
                          )}
                          {canEdit && qp.Status === "InfoSent" && (
                            <div className="px-2.5 py-2 space-y-1.5" style={{ border: RULE_SOFT }}>
                              <p className={LBL}>Customer not on the portal?</p>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <input type="file" ref={proxyRef} className="hidden" onChange={(e) => setProxyFile(e.target.files?.[0] || null)} />
                                <button onClick={() => proxyRef.current?.click()} className={`${KEY_LINE} h-7 px-2 max-w-[14rem]`}><Upload size={9} /> <span className="truncate normal-case tracking-normal">{proxyFile ? proxyFile.name : "Select their proof…"}</span></button>
                                <button onClick={() => proxyFile && setProxyDialog(true)} disabled={!proxyFile} className={`${KEY_INK} h-7 px-2`}>Upload on their behalf</button>
                              </div>
                            </div>
                          )}
                          {canConfirm ? (
                            <button onClick={handleConfirm} disabled={confirming} className={`${KEY_INK} h-9 w-full`}>{confirming ? "Confirming…" : "Confirm — government fees paid"}</button>
                          ) : (
                            <p className="text-[0.6875rem] text-muted-foreground px-2 py-1.5" style={{ border: RULE_SOFT }}>Confirmation needs the Legal head or a CRM administrator.</p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </AutoStep>
      </div>
      {proxyDialog && (
        <ProxyActionDialog
          title="Upload Proof on Customer's Behalf — Query Payment"
          description="Staff uploading the government payment receipt the customer provided."
          confirmLabel="Submit Proof"
          saving={proxySaving}
          onClose={() => setProxyDialog(false)}
          onConfirm={handleProxyProof}
        />
      )}
    </Panel>
  );
}
