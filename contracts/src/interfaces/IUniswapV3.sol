// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @notice The parts of Uniswap v3 the pool uses (factory 0x1f7d…2EfA on Robinhood Chain).
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
}
