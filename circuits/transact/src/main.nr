// transact: 2 notes in, 2 notes out, one asset.
//
// Covers deposit (public_in > 0), withdraw (public_out > 0) and private
// transfers (both 0). Value is conserved:
//   in[0] + in[1] + public_in == out[0] + out[1] + public_out
//
// The asset stays private for private transfers. When money enters or leaves
// the pool, the asset must equal public_asset so the contract moves the right token.
//
// ext_hash binds the parts the prover must not let anyone change: recipient,
// relayer, fee and the encrypted notes (hashed on chain, see TintPool).
//
// An input with amount 0 is a dummy: its Merkle path is not checked, so a
// deposit needs no existing notes. It still publishes a nullifier, which the
// two inputs must not share.

use notes::{
    assert_amount, commitment, inner_hash, merkle_root, nullifier, owner_of, spend_inputs,
    TREE_DEPTH,
};

fn main(
    // public
    root: pub Field,
    public_asset: pub Field,
    public_in: pub Field,
    public_out: pub Field,
    ext_hash: pub Field,
    nullifiers: pub [Field; 2],
    out_commitments: pub [Field; 2],
    // private
    asset: Field,
    spend_key: Field,
    in_amount: [Field; 2],
    in_blinding: [Field; 2],
    in_index: [Field; 2],
    in_path: [[Field; TREE_DEPTH]; 2],
    out_amount: [Field; 2],
    out_owner: [Field; 2],
    out_blinding: [Field; 2],
) {
    assert_amount(public_in);
    assert_amount(public_out);

    let total_in = public_in
        + spend_inputs(
            root,
            nullifiers,
            asset,
            spend_key,
            in_amount,
            in_blinding,
            in_index,
            in_path,
        );

    let mut total_out = public_out;
    for i in 0..2 {
        assert_amount(out_amount[i]);
        let c = commitment(asset, out_amount[i], inner_hash(out_owner[i], out_blinding[i]));
        assert(out_commitments[i] == c, "bad output note");
        total_out += out_amount[i];
    }

    assert(total_in == total_out, "amounts do not add up");
    // Tokens only move in or out in the note's own asset.
    assert((public_in + public_out) * (asset - public_asset) == 0, "wrong asset");
    // Keep ext_hash a live public input (it is checked against keccak of the ext data on chain).
    assert(ext_hash * 0 == 0);
}

// ---------- tests ----------

#[test]
fn deposit_then_withdraw() {
    let asset = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; // USDG
    let sk = 12345;
    let owner = owner_of(sk);
    let empty_path = empty_path();

    // Deposit 100: two dummy inputs, one real output of 100, one 0 output.
    let out0 = commitment(asset, 100, inner_hash(owner, 777));
    let out1 = commitment(asset, 0, inner_hash(owner, 778));
    let d0 = commitment(asset, 0, inner_hash(owner, 1));
    let d1 = commitment(asset, 0, inner_hash(owner, 2));
    main(
        notes::empty_root(),
        asset,
        100,
        0,
        5,
        [nullifier(d0, 0, notes::nullifier_key(sk)), nullifier(d1, 0, notes::nullifier_key(sk))],
        [out0, out1],
        asset,
        sk,
        [0, 0],
        [1, 2],
        [0, 0],
        [empty_path, empty_path],
        [100, 0],
        [owner, owner],
        [777, 778],
    );

    // Withdraw 60 of it, 40 back as change. out0 is leaf 0, out1 leaf 1.
    let mut path0 = empty_path;
    path0[0] = out1;
    let root = merkle_root(out0, 0, path0);
    let change = commitment(asset, 40, inner_hash(owner, 900));
    let zero = commitment(asset, 0, inner_hash(owner, 901));
    let d = commitment(asset, 0, inner_hash(owner, 3));
    main(
        root,
        asset,
        0,
        60,
        6,
        [nullifier(out0, 0, notes::nullifier_key(sk)), nullifier(d, 0, notes::nullifier_key(sk))],
        [change, zero],
        asset,
        sk,
        [100, 0],
        [777, 3],
        [0, 0],
        [path0, empty_path],
        [40, 0],
        [owner, owner],
        [900, 901],
    );
}

#[test(should_fail_with = "amounts do not add up")]
fn cannot_withdraw_more_than_held() {
    let asset = 9;
    let sk = 5;
    let owner = owner_of(sk);
    let empty_path = empty_path();
    let note = commitment(asset, 100, inner_hash(owner, 1));
    let root = merkle_root(note, 0, empty_path);
    let d = commitment(asset, 0, inner_hash(owner, 2));
    let o0 = commitment(asset, 0, inner_hash(owner, 3));
    let o1 = commitment(asset, 0, inner_hash(owner, 4));
    main(
        root,
        asset,
        0,
        101,
        0,
        [nullifier(note, 0, notes::nullifier_key(sk)), nullifier(d, 0, notes::nullifier_key(sk))],
        [o0, o1],
        asset,
        sk,
        [100, 0],
        [1, 2],
        [0, 0],
        [empty_path, empty_path],
        [0, 0],
        [owner, owner],
        [3, 4],
    );
}

#[test(should_fail_with = "input note not in tree")]
fn cannot_spend_someone_elses_note() {
    let asset = 9;
    let victim = owner_of(5);
    let empty_path = empty_path();
    let note = commitment(asset, 100, inner_hash(victim, 1));
    let root = merkle_root(note, 0, empty_path);
    // Attacker uses their own key: the recomputed note is not the victim's leaf.
    let sk = 6;
    let owner = owner_of(sk);
    let mine = commitment(asset, 100, inner_hash(owner, 1));
    let d = commitment(asset, 0, inner_hash(owner, 2));
    let o0 = commitment(asset, 0, inner_hash(owner, 3));
    let o1 = commitment(asset, 0, inner_hash(owner, 4));
    main(
        root,
        asset,
        0,
        100,
        0,
        [nullifier(mine, 0, notes::nullifier_key(sk)), nullifier(d, 0, notes::nullifier_key(sk))],
        [o0, o1],
        asset,
        sk,
        [100, 0],
        [1, 2],
        [0, 0],
        [empty_path, empty_path],
        [0, 0],
        [owner, owner],
        [3, 4],
    );
}

#[test(should_fail_with = "wrong asset")]
fn cannot_withdraw_a_different_token() {
    let asset = 9;
    let sk = 5;
    let owner = owner_of(sk);
    let empty_path = empty_path();
    let note = commitment(asset, 100, inner_hash(owner, 1));
    let root = merkle_root(note, 0, empty_path);
    let d = commitment(asset, 0, inner_hash(owner, 2));
    let o0 = commitment(asset, 0, inner_hash(owner, 3));
    let o1 = commitment(asset, 0, inner_hash(owner, 4));
    main(
        root,
        10, // ask the contract to pay out token 10 from a token-9 note
        0,
        100,
        0,
        [nullifier(note, 0, notes::nullifier_key(sk)), nullifier(d, 0, notes::nullifier_key(sk))],
        [o0, o1],
        asset,
        sk,
        [100, 0],
        [1, 2],
        [0, 0],
        [empty_path, empty_path],
        [0, 0],
        [owner, owner],
        [3, 4],
    );
}

#[test(should_fail_with = "same note spent twice")]
fn cannot_spend_one_note_twice_in_one_tx() {
    let asset = 9;
    let sk = 5;
    let owner = owner_of(sk);
    let empty_path = empty_path();
    let note = commitment(asset, 100, inner_hash(owner, 1));
    let root = merkle_root(note, 0, empty_path);
    let n = nullifier(note, 0, notes::nullifier_key(sk));
    let o0 = commitment(asset, 200, inner_hash(owner, 3));
    let o1 = commitment(asset, 0, inner_hash(owner, 4));
    main(
        root,
        asset,
        0,
        0,
        0,
        [n, n],
        [o0, o1],
        asset,
        sk,
        [100, 100],
        [1, 1],
        [0, 0],
        [empty_path, empty_path],
        [200, 0],
        [owner, owner],
        [3, 4],
    );
}

fn empty_path() -> [Field; TREE_DEPTH] {
    let mut path = [0; TREE_DEPTH];
    let mut z = 0;
    for i in 0..TREE_DEPTH {
        path[i] = z;
        z = notes::hash2(z, z);
    }
    path
}
