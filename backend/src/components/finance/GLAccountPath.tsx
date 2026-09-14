import React, { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { ChevronRight, FolderTree, BookOpen } from "lucide-react";

interface AccountGroupRow {
  AGId: number;
  Name: string;
  ParentGroupId: number | null;
}

/**
 * Shows the full nested chart-of-accounts tree above a booked GL Account —
 * Root Group › ... › Immediate Group › GL Account — by walking the Account
 * Group master's parent chain client-side (arbitrary depth), rather than the
 * flat 2-level join the invoice list/detail API returns.
 */
export const GLAccountPath: React.FC<{
  glAccountName: string | null | undefined;
  glAccountGroupId: number | null | undefined;
}> = ({ glAccountName, glAccountGroupId }) => {
  const [groups, setGroups] = useState<AccountGroupRow[] | null>(null);

  useEffect(() => {
    if (!glAccountGroupId) return;
    fetchWithAuth("/api/account-group")
      .then((res) => res.json().catch(() => []))
      .then((data) => setGroups(Array.isArray(data) ? data : []))
      .catch(() => setGroups([]));
  }, [glAccountGroupId]);

  if (!glAccountName) return null;

  const chain: string[] = [];
  if (groups && glAccountGroupId) {
    const byId = new Map(groups.map((g) => [g.AGId, g]));
    let cursor: AccountGroupRow | undefined = byId.get(glAccountGroupId);
    const seen = new Set<number>();
    while (cursor && !seen.has(cursor.AGId)) {
      seen.add(cursor.AGId);
      chain.unshift(cursor.Name);
      cursor = cursor.ParentGroupId != null ? byId.get(cursor.ParentGroupId) : undefined;
    }
  }

  return (
    <div className="flex items-center gap-1 flex-wrap text-xs">
      <FolderTree size={11} className="text-amber-500 shrink-0" />
      {chain.map((name) => (
        <React.Fragment key={name}>
          <span className="text-muted-foreground">{name}</span>
          <ChevronRight size={10} className="text-muted-foreground/40 shrink-0" />
        </React.Fragment>
      ))}
      <BookOpen size={11} className="text-primary/70 shrink-0" />
      <span className="font-semibold text-foreground">{glAccountName}</span>
    </div>
  );
};
