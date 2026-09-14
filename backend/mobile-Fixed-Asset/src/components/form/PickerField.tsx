// Select field — a tappable row that opens the shared bottom-sheet picker.
// Wraps components/OptionPicker.tsx, adds a label, required marker, inline
// error and async loading state.
import { useState } from "react";
import { View } from "react-native";
import { OptionPickerModal, PickerRow, type PickerOption } from "@/components/OptionPicker";
import { FieldError } from "./Form";

export function PickerField({
  label,
  value,
  options,
  onSelect,
  placeholder,
  required,
  error,
  disabled,
  loading,
  searchable = true,
  clearable,
}: {
  label: string;
  value: string | null | undefined;
  options: PickerOption[];
  onSelect: (key: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  disabled?: boolean;
  loading?: boolean;
  searchable?: boolean;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.key === value);

  return (
    <View style={{ marginBottom: 2 }}>
      <PickerRow
        label={label}
        required={required}
        value={selected?.label ?? ""}
        sublabel={selected?.sublabel}
        placeholder={loading ? "Loading…" : placeholder}
        disabled={disabled || loading}
        onPress={() => setOpen(true)}
      />
      <View style={{ marginTop: -8, marginBottom: 10 }}>
        <FieldError error={error} />
      </View>
      <OptionPickerModal
        visible={open}
        title={label}
        options={options}
        selectedKey={value ?? null}
        onSelect={(k) => { onSelect(k); setOpen(false); }}
        onClose={() => setOpen(false)}
        searchable={searchable}
        clearable={clearable}
        loading={loading}
      />
    </View>
  );
}
