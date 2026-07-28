// RN port of src/pages/admin/ApprovalSetup.tsx's list view (web) — same
// endpoint/actions (toggle, edit, delete), rebuilt as a card list. The
// create/edit wizard lives in ApprovalSetupFormModal.tsx.
import { useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl, Alert, Switch, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Plus, Pencil, Trash2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuth } from "@/auth/AuthContext";
import { fetchWorkflows, getUsers, toggleWorkflow, deleteWorkflow, type ApprovalWorkflow } from "@/api/approvalSetupApi";
import { MODULE_OPTIONS, APPROVAL_TYPES } from "./approvalSetupConfig";
import { ApprovalSetupFormModal } from "./ApprovalSetupFormModal";

function WorkflowCard({
  wf, canEdit, canDelete, onToggle, onEdit, onDelete,
}: { wf: ApprovalWorkflow; canEdit: boolean; canDelete: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const typeInfo = APPROVAL_TYPES.find((t) => t.id === wf.type);
  const TypeIcon = typeInfo?.icon ?? ShieldCheck;

  return (
    <View
      className="rounded-2xl p-3.5 mb-2.5"
      style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99`, opacity: wf.active ? 1 : 0.6 }}
    >
      <View className="flex-row items-start justify-between gap-2 mb-2">
        <View className="flex-row items-center gap-2 flex-1 min-w-0">
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: wf.active ? "#10b981" : colors.mutedForeground }} />
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold, flexShrink: 1 }}>{wf.name}</Text>
        </View>
        <View className="flex-row items-center gap-1">
          {canEdit && (
            <Pressable onPress={onEdit} hitSlop={6} className="p-1.5 rounded-lg" style={{ backgroundColor: `${colors.primary}14` }}>
              <Pencil size={12} color={colors.primary} />
            </Pressable>
          )}
          {canDelete && (
            <Pressable onPress={onDelete} hitSlop={6} className="p-1.5 rounded-lg" style={{ backgroundColor: `${colors.destructive}14` }}>
              <Trash2 size={12} color={colors.destructive} />
            </Pressable>
          )}
        </View>
      </View>

      <View className="flex-row items-center gap-1.5 mb-2">
        <TypeIcon size={11} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{typeInfo?.label}</Text>
        <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 10.5 }}>· {wf.levels.length} step{wf.levels.length !== 1 ? "s" : ""}</Text>
      </View>

      <View className="flex-row flex-wrap gap-1.5 mb-2.5">
        {wf.modules.slice(0, 4).map((mid) => {
          const m = MODULE_OPTIONS.find((x) => x.id === mid);
          return (
            <View key={mid} className="px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{m?.icon} {m?.label ?? mid}</Text>
            </View>
          );
        })}
        {wf.modules.length > 4 && (
          <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>+{wf.modules.length - 4} more</Text>
          </View>
        )}
      </View>

      <View className="flex-row items-center justify-between pt-2" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}66` }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.medium }}>{wf.active ? "On" : "Off"}</Text>
        <Switch
          value={wf.active}
          onValueChange={onToggle}
          disabled={!canEdit}
          trackColor={{ false: colors.muted, true: `${colors.primary}80` }}
          thumbColor={wf.active ? colors.primary : "#f4f3f4"}
        />
      </View>
    </View>
  );
}

export default function ApprovalSetupScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { canDoAction } = useAuth();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalWorkflow | null>(null);

  const { data: workflows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["approval-workflows"],
    queryFn: fetchWorkflows,
    staleTime: 30_000,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["approval-setup-users"],
    queryFn: getUsers,
    staleTime: 60_000,
  });

  const canCreate = canDoAction("admin_approval_setup", "create");
  const canEdit = canDoAction("admin_approval_setup", "edit");
  const canDelete = canDoAction("admin_approval_setup", "delete");

  const openNew = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (wf: ApprovalWorkflow) => { setEditing(wf); setFormOpen(true); };

  const handleToggle = async (wf: ApprovalWorkflow) => {
    try {
      await toggleWorkflow(wf.id);
      queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
    } catch (e: any) {
      Alert.alert("Toggle failed", e.message || "Something went wrong.");
    }
  };

  const confirmDelete = (wf: ApprovalWorkflow) => {
    Alert.alert("Delete Approval Rule?", `"${wf.name}" will be permanently removed. This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteWorkflow(wf.id);
            queryClient.invalidateQueries({ queryKey: ["approval-workflows"] });
          } catch (e: any) {
            Alert.alert("Delete failed", e.message || "Something went wrong.");
          }
        },
      },
    ]);
  };

  const ListHeader = (
    <View style={{ width: width - 32, marginBottom: 14 }}>
      <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>Approval Rules</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 11.5, marginTop: 3 }}>
        Control who needs to approve requests before they go through.
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <FlatList
          data={workflows}
          keyExtractor={(wf) => String(wf.id)}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={isFetching && !isLoading} onRefresh={refetch} tintColor={colors.primary} />}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => (
            <WorkflowCard
              wf={item}
              canEdit={canEdit}
              canDelete={canDelete}
              onToggle={() => handleToggle(item)}
              onEdit={() => openEdit(item)}
              onDelete={() => confirmDelete(item)}
            />
          )}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingVertical: 48 }}>
              <ShieldCheck size={28} color={`${colors.mutedForeground}4d`} />
              <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 12 }}>No approval rules yet.</Text>
              <Text style={{ color: `${colors.mutedForeground}66`, fontSize: 11, marginTop: 3, textAlign: "center", paddingHorizontal: 24 }}>
                Once you create a rule, matching requests are automatically sent for approval.
              </Text>
            </View>
          }
        />
      )}

      {canCreate && (
        // Offset above NavSheet.tsx's own Menu FAB, which occupies this
        // same corner (right:20, bottom: insets.bottom+20) on every screen.
        <Pressable
          onPress={openNew}
          style={{ position: "absolute", right: 20, bottom: insets.bottom + 90, width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, elevation: 6, shadowColor: colors.primary, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}
        >
          <Plus size={22} color="#fff" />
        </Pressable>
      )}

      <ApprovalSetupFormModal
        visible={formOpen}
        editing={editing}
        users={users}
        onClose={() => setFormOpen(false)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["approval-workflows"] })}
      />
    </View>
  );
}
