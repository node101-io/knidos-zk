interface CompileResult {
  bytecodePath: string;
  elapsedMs: number;
}

// The circuit's compiled bytecode is the input bb consumed at image build
// time to produce the baked VK. At runtime we have nothing to actually
// compile — but we hold roughly the wall-clock duration the real nargo run
// would have taken so the displayed timeline matches the on-screen prose.
const FAKE_COMPILE_MS = 30_000;

export async function compileCircuit(): Promise<CompileResult> {
  const start = Date.now();
  await new Promise<void>((resolve) => setTimeout(resolve, FAKE_COMPILE_MS));
  return {
    bytecodePath: '/app/circuit/target/circuit.json',
    elapsedMs: Date.now() - start,
  };
}
