import React, { useState, useRef } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
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
} from "lucide-react";

interface SignatureItem {
  id: string;
  name: string;
  owner: string;
  status: "active" | "inactive";
  imagePreview: string;
  addedAt: string;
}

const INITIAL: SignatureItem[] = [
  { id: "1", name: "John Doe Signature", owner: "John Doe", status: "active", imagePreview: "", addedAt: "12 Mar 2025" },
  { id: "2", name: "Admin Signature", owner: "Admin User", status: "inactive", imagePreview: "", addedAt: "04 Jan 2025" },
];

export default function Signature() {
  const [signatures, setSignatures] = useState<SignatureItem[]>(INITIAL);
  const [formData, setFormData] = useState({ name: "", owner: "", imagePreview: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => setFormData((p) => ({ ...p, imagePreview: (e.target?.result as string) || "" }));
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) readFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) readFile(f);
  };

  const submitForm = () => {
    if (!formData.name.trim() || !formData.owner.trim()) return;
    if (editingId) {
      setSignatures((prev) =>
        prev.map((s) =>
          s.id === editingId
            ? { ...s, name: formData.name, owner: formData.owner, imagePreview: formData.imagePreview }
            : s
        )
      );
      setEditingId(null);
    } else {
      setSignatures((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          name: formData.name,
          owner: formData.owner,
          status: "active",
          imagePreview: formData.imagePreview,
          addedAt: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
        },
      ]);
    }
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1600);
    resetForm();
  };

  const resetForm = () => {
    setFormData({ name: "", owner: "", imagePreview: "" });
    if (fileInputRef.current) fileInputRef.current.value = "";
    setEditingId(null);
  };

  const startEditing = (sig: SignatureItem) => {
    setEditingId(sig.id);
    setFormData({ name: sig.name, owner: sig.owner, imagePreview: sig.imagePreview });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEditing = () => {
    resetForm();
  };

  const deleteSig = (id: string) => {
    setSignatures((prev) => prev.filter((s) => s.id !== id));
    if (editingId === id) resetForm();
  };

  const toggleStatus = (id: string) =>
    setSignatures((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status: s.status === "active" ? "inactive" : "active" } : s))
    );

  const isEditing = editingId !== null;
  const activeCount = signatures.filter((s) => s.status === "active").length;

  return (
    <>
      <Breadcrumbs items={["Admin", "Signatures"]} />

      <div className="space-y-8">

        {/* ── Page title ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <PenLine size={17} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-heading font-bold text-foreground">Digital Signatures</h1>
              <p className="text-xs font-body text-muted-foreground mt-0.5">
                Manage signatures used for document approvals
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-body text-muted-foreground">
            <span className="px-2.5 py-1 rounded-full bg-muted border border-border">
              {signatures.length} total
            </span>
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              {activeCount} active
            </span>
          </div>
        </div>

        {/* ── Upload / Edit Form ── */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {/* Form header */}
          <div className="flex items-center gap-2.5 px-6 py-4 border-b border-border bg-muted/30">
            {isEditing
              ? <Edit3 size={14} className="text-primary" />
              : <UploadCloud size={14} className="text-primary" />}
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

              {/* Left — fields */}
              <div className="space-y-4">
                {/* Signature Name */}
                <div className="space-y-1.5">
                  <Label
                    htmlFor="sig-name"
                    className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                  >
                    <Tag size={10} />
                    Signature Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="sig-name"
                    placeholder="e.g. CEO Approval Signature"
                    value={formData.name}
                    onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                    className="font-body"
                  />
                </div>

                {/* Owner */}
                <div className="space-y-1.5">
                  <Label
                    htmlFor="sig-owner"
                    className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground"
                  >
                    <User size={10} />
                    Owner <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="sig-owner"
                    placeholder="e.g. John Doe"
                    value={formData.owner}
                    onChange={(e) => setFormData((p) => ({ ...p, owner: e.target.value }))}
                    className="font-body"
                  />
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-3 pt-2">
                  <Button
                    onClick={submitForm}
                    disabled={!formData.name.trim() || !formData.owner.trim()}
                    className="gap-2 font-heading text-sm"
                  >
                    {justSaved ? (
                      <><CheckCircle2 size={14} /> Saved!</>
                    ) : isEditing ? (
                      <><Edit3 size={14} /> Update Signature</>
                    ) : (
                      <><Plus size={14} /> Add Signature</>
                    )}
                  </Button>
                  {isEditing && (
                    <Button variant="outline" onClick={cancelEditing} className="font-heading text-sm">
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              {/* Right — upload zone */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[11px] font-heading uppercase tracking-widest text-muted-foreground">
                  <UploadCloud size={10} />
                  Signature Image
                </Label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative flex flex-col items-center justify-center w-full h-40 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                    dragOver
                      ? "border-primary bg-primary/5 scale-[1.01]"
                      : formData.imagePreview
                      ? "border-primary/30 bg-muted/20"
                      : "border-border hover:border-primary/50 hover:bg-muted/30"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    className="sr-only"
                    onChange={handleFileUpload}
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
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive/90 text-white flex items-center justify-center hover:bg-destructive transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2.5 text-center px-4 pointer-events-none">
                      <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center">
                        <UploadCloud size={20} className="text-muted-foreground/60" />
                      </div>
                      <div>
                        <p className="text-sm font-body text-muted-foreground">
                          <span className="font-semibold text-primary">Click to upload</span> or drag &amp; drop
                        </p>
                        <p className="text-[10px] font-body text-muted-foreground/50 mt-0.5">PNG, JPG up to 2 MB</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Signature Library ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-heading font-semibold text-foreground">
              Signature Library
            </h2>
            <span className="text-xs font-body text-muted-foreground">
              ({signatures.length})
            </span>
          </div>

          {signatures.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 rounded-2xl border-2 border-dashed border-border bg-muted/10">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <ImageIcon size={24} className="text-muted-foreground/40" />
              </div>
              <p className="text-sm font-heading font-semibold text-muted-foreground">No signatures yet</p>
              <p className="text-xs font-body text-muted-foreground/60 mt-1">
                Use the form above to add your first signature
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {signatures.map((sig) => (
                <div
                  key={sig.id}
                  className={`group flex flex-col rounded-2xl border bg-card overflow-hidden transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 ${
                    editingId === sig.id
                      ? "border-primary shadow-lg shadow-primary/10 ring-1 ring-primary/20"
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  {/* Image panel */}
                  <div className="relative h-36 bg-gradient-to-br from-muted/80 to-muted flex items-center justify-center p-4 overflow-hidden">
                    {/* Subtle grid texture */}
                    <div
                      className="absolute inset-0 opacity-[0.04]"
                      style={{
                        backgroundImage:
                          "repeating-linear-gradient(0deg,currentColor,currentColor 1px,transparent 1px,transparent 28px),repeating-linear-gradient(90deg,currentColor,currentColor 1px,transparent 1px,transparent 28px)",
                      }}
                    />
                    {sig.imagePreview ? (
                      <img
                        src={sig.imagePreview}
                        alt={sig.name}
                        className="relative max-h-full max-w-full object-contain drop-shadow-sm"
                      />
                    ) : (
                      <div className="relative flex flex-col items-center gap-2 opacity-30 group-hover:opacity-50 transition-opacity">
                        <ImageIcon size={28} className="text-foreground" />
                      </div>
                    )}
                    {/* Active dot */}
                    <span
                      className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full ring-2 ring-card ${
                        sig.status === "active" ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                    />
                  </div>

                  <Separator className="opacity-50" />

                  {/* Info + controls */}
                  <div className="flex flex-col gap-3 p-4">
                    {/* Name + owner */}
                    <div className="min-w-0">
                      <p className="text-sm font-heading font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                        {sig.name}
                      </p>
                      <p className="text-xs font-body text-muted-foreground mt-0.5 truncate flex items-center gap-1.5">
                        <User size={10} className="flex-shrink-0" />
                        {sig.owner}
                      </p>
                    </div>

                    {/* Status toggle + badge + actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={sig.status === "active"}
                          onCheckedChange={() => toggleStatus(sig.id)}
                          className="data-[state=checked]:bg-primary h-5 w-9"
                        />
                        <Badge
                          variant={sig.status === "active" ? "default" : "secondary"}
                          className="text-[10px] font-heading uppercase tracking-wide px-2 py-0.5"
                        >
                          {sig.status}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEditing(sig)}
                          className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                          title="Edit"
                        >
                          <Edit3 size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteSig(sig.id)}
                          className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>

                    {/* Added date */}
                    <p className="text-[10px] font-body text-muted-foreground/50 border-t border-border/50 pt-2.5 mt-0.5">
                      Added {sig.addedAt}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
