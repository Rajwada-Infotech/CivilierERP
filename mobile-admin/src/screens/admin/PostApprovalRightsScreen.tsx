// RN port of src/pages/admin/PostApprovalRights.tsx (web) — same two
// subject modes (Role-wise baseline vs. Custom User-wise override), same
// single "post-approval" action toggle per eligible page. Web's inline
// positioned dropdowns become PickerRow + OptionPickerModal (bottom sheet),
// same as every other "choose one" field in this app.
import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, Switch, Alert, useWindowDimensions } from "react-native";
import { ShieldCheck, Save, Users } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import {
  fetchPageDefinitions, getUsersForRights, getUserPermissions, saveUserPermissions,
  getRolesList, getRolePermissions, saveRolePermissions,
  POST_APPROVAL_ACTION, type PageDef, type PagePermission,
} from "@/api/postApprovalRightsApi";

type Subject = "user" | "role";

function SubjectToggle({ subject, onChange }: { subject: Subject; onChange: (s: Subject) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 4, padding: 4, borderRadius: 12, backgroundColor: colors.muted, alignSelf: "flex-start", marginBottom: 12 }}>
      {(["role", "user"] as Subject[]).map((s) => {
        const active = subject === s;
        return (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, backgroundColor: active ? colors.card : "transparent", borderWidth: active ? 1 : 0, borderColor: colors.border }}
          >
            <Text style={{ color: active ? colors.foreground : colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.medium }}>
              {s === "role" ? "Role-wise" : "Custom User-wise"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PageRow({ page, checked, onToggle }: { page: PageDef; checked: boolean; onToggle: () => void }) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, padding: 12, marginBottom: 8, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium }}>{page.label}</Text>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 2 }}>{page.module}</Text>
      </View>
      <Switch
        value={checked}
        onValueChange={onToggle}
        trackColor={{ false: colors.muted, true: `${colors.primary}80` }}
        thumbColor={checked ? colors.primary : "#f4f3f4"}
      />
    </View>
  );
}

export default function PostApprovalRightsScreen() {
  const { width } = useWindowDimensions();

  const [pageDefs, setPageDefs] = useState<PageDef[]>([]);
  const [loadingDefs, setLoadingDefs] = useState(true);

  const [subject, setSubject] = useState<Subject>("user");
  const [users, setUsers] = useState<{ id: number; name: string; role: string }[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [userPickerOpen, setUserPickerOpen] = useState(false);

  const [roles, setRoles] = useState<{ RId: number; RName: string }[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);

  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetchPageDefinitions()
      .then(setPageDefs)
      .catch(() => Alert.alert("Error", "Failed to load page definitions"))
      .finally(() => setLoadingDefs(false));
  }, []);

  useEffect(() => {
    getUsersForRights()
      .then(setUsers)
      .catch(() => Alert.alert("Error", "Failed to load users"))
      .finally(() => setLoadingUsers(false));
  }, []);

  useEffect(() => {
    getRolesList()
      .then(setRoles)
      .catch(() => Alert.alert("Error", "Failed to load roles"))
      .finally(() => setLoadingRoles(false));
  }, []);

  const eligiblePages = useMemo(() => pageDefs.filter((p) => p.actions.includes(POST_APPROVAL_ACTION)), [pageDefs]);

  const selectedUser = users.find((u) => u.id === selectedUserId);
  const selectedRole = roles.find((r) => r.RId === selectedRoleId);
  const hasSubjectSelected = subject === "user" ? !!selectedUser : !!selectedRole;

  const switchSubject = (next: Subject) => {
    setSubject(next);
    setSelectedUserId(null);
    setSelectedRoleId(null);
    setPermissions([]);
    setDirty(false);
  };

  useEffect(() => {
    if (subject !== "user" || !selectedUserId) return;
    setLoadingPerms(true);
    setDirty(false);
    getUserPermissions(selectedUserId)
      .then(setPermissions)
      .catch(() => { Alert.alert("Error", "Failed to load permissions"); setPermissions([]); })
      .finally(() => setLoadingPerms(false));
  }, [subject, selectedUserId]);

  useEffect(() => {
    if (subject !== "role" || !selectedRoleId) return;
    setLoadingPerms(true);
    setDirty(false);
    getRolePermissions(selectedRoleId)
      .then(setPermissions)
      .catch(() => { Alert.alert("Error", "Failed to load role permissions"); setPermissions([]); })
      .finally(() => setLoadingPerms(false));
  }, [subject, selectedRoleId]);

  const isGranted = (pageKey: string) =>
    permissions.find((p) => p.page === pageKey)?.actions.includes(POST_APPROVAL_ACTION) ?? false;

  const toggle = (pageKey: string) => {
    setDirty(true);
    setPermissions((prev) => {
      const idx = prev.findIndex((p) => p.page === pageKey);
      const current = idx >= 0 ? [...prev[idx].actions] : [];
      const next = current.includes(POST_APPROVAL_ACTION)
        ? current.filter((a) => a !== POST_APPROVAL_ACTION)
        : [...current, POST_APPROVAL_ACTION];
      const newPerm: PagePermission = { page: pageKey, actions: next };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newPerm;
        return copy;
      }
      return [...prev, newPerm];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (subject === "user") {
        if (!selectedUserId) return;
        await saveUserPermissions(selectedUserId, permissions);
        setDirty(false);
      } else {
        if (!selectedRoleId) return;
        await saveRolePermissions(selectedRoleId, permissions);
        setDirty(false);
      }
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const grantedCount = eligiblePages.filter((p) => isGranted(p.key)).length;

  const userOptions: PickerOption[] = users.map((u) => ({ key: String(u.id), label: u.name, sublabel: u.role.replace(/_/g, " ") }));
  const roleOptions: PickerOption[] = roles.map((r) => ({ key: String(r.RId), label: r.RName }));

  const ListHeader = (
    <View style={{ width: width - 32 }}>
      <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, marginBottom: 3 }}>Post Approval Rights</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 11.5, marginBottom: 14 }}>
        Who can edit a record after it has already been Approved.
      </Text>

      <View style={{ borderRadius: 16, padding: 14, marginBottom: 14, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <Users size={12} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {subject === "user" ? "Select User" : "Select Role"}
          </Text>
        </View>

        <SubjectToggle subject={subject} onChange={switchSubject} />

        {subject === "role" && (
          <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10.5, lineHeight: 15, marginBottom: 10 }}>
            Sets the baseline every user with this role inherits, effective immediately — a user's own overrides (Custom User-wise) can only add on top of this.
          </Text>
        )}

        {subject === "user" ? (
          <PickerRow
            label="User"
            value={loadingUsers ? "" : selectedUser?.name ?? ""}
            placeholder={loadingUsers ? "Loading users…" : "Choose a user…"}
            sublabel={selectedUser?.role}
            onPress={() => setUserPickerOpen(true)}
          />
        ) : (
          <PickerRow
            label="Role"
            value={loadingRoles ? "" : selectedRole?.RName ?? ""}
            placeholder={loadingRoles ? "Loading roles…" : "Choose a role…"}
            onPress={() => setRolePickerOpen(true)}
          />
        )}
      </View>

      {loadingDefs && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Loading eligible pages…</Text>
        </View>
      )}

      {hasSubjectSelected && !loadingPerms && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", flex: 1 }}>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: `${colors.primary}1a` }}>
              <Text style={{ color: colors.primary, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>
                {grantedCount}/{eligiblePages.length} granted
              </Text>
            </View>
            {dirty && (
              <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#f59e0b1a", borderWidth: 1, borderColor: "#f59e0b40" }}>
                <Text style={{ color: "#f59e0b", fontSize: 10.5, fontFamily: fonts.heading.semibold }}>Unsaved</Text>
              </View>
            )}
          </View>
          <Pressable
            onPress={handleSave}
            disabled={saving || !dirty}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.primary, opacity: saving || !dirty ? 0.5 : 1 }}
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Save size={13} color="#fff" />}
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>{saving ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {!hasSubjectSelected ? (
        <View style={{ flex: 1, padding: 16 }}>
          {ListHeader}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, marginTop: 8 }}>
            <ShieldCheck size={36} color={`${colors.mutedForeground}33`} />
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium, marginTop: 12, textAlign: "center", paddingHorizontal: 30 }}>
              {subject === "user" ? "Select a user to manage post-approval rights" : "Select a role to manage its post-approval baseline"}
            </Text>
          </View>
        </View>
      ) : loadingPerms ? (
        <View style={{ flex: 1, padding: 16 }}>
          {ListHeader}
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        </View>
      ) : (
        <FlatList
          data={eligiblePages}
          keyExtractor={(p) => p.key}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingTop: 12 }}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => <PageRow page={item} checked={isGranted(item.key)} onToggle={() => toggle(item.key)} />}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>
              No pages currently support post-approval editing.
            </Text>
          }
        />
      )}

      <OptionPickerModal
        visible={userPickerOpen}
        title="Select User"
        options={userOptions}
        selectedKey={selectedUserId != null ? String(selectedUserId) : null}
        searchable
        onSelect={(k) => { setSelectedUserId(k ? Number(k) : null); setUserPickerOpen(false); }}
        onClose={() => setUserPickerOpen(false)}
      />
      <OptionPickerModal
        visible={rolePickerOpen}
        title="Select Role"
        options={roleOptions}
        selectedKey={selectedRoleId != null ? String(selectedRoleId) : null}
        searchable
        onSelect={(k) => { setSelectedRoleId(k ? Number(k) : null); setRolePickerOpen(false); }}
        onClose={() => setRolePickerOpen(false)}
      />
    </View>
  );
}
