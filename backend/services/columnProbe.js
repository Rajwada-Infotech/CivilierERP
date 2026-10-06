// Asks the database whether a column exists yet, so code can ship before its migration is applied
// without breaking: a column that's there is remembered for good; one that isn't is re-checked
// after a minute, so applying the migration needs no restart.
const { sql } = require("../db");

function makeColumnProbe(table, column) {
  let found = false;
  let checkedMissingAt = 0;
  async function probe(pool) {
    if (found) return true;
    if (Date.now() - checkedMissingAt < 60_000) return false;
    const r = await pool
      .request()
      .input("t", sql.NVarChar(200), table)
      .input("c", sql.NVarChar(200), column)
      .query("SELECT COL_LENGTH(@t, @c) AS len");
    if (r.recordset[0]?.len != null) {
      found = true;
      return true;
    }
    checkedMissingAt = Date.now();
    return false;
  }
  probe.reset = () => {
    found = false;
    checkedMissingAt = 0;
  };
  return probe;
}

module.exports = { makeColumnProbe };
