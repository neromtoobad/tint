// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TintPool} from "../src/TintPool.sol";
import {TintPoolBase} from "./TintPool.t.sol";

/// @notice Deposit and withdraw with the real USDG and NVDA tokens on a fork of
/// Robinhood Chain mainnet (chain 4663). Run with FORK_TESTS=true.
contract TintPoolForkTest is TintPoolBase {
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    bool forked;

    function setUp() public {
        if (!vm.envOr("FORK_TESTS", false)) return;
        vm.createSelectFork("robinhood");
        assertEq(block.chainid, 4663);
        forked = true;
        _deploy();
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
}
