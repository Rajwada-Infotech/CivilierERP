import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plug, Plus, Pencil, PowerOff, Search, Radio } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminShell } from "@/components/admin/AdminShell";

// ─── Types ────────────────────────────────────────────────────────────────────

interface IntegrationChannel {
  Id: number;
  ChannelKey: string;
  Label: string;
  Description: string | null;
  SortOrder: number;
  IsActive: boolean;
  UpdatedAt: string | null;
  UpdatedBy: string | null;
}

const EMPTY_FORM = {
  channelKey: "",
  label: "",
  description: "",
  sortOrder: 0,
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function IntegrationChannelsAdmin() {
  const rights = usePageRights("integration-channels");
  const [channels, setChannels] = useState<IntegrationChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IntegrationChannel | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Deactivate confirm
  const [confirmTarget, setConfirmTarget] = useState<IntegrationChannel | null>(null);

  // ─── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth("/api/communicator/channels");
      if (!res.ok) throw new Error("Failed to load channels");
      const data = await res.json();
      setChannels(data.channels ?? []);
    } catch (err) {
      toast.error("Could not load integration channels");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ─── Derived ───────────────────────────────────────────────────────────────

  const filtered = channels.filter((c) => {
    const q = search.toLowerCase();
    return (
      !q ||
      c.ChannelKey.toLowerCase().includes(q) ||
      c.Label.toLowerCase().includes(q) ||
      (c.Description ?? "").toLowerCase().includes(q)
    );
  });

  const stats = {
    total: channels.length,
    active: channels.filter((c) => c.IsActive).length,
    inactive: channels.filter((c) => !c.IsActive).length,
  };

  // ─── Open add / edit dialog ────────────────────────────────────────────────

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM, sortOrder: (channels.length + 1) * 10 });
    setDialogOpen(true);
  };

  const openEdit = (ch: IntegrationChannel) => {
    setEditing(ch);
    setForm({
      channelKey: ch.ChannelKey,
      label: ch.Label,
      description: ch.Description ?? "",
      sortOrder: ch.SortOrder,
    });
    setDialogOpen(true);
  };

  // ─── Save ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!form.label.trim()) {
      toast.error("Label is required");
      return;
    }
    if (!editing && !form.channelKey.trim()) {
      toast.error("Channel key is required");
      return;
    }

    setSaving(true);
    try {
      let res: Response;

      if (editing) {
        res = await fetchWithAuth(`/api/communicator/channels/${editing.Id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: form.label.trim(),
            description: form.description.trim() || null,
            sortOrder: form.sortOrder,
          }),
        });
      } else {
        res = await fetchWithAuth("/api/communicator/channels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            channelKey: form.channelKey.trim(),
            label: form.label.trim(),
            description: form.description.trim() || null,
            sortOrder: form.sortOrder,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Save failed");
        return;
      }

      toast.success(editing ? "Channel updated" : "Channel created");
      setDialogOpen(false);
      load();
    } catch {
      toast.error("Unexpected error — please try again");
    } finally {
      setSaving(false);
    }
  };

  // ─── Toggle active ──────────────────────────────────────────────────────────

  const handleToggle = async (ch: IntegrationChannel) => {
    if (ch.IsActive) {
      // Show confirm before deactivating
      setConfirmTarget(ch);
      return;
    }
    // Reactivate immediately
    await applyToggle(ch, true);
  };

  const applyToggle = async (ch: IntegrationChannel, newState: boolean) => {
    try {
      const res = await fetchWithAuth(`/api/communicator/channels/${ch.Id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: newState }),
      });
      if (!res.ok) {
        const d = await res.json();
        toast.error(d.error ?? "Update failed");
        return;
      }
      toast.success(newState ? `"${ch.Label}" reactivated` : `"${ch.Label}" deactivated`);
      load();
    } catch {
      toast.error("Unexpected error");
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Admin", "Integration Channels"]} />
      <AdminShell
        title="Integration Channels"
        subtitle="Manage the channels available in the Communicator"
        icon={Plug}
        action={
          rights.canCreate && (
            <Button onClick={openAdd} className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto">
              <Plus className="h-4 w-4" />
              Add Channel
            </Button>
          )
        }
      >
      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Channels", value: stats.total },
          { label: "Active",         value: stats.active,   className: "text-green-600" },
          { label: "Inactive",       value: stats.inactive, className: "text-muted-foreground" },
        ].map(({ label, value, className }) => (
          <Card key={label}>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${className ?? ""}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Search + table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search channels…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              Loading channels…
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              {search ? "No channels match your search." : "No channels found."}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Key</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground">Label</th>
                  <th className="text-left py-3 px-4 font-medium text-muted-foreground hidden md:table-cell">Description</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Order</th>
                  <th className="text-center py-3 px-4 font-medium text-muted-foreground">Status</th>
                  <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ch) => (
                  <tr key={ch.Id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                        {ch.ChannelKey}
                      </code>
                    </td>
                    <td className="py-3 px-4 font-medium">{ch.Label}</td>
                    <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">
                      {ch.Description ?? <span className="italic opacity-50">—</span>}
                    </td>
                    <td className="py-3 px-4 text-center text-muted-foreground">{ch.SortOrder}</td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant={ch.IsActive ? "default" : "secondary"}>
                        {ch.IsActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {rights.canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEdit(ch)}
                            className="gap-1.5"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </Button>
                        )}
                        <Switch
                          checked={ch.IsActive}
                          onCheckedChange={() => handleToggle(ch)}
                          title={ch.IsActive ? "Deactivate" : "Activate"}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-primary" />
              {editing ? "Edit Channel" : "Add Integration Channel"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Channel Key — read-only when editing */}
            <div className="space-y-1.5">
              <Label htmlFor="channelKey">
                Channel Key
                {!editing && (
                  <span className="text-muted-foreground font-normal ml-1">
                    (lowercase, hyphens only — cannot be changed later)
                  </span>
                )}
              </Label>
              {editing ? (
                <code className="block w-full text-sm bg-muted px-3 py-2 rounded-md font-mono">
                  {editing.ChannelKey}
                </code>
              ) : (
                <Input
                  id="channelKey"
                  placeholder="e.g. my-service-api"
                  value={form.channelKey}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      channelKey: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                    }))
                  }
                />
              )}
            </div>

            {/* Label */}
            <div className="space-y-1.5">
              <Label htmlFor="label">Label *</Label>
              <Input
                id="label"
                placeholder="e.g. My Service API"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Short description shown in the admin UI"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Sort Order */}
            <div className="space-y-1.5">
              <Label htmlFor="sortOrder">Sort Order</Label>
              <Input
                id="sortOrder"
                type="number"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-gradient-to-r from-blue-500 to-indigo-600 shadow-sm hover:opacity-90 gap-1.5 shrink-0 font-heading font-semibold text-white text-sm px-5 py-2 h-auto">
              {saving ? "Saving…" : editing ? "Save Changes" : "Create Channel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm */}
      <AlertDialog open={!!confirmTarget} onOpenChange={() => setConfirmTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PowerOff className="h-4 w-4 text-destructive" />
              Deactivate channel?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{confirmTarget?.Label}</strong> (
              <code className="text-xs">{confirmTarget?.ChannelKey}</code>) will be hidden from
              the Communicator integration list. Existing config in{" "}
              <code className="text-xs">CommunicatorConfig</code> is preserved and can be
              restored by reactivating the channel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (confirmTarget) applyToggle(confirmTarget, false);
                setConfirmTarget(null);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </AdminShell>
    </>
  );
}