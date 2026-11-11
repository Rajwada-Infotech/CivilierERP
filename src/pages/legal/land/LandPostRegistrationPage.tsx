import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocumentText } from "iconsax-react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalFileLink } from "@/components/legal/LegalDocumentPreview";
import { usePageRights } from "@/hooks/usePageRights";
import { getPostRegistration, updatePostRegTask, type PostRegTask } from "@/api/legalLandApi";
import { uploadLegalFile } from "@/api/legalMastersApi";

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const today = new Date().toISOString().slice(0, 10);
const TONE: Record<string, string> = {
  Completed: "text-emerald-600", Rejected: "text-destructive", "Additional Documents Required": "text-amber-600",
  "Application Submitted": "text-sky-600", "Under Processing": "text-sky-600", "Not Started": "text-muted-foreground",
};
const input = "w-full border border-border bg-background px-1.5 py-1 text-xs";

/** One task row: status, reference no., due date, remarks and a copy; saved on its own. */
function TaskRow({ t, statuses, canEdit, onSaved }: { t: PostRegTask; statuses: string[]; canEdit: boolean; onSaved: () => void }) {
  const [f, setF] = useState({ status: t.Status, refNo: t.RefNo ?? "", dueDate: t.DueDate ?? "", remarks: t.Remarks ?? "", fileId: null as number | null, fileName: "" });
  const [busy, setBusy] = useState(false);
  const dirty = f.status !== t.Status || f.refNo !== (t.RefNo ?? "") || f.dueDate !== (t.DueDate ?? "") || f.remarks !== (t.Remarks ?? "") || !!f.fileId;
  const late = t.Status !== "Completed" && t.DueDate && t.DueDate < today;
  const attach = () => {
    const el = document.createElement("input");
    el.type = "file"; el.accept = "application/pdf,image/*";
    el.onchange = async () => {
      const file = el.files?.[0];
      if (!file) return;
      try { const up = await uploadLegalFile(file); setF((x) => ({ ...x, fileId: up.id, fileName: up.fileName })); } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    };
    el.click();
  };
  const save = async () => {
    setBusy(true);
    try { toast.success((await updatePostRegTask(t.TaskId, f)).message); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  };
  return (
    <tr className={`border-t border-border/60 align-top ${late ? "bg-destructive/5" : ""}`}>
      <td className="px-2 py-1.5 text-xs font-semibold">{t.TaskNo}. {t.Task}</td>
      <td className="px-2 py-1.5">
        {canEdit ? <select className={`${input} ${TONE[f.status] ?? ""}`} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
          : <span className={`text-xs font-semibold ${TONE[t.Status] ?? ""}`}>{t.Status}</span>}
      </td>
      <td className="px-2 py-1.5">{canEdit ? <input className={input} value={f.refNo} onChange={(e) => setF({ ...f, refNo: e.target.value })} placeholder="Application / order no." /> : <span className="text-xs">{t.RefNo ?? "—"}</span>}</td>
      <td className="px-2 py-1.5">{canEdit ? <input type="date" className={input} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /> : <span className="text-xs">{fmt(t.DueDate)}</span>}
        {late && <span className="block text-[0.6875rem] font-semibold text-destructive">Overdue</span>}</td>
      <td className="px-2 py-1.5">{canEdit ? <input className={input} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /> : <span className="text-xs">{t.Remarks ?? "—"}</span>}</td>
      <td className="px-2 py-1.5 text-xs">
        {f.fileId ? <LegalFileLink id={f.fileId} name={f.fileName} /> : t.FileId ? <LegalFileLink id={t.FileId} name={t.FileName ?? "Copy"} /> : null}
        {canEdit && <button className="ml-1 inline-flex items-center gap-1 text-xs underline" onClick={attach}><Upload size={11} /> {t.FileId || f.fileId ? "Replace" : "Attach"}</button>}
      </td>
      <td className="px-2 py-1.5 text-right text-xs">
        {canEdit && <button className="bg-foreground px-2.5 py-1 font-semibold text-card disabled:opacity-40" disabled={!dirty || busy} onClick={save}>Save</button>}
        {t.UpdatedAt && <span className="block text-[0.6875rem] text-muted-foreground">{t.UpdatedByName ?? ""} · {fmt(t.UpdatedAt)}</span>}
      </td>
    </tr>
  );
}

/** Post-registration compliance: after the deed is registered — mutation, new Khatian / RoR, records, tax, ownership update. */
export default function LandPostRegistrationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = usePageRights("legal-land-master").canEdit;
  const { data, isLoading, error } = useQuery({ queryKey: ["legal-post-registration"], queryFn: getPostRegistration });
  const refresh = () => qc.invalidateQueries({ queryKey: ["legal-post-registration"] });
  const lands = data?.lands ?? [];
  return (
    <>
      <Breadcrumbs items={[{ label: "Dashboard", path: "/home" }, { label: "Legal", path: "/legal" }, { label: "Post-Registration" }]} />
      <LegalShell title="Post-Registration" subtitle="After the deed is registered: mutation, new Khatian / RoR, land records, tax and ownership updates." icon={DocumentText}>
        {error ? <p className="p-6 text-destructive">{(error as Error).message}</p> : isLoading ? <p className="p-6 text-muted-foreground">Loading…</p> : !lands.length ? (
          <p className="border border-border p-6 text-sm text-muted-foreground">No registered land yet. Tasks appear here when a land's registered deed is submitted on the Deed Registration page.</p>
        ) : (
          <div className="space-y-4">
            {lands.map((l) => {
              const done = l.tasks.filter((t) => t.Status === "Completed").length;
              return (
                <section key={l.LandId} className="border border-border bg-card">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <button className="text-left hover:underline" onClick={() => navigate(`/legal/land/post-registration/${l.LandId}`)}>
                      <b className="font-mono">{l.LandCode}</b> · {l.LandName}
                      <span className="ml-2 text-xs text-muted-foreground">{[l.MouzaName, l.DistrictName].filter(Boolean).join(" · ")}</span>
                    </button>
                    <span className="flex items-center gap-3 text-xs">
                      Registered {fmt(l.RegCompletedAt)}
                      {l.RegDeedFileId ? <LegalFileLink id={l.RegDeedFileId} name={l.RegDeedFileName ?? "Registered deed"} /> : null}
                      <b className={done === l.tasks.length ? "text-emerald-600" : "text-amber-600"}>{done} / {l.tasks.length} done</b>
                    </span>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[900px] text-left">
                      <thead className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                        <tr><th className="px-2 py-1.5">Task</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5">Reference</th><th className="px-2 py-1.5">Due date</th><th className="px-2 py-1.5">Remarks</th><th className="px-2 py-1.5">Copy</th><th className="px-2 py-1.5" /></tr>
                      </thead>
                      <tbody>{l.tasks.map((t) => <TaskRow key={`${t.TaskId}-${t.UpdatedAt ?? ""}`} t={t} statuses={data!.statuses} canEdit={canEdit} onSaved={refresh} />)}</tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </LegalShell>
    </>
  );
}
