"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TRACKER_TTL_SECONDS = void 0;
exports.recordControlledJob = recordControlledJob;
exports.forgetControlledJob = forgetControlledJob;
exports.recordRunnerAccounted = recordRunnerAccounted;
exports.isRunnerAccounted = isRunnerAccounted;
exports.controlledJobRunnerLabels = controlledJobRunnerLabels;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
/**
 * The set of jobs we started a runner for.
 *
 * This is the entire state behind stolen runner detection. One item per job, written before its runner can exist,
 * expiring on its own, and deleted only if its runner is gone without ever getting a job. One item per runner that
 * we know the fate of, so we only check each one once. Nothing is updated, nothing is counted, and nothing needs
 * cleaning up.
 *
 * A job in here is a job we control. A job that isn't is a job we never agreed to serve, so a runner of ours
 * running it was taken from whoever we did start it for.
 *
 * @internal
 */
const ddb = new client_dynamodb_1.DynamoDBClient();
/**
 * Default time-to-live for job records in DynamoDB. GitHub jobs can wait up to 24 hours to get a runner. This adds some margin.
 *
 * If we accidentally provision a runner, that's expensive. Keeping a small record in DynamoDB for a few days is cheaper.
 *
 * @internal
 */
exports.DEFAULT_TRACKER_TTL_SECONDS = 3 * 24 * 60 * 60;
function tableName() {
    const table = process.env.RUNNER_TRACKER_TABLE;
    if (!table) {
        throw new Error('Missing RUNNER_TRACKER_TABLE environment variable');
    }
    return table;
}
function expiry() {
    const seconds = parseInt(process.env.RUNNER_TRACKER_TTL_SECONDS ?? `${exports.DEFAULT_TRACKER_TTL_SECONDS}`, 10);
    return Math.floor(Date.now() / 1000) + (isNaN(seconds) ? exports.DEFAULT_TRACKER_TTL_SECONDS : seconds);
}
/**
 * Remember that we started a runner for this job. Written before the step function starts, so it's always there by
 * the time GitHub could possibly hand the runner a job.
 *
 * Runner labels tell whether that runner can run another job of ours instead. The job URL is for whoever is reading the table during an
 * incident. TTL is used for cleanup.
 *
 * @internal
 */
async function recordControlledJob(input) {
    await ddb.send(new client_dynamodb_1.PutItemCommand({
        TableName: tableName(),
        Item: {
            pk: { S: `job#${input.jobId}` },
            jobUrl: { S: input.jobUrl },
            runnerLabels: { S: input.labels },
            ttl: { N: `${expiry()}` },
        },
    }));
}
/**
 * Forget we started a runner for this job. Used when we take that runner away before it ever got the job, so the job
 * no longer has a runner of ours. If one of our other runners picks it up later, that runner was stolen.
 *
 * @internal
 */
async function forgetControlledJob(jobId) {
    await ddb.send(new client_dynamodb_1.DeleteItemCommand({
        TableName: tableName(),
        Key: { pk: { S: `job#${jobId}` } },
    }));
}
/**
 * Remember that we know what happened to this runner's job. Either the runner reported a job, or the runner is gone and we already forgot
 * the job left without a runner because of it.
 *
 * @internal
 */
async function recordRunnerAccounted(runnerName, jobId) {
    await ddb.send(new client_dynamodb_1.PutItemCommand({
        TableName: tableName(),
        Item: {
            pk: { S: `runner#${runnerName}` },
            ttl: { N: `${expiry()}` },
            ...(jobId ? { jobId: { N: `${jobId}` } } : {}),
        },
    }));
}
/**
 * Do we know what happened to this runner's job?
 *
 * @internal
 */
async function isRunnerAccounted(runnerName) {
    const result = await ddb.send(new client_dynamodb_1.GetItemCommand({
        TableName: tableName(),
        Key: { pk: { S: `runner#${runnerName}` } },
        ConsistentRead: true,
    }));
    return !!result.Item;
}
/**
 * Labels of the runner we started for this job, or undefined if we didn't start one.
 *
 * @internal
 */
async function controlledJobRunnerLabels(jobId) {
    // consistent, because the job may have been recorded moments ago and reading a stale "no" would look like theft
    const result = await ddb.send(new client_dynamodb_1.GetItemCommand({
        TableName: tableName(),
        Key: { pk: { S: `job#${jobId}` } },
        ConsistentRead: true,
    }));
    return result.Item?.runnerLabels?.S?.split(',');
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXRyYWNrZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvbGFtYmRhLXRyYWNrZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBbUVBLGtEQVVDO0FBUUQsa0RBS0M7QUFRRCxzREFTQztBQU9ELDhDQVFDO0FBT0QsOERBU0M7QUExSUQsOERBQTZHO0FBRzdHOzs7Ozs7Ozs7Ozs7R0FZRztBQUVILE1BQU0sR0FBRyxHQUFHLElBQUksZ0NBQWMsRUFBRSxDQUFDO0FBRWpDOzs7Ozs7R0FNRztBQUNVLFFBQUEsMkJBQTJCLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDO0FBbUI1RCxTQUFTLFNBQVM7SUFDaEIsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQztJQUMvQyxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDWCxNQUFNLElBQUksS0FBSyxDQUFDLG1EQUFtRCxDQUFDLENBQUM7SUFDdkUsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQUVELFNBQVMsTUFBTTtJQUNiLE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixJQUFJLEdBQUcsbUNBQTJCLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUN6RyxPQUFPLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxtQ0FBMkIsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUM7QUFDbEcsQ0FBQztBQUVEOzs7Ozs7OztHQVFHO0FBQ0ksS0FBSyxVQUFVLG1CQUFtQixDQUFDLEtBQXdCO0lBQ2hFLE1BQU0sR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLGdDQUFjLENBQUM7UUFDaEMsU0FBUyxFQUFFLFNBQVMsRUFBRTtRQUN0QixJQUFJLEVBQUU7WUFDSixFQUFFLEVBQUUsRUFBRSxDQUFDLEVBQUUsT0FBTyxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUU7WUFDL0IsTUFBTSxFQUFFLEVBQUUsQ0FBQyxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUU7WUFDM0IsWUFBWSxFQUFFLEVBQUUsQ0FBQyxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUU7WUFDakMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxFQUFFLEdBQUcsTUFBTSxFQUFFLEVBQUUsRUFBRTtTQUMxQjtLQUNGLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0ksS0FBSyxVQUFVLG1CQUFtQixDQUFDLEtBQWE7SUFDckQsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksbUNBQWlCLENBQUM7UUFDbkMsU0FBUyxFQUFFLFNBQVMsRUFBRTtRQUN0QixHQUFHLEVBQUUsRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLEVBQUUsT0FBTyxLQUFLLEVBQUUsRUFBRSxFQUFFO0tBQ25DLENBQUMsQ0FBQyxDQUFDO0FBQ04sQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0ksS0FBSyxVQUFVLHFCQUFxQixDQUFDLFVBQWtCLEVBQUUsS0FBYztJQUM1RSxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxnQ0FBYyxDQUFDO1FBQ2hDLFNBQVMsRUFBRSxTQUFTLEVBQUU7UUFDdEIsSUFBSSxFQUFFO1lBQ0osRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLFVBQVUsVUFBVSxFQUFFLEVBQUU7WUFDakMsR0FBRyxFQUFFLEVBQUUsQ0FBQyxFQUFFLEdBQUcsTUFBTSxFQUFFLEVBQUUsRUFBRTtZQUN6QixHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsRUFBRSxHQUFHLEtBQUssRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1NBQy9DO0tBQ0YsQ0FBQyxDQUFDLENBQUM7QUFDTixDQUFDO0FBRUQ7Ozs7R0FJRztBQUNJLEtBQUssVUFBVSxpQkFBaUIsQ0FBQyxVQUFrQjtJQUN4RCxNQUFNLE1BQU0sR0FBRyxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxnQ0FBYyxDQUFDO1FBQy9DLFNBQVMsRUFBRSxTQUFTLEVBQUU7UUFDdEIsR0FBRyxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLFVBQVUsVUFBVSxFQUFFLEVBQUUsRUFBRTtRQUMxQyxjQUFjLEVBQUUsSUFBSTtLQUNyQixDQUFDLENBQUMsQ0FBQztJQUVKLE9BQU8sQ0FBQyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUM7QUFDdkIsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSSxLQUFLLFVBQVUseUJBQXlCLENBQUMsS0FBYTtJQUMzRCxnSEFBZ0g7SUFDaEgsTUFBTSxNQUFNLEdBQUcsTUFBTSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksZ0NBQWMsQ0FBQztRQUMvQyxTQUFTLEVBQUUsU0FBUyxFQUFFO1FBQ3RCLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRSxPQUFPLEtBQUssRUFBRSxFQUFFLEVBQUU7UUFDbEMsY0FBYyxFQUFFLElBQUk7S0FDckIsQ0FBQyxDQUFDLENBQUM7SUFFSixPQUFPLE1BQU0sQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFLENBQUMsRUFBRSxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUM7QUFDbEQsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERlbGV0ZUl0ZW1Db21tYW5kLCBEeW5hbW9EQkNsaWVudCwgR2V0SXRlbUNvbW1hbmQsIFB1dEl0ZW1Db21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWR5bmFtb2RiJztcbmltcG9ydCB7IE9yY2hlc3RyYXRvcklucHV0IH0gZnJvbSAnLi9sYW1iZGEtY29tbW9uJztcblxuLyoqXG4gKiBUaGUgc2V0IG9mIGpvYnMgd2Ugc3RhcnRlZCBhIHJ1bm5lciBmb3IuXG4gKlxuICogVGhpcyBpcyB0aGUgZW50aXJlIHN0YXRlIGJlaGluZCBzdG9sZW4gcnVubmVyIGRldGVjdGlvbi4gT25lIGl0ZW0gcGVyIGpvYiwgd3JpdHRlbiBiZWZvcmUgaXRzIHJ1bm5lciBjYW4gZXhpc3QsXG4gKiBleHBpcmluZyBvbiBpdHMgb3duLCBhbmQgZGVsZXRlZCBvbmx5IGlmIGl0cyBydW5uZXIgaXMgZ29uZSB3aXRob3V0IGV2ZXIgZ2V0dGluZyBhIGpvYi4gT25lIGl0ZW0gcGVyIHJ1bm5lciB0aGF0XG4gKiB3ZSBrbm93IHRoZSBmYXRlIG9mLCBzbyB3ZSBvbmx5IGNoZWNrIGVhY2ggb25lIG9uY2UuIE5vdGhpbmcgaXMgdXBkYXRlZCwgbm90aGluZyBpcyBjb3VudGVkLCBhbmQgbm90aGluZyBuZWVkc1xuICogY2xlYW5pbmcgdXAuXG4gKlxuICogQSBqb2IgaW4gaGVyZSBpcyBhIGpvYiB3ZSBjb250cm9sLiBBIGpvYiB0aGF0IGlzbid0IGlzIGEgam9iIHdlIG5ldmVyIGFncmVlZCB0byBzZXJ2ZSwgc28gYSBydW5uZXIgb2Ygb3Vyc1xuICogcnVubmluZyBpdCB3YXMgdGFrZW4gZnJvbSB3aG9ldmVyIHdlIGRpZCBzdGFydCBpdCBmb3IuXG4gKlxuICogQGludGVybmFsXG4gKi9cblxuY29uc3QgZGRiID0gbmV3IER5bmFtb0RCQ2xpZW50KCk7XG5cbi8qKlxuICogRGVmYXVsdCB0aW1lLXRvLWxpdmUgZm9yIGpvYiByZWNvcmRzIGluIER5bmFtb0RCLiBHaXRIdWIgam9icyBjYW4gd2FpdCB1cCB0byAyNCBob3VycyB0byBnZXQgYSBydW5uZXIuIFRoaXMgYWRkcyBzb21lIG1hcmdpbi5cbiAqXG4gKiBJZiB3ZSBhY2NpZGVudGFsbHkgcHJvdmlzaW9uIGEgcnVubmVyLCB0aGF0J3MgZXhwZW5zaXZlLiBLZWVwaW5nIGEgc21hbGwgcmVjb3JkIGluIER5bmFtb0RCIGZvciBhIGZldyBkYXlzIGlzIGNoZWFwZXIuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjb25zdCBERUZBVUxUX1RSQUNLRVJfVFRMX1NFQ09ORFMgPSAzICogMjQgKiA2MCAqIDYwO1xuXG4vKipcbiAqIEEgcnVubmVyIHRvbGQgdXMgaXQgcGlja2VkIHVwIGEgam9iLiBTZW50IGJ5IHRoZSBydW5uZXJzIHRoZW1zZWx2ZXMsIGZyb20gYSBqb2Igc3RhcnRlZCBob29rLCBhbmQgcmVhZCBvdXQgb2ZcbiAqIHRoZWlyIGxvZ3MuIEFsc28gc2VudCBieSB0aGUgd2ViaG9vayBoYW5kbGVyIGZvciB3b3JrZmxvd19qb2IuaW5fcHJvZ3Jlc3MgZXZlbnRzLlxuICpcbiAqIEdpdEh1YiBuZXZlciB0ZWxscyBhIHJ1bm5lciB3aGljaCBqb2IgaXQncyBydW5uaW5nLCBzbyB0aGlzIGNhcnJpZXMgdGhlIHdvcmtmbG93IHJ1biBpbnN0ZWFkLiBDb21iaW5lZCB3aXRoIHRoZVxuICogcnVubmVyIG5hbWUgaXQncyBlbm91Z2ggdG8gYXNrIEdpdEh1YiBmb3IgdGhlIGpvYiBpZC5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBSdW5uZXJSZXBvcnRNZXNzYWdlIHtcbiAgcmVhZG9ubHkga2luZDogJ3JlcG9ydCc7XG4gIHJlYWRvbmx5IHJ1bm5lck5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVwbzogc3RyaW5nO1xuICByZWFkb25seSB3b3JrZmxvd0lkOiBudW1iZXI7XG4gIHJlYWRvbmx5IGpvYklkPzogbnVtYmVyOyAvLyBjb21lcyBPTkxZIGZyb20gd29ya2Zsb3dfam9iLmluX3Byb2dyZXNzIHdlYmhvb2tcbn1cblxuZnVuY3Rpb24gdGFibGVOYW1lKCk6IHN0cmluZyB7XG4gIGNvbnN0IHRhYmxlID0gcHJvY2Vzcy5lbnYuUlVOTkVSX1RSQUNLRVJfVEFCTEU7XG4gIGlmICghdGFibGUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ01pc3NpbmcgUlVOTkVSX1RSQUNLRVJfVEFCTEUgZW52aXJvbm1lbnQgdmFyaWFibGUnKTtcbiAgfVxuICByZXR1cm4gdGFibGU7XG59XG5cbmZ1bmN0aW9uIGV4cGlyeSgpOiBudW1iZXIge1xuICBjb25zdCBzZWNvbmRzID0gcGFyc2VJbnQocHJvY2Vzcy5lbnYuUlVOTkVSX1RSQUNLRVJfVFRMX1NFQ09ORFMgPz8gYCR7REVGQVVMVF9UUkFDS0VSX1RUTF9TRUNPTkRTfWAsIDEwKTtcbiAgcmV0dXJuIE1hdGguZmxvb3IoRGF0ZS5ub3coKSAvIDEwMDApICsgKGlzTmFOKHNlY29uZHMpID8gREVGQVVMVF9UUkFDS0VSX1RUTF9TRUNPTkRTIDogc2Vjb25kcyk7XG59XG5cbi8qKlxuICogUmVtZW1iZXIgdGhhdCB3ZSBzdGFydGVkIGEgcnVubmVyIGZvciB0aGlzIGpvYi4gV3JpdHRlbiBiZWZvcmUgdGhlIHN0ZXAgZnVuY3Rpb24gc3RhcnRzLCBzbyBpdCdzIGFsd2F5cyB0aGVyZSBieVxuICogdGhlIHRpbWUgR2l0SHViIGNvdWxkIHBvc3NpYmx5IGhhbmQgdGhlIHJ1bm5lciBhIGpvYi5cbiAqXG4gKiBSdW5uZXIgbGFiZWxzIHRlbGwgd2hldGhlciB0aGF0IHJ1bm5lciBjYW4gcnVuIGFub3RoZXIgam9iIG9mIG91cnMgaW5zdGVhZC4gVGhlIGpvYiBVUkwgaXMgZm9yIHdob2V2ZXIgaXMgcmVhZGluZyB0aGUgdGFibGUgZHVyaW5nIGFuXG4gKiBpbmNpZGVudC4gVFRMIGlzIHVzZWQgZm9yIGNsZWFudXAuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvcmRDb250cm9sbGVkSm9iKGlucHV0OiBPcmNoZXN0cmF0b3JJbnB1dCkge1xuICBhd2FpdCBkZGIuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogdGFibGVOYW1lKCksXG4gICAgSXRlbToge1xuICAgICAgcGs6IHsgUzogYGpvYiMke2lucHV0LmpvYklkfWAgfSxcbiAgICAgIGpvYlVybDogeyBTOiBpbnB1dC5qb2JVcmwgfSxcbiAgICAgIHJ1bm5lckxhYmVsczogeyBTOiBpbnB1dC5sYWJlbHMgfSxcbiAgICAgIHR0bDogeyBOOiBgJHtleHBpcnkoKX1gIH0sXG4gICAgfSxcbiAgfSkpO1xufVxuXG4vKipcbiAqIEZvcmdldCB3ZSBzdGFydGVkIGEgcnVubmVyIGZvciB0aGlzIGpvYi4gVXNlZCB3aGVuIHdlIHRha2UgdGhhdCBydW5uZXIgYXdheSBiZWZvcmUgaXQgZXZlciBnb3QgdGhlIGpvYiwgc28gdGhlIGpvYlxuICogbm8gbG9uZ2VyIGhhcyBhIHJ1bm5lciBvZiBvdXJzLiBJZiBvbmUgb2Ygb3VyIG90aGVyIHJ1bm5lcnMgcGlja3MgaXQgdXAgbGF0ZXIsIHRoYXQgcnVubmVyIHdhcyBzdG9sZW4uXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmb3JnZXRDb250cm9sbGVkSm9iKGpvYklkOiBudW1iZXIpIHtcbiAgYXdhaXQgZGRiLnNlbmQobmV3IERlbGV0ZUl0ZW1Db21tYW5kKHtcbiAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSgpLFxuICAgIEtleTogeyBwazogeyBTOiBgam9iIyR7am9iSWR9YCB9IH0sXG4gIH0pKTtcbn1cblxuLyoqXG4gKiBSZW1lbWJlciB0aGF0IHdlIGtub3cgd2hhdCBoYXBwZW5lZCB0byB0aGlzIHJ1bm5lcidzIGpvYi4gRWl0aGVyIHRoZSBydW5uZXIgcmVwb3J0ZWQgYSBqb2IsIG9yIHRoZSBydW5uZXIgaXMgZ29uZSBhbmQgd2UgYWxyZWFkeSBmb3Jnb3RcbiAqIHRoZSBqb2IgbGVmdCB3aXRob3V0IGEgcnVubmVyIGJlY2F1c2Ugb2YgaXQuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvcmRSdW5uZXJBY2NvdW50ZWQocnVubmVyTmFtZTogc3RyaW5nLCBqb2JJZD86IG51bWJlcikge1xuICBhd2FpdCBkZGIuc2VuZChuZXcgUHV0SXRlbUNvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogdGFibGVOYW1lKCksXG4gICAgSXRlbToge1xuICAgICAgcGs6IHsgUzogYHJ1bm5lciMke3J1bm5lck5hbWV9YCB9LFxuICAgICAgdHRsOiB7IE46IGAke2V4cGlyeSgpfWAgfSxcbiAgICAgIC4uLihqb2JJZCA/IHsgam9iSWQ6IHsgTjogYCR7am9iSWR9YCB9IH0gOiB7fSksXG4gICAgfSxcbiAgfSkpO1xufVxuXG4vKipcbiAqIERvIHdlIGtub3cgd2hhdCBoYXBwZW5lZCB0byB0aGlzIHJ1bm5lcidzIGpvYj9cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGlzUnVubmVyQWNjb3VudGVkKHJ1bm5lck5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCByZXN1bHQgPSBhd2FpdCBkZGIuc2VuZChuZXcgR2V0SXRlbUNvbW1hbmQoe1xuICAgIFRhYmxlTmFtZTogdGFibGVOYW1lKCksXG4gICAgS2V5OiB7IHBrOiB7IFM6IGBydW5uZXIjJHtydW5uZXJOYW1lfWAgfSB9LFxuICAgIENvbnNpc3RlbnRSZWFkOiB0cnVlLFxuICB9KSk7XG5cbiAgcmV0dXJuICEhcmVzdWx0Lkl0ZW07XG59XG5cbi8qKlxuICogTGFiZWxzIG9mIHRoZSBydW5uZXIgd2Ugc3RhcnRlZCBmb3IgdGhpcyBqb2IsIG9yIHVuZGVmaW5lZCBpZiB3ZSBkaWRuJ3Qgc3RhcnQgb25lLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29udHJvbGxlZEpvYlJ1bm5lckxhYmVscyhqb2JJZDogbnVtYmVyKTogUHJvbWlzZTxzdHJpbmdbXSB8IHVuZGVmaW5lZD4ge1xuICAvLyBjb25zaXN0ZW50LCBiZWNhdXNlIHRoZSBqb2IgbWF5IGhhdmUgYmVlbiByZWNvcmRlZCBtb21lbnRzIGFnbyBhbmQgcmVhZGluZyBhIHN0YWxlIFwibm9cIiB3b3VsZCBsb29rIGxpa2UgdGhlZnRcbiAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGRiLnNlbmQobmV3IEdldEl0ZW1Db21tYW5kKHtcbiAgICBUYWJsZU5hbWU6IHRhYmxlTmFtZSgpLFxuICAgIEtleTogeyBwazogeyBTOiBgam9iIyR7am9iSWR9YCB9IH0sXG4gICAgQ29uc2lzdGVudFJlYWQ6IHRydWUsXG4gIH0pKTtcblxuICByZXR1cm4gcmVzdWx0Lkl0ZW0/LnJ1bm5lckxhYmVscz8uUz8uc3BsaXQoJywnKTtcbn1cbiJdfQ==