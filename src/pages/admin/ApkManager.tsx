import React, { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Smartphone, Upload, Download, Loader2, ShieldAlert, Pencil } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
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
  "w-full px-3 py-2 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none";

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const TAG = "inline-flex items-center gap-1 font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border whitespace-nowrap";
// A mandatory build blocks the app until updated — the one thing on this page drawn in red.
const MANDATORY = `${TAG} text-destructive border-destructive`;

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
      <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
        <DialogHeader>
          <div className="pb-3" style={{ borderBottom: RULE }}>
            <p className={LBL}>{app.label}</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Publish a new build</DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className={`${LBL} mb-1.5`}>APK file</p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex items-center gap-2 px-3 py-2.5 border border-dashed border-foreground/50 hover:border-foreground text-sm text-left transition-colors"
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
            <p className="text-[0.6875rem] text-muted-foreground mt-1.5">
              The version is read from the APK itself and must be newer than the current build
              {app.current ? ` (currently build ${app.current.versionCode})` : ""}.
            </p>
          </div>
          <div>
            <p className={`${LBL} mb-1.5`}>What's new</p>
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
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="mt-0.5 accent-foreground" />
            <span className="text-sm">
              <span className="font-medium">Mandatory update</span>
              <span className="block text-[0.6875rem] text-muted-foreground">
                Blocks the app until it is updated. Use for changes older versions can't work with.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button
              type="button"
              disabled={publish.isPending}
              onClick={onClose}
              className={`${KEY_LINE} h-9 px-4`}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!file || publish.isPending}
              onClick={() => publish.mutate()}
              className={`${KEY_INK} h-9 px-5`}
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
      <DialogContent className="sheet-frame max-w-lg" style={{ margin: 0 }}>
        <DialogHeader>
          <div className="pb-3" style={{ borderBottom: RULE }}>
            <p className={LBL}>Build {release.versionCode}</p>
            <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Edit release</DialogTitle>
          </div>
        </DialogHeader>
        <div className="space-y-4">
          <textarea rows={4} className={inp} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="accent-foreground" /> Mandatory update
          </label>
          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button onClick={onClose} className={`${KEY_LINE} h-9 px-4`}>Cancel</button>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className={`${KEY_INK} h-9 px-5`}
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
      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="APK manager"
        subtitle="Publish new Android builds. Installed apps offer the update automatically."
      >
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Apps", value: catalog.length, note: "in the catalogue" },
              { label: "Published", value: catalog.filter((a) => a.current).length, note: "with a live build" },
              { label: "Mandatory", value: catalog.filter((a) => a.current?.mandatory).length, note: "current builds that block until updated" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value.toLocaleString("en-IN")}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-10 text-center">Loading…</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {catalog.map((a) => (
              <div key={a.appKey} className={`bg-card p-4 flex flex-col gap-3 border ${a.current ? "border-foreground" : "border-dashed border-foreground/50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-heading text-base font-bold tracking-tight text-foreground truncate">{a.label}</p>
                    <p className="text-[0.6875rem] font-heading tabular-nums text-muted-foreground truncate">{a.packageName}</p>
                  </div>
                  {a.current?.mandatory && (
                    <span className={`${MANDATORY} shrink-0`}>
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
                      <p className="text-foreground/80 border-l-2 border-foreground/40 pl-3 py-1 whitespace-pre-wrap">{a.current.releaseNotes}</p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">Nothing published yet. Users with no update record see no prompt.</p>
                )}

                <div className="flex items-center gap-2 mt-auto pt-1">
                  <button
                    onClick={() => setPublishing(a)}
                    className={`${KEY_INK} h-9 px-4`}
                  >
                    <Upload size={13} /> Publish new build
                  </button>
                  {a.current && (
                    <a
                      href={a.current.downloadPath}
                      className={`${KEY_LINE} h-9 px-3`}
                    >
                      <Download size={13} /> Download APK
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-card overflow-hidden" style={{ border: RULE }}>
          <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: RULE }}>
            <h3 className={HEAD}>Release history</h3>
            <span className="font-heading text-[0.6875rem] tabular-nums text-muted-foreground">{history.length}</span>
            <select className="ml-auto h-8 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-xs text-foreground outline-none" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All apps</option>
              {catalog.map((a) => (
                <option key={a.appKey} value={a.appKey}>{a.label}</option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={LBL} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.3)" }}>
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
              <tbody className="divide-y divide-foreground/10">
                {history.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No builds published yet.</td></tr>
                ) : (
                  history.map((r) => (
                    <tr key={r.id} className="hover:bg-primary/5">
                      <td className="px-4 py-2.5 font-medium">
                        {catalog.find((a) => a.appKey === r.appKey)?.label ?? r.appKey}
                        {r.isCurrent && <span className="ml-2 align-middle"><SheetMark text="Current" tone="done" /></span>}
                        {r.mandatory && <span className={`${MANDATORY} ml-1.5`}>Mandatory</span>}
                      </td>
                      <td className="px-4 py-2.5">{r.versionName ?? "—"}</td>
                      <td className="px-4 py-2.5 font-heading tabular-nums">{r.versionCode}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{fmtDate(r.publishedAt)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{r.publishedBy ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[280px] truncate" title={r.releaseNotes ?? ""}>{r.releaseNotes || "—"}</td>
                      <td className="px-2 py-2.5 text-center">
                        <button onClick={() => setEditing(r)} className="w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors" title="Edit notes" aria-label="Edit notes">
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
      </SheetShell>

      {publishing && <PublishDialog app={publishing} onClose={() => setPublishing(null)} />}
      {editing && <EditDialog release={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
