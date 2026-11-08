import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_iam as iam, aws_logs as logs, aws_stepfunctions as stepfunctions } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseProvider, IParameterizedRunnerProvider, IRunnerProvider, IRunnerProviderStatus, RunnerConfig, RunnerProviderProps, StorageOptions } from './common';
import { IRunnerImageBuilder, RunnerImageBuilderProps } from '../image-builders';
/**
 * Properties for {@link Ec2RunnerProvider} construct.
 */
export interface Ec2RunnerProviderProps extends RunnerProviderProps {
    /**
     * Runner image builder used to build AMI containing GitHub Runner and all requirements.
     *
     * The image builder determines the OS and architecture of the runner.
     *
     * @default Ec2RunnerProvider.imageBuilder()
     */
    readonly imageBuilder?: IRunnerImageBuilder;
    /**
     * @deprecated use imageBuilder
     */
    readonly amiBuilder?: IRunnerImageBuilder;
    /**
     * GitHub Actions labels used for this provider.
     *
     * These labels are used to identify which provider should spawn a new on-demand runner. Every job sends a webhook with the labels it's looking for
     * based on runs-on. We match the labels from the webhook with the labels specified here. If all the labels specified here are present in the
     * job's labels, this provider will be chosen and spawn a new runner.
     *
     * @default ['ec2']
     */
    readonly labels?: string[];
    /**
     * GitHub Actions runner group name.
     *
     * If specified, the runner will be registered with this group name. Setting a runner group can help managing access to self-hosted runners. It
     * requires a paid GitHub account and organization level runner registration.
     *
     * The group must exist or the runner will not start.
     *
     * Users will still be able to trigger this runner with the correct labels. But the runner will only be able to run jobs from repos allowed to use the group.
     *
     * @default undefined
     */
    readonly group?: string;
    /**
     * Instance type for launched runner instances.
     *
     * For GPU instance types (g4dn, g5, p3, etc.), we automatically use a GPU base image (AWS Deep Learning AMI)
     * with NVIDIA drivers pre-installed. If you provide your own image builder, use
     * `baseAmi: BaseImage.fromGpuBase(os, architecture)` or another image preloaded with NVIDIA drivers, or use
     * an image component to install NVIDIA drivers.
     *
     * @default m6i.large
     */
    readonly instanceType?: ec2.InstanceType;
    /**
     * Size of volume available for launched runner instances. This modifies the boot volume size and doesn't add any additional volumes.
     *
     * @default 30GB
     */
    readonly storageSize?: cdk.Size;
    /**
     * Options for runner instance storage volume.
     */
    readonly storageOptions?: StorageOptions;
    /**
     * Security Group to assign to launched runner instances.
     *
     * @default a new security group
     *
     * @deprecated use {@link securityGroups}
     */
    readonly securityGroup?: ec2.ISecurityGroup;
    /**
     * Security groups to assign to launched runner instances.
     *
     * @default a new security group
     */
    readonly securityGroups?: ec2.ISecurityGroup[];
    /**
     * Subnet where the runner instances will be launched.
     *
     * @default default subnet of account's default VPC
     *
     * @deprecated use {@link vpc} and {@link subnetSelection}
     */
    readonly subnet?: ec2.ISubnet;
    /**
     * VPC where runner instances will be launched.
     *
     * @default default account VPC
     */
    readonly vpc?: ec2.IVpc;
    /**
     * Where to place the network interfaces within the VPC. Only the first matched subnet will be used.
     *
     * @default default VPC subnet
     */
    readonly subnetSelection?: ec2.SubnetSelection;
    /**
     * Use spot instances to save money. Spot instances are cheaper but not always available and can be stopped prematurely.
     *
     * @default false
     */
    readonly spot?: boolean;
    /**
     * Set a maximum price for spot instances.
     *
     * @default no max price (you will pay current spot price)
     */
    readonly spotMaxPrice?: string;
    /**
     * Maximum time the Step Functions task waits between heartbeats from the runner instance before it considers the
     * runner stuck and fails the task.
     *
     * Raise this if your instances can go longer than the default without a heartbeat, for example during long snapshot
     * deploys or heavy fixture setup.
     *
     * @default Duration.minutes(10)
     */
    readonly heartbeatTimeout?: cdk.Duration;
    /**
     * Additional tags to apply to launched runner instances and their volumes.
     *
     * These additional tags are set on top of `Name`, `GitHubRunners:Provider`, `GitHubRunners:Repo`, and `GitHubRunners:Labels`, and
     * `GitHubRunners:Runner`. You may only override `Name`. Tags prefixed `GitHubRunners:` are reserved and rejected. Some of our reserved tags are
     * used for house-keeping purposes.
     *
     * @default no additional tags
     */
    readonly tags?: {
        [key: string]: string;
    };
}
/**
 * Runner config for the Ec2 family fragment.
 *
 * @internal
 */
interface Ec2RunnerConfig extends RunnerConfig {
    readonly launchTemplateId: string;
    readonly instanceType: string;
    readonly securityGroupIds: string[];
    readonly instanceProfileArn: string;
    readonly logGroupName: string;
    readonly blockDeviceMappings: any[];
    readonly instanceMarketOptions: any;
    readonly userDataTemplateIdx: number;
    readonly subnet: string;
    readonly heartbeatSeconds: number;
}
/**
 * GitHub Actions runner provider using EC2 to execute jobs.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
export declare class Ec2RunnerProvider extends BaseProvider implements IRunnerProvider, IParameterizedRunnerProvider {
    /** @internal */
    static readonly _FAMILY = "ec2";
    /**
     * Big static strings the EC2 fragment reads from `$.config`. We always include both userdata templates because
     * the fragment puts both in a States.Array() and picks one by index at runtime.
     *
     * @internal
     */
    static _stateMachineConstants(): Record<string, string>;
    /**
     * The fragment that runs any EC2 provider. Reads the config {@link _runnerConfig} generated for it from
     * `$.providerParams`, and launches into whatever subnet is at `$.providerParams.subnet`.
     *
     * Multiple subnets are a chain of fallback configs instead of the chain of states we used to render, see
     * {@link Ec2RunnerProvider._runnerConfig}.
     *
     * @internal
     */
    static _stateMachineFragment(scope: Construct): stepfunctions.IChainable;
    /**
     * Create new image builder that builds EC2 specific runner images.
     *
     * You can customize the OS, architecture, VPC, subnet, security groups, etc. by passing in props.
     *
     * You can add components to the image builder by calling `imageBuilder.addComponent()`.
     *
     * The default OS is Ubuntu running on x64 architecture.
     *
     * Included components:
     *  * `RunnerImageComponent.requiredPackages()`
     *  * `RunnerImageComponent.cloudWatchAgent()`
     *  * `RunnerImageComponent.runnerUser()`
     *  * `RunnerImageComponent.git()`
     *  * `RunnerImageComponent.githubCli()`
     *  * `RunnerImageComponent.awsCli()`
     *  * `RunnerImageComponent.docker()`
     *  * `RunnerImageComponent.githubRunner()`
     */
    static imageBuilder(scope: Construct, id: string, props?: RunnerImageBuilderProps): import("../image-builders").IConfigurableRunnerImageBuilder;
    /**
     * Labels associated with this provider.
     */
    readonly labels: string[];
    /**
     * Grant principal used to add permissions to the runner role.
     */
    readonly grantPrincipal: iam.IPrincipal;
    /**
     * Log group where provided runners will save their logs.
     *
     * Note that this is not the job log, but the runner itself. It will not contain output from the GitHub Action but only metadata on its execution.
     */
    readonly logGroup: logs.ILogGroup;
    private readonly group?;
    private readonly amiBuilder;
    private readonly ami;
    private readonly role;
    private readonly instanceType;
    private readonly storageSize;
    private readonly storageOptions?;
    private readonly spot;
    private readonly spotMaxPrice;
    private readonly heartbeatTimeout;
    private readonly vpc;
    private readonly subnets;
    private readonly securityGroups;
    private readonly defaultLabels;
    private readonly tags;
    private readonly instanceProfile;
    private readonly rootDeviceResource;
    constructor(scope: Construct, id: string, props?: Ec2RunnerProviderProps);
    /**
     * @internal
     */
    _grantStateMachine(stateMachineRole: iam.IGrantable): void;
    /**
     * Config for the shared EC2 fragment.
     *
     * ec2:RunInstances can only try one subnet at a time, so every subnet gets a config that falls back to the next
     * one. Same chain we used to render as states.
     *
     * @internal
     */
    _runnerConfig(): Ec2RunnerConfig;
    /**
     * @internal
     */
    _status(statusFunctionRole: iam.IGrantable): IRunnerProviderStatus;
    /**
     * The network connections associated with this resource.
     */
    get connections(): ec2.Connections;
}
/**
 * @deprecated use {@link Ec2RunnerProvider}
 */
export declare class Ec2Runner extends Ec2RunnerProvider {
}
export {};
