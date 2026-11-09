import { useEffect } from "react";
import { Alert } from "react-native";
import * as Updates from "expo-updates";

// Over-the-air patches (EAS Update). On launch the app checks for a newer
// patch for its build and downloads it in the background; the library applies
// it the next time the app is started. Most people rarely fully close the app,
// so once a patch has finished downloading this offers to restart straight
// away. Does nothing in development builds / Expo Go, where updates are off.
export function OtaUpdateGate() {
  const { isUpdatePending } = Updates.useUpdates();

  useEffect(() => {
    if (!isUpdatePending) return;
    Alert.alert("Update ready", "A new version of the app has been downloaded. Restart now to use it.", [
      { text: "Later", style: "cancel" },
      {
        text: "Restart now",
        onPress: () => {
          Updates.reloadAsync().catch(() => {});
        },
      },
    ]);
  }, [isUpdatePending]);

  return null;
}
