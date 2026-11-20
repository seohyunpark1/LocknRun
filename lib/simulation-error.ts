/** Turn known simulation failures into an actionable message without guessing that every failure is a balance problem. */
export function depositSimulationMessage(error: unknown, logs: string[] = []): string {
  const text = logs.join('\n').toLowerCase();
  if (error === 'InsufficientFundsForFee' || error === 'AccountNotFound' || text.includes('insufficient lamports')) {
    return 'The connected wallet needs Devnet SOL for the network fee and token account creation. Check the address shown in LocknRun.';
  }
  if (text.includes('insufficient funds')) {
    return 'The connected wallet does not have enough of the configured Devnet USDC for this deposit. Check the deposit amount and connected address.';
  }
  if (text.includes('invalid account data') || text.includes('invalidaccountdata') || text.includes('uninitialized account')) {
    return 'The wallet’s USDC token account could not be used. Verify that its USDC is on Solana Devnet and matches the app’s mint.';
  }
  if (error === 'BlockhashNotFound') return 'The network returned an expired transaction blockhash. Retry preparing the deposit.';
  return 'The deposit could not be simulated. No funds were sent. Please retry; detailed diagnostics are available to the app owner.';
}
