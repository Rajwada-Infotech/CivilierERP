// A date field (YYYY-MM-DD) that opens the system date picker.
import { useState } from "react";
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Calendar } from "lucide-react-native";
import { Label } from "@/components/sheet/Sheet";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { fmtDate } from "@/utils/format";

const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

export function DateField({ label, value, onChange, min, style }: { label: string; value: string; onChange: (v: string) => void; min?: string; style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      <Label>{label}</Label>
      <Pressable onPress={() => setOpen(true)} style={{ minHeight: 44, borderWidth: 1, borderColor: S.line40, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: S.ink, fontFamily: fonts.body.medium, fontSize: 14 }}>{fmtDate(value)}</Text>
        <Calendar size={15} color={S.graphite} />
      </Pressable>
      {open && (
        <DateTimePicker
          value={fromYmd(value)}
          mode="date"
          minimumDate={min ? fromYmd(min) : undefined}
          display={Platform.OS === "ios" ? "inline" : "default"}
          onChange={(e, d) => {
            setOpen(Platform.OS === "ios");
            if (e.type === "set" && d) { onChange(toYmd(d)); if (Platform.OS === "ios") setOpen(false); }
            if (e.type === "dismissed") setOpen(false);
          }}
        />
      )}
    </View>
  );
}
