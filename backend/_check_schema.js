require("./config/env").loadEnv();
const { getPool, connectDB } = require("./db");

(async () => {
  try {
    await connectDB();
    const pool = getPool();
    const tables = ["CrmCoApplicant", "CrmCustomerBankDetail", "CrmExtraCharge", "CrmParkingAllotment", "CrmInventoryHold", "CrmApplication", "CrmPaymentPlan"];
    for (const t of tables) {
      const r = await pool.request().query(`SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`);
      console.log(`\n=== ${t} ===`);
      console.log(r.recordset.map(c => c.COLUMN_NAME).join(", "));
    }
    process.exit(0);
  } catch (e) { console.error(e.message); process.exit(1); }
})();
