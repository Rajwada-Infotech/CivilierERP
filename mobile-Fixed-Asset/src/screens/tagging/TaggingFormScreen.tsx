// FA Inventory — edit a tagging entry. Only date + remarks can change (the route allows nothing else); tagging itself
// is done on the web.
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RouteProp } from "@react-navigation/native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import { FormScaffold, FormSection, RemarksField, DateField } from "@/components/form";
import { getFixedAssetTagging, updateFixedAssetTagging } from "@/api/fixedAssetApi";
import type { MainStackParamList } from "@/navigation/MainStack";

export default function TaggingFormScreen() {
  const route = useRoute<RouteProp<MainStackParamList, "TaggingForm">>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const editingId = route.params.id;

  const [docDate, setDocDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [hydrated, setHydrated] = useState(false);

  const detailQ = useQuery({ queryKey: ["fa-tagging", editingId], queryFn: () => getFixedAssetTagging(editingId) });

  useEffect(() => {
    if (!detailQ.data || hydrated) return;
    setDocDate(detailQ.data.DocDate?.slice(0, 10) || "");
    setRemarks(detailQ.data.Remarks || "");
    setHydrated(true);
  }, [detailQ.data, hydrated]);

  const save = useMutation({
    mutationFn: () => updateFixedAssetTagging(editingId, { docDate: docDate || undefined, remarks: remarks || undefined }),
    onSuccess: () => {
      toast.success("Tagging entry updated");
      qc.invalidateQueries({ queryKey: ["fa-tagging"] });
      qc.invalidateQueries({ queryKey: ["fa-assets"] });
      nav.goBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <FormScaffold onSubmit={() => save.mutate()} onCancel={() => nav.goBack()} submitLabel="Update" submitting={save.isPending}>
      <FormSection title="Tagging Entry">
        {!!detailQ.data?.FAItemCode && (
          <Text style={{ color: colors.mutedForeground, fontSize: 11, fontFamily: fonts.body.medium, marginBottom: 10 }}>
            {detailQ.data.FAItemCode}
          </Text>
        )}
        <DateField label="Doc Date" value={docDate} onChange={setDocDate} />
        <RemarksField label="Remarks" value={remarks} onChangeText={setRemarks} />
      </FormSection>
    </FormScaffold>
  );
}
