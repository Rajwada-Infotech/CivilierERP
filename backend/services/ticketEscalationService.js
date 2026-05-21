"use strict";

const logger = require("../logger");
const { getPool, sql } = require("../db");

const DEFAULT_SLA_MINUTES = {
  Urgent: 30,
  High: 120,
  Medium: 480,
  Low: 1440,
};

function readPositiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getTicketEscalationSlaMinutes() {
  return {
    Urgent: readPositiveInt(
      "TICKET_ESCALATION_URGENT_MINUTES",
      DEFAULT_SLA_MINUTES.Urgent,
    ),
    High: readPositiveInt(
      "TICKET_ESCALATION_HIGH_MINUTES",
      DEFAULT_SLA_MINUTES.High,
    ),
    Medium: readPositiveInt(
      "TICKET_ESCALATION_MEDIUM_MINUTES",
      DEFAULT_SLA_MINUTES.Medium,
    ),
    Low: readPositiveInt(
      "TICKET_ESCALATION_LOW_MINUTES",
      DEFAULT_SLA_MINUTES.Low,
    ),
  };
}

async function addEscalationComment(pool, ticket) {
  await pool
    .request()
    .input("ticket_id", sql.Int, ticket.id)
    .input("comment", sql.NVarChar(sql.MAX), `[Escalated] ${ticket.reason}`)
    .input("author_name", sql.NVarChar(255), "System")
    .input("author_id", sql.Int, null)
    .input("author_role", sql.NVarChar(50), "system").query(`
      INSERT INTO dbo.ticket_comments (ticket_id, comment, author_name, author_id, author_role)
      VALUES (@ticket_id, @comment, @author_name, @author_id, @author_role)
    `);
}

async function runTicketEscalationJob(options = {}) {
  const pool = options.pool || getPool();
  const sla = options.slaMinutes || getTicketEscalationSlaMinutes();

  try {
    const result = await pool
      .request()
      .input("urgentMinutes", sql.Int, sla.Urgent)
      .input("highMinutes", sql.Int, sla.High)
      .input("mediumMinutes", sql.Int, sla.Medium)
      .input("lowMinutes", sql.Int, sla.Low).query(`
        UPDATE t
        SET
          escalation_level = 1,
          escalated_at = SYSUTCDATETIME(),
          escalation_reason = CONCAT(
            'Open ',
            LOWER(t.priority),
            ' priority ticket exceeded ',
            thresholds.sla_minutes,
            ' minute SLA'
          ),
          updated_at = SYSUTCDATETIME()
        OUTPUT
          inserted.id,
          inserted.priority,
          inserted.status,
          inserted.escalation_reason AS reason
        FROM dbo.tickets t
        CROSS APPLY (
          SELECT CASE t.priority
            WHEN 'Urgent' THEN @urgentMinutes
            WHEN 'High' THEN @highMinutes
            WHEN 'Medium' THEN @mediumMinutes
            ELSE @lowMinutes
          END AS sla_minutes
        ) thresholds
        WHERE t.status IN ('Pending', 'InProgress')
          AND t.escalated_at IS NULL
          AND DATEDIFF(MINUTE, ISNULL(t.updated_at, t.created_at), SYSUTCDATETIME()) >= thresholds.sla_minutes
      `);

    const escalatedTickets = result.recordset || [];
    for (const ticket of escalatedTickets) {
      await addEscalationComment(pool, ticket);
    }

    if (escalatedTickets.length > 0) {
      logger.warn(
        { event: "TICKET_ESCALATION_DONE", count: escalatedTickets.length },
        "Ticket auto-escalation completed",
      );
    }

    return escalatedTickets;
  } catch (err) {
    logger.error(
      { event: "TICKET_ESCALATION_ERROR", err },
      "Ticket auto-escalation failed",
    );
    throw err;
  }
}

module.exports = {
  DEFAULT_SLA_MINUTES,
  getTicketEscalationSlaMinutes,
  runTicketEscalationJob,
};
