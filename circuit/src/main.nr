mod helpers;

use sha256::sha256_var;

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

    helpers::enforceZeroPadding(rawFills, rawFillsLength);

    let fillsHashBytes = sha256_var(rawFills, rawFillsLength);
    let fillsHashField2 = helpers::hash32ToFieldTwo(fillsHashBytes);
    helpers::assert_fieldTwo_equal(fillsHashField2, fillsCommitment);

    let concated = helpers::concatAddressAndSalt(address, salt);
    let addrHashBytes = sha256_var(concated, addressAndSaltLength);
    let addrHashField2 = helpers::hash32ToFieldTwo(addrHashBytes);
    helpers::assert_fieldTwo_equal(addrHashField2, addressCommitment);
}