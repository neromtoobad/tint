// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IVerifier} from "./verifiers/TransactVerifier.sol";
import {ITintTree} from "./interfaces/ITintTree.sol";
import {IUniswapV3Factory, IUniswapV3Pool} from "./interfaces/IUniswapV3.sol";

/// @title TintPool
/// @notice Holds the tokens behind every private balance in Tint and checks the
/// proofs that move them.
///   - `transact`: deposit, withdraw and private transfer (circuits/transact)
///   - `swap`: buy or sell from inside the private balance on a public Uniswap v3
///     pool (circuits/swap). The trade is public; who made it is not.
///
/// Trust model: the owner can list assets, set deposit caps, pause NEW deposits
/// and set a swap fee of at most 1%. The owner cannot move anyone's tokens,
/// cannot block withdrawals and cannot touch notes. Unaudited: caps stay low
/// until an outside review.
contract TintPool is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;
    uint256 public constant MAX_AMOUNT = 1 << 112; // circuits keep amounts below this
    uint16 public constant MAX_SWAP_FEE_BPS = 100;
    uint160 internal constant MIN_SQRT_RATIO = 4295128739;
    uint160 internal constant MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342;

    /// @notice What a transact proof shows. Every value is a field element.
    struct Proof {
        bytes proof;
        uint256 root;
        uint256 publicAsset; // token address as a number; 0 for a private transfer
        uint256 publicIn; // tokens pulled from msg.sender into the pool
        uint256 publicOut; // tokens paid out: (publicOut - fee) to recipient, fee to relayer
        uint256[2] nullifiers;
        uint256[2] outCommitments;
    }

    /// @notice Data a transact proof is bound to through its ext hash.
    struct ExtData {
        address recipient;
        address relayer;
        uint256 fee;
        bytes encryptedOutput0;
        bytes encryptedOutput1;
    }

    /// @notice What a swap proof shows.
    struct SwapProof {
        bytes proof;
        uint256 root;
        uint256[2] nullifiers;
        uint256 assetIn;
        uint256 amountIn; // taken from the spent notes: relayer fee + swap fee + amount sold
        uint256 assetOut;
        uint256 minOut;
        uint256 changeCommitment; // change note in assetIn
        uint256 outInner; // inner hash of the bought note; the pool adds asset and amount
    }

    /// @notice Data a swap proof is bound to through its ext hash.
    struct SwapExt {
        address relayer;
        uint256 fee; // in assetIn, paid to the relayer
        uint24 poolFee; // Uniswap v3 fee tier (100, 500, 3000, 10000)
        uint256 deadline;
        bytes encryptedChange;
        bytes encryptedOut;
    }

    struct AssetConfig {
        bool listed; // can be deposited and bought
        uint128 maxDeposit; // per deposit
        uint128 maxPoolBalance; // pool-wide, checked on deposit
    }

    IVerifier public immutable transactVerifier;
    IVerifier public immutable swapVerifier;
    IUniswapV3Factory public immutable uniswapFactory;
    ITintTree public tree;

    mapping(uint256 => bool) public nullifierSpent;
    mapping(address => AssetConfig) public assets;
    bool public depositsPaused;
    address public treasury;
    uint16 public swapFeeBps;

    /// @dev The Uniswap pool we are swapping with right now, and what we owe it.
    address private transient activePool;
    address private transient activeTokenIn;
    uint256 private transient activeAmountIn;

    event NewCommitment(uint256 indexed commitment, uint32 index, bytes encryptedOutput);
    event NewNullifier(uint256 indexed nullifier);
    /// @notice The public side of a transact call (already visible in its calldata).
    event Transacted(uint256 publicAsset, uint256 publicIn, uint256 publicOut, uint256 relayerFee);
    event Swapped(address indexed assetIn, address indexed assetOut, uint256 amountSold, uint256 amountOut);
    event AssetConfigured(address indexed asset, bool listed, uint128 maxDeposit, uint128 maxPoolBalance);
    event DepositsPaused(bool paused);
    event SwapFeeSet(address treasury, uint16 bps);

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
    error Expired();
    error NoUniswapPool();
    error NotActivePool();
    error TooLittleReceived(uint256 amountOut, uint256 minOut);
    error AmountTooLarge();
    error PartialFill();

    constructor(IVerifier transactVerifier_, IVerifier swapVerifier_, IUniswapV3Factory factory_, address owner_)
        Ownable(owner_)
    {
        transactVerifier = transactVerifier_;
        swapVerifier = swapVerifier_;
        uniswapFactory = factory_;
    }

    /// @notice One-time link to the tree (the tree needs the pool's address first).
    function setTree(ITintTree tree_) external onlyOwner {
        if (address(tree) != address(0)) revert TreeAlreadySet();
        tree = tree_;
    }

    // ------------------------------------------------------------------ deposit / withdraw / transfer

    function transact(Proof calldata p, ExtData calldata ext) external nonReentrant {
        uint256 extHash = hashExtData(ext);
        if (
            p.root >= FIELD || p.publicAsset >= FIELD || p.publicIn >= FIELD || p.publicOut >= FIELD
                || p.outCommitments[0] >= FIELD || p.outCommitments[1] >= FIELD
        ) revert NotAFieldElement();
        _checkRootAndNullifiers(p.root, p.nullifiers);

        if (!transactVerifier.verify(p.proof, _transactInputs(p, extHash))) revert InvalidProof();

        _spend(p.nullifiers);
        _insert(p.outCommitments[0], p.outCommitments[1], ext.encryptedOutput0, ext.encryptedOutput1);
        emit Transacted(p.publicAsset, p.publicIn, p.publicOut, ext.fee);

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

    // ------------------------------------------------------------------ private buy / sell

    function swap(SwapProof calldata p, SwapExt calldata ext) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > ext.deadline) revert Expired();
        uint256 extHash = hashSwapExt(ext);
        if (
            p.root >= FIELD || p.assetIn >> 160 != 0 || p.assetOut >> 160 != 0 || p.amountIn >= MAX_AMOUNT
                || p.minOut >= MAX_AMOUNT || p.changeCommitment >= FIELD || p.outInner >= FIELD
        ) revert NotAFieldElement();
        address assetIn = address(uint160(p.assetIn));
        address assetOut = address(uint160(p.assetOut));
        if (!assets[assetOut].listed) revert AssetNotListed(assetOut);
        _checkRootAndNullifiers(p.root, p.nullifiers);

        if (!swapVerifier.verify(p.proof, _swapInputs(p, extHash))) revert InvalidProof();
        _spend(p.nullifiers);

        // Fees come out of amountIn, in assetIn.
        if (ext.fee > p.amountIn) revert FeeTooHigh();
        uint256 afterRelayer = p.amountIn - ext.fee;
        uint256 swapFee = afterRelayer * swapFeeBps / 10_000;
        uint256 toSell = afterRelayer - swapFee;
        if (ext.fee > 0) {
            if (ext.relayer == address(0)) revert NoRecipient();
            IERC20(assetIn).safeTransfer(ext.relayer, ext.fee);
        }
        if (swapFee > 0) IERC20(assetIn).safeTransfer(treasury, swapFee);

        amountOut = _sellOnUniswap(assetIn, assetOut, ext.poolFee, toSell);
        if (amountOut < p.minOut) revert TooLittleReceived(amountOut, p.minOut);
        if (amountOut >= MAX_AMOUNT) revert AmountTooLarge();
        emit Swapped(assetIn, assetOut, toSell, amountOut);

        // Finish the bought note now that its amount is known.
        uint256 bought = tree.hash3(p.assetOut, amountOut, p.outInner);
        _insert(p.changeCommitment, bought, ext.encryptedChange, ext.encryptedOut);
    }

    function hashSwapExt(SwapExt calldata ext) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(ext))) % FIELD;
    }

    /// @dev Uniswap v3 calls this during `swap`: pay exactly what we agreed to sell.
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        if (msg.sender != activePool || activePool == address(0)) revert NotActivePool();
        uint256 owed = uint256(amount0Delta > 0 ? amount0Delta : amount1Delta);
        if (owed != activeAmountIn) revert PartialFill();
        activePool = address(0);
        IERC20(activeTokenIn).safeTransfer(msg.sender, owed);
    }

    // ------------------------------------------------------------------ owner

    function configureAsset(address asset, bool listed, uint128 maxDeposit, uint128 maxPoolBalance)
        external
        onlyOwner
    {
        assets[asset] = AssetConfig(listed, maxDeposit, maxPoolBalance);
        emit AssetConfigured(asset, listed, maxDeposit, maxPoolBalance);
    }

    /// @notice Pauses new deposits only. Withdrawals, transfers and swaps always work.
    function setDepositsPaused(bool paused) external onlyOwner {
        depositsPaused = paused;
        emit DepositsPaused(paused);
    }

    /// @notice Swap fee in basis points, at most MAX_SWAP_FEE_BPS (1%).
    function setSwapFee(address treasury_, uint16 bps) external onlyOwner {
        if (bps > MAX_SWAP_FEE_BPS || (bps > 0 && treasury_ == address(0))) revert FeeTooHigh();
        treasury = treasury_;
        swapFeeBps = bps;
        emit SwapFeeSet(treasury_, bps);
    }

    // ------------------------------------------------------------------ internals

    function _checkRootAndNullifiers(uint256 root, uint256[2] calldata nullifiers) internal view {
        // Non-canonical encodings (x + FIELD) would let one nullifier be "new" twice.
        if (nullifiers[0] >= FIELD || nullifiers[1] >= FIELD) revert NotAFieldElement();
        if (!tree.isKnownRoot(root)) revert UnknownRoot();
        for (uint256 i = 0; i < 2; i++) {
            if (nullifierSpent[nullifiers[i]]) revert NullifierSpent(nullifiers[i]);
        }
    }

    function _spend(uint256[2] calldata nullifiers) internal {
        for (uint256 i = 0; i < 2; i++) {
            nullifierSpent[nullifiers[i]] = true;
            emit NewNullifier(nullifiers[i]);
        }
    }

    function _insert(uint256 a, uint256 b, bytes calldata encA, bytes calldata encB) internal {
        (uint32 index,) = tree.insertPair(a, b);
        emit NewCommitment(a, index, encA);
        emit NewCommitment(b, index + 1, encB);
    }

    function _transactInputs(Proof calldata p, uint256 extHash) internal pure returns (bytes32[] memory pi) {
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

    function _swapInputs(SwapProof calldata p, uint256 extHash) internal pure returns (bytes32[] memory pi) {
        // Same order as the parameters of circuits/swap/src/main.nr.
        pi = new bytes32[](10);
        pi[0] = bytes32(p.root);
        pi[1] = bytes32(p.nullifiers[0]);
        pi[2] = bytes32(p.nullifiers[1]);
        pi[3] = bytes32(p.assetIn);
        pi[4] = bytes32(p.amountIn);
        pi[5] = bytes32(p.assetOut);
        pi[6] = bytes32(p.minOut);
        pi[7] = bytes32(p.changeCommitment);
        pi[8] = bytes32(p.outInner);
        pi[9] = bytes32(extHash);
    }

    function _sellOnUniswap(address tokenIn, address tokenOut, uint24 fee, uint256 amount)
        internal
        returns (uint256 received)
    {
        if (address(uniswapFactory) == address(0)) revert NoUniswapPool();
        address pool = uniswapFactory.getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert NoUniswapPool();
        bool zeroForOne = tokenIn < tokenOut;

        activePool = pool;
        activeTokenIn = tokenIn;
        activeAmountIn = amount;
        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        IUniswapV3Pool(pool).swap(
            address(this), zeroForOne, int256(amount), zeroForOne ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1, ""
        );
        // The callback clears activePool once it has paid; if it never ran, nothing was sold.
        if (activePool != address(0)) revert PartialFill();
        received = IERC20(tokenOut).balanceOf(address(this)) - before;
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
