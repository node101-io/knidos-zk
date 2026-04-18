export const TASK_CONTRACT_ADDRESSES: Record<number, string> = {
  84532: '0xC02234058caEaA9416506eABf6Ef3122fCA939E8',
  8453: '0x151cb5eD5D10A42B607bB172B27BDF6F884b9707',
};

export const TOKEN_SYMBOL_ETH = 0;

export function getTaskContractAddress(chainId: number): string {
  const address = TASK_CONTRACT_ADDRESSES[chainId];
  if (!address) {
    throw new Error(`Unknown Primus chainId ${chainId} (no TaskContract address mapping)`);
  }
  return address;
}
