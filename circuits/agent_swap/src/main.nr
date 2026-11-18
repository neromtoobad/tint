// agent_swap: an agent trades inside an agent account, only within the rules.
//
// An agent account is a set of notes owned by
//   account = H(user_owner, agent_pub, rules_hash)
// The agent holds agent_key. With it the agent can trade, and nothing else:
//   - both assets are in the rules' list, so it only buys the stocks you picked
//   - one buy spends at most max_buy of cash (assets[0])
//   - the relayer fee is at most max_fee_bps of what it sells
//   - it only pays the relayer named in the rules
//   - it can't trade after ends_at (the deadline the pool enforces is <= ends_at)
//   - the change and the bought note stay in the same account
// Taking money out needs your spend key too (circuits/agent_transact).
// The rules never go on chain: only this proof that the trade follows them.
//
// Public inputs are the swap circuit's, plus relayer, fee and deadline, so the
// pool can check the proof against the values it actually uses.

use notes::{
    account_owner, agent_pub, assert_amount, commitment, inner_hash, le, nullifier_key,
    rules_allow, rules_hash, Rules, spend_owned, TREE_DEPTH,
};

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
    relayer: pub Field,
    fee: pub Field,
    deadline: pub Field,
    // private
    agent_key: Field,
    user_owner: Field,
    rules: Rules,
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
    assert_amount(fee);
    assert(amount_in != 0, "nothing to trade");
    assert(asset_in != asset_out, "same asset");

    // the rules
    assert(rules_allow(rules, asset_in), "asset not in the rules");
    assert(rules_allow(rules, asset_out), "asset not in the rules");
    if asset_in == rules.assets[0] {
        assert(le::<112>(amount_in, rules.max_buy), "buy over the limit");
    }
    rules.max_fee_bps.assert_max_bit_size::<14>();
    assert(
        (fee as u128) * 10000 <= (amount_in as u128) * (rules.max_fee_bps as u128),
        "fee over the limit",
    );
    assert(relayer == rules.relayer, "relayer not in the rules");
    assert(le::<64>(deadline, rules.ends_at), "rules have ended");

    // the account
    let account = account_owner(user_owner, agent_pub(agent_key), rules_hash(rules));
    let total = spend_owned(
        root,
        nullifiers,
        asset_in,
        account,
        nullifier_key(agent_key),
        in_amount,
        in_blinding,
        in_index,
        in_path,
    );
    assert(total == amount_in + change_amount, "amounts do not add up");
    assert(
        change_commitment == commitment(asset_in, change_amount, inner_hash(account, change_blinding)),
        "bad change note",
    );
    assert(out_inner == inner_hash(account, out_blinding), "bought note must stay in the account");
    assert(ext_hash * 0 == 0);
}

// ---------- tests ----------

global USDG: Field = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
global NVDA: Field = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
global TSLA: Field = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
global RELAYER: Field = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

fn empty_path() -> [Field; TREE_DEPTH] {
    let mut path = [0; TREE_DEPTH];
    let mut z = 0;
    for i in 0..TREE_DEPTH {
        path[i] = z;
        z = notes::hash2(z, z);
    }
    path
}

struct Case {
    agent_key: Field,
    user_owner: Field,
    rules: Rules,
    asset_in: Field,
    amount_in: Field,
    asset_out: Field,
    note_amount: Field,
    change_amount: Field,
    out_owner: Field, // 0 = the account
    relayer: Field,
    fee: Field,
    deadline: Field,
    proving_key: Field, // the key the prover claims; normally agent_key
}

fn rules() -> Rules {
    Rules { assets: [USDG, NVDA, 0, 0, 0, 0], max_buy: 50, max_fee_bps: 500, ends_at: 2000000000, relayer: RELAYER }
}

// The agent buys 40 USDG of NVDA from a 100 USDG note, paying a 1 USDG fee.
fn base() -> Case {
    Case {
        agent_key: 99,
        user_owner: notes::owner_of(4242),
        rules: rules(),
        asset_in: USDG,
        amount_in: 40,
        asset_out: NVDA,
        note_amount: 100,
        change_amount: 60,
        out_owner: 0,
        relayer: RELAYER,
        fee: 1,
        deadline: 1900000000,
        proving_key: 99,
    }
}

fn run(c: Case) {
    // the real account and its note at leaf 0
    let account = account_owner(c.user_owner, agent_pub(c.agent_key), rules_hash(rules()));
    let path = empty_path();
    let note = commitment(c.asset_in, c.note_amount, inner_hash(account, 1));
    let root = notes::merkle_root(note, 0, path);
    // what the prover builds, from the key and rules it claims
    let claimed = account_owner(c.user_owner, agent_pub(c.proving_key), rules_hash(c.rules));
    let nk = nullifier_key(c.proving_key);
    let mine = commitment(c.asset_in, c.note_amount, inner_hash(claimed, 1));
    let dummy = commitment(c.asset_in, 0, inner_hash(claimed, 2));
    let out_owner = if c.out_owner == 0 { claimed } else { c.out_owner };
    main(
        root,
        [notes::nullifier(mine, 0, nk), notes::nullifier(dummy, 0, nk)],
        c.asset_in,
        c.amount_in,
        c.asset_out,
        1,
        commitment(c.asset_in, c.change_amount, inner_hash(claimed, 50)),
        inner_hash(out_owner, 60),
        0,
        c.relayer,
        c.fee,
        c.deadline,
        c.proving_key,
        c.user_owner,
        c.rules,
        [c.note_amount, 0],
        [1, 2],
        [0, 0],
        [path, path],
        c.change_amount,
        50,
        60,
    );
}

#[test]
fn buys_within_the_rules() {
    run(base());
}

#[test]
fn sells_are_not_capped_by_max_buy() {
    let mut c = base();
    c.asset_in = NVDA;
    c.asset_out = USDG;
    c.amount_in = 100;
    c.change_amount = 0;
    run(c);
}

#[test(should_fail_with = "buy over the limit")]
fn cannot_buy_more_than_max_buy() {
    let mut c = base();
    c.amount_in = 51;
    c.change_amount = 49;
    run(c);
}

#[test(should_fail_with = "asset not in the rules")]
fn cannot_buy_a_stock_you_did_not_pick() {
    let mut c = base();
    c.asset_out = TSLA;
    run(c);
}

#[test(should_fail_with = "fee over the limit")]
fn cannot_overpay_the_relayer() {
    let mut c = base();
    c.fee = 3; // 7.5% of 40, rules allow 5%
    run(c);
}

#[test(should_fail_with = "relayer not in the rules")]
fn cannot_pay_another_relayer() {
    let mut c = base();
    c.relayer = 0xbeef;
    run(c);
}

#[test(should_fail_with = "rules have ended")]
fn cannot_trade_after_the_end() {
    let mut c = base();
    c.deadline = 2000000001;
    run(c);
}

#[test(should_fail_with = "bought note must stay in the account")]
fn bought_note_cannot_leave_the_account() {
    let mut c = base();
    c.out_owner = c.user_owner; // even to the user's own main balance
    run(c);
}

#[test(should_fail_with = "input note not in tree")]
fn changing_the_rules_changes_the_account() {
    // Claiming looser rules gives a different account, which holds nothing.
    let mut c = base();
    c.rules.max_buy = 1000;
    run(c);
}

#[test(should_fail_with = "input note not in tree")]
fn another_key_cannot_trade() {
    let mut c = base();
    c.proving_key = 100;
    run(c);
}
