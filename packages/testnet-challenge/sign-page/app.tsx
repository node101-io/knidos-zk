import {
  ConnectButton,
  RainbowKitProvider,
  getDefaultConfig,
} from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { WagmiProvider, useAccount, useSignMessage } from 'wagmi';
import {
  arbitrum,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  mainnet,
  optimism,
  polygon,
} from 'wagmi/chains';

// WalletConnect projectId is a public identifier (NOT a secret). Grab one at
// https://cloud.reown.com/ if you want mobile-wallet QR support. Without it,
// only injected wallets (MetaMask browser extension etc.) will work.
const WALLETCONNECT_PROJECT_ID = '6234807dffaae5e94b9f4e774ee5b371';

const config = getDefaultConfig({
  appName: 'Knidos Testnet Challenge',
  projectId: WALLETCONNECT_PROJECT_ID,
  // Match the chain list on testnet.knidos.xyz/login so anyone who connected
  // there can sign here without a "chain not configured" error. We only need
  // a signature; the chain itself is not used by the challenge.
  chains: [mainnet, optimism, polygon, base, arbitrum, avalanche, avalancheFuji, baseSepolia],
  // This page is a per-run CLI handoff. Persisting wagmi state across the
  // fixed localhost origin can rehydrate stale connector stubs on the next run.
  storage: null,
  ssr: false,
});

const queryClient = new QueryClient();

function SignFlow() {
  const { address, isConnected, isReconnecting, status: accountStatus } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; text: string }>({
    kind: 'idle',
    text: '',
  });
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (accountStatus !== 'connected' || isReconnecting || !isConnected || !address || done) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setStatus({ kind: 'busy', text: 'Fetching sign-in challenge…' });
        const res = await fetch(`/sign-payload?address=${address}`);
        if (!res.ok) throw new Error(`/sign-payload: ${res.status}`);
        const { message } = (await res.json()) as { message: string };
        if (cancelled) return;

        setStatus({ kind: 'busy', text: 'Open your wallet and sign the message…' });
        const signature = await signMessageAsync({ message });
        if (cancelled) return;

        setStatus({ kind: 'busy', text: 'Posting signature back to your CLI…' });
        const post = await fetch('/sign-result', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, signature }),
        });
        if (!post.ok) throw new Error(`/sign-result: ${post.status} ${await post.text()}`);

        setStatus({
          kind: 'ok',
          text: 'Done. You can close this tab and return to your terminal.',
        });
        setDone(true);
      } catch (err) {
        if (cancelled) return;
        setStatus({
          kind: 'err',
          text: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountStatus, isReconnecting, isConnected, address, done, signMessageAsync]);

  return (
    <main
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        maxWidth: 540,
        margin: '40px auto',
        padding: '0 16px',
        color: '#111',
      }}
    >
      <h1 style={{ fontSize: '1.1rem' }}>Knidos Testnet Challenge — Wallet Sign-In</h1>
      <p style={{ lineHeight: 1.5 }}>
        Connect your Ethereum wallet and sign a one-time message to start the challenge.
        This is the only browser step; everything else runs in your terminal.
      </p>
      {!done && (
        <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" />
      )}
      {status.text && (
        <pre
          style={{
            marginTop: 16,
            padding: 12,
            background: '#f4f4f4',
            borderLeft: `3px solid ${
              status.kind === 'ok' ? '#1a7a35' : status.kind === 'err' ? '#b00020' : '#888'
            }`,
            whiteSpace: 'pre-wrap',
            fontFamily: 'inherit',
          }}
        >
          {status.text}
        </pre>
      )}
    </main>
  );
}

export function App(): JSX.Element {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <SignFlow />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
