import type { Octokit as RestOctokit } from '@octokit/rest' with { 'resolution-mode': 'import' };
type OctokitRestModule = typeof import('@octokit/rest', { with: { 'resolution-mode': 'import' } });
type OctokitCoreModule = typeof import('@octokit/core', { with: { 'resolution-mode': 'import' } });
type OctokitAuthAppModule = typeof import('@octokit/auth-app', { with: { 'resolution-mode': 'import' } });
export declare function loadOctokitRest(): Promise<OctokitRestModule>;
export declare function loadOctokitCore(): Promise<OctokitCoreModule>;
export declare function loadOctokitAuthApp(): Promise<OctokitAuthAppModule>;
export declare function baseUrlFromDomain(domain: string): string;
export type RunnerLevel = 'repo' | 'org' | undefined;
export interface GitHubSecrets {
    domain: string;
    appId: number;
    personalAuthToken: string;
    runnerLevel: RunnerLevel;
}
/**
 * Confirm we have what we need for app authentication. Called only when there is no personal access token.
 *
 * @internal
 */
export declare function checkAppAuth(githubSecrets: GitHubSecrets, installationId?: number): void;
/**
 * Confirm the private key secret was actually filled in after deployment.
 *
 * @internal
 */
export declare function checkPrivateKey(privateKey: string): void;
export declare function getOctokit(installationId?: number): Promise<{
    octokit: RestOctokit;
    githubSecrets: GitHubSecrets;
}>;
/**
 * `getOctokit` reads secrets manager and calls GitHub every time. Handlers that work on many runners at once should get one of these per
 * invocation and use it instead. Tokens expire, so don't keep it any longer than the length of one Lambda call.
 *
 * @internal
 */
export declare function cachedGetOctokit(): typeof getOctokit;
export declare function getAppOctokit(): Promise<RestOctokit | undefined>;
export declare function getRunner(octokit: RestOctokit, runnerLevel: RunnerLevel, owner: string, repo: string, name: string): Promise<{
    id: number;
    runner_group_id?: number;
    name: string;
    os: string;
    status: string;
    busy: boolean;
    labels: {
        id?: number;
        name: string;
        type?: "read-only" | "custom";
    }[];
    ephemeral?: boolean;
} | undefined>;
export declare function deleteRunner(octokit: RestOctokit, runnerLevel: RunnerLevel, owner: string, repo: string, runnerId: number): Promise<void>;
export declare function redeliver(octokit: RestOctokit, deliveryId: bigint): Promise<void>;
/**
 * Did GitHub tell us it can't see this? Used to tell "we have no access" apart from a real failure, because the
 * first is permanent and retrying it forever costs rate limit we need for starting runners.
 */
export declare function isNotFound(e: unknown): boolean;
/**
 * Find installation id for our app. Normal code path gets this from the webhook payload, but we schedule these ourselves.
 *
 * If the repository cannot be found (e.g. the app was uninstalled), this will throw a 404 error. Use `isNotFound` to check for that case.
 *
 * @internal
 */
export declare function resolveInstallationId(owner: string, repo: string): Promise<number | undefined>;
export {};
