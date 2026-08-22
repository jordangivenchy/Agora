/* Browse field-tab glyphs. Thin wrapper over the shared icon set — the path
   data lives in icons.tsx under `topic-*` keys. Unknown keys render nothing
   so a topic without an icon falls back to its label alone. */

import { Icon, ICON_PATH_STRINGS, type IconName } from "./icons";

export default function TopicIcon({ topicKey, size = 15 }: { topicKey: string; size?: number }) {
  const name = `topic-${topicKey}` as IconName;
  if (!(name in ICON_PATH_STRINGS)) return null;
  return <Icon name={name} size={size} style={{ verticalAlign: "-2px" }} />;
}
