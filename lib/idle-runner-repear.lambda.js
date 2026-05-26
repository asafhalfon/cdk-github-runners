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
            runnerName: input.runnerName,
            input,
        });
        const retryLater = () => result.batchItemFailures.push({ itemIdentifier: record.messageId });
        // check if step function is still running
        const execution = await sfn.send(new client_sfn_1.DescribeExecutionCommand({ executionArn: input.executionArn }));
        if (execution.status != 'RUNNING') {
            // no need to test again as runner already finished
            console.log({
                notice: 'Runner already finished',
                runnerName: input.runnerName,
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
            console.log({
                notice: 'Runner is not idle',
                runnerId: runner.id,
                runnerName: input.runnerName,
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
                    notice: 'Runner is idle',
                    runnerId: runner.id,
                    runnerName: input.runnerName,
                    idleSeconds: diffMs / 1000,
                    input,
                });
                if (diffMs > 1000 * input.maxIdleSeconds) {
                    // max idle time reached, delete runner
                    console.log({
                        notice: 'Runner is idle for too long',
                        runnerId: runner.id,
                        runnerName: input.runnerName,
                        idleSeconds: diffMs / 1000,
                        maxIdleSeconds: input.maxIdleSeconds,
                        input,
                    });
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
                            cause: `Runner ${input.runnerName} on ${input.owner}/${input.repo} is idle for too long (${diffMs / 1000} seconds and limit is ${input.maxIdleSeconds} seconds)`,
                        }));
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
                runnerId: runner.id,
                runnerName: input.runnerName,
                input,
            });
            retryLater();
        }
    }
    return result;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaWRsZS1ydW5uZXItcmVwZWFyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9pZGxlLXJ1bm5lci1yZXBlYXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZ0JBLDBCQXVLQztBQXZMRCxvREFBZ0c7QUFHaEcsbURBQXFGO0FBV3JGLE1BQU0sR0FBRyxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO0FBRXJCLEtBQUssVUFBVSxPQUFPLENBQUMsS0FBeUI7SUFDckQsTUFBTSxNQUFNLEdBQStCLEVBQUUsaUJBQWlCLEVBQUUsRUFBRSxFQUFFLENBQUM7SUFDckUsTUFBTSxZQUFZLEdBQUcsSUFBSSxHQUFHLEVBQW9FLENBQUM7SUFFakcsS0FBSyxNQUFNLE1BQU0sSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDbkMsTUFBTSxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUEwQixDQUFDO1FBQy9ELE9BQU8sQ0FBQyxHQUFHLENBQUM7WUFDVixNQUFNLEVBQUUsaUJBQWlCO1lBQ3pCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtZQUM1QixLQUFLO1NBQ04sQ0FBQyxDQUFDO1FBRUgsTUFBTSxVQUFVLEdBQUcsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxFQUFFLGNBQWMsRUFBRSxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUU3RiwwQ0FBMEM7UUFDMUMsTUFBTSxTQUFTLEdBQUcsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUkscUNBQXdCLENBQUMsRUFBRSxZQUFZLEVBQUUsS0FBSyxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUMsQ0FBQztRQUNyRyxJQUFJLFNBQVMsQ0FBQyxNQUFNLElBQUksU0FBUyxFQUFFLENBQUM7WUFDbEMsbURBQW1EO1lBQ25ELE9BQU8sQ0FBQyxHQUFHLENBQUM7Z0JB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TSxDQUFDLEVBQUU7Z0JBQ25CLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtnQkFDNUIsS0FBSzthQUNOLENBQUMsQ0FBQztZQUNILFVBQVUsRUFBRSxDQUFDO1FBQ2YsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLE1BQU0sQ0FBQztBQUNoQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRGVzY3JpYmVFeGVjdXRpb25Db21tYW5kLCBTRk5DbGllbnQsIFN0b3BFeGVjdXRpb25Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNmbic7XG5pbXBvcnQgdHlwZSB7IE9jdG9raXQgfSBmcm9tICdAb2N0b2tpdC9yZXN0JztcbmltcG9ydCAqIGFzIEFXU0xhbWJkYSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGRlbGV0ZVJ1bm5lciwgZ2V0T2N0b2tpdCwgZ2V0UnVubmVyLCBHaXRIdWJTZWNyZXRzIH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcblxuaW50ZXJmYWNlIElkbGVSZWFwZXJMYW1iZGFJbnB1dCB7XG4gIHJlYWRvbmx5IGV4ZWN1dGlvbkFybjogc3RyaW5nO1xuICByZWFkb25seSBydW5uZXJOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IG93bmVyOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJlcG86IHN0cmluZztcbiAgcmVhZG9ubHkgaW5zdGFsbGF0aW9uSWQ/OiBudW1iZXI7XG4gIHJlYWRvbmx5IG1heElkbGVTZWNvbmRzOiBudW1iZXI7XG59XG5cbmNvbnN0IHNmbiA9IG5ldyBTRk5DbGllbnQoKTtcblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQ6IEFXU0xhbWJkYS5TUVNFdmVudCk6IFByb21pc2U8QVdTTGFtYmRhLlNRU0JhdGNoUmVzcG9uc2U+IHtcbiAgY29uc3QgcmVzdWx0OiBBV1NMYW1iZGEuU1FTQmF0Y2hSZXNwb25zZSA9IHsgYmF0Y2hJdGVtRmFpbHVyZXM6IFtdIH07XG4gIGNvbnN0IG9jdG9raXRDYWNoZSA9IG5ldyBNYXA8bnVtYmVyIHwgdW5kZWZpbmVkLCB7IG9jdG9raXQ6IE9jdG9raXQ7IHNlY3JldHM6IEdpdEh1YlNlY3JldHMgfT4oKTtcblxuICBmb3IgKGNvbnN0IHJlY29yZCBvZiBldmVudC5SZWNvcmRzKSB7XG4gICAgY29uc3QgaW5wdXQgPSBKU09OLnBhcnNlKHJlY29yZC5ib2R5KSBhcyBJZGxlUmVhcGVyTGFtYmRhSW5wdXQ7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnQ2hlY2tpbmcgcnVubmVyJyxcbiAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICBpbnB1dCxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJldHJ5TGF0ZXIgPSAoKSA9PiByZXN1bHQuYmF0Y2hJdGVtRmFpbHVyZXMucHVzaCh7IGl0ZW1JZGVudGlmaWVyOiByZWNvcmQubWVzc2FnZUlkIH0pO1xuXG4gICAgLy8gY2hlY2sgaWYgc3RlcCBmdW5jdGlvbiBpcyBzdGlsbCBydW5uaW5nXG4gICAgY29uc3QgZXhlY3V0aW9uID0gYXdhaXQgc2ZuLnNlbmQobmV3IERlc2NyaWJlRXhlY3V0aW9uQ29tbWFuZCh7IGV4ZWN1dGlvbkFybjogaW5wdXQuZXhlY3V0aW9uQXJuIH0pKTtcbiAgICBpZiAoZXhlY3V0aW9uLnN0YXR1cyAhPSAnUlVOTklORycpIHtcbiAgICAgIC8vIG5vIG5lZWQgdG8gdGVzdCBhZ2FpbiBhcyBydW5uZXIgYWxyZWFkeSBmaW5pc2hlZFxuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdSdW5uZXIgYWxyZWFkeSBmaW5pc2hlZCcsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBnZXQgZ2l0aHViIGFjY2Vzc1xuICAgIGxldCBvY3Rva2l0OiBPY3Rva2l0O1xuICAgIGxldCBzZWNyZXRzOiBHaXRIdWJTZWNyZXRzO1xuICAgIGNvbnN0IGNhY2hlZCA9IG9jdG9raXRDYWNoZS5nZXQoaW5wdXQuaW5zdGFsbGF0aW9uSWQpO1xuICAgIGlmIChjYWNoZWQpIHtcbiAgICAgIC8vIHVzZSBjYWNoZWQgb2N0b2tpdFxuICAgICAgb2N0b2tpdCA9IGNhY2hlZC5vY3Rva2l0O1xuICAgICAgc2VjcmV0cyA9IGNhY2hlZC5zZWNyZXRzO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBnZXRPY3Rva2l0IGNhbGxzIHNlY3JldHMgbWFuYWdlciBhbmQgR2l0aHViIEFQSSBldmVyeSB0aW1lLCBzbyBjYWNoZSB0aGUgcmVzdWx0XG4gICAgICAvLyB0aGlzIGhhbmRsZXIgY2FuIHdvcmsgb24gbXVsdGlwbGUgcnVubmVycyBhdCBvbmNlLCBzbyBjYWNoaW5nIGlzIGltcG9ydGFudFxuICAgICAgY29uc3QgeyBvY3Rva2l0OiBuZXdPY3Rva2l0LCBnaXRodWJTZWNyZXRzOiBuZXdTZWNyZXRzIH0gPSBhd2FpdCBnZXRPY3Rva2l0KGlucHV0Lmluc3RhbGxhdGlvbklkKTtcbiAgICAgIG9jdG9raXQgPSBuZXdPY3Rva2l0O1xuICAgICAgc2VjcmV0cyA9IG5ld1NlY3JldHM7XG4gICAgICBvY3Rva2l0Q2FjaGUuc2V0KGlucHV0Lmluc3RhbGxhdGlvbklkLCB7IG9jdG9raXQsIHNlY3JldHMgfSk7XG4gICAgfVxuXG4gICAgLy8gZmluZCBydW5uZXJcbiAgICBjb25zdCBydW5uZXIgPSBhd2FpdCBnZXRSdW5uZXIob2N0b2tpdCwgc2VjcmV0cy5ydW5uZXJMZXZlbCwgaW5wdXQub3duZXIsIGlucHV0LnJlcG8sIGlucHV0LnJ1bm5lck5hbWUpO1xuICAgIGlmICghcnVubmVyKSB7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1J1bm5lciBub3QgcnVubmluZyB5ZXQnLFxuICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICBpbnB1dCxcbiAgICAgIH0pO1xuICAgICAgcmV0cnlMYXRlcigpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gaWYgbm90IGlkbGUsIHRyeSBhZ2FpbiBsYXRlclxuICAgIC8vIHdlIHdhbnQgdG8gdHJ5IGFnYWluIGJlY2F1c2UgdGhlIHJ1bm5lciBtaWdodCBiZSByZXRyaWVkIGR1ZSB0byBlLmcuIGxhbWJkYSB0aW1lb3V0XG4gICAgLy8gd2UgbmVlZCB0byBrZWVwIGZvbGxvd2luZyB0aGUgcmV0cnkgdG9vIGFuZCBtYWtlIHN1cmUgaXQgZG9lc24ndCBnbyBpZGxlXG4gICAgaWYgKHJ1bm5lci5idXN5KSB7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1J1bm5lciBpcyBub3QgaWRsZScsXG4gICAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICByZXRyeUxhdGVyKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBjaGVjayBpZiBtYXggaWRsZSB0aW1lb3V0IGhhcyByZWFjaGVkXG4gICAgbGV0IGZvdW5kID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBsYWJlbCBvZiBydW5uZXIubGFiZWxzKSB7XG4gICAgICBpZiAobGFiZWwubmFtZS50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgoJ2Nka2docjpzdGFydGVkOicpKSB7XG4gICAgICAgIGNvbnN0IHN0YXJ0ZWQgPSBwYXJzZUZsb2F0KGxhYmVsLm5hbWUuc3BsaXQoJzonKVsyXSk7XG4gICAgICAgIGNvbnN0IHN0YXJ0ZWREYXRlID0gbmV3IERhdGUoc3RhcnRlZCAqIDEwMDApO1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpO1xuICAgICAgICBjb25zdCBkaWZmTXMgPSBub3cuZ2V0VGltZSgpIC0gc3RhcnRlZERhdGUuZ2V0VGltZSgpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgICBub3RpY2U6ICdSdW5uZXIgaXMgaWRsZScsXG4gICAgICAgICAgcnVubmVySWQ6IHJ1bm5lci5pZCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICAgIGlkbGVTZWNvbmRzOiBkaWZmTXMgLyAxMDAwLFxuICAgICAgICAgIGlucHV0LFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAoZGlmZk1zID4gMTAwMCAqIGlucHV0Lm1heElkbGVTZWNvbmRzKSB7XG4gICAgICAgICAgLy8gbWF4IGlkbGUgdGltZSByZWFjaGVkLCBkZWxldGUgcnVubmVyXG4gICAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgICAgbm90aWNlOiAnUnVubmVyIGlzIGlkbGUgZm9yIHRvbyBsb25nJyxcbiAgICAgICAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICAgICAgaWRsZVNlY29uZHM6IGRpZmZNcyAvIDEwMDAsXG4gICAgICAgICAgICBtYXhJZGxlU2Vjb25kczogaW5wdXQubWF4SWRsZVNlY29uZHMsXG4gICAgICAgICAgICBpbnB1dCxcbiAgICAgICAgICB9KTtcblxuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBzdG9wIHN0ZXAgZnVuY3Rpb24gZmlyc3QsIHNvIGl0J3MgbWFya2VkIGFzIGFib3J0ZWQgd2l0aCB0aGUgcHJvcGVyIGVycm9yXG4gICAgICAgICAgICAvLyBpZiB3ZSBkZWxldGUgdGhlIHJ1bm5lciBmaXJzdCwgdGhlIHN0ZXAgZnVuY3Rpb24gd2lsbCBiZSBtYXJrZWQgYXMgZmFpbGVkIHdpdGggYSBnZW5lcmljIGVycm9yXG4gICAgICAgICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgICAgICAgIG5vdGljZTogJ1N0b3BwaW5nIHN0ZXAgZnVuY3Rpb24nLFxuICAgICAgICAgICAgICBleGVjdXRpb25Bcm46IGlucHV0LmV4ZWN1dGlvbkFybixcbiAgICAgICAgICAgICAgcnVubmVySWQ6IHJ1bm5lci5pZCxcbiAgICAgICAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgICAgICAgaW5wdXQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGF3YWl0IHNmbi5zZW5kKG5ldyBTdG9wRXhlY3V0aW9uQ29tbWFuZCh7XG4gICAgICAgICAgICAgIGV4ZWN1dGlvbkFybjogaW5wdXQuZXhlY3V0aW9uQXJuLFxuICAgICAgICAgICAgICBlcnJvcjogJ0lkbGVSdW5uZXInLFxuICAgICAgICAgICAgICBjYXVzZTogYFJ1bm5lciAke2lucHV0LnJ1bm5lck5hbWV9IG9uICR7aW5wdXQub3duZXJ9LyR7aW5wdXQucmVwb30gaXMgaWRsZSBmb3IgdG9vIGxvbmcgKCR7ZGlmZk1zIC8gMTAwMH0gc2Vjb25kcyBhbmQgbGltaXQgaXMgJHtpbnB1dC5tYXhJZGxlU2Vjb25kc30gc2Vjb25kcylgLFxuICAgICAgICAgICAgfSkpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICAgICAgICBub3RpY2U6ICdGYWlsZWQgdG8gc3RvcCBzdGVwIGZ1bmN0aW9uJyxcbiAgICAgICAgICAgICAgZXhlY3V0aW9uQXJuOiBpbnB1dC5leGVjdXRpb25Bcm4sXG4gICAgICAgICAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICAgICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgICAgICAgIGVycm9yOiBlLFxuICAgICAgICAgICAgICBpbnB1dCxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0cnlMYXRlcigpO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgICAgICAgbm90aWNlOiAnRGVsZXRpbmcgcnVubmVyJyxcbiAgICAgICAgICAgICAgcnVubmVySWQ6IHJ1bm5lci5pZCxcbiAgICAgICAgICAgICAgcnVubmVyTmFtZTogaW5wdXQucnVubmVyTmFtZSxcbiAgICAgICAgICAgICAgaW5wdXQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGF3YWl0IGRlbGV0ZVJ1bm5lcihvY3Rva2l0LCBzZWNyZXRzLnJ1bm5lckxldmVsLCBpbnB1dC5vd25lciwgaW5wdXQucmVwbywgcnVubmVyLmlkKTtcbiAgICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgICAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIGRlbGV0ZSBydW5uZXInLFxuICAgICAgICAgICAgICBydW5uZXJJZDogcnVubmVyLmlkLFxuICAgICAgICAgICAgICBydW5uZXJOYW1lOiBpbnB1dC5ydW5uZXJOYW1lLFxuICAgICAgICAgICAgICBlcnJvcjogZSxcbiAgICAgICAgICAgICAgaW5wdXQsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJldHJ5TGF0ZXIoKTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBzdGlsbCBpZGxlLCB0aW1lb3V0IG5vdCByZWFjaGVkIC0tIHJldHJ5IGxhdGVyXG4gICAgICAgICAgcmV0cnlMYXRlcigpO1xuICAgICAgICB9XG5cbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICAvLyBubyBzdGFydGVkIGxhYmVsPyByZXRyeSBsYXRlciAoaXQgd29uJ3QgcmV0cnkgZm9yZXZlciBhcyBldmVudHVhbGx5IHRoZSBydW5uZXIgd2lsbCBzdG9wIGFuZCB0aGUgc3RlcCBmdW5jdGlvbiB3aWxsIGZpbmlzaClcbiAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICBub3RpY2U6ICdObyBgY2RrZ2hyOnN0YXJ0ZWQ6eHh4YCBsYWJlbCBmb3VuZD8/PycsXG4gICAgICAgIHJ1bm5lcklkOiBydW5uZXIuaWQsXG4gICAgICAgIHJ1bm5lck5hbWU6IGlucHV0LnJ1bm5lck5hbWUsXG4gICAgICAgIGlucHV0LFxuICAgICAgfSk7XG4gICAgICByZXRyeUxhdGVyKCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn1cbiJdfQ==