"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.terminateRunnerInstances = terminateRunnerInstances;
const client_ec2_1 = require("@aws-sdk/client-ec2");
const lambda_common_1 = require("./lambda-common");
const ec2 = new client_ec2_1.EC2Client();
function tagValue(instance, key) {
    return instance.Tags?.find(t => t.Key === key)?.Value;
}
/**
 * Terminate any instance still running for a given runner.
 *
 * EC2 runners terminate themselves by calling `poweroff` at the end of their user data script, with `InstanceInitiatedShutdownBehavior=terminate`
 * turning that into a termination. When the user data script never runs (e.g. IMDS not serving it at boot, the OOM killer taking the shell, a wedged
 * `poweroff`) nothing else in the stack cleans the instance up, and it runs until a human notices it.
 *
 * Instances are found by {@link ReservedTags.RUNNER} and {@link ReservedTags.STACK}. The tags have reserved prefix and contains the step function
 * execution name which also matches the runner name on GitHub Actions. Step function execution names are unique for 90 days and runner names are also
 * unique within their registration scope. This allows us to only terminate instances that were launched by us for this specific runner.
 *
 * Call this only from places that already know the runner is finished with like the step function's failure path, or the idle reaper once it has
 * decided a runner is done. Never call it while a runner may still be working. We have no way to tell a busy instance apart from an idle or broken
 * instance.
 *
 * Best effort: a failure is logged and swallowed, because the callers are cleanup paths whose own failure would mask the error that got us there. An
 * instance we miss is an instance that would have been missed anyway before this existed.
 *
 * @param runnerName runner name, which is also the step function execution name
 * @returns ids of the instances we asked to terminate
 *
 * @internal
 */
async function terminateRunnerInstances(runnerName) {
    const stackName = process.env.STACK_NAME;
    if (!stackName) {
        console.error({
            notice: 'Missing STACK_NAME environment variable, cannot terminate runner instances',
            runnerName,
        });
        return [];
    }
    try {
        const ids = [];
        for await (const page of (0, client_ec2_1.paginateDescribeInstances)({ client: ec2 }, {
            Filters: [
                { Name: `tag:${lambda_common_1.ReservedTags.RUNNER}`, Values: [runnerName] },
                { Name: `tag:${lambda_common_1.ReservedTags.STACK}`, Values: [stackName] },
                // anything not already on its way out. a runner should never be stopped, but if one somehow is, it still holds an EBS volume we are paying for
                { Name: 'instance-state-name', Values: ['pending', 'running', 'stopping', 'stopped'] },
            ],
        })) {
            // re-check the tag ourselves instead of trusting the filter. terminating someone else's instance would be far worse than leaving one of ours
            // behind, so this is worth the few lines
            ids.push(...(page.Reservations ?? [])
                .flatMap(r => r.Instances ?? [])
                .filter(i => tagValue(i, lambda_common_1.ReservedTags.RUNNER) === runnerName)
                .filter(i => tagValue(i, lambda_common_1.ReservedTags.STACK) === stackName)
                .map(i => i.InstanceId)
                .filter((id) => !!id));
        }
        if (ids.length === 0) {
            return [];
        }
        console.log({
            notice: 'Terminating runner instances that outlived their job',
            runnerName,
            instanceIds: ids,
        });
        const terminated = [];
        for (let i = 0; i < ids.length; i += 100) {
            const batch = ids.slice(i, i + 100);
            try {
                await ec2.send(new client_ec2_1.TerminateInstancesCommand({ InstanceIds: batch }));
                terminated.push(...batch);
            }
            catch (e) {
                console.error({ notice: 'Failed to terminate a batch of runner instances', runnerName, batch, error: e });
            }
        }
        return terminated;
    }
    catch (e) {
        console.error({
            notice: 'Failed to terminate leftover runner instances',
            runnerName,
            error: e,
        });
        return [];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWVjMi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9sYW1iZGEtZWMyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZ0NBLDREQTZEQztBQTdGRCxvREFBZ0g7QUFDaEgsbURBQStDO0FBRS9DLE1BQU0sR0FBRyxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO0FBRTVCLFNBQVMsUUFBUSxDQUFDLFFBQWtCLEVBQUUsR0FBVztJQUMvQyxPQUFPLFFBQVEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsS0FBSyxHQUFHLENBQUMsRUFBRSxLQUFLLENBQUM7QUFDeEQsQ0FBQztBQUVEOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBc0JHO0FBQ0ksS0FBSyxVQUFVLHdCQUF3QixDQUFDLFVBQWtCO0lBQy9ELE1BQU0sU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxDQUFDO0lBQ3pDLElBQUksQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNmLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsNEVBQTRFO1lBQ3BGLFVBQVU7U0FDWCxDQUFDLENBQUM7UUFDSCxPQUFPLEVBQUUsQ0FBQztJQUNaLENBQUM7SUFFRCxJQUFJLENBQUM7UUFDSCxNQUFNLEdBQUcsR0FBRyxFQUFFLENBQUM7UUFFZixJQUFJLEtBQUssRUFBRSxNQUFNLElBQUksSUFBSSxJQUFBLHNDQUF5QixFQUFDLEVBQUUsTUFBTSxFQUFFLEdBQUcsRUFBRSxFQUFFO1lBQ2xFLE9BQU8sRUFBRTtnQkFDUCxFQUFFLElBQUksRUFBRSxPQUFPLDRCQUFZLENBQUMsTUFBTSxFQUFFLEVBQUUsTUFBTSxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUU7Z0JBQzVELEVBQUUsSUFBSSxFQUFFLE9BQU8sNEJBQVksQ0FBQyxLQUFLLEVBQUUsRUFBRSxNQUFNLEVBQUUsQ0FBQyxTQUFTLENBQUMsRUFBRTtnQkFDMUQsK0lBQStJO2dCQUMvSSxFQUFFLElBQUksRUFBRSxxQkFBcUIsRUFBRSxNQUFNLEVBQUUsQ0FBQyxTQUFTLEVBQUUsU0FBUyxFQUFFLFVBQVUsRUFBRSxTQUFTLENBQUMsRUFBRTthQUN2RjtTQUNGLENBQUMsRUFBRSxDQUFDO1lBQ0gsNklBQTZJO1lBQzdJLHlDQUF5QztZQUN6QyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLEVBQUUsQ0FBQztpQkFDbEMsT0FBTyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLFNBQVMsSUFBSSxFQUFFLENBQUM7aUJBQy9CLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsNEJBQVksQ0FBQyxNQUFNLENBQUMsS0FBSyxVQUFVLENBQUM7aUJBQzVELE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsNEJBQVksQ0FBQyxLQUFLLENBQUMsS0FBSyxTQUFTLENBQUM7aUJBQzFELEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxVQUFVLENBQUM7aUJBQ3RCLE1BQU0sQ0FBQyxDQUFDLEVBQUUsRUFBZ0IsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ3pDLENBQUM7UUFFRCxJQUFJLEdBQUcsQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDckIsT0FBTyxFQUFFLENBQUM7UUFDWixDQUFDO1FBRUQsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUNWLE1BQU0sRUFBRSxzREFBc0Q7WUFDOUQsVUFBVTtZQUNWLFdBQVcsRUFBRSxHQUFHO1NBQ2pCLENBQUMsQ0FBQztRQUVILE1BQU0sVUFBVSxHQUFhLEVBQUUsQ0FBQztRQUNoQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDLElBQUksR0FBRyxFQUFFLENBQUM7WUFDekMsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDO1lBQ3BDLElBQUksQ0FBQztnQkFDSCxNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxzQ0FBeUIsQ0FBQyxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQ3RFLFVBQVUsQ0FBQyxJQUFJLENBQUMsR0FBRyxLQUFLLENBQUMsQ0FBQztZQUM1QixDQUFDO1lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDWCxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsTUFBTSxFQUFFLGlEQUFpRCxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDNUcsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLFVBQVUsQ0FBQztJQUNwQixDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsK0NBQStDO1lBQ3ZELFVBQVU7WUFDVixLQUFLLEVBQUUsQ0FBQztTQUNULENBQUMsQ0FBQztRQUNILE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFQzJDbGllbnQsIEluc3RhbmNlLCBwYWdpbmF0ZURlc2NyaWJlSW5zdGFuY2VzLCBUZXJtaW5hdGVJbnN0YW5jZXNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWVjMic7XG5pbXBvcnQgeyBSZXNlcnZlZFRhZ3MgfSBmcm9tICcuL2xhbWJkYS1jb21tb24nO1xuXG5jb25zdCBlYzIgPSBuZXcgRUMyQ2xpZW50KCk7XG5cbmZ1bmN0aW9uIHRhZ1ZhbHVlKGluc3RhbmNlOiBJbnN0YW5jZSwga2V5OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICByZXR1cm4gaW5zdGFuY2UuVGFncz8uZmluZCh0ID0+IHQuS2V5ID09PSBrZXkpPy5WYWx1ZTtcbn1cblxuLyoqXG4gKiBUZXJtaW5hdGUgYW55IGluc3RhbmNlIHN0aWxsIHJ1bm5pbmcgZm9yIGEgZ2l2ZW4gcnVubmVyLlxuICpcbiAqIEVDMiBydW5uZXJzIHRlcm1pbmF0ZSB0aGVtc2VsdmVzIGJ5IGNhbGxpbmcgYHBvd2Vyb2ZmYCBhdCB0aGUgZW5kIG9mIHRoZWlyIHVzZXIgZGF0YSBzY3JpcHQsIHdpdGggYEluc3RhbmNlSW5pdGlhdGVkU2h1dGRvd25CZWhhdmlvcj10ZXJtaW5hdGVgXG4gKiB0dXJuaW5nIHRoYXQgaW50byBhIHRlcm1pbmF0aW9uLiBXaGVuIHRoZSB1c2VyIGRhdGEgc2NyaXB0IG5ldmVyIHJ1bnMgKGUuZy4gSU1EUyBub3Qgc2VydmluZyBpdCBhdCBib290LCB0aGUgT09NIGtpbGxlciB0YWtpbmcgdGhlIHNoZWxsLCBhIHdlZGdlZFxuICogYHBvd2Vyb2ZmYCkgbm90aGluZyBlbHNlIGluIHRoZSBzdGFjayBjbGVhbnMgdGhlIGluc3RhbmNlIHVwLCBhbmQgaXQgcnVucyB1bnRpbCBhIGh1bWFuIG5vdGljZXMgaXQuXG4gKlxuICogSW5zdGFuY2VzIGFyZSBmb3VuZCBieSB7QGxpbmsgUmVzZXJ2ZWRUYWdzLlJVTk5FUn0gYW5kIHtAbGluayBSZXNlcnZlZFRhZ3MuU1RBQ0t9LiBUaGUgdGFncyBoYXZlIHJlc2VydmVkIHByZWZpeCBhbmQgY29udGFpbnMgdGhlIHN0ZXAgZnVuY3Rpb25cbiAqIGV4ZWN1dGlvbiBuYW1lIHdoaWNoIGFsc28gbWF0Y2hlcyB0aGUgcnVubmVyIG5hbWUgb24gR2l0SHViIEFjdGlvbnMuIFN0ZXAgZnVuY3Rpb24gZXhlY3V0aW9uIG5hbWVzIGFyZSB1bmlxdWUgZm9yIDkwIGRheXMgYW5kIHJ1bm5lciBuYW1lcyBhcmUgYWxzb1xuICogdW5pcXVlIHdpdGhpbiB0aGVpciByZWdpc3RyYXRpb24gc2NvcGUuIFRoaXMgYWxsb3dzIHVzIHRvIG9ubHkgdGVybWluYXRlIGluc3RhbmNlcyB0aGF0IHdlcmUgbGF1bmNoZWQgYnkgdXMgZm9yIHRoaXMgc3BlY2lmaWMgcnVubmVyLlxuICpcbiAqIENhbGwgdGhpcyBvbmx5IGZyb20gcGxhY2VzIHRoYXQgYWxyZWFkeSBrbm93IHRoZSBydW5uZXIgaXMgZmluaXNoZWQgd2l0aCBsaWtlIHRoZSBzdGVwIGZ1bmN0aW9uJ3MgZmFpbHVyZSBwYXRoLCBvciB0aGUgaWRsZSByZWFwZXIgb25jZSBpdCBoYXNcbiAqIGRlY2lkZWQgYSBydW5uZXIgaXMgZG9uZS4gTmV2ZXIgY2FsbCBpdCB3aGlsZSBhIHJ1bm5lciBtYXkgc3RpbGwgYmUgd29ya2luZy4gV2UgaGF2ZSBubyB3YXkgdG8gdGVsbCBhIGJ1c3kgaW5zdGFuY2UgYXBhcnQgZnJvbSBhbiBpZGxlIG9yIGJyb2tlblxuICogaW5zdGFuY2UuXG4gKlxuICogQmVzdCBlZmZvcnQ6IGEgZmFpbHVyZSBpcyBsb2dnZWQgYW5kIHN3YWxsb3dlZCwgYmVjYXVzZSB0aGUgY2FsbGVycyBhcmUgY2xlYW51cCBwYXRocyB3aG9zZSBvd24gZmFpbHVyZSB3b3VsZCBtYXNrIHRoZSBlcnJvciB0aGF0IGdvdCB1cyB0aGVyZS4gQW5cbiAqIGluc3RhbmNlIHdlIG1pc3MgaXMgYW4gaW5zdGFuY2UgdGhhdCB3b3VsZCBoYXZlIGJlZW4gbWlzc2VkIGFueXdheSBiZWZvcmUgdGhpcyBleGlzdGVkLlxuICpcbiAqIEBwYXJhbSBydW5uZXJOYW1lIHJ1bm5lciBuYW1lLCB3aGljaCBpcyBhbHNvIHRoZSBzdGVwIGZ1bmN0aW9uIGV4ZWN1dGlvbiBuYW1lXG4gKiBAcmV0dXJucyBpZHMgb2YgdGhlIGluc3RhbmNlcyB3ZSBhc2tlZCB0byB0ZXJtaW5hdGVcbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHRlcm1pbmF0ZVJ1bm5lckluc3RhbmNlcyhydW5uZXJOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IHN0YWNrTmFtZSA9IHByb2Nlc3MuZW52LlNUQUNLX05BTUU7XG4gIGlmICghc3RhY2tOYW1lKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdNaXNzaW5nIFNUQUNLX05BTUUgZW52aXJvbm1lbnQgdmFyaWFibGUsIGNhbm5vdCB0ZXJtaW5hdGUgcnVubmVyIGluc3RhbmNlcycsXG4gICAgICBydW5uZXJOYW1lLFxuICAgIH0pO1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgaWRzID0gW107XG5cbiAgICBmb3IgYXdhaXQgKGNvbnN0IHBhZ2Ugb2YgcGFnaW5hdGVEZXNjcmliZUluc3RhbmNlcyh7IGNsaWVudDogZWMyIH0sIHtcbiAgICAgIEZpbHRlcnM6IFtcbiAgICAgICAgeyBOYW1lOiBgdGFnOiR7UmVzZXJ2ZWRUYWdzLlJVTk5FUn1gLCBWYWx1ZXM6IFtydW5uZXJOYW1lXSB9LFxuICAgICAgICB7IE5hbWU6IGB0YWc6JHtSZXNlcnZlZFRhZ3MuU1RBQ0t9YCwgVmFsdWVzOiBbc3RhY2tOYW1lXSB9LFxuICAgICAgICAvLyBhbnl0aGluZyBub3QgYWxyZWFkeSBvbiBpdHMgd2F5IG91dC4gYSBydW5uZXIgc2hvdWxkIG5ldmVyIGJlIHN0b3BwZWQsIGJ1dCBpZiBvbmUgc29tZWhvdyBpcywgaXQgc3RpbGwgaG9sZHMgYW4gRUJTIHZvbHVtZSB3ZSBhcmUgcGF5aW5nIGZvclxuICAgICAgICB7IE5hbWU6ICdpbnN0YW5jZS1zdGF0ZS1uYW1lJywgVmFsdWVzOiBbJ3BlbmRpbmcnLCAncnVubmluZycsICdzdG9wcGluZycsICdzdG9wcGVkJ10gfSxcbiAgICAgIF0sXG4gICAgfSkpIHtcbiAgICAgIC8vIHJlLWNoZWNrIHRoZSB0YWcgb3Vyc2VsdmVzIGluc3RlYWQgb2YgdHJ1c3RpbmcgdGhlIGZpbHRlci4gdGVybWluYXRpbmcgc29tZW9uZSBlbHNlJ3MgaW5zdGFuY2Ugd291bGQgYmUgZmFyIHdvcnNlIHRoYW4gbGVhdmluZyBvbmUgb2Ygb3Vyc1xuICAgICAgLy8gYmVoaW5kLCBzbyB0aGlzIGlzIHdvcnRoIHRoZSBmZXcgbGluZXNcbiAgICAgIGlkcy5wdXNoKC4uLihwYWdlLlJlc2VydmF0aW9ucyA/PyBbXSlcbiAgICAgICAgLmZsYXRNYXAociA9PiByLkluc3RhbmNlcyA/PyBbXSlcbiAgICAgICAgLmZpbHRlcihpID0+IHRhZ1ZhbHVlKGksIFJlc2VydmVkVGFncy5SVU5ORVIpID09PSBydW5uZXJOYW1lKVxuICAgICAgICAuZmlsdGVyKGkgPT4gdGFnVmFsdWUoaSwgUmVzZXJ2ZWRUYWdzLlNUQUNLKSA9PT0gc3RhY2tOYW1lKVxuICAgICAgICAubWFwKGkgPT4gaS5JbnN0YW5jZUlkKVxuICAgICAgICAuZmlsdGVyKChpZCk6IGlkIGlzIHN0cmluZyA9PiAhIWlkKSk7XG4gICAgfVxuXG4gICAgaWYgKGlkcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdUZXJtaW5hdGluZyBydW5uZXIgaW5zdGFuY2VzIHRoYXQgb3V0bGl2ZWQgdGhlaXIgam9iJyxcbiAgICAgIHJ1bm5lck5hbWUsXG4gICAgICBpbnN0YW5jZUlkczogaWRzLFxuICAgIH0pO1xuXG4gICAgY29uc3QgdGVybWluYXRlZDogc3RyaW5nW10gPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGlkcy5sZW5ndGg7IGkgKz0gMTAwKSB7XG4gICAgICBjb25zdCBiYXRjaCA9IGlkcy5zbGljZShpLCBpICsgMTAwKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGVjMi5zZW5kKG5ldyBUZXJtaW5hdGVJbnN0YW5jZXNDb21tYW5kKHsgSW5zdGFuY2VJZHM6IGJhdGNoIH0pKTtcbiAgICAgICAgdGVybWluYXRlZC5wdXNoKC4uLmJhdGNoKTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcih7IG5vdGljZTogJ0ZhaWxlZCB0byB0ZXJtaW5hdGUgYSBiYXRjaCBvZiBydW5uZXIgaW5zdGFuY2VzJywgcnVubmVyTmFtZSwgYmF0Y2gsIGVycm9yOiBlIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB0ZXJtaW5hdGVkO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdGYWlsZWQgdG8gdGVybWluYXRlIGxlZnRvdmVyIHJ1bm5lciBpbnN0YW5jZXMnLFxuICAgICAgcnVubmVyTmFtZSxcbiAgICAgIGVycm9yOiBlLFxuICAgIH0pO1xuICAgIHJldHVybiBbXTtcbiAgfVxufVxuIl19