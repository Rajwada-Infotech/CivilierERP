// RN port of src/pages/user/UserProfile.tsx (with ProfileShell and ProfileSettings), on the drawing sheet as the web
// draws it: the title block with the photo (tap to change), name, email and role; the figures (pages, role, status);
// ink segments for the four tabs —
//   My profile  the identity card (photo with Change photo, member since, status, accessible pages), Personal
//               information (first / last name, email, role, member since; Edit changes the name) and Security
//               (password, account status; Edit opens the change-password form with the strength meter and match check)
//   My access   every page this account may open, with its actions (view / create / edit / delete / export)
//   Activity    the last 30 things this account did (time, action, module)
//   Settings    Sign-in (the reminders popup after login, kept on the account) and Animations (menus and panels,
//               pages, numbers counting up — saved on this phone only; the phone's "reduce motion" overrides them)
// and Sign out at the foot. The photo is picked from the library or taken with the camera, square, and kept under the
// server's 400 KB.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Image, ScrollView, Alert, Switch } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Bell, Camera, Image as ImageIcon, KeyRound, LayoutGrid, Lock, LogOut, Pencil, Sparkles, Trash2, User } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { useAuthImageSource } from "@/components/AuthImage";
import { PasswordStrength } from "@/components/PasswordStrength";
import { getUserProfile, updateUserProfile, changePassword, getUserActivity, uploadAvatar, removeAvatar, updateUserPreferences } from "@/api/userProfileApi";
import { Body, Field, InfoGrid, Input, Key, Label, Notice, Panel, Press, Seg, SheetMark, SheetShell, Skel, StatRow, setUiPrefs, useUiPrefs, type UiPrefs } from "@/components/sheet/Sheet";
import { SheetPicker } from "@/components/sheet/FormParts";
import { LineList, SheetPage } from "@/components/sheet/Register";

type Tab = "profile" | "access" | "activity" | "settings";
const ACTIONS = ["view", "create", "edit", "delete", "export"] as const;
const MAX_DATA_URI = 550_000; // the server's limit on the photo's data: URI (~400 KB of image)

const fmtLong = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "—";
const humanPage = (key: string) => key.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function Toggle({ title, hint, value, onChange, disabled }: { title: string; hint: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Body size={13.5} weight="medium">{title}</Body>
        <Body size={11.5} color={S.graphite}>{hint}</Body>
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} trackColor={{ true: S.ink, false: S.rule }} thumbColor={S.paper} />
    </View>
  );
}

function Avatar({ uri, initials, size }: { uri: string | null; initials: string; size: number }) {
  const source = useAuthImageSource(uri);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return (
    <View style={{ width: size, height: size, borderWidth: 1.5, borderColor: S.ink, backgroundColor: S.paper, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {source && !failed ? (
        <Image source={source} style={{ width: size, height: size }} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <Text style={{ fontFamily: fonts.heading.bold, fontSize: size * 0.32, color: S.ink }}>{initials}</Text>
      )}
    </View>
  );
}

const ANIMATIONS: { key: keyof UiPrefs; title: string; hint: string }[] = [
  { key: "menus", title: "Menus and panels", hint: "The bubble the reminders bell's panel opens and closes with." },
  { key: "pages", title: "Pages and dialogs", hint: "The rise and fade pages, cards and charts appear with." },
  { key: "counts", title: "Numbers counting up", hint: "Figures on the dashboards counting up to their value." },
];

export default function ProfileScreen() {
  const { currentUser, logout, updateCurrentUser, canDoAction } = useAuth();
  const qc = useQueryClient();
  const userId = currentUser?.id ? parseInt(currentUser.id, 10) : 0;
  const [tab, setTab] = useState<Tab>("profile");
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(currentUser?.name ?? "");
  const [editingPw, setEditingPw] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [photoOpen, setPhotoOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const prefs = useUiPrefs();

  const { data: profile, isLoading, isError, refetch } = useQuery({ queryKey: ["user-profile", userId], queryFn: () => getUserProfile(userId), enabled: !!userId });
  const activityQ = useQuery({ queryKey: ["user-activity", userId], queryFn: () => getUserActivity(userId, 30), enabled: tab === "activity" && !!userId });
  useEffect(() => {
    if (profile?.name) setNameVal(profile.name);
  }, [profile?.name]);

  const displayName = profile?.name ?? currentUser?.name ?? "User";
  const initials = displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const email = profile?.email ?? currentUser?.email ?? "";
  const roleName = profile?.roleName ?? currentUser?.role?.replace(/_/g, " ") ?? "user";
  const inactive = !!profile?.discontinue;
  const memberSince = fmtLong(profile?.created_datetime);
  const perms = currentUser?.pagePermissions ?? [];
  const pageCount = perms.length;
  const avatarUrl = profile?.avatar_url ?? null;
  const showLoginReminders = profile ? profile.ShowLoginReminders !== false && profile.ShowLoginReminders !== 0 : true;

  const afterPhoto = () => {
    qc.invalidateQueries({ queryKey: ["user-profile", userId] });
    qc.invalidateQueries({ queryKey: ["user-avatar", currentUser?.id] });
  };
  const nameMutation = useMutation({
    mutationFn: () => updateUserProfile(userId, { name: nameVal.trim() }),
    onSuccess: () => {
      updateCurrentUser({ name: nameVal.trim() });
      qc.invalidateQueries({ queryKey: ["user-profile", userId] });
      setEditingName(false);
      Alert.alert("Saved", "Your profile was updated.");
    },
    onError: (e: Error) => Alert.alert("Could not save", e.message),
  });
  const pwMutation = useMutation({
    mutationFn: () => changePassword(userId, pw.current, pw.next),
    onSuccess: () => {
      setPw({ current: "", next: "", confirm: "" });
      setEditingPw(false);
      Alert.alert("Password changed", "Use the new password the next time you sign in.");
    },
    onError: (e: Error) => Alert.alert("Could not change the password", e.message),
  });
  const uploadMutation = useMutation({
    mutationFn: (dataUri: string) => uploadAvatar(userId, dataUri),
    onSuccess: () => {
      afterPhoto();
      setPhotoOpen(false);
      setPreview(null);
    },
    onError: (e: Error) => Alert.alert("Could not upload the photo", e.message),
  });
  const removeMutation = useMutation({
    mutationFn: () => removeAvatar(userId),
    onSuccess: () => {
      afterPhoto();
      setPhotoOpen(false);
    },
    onError: (e: Error) => Alert.alert("Could not remove the photo", e.message),
  });
  const remindersMutation = useMutation({
    mutationFn: (v: boolean) => updateUserPreferences(userId, { showLoginReminders: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-profile", userId] }),
    onError: (e: Error) => Alert.alert("Could not save", e.message),
  });

  const pick = async (from: "library" | "camera") => {
    const perm = from === "camera" ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert("Permission needed", `Allow ${from === "camera" ? "the camera" : "photo access"} to change your photo.`);
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true };
    const result = from === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const a = result.assets[0];
    const mime = a.mimeType && /image\/(jpeg|png|webp|gif)/.test(a.mimeType) ? a.mimeType : "image/jpeg";
    const uri = `data:${mime};base64,${a.base64}`;
    if (uri.length > MAX_DATA_URI) return Alert.alert("Photo too large", "Choose a smaller photo, or crop it tighter. It must be under 400 KB.");
    setPreview(uri);
  };

  const pwMismatch = !!pw.next && !!pw.confirm && pw.next !== pw.confirm;
  const pwMatch = !!pw.next && !!pw.confirm && pw.next === pw.confirm;
  const pwReady = !!pw.current && pw.next.length >= 6 && pwMatch;

  const access = useMemo(
    () =>
      [...perms]
        .sort((a, b) => a.page.localeCompare(b.page))
        .map((p) => ({ page: p.page, actions: ACTIONS.filter((a) => (p.actions ?? []).map((x: string) => x.toLowerCase()).includes(a) || canDoAction(p.page as never, a as never)) })),
    [perms, canDoAction],
  );

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You'll need to sign in again to continue.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => logout() },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={false} onRefresh={() => refetch()}>
        <SheetShell eyebrow="CivilierERP · My profile" title={displayName} subtitle={email}>
          {isError && <Notice>Could not load your profile. Pull down to try again.</Notice>}

          {/* Who: the photo (tap to change), role and status */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <Press onPress={() => setPhotoOpen(true)} style={(pressed) => ({ opacity: pressed ? 0.8 : 1 })}>
              <Avatar uri={avatarUrl} initials={initials} size={64} />
              <View style={{ position: "absolute", right: -6, bottom: -6, width: 22, height: 22, backgroundColor: S.ink, alignItems: "center", justifyContent: "center" }}>
                <Camera size={12} color={S.paper} />
              </View>
            </Press>
            <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
              <View style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: S.ink, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: S.ink }}>{roleName}</Text>
              </View>
              <SheetMark text={inactive ? "Inactive" : "Active"} tone={inactive ? "stopped" : "done"} />
            </View>
          </View>

          <StatRow
            items={[
              // Four figures, so they sit two by two (an odd count gives the first a whole row to itself).
              { label: "Pages", value: String(pageCount), note: "you can open" },
              { label: "Role", value: roleName, note: "assigned" },
              { label: "Status", value: inactive ? "Inactive" : "Active", red: inactive },
              { label: "Member since", value: profile?.created_datetime ? new Date(profile.created_datetime).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "—" },
            ]}
          />

          <Seg
            options={[
              { value: "profile", label: "Profile" },
              { value: "access", label: "Access" },
              { value: "activity", label: "Activity" },
              { value: "settings", label: "Settings" },
            ]}
            value={tab}
            onChange={setTab}
          />

          {tab === "profile" &&
            (isLoading ? (
              <>
                <Skel h={120} />
                <Skel h={120} />
              </>
            ) : (
              <>
                <Panel title="Identity" icon={<User size={14} color={S.ink} />}>
                  <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
                    <Avatar uri={avatarUrl} initials={initials} size={56} />
                    <Key label="Change photo" icon={<Camera size={13} color={S.ink} />} onPress={() => setPhotoOpen(true)} />
                  </View>
                  <LineList
                    rows={[
                      { key: "since", title: "Member since", right: memberSince },
                      { key: "status", title: "Status", right: inactive ? "Inactive" : "Active", red: inactive },
                      { key: "pages", title: "Accessible pages", right: String(pageCount) },
                    ]}
                  />
                </Panel>

                <Panel title="Personal information" icon={<User size={14} color={S.ink} />}>
                  {!editingName ? (
                    <>
                      <InfoGrid
                        items={[
                          { label: "First name", value: displayName.split(" ")[0] || "—" },
                          { label: "Last name", value: displayName.split(" ").slice(1).join(" ") || "—" },
                          { label: "Email address", value: email || "—", wide: true },
                          { label: "User role", value: roleName },
                          { label: "Member since", value: memberSince },
                        ]}
                      />
                      <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => setEditingName(true)} style={{ alignSelf: "flex-start" }} />
                    </>
                  ) : (
                    <>
                      <Field label="Full name">
                        <Input value={nameVal} onChangeText={setNameVal} autoCapitalize="words" />
                      </Field>
                      <Field label="Email (read-only)">
                        <Input value={email} editable={false} style={{ opacity: 0.5 }} />
                      </Field>
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <Key label="Cancel" onPress={() => { setEditingName(false); setNameVal(displayName); }} />
                        <Key tone="ink" label={nameMutation.isPending ? "Saving…" : "Save"} onPress={() => nameMutation.mutate()} disabled={nameMutation.isPending || !nameVal.trim()} style={{ flex: 1 }} />
                      </View>
                    </>
                  )}
                </Panel>

                <Panel title="Security" icon={<Lock size={14} color={S.ink} />}>
                  {!editingPw ? (
                    <>
                      <InfoGrid
                        items={[
                          { label: "Password", value: "••••••••••" },
                          { label: "Account status", value: <SheetMark text={inactive ? "Inactive" : "Active"} tone={inactive ? "stopped" : "done"} /> },
                          { label: "Member since", value: memberSince },
                        ]}
                      />
                      <Key label="Change password" icon={<KeyRound size={13} color={S.ink} />} onPress={() => setEditingPw(true)} style={{ alignSelf: "flex-start" }} />
                    </>
                  ) : (
                    <>
                      <Field label="Current password">
                        <Input value={pw.current} onChangeText={(v) => setPw((p) => ({ ...p, current: v }))} secureTextEntry autoCapitalize="none" />
                      </Field>
                      <Field label="New password">
                        <Input value={pw.next} onChangeText={(v) => setPw((p) => ({ ...p, next: v }))} secureTextEntry autoCapitalize="none" />
                        <PasswordStrength password={pw.next} />
                      </Field>
                      <Field label="Confirm password">
                        <Input value={pw.confirm} onChangeText={(v) => setPw((p) => ({ ...p, confirm: v }))} secureTextEntry autoCapitalize="none" style={pwMismatch ? { color: S.red } : undefined} />
                      </Field>
                      {pwMismatch && <Body size={11.5} color={S.red}>Passwords do not match</Body>}
                      {pwMatch && <Body size={11.5} color={S.blue}>Passwords match</Body>}
                      {!!pw.next && pw.next.length < 6 && <Body size={11.5} color={S.graphite}>At least 6 characters.</Body>}
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <Key label="Cancel" onPress={() => { setEditingPw(false); setPw({ current: "", next: "", confirm: "" }); }} />
                        <Key tone="ink" label={pwMutation.isPending ? "Saving…" : "Update password"} onPress={() => pwMutation.mutate()} disabled={!pwReady || pwMutation.isPending} style={{ flex: 1 }} />
                      </View>
                    </>
                  )}
                </Panel>
              </>
            ))}

          {tab === "access" && (
            <Panel title={`My page access · ${pageCount}`} icon={<LayoutGrid size={14} color={S.ink} />}>
              {currentUser?.role === "super_admin" && <Body size={12} color={S.graphite}>Super admins can open every page.</Body>}
              {access.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 20, gap: 4 }}>
                  <Body size={13} weight="medium">No pages assigned yet</Body>
                  <Body size={12} color={S.graphite}>Contact your administrator to request access.</Body>
                </View>
              ) : (
                access.map((p, i) => (
                  // One ruled line a page: its name on the left, its actions on the right, as the other sections' rows.
                  <View key={p.page} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
                    <Body size={12.5} weight="medium" style={{ flex: 1, minWidth: 0 }}>{humanPage(p.page)}</Body>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: 4, maxWidth: "60%" }}>
                      {p.actions.length === 0 ? (
                        <Body size={11} color={S.graphite}>View only</Body>
                      ) : (
                        p.actions.map((a) => (
                          <View key={a} style={{ borderWidth: 1, borderColor: a === "delete" ? S.red : S.ink, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 8.5, letterSpacing: 0.8, textTransform: "uppercase", color: a === "delete" ? S.red : S.ink }}>{a}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  </View>
                ))
              )}
            </Panel>
          )}

          {tab === "activity" && (
            <Panel title="Recent activity" icon={<Activity size={14} color={S.ink} />}>
              {activityQ.isLoading ? (
                <>
                  <Skel h={36} />
                  <Skel h={36} />
                  <Skel h={36} />
                </>
              ) : activityQ.isError ? (
                <Notice>{(activityQ.error as Error)?.message || "Could not load your activity."}</Notice>
              ) : (activityQ.data ?? []).length === 0 ? (
                <Body color={S.graphite}>No activity recorded yet.</Body>
              ) : (
                <LineList
                  rows={(activityQ.data ?? []).map((r, i) => ({
                    key: i,
                    title: r.ActionType ?? r.EventType ?? "—",
                    note: new Date(r.CreatedAt).toLocaleString("en-IN"),
                    right: r.Resource ?? "—",
                  }))}
                />
              )}
            </Panel>
          )}

          {tab === "settings" && (
            <>
              <Panel title="Sign-in" icon={<Bell size={14} color={S.ink} />}>
                <Toggle
                  title="Show reminders popup on login"
                  hint="Pop up pending alerts (from the bell) right after you sign in on the web. Kept on your account."
                  value={showLoginReminders}
                  disabled={remindersMutation.isPending || !profile}
                  onChange={(v) => remindersMutation.mutate(v)}
                />
              </Panel>
              <Panel title="Animations" icon={<Sparkles size={14} color={S.ink} />}>
                <Toggle
                  title="All animations"
                  hint={prefs.menus && prefs.pages && prefs.counts ? "Everything below is on." : prefs.menus || prefs.pages || prefs.counts ? "Some of the animations below are off." : "Everything below is off."}
                  value={prefs.menus || prefs.pages || prefs.counts}
                  onChange={(v) => setUiPrefs({ menus: v, pages: v, counts: v })}
                />
                {ANIMATIONS.map((a) => (
                  <Toggle key={a.key} title={a.title} hint={a.hint} value={prefs[a.key]} onChange={(v) => setUiPrefs({ [a.key]: v })} />
                ))}
                <Body size={11.5} color={S.graphite}>Saved on this phone only. If the phone is set to reduce motion, these stay off whatever is chosen here.</Body>
              </Panel>
            </>
          )}

          <Key tone="red" label="Sign out" icon={<LogOut size={13} color="#ffffff" />} onPress={confirmSignOut} />
        </SheetShell>
      </SheetPage>

      {/* Change photo: a preview, choose from the library or take one, save; remove the current one. */}
      <SheetPicker visible={photoOpen} title="Change photo" note="JPEG, PNG, WebP or GIF · under 400 KB" onClose={() => { setPhotoOpen(false); setPreview(null); }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14, alignItems: "stretch" }}>
          <View style={{ alignItems: "center" }}>
            <Avatar uri={preview ?? avatarUrl} initials={initials} size={96} />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Key label="Choose photo" icon={<ImageIcon size={13} color={S.ink} />} onPress={() => pick("library")} style={{ flex: 1 }} />
            <Key label="Camera" icon={<Camera size={13} color={S.ink} />} onPress={() => pick("camera")} style={{ flex: 1 }} />
          </View>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {!!avatarUrl && (
              <Key tone="red" label={removeMutation.isPending ? "Removing…" : "Remove"} icon={<Trash2 size={13} color="#ffffff" />} onPress={() => removeMutation.mutate()} disabled={removeMutation.isPending || uploadMutation.isPending} />
            )}
            <Key tone="ink" label={uploadMutation.isPending ? "Saving…" : "Save photo"} onPress={() => preview && uploadMutation.mutate(preview)} disabled={!preview || uploadMutation.isPending} style={{ flex: 1 }} />
          </View>
          <Label style={{ textAlign: "center" }}>Your photo shows in the header and on the web.</Label>
        </ScrollView>
      </SheetPicker>
    </View>
  );
}
