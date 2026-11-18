// Tint notes: how money is written down inside the private pool.
//
// A note is one piece of money owned by one key:
//   owner      = H(OWNER_TAG, spend_key)
//   inner      = H(owner, blinding)
//   commitment = H(asset, amount, inner)
// Only the commitment goes on chain, as a leaf of one Merkle tree shared by
// every asset. The inner hash lets the pool contract finish a note whose amount
// it only learns after a swap, without the owner ever appearing on chain.
//
// Spending a note publishes its nullifier = H(commitment, leaf_index, spend_key).
// The pool stores nullifiers, so a note can be spent once, and nobody can tell
// which leaf a nullifier belongs to.
//
// Every hash here takes at most 3 inputs, so it is a single Poseidon2
// permutation. The pool contract computes the same hashes on chain
// (tree nodes and swap outputs) with the same parameters.

use poseidon::poseidon2::Poseidon2;

pub global TREE_DEPTH: u32 = 20;
pub global OWNER_TAG: Field = 1;
// Amounts and public values are kept under 2^112 so sums can never wrap the field.
pub global AMOUNT_BITS: u32 = 112;

pub fn hash2(a: Field, b: Field) -> Field {
    Poseidon2::hash([a, b], 2)
}

pub fn hash3(a: Field, b: Field, c: Field) -> Field {
    Poseidon2::hash([a, b, c], 3)
}

pub fn owner_of(spend_key: Field) -> Field {
    hash2(OWNER_TAG, spend_key)
}

pub fn inner_hash(owner: Field, blinding: Field) -> Field {
    hash2(owner, blinding)
}

pub fn commitment(asset: Field, amount: Field, inner: Field) -> Field {
    hash3(asset, amount, inner)
}

pub fn nullifier(commitment: Field, leaf_index: Field, spend_key: Field) -> Field {
    hash3(commitment, leaf_index, spend_key)
}

pub fn assert_amount(x: Field) {
    x.assert_max_bit_size::<AMOUNT_BITS>();
}

// Root of the tree that holds `leaf` at `index`, given the sibling path.
pub fn merkle_root(leaf: Field, index: Field, path: [Field; TREE_DEPTH]) -> Field {
    let bits: [bool; TREE_DEPTH] = index.to_le_bits();
    let mut node = leaf;
    for i in 0..TREE_DEPTH {
        let (left, right) = if bits[i] { (path[i], node) } else { (node, path[i]) };
        node = hash2(left, right);
    }
    node
}

// Checks two input notes owned by `spend_key` and their nullifiers.
// Real notes must be in the tree under `root`; amount-0 inputs are dummies.
// Returns the total amount spent.
pub fn spend_inputs(
    root: Field,
    nullifiers: [Field; 2],
    asset: Field,
    spend_key: Field,
    in_amount: [Field; 2],
    in_blinding: [Field; 2],
    in_index: [Field; 2],
    in_path: [[Field; TREE_DEPTH]; 2],
) -> Field {
    let owner = owner_of(spend_key);
    let mut total = 0;
    for i in 0..2 {
        assert_amount(in_amount[i]);
        let c = commitment(asset, in_amount[i], inner_hash(owner, in_blinding[i]));
        let r = merkle_root(c, in_index[i], in_path[i]);
        assert((r - root) * in_amount[i] == 0, "input note not in tree");
        assert(nullifiers[i] == nullifier(c, in_index[i], spend_key), "bad nullifier");
        total += in_amount[i];
    }
    assert(nullifiers[0] != nullifiers[1], "same note spent twice");
    total
}

// Root of an empty tree (all leaves 0). The pool contract starts from the same value.
pub fn empty_root() -> Field {
    let mut z = 0;
    for _ in 0..TREE_DEPTH {
        z = hash2(z, z);
    }
    z
}

#[test]
fn print_known_values() {
    // Fixed values the Solidity and JS sides are tested against.
    println(hash2(1, 2));
    println(hash3(1, 2, 3));
    println(empty_root());
}

#[test]
fn path_of_single_leaf_matches() {
    // A tree with one leaf at index 0: every sibling is an empty subtree.
    let mut path = [0; TREE_DEPTH];
    let mut z = 0;
    for i in 0..TREE_DEPTH {
        path[i] = z;
        z = hash2(z, z);
    }
    assert(merkle_root(0, 0, path) == empty_root());
    let leaf = commitment(7, 100, inner_hash(owner_of(42), 9));
    let r = merkle_root(leaf, 0, path);
    assert(r != empty_root());
    // Same leaf at index 1 gives a different root.
    assert(merkle_root(leaf, 1, path) != r);
}
