// RN port of src/pages/admin/WidgetsRights.tsx (web), on the drawing sheet as the web draws it: the title block with
// Save changes (once someone is chosen); the subject box — "Choose a role" / "Choose a person" with ink segments for
// Role-wise and Custom user-wise, the picker, and "Configuring X — n of m widgets enabled"; then the widget box: search,
// category keys, Enable all / Disable all, the widgets two to a row as ruled tiles (ink border and a filled check when
// on, dashed when off), and the footer with the count and one small square per widget.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Alert } from "react-native";
import { AlertCircle, Check, Save, ToggleLeft, ToggleRight } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import { getRolesList } from "@/api/postApprovalRightsApi";
import {
  getWidgetCatalog, fetchWidgetRightsUsers, fetchUserWidgets, saveUserWidgets,
  fetchRoleWidgets, saveRoleWidgets, type WidgetCatalogItem, type WidgetRightsUser,
} from "@/api/widgetRightsApi";
import { WIDGET_ICONS, DEFAULT_WIDGET_ICON } from "./widgetRightsConfig";
import { Body, Key, Label, Notice, Press, SearchBox, Seg, SheetShell, Skel } from "@/components/sheet/Sheet";
import { KeyRow, SheetPage } from "@/components/sheet/Register";

type Subject = "user" | "role";
type SaveStatus = "idle" | "saving" | "saved" | "error";

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
    fetchWidgetRightsUsers().then(setUsers).catch(() => Alert.alert("Could not load", "The users could not be loaded.")).finally(() => setUsersLoading(false));
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

  const subjectName = subject === "user" ? selectedUser?.name : selectedRole?.RName;

  const saveKey = hasSubjectSelected ? (
    <Key
      tone={saveStatus === "error" ? "red" : saveStatus === "saved" ? "line" : "ink"}
      label={saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Failed" : "Save changes"}
      icon={
        saveStatus === "saved" ? <Check size={13} color={S.ink} /> : saveStatus === "error" ? <AlertCircle size={13} color="#ffffff" /> : <Save size={13} color={S.paper} />
      }
      onPress={handleSave}
      disabled={saveStatus === "saving"}
      style={{ alignSelf: "flex-start" }}
    />
  ) : undefined;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage>
        <SheetShell
          eyebrow="CivilierERP · Admin · Rights"
          title="Widget rights"
          subtitle="Which dashboard widgets a role or a person can use. Changes take effect on next login."
          action={saveKey}
        >
          {/* Whose widgets: a role's baseline, or one person's own. */}
          <View style={{ borderWidth: 1, borderColor: S.ink }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
              <Label color={S.ink}>{subject === "user" ? "Choose a person" : "Choose a role"}</Label>
              <Seg
                options={[
                  { value: "role", label: "Role-wise" },
                  { value: "user", label: "Custom user-wise" },
                ]}
                value={subject}
                onChange={switchSubject}
              />
            </View>
            <View style={{ padding: 12, gap: 10 }}>
              {subject === "role" && (
                <Body size={12} color={S.graphite}>
                  Sets the baseline every user with this role sees, effective at once — a person's own widgets (Custom user-wise) fully replace it for them.
                </Body>
              )}
              {subject === "user" ? (
                <PickerRow
                  label="Person"
                  value={usersLoading ? "" : selectedUser?.name ?? ""}
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
                <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                  {"Configuring "}
                  <Text style={{ fontFamily: fonts.body.semibold, color: S.ink }}>{subjectName}</Text>
                  {" — "}
                  <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{enabledCount}</Text>
                  {` of ${catalog.length} widgets enabled`}
                </Text>
              )}
            </View>
          </View>

          {hasSubjectSelected ? (
            <View style={{ borderWidth: 1, borderColor: S.ink }}>
              {/* Search, categories and the bulk keys. */}
              <View style={{ padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: S.ink }}>
                <SearchBox value={widgetSearch} onChange={setWidgetSearch} placeholder="Search widgets…" />
                <KeyRow options={categories.map((c) => ({ value: c, label: c }))} value={categoryFilter} onChange={setCategoryFilter} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Key label="Enable all" icon={<ToggleRight size={13} color={S.ink} />} onPress={selectAll} style={{ flex: 1, minHeight: 36 }} />
                  <Key label="Disable all" icon={<ToggleLeft size={13} color={S.ink} />} onPress={clearAll} style={{ flex: 1, minHeight: 36, borderColor: S.line40 }} />
                </View>
              </View>

              {catalogError ? (
                <View style={{ padding: 12 }}>
                  <Notice>{catalogError}</Notice>
                </View>
              ) : catalogLoading || widgetsLoading ? (
                <View style={{ padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <View key={i} style={{ width: "48.5%" }}>
                      <Skel h={88} />
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ padding: 12, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 }}>
                  {visibleWidgets.map((widget) => {
                    const Icon = WIDGET_ICONS[widget.iconKey] || DEFAULT_WIDGET_ICON;
                    const enabled = allowed.has(widget.key);
                    return (
                      <Press
                        key={widget.key}
                        onPress={() => toggleWidget(widget.key)}
                        style={(pressed) => ({
                          width: "48.5%",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 10,
                          paddingTop: 14,
                          paddingBottom: 12,
                          borderWidth: 1,
                          borderStyle: enabled ? "solid" : "dashed",
                          borderColor: enabled ? S.ink : S.line40,
                          backgroundColor: pressed ? S.blueWash : S.paper,
                        })}
                      >
                        <View style={{ position: "absolute", top: 6, right: 6, width: 16, height: 16, borderWidth: 1, borderColor: enabled ? S.ink : S.line40, backgroundColor: enabled ? S.ink : S.paper, alignItems: "center", justifyContent: "center" }}>
                          {enabled && <Check size={10} color={S.paper} />}
                        </View>
                        <Icon size={18} color={enabled ? S.ink : S.graphite} />
                        <Text numberOfLines={2} style={{ fontFamily: fonts.heading.semibold, fontSize: 11.5, lineHeight: 14, textAlign: "center", color: enabled ? S.ink : S.graphite }}>{widget.label}</Text>
                        <Label style={{ textAlign: "center" }}>{widget.category}</Label>
                      </Press>
                    );
                  })}
                  {visibleWidgets.length === 0 && (
                    <Body size={13} color={S.graphite} style={{ width: "100%", textAlign: "center", paddingVertical: 24 }}>No widgets match your search.</Body>
                  )}
                </View>
              )}

              {/* Footer: the count, and one square per widget. */}
              <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderTopWidth: 1, borderTopColor: S.ink }}>
                <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                  <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{enabledCount}</Text>
                  {" widgets enabled for "}
                  <Text style={{ fontFamily: fonts.body.semibold, color: S.ink }}>{subjectName}</Text>
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                  {catalog.map((w) => (
                    <View key={w.key} style={{ width: 8, height: 8, borderWidth: 1, borderColor: allowed.has(w.key) ? S.ink : S.line40, backgroundColor: allowed.has(w.key) ? S.ink : "transparent" }} />
                  ))}
                </View>
              </View>
            </View>
          ) : (
            !usersLoading && (
              <View style={{ alignItems: "center", gap: 6, padding: 20, borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
                <Text style={{ fontFamily: fonts.heading.bold, fontSize: 15, color: S.ink, textAlign: "center" }}>
                  {subject === "user" ? "Select a user to configure their widgets" : "Select a role to configure its baseline widgets"}
                </Text>
                <Body size={12} color={S.graphite} style={{ textAlign: "center" }}>
                  {subject === "user"
                    ? "Choose a user above to enable or disable their access to individual dashboard widgets."
                    : "Choose a role above to set the baseline widgets every user with that role sees."}
                </Body>
              </View>
            )
          )}
        </SheetShell>
      </SheetPage>

      <OptionPickerModal
        visible={userPickerOpen}
        title="Choose a person"
        options={userOptions}
        selectedKey={selectedUser ? String(selectedUser.id) : null}
        searchable
        onSelect={(k) => { setSelectedUser(users.find((u) => String(u.id) === k) ?? null); setUserPickerOpen(false); }}
        onClose={() => setUserPickerOpen(false)}
      />
      <OptionPickerModal
        visible={rolePickerOpen}
        title="Choose a role"
        options={roleOptions}
        selectedKey={selectedRoleId != null ? String(selectedRoleId) : null}
        searchable
        onSelect={(k) => { setSelectedRoleId(k ? Number(k) : null); setRolePickerOpen(false); }}
        onClose={() => setRolePickerOpen(false)}
      />
    </View>
  );
}
