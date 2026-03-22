"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const lambda_github_1 = require("./lambda-github");
class RunnerTokenError extends Error {
    constructor(msg) {
        super(msg);
        this.name = 'RunnerTokenError';
        Object.setPrototypeOf(this, RunnerTokenError.prototype);
    }
}
async function handler(event) {
    try {
        const { githubSecrets, octokit, } = await (0, lambda_github_1.getOctokit)(event.installationId);
        // Before creating a runner, check if the job is still queued.
        // This prevents wasting resources when a job was already picked up by
        // another runner (e.g., during retries or when runners race for jobs
        // with identical labels under burst load).
        if (event.jobId) {
            const jobStatus = await checkJobStatus(octokit, event.owner, event.repo, event.jobId);
            if (jobStatus !== 'queued') {
                console.log({
                    notice: 'Job is no longer queued, skipping runner creation',
                    jobId: event.jobId,
                    jobStatus,
                    owner: event.owner,
                    repo: event.repo,
                });
                return {
                    domain: githubSecrets.domain,
                    skip: true,
                    token: '',
                    registrationUrl: '',
                    jitConfig: '',
                    runnerId: 0,
                };
            }
        }
        // Use JIT runner config when jobId is available.
        // JIT provides a cleaner registration path (no config.sh needed) and
        // built-in ephemeral behavior. Note: JIT does not pin runners to specific
        // jobs — GitHub still dispatches based on label matching.
        if (event.jobId) {
            const jitResult = await getJitConfig(octokit, githubSecrets.runnerLevel, event.owner, event.repo, event.runnerName, event.labels, event.jobId);
            return {
                domain: githubSecrets.domain,
                jitConfig: jitResult.encodedJitConfig,
                runnerId: jitResult.runnerId,
                skip: false,
                token: '',
                registrationUrl: '',
            };
        }
        // Fallback: legacy registration token flow
        let token;
        let registrationUrl;
        if (githubSecrets.runnerLevel === 'repo' || githubSecrets.runnerLevel === undefined) {
            token = await getRegistrationTokenForRepo(octokit, event.owner, event.repo);
            registrationUrl = `https://${githubSecrets.domain}/${event.owner}/${event.repo}`;
        }
        else if (githubSecrets.runnerLevel === 'org') {
            token = await getRegistrationTokenForOrg(octokit, event.owner);
            registrationUrl = `https://${githubSecrets.domain}/${event.owner}`;
        }
        else {
            throw new RunnerTokenError('Invalid runner level');
        }
        return {
            domain: githubSecrets.domain,
            token,
            registrationUrl,
            jitConfig: '',
            runnerId: 0,
            skip: false,
        };
    }
    catch (error) {
        console.error({
            notice: 'Failed to retrieve runner registration token',
            owner: event.owner,
            repo: event.repo,
            runnerName: event.runnerName,
            jobId: event.jobId,
            error: `${error}`,
        });
        throw new RunnerTokenError(error.message);
    }
}
/**
 * Ensure JIT runners include the default GitHub runner labels.
 * Unlike config.sh which adds these automatically, the generate-jitconfig
 * API only registers the labels you explicitly provide.
 */
function ensureDefaultLabels(labels) {
    const defaultLabels = ['self-hosted'];
    const lowerLabels = labels.map(l => l.toLowerCase());
    for (const dl of defaultLabels) {
        if (!lowerLabels.includes(dl.toLowerCase())) {
            labels.unshift(dl);
        }
    }
    return labels;
}
async function checkJobStatus(octokit, owner, repo, jobId) {
    const response = await octokit.rest.actions.getJobForWorkflowRun({
        owner,
        repo,
        job_id: jobId,
    });
    return response.data.status;
}
async function getJitConfig(octokit, runnerLevel, owner, repo, runnerName, labels, jobId) {
    const runnerGroupId = 1; // Default runner group
    const body = {
        name: runnerName,
        runner_group_id: runnerGroupId,
        labels: ensureDefaultLabels((Array.isArray(labels) ? labels : labels.split(',')).map((l) => l.trim()).filter((l) => l.length > 0)),
        work_folder: '_work',
    };
    let response;
    if ((runnerLevel ?? 'repo') === 'repo') {
        response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig', {
            owner,
            repo,
            ...body,
        });
    }
    else {
        response = await octokit.request('POST /orgs/{org}/actions/runners/generate-jitconfig', {
            org: owner,
            ...body,
        });
    }
    console.log({
        notice: 'Generated JIT runner config',
        runnerId: response.data.runner.id,
        runnerName: response.data.runner.name,
        jobId,
    });
    return {
        encodedJitConfig: response.data.encoded_jit_config,
        runnerId: response.data.runner.id,
    };
}
async function getRegistrationTokenForOrg(octokit, owner) {
    const response = await octokit.rest.actions.createRegistrationTokenForOrg({
        org: owner,
    });
    return response.data.token;
}
async function getRegistrationTokenForRepo(octokit, owner, repo) {
    const response = await octokit.rest.actions.createRegistrationTokenForRepo({
        owner: owner,
        repo: repo,
    });
    return response.data.token;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9rZW4tcmV0cmlldmVyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy90b2tlbi1yZXRyaWV2ZXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBYUEsMEJBK0VDO0FBM0ZELG1EQUE2QztBQUc3QyxNQUFNLGdCQUFpQixTQUFRLEtBQUs7SUFDbEMsWUFBWSxHQUFXO1FBQ3JCLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNYLElBQUksQ0FBQyxJQUFJLEdBQUcsa0JBQWtCLENBQUM7UUFDL0IsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDMUQsQ0FBQztDQUNGO0FBR00sS0FBSyxVQUFVLE9BQU8sQ0FBQyxLQUE4QjtJQUMxRCxJQUFJLENBQUM7UUFDSCxNQUFNLEVBQ0osYUFBYSxFQUNiLE9BQU8sR0FDUixHQUFHLE1BQU0sSUFBQSwwQkFBVSxFQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUUzQyw4REFBOEQ7UUFDOUQsc0VBQXNFO1FBQ3RFLHFFQUFxRTtRQUNyRSwyQ0FBMkM7UUFDM0MsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDaEIsTUFBTSxTQUFTLEdBQUcsTUFBTSxjQUFjLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDdEYsSUFBSSxTQUFTLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQzNCLE9BQU8sQ0FBQyxHQUFHLENBQUM7b0JBQ1YsTUFBTSxFQUFFLG1EQUFtRDtvQkFDM0QsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO29CQUNsQixTQUFTO29CQUNULEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztvQkFDbEIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO2lCQUNqQixDQUFDLENBQUM7Z0JBQ0gs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QVUsMkJBQTJCLENBQUMsT0FBZ0IsRUFBRSxLQUFhLEVBQUUsSUFBWTtJQUN0RixNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLDhCQUE4QixDQUFDO1FBQ3pFLEtBQUssRUFBRSxLQUFLO1FBQ1osSUFBSSxFQUFFLElBQUk7S0FDWCxDQUFDLENBQUM7SUFDSCxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDO0FBQzdCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgdHlwZSB7IE9jdG9raXQgfSBmcm9tICdAb2N0b2tpdC9yZXN0JztcbmltcG9ydCB7IGdldE9jdG9raXQgfSBmcm9tICcuL2xhbWJkYS1naXRodWInO1xuaW1wb3J0IHsgU3RlcEZ1bmN0aW9uTGFtYmRhSW5wdXQgfSBmcm9tICcuL2xhbWJkYS1oZWxwZXJzJztcblxuY2xhc3MgUnVubmVyVG9rZW5FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobXNnOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtc2cpO1xuICAgIHRoaXMubmFtZSA9ICdSdW5uZXJUb2tlbkVycm9yJztcbiAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGhpcywgUnVubmVyVG9rZW5FcnJvci5wcm90b3R5cGUpO1xuICB9XG59XG5cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQ6IFN0ZXBGdW5jdGlvbkxhbWJkYUlucHV0KSB7XG4gIHRyeSB7XG4gICAgY29uc3Qge1xuICAgICAgZ2l0aHViU2VjcmV0cyxcbiAgICAgIG9jdG9raXQsXG4gICAgfSA9IGF3YWl0IGdldE9jdG9raXQoZXZlbnQuaW5zdGFsbGF0aW9uSWQpO1xuXG4gICAgLy8gQmVmb3JlIGNyZWF0aW5nIGEgcnVubmVyLCBjaGVjayBpZiB0aGUgam9iIGlzIHN0aWxsIHF1ZXVlZC5cbiAgICAvLyBUaGlzIHByZXZlbnRzIHdhc3RpbmcgcmVzb3VyY2VzIHdoZW4gYSBqb2Igd2FzIGFscmVhZHkgcGlja2VkIHVwIGJ5XG4gICAgLy8gYW5vdGhlciBydW5uZXIgKGUuZy4sIGR1cmluZyByZXRyaWVzIG9yIHdoZW4gcnVubmVycyByYWNlIGZvciBqb2JzXG4gICAgLy8gd2l0aCBpZGVudGljYWwgbGFiZWxzIHVuZGVyIGJ1cnN0IGxvYWQpLlxuICAgIGlmIChldmVudC5qb2JJZCkge1xuICAgICAgY29uc3Qgam9iU3RhdHVzID0gYXdhaXQgY2hlY2tKb2JTdGF0dXMob2N0b2tpdCwgZXZlbnQub3duZXIsIGV2ZW50LnJlcG8sIGV2ZW50LmpvYklkKTtcbiAgICAgIGlmIChqb2JTdGF0dXMgIT09ICdxdWV1ZWQnKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgICBub3RpY2U6ICdKb2IgaXMgbm8gbG9uZ2VyIHF1ZXVlZCwgc2tpcHBpbmcgcnVubmVyIGNyZWF0aW9uJyxcbiAgICAgICAgICBqb2JJZDogZXZlbnQuam9iSWQsXG4gICAgICAgICAgam9iU3RhdHVzLFxuICAgICAgICAgIG93bmVyOiBldmVudC5vd25lcixcbiAgICAgICAgICByZXBvOiBldmVudC5yZXBvLFxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBkb21haW46IGdpdGh1YlNlY3JldHMuZG9tYWluLFxuICAgICAgICAgIHNraXA6IHRydWUsXG4gICAgICAgICAgdG9rZW46ICcnLFxuICAgICAgICAgIHJlZ2lzdHJhdGlvblVybDogJycsXG4gICAgICAgICAgaml0Q29uZmlnOiAnJyxcbiAgICAgICAgICBydW5uZXJJZDogMCxcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBVc2UgSklUIHJ1bm5lciBjb25maWcgd2hlbiBqb2JJZCBpcyBhdmFpbGFibGUuXG4gICAgLy8gSklUIHByb3ZpZGVzIGEgY2xlYW5lciByZWdpc3RyYXRpb24gcGF0aCAobm8gY29uZmlnLnNoIG5lZWRlZCkgYW5kXG4gICAgLy8gYnVpbHQtaW4gZXBoZW1lcmFsIGJlaGF2aW9yLiBOb3RlOiBKSVQgZG9lcyBub3QgcGluIHJ1bm5lcnMgdG8gc3BlY2lmaWNcbiAgICAvLyBqb2JzIOKAlCBHaXRIdWIgc3RpbGwgZGlzcGF0Y2hlcyBiYXNlZCBvbiBsYWJlbCBtYXRjaGluZy5cbiAgICBpZiAoZXZlbnQuam9iSWQpIHtcbiAgICAgIGNvbnN0IGppdFJlc3VsdCA9IGF3YWl0IGdldEppdENvbmZpZyhvY3Rva2l0LCBnaXRodWJTZWNyZXRzLnJ1bm5lckxldmVsLCBldmVudC5vd25lciwgZXZlbnQucmVwbywgZXZlbnQucnVubmVyTmFtZSwgZXZlbnQubGFiZWxzLCBldmVudC5qb2JJZCk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBkb21haW46IGdpdGh1YlNlY3JldHMuZG9tYWluLFxuICAgICAgICBqaXRDb25maWc6IGppdFJlc3VsdC5lbmNvZGVkSml0Q29uZmlnLFxuICAgICAgICBydW5uZXJJZDogaml0UmVzdWx0LnJ1bm5lcklkLFxuICAgICAgICBza2lwOiBmYWxzZSxcbiAgICAgICAgdG9rZW46ICcnLFxuICAgICAgICByZWdpc3RyYXRpb25Vcmw6ICcnLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBGYWxsYmFjazogbGVnYWN5IHJlZ2lzdHJhdGlvbiB0b2tlbiBmbG93XG4gICAgbGV0IHRva2VuOiBzdHJpbmc7XG4gICAgbGV0IHJlZ2lzdHJhdGlvblVybDogc3RyaW5nO1xuICAgIGlmIChnaXRodWJTZWNyZXRzLnJ1bm5lckxldmVsID09PSAncmVwbycgfHwgZ2l0aHViU2VjcmV0cy5ydW5uZXJMZXZlbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0b2tlbiA9IGF3YWl0IGdldFJlZ2lzdHJhdGlvblRva2VuRm9yUmVwbyhvY3Rva2l0LCBldmVudC5vd25lciwgZXZlbnQucmVwbyk7XG4gICAgICByZWdpc3RyYXRpb25VcmwgPSBgaHR0cHM6Ly8ke2dpdGh1YlNlY3JldHMuZG9tYWlufS8ke2V2ZW50Lm93bmVyfS8ke2V2ZW50LnJlcG99YDtcbiAgICB9IGVsc2UgaWYgKGdpdGh1YlNlY3JldHMucnVubmVyTGV2ZWwgPT09ICdvcmcnKSB7XG4gICAgICB0b2tlbiA9IGF3YWl0IGdldFJlZ2lzdHJhdGlvblRva2VuRm9yT3JnKG9jdG9raXQsIGV2ZW50Lm93bmVyKTtcbiAgICAgIHJlZ2lzdHJhdGlvblVybCA9IGBodHRwczovLyR7Z2l0aHViU2VjcmV0cy5kb21haW59LyR7ZXZlbnQub3duZXJ9YDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFJ1bm5lclRva2VuRXJyb3IoJ0ludmFsaWQgcnVubmVyIGxldmVsJyk7XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBkb21haW46IGdpdGh1YlNlY3JldHMuZG9tYWluLFxuICAgICAgdG9rZW4sXG4gICAgICByZWdpc3RyYXRpb25VcmwsXG4gICAgICBqaXRDb25maWc6ICcnLFxuICAgICAgcnVubmVySWQ6IDAsXG4gICAgICBza2lwOiBmYWxzZSxcbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIHJldHJpZXZlIHJ1bm5lciByZWdpc3RyYXRpb24gdG9rZW4nLFxuICAgICAgb3duZXI6IGV2ZW50Lm93bmVyLFxuICAgICAgcmVwbzogZXZlbnQucmVwbyxcbiAgICAgIHJ1bm5lck5hbWU6IGV2ZW50LnJ1bm5lck5hbWUsXG4gICAgICBqb2JJZDogZXZlbnQuam9iSWQsXG4gICAgICBlcnJvcjogYCR7ZXJyb3J9YCxcbiAgICB9KTtcbiAgICB0aHJvdyBuZXcgUnVubmVyVG9rZW5FcnJvcigoPEVycm9yPmVycm9yKS5tZXNzYWdlKTtcbiAgfVxufVxuXG50eXBlIFJ1bm5lckxldmVsID0gJ3JlcG8nIHwgJ29yZycgfCB1bmRlZmluZWQ7XG5cbi8qKlxuICogRW5zdXJlIEpJVCBydW5uZXJzIGluY2x1ZGUgdGhlIGRlZmF1bHQgR2l0SHViIHJ1bm5lciBsYWJlbHMuXG4gKiBVbmxpa2UgY29uZmlnLnNoIHdoaWNoIGFkZHMgdGhlc2UgYXV0b21hdGljYWxseSwgdGhlIGdlbmVyYXRlLWppdGNvbmZpZ1xuICogQVBJIG9ubHkgcmVnaXN0ZXJzIHRoZSBsYWJlbHMgeW91IGV4cGxpY2l0bHkgcHJvdmlkZS5cbiAqL1xuZnVuY3Rpb24gZW5zdXJlRGVmYXVsdExhYmVscyhsYWJlbHM6IHN0cmluZ1tdKTogc3RyaW5nW10ge1xuICBjb25zdCBkZWZhdWx0TGFiZWxzID0gWydzZWxmLWhvc3RlZCddO1xuICBjb25zdCBsb3dlckxhYmVscyA9IGxhYmVscy5tYXAobCA9PiBsLnRvTG93ZXJDYXNlKCkpO1xuICBmb3IgKGNvbnN0IGRsIG9mIGRlZmF1bHRMYWJlbHMpIHtcbiAgICBpZiAoIWxvd2VyTGFiZWxzLmluY2x1ZGVzKGRsLnRvTG93ZXJDYXNlKCkpKSB7XG4gICAgICBsYWJlbHMudW5zaGlmdChkbCk7XG4gICAgfVxuICB9XG4gIHJldHVybiBsYWJlbHM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrSm9iU3RhdHVzKFxuICBvY3Rva2l0OiBPY3Rva2l0LFxuICBvd25lcjogc3RyaW5nLFxuICByZXBvOiBzdHJpbmcsXG4gIGpvYklkOiBudW1iZXIsXG4pOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IG9jdG9raXQucmVzdC5hY3Rpb25zLmdldEpvYkZvcldvcmtmbG93UnVuKHtcbiAgICBvd25lcixcbiAgICByZXBvLFxuICAgIGpvYl9pZDogam9iSWQsXG4gIH0pO1xuICByZXR1cm4gcmVzcG9uc2UuZGF0YS5zdGF0dXM7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEppdENvbmZpZyhcbiAgb2N0b2tpdDogT2N0b2tpdCxcbiAgcnVubmVyTGV2ZWw6IFJ1bm5lckxldmVsLFxuICBvd25lcjogc3RyaW5nLFxuICByZXBvOiBzdHJpbmcsXG4gIHJ1bm5lck5hbWU6IHN0cmluZyxcbiAgbGFiZWxzOiBzdHJpbmdbXSxcbiAgam9iSWQ6IG51bWJlcixcbik6IFByb21pc2U8eyBlbmNvZGVkSml0Q29uZmlnOiBzdHJpbmc7IHJ1bm5lcklkOiBudW1iZXIgfT4ge1xuICBjb25zdCBydW5uZXJHcm91cElkID0gMTsgLy8gRGVmYXVsdCBydW5uZXIgZ3JvdXBcblxuICBjb25zdCBib2R5ID0ge1xuICAgIG5hbWU6IHJ1bm5lck5hbWUsXG4gICAgcnVubmVyX2dyb3VwX2lkOiBydW5uZXJHcm91cElkLFxuICAgIGxhYmVsczogZW5zdXJlRGVmYXVsdExhYmVscygoQXJyYXkuaXNBcnJheShsYWJlbHMpID8gbGFiZWxzIDogKGxhYmVscyBhcyB1bmtub3duIGFzIHN0cmluZykuc3BsaXQoJywnKSkubWFwKChsOiBzdHJpbmcpID0+IGwudHJpbSgpKS5maWx0ZXIoKGw6IHN0cmluZykgPT4gbC5sZW5ndGggPiAwKSksXG4gICAgd29ya19mb2xkZXI6ICdfd29yaycsXG4gIH07XG5cbiAgbGV0IHJlc3BvbnNlO1xuICBpZiAoKHJ1bm5lckxldmVsID8/ICdyZXBvJykgPT09ICdyZXBvJykge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgb2N0b2tpdC5yZXF1ZXN0KCdQT1NUIC9yZXBvcy97b3duZXJ9L3tyZXBvfS9hY3Rpb25zL3J1bm5lcnMvZ2VuZXJhdGUtaml0Y29uZmlnJywge1xuICAgICAgb3duZXIsXG4gICAgICByZXBvLFxuICAgICAgLi4uYm9keSxcbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXNwb25zZSA9IGF3YWl0IG9jdG9raXQucmVxdWVzdCgnUE9TVCAvb3Jncy97b3JnfS9hY3Rpb25zL3J1bm5lcnMvZ2VuZXJhdGUtaml0Y29uZmlnJywge1xuICAgICAgb3JnOiBvd25lcixcbiAgICAgIC4uLmJvZHksXG4gICAgfSk7XG4gIH1cblxuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnR2VuZXJhdGVkIEpJVCBydW5uZXIgY29uZmlnJyxcbiAgICBydW5uZXJJZDogcmVzcG9uc2UuZGF0YS5ydW5uZXIuaWQsXG4gICAgcnVubmVyTmFtZTogcmVzcG9uc2UuZGF0YS5ydW5uZXIubmFtZSxcbiAgICBqb2JJZCxcbiAgfSk7XG5cbiAgcmV0dXJuIHtcbiAgICBlbmNvZGVkSml0Q29uZmlnOiByZXNwb25zZS5kYXRhLmVuY29kZWRfaml0X2NvbmZpZyxcbiAgICBydW5uZXJJZDogcmVzcG9uc2UuZGF0YS5ydW5uZXIuaWQsXG4gIH07XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFJlZ2lzdHJhdGlvblRva2VuRm9yT3JnKG9jdG9raXQ6IE9jdG9raXQsIG93bmVyOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IG9jdG9raXQucmVzdC5hY3Rpb25zLmNyZWF0ZVJlZ2lzdHJhdGlvblRva2VuRm9yT3JnKHtcbiAgICBvcmc6IG93bmVyLFxuICB9KTtcbiAgcmV0dXJuIHJlc3BvbnNlLmRhdGEudG9rZW47XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldFJlZ2lzdHJhdGlvblRva2VuRm9yUmVwbyhvY3Rva2l0OiBPY3Rva2l0LCBvd25lcjogc3RyaW5nLCByZXBvOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IG9jdG9raXQucmVzdC5hY3Rpb25zLmNyZWF0ZVJlZ2lzdHJhdGlvblRva2VuRm9yUmVwbyh7XG4gICAgb3duZXI6IG93bmVyLFxuICAgIHJlcG86IHJlcG8sXG4gIH0pO1xuICByZXR1cm4gcmVzcG9uc2UuZGF0YS50b2tlbjtcbn1cbiJdfQ==