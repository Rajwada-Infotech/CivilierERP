// DPR Tag Master — the tags that group Civil Work DPR activities (web: /civilworkdpr/dpr-tag-master).
// View, search, add, rename, activate/deactivate and delete. Tags typed on an activity in the web's
// Activity Master land here automatically; names are unique (case-insensitive).
import { useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit2, Plus, Search, Trash2, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { usePageRights } from "@/hooks/usePageRights";
import { createDprTag, deleteDprTag, getDprTags, updateDprTag, type DprTag } from "@/api/cwdApi";
import { ACCENT, Btn, Empty, ErrorText, Loading, card } from "@/screens/activities/tabs/ui";

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

  if (!rights.canView) {
    return <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}><Empty text="You don't have access to the DPR Tag Master." /></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 14, paddingBottom: 96, gap: 10 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={tagsQ.isRefetching} onRefresh={() => tagsQ.refetch()} tintColor={colors.mutedForeground} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 12 }}>
        <Search size={14} color={colors.mutedForeground} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search tags…" placeholderTextColor={`${colors.mutedForeground}99`} style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, paddingVertical: 10 }} />
        {!!search && <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}><X size={14} color={colors.mutedForeground} /></TouchableOpacity>}
      </View>

      {rights.canCreate && !editing && <Btn label="New tag" icon={<Plus size={14} color="#04181d" />} onPress={() => { setName(""); setActive(true); setEditing("new"); }} />}

      {editing && (
        <View style={{ ...card, gap: 10 }}>
          <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{editing === "new" ? "New tag" : "Edit tag"}</Text>
          <TextInput value={name} onChangeText={setName} maxLength={100} placeholder="Tag name" placeholderTextColor={`${colors.mutedForeground}99`} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13 }} />
          {editing !== "new" && (
            <TouchableOpacity onPress={() => setActive((v) => !v)} style={{ alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, backgroundColor: active ? "#10b98122" : colors.muted }}>
              <Text style={{ fontSize: 11, fontFamily: fonts.heading.semibold, color: active ? "#10b981" : colors.mutedForeground }}>{active ? "Active" : "Inactive"}</Text>
            </TouchableOpacity>
          )}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Btn tone="outline" label="Cancel" onPress={() => setEditing(null)} /></View>
            <View style={{ flex: 1 }}><Btn label={editing === "new" ? "Add" : "Update"} busy={save.isPending} onPress={() => save.mutate()} /></View>
          </View>
        </View>
      )}

      {tagsQ.isLoading ? <Loading /> : tagsQ.error ? <ErrorText error={tagsQ.error} /> : shown.length === 0 ? (
        <Empty text="No tags yet. Add one, or type a new tag on an activity." />
      ) : shown.map((t) => (
        <View key={t.id} style={{ ...card, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{t.tagName}</Text>
            <Text style={{ fontSize: 10.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>
              {t.activityCount} activit{t.activityCount === 1 ? "y" : "ies"}{t.isActive ? "" : " · Inactive"}
            </Text>
          </View>
          {rights.canEdit && <TouchableOpacity onPress={() => { setName(t.tagName); setActive(t.isActive); setEditing(t); }} hitSlop={8} style={{ padding: 6 }}><Edit2 size={15} color={ACCENT} /></TouchableOpacity>}
          {rights.canDelete && <TouchableOpacity onPress={() => remove(t)} hitSlop={8} style={{ padding: 6 }}><Trash2 size={15} color={colors.destructive} /></TouchableOpacity>}
        </View>
      ))}
    </ScrollView>
  );
}
