import { useNavigate } from "react-router-dom";
import { ArrowRight2 } from "iconsax-react";

/**
 * The land pipeline as one set of tabs, shown on top of every stage page so the seven stages read as one page:
 * Enquiry → Deed registry search → Land conversion → Deed Process → LA & ULC → Deed Registration → Post-registration.
 * (Verification and approvals are in Approvals, not a pipeline stage.)
 */
export type PipelineStage = "enquiry" | "search" | "verification" | "verify" | "deed" | "clearance" | "registration" | "post";
export const PIPELINE: { key: PipelineStage; label: string; path: string; hint: string }[] = [
  { key: "enquiry", label: "Enquiries", path: "/legal/land/enquiries", hint: "Land offered or found — record it under a project" },
  { key: "search", label: "Deed search", path: "/legal/land/deed-search", hint: "Search the registry offices year by year" },
  { key: "verification", label: "Legal verification", path: "/legal/land/verification", hint: "The legal checks on an enquiry, activity by activity" },
  { key: "verify", label: "Land conversion", path: "/legal/land/properties?filter=verification", hint: "Converted lands being entered and verified — before Deed Process" },
  { key: "deed", label: "Deed Process", path: "/legal/land/deed-process", hint: "Deed details completed, then sent for final approval" },
  { key: "clearance", label: "LA & ULC", path: "/legal/land/la-ulc", hint: "Apply for and obtain the clearances" },
  { key: "registration", label: "Deed Registration", path: "/legal/deed-registration", hint: "Consideration, stamp duty, registration" },
  { key: "post", label: "Post-registration", path: "/legal/land/post-registration", hint: "Mutation and the tasks after registration" },
];

export function PipelineTabs({ stage }: { stage: PipelineStage }) {
  const navigate = useNavigate();
  const at = PIPELINE.findIndex((s) => s.key === stage);
  return (
    <nav aria-label="Land pipeline" className="mb-4 border border-border bg-card">
      <ol className="flex overflow-x-auto">
        {PIPELINE.map((s, i) => (
          <li key={s.key} className="flex shrink-0 items-center">
            <button onClick={() => navigate(s.path)} title={s.hint} aria-current={i === at ? "step" : undefined}
              className={`relative flex items-center gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] transition-colors ${i === at ? "bg-foreground text-background" : i < at ? "text-foreground hover:bg-primary/5" : "text-muted-foreground hover:bg-primary/5 hover:text-foreground"}`}>
              <span className={`flex h-5 w-5 items-center justify-center border text-[0.625rem] ${i === at ? "border-background" : "border-current"}`}>{i + 1}</span>
              {s.label}
            </button>
            {i < PIPELINE.length - 1 && <ArrowRight2 size={12} className="mx-0.5 text-muted-foreground" />}
          </li>
        ))}
      </ol>
      <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">Step {at + 1} of {PIPELINE.length} · {PIPELINE[at]?.hint}</p>
    </nav>
  );
}
