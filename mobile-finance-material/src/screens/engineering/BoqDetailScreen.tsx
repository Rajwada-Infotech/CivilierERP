// One Bill of Quantities, read-only: the summary, its items (with the activity each is for) and its activities, and a
// Print key that makes the invoice-style PDF (utils/boqPdf.ts, the same layout as the web BOQ print) and opens the share sheet.
import { useState } from "react";
import { View, Text, ScrollView, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ArrowLeft, Printer } from "lucide-react-native";
import { getBoq } from "@/api/boqApi";
import { shareBoqPdf } from "@/utils/boqPdf";
import type { MainStackParamList } from "@/navigation/MainStack";
import { usePageRights } from "@/hooks/usePageRights";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, InfoGrid, Key, Notice, Panel, SheetMark, SheetShell, Skel, statusTone } from "@/components/sheet/Sheet";

type Line = Record<string, any>;
const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtAmt = (n: unknown) => `₹${(Number(n) || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amountOf = (r: Line) => Number(r.amount ?? r.LineAmount ?? r.Amount) || 0;

function LineRows({ rows, kind }: { rows: Line[]; kind: "item" | "activity" }) {
  if (!rows.length) return <Body size={12.5} color={S.graphite}>{kind === "item" ? "No items." : "No activities."}</Body>;
  return (
    <View>
      {rows.map((r, i) => {
        const name = kind === "item" ? r.itemName ?? r.ItemName : r.activityName ?? r.ActivityName;
        const code = kind === "item" ? r.itemCode ?? r.ItemCode : r.activityCode ?? r.ActivityCode;
        const forActivity = kind === "item" ? r.activityName ?? r.ActivityName : "";
        const qty = r.quantity ?? r.Quantity ?? "";
        const uom = r.uomName ?? r.UomName ?? "";
        return (
          <View key={i} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: S.ruleSoft, gap: 3 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: fonts.heading.semibold, fontSize: 12.5, color: S.ink }}>{i + 1}. {name || "—"}{code ? `  ${code}` : ""}</Text>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{fmtAmt(amountOf(r))}</Text>
            </View>
            {!!forActivity && <Body size={11.5} color={S.graphite}>For activity: {forActivity}</Body>}
            <Body size={11.5} color={S.graphite}>{qty} {uom} × {fmtAmt(r.rate ?? r.Rate)}</Body>
          </View>
        );
      })}
    </View>
  );
}

export default function BoqDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { id } = useRoute<RouteProp<MainStackParamList, "BoqDetail">>().params;
  const rights = usePageRights("boq");
  const [printing, setPrinting] = useState(false);
  const { data: b, isLoading, isError } = useQuery({ queryKey: ["boq", id], queryFn: () => getBoq(id), staleTime: 60 * 1000 });

  const items: Line[] = Array.isArray(b?.BoqItems) ? (b!.BoqItems as Line[]) : [];
  const activities: Line[] = Array.isArray(b?.BoqActivities) ? (b!.BoqActivities as Line[]) : [];
  const itemTotal = items.reduce((s, r) => s + amountOf(r), 0);
  const activityTotal = activities.reduce((s, r) => s + amountOf(r), 0);

  const print = async () => {
    if (!b) return;
    setPrinting(true);
    try {
      await shareBoqPdf(b);
    } catch (e: any) {
      Alert.alert("Could not make the PDF", e?.message || "Something went wrong.");
    } finally {
      setPrinting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 96 }}>
      <SheetShell
        eyebrow="CivilierERP · Engineering"
        title={b?.BoqNo || b?.DocNo || "Bill of Quantities"}
        subtitle="Bill of Quantities"
        action={
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Key label="Back" icon={<ArrowLeft size={13} color={S.ink} />} onPress={() => navigation.goBack()} />
            {rights.canPrint && (
              <Key tone="ink" label={printing ? "Preparing…" : "Print / PDF"} icon={<Printer size={13} color={S.paper} />} onPress={print} disabled={!b || printing} />
            )}
          </View>
        }
      >
        {isError && <Notice>Could not load this BOQ.</Notice>}
        {isLoading && (
          <>
            <Skel h={90} />
            <Skel h={120} />
          </>
        )}
        {b && (
          <>
            <SheetMark text={b.Status || "Draft"} tone={/draft/i.test(b.Status || "Draft") ? "draft" : statusTone(b.Status || "")} />
            <InfoGrid
              items={[
                { label: "Date", value: fmtDate(b.BoqDate) },
                { label: "Created by", value: b.CreatedBy || "—" },
                { label: "Company", value: b.CompanyName || "—", wide: true },
                { label: "Project", value: b.ProjectName || "—", wide: true },
                { label: "Total", value: <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: S.ink }}>{fmtAmt(Number(b.TotalAmount) || itemTotal + activityTotal)}</Text> },
              ]}
            />
            {!!b.Description && <Body size={13} color={S.ink2}>{b.Description}</Body>}
            <Panel title={`Items (${items.length}) · ${fmtAmt(itemTotal)}`}>
              <LineRows rows={items} kind="item" />
            </Panel>
            <Panel title={`Activities (${activities.length}) · ${fmtAmt(activityTotal)}`}>
              <LineRows rows={activities} kind="activity" />
            </Panel>
          </>
        )}
      </SheetShell>
    </ScrollView>
  );
}
