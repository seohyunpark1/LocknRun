# Lock&Run 🏃🔒

**Bet on your own run.** Lock a deposit on a running goal with friends. Everyone who finishes gets their deposit
back **plus** an equal share of the quitters' deposits. The money waits in escrow on Solana, and a voice coach
talks you through every kilometer.

Built for the University Blockchain Conference 2026 Hackathon.
**Main track:** Consumer Applications · **Chain award:** Best use of Solana · **Bounty:** ElevenLabs (voice coach)

---

## What did we build?

A commitment app for runners. You create or join a challenge such as **"3 km, 2 times this week, $10 deposit."**
Joining locks your $10 in an escrow wallet on Solana. You track runs in the browser with GPS while a voice coach
announces each kilometer and your pace. When time runs out, anyone taps **"Pay out the pot"** and the escrow pays every
finisher their deposit plus their share of the quitters' money, in USDC, in about a second.

## What problem does it solve?

Most people who start running quit within a few weeks. Motivation fades; **money on the line doesn't**. Research on
"commitment contracts" shows people stick to goals more when they've put money at stake, and apps like Challengers
(Korea) have shown it works at scale. But those apps hold your money in a black box and take a cut.

Lock&Run makes the pot **transparent and automatic**: every deposit and payout is a public Solana transaction, the
split follows fixed rules, and nobody (not even a friend who "forgets") can back out of paying.

## How does it work?

```
 Runner                     Lock&Run (Next.js API)                      Solana devnet
 ──────                     ──────────────────────                      ─────────────
 Create / Join ($10)  ──►  POST /api/challenges(/:id {join})  ──►  USDC: sponsor ──► ESCROW   memo "LockRun|join|<id>"
                                                                    (sponsor = stand-in for card / Apple Pay)
 Run (GPS + voice)   ──►  POST /api/challenges/:id {run}         validated: distance ≥ goal, human running pace
 Time's up: Pay out  ──►  POST /api/challenges/:id {settle}  ──►  USDC: ESCROW ──► each finisher   memo "LockRun|payout|<id>"

 Voice coach: GET /api/voice ──► ElevenLabs text-to-speech ("2 kilometers done. Pace: 5 minutes 40 per kilometer.")
```

### Rewards (`lib/settle.ts`), Challengers-style
Everyone locks the same deposit `D`. Your **achievement rate** is the share of required runs you completed.

| Achievement | You get back |
|---|---|
| **100%** | `D` + an equal share of the **prize pool** |
| **85–99%** | `D` (full deposit, no prize) |
| **Below 85%** | `D × rate` (e.g. 1 of 2 runs → 50% of `D`) |

**Prize pool** = everything the below-85% runners don't get back + any sponsor bonus, split equally among the
100% runners. If nobody reaches 100%, everyone gets `D` back and sponsors get their bonus back. Amounts are whole
cents, rounded down; leftover cents stay in escrow.

Example: 3 runners × $20 with a $75 sponsor bonus, 2 runs required. Maria 2/2, Daniel 1/2, Kevin 0/2 →
Daniel gets $10 back, Kevin $0, and Maria gets $20 + $30 + $75 = **$125**. Pot $135, all paid out.

### Badges
The earnings page awards badges: First 100%, Hot streak (3 perfect in a row), Perfect five, Sponsor-backed,
10K club and Marathoner (counted distance).

### Ads
Ad spots on the home page, challenge page and earnings page show real sponsors of live challenges (logo, name,
their own ad message, link), always labeled "Sponsored", rotating every few seconds. With no sponsors yet, the spot
advertises sponsoring a challenge. Sponsors write their ad message when they add a bonus.

### Sponsored challenges
Brands (a running store, a campus club) can add a **bonus** of $10, $25, $50 or $100 to any live challenge, with a
logo and an ad message. The bonus is locked in the same escrow (memo `LockRun|sponsor|<challenge>`), goes into the
prize pool for 100% runners, and is returned to the sponsor if nobody hits 100%. Sponsored challenges show a
"+$50 bonus · Sponsored by …" badge, are listed first, and the top sponsor's logo leads the payout pop-up.

### Proof: every run needs one
- **Photo proof (GPS runs):** after a GPS run, the runner adds a photo (a selfie at the finish or their watch screen).
  The photo is compressed in the browser, stored by the app, and shown on the leaderboard so everyone in the
  challenge can see it.
- **Strava proof:** runners can connect Strava and pick a run they recorded there. The server fetches that activity
  from Strava's API itself (the browser can't fake distance or time), checks that it happened after the runner joined
  and before the deadline, and that it hasn't been used before.
- **Stamped on Solana:** every run gets a memo transaction:
  `LockRun|run|<challenge>|<km>km|<seconds>s|photo:<SHA-256 of the photo>` or `...|strava:<activity id>`.
  Anyone can check that the proof shown in the app matches what was recorded on-chain at the time.

### What counts as a run
- Tracked with the browser's GPS (`watchPosition`, high accuracy). Points with accuracy worse than 35 m are ignored,
  standing-still jitter (< 3 m) is ignored, and jumps faster than ~29 km/h are dropped (GPS glitches or vehicles).
- The screen is kept awake with the Wake Lock API so tracking doesn't pause.
- The server only counts a run if it reaches the goal distance, the pace is between 2:30 and 20:00 per km,
  **and** it comes with proof (a photo or a Strava activity).
- Runs can only be logged before the deadline; payouts can only happen after it.

## How we use Solana

| What | How |
|---|---|
| **USDC (SPL token)** | Deposits and payouts are `transferChecked` transfers of Circle's devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| **Escrow wallet** | One wallet holds every live deposit. Its balance is shown on the home page with a "Verify on Solana" link |
| **SPL Memo program** | Each transfer is tagged `LockRun|join|<challenge>` or `LockRun|payout|<challenge>`, so every pot has a public receipt trail; each runner's deposit and payout receipts are linked on the leaderboard |
| **Associated Token Accounts** | Runner USDC accounts are created on first payout (`createAssociatedTokenAccountIdempotent`) |
| **Fee sponsorship** | A sponsor wallet pays every network fee, so runners never need SOL or a seed phrase |
| **Proof stamps** | Each run's proof fingerprint is written to Solana with a memo, creating a public, timestamped record |
| **Speed + low fees** | Paying out a pot to many runners costs fractions of a cent and settles in about a second |

**Program IDs used:** SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` · Associated Token Account
`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` · SPL Memo `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`

**Devnet addresses:** Escrow `<add your escrow address>` · Sponsor `<add your sponsor address>`

## How we use ElevenLabs

- **Text-to-Speech API** (`eleven_multilingual_v2`) is the **voice coach**: it announces the start, every kilometer
  with your current pace, when you hit your goal, and whether the run counted.
- It also announces payouts: "You did it! You got your 10 dollars back, plus 5 dollars from the people who quit."
- Runners don't look at their phones mid-run, so voice is the main interface while running.
- Route: `app/api/voice/route.ts`; client queue in `lib/client.ts`.

## Risk assumptions

- **Custodial escrow (hackathon version):** the escrow key is held by the Lock&Run server, which follows the published
  rules. All movements are public on Solana. **Next step:** an Anchor program with one PDA vault per challenge so the
  settlement rules are enforced on-chain.
- **Run verification:** browser GPS can be spoofed by a determined cheater. The pace and jump filters stop casual
  cheating (biking, driving), every GPS run needs a photo that the whole group can see, and Strava runs are checked
  directly with Strava. **Next step:** Garmin / Apple Health import and photo checks (location and time metadata).
- **On-ramp:** the sponsor wallet stands in for a card or Apple Pay payment.

## Creating a challenge

Distance, runs, deposit and "ends in" each have a timer-style dial (swipe or drag), and the big value next to each
label is typeable: tap it and type any number. Allowed ranges: 0.5–42.2 km per run, 1–30 runs, $1–$100 deposit,
and 5 minutes to 6 months (pick Min / Hour / Day / Week / Month, then the number). The server enforces the same ranges.

## Getting paid (My earnings page)

`/earnings` shows each runner's **balance** (their USDC, read live from Solana), what's been **paid out**, sponsor
bonuses earned (with the sponsor's logo), money **locked in live challenges**, and every payout with its receipt.

**Congratulations pop-up:** when a challenge pays out, the runner sees a full-screen "Congratulations, you earned $X"
card on whatever page they're on, led by the top sponsor's logo ("Presented by …"), with confetti, a breakdown (deposit back, quitters' share, sponsor bonus with the
sponsor's logo), "Paid out on Solana" with the receipt, and a "Spend it in the Shop" button. It shows once per challenge.

**Cash out:** runners can send their USDC to any Solana wallet (e.g. Phantom). The server builds the transfer and signs
only as the **fee payer** (so runners need no SOL); the runner's browser adds its own signature, so only the runner
can move their money. The server only submits transactions it built (fee payer + token/memo instructions, valid
signatures). Next step: cash out straight to a bank account through an off-ramp.

## Shop: spend what you won

Like Challengers' reward store, runners can spend their winnings inside the app (`/shop`, in the sidebar and the
phone tab bar):

- **Sponsor rewards:** shoe discounts, gift cards, energy gels, socks (demo brands: Peak Shoes, Austin Running Co.)
- **Lock&Run items:** a gold runner badge (shows a ★ next to your name) and a running cap

**How paying works:** the server builds a USDC transfer from the runner's wallet to the Lock&Run store wallet with a
memo `LockRun|shop|<orderId>`, signs only as fee payer, and remembers the exact transaction. The runner's browser
signs it with their own key. The server only accepts **that exact transaction** for that order, so a runner can't
change the price and nobody else can spend their money. The price always comes from the server's catalog
(`lib/shop.ts`). After payment the runner gets a **coupon code** (e.g. `ARC-4352-5419`), saved under **My rewards**
with the Solana receipt.

**Why it matters for the business:** sponsors don't just pay for logos. They sell products to runners right after
they've won, and that money goes back to the brands that funded the bonus. Lock&Run can take a cut of each sale.

## Sponsor and partner logos

- Sponsors can upload a PNG/JPG logo when they add a bonus. It is shrunk to 256 px in the browser and shown on the
  challenge card, the challenge banner, the Sponsors card and the Earnings page. (SVG uploads are refused for safety.)
- Partners (Solana, Circle, QuickNode, Strava) appear in a "Partners" card at the top of the home page, the
  "Powered by" strip, the sidebar and the payout pop-up. Each logo is the company's own site icon, loaded from its
  domain; drop official files into `public/partners/` for sharper logos (see the README there).

## Install it like an app

Lock&Run is an installable web app. Open the site on a phone and choose **Add to Home Screen** (Safari: Share button;
Chrome: ⋮ menu). It gets its own icon and opens full screen. The layout scales from small phones to desktops.

## What makes it unique?

- Money on the line, but **transparent**: anyone can verify the pot and every payout on Solana.
- **Quitters fund finishers**, so the more people quit, the more finishers earn.
- **Crypto is invisible:** type a name and run. No app, wallet setup, seed phrase or SOL.
- A **voice coach** built in, so it feels like a running app, not a crypto app.

## What would we build next?

- Anchor escrow program (PDA vault per challenge) and automatic payout at the deadline
- Garmin and Apple Health run import, and webhooks so Strava runs are added automatically
- Team challenges for running clubs and cross-country teams, with streaks and leaderboards
- Optional "quitters' money goes to charity" mode

---

## Run it locally

**You need:** Node.js 18+.

```bash
npm install
cp .env.example .env.local
npm run setup          # creates the sponsor + escrow wallets and prints what to do next
```

1. Paste the two `..._SECRET_KEY=` lines it prints into `.env.local`.
2. Fund the **sponsor** address with **devnet SOL** at https://faucet.solana.com (fees).
3. Fund the **sponsor** address with **devnet USDC** at https://faucet.circle.com (choose "Solana Devnet").
4. Optional: add `ELEVENLABS_API_KEY` for the ElevenLabs voice coach (otherwise the browser voice is used).

```bash
npm run dev
```

Open http://localhost:3000 in two browser windows (one normal, one private) with different names.

**Demo mode for presenting indoors:** add `?demo=1` to a challenge URL (for example `/c/abc123?demo=1`). A
"+250 m (demo mode)" button appears that adds 250 m at a 6:00/km pace, so you can show a full run on stage.
Remove it with `?demo=0`. Use a **15 min** challenge so you can show the payout during the demo.

## Deploy to Vercel

1. Go to https://vercel.com/new and import this GitHub repo (or run `npx vercel` inside the project folder).
2. **Environment variables** (Project → Settings → Environment Variables): add `SPONSOR_SECRET_KEY`,
   `ESCROW_SECRET_KEY`, and optionally `ELEVENLABS_API_KEY` and `NEXT_PUBLIC_SOLANA_RPC` (a QuickNode devnet URL is
   faster than the public one).
3. **Storage:** Project → Storage → create **Upstash for Redis** (free) and connect it to the project. This adds
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which Lock&Run uses to save challenges. Without it, challenges won't persist on Vercel.
4. **Optional, Strava:** create an app at https://www.strava.com/settings/api, set its *Authorization Callback Domain*
   to your Vercel domain (for example `locknrun.vercel.app`), and add `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`.
   Note: new Strava apps start in "single player mode" (only your own Strava account can connect) until you upgrade
   the app's capacity in Strava's API settings.
5. Redeploy. Your phone can now track runs with GPS, because Vercel serves the app over HTTPS.

**Storage:** on Vercel, challenges are saved in Upstash Redis. Locally they're saved in `data/challenges.json`.
Money and receipts always live on Solana.

## Project structure

```
app/page.tsx                    Home: live challenges, create form, escrow balance
app/c/[id]/page.tsx             Challenge: join, run tracker, leaderboard, payout
components/RunTracker.tsx       GPS run tracking, voice coach, photo proof
components/StravaImport.tsx     Connect Strava and import runs
lib/strava.ts                   Strava OAuth + activities (server)
app/api/strava/*                Strava connect / callback / status / runs
app/api/photos/[runId]          Serves run photos
app/earnings/page.tsx           My earnings: balance, payouts, cash out
app/api/wallet/route.ts         Balance + cash-out (prepare / submit)
app/shop/page.tsx               Shop: rewards to buy with winnings, My rewards (codes)
app/api/shop/route.ts           Shop catalog, orders, payment (prepare / submit)
lib/shop.ts                     Shop items and prices
app/api/sponsor-logo/...        Serves sponsor logos
components/AppShell.tsx         Web sidebar / phone top bar + tab bar
components/SponsorBox.tsx       Sponsor a challenge (bonus + logo)
public/manifest.webmanifest     Install-to-home-screen settings + icons
app/api/challenges/route.ts     List + create (locks the creator's deposit)
app/api/challenges/[id]/route.ts Join (lock deposit) / log run / settle (pay out)
app/api/voice/route.ts          ElevenLabs text-to-speech
lib/settle.ts                   Pot-splitting rules
lib/solana-server.ts            Escrow transfers on Solana
lib/store.ts                    Challenge storage (Upstash Redis on Vercel, JSON file locally)
scripts/setup-wallets.mjs       Creates the sponsor + escrow wallets
```
