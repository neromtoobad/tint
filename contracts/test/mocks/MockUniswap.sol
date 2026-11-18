// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISwapCallback {
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

/// @notice Fixed-price stand-in for a Uniswap v3 pool, for local tests only.
/// The fork tests use the real pools on Robinhood Chain.
contract MockUniswapPool {
    address public immutable token0;
    address public immutable token1;
    // amount of token1 per 1e18 of token0
    uint256 public price1Per0;
    bool public askLess; // simulates a pool that asks for less than offered

    constructor(address a, address b, uint256 price1Per0_) {
        (token0, token1) = a < b ? (a, b) : (b, a);
        price1Per0 = a < b ? price1Per0_ : 1e36 / price1Per0_;
    }

    function setAskLess(bool v) external {
        askLess = v;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        require(amountSpecified > 0, "exact input only");
        uint256 amountIn = uint256(amountSpecified);
        if (askLess) amountIn -= 1;
        (address tokenIn, address tokenOut) = zeroForOne ? (token0, token1) : (token1, token0);
        uint256 out = zeroForOne ? amountIn * price1Per0 / 1e18 : amountIn * 1e18 / price1Per0;
        IERC20(tokenOut).transfer(recipient, out);
        (amount0, amount1) = zeroForOne ? (int256(amountIn), -int256(out)) : (-int256(out), int256(amountIn));
        uint256 before = IERC20(tokenIn).balanceOf(address(this));
        ISwapCallback(msg.sender).uniswapV3SwapCallback(amount0, amount1, data);
        require(IERC20(tokenIn).balanceOf(address(this)) >= before + amountIn, "not paid");
    }
}

contract MockUniswapFactory {
    mapping(address => mapping(address => mapping(uint24 => address))) public getPool;

    function add(address pool, address a, address b, uint24 fee) external {
        getPool[a][b][fee] = pool;
        getPool[b][a][fee] = pool;
    }
}
