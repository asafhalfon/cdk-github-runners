import * as AWSLambda from 'aws-lambda';
export interface WarmRunnerKeeperMessage {
    readonly executionArn: string;
    readonly runnerName: string;
    readonly owner: string;
    readonly repo: string;
    readonly installationId?: number;
    readonly providerPath: string;
    readonly providerLabels: string[];
    readonly absoluteDeadline: number;
    readonly configHash: string;
}
/**
 * @internal
 */
export interface WarmRunnerFillPayload {
    readonly action: 'fill';
    readonly providerPath: string;
    readonly providerLabels: string[];
    readonly count: number;
    readonly duration: number;
    readonly owner: string;
    readonly repo: string;
    readonly configHash: string;
}
/**
 * Warm runner manager Lambda - handles three invocation modes:
 *
 * 1. CloudFormation Custom Resource - triggered on stack deploy (Create/Update) for AlwaysOnWarmRunner only. Runs
 *    runFiller with deadline = next midnight UTC so runners last until the next cron fill. Delete is a no-op.
 * 2. SQS messages - fill or keeper
 *    - Fill - from EventBridge cron. Uses messageId for deterministic execution names (idempotent on redelivery).
 *    - Keeper - tracks one runner. Uses SQS message cycling for periodic checks.
 *      Each message tracks one warm runner. The keeper checks:
 *      - Past deadline - stop the Step Function and delete the runner.
 *      - Config hash - if the message's `configHash` doesn't match the current `WARM_CONFIG_HASHES` env var, the runner is from a stale config - stop it and discard the message without replacement.
 *      - Busy/finished - if the Step Function ended or the GitHub runner is busy (took a job), start a replacement runner (inheriting the same deadline and config hash).
 *      - Not found yet (runner/infrastructure still starting) - retry later (message goes back to queue).
 *      - Still idle - retry later to check again.
 */
export declare function handler(event: AWSLambda.SQSEvent | AWSLambda.CloudFormationCustomResourceEvent): Promise<AWSLambda.SQSBatchResponse | undefined>;
