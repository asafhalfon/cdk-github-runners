"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyBody = verifyBody;
exports.callProviderSelector = callProviderSelector;
exports.selectProvider = selectProvider;
exports.generateExecutionName = generateExecutionName;
exports.handler = handler;
const crypto = require("crypto");
const client_lambda_1 = require("@aws-sdk/client-lambda");
const client_sfn_1 = require("@aws-sdk/client-sfn");
const lambda_github_1 = require("./lambda-github");
const lambda_helpers_1 = require("./lambda-helpers");
const sf = new client_sfn_1.SFNClient();
const lambdaClient = new client_lambda_1.LambdaClient();
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
    console.log({
        notice: 'Calculated signature',
        signature: expectedSig.toString(),
    });
    if (sig.length !== expectedSig.length || !crypto.timingSafeEqual(sig, expectedSig)) {
        throw new Error(`Signature mismatch. Expected ${expectedSig.toString()} but got ${sig.toString()}`);
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
 * Match job labels to a provider using default label matching logic.
 */
function matchLabelsToProvider(jobLabels, providers) {
    const jobLabelLowerCase = jobLabels.map((label) => label.toLowerCase());
    // is every label the job requires available in the runner provider?
    for (const provider of Object.keys(providers)) {
        const providerLabelsLowerCase = providers[provider].map((label) => label.toLowerCase());
        if (jobLabelLowerCase.every(label => label == 'self-hosted' || providerLabelsLowerCase.includes(label))) {
            return provider;
        }
    }
    return undefined;
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
    const providers = JSON.parse(process.env.PROVIDERS);
    const defaultProvider = matchLabelsToProvider(jobLabels, providers);
    const defaultLabels = defaultProvider ? providers[defaultProvider] : undefined;
    const defaultSelection = { provider: defaultProvider, labels: defaultLabels };
    const selectorResult = await hook(payload, providers, defaultSelection);
    if (selectorResult === undefined) {
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
    const repoNameTruncated = payload.repository.name.slice(0, 64 - deliveryId.length - 1);
    return `${repoNameTruncated}-${deliveryId}`;
}
async function handler(event) {
    if (!process.env.WEBHOOK_SECRET_ARN || !process.env.STEP_FUNCTION_ARN || !process.env.PROVIDERS || !process.env.REQUIRE_SELF_HOSTED_LABEL) {
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
    if (payload.action !== 'queued') {
        console.log({
            notice: `Ignoring action "${payload.action}", expecting "queued"`,
            job: payload.workflow_job,
        });
        return {
            statusCode: 200,
            body: 'OK. No runner started (action is not "queued").',
        };
    }
    if (process.env.REQUIRE_SELF_HOSTED_LABEL === '1' && !payload.workflow_job.labels.includes('self-hosted')) {
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
    const execution = await sf.send(new client_sfn_1.StartExecutionCommand({
        stateMachineArn: process.env.STEP_FUNCTION_ARN,
        input: JSON.stringify(input),
        // name is not random so multiple execution of this webhook won't cause multiple builders to start
        name: executionName,
    }));
    console.log({
        notice: 'Started orchestrator',
        execution: execution.executionArn,
        sfnInput: input,
        job: payload.workflow_job,
    });
    return {
        statusCode: 202,
        body: executionName,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViaG9vay1oYW5kbGVyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy93ZWJob29rLWhhbmRsZXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBNEJBLGdDQTRCQztBQTJDRCxvREFxQ0M7QUFNRCx3Q0FzQ0M7QUFTRCxzREFJQztBQUVELDBCQXFJQztBQXhVRCxpQ0FBaUM7QUFDakMsMERBQXFFO0FBQ3JFLG9EQUF1RTtBQUV2RSxtREFBNkM7QUFDN0MscURBQXNEO0FBR3RELE1BQU0sRUFBRSxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO0FBQzNCLE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksRUFBRSxDQUFDO0FBRXhDLDhCQUE4QjtBQUU5QixTQUFTLFNBQVMsQ0FBQyxLQUF1QyxFQUFFLE1BQWM7SUFDeEUsb0ZBQW9GO0lBQ3BGLEtBQUssTUFBTSxVQUFVLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNwRCxJQUFJLFVBQVUsQ0FBQyxXQUFXLEVBQUUsS0FBSyxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUN0RCxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDbkMsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsVUFBVSxDQUFDLEtBQXVDLEVBQUUsTUFBVztJQUM3RSxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUscUJBQXFCLENBQUMsSUFBSSxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFFL0UsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQzdCLENBQUM7SUFFRCxJQUFJLElBQVksQ0FBQztJQUNqQixJQUFJLEtBQUssQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUMxQixJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQzNDLENBQUM7U0FBTSxDQUFDO1FBQ04sSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksSUFBSSxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDL0MsQ0FBQztJQUVELE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ2pELElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDbEIsTUFBTSxXQUFXLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsRUFBRSxNQUFNLENBQUMsQ0FBQztJQUV4RSxPQUFPLENBQUMsR0FBRyxDQUFDO1FBQ1YsTUFBTSxFQUFFLHNCQUFzQjtRQUM5QixTQUFTLEVBQUUsV0FBVyxDQUFDLFFBQVEsRUFBRTtLQUNsQyxDQUFDLENBQUM7SUFFSCxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssV0FBVyxDQUFDLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxlQUFlLENBQUMsR0FBRyxFQUFFLFdBQVcsQ0FBQyxFQUFFLENBQUM7UUFDbkYsTUFBTSxJQUFJLEtBQUssQ0FBQyxnQ0FBZ0MsV0FBVyxDQUFDLFFBQVEsRUFBRSxZQUFZLEdBQUcsQ0FBQyxRQUFRLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDdEcsQ0FBQztJQUVELE9BQU8sSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO0FBQ3pCLENBQUM7QUFFRCxLQUFLLFVBQVUsbUJBQW1CLENBQUMsT0FBWTtJQUM3QyxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsVUFBVSxFQUFFLFlBQVksQ0FBQztJQUNyRCxJQUFJLFdBQVcsS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUM5QixPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDSCxNQUFNLEVBQUUsT0FBTyxFQUFFLEdBQUcsTUFBTSxJQUFBLDBCQUFVLEVBQUMsT0FBTyxDQUFDLFlBQVksRUFBRSxFQUFFLENBQUMsQ0FBQztRQUMvRCxNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUM7UUFFcEQsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssS0FBSyxTQUFTLENBQUM7SUFDL0MsQ0FBQztJQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDWCxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ1osTUFBTSxFQUFFLG9FQUFvRTtZQUM1RSxLQUFLLEVBQUUsQ0FBQztTQUNULENBQUMsQ0FBQztRQUNILE9BQU8sS0FBSyxDQUFDO0lBQ2YsQ0FBQztBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMscUJBQXFCLENBQUMsU0FBbUIsRUFBRSxTQUFtQztJQUNyRixNQUFNLGlCQUFpQixHQUFHLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO0lBRXhFLG9FQUFvRTtJQUNwRSxLQUFLLE1BQU0sUUFBUSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztRQUM5QyxNQUFNLHVCQUF1QixHQUFHLFNBQVMsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQ3hGLElBQUksaUJBQWlCLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxJQUFJLGFBQWEsSUFBSSx1QkFBdUIsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ3hHLE9BQU8sUUFBUSxDQUFDO1FBQ2xCLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxTQUFTLENBQUM7QUFDbkIsQ0FBQztBQUVEOzs7R0FHRztBQUNJLEtBQUssVUFBVSxvQkFBb0IsQ0FDeEMsT0FBWSxFQUNaLFNBQW1DLEVBQ25DLGdCQUF3QztJQUV4QyxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBQ3ZDLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxNQUFNLGFBQWEsR0FBMEI7UUFDM0MsT0FBTyxFQUFFLE9BQU87UUFDaEIsU0FBUyxFQUFFLFNBQVM7UUFDcEIsZUFBZSxFQUFFLGdCQUFnQixDQUFDLFFBQVE7UUFDMUMsYUFBYSxFQUFFLGdCQUFnQixDQUFDLE1BQU07S0FDdkMsQ0FBQztJQUVGLHNGQUFzRjtJQUN0RixNQUFNLE1BQU0sR0FBRyxNQUFNLFlBQVksQ0FBQyxJQUFJLENBQUMsSUFBSSw2QkFBYSxDQUFDO1FBQ3ZELFlBQVksRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQjtRQUMvQyxPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUM7S0FDdkMsQ0FBQyxDQUFDLENBQUM7SUFFSixJQUFJLE1BQU0sQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUN6QixNQUFNLHVCQUF1QixHQUFHLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7UUFDcEcsT0FBTyxDQUFDLEtBQUssQ0FBQztZQUNaLE1BQU0sRUFBRSwwQkFBMEI7WUFDbEMsYUFBYSxFQUFFLE1BQU0sQ0FBQyxhQUFhO1lBQ25DLE9BQU8sRUFBRSx1QkFBdUI7U0FDakMsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxJQUFJLEtBQUssQ0FBQywwQkFBMEIsQ0FBQyxDQUFDO0lBQzlDLENBQUM7SUFFRCxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3BCLE1BQU0sSUFBSSxLQUFLLENBQUMsdUNBQXVDLENBQUMsQ0FBQztJQUMzRCxDQUFDO0lBRUQsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFFBQVEsRUFBRSxDQUEyQixDQUFDO0FBQ3RGLENBQUM7QUFFRDs7O0dBR0c7QUFDSSxLQUFLLFVBQVUsY0FBYyxDQUFDLE9BQVksRUFBRSxTQUFtQixFQUFFLElBQUksR0FBRyxvQkFBb0I7SUFDakcsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLFNBQVUsQ0FBQyxDQUFDO0lBQ3JELE1BQU0sZUFBZSxHQUFHLHFCQUFxQixDQUFDLFNBQVMsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUNwRSxNQUFNLGFBQWEsR0FBRyxlQUFlLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxlQUFlLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO0lBQy9FLE1BQU0sZ0JBQWdCLEdBQUcsRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUUsQ0FBQztJQUM5RSxNQUFNLGNBQWMsR0FBRyxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsU0FBUyxFQUFFLGdCQUFnQixDQUFDLENBQUM7SUFFeEUsSUFBSSxjQUFjLEtBQUssU0FBUyxFQUFFLENBQUM7UUFDakMsT0FBTyxnQkFBZ0IsQ0FBQztJQUMxQixDQUFDO0lBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQztRQUNWLE1BQU0sRUFBRSwwQkFBMEI7UUFDbEMsUUFBUSxFQUFFLGVBQWU7UUFDekIsTUFBTSxFQUFFLGFBQWE7UUFDckIsU0FBUyxFQUFFLFNBQVM7S0FDckIsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQztRQUNWLE1BQU0sRUFBRSx5QkFBeUI7UUFDakMsUUFBUSxFQUFFLGNBQWMsQ0FBQyxRQUFRO1FBQ2pDLE1BQU0sRUFBRSxjQUFjLENBQUMsTUFBTTtRQUM3QixTQUFTLEVBQUUsU0FBUztLQUNyQixDQUFDLENBQUM7SUFFSCw0R0FBNEc7SUFDNUcsSUFBSSxjQUFjLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRSxDQUFDO1FBQzFDLElBQUksY0FBYyxDQUFDLFFBQVEsS0FBSyxFQUFFLEVBQUUsQ0FBQztZQUNuQyxNQUFNLElBQUksS0FBSyxDQUFDLDJDQUEyQyxDQUFDLENBQUM7UUFDL0QsQ0FBQztRQUNELElBQUksQ0FBQyxTQUFTLENBQUMsY0FBYyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7WUFDeEMsTUFBTSxJQUFJLEtBQUssQ0FBQywrQ0FBK0MsY0FBYyxDQUFDLFFBQVEsRUFBRSxDQUFDLENBQUM7UUFDNUYsQ0FBQztRQUNELElBQUksY0FBYyxDQUFDLE1BQU0sS0FBSyxTQUFTLElBQUksY0FBYyxDQUFDLE1BQU0sQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDOUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxxRUFBcUUsQ0FBQyxDQUFDO1FBQ3pGLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxjQUFjLENBQUM7QUFDeEIsQ0FBQztBQUVEOzs7Ozs7R0FNRztBQUNILFNBQWdCLHFCQUFxQixDQUFDLEtBQVUsRUFBRSxPQUFZO0lBQzVELE1BQU0sVUFBVSxHQUFHLFNBQVMsQ0FBQyxLQUFLLEVBQUUsbUJBQW1CLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO0lBQy9FLE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLEdBQUcsVUFBVSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsQ0FBQztJQUN2RixPQUFPLEdBQUcsaUJBQWlCLElBQUksVUFBVSxFQUFFLENBQUM7QUFDOUMsQ0FBQztBQUVNLEtBQUssVUFBVSxPQUFPLENBQUMsS0FBdUM7SUFDbkUsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxTQUFTLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLHlCQUF5QixFQUFFLENBQUM7UUFDMUksTUFBTSxJQUFJLEtBQUssQ0FBQywrQkFBK0IsQ0FBQyxDQUFDO0lBQ25ELENBQUM7SUFFRCxNQUFNLGFBQWEsR0FBRyxDQUFDLE1BQU0sSUFBQSxtQ0FBa0IsRUFBQyxPQUFPLENBQUMsR0FBRyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7SUFFL0YsSUFBSSxJQUFJLENBQUM7SUFDVCxJQUFJLENBQUM7UUFDSCxJQUFJLEdBQUcsVUFBVSxDQUFDLEtBQUssRUFBRSxhQUFhLENBQUMsQ0FBQztJQUMxQyxDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsZUFBZTtZQUN2QixLQUFLLEVBQUUsQ0FBQztTQUNULENBQUMsQ0FBQztRQUNILE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRSxlQUFlO1NBQ3RCLENBQUM7SUFDSixDQUFDO0lBRUQsSUFBSSxTQUFTLENBQUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxLQUFLLGtCQUFrQixFQUFFLENBQUM7UUFDNUQsT0FBTyxDQUFDLEtBQUssQ0FBQztZQUNaLE1BQU0sRUFBRSx5Q0FBeUM7WUFDakQsV0FBVyxFQUFFLFNBQVMsQ0FBQyxLQUFLLEVBQUUsY0FBYyxDQUFDO1NBQzlDLENBQUMsQ0FBQztRQUNILE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRSx3QkFBd0I7U0FDL0IsQ0FBQztJQUNKLENBQUM7SUFFRCxJQUFJLFNBQVMsQ0FBQyxLQUFLLEVBQUUsZ0JBQWdCLENBQUMsS0FBSyxNQUFNLEVBQUUsQ0FBQztRQUNsRCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsTUFBTTtTQUNiLENBQUM7SUFDSixDQUFDO0lBRUQsd0hBQXdIO0lBQ3hILDJIQUEySDtJQUMzSCxJQUFJLFNBQVMsQ0FBQyxLQUFLLEVBQUUsZ0JBQWdCLENBQUMsS0FBSyxjQUFjLEVBQUUsQ0FBQztRQUMxRCxPQUFPLENBQUMsS0FBSyxDQUFDO1lBQ1osTUFBTSxFQUFFLHdDQUF3QztZQUNoRCxXQUFXLEVBQUUsU0FBUyxDQUFDLEtBQUssRUFBRSxnQkFBZ0IsQ0FBQztTQUNoRCxDQUFDLENBQUM7UUFDSCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsd0JBQXdCO1NBQy9CLENBQUM7SUFDSixDQUFDO0lBRUQsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUVqQyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssUUFBUSxFQUFFLENBQUM7UUFDaEMsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUNWLE1BQU0sRUFBRSxvQkFBb0IsT0FBTyxDQUFDLE1BQU0sdUJBQXVCO1lBQ2pFLEdBQUcsRUFBRSxPQUFPLENBQUMsWUFBWTtTQUMxQixDQUFDLENBQUM7UUFDSCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixJQUFJLEVBQUUsaURBQWlEO1NBQ3hELENBQUM7SUFDSixDQUFDO0lBRUQsSUFBSSxPQUFPLENBQUMsR0FBRyxDQUFDLHlCQUF5QixLQUFLLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsRUFBRSxDQUFDO1FBQzFHLE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDVixNQUFNLEVBQUUsb0JBQW9CLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSw0QkFBNEI7WUFDbkYsR0FBRyxFQUFFLE9BQU8sQ0FBQyxZQUFZO1NBQzFCLENBQUMsQ0FBQztRQUNILE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLElBQUksRUFBRSxpREFBaUQ7U0FDeEQsQ0FBQztJQUNKLENBQUM7SUFFRCw2QkFBNkI7SUFDN0IsTUFBTSxTQUFTLEdBQUcsTUFBTSxjQUFjLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDN0UsSUFBSSxDQUFDLFNBQVMsQ0FBQyxRQUFRLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDN0MsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUNWLE1BQU0sRUFBRSxvQkFBb0IsT0FBTyxDQUFDLFlBQVksQ0FBQyxNQUFNLG9EQUFvRDtZQUMzRyxHQUFHLEVBQUUsT0FBTyxDQUFDLFlBQVk7U0FDMUIsQ0FBQyxDQUFDO1FBQ0gsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLDJEQUEyRDtTQUNsRSxDQUFDO0lBQ0osQ0FBQztJQUVELDhHQUE4RztJQUM5RyxJQUFJLE1BQU0sbUJBQW1CLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUN2QyxPQUFPLENBQUMsR0FBRyxDQUFDO1lBQ1YsTUFBTSxFQUFFLGlEQUFpRDtZQUN6RCxHQUFHLEVBQUUsT0FBTyxDQUFDLFlBQVk7U0FDMUIsQ0FBQyxDQUFDO1FBQ0gsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsSUFBSSxFQUFFLDZDQUE2QztTQUNwRCxDQUFDO0lBQ0osQ0FBQztJQUVELGtCQUFrQjtJQUNsQixNQUFNLGFBQWEsR0FBRyxxQkFBcUIsQ0FBQyxLQUFLLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDNUQsTUFBTSxrQkFBa0IsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLG9CQUFvQixDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsb0JBQW9CO0lBQ3hJLE1BQU0sS0FBSyxHQUFHO1FBQ1osS0FBSyxFQUFFLE9BQU8sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLEtBQUs7UUFDckMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxVQUFVLENBQUMsSUFBSTtRQUM3QixLQUFLLEVBQUUsT0FBTyxDQUFDLFlBQVksQ0FBQyxFQUFFO1FBQzlCLE1BQU0sRUFBRSxPQUFPLENBQUMsWUFBWSxDQUFDLFFBQVE7UUFDckMsY0FBYyxFQUFFLE9BQU8sQ0FBQyxZQUFZLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQyxFQUFFLHFFQUFxRTtRQUNySCxTQUFTLEVBQUUsT0FBTyxDQUFDLFlBQVksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLHVDQUF1QztRQUN6RixRQUFRLEVBQUUsU0FBUyxDQUFDLFFBQVE7UUFDNUIsTUFBTSxFQUFFLFNBQVMsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLHdDQUF3QztRQUM1RSxjQUFjLEVBQUUsa0JBQWtCO0tBQ25DLENBQUM7SUFDRixNQUFNLFNBQVMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxrQ0FBcUIsQ0FBQztRQUN4RCxlQUFlLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUI7UUFDOUMsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxDQUFDO1FBQzVCLGtHQUFrRztRQUNsRyxJQUFJLEVBQUUsYUFBYTtLQUNwQixDQUFDLENBQUMsQ0FBQztJQUVKLE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFDVixNQUFNLEVBQUUsc0JBQXNCO1FBQzlCLFNBQVMsRUFBRSxTQUFTLENBQUMsWUFBWTtRQUNqQyxRQUFRLEVBQUUsS0FBSztRQUNmLEdBQUcsRUFBRSxPQUFPLENBQUMsWUFBWTtLQUMxQixDQUFDLENBQUM7SUFFSCxPQUFPO1FBQ0wsVUFBVSxFQUFFLEdBQUc7UUFDZixJQUFJLEVBQUUsYUFBYTtLQUNwQixDQUFDO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHsgSW52b2tlQ29tbWFuZCwgTGFtYmRhQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWxhbWJkYSc7XG5pbXBvcnQgeyBTRk5DbGllbnQsIFN0YXJ0RXhlY3V0aW9uQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZm4nO1xuaW1wb3J0ICogYXMgQVdTTGFtYmRhIGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgZ2V0T2N0b2tpdCB9IGZyb20gJy4vbGFtYmRhLWdpdGh1Yic7XG5pbXBvcnQgeyBnZXRTZWNyZXRKc29uVmFsdWUgfSBmcm9tICcuL2xhbWJkYS1oZWxwZXJzJztcbmltcG9ydCB7IFByb3ZpZGVyU2VsZWN0b3JJbnB1dCwgUHJvdmlkZXJTZWxlY3RvclJlc3VsdCB9IGZyb20gJy4vd2ViaG9vayc7XG5cbmNvbnN0IHNmID0gbmV3IFNGTkNsaWVudCgpO1xuY29uc3QgbGFtYmRhQ2xpZW50ID0gbmV3IExhbWJkYUNsaWVudCgpO1xuXG4vLyBUT0RPIHVzZSBAb2N0b2tpdC93ZWJob29rcz9cblxuZnVuY3Rpb24gZ2V0SGVhZGVyKGV2ZW50OiBBV1NMYW1iZGEuQVBJR2F0ZXdheVByb3h5RXZlbnRWMiwgaGVhZGVyOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAvLyBBUEkgR2F0ZXdheSBkb2Vzbid0IGxvd2VyY2FzZSBoZWFkZXJzIChWMSBldmVudCkgYnV0IExhbWJkYSBVUkxzIGRvIChWMiBldmVudCkgOihcbiAgZm9yIChjb25zdCBoZWFkZXJOYW1lIG9mIE9iamVjdC5rZXlzKGV2ZW50LmhlYWRlcnMpKSB7XG4gICAgaWYgKGhlYWRlck5hbWUudG9Mb3dlckNhc2UoKSA9PT0gaGVhZGVyLnRvTG93ZXJDYXNlKCkpIHtcbiAgICAgIHJldHVybiBldmVudC5oZWFkZXJzW2hlYWRlck5hbWVdO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogRXhwb3J0ZWQgZm9yIHVuaXQgdGVzdGluZy5cbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gdmVyaWZ5Qm9keShldmVudDogQVdTTGFtYmRhLkFQSUdhdGV3YXlQcm94eUV2ZW50VjIsIHNlY3JldDogYW55KTogc3RyaW5nIHtcbiAgY29uc3Qgc2lnID0gQnVmZmVyLmZyb20oZ2V0SGVhZGVyKGV2ZW50LCAneC1odWItc2lnbmF0dXJlLTI1NicpIHx8ICcnLCAndXRmOCcpO1xuXG4gIGlmICghZXZlbnQuYm9keSkge1xuICAgIHRocm93IG5ldyBFcnJvcignTm8gYm9keScpO1xuICB9XG5cbiAgbGV0IGJvZHk6IEJ1ZmZlcjtcbiAgaWYgKGV2ZW50LmlzQmFzZTY0RW5jb2RlZCkge1xuICAgIGJvZHkgPSBCdWZmZXIuZnJvbShldmVudC5ib2R5LCAnYmFzZTY0Jyk7XG4gIH0gZWxzZSB7XG4gICAgYm9keSA9IEJ1ZmZlci5mcm9tKGV2ZW50LmJvZHkgfHwgJycsICd1dGY4Jyk7XG4gIH1cblxuICBjb25zdCBobWFjID0gY3J5cHRvLmNyZWF0ZUhtYWMoJ3NoYTI1NicsIHNlY3JldCk7XG4gIGhtYWMudXBkYXRlKGJvZHkpO1xuICBjb25zdCBleHBlY3RlZFNpZyA9IEJ1ZmZlci5mcm9tKGBzaGEyNTY9JHtobWFjLmRpZ2VzdCgnaGV4Jyl9YCwgJ3V0ZjgnKTtcblxuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnQ2FsY3VsYXRlZCBzaWduYXR1cmUnLFxuICAgIHNpZ25hdHVyZTogZXhwZWN0ZWRTaWcudG9TdHJpbmcoKSxcbiAgfSk7XG5cbiAgaWYgKHNpZy5sZW5ndGggIT09IGV4cGVjdGVkU2lnLmxlbmd0aCB8fCAhY3J5cHRvLnRpbWluZ1NhZmVFcXVhbChzaWcsIGV4cGVjdGVkU2lnKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgU2lnbmF0dXJlIG1pc21hdGNoLiBFeHBlY3RlZCAke2V4cGVjdGVkU2lnLnRvU3RyaW5nKCl9IGJ1dCBnb3QgJHtzaWcudG9TdHJpbmcoKX1gKTtcbiAgfVxuXG4gIHJldHVybiBib2R5LnRvU3RyaW5nKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGlzRGVwbG95bWVudFBlbmRpbmcocGF5bG9hZDogYW55KSB7XG4gIGNvbnN0IHN0YXR1c2VzVXJsID0gcGF5bG9hZC5kZXBsb3ltZW50Py5zdGF0dXNlc191cmw7XG4gIGlmIChzdGF0dXNlc1VybCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB7IG9jdG9raXQgfSA9IGF3YWl0IGdldE9jdG9raXQocGF5bG9hZC5pbnN0YWxsYXRpb24/LmlkKTtcbiAgICBjb25zdCBzdGF0dXNlcyA9IGF3YWl0IG9jdG9raXQucmVxdWVzdChzdGF0dXNlc1VybCk7XG5cbiAgICByZXR1cm4gc3RhdHVzZXMuZGF0YVswXT8uc3RhdGUgPT09ICd3YWl0aW5nJztcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnVW5hYmxlIHRvIGNoZWNrIGRlcGxveW1lbnQuIFRyeSBhZGRpbmcgZGVwbG95bWVudCByZWFkIHBlcm1pc3Npb24uJyxcbiAgICAgIGVycm9yOiBlLFxuICAgIH0pO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIE1hdGNoIGpvYiBsYWJlbHMgdG8gYSBwcm92aWRlciB1c2luZyBkZWZhdWx0IGxhYmVsIG1hdGNoaW5nIGxvZ2ljLlxuICovXG5mdW5jdGlvbiBtYXRjaExhYmVsc1RvUHJvdmlkZXIoam9iTGFiZWxzOiBzdHJpbmdbXSwgcHJvdmlkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmdbXT4pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBqb2JMYWJlbExvd2VyQ2FzZSA9IGpvYkxhYmVscy5tYXAoKGxhYmVsKSA9PiBsYWJlbC50b0xvd2VyQ2FzZSgpKTtcblxuICAvLyBpcyBldmVyeSBsYWJlbCB0aGUgam9iIHJlcXVpcmVzIGF2YWlsYWJsZSBpbiB0aGUgcnVubmVyIHByb3ZpZGVyP1xuICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIE9iamVjdC5rZXlzKHByb3ZpZGVycykpIHtcbiAgICBjb25zdCBwcm92aWRlckxhYmVsc0xvd2VyQ2FzZSA9IHByb3ZpZGVyc1twcm92aWRlcl0ubWFwKChsYWJlbCkgPT4gbGFiZWwudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKGpvYkxhYmVsTG93ZXJDYXNlLmV2ZXJ5KGxhYmVsID0+IGxhYmVsID09ICdzZWxmLWhvc3RlZCcgfHwgcHJvdmlkZXJMYWJlbHNMb3dlckNhc2UuaW5jbHVkZXMobGFiZWwpKSkge1xuICAgICAgcmV0dXJuIHByb3ZpZGVyO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogQ2FsbCB0aGUgcHJvdmlkZXIgc2VsZWN0b3IgTGFtYmRhIGZ1bmN0aW9uIGlmIGNvbmZpZ3VyZWQuXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNhbGxQcm92aWRlclNlbGVjdG9yKFxuICBwYXlsb2FkOiBhbnksXG4gIHByb3ZpZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+LFxuICBkZWZhdWx0U2VsZWN0aW9uOiBQcm92aWRlclNlbGVjdG9yUmVzdWx0LFxuKTogUHJvbWlzZTxQcm92aWRlclNlbGVjdG9yUmVzdWx0IHwgdW5kZWZpbmVkPiB7XG4gIGlmICghcHJvY2Vzcy5lbnYuUFJPVklERVJfU0VMRUNUT1JfQVJOKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIGNvbnN0IHNlbGVjdG9ySW5wdXQ6IFByb3ZpZGVyU2VsZWN0b3JJbnB1dCA9IHtcbiAgICBwYXlsb2FkOiBwYXlsb2FkLFxuICAgIHByb3ZpZGVyczogcHJvdmlkZXJzLFxuICAgIGRlZmF1bHRQcm92aWRlcjogZGVmYXVsdFNlbGVjdGlvbi5wcm92aWRlcixcbiAgICBkZWZhdWx0TGFiZWxzOiBkZWZhdWx0U2VsZWN0aW9uLmxhYmVscyxcbiAgfTtcblxuICAvLyBkb24ndCBjYXRjaCBlcnJvcnMgLS0gdGhlIHdob2xlIHdlYmhvb2sgaGFuZGxlciB3aWxsIGJlIHJldHJpZWQgb24gdW5oYW5kbGVkIGVycm9yc1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBsYW1iZGFDbGllbnQuc2VuZChuZXcgSW52b2tlQ29tbWFuZCh7XG4gICAgRnVuY3Rpb25OYW1lOiBwcm9jZXNzLmVudi5QUk9WSURFUl9TRUxFQ1RPUl9BUk4sXG4gICAgUGF5bG9hZDogSlNPTi5zdHJpbmdpZnkoc2VsZWN0b3JJbnB1dCksXG4gIH0pKTtcblxuICBpZiAocmVzdWx0LkZ1bmN0aW9uRXJyb3IpIHtcbiAgICBjb25zdCBzZWxlY3RvclJlc3BvbnNlUGF5bG9hZCA9IHJlc3VsdC5QYXlsb2FkID8gQnVmZmVyLmZyb20ocmVzdWx0LlBheWxvYWQpLnRvU3RyaW5nKCkgOiB1bmRlZmluZWQ7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdQcm92aWRlciBzZWxlY3RvciBmYWlsZWQnLFxuICAgICAgZnVuY3Rpb25FcnJvcjogcmVzdWx0LkZ1bmN0aW9uRXJyb3IsXG4gICAgICBwYXlsb2FkOiBzZWxlY3RvclJlc3BvbnNlUGF5bG9hZCxcbiAgICB9KTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1Byb3ZpZGVyIHNlbGVjdG9yIGZhaWxlZCcpO1xuICB9XG5cbiAgaWYgKCFyZXN1bHQuUGF5bG9hZCkge1xuICAgIHRocm93IG5ldyBFcnJvcignUHJvdmlkZXIgc2VsZWN0b3IgcmV0dXJuZWQgbm8gcGF5bG9hZCcpO1xuICB9XG5cbiAgcmV0dXJuIEpTT04ucGFyc2UoQnVmZmVyLmZyb20ocmVzdWx0LlBheWxvYWQpLnRvU3RyaW5nKCkpIGFzIFByb3ZpZGVyU2VsZWN0b3JSZXN1bHQ7XG59XG5cbi8qKlxuICogRXhwb3J0ZWQgZm9yIHVuaXQgdGVzdGluZy5cbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2VsZWN0UHJvdmlkZXIocGF5bG9hZDogYW55LCBqb2JMYWJlbHM6IHN0cmluZ1tdLCBob29rID0gY2FsbFByb3ZpZGVyU2VsZWN0b3IpOiBQcm9taXNlPFByb3ZpZGVyU2VsZWN0b3JSZXN1bHQ+IHtcbiAgY29uc3QgcHJvdmlkZXJzID0gSlNPTi5wYXJzZShwcm9jZXNzLmVudi5QUk9WSURFUlMhKTtcbiAgY29uc3QgZGVmYXVsdFByb3ZpZGVyID0gbWF0Y2hMYWJlbHNUb1Byb3ZpZGVyKGpvYkxhYmVscywgcHJvdmlkZXJzKTtcbiAgY29uc3QgZGVmYXVsdExhYmVscyA9IGRlZmF1bHRQcm92aWRlciA/IHByb3ZpZGVyc1tkZWZhdWx0UHJvdmlkZXJdIDogdW5kZWZpbmVkO1xuICBjb25zdCBkZWZhdWx0U2VsZWN0aW9uID0geyBwcm92aWRlcjogZGVmYXVsdFByb3ZpZGVyLCBsYWJlbHM6IGRlZmF1bHRMYWJlbHMgfTtcbiAgY29uc3Qgc2VsZWN0b3JSZXN1bHQgPSBhd2FpdCBob29rKHBheWxvYWQsIHByb3ZpZGVycywgZGVmYXVsdFNlbGVjdGlvbik7XG5cbiAgaWYgKHNlbGVjdG9yUmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gZGVmYXVsdFNlbGVjdGlvbjtcbiAgfVxuXG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdCZWZvcmUgcHJvdmlkZXIgc2VsZWN0b3InLFxuICAgIHByb3ZpZGVyOiBkZWZhdWx0UHJvdmlkZXIsXG4gICAgbGFiZWxzOiBkZWZhdWx0TGFiZWxzLFxuICAgIGpvYkxhYmVsczogam9iTGFiZWxzLFxuICB9KTtcbiAgY29uc29sZS5sb2coe1xuICAgIG5vdGljZTogJ0FmdGVyIHByb3ZpZGVyIHNlbGVjdG9yJyxcbiAgICBwcm92aWRlcjogc2VsZWN0b3JSZXN1bHQucHJvdmlkZXIsXG4gICAgbGFiZWxzOiBzZWxlY3RvclJlc3VsdC5sYWJlbHMsXG4gICAgam9iTGFiZWxzOiBqb2JMYWJlbHMsXG4gIH0pO1xuXG4gIC8vIGFueSBlcnJvciBoZXJlIHdpbGwgZmFpbCB0aGUgd2ViaG9vayBhbmQgY2F1c2UgYSByZXRyeSBzbyB0aGUgc2VsZWN0b3IgaGFzIGFub3RoZXIgY2hhbmNlIHRvIGdldCBpdCByaWdodFxuICBpZiAoc2VsZWN0b3JSZXN1bHQucHJvdmlkZXIgIT09IHVuZGVmaW5lZCkge1xuICAgIGlmIChzZWxlY3RvclJlc3VsdC5wcm92aWRlciA9PT0gJycpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignUHJvdmlkZXIgc2VsZWN0b3IgcmV0dXJuZWQgZW1wdHkgcHJvdmlkZXInKTtcbiAgICB9XG4gICAgaWYgKCFwcm92aWRlcnNbc2VsZWN0b3JSZXN1bHQucHJvdmlkZXJdKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFByb3ZpZGVyIHNlbGVjdG9yIHJldHVybmVkIHVua25vd24gcHJvdmlkZXIgJHtzZWxlY3RvclJlc3VsdC5wcm92aWRlcn1gKTtcbiAgICB9XG4gICAgaWYgKHNlbGVjdG9yUmVzdWx0LmxhYmVscyA9PT0gdW5kZWZpbmVkIHx8IHNlbGVjdG9yUmVzdWx0LmxhYmVscy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignUHJvdmlkZXIgc2VsZWN0b3IgbXVzdCByZXR1cm4gbm9uLWVtcHR5IGxhYmVscyB3aGVuIHByb3ZpZGVyIGlzIHNldCcpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBzZWxlY3RvclJlc3VsdDtcbn1cblxuLyoqXG4gKiBHZW5lcmF0ZSBhIHVuaXF1ZSBleGVjdXRpb24gbmFtZSB3aGljaCBpcyBsaW1pdGVkIHRvIDY0IGNoYXJhY3RlcnMgKGFsc28gdXNlZCBhcyBydW5uZXIgbmFtZSkuXG4gKlxuICogRXhwb3J0ZWQgZm9yIHVuaXQgdGVzdGluZy5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdlbmVyYXRlRXhlY3V0aW9uTmFtZShldmVudDogYW55LCBwYXlsb2FkOiBhbnkpOiBzdHJpbmcge1xuICBjb25zdCBkZWxpdmVyeUlkID0gZ2V0SGVhZGVyKGV2ZW50LCAneC1naXRodWItZGVsaXZlcnknKSA/PyBgJHtNYXRoLnJhbmRvbSgpfWA7XG4gIGNvbnN0IHJlcG9OYW1lVHJ1bmNhdGVkID0gcGF5bG9hZC5yZXBvc2l0b3J5Lm5hbWUuc2xpY2UoMCwgNjQgLSBkZWxpdmVyeUlkLmxlbmd0aCAtIDEpO1xuICByZXR1cm4gYCR7cmVwb05hbWVUcnVuY2F0ZWR9LSR7ZGVsaXZlcnlJZH1gO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogQVdTTGFtYmRhLkFQSUdhdGV3YXlQcm94eUV2ZW50VjIpOiBQcm9taXNlPEFXU0xhbWJkYS5BUElHYXRld2F5UHJveHlSZXN1bHRWMj4ge1xuICBpZiAoIXByb2Nlc3MuZW52LldFQkhPT0tfU0VDUkVUX0FSTiB8fCAhcHJvY2Vzcy5lbnYuU1RFUF9GVU5DVElPTl9BUk4gfHwgIXByb2Nlc3MuZW52LlBST1ZJREVSUyB8fCAhcHJvY2Vzcy5lbnYuUkVRVUlSRV9TRUxGX0hPU1RFRF9MQUJFTCkge1xuICAgIHRocm93IG5ldyBFcnJvcignTWlzc2luZyBlbnZpcm9ubWVudCB2YXJpYWJsZXMnKTtcbiAgfVxuXG4gIGNvbnN0IHdlYmhvb2tTZWNyZXQgPSAoYXdhaXQgZ2V0U2VjcmV0SnNvblZhbHVlKHByb2Nlc3MuZW52LldFQkhPT0tfU0VDUkVUX0FSTikpLndlYmhvb2tTZWNyZXQ7XG5cbiAgbGV0IGJvZHk7XG4gIHRyeSB7XG4gICAgYm9keSA9IHZlcmlmeUJvZHkoZXZlbnQsIHdlYmhvb2tTZWNyZXQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdCYWQgc2lnbmF0dXJlJyxcbiAgICAgIGVycm9yOiBlLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA0MDMsXG4gICAgICBib2R5OiAnQmFkIHNpZ25hdHVyZScsXG4gICAgfTtcbiAgfVxuXG4gIGlmIChnZXRIZWFkZXIoZXZlbnQsICdjb250ZW50LXR5cGUnKSAhPT0gJ2FwcGxpY2F0aW9uL2pzb24nKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdUaGlzIHdlYmhvb2sgb25seSBhY2NlcHRzIEpTT04gcGF5bG9hZHMnLFxuICAgICAgY29udGVudFR5cGU6IGdldEhlYWRlcihldmVudCwgJ2NvbnRlbnQtdHlwZScpLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICBib2R5OiAnRXhwZWN0aW5nIEpTT04gcGF5bG9hZCcsXG4gICAgfTtcbiAgfVxuXG4gIGlmIChnZXRIZWFkZXIoZXZlbnQsICd4LWdpdGh1Yi1ldmVudCcpID09PSAncGluZycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogJ1BvbmcnLFxuICAgIH07XG4gIH1cblxuICAvLyBpZiAoZ2V0SGVhZGVyKGV2ZW50LCAneC1naXRodWItZXZlbnQnKSAhPT0gJ3dvcmtmbG93X2pvYicgJiYgZ2V0SGVhZGVyKGV2ZW50LCAneC1naXRodWItZXZlbnQnKSAhPT0gJ3dvcmtmbG93X3J1bicpIHtcbiAgLy8gICAgIGNvbnNvbGUuZXJyb3IoYFRoaXMgd2ViaG9vayBvbmx5IGFjY2VwdHMgd29ya2Zsb3dfam9iIGFuZCB3b3JrZmxvd19ydW4sIGdvdCAke2dldEhlYWRlcihldmVudCwgJ3gtZ2l0aHViLWV2ZW50Jyl9YCk7XG4gIGlmIChnZXRIZWFkZXIoZXZlbnQsICd4LWdpdGh1Yi1ldmVudCcpICE9PSAnd29ya2Zsb3dfam9iJykge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnVGhpcyB3ZWJob29rIG9ubHkgYWNjZXB0cyB3b3JrZmxvd19qb2InLFxuICAgICAgZ2l0aHViRXZlbnQ6IGdldEhlYWRlcihldmVudCwgJ3gtZ2l0aHViLWV2ZW50JyksXG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6ICdFeHBlY3Rpbmcgd29ya2Zsb3dfam9iJyxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UoYm9keSk7XG5cbiAgaWYgKHBheWxvYWQuYWN0aW9uICE9PSAncXVldWVkJykge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogYElnbm9yaW5nIGFjdGlvbiBcIiR7cGF5bG9hZC5hY3Rpb259XCIsIGV4cGVjdGluZyBcInF1ZXVlZFwiYCxcbiAgICAgIGpvYjogcGF5bG9hZC53b3JrZmxvd19qb2IsXG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6ICdPSy4gTm8gcnVubmVyIHN0YXJ0ZWQgKGFjdGlvbiBpcyBub3QgXCJxdWV1ZWRcIikuJyxcbiAgICB9O1xuICB9XG5cbiAgaWYgKHByb2Nlc3MuZW52LlJFUVVJUkVfU0VMRl9IT1NURURfTEFCRUwgPT09ICcxJyAmJiAhcGF5bG9hZC53b3JrZmxvd19qb2IubGFiZWxzLmluY2x1ZGVzKCdzZWxmLWhvc3RlZCcpKSB7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiBgSWdub3JpbmcgbGFiZWxzIFwiJHtwYXlsb2FkLndvcmtmbG93X2pvYi5sYWJlbHN9XCIsIGV4cGVjdGluZyBcInNlbGYtaG9zdGVkXCJgLFxuICAgICAgam9iOiBwYXlsb2FkLndvcmtmbG93X2pvYixcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogJ09LLiBObyBydW5uZXIgc3RhcnRlZCAobm8gXCJzZWxmLWhvc3RlZFwiIGxhYmVsKS4nLFxuICAgIH07XG4gIH1cblxuICAvLyBTZWxlY3QgcHJvdmlkZXIgYW5kIGxhYmVsc1xuICBjb25zdCBzZWxlY3Rpb24gPSBhd2FpdCBzZWxlY3RQcm92aWRlcihwYXlsb2FkLCBwYXlsb2FkLndvcmtmbG93X2pvYi5sYWJlbHMpO1xuICBpZiAoIXNlbGVjdGlvbi5wcm92aWRlciB8fCAhc2VsZWN0aW9uLmxhYmVscykge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogYElnbm9yaW5nIGxhYmVscyBcIiR7cGF5bG9hZC53b3JrZmxvd19qb2IubGFiZWxzfVwiLCBhcyB0aGV5IGRvbid0IG1hdGNoIGEgc3VwcG9ydGVkIHJ1bm5lciBwcm92aWRlcmAsXG4gICAgICBqb2I6IHBheWxvYWQud29ya2Zsb3dfam9iLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiAnT0suIE5vIHJ1bm5lciBzdGFydGVkIChubyBwcm92aWRlciB3aXRoIG1hdGNoaW5nIGxhYmVscykuJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gZG9uJ3Qgc3RhcnQgcnVubmVycyBmb3IgYSBkZXBsb3ltZW50IHRoYXQncyBzdGlsbCBwZW5kaW5nIGFzIEdpdEh1YiB3aWxsIHNlbmQgYW5vdGhlciBldmVudCB3aGVuIGl0J3MgcmVhZHlcbiAgaWYgKGF3YWl0IGlzRGVwbG95bWVudFBlbmRpbmcocGF5bG9hZCkpIHtcbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdJZ25vcmluZyBqb2IgYXMgaXRzIGRlcGxveW1lbnQgaXMgc3RpbGwgcGVuZGluZycsXG4gICAgICBqb2I6IHBheWxvYWQud29ya2Zsb3dfam9iLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiAnT0suIE5vIHJ1bm5lciBzdGFydGVkIChkZXBsb3ltZW50IHBlbmRpbmcpLicsXG4gICAgfTtcbiAgfVxuXG4gIC8vIHN0YXJ0IGV4ZWN1dGlvblxuICBjb25zdCBleGVjdXRpb25OYW1lID0gZ2VuZXJhdGVFeGVjdXRpb25OYW1lKGV2ZW50LCBwYXlsb2FkKTtcbiAgY29uc3QgaWRsZVRpbWVvdXRTZWNvbmRzID0gcHJvY2Vzcy5lbnYuSURMRV9USU1FT1VUX1NFQ09ORFMgPyBwYXJzZUludChwcm9jZXNzLmVudi5JRExFX1RJTUVPVVRfU0VDT05EUywgMTApIDogMzAwOyAvLyBkZWZhdWx0IDUgbWludXRlc1xuICBjb25zdCBpbnB1dCA9IHtcbiAgICBvd25lcjogcGF5bG9hZC5yZXBvc2l0b3J5Lm93bmVyLmxvZ2luLFxuICAgIHJlcG86IHBheWxvYWQucmVwb3NpdG9yeS5uYW1lLFxuICAgIGpvYklkOiBwYXlsb2FkLndvcmtmbG93X2pvYi5pZCxcbiAgICBqb2JVcmw6IHBheWxvYWQud29ya2Zsb3dfam9iLmh0bWxfdXJsLFxuICAgIGluc3RhbGxhdGlvbklkOiBwYXlsb2FkLmluc3RhbGxhdGlvbj8uaWQgPz8gLTEsIC8vIGFsd2F5cyBwYXNzIHZhbHVlIGJlY2F1c2Ugc3RlcCBmdW5jdGlvbiBjYW4ndCBoYW5kbGUgbWlzc2luZyBpbnB1dFxuICAgIGpvYkxhYmVsczogcGF5bG9hZC53b3JrZmxvd19qb2IubGFiZWxzLmpvaW4oJywnKSwgLy8gb3JpZ2luYWwgbGFiZWxzIHJlcXVlc3RlZCBieSB0aGUgam9iXG4gICAgcHJvdmlkZXI6IHNlbGVjdGlvbi5wcm92aWRlcixcbiAgICBsYWJlbHM6IHNlbGVjdGlvbi5sYWJlbHMuam9pbignLCcpLCAvLyBsYWJlbHMgdG8gdXNlIHdoZW4gcmVnaXN0ZXJpbmcgcnVubmVyXG4gICAgbWF4SWRsZVNlY29uZHM6IGlkbGVUaW1lb3V0U2Vjb25kcyxcbiAgfTtcbiAgY29uc3QgZXhlY3V0aW9uID0gYXdhaXQgc2Yuc2VuZChuZXcgU3RhcnRFeGVjdXRpb25Db21tYW5kKHtcbiAgICBzdGF0ZU1hY2hpbmVBcm46IHByb2Nlc3MuZW52LlNURVBfRlVOQ1RJT05fQVJOLFxuICAgIGlucHV0OiBKU09OLnN0cmluZ2lmeShpbnB1dCksXG4gICAgLy8gbmFtZSBpcyBub3QgcmFuZG9tIHNvIG11bHRpcGxlIGV4ZWN1dGlvbiBvZiB0aGlzIHdlYmhvb2sgd29uJ3QgY2F1c2UgbXVsdGlwbGUgYnVpbGRlcnMgdG8gc3RhcnRcbiAgICBuYW1lOiBleGVjdXRpb25OYW1lLFxuICB9KSk7XG5cbiAgY29uc29sZS5sb2coe1xuICAgIG5vdGljZTogJ1N0YXJ0ZWQgb3JjaGVzdHJhdG9yJyxcbiAgICBleGVjdXRpb246IGV4ZWN1dGlvbi5leGVjdXRpb25Bcm4sXG4gICAgc2ZuSW5wdXQ6IGlucHV0LFxuICAgIGpvYjogcGF5bG9hZC53b3JrZmxvd19qb2IsXG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdHVzQ29kZTogMjAyLFxuICAgIGJvZHk6IGV4ZWN1dGlvbk5hbWUsXG4gIH07XG59XG4iXX0=