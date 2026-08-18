/* Stroke icons for the call control bar — same voice as the rail/stage
   glyphs: 24 viewBox, 2px round strokes, currentColor. Emoji read as chat
   content; controls get line icons. */

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function HandIcon() {
  return (
    <svg {...base}>
      <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5v-1a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V13m-9-1v2.5L6.6 13a1.4 1.4 0 0 0-2.1 1.8l3.2 5A5 5 0 0 0 12 22h1a4 4 0 0 0 4-4v-4" />
    </svg>
  );
}

export function SmileIcon() {
  return (
    <svg {...base}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
      <path d="M9 10h.01M15 10h.01" strokeWidth="2.6" />
    </svg>
  );
}

export function MicIcon() {
  return (
    <svg {...base}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function MicOffIcon() {
  return (
    <svg {...base}>
      <path d="M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-.5 1.66M9 9v2a3 3 0 0 0 4.6 2.53" />
      <path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.65 2.94M12 18v3" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function CamIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="7" width="12" height="10" rx="2.5" />
      <path d="M15 10.5 20 8v8l-5-2.5" />
    </svg>
  );
}

export function CamOffIcon() {
  return (
    <svg {...base}>
      <path d="M8.5 7H13a2 2 0 0 1 2 2v1.5L20 8v8l-2.5-1.25M15 15a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

export function LeaveIcon() {
  return (
    <svg {...base}>
      <path d="M3.5 14.5c5-4.7 12-4.7 17 0M6.2 17.2l-2.4-2.4M17.8 17.2l2.4-2.4" />
    </svg>
  );
}

export function StepDownIcon() {
  return (
    <svg {...base}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3.5m0 0-2-2m2 2 2-2" />
    </svg>
  );
}
