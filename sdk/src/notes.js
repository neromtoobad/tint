// Notes and keys, matching circuits/notes/src/lib.nr exactly.
import { hash2, hash3, randomField } from './hash.js';

export const OWNER_TAG = 1n;
export const TREE_DEPTH = 20;

export const ownerOf = (spendKey) => hash2(OWNER_TAG, spendKey);
export const innerHash = (owner, blinding) => hash2(owner, blinding);
export const commitmentOf = (asset, amount, inner) => hash3(asset, amount, inner);
export const nullifierOf = (commitment, leafIndex, spendKey) => hash3(commitment, BigInt(leafIndex), spendKey);

/** A note owned by `owner`. Call with a fresh random blinding unless you need it fixed. */
export function makeNote({ asset, amount, owner, blinding = randomField() }) {
  asset = BigInt(asset);
  amount = BigInt(amount);
  owner = BigInt(owner);
  blinding = BigInt(blinding);
  const commitment = commitmentOf(asset, amount, innerHash(owner, blinding));
  return { asset, amount, owner, blinding, commitment };
}
