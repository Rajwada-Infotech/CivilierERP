// The ad space on the resident's dashboard: the switched-on dashboard ads play one after another, muted, round and
// round. Takes no room when there are none (or the phone's app build has no video player).
import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Video, useAds } from "./ads";

export function AdBanner({ enabled }: { enabled: boolean }) {
  const { ready, banners, sourceOf } = useAds(enabled);
  const [i, setI] = useState(0);
  if (!Video || !ready || !banners.length) return null;
  const ad = banners[i % banners.length];
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 6 }}>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: S.graphite }}>Advertisement</Text>
      <BannerPlayer key={ad.id} source={sourceOf(ad)} single={banners.length === 1} onEnd={() => setI((n) => n + 1)} />
    </View>
  );
}

function BannerPlayer({ source, single, onEnd }: { source: { uri: string; headers?: Record<string, string> }; single: boolean; onEnd: () => void }) {
  const player = Video.useVideoPlayer(source, (p: { loop: boolean; muted: boolean; play: () => void }) => {
    p.loop = single; // one ad: repeat it; several: move to the next at the end
    p.muted = true;
    p.play();
  });
  useEffect(() => {
    if (single) return;
    const subs = [
      player.addListener("playToEnd", onEnd),
      // A video that can't play is skipped after a moment.
      player.addListener("statusChange", (e: { status?: string }) => e?.status === "error" && setTimeout(onEnd, 3000)),
    ];
    return () => subs.forEach((s: { remove: () => void }) => s.remove());
  }, [player, single, onEnd]);
  return (
    <View style={{ borderWidth: 1, borderColor: S.ink, backgroundColor: "#000" }}>
      <Video.VideoView player={player} style={{ width: "100%", aspectRatio: 16 / 9 }} contentFit="cover" nativeControls={false} allowsFullscreen={false} allowsPictureInPicture={false} />
    </View>
  );
}
