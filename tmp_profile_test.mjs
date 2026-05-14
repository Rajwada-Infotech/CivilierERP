import { performance } from "node:perf_hooks";

const url = "http://localhost:5000/api/user-profile/7/profile";

const t0 = performance.now();
const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
const body = await res.text();
const ms = Math.round(performance.now() - t0);

console.log(JSON.stringify({ status: res.status, ms, body: body.slice(0, 500) }, null, 2));
