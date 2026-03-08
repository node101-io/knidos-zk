pub fn concatAddressAndSalt(address: [u8; 42],salt: [u8; 16],) -> [u8; 58] {
  let mut out: [u8; 58] = [0; 58];

  for i in 0..42 {
    out[i] = address[i];
  }

  for j in 0..16 {
    out[42 + j] = salt[j];
  }

  out
}

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

pub fn aseertFieldTwoEqual(a: [Field; 2], b: [Field; 2]) {
  assert(a[0] == b[0]);
  assert(a[1] == b[1]);
}