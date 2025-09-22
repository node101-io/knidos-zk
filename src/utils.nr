use poseidon::poseidon2::Poseidon2::hash;
use keccak256::keccak256;
use crate::TxData;

pub fn hasher(leaves: [Field; 2]) -> Field {
    hash(leaves, 2)
}

fn concat_32_bytes(a: [u8; 32], b: [u8; 32]) -> [u8; 64] {
    let mut out = [0; 64];
    for i in 0..32 {
        out[i] = a[i];
        out[32 + i] = b[i];
    }
    out
}

fn bytes32_to_field_be(bytes: [u8; 32]) -> Field {
    let mut value = 0;
    let mut multiplier = 1;
    for i in 0..32 {
        value += multiplier * (bytes[31 - i] as Field);
        multiplier *= 256;
    }
    value
}

pub fn hash_tx_data(data: TxData) -> Field {
    let left = keccak256(
        concat_32_bytes(data.chain_id.to_be_bytes(), data.sender.to_be_bytes()),
        64,
    );
    let right1 = keccak256(
        concat_32_bytes(data.time.to_be_bytes(), data.amount.to_be_bytes()),
        64,
    );
    let right = keccak256(concat_32_bytes(right1, data.token_id.to_be_bytes()), 64);
    let final_hash = keccak256(concat_32_bytes(left, right), 64);
    bytes32_to_field_be(final_hash)
}
