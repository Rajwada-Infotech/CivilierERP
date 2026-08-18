// A parent task's effective progress must reflect its children's ALREADY
// rolled-up progress, not just their raw stored Progress column — a
// grandchild's completion has to propagate up through every ancestor. A
// single SQL query can't express that cleanly for a self-referencing tree
// of unbounded depth, so it's computed here: one lightweight query for the
// whole (non-deleted) task tree's {Id, ParentTaskId, Progress}, then a
// bottom-up, memoized recursive rollup in JS.
async function computeProgressMap(pool) {
  const all = await pool.request().query(`
    SELECT Id, ParentTaskId, Progress FROM dbo.TaskMaster WHERE IsDeleted = 0
  `);

  const byId = new Map();
  const childrenOf = new Map();
  for (const row of all.recordset) {
    byId.set(row.Id, row);
    if (row.ParentTaskId != null) {
      if (!childrenOf.has(row.ParentTaskId)) childrenOf.set(row.ParentTaskId, []);
      childrenOf.get(row.ParentTaskId).push(row.Id);
    }
  }

  const memo = new Map();
  function effective(id, visiting) {
    if (memo.has(id)) return memo.get(id);
    // Guards against a cyclic ParentTaskId chain (shouldn't exist, but a
    // stack overflow here would take the whole request down with it).
    if (visiting.has(id)) return byId.get(id)?.Progress ?? 0;
    visiting.add(id);

    const kids = childrenOf.get(id);
    const value = !kids || kids.length === 0
      ? (byId.get(id)?.Progress ?? 0)
      : Math.round(kids.reduce((sum, kidId) => sum + effective(kidId, visiting), 0) / kids.length);

    visiting.delete(id);
    memo.set(id, value);
    return value;
  }

  const result = new Map();
  for (const id of byId.keys()) {
    result.set(id, {
      EffectiveProgress: effective(id, new Set()),
      HasChildren: (childrenOf.get(id)?.length ?? 0) > 0,
    });
  }
  return result;
}

module.exports = { computeProgressMap };
