// agent_transact: move money out of an agent account (stop the agent, or take
// some back). Same as transact, but the notes belong to an agent account:
//   account = H(owner_of(spend_key), agent_pub(agent_key), rules_hash)
// The proof needs BOTH the user's spend key and the agent key. The agent alone
// can't make it, so it can never move money out of the account.
// Outputs can go anywhere: back to the user's private balance, or out of the pool.

use notes::{
    account_owner, agent_pub, assert_amount, commitment, inner_hash, nullifier_key, owner_of,
    spend_owned, TREE_DEPTH,
};

fn main(
    // public (same order as transact, so the pool reuses its input layout)
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
    agent_key: Field,
    rules_hash: Field,
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

    let account = account_owner(owner_of(spend_key), agent_pub(agent_key), rules_hash);
    let total_in = public_in
        + spend_owned(
            root,
            nullifiers,
            asset,
            account,
            nullifier_key(agent_key),
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
    assert((public_in + public_out) * (asset - public_asset) == 0, "wrong asset");
    assert(ext_hash * 0 == 0);
}

// ---------- tests ----------

global USDG: Field = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

fn empty_path() -> [Field; TREE_DEPTH] {
    let mut path = [0; TREE_DEPTH];
    let mut z = 0;
    for i in 0..TREE_DEPTH {
        path[i] = z;
        z = notes::hash2(z, z);
    }
    path
}

// The account holds 100 USDG at leaf 0. Someone proves with (spend_key, agent_key)
// and takes 30 out of the pool and 70 back to the user's own balance.
fn take_out(spend_key: Field, agent_key: Field) {
    let user_sk = 4242;
    let rh = 777;
    let account = account_owner(owner_of(user_sk), agent_pub(99), rh);
    let path = empty_path();
    let note = commitment(USDG, 100, inner_hash(account, 1));
    let root = notes::merkle_root(note, 0, path);

    let claimed = account_owner(owner_of(spend_key), agent_pub(agent_key), rh);
    let nk = nullifier_key(agent_key);
    let mine = commitment(USDG, 100, inner_hash(claimed, 1));
    let dummy = commitment(USDG, 0, inner_hash(claimed, 2));
    let me = owner_of(user_sk);
    main(
        root,
        USDG,
        0,
        30,
        0,
        [notes::nullifier(mine, 0, nk), notes::nullifier(dummy, 0, nk)],
        [commitment(USDG, 70, inner_hash(me, 5)), commitment(USDG, 0, inner_hash(me, 6))],
        USDG,
        spend_key,
        agent_key,
        rh,
        [100, 0],
        [1, 2],
        [0, 0],
        [path, path],
        [70, 0],
        [me, me],
        [5, 6],
    );
}

#[test]
fn user_with_both_keys_can_take_money_out() {
    take_out(4242, 99);
}

#[test(should_fail_with = "input note not in tree")]
fn the_agent_alone_cannot_take_money_out() {
    // The agent knows its own key, not the user's spend key.
    take_out(1, 99);
}

#[test(should_fail_with = "input note not in tree")]
fn the_spend_key_needs_the_right_agent_key() {
    take_out(4242, 98);
}
