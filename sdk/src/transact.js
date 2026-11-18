// Builds and proves a `transact` call (deposit, withdraw or private transfer).
import { encodeAbiParameters, keccak256 } from 'viem';
import { FIELD, randomField, toHex } from './hash.js';
import { makeNote, nullifierOf, ownerOf } from './notes.js';
import { emptyPath } from './tree.js';

const EXT_DATA_ABI = [
  {
    type: 'tuple',
    components: [
      { name: 'recipient', type: 'address' },
      { name: 'relayer', type: 'address' },
      { name: 'fee', type: 'uint256' },
      { name: 'encryptedOutput0', type: 'bytes' },
      { name: 'encryptedOutput1', type: 'bytes' },
    ],
  },
];

/** Same as TintPool.hashExtData: keccak(abi.encode(ext)) mod FIELD. */
export function hashExtData(ext) {
  return BigInt(keccak256(encodeAbiParameters(EXT_DATA_ABI, [ext]))) % FIELD;
}

/**
 * Circuit inputs for one transaction.
 * @param tree     MerkleTree with every leaf the pool has so far
 * @param spendKey the owner's spend key (bigint)
 * @param asset    token address as bigint
 * @param inputs   up to 2 notes to spend: { amount, blinding, index } (owned by spendKey)
 * @param outputs  up to 2 new notes: { amount, owner?, blinding? } (owner defaults to self)
 * @param publicIn / publicOut tokens entering / leaving the pool
 * @param ext      { recipient, relayer, fee, encryptedOutput0, encryptedOutput1 }
 */
export function buildTransact({ tree, spendKey, asset, inputs = [], outputs = [], publicIn = 0n, publicOut = 0n, ext }) {
  if (inputs.length > 2 || outputs.length > 2) throw new Error('at most 2 inputs and 2 outputs');
  asset = BigInt(asset);
  spendKey = BigInt(spendKey);
  const self = ownerOf(spendKey);

  const ins = [...inputs];
  while (ins.length < 2) ins.push({ amount: 0n, blinding: randomField(), index: 0 }); // dummy
  const outs = [...outputs];
  while (outs.length < 2) outs.push({ amount: 0n });

  const root = tree.root();
  const inNotes = ins.map((n) => makeNote({ asset, amount: n.amount, owner: self, blinding: n.blinding }));
  const inPaths = ins.map((n) => (BigInt(n.amount) === 0n ? emptyPath() : tree.path(Number(n.index))));
  const nullifiers = inNotes.map((n, i) => nullifierOf(n.commitment, ins[i].index, spendKey));
  const outNotes = outs.map((o) =>
    makeNote({ asset, amount: o.amount, owner: o.owner ?? self, blinding: o.blinding ?? randomField() }),
  );

  const sumIn = ins.reduce((s, n) => s + BigInt(n.amount), 0n) + BigInt(publicIn);
  const sumOut = outs.reduce((s, n) => s + BigInt(n.amount), 0n) + BigInt(publicOut);
  if (sumIn !== sumOut) throw new Error(`amounts do not add up: in ${sumIn}, out ${sumOut}`);

  const extHash = hashExtData(ext);
  const publicAsset = BigInt(publicIn) > 0n || BigInt(publicOut) > 0n ? asset : 0n;

  const circuitInputs = {
    root: toHex(root),
    public_asset: toHex(publicAsset),
    public_in: toHex(publicIn),
    public_out: toHex(publicOut),
    ext_hash: toHex(extHash),
    nullifiers: nullifiers.map(toHex),
    out_commitments: outNotes.map((n) => toHex(n.commitment)),
    asset: toHex(asset),
    spend_key: toHex(spendKey),
    in_amount: ins.map((n) => toHex(n.amount)),
    in_blinding: ins.map((n) => toHex(n.blinding)),
    in_index: ins.map((n) => toHex(n.index)),
    in_path: inPaths.map((p) => p.map(toHex)),
    out_amount: outNotes.map((n) => toHex(n.amount)),
    out_owner: outNotes.map((n) => toHex(n.owner)),
    out_blinding: outNotes.map((n) => toHex(n.blinding)),
  };

  // What the pool contract receives (TintPool.Proof minus the proof bytes).
  const publicData = {
    root,
    publicAsset,
    publicIn: BigInt(publicIn),
    publicOut: BigInt(publicOut),
    nullifiers,
    outCommitments: outNotes.map((n) => n.commitment),
  };
  return { circuitInputs, publicData, outNotes, extHash };
}
