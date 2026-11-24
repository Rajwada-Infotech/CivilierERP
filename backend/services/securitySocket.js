"use strict";

/**
 * Live events to residents of the Civilier Security app. A resident's app connects to the socket with its
 * customer-portal token and sits in the room customer:<CrmCustomer.Id> (backend/socket.js). Best-effort and never
 * throws: push notifications and the app's own re-reading still cover a missed event.
 */
function toCustomers(customerIds, event, payload) {
  try {
    const io = require("../socket").getIo();
    if (!io) return;
    for (const id of new Set((customerIds || []).map(Number).filter(Number.isInteger))) io.to(`customer:${id}`).emit(event, payload);
  } catch {
    /* no socket server (scripts, tests) */
  }
}

module.exports = { toCustomers };
