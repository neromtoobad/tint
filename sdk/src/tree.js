// The note tree, rebuilt off chain from the pool's NewCommitment events.
// Same layout as TintTree.sol: depth 20, empty leaves are 0, node = H(left, right).
import { hash2 } from './hash.js';
import { TREE_DEPTH } from './notes.js';

export class MerkleTree {
  constructor(depth = TREE_DEPTH) {
    this.depth = depth;
    this.zeros = [0n];
    for (let i = 0; i < depth; i++) this.zeros.push(hash2(this.zeros[i], this.zeros[i]));
    // layers[0] = leaves; layers[i][j] = node j at height i (only filled nodes stored)
    this.layers = Array.from({ length: depth + 1 }, () => []);
  }

  get size() {
    return this.layers[0].length;
  }

  insert(leaf) {
    let index = this.layers[0].length;
    this.layers[0].push(BigInt(leaf));
    for (let level = 0; level < this.depth; level++) {
      const parent = index >> 1;
      const left = this.node(level, parent * 2);
      const right = this.node(level, parent * 2 + 1);
      this.layers[level + 1][parent] = hash2(left, right);
      index = parent;
    }
  }

  insertMany(leaves) {
    for (const l of leaves) this.insert(l);
  }

  node(level, index) {
    const v = this.layers[level][index];
    return v === undefined ? this.zeros[level] : v;
  }

  root() {
    return this.node(this.depth, 0);
  }

  /** Sibling path for the leaf at `index`, bottom up. */
  path(index) {
    if (index >= this.size) throw new Error(`no leaf at ${index}`);
    const out = [];
    let i = index;
    for (let level = 0; level < this.depth; level++) {
      out.push(this.node(level, i ^ 1));
      i >>= 1;
    }
    return out;
  }

  indexOf(leaf) {
    return this.layers[0].indexOf(BigInt(leaf));
  }
}

export function emptyPath(depth = TREE_DEPTH) {
  const t = new MerkleTree(depth);
  return t.zeros.slice(0, depth);
}
