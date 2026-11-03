"use strict";

/** Database side of the Script Console (migration 616). Script text, variables and output are encrypted before they are
 *  written (services/scriptVault.js) and decrypted only with the key of an open vault session. */

const { getPool, sql } = require("../db");
const vault = require("./scriptVault");

const MISSING = /Invalid object name/i;
function notReady(err) {
  if (MISSING.test(err?.message || "")) {
    const e = new Error("The Script Console needs migration 616 - run the database migrations (deploy) first.");
    e.status = 503;
    return e;
  }
  return err;
}
const guard = (fn) => async (...a) => {
  try { return await fn(...a); } catch (err) { throw notReady(err); }
};

// ── The key's verifier ─────────────────────────────────────────────────────────────────────────────────────────────
const getKeyRow = guard(async () => (await getPool().request().query("SELECT Salt, KeyHash, CreatedBy, CreatedAt, RotatedAt FROM dbo.ScriptConsoleKey WHERE Id = 1")).recordset[0] ?? null);

/** First key: fails (PK) if one already exists. */
const insertKeyRow = guard(async ({ salt, hash, by }) => {
  await getPool().request()
    .input("salt", sql.VarBinary(16), salt).input("hash", sql.VarBinary(32), hash).input("by", sql.NVarChar(200), by || null)
    .query("INSERT INTO dbo.ScriptConsoleKey (Id, Salt, KeyHash, CreatedBy) VALUES (1, @salt, @hash, @by)");
});

// ── Saved scripts ──────────────────────────────────────────────────────────────────────────────────────────────────
const libraryRow = (encKey, r) => ({
  id: r.Id, name: r.Name, description: r.Description ?? "",
  script: vault.decrypt(encKey, r.Script) ?? "",
  env: safeJson(vault.decrypt(encKey, r.Env)),
  updatedBy: r.UpdatedBy ?? r.CreatedBy, updatedAt: r.UpdatedAt ?? r.CreatedAt,
});
const safeJson = (t) => { try { const v = JSON.parse(t || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

const listLibrary = guard(async (encKey) =>
  (await getPool().request().query("SELECT Id, Name, Description, Script, Env, CreatedBy, CreatedAt, UpdatedBy, UpdatedAt FROM dbo.ScriptLibrary ORDER BY Name")).recordset.map((r) => libraryRow(encKey, r)));

const saveLibrary = guard(async (encKey, { id, name, description, script, env, by }) => {
  const req = getPool().request()
    .input("name", sql.NVarChar(200), name).input("desc", sql.NVarChar(500), description || null)
    .input("script", sql.NVarChar(sql.MAX), vault.encrypt(encKey, script))
    .input("env", sql.NVarChar(sql.MAX), vault.encrypt(encKey, JSON.stringify(env || [])))
    .input("by", sql.NVarChar(200), by || null);
  if (id) {
    const r = await req.input("id", sql.Int, id).query(`
      UPDATE dbo.ScriptLibrary SET Name = @name, Description = @desc, Script = @script, Env = @env, UpdatedBy = @by, UpdatedAt = SYSUTCDATETIME() WHERE Id = @id;
      SELECT @@ROWCOUNT AS n`);
    return r.recordset[0].n ? id : null;
  }
  const r = await req.query(`INSERT INTO dbo.ScriptLibrary (Name, Description, Script, Env, CreatedBy) OUTPUT INSERTED.Id VALUES (@name, @desc, @script, @env, @by)`);
  return r.recordset[0].Id;
});

const deleteLibrary = guard(async (id) => (await getPool().request().input("id", sql.Int, id).query("DELETE FROM dbo.ScriptLibrary WHERE Id = @id; SELECT @@ROWCOUNT AS n")).recordset[0].n > 0);

// ── Run history ────────────────────────────────────────────────────────────────────────────────────────────────────
const insertRun = guard(async (encKey, run) => {
  await getPool().request()
    .input("runId", sql.NVarChar(40), run.id).input("uid", sql.Int, run.user?.id ?? null).input("email", sql.NVarChar(200), run.user?.email ?? null)
    .input("name", sql.NVarChar(200), run.name).input("script", sql.NVarChar(sql.MAX), vault.encrypt(encKey, run.script))
    .input("env", sql.NVarChar(sql.MAX), vault.encrypt(encKey, JSON.stringify(Object.entries(run.env).map(([key, value]) => ({ key, value })))))
    .query("INSERT INTO dbo.ScriptRunLog (RunId, UserId, UserEmail, Name, Script, Env, Status) VALUES (@runId, @uid, @email, @name, @script, @env, N'running')");
});

const finishRun = guard(async (encKey, run, output) => {
  await getPool().request()
    .input("runId", sql.NVarChar(40), run.id).input("status", sql.NVarChar(20), run.status).input("exit", sql.Int, run.exitCode)
    .input("out", sql.NVarChar(sql.MAX), vault.encrypt(encKey, output))
    .query("UPDATE dbo.ScriptRunLog SET Status = @status, ExitCode = @exit, FinishedAt = SYSUTCDATETIME(), Output = @out WHERE RunId = @runId");
});

/** Runs that were going when the server stopped can never finish: mark them. */
const markInterrupted = guard(async (activeRunId) => {
  await getPool().request().input("active", sql.NVarChar(40), activeRunId || "")
    .query("UPDATE dbo.ScriptRunLog SET Status = N'interrupted', FinishedAt = SYSUTCDATETIME() WHERE Status = N'running' AND RunId <> @active");
});

const listRuns = guard(async (limit = 50) =>
  (await getPool().request().input("n", sql.Int, Math.min(Math.max(limit, 1), 200)).query(`
    SELECT TOP (@n) RunId, UserEmail, Name, Status, ExitCode, StartedAt, FinishedAt FROM dbo.ScriptRunLog ORDER BY StartedAt DESC, Id DESC`)).recordset);

const getRun = guard(async (encKey, runId) => {
  const r = (await getPool().request().input("id", sql.NVarChar(40), runId).query("SELECT RunId, UserEmail, Name, Script, Env, Status, ExitCode, StartedAt, FinishedAt, Output FROM dbo.ScriptRunLog WHERE RunId = @id")).recordset[0];
  if (!r) return null;
  return {
    runId: r.RunId, userEmail: r.UserEmail, name: r.Name, status: r.Status, exitCode: r.ExitCode, startedAt: r.StartedAt, finishedAt: r.FinishedAt,
    script: vault.decrypt(encKey, r.Script) ?? "", env: safeJson(vault.decrypt(encKey, r.Env)), output: vault.decrypt(encKey, r.Output) ?? "",
  };
});

// ── Rotating the key: everything is re-encrypted with the new key, with the new verifier, in one transaction ───────────
const rotateKey = guard(async (oldEnc, newEnc, { salt, hash }) => {
  const tx = new sql.Transaction(getPool());
  await tx.begin();
  try {
    const re = (blob) => (blob === null ? null : vault.encrypt(newEnc, vault.decrypt(oldEnc, blob) ?? ""));
    const lib = (await new sql.Request(tx).query("SELECT Id, Script, Env FROM dbo.ScriptLibrary")).recordset;
    for (const r of lib) {
      await new sql.Request(tx).input("id", sql.Int, r.Id).input("s", sql.NVarChar(sql.MAX), re(r.Script)).input("e", sql.NVarChar(sql.MAX), re(r.Env))
        .query("UPDATE dbo.ScriptLibrary SET Script = @s, Env = @e WHERE Id = @id");
    }
    const logs = (await new sql.Request(tx).query("SELECT Id, Script, Env, Output FROM dbo.ScriptRunLog")).recordset;
    for (const r of logs) {
      await new sql.Request(tx).input("id", sql.Int, r.Id).input("s", sql.NVarChar(sql.MAX), re(r.Script)).input("e", sql.NVarChar(sql.MAX), re(r.Env)).input("o", sql.NVarChar(sql.MAX), re(r.Output))
        .query("UPDATE dbo.ScriptRunLog SET Script = @s, Env = @e, Output = @o WHERE Id = @id");
    }
    await new sql.Request(tx).input("salt", sql.VarBinary(16), salt).input("hash", sql.VarBinary(32), hash)
      .query("UPDATE dbo.ScriptConsoleKey SET Salt = @salt, KeyHash = @hash, RotatedAt = SYSUTCDATETIME() WHERE Id = 1");
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
});

module.exports = { getKeyRow, insertKeyRow, listLibrary, saveLibrary, deleteLibrary, insertRun, finishRun, markInterrupted, listRuns, getRun, rotateKey };
