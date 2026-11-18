// Your account: who you are, what you can do in Civil Work DPR, change your password, sign out.
import { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, LogOut } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Detail, Field, InfoGrid, Input, Key, Label, Notice, Press, SheetFrame, TitleText } from "@/components/sheet/Sheet";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { changeMyPassword, getMyProfile } from "@/api/cwdApi";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", admin: "Admin", user: "User", dba: "DBA", engineer: "Engineer", customer: "Customer",
  supplier: "Supplier", marketing_head: "Marketing Head", sales_team_lead: "Sales Team Lead", sales_person: "Sales Person",
};
// The Civil Work DPR pages this app covers, with the label shown here.
const PAGES: { key: string; label: string }[] = [
  { key: "civilworkdpr-dashboard", label: "Dashboard" },
  { key: "civilworkdpr-work-done", label: "Work Allocation" },
  { key: "civilworkdpr-activity-reporting", label: "Work Reporting" },
  { key: "civilworkdpr-quality-check", label: "Quality Check" },
  { key: "civilworkdpr-work-transfer", label: "Work Transfer" },
];
const ACTION_LABEL: Record<string, string> = { view: "View", create: "Create", edit: "Edit", delete: "Delete", approve: "Approve", reject: "Reject", export: "Export", print: "Print" };
export default function ProfileScreen() {
  const { currentUser, logout } = useAuth();
  const name = currentUser?.name ?? "User";
  const initials = currentUser?.initials || name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const role = currentUser ? ROLE_LABELS[currentUser.role] ?? currentUser.role : "";
  const isSuper = currentUser?.role === "super_admin";
  const profileQ = useQuery({ queryKey: ["cwd-profile", currentUser?.id], queryFn: () => getMyProfile(currentUser!.id), enabled: !!currentUser?.id, staleTime: 300_000 });
  const since = profileQ.data?.created_datetime ? new Date(profileQ.data.created_datetime).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : null;

  const [pwOpen, setPwOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const pwError = next && next.length < 6 ? "New password must be at least 6 characters." : again && next !== again ? "The two new passwords don't match." : null;
  const change = useMutation({
    mutationFn: () => changeMyPassword(currentUser!.id, cur, next),
    onSuccess: () => { toast.success("Password changed"); setCur(""); setNext(""); setAgain(""); setPwOpen(false); },
    onError: (e: Error) => Alert.alert("Couldn't change the password", e.message),
  });

  const confirmSignOut = () =>
    Alert.alert("Sign out?", "You'll need to log in again to continue.", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => logout() },
    ]);

  const rights = (key: string) => (isSuper ? null : currentUser?.pagePermissions?.find((p) => p.page === key)?.actions ?? []);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
      <SheetFrame>
        {/* Title block: initials in an ink square, the role over the name. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 18 }}>
          <View style={{ width: 58, height: 58, borderWidth: 1.5, borderColor: S.ink, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 19, fontFamily: fonts.heading.bold, color: S.ink, letterSpacing: 0.5 }}>{initials}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <Label>{role || "Account"}</Label>
            <TitleText size={24}>{name}</TitleText>
          </View>
        </View>

        <Detail tag="A" title="Account">
          <InfoGrid
            items={[
              { label: "Email", value: currentUser?.email || "—", wide: true },
              { label: "Role", value: role || "—" },
              { label: "User ID", value: currentUser?.id || "—" },
              ...(since ? [{ label: "Member since", value: since }] : []),
            ]}
          />
        </Detail>

        <Detail tag="B" title="Your access" note="Civil Work DPR">
          {isSuper && <Body size={13} color={S.graphite} style={{ marginBottom: 8 }}>Super admin — full access to every page.</Body>}
          <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
            {PAGES.map((pg) => {
              const actions = rights(pg.key);
              const has = actions === null || actions.length > 0;
              return (
                <View key={pg.key} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.body.semibold, color: has ? S.ink : S.graphite }}>{pg.label}</Text>
                    {!has && <Label>No access</Label>}
                  </View>
                  {has && actions !== null && (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                      {actions.map((a) => (
                        <View key={a} style={{ paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: S.rule }}>
                          <Text style={{ fontSize: 9.5, letterSpacing: 0.9, textTransform: "uppercase", fontFamily: fonts.heading.semibold, color: S.ink2 }}>{ACTION_LABEL[a] ?? a}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </Detail>

        <Detail tag="C" title="Password">
          <Press onPress={() => setPwOpen((o) => !o)} style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: S.ink, backgroundColor: pressed ? S.blueWash : "transparent" })}>
            <Text style={{ flex: 1, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", fontFamily: fonts.heading.semibold, color: S.ink }}>Change password</Text>
            <ChevronRight size={15} color={S.graphite} style={{ transform: [{ rotate: pwOpen ? "90deg" : "0deg" }] }} />
          </Press>
          {pwOpen && (
            <View style={{ marginTop: 14, gap: 12 }}>
              <Field label="Current password"><Input value={cur} onChangeText={setCur} secureTextEntry autoCapitalize="none" autoCorrect={false} /></Field>
              <Field label="New password"><Input value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoCorrect={false} /></Field>
              <Field label="Confirm new password"><Input value={again} onChangeText={setAgain} secureTextEntry autoCapitalize="none" autoCorrect={false} /></Field>
              {!!pwError && <Notice>{pwError}</Notice>}
              <Key
                tone="ink"
                label={change.isPending ? "Updating…" : "Update password"}
                disabled={!cur || next.length < 6 || next !== again || change.isPending}
                onPress={() => change.mutate()}
              />
            </View>
          )}
        </Detail>

        <Detail tag="D" title="Sign out">
          <Key tone="red" label="Sign out" icon={<LogOut size={15} color="#ffffff" />} onPress={confirmSignOut} />
        </Detail>
      </SheetFrame>
    </ScrollView>
  );
}
