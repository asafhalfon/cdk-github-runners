"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
 *    - **Idle reaper**: Measures idle time from when it first sees the runner online and
 *      idle, not step function start. So it fires at deadline + provisioning delay.
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
 * - Keeper messages enqueue their own replacement, which is a Lambda -> SQS -> Lambda
 *   loop by design. AWS recursive loop detection is disabled for this function, so
 *   the loop is rate limited here instead: new keeper messages are delayed by a
 *   minute, and that delay doubles (up to 15 minutes) for every runner in a row that
 *   failed within 5 minutes without taking a job. This keeps a broken provider from
 *   starting a new runner every few seconds until the deadline. A provider that fails
 *   slower than that is only limited by the one minute delay. That one minute delay
 *   doesn't delay the runner itself, but only the keeper message which checks if it's
 *   busy and needs to be replaced. A runner won't normally start much faster than a
 *   minute anyway so this delay doesn't impact the user much.
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
const crypto = __importStar(require("crypto"));
const client_sfn_1 = require("@aws-sdk/client-sfn");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const lambda_common_1 = require("./lambda-common");
const lambda_github_1 = require("./lambda-github");
const lambda_helpers_1 = require("./lambda-helpers");
const sfn = new client_sfn_1.SFNClient();
const sqs = new client_sqs_1.SQSClient();
const SFN_EXECUTION_NAME_MAX_LENGTH = 80;
const KEEPER_DELAY_SECONDS = 60;
const KEEPER_MAX_DELAY_SECONDS = 900; // SQS maximum
const FAST_FAILURE_MS = 5 * 60 * 1000;
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
                jobId: lambda_common_1.WARM_RUNNER_JOB_ID,
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
        failures: input.failures,
    };
    // delay the first check so a runner that keeps failing can't spin in a tight loop of replacements
    // back off exponentially while the slot keeps failing (a new runner can't register in less than a minute anyway)
    const delaySeconds = Math.min(KEEPER_DELAY_SECONDS * 2 ** (input.failures ?? 0), KEEPER_MAX_DELAY_SECONDS);
    await sqs.send(new client_sqs_1.SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
        DelaySeconds: delaySeconds,
    }));
    console.log({
        notice: 'Started warm runner and enqueued keeper message',
        configHash: input.configHash,
        slot: input.slot,
        runnerName: input.executionName,
        executionArn,
        remainingSeconds,
        failures: input.failures,
        delaySeconds,
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
    const installationId = await (0, lambda_github_1.resolveInstallationId)(input.owner, input.repo);
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
        console.log({
            notice: 'Stopped step function',
            metric: 'RunnerStopped',
            reason,
            configHash: input.configHash,
            runnerName: input.runnerName,
            executionArn: input.executionArn,
            provider: input.providerPath,
        });
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
    const maxDurationMs = parseInt(process.env.WARM_MAX_DURATION_SECONDS ?? '0', 10) * 1000;
    const result = { batchItemFailures: [] };
    const getOctokitCached = (0, lambda_github_1.cachedGetOctokit)();
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
        // get github access
        const { octokit, githubSecrets: secrets } = await getOctokitCached(input.installationId);
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
        // reject bad deadlines to avoid spinning up too many warm runners.
        // missing deadline or further than any config allows - the deadline is all that ends a chain, so don't trust it and stop the runner.
        // a minute of slack covers clock differences between invocations.
        if (!Number.isFinite(input.absoluteDeadline) || (maxDurationMs > 0 && input.absoluteDeadline > Date.now() + maxDurationMs + 60_000)) {
            console.error({
                notice: 'Warm runner deadline is invalid or further than the longest configured duration, stopping and deleting',
                configHash: input.configHash,
                runnerName: input.runnerName,
                absoluteDeadline: input.absoluteDeadline,
                maxDurationMs,
            });
            try {
                await stopAndDeleteRunner(input, octokit, secrets, 'WarmRunnerBadDeadline');
            }
            catch (e) {
                console.error({
                    notice: 'Failed to stop warm runner with bad deadline; it will self-terminate at idle timeout',
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
            // a runner that failed quickly without taking a job (e.g. broken provider config) will likely fail again, so back off.
            // anything else resets the back-off, including an idle runner that died after a while (e.g. spot interruption).
            const ranMs = (execution.stopDate ?? new Date()).getTime() - (execution.startDate ?? new Date()).getTime();
            const failed = !stillRunning && !runner?.busy && execution.status !== 'SUCCEEDED' && ranMs < FAST_FAILURE_MS;
            const previousFailures = Number.isInteger(input.failures) && input.failures > 0 ? input.failures : 0;
            const failures = failed ? previousFailures + 1 : 0;
            console.log({
                notice: 'Warm runner finished or busy; starting replacement',
                configHash: input.configHash,
                runnerName: input.runnerName,
                stillRunning,
                runnerBusy: runner?.busy ?? false,
                executionStatus: execution.status,
                failures,
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
                    failures,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2FybS1ydW5uZXItbWFuYWdlci5sYW1iZGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvd2FybS1ydW5uZXItbWFuYWdlci5sYW1iZGEudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFvV0EsMEJBMk9DO0FBL2tCRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBOEVHO0FBQ0gsK0NBQWlDO0FBQ2pDLG9EQUErSTtBQUMvSSxvREFBb0U7QUFHcEUsbURBQXdFO0FBQ3hFLG1EQUFrSDtBQUNsSCxxREFBeUQ7QUFFekQsTUFBTSxHQUFHLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFDNUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFFNUIsTUFBTSw2QkFBNkIsR0FBRyxFQUFFLENBQUM7QUFDekMsTUFBTSxvQkFBb0IsR0FBRyxFQUFFLENBQUM7QUFDaEMsTUFBTSx3QkFBd0IsR0FBRyxHQUFHLENBQUMsQ0FBQyxjQUFjO0FBQ3BELE1BQU0sZUFBZSxHQUFHLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDO0FBNkJ0QyxTQUFTLFVBQVUsQ0FBQyxLQUFjO0lBQ2hDLE9BQU8sS0FBSyxDQUFDLE9BQU8sQ0FBRSxLQUE0QixDQUFDLE9BQU8sQ0FBQyxDQUFDO0FBQzlELENBQUM7QUFFRCxTQUFTLFdBQVcsQ0FBQyxLQUFjO0lBQ2pDLE9BQU8sT0FBTyxLQUFLLEtBQUssUUFBUSxJQUFJLEtBQUssS0FBSyxJQUFJLElBQUssS0FBK0IsQ0FBQyxNQUFNLEtBQUssTUFBTSxDQUFDO0FBQzNHLENBQUM7QUFFRCxTQUFTLHFCQUFxQixDQUFDLEtBQWM7SUFDM0MsTUFBTSxDQUFDLEdBQUcsS0FBb0QsQ0FBQztJQUMvRCxPQUFPLE9BQU8sQ0FBQyxF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O0lBQ2YsQ0FBQztJQUVELE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIFdhcm0gUnVubmVyIE1hbmFnZXIgTGFtYmRhXG4gKlxuICogTWFpbnRhaW5zIGEgcG9vbCBvZiBwcmUtcHJvdmlzaW9uZWQgKFwid2FybVwiKSBHaXRIdWIgc2VsZi1ob3N0ZWQgcnVubmVycyBzbyBqb2JzXG4gKiBzdGFydCB3aXRoIG5lYXItemVybyBsYXRlbmN5IGluc3RlYWQgb2Ygd2FpdGluZyBmb3IgYSBmcmVzaCBydW5uZXIgdG8gcHJvdmlzaW9uLlxuICpcbiAqICMjIExpZmVjeWNsZVxuICpcbiAqIDEuICoqRmlsbCoqIOKAlCBBbiBFdmVudEJyaWRnZSBjcm9uIHJ1bGUgKG1pZG5pZ2h0IFVUQyBmb3IgYWx3YXlzLW9uLCBvciB3aW5kb3dcbiAqICAgIHN0YXJ0IGZvciBzY2hlZHVsZWQpIHNlbmRzIGEgZmlsbCBwYXlsb2FkIHRvIHRoZSBzaGFyZWQgU1FTIHF1ZXVlLiBGb3JcbiAqICAgIEFsd2F5c09uV2FybVJ1bm5lciBvbmx5LCBhIENsb3VkRm9ybWF0aW9uIGN1c3RvbSByZXNvdXJjZSAob24gZGVwbG95KVxuICogICAgaW52b2tlcyB0aGlzIExhbWJkYSBkaXJlY3RseSB0byBmaWxsIGltbWVkaWF0ZWx5OyB0aGUgZGVhZGxpbmUgaXMgc2V0IHRvXG4gKiAgICB0aGUgbmV4dCBtaWRuaWdodCBVVEMgKG5vdCBmdWxsIDI0aCkgc28gcnVubmVycyBsYXN0IHVudGlsIHRoZSBuZXh0IGNyb25cbiAqICAgIGZpbGwuIFNjaGVkdWxlZFdhcm1SdW5uZXIgaGFzIG5vIGRlcGxveW1lbnQtZmlsbCDigJQgZmlyc3QgZmlsbCBpcyBhdCB0aGVcbiAqICAgIG5leHQgc2NoZWR1bGUgb2NjdXJyZW5jZS5cbiAqXG4gKiAyLiAqKktlZXBlcioqIOKAlCBFYWNoIGtlZXBlciBtZXNzYWdlIHRyYWNrcyBvbmUgcnVubmVyLiBUaGUgU1FTIHF1ZXVlIGRlbGl2ZXJzIHRoZVxuICogICAgbWVzc2FnZSwgdGhpcyBMYW1iZGEgaW5zcGVjdHMgdGhlIHJ1bm5lciwgYW5kIG9uZSBvZiB0aGUgZm9sbG93aW5nIGhhcHBlbnM6XG4gKiAgICAtIFJ1bm5lciBpcyBwYXN0IGl0cyBkZWFkbGluZSDihpIgdGhlIGtlZXBlciBzdG9wcyB0aGUgU3RlcCBGdW5jdGlvbiBhbmQgZGVsZXRlc1xuICogICAgICB0aGUgcnVubmVyLiBObyByZXBsYWNlbWVudCBpcyBjcmVhdGVkLlxuICogICAgLSBSdW5uZXIgaXMgaWRsZSBhbmQgd2l0aGluIGRlYWRsaW5lIOKGkiBtZXNzYWdlIGlzIHJldHVybmVkIHRvIHRoZSBxdWV1ZVxuICogICAgICAodmlhIGJhdGNoIGl0ZW0gZmFpbHVyZSkgdG8gYmUgY2hlY2tlZCBhZ2FpbiBhZnRlciB0aGUgdmlzaWJpbGl0eSB0aW1lb3V0LlxuICogICAgLSBSdW5uZXIgaXMgYnVzeSBvciBpdHMgU3RlcCBGdW5jdGlvbiBmaW5pc2hlZCDihpIgYSByZXBsYWNlbWVudCBydW5uZXIgaXNcbiAqICAgICAgc3RhcnRlZCB3aXRoIHRoZSBzYW1lIGRlYWRsaW5lLCBhbmQgYSBuZXcga2VlcGVyIG1lc3NhZ2UgaXMgZW5xdWV1ZWQuXG4gKiAgICAtIENvbmZpZyBoYXNoIG1pc21hdGNoIChjb25maWcgd2FzIGNoYW5nZWQvcmVtb3ZlZCBzaW5jZSB0aGlzIHJ1bm5lciB3YXNcbiAqICAgICAgY3JlYXRlZCkg4oaSIHRoZSBydW5uZXIgaXMgc3RvcHBlZCBhbmQgZGVsZXRlZC4gTm8gcmVwbGFjZW1lbnQgaXMgY3JlYXRlZC5cbiAqICAgICAgVGhpcyBpcyBob3cgb2xkIHJ1bm5lcnMgYXJlIGNsZWFuZWQgdXAgcXVpY2tseSBvbiBjb25maWcgY2hhbmdlcy5cbiAqXG4gKiAzLiAqKlNodXRkb3duIG1lY2hhbmlzbXMqKiDigJQgVGhlIGtlZXBlciBpcyB0aGUgcHJpbWFyeSBtZWNoYW5pc20gZm9yIGVuZm9yY2luZyB0aGVcbiAqICAgIGFic29sdXRlIGRlYWRsaW5lOiB3aGVuIGEgcnVubmVyIGlzIHBhc3QgaXRzIGRlYWRsaW5lLCB0aGUga2VlcGVyIHN0b3BzIHRoZVxuICogICAgU3RlcCBGdW5jdGlvbiBhbmQgZGVsZXRlcyB0aGUgcnVubmVyLiBGYWxsYmFja3M6XG4gKiAgICAtICoqSWRsZSByZWFwZXIqKjogTWVhc3VyZXMgaWRsZSB0aW1lIGZyb20gd2hlbiBpdCBmaXJzdCBzZWVzIHRoZSBydW5uZXIgb25saW5lIGFuZFxuICogICAgICBpZGxlLCBub3Qgc3RlcCBmdW5jdGlvbiBzdGFydC4gU28gaXQgZmlyZXMgYXQgZGVhZGxpbmUgKyBwcm92aXNpb25pbmcgZGVsYXkuXG4gKiAgICAgIEl0J3MgYSBmYWxsYmFjayBpZiB0aGUga2VlcGVyIG1pc3NlcyBhIG1lc3NhZ2U7IGl0IGRvZXMgbm90IGVuZm9yY2UgdGhlXG4gKiAgICAgIGFic29sdXRlIGRlYWRsaW5lIHByZWNpc2VseS5cbiAqICAgIC0gKipTdGVwIEZ1bmN0aW9uIGlkbGUgdGltZW91dCoqOiBFYWNoIHJ1bm5lciBpcyBzdGFydGVkIHdpdGggYG1heElkbGVTZWNvbmRzYFxuICogICAgICBtYXRjaGluZyB0aGUgZGVhZGxpbmUuIElmIGJvdGgga2VlcGVyIGFuZCBpZGxlIHJlYXBlciBtaXNzIGl0LCB0aGUgU3RlcFxuICogICAgICBGdW5jdGlvbiB3aWxsIHNlbGYtdGVybWluYXRlIHdoZW4gaXRzIGlkbGUgdGltZW91dCBmaXJlcy5cbiAqXG4gKiAjIyBDb25maWcgaGFzaFxuICpcbiAqIEVhY2ggd2FybSBydW5uZXIgY29uZmlnIChwcm92aWRlciwgY291bnQsIGxhYmVscywgb3duZXIsIHJlcG8sIGR1cmF0aW9uKSBpc1xuICogaGFzaGVkIGF0IENESyBzeW50aCB0aW1lLiBBbGwgY3VycmVudCBoYXNoZXMgYXJlIHN0b3JlZCBpbiB0aGUgV0FSTV9DT05GSUdfSEFTSEVTXG4gKiBlbnZpcm9ubWVudCB2YXJpYWJsZS4gRmlsbCBwYXlsb2FkcyBhbmQga2VlcGVyIG1lc3NhZ2VzIGNhcnJ5IHRoZSBoYXNoLiBXaGVuIHRoZVxuICoga2VlcGVyIHByb2Nlc3NlcyBhIG1lc3NhZ2Ugd2hvc2UgaGFzaCBpcyBub3QgaW4gdGhlIGN1cnJlbnQgc2V0LCBpdCBrbm93cyB0aGVcbiAqIGNvbmZpZyB3YXMgY2hhbmdlZCBvciByZW1vdmVkIGFuZCBzdG9wcyB0aGUgcnVubmVyIGltbWVkaWF0ZWx5LiBUaGlzIGhlbHBzIHF1aWNrbHlcbiAqIGdldCByaWQgb2Ygc3RhbGUgcnVubmVycyB3aGlsZSBrZWVwaW5nIG92ZXItcHJvdmlzaW9uaW5nIHRvIGEgbWluaW11bS5cbiAqXG4gKiAjIyBHb3RjaGFzXG4gKlxuICogLSBLZWVwZXIgbWVzc2FnZXMgcmVseSBvbiBTUVMgcmVkZWxpdmVyeSAoYmF0Y2ggaXRlbSBmYWlsdXJlKSBmb3IgcGVyaW9kaWNcbiAqICAgY2hlY2tpbmcuIFRoZSB2aXNpYmlsaXR5IHRpbWVvdXQgKDEgbWluKSBkZXRlcm1pbmVzIGhvdyBvZnRlbiBydW5uZXJzIGFyZVxuICogICBwb2xsZWQuIEZhaWxlZCBtZXNzYWdlcyBhcmUgcmV0cmllZCB1bnRpbCB0aGV5IHN1Y2NlZWQgb3IgdGhlIHJ1bm5lclxuICogICBzZWxmLXRlcm1pbmF0ZXMgYXQgaXRzIGlkbGUgdGltZW91dC5cbiAqIC0gS2VlcGVyIG1lc3NhZ2VzIGVucXVldWUgdGhlaXIgb3duIHJlcGxhY2VtZW50LCB3aGljaCBpcyBhIExhbWJkYSAtPiBTUVMgLT4gTGFtYmRhXG4gKiAgIGxvb3AgYnkgZGVzaWduLiBBV1MgcmVjdXJzaXZlIGxvb3AgZGV0ZWN0aW9uIGlzIGRpc2FibGVkIGZvciB0aGlzIGZ1bmN0aW9uLCBzb1xuICogICB0aGUgbG9vcCBpcyByYXRlIGxpbWl0ZWQgaGVyZSBpbnN0ZWFkOiBuZXcga2VlcGVyIG1lc3NhZ2VzIGFyZSBkZWxheWVkIGJ5IGFcbiAqICAgbWludXRlLCBhbmQgdGhhdCBkZWxheSBkb3VibGVzICh1cCB0byAxNSBtaW51dGVzKSBmb3IgZXZlcnkgcnVubmVyIGluIGEgcm93IHRoYXRcbiAqICAgZmFpbGVkIHdpdGhpbiA1IG1pbnV0ZXMgd2l0aG91dCB0YWtpbmcgYSBqb2IuIFRoaXMga2VlcHMgYSBicm9rZW4gcHJvdmlkZXIgZnJvbVxuICogICBzdGFydGluZyBhIG5ldyBydW5uZXIgZXZlcnkgZmV3IHNlY29uZHMgdW50aWwgdGhlIGRlYWRsaW5lLiBBIHByb3ZpZGVyIHRoYXQgZmFpbHNcbiAqICAgc2xvd2VyIHRoYW4gdGhhdCBpcyBvbmx5IGxpbWl0ZWQgYnkgdGhlIG9uZSBtaW51dGUgZGVsYXkuIFRoYXQgb25lIG1pbnV0ZSBkZWxheVxuICogICBkb2Vzbid0IGRlbGF5IHRoZSBydW5uZXIgaXRzZWxmLCBidXQgb25seSB0aGUga2VlcGVyIG1lc3NhZ2Ugd2hpY2ggY2hlY2tzIGlmIGl0J3NcbiAqICAgYnVzeSBhbmQgbmVlZHMgdG8gYmUgcmVwbGFjZWQuIEEgcnVubmVyIHdvbid0IG5vcm1hbGx5IHN0YXJ0IG11Y2ggZmFzdGVyIHRoYW4gYVxuICogICBtaW51dGUgYW55d2F5IHNvIHRoaXMgZGVsYXkgZG9lc24ndCBpbXBhY3QgdGhlIHVzZXIgbXVjaC5cbiAqIC0gRWFjaCBmaWxsIHVuY29uZGl0aW9uYWxseSBzdGFydHMgYGNvdW50YCBydW5uZXJzIOKAlCBpdCBkb2VzIG5vdCBjaGVjayBob3cgbWFueVxuICogICBhcmUgYWxyZWFkeSBydW5uaW5nLiBPbiBjcm9uIGZpcmUsIHRoaXMgY3JlYXRlcyBhIGJyaWVmIG92ZXJsYXAgd2l0aCB0aGVcbiAqICAgcHJldmlvdXMgY3ljbGUncyBydW5uZXJzICh3aGljaCBhcmUgbmVhciB0aGVpciBkZWFkbGluZSkuXG4gKiAtIFJlbW92aW5nIGFsbCB3YXJtIHJ1bm5lcnMgY29uZmlndXJhdGlvbnMgbWF5IHJlc3VsdCBpbiB3YXJtIHJ1bm5lcnMgc3RheWluZ1xuICogICBhcm91bmQgdW50aWwgdGhleSBleHBpcmUuIFRvIHJlbW92ZSBhbGwgd2FybSBydW5uZXJzIHF1aWNrbHksIHNldCBjb3VudCB0byAwXG4gKiAgIGFuZCBkZXBsb3kuIE9ubHkgb25jZSBhbGwgdGhlIHdhcm0gcnVubmVycyBhcmUgc3RvcHBlZCwgeW91IGNhbiByZW1vdmUgYWxsXG4gKiAgIGNvbmZpZ3VyYXRpb25zIGFuZCBkZXBsb3kgYWdhaW4uXG4gKiAtICoqR2FwcyBpbiBjb3ZlcmFnZSoqOiBUaGUgU3RlcCBGdW5jdGlvbiB0aGF0IHByb3Zpc2lvbnMgZWFjaCB3YXJtIHJ1bm5lciB1c2VzXG4gKiAgIGluY3JlYXNpbmcgdGltZW91dHMgYmV0d2VlbiByZXRyaWVzIGZvciBwcm92aWRlciBmYWlsdXJlcyAoQ29kZUJ1aWxkIHRpbWVvdXQsXG4gKiAgIExhbWJkYSB0aW1lb3V0LCBjYXBhY2l0eSBlcnJvcnMsIGV0Yy4pLiBXaGlsZSBhIHdhcm0gcnVubmVyIHNsb3QgaXMgcmV0cnlpbmcsXG4gKiAgIHRoYXQgc2xvdCBoYXMgbm8gcnVubmVyLiBUaGlzIG1heSBjcmVhdGUgZ2FwcyBpbiBjb3ZlcmFnZS4gQW4gaWRsZSB3YXJtIHJ1bm5lclxuICogICB0aGF0IGZhaWxzIHRvIHByb3Zpc2lvbiAob3Igd2hvc2UgcmVwbGFjZW1lbnQgZmFpbHMpIHdpbGwgYmUgdW5hdmFpbGFibGUgdW50aWxcbiAqICAgdGhlIHJldHJ5IHN1Y2NlZWRzLiBDdXJyZW50IHJldHJ5IG1lY2hhbmlzbSBoYXMgYnVpbHQtaW4gYmFjay1vZmYgcmF0ZSBhbmQgY2FuXG4gKiAgIGJlIHR3ZWFrZWQgdXNpbmcgYHJldHJ5T3B0aW9uc2AuIFRoaXMgd2lsbCBiZSBpbXByb3ZlZCBpbiB0aGUgZnV0dXJlLlxuICovXG5pbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnY3J5cHRvJztcbmltcG9ydCB7IERlc2NyaWJlRXhlY3V0aW9uQ29tbWFuZCwgRXhlY3V0aW9uQWxyZWFkeUV4aXN0cywgU0ZOQ2xpZW50LCBTdGFydEV4ZWN1dGlvbkNvbW1hbmQsIFN0b3BFeGVjdXRpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNmbic7XG5pbXBvcnQgeyBTZW5kTWVzc2FnZUNvbW1hbmQsIFNRU0NsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xuaW1wb3J0IHR5cGUgeyBPY3Rva2l0IH0gZnJvbSAnQG9jdG9raXQvcmVzdCcgd2l0aCB7ICdyZXNvbHV0aW9uLW1vZGUnOiAnaW1wb3J0JyB9O1xuaW1wb3J0ICogYXMgQVdTTGFtYmRhIGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgT3JjaGVzdHJhdG9ySW5wdXQsIFdBUk1fUlVOTkVSX0pPQl9JRCB9IGZyb20gJy4vbGFtYmRhLWNvbW1vbic7XG5pbXBvcnQgeyBjYWNoZWRHZXRPY3Rva2l0LCBkZWxldGVSdW5uZXIsIGdldFJ1bm5lciwgR2l0SHViU2VjcmV0cywgcmVzb2x2ZUluc3RhbGxhdGlvbklkIH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcbmltcG9ydCB7IGN1c3RvbVJlc291cmNlUmVzcG9uZCB9IGZyb20gJy4vbGFtYmRhLWhlbHBlcnMnO1xuXG5jb25zdCBzZm4gPSBuZXcgU0ZOQ2xpZW50KCk7XG5jb25zdCBzcXMgPSBuZXcgU1FTQ2xpZW50KCk7XG5cbmNvbnN0IFNGTl9FWEVDVVRJT05fTkFNRV9NQVhfTEVOR1RIID0gODA7XG5jb25zdCBLRUVQRVJfREVMQVlfU0VDT05EUyA9IDYwO1xuY29uc3QgS0VFUEVSX01BWF9ERUxBWV9TRUNPTkRTID0gOTAwOyAvLyBTUVMgbWF4aW11bVxuY29uc3QgRkFTVF9GQUlMVVJFX01TID0gNSAqIDYwICogMTAwMDtcblxuZXhwb3J0IGludGVyZmFjZSBXYXJtUnVubmVyS2VlcGVyTWVzc2FnZSB7XG4gIHJlYWRvbmx5IGV4ZWN1dGlvbkFybjogc3RyaW5nO1xuICByZWFkb25seSBydW5uZXJOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IG93bmVyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJlcG86IHN0cmluZztcbiAgcmVhZG9ubHkgaW5zdGFsbGF0aW9uSWQ/OiBudW1iZXI7XG4gIHJlYWRvbmx5IHByb3ZpZGVyUGF0aDogc3RyaW5nO1xuICByZWFkb25seSBwcm92aWRlckxhYmVsczogc3RyaW5nW107XG4gIHJlYWRvbmx5IGFic29sdXRlRGVhZGxpbmU6IG51bWJlcjsgLy8gVW5peCBtcyDigJQgaW5oZXJpdGVkIGJ5IHJlcGxhY2VtZW50c1xuICByZWFkb25seSBjb25maWdIYXNoOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGZhaWx1cmVzPzogbnVtYmVyOyAvLyBjb25zZWN1dGl2ZSBmYWlsZWQgcnVubmVycyBpbiB0aGlzIHNsb3QgKGZvciBiYWNrLW9mZiBjYWxjdWxhdGlvbilcbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBXYXJtUnVubmVyRmlsbFBheWxvYWQge1xuICByZWFkb25seSBhY3Rpb246ICdmaWxsJztcbiAgcmVhZG9ubHkgcHJvdmlkZXJQYXRoOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHByb3ZpZGVyTGFiZWxzOiBzdHJpbmdbXTtcbiAgcmVhZG9ubHkgY291bnQ6IG51bWJlcjtcbiAgcmVhZG9ubHkgZHVyYXRpb246IG51bWJlcjtcbiAgcmVhZG9ubHkgb3duZXI6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVwbzogc3RyaW5nO1xuICByZWFkb25seSBjb25maWdIYXNoOiBzdHJpbmc7XG59XG5cbmZ1bmN0aW9uIGlzU3FzRXZlbnQoZXZlbnQ6IHVua25vd24pOiBldmVudCBpcyBBV1NMYW1iZGEuU1FTRXZlbnQge1xuICByZXR1cm4gQXJyYXkuaXNBcnJheSgoZXZlbnQgYXMgQVdTTGFtYmRhLlNRU0V2ZW50KS5SZWNvcmRzKTtcbn1cblxuZnVuY3Rpb24gaXNGaWxsSW5wdXQoZXZlbnQ6IHVua25vd24pOiBldmVudCBpcyBXYXJtUnVubmVyRmlsbFBheWxvYWQge1xuICByZXR1cm4gdHlwZW9mIGV2ZW50ID09PSAnb2JqZWN0JyAmJiBldmVudCAhPT0gbnVsbCAmJiAoZXZlbnQgYXMgV2FybVJ1bm5lckZpbGxQYXlsb2FkKS5hY3Rpb24gPT09ICdmaWxsJztcbn1cblxuZnVuY3Rpb24gaXNDdXN0b21SZXNvdXJjZUV2ZW50KGV2ZW50OiB1bmtub3duKTogZXZlbnQgaXMgQVdTTGFtYmRhLkNsb3VkRm9ybWF0aW9uQ3VzdG9tUmVzb3VyY2VFdmVudCB7XG4gIGNvbnN0IGUgPSBldmVudCBhcyBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50O1xuICByZXR1cm4gdHlwZW9mIGU/LlJlcXVlc3RUeXBlID09PSAnc3RyaW5nJyAmJiB0eXBlb2YgZT8uUmVzcG9uc2VVUkwgPT09ICdzdHJpbmcnO1xufVxuXG5mdW5jdGlvbiByZXF1aXJlRW52KG5hbWU6IHN0cmluZykge1xuICBjb25zdCB2YWx1ZSA9IHByb2Nlc3MuZW52W25hbWVdO1xuICBpZiAoIXZhbHVlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIGVudmlyb25tZW50IHZhcmlhYmxlICR7bmFtZX1gKTtcbiAgfVxuICByZXR1cm4gdmFsdWU7XG59XG5cbmludGVyZmFjZSBTdGFydFdhcm1SdW5uZXJJbnB1dCB7XG4gIHJlYWRvbmx5IHByb3ZpZGVyUGF0aDogc3RyaW5nO1xuICByZWFkb25seSBwcm92aWRlckxhYmVsczogc3RyaW5nW107XG4gIHJlYWRvbmx5IG93bmVyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJlcG86IHN0cmluZztcbiAgcmVhZG9ubHkgaW5zdGFsbGF0aW9uSWQ/OiBudW1iZXI7XG4gIHJlYWRvbmx5IGFic29sdXRlRGVhZGxpbmU6IG51bWJlcjsgLy8gVW5peCBtc1xuICByZWFkb25seSBjb25maWdIYXNoOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGV4ZWN1dGlvbk5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgc2xvdD86IG51bWJlcjsgLy8gMC1iYXNlZCBpbmRleCB3aGVuIGZpbGxpbmcgbXVsdGlwbGUgc2xvdHM7IGhlbHBzIGNvcnJlbGF0ZSBsb2dzXG4gIHJlYWRvbmx5IGZhaWx1cmVzPzogbnVtYmVyOyAvLyBjb25zZWN1dGl2ZSBmYWlsZWQgcnVubmVycyBpbiB0aGlzIHNsb3QgKGZvciBiYWNrLW9mZiBjYWxjdWxhdGlvbilcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmlzdGljIGV4ZWN1dGlvbiBuYW1lIGZvciBpZGVtcG90ZW50IGZpbGxzLiBTYW1lIHNlZWQg4oaSIHNhbWUgbmFtZSwgc28gcmV0cmllc1xuICogKGN1c3RvbSByZXNvdXJjZSwgU1FTIHJlZGVsaXZlcnkpIGRvbid0IGNyZWF0ZSBkdXBsaWNhdGUgcnVubmVycy5cbiAqL1xuZnVuY3Rpb24gZGV0ZXJtaW5pc3RpY0V4ZWN1dGlvbk5hbWUocHJvdmlkZXJQYXRoOiBzdHJpbmcsIHNlZWQ6IHN0cmluZykge1xuICBjb25zdCBwYXRoV2l0aG91dFN0YWNrID0gcHJvdmlkZXJQYXRoLnNwbGl0KCcvJykuc2xpY2UoMSkuam9pbignLycpIHx8IHByb3ZpZGVyUGF0aDtcbiAgY29uc3Qgc2FuaXRpemVkID0gYHdhcm0tJHtwYXRoV2l0aG91dFN0YWNrLnJlcGxhY2UoL1teYS16QS1aMC05LV0vZywgJy0nKX1gO1xuICBjb25zdCBoYXNoID0gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShzZWVkKS5kaWdlc3QoJ2hleCcpLnNsaWNlKDAsIDE2KTtcbiAgY29uc3QgbWF4UHJlZml4TGVuID0gU0ZOX0VYRUNVVElPTl9OQU1FX01BWF9MRU5HVEggLSBoYXNoLmxlbmd0aCAtIDE7XG4gIHJldHVybiBgJHtzYW5pdGl6ZWQuc2xpY2UoMCwgbWF4UHJlZml4TGVuKX0tJHtoYXNofWA7XG59XG5cbi8qKiBSZXR1cm5zIFVuaXggbXMgb2YgdGhlIG5leHQgbWlkbmlnaHQgVVRDLiBVc2VkIGZvciBBbHdheXNPbiBkZXBsb3ltZW50LWZpbGwgZGVhZGxpbmUuICovXG5mdW5jdGlvbiBnZXROZXh0TWlkbmlnaHRVdGNNcygpOiBudW1iZXIge1xuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICBjb25zdCBuZXh0TWlkbmlnaHQgPSBuZXcgRGF0ZShEYXRlLlVUQyhub3cuZ2V0VVRDRnVsbFllYXIoKSwgbm93LmdldFVUQ01vbnRoKCksIG5vdy5nZXRVVENEYXRlKCkgKyAxLCAwLCAwLCAwLCAwKSk7XG4gIHJldHVybiBuZXh0TWlkbmlnaHQuZ2V0VGltZSgpO1xufVxuXG4vKiogU3RhcnQgYSB3YXJtIHJ1bm5lciBhbmQgZW5xdWV1ZSBhIGtlZXBlciBtZXNzYWdlIHVzaW5nIFNRUy4gKi9cbmFzeW5jIGZ1bmN0aW9uIHN0YXJ0V2FybVJ1bm5lckFuZEVucXVldWVLZWVwZXIoaW5wdXQ6IFN0YXJ0V2FybVJ1bm5lcklucHV0KSB7XG4gIGNvbnN0IHN0ZXBGdW5jdGlvbkFybiA9IHJlcXVpcmVFbnYoJ1NURVBfRlVOQ1RJT05fQVJOJyk7XG4gIGNvbnN0IHF1ZXVlVXJsID0gcmVxdWlyZUVudignV0FSTV9SVU5ORVJfUVVFVUVfVVJMJyk7XG5cbiAgY29uc3QgcmVtYWluaW5nU2Vjb25kcyA9IE1hdGguZmxvb3IoKGlucHV0LmFic29sdXRlRGVhZGxpbmUgLSBEYXRlLm5vdygpKSAvIDEwMDApO1xuICBpZiAocmVtYWluaW5nU2Vjb25kcyA8PSAwKSB7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnQWJzb2x1dGUgZGVhZGxpbmUgYWxyZWFkeSBwYXNzZWQ7IG5vdCBzdGFydGluZyByZXBsYWNlbWVudCcsXG4gICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgcnVubmVyTmFtZTogaW5wdXQuZXhlY3V0aW9uTmFtZSxcbiAgICAgIGlucHV0LFxuICAgIH0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGxldCBleGVjdXRpb25Bcm46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBzZm4uc2VuZChuZXcgU3RhcnRFeGVjdXRpb25Db21tYW5kKHtcbiAgICAgIHN0YXRlTWFjaGluZUFybjogc3RlcEZ1bmN0aW9uQXJuLFxuICAgICAgbmFtZTogaW5wdXQuZXhlY3V0aW9uTmFtZSxcbiAgICAgIGlucHV0OiBKU09OLnN0cmluZ2lmeSg8T3JjaGVzdHJhdG9ySW5wdXQ+e1xuICAgICAgICBvd25lcjogaW5wdXQub3duZXIsXG4gICAgICAgIHJlcG86IGlucHV0LnJlcG8gfHwgJycsXG4gICAgICAgIGpvYklkOiBXQVJNX1JVTk5FUl9KT0JfSUQsXG4gICAgICAgIGpvYlVybDogJycsXG4gICAgICAgIGluc3RhbGxhdGlvbklkOiBpbnB1dC5pbnN0YWxsYXRpb25JZCA/PyAtMSxcbiAgICAgICAgam9iTGFiZWxzOiBpbnB1dC5wcm92aWRlckxhYmVscy5qb2luKCcsJyksXG4gICAgICAgIHByb3ZpZGVyOiBpbnB1dC5wcm92aWRlclBhdGgsXG4gICAgICAgIGxhYmVsczogWy4uLmlucHV0LnByb3ZpZGVyTGFiZWxzLCAnY2RrZ2hyOndhcm0nXS5qb2luKCcsJyksXG4gICAgICAgIG1heElkbGVTZWNvbmRzOiByZW1haW5pbmdTZWNvbmRzLFxuICAgICAgfSksXG4gICAgfSkpO1xuICAgIGV4ZWN1dGlvbkFybiA9IHJlc3VsdC5leGVjdXRpb25Bcm4hO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKGUgaW5zdGFuY2VvZiBFeGVjdXRpb25BbHJlYWR5RXhpc3RzKSB7XG4gICAgICAvLyBJZGVtcG90ZW50IHJldHJ5OiBleGVjdXRpb24gd2FzIGFscmVhZHkgc3RhcnRlZCAoZS5nLiBMYW1iZGEgdGltZWQgb3V0IG1pZC1maWxsKS5cbiAgICAgIC8vIERvbid0IGVucXVldWUuIFRoZSBmaXJzdCBhdHRlbXB0IGFscmVhZHkgZGlkLCBzbyBkdXBsaWNhdGUga2VlcGVyIG1lc3NhZ2VzIHdvdWxkIGNhdXNlIGR1cGxpY2F0ZSByZXBsYWNlbWVudHMuXG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ0V4ZWN1dGlvbkFscmVhZHlFeGlzdHMg4oCUIGlkZW1wb3RlbnQgcmV0cnksIHNraXBwaW5nIGVucXVldWUnLFxuICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICBzbG90OiBpbnB1dC5zbG90LFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5leGVjdXRpb25OYW1lLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGU7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgbWVzc2FnZTogV2FybVJ1bm5lcktlZXBlck1lc3NhZ2UgPSB7XG4gICAgZXhlY3V0aW9uQXJuLFxuICAgIHJ1bm5lck5hbWU6IGlucHV0LmV4ZWN1dGlvbk5hbWUsXG4gICAgb3duZXI6IGlucHV0Lm93bmVyLFxuICAgIHJlcG86IGlucHV0LnJlcG8sXG4gICAgaW5zdGFsbGF0aW9uSWQ6IGlucHV0Lmluc3RhbGxhdGlvbklkLFxuICAgIHByb3ZpZGVyUGF0aDogaW5wdXQucHJvdmlkZXJQYXRoLFxuICAgIHByb3ZpZGVyTGFiZWxzOiBpbnB1dC5wcm92aWRlckxhYmVscyxcbiAgICBhYnNvbHV0ZURlYWRsaW5lOiBpbnB1dC5hYnNvbHV0ZURlYWRsaW5lLFxuICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgZmFpbHVyZXM6IGlucHV0LmZhaWx1cmVzLFxuICB9O1xuXG4gIC8vIGRlbGF5IHRoZSBmaXJzdCBjaGVjayBzbyBhIHJ1bm5lciB0aGF0IGtlZXBzIGZhaWxpbmcgY2FuJ3Qgc3BpbiBpbiBhIHRpZ2h0IGxvb3Agb2YgcmVwbGFjZW1lbnRzXG4gIC8vIGJhY2sgb2ZmIGV4cG9uZW50aWFsbHkgd2hpbGUgdGhlIHNsb3Qga2VlcHMgZmFpbGluZyAoYSBuZXcgcnVubmVyIGNhbid0IHJlZ2lzdGVyIGluIGxlc3MgdGhhbiBhIG1pbnV0ZSBhbnl3YXkpXG4gIGNvbnN0IGRlbGF5U2Vjb25kcyA9IE1hdGgubWluKEtFRVBFUl9ERUxBWV9TRUNPTkRTICogMiAqKiAoaW5wdXQuZmFpbHVyZXMgPz8gMCksIEtFRVBFUl9NQVhfREVMQVlfU0VDT05EUyk7XG5cbiAgYXdhaXQgc3FzLnNlbmQobmV3IFNlbmRNZXNzYWdlQ29tbWFuZCh7XG4gICAgUXVldWVVcmw6IHF1ZXVlVXJsLFxuICAgIE1lc3NhZ2VCb2R5OiBKU09OLnN0cmluZ2lmeShtZXNzYWdlKSxcbiAgICBEZWxheVNlY29uZHM6IGRlbGF5U2Vjb25kcyxcbiAgfSkpO1xuXG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdTdGFydGVkIHdhcm0gcnVubmVyIGFuZCBlbnF1ZXVlZCBrZWVwZXIgbWVzc2FnZScsXG4gICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICBzbG90OiBpbnB1dC5zbG90LFxuICAgIHJ1bm5lck5hbWU6IGlucHV0LmV4ZWN1dGlvbk5hbWUsXG4gICAgZXhlY3V0aW9uQXJuLFxuICAgIHJlbWFpbmluZ1NlY29uZHMsXG4gICAgZmFpbHVyZXM6IGlucHV0LmZhaWx1cmVzLFxuICAgIGRlbGF5U2Vjb25kcyxcbiAgfSk7XG59XG5cbi8qKlxuICogVW5jb25kaXRpb25hbGx5IHN0YXJ0cyBgY291bnRgIHdhcm0gcnVubmVycyBmb3IgdGhlIGdpdmVuIGNvbmZpZyBhbmQgZW5xdWV1ZXMga2VlcGVyIG1lc3NhZ2VzLlxuICpcbiAqIEBwYXJhbSBpbnB1dCB0aGUgZmlsbCBwYXlsb2FkXG4gKiBAcGFyYW0gZ2V0TmFtZUZvclNsb3QgYSBmdW5jdGlvbiB0byBnZW5lcmF0ZSBhIHVuaXF1ZSBhbmQgc3RhYmxlIGV4ZWN1dGlvbiBuYW1lIGZvciBlYWNoIHNsb3RcbiAqIEBwYXJhbSBzb3VyY2UgdGhlIHNvdXJjZSBvZiB0aGUgZmlsbCBmb3IgZGVidWdnaW5nIHB1cnBvc2VzXG4gKiBAcGFyYW0gYWJzb2x1dGVEZWFkbGluZU92ZXJyaWRlIGlmIHByb3ZpZGVkLCB1c2UgdGhpcyBpbnN0ZWFkIG9mIG5vdyArIGR1cmF0aW9uIChmb3IgQWx3YXlzT24gZGVwbG95bWVudC1maWxsKVxuICovXG5hc3luYyBmdW5jdGlvbiBydW5GaWxsZXIoaW5wdXQ6IFdhcm1SdW5uZXJGaWxsUGF5bG9hZCwgZ2V0TmFtZUZvclNsb3Q6IChzbG90OiBudW1iZXIpID0+IHN0cmluZywgc291cmNlOiBzdHJpbmcsIGFic29sdXRlRGVhZGxpbmVPdmVycmlkZT86IG51bWJlcikge1xuICBjb25zdCBpbnN0YWxsYXRpb25JZCA9IGF3YWl0IHJlc29sdmVJbnN0YWxsYXRpb25JZChpbnB1dC5vd25lciwgaW5wdXQucmVwbyk7XG4gIGNvbnN0IGFic29sdXRlRGVhZGxpbmUgPSBhYnNvbHV0ZURlYWRsaW5lT3ZlcnJpZGUgPz8gRGF0ZS5ub3coKSArIGlucHV0LmR1cmF0aW9uICogMTAwMDtcblxuICBmb3IgKGxldCBpID0gMDsgaSA8IGlucHV0LmNvdW50OyBpKyspIHtcbiAgICBhd2FpdCBzdGFydFdhcm1SdW5uZXJBbmRFbnF1ZXVlS2VlcGVyKHtcbiAgICAgIHByb3ZpZGVyUGF0aDogaW5wdXQucHJvdmlkZXJQYXRoLFxuICAgICAgcHJvdmlkZXJMYWJlbHM6IGlucHV0LnByb3ZpZGVyTGFiZWxzLFxuICAgICAgb3duZXI6IGlucHV0Lm93bmVyLFxuICAgICAgcmVwbzogaW5wdXQucmVwbyxcbiAgICAgIGluc3RhbGxhdGlvbklkLFxuICAgICAgYWJzb2x1dGVEZWFkbGluZSxcbiAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICBleGVjdXRpb25OYW1lOiBnZXROYW1lRm9yU2xvdChpKSxcbiAgICAgIHNsb3Q6IGksXG4gICAgfSk7XG4gIH1cblxuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnRmlsbCBjb21wbGV0ZSAtIHN0YXJ0ZWQgd2FybSBydW5uZXJzJyxcbiAgICBzb3VyY2UsXG4gICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICBwcm92aWRlclBhdGg6IGlucHV0LnByb3ZpZGVyUGF0aCxcbiAgICBzdGFydGVkOiBpbnB1dC5jb3VudCxcbiAgfSk7XG59XG5cbi8qKiBTdG9wIHRoZSBzdGVwIGZ1bmN0aW9uIGFuZCBkZWxldGUgdGhlIHJ1bm5lciBmcm9tIEdpdEh1Yi4gKi9cbmFzeW5jIGZ1bmN0aW9uIHN0b3BBbmREZWxldGVSdW5uZXIoaW5wdXQ6IFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlLCBvY3Rva2l0OiBPY3Rva2l0LCBzZWNyZXRzOiBHaXRIdWJTZWNyZXRzLCByZWFzb246IHN0cmluZykge1xuICB0cnkge1xuICAgIGF3YWl0IHNmbi5zZW5kKG5ldyBTdG9wRXhlY3V0aW9uQ29tbWFuZCh7XG4gICAgICBleGVjdXRpb25Bcm46IGlucHV0LmV4ZWN1dGlvbkFybixcbiAgICAgIGVycm9yOiByZWFzb24sXG4gICAgICBjYXVzZTogJ1dhcm0gcnVubmVyIHN0b3BwZWQgYnkga2VlcGVyJyxcbiAgICB9KSk7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnU3RvcHBlZCBzdGVwIGZ1bmN0aW9uJyxcbiAgICAgIG1ldHJpYzogJ1J1bm5lclN0b3BwZWQnLFxuICAgICAgcmVhc29uLFxuICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRpb25Bcm46IGlucHV0LmV4ZWN1dGlvbkFybixcbiAgICAgIHByb3ZpZGVyOiBpbnB1dC5wcm92aWRlclBhdGgsXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBzdG9wIHN0ZXAgZnVuY3Rpb24nLFxuICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICBleGVjdXRpb25Bcm46IGlucHV0LmV4ZWN1dGlvbkFybixcbiAgICAgIGVycm9yOiBlLFxuICAgICAgaW5wdXQsXG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBydW5uZXIgPSBhd2FpdCBnZXRSdW5uZXIob2N0b2tpdCwgc2VjcmV0cy5ydW5uZXJMZXZlbCwgaW5wdXQub3duZXIsIGlucHV0LnJlcG8sIGlucHV0LnJ1bm5lck5hbWUpO1xuICBpZiAocnVubmVyKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGRlbGV0ZVJ1bm5lcihvY3Rva2l0LCBzZWNyZXRzLnJ1bm5lckxldmVsLCBpbnB1dC5vd25lciwgaW5wdXQucmVwbywgcnVubmVyLmlkKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIGRlbGV0ZSBydW5uZXInLFxuICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICBydW5uZXJJZDogcnVubmVyLmlkLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgICAgaW5wdXQsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBXYXJtIHJ1bm5lciBtYW5hZ2VyIExhbWJkYSAtIGhhbmRsZXMgdGhyZWUgaW52b2NhdGlvbiBtb2RlczpcbiAqXG4gKiAxLiBDbG91ZEZvcm1hdGlvbiBDdXN0b20gUmVzb3VyY2UgLSB0cmlnZ2VyZWQgb24gc3RhY2sgZGVwbG95IChDcmVhdGUvVXBkYXRlKSBmb3IgQWx3YXlzT25XYXJtUnVubmVyIG9ubHkuIFJ1bnNcbiAqICAgIHJ1bkZpbGxlciB3aXRoIGRlYWRsaW5lID0gbmV4dCBtaWRuaWdodCBVVEMgc28gcnVubmVycyBsYXN0IHVudGlsIHRoZSBuZXh0IGNyb24gZmlsbC4gRGVsZXRlIGlzIGEgbm8tb3AuXG4gKiAyLiBTUVMgbWVzc2FnZXMgLSBmaWxsIG9yIGtlZXBlclxuICogICAgLSBGaWxsIC0gZnJvbSBFdmVudEJyaWRnZSBjcm9uLiBVc2VzIG1lc3NhZ2VJZCBmb3IgZGV0ZXJtaW5pc3RpYyBleGVjdXRpb24gbmFtZXMgKGlkZW1wb3RlbnQgb24gcmVkZWxpdmVyeSkuXG4gKiAgICAtIEtlZXBlciAtIHRyYWNrcyBvbmUgcnVubmVyLiBVc2VzIFNRUyBtZXNzYWdlIGN5Y2xpbmcgZm9yIHBlcmlvZGljIGNoZWNrcy5cbiAqICAgICAgRWFjaCBtZXNzYWdlIHRyYWNrcyBvbmUgd2FybSBydW5uZXIuIFRoZSBrZWVwZXIgY2hlY2tzOlxuICogICAgICAtIFBhc3QgZGVhZGxpbmUgLSBzdG9wIHRoZSBTdGVwIEZ1bmN0aW9uIGFuZCBkZWxldGUgdGhlIHJ1bm5lci5cbiAqICAgICAgLSBDb25maWcgaGFzaCAtIGlmIHRoZSBtZXNzYWdlJ3MgYGNvbmZpZ0hhc2hgIGRvZXNuJ3QgbWF0Y2ggdGhlIGN1cnJlbnQgYFdBUk1fQ09ORklHX0hBU0hFU2AgZW52IHZhciwgdGhlIHJ1bm5lciBpcyBmcm9tIGEgc3RhbGUgY29uZmlnIC0gc3RvcCBpdCBhbmQgZGlzY2FyZCB0aGUgbWVzc2FnZSB3aXRob3V0IHJlcGxhY2VtZW50LlxuICogICAgICAtIEJ1c3kvZmluaXNoZWQgLSBpZiB0aGUgU3RlcCBGdW5jdGlvbiBlbmRlZCBvciB0aGUgR2l0SHViIHJ1bm5lciBpcyBidXN5ICh0b29rIGEgam9iKSwgc3RhcnQgYSByZXBsYWNlbWVudCBydW5uZXIgKGluaGVyaXRpbmcgdGhlIHNhbWUgZGVhZGxpbmUgYW5kIGNvbmZpZyBoYXNoKS5cbiAqICAgICAgLSBOb3QgZm91bmQgeWV0IChydW5uZXIvaW5mcmFzdHJ1Y3R1cmUgc3RpbGwgc3RhcnRpbmcpIC0gcmV0cnkgbGF0ZXIgKG1lc3NhZ2UgZ29lcyBiYWNrIHRvIHF1ZXVlKS5cbiAqICAgICAgLSBTdGlsbCBpZGxlIC0gcmV0cnkgbGF0ZXIgdG8gY2hlY2sgYWdhaW4uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKGV2ZW50OiBBV1NMYW1iZGEuU1FTRXZlbnQgfCBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50KSB7XG4gIGlmIChpc0N1c3RvbVJlc291cmNlRXZlbnQoZXZlbnQpKSB7XG4gICAgY29uc3QgcGh5c2ljYWxJZCA9ICgnUGh5c2ljYWxSZXNvdXJjZUlkJyBpbiBldmVudCA/IGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCA6IHVuZGVmaW5lZCkgPz8gZXZlbnQuTG9naWNhbFJlc291cmNlSWQ7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHByb3BzID0gZXZlbnQuUmVzb3VyY2VQcm9wZXJ0aWVzIGFzIHVua25vd24gYXMgV2FybVJ1bm5lckZpbGxQYXlsb2FkO1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdDdXN0b20gcmVzb3VyY2UgZmlsbCcsXG4gICAgICAgIHJlcXVlc3RUeXBlOiBldmVudC5SZXF1ZXN0VHlwZSxcbiAgICAgICAgbG9naWNhbFJlc291cmNlSWQ6IGV2ZW50LkxvZ2ljYWxSZXNvdXJjZUlkLFxuICAgICAgICBjb25maWdIYXNoOiBwcm9wcy5jb25maWdIYXNoLFxuICAgICAgICBwcm92aWRlclBhdGg6IHByb3BzLnByb3ZpZGVyUGF0aCxcbiAgICAgICAgY291bnQ6IHByb3BzLmNvdW50LFxuICAgICAgfSk7XG4gICAgICBpZiAoZXZlbnQuUmVxdWVzdFR5cGUgPT09ICdDcmVhdGUnIHx8IGV2ZW50LlJlcXVlc3RUeXBlID09PSAnVXBkYXRlJykge1xuICAgICAgICBjb25zdCBnZXROYW1lRm9yU2xvdCA9IChzbG90OiBudW1iZXIpID0+XG4gICAgICAgICAgZGV0ZXJtaW5pc3RpY0V4ZWN1dGlvbk5hbWUocHJvcHMucHJvdmlkZXJQYXRoLCBgJHtldmVudC5Mb2dpY2FsUmVzb3VyY2VJZH06JHtldmVudC5SZXF1ZXN0VHlwZX06JHtwcm9wcy5jb25maWdIYXNofToke3Nsb3R9YCk7XG4gICAgICAgIGNvbnN0IGRlYWRsaW5lID0gZ2V0TmV4dE1pZG5pZ2h0VXRjTXMoKTtcbiAgICAgICAgYXdhaXQgcnVuRmlsbGVyKHByb3BzLCBnZXROYW1lRm9yU2xvdCwgJ2N1c3RvbVJlc291cmNlJywgZGVhZGxpbmUpO1xuICAgICAgfVxuICAgICAgYXdhaXQgY3VzdG9tUmVzb3VyY2VSZXNwb25kKGV2ZW50LCAnU1VDQ0VTUycsICdPSycsIHBoeXNpY2FsSWQsIHt9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHsgbm90aWNlOiAnQ3VzdG9tIHJlc291cmNlIGhhbmRsZXIgZmFpbGVkJywgZXJyb3I6IGUgfSk7XG4gICAgICBhd2FpdCBjdXN0b21SZXNvdXJjZVJlc3BvbmQoZXZlbnQsICdGQUlMRUQnLCAoZSBhcyBFcnJvcikubWVzc2FnZSB8fCAnSW50ZXJuYWwgRXJyb3InLCBwaHlzaWNhbElkLCB7fSk7XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuXG4gIGlmICghaXNTcXNFdmVudChldmVudCkpIHtcbiAgICBjb25zb2xlLmVycm9yKHsgbm90aWNlOiAnVW5rbm93biBldmVudCB0eXBlOyBpZ25vcmluZycsIGV2ZW50IH0pO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHZhbGlkSGFzaGVzID0gbmV3IFNldCgocHJvY2Vzcy5lbnYuV0FSTV9DT05GSUdfSEFTSEVTID8/ICcnKS5zcGxpdCgnLCcpLmZpbHRlcihCb29sZWFuKSk7XG4gIGNvbnN0IG1heER1cmF0aW9uTXMgPSBwYXJzZUludChwcm9jZXNzLmVudi5XQVJNX01BWF9EVVJBVElPTl9TRUNPTkRTID8/ICcwJywgMTApICogMTAwMDtcbiAgY29uc3QgcmVzdWx0OiBBV1NMYW1iZGEuU1FTQmF0Y2hSZXNwb25zZSA9IHsgYmF0Y2hJdGVtRmFpbHVyZXM6IFtdIH07XG4gIGNvbnN0IGdldE9jdG9raXRDYWNoZWQgPSBjYWNoZWRHZXRPY3Rva2l0KCk7XG5cbiAgZm9yIChjb25zdCByZWNvcmQgb2YgZXZlbnQuUmVjb3Jkcykge1xuICAgIGxldCBib2R5OiBXYXJtUnVubmVyS2VlcGVyTWVzc2FnZSB8IFdhcm1SdW5uZXJGaWxsUGF5bG9hZDtcbiAgICB0cnkge1xuICAgICAgYm9keSA9IEpTT04ucGFyc2UocmVjb3JkLmJvZHkpIGFzIFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlIHwgV2FybVJ1bm5lckZpbGxQYXlsb2FkO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICBub3RpY2U6ICdGYWlsZWQgdG8gcGFyc2UgbWVzc2FnZSBib2R5JyxcbiAgICAgICAgcmVxdWVzdElkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgcmV0cnlMYXRlciA9ICgpID0+IHJlc3VsdC5iYXRjaEl0ZW1GYWlsdXJlcy5wdXNoKHsgaXRlbUlkZW50aWZpZXI6IHJlY29yZC5tZXNzYWdlSWQgfSk7XG5cbiAgICBjb25zdCBpc0ZpbGwgPSBpc0ZpbGxJbnB1dChib2R5KTtcbiAgICBjb25zdCBjb25maWdIYXNoID0gKGJvZHkgYXMgV2FybVJ1bm5lckZpbGxQYXlsb2FkICYgV2FybVJ1bm5lcktlZXBlck1lc3NhZ2UpLmNvbmZpZ0hhc2g7XG4gICAgY29uc3QgcnVubmVyTmFtZSA9IGlzRmlsbCA/IHVuZGVmaW5lZCA6IChib2R5IGFzIFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlKS5ydW5uZXJOYW1lO1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ1Byb2Nlc3NpbmcgU1FTIG1lc3NhZ2UnLFxuICAgICAgbWVzc2FnZUlkOiByZWNvcmQubWVzc2FnZUlkLFxuICAgICAgY29uZmlnSGFzaCxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgfSk7XG5cbiAgICAvLyBzY2hlZHVsZWQgZmlsbCBmcm9tIEV2ZW50QnJpZGdlIHZpYSBTUVNcbiAgICBpZiAoaXNGaWxsKSB7XG4gICAgICBjb25zdCBmaWxsUGF5bG9hZCA9IGJvZHkgYXMgV2FybVJ1bm5lckZpbGxQYXlsb2FkO1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgIG5vdGljZTogJ1NjaGVkdWxlZCBmaWxsJyxcbiAgICAgICAgICBjb25maWdIYXNoLFxuICAgICAgICAgIHByb3ZpZGVyUGF0aDogZmlsbFBheWxvYWQucHJvdmlkZXJQYXRoLFxuICAgICAgICAgIGNvdW50OiBmaWxsUGF5bG9hZC5jb3VudCxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0IGdldE5hbWVGb3JTbG90ID0gKHNsb3Q6IG51bWJlcikgPT5cbiAgICAgICAgICBkZXRlcm1pbmlzdGljRXhlY3V0aW9uTmFtZShmaWxsUGF5bG9hZC5wcm92aWRlclBhdGgsIGAke3JlY29yZC5tZXNzYWdlSWR9OiR7c2xvdH1gKTtcbiAgICAgICAgYXdhaXQgcnVuRmlsbGVyKGZpbGxQYXlsb2FkLCBnZXROYW1lRm9yU2xvdCwgJ3NjaGVkdWxlZCcsIHVuZGVmaW5lZCk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgIG5vdGljZTogJ0ZpbGwgZmFpbGVkJyxcbiAgICAgICAgICBtZXNzYWdlSWQ6IHJlY29yZC5tZXNzYWdlSWQsXG4gICAgICAgICAgY29uZmlnSGFzaDogZmlsbFBheWxvYWQuY29uZmlnSGFzaCxcbiAgICAgICAgICBlcnJvcjogZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHJ5TGF0ZXIoKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIGtlZXBlciBtZXNzYWdlXG4gICAgY29uc3QgaW5wdXQgPSBib2R5IGFzIFdhcm1SdW5uZXJLZWVwZXJNZXNzYWdlO1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ0NoZWNraW5nIHdhcm0gcnVubmVyJyxcbiAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgIH0pO1xuXG4gICAgLy8gZ2V0IGdpdGh1YiBhY2Nlc3NcbiAgICBjb25zdCB7IG9jdG9raXQsIGdpdGh1YlNlY3JldHM6IHNlY3JldHMgfSA9IGF3YWl0IGdldE9jdG9raXRDYWNoZWQoaW5wdXQuaW5zdGFsbGF0aW9uSWQpO1xuXG4gICAgLy8gc3RhbGUgY29uZmlnIC0gYmVzdC1lZmZvcnQgc3RvcCwgdGhlbiBkaXNjYXJkIG1lc3NhZ2UgKHJ1bm5lciB3aWxsIHNlbGYtdGVybWluYXRlIGF0IGl0cyBpZGxlIHRpbWVvdXQpXG4gICAgaWYgKCF2YWxpZEhhc2hlcy5oYXMoaW5wdXQuY29uZmlnSGFzaCkpIHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnQ29uZmlnIGhhc2ggbWlzbWF0Y2ggKG5ldyBDREsgZGVwbG95bWVudCwgb2xkIHJ1bm5lcikgLSBzdG9wcGluZyBzdGFsZSB3YXJtIHJ1bm5lcicsXG4gICAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgIHZhbGlkSGFzaGVzOiB2YWxpZEhhc2hlcyxcbiAgICAgIH0pO1xuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBzdG9wQW5kRGVsZXRlUnVubmVyKGlucHV0LCBvY3Rva2l0LCBzZWNyZXRzLCAnU3RhbGVXYXJtUnVubmVyJyk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgIG5vdGljZTogJ0Jlc3QtZWZmb3J0IGNsZWFudXAgb2Ygc3RhbGUgd2FybSBydW5uZXIgZmFpbGVkOyBpdCB3aWxsIHNlbGYtdGVybWluYXRlIGF0IGlkbGUgdGltZW91dCcsXG4gICAgICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICAgIGVycm9yOiBlLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIHJlamVjdCBiYWQgZGVhZGxpbmVzIHRvIGF2b2lkIHNwaW5uaW5nIHVwIHRvbyBtYW55IHdhcm0gcnVubmVycy5cbiAgICAvLyBtaXNzaW5nIGRlYWRsaW5lIG9yIGZ1cnRoZXIgdGhhbiBhbnkgY29uZmlnIGFsbG93cyAtIHRoZSBkZWFkbGluZSBpcyBhbGwgdGhhdCBlbmRzIGEgY2hhaW4sIHNvIGRvbid0IHRydXN0IGl0IGFuZCBzdG9wIHRoZSBydW5uZXIuXG4gICAgLy8gYSBtaW51dGUgb2Ygc2xhY2sgY292ZXJzIGNsb2NrIGRpZmZlcmVuY2VzIGJldHdlZW4gaW52b2NhdGlvbnMuXG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoaW5wdXQuYWJzb2x1dGVEZWFkbGluZSkgfHwgKG1heER1cmF0aW9uTXMgPiAwICYmIGlucHV0LmFic29sdXRlRGVhZGxpbmUgPiBEYXRlLm5vdygpICsgbWF4RHVyYXRpb25NcyArIDYwXzAwMCkpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICBub3RpY2U6ICdXYXJtIHJ1bm5lciBkZWFkbGluZSBpcyBpbnZhbGlkIG9yIGZ1cnRoZXIgdGhhbiB0aGUgbG9uZ2VzdCBjb25maWd1cmVkIGR1cmF0aW9uLCBzdG9wcGluZyBhbmQgZGVsZXRpbmcnLFxuICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICBhYnNvbHV0ZURlYWRsaW5lOiBpbnB1dC5hYnNvbHV0ZURlYWRsaW5lLFxuICAgICAgICBtYXhEdXJhdGlvbk1zLFxuICAgICAgfSk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBzdG9wQW5kRGVsZXRlUnVubmVyKGlucHV0LCBvY3Rva2l0LCBzZWNyZXRzLCAnV2FybVJ1bm5lckJhZERlYWRsaW5lJyk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBzdG9wIHdhcm0gcnVubmVyIHdpdGggYmFkIGRlYWRsaW5lOyBpdCB3aWxsIHNlbGYtdGVybWluYXRlIGF0IGlkbGUgdGltZW91dCcsXG4gICAgICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICAgIGVycm9yOiBlLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIHBhc3QgZGVhZGxpbmUgLSBrZWVwZXIgbXVzdCBzdG9wIGFuZCBkZWxldGUgdGhlIHJ1bm5lclxuICAgIGlmIChEYXRlLm5vdygpID49IGlucHV0LmFic29sdXRlRGVhZGxpbmUpIHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnV2FybSBydW5uZXIgcGFzdCBkZWFkbGluZSwgc3RvcHBpbmcgYW5kIGRlbGV0aW5nJyxcbiAgICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgIH0pO1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgc3RvcEFuZERlbGV0ZVJ1bm5lcihpbnB1dCwgb2N0b2tpdCwgc2VjcmV0cywgJ1dhcm1SdW5uZXJFeHBpcmVkJyk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBzdG9wIGV4cGlyZWQgd2FybSBydW5uZXInLFxuICAgICAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgICBlcnJvcjogZSxcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIGRvbid0IHJldHJ5IHRvIG5vdCBhY2NpZGVudGFsbHkgY3JlYXRlIGEgbmV3IHJ1bm5lclxuICAgICAgICAvLyBpZGxlIHJlYXBlciB3aWxsIHRha2UgY2FyZSBvZiBpdCBzb29uIGVub3VnaFxuICAgICAgfVxuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gY2hlY2sgaWYgc3RlcCBmdW5jdGlvbiBpcyBzdGlsbCBydW5uaW5nXG4gICAgY29uc3QgZXhlY3V0aW9uID0gYXdhaXQgc2ZuLnNlbmQobmV3IERlc2NyaWJlRXhlY3V0aW9uQ29tbWFuZCh7IGV4ZWN1dGlvbkFybjogaW5wdXQuZXhlY3V0aW9uQXJuIH0pKTtcbiAgICBjb25zdCBzdGlsbFJ1bm5pbmcgPSBleGVjdXRpb24uc3RhdHVzID09PSAnUlVOTklORyc7XG5cbiAgICAvLyBmaW5kIHJ1bm5lclxuICAgIGNvbnN0IHJ1bm5lciA9IGF3YWl0IGdldFJ1bm5lcihvY3Rva2l0LCBzZWNyZXRzLnJ1bm5lckxldmVsLCBpbnB1dC5vd25lciwgaW5wdXQucmVwbywgaW5wdXQucnVubmVyTmFtZSk7XG5cbiAgICAvLyBuZWVkIHJlcGxhY2VtZW50OiBzdGVwIGZ1bmN0aW9uIGZpbmlzaGVkIChub3QgcnVubmluZykgb3IgcnVubmVyIHRvb2sgYSBqb2IgKGJ1c3kpXG4gICAgaWYgKCFzdGlsbFJ1bm5pbmcgfHwgcnVubmVyPy5idXN5KSB7XG4gICAgICAvLyBhIHJ1bm5lciB0aGF0IGZhaWxlZCBxdWlja2x5IHdpdGhvdXQgdGFraW5nIGEgam9iIChlLmcuIGJyb2tlbiBwcm92aWRlciBjb25maWcpIHdpbGwgbGlrZWx5IGZhaWwgYWdhaW4sIHNvIGJhY2sgb2ZmLlxuICAgICAgLy8gYW55dGhpbmcgZWxzZSByZXNldHMgdGhlIGJhY2stb2ZmLCBpbmNsdWRpbmcgYW4gaWRsZSBydW5uZXIgdGhhdCBkaWVkIGFmdGVyIGEgd2hpbGUgKGUuZy4gc3BvdCBpbnRlcnJ1cHRpb24pLlxuICAgICAgY29uc3QgcmFuTXMgPSAoZXhlY3V0aW9uLnN0b3BEYXRlID8/IG5ldyBEYXRlKCkpLmdldFRpbWUoKSAtIChleGVjdXRpb24uc3RhcnREYXRlID8/IG5ldyBEYXRlKCkpLmdldFRpbWUoKTtcbiAgICAgIGNvbnN0IGZhaWxlZCA9ICFzdGlsbFJ1bm5pbmcgJiYgIXJ1bm5lcj8uYnVzeSAmJiBleGVjdXRpb24uc3RhdHVzICE9PSAnU1VDQ0VFREVEJyAmJiByYW5NcyA8IEZBU1RfRkFJTFVSRV9NUztcbiAgICAgIGNvbnN0IHByZXZpb3VzRmFpbHVyZXMgPSBOdW1iZXIuaXNJbnRlZ2VyKGlucHV0LmZhaWx1cmVzKSAmJiBpbnB1dC5mYWlsdXJlcyEgPiAwID8gaW5wdXQuZmFpbHVyZXMhIDogMDtcbiAgICAgIGNvbnN0IGZhaWx1cmVzID0gZmFpbGVkID8gcHJldmlvdXNGYWlsdXJlcyArIDEgOiAwO1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdXYXJtIHJ1bm5lciBmaW5pc2hlZCBvciBidXN5OyBzdGFydGluZyByZXBsYWNlbWVudCcsXG4gICAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgIHN0aWxsUnVubmluZyxcbiAgICAgICAgcnVubmVyQnVzeTogcnVubmVyPy5idXN5ID8/IGZhbHNlLFxuICAgICAgICBleGVjdXRpb25TdGF0dXM6IGV4ZWN1dGlvbi5zdGF0dXMsXG4gICAgICAgIGZhaWx1cmVzLFxuICAgICAgfSk7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBzdGFydFdhcm1SdW5uZXJBbmRFbnF1ZXVlS2VlcGVyKHtcbiAgICAgICAgICBwcm92aWRlclBhdGg6IGlucHV0LnByb3ZpZGVyUGF0aCxcbiAgICAgICAgICBwcm92aWRlckxhYmVsczogaW5wdXQucHJvdmlkZXJMYWJlbHMsXG4gICAgICAgICAgb3duZXI6IGlucHV0Lm93bmVyLFxuICAgICAgICAgIHJlcG86IGlucHV0LnJlcG8sXG4gICAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IGlucHV0Lmluc3RhbGxhdGlvbklkLFxuICAgICAgICAgIGFic29sdXRlRGVhZGxpbmU6IGlucHV0LmFic29sdXRlRGVhZGxpbmUsXG4gICAgICAgICAgY29uZmlnSGFzaDogaW5wdXQuY29uZmlnSGFzaCxcbiAgICAgICAgICBleGVjdXRpb25OYW1lOiBkZXRlcm1pbmlzdGljRXhlY3V0aW9uTmFtZShpbnB1dC5wcm92aWRlclBhdGgsIHJlY29yZC5tZXNzYWdlSWQpLFxuICAgICAgICAgIGZhaWx1cmVzLFxuICAgICAgICB9KTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcih7XG4gICAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIHN0YXJ0IHJlcGxhY2VtZW50IHdhcm0gcnVubmVyJyxcbiAgICAgICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgICAgZXJyb3I6IGUsXG4gICAgICAgIH0pO1xuICAgICAgICByZXRyeUxhdGVyKCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBzdGVwIGZ1bmN0aW9uIHN0aWxsIHJ1bm5pbmcgYnV0IHJ1bm5lciBub3QgZm91bmQgeWV0XG4gICAgaWYgKCFydW5uZXIpIHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnUnVubmVyIG5vdCBydW5uaW5nIHlldCcsXG4gICAgICAgIGNvbmZpZ0hhc2g6IGlucHV0LmNvbmZpZ0hhc2gsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICB9KTtcbiAgICAgIHJldHJ5TGF0ZXIoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIHN0aWxsIGlkbGUgLSBjaGVjayBhZ2FpbiBsYXRlclxuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ1J1bm5lciBzdGlsbCBpZGxlIC0gd2lsbCBjaGVjayBhZ2FpbiBsYXRlcicsXG4gICAgICBjb25maWdIYXNoOiBpbnB1dC5jb25maWdIYXNoLFxuICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICB9KTtcbiAgICByZXRyeUxhdGVyKCk7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufVxuIl19