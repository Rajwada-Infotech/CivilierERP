// Public (no sign-in) so the link and QR codes can be shared freely. Each app's version, build, size and date come
// from what was last published in the APK Manager (GET /api/app-releases/public); an app published by hand into the
// downloads folder before the APK Manager existed is still offered, without a version, as long as its file is there.
import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download } from "lucide-react";
import { SheetShell } from "@/components/sheet/Sheet";
import { apiUrl } from "@/lib/apiBase";

interface PublicApp {
  appKey: string;
  label: string;
  filePath: string;
  current: { versionName: string | null; versionCode: number; sizeBytes: number; publishedAt: string; downloadPath: string } | null;
}

// Who each app is for; the name, version and file come from the server.
const ABOUT: Record<string, string> = {
  "finance-material": "Finance and Material on the phone: invoices, payments, requests, orders and stock.",
  admin: "For admins: users, rights and the system console.",
  supplier: "For suppliers: the Supplier Portal — enquiries, quotes and orders.",
  "fixed-asset": "For asset custodians: tag and track fixed assets.",
  "follow-up": "For task follow-ups: tasks, close / cancel, transfer and performance.",
  maintenance: "For maintenance and security teams: bills, attendance, electricity and the directory.",
  cwd: "For site engineers, QC and approvers: allocation, reporting, quality check and transfer.",
};

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const fmtMB = (b: number) => `${(b / (1024 * 1024)).toFixed(1)} MB`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

/** null = still checking; for an app with no published release, whether its file is there at all. */
function useFileThere(path: string, skip: boolean) {
  const [there, setThere] = useState<boolean | null>(skip ? true : null);
  useEffect(() => {
    if (skip) return;
    let live = true;
    fetch(path, { method: "HEAD", cache: "no-store" })
      .then((r) => live && setThere(r.ok && !(r.headers.get("content-type") || "").includes("text/html")))
      .catch(() => live && setThere(false));
    return () => {
      live = false;
    };
  }, [path, skip]);
  return there;
}

function AppCard({ app }: { app: PublicApp }) {
  const rel = app.current;
  const there = useFileThere(app.filePath, !!rel);
  const href = rel?.downloadPath ?? app.filePath;
  const url = typeof window !== "undefined" ? `${window.location.origin}${href}` : href;
  const ready = !!rel || there === true;
  const fileName = app.filePath.split("/").pop();

  return (
    <div className="bg-card flex flex-col" style={{ border: RULE }}>
      <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.2)" }}>
        <h2 className="font-heading text-base font-bold tracking-tight text-foreground">{app.label}</h2>
        {/* Two lines kept for every description, so the figures, codes and buttons line up across a row. */}
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed min-h-[3.25em]">{ABOUT[app.appKey] ?? ""}</p>
      </div>

      <div className="grid grid-cols-3" style={{ borderBottom: "1px solid hsl(var(--foreground) / 0.2)" }}>
        {[
          { label: "Version", value: rel ? rel.versionName || "—" : "—", note: rel ? `build ${rel.versionCode}` : "" },
          { label: "Size", value: rel ? fmtMB(rel.sizeBytes) : "—" },
          { label: "Released", value: rel ? fmtDate(rel.publishedAt) : "—" },
        ].map((x, i) => (
          <div key={x.label} className="px-4 py-3 min-w-0" style={i ? { borderLeft: "1px solid hsl(var(--foreground) / 0.15)" } : undefined}>
            <p className={LBL}>{x.label}</p>
            <p className="font-heading text-sm font-bold tabular-nums text-foreground mt-0.5 truncate">{x.value}</p>
            {x.note && <p className="text-[0.6875rem] text-muted-foreground tabular-nums">{x.note}</p>}
          </div>
        ))}
      </div>

      <div className="flex-1 flex flex-col items-center gap-4 p-5">
        {ready ? (
          <>
            <div className="p-3 bg-white" style={{ border: "1px solid hsl(var(--foreground) / 0.25)" }}>
              <QRCodeSVG value={url} size={156} level="M" />
            </div>
            <a
              href={href}
              download={fileName}
              className="mt-auto w-full h-10 inline-flex items-center justify-center gap-2 bg-foreground text-card border border-foreground font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] hover:opacity-90 transition-opacity"
            >
              <Download size={14} /> Download APK
            </a>
          </>
        ) : (
          <p className="my-auto py-10 text-center text-sm text-muted-foreground">
            {there === null ? "Checking…" : "Not published yet."}
          </p>
        )}
      </div>
    </div>
  );
}

export default function DownloadAndroidApp() {
  const [apps, setApps] = useState<PublicApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/app-releases/public"), { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(body)) throw new Error(body?.error || "Could not load the apps.");
        setApps(body);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="min-h-screen w-full bg-background px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <SheetShell
          eyebrow="CivilierERP · Android"
          title="Get the apps"
          subtitle="Scan a code with the phone's camera, or open this page on the phone and tap Download. Each app checks for a newer build when it opens."
        >
          {error ? (
            <p className="py-10 text-center text-sm text-destructive">{error}</p>
          ) : !apps ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {apps.map((app) => (
                <AppCard key={app.appKey} app={app} />
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed max-w-[70ch]">
            Android warns about installing from an unknown source — expected for an app outside the Play Store. Allow the
            install for your browser in the phone's settings when it asks, then open the downloaded file again.
          </p>
        </SheetShell>
      </div>
    </div>
  );
}
