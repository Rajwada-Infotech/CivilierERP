// Create / Edit Maintenance Bill — direct port of the web app's
// BillFormDialog (src/pages/maintenance/MaintenanceBills.tsx): pick a
// confirmed customer (create only), add/remove Charge Head lines, set a
// due date + notes, save. Same LedgerSheet-shaped preview as BillViewScreen
// so what you build here is what prints on web.
import { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Trash2, Plus } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { FormSection, RemarksField } from "@/components/form/Form";
import { DateField } from "@/components/form/DateField";
import { PickerRow, OptionPickerModal, type PickerOption } from "@/components/OptionPicker";
import { formatINR } from "@/utils/formatCurrency";
import { getMaintenanceDirectory, type MaintenanceDirectoryRow } from "@/api/maintenanceApi";
import { getActiveChargeHeads, type ChargeHeadRow } from "@/api/chargeHeadApi";
import {
  getMaintenanceBill,
  createMaintenanceBill,
  updateMaintenanceBill,
} from "@/api/maintenanceBillApi";
import type { MainStackParamList } from "@/navigation/MainStack";

const ACCENT = "#65a30d";

type Props = NativeStackScreenProps<MainStackParamList, "BillForm">;

export default function BillFormScreen({ route, navigation }: Props) {
  const billId = route.params?.billId ?? null;
  const isEdit = billId !== null;
  const qc = useQueryClient();

  const [bookingId, setBookingId] = useState<number | null>(null);
  const [bookingLabel, setBookingLabel] = useState("");
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [chargeHeadIds, setChargeHeadIds] = useState<number[]>([]);
  const [chargeHeadPickerOpen, setChargeHeadPickerOpen] = useState(false);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: directory = [] } = useQuery({
    queryKey: ["maint-directory-all"],
    queryFn: () => getMaintenanceDirectory(""),
    enabled: !isEdit,
  });

  const { data: chargeHeads = [] } = useQuery({
    queryKey: ["charge-heads-active"],
    queryFn: getActiveChargeHeads,
  });

  const { data: existingBill, isLoading: loadingExisting } = useQuery({
    queryKey: ["maint-bill", billId],
    queryFn: () => getMaintenanceBill(billId as number),
    enabled: isEdit,
  });

  useEffect(() => {
    if (!existingBill) return;
    setBookingId(existingBill.BookingId);
    setBookingLabel(existingBill.CustomerName ?? "");
    setChargeHeadIds(existingBill.items.map((i) => i.ChargeHeadId).filter((id): id is number => id != null));
    setDueDate(existingBill.DueDate ? existingBill.DueDate.slice(0, 10) : null);
    setNotes(existingBill.Notes || "");
  }, [existingBill]);

  const selectedCharges = useMemo(
    () => chargeHeadIds.map((id) => chargeHeads.find((c) => c.Id === id)).filter((c): c is ChargeHeadRow => !!c),
    [chargeHeadIds, chargeHeads],
  );
  const availableCharges = useMemo(
    () => chargeHeads.filter((c) => !chargeHeadIds.includes(c.Id)),
    [chargeHeads, chargeHeadIds],
  );
  const lineAmount = (c: ChargeHeadRow) => (Number(c.Rate) || 0) + ((Number(c.Rate) || 0) * (Number(c.TaxPct) || 0)) / 100;
  const grandTotal = selectedCharges.reduce((s, c) => s + lineAmount(c), 0);

  const customerOptions: PickerOption[] = directory.map((c: MaintenanceDirectoryRow) => ({
    key: String(c.Id),
    label: c.CustomerName || "Unnamed Customer",
    sublabel: [c.BlockName, c.UnitNo].filter(Boolean).join(" / ") || c.BookingNo,
  }));
  const chargeOptions: PickerOption[] = availableCharges.map((c) => ({
    key: String(c.Id),
    label: c.Name,
    sublabel: `${formatINR(c.Rate)} · ${c.TaxPct || 0}% tax`,
  }));

  const handleSave = async () => {
    if (!isEdit && !bookingId) {
      toast.error("Select a customer.");
      return;
    }
    if (chargeHeadIds.length === 0) {
      toast.error("Add at least one Charge Head.");
      return;
    }
    setSaving(true);
    const extras = { dueDate, notes: notes || null };
    try {
      if (isEdit) {
        await updateMaintenanceBill(billId as number, chargeHeadIds, extras);
        toast.success("Bill updated.");
      } else {
        await createMaintenanceBill(bookingId as number, chargeHeadIds, extras);
        toast.success("Bill created.");
      }
      qc.invalidateQueries({ queryKey: ["maint-bills-all"] });
      if (isEdit) qc.invalidateQueries({ queryKey: ["maint-bill", billId] });
      navigation.goBack();
    } catch (err) {
      toast.error((err as Error).message || "Failed to save bill.");
    } finally {
      setSaving(false);
    }
  };

  if (isEdit && loadingExisting) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.mutedForeground} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {!isEdit && (
          <FormSection title="Customer">
            <PickerRow
              label="Customer / Flat"
              value={bookingLabel}
              placeholder="Select customer…"
              required
              onPress={() => setCustomerPickerOpen(true)}
            />
          </FormSection>
        )}

        <FormSection title="Charge Heads">
          {selectedCharges.length === 0 ? (
            <View
              style={{
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: colors.border,
                borderRadius: 12,
                paddingVertical: 20,
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: fonts.body.regular }}>
                No charge heads added yet.
              </Text>
            </View>
          ) : (
            <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
              {selectedCharges.map((c, i) => (
                <View
                  key={c.Id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderBottomWidth: i === selectedCharges.length - 1 ? 0 : 1,
                    borderBottomColor: colors.border,
                    backgroundColor: colors.card,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.body.medium }}>
                      {c.Name}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: 10.5, fontFamily: fonts.body.regular, marginTop: 1 }}>
                      {formatINR(c.Rate)} + {c.TaxPct || 0}% tax
                    </Text>
                  </View>
                  <Text style={{ color: colors.foreground, fontSize: 12.5, fontFamily: fonts.heading.semibold, marginRight: 12 }}>
                    {formatINR(lineAmount(c))}
                  </Text>
                  <Pressable onPress={() => setChargeHeadIds((prev) => prev.filter((id) => id !== c.Id))} hitSlop={8}>
                    <Trash2 size={14} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <Pressable
            onPress={() => setChargeHeadPickerOpen(true)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              paddingVertical: 11,
              borderRadius: 12,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: `${ACCENT}55`,
              backgroundColor: `${ACCENT}0f`,
            }}
          >
            <Plus size={13} color={ACCENT} />
            <Text style={{ color: ACCENT, fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Add Charge Head</Text>
          </Pressable>

          {selectedCharges.length > 0 && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.bold }}>Total Payable</Text>
              <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.bold }}>{formatINR(grandTotal)}</Text>
            </View>
          )}
        </FormSection>

        <FormSection title="Details">
          <DateField label="Due Date" value={dueDate} onChange={setDueDate} />
          <RemarksField
            label="Notes"
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. Cheque should be drawn in favour of the society only."
          />
        </FormSection>
      </ScrollView>

      <View style={{ flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.background }}>
        <Pressable
          onPress={saving ? undefined : () => navigation.goBack()}
          style={{ flex: 1, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
        >
          <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold }}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={saving ? undefined : handleSave}
          style={{ flex: 1.5, paddingVertical: 13, borderRadius: 12, alignItems: "center", backgroundColor: ACCENT, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? (
            <ActivityIndicator color="#1a1a1a" size="small" />
          ) : (
            <Text style={{ color: "#1a1a1a", fontSize: 13, fontFamily: fonts.heading.bold }}>
              {isEdit ? "Save Changes" : "Create Bill"}
            </Text>
          )}
        </Pressable>
      </View>

      <OptionPickerModal
        visible={customerPickerOpen}
        title="Select Customer"
        options={customerOptions}
        selectedKey={bookingId ? String(bookingId) : null}
        searchable
        onSelect={(key) => {
          const c = directory.find((d: MaintenanceDirectoryRow) => String(d.Id) === key);
          if (c) {
            setBookingId(c.Id);
            setBookingLabel(c.CustomerName || "Unnamed Customer");
          }
          setCustomerPickerOpen(false);
        }}
        onClose={() => setCustomerPickerOpen(false)}
      />

      <OptionPickerModal
        visible={chargeHeadPickerOpen}
        title="Add Charge Head"
        options={chargeOptions}
        searchable
        onSelect={(key) => {
          setChargeHeadIds((prev) => [...prev, Number(key)]);
          setChargeHeadPickerOpen(false);
        }}
        onClose={() => setChargeHeadPickerOpen(false)}
      />
    </View>
  );
}
