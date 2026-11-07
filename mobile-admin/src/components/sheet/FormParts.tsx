// The working form's parts on the drawing sheet, shared by the New / Edit forms (Contract, Invoice, …): text and date
// fields, a picker that looks like a field, and the list picker it opens — a paper panel up from the bottom under an
// ink rule, with a search box and ruled options (a tick for one, a box for several).
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { Check, ChevronDown, X } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Field, IconKey, Input, Label, Press, SearchBox } from "./Sheet";

type Width = `${number}%`;

/** A text field: capital label, square input (several lines when `multiline`). */
export function TextField({
  label, value, onChangeText, placeholder, keyboardType, multiline, width,
}: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: "default" | "numeric"; multiline?: boolean; width?: Width;
}) {
  return (
    <Field label={label} style={{ marginBottom: 14, width }}>
      <Input
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        style={multiline ? { minHeight: 76, paddingVertical: 10, textAlignVertical: "top" } : undefined}
      />
    </Field>
  );
}

/** A date typed as YYYY-MM-DD, half a row wide unless told otherwise. */
export function DateField({ label, value, onChangeText, width = "48%" }: { label: string; value: string; onChangeText: (v: string) => void; width?: Width }) {
  return (
    <Field label={label} style={{ width, marginBottom: 14 }}>
      <Input value={value} onChangeText={onChangeText} placeholder="YYYY-MM-DD" />
    </Field>
  );
}

/** A picker that looks like a field and opens a list. Half a row wide; `wide` (or a `width`) for more. */
export function PickerField({
  label, value, placeholder, onPress, disabled, wide, width,
}: {
  label: string; value: string; placeholder: string; onPress: () => void; disabled?: boolean; wide?: boolean; width?: Width;
}) {
  return (
    <Field label={label} style={{ width: width ?? (wide ? "100%" : "48%"), marginBottom: 14, opacity: disabled ? 0.5 : 1 }}>
      <Press
        onPress={disabled ? undefined : onPress}
        style={(pressed) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, borderWidth: 1, borderColor: S.line40, backgroundColor: pressed ? S.blueWash : S.paper })}
      >
        <Text numberOfLines={1} style={{ color: value ? S.ink : S.faint, fontSize: 14, fontFamily: fonts.body.regular, flexShrink: 1 }}>{value || placeholder}</Text>
        <ChevronDown size={13} color={S.graphite} />
      </Press>
    </Field>
  );
}

/** The list picker's frame: a paper panel up from the bottom under an ink rule, its title and a close key. */
export function SheetPicker({
  visible, title, note, onClose, children, footer,
}: {
  visible: boolean; title: string; note?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: S.paper, maxHeight: "78%", borderTopWidth: 1.5, borderTopColor: S.ink }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: S.ink }}>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Label color={S.ink}>{title}</Label>
              {!!note && <Body size={11.5} color={S.graphite}>{note}</Body>}
            </View>
            <IconKey onPress={onClose} size={32}>
              <X size={14} color={S.ink} />
            </IconKey>
          </View>
          {children}
          {footer}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** One option: a ruled row, the chosen one marked — a tick, or (with `check`) a filled box for a choice of several. */
export function OptionRow({
  label, sub, selected, onPress, check, disabled,
}: {
  label: string; sub?: string; selected?: boolean; onPress: () => void; check?: boolean; disabled?: boolean;
}) {
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      style={(pressed) => ({ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: S.ruleSoft, opacity: disabled ? 0.35 : 1, backgroundColor: pressed || selected ? S.blueWash : "transparent" })}
    >
      {check ? (
        <View style={{ width: 16, height: 16, marginTop: 1, borderWidth: 1, borderColor: S.ink, backgroundColor: selected ? S.ink : "transparent", alignItems: "center", justifyContent: "center" }}>
          {selected && <Check size={10} color={S.paper} />}
        </View>
      ) : (
        <Check size={13} color={selected ? S.ink : "transparent"} style={{ marginTop: 2 }} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: S.ink, fontSize: 13, fontFamily: selected ? fonts.body.semibold : fonts.body.regular }}>{label}</Text>
        {!!sub && <Text numberOfLines={1} style={{ color: S.graphite, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 2 }}>{sub}</Text>}
      </View>
    </Press>
  );
}

/** Pick one from a list, with a search box. */
export function OptionSheet({
  visible, title, options, onSelect, onClose,
}: {
  visible: boolean; title: string; options: Array<{ id: string | number; label: string; sub?: string }>; onSelect: (id: string) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const filtered = options.filter((o) => `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <SheetPicker visible={visible} title={title} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search…" />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {filtered.length === 0 ? (
          <Body color={S.graphite} style={{ textAlign: "center", paddingVertical: 28 }}>No matches found</Body>
        ) : (
          filtered.map((o, i) => <OptionRow key={`${o.id}-${i}`} label={o.label} sub={o.sub} onPress={() => onSelect(String(o.id))} />)
        )}
      </ScrollView>
    </SheetPicker>
  );
}
