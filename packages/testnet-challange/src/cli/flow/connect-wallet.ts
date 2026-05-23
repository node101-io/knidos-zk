import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { parseSiweMessage, prepareSiweMessage } from '../../siwe-lite.js';

// Vite builds the browser-side React + RainbowKit sign-page (under
// ../../../sign-page/) into a single self-contained HTML with JS/CSS
// inlined. tsup text-loads that one file here as a string at bundle time.
import indexHtml from '../../../sign-page/dist/index.html';

interface SiweCredentials {
  address: string;
  message: string;
  signature: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string | Buffer, contentType: string): void {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

// Random 32-byte hex string. Satisfies SIWE's nonce ABNF (`8*( ALPHA / DIGIT )`).
// Not server-validated — replay protection comes from `expirationTime`.
function randomNonce(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function connectWallet(): Promise<SiweCredentials> {
  // Per-request state: address → the SIWE message we issued, so /sign-result
  // can re-verify the exact bytes the user signed.
  const issued = new Map<string, { message: string }>();

  let resolveResult!: (r: SiweCredentials) => void;
  let rejectResult!: (err: Error) => void;
  const done = new Promise<SiweCredentials>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname;

      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return send(res, 200, indexHtml, 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && pathname === '/sign-payload') {
        const rawAddress = url.searchParams.get('address');
        if (!rawAddress || !/^0x[0-9a-fA-F]{40}$/.test(rawAddress)) {
          return send(res, 400, JSON.stringify({ error: 'bad address' }), 'application/json');
        }
        const address = rawAddress.toLowerCase();
        const message = prepareSiweMessage({
          domain: req.headers.host ?? 'localhost',
          address,
          statement: 'Sign in to Knidos Testnet Challenge.',
          uri: `http://${req.headers.host ?? 'localhost'}`,
          version: '1',
          chainId: 1,
          nonce: randomNonce(),
          issuedAt: new Date().toISOString(),
          expirationTime: new Date(Date.now() + 10 * 60_000).toISOString(),
        });
        issued.set(address, { message });
        return send(res, 200, JSON.stringify({ message }), 'application/json');
      }

      if (req.method === 'POST' && pathname === '/sign-result') {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw) as { message?: string; signature?: string };
        if (typeof parsed.message !== 'string' || typeof parsed.signature !== 'string') {
          return send(res, 400, JSON.stringify({ error: 'bad body' }), 'application/json');
        }
        const { address: msgAddress } = parseSiweMessage(parsed.message);
        const challenge = issued.get(msgAddress.toLowerCase());
        if (!challenge || challenge.message !== parsed.message) {
          return send(res, 400, JSON.stringify({ error: 'unknown challenge' }), 'application/json');
        }
        send(res, 200, JSON.stringify({ ok: true }), 'application/json');
        resolveResult({
          address: msgAddress.toLowerCase(),
          message: parsed.message,
          signature: parsed.signature,
        });
        return;
      }

      return send(res, 404, 'not found', 'text/plain');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      send(res, 500, JSON.stringify({ error: msg }), 'application/json');
      rejectResult(err instanceof Error ? err : new Error(msg));
    }
  });

  // When run inside a container, the user provides KNIDOS_PORT (matching the
  // host-side `-p` mapping) and we bind 0.0.0.0 so the host can reach us.
  // Bare host runs: random port on loopback.
  const portEnv = process.env.KNIDOS_PORT;
  const listenPort = portEnv ? Number(portEnv) : 0;
  const listenHost = portEnv ? '0.0.0.0' : '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(listenPort, listenHost, resolve));
  const addr = server.address();
  if (!addr || typeof addr !== 'object') throw new Error('failed to bind local server');
  const url = `http://127.0.0.1:${addr.port}`;

  console.log('');
  console.log('  Step 1 of 2 — Connect your wallet');
  console.log('');
  console.log('  Open this URL in your browser:');
  console.log('');
  console.log(`      ${url}`);
  console.log('');
  console.log('  Sign the message in your wallet, then return here.');
  console.log('');

  try {
    const result = await done;
    server.close();
    return result;
  } catch (err) {
    server.close();
    throw err;
  }
}
