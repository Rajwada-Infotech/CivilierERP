// FA Inventory — fixed-asset tagging batches (/api/fixed-asset-tagging).
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Trash2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Card, DataList, Line, Pill } from "@/components/list/DataList";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { navigate } from "@/navigation/navigationRef";
import { Fab } from "@/components/Fab";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { toast } from "@/components/Toast";
import { usePageRights } from "@/hooks/usePageRights";
import {
  deletePendingBatch, getFixedAssetTaggings, getPendingBatches, type PendingBatch, type TaggingListItem,
} from "@/api/fixedAssetApi";

const FILTERS = ["All", "Untagged", "Record: Pending", "Record: Done"] as const;

// Received stock waiting for codes comes first, then the tagging entries, as on the web's FA Inventory.
type Row = { kind: "pending"; b: PendingBatch } | { kind: "tag"; t: TaggingListItem };

export default function TaggingScreen() {
  const [filter, setFilter] = useState<string>("All");
  const qc = useQueryClient();
  const rights = usePageRights("fixed-asset-tagging");
  const [removeId, setRemoveId] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["fa-tagging"],
    queryFn: async (): Promise<Row[]> => {
      const [tags, pending] = await Promise.all([getFixedAssetTaggings(), getPendingBatches()]);
      return [...pending.map((b) => ({ kind: "pending" as const, b })), ...tags.map((t) => ({ kind: "tag" as const, t }))];
    },
  });
  useRefetchOnFocus(query.refetch);

  const filtered = useMemo(() => {
    const list = query.data ?? [];
    if (filter === "Untagged") return list.filter((r) => r.kind === "pending");
    if (filter === "Record: Pending") return list.filter((r) => r.kind === "tag" && r.t.RecordStatus === "Pending");
    if (filter === "Record: Done") return list.filter((r) => r.kind === "tag" && r.t.RecordStatus === "Done");
    return list;
  }, [query.data, filter]);

  const removeMut = useMutation({
    mutationFn: (assetId: number) => deletePendingBatch(assetId),
    onSuccess: () => {
      toast.success("Removed from FA Inventory");
      qc.invalidateQueries({ queryKey: ["fa-tagging"] });
      qc.invalidateQueries({ queryKey: ["fa-dashboard"] });
      setRemoveId(null);
    },
    onError: (e: Error) => { toast.error(e.message); setRemoveId(null); },
  });

  const tagBatch = (b: PendingBatch) =>
    navigate("TaggingForm", {
      prefill: {
        companyId: String(b.CompanyId ?? ""), projectId: String(b.ProjectId ?? ""), godownId: String(b.GodownId ?? ""),
        itemId: b.SourceItemId ?? "", numberOfItems: String(b.Quantity ?? ""),
      },
    });

  const renderPending = (b: PendingBatch) => (
    <Card>
      <View className="flex-row items-center justify-between">
        <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{b.SourceDocNo || `#${b.AssetId}`}</Text>
        <Pill label="Untagged" tone={b.Reason === "NO_TEMPLATE" ? "#ef4444" : "#f59e0b"} />
      </View>
      <Line>{b.AssetName || "—"} · Qty {b.Quantity}</Line>
      <Line>{b.SourceType === "GRN" ? "Received by GRN" : "Imported, no GRN"}{b.GodownName ? ` · ${b.GodownName}` : ""}</Line>
      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 4 }}>
        {b.Reason === "NO_TEMPLATE"
          ? `${b.ProjectName || "This project"} has no ID template: add one in ID Template Master on the web and these units tag themselves.`
          : "Ready to tag."}
      </Text>
      <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
        <Text numberOfLines={1} style={{ flex: 1, color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
          {b.CompanyName || "—"}{b.ProjectName ? ` · ${b.ProjectName}` : ""}
        </Text>
        <View className="flex-row items-center" style={{ gap: 14 }}>
          {rights.canCreate && b.Reason === "READY" && (
            <Pressable onPress={() => tagBatch(b)} hitSlop={6} className="flex-row items-center" style={{ gap: 4 }}>
              <Hash size={13} color="#eab308" />
              <Text style={{ color: "#eab308", fontSize: 12, fontFamily: fonts.heading.bold }}>Tag</Text>
            </Pressable>
          )}
          {rights.canDelete && b.SourceType === "GRN" && (
            <Pressable onPress={() => setRemoveId(b.AssetId)} hitSlop={8}><Trash2 size={14} color={colors.destructive} /></Pressable>
          )}
        </View>
      </View>
    </Card>
  );

  return (
    <>
    <DataList<Row>
      query={query}
      items={filtered}
      keyOf={(r) => (r.kind === "pending" ? `p${r.b.AssetId}` : `t${r.t.TagId}`)}
      footer={rights.canCreate ? <Fab label="Tag Items" onPress={() => navigate("TaggingForm")} /> : null}
      filters={FILTERS}
      activeFilter={filter}
      onFilter={setFilter}
      emptyText="No FA inventory tagging entries."
      renderCard={(row) => row.kind === "pending" ? renderPending(row.b) : renderTag(row.t)}
    />
    <ConfirmSheet
      visible={removeId != null}
      title="Remove this received stock?"
      message="It is removed from FA Inventory for good. The GRN itself is not changed."
      confirmLabel="Remove"
      loading={removeMut.isPending}
      onConfirm={() => removeId != null && removeMut.mutate(removeId)}
      onClose={() => setRemoveId(null)}
    />
    </>
  );

  function renderTag(item: TaggingListItem) {
    return (
        <Pressable onPress={() => navigate("TaggingDetail", { id: item.TagId })}>
        <Card>
          <View className="flex-row items-center justify-between">
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>
              {item.DocNo || `#${item.TagId}`}
            </Text>
            <View className="flex-row items-center gap-1.5">
              {item.RecordStatus && <Pill label={item.RecordStatus} />}
              <Pill label={item.Status} />
            </View>
          </View>
          <Line>{item.AssetName || "—"}{item.AssetCategory ? ` · ${item.AssetCategory}` : ""}</Line>
          {item.FAItemCode ? (
            <View
              style={{
                alignSelf: "flex-start",
                marginTop: 6,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 7,
                backgroundColor: "rgba(234,179,8,0.14)",
                borderWidth: 1,
                borderColor: "rgba(234,179,8,0.35)",
              }}
            >
              <Text style={{ color: "#fde047", fontSize: 11, fontFamily: fonts.heading.bold, letterSpacing: 0.2 }}>
                {item.FAItemCode}
              </Text>
            </View>
          ) : null}
          <Line>{item.GodownName || "no godown"}</Line>
          <Line>
            Record: {item.RecordStatus ?? "—"}
            {item.RecordStatus === "Done" ? " (Fixed Asset Record created)" : item.RecordStatus === "Pending" ? " (awaiting record)" : ""}
          </Line>
          <View className="flex-row items-center justify-between" style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
              {item.CompanyName || "—"}{item.ProjectName ? ` · ${item.ProjectName}` : ""}
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>
              Qty {item.TaggedQty}
            </Text>
          </View>
        </Card>
        </Pressable>
    );
  }
}
