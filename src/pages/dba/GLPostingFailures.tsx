import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { usePageRights } from "@/hooks/usePageRights";
import { DbaShell } from "@/components/dba/DbaShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTriangle, RefreshCw, CheckCircle2 } from "lucide-react";
import { getGLPostingFailures, retryGLPosting } from "@/api/dbaApi";

const OUTCOME_STYLE: Record<string, string> = {
  failed: "bg-red-500/15 text-red-600 border-red-500/30",
  skipped: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  none: "bg-slate-500/15 text-slate-600 border-slate-500/30",
  posted: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
};

function fmtDateTime(value: string) {
  const naive = value.replace(/Z$/, "");
  const d = new Date(naive);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function GLPostingFailures() {
  usePageRights("dba-gl-posting-failures");
  const qc = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["dba-gl-posting-failures", showAll],
    queryFn: () => getGLPostingFailures(showAll),
  });

  const retryMutation = useMutation({
    mutationFn: (logId: number) => retryGLPosting(logId),
    onMutate: (logId) => setRetryingId(logId),
    onSuccess: (res) => {
      if (res.outcome?.posted) {
        toast.success("Posted to GL successfully.");
      } else {
        toast.error(res.outcome?.reason || "Still not posted — see reason.");
      }
      qc.invalidateQueries({ queryKey: ["dba-gl-posting-failures"] });
    },
    onError: (err: Error) => toast.error(err.message),
    onSettled: () => setRetryingId(null),
  });

  return (
    <div className="max-w-[1400px] mx-auto">
      <Breadcrumbs items={[{ label: "DBA Console" }, { label: "GL Posting Failures" }]} />

      <DbaShell
        title="GL Posting Failures"
        subtitle="Approved documents whose ledger posting was skipped or failed — fix the underlying issue, then retry."
        icon={AlertTriangle}
        action={
          <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show failures only" : "Show all attempts"}
          </Button>
        }
      >
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead>Module</TableHead>
                    <TableHead>Record</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Approver</TableHead>
                    <TableHead>Date & Time</TableHead>
                    <TableHead className="text-right">Retry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-8">
                        <CheckCircle2 size={16} className="inline mr-1.5 text-emerald-500" />
                        No GL posting failures — everything's posted.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row) => (
                      <TableRow key={row.LogId} className="text-xs">
                        <TableCell className="font-mono text-[11px]">{row.Module}</TableCell>
                        <TableCell className="font-mono text-[11px]">#{row.RecordId}</TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${OUTCOME_STYLE[row.Outcome] || ""}`}>{row.Outcome}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[320px]">
                          <span className="text-muted-foreground break-words">{row.Reason || "—"}</span>
                        </TableCell>
                        <TableCell>{row.ApproverEmail || "—"}</TableCell>
                        <TableCell className="text-[11px] whitespace-nowrap">{fmtDateTime(row.CreatedAt)}</TableCell>
                        <TableCell className="text-right">
                          {row.Outcome !== "posted" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[11px] gap-1 px-2"
                              disabled={retryingId === row.LogId}
                              onClick={() => retryMutation.mutate(row.LogId)}
                            >
                              <RefreshCw size={11} className={retryingId === row.LogId ? "animate-spin" : ""} />
                              Retry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </DbaShell>
    </div>
  );
}
