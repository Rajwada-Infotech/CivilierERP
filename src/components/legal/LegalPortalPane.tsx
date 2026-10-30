import React, { useState } from "react";
import { Globe, RefreshCw, Maximize2, Minimize2, ExternalLink, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LegalPortalPaneProps {
  url: string;
  officeName?: string;
  onClose: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export const LegalPortalPane: React.FC<LegalPortalPaneProps> = ({
  url,
  officeName,
  onClose,
  isExpanded = false,
  onToggleExpand,
}) => {
  const [iframeKey, setIframeKey] = useState(0);

  const handleRefresh = () => {
    setIframeKey((prev) => prev + 1);
  };

  return (
    <div className="flex flex-col h-full min-h-[750px] rounded-2xl border-2 border-primary/30 bg-card shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      {/* Top Controls Toolbar */}
      <div className="bg-muted/80 border-b border-border/80 px-4 py-3 flex flex-wrap items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Globe size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-heading font-semibold text-foreground truncate">
                {officeName ? `${officeName} Portal` : "Official Registration Portal"}
              </span>
              <span className="text-[0.625rem] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-semibold uppercase">
                Side-by-Side
              </span>
            </div>
            <p className="text-[0.6875rem] font-mono text-muted-foreground truncate">{url}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            title="Reload Portal Frame"
          >
            <RefreshCw size={13} />
          </Button>

          {onToggleExpand && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggleExpand}
              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground hidden sm:inline-flex"
              title={isExpanded ? "Restore Half Width" : "Expand Pane Width"}
            >
              {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => window.open(url, "_blank")}
            className="h-8 px-2 text-xs text-primary hover:text-primary/90"
            title="Open in new window (if government portal X-Frame headers block embedded iframe)"
          >
            <ExternalLink size={13} className="mr-1" />
            <span className="text-[0.6875rem] font-semibold hidden md:inline">Popout</span>
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            title="Close Portal Workspace"
          >
            <X size={15} />
          </Button>
        </div>
      </div>

      {/* Helpful Guidance Banner */}
      <div className="bg-amber-500/10 border-b border-amber-500/20 px-3.5 py-2 flex items-center justify-between text-[0.6875rem] text-amber-800 dark:text-amber-300">
        <div className="flex items-center gap-1.5">
          <AlertCircle size={13} className="shrink-0 text-amber-600" />
          <span>
            West Bengal Official Portal Workspace. Enter searched deed results into the ERP form on the left.
          </span>
        </div>
        <span className="font-medium hidden sm:inline opacity-80">
          (If frame is blocked by portal security, use Popout)
        </span>
      </div>

      {/* Embedded Iframe */}
      <div className="relative flex-1 w-full bg-slate-100 dark:bg-slate-900 min-h-[640px]">
        <iframe
          key={iframeKey}
          src={url}
          title="Official Registration Portal"
          className="w-full h-full min-h-[640px] border-0"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      </div>
    </div>
  );
};
