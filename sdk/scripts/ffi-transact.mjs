#!/usr/bin/env node
// Called from Foundry tests through vm.ffi: builds a real transact proof.
//
// argv[2] = hex of abi.encode(
//   uint256 spendKey, uint256 asset, uint256 publicIn, uint256 publicOut,
//   uint256[] leaves,                                   // every leaf in the pool so far
//   (uint256 amount, uint256 blinding, uint256 index)[] inputs,
//   (uint256 amount, uint256 owner, uint256 blinding)[] outputs,   // owner 0 = self
//   (address recipient, address relayer, uint256 fee, bytes enc0, bytes enc1) ext)
//
// stdout = hex of abi.encode(TintPool.Proof)
import { decodeAbiParameters, encodeAbiParameters, toHex } from 'viem';
import { initHash } from '../src/hash.js';
import { MerkleTree } from '../src/tree.js';
import { buildTransact, TransactProver } from '../src/transact.js';

const REQUEST = [
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256[]' },
  { type: 'tuple[]', components: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] },
  { type: 'tuple[]', components: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] },
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

const PROOF = [
  {
    type: 'tuple',
    components: [
      { name: 'proof', type: 'bytes' },
      { name: 'root', type: 'uint256' },
      { name: 'publicAsset', type: 'uint256' },
      { name: 'publicIn', type: 'uint256' },
      { name: 'publicOut', type: 'uint256' },
      { name: 'nullifiers', type: 'uint256[2]' },
      { name: 'outCommitments', type: 'uint256[2]' },
    ],
  },
];

const [spendKey, asset, publicIn, publicOut, leaves, inputs, outputs, ext] = decodeAbiParameters(REQUEST, process.argv[2]);

await initHash();
const tree = new MerkleTree();
tree.insertMany(leaves);

const { circuitInputs, publicData } = buildTransact({
  tree,
  spendKey,
  asset,
  publicIn,
  publicOut,
  inputs: inputs.map(([amount, blinding, index]) => ({ amount, blinding, index: Number(index) })),
  outputs: outputs.map(([amount, owner, blinding]) => ({ amount, owner: owner === 0n ? undefined : owner, blinding })),
  ext,
});

const prover = await TransactProver.create();
const { proof } = await prover.prove(circuitInputs);
await prover.destroy();

process.stdout.write(encodeAbiParameters(PROOF, [{ proof: toHex(proof), ...publicData }]));
process.exit(0);
