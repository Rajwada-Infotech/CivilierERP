// RN equivalent of ApprovalSetup.tsx's UserMultiSelect (web) — web renders
// an inline dropdown positioned against its trigger; RN doesn't have a
// reliable analogue for that (no document click-outside / getBoundingClientRect
// repositioning), so this is a bottom-sheet multi-select instead, matching
// OptionPickerModal's shape elsewhere in this app but toggling rather than
// closing on select.
import { useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import type { User } from "@/api/approvalSetupApi";

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

export function UserMultiSelectModal({
  visible, users, selectedIds, onChange, onClose,
}: {
  visible: boolean;
  users: User[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }, [users, search]);

  const toggle = (id: number) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "75%",
            backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderWidth: 1, borderColor: colors.border, overflow: "hidden",
          }}
        >
          <View className="items-center pt-2 pb-1">
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
          </View>
          <View className="flex-row items-center justify-between px-4 py-2.5">
            <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>
              {selectedIds.length === 0 ? "Select approvers" : `${selectedIds.length} selected`}
            </Text>
            <Pressable onPress={onClose} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.primary }}>
              <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.heading.semibold }}>Done</Text>
            </Pressable>
          </View>

          <View className="mx-4 mb-2 flex-row items-center gap-2 px-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border }}>
            <Search size={13} color={colors.mutedForeground} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search…"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 8 }}
            />
            {!!search && (
              <Pressable onPress={() => setSearch("")}>
                <X size={13} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            {filtered.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 20 }}>No users found.</Text>
            ) : (
              filtered.map((u) => {
                const sel = selectedIds.includes(u.id);
                return (
                  <Pressable
                    key={u.id}
                    onPress={() => toggle(u.id)}
                    className="flex-row items-center gap-3 px-4 py-3"
                    style={{ backgroundColor: sel ? `${colors.primary}0d` : "transparent" }}
                  >
                    <View
                      className="w-8 h-8 rounded-full items-center justify-center"
                      style={{ backgroundColor: `hsl(${(u.id * 47) % 360} 60% 40% / 0.25)` }}
                    >
                      <Text style={{ color: `hsl(${(u.id * 47) % 360} 60% 65%)`, fontSize: 10.5, fontFamily: fonts.heading.bold }}>{initials(u.name)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>{u.name}</Text>
                      <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{u.role}</Text>
                    </View>
                    <View
                      className="w-5 h-5 rounded-full items-center justify-center"
                      style={{ borderWidth: 2, borderColor: sel ? colors.primary : colors.border, backgroundColor: sel ? colors.primary : "transparent" }}
                    >
                      {sel && <Check size={11} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
