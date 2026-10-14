// Per approval: may the person who raised a request also approve it.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { Switch } from "@/components/ui/switch";
import { MODULE_OPTIONS, APPROVAL_API } from "./config";

// ─── Raiser may approve their own request (migration 571) ─────────────────────
// Per approval: may the person who raised a request also approve it? Off
// means someone else has to (maker-checker). Rejecting one's own is always
// allowed.
export type RaiserRule = { module: string; label?: string | null; raiserMayApprove: boolean; updatedBy: string | null; updatedAt: string | null };

export function RaiserRules({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data: rules = [] } = useQuery<RaiserRule[]>({
    queryKey: ["approval-raiser-rules"],
    queryFn: async () => {
      const res = await fetchWithAuth(`${APPROVAL_API}/raiser-rules`);
      if (!res.ok) throw new Error("Could not load the setting");
      return res.json();
    },
  });
  const nameOf = (m: string) => MODULE_OPTIONS.find((o) => o.id === m) as { label: string; desc?: string } | undefined;
  const save = async (module: string, raiserMayApprove: boolean) => {
    setBusy(module);
    try {
      const res = await fetchWithAuth(`${APPROVAL_API}/raiser-rules/${encodeURIComponent(module)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ raiserMayApprove }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Could not save the setting");
      toast.success(raiserMayApprove ? "The raiser may now approve their own request" : "Someone else now has to approve");
      qc.invalidateQueries({ queryKey: ["approval-raiser-rules"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };
  if (!rules.length) return null;
  return (
    <div className="border border-foreground bg-card">
      <div className="px-4 py-3 border-b border-foreground">
        <h3 className="font-heading text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-foreground">Who may approve their own request</h3>
        <p className="text-xs text-muted-foreground mt-1">On: whoever raised the request may approve it. Off: someone else has to. Rejecting one's own is always allowed.</p>
      </div>
      <ul className="divide-y divide-foreground/15">
        {rules.map((r) => {
          const n = nameOf(r.module);
          return (
            <li key={r.module} className="px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground">{n?.label || r.label || r.module}</div>
                <div className="text-[0.6875rem] text-muted-foreground">
                  {r.raiserMayApprove ? "The raiser may approve it" : "Someone else has to approve it"}
                  {r.updatedBy ? ` · set by ${r.updatedBy}` : ""}
                </div>
              </div>
              <Switch
                checked={r.raiserMayApprove}
                disabled={!canEdit || busy === r.module}
                onCheckedChange={(v) => save(r.module, v)}
                aria-label={`${n?.label || r.label || r.module}: raiser may approve`}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
