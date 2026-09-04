pub fn enforceZeroPadding(
  raw: [u8; 8192],
  actual_len: u32,
) {
  for i in 0..8192 {
    let idx: u32 = i as u32;

    if idx >= actual_len {
      assert(raw[i] == 0);
    }
  }
}

pub global SALT_LENGTH: u32 = 16;

// Both commitments follow Primus' SHA256_WITH_SALT resolver: sha256(value ||
// salt) with a 16-byte salt the attestor generates. The salt is what keeps a
// commitment from being reversed by anyone who can reproduce the value - and
// for Hyperliquid anyone can, since /info is public: without it, replaying
// userFillsByTime across known addresses and comparing hashes would reveal
// whose fills a proof is about.
//
// Lays out `value[0..len] || salt` in a buffer sized for the longest value,
// leaving zero padding after the salt, so the caller hashes exactly len + 16
// bytes. Works for any width: the fixed 42-byte address as well as the
// variable-length fills body. Every index is clamped so both branches stay
// in bounds; constrained code evaluates both sides of every `if`.
pub fn appendSalt<let N: u32>(
  value: [u8; N],
  len: u32,
  salt: [u8; SALT_LENGTH],
) -> [u8; N + SALT_LENGTH] {
  let mut out: [u8; N + SALT_LENGTH] = [0; N + SALT_LENGTH];
  let salt_end = len + SALT_LENGTH;

  for i in 0..N + SALT_LENGTH {
    let idx = i as u32;
    let in_value = idx < len;
    let in_salt = (idx >= len) & (idx < salt_end);
    let value_idx = if in_value { idx } else { 0 };
    let salt_idx = if in_salt { idx - len } else { 0 };

    if in_value {
      out[i] = value[value_idx];
    } else if in_salt {
      out[i] = salt[salt_idx];
    }
  }

  out
}

pub fn bytes16ToField(b: [u8; 16]) -> Field {
  let mut acc: Field = 0;
  for i in 0..16 {
    acc = acc * 256 + b[i] as Field;
  }
  acc
}

pub fn hash32ToFieldTwo(h: [u8; 32]) -> [Field; 2] {
  let mut hi_bytes: [u8; 16] = [0; 16];
  let mut lo_bytes: [u8; 16] = [0; 16];

  for i in 0..16 { hi_bytes[i] = h[i]; }
  for i in 0..16 { lo_bytes[i] = h[16+i]; }

  [bytes16ToField(hi_bytes), bytes16ToField(lo_bytes)]
}

pub fn assertFieldTwoEqual(a: [Field; 2], b: [Field; 2]) {
  assert(a[0] == b[0]);
  assert(a[1] == b[1]);
}
