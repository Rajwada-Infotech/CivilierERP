// Shared read-only list scaffold for the Maintenance module screens
// (Customer Directory, Bills, Personnel, Meters, etc.). Same loading /
// error / pull-to-refresh / empty-state behaviour every list screen
// needs, factored out so each screen stays short and consistent.
import { useState, type ReactElement } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import type { UseQueryResult } from "@tanstack/react-query";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";


export const STATUS_COLOR: Record<string, string> = {
  Active: "#10b981",
  Tagged: "#10b981",
  Good: "#10b981",
  Done: "#10b981",
  Completed: "#10b981",
  Posted: "#10b981",
  Current: "#10b981",
  Pending: "#f59e0b",
  Average: "#f59e0b",
  Draft: "#f59e0b",
  Repairing: "#8b5cf6",
  Defective: "#ef4444",
  Overdue: "#ef4444",
  Reversed: "#ef4444",
  Cancelled: "#818898",
  // CRM statuses (bookings, demands, receipts, on-account, tickets, possession)
  Approved: "#10b981",
  Confirmed: "#10b981",
  Paid: "#10b981",
  Applied: "#10b981",
  Acknowledged: "#10b981",
  Resolved: "#10b981",
  Ready: "#10b981",
  Demanded: "#3b82f6",
  Checklist: "#3b82f6",
  Notice: "#3b82f6",
  Handover: "#3b82f6",
  "In Progress": "#3b82f6",
  Open: "#f59e0b",
  Partial: "#f59e0b",
  Unapplied: "#f59e0b",
  Submitted: "#f59e0b",
  Bounced: "#ef4444",
  Rejected: "#ef4444",
  Disputed: "#ef4444",
  Blocked: "#ef4444",
  Closed: "#818898",
  NotReady: "#818898",
  PartiallyApplied: "#f59e0b",
  Inactive: "#818898",
};

/** A status code read as words: "PartiallyApplied" → "Partially Applied". */
export const statusText = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2");

export function Pill({ label, tone }: { label: string; tone?: string }) {
  const c = tone || STATUS_COLOR[label] || "#818898";
  return (
    <View style={{ backgroundColor: `${c}1f`, paddingHorizontal: 6, paddingVertical: 1.5, borderRadius: 999 }}>
      <Text style={{ fontSize: 9, fontFamily: fonts.heading.bold, color: c }}>{statusText(label)}</Text>
    </View>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
      {children}
    </View>
  );
}

export function Line({ children }: { children: React.ReactNode }) {
  return (
    <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 3 }}>
      {children}
    </Text>
  );
}

interface DataListProps<T> {
  query: UseQueryResult<T[], Error>;
  // Rows to render — defaults to query.data. Pass a filtered slice when the
  // screen has its own client-side filter tabs.
  items?: T[];
  keyOf: (item: T) => string;
  renderCard: (item: T) => ReactElement;
  filters?: readonly string[];
  activeFilter?: string;
  onFilter?: (f: string) => void;
  emptyText?: string;
  header?: React.ReactNode;
  footer?: React.ReactNode;
}

export function DataList<T>({
  query,
  items,
  keyOf,
  renderCard,
  filters,
  activeFilter,
  onFilter,
  header,
  footer,
  emptyText = "Nothing to show.",
}: DataListProps<T>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.background }}>
      {header}
      {filters && filters.length > 0 && (
        <View className="flex-row flex-wrap gap-2" style={{ padding: 16, paddingBottom: 8 }}>
          {filters.map((f) => {
            const active = f === activeFilter;
            return (
              <Pressable
                key={f}
                onPress={() => onFilter?.(f)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active ? `${colors.primary}26` : colors.card,
                  borderWidth: 1,
                  borderColor: active ? `${colors.primary}80` : colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: active ? colors.foreground : colors.mutedForeground }}>
                  {statusText(f)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {query.isLoading ? (
        <View style={{ paddingVertical: 60, alignItems: "center" }}>
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : query.error ? (
        <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular, padding: 16 }}>
          {query.error.message}
        </Text>
      ) : (
        <FlatList
          data={items ?? query.data ?? []}
          keyExtractor={keyOf}
          renderItem={({ item }) => renderCard(item)}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: filters ? 8 : 16, paddingBottom: 112 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 40 }}>
              {emptyText}
            </Text>
          }
        />
      )}
      {footer}
    </View>
  );
}
