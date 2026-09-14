import { AlertCircle, RefreshCw, WifiOff, ShieldOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/fetchWithAuth";

interface PageErrorProps {
  error?: Error | null;
  onRetry?: () => void;
  className?: string;
}

function classify(error?: Error | null) {
  if (!error) return { icon: AlertCircle, title: "Something went wrong", body: "An unexpected error occurred. Try refreshing the page." };
  if (error instanceof ApiError) {
    if (error.status === 403) return { icon: ShieldOff, title: "Access denied", body: "You don't have permission to view this. Contact your administrator if you think this is wrong." };
    if (error.status === 404) return { icon: AlertCircle, title: "Not found", body: "The requested data couldn't be found. It may have been deleted or moved." };
    if (error.status >= 500) return { icon: AlertCircle, title: "Server error", body: "The server ran into a problem. This has been logged — try again in a moment." };
  }
  if (error.message?.toLowerCase().includes("network") || error.message?.toLowerCase().includes("fetch"))
    return { icon: WifiOff, title: "No connection", body: "Couldn't reach the server. Check your network and try again." };
  return { icon: AlertCircle, title: "Something went wrong", body: error.message || "An unexpected error occurred." };
}

export function PageError({ error, onRetry, className }: PageErrorProps) {
  const { icon: Icon, title, body } = classify(error);

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 py-20 px-6 text-center", className)}>
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <Icon size={22} className="text-destructive" />
      </div>
      <div className="space-y-1 max-w-sm">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <RefreshCw size={12} /> Try again
        </button>
      )}
    </div>
  );
}

/** Compact inline variant — use inside cards or table cells */
export function InlineError({ error, onRetry, className }: PageErrorProps) {
  const { title } = classify(error);
  return (
    <div className={cn("flex items-center gap-2 px-4 py-3 rounded-xl bg-destructive/5 border border-destructive/20 text-destructive text-sm", className)}>
      <AlertCircle size={14} className="shrink-0" />
      <span className="flex-1">{title}</span>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-1 text-xs underline underline-offset-2 hover:no-underline shrink-0">
          <RefreshCw size={11} /> Retry
        </button>
      )}
    </div>
  );
}
