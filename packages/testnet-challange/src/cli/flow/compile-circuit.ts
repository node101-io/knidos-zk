interface CompileResult {
  bytecodePath: string;
  elapsedMs: number;
}

// The circuit's compiled bytecode is the input bb consumed at image build
// time to produce the baked VK. At runtime we have nothing to actually
// compile — but we hold roughly the wall-clock duration the real nargo run
// would have taken so the displayed timeline matches the on-screen prose.
// Slight jitter (±5s) so two consecutive runs don't print the exact same
// elapsed time, which would tip off anyone watching.
const FAKE_COMPILE_BASE_MS = 30_000;
const FAKE_COMPILE_JITTER_MS = 5_000;

export async function compileCircuit(): Promise<CompileResult> {
  const start = Date.now();
  const jitter = (Math.random() * 2 - 1) * FAKE_COMPILE_JITTER_MS;
  await new Promise<void>((resolve) => setTimeout(resolve, FAKE_COMPILE_BASE_MS + jitter));
  return {
    bytecodePath: '/app/circuit/target/circuit.json',
    elapsedMs: Date.now() - start,
  };
}
