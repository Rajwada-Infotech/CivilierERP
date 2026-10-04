/**
 * docFinder.js — resolves a typed document number (SU-2026-00011,
 * GC-WO/0001/26-27, ExB-PO-GRN-2026-00008, a bare "00011", ...) to the records
 * it belongs to, for the Alt+Shift+D "Find a document" dialog.
 *
 * Two lookup tiers, run together and merged:
 *   1. dbo.DocNumberSequence — every number issued by lockNextDocNumber() is
 *      logged there with its TableName and (after backPatchRecordId) RecordId.
 *      That is already a doc-no -> table -> id index, so no new registry table
 *      is needed; DocNo is unique-indexed (UQ_DocNumberSequence_DocNo).
 *   2. A direct match on the doc-no column of each registered table — covers
 *      tables/rows that never reached DocNumberSequence (RecordId NULL, or a
 *      module that numbers outside lockNextDocNumber).
 *
 * DOC_FINDER_REGISTRY only holds what DocNumberSequence cannot know: how to
 * preview a row and which frontend page + page right opens it. Add one module
 * at a time, and add the matching `?view=<id>` handler to its list page.
 *
 * Permissions are applied BEFORE querying (a table the user cannot view is
 * never searched, so not even its existence leaks) and Project Access scoping
 * is applied to every query.
 */
"use strict";

const { sql } = require("../db");
const { projectPredicate, paymentProjectSql } = require("./projectScope");
const { normalizeRole } = require("../middleware/role");
const {
  SUPERUSER_ROLES,
  getEffectivePagePermissions,
} = require("../middleware/permissions");

// key = TableName exactly as stored in DocNumberSequence.TableName
const DOC_FINDER_REGISTRY = {
  StockUpdate: {
    label: "Stock Update",
    table: "dbo.StockUpdate",
    idCol: "StockUpdateId",
    docNoCols: ["DocNo"],
    dateCol: "UpdateDate",
    amountExpr: null,
    statusCol: null,
    subtitleCol: "Remarks",
    projectExpr: "t.ProjectId",
    route: "/material/stock-update",
    pageKey: "stock-update",
  },
  NewPayment: {
    label: "Payment",
    table: "dbo.NewPayment",
    idCol: "PPaymentID",
    docNoCols: ["DocNo"],
    dateCol: "PDate",
    amountExpr: "t.PAmount",
    statusCol: "Status",
    subtitleCol: "PPaymentName",
    projectExpr: paymentProjectSql("t"),
    route: "/payments",
    pageKey: "new-payment",
  },
  ReceivedPayment: {
    label: "Received Payment",
    table: "dbo.ReceivedPayment",
    idCol: "RPPaymentID",
    docNoCols: ["RPDocNo"],
    dateCol: "RPDocDate",
    amountExpr: "t.RPAmount",
    statusCol: "RPStatus",
    subtitleCol: "RPCustomerName",
    projectExpr: "t.RPProjectId",
    route: "/received-payments",
    pageKey: "received-payment",
  },
  JournalVoucher: {
    label: "Journal Voucher",
    table: "dbo.JournalVoucher",
    idCol: "JVID",
    docNoCols: ["JVNo"],
    dateCol: "JVDate",
    amountExpr: "(SELECT SUM(l.DebitAmount) FROM dbo.JournalVoucherLines l WHERE l.JVID = t.JVID)",
    statusCol: "Status",
    subtitleCol: "Narration",
    projectExpr: "t.ProjectId",
    route: "/journal-voucher",
    pageKey: "journal-voucher",
  },
  GoodsReceiptNotes: {
    label: "GRN",
    table: "dbo.GoodsReceiptNotes",
    idCol: "GRNID",
    docNoCols: ["GRNNo", "DocNo"],
    dateCol: "GRNDate",
    amountExpr: "t.TotalAmount",
    statusCol: "Status",
    subtitleCol: "Remarks",
    // GRN has no project of its own — it comes from the originating PO.
    projectExpr: "(SELECT po.ProjectId FROM dbo.PurchaseOrders po WHERE po.PurchaseOrderID = t.POID)",
    route: "/material/grn",
    pageKey: "grn-master",
  },
  PurchaseOrders: {
    label: "Purchase Order",
    table: "dbo.PurchaseOrders",
    idCol: "PurchaseOrderID",
    docNoCols: ["PurchaseOrderNo", "DocNo"],
    dateCol: "PODate",
    amountExpr: "t.TotalAmount",
    statusCol: "Status",
    subtitleCol: "Remarks",
    projectExpr: "t.ProjectId",
    route: "/material/purchase-order",
    pageKey: "purchase-orders",
  },
};

const MIN_QUERY_LEN = 3;
const MAX_QUERY_LEN = 60;
const MAX_RESULTS = 20;
const PER_TABLE_LIMIT = 8;

/** Trim, collapse inner whitespace, cap length. */
function normalizeQuery(raw) {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LEN);
}

/** Escape LIKE wildcards so "_" / "%" / "[" in a doc number match literally. */
function escapeLike(s) {
  return s.replace(/[\\%_[]/g, (c) => `\\${c}`);
}

/** Registered table names the caller may open (view right on the page). */
async function allowedTables(user) {
  const role = normalizeRole(user?.role);
  const all = Object.keys(DOC_FINDER_REGISTRY);
  if (SUPERUSER_ROLES.has(role)) return all;
  const userId = user?.userId ?? user?.id;
  const effective = await getEffectivePagePermissions(userId, user?.roleId);
  const viewable = new Set(
    effective
      .filter((p) => (p.actions || []).includes("view"))
      .map((p) => String(p.page).toLowerCase()),
  );
  return all.filter((t) => viewable.has(DOC_FINDER_REGISTRY[t].pageKey.toLowerCase()));
}

function previewSelect(entry) {
  const docNoExpr = `COALESCE(${entry.docNoCols.map((c) => `NULLIF(t.${c}, '')`).join(", ")})`;
  return `
    t.${entry.idCol} AS Id,
    ${docNoExpr} AS DocNo,
    t.${entry.dateCol} AS DocDate,
    ${entry.amountExpr ?? "NULL"} AS Amount,
    ${entry.statusCol ? `t.${entry.statusCol}` : "NULL"} AS Status,
    ${entry.subtitleCol ? `LEFT(CAST(t.${entry.subtitleCol} AS NVARCHAR(200)), 120)` : "NULL"} AS Subtitle`;
}

function toResult(tableName, row, q) {
  const entry = DOC_FINDER_REGISTRY[tableName];
  const docNo = row.DocNo ?? "";
  return {
    table: tableName,
    type: entry.label,
    id: row.Id,
    docNo,
    date: row.DocDate ?? null,
    amount: row.Amount ?? null,
    status: row.Status ?? null,
    subtitle: row.Subtitle ?? null,
    route: entry.route,
    pageKey: entry.pageKey,
    url: `${entry.route}?view=${row.Id}`,
    exact: String(docNo).toLowerCase() === q.toLowerCase(),
  };
}

/** Tier 1: ask DocNumberSequence which (table, id) these numbers belong to. */
async function lookupViaSequence(pool, q, tables, scope) {
  if (!tables.length) return [];
  const req = pool.request();
  req.input("exact", sql.NVarChar(100), q);
  req.input("like", sql.NVarChar(130), `%${escapeLike(q)}%`);
  req.input("prefix", sql.NVarChar(130), `${escapeLike(q)}%`);
  const names = tables.map((t, i) => {
    req.input(`t${i}`, sql.NVarChar(100), t);
    return `@t${i}`;
  });
  const hits = (
    await req.query(`
      SELECT TOP 40 DocNo, TableName, RecordId,
        CASE WHEN DocNo = @exact THEN 0 WHEN DocNo LIKE @prefix ESCAPE '\\' THEN 1 ELSE 2 END AS Rnk
      FROM dbo.DocNumberSequence
      WHERE RecordId IS NOT NULL
        AND TableName IN (${names.join(",")})
        AND (DocNo = @exact OR DocNo LIKE @like ESCAPE '\\')
      ORDER BY Rnk, DocNo
    `)
  ).recordset;
  if (!hits.length) return [];

  const idsByTable = new Map();
  for (const h of hits) {
    if (!idsByTable.has(h.TableName)) idsByTable.set(h.TableName, []);
    idsByTable.get(h.TableName).push(Number(h.RecordId));
  }
  return fetchPreviews(pool, idsByTable, q, scope);
}

/** Fetch preview rows for known ids (scoped), one query per table. */
async function fetchPreviews(pool, idsByTable, q, scope = null) {
  const out = [];
  await Promise.all(
    [...idsByTable].map(async ([tableName, ids]) => {
      const entry = DOC_FINDER_REGISTRY[tableName];
      if (!entry) return;
      const safeIds = [...new Set(ids)].filter(Number.isInteger);
      if (!safeIds.length) return;
      const rows = (
        await pool.request().query(`
          SELECT ${previewSelect(entry)}
          FROM ${entry.table} t
          WHERE t.${entry.idCol} IN (${safeIds.join(",")})
          ${projectPredicate(scope, entry.projectExpr)}
        `)
      ).recordset;
      for (const r of rows) out.push(toResult(tableName, r, q));
    }),
  );
  return out;
}

/** Tier 2: match the doc-no column(s) of each registered table directly. */
async function lookupDirect(pool, q, tables, scope) {
  const like = `%${escapeLike(q)}%`;
  const out = [];
  await Promise.all(
    tables.map(async (tableName) => {
      const entry = DOC_FINDER_REGISTRY[tableName];
      const req = pool.request();
      req.input("exact", sql.NVarChar(100), q);
      req.input("like", sql.NVarChar(130), like);
      const match = entry.docNoCols
        .map((c) => `t.${c} = @exact OR t.${c} LIKE @like ESCAPE '\\'`)
        .join(" OR ");
      const rows = (
        await req.query(`
          SELECT TOP ${PER_TABLE_LIMIT} ${previewSelect(entry)}
          FROM ${entry.table} t
          WHERE (${match})
          ${projectPredicate(scope, entry.projectExpr)}
          ORDER BY t.${entry.dateCol} DESC
        `)
      ).recordset;
      for (const r of rows) out.push(toResult(tableName, r, q));
    }),
  );
  return out;
}

/**
 * @param {object} pool
 * @param {{ q: string, user: object, scope: number[]|null }} args
 */
async function findDocuments(pool, { q: rawQ, user, scope }) {
  const q = normalizeQuery(rawQ);
  if (q.length < MIN_QUERY_LEN) return { query: q, tooShort: true, results: [] };

  const tables = await allowedTables(user);
  if (!tables.length) return { query: q, tooShort: false, results: [] };

  const [viaSeq, direct] = await Promise.all([
    lookupViaSequence(pool, q, tables, scope),
    lookupDirect(pool, q, tables, scope),
  ]);

  const seen = new Set();
  const merged = [];
  for (const r of [...viaSeq, ...direct]) {
    const key = `${r.table}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  const rank = (r) => {
    const d = r.docNo.toLowerCase();
    const lq = q.toLowerCase();
    return d === lq ? 0 : d.startsWith(lq) ? 1 : 2;
  };
  merged.sort((a, b) => rank(a) - rank(b) || String(b.date ?? "").localeCompare(String(a.date ?? "")));
  return { query: q, tooShort: false, results: merged.slice(0, MAX_RESULTS) };
}

module.exports = {
  DOC_FINDER_REGISTRY,
  findDocuments,
  normalizeQuery,
  escapeLike,
  allowedTables,
};
