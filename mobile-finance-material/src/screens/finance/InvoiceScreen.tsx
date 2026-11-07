// RN port of src/pages/material/MaterialExpenseBooking.tsx's list view, on the drawing sheet as the web draws it: the
// sheet's title block with "New invoice", the four figures (ExpenseBookingStatCards), then the booking register — its
// heading and count, a search box, the status keys (BookingListToolbar) and one ruled row per booking (RecordCard)
// with its approval status and the View / Edit / Delete keys (Edit and Delete only with those rights on
// expense-booking, as on the web). Delete runs the same can-delete gate as web (canDeleteInvoice(); if blocked, an
// alert with the reason — EMI / debit note / BRS-cleared / has payments — in place of web's DeleteBlockedDialog).
import { useMemo, useState } from "react";
import { View, Text, ScrollView, RefreshControl, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Plus, Eye, Pencil, Trash2 } from "lucide-react-native";
import { fetchInvoices, canDeleteInvoice, deleteInvoice, type InvoiceRecord } from "@/api/invoiceApi";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { usePageRights } from "@/hooks/usePageRights";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { Body, IconKey, Key, Label, Notice, Press, RegisterHead, SearchBox, Seg, SheetMark, SheetShell, Skel, StatRow, statusTone } from "@/components/sheet/Sheet";
import type { MainStackParamList } from "@/navigation/MainStack";

const ALL_STATUSES = ["All", "Pending", "Approved", "Rejected"] as const;

function fmt(n: number) {
  return Math.round(n || 0).toLocaleString("en-IN");
}

/** A booking's own status as the sheet marks it (Draft is an empty square). */
function StatusMark({ status }: { status: string }) {
  const st = status || "Draft";
  return <SheetMark text={st} tone={/draft/i.test(st) ? "draft" : /hold/i.test(st) ? "waiting" : /booked|received/i.test(st) ? "done" : statusTone(st)} />;
}

function RecordRow({ rec, last, onPreview, onEdit, onDelete }: { rec: InvoiceRecord; last: boolean; onPreview: () => void; onEdit?: () => void; onDelete?: () => void }) {
  const net = rec.netAmount ?? rec.basicAmount * (1 + (rec.cgstRate + rec.sgstRate) / 100);
  const facts = [
    `Date ${rec.bookingDate || "—"}`,
    `Due ${rec.dueDate || "—"}`,
    `Basic ₹${fmt(rec.basicAmount)}`,
    rec.emi?.enabled ? `${rec.emi.installmentCount}× EMI` : `GST ${rec.cgstRate + rec.sgstRate}%`,
  ];
  return (
    <Press
      onPress={onPreview}
      style={(pressed) => ({ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: S.ruleSoft, backgroundColor: pressed ? S.blueWash : "transparent" })}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Label>{rec.docTypeName || rec.materialCategory || "Invoice"}</Label>
          <Text numberOfLines={1} style={{ fontFamily: fonts.heading.semibold, fontSize: 13, letterSpacing: 0.2, color: S.ink }}>{rec.bookingReference || "—"}</Text>
          {!!rec.supplier && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.ink2 }}>{rec.supplier}</Text>}
          {!!rec.companyName && <Text numberOfLines={1} style={{ fontFamily: fonts.body.regular, fontSize: 11.5, color: S.graphite }}>{rec.companyName}</Text>}
        </View>
        <ApprovalStatusChain table="ExpenseBooking" recordId={rec.id} fallback={<StatusMark status={rec.status} />} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 2, marginTop: 8 }}>
        {facts.map((f) => (
          <Body key={f} size={11.5} color={S.graphite}>{f}</Body>
        ))}
      </View>

      <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: 10 }}>
        <View>
          <Label>Net payable</Label>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 16, letterSpacing: -0.3, color: S.ink, marginTop: 3 }}>₹{fmt(net)}</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <IconKey onPress={onPreview} size={32}>
            <Eye size={14} color={S.ink} />
          </IconKey>
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
        </View>
      </View>
    </Press>
  );
}

function blockReasonMessage(result: Exclude<Awaited<ReturnType<typeof canDeleteInvoice>>, { deletable: true }>): string {
  if (result.reason === "brs_cleared") {
    const list = (result.clearedPayments ?? []).map((p) => `• ${p.paymentName || `Payment #${p.paymentId}`} — ₹${Number(p.amount).toLocaleString("en-IN")}`).join("\n");
    return `This booking has payments cleared in BRS. To delete it: 1) mark the payment Uncleared in BRS, 2) delete the payment, 3) return here.${list ? `\n\n${list}` : ""}`;
  }
  if (result.reason === "has_payments") {
    const list = (result.linkedPayments ?? []).map((p) => `• ${p.paymentName || `Payment #${p.paymentId}`} — ₹${Number(p.amount).toLocaleString("en-IN")}`).join("\n");
    return `This booking has linked payment records. Delete the payment(s) first.${list ? `\n\n${list}` : ""}`;
  }
  if (result.reason === "debit_note") return "This booking has linked Debit Notes. Please delete or unlink them first.";
  return typeof result.reason === "string" && result.reason ? result.reason : "This booking cannot be deleted.";
}

export default function InvoiceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const queryClient = useQueryClient();
  const rights = usePageRights("expense-booking");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["invoices", page, statusFilter],
    queryFn: () => fetchInvoices(page, statusFilter),
    staleTime: 60 * 1000,
  });

  const requestDelete = async (rec: InvoiceRecord) => {
    let result;
    try {
      result = await canDeleteInvoice(rec.id);
    } catch (err: any) {
      Alert.alert("Couldn't check", err.message ?? "Could not verify whether this booking can be deleted.");
      return;
    }
    if (!result.deletable) {
      Alert.alert("Cannot Delete Booking", blockReasonMessage(result));
      return;
    }
    Alert.alert("Delete Booking", "Are you sure you want to delete this expense booking? This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteInvoice(rec.id);
            queryClient.invalidateQueries({ queryKey: ["invoices"], exact: false });
          } catch (err: any) {
            Alert.alert("Delete failed", err.message ?? "Failed to delete booking.");
          }
        },
      },
    ]);
  };

  const filtered = useMemo(() => {
    const rows = data?.data ?? [];
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter((r) => r.bookingReference.toLowerCase().includes(q) || r.supplier.toLowerCase().includes(q) || r.companyName.toLowerCase().includes(q));
  }, [data, search]);

  const totalNet = (data?.data ?? []).reduce((s, r) => s + (r.netAmount ?? r.basicAmount), 0);
  const approvedCount = data?.statusCounts?.Approved ?? (data?.data ?? []).filter((r) => r.status === "Approved").length;
  const pendingCount = data?.statusCounts?.Pending ?? (data?.data ?? []).filter((r) => r.status === "Pending").length;
  const emiCount = (data?.data ?? []).filter((r) => r.emi?.enabled).length;

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
        title="Invoices"
        subtitle="Book expenses against purchase orders, confirmed work done, or invoice documents"
        action={
          rights.canCreate ? (
            <Key tone="ink" label="New invoice" icon={<Plus size={13} color={S.paper} />} onPress={() => navigation.navigate("NewInvoice")} style={{ alignSelf: "flex-start" }} />
          ) : undefined
        }
      >
        {!isLoading && (
          <StatRow
            items={[
              { label: "Total booked", value: `₹${fmt(totalNet)}`, note: "net, on this page of the list" },
              { label: "Approved", value: approvedCount.toLocaleString("en-IN"), note: "in all" },
              { label: "Pending", value: pendingCount.toLocaleString("en-IN"), note: "awaiting approval, in all" },
              { label: "On EMI", value: emiCount.toLocaleString("en-IN"), note: "on this page of the list" },
            ]}
          />
        )}

        {isError && <Notice>Could not load the invoices. Pull down to try again.</Notice>}

        <View style={{ borderWidth: 1, borderColor: S.ink, padding: 12, gap: 12 }}>
          <RegisterHead title="Booking register" count={data?.total ?? 0} />
          <SearchBox value={search} onChange={setSearch} placeholder="Search doc no, supplier…" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Seg
              options={ALL_STATUSES.map((st) => ({ value: st, label: st }))}
              value={statusFilter as (typeof ALL_STATUSES)[number]}
              onChange={(st) => {
                setStatusFilter(st);
                setPage(1);
              }}
            />
          </ScrollView>

          {isLoading ? (
            <>
              <Skel h={80} />
              <Skel h={80} />
              <Skel h={80} />
            </>
          ) : filtered.length === 0 ? (
            <Body color={S.graphite}>{search ? "No invoice matches that search." : "No invoices found."}</Body>
          ) : (
            <View>
              {filtered.map((rec, i) => (
                <RecordRow
                  key={rec.id}
                  rec={rec}
                  last={i === filtered.length - 1}
                  onPreview={() => navigation.navigate("InvoicePreview", { id: rec.id })}
                  onEdit={rights.canEdit ? () => navigation.navigate("NewInvoice", { id: rec.id }) : undefined}
                  onDelete={rights.canDelete ? () => requestDelete(rec) : undefined}
                />
              ))}
            </View>
          )}

          {data && data.totalPages > 1 && (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: S.ink }}>
              <Key label="Previous" onPress={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={{ minHeight: 36, paddingHorizontal: 12 }} />
              <Label>{`Page ${page} of ${data.totalPages}`}</Label>
              <Key label="Next" onPress={() => setPage((p) => Math.min(data.totalPages, p + 1))} disabled={page >= data.totalPages} style={{ minHeight: 36, paddingHorizontal: 12 }} />
            </View>
          )}
        </View>
      </SheetShell>
    </ScrollView>
  );
}
