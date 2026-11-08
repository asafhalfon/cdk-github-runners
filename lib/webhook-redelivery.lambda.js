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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViaG9vay1yZWRlbGl2ZXJ5LmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy93ZWJob29rLXJlZGVsaXZlcnkubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZ0dBLGdEQUdDO0FBRUQsMEJBeURDO0FBN0pELG1EQUEyRDtBQUUzRDs7OztHQUlHO0FBQ0gsS0FBSyxVQUFVLG1CQUFtQixDQUFDLE9BQWdCLEVBQUUsT0FBZTtJQUNsRSxNQUFNLFVBQVUsR0FBd0UsSUFBSSxHQUFHLEVBQUUsQ0FBQztJQUNsRyxNQUFNLG9CQUFvQixHQUFnQixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ3BELE1BQU0sV0FBVyxHQUFHLElBQUksR0FBRyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUMsK0NBQStDO0lBQ25GLElBQUksTUFBTSxHQUFHLEVBQUUsQ0FBQztJQUNoQixJQUFJLGNBQWMsR0FBRyxDQUFDLENBQUM7SUFFdkIsSUFBSSxLQUFLLEVBQUUsTUFBTSxRQUFRLElBQUksT0FBTyxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsMEJBQTBCLENBQUMsRUFBRSxDQUFDO1FBQ25GLElBQUksUUFBUSxDQUFDLE1BQU0sS0FBSyxHQUFHLEVBQUUsQ0FBQztZQUM1QixNQUFNLElBQUksS0FBSyxDQUFDLG9DQUFvQyxDQUFDLENBQUM7UUFDeEQsQ0FBQztRQUVELEtBQUssTUFBTSxRQUFRLElBQUksUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ3JDLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDdkMsTUFBTSxXQUFXLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQ3BELE1BQU0sT0FBTyxHQUFHLFFBQVEsQ0FBQyxNQUFNLEtBQUssSUFBSSxDQUFDO1lBRXpDLElBQUksVUFBVSxJQUFJLE9BQU8sRUFBRSxDQUFDO2dCQUMxQiw2REFBNkQ7Z0JBQzdELE9BQU8sQ0FBQyxJQUFJLENBQUM7b0JBQ1gsTUFBTSxFQUFFLG9DQUFvQztvQkFDNUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUM7b0JBQ3hCLFVBQVUsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDO29CQUM5QixJQUFJLEVBQUUsUUFBUSxDQUFDLElBQUk7b0JBQ25CLGNBQWM7aUJBQ2YsQ0FBQyxDQUFDO2dCQUNILE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLENBQUM7WUFDaEMsQ0FBQztZQUVELE1BQU0sR0FBRyxVQUFVLEdBQUcsTUFBTSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQztZQUVuRCxJQUFJLFdBQVcsQ0FBQyxPQUFPLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLEdBQUcsV0FBVyxFQUFFLENBQUM7Z0JBQ3JELHlHQUF5RztnQkFDekcsT0FBTyxDQUFDLElBQUksQ0FBQztvQkFDWCxNQUFNLEVBQUUsMEJBQTBCO29CQUNsQyxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVUsQ0FBQztvQkFDOUIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxJQUFJO29CQUNuQixXQUFXLEVBQUUsV0FBVztvQkFDeEIsY0FBYztpQkFDZixDQUFDLENBQUM7Z0JBQ0gsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsQ0FBQztZQUNoQyxDQUFDO1lBRUQsT0FBTyxDQUFDLEtBQUssQ0FBQztnQkFDWixNQUFNLEVBQUUsNkJBQTZCO2dCQUNyQyxVQUFVLEVBQUUsTUFBTSxDQUFDLFVBQVUsQ0FBQztnQkFDOUIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxJQUFJO2dCQUNuQixNQUFNLEVBQUUsUUFBUSxDQUFDLE1BQU07Z0JBQ3ZCLFdBQVcsRUFBRSxRQUFRLENBQUMsWUFBWTtnQkFDbEMsVUFBVSxFQUFFLFFBQVEsQ0FBQyxVQUFVO2FBQ2hDLENBQUMsQ0FBQztZQUNILGNBQWMsRUFBRSxDQUFDO1lBRWpCLElBQUksT0FBTyxFQUFFLENBQUM7Z0JBQ1osb0JBQW9CLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDeEMsU0FBUztZQUNYLENBQUM7WUFFRCxJQUFJLG9CQUFvQixDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDNUMsMkRBQTJEO2dCQUMzRCxTQUFTO1lBQ1gsQ0FBQztZQUVELFVBQVUsQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxFQUFFLEVBQUUsRUFBRSxVQUFVLEVBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxRQUFRLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUNsRyxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sQ0FBQyxJQUFJLENBQUM7UUFDWCxNQUFNLEVBQUUsdUNBQXVDO1FBQy9DLFVBQVUsRUFBRSxNQUFNO1FBQ2xCLElBQUksRUFBRSxNQUFNO1FBQ1osV0FBVyxFQUFFLE1BQU07UUFDbkIsY0FBYztLQUNmLENBQUMsQ0FBQztJQUVILE9BQU8sRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLENBQUM7QUFDaEMsQ0FBQztBQUVELElBQUksdUJBQXVCLEdBQUcsRUFBRSxDQUFDO0FBQ2pDLE1BQU0sUUFBUSxHQUF3RCxJQUFJLEdBQUcsRUFBRSxDQUFDO0FBRWhGOzs7Ozs7R0FNRztBQUNILFNBQWdCLGtCQUFrQjtJQUNoQyx1QkFBdUIsR0FBRyxFQUFFLENBQUM7SUFDN0IsUUFBUSxDQUFDLEtBQUssRUFBRSxDQUFDO0FBQ25CLENBQUM7QUFFTSxLQUFLLFVBQVUsT0FBTztJQUMzQixNQUFNLE9BQU8sR0FBRyxNQUFNLElBQUEsNkJBQWEsR0FBRSxDQUFDO0lBQ3RDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNiLE9BQU8sQ0FBQyxJQUFJLENBQUM7WUFDWCxNQUFNLEVBQUUsNkJBQTZCO1lBQ3JDLE1BQU0sRUFBRSx1RUFBdUU7U0FDaEYsQ0FBQyxDQUFDO1FBQ0gsT0FBTztJQUNULENBQUM7SUFFRCx3REFBd0Q7SUFDeEQsb0JBQW9CO0lBQ3BCLG9GQUFvRjtJQUNwRixnSEFBZ0g7SUFDaEgsTUFBTSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsR0FBRyxNQUFNLG1CQUFtQixDQUFDLE9BQU8sRUFBRSx1QkFBdUIsQ0FBQyxDQUFDO0lBQzNGLHVCQUF1QixHQUFHLE1BQU0sR0FBRyx1QkFBdUIsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyx1QkFBdUIsQ0FBQztJQUM5RixNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQywwQkFBMEI7SUFDbEUsS0FBSyxNQUFNLENBQUMsSUFBSSxFQUFFLE9BQU8sQ0FBQyxJQUFJLFVBQVUsRUFBRSxDQUFDO1FBQ3pDLElBQUksQ0FBQyxPQUFPLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDeEIsUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsRUFBRSxFQUFFLEVBQUUsT0FBTyxDQUFDLEVBQUUsRUFBRSxnQkFBZ0IsRUFBRSxPQUFPLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztZQUM5RSxPQUFPLENBQUMsR0FBRyxDQUFDO2dCQUNWLE1BQU0sRUFBRSw4QkFBOEI7Z0JBQ3RDLFVBQVUsRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDOUIsSUFBSSxFQUFFLElBQUk7Z0JBQ1YsZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLFdBQVc7YUFDdEMsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxJQUFBLHlCQUFTLEVBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUN2QyxDQUFDO2FBQU0sQ0FBQztZQUNOLHlGQUF5RjtZQUN6RixNQUFNLGVBQWUsR0FBRyxRQUFRLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQzNDLElBQUksZUFBZSxFQUFFLENBQUM7Z0JBQ3BCLElBQUksSUFBSSxJQUFJLEVBQUUsQ0FBQyxPQUFPLEVBQUUsR0FBRyxlQUFlLENBQUMsZ0JBQWdCLENBQUMsT0FBTyxFQUFFLEdBQUcsV0FBVyxFQUFFLENBQUM7b0JBQ3BGLE9BQU8sQ0FBQyxHQUFHLENBQUM7d0JBQ1YsTUFBTSxFQUFFLDhCQUE4Qjt3QkFDdEMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO3dCQUM5QixJQUFJLEVBQUUsSUFBSTt3QkFDVixnQkFBZ0IsRUFBRSxlQUFlLENBQUMsZ0JBQWdCO3FCQUNuRCxDQUFDLENBQUM7b0JBQ0gsTUFBTSxJQUFBLHlCQUFTLEVBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDdkMsQ0FBQztxQkFBTSxDQUFDO29CQUNOLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyx3Q0FBd0M7b0JBQy9ELE9BQU8sQ0FBQyxHQUFHLENBQUM7d0JBQ1YsTUFBTSxFQUFFLDRDQUE0Qzt3QkFDcEQsVUFBVSxFQUFFLE1BQU0sQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO3dCQUM5QixJQUFJLEVBQUUsSUFBSTt3QkFDVixnQkFBZ0IsRUFBRSxlQUFlLEVBQUUsZ0JBQWdCO3FCQUNwRCxDQUFDLENBQUM7Z0JBQ0wsQ0FBQztZQUNILENBQUM7aUJBQU0sQ0FBQztnQkFDTixPQUFPLENBQUMsR0FBRyxDQUFDO29CQUNWLE1BQU0sRUFBRSw0Q0FBNEM7b0JBQ3BELFVBQVUsRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztvQkFDOUIsSUFBSSxFQUFFLElBQUk7aUJBQ1gsQ0FBQyxDQUFDO1lBQ0wsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHsgT2N0b2tpdCB9IGZyb20gJ0BvY3Rva2l0L3Jlc3QnIHdpdGggeyAncmVzb2x1dGlvbi1tb2RlJzogJ2ltcG9ydCcgfTtcbmltcG9ydCB7IGdldEFwcE9jdG9raXQsIHJlZGVsaXZlciB9IGZyb20gJy4vbGFtYmRhLWdpdGh1Yic7XG5cbi8qKlxuICogR2V0IHdlYmhvb2sgZGVsaXZlcnkgZmFpbHVyZXMgc2luY2UgdGhlIGxhc3QgcHJvY2Vzc2VkIGRlbGl2ZXJ5IElELlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5hc3luYyBmdW5jdGlvbiBuZXdEZWxpdmVyeUZhaWx1cmVzKG9jdG9raXQ6IE9jdG9raXQsIHNpbmNlSWQ6IGJpZ2ludCkge1xuICBjb25zdCBkZWxpdmVyaWVzOiBNYXA8c3RyaW5nLCB7IGlkOiBiaWdpbnQ7IGRlbGl2ZXJlZEF0OiBEYXRlOyByZWRlbGl2ZXJ5OiBib29sZWFuIH0+ID0gbmV3IE1hcCgpO1xuICBjb25zdCBzdWNjZXNzZnVsRGVsaXZlcmllczogU2V0PHN0cmluZz4gPSBuZXcgU2V0KCk7XG4gIGNvbnN0IHRpbWVMaW1pdE1zID0gMTAwMCAqIDYwICogMzA7IC8vIGRvbid0IGxvb2sgYXQgZGVsaXZlcmllcyBvdmVyIDMwIG1pbnV0ZXMgb2xkXG4gIGxldCBsYXN0SWQgPSAwbjtcbiAgbGV0IHByb2Nlc3NlZENvdW50ID0gMDtcblxuICBmb3IgYXdhaXQgKGNvbnN0IHJlc3BvbnNlIG9mIG9jdG9raXQucGFnaW5hdGUuaXRlcmF0b3IoJ0dFVCAvYXBwL2hvb2svZGVsaXZlcmllcycpKSB7XG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyAhPT0gMjAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ZhaWxlZCB0byBmZXRjaCB3ZWJob29rIGRlbGl2ZXJpZXMnKTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGRlbGl2ZXJ5IG9mIHJlc3BvbnNlLmRhdGEpIHtcbiAgICAgIGNvbnN0IGRlbGl2ZXJ5SWQgPSBCaWdJbnQoZGVsaXZlcnkuaWQpO1xuICAgICAgY29uc3QgZGVsaXZlcmVkQXQgPSBuZXcgRGF0ZShkZWxpdmVyeS5kZWxpdmVyZWRfYXQpO1xuICAgICAgY29uc3Qgc3VjY2VzcyA9IGRlbGl2ZXJ5LnN0YXR1cyA9PT0gJ09LJztcblxuICAgICAgaWYgKGRlbGl2ZXJ5SWQgPD0gc2luY2VJZCkge1xuICAgICAgICAvLyBzdG9wIHByb2Nlc3NpbmcgaWYgd2UgcmVhY2ggdGhlIGxhc3QgcHJvY2Vzc2VkIGRlbGl2ZXJ5IElEXG4gICAgICAgIGNvbnNvbGUuaW5mbyh7XG4gICAgICAgICAgbm90aWNlOiAnUmVhY2hlZCBsYXN0IHByb2Nlc3NlZCBkZWxpdmVyeSBJRCcsXG4gICAgICAgICAgc2luY2VJZDogU3RyaW5nKHNpbmNlSWQpLFxuICAgICAgICAgIGRlbGl2ZXJ5SWQ6IFN0cmluZyhkZWxpdmVyeUlkKSxcbiAgICAgICAgICBndWlkOiBkZWxpdmVyeS5ndWlkLFxuICAgICAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHsgZGVsaXZlcmllcywgbGFzdElkIH07XG4gICAgICB9XG5cbiAgICAgIGxhc3RJZCA9IGRlbGl2ZXJ5SWQgPiBsYXN0SWQgPyBkZWxpdmVyeUlkIDogbGFzdElkO1xuXG4gICAgICBpZiAoZGVsaXZlcmVkQXQuZ2V0VGltZSgpIDwgRGF0ZS5ub3coKSAtIHRpbWVMaW1pdE1zKSB7XG4gICAgICAgIC8vIHN0b3AgcHJvY2Vzc2luZyBpZiB0aGUgZGVsaXZlcnkgaXMgdG9vIG9sZCAoZm9yIGZpcnN0IGl0ZXJhdGlvbiBhbmQgcGVyZm9ybWFuY2Ugb2YgZnVydGhlciBpdGVyYXRpb25zKVxuICAgICAgICBjb25zb2xlLmluZm8oe1xuICAgICAgICAgIG5vdGljZTogJ1N0b3BwaW5nIGF0IG9sZCBkZWxpdmVyeScsXG4gICAgICAgICAgZGVsaXZlcnlJZDogU3RyaW5nKGRlbGl2ZXJ5SWQpLFxuICAgICAgICAgIGd1aWQ6IGRlbGl2ZXJ5Lmd1aWQsXG4gICAgICAgICAgZGVsaXZlcmVkQXQ6IGRlbGl2ZXJlZEF0LFxuICAgICAgICAgIHByb2Nlc3NlZENvdW50LFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHsgZGVsaXZlcmllcywgbGFzdElkIH07XG4gICAgICB9XG5cbiAgICAgIGNvbnNvbGUuZGVidWcoe1xuICAgICAgICBub3RpY2U6ICdQcm9jZXNzaW5nIHdlYmhvb2sgZGVsaXZlcnknLFxuICAgICAgICBkZWxpdmVyeUlkOiBTdHJpbmcoZGVsaXZlcnlJZCksXG4gICAgICAgIGd1aWQ6IGRlbGl2ZXJ5Lmd1aWQsXG4gICAgICAgIHN0YXR1czogZGVsaXZlcnkuc3RhdHVzLFxuICAgICAgICBkZWxpdmVyZWRBdDogZGVsaXZlcnkuZGVsaXZlcmVkX2F0LFxuICAgICAgICByZWRlbGl2ZXJ5OiBkZWxpdmVyeS5yZWRlbGl2ZXJ5LFxuICAgICAgfSk7XG4gICAgICBwcm9jZXNzZWRDb3VudCsrO1xuXG4gICAgICBpZiAoc3VjY2Vzcykge1xuICAgICAgICBzdWNjZXNzZnVsRGVsaXZlcmllcy5hZGQoZGVsaXZlcnkuZ3VpZCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoc3VjY2Vzc2Z1bERlbGl2ZXJpZXMuaGFzKGRlbGl2ZXJ5Lmd1aWQpKSB7XG4gICAgICAgIC8vIGRvIG5vdCByZWRlbGl2ZXIgZGVsaXZlcmllcyB0aGF0IHdlcmUgYWxyZWFkeSBzdWNjZXNzZnVsXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBkZWxpdmVyaWVzLnNldChkZWxpdmVyeS5ndWlkLCB7IGlkOiBkZWxpdmVyeUlkLCBkZWxpdmVyZWRBdCwgcmVkZWxpdmVyeTogZGVsaXZlcnkucmVkZWxpdmVyeSB9KTtcbiAgICB9XG4gIH1cblxuICBjb25zb2xlLmluZm8oe1xuICAgIG5vdGljZTogJ05vIG1vcmUgd2ViaG9vayBkZWxpdmVyaWVzIHRvIHByb2Nlc3MnLFxuICAgIGRlbGl2ZXJ5SWQ6ICdET05FJyxcbiAgICBndWlkOiAnRE9ORScsXG4gICAgZGVsaXZlcmVkQXQ6ICdET05FJyxcbiAgICBwcm9jZXNzZWRDb3VudCxcbiAgfSk7XG5cbiAgcmV0dXJuIHsgZGVsaXZlcmllcywgbGFzdElkIH07XG59XG5cbmxldCBsYXN0RGVsaXZlcnlJZFByb2Nlc3NlZCA9IDBuO1xuY29uc3QgZmFpbHVyZXM6IE1hcDxzdHJpbmcsIHsgaWQ6IGJpZ2ludDsgZmlyc3REZWxpdmVyZWRBdDogRGF0ZSB9PiA9IG5ldyBNYXAoKTtcblxuLyoqXG4gKiBDbGVhciB0aGUgY2FjaGUgb2Ygd2ViaG9vayBkZWxpdmVyeSBmYWlsdXJlcy5cbiAqXG4gKiBGb3IgdW5pdCB0ZXN0aW5nIHB1cnBvc2VzIG9ubHkuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhckZhaWx1cmVzQ2FjaGUoKSB7XG4gIGxhc3REZWxpdmVyeUlkUHJvY2Vzc2VkID0gMG47XG4gIGZhaWx1cmVzLmNsZWFyKCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKCkge1xuICBjb25zdCBvY3Rva2l0ID0gYXdhaXQgZ2V0QXBwT2N0b2tpdCgpO1xuICBpZiAoIW9jdG9raXQpIHtcbiAgICBjb25zb2xlLmluZm8oe1xuICAgICAgbm90aWNlOiAnU2tpcHBpbmcgd2ViaG9vayByZWRlbGl2ZXJ5JyxcbiAgICAgIHJlYXNvbjogJ0FwcCBpbnN0YWxsYXRpb24gbWlnaHQgbm90IGJlIGNvbmZpZ3VyZWQgb3IgdGhlIGFwcCBpcyBub3QgaW5zdGFsbGVkLicsXG4gICAgfSk7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gZmV0Y2ggZGVsaXZlcmllcyBzaW5jZSB0aGUgbGFzdCBwcm9jZXNzZWQgZGVsaXZlcnkgSURcbiAgLy8gZm9yIGFueSBmYWlsdXJlczpcbiAgLy8gIDEuIGlmIHRoaXMgaXMgbm90IGEgcmVkZWxpdmVyeSwgc2F2ZSB0aGUgZGVsaXZlcnkgSUQgYW5kIHRpbWUsIGFuZCBmaW5hbGx5IHJldHJ5XG4gIC8vICAyLiBpZiB0aGlzIGlzIGEgcmVkZWxpdmVyeSwgY2hlY2sgaWYgdGhlIG9yaWdpbmFsIGRlbGl2ZXJ5IGlzIHN0aWxsIHdpdGhpbiB0aGUgdGltZSBsaW1pdCBhbmQgcmV0cnkgaWYgaXQgaXNcbiAgY29uc3QgeyBkZWxpdmVyaWVzLCBsYXN0SWQgfSA9IGF3YWl0IG5ld0RlbGl2ZXJ5RmFpbHVyZXMob2N0b2tpdCwgbGFzdERlbGl2ZXJ5SWRQcm9jZXNzZWQpO1xuICBsYXN0RGVsaXZlcnlJZFByb2Nlc3NlZCA9IGxhc3RJZCA+IGxhc3REZWxpdmVyeUlkUHJvY2Vzc2VkID8gbGFzdElkIDogbGFzdERlbGl2ZXJ5SWRQcm9jZXNzZWQ7XG4gIGNvbnN0IHRpbWVMaW1pdE1zID0gMTAwMCAqIDYwICogNjAgKiAzOyAvLyByZXRyeSBmb3IgdXAgdG8gMyBob3Vyc1xuICBmb3IgKGNvbnN0IFtndWlkLCBkZXRhaWxzXSBvZiBkZWxpdmVyaWVzKSB7XG4gICAgaWYgKCFkZXRhaWxzLnJlZGVsaXZlcnkpIHtcbiAgICAgIGZhaWx1cmVzLnNldChndWlkLCB7IGlkOiBkZXRhaWxzLmlkLCBmaXJzdERlbGl2ZXJlZEF0OiBkZXRhaWxzLmRlbGl2ZXJlZEF0IH0pO1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdSZWRlbGl2ZXJpbmcgZmFpbGVkIGRlbGl2ZXJ5JyxcbiAgICAgICAgZGVsaXZlcnlJZDogU3RyaW5nKGRldGFpbHMuaWQpLFxuICAgICAgICBndWlkOiBndWlkLFxuICAgICAgICBmaXJzdERlbGl2ZXJlZEF0OiBkZXRhaWxzLmRlbGl2ZXJlZEF0LFxuICAgICAgfSk7XG4gICAgICBhd2FpdCByZWRlbGl2ZXIob2N0b2tpdCwgZGV0YWlscy5pZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGlmIHRoaXMgaXMgYSByZWRlbGl2ZXJ5LCBjaGVjayBpZiB0aGUgb3JpZ2luYWwgZGVsaXZlcnkgaXMgc3RpbGwgd2l0aGluIHRoZSB0aW1lIGxpbWl0XG4gICAgICBjb25zdCBvcmlnaW5hbEZhaWx1cmUgPSBmYWlsdXJlcy5nZXQoZ3VpZCk7XG4gICAgICBpZiAob3JpZ2luYWxGYWlsdXJlKSB7XG4gICAgICAgIGlmIChuZXcgRGF0ZSgpLmdldFRpbWUoKSAtIG9yaWdpbmFsRmFpbHVyZS5maXJzdERlbGl2ZXJlZEF0LmdldFRpbWUoKSA8IHRpbWVMaW1pdE1zKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgICAgbm90aWNlOiAnUmVkZWxpdmVyaW5nIGZhaWxlZCBkZWxpdmVyeScsXG4gICAgICAgICAgICBkZWxpdmVyeUlkOiBTdHJpbmcoZGV0YWlscy5pZCksXG4gICAgICAgICAgICBndWlkOiBndWlkLFxuICAgICAgICAgICAgZmlyc3REZWxpdmVyZWRBdDogb3JpZ2luYWxGYWlsdXJlLmZpcnN0RGVsaXZlcmVkQXQsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgcmVkZWxpdmVyKG9jdG9raXQsIGRldGFpbHMuaWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZhaWx1cmVzLmRlbGV0ZShndWlkKTsgLy8gbm8gbmVlZCB0byBrZWVwIHRyYWNrIG9mIHRoaXMgYW55bW9yZVxuICAgICAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgICAgIG5vdGljZTogJ1NraXBwaW5nIHJlZGVsaXZlcnkgb2Ygb2xkIGZhaWxlZCBkZWxpdmVyeScsXG4gICAgICAgICAgICBkZWxpdmVyeUlkOiBTdHJpbmcoZGV0YWlscy5pZCksXG4gICAgICAgICAgICBndWlkOiBndWlkLFxuICAgICAgICAgICAgZmlyc3REZWxpdmVyZWRBdDogb3JpZ2luYWxGYWlsdXJlPy5maXJzdERlbGl2ZXJlZEF0LFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgICAgbm90aWNlOiAnU2tpcHBpbmcgcmVkZWxpdmVyeSBvZiBvbGQgZmFpbGVkIGRlbGl2ZXJ5JyxcbiAgICAgICAgICBkZWxpdmVyeUlkOiBTdHJpbmcoZGV0YWlscy5pZCksXG4gICAgICAgICAgZ3VpZDogZ3VpZCxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iXX0=