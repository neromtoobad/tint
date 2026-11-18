// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {TintPool} from "../src/TintPool.sol";
import {TintTree} from "../src/TintTree.sol";
import {ITintTree} from "../src/interfaces/ITintTree.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3.sol";
import {TransactVerifier, IVerifier} from "../src/verifiers/TransactVerifier.sol";
import {SwapVerifier} from "../src/verifiers/SwapVerifier.sol";

/// @notice Deploys the verifiers, pool and tree, and lists assets.
///
/// Env:
///   UNISWAP_FACTORY   Uniswap v3 factory on this chain
///   ASSETS            comma-separated token addresses to list
///   MAX_DEPOSITS      comma-separated per-deposit caps (token units), same order
///   MAX_POOL          comma-separated pool-wide caps, same order
///   OWNER             final owner (defaults to the deployer)
///
/// Writes deployments/<chainid>.json. (block.number is the L1 block on Arbitrum
/// chains, so the deploy scripts add startBlock from the RPC afterwards.)
contract Deploy is Script {
    function run() external {
        address factory = vm.envAddress("UNISWAP_FACTORY");
        address[] memory assets = vm.envAddress("ASSETS", ",");
        uint256[] memory maxDeposit = vm.envUint("MAX_DEPOSITS", ",");
        uint256[] memory maxPool = vm.envUint("MAX_POOL", ",");
        require(assets.length == maxDeposit.length && assets.length == maxPool.length, "lengths");

        vm.startBroadcast();
        address deployer = msg.sender;
        address owner = vm.envOr("OWNER", deployer);

        IVerifier tv = IVerifier(address(new TransactVerifier()));
        IVerifier sv = IVerifier(address(new SwapVerifier()));
        TintPool pool = new TintPool(tv, sv, IUniswapV3Factory(factory), deployer);
        TintTree tree = new TintTree(address(pool));
        pool.setTree(ITintTree(address(tree)));
        for (uint256 i = 0; i < assets.length; i++) {
            pool.configureAsset(assets[i], true, uint128(maxDeposit[i]), uint128(maxPool[i]));
        }
        if (owner != deployer) pool.transferOwnership(owner); // Ownable2Step: owner must accept
        vm.stopBroadcast();

        string memory o = "deploy";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeAddress(o, "transactVerifier", address(tv));
        vm.serializeAddress(o, "swapVerifier", address(sv));
        vm.serializeAddress(o, "tree", address(tree));
        vm.serializeAddress(o, "uniswapFactory", factory);
        string memory json = vm.serializeAddress(o, "pool", address(pool));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console.log("pool", address(pool));
        console.log("tree", address(tree));
    }
}
