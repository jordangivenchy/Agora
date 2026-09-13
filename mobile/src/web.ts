/* What the app doesn't do natively yet opens as the website, in the
   in-app browser sheet, signed in as the phone's Safari is. */
import * as WebBrowser from "expo-web-browser";
import { SITE } from "./api";

export function openWeb(path: string): void {
  void WebBrowser.openBrowserAsync(`${SITE}${path.startsWith("/") ? path : `/${path}`}`);
}

export function openUrl(url: string): void {
  void WebBrowser.openBrowserAsync(url);
}
