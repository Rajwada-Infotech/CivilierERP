/**
 * src/pages/admin/WidgetCatalogAdmin.tsx
 *
 * Admin page to manage the WidgetCatalog master table.
 * Lets admins add new widgets, edit labels/icons/categories,
 * toggle active status, and delete widgets not in use.
 *
 * Backend: /api/widget-catalog  (widgetCatalogAdmin.js)
 */

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Puzzle,
  Plus,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";

// ── Types ─────────────────────────────────────────────────────────────────────
interface CatalogWidget {
  key: string;
  label: string;
  iconKey: string;
  category: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
}

const BLANK: Omit<CatalogWidget, "isActive" | "createdAt" | "updatedAt"> = {
  key: "",
  label: "",
  iconKey: "",
  category: "",
  description: "",
  sortOrder: 0,
};

// ── API helpers ───────────────────────────────────────────────────────────────
async function fetchCatalog(): Promise<CatalogWidget[]> {
  const res = await fetchWithAuth("/api/widget-catalog");
  if (!res.ok) throw new Error("Failed to load widget catalog");
  return res.json().catch(() => ({}));
}

async function createWidget(body: typeof BLANK): Promise<void> {
  const res = await fetchWithAuth("/api/widget-catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to create widget");
  }
}

async function updateWidget(key: string, body: Partial<typeof BLANK>): Promise<void> {
  const res = await fetchWithAuth(`/api/widget-catalog/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to update widget");
  }
}

async function toggleWidget(key: string): Promise<{ isActive: boolean }> {
  const res = await fetchWithAuth(
    `/api/widget-catalog/${encodeURIComponent(key)}/toggle`,
    { method: "PATCH" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to toggle widget");
  }
  return res.json().catch(() => ({}));
}

async function deleteWidget(key: string): Promise<void> {
  const res = await fetchWithAuth(
    `/api/widget-catalog/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to delete widget");
  }
}

// ── Form component ────────────────────────────────────────────────────────────
function WidgetForm({
  initial,
  isEdit,
  onSubmit,
  onCancel,
  loading,
}: {
  initial: typeof BLANK;
  isEdit: boolean;
  onSubmit: (v: typeof BLANK) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof BLANK) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: k === "sortOrder" ? Number(e.target.value) : e.target.value }));

  const fields: { key: keyof typeof BLANK; label: string; placeholder: string; type?: string }[] = [
    { key: "key",         label: "Widget key",   placeholder: "Bar Chart",         },
    { key: "label",       label: "Display label", placeholder: "Bar Chart",        },
    { key: "iconKey",     label: "Icon key",      placeholder: "bar-chart-2",      },
    { key: "category",    label: "Category",      placeholder: "Charts",           },
    { key: "description", label: "Description",   placeholder: "Brief description" },
    { key: "sortOrder",   label: "Sort order",    placeholder: "0", type: "number" },
  ];

  return (
    <div className="space-y-3 py-1">
      {fields.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label className="text-xs">{f.label}</Label>
          <Input
            type={f.type || "text"}
            value={String(form[f.key])}
            onChange={set(f.key)}
            placeholder={f.placeholder}
            disabled={isEdit && f.key === "key"}
            className="text-xs"
          />
        </div>
      ))}
      <DialogFooter className="pt-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button
          size="sm"
          className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90"
          onClick={() => onSubmit(form)}
          disabled={loading || !form.key || !form.label || !form.iconKey || !form.category}
        >
          {loading ? "Saving…" : isEdit ? "Save changes" : "Add widget"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WidgetCatalogAdmin() {
  const qc = useQueryClient();
  const rights = usePageRights("widget-catalog");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editWidget, setEditWidget] = useState<CatalogWidget | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const { data: widgets = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["widget-catalog-admin"],
    queryFn: fetchCatalog,
    staleTime: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["widget-catalog-admin"] });

  const createMutation = useMutation({
    mutationFn: createWidget,
    onSuccess: () => { toast.success("Widget added"); setAddOpen(false); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, body }: { key: string; body: typeof BLANK }) => updateWidget(key, body),
    onSuccess: () => { toast.success("Widget updated"); setEditWidget(null); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: toggleWidget,
    onSuccess: (data, key) => {
      toast.success(`Widget ${data.isActive ? "activated" : "deactivated"}`);
      invalidate();
      // also invalidate the public catalog so Widgets.tsx picks up the change
      qc.invalidateQueries({ queryKey: ["widget-catalog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteWidget,
    onSuccess: () => { toast.success("Widget deleted"); setDeleteKey(null); invalidate(); qc.invalidateQueries({ queryKey: ["widget-catalog"] }); },
    onError: (e: Error) => { toast.error(e.message); setDeleteKey(null); },
  });

  const visible = widgets.filter(
    (w) =>
      !search ||
      w.key.toLowerCase().includes(search.toLowerCase()) ||
      w.label.toLowerCase().includes(search.toLowerCase()) ||
      w.category.toLowerCase().includes(search.toLowerCase()),
  );

  const activeCount = widgets.filter((w) => w.isActive).length;
  const categories = [...new Set(widgets.map((w) => w.category))].sort();

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <Breadcrumbs items={["Admin", "Masters", "Widget Catalog"]} />

      <AdminShell
        title="Widget catalog"
        subtitle="Master list of all dashboard widgets. Changes here affect what appears in Widgets Rights."
        icon={Puzzle}
        action={
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1 group"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw
                size={12}
                className={`transition-transform duration-500 ${isFetching ? "animate-spin" : "group-hover:rotate-180"}`}
              />
              Refresh
            </Button>
            {rights.canCreate && (
              <Button size="sm" className="h-8 text-xs gap-1 bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm text-white hover:opacity-90" onClick={() => setAddOpen(true)}>
                <Plus size={12} /> Add widget
              </Button>
            )}
          </div>
        }
      >
      {/* Summary pills */}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="outline" className="gap-1">
          <span className="font-semibold">{widgets.length}</span> total
        </Badge>
        <Badge variant="outline" className="gap-1 text-green-700 border-green-500/40 bg-green-500/10">
          <span className="font-semibold">{activeCount}</span> active
        </Badge>
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <span className="font-semibold">{widgets.length - activeCount}</span> inactive
        </Badge>
        {categories.map((cat) => (
          <Badge key={cat} variant="outline" className="text-muted-foreground">
            {cat}
          </Badge>
        ))}
      </div>

      {/* Table card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Puzzle size={14} className="text-primary" /> All widgets
            </CardTitle>
            <div className="relative w-56">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-7 text-xs pl-7"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : isError ? (
            <div className="p-8 text-center text-sm text-destructive">Failed to load catalog.</div>
          ) : visible.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {search ? "No widgets match your search." : "No widgets in catalog yet."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Key</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Icon key</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-center">Sort</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((w) => (
                    <TableRow key={w.key} className="text-xs">
                      <TableCell className="font-mono text-[11px]">{w.key}</TableCell>
                      <TableCell className="font-medium">{w.label}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-[11px]">{w.iconKey}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{w.category}</Badge>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">{w.sortOrder}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          className={`text-[10px] ${
                            w.isActive
                              ? "bg-green-500/10 text-green-700 border-green-500/30"
                              : "bg-muted/50 text-muted-foreground border-border"
                          }`}
                        >
                          {w.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title={w.isActive ? "Deactivate" : "Activate"}
                            onClick={() => toggleMutation.mutate(w.key)}
                            disabled={toggleMutation.isPending}
                          >
                            {w.isActive
                              ? <ToggleRight size={13} className="text-green-600" />
                              : <ToggleLeft size={13} className="text-muted-foreground" />}
                          </Button>
                          {rights.canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title="Edit"
                              onClick={() => setEditWidget(w)}
                            >
                              <Edit2 size={12} />
                            </Button>
                          )}
                          {rights.canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-destructive hover:text-destructive"
                              title="Delete"
                              onClick={() => setDeleteKey(w.key)}
                            >
                              <Trash2 size={12} />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      </AdminShell>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plus size={16} className="text-primary" /> Add widget
            </DialogTitle>
          </DialogHeader>
          <WidgetForm
            initial={BLANK}
            isEdit={false}
            onSubmit={(v) => createMutation.mutate(v)}
            onCancel={() => setAddOpen(false)}
            loading={createMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editWidget} onOpenChange={(open) => !open && setEditWidget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Edit2 size={16} className="text-primary" /> Edit widget
            </DialogTitle>
          </DialogHeader>
          {editWidget && (
            <WidgetForm
              initial={{
                key: editWidget.key,
                label: editWidget.label,
                iconKey: editWidget.iconKey,
                category: editWidget.category,
                description: editWidget.description,
                sortOrder: editWidget.sortOrder,
              }}
              isEdit={true}
              onSubmit={(v) => updateMutation.mutate({ key: editWidget.key, body: v })}
              onCancel={() => setEditWidget(null)}
              loading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteKey} onOpenChange={(open) => !open && setDeleteKey(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base text-destructive flex items-center gap-2">
              <Trash2 size={16} /> Delete widget
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Permanently delete <strong className="text-foreground">{deleteKey}</strong>?
            This will fail if any user still has this widget assigned.
            Consider deactivating instead.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteKey(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteKey && deleteMutation.mutate(deleteKey)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}