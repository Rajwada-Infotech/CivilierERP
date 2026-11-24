// Guard: a new visitor at the gate. Pick the flat (search by block and flat number; only flats with residents show),
// take the visitor's photo, pick a reason or type one, and add name, phone or vehicle if needed. Send asks the flat;
// the result screen follows the answer. With no network the request is queued on the phone and sent once it's back.
import { useEffect, useState } from "react";
import { View, Text, ScrollView, Image, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { Camera, RotateCcw, Send } from "lucide-react-native";
import type { MainStackParamList } from "@/navigation/MainStack";
import { colors, sheet as S } from "@/theme/colors";
import { fonts } from "@/theme/fonts";
import { Body, Field, Input, Key, Label, Notice, Press, SheetFrame, Skel, TitleBlock } from "@/components/sheet/Sheet";
import { createVisitor, searchFlats, VisitorRefused } from "@/api/visitorsApi";
import { enqueue, newRequestId } from "@/visitors/offlineQueue";

const REASONS = ["Guest", "Delivery", "Cab / taxi", "Maid / help", "Service / repair", "Courier"];
const flatOf = (block: string, flat: string) => (block ? `${block}-${flat}` : flat);

export default function NewVisitorScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [flat, setFlat] = useState<{ block: string; flatNo: string } | null>(null);
  const [photo, setPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [reason, setReason] = useState("");
  const [otherReason, setOtherReason] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isLoading, isError, error: flatsError } = useQuery({ queryKey: ["security-flats", debounced], queryFn: () => searchFlats(debounced), staleTime: 60_000 });

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera", "Allow camera access in the phone's settings to photograph visitors.");
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.4, base64: true, allowsEditing: false, exif: false });
    if (!r.canceled && r.assets[0]?.base64) setPhoto({ uri: r.assets[0].uri, base64: r.assets[0].base64 });
  };

  const finalReason = reason === "Other" ? otherReason.trim() : reason;
  const ready = !!flat && !!photo && !!finalReason;

  const send = async () => {
    if (!flat) return setError("Choose the flat.");
    if (!photo) return setError("Take the visitor's photo.");
    if (!finalReason) return setError("Choose or type the reason.");
    setError(null);
    setSending(true);
    const v = {
      clientRequestId: newRequestId(),
      block: flat.block,
      flatNo: flat.flatNo,
      reason: finalReason,
      visitorName: name.trim() || undefined,
      visitorPhone: phone.trim() || undefined,
      vehicleNo: vehicle.trim() || undefined,
      photoBase64: photo.base64,
    };
    try {
      const sent = await createVisitor(v);
      navigation.replace("VisitorStatus", { id: sent.id });
    } catch (e) {
      if (e instanceof VisitorRefused) setError(e.message);
      else {
        // No network: keep it on the phone; it's sent (once) as soon as the server can be reached.
        await enqueue(v);
        navigation.replace("VisitorStatus", { queuedId: v.clientRequestId, flat: flatOf(v.block, v.flatNo) });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <SheetFrame>
          <TitleBlock eyebrow={data?.gate ? `${data.gate.projectName} · ${data.gate.name}` : "Civilier Security · Guard"} title="New visitor" />

          {data && !data.gate && (
            <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
              <Notice>You have no gate assignment today. Ask your supervisor to assign you to a gate.</Notice>
            </View>
          )}
          {isError && (
            <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16 }}>
              <Notice>{(flatsError as Error)?.message || "Could not reach the server."}</Notice>
            </View>
          )}

          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, paddingHorizontal: 16, paddingVertical: 10 }}>
            <Press onPress={() => navigation.navigate("ExpectedGuests")} style={(p) => ({ paddingVertical: 6, opacity: p ? 0.6 : 1 })}>
              <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 11, letterSpacing: 1, color: S.blue }}>GUEST HAS A PASS CODE? LET THEM IN →</Text>
            </Press>
          </View>

          {/* 1 · Flat */}
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
            <Field label="Flat" required>
              {flat ? (
                <Press onPress={() => setFlat(null)} style={(p) => ({ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderColor: S.ink, backgroundColor: p ? S.blueWash : S.ink })}>
                  <Text style={{ fontFamily: fonts.heading.bold, fontSize: 18, color: S.paper }}>{flatOf(flat.block, flat.flatNo)}</Text>
                  <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 10, letterSpacing: 1.1, color: S.paper }}>CHANGE</Text>
                </Press>
              ) : (
                <Input value={q} onChangeText={setQ} placeholder="Block and flat, e.g. A302" autoCapitalize="characters" autoCorrect={false} />
              )}
            </Field>
            {!flat &&
              (isLoading ? (
                <Skel h={40} />
              ) : (data?.flats ?? []).length === 0 ? (
                <Body size={12.5} color={S.graphite}>{data?.gate ? (debounced ? "No flat with residents matches." : "No residents are registered at this project yet.") : ""}</Body>
              ) : (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {data!.flats.map((f) => (
                    <Press
                      key={`${f.block}|${f.flatNo}`}
                      onPress={() => setFlat({ block: f.block, flatNo: f.flatNo })}
                      style={(p) => ({ minWidth: 72, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: S.ink, alignItems: "center", backgroundColor: p ? S.blueWash : "transparent" })}
                    >
                      <Text style={{ fontFamily: fonts.heading.semibold, fontSize: 15, color: S.ink }}>{flatOf(f.block, f.flatNo)}</Text>
                    </Press>
                  ))}
                </View>
              ))}
          </View>

          {/* 2 · Photo */}
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
            <Label>
              Visitor's photo<Text style={{ color: S.red }}> *</Text>
            </Label>
            {photo ? (
              <View style={{ gap: 8 }}>
                <Image source={{ uri: photo.uri }} style={{ width: "100%", aspectRatio: 3 / 4, borderWidth: 1, borderColor: S.ink }} resizeMode="cover" />
                <Key label="Retake" icon={<RotateCcw size={14} color={S.ink} />} onPress={takePhoto} />
              </View>
            ) : (
              <Key tone="ink" label="Take photo" icon={<Camera size={15} color={S.paper} />} onPress={takePhoto} />
            )}
          </View>

          {/* 3 · Reason */}
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 10 }}>
            <Label>
              Reason<Text style={{ color: S.red }}> *</Text>
            </Label>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {[...REASONS, "Other"].map((r) => {
                const on = reason === r;
                return (
                  <Press key={r} onPress={() => setReason(r)} style={(p) => ({ paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: S.ink, backgroundColor: on ? S.ink : p ? S.blueWash : "transparent" })}>
                    <Text style={{ fontFamily: fonts.body.semibold, fontSize: 13, color: on ? S.paper : S.ink }}>{r}</Text>
                  </Press>
                );
              })}
            </View>
            {reason === "Other" && <Input value={otherReason} onChangeText={setOtherReason} placeholder="Type the reason" maxLength={200} />}
          </View>

          {/* 4 · Details */}
          <View style={{ borderTopWidth: 1, borderTopColor: S.rule, padding: 16, gap: 12 }}>
            <Field label="Visitor's name">
              <Input value={name} onChangeText={setName} placeholder="Optional" maxLength={150} />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChangeText={setPhone} placeholder="Optional" keyboardType="phone-pad" maxLength={20} />
            </Field>
            <Field label="Vehicle number">
              <Input value={vehicle} onChangeText={setVehicle} placeholder="Optional, e.g. WB02AB1234" autoCapitalize="characters" maxLength={30} />
            </Field>
          </View>

          <View style={{ borderTopWidth: 1, borderTopColor: S.ink, padding: 16, gap: 10 }}>
            {error && <Notice>{error}</Notice>}
            <Key tone="ink" label={sending ? "Sending…" : "Ask the flat"} icon={<Send size={14} color={S.paper} />} onPress={send} disabled={sending || !ready || (data ? !data.gate : false)} />
          </View>
        </SheetFrame>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
