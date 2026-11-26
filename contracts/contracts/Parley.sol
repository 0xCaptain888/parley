// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Subset of the Agent ID registry (SPACE ID Agent ID, HandleRegistry) used by Parley.
interface IHandleRegistry {
    function balanceOf(address owner) external view returns (uint256);
    function ownerOfHandle(string calldata handle) external view returns (address);
}

/// @title Parley - name-addressed mailbox, red packets, payment requests and atomic swaps for Agent ID holders.
/// @notice Every recipient is given as an Agent ID handle (the part before ".ai"). There is no entry point
///         that takes a raw recipient address. Only Agent ID holders can open a mailbox.
contract Parley is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants
    uint256 public constant STRANGER_DAILY_LIMIT = 20;
    uint256 public constant STAMP_TTL = 72 hours;
    uint256 public constant MAX_DATA_BYTES = 1024;
    uint256 public constant MAX_MEMO_BYTES = 280;
    uint256 public constant MAX_SHARES = 500;
    uint256 public constant MAX_DIRECT = 50;
    uint256 public constant MIN_TTL = 10 minutes;
    uint256 public constant MAX_TTL = 7 days;
    uint256 private constant PAY_GAS = 100_000;

    // mail kinds
    uint8 internal constant K_TEXT = 1;
    uint8 internal constant K_DEAL = 2;
    uint8 internal constant K_PACKET = 10;
    uint8 internal constant K_REQUEST = 20;
    uint8 internal constant K_REQUEST_PAID = 21;
    uint8 internal constant K_REQUEST_DECLINED = 22;
    uint8 internal constant K_REQUEST_CANCELLED = 23;
    uint8 internal constant K_OFFER = 30;
    uint8 internal constant K_OFFER_SETTLED = 31;
    uint8 internal constant K_OFFER_DECLINED = 32;
    uint8 internal constant K_OFFER_CANCELLED = 33;

    // object status
    uint8 internal constant S_OPEN = 1;
    uint8 internal constant S_DONE = 2;
    uint8 internal constant S_DECLINED = 3;
    uint8 internal constant S_CANCELLED = 4;

    // ------------------------------------------------------------------ immutables
    IHandleRegistry public immutable REGISTRY;
    /// @notice The only privileged address. It can call setPaused and nothing else.
    address public immutable GUARDIAN;
    uint64 public immutable DEFAULT_POSTAGE;
    uint64 public immutable MAX_POSTAGE;
    uint128 public immutable MIN_SHARE;

    // ------------------------------------------------------------------ storage
    struct Mailbox {
        bytes32 pubKey; // X25519 public key used to encrypt mail for this owner
        uint40 openedAt;
        uint32 quotaDay;
        uint16 quotaUsed;
        bool postageSet;
        uint64 postage;
    }

    /// @dev One inbox entry. Kept in storage so that clients need eth_call only (many public BSC nodes
    ///      refuse eth_getLogs). `data` is ciphertext for messages and memos, empty for everything else.
    struct MailItem {
        address from;
        uint8 kind;
        uint40 time;
        uint48 refId; // packet / request / offer id, 0 for plain messages
        bytes data;
    }

    struct Stamp {
        uint128 amount;
        uint40 sentAt;
    }

    struct Packet {
        address creator;
        uint40 expiry;
        uint16 shares;
        uint16 claimed;
        bool direct;
        uint128 perShare;
        uint128 remaining;
    }

    struct Request {
        address payee;
        uint40 expiry;
        uint8 status;
        address payer;
        address token; // address(0) = native BNB
        uint128 amount;
    }

    struct Offer {
        address maker;
        uint40 expiry;
        uint8 status;
        address taker; // address(0) = public offer, any member may accept
        address giveToken; // address(0) = native BNB
        address wantToken;
        uint128 giveAmount;
        uint128 wantAmount;
    }

    struct OfferParams {
        string toHandle;
        address giveToken;
        uint128 giveAmount;
        address wantToken;
        uint128 wantAmount;
        uint40 ttl;
        uint256 stamp;
        uint256 refOfferId;
        bytes memo;
    }

    bool public paused;
    uint256 public memberCount;
    uint256 public mailCount;
    uint256 public packetCount;
    uint256 public requestCount;
    uint256 public offerCount;

    mapping(address => Mailbox) public mailboxes;
    mapping(address => MailItem[]) private _inbox;
    /// @notice allowed[recipient][sender]: sender may reach recipient without postage.
    mapping(address => mapping(address => bool)) public allowed;
    /// @notice blocked[recipient][sender]: every directed action from sender to recipient reverts.
    mapping(address => mapping(address => bool)) public blocked;
    /// @notice stamps[recipient][sender]: postage held until recipient answers or STAMP_TTL passes.
    mapping(address => mapping(address => Stamp)) public stamps;
    /// @notice Per-object cap for listed tokens. address(0) is BNB. 0 means "not listed, no cap".
    mapping(address => uint256) public cap;
    /// @notice BNB that could not be pushed to its owner; withdraw() pulls it.
    mapping(address => uint256) public pending;
    /// @notice Completed payment requests and swaps, per address.
    mapping(address => uint256) public dealsDone;

    mapping(uint256 => Packet) public packets;
    /// @notice Public plain-text greeting of a packet. Written by the creator: treat as untrusted data.
    mapping(uint256 => string) public packetMemo;
    /// @notice 0 = none, 1 = eligible (direct packets), 2 = claimed.
    mapping(uint256 => mapping(address => uint8)) public packetState;
    mapping(uint256 => Request) public requests;
    mapping(uint256 => Offer) public offers;

    // ------------------------------------------------------------------ events
    event MailboxOpened(address indexed owner, bytes32 pubKey);
    event KeyChanged(address indexed owner, bytes32 pubKey);
    event PostageSet(address indexed owner, uint64 postage);
    event ContactSet(address indexed owner, address indexed other, bool isAllowed, bool isBlocked);
    event Mail(
        address indexed to,
        address indexed from,
        uint8 indexed kind,
        uint256 index,
        uint256 refId,
        bytes data
    );
    event StampPosted(address indexed from, address indexed to, uint256 amount);
    event StampReleased(address indexed from, address indexed to, uint256 amount);
    event StampReclaimed(address indexed from, address indexed to, uint256 amount);
    event PacketCreated(
        uint256 indexed id, address indexed creator, bool direct, uint16 shares, uint128 perShare, uint40 expiry, string memo
    );
    event PacketClaimed(uint256 indexed id, address indexed claimer, uint128 amount, bool openedMailbox);
    event PacketRefunded(uint256 indexed id, address indexed creator, uint128 amount);
    event RequestCreated(
        uint256 indexed id, address indexed payee, address indexed payer, address token, uint128 amount, uint40 expiry
    );
    event RequestClosed(uint256 indexed id, uint8 status);
    event OfferCreated(
        uint256 indexed id,
        address indexed maker,
        address indexed taker,
        address giveToken,
        uint128 giveAmount,
        address wantToken,
        uint128 wantAmount,
        uint40 expiry,
        uint256 refOfferId
    );
    event OfferSettled(uint256 indexed id, address indexed taker, uint128 giveAmount, uint256 wantPaid);
    event OfferClosed(uint256 indexed id, uint8 status);
    event Owed(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event PausedSet(bool paused);

    // ------------------------------------------------------------------ errors
    error NotAgentId();
    error NotMember();
    error AlreadyMember();
    error BadKey();
    error UnknownHandle();
    error SelfTarget();
    error RecipientNoMailbox();
    error Blocked();
    error PostageRequired(uint256 needed);
    error UnexpectedValue();
    error QuotaExceeded();
    error TooLong();
    error BadParams();
    error OverCap();
    error NotFound();
    error NotOpen();
    error Expired();
    error NotExpired();
    error NotYours();
    error NotEligible();
    error AlreadyClaimed();
    error Empty();
    error NothingToDo();
    error IsPaused();
    error NotGuardian();
    error Underpaid();

    // ------------------------------------------------------------------ modifiers
    modifier onlyMember() {
        if (mailboxes[msg.sender].openedAt == 0) revert NotMember();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    /// @param capTokens  tokens with a per-object cap; use address(0) for BNB (required).
    /// @param capAmounts cap for each token, in the token's smallest unit.
    constructor(
        address registry,
        address guardian,
        uint64 defaultPostage,
        uint64 maxPostage,
        uint128 minShare,
        address[] memory capTokens,
        uint256[] memory capAmounts
    ) {
        if (registry == address(0) || guardian == address(0)) revert BadParams();
        if (capTokens.length != capAmounts.length || minShare == 0 || defaultPostage > maxPostage) revert BadParams();
        REGISTRY = IHandleRegistry(registry);
        GUARDIAN = guardian;
        DEFAULT_POSTAGE = defaultPostage;
        MAX_POSTAGE = maxPostage;
        MIN_SHARE = minShare;
        for (uint256 i; i < capTokens.length; ++i) {
            cap[capTokens[i]] = capAmounts[i];
        }
        if (cap[address(0)] == 0) revert BadParams();
    }

    // ================================================================== guardian
    /// @notice Pausing blocks new deposits and new objects only. Claims, refunds, cancels, declines,
    ///         stamp reclaims and withdrawals can never be paused.
    function setPaused(bool value) external {
        if (msg.sender != GUARDIAN) revert NotGuardian();
        paused = value;
        emit PausedSet(value);
    }

    // ================================================================== mailbox
    function openMailbox(bytes32 pubKey) external {
        if (mailboxes[msg.sender].openedAt != 0) revert AlreadyMember();
        _open(pubKey);
    }

    function setKey(bytes32 pubKey) external onlyMember {
        if (pubKey == bytes32(0)) revert BadKey();
        mailboxes[msg.sender].pubKey = pubKey;
        emit KeyChanged(msg.sender, pubKey);
    }

    function setPostage(uint64 postage) external onlyMember {
        if (postage > MAX_POSTAGE) revert BadParams();
        Mailbox storage mb = mailboxes[msg.sender];
        mb.postage = postage;
        mb.postageSet = true;
        emit PostageSet(msg.sender, postage);
    }

    /// @notice Let `handle` reach you without postage. Releases any stamp they posted to you.
    function allow(string calldata handle) external onlyMember nonReentrant {
        address other = _resolve(handle);
        blocked[msg.sender][other] = false;
        uint256 released = _reciprocate(other);
        emit ContactSet(msg.sender, other, true, false);
        _pay(msg.sender, released);
    }

    function blockHandle(string calldata handle) external onlyMember {
        address other = _resolve(handle);
        blocked[msg.sender][other] = true;
        allowed[msg.sender][other] = false;
        emit ContactSet(msg.sender, other, false, true);
    }

    function unblockHandle(string calldata handle) external onlyMember {
        address other = _resolve(handle);
        blocked[msg.sender][other] = false;
        emit ContactSet(msg.sender, other, allowed[msg.sender][other], false);
    }

    // ================================================================== messages
    /// @notice Send an encrypted message. msg.value is the postage stamp (first contact only).
    /// @param kind K_TEXT or K_DEAL. `data` is opaque ciphertext; the contract never interprets it.
    function sendMessage(string calldata toHandle, uint8 kind, bytes calldata data)
        external
        payable
        onlyMember
        whenNotPaused
        nonReentrant
        returns (uint256 index)
    {
        if (kind != K_TEXT && kind != K_DEAL) revert BadParams();
        if (data.length == 0 || data.length > MAX_DATA_BYTES) revert TooLong();
        address to = _resolve(toHandle);
        uint256 released = _engage(to, msg.value);
        index = _mail(to, kind, 0, data);
        _pay(msg.sender, released);
    }

    /// @notice Take back postage that the recipient did not answer within STAMP_TTL.
    function reclaimStamp(string calldata toHandle) external nonReentrant {
        address to = _resolve(toHandle);
        Stamp memory s = stamps[to][msg.sender];
        if (s.amount == 0) revert NothingToDo();
        if (block.timestamp < uint256(s.sentAt) + STAMP_TTL) revert NotExpired();
        delete stamps[to][msg.sender];
        emit StampReclaimed(msg.sender, to, s.amount);
        _pay(msg.sender, s.amount);
    }

    // ================================================================== red packets
    /// @notice Create a BNB red packet. Empty `toHandles` = public (any Agent ID, one share each).
    ///         Non-empty = direct (one equal share per named handle; `shares` must be 0 or the list length).
    /// @param memo Public plain-text greeting. Clients must treat it as untrusted data.
    function createPacket(uint16 shares, uint40 ttl, string[] calldata toHandles, string calldata memo)
        external
        payable
        onlyMember
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        bool direct = toHandles.length != 0;
        if (direct) {
            if (toHandles.length > MAX_DIRECT) revert BadParams();
            if (shares != 0 && shares != toHandles.length) revert BadParams();
            shares = uint16(toHandles.length);
        }
        if (shares == 0 || shares > MAX_SHARES) revert BadParams();
        if (ttl < MIN_TTL || ttl > MAX_TTL) revert BadParams();
        if (bytes(memo).length > MAX_MEMO_BYTES) revert TooLong();
        if (msg.value > cap[address(0)]) revert OverCap();
        uint256 perShare = msg.value / shares;
        if (perShare < MIN_SHARE || perShare * shares != msg.value) revert BadParams();

        id = ++packetCount;
        uint40 expiry = uint40(block.timestamp + ttl);
        packets[id] = Packet({
            creator: msg.sender,
            expiry: expiry,
            shares: shares,
            claimed: 0,
            direct: direct,
            perShare: uint128(perShare),
            remaining: uint128(msg.value)
        });
        if (bytes(memo).length != 0) packetMemo[id] = memo;
        emit PacketCreated(id, msg.sender, direct, shares, uint128(perShare), expiry, memo);

        uint256 released;
        if (direct) {
            for (uint256 i; i < toHandles.length; ++i) {
                address to = _resolve(toHandles[i]);
                if (blocked[to][msg.sender]) revert Blocked();
                if (packetState[id][to] != 0) revert BadParams();
                if (!allowed[to][msg.sender]) _useQuota(); // a packet to a stranger counts toward the daily quota
                packetState[id][to] = 1;
                released += _reciprocate(to);
                _mail(to, K_PACKET, id, ""); // the greeting is stored once, in packetMemo
            }
        }
        _pay(msg.sender, released);
    }

    /// @notice Claim one share. A caller without a mailbox must pass `pubKey`; the mailbox is opened in the same call.
    function claimPacket(uint256 id, bytes32 pubKey) external nonReentrant {
        Packet storage p = packets[id];
        if (p.creator == address(0)) revert NotFound();
        if (msg.sender == p.creator) revert SelfTarget();
        if (block.timestamp >= p.expiry) revert Expired();
        if (p.remaining < p.perShare) revert Empty();
        uint8 st = packetState[id][msg.sender];
        if (st == 2) revert AlreadyClaimed();
        if (p.direct && st != 1) revert NotEligible();

        bool opened;
        if (mailboxes[msg.sender].openedAt == 0) {
            _open(pubKey);
            opened = true;
        }
        uint128 amount = p.perShare;
        packetState[id][msg.sender] = 2;
        p.claimed += 1;
        p.remaining -= amount;
        // The creator invited this claimer: the claimer may answer without postage.
        allowed[p.creator][msg.sender] = true;
        emit PacketClaimed(id, msg.sender, amount, opened);
        _pay(msg.sender, amount);
    }

    /// @notice After expiry the creator takes back whatever was not claimed.
    function refundPacket(uint256 id) external nonReentrant {
        Packet storage p = packets[id];
        if (p.creator != msg.sender) revert NotYours();
        if (block.timestamp < p.expiry) revert NotExpired();
        uint128 amount = p.remaining;
        if (amount == 0) revert NothingToDo();
        p.remaining = 0;
        emit PacketRefunded(id, msg.sender, amount);
        _pay(msg.sender, amount);
    }

    // ================================================================== payment requests
    /// @notice Ask `fromHandle` to pay you. Nothing is escrowed; payment goes payer -> payee directly.
    ///         msg.value is the postage stamp (first contact only).
    function requestPayment(string calldata fromHandle, address token, uint128 amount, uint40 ttl, bytes calldata memo)
        external
        payable
        onlyMember
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        if (amount == 0 || ttl < MIN_TTL || ttl > MAX_TTL) revert BadParams();
        if (memo.length > MAX_DATA_BYTES) revert TooLong();
        if (cap[token] != 0 && amount > cap[token]) revert OverCap();
        address payer = _resolve(fromHandle);
        uint256 released = _engage(payer, msg.value);

        id = ++requestCount;
        uint40 expiry = uint40(block.timestamp + ttl);
        requests[id] =
            Request({payee: msg.sender, expiry: expiry, status: S_OPEN, payer: payer, token: token, amount: amount});
        emit RequestCreated(id, msg.sender, payer, token, amount, expiry);
        _mail(payer, K_REQUEST, id, memo);
        _pay(msg.sender, released);
    }

    /// @notice Token payments must deliver at least the requested amount; underdelivery reverts.
    function payRequest(uint256 id) external payable whenNotPaused nonReentrant {
        Request storage r = requests[id];
        if (r.status != S_OPEN) revert NotOpen();
        if (r.payer != msg.sender) revert NotYours();
        if (block.timestamp >= r.expiry) revert Expired();
        r.status = S_DONE;
        address payee = r.payee;
        uint256 released = _reciprocate(payee);
        dealsDone[msg.sender] += 1;
        dealsDone[payee] += 1;
        emit RequestClosed(id, S_DONE);
        _mail(payee, K_REQUEST_PAID, id, "");
        if (r.token == address(0)) {
            if (msg.value != r.amount) revert BadParams();
            _pay(payee, r.amount);
        } else {
            if (msg.value != 0) revert UnexpectedValue();
            IERC20 t = IERC20(r.token);
            uint256 before = t.balanceOf(payee);
            t.safeTransferFrom(msg.sender, payee, r.amount);
            uint256 afterBalance = t.balanceOf(payee);
            if (afterBalance < before || afterBalance - before < r.amount) revert Underpaid();
        }
        _pay(msg.sender, released);
    }

    function declineRequest(uint256 id) external {
        Request storage r = requests[id];
        if (r.status != S_OPEN) revert NotOpen();
        if (r.payer != msg.sender) revert NotYours();
        r.status = S_DECLINED;
        emit RequestClosed(id, S_DECLINED);
        _mail(r.payee, K_REQUEST_DECLINED, id, "");
    }

    function cancelRequest(uint256 id) external {
        Request storage r = requests[id];
        if (r.status != S_OPEN) revert NotOpen();
        if (r.payee != msg.sender) revert NotYours();
        r.status = S_CANCELLED;
        emit RequestClosed(id, S_CANCELLED);
        _mail(r.payer, K_REQUEST_CANCELLED, id, "");
    }

    // ================================================================== offers (atomic swaps)
    /// @notice Escrow `giveAmount` of `giveToken` and offer it for `wantAmount` of `wantToken`.
    ///         toHandle   - named counterparty, or "" for a public offer any member may accept.
    ///         stamp      - postage included in msg.value (first contact with a named counterparty only).
    ///         refOfferId - non-zero = counter-offer: the referenced open offer, which must be addressed to
    ///                      the caller by `toHandle`, is declined and refunded in the same call.
    function createOffer(OfferParams calldata p)
        external
        payable
        onlyMember
        whenNotPaused
        nonReentrant
        returns (uint256 id)
    {
        if (p.giveAmount == 0 || p.wantAmount == 0 || p.giveToken == p.wantToken) revert BadParams();
        if (p.ttl < MIN_TTL || p.ttl > MAX_TTL) revert BadParams();
        if (p.memo.length > MAX_DATA_BYTES) revert TooLong();
        if (cap[p.giveToken] != 0 && p.giveAmount > cap[p.giveToken]) revert OverCap();
        if (cap[p.wantToken] != 0 && p.wantAmount > cap[p.wantToken]) revert OverCap();

        address taker;
        uint256 released;
        if (bytes(p.toHandle).length != 0) {
            taker = _resolve(p.toHandle);
            released = _engage(taker, p.stamp);
        } else if (p.stamp != 0 || p.refOfferId != 0 || p.memo.length != 0) {
            revert BadParams(); // a public offer has no counterparty to stamp, counter or encrypt a memo for
        }

        if (p.refOfferId != 0) {
            Offer storage ref = offers[p.refOfferId];
            if (ref.status != S_OPEN) revert NotOpen();
            if (ref.taker != msg.sender || ref.maker != taker) revert NotYours();
            ref.status = S_DECLINED;
            emit OfferClosed(p.refOfferId, S_DECLINED);
            _refundGive(ref);
        }

        uint128 escrowed = _takeDeposit(p.giveToken, p.giveAmount, p.stamp);

        id = ++offerCount;
        uint40 expiry = uint40(block.timestamp + p.ttl);
        offers[id] = Offer({
            maker: msg.sender,
            expiry: expiry,
            status: S_OPEN,
            taker: taker,
            giveToken: p.giveToken,
            wantToken: p.wantToken,
            giveAmount: escrowed,
            wantAmount: p.wantAmount
        });
        emit OfferCreated(id, msg.sender, taker, p.giveToken, escrowed, p.wantToken, p.wantAmount, expiry, p.refOfferId);
        if (taker != address(0)) _mail(taker, K_OFFER, id, p.memo);
        _pay(msg.sender, released);
    }

    /// @notice Pay the wanted asset and receive the escrowed asset in one transaction.
    /// @param payAmount Only for token payments: amount to transfer to the maker. Must be >= wantAmount;
    ///                  pass more when the wanted token charges a transfer fee. Ignored for BNB.
    function acceptOffer(uint256 id, uint128 payAmount) external payable onlyMember whenNotPaused nonReentrant {
        Offer storage o = offers[id];
        if (o.status != S_OPEN) revert NotOpen();
        if (block.timestamp >= o.expiry) revert Expired();
        address maker = o.maker;
        if (o.taker != address(0)) {
            if (o.taker != msg.sender) revert NotYours();
        } else {
            if (msg.sender == maker) revert SelfTarget();
            if (blocked[maker][msg.sender]) revert Blocked();
        }
        o.status = S_DONE;
        uint256 released = _reciprocate(maker);
        allowed[maker][msg.sender] = true;
        dealsDone[msg.sender] += 1;
        dealsDone[maker] += 1;

        uint256 wantPaid;
        if (o.wantToken == address(0)) {
            if (msg.value != o.wantAmount) revert BadParams();
            wantPaid = msg.value;
            _pay(maker, wantPaid);
        } else {
            if (msg.value != 0) revert UnexpectedValue();
            if (payAmount < o.wantAmount) revert Underpaid();
            IERC20 t = IERC20(o.wantToken);
            uint256 before = t.balanceOf(maker);
            t.safeTransferFrom(msg.sender, maker, payAmount);
            wantPaid = t.balanceOf(maker) - before;
            if (wantPaid < o.wantAmount) revert Underpaid();
        }
        if (o.giveToken == address(0)) {
            _pay(msg.sender, o.giveAmount);
        } else {
            IERC20(o.giveToken).safeTransfer(msg.sender, o.giveAmount);
        }
        emit OfferSettled(id, msg.sender, o.giveAmount, wantPaid);
        _mail(maker, K_OFFER_SETTLED, id, "");
        _pay(msg.sender, released);
    }

    /// @notice The named counterparty refuses; the escrow goes back to the maker.
    function declineOffer(uint256 id) external nonReentrant {
        Offer storage o = offers[id];
        if (o.status != S_OPEN) revert NotOpen();
        if (o.taker != msg.sender) revert NotYours();
        o.status = S_DECLINED;
        emit OfferClosed(id, S_DECLINED);
        _mail(o.maker, K_OFFER_DECLINED, id, "");
        _refundGive(o);
    }

    /// @notice The maker withdraws an offer that was not accepted (also the way out after expiry).
    function cancelOffer(uint256 id) external nonReentrant {
        Offer storage o = offers[id];
        if (o.status != S_OPEN) revert NotOpen();
        if (o.maker != msg.sender) revert NotYours();
        o.status = S_CANCELLED;
        emit OfferClosed(id, S_CANCELLED);
        if (o.taker != address(0)) _mail(o.taker, K_OFFER_CANCELLED, id, "");
        _refundGive(o);
    }

    // ================================================================== withdraw
    function withdraw() external nonReentrant {
        uint256 amount = pending[msg.sender];
        if (amount == 0) revert NothingToDo();
        pending[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "withdraw failed");
    }

    // ================================================================== views
    function isMember(address who) external view returns (bool) {
        return mailboxes[who].openedAt != 0;
    }

    function postageOf(address who) public view returns (uint256) {
        Mailbox storage mb = mailboxes[who];
        return mb.postageSet ? mb.postage : DEFAULT_POSTAGE;
    }

    /// @notice Everything a client needs before a directed action from `from` to `toHandle`.
    function reach(address from, string calldata toHandle)
        external
        view
        returns (bool registered, bool hasMailbox, bool isBlocked, bool free, uint256 postage, bytes32 pubKey, uint256 quotaLeft)
    {
        address to = REGISTRY.ownerOfHandle(toHandle);
        if (to == address(0)) return (false, false, false, false, 0, bytes32(0), 0);
        Mailbox storage mb = mailboxes[to];
        registered = true;
        hasMailbox = mb.openedAt != 0;
        isBlocked = blocked[to][from];
        free = allowed[to][from];
        postage = free ? 0 : postageOf(to);
        pubKey = mb.pubKey;
        Mailbox storage me = mailboxes[from];
        uint256 used = me.quotaDay == uint32(block.timestamp / 1 days) ? me.quotaUsed : 0;
        quotaLeft = used >= STRANGER_DAILY_LIMIT ? 0 : STRANGER_DAILY_LIMIT - used;
    }

    function inboxLength(address who) external view returns (uint256) {
        return _inbox[who].length;
    }

    /// @notice Inbox entries [start, start + count) of `who`, clamped to the inbox length.
    function getMail(address who, uint256 start, uint256 count) external view returns (MailItem[] memory out) {
        MailItem[] storage box = _inbox[who];
        uint256 end = start + count;
        if (end > box.length) end = box.length;
        if (start >= end) return new MailItem[](0);
        out = new MailItem[](end - start);
        for (uint256 i = start; i < end; ++i) out[i - start] = box[i];
    }

    // ================================================================== internals
    function _open(bytes32 pubKey) private {
        if (pubKey == bytes32(0)) revert BadKey();
        if (REGISTRY.balanceOf(msg.sender) == 0) revert NotAgentId();
        Mailbox storage mb = mailboxes[msg.sender];
        mb.pubKey = pubKey;
        mb.openedAt = uint40(block.timestamp);
        memberCount += 1;
        emit MailboxOpened(msg.sender, pubKey);
    }

    function _resolve(string calldata handle) private view returns (address to) {
        to = REGISTRY.ownerOfHandle(handle);
        if (to == address(0)) revert UnknownHandle();
        if (to == msg.sender) revert SelfTarget();
    }

    /// @dev Caller starts a directed action toward `to`. Enforces mailbox, block list, postage and quota.
    ///      Returns BNB owed to the caller (a stamp `to` had posted to the caller, now released).
    function _engage(address to, uint256 stamp) private returns (uint256 released) {
        if (mailboxes[to].openedAt == 0) revert RecipientNoMailbox();
        if (blocked[to][msg.sender]) revert Blocked();
        if (allowed[to][msg.sender]) {
            if (stamp != 0) revert UnexpectedValue();
        } else {
            uint256 need = postageOf(to);
            if (stamp < need) revert PostageRequired(need);
            if (stamp > MAX_POSTAGE) revert OverCap();
            _useQuota();
            if (stamp != 0) {
                Stamp storage s = stamps[to][msg.sender];
                s.amount += uint128(stamp);
                if (s.sentAt == 0) s.sentAt = uint40(block.timestamp);
                emit StampPosted(msg.sender, to, stamp);
            }
        }
        released = _reciprocate(to);
    }

    /// @dev One unit of the caller's daily allowance for reaching people who have not allowed them.
    function _useQuota() private {
        Mailbox storage me = mailboxes[msg.sender];
        uint32 day = uint32(block.timestamp / 1 days);
        if (me.quotaDay != day) {
            me.quotaDay = day;
            me.quotaUsed = 0;
        }
        if (me.quotaUsed >= STRANGER_DAILY_LIMIT) revert QuotaExceeded();
        me.quotaUsed += 1;
    }

    /// @dev Caller has reached out to `to`: `to` may now answer for free, and any stamp `to` posted to the
    ///      caller is released to the caller.
    function _reciprocate(address to) private returns (uint256 released) {
        if (!allowed[msg.sender][to]) allowed[msg.sender][to] = true;
        released = stamps[msg.sender][to].amount;
        if (released != 0) {
            delete stamps[msg.sender][to];
            emit StampReleased(to, msg.sender, released);
        }
    }

    /// @dev Appends to the recipient's inbox. Works for handles that have not opened a mailbox yet,
    ///      so a red packet sent to a newcomer is waiting when they arrive.
    function _mail(address to, uint8 kind, uint256 refId, bytes memory data) private returns (uint256 index) {
        MailItem[] storage box = _inbox[to];
        index = box.length;
        box.push(MailItem({from: msg.sender, kind: kind, time: uint40(block.timestamp), refId: uint48(refId), data: data}));
        mailCount += 1;
        emit Mail(to, msg.sender, kind, index, refId, data);
    }

    /// @dev Pulls the maker's deposit. Fee-on-transfer tokens: returns what actually arrived.
    function _takeDeposit(address giveToken, uint128 giveAmount, uint256 stamp) private returns (uint128 escrowed) {
        if (giveToken == address(0)) {
            if (msg.value != uint256(giveAmount) + stamp) revert BadParams();
            return giveAmount;
        }
        if (msg.value != stamp) revert BadParams();
        IERC20 t = IERC20(giveToken);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), giveAmount);
        uint256 got = t.balanceOf(address(this)) - before;
        if (got == 0 || got > type(uint128).max) revert BadParams();
        escrowed = uint128(got);
    }

    function _refundGive(Offer storage o) private {
        if (o.giveToken == address(0)) {
            _pay(o.maker, o.giveAmount);
        } else {
            IERC20(o.giveToken).safeTransfer(o.maker, o.giveAmount);
        }
    }

    /// @dev Push BNB with a gas ceiling; on failure credit `pending` so one receiver cannot block others.
    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: PAY_GAS}("");
        if (!ok) {
            pending[to] += amount;
            emit Owed(to, amount);
        }
    }
}
