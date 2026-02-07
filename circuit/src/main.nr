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

fn assertEqual32(a: [u8; 32], b: [u8; 32]) {
    for i in 0..32 {
        assert(a[i] == b[i]);
    }
}

fn enforceZeroPadding(
    raw: [u8; 4096],
    actual_len: u32,
) {
    for i in 0..4096 {
        let idx: u32 = i as u32;

        if idx >= actual_len {
            assert(raw[i] == 0);
        }
    }
}


fn main(addressCommitment: pub [u8; 32], fillsCommitment: pub [u8; 32], address: [u8; 42], salt: [u8; 16], rawFills: [u8; 4096], rawFillsLength: u32, addressAndSaltLength: u32) -> pub ([u8; 32]) {
    assert(rawFillsLength <= 4096 as u32);

    // padding constraint
    enforceZeroPadding(rawFills, rawFillsLength);

    // fills commitment
    let fillsHash = sha256_var(rawFills, rawFillsLength);
    assertEqual32(fillsHash, fillsCommitment);
    // address commitment
    let concatedAddressAndSalt = concatAddressAndSalt(address, salt);
    // // let lenghtAddressAndSalt = concatedAddressAndSalt.len(); // TODO: Check Noir examples for this problem
    let concatedAddressAndSaltHash = sha256_var(concatedAddressAndSalt, addressAndSaltLength);
    assertEqual32(concatedAddressAndSaltHash, addressCommitment);
    concatedAddressAndSaltHash
}
