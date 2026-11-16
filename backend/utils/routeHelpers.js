function requireValidId(req, res) {
  const id = Number(req.params.id);
  // A real database row can legitimately be Id = 0 after a historical manual
  // identity reseed. Requiring `id > 0` makes those rows vanish from every route
  // that uses this helper, even though the row exists and is valid.
  if (!Number.isInteger(id) || id < 0) {
    res.status(400).json({ error: "Invalid id" });
    return null;
  }
  return id;
}

function checkRowsAffected(result, res, entity = "Record") {
  if (result.rowsAffected?.[0] === 0) {
    res.status(404).json({ error: `${entity} not found` });
    return false;
  }
  return true;
}

// Number-aware ordering for names: "Block 2" before "Block 10", "GC/1/2A" before "GC/1/10A". SQL ORDER BY on a name
// column sorts as text (1, 10, 2), so name lists are put in order here instead.
const naturalCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const naturalCompare = (a, b) => naturalCollator.compare(String(a ?? ""), String(b ?? ""));
// Sort rows by several keys in turn; a key is a column name or a function of the row. Numbers compare as numbers.
function sortNatural(rows, ...keys) {
  const val = (row, k) => (typeof k === "function" ? k(row) : row[k]);
  return rows.sort((a, b) => {
    for (const k of keys) {
      const x = val(a, k); const y = val(b, k);
      const c = typeof x === "number" && typeof y === "number" ? x - y : naturalCompare(x, y);
      if (c) return c;
    }
    return 0;
  });
}

module.exports = { requireValidId, checkRowsAffected, naturalCompare, sortNatural };
