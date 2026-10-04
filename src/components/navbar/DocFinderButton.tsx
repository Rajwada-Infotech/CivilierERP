import React from "react";
import { FileSearch } from "lucide-react";
import { useDocFinder } from "@/components/docfinder/useDocFinder";

/** Visible entry point for the Alt+Shift+D "Find a document" dialog. */
export function DocFinderButton() {
  const { openDocFinder } = useDocFinder();
  return (
    <button
      type="button"
      onClick={openDocFinder}
      title="Find a document (Alt+Shift+D)"
      aria-label="Find a document"
      className="relative p-2.5 hover:bg-muted rounded-full transition-all active:scale-95"
    >
      <FileSearch size={20} />
    </button>
  );
}
