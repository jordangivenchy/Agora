/* The seven fields, as the website lists them (types/database.ts), with
   a glyph from the app's icon set standing in for the site's drawings. */
import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export interface Topic { key: string; label: string; color: string; icon: IconName }

export const TOPICS: Topic[] = [
  { key: "politics-law", label: "Politics & Law", color: "#4a9eff", icon: "library-outline" },
  { key: "sports", label: "Sports", color: "#fd9644", icon: "podium-outline" },
  { key: "culture", label: "Culture", color: "#e056b8", icon: "color-palette-outline" },
  { key: "economics", label: "Economics", color: "#00b894", icon: "cash-outline" },
  { key: "science-tech", label: "Science & Tech", color: "#00cec9", icon: "flask-outline" },
  { key: "foreign-policy", label: "Foreign Policy", color: "#1976D2", icon: "globe-outline" },
  { key: "philosophy", label: "Philosophy", color: "#fdcb6e", icon: "book-outline" },
];

export function topicOf(key: string | null | undefined): Topic {
  return TOPICS.find((t) => t.key === key) ?? TOPICS[0];
}

/* A light field colour takes dark ink on its chip; the site's rule. */
export function darkInkOn(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}
