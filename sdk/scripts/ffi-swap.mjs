#!/usr/bin/env node
// Called from Foundry tests through vm.ffi: builds a real swap proof.
//
// argv[2] = hex of abi.encode(
//   uint256 spendKey, uint256 assetIn, uint256 assetOut, uint256 amountIn, uint256 minOut,
//   uint256[] leaves,
//   (uint256 amount, uint256 blinding, uint256 index)[] inputs,
//   uint256 changeBlinding, uint256 outBlinding,
//   (address relayer, uint256 fee, uint24 poolFee, uint256 deadline, bytes encChange, bytes encOut) ext)
//
// stdout = hex of abi.encode(TintPool.SwapProof)
import { decodeAbiParameters, encodeAbiParameters, toHex } from 'viem';
import { initHash } from '../src/hash.js';
import { MerkleTree } from '../src/tree.js';
import { buildSwap } from '../src/swap.js';
import { proverFor } from '../src/node.js';

const EXT = {
  type: 'tuple',
  components: [
    { name: 'relayer', type: 'address' },
    { name: 'fee', type: 'uint256' },
    { name: 'poolFee', type: 'uint24' },
    { name: 'deadline', type: 'uint256' },
    { name: 'encryptedChange', type: 'bytes' },
    { name: 'encryptedOut', type: 'bytes' },
  ],
};
const REQUEST = [
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256' },
  { type: 'uint256[]' },
  { type: 'tuple[]', components: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] },
  { type: 'uint256' },
  { type: 'uint256' },
  EXT,
];
const PROOF = [
  {
    type: 'tuple',
    components: [
      { name: 'proof', type: 'bytes' },
      { name: 'root', type: 'uint256' },
      { name: 'nullifiers', type: 'uint256[2]' },
      { name: 'assetIn', type: 'uint256' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'assetOut', type: 'uint256' },
      { name: 'minOut', type: 'uint256' },
      { name: 'changeCommitment', type: 'uint256' },
      { name: 'outInner', type: 'uint256' },
    ],
  },
];

const [spendKey, assetIn, assetOut, amountIn, minOut, leaves, inputs, changeBlinding, outBlinding, ext] =
  decodeAbiParameters(REQUEST, process.argv[2]);

await initHash();
const tree = new MerkleTree();
tree.insertMany(leaves);

const { circuitInputs, publicData } = buildSwap({
  tree,
  spendKey,
  assetIn,
  assetOut,
  amountIn,
  minOut,
  inputs: inputs.map(([amount, blinding, index]) => ({ amount, blinding, index: Number(index) })),
  changeBlinding,
  outBlinding,
  ext,
});

const prover = await proverFor('swap');
const { proof } = await prover.prove(circuitInputs);
await prover.destroy();

process.stdout.write(encodeAbiParameters(PROOF, [{ proof: toHex(proof), ...publicData }]));
process.exit(0);
