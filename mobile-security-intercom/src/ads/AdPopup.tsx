// The resident's pop-up video ad: shown once per app launch when the dashboard opens (if any pop-up ad is switched on).
// It plays for 15 seconds or the whole video, whichever is longer — a shorter video repeats until 15 seconds — and
// only then can it be closed. Starts muted; the speaker key turns the sound on.
import { useEffect, useState } from "react";
import { Modal, View, Text, Pressable } from "react-native";
import { X, Volume2, VolumeX } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Video, markPopupShown, nextPopupIndex, popupAlreadyShown, useAds, type Ad } from "./ads";

const MIN_SECONDS = 15;

export function AdPopup({ enabled }: { enabled: boolean }) {
  const { ready, popups, sourceOf } = useAds(enabled);
  const [ad, setAd] = useState<Ad | null>(null);
  useEffect(() => {
    if (!ready || !popups.length || popupAlreadyShown()) return;
    markPopupShown();
    setAd(popups[nextPopupIndex(popups.length)]);
  }, [ready, popups]);
  if (!Video || !ad) return null;
  return <PopupPlayer source={sourceOf(ad)} onClose={() => setAd(null)} />;
}

function PopupPlayer({ source, onClose }: { source: { uri: string; headers?: Record<string, string> }; onClose: () => void }) {
  const [muted, setMuted] = useState(true);
  const [duration, setDuration] = useState(0); // seconds, once the video has loaded
  const [elapsed, setElapsed] = useState(0); // seconds the pop-up has been playing
  const [failed, setFailed] = useState(false);
  const player = Video.useVideoPlayer(source, (p: { loop: boolean; muted: boolean; play: () => void }) => {
    p.loop = true; // repeats until the 15 seconds are up
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    const subs = [
      player.addListener("sourceLoad", (e: { duration?: number }) => setDuration(Number(e?.duration) || 0)),
      player.addListener("statusChange", (e: { status?: string }) => e?.status === "error" && setFailed(true)),
    ];
    return () => subs.forEach((s: { remove: () => void }) => s.remove());
  }, [player]);

  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);

  // Count while playing; a video that won't load can be closed at once.
  useEffect(() => {
    const t = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const needed = Math.max(MIN_SECONDS, Math.ceil(duration));
  const left = failed ? 0 : Math.max(0, needed - elapsed);
  // Once it may close, a longer video stops repeating at its end.
  useEffect(() => {
    if (!left) player.loop = false;
  }, [left, player]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {
        if (!left) onClose();
      }}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", padding: 16 }}>
        <View style={{ backgroundColor: "#000", borderWidth: 1, borderColor: S.ink }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: S.paper }}>
            <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: S.graphite }}>Advertisement</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Pressable onPress={() => setMuted((m) => !m)} hitSlop={10} accessibilityLabel={muted ? "Turn the sound on" : "Turn the sound off"}>
                {muted ? <VolumeX size={18} color={S.ink} /> : <Volume2 size={18} color={S.ink} />}
              </Pressable>
              {left ? (
                <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 12, color: S.ink, minWidth: 22, textAlign: "right" }}>{left}</Text>
              ) : (
                <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close the ad">
                  <X size={20} color={S.ink} />
                </Pressable>
              )}
            </View>
          </View>
          <Video.VideoView player={player} style={{ width: "100%", aspectRatio: 16 / 9 }} contentFit="contain" nativeControls={false} allowsFullscreen={false} allowsPictureInPicture={false} />
          {failed && <Text style={{ color: "#fff", padding: 12, fontSize: 12 }}>The ad couldn't be played.</Text>}
        </View>
      </View>
    </Modal>
  );
}
