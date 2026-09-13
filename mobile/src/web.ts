/* Links out of the app: a news outlet's own article opens in the in-app
   browser sheet. Everything AgoraSphere itself does is native now, so
   nothing of the site is opened this way. */
import * as WebBrowser from "expo-web-browser";

export function openUrl(url: string): void {
  void WebBrowser.openBrowserAsync(url);
}
