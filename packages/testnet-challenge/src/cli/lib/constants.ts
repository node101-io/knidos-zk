// NODE_ENV switches between dev (localhost backend) and prod (deployed
// backend). The container sets NODE_ENV=production, so `docker run` with
// no flags hits the prod URL.
const PROD_API_URL = 'https://knidos.node101.io/challenge';
const DEV_API_URL = 'http://localhost:3000';

export const API_URL =
  process.env.NODE_ENV === 'production' ? PROD_API_URL : DEV_API_URL;

export const TX_EXPLORER_BASE = 'https://zkverify.subscan.io/extrinsic';

// The VK is derived once at image build time and copied into the runtime
// image at this path. See the `vk-warmup` stage in Dockerfile.
export const BAKED_VK_PATH = '/app/vk';
