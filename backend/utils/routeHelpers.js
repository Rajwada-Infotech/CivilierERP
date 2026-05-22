function requireValidId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
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
