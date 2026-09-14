import React from "react";
import { RotateCcw } from "lucide-react";

interface RefreshButtonProps {
  dataUpdatedAt: number;
  isFetching: boolean;
  onRefresh: () => void;
}

export const RefreshButton: React.FC<RefreshButtonProps> = ({ dataUpdatedAt, isFetching, onRefresh }) => {
  if (!dataUpdatedAt) return null;
  return (
    <button
      onClick={onRefresh}
      disabled={isFetching}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
    >
      <RotateCcw size={12} className={isFetching ? "animate-spin" : ""} />
      {isFetching ? "Refreshing…" : "Refresh"}
    </button>
  );
};
