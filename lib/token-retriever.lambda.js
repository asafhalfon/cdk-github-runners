"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const lambda_github_1 = require("./lambda-github");
const lambda_helpers_1 = require("./lambda-helpers");
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
        const runnerLevel = githubSecrets.runnerLevel ?? 'repo'; // undefined is for backwards compatibility
        if (runnerLevel !== 'repo' && runnerLevel !== 'org') {
            throw new lambda_helpers_1.RunnerConfigurationError(`Invalid runner level "${runnerLevel}" in the GitHub secret. It must be either "repo" or "org".`);
        }
        // runner groups only exist for organizations. a runner registered on repository level with --runnergroup fails
        // with "Could not find any self-hosted runner group named ...", but only after it's already running.
        if (event.group && runnerLevel === 'repo') {
            throw new lambda_helpers_1.RunnerConfigurationError(`Runner group "${event.group}" is configured, but runners are registered on repository level. Runner groups are ` +
                'only available for runners registered on organization level. Either remove the group from the provider, or ' +
                're-run the setup wizard and register runners on organization level.');
        }
        if (event.labels !== undefined) {
            const labels = dedupeLabels([...event.labels.split(','), ...(event.defaultLabels ?? [])]);
            let jitConfig;
            if (runnerLevel === 'repo') {
                jitConfig = await getJitConfigForRepo(octokit, event.owner, event.repo, event.runnerName, labels);
            }
            else {
                const groupId = await getRunnerGroupId(octokit, event.owner, event.group);
                jitConfig = await getJitConfigForOrg(octokit, event.owner, event.runnerName, labels, groupId);
            }
            return {
                domain: githubSecrets.domain,
                jitConfig,
            };
        }
        // DEPRECATED: remove in 1.0.0 with getRegistrationTokenForOrg() and getRegistrationTokenForRepo(). executions that started before JIT
        // runners keep running the old definition and retrying for up to a day after the deploy. they send no labels and still need a token.
        let token;
        let registrationUrl;
        if (runnerLevel === 'repo') {
            token = await getRegistrationTokenForRepo(octokit, event.owner, event.repo);
            registrationUrl = `https://${githubSecrets.domain}/${event.owner}/${event.repo}`;
        }
        else {
            token = await getRegistrationTokenForOrg(octokit, event.owner);
            registrationUrl = `https://${githubSecrets.domain}/${event.owner}`;
        }
        return {
            domain: githubSecrets.domain,
            token,
            registrationUrl,
        };
    }
    catch (error) {
        console.error({
            notice: 'Failed to retrieve runner registration token',
            owner: event.owner,
            repo: event.repo,
            runnerName: event.runnerName,
            error: `${error}`,
        });
        if (error instanceof lambda_helpers_1.RunnerConfigurationError) {
            // keep configuration errors as-is so the step function says what needs fixing instead of just "token error"
            throw error;
        }
        throw new RunnerTokenError(error.message);
    }
}
/**
 * GitHub answers a rate limit with 403 too. That one is temporary and worth retrying, so it must not be mistaken for a permissions problem.
 */
function isRateLimited(error) {
    return error?.response?.headers?.['x-ratelimit-remaining'] === '0' || /rate limit/i.test(error?.message ?? '');
}
/**
 * Turn the way GitHub refuses to give us a registration token into something the user can act on. These all mean the
 * setup is wrong, so no runner will ever start until it's fixed, and there's no point starting one to find out.
 *
 * Anything we don't recognize gets reported as a regular runner token error instead.
 */
function configurationError(error, runnerLevel, owner, repo) {
    const target = runnerLevel === 'org' ? `organization "${owner}"` : `repository "${owner}/${repo}"`;
    // GitHub's own message often names the exact missing permission, so it's worth keeping around
    const said = error?.message ? ` GitHub said: "${error.message}"` : '';
    const docs = ' See https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md';
    if (isRateLimited(error)) {
        return undefined;
    }
    switch (error?.status) {
        case 401:
            return new lambda_helpers_1.RunnerConfigurationError(`GitHub rejected our credentials while registering a runner for ${target} (401). The personal access ` +
                'token may be expired or revoked, or the app private key may not match the app id.' + docs + said);
        case 403:
            return new lambda_helpers_1.RunnerConfigurationError(`GitHub denied us permission to register a runner for ${target} (403). Personal access tokens need ` +
                `${runnerLevel === 'org' ? 'the admin:org scope' : 'the repo scope'}, and apps need ` +
                `${runnerLevel === 'org' ? 'the organization_self_hosted_runners permission' : 'the administration permission'}.` + docs + said);
        case 404:
            return new lambda_helpers_1.RunnerConfigurationError(`GitHub has no ${target}, or we have no access to it (404). ` +
                (runnerLevel === 'org'
                    ? 'Runners are registered on organization level, so jobs from user accounts and from other organizations can\'t get a runner. ' +
                        'Re-run the setup wizard to register runners on repository level if that\'s what you need.'
                    : 'Confirm the app is installed on this repository, or that the personal access token can access it.') + said);
        default:
            return undefined;
    }
}
async function getRegistrationTokenForOrg(octokit, owner) {
    try {
        const response = await octokit.rest.actions.createRegistrationTokenForOrg({
            org: owner,
        });
        return response.data.token;
    }
    catch (error) {
        throw configurationError(error, 'org', owner, '') ?? error;
    }
}
async function getRegistrationTokenForRepo(octokit, owner, repo) {
    try {
        const response = await octokit.rest.actions.createRegistrationTokenForRepo({
            owner: owner,
            repo: repo,
        });
        return response.data.token;
    }
    catch (error) {
        throw configurationError(error, 'repo', owner, repo) ?? error;
    }
}
/**
 * The JIT API wants a runner group id and not a name. Every org and repo has the default group with id 1, which is also what config.sh used when
 * no group was given.
 */
async function getRunnerGroupId(octokit, owner, group) {
    if (!group) {
        return 1;
    }
    let groups;
    try {
        // octokit has no typed method for this endpoint
        groups = await octokit.paginate('GET /orgs/{org}/actions/runner-groups', { org: owner, per_page: 100 });
    }
    catch (error) {
        throw configurationError(error, 'org', owner, '') ?? error;
    }
    const found = groups.find(g => g.name.toLowerCase() === group.toLowerCase());
    if (!found) {
        throw new lambda_helpers_1.RunnerConfigurationError(`Runner group "${group}" doesn't exist in organization "${owner}".`);
    }
    return found.id;
}
async function getJitConfigForOrg(octokit, owner, name, labels, groupId) {
    try {
        const response = await octokit.rest.actions.generateRunnerJitconfigForOrg({
            org: owner,
            name,
            labels,
            runner_group_id: groupId,
        });
        return response.data.encoded_jit_config;
    }
    catch (error) {
        throw configurationError(error, 'org', owner, '') ?? error;
    }
}
async function getJitConfigForRepo(octokit, owner, repo, name, labels) {
    try {
        const response = await octokit.rest.actions.generateRunnerJitconfigForRepo({
            owner,
            repo,
            name,
            labels,
            runner_group_id: 1,
        });
        return response.data.encoded_jit_config;
    }
    catch (error) {
        throw configurationError(error, 'repo', owner, repo) ?? error;
    }
}
/**
 * Like config.sh, drop empty labels and the same label in different case.
 */
function dedupeLabels(labels) {
    const seen = new Set();
    return labels.filter(l => l && !seen.has(l.toLowerCase()) && seen.add(l.toLowerCase()));
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG9rZW4tcmV0cmlldmVyLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy90b2tlbi1yZXRyaWV2ZXIubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBd0JBLDBCQW1FQztBQTFGRCxtREFBMEQ7QUFDMUQscURBQXFGO0FBRXJGLE1BQU0sZ0JBQWlCLFNBQVEsS0FBSztJQUNsQyxZQUFZLEdBQVc7UUFDckIsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ1gsSUFBSSxDQUFDLElBQUksR0FBRyxrQkFBa0IsQ0FBQztRQUMvQixNQUFNLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUMxRCxDQUFDO0NBQ0Y7QUFjTSxLQUFLLFVBQVUsT0FBTyxDQUFDLEtBQTBCO0lBQ3RELElBQUksQ0FBQztRQUNILE1BQU0sRUFDSixhQUFhLEVBQ2IsT0FBTyxHQUNSLEdBQUcsTUFBTSxJQUFBLDBCQUFVLEVBQUMsS0FBSyxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRTNDLE1BQU0sV0FBVyxHQUFHLGFBQWEsQ0FBQyxXQUFXLElBQUksTUFBTSxDQUFDLENBQUMsMkNBQTJDO1FBRXBHLElBQUksV0FBVyxLQUFLLE1BQU0sSUFBSSxXQUFXLEtBQUssS0FBSyxFQUFFLENBQUM7WUFDcEQsTUFBTSxJQUFJLHlDQUF3QixDQUFDLHlCQUF5QixXQUFXLDREQUE0RCxDQUFDLENBQUM7UUFDdkksQ0FBQztRQUVELCtHQUErRztRQUMvRyxxR0FBcUc7UUFDckcsSUFBSSxLQUFLLENBQUMsS0FBSyxJQUFJLFdBQVcsS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUMxQyxNQUFNLElBQUkseUNBQXdCLENBQ2hDLGlCQUFpQixLQUFLLENBQUMsS0FBSyxxRkFBcUY7Z0JBQ2pILDZHQUE2RztnQkFDN0cscUVBQXFFLENBQUMsQ0FBQztRQUMzRSxDQUFDO1FBRUQsSUFBSSxLQUFLLENBQUMsTUFBTSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQy9CLE1BQU0sTUFBTSxHQUFHLFlBQVksQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLEVBQUUsR0FBRyxDQUFDLEtBQUssQ0FBQyxhQUFhLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzFGLElBQUksU0FBaUIsQ0FBQztZQUN0QixJQUFJLFdBQVcsS0FBSyxNQUFNLEVBQUUsQ0FBQztnQkFDM0IsU0FBUyxHQUFHLE1BQU0sbUJBQW1CLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQ3BHLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLE9BQU8sR0FBRyxNQUFNLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDMUUsU0FBUyxHQUFHLE1BQU0sa0JBQWtCLENBQUMsT0FBTyxFQUFFLEtBQUssQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLFVBQVUsRUFBRSxNQUFNLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDaEcsQ0FBQztZQUNELE9BQU87Z0JBQ0wsTUFBTSxFQUFFLGFBQWEsQ0FBQyxNQUFNO2dCQUM1QixTQUFTO2FBQ1YsQ0FBQztRQUNKLENBQUM7UUFFRCxzSUFBc0k7UUFDdEkscUlBQXFJO1FBQ3JJLElBQUksS0FBYSxDQUFDO1FBQ2xCLElBQUksZUFBdUIsQ0FBQztRQUM1QixJQUFJLFdBQVcsS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUMzQixLQUFLLEdBQUcsTUFBTSwyQkFBMkIsQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLEtBQUssRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDNUUsZUFBZSxHQUFHLFdBQVcsYUFBYSxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsS0FBSyxJQUFJLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNuRixDQUFDO2FBQU0sQ0FBQztZQUNOLEtBQUssR0FBRyxNQUFNLDBCQUEwQixDQUFDLE9BQU8sRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDL0QsZUFBZSxHQUFHLFdBQVcsYUFBYSxDQUFDLE1BQU0sSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDckUsQ0FBQztRQUNELE9BQU87WUFDTCxNQUFNLEVBQUUsYUFBYSxDQUFDLE1BQU07WUFDNUIsS0FBSztZQUNMLGVBQWU7U0FDaEIsQ0FBQztJQUNKLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQztZQUNaLE1BQU0sRUFBRSw4Q0FBOEM7WUFDdEQsS0FBSyxFQUFFLEtBQUssQ0FBQyxLQUFLO1lBQ2xCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtZQUNoQixVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7WUFDNUIsS0FBSyxFQUFFLEdBQUcsS0FBSyxFQUFFO1NBQ2xCLENBQUMsQ0FBQztRQUNILElBQUksS0FBSyxZQUFZLHlDQUF3QixFQUFFLENBQUM7WUFDOUMsNEdBQTRHO1lBQzVHLE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztRQUNELE1BQU0sSUFBSSxnQkFBZ0IsQ0FBUyxLQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDckQsQ0FBQztBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILFNBQVMsYUFBYSxDQUFDLEtBQVU7SUFDL0IsT0FBTyxLQUFLLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxDQUFDLHVCQUF1QixDQUFDLEtBQUssR0FBRyxJQUFJLGFBQWEsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLE9BQU8sSUFBSSxFQUFFLENBQUMsQ0FBQztBQUNqSCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxTQUFTLGtCQUFrQixDQUFDLEtBQVUsRUFBRSxXQUF3QixFQUFFLEtBQWEsRUFBRSxJQUFZO0lBQzNGLE1BQU0sTUFBTSxHQUFHLFdBQVcsS0FBSyxLQUFLLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsZUFBZSxLQUFLLElBQUksSUFBSSxHQUFHLENBQUM7SUFDbkcsOEZBQThGO0lBQzlGLE1BQU0sSUFBSSxHQUFHLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQyxDQUFDLGtCQUFrQixLQUFLLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUN0RSxNQUFNLElBQUksR0FBRyxtRkFBbUYsQ0FBQztJQUVqRyxJQUFJLGFBQWEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQ3pCLE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxRQUFRLEtBQUssRUFBRSxNQUFNLEVBQUUsQ0FBQztRQUN0QixLQUFLLEdBQUc7WUFDTixPQUFPLElBQUkseUNBQXdCLENBQUMsa0VBQWtFLE1BQU0sOEJBQThCO2dCQUN4SSxtRkFBbUYsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDdkcsS0FBSyxHQUFHO1lBQ04sT0FBTyxJQUFJLHlDQUF3QixDQUFDLHdEQUF3RCxNQUFNLHNDQUFzQztnQkFDdEksR0FBRyxXQUFXLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUMsZ0JBQWdCLGtCQUFrQjtnQkFDckYsR0FBRyxXQUFXLEtBQUssS0FBSyxDQUFDLENBQUMsQ0FBQyxpREFBaUQsQ0FBQyxDQUFDLENBQUMsK0JBQStCLEdBQUcsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDLENBQUM7UUFDckksS0FBSyxHQUFHO1lBQ04sT0FBTyxJQUFJLHlDQUF3QixDQUFDLGlCQUFpQixNQUFNLHNDQUFzQztnQkFDL0YsQ0FBQyxXQUFXLEtBQUssS0FBSztvQkFDcEIsQ0FBQyxDQUFDLDZIQUE2SDt3QkFDN0gsMkZBQTJGO29CQUM3RixDQUFDLENBQUMsbUdBQW1HLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQztRQUNySDtZQUNFLE9BQU8sU0FBUyxDQUFDO0lBQ3JCLENBQUM7QUFDSCxDQUFDO0FBRUQsS0FBSyxVQUFVLDBCQUEwQixDQUFDLE9BQWdCLEVBQUUsS0FBYTtJQUN2RSxJQUFJLENBQUM7UUFDSCxNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLDZCQUE2QixDQUFDO1lBQ3hFLEdBQUcsRUFBRSxLQUFLO1NBQ1gsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztJQUM3QixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE1BQU0sa0JBQWtCLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksS0FBSyxDQUFDO0lBQzdELENBQUM7QUFDSCxDQUFDO0FBRUQsS0FBSyxVQUFVLDJCQUEyQixDQUFDLE9BQWdCLEVBQUUsS0FBYSxFQUFFLElBQVk7SUFDdEYsSUFBSSxDQUFDO1FBQ0gsTUFBTSxRQUFRLEdBQUcsTUFBTSxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsQ0FBQztZQUN6RSxLQUFLLEVBQUUsS0FBSztZQUNaLElBQUksRUFBRSxJQUFJO1NBQ1gsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQztJQUM3QixDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE1BQU0sa0JBQWtCLENBQUMsS0FBSyxFQUFFLE1BQU0sRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDO0lBQ2hFLENBQUM7QUFDSCxDQUFDO0FBRUQ7OztHQUdHO0FBQ0gsS0FBSyxVQUFVLGdCQUFnQixDQUFDLE9BQWdCLEVBQUUsS0FBYSxFQUFFLEtBQWE7SUFDNUUsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ1gsT0FBTyxDQUFDLENBQUM7SUFDWCxDQUFDO0lBRUQsSUFBSSxNQUFzQyxDQUFDO0lBQzNDLElBQUksQ0FBQztRQUNILGdEQUFnRDtRQUNoRCxNQUFNLEdBQUcsTUFBTSxPQUFPLENBQUMsUUFBUSxDQUFDLHVDQUF1QyxFQUFFLEVBQUUsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUMxRyxDQUFDO0lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztRQUNmLE1BQU0sa0JBQWtCLENBQUMsS0FBSyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLElBQUksS0FBSyxDQUFDO0lBQzdELENBQUM7SUFFRCxNQUFNLEtBQUssR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLEVBQUUsS0FBSyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztJQUM3RSxJQUFJLENBQUMsS0FBSyxFQUFFLENBQUM7UUFDWCxNQUFNLElBQUkseUNBQXdCLENBQUMsaUJBQWlCLEtBQUssb0NBQW9DLEtBQUssSUFBSSxDQUFDLENBQUM7SUFDMUcsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFDLEVBQUUsQ0FBQztBQUNsQixDQUFDO0FBRUQsS0FBSyxVQUFVLGtCQUFrQixDQUFDLE9BQWdCLEVBQUUsS0FBYSxFQUFFLElBQVksRUFBRSxNQUFnQixFQUFFLE9BQWU7SUFDaEgsSUFBSSxDQUFDO1FBQ0gsTUFBTSxRQUFRLEdBQUcsTUFBTSxPQUFPLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyw2QkFBNkIsQ0FBQztZQUN4RSxHQUFHLEVBQUUsS0FBSztZQUNWLElBQUk7WUFDSixNQUFNO1lBQ04sZUFBZSxFQUFFLE9BQU87U0FDekIsQ0FBQyxDQUFDO1FBQ0gsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDO0lBQzFDLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsTUFBTSxrQkFBa0IsQ0FBQyxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsSUFBSSxLQUFLLENBQUM7SUFDN0QsQ0FBQztBQUNILENBQUM7QUFFRCxLQUFLLFVBQVUsbUJBQW1CLENBQUMsT0FBZ0IsRUFBRSxLQUFhLEVBQUUsSUFBWSxFQUFFLElBQVksRUFBRSxNQUFnQjtJQUM5RyxJQUFJLENBQUM7UUFDSCxNQUFNLFFBQVEsR0FBRyxNQUFNLE9BQU8sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLDhCQUE4QixDQUFDO1lBQ3pFLEtBQUs7WUFDTCxJQUFJO1lBQ0osSUFBSTtZQUNKLE1BQU07WUFDTixlQUFlLEVBQUUsQ0FBQztTQUNuQixDQUFDLENBQUM7UUFDSCxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLENBQUM7SUFDMUMsQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixNQUFNLGtCQUFrQixDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQztJQUNoRSxDQUFDO0FBQ0gsQ0FBQztBQUVEOztHQUVHO0FBQ0gsU0FBUyxZQUFZLENBQUMsTUFBZ0I7SUFDcEMsTUFBTSxJQUFJLEdBQUcsSUFBSSxHQUFHLEVBQVUsQ0FBQztJQUMvQixPQUFPLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUMsQ0FBQztBQUMxRixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHR5cGUgeyBPY3Rva2l0IH0gZnJvbSAnQG9jdG9raXQvcmVzdCcgd2l0aCB7ICdyZXNvbHV0aW9uLW1vZGUnOiAnaW1wb3J0JyB9O1xuaW1wb3J0IHsgZ2V0T2N0b2tpdCwgUnVubmVyTGV2ZWwgfSBmcm9tICcuL2xhbWJkYS1naXRodWInO1xuaW1wb3J0IHsgUnVubmVyQ29uZmlndXJhdGlvbkVycm9yLCBTdGVwRnVuY3Rpb25MYW1iZGFJbnB1dCB9IGZyb20gJy4vbGFtYmRhLWhlbHBlcnMnO1xuXG5jbGFzcyBSdW5uZXJUb2tlbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3Rvcihtc2c6IHN0cmluZykge1xuICAgIHN1cGVyKG1zZyk7XG4gICAgdGhpcy5uYW1lID0gJ1J1bm5lclRva2VuRXJyb3InO1xuICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0aGlzLCBSdW5uZXJUb2tlbkVycm9yLnByb3RvdHlwZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBUb2tlblJldHJpZXZlcklucHV0IGV4dGVuZHMgU3RlcEZ1bmN0aW9uTGFtYmRhSW5wdXQge1xuICAvKiogcnVubmVyIGdyb3VwIG9mIHRoZSBjb25maWcgdGhlIG9yY2hlc3RyYXRvciBzZWxlY3RlZCwgZW1wdHkgd2hlbiBpdCBoYXMgbm9uZSAqL1xuICByZWFkb25seSBncm91cDogc3RyaW5nO1xuICAvKiogY29tbWEgc2VwYXJhdGVkIGxhYmVscyB0aGUgcnVubmVyIHJlZ2lzdGVycyB3aXRoLiBERVBSRUNBVEVEOiBtYWtlIHJlcXVpcmVkIGluIDEuMC4wLCBvbGRlciBleGVjdXRpb25zIGRvbid0IHNlbmQgaXQgKi9cbiAgcmVhZG9ubHkgbGFiZWxzPzogc3RyaW5nO1xuICAvKiogbGFiZWxzIGNvbmZpZy5zaCB1c2VkIHRvIGFkZCBvbiBpdHMgb3duLCBlbXB0eSB3aGVuIHRoZSBwcm92aWRlciB0dXJuZWQgdGhlbSBvZmYuIHNlZSBydW5uZXJEZWZhdWx0TGFiZWxzKCkgKi9cbiAgcmVhZG9ubHkgZGVmYXVsdExhYmVscz86IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogVG9rZW5SZXRyaWV2ZXJJbnB1dCkge1xuICB0cnkge1xuICAgIGNvbnN0IHtcbiAgICAgIGdpdGh1YlNlY3JldHMsXG4gICAgICBvY3Rva2l0LFxuICAgIH0gPSBhd2FpdCBnZXRPY3Rva2l0KGV2ZW50Lmluc3RhbGxhdGlvbklkKTtcblxuICAgIGNvbnN0IHJ1bm5lckxldmVsID0gZ2l0aHViU2VjcmV0cy5ydW5uZXJMZXZlbCA/PyAncmVwbyc7IC8vIHVuZGVmaW5lZCBpcyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHlcblxuICAgIGlmIChydW5uZXJMZXZlbCAhPT0gJ3JlcG8nICYmIHJ1bm5lckxldmVsICE9PSAnb3JnJykge1xuICAgICAgdGhyb3cgbmV3IFJ1bm5lckNvbmZpZ3VyYXRpb25FcnJvcihgSW52YWxpZCBydW5uZXIgbGV2ZWwgXCIke3J1bm5lckxldmVsfVwiIGluIHRoZSBHaXRIdWIgc2VjcmV0LiBJdCBtdXN0IGJlIGVpdGhlciBcInJlcG9cIiBvciBcIm9yZ1wiLmApO1xuICAgIH1cblxuICAgIC8vIHJ1bm5lciBncm91cHMgb25seSBleGlzdCBmb3Igb3JnYW5pemF0aW9ucy4gYSBydW5uZXIgcmVnaXN0ZXJlZCBvbiByZXBvc2l0b3J5IGxldmVsIHdpdGggLS1ydW5uZXJncm91cCBmYWlsc1xuICAgIC8vIHdpdGggXCJDb3VsZCBub3QgZmluZCBhbnkgc2VsZi1ob3N0ZWQgcnVubmVyIGdyb3VwIG5hbWVkIC4uLlwiLCBidXQgb25seSBhZnRlciBpdCdzIGFscmVhZHkgcnVubmluZy5cbiAgICBpZiAoZXZlbnQuZ3JvdXAgJiYgcnVubmVyTGV2ZWwgPT09ICdyZXBvJykge1xuICAgICAgdGhyb3cgbmV3IFJ1bm5lckNvbmZpZ3VyYXRpb25FcnJvcihcbiAgICAgICAgYFJ1bm5lciBncm91cCBcIiR7ZXZlbnQuZ3JvdXB9XCIgaXMgY29uZmlndXJlZCwgYnV0IHJ1bm5lcnMgYXJlIHJlZ2lzdGVyZWQgb24gcmVwb3NpdG9yeSBsZXZlbC4gUnVubmVyIGdyb3VwcyBhcmUgYCArXG4gICAgICAgICdvbmx5IGF2YWlsYWJsZSBmb3IgcnVubmVycyByZWdpc3RlcmVkIG9uIG9yZ2FuaXphdGlvbiBsZXZlbC4gRWl0aGVyIHJlbW92ZSB0aGUgZ3JvdXAgZnJvbSB0aGUgcHJvdmlkZXIsIG9yICcgK1xuICAgICAgICAncmUtcnVuIHRoZSBzZXR1cCB3aXphcmQgYW5kIHJlZ2lzdGVyIHJ1bm5lcnMgb24gb3JnYW5pemF0aW9uIGxldmVsLicpO1xuICAgIH1cblxuICAgIGlmIChldmVudC5sYWJlbHMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgbGFiZWxzID0gZGVkdXBlTGFiZWxzKFsuLi5ldmVudC5sYWJlbHMuc3BsaXQoJywnKSwgLi4uKGV2ZW50LmRlZmF1bHRMYWJlbHMgPz8gW10pXSk7XG4gICAgICBsZXQgaml0Q29uZmlnOiBzdHJpbmc7XG4gICAgICBpZiAocnVubmVyTGV2ZWwgPT09ICdyZXBvJykge1xuICAgICAgICBqaXRDb25maWcgPSBhd2FpdCBnZXRKaXRDb25maWdGb3JSZXBvKG9jdG9raXQsIGV2ZW50Lm93bmVyLCBldmVudC5yZXBvLCBldmVudC5ydW5uZXJOYW1lLCBsYWJlbHMpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgZ3JvdXBJZCA9IGF3YWl0IGdldFJ1bm5lckdyb3VwSWQob2N0b2tpdCwgZXZlbnQub3duZXIsIGV2ZW50Lmdyb3VwKTtcbiAgICAgICAgaml0Q29uZmlnID0gYXdhaXQgZ2V0Sml0Q29uZmlnRm9yT3JnKG9jdG9raXQsIGV2ZW50Lm93bmVyLCBldmVudC5ydW5uZXJOYW1lLCBsYWJlbHMsIGdyb3VwSWQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgZG9tYWluOiBnaXRodWJTZWNyZXRzLmRvbWFpbixcbiAgICAgICAgaml0Q29uZmlnLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBERVBSRUNBVEVEOiByZW1vdmUgaW4gMS4wLjAgd2l0aCBnZXRSZWdpc3RyYXRpb25Ub2tlbkZvck9yZygpIGFuZCBnZXRSZWdpc3RyYXRpb25Ub2tlbkZvclJlcG8oKS4gZXhlY3V0aW9ucyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIEpJVFxuICAgIC8vIHJ1bm5lcnMga2VlcCBydW5uaW5nIHRoZSBvbGQgZGVmaW5pdGlvbiBhbmQgcmV0cnlpbmcgZm9yIHVwIHRvIGEgZGF5IGFmdGVyIHRoZSBkZXBsb3kuIHRoZXkgc2VuZCBubyBsYWJlbHMgYW5kIHN0aWxsIG5lZWQgYSB0b2tlbi5cbiAgICBsZXQgdG9rZW46IHN0cmluZztcbiAgICBsZXQgcmVnaXN0cmF0aW9uVXJsOiBzdHJpbmc7XG4gICAgaWYgKHJ1bm5lckxldmVsID09PSAncmVwbycpIHtcbiAgICAgIHRva2VuID0gYXdhaXQgZ2V0UmVnaXN0cmF0aW9uVG9rZW5Gb3JSZXBvKG9jdG9raXQsIGV2ZW50Lm93bmVyLCBldmVudC5yZXBvKTtcbiAgICAgIHJlZ2lzdHJhdGlvblVybCA9IGBodHRwczovLyR7Z2l0aHViU2VjcmV0cy5kb21haW59LyR7ZXZlbnQub3duZXJ9LyR7ZXZlbnQucmVwb31gO1xuICAgIH0gZWxzZSB7XG4gICAgICB0b2tlbiA9IGF3YWl0IGdldFJlZ2lzdHJhdGlvblRva2VuRm9yT3JnKG9jdG9raXQsIGV2ZW50Lm93bmVyKTtcbiAgICAgIHJlZ2lzdHJhdGlvblVybCA9IGBodHRwczovLyR7Z2l0aHViU2VjcmV0cy5kb21haW59LyR7ZXZlbnQub3duZXJ9YDtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGRvbWFpbjogZ2l0aHViU2VjcmV0cy5kb21haW4sXG4gICAgICB0b2tlbixcbiAgICAgIHJlZ2lzdHJhdGlvblVybCxcbiAgICB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIHJldHJpZXZlIHJ1bm5lciByZWdpc3RyYXRpb24gdG9rZW4nLFxuICAgICAgb3duZXI6IGV2ZW50Lm93bmVyLFxuICAgICAgcmVwbzogZXZlbnQucmVwbyxcbiAgICAgIHJ1bm5lck5hbWU6IGV2ZW50LnJ1bm5lck5hbWUsXG4gICAgICBlcnJvcjogYCR7ZXJyb3J9YCxcbiAgICB9KTtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSdW5uZXJDb25maWd1cmF0aW9uRXJyb3IpIHtcbiAgICAgIC8vIGtlZXAgY29uZmlndXJhdGlvbiBlcnJvcnMgYXMtaXMgc28gdGhlIHN0ZXAgZnVuY3Rpb24gc2F5cyB3aGF0IG5lZWRzIGZpeGluZyBpbnN0ZWFkIG9mIGp1c3QgXCJ0b2tlbiBlcnJvclwiXG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gICAgdGhyb3cgbmV3IFJ1bm5lclRva2VuRXJyb3IoKDxFcnJvcj5lcnJvcikubWVzc2FnZSk7XG4gIH1cbn1cblxuLyoqXG4gKiBHaXRIdWIgYW5zd2VycyBhIHJhdGUgbGltaXQgd2l0aCA0MDMgdG9vLiBUaGF0IG9uZSBpcyB0ZW1wb3JhcnkgYW5kIHdvcnRoIHJldHJ5aW5nLCBzbyBpdCBtdXN0IG5vdCBiZSBtaXN0YWtlbiBmb3IgYSBwZXJtaXNzaW9ucyBwcm9ibGVtLlxuICovXG5mdW5jdGlvbiBpc1JhdGVMaW1pdGVkKGVycm9yOiBhbnkpOiBib29sZWFuIHtcbiAgcmV0dXJuIGVycm9yPy5yZXNwb25zZT8uaGVhZGVycz8uWyd4LXJhdGVsaW1pdC1yZW1haW5pbmcnXSA9PT0gJzAnIHx8IC9yYXRlIGxpbWl0L2kudGVzdChlcnJvcj8ubWVzc2FnZSA/PyAnJyk7XG59XG5cbi8qKlxuICogVHVybiB0aGUgd2F5IEdpdEh1YiByZWZ1c2VzIHRvIGdpdmUgdXMgYSByZWdpc3RyYXRpb24gdG9rZW4gaW50byBzb21ldGhpbmcgdGhlIHVzZXIgY2FuIGFjdCBvbi4gVGhlc2UgYWxsIG1lYW4gdGhlXG4gKiBzZXR1cCBpcyB3cm9uZywgc28gbm8gcnVubmVyIHdpbGwgZXZlciBzdGFydCB1bnRpbCBpdCdzIGZpeGVkLCBhbmQgdGhlcmUncyBubyBwb2ludCBzdGFydGluZyBvbmUgdG8gZmluZCBvdXQuXG4gKlxuICogQW55dGhpbmcgd2UgZG9uJ3QgcmVjb2duaXplIGdldHMgcmVwb3J0ZWQgYXMgYSByZWd1bGFyIHJ1bm5lciB0b2tlbiBlcnJvciBpbnN0ZWFkLlxuICovXG5mdW5jdGlvbiBjb25maWd1cmF0aW9uRXJyb3IoZXJyb3I6IGFueSwgcnVubmVyTGV2ZWw6IFJ1bm5lckxldmVsLCBvd25lcjogc3RyaW5nLCByZXBvOiBzdHJpbmcpOiBSdW5uZXJDb25maWd1cmF0aW9uRXJyb3IgfCB1bmRlZmluZWQge1xuICBjb25zdCB0YXJnZXQgPSBydW5uZXJMZXZlbCA9PT0gJ29yZycgPyBgb3JnYW5pemF0aW9uIFwiJHtvd25lcn1cImAgOiBgcmVwb3NpdG9yeSBcIiR7b3duZXJ9LyR7cmVwb31cImA7XG4gIC8vIEdpdEh1YidzIG93biBtZXNzYWdlIG9mdGVuIG5hbWVzIHRoZSBleGFjdCBtaXNzaW5nIHBlcm1pc3Npb24sIHNvIGl0J3Mgd29ydGgga2VlcGluZyBhcm91bmRcbiAgY29uc3Qgc2FpZCA9IGVycm9yPy5tZXNzYWdlID8gYCBHaXRIdWIgc2FpZDogXCIke2Vycm9yLm1lc3NhZ2V9XCJgIDogJyc7XG4gIGNvbnN0IGRvY3MgPSAnIFNlZSBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycy9ibG9iL21haW4vU0VUVVBfR0lUSFVCLm1kJztcblxuICBpZiAoaXNSYXRlTGltaXRlZChlcnJvcikpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgc3dpdGNoIChlcnJvcj8uc3RhdHVzKSB7XG4gICAgY2FzZSA0MDE6XG4gICAgICByZXR1cm4gbmV3IFJ1bm5lckNvbmZpZ3VyYXRpb25FcnJvcihgR2l0SHViIHJlamVjdGVkIG91ciBjcmVkZW50aWFscyB3aGlsZSByZWdpc3RlcmluZyBhIHJ1bm5lciBmb3IgJHt0YXJnZXR9ICg0MDEpLiBUaGUgcGVyc29uYWwgYWNjZXNzIGAgK1xuICAgICAgICAndG9rZW4gbWF5IGJlIGV4cGlyZWQgb3IgcmV2b2tlZCwgb3IgdGhlIGFwcCBwcml2YXRlIGtleSBtYXkgbm90IG1hdGNoIHRoZSBhcHAgaWQuJyArIGRvY3MgKyBzYWlkKTtcbiAgICBjYXNlIDQwMzpcbiAgICAgIHJldHVybiBuZXcgUnVubmVyQ29uZmlndXJhdGlvbkVycm9yKGBHaXRIdWIgZGVuaWVkIHVzIHBlcm1pc3Npb24gdG8gcmVnaXN0ZXIgYSBydW5uZXIgZm9yICR7dGFyZ2V0fSAoNDAzKS4gUGVyc29uYWwgYWNjZXNzIHRva2VucyBuZWVkIGAgK1xuICAgICAgICBgJHtydW5uZXJMZXZlbCA9PT0gJ29yZycgPyAndGhlIGFkbWluOm9yZyBzY29wZScgOiAndGhlIHJlcG8gc2NvcGUnfSwgYW5kIGFwcHMgbmVlZCBgICtcbiAgICAgICAgYCR7cnVubmVyTGV2ZWwgPT09ICdvcmcnID8gJ3RoZSBvcmdhbml6YXRpb25fc2VsZl9ob3N0ZWRfcnVubmVycyBwZXJtaXNzaW9uJyA6ICd0aGUgYWRtaW5pc3RyYXRpb24gcGVybWlzc2lvbid9LmAgKyBkb2NzICsgc2FpZCk7XG4gICAgY2FzZSA0MDQ6XG4gICAgICByZXR1cm4gbmV3IFJ1bm5lckNvbmZpZ3VyYXRpb25FcnJvcihgR2l0SHViIGhhcyBubyAke3RhcmdldH0sIG9yIHdlIGhhdmUgbm8gYWNjZXNzIHRvIGl0ICg0MDQpLiBgICtcbiAgICAgICAgKHJ1bm5lckxldmVsID09PSAnb3JnJ1xuICAgICAgICAgID8gJ1J1bm5lcnMgYXJlIHJlZ2lzdGVyZWQgb24gb3JnYW5pemF0aW9uIGxldmVsLCBzbyBqb2JzIGZyb20gdXNlciBhY2NvdW50cyBhbmQgZnJvbSBvdGhlciBvcmdhbml6YXRpb25zIGNhblxcJ3QgZ2V0IGEgcnVubmVyLiAnICtcbiAgICAgICAgICAgICdSZS1ydW4gdGhlIHNldHVwIHdpemFyZCB0byByZWdpc3RlciBydW5uZXJzIG9uIHJlcG9zaXRvcnkgbGV2ZWwgaWYgdGhhdFxcJ3Mgd2hhdCB5b3UgbmVlZC4nXG4gICAgICAgICAgOiAnQ29uZmlybSB0aGUgYXBwIGlzIGluc3RhbGxlZCBvbiB0aGlzIHJlcG9zaXRvcnksIG9yIHRoYXQgdGhlIHBlcnNvbmFsIGFjY2VzcyB0b2tlbiBjYW4gYWNjZXNzIGl0LicpICsgc2FpZCk7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0UmVnaXN0cmF0aW9uVG9rZW5Gb3JPcmcob2N0b2tpdDogT2N0b2tpdCwgb3duZXI6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBvY3Rva2l0LnJlc3QuYWN0aW9ucy5jcmVhdGVSZWdpc3RyYXRpb25Ub2tlbkZvck9yZyh7XG4gICAgICBvcmc6IG93bmVyLFxuICAgIH0pO1xuICAgIHJldHVybiByZXNwb25zZS5kYXRhLnRva2VuO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IGNvbmZpZ3VyYXRpb25FcnJvcihlcnJvciwgJ29yZycsIG93bmVyLCAnJykgPz8gZXJyb3I7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0UmVnaXN0cmF0aW9uVG9rZW5Gb3JSZXBvKG9jdG9raXQ6IE9jdG9raXQsIG93bmVyOiBzdHJpbmcsIHJlcG86IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBvY3Rva2l0LnJlc3QuYWN0aW9ucy5jcmVhdGVSZWdpc3RyYXRpb25Ub2tlbkZvclJlcG8oe1xuICAgICAgb3duZXI6IG93bmVyLFxuICAgICAgcmVwbzogcmVwbyxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzcG9uc2UuZGF0YS50b2tlbjtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBjb25maWd1cmF0aW9uRXJyb3IoZXJyb3IsICdyZXBvJywgb3duZXIsIHJlcG8pID8/IGVycm9yO1xuICB9XG59XG5cbi8qKlxuICogVGhlIEpJVCBBUEkgd2FudHMgYSBydW5uZXIgZ3JvdXAgaWQgYW5kIG5vdCBhIG5hbWUuIEV2ZXJ5IG9yZyBhbmQgcmVwbyBoYXMgdGhlIGRlZmF1bHQgZ3JvdXAgd2l0aCBpZCAxLCB3aGljaCBpcyBhbHNvIHdoYXQgY29uZmlnLnNoIHVzZWQgd2hlblxuICogbm8gZ3JvdXAgd2FzIGdpdmVuLlxuICovXG5hc3luYyBmdW5jdGlvbiBnZXRSdW5uZXJHcm91cElkKG9jdG9raXQ6IE9jdG9raXQsIG93bmVyOiBzdHJpbmcsIGdyb3VwOiBzdHJpbmcpOiBQcm9taXNlPG51bWJlcj4ge1xuICBpZiAoIWdyb3VwKSB7XG4gICAgcmV0dXJuIDE7XG4gIH1cblxuICBsZXQgZ3JvdXBzOiB7IGlkOiBudW1iZXI7IG5hbWU6IHN0cmluZyB9W107XG4gIHRyeSB7XG4gICAgLy8gb2N0b2tpdCBoYXMgbm8gdHlwZWQgbWV0aG9kIGZvciB0aGlzIGVuZHBvaW50XG4gICAgZ3JvdXBzID0gYXdhaXQgb2N0b2tpdC5wYWdpbmF0ZSgnR0VUIC9vcmdzL3tvcmd9L2FjdGlvbnMvcnVubmVyLWdyb3VwcycsIHsgb3JnOiBvd25lciwgcGVyX3BhZ2U6IDEwMCB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBjb25maWd1cmF0aW9uRXJyb3IoZXJyb3IsICdvcmcnLCBvd25lciwgJycpID8/IGVycm9yO1xuICB9XG5cbiAgY29uc3QgZm91bmQgPSBncm91cHMuZmluZChnID0+IGcubmFtZS50b0xvd2VyQ2FzZSgpID09PSBncm91cC50b0xvd2VyQ2FzZSgpKTtcbiAgaWYgKCFmb3VuZCkge1xuICAgIHRocm93IG5ldyBSdW5uZXJDb25maWd1cmF0aW9uRXJyb3IoYFJ1bm5lciBncm91cCBcIiR7Z3JvdXB9XCIgZG9lc24ndCBleGlzdCBpbiBvcmdhbml6YXRpb24gXCIke293bmVyfVwiLmApO1xuICB9XG4gIHJldHVybiBmb3VuZC5pZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0Sml0Q29uZmlnRm9yT3JnKG9jdG9raXQ6IE9jdG9raXQsIG93bmVyOiBzdHJpbmcsIG5hbWU6IHN0cmluZywgbGFiZWxzOiBzdHJpbmdbXSwgZ3JvdXBJZDogbnVtYmVyKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IG9jdG9raXQucmVzdC5hY3Rpb25zLmdlbmVyYXRlUnVubmVySml0Y29uZmlnRm9yT3JnKHtcbiAgICAgIG9yZzogb3duZXIsXG4gICAgICBuYW1lLFxuICAgICAgbGFiZWxzLFxuICAgICAgcnVubmVyX2dyb3VwX2lkOiBncm91cElkLFxuICAgIH0pO1xuICAgIHJldHVybiByZXNwb25zZS5kYXRhLmVuY29kZWRfaml0X2NvbmZpZztcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBjb25maWd1cmF0aW9uRXJyb3IoZXJyb3IsICdvcmcnLCBvd25lciwgJycpID8/IGVycm9yO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEppdENvbmZpZ0ZvclJlcG8ob2N0b2tpdDogT2N0b2tpdCwgb3duZXI6IHN0cmluZywgcmVwbzogc3RyaW5nLCBuYW1lOiBzdHJpbmcsIGxhYmVsczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZz4ge1xuICB0cnkge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgb2N0b2tpdC5yZXN0LmFjdGlvbnMuZ2VuZXJhdGVSdW5uZXJKaXRjb25maWdGb3JSZXBvKHtcbiAgICAgIG93bmVyLFxuICAgICAgcmVwbyxcbiAgICAgIG5hbWUsXG4gICAgICBsYWJlbHMsXG4gICAgICBydW5uZXJfZ3JvdXBfaWQ6IDEsXG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3BvbnNlLmRhdGEuZW5jb2RlZF9qaXRfY29uZmlnO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IGNvbmZpZ3VyYXRpb25FcnJvcihlcnJvciwgJ3JlcG8nLCBvd25lciwgcmVwbykgPz8gZXJyb3I7XG4gIH1cbn1cblxuLyoqXG4gKiBMaWtlIGNvbmZpZy5zaCwgZHJvcCBlbXB0eSBsYWJlbHMgYW5kIHRoZSBzYW1lIGxhYmVsIGluIGRpZmZlcmVudCBjYXNlLlxuICovXG5mdW5jdGlvbiBkZWR1cGVMYWJlbHMobGFiZWxzOiBzdHJpbmdbXSk6IHN0cmluZ1tdIHtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICByZXR1cm4gbGFiZWxzLmZpbHRlcihsID0+IGwgJiYgIXNlZW4uaGFzKGwudG9Mb3dlckNhc2UoKSkgJiYgc2Vlbi5hZGQobC50b0xvd2VyQ2FzZSgpKSk7XG59XG4iXX0=