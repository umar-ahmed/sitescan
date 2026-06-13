/// Proof of Scan - decentralized URL scan marketplace.
///
/// Flow:
/// - A requester posts a scan job, escrowing a SUI reward against a target URL
///   and a set of vantage parameters (geo / device / browser). The job asks for
///   `max_submissions` independent scans.
/// - The job id is registered in a shared `Market` so any node can discover it.
/// - Scan nodes each render the URL, upload the screenshot + HTML to Walrus, and
///   submit the resulting blob ids. Every submission is paid an equal portion of
///   the reward; the final submission also sweeps any rounding remainder.
/// - When `max_submissions` is reached the job is completed. An open job can be
///   cancelled by the requester, refunding the remaining balance.
module scan_market::scan_market {
    use std::string::String;
    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::sui::SUI;

    const STATUS_OPEN: u8 = 0;
    const STATUS_COMPLETED: u8 = 1;
    const STATUS_CANCELLED: u8 = 2;

    const EJobNotOpen: u64 = 0;
    const ENotRequester: u64 = 1;
    const EJobFull: u64 = 2;
    const EInvalidSlots: u64 = 3;

    /// Shared registry of every job posted to the market.
    public struct Market has key {
        id: UID,
        jobs: vector<ID>,
    }

    /// A single scan submitted by a node.
    public struct Submission has store, copy, drop {
        worker: address,
        screenshot_blob_id: String,
        html_blob_id: String,
        paid: u64,
    }

    /// A scan job. Shared so any node can submit to it.
    public struct ScanJob has key, store {
        id: UID,
        requester: address,
        url: String,
        params: String,
        reward: Balance<SUI>,
        reward_total: u64,
        max_submissions: u64,
        submissions: vector<Submission>,
        status: u8,
    }

    public struct JobPosted has copy, drop {
        job_id: ID,
        requester: address,
        reward_total: u64,
        max_submissions: u64,
    }

    public struct ScanSubmitted has copy, drop {
        job_id: ID,
        worker: address,
        screenshot_blob_id: String,
        html_blob_id: String,
        paid: u64,
    }

    public struct JobCompleted has copy, drop {
        job_id: ID,
    }

    fun init(ctx: &mut TxContext) {
        transfer::share_object(Market {
            id: object::new(ctx),
            jobs: vector[],
        });
    }

    /// Post a scan job, escrowing `reward` for `max_submissions` independent scans.
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
        let job = ScanJob {
            id: object::new(ctx),
            requester: ctx.sender(),
            url,
            params,
            reward: coin::into_balance(reward),
            reward_total,
            max_submissions,
            submissions: vector[],
            status: STATUS_OPEN,
        };
        let job_id = object::id(&job);
        market.jobs.push_back(job_id);
        event::emit(JobPosted { job_id, requester: ctx.sender(), reward_total, max_submissions });
        transfer::share_object(job);
    }

    /// Submit a completed scan (Walrus blob ids); pays an equal portion of the reward.
    public fun submit_scan(
        job: &mut ScanJob,
        screenshot_blob_id: String,
        html_blob_id: String,
        ctx: &mut TxContext,
    ) {
        assert!(job.status == STATUS_OPEN, EJobNotOpen);
        let filled = job.submissions.length();
        assert!(filled < job.max_submissions, EJobFull);

        let is_last = filled + 1 == job.max_submissions;
        let payout = if (is_last) {
            balance::withdraw_all(&mut job.reward)
        } else {
            balance::split(&mut job.reward, job.reward_total / job.max_submissions)
        };
        let paid = payout.value();
        let worker = ctx.sender();
        transfer::public_transfer(coin::from_balance(payout, ctx), worker);

        job.submissions.push_back(Submission {
            worker,
            screenshot_blob_id,
            html_blob_id,
            paid,
        });
        event::emit(ScanSubmitted {
            job_id: object::id(job),
            worker,
            screenshot_blob_id,
            html_blob_id,
            paid,
        });

        if (is_last) {
            job.status = STATUS_COMPLETED;
            event::emit(JobCompleted { job_id: object::id(job) });
        }
    }

    /// Cancel an open job and refund the remaining escrow to the requester.
    public fun cancel_job(job: &mut ScanJob, ctx: &mut TxContext) {
        assert!(job.status == STATUS_OPEN, EJobNotOpen);
        assert!(job.requester == ctx.sender(), ENotRequester);
        let refund = coin::from_balance(balance::withdraw_all(&mut job.reward), ctx);
        transfer::public_transfer(refund, job.requester);
        job.status = STATUS_CANCELLED;
    }
}
