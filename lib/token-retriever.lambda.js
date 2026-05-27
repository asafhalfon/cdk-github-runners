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
    // Inject cdkghr:started:<epoch> so the idle-runner-reaper Lambda can compute
    // idle duration for JIT runners, matching the legacy config.sh path behaviour.
    const epochSeconds = Math.floor(Date.now() / 1000);
    const labelsWithStarted = [
        ...(Array.isArray(labels) ? labels : labels.split(',')),
        `cdkghr:started:${epochSeconds}`,
    ];
    const body = {
        name: runnerName,
        runner_group_id: runnerGroupId,
        labels: ensureDefaultLabels(labelsWithStarted.map((l) => l.trim()).filter((l) => l.length > 0)),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9rZW4tcmV0cmlldmVyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy90b2tlbi1yZXRyaWV2ZXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBYUEsMEJBK0VDO0FBM0ZELG1EQUE2QztBQUc3QyxNQUFNLGdCQUFpQixTQUFRLEtBQUs7SUFDbEMsWUFBWSxHQUFXO1FBQ3JCLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNYLElBQUksQ0FBQyxJQUFJLEdBQUcsa0JBQWtCLENBQUM7UUFDL0IsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDMUQsQ0FBQztDQUNGO0FBR00sS0FBSyxVQUFVLE9BQU8sQ0FBQyxLQUE4QjtJQUMxRCxJQUFJLENBQUM7UUFDSCxNQUFNLEVBQ0osYUFBYSxFQUNiLE9BQU8sR0FDUixHQUFHLE1BQU0sSUFBQSwwQkFBVSxFQUFDLEtBQUssQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUUzQyw4REFBOEQ7UUFDOUQsc0VBQXNFO1FBQ3RFLHFFQUFxRTtRQUNyRSwyQ0FBMkM7UUFDM0MsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUM7WUFDaEIsTUFBTSxTQUFTLEdBQUcsTUFBTSxjQUFjLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDdEYsSUFBSSxTQUFTLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQzNCLE9BQU8sQ0FBQyxHQUFHLENBQUM7b0JBQ1YsTUFBTSxFQUFFLG1EQUFtRDtvQkFDM0QsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO29CQUNsQixTQUFTO29CQUNULEtBQUssRUFBRSxLQUFLLENBQUMsS0FBSztvQkFDbEIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO2lCQUNqQixDQUFDLENBQUM7Z0JBQ0gs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QWdCLEVBQUUsS0FBYTtJQUN2RSxNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLDZCQUE2QixDQUFDO1FBQ3hFLEdBQUcsRUFBRSxLQUFLO0tBQ1gsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztBQUM3QixDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLE9BQWdCLEVBQUUsS0FBYSxFQUFFLElBQVk7SUFDdEYsTUFBTSxRQUFRLEdBQUcsTUFBTSxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQztRQUN6RSxLQUFLLEVBQUUsS0FBSztRQUNaLElBQUksRUFBRSxJQUFJO0tBQ1gsQ0FBQyxDQUFDO0lBQ0gsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztBQUM3QixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBPY3Rva2l0IH0gZnJvbSAnQG9jdG9raXQvcmVzdCc7XG5pbXBvcnQgeyBnZXRPY3Rva2l0IH0gZnJvbSAnLi9sYW1iZGEtZ2l0aHViJztcbmltcG9ydCB7IFN0ZXBGdW5jdGlvbkxhbWJkYUlucHV0IH0gZnJvbSAnLi9sYW1iZGEtaGVscGVycyc7XG5cbmNsYXNzIFJ1bm5lclRva2VuRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1zZzogc3RyaW5nKSB7XG4gICAgc3VwZXIobXNnKTtcbiAgICB0aGlzLm5hbWUgPSAnUnVubmVyVG9rZW5FcnJvcic7XG4gICAgT2JqZWN0LnNldFByb3RvdHlwZU9mKHRoaXMsIFJ1bm5lclRva2VuRXJyb3IucHJvdG90eXBlKTtcbiAgfVxufVxuXG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKGV2ZW50OiBTdGVwRnVuY3Rpb25MYW1iZGFJbnB1dCkge1xuICB0cnkge1xuICAgIGNvbnN0IHtcbiAgICAgIGdpdGh1YlNlY3JldHMsXG4gICAgICBvY3Rva2l0LFxuICAgIH0gPSBhd2FpdCBnZXRPY3Rva2l0KGV2ZW50Lmluc3RhbGxhdGlvbklkKTtcblxuICAgIC8vIEJlZm9yZSBjcmVhdGluZyBhIHJ1bm5lciwgY2hlY2sgaWYgdGhlIGpvYiBpcyBzdGlsbCBxdWV1ZWQuXG4gICAgLy8gVGhpcyBwcmV2ZW50cyB3YXN0aW5nIHJlc291cmNlcyB3aGVuIGEgam9iIHdhcyBhbHJlYWR5IHBpY2tlZCB1cCBieVxuICAgIC8vIGFub3RoZXIgcnVubmVyIChlLmcuLCBkdXJpbmcgcmV0cmllcyBvciB3aGVuIHJ1bm5lcnMgcmFjZSBmb3Igam9ic1xuICAgIC8vIHdpdGggaWRlbnRpY2FsIGxhYmVscyB1bmRlciBidXJzdCBsb2FkKS5cbiAgICBpZiAoZXZlbnQuam9iSWQpIHtcbiAgICAgIGNvbnN0IGpvYlN0YXR1cyA9IGF3YWl0IGNoZWNrSm9iU3RhdHVzKG9jdG9raXQsIGV2ZW50Lm93bmVyLCBldmVudC5yZXBvLCBldmVudC5qb2JJZCk7XG4gICAgICBpZiAoam9iU3RhdHVzICE9PSAncXVldWVkJykge1xuICAgICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgICAgbm90aWNlOiAnSm9iIGlzIG5vIGxvbmdlciBxdWV1ZWQsIHNraXBwaW5nIHJ1bm5lciBjcmVhdGlvbicsXG4gICAgICAgICAgam9iSWQ6IGV2ZW50LmpvYklkLFxuICAgICAgICAgIGpvYlN0YXR1cyxcbiAgICAgICAgICBvd25lcjogZXZlbnQub3duZXIsXG4gICAgICAgICAgcmVwbzogZXZlbnQucmVwbyxcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgZG9tYWluOiBnaXRodWJTZWNyZXRzLmRvbWFpbixcbiAgICAgICAgICBza2lwOiB0cnVlLFxuICAgICAgICAgIHRva2VuOiAnJyxcbiAgICAgICAgICByZWdpc3RyYXRpb25Vcmw6ICcnLFxuICAgICAgICAgIGppdENvbmZpZzogJycsXG4gICAgICAgICAgcnVubmVySWQ6IDAsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gVXNlIEpJVCBydW5uZXIgY29uZmlnIHdoZW4gam9iSWQgaXMgYXZhaWxhYmxlLlxuICAgIC8vIEpJVCBwcm92aWRlcyBhIGNsZWFuZXIgcmVnaXN0cmF0aW9uIHBhdGggKG5vIGNvbmZpZy5zaCBuZWVkZWQpIGFuZFxuICAgIC8vIGJ1aWx0LWluIGVwaGVtZXJhbCBiZWhhdmlvci4gTm90ZTogSklUIGRvZXMgbm90IHBpbiBydW5uZXJzIHRvIHNwZWNpZmljXG4gICAgLy8gam9icyDigJQgR2l0SHViIHN0aWxsIGRpc3BhdGNoZXMgYmFzZWQgb24gbGFiZWwgbWF0Y2hpbmcuXG4gICAgaWYgKGV2ZW50LmpvYklkKSB7XG4gICAgICBjb25zdCBqaXRSZXN1bHQgPSBhd2FpdCBnZXRKaXRDb25maWcob2N0b2tpdCwgZ2l0aHViU2VjcmV0cy5ydW5uZXJMZXZlbCwgZXZlbnQub3duZXIsIGV2ZW50LnJlcG8sIGV2ZW50LnJ1bm5lck5hbWUsIGV2ZW50LmxhYmVscywgZXZlbnQuam9iSWQpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZG9tYWluOiBnaXRodWJTZWNyZXRzLmRvbWFpbixcbiAgICAgICAgaml0Q29uZmlnOiBqaXRSZXN1bHQuZW5jb2RlZEppdENvbmZpZyxcbiAgICAgICAgcnVubmVySWQ6IGppdFJlc3VsdC5ydW5uZXJJZCxcbiAgICAgICAgc2tpcDogZmFsc2UsXG4gICAgICAgIHRva2VuOiAnJyxcbiAgICAgICAgcmVnaXN0cmF0aW9uVXJsOiAnJyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gRmFsbGJhY2s6IGxlZ2FjeSByZWdpc3RyYXRpb24gdG9rZW4gZmxvd1xuICAgIGxldCB0b2tlbjogc3RyaW5nO1xuICAgIGxldCByZWdpc3RyYXRpb25Vcmw6IHN0cmluZztcbiAgICBpZiAoZ2l0aHViU2VjcmV0cy5ydW5uZXJMZXZlbCA9PT0gJ3JlcG8nIHx8IGdpdGh1YlNlY3JldHMucnVubmVyTGV2ZWwgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdG9rZW4gPSBhd2FpdCBnZXRSZWdpc3RyYXRpb25Ub2tlbkZvclJlcG8ob2N0b2tpdCwgZXZlbnQub3duZXIsIGV2ZW50LnJlcG8pO1xuICAgICAgcmVnaXN0cmF0aW9uVXJsID0gYGh0dHBzOi8vJHtnaXRodWJTZWNyZXRzLmRvbWFpbn0vJHtldmVudC5vd25lcn0vJHtldmVudC5yZXBvfWA7XG4gICAgfSBlbHNlIGlmIChnaXRodWJTZWNyZXRzLnJ1bm5lckxldmVsID09PSAnb3JnJykge1xuICAgICAgdG9rZW4gPSBhd2FpdCBnZXRSZWdpc3RyYXRpb25Ub2tlbkZvck9yZyhvY3Rva2l0LCBldmVudC5vd25lcik7XG4gICAgICByZWdpc3RyYXRpb25VcmwgPSBgaHR0cHM6Ly8ke2dpdGh1YlNlY3JldHMuZG9tYWlufS8ke2V2ZW50Lm93bmVyfWA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBSdW5uZXJUb2tlbkVycm9yKCdJbnZhbGlkIHJ1bm5lciBsZXZlbCcpO1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAgZG9tYWluOiBnaXRodWJTZWNyZXRzLmRvbWFpbixcbiAgICAgIHRva2VuLFxuICAgICAgcmVnaXN0cmF0aW9uVXJsLFxuICAgICAgaml0Q29uZmlnOiAnJyxcbiAgICAgIHJ1bm5lcklkOiAwLFxuICAgICAgc2tpcDogZmFsc2UsXG4gICAgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byByZXRyaWV2ZSBydW5uZXIgcmVnaXN0cmF0aW9uIHRva2VuJyxcbiAgICAgIG93bmVyOiBldmVudC5vd25lcixcbiAgICAgIHJlcG86IGV2ZW50LnJlcG8sXG4gICAgICBydW5uZXJOYW1lOiBldmVudC5ydW5uZXJOYW1lLFxuICAgICAgam9iSWQ6IGV2ZW50LmpvYklkLFxuICAgICAgZXJyb3I6IGAke2Vycm9yfWAsXG4gICAgfSk7XG4gICAgdGhyb3cgbmV3IFJ1bm5lclRva2VuRXJyb3IoKDxFcnJvcj5lcnJvcikubWVzc2FnZSk7XG4gIH1cbn1cblxudHlwZSBSdW5uZXJMZXZlbCA9ICdyZXBvJyB8ICdvcmcnIHwgdW5kZWZpbmVkO1xuXG4vKipcbiAqIEVuc3VyZSBKSVQgcnVubmVycyBpbmNsdWRlIHRoZSBkZWZhdWx0IEdpdEh1YiBydW5uZXIgbGFiZWxzLlxuICogVW5saWtlIGNvbmZpZy5zaCB3aGljaCBhZGRzIHRoZXNlIGF1dG9tYXRpY2FsbHksIHRoZSBnZW5lcmF0ZS1qaXRjb25maWdcbiAqIEFQSSBvbmx5IHJlZ2lzdGVycyB0aGUgbGFiZWxzIHlvdSBleHBsaWNpdGx5IHByb3ZpZGUuXG4gKi9cbmZ1bmN0aW9uIGVuc3VyZURlZmF1bHRMYWJlbHMobGFiZWxzOiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3QgZGVmYXVsdExhYmVscyA9IFsnc2VsZi1ob3N0ZWQnXTtcbiAgY29uc3QgbG93ZXJMYWJlbHMgPSBsYWJlbHMubWFwKGwgPT4gbC50b0xvd2VyQ2FzZSgpKTtcbiAgZm9yIChjb25zdCBkbCBvZiBkZWZhdWx0TGFiZWxzKSB7XG4gICAgaWYgKCFsb3dlckxhYmVscy5pbmNsdWRlcyhkbC50b0xvd2VyQ2FzZSgpKSkge1xuICAgICAgbGFiZWxzLnVuc2hpZnQoZGwpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gbGFiZWxzO1xufVxuXG5hc3luYyBmdW5jdGlvbiBjaGVja0pvYlN0YXR1cyhcbiAgb2N0b2tpdDogT2N0b2tpdCxcbiAgb3duZXI6IHN0cmluZyxcbiAgcmVwbzogc3RyaW5nLFxuICBqb2JJZDogbnVtYmVyLFxuKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBvY3Rva2l0LnJlc3QuYWN0aW9ucy5nZXRKb2JGb3JXb3JrZmxvd1J1bih7XG4gICAgb3duZXIsXG4gICAgcmVwbyxcbiAgICBqb2JfaWQ6IGpvYklkLFxuICB9KTtcbiAgcmV0dXJuIHJlc3BvbnNlLmRhdGEuc3RhdHVzO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRKaXRDb25maWcoXG4gIG9jdG9raXQ6IE9jdG9raXQsXG4gIHJ1bm5lckxldmVsOiBSdW5uZXJMZXZlbCxcbiAgb3duZXI6IHN0cmluZyxcbiAgcmVwbzogc3RyaW5nLFxuICBydW5uZXJOYW1lOiBzdHJpbmcsXG4gIGxhYmVsczogc3RyaW5nW10sXG4gIGpvYklkOiBudW1iZXIsXG4pOiBQcm9taXNlPHsgZW5jb2RlZEppdENvbmZpZzogc3RyaW5nOyBydW5uZXJJZDogbnVtYmVyIH0+IHtcbiAgY29uc3QgcnVubmVyR3JvdXBJZCA9IDE7IC8vIERlZmF1bHQgcnVubmVyIGdyb3VwXG5cbiAgLy8gSW5qZWN0IGNka2docjpzdGFydGVkOjxlcG9jaD4gc28gdGhlIGlkbGUtcnVubmVyLXJlYXBlciBMYW1iZGEgY2FuIGNvbXB1dGVcbiAgLy8gaWRsZSBkdXJhdGlvbiBmb3IgSklUIHJ1bm5lcnMsIG1hdGNoaW5nIHRoZSBsZWdhY3kgY29uZmlnLnNoIHBhdGggYmVoYXZpb3VyLlxuICBjb25zdCBlcG9jaFNlY29uZHMgPSBNYXRoLmZsb29yKERhdGUubm93KCkgLyAxMDAwKTtcbiAgY29uc3QgbGFiZWxzV2l0aFN0YXJ0ZWQgPSBbXG4gICAgLi4uKEFycmF5LmlzQXJyYXkobGFiZWxzKSA/IGxhYmVscyA6IChsYWJlbHMgYXMgdW5rbm93biBhcyBzdHJpbmcpLnNwbGl0KCcsJykpLFxuICAgIGBjZGtnaHI6c3RhcnRlZDoke2Vwb2NoU2Vjb25kc31gLFxuICBdO1xuXG4gIGNvbnN0IGJvZHkgPSB7XG4gICAgbmFtZTogcnVubmVyTmFtZSxcbiAgICBydW5uZXJfZ3JvdXBfaWQ6IHJ1bm5lckdyb3VwSWQsXG4gICAgbGFiZWxzOiBlbnN1cmVEZWZhdWx0TGFiZWxzKGxhYmVsc1dpdGhTdGFydGVkLm1hcCgobDogc3RyaW5nKSA9PiBsLnRyaW0oKSkuZmlsdGVyKChsOiBzdHJpbmcpID0+IGwubGVuZ3RoID4gMCkpLFxuICAgIHdvcmtfZm9sZGVyOiAnX3dvcmsnLFxuICB9O1xuXG4gIGxldCByZXNwb25zZTtcbiAgaWYgKChydW5uZXJMZXZlbCA/PyAncmVwbycpID09PSAncmVwbycpIHtcbiAgICByZXNwb25zZSA9IGF3YWl0IG9jdG9raXQucmVxdWVzdCgnUE9TVCAvcmVwb3Mve293bmVyfS97cmVwb30vYWN0aW9ucy9ydW5uZXJzL2dlbmVyYXRlLWppdGNvbmZpZycsIHtcbiAgICAgIG93bmVyLFxuICAgICAgcmVwbyxcbiAgICAgIC4uLmJvZHksXG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBvY3Rva2l0LnJlcXVlc3QoJ1BPU1QgL29yZ3Mve29yZ30vYWN0aW9ucy9ydW5uZXJzL2dlbmVyYXRlLWppdGNvbmZpZycsIHtcbiAgICAgIG9yZzogb3duZXIsXG4gICAgICAuLi5ib2R5LFxuICAgIH0pO1xuICB9XG5cbiAgY29uc29sZS5sb2coe1xuICAgIG5vdGljZTogJ0dlbmVyYXRlZCBKSVQgcnVubmVyIGNvbmZpZycsXG4gICAgcnVubmVySWQ6IHJlc3BvbnNlLmRhdGEucnVubmVyLmlkLFxuICAgIHJ1bm5lck5hbWU6IHJlc3BvbnNlLmRhdGEucnVubmVyLm5hbWUsXG4gICAgam9iSWQsXG4gIH0pO1xuXG4gIHJldHVybiB7XG4gICAgZW5jb2RlZEppdENvbmZpZzogcmVzcG9uc2UuZGF0YS5lbmNvZGVkX2ppdF9jb25maWcsXG4gICAgcnVubmVySWQ6IHJlc3BvbnNlLmRhdGEucnVubmVyLmlkLFxuICB9O1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRSZWdpc3RyYXRpb25Ub2tlbkZvck9yZyhvY3Rva2l0OiBPY3Rva2l0LCBvd25lcjogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBvY3Rva2l0LnJlc3QuYWN0aW9ucy5jcmVhdGVSZWdpc3RyYXRpb25Ub2tlbkZvck9yZyh7XG4gICAgb3JnOiBvd25lcixcbiAgfSk7XG4gIHJldHVybiByZXNwb25zZS5kYXRhLnRva2VuO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRSZWdpc3RyYXRpb25Ub2tlbkZvclJlcG8ob2N0b2tpdDogT2N0b2tpdCwgb3duZXI6IHN0cmluZywgcmVwbzogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBvY3Rva2l0LnJlc3QuYWN0aW9ucy5jcmVhdGVSZWdpc3RyYXRpb25Ub2tlbkZvclJlcG8oe1xuICAgIG93bmVyOiBvd25lcixcbiAgICByZXBvOiByZXBvLFxuICB9KTtcbiAgcmV0dXJuIHJlc3BvbnNlLmRhdGEudG9rZW47XG59XG4iXX0=