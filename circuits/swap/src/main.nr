// swap: trade from inside the private balance.
//
// Spends up to two notes of asset_in and makes:
//   - a change note in asset_in (private amount), and
//   - the inner hash of the note that will hold what the trade buys.
// The pool contract sells amount_in on a public Uniswap pool, checks it got at
// least min_out, and only then finishes the bought note itself:
//   commitment = H(asset_out, amount_out, out_inner)
// So the trade (assets and amounts) is public, as it must be on a public pool,
// but who made it is not, and the bought note can't be linked to the spent ones.
//
// The bought note always belongs to the spender (out_inner uses their own key).
//
// ext_hash binds the relayer, fee, Uniswap fee tier, deadline and encrypted notes.

use notes::{assert_amount, commitment, inner_hash, owner_of, spend_inputs, TREE_DEPTH};

fn main(
    // public
    root: pub Field,
    nullifiers: pub [Field; 2],
    asset_in: pub Field,
    amount_in: pub Field,
    asset_out: pub Field,
    min_out: pub Field,
    change_commitment: pub Field,
    out_inner: pub Field,
    ext_hash: pub Field,
    // private
    spend_key: Field,
    in_amount: [Field; 2],
    in_blinding: [Field; 2],
    in_index: [Field; 2],
    in_path: [[Field; TREE_DEPTH]; 2],
    change_amount: Field,
    change_blinding: Field,
    out_blinding: Field,
) {
    assert_amount(amount_in);
    assert_amount(min_out);
    assert_amount(change_amount);
    assert(amount_in != 0, "nothing to trade");
    assert(asset_in != asset_out, "same asset");

    let total = spend_inputs(
        root,
        nullifiers,
        asset_in,
        spend_key,
        in_amount,
        in_blinding,
        in_index,
        in_path,
    );
    assert(total == amount_in + change_amount, "amounts do not add up");

    let owner = owner_of(spend_key);
    assert(
        change_commitment == commitment(asset_in, change_amount, inner_hash(owner, change_blinding)),
        "bad change note",
    );
    assert(out_inner == inner_hash(owner, out_blinding), "bought note must be yours");
    assert(ext_hash * 0 == 0);
}

// ---------- tests ----------

global USDG: Field = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
global NVDA: Field = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;

fn empty_path() -> [Field; TREE_DEPTH] {
    let mut path = [0; TREE_DEPTH];
    let mut z = 0;
    for i in 0..TREE_DEPTH {
        path[i] = z;
        z = notes::hash2(z, z);
    }
    path
}

struct Setup {
    sk: Field,
    owner: Field,
    note: Field,
    root: Field,
    path: [Field; TREE_DEPTH],
    dummy: Field,
}

// One 100 USDG note at leaf 0.
fn setup() -> Setup {
    let sk = 4242;
    let owner = owner_of(sk);
    let path = empty_path();
    let note = commitment(USDG, 100, inner_hash(owner, 1));
    let root = notes::merkle_root(note, 0, path);
    let dummy = commitment(USDG, 0, inner_hash(owner, 2));
    Setup { sk, owner, note, root, path, dummy }
}

#[test]
fn buy_with_part_of_a_note() {
    let s = setup();
    main(
        s.root,
        [notes::nullifier(s.note, 0, s.sk), notes::nullifier(s.dummy, 0, s.sk)],
        USDG,
        60,
        NVDA,
        1,
        commitment(USDG, 40, inner_hash(s.owner, 50)),
        inner_hash(s.owner, 60),
        0,
        s.sk,
        [100, 0],
        [1, 2],
        [0, 0],
        [s.path, s.path],
        40,
        50,
        60,
    );
}

#[test(should_fail_with = "amounts do not add up")]
fn cannot_sell_more_than_held() {
    let s = setup();
    main(
        s.root,
        [notes::nullifier(s.note, 0, s.sk), notes::nullifier(s.dummy, 0, s.sk)],
        USDG,
        101,
        NVDA,
        1,
        commitment(USDG, 0, inner_hash(s.owner, 50)),
        inner_hash(s.owner, 60),
        0,
        s.sk,
        [100, 0],
        [1, 2],
        [0, 0],
        [s.path, s.path],
        0,
        50,
        60,
    );
}

#[test(should_fail_with = "input note not in tree")]
fn cannot_sell_a_different_asset_than_the_note() {
    // The note is USDG; claiming it is NVDA changes its commitment.
    let s = setup();
    let fake = commitment(NVDA, 100, inner_hash(s.owner, 1));
    main(
        s.root,
        [notes::nullifier(fake, 0, s.sk), notes::nullifier(s.dummy, 0, s.sk)],
        NVDA,
        100,
        USDG,
        1,
        commitment(NVDA, 0, inner_hash(s.owner, 50)),
        inner_hash(s.owner, 60),
        0,
        s.sk,
        [100, 0],
        [1, 2],
        [0, 0],
        [s.path, s.path],
        0,
        50,
        60,
    );
}

#[test(should_fail_with = "bought note must be yours")]
fn bought_note_goes_to_the_spender() {
    let s = setup();
    let someone_else = owner_of(777);
    main(
        s.root,
        [notes::nullifier(s.note, 0, s.sk), notes::nullifier(s.dummy, 0, s.sk)],
        USDG,
        100,
        NVDA,
        1,
        commitment(USDG, 0, inner_hash(s.owner, 50)),
        inner_hash(someone_else, 60),
        0,
        s.sk,
        [100, 0],
        [1, 2],
        [0, 0],
        [s.path, s.path],
        0,
        50,
        60,
    );
}

#[test(should_fail_with = "same asset")]
fn cannot_swap_to_the_same_asset() {
    let s = setup();
    main(
        s.root,
        [notes::nullifier(s.note, 0, s.sk), notes::nullifier(s.dummy, 0, s.sk)],
        USDG,
        100,
        USDG,
        1,
        commitment(USDG, 0, inner_hash(s.owner, 50)),
        inner_hash(s.owner, 60),
        0,
        s.sk,
        [100, 0],
        [1, 2],
        [0, 0],
        [s.path, s.path],
        0,
        50,
        60,
    );
}
