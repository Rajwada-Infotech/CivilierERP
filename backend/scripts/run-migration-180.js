require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const { connectDB, getPool } = require("../db");
const fs = require("fs");
const path = require("path");

async function main() {
  await connectDB();
  const pool = getPool();
  const script = fs.readFileSync(
    path.resolve(__dirname, "../migrations/260709/180-newpayment-party-id.sql"),
    "utf8"
  );
  const batches = script.split(/^\s*GO\s*$/im).map(b => b.trim()).filter(Boolean);
  for (const batch of batches) {
    const r = await pool.request().query(batch);
    if (r?.recordsets?.[0]) console.log(r.recordsets[0]);
  }
  console.log("Migration 180 applied.");
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
