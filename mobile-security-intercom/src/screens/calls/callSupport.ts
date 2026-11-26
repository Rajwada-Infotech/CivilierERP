// Whether this copy of the app can run an in-app voice call: LiveKit needs the WebRTC native module, which the
// installed Civilier Security app has and Expo Go doesn't. Only Expo Go is ruled out: on React Native's new
// architecture NativeModules.WebRTCModule can read as empty even when the module is there, so it isn't checked
// (a phone that really lacks it gets a clear message from the call screen instead).
import Constants, { ExecutionEnvironment } from "expo-constants";
import { isRunningInExpoGo } from "expo";

/** True only inside Expo Go. The installed app (release or development build) is never Expo Go, so messages that blame
 * Expo Go must check this first and otherwise show the real error. */
export const inExpoGo = () => isRunningInExpoGo() || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const nativeCallsAvailable = () => !inExpoGo();
