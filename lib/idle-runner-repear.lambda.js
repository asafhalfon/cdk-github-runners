"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_sfn_1 = require("@aws-sdk/client-sfn");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const lambda_common_1 = require("./lambda-common");
const lambda_ec2_1 = require("./lambda-ec2");
const lambda_github_1 = require("./lambda-github");
const lambda_tracker_1 = require("./lambda-tracker");
const sfn = new client_sfn_1.SFNClient();
const sqs = new client_sqs_1.SQSClient();
/**
 * How many runners we follow before giving up on finding the job left without a runner. Every hop is a handful of API calls, so a full
 * batch of runners walking this far still finishes well within the timeout.
 */
const MAX_HOPS = 10;
/**
 * Input of the step function that started a runner, or undefined if the runner isn't ours.
 */
async function runnerInput(executionArn) {
    try {
        const execution = await sfn.send(new client_sfn_1.DescribeExecutionCommand({ executionArn }));
        return execution.input ? JSON.parse(execution.input) : undefined;
    }
    catch (e) {
        if (e instanceof client_sfn_1.ExecutionDoesNotExist || e instanceof client_sfn_1.InvalidArn) {
            // somebody else's runner
            return undefined;
        }
        throw e;
    }
}
/**
 * Find the job left without a runner now that we're reaping this one.
 *
 * That's usually the job this runner was started for. But GitHub may have handed that job to another runner of ours, which leaves the job that
 * runner was started for waiting instead. That job may have been handed to yet another runner of ours, and so on. We follow the chain until we
 * find a job still waiting for a runner.
 *
 * Returns undefined when no job was left without a runner, or when we can't tell.
 */
async function findAbandonedJob(octokitCache, executionArn, input) {
    const seen = new Set();
    let current = input;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
        const { owner, repo, jobId, installationId } = (current ?? {});
        if (typeof owner != 'string' || typeof repo != 'string' || typeof jobId != 'number') {
            // step function started by hand with input we don't understand
            console.log({ notice: 'Runner has no job we understand', input: current });
            return undefined;
        }
        if (jobId == lambda_common_1.WARM_RUNNER_JOB_ID) {
            // warm runners aren't started for any job, so no job is waiting on them
            return undefined;
        }
        if (seen.has(jobId)) {
            // the jobs got shuffled between our runners and we came back around. they all ran, so nothing was abandoned
            return undefined;
        }
        seen.add(jobId);
        let job;
        try {
            const { octokit } = await octokitCache(installationId);
            job = (await octokit.rest.actions.getJobForWorkflowRun({ owner, repo, job_id: jobId })).data;
        }
        catch (e) {
            if (!(0, lambda_github_1.isNotFound)(e)) {
                throw e;
            }
            // step function started by hand with a job that doesn't exist
            console.log({ notice: 'GitHub knows nothing about this job', owner, repo, jobId });
            return undefined;
        }
        if (!job.runner_name) {
            // never assigned. still waiting means it's the one left without a runner. completed means it was cancelled before any runner got it.
            return job.status == 'completed' ? undefined : jobId;
        }
        // the job got a runner. if that runner is ours, the job it was started for is the one left waiting now. runner names are execution names.
        current = await runnerInput(executionArn.replace(/[^:]+$/, job.runner_name));
        if (current === undefined) {
            // not our runner, so none of our jobs is waiting on it
            return undefined;
        }
        if (current.jobId == jobId) {
            // it ran on a runner started for it (e.g. a duplicate execution or a replacement), so nothing is waiting
            return undefined;
        }
    }
    console.log({ notice: 'Gave up looking for the job left without a runner', executionArn, hops: MAX_HOPS });
    return undefined;
}
/**
 * This runner is gone. If it never reported a job, forget the job left without a runner because of it.
 *
 * That job may be stuck on GitHub's side (e.g. outage) and get handed to another runner of ours later on. Forgetting it means that runner is
 * detected as stolen and replaced, instead of looking like a fair shuffle. If the job ends up with another runner of ours anyway, we may get a
 * false positive and start one runner too many. That runner will just idle until it's reaped too, which is better than leaving a job with no
 * runner at all.
 *
 * Returns false if we should try again later.
 */
async function runnerGone(octokitCache, input, executionInput) {
    if (executionInput === undefined) {
        console.warn({
            notice: 'Bad execution input',
            input,
        });
        return true;
    }
    try {
        if (await (0, lambda_tracker_1.isRunnerAccounted)(input.runnerName)) {
            // it reported a job, or we already got here before
            return true;
        }
        // no report doesn't prove it ran nothing (e.g. a quick job that ended before its report was handled), but the walk asks GitHub anyway
        const jobId = await findAbandonedJob(octokitCache, input.executionArn, JSON.parse(executionInput));
        if (jobId !== undefined) {
            console.log({
                notice: 'Forgetting job left without a runner',
                jobId,
                runnerName: input.runnerName,
                input,
            });
            await (0, lambda_tracker_1.forgetControlledJob)(jobId);
        }
        // mark the runner as accounted for so we don't try to forget its job again later
        // there are a few paths that lead to this function, and we don't want to do this whole process twice...
        await (0, lambda_tracker_1.recordRunnerAccounted)(input.runnerName);
        return true;
    }
    catch (e) {
        console.error({
            notice: 'Failed to forget job',
            runnerName: input.runnerName,
            error: e,
            input,
        });
        return false;
    }
}
async function handler(event) {
    const result = { batchItemFailures: [] };
    const getOctokitCached = (0, lambda_github_1.cachedGetOctokit)();
    for (const record of event.Records) {
        const input = JSON.parse(record.body);
        console.log({
            notice: 'Checking runner',
            runnerName: input.runnerName,
            input,
        });
        const retryLater = () => result.batchItemFailures.push({ itemIdentifier: record.messageId });
        // check if step function is still running
        const execution = await sfn.send(new client_sfn_1.DescribeExecutionCommand({ executionArn: input.executionArn }));
        if (execution.status == 'SUCCEEDED') {
            // no need to test again as runner already finished and removed itself
            console.log({
                notice: 'Runner already finished',
                runnerName: input.runnerName,
                input,
            });
            // the runner reported success, so any instance still running for it has outlived its job. that can happen when `poweroff` doesn't work for any
            // reason. generally in rare cases, but we don't want to leave expensive instances behind.
            await (0, lambda_ec2_1.terminateRunnerInstances)(input.runnerName);
            // success doesn't mean it ran a job (e.g. somebody deleted the runner while it was idle)
            if (!await runnerGone(getOctokitCached, input, execution.input)) {
                retryLater();
            }
            continue;
        }
        // a step function that ended any other way may not have cleaned up after itself. that happens when it's stopped
        // from the outside, or when Step Functions kills it for reaching its 25,000 event history limit. its runner can
        // still be registered and can still pick up a job, so we keep watching it like any other runner and let the idle
        // timeout decide. we just have no step function left to stop when that time comes.
        const executionStopped = execution.status != 'RUNNING';
        // get github access
        const { octokit, githubSecrets: secrets } = await getOctokitCached(input.installationId);
        // find runner
        const runner = await (0, lambda_github_1.getRunner)(octokit, secrets.runnerLevel, input.owner, input.repo, input.runnerName);
        if (!runner) {
            if (executionStopped) {
                console.log({
                    notice: 'Stopped step function has no runner to clean up',
                    runnerName: input.runnerName,
                    input,
                });
                // no runner on GitHub, terminate any instance that didn't properly power-off due to some extreme failure (e.g. IMDS failure, OOM killer,
                // wedged poweroff, etc.). the step function is stopped, so it won't be able to clean up after itself.
                await (0, lambda_ec2_1.terminateRunnerInstances)(input.runnerName);
                // the step function may have failed before its runner ever registered, so its job may still be waiting for one
                if (!await runnerGone(getOctokitCached, input, execution.input)) {
                    retryLater();
                }
                continue;
            }
            console.log({
                notice: 'Runner not running yet',
                runnerName: input.runnerName,
                input,
            });
            retryLater();
            continue;
        }
        // if not idle, try again later
        // we want to try again because the runner might be retried due to e.g. lambda timeout
        // we need to keep following the retry too and make sure it doesn't go idle
        if (runner.busy) {
            if (executionStopped) {
                // it took a job, so it will remove itself once it's done, like every other ephemeral runner
                console.log({
                    notice: 'Stopped step function left a busy runner behind',
                    runnerId: runner.id,
                    runnerName: input.runnerName,
                    input,
                });
                retryLater(); // we still want the opportunity to clean up the instance if the runner doesn't remove itself for some reason, so we retry later
                continue;
            }
            console.log({
                notice: 'Runner is not idle',
                runnerId: runner.id,
                runnerName: input.runnerName,
                input,
            });
            retryLater();
            continue;
        }
        // JIT runners are registered before they boot, so an offline runner is usually one that is still starting. some providers can take more than
        // ten minutes to get there. once the step function is gone, nothing is going to start it, so we treat it as idle and let the timeout decide.
        if (runner.status !== 'online' && !executionStopped) {
            console.log({
                notice: 'Runner not online yet',
                runnerId: runner.id,
                runnerName: input.runnerName,
                input,
            });
            retryLater();
            continue;
        }
        // the first time we see the runner idle, we start the clock with a new message that remembers which runner we saw. a retried runner
        // registers again with a new id, so it starts the clock over.
        if (input.runnerId !== runner.id || input.idleSince === undefined) {
            console.log({
                notice: 'Runner is idle',
                runnerId: runner.id,
                runnerName: input.runnerName,
                input,
            });
            try {
                await sqs.send(new client_sqs_1.SendMessageCommand({
                    QueueUrl: process.env.IDLE_REAPER_QUEUE_URL,
                    MessageBody: JSON.stringify({ ...input, runnerId: runner.id, idleSince: Date.now() }),
                }));
            }
            catch (e) {
                console.error({
                    notice: 'Failed to enqueue idle check',
                    runnerId: runner.id,
                    runnerName: input.runnerName,
                    error: e,
                    input,
                });
                retryLater();
            }
            continue;
        }
        // check if max idle timeout has reached
        const idleMs = Date.now() - input.idleSince;
        console.log({
            notice: 'Runner is still idle',
            runnerId: runner.id,
            runnerName: input.runnerName,
            idleSeconds: idleMs / 1000,
            input,
        });
        if (idleMs < 1000 * input.maxIdleSeconds) {
            // still idle, timeout not reached - retry later
            retryLater();
            continue;
        }
        // max idle time reached, delete runner
        console.log({
            notice: 'Runner is idle for too long',
            runnerId: runner.id,
            runnerName: input.runnerName,
            idleSeconds: idleMs / 1000,
            maxIdleSeconds: input.maxIdleSeconds,
            input,
        });
        // nothing to stop when it already stopped on its own
        if (!executionStopped) {
            try {
                // stop step function first, so it's marked as aborted with the proper error
                // if we delete the runner first, the step function will be marked as failed with a generic error
                console.log({
                    notice: 'Stopping step function',
                    executionArn: input.executionArn,
                    runnerId: runner.id,
                    runnerName: input.runnerName,
                    input,
                });
                await sfn.send(new client_sfn_1.StopExecutionCommand({
                    executionArn: input.executionArn,
                    error: 'IdleRunner',
                    cause: `Runner ${input.runnerName} on ${input.owner}/${input.repo} is idle for too long (${idleMs / 1000} seconds and limit is ${input.maxIdleSeconds} seconds)`,
                }));
                console.log({
                    notice: 'Stopped step function',
                    metric: 'RunnerStopped',
                    reason: 'IdleRunner',
                    executionArn: input.executionArn,
                    runnerName: input.runnerName,
                    owner: input.owner,
                    repo: input.repo,
                });
            }
            catch (e) {
                console.error({
                    notice: 'Failed to stop step function',
                    executionArn: input.executionArn,
                    runnerId: runner.id,
                    runnerName: input.runnerName,
                    error: e,
                    input,
                });
                retryLater();
                continue;
            }
        }
        try {
            console.log({
                notice: 'Deleting runner',
                runnerId: runner.id,
                runnerName: input.runnerName,
                input,
            });
            await (0, lambda_github_1.deleteRunner)(octokit, secrets.runnerLevel, input.owner, input.repo, runner.id);
        }
        catch (e) {
            console.error({
                notice: 'Failed to delete runner',
                runnerId: runner.id,
                runnerName: input.runnerName,
                error: e,
                input,
            });
            retryLater();
            continue;
        }
        // GitHub only lets us delete an idle runner, so this one never got a job. account for it now so its job is forgotten right away and not on
        // the next delivery about 10 minutes from now. The message is retried below either way, so if this fails, the "no runner" branch above
        // tries again.
        await runnerGone(getOctokitCached, input, execution.input);
        // the runner is deleted but the instance is still alive and about to notice. do not terminate. give it a delivery cycle to log why it's
        // stopping and power itself off. if it's still here next time, the !runner branch above terminates it
        retryLater();
    }
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaWRsZS1ydW5uZXItcmVwZWFyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9pZGxlLXJ1bm5lci1yZXBlYXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBbUtBLDBCQXlPQztBQTVZRCxvREFBbUk7QUFDbkksb0RBQW9FO0FBRXBFLG1EQUF3RTtBQUN4RSw2Q0FBd0Q7QUFDeEQsbURBQW9HO0FBQ3BHLHFEQUFpRztBQWdCakcsTUFBTSxHQUFHLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFDNUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFFNUI7OztHQUdHO0FBQ0gsTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFDO0FBRXBCOztHQUVHO0FBQ0gsS0FBSyxVQUFVLFdBQVcsQ0FBQyxZQUFvQjtJQUM3QyxJQUFJLENBQUM7UUFDSCxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxxQ0FBd0IsQ0FBQyxFQUFFLFlBQVksRUFBRSxDQUFDLENBQUMsQ0FBQztRQUNqRixPQUFPLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUM7SUFDbkUsQ0FBQztJQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDWCxJQUFJLENBQUMsWUFBWSxrQ0FBcUIsSUFBSSxDQUFDLFlBQVksdUJBQVUsRUFBRSxDQUFDO1lBQ2xFLHlCQUF5QjtZQUN6QixPQUFPLFNBQVMsQ0FBQztRQUNuQixDQUFDO1FBQ0QsTUFBTSxDQUFDLENBQUM7SUFDVixDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsS0FBSyxVQUFVLGdCQUFnQixDQUFDLFlBQStCLEVBQUUsWUFBb0IsRUFBRSxLQUFjO0lBQ25HLE1BQU0sSUFBSSxHQUFHLElBQUksR0FBRyxF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SzthQUNOLENBQUMsQ0FBQztZQUNILFVBQVUsRUFBRSxDQUFDO1lBQ2IsU0FBUztRQUNYLENBQUM7UUFFRCwySUFBMkk7UUFDM0ksdUlBQXVJO1FBQ3ZJLGVBQWU7UUFDZixNQUFNLFVBQVUsQ0FBQyxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBRTNELHdJQUF3STtRQUN4SSxzR0FBc0c7UUFDdEcsVUFBVSxFQUFFLENBQUM7SUFDZixDQUFDO0lBRUQsT0FBTyxNQUFNLENBQUM7QUFDaEIsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERlc2NyaWJlRXhlY3V0aW9uQ29tbWFuZCwgRXhlY3V0aW9uRG9lc05vdEV4aXN0LCBJbnZhbGlkQXJuLCBTRk5DbGllbnQsIFN0b3BFeGVjdXRpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNmbic7XG5pbXBvcnQgeyBTZW5kTWVzc2FnZUNvbW1hbmQsIFNRU0NsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zcXMnO1xuaW1wb3J0ICogYXMgQVdTTGFtYmRhIGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgT3JjaGVzdHJhdG9ySW5wdXQsIFdBUk1fUlVOTkVSX0pPQl9JRCB9IGZyb20gJy4vbGFtYmRhLWNvbW1vbic7XG5pbXBvcnQgeyB0ZXJtaW5hdGVSdW5uZXJJbnN0YW5jZXMgfSBmcm9tICcuL2xhbWJkYS1lYzInO1xuaW1wb3J0IHsgY2FjaGVkR2V0T2N0b2tpdCwgZGVsZXRlUnVubmVyLCBnZXRPY3Rva2l0LCBnZXRSdW5uZXIsIGlzTm90Rm91bmQgfSBmcm9tICcuL2xhbWJkYS1naXRodWInO1xuaW1wb3J0IHsgZm9yZ2V0Q29udHJvbGxlZEpvYiwgaXNSdW5uZXJBY2NvdW50ZWQsIHJlY29yZFJ1bm5lckFjY291bnRlZCB9IGZyb20gJy4vbGFtYmRhLXRyYWNrZXInO1xuXG5pbnRlcmZhY2UgSWRsZVJlYXBlckxhbWJkYUlucHV0IHtcbiAgcmVhZG9ubHkgZXhlY3V0aW9uQXJuOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJ1bm5lck5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgb3duZXI6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVwbzogc3RyaW5nO1xuICByZWFkb25seSBpbnN0YWxsYXRpb25JZD86IG51bWJlcjtcbiAgLyoqIGhvdyBtYW55IHNlY29uZHMgdGhlIHJ1bm5lciBpcyBhbGxvd2VkIHRvIGJlIGlkbGUgYmVmb3JlIHdlIHJlYXAgaXQgKi9cbiAgcmVhZG9ubHkgbWF4SWRsZVNlY29uZHM6IG51bWJlcjtcbiAgLyoqIGlkIG9mIHRoZSBydW5uZXIgd2UgZmlyc3Qgc2F3IGlkbGUsIHNvIGEgcmV0cmllZCBydW5uZXIgd2l0aCB0aGUgc2FtZSBuYW1lIGRvZXNuJ3QgaW5oZXJpdCBpdHMgaWRsZSB0aW1lICovXG4gIHJlYWRvbmx5IHJ1bm5lcklkPzogbnVtYmVyO1xuICAvKiogd2hlbiB3ZSBmaXJzdCBzYXcgdGhhdCBydW5uZXIgaWRsZSwgaW4gbWlsbGlzZWNvbmRzIHNpbmNlIGVwb2NoICovXG4gIHJlYWRvbmx5IGlkbGVTaW5jZT86IG51bWJlcjtcbn1cblxuY29uc3Qgc2ZuID0gbmV3IFNGTkNsaWVudCgpO1xuY29uc3Qgc3FzID0gbmV3IFNRU0NsaWVudCgpO1xuXG4vKipcbiAqIEhvdyBtYW55IHJ1bm5lcnMgd2UgZm9sbG93IGJlZm9yZSBnaXZpbmcgdXAgb24gZmluZGluZyB0aGUgam9iIGxlZnQgd2l0aG91dCBhIHJ1bm5lci4gRXZlcnkgaG9wIGlzIGEgaGFuZGZ1bCBvZiBBUEkgY2FsbHMsIHNvIGEgZnVsbFxuICogYmF0Y2ggb2YgcnVubmVycyB3YWxraW5nIHRoaXMgZmFyIHN0aWxsIGZpbmlzaGVzIHdlbGwgd2l0aGluIHRoZSB0aW1lb3V0LlxuICovXG5jb25zdCBNQVhfSE9QUyA9IDEwO1xuXG4vKipcbiAqIElucHV0IG9mIHRoZSBzdGVwIGZ1bmN0aW9uIHRoYXQgc3RhcnRlZCBhIHJ1bm5lciwgb3IgdW5kZWZpbmVkIGlmIHRoZSBydW5uZXIgaXNuJ3Qgb3Vycy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcnVubmVySW5wdXQoZXhlY3V0aW9uQXJuOiBzdHJpbmcpOiBQcm9taXNlPHVua25vd24+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBleGVjdXRpb24gPSBhd2FpdCBzZm4uc2VuZChuZXcgRGVzY3JpYmVFeGVjdXRpb25Db21tYW5kKHsgZXhlY3V0aW9uQXJuIH0pKTtcbiAgICByZXR1cm4gZXhlY3V0aW9uLmlucHV0ID8gSlNPTi5wYXJzZShleGVjdXRpb24uaW5wdXQpIDogdW5kZWZpbmVkO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKGUgaW5zdGFuY2VvZiBFeGVjdXRpb25Eb2VzTm90RXhpc3QgfHwgZSBpbnN0YW5jZW9mIEludmFsaWRBcm4pIHtcbiAgICAgIC8vIHNvbWVib2R5IGVsc2UncyBydW5uZXJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHRocm93IGU7XG4gIH1cbn1cblxuLyoqXG4gKiBGaW5kIHRoZSBqb2IgbGVmdCB3aXRob3V0IGEgcnVubmVyIG5vdyB0aGF0IHdlJ3JlIHJlYXBpbmcgdGhpcyBvbmUuXG4gKlxuICogVGhhdCdzIHVzdWFsbHkgdGhlIGpvYiB0aGlzIHJ1bm5lciB3YXMgc3RhcnRlZCBmb3IuIEJ1dCBHaXRIdWIgbWF5IGhhdmUgaGFuZGVkIHRoYXQgam9iIHRvIGFub3RoZXIgcnVubmVyIG9mIG91cnMsIHdoaWNoIGxlYXZlcyB0aGUgam9iIHRoYXRcbiAqIHJ1bm5lciB3YXMgc3RhcnRlZCBmb3Igd2FpdGluZyBpbnN0ZWFkLiBUaGF0IGpvYiBtYXkgaGF2ZSBiZWVuIGhhbmRlZCB0byB5ZXQgYW5vdGhlciBydW5uZXIgb2Ygb3VycywgYW5kIHNvIG9uLiBXZSBmb2xsb3cgdGhlIGNoYWluIHVudGlsIHdlXG4gKiBmaW5kIGEgam9iIHN0aWxsIHdhaXRpbmcgZm9yIGEgcnVubmVyLlxuICpcbiAqIFJldHVybnMgdW5kZWZpbmVkIHdoZW4gbm8gam9iIHdhcyBsZWZ0IHdpdGhvdXQgYSBydW5uZXIsIG9yIHdoZW4gd2UgY2FuJ3QgdGVsbC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZmluZEFiYW5kb25lZEpvYihvY3Rva2l0Q2FjaGU6IHR5cGVvZiBnZXRPY3Rva2l0LCBleGVjdXRpb25Bcm46IHN0cmluZywgaW5wdXQ6IHVua25vd24pOiBQcm9taXNlPG51bWJlciB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxudW1iZXI+KCk7XG4gIGxldCBjdXJyZW50ID0gaW5wdXQ7XG5cbiAgZm9yIChsZXQgaG9wID0gMDsgaG9wIDwgTUFYX0hPUFM7IGhvcCsrKSB7XG4gICAgY29uc3QgeyBvd25lciwgcmVwbywgam9iSWQsIGluc3RhbGxhdGlvbklkIH0gPSAoY3VycmVudCA/PyB7fSkgYXMgUGFydGlhbDxPcmNoZXN0cmF0b3JJbnB1dD47XG4gICAgaWYgKHR5cGVvZiBvd25lciAhPSAnc3RyaW5nJyB8fCB0eXBlb2YgcmVwbyAhPSAnc3RyaW5nJyB8fCB0eXBlb2Ygam9iSWQgIT0gJ251bWJlcicpIHtcbiAgICAgIC8vIHN0ZXAgZnVuY3Rpb24gc3RhcnRlZCBieSBoYW5kIHdpdGggaW5wdXQgd2UgZG9uJ3QgdW5kZXJzdGFuZFxuICAgICAgY29uc29sZS5sb2coeyBub3RpY2U6ICdSdW5uZXIgaGFzIG5vIGpvYiB3ZSB1bmRlcnN0YW5kJywgaW5wdXQ6IGN1cnJlbnQgfSk7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoam9iSWQgPT0gV0FSTV9SVU5ORVJfSk9CX0lEKSB7XG4gICAgICAvLyB3YXJtIHJ1bm5lcnMgYXJlbid0IHN0YXJ0ZWQgZm9yIGFueSBqb2IsIHNvIG5vIGpvYiBpcyB3YWl0aW5nIG9uIHRoZW1cbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGlmIChzZWVuLmhhcyhqb2JJZCkpIHtcbiAgICAgIC8vIHRoZSBqb2JzIGdvdCBzaHVmZmxlZCBiZXR3ZWVuIG91ciBydW5uZXJzIGFuZCB3ZSBjYW1lIGJhY2sgYXJvdW5kLiB0aGV5IGFsbCByYW4sIHNvIG5vdGhpbmcgd2FzIGFiYW5kb25lZFxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gICAgc2Vlbi5hZGQoam9iSWQpO1xuXG4gICAgbGV0IGpvYjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBvY3Rva2l0IH0gPSBhd2FpdCBvY3Rva2l0Q2FjaGUoaW5zdGFsbGF0aW9uSWQpO1xuICAgICAgam9iID0gKGF3YWl0IG9jdG9raXQucmVzdC5hY3Rpb25zLmdldEpvYkZvcldvcmtmbG93UnVuKHsgb3duZXIsIHJlcG8sIGpvYl9pZDogam9iSWQgfSkpLmRhdGE7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgaWYgKCFpc05vdEZvdW5kKGUpKSB7XG4gICAgICAgIHRocm93IGU7XG4gICAgICB9XG4gICAgICAvLyBzdGVwIGZ1bmN0aW9uIHN0YXJ0ZWQgYnkgaGFuZCB3aXRoIGEgam9iIHRoYXQgZG9lc24ndCBleGlzdFxuICAgICAgY29uc29sZS5sb2coeyBub3RpY2U6ICdHaXRIdWIga25vd3Mgbm90aGluZyBhYm91dCB0aGlzIGpvYicsIG93bmVyLCByZXBvLCBqb2JJZCB9KTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgaWYgKCFqb2IucnVubmVyX25hbWUpIHtcbiAgICAgIC8vIG5ldmVyIGFzc2lnbmVkLiBzdGlsbCB3YWl0aW5nIG1lYW5zIGl0J3MgdGhlIG9uZSBsZWZ0IHdpdGhvdXQgYSBydW5uZXIuIGNvbXBsZXRlZCBtZWFucyBpdCB3YXMgY2FuY2VsbGVkIGJlZm9yZSBhbnkgcnVubmVyIGdvdCBpdC5cbiAgICAgIHJldHVybiBqb2Iuc3RhdHVzID09ICdjb21wbGV0ZWQnID8gdW5kZWZpbmVkIDogam9iSWQ7XG4gICAgfVxuXG4gICAgLy8gdGhlIGpvYiBnb3QgYSBydW5uZXIuIGlmIHRoYXQgcnVubmVyIGlzIG91cnMsIHRoZSBqb2IgaXQgd2FzIHN0YXJ0ZWQgZm9yIGlzIHRoZSBvbmUgbGVmdCB3YWl0aW5nIG5vdy4gcnVubmVyIG5hbWVzIGFyZSBleGVjdXRpb24gbmFtZXMuXG4gICAgY3VycmVudCA9IGF3YWl0IHJ1bm5lcklucHV0KGV4ZWN1dGlvbkFybi5yZXBsYWNlKC9bXjpdKyQvLCBqb2IucnVubmVyX25hbWUpKTtcbiAgICBpZiAoY3VycmVudCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBub3Qgb3VyIHJ1bm5lciwgc28gbm9uZSBvZiBvdXIgam9icyBpcyB3YWl0aW5nIG9uIGl0XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBpZiAoKGN1cnJlbnQgYXMgUGFydGlhbDxPcmNoZXN0cmF0b3JJbnB1dD4pLmpvYklkID09IGpvYklkKSB7XG4gICAgICAvLyBpdCByYW4gb24gYSBydW5uZXIgc3RhcnRlZCBmb3IgaXQgKGUuZy4gYSBkdXBsaWNhdGUgZXhlY3V0aW9uIG9yIGEgcmVwbGFjZW1lbnQpLCBzbyBub3RoaW5nIGlzIHdhaXRpbmdcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cbiAgY29uc29sZS5sb2coeyBub3RpY2U6ICdHYXZlIHVwIGxvb2tpbmcgZm9yIHRoZSBqb2IgbGVmdCB3aXRob3V0IGEgcnVubmVyJywgZXhlY3V0aW9uQXJuLCBob3BzOiBNQVhfSE9QUyB9KTtcbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBUaGlzIHJ1bm5lciBpcyBnb25lLiBJZiBpdCBuZXZlciByZXBvcnRlZCBhIGpvYiwgZm9yZ2V0IHRoZSBqb2IgbGVmdCB3aXRob3V0IGEgcnVubmVyIGJlY2F1c2Ugb2YgaXQuXG4gKlxuICogVGhhdCBqb2IgbWF5IGJlIHN0dWNrIG9uIEdpdEh1YidzIHNpZGUgKGUuZy4gb3V0YWdlKSBhbmQgZ2V0IGhhbmRlZCB0byBhbm90aGVyIHJ1bm5lciBvZiBvdXJzIGxhdGVyIG9uLiBGb3JnZXR0aW5nIGl0IG1lYW5zIHRoYXQgcnVubmVyIGlzXG4gKiBkZXRlY3RlZCBhcyBzdG9sZW4gYW5kIHJlcGxhY2VkLCBpbnN0ZWFkIG9mIGxvb2tpbmcgbGlrZSBhIGZhaXIgc2h1ZmZsZS4gSWYgdGhlIGpvYiBlbmRzIHVwIHdpdGggYW5vdGhlciBydW5uZXIgb2Ygb3VycyBhbnl3YXksIHdlIG1heSBnZXQgYVxuICogZmFsc2UgcG9zaXRpdmUgYW5kIHN0YXJ0IG9uZSBydW5uZXIgdG9vIG1hbnkuIFRoYXQgcnVubmVyIHdpbGwganVzdCBpZGxlIHVudGlsIGl0J3MgcmVhcGVkIHRvbywgd2hpY2ggaXMgYmV0dGVyIHRoYW4gbGVhdmluZyBhIGpvYiB3aXRoIG5vXG4gKiBydW5uZXIgYXQgYWxsLlxuICpcbiAqIFJldHVybnMgZmFsc2UgaWYgd2Ugc2hvdWxkIHRyeSBhZ2FpbiBsYXRlci5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcnVubmVyR29uZShvY3Rva2l0Q2FjaGU6IHR5cGVvZiBnZXRPY3Rva2l0LCBpbnB1dDogSWRsZVJlYXBlckxhbWJkYUlucHV0LCBleGVjdXRpb25JbnB1dD86IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoZXhlY3V0aW9uSW5wdXQgPT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnNvbGUud2Fybih7XG4gICAgICBub3RpY2U6ICdCYWQgZXhlY3V0aW9uIGlucHV0JyxcbiAgICAgIGlucHV0LFxuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgdHJ5IHtcbiAgICBpZiAoYXdhaXQgaXNSdW5uZXJBY2NvdW50ZWQoaW5wdXQucnVubmVyTmFtZSkpIHtcbiAgICAgIC8vIGl0IHJlcG9ydGVkIGEgam9iLCBvciB3ZSBhbHJlYWR5IGdvdCBoZXJlIGJlZm9yZVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgLy8gbm8gcmVwb3J0IGRvZXNuJ3QgcHJvdmUgaXQgcmFuIG5vdGhpbmcgKGUuZy4gYSBxdWljayBqb2IgdGhhdCBlbmRlZCBiZWZvcmUgaXRzIHJlcG9ydCB3YXMgaGFuZGxlZCksIGJ1dCB0aGUgd2FsayBhc2tzIEdpdEh1YiBhbnl3YXlcbiAgICBjb25zdCBqb2JJZCA9IGF3YWl0IGZpbmRBYmFuZG9uZWRKb2Iob2N0b2tpdENhY2hlLCBpbnB1dC5leGVjdXRpb25Bcm4sIEpTT04ucGFyc2UoZXhlY3V0aW9uSW5wdXQpKTtcbiAgICBpZiAoam9iSWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdGb3JnZXR0aW5nIGpvYiBsZWZ0IHdpdGhvdXQgYSBydW5uZXInLFxuICAgICAgICBqb2JJZCxcbiAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgaW5wdXQsXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IGZvcmdldENvbnRyb2xsZWRKb2Ioam9iSWQpO1xuICAgIH1cblxuICAgIC8vIG1hcmsgdGhlIHJ1bm5lciBhcyBhY2NvdW50ZWQgZm9yIHNvIHdlIGRvbid0IHRyeSB0byBmb3JnZXQgaXRzIGpvYiBhZ2FpbiBsYXRlclxuICAgIC8vIHRoZXJlIGFyZSBhIGZldyBwYXRocyB0aGF0IGxlYWQgdG8gdGhpcyBmdW5jdGlvbiwgYW5kIHdlIGRvbid0IHdhbnQgdG8gZG8gdGhpcyB3aG9sZSBwcm9jZXNzIHR3aWNlLi4uXG4gICAgYXdhaXQgcmVjb3JkUnVubmVyQWNjb3VudGVkKGlucHV0LnJ1bm5lck5hbWUpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdGYWlsZWQgdG8gZm9yZ2V0IGpvYicsXG4gICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgZXJyb3I6IGUsXG4gICAgICBpbnB1dCxcbiAgICB9KTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQ6IEFXU0xhbWJkYS5TUVNFdmVudCk6IFByb21pc2U8QVdTTGFtYmRhLlNRU0JhdGNoUmVzcG9uc2U+IHtcbiAgY29uc3QgcmVzdWx0OiBBV1NMYW1iZGEuU1FTQmF0Y2hSZXNwb25zZSA9IHsgYmF0Y2hJdGVtRmFpbHVyZXM6IFtdIH07XG4gIGNvbnN0IGdldE9jdG9raXRDYWNoZWQgPSBjYWNoZWRHZXRPY3Rva2l0KCk7XG5cbiAgZm9yIChjb25zdCByZWNvcmQgb2YgZXZlbnQuUmVjb3Jkcykge1xuICAgIGNvbnN0IGlucHV0ID0gSlNPTi5wYXJzZShyZWNvcmQuYm9keSkgYXMgSWRsZVJlYXBlckxhbWJkYUlucHV0O1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ0NoZWNraW5nIHJ1bm5lcicsXG4gICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgaW5wdXQsXG4gICAgfSk7XG5cbiAgICBjb25zdCByZXRyeUxhdGVyID0gKCkgPT4gcmVzdWx0LmJhdGNoSXRlbUZhaWx1cmVzLnB1c2goeyBpdGVtSWRlbnRpZmllcjogcmVjb3JkLm1lc3NhZ2VJZCB9KTtcblxuICAgIC8vIGNoZWNrIGlmIHN0ZXAgZnVuY3Rpb24gaXMgc3RpbGwgcnVubmluZ1xuICAgIGNvbnN0IGV4ZWN1dGlvbiA9IGF3YWl0IHNmbi5zZW5kKG5ldyBEZXNjcmliZUV4ZWN1dGlvbkNvbW1hbmQoeyBleGVjdXRpb25Bcm46IGlucHV0LmV4ZWN1dGlvbkFybiB9KSk7XG4gICAgaWYgKGV4ZWN1dGlvbi5zdGF0dXMgPT0gJ1NVQ0NFRURFRCcpIHtcbiAgICAgIC8vIG5vIG5lZWQgdG8gdGVzdCBhZ2FpbiBhcyBydW5uZXIgYWxyZWFkeSBmaW5pc2hlZCBhbmQgcmVtb3ZlZCBpdHNlbGZcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnUnVubmVyIGFscmVhZHkgZmluaXNoZWQnLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICBpbnB1dCxcbiAgICAgIH0pO1xuICAgICAgLy8gdGhlIHJ1bm5lciByZXBvcnRlZCBzdWNjZXNzLCBzbyBhbnkgaW5zdGFuY2Ugc3RpbGwgcnVubmluZyBmb3IgaXQgaGFzIG91dGxpdmVkIGl0cyBqb2IuIHRoYXQgY2FuIGhhcHBlbiB3aGVuIGBwb3dlcm9mZmAgZG9lc24ndCB3b3JrIGZvciBhbnlcbiAgICAgIC8vIHJlYXNvbi4gZ2VuZXJhbGx5IGluIHJhcmUgY2FzZXMsIGJ1dCB3ZSBkb24ndCB3YW50IHRvIGxlYXZlIGV4cGVuc2l2ZSBpbnN0YW5jZXMgYmVoaW5kLlxuICAgICAgYXdhaXQgdGVybWluYXRlUnVubmVySW5zdGFuY2VzKGlucHV0LnJ1bm5lck5hbWUpO1xuICAgICAgLy8gc3VjY2VzcyBkb2Vzbid0IG1lYW4gaXQgcmFuIGEgam9iIChlLmcuIHNvbWVib2R5IGRlbGV0ZWQgdGhlIHJ1bm5lciB3aGlsZSBpdCB3YXMgaWRsZSlcbiAgICAgIGlmICghYXdhaXQgcnVubmVyR29uZShnZXRPY3Rva2l0Q2FjaGVkLCBpbnB1dCwgZXhlY3V0aW9uLmlucHV0KSkge1xuICAgICAgICByZXRyeUxhdGVyKCk7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBhIHN0ZXAgZnVuY3Rpb24gdGhhdCBlbmRlZCBhbnkgb3RoZXIgd2F5IG1heSBub3QgaGF2ZSBjbGVhbmVkIHVwIGFmdGVyIGl0c2VsZi4gdGhhdCBoYXBwZW5zIHdoZW4gaXQncyBzdG9wcGVkXG4gICAgLy8gZnJvbSB0aGUgb3V0c2lkZSwgb3Igd2hlbiBTdGVwIEZ1bmN0aW9ucyBraWxscyBpdCBmb3IgcmVhY2hpbmcgaXRzIDI1LDAwMCBldmVudCBoaXN0b3J5IGxpbWl0LiBpdHMgcnVubmVyIGNhblxuICAgIC8vIHN0aWxsIGJlIHJlZ2lzdGVyZWQgYW5kIGNhbiBzdGlsbCBwaWNrIHVwIGEgam9iLCBzbyB3ZSBrZWVwIHdhdGNoaW5nIGl0IGxpa2UgYW55IG90aGVyIHJ1bm5lciBhbmQgbGV0IHRoZSBpZGxlXG4gICAgLy8gdGltZW91dCBkZWNpZGUuIHdlIGp1c3QgaGF2ZSBubyBzdGVwIGZ1bmN0aW9uIGxlZnQgdG8gc3RvcCB3aGVuIHRoYXQgdGltZSBjb21lcy5cbiAgICBjb25zdCBleGVjdXRpb25TdG9wcGVkID0gZXhlY3V0aW9uLnN0YXR1cyAhPSAnUlVOTklORyc7XG5cbiAgICAvLyBnZXQgZ2l0aHViIGFjY2Vzc1xuICAgIGNvbnN0IHsgb2N0b2tpdCwgZ2l0aHViU2VjcmV0czogc2VjcmV0cyB9ID0gYXdhaXQgZ2V0T2N0b2tpdENhY2hlZChpbnB1dC5pbnN0YWxsYXRpb25JZCk7XG5cbiAgICAvLyBmaW5kIHJ1bm5lclxuICAgIGNvbnN0IHJ1bm5lciA9IGF3YWl0IGdldFJ1bm5lcihvY3Rva2l0LCBzZWNyZXRzLnJ1bm5lckxldmVsLCBpbnB1dC5vd25lciwgaW5wdXQucmVwbywgaW5wdXQucnVubmVyTmFtZSk7XG4gICAgaWYgKCFydW5uZXIpIHtcbiAgICAgIGlmIChleGVjdXRpb25TdG9wcGVkKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgICBub3RpY2U6ICdTdG9wcGVkIHN0ZXAgZnVuY3Rpb24gaGFzIG5vIHJ1bm5lciB0byBjbGVhbiB1cCcsXG4gICAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgICBpbnB1dCxcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIG5vIHJ1bm5lciBvbiBHaXRIdWIsIHRlcm1pbmF0ZSBhbnkgaW5zdGFuY2UgdGhhdCBkaWRuJ3QgcHJvcGVybHkgcG93ZXItb2ZmIGR1ZSB0byBzb21lIGV4dHJlbWUgZmFpbHVyZSAoZS5nLiBJTURTIGZhaWx1cmUsIE9PTSBraWxsZXIsXG4gICAgICAgIC8vIHdlZGdlZCBwb3dlcm9mZiwgZXRjLikuIHRoZSBzdGVwIGZ1bmN0aW9uIGlzIHN0b3BwZWQsIHNvIGl0IHdvbid0IGJlIGFibGUgdG8gY2xlYW4gdXAgYWZ0ZXIgaXRzZWxmLlxuICAgICAgICBhd2FpdCB0ZXJtaW5hdGVSdW5uZXJJbnN0YW5jZXMoaW5wdXQucnVubmVyTmFtZSk7XG4gICAgICAgIC8vIHRoZSBzdGVwIGZ1bmN0aW9uIG1heSBoYXZlIGZhaWxlZCBiZWZvcmUgaXRzIHJ1bm5lciBldmVyIHJlZ2lzdGVyZWQsIHNvIGl0cyBqb2IgbWF5IHN0aWxsIGJlIHdhaXRpbmcgZm9yIG9uZVxuICAgICAgICBpZiAoIWF3YWl0IHJ1bm5lckdvbmUoZ2V0T2N0b2tpdENhY2hlZCwgaW5wdXQsIGV4ZWN1dGlvbi5pbnB1dCkpIHtcbiAgICAgICAgICByZXRyeUxhdGVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnUnVubmVyIG5vdCBydW5uaW5nIHlldCcsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICByZXRyeUxhdGVyKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBpZiBub3QgaWRsZSwgdHJ5IGFnYWluIGxhdGVyXG4gICAgLy8gd2Ugd2FudCB0byB0cnkgYWdhaW4gYmVjYXVzZSB0aGUgcnVubmVyIG1pZ2h0IGJlIHJldHJpZWQgZHVlIHRvIGUuZy4gbGFtYmRhIHRpbWVvdXRcbiAgICAvLyB3ZSBuZWVkIHRvIGtlZXAgZm9sbG93aW5nIHRoZSByZXRyeSB0b28gYW5kIG1ha2Ugc3VyZSBpdCBkb2Vzbid0IGdvIGlkbGVcbiAgICBpZiAocnVubmVyLmJ1c3kpIHtcbiAgICAgIGlmIChleGVjdXRpb25TdG9wcGVkKSB7XG4gICAgICAgIC8vIGl0IHRvb2sgYSBqb2IsIHNvIGl0IHdpbGwgcmVtb3ZlIGl0c2VsZiBvbmNlIGl0J3MgZG9uZSwgbGlrZSBldmVyeSBvdGhlciBlcGhlbWVyYWwgcnVubmVyXG4gICAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgICBub3RpY2U6ICdTdG9wcGVkIHN0ZXAgZnVuY3Rpb24gbGVmdCBhIGJ1c3kgcnVubmVyIGJlaGluZCcsXG4gICAgICAgICAgcnVubmVySWQ6IHJ1bm5lci5pZCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICAgIGlucHV0LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0cnlMYXRlcigpOyAvLyB3ZSBzdGlsbCB3YW50IHRoZSBvcHBvcnR1bml0eSB0byBjbGVhbiB1cCB0aGUgaW5zdGFuY2UgaWYgdGhlIHJ1bm5lciBkb2Vzbid0IHJlbW92ZSBpdHNlbGYgZm9yIHNvbWUgcmVhc29uLCBzbyB3ZSByZXRyeSBsYXRlclxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdSdW5uZXIgaXMgbm90IGlkbGUnLFxuICAgICAgICBydW5uZXJJZDogcnVubmVyLmlkLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICBpbnB1dCxcbiAgICAgIH0pO1xuICAgICAgcmV0cnlMYXRlcigpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gSklUIHJ1bm5lcnMgYXJlIHJlZ2lzdGVyZWQgYmVmb3JlIHRoZXkgYm9vdCwgc28gYW4gb2ZmbGluZSBydW5uZXIgaXMgdXN1YWxseSBvbmUgdGhhdCBpcyBzdGlsbCBzdGFydGluZy4gc29tZSBwcm92aWRlcnMgY2FuIHRha2UgbW9yZSB0aGFuXG4gICAgLy8gdGVuIG1pbnV0ZXMgdG8gZ2V0IHRoZXJlLiBvbmNlIHRoZSBzdGVwIGZ1bmN0aW9uIGlzIGdvbmUsIG5vdGhpbmcgaXMgZ29pbmcgdG8gc3RhcnQgaXQsIHNvIHdlIHRyZWF0IGl0IGFzIGlkbGUgYW5kIGxldCB0aGUgdGltZW91dCBkZWNpZGUuXG4gICAgaWYgKHJ1bm5lci5zdGF0dXMgIT09ICdvbmxpbmUnICYmICFleGVjdXRpb25TdG9wcGVkKSB7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1J1bm5lciBub3Qgb25saW5lIHlldCcsXG4gICAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICByZXRyeUxhdGVyKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyB0aGUgZmlyc3QgdGltZSB3ZSBzZWUgdGhlIHJ1bm5lciBpZGxlLCB3ZSBzdGFydCB0aGUgY2xvY2sgd2l0aCBhIG5ldyBtZXNzYWdlIHRoYXQgcmVtZW1iZXJzIHdoaWNoIHJ1bm5lciB3ZSBzYXcuIGEgcmV0cmllZCBydW5uZXJcbiAgICAvLyByZWdpc3RlcnMgYWdhaW4gd2l0aCBhIG5ldyBpZCwgc28gaXQgc3RhcnRzIHRoZSBjbG9jayBvdmVyLlxuICAgIGlmIChpbnB1dC5ydW5uZXJJZCAhPT0gcnVubmVyLmlkIHx8IGlucHV0LmlkbGVTaW5jZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1J1bm5lciBpcyBpZGxlJyxcbiAgICAgICAgcnVubmVySWQ6IHJ1bm5lci5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgaW5wdXQsXG4gICAgICB9KTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHNxcy5zZW5kKG5ldyBTZW5kTWVzc2FnZUNvbW1hbmQoe1xuICAgICAgICAgIFF1ZXVlVXJsOiBwcm9jZXNzLmVudi5JRExFX1JFQVBFUl9RVUVVRV9VUkwsXG4gICAgICAgICAgTWVzc2FnZUJvZHk6IEpTT04uc3RyaW5naWZ5KDxJZGxlUmVhcGVyTGFtYmRhSW5wdXQ+eyAuLi5pbnB1dCwgcnVubmVySWQ6IHJ1bm5lci5pZCwgaWRsZVNpbmNlOiBEYXRlLm5vdygpIH0pLFxuICAgICAgICB9KSk7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBlbnF1ZXVlIGlkbGUgY2hlY2snLFxuICAgICAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgICBlcnJvcjogZSxcbiAgICAgICAgICBpbnB1dCxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHJ5TGF0ZXIoKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIGNoZWNrIGlmIG1heCBpZGxlIHRpbWVvdXQgaGFzIHJlYWNoZWRcbiAgICBjb25zdCBpZGxlTXMgPSBEYXRlLm5vdygpIC0gaW5wdXQuaWRsZVNpbmNlO1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ1J1bm5lciBpcyBzdGlsbCBpZGxlJyxcbiAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgaWRsZVNlY29uZHM6IGlkbGVNcyAvIDEwMDAsXG4gICAgICBpbnB1dCxcbiAgICB9KTtcblxuICAgIGlmIChpZGxlTXMgPCAxMDAwICogaW5wdXQubWF4SWRsZVNlY29uZHMpIHtcbiAgICAgIC8vIHN0aWxsIGlkbGUsIHRpbWVvdXQgbm90IHJlYWNoZWQgLSByZXRyeSBsYXRlclxuICAgICAgcmV0cnlMYXRlcigpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gbWF4IGlkbGUgdGltZSByZWFjaGVkLCBkZWxldGUgcnVubmVyXG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnUnVubmVyIGlzIGlkbGUgZm9yIHRvbyBsb25nJyxcbiAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgaWRsZVNlY29uZHM6IGlkbGVNcyAvIDEwMDAsXG4gICAgICBtYXhJZGxlU2Vjb25kczogaW5wdXQubWF4SWRsZVNlY29uZHMsXG4gICAgICBpbnB1dCxcbiAgICB9KTtcblxuICAgIC8vIG5vdGhpbmcgdG8gc3RvcCB3aGVuIGl0IGFscmVhZHkgc3RvcHBlZCBvbiBpdHMgb3duXG4gICAgaWYgKCFleGVjdXRpb25TdG9wcGVkKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBzdG9wIHN0ZXAgZnVuY3Rpb24gZmlyc3QsIHNvIGl0J3MgbWFya2VkIGFzIGFib3J0ZWQgd2l0aCB0aGUgcHJvcGVyIGVycm9yXG4gICAgICAgIC8vIGlmIHdlIGRlbGV0ZSB0aGUgcnVubmVyIGZpcnN0LCB0aGUgc3RlcCBmdW5jdGlvbiB3aWxsIGJlIG1hcmtlZCBhcyBmYWlsZWQgd2l0aCBhIGdlbmVyaWMgZXJyb3JcbiAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgIG5vdGljZTogJ1N0b3BwaW5nIHN0ZXAgZnVuY3Rpb24nLFxuICAgICAgICAgIGV4ZWN1dGlvbkFybjogaW5wdXQuZXhlY3V0aW9uQXJuLFxuICAgICAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgICBpbnB1dCxcbiAgICAgICAgfSk7XG4gICAgICAgIGF3YWl0IHNmbi5zZW5kKG5ldyBTdG9wRXhlY3V0aW9uQ29tbWFuZCh7XG4gICAgICAgICAgZXhlY3V0aW9uQXJuOiBpbnB1dC5leGVjdXRpb25Bcm4sXG4gICAgICAgICAgZXJyb3I6ICdJZGxlUnVubmVyJyxcbiAgICAgICAgICBjYXVzZTogYFJ1bm5lciAke2lucHV0LnJ1bm5lck5hbWV9IG9uICR7aW5wdXQub3duZXJ9LyR7aW5wdXQucmVwb30gaXMgaWRsZSBmb3IgdG9vIGxvbmcgKCR7aWRsZU1zIC8gMTAwMH0gc2Vjb25kcyBhbmQgbGltaXQgaXMgJHtpbnB1dC5tYXhJZGxlU2Vjb25kc30gc2Vjb25kcylgLFxuICAgICAgICB9KSk7XG4gICAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgICBub3RpY2U6ICdTdG9wcGVkIHN0ZXAgZnVuY3Rpb24nLFxuICAgICAgICAgIG1ldHJpYzogJ1J1bm5lclN0b3BwZWQnLFxuICAgICAgICAgIHJlYXNvbjogJ0lkbGVSdW5uZXInLFxuICAgICAgICAgIGV4ZWN1dGlvbkFybjogaW5wdXQuZXhlY3V0aW9uQXJuLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgICAgb3duZXI6IGlucHV0Lm93bmVyLFxuICAgICAgICAgIHJlcG86IGlucHV0LnJlcG8sXG4gICAgICAgIH0pO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgICAgICBub3RpY2U6ICdGYWlsZWQgdG8gc3RvcCBzdGVwIGZ1bmN0aW9uJyxcbiAgICAgICAgICBleGVjdXRpb25Bcm46IGlucHV0LmV4ZWN1dGlvbkFybixcbiAgICAgICAgICBydW5uZXJJZDogcnVubmVyLmlkLFxuICAgICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgICAgZXJyb3I6IGUsXG4gICAgICAgICAgaW5wdXQsXG4gICAgICAgIH0pO1xuICAgICAgICByZXRyeUxhdGVyKCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ0RlbGV0aW5nIHJ1bm5lcicsXG4gICAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICBhd2FpdCBkZWxldGVSdW5uZXIob2N0b2tpdCwgc2VjcmV0cy5ydW5uZXJMZXZlbCwgaW5wdXQub3duZXIsIGlucHV0LnJlcG8sIHJ1bm5lci5pZCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5lcnJvcih7XG4gICAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBkZWxldGUgcnVubmVyJyxcbiAgICAgICAgcnVubmVySWQ6IHJ1bm5lci5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgZXJyb3I6IGUsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICByZXRyeUxhdGVyKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBHaXRIdWIgb25seSBsZXRzIHVzIGRlbGV0ZSBhbiBpZGxlIHJ1bm5lciwgc28gdGhpcyBvbmUgbmV2ZXIgZ290IGEgam9iLiBhY2NvdW50IGZvciBpdCBub3cgc28gaXRzIGpvYiBpcyBmb3Jnb3R0ZW4gcmlnaHQgYXdheSBhbmQgbm90IG9uXG4gICAgLy8gdGhlIG5leHQgZGVsaXZlcnkgYWJvdXQgMTAgbWludXRlcyBmcm9tIG5vdy4gVGhlIG1lc3NhZ2UgaXMgcmV0cmllZCBiZWxvdyBlaXRoZXIgd2F5LCBzbyBpZiB0aGlzIGZhaWxzLCB0aGUgXCJubyBydW5uZXJcIiBicmFuY2ggYWJvdmVcbiAgICAvLyB0cmllcyBhZ2Fpbi5cbiAgICBhd2FpdCBydW5uZXJHb25lKGdldE9jdG9raXRDYWNoZWQsIGlucHV0LCBleGVjdXRpb24uaW5wdXQpO1xuXG4gICAgLy8gdGhlIHJ1bm5lciBpcyBkZWxldGVkIGJ1dCB0aGUgaW5zdGFuY2UgaXMgc3RpbGwgYWxpdmUgYW5kIGFib3V0IHRvIG5vdGljZS4gZG8gbm90IHRlcm1pbmF0ZS4gZ2l2ZSBpdCBhIGRlbGl2ZXJ5IGN5Y2xlIHRvIGxvZyB3aHkgaXQnc1xuICAgIC8vIHN0b3BwaW5nIGFuZCBwb3dlciBpdHNlbGYgb2ZmLiBpZiBpdCdzIHN0aWxsIGhlcmUgbmV4dCB0aW1lLCB0aGUgIXJ1bm5lciBicmFuY2ggYWJvdmUgdGVybWluYXRlcyBpdFxuICAgIHJldHJ5TGF0ZXIoKTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59XG4iXX0=