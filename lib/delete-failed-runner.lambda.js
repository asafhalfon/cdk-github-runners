"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const lambda_github_1 = require("./lambda-github");
class RunnerBusy extends Error {
    constructor(msg) {
        super(msg);
        this.name = 'RunnerBusy';
        Object.setPrototypeOf(this, RunnerBusy.prototype);
    }
}
class ReraisedError extends Error {
    constructor(event) {
        super(event.error.Cause);
        this.name = event.error.Error;
        this.message = event.error.Cause;
        Object.setPrototypeOf(this, ReraisedError.prototype);
    }
}
async function handler(event) {
    const { octokit, githubSecrets } = await (0, lambda_github_1.getOctokit)(event.installationId);
    // find runner id
    const runner = await (0, lambda_github_1.getRunner)(octokit, githubSecrets.runnerLevel, event.owner, event.repo, event.runnerName);
    if (!runner) {
        console.error({
            notice: 'Unable to find runner id',
            owner: event.owner,
            repo: event.repo,
            runnerName: event.runnerName,
        });
        throw new ReraisedError(event);
    }
    console.log({
        notice: 'Found runner id',
        runnerName: event.runnerName,
        runnerId: runner.id,
        owner: event.owner,
        repo: event.repo,
    });
    // delete runner (it usually gets deleted by ./run.sh, but it stopped prematurely if we're here).
    // it seems like runners are automatically removed after a timeout, if they first accepted a job.
    // we try removing it anyway for cases where a job wasn't accepted, and just in case it wasn't removed.
    // repos have a limited number of self-hosted runners, so we can't leave dead ones behind.
    try {
        await (0, lambda_github_1.deleteRunner)(octokit, githubSecrets.runnerLevel, event.owner, event.repo, runner.id);
    }
    catch (e) {
        const reqError = e;
        if (reqError.message.includes('is still running a job')) {
            // ideally we would stop the job that's hanging on this failed runner, but GitHub Actions only has API to stop the entire workflow
            throw new RunnerBusy(reqError.message);
        }
        else {
            console.error({
                notice: 'Unable to delete runner',
                owner: event.owner,
                repo: event.repo,
                runnerId: runner.id,
                runnerName: event.runnerName,
                error: e,
            });
        }
    }
    throw new ReraisedError(event);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLWZhaWxlZC1ydW5uZXIubGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2RlbGV0ZS1mYWlsZWQtcnVubmVyLmxhbWJkYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQXFCQSwwQkErQ0M7QUFuRUQsbURBQXNFO0FBR3RFLE1BQU0sVUFBVyxTQUFRLEtBQUs7SUFDNUIsWUFBWSxHQUFXO1FBQ3JCLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNYLElBQUksQ0FBQyxJQUFJLEdBQUcsWUFBWSxDQUFDO1FBQ3pCLE1BQU0sQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNwRCxDQUFDO0NBQ0Y7QUFFRCxNQUFNLGFBQWMsU0FBUSxLQUFLO0lBQy9CLFlBQVksS0FBOEI7UUFDeEMsS0FBSyxDQUFDLEtBQUssQ0FBQyxLQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDMUIsSUFBSSxDQUFDLElBQUksR0FBRyxLQUFLLENBQUMsS0FBTSxDQUFDLEtBQUssQ0FBQztRQUMvQixJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQyxLQUFNLENBQUMsS0FBSyxDQUFDO1FBQ2xDLE1BQU0sQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUN2RCxDQUFDO0NBQ0Y7QUFFTSxLQUFLLFVBQVUsT0FBTyxDQUFDLEtBQThCO0lBQzFELE1BQU0sRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFFLEdBQUcsTUFBTSxJQUFBLDBCQUFVLEVBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBRTFFLGlCQUFpQjtJQUNqQixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUEseUJBQVMsRUFBQyxPQUFPLEVBQUUsYUFBYSxDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzlHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNaLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsMEJBQTBCO1lBQ2xDLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztZQUNsQixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7WUFDaEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1NBQzdCLENBQUMsQ0FBQztRQUNILE1BQU0sSUFBSSxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVELE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFDVixNQUFNLEVBQUUsaUJBQWlCO1FBQ3pCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtRQUM1QixRQUFRLEVBQUUsTUFBTSxDQUFDLEVBQUU7UUFDbkIsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1FBQ2xCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtLQUNqQixDQUFDLENBQUM7SUFFSCxpR0FBaUc7SUFDakcsaUdBQWlHO0lBQ2pHLHVHQUF1RztJQUN2RywwRkFBMEY7SUFDMUYsSUFBSSxDQUFDO1FBQ0gsTUFBTSxJQUFBLDRCQUFZLEVBQUMsT0FBTyxFQUFFLGFBQWEsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUM3RixDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE1BQU0sUUFBUSxHQUFpQixDQUFDLENBQUM7UUFDakMsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUM7WUFDeEQsa0lBQWtJO1lBQ2xJLE1BQU0sSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3pDLENBQUM7YUFBTSxDQUFDO1lBQ04sT0FBTyxDQUFDLEtBQUssQ0FBQztnQkFDWixNQUFNLEVBQUUseUJBQXlCO2dCQUNqQyxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUs7Z0JBQ2xCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtnQkFDaEIsUUFBUSxFQUFFLE1BQU0sQ0FBQyxFQUFFO2dCQUNuQixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7Z0JBQzVCLEtBQUssRUFBRSxDQUFDO2FBQ1QsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztJQUNILENBQUM7SUFFRCxNQUFNLElBQUksYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO0FBQ2pDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IFJlcXVlc3RFcnJvciB9IGZyb20gJ0BvY3Rva2l0L3JlcXVlc3QtZXJyb3InO1xuaW1wb3J0IHsgZGVsZXRlUnVubmVyLCBnZXRPY3Rva2l0LCBnZXRSdW5uZXIgfSBmcm9tICcuL2xhbWJkYS1naXRodWInO1xuaW1wb3J0IHsgU3RlcEZ1bmN0aW9uTGFtYmRhSW5wdXQgfSBmcm9tICcuL2xhbWJkYS1oZWxwZXJzJztcblxuY2xhc3MgUnVubmVyQnVzeSBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobXNnOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtc2cpO1xuICAgIHRoaXMubmFtZSA9ICdSdW5uZXJCdXN5JztcbiAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGhpcywgUnVubmVyQnVzeS5wcm90b3R5cGUpO1xuICB9XG59XG5cbmNsYXNzIFJlcmFpc2VkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKGV2ZW50OiBTdGVwRnVuY3Rpb25MYW1iZGFJbnB1dCkge1xuICAgIHN1cGVyKGV2ZW50LmVycm9yIS5DYXVzZSk7XG4gICAgdGhpcy5uYW1lID0gZXZlbnQuZXJyb3IhLkVycm9yO1xuICAgIHRoaXMubWVzc2FnZSA9IGV2ZW50LmVycm9yIS5DYXVzZTtcbiAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGhpcywgUmVyYWlzZWRFcnJvci5wcm90b3R5cGUpO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKGV2ZW50OiBTdGVwRnVuY3Rpb25MYW1iZGFJbnB1dCkge1xuICBjb25zdCB7IG9jdG9raXQsIGdpdGh1YlNlY3JldHMgfSA9IGF3YWl0IGdldE9jdG9raXQoZXZlbnQuaW5zdGFsbGF0aW9uSWQpO1xuXG4gIC8vIGZpbmQgcnVubmVyIGlkXG4gIGNvbnN0IHJ1bm5lciA9IGF3YWl0IGdldFJ1bm5lcihvY3Rva2l0LCBnaXRodWJTZWNyZXRzLnJ1bm5lckxldmVsLCBldmVudC5vd25lciwgZXZlbnQucmVwbywgZXZlbnQucnVubmVyTmFtZSk7XG4gIGlmICghcnVubmVyKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdVbmFibGUgdG8gZmluZCBydW5uZXIgaWQnLFxuICAgICAgb3duZXI6IGV2ZW50Lm93bmVyLFxuICAgICAgcmVwbzogZXZlbnQucmVwbyxcbiAgICAgIHJ1bm5lck5hbWU6IGV2ZW50LnJ1bm5lck5hbWUsXG4gICAgfSk7XG4gICAgdGhyb3cgbmV3IFJlcmFpc2VkRXJyb3IoZXZlbnQpO1xuICB9XG5cbiAgY29uc29sZS5sb2coe1xuICAgIG5vdGljZTogJ0ZvdW5kIHJ1bm5lciBpZCcsXG4gICAgcnVubmVyTmFtZTogZXZlbnQucnVubmVyTmFtZSxcbiAgICBydW5uZXJJZDogcnVubmVyLmlkLFxuICAgIG93bmVyOiBldmVudC5vd25lcixcbiAgICByZXBvOiBldmVudC5yZXBvLFxuICB9KTtcblxuICAvLyBkZWxldGUgcnVubmVyIChpdCB1c3VhbGx5IGdldHMgZGVsZXRlZCBieSAuL3J1bi5zaCwgYnV0IGl0IHN0b3BwZWQgcHJlbWF0dXJlbHkgaWYgd2UncmUgaGVyZSkuXG4gIC8vIGl0IHNlZW1zIGxpa2UgcnVubmVycyBhcmUgYXV0b21hdGljYWxseSByZW1vdmVkIGFmdGVyIGEgdGltZW91dCwgaWYgdGhleSBmaXJzdCBhY2NlcHRlZCBhIGpvYi5cbiAgLy8gd2UgdHJ5IHJlbW92aW5nIGl0IGFueXdheSBmb3IgY2FzZXMgd2hlcmUgYSBqb2Igd2Fzbid0IGFjY2VwdGVkLCBhbmQganVzdCBpbiBjYXNlIGl0IHdhc24ndCByZW1vdmVkLlxuICAvLyByZXBvcyBoYXZlIGEgbGltaXRlZCBudW1iZXIgb2Ygc2VsZi1ob3N0ZWQgcnVubmVycywgc28gd2UgY2FuJ3QgbGVhdmUgZGVhZCBvbmVzIGJlaGluZC5cbiAgdHJ5IHtcbiAgICBhd2FpdCBkZWxldGVSdW5uZXIob2N0b2tpdCwgZ2l0aHViU2VjcmV0cy5ydW5uZXJMZXZlbCwgZXZlbnQub3duZXIsIGV2ZW50LnJlcG8sIHJ1bm5lci5pZCk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zdCByZXFFcnJvciA9IDxSZXF1ZXN0RXJyb3I+ZTtcbiAgICBpZiAocmVxRXJyb3IubWVzc2FnZS5pbmNsdWRlcygnaXMgc3RpbGwgcnVubmluZyBhIGpvYicpKSB7XG4gICAgICAvLyBpZGVhbGx5IHdlIHdvdWxkIHN0b3AgdGhlIGpvYiB0aGF0J3MgaGFuZ2luZyBvbiB0aGlzIGZhaWxlZCBydW5uZXIsIGJ1dCBHaXRIdWIgQWN0aW9ucyBvbmx5IGhhcyBBUEkgdG8gc3RvcCB0aGUgZW50aXJlIHdvcmtmbG93XG4gICAgICB0aHJvdyBuZXcgUnVubmVyQnVzeShyZXFFcnJvci5tZXNzYWdlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc29sZS5lcnJvcih7XG4gICAgICAgIG5vdGljZTogJ1VuYWJsZSB0byBkZWxldGUgcnVubmVyJyxcbiAgICAgICAgb3duZXI6IGV2ZW50Lm93bmVyLFxuICAgICAgICByZXBvOiBldmVudC5yZXBvLFxuICAgICAgICBydW5uZXJJZDogcnVubmVyLmlkLFxuICAgICAgICBydW5uZXJOYW1lOiBldmVudC5ydW5uZXJOYW1lLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBSZXJhaXNlZEVycm9yKGV2ZW50KTtcbn1cbiJdfQ==