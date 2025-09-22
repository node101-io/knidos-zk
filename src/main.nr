mod utils;
use trees::merkle::MerkleTree;
use trees::types::{MembershipProver, MT_Creator};
use crate::utils::{hasher, hash_tx_data};

struct Tx {
    tx_data: TxData,
    merkle_witness: MerkleWitness,
}

pub struct TxData {
    chain_id: Field,
    sender: Field,
    time: Field,
    amount: Field,
}

struct MerkleWitness {
    leaf: Field, // leaf is the tx_hash
    index: u32,
    siblings: [Field; 3],
}

fn main(merkle_root: pub Field, txs: [Tx; 8]) -> pub Field {
    let mut merkle_tree = MerkleTree::from(merkle_root, hasher);

    let mut sum = 0;
    for tx in txs {
        assert(tx.merkle_witness.leaf == hash_tx_data(tx.tx_data));

        merkle_tree.membership(
            tx.merkle_witness.leaf,
            tx.merkle_witness.index as Field,
            tx.merkle_witness.siblings,
        );

        sum += tx.tx_data.amount;
    }

    sum
}

#[test]
fn test_main() {
    // Define 8 transactions with incremental amounts 0..7
    let tx_datas: [TxData; 8] = [
        TxData { chain_id: 1, sender: 11, time: 1000, amount: 0 },
        TxData { chain_id: 1, sender: 12, time: 1001, amount: 1 },
        TxData { chain_id: 1, sender: 13, time: 1002, amount: 2 },
        TxData { chain_id: 1, sender: 14, time: 1003, amount: 3 },
        TxData { chain_id: 1, sender: 15, time: 1004, amount: 4 },
        TxData { chain_id: 1, sender: 16, time: 1005, amount: 5 },
        TxData { chain_id: 1, sender: 17, time: 1006, amount: 6 },
        TxData { chain_id: 1, sender: 18, time: 1007, amount: 7 },
    ];

    // Compute leaf hashes for each transaction
    let leaves: [Field; 8] = [
        hash_tx_data(tx_datas[0]),
        hash_tx_data(tx_datas[1]),
        hash_tx_data(tx_datas[2]),
        hash_tx_data(tx_datas[3]),
        hash_tx_data(tx_datas[4]),
        hash_tx_data(tx_datas[5]),
        hash_tx_data(tx_datas[6]),
        hash_tx_data(tx_datas[7]),
    ];

    // Build upper levels deterministically for a fixed-size tree of height 3 (8 leaves)
    let level1: [Field; 4] = [
        hasher([leaves[0], leaves[1]]),
        hasher([leaves[2], leaves[3]]),
        hasher([leaves[4], leaves[5]]),
        hasher([leaves[6], leaves[7]]),
    ];
    let level2: [Field; 2] = [
        hasher([level1[0], level1[1]]),
        hasher([level1[2], level1[3]]),
    ];
    let root = hasher([level2[0], level2[1]]);

    // Assemble witnesses for each index using the deterministic layout above
    let witnesses: [MerkleWitness; 8] = [
        MerkleWitness { leaf: leaves[0], index: 0, siblings: [leaves[1], level1[1], level2[1]] },
        MerkleWitness { leaf: leaves[1], index: 1, siblings: [leaves[0], level1[1], level2[1]] },
        MerkleWitness { leaf: leaves[2], index: 2, siblings: [leaves[3], level1[0], level2[1]] },
        MerkleWitness { leaf: leaves[3], index: 3, siblings: [leaves[2], level1[0], level2[1]] },
        MerkleWitness { leaf: leaves[4], index: 4, siblings: [leaves[5], level1[3], level2[0]] },
        MerkleWitness { leaf: leaves[5], index: 5, siblings: [leaves[4], level1[3], level2[0]] },
        MerkleWitness { leaf: leaves[6], index: 6, siblings: [leaves[7], level1[2], level2[0]] },
        MerkleWitness { leaf: leaves[7], index: 7, siblings: [leaves[6], level1[2], level2[0]] },
    ];

    let txs: [Tx; 8] = [
        Tx { tx_data: tx_datas[0], merkle_witness: witnesses[0] },
        Tx { tx_data: tx_datas[1], merkle_witness: witnesses[1] },
        Tx { tx_data: tx_datas[2], merkle_witness: witnesses[2] },
        Tx { tx_data: tx_datas[3], merkle_witness: witnesses[3] },
        Tx { tx_data: tx_datas[4], merkle_witness: witnesses[4] },
        Tx { tx_data: tx_datas[5], merkle_witness: witnesses[5] },
        Tx { tx_data: tx_datas[6], merkle_witness: witnesses[6] },
        Tx { tx_data: tx_datas[7], merkle_witness: witnesses[7] },
    ];

    assert(main(root, txs) == 28);
}
