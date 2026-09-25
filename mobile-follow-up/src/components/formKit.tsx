// Small shared building blocks for the Follow-Up screens' forms and detail
// views: labelled text field, selectable chip, primary button, section card,
// a bottom-sheet style picker, and a query-state wrapper.
import { useState } from "react";
import {
  View, Text, TextInput, Pressable, Modal, FlatList, ActivityIndicator, type TextInputProps,
} from "react-native";
import { AlertCircle, Check, ChevronDown, Inbox } from "lucide-react-native";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

export const ACCENT = moduleAccents.followup;

export function fmtDate(d?: string | null, withTime = false) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) +
    (withTime ? ` ${dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "");
}

export const PRIORITY_COLOR: Record<string, string> = {
  "Very Important": "#ef4444",
  Important: "#f59e0b",
  Normal: "#0d9488",
};

export const STATUS_COLOR: Record<string, string> = {
  Active: "#0d9488",
  Hold: "#f59e0b",
  Closed: "#3b82f6",
  Cancel: "#ef4444",
};

export function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${color}22` }}>
      <Text style={{ color, fontSize: 9.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </Text>
    </View>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View
      className="rounded-2xl p-4 mb-3"
      style={{ backgroundColor: `${colors.card}cc`, borderWidth: 1, borderColor: `${colors.border}99` }}
    >
      <View className="flex-row items-center justify-between mb-2.5">
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.medium, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 5 }}>
      {children}
    </Text>
  );
}

export function TextField({ label, ...props }: { label: string } & TextInputProps) {
  return (
    <View className="mb-3">
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={`${colors.mutedForeground}99`}
        {...props}
        style={[
          {
            color: colors.foreground, fontSize: 14, fontFamily: fonts.body.regular, borderRadius: 12,
            paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.surface,
            borderWidth: 1, borderColor: colors.border,
          },
          props.multiline ? { minHeight: 84, textAlignVertical: "top" } : null,
          props.style,
        ]}
      />
    </View>
  );
}

export function Chip({ label, active, onPress, color = ACCENT, disabled }: {
  label: string; active?: boolean; onPress?: () => void; color?: string; disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="px-3 py-1.5 rounded-full mr-2 mb-2"
      style={{
        backgroundColor: active ? `${color}33` : colors.surface,
        borderWidth: 1, borderColor: active ? color : colors.border, opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ color: active ? color : colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.medium }}>{label}</Text>
    </Pressable>
  );
}

export function Btn({ label, onPress, busy, disabled, tone = "primary" }: {
  label: string; onPress: () => void; busy?: boolean; disabled?: boolean; tone?: "primary" | "danger" | "ghost";
}) {
  const bg = tone === "primary" ? ACCENT : tone === "danger" ? colors.destructive : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      className="rounded-xl items-center justify-center py-3 px-4"
      style={{
        backgroundColor: bg, opacity: busy || disabled ? 0.5 : 1,
        borderWidth: tone === "ghost" ? 1 : 0, borderColor: colors.border,
      }}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={{ color: tone === "ghost" ? colors.foreground : "#fff", fontSize: 13.5, fontFamily: fonts.heading.semibold }}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Tap-to-open list picker (single choice). */
export function Picker<T extends { id: number; name: string }>({
  label, value, options, onChange, placeholder = "Select…",
}: {
  label: string; value: number | null; options: T[]; onChange: (id: number) => void; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.id === value);
  const shown = q.trim() ? options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase())) : options;
  return (
    <View className="mb-3">
      <Label>{label}</Label>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center justify-between rounded-xl px-3 py-2.5"
        style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
      >
        <Text style={{ color: selected ? colors.foreground : `${colors.mutedForeground}99`, fontSize: 14, fontFamily: fonts.body.regular }}>
          {selected?.name ?? placeholder}
        </Text>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end" style={{ backgroundColor: "#000a" }}>
          <View className="rounded-t-3xl p-4" style={{ backgroundColor: colors.card, maxHeight: "75%" }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold, marginBottom: 10 }}>{label}</Text>
            <TextInput
              value={q}
              onChangeText={setQ}
              placeholder="Search…"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ color: colors.foreground, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8, fontFamily: fonts.body.regular }}
            />
            <FlatList
              data={shown}
              keyExtractor={(o) => String(o.id)}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { onChange(item.id); setOpen(false); setQ(""); }}
                  className="flex-row items-center justify-between py-3"
                  style={{ borderBottomWidth: 1, borderBottomColor: `${colors.border}88` }}
                >
                  <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.body.regular }}>{item.name}</Text>
                  {item.id === value ? <Check size={16} color={ACCENT} /> : null}
                </Pressable>
              )}
            />
            <Btn label="Close" tone="ghost" onPress={() => { setOpen(false); setQ(""); }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Loading / error / empty wrapper for a query. */
export function QueryState({
  isLoading, isError, error, isEmpty, emptyLabel = "Nothing here", onRetry, children,
}: {
  isLoading: boolean; isError: boolean; error?: unknown; isEmpty?: boolean; emptyLabel?: string; onRetry: () => void; children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center py-20" style={{ backgroundColor: colors.background }}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }
  if (isError) {
    return (
      <View className="flex-1 items-center justify-center gap-2 px-8 py-16" style={{ backgroundColor: colors.background }}>
        <AlertCircle size={22} color={colors.destructive} />
        <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: fonts.body.medium, textAlign: "center" }}>
          {error instanceof Error ? error.message : "Could not load."}
        </Text>
        <Pressable onPress={onRetry} className="mt-2 px-4 py-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (isEmpty) {
    return (
      <View className="flex-1 items-center justify-center gap-2 py-24">
        <Inbox size={26} color={`${colors.mutedForeground}66`} />
        <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.regular }}>{emptyLabel}</Text>
      </View>
    );
  }
  return <>{children}</>;
}
