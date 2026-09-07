// One FA Maintenance & Repair record — detail, GL posting preview, post,
// edit, and delete (Draft cancel / Posted reverse+cancel).
import { useState } from "react";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Check } from "lucide-react-native";
import { formatINR } from "@/utils/formatCurrency";
import { navigate } from "@/navigation/navigationRef";
import { toast } from "@/components/Toast";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PostingPreviewCard } from "@/components/PostingPreviewCard";
import { DetailScaffold, DetailSection, DetailRow, ActionButton } from "@/components/detail/DetailScaffold";
import { usePageRights } from "@/hooks/usePageRights";
import { getMaintenance, postMaintenance, deleteMaintenance } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function MaintenanceDetailScreen() {
  const { id } = useRoute<RouteProp<MainStackParamList, "MaintenanceDetail">>().params;
  const nav = useNavigation();
  const qc = useQueryClient();
  const rights = usePageRights("fixed-asset-maintenance");
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState<null | "post" | "delete">(null);

  const q = useQuery({ queryKey: ["fa-maint", id], queryFn: () => getMaintenance(id) });
  const d = q.data;
  const onRefresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };
  const invalidate = () => qc.invalidateQueries({ queryKey: ["fa-maint"] });

  const postMut = useMutation({
    mutationFn: () => postMaintenance(id),
    onSuccess: (r) => { toast.success(`Posted — ${r.voucherNo}`); setConfirm(null); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setConfirm(null); },
  });
  const delMut = useMutation({
    mutationFn: () => deleteMaintenance(id),
    onSuccess: () => { toast.success(d?.Status === "Posted" ? "Voucher reversed & cancelled" : "Draft cancelled"); setConfirm(null); invalidate(); nav.goBack(); },
    onError: (e: Error) => { toast.error(e.message); setConfirm(null); },
  });

  const entries = (d?.posting?.entries ?? []).map((e) => ({ account: e.account, debit: e.debit, credit: e.credit }));

  return (
    <>
      <DetailScaffold
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        title={d?.DocNo || (d ? `#${d.MaintenanceId}` : "")}
        subtitle={d?.FAItemCode || d?.ItemName || undefined}
        status={d?.Status}
        refreshing={refreshing}
        onRefresh={onRefresh}
        actions={d && (
          <>
            {rights.canEdit && d.Status !== "Cancelled" && d.Status !== "Posted" && (
              <ActionButton label="Post" tone="primary" icon={(p) => <Check {...p} />} onPress={() => setConfirm("post")} />
            )}
            {rights.canEdit && d.Status !== "Cancelled" && (
              <ActionButton label="Edit" icon={(p) => <Pencil {...p} />} onPress={() => navigate("MaintenanceForm", { id })} />
            )}
            {rights.canDelete && d.Status !== "Cancelled" && (
              <ActionButton label={d.Status === "Posted" ? "Reverse" : "Cancel"} tone="danger" icon={(p) => <Trash2 {...p} />} onPress={() => setConfirm("delete")} />
            )}
          </>
        )}
      >
        {d && (
          <>
            <DetailSection title="Repair">
              <DetailRow label="Item" value={d.ItemName} />
              <DetailRow label="FA Item Code" value={d.FAItemCode} />
              <DetailRow label="Vendor" value={d.VendorName} />
              <DetailRow label="Type" value={d.RepairExpenseType === "Direct" ? "Direct Repair" : "Indirect Repair"} />
              <DetailRow label="Remarks" value={d.Remarks} />
            </DetailSection>
            <DetailSection title="Amounts">
              <DetailRow label="Taxable" value={formatINR(d.TaxableAmount ?? d.Amount, { decimals: 2 })} />
              <DetailRow label="GST" value={d.GstRatePct ? `${d.GstRatePct}% · ${formatINR(d.GstAmount ?? 0, { decimals: 2 })}` : "—"} />
              <DetailRow label="SAC" value={d.SacCode} />
              <DetailRow label="Total" value={formatINR(d.TotalAmount ?? d.Amount, { decimals: 2 })} />
              <DetailRow label="Voucher" value={d.VoucherNo} />
            </DetailSection>
            <DetailSection title="Context">
              <DetailRow label="Company" value={d.CompanyName} />
              <DetailRow label="Project" value={d.ProjectName} />
              <DetailRow label="Financial Year" value={d.FinYear} />
              <DetailRow label="Doc Date" value={d.DocDate ? new Date(d.DocDate).toLocaleDateString("en-IN") : null} />
              <DetailRow label="Created By" value={d.CreatedBy} />
            </DetailSection>
            {entries.length > 0 && (
              <PostingPreviewCard
                title={d.posting?.isPosted ? "Posted Journal Entry" : "Posting Preview"}
                entries={entries}
                note={d.posting?.error || undefined}
              />
            )}
          </>
        )}
      </DetailScaffold>
      <ConfirmSheet
        visible={confirm === "post"}
        title="Post this voucher?"
        message="Creates a general-ledger voucher for the repair expense + GST."
        confirmLabel="Post"
        tone="primary"
        loading={postMut.isPending}
        onConfirm={() => postMut.mutate()}
        onClose={() => setConfirm(null)}
      >
        {entries.length > 0 && <PostingPreviewCard entries={entries} />}
      </ConfirmSheet>
      <ConfirmSheet
        visible={confirm === "delete"}
        title={d?.Status === "Posted" ? "Reverse & cancel?" : "Cancel this draft?"}
        message={d?.Status === "Posted" ? "The GL voucher is reversed and the record is cancelled." : "The draft is cancelled."}
        confirmLabel={d?.Status === "Posted" ? "Reverse" : "Cancel Draft"}
        loading={delMut.isPending}
        onConfirm={() => delMut.mutate()}
        onClose={() => setConfirm(null)}
      />
    </>
  );
}
