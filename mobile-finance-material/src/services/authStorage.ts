// Secure, on-device replacement for the web app's localStorage.getItem("token")
// / localStorage.getItem("user") pattern (src/contexts/AuthContext.tsx).
// expo-secure-store uses Keychain on iOS and EncryptedSharedPreferences on
// Android — the RN-appropriate equivalent of "accepted SPA tradeoff, XSS
// accessible" the web app's own comment flags for localStorage.
//
// SecureStore has no web implementation (it's Keychain/EncryptedSharedPrefs-
// backed, native-only), so the web target — a secondary preview surface for
// this project, not the main target — falls back to localStorage, same
// tradeoff the actual web app already makes.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

const isWeb = Platform.OS === "web";

async function getItem(key: string): Promise<string | null> {
  return isWeb ? localStorage.getItem(key) : SecureStore.getItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (isWeb) {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  if (isWeb) {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function getToken(): Promise<string | null> {
  return getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await setItem(TOKEN_KEY, token);
}

export async function getStoredUser<T = unknown>(): Promise<T | null> {
  const raw = await getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function setStoredUser(user: unknown): Promise<void> {
  await setItem(USER_KEY, JSON.stringify(user));
}

export async function clearAuthStorage(): Promise<void> {
  await Promise.all([deleteItem(TOKEN_KEY), deleteItem(USER_KEY)]);
}
