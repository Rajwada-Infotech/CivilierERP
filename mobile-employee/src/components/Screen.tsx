// A scrolling page on the app background with pull-to-refresh, in the sheet style the other CivilierERP apps use.
import type React from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors } from "@/theme/colors";

export function Screen({ children, refreshing, onRefresh }: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 12, paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32, gap: 12 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: 12 }}>{children}</View>
    </ScrollView>
  );
}

/** A tone chip: Present / Pending / Approved / Rejected, etc. */
export const toneOf = (s?: string | null): "ok" | "warn" | "bad" | "info" => {
  const v = String(s || "").toLowerCase();
  if (["present", "approved", "completed", "success"].includes(v)) return "ok";
  if (["pending", "on break", "half day", "working", "incomplete"].includes(v)) return "warn";
  if (["absent", "rejected", "failed"].includes(v)) return "bad";
  return "info";
};
