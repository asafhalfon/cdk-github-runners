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
 * Custom ECS EC2 launch target that allows specifying capacity provider strategy and propagating tags.
 */
class CustomEcsEc2LaunchTarget extends aws_cdk_lib_1.aws_stepfunctions_tasks.EcsEc2LaunchTarget {
    constructor(options) {
        super(options);
        this.capacityProvider = options.capacityProvider;
    }
    /**
     * Called when the ECS launch type configured on RunTask
     */
    bind(_task, _launchTargetOptions) {
        const base = super.bind(_task, _launchTargetOptions);
        return {
            ...base,
            parameters: {
                ...(base.parameters ?? {}),
                PropagateTags: aws_cdk_lib_1.aws_ecs.PropagatedTagSource.TASK_DEFINITION,
                CapacityProviderStrategy: [
                    {
                        CapacityProvider: this.capacityProvider,
                    },
                ],
                LaunchType: undefined, // You may choose a capacity provider or a launch type but not both.
            },
        };
    }
}
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
        this.cluster = props?.cluster ? props.cluster : new aws_cdk_lib_1.aws_ecs.Cluster(this, 'cluster', {
            vpc: this.vpc,
            enableFargateCapacityProviders: false,
        });
        if (props?.storageOptions && !props?.storageSize) {
            throw new Error('storageSize is required when storageOptions are specified');
        }
        const imageBuilder = props?.imageBuilder ?? EcsRunnerProvider.imageBuilder(this, 'Image Builder');
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
                blockDevices: props?.storageSize ? [
                    {
                        deviceName: (0, common_1.amiRootDevice)(this, this.defaultClusterInstanceAmi().getImage(this).imageId).ref,
                        volume: {
                            ebsDevice: {
                                deleteOnTermination: true,
                                volumeSize: props.storageSize.toGibibytes(),
                                volumeType: props.storageOptions?.volumeType,
                                iops: props.storageOptions?.iops,
                                throughput: props.storageOptions?.throughput,
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
        if (image.os.is(common_1.Os.WINDOWS)) {
            // https://github.com/aws/aws-cdk/issues/36805
            this.capacityProvider.autoScalingGroup.addUserData('[Environment]::SetEnvironmentVariable("ECS_ENABLE_TASK_IAM_ROLE", "true", "Machine")');
            this.capacityProvider.autoScalingGroup.addUserData(`Initialize-ECSAgent -Cluster '${this.cluster.clusterName}' -EnableTaskIAMRole`);
        }
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
            if (this.image.architecture.is(common_1.Architecture.X86_64)) {
                baseImage = aws_cdk_lib_1.aws_ecs.EcsOptimizedImage.amazonLinux2(aws_cdk_lib_1.aws_ecs.AmiHardwareType.STANDARD);
                ssmPath = '/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id';
                found = true;
            }
            if (this.image.architecture.is(common_1.Architecture.ARM64)) {
                baseImage = aws_cdk_lib_1.aws_ecs.EcsOptimizedImage.amazonLinux2(aws_cdk_lib_1.aws_ecs.AmiHardwareType.ARM);
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
            throw new Error(`Unable to find AMI for ECS instances for ${this.image.os.name}/${this.image.architecture.name}`);
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
            launchTarget: new CustomEcsEc2LaunchTarget({
                capacityProvider: this.capacityProvider.capacityProviderName,
                placementStrategies: this.placementStrategies,
                placementConstraints: this.placementConstraints,
            }),
            enableExecuteCommand: this.image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS),
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWNzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9lY3MudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxtQ0FBbUM7QUFDbkMsNkNBU3FCO0FBQ3JCLDJEQUEyRDtBQUMzRCxpREFBdUQ7QUFDdkQsbURBQXFEO0FBQ3JELHFFQUFtRTtBQUVuRSxxQ0Fha0I7QUFDbEIsdUNBQTBDO0FBQzFDLHNEQUEySDtBQUMzSCxvQ0FBOEg7QUF5TDlIOztHQUVHO0FBQ0gsTUFBTSx3QkFBeUIsU0FBUSxxQ0FBbUIsQ0FBQyxrQkFBa0I7SUFHM0UsWUFBWSxPQUFrQztRQUM1QyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDZixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsT0FBTyxDQUFDLGdCQUFnQixDQUFDO0lBQ25ELENBQUM7SUFFRDs7T0FFRztJQUNJLElBQUksQ0FBQyxLQUFxQyxFQUMvQyxvQkFBaUU7UUFDakUsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLEVBQUUsb0JBQW9CLENBQUMsQ0FBQztRQUNyRCxPQUFPO1lBQ0wsR0FBRyxJQUFJO1lBQ1AsVUFBVSxFQUFFO2dCQUNWLEdBQUcsQ0FBQyxJQUFJLENBQUMsVUFBVSxJQUFJLEVBQUUsQ0FBQztnQkFDMUIsYUFBYSxFQUFFLHFCQUFHLENBQUMsbUJBQW1CLENBQUMsZUFBZTtnQkFDdEQsd0JBQXdCLEVBQUU7b0JBQ3hCO3dCQUNFLGdCQUFnQixFQUFFLElBQUksQ0FBQyxnQkFBZ0I7cUJBQ3hDO2lCQUNGO2dCQUNELFVBQVUsRUFBRSxTQUFTLEVBQUUsb0VBQW9FO2FBQzVGO1NBQ0YsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQUVEOzs7Ozs7OztHQVFHO0FBQ0gsTUFBYSxpQkFBa0IsU0FBUSxxQkFBWTtJQUNqRDs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FpQkc7SUFDSSxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQWdCLEVBQUUsRUFB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OlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7XG4gIGF3c19lYzIgYXMgZWMyLFxuICBhd3NfZWNzIGFzIGVjcyxcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMsXG4gIGF3c19zdGVwZnVuY3Rpb25zX3Rhc2tzIGFzIHN0ZXBmdW5jdGlvbnNfdGFza3MsXG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrLFxufSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBhdXRvc2NhbGluZyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXV0b3NjYWxpbmcnO1xuaW1wb3J0IHsgTWFjaGluZUltYWdlVHlwZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3MnO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IEludGVncmF0aW9uUGF0dGVybiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zdGVwZnVuY3Rpb25zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHtcbiAgYW1pUm9vdERldmljZSxcbiAgQXJjaGl0ZWN0dXJlLFxuICBCYXNlUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyU3RhdHVzLFxuICBPcyxcbiAgUnVubmVySW1hZ2UsXG4gIFJ1bm5lclByb3ZpZGVyUHJvcHMsXG4gIFJ1bm5lclJ1bnRpbWVQYXJhbWV0ZXJzLFxuICBSdW5uZXJWZXJzaW9uLFxuICBnZW5lcmF0ZVN0YXRlTmFtZSxcbiAgU3RvcmFnZU9wdGlvbnMsXG59IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IGVjc1J1bkNvbW1hbmQgfSBmcm9tICcuL2ZhcmdhdGUnO1xuaW1wb3J0IHsgSVJ1bm5lckltYWdlQnVpbGRlciwgUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcywgUnVubmVySW1hZ2VDb21wb25lbnQgfSBmcm9tICcuLi9pbWFnZS1idWlsZGVycyc7XG5pbXBvcnQgeyBNSU5JTUFMX0VDMl9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQsIE1JTklNQUxfRUNTX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCB9IGZyb20gJy4uL3V0aWxzJztcblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBFY3NSdW5uZXJQcm92aWRlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBFY3NSdW5uZXJQcm92aWRlclByb3BzIGV4dGVuZHMgUnVubmVyUHJvdmlkZXJQcm9wcyB7XG4gIC8qKlxuICAgKiBSdW5uZXIgaW1hZ2UgYnVpbGRlciB1c2VkIHRvIGJ1aWxkIERvY2tlciBpbWFnZXMgY29udGFpbmluZyBHaXRIdWIgUnVubmVyIGFuZCBhbGwgcmVxdWlyZW1lbnRzLlxuICAgKlxuICAgKiBUaGUgaW1hZ2UgYnVpbGRlciBkZXRlcm1pbmVzIHRoZSBPUyBhbmQgYXJjaGl0ZWN0dXJlIG9mIHRoZSBydW5uZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IEVjc1J1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcigpXG4gICAqL1xuICByZWFkb25seSBpbWFnZUJ1aWxkZXI/OiBJUnVubmVySW1hZ2VCdWlsZGVyO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBsYWJlbHMgdXNlZCBmb3IgdGhpcyBwcm92aWRlci5cbiAgICpcbiAgICogVGhlc2UgbGFiZWxzIGFyZSB1c2VkIHRvIGlkZW50aWZ5IHdoaWNoIHByb3ZpZGVyIHNob3VsZCBzcGF3biBhIG5ldyBvbi1kZW1hbmQgcnVubmVyLiBFdmVyeSBqb2Igc2VuZHMgYSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBpdCdzIGxvb2tpbmcgZm9yXG4gICAqIGJhc2VkIG9uIHJ1bnMtb24uIFdlIG1hdGNoIHRoZSBsYWJlbHMgZnJvbSB0aGUgd2ViaG9vayB3aXRoIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUuIElmIGFsbCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlIGFyZSBwcmVzZW50IGluIHRoZVxuICAgKiBqb2IncyBsYWJlbHMsIHRoaXMgcHJvdmlkZXIgd2lsbCBiZSBjaG9zZW4gYW5kIHNwYXduIGEgbmV3IHJ1bm5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgWydlY3MnXVxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBncm91cCBuYW1lLlxuICAgKlxuICAgKiBJZiBzcGVjaWZpZWQsIHRoZSBydW5uZXIgd2lsbCBiZSByZWdpc3RlcmVkIHdpdGggdGhpcyBncm91cCBuYW1lLiBTZXR0aW5nIGEgcnVubmVyIGdyb3VwIGNhbiBoZWxwIG1hbmFnaW5nIGFjY2VzcyB0byBzZWxmLWhvc3RlZCBydW5uZXJzLiBJdFxuICAgKiByZXF1aXJlcyBhIHBhaWQgR2l0SHViIGFjY291bnQuXG4gICAqXG4gICAqIFRoZSBncm91cCBtdXN0IGV4aXN0IG9yIHRoZSBydW5uZXIgd2lsbCBub3Qgc3RhcnQuXG4gICAqXG4gICAqIFVzZXJzIHdpbGwgc3RpbGwgYmUgYWJsZSB0byB0cmlnZ2VyIHRoaXMgcnVubmVyIHdpdGggdGhlIGNvcnJlY3QgbGFiZWxzLiBCdXQgdGhlIHJ1bm5lciB3aWxsIG9ubHkgYmUgYWJsZSB0byBydW4gam9icyBmcm9tIHJlcG9zIGFsbG93ZWQgdG8gdXNlIHRoZSBncm91cC5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBncm91cD86IHN0cmluZztcblxuICAvKipcbiAgICogVlBDIHRvIGxhdW5jaCB0aGUgcnVubmVycyBpbi5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBhY2NvdW50IFZQQ1xuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFN1Ym5ldHMgdG8gcnVuIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBFQ1MgZGVmYXVsdFxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXBzIHRvIGFzc2lnbiB0byB0aGUgdGFzay5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgLyoqXG4gICAqIEV4aXN0aW5nIEVDUyBjbHVzdGVyIHRvIHVzZS5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgY2x1c3RlclxuICAgKi9cbiAgcmVhZG9ubHkgY2x1c3Rlcj86IGVjcy5DbHVzdGVyO1xuXG4gIC8qKlxuICAgKiBFeGlzdGluZyBjYXBhY2l0eSBwcm92aWRlciB0byB1c2UuXG4gICAqXG4gICAqIE1ha2Ugc3VyZSB0aGUgQU1JIHVzZWQgYnkgdGhlIGNhcGFjaXR5IHByb3ZpZGVyIGlzIGNvbXBhdGlibGUgd2l0aCBFQ1MuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5ldyBjYXBhY2l0eSBwcm92aWRlclxuICAgKi9cbiAgcmVhZG9ubHkgY2FwYWNpdHlQcm92aWRlcj86IGVjcy5Bc2dDYXBhY2l0eVByb3ZpZGVyO1xuXG4gIC8qKlxuICAgKiBBc3NpZ24gcHVibGljIElQIHRvIHRoZSBydW5uZXIgdGFzay5cbiAgICpcbiAgICogTWFrZSBzdXJlIHRoZSB0YXNrIHdpbGwgaGF2ZSBhY2Nlc3MgdG8gR2l0SHViLiBBIHB1YmxpYyBJUCBtaWdodCBiZSByZXF1aXJlZCB1bmxlc3MgeW91IGhhdmUgTkFUIGdhdGV3YXkuXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IGFzc2lnblB1YmxpY0lwPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBjcHUgdW5pdHMgdXNlZCBieSB0aGUgdGFzay4gMTAyNCB1bml0cyBpcyAxIHZDUFUuIEZyYWN0aW9ucyBvZiBhIHZDUFUgYXJlIHN1cHBvcnRlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgMTAyNFxuICAgKi9cbiAgcmVhZG9ubHkgY3B1PzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgYW1vdW50IChpbiBNaUIpIG9mIG1lbW9yeSB1c2VkIGJ5IHRoZSB0YXNrLlxuICAgKlxuICAgKiBAZGVmYXVsdCAzNTAwLCB1bmxlc3MgYG1lbW9yeVJlc2VydmF0aW9uTWlCYCBpcyB1c2VkIGFuZCB0aGVuIGl0J3MgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBtZW1vcnlMaW1pdE1pQj86IG51bWJlcjtcblxuICAvKipcbiAgICogVGhlIHNvZnQgbGltaXQgKGluIE1pQikgb2YgbWVtb3J5IHRvIHJlc2VydmUgZm9yIHRoZSBjb250YWluZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZFxuICAgKi9cbiAgcmVhZG9ubHkgbWVtb3J5UmVzZXJ2YXRpb25NaUI/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIEluc3RhbmNlIHR5cGUgb2YgRUNTIGNsdXN0ZXIgaW5zdGFuY2VzLiBPbmx5IHVzZWQgd2hlbiBjcmVhdGluZyBhIG5ldyBjbHVzdGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBtNmkubGFyZ2Ugb3IgbTZnLmxhcmdlXG4gICAqL1xuICByZWFkb25seSBpbnN0YW5jZVR5cGU/OiBlYzIuSW5zdGFuY2VUeXBlO1xuXG4gIC8qKlxuICAgKiBUaGUgbWluaW11bSBudW1iZXIgb2YgaW5zdGFuY2VzIHRvIHJ1biBpbiB0aGUgY2x1c3Rlci4gT25seSB1c2VkIHdoZW4gY3JlYXRpbmcgYSBuZXcgY2x1c3Rlci5cbiAgICpcbiAgICogQGRlZmF1bHQgMFxuICAgKi9cbiAgcmVhZG9ubHkgbWluSW5zdGFuY2VzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgbWF4aW11bSBudW1iZXIgb2YgaW5zdGFuY2VzIHRvIHJ1biBpbiB0aGUgY2x1c3Rlci4gT25seSB1c2VkIHdoZW4gY3JlYXRpbmcgYSBuZXcgY2x1c3Rlci5cbiAgICpcbiAgICogQGRlZmF1bHQgNVxuICAgKi9cbiAgcmVhZG9ubHkgbWF4SW5zdGFuY2VzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBTaXplIG9mIHZvbHVtZSBhdmFpbGFibGUgZm9yIGxhdW5jaGVkIGNsdXN0ZXIgaW5zdGFuY2VzLiBUaGlzIG1vZGlmaWVzIHRoZSBib290IHZvbHVtZSBzaXplIGFuZCBkb2Vzbid0IGFkZCBhbnkgYWRkaXRpb25hbCB2b2x1bWVzLlxuICAgKlxuICAgKiBFYWNoIGluc3RhbmNlIGNhbiBiZSB1c2VkIGJ5IG11bHRpcGxlIHJ1bm5lcnMsIHNvIG1ha2Ugc3VyZSB0aGVyZSBpcyBlbm91Z2ggc3BhY2UgZm9yIGFsbCBvZiB0aGVtLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IHNpemUgZm9yIEFNSSAodXN1YWxseSAzMEdCIGZvciBMaW51eCBhbmQgNTBHQiBmb3IgV2luZG93cylcbiAgICovXG4gIHJlYWRvbmx5IHN0b3JhZ2VTaXplPzogY2RrLlNpemU7XG5cbiAgLyoqXG4gICAqIE9wdGlvbnMgZm9yIHJ1bm5lciBpbnN0YW5jZSBzdG9yYWdlIHZvbHVtZS5cbiAgICovXG4gIHJlYWRvbmx5IHN0b3JhZ2VPcHRpb25zPzogU3RvcmFnZU9wdGlvbnM7XG5cbiAgLyoqXG4gICAqIFN1cHBvcnQgYnVpbGRpbmcgYW5kIHJ1bm5pbmcgRG9ja2VyIGltYWdlcyBieSBlbmFibGluZyBEb2NrZXItaW4tRG9ja2VyIChkaW5kKSBhbmQgdGhlIHJlcXVpcmVkIENvZGVCdWlsZCBwcml2aWxlZ2VkIG1vZGUuIERpc2FibGluZyB0aGlzIGNhblxuICAgKiBzcGVlZCB1cCBwcm92aXNpb25pbmcgb2YgQ29kZUJ1aWxkIHJ1bm5lcnMuIElmIHlvdSBkb24ndCBpbnRlbmQgb24gcnVubmluZyBvciBidWlsZGluZyBEb2NrZXIgaW1hZ2VzLCBkaXNhYmxlIHRoaXMgZm9yIGZhc3RlciBzdGFydC11cCB0aW1lcy5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgZG9ja2VySW5Eb2NrZXI/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBVc2Ugc3BvdCBjYXBhY2l0eS5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2UgKHRydWUgaWYgc3BvdE1heFByaWNlIGlzIHNwZWNpZmllZClcbiAgICovXG4gIHJlYWRvbmx5IHNwb3Q/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHByaWNlIGZvciBzcG90IGluc3RhbmNlcy5cbiAgICovXG4gIHJlYWRvbmx5IHNwb3RNYXhQcmljZT86IHN0cmluZztcblxuICAvKipcbiAgICogRUNTIHBsYWNlbWVudCBzdHJhdGVnaWVzIHRvIGluZmx1ZW5jZSB0YXNrIHBsYWNlbWVudC5cbiAgICpcbiAgICogRXhhbXBsZTogW2Vjcy5QbGFjZW1lbnRTdHJhdGVneS5wYWNrZWRCeUNwdSgpXVxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWQgKG5vIHBsYWNlbWVudCBzdHJhdGVnaWVzKVxuICAgKi9cbiAgcmVhZG9ubHkgcGxhY2VtZW50U3RyYXRlZ2llcz86IGVjcy5QbGFjZW1lbnRTdHJhdGVneVtdO1xuXG4gIC8qKlxuICAgKiBFQ1MgcGxhY2VtZW50IGNvbnN0cmFpbnRzIHRvIGluZmx1ZW5jZSB0YXNrIHBsYWNlbWVudC5cbiAgICpcbiAgICogRXhhbXBsZTogW2Vjcy5QbGFjZW1lbnRDb25zdHJhaW50Lm1lbWJlck9mKCdlY3MtcGxhY2VtZW50JyldXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZCAobm8gcGxhY2VtZW50IGNvbnN0cmFpbnRzKVxuICAgKi9cbiAgcmVhZG9ubHkgcGxhY2VtZW50Q29uc3RyYWludHM/OiBlY3MuUGxhY2VtZW50Q29uc3RyYWludFtdO1xufVxuXG5pbnRlcmZhY2UgRWNzRWMyTGF1bmNoVGFyZ2V0T3B0aW9ucyBleHRlbmRzIHN0ZXBmdW5jdGlvbnNfdGFza3MuRWNzRWMyTGF1bmNoVGFyZ2V0T3B0aW9ucyB7XG4gIHJlYWRvbmx5IGNhcGFjaXR5UHJvdmlkZXI6IHN0cmluZztcbn1cblxuLyoqXG4gKiBDdXN0b20gRUNTIEVDMiBsYXVuY2ggdGFyZ2V0IHRoYXQgYWxsb3dzIHNwZWNpZnlpbmcgY2FwYWNpdHkgcHJvdmlkZXIgc3RyYXRlZ3kgYW5kIHByb3BhZ2F0aW5nIHRhZ3MuXG4gKi9cbmNsYXNzIEN1c3RvbUVjc0VjMkxhdW5jaFRhcmdldCBleHRlbmRzIHN0ZXBmdW5jdGlvbnNfdGFza3MuRWNzRWMyTGF1bmNoVGFyZ2V0IHtcbiAgcHJpdmF0ZSByZWFkb25seSBjYXBhY2l0eVByb3ZpZGVyOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogRWNzRWMyTGF1bmNoVGFyZ2V0T3B0aW9ucykge1xuICAgIHN1cGVyKG9wdGlvbnMpO1xuICAgIHRoaXMuY2FwYWNpdHlQcm92aWRlciA9IG9wdGlvbnMuY2FwYWNpdHlQcm92aWRlcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgd2hlbiB0aGUgRUNTIGxhdW5jaCB0eXBlIGNvbmZpZ3VyZWQgb24gUnVuVGFza1xuICAgKi9cbiAgcHVibGljIGJpbmQoX3Rhc2s6IHN0ZXBmdW5jdGlvbnNfdGFza3MuRWNzUnVuVGFzayxcbiAgICBfbGF1bmNoVGFyZ2V0T3B0aW9uczogc3RlcGZ1bmN0aW9uc190YXNrcy5MYXVuY2hUYXJnZXRCaW5kT3B0aW9ucyk6IHN0ZXBmdW5jdGlvbnNfdGFza3MuRWNzTGF1bmNoVGFyZ2V0Q29uZmlnIHtcbiAgICBjb25zdCBiYXNlID0gc3VwZXIuYmluZChfdGFzaywgX2xhdW5jaFRhcmdldE9wdGlvbnMpO1xuICAgIHJldHVybiB7XG4gICAgICAuLi5iYXNlLFxuICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAuLi4oYmFzZS5wYXJhbWV0ZXJzID8/IHt9KSxcbiAgICAgICAgUHJvcGFnYXRlVGFnczogZWNzLlByb3BhZ2F0ZWRUYWdTb3VyY2UuVEFTS19ERUZJTklUSU9OLFxuICAgICAgICBDYXBhY2l0eVByb3ZpZGVyU3RyYXRlZ3k6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBDYXBhY2l0eVByb3ZpZGVyOiB0aGlzLmNhcGFjaXR5UHJvdmlkZXIsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgTGF1bmNoVHlwZTogdW5kZWZpbmVkLCAvLyBZb3UgbWF5IGNob29zZSBhIGNhcGFjaXR5IHByb3ZpZGVyIG9yIGEgbGF1bmNoIHR5cGUgYnV0IG5vdCBib3RoLlxuICAgICAgfSxcbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogR2l0SHViIEFjdGlvbnMgcnVubmVyIHByb3ZpZGVyIHVzaW5nIEVDUyBvbiBFQzIgdG8gZXhlY3V0ZSBqb2JzLlxuICpcbiAqIEVDUyBjYW4gYmUgdXNlZnVsIHdoZW4geW91IHdhbnQgbW9yZSBjb250cm9sIG9mIHRoZSBpbmZyYXN0cnVjdHVyZSBydW5uaW5nIHRoZSBHaXRIdWIgQWN0aW9ucyBEb2NrZXIgY29udGFpbmVycy4gWW91IGNhbiBjb250cm9sIHRoZSBhdXRvc2NhbGluZ1xuICogZ3JvdXAgdG8gc2NhbGUgZG93biB0byB6ZXJvIGR1cmluZyB0aGUgbmlnaHQgYW5kIHNjYWxlIHVwIGR1cmluZyB3b3JrIGhvdXJzLiBUaGlzIHdheSB5b3UgY2FuIHN0aWxsIHNhdmUgbW9uZXksIGJ1dCBoYXZlIHRvIHdhaXQgbGVzcyBmb3JcbiAqIGluZnJhc3RydWN0dXJlIHRvIHNwaW4gdXAuXG4gKlxuICogVGhpcyBjb25zdHJ1Y3QgaXMgbm90IG1lYW50IHRvIGJlIHVzZWQgYnkgaXRzZWxmLiBJdCBzaG91bGQgYmUgcGFzc2VkIGluIHRoZSBwcm92aWRlcnMgcHJvcGVydHkgZm9yIEdpdEh1YlJ1bm5lcnMuXG4gKi9cbmV4cG9ydCBjbGFzcyBFY3NSdW5uZXJQcm92aWRlciBleHRlbmRzIEJhc2VQcm92aWRlciBpbXBsZW1lbnRzIElSdW5uZXJQcm92aWRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGUgbmV3IGltYWdlIGJ1aWxkZXIgdGhhdCBidWlsZHMgRUNTIHNwZWNpZmljIHJ1bm5lciBpbWFnZXMuXG4gICAqXG4gICAqIFlvdSBjYW4gY3VzdG9taXplIHRoZSBPUywgYXJjaGl0ZWN0dXJlLCBWUEMsIHN1Ym5ldCwgc2VjdXJpdHkgZ3JvdXBzLCBldGMuIGJ5IHBhc3NpbmcgaW4gcHJvcHMuXG4gICAqXG4gICAqIFlvdSBjYW4gYWRkIGNvbXBvbmVudHMgdG8gdGhlIGltYWdlIGJ1aWxkZXIgYnkgY2FsbGluZyBgaW1hZ2VCdWlsZGVyLmFkZENvbXBvbmVudCgpYC5cbiAgICpcbiAgICogVGhlIGRlZmF1bHQgT1MgaXMgVWJ1bnR1IHJ1bm5pbmcgb24geDY0IGFyY2hpdGVjdHVyZS5cbiAgICpcbiAgICogSW5jbHVkZWQgY29tcG9uZW50czpcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJlcXVpcmVkUGFja2FnZXMoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcigpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViUnVubmVyKClgXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGltYWdlQnVpbGRlcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJ1bm5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgcmV0dXJuIFJ1bm5lckltYWdlQnVpbGRlci5uZXcoc2NvcGUsIGlkLCB7XG4gICAgICBvczogT3MuTElOVVhfVUJVTlRVLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUuWDg2XzY0LFxuICAgICAgY29tcG9uZW50czogW1xuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcihwcm9wcz8ucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpKSxcbiAgICAgIF0sXG4gICAgICAuLi5wcm9wcyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDbHVzdGVyIGhvc3RpbmcgdGhlIHRhc2sgaG9zdGluZyB0aGUgcnVubmVyLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBjbHVzdGVyOiBlY3MuQ2x1c3RlcjtcblxuICAvKipcbiAgICogQ2FwYWNpdHkgcHJvdmlkZXIgdXNlZCB0byBzY2FsZSB0aGUgY2x1c3Rlci5cbiAgICpcbiAgICogVXNlIGNhcGFjaXR5UHJvdmlkZXIuYXV0b1NjYWxpbmdHcm91cCB0byBhY2Nlc3MgdGhlIGF1dG8gc2NhbGluZyBncm91cC4gVGhpcyBjYW4gaGVscCBzZXQgdXAgY3VzdG9tIHNjYWxpbmcgcG9saWNpZXMuXG4gICAqL1xuICByZWFkb25seSBjYXBhY2l0eVByb3ZpZGVyOiBlY3MuQXNnQ2FwYWNpdHlQcm92aWRlcjtcblxuICAvKipcbiAgICogRUNTIHRhc2sgaG9zdGluZyB0aGUgcnVubmVyLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSB0YXNrOiBlY3MuRWMyVGFza0RlZmluaXRpb247XG5cbiAgLyoqXG4gICAqIENvbnRhaW5lciBkZWZpbml0aW9uIGhvc3RpbmcgdGhlIHJ1bm5lci5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgY29udGFpbmVyOiBlY3MuQ29udGFpbmVyRGVmaW5pdGlvbjtcblxuICAvKipcbiAgICogTGFiZWxzIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHByb3ZpZGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogVlBDIHVzZWQgZm9yIGhvc3RpbmcgdGhlIHJ1bm5lciB0YXNrLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU3VibmV0cyB1c2VkIGZvciBob3N0aW5nIHRoZSBydW5uZXIgdGFzay5cbiAgICovXG4gIHByaXZhdGUgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogV2hldGhlciBydW5uZXIgdGFzayB3aWxsIGhhdmUgYSBwdWJsaWMgSVAuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGFzc2lnblB1YmxpY0lwOiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBHcmFudCBwcmluY2lwYWwgdXNlZCB0byBhZGQgcGVybWlzc2lvbnMgdG8gdGhlIHJ1bm5lciByb2xlLlxuICAgKi9cbiAgcmVhZG9ubHkgZ3JhbnRQcmluY2lwYWw6IGlhbS5JUHJpbmNpcGFsO1xuXG4gIC8qKlxuICAgKiBUaGUgbmV0d29yayBjb25uZWN0aW9ucyBhc3NvY2lhdGVkIHdpdGggdGhpcyByZXNvdXJjZS5cbiAgICovXG4gIHJlYWRvbmx5IGNvbm5lY3Rpb25zOiBlYzIuQ29ubmVjdGlvbnM7XG5cbiAgLyoqXG4gICAqIERvY2tlciBpbWFnZSBsb2FkZWQgd2l0aCBHaXRIdWIgQWN0aW9ucyBSdW5uZXIgYW5kIGl0cyBwcmVyZXF1aXNpdGVzLiBUaGUgaW1hZ2UgaXMgYnVpbHQgYnkgYW4gaW1hZ2UgYnVpbGRlciBhbmQgaXMgc3BlY2lmaWMgdG8gRUNTIHRhc2tzLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBpbWFnZTogUnVubmVySW1hZ2U7XG5cbiAgLyoqXG4gICAqIExvZyBncm91cCB3aGVyZSBwcm92aWRlZCBydW5uZXJzIHdpbGwgc2F2ZSB0aGVpciBsb2dzLlxuICAgKlxuICAgKiBOb3RlIHRoYXQgdGhpcyBpcyBub3QgdGhlIGpvYiBsb2csIGJ1dCB0aGUgcnVubmVyIGl0c2VsZi4gSXQgd2lsbCBub3QgY29udGFpbiBvdXRwdXQgZnJvbSB0aGUgR2l0SHViIEFjdGlvbiBidXQgb25seSBtZXRhZGF0YSBvbiBpdHMgZXhlY3V0aW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgbG9nR3JvdXA6IGxvZ3MuSUxvZ0dyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcHJvdmlkZXIuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogUnVuIGRvY2tlciBpbiBkb2NrZXIuXG4gICAqL1xuICBwcml2YXRlIHJlYWRvbmx5IGRpbmQ6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFJ1bm5lciBncm91cCBuYW1lLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBncm91cD86IHN0cmluZztcblxuICAvKipcbiAgICogSW5jbHVkZSBkZWZhdWx0IGxhYmVscyAoYXJjaCwgb3MsIHNlbGYtaG9zdGVkKSBmb3IgcnVubmVyLlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBkZWZhdWx0TGFiZWxzOiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBFQ1MgcGxhY2VtZW50IHN0cmF0ZWdpZXMgdG8gaW5mbHVlbmNlIHRhc2sgcGxhY2VtZW50LlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBwbGFjZW1lbnRTdHJhdGVnaWVzPzogZWNzLlBsYWNlbWVudFN0cmF0ZWd5W107XG5cbiAgLyoqXG4gICAqIEVDUyBwbGFjZW1lbnQgY29uc3RyYWludHMgdG8gaW5mbHVlbmNlIHRhc2sgcGxhY2VtZW50LlxuICAgKi9cbiAgcHJpdmF0ZSByZWFkb25seSBwbGFjZW1lbnRDb25zdHJhaW50cz86IGVjcy5QbGFjZW1lbnRDb25zdHJhaW50W107XG5cbiAgcmVhZG9ubHkgcmV0cnlhYmxlRXJyb3JzID0gW1xuICAgICdFY3MuRWNzRXhjZXB0aW9uJyxcbiAgICAnRUNTLkFtYXpvbkVDU0V4Y2VwdGlvbicsXG4gICAgJ0Vjcy5MaW1pdEV4Y2VlZGVkRXhjZXB0aW9uJyxcbiAgICAnRWNzLlVwZGF0ZUluUHJvZ3Jlc3NFeGNlcHRpb24nLFxuICBdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogRWNzUnVubmVyUHJvdmlkZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgdGhpcy5sYWJlbHMgPSBwcm9wcz8ubGFiZWxzID8/IFsnZWNzJ107XG4gICAgdGhpcy5ncm91cCA9IHByb3BzPy5ncm91cDtcbiAgICB0aGlzLmRlZmF1bHRMYWJlbHMgPSBwcm9wcz8uZGVmYXVsdExhYmVscyA/PyB0cnVlO1xuICAgIHRoaXMudnBjID0gcHJvcHM/LnZwYyA/PyBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ2RlZmF1bHQgdnBjJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgdGhpcy5zdWJuZXRTZWxlY3Rpb24gPSBwcm9wcz8uc3VibmV0U2VsZWN0aW9uO1xuICAgIHRoaXMuc2VjdXJpdHlHcm91cHMgPSBwcm9wcz8uc2VjdXJpdHlHcm91cHMgPz8gW25ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnc2VjdXJpdHkgZ3JvdXAnLCB7IHZwYzogdGhpcy52cGMgfSldO1xuICAgIHRoaXMuY29ubmVjdGlvbnMgPSBuZXcgZWMyLkNvbm5lY3Rpb25zKHsgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMgfSk7XG4gICAgdGhpcy5hc3NpZ25QdWJsaWNJcCA9IHByb3BzPy5hc3NpZ25QdWJsaWNJcCA/PyB0cnVlO1xuICAgIHRoaXMucGxhY2VtZW50U3RyYXRlZ2llcyA9IHByb3BzPy5wbGFjZW1lbnRTdHJhdGVnaWVzO1xuICAgIHRoaXMucGxhY2VtZW50Q29uc3RyYWludHMgPSBwcm9wcz8ucGxhY2VtZW50Q29uc3RyYWludHM7XG4gICAgdGhpcy5jbHVzdGVyID0gcHJvcHM/LmNsdXN0ZXIgPyBwcm9wcy5jbHVzdGVyIDogbmV3IGVjcy5DbHVzdGVyKFxuICAgICAgdGhpcyxcbiAgICAgICdjbHVzdGVyJyxcbiAgICAgIHtcbiAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgZW5hYmxlRmFyZ2F0ZUNhcGFjaXR5UHJvdmlkZXJzOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGlmIChwcm9wcz8uc3RvcmFnZU9wdGlvbnMgJiYgIXByb3BzPy5zdG9yYWdlU2l6ZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdzdG9yYWdlU2l6ZSBpcyByZXF1aXJlZCB3aGVuIHN0b3JhZ2VPcHRpb25zIGFyZSBzcGVjaWZpZWQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZUJ1aWxkZXIgPSBwcm9wcz8uaW1hZ2VCdWlsZGVyID8/IEVjc1J1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcih0aGlzLCAnSW1hZ2UgQnVpbGRlcicpO1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZSA9IGltYWdlQnVpbGRlci5iaW5kRG9ja2VySW1hZ2UoKTtcblxuICAgIGlmIChwcm9wcz8uY2FwYWNpdHlQcm92aWRlcikge1xuICAgICAgaWYgKHByb3BzPy5taW5JbnN0YW5jZXMgfHwgcHJvcHM/Lm1heEluc3RhbmNlcyB8fCBwcm9wcz8uaW5zdGFuY2VUeXBlIHx8IHByb3BzPy5zdG9yYWdlU2l6ZSB8fCBwcm9wcz8uc3BvdCB8fCBwcm9wcz8uc3BvdE1heFByaWNlKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdXaGVuIHVzaW5nIGEgY3VzdG9tIGNhcGFjaXR5IHByb3ZpZGVyLCBtaW5JbnN0YW5jZXMsIG1heEluc3RhbmNlcywgaW5zdGFuY2VUeXBlLCBzdG9yYWdlU2l6ZSwgc3BvdCwgYW5kIHNwb3RNYXhQcmljZSB3aWxsIGJlIGlnbm9yZWQuJyk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuY2FwYWNpdHlQcm92aWRlciA9IHByb3BzLmNhcGFjaXR5UHJvdmlkZXI7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHNwb3QgPSBwcm9wcz8uc3BvdCA/PyBwcm9wcz8uc3BvdE1heFByaWNlICE9PSB1bmRlZmluZWQ7XG5cbiAgICAgIGNvbnN0IGxhdW5jaFRlbXBsYXRlID0gbmV3IGVjMi5MYXVuY2hUZW1wbGF0ZSh0aGlzLCAnTGF1bmNoIFRlbXBsYXRlJywge1xuICAgICAgICBtYWNoaW5lSW1hZ2U6IHRoaXMuZGVmYXVsdENsdXN0ZXJJbnN0YW5jZUFtaSgpLFxuICAgICAgICBpbnN0YW5jZVR5cGU6IHByb3BzPy5pbnN0YW5jZVR5cGUgPz8gdGhpcy5kZWZhdWx0Q2x1c3Rlckluc3RhbmNlVHlwZSgpLFxuICAgICAgICBibG9ja0RldmljZXM6IHByb3BzPy5zdG9yYWdlU2l6ZSA/IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBkZXZpY2VOYW1lOiBhbWlSb290RGV2aWNlKHRoaXMsIHRoaXMuZGVmYXVsdENsdXN0ZXJJbnN0YW5jZUFtaSgpLmdldEltYWdlKHRoaXMpLmltYWdlSWQpLnJlZixcbiAgICAgICAgICAgIHZvbHVtZToge1xuICAgICAgICAgICAgICBlYnNEZXZpY2U6IHtcbiAgICAgICAgICAgICAgICBkZWxldGVPblRlcm1pbmF0aW9uOiB0cnVlLFxuICAgICAgICAgICAgICAgIHZvbHVtZVNpemU6IHByb3BzLnN0b3JhZ2VTaXplLnRvR2liaWJ5dGVzKCksXG4gICAgICAgICAgICAgICAgdm9sdW1lVHlwZTogcHJvcHMuc3RvcmFnZU9wdGlvbnM/LnZvbHVtZVR5cGUsXG4gICAgICAgICAgICAgICAgaW9wczogcHJvcHMuc3RvcmFnZU9wdGlvbnM/LmlvcHMsXG4gICAgICAgICAgICAgICAgdGhyb3VnaHB1dDogcHJvcHMuc3RvcmFnZU9wdGlvbnM/LnRocm91Z2hwdXQsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0gOiB1bmRlZmluZWQsXG4gICAgICAgIHNwb3RPcHRpb25zOiBzcG90ID8ge1xuICAgICAgICAgIHJlcXVlc3RUeXBlOiBlYzIuU3BvdFJlcXVlc3RUeXBlLk9ORV9USU1FLFxuICAgICAgICAgIG1heFByaWNlOiBwcm9wcz8uc3BvdE1heFByaWNlID8gcGFyc2VGbG9hdChwcm9wcz8uc3BvdE1heFByaWNlKSA6IHVuZGVmaW5lZCxcbiAgICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgICAgcmVxdWlyZUltZHN2MjogdHJ1ZSxcbiAgICAgICAgc2VjdXJpdHlHcm91cDogdGhpcy5zZWN1cml0eUdyb3Vwc1swXSxcbiAgICAgICAgcm9sZTogbmV3IGlhbS5Sb2xlKHRoaXMsICdMYXVuY2ggVGVtcGxhdGUgUm9sZScsIHtcbiAgICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWMyLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgfSksXG4gICAgICAgIHVzZXJEYXRhOiBlYzIuVXNlckRhdGEuZm9yT3BlcmF0aW5nU3lzdGVtKGltYWdlLm9zLmlzKE9zLldJTkRPV1MpID8gZWMyLk9wZXJhdGluZ1N5c3RlbVR5cGUuV0lORE9XUyA6IGVjMi5PcGVyYXRpbmdTeXN0ZW1UeXBlLkxJTlVYKSxcbiAgICAgIH0pO1xuICAgICAgdGhpcy5zZWN1cml0eUdyb3Vwcy5zbGljZSgxKS5tYXAoc2cgPT4gbGF1bmNoVGVtcGxhdGUuY29ubmVjdGlvbnMuYWRkU2VjdXJpdHlHcm91cChzZykpO1xuXG4gICAgICBjb25zdCBhdXRvU2NhbGluZ0dyb3VwID0gbmV3IGF1dG9zY2FsaW5nLkF1dG9TY2FsaW5nR3JvdXAodGhpcywgJ0F1dG8gU2NhbGluZyBHcm91cCcsIHtcbiAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgbGF1bmNoVGVtcGxhdGUsXG4gICAgICAgIHZwY1N1Ym5ldHM6IHRoaXMuc3VibmV0U2VsZWN0aW9uLFxuICAgICAgICBtaW5DYXBhY2l0eTogcHJvcHM/Lm1pbkluc3RhbmNlcyA/PyAwLFxuICAgICAgICBtYXhDYXBhY2l0eTogcHJvcHM/Lm1heEluc3RhbmNlcyA/PyA1LFxuICAgICAgfSk7XG5cbiAgICAgIHRoaXMuY2FwYWNpdHlQcm92aWRlciA9IHByb3BzPy5jYXBhY2l0eVByb3ZpZGVyID8/IG5ldyBlY3MuQXNnQ2FwYWNpdHlQcm92aWRlcih0aGlzLCAnQ2FwYWNpdHkgUHJvdmlkZXInLCB7XG4gICAgICAgIGF1dG9TY2FsaW5nR3JvdXAsXG4gICAgICAgIHNwb3RJbnN0YW5jZURyYWluaW5nOiBmYWxzZSwgLy8gd2FzdGUgb2YgbW9uZXkgdG8gcmVzdGFydCBqb2JzIGFzIHRoZSByZXN0YXJ0ZWQgam9iIHdvbid0IGhhdmUgYSB0b2tlblxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5jYXBhY2l0eVByb3ZpZGVyLmF1dG9TY2FsaW5nR3JvdXAuYWRkVXNlckRhdGEoXG4gICAgICAvLyB3ZSBkb24ndCBleGl0IG9uIGVycm9ycyBiZWNhdXNlIGFsbCBvZiB0aGVzZSBjb21tYW5kcyBhcmUgb3B0aW9uYWxcbiAgICAgIC4uLnRoaXMubG9naW5Db21tYW5kcygpLFxuICAgICAgdGhpcy5wdWxsQ29tbWFuZCgpLFxuICAgICAgLi4udGhpcy5lY3NTZXR0aW5nc0NvbW1hbmRzKCksXG4gICAgKTtcbiAgICB0aGlzLmNhcGFjaXR5UHJvdmlkZXIuYXV0b1NjYWxpbmdHcm91cC5yb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KE1JTklNQUxfRUMyX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCk7XG4gICAgaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LmdyYW50UHVsbCh0aGlzLmNhcGFjaXR5UHJvdmlkZXIuYXV0b1NjYWxpbmdHcm91cCk7XG5cbiAgICB0aGlzLmNsdXN0ZXIuYWRkQXNnQ2FwYWNpdHlQcm92aWRlcihcbiAgICAgIHRoaXMuY2FwYWNpdHlQcm92aWRlcixcbiAgICAgIHtcbiAgICAgICAgc3BvdEluc3RhbmNlRHJhaW5pbmc6IGZhbHNlLFxuICAgICAgICBtYWNoaW5lSW1hZ2VUeXBlOiBNYWNoaW5lSW1hZ2VUeXBlLkFNQVpPTl9MSU5VWF8yLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgaWYgKGltYWdlLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vYXdzL2F3cy1jZGsvaXNzdWVzLzM2ODA1XG4gICAgICB0aGlzLmNhcGFjaXR5UHJvdmlkZXIuYXV0b1NjYWxpbmdHcm91cC5hZGRVc2VyRGF0YSgnW0Vudmlyb25tZW50XTo6U2V0RW52aXJvbm1lbnRWYXJpYWJsZShcIkVDU19FTkFCTEVfVEFTS19JQU1fUk9MRVwiLCBcInRydWVcIiwgXCJNYWNoaW5lXCIpJyk7XG4gICAgICB0aGlzLmNhcGFjaXR5UHJvdmlkZXIuYXV0b1NjYWxpbmdHcm91cC5hZGRVc2VyRGF0YShgSW5pdGlhbGl6ZS1FQ1NBZ2VudCAtQ2x1c3RlciAnJHt0aGlzLmNsdXN0ZXIuY2x1c3Rlck5hbWV9JyAtRW5hYmxlVGFza0lBTVJvbGVgKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ2xvZ3MnLCB7XG4gICAgICByZXRlbnRpb246IHByb3BzPy5sb2dSZXRlbnRpb24gPz8gUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICB0aGlzLmRpbmQgPSAocHJvcHM/LmRvY2tlckluRG9ja2VyID8/IHRydWUpICYmICFpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKTtcblxuICAgIHRoaXMudGFzayA9IG5ldyBlY3MuRWMyVGFza0RlZmluaXRpb24odGhpcywgJ3Rhc2snKTtcbiAgICB0aGlzLmNvbnRhaW5lciA9IHRoaXMudGFzay5hZGRDb250YWluZXIoXG4gICAgICAncnVubmVyJyxcbiAgICAgIHtcbiAgICAgICAgaW1hZ2U6IGVjcy5Bc3NldEltYWdlLmZyb21FY3JSZXBvc2l0b3J5KGltYWdlLmltYWdlUmVwb3NpdG9yeSwgaW1hZ2UuaW1hZ2VUYWcpLFxuICAgICAgICBjcHU6IHByb3BzPy5jcHUgPz8gMTAyNCxcbiAgICAgICAgbWVtb3J5TGltaXRNaUI6IHByb3BzPy5tZW1vcnlMaW1pdE1pQiA/PyAocHJvcHM/Lm1lbW9yeVJlc2VydmF0aW9uTWlCID8gdW5kZWZpbmVkIDogMzUwMCksXG4gICAgICAgIG1lbW9yeVJlc2VydmF0aW9uTWlCOiBwcm9wcz8ubWVtb3J5UmVzZXJ2YXRpb25NaUIsXG4gICAgICAgIGxvZ2dpbmc6IGVjcy5Bd3NMb2dEcml2ZXIuYXdzTG9ncyh7XG4gICAgICAgICAgbG9nR3JvdXA6IHRoaXMubG9nR3JvdXAsXG4gICAgICAgICAgc3RyZWFtUHJlZml4OiAncnVubmVyJyxcbiAgICAgICAgfSksXG4gICAgICAgIGNvbW1hbmQ6IGVjc1J1bkNvbW1hbmQodGhpcy5pbWFnZS5vcywgdGhpcy5kaW5kKSxcbiAgICAgICAgdXNlcjogaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykgPyB1bmRlZmluZWQgOiAncnVubmVyJyxcbiAgICAgICAgcHJpdmlsZWdlZDogdGhpcy5kaW5kLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgdGhpcy5ncmFudFByaW5jaXBhbCA9IHRoaXMudGFzay50YXNrUm9sZTtcblxuICAgIC8vIHBlcm1pc3Npb25zIGZvciBTU00gU2Vzc2lvbiBNYW5hZ2VyXG4gICAgdGhpcy50YXNrLnRhc2tSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KE1JTklNQUxfRUNTX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCk7XG4gIH1cblxuICBwcml2YXRlIGRlZmF1bHRDbHVzdGVySW5zdGFuY2VUeXBlKCkge1xuICAgIGlmICh0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgcmV0dXJuIGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuTTZJLCBlYzIuSW5zdGFuY2VTaXplLkxBUkdFKTtcbiAgICB9XG4gICAgaWYgKHRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgIHJldHVybiBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLk02RywgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZmluZCBpbnN0YW5jZSB0eXBlIGZvciBFQ1MgaW5zdGFuY2VzIGZvciAke3RoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gIH1cblxuICBwcml2YXRlIGRlZmF1bHRDbHVzdGVySW5zdGFuY2VBbWkoKSB7XG4gICAgbGV0IGJhc2VJbWFnZTogZWMyLklNYWNoaW5lSW1hZ2U7XG4gICAgbGV0IHNzbVBhdGg6IHN0cmluZztcbiAgICBsZXQgZm91bmQgPSBmYWxzZTtcblxuICAgIGlmICh0aGlzLmltYWdlLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgIGlmICh0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICBiYXNlSW1hZ2UgPSBlY3MuRWNzT3B0aW1pemVkSW1hZ2UuYW1hem9uTGludXgyKGVjcy5BbWlIYXJkd2FyZVR5cGUuU1RBTkRBUkQpO1xuICAgICAgICBzc21QYXRoID0gJy9hd3Mvc2VydmljZS9lY3Mvb3B0aW1pemVkLWFtaS9hbWF6b24tbGludXgtMjAyMy9yZWNvbW1lbmRlZC9pbWFnZV9pZCc7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgIGJhc2VJbWFnZSA9IGVjcy5FY3NPcHRpbWl6ZWRJbWFnZS5hbWF6b25MaW51eDIoZWNzLkFtaUhhcmR3YXJlVHlwZS5BUk0pO1xuICAgICAgICBzc21QYXRoID0gJy9hd3Mvc2VydmljZS9lY3Mvb3B0aW1pemVkLWFtaS9hbWF6b24tbGludXgtMjAyMy9hcm02NC9yZWNvbW1lbmRlZC9pbWFnZV9pZCc7XG4gICAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5pbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgYmFzZUltYWdlID0gZWNzLkVjc09wdGltaXplZEltYWdlLndpbmRvd3MoZWNzLldpbmRvd3NPcHRpbWl6ZWRWZXJzaW9uLlNFUlZFUl8yMDE5KTtcbiAgICAgIHNzbVBhdGggPSAnL2F3cy9zZXJ2aWNlL2FtaS13aW5kb3dzLWxhdGVzdC9XaW5kb3dzX1NlcnZlci0yMDE5LUVuZ2xpc2gtRnVsbC1FQ1NfT3B0aW1pemVkL2ltYWdlX2lkJztcbiAgICAgIGZvdW5kID0gdHJ1ZTtcbiAgICB9XG5cbiAgICBpZiAoIWZvdW5kKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBmaW5kIEFNSSBmb3IgRUNTIGluc3RhbmNlcyBmb3IgJHt0aGlzLmltYWdlLm9zLm5hbWV9LyR7dGhpcy5pbWFnZS5hcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBpbWFnZTogZWMyLklNYWNoaW5lSW1hZ2UgPSB7XG4gICAgICBnZXRJbWFnZShzY29wZTogQ29uc3RydWN0KTogZWMyLk1hY2hpbmVJbWFnZUNvbmZpZyB7XG4gICAgICAgIGNvbnN0IGJhc2VJbWFnZVJlcyA9IGJhc2VJbWFnZS5nZXRJbWFnZShzY29wZSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBpbWFnZUlkOiBgcmVzb2x2ZTpzc206JHtzc21QYXRofWAsXG4gICAgICAgICAgdXNlckRhdGE6IGJhc2VJbWFnZVJlcy51c2VyRGF0YSxcbiAgICAgICAgICBvc1R5cGU6IGJhc2VJbWFnZVJlcy5vc1R5cGUsXG4gICAgICAgIH07XG4gICAgICB9LFxuICAgIH07XG5cbiAgICByZXR1cm4gaW1hZ2U7XG4gIH1cblxuICBwcml2YXRlIHB1bGxDb21tYW5kKCkge1xuICAgIGlmICh0aGlzLmltYWdlLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICByZXR1cm4gYFN0YXJ0LUpvYiAtU2NyaXB0QmxvY2sgeyBkb2NrZXIgcHVsbCAke3RoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcml9OiR7dGhpcy5pbWFnZS5pbWFnZVRhZ30gfWA7XG4gICAgfVxuICAgIHJldHVybiBgZG9ja2VyIHB1bGwgJHt0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpfToke3RoaXMuaW1hZ2UuaW1hZ2VUYWd9ICZgO1xuICB9XG5cbiAgcHJpdmF0ZSBsb2dpbkNvbW1hbmRzKCkge1xuICAgIGNvbnN0IHRoaXNTdGFjayA9IFN0YWNrLm9mKHRoaXMpO1xuICAgIGlmICh0aGlzLmltYWdlLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICByZXR1cm4gW2AoR2V0LUVDUkxvZ2luQ29tbWFuZCkuUGFzc3dvcmQgfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAke3RoaXNTdGFjay5hY2NvdW50fS5ka3IuZWNyLiR7dGhpc1N0YWNrLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWBdO1xuICAgIH1cbiAgICByZXR1cm4gW1xuICAgICAgJ3l1bSBpbnN0YWxsIC15IGF3c2NsaSB8fCBkbmYgaW5zdGFsbCAteSBhd3NjbGknLFxuICAgICAgYGF3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uICR7dGhpc1N0YWNrLnJlZ2lvbn0gfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAke3RoaXNTdGFjay5hY2NvdW50fS5ka3IuZWNyLiR7dGhpc1N0YWNrLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsXG4gICAgXTtcbiAgfVxuXG4gIHByaXZhdGUgZWNzU2V0dGluZ3NDb21tYW5kcygpIHtcbiAgICAvLyBkb24ndCBsZXQgRUNTIGFjY3VtdWxhdGUgdG9vIG1hbnkgc3RvcHBlZCB0YXNrcyB0aGF0IGNhbiBlbmQgdXAgdmVyeSBiaWcgaW4gb3VyIGNhc2VcbiAgICAvLyB0aGUgZGVmYXVsdCBpcyAxMG0gZHVyYXRpb24gd2l0aCAxaCBqaXR0ZXIgd2hpY2ggY2FuIGVuZCB1cCB3aXRoIDFoMTBtIGRlbGF5IGZvciBjbGVhbmluZyB1cCBzdG9wcGVkIHRhc2tzXG4gICAgaWYgKHRoaXMuaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgICdbRW52aXJvbm1lbnRdOjpTZXRFbnZpcm9ubWVudFZhcmlhYmxlKFwiRUNTX0VOR0lORV9UQVNLX0NMRUFOVVBfV0FJVF9EVVJBVElPTlwiLCBcIjVzXCIsIFwiTWFjaGluZVwiKScsXG4gICAgICAgICdbRW52aXJvbm1lbnRdOjpTZXRFbnZpcm9ubWVudFZhcmlhYmxlKFwiRUNTX0VOR0lORV9UQVNLX0NMRUFOVVBfV0FJVF9EVVJBVElPTl9KSVRURVJcIiwgXCI1c1wiLCBcIk1hY2hpbmVcIiknLFxuICAgICAgXTtcbiAgICB9XG4gICAgcmV0dXJuIFtcbiAgICAgICdlY2hvIEVDU19FTkdJTkVfVEFTS19DTEVBTlVQX1dBSVRfRFVSQVRJT049NXMgPj4gL2V0Yy9lY3MvZWNzLmNvbmZpZycsXG4gICAgICAnZWNobyBFQ1NfRU5HSU5FX1RBU0tfQ0xFQU5VUF9XQUlUX0RVUkFUSU9OX0pJVFRFUj01cyA+PiAvZXRjL2Vjcy9lY3MuY29uZmlnJyxcbiAgICBdO1xuICB9XG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlIHN0ZXAgZnVuY3Rpb24gdGFzayhzKSB0byBzdGFydCBhIG5ldyBydW5uZXIuXG4gICAqXG4gICAqIENhbGxlZCBieSBHaXRodWJSdW5uZXJzIGFuZCBzaG91bGRuJ3QgYmUgY2FsbGVkIG1hbnVhbGx5LlxuICAgKlxuICAgKiBAcGFyYW0gcGFyYW1ldGVycyB3b3JrZmxvdyBqb2IgZGV0YWlsc1xuICAgKi9cbiAgZ2V0U3RlcEZ1bmN0aW9uVGFzayhwYXJhbWV0ZXJzOiBSdW5uZXJSdW50aW1lUGFyYW1ldGVycyk6IHN0ZXBmdW5jdGlvbnMuSUNoYWluYWJsZSB7XG4gICAgcmV0dXJuIG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLkVjc1J1blRhc2soXG4gICAgICB0aGlzLFxuICAgICAgJ1N0YXRlJyxcbiAgICAgIHtcbiAgICAgICAgc3RhdGVOYW1lOiBnZW5lcmF0ZVN0YXRlTmFtZSh0aGlzKSxcbiAgICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBJbnRlZ3JhdGlvblBhdHRlcm4uUlVOX0pPQiwgLy8gc3luY1xuICAgICAgICB0YXNrRGVmaW5pdGlvbjogdGhpcy50YXNrLFxuICAgICAgICBjbHVzdGVyOiB0aGlzLmNsdXN0ZXIsXG4gICAgICAgIGxhdW5jaFRhcmdldDogbmV3IEN1c3RvbUVjc0VjMkxhdW5jaFRhcmdldCh7XG4gICAgICAgICAgY2FwYWNpdHlQcm92aWRlcjogdGhpcy5jYXBhY2l0eVByb3ZpZGVyLmNhcGFjaXR5UHJvdmlkZXJOYW1lLFxuICAgICAgICAgIHBsYWNlbWVudFN0cmF0ZWdpZXM6IHRoaXMucGxhY2VtZW50U3RyYXRlZ2llcyxcbiAgICAgICAgICBwbGFjZW1lbnRDb25zdHJhaW50czogdGhpcy5wbGFjZW1lbnRDb25zdHJhaW50cyxcbiAgICAgICAgfSksXG4gICAgICAgIGVuYWJsZUV4ZWN1dGVDb21tYW5kOiB0aGlzLmltYWdlLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUyksXG4gICAgICAgIGFzc2lnblB1YmxpY0lwOiB0aGlzLmFzc2lnblB1YmxpY0lwLFxuICAgICAgICBjb250YWluZXJPdmVycmlkZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBjb250YWluZXJEZWZpbml0aW9uOiB0aGlzLmNvbnRhaW5lcixcbiAgICAgICAgICAgIGVudmlyb25tZW50OiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUlVOTkVSX1RPS0VOJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5ydW5uZXJUb2tlblBhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnSklUX0NPTkZJRycsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMuaml0Q29uZmlnUGF0aCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdSVU5ORVJfTkFNRScsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucnVubmVyTmFtZVBhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUlVOTkVSX0xBQkVMJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5sYWJlbHNQYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1JVTk5FUl9HUk9VUDEnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiB0aGlzLmdyb3VwID8gJy0tcnVubmVyZ3JvdXAnIDogJycsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUlVOTkVSX0dST1VQMicsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHRoaXMuZ3JvdXAgPyB0aGlzLmdyb3VwIDogJycsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnREVGQVVMVF9MQUJFTFMnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiB0aGlzLmRlZmF1bHRMYWJlbHMgPyAnJyA6ICctLW5vLWRlZmF1bHQtbGFiZWxzJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdHSVRIVUJfRE9NQUlOJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5naXRodWJEb21haW5QYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ09XTkVSJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5vd25lclBhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUkVQTycsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucmVwb1BhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUkVHSVNUUkFUSU9OX1VSTCcsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucmVnaXN0cmF0aW9uVXJsLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgZ3JhbnRTdGF0ZU1hY2hpbmUoXzogaWFtLklHcmFudGFibGUpIHtcbiAgfVxuXG4gIHN0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGU6IGlhbS5JR3JhbnRhYmxlKTogSVJ1bm5lclByb3ZpZGVyU3RhdHVzIHtcbiAgICB0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5ncmFudChzdGF0dXNGdW5jdGlvblJvbGUsICdlY3I6RGVzY3JpYmVJbWFnZXMnKTtcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBsYWJlbHM6IHRoaXMubGFiZWxzLFxuICAgICAgY29uc3RydWN0UGF0aDogdGhpcy5ub2RlLnBhdGgsXG4gICAgICB2cGNBcm46IHRoaXMudnBjPy52cGNBcm4sXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIHJvbGVBcm46IHRoaXMudGFzay50YXNrUm9sZS5yb2xlQXJuLFxuICAgICAgbG9nR3JvdXA6IHRoaXMubG9nR3JvdXAubG9nR3JvdXBOYW1lLFxuICAgICAgaW1hZ2U6IHtcbiAgICAgICAgaW1hZ2VSZXBvc2l0b3J5OiB0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgICBpbWFnZVRhZzogdGhpcy5pbWFnZS5pbWFnZVRhZyxcbiAgICAgICAgaW1hZ2VCdWlsZGVyTG9nR3JvdXA6IHRoaXMuaW1hZ2UubG9nR3JvdXA/LmxvZ0dyb3VwTmFtZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxufVxuIl19