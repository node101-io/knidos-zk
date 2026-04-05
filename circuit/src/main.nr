mod helpers;
mod parser;

use sha256::sha256_var;

fn main(
    fillsCommitment: pub [Field; 2],
    rawFills: [u8; 8192],
    rawFillsLength: u32,
    fillCount: u32,
    startTime: u64,
    endTime: u64,
    baseBalance: i64,
    threshold: i64
) {
    assert(rawFillsLength <= 8192);

    helpers::enforceZeroPadding(rawFills, rawFillsLength);

    let fillsHashBytes = sha256_var(rawFills, rawFillsLength);
    let fillsHashField2 = helpers::hash32ToFieldTwo(fillsHashBytes);
    helpers::aseertFieldTwoEqual(fillsHashField2, fillsCommitment);

    if(rawFillsLength != 0) {
        parser::validateFills(rawFills, rawFillsLength, fillCount, startTime, endTime, baseBalance, threshold);
    }
}