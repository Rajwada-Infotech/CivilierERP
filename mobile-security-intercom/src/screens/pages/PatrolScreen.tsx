// Menu → Patrol (residents): the patrol rounds guards walked at the resident's project today or yesterday (a guard
// starts and ends a round from their home page). Pick a round to replay it on the same Leaflet / OpenStreetMap map as
// the web's Security Live → Replay (inside a WebView). Only rounds at the resident's own project(s) are listed; the
// server checks that again for each route. Play walks the route; the slider picks any moment.
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { WebView as RNWebView } from "react-native-webview";
import { useQuery } from "@tanstack/react-query";
import { colors, sheet as S } from "@/theme/colors";
import { Body, Label, Notice, Press, Seg, Skel } from "@/components/sheet/Sheet";
import { patrolList, patrolTrail } from "@/api/securityMoreApi";

// react-native-webview's class typings don't match React 19's JSX types; the component itself is fine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const WebView = RNWebView as unknown as React.ComponentType<any>;
type WebViewHandle = { injectJavaScript: (js: string) => void };

// The map and the play bar live in the page; the app posts the zones and the route into it.
const HTML = (blue: string, red: string, ink: string, paper: string) => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
html,body{height:100%;margin:0;background:#ddd;font-family:sans-serif}
#m{position:absolute;top:0;left:0;right:0;bottom:56px}
#bar{position:absolute;left:0;right:0;bottom:0;height:56px;background:${paper};border-top:1px solid ${ink};display:flex;align-items:center;gap:8px;padding:0 10px;box-sizing:border-box}
#play{height:36px;min-width:72px;background:${ink};color:${paper};border:0;font:600 11px sans-serif;letter-spacing:1px;text-transform:uppercase}
#play:disabled{opacity:.4}
#speed{height:36px;border:1px solid ${ink};background:${paper};color:${ink};font:600 12px sans-serif;padding:0 6px}
#speed option{background:${paper};color:${ink}}
#pos{flex:1;accent-color:${blue}}
#at{font:600 11px sans-serif;min-width:58px;text-align:right;color:${ink}}
</style>
</head><body><div id="m"></div>
<div id="bar"><button id="play" disabled>Play</button><select id="speed"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select><input id="pos" type="range" min="0" max="0" value="0"/><span id="at"></span></div>
<script>
var map=L.map('m',{zoomControl:true}).setView([22.5726,88.3639],15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
var zl=L.layerGroup().addTo(map), rl=L.layerGroup().addTo(map), pts=[], done=null, dot=null, timer=null;
var play=document.getElementById('play'), pos=document.getElementById('pos'), at=document.getElementById('at'), speed=document.getElementById('speed');
function fmt(s){return new Date(s).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}
function show(i){
  if(!pts.length)return; i=Math.max(0,Math.min(pts.length-1,i)); pos.value=i;
  done.setLatLngs(pts.slice(0,i+1).map(function(p){return [p.lat,p.lng];}));
  var p=pts[i]; dot.setLatLng([p.lat,p.lng]); dot.setStyle({fillColor:p.inZone===false?'${red}':'${blue}'});
  at.textContent=fmt(p.at)+(p.inZone===false?' · out':'');
}
function stop(){if(timer){clearInterval(timer);timer=null;}play.textContent='Play';}
play.onclick=function(){
  if(timer){stop();return;}
  if(+pos.value>=pts.length-1)show(0);
  play.textContent='Pause';
  // At 1x a whole day's route plays in about 30 seconds, whatever its length.
  timer=setInterval(function(){
    var step=Math.max(1,Math.round(pts.length/375*(+speed.value))), n=+pos.value+step;
    show(n); if(n>=pts.length-1)stop();
  },80);
};
pos.oninput=function(){stop();show(+pos.value);};
window.zones=function(z){zl.clearLayers();(z||[]).forEach(function(x){(x.shapes||[]).forEach(function(r){L.polygon(r,{color:'${ink}',weight:1,opacity:.5,fillOpacity:.06}).addTo(zl);});});};
window.route=function(p){
  stop(); rl.clearLayers(); pts=p||[]; at.textContent='';
  pos.max=Math.max(0,pts.length-1); pos.value=0; play.disabled=pts.length<2;
  if(!pts.length)return;
  var ll=pts.map(function(q){return [q.lat,q.lng];});
  L.polyline(ll,{color:'${blue}',weight:3,opacity:.35}).addTo(rl);
  done=L.polyline([],{color:'${blue}',weight:4}).addTo(rl);
  dot=L.circleMarker(ll[0],{radius:9,color:'#fff',weight:2,fillColor:'${blue}',fillOpacity:1}).addTo(rl);
  if(ll.length==1)map.setView(ll[0],17); else map.fitBounds(ll,{padding:[30,30],maxZoom:18});
  show(pts.length-1);
};
</script></body></html>`;

type Day = "today" | "yesterday";
/** The phone's own day: today from midnight until now, or all of yesterday. */
function dayRange(day: Day): [Date, Date] {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (day === "today") return [start, new Date()];
  return [new Date(start.getTime() - 86400000), new Date(start.getTime() - 1)];
}
const time = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

export default function PatrolScreen() {
  const web = useRef<WebViewHandle>(null);
  const [ready, setReady] = useState(false);
  const [day, setDay] = useState<Day>("today");
  const [patrolId, setPatrolId] = useState<number | null>(null);
  const { data: list, error: listError, isLoading } = useQuery({
    queryKey: ["security-patrols", day],
    queryFn: () => {
      const [from, to] = dayRange(day);
      return patrolList(from, to);
    },
    refetchInterval: 60000,
  });
  const rounds = useMemo(() => list?.patrols ?? [], [list]);
  // The newest round is shown first; a round chosen on another day is dropped.
  useEffect(() => {
    if (!rounds.some((r) => r.id === patrolId)) setPatrolId(rounds[0]?.id ?? null);
  }, [rounds, patrolId]);
  const chosen = rounds.find((r) => r.id === patrolId) ?? null;
  const { data: trail, error, isFetching } = useQuery({
    queryKey: ["security-patrol-trail", patrolId],
    queryFn: () => patrolTrail(patrolId!),
    enabled: patrolId != null,
    // A round still going grows: read it again every 30 s.
    refetchInterval: chosen && !chosen.endedAt ? 30000 : false,
  });
  const html = useMemo(() => HTML(S.blue, S.red, S.ink, colors.background), []);

  useEffect(() => {
    if (ready && list) web.current?.injectJavaScript(`window.zones(${JSON.stringify(list.zones)}); true;`);
  }, [ready, list]);
  useEffect(() => {
    if (ready) web.current?.injectJavaScript(`window.route(${JSON.stringify(patrolId != null ? trail?.points ?? [] : [])}); true;`);
  }, [ready, trail, patrolId]);

  const km = trail ? (trail.distanceM >= 1000 ? `${(trail.distanceM / 1000).toFixed(1)} km` : `${trail.distanceM} m`) : "";
  const out = trail?.judged ? `${Math.round((trail.outside / trail.judged) * 100)}% outside the zone` : null;
  const shownError = (listError || error) as Error | null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: S.ink, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <Label>Patrol rounds · {rounds.length}</Label>
          <Seg options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }]} value={day} onChange={(v) => setDay(v as Day)} />
        </View>
        {isLoading ? (
          <Skel h={40} />
        ) : rounds.length ? (
          <ScrollView style={{ maxHeight: 150 }} nestedScrollEnabled>
            {rounds.map((r, i) => {
              const on = r.id === patrolId;
              return (
                <Press
                  key={r.id}
                  onPress={() => setPatrolId(r.id)}
                  style={(p) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderTopWidth: i ? 1 : 0,
                    borderTopColor: S.ruleSoft,
                    backgroundColor: on ? S.ink : p ? S.blueWash : "transparent",
                  })}
                >
                  <Body size={13} weight="semibold" color={on ? S.paper : S.ink} style={{ flex: 1 }}>
                    {r.guardName ?? "Guard"} · {r.gateName}
                  </Body>
                  <Body size={12} color={on ? S.paper : r.endedAt ? S.graphite : S.blue}>
                    {time(r.startedAt)} – {r.endedAt ? time(r.endedAt) : "now"}
                  </Body>
                </Press>
              );
            })}
          </ScrollView>
        ) : (
          <Body size={12.5} color={S.ink2}>No patrol round {day === "today" ? "yet today" : "yesterday"}.</Body>
        )}
        {chosen && (
          <Body size={11.5} color={S.graphite}>
            {isFetching && !trail ? "Reading the route…" : trail ? (trail.count ? [km, out, chosen.endedAt ? null : "still going"].filter(Boolean).join(" · ") : "No location was recorded on this round.") : " "}
          </Body>
        )}
      </View>
      {shownError && (
        <View style={{ padding: 12 }}>
          <Notice>{shownError.message}</Notice>
        </View>
      )}
      <WebView ref={web} originWhitelist={["*"]} source={{ html }} onLoadEnd={() => setReady(true)} style={{ flex: 1 }} />
    </View>
  );
}
