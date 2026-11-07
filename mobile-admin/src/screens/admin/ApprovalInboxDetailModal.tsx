// RN port of the web inbox's record preview and its approve / reject (ApprovalActions), on the drawing sheet: a page up
// over the inbox with the record's reference as the title (module, date, party under it), its status and step; the
// summary (date, party, amount, created / approved / rejected by); a rejection note when there is one; the record's
// lines; and every other field of the full record from its own detail endpoint. Along the foot, while Pending:
//   Approve / Reject (Reject asks for a reason)      — the usual case
//   Confirm                                          — an engineer confirming their own Civil Work DPR assignment
//   "Waiting on level n of m"                        — named on the workflow, but not at its current level
//   a note instead of Approve                        — a received payment still waiting for its deposit bank, and the
//                                                      modules whose approval needs a review step (bookings, brokerage,
//                                                      refunds at finance) that only the web app has. Reject still works.
import { useEffect, useState } from "react";
import { View, Text, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, ClipboardList, FileText, XCircle } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { confirmEngineerAssignment, fetchRecordDetail, runApprovalAction, type InboxItem } from "@/api/approvalInboxApi";
import { Body, Field, InfoGrid, Input, Key, Label, Notice, Panel, SheetMark, Skel, statusTone } from "@/components/sheet/Sheet";
import { FormPage, LineList, fmtDate } from "@/components/sheet/Register";
import { MODULE_CONFIG, REVIEW_INSTEAD, SUB_GATE_SUFFIX, needsBankReview } from "./approvalInboxConfig";

const fmtAmount = (n: number | null) => (n == null ? "—" : formatINR(n, { decimals: 2 }));

const PREVIEW_HIDDEN_KEYS = new Set([
  "id", "_id", "attachments", "parties", "lineitems", "items", "poitems", "billingtermsdata", "termsandconditions", "createdat",
  "updatedat", "approvedat", "rejectedat", "docnumber", "belongsto", "createdby", "updatedby", "approvedby", "rejectedby", "projectname",
]);
const stripDbPrefix = (key: string) => key.replace(/^[A-Z](?=[A-Z])/, "");
const isIdField = (key: string) => /id$/i.test(key);
function isJsonBlob(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    let parsed = JSON.parse(value);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}
const labelizeKey = (key: string) =>
  stripDbPrefix(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
function extractLineItems(detail: Record<string, unknown> | null): Record<string, unknown>[] {
  if (!detail) return [];
  // "items" (lowercase) is a material request's own GET /:id shape.
  for (const key of ["LineItems", "POItems", "Items", "items"]) {
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

export function ApprovalInboxDetailModal({
  item, onClose, onActionDone,
}: { item: InboxItem | null; onClose: () => void; onActionDone: (recordId: string, module: string) => void }) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [acting, setActing] = useState<"approve" | "reject" | "confirm" | null>(null);

  const cfg = item ? MODULE_CONFIG[item.Module] : undefined;

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
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setFetchFailed(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.Module, item?.RecordId]);

  if (!item) return null;

  const party = item.SupplierName || item.ContractorName || item.CreatedBy || "—";
  const lineItems = extractLineItems(detail);
  // A material request has no rate or amount yet (pricing comes with its PO): name and quantity only.
  const isMaterialRequest = item.Module === "material-requests";
  const extraFields = detail
    ? Object.entries(detail).filter(
        ([k, v]) => !PREVIEW_HIDDEN_KEYS.has(stripDbPrefix(k).toLowerCase()) && !isIdField(k) && !isJsonBlob(v) && !(Array.isArray(v) && v.length === 0) && typeof v !== "object",
      )
    : [];
  const pending = item.Status === "Pending";
  const engineerConfirm = item.Module === "work-allocation-engineer";
  const notYourLevel = pending && item._canAct === false;
  const approveBlockedNote = needsBankReview(item) ? "Waiting for Accounts to set the deposit bank on the Received Payment page (web app)." : REVIEW_INSTEAD[item.Module];

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
      Alert.alert(action === "approve" ? "Could not approve" : "Could not reject", e.message || "Something went wrong.");
    } finally {
      setActing(null);
    }
  };

  const doConfirm = async () => {
    setActing("confirm");
    try {
      const r = await confirmEngineerAssignment(Number(item.RecordId));
      Alert.alert("Confirmed", r.allApproved ? "The activity moved to In Progress." : "Waiting on the other assigned engineer(s).");
      onActionDone(item.RecordId, item.Module);
      onClose();
    } catch (e: any) {
      Alert.alert("Could not confirm", e.message || "Something went wrong.");
    } finally {
      setActing(null);
    }
  };

  const foot = (children: React.ReactNode) => (
    <View style={{ gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: S.ink, backgroundColor: S.paper }}>{children}</View>
  );

  const footer = !pending ? null : engineerConfirm ? (
    foot(<Key tone="ink" label={acting === "confirm" ? "Confirming…" : "Confirm assignment"} icon={<CheckCircle2 size={13} color={S.paper} />} onPress={doConfirm} disabled={acting !== null} />)
  ) : notYourLevel ? (
    foot(
      <View style={{ minHeight: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderStyle: "dashed", borderColor: S.line40 }}>
        <Label>{`Waiting on level ${item._currentLevel}${item._totalLevels ? ` of ${item._totalLevels}` : ""}`}</Label>
      </View>,
    )
  ) : rejecting ? (
    foot(
      <>
        <Field label="Reason for rejection">
          <Input value={rejectNote} onChangeText={setRejectNote} placeholder="Optional, but it helps the person who raised it" multiline style={{ minHeight: 64, paddingVertical: 10, textAlignVertical: "top" }} />
        </Field>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Key label="Cancel" onPress={() => setRejecting(false)} disabled={acting !== null} />
          <Key tone="red" label={acting === "reject" ? "Rejecting…" : "Confirm rejection"} onPress={() => doAction("reject")} disabled={acting !== null} style={{ flex: 1 }} />
        </View>
      </>,
    )
  ) : (
    foot(
      <>
        {!!approveBlockedNote && <Body size={12} color={S.graphite}>{approveBlockedNote}</Body>}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Key tone="red" label="Reject" icon={<XCircle size={13} color="#ffffff" />} onPress={() => setRejecting(true)} disabled={acting !== null} style={{ flex: approveBlockedNote ? 1 : undefined }} />
          {!approveBlockedNote && (
            <Key tone="ink" label={acting === "approve" ? "Approving…" : "Approve"} icon={<CheckCircle2 size={13} color={S.paper} />} onPress={() => doAction("approve")} disabled={acting !== null} style={{ flex: 1 }} />
          )}
        </View>
      </>,
    )
  );

  return (
    <FormPage
      visible={!!item}
      onClose={onClose}
      eyebrow={`CivilierERP · Approvals · ${cfg?.label ?? item.ModuleLabel}`}
      title={item.Reference || `#${item.RecordId}`}
      subtitle={[fmtDate(item.RecordDate), party].filter(Boolean).join(" · ")}
      saveLabel=""
      footer={footer}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <SheetMark text={item._stage ? `${item.Status} · ${item._stage.label}` : item.Status} tone={/draft/i.test(item.Status) ? "draft" : statusTone(item.Status)} />
      </View>

      <InfoGrid
        items={[
          { label: "Date", value: fmtDate(item.RecordDate) },
          { label: "Amount", value: item.Module === "civilworkdpr-approval" && item.Amount == null ? item.ActivityName || "—" : fmtAmount(item.Amount) },
          { label: "Party", value: party, wide: true },
          { label: "Created by", value: item.CreatedBy || "—" },
          { label: "Approved by", value: item.ApprovedBy || "—" },
          ...(item.RejectedBy ? [{ label: "Rejected by", value: item.RejectedBy }] : []),
          ...(item.SourceTransferDocNo ? [{ label: "Transfer", value: `${item.SourceTransferDocNo}${item.FromGodownName && item.ToGodownName ? ` · ${item.FromGodownName} → ${item.ToGodownName}` : ""}`, wide: true }] : []),
        ]}
      />

      {!!item.RejectionNote && <Notice>{`Rejection note: ${item.RejectionNote}`}</Notice>}

      {lineItems.length > 0 && (
        <Panel title={`Items (${lineItems.length})`} icon={<ClipboardList size={14} color={S.ink} />}>
          <LineList
            rows={lineItems.map((li, i) => {
              const name = String(li.ItemName ?? li.itemName ?? li.Description ?? li.itemDescription ?? "—");
              const qty = Number(li.Quantity ?? li.quantity ?? 0);
              const uom = String(li.UOMName ?? li.UomName ?? li.uomName ?? li.UOMSymbol ?? li.Symbol ?? li.UOMCode ?? li.uomCode ?? li.Unit ?? li.unit ?? li.uom ?? "");
              const rate = Number(li.Rate ?? li.rate ?? 0);
              const amount = Number(li.LineAmount ?? li.amount ?? qty * rate);
              return isMaterialRequest
                ? { key: i, title: name, right: `${qty.toLocaleString("en-IN")}${uom ? ` ${uom}` : ""}` }
                : { key: i, title: name, note: `${qty.toLocaleString("en-IN")}${uom ? ` ${uom}` : ""} × ${formatINR(rate)}`, right: formatINR(amount) };
            })}
          />
        </Panel>
      )}

      <Panel title="Full record" icon={<FileText size={14} color={S.ink} />}>
        {loading ? (
          <>
            <Skel h={30} />
            <Skel h={30} />
          </>
        ) : fetchFailed || extraFields.length === 0 ? (
          <Body size={12.5} color={S.graphite}>{fetchFailed ? "Couldn't load the full record; the summary above is from the inbox." : "No further fields."}</Body>
        ) : (
          <InfoGrid items={extraFields.map(([k, v]) => ({ label: labelizeKey(k), value: formatPreviewValue(v) }))} />
        )}
      </Panel>

      {!pending && (
        <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>{`This record is ${item.Status.toLowerCase()}; there is nothing to act on.`}</Text>
      )}
    </FormPage>
  );
}
