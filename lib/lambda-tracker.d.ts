import { OrchestratorInput } from './lambda-common';
/**
 * Default time-to-live for job records in DynamoDB. GitHub jobs can wait up to 24 hours to get a runner. This adds some margin.
 *
 * If we accidentally provision a runner, that's expensive. Keeping a small record in DynamoDB for a few days is cheaper.
 *
 * @internal
 */
export declare const DEFAULT_TRACKER_TTL_SECONDS: number;
/**
 * A runner told us it picked up a job. Sent by the runners themselves, from a job started hook, and read out of
 * their logs. Also sent by the webhook handler for workflow_job.in_progress events.
 *
 * GitHub never tells a runner which job it's running, so this carries the workflow run instead. Combined with the
 * runner name it's enough to ask GitHub for the job id.
 *
 * @internal
 */
export interface RunnerReportMessage {
    readonly kind: 'report';
    readonly runnerName: string;
    readonly repo: string;
    readonly workflowId: number;
    readonly jobId?: number;
}
/**
 * Remember that we started a runner for this job. Written before the step function starts, so it's always there by
 * the time GitHub could possibly hand the runner a job.
 *
 * Runner labels tell whether that runner can run another job of ours instead. The job URL is for whoever is reading the table during an
 * incident. TTL is used for cleanup.
 *
 * @internal
 */
export declare function recordControlledJob(input: OrchestratorInput): Promise<void>;
/**
 * Forget we started a runner for this job. Used when we take that runner away before it ever got the job, so the job
 * no longer has a runner of ours. If one of our other runners picks it up later, that runner was stolen.
 *
 * @internal
 */
export declare function forgetControlledJob(jobId: number): Promise<void>;
/**
 * Remember that we know what happened to this runner's job. Either the runner reported a job, or the runner is gone and we already forgot
 * the job left without a runner because of it.
 *
 * @internal
 */
export declare function recordRunnerAccounted(runnerName: string, jobId?: number): Promise<void>;
/**
 * Do we know what happened to this runner's job?
 *
 * @internal
 */
export declare function isRunnerAccounted(runnerName: string): Promise<boolean>;
/**
 * Labels of the runner we started for this job, or undefined if we didn't start one.
 *
 * @internal
 */
export declare function controlledJobRunnerLabels(jobId: number): Promise<string[] | undefined>;
