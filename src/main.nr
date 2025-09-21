use poseidon::poseidon2::Poseidon2::hash;
use trees::merkle::MerkleTree;
use trees::types::{MembershipProver, MT_Creator};

fn hasher(leaves: [Field; 2]) -> Field {
    hash(leaves, 2)
}

struct Tx {
    tx_data: Field, // includes information about the tx (amount for now)
    merkle_witness: MerkleWitness,
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
        merkle_tree.membership(
            tx.merkle_witness.leaf,
            tx.merkle_witness.index as Field,
            tx.merkle_witness.siblings,
        );
        sum += tx.tx_data;
    }

    sum
}

#[test]
fn test_main() {
    let root = 2643021468297453499851515284980395843699180103854852140659542342283254751912;

    let txs: [Tx; 8] = [
        Tx {
            tx_data: 0,
            merkle_witness: MerkleWitness {
                leaf: 1,
                index: 0,
                siblings: [
                    2,
                    17380952042446168291178743041044530828369674063485643659763567652647121881611,
                    15894561042126677602478866251981380308532972212781201775474357351932367051138,
                ],
            },
        },
        Tx {
            tx_data: 1,
            merkle_witness: MerkleWitness {
                leaf: 2,
                index: 1,
                siblings: [
                    1,
                    17380952042446168291178743041044530828369674063485643659763567652647121881611,
                    15894561042126677602478866251981380308532972212781201775474357351932367051138,
                ],
            },
        },
        Tx {
            tx_data: 2,
            merkle_witness: MerkleWitness {
                leaf: 3,
                index: 2,
                siblings: [
                    4,
                    1594597865669602199208529098208508950092942746041644072252494753744672355203,
                    15894561042126677602478866251981380308532972212781201775474357351932367051138,
                ],
            },
        },
        Tx {
            tx_data: 3,
            merkle_witness: MerkleWitness {
                leaf: 4,
                index: 3,
                siblings: [
                    3,
                    1594597865669602199208529098208508950092942746041644072252494753744672355203,
                    15894561042126677602478866251981380308532972212781201775474357351932367051138,
                ],
            },
        },
        Tx {
            tx_data: 4,
            merkle_witness: MerkleWitness {
                leaf: 5,
                index: 4,
                siblings: [
                    6,
                    14238249223938691303147797241445406391754730321105987504683642791543592162684,
                    18145963038378645805713504092197197549342394757429773105454438568839292866655,
                ],
            },
        },
        Tx {
            tx_data: 5,
            merkle_witness: MerkleWitness {
                leaf: 6,
                index: 5,
                siblings: [
                    5,
                    14238249223938691303147797241445406391754730321105987504683642791543592162684,
                    18145963038378645805713504092197197549342394757429773105454438568839292866655,
                ],
            },
        },
        Tx {
            tx_data: 6,
            merkle_witness: MerkleWitness {
                leaf: 7,
                index: 6,
                siblings: [
                    8,
                    12096576599834478317592210225257899548976626129824898535087186730386772533086,
                    18145963038378645805713504092197197549342394757429773105454438568839292866655,
                ],
            },
        },
        Tx {
            tx_data: 7,
            merkle_witness: MerkleWitness {
                leaf: 8,
                index: 7,
                siblings: [
                    7,
                    12096576599834478317592210225257899548976626129824898535087186730386772533086,
                    18145963038378645805713504092197197549342394757429773105454438568839292866655,
                ],
            },
        },
    ];

    assert(main(root, txs) == 28);
}
