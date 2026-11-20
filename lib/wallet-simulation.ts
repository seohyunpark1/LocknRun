import 'server-only';
import type { PublicKey, TransactionInstruction, SimulatedTransactionResponse, RpcResponseAndContext } from '@solana/web3.js';
import { connection } from './solana-server';
import { budgetInstructions, buildWalletTransaction } from './wallet-transaction';

const LOADED_DATA_LADDER = [128 * 1024, 512 * 1024, 2 * 1024 * 1024];
const PROBE_UNITS = 200_000;

/**
 * Builds the exact v0 transaction handed to the wallet: explicit compute-unit and loaded-account-data limits
 * (Phantom's simulation guidance), sized from a real RPC simulation, then simulated again as final bytes.
 */
export async function buildSimulatedTransaction(payer: PublicKey, core: TransactionInstruction[], blockhash: string) {
  let last: { tx: ReturnType<typeof buildWalletTransaction>; simulation: RpcResponseAndContext<SimulatedTransactionResponse> } | undefined;
  for (const loadedBytes of LOADED_DATA_LADDER) {
    const simulate = (units: number) => {
      const tx = buildWalletTransaction(payer, [...budgetInstructions(units, loadedBytes), ...core], blockhash);
      return connection.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: false }).then(simulation => ({ tx, simulation }));
    };
    const probe = await simulate(PROBE_UNITS);
    last = probe;
    if (probe.simulation.value.err) {
      if (/LoadedAccountsDataSize/i.test(JSON.stringify(probe.simulation.value.err))) continue;
      return probe;
    }
    const used = probe.simulation.value.unitsConsumed;
    if (!used) return probe;
    last = await simulate(Math.min(PROBE_UNITS, Math.max(5_000, Math.ceil(used * 1.3))));
    return last;
  }
  return last!;
}
