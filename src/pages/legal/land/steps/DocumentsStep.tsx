import React, { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus, Upload } from "lucide-react";
import { usePageRights } from "@/hooks/usePageRights";
import { uploadLegalFile, getLegalLookup } from "@/api/legalMastersApi";
import {
  getLandDocuments, getDocumentVersions, addLandDocument, addDocumentVersion, reviewDocumentVersion, markDocumentNA, undoDocumentNA,
  type LandDocument, type RequiredDocument, type ReviewStatus,
} from "@/api/legalDocumentsApi";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { askLegal } from "@/components/legal/LegalAsk";
import { LEGAL_GRADIENT } from "@/components/legal/LegalShell";

// Pipeline step 6 — Document Collection & Upload. Required documents come from the land's checklist;
// every upload is a version, a re-upload never replaces the earlier one, and each review belongs to
// one version. Reviews and Not Applicable need the approve right (the server checks it too).

const card = "rounded-2xl bg-card/80 backdrop-blur-lg border border-border shadow-sm";
const eyebrow = "mb-3 text-[0.6875rem] font-heading uppercase tracking-[0.18em] text-muted-foreground";
const btn = "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50";
const input = "w-full rounded-lg border border-border bg-muted px-2.5 py-1.5 text-sm";

const STATE_STYLE: Record<string, string> = {
  Verified: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  Pending: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  Rejected: "border-rose-500/40 bg-rose-500/10 text-rose-600",
  "Reattachment Required": "border-rose-500/40 bg-rose-500/10 text-rose-600",
  Missing: "border-rose-500/40 bg-rose-500/5 text-rose-600",
  "Not Applicable": "border-border bg-muted text-muted-foreground",
};
const Chip: React.FC<{ s: string }> = ({ s }) => (
  <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.6875rem] ${STATE_STYLE[s] ?? "border-border text-muted-foreground"}`}>{s}</span>
);
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "");

/** Picks a file and uploads it at once; returns the stored file id. */
function useUpload() {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = () => new Promise<{ id: number; fileName: string } | null>((resolve) => {
    const el = ref.current!;
    el.onchange = async () => {
      const f = el.files?.[0];
      el.value = "";
      if (!f) return resolve(null);
      setBusy(true);
      try { resolve(await uploadLegalFile(f)); } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); resolve(null); } finally { setBusy(false); }
    };
    el.click();
  });
  const inputEl = <input ref={ref} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" />;
  return { pick, busy, inputEl };
}

const Versions: React.FC<{ doc: LandDocument }> = ({ doc }) => {
  const { data, isLoading } = useQuery({ queryKey: ["legal-doc-versions", doc.DocumentId, doc.CurrentVersionNo], queryFn: () => getDocumentVersions(doc.DocumentId) });
  if (isLoading) return <p className="px-3 py-2 text-xs text-muted-foreground">Loading versions…</p>;
  return (
    <div className="space-y-1.5 px-3 py-2">
      {(data ?? []).map((v) => (
        <div key={v.VersionId} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="w-8 font-mono text-muted-foreground">v{v.VersionNo}</span>
          <LegalFileLink id={v.FileId} name={v.FileName} />
          <Chip s={v.ReviewStatus} />
          <span className="text-muted-foreground">uploaded {fmt(v.UploadedAt)}{v.UploadedByName ? ` by ${v.UploadedByName}` : ""}</span>
          {v.ReviewedAt && <span className="text-muted-foreground">· reviewed {fmt(v.ReviewedAt)}{v.ReviewedByName ? ` by ${v.ReviewedByName}` : ""}</span>}
          {v.ReviewRemarks && <span className="text-foreground">· {v.ReviewRemarks}</span>}
          {v.UploadRemarks && <span className="text-muted-foreground">· {v.UploadRemarks}</span>}
        </div>
      ))}
    </div>
  );
};

const AddDocument: React.FC<{
  landId: number; sections: string[]; preset?: RequiredDocument | null; onDone: () => void; onCancel: () => void;
}> = ({ landId, sections, preset, onDone, onCancel }) => {
  const { data: types } = useQuery({ queryKey: ["legal-lookup", "document-type"], queryFn: () => getLegalLookup("document-type") });
  const [f, setF] = useState({ docTypeId: preset ? String(preset.docTypeId) : "", relatedSection: "Property", title: preset?.docTypeName ?? "", documentNo: "", documentDate: "", issuingAuthority: "", remarks: "" });
  const [file, setFile] = useState<{ id: number; fileName: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const up = useUpload();
  const save = async () => {
    if (!file) return toast.error("Upload the file");
    setSaving(true);
    try {
      toast.success((await addLandDocument(landId, { ...f, docTypeId: Number(f.docTypeId), fileId: file.id })).message);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add the document");
    } finally {
      setSaving(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className={`${card} p-4 sm:p-5`}>
      {up.inputEl}
      <p className={eyebrow}>Add document</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted-foreground">Document type *
          <select className={`${input} mt-1`} value={f.docTypeId} onChange={set("docTypeId")}>
            <option value="">Select…</option>
            {(types ?? []).filter((t) => t.active !== false).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">Related section *
          <select className={`${input} mt-1`} value={f.relatedSection} onChange={set("relatedSection")}>{sections.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="text-xs text-muted-foreground">Title *<input className={`${input} mt-1`} value={f.title} onChange={set("title")} /></label>
        <label className="text-xs text-muted-foreground">Document number<input className={`${input} mt-1`} value={f.documentNo} onChange={set("documentNo")} /></label>
        <label className="text-xs text-muted-foreground">Document date<input type="date" className={`${input} mt-1`} value={f.documentDate} onChange={set("documentDate")} /></label>
        <label className="text-xs text-muted-foreground">Issuing authority<input className={`${input} mt-1`} value={f.issuingAuthority} onChange={set("issuingAuthority")} /></label>
        <label className="text-xs text-muted-foreground sm:col-span-2">Remarks<input className={`${input} mt-1`} value={f.remarks} onChange={set("remarks")} /></label>
        <div className="text-xs text-muted-foreground">File *
          <button type="button" className={`${input} mt-1 flex items-center gap-1.5 text-left`} disabled={up.busy} onClick={async () => { const r = await up.pick(); if (r) setFile(r); }}>
            <Upload size={13} /> <span className="truncate">{up.busy ? "Uploading…" : file?.fileName ?? "Upload PDF or image (max 15 MB)"}</span>
          </button>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" style={{ background: LEGAL_GRADIENT }} disabled={saving || up.busy || !f.docTypeId || !f.title.trim() || !file} onClick={save}>
          Save document
        </button>
        <button className={btn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

export const DocumentsStep: React.FC<{ landId: number; onSaved: () => void }> = ({ landId, onSaved }) => {
  const rights = usePageRights("legal-land-master");
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-land-docs", landId], queryFn: () => getLandDocuments(landId) });
  const [adding, setAdding] = useState<RequiredDocument | null | false>(false);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const up = useUpload();

  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["legal-land-docs", landId] }), queryClient.invalidateQueries({ queryKey: ["legal-doc-versions"] })]);
    onSaved();
  };
  const act = async (fn: () => Promise<{ message: string }>) => {
    setBusy(true);
    try { toast.success((await fn()).message); await refresh(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  const review = async (d: LandDocument, status: ReviewStatus) => {
    let remarks: string | undefined;
    if (status !== "Verified") {
      remarks = (await askLegal({
        title: status === "Rejected" ? `Reject ${d.DocumentCode} v${d.CurrentVersionNo}?` : `Ask for a new copy of ${d.DocumentCode}?`,
        input: { label: status === "Rejected" ? "Why is this version rejected?" : "What needs to be re-attached?", required: true },
        confirmText: status === "Rejected" ? "Reject" : "Ask re-attach", tone: status === "Rejected" ? "danger" : "default",
      })) ?? undefined;
      if (!remarks) return;
    }
    act(() => reviewDocumentVersion(d.VersionId, status, remarks));
  };
  const reattach = async (d: LandDocument) => {
    const r = await up.pick();
    if (!r) return;
    const note = await askLegal({ title: `New version of ${d.DocumentCode}`, message: r.fileName, input: { label: "Note for this version (optional)" }, confirmText: "Upload as new version" });
    if (note === null) return;
    const remarks = note || undefined;
    act(() => addDocumentVersion(d.DocumentId, r.id, remarks));
  };

  if (error) return <div className={`${card} p-5 text-sm text-destructive`}>{(error as Error).message}</div>;
  if (isLoading || !data) return <div className={`${card} p-5 text-sm text-muted-foreground`}>Loading documents…</div>;
  const req = data.required;

  return (
    <div className="space-y-4">
      {up.inputEl}
      {/* ── Required documents ── */}
      <div className={`${card} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={eyebrow}>Required documents {req.templateName ? `· ${req.templateName}` : ""}</p>
        </div>
        {!req.templateId ? (
          <p className="text-sm text-muted-foreground">No document checklist is chosen for this land. Set <b>Document checklist</b> on the Land Property (step 2) to list the required documents.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Document</th><th className="pb-2 pr-3 font-medium">Requirement</th><th className="pb-2 pr-3 font-medium">Needed by</th>
                <th className="pb-2 pr-3 font-medium">State</th><th className="pb-2 text-right font-medium">Action</th>
              </tr></thead>
              <tbody>
                {req.items.map((i) => (
                  <tr key={i.docTypeId} className="border-t border-border/60">
                    <td className="py-2 pr-3">{i.docTypeName}{i.naReason && <div className="text-xs text-muted-foreground">N/A: {i.naReason}</div>}</td>
                    <td className="py-2 pr-3">{i.requirement}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{i.stage}</td>
                    <td className="py-2 pr-3"><Chip s={i.state} /></td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {i.state === "Missing" && rights.canEdit && <button className={btn} onClick={() => setAdding(i)}><Upload size={12} /> Upload</button>}
                      {i.state === "Missing" && i.allowNA && rights.canApprove && (
                        <button className={`${btn} ml-1.5`} disabled={busy} onClick={async () => { const r = await askLegal({ title: `Mark ${i.docTypeName} not applicable?`, input: { label: "Why does it not apply to this land?", required: true, minLength: 5 }, confirmText: "Mark not applicable" }); if (r) act(() => markDocumentNA(landId, i.docTypeId, r)); }}>Not applicable</button>
                      )}
                      {i.state === "Not Applicable" && rights.canApprove && <button className={btn} disabled={busy} onClick={() => act(() => undoDocumentNA(landId, i.docTypeId))}>Make required</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding !== false && (
        <AddDocument landId={landId} sections={data.sections} preset={adding} onCancel={() => setAdding(false)} onDone={async () => { setAdding(false); await refresh(); }} />
      )}

      {/* ── All documents of this land ── */}
      <div className={`${card} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className={eyebrow}>Land documents · {data.documents.length}</p>
          {rights.canEdit && adding === false && <button className={`${btn} mb-3`} onClick={() => setAdding(null)}><Plus size={12} /> Add document</button>}
        </div>
        {!data.documents.length ? <p className="text-sm text-muted-foreground">No documents uploaded yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-2 font-medium" /><th className="pb-2 pr-3 font-medium">Document</th><th className="pb-2 pr-3 font-medium">Type / section</th>
                <th className="pb-2 pr-3 font-medium">Current version</th><th className="pb-2 pr-3 font-medium">Uploaded</th><th className="pb-2 pr-3 font-medium">Review</th>
                <th className="pb-2 text-right font-medium">Action</th>
              </tr></thead>
              <tbody>
                {data.documents.map((d) => (
                  <React.Fragment key={d.DocumentId}>
                    <tr className="border-t border-border/60 align-top">
                      <td className="py-2 pr-2">
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(open === d.DocumentId ? null : d.DocumentId)} title="Version history" aria-label="Version history">
                          {open === d.DocumentId ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-foreground">{d.Title}</div>
                        <div className="text-xs text-muted-foreground">{d.DocumentCode}{d.DocumentNo ? ` · No. ${d.DocumentNo}` : ""}{d.DocumentDate ? ` · ${fmt(d.DocumentDate)}` : ""}</div>
                      </td>
                      <td className="py-2 pr-3">{d.DocTypeName}<div className="text-xs text-muted-foreground">{d.RelatedSection}</div></td>
                      <td className="py-2 pr-3"><div className="flex items-center gap-1.5"><span className="font-mono text-xs text-muted-foreground">v{d.CurrentVersionNo}</span><LegalFileLink id={d.FileId} name={d.FileName} /></div></td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs text-muted-foreground">{fmt(d.UploadedAt)}<div>{d.UploadedByName ?? ""}</div></td>
                      <td className="py-2 pr-3"><Chip s={d.ReviewStatus} />{d.ReviewRemarks && <div className="mt-1 max-w-[220px] text-xs text-muted-foreground">{d.ReviewRemarks}</div>}</td>
                      <td className="py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {rights.canApprove && d.ReviewStatus !== "Verified" && <button className={btn} disabled={busy} onClick={() => review(d, "Verified")}>Verify</button>}
                          {rights.canApprove && d.ReviewStatus !== "Rejected" && <button className={btn} disabled={busy} onClick={() => review(d, "Rejected")}>Reject</button>}
                          {rights.canApprove && d.ReviewStatus !== "Reattachment Required" && d.ReviewStatus !== "Verified" && <button className={btn} disabled={busy} onClick={() => review(d, "Reattachment Required")}>Ask re-attach</button>}
                          {rights.canEdit && <button className={btn} disabled={busy || up.busy} onClick={() => reattach(d)}><Upload size={12} /> New version</button>}
                        </div>
                      </td>
                    </tr>
                    {open === d.DocumentId && <tr><td /><td colSpan={6} className="pb-2"><div className="rounded-lg bg-muted/40"><Versions doc={d} /></div></td></tr>}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
