"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FargateRunner = exports.FargateRunnerProvider = void 0;
exports.ecsRunCommand = ecsRunCommand;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const path = require("path");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_stepfunctions_1 = require("aws-cdk-lib/aws-stepfunctions");
const common_1 = require("./common");
const image_builders_1 = require("../image-builders");
const utils_1 = require("../utils");
/**
 * Our special launch target that can use spot instances and set EnableExecuteCommand.
 */
class EcsFargateLaunchTarget {
    constructor(props) {
        this.props = props;
    }
    /**
     * Called when the Fargate launch type configured on RunTask
     */
    bind(_task, launchTargetOptions) {
        if (!launchTargetOptions.taskDefinition.isFargateCompatible) {
            throw new Error('Supplied TaskDefinition is not compatible with Fargate');
        }
        return {
            parameters: {
                PropagateTags: aws_cdk_lib_1.aws_ecs.PropagatedTagSource.TASK_DEFINITION,
                CapacityProviderStrategy: [
                    {
                        CapacityProvider: this.props.spot ? 'FARGATE_SPOT' : 'FARGATE',
                    },
                ],
            },
        };
    }
}
/**
 * @internal
 */
function ecsRunCommand(os, dind) {
    if (os.isIn(common_1.Os._ALL_LINUX_VERSIONS)) {
        let dindCommand = '';
        if (dind) {
            dindCommand = 'nohup sudo dockerd --host=unix:///var/run/docker.sock --host=tcp://127.0.0.1:2375 --storage-driver=overlay2 & ' +
                'timeout 15 sh -c "until docker info; do echo .; sleep 1; done"';
        }
        return [
            'sh', '-c',
            `${dindCommand}
        cd /home/runner &&
        if [ -n "$JIT_CONFIG" ]; then
          echo "JIT mode enabled, skipping config.sh" &&
          ./run.sh --jitconfig "$JIT_CONFIG"
        else
          if [ "$RUNNER_VERSION" = "latest" ]; then RUNNER_FLAGS=""; else RUNNER_FLAGS="--disableupdate"; fi &&
          ./config.sh --unattended --url "$REGISTRATION_URL" --token "$RUNNER_TOKEN" --ephemeral --work _work --labels "$RUNNER_LABEL,cdkghr:started:\`date +%s\`" $RUNNER_FLAGS --name "$RUNNER_NAME" $RUNNER_GROUP1 $RUNNER_GROUP2 $DEFAULT_LABELS &&
          ./run.sh
        fi &&
        STATUS=$(grep -Phors "finish job request for job [0-9a-f-]+ with result: .*" _diag | tail -n1 | awk '{print $NF}') &&
        [ -n "$STATUS" ] && echo CDKGHA JOB DONE "$RUNNER_LABEL" "$STATUS"`,
        ];
    }
    else if (os.is(common_1.Os.WINDOWS)) {
        return [
            'powershell', '-Command',
            `cd \\actions ;
        if ($Env:RUNNER_VERSION -eq "latest") { $RunnerFlags = "" } else { $RunnerFlags = "--disableupdate" } ;
        ./config.cmd --unattended --url "\${Env:REGISTRATION_URL}" --token "\${Env:RUNNER_TOKEN}" --ephemeral --work _work --labels "\${Env:RUNNER_LABEL},cdkghr:started:\$(Get-Date -UFormat +%s)" $RunnerFlags --name "\${Env:RUNNER_NAME}" \${Env:RUNNER_GROUP1} \${Env:RUNNER_GROUP2} \${Env:DEFAULT_LABELS} ;
        ./run.cmd ;
        $STATUS = Select-String -Path './_diag/*.log' -Pattern 'finish job request for job [0-9a-f\\-]+ with result: (.*)' | %{$_.Matches.Groups[1].Value} | Select-Object -Last 1 ;
        if ($STATUS) { echo "CDKGHA JOB DONE $\{Env:RUNNER_LABEL\} $STATUS" }`,
        ];
    }
    else {
        throw new Error(`Fargate runner doesn't support ${os.name}`);
    }
}
/**
 * GitHub Actions runner provider using Fargate to execute jobs.
 *
 * Creates a task definition with a single container that gets started for each job.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
class FargateRunnerProvider extends common_1.BaseProvider {
    /**
     * Create new image builder that builds Fargate specific runner images.
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
                image_builders_1.RunnerImageComponent.githubRunner(props?.runnerVersion ?? common_1.RunnerVersion.latest()),
            ],
            ...props,
        });
    }
    constructor(scope, id, props) {
        super(scope, id, props);
        this.retryableErrors = [
            'Ecs.EcsException',
            'Ecs.LimitExceededException',
            'Ecs.UpdateInProgressException',
        ];
        this.labels = this.labelsFromProperties('fargate', props?.label, props?.labels);
        this.group = props?.group;
        this.defaultLabels = props?.defaultLabels ?? true;
        this.vpc = props?.vpc ?? aws_cdk_lib_1.aws_ec2.Vpc.fromLookup(this, 'default vpc', { isDefault: true });
        this.subnetSelection = props?.subnetSelection;
        this.securityGroups = props?.securityGroup ? [props.securityGroup] : (props?.securityGroups ?? [new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, 'security group', { vpc: this.vpc })]);
        this.connections = new aws_cdk_lib_1.aws_ec2.Connections({ securityGroups: this.securityGroups });
        this.assignPublicIp = props?.assignPublicIp ?? true;
        this.cluster = props?.cluster ? props.cluster : new aws_cdk_lib_1.aws_ecs.Cluster(this, 'cluster', {
            vpc: this.vpc,
            enableFargateCapacityProviders: true,
        });
        this.spot = props?.spot ?? false;
        const imageBuilder = props?.imageBuilder ?? FargateRunnerProvider.imageBuilder(this, 'Image Builder');
        const image = this.image = imageBuilder.bindDockerImage();
        let arch;
        if (image.architecture.is(common_1.Architecture.ARM64)) {
            arch = aws_cdk_lib_1.aws_ecs.CpuArchitecture.ARM64;
        }
        else if (image.architecture.is(common_1.Architecture.X86_64)) {
            arch = aws_cdk_lib_1.aws_ecs.CpuArchitecture.X86_64;
        }
        else {
            throw new Error(`${image.architecture.name} is not supported on Fargate`);
        }
        let os;
        if (image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS)) {
            os = aws_cdk_lib_1.aws_ecs.OperatingSystemFamily.LINUX;
        }
        else if (image.os.is(common_1.Os.WINDOWS)) {
            os = aws_cdk_lib_1.aws_ecs.OperatingSystemFamily.WINDOWS_SERVER_2019_CORE;
            if (props?.ephemeralStorageGiB) {
                throw new Error('Ephemeral storage is not supported on Fargate Windows');
            }
        }
        else {
            throw new Error(`${image.os.name} is not supported on Fargate`);
        }
        this.logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'logs', {
            retention: props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        this.task = new aws_cdk_lib_1.aws_ecs.FargateTaskDefinition(this, 'task', {
            cpu: props?.cpu ?? 1024,
            memoryLimitMiB: props?.memoryLimitMiB ?? 2048,
            ephemeralStorageGiB: props?.ephemeralStorageGiB ?? (!image.os.is(common_1.Os.WINDOWS) ? 25 : undefined),
            runtimePlatform: {
                operatingSystemFamily: os,
                cpuArchitecture: arch,
            },
        });
        this.container = this.task.addContainer('runner', {
            image: aws_cdk_lib_1.aws_ecs.AssetImage.fromEcrRepository(image.imageRepository, image.imageTag),
            logging: aws_cdk_lib_1.aws_ecs.AwsLogDriver.awsLogs({
                logGroup: this.logGroup,
                streamPrefix: 'runner',
            }),
            command: ecsRunCommand(this.image.os, false),
            user: image.os.is(common_1.Os.WINDOWS) ? undefined : 'runner',
        });
        this.grantPrincipal = this.task.taskRole;
        // allow SSM Session Manager
        this.task.taskRole.addToPrincipalPolicy(utils_1.MINIMAL_SSM_SESSION_MANAGER_POLICY_STATEMENT);
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
            launchTarget: new EcsFargateLaunchTarget({
                spot: this.spot,
            }),
            enableExecuteCommand: this.image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS),
            subnets: this.subnetSelection,
            assignPublicIp: this.assignPublicIp,
            securityGroups: this.securityGroups,
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
exports.FargateRunnerProvider = FargateRunnerProvider;
_a = JSII_RTTI_SYMBOL_1;
FargateRunnerProvider[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.FargateRunnerProvider", version: "0.0.0" };
/**
 * Path to Dockerfile for Linux x64 with all the requirement for Fargate runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
 *
 * Available build arguments that can be set in the image builder:
 * * `BASE_IMAGE` sets the `FROM` line. This should be an Ubuntu compatible image.
 * * `EXTRA_PACKAGES` can be used to install additional packages.
 *
 * @deprecated Use `imageBuilder()` instead.
 */
FargateRunnerProvider.LINUX_X64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'fargate', 'linux-x64');
/**
 * Path to Dockerfile for Linux ARM64 with all the requirement for Fargate runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
 *
 * Available build arguments that can be set in the image builder:
 * * `BASE_IMAGE` sets the `FROM` line. This should be an Ubuntu compatible image.
 * * `EXTRA_PACKAGES` can be used to install additional packages.
 *
 * @deprecated Use `imageBuilder()` instead.
 */
FargateRunnerProvider.LINUX_ARM64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'fargate', 'linux-arm64');
/**
 * @deprecated use {@link FargateRunnerProvider}
 */
class FargateRunner extends FargateRunnerProvider {
}
exports.FargateRunner = FargateRunner;
_b = JSII_RTTI_SYMBOL_1;
FargateRunner[_b] = { fqn: "@cloudsnorkel/cdk-github-runners.FargateRunner", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFyZ2F0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvZmFyZ2F0ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7O0FBd05BLHNDQW9DQzs7QUE1UEQsNkJBQTZCO0FBQzdCLDZDQVFxQjtBQUNyQixtREFBcUQ7QUFDckQscUVBQW1FO0FBRW5FLHFDQVdrQjtBQUNsQixzREFBMkg7QUFDM0gsb0NBQXdFO0FBOEp4RTs7R0FFRztBQUNILE1BQU0sc0JBQXNCO0lBQzFCLFlBQXFCLEtBQWtDO1FBQWxDLFVBQUssR0FBTCxLQUFLLENBQTZCO0lBQ3ZELENBQUM7SUFFRDs7T0FFRztJQUNJLElBQUksQ0FBQyxLQUFxQyxFQUMvQyxtQkFBZ0U7UUFDaEUsSUFBSSxDQUFDLG1CQUFtQixDQUFDLGNBQWMsQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1lBQzVELE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQztRQUM1RSxDQUFDO1FBRUQsT0FBTztZQUNMLFVBQVUsRUFBRTtnQkFDVixhQUFhLEVBQUUscUJBQUcsQ0FBQyxtQkFBbUIsQ0FBQyxlQUFlO2dCQUN0RCx3QkFBd0IsRUFBRTtvQkFDeEI7d0JBQ0UsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxDQUFDLENBQUMsU0FBUztxQkFDL0Q7aUJBQ0Y7YUFDRjtTQUNGLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFFRDs7R0FFRztBQUNILFNBQWdCLGFBQWEsQ0FBQyxFQUFNLEVBQUUsSUFBYTtJQUNqRCxJQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsV0FBRSxDQUFDLG1CQUFtQixDQUFDLEVBQUUsQ0FBQztRQUNwQyxJQUFJLFdBQVcsR0FBRyxFQUFFLENBQUM7UUFDckIsSUFBSSxJQUFJLEVBQUUsQ0FBQztZQUNULFdBQVcsR0FBRyxnSEFBZ0g7Z0JBQzVILGdFQUFnRSxDQUFDO1FBQ3JF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c0RBbVVDOzs7QUFsVUM7Ozs7Ozs7O0dBUUc7QUFDb0IsK0NBQXlCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxXQUFXLENBQUMsQUFBdEYsQ0FBdUY7QUFFdkk7Ozs7Ozs7O0dBUUc7QUFDb0IsaURBQTJCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLFNBQVMsRUFBRSxhQUFhLENBQUMsQUFBeEYsQ0FBeUY7QUFnVDdJOztHQUVHO0FBQ0gsTUFBYSxhQUFjLFNBQVEscUJBQXFCOztBQUF4RCxzQ0FDQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQge1xuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2VjcyBhcyBlY3MsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3Nfc3RlcGZ1bmN0aW9ucyBhcyBzdGVwZnVuY3Rpb25zLFxuICBhd3Nfc3RlcGZ1bmN0aW9uc190YXNrcyBhcyBzdGVwZnVuY3Rpb25zX3Rhc2tzLFxuICBSZW1vdmFsUG9saWN5LFxufSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgSW50ZWdyYXRpb25QYXR0ZXJuIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQge1xuICBBcmNoaXRlY3R1cmUsXG4gIEJhc2VQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXJTdGF0dXMsXG4gIE9zLFxuICBSdW5uZXJJbWFnZSxcbiAgUnVubmVyUHJvdmlkZXJQcm9wcyxcbiAgUnVubmVyUnVudGltZVBhcmFtZXRlcnMsXG4gIFJ1bm5lclZlcnNpb24sXG4gIGdlbmVyYXRlU3RhdGVOYW1lLFxufSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQgeyBJUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXIsIFJ1bm5lckltYWdlQnVpbGRlclByb3BzLCBSdW5uZXJJbWFnZUNvbXBvbmVudCB9IGZyb20gJy4uL2ltYWdlLWJ1aWxkZXJzJztcbmltcG9ydCB7IE1JTklNQUxfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIEZhcmdhdGVSdW5uZXJQcm92aWRlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBGYXJnYXRlUnVubmVyUHJvdmlkZXJQcm9wcyBleHRlbmRzIFJ1bm5lclByb3ZpZGVyUHJvcHMge1xuICAvKipcbiAgICogUnVubmVyIGltYWdlIGJ1aWxkZXIgdXNlZCB0byBidWlsZCBEb2NrZXIgaW1hZ2VzIGNvbnRhaW5pbmcgR2l0SHViIFJ1bm5lciBhbmQgYWxsIHJlcXVpcmVtZW50cy5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgZGV0ZXJtaW5lcyB0aGUgT1MgYW5kIGFyY2hpdGVjdHVyZSBvZiB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBGYXJnYXRlUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKClcbiAgICovXG4gIHJlYWRvbmx5IGltYWdlQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVsIHVzZWQgZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZFxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIGxhYmVsc30gaW5zdGVhZFxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWw/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2ZhcmdhdGUnXVxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBncm91cCBuYW1lLlxuICAgKlxuICAgKiBJZiBzcGVjaWZpZWQsIHRoZSBydW5uZXIgd2lsbCBiZSByZWdpc3RlcmVkIHdpdGggdGhpcyBncm91cCBuYW1lLiBTZXR0aW5nIGEgcnVubmVyIGdyb3VwIGNhbiBoZWxwIG1hbmFnaW5nIGFjY2VzcyB0byBzZWxmLWhvc3RlZCBydW5uZXJzLiBJdFxuICAgKiByZXF1aXJlcyBhIHBhaWQgR2l0SHViIGFjY291bnQuXG4gICAqXG4gICAqIFRoZSBncm91cCBtdXN0IGV4aXN0IG9yIHRoZSBydW5uZXIgd2lsbCBub3Qgc3RhcnQuXG4gICAqXG4gICAqIFVzZXJzIHdpbGwgc3RpbGwgYmUgYWJsZSB0byB0cmlnZ2VyIHRoaXMgcnVubmVyIHdpdGggdGhlIGNvcnJlY3QgbGFiZWxzLiBCdXQgdGhlIHJ1bm5lciB3aWxsIG9ubHkgYmUgYWJsZSB0byBydW4gam9icyBmcm9tIHJlcG9zIGFsbG93ZWQgdG8gdXNlIHRoZSBncm91cC5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBncm91cD86IHN0cmluZztcblxuICAvKipcbiAgICogVlBDIHRvIGxhdW5jaCB0aGUgcnVubmVycyBpbi5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBhY2NvdW50IFZQQ1xuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFN1Ym5ldHMgdG8gcnVuIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBGYXJnYXRlIGRlZmF1bHRcbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwIHRvIGFzc2lnbiB0byB0aGUgdGFzay5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBzZWN1cml0eUdyb3Vwc31cbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA/OiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwcyB0byBhc3NpZ24gdG8gdGhlIHRhc2suXG4gICAqXG4gICAqIEBkZWZhdWx0IGEgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3Vwcz86IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIC8qKlxuICAgKiBFeGlzdGluZyBGYXJnYXRlIGNsdXN0ZXIgdG8gdXNlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBjbHVzdGVyXG4gICAqL1xuICByZWFkb25seSBjbHVzdGVyPzogZWNzLkNsdXN0ZXI7XG5cbiAgLyoqXG4gICAqIEFzc2lnbiBwdWJsaWMgSVAgdG8gdGhlIHJ1bm5lciB0YXNrLlxuICAgKlxuICAgKiBNYWtlIHN1cmUgdGhlIHRhc2sgd2lsbCBoYXZlIGFjY2VzcyB0byBHaXRIdWIuIEEgcHVibGljIElQIG1pZ2h0IGJlIHJlcXVpcmVkIHVubGVzcyB5b3UgaGF2ZSBOQVQgZ2F0ZXdheS5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgYXNzaWduUHVibGljSXA/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGNwdSB1bml0cyB1c2VkIGJ5IHRoZSB0YXNrLiBGb3IgdGFza3MgdXNpbmcgdGhlIEZhcmdhdGUgbGF1bmNoIHR5cGUsXG4gICAqIHRoaXMgZmllbGQgaXMgcmVxdWlyZWQgYW5kIHlvdSBtdXN0IHVzZSBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXMsXG4gICAqIHdoaWNoIGRldGVybWluZXMgeW91ciByYW5nZSBvZiB2YWxpZCB2YWx1ZXMgZm9yIHRoZSBtZW1vcnkgcGFyYW1ldGVyOlxuICAgKlxuICAgKiAyNTYgKC4yNSB2Q1BVKSAtIEF2YWlsYWJsZSBtZW1vcnkgdmFsdWVzOiA1MTIgKDAuNSBHQiksIDEwMjQgKDEgR0IpLCAyMDQ4ICgyIEdCKVxuICAgKlxuICAgKiA1MTIgKC41IHZDUFUpIC0gQXZhaWxhYmxlIG1lbW9yeSB2YWx1ZXM6IDEwMjQgKDEgR0IpLCAyMDQ4ICgyIEdCKSwgMzA3MiAoMyBHQiksIDQwOTYgKDQgR0IpXG4gICAqXG4gICAqIDEwMjQgKDEgdkNQVSkgLSBBdmFpbGFibGUgbWVtb3J5IHZhbHVlczogMjA0OCAoMiBHQiksIDMwNzIgKDMgR0IpLCA0MDk2ICg0IEdCKSwgNTEyMCAoNSBHQiksIDYxNDQgKDYgR0IpLCA3MTY4ICg3IEdCKSwgODE5MiAoOCBHQilcbiAgICpcbiAgICogMjA0OCAoMiB2Q1BVKSAtIEF2YWlsYWJsZSBtZW1vcnkgdmFsdWVzOiBCZXR3ZWVuIDQwOTYgKDQgR0IpIGFuZCAxNjM4NCAoMTYgR0IpIGluIGluY3JlbWVudHMgb2YgMTAyNCAoMSBHQilcbiAgICpcbiAgICogNDA5NiAoNCB2Q1BVKSAtIEF2YWlsYWJsZSBtZW1vcnkgdmFsdWVzOiBCZXR3ZWVuIDgxOTIgKDggR0IpIGFuZCAzMDcyMCAoMzAgR0IpIGluIGluY3JlbWVudHMgb2YgMTAyNCAoMSBHQilcbiAgICpcbiAgICogQGRlZmF1bHQgMTAyNFxuICAgKi9cbiAgcmVhZG9ubHkgY3B1PzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgYW1vdW50IChpbiBNaUIpIG9mIG1lbW9yeSB1c2VkIGJ5IHRoZSB0YXNrLiBGb3IgdGFza3MgdXNpbmcgdGhlIEZhcmdhdGUgbGF1bmNoIHR5cGUsXG4gICAqIHRoaXMgZmllbGQgaXMgcmVxdWlyZWQgYW5kIHlvdSBtdXN0IHVzZSBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXMsIHdoaWNoIGRldGVybWluZXMgeW91ciByYW5nZSBvZiB2YWxpZCB2YWx1ZXMgZm9yIHRoZSBjcHUgcGFyYW1ldGVyOlxuICAgKlxuICAgKiA1MTIgKDAuNSBHQiksIDEwMjQgKDEgR0IpLCAyMDQ4ICgyIEdCKSAtIEF2YWlsYWJsZSBjcHUgdmFsdWVzOiAyNTYgKC4yNSB2Q1BVKVxuICAgKlxuICAgKiAxMDI0ICgxIEdCKSwgMjA0OCAoMiBHQiksIDMwNzIgKDMgR0IpLCA0MDk2ICg0IEdCKSAtIEF2YWlsYWJsZSBjcHUgdmFsdWVzOiA1MTIgKC41IHZDUFUpXG4gICAqXG4gICAqIDIwNDggKDIgR0IpLCAzMDcyICgzIEdCKSwgNDA5NiAoNCBHQiksIDUxMjAgKDUgR0IpLCA2MTQ0ICg2IEdCKSwgNzE2OCAoNyBHQiksIDgxOTIgKDggR0IpIC0gQXZhaWxhYmxlIGNwdSB2YWx1ZXM6IDEwMjQgKDEgdkNQVSlcbiAgICpcbiAgICogQmV0d2VlbiA0MDk2ICg0IEdCKSBhbmQgMTYzODQgKDE2IEdCKSBpbiBpbmNyZW1lbnRzIG9mIDEwMjQgKDEgR0IpIC0gQXZhaWxhYmxlIGNwdSB2YWx1ZXM6IDIwNDggKDIgdkNQVSlcbiAgICpcbiAgICogQmV0d2VlbiA4MTkyICg4IEdCKSBhbmQgMzA3MjAgKDMwIEdCKSBpbiBpbmNyZW1lbnRzIG9mIDEwMjQgKDEgR0IpIC0gQXZhaWxhYmxlIGNwdSB2YWx1ZXM6IDQwOTYgKDQgdkNQVSlcbiAgICpcbiAgICogQGRlZmF1bHQgMjA0OFxuICAgKi9cbiAgcmVhZG9ubHkgbWVtb3J5TGltaXRNaUI/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBhbW91bnQgKGluIEdpQikgb2YgZXBoZW1lcmFsIHN0b3JhZ2UgdG8gYmUgYWxsb2NhdGVkIHRvIHRoZSB0YXNrLiBUaGUgbWF4aW11bSBzdXBwb3J0ZWQgdmFsdWUgaXMgMjAwIEdpQi5cbiAgICpcbiAgICogTk9URTogVGhpcyBwYXJhbWV0ZXIgaXMgb25seSBzdXBwb3J0ZWQgZm9yIHRhc2tzIGhvc3RlZCBvbiBBV1MgRmFyZ2F0ZSB1c2luZyBwbGF0Zm9ybSB2ZXJzaW9uIDEuNC4wIG9yIGxhdGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCAyMFxuICAgKi9cbiAgcmVhZG9ubHkgZXBoZW1lcmFsU3RvcmFnZUdpQj86IG51bWJlcjtcblxuICAvKipcbiAgICogVXNlIEZhcmdhdGUgc3BvdCBjYXBhY2l0eSBwcm92aWRlciB0byBzYXZlIG1vbmV5LlxuICAgKlxuICAgKiAqIFJ1bm5lcnMgbWF5IGZhaWwgdG8gc3RhcnQgZHVlIHRvIG1pc3NpbmcgY2FwYWNpdHkuXG4gICAqICogUnVubmVycyBtaWdodCBiZSBzdG9wcGVkIHByZW1hdHVyZWx5IHdpdGggc3BvdCBwcmljaW5nLlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgRWNzRmFyZ2F0ZUxhdW5jaFRhcmdldC5cbiAqL1xuaW50ZXJmYWNlIEVjc0ZhcmdhdGVMYXVuY2hUYXJnZXRQcm9wcyB7XG4gIHJlYWRvbmx5IHNwb3Q6IGJvb2xlYW47XG59XG5cbi8qKlxuICogT3VyIHNwZWNpYWwgbGF1bmNoIHRhcmdldCB0aGF0IGNhbiB1c2Ugc3BvdCBpbnN0YW5jZXMgYW5kIHNldCBFbmFibGVFeGVjdXRlQ29tbWFuZC5cbiAqL1xuY2xhc3MgRWNzRmFyZ2F0ZUxhdW5jaFRhcmdldCBpbXBsZW1lbnRzIHN0ZXBmdW5jdGlvbnNfdGFza3MuSUVjc0xhdW5jaFRhcmdldCB7XG4gIGNvbnN0cnVjdG9yKHJlYWRvbmx5IHByb3BzOiBFY3NGYXJnYXRlTGF1bmNoVGFyZ2V0UHJvcHMpIHtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgd2hlbiB0aGUgRmFyZ2F0ZSBsYXVuY2ggdHlwZSBjb25maWd1cmVkIG9uIFJ1blRhc2tcbiAgICovXG4gIHB1YmxpYyBiaW5kKF90YXNrOiBzdGVwZnVuY3Rpb25zX3Rhc2tzLkVjc1J1blRhc2ssXG4gICAgbGF1bmNoVGFyZ2V0T3B0aW9uczogc3RlcGZ1bmN0aW9uc190YXNrcy5MYXVuY2hUYXJnZXRCaW5kT3B0aW9ucyk6IHN0ZXBmdW5jdGlvbnNfdGFza3MuRWNzTGF1bmNoVGFyZ2V0Q29uZmlnIHtcbiAgICBpZiAoIWxhdW5jaFRhcmdldE9wdGlvbnMudGFza0RlZmluaXRpb24uaXNGYXJnYXRlQ29tcGF0aWJsZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdTdXBwbGllZCBUYXNrRGVmaW5pdGlvbiBpcyBub3QgY29tcGF0aWJsZSB3aXRoIEZhcmdhdGUnKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICBQcm9wYWdhdGVUYWdzOiBlY3MuUHJvcGFnYXRlZFRhZ1NvdXJjZS5UQVNLX0RFRklOSVRJT04sXG4gICAgICAgIENhcGFjaXR5UHJvdmlkZXJTdHJhdGVneTogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIENhcGFjaXR5UHJvdmlkZXI6IHRoaXMucHJvcHMuc3BvdCA/ICdGQVJHQVRFX1NQT1QnIDogJ0ZBUkdBVEUnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVjc1J1bkNvbW1hbmQob3M6IE9zLCBkaW5kOiBib29sZWFuKTogc3RyaW5nW10ge1xuICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1ZFUlNJT05TKSkge1xuICAgIGxldCBkaW5kQ29tbWFuZCA9ICcnO1xuICAgIGlmIChkaW5kKSB7XG4gICAgICBkaW5kQ29tbWFuZCA9ICdub2h1cCBzdWRvIGRvY2tlcmQgLS1ob3N0PXVuaXg6Ly8vdmFyL3J1bi9kb2NrZXIuc29jayAtLWhvc3Q9dGNwOi8vMTI3LjAuMC4xOjIzNzUgLS1zdG9yYWdlLWRyaXZlcj1vdmVybGF5MiAmICcgK1xuICAgICAgICAndGltZW91dCAxNSBzaCAtYyBcInVudGlsIGRvY2tlciBpbmZvOyBkbyBlY2hvIC47IHNsZWVwIDE7IGRvbmVcIic7XG4gICAgfVxuXG4gICAgcmV0dXJuIFtcbiAgICAgICdzaCcsICctYycsXG4gICAgICBgJHtkaW5kQ29tbWFuZH1cbiAgICAgICAgY2QgL2hvbWUvcnVubmVyICYmXG4gICAgICAgIGlmIFsgLW4gXCIkSklUX0NPTkZJR1wiIF07IHRoZW5cbiAgICAgICAgICBlY2hvIFwiSklUIG1vZGUgZW5hYmxlZCwgc2tpcHBpbmcgY29uZmlnLnNoXCIgJiZcbiAgICAgICAgICAuL3J1bi5zaCAtLWppdGNvbmZpZyBcIiRKSVRfQ09ORklHXCJcbiAgICAgICAgZWxzZVxuICAgICAgICAgIGlmIFsgXCIkUlVOTkVSX1ZFUlNJT05cIiA9IFwibGF0ZXN0XCIgXTsgdGhlbiBSVU5ORVJfRkxBR1M9XCJcIjsgZWxzZSBSVU5ORVJfRkxBR1M9XCItLWRpc2FibGV1cGRhdGVcIjsgZmkgJiZcbiAgICAgICAgICAuL2NvbmZpZy5zaCAtLXVuYXR0ZW5kZWQgLS11cmwgXCIkUkVHSVNUUkFUSU9OX1VSTFwiIC0tdG9rZW4gXCIkUlVOTkVSX1RPS0VOXCIgLS1lcGhlbWVyYWwgLS13b3JrIF93b3JrIC0tbGFiZWxzIFwiJFJVTk5FUl9MQUJFTCxjZGtnaHI6c3RhcnRlZDpcXGBkYXRlICslc1xcYFwiICRSVU5ORVJfRkxBR1MgLS1uYW1lIFwiJFJVTk5FUl9OQU1FXCIgJFJVTk5FUl9HUk9VUDEgJFJVTk5FUl9HUk9VUDIgJERFRkFVTFRfTEFCRUxTICYmXG4gICAgICAgICAgLi9ydW4uc2hcbiAgICAgICAgZmkgJiZcbiAgICAgICAgU1RBVFVTPSQoZ3JlcCAtUGhvcnMgXCJmaW5pc2ggam9iIHJlcXVlc3QgZm9yIGpvYiBbMC05YS1mLV0rIHdpdGggcmVzdWx0OiAuKlwiIF9kaWFnIHwgdGFpbCAtbjEgfCBhd2sgJ3twcmludCAkTkZ9JykgJiZcbiAgICAgICAgWyAtbiBcIiRTVEFUVVNcIiBdICYmIGVjaG8gQ0RLR0hBIEpPQiBET05FIFwiJFJVTk5FUl9MQUJFTFwiIFwiJFNUQVRVU1wiYCxcbiAgICBdO1xuICB9IGVsc2UgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgcmV0dXJuIFtcbiAgICAgICdwb3dlcnNoZWxsJywgJy1Db21tYW5kJyxcbiAgICAgIGBjZCBcXFxcYWN0aW9ucyA7XG4gICAgICAgIGlmICgkRW52OlJVTk5FUl9WRVJTSU9OIC1lcSBcImxhdGVzdFwiKSB7ICRSdW5uZXJGbGFncyA9IFwiXCIgfSBlbHNlIHsgJFJ1bm5lckZsYWdzID0gXCItLWRpc2FibGV1cGRhdGVcIiB9IDtcbiAgICAgICAgLi9jb25maWcuY21kIC0tdW5hdHRlbmRlZCAtLXVybCBcIlxcJHtFbnY6UkVHSVNUUkFUSU9OX1VSTH1cIiAtLXRva2VuIFwiXFwke0VudjpSVU5ORVJfVE9LRU59XCIgLS1lcGhlbWVyYWwgLS13b3JrIF93b3JrIC0tbGFiZWxzIFwiXFwke0VudjpSVU5ORVJfTEFCRUx9LGNka2docjpzdGFydGVkOlxcJChHZXQtRGF0ZSAtVUZvcm1hdCArJXMpXCIgJFJ1bm5lckZsYWdzIC0tbmFtZSBcIlxcJHtFbnY6UlVOTkVSX05BTUV9XCIgXFwke0VudjpSVU5ORVJfR1JPVVAxfSBcXCR7RW52OlJVTk5FUl9HUk9VUDJ9IFxcJHtFbnY6REVGQVVMVF9MQUJFTFN9IDtcbiAgICAgICAgLi9ydW4uY21kIDtcbiAgICAgICAgJFNUQVRVUyA9IFNlbGVjdC1TdHJpbmcgLVBhdGggJy4vX2RpYWcvKi5sb2cnIC1QYXR0ZXJuICdmaW5pc2ggam9iIHJlcXVlc3QgZm9yIGpvYiBbMC05YS1mXFxcXC1dKyB3aXRoIHJlc3VsdDogKC4qKScgfCAleyRfLk1hdGNoZXMuR3JvdXBzWzFdLlZhbHVlfSB8IFNlbGVjdC1PYmplY3QgLUxhc3QgMSA7XG4gICAgICAgIGlmICgkU1RBVFVTKSB7IGVjaG8gXCJDREtHSEEgSk9CIERPTkUgJFxce0VudjpSVU5ORVJfTEFCRUxcXH0gJFNUQVRVU1wiIH1gLFxuICAgIF07XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGYXJnYXRlIHJ1bm5lciBkb2Vzbid0IHN1cHBvcnQgJHtvcy5uYW1lfWApO1xuICB9XG59XG5cbi8qKlxuICogR2l0SHViIEFjdGlvbnMgcnVubmVyIHByb3ZpZGVyIHVzaW5nIEZhcmdhdGUgdG8gZXhlY3V0ZSBqb2JzLlxuICpcbiAqIENyZWF0ZXMgYSB0YXNrIGRlZmluaXRpb24gd2l0aCBhIHNpbmdsZSBjb250YWluZXIgdGhhdCBnZXRzIHN0YXJ0ZWQgZm9yIGVhY2ggam9iLlxuICpcbiAqIFRoaXMgY29uc3RydWN0IGlzIG5vdCBtZWFudCB0byBiZSB1c2VkIGJ5IGl0c2VsZi4gSXQgc2hvdWxkIGJlIHBhc3NlZCBpbiB0aGUgcHJvdmlkZXJzIHByb3BlcnR5IGZvciBHaXRIdWJSdW5uZXJzLlxuICovXG5leHBvcnQgY2xhc3MgRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqXG4gICAqIFBhdGggdG8gRG9ja2VyZmlsZSBmb3IgTGludXggeDY0IHdpdGggYWxsIHRoZSByZXF1aXJlbWVudCBmb3IgRmFyZ2F0ZSBydW5uZXIuIFVzZSB0aGlzIERvY2tlcmZpbGUgdW5sZXNzIHlvdSBuZWVkIHRvIGN1c3RvbWl6ZSBpdCBmdXJ0aGVyIHRoYW4gYWxsb3dlZCBieSBob29rcy5cbiAgICpcbiAgICogQXZhaWxhYmxlIGJ1aWxkIGFyZ3VtZW50cyB0aGF0IGNhbiBiZSBzZXQgaW4gdGhlIGltYWdlIGJ1aWxkZXI6XG4gICAqICogYEJBU0VfSU1BR0VgIHNldHMgdGhlIGBGUk9NYCBsaW5lLiBUaGlzIHNob3VsZCBiZSBhbiBVYnVudHUgY29tcGF0aWJsZSBpbWFnZS5cbiAgICogKiBgRVhUUkFfUEFDS0FHRVNgIGNhbiBiZSB1c2VkIHRvIGluc3RhbGwgYWRkaXRpb25hbCBwYWNrYWdlcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBpbWFnZUJ1aWxkZXIoKWAgaW5zdGVhZC5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgTElOVVhfWDY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdmYXJnYXRlJywgJ2xpbnV4LXg2NCcpO1xuXG4gIC8qKlxuICAgKiBQYXRoIHRvIERvY2tlcmZpbGUgZm9yIExpbnV4IEFSTTY0IHdpdGggYWxsIHRoZSByZXF1aXJlbWVudCBmb3IgRmFyZ2F0ZSBydW5uZXIuIFVzZSB0aGlzIERvY2tlcmZpbGUgdW5sZXNzIHlvdSBuZWVkIHRvIGN1c3RvbWl6ZSBpdCBmdXJ0aGVyIHRoYW4gYWxsb3dlZCBieSBob29rcy5cbiAgICpcbiAgICogQXZhaWxhYmxlIGJ1aWxkIGFyZ3VtZW50cyB0aGF0IGNhbiBiZSBzZXQgaW4gdGhlIGltYWdlIGJ1aWxkZXI6XG4gICAqICogYEJBU0VfSU1BR0VgIHNldHMgdGhlIGBGUk9NYCBsaW5lLiBUaGlzIHNob3VsZCBiZSBhbiBVYnVudHUgY29tcGF0aWJsZSBpbWFnZS5cbiAgICogKiBgRVhUUkFfUEFDS0FHRVNgIGNhbiBiZSB1c2VkIHRvIGluc3RhbGwgYWRkaXRpb25hbCBwYWNrYWdlcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBpbWFnZUJ1aWxkZXIoKWAgaW5zdGVhZC5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgTElOVVhfQVJNNjRfRE9DS0VSRklMRV9QQVRIID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Fzc2V0cycsICdkb2NrZXItaW1hZ2VzJywgJ2ZhcmdhdGUnLCAnbGludXgtYXJtNjQnKTtcblxuICAvKipcbiAgICogQ3JlYXRlIG5ldyBpbWFnZSBidWlsZGVyIHRoYXQgYnVpbGRzIEZhcmdhdGUgc3BlY2lmaWMgcnVubmVyIGltYWdlcy5cbiAgICpcbiAgICogWW91IGNhbiBjdXN0b21pemUgdGhlIE9TLCBhcmNoaXRlY3R1cmUsIFZQQywgc3VibmV0LCBzZWN1cml0eSBncm91cHMsIGV0Yy4gYnkgcGFzc2luZyBpbiBwcm9wcy5cbiAgICpcbiAgICogWW91IGNhbiBhZGQgY29tcG9uZW50cyB0byB0aGUgaW1hZ2UgYnVpbGRlciBieSBjYWxsaW5nIGBpbWFnZUJ1aWxkZXIuYWRkQ29tcG9uZW50KClgLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBPUyBpcyBVYnVudHUgcnVubmluZyBvbiB4NjQgYXJjaGl0ZWN0dXJlLlxuICAgKlxuICAgKiBJbmNsdWRlZCBjb21wb25lbnRzOlxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucnVubmVyVXNlcigpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmF3c0NsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViUnVubmVyKClgXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGltYWdlQnVpbGRlcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJ1bm5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgcmV0dXJuIFJ1bm5lckltYWdlQnVpbGRlci5uZXcoc2NvcGUsIGlkLCB7XG4gICAgICBvczogT3MuTElOVVhfVUJVTlRVLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUuWDg2XzY0LFxuICAgICAgY29tcG9uZW50czogW1xuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViUnVubmVyKHByb3BzPy5ydW5uZXJWZXJzaW9uID8/IFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkpLFxuICAgICAgXSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENsdXN0ZXIgaG9zdGluZyB0aGUgdGFzayBob3N0aW5nIHRoZSBydW5uZXIuXG4gICAqL1xuICByZWFkb25seSBjbHVzdGVyOiBlY3MuQ2x1c3RlcjtcblxuICAvKipcbiAgICogRmFyZ2F0ZSB0YXNrIGhvc3RpbmcgdGhlIHJ1bm5lci5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IHRhc2s6IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb247XG5cbiAgLyoqXG4gICAqIENvbnRhaW5lciBkZWZpbml0aW9uIGhvc3RpbmcgdGhlIHJ1bm5lci5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IGNvbnRhaW5lcjogZWNzLkNvbnRhaW5lckRlZmluaXRpb247XG5cbiAgLyoqXG4gICAqIExhYmVscyBhc3NvY2lhdGVkIHdpdGggdGhpcyBwcm92aWRlci5cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVsczogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIFZQQyB1c2VkIGZvciBob3N0aW5nIHRoZSBydW5uZXIgdGFzay5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBTdWJuZXRzIHVzZWQgZm9yIGhvc3RpbmcgdGhlIHJ1bm5lciB0YXNrLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBUaGlzIGZpZWxkIGlzIGludGVybmFsIGFuZCBzaG91bGQgbm90IGJlIGFjY2Vzc2VkIGRpcmVjdGx5LlxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogV2hldGhlciBydW5uZXIgdGFzayB3aWxsIGhhdmUgYSBwdWJsaWMgSVAuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSBhc3NpZ25QdWJsaWNJcDogYm9vbGVhbjtcblxuICAvKipcbiAgICogR3JhbnQgcHJpbmNpcGFsIHVzZWQgdG8gYWRkIHBlcm1pc3Npb25zIHRvIHRoZSBydW5uZXIgcm9sZS5cbiAgICovXG4gIHJlYWRvbmx5IGdyYW50UHJpbmNpcGFsOiBpYW0uSVByaW5jaXBhbDtcblxuICAvKipcbiAgICogVGhlIG5ldHdvcmsgY29ubmVjdGlvbnMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcmVzb3VyY2UuXG4gICAqL1xuICByZWFkb25seSBjb25uZWN0aW9uczogZWMyLkNvbm5lY3Rpb25zO1xuXG4gIC8qKlxuICAgKiBVc2Ugc3BvdCBwcmljaW5nIGZvciBGYXJnYXRlIHRhc2tzLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBUaGlzIGZpZWxkIGlzIGludGVybmFsIGFuZCBzaG91bGQgbm90IGJlIGFjY2Vzc2VkIGRpcmVjdGx5LlxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdDogYm9vbGVhbjtcblxuICAvKipcbiAgICogRG9ja2VyIGltYWdlIGxvYWRlZCB3aXRoIEdpdEh1YiBBY3Rpb25zIFJ1bm5lciBhbmQgaXRzIHByZXJlcXVpc2l0ZXMuIFRoZSBpbWFnZSBpcyBidWlsdCBieSBhbiBpbWFnZSBidWlsZGVyIGFuZCBpcyBzcGVjaWZpYyB0byBGYXJnYXRlIHRhc2tzLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBUaGlzIGZpZWxkIGlzIGludGVybmFsIGFuZCBzaG91bGQgbm90IGJlIGFjY2Vzc2VkIGRpcmVjdGx5LlxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2U6IFJ1bm5lckltYWdlO1xuXG4gIC8qKlxuICAgKiBMb2cgZ3JvdXAgd2hlcmUgcHJvdmlkZWQgcnVubmVycyB3aWxsIHNhdmUgdGhlaXIgbG9ncy5cbiAgICpcbiAgICogTm90ZSB0aGF0IHRoaXMgaXMgbm90IHRoZSBqb2IgbG9nLCBidXQgdGhlIHJ1bm5lciBpdHNlbGYuIEl0IHdpbGwgbm90IGNvbnRhaW4gb3V0cHV0IGZyb20gdGhlIEdpdEh1YiBBY3Rpb24gYnV0IG9ubHkgbWV0YWRhdGEgb24gaXRzIGV4ZWN1dGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwOiBsb2dzLklMb2dHcm91cDtcblxuICByZWFkb25seSByZXRyeWFibGVFcnJvcnMgPSBbXG4gICAgJ0Vjcy5FY3NFeGNlcHRpb24nLFxuICAgICdFY3MuTGltaXRFeGNlZWRlZEV4Y2VwdGlvbicsXG4gICAgJ0Vjcy5VcGRhdGVJblByb2dyZXNzRXhjZXB0aW9uJyxcbiAgXTtcblxuICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM6IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIHRoaXMubGFiZWxzID0gdGhpcy5sYWJlbHNGcm9tUHJvcGVydGllcygnZmFyZ2F0ZScsIHByb3BzPy5sYWJlbCwgcHJvcHM/LmxhYmVscyk7XG4gICAgdGhpcy5ncm91cCA9IHByb3BzPy5ncm91cDtcbiAgICB0aGlzLmRlZmF1bHRMYWJlbHMgPSBwcm9wcz8uZGVmYXVsdExhYmVscyA/PyB0cnVlO1xuICAgIHRoaXMudnBjID0gcHJvcHM/LnZwYyA/PyBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ2RlZmF1bHQgdnBjJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgdGhpcy5zdWJuZXRTZWxlY3Rpb24gPSBwcm9wcz8uc3VibmV0U2VsZWN0aW9uO1xuICAgIHRoaXMuc2VjdXJpdHlHcm91cHMgPSBwcm9wcz8uc2VjdXJpdHlHcm91cCA/IFtwcm9wcy5zZWN1cml0eUdyb3VwXSA6IChwcm9wcz8uc2VjdXJpdHlHcm91cHMgPz8gW25ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnc2VjdXJpdHkgZ3JvdXAnLCB7IHZwYzogdGhpcy52cGMgfSldKTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gbmV3IGVjMi5Db25uZWN0aW9ucyh7IHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzIH0pO1xuICAgIHRoaXMuYXNzaWduUHVibGljSXAgPSBwcm9wcz8uYXNzaWduUHVibGljSXAgPz8gdHJ1ZTtcbiAgICB0aGlzLmNsdXN0ZXIgPSBwcm9wcz8uY2x1c3RlciA/IHByb3BzLmNsdXN0ZXIgOiBuZXcgZWNzLkNsdXN0ZXIoXG4gICAgICB0aGlzLFxuICAgICAgJ2NsdXN0ZXInLFxuICAgICAge1xuICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICBlbmFibGVGYXJnYXRlQ2FwYWNpdHlQcm92aWRlcnM6IHRydWUsXG4gICAgICB9LFxuICAgICk7XG4gICAgdGhpcy5zcG90ID0gcHJvcHM/LnNwb3QgPz8gZmFsc2U7XG5cbiAgICBjb25zdCBpbWFnZUJ1aWxkZXIgPSBwcm9wcz8uaW1hZ2VCdWlsZGVyID8/IEZhcmdhdGVSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIodGhpcywgJ0ltYWdlIEJ1aWxkZXInKTtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2UgPSBpbWFnZUJ1aWxkZXIuYmluZERvY2tlckltYWdlKCk7XG5cbiAgICBsZXQgYXJjaDogZWNzLkNwdUFyY2hpdGVjdHVyZTtcbiAgICBpZiAoaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgIGFyY2ggPSBlY3MuQ3B1QXJjaGl0ZWN0dXJlLkFSTTY0O1xuICAgIH0gZWxzZSBpZiAoaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICBhcmNoID0gZWNzLkNwdUFyY2hpdGVjdHVyZS5YODZfNjQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtpbWFnZS5hcmNoaXRlY3R1cmUubmFtZX0gaXMgbm90IHN1cHBvcnRlZCBvbiBGYXJnYXRlYCk7XG4gICAgfVxuXG4gICAgbGV0IG9zOiBlY3MuT3BlcmF0aW5nU3lzdGVtRmFtaWx5O1xuICAgIGlmIChpbWFnZS5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICBvcyA9IGVjcy5PcGVyYXRpbmdTeXN0ZW1GYW1pbHkuTElOVVg7XG4gICAgfSBlbHNlIGlmIChpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgb3MgPSBlY3MuT3BlcmF0aW5nU3lzdGVtRmFtaWx5LldJTkRPV1NfU0VSVkVSXzIwMTlfQ09SRTtcbiAgICAgIGlmIChwcm9wcz8uZXBoZW1lcmFsU3RvcmFnZUdpQikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0VwaGVtZXJhbCBzdG9yYWdlIGlzIG5vdCBzdXBwb3J0ZWQgb24gRmFyZ2F0ZSBXaW5kb3dzJyk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgJHtpbWFnZS5vcy5uYW1lfSBpcyBub3Qgc3VwcG9ydGVkIG9uIEZhcmdhdGVgKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ2xvZ3MnLCB7XG4gICAgICByZXRlbnRpb246IHByb3BzPy5sb2dSZXRlbnRpb24gPz8gUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICB0aGlzLnRhc2sgPSBuZXcgZWNzLkZhcmdhdGVUYXNrRGVmaW5pdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAndGFzaycsXG4gICAgICB7XG4gICAgICAgIGNwdTogcHJvcHM/LmNwdSA/PyAxMDI0LFxuICAgICAgICBtZW1vcnlMaW1pdE1pQjogcHJvcHM/Lm1lbW9yeUxpbWl0TWlCID8/IDIwNDgsXG4gICAgICAgIGVwaGVtZXJhbFN0b3JhZ2VHaUI6IHByb3BzPy5lcGhlbWVyYWxTdG9yYWdlR2lCID8/ICghaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykgPyAyNSA6IHVuZGVmaW5lZCksXG4gICAgICAgIHJ1bnRpbWVQbGF0Zm9ybToge1xuICAgICAgICAgIG9wZXJhdGluZ1N5c3RlbUZhbWlseTogb3MsXG4gICAgICAgICAgY3B1QXJjaGl0ZWN0dXJlOiBhcmNoLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuICAgIHRoaXMuY29udGFpbmVyID0gdGhpcy50YXNrLmFkZENvbnRhaW5lcihcbiAgICAgICdydW5uZXInLFxuICAgICAge1xuICAgICAgICBpbWFnZTogZWNzLkFzc2V0SW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LCBpbWFnZS5pbWFnZVRhZyksXG4gICAgICAgIGxvZ2dpbmc6IGVjcy5Bd3NMb2dEcml2ZXIuYXdzTG9ncyh7XG4gICAgICAgICAgbG9nR3JvdXA6IHRoaXMubG9nR3JvdXAsXG4gICAgICAgICAgc3RyZWFtUHJlZml4OiAncnVubmVyJyxcbiAgICAgICAgfSksXG4gICAgICAgIGNvbW1hbmQ6IGVjc1J1bkNvbW1hbmQodGhpcy5pbWFnZS5vcywgZmFsc2UpLFxuICAgICAgICB1c2VyOiBpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSA/IHVuZGVmaW5lZCA6ICdydW5uZXInLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgdGhpcy5ncmFudFByaW5jaXBhbCA9IHRoaXMudGFzay50YXNrUm9sZTtcblxuICAgIC8vIGFsbG93IFNTTSBTZXNzaW9uIE1hbmFnZXJcbiAgICB0aGlzLnRhc2sudGFza1JvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koTUlOSU1BTF9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlIHN0ZXAgZnVuY3Rpb24gdGFzayhzKSB0byBzdGFydCBhIG5ldyBydW5uZXIuXG4gICAqXG4gICAqIENhbGxlZCBieSBHaXRodWJSdW5uZXJzIGFuZCBzaG91bGRuJ3QgYmUgY2FsbGVkIG1hbnVhbGx5LlxuICAgKlxuICAgKiBAcGFyYW0gcGFyYW1ldGVycyB3b3JrZmxvdyBqb2IgZGV0YWlsc1xuICAgKi9cbiAgZ2V0U3RlcEZ1bmN0aW9uVGFzayhwYXJhbWV0ZXJzOiBSdW5uZXJSdW50aW1lUGFyYW1ldGVycyk6IHN0ZXBmdW5jdGlvbnMuSUNoYWluYWJsZSB7XG4gICAgcmV0dXJuIG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLkVjc1J1blRhc2soXG4gICAgICB0aGlzLFxuICAgICAgJ1N0YXRlJyxcbiAgICAgIHtcbiAgICAgICAgc3RhdGVOYW1lOiBnZW5lcmF0ZVN0YXRlTmFtZSh0aGlzKSxcbiAgICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBJbnRlZ3JhdGlvblBhdHRlcm4uUlVOX0pPQiwgLy8gc3luY1xuICAgICAgICB0YXNrRGVmaW5pdGlvbjogdGhpcy50YXNrLFxuICAgICAgICBjbHVzdGVyOiB0aGlzLmNsdXN0ZXIsXG4gICAgICAgIGxhdW5jaFRhcmdldDogbmV3IEVjc0ZhcmdhdGVMYXVuY2hUYXJnZXQoe1xuICAgICAgICAgIHNwb3Q6IHRoaXMuc3BvdCxcbiAgICAgICAgfSksXG4gICAgICAgIGVuYWJsZUV4ZWN1dGVDb21tYW5kOiB0aGlzLmltYWdlLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUyksXG4gICAgICAgIHN1Ym5ldHM6IHRoaXMuc3VibmV0U2VsZWN0aW9uLFxuICAgICAgICBhc3NpZ25QdWJsaWNJcDogdGhpcy5hc3NpZ25QdWJsaWNJcCxcbiAgICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgICAgIGNvbnRhaW5lck92ZXJyaWRlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGNvbnRhaW5lckRlZmluaXRpb246IHRoaXMuY29udGFpbmVyLFxuICAgICAgICAgICAgZW52aXJvbm1lbnQ6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdSVU5ORVJfVE9LRU4nLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLnJ1bm5lclRva2VuUGF0aCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdKSVRfQ09ORklHJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5qaXRDb25maWdQYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1JVTk5FUl9OQU1FJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5ydW5uZXJOYW1lUGF0aCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdSVU5ORVJfTEFCRUwnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLmxhYmVsc1BhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUlVOTkVSX0dST1VQMScsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHRoaXMuZ3JvdXAgPyAnLS1ydW5uZXJncm91cCcgOiAnJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdSVU5ORVJfR1JPVVAyJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogdGhpcy5ncm91cCA/IHRoaXMuZ3JvdXAgOiAnJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdERUZBVUxUX0xBQkVMUycsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHRoaXMuZGVmYXVsdExhYmVscyA/ICcnIDogJy0tbm8tZGVmYXVsdC1sYWJlbHMnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ0dJVEhVQl9ET01BSU4nLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLmdpdGh1YkRvbWFpblBhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnT1dORVInLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLm93bmVyUGF0aCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdSRVBPJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5yZXBvUGF0aCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdSRUdJU1RSQVRJT05fVVJMJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5yZWdpc3RyYXRpb25VcmwsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgICk7XG4gIH1cblxuICBncmFudFN0YXRlTWFjaGluZShfOiBpYW0uSUdyYW50YWJsZSkge1xuICB9XG5cbiAgc3RhdHVzKHN0YXR1c0Z1bmN0aW9uUm9sZTogaWFtLklHcmFudGFibGUpOiBJUnVubmVyUHJvdmlkZXJTdGF0dXMge1xuICAgIHRoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LmdyYW50KHN0YXR1c0Z1bmN0aW9uUm9sZSwgJ2VjcjpEZXNjcmliZUltYWdlcycpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIGxhYmVsczogdGhpcy5sYWJlbHMsXG4gICAgICBjb25zdHJ1Y3RQYXRoOiB0aGlzLm5vZGUucGF0aCxcbiAgICAgIHZwY0FybjogdGhpcy52cGM/LnZwY0FybixcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzLm1hcChzZyA9PiBzZy5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgcm9sZUFybjogdGhpcy50YXNrLnRhc2tSb2xlLnJvbGVBcm4sXG4gICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBpbWFnZToge1xuICAgICAgICBpbWFnZVJlcG9zaXRvcnk6IHRoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICAgIGltYWdlVGFnOiB0aGlzLmltYWdlLmltYWdlVGFnLFxuICAgICAgICBpbWFnZUJ1aWxkZXJMb2dHcm91cDogdGhpcy5pbWFnZS5sb2dHcm91cD8ubG9nR3JvdXBOYW1lLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG59XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBGYXJnYXRlUnVubmVyUHJvdmlkZXJ9XG4gKi9cbmV4cG9ydCBjbGFzcyBGYXJnYXRlUnVubmVyIGV4dGVuZHMgRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyIHtcbn1cbiJdfQ==