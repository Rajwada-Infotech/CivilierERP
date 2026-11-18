// This app's working pages on the drawing sheet. Lists keep their FlatList (paged from the server, thousands of rows),
// so instead of one framed sheet they draw the sheet's parts around it: a title block over an ink rule, square filter
// keys, ruled rows on paper.
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Label, Notice, Press, TitleText } from "./Sheet";

/** A page's title block: eyebrow, title, a line about the page, an optional action on the right; an ink rule under it. */
export function PageHead({ eyebrow = "Civil Work DPR", title, subtitle, action, children }: { eyebrow?: string; title: string; subtitle?: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: S.paper, borderBottomWidth: 1.5, borderBottomColor: S.ink }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: children ? 12 : 16, flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <Label>{eyebrow}</Label>
          <TitleText size={24}>{title}</TitleText>
          {!!subtitle && <Body size={12.5} color={S.ink2}>{subtitle}</Body>}
        </View>
        {action}
      </View>
      {children ? <View style={{ paddingHorizontal: 16, paddingBottom: 14, gap: 10 }}>{children}</View> : null}
    </View>
  );
}

/** Filter keys in one sideways-scrolling row: square, ink-ruled, the chosen one filled ink. */
export function ChipRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Press
            key={o.value}
            onPress={() => onChange(o.value)}
            style={(pressed) => ({ paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: S.ink, backgroundColor: on ? S.ink : pressed ? S.blueWash : "transparent" })}
          >
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: on ? S.paper : S.graphite }}>
              {o.label}
              {o.count != null ? ` · ${o.count}` : ""}
            </Text>
          </Press>
        );
      })}
    </ScrollView>
  );
}

/** The plain notice a page shows to someone without the right to open it. */
export function NoAccessPage({ title, what }: { title: string; what: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: S.paper }}>
      <PageHead title={title} />
      <View style={{ padding: 16 }}>
        <Notice tone="ink">{`You don't have permission to view ${what}. Ask your administrator if you need access.`}</Notice>
      </View>
    </View>
  );
}
