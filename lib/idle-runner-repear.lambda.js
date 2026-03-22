"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_sfn_1 = require("@aws-sdk/client-sfn");
const lambda_github_1 = require("./lambda-github");
const sfn = new client_sfn_1.SFNClient();
async function handler(event) {
    const result = { batchItemFailures: [] };
    const octokitCache = new Map();
    for (const record of event.Records) {
        const input = JSON.parse(record.body);
        console.log({
            notice: 'Checking runner',
            input,
        });
        const retryLater = () => result.batchItemFailures.push({ itemIdentifier: record.messageId });
        // check if step function is still running
        const execution = await sfn.send(new client_sfn_1.DescribeExecutionCommand({ executionArn: input.executionArn }));
        if (execution.status != 'RUNNING') {
            // no need to test again as runner already finished
            console.log({
                notice: 'Runner already finished',
                input,
            });
            continue;
        }
        // get github access
        let octokit;
        let secrets;
        const cached = octokitCache.get(input.installationId);
        if (cached) {
            // use cached octokit
            octokit = cached.octokit;
            secrets = cached.secrets;
        }
        else {
            // getOctokit calls secrets manager and Github API every time, so cache the result
            // this handler can work on multiple runners at once, so caching is important
            const { octokit: newOctokit, githubSecrets: newSecrets } = await (0, lambda_github_1.getOctokit)(input.installationId);
            octokit = newOctokit;
            secrets = newSecrets;
            octokitCache.set(input.installationId, { octokit, secrets });
        }
        // find runner
        const runner = await (0, lambda_github_1.getRunner)(octokit, secrets.runnerLevel, input.owner, input.repo, input.runnerName);
        if (!runner) {
            console.log({
                notice: 'Runner not running yet',
                input,
            });
            retryLater();
            continue;
        }
        // if not idle, try again later
        // we want to try again because the runner might be retried due to e.g. lambda timeout
        // we need to keep following the retry too and make sure it doesn't go idle
        if (runner.busy) {
            console.log({
                notice: 'Runner is not idle',
                input,
            });
            retryLater();
            continue;
        }
        // check if max idle timeout has reached
        let found = false;
        for (const label of runner.labels) {
            if (label.name.toLowerCase().startsWith('cdkghr:started:')) {
                const started = parseFloat(label.name.split(':')[2]);
                const startedDate = new Date(started * 1000);
                const now = new Date();
                const diffMs = now.getTime() - startedDate.getTime();
                console.log({
                    notice: `Runner ${input.runnerName} started ${diffMs / 1000} seconds ago`,
                    input,
                });
                if (diffMs > 1000 * input.maxIdleSeconds) {
                    // max idle time reached, delete runner
                    console.log({
                        notice: `Runner ${input.runnerName} is idle for too long`,
                        input,
                    });
                    try {
                        // stop step function first, so it's marked as aborted with the proper error
                        // if we delete the runner first, the step function will be marked as failed with a generic error
                        console.log({
                            notice: `Stopping step function ${input.executionArn}...`,
                            input,
                        });
                        await sfn.send(new client_sfn_1.StopExecutionCommand({
                            executionArn: input.executionArn,
                            error: 'IdleRunner',
                            cause: `Runner ${input.runnerName} on ${input.owner}/${input.repo} is idle for too long (${diffMs / 1000} seconds and limit is ${input.maxIdleSeconds} seconds)`,
                        }));
                    }
                    catch (e) {
                        console.error({
                            notice: `Failed to stop step function ${input.executionArn}: ${e}`,
                            input,
                        });
                        retryLater();
                        continue;
                    }
                    try {
                        console.log({
                            notice: `Deleting runner ${runner.id}...`,
                            input,
                        });
                        await (0, lambda_github_1.deleteRunner)(octokit, secrets.runnerLevel, input.owner, input.repo, runner.id);
                    }
                    catch (e) {
                        console.error({
                            notice: `Failed to delete runner ${runner.id}: ${e}`,
                            input,
                        });
                        retryLater();
                        continue;
                    }
                }
                else {
                    // still idle, timeout not reached -- retry later
                    retryLater();
                }
                found = true;
                break;
            }
        }
        if (!found) {
            // no started label? retry later (it won't retry forever as eventually the runner will stop and the step function will finish)
            console.error({
                notice: 'No `cdkghr:started:xxx` label found???',
                input,
            });
            retryLater();
        }
    }
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaWRsZS1ydW5uZXItcmVwZWFyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9pZGxlLXJ1bm5lci1yZXBlYXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZ0JBLDBCQTZJQztBQTdKRCxvREFBZ0c7QUFHaEcsbURBQXFGO0FBV3JGLE1BQU0sR0FBRyxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO0FBRXJCLEtBQUssVUFBVSxPQUFPLENBQUMsS0FBeUI7SUFDckQsTUFBTSxNQUFNLEdBQStCLEVBQUUsaUJBQWlCLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDckUsTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQW9FLENBQUM7SUFFakcsS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDbkMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUEwQixDQUFDO1FBQy9ELE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDVixNQUFNLEVBQUUsaUJBQWlCO1lBQ3pCLEtBQUs7U0FDTixDQUFDLENBQUM7UUFFSCxNQUFNLFVBQVUsR0FBRyxHQUFHLEVBQUUsQ0FBQyxNQUFNLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLEVBQUUsY0FBYyxFQUFFLE1BQU0sQ0FBQyxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBRTdGLDBDQUEwQztRQUMxQyxNQUFNLFNBQVMsR0FBRyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxxQ0FBd0IsQ0FBQyxFQUFFLFlBQVksRUFBRSxLQUFLLENBQUMsWUFBWSxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ3JHLElBQUksU0FBUyxDQUFDLE1BQU0sSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUNsQyxtREFBbUQ7WUFDbkQsT0FBTyxDQUFDLEdBQUcsQ0FBQztnQkFDVixNQUFNLEVBQUUseUJBQXlCO2dCQUNqQyxLQUFL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LEVBQUU7NEJBQ3BELEtBQUs7eUJBQ04sQ0FBQyxDQUFDO3dCQUNILFVBQVUsRUFBRSxDQUFDO3dCQUNiLFNBQVM7b0JBQ1gsQ0FBQztnQkFDSCxDQUFDO3FCQUFNLENBQUM7b0JBQ04saURBQWlEO29CQUNqRCxVQUFVLEVBQUUsQ0FBQztnQkFDZixDQUFDO2dCQUVELEtBQUssR0FBRyxJQUFJLENBQUM7Z0JBQ2IsTUFBTTtZQUNSLENBQUM7UUFDSCxDQUFDO1FBRUQsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ1gsOEhBQThIO1lBQzlILE9BQU8sQ0FBQyxLQUFLLENBQUM7Z0JBQ1osTUFBTSxFQUFFLHdDQUF3QztnQkFDaEQsS0FBSzthQUNOLENBQUMsQ0FBQztZQUNILFVBQVUsRUFBRSxDQUFDO1FBQ2YsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRGVzY3JpYmVFeGVjdXRpb25Db21tYW5kLCBTRk5DbGllbnQsIFN0b3BFeGVjdXRpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNmbic7XG5pbXBvcnQgdHlwZSB7IE9jdG9raXQgfSBmcm9tICdAb2N0b2tpdC9yZXN0JztcbmltcG9ydCAqIGFzIEFXU0xhbWJkYSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGRlbGV0ZVJ1bm5lciwgZ2V0T2N0b2tpdCwgZ2V0UnVubmVyLCBHaXRIdWJTZWNyZXRzIH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcblxuaW50ZXJmYWNlIElkbGVSZWFwZXJMYW1iZGFJbnB1dCB7XG4gIHJlYWRvbmx5IGV4ZWN1dGlvbkFybjogc3RyaW5nO1xuICByZWFkb25seSBydW5uZXJOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IG93bmVyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJlcG86IHN0cmluZztcbiAgcmVhZG9ubHkgaW5zdGFsbGF0aW9uSWQ/OiBudW1iZXI7XG4gIHJlYWRvbmx5IG1heElkbGVTZWNvbmRzOiBudW1iZXI7XG59XG5cbmNvbnN0IHNmbiA9IG5ldyBTRk5DbGllbnQoKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQ6IEFXU0xhbWJkYS5TUVNFdmVudCk6IFByb21pc2U8QVdTTGFtYmRhLlNRU0JhdGNoUmVzcG9uc2U+IHtcbiAgY29uc3QgcmVzdWx0OiBBV1NMYW1iZGEuU1FTQmF0Y2hSZXNwb25zZSA9IHsgYmF0Y2hJdGVtRmFpbHVyZXM6IFtdIH07XG4gIGNvbnN0IG9jdG9raXRDYWNoZSA9IG5ldyBNYXA8bnVtYmVyIHwgdW5kZWZpbmVkLCB7IG9jdG9raXQ6IE9jdG9raXQ7IHNlY3JldHM6IEdpdEh1YlNlY3JldHMgfT4oKTtcblxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XG4gICAgY29uc3QgaW5wdXQgPSBKU09OLnBhcnNlKHJlY29yZC5ib2R5KSBhcyBJZGxlUmVhcGVyTGFtYmRhSW5wdXQ7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnQ2hlY2tpbmcgcnVubmVyJyxcbiAgICAgIGlucHV0LFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmV0cnlMYXRlciA9ICgpID0+IHJlc3VsdC5iYXRjaEl0ZW1GYWlsdXJlcy5wdXNoKHsgaXRlbUlkZW50aWZpZXI6IHJlY29yZC5tZXNzYWdlSWQgfSk7XG5cbiAgICAvLyBjaGVjayBpZiBzdGVwIGZ1bmN0aW9uIGlzIHN0aWxsIHJ1bm5pbmdcbiAgICBjb25zdCBleGVjdXRpb24gPSBhd2FpdCBzZm4uc2VuZChuZXcgRGVzY3JpYmVFeGVjdXRpb25Db21tYW5kKHsgZXhlY3V0aW9uQXJuOiBpbnB1dC5leGVjdXRpb25Bcm4gfSkpO1xuICAgIGlmIChleGVjdXRpb24uc3RhdHVzICE9ICdSVU5OSU5HJykge1xuICAgICAgLy8gbm8gbmVlZCB0byB0ZXN0IGFnYWluIGFzIHJ1bm5lciBhbHJlYWR5IGZpbmlzaGVkXG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1J1bm5lciBhbHJlYWR5IGZpbmlzaGVkJyxcbiAgICAgICAgaW5wdXQsXG4gICAgICB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIGdldCBnaXRodWIgYWNjZXNzXG4gICAgbGV0IG9jdG9raXQ6IE9jdG9raXQ7XG4gICAgbGV0IHNlY3JldHM6IEdpdEh1YlNlY3JldHM7XG4gICAgY29uc3QgY2FjaGVkID0gb2N0b2tpdENhY2hlLmdldChpbnB1dC5pbnN0YWxsYXRpb25JZCk7XG4gICAgaWYgKGNhY2hlZCkge1xuICAgICAgLy8gdXNlIGNhY2hlZCBvY3Rva2l0XG4gICAgICBvY3Rva2l0ID0gY2FjaGVkLm9jdG9raXQ7XG4gICAgICBzZWNyZXRzID0gY2FjaGVkLnNlY3JldHM7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGdldE9jdG9raXQgY2FsbHMgc2VjcmV0cyBtYW5hZ2VyIGFuZCBHaXRodWIgQVBJIGV2ZXJ5IHRpbWUsIHNvIGNhY2hlIHRoZSByZXN1bHRcbiAgICAgIC8vIHRoaXMgaGFuZGxlciBjYW4gd29yayBvbiBtdWx0aXBsZSBydW5uZXJzIGF0IG9uY2UsIHNvIGNhY2hpbmcgaXMgaW1wb3J0YW50XG4gICAgICBjb25zdCB7IG9jdG9raXQ6IG5ld09jdG9raXQsIGdpdGh1YlNlY3JldHM6IG5ld1NlY3JldHMgfSA9IGF3YWl0IGdldE9jdG9raXQoaW5wdXQuaW5zdGFsbGF0aW9uSWQpO1xuICAgICAgb2N0b2tpdCA9IG5ld09jdG9raXQ7XG4gICAgICBzZWNyZXRzID0gbmV3U2VjcmV0cztcbiAgICAgIG9jdG9raXRDYWNoZS5zZXQoaW5wdXQuaW5zdGFsbGF0aW9uSWQsIHsgb2N0b2tpdCwgc2VjcmV0cyB9KTtcbiAgICB9XG5cbiAgICAvLyBmaW5kIHJ1bm5lclxuICAgIGNvbnN0IHJ1bm5lciA9IGF3YWl0IGdldFJ1bm5lcihvY3Rva2l0LCBzZWNyZXRzLnJ1bm5lckxldmVsLCBpbnB1dC5vd25lciwgaW5wdXQucmVwbywgaW5wdXQucnVubmVyTmFtZSk7XG4gICAgaWYgKCFydW5uZXIpIHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnUnVubmVyIG5vdCBydW5uaW5nIHlldCcsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICByZXRyeUxhdGVyKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBpZiBub3QgaWRsZSwgdHJ5IGFnYWluIGxhdGVyXG4gICAgLy8gd2Ugd2FudCB0byB0cnkgYWdhaW4gYmVjYXVzZSB0aGUgcnVubmVyIG1pZ2h0IGJlIHJldHJpZWQgZHVlIHRvIGUuZy4gbGFtYmRhIHRpbWVvdXRcbiAgICAvLyB3ZSBuZWVkIHRvIGtlZXAgZm9sbG93aW5nIHRoZSByZXRyeSB0b28gYW5kIG1ha2Ugc3VyZSBpdCBkb2Vzbid0IGdvIGlkbGVcbiAgICBpZiAocnVubmVyLmJ1c3kpIHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnUnVubmVyIGlzIG5vdCBpZGxlJyxcbiAgICAgICAgaW5wdXQsXG4gICAgICB9KTtcbiAgICAgIHJldHJ5TGF0ZXIoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIC8vIGNoZWNrIGlmIG1heCBpZGxlIHRpbWVvdXQgaGFzIHJlYWNoZWRcbiAgICBsZXQgZm91bmQgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGxhYmVsIG9mIHJ1bm5lci5sYWJlbHMpIHtcbiAgICAgIGlmIChsYWJlbC5uYW1lLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aCgnY2RrZ2hyOnN0YXJ0ZWQ6JykpIHtcbiAgICAgICAgY29uc3Qgc3RhcnRlZCA9IHBhcnNlRmxvYXQobGFiZWwubmFtZS5zcGxpdCgnOicpWzJdKTtcbiAgICAgICAgY29uc3Qgc3RhcnRlZERhdGUgPSBuZXcgRGF0ZShzdGFydGVkICogMTAwMCk7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG4gICAgICAgIGNvbnN0IGRpZmZNcyA9IG5vdy5nZXRUaW1lKCkgLSBzdGFydGVkRGF0ZS5nZXRUaW1lKCk7XG5cbiAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgIG5vdGljZTogYFJ1bm5lciAke2lucHV0LnJ1bm5lck5hbWV9IHN0YXJ0ZWQgJHtkaWZmTXMgLyAxMDAwfSBzZWNvbmRzIGFnb2AsXG4gICAgICAgICAgaW5wdXQsXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChkaWZmTXMgPiAxMDAwICogaW5wdXQubWF4SWRsZVNlY29uZHMpIHtcbiAgICAgICAgICAvLyBtYXggaWRsZSB0aW1lIHJlYWNoZWQsIGRlbGV0ZSBydW5uZXJcbiAgICAgICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgICAgICBub3RpY2U6IGBSdW5uZXIgJHtpbnB1dC5ydW5uZXJOYW1lfSBpcyBpZGxlIGZvciB0b28gbG9uZ2AsXG4gICAgICAgICAgICBpbnB1dCxcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBzdG9wIHN0ZXAgZnVuY3Rpb24gZmlyc3QsIHNvIGl0J3MgbWFya2VkIGFzIGFib3J0ZWQgd2l0aCB0aGUgcHJvcGVyIGVycm9yXG4gICAgICAgICAgICAvLyBpZiB3ZSBkZWxldGUgdGhlIHJ1bm5lciBmaXJzdCwgdGhlIHN0ZXAgZnVuY3Rpb24gd2lsbCBiZSBtYXJrZWQgYXMgZmFpbGVkIHdpdGggYSBnZW5lcmljIGVycm9yXG4gICAgICAgICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgICAgICAgIG5vdGljZTogYFN0b3BwaW5nIHN0ZXAgZnVuY3Rpb24gJHtpbnB1dC5leGVjdXRpb25Bcm59Li4uYCxcbiAgICAgICAgICAgICAgaW5wdXQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGF3YWl0IHNmbi5zZW5kKG5ldyBTdG9wRXhlY3V0aW9uQ29tbWFuZCh7XG4gICAgICAgICAgICAgIGV4ZWN1dGlvbkFybjogaW5wdXQuZXhlY3V0aW9uQXJuLFxuICAgICAgICAgICAgICBlcnJvcjogJ0lkbGVSdW5uZXInLFxuICAgICAgICAgICAgICBjYXVzZTogYFJ1bm5lciAke2lucHV0LnJ1bm5lck5hbWV9IG9uICR7aW5wdXQub3duZXJ9LyR7aW5wdXQucmVwb30gaXMgaWRsZSBmb3IgdG9vIGxvbmcgKCR7ZGlmZk1zIC8gMTAwMH0gc2Vjb25kcyBhbmQgbGltaXQgaXMgJHtpbnB1dC5tYXhJZGxlU2Vjb25kc30gc2Vjb25kcylgLFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgICAgICBub3RpY2U6IGBGYWlsZWQgdG8gc3RvcCBzdGVwIGZ1bmN0aW9uICR7aW5wdXQuZXhlY3V0aW9uQXJufTogJHtlfWAsXG4gICAgICAgICAgICAgIGlucHV0LFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZXRyeUxhdGVyKCk7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgICAgICBub3RpY2U6IGBEZWxldGluZyBydW5uZXIgJHtydW5uZXIuaWR9Li4uYCxcbiAgICAgICAgICAgICAgaW5wdXQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGF3YWl0IGRlbGV0ZVJ1bm5lcihvY3Rva2l0LCBzZWNyZXRzLnJ1bm5lckxldmVsLCBpbnB1dC5vd25lciwgaW5wdXQucmVwbywgcnVubmVyLmlkKTtcbiAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgICAgICAgICAgbm90aWNlOiBgRmFpbGVkIHRvIGRlbGV0ZSBydW5uZXIgJHtydW5uZXIuaWR9OiAke2V9YCxcbiAgICAgICAgICAgICAgaW5wdXQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHJ5TGF0ZXIoKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBzdGlsbCBpZGxlLCB0aW1lb3V0IG5vdCByZWFjaGVkIC0tIHJldHJ5IGxhdGVyXG4gICAgICAgICAgcmV0cnlMYXRlcigpO1xuICAgICAgICB9XG5cbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICAvLyBubyBzdGFydGVkIGxhYmVsPyByZXRyeSBsYXRlciAoaXQgd29uJ3QgcmV0cnkgZm9yZXZlciBhcyBldmVudHVhbGx5IHRoZSBydW5uZXIgd2lsbCBzdG9wIGFuZCB0aGUgc3RlcCBmdW5jdGlvbiB3aWxsIGZpbmlzaClcbiAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICBub3RpY2U6ICdObyBgY2RrZ2hyOnN0YXJ0ZWQ6eHh4YCBsYWJlbCBmb3VuZD8/PycsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICByZXRyeUxhdGVyKCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cbiJdfQ==