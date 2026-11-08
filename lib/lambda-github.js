"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadOctokitRest = loadOctokitRest;
exports.loadOctokitCore = loadOctokitCore;
exports.loadOctokitAuthApp = loadOctokitAuthApp;
exports.baseUrlFromDomain = baseUrlFromDomain;
exports.checkAppAuth = checkAppAuth;
exports.checkPrivateKey = checkPrivateKey;
exports.getOctokit = getOctokit;
exports.cachedGetOctokit = cachedGetOctokit;
exports.getAppOctokit = getAppOctokit;
exports.getRunner = getRunner;
exports.deleteRunner = deleteRunner;
exports.redeliver = redeliver;
exports.isNotFound = isNotFound;
exports.resolveInstallationId = resolveInstallationId;
const crypto_1 = require("crypto");
const lambda_common_1 = require("./lambda-common");
const lambda_helpers_1 = require("./lambda-helpers");
let restModulePromise;
let coreModulePromise;
let authAppModulePromise;
function loadOctokitRest() {
    return (restModulePromise ??= import('@octokit/rest'));
}
function loadOctokitCore() {
    return (coreModulePromise ??= import('@octokit/core'));
}
function loadOctokitAuthApp() {
    return (authAppModulePromise ??= import('@octokit/auth-app'));
}
// ---- Other helpers ----
function baseUrlFromDomain(domain) {
    if (domain == 'github.com') {
        return 'https://api.github.com';
    }
    return `https://${domain}/api/v3`;
}
const octokitCache = new Map();
const SETUP_DOCS = 'See https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md';
/**
 * Confirm we have what we need for app authentication. Called only when there is no personal access token.
 *
 * @internal
 */
function checkAppAuth(githubSecrets, installationId) {
    if (!githubSecrets.appId) {
        throw new lambda_helpers_1.RunnerConfigurationError('GitHub authentication has not been set up. The GitHub secret has neither a personal access token ' +
            `(personalAuthToken) nor an app id (appId). Run the setup wizard linked in the stack outputs, or set the secret manually. ${SETUP_DOCS}`);
    }
    if (installationId === undefined || installationId <= 0) {
        throw new lambda_helpers_1.RunnerConfigurationError('Installation ID is required for app authentication. ' +
            'This error can happen if you create the webhook yourself for GitHub app authentication instead of using the app webhook.');
    }
}
/**
 * Confirm the private key secret was actually filled in after deployment.
 *
 * @internal
 */
function checkPrivateKey(privateKey) {
    if (privateKey.trim() === lambda_common_1.GITHUB_PRIVATE_KEY_PLACEHOLDER) {
        throw new lambda_helpers_1.RunnerConfigurationError('GitHub app private key has not been set. The private key secret still has the placeholder we deploy ' +
            `with. Run the setup wizard linked in the stack outputs, or put the app private key in the secret manually. ${SETUP_DOCS}`);
    }
}
async function getOctokit(installationId) {
    if (!process.env.GITHUB_SECRET_ARN || !process.env.GITHUB_PRIVATE_KEY_SECRET_ARN) {
        throw new Error('Missing environment variables');
    }
    const [{ Octokit }, { createAppAuth }] = await Promise.all([
        loadOctokitRest(),
        loadOctokitAuthApp(),
    ]);
    const githubSecrets = await (0, lambda_helpers_1.getSecretJsonValue)(process.env.GITHUB_SECRET_ARN);
    // Create cache key from installation ID and secrets (hash to avoid exposing sensitive data by accident)
    const cacheKey = (0, crypto_1.createHash)('sha256').update(`${installationId || 'no-install'}-${githubSecrets.domain}-${githubSecrets.appId}-${githubSecrets.personalAuthToken}`).digest('hex');
    const cached = octokitCache.get(cacheKey);
    if (cached) {
        try {
            // Test if the cached octokit is still valid
            await cached.rest.meta.getOctocat();
            console.log({
                notice: 'Using cached octokit',
            });
            return {
                octokit: cached,
                githubSecrets,
            };
        }
        catch (e) {
            console.log({
                notice: 'Octokit cache is invalid',
                error: e,
            });
            octokitCache.delete(cacheKey);
        }
    }
    const baseUrl = baseUrlFromDomain(githubSecrets.domain);
    let token;
    if (githubSecrets.personalAuthToken) {
        token = githubSecrets.personalAuthToken;
    }
    else {
        checkAppAuth(githubSecrets, installationId);
        const privateKey = await (0, lambda_helpers_1.getSecretValue)(process.env.GITHUB_PRIVATE_KEY_SECRET_ARN);
        checkPrivateKey(privateKey);
        const appOctokit = new Octokit({
            baseUrl,
            authStrategy: createAppAuth,
            auth: {
                appId: githubSecrets.appId,
                privateKey: privateKey,
            },
        });
        token = (await appOctokit.auth({
            type: 'installation',
            installationId: installationId,
        })).token;
    }
    const octokit = new Octokit({
        baseUrl,
        auth: token,
    });
    // Store in cache
    octokitCache.set(cacheKey, octokit);
    return {
        octokit,
        githubSecrets,
    };
}
/**
 * `getOctokit` reads secrets manager and calls GitHub every time. Handlers that work on many runners at once should get one of these per
 * invocation and use it instead. Tokens expire, so don't keep it any longer than the length of one Lambda call.
 *
 * @internal
 */
function cachedGetOctokit() {
    const cache = new Map();
    return async (installationId) => {
        let cached = cache.get(installationId);
        if (!cached) {
            cached = await getOctokit(installationId);
            cache.set(installationId, cached);
        }
        return cached;
    };
}
// This function is used to get the Octokit instance for the app itself, not for a specific installation.
// With PAT authentication, it returns undefined.
async function getAppOctokit() {
    if (!process.env.GITHUB_SECRET_ARN || !process.env.GITHUB_PRIVATE_KEY_SECRET_ARN) {
        throw new Error('Missing environment variables');
    }
    const [{ Octokit }, { createAppAuth }] = await Promise.all([
        loadOctokitRest(),
        loadOctokitAuthApp(),
    ]);
    const githubSecrets = await (0, lambda_helpers_1.getSecretJsonValue)(process.env.GITHUB_SECRET_ARN);
    const baseUrl = baseUrlFromDomain(githubSecrets.domain);
    if (githubSecrets.personalAuthToken || !githubSecrets.appId) {
        return undefined;
    }
    const privateKey = await (0, lambda_helpers_1.getSecretValue)(process.env.GITHUB_PRIVATE_KEY_SECRET_ARN);
    checkPrivateKey(privateKey);
    return new Octokit({
        baseUrl,
        authStrategy: createAppAuth,
        auth: {
            appId: githubSecrets.appId,
            privateKey: privateKey,
        },
    });
}
async function getRunner(octokit, runnerLevel, owner, repo, name) {
    let page = 1;
    while (true) {
        let runners;
        if ((runnerLevel ?? 'repo') === 'repo') {
            runners = await octokit.rest.actions.listSelfHostedRunnersForRepo({
                name: name,
                page: page,
                owner: owner,
                repo: repo,
            });
        }
        else {
            runners = await octokit.rest.actions.listSelfHostedRunnersForOrg({
                name: name,
                page: page,
                org: owner,
            });
        }
        if (runners.data.runners.length == 0) {
            return;
        }
        for (const runner of runners.data.runners) {
            // we filter by name in the API call, but still double-check here
            // this is for backward compatibility with old GHES instances that may not support the name filter
            if (runner.name == name) {
                return runner;
            }
        }
        page++;
    }
}
async function deleteRunner(octokit, runnerLevel, owner, repo, runnerId) {
    if ((runnerLevel ?? 'repo') === 'repo') {
        await octokit.rest.actions.deleteSelfHostedRunnerFromRepo({
            owner: owner,
            repo: repo,
            runner_id: runnerId,
        });
    }
    else {
        await octokit.rest.actions.deleteSelfHostedRunnerFromOrg({
            org: owner,
            runner_id: runnerId,
        });
    }
}
async function redeliver(octokit, deliveryId) {
    const response = await octokit.rest.apps.redeliverWebhookDelivery({
        // waiting for new octokit -- https://github.com/octokit/request.js/issues/797#issuecomment-3953274583
        delivery_id: deliveryId,
    });
    if (response.status !== 202) {
        throw new Error(`Failed to redeliver webhook delivery with ID ${deliveryId}`);
    }
    console.log({
        notice: 'Successfully redelivered webhook delivery',
        deliveryId: String(deliveryId),
    });
}
/**
 * Did GitHub tell us it can't see this? Used to tell "we have no access" apart from a real failure, because the
 * first is permanent and retrying it forever costs rate limit we need for starting runners.
 */
function isNotFound(e) {
    return e?.status === 404;
}
/**
 * Find installation id for our app. Normal code path gets this from the webhook payload, but we schedule these ourselves.
 *
 * If the repository cannot be found (e.g. the app was uninstalled), this will throw a 404 error. Use `isNotFound` to check for that case.
 *
 * @internal
 */
async function resolveInstallationId(owner, repo) {
    const appOctokit = await getAppOctokit();
    if (!appOctokit) {
        return undefined; // PAT authentication
    }
    if (repo) {
        const { data } = await appOctokit.rest.apps.getRepoInstallation({ owner, repo });
        return data.id;
    }
    else {
        const { data } = await appOctokit.rest.apps.getOrgInstallation({ org: owner });
        return data.id;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLWdpdGh1Yi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9sYW1iZGEtZ2l0aHViLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBZ0JBLDBDQUVDO0FBRUQsMENBRUM7QUFFRCxnREFFQztBQUlELDhDQUtDO0FBb0JELG9DQVVDO0FBT0QsMENBS0M7QUFFRCxnQ0EyRUM7QUFRRCw0Q0FVQztBQUlELHNDQTRCQztBQUVELDhCQWtDQztBQUVELG9DQWFDO0FBRUQsOEJBYUM7QUFNRCxnQ0FFQztBQVNELHNEQWFDO0FBNVNELG1DQUFvQztBQUVwQyxtREFBaUU7QUFDakUscURBQWdHO0FBU2hHLElBQUksaUJBQXlELENBQUM7QUFDOUQsSUFBSSxpQkFBeUQsQ0FBQztBQUM5RCxJQUFJLG9CQUErRCxDQUFDO0FBRXBFLFNBQWdCLGVBQWU7SUFDN0IsT0FBTyxDQUFDLGlCQUFpQixLQUFLLE1BQU0sQ0FBQyxlQUFlLENBQStCLENBQUMsQ0FBQztBQUN2RixDQUFDO0FBRUQsU0FBZ0IsZUFBZTtJQUM3QixPQUFPLENBQUMsaUJBQWlCLEtBQUssTUFBTSxDQUFDLGVBQWUsQ0FBK0IsQ0FBQyxDQUFDO0FBQ3ZGLENBQUM7QUFFRCxTQUFnQixrQkFBa0I7SUFDaEMsT0FBTyxDQUFDLG9CQUFvQixLQUFLLE1BQU0sQ0FBQyxtQkFBbUIsQ0FBa0MsQ0FBQyxDQUFDO0FBQ2pHLENBQUM7QUFFRCwwQkFBMEI7QUFFMUIsU0FBZ0IsaUJBQWlCLENBQUMsTUFBYztJQUM5QyxJQUFJLE1BQU0sSUFBSSxZQUFZLEVBQUUsQ0FBQztRQUMzQixPQUFPLHdCQUF3QixDQUFDO0lBQ2xDLENBQUM7SUFDRCxPQUFPLFdBQVcsTUFBTSxTQUFTLENBQUM7QUFDcEMsQ0FBQztBQVdELE1BQU0sWUFBWSxHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO0FBRXBELE1BQU0sVUFBVSxHQUFHLGtGQUFrRixDQUFDO0FBRXRHOzs7O0dBSUc7QUFDSCxTQUFnQixZ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QUFDO1FBQ1QsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLE1BQU0sVUFBVSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUNqRixPQUFPLElBQUksQ0FBQyxFQUFFLENBQUM7SUFDakIsQ0FBQztTQUFNLENBQUM7UUFDTixNQUFNLEVBQUUsSUFBSSxFQUFFLEdBQUcsTUFBTSxVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1FBQy9FLE9BQU8sSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUNqQixDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGNyZWF0ZUhhc2ggfSBmcm9tICdjcnlwdG8nO1xuaW1wb3J0IHR5cGUgeyBPY3Rva2l0IGFzIFJlc3RPY3Rva2l0IH0gZnJvbSAnQG9jdG9raXQvcmVzdCcgd2l0aCB7ICdyZXNvbHV0aW9uLW1vZGUnOiAnaW1wb3J0JyB9O1xuaW1wb3J0IHsgR0lUSFVCX1BSSVZBVEVfS0VZX1BMQUNFSE9MREVSIH0gZnJvbSAnLi9sYW1iZGEtY29tbW9uJztcbmltcG9ydCB7IGdldFNlY3JldEpzb25WYWx1ZSwgZ2V0U2VjcmV0VmFsdWUsIFJ1bm5lckNvbmZpZ3VyYXRpb25FcnJvciB9IGZyb20gJy4vbGFtYmRhLWhlbHBlcnMnO1xuXG4vLyAtLS0tIE9jdG9raXQgRVNNIGxvYWRlciBoZWxwZXJzIChpbmxpbmVkKSAtLS0tXG4vLyBPY3Rva2l0IHBhY2thZ2VzIGFyZSBFU00sIGJ1dCBvdXIgTGFtYmRhIGFzc2V0cyBhcmUgYnVuZGxlZCBpbnRvIENKUy5cbi8vIFVzaW5nIGR5bmFtaWMgYGltcG9ydCgpYCBoZXJlIGxldHMgZXNidWlsZCBpbmNsdWRlIE9jdG9raXQgaW4gdGhlIGJ1bmRsZS5cbnR5cGUgT2N0b2tpdFJlc3RNb2R1bGUgPSB0eXBlb2YgaW1wb3J0KCdAb2N0b2tpdC9yZXN0JywgeyB3aXRoOiB7ICdyZXNvbHV0aW9uLW1vZGUnOiAnaW1wb3J0JyB9IH0pO1xudHlwZSBPY3Rva2l0Q29yZU1vZHVsZSA9IHR5cGVvZiBpbXBvcnQoJ0BvY3Rva2l0L2NvcmUnLCB7IHdpdGg6IHsgJ3Jlc29sdXRpb24tbW9kZSc6ICdpbXBvcnQnIH0gfSk7XG50eXBlIE9jdG9raXRBdXRoQXBwTW9kdWxlID0gdHlwZW9mIGltcG9ydCgnQG9jdG9raXQvYXV0aC1hcHAnLCB7IHdpdGg6IHsgJ3Jlc29sdXRpb24tbW9kZSc6ICdpbXBvcnQnIH0gfSk7XG5cbmxldCByZXN0TW9kdWxlUHJvbWlzZTogUHJvbWlzZTxPY3Rva2l0UmVzdE1vZHVsZT4gfCB1bmRlZmluZWQ7XG5sZXQgY29yZU1vZHVsZVByb21pc2U6IFByb21pc2U8T2N0b2tpdENvcmVNb2R1bGU+IHwgdW5kZWZpbmVkO1xubGV0IGF1dGhBcHBNb2R1bGVQcm9taXNlOiBQcm9taXNlPE9jdG9raXRBdXRoQXBwTW9kdWxlPiB8IHVuZGVmaW5lZDtcblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRPY3Rva2l0UmVzdCgpOiBQcm9taXNlPE9jdG9raXRSZXN0TW9kdWxlPiB7XG4gIHJldHVybiAocmVzdE1vZHVsZVByb21pc2UgPz89IGltcG9ydCgnQG9jdG9raXQvcmVzdCcpIGFzIFByb21pc2U8T2N0b2tpdFJlc3RNb2R1bGU+KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRPY3Rva2l0Q29yZSgpOiBQcm9taXNlPE9jdG9raXRDb3JlTW9kdWxlPiB7XG4gIHJldHVybiAoY29yZU1vZHVsZVByb21pc2UgPz89IGltcG9ydCgnQG9jdG9raXQvY29yZScpIGFzIFByb21pc2U8T2N0b2tpdENvcmVNb2R1bGU+KTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGxvYWRPY3Rva2l0QXV0aEFwcCgpOiBQcm9taXNlPE9jdG9raXRBdXRoQXBwTW9kdWxlPiB7XG4gIHJldHVybiAoYXV0aEFwcE1vZHVsZVByb21pc2UgPz89IGltcG9ydCgnQG9jdG9raXQvYXV0aC1hcHAnKSBhcyBQcm9taXNlPE9jdG9raXRBdXRoQXBwTW9kdWxlPik7XG59XG5cbi8vIC0tLS0gT3RoZXIgaGVscGVycyAtLS0tXG5cbmV4cG9ydCBmdW5jdGlvbiBiYXNlVXJsRnJvbURvbWFpbihkb21haW46IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmIChkb21haW4gPT0gJ2dpdGh1Yi5jb20nKSB7XG4gICAgcmV0dXJuICdodHRwczovL2FwaS5naXRodWIuY29tJztcbiAgfVxuICByZXR1cm4gYGh0dHBzOi8vJHtkb21haW59L2FwaS92M2A7XG59XG5cbmV4cG9ydCB0eXBlIFJ1bm5lckxldmVsID0gJ3JlcG8nIHwgJ29yZycgfCB1bmRlZmluZWQ7IC8vIHVuZGVmaW5lZCBpcyBmb3IgYmFja3dhcmRzIGNvbXBhdGliaWxpdHkgYW5kIHNob3VsZCBiZSB0cmVhdGVkIGFzICdyZXBvJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdpdEh1YlNlY3JldHMge1xuICBkb21haW46IHN0cmluZztcbiAgYXBwSWQ6IG51bWJlcjtcbiAgcGVyc29uYWxBdXRoVG9rZW46IHN0cmluZztcbiAgcnVubmVyTGV2ZWw6IFJ1bm5lckxldmVsO1xufVxuXG5jb25zdCBvY3Rva2l0Q2FjaGUgPSBuZXcgTWFwPHN0cmluZywgUmVzdE9jdG9raXQ+KCk7XG5cbmNvbnN0IFNFVFVQX0RPQ1MgPSAnU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzL2Jsb2IvbWFpbi9TRVRVUF9HSVRIVUIubWQnO1xuXG4vKipcbiAqIENvbmZpcm0gd2UgaGF2ZSB3aGF0IHdlIG5lZWQgZm9yIGFwcCBhdXRoZW50aWNhdGlvbi4gQ2FsbGVkIG9ubHkgd2hlbiB0aGVyZSBpcyBubyBwZXJzb25hbCBhY2Nlc3MgdG9rZW4uXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjaGVja0FwcEF1dGgoZ2l0aHViU2VjcmV0czogR2l0SHViU2VjcmV0cywgaW5zdGFsbGF0aW9uSWQ/OiBudW1iZXIpIHtcbiAgaWYgKCFnaXRodWJTZWNyZXRzLmFwcElkKSB7XG4gICAgdGhyb3cgbmV3IFJ1bm5lckNvbmZpZ3VyYXRpb25FcnJvcignR2l0SHViIGF1dGhlbnRpY2F0aW9uIGhhcyBub3QgYmVlbiBzZXQgdXAuIFRoZSBHaXRIdWIgc2VjcmV0IGhhcyBuZWl0aGVyIGEgcGVyc29uYWwgYWNjZXNzIHRva2VuICcgK1xuICAgICAgYChwZXJzb25hbEF1dGhUb2tlbikgbm9yIGFuIGFwcCBpZCAoYXBwSWQpLiBSdW4gdGhlIHNldHVwIHdpemFyZCBsaW5rZWQgaW4gdGhlIHN0YWNrIG91dHB1dHMsIG9yIHNldCB0aGUgc2VjcmV0IG1hbnVhbGx5LiAke1NFVFVQX0RPQ1N9YCk7XG4gIH1cblxuICBpZiAoaW5zdGFsbGF0aW9uSWQgPT09IHVuZGVmaW5lZCB8fCBpbnN0YWxsYXRpb25JZCA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IFJ1bm5lckNvbmZpZ3VyYXRpb25FcnJvcignSW5zdGFsbGF0aW9uIElEIGlzIHJlcXVpcmVkIGZvciBhcHAgYXV0aGVudGljYXRpb24uICcgK1xuICAgICAgJ1RoaXMgZXJyb3IgY2FuIGhhcHBlbiBpZiB5b3UgY3JlYXRlIHRoZSB3ZWJob29rIHlvdXJzZWxmIGZvciBHaXRIdWIgYXBwIGF1dGhlbnRpY2F0aW9uIGluc3RlYWQgb2YgdXNpbmcgdGhlIGFwcCB3ZWJob29rLicpO1xuICB9XG59XG5cbi8qKlxuICogQ29uZmlybSB0aGUgcHJpdmF0ZSBrZXkgc2VjcmV0IHdhcyBhY3R1YWxseSBmaWxsZWQgaW4gYWZ0ZXIgZGVwbG95bWVudC5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrUHJpdmF0ZUtleShwcml2YXRlS2V5OiBzdHJpbmcpIHtcbiAgaWYgKHByaXZhdGVLZXkudHJpbSgpID09PSBHSVRIVUJfUFJJVkFURV9LRVlfUExBQ0VIT0xERVIpIHtcbiAgICB0aHJvdyBuZXcgUnVubmVyQ29uZmlndXJhdGlvbkVycm9yKCdHaXRIdWIgYXBwIHByaXZhdGUga2V5IGhhcyBub3QgYmVlbiBzZXQuIFRoZSBwcml2YXRlIGtleSBzZWNyZXQgc3RpbGwgaGFzIHRoZSBwbGFjZWhvbGRlciB3ZSBkZXBsb3kgJyArXG4gICAgICBgd2l0aC4gUnVuIHRoZSBzZXR1cCB3aXphcmQgbGlua2VkIGluIHRoZSBzdGFjayBvdXRwdXRzLCBvciBwdXQgdGhlIGFwcCBwcml2YXRlIGtleSBpbiB0aGUgc2VjcmV0IG1hbnVhbGx5LiAke1NFVFVQX0RPQ1N9YCk7XG4gIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldE9jdG9raXQoaW5zdGFsbGF0aW9uSWQ/OiBudW1iZXIpOiBQcm9taXNlPHsgb2N0b2tpdDogUmVzdE9jdG9raXQ7IGdpdGh1YlNlY3JldHM6IEdpdEh1YlNlY3JldHMgfT4ge1xuICBpZiAoIXByb2Nlc3MuZW52LkdJVEhVQl9TRUNSRVRfQVJOIHx8ICFwcm9jZXNzLmVudi5HSVRIVUJfUFJJVkFURV9LRVlfU0VDUkVUX0FSTikge1xuICAgIHRocm93IG5ldyBFcnJvcignTWlzc2luZyBlbnZpcm9ubWVudCB2YXJpYWJsZXMnKTtcbiAgfVxuXG4gIGNvbnN0IFt7IE9jdG9raXQgfSwgeyBjcmVhdGVBcHBBdXRoIH1dID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgIGxvYWRPY3Rva2l0UmVzdCgpLFxuICAgIGxvYWRPY3Rva2l0QXV0aEFwcCgpLFxuICBdKTtcblxuICBjb25zdCBnaXRodWJTZWNyZXRzOiBHaXRIdWJTZWNyZXRzID0gYXdhaXQgZ2V0U2VjcmV0SnNvblZhbHVlKHByb2Nlc3MuZW52LkdJVEhVQl9TRUNSRVRfQVJOKTtcblxuICAvLyBDcmVhdGUgY2FjaGUga2V5IGZyb20gaW5zdGFsbGF0aW9uIElEIGFuZCBzZWNyZXRzIChoYXNoIHRvIGF2b2lkIGV4cG9zaW5nIHNlbnNpdGl2ZSBkYXRhIGJ5IGFjY2lkZW50KVxuICBjb25zdCBjYWNoZUtleSA9IGNyZWF0ZUhhc2goJ3NoYTI1NicpLnVwZGF0ZShgJHtpbnN0YWxsYXRpb25JZCB8fCAnbm8taW5zdGFsbCd9LSR7Z2l0aHViU2VjcmV0cy5kb21haW59LSR7Z2l0aHViU2VjcmV0cy5hcHBJZH0tJHtnaXRodWJTZWNyZXRzLnBlcnNvbmFsQXV0aFRva2VufWApLmRpZ2VzdCgnaGV4Jyk7XG5cbiAgY29uc3QgY2FjaGVkID0gb2N0b2tpdENhY2hlLmdldChjYWNoZUtleSk7XG4gIGlmIChjYWNoZWQpIHtcbiAgICB0cnkge1xuICAgICAgLy8gVGVzdCBpZiB0aGUgY2FjaGVkIG9jdG9raXQgaXMgc3RpbGwgdmFsaWRcbiAgICAgIGF3YWl0IGNhY2hlZC5yZXN0Lm1ldGEuZ2V0T2N0b2NhdCgpO1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdVc2luZyBjYWNoZWQgb2N0b2tpdCcsXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG9jdG9raXQ6IGNhY2hlZCxcbiAgICAgICAgZ2l0aHViU2VjcmV0cyxcbiAgICAgIH07XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdPY3Rva2l0IGNhY2hlIGlzIGludmFsaWQnLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgIH0pO1xuICAgICAgb2N0b2tpdENhY2hlLmRlbGV0ZShjYWNoZUtleSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgYmFzZVVybCA9IGJhc2VVcmxGcm9tRG9tYWluKGdpdGh1YlNlY3JldHMuZG9tYWluKTtcblxuICBsZXQgdG9rZW47XG4gIGlmIChnaXRodWJTZWNyZXRzLnBlcnNvbmFsQXV0aFRva2VuKSB7XG4gICAgdG9rZW4gPSBnaXRodWJTZWNyZXRzLnBlcnNvbmFsQXV0aFRva2VuO1xuICB9IGVsc2Uge1xuICAgIGNoZWNrQXBwQXV0aChnaXRodWJTZWNyZXRzLCBpbnN0YWxsYXRpb25JZCk7XG5cbiAgICBjb25zdCBwcml2YXRlS2V5ID0gYXdhaXQgZ2V0U2VjcmV0VmFsdWUocHJvY2Vzcy5lbnYuR0lUSFVCX1BSSVZBVEVfS0VZX1NFQ1JFVF9BUk4pO1xuXG4gICAgY2hlY2tQcml2YXRlS2V5KHByaXZhdGVLZXkpO1xuXG4gICAgY29uc3QgYXBwT2N0b2tpdCA9IG5ldyBPY3Rva2l0KHtcbiAgICAgIGJhc2VVcmwsXG4gICAgICBhdXRoU3RyYXRlZ3k6IGNyZWF0ZUFwcEF1dGgsXG4gICAgICBhdXRoOiB7XG4gICAgICAgIGFwcElkOiBnaXRodWJTZWNyZXRzLmFwcElkLFxuICAgICAgICBwcml2YXRlS2V5OiBwcml2YXRlS2V5LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRva2VuID0gKGF3YWl0IGFwcE9jdG9raXQuYXV0aCh7XG4gICAgICB0eXBlOiAnaW5zdGFsbGF0aW9uJyxcbiAgICAgIGluc3RhbGxhdGlvbklkOiBpbnN0YWxsYXRpb25JZCxcbiAgICB9KSBhcyBhbnkpLnRva2VuO1xuICB9XG5cbiAgY29uc3Qgb2N0b2tpdCA9IG5ldyBPY3Rva2l0KHtcbiAgICBiYXNlVXJsLFxuICAgIGF1dGg6IHRva2VuLFxuICB9KTtcblxuICAvLyBTdG9yZSBpbiBjYWNoZVxuICBvY3Rva2l0Q2FjaGUuc2V0KGNhY2hlS2V5LCBvY3Rva2l0KTtcblxuICByZXR1cm4ge1xuICAgIG9jdG9raXQsXG4gICAgZ2l0aHViU2VjcmV0cyxcbiAgfTtcbn1cblxuLyoqXG4gKiBgZ2V0T2N0b2tpdGAgcmVhZHMgc2VjcmV0cyBtYW5hZ2VyIGFuZCBjYWxscyBHaXRIdWIgZXZlcnkgdGltZS4gSGFuZGxlcnMgdGhhdCB3b3JrIG9uIG1hbnkgcnVubmVycyBhdCBvbmNlIHNob3VsZCBnZXQgb25lIG9mIHRoZXNlIHBlclxuICogaW52b2NhdGlvbiBhbmQgdXNlIGl0IGluc3RlYWQuIFRva2VucyBleHBpcmUsIHNvIGRvbid0IGtlZXAgaXQgYW55IGxvbmdlciB0aGFuIHRoZSBsZW5ndGggb2Ygb25lIExhbWJkYSBjYWxsLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gY2FjaGVkR2V0T2N0b2tpdCgpOiB0eXBlb2YgZ2V0T2N0b2tpdCB7XG4gIGNvbnN0IGNhY2hlID0gbmV3IE1hcDxudW1iZXIgfCB1bmRlZmluZWQsIEF3YWl0ZWQ8UmV0dXJuVHlwZTx0eXBlb2YgZ2V0T2N0b2tpdD4+PigpO1xuICByZXR1cm4gYXN5bmMgKGluc3RhbGxhdGlvbklkPzogbnVtYmVyKSA9PiB7XG4gICAgbGV0IGNhY2hlZCA9IGNhY2hlLmdldChpbnN0YWxsYXRpb25JZCk7XG4gICAgaWYgKCFjYWNoZWQpIHtcbiAgICAgIGNhY2hlZCA9IGF3YWl0IGdldE9jdG9raXQoaW5zdGFsbGF0aW9uSWQpO1xuICAgICAgY2FjaGUuc2V0KGluc3RhbGxhdGlvbklkLCBjYWNoZWQpO1xuICAgIH1cbiAgICByZXR1cm4gY2FjaGVkO1xuICB9O1xufVxuXG4vLyBUaGlzIGZ1bmN0aW9uIGlzIHVzZWQgdG8gZ2V0IHRoZSBPY3Rva2l0IGluc3RhbmNlIGZvciB0aGUgYXBwIGl0c2VsZiwgbm90IGZvciBhIHNwZWNpZmljIGluc3RhbGxhdGlvbi5cbi8vIFdpdGggUEFUIGF1dGhlbnRpY2F0aW9uLCBpdCByZXR1cm5zIHVuZGVmaW5lZC5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBnZXRBcHBPY3Rva2l0KCk6IFByb21pc2U8UmVzdE9jdG9raXQgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKCFwcm9jZXNzLmVudi5HSVRIVUJfU0VDUkVUX0FSTiB8fCAhcHJvY2Vzcy5lbnYuR0lUSFVCX1BSSVZBVEVfS0VZX1NFQ1JFVF9BUk4pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ01pc3NpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzJyk7XG4gIH1cblxuICBjb25zdCBbeyBPY3Rva2l0IH0sIHsgY3JlYXRlQXBwQXV0aCB9XSA9IGF3YWl0IFByb21pc2UuYWxsKFtcbiAgICBsb2FkT2N0b2tpdFJlc3QoKSxcbiAgICBsb2FkT2N0b2tpdEF1dGhBcHAoKSxcbiAgXSk7XG5cbiAgY29uc3QgZ2l0aHViU2VjcmV0czogR2l0SHViU2VjcmV0cyA9IGF3YWl0IGdldFNlY3JldEpzb25WYWx1ZShwcm9jZXNzLmVudi5HSVRIVUJfU0VDUkVUX0FSTik7XG4gIGNvbnN0IGJhc2VVcmwgPSBiYXNlVXJsRnJvbURvbWFpbihnaXRodWJTZWNyZXRzLmRvbWFpbik7XG5cbiAgaWYgKGdpdGh1YlNlY3JldHMucGVyc29uYWxBdXRoVG9rZW4gfHwgIWdpdGh1YlNlY3JldHMuYXBwSWQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgY29uc3QgcHJpdmF0ZUtleSA9IGF3YWl0IGdldFNlY3JldFZhbHVlKHByb2Nlc3MuZW52LkdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOKTtcbiAgY2hlY2tQcml2YXRlS2V5KHByaXZhdGVLZXkpO1xuXG4gIHJldHVybiBuZXcgT2N0b2tpdCh7XG4gICAgYmFzZVVybCxcbiAgICBhdXRoU3RyYXRlZ3k6IGNyZWF0ZUFwcEF1dGgsXG4gICAgYXV0aDoge1xuICAgICAgYXBwSWQ6IGdpdGh1YlNlY3JldHMuYXBwSWQsXG4gICAgICBwcml2YXRlS2V5OiBwcml2YXRlS2V5LFxuICAgIH0sXG4gIH0pO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ2V0UnVubmVyKG9jdG9raXQ6IFJlc3RPY3Rva2l0LCBydW5uZXJMZXZlbDogUnVubmVyTGV2ZWwsIG93bmVyOiBzdHJpbmcsIHJlcG86IHN0cmluZywgbmFtZTogc3RyaW5nKSB7XG4gIGxldCBwYWdlID0gMTtcbiAgd2hpbGUgKHRydWUpIHtcbiAgICBsZXQgcnVubmVycztcblxuICAgIGlmICgocnVubmVyTGV2ZWwgPz8gJ3JlcG8nKSA9PT0gJ3JlcG8nKSB7XG4gICAgICBydW5uZXJzID0gYXdhaXQgb2N0b2tpdC5yZXN0LmFjdGlvbnMubGlzdFNlbGZIb3N0ZWRSdW5uZXJzRm9yUmVwbyh7XG4gICAgICAgIG5hbWU6IG5hbWUsXG4gICAgICAgIHBhZ2U6IHBhZ2UsXG4gICAgICAgIG93bmVyOiBvd25lcixcbiAgICAgICAgcmVwbzogcmVwbyxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBydW5uZXJzID0gYXdhaXQgb2N0b2tpdC5yZXN0LmFjdGlvbnMubGlzdFNlbGZIb3N0ZWRSdW5uZXJzRm9yT3JnKHtcbiAgICAgICAgbmFtZTogbmFtZSxcbiAgICAgICAgcGFnZTogcGFnZSxcbiAgICAgICAgb3JnOiBvd25lcixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChydW5uZXJzLmRhdGEucnVubmVycy5sZW5ndGggPT0gMCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgcnVubmVyIG9mIHJ1bm5lcnMuZGF0YS5ydW5uZXJzKSB7XG4gICAgICAvLyB3ZSBmaWx0ZXIgYnkgbmFtZSBpbiB0aGUgQVBJIGNhbGwsIGJ1dCBzdGlsbCBkb3VibGUtY2hlY2sgaGVyZVxuICAgICAgLy8gdGhpcyBpcyBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eSB3aXRoIG9sZCBHSEVTIGluc3RhbmNlcyB0aGF0IG1heSBub3Qgc3VwcG9ydCB0aGUgbmFtZSBmaWx0ZXJcbiAgICAgIGlmIChydW5uZXIubmFtZSA9PSBuYW1lKSB7XG4gICAgICAgIHJldHVybiBydW5uZXI7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcGFnZSsrO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWxldGVSdW5uZXIob2N0b2tpdDogUmVzdE9jdG9raXQsIHJ1bm5lckxldmVsOiBSdW5uZXJMZXZlbCwgb3duZXI6IHN0cmluZywgcmVwbzogc3RyaW5nLCBydW5uZXJJZDogbnVtYmVyKSB7XG4gIGlmICgocnVubmVyTGV2ZWwgPz8gJ3JlcG8nKSA9PT0gJ3JlcG8nKSB7XG4gICAgYXdhaXQgb2N0b2tpdC5yZXN0LmFjdGlvbnMuZGVsZXRlU2VsZkhvc3RlZFJ1bm5lckZyb21SZXBvKHtcbiAgICAgIG93bmVyOiBvd25lcixcbiAgICAgIHJlcG86IHJlcG8sXG4gICAgICBydW5uZXJfaWQ6IHJ1bm5lcklkLFxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGF3YWl0IG9jdG9raXQucmVzdC5hY3Rpb25zLmRlbGV0ZVNlbGZIb3N0ZWRSdW5uZXJGcm9tT3JnKHtcbiAgICAgIG9yZzogb3duZXIsXG4gICAgICBydW5uZXJfaWQ6IHJ1bm5lcklkLFxuICAgIH0pO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWRlbGl2ZXIob2N0b2tpdDogUmVzdE9jdG9raXQsIGRlbGl2ZXJ5SWQ6IGJpZ2ludCkge1xuICBjb25zdCByZXNwb25zZSA9IGF3YWl0IG9jdG9raXQucmVzdC5hcHBzLnJlZGVsaXZlcldlYmhvb2tEZWxpdmVyeSh7XG4gICAgLy8gd2FpdGluZyBmb3IgbmV3IG9jdG9raXQgLS0gaHR0cHM6Ly9naXRodWIuY29tL29jdG9raXQvcmVxdWVzdC5qcy9pc3N1ZXMvNzk3I2lzc3VlY29tbWVudC0zOTUzMjc0NTgzXG4gICAgZGVsaXZlcnlfaWQ6IGRlbGl2ZXJ5SWQgYXMgdW5rbm93biBhcyBudW1iZXIsXG4gIH0pO1xuXG4gIGlmIChyZXNwb25zZS5zdGF0dXMgIT09IDIwMikge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIHJlZGVsaXZlciB3ZWJob29rIGRlbGl2ZXJ5IHdpdGggSUQgJHtkZWxpdmVyeUlkfWApO1xuICB9XG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdTdWNjZXNzZnVsbHkgcmVkZWxpdmVyZWQgd2ViaG9vayBkZWxpdmVyeScsXG4gICAgZGVsaXZlcnlJZDogU3RyaW5nKGRlbGl2ZXJ5SWQpLFxuICB9KTtcbn1cblxuLyoqXG4gKiBEaWQgR2l0SHViIHRlbGwgdXMgaXQgY2FuJ3Qgc2VlIHRoaXM/IFVzZWQgdG8gdGVsbCBcIndlIGhhdmUgbm8gYWNjZXNzXCIgYXBhcnQgZnJvbSBhIHJlYWwgZmFpbHVyZSwgYmVjYXVzZSB0aGVcbiAqIGZpcnN0IGlzIHBlcm1hbmVudCBhbmQgcmV0cnlpbmcgaXQgZm9yZXZlciBjb3N0cyByYXRlIGxpbWl0IHdlIG5lZWQgZm9yIHN0YXJ0aW5nIHJ1bm5lcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc05vdEZvdW5kKGU6IHVua25vd24pOiBib29sZWFuIHtcbiAgcmV0dXJuIChlIGFzIHsgc3RhdHVzPzogbnVtYmVyIH0pPy5zdGF0dXMgPT09IDQwNDtcbn1cblxuLyoqXG4gKiBGaW5kIGluc3RhbGxhdGlvbiBpZCBmb3Igb3VyIGFwcC4gTm9ybWFsIGNvZGUgcGF0aCBnZXRzIHRoaXMgZnJvbSB0aGUgd2ViaG9vayBwYXlsb2FkLCBidXQgd2Ugc2NoZWR1bGUgdGhlc2Ugb3Vyc2VsdmVzLlxuICpcbiAqIElmIHRoZSByZXBvc2l0b3J5IGNhbm5vdCBiZSBmb3VuZCAoZS5nLiB0aGUgYXBwIHdhcyB1bmluc3RhbGxlZCksIHRoaXMgd2lsbCB0aHJvdyBhIDQwNCBlcnJvci4gVXNlIGBpc05vdEZvdW5kYCB0byBjaGVjayBmb3IgdGhhdCBjYXNlLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUluc3RhbGxhdGlvbklkKG93bmVyOiBzdHJpbmcsIHJlcG86IHN0cmluZykge1xuICBjb25zdCBhcHBPY3Rva2l0ID0gYXdhaXQgZ2V0QXBwT2N0b2tpdCgpO1xuICBpZiAoIWFwcE9jdG9raXQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkOyAvLyBQQVQgYXV0aGVudGljYXRpb25cbiAgfVxuXG4gIGlmIChyZXBvKSB7XG4gICAgY29uc3QgeyBkYXRhIH0gPSBhd2FpdCBhcHBPY3Rva2l0LnJlc3QuYXBwcy5nZXRSZXBvSW5zdGFsbGF0aW9uKHsgb3duZXIsIHJlcG8gfSk7XG4gICAgcmV0dXJuIGRhdGEuaWQ7XG4gIH0gZWxzZSB7XG4gICAgY29uc3QgeyBkYXRhIH0gPSBhd2FpdCBhcHBPY3Rva2l0LnJlc3QuYXBwcy5nZXRPcmdJbnN0YWxsYXRpb24oeyBvcmc6IG93bmVyIH0pO1xuICAgIHJldHVybiBkYXRhLmlkO1xuICB9XG59XG4iXX0=