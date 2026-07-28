// RN port of src/pages/admin/security/PasswordReset.tsx (web) — same stats
// row, search + role filter chips, user grid (web's grid collapses to a
// single column at phone width anyway, so a plain FlatList here isn't a
// re-imagining). ResetPasswordModal.tsx carries the actual reset flow.
import { useEffect, useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, TextInput, ActivityIndicator, RefreshControl, useWindowDimensions } from "react-native";
import { Search, X, Users, UserCheck, UserX, User, KeyRound, RefreshCw } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getUsers, type ResetUser } from "@/api/passwordResetApi";
import { avatarGradientColor, initialsOf, roleLabel, roleColor } from "./userDisplay";
import { ResetPasswordModal } from "./ResetPasswordModal";

const ALL_ROLES = ["All", "super_admin", "admin", "dba", "manager", "director", "user"];

function StatTile({ icon: Icon, label, value, color, bg }: { icon: React.ComponentType<{ size?: number; color?: string }>; label: string; value: number; color: string; bg: string }) {
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
        <Icon size={13} color={color} />
      </View>
      <View>
        <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, lineHeight: 18 }}>{value}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 9.5, marginTop: 1 }}>{label}</Text>
      </View>
    </View>
  );
}

function UserCard({ user, onReset }: { user: ResetUser; onReset: () => void }) {
  const grad = avatarGradientColor(user.name);
  const rColor = roleColor(user.role);

  return (
    <View style={{ borderRadius: 18, overflow: "hidden", marginBottom: 10, backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
      <View style={{ height: 3, backgroundColor: grad }} />
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: grad, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.bold }}>{initialsOf(user.name)}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: user.isActive ? "#10b9811a" : `${colors.destructive}1a` }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: user.isActive ? "#10b981" : colors.destructive }} />
            <Text style={{ color: user.isActive ? "#10b981" : colors.destructive, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{user.isActive ? "Active" : "Inactive"}</Text>
          </View>
        </View>

        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{user.name}</Text>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1, marginBottom: 8 }}>{user.email}</Text>

        <View style={{ alignSelf: "flex-start", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: `${rColor}1a`, marginBottom: 12 }}>
          <Text style={{ color: rColor, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{roleLabel(user.role)}</Text>
        </View>

        <Pressable
          onPress={onReset}
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
        >
          <KeyRound size={12} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.heading.semibold }}>Reset Password</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function PasswordResetScreen() {
  const { width } = useWindowDimensions();
  const [users, setUsers] = useState<ResetUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [selectedUser, setSelectedUser] = useState<ResetUser | null>(null);

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      setUsers(await getUsers());
    } catch {
      // swallow — empty state below already communicates "no data"
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
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    }
    return list;
  }, [users, search, roleFilter]);

  const activeCount = users.filter((u) => u.isActive).length;
  const inactiveCount = users.length - activeCount;

  const ListHeader = (
    <View style={{ width: width - 32, marginBottom: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
        <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>Password Reset</Text>
        <Pressable onPress={() => load(true)} disabled={refreshing} hitSlop={8} style={{ padding: 6 }}>
          {refreshing ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
        </Pressable>
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: 11.5, marginBottom: 14 }}>
        Search for a user and set a new password on their behalf.
      </Text>

      <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
        <StatTile icon={Users} label="Total Users" value={users.length} color="#3b82f6" bg="#3b82f61a" />
        <StatTile icon={UserCheck} label="Active" value={activeCount} color="#10b981" bg="#10b9811a" />
        <StatTile icon={UserX} label="Inactive" value={inactiveCount} color={colors.destructive} bg={`${colors.destructive}1a`} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 10 }}>
        <Search size={13} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or email…"
          placeholderTextColor={`${colors.mutedForeground}99`}
          style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 10 }}
        />
        {!!search && (
          <Pressable onPress={() => setSearch("")} hitSlop={6}>
            <X size={13} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      {presentRoles.length > 2 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {presentRoles.map((role) => {
            const active = roleFilter === role;
            return (
              <Pressable
                key={role}
                onPress={() => setRoleFilter(role)}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: active ? "#2563eb" : colors.border, backgroundColor: active ? "#2563eb" : "transparent" }}
              >
                <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold }}>
                  {role === "All" ? "All Roles" : roleLabel(role)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {(search || roleFilter !== "All") && !loading && (
        <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 10.5, marginTop: 10 }}>
          Showing {filtered.length} of {users.length} users
        </Text>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(u) => u.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
          ListHeaderComponent={ListHeader}
          renderItem={({ item }) => <UserCard user={item} onReset={() => setSelectedUser(item)} />}
          ListEmptyComponent={
            <View style={{ alignItems: "center", paddingVertical: 40 }}>
              <User size={26} color={`${colors.mutedForeground}4d`} />
              <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 12 }}>
                {search || roleFilter !== "All" ? "No users match your filters." : "No users found."}
              </Text>
            </View>
          }
        />
      )}

      <ResetPasswordModal user={selectedUser} onClose={() => setSelectedUser(null)} />
    </View>
  );
}
