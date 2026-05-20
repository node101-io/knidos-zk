import { reclaimTimedOutTasks } from '../primus/capacity.js';

const { settled } = await reclaimTimedOutTasks();

console.log(`Reclaimed fees from ${settled.length} task(s).`);
if (settled.length > 0) {
  console.log('Settled taskIds:');
  for (const id of settled) console.log(`  ${id}`);
}

process.exit(0);
