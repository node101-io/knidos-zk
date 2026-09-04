// Hard limits of the Noir circuit (circuit/src/main.nr, parser.nr). A window
// beyond either cannot be proven, so the pipeline checks them before spending
// a Primus attestation on it.

// Width of the circuit's rawFills input.
export const MAX_RAW_FILLS_BYTES = 8192;

// Fills the JSON parser can tokenise: JSON8kb allows 1024 tokens and a
// Hyperliquid fill costs ~60, so 16 parse and 17 do not (measured with real
// mainnet fills). parser.nr's MAX_FILLS mirrors this.
export const MAX_FILLS = 16;
