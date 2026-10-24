// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { AgentPact } from "../AgentPact.sol";

/**
 * @title DeployAgentPact
 * @notice Deploys AgentPact with the Arc USDC address.
 *
 * Usage (Arc Testnet):
 *   forge script contracts/script/DeployAgentPact.s.sol \
 *     --rpc-url https://rpc.testnet.arc.io \
 *     --private-key $DEPLOYER_PRIVATE_KEY \
 *     --broadcast
 *
 * Usage (Arc Mainnet — run yourself, outside Arc Studio):
 *   forge script contracts/script/DeployAgentPact.s.sol \
 *     --rpc-url https://rpc.mainnet.arc.io \
 *     --account <keystore-account-name> \
 *     --broadcast
 *
 * The deployer key is read from --private-key or --account on the command
 * line. It is NEVER read from a file in this repository.
 *
 * USDC address is the same on both Arc Testnet and Arc Mainnet:
 *   0x3600000000000000000000000000000000000000
 */
contract DeployAgentPact is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        vm.startBroadcast();

        AgentPact pact = new AgentPact(USDC);

        console.log("AgentPact deployed at:", address(pact));
        console.log("USDC token:           ", USDC);
        console.log("Deployer:             ", msg.sender);

        vm.stopBroadcast();
    }
}
