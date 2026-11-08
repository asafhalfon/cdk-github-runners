"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcsRunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const autoscaling = __importStar(require("aws-cdk-lib/aws-autoscaling"));
const aws_ecs_1 = require("aws-cdk-lib/aws-ecs");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const common_1 = require("./common");
const fargate_1 = require("./fargate");
const image_builders_1 = require("../image-builders");
const utils_1 = require("../utils");
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
class EcsRunnerProvider extends common_1.BaseProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.EcsRunnerProvider", version: "0.0.0" };
    /** @internal */
    static _FAMILY = 'ecs';
    /**
     * The fragment that runs any ECS provider. Reads the config {@link _runnerConfig} generated for it from
     * `$.providerParams`. Renders what EcsRunTask used to render per provider, minus NetworkConfiguration because
     * ECS task definitions use bridge networking.
     *
     * @internal
     */
    static _stateMachineFragment(scope) {
        const p = (common_1.providerParam);
        return new aws_cdk_lib_1.aws_stepfunctions.CustomState(scope, 'ECS Runner', {
            stateJson: {
                Type: 'Task',
                Resource: `arn:${cdk.Aws.PARTITION}:states:::ecs:runTask.sync`,
                Parameters: {
                    'Cluster.$': p('clusterArn'),
                    'TaskDefinition.$': p('taskDefinitionFamily'),
                    'Overrides': {
                        ContainerOverrides: [{
                                'Name.$': p('containerName'),
                                'Environment': (0, common_1.runnerEnvironment)((name, value) => ({ 'Name': name, 'Value.$': value })),
                            }],
                    },
                    'PropagateTags': 'TASK_DEFINITION',
                    'Tags.$': p('tags'), // the provider's tags, already merged with the standard runner tags by the orchestrator
                    'CapacityProviderStrategy': [{
                            'CapacityProvider.$': p('capacityProviderName'),
                        }],
                    // ready-made arrays in the shape ecs:runTask wants, empty when nothing is configured
                    'PlacementConstraints.$': p('placementConstraints'),
                    'PlacementStrategy.$': p('placementStrategies'),
                    'EnableExecuteCommand.$': p('enableExecuteCommand'),
                },
            },
        });
    }
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
    static imageBuilder(scope, id, props) {
        return image_builders_1.RunnerImageBuilder.new(scope, id, {
            os: common_1.Os.LINUX_UBUNTU,
            architecture: common_1.Architecture.X86_64,
            components: [
                image_builders_1.RunnerImageComponent.requiredPackages(),
                image_builders_1.RunnerImageComponent.runnerUser(),
                image_builders_1.RunnerImageComponent.git(),
                image_builders_1.RunnerImageComponent.githubCli(),
                image_builders_1.RunnerImageComponent.awsCli(),
                image_builders_1.RunnerImageComponent.docker(),
                image_builders_1.RunnerImageComponent.githubRunner(props?.runnerVersion ?? common_1.RunnerVersion.latest()),
            ],
            ...props,
        });
    }
    /**
     * Cluster hosting the task hosting the runner.
     */
    cluster;
    /**
     * Capacity provider used to scale the cluster.
     *
     * Use capacityProvider.autoScalingGroup to access the auto scaling group. This can help set up custom scaling policies.
     */
    capacityProvider;
    /**
     * ECS task hosting the runner.
     */
    task;
    /**
     * Container definition hosting the runner.
     */
    container;
    /**
     * Labels associated with this provider.
     */
    labels;
    /**
     * VPC used for hosting the runner task.
     */
    vpc;
    /**
     * Subnets used for hosting the runner task.
     */
    subnetSelection;
    /**
     * Grant principal used to add permissions to the runner role.
     */
    grantPrincipal;
    /**
     * The network connections associated with this resource.
     */
    connections;
    /**
     * Docker image loaded with GitHub Actions Runner and its prerequisites. The image is built by an image builder and is specific to ECS tasks.
     */
    image;
    /**
     * Log group where provided runners will save their logs.
     *
     * Note that this is not the job log, but the runner itself. It will not contain output from the GitHub Action but only metadata on its execution.
     */
    logGroup;
    /**
     * Security groups associated with this provider.
     */
    securityGroups;
    /**
     * Run docker in docker.
     */
    dind;
    /**
     * Runner group name.
     */
    group;
    /**
     * Include default labels (arch, os, self-hosted) for runner.
     */
    defaultLabels;
    /**
     * ECS placement strategies to influence task placement.
     */
    placementStrategies;
    /**
     * ECS placement constraints to influence task placement.
     */
    placementConstraints;
    /**
     * Number of GPUs requested for the runner task (0 = no GPU).
     */
    gpuCount;
    /**
     * Tags set on launched runner tasks.
     */
    tags;
    constructor(scope, id, props) {
        super(scope, id, props);
        this.labels = props?.labels ?? ['ecs'];
        this.group = props?.group;
        this.defaultLabels = props?.defaultLabels ?? true;
        this.vpc = props?.vpc ?? aws_cdk_lib_1.aws_ec2.Vpc.fromLookup(this, 'default vpc', { isDefault: true });
        this.subnetSelection = props?.subnetSelection;
        this.securityGroups = props?.securityGroups ?? [new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, 'security group', { vpc: this.vpc })];
        this.connections = new aws_cdk_lib_1.aws_ec2.Connections({ securityGroups: this.securityGroups });
        this.placementStrategies = props?.placementStrategies;
        this.placementConstraints = props?.placementConstraints;
        this.gpuCount = props?.gpu ?? 0;
        this.tags = (0, fargate_1.ecsTags)(this, props?.tags ?? {});
        this.cluster = props?.cluster ? props.cluster : new aws_cdk_lib_1.aws_ecs.Cluster(this, 'cluster', {
            vpc: this.vpc,
            enableFargateCapacityProviders: false,
        });
        // all providers add this tag, but ECS/Fargate tags need to be cleaned
        cdk.Tags.of(this).add('GitHubRunners:Provider', (0, fargate_1.cleanEcsTag)(this, 'provider tag', this.node.path));
        if (props?.storageOptions && !props?.storageSize) {
            cdk.Annotations.of(this).addError('storageSize is required when storageOptions are specified');
        }
        const defaultImageBuilderArchitecture = !props?.capacityProvider && props?.instanceType?.architecture === aws_cdk_lib_1.aws_ec2.InstanceArchitecture.ARM_64
            ? common_1.Architecture.ARM64
            : common_1.Architecture.X86_64;
        const imageBuilder = props?.imageBuilder ?? EcsRunnerProvider.imageBuilder(this, 'Image Builder', {
            architecture: defaultImageBuilderArchitecture,
        });
        const image = this.image = imageBuilder.bindDockerImage();
        if (props?.capacityProvider) {
            if (props?.minInstances || props?.maxInstances || props?.instanceType || props?.storageSize || props?.spot || props?.spotMaxPrice) {
                cdk.Annotations.of(this).addWarning('When using a custom capacity provider, minInstances, maxInstances, instanceType, storageSize, spot, and spotMaxPrice will be ignored.');
            }
            this.capacityProvider = props.capacityProvider;
            this.warnOnContainerImdsAccess();
        }
        else {
            const spot = props?.spot ?? props?.spotMaxPrice !== undefined;
            const launchTemplate = new aws_cdk_lib_1.aws_ec2.LaunchTemplate(this, 'Launch Template', {
                machineImage: this.defaultClusterInstanceAmi(),
                instanceType: props?.instanceType ?? this.defaultClusterInstanceType(),
                blockDevices: (props?.storageSize || props?.storageOptions) ? [
                    {
                        deviceName: (0, common_1.amiRootDevice)(this, this.defaultClusterInstanceAmi().getImage(this).imageId).ref,
                        volume: {
                            ebsDevice: {
                                deleteOnTermination: true,
                                volumeSize: props?.storageSize?.toGibibytes() ?? 30,
                                volumeType: props?.storageOptions?.volumeType,
                                iops: props?.storageOptions?.iops,
                                throughput: props?.storageOptions?.throughput,
                            },
                        },
                    },
                ] : undefined,
                spotOptions: spot ? {
                    requestType: aws_cdk_lib_1.aws_ec2.SpotRequestType.ONE_TIME,
                    maxPrice: props?.spotMaxPrice ? parseFloat(props?.spotMaxPrice) : undefined,
                } : undefined,
                requireImdsv2: true,
                // containers on the bridge network are one hop away, so this keeps jobs from reaching IMDS and taking the instance role.
                // tasks get their own role from the ECS agent endpoint, which this doesn't affect. some AMIs, like AL2023, default to 2.
                httpPutResponseHopLimit: 1,
                securityGroup: this.securityGroups[0],
                role: new aws_cdk_lib_1.aws_iam.Role(this, 'Launch Template Role', {
                    assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('ec2.amazonaws.com'),
                }),
                userData: aws_cdk_lib_1.aws_ec2.UserData.forOperatingSystem(image.os.is(common_1.Os.WINDOWS) ? aws_cdk_lib_1.aws_ec2.OperatingSystemType.WINDOWS : aws_cdk_lib_1.aws_ec2.OperatingSystemType.LINUX),
            });
            this.securityGroups.slice(1).map(sg => launchTemplate.connections.addSecurityGroup(sg));
            const autoScalingGroup = new autoscaling.AutoScalingGroup(this, 'Auto Scaling Group', {
                vpc: this.vpc,
                launchTemplate,
                vpcSubnets: this.subnetSelection,
                minCapacity: props?.minInstances ?? 0,
                maxCapacity: props?.maxInstances ?? 5,
            });
            this.capacityProvider = props?.capacityProvider ?? new aws_cdk_lib_1.aws_ecs.AsgCapacityProvider(this, 'Capacity Provider', {
                autoScalingGroup,
                spotInstanceDraining: false, // waste of money to restart jobs as the restarted job won't have a token
            });
        }
        this.capacityProvider.autoScalingGroup.addUserData(
        // we don't exit on errors because all of these commands are optional
        ...this.loginCommands(), this.pullCommand(), ...this.ecsSettingsCommands());
        this.capacityProvider.autoScalingGroup.role.addToPrincipalPolicy(utils_1.MINIMAL_EC2_SSM_SESSION_MANAGER_POLICY_STATEMENT);
        image.imageRepository.grantPull(this.capacityProvider.autoScalingGroup);
        this.cluster.addAsgCapacityProvider(this.capacityProvider, {
            spotInstanceDraining: false,
            machineImageType: aws_ecs_1.MachineImageType.AMAZON_LINUX_2,
        });
        this.logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'logs', {
            retention: props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        this.dind = (props?.dockerInDocker ?? true) && !image.os.is(common_1.Os.WINDOWS);
        this.task = new aws_cdk_lib_1.aws_ecs.Ec2TaskDefinition(this, 'task');
        this.container = this.task.addContainer('runner', {
            image: aws_cdk_lib_1.aws_ecs.AssetImage.fromEcrRepository(image.imageRepository, image.imageTag),
            cpu: props?.cpu ?? 1024,
            memoryLimitMiB: props?.memoryLimitMiB ?? (props?.memoryReservationMiB ? undefined : 3500),
            memoryReservationMiB: props?.memoryReservationMiB,
            gpuCount: this.gpuCount > 0 ? this.gpuCount : undefined,
            logging: aws_cdk_lib_1.aws_ecs.AwsLogDriver.awsLogs({
                logGroup: this.logGroup,
                streamPrefix: 'runner',
            }),
            command: (0, fargate_1.ecsRunCommand)(this.image.os, this.dind),
            user: image.os.is(common_1.Os.WINDOWS) ? undefined : 'runner',
            privileged: this.dind,
        });
        this.grantPrincipal = this.task.taskRole;
        // permissions for SSM Session Manager
        this.task.taskRole.addToPrincipalPolicy(utils_1.MINIMAL_ECS_SSM_SESSION_MANAGER_POLICY_STATEMENT);
        if (props?.assignPublicIp) {
            cdk.Annotations.of(this).addWarning('assignPublicIp is set to `true`, but ECS tasks on EC2 run using bridge mode. In bridge mode, the task ' +
                'uses the host instance\'s network interface and IP address. The task will not have its own public IP address. Ensure that the host ' +
                'instances have internet access (e.g., through a NAT gateway) if the tasks need to access external resources. Please open a GitHub issue ' +
                'if you need VPC networking mode for ECS.');
        }
    }
    defaultClusterInstanceType() {
        if (this.gpuCount > 0) {
            if (!this.image.architecture.is(common_1.Architecture.X86_64)) {
                throw new Error('ECS GPU is only supported for x64 architecture. GPU instances (g4dn, g5, p3, etc.) are x64 only.');
            }
            if (this.gpuCount <= 1) {
                return aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.G4DN, aws_cdk_lib_1.aws_ec2.InstanceSize.XLARGE);
            }
            if (this.gpuCount <= 4) {
                return aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.G4DN, aws_cdk_lib_1.aws_ec2.InstanceSize.XLARGE12);
            }
            if (this.gpuCount <= 8) {
                return aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.P3, aws_cdk_lib_1.aws_ec2.InstanceSize.XLARGE16);
            }
            throw new Error(`Unsupported GPU count: ${this.gpuCount}`);
        }
        if (this.image.architecture.is(common_1.Architecture.X86_64)) {
            return aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.M6I, aws_cdk_lib_1.aws_ec2.InstanceSize.LARGE);
        }
        if (this.image.architecture.is(common_1.Architecture.ARM64)) {
            return aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.M6G, aws_cdk_lib_1.aws_ec2.InstanceSize.LARGE);
        }
        throw new Error(`Unable to find instance type for ECS instances for ${this.image.architecture.name}`);
    }
    /**
     * Warn when we can't confirm the custom capacity provider keeps containers away from IMDS. Only launch templates and launch configurations
     * created in this app can be checked.
     */
    warnOnContainerImdsAccess() {
        // the cfn properties can also be IResolvable, but the L2 constructs always set plain objects. anything else can't be confirmed and warns.
        const cfnAsg = this.capacityProvider.autoScalingGroup.node.defaultChild;
        const target = (id) => {
            const token = typeof id === 'string' ? cdk.Tokenization.reverseString(id).firstToken : undefined;
            return token instanceof cdk.Reference ? token.target : undefined;
        };
        const launchTemplateSpec = cfnAsg.launchTemplate ?? cfnAsg.mixedInstancesPolicy?.launchTemplate?.launchTemplateSpecification;
        const launchTemplate = target(launchTemplateSpec?.launchTemplateId ?? launchTemplateSpec?.launchTemplateName);
        const launchConfiguration = target(cfnAsg.launchConfigurationName);
        // only resolve the metadata options, and in the stack that owns them, so we don't touch anything else the user put in there
        let metadataOptions;
        try {
            if (launchTemplate instanceof aws_cdk_lib_1.aws_ec2.CfnLaunchTemplate) {
                metadataOptions = cdk.Stack.of(launchTemplate).resolve(launchTemplate.launchTemplateData?.metadataOptions);
            }
            else if (launchConfiguration instanceof autoscaling.CfnLaunchConfiguration) {
                metadataOptions = cdk.Stack.of(launchConfiguration).resolve(launchConfiguration.metadataOptions);
            }
        }
        catch {
            // can't tell, so warn below
        }
        if (metadataOptions?.httpTokens !== 'required' || metadataOptions?.httpPutResponseHopLimit !== 1) {
            cdk.Annotations.of(this).addWarningV2('@cloudsnorkel/cdk-github-runners:ecsCapacityProviderImds', 'Unable to confirm the custom capacity provider launch template requires IMDSv2 with a hop limit of 1. ' +
                'Without it, jobs can reach IMDS and take the instance role. Set `requireImdsv2: true` and `httpPutResponseHopLimit: 1` on the launch template.');
        }
    }
    defaultClusterInstanceAmi() {
        let os = aws_cdk_lib_1.aws_ec2.OperatingSystemType.LINUX;
        let ssmPath;
        if (this.image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS)) {
            if (this.gpuCount > 0 && this.image.architecture.is(common_1.Architecture.X86_64)) {
                ssmPath = '/aws/service/ecs/optimized-ami/amazon-linux-2023/gpu/recommended/image_id';
            }
            else if (this.image.architecture.is(common_1.Architecture.X86_64)) {
                ssmPath = '/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id';
            }
            else if (this.image.architecture.is(common_1.Architecture.ARM64)) {
                ssmPath = '/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id';
            }
        }
        if (this.image.os.is(common_1.Os.WINDOWS)) {
            os = aws_cdk_lib_1.aws_ec2.OperatingSystemType.WINDOWS;
            ssmPath = '/aws/service/ami-windows-latest/Windows_Server-2019-English-Full-ECS_Optimized/image_id';
        }
        if (!ssmPath) {
            throw new Error(`Unable to find AMI for ECS instances for ${this.image.os.name}/${this.image.architecture.name} (gpuCount=${this.gpuCount})`);
        }
        // resolved by EC2 on every launch, so new instances always get the latest AMI without redeploying
        return aws_cdk_lib_1.aws_ec2.MachineImage.resolveSsmParameterAtLaunch(ssmPath, { os });
    }
    pullCommand() {
        if (this.image.os.is(common_1.Os.WINDOWS)) {
            return `Start-Job -ScriptBlock { docker pull ${this.image.imageRepository.repositoryUri}:${this.image.imageTag} }`;
        }
        return `docker pull ${this.image.imageRepository.repositoryUri}:${this.image.imageTag} &`;
    }
    loginCommands() {
        const thisStack = aws_cdk_lib_1.Stack.of(this);
        if (this.image.os.is(common_1.Os.WINDOWS)) {
            return [`(Get-ECRLoginCommand).Password | docker login --username AWS --password-stdin ${thisStack.account}.dkr.ecr.${thisStack.region}.amazonaws.com`];
        }
        return [
            'yum install -y awscli || dnf install -y awscli',
            `aws ecr get-login-password --region ${thisStack.region} | docker login --username AWS --password-stdin ${thisStack.account}.dkr.ecr.${thisStack.region}.amazonaws.com`,
        ];
    }
    ecsSettingsCommands() {
        // don't let ECS accumulate too many stopped tasks that can end up very big in our case
        // the default is 10m duration with 1h jitter which can end up with 1h10m delay for cleaning up stopped tasks
        if (this.image.os.is(common_1.Os.WINDOWS)) {
            return [
                '[Environment]::SetEnvironmentVariable("ECS_ENGINE_TASK_CLEANUP_WAIT_DURATION", "5s", "Machine")',
                '[Environment]::SetEnvironmentVariable("ECS_ENGINE_TASK_CLEANUP_WAIT_DURATION_JITTER", "5s", "Machine")',
                // https://github.com/aws/aws-cdk/issues/36805
                '[Environment]::SetEnvironmentVariable("ECS_ENABLE_TASK_IAM_ROLE", "true", "Machine")',
                '(Get-Content "C:\\Program Files\\WindowsPowerShell\\Modules\\ECSTools\\ECSTools.psm1").Replace(\'if ($EnableTaskIAMRole) {\', \'$EnableTaskIAMRole = $true; if ($EnableTaskIAMRole) {\') | Set-Content "C:\\Program Files\\WindowsPowerShell\\Modules\\ECSTools\\ECSTools.psm1" -Force',
            ];
        }
        return [
            'echo ECS_ENGINE_TASK_CLEANUP_WAIT_DURATION=5s >> /etc/ecs/ecs.config',
            'echo ECS_ENGINE_TASK_CLEANUP_WAIT_DURATION_JITTER=5s >> /etc/ecs/ecs.config',
        ];
    }
    /**
     * Config for the shared ECS fragment.
     *
     * @internal
     */
    _runnerConfig() {
        // these are static per provider, so we render them the way ecs:runTask wants them right here
        // that means uppercasing the first letter of every key, exactly like EcsEc2LaunchTarget does
        const uppercaseKeys = (obj) => {
            const ret = {};
            for (const key of Object.keys(obj)) {
                ret[key.slice(0, 1).toUpperCase() + key.slice(1)] = obj[key];
            }
            return ret;
        };
        const placementStrategies = (this.placementStrategies ?? []).flatMap(s => s.toJson().map(uppercaseKeys));
        const placementConstraints = (this.placementConstraints ?? []).flatMap(c => c.toJson().map(uppercaseKeys));
        return {
            family: EcsRunnerProvider._FAMILY,
            provider: this.node.path,
            clusterArn: this.cluster.clusterArn,
            taskDefinitionFamily: this.task.family,
            containerName: this.container.containerName,
            capacityProviderName: this.capacityProvider.capacityProviderName,
            enableExecuteCommand: this.image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS),
            // always an array, even an empty one
            // a missing key makes the JSONata resolve to nothing and the state fails with States.QueryEvaluationError
            placementStrategies,
            placementConstraints,
            // the cleaned up provider path plus whatever the user asked for
            // see selectProviderParams() in runner.ts, which merges the rest of the standard runner tags in at runtime
            tags: Object.entries(this.tags).map(([Key, Value]) => ({ Key, Value })),
            cleanLabels: true,
            runnerGroup: this.group ?? '',
            defaultLabels: (0, common_1.runnerDefaultLabels)(this.image.os, this.image.architecture, this.defaultLabels),
        };
    }
    /**
     * @internal
     */
    _grantStateMachine(stateMachineRole) {
        (0, fargate_1.grantEcsRunTask)(this, stateMachineRole, this.task);
    }
    /**
     * @internal
     */
    _status(statusFunctionRole) {
        this.image.imageRepository.grant(statusFunctionRole, 'ecr:DescribeImages');
        return {
            type: this.constructor.name,
            labels: this.labels,
            constructPath: this.node.path,
            vpcArn: this.vpc?.vpcArn,
            securityGroups: this.securityGroups.map(sg => sg.securityGroupId),
            roleArn: this.task.taskRole.roleArn,
            logGroup: this.logGroup.logGroupName,
            image: {
                imageRepository: this.image.imageRepository.repositoryUri,
                imageTag: this.image.imageTag,
                imageBuilderLogGroup: this.image.logGroup?.logGroupName,
            },
        };
    }
}
exports.EcsRunnerProvider = EcsRunnerProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9lY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyw2Q0FRcUI7QUFDckIseUVBQTJEO0FBQzNELGlEQUF1RDtBQUN2RCxtREFBcUQ7QUFFckQscUNBZWtCO0FBQ2xCLHVDQUFpRjtBQUNqRixzREFBMkg7QUFDM0gsb0NBQThIO0FBNE85SDs7Ozs7Ozs7Ozs7R0FXRztBQUNILE1BQWEsaUJBQWtCLFNBQVEscUJBQVk7O0lBQ2pELGdCQUFnQjtJQUNULE1BQU0sQ0FBVSxPQUFPLEdBQUcsS0FBSyxDQUFDO0lBRXZDOzs7Ozs7T0FNRztJQUNJLE1BQU0sQ0FBQyxxQkFBcUIsQ0FBQyxLQUFnQjtRQUNsRCxNQUFNLENBQUMsR0FBRyxDQUFBLHNCQUE4QixDQUFBLENBQUM7UUFDekMsT0FBTyxJQUFJLCtCQUFhLENBQUMsV0FBVyxDQUFDLEtBQUssRUFBRSxZQUFZLEVBQUU7WUFDeEQsU0FBUyxFQUFFO2dCQUNULElBQUksRUFBRSxNQUFNO2dCQUNaLFFBQVEsRUFBRSxPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUMsU0FBUyw0QkFBNEI7Z0JBQzlELFVBQVUsRUFBRTtvQkFDVixXQUFXLEVBQUUsQ0FBQyxDQUFDLFlBQVksQ0FBQztvQkFDNUIsa0JBQWtCLEVBQUUsQ0FBQyxDQUFDLHNCQUFzQixDQUFDO29CQUM3QyxXQUFXLEVBQUU7d0JBQ1gsa0JBQWtCLEVBQUUsQ0FBQztnQ0FDbkIsUUFBUSxFQUFFLENBQUMsQ0FBQyxlQUFlLENBQUM7Z0NBQzVCLGFBQWEsRUFBRSxJQUFBLDBCQUFpQixFQUFDLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7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a0IsRUFBRSxvQkFBb0IsQ0FBQyxDQUFDO1FBRTNFLE9BQU87WUFDTCxJQUFJLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJO1lBQzNCLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTTtZQUNuQixhQUFhLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJO1lBQzdCLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLE1BQU07WUFDeEIsY0FBYyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLGVBQWUsQ0FBQztZQUNqRSxPQUFPLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTztZQUNuQyxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZO1lBQ3BDLEtBQUssRUFBRTtnQkFDTCxlQUFlLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsYUFBYTtnQkFDekQsUUFBUSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUTtnQkFDN0Isb0JBQW9CLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsWUFBWTthQUN4RDtTQUNGLENBQUM7SUFDSixDQUFDOztBQXRnQkgsOENBdWdCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2VjcyBhcyBlY3MsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3Nfc3RlcGZ1bmN0aW9ucyBhcyBzdGVwZnVuY3Rpb25zLFxuICBSZW1vdmFsUG9saWN5LFxuICBTdGFjayxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgYXV0b3NjYWxpbmcgZnJvbSAnYXdzLWNkay1saWIvYXdzLWF1dG9zY2FsaW5nJztcbmltcG9ydCB7IE1hY2hpbmVJbWFnZVR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gIGFtaVJvb3REZXZpY2UsXG4gIEFyY2hpdGVjdHVyZSxcbiAgQmFzZVByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlclN0YXR1cyxcbiAgT3MsXG4gIHJ1bm5lckVudmlyb25tZW50LFxuICBSdW5uZXJJbWFnZSxcbiAgUnVubmVyUHJvdmlkZXJQcm9wcyxcbiAgUnVubmVyVmVyc2lvbixcbiAgU3RvcmFnZU9wdGlvbnMsXG4gIHByb3ZpZGVyUGFyYW0sXG4gIFJ1bm5lckNvbmZpZyxcbiAgcnVubmVyRGVmYXVsdExhYmVscyxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgY2xlYW5FY3NUYWcsIGVjc1J1bkNvbW1hbmQsIGVjc1RhZ3MsIGdyYW50RWNzUnVuVGFzayB9IGZyb20gJy4vZmFyZ2F0ZSc7XG5pbXBvcnQgeyBJUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXIsIFJ1bm5lckltYWdlQnVpbGRlclByb3BzLCBSdW5uZXJJbWFnZUNvbXBvbmVudCB9IGZyb20gJy4uL2ltYWdlLWJ1aWxkZXJzJztcbmltcG9ydCB7IE1JTklNQUxfRUMyX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCwgTUlOSU1BTF9FQ1NfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIEVjc1J1bm5lclByb3ZpZGVyLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVjc1J1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgRG9ja2VyIGltYWdlcyBjb250YWluaW5nIEdpdEh1YiBSdW5uZXIgYW5kIGFsbCByZXF1aXJlbWVudHMuXG4gICAqXG4gICAqIFRoZSBpbWFnZSBidWlsZGVyIGRldGVybWluZXMgdGhlIE9TIGFuZCBhcmNoaXRlY3R1cmUgb2YgdGhlIHJ1bm5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgRWNzUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKClcbiAgICovXG4gIHJlYWRvbmx5IGltYWdlQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2VjcyddXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgcnVubmVyIGdyb3VwIG5hbWUuXG4gICAqXG4gICAqIElmIHNwZWNpZmllZCwgdGhlIHJ1bm5lciB3aWxsIGJlIHJlZ2lzdGVyZWQgd2l0aCB0aGlzIGdyb3VwIG5hbWUuIFNldHRpbmcgYSBydW5uZXIgZ3JvdXAgY2FuIGhlbHAgbWFuYWdpbmcgYWNjZXNzIHRvIHNlbGYtaG9zdGVkIHJ1bm5lcnMuIEl0XG4gICAqIHJlcXVpcmVzIGEgcGFpZCBHaXRIdWIgYWNjb3VudCBhbmQgb3JnYW5pemF0aW9uIGxldmVsIHJ1bm5lciByZWdpc3RyYXRpb24uXG4gICAqXG4gICAqIFRoZSBncm91cCBtdXN0IGV4aXN0IG9yIHRoZSBydW5uZXIgd2lsbCBub3Qgc3RhcnQuXG4gICAqXG4gICAqIFVzZXJzIHdpbGwgc3RpbGwgYmUgYWJsZSB0byB0cmlnZ2VyIHRoaXMgcnVubmVyIHdpdGggdGhlIGNvcnJlY3QgbGFiZWxzLiBCdXQgdGhlIHJ1bm5lciB3aWxsIG9ubHkgYmUgYWJsZSB0byBydW4gam9icyBmcm9tIHJlcG9zIGFsbG93ZWQgdG8gdXNlIHRoZSBncm91cC5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBncm91cD86IHN0cmluZztcblxuICAvKipcbiAgICogVlBDIHRvIGxhdW5jaCB0aGUgcnVubmVycyBpbi5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBhY2NvdW50IFZQQ1xuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFN1Ym5ldHMgdG8gcnVuIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBFQ1MgZGVmYXVsdFxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXBzIHRvIGFzc2lnbiB0byB0aGUgdGFzay5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgLyoqXG4gICAqIEV4aXN0aW5nIEVDUyBjbHVzdGVyIHRvIHVzZS5cbiAgICpcbiAgICogSm9icyBmcm9tIGFsbCBwcm92aWRlcnMgdXNpbmcgdGhlIHNhbWUgY2x1c3RlciBjYW4gc2hhcmUgaW5zdGFuY2VzLiBPbmx5IHNoYXJlIGEgY2x1c3RlciBiZXR3ZWVuIHByb3ZpZGVycyB3aG9zZSBqb2JzIGFyZSBlcXVhbGx5IHRydXN0ZWQuXG4gICAqXG4gICAqIEBzZWUgaHR0cHM6Ly9naXRodWIuY29tL0Nsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMjam9iLWlzb2xhdGlvblxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBjbHVzdGVyXG4gICAqL1xuICByZWFkb25seSBjbHVzdGVyPzogZWNzLkNsdXN0ZXI7XG5cbiAgLyoqXG4gICAqIEV4aXN0aW5nIGNhcGFjaXR5IHByb3ZpZGVyIHRvIHVzZS5cbiAgICpcbiAgICogTWFrZSBzdXJlIHRoZSBBTUkgdXNlZCBieSB0aGUgY2FwYWNpdHkgcHJvdmlkZXIgaXMgY29tcGF0aWJsZSB3aXRoIEVDUy5cbiAgICpcbiAgICogUnVubmVyIGNvbnRhaW5lcnMgdXNlIGJyaWRnZSBuZXR3b3JraW5nIGFuZCBzaGFyZSB0aGUgaW5zdGFuY2Ugd2l0aCBvdGhlciBqb2JzLiBJdHMgbGF1bmNoIHRlbXBsYXRlIG11c3QgcmVxdWlyZSBJTURTdjIgYW5kIHNldCB0aGVcbiAgICogbWV0YWRhdGEgaG9wIGxpbWl0IHRvIDEgKGByZXF1aXJlSW1kc3YyOiB0cnVlYCBhbmQgYGh0dHBQdXRSZXNwb25zZUhvcExpbWl0OiAxYCksIG9yIGpvYnMgY2FuIHRha2UgdGhlIGluc3RhbmNlIHJvbGUuIEEgd2FybmluZyBpc1xuICAgKiBhZGRlZCB3aGVuIHdlIGNhbid0IGNvbmZpcm0gYm90aC5cbiAgICpcbiAgICogQGRlZmF1bHQgbmV3IGNhcGFjaXR5IHByb3ZpZGVyXG4gICAqL1xuICByZWFkb25seSBjYXBhY2l0eVByb3ZpZGVyPzogZWNzLkFzZ0NhcGFjaXR5UHJvdmlkZXI7XG5cbiAgLyoqXG4gICAqIEFzc2lnbiBwdWJsaWMgSVAgdG8gdGhlIHJ1bm5lciB0YXNrLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBFQ1MgcnVubmVyIHRhc2tzIHVzZSBicmlkZ2UgbmV0d29ya2luZywgc28gdGhleSBzaGFyZSB0aGUgaG9zdCBpbnN0YW5jZSdzIG5ldHdvcmsgaW50ZXJmYWNlIGFuZFxuICAgKiBjYW5ub3QgZ2V0IGEgcHVibGljIElQIG9mIHRoZWlyIG93bi4gVGhpcyBwcm9wZXJ0eSBpcyBpZ25vcmVkLiBHaXZlIHRoZSBjbHVzdGVyIGluc3RhbmNlcyBpbnRlcm5ldCBhY2Nlc3NcbiAgICogaW5zdGVhZCAoYSBwdWJsaWMgc3VibmV0IG9yIGEgTkFUIGdhdGV3YXkpLCBhbmQgb3BlbiBhbiBpc3N1ZSBpZiB5b3UgbmVlZCBgYXdzdnBjYCBuZXR3b3JraW5nIGZvciBFQ1MuXG4gICAqXG4gICAqIEBkZWZhdWx0IC0gaWdub3JlZFxuICAgKi9cbiAgcmVhZG9ubHkgYXNzaWduUHVibGljSXA/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGNwdSB1bml0cyB1c2VkIGJ5IHRoZSB0YXNrLiAxMDI0IHVuaXRzIGlzIDEgdkNQVS4gRnJhY3Rpb25zIG9mIGEgdkNQVSBhcmUgc3VwcG9ydGVkLlxuICAgKlxuICAgKiBAZGVmYXVsdCAxMDI0XG4gICAqL1xuICByZWFkb25seSBjcHU/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBhbW91bnQgKGluIE1pQikgb2YgbWVtb3J5IHVzZWQgYnkgdGhlIHRhc2suXG4gICAqXG4gICAqIEBkZWZhdWx0IDM1MDAsIHVubGVzcyBgbWVtb3J5UmVzZXJ2YXRpb25NaUJgIGlzIHVzZWQgYW5kIHRoZW4gaXQncyB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IG1lbW9yeUxpbWl0TWlCPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgc29mdCBsaW1pdCAoaW4gTWlCKSBvZiBtZW1vcnkgdG8gcmVzZXJ2ZSBmb3IgdGhlIGNvbnRhaW5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBtZW1vcnlSZXNlcnZhdGlvbk1pQj86IG51bWJlcjtcblxuICAvKipcbiAgICogSW5zdGFuY2UgdHlwZSBvZiBFQ1MgY2x1c3RlciBpbnN0YW5jZXMuIE9ubHkgdXNlZCB3aGVuIGNyZWF0aW5nIGEgbmV3IGNsdXN0ZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IG02aS5sYXJnZSBvciBtNmcubGFyZ2VcbiAgICovXG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZT86IGVjMi5JbnN0YW5jZVR5cGU7XG5cbiAgLyoqXG4gICAqIFRoZSBtaW5pbXVtIG51bWJlciBvZiBpbnN0YW5jZXMgdG8gcnVuIGluIHRoZSBjbHVzdGVyLiBPbmx5IHVzZWQgd2hlbiBjcmVhdGluZyBhIG5ldyBjbHVzdGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCAwXG4gICAqL1xuICByZWFkb25seSBtaW5JbnN0YW5jZXM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBtYXhpbXVtIG51bWJlciBvZiBpbnN0YW5jZXMgdG8gcnVuIGluIHRoZSBjbHVzdGVyLiBPbmx5IHVzZWQgd2hlbiBjcmVhdGluZyBhIG5ldyBjbHVzdGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCA1XG4gICAqL1xuICByZWFkb25seSBtYXhJbnN0YW5jZXM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFNpemUgb2Ygdm9sdW1lIGF2YWlsYWJsZSBmb3IgbGF1bmNoZWQgY2x1c3RlciBpbnN0YW5jZXMuIFRoaXMgbW9kaWZpZXMgdGhlIGJvb3Qgdm9sdW1lIHNpemUgYW5kIGRvZXNuJ3QgYWRkIGFueSBhZGRpdGlvbmFsIHZvbHVtZXMuXG4gICAqXG4gICAqIEVhY2ggaW5zdGFuY2UgY2FuIGJlIHVzZWQgYnkgbXVsdGlwbGUgcnVubmVycywgc28gbWFrZSBzdXJlIHRoZXJlIGlzIGVub3VnaCBzcGFjZSBmb3IgYWxsIG9mIHRoZW0uXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgc2l6ZSBmb3IgQU1JICh1c3VhbGx5IDMwR0IgZm9yIExpbnV4IGFuZCA1MEdCIGZvciBXaW5kb3dzKVxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcblxuICAvKipcbiAgICogT3B0aW9ucyBmb3IgcnVubmVyIGluc3RhbmNlIHN0b3JhZ2Ugdm9sdW1lLlxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZU9wdGlvbnM/OiBTdG9yYWdlT3B0aW9ucztcblxuICAvKipcbiAgICogU3VwcG9ydCBidWlsZGluZyBhbmQgcnVubmluZyBEb2NrZXIgaW1hZ2VzIGJ5IGVuYWJsaW5nIERvY2tlci1pbi1Eb2NrZXIgKGRpbmQpIGFuZCB0aGUgcmVxdWlyZWQgcHJpdmlsZWdlZCBtb2RlIGZvciB0aGUgcnVubmVyIGNvbnRhaW5lci5cbiAgICpcbiAgICogQSBqb2IgcnVubmluZyBpbiBhIHByaXZpbGVnZWQgY29udGFpbmVyIGNhbiB0YWtlIG92ZXIgdGhlIGluc3RhbmNlLCBhY2Nlc3Mgb3RoZXIgam9icyBydW5uaW5nIG9uIGl0LCBhbmQgYWZmZWN0IGpvYnMgdGhhdCBydW4gb24gaXRcbiAgICogbGF0ZXIuIEFsbCBqb2JzIHRoYXQgY2FuIHJ1biBvbiB0aGUgc2FtZSBjbHVzdGVyIHNob3VsZCBiZSBlcXVhbGx5IHRydXN0ZWQuIERpc2FibGUgdGhpcyBpZiB5b3VyIGpvYnMgZG9uJ3QgbmVlZCBEb2NrZXIuXG4gICAqXG4gICAqIERpc2FibGluZyBEb2NrZXItaW4tRG9ja2VyIGNhbiBhbHNvIHNwZWVkIHVwIHJ1bm5lciBwcm92aXNpb25pbmcgYXMgdGhlIHJ1bm5lciBkb2Vzbid0IGhhdmUgdG8gd2FpdCBmb3IgRG9ja2VyIHRvIGJvb3QuXG4gICAqXG4gICAqIEBzZWUgaHR0cHM6Ly9naXRodWIuY29tL0Nsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMjam9iLWlzb2xhdGlvblxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBkb2NrZXJJbkRvY2tlcj86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFVzZSBzcG90IGNhcGFjaXR5LlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZSAodHJ1ZSBpZiBzcG90TWF4UHJpY2UgaXMgc3BlY2lmaWVkKVxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIE1heGltdW0gcHJpY2UgZm9yIHNwb3QgaW5zdGFuY2VzLlxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdE1heFByaWNlPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBFQ1MgcGxhY2VtZW50IHN0cmF0ZWdpZXMgdG8gaW5mbHVlbmNlIHRhc2sgcGxhY2VtZW50LlxuICAgKlxuICAgKiBFeGFtcGxlOiBbZWNzLlBsYWNlbWVudFN0cmF0ZWd5LnBhY2tlZEJ5Q3B1KCldXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZCAobm8gcGxhY2VtZW50IHN0cmF0ZWdpZXMpXG4gICAqL1xuICByZWFkb25seSBwbGFjZW1lbnRTdHJhdGVnaWVzPzogZWNzLlBsYWNlbWVudFN0cmF0ZWd5W107XG5cbiAgLyoqXG4gICAqIEVDUyBwbGFjZW1lbnQgY29uc3RyYWludHMgdG8gaW5mbHVlbmNlIHRhc2sgcGxhY2VtZW50LlxuICAgKlxuICAgKiBFeGFtcGxlOiBbZWNzLlBsYWNlbWVudENvbnN0cmFpbnQubWVtYmVyT2YoJ2Vjcy1wbGFjZW1lbnQnKV1cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkIChubyBwbGFjZW1lbnQgY29uc3RyYWludHMpXG4gICAqL1xuICByZWFkb25seSBwbGFjZW1lbnRDb25zdHJhaW50cz86IGVjcy5QbGFjZW1lbnRDb25zdHJhaW50W107XG5cbiAgLyoqXG4gICAqIE51bWJlciBvZiBHUFVzIHRvIHJlcXVlc3QgZm9yIHRoZSBydW5uZXIgdGFzay4gV2hlbiBzZXQsIHRoZSB0YXNrIHdpbGwgYmUgc2NoZWR1bGVkIG9uIEdQVS1jYXBhYmxlIGluc3RhbmNlcy5cbiAgICpcbiAgICogUmVxdWlyZXMgYSBHUFUtY2FwYWJsZSBpbnN0YW5jZSB0eXBlIChlLmcuLCBnNGRuLnhsYXJnZSBmb3IgMSBHUFUsIGc0ZG4uMTJ4bGFyZ2UgZm9yIDQgR1BVcykgYW5kIEdQVSBBTUkuXG4gICAqIFdoZW4gY3JlYXRpbmcgYSBuZXcgY2x1c3RlciwgaW5zdGFuY2VUeXBlIGRlZmF1bHRzIHRvIGc0ZG4ueGxhcmdlIGFuZCB0aGUgRUNTIE9wdGltaXplZCBHUFUgQU1JIGlzIHVzZWQuXG4gICAqXG4gICAqIFlvdSBtdXN0IGVuc3VyZSB0aGF0IHRoZSB0YXNrJ3MgY29udGFpbmVyIGltYWdlIGluY2x1ZGVzIHRoZSBDVURBIHJ1bnRpbWUuIFByb3ZpZGUgYSBDVURBLWVuYWJsZWQgYmFzZSBpbWFnZVxuICAgKiB2aWEgYGJhc2VEb2NrZXJJbWFnZWAsIHVzZSBhbiBpbWFnZSBidWlsZGVyIHRoYXQgc3RhcnRzIGZyb20gYSBHUFUtY2FwYWJsZSBpbWFnZSAoc3VjaCBhcyBudmlkaWEvY3VkYSksIG9yIGFkZFxuICAgKiBhbiBpbWFnZSBjb21wb25lbnQgdGhhdCBpbnN0YWxscyB0aGUgQ1VEQSBydW50aW1lIGludG8gdGhlIGltYWdlLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWQgKG5vIEdQVSlcbiAgICovXG4gIHJlYWRvbmx5IGdwdT86IG51bWJlcjtcblxuICAvKipcbiAgICogQWRkaXRpb25hbCB0YWdzIHRvIGFwcGx5IHRvIGxhdW5jaGVkIHJ1bm5lciB0YXNrcy5cbiAgICpcbiAgICogVGhlc2UgYWRkaXRpb25hbCB0YWdzIGFyZSBzZXQgb24gdG9wIG9mIGBOYW1lYCwgYEdpdEh1YlJ1bm5lcnM6UHJvdmlkZXJgLCBgR2l0SHViUnVubmVyczpSZXBvYCwgYW5kIGBHaXRIdWJSdW5uZXJzOkxhYmVsc2AuXG4gICAqIFlvdSBtYXkgbm90IG92ZXJyaWRlIHRhZ3Mgd2l0aCB0aGUgYEdpdEh1YlJ1bm5lcnM6YCBwcmVmaXguXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIGFkZGl0aW9uYWwgdGFnc1xuICAgKi9cbiAgcmVhZG9ubHkgdGFncz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG59XG5cbi8qKlxuICogUnVubmVyIGNvbmZpZyBmb3IgdGhlIEVjcyBmYW1pbHkgZnJhZ21lbnQuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmludGVyZmFjZSBFY3NSdW5uZXJDb25maWcgZXh0ZW5kcyBSdW5uZXJDb25maWcge1xuICByZWFkb25seSBjbHVzdGVyQXJuOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHRhc2tEZWZpbml0aW9uRmFtaWx5OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGNvbnRhaW5lck5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgY2FwYWNpdHlQcm92aWRlck5hbWU6IHN0cmluZztcbiAgcmVhZG9ubHkgZW5hYmxlRXhlY3V0ZUNvbW1hbmQ6IGJvb2xlYW47XG4gIHJlYWRvbmx5IHBsYWNlbWVudFN0cmF0ZWdpZXM6IGFueVtdO1xuICByZWFkb25seSBwbGFjZW1lbnRDb25zdHJhaW50czogYW55W107XG59XG5cbi8qKlxuICogR2l0SHViIEFjdGlvbnMgcnVubmVyIHByb3ZpZGVyIHVzaW5nIEVDUyBvbiBFQzIgdG8gZXhlY3V0ZSBqb2JzLlxuICpcbiAqIEVDUyBjYW4gYmUgdXNlZnVsIHdoZW4geW91IHdhbnQgbW9yZSBjb250cm9sIG9mIHRoZSBpbmZyYXN0cnVjdHVyZSBydW5uaW5nIHRoZSBHaXRIdWIgQWN0aW9ucyBEb2NrZXIgY29udGFpbmVycy4gWW91IGNhbiBjb250cm9sIHRoZSBhdXRvc2NhbGluZ1xuICogZ3JvdXAgdG8gc2NhbGUgZG93biB0byB6ZXJvIGR1cmluZyB0aGUgbmlnaHQgYW5kIHNjYWxlIHVwIGR1cmluZyB3b3JrIGhvdXJzLiBUaGlzIHdheSB5b3UgY2FuIHN0aWxsIHNhdmUgbW9uZXksIGJ1dCBoYXZlIHRvIHdhaXQgbGVzcyBmb3JcbiAqIGluZnJhc3RydWN0dXJlIHRvIHNwaW4gdXAuXG4gKlxuICogSm9icyBzaGFyZSBpbnN0YW5jZXMsIGFuZCBieSBkZWZhdWx0IHJ1biBpbiBwcml2aWxlZ2VkIGNvbnRhaW5lcnMgb24gTGludXggdGhhdCBjYW4gdGFrZSBvdmVyIHRoZSBpbnN0YW5jZS4gQWxsIGpvYnMgdGhhdCBjYW4gcnVuIG9uIHRoZSBzYW1lXG4gKiBjbHVzdGVyIHNob3VsZCBiZSBlcXVhbGx5IHRydXN0ZWQuIFNlZSBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycyNqb2ItaXNvbGF0aW9uXG4gKlxuICogVGhpcyBjb25zdHJ1Y3QgaXMgbm90IG1lYW50IHRvIGJlIHVzZWQgYnkgaXRzZWxmLiBJdCBzaG91bGQgYmUgcGFzc2VkIGluIHRoZSBwcm92aWRlcnMgcHJvcGVydHkgZm9yIEdpdEh1YlJ1bm5lcnMuXG4gKi9cbmV4cG9ydCBjbGFzcyBFY3NSdW5uZXJQcm92aWRlciBleHRlbmRzIEJhc2VQcm92aWRlciBpbXBsZW1lbnRzIElSdW5uZXJQcm92aWRlciB7XG4gIC8qKiBAaW50ZXJuYWwgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBfRkFNSUxZID0gJ2Vjcyc7XG5cbiAgLyoqXG4gICAqIFRoZSBmcmFnbWVudCB0aGF0IHJ1bnMgYW55IEVDUyBwcm92aWRlci4gUmVhZHMgdGhlIGNvbmZpZyB7QGxpbmsgX3J1bm5lckNvbmZpZ30gZ2VuZXJhdGVkIGZvciBpdCBmcm9tXG4gICAqIGAkLnByb3ZpZGVyUGFyYW1zYC4gUmVuZGVycyB3aGF0IEVjc1J1blRhc2sgdXNlZCB0byByZW5kZXIgcGVyIHByb3ZpZGVyLCBtaW51cyBOZXR3b3JrQ29uZmlndXJhdGlvbiBiZWNhdXNlXG4gICAqIEVDUyB0YXNrIGRlZmluaXRpb25zIHVzZSBicmlkZ2UgbmV0d29ya2luZy5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIF9zdGF0ZU1hY2hpbmVGcmFnbWVudChzY29wZTogQ29uc3RydWN0KTogc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlIHtcbiAgICBjb25zdCBwID0gcHJvdmlkZXJQYXJhbTxFY3NSdW5uZXJDb25maWc+O1xuICAgIHJldHVybiBuZXcgc3RlcGZ1bmN0aW9ucy5DdXN0b21TdGF0ZShzY29wZSwgJ0VDUyBSdW5uZXInLCB7XG4gICAgICBzdGF0ZUpzb246IHtcbiAgICAgICAgVHlwZTogJ1Rhc2snLFxuICAgICAgICBSZXNvdXJjZTogYGFybjoke2Nkay5Bd3MuUEFSVElUSU9OfTpzdGF0ZXM6OjplY3M6cnVuVGFzay5zeW5jYCxcbiAgICAgICAgUGFyYW1ldGVyczoge1xuICAgICAgICAgICdDbHVzdGVyLiQnOiBwKCdjbHVzdGVyQXJuJyksXG4gICAgICAgICAgJ1Rhc2tEZWZpbml0aW9uLiQnOiBwKCd0YXNrRGVmaW5pdGlvbkZhbWlseScpLFxuICAgICAgICAgICdPdmVycmlkZXMnOiB7XG4gICAgICAgICAgICBDb250YWluZXJPdmVycmlkZXM6IFt7XG4gICAgICAgICAgICAgICdOYW1lLiQnOiBwKCdjb250YWluZXJOYW1lJyksXG4gICAgICAgICAgICAgICdFbnZpcm9ubWVudCc6IHJ1bm5lckVudmlyb25tZW50KChuYW1lLCB2YWx1ZSkgPT4gKHsgJ05hbWUnOiBuYW1lLCAnVmFsdWUuJCc6IHZhbHVlIH0pKSxcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgJ1Byb3BhZ2F0ZVRhZ3MnOiAnVEFTS19ERUZJTklUSU9OJyxcbiAgICAgICAgICAnVGFncy4kJzogcCgndGFncycpLCAvLyB0aGUgcHJvdmlkZXIncyB0YWdzLCBhbHJlYWR5IG1lcmdlZCB3aXRoIHRoZSBzdGFuZGFyZCBydW5uZXIgdGFncyBieSB0aGUgb3JjaGVzdHJhdG9yXG4gICAgICAgICAgJ0NhcGFjaXR5UHJvdmlkZXJTdHJhdGVneSc6IFt7XG4gICAgICAgICAgICAnQ2FwYWNpdHlQcm92aWRlci4kJzogcCgnY2FwYWNpdHlQcm92aWRlck5hbWUnKSxcbiAgICAgICAgICB9XSxcbiAgICAgICAgICAvLyByZWFkeS1tYWRlIGFycmF5cyBpbiB0aGUgc2hhcGUgZWNzOnJ1blRhc2sgd2FudHMsIGVtcHR5IHdoZW4gbm90aGluZyBpcyBjb25maWd1cmVkXG4gICAgICAgICAgJ1BsYWNlbWVudENvbnN0cmFpbnRzLiQnOiBwKCdwbGFjZW1lbnRDb25zdHJhaW50cycpLFxuICAgICAgICAgICdQbGFjZW1lbnRTdHJhdGVneS4kJzogcCgncGxhY2VtZW50U3RyYXRlZ2llcycpLFxuICAgICAgICAgICdFbmFibGVFeGVjdXRlQ29tbWFuZC4kJzogcCgnZW5hYmxlRXhlY3V0ZUNvbW1hbmQnKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIG5ldyBpbWFnZSBidWlsZGVyIHRoYXQgYnVpbGRzIEVDUyBzcGVjaWZpYyBydW5uZXIgaW1hZ2VzLlxuICAgKlxuICAgKiBZb3UgY2FuIGN1c3RvbWl6ZSB0aGUgT1MsIGFyY2hpdGVjdHVyZSwgVlBDLCBzdWJuZXQsIHNlY3VyaXR5IGdyb3VwcywgZXRjLiBieSBwYXNzaW5nIGluIHByb3BzLlxuICAgKlxuICAgKiBZb3UgY2FuIGFkZCBjb21wb25lbnRzIHRvIHRoZSBpbWFnZSBidWlsZGVyIGJ5IGNhbGxpbmcgYGltYWdlQnVpbGRlci5hZGRDb21wb25lbnQoKWAuXG4gICAqXG4gICAqIFRoZSBkZWZhdWx0IE9TIGlzIFVidW50dSBydW5uaW5nIG9uIHg2NCBhcmNoaXRlY3R1cmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNvbXBvbmVudHM6XG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcigpYFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcykge1xuICAgIHJldHVybiBSdW5uZXJJbWFnZUJ1aWxkZXIubmV3KHNjb3BlLCBpZCwge1xuICAgICAgb3M6IE9zLkxJTlVYX1VCVU5UVSxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGNvbXBvbmVudHM6IFtcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcigpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIocHJvcHM/LnJ1bm5lclZlcnNpb24gPz8gUnVubmVyVmVyc2lvbi5sYXRlc3QoKSksXG4gICAgICBdLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ2x1c3RlciBob3N0aW5nIHRoZSB0YXNrIGhvc3RpbmcgdGhlIHJ1bm5lci5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgY2x1c3RlcjogZWNzLkNsdXN0ZXI7XG5cbiAgLyoqXG4gICAqIENhcGFjaXR5IHByb3ZpZGVyIHVzZWQgdG8gc2NhbGUgdGhlIGNsdXN0ZXIuXG4gICAqXG4gICAqIFVzZSBjYXBhY2l0eVByb3ZpZGVyLmF1dG9TY2FsaW5nR3JvdXAgdG8gYWNjZXNzIHRoZSBhdXRvIHNjYWxpbmcgZ3JvdXAuIFRoaXMgY2FuIGhlbHAgc2V0IHVwIGN1c3RvbSBzY2FsaW5nIHBvbGljaWVzLlxuICAgKi9cbiAgcmVhZG9ubHkgY2FwYWNpdHlQcm92aWRlcjogZWNzLkFzZ0NhcGFjaXR5UHJvdmlkZXI7XG5cbiAgLyoqXG4gICAqIEVDUyB0YXNrIGhvc3RpbmcgdGhlIHJ1bm5lci5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgdGFzazogZWNzLkVjMlRhc2tEZWZpbml0aW9uO1xuXG4gIC8qKlxuICAgKiBDb250YWluZXIgZGVmaW5pdGlvbiBob3N0aW5nIHRoZSBydW5uZXIuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbnRhaW5lcjogZWNzLkNvbnRhaW5lckRlZmluaXRpb247XG5cbiAgLyoqXG4gICAqIExhYmVscyBhc3NvY2lhdGVkIHdpdGggdGhpcyBwcm92aWRlci5cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVsczogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIFZQQyB1c2VkIGZvciBob3N0aW5nIHRoZSBydW5uZXIgdGFzay5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFN1Ym5ldHMgdXNlZCBmb3IgaG9zdGluZyB0aGUgcnVubmVyIHRhc2suXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIEdyYW50IHByaW5jaXBhbCB1c2VkIHRvIGFkZCBwZXJtaXNzaW9ucyB0byB0aGUgcnVubmVyIHJvbGUuXG4gICAqL1xuICByZWFkb25seSBncmFudFByaW5jaXBhbDogaWFtLklQcmluY2lwYWw7XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcmVhZG9ubHkgY29ubmVjdGlvbnM6IGVjMi5Db25uZWN0aW9ucztcblxuICAvKipcbiAgICogRG9ja2VyIGltYWdlIGxvYWRlZCB3aXRoIEdpdEh1YiBBY3Rpb25zIFJ1bm5lciBhbmQgaXRzIHByZXJlcXVpc2l0ZXMuIFRoZSBpbWFnZSBpcyBidWlsdCBieSBhbiBpbWFnZSBidWlsZGVyIGFuZCBpcyBzcGVjaWZpYyB0byBFQ1MgdGFza3MuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGltYWdlOiBSdW5uZXJJbWFnZTtcblxuICAvKipcbiAgICogTG9nIGdyb3VwIHdoZXJlIHByb3ZpZGVkIHJ1bm5lcnMgd2lsbCBzYXZlIHRoZWlyIGxvZ3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGlzIG5vdCB0aGUgam9iIGxvZywgYnV0IHRoZSBydW5uZXIgaXRzZWxmLiBJdCB3aWxsIG5vdCBjb250YWluIG91dHB1dCBmcm9tIHRoZSBHaXRIdWIgQWN0aW9uIGJ1dCBvbmx5IG1ldGFkYXRhIG9uIGl0cyBleGVjdXRpb24uXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cDogbG9ncy5JTG9nR3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwcyBhc3NvY2lhdGVkIHdpdGggdGhpcyBwcm92aWRlci5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM6IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIC8qKlxuICAgKiBSdW4gZG9ja2VyIGluIGRvY2tlci5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgZGluZDogYm9vbGVhbjtcblxuICAvKipcbiAgICogUnVubmVyIGdyb3VwIG5hbWUuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBJbmNsdWRlIGRlZmF1bHQgbGFiZWxzIChhcmNoLCBvcywgc2VsZi1ob3N0ZWQpIGZvciBydW5uZXIuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIEVDUyBwbGFjZW1lbnQgc3RyYXRlZ2llcyB0byBpbmZsdWVuY2UgdGFzayBwbGFjZW1lbnQuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHBsYWNlbWVudFN0cmF0ZWdpZXM/OiBlY3MuUGxhY2VtZW50U3RyYXRlZ3lbXTtcblxuICAvKipcbiAgICogRUNTIHBsYWNlbWVudCBjb25zdHJhaW50cyB0byBpbmZsdWVuY2UgdGFzayBwbGFjZW1lbnQuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHBsYWNlbWVudENvbnN0cmFpbnRzPzogZWNzLlBsYWNlbWVudENvbnN0cmFpbnRbXTtcblxuICAvKipcbiAgICogTnVtYmVyIG9mIEdQVXMgcmVxdWVzdGVkIGZvciB0aGUgcnVubmVyIHRhc2sgKDAgPSBubyBHUFUpLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBncHVDb3VudDogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUYWdzIHNldCBvbiBsYXVuY2hlZCBydW5uZXIgdGFza3MuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHRhZ3M6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG5cblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IEVjc1J1bm5lclByb3ZpZGVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIHRoaXMubGFiZWxzID0gcHJvcHM/LmxhYmVscyA/PyBbJ2VjcyddO1xuICAgIHRoaXMuZ3JvdXAgPSBwcm9wcz8uZ3JvdXA7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcbiAgICB0aGlzLnZwYyA9IHByb3BzPy52cGMgPz8gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdkZWZhdWx0IHZwYycsIHsgaXNEZWZhdWx0OiB0cnVlIH0pO1xuICAgIHRoaXMuc3VibmV0U2VsZWN0aW9uID0gcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbjtcbiAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gcHJvcHM/LnNlY3VyaXR5R3JvdXBzID8/IFtuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ3NlY3VyaXR5IGdyb3VwJywgeyB2cGM6IHRoaXMudnBjIH0pXTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gbmV3IGVjMi5Db25uZWN0aW9ucyh7IHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzIH0pO1xuICAgIHRoaXMucGxhY2VtZW50U3RyYXRlZ2llcyA9IHByb3BzPy5wbGFjZW1lbnRTdHJhdGVnaWVzO1xuICAgIHRoaXMucGxhY2VtZW50Q29uc3RyYWludHMgPSBwcm9wcz8ucGxhY2VtZW50Q29uc3RyYWludHM7XG4gICAgdGhpcy5ncHVDb3VudCA9IHByb3BzPy5ncHUgPz8gMDtcbiAgICB0aGlzLnRhZ3MgPSBlY3NUYWdzKHRoaXMsIHByb3BzPy50YWdzID8/IHt9KTtcbiAgICB0aGlzLmNsdXN0ZXIgPSBwcm9wcz8uY2x1c3RlciA/IHByb3BzLmNsdXN0ZXIgOiBuZXcgZWNzLkNsdXN0ZXIoXG4gICAgICB0aGlzLFxuICAgICAgJ2NsdXN0ZXInLFxuICAgICAge1xuICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICBlbmFibGVGYXJnYXRlQ2FwYWNpdHlQcm92aWRlcnM6IGZhbHNlLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gYWxsIHByb3ZpZGVycyBhZGQgdGhpcyB0YWcsIGJ1dCBFQ1MvRmFyZ2F0ZSB0YWdzIG5lZWQgdG8gYmUgY2xlYW5lZFxuICAgIGNkay5UYWdzLm9mKHRoaXMpLmFkZCgnR2l0SHViUnVubmVyczpQcm92aWRlcicsIGNsZWFuRWNzVGFnKHRoaXMsICdwcm92aWRlciB0YWcnLCB0aGlzLm5vZGUucGF0aCkpO1xuXG4gICAgaWYgKHByb3BzPy5zdG9yYWdlT3B0aW9ucyAmJiAhcHJvcHM/LnN0b3JhZ2VTaXplKSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoJ3N0b3JhZ2VTaXplIGlzIHJlcXVpcmVkIHdoZW4gc3RvcmFnZU9wdGlvbnMgYXJlIHNwZWNpZmllZCcpO1xuICAgIH1cblxuICAgIGNvbnN0IGRlZmF1bHRJbWFnZUJ1aWxkZXJBcmNoaXRlY3R1cmUgPVxuICAgICAgIXByb3BzPy5jYXBhY2l0eVByb3ZpZGVyICYmIHByb3BzPy5pbnN0YW5jZVR5cGU/LmFyY2hpdGVjdHVyZSA9PT0gZWMyLkluc3RhbmNlQXJjaGl0ZWN0dXJlLkFSTV82NFxuICAgICAgICA/IEFyY2hpdGVjdHVyZS5BUk02NFxuICAgICAgICA6IEFyY2hpdGVjdHVyZS5YODZfNjQ7XG5cbiAgICBjb25zdCBpbWFnZUJ1aWxkZXIgPSBwcm9wcz8uaW1hZ2VCdWlsZGVyID8/IEVjc1J1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcih0aGlzLCAnSW1hZ2UgQnVpbGRlcicsIHtcbiAgICAgIGFyY2hpdGVjdHVyZTogZGVmYXVsdEltYWdlQnVpbGRlckFyY2hpdGVjdHVyZSxcbiAgICB9KTtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2UgPSBpbWFnZUJ1aWxkZXIuYmluZERvY2tlckltYWdlKCk7XG5cbiAgICBpZiAocHJvcHM/LmNhcGFjaXR5UHJvdmlkZXIpIHtcbiAgICAgIGlmIChwcm9wcz8ubWluSW5zdGFuY2VzIHx8IHByb3BzPy5tYXhJbnN0YW5jZXMgfHwgcHJvcHM/Lmluc3RhbmNlVHlwZSB8fCBwcm9wcz8uc3RvcmFnZVNpemUgfHwgcHJvcHM/LnNwb3QgfHwgcHJvcHM/LnNwb3RNYXhQcmljZSkge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnV2hlbiB1c2luZyBhIGN1c3RvbSBjYXBhY2l0eSBwcm92aWRlciwgbWluSW5zdGFuY2VzLCBtYXhJbnN0YW5jZXMsIGluc3RhbmNlVHlwZSwgc3RvcmFnZVNpemUsIHNwb3QsIGFuZCBzcG90TWF4UHJpY2Ugd2lsbCBiZSBpZ25vcmVkLicpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmNhcGFjaXR5UHJvdmlkZXIgPSBwcm9wcy5jYXBhY2l0eVByb3ZpZGVyO1xuICAgICAgdGhpcy53YXJuT25Db250YWluZXJJbWRzQWNjZXNzKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHNwb3QgPSBwcm9wcz8uc3BvdCA/PyBwcm9wcz8uc3BvdE1heFByaWNlICE9PSB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGxhdW5jaFRlbXBsYXRlID0gbmV3IGVjMi5MYXVuY2hUZW1wbGF0ZSh0aGlzLCAnTGF1bmNoIFRlbXBsYXRlJywge1xuICAgICAgICBtYWNoaW5lSW1hZ2U6IHRoaXMuZGVmYXVsdENsdXN0ZXJJbnN0YW5jZUFtaSgpLFxuICAgICAgICBpbnN0YW5jZVR5cGU6IHByb3BzPy5pbnN0YW5jZVR5cGUgPz8gdGhpcy5kZWZhdWx0Q2x1c3Rlckluc3RhbmNlVHlwZSgpLFxuICAgICAgICBibG9ja0RldmljZXM6IChwcm9wcz8uc3RvcmFnZVNpemUgfHwgcHJvcHM/LnN0b3JhZ2VPcHRpb25zKSA/IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBkZXZpY2VOYW1lOiBhbWlSb290RGV2aWNlKHRoaXMsIHRoaXMuZGVmYXVsdENsdXN0ZXJJbnN0YW5jZUFtaSgpLmdldEltYWdlKHRoaXMpLmltYWdlSWQpLnJlZixcbiAgICAgICAgICAgIHZvbHVtZToge1xuICAgICAgICAgICAgICBlYnNEZXZpY2U6IHtcbiAgICAgICAgICAgICAgICBkZWxldGVPblRlcm1pbmF0aW9uOiB0cnVlLFxuICAgICAgICAgICAgICAgIHZvbHVtZVNpemU6IHByb3BzPy5zdG9yYWdlU2l6ZT8udG9HaWJpYnl0ZXMoKSA/PyAzMCxcbiAgICAgICAgICAgICAgICB2b2x1bWVUeXBlOiBwcm9wcz8uc3RvcmFnZU9wdGlvbnM/LnZvbHVtZVR5cGUsXG4gICAgICAgICAgICAgICAgaW9wczogcHJvcHM/LnN0b3JhZ2VPcHRpb25zPy5pb3BzLFxuICAgICAgICAgICAgICAgIHRocm91Z2hwdXQ6IHByb3BzPy5zdG9yYWdlT3B0aW9ucz8udGhyb3VnaHB1dCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSA6IHVuZGVmaW5lZCxcbiAgICAgICAgc3BvdE9wdGlvbnM6IHNwb3QgPyB7XG4gICAgICAgICAgcmVxdWVzdFR5cGU6IGVjMi5TcG90UmVxdWVzdFR5cGUuT05FX1RJTUUsXG4gICAgICAgICAgbWF4UHJpY2U6IHByb3BzPy5zcG90TWF4UHJpY2UgPyBwYXJzZUZsb2F0KHByb3BzPy5zcG90TWF4UHJpY2UpIDogdW5kZWZpbmVkLFxuICAgICAgICB9IDogdW5kZWZpbmVkLFxuICAgICAgICByZXF1aXJlSW1kc3YyOiB0cnVlLFxuICAgICAgICAvLyBjb250YWluZXJzIG9uIHRoZSBicmlkZ2UgbmV0d29yayBhcmUgb25lIGhvcCBhd2F5LCBzbyB0aGlzIGtlZXBzIGpvYnMgZnJvbSByZWFjaGluZyBJTURTIGFuZCB0YWtpbmcgdGhlIGluc3RhbmNlIHJvbGUuXG4gICAgICAgIC8vIHRhc2tzIGdldCB0aGVpciBvd24gcm9sZSBmcm9tIHRoZSBFQ1MgYWdlbnQgZW5kcG9pbnQsIHdoaWNoIHRoaXMgZG9lc24ndCBhZmZlY3QuIHNvbWUgQU1JcywgbGlrZSBBTDIwMjMsIGRlZmF1bHQgdG8gMi5cbiAgICAgICAgaHR0cFB1dFJlc3BvbnNlSG9wTGltaXQ6IDEsXG4gICAgICAgIHNlY3VyaXR5R3JvdXA6IHRoaXMuc2VjdXJpdHlHcm91cHNbMF0sXG4gICAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnTGF1bmNoIFRlbXBsYXRlIFJvbGUnLCB7XG4gICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2VjMi5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIH0pLFxuICAgICAgICB1c2VyRGF0YTogZWMyLlVzZXJEYXRhLmZvck9wZXJhdGluZ1N5c3RlbShpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSA/IGVjMi5PcGVyYXRpbmdTeXN0ZW1UeXBlLldJTkRPV1MgOiBlYzIuT3BlcmF0aW5nU3lzdGVtVHlwZS5MSU5VWCksXG4gICAgICB9KTtcbiAgICAgIHRoaXMuc2VjdXJpdHlHcm91cHMuc2xpY2UoMSkubWFwKHNnID0+IGxhdW5jaFRlbXBsYXRlLmNvbm5lY3Rpb25zLmFkZFNlY3VyaXR5R3JvdXAoc2cpKTtcblxuICAgICAgY29uc3QgYXV0b1NjYWxpbmdHcm91cCA9IG5ldyBhdXRvc2NhbGluZy5BdXRvU2NhbGluZ0dyb3VwKHRoaXMsICdBdXRvIFNjYWxpbmcgR3JvdXAnLCB7XG4gICAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICAgIGxhdW5jaFRlbXBsYXRlLFxuICAgICAgICB2cGNTdWJuZXRzOiB0aGlzLnN1Ym5ldFNlbGVjdGlvbixcbiAgICAgICAgbWluQ2FwYWNpdHk6IHByb3BzPy5taW5JbnN0YW5jZXMgPz8gMCxcbiAgICAgICAgbWF4Q2FwYWNpdHk6IHByb3BzPy5tYXhJbnN0YW5jZXMgPz8gNSxcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLmNhcGFjaXR5UHJvdmlkZXIgPSBwcm9wcz8uY2FwYWNpdHlQcm92aWRlciA/PyBuZXcgZWNzLkFzZ0NhcGFjaXR5UHJvdmlkZXIodGhpcywgJ0NhcGFjaXR5IFByb3ZpZGVyJywge1xuICAgICAgICBhdXRvU2NhbGluZ0dyb3VwLFxuICAgICAgICBzcG90SW5zdGFuY2VEcmFpbmluZzogZmFsc2UsIC8vIHdhc3RlIG9mIG1vbmV5IHRvIHJlc3RhcnQgam9icyBhcyB0aGUgcmVzdGFydGVkIGpvYiB3b24ndCBoYXZlIGEgdG9rZW5cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMuY2FwYWNpdHlQcm92aWRlci5hdXRvU2NhbGluZ0dyb3VwLmFkZFVzZXJEYXRhKFxuICAgICAgLy8gd2UgZG9uJ3QgZXhpdCBvbiBlcnJvcnMgYmVjYXVzZSBhbGwgb2YgdGhlc2UgY29tbWFuZHMgYXJlIG9wdGlvbmFsXG4gICAgICAuLi50aGlzLmxvZ2luQ29tbWFuZHMoKSxcbiAgICAgIHRoaXMucHVsbENvbW1hbmQoKSxcbiAgICAgIC4uLnRoaXMuZWNzU2V0dGluZ3NDb21tYW5kcygpLFxuICAgICk7XG4gICAgdGhpcy5jYXBhY2l0eVByb3ZpZGVyLmF1dG9TY2FsaW5nR3JvdXAucm9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShNSU5JTUFMX0VDMl9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQpO1xuICAgIGltYWdlLmltYWdlUmVwb3NpdG9yeS5ncmFudFB1bGwodGhpcy5jYXBhY2l0eVByb3ZpZGVyLmF1dG9TY2FsaW5nR3JvdXApO1xuXG4gICAgdGhpcy5jbHVzdGVyLmFkZEFzZ0NhcGFjaXR5UHJvdmlkZXIoXG4gICAgICB0aGlzLmNhcGFjaXR5UHJvdmlkZXIsXG4gICAgICB7XG4gICAgICAgIHNwb3RJbnN0YW5jZURyYWluaW5nOiBmYWxzZSxcbiAgICAgICAgbWFjaGluZUltYWdlVHlwZTogTWFjaGluZUltYWdlVHlwZS5BTUFaT05fTElOVVhfMixcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMubG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnbG9ncycsIHtcbiAgICAgIHJldGVudGlvbjogcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIHRoaXMuZGluZCA9IChwcm9wcz8uZG9ja2VySW5Eb2NrZXIgPz8gdHJ1ZSkgJiYgIWltYWdlLm9zLmlzKE9zLldJTkRPV1MpO1xuXG4gICAgdGhpcy50YXNrID0gbmV3IGVjcy5FYzJUYXNrRGVmaW5pdGlvbih0aGlzLCAndGFzaycpO1xuICAgIHRoaXMuY29udGFpbmVyID0gdGhpcy50YXNrLmFkZENvbnRhaW5lcihcbiAgICAgICdydW5uZXInLFxuICAgICAge1xuICAgICAgICBpbWFnZTogZWNzLkFzc2V0SW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LCBpbWFnZS5pbWFnZVRhZyksXG4gICAgICAgIGNwdTogcHJvcHM/LmNwdSA/PyAxMDI0LFxuICAgICAgICBtZW1vcnlMaW1pdE1pQjogcHJvcHM/Lm1lbW9yeUxpbWl0TWlCID8/IChwcm9wcz8ubWVtb3J5UmVzZXJ2YXRpb25NaUIgPyB1bmRlZmluZWQgOiAzNTAwKSxcbiAgICAgICAgbWVtb3J5UmVzZXJ2YXRpb25NaUI6IHByb3BzPy5tZW1vcnlSZXNlcnZhdGlvbk1pQixcbiAgICAgICAgZ3B1Q291bnQ6IHRoaXMuZ3B1Q291bnQgPiAwID8gdGhpcy5ncHVDb3VudCA6IHVuZGVmaW5lZCxcbiAgICAgICAgbG9nZ2luZzogZWNzLkF3c0xvZ0RyaXZlci5hd3NMb2dzKHtcbiAgICAgICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cCxcbiAgICAgICAgICBzdHJlYW1QcmVmaXg6ICdydW5uZXInLFxuICAgICAgICB9KSxcbiAgICAgICAgY29tbWFuZDogZWNzUnVuQ29tbWFuZCh0aGlzLmltYWdlLm9zLCB0aGlzLmRpbmQpLFxuICAgICAgICB1c2VyOiBpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSA/IHVuZGVmaW5lZCA6ICdydW5uZXInLFxuICAgICAgICBwcml2aWxlZ2VkOiB0aGlzLmRpbmQsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICB0aGlzLmdyYW50UHJpbmNpcGFsID0gdGhpcy50YXNrLnRhc2tSb2xlO1xuXG4gICAgLy8gcGVybWlzc2lvbnMgZm9yIFNTTSBTZXNzaW9uIE1hbmFnZXJcbiAgICB0aGlzLnRhc2sudGFza1JvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koTUlOSU1BTF9FQ1NfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UKTtcblxuICAgIGlmIChwcm9wcz8uYXNzaWduUHVibGljSXApIHtcbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdhc3NpZ25QdWJsaWNJcCBpcyBzZXQgdG8gYHRydWVgLCBidXQgRUNTIHRhc2tzIG9uIEVDMiBydW4gdXNpbmcgYnJpZGdlIG1vZGUuIEluIGJyaWRnZSBtb2RlLCB0aGUgdGFzayAnICtcbiAgICAgICAgJ3VzZXMgdGhlIGhvc3QgaW5zdGFuY2VcXCdzIG5ldHdvcmsgaW50ZXJmYWNlIGFuZCBJUCBhZGRyZXNzLiBUaGUgdGFzayB3aWxsIG5vdCBoYXZlIGl0cyBvd24gcHVibGljIElQIGFkZHJlc3MuIEVuc3VyZSB0aGF0IHRoZSBob3N0ICcgK1xuICAgICAgICAnaW5zdGFuY2VzIGhhdmUgaW50ZXJuZXQgYWNjZXNzIChlLmcuLCB0aHJvdWdoIGEgTkFUIGdhdGV3YXkpIGlmIHRoZSB0YXNrcyBuZWVkIHRvIGFjY2VzcyBleHRlcm5hbCByZXNvdXJjZXMuIFBsZWFzZSBvcGVuIGEgR2l0SHViIGlzc3VlICcgK1xuICAgICAgICAnaWYgeW91IG5lZWQgVlBDIG5ldHdvcmtpbmcgbW9kZSBmb3IgRUNTLicpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZGVmYXVsdENsdXN0ZXJJbnN0YW5jZVR5cGUoKSB7XG4gICAgaWYgKHRoaXMuZ3B1Q291bnQgPiAwKSB7XG4gICAgICBpZiAoIXRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRUNTIEdQVSBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgeDY0IGFyY2hpdGVjdHVyZS4gR1BVIGluc3RhbmNlcyAoZzRkbiwgZzUsIHAzLCBldGMuKSBhcmUgeDY0IG9ubHkuJyk7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5ncHVDb3VudCA8PSAxKSB7XG4gICAgICAgIHJldHVybiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLkc0RE4sIGVjMi5JbnN0YW5jZVNpemUuWExBUkdFKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmdwdUNvdW50IDw9IDQpIHtcbiAgICAgICAgcmV0dXJuIGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuRzRETiwgZWMyLkluc3RhbmNlU2l6ZS5YTEFSR0UxMik7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5ncHVDb3VudCA8PSA4KSB7XG4gICAgICAgIHJldHVybiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlAzLCBlYzIuSW5zdGFuY2VTaXplLlhMQVJHRTE2KTtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgR1BVIGNvdW50OiAke3RoaXMuZ3B1Q291bnR9YCk7XG4gICAgfVxuICAgIGlmICh0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgcmV0dXJuIGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuTTZJLCBlYzIuSW5zdGFuY2VTaXplLkxBUkdFKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgIHJldHVybiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLk02RywgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSk7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGZpbmQgaW5zdGFuY2UgdHlwZSBmb3IgRUNTIGluc3RhbmNlcyBmb3IgJHt0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5uYW1lfWApO1xuICB9XG5cbiAgLyoqXG4gICAqIFdhcm4gd2hlbiB3ZSBjYW4ndCBjb25maXJtIHRoZSBjdXN0b20gY2FwYWNpdHkgcHJvdmlkZXIga2VlcHMgY29udGFpbmVycyBhd2F5IGZyb20gSU1EUy4gT25seSBsYXVuY2ggdGVtcGxhdGVzIGFuZCBsYXVuY2ggY29uZmlndXJhdGlvbnNcbiAgICogY3JlYXRlZCBpbiB0aGlzIGFwcCBjYW4gYmUgY2hlY2tlZC5cbiAgICovXG4gIHByaXZhdGUgd2Fybk9uQ29udGFpbmVySW1kc0FjY2VzcygpIHtcbiAgICAvLyB0aGUgY2ZuIHByb3BlcnRpZXMgY2FuIGFsc28gYmUgSVJlc29sdmFibGUsIGJ1dCB0aGUgTDIgY29uc3RydWN0cyBhbHdheXMgc2V0IHBsYWluIG9iamVjdHMuIGFueXRoaW5nIGVsc2UgY2FuJ3QgYmUgY29uZmlybWVkIGFuZCB3YXJucy5cbiAgICBjb25zdCBjZm5Bc2cgPSB0aGlzLmNhcGFjaXR5UHJvdmlkZXIuYXV0b1NjYWxpbmdHcm91cC5ub2RlLmRlZmF1bHRDaGlsZCBhcyBhbnk7XG4gICAgY29uc3QgdGFyZ2V0ID0gKGlkOiBhbnkpID0+IHtcbiAgICAgIGNvbnN0IHRva2VuID0gdHlwZW9mIGlkID09PSAnc3RyaW5nJyA/IGNkay5Ub2tlbml6YXRpb24ucmV2ZXJzZVN0cmluZyhpZCkuZmlyc3RUb2tlbiA6IHVuZGVmaW5lZDtcbiAgICAgIHJldHVybiB0b2tlbiBpbnN0YW5jZW9mIGNkay5SZWZlcmVuY2UgPyB0b2tlbi50YXJnZXQgOiB1bmRlZmluZWQ7XG4gICAgfTtcblxuICAgIGNvbnN0IGxhdW5jaFRlbXBsYXRlU3BlYyA9IGNmbkFzZy5sYXVuY2hUZW1wbGF0ZSA/PyBjZm5Bc2cubWl4ZWRJbnN0YW5jZXNQb2xpY3k/LmxhdW5jaFRlbXBsYXRlPy5sYXVuY2hUZW1wbGF0ZVNwZWNpZmljYXRpb247XG4gICAgY29uc3QgbGF1bmNoVGVtcGxhdGUgPSB0YXJnZXQobGF1bmNoVGVtcGxhdGVTcGVjPy5sYXVuY2hUZW1wbGF0ZUlkID8/IGxhdW5jaFRlbXBsYXRlU3BlYz8ubGF1bmNoVGVtcGxhdGVOYW1lKTtcbiAgICBjb25zdCBsYXVuY2hDb25maWd1cmF0aW9uID0gdGFyZ2V0KGNmbkFzZy5sYXVuY2hDb25maWd1cmF0aW9uTmFtZSk7XG4gICAgLy8gb25seSByZXNvbHZlIHRoZSBtZXRhZGF0YSBvcHRpb25zLCBhbmQgaW4gdGhlIHN0YWNrIHRoYXQgb3ducyB0aGVtLCBzbyB3ZSBkb24ndCB0b3VjaCBhbnl0aGluZyBlbHNlIHRoZSB1c2VyIHB1dCBpbiB0aGVyZVxuICAgIGxldCBtZXRhZGF0YU9wdGlvbnM6IGFueTtcbiAgICB0cnkge1xuICAgICAgaWYgKGxhdW5jaFRlbXBsYXRlIGluc3RhbmNlb2YgZWMyLkNmbkxhdW5jaFRlbXBsYXRlKSB7XG4gICAgICAgIG1ldGFkYXRhT3B0aW9ucyA9IGNkay5TdGFjay5vZihsYXVuY2hUZW1wbGF0ZSkucmVzb2x2ZSgobGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVEYXRhIGFzIGFueSk/Lm1ldGFkYXRhT3B0aW9ucyk7XG4gICAgICB9IGVsc2UgaWYgKGxhdW5jaENvbmZpZ3VyYXRpb24gaW5zdGFuY2VvZiBhdXRvc2NhbGluZy5DZm5MYXVuY2hDb25maWd1cmF0aW9uKSB7XG4gICAgICAgIG1ldGFkYXRhT3B0aW9ucyA9IGNkay5TdGFjay5vZihsYXVuY2hDb25maWd1cmF0aW9uKS5yZXNvbHZlKGxhdW5jaENvbmZpZ3VyYXRpb24ubWV0YWRhdGFPcHRpb25zKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGNhbid0IHRlbGwsIHNvIHdhcm4gYmVsb3dcbiAgICB9XG5cbiAgICBpZiAobWV0YWRhdGFPcHRpb25zPy5odHRwVG9rZW5zICE9PSAncmVxdWlyZWQnIHx8IG1ldGFkYXRhT3B0aW9ucz8uaHR0cFB1dFJlc3BvbnNlSG9wTGltaXQgIT09IDEpIHtcbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nVjIoXG4gICAgICAgICdAY2xvdWRzbm9ya2VsL2Nkay1naXRodWItcnVubmVyczplY3NDYXBhY2l0eVByb3ZpZGVySW1kcycsXG4gICAgICAgICdVbmFibGUgdG8gY29uZmlybSB0aGUgY3VzdG9tIGNhcGFjaXR5IHByb3ZpZGVyIGxhdW5jaCB0ZW1wbGF0ZSByZXF1aXJlcyBJTURTdjIgd2l0aCBhIGhvcCBsaW1pdCBvZiAxLiAnICtcbiAgICAgICAgJ1dpdGhvdXQgaXQsIGpvYnMgY2FuIHJlYWNoIElNRFMgYW5kIHRha2UgdGhlIGluc3RhbmNlIHJvbGUuIFNldCBgcmVxdWlyZUltZHN2MjogdHJ1ZWAgYW5kIGBodHRwUHV0UmVzcG9uc2VIb3BMaW1pdDogMWAgb24gdGhlIGxhdW5jaCB0ZW1wbGF0ZS4nLFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGRlZmF1bHRDbHVzdGVySW5zdGFuY2VBbWkoKSB7XG4gICAgbGV0IG9zID0gZWMyLk9wZXJhdGluZ1N5c3RlbVR5cGUuTElOVVg7XG4gICAgbGV0IHNzbVBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICAgIGlmICh0aGlzLmltYWdlLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgIGlmICh0aGlzLmdwdUNvdW50ID4gMCAmJiB0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICBzc21QYXRoID0gJy9hd3Mvc2VydmljZS9lY3Mvb3B0aW1pemVkLWFtaS9hbWF6b24tbGludXgtMjAyMy9ncHUvcmVjb21tZW5kZWQvaW1hZ2VfaWQnO1xuICAgICAgfSBlbHNlIGlmICh0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICBzc21QYXRoID0gJy9hd3Mvc2VydmljZS9lY3Mvb3B0aW1pemVkLWFtaS9hbWF6b24tbGludXgtMjAyMy9yZWNvbW1lbmRlZC9pbWFnZV9pZCc7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgICAgc3NtUGF0aCA9ICcvYXdzL3NlcnZpY2UvZWNzL29wdGltaXplZC1hbWkvYW1hem9uLWxpbnV4LTIwMjMvYXJtNjQvcmVjb21tZW5kZWQvaW1hZ2VfaWQnO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmltYWdlLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICBvcyA9IGVjMi5PcGVyYXRpbmdTeXN0ZW1UeXBlLldJTkRPV1M7XG4gICAgICBzc21QYXRoID0gJy9hd3Mvc2VydmljZS9hbWktd2luZG93cy1sYXRlc3QvV2luZG93c19TZXJ2ZXItMjAxOS1FbmdsaXNoLUZ1bGwtRUNTX09wdGltaXplZC9pbWFnZV9pZCc7XG4gICAgfVxuXG4gICAgaWYgKCFzc21QYXRoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBmaW5kIEFNSSBmb3IgRUNTIGluc3RhbmNlcyBmb3IgJHt0aGlzLmltYWdlLm9zLm5hbWV9LyR7dGhpcy5pbWFnZS5hcmNoaXRlY3R1cmUubmFtZX0gKGdwdUNvdW50PSR7dGhpcy5ncHVDb3VudH0pYCk7XG4gICAgfVxuXG4gICAgLy8gcmVzb2x2ZWQgYnkgRUMyIG9uIGV2ZXJ5IGxhdW5jaCwgc28gbmV3IGluc3RhbmNlcyBhbHdheXMgZ2V0IHRoZSBsYXRlc3QgQU1JIHdpdGhvdXQgcmVkZXBsb3lpbmdcbiAgICByZXR1cm4gZWMyLk1hY2hpbmVJbWFnZS5yZXNvbHZlU3NtUGFyYW1ldGVyQXRMYXVuY2goc3NtUGF0aCwgeyBvcyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcHVsbENvbW1hbmQoKSB7XG4gICAgaWYgKHRoaXMuaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHJldHVybiBgU3RhcnQtSm9iIC1TY3JpcHRCbG9jayB7IGRvY2tlciBwdWxsICR7dGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaX06JHt0aGlzLmltYWdlLmltYWdlVGFnfSB9YDtcbiAgICB9XG4gICAgcmV0dXJuIGBkb2NrZXIgcHVsbCAke3RoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OiR7dGhpcy5pbWFnZS5pbWFnZVRhZ30gJmA7XG4gIH1cblxuICBwcml2YXRlIGxvZ2luQ29tbWFuZHMoKSB7XG4gICAgY29uc3QgdGhpc1N0YWNrID0gU3RhY2sub2YodGhpcyk7XG4gICAgaWYgKHRoaXMuaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHJldHVybiBbYChHZXQtRUNSTG9naW5Db21tYW5kKS5QYXNzd29yZCB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluICR7dGhpc1N0YWNrLmFjY291bnR9LmRrci5lY3IuJHt0aGlzU3RhY2sucmVnaW9ufS5hbWF6b25hd3MuY29tYF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICAneXVtIGluc3RhbGwgLXkgYXdzY2xpIHx8IGRuZiBpbnN0YWxsIC15IGF3c2NsaScsXG4gICAgICBgYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gJHt0aGlzU3RhY2sucmVnaW9ufSB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluICR7dGhpc1N0YWNrLmFjY291bnR9LmRrci5lY3IuJHt0aGlzU3RhY2sucmVnaW9ufS5hbWF6b25hd3MuY29tYCxcbiAgICBdO1xuICB9XG5cbiAgcHJpdmF0ZSBlY3NTZXR0aW5nc0NvbW1hbmRzKCkge1xuICAgIC8vIGRvbid0IGxldCBFQ1MgYWNjdW11bGF0ZSB0b28gbWFueSBzdG9wcGVkIHRhc2tzIHRoYXQgY2FuIGVuZCB1cCB2ZXJ5IGJpZyBpbiBvdXIgY2FzZVxuICAgIC8vIHRoZSBkZWZhdWx0IGlzIDEwbSBkdXJhdGlvbiB3aXRoIDFoIGppdHRlciB3aGljaCBjYW4gZW5kIHVwIHdpdGggMWgxMG0gZGVsYXkgZm9yIGNsZWFuaW5nIHVwIHN0b3BwZWQgdGFza3NcbiAgICBpZiAodGhpcy5pbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgJ1tFbnZpcm9ubWVudF06OlNldEVudmlyb25tZW50VmFyaWFibGUoXCJFQ1NfRU5HSU5FX1RBU0tfQ0xFQU5VUF9XQUlUX0RVUkFUSU9OXCIsIFwiNXNcIiwgXCJNYWNoaW5lXCIpJyxcbiAgICAgICAgJ1tFbnZpcm9ubWVudF06OlNldEVudmlyb25tZW50VmFyaWFibGUoXCJFQ1NfRU5HSU5FX1RBU0tfQ0xFQU5VUF9XQUlUX0RVUkFUSU9OX0pJVFRFUlwiLCBcIjVzXCIsIFwiTWFjaGluZVwiKScsXG4gICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9pc3N1ZXMvMzY4MDVcbiAgICAgICAgJ1tFbnZpcm9ubWVudF06OlNldEVudmlyb25tZW50VmFyaWFibGUoXCJFQ1NfRU5BQkxFX1RBU0tfSUFNX1JPTEVcIiwgXCJ0cnVlXCIsIFwiTWFjaGluZVwiKScsXG4gICAgICAgICcoR2V0LUNvbnRlbnQgXCJDOlxcXFxQcm9ncmFtIEZpbGVzXFxcXFdpbmRvd3NQb3dlclNoZWxsXFxcXE1vZHVsZXNcXFxcRUNTVG9vbHNcXFxcRUNTVG9vbHMucHNtMVwiKS5SZXBsYWNlKFxcJ2lmICgkRW5hYmxlVGFza0lBTVJvbGUpIHtcXCcsIFxcJyRFbmFibGVUYXNrSUFNUm9sZSA9ICR0cnVlOyBpZiAoJEVuYWJsZVRhc2tJQU1Sb2xlKSB7XFwnKSB8IFNldC1Db250ZW50IFwiQzpcXFxcUHJvZ3JhbSBGaWxlc1xcXFxXaW5kb3dzUG93ZXJTaGVsbFxcXFxNb2R1bGVzXFxcXEVDU1Rvb2xzXFxcXEVDU1Rvb2xzLnBzbTFcIiAtRm9yY2UnLFxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgICdlY2hvIEVDU19FTkdJTkVfVEFTS19DTEVBTlVQX1dBSVRfRFVSQVRJT049NXMgPj4gL2V0Yy9lY3MvZWNzLmNvbmZpZycsXG4gICAgICAnZWNobyBFQ1NfRU5HSU5FX1RBU0tfQ0xFQU5VUF9XQUlUX0RVUkFUSU9OX0pJVFRFUj01cyA+PiAvZXRjL2Vjcy9lY3MuY29uZmlnJyxcbiAgICBdO1xuICB9XG5cbiAgLyoqXG4gICAqIENvbmZpZyBmb3IgdGhlIHNoYXJlZCBFQ1MgZnJhZ21lbnQuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgX3J1bm5lckNvbmZpZygpOiBFY3NSdW5uZXJDb25maWcge1xuICAgIC8vIHRoZXNlIGFyZSBzdGF0aWMgcGVyIHByb3ZpZGVyLCBzbyB3ZSByZW5kZXIgdGhlbSB0aGUgd2F5IGVjczpydW5UYXNrIHdhbnRzIHRoZW0gcmlnaHQgaGVyZVxuICAgIC8vIHRoYXQgbWVhbnMgdXBwZXJjYXNpbmcgdGhlIGZpcnN0IGxldHRlciBvZiBldmVyeSBrZXksIGV4YWN0bHkgbGlrZSBFY3NFYzJMYXVuY2hUYXJnZXQgZG9lc1xuICAgIGNvbnN0IHVwcGVyY2FzZUtleXMgPSAob2JqOiBSZWNvcmQ8c3RyaW5nLCBhbnk+KSA9PiB7XG4gICAgICBjb25zdCByZXQ6IFJlY29yZDxzdHJpbmcsIGFueT4gPSB7fTtcbiAgICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKG9iaikpIHtcbiAgICAgICAgcmV0W2tleS5zbGljZSgwLCAxKS50b1VwcGVyQ2FzZSgpICsga2V5LnNsaWNlKDEpXSA9IG9ialtrZXldO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJldDtcbiAgICB9O1xuICAgIGNvbnN0IHBsYWNlbWVudFN0cmF0ZWdpZXMgPSAodGhpcy5wbGFjZW1lbnRTdHJhdGVnaWVzID8/IFtdKS5mbGF0TWFwKHMgPT4gcy50b0pzb24oKS5tYXAodXBwZXJjYXNlS2V5cykpO1xuICAgIGNvbnN0IHBsYWNlbWVudENvbnN0cmFpbnRzID0gKHRoaXMucGxhY2VtZW50Q29uc3RyYWludHMgPz8gW10pLmZsYXRNYXAoYyA9PiBjLnRvSnNvbigpLm1hcCh1cHBlcmNhc2VLZXlzKSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgZmFtaWx5OiBFY3NSdW5uZXJQcm92aWRlci5fRkFNSUxZLFxuICAgICAgcHJvdmlkZXI6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgY2x1c3RlckFybjogdGhpcy5jbHVzdGVyLmNsdXN0ZXJBcm4sXG4gICAgICB0YXNrRGVmaW5pdGlvbkZhbWlseTogdGhpcy50YXNrLmZhbWlseSxcbiAgICAgIGNvbnRhaW5lck5hbWU6IHRoaXMuY29udGFpbmVyLmNvbnRhaW5lck5hbWUsXG4gICAgICBjYXBhY2l0eVByb3ZpZGVyTmFtZTogdGhpcy5jYXBhY2l0eVByb3ZpZGVyLmNhcGFjaXR5UHJvdmlkZXJOYW1lLFxuICAgICAgZW5hYmxlRXhlY3V0ZUNvbW1hbmQ6IHRoaXMuaW1hZ2Uub3MuaXNJbihPcy5fQUxMX0xJTlVYX1ZFUlNJT05TKSxcbiAgICAgIC8vIGFsd2F5cyBhbiBhcnJheSwgZXZlbiBhbiBlbXB0eSBvbmVcbiAgICAgIC8vIGEgbWlzc2luZyBrZXkgbWFrZXMgdGhlIEpTT05hdGEgcmVzb2x2ZSB0byBub3RoaW5nIGFuZCB0aGUgc3RhdGUgZmFpbHMgd2l0aCBTdGF0ZXMuUXVlcnlFdmFsdWF0aW9uRXJyb3JcbiAgICAgIHBsYWNlbWVudFN0cmF0ZWdpZXMsXG4gICAgICBwbGFjZW1lbnRDb25zdHJhaW50cyxcbiAgICAgIC8vIHRoZSBjbGVhbmVkIHVwIHByb3ZpZGVyIHBhdGggcGx1cyB3aGF0ZXZlciB0aGUgdXNlciBhc2tlZCBmb3JcbiAgICAgIC8vIHNlZSBzZWxlY3RQcm92aWRlclBhcmFtcygpIGluIHJ1bm5lci50cywgd2hpY2ggbWVyZ2VzIHRoZSByZXN0IG9mIHRoZSBzdGFuZGFyZCBydW5uZXIgdGFncyBpbiBhdCBydW50aW1lXG4gICAgICB0YWdzOiBPYmplY3QuZW50cmllcyh0aGlzLnRhZ3MpLm1hcCgoW0tleSwgVmFsdWVdKSA9PiAoeyBLZXksIFZhbHVlIH0pKSxcbiAgICAgIGNsZWFuTGFiZWxzOiB0cnVlLFxuICAgICAgcnVubmVyR3JvdXA6IHRoaXMuZ3JvdXAgPz8gJycsXG4gICAgICBkZWZhdWx0TGFiZWxzOiBydW5uZXJEZWZhdWx0TGFiZWxzKHRoaXMuaW1hZ2Uub3MsIHRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLCB0aGlzLmRlZmF1bHRMYWJlbHMpLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lUm9sZTogaWFtLklHcmFudGFibGUpIHtcbiAgICBncmFudEVjc1J1blRhc2sodGhpcywgc3RhdGVNYWNoaW5lUm9sZSwgdGhpcy50YXNrKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9zdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1cyB7XG4gICAgdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkuZ3JhbnQoc3RhdHVzRnVuY3Rpb25Sb2xlLCAnZWNyOkRlc2NyaWJlSW1hZ2VzJyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgbGFiZWxzOiB0aGlzLmxhYmVscyxcbiAgICAgIGNvbnN0cnVjdFBhdGg6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgdnBjQXJuOiB0aGlzLnZwYz8udnBjQXJuLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICByb2xlQXJuOiB0aGlzLnRhc2sudGFza1JvbGUucm9sZUFybixcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGltYWdlOiB7XG4gICAgICAgIGltYWdlUmVwb3NpdG9yeTogdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgaW1hZ2VUYWc6IHRoaXMuaW1hZ2UuaW1hZ2VUYWcsXG4gICAgICAgIGltYWdlQnVpbGRlckxvZ0dyb3VwOiB0aGlzLmltYWdlLmxvZ0dyb3VwPy5sb2dHcm91cE5hbWUsXG4gICAgICB9LFxuICAgIH07XG4gIH1cbn1cbiJdfQ==