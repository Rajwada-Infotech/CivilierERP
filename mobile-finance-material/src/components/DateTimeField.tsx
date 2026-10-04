import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Calendar, ChevronLeft, ChevronRight, Clock, Minus, Plus, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  MONTH_NAMES, WEEKDAYS, clampDay, formatDisplay, from12h, fromDate, monthGrid,
  parseLocal, shiftMonth, to12h, toLocalString, type LocalDateTime,
} from "@/utils/dateTimeValue";

// Pure-JS date + time picker (no native module, so it ships over the air).
// `value` / `onChange` use the local wall-clock string "YYYY-MM-DDTHH:mm".

const CELL = 40;

function Stepper({
  label, display, onMinus, onPlus, onType, max,
}: { label: string; display: string; onMinus: () => void; onPlus: () => void; onType: (n: number) => void; max: number }) {
  const [text, setText] = useState(display);
  useEffect(() => setText(display), [display]);
  const btn = { width: 34, height: 34, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" } as const;
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.medium, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable onPress={onMinus} style={btn} hitSlop={6}><Minus size={14} color={colors.foreground} /></Pressable>
        <TextInput
          value={text}
          onChangeText={(t) => setText(t.replace(/\D/g, "").slice(0, 2))}
          onEndEditing={() => {
            const n = Number(text);
            if (text !== "" && Number.isFinite(n)) onType(Math.min(Math.max(n, 0), max));
            else setText(display);
          }}
          keyboardType="number-pad"
          selectTextOnFocus
          style={{ width: 52, height: 34, textAlign: "center", color: colors.foreground, fontFamily: fonts.heading.semibold, fontSize: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 0 }}
        />
        <Pressable onPress={onPlus} style={btn} hitSlop={6}><Plus size={14} color={colors.foreground} /></Pressable>
      </View>
    </View>
  );
}

function PickerSheet({
  title, initial, clearable, onApply, onClear, onClose,
}: {
  title: string; initial: string; clearable?: boolean;
  onApply: (v: string) => void; onClear: () => void; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const start: LocalDateTime = parseLocal(initial) ?? fromDate();
  const [draft, setDraft] = useState<LocalDateTime>(start);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const today = fromDate();
  const { hour12, pm } = to12h(draft.h);

  const setHour12 = (h: number) => setDraft((d) => ({ ...d, h: from12h(((h - 1 + 12) % 12) + 1, to12h(d.h).pm) }));
  const setMinute = (m: number) => setDraft((d) => ({ ...d, min: ((m % 60) + 60) % 60 }));
  const pickDay = (day: number) => setDraft((d) => ({ ...d, y: view.y, m: view.m, d: clampDay(view.y, view.m, day) }));
  const isSelected = (day: number) => draft.y === view.y && draft.m === view.m && draft.d === day;
  const isToday = (day: number) => today.y === view.y && today.m === view.m && today.d === day;

  const chip = (active: boolean) => ({
    paddingHorizontal: 14, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center",
    borderColor: active ? colors.primary : colors.border, backgroundColor: active ? `${colors.primary}26` : "transparent",
  }) as const;

  return (
    <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose}>
      <Pressable
        onPress={() => {}}
        style={{
          position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "92%", backgroundColor: colors.card,
          borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, overflow: "hidden",
        }}
      >
        <View style={{ alignItems: "center", paddingTop: 8, paddingBottom: 4 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>{title}</Text>
          <Pressable onPress={onClose} style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
            <X size={13} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          {/* Month header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <Pressable onPress={() => setView((v) => shiftMonth(v.y, v.m, -1))} hitSlop={8} style={{ padding: 6 }}>
              <ChevronLeft size={18} color={colors.foreground} />
            </Pressable>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>
              {MONTH_NAMES[view.m - 1]} {view.y}
            </Text>
            <Pressable onPress={() => setView((v) => shiftMonth(v.y, v.m, 1))} hitSlop={8} style={{ padding: 6 }}>
              <ChevronRight size={18} color={colors.foreground} />
            </Pressable>
          </View>

          {/* Weekday row + days */}
          <View style={{ flexDirection: "row" }}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={{ flex: 1, textAlign: "center", color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.medium, paddingBottom: 4 }}>{w}</Text>
            ))}
          </View>
          {monthGrid(view.y, view.m).map((week, wi) => (
            <View key={wi} style={{ flexDirection: "row" }}>
              {week.map((day, di) =>
                day == null ? (
                  <View key={di} style={{ flex: 1, height: CELL }} />
                ) : (
                  <Pressable key={di} onPress={() => pickDay(day)} style={{ flex: 1, height: CELL, alignItems: "center", justifyContent: "center" }}>
                    <View
                      style={{
                        width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center",
                        backgroundColor: isSelected(day) ? colors.primary : "transparent",
                        borderWidth: isToday(day) && !isSelected(day) ? 1 : 0, borderColor: colors.primary,
                      }}
                    >
                      <Text style={{ color: isSelected(day) ? "#fff" : colors.foreground, fontSize: 13, fontFamily: isSelected(day) ? fonts.heading.semibold : fonts.body.regular }}>
                        {day}
                      </Text>
                    </View>
                  </Pressable>
                ),
              )}
            </View>
          ))}

          {/* Time */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, marginBottom: 8 }}>
            <Clock size={13} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.6 }}>Time</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
            <Stepper
              label="Hour" display={String(hour12).padStart(2, "0")} max={12}
              onMinus={() => setHour12(hour12 - 1)} onPlus={() => setHour12(hour12 + 1)} onType={(n) => setHour12(n === 0 ? 12 : n)}
            />
            <Stepper
              label="Minute" display={String(draft.min).padStart(2, "0")} max={59}
              onMinus={() => setMinute(draft.min - 1)} onPlus={() => setMinute(draft.min + 1)} onType={setMinute}
            />
            <View style={{ gap: 6 }}>
              <Pressable onPress={() => setDraft((d) => ({ ...d, h: from12h(to12h(d.h).hour12, false) }))} style={chip(!pm)}>
                <Text style={{ color: !pm ? colors.primary : colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.semibold }}>AM</Text>
              </Pressable>
              <Pressable onPress={() => setDraft((d) => ({ ...d, h: from12h(to12h(d.h).hour12, true) }))} style={chip(pm)}>
                <Text style={{ color: pm ? colors.primary : colors.mutedForeground, fontSize: 12, fontFamily: fonts.heading.semibold }}>PM</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={() => {
              const n = fromDate();
              setDraft(n);
              setView({ y: n.y, m: n.m });
            }}
            style={{ alignSelf: "flex-start", marginTop: 12, paddingHorizontal: 12, height: 32, borderRadius: 10, borderWidth: 1, borderColor: colors.border, justifyContent: "center" }}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.medium }}>Set to now</Text>
          </Pressable>
        </ScrollView>

        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderTopColor: colors.border }}>
          {clearable && (
            <Pressable onPress={onClear} style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Clear</Text>
            </Pressable>
          )}
          <Pressable onPress={onClose} style={{ paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={() => onApply(toLocalString(draft))} style={{ flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary }}>
            <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Set</Text>
          </Pressable>
        </View>
      </Pressable>
    </Pressable>
  );
}

/** A tappable field that opens the date + time picker. Same look as the form's text fields. */
export function DateTimeField({
  value, onChange, placeholder = "Select date & time", title = "Select date & time", clearable, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  title?: string;
  clearable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = formatDisplay(value);
  return (
    <>
      <Pressable
        onPress={disabled ? undefined : () => setOpen(true)}
        style={{
          flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
          paddingHorizontal: 14, paddingVertical: 11, marginBottom: 14, opacity: disabled ? 0.6 : 1,
        }}
      >
        <Calendar size={15} color={colors.mutedForeground} />
        <Text numberOfLines={1} style={{ flex: 1, color: shown ? colors.foreground : `${colors.mutedForeground}99`, fontFamily: fonts.body.regular, fontSize: 13 }}>
          {shown || placeholder}
        </Text>
        {clearable && !!value && !disabled && (
          <Pressable onPress={() => onChange("")} hitSlop={10}>
            <X size={14} color={colors.mutedForeground} />
          </Pressable>
        )}
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        {/* Mounted only while open so each opening starts from the current value. */}
        {open && (
          <PickerSheet
            title={title}
            initial={value}
            clearable={clearable && !!value}
            onApply={(v) => { onChange(v); setOpen(false); }}
            onClear={() => { onChange(""); setOpen(false); }}
            onClose={() => setOpen(false)}
          />
        )}
      </Modal>
    </>
  );
}
