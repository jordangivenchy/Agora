"use client";

/* The consent moment: "«host» has invited you to join the discussion."
   Renders as a card sliding up from the bottom center. Accepting flips the
   invite to accepted and promotes this participant to speaker; declining
   just records the answer. The card never blocks the page. */

interface Props {
  inviterName: string;
  busy: boolean;
  onJoin: () => void;
  onDecline: () => void;
}

export default function InvitePrompt({ inviterName, busy, onJoin, onDecline }: Props) {
  return (
    <div className="ag-invite">
      <div className="ag-invite-text">
        <strong>{inviterName}</strong> has invited you to join the discussion.
      </div>
      <div className="ag-invite-actions">
        <button className="ag-invite-join" disabled={busy} onClick={onJoin}>
          Join Stage
        </button>
        <button className="ag-invite-decline" disabled={busy} onClick={onDecline}>
          Decline
        </button>
      </div>
    </div>
  );
}
