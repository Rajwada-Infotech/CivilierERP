import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Trash2,
  Edit3,
  UploadCloud,
  PenLine,
  X,
  Image as ImageIcon,
  CheckCircle2,
  Plus,
  User,
  Tag,
  Loader2,
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

export default function Signature() {
  const qc = useQueryClient();
  const rights = usePageRights("admin-signatures");
  const [formData, setFormData] = useState({
    name: "",
    owner: "",
    imagePreview: "",
  });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: signatures = [], isLoading } = useQuery<SignatureItem[]>({
    queryKey: ["signatures"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/signatures");
      if (!res.ok) throw new Error("Failed to load");
      return res.json().catch(() => ({}));
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
    onSuccess: () => {
      toast.success("Signature deleted");
      qc.invalidateQueries({ queryKey: ["signatures"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
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

  return (
    <>
      <Breadcrumbs items={["Admin", "Signatures"]} />
      <AdminShell
        title="Digital Signatures"
        subtitle="Manage signatures used for document approvals"
        icon={PenLine}
        action={
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
            <span className="px-2.5 py-1 rounded-full bg-muted border border-border">
              {signatures.length} total
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              {activeCount} active
            </span>
          </div>
        }
      >
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
            {isEditing ? (
              <Edit3 size={14} className="text-primary" />
            ) : (
              <UploadCloud size={14} className="text-primary" />
            )}
            <span className="text-sm font-heading font-semibold text-foreground">
              {isEditing ? "Edit Signature" : "Add New Signature"}
            </span>
            {isEditing && (
              <Badge className="ml-auto text-[10px] font-heading bg-primary/10 text-primary border border-primary/20 px-2">
                Editing
              </Badge>
            )}
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="sig-name"
                    className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                  >
                    <Tag size={10} /> Signature Name{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="sig-name"
                    placeholder="e.g. CEO Approval Signature"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, name: e.target.value }))
                    }
                    className="font-body"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="sig-owner"
                    className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                  >
                    <User size={10} /> Owner{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="sig-owner"
                    placeholder="e.g. John Doe"
                    value={formData.owner}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, owner: e.target.value }))
                    }
                    className="font-body"
                  />
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    onClick={() => saveMutation.mutate()}
                    disabled={
                      !formData.name.trim() ||
                      !formData.owner.trim() ||
                      saveMutation.isPending
                    }
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto"
                  >
                    {saveMutation.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : justSaved ? (
                      <CheckCircle2 size={14} />
                    ) : isEditing ? (
                      <Edit3 size={14} />
                    ) : (
                      <Plus size={14} />
                    )}
                    {saveMutation.isPending
                      ? "Saving…"
                      : justSaved
                        ? "Saved!"
                        : isEditing
                          ? "Update Signature"
                          : "Add Signature"}
                  </Button>
                  {isEditing && (
                    <Button
                      variant="outline"
                      onClick={resetForm}
                      className="font-heading text-sm"
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground">
                  <UploadCloud size={10} /> Signature Image
                </Label>
                <div
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
                  className={`relative flex flex-col items-center justify-center w-full h-40 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${dragOver ? "border-primary bg-primary/5 scale-[1.01]" : formData.imagePreview ? "border-primary/30 bg-muted/20" : "border-border hover:border-primary/50 hover:bg-muted/30"}`}
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
                      <img
                        src={formData.imagePreview}
                        alt="Preview"
                        className="max-h-32 max-w-full object-contain px-6"
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFormData((p) => ({ ...p, imagePreview: "" }));
                          if (fileInputRef.current)
                            fileInputRef.current.value = "";
                        }}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive/90 text-white flex items-center justify-center hover:bg-destructive transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2.5 text-center px-4 pointer-events-none">
                      <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center">
                        <UploadCloud
                          size={20}
                          className="text-muted-foreground/60"
                        />
                      </div>
                      <div>
                        <p className="text-sm font-body text-muted-foreground">
                          <span className="font-semibold text-primary">
                            Click to upload
                          </span>{" "}
                          or drag &amp; drop
                        </p>
                        <p className="text-[10px] font-body text-muted-foreground/50 mt-0.5">
                          PNG, JPG up to 2 MB
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-heading font-semibold text-foreground">
              Signature Library
            </h2>
            <span className="text-xs font-body text-muted-foreground">
              ({signatures.length})
            </span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2
                size={24}
                className="animate-spin text-muted-foreground"
              />
            </div>
          ) : signatures.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 rounded-2xl border-2 border-dashed border-border bg-muted/10">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <ImageIcon size={24} className="text-muted-foreground/40" />
              </div>
              <p className="text-sm font-heading font-semibold text-muted-foreground">
                No signatures yet
              </p>
              <p className="text-xs font-body text-muted-foreground/60 mt-1">
                Use the form above to add your first signature
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {signatures.map((sig) => (
                <div
                  key={sig.Id}
                  className={`group flex flex-col rounded-2xl border bg-card overflow-hidden transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 ${editingId === sig.Id ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/20" : "border-border hover:border-primary/30"}`}
                >
                  <div className="relative h-36 bg-gradient-to-br from-muted/80 to-muted flex items-center justify-center p-4 overflow-hidden">
                    <div
                      className="absolute inset-0 opacity-[0.04]"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(0deg,currentColor,currentColor 1px,transparent 1px,transparent 28px),repeating-linear-gradient(90deg,currentColor,currentColor 1px,transparent 1px,transparent 28px)",
                      }}
                    />
                    {sig.ImageData ? (
                      <img
                        src={sig.ImageData}
                        alt={sig.Name}
                        className="relative max-h-full max-w-full object-contain drop-shadow-sm"
                      />
                    ) : (
                      <div className="relative flex flex-col items-center gap-2 opacity-30 group-hover:opacity-50 transition-opacity">
                        <ImageIcon size={28} className="text-foreground" />
                      </div>
                    )}
                    <span
                      className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ring-2 ring-card ${sig.Status === "active" ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                    />
                  </div>
                  <Separator className="opacity-50" />
                  <div className="flex flex-col gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-heading font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                        {sig.Name}
                      </p>
                      <p className="text-xs font-body text-muted-foreground mt-0.5 truncate flex items-center gap-1.5">
                        <User size={10} className="flex-shrink-0" />
                        {sig.Owner}
                      </p>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={sig.Status === "active"}
                          onCheckedChange={() =>
                            toggleMutation.mutate({
                              id: sig.Id,
                              status:
                                sig.Status === "active" ? "inactive" : "active",
                            })
                          }
                          className="data-[state=checked]:bg-primary h-5 w-9"
                        />
                        <Badge
                          variant={
                            sig.Status === "active" ? "default" : "secondary"
                          }
                          className="text-[10px] font-heading uppercase tracking-wide px-2 py-0.5"
                        >
                          {sig.Status}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditing(sig)}
                          className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                        >
                          <Edit3 size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(sig.Id)}
                          disabled={deleteMutation.isPending}
                          className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                    <p className="text-[10px] font-body text-muted-foreground/50 border-t border-border/50 pt-2.5 mt-0.5">
                      Added{" "}
                      {new Date(sig.AddedAt).toLocaleDateString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminShell>
    </>
  );
}