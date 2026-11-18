// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test, console} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TintPool} from "../src/TintPool.sol";
import {TintTree} from "../src/TintTree.sol";
import {ITintTree} from "../src/interfaces/ITintTree.sol";
import {TransactVerifier, IVerifier} from "../src/verifiers/TransactVerifier.sol";
import {SwapVerifier} from "../src/verifiers/SwapVerifier.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";

contract TestToken is ERC20 {
    uint8 private immutable dec;

    constructor(string memory name, uint8 decimals_) ERC20(name, name) {
        dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Shared setup. Every proof here is a real UltraHonk proof made by
/// sdk/scripts/ffi-transact.mjs (noir_js + bb.js), checked by the generated verifier.
abstract contract TintPoolBase is Test {
    uint256 constant FIELD = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001;

    struct In {
        uint256 amount;
        uint256 blinding;
        uint256 index;
    }

    struct Out {
        uint256 amount;
        uint256 owner; // 0 = the spender
        uint256 blinding;
    }

    TintPool pool;
    TintTree tree;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address relayer = makeAddr("relayer");
    uint256 aliceKey = uint256(keccak256("alice spend key")) % FIELD;
    uint256[] leaves; // every leaf the pool has inserted, in order

    function _deploy(address uniswapFactory) internal {
        pool = new TintPool(
            IVerifier(address(new TransactVerifier())),
            IVerifier(address(new SwapVerifier())),
            IUniswapV3Factory(uniswapFactory),
            owner
        );
        tree = new TintTree(address(pool));
        vm.prank(owner);
        pool.setTree(ITintTree(address(tree)));
    }

    function _ext(address recipient, address relayer_, uint256 fee) internal pure returns (TintPool.ExtData memory) {
        return TintPool.ExtData(recipient, relayer_, fee, hex"", hex"");
    }

    function _prove(
        uint256 asset,
        uint256 publicIn,
        uint256 publicOut,
        In[] memory ins,
        Out[] memory outs,
        TintPool.ExtData memory ext
    ) internal returns (TintPool.Proof memory) {
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "../sdk/scripts/ffi-transact.mjs";
        cmd[2] = vm.toString(abi.encode(aliceKey, asset, publicIn, publicOut, leaves, ins, outs, ext));
        return abi.decode(vm.ffi(cmd), (TintPool.Proof));
    }

    function _send(TintPool.Proof memory p, TintPool.ExtData memory ext, address from) internal returns (uint256 gasUsed) {
        vm.prank(from);
        uint256 g = gasleft();
        pool.transact(p, ext);
        gasUsed = g - gasleft();
        leaves.push(p.outCommitments[0]);
        leaves.push(p.outCommitments[1]);
    }

    /// @dev Real swap proof from sdk/scripts/ffi-swap.mjs.
    function _proveSwap(
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 minOut,
        In[] memory ins,
        uint256 changeBlinding,
        uint256 outBlinding,
        TintPool.SwapExt memory ext
    ) internal returns (TintPool.SwapProof memory) {
        string[] memory cmd = new string[](3);
        cmd[0] = "node";
        cmd[1] = "../sdk/scripts/ffi-swap.mjs";
        cmd[2] = vm.toString(
            abi.encode(
                aliceKey,
                uint256(uint160(assetIn)),
                uint256(uint160(assetOut)),
                amountIn,
                minOut,
                leaves,
                ins,
                changeBlinding,
                outBlinding,
                ext
            )
        );
        return abi.decode(vm.ffi(cmd), (TintPool.SwapProof));
    }

    function _swapExt(uint24 poolFee) internal view returns (TintPool.SwapExt memory) {
        return TintPool.SwapExt(address(0), 0, poolFee, block.timestamp + 600, hex"", hex"");
    }

    /// @dev Sends a swap and records the two new leaves (change, bought).
    function _sendSwap(TintPool.SwapProof memory p, TintPool.SwapExt memory ext, address from)
        internal
        returns (uint256 amountOut, uint256 gasUsed)
    {
        vm.prank(from);
        uint256 g = gasleft();
        amountOut = pool.swap(p, ext);
        gasUsed = g - gasleft();
        leaves.push(p.changeCommitment);
        leaves.push(tree.hash3(p.assetOut, amountOut, p.outInner));
    }

    function _ins(In memory a) internal pure returns (In[] memory r) {
        r = new In[](1);
        r[0] = a;
    }

    function _outs(Out memory a) internal pure returns (Out[] memory r) {
        r = new Out[](1);
        r[0] = a;
    }

    function _none() internal pure returns (In[] memory r) {
        r = new In[](0);
    }
}

contract TintPoolTest is TintPoolBase {
    TestToken usdg;

    function setUp() public {
        _deploy(address(0));
        usdg = new TestToken("USDG", 6);
        vm.prank(owner);
        pool.configureAsset(address(usdg), true, 1_000e6, 10_000e6);
        usdg.mint(alice, 5_000e6);
        vm.prank(alice);
        usdg.approve(address(pool), type(uint256).max);
    }

    function _deposit(uint256 amount, uint256 blinding) internal returns (TintPool.Proof memory p) {
        TintPool.ExtData memory ext = _ext(address(0), address(0), 0);
        p = _prove(uint160(address(usdg)), amount, 0, _none(), _outs(Out(amount, 0, blinding)), ext);
        uint256 gasUsed = _send(p, ext, alice);
        console.log("deposit gas", gasUsed);
    }

    function test_hashesMatchTheCircuits() public view {
        // Values printed by `nargo test --show-output` in circuits/notes.
        assertEq(tree.hash2(1, 2), 0x038682aa1cb5ae4e0a3f13da432a95c77c5c111f6f030faf9cad641ce1ed7383);
        assertEq(tree.hash3(1, 2, 3), 0x23864adb160dddf590f1d3303683ebcb914f828e2635f6e85a32f0a1aecd3dd8);
        assertEq(tree.currentRoot(), 0x1c8c3ca0b3a3d75850fcd4dc7bf1e3445cd0cfff3ca510630fd90b47e8a24755);
    }

    function test_depositThenWithdraw() public {
        TintPool.Proof memory dep = _deposit(100e6, 111);
        assertEq(usdg.balanceOf(address(pool)), 100e6);
        assertEq(usdg.balanceOf(alice), 4_900e6);
        // The SDK's off-chain tree and the contract agree on the new root.
        assertTrue(tree.isKnownRoot(dep.root));

        // Withdraw 60 to a fresh address; 40 stays in the pool as a change note.
        address bob = makeAddr("bob");
        TintPool.ExtData memory ext = _ext(bob, address(0), 0);
        TintPool.Proof memory w =
            _prove(uint160(address(usdg)), 0, 60e6, _ins(In(100e6, 111, 0)), _outs(Out(40e6, 0, 222)), ext);
        uint256 gasUsed = _send(w, ext, makeAddr("anyone"));
        console.log("withdraw gas", gasUsed);
        assertEq(usdg.balanceOf(bob), 60e6);
        assertEq(usdg.balanceOf(address(pool)), 40e6);

        // Spend the change note (leaf 2), paying a relayer 1 USDG from inside the proof.
        address carol = makeAddr("carol");
        TintPool.ExtData memory ext2 = _ext(carol, relayer, 1e6);
        TintPool.Proof memory w2 =
            _prove(uint160(address(usdg)), 0, 40e6, _ins(In(40e6, 222, 2)), new Out[](0), ext2);
        _send(w2, ext2, relayer);
        assertEq(usdg.balanceOf(carol), 39e6);
        assertEq(usdg.balanceOf(relayer), 1e6);
        assertEq(usdg.balanceOf(address(pool)), 0);
    }

    function test_privateTransferMovesNoTokens() public {
        _deposit(100e6, 111);
        // Alice pays 30 to another Tint owner; nothing leaves the pool and the asset is hidden.
        uint256 bobOwner = tree.hash2(1, 98765); // owner_of(bob's spend key)
        In[] memory ins = _ins(In(100e6, 111, 0));
        Out[] memory outs = new Out[](2);
        outs[0] = Out(30e6, bobOwner, 333);
        outs[1] = Out(70e6, 0, 444);
        TintPool.ExtData memory ext = _ext(address(0), address(0), 0);
        TintPool.Proof memory p = _prove(uint160(address(usdg)), 0, 0, ins, outs, ext);
        assertEq(p.publicAsset, 0);
        _send(p, ext, relayer);
        assertEq(usdg.balanceOf(address(pool)), 100e6);
    }

    function test_rejectsDoubleSpend() public {
        _deposit(100e6, 111);
        address bob = makeAddr("bob");
        TintPool.ExtData memory ext = _ext(bob, address(0), 0);
        TintPool.Proof memory w = _prove(uint160(address(usdg)), 0, 100e6, _ins(In(100e6, 111, 0)), new Out[](0), ext);
        _send(w, ext, bob);
        vm.expectRevert(abi.encodeWithSelector(TintPool.NullifierSpent.selector, w.nullifiers[0]));
        pool.transact(w, ext);
    }

    function test_rejectsChangedRecipient() public {
        _deposit(100e6, 111);
        TintPool.ExtData memory ext = _ext(makeAddr("bob"), address(0), 0);
        TintPool.Proof memory w = _prove(uint160(address(usdg)), 0, 100e6, _ins(In(100e6, 111, 0)), new Out[](0), ext);
        // A relayer or front-runner swaps in their own address: the proof no longer matches.
        ext.recipient = makeAddr("thief");
        vm.expectRevert();
        pool.transact(w, ext);
    }

    function test_rejectsChangedAmount() public {
        _deposit(100e6, 111);
        TintPool.ExtData memory ext = _ext(makeAddr("bob"), address(0), 0);
        TintPool.Proof memory w = _prove(uint160(address(usdg)), 0, 50e6, _ins(In(100e6, 111, 0)), _outs(Out(50e6, 0, 5)), ext);
        w.publicOut = 100e6;
        vm.expectRevert();
        pool.transact(w, ext);
    }

    function test_rejectsNonCanonicalNullifier() public {
        _deposit(100e6, 111);
        TintPool.ExtData memory ext = _ext(makeAddr("bob"), address(0), 0);
        TintPool.Proof memory w = _prove(uint160(address(usdg)), 0, 100e6, _ins(In(100e6, 111, 0)), new Out[](0), ext);
        w.nullifiers[0] += FIELD; // same value mod p, different mapping key
        vm.expectRevert(TintPool.NotAFieldElement.selector);
        pool.transact(w, ext);
    }

    function test_rejectsUnknownRoot() public {
        _deposit(100e6, 111);
        TintPool.ExtData memory ext = _ext(makeAddr("bob"), address(0), 0);
        TintPool.Proof memory w = _prove(uint160(address(usdg)), 0, 100e6, _ins(In(100e6, 111, 0)), new Out[](0), ext);
        w.root = 12345;
        vm.expectRevert(TintPool.UnknownRoot.selector);
        pool.transact(w, ext);
    }

    function test_depositCapsAndPause() public {
        TintPool.ExtData memory ext = _ext(address(0), address(0), 0);
        TintPool.Proof memory big = _prove(uint160(address(usdg)), 1_001e6, 0, _none(), _outs(Out(1_001e6, 0, 1)), ext);
        vm.prank(alice);
        vm.expectRevert(TintPool.DepositTooLarge.selector);
        pool.transact(big, ext);

        _deposit(100e6, 111);
        vm.prank(owner);
        pool.setDepositsPaused(true);

        TintPool.Proof memory dep2 = _prove(uint160(address(usdg)), 10e6, 0, _none(), _outs(Out(10e6, 0, 2)), ext);
        vm.prank(alice);
        vm.expectRevert(TintPool.DepositsArePaused.selector);
        pool.transact(dep2, ext);

        // Withdrawals still work while deposits are paused.
        address bob = makeAddr("bob");
        TintPool.ExtData memory wext = _ext(bob, address(0), 0);
        TintPool.Proof memory w = _prove(uint160(address(usdg)), 0, 100e6, _ins(In(100e6, 111, 0)), new Out[](0), wext);
        _send(w, wext, bob);
        assertEq(usdg.balanceOf(bob), 100e6);
    }

    function test_onlyOwnerConfigures() public {
        vm.expectRevert();
        pool.configureAsset(address(usdg), true, type(uint128).max, type(uint128).max);
        vm.expectRevert();
        pool.setDepositsPaused(true);
        vm.prank(owner);
        vm.expectRevert(TintPool.TreeAlreadySet.selector);
        pool.setTree(ITintTree(address(1)));
    }

    function test_onlyPoolInsertsLeaves() public {
        vm.expectRevert(TintTree.OnlyPool.selector);
        tree.insertPair(1, 2);
    }
}
