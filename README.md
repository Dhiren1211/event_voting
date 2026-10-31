# Nepal Grand Tihar Festival 2026 — Audience Voting System

A production-oriented audience voting system for the **Nepal Grand Tihar Festival 2026** talent show, organized by the **Nepalese Community in Busan (NCB)**.

- **Public voting page** (`/`) — mobile-first, opened by scanning a QR code. No app install, no registration.
- **Admin dashboard** (`/admin`) — protected, private results, voting control, participant & photo management, CSV export, audit log, QR generation.

---

## 1. Event

| | |
|---|---|
| Event | Nepal Grand Tihar Festival 2026 |
| Organizer | Nepalese Community in Busan (NCB) |
| Date | November 9, 2026 |
| Time | 4:00 PM – 9:00 PM |
| Venue | Pukyong National University, Daeyeon Campus, University Theater (D21), South Korea |

## 2. Technology stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16 (App Router) + TypeScript** | Single deployable unit: public UI, admin UI, and API routes. |
| Database | **SQLite (WAL) via Prisma ORM** | Zero-ops, durable transactional writes. With WAL + `synchronous=NORMAL` + a single serialized connection, the vote path handles the target load (see §7). |
| UI | **Tailwind CSS 4 + shadcn/ui + sonner** | Clean, professional, neutral design (no festival decoration). |
| Auth | DB-backed sessions, scrypt password hashing, HttpOnly cookies | No external auth service needed; sessions are revocable. |
| Images | **sharp** (optimize → WebP) served via `/api/media/*` | Actual participant photos uploaded by admins; never AI-generated. |
| QR | **qrcode** (PNG 2048px + SVG, error correction H) | High-resolution, print-ready. |
| Load testing | Zero-dependency Node script (`scripts/load-test.mjs`) | Real measured numbers, not claims. |

## 3. Quick start

```bash
# 1. Install dependencies
bun install        # or npm install

# 2. Configure environment
cp .env.example .env
#    → set ADMIN_USERNAME / ADMIN_PASSWORD (required for admin login)
#    → DATABASE_URL points at the SQLite file (default: db/custom.db)

# 3. Create the database schema
bun run db:push

# 4. Seed the 29 official participants (extracted from the official sheet)
bun run scripts/seed.ts          # add --force to reseed (only when no votes exist)

# 5. Start the dev server
bun run dev                      # http://localhost:3000
```

- Public voting page: `http://localhost:3000/`
- Admin dashboard: `http://localhost:3000/admin`

**Admin login:** the admin account is bootstrapped from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` on the first login attempt. Change the password before any real deployment.

## 4. Participant data source

All 29 participants were extracted **verbatim** from the official participant sheet image (`upload/festiv.jpg`) — original spelling, order, grouping, and affiliations preserved:

| Category | Count |
|---|---:|
| Singing | 5 |
| Dance | 7 |
| Rap | 1 |
| Beatboxing | 1 |
| Instrumental | 1 |
| Other cultural performances | 14 |
| **Total** | **29** |

Notes:
- Entries whose affiliation cell showed "—" are stored with an empty affiliation (nothing was invented).
- "Dong & Band" appears **twice** in the official sheet (Group Live Singing under SINGING, and Band Performance under Other Cultural Performances) — they are intentionally kept as two separate votable entries, exactly as the sheet lists them.
- Abbreviations (KSU, BIST, TU, BUFS, "Hukum Bdr") are preserved as printed.
- Every participant can be flagged **"Needs verification"** in the admin panel, with a review note, so organizers can correct any OCR ambiguity after checking the original sheet.

## 5. How voting works

1. Visitor scans the QR code → lands on `/` → the app generates a **cryptographically secure device token** (256-bit, `crypto.randomBytes`) and stores it in `localStorage`.
2. The visitor picks **one** participant, confirms in a dialog, and the app POSTs to `/api/public/vote` with `{ participantId, token }`.
3. The server:
   - rate-limits per token (5/min) and per IP (generous — venue NAT);
   - checks the event-wide voting status (cached 2 s, then re-verified fresh);
   - validates the participant exists and is active;
   - **INSERTs the vote** — the UNIQUE index on `votes.deviceTokenHash` (SHA-256 of the token; the raw token never touches the database) makes duplicate votes impossible **at the database level**, even for simultaneous requests;
   - re-checks voting status after the insert and rolls back if the organizer closed/paused in the milliseconds in between;
   - returns success **only after the row is durably committed**.
4. The device can never vote again — enforced by the database, independent of the frontend.

**Honest limitation:** device tokens are not verified human identity. If a visitor clears browser storage or opens a different browser, they can obtain a new token. This is inherent to QR-based anonymous audience voting without personal identification; the token mechanism raises the bar (no accidental double-votes, no casual duplicates) but cannot stop a determined actor with unlimited browsers. Results privacy does not depend on this: vote counts are never exposed publicly.

## 6. Admin dashboard (`/admin`)

| Tab | Capabilities |
|---|---|
| **Overview** | Total valid votes, votes/min, last vote time, open/pause/resume/**close permanently** controls, private top-5 standing, CSV export buttons. Auto-refreshes every 4 s. |
| **Participants** | Full list with photos, vote counts, visibility switch, reorder (matches official sheet order), edit (all fields incl. members/affiliation/verification flags), add, delete (blocked when votes exist — deactivate instead), photo upload/replace/delete with preview. |
| **Results** | Full private ranking with vote counts and percentages. **Never exposed through any public API.** |
| **QR Code** | Live preview, editable target URL (regenerate when the deployment URL changes), PNG 2048 px and SVG vector download, printing tips. |
| **Audit Log** | Every admin action: logins (success/failure), voting transitions, participant edits, photo uploads, exports, resets — with timestamps, actor, details, hashed IP. |

## 7. Performance — actual measured results

Environment: this sandbox's **dev server** (`next dev`, Turbopack, JIT compilation, single process) — production builds are faster. Load test: `scripts/load-test.mjs` (zero-dependency Node), all requests over loopback.

**Verdict: OVERALL PASS — all 5 integrity checks green.**

| Phase | Requests | Result | RPS | p50 | p95 | p99 |
|---|---:|---|---:|---:|---:|---:|
| 0 Warmup & health | 21 | PASS | 60 | 8 ms | 29 ms | 150 ms |
| 1 Admin setup | 5 | PASS | 176 | 8 ms | 79 ms | 79 ms |
| 2 Read load — 500 concurrent users × 3 req | 1500 | **1500/1500 OK, 0 errors** | 247 | 1970 ms | 2597 ms | 2800 ms |
| 3 Vote submission — 1000 unique devices @ 100/s | 1000 | **1000/1000 accepted (200)** | **107.3** | 624 ms | 954 ms | 970 ms |
| 4 Duplicate replays | 200 | **200/200 rejected (409)** | 234 | 544 ms | 679 ms | 691 ms |
| 5 Same-device race — 5 tokens × 20 concurrent | 100 | **exactly 5×200 (1/token) + 95 rejected (409/429)** | 243 | 66 ms | 113 ms | 119 ms |
| 6 Paused rejection | 100 | **100/100 rejected (403)** | 147 | 525 ms | 664 ms | 677 ms |
| 7 Closed rejection | 100 | **100/100 rejected (403)** | 251 | 248 ms | 383 ms | 395 ms |
| 8 Durability | — | **server totalVotes 1005 == expected 1005** | — | — | — | — |

Interpretation against the stated targets:

- ✅ **500 concurrent users** — 1500/1500 read requests succeeded with zero errors. Latency is high (p50 ≈ 2 s) because this is a JIT-compiling dev server queueing 500 simultaneous requests; a production build will be materially faster.
- ✅ **100 votes/s sustained for 10 s** — measured **107.3 valid votes/s** (1000 votes in ≈ 9.3 s), every one durably committed before its 200 response.
- ✅ **1000 durable votes within 10 seconds** — Phase 8 verified the database contained exactly the acknowledged votes (1005 = 1000 + 5 race votes). **No acknowledged vote was lost, no unacknowledged vote appeared.**
- ✅ **Exactly one vote per device** — under 20-way concurrent same-token races, each token produced exactly one accepted vote; duplicates were stopped by the rate limiter (429) and the DB unique constraint (409).
- ✅ **Paused/closed enforcement** — 200/200 fresh-token submissions rejected with 403.

Infrastructure caveats (disclosed):
- SQLite is single-writer. The measured 107 votes/s comfortably covers the 100/s target on this machine, but a different host's disk (network filesystems, some containers) can be slower. For deployments expecting far higher peaks, Postgres is a drop-in schema change away.
- These numbers are from a dev-mode Next.js server. A production build (`next build && next start`) removes per-request JIT overhead and will improve both read latency and throughput.
- All load is loopback; real-world mobile network latency (not measured here) dominates the user-perceived experience and is out of the application's control.

## 8. Security measures

- **Vote integrity:** UNIQUE DB index on `deviceTokenHash` (SHA-256); tokens generated server-side with `crypto.randomBytes(32)`; raw tokens never stored; per-token + per-IP rate limits; compensating post-insert status re-check.
- **Authorization:** every `/api/admin/*` route validates the session cookie against the DB server-side (the UI check is cosmetic only). Public API exposes **no** vote counts, rankings, or audit data.
- **Admin auth:** scrypt-hashed passwords with per-password salt; timing-safe comparison; uniform 401 (no user enumeration); 10 failed logins/min/IP → 429; DB-backed sessions (24 h) with hashed session ids; HttpOnly + SameSite=Lax cookies (+ Secure behind HTTPS proxy).
- **Input validation:** zod schemas on all admin mutations; strict token format validation; QR URL restricted to http/https (no `javascript:`/`data:`).
- **Uploads:** MIME whitelist (JPEG/PNG/WebP), size cap (5 MB), sharp re-encoding (strips EXIF/payloads), randomized filenames, served via a whitelisting media route — path traversal returns 404.
- **Referential integrity:** votes reference participants with `onDelete: Restrict`; participants with votes cannot be deleted (deactivate instead) so vote history can never be orphaned or silently destroyed.
- **Audit trail:** all admin actions logged with actor, details, hashed IP.
- **Privacy:** no PII stored (IPs hashed, UA truncated); no public results.

## 9. Deployment

1. Provision a Node 20+ host. Set the env vars from `.env.example` — **change `ADMIN_PASSWORD`**.
2. `npm install && npx prisma db push && npx prisma generate`
3. Build & start: `npm run build && npm start` (or any Next.js-compatible host; the app uses no serverless-incompatible features, but SQLite requires a **persistent filesystem** — not read-only/ephemeral serverless).
4. Uploads: set `UPLOAD_DIR` to a persistent directory. (For multi-instance deployments, replace SQLite with Postgres and local uploads with object storage — S3/R2 — as noted in §7.)
5. Open `/admin`, sign in, **open voting**, then open the **QR Code** tab, set the public URL to the deployed domain, and print the QR code.
6. After the event: pause/close voting, export CSVs (results + raw votes) from the dashboard.

## 10. Testing checklist (verified in-browser + API)

**Functional** — public page loads; 29 participants in official order; search & category filters; photo upload → public display; admin CRUD/reorder/deactivate; open→pause→resume→close-permanently flow; one-vote-per-device confirmation screen; CSV export (results & raw votes); QR preview + PNG/SVG download. ✅

**Security** — unauthenticated admin access → 401; public APIs expose no counts; duplicate votes → 409; invalid participant → 404; invalid/malformed input → 400; votes after pause/close → 403; `.gif` upload → 415; `javascript:` QR URL → 400; path traversal → 404; delete-with-votes → 409; login brute-force → 429 then recovery. ✅

**Performance** — see §7. ✅

## 11. Known limitations

- Device tokens ≠ verified identity (inherent to anonymous audience voting; see §5).
- SQLite single-writer: measured 107 votes/s on this host — sufficient for the stated target, but not horizontally scalable; use Postgres for multi-instance deployments.
- In-memory rate limiting/caching is per-process — correct for the intended single-instance deployment.
- The dev server (used for the measured results) is slower than a production build; production numbers will be better.
- Load-test artifacts live in `scripts/` (`load-test.mjs`, `load-test-results.json`); the admin **Reset votes** endpoint (`POST /api/admin/dev/reset-votes`) exists to clear test data before the real event and is admin-only + audit-logged.
