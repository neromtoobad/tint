// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice The note tree the pool writes to. Implemented in Solidity (TintTree)
/// and, later, in Stylus; both must give the same roots.
interface ITintTree {
    /// @notice Adds two leaves. Only the pool can call it.
    /// @return index the leaf index of `left` (`right` is index + 1)
    function insertPair(uint256 left, uint256 right) external returns (uint32 index, uint256 newRoot);

    /// @notice True if `root` is the current root or one of the recent ones.
    function isKnownRoot(uint256 root) external view returns (bool);

    function currentRoot() external view returns (uint256);

    function nextIndex() external view returns (uint32);

    /// @notice Poseidon2 of 2 and 3 field elements, as in the circuits.
    function hash2(uint256 a, uint256 b) external pure returns (uint256);

    function hash3(uint256 a, uint256 b, uint256 c) external pure returns (uint256);
}
