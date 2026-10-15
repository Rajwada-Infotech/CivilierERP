// Fetch EVERY row of a server-paginated list.
//
// Most list routes page on the server and cap `limit` (10–500 depending on the route). A page that called one with no
// page/limit, or with a fixed `limit: 50`, silently showed only the newest 10 / 50 / 100 rows - and its search, status
// tabs and counts then worked on that slice only. Use this where a page needs the whole list on the client; use
// DataTable's `serverPagination` instead where the route can filter and page itself.
//
// `fetchPage(page, limit)` must return `{ data, total? }` (the shape every paginated route returns) or a plain array.
// Stops when `total` is reached, a short page comes back, or after `maxPages` (a safety stop, never hit in practice).
export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<{ data?: T[]; total?: number } | T[] | null | undefined>,
  { limit = 100, maxPages = 200 }: { limit?: number; maxPages?: number } = {},
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPage(page, limit);
    const rows: T[] = Array.isArray(res) ? res : (res?.data ?? []);
    const total = Array.isArray(res) ? undefined : res?.total;
    all.push(...rows);
    if (rows.length < limit) break;
    if (typeof total === "number" && all.length >= total) break;
  }
  return all;
}
