// Maintenance → Ads (super admins only): video ads for the Civilier Security app, shown to residents only.
//   Pop-up ads    play in a pop-up when a resident opens the app's dashboard: at least 15 seconds, or the whole video
//                 if it is longer. One pop-up per opening, taking turns.
//   Dashboard ads play, muted and on repeat, in the ad space on the resident's dashboard, one after another.
// Upload as many as you like; switch one off to stop showing it without deleting it.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Play, Trash2, Upload } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MaintenanceShell } from "@/components/maintenance/MaintenanceShell";
import { ICON_ACT, ICON_ACT_RED, SheetBox, SheetTabs, TD, TH } from "@/components/maintenance/maintParts";
import { HrStatStrip } from "@/components/hrpayroll/HrUi";
import { SheetMark } from "@/components/sheet/Sheet";
import { KEY_INK } from "@/components/sheet/sheetParts";
import { adVideoUrl, deleteAd, getAds, updateAd, uploadAd, type AdKind, type SecurityAd } from "@/api/securityAdsApi";
import { EmptyRow, Field, SheetDialog, fieldCls } from "./securityParts";

const KIND_LABEL: Record<AdKind, string> = { POPUP: "Pop-up ads", BANNER: "Dashboard ads" };
const KIND_NOTE: Record<AdKind, string> = {
  POPUP: "Play in a pop-up when a resident opens the app: at least 15 seconds, or the whole video if longer.",
  BANNER: "Play muted, on repeat, in the ad space on the resident's dashboard, one after another.",
};
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function SecurityAds() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AdKind>("POPUP");
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<SecurityAd | null>(null);
  const { data: ads = [], isLoading, error } = useQuery({ queryKey: ["security-ads"], queryFn: getAds });
  const shown = ads.filter((a) => a.kind === kind);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["security-ads"] });

  const toggle = async (a: SecurityAd) => {
    try {
      await updateAd(a.id, { isActive: !a.isActive });
      toast.success(a.isActive ? "Ad switched off" : "Ad switched on");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const remove = async (a: SecurityAd) => {
    if (!window.confirm(`Delete "${a.title}"? The video is removed for good. To stop showing it but keep it, switch it off instead.`)) return;
    try {
      await deleteAd(a.id);
      toast.success("Ad deleted");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Maintenance", "Ads"]} />
      <MaintenanceShell
        title="Ads"
        subtitle="Video ads in the Civilier Security app — residents only"
        action={
          <button type="button" onClick={() => setAdding(true)} className={`${KEY_INK} h-9 px-4`}>
            <Upload size={13} /> Upload Ad
          </button>
        }
      >
        <HrStatStrip
          items={[
            { label: "Pop-up ads", value: isLoading ? "…" : `${ads.filter((a) => a.kind === "POPUP" && a.isActive).length} on`, hint: `${ads.filter((a) => a.kind === "POPUP").length} uploaded` },
            { label: "Dashboard ads", value: isLoading ? "…" : `${ads.filter((a) => a.kind === "BANNER" && a.isActive).length} on`, hint: `${ads.filter((a) => a.kind === "BANNER").length} uploaded` },
            { label: "Storage", value: isLoading ? "…" : mb(ads.reduce((n, a) => n + a.sizeBytes, 0)) },
          ]}
        />
        <SheetTabs
          tabs={(["POPUP", "BANNER"] as AdKind[]).map((k) => ({ value: k, label: KIND_LABEL[k], count: ads.filter((a) => a.kind === k).length }))}
          value={kind}
          onChange={(v) => setKind(v as AdKind)}
        />
        <SheetBox title={KIND_LABEL[kind]} note={shown.length} flush>
          <p className="px-4 py-2.5 text-xs text-muted-foreground border-b border-foreground/15">{KIND_NOTE[kind]}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className={TH}>Title</th>
                  <th className={TH}>File</th>
                  <th className={TH}>Size</th>
                  <th className={TH}>Uploaded</th>
                  <th className={TH}>Status</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <EmptyRow cols={6}>Reading…</EmptyRow>
                ) : error ? (
                  <EmptyRow cols={6}><span className="text-destructive">{(error as Error).message}</span></EmptyRow>
                ) : shown.length === 0 ? (
                  <EmptyRow cols={6}>No {KIND_LABEL[kind].toLowerCase()} yet. Upload a video to start.</EmptyRow>
                ) : (
                  shown.map((a) => (
                    <tr key={a.id} className="hover:bg-primary/5">
                      <td className={`${TD} font-medium`}>{a.title}</td>
                      <td className={`${TD} text-muted-foreground`}>{a.originalName ?? "—"}</td>
                      <td className={`${TD} font-heading tabular-nums`}>{mb(a.sizeBytes)}</td>
                      <td className={`${TD} font-heading tabular-nums`}>{fmtDate(a.createdAt)}</td>
                      <td className={TD}><SheetMark text={a.isActive ? "On" : "Off"} tone={a.isActive ? "done" : "draft"} /></td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        <button type="button" className={ICON_ACT} onClick={() => setPreview(a)} aria-label={`Play ${a.title}`}>
                          <Play size={13} />
                        </button>
                        <button type="button" className={ICON_ACT} onClick={() => void toggle(a)} aria-label={a.isActive ? `Switch off ${a.title}` : `Switch on ${a.title}`}>
                          {a.isActive ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                        <button type="button" className={ICON_ACT_RED} onClick={() => void remove(a)} aria-label={`Delete ${a.title}`}>
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SheetBox>
      </MaintenanceShell>

      {adding && (
        <UploadDialog
          initialKind={kind}
          onClose={() => setAdding(false)}
          onSaved={(k) => {
            setAdding(false);
            setKind(k);
            refresh();
          }}
        />
      )}
      {preview && <PreviewDialog ad={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

function UploadDialog({ initialKind, onClose, onSaved }: { initialKind: AdKind; onClose: () => void; onSaved: (k: AdKind) => void }) {
  const [kind, setKind] = useState<AdKind>(initialKind);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!file) return toast.error("Choose a video file.");
    if (!["video/mp4", "video/quicktime"].includes(file.type)) return toast.error("Upload an MP4 or MOV video.");
    if (file.size > 200 * 1024 * 1024) return toast.error("The video is larger than 200 MB.");
    setSaving(true);
    try {
      await uploadAd(kind, title, file);
      toast.success("Ad uploaded");
      onSaved(kind);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetDialog title="Upload an ad" onClose={onClose} onSubmit={submit} saving={saving} icon={<Upload size={13} />} submitLabel="Upload">
      <Field label="Type" hint={KIND_NOTE[kind]}>
        <select value={kind} onChange={(e) => setKind(e.target.value as AdKind)} className={fieldCls}>
          <option value="POPUP">Pop-up ad</option>
          <option value="BANNER">Dashboard ad</option>
        </select>
      </Field>
      <Field label="Title" hint="For your list only; residents don't see it. Left empty: the file name.">
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={fieldCls} placeholder="e.g. Diwali offer" />
      </Field>
      <Field label="Video" hint="MP4 or MOV with H.264 video, up to 200 MB — plays on every phone. AV1 / VP9 videos (common in YouTube downloads) are refused: iPhones play only their sound.">
        <input type="file" accept="video/mp4,video/quicktime" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={`${fieldCls} py-1.5`} />
      </Field>
    </SheetDialog>
  );
}

function PreviewDialog({ ad, onClose }: { ad: SecurityAd; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const made = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    adVideoUrl(ad.id)
      .then((u) => {
        made.current = u;
        if (live) setUrl(u);
      })
      .catch((e) => live && setErr((e as Error).message));
    return () => {
      live = false;
      if (made.current) URL.revokeObjectURL(made.current);
    };
  }, [ad.id]);

  return (
    <SheetDialog title={ad.title} onClose={onClose} wide>
      <div className="relative bg-black aspect-video flex items-center justify-center">
        {url ? (
          <video src={url} controls autoPlay className="w-full h-full" />
        ) : err ? (
          <span className="text-sm text-destructive px-4 text-center">{err}</span>
        ) : (
          <Loader2 size={18} className="animate-spin text-white/70" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {KIND_LABEL[ad.kind]} · {mb(ad.sizeBytes)} · {ad.isActive ? "showing to residents" : "switched off"}
      </p>
    </SheetDialog>
  );
}
