// The working register's parts on the drawing sheet, shared by the material module's pages (Material Request, PO, GRN,
// Vehicle In/Out, Issues, …) as the web's registers draw them: a scrolling page that loads the next page near its end,
// a no-access sheet, wrapping filter keys, records grouped by project under ruled collapsible heads, a ruled record
// row with its marks and keys, a record's own sheet (a page up over the list), and a form as a page with Cancel / Save.
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronDown, ChevronRight, Eye, Pencil, Plus, Trash2, X } from "lucide-react-native";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, IconKey, Key, Label, Notice, Press, SheetShell, Skel } from "./Sheet";

export function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** A register page: scrolls, pulls to refresh, and asks for the next page as it nears the end of what is loaded. */
export function SheetPage({
  children, refreshing, onRefresh, onEndReached,
}: { children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; onEndReached?: () => void }) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={S.ink} /> : undefined}
      scrollEventThrottle={200}
      onScroll={
        onEndReached
          ? ({ nativeEvent: e }) => {
              if (e.layoutMeasurement.height + e.contentOffset.y >= e.contentSize.height - 600) onEndReached();
            }
          : undefined
      }
    >
      {children}
    </ScrollView>
  );
}

export function NoAccess({ eyebrow, title, what }: { eyebrow: string; title: string; what: string }) {
  return (
    <SheetPage>
      <SheetShell eyebrow={eyebrow} title={title}>
        <Notice tone="ink">{`You don't have permission to view ${what}.`}</Notice>
      </SheetShell>
    </SheetPage>
  );
}

/** Filter keys that wrap onto a second line on a narrow phone: each a square key, the chosen one filled ink. */
export function KeyRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Press
            key={o.value}
            onPress={() => onChange(o.value)}
            style={(pressed) => ({ paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: S.ink, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
          >
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: on ? S.paper : S.graphite }}>{o.label}</Text>
          </Press>
        );
      })}
    </View>
  );
}

/** A register box: the ink-ruled cell the head, search, filters and rows sit in. */
export function RegisterBox({ children }: { children: React.ReactNode }) {
  return <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>{children}</View>;
}

export function RegisterLoading() {
  return (
    <>
      <Skel h={80} />
      <Skel h={80} />
      <Skel h={80} />
    </>
  );
}

/** The foot of a paged register: a loading bar while the next page comes, "End of the list" once there is no more. */
export function RegisterFoot({ loadingMore, done, shown }: { loadingMore?: boolean; done?: boolean; shown: number }) {
  if (loadingMore) return <View style={{ paddingTop: 10 }}><Skel h={60} /></View>;
  if (done && shown > 10) return <Label style={{ textAlign: "center", paddingTop: 12 }}>End of the list</Label>;
  return null;
}

const NO_PROJECT = "No project";

/**
 * Records grouped by project, as the web's registers group them: each project a ruled head (a chevron, its name in
 * Sora, the count in a hairline box) that folds its rows away. Groups keep the order the rows arrive in (newest
 * first), so the project with the latest record sits on top. With more than one project, keys narrow to one.
 */
export function ProjectGroups<T>({
  items, getProject, keyOf, renderItem, unit, expandAll, emptyText,
}: {
  items: T[]; getProject: (it: T) => string | null | undefined; keyOf: (it: T) => string | number;
  renderItem: (it: T, last: boolean) => React.ReactNode; unit: [string, string]; expandAll?: boolean; emptyText: string;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [only, setOnly] = useState<string | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, T[]>();
    items.forEach((it) => {
      const name = (getProject(it) || "").trim() || NO_PROJECT;
      if (!map.has(name)) map.set(name, []);
      map.get(name)!.push(it);
    });
    return Array.from(map.entries()).map(([title, rows]) => ({ title, rows }));
  }, [items, getProject]);

  if (items.length === 0) return <Body color={S.graphite}>{emptyText}</Body>;
  const shown = only ? groups.filter((g) => g.title === only) : groups;

  return (
    <View style={{ gap: 12 }}>
      {groups.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {[{ title: "All projects", key: null as string | null }, ...groups.map((g) => ({ title: g.title, key: g.title }))].map((o) => {
            const on = only === o.key;
            return (
              <Press
                key={o.title}
                onPress={() => setOnly(o.key)}
                style={(pressed) => ({ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: on ? S.ink : S.line40, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
              >
                <Text numberOfLines={1} style={{ maxWidth: 200, fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: on ? S.paper : S.graphite }}>{o.title}</Text>
              </Press>
            );
          })}
        </ScrollView>
      )}
      <View style={{ borderTopWidth: 1, borderTopColor: S.ink }}>
        {shown.map((g) => {
          const closed = !expandAll && !!collapsed[g.title];
          return (
            <View key={g.title} style={{ borderBottomWidth: 1, borderBottomColor: S.line15 }}>
              <Press
                onPress={() => setCollapsed((m) => ({ ...m, [g.title]: !m[g.title] }))}
                style={(pressed) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 11, borderBottomWidth: closed ? 0 : 1, borderBottomColor: S.line15, backgroundColor: pressed ? S.blueWash : "transparent" })}
              >
                {closed ? <ChevronRight size={14} color={S.graphite} /> : <ChevronDown size={14} color={S.graphite} />}
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.heading.bold, fontSize: 13.5, letterSpacing: -0.2, color: S.ink }}>{g.title}</Text>
                <View style={{ borderWidth: 1, borderColor: S.line40, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, color: S.graphite }}>{`${g.rows.length} ${g.rows.length === 1 ? unit[0] : unit[1]}`}</Text>
                </View>
              </Press>
              {!closed && g.rows.map((it, i) => <React.Fragment key={keyOf(it)}>{renderItem(it, i === g.rows.length - 1)}</React.Fragment>)}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * One record in a register: its number in Sora with the date beside it, the side figure (an amount or quantity), any
 * lines under it, then its marks on the left and its keys on the right. The whole row opens the record.
 */
export function RecordRow({
  title, date, side, sideNote, lines, marks, actions, onPress, last,
}: {
  title: string; date?: string | null; side?: string | null; sideNote?: string | null; lines?: (React.ReactNode | null | false | undefined)[];
  marks?: React.ReactNode; actions?: React.ReactNode; onPress?: () => void; last?: boolean;
}) {
  return (
    <Press
      onPress={onPress}
      disabled={!onPress}
      style={(pressed) => ({ paddingVertical: 12, gap: 7, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <Text style={{ flex: 1, minWidth: 0, fontFamily: fonts.heading.semibold, fontSize: 13, letterSpacing: 0.2, color: S.ink }}>
          {title}
          {!!date && <Text style={{ color: S.graphite, fontFamily: fonts.body.regular, fontSize: 11.5, letterSpacing: 0 }}>{`  ${date}`}</Text>}
        </Text>
        {!!side && (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 14, color: S.ink, fontVariant: ["tabular-nums"] }}>{side}</Text>
            {!!sideNote && <Text style={{ fontFamily: fonts.body.regular, fontSize: 10.5, color: S.graphite, marginTop: 1 }}>{sideNote}</Text>}
          </View>
        )}
      </View>
      {(lines ?? []).filter(Boolean).map((l, i) =>
        typeof l === "string" ? (
          <Text key={i} numberOfLines={2} style={{ fontFamily: i === 0 ? fonts.body.medium : fonts.body.regular, fontSize: i === 0 ? 12.5 : 12, color: i === 0 ? S.ink : S.ink2 }}>{l}</Text>
        ) : (
          <React.Fragment key={i}>{l}</React.Fragment>
        ),
      )}
      {(marks || actions) && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>{marks}</View>
          <View style={{ flexDirection: "row", gap: 8 }}>{actions}</View>
        </View>
      )}
    </Press>
  );
}

/** A line of "Label value" pairs under a record's number. */
export function Facts({ items }: { items: [string, string | number | null | undefined][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 }}>
      {shown.map(([l, v]) => (
        <Text key={l} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>
          {`${l} `}
          <Text style={{ fontFamily: fonts.body.semibold, color: S.ink }}>{String(v)}</Text>
        </Text>
      ))}
    </View>
  );
}

/** A record's View / Edit / Delete keys (each only when given), plus any of its own keys before them. */
export function RowKeys({ onView, onEdit, onDelete, children }: { onView?: () => void; onEdit?: () => void; onDelete?: () => void; children?: React.ReactNode }) {
  return (
    <>
      {children}
      {onView && (
        <IconKey onPress={onView} size={32}>
          <Eye size={14} color={S.ink} />
        </IconKey>
      )}
      {onEdit && (
        <IconKey onPress={onEdit} size={32}>
          <Pencil size={14} color={S.ink} />
        </IconKey>
      )}
      {onDelete && (
        <IconKey onPress={onDelete} size={32} red>
          <Trash2 size={14} color={S.red} />
        </IconKey>
      )}
    </>
  );
}

/**
 * A record's own sheet: a page up over the register with the sheet's title block (the record's number), a Close key
 * and the record's keys, and its content in the ruled cell below. Loading and a failed load show in place.
 */
export function DetailSheet({
  visible, onClose, eyebrow, title, subtitle, actions, loading, error, onRetry, children,
}: {
  visible: boolean; onClose: () => void; eyebrow: string; title: string; subtitle?: string; actions?: React.ReactNode;
  loading?: boolean; error?: string | null; onRetry?: () => void; children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
          <SheetShell
            eyebrow={eyebrow}
            title={title}
            subtitle={subtitle}
            action={
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Key label="Close" icon={<X size={13} color={S.ink} />} onPress={onClose} />
                {actions}
              </View>
            }
          >
            {error ? (
              <>
                <Notice>{error}</Notice>
                {onRetry && <Key label="Try again" onPress={onRetry} style={{ alignSelf: "flex-start" }} />}
              </>
            ) : loading ? (
              <>
                <Skel h={40} />
                <Skel h={140} />
              </>
            ) : (
              children
            )}
          </SheetShell>
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A ruled table of a record's lines: each a name (and a note) on the left, its figures on the right. */
export function LineList({ rows, empty }: { rows: { key: string | number; title: string; note?: string | null; right: string; rightNote?: string | null; red?: boolean }[]; empty?: string }) {
  if (!rows.length) return <Body size={12.5} color={S.graphite}>{empty ?? "Nothing here."}</Body>;
  return (
    <View>
      {rows.map((r, i) => (
        <View key={r.key} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ fontFamily: fonts.body.medium, fontSize: 12.5, color: S.ink }}>{r.title}</Text>
            {!!r.note && <Text style={{ fontFamily: fonts.body.regular, fontSize: 11, color: S.graphite }}>{r.note}</Text>}
          </View>
          <View style={{ alignItems: "flex-end", maxWidth: "45%" }}>
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12.5, color: r.red ? S.red : S.ink, textAlign: "right", fontVariant: ["tabular-nums"] }}>{r.right}</Text>
            {!!r.rightNote && <Text style={{ fontFamily: fonts.body.regular, fontSize: 10.5, color: S.graphite, textAlign: "right", marginTop: 2 }}>{r.rightNote}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * A form as a page of the stack (asScreen) — or, for callers not yet moved, as a page up over the list. The sheet's
 * title block with a Back / Close key, the form in the ruled cell, and Cancel / Save keys fixed along the foot.
 * Pickers and other overlays go in `overlays`, outside the scroll.
 */
export function FormPage({
  asScreen, visible = true, onClose, eyebrow, title, subtitle, loading, saving, onSave, saveLabel, saveDisabled, children, overlays, footer,
}: {
  asScreen?: boolean; visible?: boolean; onClose: () => void; eyebrow: string; title: string; subtitle?: string; loading?: boolean;
  saving?: boolean; onSave?: () => void; saveLabel: string; saveDisabled?: boolean; children: React.ReactNode; overlays?: React.ReactNode; footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const content = (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background, paddingTop: asScreen ? 0 : insets.top }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <SheetShell
          eyebrow={eyebrow}
          title={title}
          subtitle={subtitle}
          action={<Key label={asScreen ? "Back" : "Close"} icon={<X size={13} color={S.ink} />} onPress={onClose} style={{ alignSelf: "flex-start" }} />}
        >
          {loading ? (
            <>
              <Skel h={44} />
              <Skel h={44} />
              <Skel h={160} />
            </>
          ) : (
            children
          )}
        </SheetShell>
      </ScrollView>
      {footer !== undefined ? (
        footer
      ) : onSave ? (
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: S.ink, backgroundColor: S.paper }}>
          <Key label="Cancel" onPress={onClose} disabled={saving} />
          <Key tone="ink" label={saving ? "Saving…" : saveLabel} onPress={onSave} disabled={saving || saveDisabled || loading} style={{ flex: 1 }} />
        </View>
      ) : null}
      {overlays}
    </KeyboardAvoidingView>
  );
  return asScreen ? (
    <View style={{ flex: 1 }}>{content}</View>
  ) : (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      {content}
    </Modal>
  );
}

/** One line of a form's item list: a numbered ruled box with its remove key. */
export function LineBox({ index, title, onRemove, children }: { index: number; title?: string; onRemove?: () => void; children: React.ReactNode }) {
  return (
    <View style={{ borderWidth: 1, borderColor: S.line40, padding: 10, gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Label color={S.ink} style={{ flex: 1 }}>{title ?? `Line ${index + 1}`}</Label>
        {onRemove && (
          <IconKey onPress={onRemove} size={30} red>
            <Trash2 size={13} color={S.red} />
          </IconKey>
        )}
      </View>
      {children}
    </View>
  );
}

export function AddLineKey({ label = "Add item", onPress }: { label?: string; onPress: () => void }) {
  return <Key label={label} icon={<Plus size={13} color={S.ink} />} onPress={onPress} />;
}

/** A read-only value shown as a field would be: the capital label, the value in a dashed box (a number made on save). */
export function ShownValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 6, marginBottom: 12 }}>
      <Label>{label}</Label>
      <View style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{value}</Text>
      </View>
    </View>
  );
}
