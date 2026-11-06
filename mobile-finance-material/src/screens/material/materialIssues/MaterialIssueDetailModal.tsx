// RN port of Issues.tsx's IssueViewOverlay, on the drawing sheet: the issue's number as the title with its date,
// company and project; its status and approval marks; the particulars (godown, issued to, cost centre, items, reason,
// remarks); and the issued items line by line with the godown's balance after each. Deferred vs. web: print.
import { useQuery } from "@tanstack/react-query";
import { View } from "react-native";
import { PackageMinus } from "lucide-react-native";
import { sheet as S } from "@/theme/colors";
import { getMaterialIssueById, type MaterialIssue } from "@/api/issuesApi";
import { ApprovalStatusChain } from "@/components/ApprovalStatusChain";
import { InfoGrid, Panel, SheetMark, statusTone } from "@/components/sheet/Sheet";
import { DetailSheet, LineList, fmtDate } from "@/components/sheet/Register";

export function MaterialIssueDetailModal({ recordId, onClose }: { recordId: number | null; onClose: () => void }) {
  const { data: issue, isLoading, isError, error, refetch } = useQuery<MaterialIssue>({
    queryKey: ["issue-detail", recordId],
    queryFn: () => getMaterialIssueById(recordId!),
    enabled: recordId != null,
  });
  const status = issue?.Status || "Draft";

  return (
    <DetailSheet
      visible={recordId != null}
      onClose={onClose}
      eyebrow="CivilierERP · Material · Material issue"
      title={issue ? issue.DocNo || issue.IssueNo || `ISS-${issue.IssueId}` : "Material issue"}
      subtitle={issue ? [fmtDate(issue.Date), issue.CompanyName, issue.ProjectName].filter(Boolean).join(" · ") : undefined}
      loading={isLoading || !issue}
      error={isError ? (error as Error)?.message || "Could not load this issue." : null}
      onRetry={() => refetch()}
    >
      {issue && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
            <SheetMark text={status} tone={/draft/i.test(status) ? "draft" : statusTone(status)} />
            <ApprovalStatusChain table="MaterialIssues" recordId={issue.IssueId} />
          </View>
          <InfoGrid
            items={[
              { label: "Company", value: issue.CompanyName || "—" },
              { label: "Project", value: issue.ProjectName || "—" },
              { label: "Date", value: fmtDate(issue.Date) },
              { label: "Godown", value: [issue.GodownName, issue.GodownCode].filter(Boolean).join(" · ") || "—" },
              ...(issue.IssuedTo ? [{ label: "Issued to", value: issue.IssuedTo }] : []),
              ...(issue.CostCenter ? [{ label: "Cost centre", value: issue.CostCenter }] : []),
              { label: "Items", value: `${issue.ItemCount ?? issue.items?.length ?? 0} (${issue.TotalQty ?? 0} units)` },
              { label: "Reason", value: issue.Reason || "—", wide: true },
              ...(issue.Remarks ? [{ label: "Remarks", value: issue.Remarks, wide: true }] : []),
            ]}
          />
          <Panel title={`Issued items (${issue.items?.length ?? 0})`} icon={<PackageMinus size={14} color={S.ink} />}>
            <LineList
              empty="No items on this issue."
              rows={(issue.items ?? []).map((it, i) => ({
                key: i,
                title: it.ItemName || "—",
                right: `${it.Quantity} ${it.UOMCode}`,
                rightNote: it.CurrentBalance != null ? `Balance after ${it.CurrentBalance}` : null,
                red: it.CurrentBalance != null && it.CurrentBalance < 0,
              }))}
            />
          </Panel>
        </>
      )}
    </DetailSheet>
  );
}
