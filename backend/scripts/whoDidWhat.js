// Who created, edited and approved what — for every user.
//
// Two sources, side by side:
//   1. The records themselves: every table with a "created by / updated by / approved by" column,
//      counted per person (with the latest date where the table has one). These columns hold a
//      user id, an email or a name depending on the table; each is matched back to dbo.users.
//   2. The activity log (dbo.UserActivityLog, what the Activity Browser shows): each person's
//      creates / updates / deletes / page views and when they were last seen.
// Then the names in those columns that match no user, and the rows that carry no name at all.
//
//   node scripts/whoDidWhat.js                       everyone
//   node scripts/whoDidWhat.js --user sanjit         one person (name, email or id; partial match)
//   node scripts/whoDidWhat.js --since 2026-10-01    only rows / activity from that date (where a date exists)
//   node scripts/whoDidWhat.js --csv > who.csv       one line per person x table x action, for a spreadsheet
// Read-only: it changes nothing.
const { connectDB, getPool, closeDB, sql } = require("../db");

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
};
const ONLY = (arg("--user") || "").toLowerCase();
const SINCE = arg("--since");
const CSV = process.argv.includes("--csv");

// Column names that say who did something, by action.
const ACTION_COLS = {
  created: ["CreatedBy", "created_by", "CreatedByUserId", "CreatedByEmail", "CreatedByName", "M_CreatedBy", "EnteredBy", "IssuedBy"],
  updated: ["UpdatedBy", "updated_by", "ModifiedBy", "modified_by", "LastModifiedBy", "UpdatedByUserId", "EditedBy"],
  approved: ["ApprovedBy", "approved_by", "M_ApprovedBy", "ApprovedByUserId"],
};
// The date that goes with each action, first match wins.
const DATE_COLS = {
  created: ["CreatedAt", "created_at", "CreatedDate", "created_datetime", "M_CreatedDate", "CreatedOn"],
  updated: ["UpdatedAt", "updated_at", "ModifiedAt", "ModifiedDate", "UpdatedDate", "LastModifiedAt"],
  approved: ["ApprovedAt", "approved_at", "ApprovedDate", "ApprovedOn"],
};

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "—");
const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

(async () => {
  await connectDB();
  const pool = getPool();

  // ── users ────────────────────────────────────────────────────────────────
  const users = (await pool.request().query(
    `SELECT u.id, u.name, u.email, r.RName AS role, ISNULL(u.discontinue, 0) AS discontinue
     FROM dbo.users u LEFT JOIN dbo.Role r ON r.RId = u.RoleId`,
  )).recordset;
  const byId = new Map(users.map((u) => [String(u.id), u]));
  const byEmail = new Map(users.map((u) => [String(u.email || "").toLowerCase(), u]));
  const byName = new Map(users.map((u) => [String(u.name || "").trim().toLowerCase(), u]));
  const match = (raw) => {
    const v = String(raw).trim();
    if (/^\d+$/.test(v)) return byId.get(v) || null;
    if (v.includes("@")) return byEmail.get(v.toLowerCase()) || null;
    return byName.get(v.toLowerCase()) || null;
  };

  // ── every table / column that records who ───────────────────────────────
  const allCols = Object.values(ACTION_COLS).flat().concat(Object.values(DATE_COLS).flat());
  const cols = (await pool.request().query(`
    SELECT s.name AS schemaName, t.name AS tableName, c.name AS colName
    FROM sys.columns c
    JOIN sys.tables t ON t.object_id = c.object_id
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE c.name IN (${allCols.map((n) => `'${n}'`).join(",")})
  `)).recordset;
  const tables = new Map();
  for (const r of cols) {
    const key = `${r.schemaName}.${r.tableName}`;
    if (!tables.has(key)) tables.set(key, new Set());
    tables.get(key).add(r.colName);
  }

  // per user id (or "?raw" for unmatched): table -> action -> { n, last }
  const tally = new Map();
  const unmatched = new Map(); // raw value -> [{ table, action, n }]
  const unattributed = []; // { table, action, n }
  const bump = (who, table, action, n, last) => {
    if (!tally.has(who)) tally.set(who, new Map());
    const t = tally.get(who);
    if (!t.has(table)) t.set(table, {});
    t.get(table)[action] = { n, last };
  };

  for (const [table, set] of tables) {
    for (const [action, names] of Object.entries(ACTION_COLS)) {
      const col = names.find((n) => set.has(n));
      if (!col) continue;
      const dateCol = DATE_COLS[action].find((n) => set.has(n)) || (action !== "created" ? null : null);
      const [s, t] = table.split(".");
      const ref = `[${s}].[${t}]`;
      const where = SINCE && dateCol ? `WHERE [${dateCol}] >= @since` : "";
      try {
        const req = pool.request();
        if (SINCE && dateCol) req.input("since", sql.DateTime2, new Date(SINCE));
        const rows = (await req.query(`
          SELECT CAST([${col}] AS NVARCHAR(255)) AS who, COUNT(*) AS n
                 ${dateCol ? `, MAX([${dateCol}]) AS last` : ", NULL AS last"}
          FROM ${ref} ${where}
          GROUP BY CAST([${col}] AS NVARCHAR(255))
        `)).recordset;
        for (const r of rows) {
          if (r.who == null || String(r.who).trim() === "") {
            unattributed.push({ table, action, n: r.n });
            continue;
          }
          const u = match(r.who);
          if (u) bump(String(u.id), table, action, r.n, r.last);
          else {
            if (!unmatched.has(r.who)) unmatched.set(r.who, []);
            unmatched.get(r.who).push({ table, action, n: r.n });
          }
        }
      } catch (e) {
        if (!CSV) console.error(`  (skipped ${table}.${col}: ${e.message})`);
      }
    }
  }

  // ── activity log ─────────────────────────────────────────────────────────
  const activity = new Map();
  try {
    const req = pool.request();
    if (SINCE) req.input("since", sql.DateTime2, new Date(SINCE));
    const rows = (await req.query(`
      SELECT UserId, LOWER(ISNULL(ActionType, EventType)) AS kind, COUNT(*) AS n, MAX(CreatedAt) AS last
      FROM dbo.UserActivityLog ${SINCE ? "WHERE CreatedAt >= @since" : ""}
      GROUP BY UserId, LOWER(ISNULL(ActionType, EventType))
    `)).recordset;
    for (const r of rows) {
      const k = String(r.UserId);
      if (!activity.has(k)) activity.set(k, { last: null, kinds: {} });
      const a = activity.get(k);
      a.kinds[r.kind || "other"] = r.n;
      if (!a.last || r.last > a.last) a.last = r.last;
    }
  } catch (e) {
    if (!CSV) console.error(`  (activity log not read: ${e.message})`);
  }

  // ── report ───────────────────────────────────────────────────────────────
  const picked = users
    .filter((u) => !ONLY || [u.name, u.email, String(u.id)].some((v) => String(v || "").toLowerCase().includes(ONLY)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  if (CSV) {
    console.log(["user_id", "name", "email", "role", "source", "table", "action", "count", "last"].join(","));
    for (const u of picked) {
      for (const [table, acts] of tally.get(String(u.id)) || []) {
        for (const [action, v] of Object.entries(acts)) {
          console.log([u.id, u.name, u.email, u.role, "records", table, action, v.n, fmtDate(v.last)].map(csvCell).join(","));
        }
      }
      const a = activity.get(String(u.id));
      if (a) for (const [kind, n] of Object.entries(a.kinds)) {
        console.log([u.id, u.name, u.email, u.role, "activity log", "", kind, n, fmtDate(a.last)].map(csvCell).join(","));
      }
    }
    await closeDB?.();
    process.exit(0);
  }

  console.log(`WHO DID WHAT${SINCE ? ` since ${SINCE}` : ""}   (${tables.size} tables record a person; ${users.length} users)\n`);
  for (const u of picked) {
    const t = tally.get(String(u.id));
    const a = activity.get(String(u.id));
    const totals = { created: 0, updated: 0, approved: 0 };
    for (const acts of (t || new Map()).values()) for (const [k, v] of Object.entries(acts)) totals[k] += v.n;
    console.log("=".repeat(78));
    console.log(`${u.name}  <${u.email}>  #${u.id}  ${u.role || "no role"}${u.discontinue ? "  [DISCONTINUED]" : ""}`);
    console.log(`  records: ${totals.created} created · ${totals.updated} last edited · ${totals.approved} approved`);
    if (a) {
      const k = a.kinds;
      console.log(`  activity log: ${k.create || 0} creates · ${k.update || 0} updates · ${k.delete || 0} deletes · ${k.read || 0} pages opened · last seen ${fmtDate(a.last)}`);
    } else console.log("  activity log: nothing recorded");
    if (t && t.size) {
      const rows = [...t.entries()].sort((x, y) => {
        const n = (v) => Object.values(v).reduce((s, z) => s + z.n, 0);
        return n(y[1]) - n(x[1]);
      });
      for (const [table, acts] of rows) {
        const parts = Object.entries(acts).map(([k, v]) => `${k} ${v.n}${v.last ? ` (last ${fmtDate(v.last)})` : ""}`);
        console.log(`    ${table.replace(/^dbo\./, "").padEnd(34)} ${parts.join(" · ")}`);
      }
    }
  }

  if (!ONLY) {
    console.log("\n" + "=".repeat(78));
    console.log("NAMES IN THE RECORDS THAT MATCH NO USER (deleted users, typed names, system jobs)");
    if (!unmatched.size) console.log("  none");
    for (const [raw, list] of [...unmatched.entries()].sort((x, y) => y[1].reduce((s, z) => s + z.n, 0) - x[1].reduce((s, z) => s + z.n, 0))) {
      const total = list.reduce((s, z) => s + z.n, 0);
      console.log(`  "${raw}"  ${total} rows: ${list.slice(0, 6).map((z) => `${z.table.replace(/^dbo\./, "")} ${z.action} ${z.n}`).join(", ")}${list.length > 6 ? ", …" : ""}`);
    }
    console.log("\nROWS WITH NO NAME RECORDED");
    const blank = unattributed.filter((z) => z.action === "created").sort((x, y) => y.n - x.n);
    if (!blank.length) console.log("  none");
    for (const z of blank.slice(0, 40)) console.log(`  ${z.table.replace(/^dbo\./, "").padEnd(34)} ${z.n} rows with no creator`);
    if (blank.length > 40) console.log(`  … and ${blank.length - 40} more tables`);
  }

  await closeDB?.();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
