// RN port of Issues.tsx's IssueViewOverlay — single scroll, no tabs (web
// has none here either). Deferred vs. web: print.
import { useQuery } from "@tanstack/react-query";
import { View, Text, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, PackageMinus } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { getMaterialIssueById, type MaterialIssue } from "@/api/issuesApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "50%", paddingRight: 8, marginBottom: 12 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function MaterialIssueDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const { data: issue, isLoading } = useQuery<MaterialIssue>({
    queryKey: ["issue-detail", recordId],
    queryFn: () => getMaterialIssueById(recordId!),
    enabled: recordId != null,
  });

  if (recordId == null) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ paddingTop: insets.top + 8 }} className="flex-row items-center justify-between px-4 pb-3">
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: "#f9731626" }}>
              <PackageMinus size={14} color="#f97316" />
            </View>
            <View className="min-w-0">
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Material Issue</Text>
              {!!(issue?.DocNo || issue?.IssueNo) && <Text style={{ color: colors.mutedForeground, fontSize: 10.5 }}>{issue?.DocNo || issue?.IssueNo}</Text>}
            </View>
          </View>
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {isLoading || !issue ? (
          <View className="flex-1 items-center justify-center"><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
            <View className="mb-4">
              <ApprovalStatusChain table="MaterialIssues" recordId={issue.IssueId} />
            </View>

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              <Field label="Company" value={issue.CompanyName || "—"} />
              <Field label="Project" value={issue.ProjectName || "—"} />
              <Field label="Date" value={fmtDate(issue.Date)} />
              <Field label="Godown" value={[issue.GodownName, issue.GodownCode].filter(Boolean).join(" · ") || "—"} />
              {!!issue.IssuedTo && <Field label="Issued To" value={issue.IssuedTo} />}
              {!!issue.CostCenter && <Field label="Cost Center" value={issue.CostCenter} />}
              <Field label="Items" value={`${issue.ItemCount ?? issue.items?.length ?? 0} (${issue.TotalQty ?? 0} units)`} />
            </View>

            <View className="rounded-xl px-3 py-2.5 mb-3" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Reason</Text>
              <Text style={{ color: colors.foreground, fontSize: 12 }}>{issue.Reason || "—"}</Text>
            </View>

            {!!issue.items?.length && (
              <View className="mb-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", marginBottom: 6 }}>
                  Issued Items ({issue.items.length})
                </Text>
                <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                  {issue.items.map((it, i) => (
                    <View key={i} className="px-3 py-2.5" style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: `${colors.border}80` }}>
                      <View className="flex-row items-center justify-between">
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, flex: 1, marginRight: 8 }}>{it.ItemName || "—"}</Text>
                        <Text style={{ color: colors.primary, fontSize: 12, fontFamily: fonts.heading.semibold }}>{it.Quantity} {it.UOMCode}</Text>
                      </View>
                      {it.CurrentBalance != null && (
                        <Text style={{ color: it.CurrentBalance < 0 ? colors.destructive : "#059669", fontSize: 10, marginTop: 2 }}>
                          Balance after: {it.CurrentBalance}
                        </Text>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {!!issue.Remarks && (
              <View className="rounded-xl px-3 py-2.5" style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.muted}30` }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.medium, textTransform: "uppercase", marginBottom: 4 }}>Remarks</Text>
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{issue.Remarks}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
