// Builds a `swap` call: sell `amountIn` of one asset from the private balance
// for another, on a public Uniswap v3 pool.
import { encodeAbiParameters, keccak256 } from 'viem';
import { FIELD, randomField, toHex } from './hash.js';
import { commitmentOf, innerHash, makeNote, nullifierKeyOf, nullifierOf, ownerOf } from './notes.js';
import { emptyPath } from './tree.js';

const SWAP_EXT_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'relayer', type: 'address' },
      { name: 'fee', type: 'uint256' },
      { name: 'poolFee', type: 'uint24' },
      { name: 'deadline', type: 'uint256' },
      { name: 'encryptedChange', type: 'bytes' },
      { name: 'encryptedOut', type: 'bytes' },
    ],
  },
];

/** Same as TintPool.hashSwapExt. */
export function hashSwapExt(ext) {
  return BigInt(keccak256(encodeAbiParameters(SWAP_EXT_ABI, [ext]))) % FIELD;
}

/**
 * @param inputs    up to 2 notes of assetIn to spend: { amount, blinding, index }
 * @param amountIn  how much of them to trade (relayer fee and swap fee come out of it)
 * @param minOut    the least of assetOut to accept
 * @param ext       { relayer, fee, poolFee, deadline, encryptedChange, encryptedOut }
 * Returns the circuit inputs, what the contract receives, and the two new notes
 * (the bought note's amount is only known after the trade: read it from the Swapped event).
 */
export function buildSwap({ tree, spendKey, assetIn, assetOut, inputs, amountIn, minOut, ext, changeBlinding, outBlinding }) {
  if (!inputs.length || inputs.length > 2) throw new Error('1 or 2 input notes');
  spendKey = BigInt(spendKey);
  assetIn = BigInt(assetIn);
  assetOut = BigInt(assetOut);
  amountIn = BigInt(amountIn);
  minOut = BigInt(minOut);
  const self = ownerOf(spendKey);

  const ins = [...inputs];
  while (ins.length < 2) ins.push({ amount: 0n, blinding: randomField(), index: 0 });
  const inNotes = ins.map((n) => makeNote({ asset: assetIn, amount: n.amount, owner: self, blinding: n.blinding }));
  const total = ins.reduce((s, n) => s + BigInt(n.amount), 0n);
  if (amountIn === 0n || amountIn > total) throw new Error(`can trade 1..${total}, asked ${amountIn}`);

  const root = tree.root();
  const nullifiers = inNotes.map((n, i) => nullifierOf(n.commitment, ins[i].index, nullifierKeyOf(spendKey)));
  const change = makeNote({ asset: assetIn, amount: total - amountIn, owner: self, blinding: changeBlinding ?? randomField() });
  outBlinding = BigInt(outBlinding ?? randomField());
  const outInner = innerHash(self, outBlinding);
  const extHash = hashSwapExt(ext);

  const circuitInputs = {
    root: toHex(root),
    nullifiers: nullifiers.map(toHex),
    asset_in: toHex(assetIn),
    amount_in: toHex(amountIn),
    asset_out: toHex(assetOut),
    min_out: toHex(minOut),
    change_commitment: toHex(change.commitment),
    out_inner: toHex(outInner),
    ext_hash: toHex(extHash),
    spend_key: toHex(spendKey),
    in_amount: ins.map((n) => toHex(n.amount)),
    in_blinding: ins.map((n) => toHex(n.blinding)),
    in_index: ins.map((n) => toHex(n.index)),
    in_path: ins.map((n) => (BigInt(n.amount) === 0n ? emptyPath() : tree.path(Number(n.index))).map(toHex)),
    change_amount: toHex(change.amount),
    change_blinding: toHex(change.blinding),
    out_blinding: toHex(outBlinding),
  };

  const publicData = {
    root,
    nullifiers,
    assetIn,
    amountIn,
    assetOut,
    minOut,
    changeCommitment: change.commitment,
    outInner,
  };

  /** The bought note, once the trade's amountOut is known. */
  const boughtNote = (amountOut) => ({
    asset: assetOut,
    amount: BigInt(amountOut),
    owner: self,
    blinding: outBlinding,
    commitment: commitmentOf(assetOut, BigInt(amountOut), outInner),
  });

  return { circuitInputs, publicData, change, boughtNote, extHash };
}
