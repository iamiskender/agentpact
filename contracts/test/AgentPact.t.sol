// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {AgentPact} from "../AgentPact.sol";

// ---------------------------------------------------------------------------
// Minimal 6-decimal mock USDC (self-contained in the test file)
// ---------------------------------------------------------------------------
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    uint8 public decimals = 6;

    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allowance;
    uint256 private _total;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
        _total += amount;
        emit Transfer(address(0), to, amount);
    }

    function totalSupply() external view returns (uint256) { return _total; }
    function balanceOf(address a) external view returns (uint256) { return _bal[a]; }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowance[owner][spender];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(_bal[msg.sender] >= amount, "ERC20: insufficient balance");
        _bal[msg.sender] -= amount;
        _bal[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_bal[from] >= amount, "ERC20: insufficient balance");
        require(_allowance[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        _allowance[from][msg.sender] -= amount;
        _bal[from] -= amount;
        _bal[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

// ---------------------------------------------------------------------------
// Main test contract
// ---------------------------------------------------------------------------
contract AgentPactTest is Test {

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------
    AgentPact internal pact;
    MockUSDC  internal usdc;

    address internal client   = makeAddr("client");
    address internal provider = makeAddr("provider");
    address internal arbiter  = makeAddr("arbiter");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant AMOUNT          = 1_000_000; // 1 USDC (6 dec)
    uint256 internal constant REVIEW_PERIOD   = 1 hours;
    uint256 internal constant DELIVERY_PERIOD = 1 days;

    bytes32 internal constant SPEC_HASH   = keccak256("spec");
    bytes32 internal constant RESULT_HASH = keccak256("result");

    // -----------------------------------------------------------------------
    // setUp — fresh state before every test
    // -----------------------------------------------------------------------
    function setUp() public {
        usdc = new MockUSDC();
        pact = new AgentPact(address(usdc));

        // Fund client with 2 USDC and pre-approve the pact contract
        usdc.mint(client, 2 * AMOUNT);
        vm.prank(client);
        usdc.approve(address(pact), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /// Create a job with default parameters and return its jobId.
    function _createJob() internal returns (uint256 jobId) {
        vm.prank(client);
        jobId = pact.createJob(
            provider,
            arbiter,
            AMOUNT,
            block.timestamp + DELIVERY_PERIOD,
            REVIEW_PERIOD,
            SPEC_HASH
        );
    }

    /// Create → submit result.
    function _createAndSubmit() internal returns (uint256 jobId) {
        jobId = _createJob();
        vm.prank(provider);
        pact.submitResult(jobId, RESULT_HASH);
    }

    /// Create → submit → reject (opens a dispute).
    function _createSubmitReject() internal returns (uint256 jobId) {
        jobId = _createAndSubmit();
        vm.prank(client);
        pact.reject(jobId);
    }

    // =======================================================================
    //  1. CONSTRUCTOR / DEPLOYMENT
    // =======================================================================

    function test_Constructor_SetsUsdcAddress() public view {
        assertEq(address(pact.usdc()), address(usdc));
    }

    function test_Constructor_ZeroAddress_Reverts() public {
        vm.expectRevert(AgentPact.ZeroAddress.selector);
        new AgentPact(address(0));
    }

    function test_Constructor_InitialJobCountIsZero() public view {
        assertEq(pact.jobCount(), 0);
    }

    // =======================================================================
    //  2. createJob — happy path + event (test #33)
    // =======================================================================

    function test_CreateJob_HappyPath() public {
        uint256 beforeClient  = usdc.balanceOf(client);
        uint256 beforePact    = usdc.balanceOf(address(pact));

        uint256 deadline = block.timestamp + DELIVERY_PERIOD;
        vm.prank(client);
        uint256 jobId = pact.createJob(provider, arbiter, AMOUNT, deadline, REVIEW_PERIOD, SPEC_HASH);

        assertEq(jobId, 1);
        assertEq(pact.jobCount(), 1);

        // USDC moved from client → pact
        assertEq(usdc.balanceOf(client),        beforeClient - AMOUNT);
        assertEq(usdc.balanceOf(address(pact)),  beforePact  + AMOUNT);

        // Verify stored job fields via public getter
        (
            address jClient,
            address jProvider,
            address jArbiter,
            uint256 jAmount,
            uint256 jDeliveryDeadline,
            uint256 jReviewPeriod,
            ,
            ,
            bytes32 jSpecHash,
            ,
            AgentPact.Status jStatus
        ) = pact.jobs(jobId);

        assertEq(jClient,           client);
        assertEq(jProvider,         provider);
        assertEq(jArbiter,          arbiter);
        assertEq(jAmount,           AMOUNT);
        assertEq(jDeliveryDeadline, deadline);
        assertEq(jReviewPeriod,     REVIEW_PERIOD);
        assertEq(jSpecHash,         SPEC_HASH);
        assertEq(uint8(jStatus),    uint8(AgentPact.Status.Funded));
    }

    /// Test #33 — JobCreated event fields
    function test_CreateJob_EmitsJobCreated() public {
        uint256 deadline = block.timestamp + DELIVERY_PERIOD;

        vm.prank(client);
        vm.expectEmit(true, true, true, true, address(pact));
        emit AgentPact.JobCreated(1, client, provider, arbiter, AMOUNT, deadline, REVIEW_PERIOD, SPEC_HASH);
        pact.createJob(provider, arbiter, AMOUNT, deadline, REVIEW_PERIOD, SPEC_HASH);
    }

    // =======================================================================
    //  3. createJob — revert paths (#18-25)
    // =======================================================================

    /// #18 — amount == 0
    function test_CreateJob_Revert_ZeroAmount() public {
        vm.prank(client);
        vm.expectRevert(AgentPact.ZeroAmount.selector);
        pact.createJob(provider, arbiter, 0, block.timestamp + DELIVERY_PERIOD, REVIEW_PERIOD, SPEC_HASH);
    }

    /// #19 — deliveryDeadline in the past
    function test_CreateJob_Revert_DeadlineInPast() public {
        vm.prank(client);
        vm.expectRevert(AgentPact.DeadlineInPast.selector);
        pact.createJob(provider, arbiter, AMOUNT, block.timestamp, REVIEW_PERIOD, SPEC_HASH);
    }

    /// #20 — reviewPeriod below MIN_REVIEW (60 s)
    function test_CreateJob_Revert_ReviewPeriodTooShort() public {
        vm.prank(client);
        vm.expectRevert(AgentPact.InvalidReviewPeriod.selector);
        pact.createJob(provider, arbiter, AMOUNT, block.timestamp + DELIVERY_PERIOD, 59, SPEC_HASH);
    }

    /// #21 — reviewPeriod above MAX_REVIEW (30 days)
    function test_CreateJob_Revert_ReviewPeriodTooLong() public {
        vm.prank(client);
        vm.expectRevert(AgentPact.InvalidReviewPeriod.selector);
        pact.createJob(
            provider,
            arbiter,
            AMOUNT,
            block.timestamp + DELIVERY_PERIOD,
            30 days + 1,
            SPEC_HASH
        );
    }

    /// #22 — provider == client
    function test_CreateJob_Revert_ProviderIsClient() public {
        vm.prank(client);
        vm.expectRevert(AgentPact.SameAddress.selector);
        pact.createJob(client, arbiter, AMOUNT, block.timestamp + DELIVERY_PERIOD, REVIEW_PERIOD, SPEC_HASH);
    }

    /// #23 — arbiter == zero address
    function test_CreateJob_Revert_ArbiterZero() public {
        vm.prank(client);
        vm.expectRevert(AgentPact.ZeroAddress.selector);
        pact.createJob(provider, address(0), AMOUNT, block.timestamp + DELIVERY_PERIOD, REVIEW_PERIOD, SPEC_HASH);
    }

    /// #24 — arbiter == client
    function test_CreateJob_Revert_ArbiterIsClient() public {
        vm.prank(client);
        vm.expectRevert(AgentPact.SameAddress.selector);
        pact.createJob(provider, client, AMOUNT, block.timestamp + DELIVERY_PERIOD, REVIEW_PERIOD, SPEC_HASH);
    }

    /// #25 — arbiter == provider
    function test_CreateJob_Revert_ArbiterIsProvider() public {
        vm.prank(client);
        vm.expectRevert(AgentPact.SameAddress.selector);
        pact.createJob(provider, provider, AMOUNT, block.timestamp + DELIVERY_PERIOD, REVIEW_PERIOD, SPEC_HASH);
    }

    // =======================================================================
    //  4. submitResult
    // =======================================================================

    /// Test #34 — ResultSubmitted event
    function test_SubmitResult_HappyPath_EmitsEvent() public {
        uint256 jobId = _createJob();

        vm.prank(provider);
        vm.expectEmit(true, false, false, true, address(pact));
        emit AgentPact.ResultSubmitted(jobId, RESULT_HASH);
        pact.submitResult(jobId, RESULT_HASH);

        // Status changed to Submitted
        (, , , , , , uint256 submittedAt, , , bytes32 storedHash, AgentPact.Status status) = pact.jobs(jobId);
        assertEq(uint8(status), uint8(AgentPact.Status.Submitted));
        assertEq(storedHash, RESULT_HASH);
        assertGt(submittedAt, 0);
    }

    /// #9 — submitResult after deliveryDeadline
    function test_SubmitResult_Revert_DeadlinePassed() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + DELIVERY_PERIOD + 1);
        vm.prank(provider);
        vm.expectRevert(AgentPact.DeadlinePassed.selector);
        pact.submitResult(jobId, RESULT_HASH);
    }

    /// #16 — submitResult by non-provider
    function test_SubmitResult_Revert_NotProvider() public {
        uint256 jobId = _createJob();
        vm.prank(stranger);
        vm.expectRevert(AgentPact.NotProvider.selector);
        pact.submitResult(jobId, RESULT_HASH);
    }

    // =======================================================================
    //  5. approve — happy path (#1) + event (#35) + reputation (#28)
    // =======================================================================

    /// #1 — create → submit → approve
    function test_Approve_HappyPath() public {
        uint256 jobId = _createAndSubmit();

        uint256 beforeProvider = usdc.balanceOf(provider);
        uint256 beforePact     = usdc.balanceOf(address(pact));

        vm.prank(client);
        pact.approve(jobId);

        // USDC transferred to provider
        assertEq(usdc.balanceOf(provider),       beforeProvider + AMOUNT);
        assertEq(usdc.balanceOf(address(pact)),  beforePact     - AMOUNT);

        // Status is Released
        (, , , , , , , , , , AgentPact.Status status) = pact.jobs(jobId);
        assertEq(uint8(status), uint8(AgentPact.Status.Released));
    }

    /// #35 — JobReleased event on approve
    function test_Approve_EmitsJobReleased() public {
        uint256 jobId = _createAndSubmit();

        vm.prank(client);
        vm.expectEmit(true, true, false, true, address(pact));
        emit AgentPact.JobReleased(jobId, provider, AMOUNT);
        pact.approve(jobId);
    }

    /// #28 — reputation after approve
    function test_Approve_ReputationUpdated() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(client);
        pact.approve(jobId);

        (uint256 completed, uint256 disputed, uint256 earned) = pact.getProviderStats(provider);
        assertEq(completed, 1);
        assertEq(disputed,  0);
        assertEq(earned,    AMOUNT);
    }

    /// #13 — approve by non-client
    function test_Approve_Revert_NotClient() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(stranger);
        vm.expectRevert(AgentPact.NotClient.selector);
        pact.approve(jobId);
    }

    /// #6 — double approve (status already Released)
    function test_Approve_Revert_DoubleApprove() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(client);
        pact.approve(jobId);

        vm.prank(client);
        vm.expectRevert(AgentPact.WrongStatus.selector);
        pact.approve(jobId);
    }

    /// #8 — approve after refund (status Refunded)
    function test_Approve_Revert_AfterRefund() public {
        uint256 jobId = _createJob();
        // warp past delivery deadline and refund
        vm.warp(block.timestamp + DELIVERY_PERIOD + 1);
        vm.prank(client);
        pact.refundExpired(jobId);

        vm.prank(client);
        vm.expectRevert(AgentPact.WrongStatus.selector);
        pact.approve(jobId);
    }

    // =======================================================================
    //  6. claimAfterReview — silent-client path (#2) + event + reputation (#29)
    // =======================================================================

    /// #2 — create → submit → warp past reviewPeriod → claimAfterReview
    function test_ClaimAfterReview_HappyPath() public {
        uint256 jobId = _createAndSubmit();

        // Warp past the review period
        (, , , , , uint256 reviewPeriod, uint256 submittedAt, , , ,) = pact.jobs(jobId);
        vm.warp(submittedAt + reviewPeriod + 1);

        uint256 beforeProvider = usdc.balanceOf(provider);

        vm.prank(provider);
        pact.claimAfterReview(jobId);

        assertEq(usdc.balanceOf(provider), beforeProvider + AMOUNT);

        (, , , , , , , , , , AgentPact.Status status) = pact.jobs(jobId);
        assertEq(uint8(status), uint8(AgentPact.Status.Released));
    }

    /// JobReleased event from claimAfterReview
    function test_ClaimAfterReview_EmitsJobReleased() public {
        uint256 jobId = _createAndSubmit();
        (, , , , , uint256 reviewPeriod, uint256 submittedAt, , , ,) = pact.jobs(jobId);
        vm.warp(submittedAt + reviewPeriod + 1);

        vm.prank(provider);
        vm.expectEmit(true, true, false, true, address(pact));
        emit AgentPact.JobReleased(jobId, provider, AMOUNT);
        pact.claimAfterReview(jobId);
    }

    /// #29 — reputation after claimAfterReview
    function test_ClaimAfterReview_ReputationUpdated() public {
        uint256 jobId = _createAndSubmit();
        (, , , , , uint256 reviewPeriod, uint256 submittedAt, , , ,) = pact.jobs(jobId);
        vm.warp(submittedAt + reviewPeriod + 1);

        vm.prank(provider);
        pact.claimAfterReview(jobId);

        (uint256 completed, , uint256 earned) = pact.getProviderStats(provider);
        assertEq(completed, 1);
        assertEq(earned,    AMOUNT);
    }

    /// #14 — claimAfterReview by non-provider
    function test_ClaimAfterReview_Revert_NotProvider() public {
        uint256 jobId = _createAndSubmit();
        (, , , , , uint256 reviewPeriod, uint256 submittedAt, , , ,) = pact.jobs(jobId);
        vm.warp(submittedAt + reviewPeriod + 1);

        vm.prank(stranger);
        vm.expectRevert(AgentPact.NotProvider.selector);
        pact.claimAfterReview(jobId);
    }

    /// #26 — claimAfterReview before reviewPeriod ends
    function test_ClaimAfterReview_Revert_DeadlineNotReached() public {
        uint256 jobId = _createAndSubmit();
        // Still within review period — do NOT warp
        vm.prank(provider);
        vm.expectRevert(AgentPact.DeadlineNotReached.selector);
        pact.claimAfterReview(jobId);
    }

    // =======================================================================
    //  7. refundExpired — no-delivery path (#3) + event (#36) + revert paths
    // =======================================================================

    /// #3 — create → warp past deliveryDeadline → refundExpired
    function test_RefundExpired_HappyPath() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + DELIVERY_PERIOD + 1);

        uint256 beforeClient = usdc.balanceOf(client);

        vm.prank(client);
        pact.refundExpired(jobId);

        assertEq(usdc.balanceOf(client), beforeClient + AMOUNT);

        (, , , , , , , , , , AgentPact.Status status) = pact.jobs(jobId);
        assertEq(uint8(status), uint8(AgentPact.Status.Refunded));
    }

    /// #36 — JobRefunded event
    function test_RefundExpired_EmitsJobRefunded() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + DELIVERY_PERIOD + 1);

        vm.prank(client);
        vm.expectEmit(true, true, false, true, address(pact));
        emit AgentPact.JobRefunded(jobId, client, AMOUNT);
        pact.refundExpired(jobId);
    }

    /// #15 — refundExpired by non-client
    function test_RefundExpired_Revert_NotClient() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + DELIVERY_PERIOD + 1);

        vm.prank(stranger);
        vm.expectRevert(AgentPact.NotClient.selector);
        pact.refundExpired(jobId);
    }

    /// #7 — double refund (status already Refunded)
    function test_RefundExpired_Revert_DoubleRefund() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + DELIVERY_PERIOD + 1);

        vm.prank(client);
        pact.refundExpired(jobId);

        vm.prank(client);
        vm.expectRevert(AgentPact.WrongStatus.selector);
        pact.refundExpired(jobId);
    }

    /// #27 — refundExpired before deliveryDeadline
    function test_RefundExpired_Revert_DeadlineNotReached() public {
        uint256 jobId = _createJob();
        // do NOT warp
        vm.prank(client);
        vm.expectRevert(AgentPact.DeadlineNotReached.selector);
        pact.refundExpired(jobId);
    }

    // =======================================================================
    //  8. reject — dispute path (#4 partial) + event (#37) + reputation (#30)
    // =======================================================================

    /// reject within review period → status Disputed
    function test_Reject_HappyPath() public {
        uint256 jobId = _createAndSubmit();
        // still within review period
        vm.prank(client);
        pact.reject(jobId);

        (, , , , , , , uint256 disputedAt, , , AgentPact.Status status) = pact.jobs(jobId);
        assertEq(uint8(status), uint8(AgentPact.Status.Disputed));
        assertGt(disputedAt, 0);
    }

    /// #37 — JobDisputed event
    function test_Reject_EmitsJobDisputed() public {
        uint256 jobId = _createAndSubmit();
        uint256 expectedDisputedAt = block.timestamp;

        vm.prank(client);
        vm.expectEmit(true, true, false, true, address(pact));
        emit AgentPact.JobDisputed(jobId, client, expectedDisputedAt);
        pact.reject(jobId);
    }

    /// #30 — jobsDisputed incremented after reject
    function test_Reject_ReputationDisputed() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(client);
        pact.reject(jobId);

        (, uint256 disputed, ) = pact.getProviderStats(provider);
        assertEq(disputed, 1);
    }

    /// #17 — reject by non-client
    function test_Reject_Revert_NotClient() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(stranger);
        vm.expectRevert(AgentPact.NotClient.selector);
        pact.reject(jobId);
    }

    /// #10 — reject after reviewPeriod ends
    function test_Reject_Revert_ReviewPeriodEnded() public {
        uint256 jobId = _createAndSubmit();
        (, , , , , uint256 reviewPeriod, uint256 submittedAt, , , ,) = pact.jobs(jobId);
        vm.warp(submittedAt + reviewPeriod + 1);

        vm.prank(client);
        vm.expectRevert(AgentPact.ReviewPeriodEnded.selector);
        pact.reject(jobId);
    }

    // =======================================================================
    //  9. resolve — arbiter splits (#4) + event (#38) + reputation (#31)
    // =======================================================================

    /// #4 — create → submit → reject → resolve(7000 bps) → 70/30 split
    function test_Resolve_HappyPath_7000Bps() public {
        uint256 jobId = _createSubmitReject();

        uint256 beforeProvider = usdc.balanceOf(provider);
        uint256 beforeClient   = usdc.balanceOf(client);

        vm.prank(arbiter);
        pact.resolve(jobId, 7_000);

        uint256 expectedProvider = (AMOUNT * 7_000) / 10_000; // 700_000
        uint256 expectedClient   = AMOUNT - expectedProvider;  // 300_000

        assertEq(usdc.balanceOf(provider), beforeProvider + expectedProvider);
        assertEq(usdc.balanceOf(client),   beforeClient   + expectedClient);

        (, , , , , , , , , , AgentPact.Status status) = pact.jobs(jobId);
        assertEq(uint8(status), uint8(AgentPact.Status.Resolved));
    }

    /// #38 — JobResolved event (providerBps, providerAmount, clientAmount)
    function test_Resolve_EmitsJobResolved() public {
        uint256 jobId = _createSubmitReject();

        uint256 providerBps    = 7_000;
        uint256 providerAmount = (AMOUNT * providerBps) / 10_000;
        uint256 clientAmount   = AMOUNT - providerAmount;

        vm.prank(arbiter);
        vm.expectEmit(true, false, false, true, address(pact));
        emit AgentPact.JobResolved(jobId, providerBps, providerAmount, clientAmount);
        pact.resolve(jobId, providerBps);
    }

    /// #31 — reputation after resolve(7000 bps): completed=1, totalEarned=70%
    function test_Resolve_ReputationUpdated_7000Bps() public {
        uint256 jobId = _createSubmitReject();
        vm.prank(arbiter);
        pact.resolve(jobId, 7_000);

        uint256 expectedEarned = (AMOUNT * 7_000) / 10_000;
        (uint256 completed, , uint256 earned) = pact.getProviderStats(provider);
        assertEq(completed, 1);
        assertEq(earned,    expectedEarned);
    }

    /// resolve(0 bps) — everything to client, provider gets nothing, no completed++
    function test_Resolve_ZeroProviderBps() public {
        uint256 jobId = _createSubmitReject();

        uint256 beforeClient = usdc.balanceOf(client);

        vm.prank(arbiter);
        pact.resolve(jobId, 0);

        assertEq(usdc.balanceOf(client), beforeClient + AMOUNT);

        // provider stats: completed stays 0 (no providerAmount)
        (uint256 completed, , uint256 earned) = pact.getProviderStats(provider);
        assertEq(completed, 0);
        assertEq(earned,    0);
    }

    /// resolve(10_000 bps) — everything to provider
    function test_Resolve_FullProviderBps() public {
        uint256 jobId = _createSubmitReject();

        uint256 beforeProvider = usdc.balanceOf(provider);

        vm.prank(arbiter);
        pact.resolve(jobId, 10_000);

        assertEq(usdc.balanceOf(provider), beforeProvider + AMOUNT);

        (uint256 completed, , uint256 earned) = pact.getProviderStats(provider);
        assertEq(completed, 1);
        assertEq(earned,    AMOUNT);
    }

    /// #12 — resolve called by non-arbiter
    function test_Resolve_Revert_NotArbiter() public {
        uint256 jobId = _createSubmitReject();
        vm.prank(stranger);
        vm.expectRevert(AgentPact.NotArbiter.selector);
        pact.resolve(jobId, 5_000);
    }

    /// resolve with providerBps > 10_000
    function test_Resolve_Revert_InvalidBps() public {
        uint256 jobId = _createSubmitReject();
        vm.prank(arbiter);
        vm.expectRevert(AgentPact.InvalidBps.selector);
        pact.resolve(jobId, 10_001);
    }

    // =======================================================================
    // 10. resolveTimeout — arbiter-timeout path (#5) + reputation (#32)
    // =======================================================================

    /// #5 — dispute → warp 7 days → resolveTimeout → 50/50 split, Resolved
    function test_ResolveTimeout_HappyPath() public {
        uint256 jobId = _createSubmitReject();

        // Read disputedAt from job storage
        (, , , , , , , uint256 disputedAt, , ,) = pact.jobs(jobId);
        vm.warp(disputedAt + pact.ARBITER_TIMEOUT() + 1);

        uint256 beforeProvider = usdc.balanceOf(provider);
        uint256 beforeClient   = usdc.balanceOf(client);

        pact.resolveTimeout(jobId); // callable by anyone

        uint256 expectedProvider = AMOUNT / 2;
        uint256 expectedClient   = AMOUNT - expectedProvider;

        assertEq(usdc.balanceOf(provider), beforeProvider + expectedProvider);
        assertEq(usdc.balanceOf(client),   beforeClient   + expectedClient);

        (, , , , , , , , , , AgentPact.Status status) = pact.jobs(jobId);
        assertEq(uint8(status), uint8(AgentPact.Status.Resolved));
    }

    /// resolveTimeout emits JobResolved with providerBps == 5_000
    function test_ResolveTimeout_EmitsJobResolved() public {
        uint256 jobId = _createSubmitReject();
        (, , , , , , , uint256 disputedAt, , ,) = pact.jobs(jobId);
        vm.warp(disputedAt + pact.ARBITER_TIMEOUT() + 1);

        uint256 providerAmount = AMOUNT / 2;
        uint256 clientAmount   = AMOUNT - providerAmount;

        vm.expectEmit(true, false, false, true, address(pact));
        emit AgentPact.JobResolved(jobId, 5_000, providerAmount, clientAmount);
        pact.resolveTimeout(jobId);
    }

    /// #32 — reputation after resolveTimeout: completed=1, totalEarned=50%
    function test_ResolveTimeout_ReputationUpdated() public {
        uint256 jobId = _createSubmitReject();
        (, , , , , , , uint256 disputedAt, , ,) = pact.jobs(jobId);
        vm.warp(disputedAt + pact.ARBITER_TIMEOUT() + 1);

        pact.resolveTimeout(jobId);

        uint256 expectedEarned = AMOUNT / 2;
        (uint256 completed, , uint256 earned) = pact.getProviderStats(provider);
        assertEq(completed, 1);
        assertEq(earned,    expectedEarned);
    }

    /// #11 — resolveTimeout before ARBITER_TIMEOUT elapses
    function test_ResolveTimeout_Revert_TimeoutNotReached() public {
        uint256 jobId = _createSubmitReject();
        // do NOT warp past timeout
        vm.expectRevert(AgentPact.ArbiterTimeoutNotReached.selector);
        pact.resolveTimeout(jobId);
    }

    /// resolveTimeout on non-Disputed status reverts
    function test_ResolveTimeout_Revert_WrongStatus() public {
        uint256 jobId = _createAndSubmit(); // status = Submitted, not Disputed
        vm.expectRevert(AgentPact.WrongStatus.selector);
        pact.resolveTimeout(jobId);
    }

    // =======================================================================
    // 11. getProviderStats — initial zero state
    // =======================================================================

    function test_GetProviderStats_InitiallyZero() public view {
        (uint256 completed, uint256 disputed, uint256 earned) = pact.getProviderStats(stranger);
        assertEq(completed, 0);
        assertEq(disputed,  0);
        assertEq(earned,    0);
    }

    // =======================================================================
    // 12. Fuzz — key arithmetic: bps split integrity
    // =======================================================================

    /// Fuzz: provider + client amounts always sum to the original AMOUNT
    function testFuzz_Resolve_SplitSumsToAmount(uint256 providerBps) public {
        providerBps = bound(providerBps, 0, 10_000);

        uint256 jobId = _createSubmitReject();

        uint256 beforeProvider = usdc.balanceOf(provider);
        uint256 beforeClient   = usdc.balanceOf(client);

        vm.prank(arbiter);
        pact.resolve(jobId, providerBps);

        uint256 gainedProvider = usdc.balanceOf(provider) - beforeProvider;
        uint256 gainedClient   = usdc.balanceOf(client)   - beforeClient;

        assertEq(gainedProvider + gainedClient, AMOUNT, "split must sum to total");
    }

    /// Fuzz: arbitrary amount, 70/30 split always sums correctly
    function testFuzz_Resolve_ArbitraryAmount(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e6); // 1 unit to 1M USDC

        // Mint extra to client for this fuzz run
        usdc.mint(client, amount);
        // approval already set to max in setUp

        vm.prank(client);
        uint256 jobId = pact.createJob(
            provider,
            arbiter,
            amount,
            block.timestamp + DELIVERY_PERIOD,
            REVIEW_PERIOD,
            SPEC_HASH
        );

        vm.prank(provider);
        pact.submitResult(jobId, RESULT_HASH);

        vm.prank(client);
        pact.reject(jobId);

        uint256 beforeProvider = usdc.balanceOf(provider);
        uint256 beforeClient   = usdc.balanceOf(client);

        vm.prank(arbiter);
        pact.resolve(jobId, 7_000);

        uint256 gainedProvider = usdc.balanceOf(provider) - beforeProvider;
        uint256 gainedClient   = usdc.balanceOf(client)   - beforeClient;

        assertEq(gainedProvider + gainedClient, amount, "no USDC lost in split");
    }

    // =======================================================================
    // 13. Invariant — pact contract USDC balance ≥ sum of all active escrows
    // =======================================================================

    /// We use a simple balance-conservation check: after a complete lifecycle,
    /// the pact contract holds 0 USDC (all funds disbursed).
    function test_Invariant_ZeroBalanceAfterFullLifecycle_Approve() public {
        uint256 jobId = _createAndSubmit();
        vm.prank(client);
        pact.approve(jobId);
        assertEq(usdc.balanceOf(address(pact)), 0);
    }

    function test_Invariant_ZeroBalanceAfterFullLifecycle_Refund() public {
        uint256 jobId = _createJob();
        vm.warp(block.timestamp + DELIVERY_PERIOD + 1);
        vm.prank(client);
        pact.refundExpired(jobId);
        assertEq(usdc.balanceOf(address(pact)), 0);
    }

    function test_Invariant_ZeroBalanceAfterFullLifecycle_Resolve() public {
        uint256 jobId = _createSubmitReject();
        (, , , , , , , uint256 disputedAt, , ,) = pact.jobs(jobId);
        vm.prank(arbiter);
        pact.resolve(jobId, 5_000);
        assertEq(usdc.balanceOf(address(pact)), 0);
    }

    function test_Invariant_ZeroBalanceAfterFullLifecycle_ResolveTimeout() public {
        uint256 jobId = _createSubmitReject();
        (, , , , , , , uint256 disputedAt, , ,) = pact.jobs(jobId);
        vm.warp(disputedAt + pact.ARBITER_TIMEOUT() + 1);
        pact.resolveTimeout(jobId);
        assertEq(usdc.balanceOf(address(pact)), 0);
    }

    function test_Invariant_ZeroBalanceAfterFullLifecycle_ClaimAfterReview() public {
        uint256 jobId = _createAndSubmit();
        (, , , , , uint256 reviewPeriod, uint256 submittedAt, , , ,) = pact.jobs(jobId);
        vm.warp(submittedAt + reviewPeriod + 1);
        vm.prank(provider);
        pact.claimAfterReview(jobId);
        assertEq(usdc.balanceOf(address(pact)), 0);
    }

    // =======================================================================
    // 14. Multi-job — jobCount increments correctly
    // =======================================================================

    function test_MultiJob_JobCountIncrements() public {
        _createJob();
        _createJob();
        assertEq(pact.jobCount(), 2);
    }

    function test_MultiJob_ReputationAccumulates() public {
        // Two separate jobs, both approved → completed = 2, earned = 2 * AMOUNT
        uint256 job1 = _createAndSubmit();
        vm.prank(client);
        pact.approve(job1);

        uint256 job2 = _createAndSubmit();
        vm.prank(client);
        pact.approve(job2);

        (uint256 completed, , uint256 earned) = pact.getProviderStats(provider);
        assertEq(completed, 2);
        assertEq(earned,    2 * AMOUNT);
    }
}
