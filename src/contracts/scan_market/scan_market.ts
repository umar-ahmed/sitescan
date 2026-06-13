/**************************************************************
 * THIS FILE IS GENERATED AND SHOULD NOT BE MANUALLY MODIFIED *
 **************************************************************/


/**
 * Proof of Scan - decentralized URL scan marketplace.
 * 
 * Flow:
 * 
 * - A requester posts a scan job, escrowing a SUI reward against a target URL and
 *   a set of vantage parameters (geo / device / browser). The job asks for
 *   `max_submissions` independent scans.
 * - The job id is registered in a shared `Market` so any node can discover it.
 * - Scan nodes each render the URL, upload the screenshot + HTML to Walrus, and
 *   submit the resulting blob ids. Every submission is paid an equal portion of
 *   the reward; the final submission also sweeps any rounding remainder.
 * - When `max_submissions` is reached the job is completed. An open job can be
 *   cancelled by the requester, refunding the remaining balance.
 */

import { MoveStruct, normalizeMoveArguments, type RawTransactionArgument } from '../utils/index.js';
import { bcs } from '@mysten/sui/bcs';
import { type Transaction } from '@mysten/sui/transactions';
import * as balance from './deps/sui/balance.js';
const $moduleName = '@local-pkg/scan_market::scan_market';
export const Market = new MoveStruct({ name: `${$moduleName}::Market`, fields: {
        id: bcs.Address,
        jobs: bcs.vector(bcs.Address)
    } });
export const Submission = new MoveStruct({ name: `${$moduleName}::Submission`, fields: {
        worker: bcs.Address,
        screenshot_blob_id: bcs.string(),
        html_blob_id: bcs.string(),
        paid: bcs.u64()
    } });
export const ScanJob = new MoveStruct({ name: `${$moduleName}::ScanJob`, fields: {
        id: bcs.Address,
        requester: bcs.Address,
        url: bcs.string(),
        params: bcs.string(),
        reward: balance.Balance,
        reward_total: bcs.u64(),
        max_submissions: bcs.u64(),
        submissions: bcs.vector(Submission),
        status: bcs.u8()
    } });
export const JobPosted = new MoveStruct({ name: `${$moduleName}::JobPosted`, fields: {
        job_id: bcs.Address,
        requester: bcs.Address,
        reward_total: bcs.u64(),
        max_submissions: bcs.u64()
    } });
export const ScanSubmitted = new MoveStruct({ name: `${$moduleName}::ScanSubmitted`, fields: {
        job_id: bcs.Address,
        worker: bcs.Address,
        screenshot_blob_id: bcs.string(),
        html_blob_id: bcs.string(),
        paid: bcs.u64()
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
/** Post a scan job, escrowing `reward` for `max_submissions` independent scans. */
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
}
export interface SubmitScanOptions {
    package?: string;
    arguments: SubmitScanArguments | [
        job: RawTransactionArgument<string>,
        screenshotBlobId: RawTransactionArgument<string>,
        htmlBlobId: RawTransactionArgument<string>
    ];
}
/** Submit a completed scan (Walrus blob ids); pays an equal portion of the reward. */
export function submitScan(options: SubmitScanOptions) {
    const packageAddress = options.package ?? '@local-pkg/scan_market';
    const argumentsTypes = [
        null,
        '0x1::string::String',
        '0x1::string::String'
    ] satisfies (string | null)[];
    const parameterNames = ["job", "screenshotBlobId", "htmlBlobId"];
    return (tx: Transaction) => tx.moveCall({
        package: packageAddress,
        module: 'scan_market',
        function: 'submit_scan',
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