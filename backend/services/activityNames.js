// Turns the ids in Activity Browser lines into names when they are read: "Engineer Ids: 2095, 3119" becomes the
// engineers' names, "Labour Contractor Id: 8914" the contractor's. Done on read, so lines written before this
// existed read the same way. Only ids whose kind is plain from the field name are looked up; anything else, or an
// id that no longer exists, is left as it was.
const { getPool, sql } = require("../db");

const KINDS = [
  { kind: "user", test: /(user|engineer|approver|assignee|reviewer|qc|employee|staff)(user)?ids?$/, query: "SELECT id AS k, name AS v FROM dbo.users WHERE id IN" },
  { kind: "head", test: /(contractor|supplier|vendor|ledger|lhead|glhead|party)ids?$/, query: "SELECT LHeadId AS k, LHeadName AS v FROM dbo.AccountHeadMaster WHERE LHeadId IN" },
  { kind: "ent", test: /(company|project)ids?$/, query: "SELECT id AS k, name AS v FROM dbo.enterprise WHERE id IN" },
  { kind: "uom", test: /uomids?$/, query: "SELECT Id AS k, UOMName AS v FROM dbo.UOMMaster WHERE Id IN" },
];
const kindOf = (key) => KINDS.find((k) => k.test.test(String(key).replace(/[_\s]/g, "").toLowerCase()));
const isId = (v) => /^\d{1,10}$/.test(String(v));

const parse = (details) => {
  if (typeof details !== "string" || details[0] !== "{") return null;
  try {
    const d = JSON.parse(details);
    return d && d.v === 2 && d.fields && typeof d.fields === "object" ? d : null;
  } catch {
    return null;
  }
};

// Calls fn(kind, value, set) for every id-looking value under an id-named key, top level and one level into lines.
function walk(fields, fn) {
  const visit = (obj) => {
    for (const [key, val] of Object.entries(obj)) {
      const k = kindOf(key);
      if (Array.isArray(val)) {
        val.forEach((item, i) => {
          if (item && typeof item === "object") visit(item);
          else if (k && isId(item)) fn(k.kind, item, (name) => (val[i] = name));
        });
      } else if (val && typeof val === "object") {
        visit(val);
      } else if (k && isId(val)) {
        fn(k.kind, val, (name) => (obj[key] = name));
      }
    }
  };
  visit(fields);
}

// Lists and objects left empty ("Materials: []") say nothing; leave them out.
function dropEmpty(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if ((Array.isArray(val) && val.length === 0) || (val && typeof val === "object" && !Array.isArray(val) && Object.keys(val).length === 0)) {
      delete fields[key];
    }
  }
}

/** Rewrites each row's `details` in place (rows as the Activity Browser routes return them). Never throws. */
async function nameIds(rows) {
  try {
    const parsed = rows.map((r) => parse(r?.details));
    const wanted = new Map(KINDS.map((k) => [k.kind, new Set()]));
    for (const d of parsed) if (d) walk(d.fields, (kind, v) => wanted.get(kind).add(Number(v)));

    const names = new Map(); // "kind:id" -> name
    const pool = getPool();
    await Promise.all(
      KINDS.map(async (k) => {
        const ids = [...wanted.get(k.kind)].filter(Number.isFinite).slice(0, 2000);
        if (!ids.length) return;
        const req = pool.request();
        const params = ids.map((id, i) => {
          req.input(`p${i}`, sql.Int, id);
          return `@p${i}`;
        });
        try {
          const r = await req.query(`${k.query} (${params.join(",")})`);
          for (const row of r.recordset) if (row.v) names.set(`${k.kind}:${row.k}`, String(row.v).trim());
        } catch {
          /* a table this database doesn't have: those ids stay as they are */
        }
      }),
    );

    parsed.forEach((d, i) => {
      if (!d) return;
      walk(d.fields, (kind, v, set) => {
        const n = names.get(`${kind}:${Number(v)}`);
        if (n) set(n);
      });
      dropEmpty(d.fields);
      rows[i].details = JSON.stringify(d);
    });
  } catch (err) {
    console.warn("activityNames:", err.message);
  }
  return rows;
}

module.exports = { nameIds };
