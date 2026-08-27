// Bottom-sheet filter panel for PaymentListScreen — RN port of the web
// Payment page's own filter row (Payment.tsx list-level supplierFilter /
// companyNameFilter / projectFilter / finYearFilter / docNumberFilter
// state, not the in-form FilterBar.tsx which filters expense bookings).
// Company/Project/Year are dropdown-style option pickers (no RN picker
// dependency in this app yet, so a lightweight in-sheet list stands in for
// web's <select>); Supplier and Doc No are free-text like their web
// counterparts.
import { useState } from "react";
import { View, Text, Modal, Pressable, ScrollView, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { X, ChevronRight, Check, RotateCcw } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import {
  fetchCompanyOptions,
  fetchProjectOptions,
  fetchFinYearOptions,
} from "@/api/newPaymentApi";

export interface PaymentFilters {
  company: string;
  project: string;
  finYear: string;
  supplier: string;
  docNumber: string;
}

export const BLANK_FILTERS: PaymentFilters = {
  company: "",
  project: "",
  finYear: "",
  supplier: "",
  docNumber: "",
};

function PickerRow({
  label, value, onPress,
}: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-between px-3.5 py-3 rounded-xl mb-2.5"
      style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: `${colors.card}80` }}
    >
      <View className="flex-1 min-w-0">
        <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular }}>{label}</Text>
        <Text numberOfLines={1} style={{ color: value ? colors.foreground : `${colors.mutedForeground}99`, fontSize: 13, fontFamily: fonts.body.medium, marginTop: 2 }}>
          {value || "All"}
        </Text>
      </View>
      <ChevronRight size={15} color={colors.mutedForeground} />
    </Pressable>
  );
}

export function FilterSheet({
  visible, onClose, filters, onApply,
}: {
  visible: boolean;
  onClose: () => void;
  filters: PaymentFilters;
  onApply: (f: PaymentFilters) => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<PaymentFilters>(filters);
  const [picking, setPicking] = useState<"company" | "project" | "finYear" | null>(null);

  const { data: companies = [] } = useQuery({ queryKey: ["payment-filter-companies"], queryFn: fetchCompanyOptions, enabled: visible });
  const { data: projects = [] } = useQuery({ queryKey: ["payment-filter-projects"], queryFn: fetchProjectOptions, enabled: visible });
  const { data: finYears = [] } = useQuery({ queryKey: ["payment-filter-finyears"], queryFn: fetchFinYearOptions, enabled: visible });

  const optionsFor = (kind: "company" | "project" | "finYear") =>
    kind === "company" ? companies : kind === "project" ? projects : finYears;

  const fieldFor = (kind: "company" | "project" | "finYear") =>
    kind === "company" ? "company" : kind === "project" ? "project" : "finYear";

  const onOpen = () => setDraft(filters);

  return (
    <Modal visible={visible} transparent animationType="slide" onShow={onOpen} onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "80%",
            backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderWidth: 1, borderColor: colors.border, overflow: "hidden",
          }}
        >
          <View className="items-center pt-2 pb-1">
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
          </View>

          <View className="flex-row items-center justify-between px-4 py-3">
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: fonts.heading.semibold }}>Filter Payments</Text>
            <Pressable onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center" style={{ borderWidth: 1, borderColor: colors.border }}>
              <X size={15} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView style={{ paddingHorizontal: 16 }} contentContainerStyle={{ paddingBottom: 8 }}>
            <PickerRow label="Company" value={draft.company} onPress={() => setPicking("company")} />
            <PickerRow label="Project" value={draft.project} onPress={() => setPicking("project")} />
            <PickerRow label="Financial Year" value={draft.finYear} onPress={() => setPicking("finYear")} />

            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, marginBottom: 4 }}>Supplier / Paid To</Text>
            <TextInput
              value={draft.supplier}
              onChangeText={(t) => setDraft((d) => ({ ...d, supplier: t }))}
              placeholder="Search supplier…"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
                color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 12,
              }}
            />

            <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: fonts.body.regular, marginBottom: 4 }}>Doc No.</Text>
            <TextInput
              value={draft.docNumber}
              onChangeText={(t) => setDraft((d) => ({ ...d, docNumber: t }))}
              placeholder="e.g. PMT-2026-0001"
              placeholderTextColor={`${colors.mutedForeground}99`}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
                color: colors.foreground, fontFamily: fonts.body.regular, fontSize: 13, marginBottom: 16,
              }}
            />
          </ScrollView>

          <View className="flex-row gap-2.5 px-4" style={{ paddingBottom: insets.bottom + 14, paddingTop: 4 }}>
            <Pressable
              onPress={() => { setDraft(BLANK_FILTERS); onApply(BLANK_FILTERS); onClose(); }}
              className="flex-row items-center justify-center gap-1.5 px-4 py-3 rounded-xl"
              style={{ borderWidth: 1, borderColor: colors.border }}
            >
              <RotateCcw size={13} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontSize: 12.5, fontFamily: fonts.heading.medium }}>Reset</Text>
            </Pressable>
            <Pressable
              onPress={() => { onApply(draft); onClose(); }}
              className="flex-1 items-center justify-center py-3 rounded-xl"
              style={{ backgroundColor: colors.primary }}
            >
              <Text style={{ color: "#fff", fontSize: 12.5, fontFamily: fonts.heading.semibold }}>Apply Filters</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>

      {/* Option picker sub-sheet */}
      <Modal visible={!!picking} transparent animationType="fade" onRequestClose={() => setPicking(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={() => setPicking(null)}>
          <Pressable
            onPress={() => {}}
            style={{
              position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "70%",
              backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
              borderWidth: 1, borderColor: colors.border, overflow: "hidden",
            }}
          >
            <View className="items-center pt-2 pb-1">
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.mutedForeground}4d` }} />
            </View>
            <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.heading.semibold, paddingHorizontal: 16, paddingVertical: 10 }}>
              {picking === "company" ? "Select Company" : picking === "project" ? "Select Project" : "Select Financial Year"}
            </Text>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
              <Pressable
                onPress={() => { if (picking) { setDraft((d) => ({ ...d, [fieldFor(picking)]: "" })); setPicking(null); } }}
                className="flex-row items-center justify-between px-4 py-3"
              >
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: fonts.body.medium }}>All</Text>
                {picking && !draft[fieldFor(picking) as keyof PaymentFilters] && <Check size={15} color={colors.primary} />}
              </Pressable>
              {picking && optionsFor(picking).map((o) => {
                const field = fieldFor(picking);
                const selected = draft[field as keyof PaymentFilters] === o.label;
                return (
                  <Pressable
                    key={o.id}
                    onPress={() => { setDraft((d) => ({ ...d, [field]: o.label })); setPicking(null); }}
                    className="flex-row items-center justify-between px-4 py-3"
                  >
                    <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 13, fontFamily: fonts.body.regular, flex: 1, marginRight: 8 }}>
                      {o.label}
                    </Text>
                    {selected && <Check size={15} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}
