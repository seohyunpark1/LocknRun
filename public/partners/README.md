# Partner logos

Logo files used by the "Partners" card, the "Powered by" strip, the sidebar and the payout pop-up
(see `PARTNERS` in `lib/config.ts`):

- `solana.png`     Solana
- `usdc.svg`       USDC (Circle's digital dollar; from the CC0 cryptocurrency-icons set)
- `quicknode.png`  QuickNode
- `strava.png`     Strava

If a file is missing, the app falls back to the company's site icon, then to a letter badge.
Before a public launch, use the files from each company's official brand kit and follow their guidelines
(Strava requires its official "Powered by Strava" logo next to Strava data).

To add a partner, add a line to `PARTNERS` in `lib/config.ts` and drop its logo here.
