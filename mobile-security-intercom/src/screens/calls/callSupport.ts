// Whether this copy of the app can run an in-app voice call: LiveKit needs the WebRTC native module, which the
// installed Civilier Security app has and Expo Go doesn't.
import { NativeModules } from "react-native";
import { isRunningInExpoGo } from "expo";

export const nativeCallsAvailable = () => !isRunningInExpoGo() && !!NativeModules.WebRTCModule;
