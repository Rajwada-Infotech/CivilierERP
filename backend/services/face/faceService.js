"use strict";
/**
 * Face registration (HR, from Employee Master) and punch verification (Employee Portal web + app).
 *
 * Punch flow (1:1 verification — the employee is already known from the portal login):
 *   POST /attendance/challenge {kind}  → single-use nonce, valid CHALLENGE_TTL_S seconds
 *   POST /attendance/in|out {nonce, photo, latitude, longitude, accuracy}
 *     1. nonce: belongs to this employee, right purpose, not expired, not used (consumed atomically → no replay)
 *     2. lockout: too many failed checks recently → refused for a while
 *     3. geofence: inside an assigned Work Location's radius, with acceptable GPS accuracy
 *     4. face: live photo → embedding → cosine vs the decrypted Active template ≥ threshold
 *        (FaceExempt employees skip 4; the punch is flagged NeedsReview for HR)
 *   Every outcome is written to EmployeeFaceVerification (score / stage / reason — never images or embeddings).
 */
const crypto = require("crypto");
const { sql } = require("../../db");
const engine = require("./faceEngine");
const { encryptTemplate, decryptTemplate, encryptBytes, decryptBytes, isConfigured } = require("./faceCrypto");
const { checkGeofence } = require("./geofence");

const CHALLENGE_TTL_S = 120;
const MAX_FAILS = Number(process.env.FACE_MAX_FAILS) || 5;
const LOCK_MIN = Number(process.env.FACE_LOCK_MINUTES) || 15;
const MIN_SAMPLES = 3;
const MAX_SAMPLES = 5;

class VerifyError extends Error {
  constructor(message, status = 400, stage = null) { super(message); this.status = status; this.stage = stage; }
}

const faceRequired = () => process.env.ATTENDANCE_FACE_REQUIRED !== "false";
const geofenceRequired = () => process.env.ATTENDANCE_GEOFENCE_REQUIRED !== "false";

async function log(pool, row) {
  await pool.request()
    .input("E", sql.Int, row.employeeId).input("P", sql.NVarChar(20), row.purpose).input("R", sql.NVarChar(20), row.result)
    .input("St", sql.NVarChar(20), row.stage ?? null).input("Sc", sql.Decimal(6, 4), row.score ?? null)
    .input("Re", sql.NVarChar(300), row.reason ? String(row.reason).slice(0, 300) : null)
    .input("L", sql.Int, row.locationId ?? null).input("D", sql.Int, row.distanceM ?? null).input("A", sql.Int, row.accuracyM ?? null)
    .input("T", sql.Int, row.templateId ?? null).input("Ip", sql.NVarChar(64), row.ip ? String(row.ip).slice(0, 64) : null)
    .query(`INSERT INTO dbo.EmployeeFaceVerification (EmployeeId, Purpose, Result, Stage, Score, Reason, LocationId, DistanceM, AccuracyM, FaceTemplateId, IpAddress)
            VALUES (@E, @P, @R, @St, @Sc, @Re, @L, @D, @A, @T, @Ip)`);
}

async function activeTemplate(pool, employeeId) {
  return (await pool.request().input("E", sql.Int, employeeId).query(
    "SELECT TOP 1 FaceTemplateId, TemplateCipher FROM dbo.EmployeeFaceTemplate WHERE EmployeeId = @E AND Status = N'Active'")).recordset[0] || null;
}

// ── HR: status, enroll, revoke, exempt ───────────────────────────────────────
async function status(pool, employeeId) {
  const emp = (await pool.request().input("E", sql.Int, employeeId).query(
    "SELECT EmployeeId, EmployeeName, FaceExempt, FaceExemptReason FROM dbo.EmployeeMaster WHERE EmployeeId = @E")).recordset[0];
  if (!emp) throw new VerifyError("Employee not found", 404);
  const history = (await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT t.FaceTemplateId, t.Status, t.SampleCount, t.QualityScore, t.ModelVersion, t.EnrolledAt, t.RevokedAt, t.RevokeReason,
           ${await has693(pool) ? "t.Source, t.ProfileScore, t.DecidedAt, (SELECT name FROM dbo.users WHERE id = t.DecidedBy) AS DecidedByName, CAST(CASE WHEN t.ReviewPhoto IS NULL THEN 0 ELSE 1 END AS bit) AS HasReviewPhoto," : ""}
           (SELECT name FROM dbo.users WHERE id = t.EnrolledBy) AS EnrolledByName, (SELECT name FROM dbo.users WHERE id = t.RevokedBy) AS RevokedByName
    FROM dbo.EmployeeFaceTemplate t WHERE t.EmployeeId = @E ORDER BY t.EnrolledAt DESC`)).recordset;
  const recent = (await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT TOP 20 v.Purpose, v.Result, v.Stage, v.Score, v.Reason, v.DistanceM, v.AccuracyM, w.LocationName, v.CreatedAt
    FROM dbo.EmployeeFaceVerification v LEFT JOIN dbo.WorkLocationMaster w ON w.LocationId = v.LocationId
    WHERE v.EmployeeId = @E ORDER BY v.CreatedAt DESC`)).recordset;
  const locations = (await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT w.LocationName, w.RadiusMeters FROM dbo.EmployeeWorkLocation x JOIN dbo.WorkLocationMaster w ON w.LocationId = x.LocationId AND w.IsActive = 1
    WHERE x.EmployeeId = @E`)).recordset;
  return {
    configured: isConfigured(), faceRequired: faceRequired(), geofenceRequired: geofenceRequired(),
    active: history.find((h) => h.Status === "Active") || null, pending: history.find((h) => h.Status === "Pending") || null, history, recent, locations,
    exempt: !!emp.FaceExempt, exemptReason: emp.FaceExemptReason,
  };
}

/** Photos are taken by HR from the webcam with the employee present. Replaces any Active template. */
async function enroll(pool, employeeId, { photos, consent }, by, ip, source = "HR") {
  const self = source === "Self";
  if (self && !(await has693(pool))) throw new VerifyError("Self registration is not set up on this database yet.", 503);
  if (!consent) throw new VerifyError("Confirm the employee has given consent for face registration.");
  if (!Array.isArray(photos) || photos.length < MIN_SAMPLES || photos.length > MAX_SAMPLES) {
    throw new VerifyError(`Take ${MIN_SAMPLES} to ${MAX_SAMPLES} photos.`);
  }
  if (!isConfigured()) throw new VerifyError("Face verification is not configured on the server (FACE_TEMPLATE_KEY missing).", 503);
  const exists = (await pool.request().input("E", sql.Int, employeeId).query("SELECT PhotoBase64 FROM dbo.EmployeeMaster WHERE EmployeeId = @E AND IsActive = 1")).recordset[0];
  if (!exists) throw new VerifyError("Employee not found or inactive", 404);
  if (self) {
    const n = (await pool.request().input("E", sql.Int, employeeId).query(
      "SELECT COUNT(*) AS n FROM dbo.EmployeeFaceTemplate WHERE EmployeeId = @E AND Source = N'Self' AND EnrolledAt > DATEADD(HOUR, -24, SYSUTCDATETIME())")).recordset[0].n;
    if (n >= 3) throw new VerifyError("You have sent 3 face registrations today. Try again tomorrow or ask HR.", 429);
  }

  const samples = [];
  const problems = [];
  for (const [i, p] of photos.entries()) {
    try { samples.push(await engine.analyse(p)); } catch (e) {
      if (e instanceof engine.FaceQualityError) problems.push({ photo: i + 1, message: e.message }); else throw e;
    }
  }
  if (problems.length) {
    await log(pool, { employeeId, purpose: "enroll", result: "Fail", stage: "quality", reason: problems.map((p) => `#${p.photo} ${p.message}`).join("; "), ip });
    const err = new VerifyError(`Photo ${problems.map((p) => p.photo).join(", ")} not usable: ${problems[0].message}`, 422, "quality");
    err.problems = problems;
    throw err;
  }
  // All samples must be the same person.
  let minPair = 1;
  for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) minPair = Math.min(minPair, engine.cosine(samples[i].embedding, samples[j].embedding));
  if (minPair < 0.5) {
    await log(pool, { employeeId, purpose: "enroll", result: "Fail", stage: "match", score: minPair, reason: "Samples don't match each other", ip });
    throw new VerifyError("The photos don't look like the same person. Retake them with only the employee in front of the camera.", 422, "match");
  }
  const mean = new Float32Array(samples[0].embedding.length);
  for (const s of samples) for (let i = 0; i < mean.length; i++) mean[i] += s.embedding[i];
  const norm = Math.hypot(...mean) || 1;
  for (let i = 0; i < mean.length; i++) mean[i] /= norm;
  const { cipher, keyId } = encryptTemplate(employeeId, mean);
  mean.fill(0);
  const q = samples.reduce((a, s) => a + s.quality, 0) / samples.length;
  // For HR's review of a self-registration: how well it matches the employee's profile photo (if it is a JPEG with a face).
  let profileScore = null;
  if (exists.PhotoBase64 && /^data:image\/jpeg;base64,/.test(exists.PhotoBase64)) {
    try { profileScore = engine.cosine((await engine.analyse(exists.PhotoBase64)).embedding, samples[0].embedding); } catch { profileScore = null; }
  }
  const reviewPhoto = self ? encryptBytes("face-review", employeeId, Buffer.from(String(photos[0]).split(",")[1], "base64")) : null;

  const tx = new sql.Transaction(pool);
  await tx.begin();
  let templateId;
  try {
    // HR enrolment replaces the Active one at once; a self-registration only replaces an earlier Pending one.
    await new sql.Request(tx).input("E", sql.Int, employeeId).input("U", sql.Int, by)
      .query(`UPDATE dbo.EmployeeFaceTemplate SET Status = N'Replaced', RevokedAt = SYSUTCDATETIME(), RevokedBy = @U, RevokeReason = N'Re-registered'${self ? ", ReviewPhoto = NULL" : ""}
              WHERE EmployeeId = @E AND Status IN (${self ? "N'Pending'" : "N'Active', N'Pending'"})`);
    const r = new sql.Request(tx).input("E", sql.Int, employeeId).input("C", sql.VarBinary(sql.MAX), cipher).input("K", sql.NVarChar(100), keyId)
      .input("M", sql.NVarChar(60), engine.MODEL_VERSION).input("N", sql.Int, samples.length).input("Q", sql.Decimal(5, 3), q).input("U", sql.Int, by)
      .input("S", sql.NVarChar(20), self ? "Pending" : "Active");
    const v693 = await has693(pool);
    if (v693) r.input("Src", sql.NVarChar(10), self ? "Self" : "HR").input("RP", sql.VarBinary(sql.MAX), reviewPhoto).input("PS", sql.Decimal(6, 4), profileScore);
    const ins = await r.query(`INSERT INTO dbo.EmployeeFaceTemplate (EmployeeId, Status, TemplateCipher, KeyId, ModelVersion, SampleCount, QualityScore, ConsentAt, EnrolledBy${v693 ? ", Source, ReviewPhoto, ProfileScore" : ""})
              OUTPUT INSERTED.FaceTemplateId VALUES (@E, @S, @C, @K, @M, @N, @Q, SYSUTCDATETIME(), @U${v693 ? ", @Src, @RP, @PS" : ""})`);
    templateId = ins.recordset[0].FaceTemplateId;
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  await log(pool, { employeeId, purpose: "enroll", result: self ? "Pending" : "Pass", stage: "match", score: minPair, templateId, ip });
  if (self) return { message: "Face sent to HR for approval. You can punch with your face once HR approves it." };
  return { message: "Face registered — the employee can now punch with face verification." };
}

async function revoke(pool, employeeId, reason, by) {
  if (!reason || !String(reason).trim()) throw new VerifyError("Write the reason");
  const r = await pool.request().input("E", sql.Int, employeeId).input("U", sql.Int, by).input("R", sql.NVarChar(500), String(reason).trim().slice(0, 500))
    .query("UPDATE dbo.EmployeeFaceTemplate SET Status = N'Revoked', RevokedAt = SYSUTCDATETIME(), RevokedBy = @U, RevokeReason = @R WHERE EmployeeId = @E AND Status IN (N'Active', N'Pending')");
  if (!r.rowsAffected[0]) throw new VerifyError("No active face registration to revoke", 404);
  return { message: "Face registration revoked. Register again before the employee can punch." };
}

async function setExempt(pool, employeeId, exempt, reason) {
  if (exempt && !String(reason || "").trim()) throw new VerifyError("Write why the employee can't use face verification");
  const r = await pool.request().input("E", sql.Int, employeeId).input("X", sql.Bit, exempt ? 1 : 0).input("R", sql.NVarChar(300), exempt ? String(reason).trim().slice(0, 300) : null)
    .query("UPDATE dbo.EmployeeMaster SET FaceExempt = @X, FaceExemptReason = @R WHERE EmployeeId = @E");
  if (!r.rowsAffected[0]) throw new VerifyError("Employee not found", 404);
  return { message: exempt ? "Face check exempted — punches still need the work location and are flagged for HR review." : "Face check required again." };
}


let v693 = null;
async function has693(pool) {
  if (v693 === null) v693 = !!(await pool.request().query("SELECT COL_LENGTH('dbo.EmployeeFaceTemplate', 'Source') AS c")).recordset[0].c;
  return v693;
}

/** HR approves a Pending self-registration: it becomes Active, the previous Active one is Replaced. */
async function approve(pool, employeeId, templateId, by) {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const p = await new sql.Request(tx).input("E", sql.Int, employeeId).input("T", sql.Int, templateId)
      .query("SELECT 1 AS x FROM dbo.EmployeeFaceTemplate WITH (UPDLOCK) WHERE FaceTemplateId = @T AND EmployeeId = @E AND Status = N'Pending'");
    if (!p.recordset[0]) throw new VerifyError("This registration is no longer waiting for approval.", 409);
    await new sql.Request(tx).input("E", sql.Int, employeeId).input("U", sql.Int, by).query(
      "UPDATE dbo.EmployeeFaceTemplate SET Status = N'Replaced', RevokedAt = SYSUTCDATETIME(), RevokedBy = @U, RevokeReason = N'Replaced by approved self-registration' WHERE EmployeeId = @E AND Status = N'Active'");
    await new sql.Request(tx).input("T", sql.Int, templateId).input("U", sql.Int, by).query(
      "UPDATE dbo.EmployeeFaceTemplate SET Status = N'Active', DecidedBy = @U, DecidedAt = SYSUTCDATETIME(), ReviewPhoto = NULL WHERE FaceTemplateId = @T");
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
  await log(pool, { employeeId, purpose: "enroll", result: "Pass", stage: "approval", templateId, reason: "Approved by HR" });
  return { message: "Face approved — the employee can now punch with face verification." };
}

async function reject(pool, employeeId, templateId, reason, by) {
  if (!String(reason || "").trim()) throw new VerifyError("Write the reason so the employee knows what to fix");
  const r = await pool.request().input("E", sql.Int, employeeId).input("T", sql.Int, templateId).input("U", sql.Int, by).input("R", sql.NVarChar(500), String(reason).trim().slice(0, 500))
    .query("UPDATE dbo.EmployeeFaceTemplate SET Status = N'Rejected', DecidedBy = @U, DecidedAt = SYSUTCDATETIME(), RevokeReason = @R, ReviewPhoto = NULL WHERE FaceTemplateId = @T AND EmployeeId = @E AND Status = N'Pending'");
  if (!r.rowsAffected[0]) throw new VerifyError("This registration is no longer waiting for approval.", 409);
  await log(pool, { employeeId, purpose: "enroll", result: "Fail", stage: "approval", templateId, reason: `Rejected by HR: ${reason}` });
  return { message: "Registration rejected. The employee can register again from the app." };
}

/** The review photo of a Pending self-registration, as a data URL (HR only). */
async function reviewPhoto(pool, employeeId, templateId) {
  const r = (await pool.request().input("E", sql.Int, employeeId).input("T", sql.Int, templateId).query(
    "SELECT ReviewPhoto FROM dbo.EmployeeFaceTemplate WHERE FaceTemplateId = @T AND EmployeeId = @E AND Status = N'Pending'")).recordset[0];
  if (!r?.ReviewPhoto) throw new VerifyError("No photo to review", 404);
  return `data:image/jpeg;base64,${decryptBytes("face-review", employeeId, r.ReviewPhoto).toString("base64")}`;
}

/** What the employee sees in the app: their own registration state (no scores, no photos). */
async function selfStatus(pool, employeeId) {
  const rows = (await pool.request().input("E", sql.Int, employeeId).query(`
    SELECT TOP 5 Status, EnrolledAt, ${await has693(pool) ? "DecidedAt, Source," : ""} RevokeReason FROM dbo.EmployeeFaceTemplate WHERE EmployeeId = @E ORDER BY EnrolledAt DESC`)).recordset;
  const emp = (await pool.request().input("E", sql.Int, employeeId).query("SELECT FaceExempt FROM dbo.EmployeeMaster WHERE EmployeeId = @E")).recordset[0];
  const active = rows.find((r) => r.Status === "Active");
  const pending = rows.find((r) => r.Status === "Pending");
  const last = rows[0];
  return {
    required: faceRequired(), exempt: !!emp?.FaceExempt, configured: isConfigured(),
    state: active ? "Active" : pending ? "Pending" : last?.Status === "Rejected" ? "Rejected" : last?.Status === "Revoked" ? "Revoked" : "None",
    activeSince: active?.EnrolledAt ?? null, pendingSince: pending?.EnrolledAt ?? null,
    rejectReason: !active && !pending && last?.Status === "Rejected" ? last.RevokeReason : null,
  };
}

// ── Punch: challenge + verification ──────────────────────────────────────────
async function createChallenge(pool, employeeId, kind) {
  if (!["in", "out"].includes(kind)) throw new VerifyError("Invalid punch");
  const nonce = crypto.randomBytes(32).toString("hex");
  await pool.request().input("E", sql.Int, employeeId).input("N", sql.Char(64), nonce).input("P", sql.NVarChar(10), kind).input("T", sql.Int, CHALLENGE_TTL_S)
    .query(`DELETE FROM dbo.AttendanceChallenge WHERE ExpiresAt < DATEADD(HOUR, -1, SYSUTCDATETIME());
            INSERT INTO dbo.AttendanceChallenge (EmployeeId, Nonce, Purpose, ExpiresAt) VALUES (@E, @N, @P, DATEADD(SECOND, @T, SYSUTCDATETIME()))`);
  return { nonce, expiresInSeconds: CHALLENGE_TTL_S, faceRequired: faceRequired(), geofenceRequired: geofenceRequired() };
}

async function lockedOut(pool, employeeId) {
  const r = (await pool.request().input("E", sql.Int, employeeId).input("M", sql.Int, LOCK_MIN).query(`
    SELECT COUNT(*) AS n FROM dbo.EmployeeFaceVerification
    WHERE EmployeeId = @E AND Purpose IN (N'in', N'out') AND Result = N'Fail' AND Stage IN (N'match', N'quality')
      AND CreatedAt > DATEADD(MINUTE, -@M, SYSUTCDATETIME())`)).recordset[0].n;
  return r >= MAX_FAILS;
}

/**
 * Runs every check for a punch. Returns what the attendance row stores: { locationId, distanceM, faceScore, review }.
 * Throws VerifyError (logged) when the punch must be refused. `ev` is the cleaned evidence {photo, lat, lng, acc}.
 */
async function verifyPunch(pool, employee, kind, nonce, ev, ip) {
  const employeeId = employee.EmployeeId;
  const base = { employeeId, purpose: kind, ip, accuracyM: ev.acc };
  const fail = async (stage, message, extra = {}, status = 400) => {
    await log(pool, { ...base, result: "Fail", stage, reason: message, ...extra });
    throw new VerifyError(message, status, stage);
  };

  // 1. Challenge: consume it atomically (single use, not expired, this employee, this purpose).
  const used = await pool.request().input("E", sql.Int, employeeId).input("N", sql.Char(64), String(nonce || "").slice(0, 64)).input("P", sql.NVarChar(10), kind)
    .query("UPDATE dbo.AttendanceChallenge SET UsedAt = SYSUTCDATETIME() WHERE EmployeeId = @E AND Nonce = @N AND Purpose = @P AND UsedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()");
  if (!used.rowsAffected[0]) await fail("challenge", "This punch request has expired. Please try again.");

  // 2. Too many failures recently.
  if (await lockedOut(pool, employeeId)) await fail("lockout", `Too many failed attempts. Try again after ${LOCK_MIN} minutes or contact HR.`, {}, 429);

  // 3. Geofence.
  let geo = { ok: true };
  if (geofenceRequired()) {
    geo = await checkGeofence(pool, employeeId, ev);
    if (!geo.ok) await fail("geofence", geo.reason, { locationId: geo.location?.LocationId, distanceM: geo.distanceM });
  }
  const where = { locationId: geo.location?.LocationId ?? null, distanceM: geo.distanceM ?? null };

  // 4. Face (1:1 against this employee's Active template).
  const exempt = !!(await pool.request().input("E", sql.Int, employeeId).query("SELECT FaceExempt FROM dbo.EmployeeMaster WHERE EmployeeId = @E")).recordset[0]?.FaceExempt;
  if (!faceRequired() || exempt) {
    await log(pool, { ...base, result: exempt ? "Exempt" : "Pass", stage: "geofence", ...where });
    return { ...where, faceScore: null, review: exempt ? "Face check exempted by HR" : null };
  }
  if (!isConfigured()) await fail("match", "Face verification is not configured on the server. Contact HR.", where, 503);
  const tpl = await activeTemplate(pool, employeeId);
  if (!tpl) await fail("enrollment", "Your face is not registered yet. Open Profile › Face registration in the app (or wait for HR to approve it).", where, 403);
  let live;
  try { live = await engine.analyse(ev.photo); } catch (e) {
    if (e instanceof engine.FaceQualityError) await fail("quality", e.message, where, 422);
    throw e;
  }
  const stored = decryptTemplate(employeeId, tpl.TemplateCipher);
  const score = engine.cosine(live.embedding, stored);
  stored.fill(0); live.embedding.fill(0);
  if (score < engine.matchThreshold()) {
    await fail("match", "Face did not match your registered face. Look straight at the camera in good light and try again.", { ...where, score, templateId: tpl.FaceTemplateId }, 403);
  }
  await log(pool, { ...base, result: "Pass", stage: "match", score, templateId: tpl.FaceTemplateId, ...where });
  return { ...where, faceScore: Math.round(score * 10000) / 10000, review: null };
}

module.exports = { status, enroll, approve, reject, reviewPhoto, selfStatus, revoke, setExempt, createChallenge, verifyPunch, VerifyError };
