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
//   pnpm primus:bridge            # bridges entire balance minus L1 gas reserve
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

// Manual gas limit. Ethers' estimateGas underestimates OptimismPortal.receive()
// because the metered modifier's ResourceMetering math uses block.timestamp,
// so the simulated cost can come in below the actual on-chain cost and the
// tx reverts out-of-gas (~83k vs needed ~90-110k). 200k is a safe ceiling.
const GAS_LIMIT = 200000;

const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC);
const wallet = new ethers.Wallet(env.PRIMUS_PRIVATE_KEY, provider);

const [balance, feeData] = await Promise.all([
  provider.getBalance(wallet.address),
  provider.getFeeData(),
]);

// Reserve worst-case fee (gasLimit * maxFeePerGas) + 20% buffer for fee
// swings between estimation and inclusion.
const gasReserve = feeData.maxFeePerGas!.mul(GAS_LIMIT).mul(120).div(100);

const amountWei = process.argv[2]
  ? ethers.utils.parseEther(process.argv[2])
  : balance.sub(gasReserve);

console.log(`from:            ${wallet.address}`);
console.log(`sepolia balance: ${ethers.utils.formatEther(balance)} ETH`);
console.log(`gas reserve:     ${ethers.utils.formatEther(gasReserve)} ETH`);
console.log(`bridging:        ${ethers.utils.formatEther(amountWei)} ETH -> Base Sepolia`);

if (amountWei.lte(0) || balance.lt(amountWei.add(gasReserve))) {
  console.error(
    `\nInsufficient Sepolia balance: have ${ethers.utils.formatEther(balance)} ETH, ` +
      `need ~${ethers.utils.formatEther(amountWei.add(gasReserve))} ETH (bridge amount + gas reserve).`,
  );
  process.exit(1);
}

const tx = await wallet.sendTransaction({
  to: BASE_SEPOLIA_PORTAL,
  value: amountWei,
  gasLimit: GAS_LIMIT,
});
console.log(`sepolia tx sent: ${tx.hash}`);

const receipt = await tx.wait();
console.log(`mined in block ${receipt.blockNumber}`);
console.log(`wait ~2 min, then verify Base Sepolia balance:`);
console.log(`  https://sepolia.basescan.org/address/${wallet.address}`);

process.exit(0);
