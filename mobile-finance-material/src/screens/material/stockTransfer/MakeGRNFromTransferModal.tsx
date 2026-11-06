// RN port of StockTransfer.tsx's MakeGRNModal, on the drawing sheet: a paper panel up from the bottom under an ink rule
// (SheetPicker), the transfer's items, a remarks field and Create GRN. It makes a GRN from a plain stock transfer so the
// receiving side has a document to approve — remarks only, deliberately no supplier (see grnApi.ts on why that keeps
// stock from double-posting).
import { useState } from "react";
import { View, ScrollView, Alert } from "react-native";
import { createGRNFromTransfer } from "@/api/grnApi";
import type { StockTransfer } from "@/api/stockTransferApi";
import { sheet as S } from "@/theme/colors";
import { Field, Input, Key, Notice } from "@/components/sheet/Sheet";
import { SheetPicker } from "@/components/sheet/FormParts";
import { LineList } from "@/components/sheet/Register";

export function MakeGRNFromTransferModal({
  transfer, onClose, onSuccess,
}: {
  transfer: StockTransfer | null; onClose: () => void; onSuccess: (grnNo: string) => void;
}) {
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  if (!transfer) return null;

  const handleCreate = async () => {
    setSubmitting(true);
    try {
      const result = await createGRNFromTransfer(transfer.TransferID, { remarks: remarks || `Auto-generated from Stock Transfer ${transfer.DocNo}` });
      setRemarks("");
      onSuccess(result.grnNo);
    } catch (err: any) {
      Alert.alert("Could not create the GRN", err?.message ?? "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SheetPicker visible title="Create GRN from transfer" note={`Ref ${transfer.DocNo}`} onClose={onClose}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ borderWidth: 1, borderColor: S.line40, paddingHorizontal: 10 }}>
          <LineList rows={(transfer.TransferItems ?? []).map((it, i) => ({ key: i, title: it.itemName || it.itemId, right: `${it.qty} ${it.uom || ""}` }))} empty="No items." />
        </View>
        <Field label="Remarks">
          <Input value={remarks} onChangeText={setRemarks} placeholder={`Auto-generated from Stock Transfer ${transfer.DocNo}`} multiline style={{ minHeight: 64, paddingVertical: 10, textAlignVertical: "top" }} />
        </Field>
        <Notice tone="ink">The GRN is created as Draft / Pending and follows the normal approval workflow.</Notice>
        <Key tone="ink" label={submitting ? "Creating…" : "Create GRN"} onPress={handleCreate} disabled={submitting} />
      </ScrollView>
    </SheetPicker>
  );
}
