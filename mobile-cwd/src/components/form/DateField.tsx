// Date field — tappable row that opens the native date picker. Stores and
// emits a plain YYYY-MM-DD string (what every FA endpoint expects).
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Calendar } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { FieldError, FieldLabel } from "./Form";

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string | null | undefined): Date {
  if (s && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

export function DateField({
  label, value, onChange, required, error, disabled,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (ymd: string) => void;
  required?: boolean;
  error?: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const handleChange = (e: DateTimePickerEvent, picked?: Date) => {
    setOpen(Platform.OS === "ios");
    if (e.type === "set" && picked) onChange(toYmd(picked));
  };

  const display = value
    ? parseYmd(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "";

  return (
    <View style={{ marginBottom: 14 }}>
      <FieldLabel label={label} required={required} />
      <Pressable
        onPress={disabled ? undefined : () => setOpen(true)}
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          borderWidth: 1, borderColor: error ? S.red : S.rule,
          backgroundColor: S.paper, borderRadius: 0, paddingHorizontal: 12,
          minHeight: 44, opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text style={{ color: display ? S.ink : S.faint, fontSize: 13.5, fontFamily: fonts.body.regular }}>
          {display || "Select date"}
        </Text>
        <Calendar size={15} color={S.graphite} />
      </Pressable>
      <FieldError error={error} />
      {open && (
        <DateTimePicker
          mode="date"
          value={parseYmd(value)}
          onChange={handleChange}
          display={Platform.OS === "ios" ? "spinner" : "default"}
        />
      )}
    </View>
  );
}
