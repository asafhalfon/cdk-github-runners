import type { Octokit as RestOctokit } from '@octokit/rest';
type OctokitRestModule = typeof import('@octokit/rest');
type OctokitCoreModule = typeof import('@octokit/core');
type OctokitAuthAppModule = typeof import('@octokit/auth-app');
export declare function loadOctokitRest(): Promise<OctokitRestModule>;
export declare function loadOctokitCore(): Promise<OctokitCoreModule>;
export declare function loadOctokitAuthApp(): Promise<OctokitAuthAppModule>;
export declare function baseUrlFromDomain(domain: string): string;
type RunnerLevel = 'repo' | 'org' | undefined;
export interface GitHubSecrets {
    domain: string;
    appId: number;
    personalAuthToken: string;
    runnerLevel: RunnerLevel;
}
export declare function getOctokit(installationId?: number): Promise<{
    octokit: RestOctokit;
    githubSecrets: GitHubSecrets;
}>;
export declare function getAppOctokit(): Promise<(import("@octokit/core").Octokit & import("@octokit/plugin-rest-endpoint-methods/dist-types/generated/method-types").RestEndpointMethods & import("@octokit/plugin-rest-endpoint-methods").Api & {
    paginate: import("@octokit/plugin-paginate-rest").PaginateInterface;
}) | undefined>;
export declare function getRunner(octokit: RestOctokit, runnerLevel: RunnerLevel, owner: string, repo: string, name: string): Promise<{
    id: number;
    runner_group_id?: number;
    name: string;
    os: string;
    status: string;
    busy: boolean;
    labels: import("@octokit/openapi-types").components["schemas"]["runner-label"][];
    ephemeral?: boolean;
} | undefined>;
export declare function deleteRunner(octokit: RestOctokit, runnerLevel: RunnerLevel, owner: string, repo: string, runnerId: number): Promise<void>;
export declare function redeliver(octokit: RestOctokit, deliveryId: bigint): Promise<void>;
export {};
