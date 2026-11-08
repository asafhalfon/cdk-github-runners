import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_ecr as ecr, aws_iam as iam, aws_logs as logs, Duration } from 'aws-cdk-lib';
import { EbsDeviceVolumeType } from 'aws-cdk-lib/aws-ec2';
import { Construct, IConstruct, IDependable } from 'constructs';
/**
 * Defines desired GitHub Actions runner version.
 */
export declare class RunnerVersion {
    readonly version: string;
    /**
     * Use the latest version available at the time the runner provider image is built.
     */
    static latest(): RunnerVersion;
    /**
     * Use a specific version.
     *
     * @see https://github.com/actions/runner/releases
     *
     * @param version GitHub Runner version
     */
    static specific(version: string): RunnerVersion;
    protected constructor(version: string);
    /**
     * Check if two versions are the same.
     *
     * @param other version to compare
     */
    is(other: RunnerVersion): boolean;
}
/**
 * CPU architecture enum for an image.
 */
export declare class Architecture {
    readonly name: string;
    /**
     * ARM64
     */
    static readonly ARM64: Architecture;
    /**
     * X86_64
     */
    static readonly X86_64: Architecture;
    private static of;
    private constructor();
    /**
    * Checks if the given architecture is the same as this one.
    *
    * @param arch architecture to compare
    */
    is(arch: Architecture): boolean;
    /**
     * Checks if this architecture is in a given list.
     *
     * @param arches architectures to check
     */
    isIn(arches: Architecture[]): boolean;
    /**
     * Checks if a given EC2 instance type matches this architecture.
     *
     * @param instanceType instance type to check
     */
    instanceTypeMatch(instanceType: ec2.InstanceType): boolean;
}
/**
 * OS enum for an image.
 */
export declare class Os {
    readonly name: string;
    /**
    * Linux
    *
    * @deprecated use {@link LINUX_UBUNTU}, {@link LINUX_UBUNTU_2404}, {@link LINUX_AMAZON_2} or {@link LINUX_AMAZON_2023}
    */
    static readonly LINUX: Os;
    /**
     * Ubuntu Linux
     */
    static readonly LINUX_UBUNTU: Os;
    /**
    * Ubuntu Linux 22.04
    */
    static readonly LINUX_UBUNTU_2204: Os;
    /**
     * Ubuntu Linux 24.04
     */
    static readonly LINUX_UBUNTU_2404: Os;
    /**
     * Amazon Linux 2
     */
    static readonly LINUX_AMAZON_2: Os;
    /**
     * Amazon Linux 2023
     */
    static readonly LINUX_AMAZON_2023: Os;
    /**
     * @internal
     */
    static readonly _ALL_LINUX_VERSIONS: Os[];
    /**
       * @internal
       */
    static readonly _ALL_LINUX_AMAZON_VERSIONS: Os[];
    /**
       * @internal
       */
    static readonly _ALL_LINUX_UBUNTU_VERSIONS: Os[];
    /**
    * Windows
    */
    static readonly WINDOWS: Os;
    private static of;
    private constructor();
    /**
    * Checks if the given OS is the same as this one.
    *
    * @param os OS to compare
    */
    is(os: Os): boolean;
    /**
     * Checks if this OS is in a given list.
     *
     * @param oses list of OS to check
     */
    isIn(oses: Os[]): boolean;
}
/**
 * Description of a Docker image built by {@link RunnerImageBuilder}.
 */
export interface RunnerImage {
    /**
     * ECR repository containing the image.
     */
    readonly imageRepository: ecr.IRepository;
    /**
     * Static image tag where the image will be pushed.
     */
    readonly imageTag: string;
    /**
     * Architecture of the image.
     */
    readonly architecture: Architecture;
    /**
     * OS type of the image.
     */
    readonly os: Os;
    /**
     * Log group where image builds are logged.
     */
    readonly logGroup?: logs.LogGroup;
    /**
     * Installed runner version.
     *
     * @deprecated open a ticket if you need this
     */
    readonly runnerVersion: RunnerVersion;
    /**
     * A dependable that can be waited on to ensure the image is ready.
     *
     * @internal
     */
    readonly _dependable?: IDependable;
}
/**
 * Description of a AMI built by {@link RunnerImageBuilder}.
 */
export interface RunnerAmi {
    /**
     * Launch template pointing to the latest AMI.
     */
    readonly launchTemplate: ec2.ILaunchTemplate;
    /**
     * Architecture of the image.
     */
    readonly architecture: Architecture;
    /**
     * OS type of the image.
     */
    readonly os: Os;
    /**
     * Log group where image builds are logged.
     */
    readonly logGroup?: logs.LogGroup;
    /**
     * Installed runner version.
     *
     * @deprecated open a ticket if you need this
     */
    readonly runnerVersion: RunnerVersion;
    /**
     * Set this to a value that changes whenever the AMI changes (the AMI id or any version string works).
     *
     * It's used to know when the AMI's root device name needs to be looked up again. If left empty, the root
     * device name is looked up once and reused. That's fine as long as the AMI's root device never changes.
     *
     * This value may be used for other things in the future that require knowing when the AMI changed.
     */
    readonly cacheKey?: string;
}
/**
 * Retry options for providers. The default is to retry 210 times for a bit over 24 hours with increasing interval.
 *
 * Retries use full jitter, so every wait is a random time between zero and the calculated interval. This spreads out
 * runners that all failed at the same time, so they don't hit the same missing capacity or API quota together again.
 * It also means the average wait is half the calculated interval, and that's what the 24 hours are calculated from.
 */
export interface ProviderRetryOptions {
    /**
     * Set to true to retry provider on supported failures. Which failures generate a retry depends on the specific provider.
     *
     * @default true
     */
    readonly retry?: boolean;
    /**
     * How much time to wait after first retryable failure. This interval will be multiplied by {@link backoffRate} each retry, up to {@link maxDelay}.
     *
     * @default 1 minute
     */
    readonly interval?: Duration;
    /**
     * Maximum wait between retries. Without it, exponential backoff quickly grows to hours between attempts, so a job
     * can end up waiting hours for a runner even though capacity came back minutes after it failed.
     *
     * Don't go too low either. A lower maximum needs more attempts to cover the same 24 hours, and every attempt adds
     * to the execution history that Step Functions caps at 25,000 events.
     *
     * @default 15 minutes
     */
    readonly maxDelay?: Duration;
    /**
     * How many times to retry.
     *
     * @default 210
     */
    readonly maxAttempts?: number;
    /**
     * Multiplication for how much longer the wait interval gets on every retry.
     *
     * @default 2
     */
    readonly backoffRate?: number;
}
/**
 * Common properties for all runner providers.
 */
export interface RunnerProviderProps {
    /**
     * The number of days log events are kept in CloudWatch Logs. When updating
     * this property, unsetting it doesn't remove the log retention policy. To
     * remove the retention policy, set the value to `INFINITE`.
     *
     * @default logs.RetentionDays.ONE_MONTH
     */
    readonly logRetention?: logs.RetentionDays;
    /**
     * @deprecated use {@link retryOptions} on {@link GitHubRunners} instead
     */
    readonly retryOptions?: ProviderRetryOptions;
    /**
     * Add default labels based on OS and architecture of the runner. This will tell GitHub Runner to add default labels like `self-hosted`, `linux`, `x64`, and `arm64`.
     *
     * @default true
     */
    readonly defaultLabels?: boolean;
}
/**
 * Image status returned from runner providers to be displayed in status.json.
 */
export interface IRunnerImageStatus {
    /**
     * Image repository where image builder pushes runner images.
     */
    readonly imageRepository: string;
    /**
     * Tag of image that should be used.
     */
    readonly imageTag: string;
    /**
     * Log group name for the image builder where history of image builds can be analyzed.
     */
    readonly imageBuilderLogGroup?: string;
}
/**
 * AMI status returned from runner providers to be displayed as output of status function.
 */
export interface IRunnerAmiStatus {
    /**
     * Id of launch template pointing to the latest AMI built by the AMI builder.
     */
    readonly launchTemplate: string;
    /**
     * Log group name for the AMI builder where history of builds can be analyzed.
     */
    readonly amiBuilderLogGroup?: string;
}
/**
 * Interface for runner image status used by status.json.
 */
export interface IRunnerProviderStatus {
    /**
     * Runner provider type.
     */
    readonly type: string;
    /**
     * Labels associated with provider.
     */
    readonly labels: string[];
    /**
     * CDK construct node path for this provider.
     */
    readonly constructPath?: string;
    /**
     * VPC where runners will be launched.
     */
    readonly vpcArn?: string;
    /**
     * Security groups attached to runners.
     */
    readonly securityGroups?: string[];
    /**
     * Role attached to runners.
     */
    readonly roleArn?: string;
    /**
     * Details about Docker image used by this runner provider.
     */
    readonly image?: IRunnerImageStatus;
    /**
     * Details about AMI used by this runner provider.
     */
    readonly ami?: IRunnerAmiStatus;
    /**
     * Log group for runners.
     */
    readonly logGroup?: string;
}
/**
 * Interface for all runner providers.
 *
 * This interface cannot be implemented by external code. If the built-in providers don't cover your use case, open an issue so we can discuss it.
 */
export interface IRunnerProvider extends ec2.IConnectable, iam.IGrantable, IConstruct {
    /**
     * GitHub Actions labels used for this provider.
     *
     * These labels are used to identify which provider should spawn a new on-demand runner. Every job sends a webhook with the labels it's looking for
     * based on runs-on. We use match the labels from the webhook with the labels specified here. If all the labels specified here are present in the
     * job's labels, this provider will be chosen and spawn a new runner.
     */
    readonly labels: string[];
    /**
     * Log group where provided runners will save their logs.
     *
     * Note that this is not the job log, but the runner itself. It will not contain output from the GitHub Action but only metadata on its execution.
     */
    readonly logGroup: logs.ILogGroup;
}
/**
 * Contract between GitHubRunners and its providers, both normal and composite. It's hidden from the public API
 * because the state machine has one shared fragment per provider family, and we only implement the families in
 * this library.
 *
 * @internal
 */
export interface IParameterizedRunnerProvider extends IConstruct {
    /**
     * GitHub Actions labels used for this provider.
     */
    readonly labels: string[];
    /**
     * Runtime configuration for this provider. We embed it in the state machine definition and the family fragments
     * read it from `$.providerParams`. Must be JSON-serializable, but can contain CloudFormation tokens.
     *
     * A config can chain another one at `fallback` to try when it fails, or hold a `distribute` list of weighted
     * configs to pick from.
     */
    _runnerConfig(): AnyRunnerConfig;
    /**
     * Grant the state machine role whatever the family fragment needs to run this particular provider.
     */
    _grantStateMachine(stateMachineRole: iam.IGrantable): void;
    /**
     * Return status of the runner provider to be used in the main status function. Also gives the status function any
     * needed permissions to query the Docker image or AMI. Composite providers return one status per sub-provider.
     */
    _status(statusFunctionRole: iam.IGrantable): IRunnerProviderStatus | IRunnerProviderStatus[];
}
/**
 * Check whether a provider implements the internal contract.
 *
 * instanceof doesn't really work in CDK so duck-type instead.
 *
 * @internal
 */
export declare function isParameterizedRunnerProvider(provider: IConstruct): provider is IParameterizedRunnerProvider;
/**
 * Reference paths to the runner values the execution input carries. Written once here so a rename can't quietly
 * miss a fragment.
 *
 * @internal
 */
export declare const RUNNER_INPUT: {
    readonly jitConfig: "$.runner.jitConfig";
    readonly name: "$$.Execution.Name";
    readonly labels: "$.labels";
    readonly domain: "$.runner.domain";
    readonly owner: "$.owner";
    readonly repo: "$.repo";
};
/**
 * Reference path to a field of a provider's runner config. Typed on the family's config so renaming a field breaks every fragment that reads it.
 *
 * @internal
 */
export declare function providerParam<C>(key: keyof C & string): string;
/**
 * Fields every runner config carries.
 *
 * @internal
 */
export interface RunnerConfig {
    /** family whose fragment runs this config */
    readonly family: string;
    /** config to try when this one fails */
    readonly fallback?: RunnerConfig;
    /** provider that actually runs the job, for tagging, when it isn't `$.provider` */
    readonly provider: string;
    /** runner group this config registers with, or an empty string */
    readonly runnerGroup: string;
    /** labels config.sh would have added on its own, or nothing when the provider turned them off. see {@link runnerDefaultLabels} */
    readonly defaultLabels: string[];
    /** tags the provider sets on whatever it creates, before the standard runner tags get merged in */
    readonly tags?: {
        readonly Key: string;
        readonly Value: string;
    }[];
    /** ECS won't take the labels as they come in -- no commas, no parenthesis -- so its configs ask for a cleaned up labels tag */
    readonly cleanLabels?: boolean;
}
/**
 * A config that picks one of several weighted configs at runtime. Composite distribution providers return this
 * instead of a runner config of their own.
 *
 * @internal
 */
export interface DistributedRunnerConfig {
    /** sum of every weight, so a random number in [0, totalWeight) can be compared against the thresholds */
    readonly totalWeight: number;
    /** running weight sums, paired with the config to use below each one */
    readonly distribute: {
        readonly threshold: number;
        readonly config: AnyRunnerConfig;
    }[];
}
/**
 * Either kind of config the state machine can select.
 *
 * @internal
 */
export type AnyRunnerConfig = RunnerConfig | DistributedRunnerConfig;
/**
 * Environment variables we pass to the runner. `format` renders one, so
 * each family can use whatever shape its API wants.
 *
 * @internal
 */
export declare function runnerEnvironment(format: (name: string, value: string) => any): any[];
/**
 * Labels config.sh adds on its own unless it gets `--no-default-labels`. JIT runners don't run config.sh, and whoever creates the JIT config
 * doesn't know the OS or architecture, so we have to pass them.
 *
 * @internal
 */
export declare function runnerDefaultLabels(os: Os, architecture: Architecture, enabled: boolean): string[];
/**
 * Interface for composite runner providers that combine multiple sub-providers.
 * Unlike IRunnerProvider, composite providers do not have connections, grant capabilities,
 * or log groups as they delegate to their sub-providers.
 *
 * Note that this interface cannot be implemented by external code. Use {@link CompositeProvider} factory methods.
 */
export interface ICompositeProvider extends IConstruct {
    /**
     * GitHub Actions labels used for this provider.
     *
     * These labels are used to identify which provider should spawn a new on-demand runner. Every job sends a webhook with the labels it's looking for
     * based on runs-on. We use match the labels from the webhook with the labels specified here. If all the labels specified here are present in the
     * job's labels, this provider will be chosen and spawn a new runner.
     */
    readonly labels: string[];
    /**
     * All sub-providers contained in this composite provider.
     * This is used to extract providers for metric filters and other operations.
     */
    readonly providers: IRunnerProvider[];
}
/**
 * Storage options for the runner instance.
 */
export interface StorageOptions {
    /**
     * The EBS volume type
     * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSVolumeTypes.html
     *
     * @default `EbsDeviceVolumeType.GP2`
     */
    readonly volumeType?: EbsDeviceVolumeType;
    /**
     * The number of I/O operations per second (IOPS) to provision for the volume.
     *
     * Must only be set for `volumeType`: `EbsDeviceVolumeType.IO1`
     *
     * The maximum ratio of IOPS to volume size (in GiB) is 50:1, so for 5,000 provisioned IOPS,
     * you need at least 100 GiB storage on the volume.
     *
     * @see https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/EBSVolumeTypes.html
     *
     * @default - none, required for `EbsDeviceVolumeType.IO1`
     */
    readonly iops?: number;
    /**
     * The throughput that the volume supports, in MiB/s
     * Takes a minimum of 125 and maximum of 1000.
     * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ec2-volume.html#cfn-ec2-volume-throughput
     * @default - 125 MiB/s. Only valid on gp3 volumes.
     */
    readonly throughput?: number;
}
/**
 * Base class for all providers with common methods used by all providers.
 *
 * @internal
 */
export declare abstract class BaseProvider extends Construct {
    protected constructor(scope: Construct, id: string, _props?: RunnerProviderProps);
    protected labelsFromProperties(defaultLabel: string, propsLabel: string | undefined, propsLabels: string[] | undefined): string[];
}
/**
 * Use custom resource to determine the root device name of a given AMI, Launch Template, or SSM parameter pointing to AMI.
 *
 * TODO move somewhere more common as it's used by both providers and AMI builder now
 *
 * @internal
 */
export declare function amiRootDevice(scope: Construct, ami?: string, cacheKey?: string): cdk.CustomResource;
