// Opening one activity / chain of the Civil Work DPR from somewhere else (a report row) in one of the three pages
// that work on it. The activity ("rung") and its chain travel in the address, e.g.
//   /civilworkdpr/activity-reporting?rung=123&chain=45
// and each page opens it straight away when it sees them.

export interface ChainLinkTarget {
  label: string;
  /** The page right the person needs to see that page at all. */
  pageKey: string;
  path: string;
}

export const CHAIN_LINK_TARGETS: ChainLinkTarget[] = [
  { label: "Work Allocation", pageKey: "civilworkdpr-work-done", path: "/civilworkdpr/work-allocation" },
  { label: "Activity Reporting", pageKey: "civilworkdpr-activity-reporting", path: "/civilworkdpr/activity-reporting" },
  { label: "Work Transfer", pageKey: "civilworkdpr-work-transfer", path: "/civilworkdpr/work-transfer" },
];

const toId = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The pages this report row can be opened in (only those the person may open), with the link for each. */
export function chainLinksForRow(
  row: Record<string, unknown>,
  canAccessPage: (pageKey: string) => boolean,
): { label: string; to: string }[] {
  const rung = toId(row.rungId);
  if (rung == null) return [];
  const chain = toId(row.chainId);
  const query = `?rung=${rung}${chain != null ? `&chain=${chain}` : ""}`;
  return CHAIN_LINK_TARGETS.filter((t) => canAccessPage(t.pageKey)).map((t) => ({ label: t.label, to: `${t.path}${query}` }));
}

/** Reads ?rung= / ?chain= (whole numbers only) from a page's query string. */
export function readChainLink(search: URLSearchParams): { rungId: number | null; chainId: number | null } {
  return { rungId: toId(search.get("rung")), chainId: toId(search.get("chain")) };
}
