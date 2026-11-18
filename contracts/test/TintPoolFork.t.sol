// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {console} from "forge-std/Test.sol";
import {TintPool} from "../src/TintPool.sol";
import {TintPoolBase} from "./TintPool.t.sol";

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @notice Deposit, withdraw and private buy/sell with the real USDG and NVDA tokens on a fork of
/// Robinhood Chain mainnet (chain 4663). Run with FORK_TESTS=true.
contract TintPoolForkTest is TintPoolBase {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address constant UNISWAP_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    bool forked;

    function setUp() public {
        if (!vm.envOr("FORK_TESTS", false)) return;
        vm.createSelectFork("robinhood");
        assertEq(block.chainid, 4663);
        forked = true;
        _deploy(UNISWAP_FACTORY);
        vm.startPrank(owner);
        pool.configureAsset(USDG, true, 1_000e6, 10_000e6);
        pool.configureAsset(NVDA, true, 10e18, 100e18);
        vm.stopPrank();
    }

    function test_fork_usdgDepositThenWithdraw() public {
        if (!forked) { vm.skip(true); return; }
        deal(USDG, alice, 500e6);
        vm.prank(alice);
        IERC20(USDG).approve(address(pool), type(uint256).max);

        TintPool.ExtData memory ext = _ext(address(0), address(0), 0);
        TintPool.Proof memory dep = _prove(uint160(USDG), 250e6, 0, _none(), _outs(Out(250e6, 0, 7)), ext);
        _send(dep, ext, alice);
        assertEq(IERC20(USDG).balanceOf(address(pool)), 250e6);

        address bob = makeAddr("bob");
        TintPool.ExtData memory wext = _ext(bob, relayer, 0.5e6);
        TintPool.Proof memory w = _prove(uint160(USDG), 0, 250e6, _ins(In(250e6, 7, 0)), new Out[](0), wext);
        _send(w, wext, relayer);
        assertEq(IERC20(USDG).balanceOf(bob), 249.5e6);
        assertEq(IERC20(USDG).balanceOf(relayer), 0.5e6);
        assertEq(IERC20(USDG).balanceOf(address(pool)), 0);
    }

    function test_fork_nvdaStockTokenDepositThenWithdraw() public {
        if (!forked) { vm.skip(true); return; }
        deal(NVDA, alice, 3e18);
        vm.prank(alice);
        IERC20(NVDA).approve(address(pool), type(uint256).max);

        TintPool.ExtData memory ext = _ext(address(0), address(0), 0);
        TintPool.Proof memory dep = _prove(uint160(NVDA), 2.5e18, 0, _none(), _outs(Out(2.5e18, 0, 9)), ext);
        _send(dep, ext, alice);

        address bob = makeAddr("bob");
        TintPool.ExtData memory wext = _ext(bob, address(0), 0);
        TintPool.Proof memory w = _prove(uint160(NVDA), 0, 1e18, _ins(In(2.5e18, 9, 0)), _outs(Out(1.5e18, 0, 10)), wext);
        _send(w, wext, bob);
        assertEq(IERC20(NVDA).balanceOf(bob), 1e18);
        assertEq(IERC20(NVDA).balanceOf(address(pool)), 1.5e18);
    }

    function _quote(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee) internal returns (uint256 out) {
        (out,,,) = IQuoterV2(QUOTER_V2).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams(tokenIn, tokenOut, amountIn, fee, 0)
        );
    }

    /// Private buy of NVDA with USDG and sell back, on the real NVDA/USDG 0.05% pool.
    function test_fork_privateBuyAndSellNvda() public {
        if (!forked) { vm.skip(true); return; }
        deal(USDG, alice, 500e6);
        vm.prank(alice);
        IERC20(USDG).approve(address(pool), type(uint256).max);
        TintPool.ExtData memory dext = _ext(address(0), address(0), 0);
        TintPool.Proof memory dep = _prove(uint160(USDG), 300e6, 0, _none(), _outs(Out(300e6, 0, 1)), dext);
        _send(dep, dext, alice); // leaves 0 (300 USDG), 1

        // Buy with 200 USDG; accept at most 1% below the live quote.
        uint256 quote = _quote(USDG, NVDA, 200e6, 500);
        console.log("quote: 200 USDG -> NVDA (1e-6)", quote / 1e12);
        TintPool.SwapExt memory ext = _swapExt(500);
        TintPool.SwapProof memory buy =
            _proveSwap(USDG, NVDA, 200e6, quote * 99 / 100, _ins(In(300e6, 1, 0)), 2, 3, ext);
        (uint256 got, uint256 gasUsed) = _sendSwap(buy, ext, relayer); // leaves 2 (100 USDG), 3 (NVDA)
        console.log("private buy gas", gasUsed);
        assertEq(got, quote);
        assertEq(IERC20(NVDA).balanceOf(address(pool)), got);
        assertEq(IERC20(USDG).balanceOf(address(pool)), 100e6);

        // Sell all of it back.
        uint256 back = _quote(NVDA, USDG, got, 500);
        console.log("quote: NVDA -> USDG (1e-6)", back);
        TintPool.SwapExt memory ext2 = _swapExt(500);
        TintPool.SwapProof memory sell = _proveSwap(NVDA, USDG, got, back * 99 / 100, _ins(In(got, 3, 3)), 4, 5, ext2);
        (uint256 got2,) = _sendSwap(sell, ext2, relayer); // leaves 4 (0 NVDA), 5 (USDG)
        assertEq(got2, back);
        assertEq(IERC20(NVDA).balanceOf(address(pool)), 0);

        // Withdraw everything: change (leaf 2) + sale (leaf 5).
        address bob = makeAddr("bob");
        In[] memory ins = new In[](2);
        ins[0] = In(100e6, 2, 2);
        ins[1] = In(got2, 5, 5);
        TintPool.ExtData memory wext = _ext(bob, address(0), 0);
        TintPool.Proof memory w = _prove(uint160(USDG), 0, 100e6 + got2, ins, new Out[](0), wext);
        _send(w, wext, bob);
        assertEq(IERC20(USDG).balanceOf(bob), 100e6 + got2);
        assertEq(IERC20(USDG).balanceOf(address(pool)), 0);
        console.log("round trip cost in USDG (1e-6), pool fees + price impact", 200e6 - got2);
    }

    /// Private buy of TSLA on the real TSLA/USDG 0.3% pool.
    function test_fork_privateBuyTsla() public {
        if (!forked) { vm.skip(true); return; }
        vm.prank(owner);
        pool.configureAsset(TSLA, true, 10e18, 100e18);
        deal(USDG, alice, 100e6);
        vm.prank(alice);
        IERC20(USDG).approve(address(pool), type(uint256).max);
        TintPool.ExtData memory dext = _ext(address(0), address(0), 0);
        TintPool.Proof memory dep = _prove(uint160(USDG), 100e6, 0, _none(), _outs(Out(100e6, 0, 1)), dext);
        _send(dep, dext, alice);

        uint256 quote = _quote(USDG, TSLA, 100e6, 3000);
        TintPool.SwapExt memory ext = _swapExt(3000);
        TintPool.SwapProof memory buy = _proveSwap(USDG, TSLA, 100e6, quote * 99 / 100, _ins(In(100e6, 1, 0)), 2, 3, ext);
        (uint256 got,) = _sendSwap(buy, ext, relayer);
        assertEq(got, quote);
        assertEq(IERC20(TSLA).balanceOf(address(pool)), got);
        console.log("100 USDG bought TSLA (1e-6)", got / 1e12);
    }
}
