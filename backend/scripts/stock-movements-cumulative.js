// Read-only: one item's stock movements per godown, oldest first, with In / Out and the running In, Out and balance.
//   ITEM=<name or part of it> (required)   GODOWN=<name or part of it> (optional)
const { connectDB, getPool, sql } = require("../db");

(async () => {
  await connectDB();
  const pool = getPool();
  const item = process.env.ITEM;
  const godown = process.env.GODOWN || "";
  if (!item) throw new Error("Set ITEM=<item name>");

  const cols = (await pool.request().query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'StockLedger'",
  )).recordset.map((r) => r.COLUMN_NAME);
  const dateExpr = cols.includes("CreatedDate") && cols.includes("EntryDate")
    ? "COALESCE(sl.CreatedDate, sl.EntryDate)"
    : cols.includes("CreatedDate") ? "sl.CreatedDate" : "sl.EntryDate";

  const r = await pool.request()
    .input("item", sql.NVarChar(200), `%${item}%`)
    .input("godown", sql.NVarChar(200), `%${godown}%`)
    .query(`
      SELECT img.M_Name AS ItemName, g.GodownName, sl.StockID, sl.Type, sl.RefType, sl.DocNo, sl.RefID, sl.Qty, sl.UOM,
             ${dateExpr} AS MovementDate
      FROM dbo.StockLedger sl
      JOIN dbo.Item_Master_Group img ON CONVERT(NVARCHAR(50), img.M_Id) = CONVERT(NVARCHAR(50), sl.ItemID)
      LEFT JOIN dbo.Godowns g ON g.GodownID = sl.GodownID
      WHERE img.M_Name LIKE @item AND ISNULL(g.GodownName, '') LIKE @godown
      ORDER BY img.M_Name, g.GodownName, MovementDate, sl.StockID`);

  if (!r.recordset.length) { console.log("No movements found."); process.exit(0); }

  const groups = new Map();
  for (const row of r.recordset) {
    const key = `${row.ItemName}  |  ${row.GodownName || "(no godown)"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const n = (v) => (Math.round(v * 1000) / 1000).toString();
  const pad = (s, w) => String(s).padEnd(w);
  const lpad = (s, w) => String(s).padStart(w);

  for (const [key, rows] of groups) {
    console.log(`\n=== ${key}  (${rows.length} movements, UOM ${rows[0].UOM || "-"}) ===`);
    console.log(`${pad("Date", 11)} ${pad("Document", 18)} ${pad("Ref", 7)} ${lpad("In", 9)} ${lpad("Out", 9)} ${lpad("Cum In", 10)} ${lpad("Cum Out", 10)} ${lpad("Balance", 10)}`);
    let cin = 0, cout = 0;
    for (const m of rows) {
      const q = Number(m.Qty || 0);
      const isIn = m.Type === "IN";
      if (isIn) cin += q; else cout += q;
      const d = m.MovementDate ? new Date(m.MovementDate).toISOString().slice(0, 10) : "-";
      console.log(`${pad(d, 11)} ${pad(m.DocNo || "#" + m.RefID, 18)} ${pad(m.RefType || "", 7)} ${lpad(isIn ? n(q) : "", 9)} ${lpad(isIn ? "" : n(q), 9)} ${lpad(n(cin), 10)} ${lpad(n(cout), 10)} ${lpad(n(cin - cout), 10)}`);
    }
    console.log(`TOTAL  in ${n(cin)}   out ${n(cout)}   balance ${n(cin - cout)}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
