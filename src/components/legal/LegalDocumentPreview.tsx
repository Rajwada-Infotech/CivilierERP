import React, { useEffect, useState } from "react";
import { ArrowLeft, Download, ExternalLink, FileText, Loader2, X } from "lucide-react";
import { fetchLegalFile } from "@/api/legalMastersApi";

// The Legal side panel, docked on the right of the page — not a modal: the table stays usable beside it.
// It shows either a record's details (showLegalDetails) or a document (previewLegalFile, PDF or image).
// A document opened from the details keeps a "Back to details" button. LegalShell places it next to
// the page content, so every Legal page has it.

const EVENT = "legal:side-panel";

export interface LegalDetailItem {
  label: string;
  value: string;
  /** A document field: the uploaded file's id (the value is its name). */
  fileId?: string;
  /** Long text: shown across the full panel width. */
  wide?: boolean;
}

type Details = { kind: "details"; title: string; items: LegalDetailItem[] };
type Doc = { kind: "doc"; id: string; name: string; back?: Details };
type Panel = Details | Doc;

const show = (detail: Panel) => window.dispatchEvent(new CustomEvent(EVENT, { detail }));

/** Show an uploaded document in the right-side panel. */
export const previewLegalFile = (id: unknown, name?: string) => show({ kind: "doc", id: String(id), name: name || "Document" });

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
      <FileText size={13} className="shrink-0 text-rose-700" /> <span className="truncate">{name || "Document"}</span>
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
        <div className="flex gap-2">
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

const DetailsView: React.FC<{ details: Details; openDoc: (d: Doc) => void }> = ({ details, openDoc }) => (
  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {details.items.map((it) => (
        <div key={it.label} className={it.wide ? "col-span-2" : ""}>
          <dt className="text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-foreground whitespace-pre-line">
            {it.fileId !== undefined
              ? <LegalFileLink id={it.fileId} name={it.value} onOpen={() => openDoc({ kind: "doc", id: it.fileId!, name: it.value || "Document", back: details })} />
              : it.value || <span className="text-muted-foreground">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  </div>
);

export const LegalDocumentPreview: React.FC = () => {
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    const open = (e: Event) => setPanel((e as CustomEvent<Panel>).detail);
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);

  if (!panel) return null;
  const isDoc = panel.kind === "doc";
  return (
    <aside className="order-first flex h-[70vh] flex-col gap-3 rounded-2xl border border-border bg-card/90 p-4 shadow-sm backdrop-blur-lg lg:order-none lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)] lg:w-[40%] lg:shrink-0">
      <div className="flex items-start gap-2">
        {isDoc && panel.back ? (
          <button type="button" onClick={() => setPanel(panel.back!)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to details" title="Back to details">
            <ArrowLeft size={16} />
          </button>
        ) : isDoc ? <FileText size={16} className="mt-0.5 shrink-0 text-rose-700" /> : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground" title={isDoc ? panel.name : panel.title}>{isDoc ? panel.name : panel.title}</p>
          <p className="text-[0.6875rem] text-muted-foreground">{isDoc ? (panel.back ? `Document of ${panel.back.title}` : "Document preview") : "Details"}</p>
        </div>
        <button type="button" onClick={() => setPanel(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close panel"><X size={16} /></button>
      </div>
      {isDoc ? <DocView doc={panel} /> : <DetailsView details={panel} openDoc={setPanel} />}
    </aside>
  );
};
