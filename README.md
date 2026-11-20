# Lock&Run

**Lock your stake. Run with friends. Finish the challenge and share the rewards.**

Next.js running challenge prototype on **Solana Devnet**, using **test USDC**. The planning specification is preserved in [LocknRun_Basic_Structure.md](LocknRun_Basic_Structure.md). It describes the intended MVP; the comparison below records what this repository actually implements.

## Wallet deposits and rewards

1. Open the site with a Wallet Standard compatible Solana wallet, such as Phantom or Solflare. On mobile, use the wallet's in-app browser. A regular mobile browser without an exposed wallet will show installation/open-in-wallet guidance.
2. Choose a runner name and wallet. Sign a single-use, origin-bound message to prove wallet ownership. The backend issues a 24-hour HttpOnly session cookie; routine check-ins do not need wallet signatures.
3. Fund the wallet with test USDC and a little devnet SOL. Select a challenge and review the deposit amount, mint, escrow recipient, payout address and network. The deposit is simulated before signing.
4. Approve the transaction in the external wallet. The **participant's wallet supplies the USDC and pays the deposit's network fee and any escrow token account creation rent**. Private keys remain in the external wallet.
5. The server checks the complete signed message and signatures, broadcasts that exact transaction, and registers participation only after confirmation. Draft challenges and unconfirmed deposits are excluded from the funded pool.
6. After the existing challenge deadline, settlement transfers rewards/refunds to the **same address recorded with the confirmed deposit**. Connecting a different wallet does not change previous payout destinations. Payout fees remain sponsored by the configured server wallet.

If confirmation is interrupted, use **Retry deposit confirmation**. The browser retains the signed transaction in this tab's session storage and retries it without a second wallet payment. Deposit and payout signatures are persisted before broadcast. Ambiguous/expired transactions require reconciliation; the backend never automatically signs a replacement payout. Pending deposits block settlement until reconciled. Keep the tab until confirmation completes.

The account/address shown in the header identifies the receiving wallet. Disconnecting removes the browser session cookie. Reconnecting requires ownership verification again. Previous automatically generated demo wallets are no longer used, and their localStorage secret is removed.

## Currency display

Show **`$10 USDC`** for stakes, pools and rewards, and **SOL separately for network fees**. This is a USDC amount, not a live SOL/USD conversion or a guaranteed cash redemption quote. Devnet tokens have no monetary value. If SOL staking is added later, store the SOL amount as the obligation and label a separate USD estimate with its price timestamp; never silently convert the stake as the SOL price changes.

## Comparison with the planning document

| Area | Planning specification | Current implementation |
| --- | --- | --- |
| Wallets | Ownership verification and user-approved deposits | Wallet Standard discovery, nonce signatures, server sessions, wallet-signed USDC deposits, fixed receiving address |
| Custody | Anchor program and separate PDA vault per room | **Server-controlled shared escrow wallet**; transfers are onchain, financial rules are enforced by the server |
| Deposit registration | Atomic program transfer and membership | Confirm-then-register offchain; persisted intent/signature supports retries, but this is not atomic with Solana |
| Challenge format | Five people, 30 calendar days, 20 qualifying days | Existing configurable distance, run count, deposit and short demo durations retained |
| Recording | SwiftUI, Core Motion, optional GPS; camera check-in | Browser GPS and photo proof; no validated screen-locked/treadmill recording |
| Daily rules | Fixed room zone, one qualifying day, streaks | Existing run counts; daily/session policy and streaks are not implemented |
| Verification | Central verifier; raw details offchain | Server run sessions, one photo check-in per room day, pace checks, review queue; proof summaries use Solana memos |
| Settlement | 5% of forfeitures, six-decimal join-order rounding; review window, timeout refunds, individual claims | Existing no-fee split rounded down to cents, zero-finisher refunds and server-triggered batch payouts; no review/timeout protocol |
| Indexing | Authenticated QuickNode Streams webhook | Direct RPC confirmation and polling; no Streams integration |
| Storage | Supabase Auth, Postgres and private Storage | Redis on Vercel, local JSON during development; photo endpoint now requires room membership |
| Sponsors | Demo campaign, atomic single-use QR | Wallet-funded sponsor bonuses and zero-finisher refunds; campaign offers/QR redemption not implemented |
| Voice | Optional ElevenLabs | Existing voice coach and browser voice fallback |

**Strava remains a pre-existing optional integration, outside the document's proposed MVP path.** Its routes now use the authenticated wallet. Native iOS, Anchor, new settlement economics, merchant campaigns and Streams are separate implementation work. This change implements the requested wallet connection and funding flow without representing those planned features as complete.

## Run locally

Requires Node.js 20.18+ and an external Solana wallet.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Configure the existing server escrow and sponsor credentials through your local environment or deployment secret manager. The escrow receives participant USDC; the sponsor needs devnet SOL for payouts, recipient token account creation and optional proof memos. Do not commit secret values.

Use a devnet RPC endpoint in `NEXT_PUBLIC_SOLANA_RPC` and the configured USDC mint in `NEXT_PUBLIC_USDC_MINT` (default `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). The endpoint and mint must both belong to Devnet. The browser integration supports wallets exposing `standard:connect`, `standard:events`, `solana:signMessage` and `solana:signTransaction` for `solana:devnet`. Wallet-facing requests use unsigned v0 transactions through Wallet Standard. The installed web3.js version can read v1 but cannot serialize v1 messages, so this app uses Phantom’s documented v0 compatibility flow. Previously signed legacy deposit intents remain supported for recovery.

## Vercel

Use the existing GitHub-connected Vercel project. Configure `ESCROW_SECRET_KEY`, `SPONSOR_SECRET_KEY`, the public RPC/mint settings, and **Upstash Redis** (`KV_REST_API_URL` / `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`). **Wallet deposits are blocked on Vercel without Redis**, because sessions and payment intents must survive function restarts. Set optional ElevenLabs and Strava credentials only if using those features. No deployment is performed by the wallet implementation itself.

## Validation

```sh
npm test
npm run build
```

Tests use ephemeral fixture keys and mocked RPC responses; they do not send funds. Coverage includes ownership/nonce replay, transaction tampering, failed simulation, confirmation retries, fixed receiving addresses and lock ownership. Live wallet prompts, actual devnet deposits/rewards, and mobile wallet browsers still require a funded-device integration check.

## Solana addresses

- Network: Solana Devnet.
- Token program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`.
- Associated Token Account program: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`.
- Memo program: `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`.
- Escrow address: read from the actual configured server wallet and shown on the home page with an explorer link.
- Custom Anchor program: `lockrun_escrow`, ID `DNCsEVz5mRUwJTKpXE1z478PSxKSrRVVW2GMAr3ByDAj` (source in `programs/lockrun_escrow`, branch `anchor-escrow`). Deployed to Solana Devnet ([explorer](https://explorer.solana.com/address/DNCsEVz5mRUwJTKpXE1z478PSxKSrRVVW2GMAr3ByDAj?cluster=devnet)); the on-chain binary was verified byte-for-byte against the local build. Upgrade authority: `3tCjQZWw3vqJ4pWn273N9iZSRFKVa8YsyF9EG66MihfA` (a development wallet). Challenges use it only when the server runs with `ESCROW_MODE=program`; all others keep the server-held escrow.

## How we use Solana

- **Stakes live on Solana, not on our server.** With `ESCROW_MODE=program`, every challenge is a *room*: a PDA account plus a USDC vault token account owned by that PDA. Participants and sponsors deposit exactly the stake/bonus from their own wallet (one transaction they sign in Phantom: `create_room` + `join_room`, `join_room`, or `fund_sponsor`).
- **The program enforces the rules.** After the room ends, the room's `verifier` (the Lock&Run server) records each participant's completed share (`record_result`, in join order) and calls `finalize`. The program computes every payout (both reward modes, the 5% fee on forfeited stakes in all-or-nothing rooms, integer rounding), so the server only decides who finished; it cannot choose amounts or take money. `claim`, `return_sponsor` and `claim_fee` are permissionless and can only pay the recorded wallet's own token account or the fee recipient fixed at room creation.
- **Failure paths are on-chain.** If no result is finalized before `timeout_at` (72 h after the end), `claim` and `return_sponsor` refund everyone; finalizing is then impossible. If nobody finishes, every stake and sponsor bonus is refunded.
- **Solana-native pieces:** SPL Token transfers (Circle USDC), Associated Token Accounts, PDAs/CPI with signer seeds, the Compute Budget program, the Memo program (run proofs), Anchor events for indexing.
- **Wallet UX:** Wallet Standard connection and message-signing login; the deposit transaction is simulated server-side, then re-checked in the browser (every account derived from the program ID, every instruction byte compared) before Phantom is asked to sign. One signer, explicit compute and loaded-data limits.

### Program

| Instruction | Who | What |
|---|---|---|
| `create_room` | creator | Fixes stake, mode (`0` all-or-nothing, `1` by fraction), end time, timeout, verifier, fee recipient; creates the vault |
| `join_room` | participant | Transfers exactly the stake into the vault, registers the wallet once |
| `fund_sponsor` | sponsor | Adds a bonus before the end (one per wallet) |
| `record_result` / `finalize` | verifier | After the end, before the timeout; results in join order; the program computes allocations |
| `claim` / `return_sponsor` / `claim_fee` | anyone | Pay the participant / return a bonus / send the fee |

Tests: `cargo test -p lockrun_escrow --lib` (math, including the structure document's examples), and `anchor test --skip-build` (local validator: all-or-nothing with fee, by fraction, nobody finishes, wrong destination, timeout refund, double join, late join, plus the app's own builders/inspector/settlement crank end to end against the real program).

Build notes: `anchor build -- --tools-version v1.51` (the lockfile pins crates that predate Rust edition 2024); generate the IDL with `anchor idl build -o target/idl/lockrun_escrow.json`.

### Not done yet
- **QuickNode Streams** webhook (the program emits `RoomCreated`, `Joined`, `SponsorFunded`, `Finalized`, `Claimed`, `SponsorReturned`, `FeeClaimed` events for it).
- A browser UI button for the timeout refund (the instruction exists; today a refund can be cranked by anyone with a script).
- Joins don't yet read the room's stake from the chain in the browser; the program enforces the stake, but the displayed amount comes from the server.
- The program is **unaudited**.

Implementation references: [Wallet Standard Solana features](https://github.com/wallet-standard/wallet-standard/blob/master/extensions/solana.md), [Solana transaction confirmation](https://solana.com/docs/rpc/http/gettransaction).

## Interface and sponsored challenges

The merged interface uses a green theme, a desktop sidebar/dashboard, mobile top and bottom navigation, and duration controls for minutes, hours, days, weeks and months (a month is 30 elapsed days). Wallet address, disconnect and confirmation retry controls remain available in both layouts.

A connected wallet can fund one sponsor bonus per room (10, 25, 50 or 100 test USDC; at most three sponsors). The donor signs the bonus transfer using the same simulated, confirmed deposit flow as runners. Only confirmed bonuses enter the pool. The donor does not become a runner automatically. Finishers share the bonus; if nobody finishes, each sponsor's bonus returns to its recorded funding address. Historical demo bonuses without an address return to the configured server sponsor wallet. Refunds use persisted transaction signatures independently of runner payouts. Sponsor offers and single-use vouchers remain future work.

## Earnings and latest interface updates

`/earnings` shows the connected external wallet's test-USDC balance, payout history and transfer form. `/api/wallet` remains the ownership/login API; authenticated balance and withdrawal operations use `/api/withdrawals`. Transfers are simulated, reviewed by the user, signed in Phantom/Solflare, and matched against a server-stored intent before submission. The configured sponsor pays transfer fees. Interrupted transfers can retry the same signed transaction through **Retry transfer confirmation**; this is not fiat cash-out.

Sponsor logos are stored separately and published only after their associated bonus deposit confirms. Celebration popups use the currently connected wallet and track acknowledgements per wallet. Challenge values support direct numeric input with server-side limits (0.5–42.2 km, 1–30 runs, 1–100 test USDC, 5 minutes–180 days). Partner logo files are optional; see `public/partners/README.md`.

## Wallet connected but actions reject the login

The external wallet connection and the backend sign-in session are separate. On Vercel, Redis must be shared across all functions: the wallet API's `/tmp` files cannot authenticate requests handled by the challenge or withdrawal functions. Without Redis, login now returns `503 SHARED_STORAGE_UNAVAILABLE` instead of pretending sign-in succeeded. Missing or expired sessions return `401 WALLET_SESSION_REQUIRED`. The frontend checks that its issued session can be read before showing the account as signed in. Configure Upstash Redis for the relevant deployment environment, redeploy, then disconnect/reconnect to replace any session created before storage was configured.

## Phantom transaction preview compatibility

Wallet approval uses a fresh unsigned v0 message and `simulateTransaction` with explicit `sigVerify: false` / `commitment: confirmed`. The exact simulated bytes are returned to the wallet. The previous legacy SDK overload replaced the blockhash internally during simulation, which could leave the wallet reviewing a different message. Deposits and withdrawals are rebuilt after the human review dialog to avoid that dialog consuming their blockhash lifetime. Phantom signs first; the backend adds the sponsor signature to withdrawals only after checking the user's signed message against its stored intent.

Before approval, the browser decodes the transaction and checks the exact transfer amount, mint, sender, recipient, fee payer, allowed instructions and required signers. Altered wallet-returned messages are rejected before submission. Backend operations verify the actual RPC genesis hash is Solana Devnet and enforce the configured Circle Devnet mint. Preflight remains enabled when broadcasting.

Regression tests reproduce the former simulation/message mismatch, check v0 byte equality, reject Mainnet RPCs and altered transfer/authority instructions, and retain recovery of legacy pending deposits. These checks do **not** certify the app as audited or guarantee Phantom's own warning disappears. Test the new preview on the deployed domain; cancel instead of approving if Phantom still warns, and use its domain/transaction review process if needed. Reference: https://docs.phantom.com/recipes/transactions/resolve-transaction-simulation-warnings.

### Rewards (`lib/settle.ts`), per `LocknRun_Basic_Structure.md` section 6
The creator picks a **reward mode** per challenge (`rewardMode`): **All or nothing** (default, below) or **By fraction** (Challengers-style: 100% = stake + prize share, 85–99% = stake back, below 85% = stake × completion rate; no fee; nobody at 100% = refunds). They also pick **Public** or **Private** (`visibility`): private challenges are hidden from the list and 404 without the secret `?invite=` link; the code is only returned to participants.

#### All or nothing
`N` runners stake `D` each, `W` of them finish (all required qualifying days approved), sponsors add `B`.

| Outcome | Result |
|---|---|
| **All finish** | Everyone gets `D` back, plus an equal share of any sponsor bonus. No fee. |
| **Some finish** (`W > 0`) | Forfeited stakes `F = (N − W) × D`; **platform fee = 5% of `F`** (rounded down). Finishers split `N × D + B − fee` equally. Leftover micro-USDC go to finishers in join order. |
| **Nobody finishes** | Every stake is refunded and sponsor bonuses are returned. No fee. |

All math is integer micro-USDC and shared by the UI and payouts. The fee stays in the escrow wallet (it is reported as
`fee` by `computePayouts`; no separate fee-wallet transfer exists yet). Example (5 × 10 USDC, 3 finish): fee 1, finishers share 49 →
16.333334 / 16.333333 / 16.333333.

### Daily check-ins and review (`app/api/challenges/[id]/route.ts`)
1. `start` issues a server run session (the server's clock).
2. `run` submits distance, time and **one live camera photo** (the browser camera stream only; no file picker). Check-ins are **phone-only**: requests from desktop user agents are refused (a guard, not tamper-proof). `strava` imports a Strava run instead (no photo; Strava reports distance/time) under the same daily and pace rules. Rejected if the session is unknown, reused, or the reported time is longer than the session lasted; if under the goal distance; or if pace is outside 2:30–20:00/km.
3. **One counted check-in per room day** in the challenge's fixed time zone (set from the creator's browser, shown on the challenge page). A goal can't need more days than the challenge spans.
4. Paces faster than 3:30/km become **pending review**: they hold that day's slot and don't count. A reviewer decides with `action: "review"` and the `x-verifier-key` header (env `VERIFIER_KEY`; disabled if unset). Payout waits for pending reviews, up to 24 hours after the end; unresolved ones then don't count.
5. Verification today is the server session clock + live photo + pace/distance checks; distance comes from the phone's browser location. Motion-sensor verification (Core Motion / HealthKit, per the structure document) is a natural **future improvement** that fits a native iOS app. The voice coach is removed.

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
shared by finishers, and is returned to the sponsor if nobody finishes. Sponsored challenges show a
"+$50 bonus · Sponsored by …" badge, are listed first, and the top sponsor's logo leads the payout pop-up.
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


## Streaks + weekly ranking

`/ranking` keeps runners coming back every day:

- **Streak:** days in a row with at least one counted run (still alive if you ran yesterday and haven't run yet
  today), with this week's Mon–Sun check marks and your best-ever streak. Your streak also shows next to your name
  (sidebar and phone top bar).
- **Weekly ranking:** every runner ranked by counted km this week (then runs, then streak). Resets every Monday.
- Only runs that count toward a challenge (distance met, human pace, photo or Strava proof) are used, so nobody
  can pad the ranking. Computed from challenge data in `lib/streaks.ts`.

