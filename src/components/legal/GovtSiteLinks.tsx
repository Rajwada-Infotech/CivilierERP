import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { getLegalPortalLinks } from "@/api/legalMastersApi";
import { usePageRights } from "@/hooks/usePageRights";
import { openLegalLink } from "./LegalDocumentPreview";

/**
 * Quick links to the official sites (Banglarbhumi, WB Registration…) saved in Setup → Official Portal Link, to check
 * a land's records by hand. A link opens inside the app's side panel, beside the work (that panel offers "Open in new
 * tab" for sites that refuse to be shown inside another page); the ↗ next to it opens a new tab directly.
 * Nothing is sent to or read from those sites.
 * The links come from Setup only — none is written into the page.
 */
export const GovtSiteLinks: React.FC<{ title?: string; hint?: string }> = ({
  title = "Check on government sites",
  hint = "Opens the official site in the side panel — enter the Mouza, Dag or Khatian there to verify. If it stays blank (some government sites block this), use ↗ to open a new tab.",
}) => {
  const navigate = useNavigate();
  const canSetup = usePageRights("legal-portal-link-master").canCreate;
  const { data, isLoading } = useQuery({ queryKey: ["legal-portal-links"], queryFn: getLegalPortalLinks, staleTime: 5 * 60_000 });

  return (
    <div className="border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="label">{title}</p>
        {canSetup && (
          <button onClick={() => navigate("/legal/setup/portal-link")} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Manage links
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading…</p>
      ) : !data?.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          No government site links saved yet.{" "}
          {canSetup ? <>Add them in <b>Setup → Official Portal Link</b> (e.g. Banglarbhumi for RoR / plot details, WB Registration for deed search).</> : "Ask an administrator to add them in Setup → Official Portal Link."}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.map((l) => (
              <span key={l.LinkId} className="inline-flex items-stretch border border-foreground">
                <button
                  type="button"
                  onClick={() => openLegalLink(l.Url, l.LinkLabel)}
                  title={`${l.ServiceType}${l.OfficeName ? ` · ${l.OfficeName}` : ""}${l.FallbackInstructions ? `\nIf the site is down: ${l.FallbackInstructions}` : ""}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-primary/10"
                >
                  {l.LinkLabel}
                  <span className="font-normal text-muted-foreground">· {l.ServiceType}</span>
                </button>
                <a
                  href={l.Url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in a new tab"
                  aria-label={`Open ${l.LinkLabel} in a new tab`}
                  className="inline-flex items-center border-l border-foreground px-2 text-foreground hover:bg-primary/10"
                >
                  <ExternalLink size={12} />
                </a>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">{hint}</p>
        </>
      )}
    </div>
  );
};
