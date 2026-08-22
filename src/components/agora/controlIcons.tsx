/* Call control bar icons — thin wrappers over the shared Lucide set in
   src/components/icons.tsx, kept so existing imports don't break. */

import { Icon } from "@/components/icons";

export function HandIcon() { return <Icon name="hand" />; }
export function SmileIcon() { return <Icon name="smile" />; }
export function MicIcon() { return <Icon name="mic" />; }
export function MicOffIcon() { return <Icon name="mic-off" />; }
export function CamIcon() { return <Icon name="video" />; }
export function CamOffIcon() { return <Icon name="video-off" />; }
export function LeaveIcon() { return <Icon name="phone-off" />; }
export function StepDownIcon() { return <Icon name="arrow-down-to-line" />; }
