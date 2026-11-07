// RN port of src/pages/admin/PostApprovalRights.tsx (web), on the drawing sheet as the web draws it: the title block;
// the subject box — "Choose a role" / "Choose a person" with ink segments for Role-wise and Custom user-wise (a role's
// baseline, which every holder inherits at once, or one person's additions on top of it) and the picker; then, for the
// chosen role or person, how many of the eligible pages are granted, an Unsaved mark, Save, and one ruled row per page
// that enforces a post-approval check (page, module, a square switch for "allow editing after approved"). Only pages
// whose edit guard actually checks this right are listed — granting it elsewhere would do nothing.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Alert } from "react-native";
import { Save } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import {
  fetchPageDefinitions, getUsersForRights, getUserPermissions, saveUserPermissions,
  getRolesList, getRolePermissions, saveRolePermissions,
  POST_APPROVAL_ACTION, type PageDef, type PagePermission,
} from "@/api/postApprovalRightsApi";
import { Body, Key, Label, Notice, Seg, SheetShell, Skel } from "@/components/sheet/Sheet";
import { SheetPage } from "@/components/sheet/Register";
import { SquareSwitch } from "./ApprovalSetupScreen";

type Subject = "user" | "role";

export default function PostApprovalRightsScreen() {
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
      .catch(() => Alert.alert("Could not load", "The page list could not be loaded."))
      .finally(() => setLoadingDefs(false));
  }, []);

  useEffect(() => {
    getUsersForRights()
      .then(setUsers)
      .catch(() => Alert.alert("Could not load", "The users could not be loaded."))
      .finally(() => setLoadingUsers(false));
  }, []);

  useEffect(() => {
    getRolesList()
      .then(setRoles)
      .catch(() => Alert.alert("Could not load", "The roles could not be loaded."))
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
      .catch(() => { Alert.alert("Could not load", "This person's rights could not be loaded."); setPermissions([]); })
      .finally(() => setLoadingPerms(false));
  }, [subject, selectedUserId]);

  useEffect(() => {
    if (subject !== "role" || !selectedRoleId) return;
    setLoadingPerms(true);
    setDirty(false);
    getRolePermissions(selectedRoleId)
      .then(setPermissions)
      .catch(() => { Alert.alert("Could not load", "This role's rights could not be loaded."); setPermissions([]); })
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
      Alert.alert("Could not save", e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

  const grantedCount = eligiblePages.filter((p) => isGranted(p.key)).length;

  const userOptions: PickerOption[] = users.map((u) => ({ key: String(u.id), label: u.name, sublabel: u.role.replace(/_/g, " ") }));
  const roleOptions: PickerOption[] = roles.map((r) => ({ key: String(r.RId), label: r.RName }));

  const subjectName = subject === "user" ? selectedUser?.name : selectedRole?.RName;

  return (
    <View style={{ flex: 1 }}>
      <SheetPage>
        <SheetShell
          eyebrow="CivilierERP · Approvals"
          title="Post-approval rights"
          subtitle="Who may still edit a record after it has been approved, page by page. Set it for a role, or add to it for one person."
        >
          {/* Whose rights: a role's baseline, or one person's additions. */}
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
                  Sets the baseline every user with this role inherits, effective at once — a person's own additions (Custom user-wise) can only add on top of it.
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

          {loadingDefs && <Label>Loading eligible pages…</Label>}

          {!hasSubjectSelected ? (
            <View style={{ minHeight: 120, alignItems: "center", justifyContent: "center", padding: 16, borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
              <Body size={13} color={S.graphite} style={{ textAlign: "center" }}>
                {subject === "user" ? "Choose a person to manage their post-approval rights." : "Choose a role to manage its post-approval baseline."}
              </Body>
            </View>
          ) : loadingPerms ? (
            <View style={{ gap: 8 }}>
              <Skel h={40} />
              <Skel h={160} />
            </View>
          ) : (
            <View style={{ borderWidth: 1, borderColor: S.ink }}>
              <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink, gap: 10 }}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
                  <Label color={S.ink}>{subjectName ?? ""}</Label>
                  <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>
                    <Text style={{ fontFamily: fonts.heading.semibold, color: S.ink }}>{grantedCount}</Text>
                    {` of ${eligiblePages.length} pages granted`}
                  </Text>
                  {dirty && (
                    <View style={{ borderWidth: 1, borderStyle: "dashed", borderColor: S.ink, paddingHorizontal: 6, paddingVertical: 1 }}>
                      <Label color={S.ink}>Unsaved</Label>
                    </View>
                  )}
                </View>
                <Key tone="ink" label={saving ? "Saving…" : "Save"} icon={<Save size={13} color={S.paper} />} onPress={handleSave} disabled={saving || !dirty} style={{ alignSelf: "flex-start" }} />
              </View>

              {eligiblePages.length === 0 ? (
                <Body size={13} color={S.graphite} style={{ textAlign: "center", paddingVertical: 24 }}>No pages currently support post-approval editing.</Body>
              ) : (
                <View>
                  <View style={{ flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: S.line15 }}>
                    <Label style={{ flex: 1 }}>Page · module</Label>
                    <Label>Edit after approved</Label>
                  </View>
                  {eligiblePages.map((page, i) => {
                    const checked = isGranted(page.key);
                    return (
                      <View key={page.key} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                          <Text numberOfLines={2} style={{ fontFamily: checked ? fonts.body.semibold : fonts.body.medium, fontSize: 13, color: S.ink }}>{page.label}</Text>
                          <View style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: S.line40, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 0.9, textTransform: "uppercase", color: S.graphite }}>{page.module}</Text>
                          </View>
                        </View>
                        <SquareSwitch on={checked} onChange={() => toggle(page.key)} />
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
          {!loadingDefs && pageDefs.length === 0 && <Notice>The page list came back empty. Reopen this page to try again.</Notice>}
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
