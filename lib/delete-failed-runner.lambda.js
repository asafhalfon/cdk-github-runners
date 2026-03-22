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
                error: `${e}`,
            });
        }
    }
    throw new ReraisedError(event);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLWZhaWxlZC1ydW5uZXIubGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2RlbGV0ZS1mYWlsZWQtcnVubmVyLmxhbWJkYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQXFCQSwwQkErQ0M7QUFuRUQsbURBQXNFO0FBR3RFLE1BQU0sVUFBVyxTQUFRLEtBQUs7SUFDNUIsWUFBWSxHQUFXO1FBQ3JCLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNYLElBQUksQ0FBQyxJQUFJLEdBQUcsWUFBWSxDQUFDO1FBQ3pCLE1BQU0sQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLFVBQVUsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNwRCxDQUFDO0NBQ0Y7QUFFRCxNQUFNLGFBQWMsU0FBUSxLQUFLO0lBQy9CLFlBQVksS0FBOEI7UUFDeEMsS0FBSyxDQUFDLEtBQUssQ0FBQyxLQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDMUIsSUFBSSxDQUFDLElBQUksR0FBRyxLQUFLLENBQUMsS0FBTSxDQUFDLEtBQUssQ0FBQztRQUMvQixJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQyxLQUFNLENBQUMsS0FBSyxDQUFDO1FBQ2xDLE1BQU0sQ0FBQyxjQUFjLENBQUMsSUFBSSxFQUFFLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUN2RCxDQUFDO0NBQ0Y7QUFFTSxLQUFLLFVBQVUsT0FBTyxDQUFDLEtBQThCO0lBQzFELE1BQU0sRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFFLEdBQUcsTUFBTSxJQUFBLDBCQUFVLEVBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO0lBRTFFLGlCQUFpQjtJQUNqQixNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUEseUJBQVMsRUFBQyxPQUFPLEVBQUUsYUFBYSxDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO0lBQzlHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQztRQUNaLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsMEJBQTBCO1lBQ2xDLEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztZQUNsQixJQUFJLEVBQUUsS0FBSyxDQUFDLElBQUk7WUFDaEIsVUFBVSxFQUFFLEtBQUssQ0FBQyxVQUFVO1NBQzdCLENBQUMsQ0FBQztRQUNILE1BQU0sSUFBSSxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVELE9BQU8sQ0FBQyxHQUFHLENBQUM7UUFDVixNQUFNLEVBQUUsaUJBQWlCO1FBQ3pCLFVBQVUsRUFBRSxLQUFLLENBQUMsVUFBVTtRQUM1QixRQUFRLEVBQUUsTUFBTSxDQUFDLEVBQUU7UUFDbkIsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1FBQ2xCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtLQUNqQixDQUFDLENBQUM7SUFFSCxpR0FBaUc7SUFDakcsaUdBQWlHO0lBQ2pHLHVHQUF1RztJQUN2RywwRkFBMEY7SUFDMUYsSUFBSSxDQUFDO1FBQ0gsTUFBTSxJQUFBLDRCQUFZLEVBQUMsT0FBTyxFQUFFLGFBQWEsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUM3RixDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE1BQU0sUUFBUSxHQUFpQixDQUFDLENBQUM7UUFDakMsSUFBSSxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyx3QkFBd0IsQ0FBQyxFQUFFLENBQUM7WUFDeEQsa0lBQWtJO1lBQ2xJLE1BQU0sSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3pDLENBQUM7YUFBTSxDQUFDO1lBQ04sT0FBTyxDQUFDLEtBQUssQ0FBQztnQkFDWixNQUFNLEVBQUUseUJBQXlCO2dCQUNqQyxLQUFLLEVBQUUsS0FBSyxDQUFDLEtBQUs7Z0JBQ2xCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtnQkFDaEIsUUFBUSxFQUFFLE1BQU0sQ0FBQyxFQUFFO2dCQUNuQixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7Z0JBQzVCLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRTthQUNkLENBQUMsQ0FBQztRQUNMLENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxJQUFJLGFBQWEsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNqQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBSZXF1ZXN0RXJyb3IgfSBmcm9tICdAb2N0b2tpdC9yZXF1ZXN0LWVycm9yJztcbmltcG9ydCB7IGRlbGV0ZVJ1bm5lciwgZ2V0T2N0b2tpdCwgZ2V0UnVubmVyIH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcbmltcG9ydCB7IFN0ZXBGdW5jdGlvbkxhbWJkYUlucHV0IH0gZnJvbSAnLi9sYW1iZGEtaGVscGVycyc7XG5cbmNsYXNzIFJ1bm5lckJ1c3kgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1zZzogc3RyaW5nKSB7XG4gICAgc3VwZXIobXNnKTtcbiAgICB0aGlzLm5hbWUgPSAnUnVubmVyQnVzeSc7XG4gICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRoaXMsIFJ1bm5lckJ1c3kucHJvdG90eXBlKTtcbiAgfVxufVxuXG5jbGFzcyBSZXJhaXNlZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihldmVudDogU3RlcEZ1bmN0aW9uTGFtYmRhSW5wdXQpIHtcbiAgICBzdXBlcihldmVudC5lcnJvciEuQ2F1c2UpO1xuICAgIHRoaXMubmFtZSA9IGV2ZW50LmVycm9yIS5FcnJvcjtcbiAgICB0aGlzLm1lc3NhZ2UgPSBldmVudC5lcnJvciEuQ2F1c2U7XG4gICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRoaXMsIFJlcmFpc2VkRXJyb3IucHJvdG90eXBlKTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogU3RlcEZ1bmN0aW9uTGFtYmRhSW5wdXQpIHtcbiAgY29uc3QgeyBvY3Rva2l0LCBnaXRodWJTZWNyZXRzIH0gPSBhd2FpdCBnZXRPY3Rva2l0KGV2ZW50Lmluc3RhbGxhdGlvbklkKTtcblxuICAvLyBmaW5kIHJ1bm5lciBpZFxuICBjb25zdCBydW5uZXIgPSBhd2FpdCBnZXRSdW5uZXIob2N0b2tpdCwgZ2l0aHViU2VjcmV0cy5ydW5uZXJMZXZlbCwgZXZlbnQub3duZXIsIGV2ZW50LnJlcG8sIGV2ZW50LnJ1bm5lck5hbWUpO1xuICBpZiAoIXJ1bm5lcikge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnVW5hYmxlIHRvIGZpbmQgcnVubmVyIGlkJyxcbiAgICAgIG93bmVyOiBldmVudC5vd25lcixcbiAgICAgIHJlcG86IGV2ZW50LnJlcG8sXG4gICAgICBydW5uZXJOYW1lOiBldmVudC5ydW5uZXJOYW1lLFxuICAgIH0pO1xuICAgIHRocm93IG5ldyBSZXJhaXNlZEVycm9yKGV2ZW50KTtcbiAgfVxuXG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdGb3VuZCBydW5uZXIgaWQnLFxuICAgIHJ1bm5lck5hbWU6IGV2ZW50LnJ1bm5lck5hbWUsXG4gICAgcnVubmVySWQ6IHJ1bm5lci5pZCxcbiAgICBvd25lcjogZXZlbnQub3duZXIsXG4gICAgcmVwbzogZXZlbnQucmVwbyxcbiAgfSk7XG5cbiAgLy8gZGVsZXRlIHJ1bm5lciAoaXQgdXN1YWxseSBnZXRzIGRlbGV0ZWQgYnkgLi9ydW4uc2gsIGJ1dCBpdCBzdG9wcGVkIHByZW1hdHVyZWx5IGlmIHdlJ3JlIGhlcmUpLlxuICAvLyBpdCBzZWVtcyBsaWtlIHJ1bm5lcnMgYXJlIGF1dG9tYXRpY2FsbHkgcmVtb3ZlZCBhZnRlciBhIHRpbWVvdXQsIGlmIHRoZXkgZmlyc3QgYWNjZXB0ZWQgYSBqb2IuXG4gIC8vIHdlIHRyeSByZW1vdmluZyBpdCBhbnl3YXkgZm9yIGNhc2VzIHdoZXJlIGEgam9iIHdhc24ndCBhY2NlcHRlZCwgYW5kIGp1c3QgaW4gY2FzZSBpdCB3YXNuJ3QgcmVtb3ZlZC5cbiAgLy8gcmVwb3MgaGF2ZSBhIGxpbWl0ZWQgbnVtYmVyIG9mIHNlbGYtaG9zdGVkIHJ1bm5lcnMsIHNvIHdlIGNhbid0IGxlYXZlIGRlYWQgb25lcyBiZWhpbmQuXG4gIHRyeSB7XG4gICAgYXdhaXQgZGVsZXRlUnVubmVyKG9jdG9raXQsIGdpdGh1YlNlY3JldHMucnVubmVyTGV2ZWwsIGV2ZW50Lm93bmVyLCBldmVudC5yZXBvLCBydW5uZXIuaWQpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc3QgcmVxRXJyb3IgPSA8UmVxdWVzdEVycm9yPmU7XG4gICAgaWYgKHJlcUVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoJ2lzIHN0aWxsIHJ1bm5pbmcgYSBqb2InKSkge1xuICAgICAgLy8gaWRlYWxseSB3ZSB3b3VsZCBzdG9wIHRoZSBqb2IgdGhhdCdzIGhhbmdpbmcgb24gdGhpcyBmYWlsZWQgcnVubmVyLCBidXQgR2l0SHViIEFjdGlvbnMgb25seSBoYXMgQVBJIHRvIHN0b3AgdGhlIGVudGlyZSB3b3JrZmxvd1xuICAgICAgdGhyb3cgbmV3IFJ1bm5lckJ1c3kocmVxRXJyb3IubWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgICBub3RpY2U6ICdVbmFibGUgdG8gZGVsZXRlIHJ1bm5lcicsXG4gICAgICAgIG93bmVyOiBldmVudC5vd25lcixcbiAgICAgICAgcmVwbzogZXZlbnQucmVwbyxcbiAgICAgICAgcnVubmVySWQ6IHJ1bm5lci5pZCxcbiAgICAgICAgcnVubmVyTmFtZTogZXZlbnQucnVubmVyTmFtZSxcbiAgICAgICAgZXJyb3I6IGAke2V9YCxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIHRocm93IG5ldyBSZXJhaXNlZEVycm9yKGV2ZW50KTtcbn1cbiJdfQ==