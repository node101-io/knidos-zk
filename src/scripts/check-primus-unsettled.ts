import { BigNumber } from 'ethers';

import { env } from '../env.js';
import { TOKEN_SYMBOL_ETH, primusClient } from '../primus/client.js';

const TaskStatusLabel: Record<number, string> = {
  0: 'Pending',
  1: 'Completed',
  2: 'Failed',
  3: 'Expired',
};

const contract = primusClient.contract();

console.log(`RPC:                   ${env.RPC_URL}`);
console.log(`Chain ID:              ${env.PRIMUS_CHAIN_ID}`);
console.log(`TaskContract:          ${contract.address}`);
console.log(`PRIMUS_USER_ADDRESS:   ${env.PRIMUS_USER_ADDRESS}`);
console.log('');

const [maxCount, timeoutMs, totalTaskCount] = await Promise.all([
  primusClient.maxUnsettledTaskCount(),
  primusClient.taskTimeoutMs(),
  contract.taskCount() as Promise<BigNumber>,
]);

const timeoutSec = Math.floor(timeoutMs / 1000);

console.log(`maxUnsettledTaskCount: ${maxCount}`);
console.log(`taskTimeout (sec):     ${timeoutSec} (${(timeoutSec / 60).toFixed(1)} min)`);
console.log(`global taskCount:      ${totalTaskCount.toString()}`);
console.log('');

const balance = await contract.queryBalance(env.PRIMUS_USER_ADDRESS, TOKEN_SYMBOL_ETH);
console.log('queryBalance:');
console.log(`  toWithdraw:          ${balance.toWithdraw.toString()} wei`);
console.log(`  toLock:              ${balance.toLock.toString()} wei`);
console.log(`  toWithdrawTaskCount: ${balance.toWithdrawTaskCount.toString()}`);
console.log(`  toLockTaskCount:     ${balance.toLockTaskCount.toString()}`);
console.log('');

const probe = await contract.queryUnsettledTasks(env.PRIMUS_USER_ADDRESS, TOKEN_SYMBOL_ETH, 0, 1);
const totalUnsettled = (probe.totalCount as BigNumber).toNumber();
console.log(`queryUnsettledTasks.totalCount: ${totalUnsettled}`);

if (totalUnsettled === 0) {
  console.log('No unsettled tasks for this address.');
  process.exit(0);
}

const BATCH = 100;
type TaskInfo = {
  submittedAt: BigNumber;
  taskStatus: number;
  taskResults: unknown[];
};
const allTasks: TaskInfo[] = [];
for (let offset = 0; offset < totalUnsettled; offset += BATCH) {
  const res = await contract.queryUnsettledTasks(
    env.PRIMUS_USER_ADDRESS,
    TOKEN_SYMBOL_ETH,
    offset,
    BATCH,
  );
  allTasks.push(...(res.taskInfos as TaskInfo[]));
}

const now = Math.floor(Date.now() / 1000);

let expired = 0;
let pending = 0;
let withResults = 0;
const statusBuckets: Record<string, number> = {};

for (const t of allTasks) {
  const submittedAt = t.submittedAt.toNumber();
  const age = now - submittedAt;
  if (age >= timeoutSec) expired++;
  else pending++;
  if (t.taskResults.length > 0) withResults++;
  const key = `${t.taskStatus} (${TaskStatusLabel[t.taskStatus] ?? '?'})`;
  statusBuckets[key] = (statusBuckets[key] ?? 0) + 1;
}

console.log('');
console.log(`Total unsettled:           ${allTasks.length}`);
console.log(`  expired (age >= ${timeoutSec}s): ${expired}`);
console.log(`  still within timeout:           ${pending}`);
console.log(`  with taskResults reported:      ${withResults}`);
console.log('');
console.log('By taskStatus:');
for (const [label, count] of Object.entries(statusBuckets)) {
  console.log(`  ${label}: ${count}`);
}

const sorted = [...allTasks].sort((a, b) => a.submittedAt.toNumber() - b.submittedAt.toNumber());
console.log('');
console.log('Oldest 5 unsettled:');
for (const t of sorted.slice(0, 5)) {
  const submittedAt = t.submittedAt.toNumber();
  console.log(
    `  submittedAt=${new Date(submittedAt * 1000).toISOString()} | ageSec=${
      now - submittedAt
    } | status=${t.taskStatus} (${TaskStatusLabel[t.taskStatus] ?? '?'}) | results=${t.taskResults.length}`,
  );
}
console.log('');
console.log('Newest 5 unsettled:');
for (const t of sorted.slice(-5).reverse()) {
  const submittedAt = t.submittedAt.toNumber();
  console.log(
    `  submittedAt=${new Date(submittedAt * 1000).toISOString()} | ageSec=${
      now - submittedAt
    } | status=${t.taskStatus} (${TaskStatusLabel[t.taskStatus] ?? '?'}) | results=${t.taskResults.length}`,
  );
}

console.log('');
console.log(
  `Limit check: ${allTasks.length} / ${maxCount} (${((allTasks.length / maxCount) * 100).toFixed(
    1,
  )}%)`,
);
if (allTasks.length >= maxCount) {
  console.log(
    '>>> At or over max. Next submitTask will revert with "unsettled task count exceed max count".',
  );
}

process.exit(0);
