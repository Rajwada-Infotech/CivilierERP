import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";
import {
  Trash2,
  Edit3,
  UploadCloud,
  X,
  Image as ImageIcon,
  CheckCircle2,
  Plus,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";

interface SignatureItem {
  Id: number;
  Name: string;
  Owner: string;
  Status: "active" | "inactive";
  ImageData: string;
  AddedAt: string;
}

const MAX_BYTES = 2 * 1024 * 1024;

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const FIELD = "w-full h-9 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground transition-colors disabled:opacity-40";

export default function Signature() {
  const qc = useQueryClient();
  const rights = usePageRights("admin-signatures");
  const [formData, setFormData] = useState({
    name: "",
    owner: "",
    imagePreview: "",
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: signatures = [], isLoading } = useQuery<SignatureItem[]>({
    queryKey: ["signatures"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/signatures");
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json().catch(() => []);
      return Array.isArray(json) ? json : [];
    },
    staleTime: 5 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editingId
        ? `/api/signatures/${editingId}`
        : "/api/signatures";
      const body = {
        name: formData.name,
        owner: formData.owner,
        imageData: formData.imagePreview || undefined,
      };
      const res = await fetchWithAuth(url, {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Save failed");
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "Signature updated" : "Signature added");
      qc.invalidateQueries({ queryKey: ["signatures"] });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const res = await fetchWithAuth(`/api/signatures/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["signatures"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetchWithAuth(`/api/signatures/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed");
    },
    onSuccess: (_d, id) => {
      toast.success("Signature deleted");
      setDeleteId(null);
      if (editingId === id) resetForm();
      qc.invalidateQueries({ queryKey: ["signatures"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const readFile = (file: File) => {
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      toast.error("Choose a PNG or JPG image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("The image is larger than 2 MB");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) =>
      setFormData((p) => ({
        ...p,
        imagePreview: (e.target?.result as string) || "",
      }));
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setFormData({ name: "", owner: "", imagePreview: "" });
    if (fileInputRef.current) fileInputRef.current.value = "";
    setEditingId(null);
  };

  const startEditing = (sig: SignatureItem) => {
    setEditingId(sig.Id);
    setFormData({
      name: sig.Name,
      owner: sig.Owner,
      imagePreview: sig.ImageData ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isEditing = editingId !== null;
  const activeCount = signatures.filter((s) => s.Status === "active").length;
  const showForm = isEditing ? rights.canEdit : rights.canCreate;

  return (
    <>
      <Breadcrumbs items={["Admin", "Signatures"]} />
      <SheetShell
        eyebrow="CivilierERP · Admin"
        title="Digital signatures"
        subtitle="Signatures printed on approved documents, and who each one belongs to."
      >
        {/* Counts */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Signatures", value: signatures.length, note: "in the library" },
              { label: "Active", value: activeCount, note: "available to documents" },
              { label: "Inactive", value: signatures.length - activeCount, note: "kept, not offered" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{isLoading ? "…" : x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-card" style={{ border: RULE }}>
            <div className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
              <span className={HEAD}>{isEditing ? "Edit signature" : "Add a signature"}</span>
              {isEditing && (
                <span className="font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.1em] px-1.5 py-0.5 border border-dashed border-foreground text-foreground">
                  Editing
                </span>
              )}
            </div>
            <div className="p-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="sig-name" className={`${LBL} block`}>
                      Signature name <span className="text-destructive">*</span>
                    </label>
                    <input
                      id="sig-name"
                      placeholder="e.g. CEO Approval Signature"
                      value={formData.name}
                      onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                      className={FIELD}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="sig-owner" className={`${LBL} block`}>
                      Owner <span className="text-destructive">*</span>
                    </label>
                    <input
                      id="sig-owner"
                      placeholder="e.g. John Doe"
                      value={formData.owner}
                      onChange={(e) => setFormData((p) => ({ ...p, owner: e.target.value }))}
                      className={FIELD}
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => saveMutation.mutate()}
                      disabled={!formData.name.trim() || !formData.owner.trim() || saveMutation.isPending}
                      className={`${KEY_INK} h-9 px-5`}
                    >
                      {saveMutation.isPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : justSaved ? (
                        <CheckCircle2 size={13} />
                      ) : isEditing ? (
                        <Edit3 size={13} />
                      ) : (
                        <Plus size={13} />
                      )}
                      {saveMutation.isPending ? "Saving…" : justSaved ? "Saved" : isEditing ? "Update signature" : "Add signature"}
                    </button>
                    {isEditing && (
                      <button type="button" onClick={resetForm} className={`${KEY_LINE} h-9 px-4`}>
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className={`${LBL} block`}>Signature image</span>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Upload a signature image"
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      const f = e.dataTransfer.files?.[0];
                      if (f) readFile(f);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative flex flex-col items-center justify-center w-full h-40 border cursor-pointer transition-colors bg-card ${dragOver ? "border-foreground bg-primary/5" : formData.imagePreview ? "border-foreground/60" : "border-dashed border-foreground/50 hover:border-foreground"}`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/jpg"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) readFile(f);
                      }}
                    />
                    {formData.imagePreview ? (
                      <>
                        <img src={formData.imagePreview} alt="Preview" className="max-h-32 max-w-full object-contain px-6" />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFormData((p) => ({ ...p, imagePreview: "" }));
                            if (fileInputRef.current) fileInputRef.current.value = "";
                          }}
                          className={`absolute top-2 right-2 ${ACT} bg-card border-foreground/40 hover:text-destructive hover:border-destructive`}
                          aria-label="Remove image"
                          title="Remove image"
                        >
                          <X size={12} />
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-center px-4 pointer-events-none">
                        <UploadCloud size={20} className="text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          <span className="font-semibold text-foreground underline underline-offset-2">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-[0.625rem] text-muted-foreground">PNG or JPG, up to 2 MB</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Library */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="px-4 py-3" style={{ borderBottom: RULE }}>
            <span className={HEAD}>
              Signature library <span className="font-normal text-muted-foreground tabular-nums ml-1">{signatures.length}</span>
            </span>
          </div>
          <div className="p-4">
            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            ) : signatures.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 border border-dashed border-foreground/40">
                <p className="text-sm text-muted-foreground">No signatures yet.</p>
                {rights.canCreate && <p className="text-xs text-muted-foreground mt-1">Add the first one with the form above.</p>}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {signatures.map((sig) => {
                  const active = sig.Status === "active";
                  const confirming = deleteId === sig.Id;
                  return (
                    <div
                      key={sig.Id}
                      className={`flex flex-col bg-card border ${editingId === sig.Id ? "border-foreground border-2" : active ? "border-foreground" : "border-dashed border-foreground/50"}`}
                    >
                      <div
                        className="relative h-36 flex items-center justify-center p-4 overflow-hidden"
                        style={{
                          borderBottom: "1px solid hsl(var(--foreground) / 0.2)",
                          backgroundImage:
                            "linear-gradient(hsl(var(--foreground) / 0.05) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.05) 1px, transparent 1px)",
                          backgroundSize: "24px 24px",
                        }}
                      >
                        {sig.ImageData ? (
                          <img src={sig.ImageData} alt={sig.Name} className={`relative max-h-full max-w-full object-contain ${active ? "" : "opacity-50"}`} />
                        ) : (
                          <ImageIcon size={26} className="text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="flex flex-col gap-3 p-3.5">
                        <div className="min-w-0">
                          <p className="font-heading text-sm font-bold tracking-tight text-foreground truncate">{sig.Name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{sig.Owner}</p>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          {rights.canEdit ? (
                            <div className="inline-flex items-stretch border border-foreground" role="group" aria-label={`${sig.Name} status`}>
                              {(["active", "inactive"] as const).map((s, i) => (
                                <button
                                  key={s}
                                  type="button"
                                  aria-pressed={sig.Status === s}
                                  disabled={toggleMutation.isPending}
                                  onClick={() => sig.Status !== s && toggleMutation.mutate({ id: sig.Id, status: s })}
                                  className={`${KEY} h-7 px-2.5 ${i ? "border-l border-foreground" : ""} ${sig.Status === s ? "bg-foreground text-card" : "text-muted-foreground hover:text-foreground"}`}
                                >
                                  {s === "active" ? "Active" : "Inactive"}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <SheetMark text={active ? "Active" : "Inactive"} tone={active ? "done" : "waiting"} />
                          )}
                          {confirming ? (
                            <div className="flex items-center gap-1">
                              <span className="text-[0.6875rem] text-destructive mr-1">Delete?</span>
                              <button
                                type="button"
                                onClick={() => deleteMutation.mutate(sig.Id)}
                                disabled={deleteMutation.isPending}
                                className={`${ACT} text-destructive border-destructive hover:bg-destructive/10`}
                                aria-label="Confirm delete"
                                title="Confirm delete"
                              >
                                {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                              </button>
                              <button type="button" onClick={() => setDeleteId(null)} className={`${ACT} hover:text-foreground hover:border-foreground`} aria-label="Keep" title="Keep">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              {rights.canEdit && (
                                <button type="button" onClick={() => startEditing(sig)} className={`${ACT} hover:text-foreground hover:border-foreground`} aria-label={`Edit ${sig.Name}`} title="Edit">
                                  <Edit3 size={13} />
                                </button>
                              )}
                              {rights.canDelete && (
                                <button type="button" onClick={() => setDeleteId(sig.Id)} className={`${ACT} hover:text-destructive hover:border-destructive`} aria-label={`Delete ${sig.Name}`} title="Delete">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <p className="text-[0.625rem] text-muted-foreground tabular-nums pt-2.5 border-t border-foreground/10">
                          Added{" "}
                          {new Date(sig.AddedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SheetShell>
    </>
  );
}
