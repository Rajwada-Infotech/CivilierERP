// One group or activity opened at the side: its details and, for an activity, the items it uses.
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Trash2, X } from "lucide-react";
import { BodyPortal } from "@/components/ui/body-portal";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DbActivity } from "@/api/engineeringActivityMasterApi";
import { getItems, type DbItem } from "@/api/itemMasterApi";
import { addActivityItem, deleteActivityItem, getActivityItems } from "@/api/engineeringActivityItemsApi";
import { ActiveMark, LBL, RULE } from "./ActivityTree";

const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <p className={`${LBL} mb-1`}>{label}</p>
    <div className="text-sm text-foreground">{children}</div>
  </div>
);

export const ActivityDrawer: React.FC<{ record: DbActivity; groupName?: string; canEdit: boolean; onClose: () => void }> = ({ record, groupName, canEdit, onClose }) => {
  const qc = useQueryClient();
  const isActivity = record.activity_type === 1;
  const [addOpen, setAddOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: linked = [] } = useQuery({
    queryKey: ["engineeringActivityItems", record.id],
    queryFn: () => getActivityItems(record.id),
    enabled: isActivity,
  });
  const { data: allItems = [] } = useQuery<DbItem[]>({ queryKey: ["items-for-activity-link"], queryFn: getItems, enabled: addOpen });
  const unlinked = allItems.filter((i) => !linked.some((li) => li.itemId === i.M_Id));
  const q = search.trim().toLowerCase();
  const offered = q ? unlinked.filter((i) => i.M_Name.toLowerCase().includes(q) || String(i.M_code ?? "").toLowerCase().includes(q)) : unlinked;

  const closeAdd = () => {
    setAddOpen(false);
    setPicked("");
    setSearch("");
  };
  const link = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      await addActivityItem(record.id, picked);
      toast.success("Item linked");
      await qc.invalidateQueries({ queryKey: ["engineeringActivityItems", record.id] });
      closeAdd();
    } catch (err: any) {
      toast.error("Could not link the item: " + err.message);
    } finally {
      setBusy(false);
    }
  };
  const unlink = async (id: number) => {
    try {
      await deleteActivityItem(id);
      await qc.invalidateQueries({ queryKey: ["engineeringActivityItems", record.id] });
    } catch (err: any) {
      toast.error("Could not unlink the item: " + err.message);
    }
  };

  return (
    <>
      <BodyPortal>
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={onClose} />
          <div className="relative w-full max-w-sm bg-card flex flex-col animate-in slide-in-from-right duration-200" style={{ borderLeft: RULE }}>
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: RULE }}>
              <div>
                <p className={LBL}>{isActivity ? "Activity" : "Group"}</p>
                <h3 className="font-heading text-base font-bold text-foreground">{record.activity_name}</h3>
              </div>
              <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground" title="Close">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              <Row label="Short description">{record.short_description || <span className="text-muted-foreground">—</span>}</Row>
              {isActivity && <Row label="Group">{groupName || <span className="text-destructive">No group</span>}</Row>}
              {isActivity && <Row label="SAC code">{record.hsn_code ? <span className="font-heading tabular-nums">{record.hsn_code}</span> : <span className="text-muted-foreground">Not assigned</span>}</Row>}
              {isActivity && <Row label="GL head">{record.gl_head_name || <span className="text-muted-foreground">Not assigned</span>}</Row>}
              <Row label="Status"><ActiveMark active={record.is_active} /></Row>

              {isActivity && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className={LBL}>Items used · {linked.length}</p>
                    {canEdit && (
                      <button onClick={() => setAddOpen(true)} className={`${KEY_LINE} h-7 px-2`}>
                        <Plus size={11} /> Add item
                      </button>
                    )}
                  </div>
                  {linked.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No items linked yet.</p>
                  ) : (
                    <div style={{ border: "1px solid hsl(var(--foreground) / 0.25)" }}>
                      {linked.map((li) => (
                        <div key={li.id} className="flex items-center gap-2 px-3 py-2 border-b border-foreground/10 last:border-0">
                          <span className="text-sm text-foreground flex-1 truncate">{li.itemName}</span>
                          {li.uom && <span className="font-heading text-[0.625rem] text-muted-foreground shrink-0">{li.uom}</span>}
                          {canEdit && (
                            <button onClick={() => unlink(li.id)} className="p-0.5 text-muted-foreground hover:text-destructive shrink-0" title="Unlink item">
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </BodyPortal>

      <Dialog open={addOpen} onOpenChange={(o) => (o ? setAddOpen(true) : closeAdd())}>
        <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pb-3">
            <DialogTitle className="font-heading text-base">Link an item to {record.activity_name}</DialogTitle>
          </DialogHeader>
          <div className="px-5 pb-3 relative">
            <Search size={13} className="absolute left-8 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items by name or code…"
              className="w-full h-9 pl-8 pr-3 text-sm bg-card border border-foreground/40 focus:border-foreground outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto px-5 pb-5 space-y-1">
            {unlinked.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">Every item is already linked to this activity.</p>
            ) : offered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No items match "{search}".</p>
            ) : (
              offered.map((i) => (
                <button
                  key={i.M_Id}
                  type="button"
                  onClick={() => setPicked(i.M_Id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm border transition-colors ${picked === i.M_Id ? "border-foreground bg-primary/10" : "border-transparent hover:bg-primary/5"}`}
                >
                  <span className="flex-1 truncate text-foreground">{i.M_Name}</span>
                  {i.M_UOM && <span className="font-heading text-[0.625rem] text-muted-foreground shrink-0">{i.M_UOM}</span>}
                </button>
              ))
            )}
          </div>
          <DialogFooter className="px-5 py-4" style={{ borderTop: RULE }}>
            <button onClick={closeAdd} className={`${KEY_LINE} h-9 px-3`}>Cancel</button>
            <button onClick={link} disabled={!picked || busy} className={`${KEY_INK} h-9 px-4`}>{busy ? "Linking…" : "Link item"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
