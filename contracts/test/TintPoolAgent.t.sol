// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {console} from "forge-std/Test.sol";
import {TintPool} from "../src/TintPool.sol";
import {TintPoolBase, TestToken} from "./TintPool.t.sol";
import {MockUniswapPool, MockUniswapFactory} from "./mocks/MockUniswap.sol";

/// @notice Agent accounts: an agent trades inside an account within private
/// rules (agentSwap); only the user, with both keys, moves money out
/// (agentTransact). Every proof is real (sdk/scripts/ffi-agent.mjs).
/// The rule checks themselves (wrong stock, over the cap, late, another relayer,
/// note leaving the account, agent alone withdrawing) are tested in
/// circuits/agent_swap and circuits/agent_transact: such a proof can't be made.
contract TintPoolAgentTest is TintPoolBase {
    struct Rules {
        uint256[6] assets;
        uint256 maxBuy;
        uint256 maxFeeBps;
        uint256 endsAt;
        address relayer;
    }

    TestToken usdg;
    TestToken nvda;
    uint256 constant AGENT_KEY = 0x77;
    uint256 account; // the agent account's note owner
    uint256 userOwner; // the user's own note owner
    Rules rules;

    function setUp() public {
        usdg = new TestToken("USDG", 6);
        nvda = new TestToken("NVDA", 18);
        MockUniswapFactory factory = new MockUniswapFactory();
        MockUniswapPool uni = new MockUniswapPool(address(nvda), address(usdg), 200e6); // 1 NVDA = 200 USDG
        factory.add(address(uni), address(usdg), address(nvda), 500);
        usdg.mint(address(uni), 1_000_000e6);
        nvda.mint(address(uni), 10_000e18);

        _deploy(address(factory));
        vm.startPrank(owner);
        pool.configureAsset(address(usdg), true, 1_000e6, 10_000e6);
        pool.configureAsset(address(nvda), true, 10e18, 100e18);
        vm.stopPrank();

        // Rules: USDG cash, NVDA only, at most 50 USDG a buy, fee at most 5%, this relayer, ends in a week.
        rules.assets[0] = uint160(address(usdg));
        rules.assets[1] = uint160(address(nvda));
        rules.maxBuy = 50e6;
        rules.maxFeeBps = 500;
        rules.endsAt = block.timestamp + 7 days;
        rules.relayer = relayer;
        (account, userOwner) = abi.decode(_ffi("owner", 0, _none(), ""), (uint256, uint256));

        // Fund the account: alice deposits 100 USDG straight into it (leaf 0).
        usdg.mint(alice, 1_000e6);
        vm.prank(alice);
        usdg.approve(address(pool), type(uint256).max);
        TintPool.ExtData memory ext = _ext(address(0), address(0), 0);
        TintPool.Proof memory dep =
            _prove(uint160(address(usdg)), 100e6, 0, _none(), _outs(Out(100e6, account, 111)), ext);
        _send(dep, ext, alice);
    }

    function _ffi(string memory kind, uint256 withUserKey, In[] memory ins, bytes memory call)
        internal
        returns (bytes memory)
    {
        string[] memory cmd = new string[](4);
        cmd[0] = "node";
        cmd[1] = "../sdk/scripts/ffi-agent.mjs";
        cmd[2] = kind;
        cmd[3] = vm.toString(abi.encode(AGENT_KEY, withUserKey, rules, leaves, ins, call));
        return vm.ffi(cmd);
    }

    function _agentBuy(uint256 amountIn, uint256 minOut, TintPool.SwapExt memory ext)
        internal
        returns (TintPool.SwapProof memory)
    {
        bytes memory call = abi.encode(
            uint256(uint160(address(usdg))),
            uint256(uint160(address(nvda))),
            amountIn,
            minOut,
            uint256(222),
            uint256(333),
            ext
        );
        return abi.decode(_ffi("swap", 0, _ins(In(100e6, 111, 0)), call), (TintPool.SwapProof));
    }

    function _relayedExt(uint256 fee) internal view returns (TintPool.SwapExt memory) {
        return TintPool.SwapExt(relayer, fee, 500, block.timestamp + 600, hex"", hex"");
    }

    function test_agentBuysWithinRulesAndOnlyTheUserTakesItOut() public {
        // The agent buys 40 USDG of NVDA, paying the relayer 1 USDG (2.5%, under the 5% cap).
        TintPool.SwapExt memory ext = _relayedExt(1e6);
        TintPool.SwapProof memory buy = _agentBuy(40e6, 0.19e18, ext);
        vm.prank(relayer);
        uint256 g = gasleft();
        uint256 got = pool.agentSwap(buy, ext);
        console.log("agent buy gas", g - gasleft());
        leaves.push(buy.changeCommitment); // leaf 2: 60 USDG, still the account's
        leaves.push(tree.hash3(buy.assetOut, got, buy.outInner)); // leaf 3: NVDA, the account's
        assertEq(got, 0.195e18);
        assertEq(usdg.balanceOf(relayer), 1e6);
        assertEq(usdg.balanceOf(address(pool)), 60e6);
        assertEq(nvda.balanceOf(address(pool)), 0.195e18);

        // The user stops the agent: NVDA out to a fresh address (needs both keys).
        address bob = makeAddr("bob");
        TintPool.ExtData memory wext = _ext(bob, address(0), 0);
        bytes memory call =
            abi.encode(uint256(uint160(address(nvda))), uint256(0), uint256(0.195e18), new In[](0), wext);
        TintPool.Proof memory w = abi.decode(_ffi("transact", 1, _ins(In(0.195e18, 333, 3)), call), (TintPool.Proof));
        vm.prank(bob);
        g = gasleft();
        pool.agentTransact(w, wext);
        console.log("agent take-out gas", g - gasleft());
        assertEq(nvda.balanceOf(bob), 0.195e18);
        leaves.push(w.outCommitments[0]);
        leaves.push(w.outCommitments[1]);

        // And the 60 USDG back into the user's own private balance (nothing leaves the pool).
        TintPool.ExtData memory bext = _ext(address(0), address(0), 0);
        bytes memory back =
            abi.encode(uint256(uint160(address(usdg))), uint256(0), uint256(0), _outIn(60e6, userOwner, 444), bext);
        TintPool.Proof memory b = abi.decode(_ffi("transact", 1, _ins(In(60e6, 222, 2)), back), (TintPool.Proof));
        pool.agentTransact(b, bext);
        assertEq(usdg.balanceOf(address(pool)), 60e6);
    }

    function _outIn(uint256 amount, uint256 owner_, uint256 blinding) internal pure returns (In[] memory r) {
        // outputs share the In tuple shape (amount, owner, blinding) in the ffi call
        r = new In[](1);
        r[0] = In(amount, owner_, blinding);
    }

    function test_agentProofIsNotAPlainSwapProof() public {
        TintPool.SwapExt memory ext = _relayedExt(1e6);
        TintPool.SwapProof memory buy = _agentBuy(40e6, 0, ext);
        vm.expectRevert(); // the verifier rejects it (SumcheckFailed)
        pool.swap(buy, ext);
    }

    function test_relayerFeeAndDeadlineAreBoundToTheProof() public {
        TintPool.SwapExt memory ext = _relayedExt(1e6);
        TintPool.SwapProof memory buy = _agentBuy(40e6, 0, ext);
        TintPool.SwapExt memory more = _relayedExt(2e6);
        vm.expectRevert(); // the verifier rejects it (SumcheckFailed)
        pool.agentSwap(buy, more);
        TintPool.SwapExt memory later = TintPool.SwapExt(relayer, 1e6, 500, block.timestamp + 6 days, hex"", hex"");
        vm.expectRevert(); // the verifier rejects it (SumcheckFailed)
        pool.agentSwap(buy, later);
    }
}
