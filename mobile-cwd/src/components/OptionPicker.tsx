// Generic single-select list on the drawing sheet, as the Admin and Finance apps draw it: every "choose one from a list"
// field in this app uses it. PickerRow is the field that opens it (capital label, the value in a square ink-ruled box);
// OptionPickerModal is the sheet's list picker (components/sheet/FormParts): a paper panel under an ink rule, an optional
// search box, ruled options with the chosen one ticked.
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

export function PickerRow({
  label, value, sublabel, placeholder = "— Select —", onPress, disabled, required,
}: { label: string; value: string; sublabel?: string; placeholder?: string; onPress: () => void; disabled?: boolean; required?: boolean }) {
  return (
    <View style={{ gap: 6, marginBottom: 12, opacity: disabled ? 0.5 : 1 }}>
      <Label>
        {label}
        {required ? <Text style={{ color: S.red }}> *</Text> : null}
      </Label>
      <Press
        onPress={disabled ? undefined : onPress}
        style={(pressed) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: S.line40, backgroundColor: pressed ? S.blueWash : S.paper })}
      >
        <View style={{ flex: 1, minWidth: 0, paddingVertical: sublabel ? 6 : 0 }}>
          <Text numberOfLines={1} style={{ color: value ? S.ink : S.faint, fontSize: 14, fontFamily: fonts.body.regular }}>{value || placeholder}</Text>
          {!!sublabel && <Text numberOfLines={1} style={{ color: S.graphite, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>{sublabel}</Text>}
        </View>
        <ChevronRight size={14} color={S.graphite} />
      </Press>
    </View>
  );
}

export function OptionPickerModal({
  visible, title, options, selectedKey, onSelect, onClose, searchable, clearable, loading,
  query: controlledQuery, onQueryChange, searchPlaceholder,
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
  // Server-driven search (a typeahead capped to top-N matches, which can't be filtered here): pass both to hand search
  // to the parent — `options` is then shown as given and the parent fetches on `onQueryChange`. Omit both to filter here.
  query?: string;
  onQueryChange?: (q: string) => void;
  searchPlaceholder?: string;
}) {
  const insets = useSafeAreaInsets();
  const serverDriven = onQueryChange !== undefined;
  const [localSearch, setLocalSearch] = useState("");
  const search = serverDriven ? controlledQuery ?? "" : localSearch;
  const setSearch = serverDriven ? onQueryChange! : setLocalSearch;

  const filtered = useMemo(() => {
    if (serverDriven || !search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q));
  }, [options, search, serverDriven]);

  return (
    <SheetPicker visible={visible} title={title} onClose={onClose}>
      {searchable && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
          <SearchBox value={search} onChange={setSearch} placeholder={searchPlaceholder || "Search…"} />
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
