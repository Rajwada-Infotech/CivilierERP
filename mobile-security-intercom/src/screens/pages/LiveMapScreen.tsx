// Menu → Live map (security admin): every guard on shift, their trail and the zones, on the same Leaflet / OpenStreetMap
// map as the web (inside a WebView, so no Google Maps key is needed). Blue in the zone, red outside, grey no recent
// location. Re-read every 15 s.
import { useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";

import { useQuery } from "@tanstack/react-query";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Label, Notice } from "@/components/sheet/Sheet";
import { getLive } from "@/api/securityMoreApi";

// react-native-webview's class typings don't match React 19's JSX types; the component itself is fine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WebView = RNWebView as unknown as React.ComponentType<any>;
type WebViewHandle = { injectJavaScript: (js: string) => void };

// Leaflet from a pinned CDN version; the page draws whatever data the app posts into it.
const HTML = (blue: string, red: string, grey: string, ink: string) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{height:100%;margin:0;background:#ddd}.lbl{font:600 11px sans-serif;background:#fff;border:1px solid ${ink};padding:1px 4px}</style>
</head><body><div id="m"></div><script>
var map=L.map('m',{zoomControl:true}).setView([22.5726,88.3639],13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
var layer=L.layerGroup().addTo(map), fitted=false;
window.draw=function(d){
  layer.clearLayers(); var pts=[];
  (d.zones||[]).forEach(function(z){(z.shapes||[]).forEach(function(r){L.polygon(r,{color:'${ink}',weight:1,opacity:.5,fillOpacity:.06}).addTo(layer);});});
  (d.guards||[]).forEach(function(g){
    var stale=!g.last||(Date.now()-new Date(g.last.at).getTime())>300000;
    var c=stale?'${grey}':(g.last.inZone===false?'${red}':(g.last.inZone?'${blue}':'${grey}'));
    if(g.trail&&g.trail.length>1)L.polyline(g.trail,{color:c,weight:3,opacity:.7}).addTo(layer);
    if(g.last){var p=[g.last.lat,g.last.lng];pts.push(p);
      L.circleMarker(p,{radius:9,color:'#fff',weight:2,fillColor:c,fillOpacity:1}).addTo(layer)
       .bindTooltip(g.name+' · '+g.gateName,{permanent:true,direction:'top',offset:[0,-8],className:'lbl'});}
  });
  if(!fitted&&pts.length){fitted=true; if(pts.length==1)map.setView(pts[0],17); else map.fitBounds(pts,{padding:[30,30],maxZoom:18});}
};
</script></body></html>`;

export default function LiveMapScreen() {
  const web = useRef<WebViewHandle>(null);
  const ready = useRef(false);
  const { data, error, dataUpdatedAt } = useQuery({ queryKey: ["security-live"], queryFn: getLive, refetchInterval: 15000 });
  const html = useMemo(() => HTML(S.blue, S.red, colors.mutedForeground, colors.background), []);

  const push = () => {
    if (!ready.current || !data) return;
    web.current?.injectJavaScript(`window.draw(${JSON.stringify(data)}); true;`);
  };
  useEffect(push, [data]);

  const guards = data?.guards ?? [];
  const out = guards.filter((g) => g.last?.inZone === false).length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: S.ink, gap: 2 }}>
        <Label>Live map · {guards.length} on shift{out ? ` · ${out} outside` : ""}</Label>
        <Body size={11.5} color={S.graphite}>
          {dataUpdatedAt ? `Read ${new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Reading…"} · blue in zone, red outside, grey no recent location
        </Body>
      </View>
      {error && (
        <View style={{ padding: 12 }}>
          <Notice>{(error as Error).message}</Notice>
        </View>
      )}
      <WebView
        ref={web}
        originWhitelist={["*"]}
        source={{ html }}
        onLoadEnd={() => {
          ready.current = true;
          push();
        }}
        style={{ flex: 1 }}
      />
    </View>
  );
}
