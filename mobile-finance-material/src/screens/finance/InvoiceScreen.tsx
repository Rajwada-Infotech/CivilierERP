// RN port of src/pages/material/MaterialExpenseBooking.tsx's list view (the
// "Booking Register") — stat cards (ExpenseBookingStatCards), search +
// status filter chips (BookingListToolbar), and a card per record
// (RecordCard), collapsed to a single column the way the web page's own
// grid collapses on a phone. "New Invoice" opens NewInvoiceScreen (PO /
// Work Done / GRN / Other Expense sources, plus Edit). Delete runs the
// same can-delete gate as web (requestDelete → canDeleteInvoice(), and if
// blocked, an alert summarizing the reason — EMI/debit-note/BRS-cleared/
// has-payments — instead of web's itemized DeleteBlockedDialog).
import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Alert } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  Receipt, CheckCircle2, Clock, CreditCard, Search, X, Plus, Eye, Pencil, Trash2, RefreshCw,
} from "lucide-react-native";
import { fetchInvoices, canDeleteInvoice, deleteInvoice, type InvoiceRecord } from "@/api/invoiceApi";
import { colors, moduleAccents } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { SectionLabel } from "@/components/home/SectionLabel";
import type { MainStackParamList } from "@/navigation/MainStack";

const FINANCE = moduleAccents.finance;
const ALL_STATUSES = ["All", "Pending", "Approved", "Rejected"];

const STATUS_STYLE: Record<string, { bg: string; fg: string; icon: React.ComponentType<{ size?: number; color?: string }> }> = {
  Draft: { bg: "#64748b", fg: "#94a3b8", icon: Clock },
  Pending: { bg: "#f59e0b", fg: "#f59e0b", icon: Clock },
  Approved: { bg: "#10b981", fg: "#10b981", icon: CheckCircle2 },
  Rejected: { bg: "#ef4444", fg: "#ef4444", icon: X },
  Booked: { bg: "#3b82f6", fg: "#3b82f6", icon: CheckCircle2 },
  Hold: { bg: "#eab308", fg: "#eab308", icon: Clock },
  Received: { bg: "#14b8a6", fg: "#14b8a6", icon: CheckCircle2 },
};

function fmt(n: number) {
  return Math.round(n || 0).toLocaleString("en-IN");
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { bg: colors.mutedForeground, fg: colors.mutedForeground, icon: Clock };
  const Icon = s.icon;
  return (
    <View className="flex-row items-center gap-1 px-2 py-1 rounded-md" style={{ backgroundColor: `${s.bg}22`, borderWidth: 1, borderColor: `${s.bg}40` }}>
      <Icon size={10} color={s.fg} />
      <Text style={{ color: s.fg, fontSize: 10, fontFamily: fonts.heading.semibold }}>{status}</Text>
    </View>
  );
}

function StatTile({ label, value, icon: Icon, accent }: { label: string; value: string | number; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string }) {
  return (
    <View
      style={{ width: "48%", marginBottom: 10 }}
      className="rounded-xl overflow-hidden"
    >
      <View
        className="flex-row items-center gap-2.5 px-3.5 py-3"
        style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80`, borderLeftWidth: 3, borderLeftColor: accent }}
      >
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${accent}26`, borderWidth: 1, borderColor: `${accent}4d` }}>
          <Icon size={14} color={accent} />
        </View>
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{label}</Text>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 15, marginTop: 1 }}>{value}</Text>
        </View>
      </View>
    </View>
  );
}

function RecordCard({ rec, onPreview, onEdit, onDelete }: { rec: InvoiceRecord; onPreview: () => void; onEdit: () => void; onDelete: () => void }) {
  const net = rec.netAmount ?? rec.basicAmount * (1 + (rec.cgstRate + rec.sgstRate) / 100);
  return (
    <View className="rounded-xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 min-w-0">
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>
            {rec.docTypeName || rec.materialCategory || "Invoice"}
          </Text>
          <Text numberOfLines={1} style={{ color: "#34d399", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>
            {rec.bookingReference || "—"}
          </Text>
          {!!rec.supplier && (
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 1 }}>
              {rec.supplier}
            </Text>
          )}
        </View>
        <StatusPill status={rec.status} />
      </View>

      <View className="flex-row flex-wrap gap-x-4 gap-y-1 mt-2.5">
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
          Date: <Text style={{ color: colors.foreground }}>{rec.bookingDate || "—"}</Text>
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
          Due: <Text style={{ color: colors.foreground }}>{rec.dueDate || "—"}</Text>
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
          Basic: <Text style={{ color: colors.foreground, fontFamily: fonts.heading.medium }}>₹{fmt(rec.basicAmount)}</Text>
        </Text>
        {rec.emi?.enabled ? (
          <View className="flex-row items-center gap-1">
            <CreditCard size={10} color="#8b5cf6" />
            <Text style={{ color: "#8b5cf6", fontSize: 11, fontFamily: fonts.heading.medium }}>{rec.emi.installmentCount}x EMI</Text>
          </View>
        ) : (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
            GST: <Text style={{ color: colors.foreground }}>{rec.cgstRate + rec.sgstRate}%</Text>
          </Text>
        )}
        {!!rec.companyName && (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
            Company: <Text style={{ color: colors.foreground }}>{rec.companyName}</Text>
          </Text>
        )}
      </View>

      <View className="flex-row items-center justify-between pt-2.5 mt-2.5" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}60` }}>
        <View>
          <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.regular }}>Net Payable</Text>
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 14 }}>₹{fmt(net)}</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <Pressable onPress={onPreview} className="p-2 rounded-lg" style={{ borderWidth: 1, borderColor: `${colors.border}80` }}>
            <Eye size={13} color="#38bdf8" />
          </Pressable>
          <Pressable onPress={onEdit} className="p-2 rounded-lg" style={{ borderWidth: 1, borderColor: `${colors.border}80` }}>
            <Pencil size={13} color={colors.mutedForeground} />
          </Pressable>
          <Pressable onPress={onDelete} className="p-2 rounded-lg" style={{ borderWidth: 1, borderColor: `${colors.destructive}30` }}>
            <Trash2 size={13} color={colors.destructive} />
          </Pressable>
        </View>
      </View>
    </View>
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
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
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
      className="flex-1"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View className="flex-row items-center gap-2.5 mb-1">
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${FINANCE}26`, borderWidth: 1, borderColor: `${FINANCE}4d` }}>
          <Receipt size={16} color={FINANCE} />
        </View>
        <View className="flex-1">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 20 }}>Invoice</Text>
          <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 1 }}>
            Book expenses against POs, work done, or documents
          </Text>
        </View>
        <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} className="p-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
          {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
        </Pressable>
      </View>

      <Pressable
        onPress={() => navigation.navigate("NewInvoice")}
        className="flex-row items-center justify-center gap-1.5 rounded-xl mt-3 mb-1"
        style={{ backgroundColor: FINANCE, paddingVertical: 11 }}
      >
        <Plus size={14} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>New Invoice</Text>
      </Pressable>

      {isError && (
        <View className="mt-3 flex-row items-center gap-2 px-4 py-2.5 rounded-xl" style={{ backgroundColor: `${colors.destructive}1a`, borderWidth: 1, borderColor: `${colors.destructive}33` }}>
          <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>
            Could not reach the server — showing cached data.
          </Text>
        </View>
      )}

      {/* Stat cards */}
      <View className="mt-6">
        <SectionLabel>Overview</SectionLabel>
        <View className="flex-row flex-wrap justify-between">
          <StatTile label="Total Booked" value={`₹${fmt(totalNet)}`} icon={Receipt} accent={FINANCE} />
          <StatTile label="Approved" value={approvedCount} icon={CheckCircle2} accent={FINANCE} />
          <StatTile label="Pending" value={pendingCount} icon={Clock} accent="#f59e0b" />
          <StatTile label="EMI Active" value={emiCount} icon={CreditCard} accent="#8b5cf6" />
        </View>
      </View>

      {/* Toolbar */}
      <View className="mt-1 mb-1">
        <SectionLabel>Booking Register</SectionLabel>
        <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: -8, marginBottom: 10 }}>
          {data?.total ?? 0} record{(data?.total ?? 0) !== 1 ? "s" : ""}
        </Text>

        <View className="flex-row items-center rounded-xl px-3" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}>
          <Search size={13} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search doc no, supplier…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontSize: 12.5, paddingVertical: 10, paddingHorizontal: 8, fontFamily: fonts.body.regular }}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")} hitSlop={8}>
              <X size={13} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        <View className="flex-row flex-wrap gap-1.5 mt-2.5">
          {ALL_STATUSES.map((s) => {
            const active = statusFilter === s;
            return (
              <Pressable
                key={s}
                onPress={() => { setStatusFilter(s); setPage(1); }}
                className="px-3 py-1.5 rounded-full"
                style={{ backgroundColor: active ? FINANCE : "transparent", borderWidth: 1, borderColor: active ? FINANCE : colors.border }}
              >
                <Text style={{ color: active ? "#fff" : colors.mutedForeground, fontSize: 11, fontFamily: fonts.heading.medium }}>{s}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* List */}
      {isLoading ? (
        <View className="py-14 items-center">
          <ActivityIndicator color={colors.mutedForeground} />
        </View>
      ) : filtered.length === 0 ? (
        <View className="py-12 items-center">
          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular }}>No invoices found.</Text>
        </View>
      ) : (
        <View className="mt-1">
          {filtered.map((rec) => (
            <RecordCard
              key={rec.id}
              rec={rec}
              onPreview={() => navigation.navigate("InvoicePreview", { id: rec.id })}
              onEdit={() => navigation.navigate("NewInvoice", { id: rec.id })}
              onDelete={() => requestDelete(rec)}
            />
          ))}
        </View>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <View className="flex-row items-center justify-between mt-2">
          <Pressable
            onPress={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-4 py-2 rounded-lg"
            style={{ borderWidth: 1, borderColor: colors.border, opacity: page <= 1 ? 0.4 : 1 }}
          >
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>Previous</Text>
          </Pressable>
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
            Page {page} of {data.totalPages}
          </Text>
          <Pressable
            onPress={() => setPage((p) => Math.min(data.totalPages, p + 1))}
            disabled={page >= data.totalPages}
            className="px-4 py-2 rounded-lg"
            style={{ borderWidth: 1, borderColor: colors.border, opacity: page >= data.totalPages ? 0.4 : 1 }}
          >
            <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>Next</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}
