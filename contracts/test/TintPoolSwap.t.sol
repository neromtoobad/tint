// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {console} from "forge-std/Test.sol";
import {TintPool} from "../src/TintPool.sol";
import {TintPoolBase, TestToken} from "./TintPool.t.sol";
import {MockUniswapPool, MockUniswapFactory} from "./mocks/MockUniswap.sol";

/// @notice Private buy and sell against a fixed-price mock pool (1 NVDA = 200 USDG).
/// Every proof is real. The same flows run against the real pools in TintPoolFork.t.sol.
contract TintPoolSwapTest is TintPoolBase {
    TestToken usdg;
    TestToken nvda;
    MockUniswapPool uni;

    function setUp() public {
        usdg = new TestToken("USDG", 6);
        nvda = new TestToken("NVDA", 18);
        MockUniswapFactory factory = new MockUniswapFactory();
        // 1e18 NVDA = 200e6 USDG
        uni = new MockUniswapPool(address(nvda), address(usdg), 200e6);
        factory.add(address(uni), address(usdg), address(nvda), 500);
        usdg.mint(address(uni), 1_000_000e6);
        nvda.mint(address(uni), 10_000e18);

        _deploy(address(factory));
        vm.startPrank(owner);
        pool.configureAsset(address(usdg), true, 1_000e6, 10_000e6);
        pool.configureAsset(address(nvda), true, 10e18, 100e18);
        vm.stopPrank();

        usdg.mint(alice, 1_000e6);
        vm.prank(alice);
        usdg.approve(address(pool), type(uint256).max);

        // Alice deposits 100 USDG: leaf 0 (100), leaf 1 (0).
        TintPool.ExtData memory ext = _ext(address(0), address(0), 0);
        TintPool.Proof memory dep =
            _prove(uint160(address(usdg)), 100e6, 0, _none(), _outs(Out(100e6, 0, 111)), ext);
        _send(dep, ext, alice);
    }

    function test_privateBuySellAndWithdraw() public {
        // Buy NVDA with 60 of the 100 USDG. Change (40 USDG) -> leaf 2, NVDA -> leaf 3.
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0.29e18, _ins(In(100e6, 111, 0)), 222, 333, ext);
        (uint256 got, uint256 gasUsed) = _sendSwap(buy, ext, relayer);
        console.log("private buy gas", gasUsed);
        assertEq(got, 0.3e18);
        assertEq(usdg.balanceOf(address(pool)), 40e6);
        assertEq(nvda.balanceOf(address(pool)), 0.3e18);
        // The relayer sent it; nothing on chain names alice.

        // Sell 0.1 NVDA back. Change (0.2 NVDA) -> leaf 4, USDG -> leaf 5.
        TintPool.SwapExt memory ext2 = _swapExt(500);
        TintPool.SwapProof memory sell =
            _proveSwap(address(nvda), address(usdg), 0.1e18, 19e6, _ins(In(0.3e18, 333, 3)), 444, 555, ext2);
        (uint256 got2,) = _sendSwap(sell, ext2, relayer);
        assertEq(got2, 20e6);
        assertEq(usdg.balanceOf(address(pool)), 60e6);
        assertEq(nvda.balanceOf(address(pool)), 0.2e18);

        // Withdraw all USDG in one go: the change note (leaf 2) and the sale (leaf 5).
        address bob = makeAddr("bob");
        In[] memory ins = new In[](2);
        ins[0] = In(40e6, 222, 2);
        ins[1] = In(20e6, 555, 5);
        TintPool.ExtData memory wext = _ext(bob, address(0), 0);
        TintPool.Proof memory w = _prove(uint160(address(usdg)), 0, 60e6, ins, new Out[](0), wext);
        _send(w, wext, bob);
        assertEq(usdg.balanceOf(bob), 60e6);

        // And the remaining NVDA (leaf 4).
        TintPool.ExtData memory next = _ext(bob, address(0), 0);
        TintPool.Proof memory w2 = _prove(uint160(address(nvda)), 0, 0.2e18, _ins(In(0.2e18, 444, 4)), new Out[](0), next);
        _send(w2, next, bob);
        assertEq(nvda.balanceOf(bob), 0.2e18);
        assertEq(nvda.balanceOf(address(pool)), 0);
        assertEq(usdg.balanceOf(address(pool)), 0);
    }

    function test_feesGoToRelayerAndTreasury() public {
        address treasury = makeAddr("treasury");
        vm.prank(owner);
        pool.setSwapFee(treasury, 25); // 0.25%
        TintPool.SwapExt memory ext = TintPool.SwapExt(relayer, 1e6, 500, block.timestamp + 600, hex"", hex"");
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 41e6, 0, _ins(In(100e6, 111, 0)), 222, 333, ext);
        (uint256 got,) = _sendSwap(buy, ext, relayer);
        assertEq(usdg.balanceOf(relayer), 1e6);
        assertEq(usdg.balanceOf(treasury), 0.1e6); // 0.25% of 40
        assertEq(got, uint256(39.9e6) * 1e18 / 200e6);
    }

    function test_rejectsTooLittleReceived() public {
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0.31e18, _ins(In(100e6, 111, 0)), 222, 333, ext);
        vm.expectRevert(abi.encodeWithSelector(TintPool.TooLittleReceived.selector, 0.3e18, 0.31e18));
        pool.swap(buy, ext);
    }

    function test_rejectsChangedMinOut() public {
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0.29e18, _ins(In(100e6, 111, 0)), 222, 333, ext);
        buy.minOut = 0; // a relayer trying to make room for a sandwich
        vm.expectRevert();
        pool.swap(buy, ext);
    }

    function test_rejectsChangedFeeTierOrRelayerFee() public {
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0, _ins(In(100e6, 111, 0)), 222, 333, ext);
        ext.fee = 10e6;
        ext.relayer = relayer;
        vm.expectRevert();
        pool.swap(buy, ext);
    }

    function test_rejectsExpired() public {
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0, _ins(In(100e6, 111, 0)), 222, 333, ext);
        vm.warp(ext.deadline + 1);
        vm.expectRevert(TintPool.Expired.selector);
        pool.swap(buy, ext);
    }

    function test_rejectsUnlistedAssetOut() public {
        vm.prank(owner);
        pool.configureAsset(address(nvda), false, 0, 0);
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0, _ins(In(100e6, 111, 0)), 222, 333, ext);
        vm.expectRevert(abi.encodeWithSelector(TintPool.AssetNotListed.selector, address(nvda)));
        pool.swap(buy, ext);
    }

    function test_rejectsMissingUniswapPool() public {
        TintPool.SwapExt memory ext = _swapExt(3000); // no pool at this fee tier
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0, _ins(In(100e6, 111, 0)), 222, 333, ext);
        vm.expectRevert(TintPool.NoUniswapPool.selector);
        pool.swap(buy, ext);
    }

    function test_rejectsPartialFill() public {
        uni.setAskLess(true);
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0, _ins(In(100e6, 111, 0)), 222, 333, ext);
        vm.expectRevert(TintPool.PartialFill.selector);
        pool.swap(buy, ext);
    }

    function test_swappedNoteCannotBeSpentTwice() public {
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(address(usdg), address(nvda), 60e6, 0, _ins(In(100e6, 111, 0)), 222, 333, ext);
        _sendSwap(buy, ext, relayer);
        vm.expectRevert(abi.encodeWithSelector(TintPool.NullifierSpent.selector, buy.nullifiers[0]));
        pool.swap(buy, ext);
    }

    function test_callbackOnlyFromActivePool() public {
        vm.expectRevert(TintPool.NotActivePool.selector);
        pool.uniswapV3SwapCallback(1, 0, "");
        vm.prank(address(uni));
        vm.expectRevert(TintPool.NotActivePool.selector);
        pool.uniswapV3SwapCallback(1, 0, "");
    }

    function test_swapFeeIsCapped() public {
        vm.prank(owner);
        vm.expectRevert(TintPool.FeeTooHigh.selector);
        pool.setSwapFee(makeAddr("treasury"), 101);
    }
}
