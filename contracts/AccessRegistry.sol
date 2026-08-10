// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessRegistry} from "./interfaces/IAccessRegistry.sol";

/// @title AccessRegistry
/// @notice Identity and permissioning for every actor in the produce chain.
/// @dev Roles are a bitmask because a co-operative is routinely both farmer and
///      processor; one address must be able to hold several hats without the gas
///      cost of a mapping per role.
contract AccessRegistry is IAccessRegistry {
    uint8 public constant ROLE_FARMER = 1;
    uint8 public constant ROLE_PROCESSOR = 2;
    uint8 public constant ROLE_DISTRIBUTOR = 4;
    uint8 public constant ROLE_RETAILER = 8;
    uint8 public constant ROLE_CERTIFIER = 16;
    uint8 public constant ROLE_INSPECTOR = 32;
    uint8 public constant ROLE_ORACLE = 64;
    uint8 public constant ROLE_ADMIN = 128;

    struct Participant {
        string name;
        string location;
        string geohash;
        bytes32 licenseHash; // digest of the off-chain trade licence / FSSAI doc
        string metadataURI;
        uint8 roles;
        bool active;
        uint64 registeredAt;
    }

    mapping(address => Participant) private _participants;
    address[] private _roster;
    mapping(address => bool) private _known;

    /// @dev Counts admins that both hold the role and are in good standing.
    ///      Counting the role alone would let two suspended admins stand in for a
    ///      live one, leaving nobody able to enrol or reinstate anyone.
    uint256 private _activeAdmins;

    event ParticipantRegistered(address indexed account, string name, uint8 roles, string location);
    event ParticipantUpdated(address indexed account, string name, string location, string metadataURI);
    event RolesGranted(address indexed account, uint8 roles, uint8 newRoleMask);
    event RolesRevoked(address indexed account, uint8 roles, uint8 newRoleMask);
    event ParticipantSuspended(address indexed account, string reason);
    event ParticipantReinstated(address indexed account);

    error NotAdmin();
    error AlreadyRegistered();
    error UnknownParticipant();
    error EmptyName();
    error LastAdmin();

    modifier onlyAdmin() {
        if (!hasRole(msg.sender, ROLE_ADMIN) || !_participants[msg.sender].active) revert NotAdmin();
        _;
    }

    /// @param rootName Human name of the genesis administrator (a regulator or consortium body).
    constructor(string memory rootName) {
        _participants[msg.sender] = Participant({
            name: rootName,
            location: "genesis",
            geohash: "",
            licenseHash: bytes32(0),
            metadataURI: "",
            roles: ROLE_ADMIN,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        _known[msg.sender] = true;
        _roster.push(msg.sender);
        _activeAdmins = 1;
        emit ParticipantRegistered(msg.sender, rootName, ROLE_ADMIN, "genesis");
    }

    function registerParticipant(
        address account,
        string calldata name,
        string calldata location,
        string calldata geohash,
        bytes32 licenseHash,
        string calldata metadataURI,
        uint8 roles
    ) external onlyAdmin {
        if (_known[account]) revert AlreadyRegistered();
        if (bytes(name).length == 0) revert EmptyName();

        _participants[account] = Participant({
            name: name,
            location: location,
            geohash: geohash,
            licenseHash: licenseHash,
            metadataURI: metadataURI,
            roles: roles,
            active: true,
            registeredAt: uint64(block.timestamp)
        });
        _known[account] = true;
        _roster.push(account);
        if (roles & ROLE_ADMIN != 0) _activeAdmins++;

        emit ParticipantRegistered(account, name, roles, location);
    }

    function updateProfile(
        string calldata name,
        string calldata location,
        string calldata geohash,
        string calldata metadataURI
    ) external {
        if (!_known[msg.sender]) revert UnknownParticipant();
        Participant storage p = _participants[msg.sender];
        p.name = name;
        p.location = location;
        p.geohash = geohash;
        p.metadataURI = metadataURI;
        emit ParticipantUpdated(msg.sender, name, location, metadataURI);
    }

    function grantRoles(address account, uint8 roles) external onlyAdmin {
        if (!_known[account]) revert UnknownParticipant();
        Participant storage p = _participants[account];
        if (roles & ROLE_ADMIN != 0 && p.roles & ROLE_ADMIN == 0 && p.active) _activeAdmins++;
        p.roles |= roles;
        emit RolesGranted(account, roles, p.roles);
    }

    function revokeRoles(address account, uint8 roles) external onlyAdmin {
        if (!_known[account]) revert UnknownParticipant();
        Participant storage p = _participants[account];
        if (roles & ROLE_ADMIN != 0 && p.roles & ROLE_ADMIN != 0 && p.active) {
            if (_activeAdmins == 1) revert LastAdmin();
            _activeAdmins--;
        }
        p.roles &= ~roles;
        emit RolesRevoked(account, roles, p.roles);
    }

    /// @notice Suspension is the enforcement lever: a suspended actor keeps its
    ///         history but can no longer originate, move or certify produce.
    function suspend(address account, string calldata reason) external onlyAdmin {
        if (!_known[account]) revert UnknownParticipant();
        Participant storage p = _participants[account];
        if (!p.active) return;
        if (p.roles & ROLE_ADMIN != 0) {
            if (_activeAdmins == 1) revert LastAdmin();
            _activeAdmins--;
        }
        p.active = false;
        emit ParticipantSuspended(account, reason);
    }

    function reinstate(address account) external onlyAdmin {
        if (!_known[account]) revert UnknownParticipant();
        Participant storage p = _participants[account];
        if (p.active) return;
        p.active = true;
        if (p.roles & ROLE_ADMIN != 0) _activeAdmins++;
        emit ParticipantReinstated(account);
    }

    function hasRole(address account, uint8 role) public view returns (bool) {
        return _participants[account].roles & role != 0;
    }

    function isActive(address account) external view returns (bool) {
        return _participants[account].active;
    }

    function isRegistered(address account) external view returns (bool) {
        return _known[account];
    }

    function getParticipant(address account) external view returns (Participant memory) {
        return _participants[account];
    }

    function rosterLength() external view returns (uint256) {
        return _roster.length;
    }

    function rosterAt(uint256 index) external view returns (address) {
        return _roster[index];
    }

    function roster() external view returns (address[] memory) {
        return _roster;
    }

    /// @notice Admins holding the role and in good standing. Never reaches zero.
    function activeAdmins() external view returns (uint256) {
        return _activeAdmins;
    }
}
