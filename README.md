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
| Verification | Central verifier; raw details offchain | Existing GPS/pace checks and optional Strava; existing proof summaries still use Solana memos |
| Settlement | 5% of forfeitures, six-decimal join-order rounding; review window, timeout refunds, individual claims | Existing no-fee split rounded down to cents, zero-finisher refunds and server-triggered batch payouts; no review/timeout protocol |
| Indexing | Authenticated QuickNode Streams webhook | Direct RPC confirmation and polling; no Streams integration |
| Storage | Supabase Auth, Postgres and private Storage | Redis on Vercel, local JSON during development; photo endpoint now requires room membership |
| Sponsor offers | Demo campaign, atomic single-use QR | Not implemented |
| Voice | Optional ElevenLabs | Existing voice coach and browser voice fallback |

**Strava remains a pre-existing optional integration, outside the document's proposed MVP path.** Its routes now use the authenticated wallet. Native iOS, Anchor, new settlement economics, sponsors and Streams are separate implementation work. This change implements the requested wallet connection and funding flow without representing those planned features as complete.

## Run locally

Requires Node.js 20.18+ and an external Solana wallet.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Configure the existing server escrow and sponsor credentials through your local environment or deployment secret manager. The escrow receives participant USDC; the sponsor needs devnet SOL for payouts, recipient token account creation and optional proof memos. Do not commit secret values.

Use a devnet RPC endpoint in `NEXT_PUBLIC_SOLANA_RPC` and the configured USDC mint in `NEXT_PUBLIC_USDC_MINT` (default `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). The endpoint and mint must both belong to Devnet. The browser integration supports wallets exposing `standard:connect`, `standard:events`, `solana:signMessage` and `solana:signTransaction` for `solana:devnet`. Existing web3.js transaction construction is retained for compatibility with this app; the wallet uses Wallet Standard's legacy transaction signing support.

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
- Custom Anchor Program ID: none deployed by this implementation.

Implementation references: [Wallet Standard Solana features](https://github.com/wallet-standard/wallet-standard/blob/master/extensions/solana.md), [Solana transaction confirmation](https://solana.com/docs/rpc/http/gettransaction).
