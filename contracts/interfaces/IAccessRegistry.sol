// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAccessRegistry
/// @notice Read surface of the participant registry, consumed by ProduceRegistry.
interface IAccessRegistry {
    function hasRole(address account, uint8 role) external view returns (bool);

    function isActive(address account) external view returns (bool);

    function isRegistered(address account) external view returns (bool);
}
