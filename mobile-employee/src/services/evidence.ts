// Punch evidence the backend requires for an Employee Portal In / Out: a live camera photo (JPEG data URL, shrunk to
// ~640px) and the device's current position with its accuracy. Camera only — never the gallery.
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import type { Evidence } from "@/api/employeeApi";

export class EvidenceError extends Error {}

export async function currentPosition(): Promise<{ latitude: number; longitude: number; accuracy: number | null }> {
  if (!(await Location.hasServicesEnabledAsync())) throw new EvidenceError("Location is switched off. Turn on Location (GPS) and try again.");
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== "granted") throw new EvidenceError("Allow location access for Employee Portal App in Settings to punch In / Out.");
  const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy != null ? Math.round(p.coords.accuracy) : null };
}

/** Opens the front camera; resolves null if the employee cancels. */
export async function livePhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (perm.status !== "granted") throw new EvidenceError("Allow camera access for Employee Portal App in Settings to punch In / Out.");
  const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], cameraType: ImagePicker.CameraType.front, quality: 0.7, allowsEditing: false });
  if (shot.canceled || !shot.assets?.[0]) return null;
  const small = await manipulateAsync(shot.assets[0].uri, [{ resize: { width: 640 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!small.base64) throw new EvidenceError("Could not read the photo. Please try again.");
  return `data:image/jpeg;base64,${small.base64}`;
}

/** Location first (so a GPS problem shows before the camera opens), then the photo. Null = cancelled. */
export async function captureEvidence(): Promise<Evidence | null> {
  const pos = await currentPosition();
  const photo = await livePhoto();
  if (!photo) return null;
  return { photo, ...pos };
}
