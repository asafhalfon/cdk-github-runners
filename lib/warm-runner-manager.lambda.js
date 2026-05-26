"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
/**
 * Warm Runner Manager Lambda
 *
 * Maintains a pool of pre-provisioned ("warm") GitHub self-hosted runners so jobs
 * start with near-zero latency instead of waiting for a fresh runner to provision.
 *
 * ## Lifecycle
 *
 * 1. **Fill** — An EventBridge cron rule (midnight UTC for always-on, or window
 *    start for scheduled) sends a fill payload to the shared SQS queue. For
 *    AlwaysOnWarmRunner only, a CloudFormation custom resource (on deploy)
 *    invokes this Lambda directly to fill immediately; the deadline is set to
 *    the next midnight UTC (not full 24h) so runners last until the next cron
 *    fill. ScheduledWarmRunner has no deployment-fill — first fill is at the
 *    next schedule occurrence.
 *
 * 2. **Keeper** — Each keeper message tracks one runner. The SQS queue delivers the
 *    message, this Lambda inspects the runner, and one of the following happens:
 *    - Runner is past its deadline → the keeper stops the Step Function and deletes
 *      the runner. No replacement is created.
 *    - Runner is idle and within deadline → message is returned to the queue
 *      (via batch item failure) to be checked again after the visibility timeout.
 *    - Runner is busy or its Step Function finished → a replacement runner is
 *      started with the same deadline, and a new keeper message is enqueued.
 *    - Config hash mismatch (config was changed/removed since this runner was
 *      created) → the runner is stopped and deleted. No replacement is created.
 *      This is how old runners are cleaned up quickly on config changes.
 *
 * 3. **Shutdown mechanisms** — The keeper is the primary mechanism for enforcing the
 *    absolute deadline: when a runner is past its deadline, the keeper stops the
 *    Step Function and deletes the runner. Fallbacks:
 *    - **Idle reaper**: Measures idle time from runner *registration* (cdkghr:started
 *      label), not step function start. So it fires at deadline + provisioning delay.
 *      It's a fallback if the keeper misses a message; it does not enforce the
 *      absolute deadline precisely.
 *    - **Step Function idle timeout**: Each runner is started with `maxIdleSeconds`
 *      matching the deadline. If both keeper and idle reaper miss it, the Step
 *      Function will self-terminate when its idle timeout fires.
 *
 * ## Config hash
 *
 * Each warm runner config (provider, count, labels, owner, repo, duration) is
 * hashed at CDK synth time. All current hashes are stored in the WARM_CONFIG_HASHES
 * environment variable. Fill payloads and keeper messages carry the hash. When the
 * keeper processes a message whose hash is not in the current set, it knows the
 * config was changed or removed and stops the runner immediately. This helps quickly
 * get rid of stale runners while keeping over-provisioning to a minimum.
 *
 * ## Gotchas
 *
 * - Keeper messages rely on SQS redelivery (batch item failure) for periodic
 *   checking. The visibility timeout (1 min) determines how often runners are
 *   polled. Failed messages are retried until they succeed or the runner
 *   self-terminates at its idle timeout.
 * - Each fill unconditionally starts `count` runners — it does not check how many
 *   are already running. On cron fire, this creates a brief overlap with the
 *   previous cycle's runners (which are near their deadline).
 * - Removing all warm runners configurations may result in warm runners staying
 *   around until they expire. To remove all warm runners quickly, set count to 0
 *   and deploy. Only once all the warm runners are stopped, you can remove all
 *   configurations and deploy again.
 * - **Gaps in coverage**: The Step Function that provisions each warm runner uses
 *   increasing timeouts between retries for provider failures (CodeBuild timeout,
 *   Lambda timeout, capacity errors, etc.). While a warm runner slot is retrying,
 *   that slot has no runner. This may create gaps in coverage. An idle warm runner
 *   that fails to provision (or whose replacement fails) will be unavailable until
 *   the retry succeeds. Current retry mechanism has built-in back-off rate and can
 *   be tweaked using `retryOptions`. This will be improved in the future.
 */
const crypto = require("crypto");
const client_sfn_1 = require("@aws-sdk/client-sfn");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const lambda_github_1 = require("./lambda-github");
const lambda_helpers_1 = require("./lambda-helpers");
const sfn = new client_sfn_1.SFNClient();
const sqs = new client_sqs_1.SQSClient();
const SFN_EXECUTION_NAME_MAX_LENGTH = 80;
function isSqsEvent(event) {
    return Array.isArray(event.Records);
}
function isFillInput(event) {
    return typeof event === 'object' && event !== null && event.action === 'fill';
}
function isCustomResourceEvent(event) {
    const e = event;
    return typeof e?.RequestType === 'string' && typeof e?.ResponseURL === 'string';
}
function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing environment variable ${name}`);
    }
    return value;
}
/**
 * Deterministic execution name for idempotent fills. Same seed → same name, so retries
 * (custom resource, SQS redelivery) don't create duplicate runners.
 */
function deterministicExecutionName(providerPath, seed) {
    const pathWithoutStack = providerPath.split('/').slice(1).join('/') || providerPath;
    const sanitized = `warm-${pathWithoutStack.replace(/[^a-zA-Z0-9-]/g, '-')}`;
    const hash = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
    const maxPrefixLen = SFN_EXECUTION_NAME_MAX_LENGTH - hash.length - 1;
    return `${sanitized.slice(0, maxPrefixLen)}-${hash}`;
}
/** Returns Unix ms of the next midnight UTC. Used for AlwaysOn deployment-fill deadline. */
function getNextMidnightUtcMs() {
    const now = new Date();
    const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
    return nextMidnight.getTime();
}
/** Find installation id for our app. Normal code path gets this from the webhook payload, but we schedule these ourselves. */
async function resolveInstallationId(owner, repo) {
    const appOctokit = await (0, lambda_github_1.getAppOctokit)();
    if (!appOctokit) {
        return undefined; // PAT authentication
    }
    if (repo) {
        const { data } = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });
        return data.id;
    }
    else {
        const { data } = await appOctokit.rest.apps.getOrgInstallation({ org: owner });
        return data.id;
    }
}
/** Start a warm runner and enqueue a keeper message using SQS. */
async function startWarmRunnerAndEnqueueKeeper(input) {
    const stepFunctionArn = requireEnv('STEP_FUNCTION_ARN');
    const queueUrl = requireEnv('WARM_RUNNER_QUEUE_URL');
    const remainingSeconds = Math.floor((input.absoluteDeadline - Date.now()) / 1000);
    if (remainingSeconds <= 0) {
        console.log({
            notice: 'Absolute deadline already passed; not starting replacement',
            configHash: input.configHash,
            runnerName: input.executionName,
            input,
        });
        return;
    }
    let executionArn;
    try {
        const result = await sfn.send(new client_sfn_1.StartExecutionCommand({
            stateMachineArn: stepFunctionArn,
            name: input.executionName,
            input: JSON.stringify({
                owner: input.owner,
                repo: input.repo || '',
                jobId: -1,
                jobUrl: '',
                installationId: input.installationId ?? -1,
                jobLabels: input.providerLabels.join(','),
                provider: input.providerPath,
                labels: [...input.providerLabels, 'cdkghr:warm'].join(','),
                maxIdleSeconds: remainingSeconds,
            }),
        }));
        executionArn = result.executionArn;
    }
    catch (e) {
        if (e instanceof client_sfn_1.ExecutionAlreadyExists) {
            // Idempotent retry: execution was already started (e.g. Lambda timed out mid-fill).
            // Don't enqueue. The first attempt already did, so duplicate keeper messages would cause duplicate replacements.
            console.log({
                notice: 'ExecutionAlreadyExists — idempotent retry, skipping enqueue',
                configHash: input.configHash,
                slot: input.slot,
                runnerName: input.executionName,
            });
            return;
        }
        else {
            throw e;
        }
    }
    const message = {
        executionArn,
        runnerName: input.executionName,
        owner: input.owner,
        repo: input.repo,
        installationId: input.installationId,
        providerPath: input.providerPath,
        providerLabels: input.providerLabels,
        absoluteDeadline: input.absoluteDeadline,
        configHash: input.configHash,
    };
    await sqs.send(new client_sqs_1.SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
    }));
    console.log({
        notice: 'Started warm runner and enqueued keeper message',
        configHash: input.configHash,
        slot: input.slot,
        runnerName: input.executionName,
        executionArn,
        remainingSeconds,
    });
}
/**
 * Unconditionally starts `count` warm runners for the given config and enqueues keeper messages.
 *
 * @param input the fill payload
 * @param getNameForSlot a function to generate a unique and stable execution name for each slot
 * @param source the source of the fill for debugging purposes
 * @param absoluteDeadlineOverride if provided, use this instead of now + duration (for AlwaysOn deployment-fill)
 */
async function runFiller(input, getNameForSlot, source, absoluteDeadlineOverride) {
    const installationId = await resolveInstallationId(input.owner, input.repo);
    const absoluteDeadline = absoluteDeadlineOverride ?? Date.now() + input.duration * 1000;
    for (let i = 0; i < input.count; i++) {
        await startWarmRunnerAndEnqueueKeeper({
            providerPath: input.providerPath,
            providerLabels: input.providerLabels,
            owner: input.owner,
            repo: input.repo,
            installationId,
            absoluteDeadline,
            configHash: input.configHash,
            executionName: getNameForSlot(i),
            slot: i,
        });
    }
    console.log({
        notice: 'Fill complete - started warm runners',
        source,
        configHash: input.configHash,
        providerPath: input.providerPath,
        started: input.count,
    });
}
/** Stop the step function and delete the runner from GitHub. */
async function stopAndDeleteRunner(input, octokit, secrets, reason) {
    try {
        await sfn.send(new client_sfn_1.StopExecutionCommand({
            executionArn: input.executionArn,
            error: reason,
            cause: 'Warm runner stopped by keeper',
        }));
    }
    catch (e) {
        console.error({
            notice: 'Failed to stop step function',
            configHash: input.configHash,
            runnerName: input.runnerName,
            executionArn: input.executionArn,
            error: e,
            input,
        });
    }
    const runner = await (0, lambda_github_1.getRunner)(octokit, secrets.runnerLevel, input.owner, input.repo, input.runnerName);
    if (runner) {
        try {
            await (0, lambda_github_1.deleteRunner)(octokit, secrets.runnerLevel, input.owner, input.repo, runner.id);
        }
        catch (e) {
            console.error({
                notice: 'Failed to delete runner',
                configHash: input.configHash,
                runnerName: input.runnerName,
                runnerId: runner.id,
                error: e,
                input,
            });
        }
    }
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
async function handler(event) {
    if (isCustomResourceEvent(event)) {
        const physicalId = ('PhysicalResourceId' in event ? event.PhysicalResourceId : undefined) ?? event.LogicalResourceId;
        try {
            const props = event.ResourceProperties;
            console.log({
                notice: 'Custom resource fill',
                requestType: event.RequestType,
                logicalResourceId: event.LogicalResourceId,
                configHash: props.configHash,
                providerPath: props.providerPath,
                count: props.count,
            });
            if (event.RequestType === 'Create' || event.RequestType === 'Update') {
                const getNameForSlot = (slot) => deterministicExecutionName(props.providerPath, `${event.LogicalResourceId}:${event.RequestType}:${props.configHash}:${slot}`);
                const deadline = getNextMidnightUtcMs();
                await runFiller(props, getNameForSlot, 'customResource', deadline);
            }
            await (0, lambda_helpers_1.customResourceRespond)(event, 'SUCCESS', 'OK', physicalId, {});
        }
        catch (e) {
            console.error({ notice: 'Custom resource handler failed', error: e });
            await (0, lambda_helpers_1.customResourceRespond)(event, 'FAILED', e.message || 'Internal Error', physicalId, {});
        }
        return;
    }
    if (!isSqsEvent(event)) {
        console.error({ notice: 'Unknown event type; ignoring', event });
        return;
    }
    const validHashes = new Set((process.env.WARM_CONFIG_HASHES ?? '').split(',').filter(Boolean));
    const result = { batchItemFailures: [] };
    const octokitCache = new Map();
    for (const record of event.Records) {
        let body;
        try {
            body = JSON.parse(record.body);
        }
        catch (e) {
            console.error({
                notice: 'Failed to parse message body',
                requestId: record.messageId,
                error: e,
            });
            continue;
        }
        const retryLater = () => result.batchItemFailures.push({ itemIdentifier: record.messageId });
        const isFill = isFillInput(body);
        const configHash = body.configHash;
        const runnerName = isFill ? undefined : body.runnerName;
        console.log({
            notice: 'Processing SQS message',
            messageId: record.messageId,
            configHash,
            runnerName,
        });
        // scheduled fill from EventBridge via SQS
        if (isFill) {
            const fillPayload = body;
            try {
                console.log({
                    notice: 'Scheduled fill',
                    configHash,
                    providerPath: fillPayload.providerPath,
                    count: fillPayload.count,
                });
                const getNameForSlot = (slot) => deterministicExecutionName(fillPayload.providerPath, `${record.messageId}:${slot}`);
                await runFiller(fillPayload, getNameForSlot, 'scheduled', undefined);
            }
            catch (e) {
                console.error({
                    notice: 'Fill failed',
                    messageId: record.messageId,
                    configHash: fillPayload.configHash,
                    error: e,
                });
                retryLater();
            }
            continue;
        }
        // keeper message
        const input = body;
        console.log({
            notice: 'Checking warm runner',
            configHash: input.configHash,
            runnerName: input.runnerName,
        });
        // get github access (cached per installationId to avoid re-reading the secrets manager and Github API every time)
        let octokit;
        let secrets;
        const cached = octokitCache.get(input.installationId);
        if (cached) {
            octokit = cached.octokit;
            secrets = cached.secrets;
        }
        else {
            const got = await (0, lambda_github_1.getOctokit)(input.installationId);
            octokit = got.octokit;
            secrets = got.githubSecrets;
            octokitCache.set(input.installationId, { octokit, secrets });
        }
        // stale config - best-effort stop, then discard message (runner will self-terminate at its idle timeout)
        if (!validHashes.has(input.configHash)) {
            console.log({
                notice: 'Config hash mismatch (new CDK deployment, old runner) - stopping stale warm runner',
                configHash: input.configHash,
                runnerName: input.runnerName,
                validHashes: validHashes,
            });
            try {
                await stopAndDeleteRunner(input, octokit, secrets, 'StaleWarmRunner');
            }
            catch (e) {
                console.error({
                    notice: 'Best-effort cleanup of stale warm runner failed; it will self-terminate at idle timeout',
                    configHash: input.configHash,
                    runnerName: input.runnerName,
                    error: e,
                });
            }
            continue;
        }
        // past deadline - keeper must stop and delete the runner
        if (Date.now() >= input.absoluteDeadline) {
            console.log({
                notice: 'Warm runner past deadline, stopping and deleting',
                configHash: input.configHash,
                runnerName: input.runnerName,
            });
            try {
                await stopAndDeleteRunner(input, octokit, secrets, 'WarmRunnerExpired');
            }
            catch (e) {
                console.error({
                    notice: 'Failed to stop expired warm runner',
                    configHash: input.configHash,
                    runnerName: input.runnerName,
                    error: e,
                });
                // don't retry to not accidentally create a new runner
                // idle reaper will take care of it soon enough
            }
            continue;
        }
        // check if step function is still running
        const execution = await sfn.send(new client_sfn_1.DescribeExecutionCommand({ executionArn: input.executionArn }));
        const stillRunning = execution.status === 'RUNNING';
        // find runner
        const runner = await (0, lambda_github_1.getRunner)(octokit, secrets.runnerLevel, input.owner, input.repo, input.runnerName);
        // need replacement: step function finished (not running) or runner took a job (busy)
        if (!stillRunning || runner?.busy) {
            console.log({
                notice: 'Warm runner finished or busy; starting replacement',
                configHash: input.configHash,
                runnerName: input.runnerName,
                stillRunning,
                runnerBusy: runner?.busy ?? false,
            });
            try {
                await startWarmRunnerAndEnqueueKeeper({
                    providerPath: input.providerPath,
                    providerLabels: input.providerLabels,
                    owner: input.owner,
                    repo: input.repo,
                    installationId: input.installationId,
                    absoluteDeadline: input.absoluteDeadline,
                    configHash: input.configHash,
                    executionName: deterministicExecutionName(input.providerPath, record.messageId),
                });
            }
            catch (e) {
                console.error({
                    notice: 'Failed to start replacement warm runner',
                    configHash: input.configHash,
                    runnerName: input.runnerName,
                    error: e,
                });
                retryLater();
            }
            continue;
        }
        // step function still running but runner not found yet
        if (!runner) {
            console.log({
                notice: 'Runner not running yet',
                configHash: input.configHash,
                runnerName: input.runnerName,
            });
            retryLater();
            continue;
        }
        // still idle - check again later
        console.log({
            notice: 'Runner still idle - will check again later',
            configHash: input.configHash,
            runnerName: input.runnerName,
        });
        retryLater();
    }
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2FybS1ydW5uZXItbWFuYWdlci5sYW1iZGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvd2FybS1ydW5uZXItbWFuYWdlci5sYW1iZGEudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUF5VkEsMEJBb05DO0FBN2lCRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FvRUc7QUFDSCxpQ0FBaUM7QUFDakMsb0RBTTZCO0FBQzdCLG9EQUFvRTtBQUdwRSxtREFBb0c7QUFDcEcscURBQXlEO0FBRXpELE1BQU0sR0FBRyxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO0FBQzVCLE1BQU0sR0FBRyxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO0FBRTVCLE1BQU0sNkJBQTZCLEdBQUcsRUFBRSxDQUFDO0FBNEJ6QyxTQUFTLFVBQVUsQ0FBQyxLQUFjO0lBQ2hDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBRSxLQUE0QixDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQzlELENBQUM7QUFFRCxTQUFTLFdBQVcsQ0FBQyxLQUFjO0lBQ2pDLE9BQU8sT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUssS0FBK0IsQ0FBQyxNQUFNLEtBQUssTUFBTSxDQUFDO0FBQzNHLENBQUM7QUFFRCxTQUFTLHFCQUFxQixDQUFDLEtBQWM7SUFDM0MsTUFBTSxDQUFDLEdBQUcsS0FBb0QsQ0FBQztJQUMvRCxPQUFPLE9BQU8sQ0FBQyxFQUFFLFdBQVcsS0FBSyxRQUFRLElBQUksT0FBTyxDQUFDLEVBQUUsV0FBVyxLQUFLLFFBQVEsQ0FBQztBQUNsRixDQUFDO0FBRUQsU0FBUyxVQUFVLENBQUMsSUFBWTtJQUM5QixNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2hDLElBQUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztR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QUFVO29CQUM1QixhQUFhLEVBQUUsMEJBQTBCLENBQUMsS0FBSyxDQUFDLFlBQVksRUFBRSxNQUFNLENBQUMsU0FBUyxDQUFDO2lCQUNoRixDQUFDLENBQUM7WUFDTCxDQUFDO1lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDWCxPQUFPLENBQUMsS0FBSyxDQUFDO29CQUNaLE1BQU0sRUFBRSx5Q0FBeUM7b0JBQ2pELFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtvQkFDNUIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO29CQUM1QixLQUFLLEVBQUUsQ0FBQztpQkFDVCxDQUFDLENBQUM7Z0JBQ0gsVUFBVSxFQUFFLENBQUM7WUFDZixDQUFDO1lBQ0QsU0FBUztRQUNYLENBQUM7UUFFRCx1REFBdUQ7UUFDdkQsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ1osT0FBTyxDQUFDLEdBQUcsQ0FBQztnQkFDVixNQUFNLEVBQUUsd0JBQXdCO2dCQUNoQyxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7Z0JBQzVCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTthQUM3QixDQUFDLENBQUM7WUFDSCxVQUFVLEVBQUUsQ0FBQztZQUNiLFNBQVM7UUFDWCxDQUFDO1FBRUQsaUNBQWlDO1FBQ2pDLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDVixNQUFNLEVBQUUsNENBQTRDO1lBQ3BELFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtZQUM1QixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7U0FDN0IsQ0FBQyxDQUFDO1FBQ0gsVUFBVSxFQUFFLENBQUM7SUFDZixDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogV2FybSBSdW5uZXIgTWFuYWdlciBMYW1iZGFcbiAqXG4gKiBNYWludGFpbnMgYSBwb29sIG9mIHByZS1wcm92aXNpb25lZCAoXCJ3YXJtXCIpIEdpdEh1YiBzZWxmLWhvc3RlZCBydW5uZXJzIHNvIGpvYnNcbiAqIHN0YXJ0IHdpdGggbmVhci16ZXJvIGxhdGVuY3kgaW5zdGVhZCBvZiB3YWl0aW5nIGZvciBhIGZyZXNoIHJ1bm5lciB0byBwcm92aXNpb24uXG4gKlxuICogIyMgTGlmZWN5Y2xlXG4gKlxuICogMS4gKipGaWxsKiog4oCUIEFuIEV2ZW50QnJpZGdlIGNyb24gcnVsZSAobWlkbmlnaHQgVVRDIGZvciBhbHdheXMtb24sIG9yIHdpbmRvd1xuICogICAgc3RhcnQgZm9yIHNjaGVkdWxlZCkgc2VuZHMgYSBmaWxsIHBheWxvYWQgdG8gdGhlIHNoYXJlZCBTUVMgcXVldWUuIEZvclxuICogICAgQWx3YXlzT25XYXJtUnVubmVyIG9ubHksIGEgQ2xvdWRGb3JtYXRpb24gY3VzdG9tIHJlc291cmNlIChvbiBkZXBsb3kpXG4gKiAgICBpbnZva2VzIHRoaXMgTGFtYmRhIGRpcmVjdGx5IHRvIGZpbGwgaW1tZWRpYXRlbHk7IHRoZSBkZWFkbGluZSBpcyBzZXQgdG9cbiAqICAgIHRoZSBuZXh0IG1pZG5pZ2h0IFVUQyAobm90IGZ1bGwgMjRoKSBzbyBydW5uZXJzIGxhc3QgdW50aWwgdGhlIG5leHQgY3JvblxuICogICAgZmlsbC4gU2NoZWR1bGVkV2FybVJ1bm5lciBoYXMgbm8gZGVwbG95bWVudC1maWxsIOKAlCBmaXJzdCBmaWxsIGlzIGF0IHRoZVxuICogICAgbmV4dCBzY2hlZHVsZSBvY2N1cnJlbmNlLlxuICpcbiAqIDIuICoqS2VlcGVyKiog4oCUIEVhY2gga2VlcGVyIG1lc3NhZ2UgdHJhY2tzIG9uZSBydW5uZXIuIFRoZSBTUVMgcXVldWUgZGVsaXZlcnMgdGhlXG4gKiAgICBtZXNzYWdlLCB0aGlzIExhbWJkYSBpbnNwZWN0cyB0aGUgcnVubmVyLCBhbmQgb25lIG9mIHRoZSBmb2xsb3dpbmcgaGFwcGVuczpcbiAqICAgIC0gUnVubmVyIGlzIHBhc3QgaXRzIGRlYWRsaW5lIOKGkiB0aGUga2VlcGVyIHN0b3BzIHRoZSBTdGVwIEZ1bmN0aW9uIGFuZCBkZWxldGVzXG4gKiAgICAgIHRoZSBydW5uZXIuIE5vIHJlcGxhY2VtZW50IGlzIGNyZWF0ZWQuXG4gKiAgICAtIFJ1bm5lciBpcyBpZGxlIGFuZCB3aXRoaW4gZGVhZGxpbmUg4oaSIG1lc3NhZ2UgaXMgcmV0dXJuZWQgdG8gdGhlIHF1ZXVlXG4gKiAgICAgICh2aWEgYmF0Y2ggaXRlbSBmYWlsdXJlKSB0byBiZSBjaGVja2VkIGFnYWluIGFmdGVyIHRoZSB2aXNpYmlsaXR5IHRpbWVvdXQuXG4gKiAgICAtIFJ1bm5lciBpcyBidXN5IG9yIGl0cyBTdGVwIEZ1bmN0aW9uIGZpbmlzaGVkIOKGkiBhIHJlcGxhY2VtZW50IHJ1bm5lciBpc1xuICogICAgICBzdGFydGVkIHdpdGggdGhlIHNhbWUgZGVhZGxpbmUsIGFuZCBhIG5ldyBrZWVwZXIgbWVzc2FnZSBpcyBlbnF1ZXVlZC5cbiAqICAgIC0gQ29uZmlnIGhhc2ggbWlzbWF0Y2ggKGNvbmZpZyB3YXMgY2hhbmdlZC9yZW1vdmVkIHNpbmNlIHRoaXMgcnVubmVyIHdhc1xuICogICAgICBjcmVhdGVkKSDihpIgdGhlIHJ1bm5lciBpcyBzdG9wcGVkIGFuZCBkZWxldGVkLiBObyByZXBsYWNlbWVudCBpcyBjcmVhdGVkLlxuICogICAgICBUaGlzIGlzIGhvdyBvbGQgcnVubmVycyBhcmUgY2xlYW5lZCB1cCBxdWlja2x5IG9uIGNvbmZpZyBjaGFuZ2VzLlxuICpcbiAqIDMuICoqU2h1dGRvd24gbWVjaGFuaXNtcyoqIOKAlCBUaGUga2VlcGVyIGlzIHRoZSBwcmltYXJ5IG1lY2hhbmlzbSBmb3IgZW5mb3JjaW5nIHRoZVxuICogICAgYWJzb2x1dGUgZGVhZGxpbmU6IHdoZW4gYSBydW5uZXIgaXMgcGFzdCBpdHMgZGVhZGxpbmUsIHRoZSBrZWVwZXIgc3RvcHMgdGhlXG4gKiAgICBTdGVwIEZ1bmN0aW9uIGFuZCBkZWxldGVzIHRoZSBydW5uZXIuIEZhbGxiYWNrczpcbiAqICAgIC0gKipJZGxlIHJlYXBlcioqOiBNZWFzdXJlcyBpZGxlIHRpbWUgZnJvbSBydW5uZXIgKnJlZ2lzdHJhdGlvbiogKGNka2docjpzdGFydGVkXG4gKiAgICAgIGxhYmVsKSwgbm90IHN0ZXAgZnVuY3Rpb24gc3RhcnQuIFNvIGl0IGZpcmVzIGF0IGRlYWRsaW5lICsgcHJvdmlzaW9uaW5nIGRlbGF5LlxuICogICAgICBJdCdzIGEgZmFsbGJhY2sgaWYgdGhlIGtlZXBlciBtaXNzZXMgYSBtZXNzYWdlOyBpdCBkb2VzIG5vdCBlbmZvcmNlIHRoZVxuICogICAgICBhYnNvbHV0ZSBkZWFkbGluZSBwcmVjaXNlbHkuXG4gKiAgICAtICoqU3RlcCBGdW5jdGlvbiBpZGxlIHRpbWVvdXQqKjogRWFjaCBydW5uZXIgaXMgc3RhcnRlZCB3aXRoIGBtYXhJZGxlU2Vjb25kc2BcbiAqICAgICAgbWF0Y2hpbmcgdGhlIGRlYWRsaW5lLiBJZiBib3RoIGtlZXBlciBhbmQgaWRsZSByZWFwZXIgbWlzcyBpdCwgdGhlIFN0ZXBcbiAqICAgICAgRnVuY3Rpb24gd2lsbCBzZWxmLXRlcm1pbmF0ZSB3aGVuIGl0cyBpZGxlIHRpbWVvdXQgZmlyZXMuXG4gKlxuICogIyMgQ29uZmlnIGhhc2hcbiAqXG4gKiBFYWNoIHdhcm0gcnVubmVyIGNvbmZpZyAocHJvdmlkZXIsIGNvdW50LCBsYWJlbHMsIG93bmVyLCByZXBvLCBkdXJhdGlvbikgaXNcbiAqIGhhc2hlZCBhdCBDREsgc3ludGggdGltZS4gQWxsIGN1cnJlbnQgaGFzaGVzIGFyZSBzdG9yZWQgaW4gdGhlIFdBUk1fQ09ORklHX0hBU0hFU1xuICogZW52aXJvbm1lbnQgdmFyaWFibGUuIEZpbGwgcGF5bG9hZHMgYW5kIGtlZXBlciBtZXNzYWdlcyBjYXJyeSB0aGUgaGFzaC4gV2hlbiB0aGVcbiAqIGtlZXBlciBwcm9jZXNzZXMgYSBtZXNzYWdlIHdob3NlIGhhc2ggaXMgbm90IGluIHRoZSBjdXJyZW50IHNldCwgaXQga25vd3MgdGhlXG4gKiBjb25maWcgd2FzIGNoYW5nZWQgb3IgcmVtb3ZlZCBhbmQgc3RvcHMgdGhlIHJ1bm5lciBpbW1lZGlhdGVseS4gVGhpcyBoZWxwcyBxdWlja2x5XG4gKiBnZXQgcmlkIG9mIHN0YWxlIHJ1bm5lcnMgd2hpbGUga2VlcGluZyBvdmVyLXByb3Zpc2lvbmluZyB0byBhIG1pbmltdW0uXG4gKlxuICogIyMgR290Y2hhc1xuICpcbiAqIC0gS2VlcGVyIG1lc3NhZ2VzIHJlbHkgb24gU1FTIHJlZGVsaXZlcnkgKGJhdGNoIGl0ZW0gZmFpbHVyZSkgZm9yIHBlcmlvZGljXG4gKiAgIGNoZWNraW5nLiBUaGUgdmlzaWJpbGl0eSB0aW1lb3V0ICgxIG1pbikgZGV0ZXJtaW5lcyBob3cgb2Z0ZW4gcnVubmVycyBhcmVcbiAqICAgcG9sbGVkLiBGYWlsZWQgbWVzc2FnZXMgYXJlIHJldHJpZWQgdW50aWwgdGhleSBzdWNjZWVkIG9yIHRoZSBydW5uZXJcbiAqICAgc2VsZi10ZXJtaW5hdGVzIGF0IGl0cyBpZGxlIHRpbWVvdXQuXG4gKiAtIEVhY2ggZmlsbCB1bmNvbmRpdGlvbmFsbHkgc3RhcnRzIGBjb3VudGAgcnVubmVycyDigJQgaXQgZG9lcyBub3QgY2hlY2sgaG93IG1hbnlcbiAqICAgYXJlIGFscmVhZHkgcnVubmluZy4gT24gY3JvbiBmaXJlLCB0aGlzIGNyZWF0ZXMgYSBicmllZiBvdmVybGFwIHdpdGggdGhlXG4gKiAgIHByZXZpb3VzIGN5Y2xlJ3MgcnVubmVycyAod2hpY2ggYXJlIG5lYXIgdGhlaXIgZGVhZGxpbmUpLlxuICogLSBSZW1vdmluZyBhbGwgd2FybSBydW5uZXJzIGNvbmZpZ3VyYXRpb25zIG1heSByZXN1bHQgaW4gd2FybSBydW5uZXJzIHN0YXlpbmdcbiAqICAgYXJvdW5kIHVudGlsIHRoZXkgZXhwaXJlLiBUbyByZW1vdmUgYWxsIHdhcm0gcnVubmVycyBxdWlja2x5LCBzZXQgY291bnQgdG8gMFxuICogICBhbmQgZGVwbG95LiBPbmx5IG9uY2UgYWxsIHRoZSB3YXJtIHJ1bm5lcnMgYXJlIHN0b3BwZWQsIHlvdSBjYW4gcmVtb3ZlIGFsbFxuICogICBjb25maWd1cmF0aW9ucyBhbmQgZGVwbG95IGFnYWluLlxuICogLSAqKkdhcHMgaW4gY292ZXJhZ2UqKjogVGhlIFN0ZXAgRnVuY3Rpb24gdGhhdCBwcm92aXNpb25zIGVhY2ggd2FybSBydW5uZXIgdXNlc1xuICogICBpbmNyZWFzaW5nIHRpbWVvdXRzIGJldHdlZW4gcmV0cmllcyBmb3IgcHJvdmlkZXIgZmFpbHVyZXMgKENvZGVCdWlsZCB0aW1lb3V0LFxuICogICBMYW1iZGEgdGltZW91dCwgY2FwYWNpdHkgZXJyb3JzLCBldGMuKS4gV2hpbGUgYSB3YXJtIHJ1bm5lciBzbG90IGlzIHJldHJ5aW5nLFxuICogICB0aGF0IHNsb3QgaGFzIG5vIHJ1bm5lci4gVGhpcyBtYXkgY3JlYXRlIGdhcHMgaW4gY292ZXJhZ2UuIEFuIGlkbGUgd2FybSBydW5uZXJcbiAqICAgdGhhdCBmYWlscyB0byBwcm92aXNpb24gKG9yIHdob3NlIHJlcGxhY2VtZW50IGZhaWxzKSB3aWxsIGJlIHVuYXZhaWxhYmxlIHVudGlsXG4gKiAgIHRoZSByZXRyeSBzdWNjZWVkcy4gQ3VycmVudCByZXRyeSBtZWNoYW5pc20gaGFzIGJ1aWx0LWluIGJhY2stb2ZmIHJhdGUgYW5kIGNhblxuICogICBiZSB0d2Vha2VkIHVzaW5nIGByZXRyeU9wdGlvbnNgLiBUaGlzIHdpbGwgYmUgaW1wcm92ZWQgaW4gdGhlIGZ1dHVyZS5cbiAqL1xuaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQge1xuICBEZXNjcmliZUV4ZWN1dGlvbkNvbW1hbmQsXG4gIFNGTkNsaWVudCxcbiAgU3RhcnRFeGVjdXRpb25Db21tYW5kLFxuICBTdG9wRXhlY3V0aW9uQ29tbWFuZCxcbiAgRXhlY3V0aW9uQWxyZWFkeUV4aXN0cyxcbn0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNmbic7XG5pbXBvcnQgeyBTUVNDbGllbnQsIFNlbmRNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xuaW1wb3J0IHR5cGUgeyBPY3Rva2l0IH0gZnJvbSAnQG9jdG9raXQvcmVzdCc7XG5pbXBvcnQgKiBhcyBBV1NMYW1iZGEgZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBkZWxldGVSdW5uZXIsIGdldEFwcE9jdG9raXQsIGdldE9jdG9raXQsIGdldFJ1bm5lciwgR2l0SHViU2VjcmV0cyB9IGZyb20gJy4vbGFtYmRhLWdpdGh1Yic7XG5pbXBvcnQgeyBjdXN0b21SZXNvdXJjZVJlc3BvbmQgfSBmcm9tICcuL2xhbWJkYS1oZWxwZXJzJztcblxuY29uc3Qgc2ZuID0gbmV3IFNGTkNsaWVudCgpO1xuY29uc3Qgc3FzID0gbmV3IFNRU0NsaWVudCgpO1xuXG5jb25zdCBTRk5fRVhFQ1VUSU9OX05BTUVfTUFYX0xFTkdUSCA9IDgwO1xuXG5leHBvcnQgaW50ZXJmYWNlIFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlIHtcbiAgcmVhZG9ubHkgZXhlY3V0aW9uQXJuOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJ1bm5lck5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgb3duZXI6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVwbzogc3RyaW5nO1xuICByZWFkb25seSBpbnN0YWxsYXRpb25JZD86IG51bWJlcjtcbiAgcmVhZG9ubHkgcHJvdmlkZXJQYXRoOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHByb3ZpZGVyTGFiZWxzOiBzdHJpbmdbXTtcbiAgcmVhZG9ubHkgYWJzb2x1dGVEZWFkbGluZTogbnVtYmVyOyAvLyBVbml4IG1zIOKAlCBpbmhlcml0ZWQgYnkgcmVwbGFjZW1lbnRzXG4gIHJlYWRvbmx5IGNvbmZpZ0hhc2g6IHN0cmluZztcbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBXYXJtUnVubmVyRmlsbFBheWxvYWQge1xuICByZWFkb25seSBhY3Rpb246ICdmaWxsJztcbiAgcmVhZG9ubHkgcHJvdmlkZXJQYXRoOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHByb3ZpZGVyTGFiZWxzOiBzdHJpbmdbXTtcbiAgcmVhZG9ubHkgY291bnQ6IG51bWJlcjtcbiAgcmVhZG9ubHkgZHVyYXRpb246IG51bWJlcjtcbiAgcmVhZG9ubHkgb3duZXI6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVwbzogc3RyaW5nO1xuICByZWFkb25seSBjb25maWdIYXNoOiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIGlzU3FzRXZlbnQoZXZlbnQ6IHVua25vd24pOiBldmVudCBpcyBBV1NMYW1iZGEuU1FTRXZlbnQge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSgoZXZlbnQgYXMgQVdTTGFtYmRhLlNRU0V2ZW50KS5SZWNvcmRzKTtcbn1cblxuZnVuY3Rpb24gaXNGaWxsSW5wdXQoZXZlbnQ6IHVua25vd24pOiBldmVudCBpcyBXYXJtUnVubmVyRmlsbFBheWxvYWQge1xuICByZXR1cm4gdHlwZW9mIGV2ZW50ID09PSAnb2JqZWN0JyAmJiBldmVudCAhPT0gbnVsbCAmJiAoZXZlbnQgYXMgV2FybVJ1bm5lckZpbGxQYXlsb2FkKS5hY3Rpb24gPT09ICdmaWxsJztcbn1cblxuZnVuY3Rpb24gaXNDdXN0b21SZXNvdXJjZUV2ZW50KGV2ZW50OiB1bmtub3duKTogZXZlbnQgaXMgQVdTTGFtYmRhLkNsb3VkRm9ybWF0aW9uQ3VzdG9tUmVzb3VyY2VFdmVudCB7XG4gIGNvbnN0IGUgPSBldmVudCBhcyBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50O1xuICByZXR1cm4gdHlwZW9mIGU/LlJlcXVlc3RUeXBlID09PSAnc3RyaW5nJyAmJiB0eXBlb2YgZT8uUmVzcG9uc2VVUkwgPT09ICdzdHJpbmcnO1xufVxuXG5mdW5jdGlvbiByZXF1aXJlRW52KG5hbWU6IHN0cmluZykge1xuICBjb25zdCB2YWx1ZSA9IHByb2Nlc3MuZW52W25hbWVdO1xuICBpZiAoIXZhbHVlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGVudmlyb25tZW50IHZhcmlhYmxlICR7bmFtZX1gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmludGVyZmFjZSBTdGFydFdhcm1SdW5uZXJJbnB1dCB7XG4gIHJlYWRvbmx5IHByb3ZpZGVyUGF0aDogc3RyaW5nO1xuICByZWFkb25seSBwcm92aWRlckxhYmVsczogc3RyaW5nW107XG4gIHJlYWRvbmx5IG93bmVyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJlcG86IHN0cmluZztcbiAgcmVhZG9ubHkgaW5zdGFsbGF0aW9uSWQ/OiBudW1iZXI7XG4gIHJlYWRvbmx5IGFic29sdXRlRGVhZGxpbmU6IG51bWJlcjsgLy8gVW5peCBtc1xuICByZWFkb25seSBjb25maWdIYXNoOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGV4ZWN1dGlvbk5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgc2xvdD86IG51bWJlcjsgLy8gMC1iYXNlZCBpbmRleCB3aGVuIGZpbGxpbmcgbXVsdGlwbGUgc2xvdHM7IGhlbHBzIGNvcnJlbGF0ZSBsb2dzXG59XG5cbi8qKlxuICogRGV0ZXJtaW5pc3RpYyBleGVjdXRpb24gbmFtZSBmb3IgaWRlbXBvdGVudCBmaWxscy4gU2FtZSBzZWVkIOKGkiBzYW1lIG5hbWUsIHNvIHJldHJpZXNcbiAqIChjdXN0b20gcmVzb3VyY2UsIFNRUyByZWRlbGl2ZXJ5KSBkb24ndCBjcmVhdGUgZHVwbGljYXRlIHJ1bm5lcnMuXG4gKi9cbmZ1bmN0aW9uIGRldGVybWluaXN0aWNFeGVjdXRpb25OYW1lKHByb3ZpZGVyUGF0aDogc3RyaW5nLCBzZWVkOiBzdHJpbmcpIHtcbiAgY29uc3QgcGF0aFdpdGhvdXRTdGFjayA9IHByb3ZpZGVyUGF0aC5zcGxpdCgnLycpLnNsaWNlKDEpLmpvaW4oJy8nKSB8fCBwcm92aWRlclBhdGg7XG4gIGNvbnN0IHNhbml0aXplZCA9IGB3YXJtLSR7cGF0aFdpdGhvdXRTdGFjay5yZXBsYWNlKC9bXmEtekEtWjAtOS1dL2csICctJyl9YDtcbiAgY29uc3QgaGFzaCA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoc2VlZCkuZGlnZXN0KCdoZXgnKS5zbGljZSgwLCAxNik7XG4gIGNvbnN0IG1heFByZWZpeExlbiA9IFNGTl9FWEVDVVRJT05fTkFNRV9NQVhfTEVOR1RIIC0gaGFzaC5sZW5ndGggLSAxO1xuICByZXR1cm4gYCR7c2FuaXRpemVkLnNsaWNlKDAsIG1heFByZWZpeExlbil9LSR7aGFzaH1gO1xufVxuXG4vKiogUmV0dXJucyBVbml4IG1zIG9mIHRoZSBuZXh0IG1pZG5pZ2h0IFVUQy4gVXNlZCBmb3IgQWx3YXlzT24gZGVwbG95bWVudC1maWxsIGRlYWRsaW5lLiAqL1xuZnVuY3Rpb24gZ2V0TmV4dE1pZG5pZ2h0VXRjTXMoKTogbnVtYmVyIHtcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgY29uc3QgbmV4dE1pZG5pZ2h0ID0gbmV3IERhdGUoRGF0ZS5VVEMobm93LmdldFVUQ0Z1bGxZZWFyKCksIG5vdy5nZXRVVENNb250aCgpLCBub3cuZ2V0VVRDRGF0ZSgpICsgMSwgMCwgMCwgMCwgMCkpO1xuICByZXR1cm4gbmV4dE1pZG5pZ2h0LmdldFRpbWUoKTtcbn1cblxuLyoqIEZpbmQgaW5zdGFsbGF0aW9uIGlkIGZvciBvdXIgYXBwLiBOb3JtYWwgY29kZSBwYXRoIGdldHMgdGhpcyBmcm9tIHRoZSB3ZWJob29rIHBheWxvYWQsIGJ1dCB3ZSBzY2hlZHVsZSB0aGVzZSBvdXJzZWx2ZXMuICovXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlSW5zdGFsbGF0aW9uSWQob3duZXI6IHN0cmluZywgcmVwbzogc3RyaW5nKSB7XG4gIGNvbnN0IGFwcE9jdG9raXQgPSBhd2FpdCBnZXRBcHBPY3Rva2l0KCk7XG4gIGlmICghYXBwT2N0b2tpdCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7IC8vIFBBVCBhdXRoZW50aWNhdGlvblxuICB9XG5cbiAgaWYgKHJlcG8pIHtcbiAgICBjb25zdCB7IGRhdGEgfSA9IGF3YWl0IGFwcE9jdG9raXQucmVzdC5hcHBzLmdldFJlcG9JbnN0YWxsYXRpb24oeyBvd25lciwgcmVwbyB9KTtcbiAgICByZXR1cm4gZGF0YS5pZDtcbiAgfSBlbHNlIHtcbiAgICBjb25zdCB7IGRhdGEgfSA9IGF3YWl0IGFwcE9jdG9raXQucmVzdC5hcHBzLmdldE9yZ0luc3RhbGxhdGlvbih7IG9yZzogb3duZXIgfSk7XG4gICAgcmV0dXJuIGRhdGEuaWQ7XG4gIH1cbn1cblxuLyoqIFN0YXJ0IGEgd2FybSBydW5uZXIgYW5kIGVucXVldWUgYSBrZWVwZXIgbWVzc2FnZSB1c2luZyBTUVMuICovXG5hc3luYyBmdW5jdGlvbiBzdGFydFdhcm1SdW5uZXJBbmRFbnF1ZXVlS2VlcGVyKGlucHV0OiBTdGFydFdhcm1SdW5uZXJJbnB1dCkge1xuICBjb25zdCBzdGVwRnVuY3Rpb25Bcm4gPSByZXF1aXJlRW52KCdTVEVQX0ZVTkNUSU9OX0FSTicpO1xuICBjb25zdCBxdWV1ZVVybCA9IHJlcXVpcmVFbnYoJ1dBUk1fUlVOTkVSX1FVRVVFX1VSTCcpO1xuXG4gIGNvbnN0IHJlbWFpbmluZ1NlY29uZHMgPSBNYXRoLmZsb29yKChpbnB1dC5hYnNvbHV0ZURlYWRsaW5lIC0gRGF0ZS5ub3coKSkgLyAxMDAwKTtcbiAgaWYgKHJlbWFpbmluZ1NlY29uZHMgPD0gMCkge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ0Fic29sdXRlIGRlYWRsaW5lIGFscmVhZHkgcGFzc2VkOyBub3Qgc3RhcnRpbmcgcmVwbGFjZW1lbnQnLFxuICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgIHJ1bm5lck5hbWU6IGlucHV0LmV4ZWN1dGlvbk5hbWUsXG4gICAgICBpbnB1dCxcbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgZXhlY3V0aW9uQXJuOiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgc2ZuLnNlbmQobmV3IFN0YXJ0RXhlY3V0aW9uQ29tbWFuZCh7XG4gICAgICBzdGF0ZU1hY2hpbmVBcm46IHN0ZXBGdW5jdGlvbkFybixcbiAgICAgIG5hbWU6IGlucHV0LmV4ZWN1dGlvbk5hbWUsXG4gICAgICBpbnB1dDogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBvd25lcjogaW5wdXQub3duZXIsXG4gICAgICAgIHJlcG86IGlucHV0LnJlcG8gfHwgJycsXG4gICAgICAgIGpvYklkOiAtMSxcbiAgICAgICAgam9iVXJsOiAnJyxcbiAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IGlucHV0Lmluc3RhbGxhdGlvbklkID8/IC0xLFxuICAgICAgICBqb2JMYWJlbHM6IGlucHV0LnByb3ZpZGVyTGFiZWxzLmpvaW4oJywnKSxcbiAgICAgICAgcHJvdmlkZXI6IGlucHV0LnByb3ZpZGVyUGF0aCxcbiAgICAgICAgbGFiZWxzOiBbLi4uaW5wdXQucHJvdmlkZXJMYWJlbHMsICdjZGtnaHI6d2FybSddLmpvaW4oJywnKSxcbiAgICAgICAgbWF4SWRsZVNlY29uZHM6IHJlbWFpbmluZ1NlY29uZHMsXG4gICAgICB9KSxcbiAgICB9KSk7XG4gICAgZXhlY3V0aW9uQXJuID0gcmVzdWx0LmV4ZWN1dGlvbkFybiE7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZSBpbnN0YW5jZW9mIEV4ZWN1dGlvbkFscmVhZHlFeGlzdHMpIHtcbiAgICAgIC8vIElkZW1wb3RlbnQgcmV0cnk6IGV4ZWN1dGlvbiB3YXMgYWxyZWFkeSBzdGFydGVkIChlLmcuIExhbWJkYSB0aW1lZCBvdXQgbWlkLWZpbGwpLlxuICAgICAgLy8gRG9uJ3QgZW5xdWV1ZS4gVGhlIGZpcnN0IGF0dGVtcHQgYWxyZWFkeSBkaWQsIHNvIGR1cGxpY2F0ZSBrZWVwZXIgbWVzc2FnZXMgd291bGQgY2F1c2UgZHVwbGljYXRlIHJlcGxhY2VtZW50cy5cbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnRXhlY3V0aW9uQWxyZWFkeUV4aXN0cyDigJQgaWRlbXBvdGVudCByZXRyeSwgc2tpcHBpbmcgZW5xdWV1ZScsXG4gICAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICAgIHNsb3Q6IGlucHV0LnNsb3QsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LmV4ZWN1dGlvbk5hbWUsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgZTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBtZXNzYWdlOiBXYXJtUnVubmVyS2VlcGVyTWVzc2FnZSA9IHtcbiAgICBleGVjdXRpb25Bcm4sXG4gICAgcnVubmVyTmFtZTogaW5wdXQuZXhlY3V0aW9uTmFtZSxcbiAgICBvd25lcjogaW5wdXQub3duZXIsXG4gICAgcmVwbzogaW5wdXQucmVwbyxcbiAgICBpbnN0YWxsYXRpb25JZDogaW5wdXQuaW5zdGFsbGF0aW9uSWQsXG4gICAgcHJvdmlkZXJQYXRoOiBpbnB1dC5wcm92aWRlclBhdGgsXG4gICAgcHJvdmlkZXJMYWJlbHM6IGlucHV0LnByb3ZpZGVyTGFiZWxzLFxuICAgIGFic29sdXRlRGVhZGxpbmU6IGlucHV0LmFic29sdXRlRGVhZGxpbmUsXG4gICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgfTtcblxuICBhd2FpdCBzcXMuc2VuZChuZXcgU2VuZE1lc3NhZ2VDb21tYW5kKHtcbiAgICBRdWV1ZVVybDogcXVldWVVcmwsXG4gICAgTWVzc2FnZUJvZHk6IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpLFxuICB9KSk7XG5cbiAgY29uc29sZS5sb2coe1xuICAgIG5vdGljZTogJ1N0YXJ0ZWQgd2FybSBydW5uZXIgYW5kIGVucXVldWVkIGtlZXBlciBtZXNzYWdlJyxcbiAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgIHNsb3Q6IGlucHV0LnNsb3QsXG4gICAgcnVubmVyTmFtZTogaW5wdXQuZXhlY3V0aW9uTmFtZSxcbiAgICBleGVjdXRpb25Bcm4sXG4gICAgcmVtYWluaW5nU2Vjb25kcyxcbiAgfSk7XG59XG5cbi8qKlxuICogVW5jb25kaXRpb25hbGx5IHN0YXJ0cyBgY291bnRgIHdhcm0gcnVubmVycyBmb3IgdGhlIGdpdmVuIGNvbmZpZyBhbmQgZW5xdWV1ZXMga2VlcGVyIG1lc3NhZ2VzLlxuICpcbiAqIEBwYXJhbSBpbnB1dCB0aGUgZmlsbCBwYXlsb2FkXG4gKiBAcGFyYW0gZ2V0TmFtZUZvclNsb3QgYSBmdW5jdGlvbiB0byBnZW5lcmF0ZSBhIHVuaXF1ZSBhbmQgc3RhYmxlIGV4ZWN1dGlvbiBuYW1lIGZvciBlYWNoIHNsb3RcbiAqIEBwYXJhbSBzb3VyY2UgdGhlIHNvdXJjZSBvZiB0aGUgZmlsbCBmb3IgZGVidWdnaW5nIHB1cnBvc2VzXG4gKiBAcGFyYW0gYWJzb2x1dGVEZWFkbGluZU92ZXJyaWRlIGlmIHByb3ZpZGVkLCB1c2UgdGhpcyBpbnN0ZWFkIG9mIG5vdyArIGR1cmF0aW9uIChmb3IgQWx3YXlzT24gZGVwbG95bWVudC1maWxsKVxuICovXG5hc3luYyBmdW5jdGlvbiBydW5GaWxsZXIoaW5wdXQ6IFdhcm1SdW5uZXJGaWxsUGF5bG9hZCwgZ2V0TmFtZUZvclNsb3Q6IChzbG90OiBudW1iZXIpID0+IHN0cmluZywgc291cmNlOiBzdHJpbmcsIGFic29sdXRlRGVhZGxpbmVPdmVycmlkZT86IG51bWJlcikge1xuICBjb25zdCBpbnN0YWxsYXRpb25JZCA9IGF3YWl0IHJlc29sdmVJbnN0YWxsYXRpb25JZChpbnB1dC5vd25lciwgaW5wdXQucmVwbyk7XG4gIGNvbnN0IGFic29sdXRlRGVhZGxpbmUgPSBhYnNvbHV0ZURlYWRsaW5lT3ZlcnJpZGUgPz8gRGF0ZS5ub3coKSArIGlucHV0LmR1cmF0aW9uICogMTAwMDtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGlucHV0LmNvdW50OyBpKyspIHtcbiAgICBhd2FpdCBzdGFydFdhcm1SdW5uZXJBbmRFbnF1ZXVlS2VlcGVyKHtcbiAgICAgIHByb3ZpZGVyUGF0aDogaW5wdXQucHJvdmlkZXJQYXRoLFxuICAgICAgcHJvdmlkZXJMYWJlbHM6IGlucHV0LnByb3ZpZGVyTGFiZWxzLFxuICAgICAgb3duZXI6IGlucHV0Lm93bmVyLFxuICAgICAgcmVwbzogaW5wdXQucmVwbyxcbiAgICAgIGluc3RhbGxhdGlvbklkLFxuICAgICAgYWJzb2x1dGVEZWFkbGluZSxcbiAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICBleGVjdXRpb25OYW1lOiBnZXROYW1lRm9yU2xvdChpKSxcbiAgICAgIHNsb3Q6IGksXG4gICAgfSk7XG4gIH1cblxuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnRmlsbCBjb21wbGV0ZSAtIHN0YXJ0ZWQgd2FybSBydW5uZXJzJyxcbiAgICBzb3VyY2UsXG4gICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICBwcm92aWRlclBhdGg6IGlucHV0LnByb3ZpZGVyUGF0aCxcbiAgICBzdGFydGVkOiBpbnB1dC5jb3VudCxcbiAgfSk7XG59XG5cbi8qKiBTdG9wIHRoZSBzdGVwIGZ1bmN0aW9uIGFuZCBkZWxldGUgdGhlIHJ1bm5lciBmcm9tIEdpdEh1Yi4gKi9cbmFzeW5jIGZ1bmN0aW9uIHN0b3BBbmREZWxldGVSdW5uZXIoaW5wdXQ6IFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlLCBvY3Rva2l0OiBPY3Rva2l0LCBzZWNyZXRzOiBHaXRIdWJTZWNyZXRzLCByZWFzb246IHN0cmluZykge1xuICB0cnkge1xuICAgIGF3YWl0IHNmbi5zZW5kKG5ldyBTdG9wRXhlY3V0aW9uQ29tbWFuZCh7XG4gICAgICBleGVjdXRpb25Bcm46IGlucHV0LmV4ZWN1dGlvbkFybixcbiAgICAgIGVycm9yOiByZWFzb24sXG4gICAgICBjYXVzZTogJ1dhcm0gcnVubmVyIHN0b3BwZWQgYnkga2VlcGVyJyxcbiAgICB9KSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBzdG9wIHN0ZXAgZnVuY3Rpb24nLFxuICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRpb25Bcm46IGlucHV0LmV4ZWN1dGlvbkFybixcbiAgICAgIGVycm9yOiBlLFxuICAgICAgaW5wdXQsXG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBydW5uZXIgPSBhd2FpdCBnZXRSdW5uZXIob2N0b2tpdCwgc2VjcmV0cy5ydW5uZXJMZXZlbCwgaW5wdXQub3duZXIsIGlucHV0LnJlcG8sIGlucHV0LnJ1bm5lck5hbWUpO1xuICBpZiAocnVubmVyKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRlbGV0ZVJ1bm5lcihvY3Rva2l0LCBzZWNyZXRzLnJ1bm5lckxldmVsLCBpbnB1dC5vd25lciwgaW5wdXQucmVwbywgcnVubmVyLmlkKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIGRlbGV0ZSBydW5uZXInLFxuICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICBydW5uZXJJZDogcnVubmVyLmlkLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgICAgaW5wdXQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBXYXJtIHJ1bm5lciBtYW5hZ2VyIExhbWJkYSAtIGhhbmRsZXMgdGhyZWUgaW52b2NhdGlvbiBtb2RlczpcbiAqXG4gKiAxLiBDbG91ZEZvcm1hdGlvbiBDdXN0b20gUmVzb3VyY2UgLSB0cmlnZ2VyZWQgb24gc3RhY2sgZGVwbG95IChDcmVhdGUvVXBkYXRlKSBmb3IgQWx3YXlzT25XYXJtUnVubmVyIG9ubHkuIFJ1bnNcbiAqICAgIHJ1bkZpbGxlciB3aXRoIGRlYWRsaW5lID0gbmV4dCBtaWRuaWdodCBVVEMgc28gcnVubmVycyBsYXN0IHVudGlsIHRoZSBuZXh0IGNyb24gZmlsbC4gRGVsZXRlIGlzIGEgbm8tb3AuXG4gKiAyLiBTUVMgbWVzc2FnZXMgLSBmaWxsIG9yIGtlZXBlclxuICogICAgLSBGaWxsIC0gZnJvbSBFdmVudEJyaWRnZSBjcm9uLiBVc2VzIG1lc3NhZ2VJZCBmb3IgZGV0ZXJtaW5pc3RpYyBleGVjdXRpb24gbmFtZXMgKGlkZW1wb3RlbnQgb24gcmVkZWxpdmVyeSkuXG4gKiAgICAtIEtlZXBlciAtIHRyYWNrcyBvbmUgcnVubmVyLiBVc2VzIFNRUyBtZXNzYWdlIGN5Y2xpbmcgZm9yIHBlcmlvZGljIGNoZWNrcy5cbiAqICAgICAgRWFjaCBtZXNzYWdlIHRyYWNrcyBvbmUgd2FybSBydW5uZXIuIFRoZSBrZWVwZXIgY2hlY2tzOlxuICogICAgICAtIFBhc3QgZGVhZGxpbmUgLSBzdG9wIHRoZSBTdGVwIEZ1bmN0aW9uIGFuZCBkZWxldGUgdGhlIHJ1bm5lci5cbiAqICAgICAgLSBDb25maWcgaGFzaCAtIGlmIHRoZSBtZXNzYWdlJ3MgYGNvbmZpZ0hhc2hgIGRvZXNuJ3QgbWF0Y2ggdGhlIGN1cnJlbnQgYFdBUk1fQ09ORklHX0hBU0hFU2AgZW52IHZhciwgdGhlIHJ1bm5lciBpcyBmcm9tIGEgc3RhbGUgY29uZmlnIC0gc3RvcCBpdCBhbmQgZGlzY2FyZCB0aGUgbWVzc2FnZSB3aXRob3V0IHJlcGxhY2VtZW50LlxuICogICAgICAtIEJ1c3kvZmluaXNoZWQgLSBpZiB0aGUgU3RlcCBGdW5jdGlvbiBlbmRlZCBvciB0aGUgR2l0SHViIHJ1bm5lciBpcyBidXN5ICh0b29rIGEgam9iKSwgc3RhcnQgYSByZXBsYWNlbWVudCBydW5uZXIgKGluaGVyaXRpbmcgdGhlIHNhbWUgZGVhZGxpbmUgYW5kIGNvbmZpZyBoYXNoKS5cbiAqICAgICAgLSBOb3QgZm91bmQgeWV0IChydW5uZXIvaW5mcmFzdHJ1Y3R1cmUgc3RpbGwgc3RhcnRpbmcpIC0gcmV0cnkgbGF0ZXIgKG1lc3NhZ2UgZ29lcyBiYWNrIHRvIHF1ZXVlKS5cbiAqICAgICAgLSBTdGlsbCBpZGxlIC0gcmV0cnkgbGF0ZXIgdG8gY2hlY2sgYWdhaW4uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKGV2ZW50OiBBV1NMYW1iZGEuU1FTRXZlbnQgfCBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50KSB7XG4gIGlmIChpc0N1c3RvbVJlc291cmNlRXZlbnQoZXZlbnQpKSB7XG4gICAgY29uc3QgcGh5c2ljYWxJZCA9ICgnUGh5c2ljYWxSZXNvdXJjZUlkJyBpbiBldmVudCA/IGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCA6IHVuZGVmaW5lZCkgPz8gZXZlbnQuTG9naWNhbFJlc291cmNlSWQ7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHByb3BzID0gZXZlbnQuUmVzb3VyY2VQcm9wZXJ0aWVzIGFzIHVua25vd24gYXMgV2FybVJ1bm5lckZpbGxQYXlsb2FkO1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdDdXN0b20gcmVzb3VyY2UgZmlsbCcsXG4gICAgICAgIHJlcXVlc3RUeXBlOiBldmVudC5SZXF1ZXN0VHlwZSxcbiAgICAgICAgbG9naWNhbFJlc291cmNlSWQ6IGV2ZW50LkxvZ2ljYWxSZXNvdXJjZUlkLFxuICAgICAgICBjb25maWdIYXNoOiBwcm9wcy5jb25maWdIYXNoLFxuICAgICAgICBwcm92aWRlclBhdGg6IHByb3BzLnByb3ZpZGVyUGF0aCxcbiAgICAgICAgY291bnQ6IHByb3BzLmNvdW50LFxuICAgICAgfSk7XG4gICAgICBpZiAoZXZlbnQuUmVxdWVzdFR5cGUgPT09ICdDcmVhdGUnIHx8IGV2ZW50LlJlcXVlc3RUeXBlID09PSAnVXBkYXRlJykge1xuICAgICAgICBjb25zdCBnZXROYW1lRm9yU2xvdCA9IChzbG90OiBudW1iZXIpID0+XG4gICAgICAgICAgZGV0ZXJtaW5pc3RpY0V4ZWN1dGlvbk5hbWUocHJvcHMucHJvdmlkZXJQYXRoLCBgJHtldmVudC5Mb2dpY2FsUmVzb3VyY2VJZH06JHtldmVudC5SZXF1ZXN0VHlwZX06JHtwcm9wcy5jb25maWdIYXNofToke3Nsb3R9YCk7XG4gICAgICAgIGNvbnN0IGRlYWRsaW5lID0gZ2V0TmV4dE1pZG5pZ2h0VXRjTXMoKTtcbiAgICAgICAgYXdhaXQgcnVuRmlsbGVyKHByb3BzLCBnZXROYW1lRm9yU2xvdCwgJ2N1c3RvbVJlc291cmNlJywgZGVhZGxpbmUpO1xuICAgICAgfVxuICAgICAgYXdhaXQgY3VzdG9tUmVzb3VyY2VSZXNwb25kKGV2ZW50LCAnU1VDQ0VTUycsICdPSycsIHBoeXNpY2FsSWQsIHt9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHsgbm90aWNlOiAnQ3VzdG9tIHJlc291cmNlIGhhbmRsZXIgZmFpbGVkJywgZXJyb3I6IGUgfSk7XG4gICAgICBhd2FpdCBjdXN0b21SZXNvdXJjZVJlc3BvbmQoZXZlbnQsICdGQUlMRUQnLCAoZSBhcyBFcnJvcikubWVzc2FnZSB8fCAnSW50ZXJuYWwgRXJyb3InLCBwaHlzaWNhbElkLCB7fSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghaXNTcXNFdmVudChldmVudCkpIHtcbiAgICBjb25zb2xlLmVycm9yKHsgbm90aWNlOiAnVW5rbm93biBldmVudCB0eXBlOyBpZ25vcmluZycsIGV2ZW50IH0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHZhbGlkSGFzaGVzID0gbmV3IFNldCgocHJvY2Vzcy5lbnYuV0FSTV9DT05GSUdfSEFTSEVTID8/ICcnKS5zcGxpdCgnLCcpLmZpbHRlcihCb29sZWFuKSk7XG4gIGNvbnN0IHJlc3VsdDogQVdTTGFtYmRhLlNRU0JhdGNoUmVzcG9uc2UgPSB7IGJhdGNoSXRlbUZhaWx1cmVzOiBbXSB9O1xuICBjb25zdCBvY3Rva2l0Q2FjaGUgPSBuZXcgTWFwPG51bWJlciB8IHVuZGVmaW5lZCwgeyBvY3Rva2l0OiBPY3Rva2l0OyBzZWNyZXRzOiBHaXRIdWJTZWNyZXRzIH0+KCk7XG5cbiAgZm9yIChjb25zdCByZWNvcmQgb2YgZXZlbnQuUmVjb3Jkcykge1xuICAgIGxldCBib2R5OiBXYXJtUnVubmVyS2VlcGVyTWVzc2FnZSB8IFdhcm1SdW5uZXJGaWxsUGF5bG9hZDtcbiAgICB0cnkge1xuICAgICAgYm9keSA9IEpTT04ucGFyc2UocmVjb3JkLmJvZHkpIGFzIFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlIHwgV2FybVJ1bm5lckZpbGxQYXlsb2FkO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICBub3RpY2U6ICdGYWlsZWQgdG8gcGFyc2UgbWVzc2FnZSBib2R5JyxcbiAgICAgICAgcmVxdWVzdElkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgcmV0cnlMYXRlciA9ICgpID0+IHJlc3VsdC5iYXRjaEl0ZW1GYWlsdXJlcy5wdXNoKHsgaXRlbUlkZW50aWZpZXI6IHJlY29yZC5tZXNzYWdlSWQgfSk7XG5cbiAgICBjb25zdCBpc0ZpbGwgPSBpc0ZpbGxJbnB1dChib2R5KTtcbiAgICBjb25zdCBjb25maWdIYXNoID0gKGJvZHkgYXMgV2FybVJ1bm5lckZpbGxQYXlsb2FkICYgV2FybVJ1bm5lcktlZXBlck1lc3NhZ2UpLmNvbmZpZ0hhc2g7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IGlzRmlsbCA/IHVuZGVmaW5lZCA6IChib2R5IGFzIFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlKS5ydW5uZXJOYW1lO1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ1Byb2Nlc3NpbmcgU1FTIG1lc3NhZ2UnLFxuICAgICAgbWVzc2FnZUlkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgY29uZmlnSGFzaCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgfSk7XG5cbiAgICAvLyBzY2hlZHVsZWQgZmlsbCBmcm9tIEV2ZW50QnJpZGdlIHZpYSBTUVNcbiAgICBpZiAoaXNGaWxsKSB7XG4gICAgICBjb25zdCBmaWxsUGF5bG9hZCA9IGJvZHkgYXMgV2FybVJ1bm5lckZpbGxQYXlsb2FkO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgIG5vdGljZTogJ1NjaGVkdWxlZCBmaWxsJyxcbiAgICAgICAgICBjb25maWdIYXNoLFxuICAgICAgICAgIHByb3ZpZGVyUGF0aDogZmlsbFBheWxvYWQucHJvdmlkZXJQYXRoLFxuICAgICAgICAgIGNvdW50OiBmaWxsUGF5bG9hZC5jb3VudCxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGdldE5hbWVGb3JTbG90ID0gKHNsb3Q6IG51bWJlcikgPT5cbiAgICAgICAgICBkZXRlcm1pbmlzdGljRXhlY3V0aW9uTmFtZShmaWxsUGF5bG9hZC5wcm92aWRlclBhdGgsIGAke3JlY29yZC5tZXNzYWdlSWR9OiR7c2xvdH1gKTtcbiAgICAgICAgYXdhaXQgcnVuRmlsbGVyKGZpbGxQYXlsb2FkLCBnZXROYW1lRm9yU2xvdCwgJ3NjaGVkdWxlZCcsIHVuZGVmaW5lZCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgIG5vdGljZTogJ0ZpbGwgZmFpbGVkJyxcbiAgICAgICAgICBtZXNzYWdlSWQ6IHJlY29yZC5tZXNzYWdlSWQsXG4gICAgICAgICAgY29uZmlnSGFzaDogZmlsbFBheWxvYWQuY29uZmlnSGFzaCxcbiAgICAgICAgICBlcnJvcjogZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHJ5TGF0ZXIoKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIGtlZXBlciBtZXNzYWdlXG4gICAgY29uc3QgaW5wdXQgPSBib2R5IGFzIFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlO1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ0NoZWNraW5nIHdhcm0gcnVubmVyJyxcbiAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgIH0pO1xuXG4gICAgLy8gZ2V0IGdpdGh1YiBhY2Nlc3MgKGNhY2hlZCBwZXIgaW5zdGFsbGF0aW9uSWQgdG8gYXZvaWQgcmUtcmVhZGluZyB0aGUgc2VjcmV0cyBtYW5hZ2VyIGFuZCBHaXRodWIgQVBJIGV2ZXJ5IHRpbWUpXG4gICAgbGV0IG9jdG9raXQ6IE9jdG9raXQ7XG4gICAgbGV0IHNlY3JldHM6IEdpdEh1YlNlY3JldHM7XG4gICAgY29uc3QgY2FjaGVkID0gb2N0b2tpdENhY2hlLmdldChpbnB1dC5pbnN0YWxsYXRpb25JZCk7XG4gICAgaWYgKGNhY2hlZCkge1xuICAgICAgb2N0b2tpdCA9IGNhY2hlZC5vY3Rva2l0O1xuICAgICAgc2VjcmV0cyA9IGNhY2hlZC5zZWNyZXRzO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBnb3QgPSBhd2FpdCBnZXRPY3Rva2l0KGlucHV0Lmluc3RhbGxhdGlvbklkKTtcbiAgICAgIG9jdG9raXQgPSBnb3Qub2N0b2tpdDtcbiAgICAgIHNlY3JldHMgPSBnb3QuZ2l0aHViU2VjcmV0cztcbiAgICAgIG9jdG9raXRDYWNoZS5zZXQoaW5wdXQuaW5zdGFsbGF0aW9uSWQsIHsgb2N0b2tpdCwgc2VjcmV0cyB9KTtcbiAgICB9XG5cbiAgICAvLyBzdGFsZSBjb25maWcgLSBiZXN0LWVmZm9ydCBzdG9wLCB0aGVuIGRpc2NhcmQgbWVzc2FnZSAocnVubmVyIHdpbGwgc2VsZi10ZXJtaW5hdGUgYXQgaXRzIGlkbGUgdGltZW91dClcbiAgICBpZiAoIXZhbGlkSGFzaGVzLmhhcyhpbnB1dC5jb25maWdIYXNoKSkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdDb25maWcgaGFzaCBtaXNtYXRjaCAobmV3IENESyBkZXBsb3ltZW50LCBvbGQgcnVubmVyKSAtIHN0b3BwaW5nIHN0YWxlIHdhcm0gcnVubmVyJyxcbiAgICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgdmFsaWRIYXNoZXM6IHZhbGlkSGFzaGVzLFxuICAgICAgfSk7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHN0b3BBbmREZWxldGVSdW5uZXIoaW5wdXQsIG9jdG9raXQsIHNlY3JldHMsICdTdGFsZVdhcm1SdW5uZXInKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcih7XG4gICAgICAgICAgbm90aWNlOiAnQmVzdC1lZmZvcnQgY2xlYW51cCBvZiBzdGFsZSB3YXJtIHJ1bm5lciBmYWlsZWQ7IGl0IHdpbGwgc2VsZi10ZXJtaW5hdGUgYXQgaWRsZSB0aW1lb3V0JyxcbiAgICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgICAgZXJyb3I6IGUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gcGFzdCBkZWFkbGluZSAtIGtlZXBlciBtdXN0IHN0b3AgYW5kIGRlbGV0ZSB0aGUgcnVubmVyXG4gICAgaWYgKERhdGUubm93KCkgPj0gaW5wdXQuYWJzb2x1dGVEZWFkbGluZSkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdXYXJtIHJ1bm5lciBwYXN0IGRlYWRsaW5lLCBzdG9wcGluZyBhbmQgZGVsZXRpbmcnLFxuICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgfSk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBzdG9wQW5kRGVsZXRlUnVubmVyKGlucHV0LCBvY3Rva2l0LCBzZWNyZXRzLCAnV2FybVJ1bm5lckV4cGlyZWQnKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcih7XG4gICAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIHN0b3AgZXhwaXJlZCB3YXJtIHJ1bm5lcicsXG4gICAgICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICAgIGVycm9yOiBlLFxuICAgICAgICB9KTtcbiAgICAgICAgLy8gZG9uJ3QgcmV0cnkgdG8gbm90IGFjY2lkZW50YWxseSBjcmVhdGUgYSBuZXcgcnVubmVyXG4gICAgICAgIC8vIGlkbGUgcmVhcGVyIHdpbGwgdGFrZSBjYXJlIG9mIGl0IHNvb24gZW5vdWdoXG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBjaGVjayBpZiBzdGVwIGZ1bmN0aW9uIGlzIHN0aWxsIHJ1bm5pbmdcbiAgICBjb25zdCBleGVjdXRpb24gPSBhd2FpdCBzZm4uc2VuZChuZXcgRGVzY3JpYmVFeGVjdXRpb25Db21tYW5kKHsgZXhlY3V0aW9uQXJuOiBpbnB1dC5leGVjdXRpb25Bcm4gfSkpO1xuICAgIGNvbnN0IHN0aWxsUnVubmluZyA9IGV4ZWN1dGlvbi5zdGF0dXMgPT09ICdSVU5OSU5HJztcblxuICAgIC8vIGZpbmQgcnVubmVyXG4gICAgY29uc3QgcnVubmVyID0gYXdhaXQgZ2V0UnVubmVyKG9jdG9raXQsIHNlY3JldHMucnVubmVyTGV2ZWwsIGlucHV0Lm93bmVyLCBpbnB1dC5yZXBvLCBpbnB1dC5ydW5uZXJOYW1lKTtcblxuICAgIC8vIG5lZWQgcmVwbGFjZW1lbnQ6IHN0ZXAgZnVuY3Rpb24gZmluaXNoZWQgKG5vdCBydW5uaW5nKSBvciBydW5uZXIgdG9vayBhIGpvYiAoYnVzeSlcbiAgICBpZiAoIXN0aWxsUnVubmluZyB8fCBydW5uZXI/LmJ1c3kpIHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnV2FybSBydW5uZXIgZmluaXNoZWQgb3IgYnVzeTsgc3RhcnRpbmcgcmVwbGFjZW1lbnQnLFxuICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICBzdGlsbFJ1bm5pbmcsXG4gICAgICAgIHJ1bm5lckJ1c3k6IHJ1bm5lcj8uYnVzeSA/PyBmYWxzZSxcbiAgICAgIH0pO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgc3RhcnRXYXJtUnVubmVyQW5kRW5xdWV1ZUtlZXBlcih7XG4gICAgICAgICAgcHJvdmlkZXJQYXRoOiBpbnB1dC5wcm92aWRlclBhdGgsXG4gICAgICAgICAgcHJvdmlkZXJMYWJlbHM6IGlucHV0LnByb3ZpZGVyTGFiZWxzLFxuICAgICAgICAgIG93bmVyOiBpbnB1dC5vd25lcixcbiAgICAgICAgICByZXBvOiBpbnB1dC5yZXBvLFxuICAgICAgICAgIGluc3RhbGxhdGlvbklkOiBpbnB1dC5pbnN0YWxsYXRpb25JZCxcbiAgICAgICAgICBhYnNvbHV0ZURlYWRsaW5lOiBpbnB1dC5hYnNvbHV0ZURlYWRsaW5lLFxuICAgICAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICAgICAgZXhlY3V0aW9uTmFtZTogZGV0ZXJtaW5pc3RpY0V4ZWN1dGlvbk5hbWUoaW5wdXQucHJvdmlkZXJQYXRoLCByZWNvcmQubWVzc2FnZUlkKSxcbiAgICAgICAgfSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBzdGFydCByZXBsYWNlbWVudCB3YXJtIHJ1bm5lcicsXG4gICAgICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICAgIGVycm9yOiBlLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0cnlMYXRlcigpO1xuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gc3RlcCBmdW5jdGlvbiBzdGlsbCBydW5uaW5nIGJ1dCBydW5uZXIgbm90IGZvdW5kIHlldFxuICAgIGlmICghcnVubmVyKSB7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1J1bm5lciBub3QgcnVubmluZyB5ZXQnLFxuICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgfSk7XG4gICAgICByZXRyeUxhdGVyKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBzdGlsbCBpZGxlIC0gY2hlY2sgYWdhaW4gbGF0ZXJcbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdSdW5uZXIgc3RpbGwgaWRsZSAtIHdpbGwgY2hlY2sgYWdhaW4gbGF0ZXInLFxuICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgfSk7XG4gICAgcmV0cnlMYXRlcigpO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cbiJdfQ==