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
// Spending a note publishes its nullifier = H(commitment, leaf_index, nk), where
// nk = H(NK_TAG, spend_key) is the nullifier key. The pool stores nullifiers, so a
// note can be spent once, and nobody can tell which leaf a nullifier belongs to.
// The viewing key a user can hand to an accountant includes nk, so it shows which
// notes were spent, but it can't spend (that needs spend_key itself).
//
// Every hash here takes at most 3 inputs, so it is a single Poseidon2
// permutation. The pool contract computes the same hashes on chain
// (tree nodes and swap outputs) with the same parameters.

use poseidon::poseidon2::Poseidon2;

pub global TREE_DEPTH: u32 = 20;
pub global OWNER_TAG: Field = 1;
pub global NK_TAG: Field = 2;
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

pub fn nullifier_key(spend_key: Field) -> Field {
    hash2(NK_TAG, spend_key)
}

pub fn nullifier(commitment: Field, leaf_index: Field, nk: Field) -> Field {
    hash3(commitment, leaf_index, nk)
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
    let nk = nullifier_key(spend_key);
    let mut total = 0;
    for i in 0..2 {
        assert_amount(in_amount[i]);
        let c = commitment(asset, in_amount[i], inner_hash(owner, in_blinding[i]));
        let r = merkle_root(c, in_index[i], in_path[i]);
        assert((r - root) * in_amount[i] == 0, "input note not in tree");
        assert(nullifiers[i] == nullifier(c, in_index[i], nk), "bad nullifier");
        total += in_amount[i];
    }
    assert(nullifiers[0] != nullifiers[1], "same note spent twice");
    total
}

// ---------------------------------------------------------------- agent accounts
//
// An agent account is a set of notes owned by
//   account_owner = H(user_owner, agent_pub, rules_hash)
// where agent_pub = H(AGENT_TAG, agent_key) and the nullifier key is H(NK_TAG, agent_key).
// The agent key alone can only swap inside the account, within the rules
// (agent_swap). Moving money out needs the user's spend key too (agent_transact).
// The rules never go on chain; only proofs that a trade follows them do.

pub global AGENT_TAG: Field = 3;
pub global RULE_ASSETS: u32 = 6;

pub struct Rules {
    // assets the agent may hold and trade; assets[0] is the cash token (USDG).
    // Unused slots are 0, which never matches a real token.
    pub assets: [Field; RULE_ASSETS],
    // the most cash one buy may spend (token units)
    pub max_buy: Field,
    // the most one trade may pay its relayer, in basis points of what it sells
    pub max_fee_bps: Field,
    // unix time after which the agent can't trade
    pub ends_at: Field,
    // the only relayer the agent may pay
    pub relayer: Field,
}

pub fn agent_pub(agent_key: Field) -> Field {
    hash2(AGENT_TAG, agent_key)
}

pub fn rules_hash(r: Rules) -> Field {
    let mut h = hash3(r.assets[0], r.assets[1], r.assets[2]);
    h = hash3(h, r.assets[3], r.assets[4]);
    h = hash3(h, r.assets[5], r.max_buy);
    h = hash3(h, r.max_fee_bps, r.ends_at);
    hash2(h, r.relayer)
}

pub fn account_owner(user_owner: Field, agent_pub: Field, rules_hash: Field) -> Field {
    hash3(user_owner, agent_pub, rules_hash)
}

// a <= b for values below 2^BITS (both are range checked here).
pub fn le<let BITS: u32>(a: Field, b: Field) -> bool {
    a.assert_max_bit_size::<BITS>();
    b.assert_max_bit_size::<BITS>();
    (a as u128) <= (b as u128)
}

pub fn rules_allow(r: Rules, asset: Field) -> bool {
    let mut product = 1;
    for i in 0..RULE_ASSETS {
        product *= asset - r.assets[i];
    }
    (product == 0) & (asset != 0)
}

// Same as spend_inputs, for notes whose owner and nullifier key are given directly.
pub fn spend_owned(
    root: Field,
    nullifiers: [Field; 2],
    asset: Field,
    owner: Field,
    nk: Field,
    in_amount: [Field; 2],
    in_blinding: [Field; 2],
    in_index: [Field; 2],
    in_path: [[Field; TREE_DEPTH]; 2],
) -> Field {
    let mut total = 0;
    for i in 0..2 {
        assert_amount(in_amount[i]);
        let c = commitment(asset, in_amount[i], inner_hash(owner, in_blinding[i]));
        let r = merkle_root(c, in_index[i], in_path[i]);
        assert((r - root) * in_amount[i] == 0, "input note not in tree");
        assert(nullifiers[i] == nullifier(c, in_index[i], nk), "bad nullifier");
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
    let r = Rules { assets: [1, 2, 3, 0, 0, 0], max_buy: 100, max_fee_bps: 500, ends_at: 2000000000, relayer: 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC };
    println(rules_hash(r));
    println(account_owner(owner_of(42), agent_pub(7), rules_hash(r)));
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
