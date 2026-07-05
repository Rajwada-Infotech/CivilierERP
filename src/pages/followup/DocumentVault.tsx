import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  FileText,
  File,
  FileImage,
  FileSpreadsheet,
  Trash2,
  Download,
  Eye,
  Search,
  X,
  FolderOpen,
  Plus,
  RefreshCw,
  Tag,
  StickyNote,
  ChevronDown,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { FollowupShell } from "@/components/followup/FollowupShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  fetchDocumentVaultOptions,
  fetchDocuments,
  uploadDocument,
  updateDocument,
  deleteDocument,
} from "@/api/documentVaultApi";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VaultDocument {
  Id: number;
  DocNo: string;
  ApplicantId: number;
  ApplicantName: string;
  ApplicantCode: string;
  Category: string;
  DocName: string;
  FileName: string;
  FilePath: string;
  FileSize: number;
  MimeType: string | null;
  Notes: string | null;
  Tags: string | null;
  CreatedBy: string;
  CreatedAt: string;
  UpdatedBy: string | null;
  UpdatedAt: string | null;
}

interface MetaOptions {
  categories: string[];
  applicants: { Id: number; ApplicantNo: string; ApplicantName: string }[];
}

interface ListResponse {
  data: VaultDocument[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface UploadForm {
  ApplicantId: string;
  ApplicantName: string;
  Category: string;
  DocName: string;
  Notes: string;
  Tags: string;
  file: File | null;
}

interface EditForm {
  Category: string;
  DocName: string;
  Notes: string;
  Tags: string;
}

const EMPTY_UPLOAD: UploadForm = {
  ApplicantId: "",
  ApplicantName: "",
  Category: "Other",
  DocName: "",
  Notes: "",
  Tags: "",
  file: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(str: string) {
  if (!str) return "";
  return new Date(str).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function mimeIcon(mime: string | null) {
  if (!mime) return <File className="w-5 h-5 text-muted-foreground" />;
  if (mime.startsWith("image/"))
    return <FileImage className="w-5 h-5 text-blue-500" />;
  if (mime === "application/pdf")
    return <FileText className="w-5 h-5 text-red-500" />;
  if (mime.includes("sheet") || mime.includes("excel"))
    return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />;
  if (mime.includes("word"))
    return <FileText className="w-5 h-5 text-indigo-500" />;
  return <File className="w-5 h-5 text-muted-foreground" />;
}

const CATEGORY_COLORS: Record<string, string> = {
  "Identity Proof": "bg-blue-500/10 text-blue-600 border-blue-300/40",
  "Address Proof": "bg-violet-500/10 text-violet-600 border-violet-300/40",
  "Income Proof": "bg-emerald-500/10 text-emerald-600 border-emerald-300/40",
  "Property Document": "bg-amber-500/10 text-amber-600 border-amber-300/40",
  Agreement: "bg-cyan-500/10 text-cyan-600 border-cyan-300/40",
  NOC: "bg-rose-500/10 text-rose-600 border-rose-300/40",
  "Bank Document": "bg-teal-500/10 text-teal-600 border-teal-300/40",
  "Legal Document": "bg-orange-500/10 text-orange-600 border-orange-300/40",
  "Possession Document":
    "bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-300/40",
  Other: "bg-slate-500/10 text-slate-600 border-slate-300/40",
};

function catBadge(cat: string) {
  const cls = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS["Other"];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}
    >
      {cat}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DocumentVaultPage() {
  const qc = useQueryClient();

  // ── Filters ──────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterApp, setFilterApp] = useState("");
  const [page, setPage] = useState(1);

  // ── Dialog states ─────────────────────────────────────────────────────────
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<VaultDocument | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultDocument | null>(null);
  const [previewDoc, setPreviewDoc] = useState<VaultDocument | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Fetch preview file as blob (auth-protected endpoint can't use bare <img src>)
  useEffect(() => {
    if (!previewDoc) {
      setBlobUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    fetchWithAuth(`/api/followup-document-vault/file/${previewDoc.Id}`)
      .then((r) => r.blob())
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => setBlobUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewDoc]);

  // ── Upload form ───────────────────────────────────────────────────────────
  const [form, setForm] = useState<UploadForm>(EMPTY_UPLOAD);
  const [dragOver, setDragOver] = useState(false);
  const [appSearch, setAppSearch] = useState("");
  const [appOpen, setAppOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Edit form ─────────────────────────────────────────────────────────────
  const [editForm, setEditForm] = useState<EditForm>({
    Category: "",
    DocName: "",
    Notes: "",
    Tags: "",
  });

  function set<K extends keyof UploadForm>(k: K, v: UploadForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  function setE<K extends keyof EditForm>(k: K, v: EditForm[K]) {
    setEditForm((f) => ({ ...f, [k]: v }));
  }

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: meta } = useQuery<MetaOptions>({
    queryKey: ["dv-meta"],
    queryFn: fetchDocumentVaultOptions,
    staleTime: 5 * 60 * 1000,
  });

  const queryParams = useMemo(() => {
    const p: Record<string, string> = { page: String(page), pageSize: "20" };
    if (search) p.search = search;
    if (filterCat) p.category = filterCat;
    if (filterApp) p.applicantId = filterApp;
    return p;
  }, [search, filterCat, filterApp, page]);

  const {
    data: listData,
    isFetching,
    refetch,
  } = useQuery<ListResponse>({
    queryKey: ["dv-list", queryParams],
    queryFn: () => fetchDocuments(queryParams),
    placeholderData: (prev) => prev,
  });

  const docs = listData?.data ?? [];
  const pagination = listData?.pagination;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const uploadMut = useMutation({
    mutationFn: (fd: FormData) => uploadDocument(fd),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["dv-list"] });
      toast.success(`Document uploaded — ${data.docNo}`);
      setUploadOpen(false);
      setForm(EMPTY_UPLOAD);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const editMut = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: number;
      payload: Record<string, unknown>;
    }) => updateDocument(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dv-list"] });
      toast.success("Document updated");
      setEditTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteDocument(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dv-list"] });
      toast.success("Document deleted");
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleFileSelect = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const f = files[0];
      set("file", f);
      if (!form.DocName) set("DocName", f.name.replace(/\.[^/.]+$/, ""));
    },
    [form.DocName],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect],
  );

  function handleUploadSubmit() {
    if (!form.file) return toast.error("Please select a file");
    if (!form.ApplicantId) return toast.error("Please select an applicant");
    if (!form.DocName.trim())
      return toast.error("Please enter a document name");

    const fd = new FormData();
    fd.append("file", form.file);
    fd.append("ApplicantId", form.ApplicantId);
    fd.append("Category", form.Category);
    fd.append("DocName", form.DocName.trim());
    fd.append("Notes", form.Notes.trim());
    fd.append("Tags", form.Tags.trim());
    uploadMut.mutate(fd);
  }

  function openEdit(doc: VaultDocument) {
    setEditTarget(doc);
    setEditForm({
      Category: doc.Category,
      DocName: doc.DocName,
      Notes: doc.Notes ?? "",
      Tags: doc.Tags ?? "",
    });
  }

  function handleEditSubmit() {
    if (!editTarget) return;
    editMut.mutate({
      id: editTarget.Id,
      payload: {
        Category: editForm.Category,
        DocName: editForm.DocName,
        Notes: editForm.Notes,
        Tags: editForm.Tags,
      },
    });
  }

  // ── Applicant dropdown filter ─────────────────────────────────────────────
  const filteredApplicants = useMemo(() => {
    if (!meta?.applicants) return [];
    if (!appSearch.trim()) return meta.applicants.slice(0, 50);
    const q = appSearch.toLowerCase();
    return meta.applicants
      .filter(
        (a) =>
          a.ApplicantName.toLowerCase().includes(q) ||
          a.ApplicantNo.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [meta?.applicants, appSearch]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Scoped styles ── */}
      <style>{`
        .dv-page { display: flex; flex-direction: column; height: 100%; padding: 0; }
        .dv-header { padding: 1.25rem 1.5rem 0; }
        .dv-toolbar {
          display: flex; align-items: center; gap: .75rem;
          padding: .75rem 1.5rem; flex-wrap: wrap;
          border-bottom: 1px solid hsl(var(--border));
          background: hsl(var(--card));
        }
        .dv-toolbar-right { margin-left: auto; display: flex; gap: .5rem; align-items: center; }
        .dv-search-wrap { position: relative; }
        .dv-search-wrap svg { position: absolute; left: .625rem; top: 50%; transform: translateY(-50%); opacity: .4; pointer-events: none; }
        .dv-search { height: 2.25rem; padding: 0 .75rem 0 2rem; border-radius: 9px; font-size: .8125rem; width: 220px; background: hsl(var(--background)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); }
        .dv-search:focus { outline: none; box-shadow: 0 0 0 2px hsl(var(--primary)/.25); }
        .dv-select { height: 2.25rem; padding: 0 2rem 0 .75rem; border-radius: 9px; font-size: .8125rem; background: hsl(var(--background)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); cursor: pointer; appearance: none; -webkit-appearance: none; }
        .dv-select:focus { outline: none; }

        .dv-table-wrap { flex: 1; overflow: auto; padding: 0 1.5rem 1.5rem; margin-top: .75rem; }
        .dv-table { width: 100%; border-collapse: collapse; font-size: .8125rem; }
        .dv-table th { text-align: left; padding: .5rem .75rem; font-size: .6875rem; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: hsl(var(--muted-foreground)); white-space: nowrap; border-bottom: 1px solid hsl(var(--border)); }
        .dv-table td { padding: .625rem .75rem; border-bottom: 1px solid hsl(var(--border)/0.5); vertical-align: middle; }
        .dv-table tr:hover td { background: hsl(var(--muted)/0.35); }
        .dv-file-row { display: flex; align-items: center; gap: .5rem; }
        .dv-doc-name { font-weight: 500; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dv-doc-no { font-size: .7rem; color: hsl(var(--muted-foreground)); }
        .dv-actions { display: flex; align-items: center; gap: .25rem; }
        .dv-action-btn { padding: .25rem; border-radius: 6px; transition: background .15s; cursor: pointer; background: transparent; border: none; color: hsl(var(--muted-foreground)); }
        .dv-action-btn:hover { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }
        .dv-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem; gap: .75rem; color: hsl(var(--muted-foreground)); }
        .dv-pagination { display: flex; align-items: center; justify-content: space-between; padding: .75rem 1.5rem; border-top: 1px solid hsl(var(--border)); font-size: .8rem; color: hsl(var(--muted-foreground)); }

        /* Upload form */
        .dv-drop-zone {
          border: 2px dashed hsl(var(--border));
          border-radius: 12px;
          padding: 2rem;
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: .75rem;
          cursor: pointer; transition: all .2s; text-align: center; min-height: 140px;
        }
        .dv-drop-zone:hover, .dv-drop-zone.over { border-color: hsl(var(--primary)); background: hsl(var(--primary)/.04); }
        .dv-drop-zone.has-file { border-color: hsl(var(--primary)); background: hsl(var(--primary)/.06); }
        .dv-file-info { display: flex; align-items: center; gap: .625rem; }
        .dv-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; }
        @media (max-width: 520px) { .dv-form-grid { grid-template-columns: 1fr; } }

        /* Applicant picker */
        .dv-app-picker { position: relative; }
        .dv-app-btn { width: 100%; height: 2.5rem; display: flex; align-items: center; justify-content: space-between; padding: 0 .75rem; border-radius: 9px; font-size: .875rem; background: hsl(var(--background)); border: 1px solid hsl(var(--border)); color: hsl(var(--foreground)); cursor: pointer; }
        .dv-app-btn:focus { outline: none; box-shadow: 0 0 0 2px hsl(var(--primary)/.25); }
        .dv-app-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50; background: hsl(var(--popover)); border: 1px solid hsl(var(--border)); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.12); overflow: hidden; }
        .dv-app-search-wrap { display: flex; align-items: center; gap: .375rem; padding: .5rem .75rem; border-bottom: 1px solid hsl(var(--border)/0.5); }
        .dv-app-search { flex: 1; font-size: .8125rem; background: transparent; border: none; color: hsl(var(--foreground)); outline: none; }
        .dv-app-list { max-height: 200px; overflow-y: auto; }
        .dv-app-item { display: flex; flex-direction: column; padding: .5rem .75rem; cursor: pointer; font-size: .8125rem; }
        .dv-app-item:hover, .dv-app-item.selected { background: hsl(var(--accent)); }
        .dv-app-item-name { font-weight: 500; }
        .dv-app-item-no { font-size: .7rem; color: hsl(var(--muted-foreground)); }
        .dv-app-empty { padding: .75rem; text-align: center; font-size: .8125rem; color: hsl(var(--muted-foreground)); }

        /* Tags display */
        .dv-tags { display: flex; flex-wrap: wrap; gap: .25rem; }
        .dv-tag { font-size: .65rem; padding: .1rem .4rem; border-radius: 4px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); }

        /* Preview dialog */
        .dv-preview-frame { width: 100%; height: 60vh; border: none; border-radius: 8px; background: hsl(var(--muted)); }
      `}</style>

      <Breadcrumbs
        items={[
          { label: "Follow-Up", path: "/followup" },
          { label: "Document Vault" },
        ]}
      />

      <FollowupShell
        title="Document Vault"
        icon={FolderOpen}
        action={
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
              Refresh
            </button>
            <Button
              onClick={() => {
                setForm(EMPTY_UPLOAD);
                setUploadOpen(true);
              }}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              <Upload className="w-4 h-4" /> Upload Document
            </Button>
          </div>
        }
      >

      <div className="dv-page">
        {/* Toolbar */}
        <div className="dv-toolbar">
          <div className="dv-search-wrap">
            <Search style={{ width: 14, height: 14 }} />
            <input
              className="dv-search"
              placeholder="Search documents…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>

          <div className="relative">
            <select
              className="dv-select"
              value={filterCat}
              onChange={(e) => {
                setFilterCat(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All Categories</option>
              {(meta?.categories ?? []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>

          <div className="relative">
            <select
              className="dv-select"
              value={filterApp}
              onChange={(e) => {
                setFilterApp(e.target.value);
                setPage(1);
              }}
              style={{ maxWidth: 200 }}
            >
              <option value="">All Applicants</option>
              {(meta?.applicants ?? []).map((a) => (
                <option key={a.Id} value={a.Id}>{a.ApplicantName}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>

          {(filterCat || filterApp) && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              onClick={() => {
                setFilterCat("");
                setFilterApp("");
                setPage(1);
              }}
            >
              <X style={{ width: 12, height: 12 }} /> Clear
            </button>
          )}

          <div className="dv-toolbar-right">
            <span className="text-xs text-muted-foreground">
              {pagination
                ? `${pagination.total} doc${pagination.total !== 1 ? "s" : ""}`
                : ""}
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="dv-table-wrap">
          {docs.length === 0 && !isFetching ? (
            <div className="dv-empty">
              <FolderOpen className="w-12 h-12 opacity-20" />
              <p className="font-medium">No documents found</p>
              <p className="text-sm">
                Upload the first document to get started.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setForm(EMPTY_UPLOAD);
                  setUploadOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-1" /> Upload Document
              </Button>
            </div>
          ) : (
            <table className="dv-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Applicant</th>
                  <th>Category</th>
                  <th>Size</th>
                  <th>Tags</th>
                  <th>Uploaded</th>
                  <th style={{ width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => (
                  <tr key={doc.Id}>
                    <td>
                      <div className="dv-file-row">
                        {mimeIcon(doc.MimeType)}
                        <div>
                          <div className="dv-doc-name" title={doc.DocName}>
                            {doc.DocName}
                          </div>
                          <div className="dv-doc-no">{doc.DocNo}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="font-medium text-[.8125rem]">
                        {doc.ApplicantName}
                      </div>
                      <div className="text-[.7rem] text-muted-foreground">
                        {doc.ApplicantCode}
                      </div>
                    </td>
                    <td>{catBadge(doc.Category)}</td>
                    <td className="text-muted-foreground">
                      {fmtBytes(doc.FileSize)}
                    </td>
                    <td>
                      {doc.Tags ? (
                        <div className="dv-tags">
                          {doc.Tags.split(",")
                            .filter(Boolean)
                            .map((t) => (
                              <span key={t} className="dv-tag">
                                {t.trim()}
                              </span>
                            ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                    <td className="text-muted-foreground text-xs">
                      <div>{fmtDate(doc.CreatedAt)}</div>
                      <div className="text-[.7rem]">{doc.CreatedBy}</div>
                    </td>
                    <td>
                      <div className="dv-actions">
                        <button
                          className="dv-action-btn"
                          title="Preview"
                          onClick={() => setPreviewDoc(doc)}
                        >
                          <Eye style={{ width: 15, height: 15 }} />
                        </button>
                        <button
                          className="dv-action-btn"
                          title="Download"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetchWithAuth(
                                `/api/followup-document-vault/file/${doc.Id}`,
                              );
                              const blob = await res.blob();
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = doc.FileName;
                              a.click();
                              setTimeout(() => URL.revokeObjectURL(url), 5000);
                            } catch {
                              /* handled */
                            }
                          }}
                        >
                          <Download style={{ width: 15, height: 15 }} />
                        </button>
                        <button
                          className="dv-action-btn"
                          title="Edit metadata"
                          onClick={() => openEdit(doc)}
                        >
                          <StickyNote style={{ width: 15, height: 15 }} />
                        </button>
                        <button
                          className="dv-action-btn"
                          title="Delete"
                          onClick={() => setDeleteTarget(doc)}
                          style={{ color: "hsl(var(--destructive))" }}
                        >
                          <Trash2 style={{ width: 15, height: 15 }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="dv-pagination">
            <span>
              Page {pagination.page} of {pagination.totalPages} ·{" "}
              {pagination.total} documents
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
      </FollowupShell>

      {/* ── Upload Dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(v) => {
          if (!v) {
            setUploadOpen(false);
            setForm(EMPTY_UPLOAD);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Upload Document
            </DialogTitle>
            <DialogDescription className="sr-only">
              Upload a document and associate it with an applicant.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            {/* Drop zone */}
            <div
              className={`dv-drop-zone${dragOver ? " over" : ""}${form.file ? " has-file" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.txt"
                onChange={(e) => handleFileSelect(e.target.files)}
              />
              {form.file ? (
                <div className="dv-file-info">
                  {mimeIcon(form.file.type)}
                  <div>
                    <div className="font-medium text-sm">{form.file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {fmtBytes(form.file.size)}
                    </div>
                  </div>
                  <button
                    className="ml-2 text-muted-foreground hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      set("file", null);
                    }}
                  >
                    <X style={{ width: 14, height: 14 }} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-muted-foreground opacity-40" />
                  <div>
                    <div className="font-medium text-sm">
                      Drop file here or click to browse
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      PDF, Images, Word, Excel · Max 25 MB
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Applicant picker */}
            <div className="space-y-2">
              <Label>
                Applicant <span className="text-destructive">*</span>
              </Label>
              <div className="dv-app-picker">
                <button
                  type="button"
                  className="dv-app-btn"
                  onClick={() => setAppOpen((v) => !v)}
                >
                  <span
                    className={
                      form.ApplicantName ? "" : "text-muted-foreground"
                    }
                  >
                    {form.ApplicantName || "Select applicant…"}
                  </span>
                  <div className="flex items-center gap-1">
                    {form.ApplicantId && (
                      <span
                        className="text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          set("ApplicantId", "");
                          set("ApplicantName", "");
                        }}
                      >
                        <X style={{ width: 12, height: 12 }} />
                      </span>
                    )}
                    <ChevronDown
                      style={{ width: 14, height: 14 }}
                      className="text-muted-foreground"
                    />
                  </div>
                </button>

                {appOpen && (
                  <div className="dv-app-dropdown">
                    <div className="dv-app-search-wrap">
                      <Search
                        style={{ width: 13, height: 13 }}
                        className="text-muted-foreground"
                      />
                      <input
                        className="dv-app-search"
                        placeholder="Search applicant…"
                        value={appSearch}
                        onChange={(e) => setAppSearch(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="dv-app-list">
                      {filteredApplicants.length === 0 ? (
                        <div className="dv-app-empty">No applicants found</div>
                      ) : (
                        filteredApplicants.map((a) => (
                          <button
                            key={a.Id}
                            type="button"
                            className={`dv-app-item${String(a.Id) === form.ApplicantId ? " selected" : ""}`}
                            onClick={() => {
                              set("ApplicantId", String(a.Id));
                              set("ApplicantName", a.ApplicantName);
                              setAppOpen(false);
                            }}
                          >
                            <span className="dv-app-item-name">
                              {a.ApplicantName}
                            </span>
                            <span className="dv-app-item-no">
                              {a.ApplicantNo}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Category + Doc Name */}
            <div className="dv-form-grid">
              <div className="space-y-2">
                <Label>Category</Label>
                <select
                  value={form.Category}
                  onChange={(e) => set("Category", e.target.value)}
                  className="w-full h-10 px-3 rounded-[9px] text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {(meta?.categories ?? ["Other"]).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>
                  Document Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.DocName}
                  onChange={(e) => set("DocName", e.target.value)}
                  placeholder="e.g. Aadhaar Card"
                  className="rounded-[9px]"
                />
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Tag size={12} /> Tags
                <span className="text-xs font-normal text-muted-foreground">
                  (comma-separated)
                </span>
              </Label>
              <Input
                value={form.Tags}
                onChange={(e) => set("Tags", e.target.value)}
                placeholder="e.g. kyc, original, verified"
                className="rounded-[9px]"
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={form.Notes}
                onChange={(e) => set("Notes", e.target.value)}
                placeholder="Any additional remarks…"
                rows={2}
                className="rounded-[9px] resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUploadOpen(false)}
              className="rounded-[9px]"
            >
              Cancel
            </Button>
            <Button
              disabled={
                !form.file ||
                !form.ApplicantId ||
                !form.DocName.trim() ||
                uploadMut.isPending
              }
              onClick={handleUploadSubmit}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {uploadMut.isPending ? (
                "Uploading…"
              ) : (
                <>
                  <Upload className="w-4 h-4" /> Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Metadata Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={!!editTarget}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Document</DialogTitle>
            <DialogDescription className="sr-only">
              Update the metadata for this document.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-2">
              <Label>Category</Label>
              <select
                value={editForm.Category}
                onChange={(e) => setE("Category", e.target.value)}
                className="w-full h-10 px-3 rounded-[9px] text-sm bg-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {(meta?.categories ?? ["Other"]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Document Name</Label>
              <Input
                value={editForm.DocName}
                onChange={(e) => setE("DocName", e.target.value)}
                className="rounded-[9px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Tag size={12} /> Tags
              </Label>
              <Input
                value={editForm.Tags}
                onChange={(e) => setE("Tags", e.target.value)}
                placeholder="comma-separated tags"
                className="rounded-[9px]"
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={editForm.Notes}
                onChange={(e) => setE("Notes", e.target.value)}
                rows={2}
                className="rounded-[9px] resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              className="rounded-[9px]"
            >
              Cancel
            </Button>
            <Button
              disabled={editMut.isPending}
              onClick={handleEditSubmit}
              className="gradient-accent gap-1.5 font-semibold text-white text-sm px-5 py-2 h-auto"
            >
              {editMut.isPending ? (
                "Saving…"
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" /> Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ────────────────────────────────────────── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Document?</DialogTitle>
            <DialogDescription className="sr-only">
              Confirm permanent deletion of this document.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete{" "}
            <strong>{deleteTarget?.DocName}</strong> ({deleteTarget?.DocNo}) and
            remove the file from storage. This cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="rounded-[9px]"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.Id)}
              className="rounded-[9px]"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Preview Dialog ───────────────────────────────────────────────── */}
      <Dialog
        open={!!previewDoc}
        onOpenChange={(v) => {
          if (!v) setPreviewDoc(null);
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {previewDoc && mimeIcon(previewDoc.MimeType)}
              {previewDoc?.DocName}
              <span className="text-xs font-normal text-muted-foreground ml-1">
                {previewDoc?.DocNo}
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Preview and download the selected document.
            </DialogDescription>
          </DialogHeader>

          {previewDoc && (
            <div className="space-y-3">
              {/* Render inline if PDF or image, else show download prompt */}
              {previewDoc.MimeType?.startsWith("image/") ? (
                blobUrl ? (
                  <img
                    src={blobUrl}
                    alt={previewDoc.DocName}
                    className="max-h-[60vh] w-full object-contain rounded-lg border border-border"
                  />
                ) : (
                  <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                    Loading preview…
                  </div>
                )
              ) : previewDoc.MimeType === "application/pdf" ? (
                blobUrl ? (
                  <iframe
                    src={blobUrl}
                    className="dv-preview-frame"
                    title={previewDoc.DocName}
                  />
                ) : (
                  <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                    Loading preview…
                  </div>
                )
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 p-8 rounded-lg border border-border bg-muted/40">
                  {mimeIcon(previewDoc.MimeType)}
                  <p className="text-sm text-muted-foreground">
                    Preview not available for this file type.
                  </p>
                  <button
                    className="text-sm underline text-primary"
                    onClick={async () => {
                      if (!previewDoc) return;
                      try {
                        const res = await fetchWithAuth(
                          `/api/followup-document-vault/file/${previewDoc.Id}`,
                        );
                        const blob = await res.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = previewDoc.FileName;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 5000);
                      } catch {
                        /* handled */
                      }
                    }}
                  >
                    Download to view
                  </button>
                </div>
              )}

              {/* Meta row */}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1 border-t border-border">
                <span>{catBadge(previewDoc.Category)}</span>
                <span>{fmtBytes(previewDoc.FileSize)}</span>
                <span>Uploaded by {previewDoc.CreatedBy}</span>
                <span>{fmtDate(previewDoc.CreatedAt)}</span>
              </div>

              {previewDoc.Notes && (
                <p className="text-xs text-muted-foreground italic">
                  {previewDoc.Notes}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {previewDoc && (
              <Button
                variant="outline"
                className="rounded-[9px] gap-1.5"
                onClick={async () => {
                  if (!previewDoc) return;
                  try {
                    const res = await fetchWithAuth(
                      `/api/followup-document-vault/file/${previewDoc.Id}`,
                    );
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = previewDoc.FileName;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                  } catch {
                    /* toast handled by fetchWithAuth */
                  }
                }}
              >
                <Download className="w-4 h-4" /> Download
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setPreviewDoc(null)}
              className="rounded-[9px]"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
