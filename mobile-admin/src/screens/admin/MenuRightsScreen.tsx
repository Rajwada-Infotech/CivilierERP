// RN port of src/pages/admin/MenuRights.tsx (web), on the drawing sheet as the web draws it: the title block; the
// subject box — "Choose a role" / "Choose a person" with ink segments for Role-wise and Custom user-wise and the picker;
// then, once someone is chosen, the presets, and the rights box: who (name and role tag), how many pages and actions are
// granted, an Unsaved mark, the page search and module keys, the pages by group (module tag, group, Grant all / Revoke
// all) — each page a ruled row with an "every action" square and its actions as small square checks (a dash where the
// page doesn't offer one) — and the footer with Save permissions. The web's seven-column table becomes the wrapped row of
// checks, so no column has to scroll sideways on a phone.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Alert } from "react-native";
import { Check, ChevronRight, Save } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import { ALL_ACTIONS, ROLE_PRESETS } from "./menuRightsConfig";
import {
  fetchPageDefinitions, getUsersForRights, getUserPermissions, saveUserPermissions,
  getRolesList, getRolePermissions, saveRolePermissions,
  type PageDef, type PagePermission,
} from "@/api/postApprovalRightsApi";
import { Body, Key, Label, Press, SearchBox, Seg, SheetShell, Skel } from "@/components/sheet/Sheet";
import { KeyRow, SheetPage } from "@/components/sheet/Register";

type Subject = "user" | "role";

/** A small square check: filled ink when on, a dash in the middle for "some" (the page's every-action square). */
export function CheckSquare({ checked, mixed, onPress, size = 22 }: { checked: boolean; mixed?: boolean; onPress: () => void; size?: number }) {
  return (
    <Press
      onPress={onPress}
      hitSlop={6}
      style={() => ({ width: size, height: size, borderWidth: 1, borderColor: checked || mixed ? S.ink : S.line40, backgroundColor: checked ? S.ink : S.paper, alignItems: "center", justifyContent: "center" })}
    >
      {checked ? <Check size={size * 0.6} color={S.paper} /> : mixed ? <View style={{ width: size * 0.4, height: 2, backgroundColor: S.ink }} /> : null}
    </Press>
  );
}

/** One action on a page: its check and its name; an action the page doesn't offer shows a faint dash instead. */
function ActionCheck({ label, available, checked, onPress }: { label: string; available: boolean; checked: boolean; onPress: () => void }) {
  if (!available) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5, opacity: 0.45 }}>
        <View style={{ width: 18, height: 18, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 8, height: 1, backgroundColor: S.graphite }} />
        </View>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9.5, letterSpacing: 0.9, textTransform: "uppercase", color: S.graphite }}>{label}</Text>
      </View>
    );
  }
  return (
    <Press onPress={onPress} hitSlop={4} style={() => ({ flexDirection: "row", alignItems: "center", gap: 5 })}>
      <View style={{ width: 18, height: 18, borderWidth: 1, borderColor: checked ? S.ink : S.line40, backgroundColor: checked ? S.ink : S.paper, alignItems: "center", justifyContent: "center" }}>
        {checked && <Check size={11} color={S.paper} />}
      </View>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9.5, letterSpacing: 0.9, textTransform: "uppercase", color: S.ink }}>{label}</Text>
    </Press>
  );
}

/** A module's tag: capitals in a faint ruled box. */
export function ModuleTag({ children }: { children: string }) {
  return (
    <View style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: S.line40, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 0.9, textTransform: "uppercase", color: S.graphite }}>{children}</Text>
    </View>
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
  // Groups start folded: every page with its seven checks drawn at once took long enough to stall the phone.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const toggleOpen = (g: string) => setOpenGroups((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });

  useEffect(() => {
    fetchPageDefinitions().then(setPageDefs).catch(() => Alert.alert("Could not load", "The page list could not be loaded.")).finally(() => setLoadingDefs(false));
  }, []);
  useEffect(() => {
    getUsersForRights().then(setUsers).catch(() => Alert.alert("Could not load", "The users could not be loaded.")).finally(() => setLoadingUsers(false));
  }, []);
  useEffect(() => {
    getRolesList().then(setRoles).catch(() => Alert.alert("Could not load", "The roles could not be loaded.")).finally(() => setLoadingRoles(false));
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
    getUserPermissions(selectedUserId).then(setPermissions).catch(() => { Alert.alert("Could not load", "This person's rights could not be loaded."); setPermissions([]); }).finally(() => setLoadingPerms(false));
  }, [subject, selectedUserId]);

  useEffect(() => {
    if (subject !== "role" || !selectedRoleId) return;
    setLoadingPerms(true);
    setDirty(false);
    getRolePermissions(selectedRoleId).then(setPermissions).catch(() => { Alert.alert("Could not load", "This role's rights could not be loaded."); setPermissions([]); }).finally(() => setLoadingPerms(false));
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
      Alert.alert("Could not save", e.message || "Something went wrong.");
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

  const subjectName = subject === "user" ? selectedUser?.name : selectedRole?.RName;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage>
        <SheetShell
          eyebrow="CivilierERP · Admin · Rights"
          title="Menu rights"
          subtitle="Which pages a role or a person can open, and what they may do on each of them."
        >
          {/* Whose rights: a role's baseline, or one person's own. */}
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
                  Sets the baseline every user with this role inherits, effective at once — a person's own rights (Custom user-wise) take precedence over it on any page they touch.
                </Body>
              )}
              {subject === "user" ? (
                <PickerRow
                  label="Person"
                  value={loadingUsers ? "" : selectedUser?.name ?? ""}
                  placeholder={loadingUsers ? "Loading users…" : "Choose a user…"}
                  sublabel={selectedUser?.role?.replace(/_/g, " ")}
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
          </View>

          {loadingDefs && <Label>Loading page definitions…</Label>}

          {!hasSubjectSelected ? (
            <View style={{ minHeight: 120, alignItems: "center", justifyContent: "center", padding: 16, borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
              <Body size={13} color={S.graphite} style={{ textAlign: "center" }}>
                {subject === "user" ? "Choose a person to manage their rights." : "Choose a role to manage its baseline rights."}
              </Body>
            </View>
          ) : loadingPerms ? (
            <View style={{ gap: 8 }}>
              <Skel h={40} />
              <Skel h={200} />
            </View>
          ) : (
            <>
              {/* Presets: fill the rights from a typical role, then adjust. */}
              <View style={{ gap: 8 }}>
                <Label>Presets</Label>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {Object.entries(ROLE_PRESETS).map(([key, preset]) => (
                    <Key key={key} label={preset.label} onPress={() => applyPreset(key)} style={{ minHeight: 34, paddingHorizontal: 12 }} />
                  ))}
                </View>
              </View>

              <View style={{ borderWidth: 1, borderColor: S.ink }}>
                {/* Who, the counts, search and the module keys. */}
                <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink, gap: 10 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <Label color={S.ink}>{subjectName ?? ""}</Label>
                    <ModuleTag>{subject === "user" ? (selectedUser?.role ?? "").replace(/_/g, " ") : "role baseline"}</ModuleTag>
                  </View>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                    <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                      <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{stats.pagesGranted}</Text>
                      {` of ${stats.total} pages`}
                    </Text>
                    <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                      <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{stats.actionsGranted}</Text>
                      {" actions"}
                    </Text>
                    {dirty && (
                      <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: S.ink, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Label color={S.ink}>Unsaved</Label>
                      </View>
                    )}
                  </View>
                  <SearchBox value={pageSearch} onChange={setPageSearch} placeholder="Search page…" />
                  <KeyRow options={modules.map((m) => ({ value: m, label: m }))} value={moduleFilter} onChange={setModuleFilter} />
                </View>

                {/* The pages, by group. */}
                {Object.entries(groupedPages).map(([group, pages]) => {
                  const groupModule = pages[0]?.module ?? "General";
                  const allGroupChecked = pages.every((p) => p.actions.every((a) => isChecked(p.key, a)));
                  const grantedInGroup = pages.filter((p) => p.actions.some((a) => isChecked(p.key, a))).length;
                  // A search opens every group it matches.
                  const open = !!pageSearch.trim() || openGroups.has(group);
                  return (
                    <View key={group}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 12, backgroundColor: S.blueWash, borderBottomWidth: 1, borderBottomColor: S.line15 }}>
                        <Press onPress={() => toggleOpen(group)} style={() => ({ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingVertical: 10 })}>
                          <ChevronRight size={13} color={S.ink} style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }} />
                          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                            <Text numberOfLines={1} style={{ fontFamily: fonts.heading.bold, fontSize: 10.5, letterSpacing: 1.1, textTransform: "uppercase", color: S.ink }}>{group}</Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <ModuleTag>{groupModule}</ModuleTag>
                              <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite }}>{`${grantedInGroup} of ${pages.length}`}</Text>
                            </View>
                          </View>
                        </Press>
                        <Key tone={allGroupChecked ? "line" : "ink"} label={allGroupChecked ? "Revoke all" : "Grant all"} onPress={() => toggleGroup(pages)} style={{ minHeight: 28, paddingHorizontal: 10 }} />
                      </View>
                      {open && pages.map((page) => {
                        const checkedCount = page.actions.filter((a) => isChecked(page.key, a)).length;
                        const allChecked = page.actions.length > 0 && checkedCount === page.actions.length;
                        return (
                          <View key={page.key} style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                              <Text numberOfLines={2} style={{ flex: 1, fontFamily: checkedCount ? fonts.body.semibold : fonts.body.medium, fontSize: 13, color: S.ink }}>{page.label}</Text>
                              <Label>All</Label>
                              <CheckSquare checked={allChecked} mixed={checkedCount > 0 && !allChecked} onPress={() => toggleAllForPage(page.key, page.actions)} />
                            </View>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 8 }}>
                              {ALL_ACTIONS.map((action) => (
                                <ActionCheck
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
                  <Body size={13} color={S.graphite} style={{ textAlign: "center", paddingVertical: 24 }}>No pages match your filters.</Body>
                )}

                {/* Footer: what is granted, and Save. */}
                <View style={{ paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderTopWidth: Object.keys(groupedPages).length ? 0 : 1, borderTopColor: S.ink }}>
                  <Body size={12} color={S.graphite}>{`${stats.pagesGranted} of ${stats.total} pages · ${stats.actionsGranted} total actions granted`}</Body>
                  <Key tone="ink" label={saving ? "Saving…" : "Save permissions"} icon={<Save size={13} color={S.paper} />} onPress={handleSave} disabled={saving || !dirty} />
                </View>
              </View>
            </>
          )}
        </SheetShell>
      </SheetPage>

      <OptionPickerModal
        visible={userPickerOpen}
        title="Choose a person"
        options={userOptions}
        selectedKey={selectedUserId != null ? String(selectedUserId) : null}
        searchable
        onSelect={(k) => { setSelectedUserId(k ? Number(k) : null); setUserPickerOpen(false); }}
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
