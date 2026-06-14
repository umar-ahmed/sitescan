/// Proof of Scan - decentralized URL scan marketplace with verification-gated payouts.
///
/// Flow:
/// - A requester posts a scan job, escrowing a SUI reward against a target URL
///   and a set of vantage parameters (geo / device / browser). The job asks for
///   `max_submissions` independent, *verified* scans.
/// - The job id is registered in a shared `Market` so any node can discover it.
/// - Scan nodes each render the URL, upload the screenshot + HTML to Walrus, and
///   submit the resulting blob ids. A submission is recorded as PENDING and is
///   paid nothing yet.
/// - An independent verifier (the market `verifier` address) re-checks each
///   submission's TLSNotary proof and calls `resolve_scan` per submission.
///   Approved scans release their portion to the worker; rejected scans keep
///   their funds in escrow for a re-scan or later reclaim.
/// - A job completes once `max_submissions` scans are approved. The requester can
///   reclaim any remaining escrow (rejected-scan funds + rounding dust) once the
///   job is completed or cancelled.
module scan_market::scan_market {
    use std::string::{Self, String};
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::sui::SUI;

    const STATUS_OPEN: u8 = 0;
    const STATUS_COMPLETED: u8 = 1;
    const STATUS_CANCELLED: u8 = 2;

    const SUB_PENDING: u8 = 0;
    const SUB_APPROVED: u8 = 1;
    const SUB_REJECTED: u8 = 2;

    const EJobNotOpen: u64 = 0;
    const ENotRequester: u64 = 1;
    const EJobFull: u64 = 2;
    const EInvalidSlots: u64 = 3;
    const ENotVerifier: u64 = 4;
    const EBadIndex: u64 = 5;
    const ENotPending: u64 = 6;
    const EJobNotSettled: u64 = 7;
    const EAlreadySubmitted: u64 = 8;

    /// Shared registry of every job posted to the market.
    public struct Market has key {
        id: UID,
        jobs: vector<ID>,
        /// Address allowed to approve/reject scans (the verifier).
        verifier: address,
    }

    /// A single scan submitted by a node. Paid only once the verifier approves it.
    /// `verdict_reason` and `content_hash` are written by the verifier on resolve.
    public struct Submission has store, copy, drop {
        worker: address,
        screenshot_blob_id: String,
        html_blob_id: String,
        /// Walrus blob id of the TLSNotary presentation proving the HTML was
        /// served by the target host over TLS. Empty if the node submitted no proof.
        notary_proof_blob_id: String,
        /// Walrus blob id of the resolved ENS metadata, when the target is an ENS name.
        ens_metadata_blob_id: String,
        status: u8,
        paid: u64,
        verdict_reason: String,
        content_hash: String,
    }

    /// A scan job. Shared so any node can submit to it.
    public struct ScanJob has key, store {
        id: UID,
        requester: address,
        verifier: address,
        url: String,
        params: String,
        reward: Balance<SUI>,
        reward_total: u64,
        per_scan: u64,
        max_submissions: u64,
        approved_count: u64,
        pending_count: u64,
        submissions: vector<Submission>,
        status: u8,
        /// Cloaking summary written by the verifier across the job's scans.
        /// `cloaking_clusters` = 0 until computed.
        cloaking_clusters: u64,
        cloaking_detail: String,
    }

    public struct JobPosted has copy, drop {
        job_id: ID,
        requester: address,
        verifier: address,
        reward_total: u64,
        per_scan: u64,
        max_submissions: u64,
    }

    public struct ScanSubmitted has copy, drop {
        job_id: ID,
        index: u64,
        worker: address,
        screenshot_blob_id: String,
        html_blob_id: String,
        notary_proof_blob_id: String,
        ens_metadata_blob_id: String,
    }

    public struct ScanResolved has copy, drop {
        job_id: ID,
        index: u64,
        worker: address,
        approved: bool,
        paid: u64,
    }

    public struct CloakingRecorded has copy, drop {
        job_id: ID,
        clusters: u64,
        detail: String,
    }

    public struct JobCompleted has copy, drop {
        job_id: ID,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(Market {
            id: object::new(ctx),
            jobs: vector[],
            verifier: ctx.sender(),
        });
    }

    /// Post a scan job, escrowing `reward` for `max_submissions` verified scans.
    public fun post_job(
        market: &mut Market,
        reward: Coin<SUI>,
        url: String,
        params: String,
        max_submissions: u64,
        ctx: &mut TxContext,
    ) {
        assert!(max_submissions > 0, EInvalidSlots);
        let reward_total = coin::value(&reward);
        let per_scan = reward_total / max_submissions;
        let verifier = market.verifier;
        let job = ScanJob {
            id: object::new(ctx),
            requester: ctx.sender(),
            verifier,
            url,
            params,
            reward: coin::into_balance(reward),
            reward_total,
            per_scan,
            max_submissions,
            approved_count: 0,
            pending_count: 0,
            submissions: vector[],
            status: STATUS_OPEN,
            cloaking_clusters: 0,
            cloaking_detail: string::utf8(b""),
        };
        let job_id = object::id(&job);
        market.jobs.push_back(job_id);
        event::emit(JobPosted {
            job_id,
            requester: ctx.sender(),
            verifier,
            reward_total,
            per_scan,
            max_submissions,
        });
        transfer::share_object(job);
    }

    /// True if `worker` already has a submission recorded for this job.
    fun worker_has_submitted(job: &ScanJob, worker: address): bool {
        let mut i = 0;
        let n = job.submissions.length();
        while (i < n) {
            if (job.submissions.borrow(i).worker == worker) return true;
            i = i + 1;
        };
        false
    }

    /// Record a completed scan (Walrus blob ids) as PENDING. Pays nothing until
    /// the verifier approves it. New scans are accepted while the number of
    /// approved + pending scans is below `max_submissions`, so a rejected scan
    /// reopens a slot for a re-scan. Each worker may submit at most one scan per
    /// job, so `max_submissions` always reflects independent scanners.
    public fun submit_scan(
        job: &mut ScanJob,
        screenshot_blob_id: String,
        html_blob_id: String,
        notary_proof_blob_id: String,
        ens_metadata_blob_id: String,
        ctx: &mut TxContext,
    ) {
        assert!(job.status == STATUS_OPEN, EJobNotOpen);
        assert!(job.approved_count + job.pending_count < job.max_submissions, EJobFull);

        let worker = ctx.sender();
        assert!(!worker_has_submitted(job, worker), EAlreadySubmitted);
        let index = job.submissions.length();
        job.submissions.push_back(Submission {
            worker,
            screenshot_blob_id,
            html_blob_id,
            notary_proof_blob_id,
            ens_metadata_blob_id,
            status: SUB_PENDING,
            paid: 0,
            verdict_reason: string::utf8(b""),
            content_hash: string::utf8(b""),
        });
        job.pending_count = job.pending_count + 1;
        event::emit(ScanSubmitted {
            job_id: object::id(job),
            index,
            worker,
            screenshot_blob_id,
            html_blob_id,
            notary_proof_blob_id,
            ens_metadata_blob_id,
        });
    }

    /// Verifier-only. Approve a pending scan (release its portion to the worker)
    /// or reject it (funds stay in escrow). The job completes once
    /// `max_submissions` scans have been approved.
    public fun resolve_scan(
        job: &mut ScanJob,
        index: u64,
        approve: bool,
        verdict_reason: String,
        content_hash: String,
        ctx: &mut TxContext,
    ) {
        assert!(job.status == STATUS_OPEN, EJobNotOpen);
        assert!(ctx.sender() == job.verifier, ENotVerifier);
        assert!(index < job.submissions.length(), EBadIndex);

        let job_id = object::id(job);
        let sub_ref = job.submissions.borrow(index);
        assert!(sub_ref.status == SUB_PENDING, ENotPending);
        let worker = sub_ref.worker;

        job.pending_count = job.pending_count - 1;

        if (approve) {
            let payout = balance::split(&mut job.reward, job.per_scan);
            let paid = payout.value();
            transfer::public_transfer(coin::from_balance(payout, ctx), worker);

            let sub = job.submissions.borrow_mut(index);
            sub.status = SUB_APPROVED;
            sub.paid = paid;
            sub.verdict_reason = verdict_reason;
            sub.content_hash = content_hash;

            job.approved_count = job.approved_count + 1;
            event::emit(ScanResolved { job_id, index, worker, approved: true, paid });

            if (job.approved_count == job.max_submissions) {
                job.status = STATUS_COMPLETED;
                event::emit(JobCompleted { job_id });
            }
        } else {
            let sub = job.submissions.borrow_mut(index);
            sub.status = SUB_REJECTED;
            sub.verdict_reason = verdict_reason;
            sub.content_hash = content_hash;
            event::emit(ScanResolved { job_id, index, worker, approved: false, paid: 0 });
        }
    }

    /// Verifier-only. Record the cloaking summary computed across the job's scans
    /// (number of distinct content clusters + a human-readable detail).
    public fun set_cloaking(
        job: &mut ScanJob,
        clusters: u64,
        detail: String,
        ctx: &mut TxContext,
    ) {
        assert!(ctx.sender() == job.verifier, ENotVerifier);
        job.cloaking_clusters = clusters;
        job.cloaking_detail = detail;
        event::emit(CloakingRecorded { job_id: object::id(job), clusters, detail });
    }

    /// Cancel an open job and refund the remaining escrow to the requester.
    public fun cancel_job(job: &mut ScanJob, ctx: &mut TxContext) {
        assert!(job.status == STATUS_OPEN, EJobNotOpen);
        assert!(job.requester == ctx.sender(), ENotRequester);
        let refund = coin::from_balance(balance::withdraw_all(&mut job.reward), ctx);
        transfer::public_transfer(refund, job.requester);
        job.status = STATUS_CANCELLED;
    }

    /// Reclaim leftover escrow (rejected-scan funds + rounding dust) to the
    /// requester once the job is completed or cancelled.
    public fun reclaim_remainder(job: &mut ScanJob, ctx: &mut TxContext) {
        assert!(job.requester == ctx.sender(), ENotRequester);
        assert!(
            job.status == STATUS_COMPLETED || job.status == STATUS_CANCELLED,
            EJobNotSettled,
        );
        let refund = coin::from_balance(balance::withdraw_all(&mut job.reward), ctx);
        transfer::public_transfer(refund, job.requester);
    }
}
