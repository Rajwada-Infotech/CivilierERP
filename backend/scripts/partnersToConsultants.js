// Move named partners to Consultant-type vendors (Vendor Master). A partner = two heads (LHeadType 'P', codes
// <base>-CAP / <base>-CUR); a consultant vendor = one head (LHeadType 'V', LHeadCategory 'Consultant').
// Per partner: the head with the most postings (Current on a tie) becomes the vendor — same LHeadId, so its
// vouchers/payments now show the vendor — and the other head is deleted only if nothing uses it (if both are
// used, that partner is skipped and its usage shown). The partner's "Belongs to" partner becomes the vendor's
// Contact Person. Preview by default; APPLY=1 to change. NAMES="A|B|C" picks the partners; VENDOR_GROUP=<AGId>
// picks the account group (default: the one most existing vendors are under).
//   docker exec -i [-e APPLY=1] civiliererp-backend-1 node scripts/partnersToConsultants.js
require("../config/env").loadEnv();
const { connectDB, getPool, closeDB, sql } = require("../db");

const APPLY = process.env.APPLY === "1";
const NAMES = (process.env.NAMES || "Nishtha Kumari|Ipshita Bose|Juli Swaika").split("|").map((s) => s.trim()).filter(Boolean);

(async () => {
  await connectDB();
  const p = getPool();
  const q = async (s, f) => { const r = p.request(); if (f) f(r); return (await r.query(s)).recordset; };

  // Columns that can hold a head id (FK to AccountHeadMaster, or named like one) — to count each head's use.
  const cols = await q(`
    SELECT DISTINCT s.name AS sch, t.name AS tbl, c.name AS col
    FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    LEFT JOIN sys.foreign_key_columns fk ON fk.parent_object_id = c.object_id AND fk.parent_column_id = c.column_id
      AND fk.referenced_object_id = OBJECT_ID('dbo.AccountHeadMaster')
    WHERE ty.name IN ('int','bigint') AND t.name <> 'AccountHeadMaster' AND c.is_computed = 0
      AND (fk.parent_object_id IS NOT NULL OR c.name LIKE '%HeadId%' OR c.name LIKE '%LHead%' OR c.name LIKE '%Party%Id%')`);
  const usageOf = async (ids) => {
    const u = Object.fromEntries(ids.map((id) => [id, { total: 0, where: [] }]));
    for (const c of cols) {
      const rows = await q(`SELECT [${c.col}] AS id, COUNT(*) AS n FROM [${c.sch}].[${c.tbl}] WHERE [${c.col}] IN (${ids.join(",")}) GROUP BY [${c.col}]`);
      for (const r of rows) { u[r.id].total += r.n; u[r.id].where.push(`${c.tbl}.${c.col}: ${r.n}`); }
    }
    return u;
  };

  const group = parseInt(process.env.VENDOR_GROUP, 10) || (await q(`SELECT TOP 1 LBelongsTo AS g FROM dbo.AccountHeadMaster
    WHERE LHeadType = 'V' AND LBelongsTo IS NOT NULL GROUP BY LBelongsTo ORDER BY COUNT(*) DESC`))[0]?.g || null;
  const groupRow = group ? (await q(`SELECT AGId, Name FROM dbo.AccountGroup WHERE AGId = ${group}`))[0] : null;
  console.log("Vendor group:", groupRow ? `${groupRow.AGId} ${groupRow.Name}` : "(left as is)");

  const plans = [];
  for (const name of NAMES) {
    const heads = await q(`SELECT LHeadId, LHeadName, DisplayName, LHeadCode, LHeadType, LHeadCategory, PartnerBelongsToCode
      FROM dbo.AccountHeadMaster WHERE LTRIM(RTRIM(LHeadName)) = @N`, (r) => r.input("N", sql.NVarChar(200), name));
    const ptr = heads.filter((h) => h.LHeadType === "P");
    console.log(`\n== ${name}`); console.table(heads);
    if (!ptr.length) { console.log("No partner head with this exact name — skipped."); continue; }
    const bases = [...new Set(ptr.map((h) => String(h.LHeadCode || "").replace(/-(CAP|CUR)$/i, "")))];
    if (bases.length !== 1) { console.log("More than one partner with this name:", bases, "— skipped."); continue; }

    const usage = await usageOf(ptr.map((h) => h.LHeadId));
    console.table(ptr.map((h) => ({ LHeadId: h.LHeadId, LHeadCode: h.LHeadCode, uses: usage[h.LHeadId].total, where: usage[h.LHeadId].where.join(", ") || "-" })));
    const sorted = [...ptr].sort((a, b) => usage[b.LHeadId].total - usage[a.LHeadId].total || (/-CUR$/i.test(b.LHeadCode) ? 1 : 0) - (/-CUR$/i.test(a.LHeadCode) ? 1 : 0));
    const keep = sorted[0], drop = sorted.slice(1);
    if (drop.some((h) => usage[h.LHeadId].total > 0)) { console.log("Both heads are used — skipped. Tell me which one should become the vendor."); continue; }

    // "Belongs to" = another partner's base code -> that partner's name (it may since have become a vendor itself).
    const btCode = ptr.map((h) => h.PartnerBelongsToCode).find(Boolean) || null;
    const bt = btCode ? (await q(`SELECT TOP 1 LHeadName FROM dbo.AccountHeadMaster WHERE LHeadCode IN (@a, @b, @c)`,
      (r) => r.input("a", sql.NVarChar(20), `${btCode}-CUR`).input("b", sql.NVarChar(20), `${btCode}-CAP`).input("c", sql.NVarChar(20), btCode)))[0]?.LHeadName || null : null;
    // Other partners that name this one as their "Belongs to" — they'd point at a code that no longer is a partner.
    const dependants = await q(`SELECT DISTINCT LHeadName FROM dbo.AccountHeadMaster WHERE LHeadType = 'P' AND PartnerBelongsToCode = @c`, (r) => r.input("c", sql.NVarChar(20), bases[0]));
    const codeTaken = (await q(`SELECT 1 AS x FROM dbo.AccountHeadMaster WHERE LHeadCode = @C AND LHeadId <> @K`,
      (r) => r.input("C", sql.NVarChar(20), bases[0]).input("K", sql.Int, keep.LHeadId))).length > 0;
    const plan = { name, keep, drop, code: codeTaken ? keep.LHeadCode : bases[0], contact: bt || btCode };
    plans.push(plan);
    console.log("Plan:", {
      becomesConsultant: `${keep.LHeadId} ${keep.LHeadCode} -> code ${plan.code}, type V, category Consultant`,
      contactPerson: plan.contact ? `${plan.contact}${btCode && !bt ? " (code — no head found for it)" : ""}` : "(none — no Belongs to)",
      deleted: drop.map((h) => `${h.LHeadId} ${h.LHeadCode}`),
      ...(dependants.length ? { warning: `partners whose Belongs to is ${bases[0]}: ${dependants.map((d) => d.LHeadName).join(", ")}` } : {}),
    });
  }

  if (!APPLY) { console.log(`\nPreview only — ${plans.length} of ${NAMES.length} ready. APPLY=1 to move them.`); await closeDB(); process.exit(0); }

  for (const pl of plans) {
    const tx = p.transaction(); await tx.begin();
    try {
      await tx.request().input("K", sql.Int, pl.keep.LHeadId).input("C", sql.NVarChar(20), pl.code).input("G", sql.Int, group)
        .input("CP", sql.NVarChar(100), pl.contact ? String(pl.contact).slice(0, 100) : null)
        .query(`UPDATE dbo.AccountHeadMaster SET LHeadType = 'V', LHeadCategory = 'Consultant', LHeadCode = @C, DisplayName = NULL,
                  PartnerBelongsToCode = NULL, LHeadContactPerson = COALESCE(@CP, LHeadContactPerson), LBelongsTo = COALESCE(@G, LBelongsTo)
                WHERE LHeadId = @K AND LHeadType = 'P'`);
      for (const h of pl.drop) await tx.request().input("D", sql.Int, h.LHeadId).query(`DELETE FROM dbo.AccountHeadMaster WHERE LHeadId = @D AND LHeadType = 'P'`);
      await tx.commit();
      console.log(`Moved: ${pl.name}`);
    } catch (e) { await tx.rollback(); console.log(`Rolled back ${pl.name} — nothing changed for them:`, e.message); }
  }
  try { const r = require("../redis"); await r.bumpCacheVersion("account-head-master"); await r.bumpCacheVersion("partner-master"); } catch (_) { /* cache optional */ }
  console.table(await q(`SELECT LHeadId, LHeadName, LHeadCode, LHeadType, LHeadCategory, LHeadContactPerson, LBelongsTo FROM dbo.AccountHeadMaster
    WHERE LTRIM(RTRIM(LHeadName)) IN (${NAMES.map((_, i) => `@n${i}`).join(",")})`, (r) => NAMES.forEach((n, i) => r.input(`n${i}`, sql.NVarChar(200), n))));
  await closeDB(); process.exit(0);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
