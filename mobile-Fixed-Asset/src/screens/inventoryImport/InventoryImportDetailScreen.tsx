// One Inventory Import — detail + reverse (cascades the same way as Fixed
// Asset Record's Delete & Reverse GRN).
import { useState } from "react";
import { View, Text } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Undo2 } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { toast } from "@/components/Toast";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { DetailScaffold, DetailSection, DetailRow, ActionButton } from "@/components/detail/DetailScaffold";
import { usePageRights } from "@/hooks/usePageRights";
import { getInventoryImport, getInventoryImportReversalPlan, reverseInventoryImport } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function InventoryImportDetailScreen() {
  const { id } = useRoute<RouteProp<MainStackParamList, "InventoryImportDetail">>().params;
  const nav = useNavigation();
  const qc = useQueryClient();
  const rights = usePageRights("fixed-asset-inventory-import");
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const q = useQuery({ queryKey: ["fa-inv-import", id], queryFn: () => getInventoryImport(id) });
  const planQ = useQuery({
    queryKey: ["fa-inv-import-plan", id],
    queryFn: () => getInventoryImportReversalPlan(id),
    enabled: !!q.data && q.data.Status === "Active" && rights.canDelete,
  });
  const d = q.data;

  const onRefresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };

  const revMut = useMutation({
    mutationFn: () => reverseInventoryImport(id),
    onSuccess: () => {
      toast.success("Import reversed");
      qc.invalidateQueries({ queryKey: ["fa-inv-import"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      qc.invalidateQueries({ queryKey: ["fa-tagging"] });
      setConfirm(false);
      nav.goBack();
    },
    onError: (e: Error) => { toast.error(e.message); setConfirm(false); },
  });

  return (
    <>
      <DetailScaffold
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        title={d?.DocNo || (d ? `#${d.ImportId}` : "")}
        subtitle={d?.ResolvedItemName || d?.ItemName || undefined}
        status={d?.Status}
        refreshing={refreshing}
        onRefresh={onRefresh}
        actions={d && rights.canDelete && d.Status === "Active" && planQ.data?.reversible && (
          <ActionButton label="Reverse Import" tone="danger" icon={(p) => <Undo2 {...p} />} onPress={() => setConfirm(true)} />
        )}
      >
        {d && (
          <>
            <DetailSection title="Import">
              <DetailRow label="Item" value={d.ResolvedItemName || d.ItemName} />
              <DetailRow label="Category" value={d.AssetCategory} />
              <DetailRow label="Quantity" value={String(d.Quantity)} />
              <DetailRow label="Rate" value={d.Rate != null ? formatINR(d.Rate, { decimals: 2 }) : null} />
              <DetailRow label="Purchase Cost" value={d.Rate != null ? formatINR(d.Rate * d.Quantity, { decimals: 2 }) : null} />
            </DetailSection>
            <DetailSection title="Context">
              <DetailRow label="Company" value={d.CompanyName} />
              <DetailRow label="Project" value={d.ProjectName} />
              <DetailRow label="Godown" value={d.GodownName} />
              <DetailRow label="Doc Date" value={d.DocDate ? new Date(d.DocDate).toLocaleDateString("en-IN") : null} />
              <DetailRow label="Created By" value={d.CreatedBy} />
              <DetailRow label="Remarks" value={d.Remarks} />
            </DetailSection>
          </>
        )}
      </DetailScaffold>
      <ConfirmSheet
        visible={confirm}
        title="Reverse this import?"
        message={planQ.data?.message || "Removes the linked asset, its tags, and the stock-ledger entry."}
        confirmLabel="Reverse"
        loading={revMut.isPending}
        onConfirm={() => revMut.mutate()}
        onClose={() => setConfirm(false)}
      >
        {planQ.data?.units && planQ.data.units.length > 0 && (
          <View style={{ backgroundColor: `${colors.muted}80`, borderRadius: 10, padding: 10 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
              {planQ.data.units.length} unit(s) will be removed
            </Text>
          </View>
        )}
      </ConfirmSheet>
    </>
  );
}
