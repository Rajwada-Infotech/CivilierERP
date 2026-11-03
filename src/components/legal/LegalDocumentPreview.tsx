import React, { useEffect, useState } from "react";
import { ArrowLeft, Download, ExternalLink, FileText, Globe, Loader2, X } from "lucide-react";
import { fetchLegalFile } from "@/api/legalMastersApi";

// The Legal side panel, docked on the right of the page — not a modal: the table stays usable beside it.
// It shows either a record's details (showLegalDetails) or a document (previewLegalFile, PDF or image).
// A document opened from the details keeps a "Back to details" button. LegalShell places it next to
// the page content, so every Legal page has it.

const EVENT = "legal:side-panel";

/** Below this page-area width (phones) the panel is a bottom sheet; from here up it docks on the right. */
export const PANEL_DOCK_MIN_WIDTH = 640;

export interface LegalDetailItem {
  label: string;
  value: string;
  /** A document field: the uploaded file's id (the value is its name). */
  fileId?: string;
  /** Long text: shown across the full panel width. */
  wide?: boolean;
  /** A web link: opens in the panel. */
  url?: boolean;
}

type Details = { kind: "details"; title: string; items: LegalDetailItem[] };
type Site = { kind: "site"; url: string; name: string; back?: Details };
type Doc = { kind: "doc"; id: string; name: string; back?: Details };
type Panel = Details | Doc | Site;

const show = (detail: Panel) => window.dispatchEvent(new CustomEvent(EVENT, { detail }));

/** Show an uploaded document in the right-side panel. */
export const previewLegalFile = (id: unknown, name?: string) => show({ kind: "doc", id: String(id), name: name || "Document" });

/** Open a website (an office or portal link) in the right-side panel. */
export const openLegalLink = (url: string, name?: string) => show({ kind: "site", url, name: name || url });

/** A link cell: opens the site in the side panel. */
export const LegalLinkChip: React.FC<{ url: unknown; name?: string; onOpen?: () => void }> = ({ url, name, onOpen }) =>
  url ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (onOpen) onOpen(); else openLegalLink(String(url), name); }}
      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-left text-xs hover:bg-muted"
      title={String(url)}
    >
      <Globe size={13} className="shrink-0 text-sky-600" /> <span className="truncate">{String(url).replace(/^https?:\/\//, "")}</span>
    </button>
  ) : <span className="text-muted-foreground">—</span>;

/** Show a record's details in the right-side panel. */
export const showLegalDetails = (title: string, items: LegalDetailItem[]) => show({ kind: "details", title, items });

/** A document cell / link: file icon and name; clicking it opens the preview. */
export const LegalFileLink: React.FC<{ id: unknown; name?: string; className?: string; onOpen?: () => void }> = ({ id, name, className = "", onOpen }) =>
  id ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (onOpen) onOpen(); else previewLegalFile(id, name); }}
      className={`inline-flex max-w-[220px] items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-left text-xs hover:bg-muted ${className}`}
      title={`Preview ${name || "document"}`}
    >
      <FileText size={13} className="shrink-0 text-[#7c4a2e] dark:text-[#c48e5c]" /> <span className="truncate">{name || "Document"}</span>
    </button>
  ) : <span className="text-muted-foreground">—</span>;

const btn = "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted";

const DocView: React.FC<{ doc: Doc }> = ({ doc }) => {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    setFile(null);
    setError(null);
    fetchLegalFile(doc.id)
      .then((f) => { url = f.url; if (live) setFile(f); else URL.revokeObjectURL(f.url); })
      .catch((e: Error) => live && setError(e.message));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [doc]);

  return (
    <>
      {file && (
        <div className="flex flex-wrap gap-2">
          <a className={btn} href={file.url} download={doc.name}><Download size={13} /> Download</a>
          <a className={btn} href={file.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open in new tab</a>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-muted/30">
        {error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : !file ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading…</div>
        ) : file.type.startsWith("image/") ? (
          <div className="flex h-full items-center justify-center overflow-auto p-3"><img src={file.url} alt={doc.name} className="max-h-full max-w-full object-contain" /></div>
        ) : (
          <iframe title={doc.name} src={file.url} className="h-full w-full bg-white" />
        )}
      </div>
    </>
  );
};

const SiteView: React.FC<{ site: Site }> = ({ site }) => (
  <>
    <div className="flex flex-wrap gap-2">
      <a className={btn} href={site.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Open in new tab</a>
    </div>
    <p className="text-[0.6875rem] text-muted-foreground">If the page stays blank, the site does not allow being shown inside another page — use Open in new tab.</p>
    <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-white">
      <iframe title={site.name} src={site.url} className="h-full w-full" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerPolicy="no-referrer" />
    </div>
  </>
);

const DetailsView: React.FC<{ details: Details; openDoc: (d: Doc | Site) => void }> = ({ details, openDoc }) => (
  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 min-[420px]:grid-cols-2">
      {details.items.map((it) => (
        <div key={it.label} className={it.wide ? "col-span-2" : ""}>
          <dt className="text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-foreground whitespace-pre-line">
            {it.fileId !== undefined
              ? <LegalFileLink id={it.fileId} name={it.value} onOpen={() => openDoc({ kind: "doc", id: it.fileId!, name: it.value || "Document", back: details })} />
              : it.url && it.value
                ? <LegalLinkChip url={it.value} onOpen={() => openDoc({ kind: "site", url: it.value, name: it.label, back: details })} />
                : it.value || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  </div>
);

export const LegalDocumentPreview: React.FC<{ dock: boolean }> = ({ dock }) => {
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    const open = (e: Event) => setPanel((e as CustomEvent<Panel>).detail);
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);

  // Bring the whole panel into view when it opens or changes (it sits beside a page that may be scrolled).
  const ref = React.useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    // Only the docked panel sits in the page; the sliding one is always in view.
    if (dock && (top < 72 || top > window.innerHeight - 120)) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [panel, dock]);

  // Esc closes the sliding panel.
  useEffect(() => {
    if (!panel || dock) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, dock]);

  if (!panel) return null;
  const isDoc = panel.kind === "doc";
  const isSite = panel.kind === "site";
  const back = panel.kind === "details" ? undefined : panel.back;
  const title = panel.kind === "details" ? panel.title : panel.name;
  return (
    <>
    {/* Not enough room to dock: dim the page behind the sliding panel; tap it to close. */}
    {!dock && <button type="button" aria-label="Close panel" onClick={() => setPanel(null)} className="fixed inset-0 z-40 bg-black/30" />}
    <aside
      ref={ref}
      className={dock
        // Docked beside the page, under the fixed top bar; its width follows the space (38%, 320–560 px).
        ? "sticky top-[4.5rem] flex h-[calc(100vh-5.5rem)] w-[clamp(320px,38%,560px)] shrink-0 flex-col gap-3 rounded-2xl border border-border bg-card/90 p-4 shadow-sm backdrop-blur-lg"
        // Phones: a bottom sheet over the page.
        : "fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col gap-3 rounded-t-2xl border border-border bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"}
    >
      {!dock && <div className="mx-auto -mt-1 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden />}
      <div className="flex items-start gap-2">
        {back ? (
          <button type="button" onClick={() => setPanel(back)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to details" title="Back to details">
            <ArrowLeft size={16} />
          </button>
        ) : isDoc ? <FileText size={16} className="mt-0.5 shrink-0 text-[#7c4a2e] dark:text-[#c48e5c]" /> : isSite ? <Globe size={16} className="mt-0.5 shrink-0 text-sky-600" /> : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground" title={title}>{title}</p>
          <p className="text-[0.6875rem] text-muted-foreground">{isSite ? (panel.kind === "site" ? panel.url : "") : isDoc ? (back ? `Document of ${back.title}` : "Document preview") : "Details"}</p>
        </div>
        <button type="button" onClick={() => setPanel(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close panel"><X size={16} /></button>
      </div>
      {panel.kind === "doc" ? <DocView doc={panel} /> : panel.kind === "site" ? <SiteView site={panel} /> : <DetailsView details={panel} openDoc={setPanel} />}
    </aside>
    </>
  );
};
