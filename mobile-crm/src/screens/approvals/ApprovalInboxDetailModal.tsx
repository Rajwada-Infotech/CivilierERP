// RN port of the web inbox's record preview and its approve / reject (ApprovalActions), on the drawing sheet: a page up
// over the inbox with the record's reference as the title (module, date, party under it), its status and step; the
// summary (date, party, amount, created / approved / rejected by); a rejection note when there is one; the record's
// lines; and every other field of the full record from its own detail endpoint. A Download PDF key by the status prints
// all of that to a PDF and opens the share sheet (approvalPdf.ts). Along the foot, while Pending:
//   Approve / Reject (Reject asks for a reason)      — the usual case
//   Confirm                                          — an engineer confirming their own Civil Work DPR assignment
//   "Waiting on level n of m"                        — named on the workflow, but not at its current level
//   crm-bookings: "Open Booking" button — opens BookingDetailScreen where approve/reject live (checklist + action together)
//   crm-refunds-finance: bank + payment-mode pickers before Approve (raises the payout voucher on submit)
//   received-payment still waiting for Accounts to set the deposit bank: notice shown, Reject still works
import { useEffect, useState } from "react";
import { View, Text, Alert } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Banknote, CheckCircle2, ClipboardList, Download, FileText, Home, XCircle } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { formatINR } from "@/utils/formatCurrency";
import { fetchWithAuth } from "@/services/fetchWithAuth";
import { confirmEngineerAssignment, fetchRecordDetail, runApprovalAction, setReceivedPaymentDepositBank, type InboxItem } from "@/api/approvalInboxApi";
import { Body, Field, InfoGrid, Input, Key, Label, Notice, Panel, SheetMark, Skel, statusTone } from "@/components/sheet/Sheet";
import { FormPage, LineList, fmtDate } from "@/components/sheet/Register";
import { OptionRow, PickerField, SheetPicker } from "@/components/sheet/FormParts";
import { FINANCE_APPROVE_MODULE, MODULE_CONFIG, OPEN_BOOKING_MODULES, SUB_GATE_SUFFIX, needsBankReview } from "./approvalInboxConfig";
import { downloadApprovalPdf, type PdfLine } from "./approvalPdf";
import { shareBoqPdf, type BoqPdfRecord } from "./boqPdf";

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

type Bank = { BId: number; BName: string; BBranch?: string; BAccountLast4?: string };

function PaymentModePicker({ modes, selected, onSelect }: {
  modes: string[];
  selected: string;
  onSelect: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PickerField
        label="Payment mode"
        value={selected}
        placeholder="Select payment mode"
        onPress={() => setOpen(true)}
        wide
        disabled={modes.length === 0}
      />
      <SheetPicker visible={open} title="Payment mode" onClose={() => setOpen(false)}>
        {modes.map((m) => (
          <OptionRow key={m} label={m} selected={selected === m} onPress={() => { onSelect(m); setOpen(false); }} />
        ))}
      </SheetPicker>
    </>
  );
}

function BankPicker({ label = "Company bank account", banks, selected, onSelect }: {
  label?: string;
  banks: Bank[];
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const chosen = banks.find((b) => b.BId === selected);
  const displayValue = chosen
    ? [chosen.BName, chosen.BAccountLast4 ? `····${chosen.BAccountLast4}` : null].filter(Boolean).join(" · ")
    : "";
  return (
    <>
      <PickerField
        label={label}
        value={displayValue}
        placeholder="Select bank account"
        onPress={() => setOpen(true)}
        wide
      />
      <SheetPicker visible={open} title={label} onClose={() => setOpen(false)}>
        {banks.map((b) => (
          <OptionRow
            key={b.BId}
            label={b.BName}
            sub={[b.BBranch, b.BAccountLast4 ? `····${b.BAccountLast4}` : null].filter(Boolean).join(" · ") || undefined}
            selected={selected === b.BId}
            onPress={() => { onSelect(b.BId); setOpen(false); }}
          />
        ))}
      </SheetPicker>
    </>
  );
}

export function ApprovalInboxDetailModal({
  item, onClose, onActionDone, onOpenBooking,
}: {
  item: InboxItem | null;
  onClose: () => void;
  onActionDone: (recordId: string, module: string) => void;
  onOpenBooking?: (bookingId: number, title?: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [acting, setActing] = useState<"approve" | "reject" | "confirm" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [financeBank, setFinanceBank] = useState<number | null>(null);
  const [financeMode, setFinanceMode] = useState<string>("");
  const [receivedPaymentBank, setReceivedPaymentBank] = useState<number | null>(null);

  const cfg = item ? MODULE_CONFIG[item.Module] : undefined;
  const isFinanceRefund = item?.Module === FINANCE_APPROVE_MODULE;
  const isBookingApproval = item ? OPEN_BOOKING_MODULES.has(item.Module) : false;

  const isReceivedPayment = item?.Module === "received-payment";
  // Computed early (before early return) so queries can use it in their enabled flag.
  const bankReviewBlocked = item ? needsBankReview(item) : false;

  // Finance refund and received-payment both need a project bank picker.
  // received-payment detail uses RPProjectId; refund uses ProjectId.
  const projectId = detail
    ? (detail.ProjectId ?? detail.projectId ?? detail.RPProjectId ?? null)
    : null;
  const needsBankPicker = (isFinanceRefund || (isReceivedPayment && bankReviewBlocked)) && !!projectId;
  const { data: projectBanks } = useQuery<{ BId: number; BName: string; BBranch?: string; BAccountLast4?: string }[]>({
    queryKey: ["project-banks", projectId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/crm/project-banks/for-project/${projectId}?excludeCash=1`);
      if (!res.ok) return [];
      const d = await res.json().catch(() => []);
      return Array.isArray(d) ? d : [];
    },
    enabled: needsBankPicker,
  });
  const { data: paymentModes } = useQuery<string[]>({
    queryKey: ["finance-payment-modes"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/crm/refunds/payment-modes");
      if (!res.ok) return [];
      const d = await res.json().catch(() => ({}));
      // Response is { modes: string[], transfer: string[] }
      return Array.isArray(d?.modes) ? d.modes : [];
    },
    enabled: isFinanceRefund,
  });

  useEffect(() => {
    if (!item) return;
    setDetail(null);
    setFetchFailed(false);
    setRejecting(false);
    setRejectNote("");
    setFinanceBank(null);
    setFinanceMode("");
    setReceivedPaymentBank(null);
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
  const summary = [
    { label: "Date", value: fmtDate(item.RecordDate) },
    { label: "Amount", value: item.Module === "civilworkdpr-approval" && item.Amount == null ? item.ActivityName || "—" : fmtAmount(item.Amount) },
    { label: "Party", value: party, wide: true },
    { label: "Created by", value: item.CreatedBy || "—" },
    { label: "Approved by", value: item.ApprovedBy || "—" },
    ...(item.RejectedBy ? [{ label: "Rejected by", value: item.RejectedBy }] : []),
    ...(item.SourceTransferDocNo ? [{ label: "Transfer", value: `${item.SourceTransferDocNo}${item.FromGodownName && item.ToGodownName ? ` · ${item.FromGodownName} → ${item.ToGodownName}` : ""}`, wide: true }] : []),
  ];
  const lines: PdfLine[] = lineItems.map((li) => {
    const name = String(li.ItemName ?? li.itemName ?? li.Description ?? li.itemDescription ?? "—");
    const qty = Number(li.Quantity ?? li.quantity ?? 0);
    const uom = String(li.UOMName ?? li.UomName ?? li.uomName ?? li.UOMSymbol ?? li.Symbol ?? li.UOMCode ?? li.uomCode ?? li.Unit ?? li.unit ?? li.uom ?? "");
    const rate = Number(li.Rate ?? li.rate ?? 0);
    const amount = Number(li.LineAmount ?? li.amount ?? qty * rate);
    const q = `${qty.toLocaleString("en-IN")}${uom ? ` ${uom}` : ""}`;
    return isMaterialRequest ? { name, qty: q } : { name, qty: q, rate: formatINR(rate), amount: formatINR(amount) };
  });
  const stageText = item._stage ? `${item.Status} · ${item._stage.label}` : item.Status;

  const download = async () => {
    setDownloading(true);
    try {
      // A Bill of Quantities prints in the web app's invoice-style BOQ format instead of the generic sheet.
      if (item.Module === "boq" && detail) {
        await shareBoqPdf({ BoqID: item.RecordId, Status: item.Status, ...(detail as BoqPdfRecord) });
        return;
      }
      await downloadApprovalPdf({
        module: cfg?.label ?? item.ModuleLabel,
        reference: item.Reference || `#${item.RecordId}`,
        status: stageText,
        summary: summary.map(({ label, value }) => ({ label, value: String(value) })),
        rejectionNote: item.RejectionNote,
        lines,
        quantityOnly: isMaterialRequest,
        fields: extraFields.map(([k, v]) => ({ label: labelizeKey(k), value: formatPreviewValue(v) })),
      });
    } catch (e: any) {
      Alert.alert("Could not make the PDF", e?.message || "Something went wrong.");
    } finally {
      setDownloading(false);
    }
  };

  const pending = item.Status === "Pending";
  const engineerConfirm = item.Module === "work-allocation-engineer";
  const notYourLevel = pending && item._canAct === false;

  const doAction = async (action: "approve" | "reject") => {
    setActing(action);
    try {
      const approveBody = (action === "approve" && isFinanceRefund)
        ? { RefundBankLHeadId: financeBank ?? undefined, PaymentMode: financeMode || undefined }
        : undefined;
      await runApprovalAction(cfg?.apiEndpoint ?? `/api/${item.Module}`, item.RecordId, action, {
        note: action === "reject" ? rejectNote : undefined,
        actionPathSuffix: SUB_GATE_SUFFIX[item.Module],
        approveBody,
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
    <View style={{ gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: S.rule, backgroundColor: S.paper }}>{children}</View>
  );

  const footer = !pending ? null : engineerConfirm ? (
    foot(<Key tone="ink" label={acting === "confirm" ? "Confirming…" : "Confirm assignment"} icon={<CheckCircle2 size={13} color={S.paper} />} onPress={doConfirm} disabled={acting !== null} />)
  ) : notYourLevel ? (
    foot(
      <View style={{ minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: S.wash }}>
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
  ) : bankReviewBlocked ? (
    foot(
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Key tone="red" label="Reject" icon={<XCircle size={13} color="#ffffff" />} onPress={() => setRejecting(true)} disabled={acting !== null} />
        <Key
          tone="ink"
          label={acting === "approve" ? "Saving…" : "Set Bank & Approve"}
          icon={<CheckCircle2 size={13} color={S.paper} />}
          onPress={async () => {
            if (!receivedPaymentBank) {
              Alert.alert("Select a deposit bank", "Pick the bank account the cheque will be deposited to before approving.");
              return;
            }
            setActing("approve");
            try {
              await setReceivedPaymentDepositBank(item.RecordId, receivedPaymentBank);
              await runApprovalAction(cfg?.apiEndpoint ?? "/api/received-payment", item.RecordId, "approve", {
                actionPathSuffix: SUB_GATE_SUFFIX[item.Module],
              });
              onActionDone(item.RecordId, item.Module);
              onClose();
            } catch (e: any) {
              Alert.alert("Could not complete", e.message || "Something went wrong.");
            } finally {
              setActing(null);
            }
          }}
          disabled={acting !== null}
          style={{ flex: 1 }}
        />
      </View>,
    )
  ) : isBookingApproval ? (
    foot(
      <>
        <View style={{ borderRadius: 10, borderWidth: 1, borderColor: S.line15, backgroundColor: S.wash, padding: 12, gap: 4 }}>
          <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 13, color: S.ink }}>{"Review booking before approving"}</Text>
          <Body size={12.5} color={S.ink2}>{"Open the booking to check the figures, documents, and payment schedule — then approve or reject from there."}</Body>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Key tone="red" label="Reject" icon={<XCircle size={13} color="#ffffff" />} onPress={() => setRejecting(true)} disabled={acting !== null} />
          <Key
            tone="ink"
            label="Open Booking"
            icon={<Home size={13} color={S.paper} />}
            onPress={() => {
              onClose();
              onOpenBooking?.(Number(item.RecordId), item.Reference ?? undefined);
            }}
            disabled={acting !== null}
            style={{ flex: 1 }}
          />
        </View>
      </>,
    )
  ) : (
    foot(
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Key tone="red" label="Reject" icon={<XCircle size={13} color="#ffffff" />} onPress={() => setRejecting(true)} disabled={acting !== null} />
        <Key
          tone="ink"
          label={acting === "approve" ? "Approving…" : isFinanceRefund ? "Approve Refund" : "Approve"}
          icon={<CheckCircle2 size={13} color={S.paper} />}
          onPress={() => doAction("approve")}
          disabled={acting !== null}
          style={{ flex: 1 }}
        />
      </View>,
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
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <SheetMark text={stageText} tone={/draft/i.test(item.Status) ? "draft" : statusTone(item.Status)} />
        {/* Waits for the full record, so the PDF carries every field the page shows. */}
        <Key
          label={downloading ? "Preparing…" : loading ? "Loading…" : "Download PDF"}
          icon={<Download size={13} color={S.ink} />}
          onPress={download}
          disabled={downloading || loading}
          style={{ minHeight: 36, paddingHorizontal: 12 }}
        />
      </View>

      <InfoGrid items={summary} />

      {!!item.RejectionNote && <Notice>{`Rejection note: ${item.RejectionNote}`}</Notice>}

      {lineItems.length > 0 && (
        <Panel title={`Items (${lineItems.length})`} icon={<ClipboardList size={14} color={S.ink} />}>
          <LineList
            rows={lines.map((l, i) =>
              isMaterialRequest ? { key: i, title: l.name, right: l.qty } : { key: i, title: l.name, note: `${l.qty} × ${l.rate}`, right: l.amount ?? "" },
            )}
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

      {/* Received payment: Accounts picks the deposit bank before approving. */}
      {isReceivedPayment && pending && bankReviewBlocked && !notYourLevel && (
        <Panel title="Deposit bank" icon={<Banknote size={14} color={S.ink} />}>
          <Body size={12.5} color={S.ink2}>{"The cheque is received — pick the company bank account it will be deposited to. This is saved and the payment is approved in one step."}</Body>
          {!projectId ? (
            <Body size={12.5} color={S.graphite}>{loading ? "Loading payment details…" : "Could not read the project — set the deposit bank from the web app."}</Body>
          ) : projectBanks && projectBanks.length > 0 ? (
            <BankPicker banks={projectBanks} selected={receivedPaymentBank} onSelect={setReceivedPaymentBank} />
          ) : (
            <Body size={12.5} color={S.graphite}>{"Loading bank accounts…"}</Body>
          )}
        </Panel>
      )}

      {/* Finance refund: bank + payment-mode pickers live in the scrollable body so they don't overflow a fixed footer. */}
      {isFinanceRefund && pending && !notYourLevel && (
        <Panel title="Refund payout details" icon={<Banknote size={14} color={S.ink} />}>
          {projectBanks && projectBanks.length > 0 ? (
            <BankPicker banks={projectBanks} selected={financeBank} onSelect={setFinanceBank} />
          ) : (
            <Body size={12.5} color={S.graphite}>{!projectId ? (loading ? "Loading refund details…" : "No project — pick bank on web") : "Loading banks…"}</Body>
          )}
          <PaymentModePicker modes={paymentModes ?? []} selected={financeMode} onSelect={setFinanceMode} />
        </Panel>
      )}

      {!pending && (
        <Text style={{ fontFamily: fonts.body.regular, fontSize: 12, color: S.graphite }}>{`This record is ${item.Status.toLowerCase()}; there is nothing to act on.`}</Text>
      )}
    </FormPage>
  );
}
