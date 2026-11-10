// RN port of VehicleInOut.tsx's view, on the drawing sheet: the entry's number as the title with its date, vehicle and
// supplier; its approval mark; the particulars (company, project, PO, challan, entry and exit times); the items received
// in this lot; the attachments (an image opens full size); remarks. Edit sits in the title block. Deferred vs. web as
// before: the Supplier chat tab, the stacked PO preview, the per-line quality debit-note flow and print.
import { fmtWallClock } from "@/utils/istTime";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { View, Pressable } from "react-native";
import { FileText, Paperclip, Pencil, Truck } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { getVehicleInOut, type VehicleInOutRecord } from "@/api/vehicleInOutApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { AuthImage } from "@/components/AuthImage";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import { InfoGrid, Key, Panel } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";

// Entry / exit times are stored as the IST digits that were typed; show those digits, not the phone's zone.
const fmtDateTime = (d: string | null | undefined) => fmtWallClock(d, { dateStyle: "medium", timeStyle: "short" });

export function VehicleInOutDetailModal({ recordId, onClose, onEdit }: { recordId: number | null; onClose: () => void; onEdit?: (id: number) => void }) {
  const [previewAtt, setPreviewAtt] = useState<{ url: string; filename?: string } | null>(null);
  const { data: rec, isLoading, isError, error, refetch } = useQuery<VehicleInOutRecord>({
    queryKey: ["vehicle-in-out-detail", recordId],
    queryFn: () => getVehicleInOut(recordId!),
    enabled: recordId != null,
  });

  return (
    <>
      <DetailSheet
        visible={recordId != null}
        onClose={onClose}
        eyebrow="CivilierERP · Material · Vehicle in / out"
        title={rec?.DocNo || "Vehicle entry"}
        subtitle={rec ? [fmtDate(rec.DocDate), rec.VehicleNo, rec.SupplierName].filter(Boolean).join(" · ") : undefined}
        actions={rec && onEdit ? <Key label="Edit" icon={<Pencil size={13} color={S.ink} />} onPress={() => onEdit(rec.VehicleInOutID)} /> : null}
        loading={isLoading || !rec}
        error={isError ? (error as Error)?.message || "Could not load this entry." : null}
        onRetry={() => refetch()}
      >
        {rec && (
          <>
            <ApprovalStatusChain table="VehicleInOut" recordId={rec.VehicleInOutID} />
            <InfoGrid
              items={[
                { label: "Vehicle", value: rec.VehicleNo || "—" },
                { label: "Financial year", value: rec.FinYear || "—" },
                { label: "Company", value: rec.CompanyName || "—" },
                { label: "Project", value: rec.ProjectName || "—" },
                { label: "Supplier", value: rec.SupplierName || "—" },
                { label: "PO no", value: rec.PONumber || "—" },
                { label: "Entry time", value: fmtDateTime(rec.EntryTime) },
                { label: "Exit time", value: rec.ExitTime ? fmtDateTime(rec.ExitTime) : "Not yet exited" },
                { label: "Challan no", value: rec.ChallanNo || "—" },
                ...(rec.Remarks ? [{ label: "Remarks", value: rec.Remarks, wide: true }] : []),
              ]}
            />

            <Panel title="Received items (this lot)" icon={<Truck size={14} color={S.ink} />}>
              <LineList
                empty="No items recorded on this entry."
                rows={(rec.Items ?? []).map((it) => ({ key: it.VehicleInOutItemID, title: it.ItemName || "—", right: `${it.ReceivedQty} ${it.UomName || ""}` }))}
              />
            </Panel>

            {!!rec.Attachments?.length && (
              <Panel title={`Attachments (${rec.Attachments.length})`} icon={<Paperclip size={14} color={S.ink} />}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {rec.Attachments.map((a) => (
                    <View key={a.id} style={{ width: 84, height: 84, borderWidth: 1, borderColor: S.line40, overflow: "hidden" }}>
                      {a.mimeType?.startsWith("image/") ? (
                        <Pressable onPress={() => setPreviewAtt(a)} style={{ width: "100%", height: "100%" }}>
                          <AuthImage url={a.url} style={{ width: "100%", height: "100%" }} />
                        </Pressable>
                      ) : (
                        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                          <FileText size={20} color={S.graphite} />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </Panel>
            )}
          </>
        )}
        <ImagePreviewModal visible={!!previewAtt} url={previewAtt?.url} title={previewAtt?.filename} onClose={() => setPreviewAtt(null)} />
      </DetailSheet>
    </>
  );
}
