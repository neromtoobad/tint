// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {stdStorage, StdStorage} from "forge-std/StdStorage.sol";

/// @notice Local dev only: prints the storage slot holding TOKEN.balanceOf(HOLDER),
/// so tools/dev-fork.sh can give a test account tokens on an anvil fork
/// (anvil_setStorageAt) without taking them from a real pool.
contract BalanceSlot is Script {
    using stdStorage for StdStorage;

    function run() external {
        address token = vm.envAddress("TOKEN");
        address holder = vm.envAddress("HOLDER");
        uint256 slot = stdstore.target(token).sig("balanceOf(address)").with_key(holder).find();
        console.log(vm.toString(bytes32(slot)));
    }
}
