// Before / After photos for the activity. Day 1's After photos become day 2's Before (server-side, once the tab
// opens and again before a new capture). Photos come as base64 JSON, so each thumbnail loads on its own.
import { useEffect, useState } from "react";
import { Alert, Image, Modal, Text, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Trash2, X } from "lucide-react-native";
import { colors } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { toast } from "@/components/Toast";
import {
  CARRIED_FORWARD_NOTE, carryForwardPhotos, deleteActivityPhoto, getActivityPhoto, getActivityPhotos, uploadActivityPhoto,
  type ActivityPhotoMeta, type PhotoPhase,
} from "@/api/cwdApi";
import { Btn, Empty, ErrorText, Loading, takePhoto } from "./ui";

const TAGS: { key: PhotoPhase; label: string; color: string }[] = [
  { key: "before", label: "Before", color: "#f59e0b" },
  { key: "after", label: "After", color: "#22c55e" },
];

function useDataUri(rungId: number, photoId: number, enabled = true) {
  return useQuery({
    queryKey: ["cwd-photo", rungId, photoId],
    queryFn: async () => {
      const p = await getActivityPhoto(rungId, photoId);
      return `data:${p.mimeType};base64,${p.dataBase64}`;
    },
    enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });
}

export function PhotoThumb({ rungId, photo, onOpen }: { rungId: number; photo: ActivityPhotoMeta; onOpen: () => void }) {
  const q = useDataUri(rungId, photo.id);
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onOpen} style={{ width: 92, height: 92, borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.muted }}>
      {q.data ? <Image source={{ uri: q.data }} style={{ width: 92, height: 92 }} /> : null}
      {photo.note === CARRIED_FORWARD_NOTE && (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.6)", paddingVertical: 2 }}>
          <Text style={{ color: "#fff", fontSize: 8.5, textAlign: "center", fontFamily: fonts.body.medium }}>carried forward</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function PhotoViewer({ rungId, photo, onClose, onDelete }: { rungId: number; photo: ActivityPhotoMeta | null; onClose: () => void; onDelete?: (p: ActivityPhotoMeta) => void }) {
  const q = useDataUri(rungId, photo?.id ?? 0, !!photo);
  return (
    <Modal visible={!!photo} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center" }}>
        <TouchableOpacity onPress={onClose} style={{ position: "absolute", top: 48, right: 20, zIndex: 2, padding: 8 }}>
          <X size={22} color="#fff" />
        </TouchableOpacity>
        {q.data ? <Image source={{ uri: q.data }} resizeMode="contain" style={{ width: "100%", height: "75%" }} /> : <Loading />}
        {photo && (
          <View style={{ padding: 16, gap: 10 }}>
            <Text style={{ color: "#fff", fontSize: 12, fontFamily: fonts.body.medium }}>
              {photo.phase === "before" ? "Before" : "After"} · {new Date(photo.capturedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              {photo.capturedBy ? ` · ${photo.capturedBy}` : ""}
            </Text>
            {!!photo.note && photo.note !== CARRIED_FORWARD_NOTE && <Text style={{ color: "#cbd5e1", fontSize: 11.5, fontFamily: fonts.body.regular }}>{photo.note}</Text>}
            {onDelete && (
              <TouchableOpacity onPress={() => onDelete(photo)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Trash2 size={14} color="#f87171" />
                <Text style={{ color: "#f87171", fontSize: 12, fontFamily: fonts.heading.semibold }}>Delete photo</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

export function PhotosTab({ rungId, canAdd }: { rungId: number; canAdd: boolean }) {
  const qc = useQueryClient();
  const [tag, setTag] = useState<PhotoPhase>("after");
  const [open, setOpen] = useState<ActivityPhotoMeta | null>(null);
  const q = useQuery({ queryKey: ["cwd-photos", rungId], queryFn: () => getActivityPhotos(rungId) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["cwd-photos", rungId] });
    qc.invalidateQueries({ queryKey: ["cwd-day-photos", rungId] });
    qc.invalidateQueries({ queryKey: ["cwd-daily-log", rungId] });
  };

  // Best-effort — a failed carry-forward must never block the tab or a new capture.
  const carry = async () => {
    try { if ((await carryForwardPhotos(rungId)).carried > 0) refresh(); } catch { /* ignore */ }
  };
  useEffect(() => { void carry(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [rungId]);

  const add = useMutation({
    mutationFn: async () => {
      const uri = await takePhoto();
      if (!uri) return false;
      await carry();
      await uploadActivityPhoto(rungId, tag, uri);
      return true;
    },
    onSuccess: (done) => { if (done) { toast.success(`${tag === "before" ? "Before" : "After"} photo saved`); refresh(); } },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (p: ActivityPhotoMeta) => deleteActivityPhoto(rungId, p.id),
    onSuccess: () => { setOpen(null); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const confirmDelete = (p: ActivityPhotoMeta) => Alert.alert("Delete this photo?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => remove.mutate(p) }]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorText error={q.error} />;

  return (
    <View style={{ gap: 16 }}>
      {canAdd && (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {TAGS.map((t) => {
              const on = tag === t.key;
              return (
                <TouchableOpacity key={t.key} onPress={() => setTag(t.key)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? t.color : colors.border, backgroundColor: on ? `${t.color}22` : "transparent" }}>
                  <Text style={{ fontSize: 11.5, fontFamily: fonts.heading.semibold, color: on ? t.color : colors.mutedForeground }}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Btn label={`Take ${tag} photo`} icon={<Camera size={14} color="#04181d" />} busy={add.isPending} onPress={() => add.mutate()} />
        </View>
      )}
      {TAGS.map((t) => {
        const photos = q.data?.[t.key] ?? [];
        return (
          <View key={t.key} style={{ borderLeftWidth: 2, borderLeftColor: `${t.color}55`, paddingLeft: 12 }}>
            <Text style={{ fontSize: 10, fontFamily: fonts.heading.bold, color: t.color, textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 8 }}>{t.label} · {photos.length}</Text>
            {photos.length === 0 ? (
              <Text style={{ fontSize: 11.5, color: colors.mutedForeground, fontFamily: fonts.body.regular }}>None yet</Text>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {photos.map((p) => <PhotoThumb key={p.id} rungId={rungId} photo={p} onOpen={() => setOpen(p)} />)}
              </View>
            )}
          </View>
        );
      })}
      {(q.data?.before.length ?? 0) + (q.data?.after.length ?? 0) === 0 && !canAdd && <Empty text="No photos yet." />}
      <PhotoViewer rungId={rungId} photo={open} onClose={() => setOpen(null)} onDelete={canAdd ? confirmDelete : undefined} />
    </View>
  );
}
