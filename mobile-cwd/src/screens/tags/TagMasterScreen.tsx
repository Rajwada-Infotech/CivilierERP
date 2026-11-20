// DPR Tag Master — the tags that group Civil Work DPR activities (web: /civilworkdpr/dpr-tag-master), on the drawing
// sheet: the page's title block, a search box, the add / edit form in an ink-ruled panel, and the tags as a ruled
// register with Edit and Delete keys. View, search, add, rename, activate/deactivate and delete. Tags typed on an
// activity in the web's Activity Master land here automatically; names are unique (case-insensitive).
import { useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, Plus, Trash2 } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { usePageRights } from "@/hooks/usePageRights";
import { createDprTag, deleteDprTag, getDprTags, updateDprTag, type DprTag } from "@/api/cwdApi";
import { Body, Field, IconKey, Input, Key, Notice, Panel, RegisterHead, SearchBox, Seg, SheetMark, SheetShell, Skel } from "@/components/sheet/Sheet";
import { NoAccess, SheetPage } from "@/components/sheet/Register";

export default function TagMasterScreen() {
  const rights = usePageRights("dpr-tag-master");
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<DprTag | "new" | null>(null);
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);

  const tagsQ = useQuery({ queryKey: ["cwd-dpr-tags"], queryFn: getDprTags, enabled: rights.canView });
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tagsQ.data ?? []).filter((t) => !q || t.tagName.toLowerCase().includes(q));
  }, [tagsQ.data, search]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["cwd-dpr-tags"] }); qc.invalidateQueries({ queryKey: ["cwd-report"] }); };

  const save = useMutation({
    mutationFn: () => {
      const n = name.trim();
      if (!n) throw new Error("Tag name is required");
      return editing === "new" || !editing ? createDprTag(n) : updateDprTag(editing.id, { tagName: n, isActive: active });
    },
    onSuccess: () => { toast.success(editing === "new" ? "Tag added" : "Tag updated"); setEditing(null); refresh(); },
    onError: (e: Error) => Alert.alert("Couldn't save", e.message),
  });

  const remove = (t: DprTag) =>
    Alert.alert("Delete tag", `Delete "${t.tagName}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try { await deleteDprTag(t.id); toast.success("Tag deleted"); refresh(); }
          catch (e) { Alert.alert("Couldn't delete", (e as Error).message); }
        },
      },
    ]);

  if (!rights.canView) return <NoAccess eyebrow="Civil Work DPR" title="DPR Tag Master" what="the DPR Tag Master" />;

  return (
    <SheetPage refreshing={tagsQ.isRefetching} onRefresh={() => void tagsQ.refetch()}>
      <SheetShell
        eyebrow="Civil Work DPR · Set-up"
        title="DPR Tag Master"
        subtitle="Tags that group activities. Tags typed on an activity on the web land here too."
        action={rights.canCreate && !editing ? <Key tone="ink" label="New tag" icon={<Plus size={14} color={S.paper} />} onPress={() => { setName(""); setActive(true); setEditing("new"); }} /> : undefined}
      >
        {editing && (
          <Panel title={editing === "new" ? "New tag" : "Edit tag"}>
            <Field label="Tag name" required>
              <Input value={name} onChangeText={setName} maxLength={100} placeholder="Tag name" autoFocus />
            </Field>
            {editing !== "new" && (
              <Field label="Status">
                <Seg options={[{ value: "on", label: "Active" }, { value: "off", label: "Inactive" }]} value={active ? "on" : "off"} onChange={(v) => setActive(v === "on")} />
              </Field>
            )}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Key label="Cancel" onPress={() => setEditing(null)} style={{ flex: 1 }} />
              <Key tone="ink" label={save.isPending ? "Saving…" : editing === "new" ? "Add" : "Update"} disabled={save.isPending} onPress={() => save.mutate()} style={{ flex: 1 }} />
            </View>
          </Panel>
        )}

        <SearchBox value={search} onChange={setSearch} placeholder="Search tags" />

        <View>
          <RegisterHead title="Tags" count={shown.length} unit={["tag", "tags"]} />
          {tagsQ.isLoading ? (
            <View style={{ paddingTop: 12 }}><Skel h={44} /><Skel h={44} /><Skel h={44} /></View>
          ) : tagsQ.error ? (
            <View style={{ paddingTop: 12 }}><Notice>{(tagsQ.error as Error).message}</Notice></View>
          ) : shown.length === 0 ? (
            <Body size={13} color={S.graphite} style={{ paddingVertical: 20 }}>No tags yet. Add one, or type a new tag on an activity.</Body>
          ) : (
            shown.map((t) => (
              <View key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: fonts.body.semibold, color: S.ink }}>{t.tagName}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Body size={11.5} color={S.graphite}>{t.activityCount} activit{t.activityCount === 1 ? "y" : "ies"}</Body>
                    <SheetMark text={t.isActive ? "Active" : "Inactive"} tone={t.isActive ? "done" : "draft"} />
                  </View>
                </View>
                {rights.canEdit && <IconKey onPress={() => { setName(t.tagName); setActive(t.isActive); setEditing(t); }}><Edit2 size={14} color={S.ink} /></IconKey>}
                {rights.canDelete && <IconKey red onPress={() => remove(t)}><Trash2 size={14} color={S.red} /></IconKey>}
              </View>
            ))
          )}
        </View>
      </SheetShell>
    </SheetPage>
  );
}
