// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessRegistry} from "./interfaces/IAccessRegistry.sol";

/// @title ProduceRegistry
/// @notice The provenance ledger for agricultural produce: origination, custody,
///         transformation, cold-chain telemetry, certification, inspection and recall.
/// @dev Design notes that matter if any of this is ever refactored:
///      - Custody moves in two steps (propose then accept). A single-step push would
///        let a distributor dump a spoiled lot on a retailer who never consented.
///      - Lineage is stored both ways (parents and children) because a recall walks
///        downward and an audit walks upward; neither direction is affordable to derive.
///      - Recall propagation is caller-supplied and contract-verified. An on-chain
///        descendant crawl is unbounded gas; instead the indexer proposes the set and
///        the contract proves each member really descends from the recalled root.
contract ProduceRegistry {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Stage {
        Harvested, // 0 - created at the farm gate
        Processed, // 1 - cleaned, milled, graded
        Packed, // 2 - packaged into sale units
        InTransit, // 3 - moving between nodes
        AtRetail, // 4 - on shelf
        Sold, // 5 - terminal, consumer owns it
        Destroyed // 6 - terminal, withdrawn and disposed of
    }

    struct Batch {
        uint256 id;
        address originFarm;
        address custodian;
        address pendingCustodian;
        string produceType;
        string variety;
        uint128 quantity; // in whole `unit`s, e.g. kilogrammes
        string unit;
        uint64 harvestedAt;
        uint64 createdAt;
        string originGeohash;
        string originLocation;
        bytes32 metadataHash; // digest of the off-chain agronomy record
        string metadataURI;
        Stage stage;
        bool coldChainRequired;
        bool coldChainBreached;
        bool recalled;
        int16 minTempDeciC; // 0.1 degC resolution; -400 == -40.0 degC
        int16 maxTempDeciC;
        uint32 telemetryCount;
        uint32 handoverCount;
        uint32 certCount;
        uint32 inspectionCount;
    }

    struct BatchInput {
        string produceType;
        string variety;
        uint128 quantity;
        string unit;
        uint64 harvestedAt;
        string originGeohash;
        string originLocation;
        bytes32 metadataHash;
        string metadataURI;
        bool coldChainRequired;
        int16 minTempDeciC;
        int16 maxTempDeciC;
    }

    struct Handover {
        address from;
        address to;
        uint64 proposedAt;
        uint64 settledAt;
        string geohash;
        string note;
        bytes32 documentHash; // digest of the bill of lading / e-way bill
        bool accepted;
        bool cancelled;
    }

    struct Certification {
        address certifier;
        bytes32 schemeId;
        string scheme;
        uint64 issuedAt;
        uint64 expiresAt; // 0 == never expires
        string evidenceURI;
        bytes32 evidenceHash;
        bool revoked;
        string revocationReason;
    }

    struct Telemetry {
        address reporter;
        uint64 observedAt;
        int16 tempDeciC;
        uint16 humidityDeciPct; // 0.1% resolution
        string geohash;
        bytes32 payloadHash;
        bool excursion;
    }

    struct Inspection {
        address inspector;
        // Named `inspectedAt`, not `at`: ethers decodes structs onto an Array
        // subclass, where a member called `at` is shadowed by Array.prototype.at.
        uint64 inspectedAt;
        uint8 grade; // 0..100
        bool passed;
        string findings;
        bytes32 reportHash;
    }

    struct Recall {
        address initiator;
        uint64 recalledAt; // see the note on Inspection.inspectedAt
        uint8 severity; // 1 advisory, 2 withdrawal, 3 public health
        string reason;
        uint256 rootBatch; // the batch the recall originated from
    }

    /// @notice Flattened consumer-facing answer to "is this food safe and real".
    struct Verification {
        bool exists;
        bool recalled;
        bool coldChainBreached;
        bool custodyIntact;
        Stage stage;
        address originFarm;
        address custodian;
        uint256 activeCertifications;
        uint256 failedInspections;
        uint256 lastInspectionGrade;
        uint256 chainLength;
    }

    // ---------------------------------------------------------------------
    // Roles mirrored from AccessRegistry
    // ---------------------------------------------------------------------

    uint8 private constant ROLE_FARMER = 1;
    uint8 private constant ROLE_PROCESSOR = 2;
    uint8 private constant ROLE_DISTRIBUTOR = 4;
    uint8 private constant ROLE_RETAILER = 8;
    uint8 private constant ROLE_CERTIFIER = 16;
    uint8 private constant ROLE_INSPECTOR = 32;
    uint8 private constant ROLE_ORACLE = 64;
    uint8 private constant ROLE_ADMIN = 128;

    /// @dev Recall ancestry proofs walk no deeper than this. Real produce chains
    ///      rarely exceed four transformations; the cap bounds worst-case gas.
    uint8 public constant MAX_LINEAGE_DEPTH = 12;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    IAccessRegistry public immutable access;

    uint256 public batchCount;
    bool public paused;

    mapping(uint256 => Batch) private _batches;
    mapping(uint256 => Handover[]) private _handovers;
    mapping(uint256 => Certification[]) private _batchCerts;
    mapping(address => Certification[]) private _farmCerts;
    mapping(uint256 => Telemetry[]) private _telemetry;
    mapping(uint256 => Inspection[]) private _inspections;
    mapping(uint256 => Recall) private _recalls;
    mapping(uint256 => uint256[]) private _parents;
    mapping(uint256 => uint256[]) private _children;
    mapping(address => uint256[]) private _batchesByCustodian;
    mapping(address => uint256[]) private _batchesByOrigin;
    mapping(uint256 => uint256) private _pendingHandover; // index + 1, zero means none
    mapping(uint256 => uint128) private _soldQuantity;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event BatchCreated(
        uint256 indexed batchId,
        address indexed farm,
        string produceType,
        string variety,
        uint128 quantity,
        string unit,
        uint64 harvestedAt,
        string originGeohash
    );
    event TransferProposed(uint256 indexed batchId, address indexed from, address indexed to, uint256 handoverIndex);
    event TransferAccepted(uint256 indexed batchId, address indexed from, address indexed to, string geohash);
    event TransferCancelled(uint256 indexed batchId, address indexed by, uint256 handoverIndex);
    event StageAdvanced(uint256 indexed batchId, Stage indexed from, Stage indexed to, address by);
    event TelemetryRecorded(
        uint256 indexed batchId, address indexed reporter, int16 tempDeciC, uint16 humidityDeciPct, bool excursion
    );
    event ColdChainBreached(uint256 indexed batchId, int16 tempDeciC, int16 minTempDeciC, int16 maxTempDeciC);
    event BatchCertified(
        uint256 indexed batchId, address indexed certifier, bytes32 indexed schemeId, string scheme, uint64 expiresAt
    );
    event FarmCertified(address indexed farm, address indexed certifier, bytes32 indexed schemeId, uint64 expiresAt);
    event CertificationRevoked(uint256 indexed batchId, uint256 index, address indexed by, string reason);
    event InspectionRecorded(uint256 indexed batchId, address indexed inspector, uint8 grade, bool passed);
    event BatchSplit(uint256 indexed parentId, uint256[] childIds, uint128[] amounts);
    event BatchesMerged(uint256[] parentIds, uint256 indexed childId, uint128 quantity);
    event SaleRecorded(uint256 indexed batchId, address indexed retailer, uint128 quantity, bytes32 receiptHash);
    event RecallInitiated(uint256 indexed batchId, address indexed initiator, uint8 severity, string reason);
    event RecallPropagated(uint256 indexed rootBatch, uint256 indexed batchId);
    event BatchDestroyed(uint256 indexed batchId, address indexed by, string reason);
    event PausedSet(bool paused, address by);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error Paused();
    error NoBatch();
    error NotCustodian();
    error NotAuthorised();
    error InactiveParticipant();
    error RecipientUnfit();
    error TransferPending();
    error NoPendingTransfer();
    error StageNotMonotonic();
    error BatchTerminal();
    error BatchRecalled();
    error ZeroQuantity();
    error QuantityMismatch();
    error BadInput();
    error NotDescendant(uint256 batchId);
    error AlreadyRecalled();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier whenLive() {
        if (paused) revert Paused();
        _;
    }

    modifier onlyRole(uint8 role) {
        if (!access.hasRole(msg.sender, role)) revert NotAuthorised();
        if (!access.isActive(msg.sender)) revert InactiveParticipant();
        _;
    }

    modifier exists(uint256 batchId) {
        if (batchId == 0 || batchId > batchCount) revert NoBatch();
        _;
    }

    modifier onlyCustodian(uint256 batchId) {
        if (_batches[batchId].custodian != msg.sender) revert NotCustodian();
        if (!access.isActive(msg.sender)) revert InactiveParticipant();
        _;
    }

    constructor(address accessRegistry) {
        access = IAccessRegistry(accessRegistry);
    }

    // ---------------------------------------------------------------------
    // Origination
    // ---------------------------------------------------------------------

    /// @notice Mint a new batch at the farm gate. Only an active farmer may originate.
    function createBatch(BatchInput calldata input) external whenLive onlyRole(ROLE_FARMER) returns (uint256 batchId) {
        if (input.quantity == 0) revert ZeroQuantity();
        if (bytes(input.produceType).length == 0 || bytes(input.unit).length == 0) revert BadInput();
        if (input.coldChainRequired && input.maxTempDeciC < input.minTempDeciC) revert BadInput();

        batchId = ++batchCount;
        Batch storage b = _batches[batchId];
        b.id = batchId;
        b.originFarm = msg.sender;
        b.custodian = msg.sender;
        b.produceType = input.produceType;
        b.variety = input.variety;
        b.quantity = input.quantity;
        b.unit = input.unit;
        b.harvestedAt = input.harvestedAt == 0 ? uint64(block.timestamp) : input.harvestedAt;
        b.createdAt = uint64(block.timestamp);
        b.originGeohash = input.originGeohash;
        b.originLocation = input.originLocation;
        b.metadataHash = input.metadataHash;
        b.metadataURI = input.metadataURI;
        b.stage = Stage.Harvested;
        b.coldChainRequired = input.coldChainRequired;
        b.minTempDeciC = input.minTempDeciC;
        b.maxTempDeciC = input.maxTempDeciC;

        _batchesByCustodian[msg.sender].push(batchId);
        _batchesByOrigin[msg.sender].push(batchId);

        emit BatchCreated(
            batchId,
            msg.sender,
            input.produceType,
            input.variety,
            input.quantity,
            input.unit,
            b.harvestedAt,
            input.originGeohash
        );
    }

    // ---------------------------------------------------------------------
    // Custody
    // ---------------------------------------------------------------------

    function proposeTransfer(uint256 batchId, address to, string calldata geohash, string calldata note, bytes32 documentHash)
        external
        whenLive
        exists(batchId)
        onlyCustodian(batchId)
    {
        Batch storage b = _batches[batchId];
        if (b.recalled) revert BatchRecalled();
        if (b.stage == Stage.Sold || b.stage == Stage.Destroyed) revert BatchTerminal();
        if (_pendingHandover[batchId] != 0) revert TransferPending();
        if (to == address(0) || to == msg.sender) revert BadInput();
        // The receiving node must be a live participant able to hold custody.
        if (!access.isRegistered(to) || !access.isActive(to)) revert RecipientUnfit();
        if (!_canHoldCustody(to)) revert RecipientUnfit();

        _handovers[batchId].push(
            Handover({
                from: msg.sender,
                to: to,
                proposedAt: uint64(block.timestamp),
                settledAt: 0,
                geohash: geohash,
                note: note,
                documentHash: documentHash,
                accepted: false,
                cancelled: false
            })
        );
        uint256 idx = _handovers[batchId].length - 1;
        _pendingHandover[batchId] = idx + 1;
        b.pendingCustodian = to;

        emit TransferProposed(batchId, msg.sender, to, idx);
    }

    /// @notice Recipient countersigns. Custody, and with it liability, moves here.
    function acceptTransfer(uint256 batchId, string calldata geohash) external whenLive exists(batchId) {
        uint256 slot = _pendingHandover[batchId];
        if (slot == 0) revert NoPendingTransfer();
        Handover storage h = _handovers[batchId][slot - 1];
        if (h.to != msg.sender) revert NotAuthorised();
        if (!access.isActive(msg.sender)) revert InactiveParticipant();

        Batch storage b = _batches[batchId];
        address from = b.custodian;

        h.accepted = true;
        h.settledAt = uint64(block.timestamp);
        if (bytes(geohash).length != 0) h.geohash = geohash;

        b.custodian = msg.sender;
        b.pendingCustodian = address(0);
        b.handoverCount += 1;
        _pendingHandover[batchId] = 0;
        _batchesByCustodian[msg.sender].push(batchId);

        emit TransferAccepted(batchId, from, msg.sender, h.geohash);
    }

    /// @notice Either side may walk away from an unaccepted handover.
    function cancelTransfer(uint256 batchId) external whenLive exists(batchId) {
        uint256 slot = _pendingHandover[batchId];
        if (slot == 0) revert NoPendingTransfer();
        Handover storage h = _handovers[batchId][slot - 1];
        if (msg.sender != h.from && msg.sender != h.to) revert NotAuthorised();

        h.cancelled = true;
        h.settledAt = uint64(block.timestamp);
        _pendingHandover[batchId] = 0;
        _batches[batchId].pendingCustodian = address(0);

        emit TransferCancelled(batchId, msg.sender, slot - 1);
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    function advanceStage(uint256 batchId, Stage next) external whenLive exists(batchId) onlyCustodian(batchId) {
        Batch storage b = _batches[batchId];
        if (b.recalled) revert BatchRecalled();
        if (b.stage == Stage.Sold || b.stage == Stage.Destroyed) revert BatchTerminal();
        if (uint8(next) <= uint8(b.stage)) revert StageNotMonotonic();
        // Sale and destruction have their own entry points; they carry extra evidence.
        if (next == Stage.Sold || next == Stage.Destroyed) revert BadInput();
        if (!access.hasRole(msg.sender, _roleForStage(next))) revert NotAuthorised();

        Stage prev = b.stage;
        b.stage = next;
        emit StageAdvanced(batchId, prev, next, msg.sender);
    }

    function recordSale(uint256 batchId, uint128 quantity, bytes32 receiptHash)
        external
        whenLive
        exists(batchId)
        onlyCustodian(batchId)
        onlyRole(ROLE_RETAILER)
    {
        Batch storage b = _batches[batchId];
        if (b.recalled) revert BatchRecalled();
        if (b.stage == Stage.Sold || b.stage == Stage.Destroyed) revert BatchTerminal();
        if (quantity == 0) revert ZeroQuantity();
        if (_soldQuantity[batchId] + quantity > b.quantity) revert QuantityMismatch();

        _soldQuantity[batchId] += quantity;
        if (_soldQuantity[batchId] == b.quantity) {
            Stage prev = b.stage;
            b.stage = Stage.Sold;
            emit StageAdvanced(batchId, prev, Stage.Sold, msg.sender);
        }
        emit SaleRecorded(batchId, msg.sender, quantity, receiptHash);
    }

    // ---------------------------------------------------------------------
    // Transformation
    // ---------------------------------------------------------------------

    /// @notice Split a lot into child lots. Quantities must account for the parent
    ///         exactly; unexplained shrinkage is precisely the fraud this prevents.
    function splitBatch(uint256 batchId, uint128[] calldata amounts)
        external
        whenLive
        exists(batchId)
        onlyCustodian(batchId)
        returns (uint256[] memory childIds)
    {
        Batch storage parent = _batches[batchId];
        if (parent.recalled) revert BatchRecalled();
        if (parent.stage == Stage.Sold || parent.stage == Stage.Destroyed) revert BatchTerminal();
        if (amounts.length < 2) revert BadInput();

        uint128 total;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert ZeroQuantity();
            total += amounts[i];
        }
        if (total != parent.quantity) revert QuantityMismatch();

        childIds = new uint256[](amounts.length);
        for (uint256 i = 0; i < amounts.length; i++) {
            uint256 childId = ++batchCount;
            _cloneInto(childId, parent, amounts[i]);
            _parents[childId].push(batchId);
            _children[batchId].push(childId);
            childIds[i] = childId;
        }

        // The parent is consumed by the split; its quantity now lives in the children.
        parent.quantity = 0;
        emit BatchSplit(batchId, childIds, amounts);
    }

    /// @notice Merge like-for-like lots held by one custodian into a single lot.
    function mergeBatches(uint256[] calldata batchIds, string calldata metadataURI, bytes32 metadataHash)
        external
        whenLive
        returns (uint256 childId)
    {
        if (batchIds.length < 2) revert BadInput();
        Batch storage first = _batches[batchIds[0]];
        if (batchIds[0] == 0 || batchIds[0] > batchCount) revert NoBatch();
        if (first.custodian != msg.sender) revert NotCustodian();
        if (!access.isActive(msg.sender)) revert InactiveParticipant();

        uint128 total;
        bool breached;
        bytes32 typeKey = keccak256(bytes(first.produceType));
        bytes32 unitKey = keccak256(bytes(first.unit));

        childId = ++batchCount;

        // Consumed in the same pass that counts it. A batch id repeated in the
        // input reads as zero on its second visit and is rejected, so a merge can
        // never mint quantity that was not physically there.
        for (uint256 i = 0; i < batchIds.length; i++) {
            uint256 id = batchIds[i];
            if (id == 0 || id >= childId) revert NoBatch();
            Batch storage b = _batches[id];
            if (b.custodian != msg.sender) revert NotCustodian();
            if (b.recalled) revert BatchRecalled();
            if (b.stage == Stage.Sold || b.stage == Stage.Destroyed) revert BatchTerminal();
            if (b.quantity == 0) revert ZeroQuantity();
            // Mixing produce types or units would make the child's provenance a lie.
            if (keccak256(bytes(b.produceType)) != typeKey || keccak256(bytes(b.unit)) != unitKey) revert BadInput();

            total += b.quantity;
            b.quantity = 0;
            // A merged child inherits the worst cold-chain history of its inputs.
            if (b.coldChainBreached) breached = true;
            _parents[childId].push(id);
            _children[id].push(childId);
        }

        _cloneInto(childId, first, total);
        Batch storage child = _batches[childId];
        child.metadataURI = metadataURI;
        child.metadataHash = metadataHash;
        child.coldChainBreached = breached;

        emit BatchesMerged(batchIds, childId, total);
    }

    // ---------------------------------------------------------------------
    // Telemetry
    // ---------------------------------------------------------------------

    /// @notice Push a sensor observation. The contract, not the reporter, decides
    ///         whether it counts as a cold-chain excursion.
    function recordTelemetry(
        uint256 batchId,
        int16 tempDeciC,
        uint16 humidityDeciPct,
        string calldata geohash,
        bytes32 payloadHash,
        uint64 observedAt
    ) external whenLive exists(batchId) {
        Batch storage b = _batches[batchId];
        bool authorised = b.custodian == msg.sender || access.hasRole(msg.sender, ROLE_ORACLE);
        if (!authorised) revert NotAuthorised();
        if (!access.isActive(msg.sender)) revert InactiveParticipant();

        bool excursion = b.coldChainRequired && (tempDeciC < b.minTempDeciC || tempDeciC > b.maxTempDeciC);

        _telemetry[batchId].push(
            Telemetry({
                reporter: msg.sender,
                observedAt: observedAt == 0 ? uint64(block.timestamp) : observedAt,
                tempDeciC: tempDeciC,
                humidityDeciPct: humidityDeciPct,
                geohash: geohash,
                payloadHash: payloadHash,
                excursion: excursion
            })
        );
        b.telemetryCount += 1;

        emit TelemetryRecorded(batchId, msg.sender, tempDeciC, humidityDeciPct, excursion);

        if (excursion && !b.coldChainBreached) {
            b.coldChainBreached = true;
            emit ColdChainBreached(batchId, tempDeciC, b.minTempDeciC, b.maxTempDeciC);
        }
    }

    // ---------------------------------------------------------------------
    // Certification and inspection
    // ---------------------------------------------------------------------

    function certifyBatch(
        uint256 batchId,
        string calldata scheme,
        uint64 expiresAt,
        string calldata evidenceURI,
        bytes32 evidenceHash
    ) external whenLive exists(batchId) onlyRole(ROLE_CERTIFIER) {
        if (bytes(scheme).length == 0) revert BadInput();
        bytes32 schemeId = keccak256(bytes(scheme));
        _batchCerts[batchId].push(
            Certification({
                certifier: msg.sender,
                schemeId: schemeId,
                scheme: scheme,
                issuedAt: uint64(block.timestamp),
                expiresAt: expiresAt,
                evidenceURI: evidenceURI,
                evidenceHash: evidenceHash,
                revoked: false,
                revocationReason: ""
            })
        );
        _batches[batchId].certCount += 1;
        emit BatchCertified(batchId, msg.sender, schemeId, scheme, expiresAt);
    }

    function certifyFarm(
        address farm,
        string calldata scheme,
        uint64 expiresAt,
        string calldata evidenceURI,
        bytes32 evidenceHash
    ) external whenLive onlyRole(ROLE_CERTIFIER) {
        if (!access.isRegistered(farm)) revert BadInput();
        bytes32 schemeId = keccak256(bytes(scheme));
        _farmCerts[farm].push(
            Certification({
                certifier: msg.sender,
                schemeId: schemeId,
                scheme: scheme,
                issuedAt: uint64(block.timestamp),
                expiresAt: expiresAt,
                evidenceURI: evidenceURI,
                evidenceHash: evidenceHash,
                revoked: false,
                revocationReason: ""
            })
        );
        emit FarmCertified(farm, msg.sender, schemeId, expiresAt);
    }

    function revokeBatchCertification(uint256 batchId, uint256 index, string calldata reason)
        external
        whenLive
        exists(batchId)
    {
        if (index >= _batchCerts[batchId].length) revert BadInput();
        Certification storage c = _batchCerts[batchId][index];
        if (c.certifier != msg.sender && !access.hasRole(msg.sender, ROLE_ADMIN)) revert NotAuthorised();
        c.revoked = true;
        c.revocationReason = reason;
        emit CertificationRevoked(batchId, index, msg.sender, reason);
    }

    function recordInspection(
        uint256 batchId,
        uint8 grade,
        bool passed,
        string calldata findings,
        bytes32 reportHash
    ) external whenLive exists(batchId) onlyRole(ROLE_INSPECTOR) {
        if (grade > 100) revert BadInput();
        _inspections[batchId].push(
            Inspection({
                inspector: msg.sender,
                inspectedAt: uint64(block.timestamp),
                grade: grade,
                passed: passed,
                findings: findings,
                reportHash: reportHash
            })
        );
        _batches[batchId].inspectionCount += 1;
        emit InspectionRecorded(batchId, msg.sender, grade, passed);
    }

    // ---------------------------------------------------------------------
    // Recall
    // ---------------------------------------------------------------------

    /// @notice Pull a lot from the chain. Inspectors, admins and the originating
    ///         farm may all trigger one; speed matters more than exclusivity here.
    function initiateRecall(uint256 batchId, uint8 severity, string calldata reason)
        external
        whenLive
        exists(batchId)
    {
        Batch storage b = _batches[batchId];
        bool authorised = access.hasRole(msg.sender, ROLE_INSPECTOR) || access.hasRole(msg.sender, ROLE_ADMIN)
            || msg.sender == b.originFarm;
        if (!authorised) revert NotAuthorised();
        if (!access.isActive(msg.sender)) revert InactiveParticipant();
        if (b.recalled) revert AlreadyRecalled();
        if (severity == 0 || severity > 3) revert BadInput();

        b.recalled = true;
        _recalls[batchId] =
            Recall({initiator: msg.sender, recalledAt: uint64(block.timestamp), severity: severity, reason: reason, rootBatch: batchId});

        emit RecallInitiated(batchId, msg.sender, severity, reason);
    }

    /// @notice Extend a recall to lots derived from the recalled root. Each supplied
    ///         id is proved to descend from `rootBatch` before it is marked.
    function propagateRecall(uint256 rootBatch, uint256[] calldata descendants) external whenLive exists(rootBatch) {
        Recall storage root = _recalls[rootBatch];
        if (!_batches[rootBatch].recalled) revert BadInput();
        bool authorised = access.hasRole(msg.sender, ROLE_INSPECTOR) || access.hasRole(msg.sender, ROLE_ADMIN)
            || msg.sender == root.initiator;
        if (!authorised) revert NotAuthorised();

        for (uint256 i = 0; i < descendants.length; i++) {
            uint256 id = descendants[i];
            if (id == 0 || id > batchCount) revert NoBatch();
            if (_batches[id].recalled) continue;
            if (!_isDescendantOf(id, rootBatch, MAX_LINEAGE_DEPTH)) revert NotDescendant(id);

            _batches[id].recalled = true;
            _recalls[id] = Recall({
                initiator: msg.sender,
                recalledAt: uint64(block.timestamp),
                severity: root.severity,
                reason: root.reason,
                rootBatch: rootBatch
            });
            emit RecallPropagated(rootBatch, id);
        }
    }

    function destroyBatch(uint256 batchId, string calldata reason) external whenLive exists(batchId) {
        Batch storage b = _batches[batchId];
        bool authorised =
            b.custodian == msg.sender || access.hasRole(msg.sender, ROLE_INSPECTOR) || access.hasRole(msg.sender, ROLE_ADMIN);
        if (!authorised) revert NotAuthorised();
        if (b.stage == Stage.Destroyed) revert BatchTerminal();

        b.stage = Stage.Destroyed;
        _pendingHandover[batchId] = 0;
        b.pendingCustodian = address(0);
        emit BatchDestroyed(batchId, msg.sender, reason);
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    function setPaused(bool value) external onlyRole(ROLE_ADMIN) {
        paused = value;
        emit PausedSet(value, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getBatch(uint256 batchId) external view exists(batchId) returns (Batch memory) {
        return _batches[batchId];
    }

    function getHandovers(uint256 batchId) external view returns (Handover[] memory) {
        return _handovers[batchId];
    }

    function getBatchCertifications(uint256 batchId) external view returns (Certification[] memory) {
        return _batchCerts[batchId];
    }

    function getFarmCertifications(address farm) external view returns (Certification[] memory) {
        return _farmCerts[farm];
    }

    function getTelemetry(uint256 batchId) external view returns (Telemetry[] memory) {
        return _telemetry[batchId];
    }

    function getInspections(uint256 batchId) external view returns (Inspection[] memory) {
        return _inspections[batchId];
    }

    function getRecall(uint256 batchId) external view returns (Recall memory) {
        return _recalls[batchId];
    }

    function getParents(uint256 batchId) external view returns (uint256[] memory) {
        return _parents[batchId];
    }

    function getChildren(uint256 batchId) external view returns (uint256[] memory) {
        return _children[batchId];
    }

    function batchesOfCustodian(address account) external view returns (uint256[] memory) {
        return _batchesByCustodian[account];
    }

    function batchesOfOrigin(address account) external view returns (uint256[] memory) {
        return _batchesByOrigin[account];
    }

    function soldQuantity(uint256 batchId) external view returns (uint128) {
        return _soldQuantity[batchId];
    }

    function pendingTransfer(uint256 batchId) external view returns (bool pending, address to) {
        uint256 slot = _pendingHandover[batchId];
        if (slot == 0) return (false, address(0));
        return (true, _handovers[batchId][slot - 1].to);
    }

    /// @notice One call answering everything a shopper scanning a QR code cares about.
    function verify(uint256 batchId) external view returns (Verification memory v) {
        if (batchId == 0 || batchId > batchCount) return v;
        Batch storage b = _batches[batchId];

        v.exists = true;
        v.recalled = b.recalled;
        v.coldChainBreached = b.coldChainBreached;
        v.stage = b.stage;
        v.originFarm = b.originFarm;
        v.custodian = b.custodian;
        v.chainLength = _handovers[batchId].length;

        Certification[] storage certs = _batchCerts[batchId];
        for (uint256 i = 0; i < certs.length; i++) {
            if (!certs[i].revoked && (certs[i].expiresAt == 0 || certs[i].expiresAt > block.timestamp)) {
                v.activeCertifications++;
            }
        }
        Certification[] storage farmCerts = _farmCerts[b.originFarm];
        for (uint256 i = 0; i < farmCerts.length; i++) {
            if (!farmCerts[i].revoked && (farmCerts[i].expiresAt == 0 || farmCerts[i].expiresAt > block.timestamp)) {
                v.activeCertifications++;
            }
        }

        Inspection[] storage checks = _inspections[batchId];
        for (uint256 i = 0; i < checks.length; i++) {
            if (!checks[i].passed) v.failedInspections++;
        }
        if (checks.length > 0) v.lastInspectionGrade = checks[checks.length - 1].grade;

        // Custody is intact when every recorded handover was accepted, and the
        // current holder is still a participant in good standing.
        bool intact = access.isActive(b.custodian);
        Handover[] storage hs = _handovers[batchId];
        for (uint256 i = 0; i < hs.length; i++) {
            if (!hs[i].accepted && !hs[i].cancelled) intact = false;
        }
        v.custodyIntact = intact;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _cloneInto(uint256 newId, Batch storage src, uint128 quantity) private {
        Batch storage c = _batches[newId];
        c.id = newId;
        c.originFarm = src.originFarm;
        c.custodian = src.custodian;
        c.produceType = src.produceType;
        c.variety = src.variety;
        c.quantity = quantity;
        c.unit = src.unit;
        c.harvestedAt = src.harvestedAt;
        c.createdAt = uint64(block.timestamp);
        c.originGeohash = src.originGeohash;
        c.originLocation = src.originLocation;
        c.metadataHash = src.metadataHash;
        c.metadataURI = src.metadataURI;
        c.stage = src.stage;
        c.coldChainRequired = src.coldChainRequired;
        c.coldChainBreached = src.coldChainBreached;
        c.minTempDeciC = src.minTempDeciC;
        c.maxTempDeciC = src.maxTempDeciC;

        _batchesByCustodian[src.custodian].push(newId);
        _batchesByOrigin[src.originFarm].push(newId);
    }

    function _isDescendantOf(uint256 candidate, uint256 root, uint8 depth) private view returns (bool) {
        if (candidate == root) return true;
        if (depth == 0) return false;
        uint256[] storage ps = _parents[candidate];
        for (uint256 i = 0; i < ps.length; i++) {
            if (_isDescendantOf(ps[i], root, depth - 1)) return true;
        }
        return false;
    }

    function _canHoldCustody(address account) private view returns (bool) {
        return access.hasRole(account, ROLE_FARMER) || access.hasRole(account, ROLE_PROCESSOR)
            || access.hasRole(account, ROLE_DISTRIBUTOR) || access.hasRole(account, ROLE_RETAILER);
    }

    function _roleForStage(Stage s) private pure returns (uint8) {
        if (s == Stage.Processed || s == Stage.Packed) return ROLE_PROCESSOR;
        if (s == Stage.InTransit) return ROLE_DISTRIBUTOR;
        if (s == Stage.AtRetail) return ROLE_RETAILER;
        return ROLE_FARMER;
    }
}
