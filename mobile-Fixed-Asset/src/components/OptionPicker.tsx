// Generic bottom-sheet single-select list — RN has no reliable analogue for
// web's positioned dropdown (getBoundingClientRect + document click-outside),
// so every "choose one from a list" field in this app uses this instead.
// Mirrors mobile/'s finance/payment/OptionPicker.tsx.
import { useMemo, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Search, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export interface PickerOption {
  key: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

export function PickerRow({
  label, value, sublabel, placeholder = "— Select —", onPress, disabled, required,
}: { label: string; value: string; sublabel?: string; placeholder?: string; onPress: () => void; disabled?: boolean; required?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{
        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
        paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, marginBottom: 14,
        borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80`, opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {label}{required ? " *" : ""}
        </Text>
        <Text numberOfLines={1} style={{ color: value ? colors.foreground : `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 2 }}>
          {value || placeholder}
        </Text>
      </View>
      {sublabel && (
        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: `${colors.primary}1a`, marginRight: 8 }}>
          <Text style={{ color: colors.primary, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{sublabel}</Text>
        </View>
      )}
      <Text style={{ color: colors.mutedForeground, fontSize: 16 }}>›</Text>
    </Pressable>
  );
}

export function OptionPickerModal({
  visible, title, options, selectedKey, onSelect, onClose, searchable, clearable, loading,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedKey?: string | null;
  onSelect: (key: string) => void;
  onClose: () => void;
  searchable?: boolean;
  clearable?: boolean;
  loading?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q));
  }, [options, search]);

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
          <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>{title}</Text>
            <Pressable onPress={onClose} style={{ width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border }}>
              <X size={13} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {searchable && (
            <View style={{ marginHorizontal: 16, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
              <Search size={13} color={colors.mutedForeground} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search…"
                placeholderTextColor={`${colors.mutedForeground}99`}
                style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 12.5, paddingVertical: 8 }}
              />
            </View>
          )}

          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
            {clearable && (
              <Pressable onPress={() => onSelect("")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.body.medium }}>None</Text>
                {!selectedKey && <Check size={15} color={colors.primary} />}
              </Pressable>
            )}
            {loading ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 20 }}>Loading…</Text>
            ) : filtered.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", paddingVertical: 20 }}>No matches.</Text>
            ) : (
              filtered.map((o) => (
                <Pressable
                  key={o.key}
                  onPress={() => !o.disabled && onSelect(o.key)}
                  disabled={o.disabled}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, opacity: o.disabled ? 0.4 : 1 }}
                >
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular }}>{o.label}</Text>
                    {!!o.sublabel && <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{o.sublabel}</Text>}
                  </View>
                  {selectedKey === o.key && <Check size={15} color={colors.primary} />}
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
