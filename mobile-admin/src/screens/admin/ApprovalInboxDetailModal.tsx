// RN port of ApprovalInbox.tsx's RecordPreviewModal (web) — fetches the
// record's own detail endpoint so the reviewer sees every field, not just
// the inbox row's summary. "Open in Module" is dropped (no module screens
// exist on mobile-admin yet to deep-link to).
import { useEffect, useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X, CheckCircle2, XCircle } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { fetchRecordDetail, runApprovalAction, type InboxItem } from "@/api/approvalInboxApi";
import { MODULE_CONFIG, SUB_GATE_SUFFIX } from "./approvalInboxConfig";
import { StatusBadge } from "./StatusBadge";

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
};
const fmtAmount = (n: number | null) => (n == null ? "—" : formatINR(n, { decimals: 2 }));

const PREVIEW_HIDDEN_KEYS = new Set([
  "id", "_id", "attachments", "parties", "lineitems", "items", "poitems",
  "billingtermsdata", "termsandconditions", "createdat", "updatedat",
  "approvedat", "rejectedat", "docnumber", "belongsto",
  "createdby", "updatedby", "approvedby", "rejectedby", "projectname",
]);

function stripDbPrefix(key: string): string {
  return key.replace(/^[A-Z](?=[A-Z])/, "");
}
function isIdField(key: string): boolean {
  return /id$/i.test(key);
}
function isJsonBlob(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s) return false;
  try {
    let parsed = JSON.parse(s);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}
function labelizeKey(key: string): string {
  return stripDbPrefix(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
function extractLineItems(detail: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!detail) return [];
  for (const key of ["LineItems", "POItems", "Items"]) {
    const v = detail[key];
    if (Array.isArray(v) && v.length > 0) return v as Record<string, unknown>[];
  }
  return [];
}
function formatPreviewValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-IN");
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return "—";
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }
  return str;
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: "48%", marginBottom: 12 }}>
      <Text style={{ color: `${colors.mutedForeground}b3`, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.regular, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

export function ApprovalInboxDetailModal({
  item, onClose, onActionDone,
}: { item: InboxItem | null; onClose: () => void; onActionDone: (recordId: string, module: string) => void }) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);

  const cfg = item ? MODULE_CONFIG[item.Module] : undefined;
  const Icon = cfg?.icon ?? CheckCircle2;

  useEffect(() => {
    if (!item) return;
    setDetail(null);
    setFetchFailed(false);
    setRejecting(false);
    setRejectNote("");
    if (!cfg?.apiEndpoint) return;
    setLoading(true);
    let cancelled = false;
    fetchRecordDetail(cfg.apiEndpoint, item.RecordId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setFetchFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.Module, item?.RecordId]);

  if (!item) return null;

  const party = item.SupplierName || item.ContractorName || item.CreatedBy || "—";
  const lineItems = extractLineItems(detail);
  const extraFields = detail
    ? Object.entries(detail).filter(
        ([k, v]) =>
          !PREVIEW_HIDDEN_KEYS.has(stripDbPrefix(k).toLowerCase()) &&
          !isIdField(k) &&
          !isJsonBlob(v) &&
          !(Array.isArray(v) && v.length === 0) &&
          typeof v !== "object",
      )
    : [];

  const doAction = async (action: "approve" | "reject") => {
    setActing(action);
    try {
      await runApprovalAction(cfg?.apiEndpoint ?? `/api/${item.Module}`, item.RecordId, action, {
        note: action === "reject" ? rejectNote : undefined,
        actionPathSuffix: SUB_GATE_SUFFIX[item.Module],
      });
      onActionDone(item.RecordId, item.Module);
      onClose();
    } catch (e: any) {
      Alert.alert(action === "approve" ? "Approve failed" : "Reject failed", e.message || "Something went wrong.");
    } finally {
      setActing(null);
    }
  };

  return (
    <Modal visible={!!item} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-4 py-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View className="flex-row items-center gap-2.5 flex-1 min-w-0">
            <View className="w-9 h-9 rounded-lg items-center justify-center" style={{ backgroundColor: `${cfg?.color ?? colors.mutedForeground}1f` }}>
              <Icon size={16} color={cfg?.color ?? colors.mutedForeground} />
            </View>
            <View className="flex-1 min-w-0">
              <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold }}>{item.ModuleLabel}</Text>
              <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular }}>{item.Reference || `#${item.RecordId}`}</Text>
            </View>
          </View>
          <StatusBadge status={item.Status} />
          <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center ml-2.5" style={{ borderWidth: 1, borderColor: colors.border }}>
            <X size={15} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: insets.bottom + 24 }}>
          <View className="flex-row flex-wrap rounded-2xl p-3.5 mb-4" style={{ backgroundColor: `${colors.card}80`, borderWidth: 1, borderColor: `${colors.border}99` }}>
            <SummaryCell label="Date" value={fmtDate(item.RecordDate)} />
            <SummaryCell label="Party" value={party} />
            <SummaryCell label="Amount" value={fmtAmount(item.Amount)} />
            <SummaryCell label="Created By" value={item.CreatedBy || "—"} />
            <SummaryCell label="Approved By" value={item.ApprovedBy || "—"} />
            <SummaryCell label="Rejected By" value={item.RejectedBy || "—"} />
          </View>

          {item.RejectionNote && (
            <View className="rounded-xl p-3 mb-4" style={{ backgroundColor: `${colors.destructive}0d`, borderWidth: 1, borderColor: `${colors.destructive}33` }}>
              <Text style={{ color: `${colors.destructive}cc`, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>Rejection Note</Text>
              <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.regular }}>{item.RejectionNote}</Text>
            </View>
          )}

          {lineItems.length > 0 && (
            <View className="mb-4">
              <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Items ({lineItems.length})
              </Text>
              <View className="rounded-xl overflow-hidden" style={{ borderWidth: 1, borderColor: colors.border }}>
                {lineItems.map((li, i) => {
                  const name = (li.ItemName ?? li.itemName ?? li.Description ?? li.itemDescription ?? "—") as string;
                  const qty = Number(li.Quantity ?? li.quantity ?? 0);
                  const rate = Number(li.Rate ?? li.rate ?? 0);
                  const amount = Number(li.LineAmount ?? li.amount ?? qty * rate);
                  return (
                    <View key={i} className="flex-row items-center justify-between px-3 py-2.5" style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: `${colors.border}66` }}>
                      <View className="flex-1 min-w-0 pr-2">
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.body.medium }}>{name}</Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 10.5, marginTop: 1 }}>{qty.toLocaleString("en-IN")} × {formatINR(rate)}</Text>
                      </View>
                      <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold }}>{formatINR(amount)}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            Full Record
          </Text>
          {loading ? (
            <ActivityIndicator color={colors.mutedForeground} style={{ marginVertical: 12 }} />
          ) : fetchFailed || extraFields.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>
              {fetchFailed ? "Couldn't load the full record — showing summary only." : "No additional fields."}
            </Text>
          ) : (
            <View className="flex-row flex-wrap rounded-xl p-3.5" style={{ borderWidth: 1, borderColor: colors.border }}>
              {extraFields.map(([k, v]) => (
                <SummaryCell key={k} label={labelizeKey(k)} value={formatPreviewValue(v)} />
              ))}
            </View>
          )}
        </ScrollView>

        {item.Status === "Pending" && (
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }}>
            {rejecting ? (
              <View className="px-4 pt-3">
                <TextInput
                  value={rejectNote}
                  onChangeText={setRejectNote}
                  placeholder="Reason for rejection (optional but recommended)"
                  placeholderTextColor={`${colors.mutedForeground}99`}
                  multiline
                  numberOfLines={3}
                  style={{
                    borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12,
                    color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, minHeight: 72, textAlignVertical: "top", marginBottom: 10,
                  }}
                />
                <View className="flex-row gap-3">
                  <Pressable onPress={() => setRejecting(false)} className="flex-1 items-center py-3 rounded-xl" style={{ borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.heading.semibold }}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => doAction("reject")}
                    disabled={acting !== null}
                    className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl"
                    style={{ backgroundColor: colors.destructive, opacity: acting ? 0.6 : 1 }}
                  >
                    {acting === "reject" && <ActivityIndicator size="small" color="#fff" />}
                    <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>Confirm Rejection</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View className="flex-row gap-3 px-4 pt-3">
                <Pressable
                  onPress={() => setRejecting(true)}
                  disabled={acting !== null}
                  className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl"
                  style={{ backgroundColor: `${colors.destructive}14`, borderWidth: 1, borderColor: `${colors.destructive}40` }}
                >
                  <XCircle size={15} color={colors.destructive} />
                  <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: fonts.heading.semibold }}>Reject</Text>
                </Pressable>
                <Pressable
                  onPress={() => doAction("approve")}
                  disabled={acting !== null}
                  className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl"
                  style={{ backgroundColor: "#10b981", opacity: acting ? 0.6 : 1 }}
                >
                  {acting === "approve" ? <ActivityIndicator size="small" color="#fff" /> : <CheckCircle2 size={15} color="#fff" />}
                  <Text style={{ color: "#fff", fontSize: 13, fontFamily: fonts.heading.semibold }}>Approve</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}
