// Bridges ETH from Ethereum Sepolia (L1) to Base Sepolia (L2) for the
// submitter wallet. Plain-ETH transfer to Base's canonical
// OptimismPortal triggers `receive()` → `depositTransaction(msg.sender, ...)`,
// which the L2 sequencer picks up and credits to the same address on
// Base Sepolia within ~1-3 minutes.
//
// Why this script exists:
// The submitter wallet burns Base Sepolia ETH continuously (one
// submitTask per symbol per window). Faucets drip slowly (0.05-0.1 ETH
// per day per faucet). Bridging from Sepolia is faster and
// unbounded-by-amount, provided you have Sepolia ETH already.
//
// Where to get Sepolia ETH:
//   - Google Cloud:  https://cloud.google.com/application/web3/faucet/ethereum/sepolia
//   - pk910 PoW:     https://sepolia-faucet.pk910.de/
//   - Alchemy:       https://www.alchemy.com/faucets/ethereum-sepolia
//
// Usage:
//   pnpm primus:bridge            # defaults to 0.05 ETH
//   pnpm primus:bridge 0.1        # custom amount
//
// After the L1 tx mines, wait ~2 min and check the Base Sepolia
// balance on https://sepolia.basescan.org/address/<your-address>.

import { ethers } from 'ethers';

import { env } from '../env.js';

// Base Sepolia's OptimismPortal proxy, deployed on Ethereum Sepolia.
// Source: https://docs.base.org/deploy/network-info
const BASE_SEPOLIA_PORTAL = '0x49f53e41452C74589E85cA1677426Ba426459e85';

// Public Sepolia RPC. Swap if rate-limited.
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

// Conservative gas reserve so we don't bridge the entire balance and
// fail on the tx itself for lack of gas. Covers a 0.001 ETH worst-case
// L1 gas bill.
const GAS_RESERVE = ethers.utils.parseEther('0.001');

const amountEth = process.argv[2] ?? '0.05';
const amountWei = ethers.utils.parseEther(amountEth);

const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
const wallet = new ethers.Wallet(env.PRIMUS_PRIVATE_KEY, provider);

const balance = await provider.getBalance(wallet.address);
console.log(`from:            ${wallet.address}`);
console.log(`sepolia balance: ${ethers.utils.formatEther(balance)} ETH`);
console.log(`bridging:        ${amountEth} ETH -> Base Sepolia`);

if (balance.lt(amountWei.add(GAS_RESERVE))) {
  console.error(
    `\nInsufficient Sepolia balance: have ${ethers.utils.formatEther(balance)} ETH, ` +
      `need ~${ethers.utils.formatEther(amountWei.add(GAS_RESERVE))} ETH (bridge amount + gas reserve).`,
  );
  process.exit(1);
}

const tx = await wallet.sendTransaction({
  to: BASE_SEPOLIA_PORTAL,
  value: amountWei,
});
console.log(`sepolia tx sent: ${tx.hash}`);

const receipt = await tx.wait();
console.log(`mined in block ${receipt.blockNumber}`);
console.log(`wait ~2 min, then verify Base Sepolia balance:`);
console.log(`  https://sepolia.basescan.org/address/${wallet.address}`);

process.exit(0);
