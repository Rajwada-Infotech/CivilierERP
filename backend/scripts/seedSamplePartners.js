// One-off dev seed — creates a few sample Partners via the exact same
// insert logic as backend/routes/partnerMaster.js's POST handler (Capital
// + Current Account heads, transactional, DisplayName-disambiguated).
// Safe to re-run — skips any base code that already exists.
const { getPool, sql, connectDB } = require("../db");

const SAMPLE_PARTNERS = [
  { code: "PTR-001", name: "Rajesh Sharma" },
  { code: "PTR-002", name: "Priya Verma" },
  { code: "PTR-003", name: "Amit Kumar" },
];

const CAP_SUFFIX = "-CAP";
const CUR_SUFFIX = "-CUR";

async function getPartnerGroups(pool) {
  const result = await pool.request().query(`
    SELECT AGId AS id, Name AS label, Code AS code FROM dbo.AccountGroup
    WHERE Code IN ('CAPA0', 'CURAC')
  `);
  const capital = result.recordset.find((g) => g.code === "CAPA0");
  const current = result.recordset.find((g) => g.code === "CURAC");
  if (!capital || !current) throw new Error("Capital/Current Account groups not found — run migration 419 first.");
  return { capital, current };
}

(async () => {
  await connectDB();
  const pool = getPool();
  const groups = await getPartnerGroups(pool);

  for (const { code, name } of SAMPLE_PARTNERS) {
    const existing = await pool.request().input("c", sql.NVarChar(20), `${code}${CAP_SUFFIX}`).query(`
      SELECT LHeadId FROM dbo.AccountHeadMaster WHERE LHeadCode = @c
    `);
    if (existing.recordset.length) {
      console.log(`Skipping ${code} (${name}) — already exists`);
      continue;
    }

    const tx = new sql.Transaction(pool);
    await tx.begin();
    const insertHead = async (headCode, groupId, displayName) => {
      const r = await new sql.Request(tx)
        .input("LHeadName", sql.NVarChar(200), name)
        .input("DisplayName", sql.NVarChar(200), displayName)
        .input("LHeadType", sql.VarChar(50), "P")
        .input("LHeadCode", sql.NVarChar(20), headCode)
        .input("LHeadAddress", sql.NVarChar(300), "N/A")
        .input("LHeadContactPerson", sql.NVarChar(100), "N/A")
        .input("LHeadStatus", sql.Bit, 1)
        .input("LHeadPaymentTerms", sql.NVarChar(100), "N/A")
        .input("LHeadCreditLimit", sql.Decimal(18, 2), 0)
        .input("LBelongsTo", sql.Int, groupId)
        .input("CreatedBy", sql.NVarChar(100), "seed-script")
        .input("CreatedAt", sql.DateTime2, new Date()).query(`
          INSERT INTO dbo.AccountHeadMaster (
            LHeadName, DisplayName, LHeadType, LHeadCode, LHeadAddress, LHeadContactPerson,
            LHeadStatus, LHeadPaymentTerms, LHeadCreditLimit, LBelongsTo, CreatedBy, CreatedAt
          )
          OUTPUT INSERTED.LHeadId AS id
          VALUES (@LHeadName, @DisplayName, @LHeadType, @LHeadCode, @LHeadAddress, @LHeadContactPerson,
                  @LHeadStatus, @LHeadPaymentTerms, @LHeadCreditLimit, @LBelongsTo, @CreatedBy, @CreatedAt)
        `);
      return r.recordset[0].id;
    };

    const capId = await insertHead(`${code}${CAP_SUFFIX}`, groups.capital.id, `${name} (Capital Account)`);
    const curId = await insertHead(`${code}${CUR_SUFFIX}`, groups.current.id, `${name} (Current Account)`);
    await tx.commit();
    console.log(`Seeded ${code} — ${name} (capitalHeadId=${capId}, currentHeadId=${curId})`);
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
