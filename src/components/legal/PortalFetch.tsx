import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { savePortalFetch } from "@/api/legalDiligenceApi";
import { DownloadCloud } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchFromPortal, getEnabledPortals, type PortalResult, type PortalValues } from "@/api/legalPortalApi";

/** What a site's API answered: a field / value table for JSON, the raw text otherwise. */
export const PortalResultView: React.FC<{ r: PortalResult }> = ({ r }) => {
  const flat: [string, string][] = [];
  const walk = (v: unknown, path: string) => {
    if (flat.length >= 300) return;
    if (v && typeof v === "object") {
      const entries = Array.isArray(v) ? v.map((x, i) => [String(i + 1), x] as const) : Object.entries(v as Record<string, unknown>);
      if (!entries.length) flat.push([path || "(empty)", "—"]);
      for (const [k, x] of entries) walk(x, path ? `${path} › ${k}` : k);
    } else flat.push([path || "value", v == null ? "—" : String(v)]);
  };
  if (r.data != null) walk(r.data, "");
  return (
    <div className="space-y-2">
      <p className={`text-xs ${r.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
        {r.ok ? "Answered" : "The site answered with an error"} · HTTP {r.status} · {r.ms} ms{r.truncated ? " · cut to 200 KB" : ""}
      </p>
      {r.data != null ? (
        <div className="max-h-[50vh] overflow-auto border border-border">
          <table className="w-full text-xs">
            <tbody>
              {flat.map(([k, v], i) => (
                <tr key={i} className="border-b border-border last:border-0 align-top">
                  <td className="w-2/5 px-2 py-1 text-muted-foreground">{k}</td>
                  <td className="px-2 py-1 break-words text-foreground">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap border border-border p-2 text-xs">{r.text || "(no content)"}</pre>
      )}
    </div>
  );
};

/** "Fetch from <site>" for every Government Site Link whose API is switched on (Admin → API Integration). */
export const PortalFetchButtons: React.FC<{ values: PortalValues; className?: string; title?: string; landId?: number }> = ({ values, className = "", title, landId }) => {
  const [match, setMatch] = useState("");
  const [note, setNote] = useState("");
  const { data } = useQuery({ queryKey: ["legal-portal-enabled"], queryFn: getEnabledPortals, staleTime: 5 * 60_000 });
  const [busy, setBusy] = useState<number | null>(null);
  const [shown, setShown] = useState<{ label: string; linkId: number; r: PortalResult } | null>(null);
  if (!data?.length) return null;

  const run = async (linkId: number, label: string) => {
    setBusy(linkId);
    try { setShown({ label, linkId, r: await fetchFromPortal(linkId, values) }); setMatch(""); setNote(""); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not fetch"); }
    finally { setBusy(null); }
  };

  return (
    <>
      <span className={`inline-flex flex-wrap gap-1.5 ${className}`}>
        {data.map((p) => (
          <button key={p.LinkId} type="button" disabled={busy !== null} onClick={(e) => { e.stopPropagation(); run(p.LinkId, p.LinkLabel); }}
            title={`Fetch ${p.ServiceType} details from ${p.LinkLabel}`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
            <DownloadCloud size={12} /> {busy === p.LinkId ? "Fetching…" : p.LinkLabel}
          </button>
        ))}
      </span>
      <Dialog open={!!shown} onOpenChange={(o) => { if (!o) setShown(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{shown?.label}{title ? ` · ${title}` : ""}</DialogTitle>
            <DialogDescription>What the site's API returned for this land. Check it, then enter what you need in the form.</DialogDescription>
          </DialogHeader>
          {shown && <PortalResultView r={shown.r} />}
          {/* Keep what was fetched as evidence on the land: source, time, officer, comparison with our records. */}
          {shown && landId ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-[0.6875rem] text-muted-foreground">Source: {shown.r.sourceUrl ?? "—"} · Government site data is a check, not conclusive proof of title.</p>
              <div className="flex flex-wrap items-end gap-2">
                <select className="h-8 border border-border bg-background px-2 text-xs" value={match} onChange={(e) => setMatch(e.target.value)}>
                  <option value="">Compared with our records…</option>
                  {["Matches our records", "Partly matches", "Does not match", "Not compared"].map((m) => <option key={m}>{m}</option>)}
                </select>
                <input className="h-8 min-w-[200px] flex-1 border border-border bg-background px-2 text-xs" placeholder="Verification remarks" value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="h-8 bg-foreground px-3 text-xs font-semibold text-card disabled:opacity-40" disabled={!match} onClick={async () => {
                  try {
                    toast.success((await savePortalFetch(landId, { linkId: shown.linkId, siteName: shown.label, sourceUrl: shown.r.sourceUrl, matchResult: match, remarks: note,
                      response: shown.r.text ?? JSON.stringify(shown.r.data ?? null) })).message);
                    setShown(null);
                  } catch (e) { toast.error(e instanceof Error ? e.message : "Could not save"); }
                }}>Save as evidence</button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};
