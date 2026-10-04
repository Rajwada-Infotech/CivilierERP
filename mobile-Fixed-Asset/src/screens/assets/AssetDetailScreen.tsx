// One Fixed Asset — full detail, depreciation posting, and the edit /
// delete / reverse actions. Mobile port of the web FixedAssetRecord detail
// view + DepreciationPostingCard.
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Pencil, Trash2, Undo2, ChevronDown } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { calcDepreciation } from "@/utils/depreciation";
import { navigate } from "@/navigation/navigationRef";
import { toast } from "@/components/Toast";
import { StatusPill } from "@/components/StatusPill";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { PostingPreviewCard } from "@/components/PostingPreviewCard";
import { OptionPickerModal } from "@/components/OptionPicker";
import { usePageRights } from "@/hooks/usePageRights";
import {
  getFixedAsset, getAssetDepreciation, postAssetDepreciation, reverseAssetDepreciation,
  deleteFixedAsset, getFixedAssetReversalPlan, reverseFixedAsset,
} from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#eab308";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <View className="flex-row justify-between py-1.5" style={{ borderBottomWidth: 1, borderBottomColor: `${colors.border}80` }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium, maxWidth: "60%", textAlign: "right" }}>{value}</Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flexGrow: 1, minWidth: "45%", backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 }}>
      <Text style={{ color: color || colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>{value}</Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

export default function AssetDetailScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "AssetDetail">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const { id } = route.params;
  const rights = usePageRights("fixed-asset-record");
  const [refreshing, setRefreshing] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "reverse">(null);

  const assetQ = useQuery({ queryKey: ["fa-asset", id], queryFn: () => getFixedAsset(id) });
  const reversalQ = useQuery({
    queryKey: ["fa-reversal-plan", id],
    queryFn: () => getFixedAssetReversalPlan(id),
    enabled: !!assetQ.data && rights.canDelete,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([assetQ.refetch(), qc.invalidateQueries({ queryKey: ["fa-asset-dep", id] })]);
    setRefreshing(false);
  };

  const a = assetQ.data;
  const dc = a && a.PurchaseDate && a.DepreciationRate
    ? calcDepreciation(a.PurchaseCost, a.DepreciationRate, a.PurchaseDate) : null;

  const delMut = useMutation({
    mutationFn: () => deleteFixedAsset(id),
    onSuccess: () => {
      toast.success("Asset deleted");
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      qc.invalidateQueries({ queryKey: ["fa-unassigned-codes"] });
      setConfirm(null);
      nav.goBack();
    },
    onError: (e: Error) => { toast.error(e.message); setConfirm(null); },
  });

  const revMut = useMutation({
    mutationFn: () => reverseFixedAsset(id),
    onSuccess: (r) => {
      toast.success(r.grnDeleted ? "Reversed — GRN & inventory removed" : "Reversed — inventory removed");
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      qc.invalidateQueries({ queryKey: ["fa-tagging"] });
      setConfirm(null);
      nav.goBack();
    },
    onError: (e: Error) => { toast.error(e.message); setConfirm(null); },
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
      >
        {assetQ.isLoading ? (
          <View style={{ paddingVertical: 60, alignItems: "center" }}><ActivityIndicator color={colors.mutedForeground} /></View>
        ) : assetQ.error ? (
          <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.body.regular }}>{(assetQ.error as Error).message}</Text>
        ) : a ? (
          <>
            <Text style={{ color: colors.foreground, fontSize: 18, fontFamily: fonts.heading.bold }}>{a.AssetName}</Text>
            <View className="flex-row items-center gap-2" style={{ marginTop: 4 }}>
              <Text style={{ color: ACCENT, fontSize: 12, fontFamily: fonts.body.medium }}>
                {a.AssetCode || "—"} · {a.AssetCategory}
              </Text>
              <StatusPill label={a.AssetStatus} />
            </View>

            <View className="flex-row gap-2" style={{ marginTop: 14 }}>
              {rights.canEdit && (
                <Pressable
                  onPress={() => navigate("AssetForm", { id })}
                  className="flex-row items-center gap-1.5"
                  style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, backgroundColor: ACCENT }}
                >
                  <Pencil size={13} color="#1a1a1a" />
                  <Text style={{ color: "#1a1a1a", fontSize: 12, fontFamily: fonts.heading.bold }}>Edit</Text>
                </Pressable>
              )}
              {rights.canDelete && (
                <Pressable
                  onPress={() => setConfirm("delete")}
                  className="flex-row items-center gap-1.5"
                  style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}
                >
                  <Trash2 size={13} color={colors.destructive} />
                  <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.heading.semibold }}>Delete</Text>
                </Pressable>
              )}
              {rights.canDelete && reversalQ.data?.reversible && (
                <Pressable
                  onPress={() => setConfirm("reverse")}
                  className="flex-row items-center gap-1.5"
                  style={{ paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: `${colors.destructive}66` }}
                >
                  <Undo2 size={13} color={colors.destructive} />
                  <Text style={{ color: colors.destructive, fontSize: 12, fontFamily: fonts.heading.semibold }}>Reverse GRN</Text>
                </Pressable>
              )}
            </View>

            <View className="flex-row flex-wrap gap-2" style={{ marginTop: 16 }}>
              <Stat label="Purchase Cost" value={formatINR(a.PurchaseCost, { decimals: 2 })} />
              <Stat label="Current Book Value" value={dc ? formatINR(dc.bookValue, { decimals: 2 }) : "—"} color={ACCENT} />
              {dc && <Stat label="Annual Depreciation" value={formatINR(dc.annualDep, { decimals: 2 })} />}
              {dc && <Stat label="Total Depreciation" value={formatINR(dc.totalDep, { decimals: 2 })} color="#f59e0b" />}
            </View>

            <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 16 }}>
              <Row label="FA Item Code" value={a.FAItemCode} />
              <Row label="Type of Repairs (SAC)" value={a.RepairType} />
              <Row label="Brand / Model" value={[a.Brand, a.Model].filter(Boolean).join(" ") || null} />
              <Row label="Serial Number" value={a.SerialNumber} />
              <Row label="Company" value={a.CompanyName} />
              <Row label="Project" value={a.ProjectName} />
              <Row label="Financial Year" value={a.FinYear} />
              <Row label="Supplier" value={a.SupplierName} />
              <Row label="Invoice Ref" value={a.PurchaseInvoiceRef} />
              <Row label="Purchase Date" value={a.PurchaseDate ? new Date(a.PurchaseDate).toLocaleDateString("en-IN") : null} />
              <Row label="Activation Date" value={a.ActivationDate ? new Date(a.ActivationDate).toLocaleDateString("en-IN") : null} />
              <Row label="Depreciation" value={a.DepreciationRate ? `${a.DepreciationType || "SLM"} · ${a.DepreciationRate}% p.a.` : null} />
              <Row label="Useful Life" value={a.UsefulLife ? `${a.UsefulLife} years` : null} />
              <Row label="Custodian" value={a.Custodian} />
              <Row label="Location" value={a.Location} />
              <Row label="Quantity" value={a.Quantity != null ? String(a.Quantity) : null} />
            </View>

            {a.AssetStatus === "Sold" && (
              <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 12 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.bold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>Sale Information</Text>
                <Row label="Selling Price" value={a.SellingPrice != null ? formatINR(a.SellingPrice, { decimals: 2 }) : null} />
                <Row label="Sale Date" value={a.SaleDate ? new Date(a.SaleDate).toLocaleDateString("en-IN") : null} />
                <Row label="Buyer" value={a.BuyerName} />
                <Row label="Sale Remarks" value={a.SaleRemarks} />
              </View>
            )}

            <DepreciationPostingCard assetId={id} canPost={rights.canEdit} />
          </>
        ) : null}
      </ScrollView>

      <ConfirmSheet
        visible={confirm === "delete"}
        title="Delete this asset?"
        message="The record is soft-deleted and its FA Item Code becomes available again. Depreciation and tagging history are kept."
        confirmLabel="Delete"
        loading={delMut.isPending}
        onConfirm={() => delMut.mutate()}
        onClose={() => setConfirm(null)}
      />
      <ConfirmSheet
        visible={confirm === "reverse"}
        title="Delete & Reverse GRN?"
        message={reversalQ.data?.message}
        confirmLabel="Reverse"
        loading={revMut.isPending}
        onConfirm={() => revMut.mutate()}
        onClose={() => setConfirm(null)}
      >
        {reversalQ.data?.units && reversalQ.data.units.length > 0 && (
          <View style={{ backgroundColor: `${colors.muted}80`, borderRadius: 10, padding: 10 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, marginBottom: 4 }}>
              {reversalQ.data.units.length} unit(s) will be removed
            </Text>
            {reversalQ.data.units.slice(0, 8).map((u) => (
              <Text key={u.assetId} style={{ color: colors.foreground, fontSize: 11, fontFamily: fonts.body.regular }}>
                {u.faItemCode || u.assetName}
              </Text>
            ))}
          </View>
        )}
      </ConfirmSheet>
    </View>
  );
}

// ── Monthly depreciation posting ────────────────────────────────────────────
function DepreciationPostingCard({ assetId, canPost }: { assetId: number; canPost: boolean }) {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [picker, setPicker] = useState<null | "month" | "year">(null);
  const [confirmPost, setConfirmPost] = useState(false);

  const depQ = useQuery({
    queryKey: ["fa-asset-dep", assetId, year, month],
    queryFn: () => getAssetDepreciation(assetId, year, month),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["fa-asset-dep", assetId] });
    qc.invalidateQueries({ queryKey: ["fa-asset", assetId] });
    qc.invalidateQueries({ queryKey: ["fa-assets"] });
  };

  const postMut = useMutation({
    mutationFn: () => postAssetDepreciation(assetId, year, month),
    onSuccess: (r) => { toast.success(`Depreciation posted — ${r.voucherNo}`); setConfirmPost(false); invalidate(); },
    onError: (e: Error) => { toast.error(e.message); setConfirmPost(false); },
  });
  const reverseMut = useMutation({
    mutationFn: (entryId: number) => reverseAssetDepreciation(assetId, entryId),
    onSuccess: () => { toast.success("Depreciation entry reversed"); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = depQ.data?.plan ?? null;
  const dep = plan?.depreciation;
  const history = (depQ.data?.history ?? []).filter((h) => h.Status !== "Reversed");
  const yearOpts = Array.from({ length: 7 }, (_, i) => now.getFullYear() - 4 + i);

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginTop: 16 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.heading.bold, letterSpacing: 1, textTransform: "uppercase" }}>
        Depreciation Posting
      </Text>
      <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 4 }}>
        Dr Depreciation Expense · Cr Accumulated Depreciation — one entry per month.
      </Text>

      <View className="flex-row gap-2" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <Pressable onPress={() => setPicker("month")} className="flex-row items-center gap-1.5"
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{MONTHS[month - 1]}</Text>
          <ChevronDown size={12} color={colors.mutedForeground} />
        </Pressable>
        <Pressable onPress={() => setPicker("year")} className="flex-row items-center gap-1.5"
          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{year}</Text>
          <ChevronDown size={12} color={colors.mutedForeground} />
        </Pressable>
        {canPost && plan && !plan.error && !plan.isPosted && (
          <Pressable onPress={() => setConfirmPost(true)}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: ACCENT }}>
            <Text style={{ color: "#1a1a1a", fontSize: 12, fontFamily: fonts.heading.bold }}>Post</Text>
          </Pressable>
        )}
      </View>

      {depQ.isLoading ? (
        <ActivityIndicator color={colors.mutedForeground} style={{ marginTop: 12 }} />
      ) : plan?.error ? (
        <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 12 }}>{plan.error}</Text>
      ) : dep ? (
        <View style={{ marginTop: 12 }}>
          <PostingPreviewCard
            title={`${MONTHS[month - 1]} ${year}`}
            entries={(plan?.entries ?? []).map((e) => ({ account: e.account, debit: e.debit, credit: e.credit }))}
            figures={[
              { label: "Opening BV", value: formatINR(dep.openingBookValue, { decimals: 2 }) },
              { label: `Dep. (${dep.ratePct}% ${dep.method})`, value: formatINR(dep.depreciationAmount, { decimals: 2 }) },
              { label: "Closing BV", value: formatINR(dep.closingBookValue, { decimals: 2 }) },
              { label: "Accumulated", value: formatINR(dep.accumulatedDepreciation, { decimals: 2 }) },
            ]}
            note={plan?.isPosted ? `Already posted${plan.voucherRef ? ` · ${plan.voucherRef}` : ""}.` : undefined}
          />
        </View>
      ) : null}

      {history.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.bold, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
            Posted History
          </Text>
          {history.map((h) => (
            <View key={h.EntryId} className="flex-row items-center justify-between" style={{ paddingVertical: 7, borderTopWidth: 1, borderTopColor: `${colors.border}80` }}>
              <View>
                <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{MONTHS[h.PeriodMonth - 1]} {h.PeriodYear}</Text>
                <Text style={{ color: "#5c6270", fontSize: 10, fontFamily: fonts.body.regular }}>{h.VoucherNo || "—"}</Text>
              </View>
              <View className="flex-row items-center gap-3">
                <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.semibold }}>{formatINR(h.DepreciationAmount, { decimals: 2 })}</Text>
                {canPost && (
                  <Pressable onPress={() => reverseMut.mutate(h.EntryId)} hitSlop={6} disabled={reverseMut.isPending}>
                    <Undo2 size={13} color={colors.destructive} />
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      <OptionPickerModal
        visible={picker === "month"} title="Month" searchable={false}
        options={MONTHS.map((m, i) => ({ key: String(i + 1), label: m }))}
        selectedKey={String(month)}
        onSelect={(k) => { setMonth(Number(k)); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionPickerModal
        visible={picker === "year"} title="Year" searchable={false}
        options={yearOpts.map((y) => ({ key: String(y), label: String(y) }))}
        selectedKey={String(year)}
        onSelect={(k) => { setYear(Number(k)); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <ConfirmSheet
        visible={confirmPost}
        title={`Post depreciation — ${MONTHS[month - 1]} ${year}?`}
        message="This creates a general-ledger voucher. It can be reversed from the posted history."
        confirmLabel="Post"
        tone="primary"
        loading={postMut.isPending}
        onConfirm={() => postMut.mutate()}
        onClose={() => setConfirmPost(false)}
      >
        {dep && (
          <PostingPreviewCard
            title={`${MONTHS[month - 1]} ${year}`}
            entries={(plan?.entries ?? []).map((e) => ({ account: e.account, debit: e.debit, credit: e.credit }))}
          />
        )}
      </ConfirmSheet>
    </View>
  );
}
