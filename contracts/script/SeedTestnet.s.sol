// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function factory() external view returns (address);

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

/// @notice Testnet only: makes the small "test pools" Tint trades on.
/// Robinhood Chain testnet has Robinhood's test stock tokens but no USDG pools,
/// so this deploys TestUSDG and opens a full-range tUSDG/stock pool on the
/// testnet's Uniswap v3 for each stock, at a set price, with the stock the
/// deployer holds (from the Robinhood faucet).
///
/// Env:
///   NPM      Uniswap v3 NonfungiblePositionManager on this chain
///   STOCKS   comma-separated stock token addresses (18 decimals)
///   PRICES   comma-separated price of one share in tUSDG units (6 decimals), same order
///   SHARES   comma-separated shares to put in each pool (18 decimals), same order
///   USDG     optional: an existing TestUSDG to reuse
///
/// Writes deployments/<chainid>-seed.json.
contract SeedTestnet is Script {
    uint24 constant FEE = 3000;
    int24 constant MAX_TICK = 887220; // full range for tick spacing 60

    function run() external {
        INonfungiblePositionManager npm = INonfungiblePositionManager(vm.envAddress("NPM"));
        address[] memory stocks = vm.envAddress("STOCKS", ",");
        uint256[] memory prices = vm.envUint("PRICES", ",");
        uint256[] memory shares = vm.envUint("SHARES", ",");
        require(stocks.length == prices.length && stocks.length == shares.length, "lengths");

        vm.startBroadcast();
        address me = msg.sender;
        address usdgAddr = vm.envOr("USDG", address(0));
        TestUSDG usdg = usdgAddr == address(0) ? new TestUSDG() : TestUSDG(usdgAddr);

        uint256 need;
        for (uint256 i = 0; i < stocks.length; i++) {
            need += shares[i] * prices[i] / 1e18 + 1;
        }
        uint256 have = usdg.balanceOf(me);
        if (have < need) usdg.faucetTo(me, (need - have) / usdg.FAUCET_MAX() + 1);
        usdg.approve(address(npm), type(uint256).max);

        address[] memory pools = new address[](stocks.length);
        for (uint256 i = 0; i < stocks.length; i++) {
            pools[i] = _seed(npm, address(usdg), stocks[i], prices[i], shares[i], me);
        }
        vm.stopBroadcast();

        string memory o = "seed";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "uniswapFactory", npm.factory());
        vm.serializeAddress(o, "pools", pools);
        vm.serializeAddress(o, "stocks", stocks);
        string memory json = vm.serializeAddress(o, "usdg", address(usdg));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), "-seed.json"));
        console.log("usdg", address(usdg));
    }

    /// @dev Opens a full-range tUSDG/stock pool at `price` and adds `shares` of the stock.
    function _seed(INonfungiblePositionManager npm, address usdg, address stock, uint256 price, uint256 shares, address me)
        internal
        returns (address pool)
    {
        IERC20(stock).approve(address(npm), type(uint256).max);
        bool stockFirst = stock < usdg;
        (address t0, address t1) = stockFirst ? (stock, usdg) : (usdg, stock);
        // price of token0 in token1 raw units, as sqrt(p) * 2^96
        uint160 sqrtP = stockFirst
            ? uint160(Math.sqrt((price << 192) / 1e18))
            : uint160(Math.sqrt((uint256(1e18) << 192) / price));
        pool = npm.createAndInitializePoolIfNecessary(t0, t1, FEE, sqrtP);
        uint256 cash = shares * price / 1e18;
        INonfungiblePositionManager.MintParams memory m;
        m.token0 = t0;
        m.token1 = t1;
        m.fee = FEE;
        m.tickLower = -MAX_TICK;
        m.tickUpper = MAX_TICK;
        (m.amount0Desired, m.amount1Desired) = stockFirst ? (shares, cash) : (cash, shares);
        m.recipient = me;
        m.deadline = block.timestamp + 1 hours;
        npm.mint(m);
    }
}
