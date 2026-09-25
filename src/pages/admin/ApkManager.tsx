import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Smartphone, Upload, Download, Loader2, ShieldAlert, Pencil } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getAppCatalog,
  getAppReleases,
  publishAppRelease,
  updateAppRelease,
  type AppCatalogEntry,
  type AppRelease,
} from "@/api/appReleasesApi";

const fmtDate = (d: string) =>
  new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmtMB = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;

const inp =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function PublishDialog({ app, onClose }: { app: AppCatalogEntry; onClose: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [mandatory, setMandatory] = useState(false);

  const publish = useMutation({
    mutationFn: () => publishAppRelease({ appKey: app.appKey, file: file as File, releaseNotes: notes, mandatory }),
    onSuccess: (r) => {
      toast.success(`Published ${app.label} ${r.versionName ?? ""} (build ${r.versionCode}).`);
      qc.invalidateQueries({ queryKey: ["app-catalog"] });
      qc.invalidateQueries({ queryKey: ["app-releases"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || "Upload failed."),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !publish.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish a new build — {app.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">APK file</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-border hover:bg-muted/40 text-sm text-left transition-colors"
            >
              <Upload size={14} className="text-muted-foreground shrink-0" />
              <span className="truncate">{file ? `${file.name} (${fmtMB(file.size)})` : "Choose the .apk built for this app"}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              The version is read from the APK itself and must be newer than the current build
              {app.current ? ` (currently build ${app.current.versionCode})` : ""}.
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-1.5">What's new</p>
            <textarea
              rows={4}
              className={inp}
              value={notes}
              maxLength={2000}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Shown to users in the update prompt, e.g. Stock Update screen added. Fixed login error."
            />
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="mt-0.5" />
            <span className="text-sm">
              <span className="font-medium">Mandatory update</span>
              <span className="block text-[11px] text-muted-foreground">
                Blocks the app until it is updated. Use for changes older versions can't work with.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={publish.isPending}
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!file || publish.isPending}
              onClick={() => publish.mutate()}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {publish.isPending && <Loader2 size={14} className="animate-spin" />}
              {publish.isPending ? "Uploading…" : "Publish"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ release, onClose }: { release: AppRelease; onClose: () => void }) {
  const qc = useQueryClient();
  const [notes, setNotes] = useState(release.releaseNotes ?? "");
  const [mandatory, setMandatory] = useState(release.mandatory);
  const save = useMutation({
    mutationFn: () => updateAppRelease(release.id, { releaseNotes: notes, mandatory }),
    onSuccess: () => {
      toast.success("Release updated.");
      qc.invalidateQueries({ queryKey: ["app-catalog"] });
      qc.invalidateQueries({ queryKey: ["app-releases"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || "Failed to update."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit release — build {release.versionCode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <textarea rows={4} className={inp} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} /> Mandatory update
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm hover:bg-muted transition-colors">Cancel</button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ApkManager() {
  const [publishing, setPublishing] = useState<AppCatalogEntry | null>(null);
  const [editing, setEditing] = useState<AppRelease | null>(null);
  const [filter, setFilter] = useState("");

  const { data: catalog = [], isLoading } = useQuery({ queryKey: ["app-catalog"], queryFn: getAppCatalog });
  const { data: history = [] } = useQuery({
    queryKey: ["app-releases", filter],
    queryFn: () => getAppReleases(filter || undefined),
  });

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "APK Manager"]} />
      <AdminShell title="APK Manager" subtitle="Publish new Android builds. Installed apps offer the update automatically." icon={Smartphone}>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-10 text-center">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {catalog.map((a) => (
              <div key={a.appKey} className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-heading font-semibold text-foreground truncate">{a.label}</p>
                    <p className="text-[11px] font-mono text-muted-foreground truncate">{a.packageName}</p>
                  </div>
                  {a.current?.mandatory && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
                      <ShieldAlert size={11} /> Mandatory
                    </span>
                  )}
                </div>

                {a.current ? (
                  <div className="text-xs space-y-1">
                    <p>
                      <span className="text-muted-foreground">Current: </span>
                      <span className="font-semibold text-foreground">{a.current.versionName ?? "—"}</span>
                      <span className="text-muted-foreground"> · build {a.current.versionCode} · {fmtMB(a.current.sizeBytes)}</span>
                    </p>
                    <p className="text-muted-foreground">
                      Published {fmtDate(a.current.publishedAt)}{a.current.publishedBy ? ` by ${a.current.publishedBy}` : ""}
                    </p>
                    {a.current.releaseNotes && (
                      <p className="text-foreground/80 bg-muted/30 border border-border/50 rounded-lg px-3 py-2 whitespace-pre-wrap">{a.current.releaseNotes}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Nothing published yet. Users with no update record see no prompt.</p>
                )}

                <div className="flex items-center gap-2 mt-auto pt-1">
                  <button
                    onClick={() => setPublishing(a)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-primary hover:opacity-90 transition-opacity"
                  >
                    <Upload size={13} /> Publish new build
                  </button>
                  {a.current && (
                    <a
                      href={a.current.downloadPath}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted transition-colors"
                    >
                      <Download size={13} /> Download APK
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-border bg-card/70 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border/60 flex items-center gap-3">
            <h3 className="text-[10px] font-heading font-bold uppercase tracking-widest text-muted-foreground">Release history</h3>
            <select className="ml-auto px-2.5 py-1.5 rounded-lg border border-border bg-background text-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All apps</option>
              {catalog.map((a) => (
                <option key={a.appKey} value={a.appKey}>{a.label}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-widest font-heading text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">App</th>
                  <th className="px-4 py-2 text-left">Version</th>
                  <th className="px-4 py-2 text-left">Build</th>
                  <th className="px-4 py-2 text-left">Published</th>
                  <th className="px-4 py-2 text-left">By</th>
                  <th className="px-4 py-2 text-left">Notes</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {history.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No builds published yet.</td></tr>
                ) : (
                  history.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium">
                        {catalog.find((a) => a.appKey === r.appKey)?.label ?? r.appKey}
                        {r.isCurrent && <span className="ml-2 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Current</span>}
                        {r.mandatory && <span className="ml-1.5 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">Mandatory</span>}
                      </td>
                      <td className="px-4 py-2.5">{r.versionName ?? "—"}</td>
                      <td className="px-4 py-2.5 tabular-nums">{r.versionCode}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{fmtDate(r.publishedAt)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.publishedBy ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[280px] truncate" title={r.releaseNotes ?? ""}>{r.releaseNotes || "—"}</td>
                      <td className="px-2 py-2.5 text-center">
                        <button onClick={() => setEditing(r)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Edit notes">
                          <Pencil size={13} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AdminShell>

      {publishing && <PublishDialog app={publishing} onClose={() => setPublishing(null)} />}
      {editing && <EditDialog release={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
