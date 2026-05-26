import * as cdk from 'aws-cdk-lib';
import { aws_events as events } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ICompositeProvider, IRunnerProvider } from './providers';
import { GitHubRunners } from './runner';
import { WarmRunnerFillPayload } from './warm-runner-manager.lambda';
/**
 * Common properties for warm runner constructs.
 *
 * @internal
 */
export interface WarmRunnerBaseProps {
    /**
     * The GitHubRunners construct that owns the shared warm runner infrastructure.
     */
    readonly runners: GitHubRunners;
    /**
     * Provider to use. Warm runners bypass the provider selector — they always use
     * this provider, regardless of job characteristics. Labels cannot be modified.
     */
    readonly provider: IRunnerProvider | ICompositeProvider;
    /**
     * Number of warm runners to maintain.
     */
    readonly count: number;
    /**
     * GitHub owner where runners will be registered (org or user login).
     */
    readonly owner: string;
    /**
     * Registration level — must match how your runners are set up in GitHub. Choose
     * 'org' for org-wide runners, 'repo' for repo-level. See the setup wizard for choosing repo vs org.
     *
     * @see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md
     *
     * @default 'repo'
     */
    readonly registrationLevel?: 'org' | 'repo';
    /**
     * Repository name (without owner) where runners will be registered. Required when `registrationLevel` is 'repo'.
     */
    readonly repo?: string;
}
/**
 * Properties for always on warm runners.
 */
export interface AlwaysOnWarmRunnerProps extends WarmRunnerBaseProps {
}
/**
 * Properties for scheduled warm runners.
 */
export interface ScheduledWarmRunnerProps extends WarmRunnerBaseProps {
    /**
     * When to start filling the pool (e.g. start of business hours).
     */
    readonly schedule: events.Schedule;
    /**
     * How long the warm runners should be maintained from the fill time (schedule). Defines the end of the
     * window (schedule time + duration).
     */
    readonly duration: cdk.Duration;
}
/**
 * Warm runners that run 24/7. Fills at midnight UTC and each runner stays alive for 24 hours.
 *
 * Runners will be provisioned using the specified provider and registered in the specified repository or organization.
 *
 * Registration level must match the one selected during setup.
 *
 * @see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md
 *
 * ## Limitations
 *
 * - Jobs will still trigger provisioning of on-demand runners, even if a warm runner ends up being used.
 * - You may briefly see more than `count` runners when changing config or at rotation.
 * - To remove: set `count` to 0, deploy, wait for warm runners to stop, then remove and deploy again.
 *   If you don't follow this procedure, warm runners may linger until they expire.
 * - Provider failures or timeouts (like Lambda provider timing out after 15 minutes) will result in a
 *   gap in coverage until the retry succeeds. Current retry mechanism has built-in back-off rate and
 *   can be tweaked using `retryOptions`. This will be improved in the future.
 *
 * ```typescript
 * new AlwaysOnWarmRunner(stack, 'AlwaysOnLinux', {
 *   runners,
 *   provider: myProvider,
 *   count: 3,
 *   owner: 'my-org',
 *   repo: 'my-repo',
 * });
 * ```
 */
export declare class AlwaysOnWarmRunner extends Construct {
    /**
     * The fill payload for this warm runner configuration.
     * @internal
     */
    readonly _fillPayload: WarmRunnerFillPayload;
    constructor(scope: Construct, id: string, props: AlwaysOnWarmRunnerProps);
}
/**
 * Warm runners active during a time window specified by start time (`schedule`) and duration (`duration`).
 *
 * Runners will be provisioned using the specified provider and registered in the specified repository or organization.
 *
 * Registration level must match the one selected during setup.
 *
 * @see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md
 *
 * ## Limitations
 *
 * - **No deployment-fill**: Unlike `AlwaysOnWarmRunner`, scheduled warm runners do not get an initial
 *   fill on deploy. The first fill happens at the next schedule occurrence. If you deploy at 1pm for
 *   a 2pm schedule, runners will not appear until 2pm.
 * - Jobs will still trigger provisioning of on-demand runners, even if a warm runner ends up being used.
 * - You may briefly see more than `count` runners when changing config or at rotation.
 * - To remove: set `count` to 0, deploy, wait for warm runners to stop, then remove and deploy again.
 *   If you don't follow this procedure, warm runners may linger until they expire.
 * - Provider failures or timeouts (like Lambda provider timing out after 15 minutes) will result in a
 *   gap in coverage until the retry succeeds. Current retry mechanism has built-in back-off rate and
 *   can be tweaked using `retryOptions`. This will be improved in the future.
 *
 * ```typescript
 * // Cron: fill at 1pm on weekdays
 * new ScheduledWarmRunner(stack, 'Business Hours', {
 *   runners,
 *   provider: myProvider,
 *   count: 3,
 *   owner: 'my-org',
 *   repo: 'my-repo',
 *   schedule: events.Schedule.cron({ hour: '13', minute: '0', weekDay: 'MON-FRI' }),
 *   duration: cdk.Duration.hours(2),
 * });
 * ```
 *
 * ```typescript
 * // Rate: fill every 12 hours
 * new ScheduledWarmRunner(stack, 'Every 12 Hours', {
 *   runners,
 *   provider: myProvider,
 *   count: 2,
 *   owner: 'my-org',
 *   repo: 'my-repo',
 *   schedule: events.Schedule.rate(cdk.Duration.hours(5)),
 *   duration: cdk.Duration.hours(12),
 * });
 * ```
 */
export declare class ScheduledWarmRunner extends Construct {
    /**
     * The fill payload for this warm runner configuration.
     * @internal
     */
    readonly _fillPayload: WarmRunnerFillPayload;
    constructor(scope: Construct, id: string, props: ScheduledWarmRunnerProps);
}
