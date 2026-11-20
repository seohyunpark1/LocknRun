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

### Settlement rules (`lib/settle.ts`)
Everyone locks the same deposit `D`. With `F` finishers and `Q` quitters:
- **Finishers** receive `D + (Q × D) / F` (rounded down to the cent).
- **Quitters** receive nothing; their deposits fund the finishers.
- **If nobody finishes,** everyone is refunded `D`.

Example: 3 runners × $10. Two finish, one quits → each finisher gets **$15** ($10 back + $5 from the quitter).

### What counts as a run
- Tracked with the browser's GPS (`watchPosition`, high accuracy). Points with accuracy worse than 35 m are ignored,
  standing-still jitter (< 3 m) is ignored, and jumps faster than ~29 km/h are dropped (GPS glitches or vehicles).
- The screen is kept awake with the Wake Lock API so tracking doesn't pause.
- The server only counts a run if it reaches the goal distance **and** the pace is between 2:30 and 20:00 per km.
- Runs can only be logged before the deadline; payouts can only happen after it.

## How we use Solana

| What | How |
|---|---|
| **USDC (SPL token)** | Deposits and payouts are `transferChecked` transfers of Circle's devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` |
| **Escrow wallet** | One wallet holds every live deposit. Its balance is shown on the home page with a "Verify on Solana" link |
| **SPL Memo program** | Each transfer is tagged `LockRun|join|<challenge>` or `LockRun|payout|<challenge>`, so every pot has a public receipt trail; each runner's deposit and payout receipts are linked on the leaderboard |
| **Associated Token Accounts** | Runner USDC accounts are created on first payout (`createAssociatedTokenAccountIdempotent`) |
| **Fee sponsorship** | A sponsor wallet pays every network fee, so runners never need SOL or a seed phrase |
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
  cheating (biking, driving). **Next step:** verify runs through Strava / Garmin / Apple Health APIs.
- **On-ramp:** the sponsor wallet stands in for a card or Apple Pay payment.

## What makes it unique?

- Money on the line, but **transparent**: anyone can verify the pot and every payout on Solana.
- **Quitters fund finishers**, so the more people quit, the more finishers earn.
- **Crypto is invisible:** type a name and run. No app, wallet setup, seed phrase or SOL.
- A **voice coach** built in, so it feels like a running app, not a crypto app.

## What would we build next?

- Anchor escrow program (PDA vault per challenge) and automatic payout at the deadline
- Strava / Garmin / Apple Health run verification
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

**Testing GPS for real:** your phone needs HTTPS for location. Deploy to Render or Railway, or run
`npx localtunnel --port 3000` and open the link on your phone.

**Storage:** challenges are saved in `data/challenges.json` (money and receipts live on Solana). On Vercel the file
lives in `/tmp` and can reset, so use Render/Railway or your laptop for the live demo.

## Project structure

```
app/page.tsx                    Home: live challenges, create form, escrow balance
app/c/[id]/page.tsx             Challenge: join, run tracker, leaderboard, payout
components/RunTracker.tsx       GPS run tracking + voice coach
app/api/challenges/route.ts     List + create (locks the creator's deposit)
app/api/challenges/[id]/route.ts Join (lock deposit) / log run / settle (pay out)
app/api/voice/route.ts          ElevenLabs text-to-speech
lib/settle.ts                   Pot-splitting rules
lib/solana-server.ts            Escrow transfers on Solana
lib/store.ts                    Challenge storage (JSON file)
scripts/setup-wallets.mjs       Creates the sponsor + escrow wallets
```
