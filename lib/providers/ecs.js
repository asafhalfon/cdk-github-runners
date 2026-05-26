"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EcsRunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const autoscaling = require("aws-cdk-lib/aws-autoscaling");
const aws_ecs_1 = require("aws-cdk-lib/aws-ecs");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_stepfunctions_1 = require("aws-cdk-lib/aws-stepfunctions");
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
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
class EcsRunnerProvider extends common_1.BaseProvider {
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
    constructor(scope, id, props) {
        super(scope, id, props);
        this.retryableErrors = [
            'Ecs.EcsException',
            'ECS.AmazonECSException',
            'Ecs.LimitExceededException',
            'Ecs.UpdateInProgressException',
        ];
        this.labels = props?.labels ?? ['ecs'];
        this.group = props?.group;
        this.defaultLabels = props?.defaultLabels ?? true;
        this.vpc = props?.vpc ?? aws_cdk_lib_1.aws_ec2.Vpc.fromLookup(this, 'default vpc', { isDefault: true });
        this.subnetSelection = props?.subnetSelection;
        this.securityGroups = props?.securityGroups ?? [new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, 'security group', { vpc: this.vpc })];
        this.connections = new aws_cdk_lib_1.aws_ec2.Connections({ securityGroups: this.securityGroups });
        this.assignPublicIp = props?.assignPublicIp ?? true;
        this.placementStrategies = props?.placementStrategies;
        this.placementConstraints = props?.placementConstraints;
        this.gpuCount = props?.gpu ?? 0;
        this.cluster = props?.cluster ? props.cluster : new aws_cdk_lib_1.aws_ecs.Cluster(this, 'cluster', {
            vpc: this.vpc,
            enableFargateCapacityProviders: false,
        });
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
    defaultClusterInstanceAmi() {
        let baseImage;
        let ssmPath;
        let found = false;
        if (this.image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS)) {
            if (this.gpuCount > 0 && this.image.architecture.is(common_1.Architecture.X86_64)) {
                baseImage = aws_cdk_lib_1.aws_ecs.EcsOptimizedImage.amazonLinux2023(aws_cdk_lib_1.aws_ecs.AmiHardwareType.GPU);
                ssmPath = '/aws/service/ecs/optimized-ami/amazon-linux-2023/gpu/recommended/image_id';
                found = true;
            }
            else if (this.image.architecture.is(common_1.Architecture.X86_64)) {
                baseImage = aws_cdk_lib_1.aws_ecs.EcsOptimizedImage.amazonLinux2023(aws_cdk_lib_1.aws_ecs.AmiHardwareType.STANDARD);
                ssmPath = '/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id';
                found = true;
            }
            else if (this.image.architecture.is(common_1.Architecture.ARM64)) {
                baseImage = aws_cdk_lib_1.aws_ecs.EcsOptimizedImage.amazonLinux2023(aws_cdk_lib_1.aws_ecs.AmiHardwareType.ARM);
                ssmPath = '/aws/service/ecs/optimized-ami/amazon-linux-2023/arm64/recommended/image_id';
                found = true;
            }
        }
        if (this.image.os.is(common_1.Os.WINDOWS)) {
            baseImage = aws_cdk_lib_1.aws_ecs.EcsOptimizedImage.windows(aws_cdk_lib_1.aws_ecs.WindowsOptimizedVersion.SERVER_2019);
            ssmPath = '/aws/service/ami-windows-latest/Windows_Server-2019-English-Full-ECS_Optimized/image_id';
            found = true;
        }
        if (!found) {
            throw new Error(`Unable to find AMI for ECS instances for ${this.image.os.name}/${this.image.architecture.name} (gpuCount=${this.gpuCount})`);
        }
        const image = {
            getImage(scope) {
                const baseImageRes = baseImage.getImage(scope);
                return {
                    imageId: `resolve:ssm:${ssmPath}`,
                    userData: baseImageRes.userData,
                    osType: baseImageRes.osType,
                };
            },
        };
        return image;
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
     * Generate step function task(s) to start a new runner.
     *
     * Called by GithubRunners and shouldn't be called manually.
     *
     * @param parameters workflow job details
     */
    getStepFunctionTask(parameters) {
        return new aws_cdk_lib_1.aws_stepfunctions_tasks.EcsRunTask(this, 'State', {
            stateName: (0, common_1.generateStateName)(this),
            integrationPattern: aws_stepfunctions_1.IntegrationPattern.RUN_JOB, // sync
            taskDefinition: this.task,
            cluster: this.cluster,
            launchTarget: new aws_cdk_lib_1.aws_stepfunctions_tasks.EcsEc2LaunchTarget({
                capacityProviderOptions: aws_cdk_lib_1.aws_stepfunctions_tasks.CapacityProviderOptions.custom([{
                        capacityProvider: this.capacityProvider.capacityProviderName,
                    }]),
                placementStrategies: this.placementStrategies,
                placementConstraints: this.placementConstraints,
            }),
            enableExecuteCommand: this.image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS),
            propagatedTagSource: aws_cdk_lib_1.aws_ecs.PropagatedTagSource.TASK_DEFINITION,
            assignPublicIp: this.assignPublicIp,
            containerOverrides: [
                {
                    containerDefinition: this.container,
                    environment: [
                        {
                            name: 'RUNNER_TOKEN',
                            value: parameters.runnerTokenPath,
                        },
                        {
                            name: 'JIT_CONFIG',
                            value: parameters.jitConfigPath,
                        },
                        {
                            name: 'RUNNER_NAME',
                            value: parameters.runnerNamePath,
                        },
                        {
                            name: 'RUNNER_LABEL',
                            value: parameters.labelsPath,
                        },
                        {
                            name: 'RUNNER_GROUP1',
                            value: this.group ? '--runnergroup' : '',
                        },
                        {
                            name: 'RUNNER_GROUP2',
                            value: this.group ? this.group : '',
                        },
                        {
                            name: 'DEFAULT_LABELS',
                            value: this.defaultLabels ? '' : '--no-default-labels',
                        },
                        {
                            name: 'GITHUB_DOMAIN',
                            value: parameters.githubDomainPath,
                        },
                        {
                            name: 'OWNER',
                            value: parameters.ownerPath,
                        },
                        {
                            name: 'REPO',
                            value: parameters.repoPath,
                        },
                        {
                            name: 'REGISTRATION_URL',
                            value: parameters.registrationUrl,
                        },
                    ],
                },
            ],
        });
    }
    grantStateMachine(_) {
    }
    status(statusFunctionRole) {
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
_a = JSII_RTTI_SYMBOL_1;
EcsRunnerProvider[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.EcsRunnerProvider", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9lY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxtQ0FBbUM7QUFDbkMsNkNBU3FCO0FBQ3JCLDJEQUEyRDtBQUMzRCxpREFBdUQ7QUFDdkQsbURBQXFEO0FBQ3JELHFFQUFtRTtBQUVuRSxxQ0Fha0I7QUFDbEIsdUNBQTBDO0FBQzFDLHNEQUEySDtBQUMzSCxvQ0FBOEg7QUFtTTlIOzs7Ozs7OztHQVFHO0FBQ0gsTUFBYSxpQkFBa0IsU0FBUSxxQkFBWTtJQUNqRDs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FpQkc7SUFDSSxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3RGLE9BQU8sbUNBQWtCLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDdkMsRUFBRSxFQUFFLFdBQUUsQ0FBQyxZQUFZO1lBQ25CLFlBQVksRUFBRSxxQkFBWSxDQUFDLE1BQU07WUFDakMsVUFBVSxFQUFFO2dCQUNWLHFDQUFvQixDQUFDLGdCQUFnQixFQUFFO2dCQUN2QyxxQ0FBb0IsQ0FBQyxVQUFVLEVBQUU7Z0JBQ2pDLHFDQUFvQixDQUFDLEdBQUcsRUFBRTtnQkFDMUIscUNBQW9CLENBQUMsU0FBUyxFQUFFO2dCQUNoQyxxQ0FBb0IsQ0FBQyxNQUFNLEVBQUU7Z0JBQzdCLHFDQUFvQixDQUFDLE1BQU0sRUFBRTtnQkFDN0IscUNBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxhQUFhLElBQUksc0JBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQzthQUNsRjtZQUNELEdBQUcsS0FBSztTQUNULENBQUMsQ0FBQztJQUNMLENBQUM7SUE0R0QsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE4QjtRQUN0RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQVJqQixvQkFBZSxH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LE1BQU07NEJBQ1osS0FBSyxFQUFFLFVBQVUsQ0FBQyxRQUFRO3lCQUMzQjt3QkFDRDs0QkFDRSxJQUFJLEVBQUUsa0JBQWtCOzRCQUN4QixLQUFLLEVBQUUsVUFBVSxDQUFDLGVBQWU7eUJBQ2xDO3FCQUNGO2lCQUNGO2FBQ0Y7U0FDRixDQUNGLENBQUM7SUFDSixDQUFDO0lBRUQsaUJBQWlCLENBQUMsQ0FBaUI7SUFDbkMsQ0FBQztJQUVELE1BQU0sQ0FBQyxrQkFBa0M7UUFDdkMsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsS0FBSyxDQUFDLGtCQUFrQixFQUFFLG9CQUFvQixDQUFDLENBQUM7UUFFM0UsT0FBTztZQUNMLElBQUksRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUk7WUFDM0IsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ25CLGFBQWEsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUk7WUFDN0IsTUFBTSxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsTUFBTTtZQUN4QixjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsZUFBZSxDQUFDO1lBQ2pFLE9BQU8sRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxPQUFPO1lBQ25DLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVk7WUFDcEMsS0FBSyxFQUFFO2dCQUNMLGVBQWUsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLGVBQWUsQ0FBQyxhQUFhO2dCQUN6RCxRQUFRLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRO2dCQUM3QixvQkFBb0IsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsRUFBRSxZQUFZO2FBQ3hEO1NBQ0YsQ0FBQztJQUNKLENBQUM7O0FBemVILDhDQTBlQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2VjcyBhcyBlY3MsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3Nfc3RlcGZ1bmN0aW9ucyBhcyBzdGVwZnVuY3Rpb25zLFxuICBhd3Nfc3RlcGZ1bmN0aW9uc190YXNrcyBhcyBzdGVwZnVuY3Rpb25zX3Rhc2tzLFxuICBSZW1vdmFsUG9saWN5LFxuICBTdGFjayxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgYXV0b3NjYWxpbmcgZnJvbSAnYXdzLWNkay1saWIvYXdzLWF1dG9zY2FsaW5nJztcbmltcG9ydCB7IE1hY2hpbmVJbWFnZVR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNzJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBJbnRlZ3JhdGlvblBhdHRlcm4gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gIGFtaVJvb3REZXZpY2UsXG4gIEFyY2hpdGVjdHVyZSxcbiAgQmFzZVByb3ZpZGVyLFxuICBnZW5lcmF0ZVN0YXRlTmFtZSxcbiAgSVJ1bm5lclByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXJTdGF0dXMsXG4gIElSdW5uZXJSdW50aW1lUGFyYW1ldGVycyxcbiAgT3MsXG4gIFJ1bm5lckltYWdlLFxuICBSdW5uZXJQcm92aWRlclByb3BzLFxuICBSdW5uZXJWZXJzaW9uLFxuICBTdG9yYWdlT3B0aW9ucyxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgZWNzUnVuQ29tbWFuZCB9IGZyb20gJy4vZmFyZ2F0ZSc7XG5pbXBvcnQgeyBJUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXIsIFJ1bm5lckltYWdlQnVpbGRlclByb3BzLCBSdW5uZXJJbWFnZUNvbXBvbmVudCB9IGZyb20gJy4uL2ltYWdlLWJ1aWxkZXJzJztcbmltcG9ydCB7IE1JTklNQUxfRUMyX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCwgTUlOSU1BTF9FQ1NfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIEVjc1J1bm5lclByb3ZpZGVyLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVjc1J1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgRG9ja2VyIGltYWdlcyBjb250YWluaW5nIEdpdEh1YiBSdW5uZXIgYW5kIGFsbCByZXF1aXJlbWVudHMuXG4gICAqXG4gICAqIFRoZSBpbWFnZSBidWlsZGVyIGRldGVybWluZXMgdGhlIE9TIGFuZCBhcmNoaXRlY3R1cmUgb2YgdGhlIHJ1bm5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgRWNzUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKClcbiAgICovXG4gIHJlYWRvbmx5IGltYWdlQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2VjcyddXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgcnVubmVyIGdyb3VwIG5hbWUuXG4gICAqXG4gICAqIElmIHNwZWNpZmllZCwgdGhlIHJ1bm5lciB3aWxsIGJlIHJlZ2lzdGVyZWQgd2l0aCB0aGlzIGdyb3VwIG5hbWUuIFNldHRpbmcgYSBydW5uZXIgZ3JvdXAgY2FuIGhlbHAgbWFuYWdpbmcgYWNjZXNzIHRvIHNlbGYtaG9zdGVkIHJ1bm5lcnMuIEl0XG4gICAqIHJlcXVpcmVzIGEgcGFpZCBHaXRIdWIgYWNjb3VudC5cbiAgICpcbiAgICogVGhlIGdyb3VwIG11c3QgZXhpc3Qgb3IgdGhlIHJ1bm5lciB3aWxsIG5vdCBzdGFydC5cbiAgICpcbiAgICogVXNlcnMgd2lsbCBzdGlsbCBiZSBhYmxlIHRvIHRyaWdnZXIgdGhpcyBydW5uZXIgd2l0aCB0aGUgY29ycmVjdCBsYWJlbHMuIEJ1dCB0aGUgcnVubmVyIHdpbGwgb25seSBiZSBhYmxlIHRvIHJ1biBqb2JzIGZyb20gcmVwb3MgYWxsb3dlZCB0byB1c2UgdGhlIGdyb3VwLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBWUEMgdG8gbGF1bmNoIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IGFjY291bnQgVlBDXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU3VibmV0cyB0byBydW4gdGhlIHJ1bm5lcnMgaW4uXG4gICAqXG4gICAqIEBkZWZhdWx0IEVDUyBkZWZhdWx0XG4gICAqL1xuICByZWFkb25seSBzdWJuZXRTZWxlY3Rpb24/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgdG8gYXNzaWduIHRvIHRoZSB0YXNrLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBzZWN1cml0eSBncm91cFxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogRXhpc3RpbmcgRUNTIGNsdXN0ZXIgdG8gdXNlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBjbHVzdGVyXG4gICAqL1xuICByZWFkb25seSBjbHVzdGVyPzogZWNzLkNsdXN0ZXI7XG5cbiAgLyoqXG4gICAqIEV4aXN0aW5nIGNhcGFjaXR5IHByb3ZpZGVyIHRvIHVzZS5cbiAgICpcbiAgICogTWFrZSBzdXJlIHRoZSBBTUkgdXNlZCBieSB0aGUgY2FwYWNpdHkgcHJvdmlkZXIgaXMgY29tcGF0aWJsZSB3aXRoIEVDUy5cbiAgICpcbiAgICogQGRlZmF1bHQgbmV3IGNhcGFjaXR5IHByb3ZpZGVyXG4gICAqL1xuICByZWFkb25seSBjYXBhY2l0eVByb3ZpZGVyPzogZWNzLkFzZ0NhcGFjaXR5UHJvdmlkZXI7XG5cbiAgLyoqXG4gICAqIEFzc2lnbiBwdWJsaWMgSVAgdG8gdGhlIHJ1bm5lciB0YXNrLlxuICAgKlxuICAgKiBNYWtlIHN1cmUgdGhlIHRhc2sgd2lsbCBoYXZlIGFjY2VzcyB0byBHaXRIdWIuIEEgcHVibGljIElQIG1pZ2h0IGJlIHJlcXVpcmVkIHVubGVzcyB5b3UgaGF2ZSBOQVQgZ2F0ZXdheS5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgYXNzaWduUHVibGljSXA/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGNwdSB1bml0cyB1c2VkIGJ5IHRoZSB0YXNrLiAxMDI0IHVuaXRzIGlzIDEgdkNQVS4gRnJhY3Rpb25zIG9mIGEgdkNQVSBhcmUgc3VwcG9ydGVkLlxuICAgKlxuICAgKiBAZGVmYXVsdCAxMDI0XG4gICAqL1xuICByZWFkb25seSBjcHU/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBhbW91bnQgKGluIE1pQikgb2YgbWVtb3J5IHVzZWQgYnkgdGhlIHRhc2suXG4gICAqXG4gICAqIEBkZWZhdWx0IDM1MDAsIHVubGVzcyBgbWVtb3J5UmVzZXJ2YXRpb25NaUJgIGlzIHVzZWQgYW5kIHRoZW4gaXQncyB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IG1lbW9yeUxpbWl0TWlCPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgc29mdCBsaW1pdCAoaW4gTWlCKSBvZiBtZW1vcnkgdG8gcmVzZXJ2ZSBmb3IgdGhlIGNvbnRhaW5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBtZW1vcnlSZXNlcnZhdGlvbk1pQj86IG51bWJlcjtcblxuICAvKipcbiAgICogSW5zdGFuY2UgdHlwZSBvZiBFQ1MgY2x1c3RlciBpbnN0YW5jZXMuIE9ubHkgdXNlZCB3aGVuIGNyZWF0aW5nIGEgbmV3IGNsdXN0ZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IG02aS5sYXJnZSBvciBtNmcubGFyZ2VcbiAgICovXG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZT86IGVjMi5JbnN0YW5jZVR5cGU7XG5cbiAgLyoqXG4gICAqIFRoZSBtaW5pbXVtIG51bWJlciBvZiBpbnN0YW5jZXMgdG8gcnVuIGluIHRoZSBjbHVzdGVyLiBPbmx5IHVzZWQgd2hlbiBjcmVhdGluZyBhIG5ldyBjbHVzdGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCAwXG4gICAqL1xuICByZWFkb25seSBtaW5JbnN0YW5jZXM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBtYXhpbXVtIG51bWJlciBvZiBpbnN0YW5jZXMgdG8gcnVuIGluIHRoZSBjbHVzdGVyLiBPbmx5IHVzZWQgd2hlbiBjcmVhdGluZyBhIG5ldyBjbHVzdGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCA1XG4gICAqL1xuICByZWFkb25seSBtYXhJbnN0YW5jZXM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFNpemUgb2Ygdm9sdW1lIGF2YWlsYWJsZSBmb3IgbGF1bmNoZWQgY2x1c3RlciBpbnN0YW5jZXMuIFRoaXMgbW9kaWZpZXMgdGhlIGJvb3Qgdm9sdW1lIHNpemUgYW5kIGRvZXNuJ3QgYWRkIGFueSBhZGRpdGlvbmFsIHZvbHVtZXMuXG4gICAqXG4gICAqIEVhY2ggaW5zdGFuY2UgY2FuIGJlIHVzZWQgYnkgbXVsdGlwbGUgcnVubmVycywgc28gbWFrZSBzdXJlIHRoZXJlIGlzIGVub3VnaCBzcGFjZSBmb3IgYWxsIG9mIHRoZW0uXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgc2l6ZSBmb3IgQU1JICh1c3VhbGx5IDMwR0IgZm9yIExpbnV4IGFuZCA1MEdCIGZvciBXaW5kb3dzKVxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcblxuICAvKipcbiAgICogT3B0aW9ucyBmb3IgcnVubmVyIGluc3RhbmNlIHN0b3JhZ2Ugdm9sdW1lLlxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZU9wdGlvbnM/OiBTdG9yYWdlT3B0aW9ucztcblxuICAvKipcbiAgICogU3VwcG9ydCBidWlsZGluZyBhbmQgcnVubmluZyBEb2NrZXIgaW1hZ2VzIGJ5IGVuYWJsaW5nIERvY2tlci1pbi1Eb2NrZXIgKGRpbmQpIGFuZCB0aGUgcmVxdWlyZWQgQ29kZUJ1aWxkIHByaXZpbGVnZWQgbW9kZS4gRGlzYWJsaW5nIHRoaXMgY2FuXG4gICAqIHNwZWVkIHVwIHByb3Zpc2lvbmluZyBvZiBDb2RlQnVpbGQgcnVubmVycy4gSWYgeW91IGRvbid0IGludGVuZCBvbiBydW5uaW5nIG9yIGJ1aWxkaW5nIERvY2tlciBpbWFnZXMsIGRpc2FibGUgdGhpcyBmb3IgZmFzdGVyIHN0YXJ0LXVwIHRpbWVzLlxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBkb2NrZXJJbkRvY2tlcj86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFVzZSBzcG90IGNhcGFjaXR5LlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZSAodHJ1ZSBpZiBzcG90TWF4UHJpY2UgaXMgc3BlY2lmaWVkKVxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIE1heGltdW0gcHJpY2UgZm9yIHNwb3QgaW5zdGFuY2VzLlxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdE1heFByaWNlPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBFQ1MgcGxhY2VtZW50IHN0cmF0ZWdpZXMgdG8gaW5mbHVlbmNlIHRhc2sgcGxhY2VtZW50LlxuICAgKlxuICAgKiBFeGFtcGxlOiBbZWNzLlBsYWNlbWVudFN0cmF0ZWd5LnBhY2tlZEJ5Q3B1KCldXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZCAobm8gcGxhY2VtZW50IHN0cmF0ZWdpZXMpXG4gICAqL1xuICByZWFkb25seSBwbGFjZW1lbnRTdHJhdGVnaWVzPzogZWNzLlBsYWNlbWVudFN0cmF0ZWd5W107XG5cbiAgLyoqXG4gICAqIEVDUyBwbGFjZW1lbnQgY29uc3RyYWludHMgdG8gaW5mbHVlbmNlIHRhc2sgcGxhY2VtZW50LlxuICAgKlxuICAgKiBFeGFtcGxlOiBbZWNzLlBsYWNlbWVudENvbnN0cmFpbnQubWVtYmVyT2YoJ2Vjcy1wbGFjZW1lbnQnKV1cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkIChubyBwbGFjZW1lbnQgY29uc3RyYWludHMpXG4gICAqL1xuICByZWFkb25seSBwbGFjZW1lbnRDb25zdHJhaW50cz86IGVjcy5QbGFjZW1lbnRDb25zdHJhaW50W107XG5cbiAgLyoqXG4gICAqIE51bWJlciBvZiBHUFVzIHRvIHJlcXVlc3QgZm9yIHRoZSBydW5uZXIgdGFzay4gV2hlbiBzZXQsIHRoZSB0YXNrIHdpbGwgYmUgc2NoZWR1bGVkIG9uIEdQVS1jYXBhYmxlIGluc3RhbmNlcy5cbiAgICpcbiAgICogUmVxdWlyZXMgYSBHUFUtY2FwYWJsZSBpbnN0YW5jZSB0eXBlIChlLmcuLCBnNGRuLnhsYXJnZSBmb3IgMSBHUFUsIGc0ZG4uMTJ4bGFyZ2UgZm9yIDQgR1BVcykgYW5kIEdQVSBBTUkuXG4gICAqIFdoZW4gY3JlYXRpbmcgYSBuZXcgY2x1c3RlciwgaW5zdGFuY2VUeXBlIGRlZmF1bHRzIHRvIGc0ZG4ueGxhcmdlIGFuZCB0aGUgRUNTIE9wdGltaXplZCBHUFUgQU1JIGlzIHVzZWQuXG4gICAqXG4gICAqIFlvdSBtdXN0IGVuc3VyZSB0aGF0IHRoZSB0YXNrJ3MgY29udGFpbmVyIGltYWdlIGluY2x1ZGVzIHRoZSBDVURBIHJ1bnRpbWUuIFByb3ZpZGUgYSBDVURBLWVuYWJsZWQgYmFzZSBpbWFnZVxuICAgKiB2aWEgYGJhc2VEb2NrZXJJbWFnZWAsIHVzZSBhbiBpbWFnZSBidWlsZGVyIHRoYXQgc3RhcnRzIGZyb20gYSBHUFUtY2FwYWJsZSBpbWFnZSAoc3VjaCBhcyBudmlkaWEvY3VkYSksIG9yIGFkZFxuICAgKiBhbiBpbWFnZSBjb21wb25lbnQgdGhhdCBpbnN0YWxscyB0aGUgQ1VEQSBydW50aW1lIGludG8gdGhlIGltYWdlLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWQgKG5vIEdQVSlcbiAgICovXG4gIHJlYWRvbmx5IGdwdT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBHaXRIdWIgQWN0aW9ucyBydW5uZXIgcHJvdmlkZXIgdXNpbmcgRUNTIG9uIEVDMiB0byBleGVjdXRlIGpvYnMuXG4gKlxuICogRUNTIGNhbiBiZSB1c2VmdWwgd2hlbiB5b3Ugd2FudCBtb3JlIGNvbnRyb2wgb2YgdGhlIGluZnJhc3RydWN0dXJlIHJ1bm5pbmcgdGhlIEdpdEh1YiBBY3Rpb25zIERvY2tlciBjb250YWluZXJzLiBZb3UgY2FuIGNvbnRyb2wgdGhlIGF1dG9zY2FsaW5nXG4gKiBncm91cCB0byBzY2FsZSBkb3duIHRvIHplcm8gZHVyaW5nIHRoZSBuaWdodCBhbmQgc2NhbGUgdXAgZHVyaW5nIHdvcmsgaG91cnMuIFRoaXMgd2F5IHlvdSBjYW4gc3RpbGwgc2F2ZSBtb25leSwgYnV0IGhhdmUgdG8gd2FpdCBsZXNzIGZvclxuICogaW5mcmFzdHJ1Y3R1cmUgdG8gc3BpbiB1cC5cbiAqXG4gKiBUaGlzIGNvbnN0cnVjdCBpcyBub3QgbWVhbnQgdG8gYmUgdXNlZCBieSBpdHNlbGYuIEl0IHNob3VsZCBiZSBwYXNzZWQgaW4gdGhlIHByb3ZpZGVycyBwcm9wZXJ0eSBmb3IgR2l0SHViUnVubmVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIEVjc1J1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZSBuZXcgaW1hZ2UgYnVpbGRlciB0aGF0IGJ1aWxkcyBFQ1Mgc3BlY2lmaWMgcnVubmVyIGltYWdlcy5cbiAgICpcbiAgICogWW91IGNhbiBjdXN0b21pemUgdGhlIE9TLCBhcmNoaXRlY3R1cmUsIFZQQywgc3VibmV0LCBzZWN1cml0eSBncm91cHMsIGV0Yy4gYnkgcGFzc2luZyBpbiBwcm9wcy5cbiAgICpcbiAgICogWW91IGNhbiBhZGQgY29tcG9uZW50cyB0byB0aGUgaW1hZ2UgYnVpbGRlciBieSBjYWxsaW5nIGBpbWFnZUJ1aWxkZXIuYWRkQ29tcG9uZW50KClgLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBPUyBpcyBVYnVudHUgcnVubmluZyBvbiB4NjQgYXJjaGl0ZWN0dXJlLlxuICAgKlxuICAgKiBJbmNsdWRlZCBjb21wb25lbnRzOlxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucnVubmVyVXNlcigpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmF3c0NsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIoKWBcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgaW1hZ2VCdWlsZGVyKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMpIHtcbiAgICByZXR1cm4gUnVubmVySW1hZ2VCdWlsZGVyLm5ldyhzY29wZSwgaWQsIHtcbiAgICAgIG9zOiBPcy5MSU5VWF9VQlVOVFUsXG4gICAgICBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZS5YODZfNjQsXG4gICAgICBjb21wb25lbnRzOiBbXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LnJlcXVpcmVkUGFja2FnZXMoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucnVubmVyVXNlcigpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmF3c0NsaSgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViUnVubmVyKHByb3BzPy5ydW5uZXJWZXJzaW9uID8/IFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkpLFxuICAgICAgXSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENsdXN0ZXIgaG9zdGluZyB0aGUgdGFzayBob3N0aW5nIHRoZSBydW5uZXIuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGNsdXN0ZXI6IGVjcy5DbHVzdGVyO1xuXG4gIC8qKlxuICAgKiBDYXBhY2l0eSBwcm92aWRlciB1c2VkIHRvIHNjYWxlIHRoZSBjbHVzdGVyLlxuICAgKlxuICAgKiBVc2UgY2FwYWNpdHlQcm92aWRlci5hdXRvU2NhbGluZ0dyb3VwIHRvIGFjY2VzcyB0aGUgYXV0byBzY2FsaW5nIGdyb3VwLiBUaGlzIGNhbiBoZWxwIHNldCB1cCBjdXN0b20gc2NhbGluZyBwb2xpY2llcy5cbiAgICovXG4gIHJlYWRvbmx5IGNhcGFjaXR5UHJvdmlkZXI6IGVjcy5Bc2dDYXBhY2l0eVByb3ZpZGVyO1xuXG4gIC8qKlxuICAgKiBFQ1MgdGFzayBob3N0aW5nIHRoZSBydW5uZXIuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHRhc2s6IGVjcy5FYzJUYXNrRGVmaW5pdGlvbjtcblxuICAvKipcbiAgICogQ29udGFpbmVyIGRlZmluaXRpb24gaG9zdGluZyB0aGUgcnVubmVyLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBjb250YWluZXI6IGVjcy5Db250YWluZXJEZWZpbml0aW9uO1xuXG4gIC8qKlxuICAgKiBMYWJlbHMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcHJvdmlkZXIuXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBWUEMgdXNlZCBmb3IgaG9zdGluZyB0aGUgcnVubmVyIHRhc2suXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBTdWJuZXRzIHVzZWQgZm9yIGhvc3RpbmcgdGhlIHJ1bm5lciB0YXNrLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBzdWJuZXRTZWxlY3Rpb24/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIHJ1bm5lciB0YXNrIHdpbGwgaGF2ZSBhIHB1YmxpYyBJUC5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgYXNzaWduUHVibGljSXA6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIEdyYW50IHByaW5jaXBhbCB1c2VkIHRvIGFkZCBwZXJtaXNzaW9ucyB0byB0aGUgcnVubmVyIHJvbGUuXG4gICAqL1xuICByZWFkb25seSBncmFudFByaW5jaXBhbDogaWFtLklQcmluY2lwYWw7XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcmVhZG9ubHkgY29ubmVjdGlvbnM6IGVjMi5Db25uZWN0aW9ucztcblxuICAvKipcbiAgICogRG9ja2VyIGltYWdlIGxvYWRlZCB3aXRoIEdpdEh1YiBBY3Rpb25zIFJ1bm5lciBhbmQgaXRzIHByZXJlcXVpc2l0ZXMuIFRoZSBpbWFnZSBpcyBidWlsdCBieSBhbiBpbWFnZSBidWlsZGVyIGFuZCBpcyBzcGVjaWZpYyB0byBFQ1MgdGFza3MuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGltYWdlOiBSdW5uZXJJbWFnZTtcblxuICAvKipcbiAgICogTG9nIGdyb3VwIHdoZXJlIHByb3ZpZGVkIHJ1bm5lcnMgd2lsbCBzYXZlIHRoZWlyIGxvZ3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGlzIG5vdCB0aGUgam9iIGxvZywgYnV0IHRoZSBydW5uZXIgaXRzZWxmLiBJdCB3aWxsIG5vdCBjb250YWluIG91dHB1dCBmcm9tIHRoZSBHaXRIdWIgQWN0aW9uIGJ1dCBvbmx5IG1ldGFkYXRhIG9uIGl0cyBleGVjdXRpb24uXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cDogbG9ncy5JTG9nR3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwcyBhc3NvY2lhdGVkIHdpdGggdGhpcyBwcm92aWRlci5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM6IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIC8qKlxuICAgKiBSdW4gZG9ja2VyIGluIGRvY2tlci5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgZGluZDogYm9vbGVhbjtcblxuICAvKipcbiAgICogUnVubmVyIGdyb3VwIG5hbWUuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBJbmNsdWRlIGRlZmF1bHQgbGFiZWxzIChhcmNoLCBvcywgc2VsZi1ob3N0ZWQpIGZvciBydW5uZXIuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIEVDUyBwbGFjZW1lbnQgc3RyYXRlZ2llcyB0byBpbmZsdWVuY2UgdGFzayBwbGFjZW1lbnQuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHBsYWNlbWVudFN0cmF0ZWdpZXM/OiBlY3MuUGxhY2VtZW50U3RyYXRlZ3lbXTtcblxuICAvKipcbiAgICogRUNTIHBsYWNlbWVudCBjb25zdHJhaW50cyB0byBpbmZsdWVuY2UgdGFzayBwbGFjZW1lbnQuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHBsYWNlbWVudENvbnN0cmFpbnRzPzogZWNzLlBsYWNlbWVudENvbnN0cmFpbnRbXTtcblxuICAvKipcbiAgICogTnVtYmVyIG9mIEdQVXMgcmVxdWVzdGVkIGZvciB0aGUgcnVubmVyIHRhc2sgKDAgPSBubyBHUFUpLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBncHVDb3VudDogbnVtYmVyO1xuXG4gIHJlYWRvbmx5IHJldHJ5YWJsZUVycm9ycyA9IFtcbiAgICAnRWNzLkVjc0V4Y2VwdGlvbicsXG4gICAgJ0VDUy5BbWF6b25FQ1NFeGNlcHRpb24nLFxuICAgICdFY3MuTGltaXRFeGNlZWRlZEV4Y2VwdGlvbicsXG4gICAgJ0Vjcy5VcGRhdGVJblByb2dyZXNzRXhjZXB0aW9uJyxcbiAgXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IEVjc1J1bm5lclByb3ZpZGVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIHRoaXMubGFiZWxzID0gcHJvcHM/LmxhYmVscyA/PyBbJ2VjcyddO1xuICAgIHRoaXMuZ3JvdXAgPSBwcm9wcz8uZ3JvdXA7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcbiAgICB0aGlzLnZwYyA9IHByb3BzPy52cGMgPz8gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdkZWZhdWx0IHZwYycsIHsgaXNEZWZhdWx0OiB0cnVlIH0pO1xuICAgIHRoaXMuc3VibmV0U2VsZWN0aW9uID0gcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbjtcbiAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gcHJvcHM/LnNlY3VyaXR5R3JvdXBzID8/IFtuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ3NlY3VyaXR5IGdyb3VwJywgeyB2cGM6IHRoaXMudnBjIH0pXTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gbmV3IGVjMi5Db25uZWN0aW9ucyh7IHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzIH0pO1xuICAgIHRoaXMuYXNzaWduUHVibGljSXAgPSBwcm9wcz8uYXNzaWduUHVibGljSXAgPz8gdHJ1ZTtcbiAgICB0aGlzLnBsYWNlbWVudFN0cmF0ZWdpZXMgPSBwcm9wcz8ucGxhY2VtZW50U3RyYXRlZ2llcztcbiAgICB0aGlzLnBsYWNlbWVudENvbnN0cmFpbnRzID0gcHJvcHM/LnBsYWNlbWVudENvbnN0cmFpbnRzO1xuICAgIHRoaXMuZ3B1Q291bnQgPSBwcm9wcz8uZ3B1ID8/IDA7XG4gICAgdGhpcy5jbHVzdGVyID0gcHJvcHM/LmNsdXN0ZXIgPyBwcm9wcy5jbHVzdGVyIDogbmV3IGVjcy5DbHVzdGVyKFxuICAgICAgdGhpcyxcbiAgICAgICdjbHVzdGVyJyxcbiAgICAgIHtcbiAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgZW5hYmxlRmFyZ2F0ZUNhcGFjaXR5UHJvdmlkZXJzOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGlmIChwcm9wcz8uc3RvcmFnZU9wdGlvbnMgJiYgIXByb3BzPy5zdG9yYWdlU2l6ZSkge1xuICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdzdG9yYWdlU2l6ZSBpcyByZXF1aXJlZCB3aGVuIHN0b3JhZ2VPcHRpb25zIGFyZSBzcGVjaWZpZWQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBkZWZhdWx0SW1hZ2VCdWlsZGVyQXJjaGl0ZWN0dXJlID1cbiAgICAgICFwcm9wcz8uY2FwYWNpdHlQcm92aWRlciAmJiBwcm9wcz8uaW5zdGFuY2VUeXBlPy5hcmNoaXRlY3R1cmUgPT09IGVjMi5JbnN0YW5jZUFyY2hpdGVjdHVyZS5BUk1fNjRcbiAgICAgICAgPyBBcmNoaXRlY3R1cmUuQVJNNjRcbiAgICAgICAgOiBBcmNoaXRlY3R1cmUuWDg2XzY0O1xuXG4gICAgY29uc3QgaW1hZ2VCdWlsZGVyID0gcHJvcHM/LmltYWdlQnVpbGRlciA/PyBFY3NSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIodGhpcywgJ0ltYWdlIEJ1aWxkZXInLCB7XG4gICAgICBhcmNoaXRlY3R1cmU6IGRlZmF1bHRJbWFnZUJ1aWxkZXJBcmNoaXRlY3R1cmUsXG4gICAgfSk7XG4gICAgY29uc3QgaW1hZ2UgPSB0aGlzLmltYWdlID0gaW1hZ2VCdWlsZGVyLmJpbmREb2NrZXJJbWFnZSgpO1xuXG4gICAgaWYgKHByb3BzPy5jYXBhY2l0eVByb3ZpZGVyKSB7XG4gICAgICBpZiAocHJvcHM/Lm1pbkluc3RhbmNlcyB8fCBwcm9wcz8ubWF4SW5zdGFuY2VzIHx8IHByb3BzPy5pbnN0YW5jZVR5cGUgfHwgcHJvcHM/LnN0b3JhZ2VTaXplIHx8IHByb3BzPy5zcG90IHx8IHByb3BzPy5zcG90TWF4UHJpY2UpIHtcbiAgICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ1doZW4gdXNpbmcgYSBjdXN0b20gY2FwYWNpdHkgcHJvdmlkZXIsIG1pbkluc3RhbmNlcywgbWF4SW5zdGFuY2VzLCBpbnN0YW5jZVR5cGUsIHN0b3JhZ2VTaXplLCBzcG90LCBhbmQgc3BvdE1heFByaWNlIHdpbGwgYmUgaWdub3JlZC4nKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5jYXBhY2l0eVByb3ZpZGVyID0gcHJvcHMuY2FwYWNpdHlQcm92aWRlcjtcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgc3BvdCA9IHByb3BzPy5zcG90ID8/IHByb3BzPy5zcG90TWF4UHJpY2UgIT09IHVuZGVmaW5lZDtcblxuICAgICAgY29uc3QgbGF1bmNoVGVtcGxhdGUgPSBuZXcgZWMyLkxhdW5jaFRlbXBsYXRlKHRoaXMsICdMYXVuY2ggVGVtcGxhdGUnLCB7XG4gICAgICAgIG1hY2hpbmVJbWFnZTogdGhpcy5kZWZhdWx0Q2x1c3Rlckluc3RhbmNlQW1pKCksXG4gICAgICAgIGluc3RhbmNlVHlwZTogcHJvcHM/Lmluc3RhbmNlVHlwZSA/PyB0aGlzLmRlZmF1bHRDbHVzdGVySW5zdGFuY2VUeXBlKCksXG4gICAgICAgIGJsb2NrRGV2aWNlczogKHByb3BzPy5zdG9yYWdlU2l6ZSB8fCBwcm9wcz8uc3RvcmFnZU9wdGlvbnMpID8gW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGRldmljZU5hbWU6IGFtaVJvb3REZXZpY2UodGhpcywgdGhpcy5kZWZhdWx0Q2x1c3Rlckluc3RhbmNlQW1pKCkuZ2V0SW1hZ2UodGhpcykuaW1hZ2VJZCkucmVmLFxuICAgICAgICAgICAgdm9sdW1lOiB7XG4gICAgICAgICAgICAgIGVic0RldmljZToge1xuICAgICAgICAgICAgICAgIGRlbGV0ZU9uVGVybWluYXRpb246IHRydWUsXG4gICAgICAgICAgICAgICAgdm9sdW1lU2l6ZTogcHJvcHM/LnN0b3JhZ2VTaXplPy50b0dpYmlieXRlcygpID8/IDMwLFxuICAgICAgICAgICAgICAgIHZvbHVtZVR5cGU6IHByb3BzPy5zdG9yYWdlT3B0aW9ucz8udm9sdW1lVHlwZSxcbiAgICAgICAgICAgICAgICBpb3BzOiBwcm9wcz8uc3RvcmFnZU9wdGlvbnM/LmlvcHMsXG4gICAgICAgICAgICAgICAgdGhyb3VnaHB1dDogcHJvcHM/LnN0b3JhZ2VPcHRpb25zPy50aHJvdWdocHV0LFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdIDogdW5kZWZpbmVkLFxuICAgICAgICBzcG90T3B0aW9uczogc3BvdCA/IHtcbiAgICAgICAgICByZXF1ZXN0VHlwZTogZWMyLlNwb3RSZXF1ZXN0VHlwZS5PTkVfVElNRSxcbiAgICAgICAgICBtYXhQcmljZTogcHJvcHM/LnNwb3RNYXhQcmljZSA/IHBhcnNlRmxvYXQocHJvcHM/LnNwb3RNYXhQcmljZSkgOiB1bmRlZmluZWQsXG4gICAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgICAgIHJlcXVpcmVJbWRzdjI6IHRydWUsXG4gICAgICAgIHNlY3VyaXR5R3JvdXA6IHRoaXMuc2VjdXJpdHlHcm91cHNbMF0sXG4gICAgICAgIHJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnTGF1bmNoIFRlbXBsYXRlIFJvbGUnLCB7XG4gICAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2VjMi5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIH0pLFxuICAgICAgICB1c2VyRGF0YTogZWMyLlVzZXJEYXRhLmZvck9wZXJhdGluZ1N5c3RlbShpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSA/IGVjMi5PcGVyYXRpbmdTeXN0ZW1UeXBlLldJTkRPV1MgOiBlYzIuT3BlcmF0aW5nU3lzdGVtVHlwZS5MSU5VWCksXG4gICAgICB9KTtcbiAgICAgIHRoaXMuc2VjdXJpdHlHcm91cHMuc2xpY2UoMSkubWFwKHNnID0+IGxhdW5jaFRlbXBsYXRlLmNvbm5lY3Rpb25zLmFkZFNlY3VyaXR5R3JvdXAoc2cpKTtcblxuICAgICAgY29uc3QgYXV0b1NjYWxpbmdHcm91cCA9IG5ldyBhdXRvc2NhbGluZy5BdXRvU2NhbGluZ0dyb3VwKHRoaXMsICdBdXRvIFNjYWxpbmcgR3JvdXAnLCB7XG4gICAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICAgIGxhdW5jaFRlbXBsYXRlLFxuICAgICAgICB2cGNTdWJuZXRzOiB0aGlzLnN1Ym5ldFNlbGVjdGlvbixcbiAgICAgICAgbWluQ2FwYWNpdHk6IHByb3BzPy5taW5JbnN0YW5jZXMgPz8gMCxcbiAgICAgICAgbWF4Q2FwYWNpdHk6IHByb3BzPy5tYXhJbnN0YW5jZXMgPz8gNSxcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLmNhcGFjaXR5UHJvdmlkZXIgPSBwcm9wcz8uY2FwYWNpdHlQcm92aWRlciA/PyBuZXcgZWNzLkFzZ0NhcGFjaXR5UHJvdmlkZXIodGhpcywgJ0NhcGFjaXR5IFByb3ZpZGVyJywge1xuICAgICAgICBhdXRvU2NhbGluZ0dyb3VwLFxuICAgICAgICBzcG90SW5zdGFuY2VEcmFpbmluZzogZmFsc2UsIC8vIHdhc3RlIG9mIG1vbmV5IHRvIHJlc3RhcnQgam9icyBhcyB0aGUgcmVzdGFydGVkIGpvYiB3b24ndCBoYXZlIGEgdG9rZW5cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMuY2FwYWNpdHlQcm92aWRlci5hdXRvU2NhbGluZ0dyb3VwLmFkZFVzZXJEYXRhKFxuICAgICAgLy8gd2UgZG9uJ3QgZXhpdCBvbiBlcnJvcnMgYmVjYXVzZSBhbGwgb2YgdGhlc2UgY29tbWFuZHMgYXJlIG9wdGlvbmFsXG4gICAgICAuLi50aGlzLmxvZ2luQ29tbWFuZHMoKSxcbiAgICAgIHRoaXMucHVsbENvbW1hbmQoKSxcbiAgICAgIC4uLnRoaXMuZWNzU2V0dGluZ3NDb21tYW5kcygpLFxuICAgICk7XG4gICAgdGhpcy5jYXBhY2l0eVByb3ZpZGVyLmF1dG9TY2FsaW5nR3JvdXAucm9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShNSU5JTUFMX0VDMl9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQpO1xuICAgIGltYWdlLmltYWdlUmVwb3NpdG9yeS5ncmFudFB1bGwodGhpcy5jYXBhY2l0eVByb3ZpZGVyLmF1dG9TY2FsaW5nR3JvdXApO1xuXG4gICAgdGhpcy5jbHVzdGVyLmFkZEFzZ0NhcGFjaXR5UHJvdmlkZXIoXG4gICAgICB0aGlzLmNhcGFjaXR5UHJvdmlkZXIsXG4gICAgICB7XG4gICAgICAgIHNwb3RJbnN0YW5jZURyYWluaW5nOiBmYWxzZSxcbiAgICAgICAgbWFjaGluZUltYWdlVHlwZTogTWFjaGluZUltYWdlVHlwZS5BTUFaT05fTElOVVhfMixcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMubG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnbG9ncycsIHtcbiAgICAgIHJldGVudGlvbjogcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIHRoaXMuZGluZCA9IChwcm9wcz8uZG9ja2VySW5Eb2NrZXIgPz8gdHJ1ZSkgJiYgIWltYWdlLm9zLmlzKE9zLldJTkRPV1MpO1xuXG4gICAgdGhpcy50YXNrID0gbmV3IGVjcy5FYzJUYXNrRGVmaW5pdGlvbih0aGlzLCAndGFzaycpO1xuICAgIHRoaXMuY29udGFpbmVyID0gdGhpcy50YXNrLmFkZENvbnRhaW5lcihcbiAgICAgICdydW5uZXInLFxuICAgICAge1xuICAgICAgICBpbWFnZTogZWNzLkFzc2V0SW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LCBpbWFnZS5pbWFnZVRhZyksXG4gICAgICAgIGNwdTogcHJvcHM/LmNwdSA/PyAxMDI0LFxuICAgICAgICBtZW1vcnlMaW1pdE1pQjogcHJvcHM/Lm1lbW9yeUxpbWl0TWlCID8/IChwcm9wcz8ubWVtb3J5UmVzZXJ2YXRpb25NaUIgPyB1bmRlZmluZWQgOiAzNTAwKSxcbiAgICAgICAgbWVtb3J5UmVzZXJ2YXRpb25NaUI6IHByb3BzPy5tZW1vcnlSZXNlcnZhdGlvbk1pQixcbiAgICAgICAgZ3B1Q291bnQ6IHRoaXMuZ3B1Q291bnQgPiAwID8gdGhpcy5ncHVDb3VudCA6IHVuZGVmaW5lZCxcbiAgICAgICAgbG9nZ2luZzogZWNzLkF3c0xvZ0RyaXZlci5hd3NMb2dzKHtcbiAgICAgICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cCxcbiAgICAgICAgICBzdHJlYW1QcmVmaXg6ICdydW5uZXInLFxuICAgICAgICB9KSxcbiAgICAgICAgY29tbWFuZDogZWNzUnVuQ29tbWFuZCh0aGlzLmltYWdlLm9zLCB0aGlzLmRpbmQpLFxuICAgICAgICB1c2VyOiBpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSA/IHVuZGVmaW5lZCA6ICdydW5uZXInLFxuICAgICAgICBwcml2aWxlZ2VkOiB0aGlzLmRpbmQsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICB0aGlzLmdyYW50UHJpbmNpcGFsID0gdGhpcy50YXNrLnRhc2tSb2xlO1xuXG4gICAgLy8gcGVybWlzc2lvbnMgZm9yIFNTTSBTZXNzaW9uIE1hbmFnZXJcbiAgICB0aGlzLnRhc2sudGFza1JvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koTUlOSU1BTF9FQ1NfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UKTtcbiAgfVxuXG4gIHByaXZhdGUgZGVmYXVsdENsdXN0ZXJJbnN0YW5jZVR5cGUoKSB7XG4gICAgaWYgKHRoaXMuZ3B1Q291bnQgPiAwKSB7XG4gICAgICBpZiAoIXRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRUNTIEdQVSBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgeDY0IGFyY2hpdGVjdHVyZS4gR1BVIGluc3RhbmNlcyAoZzRkbiwgZzUsIHAzLCBldGMuKSBhcmUgeDY0IG9ubHkuJyk7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5ncHVDb3VudCA8PSAxKSB7XG4gICAgICAgIHJldHVybiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLkc0RE4sIGVjMi5JbnN0YW5jZVNpemUuWExBUkdFKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmdwdUNvdW50IDw9IDQpIHtcbiAgICAgICAgcmV0dXJuIGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuRzRETiwgZWMyLkluc3RhbmNlU2l6ZS5YTEFSR0UxMik7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5ncHVDb3VudCA8PSA4KSB7XG4gICAgICAgIHJldHVybiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLlAzLCBlYzIuSW5zdGFuY2VTaXplLlhMQVJHRTE2KTtcbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgR1BVIGNvdW50OiAke3RoaXMuZ3B1Q291bnR9YCk7XG4gICAgfVxuICAgIGlmICh0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgcmV0dXJuIGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuTTZJLCBlYzIuSW5zdGFuY2VTaXplLkxBUkdFKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgIHJldHVybiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLk02RywgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSk7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGZpbmQgaW5zdGFuY2UgdHlwZSBmb3IgRUNTIGluc3RhbmNlcyBmb3IgJHt0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5uYW1lfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBkZWZhdWx0Q2x1c3Rlckluc3RhbmNlQW1pKCkge1xuICAgIGxldCBiYXNlSW1hZ2U6IGVjMi5JTWFjaGluZUltYWdlO1xuICAgIGxldCBzc21QYXRoOiBzdHJpbmc7XG4gICAgbGV0IGZvdW5kID0gZmFsc2U7XG5cbiAgICBpZiAodGhpcy5pbWFnZS5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICBpZiAodGhpcy5ncHVDb3VudCA+IDAgJiYgdGhpcy5pbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgICAgYmFzZUltYWdlID0gZWNzLkVjc09wdGltaXplZEltYWdlLmFtYXpvbkxpbnV4MjAyMyhlY3MuQW1pSGFyZHdhcmVUeXBlLkdQVSk7XG4gICAgICAgIHNzbVBhdGggPSAnL2F3cy9zZXJ2aWNlL2Vjcy9vcHRpbWl6ZWQtYW1pL2FtYXpvbi1saW51eC0yMDIzL2dwdS9yZWNvbW1lbmRlZC9pbWFnZV9pZCc7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5pbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgICAgYmFzZUltYWdlID0gZWNzLkVjc09wdGltaXplZEltYWdlLmFtYXpvbkxpbnV4MjAyMyhlY3MuQW1pSGFyZHdhcmVUeXBlLlNUQU5EQVJEKTtcbiAgICAgICAgc3NtUGF0aCA9ICcvYXdzL3NlcnZpY2UvZWNzL29wdGltaXplZC1hbWkvYW1hem9uLWxpbnV4LTIwMjMvcmVjb21tZW5kZWQvaW1hZ2VfaWQnO1xuICAgICAgICBmb3VuZCA9IHRydWU7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgICAgYmFzZUltYWdlID0gZWNzLkVjc09wdGltaXplZEltYWdlLmFtYXpvbkxpbnV4MjAyMyhlY3MuQW1pSGFyZHdhcmVUeXBlLkFSTSk7XG4gICAgICAgIHNzbVBhdGggPSAnL2F3cy9zZXJ2aWNlL2Vjcy9vcHRpbWl6ZWQtYW1pL2FtYXpvbi1saW51eC0yMDIzL2FybTY0L3JlY29tbWVuZGVkL2ltYWdlX2lkJztcbiAgICAgICAgZm91bmQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmltYWdlLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICBiYXNlSW1hZ2UgPSBlY3MuRWNzT3B0aW1pemVkSW1hZ2Uud2luZG93cyhlY3MuV2luZG93c09wdGltaXplZFZlcnNpb24uU0VSVkVSXzIwMTkpO1xuICAgICAgc3NtUGF0aCA9ICcvYXdzL3NlcnZpY2UvYW1pLXdpbmRvd3MtbGF0ZXN0L1dpbmRvd3NfU2VydmVyLTIwMTktRW5nbGlzaC1GdWxsLUVDU19PcHRpbWl6ZWQvaW1hZ2VfaWQnO1xuICAgICAgZm91bmQgPSB0cnVlO1xuICAgIH1cblxuICAgIGlmICghZm91bmQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGZpbmQgQU1JIGZvciBFQ1MgaW5zdGFuY2VzIGZvciAke3RoaXMuaW1hZ2Uub3MubmFtZX0vJHt0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5uYW1lfSAoZ3B1Q291bnQ9JHt0aGlzLmdwdUNvdW50fSlgKTtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZTogZWMyLklNYWNoaW5lSW1hZ2UgPSB7XG4gICAgICBnZXRJbWFnZShzY29wZTogQ29uc3RydWN0KTogZWMyLk1hY2hpbmVJbWFnZUNvbmZpZyB7XG4gICAgICAgIGNvbnN0IGJhc2VJbWFnZVJlcyA9IGJhc2VJbWFnZS5nZXRJbWFnZShzY29wZSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBpbWFnZUlkOiBgcmVzb2x2ZTpzc206JHtzc21QYXRofWAsXG4gICAgICAgICAgdXNlckRhdGE6IGJhc2VJbWFnZVJlcy51c2VyRGF0YSxcbiAgICAgICAgICBvc1R5cGU6IGJhc2VJbWFnZVJlcy5vc1R5cGUsXG4gICAgICAgIH07XG4gICAgICB9LFxuICAgIH07XG5cbiAgICByZXR1cm4gaW1hZ2U7XG4gIH1cblxuICBwcml2YXRlIHB1bGxDb21tYW5kKCkge1xuICAgIGlmICh0aGlzLmltYWdlLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICByZXR1cm4gYFN0YXJ0LUpvYiAtU2NyaXB0QmxvY2sgeyBkb2NrZXIgcHVsbCAke3RoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OiR7dGhpcy5pbWFnZS5pbWFnZVRhZ30gfWA7XG4gICAgfVxuICAgIHJldHVybiBgZG9ja2VyIHB1bGwgJHt0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfToke3RoaXMuaW1hZ2UuaW1hZ2VUYWd9ICZgO1xuICB9XG5cbiAgcHJpdmF0ZSBsb2dpbkNvbW1hbmRzKCkge1xuICAgIGNvbnN0IHRoaXNTdGFjayA9IFN0YWNrLm9mKHRoaXMpO1xuICAgIGlmICh0aGlzLmltYWdlLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICByZXR1cm4gW2AoR2V0LUVDUkxvZ2luQ29tbWFuZCkuUGFzc3dvcmQgfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAke3RoaXNTdGFjay5hY2NvdW50fS5ka3IuZWNyLiR7dGhpc1N0YWNrLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAgJ3l1bSBpbnN0YWxsIC15IGF3c2NsaSB8fCBkbmYgaW5zdGFsbCAteSBhd3NjbGknLFxuICAgICAgYGF3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uICR7dGhpc1N0YWNrLnJlZ2lvbn0gfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAke3RoaXNTdGFjay5hY2NvdW50fS5ka3IuZWNyLiR7dGhpc1N0YWNrLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgZWNzU2V0dGluZ3NDb21tYW5kcygpIHtcbiAgICAvLyBkb24ndCBsZXQgRUNTIGFjY3VtdWxhdGUgdG9vIG1hbnkgc3RvcHBlZCB0YXNrcyB0aGF0IGNhbiBlbmQgdXAgdmVyeSBiaWcgaW4gb3VyIGNhc2VcbiAgICAvLyB0aGUgZGVmYXVsdCBpcyAxMG0gZHVyYXRpb24gd2l0aCAxaCBqaXR0ZXIgd2hpY2ggY2FuIGVuZCB1cCB3aXRoIDFoMTBtIGRlbGF5IGZvciBjbGVhbmluZyB1cCBzdG9wcGVkIHRhc2tzXG4gICAgaWYgKHRoaXMuaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgICdbRW52aXJvbm1lbnRdOjpTZXRFbnZpcm9ubWVudFZhcmlhYmxlKFwiRUNTX0VOR0lORV9UQVNLX0NMRUFOVVBfV0FJVF9EVVJBVElPTlwiLCBcIjVzXCIsIFwiTWFjaGluZVwiKScsXG4gICAgICAgICdbRW52aXJvbm1lbnRdOjpTZXRFbnZpcm9ubWVudFZhcmlhYmxlKFwiRUNTX0VOR0lORV9UQVNLX0NMRUFOVVBfV0FJVF9EVVJBVElPTl9KSVRURVJcIiwgXCI1c1wiLCBcIk1hY2hpbmVcIiknLFxuICAgICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLzM2ODA1XG4gICAgICAgICdbRW52aXJvbm1lbnRdOjpTZXRFbnZpcm9ubWVudFZhcmlhYmxlKFwiRUNTX0VOQUJMRV9UQVNLX0lBTV9ST0xFXCIsIFwidHJ1ZVwiLCBcIk1hY2hpbmVcIiknLFxuICAgICAgICAnKEdldC1Db250ZW50IFwiQzpcXFxcUHJvZ3JhbSBGaWxlc1xcXFxXaW5kb3dzUG93ZXJTaGVsbFxcXFxNb2R1bGVzXFxcXEVDU1Rvb2xzXFxcXEVDU1Rvb2xzLnBzbTFcIikuUmVwbGFjZShcXCdpZiAoJEVuYWJsZVRhc2tJQU1Sb2xlKSB7XFwnLCBcXCckRW5hYmxlVGFza0lBTVJvbGUgPSAkdHJ1ZTsgaWYgKCRFbmFibGVUYXNrSUFNUm9sZSkge1xcJykgfCBTZXQtQ29udGVudCBcIkM6XFxcXFByb2dyYW0gRmlsZXNcXFxcV2luZG93c1Bvd2VyU2hlbGxcXFxcTW9kdWxlc1xcXFxFQ1NUb29sc1xcXFxFQ1NUb29scy5wc20xXCIgLUZvcmNlJyxcbiAgICAgIF07XG4gICAgfVxuICAgIHJldHVybiBbXG4gICAgICAnZWNobyBFQ1NfRU5HSU5FX1RBU0tfQ0xFQU5VUF9XQUlUX0RVUkFUSU9OPTVzID4+IC9ldGMvZWNzL2Vjcy5jb25maWcnLFxuICAgICAgJ2VjaG8gRUNTX0VOR0lORV9UQVNLX0NMRUFOVVBfV0FJVF9EVVJBVElPTl9KSVRURVI9NXMgPj4gL2V0Yy9lY3MvZWNzLmNvbmZpZycsXG4gICAgXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZSBzdGVwIGZ1bmN0aW9uIHRhc2socykgdG8gc3RhcnQgYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBDYWxsZWQgYnkgR2l0aHViUnVubmVycyBhbmQgc2hvdWxkbid0IGJlIGNhbGxlZCBtYW51YWxseS5cbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlcnMgd29ya2Zsb3cgam9iIGRldGFpbHNcbiAgICovXG4gIGdldFN0ZXBGdW5jdGlvblRhc2socGFyYW1ldGVyczogSVJ1bm5lclJ1bnRpbWVQYXJhbWV0ZXJzKTogc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlIHtcbiAgICByZXR1cm4gbmV3IHN0ZXBmdW5jdGlvbnNfdGFza3MuRWNzUnVuVGFzayhcbiAgICAgIHRoaXMsXG4gICAgICAnU3RhdGUnLFxuICAgICAge1xuICAgICAgICBzdGF0ZU5hbWU6IGdlbmVyYXRlU3RhdGVOYW1lKHRoaXMpLFxuICAgICAgICBpbnRlZ3JhdGlvblBhdHRlcm46IEludGVncmF0aW9uUGF0dGVybi5SVU5fSk9CLCAvLyBzeW5jXG4gICAgICAgIHRhc2tEZWZpbml0aW9uOiB0aGlzLnRhc2ssXG4gICAgICAgIGNsdXN0ZXI6IHRoaXMuY2x1c3RlcixcbiAgICAgICAgbGF1bmNoVGFyZ2V0OiBuZXcgc3RlcGZ1bmN0aW9uc190YXNrcy5FY3NFYzJMYXVuY2hUYXJnZXQoe1xuICAgICAgICAgIGNhcGFjaXR5UHJvdmlkZXJPcHRpb25zOiBzdGVwZnVuY3Rpb25zX3Rhc2tzLkNhcGFjaXR5UHJvdmlkZXJPcHRpb25zLmN1c3RvbShbe1xuICAgICAgICAgICAgY2FwYWNpdHlQcm92aWRlcjogdGhpcy5jYXBhY2l0eVByb3ZpZGVyLmNhcGFjaXR5UHJvdmlkZXJOYW1lLFxuICAgICAgICAgIH1dKSxcbiAgICAgICAgICBwbGFjZW1lbnRTdHJhdGVnaWVzOiB0aGlzLnBsYWNlbWVudFN0cmF0ZWdpZXMsXG4gICAgICAgICAgcGxhY2VtZW50Q29uc3RyYWludHM6IHRoaXMucGxhY2VtZW50Q29uc3RyYWludHMsXG4gICAgICAgIH0pLFxuICAgICAgICBlbmFibGVFeGVjdXRlQ29tbWFuZDogdGhpcy5pbWFnZS5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpLFxuICAgICAgICBwcm9wYWdhdGVkVGFnU291cmNlOiBlY3MuUHJvcGFnYXRlZFRhZ1NvdXJjZS5UQVNLX0RFRklOSVRJT04sXG4gICAgICAgIGFzc2lnblB1YmxpY0lwOiB0aGlzLmFzc2lnblB1YmxpY0lwLFxuICAgICAgICBjb250YWluZXJPdmVycmlkZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBjb250YWluZXJEZWZpbml0aW9uOiB0aGlzLmNvbnRhaW5lcixcbiAgICAgICAgICAgIGVudmlyb25tZW50OiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUlVOTkVSX1RPS0VOJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5ydW5uZXJUb2tlblBhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnSklUX0NPTkZJRycsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMuaml0Q29uZmlnUGF0aCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdSVU5ORVJfTkFNRScsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucnVubmVyTmFtZVBhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUlVOTkVSX0xBQkVMJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5sYWJlbHNQYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1JVTk5FUl9HUk9VUDEnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiB0aGlzLmdyb3VwID8gJy0tcnVubmVyZ3JvdXAnIDogJycsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUlVOTkVSX0dST1VQMicsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHRoaXMuZ3JvdXAgPyB0aGlzLmdyb3VwIDogJycsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnREVGQVVMVF9MQUJFTFMnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiB0aGlzLmRlZmF1bHRMYWJlbHMgPyAnJyA6ICctLW5vLWRlZmF1bHQtbGFiZWxzJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdHSVRIVUJfRE9NQUlOJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5naXRodWJEb21haW5QYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ09XTkVSJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5vd25lclBhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUkVQTycsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucmVwb1BhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUkVHSVNUUkFUSU9OX1VSTCcsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucmVnaXN0cmF0aW9uVXJsLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgZ3JhbnRTdGF0ZU1hY2hpbmUoXzogaWFtLklHcmFudGFibGUpIHtcbiAgfVxuXG4gIHN0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGU6IGlhbS5JR3JhbnRhYmxlKTogSVJ1bm5lclByb3ZpZGVyU3RhdHVzIHtcbiAgICB0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5ncmFudChzdGF0dXNGdW5jdGlvblJvbGUsICdlY3I6RGVzY3JpYmVJbWFnZXMnKTtcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBsYWJlbHM6IHRoaXMubGFiZWxzLFxuICAgICAgY29uc3RydWN0UGF0aDogdGhpcy5ub2RlLnBhdGgsXG4gICAgICB2cGNBcm46IHRoaXMudnBjPy52cGNBcm4sXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIHJvbGVBcm46IHRoaXMudGFzay50YXNrUm9sZS5yb2xlQXJuLFxuICAgICAgbG9nR3JvdXA6IHRoaXMubG9nR3JvdXAubG9nR3JvdXBOYW1lLFxuICAgICAgaW1hZ2U6IHtcbiAgICAgICAgaW1hZ2VSZXBvc2l0b3J5OiB0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgICBpbWFnZVRhZzogdGhpcy5pbWFnZS5pbWFnZVRhZyxcbiAgICAgICAgaW1hZ2VCdWlsZGVyTG9nR3JvdXA6IHRoaXMuaW1hZ2UubG9nR3JvdXA/LmxvZ0dyb3VwTmFtZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxufVxuIl19