import logger from './shared/logger.js';
import { bootstrap } from './bootstrap.js';

await bootstrap().catch((err) => {
  logger.error({ err }, '[app] fatal error');
  process.exit(1);
});
