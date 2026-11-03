#!/usr/bin/env node
/**
 * load-test.mjs — zero-dependency load test for the
 * Nepal Grand Tihar Festival 2026 audience voting system
 * (Next.js dev server, Prisma/SQLite backend).
 *
 * Requirements: Node >= 18 (built for Node 24) — global fetch, global
 * performance.now(), AbortSignal.timeout(), Headers#getSetCookie().
 * No npm dependencies.
 *
 * Usage:
 *   ADMIN_PASSWORD=secret node scripts/load-test.mjs
 *
 *   BASE_URL=http://localhost:3000 ADMIN_USERNAME=admin ADMIN_PASSWORD=secret \
 *   VOTE_TARGET=1000 VOTE_RATE=100 READ_CONCURRENCY=500 READ_REQUESTS_PER_USER=3 \
 *   node scripts/load-test.mjs
 *
 * CLI flags (override env vars): --base-url=... --admin-username=...
 *   --admin-password=... --vote-target=N --vote-rate=N --read-concurrency=N
 *   --read-requests-per-user=N
 *
 * Exit code: 0 = all checks passed, 1 = failed check(s) or fatal error.
 * Full metrics are written to scripts/load-test-results.json (next to this file).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Configuration (CLI flags > env vars > defaults)
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 30_000;
const ADMIN_COOKIE_NAME = 'ngtf_admin_session';
const RACE_TOKENS = 5;
const RACE_FANOUT = 20;
const DUPLICATE_WAVE_SIZE = 100;
const PAUSED_CLOSED_WAVE_SIZE = 100;
const HEALTH_MAX_TRIES = 30;
const HEALTH_RETRY_MS = 1000;
const WARMUP_ROUNDS = 5;
const VOTE_BATCH_INTERVAL_MS = 1000;

const RESULTS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'load-test-results.json',
);

const FLAG_MAP = {
  'base-url': 'baseUrl',
  'admin-username': 'adminUsername',
  'admin-password': 'adminPassword',
  'vote-target': 'voteTarget',
  'vote-rate': 'voteRate',
  'read-concurrency': 'readConcurrency',
  'read-requests-per-user': 'readRequestsPerUser',
};

function parseCliFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    let key = argv[i];
    let value;
    if (key.startsWith('--')) key = key.slice(2);
    const eq = key.indexOf('=');
    if (eq !== -1) {
      value = key.slice(eq + 1);
      key = key.slice(0, eq);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      value = argv[++i];
    } else {
      value = 'true';
    }
    if (key in FLAG_MAP) out[FLAG_MAP[key]] = value;
  }
  return out;
}

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage:
  ADMIN_PASSWORD=secret node scripts/load-test.mjs

Env vars:
  BASE_URL                (default http://localhost:3000)
  ADMIN_USERNAME          (default "admin")
  ADMIN_PASSWORD          (required)
  VOTE_TARGET             (default 1000)
  VOTE_RATE               (default 100 votes/second)
  READ_CONCURRENCY        (default 500 virtual users)
  READ_REQUESTS_PER_USER  (default 3)

CLI flags override env: --base-url --admin-username --admin-password
  --vote-target --vote-rate --read-concurrency --read-requests-per-user`);
  process.exit(0);
}

const flags = parseCliFlags(process.argv.slice(2));
const env = process.env;

const CONFIG = {
  baseUrl: (flags.baseUrl ?? env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
  adminUsername: flags.adminUsername ?? env.ADMIN_USERNAME ?? 'admin',
  adminPassword: flags.adminPassword ?? env.ADMIN_PASSWORD ?? '',
  voteTarget: toPositiveInt(flags.voteTarget ?? env.VOTE_TARGET, 1000),
  voteRate: toPositiveInt(flags.voteRate ?? env.VOTE_RATE, 100),
  readConcurrency: toPositiveInt(flags.readConcurrency ?? env.READ_CONCURRENCY, 500),
  readRequestsPerUser: toPositiveInt(flags.readRequestsPerUser ?? env.READ_REQUESTS_PER_USER, 3),
};

if (!CONFIG.adminPassword) {
  console.error(
    'ERROR: ADMIN_PASSWORD is required (env var ADMIN_PASSWORD or --admin-password=...).',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Small helpers (no dependencies)
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 43-char base64url device token, exactly like the client would generate. */
const newToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * Minimal request wrapper.
 * @returns {Promise<{status:number, body:any, ms:number, headers:Headers|null, error:string|null}>}
 *   Network/timeout failures yield status 0 with an error message.
 */
async function request(method, pathName, { json, cookie } = {}) {
  const url = `${CONFIG.baseUrl}${pathName}`;
  const headers = {};
  if (json !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const started = performance.now();
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const ms = performance.now() - started;
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text; // non-JSON (e.g. HTML error page) — keep raw string
      }
    }
    return { status: res.status, body, ms, headers: res.headers, error: null };
  } catch (err) {
    return {
      status: 0,
      body: null,
      ms: performance.now() - started,
      headers: null,
      error: err?.message ?? String(err),
    };
  }
}

/** Extract the "ngtf_admin_session=..." cookie pair from a login response. */
function extractSessionCookie(loginRes) {
  const jars = loginRes.headers?.getSetCookie?.() ?? [];
  const candidates = jars.filter((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`));
  if (candidates.length === 0) return null;
  // "ngtf_admin_session=xxx; Path=/; HttpOnly; SameSite=Lax" -> name=value only
  return candidates[candidates.length - 1].split(';')[0];
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function newRecorder(label) {
  return {
    label,
    total: 0,
    success2xx: 0,
    matched: 0, // requests whose status equals the phase's expected status
    networkErrors: 0,
    statuses: {},
    latencies: [],
    _t0: null,
    _t1: null,
  };
}

function record(rec, res, expectedStatus) {
  rec.total++;
  if (rec._t0 === null) rec._t0 = performance.now();
  rec._t1 = performance.now();
  if (res.status >= 200 && res.status < 300) rec.success2xx++;
  if (expectedStatus !== undefined && res.status === expectedStatus) rec.matched++;
  const key = res.status === 0 ? 'ERR' : String(res.status);
  rec.statuses[key] = (rec.statuses[key] ?? 0) + 1;
  rec.latencies.push(res.ms);
}

/** p is 0..100; assumes ascending sorted input. Nearest-rank percentile. */
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx];
}

function summarize(rec) {
  const latencies = [...rec.latencies].sort((a, b) => a - b);
  const n = latencies.length;
  const sum = latencies.reduce((acc, x) => acc + x, 0);
  const durationMs = rec._t0 !== null ? Math.max(rec._t1 - rec._t0, 0.000001) : 0;
  return {
    label: rec.label,
    total: rec.total,
    success2xx: rec.success2xx,
    matched: rec.matched,
    networkErrors: rec.networkErrors,
    statuses: { ...rec.statuses },
    durationMs,
    rps: durationMs > 0 ? rec.total / (durationMs / 1000) : 0,
    meanMs: n > 0 ? sum / n : 0,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: n > 0 ? latencies[n - 1] : 0,
  };
}

const statusBreakdown = (statuses) =>
  Object.entries(statuses)
    .map(([k, v]) => `${k}x${v}`)
    .join(' ');

function printSummary(rec) {
  const s = summarize(rec);
  console.log(
    `  -> total=${s.total} 2xx=${s.success2xx} matched=${s.matched} netErr=${s.networkErrors} [${statusBreakdown(s.statuses)}]`,
  );
  console.log(
    `     rps=${s.rps.toFixed(1)} mean=${s.meanMs.toFixed(1)}ms p50=${s.p50Ms.toFixed(1)}ms p95=${s.p95Ms.toFixed(1)}ms p99=${s.p99Ms.toFixed(1)}ms max=${s.maxMs.toFixed(1)}ms dur=${(s.durationMs / 1000).toFixed(2)}s`,
  );
}

function logPhase(title) {
  console.log('\n' + '='.repeat(72));
  console.log(` ${title}`);
  console.log('='.repeat(72));
}

// ---------------------------------------------------------------------------
// Run state (module scope so fatal errors can still persist partial metrics)
// ---------------------------------------------------------------------------

const PHASE_REPORTS = [];
const startedAt = new Date().toISOString();

let checkA = false; // all Phase-3 votes accepted
let checkB = false; // all duplicate replays rejected with 409
let checkC = false; // race: exactly 1 success per token
let checkD = false; // paused & closed: all 403
let checkE = false; // durable total matches
let overallPass = false;
let fatalError = null;

let adminCookie = null;
let participantIds = [];
let votesAccepted = 0;
let raceSuccesses = 0;
let raceRejects = 0;
let raceAnomalies = 0;
let expectedTotalVotes = 0;
let serverTotalVotes = null;
let top5Results = [];

function finishPhase(name, rec, pass, details = {}) {
  const summary = summarize(rec);
  PHASE_REPORTS.push({ name, pass: Boolean(pass), ...summary, ...details });
  console.log(`  Phase result: ${pass ? 'PASS' : 'FAIL'}`);
  return summary;
}

function buildMetrics() {
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    config: { ...CONFIG, adminPassword: '***redacted***' },
    phases: PHASE_REPORTS,
    observed: {
      participantCount: participantIds.length,
      phase3AcceptedVotes: votesAccepted,
      raceSuccesses,
      raceRejects,
      raceAnomalies,
      expectedTotalVotes,
      serverTotalVotes,
      top5Results,
    },
    checks: {
      allPhase3VotesAccepted: checkA,
      allDuplicatesRejected409: checkB,
      raceExactlyOneSuccessPerToken: checkC,
      pausedAndClosedAll403: checkD,
      durableTotalMatches: checkE,
    },
    overallPass,
    ...(fatalError ? { fatalError } : {}),
  };
}

function writeMetricsFile() {
  try {
    fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    fs.writeFileSync(RESULTS_PATH, `${JSON.stringify(buildMetrics(), null, 2)}\n`);
    console.log(`\nMetrics written to ${RESULTS_PATH}`);
  } catch (err) {
    console.error(`Failed to write metrics file: ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Tihar 2026 Audience Voting System — load test');
  console.log(`  base url   : ${CONFIG.baseUrl}`);
  console.log(`  admin user : ${CONFIG.adminUsername}`);
  console.log(
    `  vote load  : ${CONFIG.voteTarget} votes @ ${CONFIG.voteRate}/s ` +
      `(${Math.ceil(CONFIG.voteTarget / CONFIG.voteRate)} batches)`,
  );
  console.log(
    `  read load  : ${CONFIG.readConcurrency} users x ${CONFIG.readRequestsPerUser} requests ` +
      `(total ${CONFIG.readConcurrency * CONFIG.readRequestsPerUser})`,
  );

  // ------------------------------------------------------------------
  // Phase 0 — Warmup & health
  // ------------------------------------------------------------------
  logPhase(`Phase 0 — Warmup & health (poll GET /api/public/status, max ${HEALTH_MAX_TRIES} tries)`);
  let healthy = false;
  for (let attempt = 1; attempt <= HEALTH_MAX_TRIES; attempt++) {
    const res = await request('GET', '/api/public/status');
    if (res.status === 200) {
      healthy = true;
      console.log(`  status endpoint healthy after ${attempt} attempt(s): ${JSON.stringify(res.body)}`);
      break;
    }
    console.log(
      `  attempt ${attempt}/${HEALTH_MAX_TRIES} failed (status=${res.status}${res.error ? `, ${res.error}` : ''}) — retrying in ${HEALTH_RETRY_MS}ms`,
    );
    await sleep(HEALTH_RETRY_MS);
  }
  if (!healthy) {
    throw new Error('Server never became healthy: GET /api/public/status did not return 200 in time.');
  }

  const rec0 = newRecorder('Phase 0 — warmup & health');
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    record(rec0, await request('GET', '/api/public/status'), 200);
  }
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    record(rec0, await request('GET', '/api/public/participants'), 200);
  }
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    // Throwaway device registrations — harmless, compiles the route.
    record(rec0, await request('POST', '/api/public/device', { json: { token: newToken() } }), 200);
  }
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    // Throwaway vote attempts: status may be 200/403/404/400 depending on the
    // current voting state — any outcome still JIT-compiles the route, and any
    // accidental 200 is wiped by the Phase 1 reset. Not counted as "matched".
    record(rec0, await request('POST', '/api/public/vote', { json: { participantId: 1, token: newToken() } }));
  }
  const warmLogin = await request('POST', '/api/admin/login', {
    json: { username: CONFIG.adminUsername, password: CONFIG.adminPassword },
  });
  record(rec0, warmLogin, 200);
  printSummary(rec0);
  finishPhase('0 warmup & health', rec0, healthy && warmLogin.status === 200);

  // ------------------------------------------------------------------
  // Phase 1 — Admin setup
  // ------------------------------------------------------------------
  logPhase('Phase 1 — Admin setup (login, reset votes, open voting, fetch participants)');
  const rec1 = newRecorder('Phase 1 — admin setup');
  const login = await request('POST', '/api/admin/login', {
    json: { username: CONFIG.adminUsername, password: CONFIG.adminPassword },
  });
  record(rec1, login, 200);
  adminCookie = extractSessionCookie(login);
  if (login.status !== 200 || !adminCookie) {
    throw new Error(
      `Admin login failed (status=${login.status}, body=${JSON.stringify(login.body)}) ` +
        `or no ${ADMIN_COOKIE_NAME} cookie was returned.`,
    );
  }

  const resetRes = await request('POST', '/api/admin/dev/reset-votes?full=1', { cookie: adminCookie });
  record(rec1, resetRes, 200);
  if (resetRes.status !== 200) {
    throw new Error(`reset-votes?full=1 failed (status=${resetRes.status}, body=${JSON.stringify(resetRes.body)}).`);
  }

  const openRes = await request('POST', '/api/admin/voting-status', {
    json: { action: 'open' },
    cookie: adminCookie,
  });
  record(rec1, openRes, 200);

  const statusRes = await request('GET', '/api/public/status');
  record(rec1, statusRes, 200);
  const isOpen =
    statusRes.status === 200 &&
    statusRes.body?.status === 'OPEN' &&
    statusRes.body?.closedPermanently === false;

  const participantsRes = await request('GET', '/api/public/participants');
  record(rec1, participantsRes, 200);
  const list = participantsRes.body?.participants;
  participantIds = (Array.isArray(list) ? list : [])
    .map((p) => p?.id)
    .filter((id) => Number.isFinite(id));

  console.log(`  participants: ${participantIds.length} (first id: ${participantIds[0] ?? 'n/a'})`);
  if (participantIds.length !== 29) {
    console.log(`  WARNING: expected 29 active participants, got ${participantIds.length}`);
  }

  const pass1 =
    resetRes.status === 200 &&
    openRes.status === 200 &&
    isOpen &&
    participantIds.length >= 1;
  printSummary(rec1);
  finishPhase('1 admin setup', rec1, pass1);
  if (!pass1) {
    throw new Error(
      'Phase 1 failed: voting could not be (re)opened or no participants were returned — aborting.',
    );
  }

  // ------------------------------------------------------------------
  // Phase 2 — Read load (concurrent users x sequential GETs)
  // ------------------------------------------------------------------
  logPhase(
    `Phase 2 — Read load: ${CONFIG.readConcurrency} concurrent users x ` +
      `${CONFIG.readRequestsPerUser} GET /api/public/participants ` +
      `(total ${CONFIG.readConcurrency * CONFIG.readRequestsPerUser})`,
  );
  const rec2 = newRecorder('Phase 2 — read load');
  await Promise.all(
    Array.from({ length: CONFIG.readConcurrency }, async () => {
      for (let i = 0; i < CONFIG.readRequestsPerUser; i++) {
        record(rec2, await request('GET', '/api/public/participants'), 200);
      }
    }),
  );
  printSummary(rec2);
  finishPhase('2 read load', rec2, rec2.total > 0 && rec2.matched === rec2.total);

  // ------------------------------------------------------------------
  // Phase 3 — Vote submission (VOTE_TARGET votes @ VOTE_RATE per second)
  // ------------------------------------------------------------------
  logPhase(
    `Phase 3 — Vote submission: ${CONFIG.voteTarget} unique tokens @ ${CONFIG.voteRate}/s ` +
      `(round-robin over ${participantIds.length} participants)`,
  );
  const rec3 = newRecorder('Phase 3 — vote submission');
  const tokens = Array.from({ length: CONFIG.voteTarget }, () => newToken());
  const usedTokens = []; // {token, participantId} in launch order (for Phase 4 replays)

  const batchCount = Math.ceil(CONFIG.voteTarget / CONFIG.voteRate);
  const batchPromises = [];
  const schedulerStart = performance.now(); // drift-corrected pacing reference
  for (let b = 0; b < batchCount; b++) {
    const size = Math.min(CONFIG.voteRate, CONFIG.voteTarget - b * CONFIG.voteRate);
    const due = schedulerStart + b * VOTE_BATCH_INTERVAL_MS;
    const waitMs = due - performance.now();
    if (waitMs > 0) await sleep(waitMs); // sleeps only the remainder -> no drift

    const batch = [];
    for (let i = 0; i < size; i++) {
      const idx = b * CONFIG.voteRate + i;
      const entry = { token: tokens[idx], participantId: participantIds[idx % participantIds.length] };
      batch.push(entry);
      usedTokens.push(entry);
    }
    batchPromises.push(
      Promise.all(
        batch.map(async (entry) => {
          record(rec3, await request('POST', '/api/public/vote', { json: entry }), 200);
        }),
      ),
    );
  }
  await Promise.all(batchPromises);

  votesAccepted = rec3.statuses['200'] ?? 0;
  printSummary(rec3);
  checkA =
    votesAccepted === CONFIG.voteTarget &&
    rec3.total === CONFIG.voteTarget &&
    rec3.networkErrors === 0;
  finishPhase(
    '3 vote submission',
    rec3,
    checkA,
    { votesAccepted },
  );

  // ------------------------------------------------------------------
  // Phase 4 — Duplicate rejection (replay used tokens, 100 + 100 concurrent)
  // ------------------------------------------------------------------
  logPhase(
    `Phase 4 — Duplicate rejection: replay ${DUPLICATE_WAVE_SIZE} + ${DUPLICATE_WAVE_SIZE} used tokens, ` +
      `${DUPLICATE_WAVE_SIZE} concurrent per wave (expect all 409 ALREADY_VOTED)`,
  );
  const rec4 = newRecorder('Phase 4 — duplicate rejection');
  const wave1 = usedTokens.slice(0, DUPLICATE_WAVE_SIZE);
  const wave2 = usedTokens.slice(DUPLICATE_WAVE_SIZE, DUPLICATE_WAVE_SIZE * 2);
  if (wave1.length < DUPLICATE_WAVE_SIZE || wave2.length < DUPLICATE_WAVE_SIZE) {
    console.log(
      `  WARNING: only ${usedTokens.length} used tokens available — waves shrank ` +
        `(${wave1.length} + ${wave2.length})`,
    );
  }
  const replay = (entry) => request('POST', '/api/public/vote', { json: entry });
  await Promise.all(wave1.map(async (entry) => record(rec4, await replay(entry), 409)));
  await Promise.all(wave2.map(async (entry) => record(rec4, await replay(entry), 409)));
  printSummary(rec4);
  const dupPass = rec4.total > 0 && rec4.matched === rec4.total && rec4.networkErrors === 0;
  finishPhase('4 duplicate rejection', rec4, dupPass);
  checkB = dupPass;

  // ------------------------------------------------------------------
  // Phase 5 — Same-device race (5 fresh tokens x 20 strictly concurrent votes)
  // ------------------------------------------------------------------
  logPhase(
    `Phase 5 — Same-device race: ${RACE_TOKENS} fresh tokens x ${RACE_FANOUT} concurrent votes ` +
      `(expect exactly one 200 per token; rejects must be 409 ALREADY_VOTED or 429 RATE_LIMITED)`,
  );
  const rec5 = newRecorder('Phase 5 — same-device race');
  let tokensWithExactlyOne = 0;
  for (let t = 0; t < RACE_TOKENS; t++) {
    const entry = { token: newToken(), participantId: participantIds[t % participantIds.length] };
    const results = await Promise.all(
      Array.from({ length: RACE_FANOUT }, () =>
        request('POST', '/api/public/vote', { json: entry }),
      ),
    );
    let ok = 0;
    let dup = 0;
    let other = 0;
    for (const r of results) {
      record(rec5, r);
      if (r.status === 200) ok++;
      // Both rejections are valid defense layers:
      //  409 ALREADY_VOTED — database UNIQUE constraint
      //  429 RATE_LIMITED  — per-token rate limiter (5/min) rejecting the flood
      else if (r.status === 409 || r.status === 429) dup++;
      else other++;
    }
    raceSuccesses += ok;
    raceRejects += dup;
    raceAnomalies += other;
    if (ok === 1 && other === 0) tokensWithExactlyOne++;
    console.log(
      `  token ${t + 1}/${RACE_TOKENS}: 200=${ok} 409/429=${dup} other=${other} ` +
        `${ok === 1 && other === 0 ? 'OK (exactly one vote accepted)' : 'UNEXPECTED'}`,
    );
  }
  // "matched" here = requests that belonged to tokens behaving exactly as expected.
  rec5.matched = tokensWithExactlyOne * RACE_FANOUT;
  printSummary(rec5);
  const racePass =
    tokensWithExactlyOne === RACE_TOKENS &&
    raceSuccesses === RACE_TOKENS &&
    raceAnomalies === 0;
  finishPhase('5 same-device race', rec5, racePass, { tokensWithExactlyOne });
  checkC = racePass;

  // ------------------------------------------------------------------
  // Phase 6 — Paused rejection (pause -> 100 fresh votes -> all 403 -> resume)
  // ------------------------------------------------------------------
  logPhase(
    `Phase 6 — Paused rejection: ${PAUSED_CLOSED_WAVE_SIZE} fresh-token votes while PAUSED ` +
      `(expect all 403 VOTING_PAUSED)`,
  );
  const rec6 = newRecorder('Phase 6 — paused rejection');
  const pauseRes = await request('POST', '/api/admin/voting-status', {
    json: { action: 'pause' },
    cookie: adminCookie,
  });
  record(rec6, pauseRes, 200);
  if (pauseRes.status !== 200) {
    console.log(`  WARNING: pause action returned ${pauseRes.status} (${JSON.stringify(pauseRes.body)})`);
  }
  const pausedVotes = await Promise.all(
    Array.from({ length: PAUSED_CLOSED_WAVE_SIZE }, (_, i) =>
      request('POST', '/api/public/vote', {
        json: { token: newToken(), participantId: participantIds[i % participantIds.length] },
      }),
    ),
  );
  let pausedMatched = 0;
  for (const r of pausedVotes) {
    record(rec6, r, 403);
    if (r.status === 403 && r.body?.error === 'VOTING_PAUSED') pausedMatched++;
  }
  const resumeRes = await request('POST', '/api/admin/voting-status', {
    json: { action: 'resume' },
    cookie: adminCookie,
  });
  record(rec6, resumeRes, 200);
  const pausedAllRejected =
    pausedVotes.length === PAUSED_CLOSED_WAVE_SIZE &&
    pausedVotes.every((r) => r.status === 403 && r.body?.error === 'VOTING_PAUSED');
  const pausedAdminOk = pauseRes.status === 200 && resumeRes.status === 200;
  printSummary(rec6);
  finishPhase('6 paused rejection', rec6, pausedAdminOk && pausedAllRejected, { pausedMatched });

  // ------------------------------------------------------------------
  // Phase 7 — Closed rejection (close -> 100 fresh votes -> all 403)
  // ------------------------------------------------------------------
  logPhase(
    `Phase 7 — Closed rejection: ${PAUSED_CLOSED_WAVE_SIZE} fresh-token votes while CLOSED ` +
      `(expect all 403 VOTING_CLOSED)`,
  );
  const rec7 = newRecorder('Phase 7 — closed rejection');
  const closeRes = await request('POST', '/api/admin/voting-status', {
    json: { action: 'close' },
    cookie: adminCookie,
  });
  record(rec7, closeRes, 200);
  if (closeRes.status !== 200) {
    console.log(`  WARNING: close action returned ${closeRes.status} (${JSON.stringify(closeRes.body)})`);
  }
  const closedVotes = await Promise.all(
    Array.from({ length: PAUSED_CLOSED_WAVE_SIZE }, (_, i) =>
      request('POST', '/api/public/vote', {
        json: { token: newToken(), participantId: participantIds[i % participantIds.length] },
      }),
    ),
  );
  let closedMatched = 0;
  for (const r of closedVotes) {
    record(rec7, r, 403);
    if (r.status === 403 && r.body?.error === 'VOTING_CLOSED') closedMatched++;
  }
  const closedAllRejected =
    closedVotes.length === PAUSED_CLOSED_WAVE_SIZE &&
    closedVotes.every((r) => r.status === 403 && r.body?.error === 'VOTING_CLOSED');
  printSummary(rec7);
  // Voting is intentionally left CLOSED — Phase 1's reset re-opens on next run.
  finishPhase('7 closed rejection', rec7, closeRes.status === 200 && closedAllRejected, {
    closedMatched,
  });
  checkD = pausedAdminOk && pausedAllRejected && closeRes.status === 200 && closedAllRejected;

  // ------------------------------------------------------------------
  // Phase 8 — Durability verification
  // ------------------------------------------------------------------
  logPhase(
    'Phase 8 — Durability verification: GET /api/admin/overview totalVotes must equal ' +
      'Phase 3 accepted + Phase 5 successes',
  );
  const rec8 = newRecorder('Phase 8 — durability verification');
  const overview = await request('GET', '/api/admin/overview', { cookie: adminCookie });
  record(rec8, overview, 200);
  expectedTotalVotes = votesAccepted + raceSuccesses;
  serverTotalVotes = overview.body ? Number(overview.body.totalVotes) : NaN;
  const results = Array.isArray(overview.body?.results) ? overview.body.results : [];
  top5Results = [...results]
    .sort((a, b) => (Number(b?.votes) || 0) - (Number(a?.votes) || 0))
    .slice(0, 5)
    .map((r) => ({ participantId: r.participantId, name: r.name, votes: r.votes }));

  console.log(
    `  expected totalVotes = ${expectedTotalVotes} (Phase 3 accepted ${votesAccepted} + race successes ${raceSuccesses})`,
  );
  console.log(`  server   totalVotes = ${Number.isFinite(serverTotalVotes) ? serverTotalVotes : 'n/a'}`);
  checkE =
    overview.status === 200 &&
    Number.isFinite(serverTotalVotes) &&
    serverTotalVotes === expectedTotalVotes;
  printSummary(rec8);
  finishPhase('8 durability verification', rec8, checkE);

  if (checkE) {
    console.log('  Top 5 participants by votes:');
    console.table(top5Results);
  }

  // ------------------------------------------------------------------
  // Final verdict
  // ------------------------------------------------------------------
  logPhase('Final — Verdict & summary');
  overallPass = checkA && checkB && checkC && checkD && checkE;

  console.log('  Checks:');
  console.log(
    `    (a) all Phase-3 votes accepted (${votesAccepted}/${CONFIG.voteTarget} got 200)         : ${checkA ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `    (b) all duplicate replays rejected 409 (${rec4.matched}/${rec4.total})                : ${checkB ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `    (c) race = exactly 1 success per token (${tokensWithExactlyOne}/${RACE_TOKENS})       : ${checkC ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `    (d) paused & closed waves all 403 (${pausedMatched}+${closedMatched}/${PAUSED_CLOSED_WAVE_SIZE * 2})    : ${checkD ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `    (e) durable total matches (${Number.isFinite(serverTotalVotes) ? serverTotalVotes : 'n/a'} == ${expectedTotalVotes})            : ${checkE ? 'PASS' : 'FAIL'}`,
  );
  console.log(`\n  OVERALL: ${overallPass ? 'PASS' : 'FAIL'}`);

  console.log('\n  Per-phase metrics:');
  console.table(
    PHASE_REPORTS.map((p) => ({
      Phase: p.name,
      Requests: p.total,
      '2xx': p.success2xx,
      Matched: p.matched,
      NetErr: p.networkErrors,
      RPS: p.rps.toFixed(1),
      'Mean ms': p.meanMs.toFixed(1),
      P50: p.p50Ms.toFixed(1),
      P95: p.p95Ms.toFixed(1),
      P99: p.p99Ms.toFixed(1),
      Max: p.maxMs.toFixed(1),
      Result: p.pass ? 'PASS' : 'FAIL',
    })),
  );

  writeMetricsFile();
  process.exitCode = overallPass ? 0 : 1;
}

main().catch((err) => {
  fatalError = String(err?.message ?? err);
  console.error(`\nFATAL: ${fatalError}`);
  writeMetricsFile();
  process.exitCode = 1;
});
