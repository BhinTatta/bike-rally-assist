/** Handing a file to another app, where the platform can. */

import { Platform } from "react-native";
import * as Sharing from "expo-sharing";

import { notify } from "./dialog";

export async function shareFile(uri: string, mimeType: string, title?: string): Promise<void> {
  if (Platform.OS === "web") {
    notify("Sharing works on the phone build");
    return;
  }
  try {
    if (!(await Sharing.isAvailableAsync())) {
      notify("Sharing is not available on this phone", "bad");
      return;
    }
    await Sharing.shareAsync(uri, { mimeType, ...(title ? { dialogTitle: title } : {}) });
  } catch {
    notify("Could not share that file", "bad");
  }
}
