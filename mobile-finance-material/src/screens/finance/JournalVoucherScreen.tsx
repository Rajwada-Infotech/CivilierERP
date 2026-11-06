// RN port of src/pages/finance/JournalVoucher.tsx, on the drawing sheet as the web draws it: the sheet's title block with
// New voucher (with the create right) and Refresh, the four figures (vouchers, approved, pending, draft), then the
// voucher register — its count, a search box and one ruled row per voucher with Approve / Reject for a Pending one, and
// Edit / Delete with those rights (a Pending voucher isn't edited: that would fight the approval already under way, the
// same rule the web's edit button follows). A row (or its View key) opens the voucher — its journal entry, line by line —
// in JournalVoucherDetailModal. New and Edit open the form as its own page (JournalVoucherFormScreen).
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Check, X, RefreshCw, Trash2, Pencil, Eye } from "lucide-react-native";
import {
  getJournalVouchers, deleteJournalVoucher, approveJournalVoucher, rejectJournalVoucher, type JournalVoucherSummary,
} from "@/api/journalVoucherApi";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { Body, IconKey, Key, Notice, Press, RegisterHead, SearchBox, SheetMark, SheetShell, Skel, StatRow, statusTone } from "@/components/sheet/Sheet";
import { JournalVoucherDetailModal } from "./journalVoucher/JournalVoucherDetailModal";

const fmtINR = (n: number) => `₹${Math.round(n || 0).toLocaleString("en-IN")}`;

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function VoucherRow({
  v, last, onView, onApprove, onReject, acting, onEdit, onDelete,
}: {
  v: JournalVoucherSummary; last: boolean; onView: () => void; onApprove: () => void; onReject: () => void; acting: "approve" | "reject" | null;
  onEdit?: () => void; onDelete?: () => void;
}) {
  return (
    <Press onPress={onView} style={(pressed) => ({ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, gap: 8, backgroundColor: pressed ? S.blueWash : "transparent" })}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, letterSpacing: 0.2, color: S.ink }}>
            {v.JVNo || `JV-${v.JVID}`}
            <Text style={{ color: S.graphite, fontFamily: fonts.body.regular, fontSize: 11.5, letterSpacing: 0 }}>{`  ${fmtDate(v.JVDate)}`}</Text>
          </Text>
          {!!v.CompanyName && (
            <Text numberOfLines={1} style={{ fontFamily: fonts.body.medium, fontSize: 12.5, color: S.ink }}>
              {v.CompanyName}
              {v.ProjectName ? <Text style={{ color: S.graphite, fontFamily: fonts.body.regular }}>{` · ${v.ProjectName}`}</Text> : null}
            </Text>
          )}
        </View>
        <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: S.ink }}>{fmtINR(v.TotalAmount || 0)}</Text>
      </View>

      {!!v.Narration && <Body size={12} color={S.ink2}>{v.Narration}</Body>}

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <View style={{ gap: 5 }}>
          <SheetMark text={v.Status || "Draft"} tone={/draft/i.test(v.Status || "Draft") ? "draft" : statusTone(v.Status)} />
          {v.Status === "Approved" && <SheetMark text={v.PostedToGL ? "Posted to GL" : "Not posted"} tone={v.PostedToGL ? "done" : "stopped"} />}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <IconKey onPress={onView} size={32}>
            <Eye size={14} color={S.ink} />
          </IconKey>
          {v.Status === "Pending" && (
            <>
              <IconKey onPress={onApprove} disabled={!!acting} size={32}>
                <Check size={14} color={S.ink} />
              </IconKey>
              <IconKey onPress={onReject} disabled={!!acting} size={32} red>
                <X size={14} color={S.red} />
              </IconKey>
            </>
          )}
          {v.Status !== "Pending" && onEdit && (
            <IconKey onPress={onEdit} size={32}>
              <Pencil size={14} color={S.ink} />
            </IconKey>
          )}
          {onDelete && (
            <IconKey onPress={onDelete} size={32} red>
              <Trash2 size={14} color={S.red} />
            </IconKey>
          )}
        </View>
      </View>
    </Press>
  );
}

export default function JournalVoucherScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const qc = useQueryClient();
  const rights = usePageRights("journal-voucher");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<{ id: number; action: "approve" | "reject" } | null>(null);
  const [viewingId, setViewingId] = useState<number | null>(null);

  const { data: vouchers = [], isLoading, isError, refetch, isFetching } = useQuery({ queryKey: ["journal-vouchers"], queryFn: getJournalVouchers, staleTime: 30_000 });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteJournalVoucher(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal-vouchers"] }),
    onError: (e: Error) => Alert.alert("Delete failed", e.message),
  });
  const approveMutation = useMutation({
    mutationFn: (id: number) => approveJournalVoucher(id),
    onMutate: (id) => setActing({ id, action: "approve" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal-vouchers"] }),
    onError: (e: Error) => Alert.alert("Approval failed", e.message),
    onSettled: () => setActing(null),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: number) => rejectJournalVoucher(id),
    onMutate: (id) => setActing({ id, action: "reject" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["journal-vouchers"] }),
    onError: (e: Error) => Alert.alert("Rejection failed", e.message),
    onSettled: () => setActing(null),
  });

  const confirmDelete = (v: JournalVoucherSummary) =>
    Alert.alert("Delete Journal Voucher?", `${v.JVNo || `JV-${v.JVID}`} will be deleted. This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(v.JVID) },
    ]);

  const stats = useMemo(
    () => ({
      total: vouchers.length,
      approved: vouchers.filter((v) => v.Status === "Approved").length,
      pending: vouchers.filter((v) => v.Status === "Pending").length,
      draft: vouchers.filter((v) => v.Status === "Draft").length,
    }),
    [vouchers],
  );

  // As the web: JV number, company / project, narration, status or amount.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vouchers;
    return vouchers.filter((v) =>
      [v.JVNo, v.Narration, v.Status, v.CompanyName, v.ProjectName, String(v.TotalAmount ?? "")].some((f) => (f || "").toLowerCase().includes(q)),
    );
  }, [vouchers, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingBottom: 96 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={S.ink} />}
    >
      <SheetShell
        eyebrow="CivilierERP · Finance"
        title="Journal vouchers"
        subtitle="Correct account-head mismatches with balanced multi-line entries"
        action={
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {rights.canCreate && <Key tone="ink" label="New voucher" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("JournalVoucherForm")} />}
            <Key label={isFetching ? "Reading…" : "Refresh"} icon={<RefreshCw size={13} color={S.ink} />} onPress={() => refetch()} disabled={isFetching} />
          </View>
        }
      >
        {!isLoading && (
          <StatRow
            items={[
              { label: "Vouchers", value: String(stats.total), note: "in all" },
              { label: "Approved", value: String(stats.approved), note: "settled" },
              { label: "Pending", value: String(stats.pending), note: "awaiting approval" },
              { label: "Draft", value: String(stats.draft), note: "not yet submitted" },
            ]}
          />
        )}

        {isError && <Notice>Could not load the journal vouchers. Pull down to try again.</Notice>}

        <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>
          <RegisterHead title="Voucher register" count={filtered.length} unit={["voucher", "vouchers"]} />
          <SearchBox value={search} onChange={setSearch} placeholder="Search JV number, account, company, narration or amount…" />
          {isLoading ? (
            <>
              <Skel h={80} />
              <Skel h={80} />
              <Skel h={80} />
            </>
          ) : filtered.length === 0 ? (
            <Body color={S.graphite}>{search ? "No vouchers match your search." : "No journal vouchers yet."}</Body>
          ) : (
            <View>
              {filtered.map((v, i) => (
                <VoucherRow
                  key={v.JVID}
                  v={v}
                  last={i === filtered.length - 1}
                  onView={() => setViewingId(v.JVID)}
                  acting={acting?.id === v.JVID ? acting.action : null}
                  onApprove={() => approveMutation.mutate(v.JVID)}
                  onReject={() => rejectMutation.mutate(v.JVID)}
                  onEdit={rights.canEdit ? () => navigation.navigate("JournalVoucherForm", { id: v.JVID }) : undefined}
                  onDelete={rights.canDelete ? () => confirmDelete(v) : undefined}
                />
              ))}
            </View>
          )}
        </View>
      </SheetShell>

      <JournalVoucherDetailModal
        id={viewingId}
        onClose={() => setViewingId(null)}
        acting={acting && acting.id === viewingId ? acting.action : null}
        onApprove={(id) => approveMutation.mutate(id, { onSuccess: () => setViewingId(null) })}
        onReject={(id) => rejectMutation.mutate(id, { onSuccess: () => setViewingId(null) })}
        onEdit={rights.canEdit ? (id) => { setViewingId(null); navigation.navigate("JournalVoucherForm", { id }); } : undefined}
        onDelete={rights.canDelete ? (jv) => { setViewingId(null); confirmDelete(jv); } : undefined}
      />
    </ScrollView>
  );
}
