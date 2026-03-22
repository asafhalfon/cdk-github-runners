"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearFailuresCache = clearFailuresCache;
exports.handler = handler;
const lambda_github_1 = require("./lambda-github");
/**
 * Get webhook delivery failures since the last processed delivery ID.
 *
 * @internal
 */
async function newDeliveryFailures(octokit, sinceId) {
    const deliveries = new Map();
    const successfulDeliveries = new Set();
    const timeLimitMs = 1000 * 60 * 30; // don't look at deliveries over 30 minutes old
    let lastId = 0n;
    let processedCount = 0;
    for await (const response of octokit.paginate.iterator('GET /app/hook/deliveries')) {
        if (response.status !== 200) {
            throw new Error('Failed to fetch webhook deliveries');
        }
        for (const delivery of response.data) {
            const deliveryId = BigInt(delivery.id);
            const deliveredAt = new Date(delivery.delivered_at);
            const success = delivery.status === 'OK';
            if (deliveryId <= sinceId) {
                // stop processing if we reach the last processed delivery ID
                console.info({
                    notice: 'Reached last processed delivery ID',
                    sinceId: String(sinceId),
                    deliveryId: String(deliveryId),
                    guid: delivery.guid,
                    processedCount,
                });
                return { deliveries, lastId };
            }
            lastId = deliveryId > lastId ? deliveryId : lastId;
            if (deliveredAt.getTime() < Date.now() - timeLimitMs) {
                // stop processing if the delivery is too old (for first iteration and performance of further iterations)
                console.info({
                    notice: 'Stopping at old delivery',
                    deliveryId: String(deliveryId),
                    guid: delivery.guid,
                    deliveredAt: deliveredAt,
                    processedCount,
                });
                return { deliveries, lastId };
            }
            console.debug({
                notice: 'Processing webhook delivery',
                deliveryId: String(deliveryId),
                guid: delivery.guid,
                status: delivery.status,
                deliveredAt: delivery.delivered_at,
                redelivery: delivery.redelivery,
            });
            processedCount++;
            if (success) {
                successfulDeliveries.add(delivery.guid);
                continue;
            }
            if (successfulDeliveries.has(delivery.guid)) {
                // do not redeliver deliveries that were already successful
                continue;
            }
            deliveries.set(delivery.guid, { id: deliveryId, deliveredAt, redelivery: delivery.redelivery });
        }
    }
    console.info({
        notice: 'No more webhook deliveries to process',
        deliveryId: 'DONE',
        guid: 'DONE',
        deliveredAt: 'DONE',
        processedCount,
    });
    return { deliveries, lastId };
}
let lastDeliveryIdProcessed = 0n;
const failures = new Map();
/**
 * Clear the cache of webhook delivery failures.
 *
 * For unit testing purposes only.
 *
 * @internal
 */
function clearFailuresCache() {
    lastDeliveryIdProcessed = 0n;
    failures.clear();
}
async function handler() {
    const octokit = await (0, lambda_github_1.getAppOctokit)();
    if (!octokit) {
        console.info({
            notice: 'Skipping webhook redelivery',
            reason: 'App installation might not be configured or the app is not installed.',
        });
        return;
    }
    // fetch deliveries since the last processed delivery ID
    // for any failures:
    //  1. if this is not a redelivery, save the delivery ID and time, and finally retry
    //  2. if this is a redelivery, check if the original delivery is still within the time limit and retry if it is
    const { deliveries, lastId } = await newDeliveryFailures(octokit, lastDeliveryIdProcessed);
    lastDeliveryIdProcessed = lastId > lastDeliveryIdProcessed ? lastId : lastDeliveryIdProcessed;
    const timeLimitMs = 1000 * 60 * 60 * 3; // retry for up to 3 hours
    for (const [guid, details] of deliveries) {
        if (!details.redelivery) {
            failures.set(guid, { id: details.id, firstDeliveredAt: details.deliveredAt });
            console.log({
                notice: 'Redelivering failed delivery',
                deliveryId: String(details.id),
                guid: guid,
                firstDeliveredAt: details.deliveredAt,
            });
            await (0, lambda_github_1.redeliver)(octokit, details.id);
        }
        else {
            // if this is a redelivery, check if the original delivery is still within the time limit
            const originalFailure = failures.get(guid);
            if (originalFailure) {
                if (new Date().getTime() - originalFailure.firstDeliveredAt.getTime() < timeLimitMs) {
                    console.log({
                        notice: 'Redelivering failed delivery',
                        deliveryId: String(details.id),
                        guid: guid,
                        firstDeliveredAt: originalFailure.firstDeliveredAt,
                    });
                    await (0, lambda_github_1.redeliver)(octokit, details.id);
                }
                else {
                    failures.delete(guid); // no need to keep track of this anymore
                    console.log({
                        notice: 'Skipping redelivery of old failed delivery',
                        deliveryId: String(details.id),
                        guid: guid,
                        firstDeliveredAt: originalFailure?.firstDeliveredAt,
                    });
                }
            }
            else {
                console.log({
                    notice: 'Skipping redelivery of old failed delivery',
                    deliveryId: String(details.id),
                    guid: guid,
                });
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViaG9vay1yZWRlbGl2ZXJ5LmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy93ZWJob29rLXJlZGVsaXZlcnkubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZ0dBLGdEQUdDO0FBRUQsMEJBeURDO0FBN0pELG1EQUEyRDtBQUUzRDs7OztHQUlHO0FBQ0gsS0FBSyxVQUFVLG1CQUFtQixDQUFDLE9BQWdCLEVBQUUsT0FBZTtJQUNsRSxNQUFNLFVBQVUsR0FBd0UsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUNsRyxNQUFNLG9CQUFvQixHQUFnQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3BELE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUMsK0NBQStDO0lBQ25GLElBQUksTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNoQixJQUFJLGNBQWMsR0FBRyxDQUFDLENBQUM7SUFFdkIsSUFBSSxLQUFLLEVBQUUsTUFBTSxRQUFRLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsMEJBQTBCLENBQUMsRUFBRSxDQUFDO1FBQ25GLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQztZQUM1QixNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUM7UUFDeEQsQ0FBQztRQUVELEtBQUssTUFBTSxRQUFRLElBQUksUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ3JDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDdkMsTUFBTSxXQUFXLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQ3BELE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxNQUFNLEtBQUssSUFBSSxDQUFDO1lBRXpDLElBQUksVUFBVSxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUMxQiw2REFB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T0FBTyxFQUFFLEdBQUcsV0FBVyxFQUFFLENBQUM7b0JBQ3BGLE9BQU8sQ0FBQyxHQUFHLENBQUM7d0JBQ1YsTUFBTSxFQUFFLDhCQUE4Qjt3QkFDdEMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO3dCQUM5QixJQUFJLEVBQUUsSUFBSTt3QkFDVixnQkFBZ0IsRUFBRSxlQUFlLENBQUMsZ0JBQWdCO3FCQUNuRCxDQUFDLENBQUM7b0JBQ0gsTUFBTSxJQUFBLHlCQUFTLEVBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDdkMsQ0FBQztxQkFBTSxDQUFDO29CQUNOLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyx3Q0FBd0M7b0JBQy9ELE9BQU8sQ0FBQyxHQUFHLENBQUM7d0JBQ1YsTUFBTSxFQUFFLDRDQUE0Qzt3QkFDcEQsVUFBVSxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO3dCQUM5QixJQUFJLEVBQUUsSUFBSTt3QkFDVixnQkFBZ0IsRUFBRSxlQUFlLEVBQUUsZ0JBQWdCO3FCQUNwRCxDQUFDLENBQUM7Z0JBQ0wsQ0FBQztZQUNILENBQUM7aUJBQU0sQ0FBQztnQkFDTixPQUFPLENBQUMsR0FBRyxDQUFDO29CQUNWLE1BQU0sRUFBRSw0Q0FBNEM7b0JBQ3BELFVBQVUsRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztvQkFDOUIsSUFBSSxFQUFFLElBQUk7aUJBQ1gsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgT2N0b2tpdCB9IGZyb20gJ0BvY3Rva2l0L3Jlc3QnO1xuaW1wb3J0IHsgZ2V0QXBwT2N0b2tpdCwgcmVkZWxpdmVyIH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcblxuLyoqXG4gKiBHZXQgd2ViaG9vayBkZWxpdmVyeSBmYWlsdXJlcyBzaW5jZSB0aGUgbGFzdCBwcm9jZXNzZWQgZGVsaXZlcnkgSUQuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIG5ld0RlbGl2ZXJ5RmFpbHVyZXMob2N0b2tpdDogT2N0b2tpdCwgc2luY2VJZDogYmlnaW50KSB7XG4gIGNvbnN0IGRlbGl2ZXJpZXM6IE1hcDxzdHJpbmcsIHsgaWQ6IGJpZ2ludDsgZGVsaXZlcmVkQXQ6IERhdGU7IHJlZGVsaXZlcnk6IGJvb2xlYW4gfT4gPSBuZXcgTWFwKCk7XG4gIGNvbnN0IHN1Y2Nlc3NmdWxEZWxpdmVyaWVzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoKTtcbiAgY29uc3QgdGltZUxpbWl0TXMgPSAxMDAwICogNjAgKiAzMDsgLy8gZG9uJ3QgbG9vayBhdCBkZWxpdmVyaWVzIG92ZXIgMzAgbWludXRlcyBvbGRcbiAgbGV0IGxhc3RJZCA9IDBuO1xuICBsZXQgcHJvY2Vzc2VkQ291bnQgPSAwO1xuXG4gIGZvciBhd2FpdCAoY29uc3QgcmVzcG9uc2Ugb2Ygb2N0b2tpdC5wYWdpbmF0ZS5pdGVyYXRvcignR0VUIC9hcHAvaG9vay9kZWxpdmVyaWVzJykpIHtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzICE9PSAyMDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRmFpbGVkIHRvIGZldGNoIHdlYmhvb2sgZGVsaXZlcmllcycpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgZGVsaXZlcnkgb2YgcmVzcG9uc2UuZGF0YSkge1xuICAgICAgY29uc3QgZGVsaXZlcnlJZCA9IEJpZ0ludChkZWxpdmVyeS5pZCk7XG4gICAgICBjb25zdCBkZWxpdmVyZWRBdCA9IG5ldyBEYXRlKGRlbGl2ZXJ5LmRlbGl2ZXJlZF9hdCk7XG4gICAgICBjb25zdCBzdWNjZXNzID0gZGVsaXZlcnkuc3RhdHVzID09PSAnT0snO1xuXG4gICAgICBpZiAoZGVsaXZlcnlJZCA8PSBzaW5jZUlkKSB7XG4gICAgICAgIC8vIHN0b3AgcHJvY2Vzc2luZyBpZiB3ZSByZWFjaCB0aGUgbGFzdCBwcm9jZXNzZWQgZGVsaXZlcnkgSURcbiAgICAgICAgY29uc29sZS5pbmZvKHtcbiAgICAgICAgICBub3RpY2U6ICdSZWFjaGVkIGxhc3QgcHJvY2Vzc2VkIGRlbGl2ZXJ5IElEJyxcbiAgICAgICAgICBzaW5jZUlkOiBTdHJpbmcoc2luY2VJZCksXG4gICAgICAgICAgZGVsaXZlcnlJZDogU3RyaW5nKGRlbGl2ZXJ5SWQpLFxuICAgICAgICAgIGd1aWQ6IGRlbGl2ZXJ5Lmd1aWQsXG4gICAgICAgICAgcHJvY2Vzc2VkQ291bnQsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4geyBkZWxpdmVyaWVzLCBsYXN0SWQgfTtcbiAgICAgIH1cblxuICAgICAgbGFzdElkID0gZGVsaXZlcnlJZCA+IGxhc3RJZCA/IGRlbGl2ZXJ5SWQgOiBsYXN0SWQ7XG5cbiAgICAgIGlmIChkZWxpdmVyZWRBdC5nZXRUaW1lKCkgPCBEYXRlLm5vdygpIC0gdGltZUxpbWl0TXMpIHtcbiAgICAgICAgLy8gc3RvcCBwcm9jZXNzaW5nIGlmIHRoZSBkZWxpdmVyeSBpcyB0b28gb2xkIChmb3IgZmlyc3QgaXRlcmF0aW9uIGFuZCBwZXJmb3JtYW5jZSBvZiBmdXJ0aGVyIGl0ZXJhdGlvbnMpXG4gICAgICAgIGNvbnNvbGUuaW5mbyh7XG4gICAgICAgICAgbm90aWNlOiAnU3RvcHBpbmcgYXQgb2xkIGRlbGl2ZXJ5JyxcbiAgICAgICAgICBkZWxpdmVyeUlkOiBTdHJpbmcoZGVsaXZlcnlJZCksXG4gICAgICAgICAgZ3VpZDogZGVsaXZlcnkuZ3VpZCxcbiAgICAgICAgICBkZWxpdmVyZWRBdDogZGVsaXZlcmVkQXQsXG4gICAgICAgICAgcHJvY2Vzc2VkQ291bnQsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4geyBkZWxpdmVyaWVzLCBsYXN0SWQgfTtcbiAgICAgIH1cblxuICAgICAgY29uc29sZS5kZWJ1Zyh7XG4gICAgICAgIG5vdGljZTogJ1Byb2Nlc3Npbmcgd2ViaG9vayBkZWxpdmVyeScsXG4gICAgICAgIGRlbGl2ZXJ5SWQ6IFN0cmluZyhkZWxpdmVyeUlkKSxcbiAgICAgICAgZ3VpZDogZGVsaXZlcnkuZ3VpZCxcbiAgICAgICAgc3RhdHVzOiBkZWxpdmVyeS5zdGF0dXMsXG4gICAgICAgIGRlbGl2ZXJlZEF0OiBkZWxpdmVyeS5kZWxpdmVyZWRfYXQsXG4gICAgICAgIHJlZGVsaXZlcnk6IGRlbGl2ZXJ5LnJlZGVsaXZlcnksXG4gICAgICB9KTtcbiAgICAgIHByb2Nlc3NlZENvdW50Kys7XG5cbiAgICAgIGlmIChzdWNjZXNzKSB7XG4gICAgICAgIHN1Y2Nlc3NmdWxEZWxpdmVyaWVzLmFkZChkZWxpdmVyeS5ndWlkKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChzdWNjZXNzZnVsRGVsaXZlcmllcy5oYXMoZGVsaXZlcnkuZ3VpZCkpIHtcbiAgICAgICAgLy8gZG8gbm90IHJlZGVsaXZlciBkZWxpdmVyaWVzIHRoYXQgd2VyZSBhbHJlYWR5IHN1Y2Nlc3NmdWxcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGRlbGl2ZXJpZXMuc2V0KGRlbGl2ZXJ5Lmd1aWQsIHsgaWQ6IGRlbGl2ZXJ5SWQsIGRlbGl2ZXJlZEF0LCByZWRlbGl2ZXJ5OiBkZWxpdmVyeS5yZWRlbGl2ZXJ5IH0pO1xuICAgIH1cbiAgfVxuXG4gIGNvbnNvbGUuaW5mbyh7XG4gICAgbm90aWNlOiAnTm8gbW9yZSB3ZWJob29rIGRlbGl2ZXJpZXMgdG8gcHJvY2VzcycsXG4gICAgZGVsaXZlcnlJZDogJ0RPTkUnLFxuICAgIGd1aWQ6ICdET05FJyxcbiAgICBkZWxpdmVyZWRBdDogJ0RPTkUnLFxuICAgIHByb2Nlc3NlZENvdW50LFxuICB9KTtcblxuICByZXR1cm4geyBkZWxpdmVyaWVzLCBsYXN0SWQgfTtcbn1cblxubGV0IGxhc3REZWxpdmVyeUlkUHJvY2Vzc2VkID0gMG47XG5jb25zdCBmYWlsdXJlczogTWFwPHN0cmluZywgeyBpZDogYmlnaW50OyBmaXJzdERlbGl2ZXJlZEF0OiBEYXRlIH0+ID0gbmV3IE1hcCgpO1xuXG4vKipcbiAqIENsZWFyIHRoZSBjYWNoZSBvZiB3ZWJob29rIGRlbGl2ZXJ5IGZhaWx1cmVzLlxuICpcbiAqIEZvciB1bml0IHRlc3RpbmcgcHVycG9zZXMgb25seS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyRmFpbHVyZXNDYWNoZSgpIHtcbiAgbGFzdERlbGl2ZXJ5SWRQcm9jZXNzZWQgPSAwbjtcbiAgZmFpbHVyZXMuY2xlYXIoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoKSB7XG4gIGNvbnN0IG9jdG9raXQgPSBhd2FpdCBnZXRBcHBPY3Rva2l0KCk7XG4gIGlmICghb2N0b2tpdCkge1xuICAgIGNvbnNvbGUuaW5mbyh7XG4gICAgICBub3RpY2U6ICdTa2lwcGluZyB3ZWJob29rIHJlZGVsaXZlcnknLFxuICAgICAgcmVhc29uOiAnQXBwIGluc3RhbGxhdGlvbiBtaWdodCBub3QgYmUgY29uZmlndXJlZCBvciB0aGUgYXBwIGlzIG5vdCBpbnN0YWxsZWQuJyxcbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBmZXRjaCBkZWxpdmVyaWVzIHNpbmNlIHRoZSBsYXN0IHByb2Nlc3NlZCBkZWxpdmVyeSBJRFxuICAvLyBmb3IgYW55IGZhaWx1cmVzOlxuICAvLyAgMS4gaWYgdGhpcyBpcyBub3QgYSByZWRlbGl2ZXJ5LCBzYXZlIHRoZSBkZWxpdmVyeSBJRCBhbmQgdGltZSwgYW5kIGZpbmFsbHkgcmV0cnlcbiAgLy8gIDIuIGlmIHRoaXMgaXMgYSByZWRlbGl2ZXJ5LCBjaGVjayBpZiB0aGUgb3JpZ2luYWwgZGVsaXZlcnkgaXMgc3RpbGwgd2l0aGluIHRoZSB0aW1lIGxpbWl0IGFuZCByZXRyeSBpZiBpdCBpc1xuICBjb25zdCB7IGRlbGl2ZXJpZXMsIGxhc3RJZCB9ID0gYXdhaXQgbmV3RGVsaXZlcnlGYWlsdXJlcyhvY3Rva2l0LCBsYXN0RGVsaXZlcnlJZFByb2Nlc3NlZCk7XG4gIGxhc3REZWxpdmVyeUlkUHJvY2Vzc2VkID0gbGFzdElkID4gbGFzdERlbGl2ZXJ5SWRQcm9jZXNzZWQgPyBsYXN0SWQgOiBsYXN0RGVsaXZlcnlJZFByb2Nlc3NlZDtcbiAgY29uc3QgdGltZUxpbWl0TXMgPSAxMDAwICogNjAgKiA2MCAqIDM7IC8vIHJldHJ5IGZvciB1cCB0byAzIGhvdXJzXG4gIGZvciAoY29uc3QgW2d1aWQsIGRldGFpbHNdIG9mIGRlbGl2ZXJpZXMpIHtcbiAgICBpZiAoIWRldGFpbHMucmVkZWxpdmVyeSkge1xuICAgICAgZmFpbHVyZXMuc2V0KGd1aWQsIHsgaWQ6IGRldGFpbHMuaWQsIGZpcnN0RGVsaXZlcmVkQXQ6IGRldGFpbHMuZGVsaXZlcmVkQXQgfSk7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ1JlZGVsaXZlcmluZyBmYWlsZWQgZGVsaXZlcnknLFxuICAgICAgICBkZWxpdmVyeUlkOiBTdHJpbmcoZGV0YWlscy5pZCksXG4gICAgICAgIGd1aWQ6IGd1aWQsXG4gICAgICAgIGZpcnN0RGVsaXZlcmVkQXQ6IGRldGFpbHMuZGVsaXZlcmVkQXQsXG4gICAgICB9KTtcbiAgICAgIGF3YWl0IHJlZGVsaXZlcihvY3Rva2l0LCBkZXRhaWxzLmlkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gaWYgdGhpcyBpcyBhIHJlZGVsaXZlcnksIGNoZWNrIGlmIHRoZSBvcmlnaW5hbCBkZWxpdmVyeSBpcyBzdGlsbCB3aXRoaW4gdGhlIHRpbWUgbGltaXRcbiAgICAgIGNvbnN0IG9yaWdpbmFsRmFpbHVyZSA9IGZhaWx1cmVzLmdldChndWlkKTtcbiAgICAgIGlmIChvcmlnaW5hbEZhaWx1cmUpIHtcbiAgICAgICAgaWYgKG5ldyBEYXRlKCkuZ2V0VGltZSgpIC0gb3JpZ2luYWxGYWlsdXJlLmZpcnN0RGVsaXZlcmVkQXQuZ2V0VGltZSgpIDwgdGltZUxpbWl0TXMpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgICAgICBub3RpY2U6ICdSZWRlbGl2ZXJpbmcgZmFpbGVkIGRlbGl2ZXJ5JyxcbiAgICAgICAgICAgIGRlbGl2ZXJ5SWQ6IFN0cmluZyhkZXRhaWxzLmlkKSxcbiAgICAgICAgICAgIGd1aWQ6IGd1aWQsXG4gICAgICAgICAgICBmaXJzdERlbGl2ZXJlZEF0OiBvcmlnaW5hbEZhaWx1cmUuZmlyc3REZWxpdmVyZWRBdCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCByZWRlbGl2ZXIob2N0b2tpdCwgZGV0YWlscy5pZCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZmFpbHVyZXMuZGVsZXRlKGd1aWQpOyAvLyBubyBuZWVkIHRvIGtlZXAgdHJhY2sgb2YgdGhpcyBhbnltb3JlXG4gICAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgICAgbm90aWNlOiAnU2tpcHBpbmcgcmVkZWxpdmVyeSBvZiBvbGQgZmFpbGVkIGRlbGl2ZXJ5JyxcbiAgICAgICAgICAgIGRlbGl2ZXJ5SWQ6IFN0cmluZyhkZXRhaWxzLmlkKSxcbiAgICAgICAgICAgIGd1aWQ6IGd1aWQsXG4gICAgICAgICAgICBmaXJzdERlbGl2ZXJlZEF0OiBvcmlnaW5hbEZhaWx1cmU/LmZpcnN0RGVsaXZlcmVkQXQsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgICBub3RpY2U6ICdTa2lwcGluZyByZWRlbGl2ZXJ5IG9mIG9sZCBmYWlsZWQgZGVsaXZlcnknLFxuICAgICAgICAgIGRlbGl2ZXJ5SWQ6IFN0cmluZyhkZXRhaWxzLmlkKSxcbiAgICAgICAgICBndWlkOiBndWlkLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==