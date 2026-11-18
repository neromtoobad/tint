// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IVerifier} from "./verifiers/TransactVerifier.sol";
import {ITintTree} from "./interfaces/ITintTree.sol";

/// @title TintPool
/// @notice Holds the tokens behind every private balance in Tint and checks the
/// proofs that move them. One call, `transact`, covers deposit, withdraw and
/// private transfer (see circuits/transact).
///
/// Trust model: the owner can list assets, set deposit caps and pause NEW
/// deposits. The owner cannot move anyone's tokens, cannot block withdrawals and
/// cannot touch notes. Unaudited: caps stay low until an outside review.
contract TintPool is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

    /// @notice What the proof shows. Every value is a field element.
    struct Proof {
        bytes proof;
        uint256 root;
        uint256 publicAsset; // token address as a number; 0 for a private transfer
        uint256 publicIn; // tokens pulled from msg.sender into the pool
        uint256 publicOut; // tokens paid out: (publicOut - fee) to recipient, fee to relayer
        uint256[2] nullifiers;
        uint256[2] outCommitments;
    }

    /// @notice Data the proof is bound to through extHash, so nobody can change it in flight.
    struct ExtData {
        address recipient;
        address relayer;
        uint256 fee;
        bytes encryptedOutput0;
        bytes encryptedOutput1;
    }

    struct AssetConfig {
        bool listed; // can be deposited
        uint128 maxDeposit; // per deposit
        uint128 maxPoolBalance; // pool-wide
    }

    IVerifier public immutable transactVerifier;
    ITintTree public tree;

    mapping(uint256 => bool) public nullifierSpent;
    mapping(address => AssetConfig) public assets;
    bool public depositsPaused;

    event NewCommitment(uint256 indexed commitment, uint32 index, bytes encryptedOutput);
    event NewNullifier(uint256 indexed nullifier);
    event AssetConfigured(address indexed asset, bool listed, uint128 maxDeposit, uint128 maxPoolBalance);
    event DepositsPaused(bool paused);

    error UnknownRoot();
    error NullifierSpent(uint256 nullifier);
    error NotAFieldElement();
    error InvalidProof();
    error DepositsArePaused();
    error AssetNotListed(address asset);
    error DepositTooLarge();
    error PoolCapReached();
    error BadAsset();
    error FeeTooHigh();
    error NoRecipient();
    error TreeAlreadySet();
    error FeeOnTransferToken();

    constructor(IVerifier transactVerifier_, address owner_) Ownable(owner_) {
        transactVerifier = transactVerifier_;
    }

    /// @notice One-time link to the tree (the tree needs the pool's address first).
    function setTree(ITintTree tree_) external onlyOwner {
        if (address(tree) != address(0)) revert TreeAlreadySet();
        tree = tree_;
    }

    // ------------------------------------------------------------------ users

    function transact(Proof calldata p, ExtData calldata ext) external nonReentrant {
        uint256 extHash = hashExtData(ext);
        _checkPublicInputs(p);
        if (!tree.isKnownRoot(p.root)) revert UnknownRoot();
        for (uint256 i = 0; i < 2; i++) {
            if (nullifierSpent[p.nullifiers[i]]) revert NullifierSpent(p.nullifiers[i]);
        }

        if (!transactVerifier.verify(p.proof, _publicInputs(p, extHash))) revert InvalidProof();

        for (uint256 i = 0; i < 2; i++) {
            nullifierSpent[p.nullifiers[i]] = true;
            emit NewNullifier(p.nullifiers[i]);
        }
        (uint32 index,) = tree.insertPair(p.outCommitments[0], p.outCommitments[1]);
        emit NewCommitment(p.outCommitments[0], index, ext.encryptedOutput0);
        emit NewCommitment(p.outCommitments[1], index + 1, ext.encryptedOutput1);

        if (p.publicIn > 0 || p.publicOut > 0) {
            if (p.publicAsset == 0 || p.publicAsset >> 160 != 0) revert BadAsset();
        }
        if (p.publicIn > 0) _pullDeposit(address(uint160(p.publicAsset)), p.publicIn);
        if (p.publicOut > 0) {
            _payOut(address(uint160(p.publicAsset)), p.publicOut, ext);
        } else if (ext.fee != 0) {
            revert FeeTooHigh();
        }
    }

    /// @notice keccak of the ext data, reduced into the field (the circuit's ext_hash).
    function hashExtData(ExtData calldata ext) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(ext))) % FIELD;
    }

    // ------------------------------------------------------------------ owner

    function configureAsset(address asset, bool listed, uint128 maxDeposit, uint128 maxPoolBalance)
        external
        onlyOwner
    {
        assets[asset] = AssetConfig(listed, maxDeposit, maxPoolBalance);
        emit AssetConfigured(asset, listed, maxDeposit, maxPoolBalance);
    }

    /// @notice Pauses new deposits only. Withdrawals and transfers always work.
    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    // ------------------------------------------------------------------ internals

    function _checkPublicInputs(Proof calldata p) internal pure {
        // Non-canonical encodings (x + FIELD) would let one nullifier be "new" twice.
        if (
            p.root >= FIELD || p.publicAsset >= FIELD || p.publicIn >= FIELD || p.publicOut >= FIELD
                || p.nullifiers[0] >= FIELD || p.nullifiers[1] >= FIELD || p.outCommitments[0] >= FIELD
                || p.outCommitments[1] >= FIELD
        ) revert NotAFieldElement();
    }

    function _publicInputs(Proof calldata p, uint256 extHash) internal pure returns (bytes32[] memory pi) {
        // Same order as the parameters of circuits/transact/src/main.nr.
        pi = new bytes32[](9);
        pi[0] = bytes32(p.root);
        pi[1] = bytes32(p.publicAsset);
        pi[2] = bytes32(p.publicIn);
        pi[3] = bytes32(p.publicOut);
        pi[4] = bytes32(extHash);
        pi[5] = bytes32(p.nullifiers[0]);
        pi[6] = bytes32(p.nullifiers[1]);
        pi[7] = bytes32(p.outCommitments[0]);
        pi[8] = bytes32(p.outCommitments[1]);
    }

    function _pullDeposit(address asset, uint256 amount) internal {
        if (depositsPaused) revert DepositsArePaused();
        AssetConfig memory cfg = assets[asset];
        if (!cfg.listed) revert AssetNotListed(asset);
        if (amount > cfg.maxDeposit) revert DepositTooLarge();
        IERC20 token = IERC20(asset);
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBal = token.balanceOf(address(this));
        if (afterBal - before != amount) revert FeeOnTransferToken();
        if (afterBal > cfg.maxPoolBalance) revert PoolCapReached();
    }

    function _payOut(address asset, uint256 amount, ExtData calldata ext) internal {
        if (ext.fee > amount) revert FeeTooHigh();
        uint256 toRecipient = amount - ext.fee;
        IERC20 token = IERC20(asset);
        if (toRecipient > 0) {
            if (ext.recipient == address(0)) revert NoRecipient();
            token.safeTransfer(ext.recipient, toRecipient);
        }
        if (ext.fee > 0) {
            if (ext.relayer == address(0)) revert NoRecipient();
            token.safeTransfer(ext.relayer, ext.fee);
        }
    }
}
