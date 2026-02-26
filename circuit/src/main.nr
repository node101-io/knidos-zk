use sha256::sha256_var;

fn concatAddressAndSalt(address: [u8; 42],salt: [u8; 16],) -> [u8; 58] {
  let mut out: [u8; 58] = [0; 58];

  for i in 0..42 {
      out[i] = address[i];
  }

  for j in 0..16 {
      out[42 + j] = salt[j];
  }

  out
}

fn enforceZeroPadding(
  raw: [u8; 1024],
  actual_len: u32,
) {
  for i in 0..1024 {
    let idx: u32 = i as u32;

    if idx >= actual_len {
      assert(raw[i] == 0);
    }
  }
}

fn bytes16ToField(b: [u8; 16]) -> Field {
  let mut acc: Field = 0;
  for i in 0..16 {
      acc = acc * 256 + b[i] as Field;
  }
  acc
}

fn hash32ToFieldTwo(h: [u8; 32]) -> [Field; 2] {
  let mut hi_bytes: [u8; 16] = [0; 16];
  let mut lo_bytes: [u8; 16] = [0; 16];

  for i in 0..16 { hi_bytes[i] = h[i]; }
  for i in 0..16 { lo_bytes[i] = h[16+i]; }

  [bytes16ToField(hi_bytes), bytes16ToField(lo_bytes)]
}

fn assert_field2_eq(a: [Field; 2], b: [Field; 2]) {
  assert(a[0] == b[0]);
  assert(a[1] == b[1]);
}

fn main(
  addressCommitment: pub [Field; 2],
  fillsCommitment: pub [Field; 2],
  address: [u8; 42],
  salt: [u8; 16],
  rawFills: [u8; 1024],
  rawFillsLength: u32,
  addressAndSaltLength: u32
) {
  assert(rawFillsLength <= 1024);

  enforceZeroPadding(rawFills, rawFillsLength);

  let fillsHashBytes = sha256_var(rawFills, rawFillsLength);
  let fillsHashField2 = hash32ToFieldTwo(fillsHashBytes);
  assert_field2_eq(fillsHashField2, fillsCommitment);

  let concated = concatAddressAndSalt(address, salt);
  let addrHashBytes = sha256_var(concated, addressAndSaltLength);
  let addrHashField2 = hash32ToFieldTwo(addrHashBytes);
  assert_field2_eq(addrHashField2, addressCommitment);
}