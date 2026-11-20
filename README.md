# Lock&Run

**Lock your stake. Run with friends. Finish the challenge and share the rewards.**

Friends stake USDC on a shared running goal. Each challenge is a **room** on Solana: stakes sit in a vault that no person or server wallet owns, and when the challenge ends an **Anchor program** computes and pays the rewards. Finishers share the pool, or everyone is refunded if nobody finishes or no result arrives.

This README covers the Solana program and how the project uses Solana. Notes on the web app (wallet flow, check-ins, shop, interface) are in [docs/APP_NOTES.md](docs/APP_NOTES.md); the product plan is in [LocknRun_Basic_Structure.md](LocknRun_Basic_Structure.md).

## Program IDs (Solana Devnet)

| Program / account | Address | Used for |
|---|---|---|
| **`lockrun_escrow`** (our Anchor program) | [`DNCsEVz5mRUwJTKpXE1z478PSxKSrRVVW2GMAr3ByDAj`](https://explorer.solana.com/address/DNCsEVz5mRUwJTKpXE1z478PSxKSrRVVW2GMAr3ByDAj?cluster=devnet) | Room vaults, results, payouts, refunds. Source: [`programs/lockrun_escrow`](programs/lockrun_escrow) |
| SPL Token program | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | All USDC transfers, including the program's signed payouts (CPI) |
| Associated Token Account program | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` | Runners' USDC accounts |
| System program | `11111111111111111111111111111111` | Creating room, vault and participant accounts |
| Compute Budget program | `ComputeBudget111111111111111111111111111111` | Explicit compute and loaded-data limits on every wallet transaction |
| Memo program | `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` | Fingerprint of each run check-in |
| USDC mint (Circle, Devnet) | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` | The only token a room accepts |

- Deployment transaction: [`5jWPrpaz…YPk2`](https://explorer.solana.com/tx/5jWPrpazPtqBUoq8749Fwy8tz4VhJcPaEWPEavHHF7QCupDja7EXibGcQ4cn4DgdCnKmJJzSp8HYfLwn7YJZYPk2?cluster=devnet). The deployed binary matches the local build byte for byte.
- Example room created through the app on Devnet (`create_room` + `join_room` in one wallet-signed transaction): [`5TP5sgBY…BbMX`](https://explorer.solana.com/tx/5TP5sgBYV58ak3mWsxTTEu3obcs1CfCdeDR72otUbuBtKWUwapDVz4KtYjo1DxSZ7aaobRdpXwXc33paRdz8BbMX?cluster=devnet).
- A server with `ESCROW_MODE=program` creates every new challenge as an on-chain room. Without it, new challenges use an earlier server-held escrow wallet. Both paths are in the repository and a challenge remembers which one it uses.

## How the project uses Solana

- **Stakes live on-chain.** Every deposit is an SPL USDC transfer from the user's own wallet into the room's vault token account. The vault's owner is the room PDA, so only the program can move the funds.
- **Rules are enforced by the program.** The room fixes stake, reward mode, schedule, verifier and fee recipient at creation. The verifier records who finished; the program alone calculates every payout (both reward modes, the 5% fee on forfeited stakes, integer rounding).
- **Refunds are on-chain too.** If no result is finalized before the timeout, everyone can be refunded and finalizing becomes impossible. If nobody finishes, every stake and sponsor bonus is returned.
- **Why Solana:** near-instant settlement, fees small enough for small stakes, USDC for dollar-denominated amounts, and Wallet Standard wallets (Phantom, Solflare) that sign one previewed transaction.
- **Solana-native pieces:** SPL Token and Associated Token Accounts, PDAs with signer seeds, cross-program invocation, versioned (v0) transactions with Compute Budget instructions, the Memo program, Anchor events.

## Program architecture

```
                        room PDA  ["room", room_id]            created by create_room
                       /        \
   vault token account           participant PDA ["p", room, wallet]    one per runner
   ["vault", room]               sponsor PDA     ["s", room, wallet]    one per sponsor
   (USDC; authority = room PDA)
```

| Account | Holds |
|---|---|
| **Room** | creator, verifier, fee recipient, mint, stake, reward mode, end time, timeout, counters (participants, recorded, finishers), sponsor total, status, computed share, fee |
| **Vault** | The USDC for the room (an SPL token account whose authority is the room PDA) |
| **Participant** | wallet, join index, recorded completion (basis points), finisher rank, claimed flag |
| **Sponsor** | funder, bonus amount, returned flag |

Room status: `0` open → `1` finalized (finishers paid) or `2` nobody finished (everyone refunded). After `timeout_at` an open room also refunds.

### Instructions

| Instruction | Signer | What it does |
|---|---|---|
| `create_room` | creator | Creates the room and its vault; fixes stake, mode (`0` all or nothing, `1` by fraction), end time, timeout, verifier, fee recipient |
| `join_room` | participant | Transfers exactly the stake into the vault; registers the wallet once (the participant PDA makes a second join fail) |
| `fund_sponsor` | sponsor | Adds a bonus before the room ends (one per wallet) |
| `record_result` | verifier | After the end and before the timeout: records one participant's completion, in join order |
| `finalize` | verifier | Once everyone is recorded: computes the shares and sets the final status |
| `claim` | anyone | Pays one participant their reward or refund, to that wallet's own token account only |
| `return_sponsor` | anyone | Returns a sponsor bonus when nobody finished or after the timeout |
| `claim_fee` | anyone | Sends the platform fee to the fee recipient fixed at creation |

### Settlement rules

| | All or nothing (mode 0) | By fraction (mode 1) |
|---|---|---|
| Finishers (100%) | Share `N × stake + bonuses − fee` equally | Stake back + equal share of the prize pool |
| 85–99% | Forfeit the stake | Full stake back |
| Below 85% | Forfeit the stake | Stake × completion |
| Fee | 5% of forfeited stakes | None |
| Nobody finishes | Every stake and bonus refunded | Every stake and bonus refunded |

Amounts are integer micro-USDC. The pure math is in [`math.rs`](programs/lockrun_escrow/src/math.rs) and is mirrored by the app in `lib/settle.ts`.

### Events

`RoomCreated`, `Joined`, `SponsorFunded`, `Finalized`, `Claimed`, `SponsorReturned`, `FeeClaimed`, emitted with `emit!` so an indexer can decode them.

## How Anchor is used

- **Anchor 0.31.1**, with `anchor-spl` for the SPL Token CPI.
- **Account validation by constraints** (`#[derive(Accounts)]`): `init` with `seeds`/`bump` for the room, vault, participant and sponsor PDAs; `has_one` to bind a participant or sponsor to its room; `token::mint` and `token::authority` to pin every token account (the claim destination must belong to the recorded wallet); a `constraint` that only the room's verifier can sign `record_result` and `finalize`.
- **PDA signing:** payouts are `token::transfer` CPIs signed with the room's seeds (`CpiContext::new_with_signer`).
- **State and errors:** `#[account]` with `InitSpace`, a typed `#[error_code]` enum, `emit!` events.
- **Logic kept testable:** settlement math lives in a plain Rust module with unit tests.
- **Client side:** the app builds instructions with hand-written builders (`lib/escrow-ix.ts`) using the discriminators from the generated IDL ([`anchor-tests/lockrun_escrow.idl.json`](anchor-tests/lockrun_escrow.idl.json)), and the browser re-derives every account and checks every instruction before the wallet signs.

## Build, test, deploy

```sh
cargo test -p lockrun_escrow --lib          # settlement math, incl. the worked examples
anchor build -- --tools-version v1.51       # the lockfile pins crates that predate Rust edition 2024
anchor idl build -o target/idl/lockrun_escrow.json
anchor test --skip-build                    # local validator: program tests + the app's builders and settlement crank
solana program deploy target/deploy/lockrun_escrow.so --program-id target/deploy/lockrun_escrow-keypair.json -u devnet
```

The local-validator suite covers both reward modes, the fee, nobody finishing, wrong payout destinations, timeout refunds, double and late joins, and the app's own transaction builders and inspector against the real program.

## Status

Devnet only, and the program is **not audited**.

## Repository map

| Path | Contents |
|---|---|
| `programs/lockrun_escrow/` | The Anchor program (`lib.rs`) and settlement math (`math.rs`) |
| `anchor-tests/` | Local-validator tests, IDL, test mint setup |
| `lib/escrow-ix.ts` | Instruction builders, PDAs, account decoders, transaction inspector |
| `lib/escrow-settle.ts` | Server crank: record results, finalize, claims, refunds |
| `lib/deposits.ts`, `lib/settle.ts` | Deposit transactions and payout math in the app |
| `app/`, `components/` | Next.js web app ([notes](docs/APP_NOTES.md)) |
