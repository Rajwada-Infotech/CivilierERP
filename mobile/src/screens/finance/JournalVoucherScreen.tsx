// RN port of src/pages/finance/JournalVoucher.tsx — a single screen, same
// as web (no separate detail page): stat pills, search, a card per
// voucher with Approve/Reject for Pending rows, and a "New Journal
// Voucher" bottom sheet (company/project/date/narration + dynamic
// debit/credit lines with a live balance indicator, same rule as web —
// debit must equal credit before saving).
import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl, TextInput, Modal, Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Scale, Plus, Search, X, Check, RefreshCw, FileText, Clock, CheckCircle2, AlertCircle, Trash2, ChevronDown,
} from "lucide-react-native";
import {
  getJournalVouchers, getJournalVoucherLedgerOptions, createJournalVoucher,
  approveJournalVoucher, rejectJournalVoucher,
  type JournalVoucherSummary, type JournalVoucherLedgerOption, type JournalVoucherLine,
} from "@/api/journalVoucherApi";
import { fetchCompanyOptions, fetchProjectOptions } from "@/api/newPaymentApi";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { SectionLabel } from "@/components/home/SectionLabel";

const ACCENT = "#6467f2";

const STATUS_STYLE: Record<string, string> = {
  Draft: colors.mutedForeground,
  Pending: "#f59e0b",
  Approved: "#10b981",
  Rejected: "#ef4444",
};

const LHEAD_TYPE_LABEL: Record<string, string> = {
  GL: "General Ledger",
  C: "Customer",
  S: "Supplier",
  B: "Bank",
};

function fmtINR(n: number) {
  return `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? "—" : dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

type LineUI = JournalVoucherLine & { _id: string };
function emptyLine(): LineUI {
  return { _id: Math.random().toString(36).slice(2) + Date.now().toString(36), LHeadId: null, DebitAmount: 0, CreditAmount: 0 };
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_STYLE[status] ?? colors.mutedForeground;
  return (
    <View className="flex-row items-center gap-1 px-2 py-1 rounded-md" style={{ backgroundColor: `${color}22`, borderWidth: 1, borderColor: `${color}40` }}>
      <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color }} />
      <Text style={{ color, fontSize: 10, fontFamily: fonts.heading.semibold }}>{status}</Text>
    </View>
  );
}

function GLPill({ status, posted }: { status: string; posted?: boolean }) {
  if (status !== "Approved") return null;
  const color = posted ? "#10b981" : "#ef4444";
  return (
    <View className="px-2 py-1 rounded-md" style={{ backgroundColor: `${color}22`, borderWidth: 1, borderColor: `${color}40` }}>
      <Text style={{ color, fontSize: 9.5, fontFamily: fonts.heading.semibold }}>{posted ? "Posted" : "Not posted"}</Text>
    </View>
  );
}

function StatTile({ label, value, icon: Icon, accent }: { label: string; value: number; icon: React.ComponentType<{ size?: number; color?: string }>; accent: string }) {
  return (
    <View style={{ width: "48%", marginBottom: 10 }} className="rounded-xl overflow-hidden">
      <View className="flex-row items-center gap-2.5 px-3.5 py-3" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80`, borderLeftWidth: 3, borderLeftColor: accent }}>
        <View className="w-8 h-8 rounded-lg items-center justify-center" style={{ backgroundColor: `${accent}26`, borderWidth: 1, borderColor: `${accent}4d` }}>
          <Icon size={14} color={accent} />
        </View>
        <View className="flex-1 min-w-0">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 16 }}>{value}</Text>
          <Text numberOfLines={1} style={{ color: `${colors.mutedForeground}b3`, fontSize: 10, fontFamily: fonts.body.regular }}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

function VoucherCard({
  v, onApprove, onReject, acting,
}: {
  v: JournalVoucherSummary; onApprove: () => void; onReject: () => void; acting: "approve" | "reject" | null;
}) {
  return (
    <View className="rounded-xl p-3.5 mb-2.5" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <Text style={{ color: ACCENT, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>{v.JVNo || `JV-${v.JVID}`}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{fmtDate(v.JVDate)}</Text>
          </View>
          {!!v.CompanyName && (
            <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium, marginTop: 3 }}>
              {v.CompanyName}{v.ProjectName ? ` · ${v.ProjectName}` : ""}
            </Text>
          )}
        </View>
        <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 14 }}>{fmtINR(v.TotalAmount || 0)}</Text>
      </View>

      {!!v.Narration && (
        <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular, marginTop: 6 }}>
          {v.Narration}
        </Text>
      )}

      <View className="flex-row items-center justify-between mt-3 pt-2.5" style={{ borderTopWidth: 1, borderTopColor: `${colors.border}60` }}>
        <View className="flex-row items-center gap-1.5">
          <StatusPill status={v.Status} />
          <GLPill status={v.Status} posted={v.PostedToGL} />
        </View>
        {v.Status === "Pending" && (
          <View className="flex-row items-center gap-1.5">
            <Pressable onPress={onApprove} disabled={!!acting} className="p-1.5 rounded-lg" style={{ borderWidth: 1, borderColor: "#10b98140" }}>
              {acting === "approve" ? <ActivityIndicator size="small" color="#10b981" /> : <Check size={13} color="#10b981" />}
            </Pressable>
            <Pressable onPress={onReject} disabled={!!acting} className="p-1.5 rounded-lg" style={{ borderWidth: 1, borderColor: "#ef444440" }}>
              {acting === "reject" ? <ActivityIndicator size="small" color="#ef4444" /> : <X size={13} color="#ef4444" />}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

function OptionSheet({
  visible, title, options, onSelect, onClose,
}: {
  visible: boolean; title: string; options: Array<{ id: string | number; label: string }>; onSelect: (id: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "60%", borderWidth: 1, borderColor: colors.border }}>
          <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}><X size={16} color={colors.mutedForeground} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingVertical: 8, paddingBottom: 20 }}>
            {options.length === 0 ? (
              <Text className="text-center py-8" style={{ color: `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.regular }}>No options found</Text>
            ) : (
              options.map((o, i) => (
                <Pressable key={`${o.id}-${i}`} onPress={() => onSelect(String(o.id))} className="px-5 py-3">
                  <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.medium }}>{o.label}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export default function JournalVoucherScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<{ id: number; action: "approve" | "reject" } | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const { data: vouchers = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["journal-vouchers"],
    queryFn: getJournalVouchers,
    staleTime: 30_000,
  });

  const { data: ledgerOptions = [] } = useQuery({
    queryKey: ["jv-ledger-options"],
    queryFn: getJournalVoucherLedgerOptions,
    enabled: formOpen,
  });

  const { data: companies = [] } = useQuery({ queryKey: ["jv-companies"], queryFn: fetchCompanyOptions, enabled: formOpen });
  const { data: allProjects = [] } = useQuery({ queryKey: ["jv-projects"], queryFn: fetchProjectOptions, enabled: formOpen });

  // Form state
  const [jvDate, setJvDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyLabel, setCompanyLabel] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projectLabel, setProjectLabel] = useState("");
  const [lines, setLines] = useState<LineUI[]>([emptyLine(), emptyLine()]);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [lhPickerLineId, setLhPickerLineId] = useState<string | null>(null);

  const projects = useMemo(() => (allProjects as any[]).filter((p) => String(p.company_id) === companyId), [allProjects, companyId]);

  const groupedLedgerOptions = useMemo(() => {
    const groups: Record<string, JournalVoucherLedgerOption[]> = {};
    ledgerOptions.forEach((o) => {
      const key = o.type || "GL";
      (groups[key] ||= []).push(o);
    });
    return groups;
  }, [ledgerOptions]);
  const ledgerFlat = useMemo(
    () => Object.entries(groupedLedgerOptions).flatMap(([type, opts]) => opts.map((o) => ({ id: o.id, label: `${LHEAD_TYPE_LABEL[type] ?? type} · ${o.label}` }))),
    [groupedLedgerOptions],
  );

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.DebitAmount) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.CreditAmount) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
  }, [lines]);

  const resetForm = () => {
    setJvDate(new Date().toISOString().slice(0, 10));
    setNarration("");
    setCompanyId("");
    setCompanyLabel("");
    setProjectId("");
    setProjectLabel("");
    setLines([emptyLine(), emptyLine()]);
  };

  const updateLine = (id: string, patch: Partial<LineUI>) => setLines((prev) => prev.map((l) => (l._id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (id: string) => setLines((prev) => (prev.length > 2 ? prev.filter((l) => l._id !== id) : prev));

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("Select the Company this voucher belongs to.");
      if (!totals.balanced) throw new Error("Debit and Credit totals must match before saving.");
      if (lines.some((l) => !l.LHeadId)) throw new Error("Every line requires an account head.");
      return createJournalVoucher({
        JVDate: jvDate,
        Narration: narration,
        CompanyId: Number(companyId),
        ProjectId: projectId ? Number(projectId) : null,
        lines,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["journal-vouchers"] });
      setFormOpen(false);
      resetForm();
      Alert.alert("Journal Voucher created", "Submitted for approval.");
    },
    onError: (e: Error) => Alert.alert("Save failed", e.message),
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

  const stats = useMemo(() => ({
    total: vouchers.length,
    approved: vouchers.filter((v) => v.Status === "Approved").length,
    pending: vouchers.filter((v) => v.Status === "Pending").length,
    draft: vouchers.filter((v) => v.Status === "Draft").length,
  }), [vouchers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return vouchers;
    const q = search.trim().toLowerCase();
    return vouchers.filter((v) => (v.JVNo || "").toLowerCase().includes(q) || (v.Narration || "").toLowerCase().includes(q) || v.Status.toLowerCase().includes(q));
  }, [vouchers, search]);

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
        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${ACCENT}26`, borderWidth: 1, borderColor: `${ACCENT}4d` }}>
          <Scale size={16} color={ACCENT} />
        </View>
        <View className="flex-1">
          <Text style={{ color: colors.foreground, fontFamily: fonts.heading.bold, fontSize: 20 }}>Journal Voucher</Text>
          <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 1 }}>
            Correct account-head mismatches with balanced entries
          </Text>
        </View>
        <Pressable onPress={() => refetch()} disabled={isFetching} hitSlop={8} className="p-2 rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
          {isFetching ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : <RefreshCw size={14} color={colors.mutedForeground} />}
        </Pressable>
      </View>

      <Pressable
        onPress={() => setFormOpen(true)}
        className="flex-row items-center justify-center gap-1.5 rounded-xl mt-3 mb-1"
        style={{ backgroundColor: ACCENT, paddingVertical: 11 }}
      >
        <Plus size={14} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>New Journal Voucher</Text>
      </Pressable>

      {isError && (
        <View className="mt-3 flex-row items-center gap-2 px-4 py-2.5 rounded-xl" style={{ backgroundColor: `${colors.destructive}1a`, borderWidth: 1, borderColor: `${colors.destructive}33` }}>
          <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: fonts.body.medium, flex: 1 }}>Could not reach the server — showing cached data.</Text>
        </View>
      )}

      {/* Stats */}
      <View className="mt-6">
        <SectionLabel>Overview</SectionLabel>
        <View className="flex-row flex-wrap justify-between">
          <StatTile label="Total" value={stats.total} icon={FileText} accent={ACCENT} />
          <StatTile label="Approved" value={stats.approved} icon={CheckCircle2} accent="#10b981" />
          <StatTile label="Pending" value={stats.pending} icon={Clock} accent="#f59e0b" />
          <StatTile label="Draft" value={stats.draft} icon={FileText} accent={colors.mutedForeground} />
        </View>
      </View>

      {/* Search */}
      <View className="mt-1 mb-1">
        <View className="flex-row items-center rounded-xl px-3" style={{ backgroundColor: `${colors.card}b3`, borderWidth: 1, borderColor: `${colors.border}80` }}>
          <Search size={13} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search JV number, narration…"
            placeholderTextColor={`${colors.mutedForeground}99`}
            style={{ flex: 1, color: colors.foreground, fontSize: 12.5, paddingVertical: 10, paddingHorizontal: 8, fontFamily: fonts.body.regular }}
          />
          {!!search && <Pressable onPress={() => setSearch("")} hitSlop={8}><X size={13} color={colors.mutedForeground} /></Pressable>}
        </View>
      </View>

      {/* List */}
      {isLoading ? (
        <View className="py-14 items-center"><ActivityIndicator color={colors.mutedForeground} /></View>
      ) : filtered.length === 0 ? (
        <View className="py-12 items-center">
          <Scale size={28} color={`${colors.mutedForeground}40`} />
          <Text style={{ color: `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular, marginTop: 8 }}>
            {search ? "No vouchers match your search" : "No journal vouchers yet"}
          </Text>
        </View>
      ) : (
        <View className="mt-2">
          {filtered.map((v) => (
            <VoucherCard
              key={v.JVID}
              v={v}
              acting={acting?.id === v.JVID ? acting.action : null}
              onApprove={() => approveMutation.mutate(v.JVID)}
              onReject={() => rejectMutation.mutate(v.JVID)}
            />
          ))}
        </View>
      )}

      {/* ── New JV bottom sheet ── */}
      <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }} onPress={() => setFormOpen(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "88%", borderWidth: 1, borderColor: colors.border }}>
            <View className="flex-row items-center justify-between px-4 py-3.5" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View>
                <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>New Journal Voucher</Text>
                <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 10, fontFamily: fonts.body.regular, marginTop: 1 }}>Debit total must equal credit total.</Text>
              </View>
              <Pressable onPress={() => setFormOpen(false)} hitSlop={8}><X size={16} color={colors.mutedForeground} /></Pressable>
            </View>

            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
              <View className="flex-row flex-wrap justify-between">
                <View style={{ width: "48%", marginBottom: 12 }}>
                  <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", marginBottom: 5 }}>Company *</Text>
                  <Pressable
                    onPress={() => setCompanyPickerOpen(true)}
                    className="flex-row items-center justify-between rounded-xl px-3 py-2.5"
                    style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Text numberOfLines={1} style={{ color: companyLabel ? colors.foreground : `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular, flexShrink: 1 }}>
                      {companyLabel || "Select…"}
                    </Text>
                    <ChevronDown size={13} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                <View style={{ width: "48%", marginBottom: 12, opacity: companyId ? 1 : 0.5 }}>
                  <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", marginBottom: 5 }}>Project</Text>
                  <Pressable
                    onPress={() => companyId && setProjectPickerOpen(true)}
                    className="flex-row items-center justify-between rounded-xl px-3 py-2.5"
                    style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}
                  >
                    <Text numberOfLines={1} style={{ color: projectLabel ? colors.foreground : `${colors.mutedForeground}80`, fontSize: 12.5, fontFamily: fonts.body.regular, flexShrink: 1 }}>
                      {projectLabel || (companyId ? "Optional…" : "Select company first")}
                    </Text>
                    <ChevronDown size={13} color={colors.mutedForeground} />
                  </Pressable>
                </View>
                <View style={{ width: "48%", marginBottom: 12 }}>
                  <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", marginBottom: 5 }}>Date</Text>
                  <TextInput
                    value={jvDate}
                    onChangeText={setJvDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={`${colors.mutedForeground}80`}
                    style={{ color: colors.foreground, fontSize: 12.5, backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 }}
                  />
                </View>
                <View style={{ width: "48%", marginBottom: 12 }}>
                  <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 10, fontFamily: fonts.body.medium, textTransform: "uppercase", marginBottom: 5 }}>Narration</Text>
                  <TextInput
                    value={narration}
                    onChangeText={setNarration}
                    placeholder="Reason…"
                    placeholderTextColor={`${colors.mutedForeground}80`}
                    style={{ color: colors.foreground, fontSize: 12.5, backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 }}
                  />
                </View>
              </View>

              {/* Lines */}
              <Text style={{ color: `${colors.mutedForeground}cc`, fontSize: 10, fontFamily: fonts.heading.bold, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8, marginTop: 4 }}>
                Lines
              </Text>
              {lines.map((line, idx) => (
                <View key={line._id} className="rounded-xl px-3 py-3 mb-2" style={{ backgroundColor: `${colors.muted}50`, borderWidth: 1, borderColor: colors.border }}>
                  <View className="flex-row items-center justify-between mb-2">
                    <Pressable onPress={() => setLhPickerLineId(line._id)} className="flex-1 flex-row items-center justify-between mr-2">
                      <Text numberOfLines={1} style={{ color: line.LHeadId ? colors.foreground : `${colors.mutedForeground}80`, fontSize: 12, fontFamily: fonts.body.medium, flexShrink: 1 }}>
                        {ledgerFlat.find((o) => o.id === line.LHeadId)?.label || "Select account…"}
                      </Text>
                      <ChevronDown size={12} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable onPress={() => removeLine(line._id)} disabled={lines.length <= 2} hitSlop={6} style={{ opacity: lines.length <= 2 ? 0.3 : 1 }}>
                      <Trash2 size={13} color={colors.destructive} />
                    </Pressable>
                  </View>
                  <View className="flex-row gap-2">
                    <View className="flex-1">
                      <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 9, fontFamily: fonts.body.regular, marginBottom: 3 }}>Debit</Text>
                      <TextInput
                        value={line.DebitAmount ? String(line.DebitAmount) : ""}
                        onChangeText={(v) => {
                          const n = parseFloat(v) || 0;
                          updateLine(line._id, n !== 0 ? { DebitAmount: n, CreditAmount: 0 } : { DebitAmount: n });
                        }}
                        keyboardType="numeric"
                        placeholder="0.00"
                        placeholderTextColor={`${colors.mutedForeground}60`}
                        style={{ color: colors.foreground, fontSize: 12.5, textAlign: "right", backgroundColor: colors.background, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7 }}
                      />
                    </View>
                    <View className="flex-1">
                      <Text style={{ color: `${colors.mutedForeground}99`, fontSize: 9, fontFamily: fonts.body.regular, marginBottom: 3 }}>Credit</Text>
                      <TextInput
                        value={line.CreditAmount ? String(line.CreditAmount) : ""}
                        onChangeText={(v) => {
                          const n = parseFloat(v) || 0;
                          updateLine(line._id, n !== 0 ? { CreditAmount: n, DebitAmount: 0 } : { CreditAmount: n });
                        }}
                        keyboardType="numeric"
                        placeholder="0.00"
                        placeholderTextColor={`${colors.mutedForeground}60`}
                        style={{ color: colors.foreground, fontSize: 12.5, textAlign: "right", backgroundColor: colors.background, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7 }}
                      />
                    </View>
                  </View>
                </View>
              ))}

              <Pressable onPress={addLine} className="flex-row items-center gap-1.5 py-2">
                <Plus size={13} color={ACCENT} />
                <Text style={{ color: ACCENT, fontSize: 12, fontFamily: fonts.heading.medium }}>Add line</Text>
              </Pressable>

              <View className="flex-row justify-between px-1 mt-1 mb-3">
                <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
                  Debit: <Text style={{ color: colors.foreground, fontFamily: fonts.heading.medium }}>{fmtINR(totals.debit)}</Text>
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.regular }}>
                  Credit: <Text style={{ color: colors.foreground, fontFamily: fonts.heading.medium }}>{fmtINR(totals.credit)}</Text>
                </Text>
              </View>

              {/* Balance indicator */}
              <View
                className="flex-row items-center gap-2 px-4 py-2.5 rounded-xl mb-4"
                style={{
                  backgroundColor: totals.balanced ? "#10b9811a" : totals.debit > 0 || totals.credit > 0 ? "#ef44441a" : `${colors.muted}50`,
                  borderWidth: 1,
                  borderColor: totals.balanced ? "#10b98140" : totals.debit > 0 || totals.credit > 0 ? "#ef444440" : colors.border,
                }}
              >
                {totals.balanced ? <CheckCircle2 size={13} color="#10b981" /> : totals.debit > 0 || totals.credit > 0 ? <AlertCircle size={13} color="#ef4444" /> : <Scale size={13} color={colors.mutedForeground} />}
                <Text style={{ color: totals.balanced ? "#10b981" : totals.debit > 0 || totals.credit > 0 ? "#ef4444" : colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.medium, flex: 1 }}>
                  {totals.balanced
                    ? `Balanced — ${fmtINR(totals.debit)} each side`
                    : totals.debit > 0 || totals.credit > 0
                      ? `Difference: ${fmtINR(Math.abs(totals.debit - totals.credit))}`
                      : "Enter amounts on each line"}
                </Text>
              </View>

              <Pressable
                onPress={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !totals.balanced}
                className="rounded-xl items-center"
                style={{ backgroundColor: ACCENT, paddingVertical: 13, opacity: saveMutation.isPending || !totals.balanced ? 0.5 : 1 }}
              >
                {saveMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                  <Text style={{ color: "#fff", fontSize: 13.5, fontFamily: fonts.heading.semibold }}>Save & Submit</Text>
                )}
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <OptionSheet
        visible={companyPickerOpen}
        title="Select Company"
        options={(companies as any[]).map((c) => ({ id: c.id, label: c.label }))}
        onClose={() => setCompanyPickerOpen(false)}
        onSelect={(id) => {
          setCompanyId(id);
          setCompanyLabel((companies as any[]).find((c) => String(c.id) === id)?.label ?? "");
          setProjectId("");
          setProjectLabel("");
          setCompanyPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={projectPickerOpen}
        title="Select Project"
        options={projects.map((p) => ({ id: p.id, label: p.label }))}
        onClose={() => setProjectPickerOpen(false)}
        onSelect={(id) => {
          setProjectId(id);
          setProjectLabel(projects.find((p) => String(p.id) === id)?.label ?? "");
          setProjectPickerOpen(false);
        }}
      />
      <OptionSheet
        visible={!!lhPickerLineId}
        title="Select Account Head"
        options={ledgerFlat}
        onClose={() => setLhPickerLineId(null)}
        onSelect={(id) => {
          if (lhPickerLineId) updateLine(lhPickerLineId, { LHeadId: Number(id) });
          setLhPickerLineId(null);
        }}
      />
    </ScrollView>
  );
}
