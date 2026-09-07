/* Open a picture in the app's image viewer (components/ImageLightbox.tsx,
   mounted once in the root layout). Anything rendering an <img> that is
   worth seeing big wraps it in a button that calls openImage(url). */

export const LIGHTBOX_EVENT = "agora:lightbox";

export type LightboxDetail = { url: string; alt?: string };

export function openImage(url: string, alt?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<LightboxDetail>(LIGHTBOX_EVENT, { detail: { url, alt } }));
}
