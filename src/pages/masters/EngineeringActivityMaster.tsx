// Engineering's own Activity Master — split from src/pages/masters/ActivityMaster.tsx (migration 463) so Engineering
// (BOQ, Work Order) and Civil Work DPR each manage their own activity list. Civil Work DPR keeps the original
// ActivityMaster.tsx / table. Parts under ./engineeringActivity: ActivityTree (groups and their activities),
// ActivityDrawer (one opened, with the items it uses).
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Search } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SheetShell } from "@/components/sheet/Sheet";
import { MasterPage, type DataChangeEvent, type RecordWithId } from "@/components/MasterPage";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getActivities, addActivity, updateActivity, deleteActivity, toPayload, type DbActivity } from "@/api/engineeringActivityMasterApi";
import { getHsn } from "@/api/hsnApi";
import { getLedgerOptions } from "@/api/generalLedgerApi";
import { usePageRights } from "@/hooks/usePageRights";
import { GroupBlock, LBL, RULE, UngroupedBlock } from "./engineeringActivity/ActivityTree";
import { ActivityDrawer } from "./engineeringActivity/ActivityDrawer";

const KEY = "font-heading text-[0.625rem] font-semibold uppercase tracking-[0.1em] inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const KEY_INK = `${KEY} bg-foreground text-card border border-foreground`;
const KEY_LINE = `${KEY} border border-foreground text-foreground hover:bg-primary/10`;
const SELECT = "w-full h-10 border border-foreground/40 focus:border-foreground bg-card px-3 text-sm text-foreground outline-none disabled:opacity-50 disabled:cursor-not-allowed";

// SAC, GL head and group only apply to an activity: for a group the select is greyed out with a note why.
const TypeAwareSelect: React.FC<{ value: unknown; onChange: (v: string) => void; formData?: Record<string, unknown>; note: string; children: React.ReactNode }> = ({
  value,
  onChange,
  formData,
  note,
  children,
}) => {
  const isActivity = formData?.activityType === "Activity";
  return (
    <div className="flex flex-col gap-1">
      <select value={isActivity ? ((value as string) ?? "") : ""} disabled={!isActivity} onChange={(e) => onChange(e.target.value)} className={SELECT}>
        {children}
      </select>
      {!isActivity && <p className="text-[0.6875rem] text-muted-foreground">{note}</p>}
    </div>
  );
};

const exportToCSV = (items: DbActivity[], groups: DbActivity[]) => {
  const headers = ["Activity Name", "Short Description", "Type", "Group", "SAC", "GL Head", "Status"];
  const rows = items.map((item) => [
    item.activity_name,
    item.short_description,
    item.activity_type === 0 ? "Group" : "Activity",
    groups.find((g) => g.id === item.group_id)?.activity_name ?? "",
    item.hsn_code ?? "",
    item.gl_head_name ?? "",
    item.is_active ? "Active" : "Inactive",
  ]);
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "engineering-activity-master.csv";
  link.click();
  URL.revokeObjectURL(url);
};

const EngineeringActivityMaster: React.FC = () => {
  const queryClient = useQueryClient();
  const rights = usePageRights("engineering-activity-master");
  const [treeSearch, setTreeSearch] = useState("");
  const [viewId, setViewId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DbActivity | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit is started from the list below (MasterPage's own table is hidden), so it drives MasterPage's edit mode.
  const [editId, setEditId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState(0);
  const handleEditRequest = (item: DbActivity) => {
    setEditId(String(item.id));
    setEditKey((k) => k + 1);
  };

  const { data: dbData, isLoading, error } = useQuery<DbActivity[]>({
    queryKey: ["engineering-activities"],
    queryFn: getActivities,
    staleTime: 0,
    refetchOnMount: true,
  });
  const { data: hsnRaw = [] } = useQuery({ queryKey: ["hsn-master"], queryFn: getHsn });
  const { data: glHeadOptions = [] } = useQuery({ queryKey: ["gl-heads-for-engineering-activity"], queryFn: getLedgerOptions });

  // Services-side: only SAC rows of the HSN master are offered.
  const sacOptions = (Array.isArray(hsnRaw) ? (hsnRaw as any[]) : [])
    .filter((h) => h.HIsSAC === true)
    .map((h) => ({ code: String(h.HCode ?? ""), desc: String(h.HShortDescription ?? h.HDescription ?? "") }))
    .filter((h) => h.code !== "");

  const dbItems: DbActivity[] = Array.isArray(dbData) ? dbData : [];
  const groups = dbItems.filter((i) => i.activity_type === 0);
  const activityItems = dbItems.filter((i) => i.activity_type === 1);
  const ungrouped = activityItems.filter((a) => !a.group_id || !groups.some((g) => g.id === a.group_id));
  const groupOptions = groups.map((g) => ({ value: String(g.id), label: g.activity_name }));
  const viewRecord = viewId != null ? dbItems.find((d) => d.id === viewId) ?? null : null;

  const mappedData: RecordWithId[] = dbItems.map((item) => ({
    _id: String(item.id),
    activityName: item.activity_name || "",
    shortDesc: item.short_description || "",
    activityType: item.activity_type === 0 ? "Group" : "Activity",
    // The group's id: names can repeat across the history of the table, ids can't.
    groupId: item.group_id != null ? String(item.group_id) : "",
    belongsTo: item.belongsTo ?? "",
    status: item.is_active,
    hsnCode: item.hsn_code ?? "",
    glHeadId: item.gl_head_id != null ? String(item.gl_head_id) : "",
  }));

  // Re-read the list behind the form without dropping what is on screen (removing the query first sent the whole
  // page back to "Loading…" and threw the form away after every save).
  const reload = () => queryClient.invalidateQueries({ queryKey: ["engineering-activities"] });

  // MasterPage announces the save itself; this only talks to the server and keeps the list current.
  const handleDataEvent = async (event: DataChangeEvent) => {
    if (event.action === "add" || event.action === "update") {
      const payload = toPayload(event.record, groupOptions);
      if (payload.activity_type === 1 && !payload.group_id) throw new Error("Pick the group this activity belongs to.");
      if (event.action === "add") {
        const res = await addActivity(payload);
        await reload();
        // An activity's items are added from its detail panel: open it straight away.
        if (payload.activity_type === 1 && res.id) setViewId(res.id);
      } else {
        await updateActivity(event.id, payload);
        await reload();
      }
    }
    if (event.action === "delete") {
      await deleteActivity(event.id);
      await reload();
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await deleteActivity(confirmDelete.id);
      toast.success(`${confirmDelete.activity_type === 0 ? "Group" : "Activity"} deleted`);
      if (viewId === confirmDelete.id) setViewId(null);
      setConfirmDelete(null);
      await reload();
    } catch (err: any) {
      toast.error(err?.message || "Could not delete.");
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const treeProps = {
    search: treeSearch,
    canEdit: rights.canEdit,
    canDelete: rights.canDelete,
    onView: (a: DbActivity) => setViewId(a.id),
    onEdit: handleEditRequest,
    onDelete: (a: DbActivity) => setConfirmDelete(a),
  };

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Engineering", "Engineering Activity Master"]} />
      <SheetShell
        eyebrow="CivilierERP · Engineering"
        title="Activities"
        subtitle="Groups of work and the activities under them, with their SAC code, GL head and the items each uses; BOQs and work orders are priced from these."
      >
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="p-6 text-sm text-destructive">Could not load the activities.</p>
        ) : (
          <div className="space-y-5">
            <MasterPage
              canCreate={rights.canCreate}
              canEdit={rights.canEdit}
              canDelete={rights.canDelete}
              title="Activity"
              hideTable
              fields={[
                { name: "activityName", label: "Name", type: "text", required: true },
                { name: "shortDesc", label: "Short description", type: "text", required: true },
                { name: "activityType", label: "Type", type: "select", options: ["Group", "Activity"], required: true, defaultValue: "Group" },
                {
                  name: "groupId",
                  label: "Belongs to group",
                  type: "custom",
                  render: (p) => (
                    <TypeAwareSelect {...p} note="A group doesn't belong to another group.">
                      <option value="">{p.formData?.activityType === "Activity" ? "Select group…" : "—"}</option>
                      {groupOptions.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </TypeAwareSelect>
                  ),
                },
                {
                  name: "hsnCode",
                  label: "SAC code",
                  type: "custom",
                  render: (p) => (
                    <TypeAwareSelect {...p} note="SAC is set on an activity, not a group.">
                      <option value="">{p.formData?.activityType === "Activity" ? "Select SAC code…" : "—"}</option>
                      {sacOptions.map((h, i) => (
                        <option key={`${h.code}-${i}`} value={h.code}>{h.code}{h.desc ? ` — ${h.desc}` : ""}</option>
                      ))}
                    </TypeAwareSelect>
                  ),
                },
                {
                  name: "glHeadId",
                  label: "GL head",
                  type: "custom",
                  render: (p) => (
                    <TypeAwareSelect {...p} note="GL head is set on an activity, not a group.">
                      <option value="">{p.formData?.activityType === "Activity" ? "Select GL head…" : "—"}</option>
                      {glHeadOptions.map((g) => (
                        <option key={g.id} value={g.id}>{g.code ? `${g.code} — ${g.label}` : g.label}</option>
                      ))}
                    </TypeAwareSelect>
                  ),
                },
                { name: "status", label: "Status", type: "toggle", defaultValue: true },
              ]}
              columns={[
                { key: "activityName", label: "Name" },
                { key: "activityType", label: "Type" },
                { key: "status", label: "Status" },
              ]}
              initialData={mappedData}
              onDataEvent={handleDataEvent}
              requestEditId={editId}
              requestEditKey={editId ? `${editId}:${editKey}` : null}
            />

            <div className="bg-card" style={{ border: RULE }}>
              <div className="px-5 py-4 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1">
                  <p className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Activities by group</p>
                  <p className={`${LBL} mt-1`}>{groups.length} groups · {activityItems.length} activities</p>
                </div>
                <div className="relative md:w-64">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <input
                    value={treeSearch}
                    onChange={(e) => setTreeSearch(e.target.value)}
                    placeholder="Search groups and activities…"
                    className="w-full h-9 pl-9 pr-3 text-sm bg-card border border-foreground/40 focus:border-foreground outline-none"
                  />
                </div>
                {rights.canExport && (
                  <button onClick={() => exportToCSV(dbItems, groups)} className={`${KEY_LINE} h-9 px-3`}>
                    <Download size={13} /> Export
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {groups.map((group) => (
                <GroupBlock key={group.id} group={group} activities={activityItems.filter((a) => a.group_id === group.id)} {...treeProps} />
              ))}
              <UngroupedBlock activities={ungrouped} {...treeProps} />
              {groups.length === 0 && ungrouped.length === 0 && (
                <p className="bg-card px-5 py-10 text-center text-sm text-muted-foreground" style={{ border: RULE }}>
                  No groups or activities yet. Add a group first, then the activities under it.
                </p>
              )}
            </div>
          </div>
        )}
      </SheetShell>

      {viewRecord && (
        <ActivityDrawer
          record={viewRecord}
          groupName={groups.find((g) => g.id === viewRecord.group_id)?.activity_name}
          canEdit={rights.canEdit}
          onClose={() => setViewId(null)}
        />
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-heading">Delete {confirmDelete?.activity_type === 0 ? "group" : "activity"}?</DialogTitle>
            <DialogDescription>
              "{confirmDelete?.activity_name}" will be removed. One already used on a BOQ or work order, or a group with activities under it, can't be
              deleted — mark it inactive instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button onClick={() => setConfirmDelete(null)} className={`${KEY_LINE} h-9 px-3`}>Cancel</button>
            <button onClick={doDelete} disabled={deleting} className={`${KEY_INK} h-9 px-4`}>{deleting ? "Deleting…" : "Delete"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EngineeringActivityMaster;
