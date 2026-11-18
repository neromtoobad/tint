// The Tint wallet engine. Rebuilds your private balance from the pool's events
// (nothing is stored on a server), and builds each action ready to prove.
import { bytesToHex as viemBytesToHex, getAbiItem, hexToBytes } from 'viem';
import { tintPoolAbi } from './abi.js';
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
const ZERO = '0x0000000000000000000000000000000000000000';
const toAddr = (x) => '0x' + BigInt(x).toString(16).padStart(40, '0');

export class TintWallet {
  /**
   * @param client   viem PublicClient for the chain
   * @param pool     TintPool address
   * @param fromBlock block the pool was deployed in
   * @param keys     from keysFromSignature / keysFromSeed, or importViewingKey (read-only)
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
  }

  /** Reads new pool events up to the latest block. */
  async sync() {
    const latest = await this.client.getBlockNumber();
    while (this.nextBlock <= latest) {
      let to = this.nextBlock + this.chunk - 1n;
      if (to > latest) to = latest;
      let logs;
      try {
        logs = await this.client.getLogs({ address: this.pool, events: EVENTS, fromBlock: this.nextBlock, toBlock: to });
      } catch (e) {
        if (this.chunk > 1_000n) {
          this.chunk /= 4n; // the RPC refused the range; try smaller pieces
          continue;
        }
        throw e;
      }
      this._apply(logs);
      this.nextBlock = to + 1n;
    }
    for (const n of this.notes) {
      n.spent = this.nullifiers.has(n.nullifier);
      n.spentTx = this.nullifierTx.get(n.nullifier);
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
        this.publicByTx.set(tx, { asset: args.publicAsset, publicIn: args.publicIn, publicOut: args.publicOut, block: log.blockNumber });
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
        items.push({ type: 'swap', tx, block: swap.block, assetIn: swap.assetIn, assetOut: swap.assetOut, amountSold: swap.amountSold, amountOut: swap.amountOut });
      } else if (pub && pub.publicIn > 0n) {
        items.push({ type: 'deposit', tx, block: pub.block, asset: toAddr(pub.asset), amount: pub.publicIn });
      } else if (pub && pub.publicOut > 0n) {
        items.push({ type: 'withdraw', tx, block: pub.block, asset: toAddr(pub.asset), amount: pub.publicOut });
      } else {
        const got = mine.reduce((s, n) => s + n.amount, 0n);
        items.push({ type: 'private', tx, block: mine[0]?.block, asset: mine[0] ? toAddr(mine[0].asset) : undefined, amount: got });
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

  /** Move `amount` of `asset` from your wallet into your private balance. */
  deposit({ asset, amount }) {
    this._readOnly();
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

  /** Take `amount` of `asset` out of the private balance to any address. */
  withdraw({ asset, amount, recipient, relayer = ZERO, fee = 0n }) {
    this._readOnly();
    const ins = this._pick(asset, amount);
    const change = ins.reduce((s, n) => s + n.amount, 0n) - amount;
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
      publicOut: amount,
      inputs: ins,
      outputs: [{ amount: change, blinding: blinding[0] }, { amount: 0n, blinding: blinding[1] }],
      ext,
    });
  }

  /** Pay another Tint user privately (tint1… address). Nothing leaves the pool. */
  send({ asset, amount, to }) {
    this._readOnly();
    const { owner, viewPublic } = decodeAddress(to);
    const ins = this._pick(asset, amount);
    const change = ins.reduce((s, n) => s + n.amount, 0n) - amount;
    const blinding = [randomField(), randomField()];
    const ext = {
      recipient: ZERO,
      relayer: ZERO,
      fee: 0n,
      encryptedOutput0: this._enc(viewPublic, { asset, amount, blinding: blinding[0] }),
      encryptedOutput1: this._enc(this.keys.viewPublic, { asset, amount: change, blinding: blinding[1] }),
    };
    return this._transact({
      asset,
      inputs: ins,
      outputs: [
        { amount, owner, blinding: blinding[0] },
        { amount: change, blinding: blinding[1] },
      ],
      ext,
    });
  }

  /** Combine your two largest notes of `asset` into one. */
  combine({ asset }) {
    this._readOnly();
    const ins = this.unspent(asset).sort((a, b) => (a.amount > b.amount ? -1 : 1)).slice(0, 2);
    const total = ins.reduce((s, n) => s + n.amount, 0n);
    const blinding = [randomField(), randomField()];
    const ext = {
      recipient: ZERO,
      relayer: ZERO,
      fee: 0n,
      encryptedOutput0: this._enc(this.keys.viewPublic, { asset, amount: total, blinding: blinding[0] }),
      encryptedOutput1: this._enc(this.keys.viewPublic, { asset, amount: 0n, blinding: blinding[1] }),
    };
    return this._transact({ asset, inputs: ins, outputs: [{ amount: total, blinding: blinding[0] }, { amount: 0n, blinding: blinding[1] }], ext });
  }

  _transact({ asset, publicIn = 0n, publicOut = 0n, inputs = [], outputs, ext }) {
    const built = buildTransact({
      tree: this.tree,
      spendKey: this.keys.spendKey,
      asset: BigInt(asset),
      publicIn,
      publicOut,
      inputs: inputs.map((n) => ({ amount: n.amount, blinding: n.blinding, index: n.index })),
      outputs,
      ext,
    });
    return { circuit: 'transact', functionName: 'transact', circuitInputs: built.circuitInputs, publicData: built.publicData, ext };
  }

  /**
   * Buy or sell from the private balance.
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
    const built = buildSwap({
      tree: this.tree,
      spendKey: this.keys.spendKey,
      assetIn,
      assetOut,
      inputs: ins.map((n) => ({ amount: n.amount, blinding: n.blinding, index: n.index })),
      amountIn,
      minOut,
      ext,
      changeBlinding,
      outBlinding,
    });
    return { circuit: 'swap', functionName: 'swap', circuitInputs: built.circuitInputs, publicData: built.publicData, ext };
  }
}

/** Contract call args once the proof exists. */
export function callArgs(action, proof) {
  return [{ ...action.publicData, proof: typeof proof === 'string' ? proof : viemBytesToHex(proof) }, action.ext];
}

export { NOTE, SWAP_OUT };
