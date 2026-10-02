// Project-wise grouped list — mobile counterpart of the web registers that
// group records by project (Material Request, PO, GRN, Vehicle In/Out).
// Each project is a collapsible section (sticky header with a record count);
// the existing record cards render inside it. An "All projects" chip row
// narrows the list to one project. Pull-to-refresh, infinite loading and the
// empty state work exactly as the FlatList they replace.
import { ReactElement, ReactNode, useMemo, useState } from "react";
import { View, Text, SectionList, Pressable, RefreshControl, ScrollView, ActivityIndicator } from "react-native";
import { ChevronDown, ChevronRight, Building2, AlertCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";

const NO_PROJECT = "No project";

type Props<T> = {
  items: T[];
  getProject: (item: T) => string | null | undefined;
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => ReactElement;
  /** Singular / plural label for the count badge, e.g. ["req", "req"]. */
  unit: [string, string];
  /** Accent for headers and the active project chip. */
  accent?: string;
  header?: ReactNode;
  emptyText?: string;
  refreshing: boolean;
  onRefresh: () => void;
  onEndReached?: () => void;
  loadingMore?: boolean;
  contentPaddingBottom?: number;
  /** When true (e.g. a search is active) every section starts expanded. */
  expandAll?: boolean;
};

export function ProjectGroupedList<T>({
  items, getProject, keyExtractor, renderItem, unit, accent = colors.primary, header, emptyText = "Nothing here yet.",
  refreshing, onRefresh, onEndReached, loadingMore, contentPaddingBottom = 24, expandAll,
}: Props<T>) {
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  // Explicit toggles; projects never touched fall back to "first one open".
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const map = new Map<string, T[]>();
    items.forEach((it) => {
      const name = (getProject(it) || "").trim() || NO_PROJECT;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(it);
    });
    return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
  }, [items, getProject]);

  const visibleGroups = projectFilter ? groups.filter((g) => g.title === projectFilter) : groups;

  const isOpen = (title: string, index: number) =>
    expandAll || projectFilter != null || (title in toggled ? toggled[title] : index === 0);

  const sections = visibleGroups.map((g, i) => ({
    title: g.title,
    count: g.data.length,
    open: isOpen(g.title, i),
    data: isOpen(g.title, i) ? g.data : [],
  }));

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      className="px-3 py-1.5 rounded-full mr-1.5"
      style={{ borderWidth: 1, borderColor: active ? accent : colors.border, backgroundColor: active ? `${accent}1a` : "transparent" }}
    >
      <Text style={{ color: active ? accent : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{label}</Text>
    </Pressable>
  );

  return (
    <SectionList
      sections={sections}
      keyExtractor={keyExtractor}
      stickySectionHeadersEnabled
      contentContainerStyle={{ padding: 16, paddingBottom: contentPaddingBottom }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}
      onEndReachedThreshold={0.4}
      onEndReached={onEndReached}
      ListHeaderComponent={
        <View>
          {header}
          {groups.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3" contentContainerStyle={{ paddingRight: 8 }}>
              {chip("All projects", projectFilter == null, () => setProjectFilter(null))}
              {groups.map((g) => chip(g.title, projectFilter === g.title, () => setProjectFilter(projectFilter === g.title ? null : g.title)))}
            </ScrollView>
          )}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Pressable
          onPress={() => setToggled((m) => ({ ...m, [section.title]: !section.open }))}
          className="flex-row items-center gap-2 px-3 py-3 rounded-xl mb-2"
          style={{ backgroundColor: colors.background, borderWidth: 1, borderColor: section.open ? `${accent}55` : `${colors.border}99` }}
        >
          {section.open ? <ChevronDown size={16} color={colors.mutedForeground} /> : <ChevronRight size={16} color={colors.mutedForeground} />}
          <Building2 size={14} color={accent} />
          <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{section.title}</Text>
          <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${colors.mutedForeground}1a` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.medium }}>
              {section.count} {section.count === 1 ? unit[0] : unit[1]}
            </Text>
          </View>
        </Pressable>
      )}
      renderItem={({ item }) => <View style={{ paddingLeft: 6 }}>{renderItem(item)}</View>}
      ListEmptyComponent={
        <View className="items-center py-16">
          <AlertCircle size={20} color={`${colors.mutedForeground}80`} />
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, marginTop: 8 }}>{emptyText}</Text>
        </View>
      }
      ListFooterComponent={loadingMore ? (
        <View className="py-4 items-center"><ActivityIndicator size="small" color={colors.mutedForeground} /></View>
      ) : null}
    />
  );
}
