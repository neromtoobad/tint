#!/usr/bin/env node
// Called from Foundry tests through vm.ffi: builds a real agent_swap or
// agent_transact proof (see test/TintPoolAgent.t.sol).
//
// argv[2] = 'swap' | 'transact' | 'owner' (prints the account owner and the user's owner)
// argv[3] = hex of abi.encode(
//   uint256 agentKey, uint256 withUserKey (0 = the agent alone, else the test user's key), (uint256[6] assets,
//   uint256 maxBuy, uint256 maxFeeBps, uint256 endsAt, address relayer) rules,
//   uint256[] leaves, (uint256 amount, uint256 blinding, uint256 index)[] inputs, bytes call)
//   swap call     = abi.encode(assetIn, assetOut, amountIn, minOut, changeBlinding, outBlinding, SwapExt)
//   transact call = abi.encode(asset, publicIn, publicOut, (amount, owner, blinding)[] outputs, ExtData)
//
// stdout = hex of abi.encode(TintPool.SwapProof) or abi.encode(TintPool.Proof)
import { decodeAbiParameters, encodeAbiParameters, toHex } from 'viem';
import { initHash } from '../src/hash.js';
import { ownerOf } from '../src/notes.js';
import { MerkleTree } from '../src/tree.js';
import { agentAccountKeys, buildAgentSwap, buildAgentTransact } from '../src/agent.js';
import { proverFor } from '../src/node.js';

const INPUTS = { type: 'tuple[]', components: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] };
const RULES = {
  type: 'tuple',
  components: [
    { name: 'assets', type: 'uint256[6]' },
    { name: 'maxBuy', type: 'uint256' },
    { name: 'maxFeeBps', type: 'uint256' },
    { name: 'endsAt', type: 'uint256' },
    { name: 'relayer', type: 'address' },
  ],
};
const SWAP_EXT = {
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
const EXT = {
  type: 'tuple',
  components: [
    { name: 'recipient', type: 'address' },
    { name: 'relayer', type: 'address' },
    { name: 'fee', type: 'uint256' },
    { name: 'encryptedOutput0', type: 'bytes' },
    { name: 'encryptedOutput1', type: 'bytes' },
  ],
};
const SWAP_PROOF = {
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
};
const PROOF = {
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
};

const kind = process.argv[2];
const [agentKey, userSpendKey, rules, leaves, inputs, call] = decodeAbiParameters(
  [{ type: 'uint256' }, { type: 'uint256' }, RULES, { type: 'uint256[]' }, INPUTS, { type: 'bytes' }],
  process.argv[3],
);

await initHash();
const tree = new MerkleTree();
tree.insertMany(leaves);
// The user's spend key is fixed for tests; the agent never sees it.
const USER_SK = 0x1234n;
const keys = agentAccountKeys({ agentKey, userOwner: ownerOf(USER_SK), rules, spendKey: userSpendKey === 0n ? undefined : USER_SK });
if (kind === 'owner') {
  process.stdout.write(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [keys.owner, ownerOf(USER_SK)]));
  process.exit(0);
}
const ins = inputs.map(([amount, blinding, index]) => ({ amount, blinding, index: Number(index) }));

let out;
if (kind === 'swap') {
  const [assetIn, assetOut, amountIn, minOut, changeBlinding, outBlinding, ext] = decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, SWAP_EXT],
    call,
  );
  const built = buildAgentSwap({ keys, tree, assetIn, assetOut, amountIn, minOut, inputs: ins, changeBlinding, outBlinding, ext });
  const prover = await proverFor('agent_swap');
  const { proof } = await prover.prove(built.circuitInputs);
  await prover.destroy();
  out = encodeAbiParameters([SWAP_PROOF], [{ proof: toHex(proof), ...built.publicData }]);
} else {
  const [asset, publicIn, publicOut, outputs, ext] = decodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, INPUTS, EXT],
    call,
  );
  const built = buildAgentTransact({
    keys,
    tree,
    asset,
    publicIn,
    publicOut,
    inputs: ins,
    outputs: outputs.map(([amount, owner, blinding]) => ({ amount, owner: owner === 0n ? keys.owner : owner, blinding })),
    ext,
  });
  const prover = await proverFor('agent_transact');
  const { proof } = await prover.prove(built.circuitInputs);
  await prover.destroy();
  out = encodeAbiParameters([PROOF], [{ proof: toHex(proof), ...built.publicData }]);
}
process.stdout.write(out);
process.exit(0);
