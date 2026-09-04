// Shared detail-screen shell: pull-to-refresh scroll, a title/subtitle/
// status header, an actions row, and a labelled key-value Row + Section.
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { StatusPill } from "@/components/StatusPill";

const ACCENT = "#eab308";

export function DetailScaffold({
  loading, error, title, subtitle, status, statusTone, actions, refreshing, onRefresh, children,
}: {
  loading?: boolean;
  error?: string | null;
  title?: string;
  subtitle?: string;
  status?: string;
  statusTone?: string;
  actions?: ReactNode;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
    >
      {loading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{error}</Text>
      ) : (
        <>
          {title != null && (
            <>
              <Text style={{ color: colors.foreground, fontSize: 17, fontFamily: fonts.heading.bold }}>{title}</Text>
              <View className="flex-row items-center gap-2" style={{ marginTop: 4 }}>
                {subtitle ? <Text style={{ color: ACCENT, fontSize: 12, fontFamily: fonts.body.medium }}>{subtitle}</Text> : null}
                {status ? <StatusPill label={status} tone={statusTone} /> : null}
              </View>
            </>
          )}
          {actions ? <View className="flex-row flex-wrap gap-2" style={{ marginTop: 14 }}>{actions}</View> : null}
          <View style={{ marginTop: actions || title != null ? 16 : 0 }}>{children}</View>
        </>
      )}
    </ScrollView>
  );
}

export function ActionButton({
  label, icon: Icon, onPress, tone = "neutral", disabled,
}: {
  label: string;
  icon?: (p: { size?: number; color?: string }) => ReactNode;
  onPress: () => void;
  tone?: "primary" | "danger" | "neutral";
  disabled?: boolean;
}) {
  const styles =
    tone === "primary"
      ? { bg: ACCENT, border: ACCENT, fg: "#1a1a1a" }
      : tone === "danger"
        ? { bg: "transparent", border: `${colors.destructive}66`, fg: colors.destructive }
        : { bg: "transparent", border: colors.border, fg: colors.foreground };
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className="flex-row items-center gap-1.5"
      style={{
        paddingVertical: 9, paddingHorizontal: 13, borderRadius: 10,
        backgroundColor: styles.bg, borderWidth: 1, borderColor: styles.border, opacity: disabled ? 0.5 : 1,
      }}
    >
      {Icon ? Icon({ size: 13, color: styles.fg }) : null}
      <Text style={{ color: styles.fg, fontSize: 12, fontFamily: fonts.heading.semibold }}>{label}</Text>
    </Pressable>
  );
}

export function DetailSection({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 12 }}>
      {title ? (
        <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.bold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

export function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <View className="flex-row justify-between py-1.5" style={{ borderBottomWidth: 1, borderBottomColor: `${colors.border}80` }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium, maxWidth: "62%", textAlign: "right" }}>{value}</Text>
    </View>
  );
}
