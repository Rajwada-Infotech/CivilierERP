import { useNavigate, useSearchParams } from "react-router-dom";
import { Global } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { LegalMasterTable } from "../LegalMasterPage";
import { legalMasterByKey } from "../legalMasters";
import type { LegalRow } from "@/api/legalMastersApi";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePageRights } from "@/hooks/usePageRights";
import { askLegal } from "@/components/legal/LegalAsk";
import { deleteLand } from "@/api/legalLandApi";

const BACKLOG = "Existing / Backlog";

// Clean filter rules for the Company Land Register
const FILTERS: Record<string, { label: string; test: (r: LegalRow) => boolean }> = {
  "newly-acquired": {
    label: "Newly Acquired",
    test: (r) => r.EntryType === "Newly Acquired" || r.EntryType === "New Acquisition",
  },
  backlog: {
    label: "Existing / Backlog",
    test: (r) => r.EntryType === BACKLOG,
  },
  owned: {
    label: "Active / Owned",
    test: (r) => r.LandStatus === "Owned" || r.LandStatus === "Active" || r.IsActive !== false,
  },
  disposed: {
    label: "Disposed / Inactive",
    test: (r) => r.LandStatus === "Disposed / Transferred" || r.LandStatus === "Inactive" || r.IsActive === false,
  },
};

// The central Company Land Register: every land property with its unique Land ID.
export default function LandPropertyListPage({ registerExisting = false }: { registerExisting?: boolean }) {
  const entry = legalMasterByKey("land")!;
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filterKey = params.get("filter") ?? "";
  const filter = FILTERS[filterKey];
  const registeringBacklog = registerExisting || params.get("entry") === "backlog";
  const canDelete = usePageRights(entry.pageKey).canDelete;
  const queryClient = useQueryClient();

  // Deleting a land removes everything recorded on it, so the Land ID must be typed to confirm.
  const removeLand = async (raw: LegalRow) => {
    const code = String(raw.LandCode ?? "");
    const typed = await askLegal({
      title: `Delete ${code}?`,
      message: `This permanently removes ${code} (${String(raw.LandName ?? "")}) and everything recorded on it — ownership history, land records, documents and their files, legal records, loans, mutations, payments, tax receipts, valuations, photos and pipeline steps, and the enquiry it came from. This cannot be undone.`,
      input: { label: `Type ${code} to confirm`, placeholder: code, required: true },
      confirmText: "Delete land",
      tone: "danger",
    });
    if (typed === null) return;
    if (typed.trim() !== code) { toast.error(`The Land ID did not match — ${code} was not deleted`); return; }
    try {
      toast.success((await deleteLand(Number(raw.LandId), typed.trim())).message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
      queryClient.invalidateQueries({ queryKey: ["legal-land-stats"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete the land");
    }
  };

  const set = (k: string, v: string | null) => {
    if (v) params.set(k, v);
    else params.delete(k);
    setParams(params);
  };

  const tabBtn = (on: boolean) =>
    `border px-2.5 py-1 text-xs font-heading font-semibold transition-colors ${
      on
        ? "border-foreground bg-foreground text-card"
        : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
    }`;

  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", registeringBacklog ? "Register Existing Land" : "Land Register"]} />
      <LegalShell
        title={registeringBacklog ? "Register Existing Land" : "Company Land Register"}
        subtitle={
          registeringBacklog
            ? "Record company-owned land acquired in the past, with all historical records and documents."
            : "Central repository of all company-owned and company-acquired land properties, one Land ID each."
        }
        icon={Global}
        action={
          <button
            onClick={() => navigate(registeringBacklog ? "/legal/land/properties" : "/legal/land/register-existing")}
            className="border border-foreground bg-foreground px-3 py-2 text-xs font-heading font-semibold uppercase tracking-[0.08em] text-card hover:opacity-85"
          >
            {registeringBacklog ? "Back to Land Register" : "Register Existing Land"}
          </button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <button className={tabBtn(!filterKey)} onClick={() => set("filter", null)}>
            All Land
          </button>
          <button className={tabBtn(filterKey === "newly-acquired")} onClick={() => set("filter", "newly-acquired")}>
            Newly Acquired
          </button>
          <button className={tabBtn(filterKey === "backlog")} onClick={() => set("filter", "backlog")}>
            Existing / Backlog
          </button>
          <button className={tabBtn(filterKey === "owned")} onClick={() => set("filter", "owned")}>
            Active / Owned
          </button>
          <button className={tabBtn(filterKey === "disposed")} onClick={() => set("filter", "disposed")}>
            Disposed / Inactive
          </button>
          {filter && (
            <span className="ml-2 text-xs text-muted-foreground">
              Showing: <b className="text-foreground">{filter.label}</b>
            </span>
          )}
        </div>

        {registeringBacklog && (
          <p className="mb-3 border border-border px-3 py-2 text-xs text-muted-foreground">
            <b className="text-foreground">Registering existing / backlog land</b> — enter the details you currently have.
            Unknown or pending information can be added gradually at any time. Once saved, open the Land Profile to maintain
            ownership history, documents, legal records, loans/mortgages, mutations, payments, and tax receipts.
          </p>
        )}

        <LegalMasterTable
          key={registeringBacklog ? "backlog" : "all"}
          entry={entry}
          requestEditId={params.get("edit")}
          defaults={registeringBacklog ? { EntryType: BACKLOG, LandStatus: "Owned" } : { EntryType: "Newly Acquired" }}
          rowFilter={filter?.test}
          onCreated={(newId) => navigate(`/legal/land/properties/${newId}?tab=overview`)}
          rowActions={(raw) => (
            <span className="inline-flex gap-1.5">
              <button
                onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                title="Open complete 14-tab property profile"
              >
                View Details
              </button>
              <button
                onClick={() => navigate(`/legal/land/properties?edit=${raw.LandId}`)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Edit basic land information"
              >
                Edit
              </button>
              {canDelete && (
                <button
                  onClick={() => removeLand(raw)}
                  className="rounded-md border border-destructive/50 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                  title="Delete this land and all its records"
                >
                  Delete
                </button>
              )}
            </span>
          )}
        />
      </LegalShell>
    </>
  );
}
