// Bill View — direct port of the web app's LedgerSheet (src/pages/
// maintenance/MaintenanceBills.tsx's BillViewModal), the standard
// housing-society ledger format: company header, Bill No/Date/Flat/Due Date
// grid, Sr/Description/Amount table, Total Payable, Amount in Words, Notes,
// signature line. Print/export stay web-only (nothing to print to on-site);
// Edit/Cancel are here, same as web, gated by usePageRights.
import { useState } from "react";
import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Pencil, Ban } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { ConfirmSheet } from "@/components/ConfirmSheet";
import { RemarksField } from "@/components/form/Form";
import { usePageRights } from "@/hooks/usePageRights";
import { formatINR } from "@/utils/formatCurrency";
import { numberToWordsIndian } from "@/utils/numberToWords";
import { getMaintenanceBill, cancelMaintenanceBill } from "@/api/maintenanceBillApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#65a30d";

type Props = NativeStackScreenProps<MainStackParamList, "BillView">;

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

function Field({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View
      style={{
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRightWidth: last ? 0 : 1,
        borderRightColor: colors.border,
      }}
    >
      <Text style={{ color: colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </Text>
      <Text style={{ color: colors.foreground, fontSize: 12, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
        {value || "—"}
      </Text>
    </View>
  );
}

export default function BillViewScreen({ route }: Props) {
  const { billId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const rights = usePageRights("maintenance-bills");
  const qc = useQueryClient();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const { data: bill, isLoading, error } = useQuery({
    queryKey: ["maint-bill", billId],
    queryFn: () => getMaintenanceBill(billId),
  });

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelMaintenanceBill(billId, cancelReason || undefined);
      toast.success("Bill cancelled.");
      qc.invalidateQueries({ queryKey: ["maint-bill", billId] });
      qc.invalidateQueries({ queryKey: ["maint-bills-all"] });
      setCancelOpen(false);
      setCancelReason("");
    } catch (err) {
      toast.error((err as Error).message || "Failed to cancel bill.");
    } finally {
      setCancelling(false);
    }
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }
  if (error || !bill) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 16 }}>
        <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.body.regular }}>
          Bill not found.
        </Text>
      </View>
    );
  }

  const companyAddress = [bill.CompanyAddress, bill.CompanyAddressLine2, bill.CompanyCity, bill.CompanyState, bill.CompanyPincode]
    .filter(Boolean)
    .join(", ");
  const unitLabel = [bill.BlockName, bill.UnitNo].filter(Boolean).join(" / ") || "—";

  const showActions = bill.Status === "Active" && (rights.canEdit || rights.canDelete);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ padding: 16 }}>
        {showActions && (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            {rights.canEdit && (
              <Pressable
                onPress={() => navigation.navigate("BillForm", { billId })}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}
              >
                <Pencil size={13} color={colors.foreground} />
                <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Edit</Text>
              </Pressable>
            )}
            {rights.canDelete && (
              <Pressable
                onPress={() => setCancelOpen(true)}
                style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: "rgba(220,40,40,0.35)", backgroundColor: "rgba(220,40,40,0.06)" }}
              >
                <Ban size={13} color={colors.destructive} />
                <Text style={{ color: colors.destructive, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Cancel Bill</Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={{ backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
          {/* Society-style header */}
          <View style={{ paddingVertical: 16, paddingHorizontal: 14, alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold, textAlign: "center" }}>
              {bill.CompanyName || "Maintenance Bill"}
            </Text>
            {!!companyAddress && (
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 3, textAlign: "center" }}>
                {companyAddress}
              </Text>
            )}
            {!!bill.CompanyGstNo && (
              <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 2, textAlign: "center" }}>
                GSTIN: {bill.CompanyGstNo}
              </Text>
            )}
          </View>

          {/* Bill No / Bill Date / Flat No / Due Date */}
          <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Field label="Bill No." value={bill.BillNo} />
            <Field label="Bill Date" value={fmtDate(bill.BillDate)} />
            <Field label="Flat No." value={unitLabel} />
            <Field label="Due Date" value={fmtDate(bill.DueDate)} last />
          </View>

          {/* Name */}
          <View style={{ paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4 }}>
              Name
            </Text>
            <Text style={{ color: colors.foreground, fontSize: 13.5, fontFamily: fonts.heading.semibold, marginTop: 2 }}>
              {bill.CustomerName || "—"}
            </Text>
          </View>

          {/* Sr / Description / Amount */}
          <View style={{ flexDirection: "row", backgroundColor: colors.muted, paddingVertical: 8, paddingHorizontal: 12 }}>
            <Text style={{ width: 28, color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase" }}>Sr.</Text>
            <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase" }}>Description</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 9, fontFamily: fonts.heading.semibold, textTransform: "uppercase" }}>Amount</Text>
          </View>
          {bill.items.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular, textAlign: "center", paddingVertical: 20 }}>
              No charge heads on this bill.
            </Text>
          ) : (
            bill.items.map((it, i) => (
              <View
                key={it.Id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: `${colors.border}80`,
                }}
              >
                <Text style={{ width: 28, color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>{i + 1}</Text>
                <Text style={{ flex: 1, color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium, paddingRight: 8 }}>
                  {it.ChargeHeadName}
                </Text>
                <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.semibold }}>
                  {formatINR(it.TotalAmount)}
                </Text>
              </View>
            ))
          )}

          {/* Total Payable */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              alignItems: "baseline",
              gap: 14,
              paddingVertical: 12,
              paddingHorizontal: 12,
              backgroundColor: colors.muted,
              borderTopWidth: 2,
              borderTopColor: colors.border,
            }}
          >
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>Total Payable</Text>
            <Text style={{ color: colors.foreground, fontSize: 15, fontFamily: fonts.heading.bold }}>{formatINR(bill.GrandTotal)}</Text>
          </View>

          {/* Amount in words */}
          <View style={{ paddingVertical: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ fontSize: 11, fontFamily: fonts.body.regular }}>
              <Text style={{ color: colors.mutedForeground }}>Amount In Words: </Text>
              <Text style={{ color: colors.foreground, fontFamily: fonts.body.medium }}>{numberToWordsIndian(bill.GrandTotal)}</Text>
            </Text>
          </View>

          {bill.Status === "Cancelled" && (
            <View
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                backgroundColor: "rgba(220,40,40,0.05)",
              }}
            >
              <Text style={{ color: colors.destructive, fontSize: 11.5, fontFamily: fonts.body.regular }}>
                Cancelled{bill.CancelReason ? ` — ${bill.CancelReason}` : ""}
              </Text>
            </View>
          )}

          {/* Notes */}
          <View style={{ paddingVertical: 11, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 8.5, fontFamily: fonts.heading.semibold, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>
              Notes
            </Text>
            <Text style={{ color: bill.Notes ? colors.foreground : colors.mutedForeground, fontSize: 11.5, fontFamily: fonts.body.regular, fontStyle: bill.Notes ? "normal" : "italic" }}>
              {bill.Notes || "—"}
            </Text>
          </View>

          {/* Signature footer */}
          <View style={{ paddingVertical: 18, paddingHorizontal: 12, alignItems: "flex-end", borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>
              For {bill.CompanyName || "Maintenance Bill"}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 9.5, fontFamily: fonts.body.regular, marginTop: 22 }}>
              Secretary / Chairman / Treasurer
            </Text>
          </View>
        </View>
      </View>

      <ConfirmSheet
        visible={cancelOpen}
        title="Cancel Bill"
        message={`Cancel bill ${bill.BillNo}? This keeps the record for history but marks it Cancelled.`}
        confirmLabel={cancelling ? "Cancelling…" : "Cancel Bill"}
        tone="danger"
        loading={cancelling}
        onConfirm={handleCancel}
        onClose={() => setCancelOpen(false)}
      >
        <RemarksField
          label="Reason (optional)"
          value={cancelReason}
          onChangeText={setCancelReason}
          placeholder="Why is this bill being cancelled?"
        />
      </ConfirmSheet>
    </View>
  );
}
