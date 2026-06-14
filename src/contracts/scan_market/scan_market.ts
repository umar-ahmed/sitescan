/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/


/**
 * Proof of Scan - decentralized URL scan marketplace with verification-gated
 * payouts.
 * 
 * Flow:
 * 
 * - A requester posts a scan job, escrowing a SUI reward against a target URL and
 *   a set of vantage parameters (geo / device / browser). The job asks for
 *   `max_submissions` independent, _verified_ scans.
 * - The job id is registered in a shared `Market` so any node can discover it.
 * - Scan nodes each render the URL, upload the screenshot + HTML to Walrus, and
 *   submit the resulting blob ids. A submission is recorded as PENDING and is paid
 *   nothing yet.
 * - An independent verifier (the market `verifier` address) re-checks each
 *   submission's TLSNotary proof and calls `resolve_scan` per submission. Approved
 *   scans release their portion to the worker; rejected scans keep their funds in
 *   escrow for a re-scan or later reclaim.
 * - A job completes once `max_submissions` scans are approved. The requester can
 *   reclaim any remaining escrow (rejected-scan funds + rounding dust) once the
 *   job is completed or cancelled.
 */

import { MoveStruct, normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import { type Transaction } from '@mysten/sui/transactions';
import * as balance from './deps/sui/balance.js';
const $moduleName = '@local-pkg/scan_market::scan_market';
export const Market = new MoveStruct({ name: `${$moduleName}::Market`, fields: {
        id: bcs.Address,
        jobs: bcs.vector(bcs.Address),
        /** Address allowed to approve/reject scans (the verifier). */
        verifier: bcs.Address
    } });
export const Submission = new MoveStruct({ name: `${$moduleName}::Submission`, fields: {
        worker: bcs.Address,
        screenshot_blob_id: bcs.string(),
        html_blob_id: bcs.string(),
        /**
         * Walrus blob id of the TLSNotary presentation proving the HTML was served by the
         * target host over TLS. Empty if the node submitted no proof.
         */
        notary_proof_blob_id: bcs.string(),
        /** Walrus blob id of the resolved ENS metadata, when the target is an ENS name. */
        ens_metadata_blob_id: bcs.string(),
        status: bcs.u8(),
        paid: bcs.u64(),
        verdict_reason: bcs.string(),
        content_hash: bcs.string()
    } });
export const ScanJob = new MoveStruct({ name: `${$moduleName}::ScanJob`, fields: {
        id: bcs.Address,
        requester: bcs.Address,
        verifier: bcs.Address,
        url: bcs.string(),
        params: bcs.string(),
        reward: balance.Balance,
        reward_total: bcs.u64(),
        per_scan: bcs.u64(),
        max_submissions: bcs.u64(),
        approved_count: bcs.u64(),
        pending_count: bcs.u64(),
        submissions: bcs.vector(Submission),
        status: bcs.u8(),
        /**
         * Cloaking summary written by the verifier across the job's scans.
         * `cloaking_clusters` = 0 until computed.
         */
        cloaking_clusters: bcs.u64(),
        cloaking_detail: bcs.string()
    } });
export const JobPosted = new MoveStruct({ name: `${$moduleName}::JobPosted`, fields: {
        job_id: bcs.Address,
        requester: bcs.Address,
        verifier: bcs.Address,
        reward_total: bcs.u64(),
        per_scan: bcs.u64(),
        max_submissions: bcs.u64()
    } });
export const ScanSubmitted = new MoveStruct({ name: `${$moduleName}::ScanSubmitted`, fields: {
        job_id: bcs.Address,
        index: bcs.u64(),
        worker: bcs.Address,
        screenshot_blob_id: bcs.string(),
        html_blob_id: bcs.string(),
        notary_proof_blob_id: bcs.string(),
        ens_metadata_blob_id: bcs.string()
    } });
export const ScanResolved = new MoveStruct({ name: `${$moduleName}::ScanResolved`, fields: {
        job_id: bcs.Address,
        index: bcs.u64(),
        worker: bcs.Address,
        approved: bcs.bool(),
        paid: bcs.u64()
    } });
export const CloakingRecorded = new MoveStruct({ name: `${$moduleName}::CloakingRecorded`, fields: {
        job_id: bcs.Address,
        clusters: bcs.u64(),
        detail: bcs.string()
    } });
export const JobCompleted = new MoveStruct({ name: `${$moduleName}::JobCompleted`, fields: {
        job_id: bcs.Address
    } });
export interface PostJobArguments {
    market: RawTransactionArgument<string>;
    reward: RawTransactionArgument<string>;
    url: RawTransactionArgument<string>;
    params: RawTransactionArgument<string>;
    maxSubmissions: RawTransactionArgument<number | bigint>;
}
export interface PostJobOptions {
    package?: string;
    arguments: PostJobArguments | [
        market: RawTransactionArgument<string>,
        reward: RawTransactionArgument<string>,
        url: RawTransactionArgument<string>,
        params: RawTransactionArgument<string>,
        maxSubmissions: RawTransactionArgument<number | bigint>
    ];
}
/** Post a scan job, escrowing `reward` for `max_submissions` verified scans. */
export function postJob(options: PostJobOptions) {
    const packageAddress = options.package ?? '@local-pkg/scan_market';
    const argumentsTypes = [
        null,
        null,
        '0x1::string::String',
        '0x1::string::String',
        'u64'
    ] satisfies (string | null)[];
    const parameterNames = ["market", "reward", "url", "params", "maxSubmissions"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'scan_market',
        function: 'post_job',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface SubmitScanArguments {
    job: RawTransactionArgument<string>;
    screenshotBlobId: RawTransactionArgument<string>;
    htmlBlobId: RawTransactionArgument<string>;
    notaryProofBlobId: RawTransactionArgument<string>;
    ensMetadataBlobId: RawTransactionArgument<string>;
}
export interface SubmitScanOptions {
    package?: string;
    arguments: SubmitScanArguments | [
        job: RawTransactionArgument<string>,
        screenshotBlobId: RawTransactionArgument<string>,
        htmlBlobId: RawTransactionArgument<string>,
        notaryProofBlobId: RawTransactionArgument<string>,
        ensMetadataBlobId: RawTransactionArgument<string>
    ];
}
/**
 * Record a completed scan (Walrus blob ids) as PENDING. Pays nothing until the
 * verifier approves it. New scans are accepted while the number of approved +
 * pending scans is below `max_submissions`, so a rejected scan reopens a slot for
 * a re-scan. Each worker may submit at most one scan per job, so `max_submissions`
 * always reflects independent scanners.
 */
export function submitScan(options: SubmitScanOptions) {
    const packageAddress = options.package ?? '@local-pkg/scan_market';
    const argumentsTypes = [
        null,
        '0x1::string::String',
        '0x1::string::String',
        '0x1::string::String',
        '0x1::string::String'
    ] satisfies (string | null)[];
    const parameterNames = ["job", "screenshotBlobId", "htmlBlobId", "notaryProofBlobId", "ensMetadataBlobId"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'scan_market',
        function: 'submit_scan',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface ResolveScanArguments {
    job: RawTransactionArgument<string>;
    index: RawTransactionArgument<number | bigint>;
    approve: RawTransactionArgument<boolean>;
    verdictReason: RawTransactionArgument<string>;
    contentHash: RawTransactionArgument<string>;
}
export interface ResolveScanOptions {
    package?: string;
    arguments: ResolveScanArguments | [
        job: RawTransactionArgument<string>,
        index: RawTransactionArgument<number | bigint>,
        approve: RawTransactionArgument<boolean>,
        verdictReason: RawTransactionArgument<string>,
        contentHash: RawTransactionArgument<string>
    ];
}
/**
 * Verifier-only. Approve a pending scan (release its portion to the worker) or
 * reject it (funds stay in escrow). The job completes once `max_submissions` scans
 * have been approved.
 */
export function resolveScan(options: ResolveScanOptions) {
    const packageAddress = options.package ?? '@local-pkg/scan_market';
    const argumentsTypes = [
        null,
        'u64',
        'bool',
        '0x1::string::String',
        '0x1::string::String'
    ] satisfies (string | null)[];
    const parameterNames = ["job", "index", "approve", "verdictReason", "contentHash"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'scan_market',
        function: 'resolve_scan',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface SetCloakingArguments {
    job: RawTransactionArgument<string>;
    clusters: RawTransactionArgument<number | bigint>;
    detail: RawTransactionArgument<string>;
}
export interface SetCloakingOptions {
    package?: string;
    arguments: SetCloakingArguments | [
        job: RawTransactionArgument<string>,
        clusters: RawTransactionArgument<number | bigint>,
        detail: RawTransactionArgument<string>
    ];
}
/**
 * Verifier-only. Record the cloaking summary computed across the job's scans
 * (number of distinct content clusters + a human-readable detail).
 */
export function setCloaking(options: SetCloakingOptions) {
    const packageAddress = options.package ?? '@local-pkg/scan_market';
    const argumentsTypes = [
        null,
        'u64',
        '0x1::string::String'
    ] satisfies (string | null)[];
    const parameterNames = ["job", "clusters", "detail"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'scan_market',
        function: 'set_cloaking',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface CancelJobArguments {
    job: RawTransactionArgument<string>;
}
export interface CancelJobOptions {
    package?: string;
    arguments: CancelJobArguments | [
        job: RawTransactionArgument<string>
    ];
}
/** Cancel an open job and refund the remaining escrow to the requester. */
export function cancelJob(options: CancelJobOptions) {
    const packageAddress = options.package ?? '@local-pkg/scan_market';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["job"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'scan_market',
        function: 'cancel_job',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}
export interface ReclaimRemainderArguments {
    job: RawTransactionArgument<string>;
}
export interface ReclaimRemainderOptions {
    package?: string;
    arguments: ReclaimRemainderArguments | [
        job: RawTransactionArgument<string>
    ];
}
/**
 * Reclaim leftover escrow (rejected-scan funds + rounding dust) to the requester
 * once the job is completed or cancelled.
 */
export function reclaimRemainder(options: ReclaimRemainderOptions) {
    const packageAddress = options.package ?? '@local-pkg/scan_market';
    const argumentsTypes = [
        null
    ] satisfies (string | null)[];
    const parameterNames = ["job"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'scan_market',
        function: 'reclaim_remainder',
        arguments: normalizeMoveArguments(options.arguments, argumentsTypes, parameterNames),
    });
}