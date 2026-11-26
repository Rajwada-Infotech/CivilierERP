// Mutation (Khata Transfer) tracker: starts after the Sale Deed Registry is
// Completed. Workflow: Applied → QueryRaised → (resubmit) → Applied → Approved.
// Endpoints:
//   GET  /api/crm/mutation/booking/:bookingId → mutation row or null
//   GET  /api/crm/mutation/eligible-bookings  → bookings with completed registry
//   POST /api/crm/mutation                    → create tracker
//   PUT  /api/crm/mutation/:id                → update fields
//   PUT  /api/crm/mutation/:id/query          → raise query (Remarks required)
//   PUT  /api/crm/mutation/:id/resubmit       → resubmit after query resolved
//   PUT  /api/crm/mutation/:id/approve        → mark Approved (NewKhataNo required)
import { useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { FileText } from "lucide-react-native";
import { useAuth } from "@/auth/AuthContext";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { TextField, RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { ActionKey, Empty, Kv, Pill, Section, fmtDate, joinDot, money, words } from "./ui";

const STATUS_COLOR: Record<string, string> = {
  Applied: "#f59e0b",
  QueryRaised: "#ef4444",
  Approved: "#10b981",
};

export default function CrmMutationScreen() {
  const { params } = useRoute<RouteProp<MainStackParamList, "CrmMutation">>();
  const initialBookingId = params?.bookingId;
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(initialBookingId ?? null);
  const [showPicker, setShowPicker] = useState(false);

  const { canDoAction } = useAuth();
  const b = useBrand();
  const qc = useQueryClient();

  const canCreate = canDoAction("crm-mutation", "create");
  const canEdit = canDoAction("crm-mutation", "edit");

  // Eligible bookings for when bookingId is not passed in route
  const eligibleQ = useQuery<Row[]>({
    queryKey: ["crm-mutation-eligible-bookings"],
    queryFn: () => crmGet<Row[]>("/api/crm/mutation/eligible-bookings").then((d) => (Array.isArray(d) ? d : [])),
    enabled: selectedBookingId == null,
  });

  const activeBookingId = selectedBookingId;

  const mutQ = useQuery<Row | null>({
    queryKey: ["crm-mutation-booking", activeBookingId],
    queryFn: () => crmGet<Row | null>(`/api/crm/mutation/booking/${activeBookingId!}`),
    enabled: activeBookingId != null,
  });

  const [busy, setBusy] = useState(false);

  // Create form state
  const [appNo, setAppNo] = useState("");
  const [appDate, setAppDate] = useState("");
  const [authority, setAuthority] = useState("");
  const [oldKhata, setOldKhata] = useState("");
  const [fee, setFee] = useState("");
  const [createRemarks, setCreateRemarks] = useState("");

  // Update form state
  const [appNoU, setAppNoU] = useState("");
  const [appDateU, setAppDateU] = useState("");
  const [authorityU, setAuthorityU] = useState("");
  const [oldKhataU, setOldKhataU] = useState("");
  const [feeU, setFeeU] = useState("");
  const [remarksU, setRemarksU] = useState("");
  const [showUpdate, setShowUpdate] = useState(false);

  // Status-transition state
  const [queryRemarks, setQueryRemarks] = useState("");
  const [showQuery, setShowQuery] = useState(false);
  const [newKhata, setNewKhata] = useState("");
  const [approvedNo, setApprovedNo] = useState("");
  const [approvedDate, setApprovedDate] = useState("");
  const [approveRemarks, setApproveRemarks] = useState("");
  const [showApprove, setShowApprove] = useState(false);

  const invalidate = () => {
    if (!activeBookingId) return;
    ["crm-mutation-booking", "crm-booking-legal-mil", "crm-booking", "crm-mutation-eligible-bookings"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k, activeBookingId] })
    );
  };

  const doAction = async (path: string, method: "POST" | "PUT", body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    try {
      await crmSend(path, method, body);
      toast.success(msg);
      invalidate();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const createMutation = async () => {
    if (!activeBookingId) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { BookingId: activeBookingId };
      if (appNo.trim()) payload.ApplicationNo = appNo.trim();
      if (appDate) payload.ApplicationDate = appDate;
      if (authority.trim()) payload.Authority = authority.trim();
      if (oldKhata.trim()) payload.OldKhataNo = oldKhata.trim();
      if (fee.trim()) payload.MutationFee = parseFloat(fee);
      if (createRemarks.trim()) payload.Remarks = createRemarks.trim();
      await crmSend("/api/crm/mutation", "POST", payload);
      toast.success("Mutation tracker started");
      invalidate();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  // If no booking selected yet, show eligible bookings picker
  if (!activeBookingId) {
    const eligible = eligibleQ.data ?? [];
    const options = eligible.map((e) => ({
      key: String(e.Id),
      label: `${e.ApplicantName} (${e.BookingNo})`,
      sublabel: [e.UnitNo && `Unit ${e.UnitNo}`, e.RegNo && `Registry ${e.RegNo}`, e.DeedNo && `Deed ${e.DeedNo}`].filter(Boolean).join(" · "),
    }));

    return (
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Section title="Start Property Mutation">
          <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textSecondary }}>
            Choose a booking whose Sale Deed Registry is Completed to start its Khata / Mutation tracker.
          </Text>
          <PickerRow
            label="Eligible Booking"
            required
            value=""
            placeholder={eligibleQ.isLoading ? "Loading eligible bookings…" : "Choose a booking…"}
            onPress={() => setShowPicker(true)}
          />
        </Section>

        <OptionPickerModal
          visible={showPicker}
          title="Select Booking for Mutation"
          options={options}
          searchable
          onSelect={(k) => {
            setSelectedBookingId(Number(k));
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      </ScrollView>
    );
  }

  if (mutQ.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface }}>
        <ActivityIndicator color={b.accent} />
      </View>
    );
  }
  if (mutQ.error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: b.surface, padding: 24 }}>
        <Text style={{ color: b.danger, fontFamily: fonts.body.medium, textAlign: "center" }}>
          {(mutQ.error as Error).message}
        </Text>
      </View>
    );
  }

  const mut = mutQ.data;
  const mutId = mut ? Number(mut.Id) : null;
  const status = mut?.Status as string | undefined;
  const isApplied = status === "Applied";
  const isQuery = status === "QueryRaised";
  const isApproved = status === "Approved";

  if (!mut) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>
        <View style={{ backgroundColor: b.warningSoft, borderRadius: 12, padding: 12, flexDirection: "row", gap: 8 }}>
          <FileText size={15} color={b.warning} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.body.regular, color: b.textPrimary }}>
            Mutation can only be started after the Sale Deed Registry is Completed.
          </Text>
        </View>
        {canCreate ? (
          <Section title="Start Mutation Tracker">
            <View style={{ gap: 12 }}>
              <TextField label="Application No. (optional)" value={appNo} onChangeText={setAppNo} />
              <DateField label="Application date (optional)" value={appDate} onChange={setAppDate} />
              <TextField label="Authority / Municipal Office (optional)" value={authority} onChangeText={setAuthority} />
              <TextField label="Old Khata No. (optional)" value={oldKhata} onChangeText={setOldKhata} />
              <TextField label="Mutation fee (₹, optional)" value={fee} onChangeText={setFee} keyboardType="numeric" />
              <RemarksField label="Remarks (optional)" value={createRemarks} onChangeText={setCreateRemarks} />
              <ActionKey label={busy ? "Starting…" : "Start Mutation Tracker"} onPress={createMutation} />
            </View>
          </Section>
        ) : (
          <Empty text="No mutation tracker yet." />
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: b.surface }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 56 }}>
      {/* Overview */}
      <Section title="Mutation">
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ fontSize: 14, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>{mut.MutationNo as string}</Text>
            <Pill label={status ?? "Applied"} />
          </View>
          {/* Deed link info */}
          {mut.DeedNo ? <Kv label="Sale Deed" value={joinDot(mut.DeedNo as string, mut.RegistrationNo as string | null)} /> : null}
          {mut.RegNo ? <Kv label="Registry" value={joinDot(mut.RegNo as string, mut.SubRegistrarOffice as string | null)} /> : null}
          {/* Application details */}
          {mut.ApplicationNo ? <Kv label="Application No." value={mut.ApplicationNo as string} /> : null}
          {mut.ApplicationDate ? <Kv label="Application date" value={fmtDate(mut.ApplicationDate)} /> : null}
          {mut.Authority ? <Kv label="Authority" value={mut.Authority as string} /> : null}
          {mut.OldKhataNo ? <Kv label="Old Khata No." value={mut.OldKhataNo as string} /> : null}
          {mut.NewKhataNo ? <Kv label="New Khata No." value={mut.NewKhataNo as string} /> : null}
          {mut.MutationFee ? <Kv label="Mutation fee" value={money(mut.MutationFee)} /> : null}
          {/* Approval */}
          {mut.ApprovedNo ? <Kv label="Approval No." value={mut.ApprovedNo as string} /> : null}
          {mut.ApprovedDate ? <Kv label="Approved date" value={fmtDate(mut.ApprovedDate)} /> : null}
          {/* Documents */}
          {Number(mut.DocsRequired) > 0 ? (
            <Kv label="Documents" value={`${mut.DocsVerified}/${mut.DocsRequired} verified — manage on web`} />
          ) : null}
          {/* Query remark */}
          {isQuery && mut.QueryRemarks ? (
            <View style={{ backgroundColor: b.dangerSoft, borderRadius: 10, padding: 10, marginTop: 4 }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.body.medium, color: b.textSecondary }}>Authority query</Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.body.regular, color: b.textPrimary, marginTop: 2 }}>{mut.QueryRemarks as string}</Text>
            </View>
          ) : null}
          {mut.Remarks ? <Kv label="Remarks" value={mut.Remarks as string} /> : null}
        </View>
      </Section>

      {/* Update fields */}
      {canEdit && !isApproved ? (
        <Section title="Update details">
          {!showUpdate ? (
            <ActionKey outline label="Edit mutation details" onPress={() => {
              setAppNoU(String(mut.ApplicationNo ?? ""));
              setAppDateU(mut.ApplicationDate ? String(mut.ApplicationDate).slice(0, 10) : "");
              setAuthorityU(String(mut.Authority ?? ""));
              setOldKhataU(String(mut.OldKhataNo ?? ""));
              setFeeU(mut.MutationFee ? String(mut.MutationFee) : "");
              setRemarksU(String(mut.Remarks ?? ""));
              setShowUpdate(true);
            }} />
          ) : (
            <View style={{ gap: 12 }}>
              <TextField label="Application No." value={appNoU} onChangeText={setAppNoU} />
              <DateField label="Application date" value={appDateU} onChange={setAppDateU} />
              <TextField label="Authority" value={authorityU} onChangeText={setAuthorityU} />
              <TextField label="Old Khata No." value={oldKhataU} onChangeText={setOldKhataU} />
              <TextField label="Mutation fee (₹)" value={feeU} onChangeText={setFeeU} keyboardType="numeric" />
              <RemarksField label="Remarks" value={remarksU} onChangeText={setRemarksU} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <ActionKey label={busy ? "Saving…" : "Save"} onPress={() =>
                  doAction(`/api/crm/mutation/${mutId}`, "PUT", {
                    ApplicationNo: appNoU || undefined, ApplicationDate: appDateU || undefined,
                    Authority: authorityU || undefined, OldKhataNo: oldKhataU || undefined,
                    MutationFee: feeU ? parseFloat(feeU) : undefined, Remarks: remarksU || undefined,
                  }, "Mutation updated").then(() => setShowUpdate(false))
                } />
                <ActionKey outline label="Cancel" onPress={() => setShowUpdate(false)} />
              </View>
            </View>
          )}
        </Section>
      ) : null}

      {/* Status actions */}
      {canEdit && !isApproved ? (
        <Section title="Actions">
          <View style={{ gap: 10 }}>
            {/* Raise query (Applied → QueryRaised) */}
            {isApplied && !showQuery && !showApprove ? (
              <ActionKey outline tone={b.danger} label="Raise authority query" onPress={() => setShowQuery(true)} />
            ) : null}
            {showQuery ? (
              <View style={{ gap: 8 }}>
                <RemarksField label="Query remarks (required)" value={queryRemarks} onChangeText={setQueryRemarks} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <ActionKey tone={b.danger} label={busy ? "Raising…" : "Raise query"}
                    onPress={() => { doAction(`/api/crm/mutation/${mutId}/query`, "PUT", { Remarks: queryRemarks }, "Query raised"); setShowQuery(false); }} />
                  <ActionKey outline label="Cancel" onPress={() => setShowQuery(false)} />
                </View>
              </View>
            ) : null}

            {/* Resubmit (QueryRaised → Applied) */}
            {isQuery ? (
              <ActionKey label={busy ? "Resubmitting…" : "Resubmit application"}
                onPress={() => doAction(`/api/crm/mutation/${mutId}/resubmit`, "PUT", {}, "Application resubmitted")} />
            ) : null}

            {/* Approve (Applied → Approved) */}
            {isApplied && !showQuery && !showApprove ? (
              <ActionKey label="Mark as Approved" onPress={() => setShowApprove(true)} />
            ) : null}
            {showApprove ? (
              <View style={{ gap: 8 }}>
                <TextField label="New Khata No. (required)" value={newKhata} onChangeText={setNewKhata} />
                <TextField label="Approval No. (optional)" value={approvedNo} onChangeText={setApprovedNo} />
                <DateField label="Approved date (optional)" value={approvedDate} onChange={setApprovedDate} />
                <RemarksField label="Remarks (optional)" value={approveRemarks} onChangeText={setApproveRemarks} />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <ActionKey label={busy ? "Approving…" : "Confirm approval"}
                    onPress={() => {
                      if (!newKhata.trim()) { toast.error("New Khata No. is required"); return; }
                      doAction(`/api/crm/mutation/${mutId}/approve`, "PUT", {
                        NewKhataNo: newKhata.trim(),
                        ApprovedNo: approvedNo.trim() || undefined,
                        ApprovedDate: approvedDate || undefined,
                        Remarks: approveRemarks.trim() || undefined,
                      }, "Mutation approved").then(() => setShowApprove(false));
                    }} />
                  <ActionKey outline label="Cancel" onPress={() => setShowApprove(false)} />
                </View>
              </View>
            ) : null}
          </View>
        </Section>
      ) : null}
    </ScrollView>
  );
}
