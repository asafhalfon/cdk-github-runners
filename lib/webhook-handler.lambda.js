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
exports.verifyBody = verifyBody;
exports.callProviderSelector = callProviderSelector;
exports.selectProvider = selectProvider;
exports.generateExecutionName = generateExecutionName;
exports.handler = handler;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_sfn_1 = require("@aws-sdk/client-sfn");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const lambda_common_1 = require("./lambda-common");
const lambda_github_1 = require("./lambda-github");
const lambda_helpers_1 = require("./lambda-helpers");
const lambda_tracker_1 = require("./lambda-tracker");
const lambdaClient = new client_lambda_1.LambdaClient();
const sf = new client_sfn_1.SFNClient();
const sqs = new client_sqs_1.SQSClient();
// TODO use @octokit/webhooks?
function getHeader(event, header) {
    // API Gateway doesn't lowercase headers (V1 event) but Lambda URLs do (V2 event) :(
    for (const headerName of Object.keys(event.headers)) {
        if (headerName.toLowerCase() === header.toLowerCase()) {
            return event.headers[headerName];
        }
    }
    return undefined;
}
/**
 * Exported for unit testing.
 * @internal
 */
function verifyBody(event, secret) {
    const sig = Buffer.from(getHeader(event, 'x-hub-signature-256') || '', 'utf8');
    if (!event.body) {
        throw new Error('No body');
    }
    let body;
    if (event.isBase64Encoded) {
        body = Buffer.from(event.body, 'base64');
    }
    else {
        body = Buffer.from(event.body || '', 'utf8');
    }
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body);
    const expectedSig = Buffer.from(`sha256=${hmac.digest('hex')}`, 'utf8');
    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
        throw new Error('Signature mismatch. Is the webhook secret correct?');
    }
    return body.toString();
}
async function isDeploymentPending(payload) {
    const statusesUrl = payload.deployment?.statuses_url;
    if (statusesUrl === undefined) {
        return false;
    }
    try {
        const { octokit } = await (0, lambda_github_1.getOctokit)(payload.installation?.id);
        const statuses = await octokit.request(statusesUrl);
        return statuses.data[0]?.state === 'waiting';
    }
    catch (e) {
        console.error({
            notice: 'Unable to check deployment. Try adding deployment read permission.',
            error: e,
        });
        return false;
    }
}
/**
 * Read the runner providers and their labels from the Lambda layer they are packed in.
 */
function loadProviders() {
    return JSON.parse(fs.readFileSync(lambda_common_1.PROVIDERS_PATH, 'utf-8'));
}
/**
 * Call the provider selector Lambda function if configured.
 * @internal
 */
async function callProviderSelector(payload, providers, defaultSelection) {
    if (!process.env.PROVIDER_SELECTOR_ARN) {
        return undefined;
    }
    const selectorInput = {
        payload: payload,
        providers: providers,
        defaultProvider: defaultSelection.provider,
        defaultLabels: defaultSelection.labels,
    };
    // don't catch errors -- the whole webhook handler will be retried on unhandled errors
    const result = await lambdaClient.send(new client_lambda_1.InvokeCommand({
        FunctionName: process.env.PROVIDER_SELECTOR_ARN,
        Payload: JSON.stringify(selectorInput),
    }));
    if (result.FunctionError) {
        const selectorResponsePayload = result.Payload ? Buffer.from(result.Payload).toString() : undefined;
        console.error({
            notice: 'Provider selector failed',
            functionError: result.FunctionError,
            payload: selectorResponsePayload,
        });
        throw new Error('Provider selector failed');
    }
    if (!result.Payload) {
        throw new Error('Provider selector returned no payload');
    }
    return JSON.parse(Buffer.from(result.Payload).toString());
}
/**
 * Exported for unit testing.
 * @internal
 */
async function selectProvider(payload, jobLabels, hook = callProviderSelector) {
    const providers = loadProviders();
    const matchingProviders = Object.keys(providers).filter(provider => (0, lambda_common_1.labelsMatch)(jobLabels, providers[provider]));
    const defaultProvider = matchingProviders[0];
    const defaultLabels = defaultProvider ? providers[defaultProvider] : undefined;
    const defaultSelection = { provider: defaultProvider, labels: defaultLabels };
    const selectorResult = await hook(payload, providers, defaultSelection);
    if (selectorResult === undefined) {
        if (matchingProviders.length > 1) {
            // GitHub may still give this job a runner from any of these providers, and its own runner to a job of any of them. the stolen runner
            // detector starts another runner for a job left without one that fits, but the job itself may end up on a provider nobody expected.
            console.warn({
                notice: 'Job labels match more than one provider, using the first one. Add labels to the job so it matches only one provider.',
                metric: 'MultipleProvidersMatched',
                jobLabels,
                providers: matchingProviders,
                provider: defaultProvider,
                jobUrl: payload.workflow_job.html_url,
            });
        }
        return defaultSelection;
    }
    console.log({
        notice: 'Before provider selector',
        provider: defaultProvider,
        labels: defaultLabels,
        jobLabels: jobLabels,
    });
    console.log({
        notice: 'After provider selector',
        provider: selectorResult.provider,
        labels: selectorResult.labels,
        jobLabels: jobLabels,
    });
    // any error here will fail the webhook and cause a retry so the selector has another chance to get it right
    if (selectorResult.provider !== undefined) {
        if (selectorResult.provider === '') {
            throw new Error('Provider selector returned empty provider');
        }
        if (!providers[selectorResult.provider]) {
            throw new Error(`Provider selector returned unknown provider ${selectorResult.provider}`);
        }
        if (selectorResult.labels === undefined || selectorResult.labels.length === 0) {
            throw new Error('Provider selector must return non-empty labels when provider is set');
        }
    }
    return selectorResult;
}
/**
 * Generate a unique execution name which is limited to 64 characters (also used as runner name).
 *
 * Exported for unit testing.
 *
 * @internal
 */
function generateExecutionName(event, payload) {
    const deliveryId = getHeader(event, 'x-github-delivery') ?? `${Math.random()}`;
    const repoNameTruncated = payload.repository.name.slice(0, lambda_common_1.MAX_RUNNER_NAME_LENGTH - deliveryId.length - 1);
    return `${repoNameTruncated}-${deliveryId}`;
}
async function handler(event) {
    if (!process.env.WEBHOOK_SECRET_ARN ||
        !process.env.STEP_FUNCTION_ARN ||
        !process.env.REQUIRE_SELF_HOSTED_LABEL ||
        !process.env.JOB_ASSIGNMENT_QUEUE_URL) {
        throw new Error('Missing environment variables');
    }
    const webhookSecret = (await (0, lambda_helpers_1.getSecretJsonValue)(process.env.WEBHOOK_SECRET_ARN)).webhookSecret;
    let body;
    try {
        body = verifyBody(event, webhookSecret);
    }
    catch (e) {
        console.error({
            notice: 'Bad signature',
            error: e,
        });
        return {
            statusCode: 403,
            body: 'Bad signature',
        };
    }
    if (getHeader(event, 'content-type') !== 'application/json') {
        console.error({
            notice: 'This webhook only accepts JSON payloads',
            contentType: getHeader(event, 'content-type'),
        });
        return {
            statusCode: 400,
            body: 'Expecting JSON payload',
        };
    }
    if (getHeader(event, 'x-github-event') === 'ping') {
        return {
            statusCode: 200,
            body: 'Pong',
        };
    }
    // if (getHeader(event, 'x-github-event') !== 'workflow_job' && getHeader(event, 'x-github-event') !== 'workflow_run') {
    //     console.error(`This webhook only accepts workflow_job and workflow_run, got ${getHeader(event, 'x-github-event')}`);
    if (getHeader(event, 'x-github-event') !== 'workflow_job') {
        console.error({
            notice: 'This webhook only accepts workflow_job',
            githubEvent: getHeader(event, 'x-github-event'),
        });
        return {
            statusCode: 200,
            body: 'Expecting workflow_job',
        };
    }
    const payload = JSON.parse(body);
    if (payload.action !== 'queued' && payload.action !== 'in_progress') {
        console.log({
            notice: `Ignoring action "${payload.action}", expecting "queued" or "in_progress"`,
            job: payload.workflow_job,
        });
        return {
            statusCode: 200,
            body: 'OK. No runner started (action is not "queued").',
        };
    }
    if (payload.action === 'in_progress') {
        if (payload.workflow_job.runner_group_name !== 'GitHub Actions') { // ignore non self-hosted runners
            // report a job being assigned to a runner to the stolen runner detector
            // this is a much more trustworthy and reliable source than our runner log shtick
            // sadly it's not enough for cases like repos where the app is not installed stealing our jobs
            if (payload.workflow_job.runner_name && payload.workflow_job.run_id && payload.workflow_job.id) {
                await sqs.send(new client_sqs_1.SendMessageCommand({
                    QueueUrl: process.env.JOB_ASSIGNMENT_QUEUE_URL,
                    // deduplicate on the runner name because the job reporter also sends the same message
                    // this message also has job id so it's better, and it will usually arrive first
                    // it may not arrive first when the webhook fails or gets delayed for some GH reason
                    // it may also not arrive at all if the job that steals the runner is from a non monitored repo
                    MessageGroupId: payload.workflow_job.runner_name,
                    MessageDeduplicationId: payload.workflow_job.runner_name,
                    MessageBody: JSON.stringify({
                        kind: 'report',
                        runnerName: payload.workflow_job.runner_name,
                        repo: `${payload.repository.owner.login}/${payload.repository.name}`,
                        workflowId: payload.workflow_job.run_id,
                        jobId: payload.workflow_job.id,
                    }),
                }));
            }
        }
        return {
            statusCode: 200,
            body: 'OK. No runner started (action is "in_progress").',
        };
    }
    if (process.env.REQUIRE_SELF_HOSTED_LABEL === '1' && !payload.workflow_job.labels.some((label) => label.toLowerCase() == 'self-hosted')) {
        console.log({
            notice: `Ignoring labels "${payload.workflow_job.labels}", expecting "self-hosted"`,
            job: payload.workflow_job,
        });
        return {
            statusCode: 200,
            body: 'OK. No runner started (no "self-hosted" label).',
        };
    }
    // Select provider and labels
    const selection = await selectProvider(payload, payload.workflow_job.labels);
    if (!selection.provider || !selection.labels) {
        console.log({
            notice: `Ignoring labels "${payload.workflow_job.labels}", as they don't match a supported runner provider`,
            job: payload.workflow_job,
        });
        return {
            statusCode: 200,
            body: 'OK. No runner started (no provider with matching labels).',
        };
    }
    // don't start runners for a deployment that's still pending as GitHub will send another event when it's ready
    if (await isDeploymentPending(payload)) {
        console.log({
            notice: 'Ignoring job as its deployment is still pending',
            job: payload.workflow_job,
        });
        return {
            statusCode: 200,
            body: 'OK. No runner started (deployment pending).',
        };
    }
    // start execution
    const executionName = generateExecutionName(event, payload);
    const idleTimeoutSeconds = process.env.IDLE_TIMEOUT_SECONDS ? parseInt(process.env.IDLE_TIMEOUT_SECONDS, 10) : 300; // default 5 minutes
    const input = {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        jobId: payload.workflow_job.id,
        jobUrl: payload.workflow_job.html_url,
        installationId: payload.installation?.id ?? -1, // always pass value because step function can't handle missing input
        jobLabels: payload.workflow_job.labels.join(','), // original labels requested by the job
        provider: selection.provider,
        labels: selection.labels.join(','), // labels to use when registering runner
        maxIdleSeconds: idleTimeoutSeconds,
    };
    // remember that this job is one we serve, before its runner can possibly exist.
    // best-effort on purpose. starting the runner matters more than being able to tell later that we started it.
    try {
        await (0, lambda_tracker_1.recordControlledJob)(input);
    }
    catch (e) {
        console.error({
            notice: 'Failed to record job for stolen runner detection. The runner will still start, but a runner that takes this job may be mistaken for a stolen one.',
            jobId: input.jobId,
            jobUrl: input.jobUrl,
            error: `${e}`,
        });
    }
    let executionArn;
    try {
        const execution = await sf.send(new client_sfn_1.StartExecutionCommand({
            stateMachineArn: process.env.STEP_FUNCTION_ARN,
            input: JSON.stringify(input),
            // name is not random so multiple execution of this webhook won't cause multiple builders to start
            name: executionName,
        }));
        executionArn = execution.executionArn;
    }
    catch (e) {
        if (e instanceof client_sfn_1.ExecutionAlreadyExists) {
            // this delivery already started a runner. happens when GitHub or our own redelivery function redelivers an
            // event we already handled. without this, every redelivery fails and gets redelivered again for hours.
            console.log({
                notice: 'Runner already started for this delivery',
                runnerName: executionName,
                job: payload.workflow_job,
            });
            return {
                statusCode: 200,
                body: 'OK. Runner already started for this delivery.',
            };
        }
        throw e;
    }
    console.log({
        notice: 'Started orchestrator',
        execution: executionArn,
        sfnInput: input,
        job: payload.workflow_job,
    });
    return {
        statusCode: 202,
        body: executionName,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViaG9vay1oYW5kbGVyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy93ZWJob29rLWhhbmRsZXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBaUNBLGdDQXVCQztBQWlDRCxvREFxQ0M7QUFNRCx3Q0FtREM7QUFTRCxzREFJQztBQUVELDBCQXVNQztBQTdZRCwrQ0FBaUM7QUFDakMsdUNBQXlCO0FBQ3pCLDBEQUFxRTtBQUNyRSxvREFBK0Y7QUFDL0Ysb0RBQW9FO0FBRXBFLG1EQUF5RztBQUN6RyxtREFBNkM7QUFDN0MscURBQXNEO0FBQ3RELHFEQUE0RTtBQUc1RSxNQUFNLFlBQVksR0FBRyxJQUFJLDRCQUFZLEVBQUUsQ0FBQztBQUN4QyxNQUFNLEVBQUUsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztBQUMzQixNQUFNLEdBQUcsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztBQUU1Qiw4QkFBOEI7QUFFOUIsU0FBUyxTQUFTLENBQUMsS0FBdUMsRUFBRSxNQUFjO0lBQ3hFLG9GQUFvRjtJQUNwRixLQUFLLE1BQU0sVUFBVSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDcEQsSUFBSSxVQUFVLENBQUMsV0FBVyxFQUFFLEtBQUssTUFBTSxDQUFDLFdBQVcsRUFBRSxFQUFFLENBQUM7WUFDdEQsT0FBTyxLQUFLLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ25DLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQWdCLFVBQVUsQ0FBQyxLQUF1QyxFQUFFLE1BQVc7SUFDN0UsTUFBTSxHQUFHLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLHFCQUFxQixDQUFDLElBQUksRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBRS9FLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUM3QixDQUFDO0lBRUQsSUFBSSxJQUFZLENBQUM7SUFDakIsSUFBSSxLQUFLLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDMUIsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztJQUMzQyxDQUFDO1NBQU0sQ0FBQztRQUNOLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLElBQUksRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQy9DLENBQUM7SUFFRCxNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsVUFBVSxDQUFDLFFBQVEsRUFBRSxNQUFNLENBQUMsQ0FBQztJQUNqRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2xCLE1BQU0sV0FBVyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFFeEUsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLFdBQVcsQ0FBQyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLEdBQUcsRUFBRSxXQUFXLENBQUMsRUFBRSxDQUFDO1FBQ25GLE1BQU0sSUFBSSxLQUFLLENBQUMsb0RBQW9ELENBQUMsQ0FBQztJQUN4RSxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7QUFDekIsQ0FBQztBQUVELEtBQUssVUFBVSxtQkFBbUIsQ0FBQyxPQUFZO0lBQzdDLE1BQU0sV0FBVyxHQUFHLE9BQU8sQ0FBQyxVQUFVLEVBQUUsWUFBWSxDQUFDO0lBQ3JELElBQUksV0FBVyxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQzlCLE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztJQUVELElBQUksQ0FBQztRQUNILE1BQU0sRUFBRSxPQUFPLEVBQUUsR0FBRyxNQUFNLElBQUEsMEJBQVUsRUFBQyxPQUFPLENBQUMsWUFBWSxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBQy9ELE1BQU0sUUFBUSxHQUFHLE1BQU0sT0FBTyxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUVwRCxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsS0FBSyxLQUFLLFNBQVMsQ0FBQztJQUMvQyxDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsb0VBQW9FO1lBQzVFLEtBQUssRUFBRSxDQUFDO1NBQ1QsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxhQUFhO0lBQ3BCLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsWUFBWSxDQUFDLDhCQUFjLEVBQUUsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUM5RCxDQUFDO0FBRUQ7OztHQUdHO0FBQ0ksS0FBSyxVQUFVLG9CQUFvQixDQUN4QyxPQUFZLEVBQ1osU0FBbUMsRUFDbkMsZ0JBQXdDO0lBRXhDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixFQUFFLENBQUM7UUFDdkMsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUVELE1BQU0sYUFBYSxHQUEwQjtRQUMzQyxPQUFPLEVBQUUsT0FBTztRQUNoQixTQUFTLEVBQUUsU0FBUztRQUNwQixlQUFlLEVBQUUsZ0JBQWdCLENBQUMsUUFBUTtRQUMxQyxhQUFhLEVBQUUsZ0JBQWdCLENBQUMsTUFBTTtLQUN2QyxDQUFDO0lBRUYsc0ZBQXNGO0lBQ3RGLE1BQU0sTUFBTSxHQUFHLE1BQU0sWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLDZCQUFhLENBQUM7UUFDdkQsWUFBWSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMscUJBQXFCO1FBQy9DLE9BQU8sRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLGFBQWEsQ0FBQztLQUN2QyxDQUFDLENBQUMsQ0FBQztJQUVKLElBQUksTUFBTSxDQUFDLGFBQWEsRUFBRSxDQUFDO1FBQ3pCLE1BQU0sdUJBQXVCLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztRQUNwRyxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ1osTUFBTSxFQUFFLDBCQUEwQjtZQUNsQyxhQUFhLEVBQUUsTUFBTSxDQUFDLGFBQWE7WUFDbkMsT0FBTyxFQUFFLHVCQUF1QjtTQUNqQyxDQUFDLENBQUM7UUFDSCxNQUFNLElBQUksS0FBSyxDQUFDLDBCQUEwQixDQUFDLENBQUM7SUFDOUMsQ0FBQztJQUVELElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDcEIsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO0lBQzNELENBQUM7SUFFRCxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQTJCLENBQUM7QUFDdEYsQ0FBQztBQUVEOzs7R0FHRztBQUNJLEtBQUssVUFBVSxjQUFjLENBQUMsT0FBWSxFQUFFLFNBQW1CLEVBQUUsSUFBSSxHQUFHLG9CQUFvQjtJQUNqRyxNQUFNLFNBQVMsR0FBRyxhQUFhLEVBQUUsQ0FBQztJQUNsQyxNQUFNLGlCQUFpQixHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsSUFBQSwyQkFBVyxFQUFDLFNBQVMsRUFBRSxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2pILE1BQU0sZUFBZSxHQUFHLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzdDLE1BQU0sYUFBYSxHQUFHLGVBQWUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7SUFDL0UsTUFBTSxnQkFBZ0IsR0FBRyxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBRSxDQUFDO0lBQzlFLE1BQU0sY0FBYyxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztJQUV4RSxJQUFJLGNBQWMsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUNqQyxJQUFJLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNqQyxxSUFBcUk7WUFDckksb0lBQW9JO1lBQ3BJLE9BQU8sQ0FBQyxJQUFJLENBQUM7Z0JBQ1gsTUFBTSxFQUFFLHNIQUFzSDtnQkFDOUgsTUFBTSxFQUFFLDBCQUEwQjtnQkFDbEMsU0FBUztnQkFDVCxTQUFTLEVBQUUsaUJBQWlCO2dCQUM1QixRQUFRLEVBQUUsZUFBZTtnQkFDekIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsUUFBUTthQUN0QyxDQUFDLENBQUM7UUFDTCxDQUFDO1FBQ0QsT0FBTyxnQkFBZ0IsQ0FBQztJQUMxQixDQUFDO0lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQztRQUNWLE1BQU0sRUFBRSwwQkFBMEI7UUFDbEMsUUFBUSxFQUFFLGVBQWU7UUFDekIsTUFBTSxFQUFFLGFBQWE7UUFDckIsU0FBUyxFQUFFLFNBQVM7S0FDckIsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQztRQUNWLE1BQU0sRUFBRSx5QkFBeUI7UUFDakMsUUFBUSxFQUFFLGNBQWMsQ0FBQyxRQUFRO1FBQ2pDLE1BQU0sRUFBRSxjQUFjLENBQUMsTUFBTTtRQUM3QixTQUFTLEVBQUUsU0FBUztLQUNyQixDQUFDLENBQUM7SUFFSCw0R0FBNEc7SUFDNUcsSUFBSSxjQUFjLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQzFDLElBQUksY0FBYyxDQUFDLFFBQVEsS0FBSyxFQUFFLEVBQUUsQ0FBQztZQUNuQyxNQUFNLElBQUksS0FBSyxDQUFDLDJDQUEyQyxDQUFDLENBQUM7UUFDL0QsQ0FBQztRQUNELElBQUksQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDeEMsTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsY0FBYyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFDNUYsQ0FBQztRQUNELElBQUksY0FBYyxDQUFDLE1BQU0sS0FBSyxTQUFTLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDOUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxRUFBcUUsQ0FBQyxDQUFDO1FBQ3pGLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxjQUFjLENBQUM7QUFDeEIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQWdCLHFCQUFxQixDQUFDLEtBQVUsRUFBRSxPQUFZO0lBQzVELE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxLQUFLLEVBQUUsbUJBQW1CLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO0lBQy9FLE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxzQ0FBc0IsR0FBRyxVQUFVLENBQUMsTUFBTSxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBQzNHLE9BQU8sR0FBRyxpQkFBaUIsSUFBSSxVQUFVLEVBQUUsQ0FBQztBQUM5QyxDQUFDO0FBRU0sS0FBSyxVQUFVLE9BQU8sQ0FBQyxLQUF1QztJQUNuRSxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0I7UUFDakMsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQjtRQUM5QixDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMseUJBQXlCO1FBQ3RDLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0IsRUFBRSxDQUFDO1FBQ3hDLE1BQU0sSUFBSSxLQUFLLENBQUMsK0JBQStCLENBQUMsQ0FBQztJQUNuRCxDQUFDO0lBRUQsTUFBTSxhQUFhLEdBQUcsQ0FBQyxNQUFNLElBQUEsbUNBQWtCLEVBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUMsYUFBYSxDQUFDO0lBRS9GLElBQUksSUFBSSxDQUFDO0lBQ1QsSUFBSSxDQUFDO1FBQ0gsSUFBSSxHQUFHLFVBQVUsQ0FBQyxLQUFLLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFDMUMsQ0FBQztJQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDWCxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ1osTUFBTSxFQUFFLGVBQWU7WUFDdkIsS0FBSyxFQUFFLENBQUM7U0FDVCxDQUFDLENBQUM7UUFDSCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsZUFBZTtTQUN0QixDQUFDO0lBQ0osQ0FBQztJQUVELElBQUksU0FBUyxDQUFDLEtBQUssRUFBRSxjQUFjLENBQUMsS0FBSyxrQkFBa0IsRUFBRSxDQUFDO1FBQzVELE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUseUNBQXlDO1lBQ2pELFdBQVcsRUFBRSxTQUFTLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQztTQUM5QyxDQUFDLENBQUM7UUFDSCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsd0JBQXdCO1NBQy9CLENBQUM7SUFDSixDQUFDO0lBRUQsSUFBSSxTQUFTLENBQUMsS0FBSyxFQUFFLGdCQUFnQixDQUFDLEtBQUssTUFBTSxFQUFFLENBQUM7UUFDbEQsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLE1BQU07U0FDYixDQUFDO0lBQ0osQ0FBQztJQUVELHdIQUF3SDtJQUN4SCwySEFBMkg7SUFDM0gsSUFBSSxTQUFTLENBQUMsS0FBSyxFQUFFLGdCQUFnQixDQUFDLEtBQUssY0FBYyxFQUFFLENBQUM7UUFDMUQsT0FBTyxDQUFDLEtBQUssQ0FBQztZQUNaLE1BQU0sRUFBRSx3Q0FBd0M7WUFDaEQsV0FBVyxFQUFFLFNBQVMsQ0FBQyxLQUFLLEVBQUUsZ0JBQWdCLENBQUM7U0FDaEQsQ0FBQyxDQUFDO1FBQ0gsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLHdCQUF3QjtTQUMvQixDQUFDO0lBQ0osQ0FBQztJQUVELE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7SUFFakMsSUFBSSxPQUFPLENBQUMsTUFBTSxLQUFLLFFBQVEsSUFBSSxPQUFPLENBQUMsTUFBTSxLQUFLLGFBQWEsRUFBRSxDQUFDO1FBQ3BFLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDVixNQUFNLEVBQUUsb0JBQW9CLE9BQU8sQ0FBQyxNQUFNLHdDQUF3QztZQUNsRixHQUFHLEVBQUUsT0FBTyxDQUFDLFlBQVk7U0FDMUIsQ0FBQyxDQUFDO1FBQ0gsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLGlEQUFpRDtTQUN4RCxDQUFDO0lBQ0osQ0FBQztJQUVELElBQUksT0FBTyxDQUFDLE1BQU0sS0FBSyxhQUFhLEVBQUUsQ0FBQztRQUNyQyxJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsaUJBQWlCLEtBQUssZ0JBQWdCLEVBQUUsQ0FBQyxDQUFDLGlDQUFpQztZQUNsRyx3RUFBd0U7WUFDeEUsaUZBQWlGO1lBQ2pGLDhGQUE4RjtZQUM5RixJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsV0FBVyxJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSxJQUFJLE9BQU8sQ0FBQyxZQUFZLENBQUMsRUFBRSxFQUFFLENBQUM7Z0JBQy9GLE1BQU0sR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLCtCQUFrQixDQUFDO29CQUNwQyxRQUFRLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyx3QkFBd0I7b0JBQzlDLHNGQUFzRjtvQkFDdEYsZ0ZBQWdGO29CQUNoRixvRkFBb0Y7b0JBQ3BGLCtGQUErRjtvQkFDL0YsY0FBYyxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsV0FBVztvQkFDaEQsc0JBQXNCLEVBQUUsT0FBTyxDQUFDLFlBQVksQ0FBQyxXQUFXO29CQUN4RCxXQUFXLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBc0I7d0JBQy9DLElBQUksRUFBRSxRQUFRO3dCQUNkLFVBQVUsRUFBRSxPQUFPLENBQUMsWUFBWSxDQUFDLFdBQVc7d0JBQzVDLElBQUksRUFBRSxHQUFHLE9BQU8sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEtBQUssSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRTt3QkFDcEUsVUFBVSxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTTt3QkFDdkMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsRUFBRTtxQkFDL0IsQ0FBQztpQkFDSCxDQUFDLENBQUMsQ0FBQztZQUNOLENBQUM7UUFDSCxDQUFDO1FBQ0QsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLGtEQUFrRDtTQUN6RCxDQUFDO0lBQ0osQ0FBQztJQUVELElBQUksT0FBTyxDQUFDLEdBQUcsQ0FBQyx5QkFBeUIsS0FBSyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFhLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsSUFBSSxhQUFhLENBQUMsRUFBRSxDQUFDO1FBQ2hKLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDVixNQUFNLEVBQUUsb0JBQW9CLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSw0QkFBNEI7WUFDbkYsR0FBRyxFQUFFLE9BQU8sQ0FBQyxZQUFZO1NBQzFCLENBQUMsQ0FBQztRQUNILE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRSxpREFBaUQ7U0FDeEQsQ0FBQztJQUNKLENBQUM7SUFFRCw2QkFBNkI7SUFDN0IsTUFBTSxTQUFTLEdBQUcsTUFBTSxjQUFjLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDN0UsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDN0MsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUNWLE1BQU0sRUFBRSxvQkFBb0IsT0FBTyxDQUFDLFlBQVksQ0FBQyxNQUFNLG9EQUFvRDtZQUMzRyxHQUFHLEVBQUUsT0FBTyxDQUFDLFlBQVk7U0FDMUIsQ0FBQyxDQUFDO1FBQ0gsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLDJEQUEyRDtTQUNsRSxDQUFDO0lBQ0osQ0FBQztJQUVELDhHQUE4RztJQUM5RyxJQUFJLE1BQU0sbUJBQW1CLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUN2QyxPQUFPLENBQUMsR0FBRyxDQUFDO1lBQ1YsTUFBTSxFQUFFLGlEQUFpRDtZQUN6RCxHQUFHLEVBQUUsT0FBTyxDQUFDLFlBQVk7U0FDMUIsQ0FBQyxDQUFDO1FBQ0gsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLDZDQUE2QztTQUNwRCxDQUFDO0lBQ0osQ0FBQztJQUVELGtCQUFrQjtJQUNsQixNQUFNLGFBQWEsR0FBRyxxQkFBcUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDNUQsTUFBTSxrQkFBa0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsb0JBQW9CO0lBQ3hJLE1BQU0sS0FBSyxHQUFzQjtRQUMvQixLQUFLLEVBQUUsT0FBTyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsS0FBSztRQUNyQyxJQUFJLEVBQUUsT0FBTyxDQUFDLFVBQVUsQ0FBQyxJQUFJO1FBQzdCLEtBQUssRUFBRSxPQUFPLENBQUMsWUFBWSxDQUFDLEVBQUU7UUFDOUIsTUFBTSxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsUUFBUTtRQUNyQyxjQUFjLEVBQUUsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDLEVBQUUscUVBQXFFO1FBQ3JILFNBQVMsRUFBRSxPQUFPLENBQUMsWUFBWSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsdUNBQXVDO1FBQ3pGLFFBQVEsRUFBRSxTQUFTLENBQUMsUUFBUTtRQUM1QixNQUFNLEVBQUUsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsd0NBQXdDO1FBQzVFLGNBQWMsRUFBRSxrQkFBa0I7S0FDbkMsQ0FBQztJQUVGLGdGQUFnRjtJQUNoRiw2R0FBNkc7SUFDN0csSUFBSSxDQUFDO1FBQ0gsTUFBTSxJQUFBLG9DQUFtQixFQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ25DLENBQUM7SUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ1gsT0FBTyxDQUFDLEtBQUssQ0FBQztZQUNaLE1BQU0sRUFBRSxtSkFBbUo7WUFDM0osS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1lBQ2xCLE1BQU0sRUFBRSxLQUFLLENBQUMsTUFBTTtZQUNwQixLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7U0FDZCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsSUFBSSxZQUFnQyxDQUFDO0lBQ3JDLElBQUksQ0FBQztRQUNILE1BQU0sU0FBUyxHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLGtDQUFxQixDQUFDO1lBQ3hELGVBQWUsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQjtZQUM5QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7WUFDNUIsa0dBQWtHO1lBQ2xHLElBQUksRUFBRSxhQUFhO1NBQ3BCLENBQUMsQ0FBQyxDQUFDO1FBQ0osWUFBWSxHQUFHLFNBQVMsQ0FBQyxZQUFZLENBQUM7SUFDeEMsQ0FBQztJQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDWCxJQUFJLENBQUMsWUFBWSxtQ0FBc0IsRUFBRSxDQUFDO1lBQ3hDLDJHQUEyRztZQUMzRyx1R0FBdUc7WUFDdkcsT0FBTyxDQUFDLEdBQUcsQ0FBQztnQkFDVixNQUFNLEVBQUUsMENBQTBDO2dCQUNsRCxVQUFVLEVBQUUsYUFBYTtnQkFDekIsR0FBRyxFQUFFLE9BQU8sQ0FBQyxZQUFZO2FBQzFCLENBQUMsQ0FBQztZQUNILE9BQU87Z0JBQ0wsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsSUFBSSxFQUFFLCtDQUErQzthQUN0RCxDQUFDO1FBQ0osQ0FBQztRQUNELE1BQU0sQ0FBQyxDQUFDO0lBQ1YsQ0FBQztJQUVELE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFDVixNQUFNLEVBQUUsc0JBQXNCO1FBQzlCLFNBQVMsRUFBRSxZQUFZO1FBQ3ZCLFFBQVEsRUFBRSxLQUFLO1FBQ2YsR0FBRyxFQUFFLE9BQU8sQ0FBQyxZQUFZO0tBQzFCLENBQUMsQ0FBQztJQUVILE9BQU87UUFDTCxVQUFVLEVBQUUsR0FBRztRQUNmLElBQUksRUFBRSxhQUFhO0tBQ3BCLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgeyBJbnZva2VDb21tYW5kLCBMYW1iZGFDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcbmltcG9ydCB7IEV4ZWN1dGlvbkFscmVhZHlFeGlzdHMsIFNGTkNsaWVudCwgU3RhcnRFeGVjdXRpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNmbic7XG5pbXBvcnQgeyBTUVNDbGllbnQsIFNlbmRNZXNzYWdlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xuaW1wb3J0ICogYXMgQVdTTGFtYmRhIGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgbGFiZWxzTWF0Y2gsIE1BWF9SVU5ORVJfTkFNRV9MRU5HVEgsIE9yY2hlc3RyYXRvcklucHV0LCBQUk9WSURFUlNfUEFUSCB9IGZyb20gJy4vbGFtYmRhLWNvbW1vbic7XG5pbXBvcnQgeyBnZXRPY3Rva2l0IH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcbmltcG9ydCB7IGdldFNlY3JldEpzb25WYWx1ZSB9IGZyb20gJy4vbGFtYmRhLWhlbHBlcnMnO1xuaW1wb3J0IHsgcmVjb3JkQ29udHJvbGxlZEpvYiwgUnVubmVyUmVwb3J0TWVzc2FnZSB9IGZyb20gJy4vbGFtYmRhLXRyYWNrZXInO1xuaW1wb3J0IHsgUHJvdmlkZXJTZWxlY3RvcklucHV0LCBQcm92aWRlclNlbGVjdG9yUmVzdWx0IH0gZnJvbSAnLi93ZWJob29rJztcblxuY29uc3QgbGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCgpO1xuY29uc3Qgc2YgPSBuZXcgU0ZOQ2xpZW50KCk7XG5jb25zdCBzcXMgPSBuZXcgU1FTQ2xpZW50KCk7XG5cbi8vIFRPRE8gdXNlIEBvY3Rva2l0L3dlYmhvb2tzP1xuXG5mdW5jdGlvbiBnZXRIZWFkZXIoZXZlbnQ6IEFXU0xhbWJkYS5BUElHYXRld2F5UHJveHlFdmVudFYyLCBoZWFkZXI6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIC8vIEFQSSBHYXRld2F5IGRvZXNuJ3QgbG93ZXJjYXNlIGhlYWRlcnMgKFYxIGV2ZW50KSBidXQgTGFtYmRhIFVSTHMgZG8gKFYyIGV2ZW50KSA6KFxuICBmb3IgKGNvbnN0IGhlYWRlck5hbWUgb2YgT2JqZWN0LmtleXMoZXZlbnQuaGVhZGVycykpIHtcbiAgICBpZiAoaGVhZGVyTmFtZS50b0xvd2VyQ2FzZSgpID09PSBoZWFkZXIudG9Mb3dlckNhc2UoKSkge1xuICAgICAgcmV0dXJuIGV2ZW50LmhlYWRlcnNbaGVhZGVyTmFtZV07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHBvcnRlZCBmb3IgdW5pdCB0ZXN0aW5nLlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2ZXJpZnlCb2R5KGV2ZW50OiBBV1NMYW1iZGEuQVBJR2F0ZXdheVByb3h5RXZlbnRWMiwgc2VjcmV0OiBhbnkpOiBzdHJpbmcge1xuICBjb25zdCBzaWcgPSBCdWZmZXIuZnJvbShnZXRIZWFkZXIoZXZlbnQsICd4LWh1Yi1zaWduYXR1cmUtMjU2JykgfHwgJycsICd1dGY4Jyk7XG5cbiAgaWYgKCFldmVudC5ib2R5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdObyBib2R5Jyk7XG4gIH1cblxuICBsZXQgYm9keTogQnVmZmVyO1xuICBpZiAoZXZlbnQuaXNCYXNlNjRFbmNvZGVkKSB7XG4gICAgYm9keSA9IEJ1ZmZlci5mcm9tKGV2ZW50LmJvZHksICdiYXNlNjQnKTtcbiAgfSBlbHNlIHtcbiAgICBib2R5ID0gQnVmZmVyLmZyb20oZXZlbnQuYm9keSB8fCAnJywgJ3V0ZjgnKTtcbiAgfVxuXG4gIGNvbnN0IGhtYWMgPSBjcnlwdG8uY3JlYXRlSG1hYygnc2hhMjU2Jywgc2VjcmV0KTtcbiAgaG1hYy51cGRhdGUoYm9keSk7XG4gIGNvbnN0IGV4cGVjdGVkU2lnID0gQnVmZmVyLmZyb20oYHNoYTI1Nj0ke2htYWMuZGlnZXN0KCdoZXgnKX1gLCAndXRmOCcpO1xuXG4gIGlmIChzaWcubGVuZ3RoICE9PSBleHBlY3RlZFNpZy5sZW5ndGggfHwgIWNyeXB0by50aW1pbmdTYWZlRXF1YWwoc2lnLCBleHBlY3RlZFNpZykpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1NpZ25hdHVyZSBtaXNtYXRjaC4gSXMgdGhlIHdlYmhvb2sgc2VjcmV0IGNvcnJlY3Q/Jyk7XG4gIH1cblxuICByZXR1cm4gYm9keS50b1N0cmluZygpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpc0RlcGxveW1lbnRQZW5kaW5nKHBheWxvYWQ6IGFueSkge1xuICBjb25zdCBzdGF0dXNlc1VybCA9IHBheWxvYWQuZGVwbG95bWVudD8uc3RhdHVzZXNfdXJsO1xuICBpZiAoc3RhdHVzZXNVcmwgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBvY3Rva2l0IH0gPSBhd2FpdCBnZXRPY3Rva2l0KHBheWxvYWQuaW5zdGFsbGF0aW9uPy5pZCk7XG4gICAgY29uc3Qgc3RhdHVzZXMgPSBhd2FpdCBvY3Rva2l0LnJlcXVlc3Qoc3RhdHVzZXNVcmwpO1xuXG4gICAgcmV0dXJuIHN0YXR1c2VzLmRhdGFbMF0/LnN0YXRlID09PSAnd2FpdGluZyc7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgIG5vdGljZTogJ1VuYWJsZSB0byBjaGVjayBkZXBsb3ltZW50LiBUcnkgYWRkaW5nIGRlcGxveW1lbnQgcmVhZCBwZXJtaXNzaW9uLicsXG4gICAgICBlcnJvcjogZSxcbiAgICB9KTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBSZWFkIHRoZSBydW5uZXIgcHJvdmlkZXJzIGFuZCB0aGVpciBsYWJlbHMgZnJvbSB0aGUgTGFtYmRhIGxheWVyIHRoZXkgYXJlIHBhY2tlZCBpbi5cbiAqL1xuZnVuY3Rpb24gbG9hZFByb3ZpZGVycygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4ge1xuICByZXR1cm4gSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmMoUFJPVklERVJTX1BBVEgsICd1dGYtOCcpKTtcbn1cblxuLyoqXG4gKiBDYWxsIHRoZSBwcm92aWRlciBzZWxlY3RvciBMYW1iZGEgZnVuY3Rpb24gaWYgY29uZmlndXJlZC5cbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY2FsbFByb3ZpZGVyU2VsZWN0b3IoXG4gIHBheWxvYWQ6IGFueSxcbiAgcHJvdmlkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4sXG4gIGRlZmF1bHRTZWxlY3Rpb246IFByb3ZpZGVyU2VsZWN0b3JSZXN1bHQsXG4pOiBQcm9taXNlPFByb3ZpZGVyU2VsZWN0b3JSZXN1bHQgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKCFwcm9jZXNzLmVudi5QUk9WSURFUl9TRUxFQ1RPUl9BUk4pIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgY29uc3Qgc2VsZWN0b3JJbnB1dDogUHJvdmlkZXJTZWxlY3RvcklucHV0ID0ge1xuICAgIHBheWxvYWQ6IHBheWxvYWQsXG4gICAgcHJvdmlkZXJzOiBwcm92aWRlcnMsXG4gICAgZGVmYXVsdFByb3ZpZGVyOiBkZWZhdWx0U2VsZWN0aW9uLnByb3ZpZGVyLFxuICAgIGRlZmF1bHRMYWJlbHM6IGRlZmF1bHRTZWxlY3Rpb24ubGFiZWxzLFxuICB9O1xuXG4gIC8vIGRvbid0IGNhdGNoIGVycm9ycyAtLSB0aGUgd2hvbGUgd2ViaG9vayBoYW5kbGVyIHdpbGwgYmUgcmV0cmllZCBvbiB1bmhhbmRsZWQgZXJyb3JzXG4gIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGxhbWJkYUNsaWVudC5zZW5kKG5ldyBJbnZva2VDb21tYW5kKHtcbiAgICBGdW5jdGlvbk5hbWU6IHByb2Nlc3MuZW52LlBST1ZJREVSX1NFTEVDVE9SX0FSTixcbiAgICBQYXlsb2FkOiBKU09OLnN0cmluZ2lmeShzZWxlY3RvcklucHV0KSxcbiAgfSkpO1xuXG4gIGlmIChyZXN1bHQuRnVuY3Rpb25FcnJvcikge1xuICAgIGNvbnN0IHNlbGVjdG9yUmVzcG9uc2VQYXlsb2FkID0gcmVzdWx0LlBheWxvYWQgPyBCdWZmZXIuZnJvbShyZXN1bHQuUGF5bG9hZCkudG9TdHJpbmcoKSA6IHVuZGVmaW5lZDtcbiAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgIG5vdGljZTogJ1Byb3ZpZGVyIHNlbGVjdG9yIGZhaWxlZCcsXG4gICAgICBmdW5jdGlvbkVycm9yOiByZXN1bHQuRnVuY3Rpb25FcnJvcixcbiAgICAgIHBheWxvYWQ6IHNlbGVjdG9yUmVzcG9uc2VQYXlsb2FkLFxuICAgIH0pO1xuICAgIHRocm93IG5ldyBFcnJvcignUHJvdmlkZXIgc2VsZWN0b3IgZmFpbGVkJyk7XG4gIH1cblxuICBpZiAoIXJlc3VsdC5QYXlsb2FkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdQcm92aWRlciBzZWxlY3RvciByZXR1cm5lZCBubyBwYXlsb2FkJyk7XG4gIH1cblxuICByZXR1cm4gSlNPTi5wYXJzZShCdWZmZXIuZnJvbShyZXN1bHQuUGF5bG9hZCkudG9TdHJpbmcoKSkgYXMgUHJvdmlkZXJTZWxlY3RvclJlc3VsdDtcbn1cblxuLyoqXG4gKiBFeHBvcnRlZCBmb3IgdW5pdCB0ZXN0aW5nLlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzZWxlY3RQcm92aWRlcihwYXlsb2FkOiBhbnksIGpvYkxhYmVsczogc3RyaW5nW10sIGhvb2sgPSBjYWxsUHJvdmlkZXJTZWxlY3Rvcik6IFByb21pc2U8UHJvdmlkZXJTZWxlY3RvclJlc3VsdD4ge1xuICBjb25zdCBwcm92aWRlcnMgPSBsb2FkUHJvdmlkZXJzKCk7XG4gIGNvbnN0IG1hdGNoaW5nUHJvdmlkZXJzID0gT2JqZWN0LmtleXMocHJvdmlkZXJzKS5maWx0ZXIocHJvdmlkZXIgPT4gbGFiZWxzTWF0Y2goam9iTGFiZWxzLCBwcm92aWRlcnNbcHJvdmlkZXJdKSk7XG4gIGNvbnN0IGRlZmF1bHRQcm92aWRlciA9IG1hdGNoaW5nUHJvdmlkZXJzWzBdO1xuICBjb25zdCBkZWZhdWx0TGFiZWxzID0gZGVmYXVsdFByb3ZpZGVyID8gcHJvdmlkZXJzW2RlZmF1bHRQcm92aWRlcl0gOiB1bmRlZmluZWQ7XG4gIGNvbnN0IGRlZmF1bHRTZWxlY3Rpb24gPSB7IHByb3ZpZGVyOiBkZWZhdWx0UHJvdmlkZXIsIGxhYmVsczogZGVmYXVsdExhYmVscyB9O1xuICBjb25zdCBzZWxlY3RvclJlc3VsdCA9IGF3YWl0IGhvb2socGF5bG9hZCwgcHJvdmlkZXJzLCBkZWZhdWx0U2VsZWN0aW9uKTtcblxuICBpZiAoc2VsZWN0b3JSZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChtYXRjaGluZ1Byb3ZpZGVycy5sZW5ndGggPiAxKSB7XG4gICAgICAvLyBHaXRIdWIgbWF5IHN0aWxsIGdpdmUgdGhpcyBqb2IgYSBydW5uZXIgZnJvbSBhbnkgb2YgdGhlc2UgcHJvdmlkZXJzLCBhbmQgaXRzIG93biBydW5uZXIgdG8gYSBqb2Igb2YgYW55IG9mIHRoZW0uIHRoZSBzdG9sZW4gcnVubmVyXG4gICAgICAvLyBkZXRlY3RvciBzdGFydHMgYW5vdGhlciBydW5uZXIgZm9yIGEgam9iIGxlZnQgd2l0aG91dCBvbmUgdGhhdCBmaXRzLCBidXQgdGhlIGpvYiBpdHNlbGYgbWF5IGVuZCB1cCBvbiBhIHByb3ZpZGVyIG5vYm9keSBleHBlY3RlZC5cbiAgICAgIGNvbnNvbGUud2Fybih7XG4gICAgICAgIG5vdGljZTogJ0pvYiBsYWJlbHMgbWF0Y2ggbW9yZSB0aGFuIG9uZSBwcm92aWRlciwgdXNpbmcgdGhlIGZpcnN0IG9uZS4gQWRkIGxhYmVscyB0byB0aGUgam9iIHNvIGl0IG1hdGNoZXMgb25seSBvbmUgcHJvdmlkZXIuJyxcbiAgICAgICAgbWV0cmljOiAnTXVsdGlwbGVQcm92aWRlcnNNYXRjaGVkJyxcbiAgICAgICAgam9iTGFiZWxzLFxuICAgICAgICBwcm92aWRlcnM6IG1hdGNoaW5nUHJvdmlkZXJzLFxuICAgICAgICBwcm92aWRlcjogZGVmYXVsdFByb3ZpZGVyLFxuICAgICAgICBqb2JVcmw6IHBheWxvYWQud29ya2Zsb3dfam9iLmh0bWxfdXJsLFxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBkZWZhdWx0U2VsZWN0aW9uO1xuICB9XG5cbiAgY29uc29sZS5sb2coe1xuICAgIG5vdGljZTogJ0JlZm9yZSBwcm92aWRlciBzZWxlY3RvcicsXG4gICAgcHJvdmlkZXI6IGRlZmF1bHRQcm92aWRlcixcbiAgICBsYWJlbHM6IGRlZmF1bHRMYWJlbHMsXG4gICAgam9iTGFiZWxzOiBqb2JMYWJlbHMsXG4gIH0pO1xuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnQWZ0ZXIgcHJvdmlkZXIgc2VsZWN0b3InLFxuICAgIHByb3ZpZGVyOiBzZWxlY3RvclJlc3VsdC5wcm92aWRlcixcbiAgICBsYWJlbHM6IHNlbGVjdG9yUmVzdWx0LmxhYmVscyxcbiAgICBqb2JMYWJlbHM6IGpvYkxhYmVscyxcbiAgfSk7XG5cbiAgLy8gYW55IGVycm9yIGhlcmUgd2lsbCBmYWlsIHRoZSB3ZWJob29rIGFuZCBjYXVzZSBhIHJldHJ5IHNvIHRoZSBzZWxlY3RvciBoYXMgYW5vdGhlciBjaGFuY2UgdG8gZ2V0IGl0IHJpZ2h0XG4gIGlmIChzZWxlY3RvclJlc3VsdC5wcm92aWRlciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgaWYgKHNlbGVjdG9yUmVzdWx0LnByb3ZpZGVyID09PSAnJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdQcm92aWRlciBzZWxlY3RvciByZXR1cm5lZCBlbXB0eSBwcm92aWRlcicpO1xuICAgIH1cbiAgICBpZiAoIXByb3ZpZGVyc1tzZWxlY3RvclJlc3VsdC5wcm92aWRlcl0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUHJvdmlkZXIgc2VsZWN0b3IgcmV0dXJuZWQgdW5rbm93biBwcm92aWRlciAke3NlbGVjdG9yUmVzdWx0LnByb3ZpZGVyfWApO1xuICAgIH1cbiAgICBpZiAoc2VsZWN0b3JSZXN1bHQubGFiZWxzID09PSB1bmRlZmluZWQgfHwgc2VsZWN0b3JSZXN1bHQubGFiZWxzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdQcm92aWRlciBzZWxlY3RvciBtdXN0IHJldHVybiBub24tZW1wdHkgbGFiZWxzIHdoZW4gcHJvdmlkZXIgaXMgc2V0Jyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHNlbGVjdG9yUmVzdWx0O1xufVxuXG4vKipcbiAqIEdlbmVyYXRlIGEgdW5pcXVlIGV4ZWN1dGlvbiBuYW1lIHdoaWNoIGlzIGxpbWl0ZWQgdG8gNjQgY2hhcmFjdGVycyAoYWxzbyB1c2VkIGFzIHJ1bm5lciBuYW1lKS5cbiAqXG4gKiBFeHBvcnRlZCBmb3IgdW5pdCB0ZXN0aW5nLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVFeGVjdXRpb25OYW1lKGV2ZW50OiBhbnksIHBheWxvYWQ6IGFueSk6IHN0cmluZyB7XG4gIGNvbnN0IGRlbGl2ZXJ5SWQgPSBnZXRIZWFkZXIoZXZlbnQsICd4LWdpdGh1Yi1kZWxpdmVyeScpID8/IGAke01hdGgucmFuZG9tKCl9YDtcbiAgY29uc3QgcmVwb05hbWVUcnVuY2F0ZWQgPSBwYXlsb2FkLnJlcG9zaXRvcnkubmFtZS5zbGljZSgwLCBNQVhfUlVOTkVSX05BTUVfTEVOR1RIIC0gZGVsaXZlcnlJZC5sZW5ndGggLSAxKTtcbiAgcmV0dXJuIGAke3JlcG9OYW1lVHJ1bmNhdGVkfS0ke2RlbGl2ZXJ5SWR9YDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQ6IEFXU0xhbWJkYS5BUElHYXRld2F5UHJveHlFdmVudFYyKTogUHJvbWlzZTxBV1NMYW1iZGEuQVBJR2F0ZXdheVByb3h5UmVzdWx0VjI+IHtcbiAgaWYgKCFwcm9jZXNzLmVudi5XRUJIT09LX1NFQ1JFVF9BUk4gfHxcbiAgICAhcHJvY2Vzcy5lbnYuU1RFUF9GVU5DVElPTl9BUk4gfHxcbiAgICAhcHJvY2Vzcy5lbnYuUkVRVUlSRV9TRUxGX0hPU1RFRF9MQUJFTCB8fFxuICAgICFwcm9jZXNzLmVudi5KT0JfQVNTSUdOTUVOVF9RVUVVRV9VUkwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ01pc3NpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzJyk7XG4gIH1cblxuICBjb25zdCB3ZWJob29rU2VjcmV0ID0gKGF3YWl0IGdldFNlY3JldEpzb25WYWx1ZShwcm9jZXNzLmVudi5XRUJIT09LX1NFQ1JFVF9BUk4pKS53ZWJob29rU2VjcmV0O1xuXG4gIGxldCBib2R5O1xuICB0cnkge1xuICAgIGJvZHkgPSB2ZXJpZnlCb2R5KGV2ZW50LCB3ZWJob29rU2VjcmV0KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnQmFkIHNpZ25hdHVyZScsXG4gICAgICBlcnJvcjogZSxcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNDAzLFxuICAgICAgYm9keTogJ0JhZCBzaWduYXR1cmUnLFxuICAgIH07XG4gIH1cblxuICBpZiAoZ2V0SGVhZGVyKGV2ZW50LCAnY29udGVudC10eXBlJykgIT09ICdhcHBsaWNhdGlvbi9qc29uJykge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnVGhpcyB3ZWJob29rIG9ubHkgYWNjZXB0cyBKU09OIHBheWxvYWRzJyxcbiAgICAgIGNvbnRlbnRUeXBlOiBnZXRIZWFkZXIoZXZlbnQsICdjb250ZW50LXR5cGUnKSxcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNDAwLFxuICAgICAgYm9keTogJ0V4cGVjdGluZyBKU09OIHBheWxvYWQnLFxuICAgIH07XG4gIH1cblxuICBpZiAoZ2V0SGVhZGVyKGV2ZW50LCAneC1naXRodWItZXZlbnQnKSA9PT0gJ3BpbmcnKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6ICdQb25nJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gaWYgKGdldEhlYWRlcihldmVudCwgJ3gtZ2l0aHViLWV2ZW50JykgIT09ICd3b3JrZmxvd19qb2InICYmIGdldEhlYWRlcihldmVudCwgJ3gtZ2l0aHViLWV2ZW50JykgIT09ICd3b3JrZmxvd19ydW4nKSB7XG4gIC8vICAgICBjb25zb2xlLmVycm9yKGBUaGlzIHdlYmhvb2sgb25seSBhY2NlcHRzIHdvcmtmbG93X2pvYiBhbmQgd29ya2Zsb3dfcnVuLCBnb3QgJHtnZXRIZWFkZXIoZXZlbnQsICd4LWdpdGh1Yi1ldmVudCcpfWApO1xuICBpZiAoZ2V0SGVhZGVyKGV2ZW50LCAneC1naXRodWItZXZlbnQnKSAhPT0gJ3dvcmtmbG93X2pvYicpIHtcbiAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgIG5vdGljZTogJ1RoaXMgd2ViaG9vayBvbmx5IGFjY2VwdHMgd29ya2Zsb3dfam9iJyxcbiAgICAgIGdpdGh1YkV2ZW50OiBnZXRIZWFkZXIoZXZlbnQsICd4LWdpdGh1Yi1ldmVudCcpLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiAnRXhwZWN0aW5nIHdvcmtmbG93X2pvYicsXG4gICAgfTtcbiAgfVxuXG4gIGNvbnN0IHBheWxvYWQgPSBKU09OLnBhcnNlKGJvZHkpO1xuXG4gIGlmIChwYXlsb2FkLmFjdGlvbiAhPT0gJ3F1ZXVlZCcgJiYgcGF5bG9hZC5hY3Rpb24gIT09ICdpbl9wcm9ncmVzcycpIHtcbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6IGBJZ25vcmluZyBhY3Rpb24gXCIke3BheWxvYWQuYWN0aW9ufVwiLCBleHBlY3RpbmcgXCJxdWV1ZWRcIiBvciBcImluX3Byb2dyZXNzXCJgLFxuICAgICAgam9iOiBwYXlsb2FkLndvcmtmbG93X2pvYixcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogJ09LLiBObyBydW5uZXIgc3RhcnRlZCAoYWN0aW9uIGlzIG5vdCBcInF1ZXVlZFwiKS4nLFxuICAgIH07XG4gIH1cblxuICBpZiAocGF5bG9hZC5hY3Rpb24gPT09ICdpbl9wcm9ncmVzcycpIHtcbiAgICBpZiAocGF5bG9hZC53b3JrZmxvd19qb2IucnVubmVyX2dyb3VwX25hbWUgIT09ICdHaXRIdWIgQWN0aW9ucycpIHsgLy8gaWdub3JlIG5vbiBzZWxmLWhvc3RlZCBydW5uZXJzXG4gICAgICAvLyByZXBvcnQgYSBqb2IgYmVpbmcgYXNzaWduZWQgdG8gYSBydW5uZXIgdG8gdGhlIHN0b2xlbiBydW5uZXIgZGV0ZWN0b3JcbiAgICAgIC8vIHRoaXMgaXMgYSBtdWNoIG1vcmUgdHJ1c3R3b3J0aHkgYW5kIHJlbGlhYmxlIHNvdXJjZSB0aGFuIG91ciBydW5uZXIgbG9nIHNodGlja1xuICAgICAgLy8gc2FkbHkgaXQncyBub3QgZW5vdWdoIGZvciBjYXNlcyBsaWtlIHJlcG9zIHdoZXJlIHRoZSBhcHAgaXMgbm90IGluc3RhbGxlZCBzdGVhbGluZyBvdXIgam9ic1xuICAgICAgaWYgKHBheWxvYWQud29ya2Zsb3dfam9iLnJ1bm5lcl9uYW1lICYmIHBheWxvYWQud29ya2Zsb3dfam9iLnJ1bl9pZCAmJiBwYXlsb2FkLndvcmtmbG93X2pvYi5pZCkge1xuICAgICAgICBhd2FpdCBzcXMuc2VuZChuZXcgU2VuZE1lc3NhZ2VDb21tYW5kKHtcbiAgICAgICAgICBRdWV1ZVVybDogcHJvY2Vzcy5lbnYuSk9CX0FTU0lHTk1FTlRfUVVFVUVfVVJMLFxuICAgICAgICAgIC8vIGRlZHVwbGljYXRlIG9uIHRoZSBydW5uZXIgbmFtZSBiZWNhdXNlIHRoZSBqb2IgcmVwb3J0ZXIgYWxzbyBzZW5kcyB0aGUgc2FtZSBtZXNzYWdlXG4gICAgICAgICAgLy8gdGhpcyBtZXNzYWdlIGFsc28gaGFzIGpvYiBpZCBzbyBpdCdzIGJldHRlciwgYW5kIGl0IHdpbGwgdXN1YWxseSBhcnJpdmUgZmlyc3RcbiAgICAgICAgICAvLyBpdCBtYXkgbm90IGFycml2ZSBmaXJzdCB3aGVuIHRoZSB3ZWJob29rIGZhaWxzIG9yIGdldHMgZGVsYXllZCBmb3Igc29tZSBHSCByZWFzb25cbiAgICAgICAgICAvLyBpdCBtYXkgYWxzbyBub3QgYXJyaXZlIGF0IGFsbCBpZiB0aGUgam9iIHRoYXQgc3RlYWxzIHRoZSBydW5uZXIgaXMgZnJvbSBhIG5vbiBtb25pdG9yZWQgcmVwb1xuICAgICAgICAgIE1lc3NhZ2VHcm91cElkOiBwYXlsb2FkLndvcmtmbG93X2pvYi5ydW5uZXJfbmFtZSxcbiAgICAgICAgICBNZXNzYWdlRGVkdXBsaWNhdGlvbklkOiBwYXlsb2FkLndvcmtmbG93X2pvYi5ydW5uZXJfbmFtZSxcbiAgICAgICAgICBNZXNzYWdlQm9keTogSlNPTi5zdHJpbmdpZnkoPFJ1bm5lclJlcG9ydE1lc3NhZ2U+e1xuICAgICAgICAgICAga2luZDogJ3JlcG9ydCcsXG4gICAgICAgICAgICBydW5uZXJOYW1lOiBwYXlsb2FkLndvcmtmbG93X2pvYi5ydW5uZXJfbmFtZSxcbiAgICAgICAgICAgIHJlcG86IGAke3BheWxvYWQucmVwb3NpdG9yeS5vd25lci5sb2dpbn0vJHtwYXlsb2FkLnJlcG9zaXRvcnkubmFtZX1gLFxuICAgICAgICAgICAgd29ya2Zsb3dJZDogcGF5bG9hZC53b3JrZmxvd19qb2IucnVuX2lkLFxuICAgICAgICAgICAgam9iSWQ6IHBheWxvYWQud29ya2Zsb3dfam9iLmlkLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9KSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiAnT0suIE5vIHJ1bm5lciBzdGFydGVkIChhY3Rpb24gaXMgXCJpbl9wcm9ncmVzc1wiKS4nLFxuICAgIH07XG4gIH1cblxuICBpZiAocHJvY2Vzcy5lbnYuUkVRVUlSRV9TRUxGX0hPU1RFRF9MQUJFTCA9PT0gJzEnICYmICFwYXlsb2FkLndvcmtmbG93X2pvYi5sYWJlbHMuc29tZSgobGFiZWw6IHN0cmluZykgPT4gbGFiZWwudG9Mb3dlckNhc2UoKSA9PSAnc2VsZi1ob3N0ZWQnKSkge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogYElnbm9yaW5nIGxhYmVscyBcIiR7cGF5bG9hZC53b3JrZmxvd19qb2IubGFiZWxzfVwiLCBleHBlY3RpbmcgXCJzZWxmLWhvc3RlZFwiYCxcbiAgICAgIGpvYjogcGF5bG9hZC53b3JrZmxvd19qb2IsXG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6ICdPSy4gTm8gcnVubmVyIHN0YXJ0ZWQgKG5vIFwic2VsZi1ob3N0ZWRcIiBsYWJlbCkuJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gU2VsZWN0IHByb3ZpZGVyIGFuZCBsYWJlbHNcbiAgY29uc3Qgc2VsZWN0aW9uID0gYXdhaXQgc2VsZWN0UHJvdmlkZXIocGF5bG9hZCwgcGF5bG9hZC53b3JrZmxvd19qb2IubGFiZWxzKTtcbiAgaWYgKCFzZWxlY3Rpb24ucHJvdmlkZXIgfHwgIXNlbGVjdGlvbi5sYWJlbHMpIHtcbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6IGBJZ25vcmluZyBsYWJlbHMgXCIke3BheWxvYWQud29ya2Zsb3dfam9iLmxhYmVsc31cIiwgYXMgdGhleSBkb24ndCBtYXRjaCBhIHN1cHBvcnRlZCBydW5uZXIgcHJvdmlkZXJgLFxuICAgICAgam9iOiBwYXlsb2FkLndvcmtmbG93X2pvYixcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogJ09LLiBObyBydW5uZXIgc3RhcnRlZCAobm8gcHJvdmlkZXIgd2l0aCBtYXRjaGluZyBsYWJlbHMpLicsXG4gICAgfTtcbiAgfVxuXG4gIC8vIGRvbid0IHN0YXJ0IHJ1bm5lcnMgZm9yIGEgZGVwbG95bWVudCB0aGF0J3Mgc3RpbGwgcGVuZGluZyBhcyBHaXRIdWIgd2lsbCBzZW5kIGFub3RoZXIgZXZlbnQgd2hlbiBpdCdzIHJlYWR5XG4gIGlmIChhd2FpdCBpc0RlcGxveW1lbnRQZW5kaW5nKHBheWxvYWQpKSB7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnSWdub3Jpbmcgam9iIGFzIGl0cyBkZXBsb3ltZW50IGlzIHN0aWxsIHBlbmRpbmcnLFxuICAgICAgam9iOiBwYXlsb2FkLndvcmtmbG93X2pvYixcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogJ09LLiBObyBydW5uZXIgc3RhcnRlZCAoZGVwbG95bWVudCBwZW5kaW5nKS4nLFxuICAgIH07XG4gIH1cblxuICAvLyBzdGFydCBleGVjdXRpb25cbiAgY29uc3QgZXhlY3V0aW9uTmFtZSA9IGdlbmVyYXRlRXhlY3V0aW9uTmFtZShldmVudCwgcGF5bG9hZCk7XG4gIGNvbnN0IGlkbGVUaW1lb3V0U2Vjb25kcyA9IHByb2Nlc3MuZW52LklETEVfVElNRU9VVF9TRUNPTkRTID8gcGFyc2VJbnQocHJvY2Vzcy5lbnYuSURMRV9USU1FT1VUX1NFQ09ORFMsIDEwKSA6IDMwMDsgLy8gZGVmYXVsdCA1IG1pbnV0ZXNcbiAgY29uc3QgaW5wdXQ6IE9yY2hlc3RyYXRvcklucHV0ID0ge1xuICAgIG93bmVyOiBwYXlsb2FkLnJlcG9zaXRvcnkub3duZXIubG9naW4sXG4gICAgcmVwbzogcGF5bG9hZC5yZXBvc2l0b3J5Lm5hbWUsXG4gICAgam9iSWQ6IHBheWxvYWQud29ya2Zsb3dfam9iLmlkLFxuICAgIGpvYlVybDogcGF5bG9hZC53b3JrZmxvd19qb2IuaHRtbF91cmwsXG4gICAgaW5zdGFsbGF0aW9uSWQ6IHBheWxvYWQuaW5zdGFsbGF0aW9uPy5pZCA/PyAtMSwgLy8gYWx3YXlzIHBhc3MgdmFsdWUgYmVjYXVzZSBzdGVwIGZ1bmN0aW9uIGNhbid0IGhhbmRsZSBtaXNzaW5nIGlucHV0XG4gICAgam9iTGFiZWxzOiBwYXlsb2FkLndvcmtmbG93X2pvYi5sYWJlbHMuam9pbignLCcpLCAvLyBvcmlnaW5hbCBsYWJlbHMgcmVxdWVzdGVkIGJ5IHRoZSBqb2JcbiAgICBwcm92aWRlcjogc2VsZWN0aW9uLnByb3ZpZGVyLFxuICAgIGxhYmVsczogc2VsZWN0aW9uLmxhYmVscy5qb2luKCcsJyksIC8vIGxhYmVscyB0byB1c2Ugd2hlbiByZWdpc3RlcmluZyBydW5uZXJcbiAgICBtYXhJZGxlU2Vjb25kczogaWRsZVRpbWVvdXRTZWNvbmRzLFxuICB9O1xuXG4gIC8vIHJlbWVtYmVyIHRoYXQgdGhpcyBqb2IgaXMgb25lIHdlIHNlcnZlLCBiZWZvcmUgaXRzIHJ1bm5lciBjYW4gcG9zc2libHkgZXhpc3QuXG4gIC8vIGJlc3QtZWZmb3J0IG9uIHB1cnBvc2UuIHN0YXJ0aW5nIHRoZSBydW5uZXIgbWF0dGVycyBtb3JlIHRoYW4gYmVpbmcgYWJsZSB0byB0ZWxsIGxhdGVyIHRoYXQgd2Ugc3RhcnRlZCBpdC5cbiAgdHJ5IHtcbiAgICBhd2FpdCByZWNvcmRDb250cm9sbGVkSm9iKGlucHV0KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIHJlY29yZCBqb2IgZm9yIHN0b2xlbiBydW5uZXIgZGV0ZWN0aW9uLiBUaGUgcnVubmVyIHdpbGwgc3RpbGwgc3RhcnQsIGJ1dCBhIHJ1bm5lciB0aGF0IHRha2VzIHRoaXMgam9iIG1heSBiZSBtaXN0YWtlbiBmb3IgYSBzdG9sZW4gb25lLicsXG4gICAgICBqb2JJZDogaW5wdXQuam9iSWQsXG4gICAgICBqb2JVcmw6IGlucHV0LmpvYlVybCxcbiAgICAgIGVycm9yOiBgJHtlfWAsXG4gICAgfSk7XG4gIH1cblxuICBsZXQgZXhlY3V0aW9uQXJuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHRyeSB7XG4gICAgY29uc3QgZXhlY3V0aW9uID0gYXdhaXQgc2Yuc2VuZChuZXcgU3RhcnRFeGVjdXRpb25Db21tYW5kKHtcbiAgICAgIHN0YXRlTWFjaGluZUFybjogcHJvY2Vzcy5lbnYuU1RFUF9GVU5DVElPTl9BUk4sXG4gICAgICBpbnB1dDogSlNPTi5zdHJpbmdpZnkoaW5wdXQpLFxuICAgICAgLy8gbmFtZSBpcyBub3QgcmFuZG9tIHNvIG11bHRpcGxlIGV4ZWN1dGlvbiBvZiB0aGlzIHdlYmhvb2sgd29uJ3QgY2F1c2UgbXVsdGlwbGUgYnVpbGRlcnMgdG8gc3RhcnRcbiAgICAgIG5hbWU6IGV4ZWN1dGlvbk5hbWUsXG4gICAgfSkpO1xuICAgIGV4ZWN1dGlvbkFybiA9IGV4ZWN1dGlvbi5leGVjdXRpb25Bcm47XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoZSBpbnN0YW5jZW9mIEV4ZWN1dGlvbkFscmVhZHlFeGlzdHMpIHtcbiAgICAgIC8vIHRoaXMgZGVsaXZlcnkgYWxyZWFkeSBzdGFydGVkIGEgcnVubmVyLiBoYXBwZW5zIHdoZW4gR2l0SHViIG9yIG91ciBvd24gcmVkZWxpdmVyeSBmdW5jdGlvbiByZWRlbGl2ZXJzIGFuXG4gICAgICAvLyBldmVudCB3ZSBhbHJlYWR5IGhhbmRsZWQuIHdpdGhvdXQgdGhpcywgZXZlcnkgcmVkZWxpdmVyeSBmYWlscyBhbmQgZ2V0cyByZWRlbGl2ZXJlZCBhZ2FpbiBmb3IgaG91cnMuXG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1J1bm5lciBhbHJlYWR5IHN0YXJ0ZWQgZm9yIHRoaXMgZGVsaXZlcnknLFxuICAgICAgICBydW5uZXJOYW1lOiBleGVjdXRpb25OYW1lLFxuICAgICAgICBqb2I6IHBheWxvYWQud29ya2Zsb3dfam9iLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICAgIGJvZHk6ICdPSy4gUnVubmVyIGFscmVhZHkgc3RhcnRlZCBmb3IgdGhpcyBkZWxpdmVyeS4nLFxuICAgICAgfTtcbiAgICB9XG4gICAgdGhyb3cgZTtcbiAgfVxuXG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdTdGFydGVkIG9yY2hlc3RyYXRvcicsXG4gICAgZXhlY3V0aW9uOiBleGVjdXRpb25Bcm4sXG4gICAgc2ZuSW5wdXQ6IGlucHV0LFxuICAgIGpvYjogcGF5bG9hZC53b3JrZmxvd19qb2IsXG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdHVzQ29kZTogMjAyLFxuICAgIGJvZHk6IGV4ZWN1dGlvbk5hbWUsXG4gIH07XG59XG4iXX0=