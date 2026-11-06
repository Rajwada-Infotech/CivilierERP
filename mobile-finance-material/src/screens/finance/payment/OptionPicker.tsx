// Generic single-select list, on the drawing sheet — shared by the forms' and lists' dropdown-style fields across
// Finance and Material (company, project, bank, cheque lot, cheque number, card, linked invoice, …) so each one isn't a
// bespoke modal. PickerRow is the field that opens it; OptionPickerModal is the sheet's list picker (components/sheet/
// FormParts): a paper panel under an ink rule, an optional search box, ruled options with the chosen one ticked.
import { useMemo, useState } from "react";
import { View, Text, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Label, Press, SearchBox, Skel } from "@/components/sheet/Sheet";
import { OptionRow, SheetPicker } from "@/components/sheet/FormParts";

export interface PickerOption {
  key: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
}

/** A field that opens a list: its capital label, the value (or the placeholder) in a square ink-ruled box. */
export function PickerRow({
  label, value, placeholder = "All", onPress, disabled,
}: { label: string; value: string; placeholder?: string; onPress: () => void; disabled?: boolean }) {
  return (
    <View style={{ gap: 6, marginBottom: 12, opacity: disabled ? 0.5 : 1 }}>
      <Label>{label}</Label>
      <Press
        onPress={disabled ? undefined : onPress}
        style={(pressed) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: S.line40, backgroundColor: pressed ? S.blueWash : S.paper })}
      >
        <Text numberOfLines={1} style={{ flex: 1, color: value ? S.ink : S.faint, fontSize: 14, fontFamily: fonts.body.regular }}>{value || placeholder}</Text>
        <ChevronRight size={14} color={S.graphite} />
      </Press>
    </View>
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
    <SheetPicker visible={visible} title={title} onClose={onClose}>
      {searchable && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
          <SearchBox value={search} onChange={setSearch} placeholder="Search…" />
        </View>
      )}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled">
        {clearable && <OptionRow label="None" selected={!selectedKey} onPress={() => onSelect("")} />}
        {loading ? (
          <View style={{ padding: 16 }}>
            <Skel h={34} />
            <Skel h={34} />
          </View>
        ) : filtered.length === 0 ? (
          <Body color={S.graphite} style={{ textAlign: "center", paddingVertical: 24 }}>No matches.</Body>
        ) : (
          filtered.map((o) => (
            <OptionRow key={o.key} label={o.label} sub={o.sublabel} selected={selectedKey === o.key} disabled={o.disabled} onPress={() => !o.disabled && onSelect(o.key)} />
          ))
        )}
      </ScrollView>
    </SheetPicker>
  );
}
