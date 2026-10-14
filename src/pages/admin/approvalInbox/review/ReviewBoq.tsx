import { formatINR } from "@/utils/formatCurrency";
import { BoqLines } from "./parts";
import type { ApprovalReviewState } from "./useApprovalReview";

// A BOQ's items and activities.
export function ReviewBoq({ r }: { r: ApprovalReviewState }) {
  const { boqItems, boqActivities } = r;
  return (
    <>
      {/* BOQ: items and activities as detailed lists */}
      {(boqItems.length > 0 || boqActivities.length > 0) && (
        <div className="space-y-4">
          {boqItems.length > 0 && (
            <BoqLines
              title={`Items (${boqItems.length})`}
              rows={boqItems.map((li) => ({
                name: (li.ItemName as string) || "—",
                code: (li.ItemCode as string) || "",
                sub: (li.ActivityName as string) ? `Activity: ${li.ActivityName}` : "",
                description: (li.Description as string) || "",
                facts: [
                  ["Qty", `${Number(li.Quantity ?? 0).toLocaleString("en-IN")}${li.UomName ? ` ${li.UomName}` : ""}`],
                  ["Rate", formatINR(Number(li.Rate ?? 0))],
                  ["Tax", `${Number(li.TaxPct ?? 0)}%`],
                ],
                amount: formatINR(Number(li.LineAmount ?? 0)),
              }))}
            />
          )}
          {boqActivities.length > 0 && (
            <BoqLines
              title={`Activities (${boqActivities.length})`}
              rows={boqActivities.map((li) => ({
                name: (li.ActivityName as string) || "—",
                code: (li.ActivityCode as string) || "",
                sub: (li.GroupName as string) ? `Group: ${li.GroupName}` : "",
                description: (li.Description as string) || "",
                facts: [
                  ...(li.Area != null ? [["Area", Number(li.Area).toLocaleString("en-IN")] as [string, string]] : []),
                  ["Qty", `${Number(li.Quantity ?? 0).toLocaleString("en-IN")}${li.UomName ? ` ${li.UomName}` : ""}`],
                  ["Rate", formatINR(Number(li.Rate ?? 0))],
                  ["Tax", `${Number(li.TaxPct ?? 0)}%`],
                ],
                amount: formatINR(Number(li.LineAmount ?? 0)),
              }))}
            />
          )}
        </div>
      )}
    </>
  );
}
