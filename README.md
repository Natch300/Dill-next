# Dill Next

A web-based pickleball community prototype using HTML, CSS and vanilla JavaScript. Visitors meet the platform, become players, and can simulate buying a Club Owner Pass to create and run their own club. Club membership and one-day Open Play are separate flows.

## Run locally on Windows

Open this folder in VS Code and run:

```powershell
npm install
npm run build
npm start
```

Open **http://localhost:5173**. Node.js 22 or newer is required. The public website is the entry page; **Try the sample clubhouse** opens a separate example with three courts and 24 sample players.

No React, Next.js or application server is required. The requested `@supabase/supabase-js` and `@supabase/ssr` are installed; this static frontend uses the former for Auth, RPC and Realtime. The SSR package is available but unused.

## Try the complete prototype

1. Select **Get started**. Answer where you heard about the site, your level and what brings you here.
2. Create a **player account** using a test name and email. The local prototype has no password or real authentication. Identity is saved per tab; prototype records are shared by tabs in the same browser and origin.
3. Select **Get a Club Owner Pass**, confirm the simulated purchase, and create a club with its name, optional logo, tagline and 1-8 courts. The pass costs zero and collects no card or real money. One pass creates one club; a player may own multiple clubs.
4. From **Club & members**, generate a **membership invitation**. Open it in another tab, create/sign in as a different player, and **Request to join**. The player stays pending and cannot enter the club until the owner approves.
5. The owner can approve/decline requests, remove members, or promote an approved member to **vice club owner**. Vice owners manage courts, queues, games and invitations. Only the owner approves membership and appoints administrators. Membership fees are handled outside this prototype.
6. Open **Manage courts & games > Check-in QR** and generate an **Open Play** link. Open it in another tab and enter a visitor name, level and optional partner. No regular account is needed; this does not create club membership.
7. In **Open Play > Queue**, select two waiting solos and choose **Pair selected solos**, or select a complete group and **Call selected group**. Pairs stay together. **Call next** follows eligible waiting order; it does not randomize players. Owners can separate waiting pairs. Pairing two solos uses the later arrival time for their joint place.

Local prototype invitations work only where the same browser storage exists. A phone or another browser needs live Supabase mode. Local storage is for role-playing, not authorization. Refreshing keeps saved clubs/games; a new tab can use a different prototype identity.

## Manual Supabase setup

The supplied URL and publishable key are configured in `config.js` and ignored `.env.local`. **No remote database changes have been made. You apply the SQL yourself.**

1. Open the [project SQL Editor](https://supabase.com/dashboard/project/uttznnrxtbdwmgzxmgzs/sql/new).
2. Run **`supabase/migrations/001_club.sql`** once, then **`supabase/migrations/002_player_platform.sql`** once. If 001 is already applied, run only 002. These are ordered, transactional migrations, not rerun scripts. Migration 002 adds profiles, owner passes, multi-club roles, membership approvals and separate member/day-player operations.
3. Enable **Email** authentication and new account signup. If email confirmation is enabled, the website instructs the player to confirm their address before signing in.
4. Enable **anonymous sign-ins** for day visitors and read-only displays. This creates a background session without asking for an email, password or regular player account.
5. Set the Auth **Site URL** to your deployed HTTPS origin and allow the local/deployed signup redirect URLs, including `http://localhost:5173/**` for development. Account confirmation returns to the live dashboard.
6. Verify the `supabase_realtime` publication includes **`club_revisions`**. Migration 001 adds it automatically. Clubhouse screens subscribe to revisions and refresh authorized data; the player dashboard also refreshes periodically.
7. Open **http://localhost:5173/?live=1**, create a player account, confirm your email if required, and complete the same simulated pass and club setup journey. The app creates the club and owner membership automatically. No manual organizer row or seed is needed for new clubs.

**Optional legacy sample:** `supabase/seed.sql` creates the fixed empty example club; `supabase/demo-seed.sql` adds sample records only if it is empty. Neither is needed for the new platform flow or grants account access automatically. Use the new account/pass/create-club flow for simpler setup. The local sample needs no SQL.

The live purchase is still a **zero-price simulation**. It uses real Auth and database permissions but has no payment processor. Future paid subscriptions would need server-side payment verification before granting an entitlement.

### Another Supabase project

Copy `config.example.js` to `config.js` and update its URL and publishable key. Source mode reads that file. For deployment builds, use `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

`npm run build` exports only these two environment values into `dist/config.js`. These requested names do not require Next.js. Never put a service-role key, database password or private token in browser configuration.

## Court-side workflows

- **Open Play:** Add a player, or expand “Use an existing player.” Choose singles/doubles and mixed/same-skill matching in Settings. Partner check-ins keep the pair intact. Call next uses the longest-waiting eligible players and a free shared court. Called players can confirm readiness; organizers can mark ready, cancel a call, or mark a no-show. Pause preserves arrival time. A no-show pauses that entry and restores the others to their previous places. Wait estimates appear after three completed timed games.
- **Tournament:** Create an event, pick division/format/target/margin, optionally set dates and times in Asia/Manila, register up to 24 entrants, then Generate matches. Singles need one player; doubles need two distinct players. Registration order seeds elimination brackets. Byes advance automatically. Double elimination includes lower rounds and a conditional reset final. A six-entrant round robin creates 15 games; odd entrant counts sit out one rotation. Pool formats use balanced snake seeding, 2–6 pools, at least three entrants per pool. Pool + playoffs advances 1–3 per pool after all pool results are final.
- **Ranking:** Pool/round-robin standings use wins, point difference, then points scored, with registration order as the final tie-break. Playoff qualification uses those pool ranks. Qualifiers are then ordered by pool finish, win rate, point difference/game, points/game, and registration seed. Playoff results never enter pool standings.
- **Corrections:** Edit a completed tournament score. If its dependent matches have a court or result, release the court or clear those later results first, working backward from the final. Pool corrections regenerate an unstarted playoff bracket. Completed/assigned downstream matches are never silently overwritten.
- **Social Mixer:** Register players individually. Start round uses free courts and prioritizes fewer games, then recent sit-outs. The chosen four-player groups use the least-repeated partner pairing among their three possible pairings. This reduces repeats but is not a global tournament optimizer. Finish all current mixer games before starting the next round. Pause/resume between matches.
- **Challenge:** Register pairs and Start challenge. A winner stays to face the next eligible waiting pair; the loser joins the back. At the configured 1–5 win limit (default 2), both active pairs return to the queue and the court is released. A release action returns active pairs to their queue.
- **Scoring:** Choose first serving side and each doubles side's starting right player. The two rally buttons stay in fixed positions. Doubles starts 0–0–2; singles starts 0–0. Only the serving side scores. Receiving-side rally wins change server or side out. Undo restores the entire previous scoring state. A game to 11 win-by-two continues at 11–10 and finishes at 12–10. Save result is explicit. Final-score entry uses large steppers and validates the first winning endpoint. Noncompetitive Open Play and mixer games can finish unscored.

The court inventory is shared across modes. Players cannot occupy two courts simultaneously. An idle court can close/reopen; occupied courts must be released before removal. A whole-club revision guards every organizer mutation, intentionally favoring correctness over maximum concurrent write throughput for a 1–8 court club. A conflicting action reloads current state and asks the scorer to review and retry; it is never silently reapplied.

## Membership QR versus Open Play QR

| Link | Account | Result | Expiry |
| --- | --- | --- | --- |
| Membership invitation | Regular player account | Pending request; owner approval required | 7 days or owner revocation |
| Open Play check-in | Background anonymous session in live mode | Day visitor in the queue; no membership | 12 hours, session change or revocation |
| Court display | Background anonymous session in live mode | Read-only court board | 12 hours, session change or revocation |

QR images are generated locally; tokens are not sent to an external QR service. Live database invitations store token hashes. Guests manage their check-in entry and readiness; they cannot score, change settings or assign courts. A partner registered on the same device belongs to that check-in. Separate visitors can check in independently and ask the owner to pair them; each still confirms their own readiness.

Deploy to HTTPS to use live links on phones and TVs. A localhost QR points back to the scanning device, so it is useful only when opened on the computer serving the app. Clubhouse Realtime reconnects and refreshes on visibility/online changes, with a 15-second refresh backstop. Offline writes are not replayed.

## Data and permissions

The platform stores profiles, zero-price pass entitlements, clubs, club-scoped memberships, invitations and pending requests. Game state is a versioned transaction aggregate. Normalized court/player/match projections and unique constraints prevent double booking. RLS is enabled on exposed tables; clients cannot directly write them.

Platform RPCs check account type and club role. Passes are single-use and cannot be consumed by another user. Invitations never grant membership directly. Owner and vice-owner permissions are enforced in SQL. Member and guest play RPCs accept narrow commands and derive identity from Auth. Public boards omit audits, invites, archived events and scoring undo history.

Each small club uses one aggregate and one active session. Larger deployments would need transaction partitioning, pagination and history archival. Local storage simulates the journey; only live mode has database-enforced authorization.

## Validation

```powershell
npm test
npm run test:db
# Keep npm start running in another terminal:
npx playwright install chromium
npm run test:browser
npm run test:platform
npm run build
```

- Rules tests cover scoring, brackets, queue/partner behavior, shared court conflicts, pass ownership and membership roles.
- Database checks execute **both actual migrations** in PostgreSQL via PGlite with simulated Supabase Auth roles. They test unauthorized access, stale versions, double booking, invitation isolation, pending access, owner/vice privileges, visitors and revocation. They do not change or verify the hosted database.
- Browser checks cover the clubhouse and full public-site/player/owner/approved-member/visitor journeys, manual pairing, cross-tab updates, keyboard controls, saved forms and responsive widths from 320 px to desktop. Screenshots and summaries are in ignored `test-results/`.

After applying SQL and deploying, verify email confirmation, approval, a guest QR on another device, Realtime scoring and simultaneous organizer saves against the hosted project. These external services are not confirmed by local tests.

## Deploy

Run `npm run build`, then publish **only `dist/`** to your HTTPS static host. Build command: `npm run build`; output directory: `dist`. No route rewrites are needed because navigation uses hash routes. SQL, tests, server scripts and environment files are excluded. Browser dependencies and fonts are bundled locally.

The root website opens in prototype mode. Use **`/?live=1`** for real Supabase accounts; live links retain that mode. Nothing has been published automatically.

## File map

| File | Purpose |
| --- | --- |
| `index.html`, `portal.css`, `js/portal.js` | Public site, onboarding, accounts, pass, club setup and member management |
| `js/platform-domain.js`, `js/platform-store.js` | Platform rules, persistence and live Auth/RPC |
| `club.html`, `styles.css`, `js/app.js` | Clubhouse, modes, scoreboard and manual stack |
| `js/club-store.js` | Club access, guest/member actions, persistence, Realtime and conflicts |
| `js/engine.js`, `js/scoring.js`, `js/tournament.js` | Queue, court, scoring and tournament logic |
| `js/components.js` | Accessible pickers, calendar/time and accent controls |
| `js/demo.js` | Separate sample clubhouse records |
| `supabase/migrations/001_club.sql` | Base club schema, RLS, state transactions and day links |
| `supabase/migrations/002_player_platform.sql` | Profiles, owner passes, club roles, membership approval and member play |
| `scripts/`, `tests/` | Local server, build, seed generation and verification |

Design applies the installed UI/UX Pro Max and Apple Design skills to the requested green/lime identity. Barlow Condensed and DM Sans licenses are in `assets/`. The public story explains the platform's purpose without inventing a founding date or club history.

Auth setup references: [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) and [redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls).
