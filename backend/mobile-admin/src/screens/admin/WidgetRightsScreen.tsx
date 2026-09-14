// RN port of src/pages/admin/WidgetsRights.tsx (web) — same subject modes,
// same widget catalog grid (toggle tiles instead of web's hover-card grid),
// same category filter + search + enable-all/disable-all bulk actions.
import { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from "react-native";
import { Search, Save, Users, Check, Puzzle, ToggleLeft, ToggleRight, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import { getRolesList } from "@/api/postApprovalRightsApi";
import {
  getWidgetCatalog, fetchWidgetRightsUsers, fetchUserWidgets, saveUserWidgets,
  fetchRoleWidgets, saveRoleWidgets, type WidgetCatalogItem, type WidgetRightsUser,
} from "@/api/widgetRightsApi";
import { WIDGET_ICONS, DEFAULT_WIDGET_ICON, CATEGORY_COLORS } from "./widgetRightsConfig";

type Subject = "user" | "role";
type SaveStatus = "idle" | "saving" | "saved" | "error";

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

export default function WidgetRightsScreen() {
  const [subject, setSubject] = useState<Subject>("user");

  const [users, setUsers] = useState<WidgetRightsUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<WidgetRightsUser | null>(null);
  const [userPickerOpen, setUserPickerOpen] = useState(false);

  const [roles, setRoles] = useState<{ RId: number; RName: string }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);

  const [catalog, setCatalog] = useState<WidgetCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [widgetsLoading, setWidgetsLoading] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState("All");
  const [widgetSearch, setWidgetSearch] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const selectedRole = roles.find((r) => r.RId === selectedRoleId);
  const hasSubjectSelected = subject === "user" ? !!selectedUser : !!selectedRole;

  const switchSubject = (next: Subject) => {
    setSubject(next);
    setSelectedUser(null);
    setSelectedRoleId(null);
    setAllowed(new Set());
    setSaveStatus("idle");
  };

  useEffect(() => {
    fetchWidgetRightsUsers().then(setUsers).catch(() => Alert.alert("Error", "Failed to load users")).finally(() => setUsersLoading(false));
  }, []);
  useEffect(() => {
    getRolesList().then(setRoles).catch(() => {}).finally(() => setRolesLoading(false));
  }, []);
  useEffect(() => {
    getWidgetCatalog().then(setCatalog).catch((e) => setCatalogError(e.message)).finally(() => setCatalogLoading(false));
  }, []);

  useEffect(() => {
    if (subject !== "user" || !selectedUser) return;
    setWidgetsLoading(true);
    setSaveStatus("idle");
    fetchUserWidgets(selectedUser.id).then((w) => setAllowed(new Set(w))).catch(() => setAllowed(new Set())).finally(() => setWidgetsLoading(false));
  }, [subject, selectedUser]);

  useEffect(() => {
    if (subject !== "role" || !selectedRoleId) return;
    setWidgetsLoading(true);
    setSaveStatus("idle");
    fetchRoleWidgets(selectedRoleId).then((w) => setAllowed(new Set(w))).catch(() => setAllowed(new Set())).finally(() => setWidgetsLoading(false));
  }, [subject, selectedRoleId]);

  const toggleWidget = (key: string) => {
    setAllowed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
    setSaveStatus("idle");
  };

  const selectAll = () => { setAllowed(new Set(catalog.map((w) => w.key))); setSaveStatus("idle"); };
  const clearAll = () => { setAllowed(new Set()); setSaveStatus("idle"); };

  const handleSave = async () => {
    setSaveStatus("saving");
    try {
      if (subject === "user") {
        if (!selectedUser) return;
        await saveUserWidgets(selectedUser.id, Array.from(allowed));
      } else {
        if (!selectedRoleId) return;
        await saveRoleWidgets(selectedRoleId, Array.from(allowed));
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  const categories = useMemo(() => ["All", ...Array.from(new Set(catalog.map((w) => w.category)))], [catalog]);
  const visibleWidgets = useMemo(
    () => catalog.filter((w) => {
      const matchCat = categoryFilter === "All" || w.category === categoryFilter;
      const matchSearch = !widgetSearch || w.key.toLowerCase().includes(widgetSearch.toLowerCase()) || w.description.toLowerCase().includes(widgetSearch.toLowerCase());
      return matchCat && matchSearch;
    }),
    [catalog, categoryFilter, widgetSearch],
  );

  const enabledCount = allowed.size;

  const userOptions: PickerOption[] = users.map((u) => ({ key: String(u.id), label: u.name, sublabel: u.email }));
  const roleOptions: PickerOption[] = roles.map((r) => ({ key: String(r.RId), label: r.RName }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, marginBottom: 3 }}>Widgets Rights</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11.5, marginBottom: 14 }}>
          Control which dashboard widgets each user can access. Changes take effect on next login.
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
              Sets the baseline every user with this role sees — a user's own overrides fully replace this for them.
            </Text>
          )}
          {subject === "user" ? (
            <PickerRow
              label="User"
              value={usersLoading ? "" : selectedUser ? `${selectedUser.name}` : ""}
              sublabel={selectedUser?.email}
              placeholder={usersLoading ? "Loading users…" : "Choose a user to configure…"}
              onPress={() => setUserPickerOpen(true)}
            />
          ) : (
            <PickerRow
              label="Role"
              value={rolesLoading ? "" : selectedRole?.RName ?? ""}
              placeholder={rolesLoading ? "Loading roles…" : "Choose a role to configure…"}
              onPress={() => setRolePickerOpen(true)}
            />
          )}

          {hasSubjectSelected && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>
                <Text style={{ color: colors.foreground, fontFamily: fonts.heading.semibold }}>{enabledCount}</Text> of {catalog.length} widgets enabled
              </Text>
            </View>
          )}
        </View>

        {hasSubjectSelected && (
          <>
            <Pressable
              onPress={handleSave}
              disabled={saveStatus === "saving"}
              style={{
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 12, marginBottom: 14,
                backgroundColor: saveStatus === "saved" ? "#10b981" : saveStatus === "error" ? colors.destructive : colors.primary,
                opacity: saveStatus === "saving" ? 0.6 : 1,
              }}
            >
              {saveStatus === "saving" ? <ActivityIndicator size="small" color="#fff" /> : saveStatus === "saved" ? <Check size={14} color="#fff" /> : saveStatus === "error" ? <AlertCircle size={14} color="#fff" /> : <Save size={14} color="#fff" />}
              <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>
                {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Failed" : "Save Changes"}
              </Text>
            </Pressable>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 10 }}>
              <Search size={13} color={colors.mutedForeground} />
              <TextInput
                value={widgetSearch}
                onChangeText={setWidgetSearch}
                placeholder="Search widgets…"
                placeholderTextColor={`${colors.mutedForeground}99`}
                style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 9 }}
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16, marginBottom: 10 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
              {categories.map((cat) => {
                const active = categoryFilter === cat;
                const accent = cat === "All" ? colors.primary : (CATEGORY_COLORS[cat] ?? colors.mutedForeground);
                return (
                  <Pressable
                    key={cat}
                    onPress={() => setCategoryFilter(cat)}
                    style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: active ? accent : colors.border, backgroundColor: active ? accent : "transparent", marginRight: 6 }}
                  >
                    <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.medium }}>{cat}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
              <Pressable onPress={selectAll} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <ToggleRight size={13} color="#10b981" />
                <Text style={{ color: "#10b981", fontSize: 11, fontFamily: fonts.body.medium }}>Enable all</Text>
              </Pressable>
              <Pressable onPress={clearAll} style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 }}>
                <ToggleLeft size={13} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium }}>Disable all</Text>
              </Pressable>
            </View>

            {catalogError ? (
              <Text style={{ color: colors.destructive, fontSize: 12, textAlign: "center", paddingVertical: 24 }}>{catalogError}</Text>
            ) : catalogLoading || widgetsLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 32 }}>
                <ActivityIndicator color={colors.mutedForeground} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {visibleWidgets.map((widget) => {
                  const Icon = WIDGET_ICONS[widget.iconKey] || DEFAULT_WIDGET_ICON;
                  const enabled = allowed.has(widget.key);
                  return (
                    <Pressable
                      key={widget.key}
                      onPress={() => toggleWidget(widget.key)}
                      style={{
                        width: "31%", minWidth: 96, alignItems: "center", gap: 6, padding: 12, borderRadius: 14,
                        borderWidth: 1, borderColor: enabled ? `${colors.primary}80` : colors.border,
                        backgroundColor: enabled ? `${colors.primary}0d` : `${colors.card}4d`, opacity: enabled ? 1 : 0.65,
                      }}
                    >
                      <View style={{ position: "absolute", top: 6, right: 6, width: 15, height: 15, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: enabled ? colors.primary : `${colors.muted}99`, borderWidth: enabled ? 0 : 1, borderColor: colors.border }}>
                        {enabled && <Check size={9} color="#fff" />}
                      </View>
                      <View style={{ padding: 8, borderRadius: 10, backgroundColor: enabled ? `${colors.primary}26` : colors.muted }}>
                        <Icon size={16} color={enabled ? colors.primary : colors.mutedForeground} />
                      </View>
                      <Text numberOfLines={2} style={{ color: enabled ? colors.foreground : colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold, textAlign: "center", lineHeight: 12.5 }}>
                        {widget.label}
                      </Text>
                    </Pressable>
                  );
                })}
                {visibleWidgets.length === 0 && (
                  <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 24, width: "100%" }}>No widgets match your search.</Text>
                )}
              </View>
            )}
          </>
        )}

        {!hasSubjectSelected && !usersLoading && (
          <View style={{ alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, paddingVertical: 48 }}>
            <Puzzle size={32} color={colors.mutedForeground} />
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold, marginTop: 14, textAlign: "center", paddingHorizontal: 20 }}>
              {subject === "user" ? "Select a user to configure their widgets" : "Select a role to configure its baseline widgets"}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 4, textAlign: "center", paddingHorizontal: 30 }}>
              {subject === "user"
                ? "Choose a user above to enable or disable their access to individual dashboard widgets."
                : "Choose a role above to set the baseline widgets every user with that role sees."}
            </Text>
          </View>
        )}
      </ScrollView>

      <OptionPickerModal
        visible={userPickerOpen}
        title="Select User"
        options={userOptions}
        selectedKey={selectedUser ? String(selectedUser.id) : null}
        searchable
        onSelect={(k) => { setSelectedUser(users.find((u) => String(u.id) === k) ?? null); setUserPickerOpen(false); }}
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
