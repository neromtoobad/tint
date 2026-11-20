// The Tint wallet engine. Rebuilds your private balance from the pool's events
// (nothing is stored on a server), and builds each action ready to prove.
import { bytesToHex as viemBytesToHex, getAbiItem, hexToBytes } from 'viem';
import { tintPoolAbi } from './abi.js';
import { buildAgentSwap, buildAgentTransact, decodeAgentMemo } from './agent.js';
import { decryptNote, encryptNote, NOTE, SWAP_OUT } from './encrypt.js';
import { randomField } from './hash.js';
import { decodeAddress } from './keys.js';
import { commitmentOf, innerHash, nullifierOf } from './notes.js';
import { buildSwap } from './swap.js';
import { buildTransact } from './transact.js';
import { MerkleTree } from './tree.js';

const EVENTS = ['NewCommitment', 'NewNullifier', 'Transacted', 'Swapped'].map((name) =>
  getAbiItem({ abi: tintPoolAbi, name }),
);
const TREE_ABI = [{ type: 'function', name: 'nextIndex', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] }];
const ZERO = '0x0000000000000000000000000000000000000000';
const toAddr = (x) => '0x' + BigInt(x).toString(16).padStart(40, '0');

export class TintWallet {
  /**
   * @param client   viem PublicClient for the chain
   * @param pool     TintPool address
   * @param fromBlock block the pool was deployed in
   * @param keys     from keysFromSignature / keysFromSeed, importViewingKey (read-only),
   *                 or agentAccountKeys (an agent account: trades with agentSwap,
   *                 and moves money out only if the user's spend key is there)
   */
  constructor({ client, pool, fromBlock = 0n, keys, chunk = 50_000n }) {
    this.client = client;
    this.pool = pool;
    this.keys = keys;
    this.nextBlock = BigInt(fromBlock);
    this.chunk = BigInt(chunk);
    this.tree = new MerkleTree();
    this.notes = []; // { asset, amount, blinding, index, commitment, nullifier, spent, txHash, source }
    this.nullifiers = new Set();
    this.nullifierTx = new Map(); // nullifier -> txHash
    this.swapsByTx = new Map(); // txHash -> { assetIn, assetOut, amountSold, amountOut }
    this.publicByTx = new Map(); // txHash -> { asset, publicIn, publicOut }
    this.pendingBought = []; // swap notes waiting for their Swapped event
    this.txOrder = [];
    this.agentMemos = new Map(); // agent index -> { index, name, rules, plan, txHash, block }
  }

  /**
   * Reads new pool events up to the latest block. Calls never overlap (that would
   * apply events twice): a call made during a sync waits for it, then runs once more,
   * so it always sees blocks mined before it was called.
   */
  sync() {
    if (this._syncing) {
      this._again ??= this._syncing.then(() => {
        this._again = null;
        return this.sync();
      });
      return this._again;
    }
    this._syncing = this._sync().finally(() => {
      this._syncing = null;
    });
    return this._syncing;
  }

  async _sync() {
    // A public RPC is several nodes behind one URL, and one can be a few blocks
    // behind another: it may answer getLogs without the newest block's events.
    // So read every new event first, check the count of notes against the tree's
    // own count at that block, and apply nothing until they match.
    for (let attempt = 1; ; attempt++) {
      const latest = await this.client.getBlockNumber();
      if (this.nextBlock > latest) break;
      const logs = [];
      for (let from = this.nextBlock; from <= latest; ) {
        let to = from + this.chunk - 1n;
        if (to > latest) to = latest;
        try {
          logs.push(...(await this.client.getLogs({ address: this.pool, events: EVENTS, fromBlock: from, toBlock: to })));
        } catch (e) {
          if (this.chunk > 1_000n) {
            this.chunk /= 4n; // the RPC refused the range; try smaller pieces
            continue;
          }
          throw e;
        }
        from = to + 1n;
      }
      const leaves = await this._leafCountAt(latest);
      const found = logs.filter((l) => l.eventName === 'NewCommitment').length;
      if (leaves === null || this.tree.size + found !== leaves) {
        if (attempt >= 8) throw new Error('The network RPC is behind right now. Try again in a moment.');
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      this._apply(logs);
      this.nextBlock = latest + 1n;
      break;
    }
    for (const n of this.notes) {
      n.spent = this.nullifiers.has(n.nullifier);
      n.spentTx = this.nullifierTx.get(n.nullifier);
    }
    return this;
  }

  /** How many notes the tree held at `block`, or null if this RPC node doesn't have that block yet. */
  async _leafCountAt(block) {
    try {
      this._tree ??= await this.client.readContract({ address: this.pool, abi: tintPoolAbi, functionName: 'tree' });
      return Number(await this.client.readContract({ address: this._tree, abi: TREE_ABI, functionName: 'nextIndex', blockNumber: block }));
    } catch {
      return null;
    }
  }

  /** Syncs until the wallet has read `block` (say, a receipt's block), even if an RPC node lags behind it. */
  async syncPast(block) {
    for (let i = 1; this.nextBlock <= BigInt(block); i++) {
      await this.sync();
      if (this.nextBlock > BigInt(block)) break;
      if (i >= 20) throw new Error('The network RPC is behind right now. Try again in a moment.');
      await new Promise((r) => setTimeout(r, 500));
    }
    return this;
  }

  _apply(logs) {
    logs.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)));
    for (const log of logs) {
      const { eventName, args, transactionHash: tx } = log;
      if (!this.txOrder.includes(tx)) this.txOrder.push(tx);
      if (eventName === 'NewNullifier') {
        this.nullifiers.add(args.nullifier);
        this.nullifierTx.set(args.nullifier, tx);
      }
      else if (eventName === 'Transacted') {
        this.publicByTx.set(tx, { asset: args.publicAsset, publicIn: args.publicIn, publicOut: args.publicOut, fee: args.relayerFee, block: log.blockNumber });
      } else if (eventName === 'Swapped') {
        this.swapsByTx.set(tx, { ...args, block: log.blockNumber });
        this._resolveBought(tx);
      } else if (eventName === 'NewCommitment') {
        if (args.index !== this.tree.size) throw new Error(`missed a leaf: got ${args.index}, have ${this.tree.size}`);
        this.tree.insert(args.commitment);
        this._tryOwn(args.commitment, args.index, args.encryptedOutput, tx, log.blockNumber);
      }
    }
  }

  _tryOwn(commitment, index, encrypted, txHash, block) {
    if (!encrypted || encrypted === '0x') return;
    const note = decryptNote(this.keys.viewSecret, hexToBytes(encrypted));
    if (!note) return;
    const inner = innerHash(this.keys.owner, note.blinding);
    if (note.kind === SWAP_OUT) {
      this.pendingBought.push({ commitment, index, asset: note.asset, blinding: note.blinding, inner, txHash, block });
      this._resolveBought(txHash);
      return;
    }
    // Ignore anything that doesn't open to the on-chain commitment.
    if (commitmentOf(note.asset, note.amount, inner) !== commitment) return;
    // An agent memo counts only on a note from our own transaction (we spent in it),
    // so nobody else can plant one by sending us a note.
    if (note.memo) {
      const memo = decodeAgentMemo(note.memo);
      const ours = this.notes.some((n) => this.nullifierTx.get(n.nullifier) === txHash);
      if (memo && ours) this.agentMemos.set(memo.index, { ...memo, txHash, block });
    }
    this._addNote({ asset: note.asset, amount: note.amount, blinding: note.blinding, index, commitment, txHash, block });
  }

  _resolveBought(txHash) {
    const swap = this.swapsByTx.get(txHash);
    if (!swap) return;
    this.pendingBought = this.pendingBought.filter((p) => {
      if (p.txHash !== txHash) return true;
      if (commitmentOf(p.asset, swap.amountOut, p.inner) === p.commitment) {
        this._addNote({ asset: p.asset, amount: swap.amountOut, blinding: p.blinding, index: p.index, commitment: p.commitment, txHash, block: p.block });
      }
      return false;
    });
  }

  _addNote(n) {
    const nullifier = nullifierOf(n.commitment, n.index, this.keys.nk);
    this.notes.push({ ...n, nullifier, spent: this.nullifiers.has(nullifier) });
  }

  /** Unspent amounts by asset address (lowercase). */
  balances() {
    const out = {};
    for (const n of this.unspent()) {
      const a = toAddr(n.asset);
      out[a] = (out[a] ?? 0n) + n.amount;
    }
    return out;
  }

  /** Agents this wallet created (from the memos on its own notes), by index. */
  agents() {
    return [...this.agentMemos.values()].sort((a, b) => a.index - b.index);
  }

  unspent(asset) {
    return this.notes.filter((n) => !n.spent && n.amount > 0n && (asset === undefined || n.asset === BigInt(asset)));
  }

  /** Your activity, newest first: deposits, withdrawals, buys/sells, sends and receipts. */
  history() {
    const items = [];
    for (const tx of this.txOrder) {
      const mine = this.notes.filter((n) => n.txHash === tx);
      const spentHere = this.notes.filter((n) => n.spentTx === tx);
      const swap = this.swapsByTx.get(tx);
      const pub = this.publicByTx.get(tx);
      if (!mine.length && !spentHere.length) continue;
      if (swap) {
        // amountIn: what left your notes (relayer fee and swap fee included); amountSold: what reached Uniswap
        const inAsset = BigInt(swap.assetIn);
        const of = (ns) => ns.filter((n) => n.asset === inAsset).reduce((s, n) => s + n.amount, 0n);
        const amountIn = of(spentHere) - of(mine);
        items.push({ type: 'swap', tx, block: swap.block, assetIn: swap.assetIn, assetOut: swap.assetOut, amountIn, amountSold: swap.amountSold, amountOut: swap.amountOut });
      } else if (pub && pub.publicIn > 0n) {
        items.push({ type: 'deposit', tx, block: pub.block, asset: toAddr(pub.asset), amount: pub.publicIn });
      } else if (pub && pub.publicOut > pub.fee) {
        items.push({ type: 'withdraw', tx, block: pub.block, asset: toAddr(pub.asset), amount: pub.publicOut - pub.fee, fee: pub.fee });
      } else {
        // private transfer: sent (we spent notes), received (we only gained notes) or combined
        const got = mine.reduce((s, n) => s + n.amount, 0n);
        const spent = spentHere.reduce((s, n) => s + n.amount, 0n);
        const fee = pub?.fee ?? 0n;
        const any = mine[0] ?? spentHere[0];
        const base = { tx, block: pub?.block ?? any?.block, asset: any ? toAddr(any.asset) : undefined, fee };
        const agent = [...this.agentMemos.values()].find((m) => m.txHash === tx);
        if (agent) items.push({ ...base, type: 'fund-agent', amount: spent - got - fee, agent: agent.index, name: agent.name });
        else if (!spent) items.push({ ...base, type: 'receive', amount: got });
        else if (spent - got - fee > 0n) items.push({ ...base, type: 'send', amount: spent - got - fee });
        else items.push({ ...base, type: 'combine', amount: got });
      }
    }
    return items.reverse();
  }

  // ---------------------------------------------------------------- actions

  _pick(asset, amount) {
    const notes = this.unspent(asset).sort((a, b) => (a.amount > b.amount ? -1 : 1));
    const two = notes.slice(0, 2);
    const total = two.reduce((s, n) => s + n.amount, 0n);
    if (total < amount) {
      const all = notes.reduce((s, n) => s + n.amount, 0n);
      if (all >= amount) throw new Error('This needs more than two of your notes. Combine your notes first.');
      throw new Error('Not enough in your private balance.');
    }
    // Use one note when one is enough.
    const one = two.find((n) => n.amount >= amount);
    return one ? [one] : two;
  }

  _enc(viewPublic, note) {
    return viemBytesToHex(encryptNote(viewPublic, note));
  }

  _readOnly() {
    if (this.keys.viewOnly) throw new Error('This is a viewing key. It can show your balance but not move money.');
  }

  _moveOut() {
    this._readOnly();
    if (this.keys.agent && this.keys.agent.spendKey === undefined) {
      throw new Error('An agent can only trade. Moving money out of its account needs the owner’s keys.');
    }
  }

  /** Move `amount` of `asset` from your wallet into your private balance. */
  deposit({ asset, amount }) {
    this._moveOut();
    const blinding = [randomField(), randomField()];
    const ext = {
      recipient: ZERO,
      relayer: ZERO,
      fee: 0n,
      encryptedOutput0: this._enc(this.keys.viewPublic, { asset, amount, blinding: blinding[0] }),
      encryptedOutput1: this._enc(this.keys.viewPublic, { asset, amount: 0n, blinding: blinding[1] }),
    };
    return this._transact({ asset, publicIn: amount, outputs: [{ amount, blinding: blinding[0] }, { amount: 0n, blinding: blinding[1] }], ext });
  }

  /**
   * Take `amount` of `asset` out of the private balance to any address.
   * The recipient gets `amount`; a relayer `fee` (same asset) comes on top.
   */
  withdraw({ asset, amount, recipient, relayer = ZERO, fee = 0n }) {
    this._moveOut();
    const ins = this._pick(asset, amount + fee);
    const change = ins.reduce((s, n) => s + n.amount, 0n) - amount - fee;
    const blinding = [randomField(), randomField()];
    const ext = {
      recipient,
      relayer,
      fee,
      encryptedOutput0: this._enc(this.keys.viewPublic, { asset, amount: change, blinding: blinding[0] }),
      encryptedOutput1: this._enc(this.keys.viewPublic, { asset, amount: 0n, blinding: blinding[1] }),
    };
    return this._transact({
      asset,
      publicOut: amount + fee,
      inputs: ins,
      outputs: [{ amount: change, blinding: blinding[0] }, { amount: 0n, blinding: blinding[1] }],
      ext,
    });
  }

  /**
   * Pay another Tint user privately (tint1… address). Nothing leaves the pool.
   * `memo` (bytes) rides encrypted on your own change note; used to remember agents.
   */
  send({ asset, amount, to, relayer = ZERO, fee = 0n, memo }) {
    this._moveOut();
    const { owner, viewPublic } = decodeAddress(to);
    const ins = this._pick(asset, amount + fee);
    const change = ins.reduce((s, n) => s + n.amount, 0n) - amount - fee;
    const blinding = [randomField(), randomField()];
    // A relayer fee leaves the pool as publicOut with no recipient (this reveals the asset, not the amount sent).
    const ext = {
      recipient: ZERO,
      relayer,
      fee,
      encryptedOutput0: this._enc(viewPublic, { asset, amount, blinding: blinding[0] }),
      encryptedOutput1: this._enc(this.keys.viewPublic, { asset, amount: change, blinding: blinding[1], memo }),
    };
    return this._transact({
      asset,
      publicOut: fee,
      inputs: ins,
      outputs: [
        { amount, owner, blinding: blinding[0] },
        { amount: change, blinding: blinding[1] },
      ],
      ext,
    });
  }

  /** Combine your two largest notes of `asset` into one. */
  combine({ asset, relayer = ZERO, fee = 0n }) {
    this._moveOut();
    const ins = this.unspent(asset).sort((a, b) => (a.amount > b.amount ? -1 : 1)).slice(0, 2);
    const total = ins.reduce((s, n) => s + n.amount, 0n) - fee;
    if (total < 0n) throw new Error('Not enough in your private balance.');
    const blinding = [randomField(), randomField()];
    const ext = {
      recipient: ZERO,
      relayer,
      fee,
      encryptedOutput0: this._enc(this.keys.viewPublic, { asset, amount: total, blinding: blinding[0] }),
      encryptedOutput1: this._enc(this.keys.viewPublic, { asset, amount: 0n, blinding: blinding[1] }),
    };
    return this._transact({ asset, publicOut: fee, inputs: ins, outputs: [{ amount: total, blinding: blinding[0] }, { amount: 0n, blinding: blinding[1] }], ext });
  }

  _transact({ asset, publicIn = 0n, publicOut = 0n, inputs = [], outputs, ext }) {
    const args = {
      tree: this.tree,
      asset: BigInt(asset),
      publicIn,
      publicOut,
      inputs: inputs.map((n) => ({ amount: n.amount, blinding: n.blinding, index: n.index })),
      outputs,
      ext,
    };
    if (this.keys.agent) {
      const built = buildAgentTransact({ keys: this.keys, ...args });
      return { circuit: 'agent_transact', functionName: 'agentTransact', circuitInputs: built.circuitInputs, publicData: built.publicData, ext };
    }
    const built = buildTransact({ spendKey: this.keys.spendKey, ...args });
    return { circuit: 'transact', functionName: 'transact', circuitInputs: built.circuitInputs, publicData: built.publicData, ext };
  }

  /**
   * Buy or sell from the private balance.
   * @param amountIn total taken from your notes: the relayer `fee` comes out of it, the rest is sold
   * @param minOut  least of assetOut to accept (get it from a quote, minus slippage)
   * @param poolFee Uniswap fee tier of the pool to trade on
   */
  swap({ assetIn, assetOut, amountIn, minOut, poolFee, deadline, relayer = ZERO, fee = 0n }) {
    this._readOnly();
    const ins = this._pick(assetIn, amountIn);
    const total = ins.reduce((s, n) => s + n.amount, 0n);
    const changeBlinding = randomField();
    const outBlinding = randomField();
    const ext = {
      relayer,
      fee,
      poolFee,
      deadline: BigInt(deadline),
      encryptedChange: this._enc(this.keys.viewPublic, { asset: assetIn, amount: total - amountIn, blinding: changeBlinding }),
      encryptedOut: this._enc(this.keys.viewPublic, { kind: SWAP_OUT, asset: assetOut, blinding: outBlinding }),
    };
    const args = {
      tree: this.tree,
      assetIn,
      assetOut,
      inputs: ins.map((n) => ({ amount: n.amount, blinding: n.blinding, index: n.index })),
      amountIn,
      minOut,
      ext,
      changeBlinding,
      outBlinding,
    };
    if (this.keys.agent) {
      // An agent trades inside its account; the proof shows the trade follows the rules.
      const built = buildAgentSwap({ keys: this.keys, ...args });
      return { circuit: 'agent_swap', functionName: 'agentSwap', circuitInputs: built.circuitInputs, publicData: built.publicData, ext };
    }
    const built = buildSwap({ spendKey: this.keys.spendKey, ...args });
    return { circuit: 'swap', functionName: 'swap', circuitInputs: built.circuitInputs, publicData: built.publicData, ext };
  }
}

/** Contract call args once the proof exists. */
export function callArgs(action, proof) {
  return [{ ...action.publicData, proof: typeof proof === 'string' ? proof : viemBytesToHex(proof) }, action.ext];
}

export { NOTE, SWAP_OUT };
