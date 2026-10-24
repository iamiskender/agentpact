// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AgentPact is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error DeadlineInPast();
    error InvalidReviewPeriod();
    error SameAddress();
    error ZeroAddress();
    error NotProvider();
    error NotClient();
    error NotArbiter();
    error WrongStatus();
    error DeadlinePassed();
    error DeadlineNotReached();
    error ReviewPeriodActive();
    error ReviewPeriodEnded();
    error ArbiterTimeoutNotReached();
    error InvalidBps();

    uint256 public constant MIN_REVIEW = 60;
    uint256 public constant MAX_REVIEW = 30 days;
    uint256 public constant ARBITER_TIMEOUT = 7 days;

    enum Status {
        Funded,
        Submitted,
        Released,
        Refunded,
        Disputed,
        Resolved
    }

    struct Job {
        address client;
        address provider;
        address arbiter;
        uint256 amount;
        uint256 deliveryDeadline;
        uint256 reviewPeriod;
        uint256 submittedAt;
        uint256 disputedAt;
        bytes32 specHash;
        bytes32 resultHash;
        Status status;
    }

    struct ProviderStats {
        uint256 jobsCompleted;
        uint256 jobsDisputed;
        uint256 totalEarned;
    }

    IERC20 public immutable usdc;

    mapping(uint256 => Job) public jobs;
    uint256 public jobCount;
    mapping(address => ProviderStats) private _providerStats;

    event JobCreated(
        uint256 indexed jobId,
        address indexed client,
        address indexed provider,
        address arbiter,
        uint256 amount,
        uint256 deliveryDeadline,
        uint256 reviewPeriod,
        bytes32 specHash
    );
    event ResultSubmitted(uint256 indexed jobId, bytes32 resultHash);
    event JobReleased(uint256 indexed jobId, address indexed provider, uint256 amount);
    event JobRefunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobDisputed(uint256 indexed jobId, address indexed client, uint256 disputedAt);
    event JobResolved(uint256 indexed jobId, uint256 providerBps, uint256 providerAmount, uint256 clientAmount);

    constructor(address usdcToken) {
        if (usdcToken == address(0)) revert ZeroAddress();
        usdc = IERC20(usdcToken);
    }

    function createJob(
        address provider,
        address arbiter,
        uint256 amount,
        uint256 deliveryDeadline,
        uint256 reviewPeriod,
        bytes32 specHash
    ) external returns (uint256 jobId) {
        if (amount == 0) revert ZeroAmount();
        if (deliveryDeadline <= block.timestamp) revert DeadlineInPast();
        if (reviewPeriod < MIN_REVIEW || reviewPeriod > MAX_REVIEW) revert InvalidReviewPeriod();
        if (provider == msg.sender) revert SameAddress();
        if (arbiter == address(0)) revert ZeroAddress();
        if (arbiter == msg.sender || arbiter == provider) revert SameAddress();

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        jobId = ++jobCount;
        jobs[jobId] = Job({
            client: msg.sender,
            provider: provider,
            arbiter: arbiter,
            amount: amount,
            deliveryDeadline: deliveryDeadline,
            reviewPeriod: reviewPeriod,
            submittedAt: 0,
            disputedAt: 0,
            specHash: specHash,
            resultHash: bytes32(0),
            status: Status.Funded
        });

        emit JobCreated(jobId, msg.sender, provider, arbiter, amount, deliveryDeadline, reviewPeriod, specHash);
    }

    function submitResult(uint256 jobId, bytes32 resultHash) external {
        Job storage job = jobs[jobId];

        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != Status.Funded) revert WrongStatus();
        if (block.timestamp >= job.deliveryDeadline) revert DeadlinePassed();

        job.resultHash = resultHash;
        job.submittedAt = block.timestamp;
        job.status = Status.Submitted;

        emit ResultSubmitted(jobId, resultHash);
    }

    function approve(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];

        if (msg.sender != job.client) revert NotClient();
        if (job.status != Status.Submitted) revert WrongStatus();

        job.status = Status.Released;

        ProviderStats storage stats = _providerStats[job.provider];
        stats.jobsCompleted += 1;
        stats.totalEarned += job.amount;

        usdc.safeTransfer(job.provider, job.amount);

        emit JobReleased(jobId, job.provider, job.amount);
    }

    function claimAfterReview(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];

        if (msg.sender != job.provider) revert NotProvider();
        if (job.status != Status.Submitted) revert WrongStatus();
        if (block.timestamp < job.submittedAt + job.reviewPeriod) revert DeadlineNotReached();

        job.status = Status.Released;

        ProviderStats storage stats = _providerStats[job.provider];
        stats.jobsCompleted += 1;
        stats.totalEarned += job.amount;

        usdc.safeTransfer(job.provider, job.amount);

        emit JobReleased(jobId, job.provider, job.amount);
    }

    function refundExpired(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];

        if (msg.sender != job.client) revert NotClient();
        if (job.status != Status.Funded) revert WrongStatus();
        if (block.timestamp < job.deliveryDeadline) revert DeadlineNotReached();

        job.status = Status.Refunded;

        usdc.safeTransfer(job.client, job.amount);

        emit JobRefunded(jobId, job.client, job.amount);
    }

    function reject(uint256 jobId) external {
        Job storage job = jobs[jobId];

        if (msg.sender != job.client) revert NotClient();
        if (job.status != Status.Submitted) revert WrongStatus();
        if (block.timestamp >= job.submittedAt + job.reviewPeriod) revert ReviewPeriodEnded();

        job.status = Status.Disputed;
        job.disputedAt = block.timestamp;

        _providerStats[job.provider].jobsDisputed += 1;

        emit JobDisputed(jobId, job.client, job.disputedAt);
    }

    function resolve(uint256 jobId, uint256 providerBps) external nonReentrant {
        Job storage job = jobs[jobId];

        if (msg.sender != job.arbiter) revert NotArbiter();
        if (job.status != Status.Disputed) revert WrongStatus();
        if (providerBps > 10_000) revert InvalidBps();

        uint256 providerAmount = (job.amount * providerBps) / 10_000;
        uint256 clientAmount = job.amount - providerAmount;

        job.status = Status.Resolved;

        if (providerAmount > 0) {
            ProviderStats storage stats = _providerStats[job.provider];
            stats.jobsCompleted += 1;
            stats.totalEarned += providerAmount;
            usdc.safeTransfer(job.provider, providerAmount);
        }

        if (clientAmount > 0) {
            usdc.safeTransfer(job.client, clientAmount);
        }

        emit JobResolved(jobId, providerBps, providerAmount, clientAmount);
    }

    function resolveTimeout(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];

        if (job.status != Status.Disputed) revert WrongStatus();
        if (block.timestamp < job.disputedAt + ARBITER_TIMEOUT) revert ArbiterTimeoutNotReached();

        uint256 providerAmount = job.amount / 2;
        uint256 clientAmount = job.amount - providerAmount;

        job.status = Status.Resolved;

        if (providerAmount > 0) {
            ProviderStats storage stats = _providerStats[job.provider];
            stats.jobsCompleted += 1;
            stats.totalEarned += providerAmount;
            usdc.safeTransfer(job.provider, providerAmount);
        }

        if (clientAmount > 0) {
            usdc.safeTransfer(job.client, clientAmount);
        }

        emit JobResolved(jobId, 5_000, providerAmount, clientAmount);
    }

    function getProviderStats(
        address provider
    ) external view returns (uint256 jobsCompleted, uint256 jobsDisputed, uint256 totalEarned) {
        ProviderStats storage stats = _providerStats[provider];
        return (stats.jobsCompleted, stats.jobsDisputed, stats.totalEarned);
    }
}
