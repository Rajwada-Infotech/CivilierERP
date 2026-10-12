"use strict";

/**
 * Live "something changed" signals over socket.io.
 *
 * The server never sends data here, only a topic name: "ledgers changed". Each open page that shows that kind of
 * list then re-reads it through the normal REST API, which applies that person's own rights and project scope - so
 * nothing private can leak through the socket, and a page that isn't open costs nothing.
 *
 * The signal is raised from the cache layer (bumpCacheVersion in redis.js), which every write already calls after it
 * saves. So a new route that writes ledgers and refreshes its cache announces itself with no extra code.
 *
 * Topics:
 *   "ledgers" - any ledger / vendor / contractor / customer / partner / bank account head was added, changed or removed
 */

const EVENT = "data:changed";
const DEBOUNCE_MS = 250;

// Cache namespaces whose bump means "the account-head lists changed".
const LEDGER_NAMESPACES = new Set([
  "account-head-master",
  "general-ledger",
  "general-ledger-detail",
  "partner-master",
  "bank-master",
]);

const pending = new Map(); // topic -> timer

function getIoSafely() {
  try {
    return require("../socket").getIo();
  } catch {
    return null; // sockets not started (tests, scripts)
  }
}

/** Tells every connected, signed-in client that `topic` changed. A burst of changes is sent once. */
function emitDataChanged(topic) {
  if (pending.has(topic)) return;
  const timer = setTimeout(() => {
    pending.delete(topic);
    const io = getIoSafely();
    if (io) io.emit(EVENT, { topic, at: Date.now() });
  }, DEBOUNCE_MS);
  if (typeof timer.unref === "function") timer.unref();
  pending.set(topic, timer);
}

/**
 * Called by bumpCacheVersion after every cache bump. For ledger-related namespaces it also refreshes the shared
 * account-head list cache (GET /api/account-head is cached for 5 minutes under "account-head-master", and creating a
 * GL, bank or partner head only bumped its own namespace, so the vendor / ledger pickers stayed stale for up to 5
 * minutes), then raises the "ledgers" signal.
 */
function afterCacheBump(namespace) {
  if (!LEDGER_NAMESPACES.has(namespace)) return;
  if (namespace !== "account-head-master") {
    try {
      // bumpCacheVersion calls back into here for "account-head-master", which does not bump again - no loop.
      const bump = require("../redis").bumpCacheVersion;
      if (typeof bump === "function") Promise.resolve(bump("account-head-master")).catch(() => {});
    } catch {
      /* redis unavailable: the signal below still goes out */
    }
  }
  emitDataChanged("ledgers");
}

/** For tests. */
function resetRealtime() {
  for (const t of pending.values()) clearTimeout(t);
  pending.clear();
}

module.exports = { EVENT, DEBOUNCE_MS, LEDGER_NAMESPACES, emitDataChanged, afterCacheBump, resetRealtime };
