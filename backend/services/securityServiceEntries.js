"use strict";

/**
 * Service entries: vehicles and workers in for maintenance, repairs, deliveries or other official work, logged in and
 * out by the guard at the gate (dbo.SecurityServiceEntry, migration 721). No resident is asked or notified.
 */
const { sql } = require("../db");

const KINDS = ["VEHICLE", "WORKER"];
const PURPOSES = ["MAINTENANCE", "REPAIR", "DELIVERY", "CONTRACTOR", "OFFICIAL", "OTHER"];

const SELECT = `
  SELECT s.EntryId AS id, s.Kind AS kind, s.Purpose AS purpose, s.PersonName AS personName, s.Company AS company,
         s.Phone AS phone, s.VehicleNo AS vehicleNo, s.PeopleCount AS peopleCount, s.WorkArea AS workArea, s.Note AS note,
         s.InAt AS inAt, s.OutAt AS outAt, s.GateId AS gateId, g.Name AS gateName, u.name AS loggedBy
  FROM dbo.SecurityServiceEntry s
  JOIN dbo.SecurityGate g ON g.GateId = s.GateId
  LEFT JOIN dbo.users u ON u.id = s.GuardUserId`;

const text = (v, max) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t.slice(0, max) : null;
};
const bad = (message) => Object.assign(new Error(message), { status: 400 });

/** Logs one entry in at the guard's gate. */
async function logIn(pool, guardUserId, gate, body) {
  const kind = String(body?.kind || "").toUpperCase();
  const purpose = String(body?.purpose || "").toUpperCase();
  if (!KINDS.includes(kind)) throw bad("Choose vehicle or worker.");
  if (!PURPOSES.includes(purpose)) throw bad("Choose what they are here for.");
  const personName = text(body?.personName, 120);
  if (!personName) throw bad(kind === "VEHICLE" ? "Enter the driver's name." : "Enter the worker's name.");
  const vehicleNo = text(body?.vehicleNo, 20)?.toUpperCase().replace(/\s+/g, " ") ?? null;
  if (kind === "VEHICLE" && !vehicleNo) throw bad("Enter the vehicle number.");
  const phone = text(body?.phone, 20);
  if (phone && !/^[+\d][\d\s-]{5,19}$/.test(phone)) throw bad("Enter a valid phone number.");
  const people = Number.parseInt(String(body?.peopleCount ?? 1), 10);
  if (!Number.isInteger(people) || people < 1 || people > 99) throw bad("People: 1 to 99.");

  const id = (
    await pool
      .request()
      .input("p", sql.Int, gate.projectId)
      .input("g", sql.Int, gate.gateId)
      .input("u", sql.Int, guardUserId)
      .input("k", sql.NVarChar(10), kind)
      .input("pu", sql.NVarChar(20), purpose)
      .input("n", sql.NVarChar(120), personName)
      .input("c", sql.NVarChar(120), text(body?.company, 120))
      .input("ph", sql.NVarChar(20), phone)
      .input("v", sql.NVarChar(20), vehicleNo)
      .input("pc", sql.TinyInt, people)
      .input("w", sql.NVarChar(120), text(body?.workArea, 120))
      .input("no", sql.NVarChar(300), text(body?.note, 300)).query(`
        INSERT INTO dbo.SecurityServiceEntry (ProjectId, GateId, GuardUserId, Kind, Purpose, PersonName, Company, Phone, VehicleNo, PeopleCount, WorkArea, Note)
        OUTPUT INSERTED.EntryId AS id
        VALUES (@p, @g, @u, @k, @pu, @n, @c, @ph, @v, @pc, @w, @no)`)
  ).recordset[0].id;
  return getEntry(pool, id);
}

async function getEntry(pool, id) {
  return (await pool.request().input("id", sql.Int, id).query(`${SELECT} WHERE s.EntryId = @id`)).recordset[0] || null;
}

/** Logs an entry out; only one at the guard's own project, and only once. */
async function logOut(pool, guardUserId, projectId, id) {
  const r = await pool.request().input("id", sql.Int, id).input("u", sql.Int, guardUserId).input("p", sql.Int, projectId).query(`
    UPDATE dbo.SecurityServiceEntry SET OutAt = SYSUTCDATETIME(), OutGuardUserId = @u
    WHERE EntryId = @id AND ProjectId = @p AND OutAt IS NULL`);
  if (!r.rowsAffected[0]) {
    // Not updated: either already out (fine, return it) or not an entry at this project.
    const mine = (await pool.request().input("id", sql.Int, id).input("p", sql.Int, projectId).query(`
      SELECT 1 AS x FROM dbo.SecurityServiceEntry WHERE EntryId = @id AND ProjectId = @p`)).recordset[0];
    if (!mine) throw Object.assign(new Error("Entry not found."), { status: 404 });
  }
  return getEntry(pool, id);
}

/** At a project: everyone still inside (any day), and everything logged in since `since`. Newest first. */
async function listAt(pool, projectId, since) {
  return (
    await pool.request().input("p", sql.Int, projectId).input("s", sql.DateTime2, since).query(`
      ${SELECT} WHERE s.ProjectId = @p AND (s.OutAt IS NULL OR s.InAt >= @s) ORDER BY CASE WHEN s.OutAt IS NULL THEN 0 ELSE 1 END, s.InAt DESC`)
  ).recordset;
}

module.exports = { KINDS, PURPOSES, logIn, logOut, listAt, getEntry };
