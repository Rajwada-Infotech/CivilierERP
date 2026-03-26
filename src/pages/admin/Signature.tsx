import React, { useState, useRef } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, Edit3, UploadCloud, Image as ImageLucide } from "lucide-react";

interface SignatureItem {
  id: string;
  name: string;
  owner: string;
  status: "active" | "inactive";
  imagePreview: string;
}

export default function Signature() {
  const [signatures, setSignatures] = useState<SignatureItem[]>([
    {
      id: "1",
      name: "John Doe Signature",
      owner: "John Doe",
      status: "active",
      imagePreview: "",
    },
    {
      id: "2",
      name: "Admin Signature",
      owner: "Admin User",
      status: "inactive",
      imagePreview: "",
    },
  ]);

  const [formData, setFormData] = useState({
    name: "",
    owner: "",
    imagePreview: "",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setFormData(prev => ({ ...prev, imagePreview: event.target?.result as string || "" }));
      };
      reader.readAsDataURL(file);
    }
  };

  const submitForm = () => {
    if (formData.name.trim() && formData.owner.trim()) {
      if (editingId) {
        setSignatures(prev => prev.map(sig => 
          sig.id === editingId 
            ? { ...sig, name: formData.name, owner: formData.owner, imagePreview: formData.imagePreview }
            : sig
        ));
        setEditingId(null);
      } else {
        const newSig: SignatureItem = {
          id: Date.now().toString(),
          name: formData.name,
          owner: formData.owner,
          status: "active" as const,
          imagePreview: formData.imagePreview,
        };
        setSignatures(prev => [...prev, newSig]);
      }
      setFormData({ name: "", owner: "", imagePreview: "" });
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const startEditing = (sig: SignatureItem) => {
    setEditingId(sig.id);
    setFormData({
      name: sig.name,
      owner: sig.owner,
      imagePreview: sig.imagePreview,
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setFormData({ name: "", owner: "", imagePreview: "" });
  };

  const deleteSig = (id: string) => {
    setSignatures(prev => prev.filter(sig => sig.id !== id));
  };

  const toggleStatus = (id: string) => {
    setSignatures(prev => prev.map(sig => 
      sig.id === id 
        ? { ...sig, status: sig.status === "active" ? "inactive" as const : "active" as const }
        : sig
    ));
  };

  const isEditing = editingId !== null;

  return (
    <>
      <Breadcrumbs items={["Admin", "Signatures"]} />
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Digital Signatures</h1>
          <p className="text-muted-foreground">Upload and manage signatures for document approval</p>
        </div>

        {/* Upload Form */}
        <Card>
          <CardHeader>
            <CardTitle>
              {isEditing ? "Edit Signature" : "Upload New Signature"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <Label htmlFor="signature-name">Signature Name</Label>
                  <Input
                    id="signature-name"
                    placeholder="e.g. CEO Signature"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="signature-owner">Owner</Label>
                  <Input
                    id="signature-owner"
                    placeholder="John Doe"
                    value={formData.owner}
                    onChange={(e) => setFormData(prev => ({ ...prev, owner: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label>Signature Image Upload</Label>
                <div 
                  className="border-2 border-dashed rounded-xl p-8 hover:border-primary hover:bg-accent/20 transition-all cursor-pointer flex flex-col items-center justify-center min-h-[200px] group"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg"
                    className="sr-only"
                    onChange={handleFileUpload}
                  />
                  {formData.imagePreview ? (
                    <div className="text-center">
                      <div className="w-28 h-28 bg-background border rounded-lg shadow-sm p-2 mx-auto mb-3 flex items-center justify-center">
                        <img 
                          src={formData.imagePreview} 
                          alt="Preview" 
                          className="max-w-full max-h-full object-contain" 
                        />
                      </div>
                      <Badge variant="default" className="px-3">
                        Ready to upload
                      </Badge>
                    </div>
                  ) : (
                    <div className="text-center space-y-3">
                      <UploadCloud className="w-12 h-12 mx-auto text-muted-foreground/60 group-hover:text-primary transition-colors" />
                      <div>
                        <p className="font-medium text-sm text-foreground/90 group-hover:text-primary">
                          Click or drag signature image
                        </p>
                        <p className="text-xs text-muted-foreground">PNG, JPG (Max 2MB)</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 mt-8 pt-6 border-t">
              <Button 
                className="flex-1" 
                onClick={submitForm}
                disabled={!formData.name.trim() || !formData.owner.trim()}
              >
                {isEditing ? "Update Signature" : "Upload Signature"}
              </Button>
              {isEditing && (
                <Button 
                  variant="outline" 
                  onClick={cancelEditing}
                  className="flex-1"
                >
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Grid List */}
        <Card>
          <CardHeader>
            <CardTitle>Signature Library ({signatures.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {signatures.map((sig) => (
                <div 
                  key={sig.id}
                  className="group border rounded-2xl p-6 hover:shadow-xl hover:border-primary/50 hover:-translate-y-1 transition-all overflow-hidden bg-card"
                >
                  {/* Preview Card */}
                  <div className="w-full h-28 bg-gradient-to-br from-muted to-muted-foreground/30 rounded-xl flex items-center justify-center mb-5 p-4 shadow-sm group-hover:shadow-md transition-shadow">
                    {sig.imagePreview ? (
                      <img 
                        src={sig.imagePreview} 
                        alt={`${sig.name} signature preview`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <ImageLucide className="w-12 h-12 text-muted-foreground group-hover:text-primary/80" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="space-y-2 mb-5">
                    <h3 className="font-semibold text-sm leading-tight line-clamp-1 group-hover:text-primary">
                      {sig.name}
                    </h3>
                    <p className="text-xs text-muted-foreground font-medium">{sig.owner}</p>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Switch 
                        checked={sig.status === "active"}
                        onCheckedChange={() => toggleStatus(sig.id)}
                        className="data-[state=checked]:bg-primary w-10 h-5"
                      />
                      <Badge 
                        variant={sig.status === "active" ? "default" : "secondary"} 
                        className="px-2.5 py-0.5 text-xs font-medium"
                      >
                        {sig.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="flex gap-1.5">
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={() => startEditing(sig)}
                        className="h-9 w-9 p-0 hover:bg-accent/50 transition-colors"
                        title="Edit signature"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button 
                        variant="destructive" 
                        size="sm"
                        onClick={() => deleteSig(sig.id)}
                        className="h-9 w-9 p-0 hover:bg-destructive/90"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {signatures.length === 0 && (
              <div className="grid place-items-center py-24 border-2 border-dashed rounded-3xl bg-muted/30">
                <ImageLucide className="w-20 h-20 text-muted-foreground mb-6" />
                <div className="text-center space-y-3">
                  <h3 className="text-2xl font-bold text-muted-foreground">No Signatures</h3>
                  <p className="text-lg text-muted-foreground/80 max-w-md mx-auto">
                    Upload your first digital signature using the form above
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

