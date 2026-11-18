// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {LibPoseidon2Yul} from "poseidon2-evm/bn254/yul/LibPoseidon2Yul.sol";
import {ITintTree} from "./interfaces/ITintTree.sol";

/// @title TintTree
/// @notice The Merkle tree of every note in the Tint pool (all assets share it).
/// Leaves go in two at a time. Nodes are Poseidon2(left, right), the same hash
/// the circuits use (circuits/notes/src/lib.nr). A Stylus (Rust) tree with the
/// same interface is planned; this Solidity one stays as the reference.
contract TintTree is ITintTree {
    uint256 public constant FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    uint32 public constant DEPTH = 20;
    uint32 public constant ROOT_HISTORY = 100;

    /// @notice The only address that can add leaves (the pool).
    address public immutable pool;

    uint32 public nextIndex;
    uint32 public currentRootIndex;
    uint256[DEPTH] public zeros;
    uint256[DEPTH] public filledSubtrees;
    uint256[ROOT_HISTORY] public roots;
    /// @notice Roots still in the history window (old ones are dropped as new ones come in).
    mapping(uint256 => bool) public isRecentRoot;

    error OnlyPool();
    error TreeFull();
    error NotAFieldElement();

    constructor(address pool_) {
        pool = pool_;
        uint256 z = 0;
        for (uint32 i = 0; i < DEPTH; i++) {
            zeros[i] = z;
            filledSubtrees[i] = z;
            z = LibPoseidon2Yul.hash_2(z, z);
        }
        roots[0] = z; // empty root, matches notes::empty_root()
        isRecentRoot[z] = true;
    }

    /// @inheritdoc ITintTree
    function insertPair(uint256 left, uint256 right) external returns (uint32 index, uint256 newRoot) {
        if (msg.sender != pool) revert OnlyPool();
        if (left >= FIELD || right >= FIELD) revert NotAFieldElement();
        index = nextIndex;
        if (index + 2 > uint32(1) << DEPTH) revert TreeFull();

        // nextIndex is always even, so the pair are siblings at level 0.
        uint256 node = LibPoseidon2Yul.hash_2(left, right);
        uint32 at = index >> 1;
        for (uint32 i = 1; i < DEPTH; i++) {
            if (at & 1 == 0) {
                filledSubtrees[i] = node;
                node = LibPoseidon2Yul.hash_2(node, zeros[i]);
            } else {
                node = LibPoseidon2Yul.hash_2(filledSubtrees[i], node);
            }
            at >>= 1;
        }

        uint32 r = (currentRootIndex + 1) % ROOT_HISTORY;
        currentRootIndex = r;
        delete isRecentRoot[roots[r]];
        roots[r] = node;
        isRecentRoot[node] = true;
        nextIndex = index + 2;
        newRoot = node;
    }

    /// @inheritdoc ITintTree
    function isKnownRoot(uint256 root) external view returns (bool) {
        return root != 0 && isRecentRoot[root];
    }

    /// @inheritdoc ITintTree
    function currentRoot() external view returns (uint256) {
        return roots[currentRootIndex];
    }

    /// @inheritdoc ITintTree
    function hash2(uint256 a, uint256 b) external pure returns (uint256) {
        return LibPoseidon2Yul.hash_2(a, b);
    }

    /// @inheritdoc ITintTree
    function hash3(uint256 a, uint256 b, uint256 c) external pure returns (uint256) {
        return LibPoseidon2Yul.hash_3(a, b, c);
    }
}
