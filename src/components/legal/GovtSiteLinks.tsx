import React from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { getLegalPortalLinks } from "@/api/legalMastersApi";
import { usePageRights } from "@/hooks/usePageRights";

/**
 * Quick links to the official sites (Banglarbhumi, WB Registration…) saved in Setup → Government Site Links, to check
 * a land's records by hand. Each link opens in a new browser tab (government sites refuse to be shown inside another page).
 * Nothing is sent to or read from those sites.
 * The links come from Setup only — none is written into the page.
 */
export const GovtSiteLinks: React.FC<{ title?: string; hint?: string }> = ({
  title = "Check on government sites",
  hint = "Opens the official site in a new tab — enter the Mouza, Dag or Khatian there to verify.",
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
          {canSetup ? <>Add them in <b>Setup → Government Site Links</b> (e.g. Banglarbhumi for RoR / plot details, WB Registration for deed search).</> : "Ask an administrator to add them in Setup → Government Site Links."}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.map((l) => (
              // Government sites refuse to be shown inside another page, so each link opens in a new tab.
              <a
                key={l.LinkId}
                href={l.Url}
                target="_blank"
                rel="noopener noreferrer"
                title={`${l.ServiceType}${l.OfficeName ? ` · ${l.OfficeName}` : ""} — opens in a new tab${l.FallbackInstructions ? `\nIf the site is down: ${l.FallbackInstructions}` : ""}`}
                className="inline-flex items-center gap-1.5 border border-foreground px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-primary/10"
              >
                {l.LinkLabel}
                <span className="font-normal text-muted-foreground">· {l.ServiceType}</span>
                <ExternalLink size={12} />
              </a>
            ))}
          </div>
          <p className="mt-2 text-[0.6875rem] text-muted-foreground">{hint}</p>
        </>
      )}
    </div>
  );
};
