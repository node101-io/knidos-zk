import { settleExpiredPrimusTasksAuto } from '../zk-tls/primus-settlement.js';

const { settled, toWithdrawWei } = await settleExpiredPrimusTasksAuto();

console.log(`Settled ${settled.length} task(s).`);
console.log(`toWithdraw before call: ${toWithdrawWei} wei`);
if (settled.length > 0) {
  console.log('Settled taskIds:');
  for (const id of settled) console.log(`  ${id}`);
}

process.exit(0);
