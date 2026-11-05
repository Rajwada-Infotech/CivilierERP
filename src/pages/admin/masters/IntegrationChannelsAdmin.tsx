import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Plus, Pencil, Search, X } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePageRights } from "@/hooks/usePageRights";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell, SheetMark } from "@/components/sheet/Sheet";

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
  /** Names of the Social Media platforms linked to this channel. */
  UsedBy?: string[];
}

const EMPTY_FORM = {
  channelKey: "",
  label: "",
  description: "",
  sortOrder: 0,
};

const LBL = "font-heading text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground";
const HEAD = "font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground";
const RULE = "1px solid hsl(var(--foreground))";
const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const FIELD = "w-full h-9 px-2.5 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none";
const ACT = "w-7 h-7 flex items-center justify-center border border-transparent text-muted-foreground hover:text-foreground hover:border-foreground transition-colors";

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
    linked: channels.reduce((n, c) => n + (c.UsedBy?.length ?? 0), 0),
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
            // "" (not null) so clearing the description sticks — the server keeps the old value for null.
            description: form.description.trim(),
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
      <SheetShell
        eyebrow="CivilierERP · Admin · Masters"
        title="Integration channels"
        subtitle="The API integrations a Social Media platform can be linked to. Email, SMS and WhatsApp delivery is set up under Communicator, not here."
        action={
          rights.canCreate && (
            <button type="button" onClick={openAdd} className={`${KEY_INK} h-9 px-4`}>
              <Plus size={13} /> Add channel
            </button>
          )
        }
      >
        {/* Counts */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="statrow four" style={{ padding: "16px 16px 18px" }}>
            {[
              { label: "Channels", value: stats.total, note: "in the list" },
              { label: "Active", value: stats.active, note: "offered on Social Media" },
              { label: "Inactive", value: stats.inactive, note: "hidden from new links" },
              { label: "Linked platforms", value: stats.linked, note: "Social Media platforms using one" },
            ].map((x) => (
              <div key={x.label}>
                <p className="label">{x.label}</p>
                <p className="figure" style={{ fontSize: "clamp(18px, 2vw, 26px)", marginTop: 9 }}>{loading ? "…" : x.value}</p>
                <p style={{ fontSize: 11.5, color: "var(--graphite)", marginTop: 6 }}>{x.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Search + table */}
        <div className="bg-card" style={{ border: RULE }}>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" style={{ borderBottom: RULE }}>
            <span className={HEAD}>Channels</span>
            <div className="relative w-full sm:w-72">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Search channels…"
                aria-label="Search channels"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${FIELD} pl-8 pr-8`}
              />
              {search && (
                <button onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {loading ? (
            <p className="py-12 text-center text-muted-foreground text-sm">Loading channels…</p>
          ) : filtered.length === 0 ? (
            <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground text-sm">
              <p>{search ? "No channels match this search." : "No channels yet."}</p>
              {!search && rights.canCreate && (
                <button type="button" onClick={openAdd} className={`${KEY_LINE} h-8 px-3`}>
                  <Plus size={12} /> Add the first channel
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto thin-scroll">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className={LBL} style={{ boxShadow: "inset 0 -1px 0 hsl(var(--foreground) / 0.3)" }}>
                    <th className="text-left py-2.5 px-4 font-semibold">Key</th>
                    <th className="text-left py-2.5 px-4 font-semibold">Label</th>
                    <th className="text-left py-2.5 px-4 font-semibold">Used by</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Order</th>
                    <th className="text-left py-2.5 px-4 font-semibold">Status</th>
                    <th className="text-right py-2.5 px-4 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-foreground/10">
                  {filtered.map((ch) => (
                    <tr key={ch.Id} className={`hover:bg-primary/5 transition-colors ${ch.IsActive ? "" : "text-muted-foreground"}`}>
                      <td className="py-3 px-4 align-top">
                        <span className="font-heading text-xs tabular-nums border border-foreground/30 px-1.5 py-0.5">{ch.ChannelKey}</span>
                      </td>
                      <td className="py-3 px-4 align-top">
                        <p className={`font-medium ${ch.IsActive ? "text-foreground" : ""}`}>{ch.Label}</p>
                        {ch.Description && <p className="text-xs text-muted-foreground mt-0.5 max-w-[34ch]">{ch.Description}</p>}
                      </td>
                      <td className="py-3 px-4 align-top text-xs">
                        {ch.UsedBy && ch.UsedBy.length > 0 ? (
                          <span className="text-foreground">{ch.UsedBy.join(", ")}</span>
                        ) : (
                          <span className="text-muted-foreground">No platform</span>
                        )}
                      </td>
                      <td className="py-3 px-4 align-top text-right font-heading tabular-nums">{ch.SortOrder}</td>
                      <td className="py-3 px-4 align-top">
                        <SheetMark text={ch.IsActive ? "Active" : "Inactive"} tone={ch.IsActive ? "done" : "waiting"} />
                      </td>
                      <td className="py-2 px-4 align-top">
                        {rights.canEdit && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button type="button" onClick={() => openEdit(ch)} className={ACT} title="Edit" aria-label={`Edit ${ch.Label}`}>
                              <Pencil size={13} />
                            </button>
                            <button type="button" onClick={() => handleToggle(ch)} className={`${KEY_LINE} h-7 px-2.5`}>
                              {ch.IsActive ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground max-w-prose border-l-2 border-foreground/40 pl-3 py-0.5">
          A channel only labels which integration a platform uses; ad sync runs on the platform's own access token, set on the{" "}
          <Link to="/sales-automation/social-media" className="text-foreground underline underline-offset-2">Social Media master</Link>.
        </p>
      </SheetShell>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sheet-frame sm:max-w-md" style={{ margin: 0 }}>
          <DialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>Integration channel</p>
              <DialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">
                {editing ? "Edit channel" : "Add channel"}
              </DialogTitle>
              <DialogDescription className="sr-only">Key, label, description and order of the channel</DialogDescription>
            </div>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label htmlFor="channelKey" className={`${LBL} block`}>
                Channel key
                {!editing && <span className="normal-case tracking-normal font-normal"> — lowercase and hyphens; cannot be changed later</span>}
              </label>
              {editing ? (
                <p className="font-heading text-sm tabular-nums border border-dashed border-foreground/40 px-2.5 py-2">{editing.ChannelKey}</p>
              ) : (
                <input
                  id="channelKey"
                  className={FIELD}
                  placeholder="e.g. meta-marketing-api"
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

            <div className="space-y-1.5">
              <label htmlFor="label" className={`${LBL} block`}>Label <span className="text-destructive">*</span></label>
              <input
                id="label"
                className={FIELD}
                placeholder="e.g. Meta Marketing API"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="description" className={`${LBL} block`}>Description</label>
              <textarea
                id="description"
                className="w-full px-2.5 py-2 border border-foreground/40 focus:border-foreground bg-card text-sm text-foreground placeholder:text-muted-foreground/60 outline-none resize-none"
                placeholder="Shown under the label in this list"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="sortOrder" className={`${LBL} block`}>Sort order</label>
              <input
                id="sortOrder"
                type="number"
                className={`${FIELD} w-32 tabular-nums`}
                value={form.sortOrder}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value) || 0 }))
                }
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3" style={{ borderTop: RULE }}>
            <button type="button" onClick={() => setDialogOpen(false)} disabled={saving} className={`${KEY_LINE} h-9 px-4`}>
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={saving} className={`${KEY_INK} h-9 px-5`}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create channel"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm */}
      <AlertDialog open={!!confirmTarget} onOpenChange={() => setConfirmTarget(null)}>
        <AlertDialogContent className="sheet-frame" style={{ margin: 0 }}>
          <AlertDialogHeader>
            <div className="pb-3" style={{ borderBottom: RULE }}>
              <p className={LBL}>{confirmTarget?.ChannelKey}</p>
              <AlertDialogTitle className="font-heading text-lg font-bold tracking-tight mt-1">Deactivate {confirmTarget?.Label}</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              It will no longer be offered when linking a Social Media platform.
              {confirmTarget?.UsedBy && confirmTarget.UsedBy.length > 0
                ? ` ${confirmTarget.UsedBy.join(", ")} stay${confirmTarget.UsedBy.length === 1 ? "s" : ""} linked to it.`
                : " No platform is linked to it."}{" "}
              You can reactivate it at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="pt-3" style={{ borderTop: RULE }}>
            <AlertDialogCancel className={`${KEY} h-9 px-4 rounded-none border border-foreground text-foreground bg-card hover:bg-primary/10`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={`${KEY} h-9 px-5 rounded-none !bg-destructive !text-destructive-foreground border border-destructive hover:!bg-destructive/90`}
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
    </>
  );
}
