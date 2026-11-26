import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { askLegal } from "@/components/legal/LegalAsk";
import { uploadLegalFile } from "@/api/legalMastersApi";
import { addDocument, getDocuments, updateDocument, verifyDocument, type Activity, type VDoc } from "@/api/legalVerificationApi";

const input = "h-9 w-full border border-foreground/30 bg-background px-2 text-sm focus:border-foreground focus:outline-none";
const lbl = "mb-1 block text-[0.625rem] uppercase tracking-[0.08em] text-muted-foreground";
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const TONE: Record<string, string> = { Verified: "text-emerald-700", Rejected: "text-destructive", "Not Reviewed": "text-amber-700" };

const pickFile = () => new Promise<{ id: number; fileName: string } | null>((resolve) => {
  const el = document.createElement("input");
  el.type = "file"; el.accept = "application/pdf,image/*";
  el.onchange = async () => {
    const file = el.files?.[0];
    if (!file) return resolve(null);
    try { resolve(await uploadLegalFile(file)); } catch (e) { toast.error((e as Error).message); resolve(null); }
  };
  el.click();
});

interface Form {
  docType: string; docNo: string; docDate: string; authority: string; ownerRef: string; dagRef: string; khatianRef: string; copyType: string;
  originalAvailable: string; originalHolder: string; condition: string; remarks: string; activityIds: string[];
}
const blank = (activityIds: string[] = []): Form => ({ docType: "", docNo: "", docDate: "", authority: "", ownerRef: "", dagRef: "", khatianRef: "", copyType: "Scan",
  originalAvailable: "", originalHolder: "", condition: "", remarks: "", activityIds });
const fromDoc = (d: VDoc): Form => ({ docType: d.DocType, docNo: d.DocNo ?? "", docDate: d.DocDate ?? "", authority: d.Authority ?? "", ownerRef: d.OwnerRef ?? "", dagRef: d.DagRef ?? "",
  khatianRef: d.KhatianRef ?? "", copyType: d.CopyType, originalAvailable: d.OriginalAvailable ?? "", originalHolder: d.OriginalHolder ?? "", condition: d.Condition ?? "", remarks: d.Remarks ?? "",
  activityIds: d.links.filter((l) => l.ActivityId).map((l) => String(l.ActivityId)) });

function DocForm({ title, initial, docTypes, copyTypes, activities, fileName, onCancel, onSave }: {
  title: string; initial: Form; docTypes: string[]; copyTypes: string[]; activities: Activity[]; fileName?: string; onCancel: () => void; onSave: (f: Form) => Promise<void>;
}) {
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: Exclude<keyof Form, "activityIds">, v: string) => setF((o) => ({ ...o, [k]: v }));
  const toggle = (id: string) => setF((o) => ({ ...o, activityIds: o.activityIds.includes(id) ? o.activityIds.filter((x) => x !== id) : [...o.activityIds, id] }));
  return (
    <div className="mb-3 border-2 border-foreground bg-background p-3">
      <p className="mb-2 text-xs font-semibold">{title}{fileName ? <span className="font-normal text-muted-foreground"> · {fileName}</span> : null}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label><span className={lbl}>Document type <span className="text-destructive">*</span></span>
          <select className={input} value={f.docType} onChange={(e) => set("docType", e.target.value)}><option value="">Select…</option>{docTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label><span className={lbl}>Original / copy</span>
          <select className={input} value={f.copyType} onChange={(e) => set("copyType", e.target.value)}>{copyTypes.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label><span className={lbl}>Document no.</span><input className={input} value={f.docNo} maxLength={80} onChange={(e) => set("docNo", e.target.value)} /></label>
        <label><span className={lbl}>Document date</span><input type="date" className={input} value={f.docDate} onChange={(e) => set("docDate", e.target.value)} /></label>
        <label><span className={lbl}>Registration office / authority</span><input className={input} value={f.authority} maxLength={200} onChange={(e) => set("authority", e.target.value)} /></label>
        <label><span className={lbl}>Owner / party</span><input className={input} value={f.ownerRef} maxLength={200} onChange={(e) => set("ownerRef", e.target.value)} /></label>
        <label><span className={lbl}>Dag</span><input className={input} value={f.dagRef} maxLength={200} onChange={(e) => set("dagRef", e.target.value)} /></label>
        <label><span className={lbl}>Khatian</span><input className={input} value={f.khatianRef} maxLength={200} onChange={(e) => set("khatianRef", e.target.value)} /></label>
        <label><span className={lbl}>Physical original available</span>
          <select className={input} value={f.originalAvailable} onChange={(e) => set("originalAvailable", e.target.value)}><option value="">—</option><option>Yes</option><option>No</option><option>Unknown</option></select></label>
        <label><span className={lbl}>Original held by</span><input className={input} value={f.originalHolder} maxLength={200} onChange={(e) => set("originalHolder", e.target.value)} /></label>
        <label><span className={lbl}>Condition</span>
          <select className={input} value={f.condition} onChange={(e) => set("condition", e.target.value)}><option value="">—</option><option>Good</option><option>Fair</option><option>Damaged</option></select></label>
        <label><span className={lbl}>Remarks</span><input className={input} value={f.remarks} maxLength={1000} onChange={(e) => set("remarks", e.target.value)} /></label>
      </div>
      <p className={`${lbl} mt-3`}>Linked activities</p>
      <div className="flex flex-wrap gap-1.5">
        {activities.map((a) => (
          <button key={a.ActivityId} type="button" aria-pressed={f.activityIds.includes(String(a.ActivityId))} onClick={() => toggle(String(a.ActivityId))}
            className={`h-7 border px-2 text-xs ${f.activityIds.includes(String(a.ActivityId)) ? "border-foreground bg-foreground text-background" : "border-foreground/30 text-muted-foreground"}`}>{a.ActivityRef}. {a.ActivityName}</button>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="h-8 border border-foreground/40 px-3 text-xs font-semibold uppercase">Cancel</button>
        <button disabled={busy} onClick={async () => { if (!f.docType) { toast.error("Choose the document type"); return; } setBusy(true); try { await onSave(f); } finally { setBusy(false); } }}
          className="h-8 bg-foreground px-4 text-xs font-semibold uppercase text-background disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

/**
 * The workspace's central document register: every document with its type, number, copy type, physical original,
 * links to activities, versions and verification. Uploading never verifies a document.
 */
export function VerificationDocumentsPanel({ verificationId, activities, canEdit, onlyActivityId }: { verificationId: number; activities: Activity[]; canEdit: boolean; onlyActivityId?: number }) {
  const qc = useQueryClient();
  const [showOld, setShowOld] = useState(false);
  const q = useQuery({ queryKey: ["legal-verification-docs", verificationId, showOld], queryFn: () => getDocuments(verificationId, showOld) });
  const [form, setForm] = useState<{ mode: "new"; fileId: number; fileName: string } | { mode: "edit"; doc: VDoc } | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["legal-verification-docs", verificationId] }); qc.invalidateQueries({ queryKey: ["legal-verification"] }); qc.invalidateQueries({ queryKey: ["legal-activity-history"] }); };
  const data = q.data;
  const docs = (data?.documents ?? []).filter((d) => !onlyActivityId || d.links.some((l) => l.ActivityId === onlyActivityId));
  const body = (f: Form) => ({ ...f, activityIds: f.activityIds.map(Number) });
  const run = async (fn: () => Promise<{ message: string }>) => { try { toast.success((await fn()).message); refresh(); } catch (e) { toast.error((e as Error).message); } };
  if (q.isLoading || !data) return <p className="text-xs text-muted-foreground">Loading…</p>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <b>{docs.length} document{docs.length === 1 ? "" : "s"}</b>
        <span className="text-amber-700">{docs.filter((d) => d.IsActive && d.VerifyStatus !== "Verified").length} not verified</span>
        {!onlyActivityId && <label className="ml-2 flex items-center gap-1"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> show replaced versions</label>}
        {canEdit && !form && <button className="ml-auto inline-flex h-8 items-center gap-1 border border-foreground px-3 font-semibold uppercase" onClick={async () => {
          const up = await pickFile(); if (up) setForm({ mode: "new", fileId: up.id, fileName: up.fileName });
        }}><Upload size={12} /> Add document</button>}
      </div>
      {form?.mode === "new" && <DocForm title="New document" initial={blank(onlyActivityId ? [String(onlyActivityId)] : [])} docTypes={data.docTypes} copyTypes={data.copyTypes} activities={activities}
        fileName={form.fileName} onCancel={() => setForm(null)} onSave={async (f) => { await run(() => addDocument(verificationId, { ...body(f), fileId: form.fileId })); setForm(null); }} />}
      {form?.mode === "edit" && <DocForm title={`Edit ${form.doc.DocType}`} initial={fromDoc(form.doc)} docTypes={data.docTypes} copyTypes={data.copyTypes} activities={activities}
        onCancel={() => setForm(null)} onSave={async (f) => { await run(() => updateDocument(form.doc.DocId, { ...body(f), updatedAt: form.doc.UpdatedAt })); setForm(null); }} />}
      {!docs.length ? <p className="text-xs text-muted-foreground">No documents yet.</p> : (
        <div className="overflow-x-auto border border-border">
          <table className="w-full min-w-[820px] text-left text-xs">
            <thead className="text-[0.625rem] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-2 py-1.5">Document</th><th className="px-2 py-1.5">No. / date</th><th className="px-2 py-1.5">Copy</th><th className="px-2 py-1.5">Original</th>
                <th className="px-2 py-1.5">Linked to</th><th className="px-2 py-1.5">Verification</th><th className="px-2 py-1.5">Uploaded</th><th /></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.DocId} className={`border-t border-border/60 align-top ${d.IsActive ? "" : "opacity-60"}`}>
                  <td className="px-2 py-1.5"><b>{d.DocType}</b> <span className="text-muted-foreground">v{d.VersionNo}{d.IsActive ? "" : " · replaced"}</span><br /><LegalFileLink id={d.FileId} name={d.FileName ?? "File"} /></td>
                  <td className="px-2 py-1.5">{d.DocNo ?? "—"}<br /><span className="text-muted-foreground">{fmt(d.DocDate)}{d.Authority ? ` · ${d.Authority}` : ""}</span></td>
                  <td className="px-2 py-1.5">{d.CopyType}</td>
                  <td className="px-2 py-1.5">{d.OriginalAvailable ?? "—"}{d.OriginalHolder ? ` · ${d.OriginalHolder}` : ""}{d.Condition ? ` · ${d.Condition}` : ""}</td>
                  <td className="px-2 py-1.5">{d.links.map((l) => l.ActivityId ? `${l.ActivityRef}. ${l.ActivityName}` : `${l.ActivityRef ?? ""} entry #${l.EntryId}`).join("; ") || "—"}</td>
                  <td className={`px-2 py-1.5 font-semibold ${TONE[d.VerifyStatus] ?? ""}`}>{d.VerifyStatus}
                    {d.VerifiedBy && <span className="block font-normal text-muted-foreground">{d.VerifiedBy} · {fmt(d.VerifiedAt)}</span>}
                    {d.RejectionReason && <span className="block font-normal text-destructive">{d.RejectionReason}</span>}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{d.UploadedBy ?? "—"}<br />{fmt(d.UploadedAt)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {d.IsActive && data.canVerify && d.VerifyStatus !== "Verified" && <button className="underline" onClick={() => run(() => verifyDocument(d.DocId, "Verified"))}>Verify</button>}
                    {d.IsActive && data.canVerify && d.VerifyStatus !== "Rejected" && <button className="ml-2 text-destructive underline" onClick={async () => {
                      const reason = await askLegal({ title: "Reject document?", input: { label: "Rejection reason", required: true }, confirmText: "Reject" });
                      if (reason) run(() => verifyDocument(d.DocId, "Rejected", reason));
                    }}>Reject</button>}
                    {d.IsActive && canEdit && <>
                      <button className="ml-2 underline" onClick={() => setForm({ mode: "edit", doc: d })}>Edit</button>
                      <button className="ml-2 underline" onClick={async () => { const up = await pickFile(); if (up) run(() => updateDocument(d.DocId, { fileId: up.id, updatedAt: d.UpdatedAt })); }}>Replace</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
