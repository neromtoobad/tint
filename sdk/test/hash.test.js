import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initHash, hash2, hash3 } from '../src/hash.js';
import { MerkleTree } from '../src/tree.js';

await initHash();

// Printed by `nargo test --show-output` in circuits/notes (print_known_values).
const NOIR = {
  hash2_1_2: 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383n,
  hash3_1_2_3: 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8n,
  emptyRoot: 0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755n,
};

test('Poseidon2 matches the Noir circuits', () => {
  assert.equal(hash2(1n, 2n), NOIR.hash2_1_2);
  assert.equal(hash3(1n, 2n, 3n), NOIR.hash3_1_2_3);
});

test('empty tree root matches the Noir circuits', () => {
  assert.equal(new MerkleTree().root(), NOIR.emptyRoot);
});

test('a path rebuilds the root', () => {
  const t = new MerkleTree();
  t.insertMany([11n, 22n, 33n, 44n, 55n]);
  for (let i = 0; i < t.size; i++) {
    let node = t.layers[0][i];
    let idx = i;
    for (const sib of t.path(i)) {
      node = idx & 1 ? hash2(sib, node) : hash2(node, sib);
      idx >>= 1;
    }
    assert.equal(node, t.root());
  }
});
