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
            error: `${e}`,
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
            error: `${e}`,
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
    const input = {
        owner: payload.repository.owner.login,
        repo: payload.repository.name,
        jobId: payload.workflow_job.id,
        jobUrl: payload.workflow_job.html_url,
        installationId: payload.installation?.id ?? -1, // always pass value because step function can't handle missing input
        jobLabels: payload.workflow_job.labels.join(','), // original labels requested by the job
        provider: selection.provider,
        labels: selection.labels.join(','), // labels to use when registering runner
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViaG9vay1oYW5kbGVyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy93ZWJob29rLWhhbmRsZXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBNEJBLGdDQTRCQztBQTJDRCxvREFxQ0M7QUFNRCx3Q0FzQ0M7QUFTRCxzREFJQztBQUVELDBCQW1JQztBQXRVRCxpQ0FBaUM7QUFDakMsMERBQXFFO0FBQ3JFLG9EQUF1RTtBQUV2RSxtREFBNkM7QUFDN0MscURBQXNEO0FBR3RELE1BQU0sRUFBRSxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO0FBQzNCLE1BQU0sWUFBWSxHQUFHLElBQUksNEJBQVksRUFBRSxDQUFDO0FBRXhDLDhCQUE4QjtBQUU5QixTQUFTLFNBQVMsQ0FBQyxLQUF1QyxFQUFFLE1BQWM7SUFDeEUsb0ZBQW9GO0lBQ3BGLEtBQUssTUFBTSxVQUFVLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNwRCxJQUFJLFVBQVUsQ0FBQyxXQUFXLEVBQUUsS0FBSyxNQUFNLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQztZQUN0RCxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDbkMsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsU0FBZ0IsVUFBVSxDQUFDLEtBQXVDLEVBQUUsTUFBVztJQUM3RSxNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUscUJBQXFCLENBQUMsSUFBSSxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFFL0UsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNoQixNQUFNLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQzdCLENBQUM7SUFFRCxJ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O1FBQ3JDLGNBQWMsRUFBRSxPQUFPLENBQUMsWUFBWSxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUMsRUFBRSxxRUFBcUU7UUFDckgsU0FBUyxFQUFFLE9BQU8sQ0FBQyxZQUFZLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSx1Q0FBdUM7UUFDekYsUUFBUSxFQUFFLFNBQVMsQ0FBQyxRQUFRO1FBQzVCLE1BQU0sRUFBRSxTQUFTLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSx3Q0FBd0M7S0FDN0UsQ0FBQztJQUNGLE1BQU0sU0FBUyxHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLGtDQUFxQixDQUFDO1FBQ3hELGVBQWUsRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQjtRQUM5QyxLQUFLLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUM7UUFDNUIsa0dBQWtHO1FBQ2xHLElBQUksRUFBRSxhQUFhO0tBQ3BCLENBQUMsQ0FBQyxDQUFDO0lBRUosT0FBTyxDQUFDLEdBQUcsQ0FBQztRQUNWLE1BQU0sRUFBRSxzQkFBc0I7UUFDOUIsU0FBUyxFQUFFLFNBQVMsQ0FBQyxZQUFZO1FBQ2pDLFFBQVEsRUFBRSxLQUFLO1FBQ2YsR0FBRyxFQUFFLE9BQU8sQ0FBQyxZQUFZO0tBQzFCLENBQUMsQ0FBQztJQUVILE9BQU87UUFDTCxVQUFVLEVBQUUsR0FBRztRQUNmLElBQUksRUFBRSxhQUFhO0tBQ3BCLENBQUM7QUFDSixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgeyBJbnZva2VDb21tYW5kLCBMYW1iZGFDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcbmltcG9ydCB7IFNGTkNsaWVudCwgU3RhcnRFeGVjdXRpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNmbic7XG5pbXBvcnQgKiBhcyBBV1NMYW1iZGEgZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBnZXRPY3Rva2l0IH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcbmltcG9ydCB7IGdldFNlY3JldEpzb25WYWx1ZSB9IGZyb20gJy4vbGFtYmRhLWhlbHBlcnMnO1xuaW1wb3J0IHsgUHJvdmlkZXJTZWxlY3RvcklucHV0LCBQcm92aWRlclNlbGVjdG9yUmVzdWx0IH0gZnJvbSAnLi93ZWJob29rJztcblxuY29uc3Qgc2YgPSBuZXcgU0ZOQ2xpZW50KCk7XG5jb25zdCBsYW1iZGFDbGllbnQgPSBuZXcgTGFtYmRhQ2xpZW50KCk7XG5cbi8vIFRPRE8gdXNlIEBvY3Rva2l0L3dlYmhvb2tzP1xuXG5mdW5jdGlvbiBnZXRIZWFkZXIoZXZlbnQ6IEFXU0xhbWJkYS5BUElHYXRld2F5UHJveHlFdmVudFYyLCBoZWFkZXI6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIC8vIEFQSSBHYXRld2F5IGRvZXNuJ3QgbG93ZXJjYXNlIGhlYWRlcnMgKFYxIGV2ZW50KSBidXQgTGFtYmRhIFVSTHMgZG8gKFYyIGV2ZW50KSA6KFxuICBmb3IgKGNvbnN0IGhlYWRlck5hbWUgb2YgT2JqZWN0LmtleXMoZXZlbnQuaGVhZGVycykpIHtcbiAgICBpZiAoaGVhZGVyTmFtZS50b0xvd2VyQ2FzZSgpID09PSBoZWFkZXIudG9Mb3dlckNhc2UoKSkge1xuICAgICAgcmV0dXJuIGV2ZW50LmhlYWRlcnNbaGVhZGVyTmFtZV07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBFeHBvcnRlZCBmb3IgdW5pdCB0ZXN0aW5nLlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2ZXJpZnlCb2R5KGV2ZW50OiBBV1NMYW1iZGEuQVBJR2F0ZXdheVByb3h5RXZlbnRWMiwgc2VjcmV0OiBhbnkpOiBzdHJpbmcge1xuICBjb25zdCBzaWcgPSBCdWZmZXIuZnJvbShnZXRIZWFkZXIoZXZlbnQsICd4LWh1Yi1zaWduYXR1cmUtMjU2JykgfHwgJycsICd1dGY4Jyk7XG5cbiAgaWYgKCFldmVudC5ib2R5KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdObyBib2R5Jyk7XG4gIH1cblxuICBsZXQgYm9keTogQnVmZmVyO1xuICBpZiAoZXZlbnQuaXNCYXNlNjRFbmNvZGVkKSB7XG4gICAgYm9keSA9IEJ1ZmZlci5mcm9tKGV2ZW50LmJvZHksICdiYXNlNjQnKTtcbiAgfSBlbHNlIHtcbiAgICBib2R5ID0gQnVmZmVyLmZyb20oZXZlbnQuYm9keSB8fCAnJywgJ3V0ZjgnKTtcbiAgfVxuXG4gIGNvbnN0IGhtYWMgPSBjcnlwdG8uY3JlYXRlSG1hYygnc2hhMjU2Jywgc2VjcmV0KTtcbiAgaG1hYy51cGRhdGUoYm9keSk7XG4gIGNvbnN0IGV4cGVjdGVkU2lnID0gQnVmZmVyLmZyb20oYHNoYTI1Nj0ke2htYWMuZGlnZXN0KCdoZXgnKX1gLCAndXRmOCcpO1xuXG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdDYWxjdWxhdGVkIHNpZ25hdHVyZScsXG4gICAgc2lnbmF0dXJlOiBleHBlY3RlZFNpZy50b1N0cmluZygpLFxuICB9KTtcblxuICBpZiAoc2lnLmxlbmd0aCAhPT0gZXhwZWN0ZWRTaWcubGVuZ3RoIHx8ICFjcnlwdG8udGltaW5nU2FmZUVxdWFsKHNpZywgZXhwZWN0ZWRTaWcpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBTaWduYXR1cmUgbWlzbWF0Y2guIEV4cGVjdGVkICR7ZXhwZWN0ZWRTaWcudG9TdHJpbmcoKX0gYnV0IGdvdCAke3NpZy50b1N0cmluZygpfWApO1xuICB9XG5cbiAgcmV0dXJuIGJvZHkudG9TdHJpbmcoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaXNEZXBsb3ltZW50UGVuZGluZyhwYXlsb2FkOiBhbnkpIHtcbiAgY29uc3Qgc3RhdHVzZXNVcmwgPSBwYXlsb2FkLmRlcGxveW1lbnQ/LnN0YXR1c2VzX3VybDtcbiAgaWYgKHN0YXR1c2VzVXJsID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHsgb2N0b2tpdCB9ID0gYXdhaXQgZ2V0T2N0b2tpdChwYXlsb2FkLmluc3RhbGxhdGlvbj8uaWQpO1xuICAgIGNvbnN0IHN0YXR1c2VzID0gYXdhaXQgb2N0b2tpdC5yZXF1ZXN0KHN0YXR1c2VzVXJsKTtcblxuICAgIHJldHVybiBzdGF0dXNlcy5kYXRhWzBdPy5zdGF0ZSA9PT0gJ3dhaXRpbmcnO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdVbmFibGUgdG8gY2hlY2sgZGVwbG95bWVudC4gVHJ5IGFkZGluZyBkZXBsb3ltZW50IHJlYWQgcGVybWlzc2lvbi4nLFxuICAgICAgZXJyb3I6IGAke2V9YCxcbiAgICB9KTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBNYXRjaCBqb2IgbGFiZWxzIHRvIGEgcHJvdmlkZXIgdXNpbmcgZGVmYXVsdCBsYWJlbCBtYXRjaGluZyBsb2dpYy5cbiAqL1xuZnVuY3Rpb24gbWF0Y2hMYWJlbHNUb1Byb3ZpZGVyKGpvYkxhYmVsczogc3RyaW5nW10sIHByb3ZpZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+KTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3Qgam9iTGFiZWxMb3dlckNhc2UgPSBqb2JMYWJlbHMubWFwKChsYWJlbCkgPT4gbGFiZWwudG9Mb3dlckNhc2UoKSk7XG5cbiAgLy8gaXMgZXZlcnkgbGFiZWwgdGhlIGpvYiByZXF1aXJlcyBhdmFpbGFibGUgaW4gdGhlIHJ1bm5lciBwcm92aWRlcj9cbiAgZm9yIChjb25zdCBwcm92aWRlciBvZiBPYmplY3Qua2V5cyhwcm92aWRlcnMpKSB7XG4gICAgY29uc3QgcHJvdmlkZXJMYWJlbHNMb3dlckNhc2UgPSBwcm92aWRlcnNbcHJvdmlkZXJdLm1hcCgobGFiZWwpID0+IGxhYmVsLnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmIChqb2JMYWJlbExvd2VyQ2FzZS5ldmVyeShsYWJlbCA9PiBsYWJlbCA9PSAnc2VsZi1ob3N0ZWQnIHx8IHByb3ZpZGVyTGFiZWxzTG93ZXJDYXNlLmluY2x1ZGVzKGxhYmVsKSkpIHtcbiAgICAgIHJldHVybiBwcm92aWRlcjtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG4vKipcbiAqIENhbGwgdGhlIHByb3ZpZGVyIHNlbGVjdG9yIExhbWJkYSBmdW5jdGlvbiBpZiBjb25maWd1cmVkLlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjYWxsUHJvdmlkZXJTZWxlY3RvcihcbiAgcGF5bG9hZDogYW55LFxuICBwcm92aWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPixcbiAgZGVmYXVsdFNlbGVjdGlvbjogUHJvdmlkZXJTZWxlY3RvclJlc3VsdCxcbik6IFByb21pc2U8UHJvdmlkZXJTZWxlY3RvclJlc3VsdCB8IHVuZGVmaW5lZD4ge1xuICBpZiAoIXByb2Nlc3MuZW52LlBST1ZJREVSX1NFTEVDVE9SX0FSTikge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBjb25zdCBzZWxlY3RvcklucHV0OiBQcm92aWRlclNlbGVjdG9ySW5wdXQgPSB7XG4gICAgcGF5bG9hZDogcGF5bG9hZCxcbiAgICBwcm92aWRlcnM6IHByb3ZpZGVycyxcbiAgICBkZWZhdWx0UHJvdmlkZXI6IGRlZmF1bHRTZWxlY3Rpb24ucHJvdmlkZXIsXG4gICAgZGVmYXVsdExhYmVsczogZGVmYXVsdFNlbGVjdGlvbi5sYWJlbHMsXG4gIH07XG5cbiAgLy8gZG9uJ3QgY2F0Y2ggZXJyb3JzIC0tIHRoZSB3aG9sZSB3ZWJob29rIGhhbmRsZXIgd2lsbCBiZSByZXRyaWVkIG9uIHVuaGFuZGxlZCBlcnJvcnNcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgbGFtYmRhQ2xpZW50LnNlbmQobmV3IEludm9rZUNvbW1hbmQoe1xuICAgIEZ1bmN0aW9uTmFtZTogcHJvY2Vzcy5lbnYuUFJPVklERVJfU0VMRUNUT1JfQVJOLFxuICAgIFBheWxvYWQ6IEpTT04uc3RyaW5naWZ5KHNlbGVjdG9ySW5wdXQpLFxuICB9KSk7XG5cbiAgaWYgKHJlc3VsdC5GdW5jdGlvbkVycm9yKSB7XG4gICAgY29uc3Qgc2VsZWN0b3JSZXNwb25zZVBheWxvYWQgPSByZXN1bHQuUGF5bG9hZCA/IEJ1ZmZlci5mcm9tKHJlc3VsdC5QYXlsb2FkKS50b1N0cmluZygpIDogdW5kZWZpbmVkO1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnUHJvdmlkZXIgc2VsZWN0b3IgZmFpbGVkJyxcbiAgICAgIGZ1bmN0aW9uRXJyb3I6IHJlc3VsdC5GdW5jdGlvbkVycm9yLFxuICAgICAgcGF5bG9hZDogc2VsZWN0b3JSZXNwb25zZVBheWxvYWQsXG4gICAgfSk7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdQcm92aWRlciBzZWxlY3RvciBmYWlsZWQnKTtcbiAgfVxuXG4gIGlmICghcmVzdWx0LlBheWxvYWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1Byb3ZpZGVyIHNlbGVjdG9yIHJldHVybmVkIG5vIHBheWxvYWQnKTtcbiAgfVxuXG4gIHJldHVybiBKU09OLnBhcnNlKEJ1ZmZlci5mcm9tKHJlc3VsdC5QYXlsb2FkKS50b1N0cmluZygpKSBhcyBQcm92aWRlclNlbGVjdG9yUmVzdWx0O1xufVxuXG4vKipcbiAqIEV4cG9ydGVkIGZvciB1bml0IHRlc3RpbmcuXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNlbGVjdFByb3ZpZGVyKHBheWxvYWQ6IGFueSwgam9iTGFiZWxzOiBzdHJpbmdbXSwgaG9vayA9IGNhbGxQcm92aWRlclNlbGVjdG9yKTogUHJvbWlzZTxQcm92aWRlclNlbGVjdG9yUmVzdWx0PiB7XG4gIGNvbnN0IHByb3ZpZGVycyA9IEpTT04ucGFyc2UocHJvY2Vzcy5lbnYuUFJPVklERVJTISk7XG4gIGNvbnN0IGRlZmF1bHRQcm92aWRlciA9IG1hdGNoTGFiZWxzVG9Qcm92aWRlcihqb2JMYWJlbHMsIHByb3ZpZGVycyk7XG4gIGNvbnN0IGRlZmF1bHRMYWJlbHMgPSBkZWZhdWx0UHJvdmlkZXIgPyBwcm92aWRlcnNbZGVmYXVsdFByb3ZpZGVyXSA6IHVuZGVmaW5lZDtcbiAgY29uc3QgZGVmYXVsdFNlbGVjdGlvbiA9IHsgcHJvdmlkZXI6IGRlZmF1bHRQcm92aWRlciwgbGFiZWxzOiBkZWZhdWx0TGFiZWxzIH07XG4gIGNvbnN0IHNlbGVjdG9yUmVzdWx0ID0gYXdhaXQgaG9vayhwYXlsb2FkLCBwcm92aWRlcnMsIGRlZmF1bHRTZWxlY3Rpb24pO1xuXG4gIGlmIChzZWxlY3RvclJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIGRlZmF1bHRTZWxlY3Rpb247XG4gIH1cblxuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnQmVmb3JlIHByb3ZpZGVyIHNlbGVjdG9yJyxcbiAgICBwcm92aWRlcjogZGVmYXVsdFByb3ZpZGVyLFxuICAgIGxhYmVsczogZGVmYXVsdExhYmVscyxcbiAgICBqb2JMYWJlbHM6IGpvYkxhYmVscyxcbiAgfSk7XG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdBZnRlciBwcm92aWRlciBzZWxlY3RvcicsXG4gICAgcHJvdmlkZXI6IHNlbGVjdG9yUmVzdWx0LnByb3ZpZGVyLFxuICAgIGxhYmVsczogc2VsZWN0b3JSZXN1bHQubGFiZWxzLFxuICAgIGpvYkxhYmVsczogam9iTGFiZWxzLFxuICB9KTtcblxuICAvLyBhbnkgZXJyb3IgaGVyZSB3aWxsIGZhaWwgdGhlIHdlYmhvb2sgYW5kIGNhdXNlIGEgcmV0cnkgc28gdGhlIHNlbGVjdG9yIGhhcyBhbm90aGVyIGNoYW5jZSB0byBnZXQgaXQgcmlnaHRcbiAgaWYgKHNlbGVjdG9yUmVzdWx0LnByb3ZpZGVyICE9PSB1bmRlZmluZWQpIHtcbiAgICBpZiAoc2VsZWN0b3JSZXN1bHQucHJvdmlkZXIgPT09ICcnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Byb3ZpZGVyIHNlbGVjdG9yIHJldHVybmVkIGVtcHR5IHByb3ZpZGVyJyk7XG4gICAgfVxuICAgIGlmICghcHJvdmlkZXJzW3NlbGVjdG9yUmVzdWx0LnByb3ZpZGVyXSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBQcm92aWRlciBzZWxlY3RvciByZXR1cm5lZCB1bmtub3duIHByb3ZpZGVyICR7c2VsZWN0b3JSZXN1bHQucHJvdmlkZXJ9YCk7XG4gICAgfVxuICAgIGlmIChzZWxlY3RvclJlc3VsdC5sYWJlbHMgPT09IHVuZGVmaW5lZCB8fCBzZWxlY3RvclJlc3VsdC5sYWJlbHMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Byb3ZpZGVyIHNlbGVjdG9yIG11c3QgcmV0dXJuIG5vbi1lbXB0eSBsYWJlbHMgd2hlbiBwcm92aWRlciBpcyBzZXQnKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gc2VsZWN0b3JSZXN1bHQ7XG59XG5cbi8qKlxuICogR2VuZXJhdGUgYSB1bmlxdWUgZXhlY3V0aW9uIG5hbWUgd2hpY2ggaXMgbGltaXRlZCB0byA2NCBjaGFyYWN0ZXJzIChhbHNvIHVzZWQgYXMgcnVubmVyIG5hbWUpLlxuICpcbiAqIEV4cG9ydGVkIGZvciB1bml0IHRlc3RpbmcuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZUV4ZWN1dGlvbk5hbWUoZXZlbnQ6IGFueSwgcGF5bG9hZDogYW55KTogc3RyaW5nIHtcbiAgY29uc3QgZGVsaXZlcnlJZCA9IGdldEhlYWRlcihldmVudCwgJ3gtZ2l0aHViLWRlbGl2ZXJ5JykgPz8gYCR7TWF0aC5yYW5kb20oKX1gO1xuICBjb25zdCByZXBvTmFtZVRydW5jYXRlZCA9IHBheWxvYWQucmVwb3NpdG9yeS5uYW1lLnNsaWNlKDAsIDY0IC0gZGVsaXZlcnlJZC5sZW5ndGggLSAxKTtcbiAgcmV0dXJuIGAke3JlcG9OYW1lVHJ1bmNhdGVkfS0ke2RlbGl2ZXJ5SWR9YDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQ6IEFXU0xhbWJkYS5BUElHYXRld2F5UHJveHlFdmVudFYyKTogUHJvbWlzZTxBV1NMYW1iZGEuQVBJR2F0ZXdheVByb3h5UmVzdWx0VjI+IHtcbiAgaWYgKCFwcm9jZXNzLmVudi5XRUJIT09LX1NFQ1JFVF9BUk4gfHwgIXByb2Nlc3MuZW52LlNURVBfRlVOQ1RJT05fQVJOIHx8ICFwcm9jZXNzLmVudi5QUk9WSURFUlMgfHwgIXByb2Nlc3MuZW52LlJFUVVJUkVfU0VMRl9IT1NURURfTEFCRUwpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ01pc3NpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzJyk7XG4gIH1cblxuICBjb25zdCB3ZWJob29rU2VjcmV0ID0gKGF3YWl0IGdldFNlY3JldEpzb25WYWx1ZShwcm9jZXNzLmVudi5XRUJIT09LX1NFQ1JFVF9BUk4pKS53ZWJob29rU2VjcmV0O1xuXG4gIGxldCBib2R5O1xuICB0cnkge1xuICAgIGJvZHkgPSB2ZXJpZnlCb2R5KGV2ZW50LCB3ZWJob29rU2VjcmV0KTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnQmFkIHNpZ25hdHVyZScsXG4gICAgICBlcnJvcjogYCR7ZX1gLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA0MDMsXG4gICAgICBib2R5OiAnQmFkIHNpZ25hdHVyZScsXG4gICAgfTtcbiAgfVxuXG4gIGlmIChnZXRIZWFkZXIoZXZlbnQsICdjb250ZW50LXR5cGUnKSAhPT0gJ2FwcGxpY2F0aW9uL2pzb24nKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdUaGlzIHdlYmhvb2sgb25seSBhY2NlcHRzIEpTT04gcGF5bG9hZHMnLFxuICAgICAgY29udGVudFR5cGU6IGdldEhlYWRlcihldmVudCwgJ2NvbnRlbnQtdHlwZScpLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICBib2R5OiAnRXhwZWN0aW5nIEpTT04gcGF5bG9hZCcsXG4gICAgfTtcbiAgfVxuXG4gIGlmIChnZXRIZWFkZXIoZXZlbnQsICd4LWdpdGh1Yi1ldmVudCcpID09PSAncGluZycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogJ1BvbmcnLFxuICAgIH07XG4gIH1cblxuICAvLyBpZiAoZ2V0SGVhZGVyKGV2ZW50LCAneC1naXRodWItZXZlbnQnKSAhPT0gJ3dvcmtmbG93X2pvYicgJiYgZ2V0SGVhZGVyKGV2ZW50LCAneC1naXRodWItZXZlbnQnKSAhPT0gJ3dvcmtmbG93X3J1bicpIHtcbiAgLy8gICAgIGNvbnNvbGUuZXJyb3IoYFRoaXMgd2ViaG9vayBvbmx5IGFjY2VwdHMgd29ya2Zsb3dfam9iIGFuZCB3b3JrZmxvd19ydW4sIGdvdCAke2dldEhlYWRlcihldmVudCwgJ3gtZ2l0aHViLWV2ZW50Jyl9YCk7XG4gIGlmIChnZXRIZWFkZXIoZXZlbnQsICd4LWdpdGh1Yi1ldmVudCcpICE9PSAnd29ya2Zsb3dfam9iJykge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnVGhpcyB3ZWJob29rIG9ubHkgYWNjZXB0cyB3b3JrZmxvd19qb2InLFxuICAgICAgZ2l0aHViRXZlbnQ6IGdldEhlYWRlcihldmVudCwgJ3gtZ2l0aHViLWV2ZW50JyksXG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6ICdFeHBlY3Rpbmcgd29ya2Zsb3dfam9iJyxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UoYm9keSk7XG5cbiAgaWYgKHBheWxvYWQuYWN0aW9uICE9PSAncXVldWVkJykge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogYElnbm9yaW5nIGFjdGlvbiBcIiR7cGF5bG9hZC5hY3Rpb259XCIsIGV4cGVjdGluZyBcInF1ZXVlZFwiYCxcbiAgICAgIGpvYjogcGF5bG9hZC53b3JrZmxvd19qb2IsXG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGJvZHk6ICdPSy4gTm8gcnVubmVyIHN0YXJ0ZWQgKGFjdGlvbiBpcyBub3QgXCJxdWV1ZWRcIikuJyxcbiAgICB9O1xuICB9XG5cbiAgaWYgKHByb2Nlc3MuZW52LlJFUVVJUkVfU0VMRl9IT1NURURfTEFCRUwgPT09ICcxJyAmJiAhcGF5bG9hZC53b3JrZmxvd19qb2IubGFiZWxzLmluY2x1ZGVzKCdzZWxmLWhvc3RlZCcpKSB7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiBgSWdub3JpbmcgbGFiZWxzIFwiJHtwYXlsb2FkLndvcmtmbG93X2pvYi5sYWJlbHN9XCIsIGV4cGVjdGluZyBcInNlbGYtaG9zdGVkXCJgLFxuICAgICAgam9iOiBwYXlsb2FkLndvcmtmbG93X2pvYixcbiAgICB9KTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgYm9keTogJ09LLiBObyBydW5uZXIgc3RhcnRlZCAobm8gXCJzZWxmLWhvc3RlZFwiIGxhYmVsKS4nLFxuICAgIH07XG4gIH1cblxuICAvLyBTZWxlY3QgcHJvdmlkZXIgYW5kIGxhYmVsc1xuICBjb25zdCBzZWxlY3Rpb24gPSBhd2FpdCBzZWxlY3RQcm92aWRlcihwYXlsb2FkLCBwYXlsb2FkLndvcmtmbG93X2pvYi5sYWJlbHMpO1xuICBpZiAoIXNlbGVjdGlvbi5wcm92aWRlciB8fCAhc2VsZWN0aW9uLmxhYmVscykge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogYElnbm9yaW5nIGxhYmVscyBcIiR7cGF5bG9hZC53b3JrZmxvd19qb2IubGFiZWxzfVwiLCBhcyB0aGV5IGRvbid0IG1hdGNoIGEgc3VwcG9ydGVkIHJ1bm5lciBwcm92aWRlcmAsXG4gICAgICBqb2I6IHBheWxvYWQud29ya2Zsb3dfam9iLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiAnT0suIE5vIHJ1bm5lciBzdGFydGVkIChubyBwcm92aWRlciB3aXRoIG1hdGNoaW5nIGxhYmVscykuJyxcbiAgICB9O1xuICB9XG5cbiAgLy8gZG9uJ3Qgc3RhcnQgcnVubmVycyBmb3IgYSBkZXBsb3ltZW50IHRoYXQncyBzdGlsbCBwZW5kaW5nIGFzIEdpdEh1YiB3aWxsIHNlbmQgYW5vdGhlciBldmVudCB3aGVuIGl0J3MgcmVhZHlcbiAgaWYgKGF3YWl0IGlzRGVwbG95bWVudFBlbmRpbmcocGF5bG9hZCkpIHtcbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdJZ25vcmluZyBqb2IgYXMgaXRzIGRlcGxveW1lbnQgaXMgc3RpbGwgcGVuZGluZycsXG4gICAgICBqb2I6IHBheWxvYWQud29ya2Zsb3dfam9iLFxuICAgIH0pO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBib2R5OiAnT0suIE5vIHJ1bm5lciBzdGFydGVkIChkZXBsb3ltZW50IHBlbmRpbmcpLicsXG4gICAgfTtcbiAgfVxuXG4gIC8vIHN0YXJ0IGV4ZWN1dGlvblxuICBjb25zdCBleGVjdXRpb25OYW1lID0gZ2VuZXJhdGVFeGVjdXRpb25OYW1lKGV2ZW50LCBwYXlsb2FkKTtcbiAgY29uc3QgaW5wdXQgPSB7XG4gICAgb3duZXI6IHBheWxvYWQucmVwb3NpdG9yeS5vd25lci5sb2dpbixcbiAgICByZXBvOiBwYXlsb2FkLnJlcG9zaXRvcnkubmFtZSxcbiAgICBqb2JJZDogcGF5bG9hZC53b3JrZmxvd19qb2IuaWQsXG4gICAgam9iVXJsOiBwYXlsb2FkLndvcmtmbG93X2pvYi5odG1sX3VybCxcbiAgICBpbnN0YWxsYXRpb25JZDogcGF5bG9hZC5pbnN0YWxsYXRpb24/LmlkID8/IC0xLCAvLyBhbHdheXMgcGFzcyB2YWx1ZSBiZWNhdXNlIHN0ZXAgZnVuY3Rpb24gY2FuJ3QgaGFuZGxlIG1pc3NpbmcgaW5wdXRcbiAgICBqb2JMYWJlbHM6IHBheWxvYWQud29ya2Zsb3dfam9iLmxhYmVscy5qb2luKCcsJyksIC8vIG9yaWdpbmFsIGxhYmVscyByZXF1ZXN0ZWQgYnkgdGhlIGpvYlxuICAgIHByb3ZpZGVyOiBzZWxlY3Rpb24ucHJvdmlkZXIsXG4gICAgbGFiZWxzOiBzZWxlY3Rpb24ubGFiZWxzLmpvaW4oJywnKSwgLy8gbGFiZWxzIHRvIHVzZSB3aGVuIHJlZ2lzdGVyaW5nIHJ1bm5lclxuICB9O1xuICBjb25zdCBleGVjdXRpb24gPSBhd2FpdCBzZi5zZW5kKG5ldyBTdGFydEV4ZWN1dGlvbkNvbW1hbmQoe1xuICAgIHN0YXRlTWFjaGluZUFybjogcHJvY2Vzcy5lbnYuU1RFUF9GVU5DVElPTl9BUk4sXG4gICAgaW5wdXQ6IEpTT04uc3RyaW5naWZ5KGlucHV0KSxcbiAgICAvLyBuYW1lIGlzIG5vdCByYW5kb20gc28gbXVsdGlwbGUgZXhlY3V0aW9uIG9mIHRoaXMgd2ViaG9vayB3b24ndCBjYXVzZSBtdWx0aXBsZSBidWlsZGVycyB0byBzdGFydFxuICAgIG5hbWU6IGV4ZWN1dGlvbk5hbWUsXG4gIH0pKTtcblxuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnU3RhcnRlZCBvcmNoZXN0cmF0b3InLFxuICAgIGV4ZWN1dGlvbjogZXhlY3V0aW9uLmV4ZWN1dGlvbkFybixcbiAgICBzZm5JbnB1dDogaW5wdXQsXG4gICAgam9iOiBwYXlsb2FkLndvcmtmbG93X2pvYixcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBzdGF0dXNDb2RlOiAyMDIsXG4gICAgYm9keTogZXhlY3V0aW9uTmFtZSxcbiAgfTtcbn1cbiJdfQ==