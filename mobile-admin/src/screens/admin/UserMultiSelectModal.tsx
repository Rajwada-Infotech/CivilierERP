// RN equivalent of the web's approval-setup UserMultiSelect, on the drawing sheet: a paper panel up from the bottom
// (SheetPicker) with a search box over names, emails and roles, and one ruled row per person with a box to tick — it
// toggles rather than closing, and Done closes it. The web's inline dropdown has no reliable phone equivalent.
import { useMemo, useState } from "react";
import { View, ScrollView } from "react-native";
import { sheet as S } from "@/theme/colors";
import type { User } from "@/api/approvalSetupApi";
import { Body, Key, SearchBox } from "@/components/sheet/Sheet";
import { OptionRow, SheetPicker } from "@/components/sheet/FormParts";

export function UserMultiSelectModal({
  visible, users, selectedIds, onChange, onClose,
}: {
  visible: boolean;
  users: User[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? users.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q)) : users;
  }, [users, search]);
  const toggle = (id: number) => onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  return (
    <SheetPicker
      visible={visible}
      title="Choose approvers"
      note={selectedIds.length ? `${selectedIds.length} chosen` : "No one chosen yet"}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: S.ink }}>
          <Key label="Clear" onPress={() => onChange([])} disabled={!selectedIds.length} />
          <Key tone="ink" label="Done" onPress={onClose} style={{ flex: 1 }} />
        </View>
      }
    >
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, email or role…" />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">
        {shown.length === 0 ? (
          <Body color={S.graphite} style={{ textAlign: "center", paddingVertical: 24 }}>No one matches.</Body>
        ) : (
          shown.map((u) => <OptionRow key={u.id} check selected={selectedIds.includes(u.id)} label={u.name} sub={[u.email, u.role?.replace(/_/g, " ")].filter(Boolean).join(" · ")} onPress={() => toggle(u.id)} />)
        )}
      </ScrollView>
    </SheetPicker>
  );
}
