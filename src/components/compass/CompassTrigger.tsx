import { Search } from "lucide-react";
import { useCompass } from "./useCompass";

/** Navbar button that opens Compass — so discovery doesn't depend on the hotkey. */
export function CompassTrigger() {
  const { toggleCompass, shortcut } = useCompass();
  return (
    <button
      type="button"
      onClick={toggleCompass}
      title={`Find a page (${shortcut.alt} or ${shortcut.primary})`}
      aria-label="Find a page"
      className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center border border-border bg-muted hover:bg-muted/80 text-foreground transition-all duration-200 active:scale-90 hover:scale-105"
    >
      <Search size={15} />
    </button>
  );
}
