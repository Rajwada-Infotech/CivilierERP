import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SalesAutoShell } from "@/components/sa/SalesAutoShell";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Plus, Search, FileText, Upload } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSearchParams } from "react-router-dom";
import { ApprovalActions } from "@/components/ApprovalActions";

const API = "/api/crm/agreements";
const BKG_API = "/api/crm/bookings";

const DOC_TYPES = ["SaleAgreement", "AllotmentLetter", "PossessionLetter", "RegistrationDoc", "NOC", "IdentityProof", "Other"];
const DOC_STATUSES = ["Pending", "Uploaded", "Verified", "Rejected"];

const agrStatusColor: Record<string, string> = {
  Draft:      "text-muted-foreground bg-muted/50 border-border",
  Executed:   "text-blue-600 bg-blue-50 border-blue-200",
  Registered: "text-green-600 bg-green-50 border-green-200",
  Cancelled:  "text-red-600 bg-red-50 border-red-200",
};
const docStatusColor: Record<string, string> = {
  Pending:  "text-orange-600 bg-orange-50 border-orange-200",
  Uploaded: "text-blue-600 bg-blue-50 border-blue-200",
  Verified: "text-green-600 bg-green-50 border-green-200",
  Rejected: "text-red-600 bg-red-50 border-red-200",
};

const EMPTY_AGR_FORM = {
  BookingId: "", AgreementDate: "", LegalName: "", LegalAddress: "",
  PanNo: "", AadhaarNo: "", Notes: "",
};
const EMPTY_DOC_FORM = {
  DocumentType: "SaleAgreement", DocumentUrl: "", FileName: "", IssuedBy: "", Remarks: "",
};

async function fetchAgreements(): Promise<any[]> {
  try { const r = await fetchWithAuth(API); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchAgreementDetail(id: number): Promise<any> {
  const r = await fetchWithAuth(`${API}/${id}`);
  if (!r.ok) throw new Error("Failed to load agreement");
  return r.json();
}
async function fetchDateHistory(id: number): Promise<any[]> {
  try { const r = await fetchWithAuth(`${API}/${id}/date-history`); return r.ok ? r.json() : []; } catch { return []; }
}
async function fetchBookings(): Promise<any[]> {
  try { const r = await fetchWithAuth(BKG_API); return r.ok ? r.json() : []; } catch { return []; }
}

const CrmAgreement: React.FC = () => {
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const bkgFilter = sp.get("bookingId") || "";
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [agrDialog, setAgrDialog] = useState(false);
  const [docDialog, setDocDialog] = useState(false);
  const [agrForm, setAgrForm] = useState({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
  const [docForm, setDocForm] = useState({ ...EMPTY_DOC_FORM });
  const [saving, setSaving] = useState(false);

  const { data: agreements = [], isLoading } = useQuery({ queryKey: ["crm-agreements"], queryFn: fetchAgreements, staleTime: 60_000 });
  const { data: detail } = useQuery({
    queryKey: ["crm-agreement-detail", selectedId],
    queryFn: () => fetchAgreementDetail(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  });
  const { data: bookings = [] } = useQuery({ queryKey: ["crm-bookings"], queryFn: fetchBookings, staleTime: 5 * 60_000 });
  const { data: dateHistory = [] } = useQuery({
    queryKey: ["crm-agreement-date-history", selectedId],
    queryFn: () => fetchDateHistory(selectedId!),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const filtered = useMemo(() =>
    (agreements as any[]).filter((a: any) =>
      !search || a.ApplicantName?.toLowerCase().includes(search.toLowerCase())
        || a.AgreementNo?.includes(search) || a.BookingNo?.includes(search)
    ), [agreements, search]);

  const handleSaveAgreement = async () => {
    if (!agrForm.BookingId) { toast.error("Booking is required"); return; }
    setSaving(true);
    try {
      const res = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...agrForm,
          BookingId: parseInt(agrForm.BookingId),
          AgreementDate: agrForm.AgreementDate || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create agreement");
      toast.success(`Agreement ${data.AgreementNo} created`);
      setAgrDialog(false);
      setAgrForm({ ...EMPTY_AGR_FORM, BookingId: bkgFilter });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddDocument = async () => {
    if (!selectedId) return;
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
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDocStatusChange = async (docId: number, status: string) => {
    if (!selectedId) return;
    try {
      await fetchWithAuth(`${API}/${selectedId}/documents/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ Status: status }),
      });
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSendToCustomer = async () => {
    if (!selectedId) return;
    const proposedDate = window.prompt("Proposed agreement date (YYYY-MM-DD), optional:") || "";
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/send-to-customer`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposedDate: proposedDate || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Agreement sent to customer portal");
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreement-date-history", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAgreementAction = async (action: "mark-executed" | "mark-registered" | "cancel") => {
    if (!selectedId) return;
    try {
      const res = await fetchWithAuth(`${API}/${selectedId}/${action}`, { method: "PUT" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`Agreement marked ${data.status}`);
      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <SalesAutoShell
      title="CRM — Agreements"
      subtitle="Sale agreements and legal documents"
      action={
        <button onClick={() => setAgrDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90">
          <Plus size={14} /> New Agreement
        </button>
      }
    >
      <div className="flex gap-4 h-[calc(100vh-220px)]">
        {/* List */}
        <div className="w-80 shrink-0 flex flex-col gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agreements..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground text-sm">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">No agreements found</div>
            ) : (filtered as any[]).map((a: any) => (
              <button key={a.Id} onClick={() => setSelectedId(a.Id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedId === a.Id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{a.ApplicantName}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${agrStatusColor[a.Status] || ""}`}>{a.Status}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 font-mono">{a.AgreementNo}</div>
                <div className="text-xs text-muted-foreground">{a.BookingNo} · {a.UnitNo}</div>
                <div className="text-xs text-muted-foreground">{a.DocumentCount || 0} document(s)</div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              Select an agreement to view details
            </div>
          ) : !detail ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
          ) : (
            <>
              {/* Agreement Info */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-foreground">{detail.agreement?.ApplicantName}</h2>
                    <p className="text-xs font-mono text-muted-foreground">{detail.agreement?.AgreementNo}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${agrStatusColor[detail.agreement?.Status] || ""}`}>
                      {detail.agreement?.Status}
                    </span>
                    {detail.agreement?.Status === "Draft" && (
                      <button onClick={() => handleAgreementAction("mark-executed")}
                        className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted">
                        Mark Executed
                      </button>
                    )}
                    {detail.agreement?.Status === "Executed" && (
                      <button onClick={() => handleAgreementAction("mark-registered")}
                        className="text-xs px-2 py-0.5 border border-border rounded-full text-muted-foreground hover:bg-muted">
                        Mark Registered
                      </button>
                    )}
                    {(detail.agreement?.Status === "Draft" || detail.agreement?.Status === "Executed") && (
                      <button onClick={() => { if (window.confirm("Cancel this agreement?")) handleAgreementAction("cancel"); }}
                        className="text-xs px-2 py-0.5 border border-border rounded-full text-red-600 hover:bg-red-50">
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {[
                    ["Booking No",    detail.agreement?.BookingNo],
                    ["Unit",          detail.agreement?.UnitNo],
                    ["Project",       detail.agreement?.ProjectName || "—"],
                    ["Total Value",   detail.agreement?.TotalValue ? `₹${Number(detail.agreement.TotalValue).toLocaleString("en-IN")}` : "—"],
                    ["Agreement Date",detail.agreement?.AgreementDate ? String(detail.agreement.AgreementDate).slice(0, 10) : "—"],
                    ["Legal Name",    detail.agreement?.LegalName || "—"],
                    ["PAN",           detail.agreement?.PanNo || "—"],
                    ["Aadhaar",       detail.agreement?.AadhaarNo || "—"],
                  ].map(([k, v]) => (
                    <div key={k}><span className="text-xs text-muted-foreground">{k}: </span><span className="font-medium">{v}</span></div>
                  ))}
                </div>
                {detail.agreement?.LegalAddress && (
                  <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">{detail.agreement.LegalAddress}</div>
                )}
              </div>

              {/* Approval Workflow */}
              <div className="rounded-xl border border-border p-4 space-y-3">
                <h3 className="text-sm font-semibold">Approval Workflow</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">Senior Approval</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      detail.agreement?.SeniorApprovalStatus === "Approved" ? "text-green-600 bg-green-50 border-green-200"
                      : detail.agreement?.SeniorApprovalStatus === "Rejected" ? "text-red-600 bg-red-50 border-red-200"
                      : "text-orange-600 bg-orange-50 border-orange-200"}`}>
                      {detail.agreement?.SeniorApprovalStatus || "Pending"}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block mb-1">Customer Approval</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      detail.agreement?.CustomerApprovalStatus === "Approved" ? "text-green-600 bg-green-50 border-green-200"
                      : detail.agreement?.CustomerApprovalStatus === "RecheckRequested" ? "text-red-600 bg-red-50 border-red-200"
                      : "text-orange-600 bg-orange-50 border-orange-200"}`}>
                      {detail.agreement?.CustomerApprovalStatus || "Pending"}
                    </span>
                  </div>
                  <div><span className="text-xs text-muted-foreground">Proposed Date (Company): </span>{detail.agreement?.ProposedDateByCompany ? String(detail.agreement.ProposedDateByCompany).slice(0,10) : "—"}</div>
                  <div><span className="text-xs text-muted-foreground">Proposed Date (Customer): </span>{detail.agreement?.ProposedDateByCustomer ? String(detail.agreement.ProposedDateByCustomer).slice(0,10) : "—"}</div>
                </div>
                {dateHistory.length > 0 && (
                  <div className="text-xs">
                    <div className="text-muted-foreground mb-1">Reschedule History</div>
                    <div className="space-y-1">
                      {(dateHistory as any[]).map((h) => (
                        <div key={h.Id} className="flex items-center gap-2 text-muted-foreground">
                          <span className={`px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${h.ProposedBy === "Company" ? "text-purple-600 bg-purple-50 border-purple-200" : "text-blue-600 bg-blue-50 border-blue-200"}`}>
                            {h.ProposedBy}
                          </span>
                          <span>proposed {String(h.ProposedDate).slice(0,10)}</span>
                          <span className="text-[10px]">({String(h.CreatedAt).slice(0,16).replace("T"," ")}{h.CreatedByName ? ` · ${h.CreatedByName}` : ""})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {detail.agreement?.RecheckCount > 0 && (
                  <div className="text-xs bg-red-50 border border-red-200 rounded p-2 text-red-700">
                    Rechecked {detail.agreement.RecheckCount}x — latest remark: {detail.agreement.LastRecheckRemarks || "—"}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap items-center">
                  {/* submitOnly: senior Approve/Reject only ever happen from the
                      Admin Approval Inbox (admin/super_admin/dba) — no self-approve here */}
                  <ApprovalActions
                    status={detail.agreement?.SeniorApprovalStatus}
                    recordId={detail.agreement?.Id}
                    endpoint={API}
                    submitOnly
                    onSuccess={() => {
                      qc.invalidateQueries({ queryKey: ["crm-agreement-detail", selectedId] });
                      qc.invalidateQueries({ queryKey: ["crm-agreements"] });
                    }}
                  />
                  {detail.agreement?.SeniorApprovalStatus === "Pending" && (
                    <span className="text-xs text-muted-foreground">Pending admin approval</span>
                  )}
                  {detail.agreement?.SeniorApprovalStatus === "Approved" && !detail.agreement?.SentToCustomerAt && (
                    <button onClick={handleSendToCustomer}
                      className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                      Send to Customer Portal
                    </button>
                  )}
                  {detail.agreement?.CustomerApprovalStatus === "RecheckRequested" && detail.agreement?.SeniorApprovalStatus === "Approved" && (
                    <button onClick={handleSendToCustomer}
                      className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90">
                      Resend After Recheck
                    </button>
                  )}
                </div>
              </div>

              {/* Documents */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-muted/30 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Agreement Documents ({detail.documents?.length || 0})</h3>
                  <button onClick={() => setDocDialog(true)}
                    className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Upload size={12} /> Add Document
                  </button>
                </div>
                {!detail.documents?.length ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">No documents uploaded yet</div>
                ) : (detail.documents as any[]).map((d: any) => (
                  <div key={d.Id} className="px-4 py-3 border-b border-border last:border-0 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <FileText size={16} className="text-muted-foreground shrink-0" />
                      <div>
                        <div className="text-sm font-medium">{d.DocumentType.replace(/([A-Z])/g, " $1").trim()}</div>
                        {d.FileName && <div className="text-xs text-muted-foreground">{d.FileName}</div>}
                        {d.IssuedBy && <div className="text-xs text-muted-foreground">by {d.IssuedBy}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.DocumentUrl && (
                        <a href={d.DocumentUrl} target="_blank" rel="noreferrer"
                          className="text-xs text-primary hover:underline">View</a>
                      )}
                      <select value={d.Status} onChange={(e) => handleDocStatusChange(d.Id, e.target.value)}
                        className={`text-xs px-2 py-0.5 rounded-full border font-medium ${docStatusColor[d.Status] || ""} bg-transparent cursor-pointer`}>
                        {DOC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* New Agreement Dialog */}
      <Dialog open={agrDialog} onOpenChange={(o) => { if (!o) setAgrDialog(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-heading">New Agreement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Booking *</label>
              <select value={agrForm.BookingId} onChange={(e) => setAgrForm((f) => ({ ...f, BookingId: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select booking</option>
                {(bookings as any[]).map((b: any) => (
                  <option key={b.Id} value={String(b.Id)}>{b.BookingNo} — {b.ApplicantName}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: "LegalName",    label: "Legal Name",      type: "text" },
                { key: "AgreementDate",label: "Agreement Date",  type: "date" },
                { key: "PanNo",        label: "PAN No",          type: "text" },
                { key: "AadhaarNo",    label: "Aadhaar No",      type: "text" },
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                  <input type={type} value={agrForm[key as keyof typeof agrForm]}
                    onChange={(e) => setAgrForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              ))}
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Legal Address</label>
              <textarea value={agrForm.LegalAddress} onChange={(e) => setAgrForm((f) => ({ ...f, LegalAddress: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <textarea value={agrForm.Notes} onChange={(e) => setAgrForm((f) => ({ ...f, Notes: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setAgrDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleSaveAgreement} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Creating..." : "Create Agreement"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Document Dialog */}
      <Dialog open={docDialog} onOpenChange={(o) => { if (!o) setDocDialog(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="font-heading">Add Document</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Document Type *</label>
              <select value={docForm.DocumentType} onChange={(e) => setDocForm((f) => ({ ...f, DocumentType: e.target.value }))}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            {[
              { key: "FileName",   label: "File Name",    type: "text" },
              { key: "DocumentUrl",label: "Document URL", type: "text" },
              { key: "IssuedBy",   label: "Issued By",    type: "text" },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="text-xs text-muted-foreground block mb-1">{label}</label>
                <input type={type} value={docForm[key as keyof typeof docForm]}
                  onChange={(e) => setDocForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              </div>
            ))}
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Remarks</label>
              <textarea value={docForm.Remarks} onChange={(e) => setDocForm((f) => ({ ...f, Remarks: e.target.value }))}
                rows={2} className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background resize-none" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={() => setDocDialog(false)}
              className="px-3 py-1.5 text-sm border border-border rounded-lg text-muted-foreground hover:bg-muted">Cancel</button>
            <button onClick={handleAddDocument} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-40">
              {saving ? "Adding..." : "Add Document"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SalesAutoShell>
  );
};

export default CrmAgreement;
