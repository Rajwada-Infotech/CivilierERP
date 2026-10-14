import { ArrowDown, ArrowUp, CornerDownLeft } from "lucide-react";

// The key line under the list: how to move, open and close, and the chord that opens Compass from anywhere.
export function CompassFooter({ shortcut }: { shortcut: string }) {
  return (
    <div className="c-foot">
      <span className="c-hints">
        <span className="c-hint"><span className="c-key"><ArrowUp size={11} strokeWidth={2} /></span><span className="c-key"><ArrowDown size={11} strokeWidth={2} /></span><span className="c-label">Move</span></span>
        <span className="c-hint"><span className="c-key"><CornerDownLeft size={11} strokeWidth={2} /></span><span className="c-label">Open</span></span>
        <span className="c-hint"><span className="c-key">Esc</span><span className="c-label">Close</span></span>
      </span>
      <span className="c-hint hidden sm:inline-flex">
        <span className="c-label">Open anywhere</span>
        <span className="c-key">{shortcut}</span>
      </span>
    </div>
  );
}
