// RN port of src/pages/admin/security/PasswordReset.tsx (web), on the drawing sheet as the web draws it: the title block
// with Refresh; the figures (users, active, inactive) in thirds; and the people register — its count ("n of m" while
// searching), a search box over names and emails, keys to narrow by role, and one ruled card per person (initials in
// an ink square, Active mark or Inactive, name, email, role tag, Reset password). An inactive person's card is dashed,
// as on the web. ResetPasswordModal carries the reset itself.
import { useEffect, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { KeyRound, RefreshCw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getUsers, type ResetUser } from "@/api/passwordResetApi";
import { Body, Key, Label, Notice, SearchBox, SheetMark, SheetShell, StatRow } from "@/components/sheet/Sheet";
import { KeyRow, RegisterBox, RegisterLoading, SheetPage } from "@/components/sheet/Register";
import { initialsOf, roleLabel } from "./userDisplay";
import { ResetPasswordModal } from "./ResetPasswordModal";

const ALL_ROLES = ["All", "super_admin", "admin", "dba", "manager", "director", "user"];

function UserCard({ user, onReset }: { user: ResetUser; onReset: () => void }) {
  const ink = user.isActive ? S.ink : S.graphite;
  return (
    <View style={{ borderWidth: 1, borderStyle: user.isActive ? "solid" : "dashed", borderColor: user.isActive ? S.ink : S.line40 }}>
      <View style={{ padding: 12, gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <View style={{ width: 40, height: 40, borderWidth: 1, borderColor: user.isActive ? S.ink : S.line40, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontFamily: fonts.heading.bold, fontSize: 13, color: ink }}>{initialsOf(user.name)}</Text>
          </View>
          {user.isActive ? <SheetMark text="Active" tone="done" /> : <Label>Inactive</Label>}
        </View>
        <Text numberOfLines={1} style={{ fontFamily: fonts.body.semibold, fontSize: 13.5, color: ink }}>{user.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>{user.email}</Text>
        <View style={{ alignSelf: "flex-start", borderWidth: 1, borderColor: S.line40, paddingHorizontal: 6, paddingVertical: 2, marginTop: 2 }}>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: S.ink }}>{roleLabel(user.role)}</Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: S.line15 }}>
        <Key label="Reset password" icon={<KeyRound size={13} color={S.ink} />} onPress={onReset} />
      </View>
    </View>
  );
}

export default function PasswordResetScreen() {
  const [users, setUsers] = useState<ResetUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [selectedUser, setSelectedUser] = useState<ResetUser | null>(null);

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      setUsers(await getUsers());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const presentRoles = useMemo(() => {
    const roles = new Set(users.map((u) => u.role).filter(Boolean));
    return ALL_ROLES.filter((r) => r === "All" || roles.has(r));
  }, [users]);

  const filtered = useMemo(() => {
    let list = users;
    if (roleFilter !== "All") list = list.filter((u) => u.role === roleFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    return list;
  }, [users, search, roleFilter]);

  const activeCount = users.filter((u) => u.isActive).length;
  const narrowing = !!search.trim() || roleFilter !== "All";

  return (
    <View style={{ flex: 1 }}>
      <SheetPage refreshing={refreshing} onRefresh={() => load(true)}>
        <SheetShell
          eyebrow="CivilierERP · Admin · Security"
          title="Password reset"
          subtitle="Find a person and set a new password on their behalf."
          action={<Key label={refreshing ? "Loading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => load(true)} disabled={refreshing} style={{ alignSelf: "flex-start" }} />}
        >
          <StatRow
            items={[
              { label: "Users", value: loading ? "…" : String(users.length), note: "on record" },
              { label: "Active", value: loading ? "…" : String(activeCount), note: "can sign in" },
              { label: "Inactive", value: loading ? "…" : String(users.length - activeCount), note: "sign-in blocked" },
            ]}
          />

          <RegisterBox>
            <View style={{ borderBottomWidth: 1, borderBottomColor: S.ink, paddingBottom: 10 }}>
              <Label color={S.ink}>People</Label>
              <Body size={12} color={S.graphite} style={{ marginTop: 3 }}>{narrowing ? `${filtered.length} of ${users.length}` : `${users.length} on record`}</Body>
            </View>
            <SearchBox value={search} onChange={setSearch} placeholder="Search by name or email…" />
            {presentRoles.length > 2 && <KeyRow options={presentRoles.map((r) => ({ value: r, label: r === "All" ? "All roles" : roleLabel(r) }))} value={roleFilter} onChange={setRoleFilter} />}

            {loading ? (
              <RegisterLoading />
            ) : failed && users.length === 0 ? (
              <>
                <Notice>Could not load the users.</Notice>
                <Key tone="ink" label="Load users" icon={<RefreshCw size={13} color={S.paper} />} onPress={() => load(true)} style={{ alignSelf: "flex-start" }} />
              </>
            ) : filtered.length === 0 ? (
              <View style={{ alignItems: "center", gap: 6, paddingVertical: 24, borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
                <Text style={{ fontFamily: fonts.heading.bold, fontSize: 15, color: S.ink }}>{narrowing ? "No one matches that search" : "No users loaded yet"}</Text>
                <Body size={12} color={S.graphite}>{narrowing ? "Try a different name, email or role." : "Use Load users to fetch the list."}</Body>
                {narrowing ? (
                  <Key label="Clear search" onPress={() => { setSearch(""); setRoleFilter("All"); }} />
                ) : (
                  <Key tone="ink" label="Load users" icon={<RefreshCw size={13} color={S.paper} />} onPress={() => load(true)} />
                )}
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {filtered.map((u) => (
                  <UserCard key={u.id} user={u} onReset={() => setSelectedUser(u)} />
                ))}
              </View>
            )}
          </RegisterBox>
        </SheetShell>
      </SheetPage>

      <ResetPasswordModal user={selectedUser} onClose={() => setSelectedUser(null)} />
    </View>
  );
}
