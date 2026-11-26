import { RotateCw, ArrowLeft } from "lucide-react";
import { KEY_INK, KEY_LINE } from "@/components/sheet/sheetParts";

interface ErrorPageProps {
  error: Error | null;
}

// The crash page, drawn as a drawing sheet: one ruled box with its title block on top and bottom, ink on paper.
// Shown by the app-wide ErrorBoundary, outside every provider, so it uses only theme tokens and plain links.
const RULE = "1px solid hsl(var(--foreground))";
const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

export function ErrorPage({ error }: ErrorPageProps) {
  const isDev = import.meta.env.DEV;
  const errorMessage = error?.message || "An unknown error occurred.";

  const titleBlock = (cells: [string, string][]) => (
    <div className="grid grid-cols-3">
      {cells.map(([label, value], i) => (
        <div key={label} className={`px-4 py-2.5 min-w-0 ${i > 0 ? "border-l border-foreground/20" : ""}`}>
          <p className={LBL}>{label}</p>
          <p className="font-heading text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-foreground truncate mt-0.5">{value}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: "hsl(var(--background))" }}>
      <div className="w-full max-w-xl bg-card" style={{ border: RULE }}>
        <div style={{ borderBottom: RULE }}>
          {titleBlock([
            ["Drawing", "Civilier ERP"],
            ["Sheet", "DWG-ERR · Rev 0"],
            ["Title", "Fault sheet"],
          ])}
        </div>

        <div className="px-6 pt-8 pb-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-destructive" aria-hidden />
            <span className="font-heading text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-destructive">Render error · Site notice</span>
          </div>
          <p className="font-heading text-[4.5rem] sm:text-[5.5rem] font-black leading-none tracking-[-0.05em] text-foreground">ERR</p>
          <h1 className="font-heading text-lg font-bold tracking-tight text-foreground [text-wrap:balance]">
            Something crashed while rendering this page.
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-[60ch]">
            An unexpected error stopped the page from loading. This is usually a temporary fault — refreshing fixes it in
            most cases.
          </p>

          {isDev && (
            <div className="border border-foreground/20 bg-foreground/5 px-3 py-2.5">
              <p className={LBL}>Error</p>
              <p className="font-mono text-[0.6875rem] text-foreground break-all !whitespace-normal mt-1">{errorMessage}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" onClick={() => window.location.reload()} className={`${KEY_INK} h-9 px-5 flex-1 sm:flex-none`}>
              <RotateCw size={13} /> Refresh page
            </button>
            <button type="button" onClick={() => (window.location.href = "/")} className={`${KEY_LINE} h-9 px-4 flex-1 sm:flex-none`}>
              <ArrowLeft size={13} /> Dashboard
            </button>
          </div>
        </div>

        <div style={{ borderTop: RULE }}>
          {titleBlock([
            ["Scale", "N/A"],
            ["Checked", "System"],
            ["Status", "Crashed"],
          ])}
        </div>
      </div>
    </div>
  );
}
