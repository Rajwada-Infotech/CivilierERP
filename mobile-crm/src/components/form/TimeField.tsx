// Time-of-day field — same tappable-row pattern as DateField, mode="time"
// instead of "date". Stores and emits a plain "HH:mm" string, matching
// what web's <input type="time"> produces (Security Shift start/end time).
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Clock } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { FieldError, FieldLabel } from "./Form";

function toHm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function parseHm(s: string | null | undefined): Date {
  const base = new Date();
  if (s && /^\d{2}:\d{2}/.test(s)) {
    const [h, m] = s.split(":").map(Number);
    base.setHours(h, m, 0, 0);
    return base;
  }
  base.setSeconds(0, 0);
  return base;
}

function toDisplay(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

export function TimeField({
  label, value, onChange, required, error, disabled,
}: {
  label: string;
  value: string;
  onChange: (hm: string) => void;
  required?: boolean;
  error?: string | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const handleChange = (e: DateTimePickerEvent, picked?: Date) => {
    setOpen(Platform.OS === "ios");
    if (e.type === "set" && picked) onChange(toHm(picked));
  };

  return (
    <View style={{ marginBottom: 14 }}>
      <FieldLabel label={label} required={required} />
      <Pressable
        onPress={disabled ? undefined : () => setOpen(true)}
        style={{
          flexDirection: "row", alignItems: "center", justifyContent: "space-between",
          borderWidth: 1, borderColor: error ? colors.destructive : colors.border,
          backgroundColor: `${colors.card}80`, borderRadius: 12, paddingHorizontal: 12,
          minHeight: 44, opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text style={{ color: value ? colors.foreground : `${colors.mutedForeground}99`, fontSize: 13.5, fontFamily: fonts.body.regular }}>
          {value ? toDisplay(value) : "Select time"}
        </Text>
        <Clock size={15} color={colors.mutedForeground} />
      </Pressable>
      <FieldError error={error} />
      {open && (
        <DateTimePicker
          mode="time"
          value={parseHm(value)}
          onChange={handleChange}
          display={Platform.OS === "ios" ? "spinner" : "default"}
        />
      )}
    </View>
  );
}
