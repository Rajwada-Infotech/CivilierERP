// RN port of src/pages/admin/MenuRights.tsx (web) — same subject modes
// (Role-wise / Custom User-wise), same page×action permission matrix, same
// presets, same module filter + search, same group "Grant all/Revoke all".
// Web's wide table (7 action columns) becomes a per-page card with the
// actions as a wrapped row of small toggle chips — a 7-column table doesn't
// fit a phone width, and this keeps every action independently tappable
// without horizontal scrolling.
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Switch } from "react-native";
import { Search, Save, Users, Check, ShieldCheck } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import { ALL_ACTIONS, MODULE_COLORS, ROLE_PRESETS } from "./menuRightsConfig";
import {
  fetchPageDefinitions, getUsersForRights, getUserPermissions, saveUserPermissions,
  getRolesList, getRolePermissions, saveRolePermissions,
  type PageDef, type PagePermission,
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

function ActionChip({ label, available, checked, onPress }: { label: string; available: boolean; checked: boolean; onPress: () => void }) {
  if (!available) {
    return (
      <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: `${colors.muted}66` }}>
        <Text style={{ color: `${colors.mutedForeground}4d`, fontSize: 10 }}>{label}</Text>
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, borderWidth: 1, borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primary : "transparent" }}
    >
      {checked && <Check size={9} color="#fff" />}
      <Text style={{ color: checked ? "#fff" : colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium }}>{label}</Text>
    </Pressable>
  );
}

export default function MenuRightsScreen() {
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

  const [pageSearch, setPageSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [permissions, setPermissions] = useState<PagePermission[]>([]);
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetchPageDefinitions().then(setPageDefs).catch(() => Alert.alert("Error", "Failed to load page definitions")).finally(() => setLoadingDefs(false));
  }, []);
  useEffect(() => {
    getUsersForRights().then(setUsers).catch(() => Alert.alert("Error", "Failed to load users")).finally(() => setLoadingUsers(false));
  }, []);
  useEffect(() => {
    getRolesList().then(setRoles).catch(() => Alert.alert("Error", "Failed to load roles")).finally(() => setLoadingRoles(false));
  }, []);

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
    getUserPermissions(selectedUserId).then(setPermissions).catch(() => { Alert.alert("Error", "Failed to load permissions"); setPermissions([]); }).finally(() => setLoadingPerms(false));
  }, [subject, selectedUserId]);

  useEffect(() => {
    if (subject !== "role" || !selectedRoleId) return;
    setLoadingPerms(true);
    setDirty(false);
    getRolePermissions(selectedRoleId).then(setPermissions).catch(() => { Alert.alert("Error", "Failed to load role permissions"); setPermissions([]); }).finally(() => setLoadingPerms(false));
  }, [subject, selectedRoleId]);

  const modules = useMemo(() => ["All", ...Array.from(new Set(pageDefs.map((p) => p.module)))], [pageDefs]);

  const filteredPages = useMemo(
    () => pageDefs.filter((p) => {
      const matchModule = moduleFilter === "All" || p.module === moduleFilter;
      const matchSearch = !pageSearch || p.label.toLowerCase().includes(pageSearch.toLowerCase()) || p.group.toLowerCase().includes(pageSearch.toLowerCase());
      return matchModule && matchSearch;
    }),
    [pageDefs, moduleFilter, pageSearch],
  );

  const groupedPages = useMemo(() => {
    const groups: Record<string, PageDef[]> = {};
    filteredPages.forEach((p) => { (groups[p.group] ??= []).push(p); });
    return groups;
  }, [filteredPages]);

  const getPermForPage = (pageKey: string) => permissions.find((p) => p.page === pageKey);
  const isChecked = (pageKey: string, action: string) => getPermForPage(pageKey)?.actions.includes(action) ?? false;

  const togglePermission = (pageKey: string, action: string) => {
    setDirty(true);
    setPermissions((prev) => {
      const idx = prev.findIndex((p) => p.page === pageKey);
      const current = idx >= 0 ? [...prev[idx].actions] : [];
      const newActions = current.includes(action) ? current.filter((a) => a !== action) : [...current, action];
      const newPerm: PagePermission = { page: pageKey, actions: newActions };
      if (idx >= 0) { const copy = [...prev]; copy[idx] = newPerm; return copy; }
      return [...prev, newPerm];
    });
  };

  const toggleAllForPage = (pageKey: string, availableActions: string[]) => {
    setDirty(true);
    setPermissions((prev) => {
      const idx = prev.findIndex((p) => p.page === pageKey);
      const current = idx >= 0 ? prev[idx].actions : [];
      const allChecked = availableActions.every((a) => current.includes(a));
      const newPerm: PagePermission = { page: pageKey, actions: allChecked ? [] : [...availableActions] };
      if (idx >= 0) { const copy = [...prev]; copy[idx] = newPerm; return copy; }
      return [...prev, newPerm];
    });
  };

  const toggleGroup = (groupPages: PageDef[]) => {
    setDirty(true);
    const allFullyChecked = groupPages.every((p) => p.actions.every((a) => isChecked(p.key, a)));
    setPermissions((prev) => {
      const keys = new Set(groupPages.map((p) => p.key));
      const filtered = prev.filter((p) => !keys.has(p.page));
      if (allFullyChecked) return filtered;
      const newPerms: PagePermission[] = groupPages.map((p) => ({ page: p.key, actions: [...p.actions] }));
      return [...filtered, ...newPerms];
    });
  };

  const applyPreset = (presetKey: string) => {
    const preset = ROLE_PRESETS[presetKey];
    if (!preset) return;
    setDirty(true);
    const targetPages = preset.pages.length > 0 ? preset.pages : pageDefs.map((p) => p.key);
    const newPerms: PagePermission[] = targetPages
      .map((pageKey) => {
        const pageDef = pageDefs.find((p) => p.key === pageKey);
        if (!pageDef) return null;
        const allowedActions = preset.actions.filter((a) => pageDef.actions.includes(a));
        return { page: pageKey, actions: allowedActions };
      })
      .filter((p): p is PagePermission => !!p);
    setPermissions(newPerms);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (subject === "user") {
        if (!selectedUserId) return;
        await saveUserPermissions(selectedUserId, permissions);
      } else {
        if (!selectedRoleId) return;
        await saveRolePermissions(selectedRoleId, permissions);
      }
      setDirty(false);
    } catch (e: any) {
      Alert.alert("Save failed", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(
    () => ({
      pagesGranted: permissions.filter((p) => p.actions.length > 0).length,
      total: pageDefs.length,
      actionsGranted: permissions.reduce((acc, p) => acc + p.actions.length, 0),
    }),
    [permissions, pageDefs],
  );

  const userOptions: PickerOption[] = users.map((u) => ({ key: String(u.id), label: u.name, sublabel: u.role.replace(/_/g, " ") }));
  const roleOptions: PickerOption[] = roles.map((r) => ({ key: String(r.RId), label: r.RName }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, marginBottom: 3 }}>Menu Rights</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11.5, marginBottom: 14 }}>
          Configure per-user page and action permissions.
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
              Sets the baseline every user with this role inherits, effective immediately.
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
            <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>Loading page definitions…</Text>
          </View>
        )}

        {!hasSubjectSelected ? (
          <View style={{ alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, paddingVertical: 48 }}>
            <ShieldCheck size={36} color={`${colors.mutedForeground}33`} />
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium, marginTop: 12, textAlign: "center", paddingHorizontal: 30 }}>
              {subject === "user" ? "Select a user to manage permissions" : "Select a role to manage its baseline permissions"}
            </Text>
          </View>
        ) : loadingPerms ? (
          <View style={{ alignItems: "center", paddingVertical: 48 }}>
            <ActivityIndicator color={colors.mutedForeground} />
          </View>
        ) : (
          <>
            {/* Presets */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginBottom: 12 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.medium, alignSelf: "center", marginRight: 8 }}>Presets:</Text>
              {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
                <Pressable
                  key={key}
                  onPress={() => applyPreset(key)}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted, marginRight: 6 }}
                >
                  <Text style={{ color: colors.foreground, fontSize: 10.5, fontFamily: fonts.body.medium }}>{preset.label}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Module filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginBottom: 10 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
              {modules.map((mod) => {
                const active = moduleFilter === mod;
                const accent = mod === "All" ? colors.primary : (MODULE_COLORS[mod] ?? colors.mutedForeground);
                return (
                  <Pressable
                    key={mod}
                    onPress={() => setModuleFilter(mod)}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: active ? accent : colors.border, backgroundColor: active ? accent : "transparent", marginRight: 6 }}
                  >
                    <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.medium }}>{mod}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Search */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 12 }}>
              <Search size={13} color={colors.mutedForeground} />
              <TextInput
                value={pageSearch}
                onChangeText={setPageSearch}
                placeholder="Search page…"
                placeholderTextColor={`${colors.mutedForeground}99`}
                style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 9 }}
              />
            </View>

            {/* Stats + Save */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", flex: 1 }}>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: `${colors.primary}1a` }}>
                  <Text style={{ color: colors.primary, fontSize: 10, fontFamily: fonts.heading.semibold }}>{stats.pagesGranted}/{stats.total} pages</Text>
                </View>
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.muted }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold }}>{stats.actionsGranted} actions</Text>
                </View>
                {dirty && (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#f59e0b1a", borderWidth: 1, borderColor: "#f59e0b40" }}>
                    <Text style={{ color: "#f59e0b", fontSize: 10, fontFamily: fonts.heading.semibold }}>Unsaved</Text>
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

            {/* Groups */}
            {Object.entries(groupedPages).map(([group, pages]) => {
              const groupModule = pages[0]?.module ?? "General";
              const accent = MODULE_COLORS[groupModule] ?? colors.mutedForeground;
              const allGroupChecked = pages.every((p) => p.actions.every((a) => isChecked(p.key, a)));

              return (
                <View key={group} style={{ marginBottom: 14 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: `${accent}1a` }}>
                        <Text style={{ color: accent, fontSize: 9, fontFamily: fonts.heading.bold }}>{groupModule}</Text>
                      </View>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4, flexShrink: 1 }}>{group}</Text>
                    </View>
                    <Pressable
                      onPress={() => toggleGroup(pages)}
                      style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: allGroupChecked ? `${colors.primary}1a` : colors.muted, borderWidth: 1, borderColor: allGroupChecked ? `${colors.primary}40` : colors.border }}
                    >
                      <Text style={{ color: allGroupChecked ? colors.primary : colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{allGroupChecked ? "Revoke all" : "Grant all"}</Text>
                    </Pressable>
                  </View>

                  {pages.map((page) => {
                    const checkedCount = page.actions.filter((a) => isChecked(page.key, a)).length;
                    const allChecked = checkedCount === page.actions.length && page.actions.length > 0;
                    return (
                      <View key={page.key} style={{ borderRadius: 14, padding: 12, marginBottom: 8, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, flex: 1, marginRight: 8 }}>{page.label}</Text>
                          <Switch
                            value={allChecked}
                            onValueChange={() => toggleAllForPage(page.key, page.actions)}
                            trackColor={{ false: colors.muted, true: `${colors.primary}80` }}
                            thumbColor={allChecked ? colors.primary : "#f4f3f4"}
                          />
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                          {ALL_ACTIONS.map((action) => (
                            <ActionChip
                              key={action.key}
                              label={action.label}
                              available={page.actions.includes(action.key)}
                              checked={isChecked(page.key, action.key)}
                              onPress={() => togglePermission(page.key, action.key)}
                            />
                          ))}
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}

            {Object.keys(groupedPages).length === 0 && (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 32 }}>No pages match your filters.</Text>
            )}
          </>
        )}
      </ScrollView>

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
