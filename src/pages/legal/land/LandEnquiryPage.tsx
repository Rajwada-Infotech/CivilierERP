import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageQuestion } from "iconsax-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { LegalShell } from "@/components/legal/LegalShell";
import { GovtSiteLinks } from "@/components/legal/GovtSiteLinks";
import { usePageRights } from "@/hooks/usePageRights";
import { convertEnquiry, setEnquiryStatus, getMyWhatsApp, setMyWhatsApp } from "@/api/legalLandApi";
import { askLegal } from "@/components/legal/LegalAsk";
import { LegalMasterTable } from "../LegalMasterPage";
import { openLegalMap } from "@/components/legal/LegalDocumentPreview";
import { legalMasterByKey } from "../legalMasters";

// Land enquiries: a new land opportunity. Converting one creates the Land ID and opens its Land Profile;
// a converted enquiry stays as it was, linked to its land.
export default function LandEnquiryPage() {
  const entry = legalMasterByKey("land-enquiry")!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const landRights = usePageRights("legal-land-master");
  const rights = usePageRights(entry.pageKey);

  const convert = async (id: number, no: string) => {
    if (!(await askLegal({ title: `Convert enquiry ${no}?`, message: "A new Land ID is created and its Land Profile opens. The enquiry becomes read-only.", confirmText: "Convert to land" }))) return;
    try {
      const r = await convertEnquiry(id);
      toast.success(r.message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
      navigate(`/legal/land/properties/${r.landId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not convert");
    }
  };

  const changeStatus = async (id: number, no: string, status: "Rejected" | "On Hold" | "Under Review") => {
    let reason: string | undefined;
    if (status !== "Under Review") {
      const r = await askLegal({
        title: status === "Rejected" ? `Reject enquiry ${no}?` : `Put enquiry ${no} on hold?`,
        message: status === "Rejected" ? "It can be reopened later; it cannot be converted while rejected." : "It cannot be converted while on hold.",
        input: { label: "Reason", required: true },
        confirmText: status === "Rejected" ? "Reject" : "Put on hold", tone: status === "Rejected" ? "danger" : "default",
      });
      if (!r) return;
      reason = r;
    }
    try {
      toast.success((await setEnquiryStatus(id, status, reason)).message);
      await queryClient.invalidateQueries({ queryKey: ["legal-master"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change the status");
    }
  };
  const small = "rounded-md border border-border px-2 py-1 text-xs hover:bg-muted";
  // Row tint and left edge by enquiry status, so the list reads at a glance.
  const STATUS_ROW: Record<string, string> = {
    "Under Review": "legal-enq-review",
    Interested: "legal-enq-interest",
    "On Hold": "legal-enq-hold",
    Rejected: "legal-enq-rejected",
    "Converted to Land Record": "legal-enq-converted",
  };


  return (
    <>
      <Breadcrumbs items={["Dashboard", "Legal", "Land Management", entry.label]} />
      <LegalShell title={entry.label} subtitle="New land opportunities. Convert one to create its Land ID and Land Profile." icon={MessageQuestion}>
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {([["New", "#d4d4d8"], ["Under Review", "#0ea5e9"], ["Interested", "#10b981"], ["On Hold", "#f59e0b"], ["Rejected", "#f43f5e"], ["Converted", "#7c4a2e"]] as const).map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
          ))}
        </div>
        <MyWhatsAppPrompt />
        <div className="mb-4"><GovtSiteLinks hint="Before converting an enquiry, check the plot on the official site. A link opens in the side panel; if a site stays blank there (some government sites block this), use ↗ to open it in a new tab." /></div>
        <LegalMasterTable
          entry={entry}
          rowClassName={(raw) => STATUS_ROW[String(raw.EnquiryStatus)]}
          // A converted enquiry is history: its details are kept and changed on the land it became.
          rowLock={(raw) => (raw.LandId ? `Converted to ${String(raw.LandCode ?? "a land")} — edit the land (Land Register → Edit), not the enquiry` : null)}
          rowActions={(raw) => {
            const id = Number(raw.EnquiryId);
            const no = String(raw.EnquiryNo);
            const st = String(raw.EnquiryStatus);
            // Latitude / longitude entered → open the plot on Google Maps.
            const map = raw.GpsLatitude != null && raw.GpsLongitude != null && (
              <button onClick={() => openLegalMap(raw.GpsLatitude, raw.GpsLongitude, `${no} · map`)} className={small} title="Show this plot on Google Maps in the side panel">Map</button>
            );
            if (raw.LandId) {
              return <span className="inline-flex gap-1.5">{map}<button onClick={() => navigate(`/legal/land/properties/${raw.LandId}`)} className={small}>Open land</button></span>;
            }
            if (!rights.canEdit) return map || null;
            // Rejected / on hold: only Resume. Otherwise: Convert, Hold, Reject.
            if (st === "Rejected" || st === "On Hold") {
              return <span className="inline-flex gap-1.5">{map}<button onClick={() => changeStatus(id, no, "Under Review")} className={small}>Resume</button></span>;
            }
            return (
              <span className="inline-flex flex-wrap justify-end gap-1.5">
                {map}
                {landRights.canCreate && <button onClick={() => convert(id, no)} className={small}>Convert to land</button>}
                <button onClick={() => changeStatus(id, no, "On Hold")} className={small}>Hold</button>
                <button onClick={() => changeStatus(id, no, "Rejected")} className={`${small} text-rose-600`}>Reject</button>
              </span>
            );
          }}
        />
      </LegalShell>
    </>
  );
}

// Enquiries are assigned to whoever raises them, and others reach that person on WhatsApp. When the logged-in user has
// no WhatsApp number yet, ask for it here (saved on their own user).
function MyWhatsAppPrompt() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["my-whatsapp"], queryFn: getMyWhatsApp, staleTime: 5 * 60_000 });
  const [no, setNo] = useState("");
  const [saving, setSaving] = useState(false);
  if (!data?.available || data.WhatsAppNo) return null;

  const save = async () => {
    setSaving(true);
    try {
      toast.success((await setMyWhatsApp(no)).message);
      await queryClient.invalidateQueries({ queryKey: ["my-whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["legal-master"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 border border-amber-500/40 bg-amber-500/5 px-3 py-2">
      <span className="text-xs text-foreground">
        <b>Add your WhatsApp number</b> — enquiries you raise are assigned to you, and others use it to talk to you about them.
      </span>
      <input value={no} onChange={(e) => setNo(e.target.value)} type="tel" inputMode="tel" maxLength={20}
        placeholder="e.g. 9876543210" onKeyDown={(e) => e.key === "Enter" && no.trim() && save()}
        className="h-8 w-44 rounded-md border border-border bg-background px-2 text-xs" />
      <button onClick={save} disabled={saving || !no.trim()}
        className="h-8 rounded-md border border-foreground bg-foreground px-3 text-xs font-medium text-card disabled:opacity-50">
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
