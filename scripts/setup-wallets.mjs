// Creates the two server wallets Lock&Run needs.  Usage: npm run setup
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "node:fs";

const file = "wallets.json";
let saved = {};
if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, "utf8"));

function getOrCreate(name) {
  if (saved[name]) return Keypair.fromSecretKey(Uint8Array.from(saved[name]));
  const kp = Keypair.generate();
  saved[name] = Array.from(kp.secretKey);
  return kp;
}

const sponsor = getOrCreate("sponsor");
const escrow = getOrCreate("escrow");
fs.writeFileSync(file, JSON.stringify(saved));

console.log(`
Wallets saved to ${file} (keep it private; it's in .gitignore).

SPONSOR (funds deposits + pays fees):  ${sponsor.publicKey.toBase58()}
ESCROW  (holds deposits until payout): ${escrow.publicKey.toBase58()}

1) Add these two lines to .env.local:

SPONSOR_SECRET_KEY=${bs58.encode(sponsor.secretKey)}
ESCROW_SECRET_KEY=${bs58.encode(escrow.secretKey)}

2) Fund the SPONSOR address only:
   - devnet SOL (fees):  https://faucet.solana.com        (choose Devnet)
   - devnet USDC:        https://faucet.circle.com        (choose "Solana Devnet")

The escrow wallet needs nothing; the sponsor pays its fees.
`);
