mod helpers;
mod parser;

use sha256::sha256_var;

// Hyperliquid's `POST /info` is a public endpoint: the account is named by the
// `user` field in the request body rather than by an API key, and anyone can
// fetch any address's fills. Two salted commitments (both derived by the Primus
// attestor via SHA256_WITH_SALT) keep the address private while still tying
// the proof to the account:
//   - addressCommitment = sha256(address || addressSalt) binds the proof to
//     the account the request named, without publishing the address;
//   - fillsCommitment = sha256(body || fillsSalt) commits to the response.
//     It must be salted too, because the body is publicly reproducible - an
//     unsalted hash could be matched against candidate addresses.
fn main(
    addressCommitment: pub [Field; 2],
    fillsCommitment: pub [Field; 2],
    address: [u8; 42],
    addressSalt: [u8; 16],
    fillsSalt: [u8; 16],
    rawFills: [u8; 8192],
    rawFillsLength: u32,
    startTime: pub u64,
    endTime: pub u64,
    baseBalance: i64,
    threshold: i64
) {
    assert(rawFillsLength <= 8192);

    helpers::enforceZeroPadding(rawFills, rawFillsLength);

    let saltedFills = helpers::appendSalt(rawFills, rawFillsLength, fillsSalt);
    let fillsHashBytes = sha256_var(saltedFills, rawFillsLength + helpers::SALT_LENGTH);
    let fillsHashField2 = helpers::hash32ToFieldTwo(fillsHashBytes);
    helpers::assertFieldTwoEqual(fillsHashField2, fillsCommitment);

    // The address string is always 42 bytes ("0x" + 40 hex), so its salted
    // preimage is the full buffer.
    let saltedAddress = helpers::appendSalt(address, 42, addressSalt);
    let addrHashBytes = sha256_var(saltedAddress, 42 + helpers::SALT_LENGTH);
    let addrHashField2 = helpers::hash32ToFieldTwo(addrHashBytes);
    helpers::assertFieldTwoEqual(addrHashField2, addressCommitment);

    if(rawFillsLength != 0) {
        parser::validateFills(rawFills, rawFillsLength, startTime, endTime, baseBalance, threshold);
    }
}
