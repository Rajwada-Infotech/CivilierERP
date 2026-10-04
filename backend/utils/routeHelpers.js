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

module.exports = { requireValidId, checkRowsAffected };
