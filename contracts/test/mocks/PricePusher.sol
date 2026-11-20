// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3.sol";

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IPoolTokens {
    function token0() external view returns (address);
}

/// @notice Local fork tests only: a public trader that moves a real Uniswap v3
/// price, so take-profit and stop-loss plans have a real price move to react to.
/// It sells what it holds of `tokenIn` (tokens given by anvil_setStorageAt) until
/// the pool reaches `sqrtPriceLimitX96`, or `maxIn` runs out.
contract PricePusher {
    function pushTo(address pool, address tokenIn, uint256 maxIn, uint160 sqrtPriceLimitX96) external {
        bool zeroForOne = tokenIn == IPoolTokens(pool).token0();
        IUniswapV3Pool(pool).swap(msg.sender, zeroForOne, int256(maxIn), sqrtPriceLimitX96, abi.encode(tokenIn));
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        address token = abi.decode(data, (address));
        IERC20Min(token).transfer(msg.sender, uint256(amount0Delta > 0 ? amount0Delta : amount1Delta));
    }
}
