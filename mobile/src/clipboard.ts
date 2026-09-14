/* Text to the clipboard, with a line at the bottom when it lands. The
   module loads lazily so a build without it answers "Couldn't copy"
   instead of failing at launch. */
import { showToast } from "./toast";

export async function copyToClipboard(text: string, done: string | null = "Copied"): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
    await Clipboard.setStringAsync(text);
    if (done) showToast(done);
    return true;
  } catch {
    showToast("Couldn't copy");
    return false;
  }
}
