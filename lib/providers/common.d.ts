import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_ecr as ecr, aws_iam as iam, aws_logs as logs, aws_stepfunctions as stepfunctions, Duration } from 'aws-cdk-lib';
import { EbsDeviceVolumeType } from 'aws-cdk-lib/aws-ec2';
import { Construct, IConstruct } from 'constructs';
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
     * A dependable string that can be waited on to ensure the image is ready.
     *
     * @internal
     */
    readonly _dependable?: string;
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
}
/**
 * Retry options for providers. The default is to retry 23 times for about 24 hours with increasing interval.
 */
export interface ProviderRetryOptions {
    /**
     * Set to true to retry provider on supported failures. Which failures generate a retry depends on the specific provider.
     *
     * @default true
     */
    readonly retry?: boolean;
    /**
     * How much time to wait after first retryable failure. This interval will be multiplied by {@link backoffRate} each retry.
     *
     * @default 1 minute
     */
    readonly interval?: Duration;
    /**
     * How many times to retry.
     *
     * @default 23
     */
    readonly maxAttempts?: number;
    /**
     * Multiplication for how much longer the wait interval gets on every retry.
     *
     * @default 1.3
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
 * Workflow job parameters as parsed from the webhook event. Pass these into your runner executor and run something like:
 *
 * ```sh
 * # JIT mode (preferred - cleaner registration, built-in ephemeral):
 * ./run.sh --jitconfig "${JIT_CONFIG}"
 *
 * # Legacy mode (fallback - two-step registration):
 * ./config.sh --unattended --url "{REGISTRATION_URL}" --token "${RUNNER_TOKEN}" --ephemeral --work _work --labels "${RUNNER_LABEL}" --name "${RUNNER_NAME}" --disableupdate
 * ```
 *
 * All parameters are specified as step function paths and therefore must be used only in step function task parameters.
 */
export interface RunnerRuntimeParameters {
    /**
     * Path to runner token used to register token.
     */
    readonly runnerTokenPath: string;
    /**
     * Path to desired runner name. We specifically set the name to make troubleshooting easier.
     */
    readonly runnerNamePath: string;
    /**
     * Path to GitHub domain. Most of the time this will be github.com but for self-hosted GitHub instances, this will be different.
     */
    readonly githubDomainPath: string;
    /**
     * Path to repository owner name.
     */
    readonly ownerPath: string;
    /**
     * Path to repository name.
     */
    readonly repoPath: string;
    /**
     * Repository or organization URL to register runner at.
     */
    readonly registrationUrl: string;
    /**
     * Path to comma-separated labels string to use for runner.
     */
    readonly labelsPath: string;
    /**
     * Path to JIT (just-in-time) runner configuration. When present, the runner should use
     * `run.sh --jitconfig` instead of `config.sh` + `run.sh`. JIT provides a simpler
     * registration flow and built-in ephemeral behavior. Note: JIT does not pin runners
     * to specific jobs — GitHub dispatches based on label matching.
     * Empty string when JIT is not available (falls back to legacy token flow).
     */
    readonly jitConfigPath: string;
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
 * Interface for all runner providers. Implementations create all required resources and return a step function task that starts those resources from {@link getStepFunctionTask}.
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
    /**
     * List of step functions errors that should be retried.
     *
     * @deprecated do not use
     */
    readonly retryableErrors: string[];
    /**
     * Generate step function tasks that execute the runner.
     *
     * Called by GithubRunners and shouldn't be called manually.
     *
     * @param parameters specific build parameters
     */
    getStepFunctionTask(parameters: RunnerRuntimeParameters): stepfunctions.IChainable;
    /**
     * An optional method that modifies the role of the state machine after all the tasks have been generated. This can be used to add additional policy
     * statements to the state machine role that are not automatically added by the task returned from {@link getStepFunctionTask}.
     *
     * @param stateMachineRole role for the state machine that executes the task returned from {@link getStepFunctionTask}.
     */
    grantStateMachine(stateMachineRole: iam.IGrantable): void;
    /**
     * Return status of the runner provider to be used in the main status function. Also gives the status function any needed permissions to query the Docker image or AMI.
     *
     * @param statusFunctionRole grantable for the status function
     */
    status(statusFunctionRole: iam.IGrantable): IRunnerProviderStatus;
}
/**
 * Interface for composite runner providers that interact with multiple sub-providers.
 * Unlike IRunnerProvider, composite providers do not have connections, grant capabilities,
 * log groups, or retryable errors as they delegate to their sub-providers.
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
    /**
     * Generate step function tasks that execute the runner.
     *
     * Called by GithubRunners and shouldn't be called manually.
     *
     * @param parameters specific build parameters
     */
    getStepFunctionTask(parameters: RunnerRuntimeParameters): stepfunctions.IChainable;
    /**
     * An optional method that modifies the role of the state machine after all the tasks have been generated. This can be used to add additional policy
     * statements to the state machine role that are not automatically added by the task returned from {@link getStepFunctionTask}.
     *
     * @param stateMachineRole role for the state machine that executes the task returned from {@link getStepFunctionTask}.
     */
    grantStateMachine(stateMachineRole: iam.IGrantable): void;
    /**
     * Return statuses of all sub-providers to be used in the main status function. Also gives the status function any needed permissions to query the Docker images or AMIs.
     *
     * @param statusFunctionRole grantable for the status function
     */
    status(statusFunctionRole: iam.IGrantable): IRunnerProviderStatus[];
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
export declare function amiRootDevice(scope: Construct, ami?: string): cdk.CustomResource;
/**
 * Creates a shortened state name from a construct's path for use in AWS Step Functions.
 * Step Functions state names are limited to 80 characters. This function generates a name
 * from the construct's path (without the stack name), optionally appends a suffix, and
 * shortens it if necessary by truncating and appending a hash suffix to ensure uniqueness.
 *
 * @param construct The construct to get the path from
 * @param suffix Optional suffix to append to the path (e.g., "data", "rand", "choice")
 * @returns A shortened state name that fits within AWS Step Functions' 80-character limit
 * @internal
 */
export declare function generateStateName(construct: Construct, suffix?: string): string;
