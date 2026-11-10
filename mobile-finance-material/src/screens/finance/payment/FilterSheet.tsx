// Filter panel for PaymentListScreen, on the drawing sheet (the sheet's list picker frame and fields) — RN port of the web
// Payment page's own filter row (Payment.tsx list-level supplierFilter /
// companyNameFilter / projectFilter / finYearFilter / docNumberFilter
// state, not the in-form FilterBar.tsx which filters expense bookings).
// Company/Project/Year are dropdown-style option pickers (no RN picker
// dependency in this app yet, so a lightweight in-sheet list stands in for
// web's <select>); Supplier and Doc No are free-text like their web
// counterparts.
import { useState } from "react";
import { View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { Field, Input, Key } from "@/components/sheet/Sheet";
import { SheetPicker } from "@/components/sheet/FormParts";
import { PickerRow, OptionPickerModal } from "./OptionPicker";
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

  const optionsFor = (kind: "company" | "project" | "finYear") => (kind === "company" ? companies : kind === "project" ? projects : finYears);

  // The draft starts from the applied filters each time the panel opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (visible && !wasOpen) {
    setWasOpen(true);
    setDraft(filters);
  } else if (!visible && wasOpen) {
    setWasOpen(false);
  }

  return (
    <>
      <SheetPicker
        visible={visible && !picking}
        title="Filter payments"
        onClose={onClose}
        footer={
          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, borderTopWidth: 1, borderTopColor: S.ink }}>
            <Key
              label="Reset"
              icon={<RotateCcw size={13} color={S.ink} />}
              onPress={() => {
                setDraft(BLANK_FILTERS);
                onApply(BLANK_FILTERS);
                onClose();
              }}
            />
            <Key
              tone="ink"
              label="Apply filters"
              onPress={() => {
                onApply(draft);
                onClose();
              }}
              style={{ flex: 1 }}
            />
          </View>
        }
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          <PickerRow label="Company" value={draft.company} onPress={() => setPicking("company")} />
          <PickerRow label="Project" value={draft.project} onPress={() => setPicking("project")} />
          <PickerRow label="Financial Year" value={draft.finYear} onPress={() => setPicking("finYear")} />
          <Field label="Supplier / Paid To" style={{ marginBottom: 12 }}>
            <Input value={draft.supplier} onChangeText={(t) => setDraft((d) => ({ ...d, supplier: t }))} placeholder="Search supplier…" />
          </Field>
          <Field label="Doc No.">
            <Input value={draft.docNumber} onChangeText={(t) => setDraft((d) => ({ ...d, docNumber: t }))} placeholder="e.g. PMT-2026-0001" autoCapitalize="characters" />
          </Field>
        </ScrollView>
      </SheetPicker>

      <OptionPickerModal
        visible={visible && !!picking}
        title={picking === "company" ? "Select company" : picking === "project" ? "Select project" : "Select financial year"}
        options={picking ? optionsFor(picking).map((o: { id: string | number; label: string }) => ({ key: o.label, label: o.label })) : []}
        selectedKey={picking ? draft[picking] : ""}
        clearable
        searchable
        onClose={() => setPicking(null)}
        onSelect={(label) => {
          if (picking) setDraft((d) => ({ ...d, [picking]: label }));
          setPicking(null);
        }}
      />
    </>
  );
}
