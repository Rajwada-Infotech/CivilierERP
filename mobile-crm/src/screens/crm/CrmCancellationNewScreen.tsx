// Create a new cancellation request (POST /api/crm/cancellations).
// 100% parity with web CrmCancellations.tsx:
// - Selects from eligible live bookings (GET /api/crm/cancellations/bookings)
// - Loads applicable cancellation policy (GET /api/crm/cancellations/policy?bookingId=X)
// - Supports Reason, optional DeductionPercent override
import { useState, useEffect } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Info } from "lucide-react-native";
import { crmGet, crmSend, type Row } from "@/api/crmApi";
import { toast } from "@/components/Toast";
import { FormScaffold, FormSection, TextField, RemarksField } from "@/components/form/Form";
import { OptionPickerModal, PickerRow } from "@/components/OptionPicker";
import { fonts } from "@/theme/fonts";
import { useBrand } from "@/theme/ThemeContext";
import type { MainStackParamList } from "@/navigation/MainStack";
import { Kv, money } from "./ui";

interface EligibleBooking {
  Id: number;
  BookingNo: string;
  UnitNo?: string | null;
  ApplicantName: string;
}

interface PolicyInfo {
  PolicyName?: string;
  DeductionPercent: number;
  RefundDueDays?: number;
  source?: string;
  Notes?: string;
}

export default function CrmCancellationNewScreen() {
  const b = useBrand();
  const qc = useQueryClient();
  const nav = useNavigation<NativeStackNavigationProp<MainStackParamList>>();

  const [bookingId, setBookingId] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [deductionPct, setDeductionPct] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [showPicker, setShowPicker] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Eligible bookings
  const bookingsQ = useQuery<EligibleBooking[]>({
    queryKey: ["crm-cancellation-eligible-bookings"],
    queryFn: () => crmGet<EligibleBooking[]>("/api/crm/cancellations/bookings").then((d) => (Array.isArray(d) ? d : [])),
  });

  // Policy for selected booking
  const policyQ = useQuery<PolicyInfo | null>({
    queryKey: ["crm-cancellation-policy", bookingId],
    queryFn: () => (bookingId ? crmGet<PolicyInfo>(`/api/crm/cancellations/policy?bookingId=${bookingId}`) : null),
    enabled: !!bookingId,
  });

  // When policy loads, set default deduction % if not manually modified
  useEffect(() => {
    if (policyQ.data && deductionPct === "") {
      const defaultPct = policyQ.data.DeductionPercent;
      if (defaultPct !== undefined && defaultPct !== null) {
        setDeductionPct(String(defaultPct));
      }
    }
  }, [policyQ.data]);

  const selectedBooking = (bookingsQ.data ?? []).find((bkg) => String(bkg.Id) === bookingId);

  const handleSubmit = async () => {
    if (!bookingId) {
      toast.error("Please select a booking to cancel");
      return;
    }
    if (!reason.trim()) {
      toast.error("Please enter the reason for cancellation");
      return;
    }
    const pct = deductionPct.trim() ? parseFloat(deductionPct) : undefined;
    if (pct !== undefined && (isNaN(pct) || pct < 0 || pct > 100)) {
      toast.error("Cancellation charge must be between 0 and 100%");
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        BookingId: parseInt(bookingId, 10),
        Reason: reason.trim(),
      };
      if (pct !== undefined) payload.DeductionPercent = pct;
      if (notes.trim()) payload.Notes = notes.trim();

      const res = await crmSend<{ id?: number; Id?: number; CancellationNo?: string; message?: string; refundAmt?: number }>(
        "/api/crm/cancellations",
        "POST",
        payload
      );

      toast.success(
        res.refundAmt != null
          ? `Cancellation requested — ${money(res.refundAmt)} will be held as credit`
          : "Cancellation request submitted"
      );

      qc.invalidateQueries({ queryKey: ["crm-cancellations"] });
      qc.invalidateQueries({ queryKey: ["crm-cancellation-eligible-bookings"] });

      const newId = res.id ?? res.Id;
      if (newId) {
        nav.replace("CrmCancellation", {
          cancellationId: Number(newId),
          title: res.CancellationNo || "Cancellation",
        });
      } else {
        nav.goBack();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const bookingOptions = (bookingsQ.data ?? []).map((bkg) => ({
    key: String(bkg.Id),
    label: `${bkg.ApplicantName} (${bkg.BookingNo})`,
    sublabel: bkg.UnitNo ? `Unit ${bkg.UnitNo}` : undefined,
  }));

  return (
    <FormScaffold
      onSubmit={handleSubmit}
      submitLabel="Submit Cancellation Request"
      submitting={submitting}
      onCancel={() => nav.goBack()}
      tone={b.danger}
    >
      <FormSection title="Booking to Cancel">
        <PickerRow
          label="Select Booking"
          required
          value={selectedBooking ? `${selectedBooking.ApplicantName} (${selectedBooking.BookingNo})` : ""}
          placeholder={bookingsQ.isLoading ? "Loading eligible bookings…" : "Choose a booking…"}
          onPress={() => setShowPicker(true)}
        />
        {selectedBooking?.UnitNo ? <Kv label="Unit" value={selectedBooking.UnitNo} /> : null}

        <OptionPickerModal
          visible={showPicker}
          title="Select Booking"
          options={bookingOptions}
          selectedKey={bookingId}
          searchable
          onSelect={(k) => {
            setBookingId(k);
            setDeductionPct("");
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      </FormSection>

      {/* Cancellation Policy Details */}
      {bookingId ? (
        <FormSection title="Cancellation Policy">
          {policyQ.isLoading ? (
            <ActivityIndicator color={b.accent} style={{ padding: 12 }} />
          ) : policyQ.data ? (
            <View style={{ gap: 8 }}>
              <View style={{ backgroundColor: b.accentSoft, borderRadius: 10, padding: 12, flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                <Info size={16} color={b.accent} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 13, fontFamily: fonts.heading.semibold, color: b.textPrimary }}>
                    {policyQ.data.PolicyName || (policyQ.data.source === "default" ? "Standard Company Policy" : "Project Policy")}
                  </Text>
                  <Text style={{ fontSize: 12, fontFamily: fonts.body.regular, color: b.textSecondary }}>
                    Standard charge: {policyQ.data.DeductionPercent}%
                    {policyQ.data.RefundDueDays ? ` · Refund due within ${policyQ.data.RefundDueDays} days` : ""}
                  </Text>
                  {policyQ.data.Notes ? (
                    <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textFaint, marginTop: 4 }}>
                      {policyQ.data.Notes}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}

          <TextField
            label="Cancellation Charge (%)"
            value={deductionPct}
            onChangeText={setDeductionPct}
            keyboardType="numeric"
            placeholder={policyQ.data ? String(policyQ.data.DeductionPercent) : "e.g. 10"}
          />
          <Text style={{ fontSize: 11.5, fontFamily: fonts.body.regular, color: b.textSecondary, marginTop: -8, marginBottom: 10 }}>
            {policyQ.data && deductionPct !== "" && deductionPct !== String(policyQ.data.DeductionPercent)
              ? `Overriding default policy (${policyQ.data.DeductionPercent}%)`
              : "Deduction is applied only if customer takes a cash refund; re-booking retains full credit."}
          </Text>
        </FormSection>
      ) : null}

      <FormSection title="Reason & Remarks">
        <RemarksField
          label="Reason for Cancellation"
          value={reason}
          onChangeText={setReason}
          placeholder="State the customer's reason for cancelling…"
        />
        <RemarksField
          label="Internal Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Any additional notes or instructions…"
        />
      </FormSection>
    </FormScaffold>
  );
}
