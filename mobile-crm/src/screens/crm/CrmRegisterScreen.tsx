// Any CRM list (crmRegisters.ts) on the phone: a search box, the statuses present as quick filters, a Filter & sort
// sheet (project, period, order), and one card per row with the buyer's Call / WhatsApp keys and the list's own job
// (Log call). Tap a card for the booking, customer, ticket or document. The same rows the web page shows.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronRight, Plus, Search, SlidersHorizontal, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { DataList } from "@/components/list/DataList";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { openDocument } from "@/utils/documents";
import { toast } from "@/components/Toast";
import { DateField } from "@/components/form/DateField";
import { useAuth } from "@/auth/AuthContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { pairParent, registerByKey, type ActionDialog, type CardAction, type CrmOpen, type CrmRegister, type EditForm } from "./crmRegisters";
import { AccentAvatar, ActionKey, CRM, ContactKeys, Figure, Pill, useCardStyle } from "./ui";

const ALL = "All";

/** The pages a card may open: a booking with Bookings or Payment Milestones rights, a customer with Customer 360, a
 * ticket with Service Tickets. */
export function useCrmCanOpen() {
  const { canAccessPage, canDoAction } = useAuth();
  return (o: CrmOpen | null | undefined): o is CrmOpen =>
    !!o && (o.to === "document" || (o.to === "application" ? canDoAction("crm-applications", "edit") :
      (o.to === "booking" ? canAccessPage("crm-bookings") || canAccessPage("crm-payments")
        : o.to === "payment-plan" ? canAccessPage("crm-payments") || canAccessPage("crm-bookings")
        : o.to === "ticket" ? canAccessPage("crm-service-tickets")
        : o.to === "construction-updates" ? canAccessPage("crm-construction-updates")
        : o.to === "oc-cc-board" ? canAccessPage("crm-oc-cc")
        : o.to === "cancellation" ? canAccessPage("crm-cancellations")
        : o.to === "refund" ? canAccessPage("crm-refunds")
        : o.to === "invoice" ? canAccessPage("crm-invoices")
        : o.to === "resale" ? canAccessPage("crm-resales")
        : o.to === "money-receipt" ? canAccessPage("crm-money-receipts")
        : o.to === "brokerage" ? canAccessPage("crm-brokerage")
        : o.to === "transfer-deed" ? canAccessPage("crm-transfer-deeds")
        : o.to === "ownership-change" ? canAccessPage("crm-ownership-changes")
    : o.to === "agreement" ? canAccessPage("crm-agreements")
    : o.to === "sale-deed" ? canAccessPage("crm-sales-deed")
    : o.to === "noc" ? canAccessPage("crm-noc")
    : o.to === "mutation" ? canAccessPage("crm-mutation")
    : o.to === "bank-details" ? canAccessPage("crm-customer-bank-details")
    : o.to === "oc-cc-cert" ? canAccessPage("crm-oc-cc")
    : o.to === "afs-qp" ? canAccessPage("crm-afs-query-payment")
    : o.to === "possession" ? canAccessPage("crm-pre-possession") || canAccessPage("crm-possession-notice") || canAccessPage("crm-handover")
    : o.to === "parking-allotment" ? canAccessPage("crm-parking-booking")
    : o.to === "welcome-call" ? canAccessPage("crm-welcome-calls")
    : o.to === "on-account" ? canAccessPage("crm-payments")
    : o.to === "credit-note" ? canAccessPage("crm-refunds")
    : o.to === "unit-change" ? canAccessPage("crm-bookings")
    : o.to === "legal-milestone" ? canAccessPage("crm-legal-milestones")
    : o.to === "loan-tracking" ? canAccessPage("crm-loan-details")
    : o.to === "booking-amendment" ? canAccessPage("crm-bookings")
    : o.to === "demand-detail" ? canAccessPage("crm-payments")
    : o.to === "payment" ? canAccessPage("crm-payments")
        : canAccessPage("crm-customer-360"))));
}

export function useCrmOpen() {
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const canOpen = useCrmCanOpen();
  return (o: CrmOpen | null | undefined) => {
    if (!canOpen(o)) return;
    if (o.to === "booking") nav.navigate("CrmBooking", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "payment-plan") nav.navigate("CrmBooking", { bookingId: o.bookingId, title: o.title, focus: "money" });
    else if (o.to === "customer") nav.navigate("CrmCustomer", { customerId: o.customerId, title: o.title });
    else if (o.to === "ticket") nav.navigate("CrmTicket", { ticketId: o.ticketId });
    else if (o.to === "application") nav.navigate("CrmApplicationForm", { applicationId: o.applicationId });
    else if (o.to === "construction-updates") nav.navigate("CrmConstructionUpdates", { projectId: o.projectId, projectName: o.projectName });
    else if (o.to === "oc-cc-board") nav.navigate("CrmOcCcBoard", undefined);
    else if (o.to === "cancellation") nav.navigate("CrmCancellation", { cancellationId: o.cancellationId, title: o.title });
    else if (o.to === "refund") nav.navigate("CrmRefund", { refundId: o.refundId, title: o.title });
    else if (o.to === "invoice") nav.navigate("CrmInvoice", { invoiceId: o.invoiceId, title: o.title });
    else if (o.to === "resale") nav.navigate("CrmResale", { resaleId: o.resaleId, title: o.title });
    else if (o.to === "money-receipt") nav.navigate("CrmMoneyReceipt", { receiptId: o.receiptId, title: o.title });
    else if (o.to === "brokerage") nav.navigate("CrmBrokerage", { brokerageId: o.brokerageId, title: o.title });
    else if (o.to === "transfer-deed") nav.navigate("CrmTransferDeed", { deedId: o.deedId, title: o.title });
    else if (o.to === "ownership-change") nav.navigate("CrmOwnershipChange", { changeId: o.changeId, title: o.title });
    else if (o.to === "agreement") nav.navigate("CrmAgreement", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "sale-deed") nav.navigate("CrmSaleDeed", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "noc") nav.navigate("CrmNoc", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "mutation") nav.navigate("CrmMutation", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "bank-details") nav.navigate("CrmBankDetails", { bookingId: o.bookingId, row: o.row });
    else if (o.to === "oc-cc-cert") nav.navigate("CrmOcCcCert", { cert: o.cert });
    else if (o.to === "afs-qp") nav.navigate("CrmAfsQueryPayment", { id: o.id, title: o.title });
    else if (o.to === "possession") nav.navigate("CrmPossession", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "parking-allotment") nav.navigate("CrmParkingAllotment", { allotment: o.allotment });
    else if (o.to === "welcome-call") nav.navigate("CrmWelcomeCall", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "on-account") nav.navigate("CrmOnAccountAdjust", { deposit: o.deposit });
    else if (o.to === "credit-note") nav.navigate("CrmCreditNote", { creditNoteId: o.creditNoteId, title: o.title });
    else if (o.to === "unit-change") nav.navigate("CrmUnitChange", { changeId: o.changeId, title: o.title });
    else if (o.to === "legal-milestone") nav.navigate("CrmLegalMilestone", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "loan-tracking") nav.navigate("CrmLoanTracking", { bookingId: o.bookingId, title: o.title });
    else if (o.to === "booking-amendment") nav.navigate("CrmBookingAmendment", { amendmentId: o.amendmentId, title: o.title, amendment: o.amendment });
    else if (o.to === "demand-detail") nav.navigate("CrmDemandDetail", { milestoneId: o.milestoneId, title: o.title, demand: o.demand });
    else if (o.to === "payment") nav.navigate("CrmPayment", { bookingId: o.bookingId, milestoneId: o.milestoneId, title: o.title });
    else openDocument(o.path, o.name).catch((e: Error) => Alert.alert("Could not open", e.message));
  };
}

// ── Filter & sort ────────────────────────────────────────────────────────────
type Period = "all" | "month" | "lastMonth" | "year";
const PERIODS: { value: Period; label: string }[] = [
  { value: "all", label: "Any time" }, { value: "month", label: "This month" }, { value: "lastMonth", label: "Last month" }, { value: "year", label: "This year" },
];
type Sort = "default" | "newest" | "oldest" | "amountHigh" | "amountLow" | "name";
const SORTS: { value: Sort; label: string; needs?: "date" | "amount" }[] = [
  { value: "default", label: "As listed" },
  { value: "newest", label: "Newest first", needs: "date" },
  { value: "oldest", label: "Oldest first", needs: "date" },
  { value: "amountHigh", label: "Amount: high to low", needs: "amount" },
  { value: "amountLow", label: "Amount: low to high", needs: "amount" },
  { value: "name", label: "Name: A to Z" },
];

function inPeriod(d: string | null | undefined, p: Period) {
  if (p === "all") return true;
  if (!d) return false;
  const t = new Date(d);
  const now = new Date();
  if (p === "year") return t.getFullYear() === now.getFullYear();
  const ref = p === "month" ? now : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return t.getFullYear() === ref.getFullYear() && t.getMonth() === ref.getMonth();
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, borderWidth: 1,
      borderColor: active ? `${CRM}80` : colors.border, backgroundColor: active ? `${CRM}22` : colors.card }}>
      <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: active ? colors.foreground : colors.mutedForeground }}>{label}</Text>
    </Pressable>
  );
}

function FilterSheet({ open, onClose, reg, projects, project, setProject, period, setPeriod, sort, setSort, onReset }: {
  open: boolean; onClose: () => void; reg: CrmRegister; projects: string[];
  project: string; setProject: (v: string) => void; period: Period; setPeriod: (v: Period) => void; sort: Sort; setSort: (v: Sort) => void; onReset: () => void;
}) {
  const insets = useSafeAreaInsets();
  const sorts = SORTS.filter((s) => !s.needs || (s.needs === "date" ? !!reg.dateOf : !!reg.amountOf));
  const group = (title: string, children: React.ReactNode) => (
    <View style={{ marginBottom: 18 }}>
      <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: colors.mutedForeground, textTransform: "uppercase", letterSpacing: 1.4, marginBottom: 10 }}>{title}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>
    </View>
  );
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderColor: colors.border, maxHeight: "80%", paddingBottom: insets.bottom + 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 18, paddingBottom: 10 }}>
          <Text style={{ fontSize: 16, fontFamily: fonts.heading.bold, color: colors.foreground }}>Filter & sort</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={18} color={colors.mutedForeground} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 18 }}>
          {projects.length > 1 ? group("Project", [ALL, ...projects].map((p) => <Chip key={p} label={p === ALL ? "All projects" : p} active={project === p} onPress={() => setProject(p)} />)) : null}
          {reg.dateOf ? group("Period", PERIODS.map((p) => <Chip key={p.value} label={p.label} active={period === p.value} onPress={() => setPeriod(p.value)} />)) : null}
          {group("Sort", sorts.map((s) => <Chip key={s.value} label={s.label} active={sort === s.value} onPress={() => setSort(s.value)} />))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 18, paddingTop: 6 }}>
          <Pressable onPress={onReset} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: colors.foreground }}>Reset</Text>
          </Pressable>
          <Pressable onPress={onClose} style={{ flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12, backgroundColor: CRM }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: "#fff" }}>Show results</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** A setup list's add / edit form (crmRegisters.ts EditForm) as a bottom sheet: the fields, Save, and the server's
 * message when it refuses. Values go as typed; a blank number goes as null (the server's "not set"). */
function EditSheet({ form, row, onClose, onSaved, onOpen, canDelete }: { form: EditForm; row: Row | "new" | null; onClose: () => void; onSaved: () => void; onOpen?: { label: string; go: () => void } | null; canDelete?: boolean }) {
  const insets = useSafeAreaInsets();
  const isNew = row === "new";
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!row) return;
    const v: Record<string, unknown> = {};
    for (const f of form.fields) {
      const cur = row === "new" ? undefined : row[f.key];
      v[f.key] = f.kind === "switch" ? cur !== false && cur !== 0 : f.kind === "choice" && cur == null ? f.options?.[0]?.value ?? ""
        : cur == null ? "" : f.kind === "date" ? String(cur).slice(0, 10) : String(cur);
    }
    setVals(v); setErr(""); setBusy(false);
  }, [row, form]);
  const save = async () => {
    const body: Record<string, unknown> = {};
    for (const f of form.fields) {
      const v = vals[f.key];
      body[f.key] = f.kind === "number" ? (String(v ?? "").trim() === "" ? null : Number(v)) : f.kind === "date" ? (String(v ?? "").trim() || null)
        : f.kind === "text" ? String(v ?? "").trim() : v;
    }
    const problem = form.check?.(vals);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr("");
    try {
      const full = !isNew && form.extra ? { ...form.extra(row as Row), ...body } : body;
      let res: unknown;
      if (isNew) res = await crmSend(form.path, "POST", full);
      else res = await crmSend(form.savePath ? form.savePath(row as Row) : `${form.path}/${(row as Row).Id}`, "PUT", full);
      toast.success(form.saved ? form.saved(res) : "Saved");
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  // The web page's Delete: its confirm words, then DELETE path/:Id; locked (with the web's reason) while in use.
  const delLock = !isNew && row && form.del?.locked ? form.del.locked(row as Row) : null;
  const remove = () => {
    if (!form.del || isNew || !row) return;
    Alert.alert("Delete", form.del.ask(row as Row), [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        setBusy(true);
        try { const dres = await crmSend<{ message?: string }>(`${form.path}/${(row as Row).Id}`, "DELETE"); toast.success(dres?.message || form.del!.done); onSaved(); onClose(); }
        catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
      } },
    ]);
  };
  return (
    <Modal visible={!!row} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ flex: 1, fontSize: 18, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{isNew ? `New ${form.noun}` : `Edit ${form.noun}`}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close"><X size={18} color={colors.mutedForeground} /></Pressable>
        </View>
        {onOpen ? (
          <View style={{ flexDirection: "row" }}>
            <ActionKey outline label={onOpen.label} onPress={() => { onClose(); onOpen.go(); }} />
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
        {form.fields.map((f) => f.kind === "choice" ? (
          <View key={f.key} style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{f.label}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(f.options ?? []).map((o) => <Chip key={o.value} label={o.label} active={vals[f.key] === o.value} onPress={() => setVals((s) => ({ ...s, [f.key]: o.value }))} />)}
            </View>
          </View>
        ) : f.kind === "switch" ? (
          <View key={f.key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}>
            <Text style={{ fontSize: 14.5, fontFamily: fonts.body.medium, color: colors.foreground }}>{f.label}</Text>
            <Switch value={!!vals[f.key]} onValueChange={(on) => setVals((s) => ({ ...s, [f.key]: on }))} trackColor={{ true: CRM }} />
          </View>
        ) : (
          <View key={f.key} style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{f.label}</Text>
            <TextInput value={String(vals[f.key] ?? "")} onChangeText={(t) => setVals((s) => ({ ...s, [f.key]: t }))}
              keyboardType={f.kind === "number" ? "decimal-pad" : "default"} placeholder={f.hint ?? (f.kind === "date" ? "YYYY-MM-DD" : undefined)} placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: fonts.body.regular, color: colors.foreground, backgroundColor: colors.card }} />
          </View>
        ))}
        </ScrollView>
        {err ? <Text style={{ fontSize: 13, fontFamily: fonts.body.medium, color: "#ef4444" }}>{err}</Text> : null}
        <Pressable onPress={save} disabled={busy}
          style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: CRM, opacity: busy ? 0.6 : pressed ? 0.85 : 1 })}>
          {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text style={{ fontSize: 15, fontFamily: fonts.heading.semibold, color: "#fff" }}>{isNew ? `Add ${form.noun}` : "Save"}</Text>
        </Pressable>
        {canDelete && form.del && !isNew ? (
          delLock ? (
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, textAlign: "center" }}>{delLock}</Text>
          ) : (
            <Pressable onPress={remove} disabled={busy}
              style={({ pressed }) => ({ alignItems: "center", paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.destructive, opacity: busy ? 0.6 : pressed ? 0.8 : 1 })}>
              <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: colors.destructive }}>Delete</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </Modal>
  );
}

/** A web page's confirm dialog (crmRegisters.ts ActionDialog) as a bottom sheet: its title and line, the rows, the
 * warning, the notes box, its two keys; then its server call and its message. */
function ActionSheet({ d, onClose, onDone }: { d: ActionDialog | null; onClose: () => void; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState("");
  const [dateVal, setDateVal] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (d) { setNotes(""); setDateVal(""); setBusy(false); } }, [d]);
  if (!d) return null;
  const go = async () => {
    setBusy(true);
    try {
      const body = d.notes || d.send || d.date ? { ...(d.send ?? {}), ...(d.notes ? { [d.notes.key]: notes.trim() || undefined } : {}), ...(d.date ? { [d.date.key]: dateVal || undefined } : {}) } : undefined;
      const res = await crmSend(d.path, d.method, body);
      toast.success(d.done(res)); onDone(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };
  const tone = d.danger ? colors.destructive : CRM;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, gap: 14 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 18, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{d.title}</Text>
          {d.note ? <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{d.note}</Text> : null}
        </View>
        {d.body ? <Text style={{ fontSize: 14, lineHeight: 20, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{d.body}</Text> : null}
        {d.rows?.length ? (
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14 }}>
            {d.rows.map(([label, value], i) => (
              <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{label}</Text>
                <Text style={{ flexShrink: 1, textAlign: "right", fontSize: 13.5, fontFamily: fonts.body.medium, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{value || "—"}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {d.date ? <DateField label={d.date.label} value={dateVal} onChange={(v: string) => setDateVal(v)} /> : null}
        {d.info ? (
          <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.foreground }}>{d.info}</Text>
          </View>
        ) : null}
        {d.warn ? (
          <View style={{ borderWidth: 1, borderColor: `${colors.destructive}66`, borderLeftWidth: 3, borderLeftColor: colors.destructive, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.destructive }}>{d.warn}</Text>
          </View>
        ) : null}
        {d.notes ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontFamily: fonts.body.medium, color: colors.mutedForeground }}>{d.notes.label}</Text>
            <TextInput value={notes} onChangeText={setNotes} multiline placeholder={d.notes.placeholder} placeholderTextColor={`${colors.mutedForeground}99`}
              style={{ minHeight: 64, textAlignVertical: "top", borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14.5, fontFamily: fonts.body.regular, color: colors.foreground, backgroundColor: colors.card }} />
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable onPress={onClose} style={{ flex: 1, alignItems: "center", paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{d.cancel}</Text>
          </Pressable>
          <Pressable onPress={go} disabled={busy || (!!d.notes?.required && !notes.trim()) || (!!d.date?.required && !dateVal)}
            style={({ pressed }) => ({ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13, borderRadius: 14, backgroundColor: tone, opacity: busy || (!!d.notes?.required && !notes.trim()) ? 0.5 : pressed ? 0.85 : 1 })}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : null}
            <Text style={{ fontSize: 14.5, fontFamily: fonts.heading.semibold, color: "#fff" }}>{busy ? d.busy : d.confirm}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function CrmRegisterScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmRegister">>();
  const reg = registerByKey(params.register)!;
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const { canDoAction } = useAuth();
  const open = useCrmOpen();
  const canOpen = useCrmCanOpen();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const qc = useQueryClient();
  const [status, setStatus] = useState(ALL);
  const [project, setProject] = useState(ALL);
  const [period, setPeriod] = useState<Period>("all");
  const [sort, setSort] = useState<Sort>("default");
  const [sheet, setSheet] = useState(false);
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  // A paired list (Welcome Calls: To call / History) switches in place; filters start afresh on the other list.
  const parent = reg.pair ? reg : pairParent(reg.key);
  useEffect(() => { setStatus(ALL); setProject(ALL); setPeriod("all"); setSort("default"); }, [reg.key]);
  const card = useCardStyle();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const serverTerm = reg.serverSearch ? debounced : "";
  const query = useQuery({
    queryKey: ["crm", reg.key, serverTerm],
    queryFn: async () => {
      const qs = reg.serverSearch ? `?page=1&pageSize=200${serverTerm ? `&search=${encodeURIComponent(serverTerm)}` : ""}` : "";
      const body = await crmGet(`${reg.path}${qs}`);
      // Kept whole for the figures band, which reads the same response.
      qc.setQueryData(["crm-body", reg.key, serverTerm], body);
      return reg.rows(body);
    },
  });
  // The web page's figures band: from a summary route, or from the list's own response (read from the cache, no fetch).
  const bandQ = useQuery({
    queryKey: reg.band?.path ? ["crm-band", reg.key] : ["crm-body", reg.key, serverTerm],
    queryFn: () => crmGet(reg.band!.path!),
    enabled: !!reg.band?.path,
  });
  useEffect(() => { if (reg.band?.path && query.dataUpdatedAt) void bandQ.refetch(); }, [query.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const figures = reg.band && bandQ.data ? reg.band.figures(bandQ.data) : [];
  const lead = reg.band?.lead && bandQ.data ? reg.band.lead(bandQ.data) : null;
  const leadTotal = lead ? lead.bar.reduce((s, x) => s + x.amount, 0) : 0;

  const rows = query.data ?? [];
  const projectOf = (r: Row) => (reg.projectOf ? reg.projectOf(r) : r.ProjectName) || null;
  const statuses = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => { const v = reg.status?.(r); if (v) s.add(v); });
    return s.size > 1 ? [ALL, ...s] : [];
  }, [rows, reg]);
  const projects = useMemo(() => [...new Set(rows.map(projectOf).filter((p): p is string => !!p))].sort(), [rows, reg]);

  const items = useMemo(() => {
    const term = reg.serverSearch ? "" : debounced.toLowerCase();
    const out = rows.filter((r) =>
      (status === ALL || reg.status?.(r) === status) &&
      (project === ALL || projectOf(r) === project) &&
      (!reg.dateOf || inPeriod(reg.dateOf(r), period)) &&
      (!term || (reg.searchIn?.(r) ?? []).some((v) => v != null && String(v).toLowerCase().includes(term))));
    const time = (r: Row) => { const d = reg.dateOf?.(r); return d ? new Date(d).getTime() : 0; };
    const amt = (r: Row) => Number(reg.amountOf?.(r)) || 0;
    if (sort === "newest") out.sort((a, b) => time(b) - time(a));
    else if (sort === "oldest") out.sort((a, b) => time(a) - time(b));
    else if (sort === "amountHigh") out.sort((a, b) => amt(b) - amt(a));
    else if (sort === "amountLow") out.sort((a, b) => amt(a) - amt(b));
    else if (sort === "name") out.sort((a, b) => String(reg.title(a) ?? "").localeCompare(String(reg.title(b) ?? "")));
    return out;
  }, [rows, status, project, period, sort, debounced, reg]);

  const activeFilters = (project !== ALL ? 1 : 0) + (period !== "all" ? 1 : 0) + (sort !== "default" ? 1 : 0);
  const create = reg.createAction && reg.createAction.pages.some((p) => canDoAction(p, "create")) ? reg.createAction : null;
  // The card's key: the first of the list's keys this person may use whose `when` holds for the row.
  const actionsAll = reg.cardAction ? (Array.isArray(reg.cardAction) ? reg.cardAction : [reg.cardAction]) : [];
  // Keys only for approvers ask the server once (approval-workflows can-act, the web's useCanApprove).
  const approverModules = [...new Set(actionsAll.map((a) => a.approver).filter((m): m is string => !!m))];
  const approverQ = useQuery({ queryKey: ["can-act", ...approverModules], enabled: approverModules.length > 0, staleTime: 5 * 60_000,
    queryFn: async () => Object.fromEntries(await Promise.all(approverModules.map(async (m) =>
      [m, await crmGet<{ canAct: boolean }>(`/api/approval-workflows/can-act?module=${encodeURIComponent(m)}`).then((d) => !!d.canAct).catch(() => false)] as const))) });
  const actions = actionsAll.filter((a) => a.pages.some((p) => canDoAction(p, a.right)) && (!a.approver || !!approverQ.data?.[a.approver]));
  const actionsFor = (r: Row) => actions.filter((a) => !a.when || a.when(r));
  const actionFor = (r: Row) => actionsFor(r)[0] ?? null;
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const listAction = reg.listAction && reg.listAction.pages.some((p) => canDoAction(p, reg.listAction!.right)) ? reg.listAction : null;
  const [listBusy, setListBusy] = useState(false);
  const runAction = (r: Row, chosen?: CardAction) => {
    const action = chosen ?? actionFor(r);
    if (!action) return;
    if (action.dialog) { setDialog(action.dialog(r)); return; }
    if (action.call) {
      const c = action.call(r);
      crmSend(c.path, c.method).then((d) => { toast.success(c.done(d)); void query.refetch(); }).catch((e: Error) => toast.error(e.message));
      return;
    }
    if (action.to) { const to = action.to(r); (nav.navigate as (s: string, p?: object) => void)(to.screen, to.params); }
  };
  const form = reg.editForm;
  const canAdd = !!form && !form.noAdd && form.pages.some((p) => canDoAction(p, "create"));
  const canEdit = !!form && form.pages.some((p) => canDoAction(p, "edit"));

  return (
    <>
      <DataList<Row>
        query={query}
        items={items}
        keyOf={reg.id}
        filters={statuses}
        activeFilter={status}
        onFilter={setStatus}
        emptyText={debounced || status !== ALL || activeFilters ? "Nothing matches." : reg.empty}
        header={
          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            {parent?.pair ? (
              <View style={{ flexDirection: "row", padding: 4, borderRadius: 16, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginBottom: 10 }}>
                {[parent.key, parent.pair.key].map((k, i) => {
                  const on = reg.key === k;
                  return (
                    <Pressable key={k} onPress={() => !on && nav.setParams({ register: k } as never)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                      style={{ flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 12, backgroundColor: on ? CRM : "transparent" }}>
                      <Text style={{ fontSize: 13.5, fontFamily: fonts.heading.semibold, color: on ? "#fff" : colors.mutedForeground }}>{parent.pair!.labels[i]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
                <Search size={13} color={colors.mutedForeground} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search name, mobile, booking, unit…"
                  placeholderTextColor={`${colors.mutedForeground}99`}
                  style={{ flex: 1, color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 14, paddingVertical: 12 }}
                />
              </View>
              <Pressable onPress={() => setSheet(true)} accessibilityLabel="Filter and sort"
                style={{ width: 48, alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1, borderColor: activeFilters ? `${CRM}80` : colors.border, backgroundColor: activeFilters ? `${CRM}22` : colors.card }}>
                <SlidersHorizontal size={16} color={activeFilters ? CRM : colors.mutedForeground} />
                {activeFilters ? (
                  <View style={{ position: "absolute", top: -5, right: -5, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: CRM, alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color: "#fff", fontSize: 9, fontFamily: fonts.heading.bold }}>{activeFilters}</Text>
                  </View>
                ) : null}
              </Pressable>
            </View>
            {create ? (
              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <ActionKey label={create.label} icon={Plus} onPress={() => (nav.navigate as (s: string, p?: object) => void)(create.screen, create.params)} />
              </View>
            ) : null}
            {lead ? (
              <View style={{ marginTop: 10, gap: 6 }}>
                <Text style={{ fontSize: 24, fontFamily: fonts.heading.bold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{lead.value}</Text>
                <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{lead.note}</Text>
                <View style={{ flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: colors.border }}>
                  {lead.bar.filter((x) => x.amount > 0).map((x, i) => (
                    <View key={i} style={{ width: `${leadTotal > 0 ? (x.amount / leadTotal) * 100 : 0}%`, minWidth: 3,
                      backgroundColor: x.tone === "danger" ? colors.destructive : x.tone === "accent" ? CRM : colors.mutedForeground }} />
                  ))}
                </View>
              </View>
            ) : null}
            {figures.length ? (
              <View style={{ gap: 10, marginTop: 10 }}>
                {[0, 2].map((i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 10 }}>
                    {figures.slice(i, i + 2).map((f) => <Figure key={f.label} label={f.label} value={f.value} sub={f.note} tone={f.alert ? colors.destructive : undefined} />)}
                  </View>
                ))}
              </View>
            ) : null}
            {listAction ? (
              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <ActionKey label={listBusy && listAction.call ? listAction.call.busy : listAction.label} onPress={() => {
                  if (listAction.screen) { nav.navigate(listAction.screen as never); return; }
                  if (listAction.dialog) { setDialog(listAction.dialog(project !== ALL ? project : null)); return; }
                  const c = listAction.call;
                  if (!c || listBusy) return;
                  setListBusy(true);
                  crmSend(c.path, c.method).then((d) => { toast.success(c.done(d)); void query.refetch(); })
                    .catch((e: Error) => toast.error(e.message || "That didn't go through")).finally(() => setListBusy(false));
                }} />
              </View>
            ) : null}
            {canAdd ? (
              <View style={{ flexDirection: "row", marginTop: 10 }}>
                <ActionKey label={`New ${form!.noun}`} icon={Plus} onPress={() => setEditing("new")} />
              </View>
            ) : null}
            {query.data ? (
              <Text style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 10, paddingHorizontal: 4 }}>
                {items.length === rows.length ? `${rows.length} shown` : `${items.length} of ${rows.length} shown`}
                {project !== ALL ? ` · ${project}` : ""}
                {period !== "all" ? ` · ${PERIODS.find((p) => p.value === period)?.label}` : ""}
              </Text>
            ) : null}
          </View>
        }
        renderCard={(r) => {
          const t = reg.open?.(r);
          const target = canOpen(t) ? t : null;
          const st = reg.status?.(r);
          const amount = reg.amount?.(r);
          const mobile = reg.mobile ? reg.mobile(r) : r.Mobile;
          const lines = (reg.lines?.(r) ?? []).filter((l): l is string => typeof l === "string" && l.trim() !== "");
          const action = actionFor(r);
          const rowActions = actionsFor(r);
          const footer = !!(amount || mobile || action);
          const avatarText = reg.avatar?.(r);
          const initText = avatarText ? (avatarText).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((p: string) => p[0]).join("").toUpperCase() || "?" : null;
          // If this row has a navigable target (booking, invoice, etc.), tap goes there;
          // the edit sheet opens only for pure setup registers that have no dedicated screen.
          const tapEdits = canEdit && !target;
          return (
            <Pressable
              disabled={!target && !canEdit}
              onPress={() => (tapEdits ? setEditing(r) : open(target))}
              style={({ pressed }) => ({
                ...card, padding: 16, marginBottom: 12, opacity: pressed ? 0.8 : 1,
              })}
            >
              {/* Who and where it stands, then the details, then the money and the keys. */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                {initText ? <AccentAvatar text={initText} size={40} /> : null}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: colors.foreground }}>{reg.title(r) || "—"}</Text>
                  {reg.sub(r) ? <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: fonts.body.regular, color: colors.mutedForeground, marginTop: 3, fontVariant: ["tabular-nums"] }}>{reg.sub(r)}</Text> : null}
                </View>
                {st ? <Pill label={st} /> : null}
                {(target || tapEdits) && !footer ? <ChevronRight size={18} color={colors.mutedForeground} style={{ marginTop: 2 }} /> : null}
              </View>
              {lines.length ? (
                <View style={{ marginTop: 10, gap: 4 }}>
                  {lines.map((l, i) => (
                    <Text key={i} numberOfLines={2} style={{ fontSize: 13, fontFamily: fonts.body.regular, color: i === 0 ? colors.foreground : colors.mutedForeground }}>{l}</Text>
                  ))}
                </View>
              ) : null}
              {footer ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    {amount ? (
                      <>
                        <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: colors.mutedForeground }}>{amount.label}</Text>
                        <Text style={{ fontSize: 15.5, fontFamily: fonts.heading.semibold, color: colors.foreground, fontVariant: ["tabular-nums"] }}>{amount.value}</Text>
                      </>
                    ) : null}
                  </View>
                  {mobile ? <ContactKeys mobile={mobile} compact /> : null}
                  {action ? rowActions.map((a) => {
                    const c = a.danger ? colors.destructive : CRM;
                    return (
                      <Pressable key={a.label} onPress={() => runAction(r, a)}
                        style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c, backgroundColor: a.outline ? "transparent" : c, opacity: pressed ? 0.75 : 1 })}>
                        <Text style={{ fontSize: 12, fontFamily: fonts.heading.semibold, color: a.outline ? c : "#fff" }}>{a.label}</Text>
                      </Pressable>
                    );
                  }) : target || tapEdits ? <ChevronRight size={18} color={colors.mutedForeground} /> : null}
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
      <FilterSheet open={sheet} onClose={() => setSheet(false)} reg={reg} projects={projects}
        project={project} setProject={setProject} period={period} setPeriod={setPeriod} sort={sort} setSort={setSort}
        onReset={() => { setProject(ALL); setPeriod("all"); setSort("default"); }} />
      <ActionSheet d={dialog} onClose={() => setDialog(null)} onDone={() => { void query.refetch(); }} />
      {form ? <EditSheet form={form} row={editing} canDelete={form.pages.some((p) => canDoAction(p, "delete"))} onClose={() => setEditing(null)} onSaved={() => { void query.refetch(); }}
        onOpen={(() => { const t = editing && editing !== "new" ? reg.open?.(editing) : null; return t && canOpen(t) ? { label: t.to === "booking" ? "Open booking" : "Open", go: () => open(t) } : null; })()} /> : null}
    </>
  );
}

