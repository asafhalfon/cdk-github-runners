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
exports.MAX_REPLACEMENTS = void 0;
exports.replacementRunnerName = replacementRunnerName;
exports.parseRunnerReport = parseRunnerReport;
exports.handler = handler;
const zlib = __importStar(require("zlib"));
const client_sfn_1 = require("@aws-sdk/client-sfn");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const lambda_common_1 = require("./lambda-common");
const lambda_github_1 = require("./lambda-github");
const lambda_tracker_1 = require("./lambda-tracker");
const sfn = new client_sfn_1.SFNClient();
const sqs = new client_sqs_1.SQSClient();
/**
 * Limit the amount of times we try to replace a stolen runner. Mostly so we don't end up in a replacement loop.
 *
 * @internal
 */
exports.MAX_REPLACEMENTS = 3;
/**
 * @internal
 */
function replacementRunnerName(stolenRunnerName) {
    const match = stolenRunnerName.match(/^(.*)-r(\d+)$/);
    const base = match ? match[1] : stolenRunnerName;
    const attempt = match ? parseInt(match[2], 10) + 1 : 1;
    const suffix = `-r${attempt}`;
    return [`${base.slice(0, lambda_common_1.MAX_RUNNER_NAME_LENGTH - suffix.length)}${suffix}`, attempt];
}
function executionArn(runnerName) {
    const stateMachineArn = process.env.STEP_FUNCTION_ARN;
    if (!stateMachineArn) {
        throw new Error('Missing STEP_FUNCTION_ARN environment variable');
    }
    return `${stateMachineArn.replace(':stateMachine:', ':execution:')}:${runnerName}`;
}
async function findRunnerInput(runnerName) {
    try {
        const execution = await sfn.send(new client_sfn_1.DescribeExecutionCommand({ executionArn: executionArn(runnerName) }));
        return execution.input ? JSON.parse(execution.input) : undefined;
    }
    catch (e) {
        if (e instanceof client_sfn_1.ExecutionDoesNotExist) {
            // somebody else's runner, or one from before this was deployed
            return undefined;
        }
        throw e;
    }
}
/**
 * Get job id from report that only contains runner name, repo, and workflow run id.
 * We list all jobs for the workflow and look for a matching runner name.
 *
 * GitHub doesn't have a better API for this. It also doesn't expose job id to the job.
 */
async function listJobs(owner, repo, workflowId, installationId) {
    const { octokit } = await (0, lambda_github_1.getOctokit)(installationId);
    return octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
        owner,
        repo,
        run_id: workflowId,
        filter: 'all', // all workflow attempts
        per_page: 100,
    });
}
async function findJobFromReport(report) {
    const [owner, repo] = report.repo.split('/');
    if (!owner || !repo) {
        console.warn({ notice: 'Runner reported a repository we cannot parse', report });
        return { result: 'unknown' };
    }
    let installationId;
    try {
        installationId = await (0, lambda_github_1.resolveInstallationId)(owner, repo);
    }
    catch (e) {
        if (!(0, lambda_github_1.isNotFound)(e)) {
            throw e;
        }
        // our app isn't installed there, so we never started a runner for anything in that repo. the job that ran there stole the runner from a repo we
        // actually manage. we should replace that runner so the original job can run.
        //
        // this assumption only works for app authentication where the webhook notifies us of jobs on the repos the app is installed on. and in turn the
        // app only has access to, and can only start runners for, the repos it is installed on.
        //
        // PATs have no such promise: they ignore installation ids entirely, so a hand configured webhook works and the two sets can drift apart.
        // that is why this branch is unreachable for them. we can't guarantee (yet) that we will fail to list jobs because the repo truly doesn't exist.
        // a 404 below on listJobs() can mean the job truly doesn't exist, or it can mean the repo exists but the PAT doesn't have access to it while the
        // webhook does report on it.
        return { result: 'invisible-repo' };
    }
    let jobs;
    try {
        jobs = await listJobs(owner, repo, report.workflowId, installationId);
    }
    catch (e) {
        if (!(0, lambda_github_1.isNotFound)(e)) {
            throw e;
        }
        // we can see this repo and there is no such run, so the runner made it up. ignore.
        console.warn({ notice: 'GitHub knows nothing about the run this runner reported', report });
        return { result: 'unknown' };
    }
    const job = jobs.find(j => j.runner_name === report.runnerName);
    if (!job) {
        // can't find the job based on workflow id + runner name. the runner made the job up. ignore.
        console.warn({ notice: 'No job in this workflow run ran on this runner', report, jobs: jobs.length });
        return { result: 'unknown' };
    }
    return { result: 'job', jobId: job.id };
}
/**
 * Start another runner just like the one that was stolen.
 */
async function replaceRunner(stolenRunnerName, input, thiefJobId) {
    const [runnerName, attempt] = replacementRunnerName(stolenRunnerName);
    if (attempt > exports.MAX_REPLACEMENTS) {
        // avoid infinite loops if a runner is stolen repeatedly
        // it might be a bug in our detection...
        console.warn({
            notice: 'Runner was stolen, not replaced because it has already been replaced too many times',
            metric: 'StolenRunnerDetected',
            replaced: 'false', // metric filter drops ALL dimensions for if this is a real boolean
            stolenRunnerName,
            runnerName,
            attempt,
            stolenByJobId: thiefJobId,
            jobId: input.jobId,
            jobUrl: input.jobUrl,
            owner: input.owner,
            repo: input.repo,
            provider: input.provider,
        });
        return;
    }
    try {
        await sfn.send(new client_sfn_1.StartExecutionCommand({
            stateMachineArn: process.env.STEP_FUNCTION_ARN,
            name: runnerName,
            input: JSON.stringify(input),
        }));
    }
    catch (e) {
        if (e instanceof client_sfn_1.ExecutionAlreadyExists) {
            // we already heard about this theft
            console.log({ notice: 'Replacement runner already started', stolenRunnerName, runnerName });
            return;
        }
        throw e;
    }
    console.warn({
        notice: 'Runner was stolen, started another one',
        metric: 'StolenRunnerDetected',
        replaced: 'true', // metric filter drops ALL dimensions for if this is a real boolean
        stolenRunnerName,
        runnerName,
        attempt,
        stolenByJobId: thiefJobId,
        jobId: input.jobId,
        jobUrl: input.jobUrl,
        owner: input.owner,
        repo: input.repo,
        provider: input.provider,
    });
}
/**
 * Check if runner was stolen and possibly replace it.
 */
async function handleRunnerReport(report) {
    const input = await findRunnerInput(report.runnerName);
    if (!input) {
        return;
    }
    // the runner got a job, so the idle reaper doesn't need to look for a job it left without a runner once it's gone
    await (0, lambda_tracker_1.recordRunnerAccounted)(report.runnerName, report.jobId);
    if (input.jobId == lambda_common_1.WARM_RUNNER_JOB_ID) {
        // warm runners aren't started for any job in particular, so nothing they run is technically stolen
        // warm runner keeper starts a replacement on its own as soon as it sees a warm runner go busy
        console.log({
            notice: 'Warm runner taken',
            metric: 'WarmRunnerTaken',
            runnerName: report.runnerName,
            repo: report.repo,
            runId: report.workflowId,
        });
        return;
    }
    let jobId = report.jobId; // can be reported from workflow_job.in_progress directly
    if (jobId === undefined) {
        const job = await findJobFromReport(report);
        if (job.result === 'invisible-repo') {
            // nothing we start could be running there, so this one was stolen
            console.warn({
                notice: 'Runner ran a job in a repository our app cannot see',
                report,
            });
            await replaceRunner(report.runnerName, input);
            return;
        }
        if (job.result === 'unknown') {
            // we couldn't find the job, even though we should have
            // bad input... don't act on it
            console.warn({
                notice: 'Could not tell which job this runner ran',
                report,
            });
            return;
        }
        jobId = job.jobId;
    }
    if (jobId === input.jobId) {
        // ran the job it was started for, which is the whole point
        // no need to do anything or even check the jobs table...
        return;
    }
    const otherRunnerLabels = await (0, lambda_tracker_1.controlledJobRunnerLabels)(jobId);
    if (otherRunnerLabels) {
        if ((0, lambda_common_1.labelsMatch)(input.jobLabels.split(','), otherRunnerLabels)) {
            // GitHub shuffled jobs between runners we started
            // the runner we started for that job can run this runner's job instead, so no job is left hanging
            console.log({
                notice: 'Runner ran another job of ours',
                runnerName: report.runnerName,
                jobId,
                expectedJobId: input.jobId,
            });
            return;
        }
        // the runner we started for that job can't run this runner's job (e.g. a [self-hosted, lambda] job took a runner started for
        // [self-hosted, lambda, arm64] while its own runner is x64). this runner's job is left without a runner, so treat it as stolen.
        console.log({
            notice: 'Runner ran another job of ours, but that job\'s runner can\'t run this one\'s',
            runnerName: report.runnerName,
            jobId,
            expectedJobId: input.jobId,
            otherRunnerLabels,
            expectedJobLabels: input.jobLabels,
        });
    }
    // runner ran a job we never started a runner for, or one whose runner can't take over
    // runner was stolen, start another one just like it
    await replaceRunner(report.runnerName, input, jobId);
}
/**
 * Send log messages to SQS so we can delay and batch them. This helps make sure we process them *after* the webhook arrives and writes to DDB.
 */
async function handleRunnerLogs(event) {
    const queueUrl = process.env.JOB_ASSIGNMENT_QUEUE_URL;
    if (!queueUrl) {
        throw new Error('Missing JOB_ASSIGNMENT_QUEUE_URL environment variable');
    }
    const payload = JSON.parse(zlib.gunzipSync(Buffer.from(event.awslogs.data, 'base64')).toString('utf8'));
    const messages = [];
    const reportedRunnersInThisDelivery = new Set();
    for (const logEvent of payload.logEvents) {
        const message = parseRunnerReport(logEvent.message);
        if (message) {
            // don't let misconfigured/malicious jobs make us start or even query too many runners.
            // there should only ever be one report per runner and any malicious code shouldn't be able to guess our runner names.
            // runner names are based on github webhook execution ids, which are random uuids.
            if (reportedRunnersInThisDelivery.has(message.runnerName)) {
                console.warn({ notice: 'Already handled a report from this runner', runnerName: message.runnerName });
                continue;
            }
            reportedRunnersInThisDelivery.add(message.runnerName);
            // put on queue so webhook has time to arrive and write to DDB before we try to read it
            messages.push(message);
        }
        else {
            console.warn({
                notice: 'Unparsable runner report',
                logGroup: payload.logGroup,
                logStream: payload.logStream,
                message: logEvent.message,
            });
        }
    }
    // batches of ten, which is both the SQS limit and more reports than one log delivery should ever carry
    for (let i = 0; i < messages.length; i += 10) {
        const batch = messages.slice(i, i + 10);
        await sqs.send(new client_sqs_1.SendMessageBatchCommand({
            QueueUrl: queueUrl,
            Entries: batch.map((message, index) => ({
                Id: `${i + index}`,
                MessageBody: JSON.stringify(message),
                // one report per runner. the webhook sends the same pair, so whichever arrives first wins and the other is
                // dropped by the queue. a group per runner means runners never queue behind each other.
                MessageGroupId: message.runnerName,
                MessageDeduplicationId: message.runnerName,
            })),
        }));
    }
    console.log({
        notice: 'Queued runner reports',
        logGroup: payload.logGroup,
        count: messages.length,
    });
}
/**
 * @internal
 */
function parseRunnerReport(line) {
    // this data can't be fully trusted as the jobs themselves can run untrusted code... but:
    //   1. the untrusted code has access to just one runner name
    //   2. we only ever act on the first report for a runner (the queue deduplicates on the runner name)
    //   3. the new runner we start will have a specific name and step functions will reject duplicate names (idempotent)
    // so malicious code shouldn't be able to trick us into starting too many runners, or into making us call GitHub
    // over and over until we run out of rate limit for starting runners
    const match = line.match(/CDKGHR JOB RUNNER=(\S+) REPO=(\S+) WORKFLOW_ID=(\d+)/);
    if (!match) {
        return undefined;
    }
    return {
        kind: 'report',
        runnerName: match[1],
        repo: match[2],
        workflowId: parseInt(match[3], 10),
    };
}
function isCloudWatchLogsEvent(event) {
    return typeof event?.awslogs?.data === 'string';
}
async function handler(event) {
    if (isCloudWatchLogsEvent(event)) {
        // let this throw. CloudWatch Logs retries the delivery, and a lost report is a missed stolen runner.
        return handleRunnerLogs(event);
    }
    const result = { batchItemFailures: [] };
    for (const record of event.Records) {
        let report;
        try {
            report = JSON.parse(record.body);
        }
        catch (e) {
            console.error({
                notice: 'Failed to parse message body',
                messageId: record.messageId,
                error: `${e}`,
            });
            continue;
        }
        try {
            await handleRunnerReport(report);
        }
        catch (e) {
            console.error({
                notice: 'Failed to process runner report',
                messageId: record.messageId,
                report,
                error: `${e}`,
            });
            result.batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvbGVuLXJ1bm5lci1oYW5kbGVyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9zdG9sZW4tcnVubmVyLWhhbmRsZXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQTJCQSxzREFPQztBQStTRCw4Q0FrQkM7QUFNRCwwQkFtQ0M7QUE1WUQsMkNBQTZCO0FBQzdCLG9EQU02QjtBQUM3QixvREFBeUU7QUFFekUsbURBQTZHO0FBQzdHLG1EQUFnRjtBQUNoRixxREFBeUc7QUFFekcsTUFBTSxHQUFHLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFDNUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFFNUI7Ozs7R0FJRztBQUNVLFFBQUEsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO0FBRWxDOztHQUVHO0FBQ0gsU0FBZ0IscUJBQXFCLENBQUMsZ0JBQXdCO0lBQzVELE1BQU0sS0FBSyxHQUFHLGdCQUFnQixDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsQ0FBQztJQUN0RCxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLENBQUM7SUFDakQsTUFBTSxPQUFPLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3ZELE1BQU0sTUFBTSxHQUFHLEtBQUssT0FBTyxFQUFFLENBQUM7SUFFOUIsT0FBTyxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsc0NBQXNCLEdBQUcsTUFBTSxDQUFDLE1BQU0sQ0FBQyxHQUFHLE1BQU0sRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQ3hG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QUFLLE1BQU0sTUFBTSxJQUFJLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNuQyxJQUFJLE1BQTJCLENBQUM7UUFDaEMsSUFBSSxDQUFDO1lBQ0gsTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBd0IsQ0FBQztRQUMxRCxDQUFDO1FBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUM7Z0JBQ1osTUFBTSxFQUFFLDhCQUE4QjtnQkFDdEMsU0FBUyxFQUFFLE1BQU0sQ0FBQyxTQUFTO2dCQUMzQixLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7YUFDZCxDQUFDLENBQUM7WUFDSCxTQUFTO1FBQ1gsQ0FBQztRQUVELElBQUksQ0FBQztZQUNILE1BQU0sa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDbkMsQ0FBQztRQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDWCxPQUFPLENBQUMsS0FBSyxDQUFDO2dCQUNaLE1BQU0sRUFBRSxpQ0FBaUM7Z0JBQ3pDLFNBQVMsRUFBRSxNQUFNLENBQUMsU0FBUztnQkFDM0IsTUFBTTtnQkFDTixLQUFLLEVBQUUsR0FBRyxDQUFDLEVBQUU7YUFDZCxDQUFDLENBQUM7WUFDSCxNQUFNLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLEVBQUUsY0FBYyxFQUFFLE1BQU0sQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBQ3RFLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHpsaWIgZnJvbSAnemxpYic7XG5pbXBvcnQge1xuICBEZXNjcmliZUV4ZWN1dGlvbkNvbW1hbmQsXG4gIEV4ZWN1dGlvbkFscmVhZHlFeGlzdHMsXG4gIEV4ZWN1dGlvbkRvZXNOb3RFeGlzdCxcbiAgU0ZOQ2xpZW50LFxuICBTdGFydEV4ZWN1dGlvbkNvbW1hbmQsXG59IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zZm4nO1xuaW1wb3J0IHsgU2VuZE1lc3NhZ2VCYXRjaENvbW1hbmQsIFNRU0NsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xuaW1wb3J0ICogYXMgQVdTTGFtYmRhIGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgbGFiZWxzTWF0Y2gsIE1BWF9SVU5ORVJfTkFNRV9MRU5HVEgsIE9yY2hlc3RyYXRvcklucHV0LCBXQVJNX1JVTk5FUl9KT0JfSUQgfSBmcm9tICcuL2xhbWJkYS1jb21tb24nO1xuaW1wb3J0IHsgZ2V0T2N0b2tpdCwgaXNOb3RGb3VuZCwgcmVzb2x2ZUluc3RhbGxhdGlvbklkIH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcbmltcG9ydCB7IGNvbnRyb2xsZWRKb2JSdW5uZXJMYWJlbHMsIHJlY29yZFJ1bm5lckFjY291bnRlZCwgUnVubmVyUmVwb3J0TWVzc2FnZSB9IGZyb20gJy4vbGFtYmRhLXRyYWNrZXInO1xuXG5jb25zdCBzZm4gPSBuZXcgU0ZOQ2xpZW50KCk7XG5jb25zdCBzcXMgPSBuZXcgU1FTQ2xpZW50KCk7XG5cbi8qKlxuICogTGltaXQgdGhlIGFtb3VudCBvZiB0aW1lcyB3ZSB0cnkgdG8gcmVwbGFjZSBhIHN0b2xlbiBydW5uZXIuIE1vc3RseSBzbyB3ZSBkb24ndCBlbmQgdXAgaW4gYSByZXBsYWNlbWVudCBsb29wLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY29uc3QgTUFYX1JFUExBQ0VNRU5UUyA9IDM7XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXBsYWNlbWVudFJ1bm5lck5hbWUoc3RvbGVuUnVubmVyTmFtZTogc3RyaW5nKTogW3N0cmluZywgbnVtYmVyXSB7XG4gIGNvbnN0IG1hdGNoID0gc3RvbGVuUnVubmVyTmFtZS5tYXRjaCgvXiguKiktcihcXGQrKSQvKTtcbiAgY29uc3QgYmFzZSA9IG1hdGNoID8gbWF0Y2hbMV0gOiBzdG9sZW5SdW5uZXJOYW1lO1xuICBjb25zdCBhdHRlbXB0ID0gbWF0Y2ggPyBwYXJzZUludChtYXRjaFsyXSwgMTApICsgMSA6IDE7XG4gIGNvbnN0IHN1ZmZpeCA9IGAtciR7YXR0ZW1wdH1gO1xuXG4gIHJldHVybiBbYCR7YmFzZS5zbGljZSgwLCBNQVhfUlVOTkVSX05BTUVfTEVOR1RIIC0gc3VmZml4Lmxlbmd0aCl9JHtzdWZmaXh9YCwgYXR0ZW1wdF07XG59XG5cbmZ1bmN0aW9uIGV4ZWN1dGlvbkFybihydW5uZXJOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBzdGF0ZU1hY2hpbmVBcm4gPSBwcm9jZXNzLmVudi5TVEVQX0ZVTkNUSU9OX0FSTjtcbiAgaWYgKCFzdGF0ZU1hY2hpbmVBcm4pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ01pc3NpbmcgU1RFUF9GVU5DVElPTl9BUk4gZW52aXJvbm1lbnQgdmFyaWFibGUnKTtcbiAgfVxuXG4gIHJldHVybiBgJHtzdGF0ZU1hY2hpbmVBcm4ucmVwbGFjZSgnOnN0YXRlTWFjaGluZTonLCAnOmV4ZWN1dGlvbjonKX06JHtydW5uZXJOYW1lfWA7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZpbmRSdW5uZXJJbnB1dChydW5uZXJOYW1lOiBzdHJpbmcpOiBQcm9taXNlPE9yY2hlc3RyYXRvcklucHV0IHwgdW5kZWZpbmVkPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgZXhlY3V0aW9uID0gYXdhaXQgc2ZuLnNlbmQobmV3IERlc2NyaWJlRXhlY3V0aW9uQ29tbWFuZCh7IGV4ZWN1dGlvbkFybjogZXhlY3V0aW9uQXJuKHJ1bm5lck5hbWUpIH0pKTtcbiAgICByZXR1cm4gZXhlY3V0aW9uLmlucHV0ID8gSlNPTi5wYXJzZShleGVjdXRpb24uaW5wdXQpIGFzIE9yY2hlc3RyYXRvcklucHV0IDogdW5kZWZpbmVkO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKGUgaW5zdGFuY2VvZiBFeGVjdXRpb25Eb2VzTm90RXhpc3QpIHtcbiAgICAgIC8vIHNvbWVib2R5IGVsc2UncyBydW5uZXIsIG9yIG9uZSBmcm9tIGJlZm9yZSB0aGlzIHdhcyBkZXBsb3llZFxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgdGhyb3cgZTtcbiAgfVxufVxuXG4vKipcbiAqIEdldCBqb2IgaWQgZnJvbSByZXBvcnQgdGhhdCBvbmx5IGNvbnRhaW5zIHJ1bm5lciBuYW1lLCByZXBvLCBhbmQgd29ya2Zsb3cgcnVuIGlkLlxuICogV2UgbGlzdCBhbGwgam9icyBmb3IgdGhlIHdvcmtmbG93IGFuZCBsb29rIGZvciBhIG1hdGNoaW5nIHJ1bm5lciBuYW1lLlxuICpcbiAqIEdpdEh1YiBkb2Vzbid0IGhhdmUgYSBiZXR0ZXIgQVBJIGZvciB0aGlzLiBJdCBhbHNvIGRvZXNuJ3QgZXhwb3NlIGpvYiBpZCB0byB0aGUgam9iLlxuICovXG5hc3luYyBmdW5jdGlvbiBsaXN0Sm9icyhvd25lcjogc3RyaW5nLCByZXBvOiBzdHJpbmcsIHdvcmtmbG93SWQ6IG51bWJlciwgaW5zdGFsbGF0aW9uSWQ/OiBudW1iZXIpIHtcbiAgY29uc3QgeyBvY3Rva2l0IH0gPSBhd2FpdCBnZXRPY3Rva2l0KGluc3RhbGxhdGlvbklkKTtcblxuICByZXR1cm4gb2N0b2tpdC5wYWdpbmF0ZShvY3Rva2l0LnJlc3QuYWN0aW9ucy5saXN0Sm9ic0ZvcldvcmtmbG93UnVuLCB7XG4gICAgb3duZXIsXG4gICAgcmVwbyxcbiAgICBydW5faWQ6IHdvcmtmbG93SWQsXG4gICAgZmlsdGVyOiAnYWxsJywgLy8gYWxsIHdvcmtmbG93IGF0dGVtcHRzXG4gICAgcGVyX3BhZ2U6IDEwMCxcbiAgfSk7XG59XG5cbnR5cGUgSm9iRnJvbVJlcG9ydCA9XG4gIHwgeyByZXN1bHQ6ICdqb2InOyBqb2JJZDogbnVtYmVyIH1cbiAgfCB7IHJlc3VsdDogJ3Vua25vd24nIH1cbiAgfCB7IHJlc3VsdDogJ2ludmlzaWJsZS1yZXBvJyB9O1xuXG5hc3luYyBmdW5jdGlvbiBmaW5kSm9iRnJvbVJlcG9ydChyZXBvcnQ6IFJ1bm5lclJlcG9ydE1lc3NhZ2UpOiBQcm9taXNlPEpvYkZyb21SZXBvcnQ+IHtcbiAgY29uc3QgW293bmVyLCByZXBvXSA9IHJlcG9ydC5yZXBvLnNwbGl0KCcvJyk7XG4gIGlmICghb3duZXIgfHwgIXJlcG8pIHtcbiAgICBjb25zb2xlLndhcm4oeyBub3RpY2U6ICdSdW5uZXIgcmVwb3J0ZWQgYSByZXBvc2l0b3J5IHdlIGNhbm5vdCBwYXJzZScsIHJlcG9ydCB9KTtcbiAgICByZXR1cm4geyByZXN1bHQ6ICd1bmtub3duJyB9O1xuICB9XG5cbiAgbGV0IGluc3RhbGxhdGlvbklkOiBudW1iZXIgfCB1bmRlZmluZWQ7XG4gIHRyeSB7XG4gICAgaW5zdGFsbGF0aW9uSWQgPSBhd2FpdCByZXNvbHZlSW5zdGFsbGF0aW9uSWQob3duZXIsIHJlcG8pO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKCFpc05vdEZvdW5kKGUpKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgICAvLyBvdXIgYXBwIGlzbid0IGluc3RhbGxlZCB0aGVyZSwgc28gd2UgbmV2ZXIgc3RhcnRlZCBhIHJ1bm5lciBmb3IgYW55dGhpbmcgaW4gdGhhdCByZXBvLiB0aGUgam9iIHRoYXQgcmFuIHRoZXJlIHN0b2xlIHRoZSBydW5uZXIgZnJvbSBhIHJlcG8gd2VcbiAgICAvLyBhY3R1YWxseSBtYW5hZ2UuIHdlIHNob3VsZCByZXBsYWNlIHRoYXQgcnVubmVyIHNvIHRoZSBvcmlnaW5hbCBqb2IgY2FuIHJ1bi5cbiAgICAvL1xuICAgIC8vIHRoaXMgYXNzdW1wdGlvbiBvbmx5IHdvcmtzIGZvciBhcHAgYXV0aGVudGljYXRpb24gd2hlcmUgdGhlIHdlYmhvb2sgbm90aWZpZXMgdXMgb2Ygam9icyBvbiB0aGUgcmVwb3MgdGhlIGFwcCBpcyBpbnN0YWxsZWQgb24uIGFuZCBpbiB0dXJuIHRoZVxuICAgIC8vIGFwcCBvbmx5IGhhcyBhY2Nlc3MgdG8sIGFuZCBjYW4gb25seSBzdGFydCBydW5uZXJzIGZvciwgdGhlIHJlcG9zIGl0IGlzIGluc3RhbGxlZCBvbi5cbiAgICAvL1xuICAgIC8vIFBBVHMgaGF2ZSBubyBzdWNoIHByb21pc2U6IHRoZXkgaWdub3JlIGluc3RhbGxhdGlvbiBpZHMgZW50aXJlbHksIHNvIGEgaGFuZCBjb25maWd1cmVkIHdlYmhvb2sgd29ya3MgYW5kIHRoZSB0d28gc2V0cyBjYW4gZHJpZnQgYXBhcnQuXG4gICAgLy8gdGhhdCBpcyB3aHkgdGhpcyBicmFuY2ggaXMgdW5yZWFjaGFibGUgZm9yIHRoZW0uIHdlIGNhbid0IGd1YXJhbnRlZSAoeWV0KSB0aGF0IHdlIHdpbGwgZmFpbCB0byBsaXN0IGpvYnMgYmVjYXVzZSB0aGUgcmVwbyB0cnVseSBkb2Vzbid0IGV4aXN0LlxuICAgIC8vIGEgNDA0IGJlbG93IG9uIGxpc3RKb2JzKCkgY2FuIG1lYW4gdGhlIGpvYiB0cnVseSBkb2Vzbid0IGV4aXN0LCBvciBpdCBjYW4gbWVhbiB0aGUgcmVwbyBleGlzdHMgYnV0IHRoZSBQQVQgZG9lc24ndCBoYXZlIGFjY2VzcyB0byBpdCB3aGlsZSB0aGVcbiAgICAvLyB3ZWJob29rIGRvZXMgcmVwb3J0IG9uIGl0LlxuICAgIHJldHVybiB7IHJlc3VsdDogJ2ludmlzaWJsZS1yZXBvJyB9O1xuICB9XG5cbiAgbGV0IGpvYnM7XG4gIHRyeSB7XG4gICAgam9icyA9IGF3YWl0IGxpc3RKb2JzKG93bmVyLCByZXBvLCByZXBvcnQud29ya2Zsb3dJZCwgaW5zdGFsbGF0aW9uSWQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKCFpc05vdEZvdW5kKGUpKSB7XG4gICAgICB0aHJvdyBlO1xuICAgIH1cbiAgICAvLyB3ZSBjYW4gc2VlIHRoaXMgcmVwbyBhbmQgdGhlcmUgaXMgbm8gc3VjaCBydW4sIHNvIHRoZSBydW5uZXIgbWFkZSBpdCB1cC4gaWdub3JlLlxuICAgIGNvbnNvbGUud2Fybih7IG5vdGljZTogJ0dpdEh1YiBrbm93cyBub3RoaW5nIGFib3V0IHRoZSBydW4gdGhpcyBydW5uZXIgcmVwb3J0ZWQnLCByZXBvcnQgfSk7XG4gICAgcmV0dXJuIHsgcmVzdWx0OiAndW5rbm93bicgfTtcbiAgfVxuXG4gIGNvbnN0IGpvYiA9IGpvYnMuZmluZChqID0+IGoucnVubmVyX25hbWUgPT09IHJlcG9ydC5ydW5uZXJOYW1lKTtcbiAgaWYgKCFqb2IpIHtcbiAgICAvLyBjYW4ndCBmaW5kIHRoZSBqb2IgYmFzZWQgb24gd29ya2Zsb3cgaWQgKyBydW5uZXIgbmFtZS4gdGhlIHJ1bm5lciBtYWRlIHRoZSBqb2IgdXAuIGlnbm9yZS5cbiAgICBjb25zb2xlLndhcm4oeyBub3RpY2U6ICdObyBqb2IgaW4gdGhpcyB3b3JrZmxvdyBydW4gcmFuIG9uIHRoaXMgcnVubmVyJywgcmVwb3J0LCBqb2JzOiBqb2JzLmxlbmd0aCB9KTtcbiAgICByZXR1cm4geyByZXN1bHQ6ICd1bmtub3duJyB9O1xuICB9XG5cbiAgcmV0dXJuIHsgcmVzdWx0OiAnam9iJywgam9iSWQ6IGpvYi5pZCB9O1xufVxuXG4vKipcbiAqIFN0YXJ0IGFub3RoZXIgcnVubmVyIGp1c3QgbGlrZSB0aGUgb25lIHRoYXQgd2FzIHN0b2xlbi5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVwbGFjZVJ1bm5lcihzdG9sZW5SdW5uZXJOYW1lOiBzdHJpbmcsIGlucHV0OiBPcmNoZXN0cmF0b3JJbnB1dCwgdGhpZWZKb2JJZD86IG51bWJlcikge1xuICBjb25zdCBbcnVubmVyTmFtZSwgYXR0ZW1wdF0gPSByZXBsYWNlbWVudFJ1bm5lck5hbWUoc3RvbGVuUnVubmVyTmFtZSk7XG4gIGlmIChhdHRlbXB0ID4gTUFYX1JFUExBQ0VNRU5UUykge1xuICAgIC8vIGF2b2lkIGluZmluaXRlIGxvb3BzIGlmIGEgcnVubmVyIGlzIHN0b2xlbiByZXBlYXRlZGx5XG4gICAgLy8gaXQgbWlnaHQgYmUgYSBidWcgaW4gb3VyIGRldGVjdGlvbi4uLlxuICAgIGNvbnNvbGUud2Fybih7XG4gICAgICBub3RpY2U6ICdSdW5uZXIgd2FzIHN0b2xlbiwgbm90IHJlcGxhY2VkIGJlY2F1c2UgaXQgaGFzIGFscmVhZHkgYmVlbiByZXBsYWNlZCB0b28gbWFueSB0aW1lcycsXG4gICAgICBtZXRyaWM6ICdTdG9sZW5SdW5uZXJEZXRlY3RlZCcsXG4gICAgICByZXBsYWNlZDogJ2ZhbHNlJywgLy8gbWV0cmljIGZpbHRlciBkcm9wcyBBTEwgZGltZW5zaW9ucyBmb3IgaWYgdGhpcyBpcyBhIHJlYWwgYm9vbGVhblxuICAgICAgc3RvbGVuUnVubmVyTmFtZSxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBhdHRlbXB0LFxuICAgICAgc3RvbGVuQnlKb2JJZDogdGhpZWZKb2JJZCxcbiAgICAgIGpvYklkOiBpbnB1dC5qb2JJZCxcbiAgICAgIGpvYlVybDogaW5wdXQuam9iVXJsLFxuICAgICAgb3duZXI6IGlucHV0Lm93bmVyLFxuICAgICAgcmVwbzogaW5wdXQucmVwbyxcbiAgICAgIHByb3ZpZGVyOiBpbnB1dC5wcm92aWRlcixcbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICB0cnkge1xuICAgIGF3YWl0IHNmbi5zZW5kKG5ldyBTdGFydEV4ZWN1dGlvbkNvbW1hbmQoe1xuICAgICAgc3RhdGVNYWNoaW5lQXJuOiBwcm9jZXNzLmVudi5TVEVQX0ZVTkNUSU9OX0FSTixcbiAgICAgIG5hbWU6IHJ1bm5lck5hbWUsXG4gICAgICBpbnB1dDogSlNPTi5zdHJpbmdpZnkoaW5wdXQpLFxuICAgIH0pKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChlIGluc3RhbmNlb2YgRXhlY3V0aW9uQWxyZWFkeUV4aXN0cykge1xuICAgICAgLy8gd2UgYWxyZWFkeSBoZWFyZCBhYm91dCB0aGlzIHRoZWZ0XG4gICAgICBjb25zb2xlLmxvZyh7IG5vdGljZTogJ1JlcGxhY2VtZW50IHJ1bm5lciBhbHJlYWR5IHN0YXJ0ZWQnLCBzdG9sZW5SdW5uZXJOYW1lLCBydW5uZXJOYW1lIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aHJvdyBlO1xuICB9XG5cbiAgY29uc29sZS53YXJuKHtcbiAgICBub3RpY2U6ICdSdW5uZXIgd2FzIHN0b2xlbiwgc3RhcnRlZCBhbm90aGVyIG9uZScsXG4gICAgbWV0cmljOiAnU3RvbGVuUnVubmVyRGV0ZWN0ZWQnLFxuICAgIHJlcGxhY2VkOiAndHJ1ZScsIC8vIG1ldHJpYyBmaWx0ZXIgZHJvcHMgQUxMIGRpbWVuc2lvbnMgZm9yIGlmIHRoaXMgaXMgYSByZWFsIGJvb2xlYW5cbiAgICBzdG9sZW5SdW5uZXJOYW1lLFxuICAgIHJ1bm5lck5hbWUsXG4gICAgYXR0ZW1wdCxcbiAgICBzdG9sZW5CeUpvYklkOiB0aGllZkpvYklkLFxuICAgIGpvYklkOiBpbnB1dC5qb2JJZCxcbiAgICBqb2JVcmw6IGlucHV0LmpvYlVybCxcbiAgICBvd25lcjogaW5wdXQub3duZXIsXG4gICAgcmVwbzogaW5wdXQucmVwbyxcbiAgICBwcm92aWRlcjogaW5wdXQucHJvdmlkZXIsXG4gIH0pO1xufVxuXG4vKipcbiAqIENoZWNrIGlmIHJ1bm5lciB3YXMgc3RvbGVuIGFuZCBwb3NzaWJseSByZXBsYWNlIGl0LlxuICovXG5hc3luYyBmdW5jdGlvbiBoYW5kbGVSdW5uZXJSZXBvcnQocmVwb3J0OiBSdW5uZXJSZXBvcnRNZXNzYWdlKSB7XG4gIGNvbnN0IGlucHV0ID0gYXdhaXQgZmluZFJ1bm5lcklucHV0KHJlcG9ydC5ydW5uZXJOYW1lKTtcbiAgaWYgKCFpbnB1dCkge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIC8vIHRoZSBydW5uZXIgZ290IGEgam9iLCBzbyB0aGUgaWRsZSByZWFwZXIgZG9lc24ndCBuZWVkIHRvIGxvb2sgZm9yIGEgam9iIGl0IGxlZnQgd2l0aG91dCBhIHJ1bm5lciBvbmNlIGl0J3MgZ29uZVxuICBhd2FpdCByZWNvcmRSdW5uZXJBY2NvdW50ZWQocmVwb3J0LnJ1bm5lck5hbWUsIHJlcG9ydC5qb2JJZCk7XG5cbiAgaWYgKGlucHV0LmpvYklkID09IFdBUk1fUlVOTkVSX0pPQl9JRCkge1xuICAgIC8vIHdhcm0gcnVubmVycyBhcmVuJ3Qgc3RhcnRlZCBmb3IgYW55IGpvYiBpbiBwYXJ0aWN1bGFyLCBzbyBub3RoaW5nIHRoZXkgcnVuIGlzIHRlY2huaWNhbGx5IHN0b2xlblxuICAgIC8vIHdhcm0gcnVubmVyIGtlZXBlciBzdGFydHMgYSByZXBsYWNlbWVudCBvbiBpdHMgb3duIGFzIHNvb24gYXMgaXQgc2VlcyBhIHdhcm0gcnVubmVyIGdvIGJ1c3lcbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdXYXJtIHJ1bm5lciB0YWtlbicsXG4gICAgICBtZXRyaWM6ICdXYXJtUnVubmVyVGFrZW4nLFxuICAgICAgcnVubmVyTmFtZTogcmVwb3J0LnJ1bm5lck5hbWUsXG4gICAgICByZXBvOiByZXBvcnQucmVwbyxcbiAgICAgIHJ1bklkOiByZXBvcnQud29ya2Zsb3dJZCxcbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgam9iSWQgPSByZXBvcnQuam9iSWQ7IC8vIGNhbiBiZSByZXBvcnRlZCBmcm9tIHdvcmtmbG93X2pvYi5pbl9wcm9ncmVzcyBkaXJlY3RseVxuICBpZiAoam9iSWQgPT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IGpvYiA9IGF3YWl0IGZpbmRKb2JGcm9tUmVwb3J0KHJlcG9ydCk7XG5cbiAgICBpZiAoam9iLnJlc3VsdCA9PT0gJ2ludmlzaWJsZS1yZXBvJykge1xuICAgICAgLy8gbm90aGluZyB3ZSBzdGFydCBjb3VsZCBiZSBydW5uaW5nIHRoZXJlLCBzbyB0aGlzIG9uZSB3YXMgc3RvbGVuXG4gICAgICBjb25zb2xlLndhcm4oe1xuICAgICAgICBub3RpY2U6ICdSdW5uZXIgcmFuIGEgam9iIGluIGEgcmVwb3NpdG9yeSBvdXIgYXBwIGNhbm5vdCBzZWUnLFxuICAgICAgICByZXBvcnQsXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHJlcGxhY2VSdW5uZXIocmVwb3J0LnJ1bm5lck5hbWUsIGlucHV0KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoam9iLnJlc3VsdCA9PT0gJ3Vua25vd24nKSB7XG4gICAgICAvLyB3ZSBjb3VsZG4ndCBmaW5kIHRoZSBqb2IsIGV2ZW4gdGhvdWdoIHdlIHNob3VsZCBoYXZlXG4gICAgICAvLyBiYWQgaW5wdXQuLi4gZG9uJ3QgYWN0IG9uIGl0XG4gICAgICBjb25zb2xlLndhcm4oe1xuICAgICAgICBub3RpY2U6ICdDb3VsZCBub3QgdGVsbCB3aGljaCBqb2IgdGhpcyBydW5uZXIgcmFuJyxcbiAgICAgICAgcmVwb3J0LFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgam9iSWQgPSBqb2Iuam9iSWQ7XG4gIH1cblxuICBpZiAoam9iSWQgPT09IGlucHV0LmpvYklkKSB7XG4gICAgLy8gcmFuIHRoZSBqb2IgaXQgd2FzIHN0YXJ0ZWQgZm9yLCB3aGljaCBpcyB0aGUgd2hvbGUgcG9pbnRcbiAgICAvLyBubyBuZWVkIHRvIGRvIGFueXRoaW5nIG9yIGV2ZW4gY2hlY2sgdGhlIGpvYnMgdGFibGUuLi5cbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBvdGhlclJ1bm5lckxhYmVscyA9IGF3YWl0IGNvbnRyb2xsZWRKb2JSdW5uZXJMYWJlbHMoam9iSWQpO1xuICBpZiAob3RoZXJSdW5uZXJMYWJlbHMpIHtcbiAgICBpZiAobGFiZWxzTWF0Y2goaW5wdXQuam9iTGFiZWxzLnNwbGl0KCcsJyksIG90aGVyUnVubmVyTGFiZWxzKSkge1xuICAgICAgLy8gR2l0SHViIHNodWZmbGVkIGpvYnMgYmV0d2VlbiBydW5uZXJzIHdlIHN0YXJ0ZWRcbiAgICAgIC8vIHRoZSBydW5uZXIgd2Ugc3RhcnRlZCBmb3IgdGhhdCBqb2IgY2FuIHJ1biB0aGlzIHJ1bm5lcidzIGpvYiBpbnN0ZWFkLCBzbyBubyBqb2IgaXMgbGVmdCBoYW5naW5nXG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1J1bm5lciByYW4gYW5vdGhlciBqb2Igb2Ygb3VycycsXG4gICAgICAgIHJ1bm5lck5hbWU6IHJlcG9ydC5ydW5uZXJOYW1lLFxuICAgICAgICBqb2JJZCxcbiAgICAgICAgZXhwZWN0ZWRKb2JJZDogaW5wdXQuam9iSWQsXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyB0aGUgcnVubmVyIHdlIHN0YXJ0ZWQgZm9yIHRoYXQgam9iIGNhbid0IHJ1biB0aGlzIHJ1bm5lcidzIGpvYiAoZS5nLiBhIFtzZWxmLWhvc3RlZCwgbGFtYmRhXSBqb2IgdG9vayBhIHJ1bm5lciBzdGFydGVkIGZvclxuICAgIC8vIFtzZWxmLWhvc3RlZCwgbGFtYmRhLCBhcm02NF0gd2hpbGUgaXRzIG93biBydW5uZXIgaXMgeDY0KS4gdGhpcyBydW5uZXIncyBqb2IgaXMgbGVmdCB3aXRob3V0IGEgcnVubmVyLCBzbyB0cmVhdCBpdCBhcyBzdG9sZW4uXG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnUnVubmVyIHJhbiBhbm90aGVyIGpvYiBvZiBvdXJzLCBidXQgdGhhdCBqb2JcXCdzIHJ1bm5lciBjYW5cXCd0IHJ1biB0aGlzIG9uZVxcJ3MnLFxuICAgICAgcnVubmVyTmFtZTogcmVwb3J0LnJ1bm5lck5hbWUsXG4gICAgICBqb2JJZCxcbiAgICAgIGV4cGVjdGVkSm9iSWQ6IGlucHV0LmpvYklkLFxuICAgICAgb3RoZXJSdW5uZXJMYWJlbHMsXG4gICAgICBleHBlY3RlZEpvYkxhYmVsczogaW5wdXQuam9iTGFiZWxzLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gcnVubmVyIHJhbiBhIGpvYiB3ZSBuZXZlciBzdGFydGVkIGEgcnVubmVyIGZvciwgb3Igb25lIHdob3NlIHJ1bm5lciBjYW4ndCB0YWtlIG92ZXJcbiAgLy8gcnVubmVyIHdhcyBzdG9sZW4sIHN0YXJ0IGFub3RoZXIgb25lIGp1c3QgbGlrZSBpdFxuICBhd2FpdCByZXBsYWNlUnVubmVyKHJlcG9ydC5ydW5uZXJOYW1lLCBpbnB1dCwgam9iSWQpO1xufVxuXG4vKipcbiAqIFNlbmQgbG9nIG1lc3NhZ2VzIHRvIFNRUyBzbyB3ZSBjYW4gZGVsYXkgYW5kIGJhdGNoIHRoZW0uIFRoaXMgaGVscHMgbWFrZSBzdXJlIHdlIHByb2Nlc3MgdGhlbSAqYWZ0ZXIqIHRoZSB3ZWJob29rIGFycml2ZXMgYW5kIHdyaXRlcyB0byBEREIuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGhhbmRsZVJ1bm5lckxvZ3MoZXZlbnQ6IEFXU0xhbWJkYS5DbG91ZFdhdGNoTG9nc0V2ZW50KSB7XG4gIGNvbnN0IHF1ZXVlVXJsID0gcHJvY2Vzcy5lbnYuSk9CX0FTU0lHTk1FTlRfUVVFVUVfVVJMO1xuICBpZiAoIXF1ZXVlVXJsKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdNaXNzaW5nIEpPQl9BU1NJR05NRU5UX1FVRVVFX1VSTCBlbnZpcm9ubWVudCB2YXJpYWJsZScpO1xuICB9XG5cbiAgY29uc3QgcGF5bG9hZCA9IEpTT04ucGFyc2UoemxpYi5ndW56aXBTeW5jKEJ1ZmZlci5mcm9tKGV2ZW50LmF3c2xvZ3MuZGF0YSwgJ2Jhc2U2NCcpKS50b1N0cmluZygndXRmOCcpKSBhcyBBV1NMYW1iZGEuQ2xvdWRXYXRjaExvZ3NEZWNvZGVkRGF0YTtcblxuICBjb25zdCBtZXNzYWdlczogUnVubmVyUmVwb3J0TWVzc2FnZVtdID0gW107XG4gIGNvbnN0IHJlcG9ydGVkUnVubmVyc0luVGhpc0RlbGl2ZXJ5ID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgbG9nRXZlbnQgb2YgcGF5bG9hZC5sb2dFdmVudHMpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gcGFyc2VSdW5uZXJSZXBvcnQobG9nRXZlbnQubWVzc2FnZSk7XG4gICAgaWYgKG1lc3NhZ2UpIHtcbiAgICAgIC8vIGRvbid0IGxldCBtaXNjb25maWd1cmVkL21hbGljaW91cyBqb2JzIG1ha2UgdXMgc3RhcnQgb3IgZXZlbiBxdWVyeSB0b28gbWFueSBydW5uZXJzLlxuICAgICAgLy8gdGhlcmUgc2hvdWxkIG9ubHkgZXZlciBiZSBvbmUgcmVwb3J0IHBlciBydW5uZXIgYW5kIGFueSBtYWxpY2lvdXMgY29kZSBzaG91bGRuJ3QgYmUgYWJsZSB0byBndWVzcyBvdXIgcnVubmVyIG5hbWVzLlxuICAgICAgLy8gcnVubmVyIG5hbWVzIGFyZSBiYXNlZCBvbiBnaXRodWIgd2ViaG9vayBleGVjdXRpb24gaWRzLCB3aGljaCBhcmUgcmFuZG9tIHV1aWRzLlxuICAgICAgaWYgKHJlcG9ydGVkUnVubmVyc0luVGhpc0RlbGl2ZXJ5LmhhcyhtZXNzYWdlLnJ1bm5lck5hbWUpKSB7XG4gICAgICAgIGNvbnNvbGUud2Fybih7IG5vdGljZTogJ0FscmVhZHkgaGFuZGxlZCBhIHJlcG9ydCBmcm9tIHRoaXMgcnVubmVyJywgcnVubmVyTmFtZTogbWVzc2FnZS5ydW5uZXJOYW1lIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHJlcG9ydGVkUnVubmVyc0luVGhpc0RlbGl2ZXJ5LmFkZChtZXNzYWdlLnJ1bm5lck5hbWUpO1xuICAgICAgLy8gcHV0IG9uIHF1ZXVlIHNvIHdlYmhvb2sgaGFzIHRpbWUgdG8gYXJyaXZlIGFuZCB3cml0ZSB0byBEREIgYmVmb3JlIHdlIHRyeSB0byByZWFkIGl0XG4gICAgICBtZXNzYWdlcy5wdXNoKG1lc3NhZ2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zb2xlLndhcm4oe1xuICAgICAgICBub3RpY2U6ICdVbnBhcnNhYmxlIHJ1bm5lciByZXBvcnQnLFxuICAgICAgICBsb2dHcm91cDogcGF5bG9hZC5sb2dHcm91cCxcbiAgICAgICAgbG9nU3RyZWFtOiBwYXlsb2FkLmxvZ1N0cmVhbSxcbiAgICAgICAgbWVzc2FnZTogbG9nRXZlbnQubWVzc2FnZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIGJhdGNoZXMgb2YgdGVuLCB3aGljaCBpcyBib3RoIHRoZSBTUVMgbGltaXQgYW5kIG1vcmUgcmVwb3J0cyB0aGFuIG9uZSBsb2cgZGVsaXZlcnkgc2hvdWxkIGV2ZXIgY2FycnlcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBtZXNzYWdlcy5sZW5ndGg7IGkgKz0gMTApIHtcbiAgICBjb25zdCBiYXRjaCA9IG1lc3NhZ2VzLnNsaWNlKGksIGkgKyAxMCk7XG4gICAgYXdhaXQgc3FzLnNlbmQobmV3IFNlbmRNZXNzYWdlQmF0Y2hDb21tYW5kKHtcbiAgICAgIFF1ZXVlVXJsOiBxdWV1ZVVybCxcbiAgICAgIEVudHJpZXM6IGJhdGNoLm1hcCgobWVzc2FnZSwgaW5kZXgpID0+ICh7XG4gICAgICAgIElkOiBgJHtpICsgaW5kZXh9YCxcbiAgICAgICAgTWVzc2FnZUJvZHk6IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpLFxuICAgICAgICAvLyBvbmUgcmVwb3J0IHBlciBydW5uZXIuIHRoZSB3ZWJob29rIHNlbmRzIHRoZSBzYW1lIHBhaXIsIHNvIHdoaWNoZXZlciBhcnJpdmVzIGZpcnN0IHdpbnMgYW5kIHRoZSBvdGhlciBpc1xuICAgICAgICAvLyBkcm9wcGVkIGJ5IHRoZSBxdWV1ZS4gYSBncm91cCBwZXIgcnVubmVyIG1lYW5zIHJ1bm5lcnMgbmV2ZXIgcXVldWUgYmVoaW5kIGVhY2ggb3RoZXIuXG4gICAgICAgIE1lc3NhZ2VHcm91cElkOiBtZXNzYWdlLnJ1bm5lck5hbWUsXG4gICAgICAgIE1lc3NhZ2VEZWR1cGxpY2F0aW9uSWQ6IG1lc3NhZ2UucnVubmVyTmFtZSxcbiAgICAgIH0pKSxcbiAgICB9KSk7XG4gIH1cblxuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnUXVldWVkIHJ1bm5lciByZXBvcnRzJyxcbiAgICBsb2dHcm91cDogcGF5bG9hZC5sb2dHcm91cCxcbiAgICBjb3VudDogbWVzc2FnZXMubGVuZ3RoLFxuICB9KTtcbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUnVubmVyUmVwb3J0KGxpbmU6IHN0cmluZyk6IFJ1bm5lclJlcG9ydE1lc3NhZ2UgfCB1bmRlZmluZWQge1xuICAvLyB0aGlzIGRhdGEgY2FuJ3QgYmUgZnVsbHkgdHJ1c3RlZCBhcyB0aGUgam9icyB0aGVtc2VsdmVzIGNhbiBydW4gdW50cnVzdGVkIGNvZGUuLi4gYnV0OlxuICAvLyAgIDEuIHRoZSB1bnRydXN0ZWQgY29kZSBoYXMgYWNjZXNzIHRvIGp1c3Qgb25lIHJ1bm5lciBuYW1lXG4gIC8vICAgMi4gd2Ugb25seSBldmVyIGFjdCBvbiB0aGUgZmlyc3QgcmVwb3J0IGZvciBhIHJ1bm5lciAodGhlIHF1ZXVlIGRlZHVwbGljYXRlcyBvbiB0aGUgcnVubmVyIG5hbWUpXG4gIC8vICAgMy4gdGhlIG5ldyBydW5uZXIgd2Ugc3RhcnQgd2lsbCBoYXZlIGEgc3BlY2lmaWMgbmFtZSBhbmQgc3RlcCBmdW5jdGlvbnMgd2lsbCByZWplY3QgZHVwbGljYXRlIG5hbWVzIChpZGVtcG90ZW50KVxuICAvLyBzbyBtYWxpY2lvdXMgY29kZSBzaG91bGRuJ3QgYmUgYWJsZSB0byB0cmljayB1cyBpbnRvIHN0YXJ0aW5nIHRvbyBtYW55IHJ1bm5lcnMsIG9yIGludG8gbWFraW5nIHVzIGNhbGwgR2l0SHViXG4gIC8vIG92ZXIgYW5kIG92ZXIgdW50aWwgd2UgcnVuIG91dCBvZiByYXRlIGxpbWl0IGZvciBzdGFydGluZyBydW5uZXJzXG4gIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvQ0RLR0hSIEpPQiBSVU5ORVI9KFxcUyspIFJFUE89KFxcUyspIFdPUktGTE9XX0lEPShcXGQrKS8pO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHJldHVybiB7XG4gICAga2luZDogJ3JlcG9ydCcsXG4gICAgcnVubmVyTmFtZTogbWF0Y2hbMV0sXG4gICAgcmVwbzogbWF0Y2hbMl0sXG4gICAgd29ya2Zsb3dJZDogcGFyc2VJbnQobWF0Y2hbM10sIDEwKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gaXNDbG91ZFdhdGNoTG9nc0V2ZW50KGV2ZW50OiB1bmtub3duKTogZXZlbnQgaXMgQVdTTGFtYmRhLkNsb3VkV2F0Y2hMb2dzRXZlbnQge1xuICByZXR1cm4gdHlwZW9mIChldmVudCBhcyBBV1NMYW1iZGEuQ2xvdWRXYXRjaExvZ3NFdmVudCk/LmF3c2xvZ3M/LmRhdGEgPT09ICdzdHJpbmcnO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogQVdTTGFtYmRhLlNRU0V2ZW50IHwgQVdTTGFtYmRhLkNsb3VkV2F0Y2hMb2dzRXZlbnQpOiBQcm9taXNlPEFXU0xhbWJkYS5TUVNCYXRjaFJlc3BvbnNlIHwgdm9pZD4ge1xuICBpZiAoaXNDbG91ZFdhdGNoTG9nc0V2ZW50KGV2ZW50KSkge1xuICAgIC8vIGxldCB0aGlzIHRocm93LiBDbG91ZFdhdGNoIExvZ3MgcmV0cmllcyB0aGUgZGVsaXZlcnksIGFuZCBhIGxvc3QgcmVwb3J0IGlzIGEgbWlzc2VkIHN0b2xlbiBydW5uZXIuXG4gICAgcmV0dXJuIGhhbmRsZVJ1bm5lckxvZ3MoZXZlbnQpO1xuICB9XG5cbiAgY29uc3QgcmVzdWx0OiBBV1NMYW1iZGEuU1FTQmF0Y2hSZXNwb25zZSA9IHsgYmF0Y2hJdGVtRmFpbHVyZXM6IFtdIH07XG5cbiAgZm9yIChjb25zdCByZWNvcmQgb2YgZXZlbnQuUmVjb3Jkcykge1xuICAgIGxldCByZXBvcnQ6IFJ1bm5lclJlcG9ydE1lc3NhZ2U7XG4gICAgdHJ5IHtcbiAgICAgIHJlcG9ydCA9IEpTT04ucGFyc2UocmVjb3JkLmJvZHkpIGFzIFJ1bm5lclJlcG9ydE1lc3NhZ2U7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcih7XG4gICAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBwYXJzZSBtZXNzYWdlIGJvZHknLFxuICAgICAgICBtZXNzYWdlSWQ6IHJlY29yZC5tZXNzYWdlSWQsXG4gICAgICAgIGVycm9yOiBgJHtlfWAsXG4gICAgICB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBoYW5kbGVSdW5uZXJSZXBvcnQocmVwb3J0KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIHByb2Nlc3MgcnVubmVyIHJlcG9ydCcsXG4gICAgICAgIG1lc3NhZ2VJZDogcmVjb3JkLm1lc3NhZ2VJZCxcbiAgICAgICAgcmVwb3J0LFxuICAgICAgICBlcnJvcjogYCR7ZX1gLFxuICAgICAgfSk7XG4gICAgICByZXN1bHQuYmF0Y2hJdGVtRmFpbHVyZXMucHVzaCh7IGl0ZW1JZGVudGlmaWVyOiByZWNvcmQubWVzc2FnZUlkIH0pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59XG4iXX0=