// The ad space on the resident's dashboard: the switched-on dashboard ads play one after another in random order,
// muted; after each full round the order is shuffled again (and never starts with the ad that just played). Takes no
// room when there are none (or the phone's app build has no video player).
import { useEffect, useMemo, useState } from "react";
import { View, Text } from "react-native";
import { sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Video, shuffled, useAds, type Ad } from "./ads";

export function AdBanner({ enabled }: { enabled: boolean }) {
  const { ready, banners, sourceOf } = useAds(enabled);
  const ids = banners.map((b) => b.id).join(",");
  const [order, setOrder] = useState<Ad[]>([]);
  const [i, setI] = useState(0);
  // A fresh shuffle when the list of ads changes.
  const list = useMemo(() => banners, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setOrder(shuffled(list));
    setI(0);
  }, [list]);
  const next = () => {
    if (i + 1 < order.length) return setI(i + 1);
    // End of a round: shuffle again, not starting with the one that just played.
    let o = shuffled(list);
    if (o.length > 1 && o[0].id === order[i]?.id) o = [...o.slice(1), o[0]];
    setOrder(o);
    setI(0);
  };
  if (!Video || !ready || !order.length) return null;
  const ad = order[i] ?? order[0];
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 6 }}>
      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 9.5, letterSpacing: 1.2, textTransform: "uppercase", color: S.graphite }}>Advertisement</Text>
      <BannerPlayer key={`${ad.id}-${i}`} source={sourceOf(ad)} single={order.length === 1} onEnd={next} />
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
      <Video.VideoView player={player} surfaceType="textureView" style={{ width: "100%", aspectRatio: 16 / 9 }} contentFit="cover" nativeControls={false} allowsFullscreen={false} allowsPictureInPicture={false} />
    </View>
  );
}
