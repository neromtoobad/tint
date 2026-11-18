// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSDG
/// @notice Testnet only. Robinhood Chain testnet has test stock tokens but no
/// USDG anyone can get, so Tint's testnet deployment uses this stand-in: 6
/// decimals like USDG, and anyone can take up to 1,000 per call from `faucet`.
/// It has no value and no owner.
contract TestUSDG is ERC20 {
    uint256 public constant FAUCET_MAX = 1_000e6;

    constructor() ERC20("Tint Test USDG", "tUSDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints up to 1,000 tUSDG to the caller.
    function faucet(uint256 amount) external {
        require(amount <= FAUCET_MAX, "at most 1,000 per call");
        _mint(msg.sender, amount);
    }

    /// @notice Seeding only: the deploy script mints what the test pools need in one call.
    /// Same rule for everyone, so it is no more than the faucet in a loop.
    function faucetTo(address to, uint256 calls) external {
        require(calls <= 100, "at most 100 calls");
        _mint(to, FAUCET_MAX * calls);
    }
}
