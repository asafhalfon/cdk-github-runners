import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_ecs as ecs, aws_iam as iam, aws_logs as logs, aws_stepfunctions as stepfunctions } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseProvider, IRunnerProvider, IRunnerProviderStatus, RunnerProviderProps, StorageOptions, RunnerConfig } from './common';
import { IRunnerImageBuilder, RunnerImageBuilderProps } from '../image-builders';
/**
 * Properties for EcsRunnerProvider.
 */
export interface EcsRunnerProviderProps extends RunnerProviderProps {
    /**
     * Runner image builder used to build Docker images containing GitHub Runner and all requirements.
     *
     * The image builder determines the OS and architecture of the runner.
     *
     * @default EcsRunnerProvider.imageBuilder()
     */
    readonly imageBuilder?: IRunnerImageBuilder;
    /**
     * GitHub Actions labels used for this provider.
     *
     * These labels are used to identify which provider should spawn a new on-demand runner. Every job sends a webhook with the labels it's looking for
     * based on runs-on. We match the labels from the webhook with the labels specified here. If all the labels specified here are present in the
     * job's labels, this provider will be chosen and spawn a new runner.
     *
     * @default ['ecs']
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
     * VPC to launch the runners in.
     *
     * @default default account VPC
     */
    readonly vpc?: ec2.IVpc;
    /**
     * Subnets to run the runners in.
     *
     * @default ECS default
     */
    readonly subnetSelection?: ec2.SubnetSelection;
    /**
     * Security groups to assign to the task.
     *
     * @default a new security group
     */
    readonly securityGroups?: ec2.ISecurityGroup[];
    /**
     * Existing ECS cluster to use.
     *
     * Jobs from all providers using the same cluster can share instances. Only share a cluster between providers whose jobs are equally trusted.
     *
     * @see https://github.com/CloudSnorkel/cdk-github-runners#job-isolation
     *
     * @default a new cluster
     */
    readonly cluster?: ecs.Cluster;
    /**
     * Existing capacity provider to use.
     *
     * Make sure the AMI used by the capacity provider is compatible with ECS.
     *
     * Runner containers use bridge networking and share the instance with other jobs. Its launch template must require IMDSv2 and set the
     * metadata hop limit to 1 (`requireImdsv2: true` and `httpPutResponseHopLimit: 1`), or jobs can take the instance role. A warning is
     * added when we can't confirm both.
     *
     * @default new capacity provider
     */
    readonly capacityProvider?: ecs.AsgCapacityProvider;
    /**
     * Assign public IP to the runner task.
     *
     * @deprecated ECS runner tasks use bridge networking, so they share the host instance's network interface and
     * cannot get a public IP of their own. This property is ignored. Give the cluster instances internet access
     * instead (a public subnet or a NAT gateway), and open an issue if you need `awsvpc` networking for ECS.
     *
     * @default - ignored
     */
    readonly assignPublicIp?: boolean;
    /**
     * The number of cpu units used by the task. 1024 units is 1 vCPU. Fractions of a vCPU are supported.
     *
     * @default 1024
     */
    readonly cpu?: number;
    /**
     * The amount (in MiB) of memory used by the task.
     *
     * @default 3500, unless `memoryReservationMiB` is used and then it's undefined
     */
    readonly memoryLimitMiB?: number;
    /**
     * The soft limit (in MiB) of memory to reserve for the container.
     *
     * @default undefined
     */
    readonly memoryReservationMiB?: number;
    /**
     * Instance type of ECS cluster instances. Only used when creating a new cluster.
     *
     * @default m6i.large or m6g.large
     */
    readonly instanceType?: ec2.InstanceType;
    /**
     * The minimum number of instances to run in the cluster. Only used when creating a new cluster.
     *
     * @default 0
     */
    readonly minInstances?: number;
    /**
     * The maximum number of instances to run in the cluster. Only used when creating a new cluster.
     *
     * @default 5
     */
    readonly maxInstances?: number;
    /**
     * Size of volume available for launched cluster instances. This modifies the boot volume size and doesn't add any additional volumes.
     *
     * Each instance can be used by multiple runners, so make sure there is enough space for all of them.
     *
     * @default default size for AMI (usually 30GB for Linux and 50GB for Windows)
     */
    readonly storageSize?: cdk.Size;
    /**
     * Options for runner instance storage volume.
     */
    readonly storageOptions?: StorageOptions;
    /**
     * Support building and running Docker images by enabling Docker-in-Docker (dind) and the required privileged mode for the runner container.
     *
     * A job running in a privileged container can take over the instance, access other jobs running on it, and affect jobs that run on it
     * later. All jobs that can run on the same cluster should be equally trusted. Disable this if your jobs don't need Docker.
     *
     * Disabling Docker-in-Docker can also speed up runner provisioning as the runner doesn't have to wait for Docker to boot.
     *
     * @see https://github.com/CloudSnorkel/cdk-github-runners#job-isolation
     *
     * @default true
     */
    readonly dockerInDocker?: boolean;
    /**
     * Use spot capacity.
     *
     * @default false (true if spotMaxPrice is specified)
     */
    readonly spot?: boolean;
    /**
     * Maximum price for spot instances.
     */
    readonly spotMaxPrice?: string;
    /**
     * ECS placement strategies to influence task placement.
     *
     * Example: [ecs.PlacementStrategy.packedByCpu()]
     *
     * @default undefined (no placement strategies)
     */
    readonly placementStrategies?: ecs.PlacementStrategy[];
    /**
     * ECS placement constraints to influence task placement.
     *
     * Example: [ecs.PlacementConstraint.memberOf('ecs-placement')]
     *
     * @default undefined (no placement constraints)
     */
    readonly placementConstraints?: ecs.PlacementConstraint[];
    /**
     * Number of GPUs to request for the runner task. When set, the task will be scheduled on GPU-capable instances.
     *
     * Requires a GPU-capable instance type (e.g., g4dn.xlarge for 1 GPU, g4dn.12xlarge for 4 GPUs) and GPU AMI.
     * When creating a new cluster, instanceType defaults to g4dn.xlarge and the ECS Optimized GPU AMI is used.
     *
     * You must ensure that the task's container image includes the CUDA runtime. Provide a CUDA-enabled base image
     * via `baseDockerImage`, use an image builder that starts from a GPU-capable image (such as nvidia/cuda), or add
     * an image component that installs the CUDA runtime into the image.
     *
     * @default undefined (no GPU)
     */
    readonly gpu?: number;
    /**
     * Additional tags to apply to launched runner tasks.
     *
     * These additional tags are set on top of `Name`, `GitHubRunners:Provider`, `GitHubRunners:Repo`, and `GitHubRunners:Labels`.
     * You may not override tags with the `GitHubRunners:` prefix.
     *
     * @default no additional tags
     */
    readonly tags?: {
        [key: string]: string;
    };
}
/**
 * Runner config for the Ecs family fragment.
 *
 * @internal
 */
interface EcsRunnerConfig extends RunnerConfig {
    readonly clusterArn: string;
    readonly taskDefinitionFamily: string;
    readonly containerName: string;
    readonly capacityProviderName: string;
    readonly enableExecuteCommand: boolean;
    readonly placementStrategies: any[];
    readonly placementConstraints: any[];
}
/**
 * GitHub Actions runner provider using ECS on EC2 to execute jobs.
 *
 * ECS can be useful when you want more control of the infrastructure running the GitHub Actions Docker containers. You can control the autoscaling
 * group to scale down to zero during the night and scale up during work hours. This way you can still save money, but have to wait less for
 * infrastructure to spin up.
 *
 * Jobs share instances, and by default run in privileged containers on Linux that can take over the instance. All jobs that can run on the same
 * cluster should be equally trusted. See https://github.com/CloudSnorkel/cdk-github-runners#job-isolation
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
export declare class EcsRunnerProvider extends BaseProvider implements IRunnerProvider {
    /** @internal */
    static readonly _FAMILY = "ecs";
    /**
     * The fragment that runs any ECS provider. Reads the config {@link _runnerConfig} generated for it from
     * `$.providerParams`. Renders what EcsRunTask used to render per provider, minus NetworkConfiguration because
     * ECS task definitions use bridge networking.
     *
     * @internal
     */
    static _stateMachineFragment(scope: Construct): stepfunctions.IChainable;
    /**
     * Create new image builder that builds ECS specific runner images.
     *
     * You can customize the OS, architecture, VPC, subnet, security groups, etc. by passing in props.
     *
     * You can add components to the image builder by calling `imageBuilder.addComponent()`.
     *
     * The default OS is Ubuntu running on x64 architecture.
     *
     * Included components:
     *  * `RunnerImageComponent.requiredPackages()`
     *  * `RunnerImageComponent.runnerUser()`
     *  * `RunnerImageComponent.git()`
     *  * `RunnerImageComponent.githubCli()`
     *  * `RunnerImageComponent.awsCli()`
     *  * `RunnerImageComponent.docker()`
     *  * `RunnerImageComponent.githubRunner()`
     */
    static imageBuilder(scope: Construct, id: string, props?: RunnerImageBuilderProps): import("../image-builders").IConfigurableRunnerImageBuilder;
    /**
     * Cluster hosting the task hosting the runner.
     */
    private readonly cluster;
    /**
     * Capacity provider used to scale the cluster.
     *
     * Use capacityProvider.autoScalingGroup to access the auto scaling group. This can help set up custom scaling policies.
     */
    readonly capacityProvider: ecs.AsgCapacityProvider;
    /**
     * ECS task hosting the runner.
     */
    private readonly task;
    /**
     * Container definition hosting the runner.
     */
    private readonly container;
    /**
     * Labels associated with this provider.
     */
    readonly labels: string[];
    /**
     * VPC used for hosting the runner task.
     */
    private readonly vpc?;
    /**
     * Subnets used for hosting the runner task.
     */
    private readonly subnetSelection?;
    /**
     * Grant principal used to add permissions to the runner role.
     */
    readonly grantPrincipal: iam.IPrincipal;
    /**
     * The network connections associated with this resource.
     */
    readonly connections: ec2.Connections;
    /**
     * Docker image loaded with GitHub Actions Runner and its prerequisites. The image is built by an image builder and is specific to ECS tasks.
     */
    private readonly image;
    /**
     * Log group where provided runners will save their logs.
     *
     * Note that this is not the job log, but the runner itself. It will not contain output from the GitHub Action but only metadata on its execution.
     */
    readonly logGroup: logs.ILogGroup;
    /**
     * Security groups associated with this provider.
     */
    private readonly securityGroups;
    /**
     * Run docker in docker.
     */
    private readonly dind;
    /**
     * Runner group name.
     */
    private readonly group?;
    /**
     * Include default labels (arch, os, self-hosted) for runner.
     */
    private readonly defaultLabels;
    /**
     * ECS placement strategies to influence task placement.
     */
    private readonly placementStrategies?;
    /**
     * ECS placement constraints to influence task placement.
     */
    private readonly placementConstraints?;
    /**
     * Number of GPUs requested for the runner task (0 = no GPU).
     */
    private readonly gpuCount;
    /**
     * Tags set on launched runner tasks.
     */
    private readonly tags;
    constructor(scope: Construct, id: string, props?: EcsRunnerProviderProps);
    private defaultClusterInstanceType;
    /**
     * Warn when we can't confirm the custom capacity provider keeps containers away from IMDS. Only launch templates and launch configurations
     * created in this app can be checked.
     */
    private warnOnContainerImdsAccess;
    private defaultClusterInstanceAmi;
    private pullCommand;
    private loginCommands;
    private ecsSettingsCommands;
    /**
     * Config for the shared ECS fragment.
     *
     * @internal
     */
    _runnerConfig(): EcsRunnerConfig;
    /**
     * @internal
     */
    _grantStateMachine(stateMachineRole: iam.IGrantable): void;
    /**
     * @internal
     */
    _status(statusFunctionRole: iam.IGrantable): IRunnerProviderStatus;
}
export {};
