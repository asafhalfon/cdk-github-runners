"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FargateRunner = exports.FargateRunnerProvider = void 0;
exports.ecsRunCommand = ecsRunCommand;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const path = require("path");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_stepfunctions_1 = require("aws-cdk-lib/aws-stepfunctions");
const common_1 = require("./common");
const image_builders_1 = require("../image-builders");
const utils_1 = require("../utils");
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
            cdk.Annotations.of(this).addError(`${image.architecture.name} is not supported on Fargate`);
            arch = aws_cdk_lib_1.aws_ecs.CpuArchitecture.X86_64; // so the code below doesn't throw an exception
        }
        let fargateRunnerCommandOs = image.os;
        let os;
        if (image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS)) {
            os = aws_cdk_lib_1.aws_ecs.OperatingSystemFamily.LINUX;
        }
        else if (image.os.is(common_1.Os.WINDOWS)) {
            os = aws_cdk_lib_1.aws_ecs.OperatingSystemFamily.WINDOWS_SERVER_2019_CORE;
            if (props?.ephemeralStorageGiB) {
                cdk.Annotations.of(this).addError('Ephemeral storage is not supported on Fargate Windows');
            }
        }
        else {
            cdk.Annotations.of(this).addError(`${image.os.name} is not supported on Fargate`);
            os = aws_cdk_lib_1.aws_ecs.OperatingSystemFamily.LINUX;
            fargateRunnerCommandOs = common_1.Os.LINUX_UBUNTU;
        }
        this.logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'logs', {
            retention: props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        this.task = new aws_cdk_lib_1.aws_ecs.FargateTaskDefinition(this, 'task', {
            cpu: props?.cpu ?? 1024,
            memoryLimitMiB: props?.memoryLimitMiB ?? 2048,
            ephemeralStorageGiB: image.os.is(common_1.Os.WINDOWS) ? undefined : props?.ephemeralStorageGiB ?? 25,
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
            command: ecsRunCommand(fargateRunnerCommandOs, false),
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
            launchTarget: new aws_cdk_lib_1.aws_stepfunctions_tasks.EcsFargateLaunchTarget({
                platformVersion: aws_cdk_lib_1.aws_ecs.FargatePlatformVersion.LATEST,
                capacityProviderOptions: aws_cdk_lib_1.aws_stepfunctions_tasks.CapacityProviderOptions.custom([{
                        capacityProvider: this.spot ? 'FARGATE_SPOT' : 'FARGATE',
                    }]),
            }),
            enableExecuteCommand: this.image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS),
            propagatedTagSource: aws_cdk_lib_1.aws_ecs.PropagatedTagSource.TASK_DEFINITION,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFyZ2F0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvZmFyZ2F0ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7O0FBcUxBLHNDQW9DQzs7QUF6TkQsNkJBQTZCO0FBQzdCLG1DQUFtQztBQUNuQyw2Q0FRcUI7QUFDckIsbURBQXFEO0FBQ3JELHFFQUFtRTtBQUVuRSxxQ0FXa0I7QUFDbEIsc0RBQTJIO0FBQzNILG9DQUF3RTtBQXVKeEU7O0dBRUc7QUFDSCxTQUFnQixhQUFhLENBQUMsRUFBTSxFQUFFLElBQWE7SUFDakQsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLFdBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLENBQUM7UUFDcEMsSUFBSSxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBQ3JCLElBQUksSUFBSSxFQUFFLENBQUM7WUFDVCxXQUFXLEdBQUcsZ0hBQWdIO2dCQUM1SCxnRUFBZ0UsQ0FBQztRQUNyRSxDQUFDO1FBRUQsT0FBTztZQUNMLElBQUksRUFBRSxJQUFJO1lBQ1YsR0FBRyxXQUFXOzs7Ozs7Ozs7OzsyRUFXdUQ7U0FDdEUsQ0FBQztJQUNKLENBQUM7U0FBTSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsV0FBRSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7UUFDN0IsT0FBTztZQUNMLFlBQVksRUFBRSxVQUFVO1lBQ3hCOzs7Ozs4RUFLd0U7U0FDekUsQ0FBQztJQUNKLENBQUM7U0FBTSxDQUFDO1FBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQyxrQ0FBa0MsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7SUFDL0QsQ0FBQztBQUNILENBQUM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxNQUFhLHFCQUFzQixTQUFRLHFCQUFZO0lBdUJyRDs7Ozs7Ozs7Ozs7Ozs7OztPQWdCRztJQUNJLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBK0I7UUFDdEYsT0FBTyxt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O2FBQ3hEO1NBQ0YsQ0FBQztJQUNKLENBQUM7O0FBMVVILHNEQTJVQzs7O0FBMVVDOzs7Ozs7OztHQVFHO0FBQ29CLCtDQUF5QixHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsV0FBVyxDQUFDLEFBQXRGLENBQXVGO0FBRXZJOzs7Ozs7OztHQVFHO0FBQ29CLGlEQUEyQixHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxTQUFTLEVBQUUsYUFBYSxDQUFDLEFBQXhGLENBQXlGO0FBd1Q3STs7R0FFRztBQUNILE1BQWEsYUFBYyxTQUFRLHFCQUFxQjs7QUFBeEQsc0NBQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7XG4gIGF3c19lYzIgYXMgZWMyLFxuICBhd3NfZWNzIGFzIGVjcyxcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMsXG4gIGF3c19zdGVwZnVuY3Rpb25zX3Rhc2tzIGFzIHN0ZXBmdW5jdGlvbnNfdGFza3MsXG4gIFJlbW92YWxQb2xpY3ksXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBJbnRlZ3JhdGlvblBhdHRlcm4gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gIEFyY2hpdGVjdHVyZSxcbiAgQmFzZVByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlclN0YXR1cyxcbiAgSVJ1bm5lclJ1bnRpbWVQYXJhbWV0ZXJzLFxuICBPcyxcbiAgUnVubmVySW1hZ2UsXG4gIFJ1bm5lclByb3ZpZGVyUHJvcHMsXG4gIFJ1bm5lclZlcnNpb24sXG4gIGdlbmVyYXRlU3RhdGVOYW1lLFxufSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQgeyBJUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXIsIFJ1bm5lckltYWdlQnVpbGRlclByb3BzLCBSdW5uZXJJbWFnZUNvbXBvbmVudCB9IGZyb20gJy4uL2ltYWdlLWJ1aWxkZXJzJztcbmltcG9ydCB7IE1JTklNQUxfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIEZhcmdhdGVSdW5uZXJQcm92aWRlci5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBGYXJnYXRlUnVubmVyUHJvdmlkZXJQcm9wcyBleHRlbmRzIFJ1bm5lclByb3ZpZGVyUHJvcHMge1xuICAvKipcbiAgICogUnVubmVyIGltYWdlIGJ1aWxkZXIgdXNlZCB0byBidWlsZCBEb2NrZXIgaW1hZ2VzIGNvbnRhaW5pbmcgR2l0SHViIFJ1bm5lciBhbmQgYWxsIHJlcXVpcmVtZW50cy5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgZGV0ZXJtaW5lcyB0aGUgT1MgYW5kIGFyY2hpdGVjdHVyZSBvZiB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBGYXJnYXRlUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKClcbiAgICovXG4gIHJlYWRvbmx5IGltYWdlQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVsIHVzZWQgZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZFxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIGxhYmVsc30gaW5zdGVhZFxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWw/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2ZhcmdhdGUnXVxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBncm91cCBuYW1lLlxuICAgKlxuICAgKiBJZiBzcGVjaWZpZWQsIHRoZSBydW5uZXIgd2lsbCBiZSByZWdpc3RlcmVkIHdpdGggdGhpcyBncm91cCBuYW1lLiBTZXR0aW5nIGEgcnVubmVyIGdyb3VwIGNhbiBoZWxwIG1hbmFnaW5nIGFjY2VzcyB0byBzZWxmLWhvc3RlZCBydW5uZXJzLiBJdFxuICAgKiByZXF1aXJlcyBhIHBhaWQgR2l0SHViIGFjY291bnQuXG4gICAqXG4gICAqIFRoZSBncm91cCBtdXN0IGV4aXN0IG9yIHRoZSBydW5uZXIgd2lsbCBub3Qgc3RhcnQuXG4gICAqXG4gICAqIFVzZXJzIHdpbGwgc3RpbGwgYmUgYWJsZSB0byB0cmlnZ2VyIHRoaXMgcnVubmVyIHdpdGggdGhlIGNvcnJlY3QgbGFiZWxzLiBCdXQgdGhlIHJ1bm5lciB3aWxsIG9ubHkgYmUgYWJsZSB0byBydW4gam9icyBmcm9tIHJlcG9zIGFsbG93ZWQgdG8gdXNlIHRoZSBncm91cC5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBncm91cD86IHN0cmluZztcblxuICAvKipcbiAgICogVlBDIHRvIGxhdW5jaCB0aGUgcnVubmVycyBpbi5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBhY2NvdW50IFZQQ1xuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFN1Ym5ldHMgdG8gcnVuIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBGYXJnYXRlIGRlZmF1bHRcbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwIHRvIGFzc2lnbiB0byB0aGUgdGFzay5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBzZWN1cml0eUdyb3Vwc31cbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA/OiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwcyB0byBhc3NpZ24gdG8gdGhlIHRhc2suXG4gICAqXG4gICAqIEBkZWZhdWx0IGEgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3Vwcz86IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIC8qKlxuICAgKiBFeGlzdGluZyBGYXJnYXRlIGNsdXN0ZXIgdG8gdXNlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBjbHVzdGVyXG4gICAqL1xuICByZWFkb25seSBjbHVzdGVyPzogZWNzLkNsdXN0ZXI7XG5cbiAgLyoqXG4gICAqIEFzc2lnbiBwdWJsaWMgSVAgdG8gdGhlIHJ1bm5lciB0YXNrLlxuICAgKlxuICAgKiBNYWtlIHN1cmUgdGhlIHRhc2sgd2lsbCBoYXZlIGFjY2VzcyB0byBHaXRIdWIuIEEgcHVibGljIElQIG1pZ2h0IGJlIHJlcXVpcmVkIHVubGVzcyB5b3UgaGF2ZSBOQVQgZ2F0ZXdheS5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgYXNzaWduUHVibGljSXA/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGNwdSB1bml0cyB1c2VkIGJ5IHRoZSB0YXNrLiBGb3IgdGFza3MgdXNpbmcgdGhlIEZhcmdhdGUgbGF1bmNoIHR5cGUsXG4gICAqIHRoaXMgZmllbGQgaXMgcmVxdWlyZWQgYW5kIHlvdSBtdXN0IHVzZSBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXMsXG4gICAqIHdoaWNoIGRldGVybWluZXMgeW91ciByYW5nZSBvZiB2YWxpZCB2YWx1ZXMgZm9yIHRoZSBtZW1vcnkgcGFyYW1ldGVyOlxuICAgKlxuICAgKiAyNTYgKC4yNSB2Q1BVKSAtIEF2YWlsYWJsZSBtZW1vcnkgdmFsdWVzOiA1MTIgKDAuNSBHQiksIDEwMjQgKDEgR0IpLCAyMDQ4ICgyIEdCKVxuICAgKlxuICAgKiA1MTIgKC41IHZDUFUpIC0gQXZhaWxhYmxlIG1lbW9yeSB2YWx1ZXM6IDEwMjQgKDEgR0IpLCAyMDQ4ICgyIEdCKSwgMzA3MiAoMyBHQiksIDQwOTYgKDQgR0IpXG4gICAqXG4gICAqIDEwMjQgKDEgdkNQVSkgLSBBdmFpbGFibGUgbWVtb3J5IHZhbHVlczogMjA0OCAoMiBHQiksIDMwNzIgKDMgR0IpLCA0MDk2ICg0IEdCKSwgNTEyMCAoNSBHQiksIDYxNDQgKDYgR0IpLCA3MTY4ICg3IEdCKSwgODE5MiAoOCBHQilcbiAgICpcbiAgICogMjA0OCAoMiB2Q1BVKSAtIEF2YWlsYWJsZSBtZW1vcnkgdmFsdWVzOiBCZXR3ZWVuIDQwOTYgKDQgR0IpIGFuZCAxNjM4NCAoMTYgR0IpIGluIGluY3JlbWVudHMgb2YgMTAyNCAoMSBHQilcbiAgICpcbiAgICogNDA5NiAoNCB2Q1BVKSAtIEF2YWlsYWJsZSBtZW1vcnkgdmFsdWVzOiBCZXR3ZWVuIDgxOTIgKDggR0IpIGFuZCAzMDcyMCAoMzAgR0IpIGluIGluY3JlbWVudHMgb2YgMTAyNCAoMSBHQilcbiAgICpcbiAgICogQGRlZmF1bHQgMTAyNFxuICAgKi9cbiAgcmVhZG9ubHkgY3B1PzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgYW1vdW50IChpbiBNaUIpIG9mIG1lbW9yeSB1c2VkIGJ5IHRoZSB0YXNrLiBGb3IgdGFza3MgdXNpbmcgdGhlIEZhcmdhdGUgbGF1bmNoIHR5cGUsXG4gICAqIHRoaXMgZmllbGQgaXMgcmVxdWlyZWQgYW5kIHlvdSBtdXN0IHVzZSBvbmUgb2YgdGhlIGZvbGxvd2luZyB2YWx1ZXMsIHdoaWNoIGRldGVybWluZXMgeW91ciByYW5nZSBvZiB2YWxpZCB2YWx1ZXMgZm9yIHRoZSBjcHUgcGFyYW1ldGVyOlxuICAgKlxuICAgKiA1MTIgKDAuNSBHQiksIDEwMjQgKDEgR0IpLCAyMDQ4ICgyIEdCKSAtIEF2YWlsYWJsZSBjcHUgdmFsdWVzOiAyNTYgKC4yNSB2Q1BVKVxuICAgKlxuICAgKiAxMDI0ICgxIEdCKSwgMjA0OCAoMiBHQiksIDMwNzIgKDMgR0IpLCA0MDk2ICg0IEdCKSAtIEF2YWlsYWJsZSBjcHUgdmFsdWVzOiA1MTIgKC41IHZDUFUpXG4gICAqXG4gICAqIDIwNDggKDIgR0IpLCAzMDcyICgzIEdCKSwgNDA5NiAoNCBHQiksIDUxMjAgKDUgR0IpLCA2MTQ0ICg2IEdCKSwgNzE2OCAoNyBHQiksIDgxOTIgKDggR0IpIC0gQXZhaWxhYmxlIGNwdSB2YWx1ZXM6IDEwMjQgKDEgdkNQVSlcbiAgICpcbiAgICogQmV0d2VlbiA0MDk2ICg0IEdCKSBhbmQgMTYzODQgKDE2IEdCKSBpbiBpbmNyZW1lbnRzIG9mIDEwMjQgKDEgR0IpIC0gQXZhaWxhYmxlIGNwdSB2YWx1ZXM6IDIwNDggKDIgdkNQVSlcbiAgICpcbiAgICogQmV0d2VlbiA4MTkyICg4IEdCKSBhbmQgMzA3MjAgKDMwIEdCKSBpbiBpbmNyZW1lbnRzIG9mIDEwMjQgKDEgR0IpIC0gQXZhaWxhYmxlIGNwdSB2YWx1ZXM6IDQwOTYgKDQgdkNQVSlcbiAgICpcbiAgICogQGRlZmF1bHQgMjA0OFxuICAgKi9cbiAgcmVhZG9ubHkgbWVtb3J5TGltaXRNaUI/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBhbW91bnQgKGluIEdpQikgb2YgZXBoZW1lcmFsIHN0b3JhZ2UgdG8gYmUgYWxsb2NhdGVkIHRvIHRoZSB0YXNrLiBUaGUgbWF4aW11bSBzdXBwb3J0ZWQgdmFsdWUgaXMgMjAwIEdpQi5cbiAgICpcbiAgICogTk9URTogVGhpcyBwYXJhbWV0ZXIgaXMgb25seSBzdXBwb3J0ZWQgZm9yIHRhc2tzIGhvc3RlZCBvbiBBV1MgRmFyZ2F0ZSB1c2luZyBwbGF0Zm9ybSB2ZXJzaW9uIDEuNC4wIG9yIGxhdGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCAyMFxuICAgKi9cbiAgcmVhZG9ubHkgZXBoZW1lcmFsU3RvcmFnZUdpQj86IG51bWJlcjtcblxuICAvKipcbiAgICogVXNlIEZhcmdhdGUgc3BvdCBjYXBhY2l0eSBwcm92aWRlciB0byBzYXZlIG1vbmV5LlxuICAgKlxuICAgKiAqIFJ1bm5lcnMgbWF5IGZhaWwgdG8gc3RhcnQgZHVlIHRvIG1pc3NpbmcgY2FwYWNpdHkuXG4gICAqICogUnVubmVycyBtaWdodCBiZSBzdG9wcGVkIHByZW1hdHVyZWx5IHdpdGggc3BvdCBwcmljaW5nLlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlY3NSdW5Db21tYW5kKG9zOiBPcywgZGluZDogYm9vbGVhbik6IHN0cmluZ1tdIHtcbiAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICBsZXQgZGluZENvbW1hbmQgPSAnJztcbiAgICBpZiAoZGluZCkge1xuICAgICAgZGluZENvbW1hbmQgPSAnbm9odXAgc3VkbyBkb2NrZXJkIC0taG9zdD11bml4Oi8vL3Zhci9ydW4vZG9ja2VyLnNvY2sgLS1ob3N0PXRjcDovLzEyNy4wLjAuMToyMzc1IC0tc3RvcmFnZS1kcml2ZXI9b3ZlcmxheTIgJiAnICtcbiAgICAgICAgJ3RpbWVvdXQgMTUgc2ggLWMgXCJ1bnRpbCBkb2NrZXIgaW5mbzsgZG8gZWNobyAuOyBzbGVlcCAxOyBkb25lXCInO1xuICAgIH1cblxuICAgIHJldHVybiBbXG4gICAgICAnc2gnLCAnLWMnLFxuICAgICAgYCR7ZGluZENvbW1hbmR9XG4gICAgICAgIGNkIC9ob21lL3J1bm5lciAmJlxuICAgICAgICBpZiBbIC1uIFwiJEpJVF9DT05GSUdcIiBdOyB0aGVuXG4gICAgICAgICAgZWNobyBcIkpJVCBtb2RlIGVuYWJsZWQsIHNraXBwaW5nIGNvbmZpZy5zaFwiICYmXG4gICAgICAgICAgLi9ydW4uc2ggLS1qaXRjb25maWcgXCIkSklUX0NPTkZJR1wiXG4gICAgICAgIGVsc2VcbiAgICAgICAgICBpZiBbIFwiJFJVTk5FUl9WRVJTSU9OXCIgPSBcImxhdGVzdFwiIF07IHRoZW4gUlVOTkVSX0ZMQUdTPVwiXCI7IGVsc2UgUlVOTkVSX0ZMQUdTPVwiLS1kaXNhYmxldXBkYXRlXCI7IGZpICYmXG4gICAgICAgICAgLi9jb25maWcuc2ggLS11bmF0dGVuZGVkIC0tdXJsIFwiJFJFR0lTVFJBVElPTl9VUkxcIiAtLXRva2VuIFwiJFJVTk5FUl9UT0tFTlwiIC0tZXBoZW1lcmFsIC0td29yayBfd29yayAtLWxhYmVscyBcIiRSVU5ORVJfTEFCRUwsY2RrZ2hyOnN0YXJ0ZWQ6XFxgZGF0ZSArJXNcXGBcIiAkUlVOTkVSX0ZMQUdTIC0tbmFtZSBcIiRSVU5ORVJfTkFNRVwiICRSVU5ORVJfR1JPVVAxICRSVU5ORVJfR1JPVVAyICRERUZBVUxUX0xBQkVMUyAmJlxuICAgICAgICAgIC4vcnVuLnNoXG4gICAgICAgIGZpICYmXG4gICAgICAgIFNUQVRVUz0kKGdyZXAgLVBob3JzIFwiZmluaXNoIGpvYiByZXF1ZXN0IGZvciBqb2IgWzAtOWEtZi1dKyB3aXRoIHJlc3VsdDogLipcIiBfZGlhZyB8IHRhaWwgLW4xIHwgYXdrICd7cHJpbnQgJE5GfScpICYmXG4gICAgICAgIFsgLW4gXCIkU1RBVFVTXCIgXSAmJiBlY2hvIENES0dIQSBKT0IgRE9ORSBcIiRSVU5ORVJfTEFCRUxcIiBcIiRTVEFUVVNcImAsXG4gICAgXTtcbiAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgIHJldHVybiBbXG4gICAgICAncG93ZXJzaGVsbCcsICctQ29tbWFuZCcsXG4gICAgICBgY2QgXFxcXGFjdGlvbnMgO1xuICAgICAgICBpZiAoJEVudjpSVU5ORVJfVkVSU0lPTiAtZXEgXCJsYXRlc3RcIikgeyAkUnVubmVyRmxhZ3MgPSBcIlwiIH0gZWxzZSB7ICRSdW5uZXJGbGFncyA9IFwiLS1kaXNhYmxldXBkYXRlXCIgfSA7XG4gICAgICAgIC4vY29uZmlnLmNtZCAtLXVuYXR0ZW5kZWQgLS11cmwgXCJcXCR7RW52OlJFR0lTVFJBVElPTl9VUkx9XCIgLS10b2tlbiBcIlxcJHtFbnY6UlVOTkVSX1RPS0VOfVwiIC0tZXBoZW1lcmFsIC0td29yayBfd29yayAtLWxhYmVscyBcIlxcJHtFbnY6UlVOTkVSX0xBQkVMfSxjZGtnaHI6c3RhcnRlZDpcXCQoR2V0LURhdGUgLVVGb3JtYXQgKyVzKVwiICRSdW5uZXJGbGFncyAtLW5hbWUgXCJcXCR7RW52OlJVTk5FUl9OQU1FfVwiIFxcJHtFbnY6UlVOTkVSX0dST1VQMX0gXFwke0VudjpSVU5ORVJfR1JPVVAyfSBcXCR7RW52OkRFRkFVTFRfTEFCRUxTfSA7XG4gICAgICAgIC4vcnVuLmNtZCA7XG4gICAgICAgICRTVEFUVVMgPSBTZWxlY3QtU3RyaW5nIC1QYXRoICcuL19kaWFnLyoubG9nJyAtUGF0dGVybiAnZmluaXNoIGpvYiByZXF1ZXN0IGZvciBqb2IgWzAtOWEtZlxcXFwtXSsgd2l0aCByZXN1bHQ6ICguKiknIHwgJXskXy5NYXRjaGVzLkdyb3Vwc1sxXS5WYWx1ZX0gfCBTZWxlY3QtT2JqZWN0IC1MYXN0IDEgO1xuICAgICAgICBpZiAoJFNUQVRVUykgeyBlY2hvIFwiQ0RLR0hBIEpPQiBET05FICRcXHtFbnY6UlVOTkVSX0xBQkVMXFx9ICRTVEFUVVNcIiB9YCxcbiAgICBdO1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmFyZ2F0ZSBydW5uZXIgZG9lc24ndCBzdXBwb3J0ICR7b3MubmFtZX1gKTtcbiAgfVxufVxuXG4vKipcbiAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBwcm92aWRlciB1c2luZyBGYXJnYXRlIHRvIGV4ZWN1dGUgam9icy5cbiAqXG4gKiBDcmVhdGVzIGEgdGFzayBkZWZpbml0aW9uIHdpdGggYSBzaW5nbGUgY29udGFpbmVyIHRoYXQgZ2V0cyBzdGFydGVkIGZvciBlYWNoIGpvYi5cbiAqXG4gKiBUaGlzIGNvbnN0cnVjdCBpcyBub3QgbWVhbnQgdG8gYmUgdXNlZCBieSBpdHNlbGYuIEl0IHNob3VsZCBiZSBwYXNzZWQgaW4gdGhlIHByb3ZpZGVycyBwcm9wZXJ0eSBmb3IgR2l0SHViUnVubmVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIEZhcmdhdGVSdW5uZXJQcm92aWRlciBleHRlbmRzIEJhc2VQcm92aWRlciBpbXBsZW1lbnRzIElSdW5uZXJQcm92aWRlciB7XG4gIC8qKlxuICAgKiBQYXRoIHRvIERvY2tlcmZpbGUgZm9yIExpbnV4IHg2NCB3aXRoIGFsbCB0aGUgcmVxdWlyZW1lbnQgZm9yIEZhcmdhdGUgcnVubmVyLiBVc2UgdGhpcyBEb2NrZXJmaWxlIHVubGVzcyB5b3UgbmVlZCB0byBjdXN0b21pemUgaXQgZnVydGhlciB0aGFuIGFsbG93ZWQgYnkgaG9va3MuXG4gICAqXG4gICAqIEF2YWlsYWJsZSBidWlsZCBhcmd1bWVudHMgdGhhdCBjYW4gYmUgc2V0IGluIHRoZSBpbWFnZSBidWlsZGVyOlxuICAgKiAqIGBCQVNFX0lNQUdFYCBzZXRzIHRoZSBgRlJPTWAgbGluZS4gVGhpcyBzaG91bGQgYmUgYW4gVWJ1bnR1IGNvbXBhdGlibGUgaW1hZ2UuXG4gICAqICogYEVYVFJBX1BBQ0tBR0VTYCBjYW4gYmUgdXNlZCB0byBpbnN0YWxsIGFkZGl0aW9uYWwgcGFja2FnZXMuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFVzZSBgaW1hZ2VCdWlsZGVyKClgIGluc3RlYWQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IExJTlVYX1g2NF9ET0NLRVJGSUxFX1BBVEggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnYXNzZXRzJywgJ2RvY2tlci1pbWFnZXMnLCAnZmFyZ2F0ZScsICdsaW51eC14NjQnKTtcblxuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCBBUk02NCB3aXRoIGFsbCB0aGUgcmVxdWlyZW1lbnQgZm9yIEZhcmdhdGUgcnVubmVyLiBVc2UgdGhpcyBEb2NrZXJmaWxlIHVubGVzcyB5b3UgbmVlZCB0byBjdXN0b21pemUgaXQgZnVydGhlciB0aGFuIGFsbG93ZWQgYnkgaG9va3MuXG4gICAqXG4gICAqIEF2YWlsYWJsZSBidWlsZCBhcmd1bWVudHMgdGhhdCBjYW4gYmUgc2V0IGluIHRoZSBpbWFnZSBidWlsZGVyOlxuICAgKiAqIGBCQVNFX0lNQUdFYCBzZXRzIHRoZSBgRlJPTWAgbGluZS4gVGhpcyBzaG91bGQgYmUgYW4gVWJ1bnR1IGNvbXBhdGlibGUgaW1hZ2UuXG4gICAqICogYEVYVFJBX1BBQ0tBR0VTYCBjYW4gYmUgdXNlZCB0byBpbnN0YWxsIGFkZGl0aW9uYWwgcGFja2FnZXMuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFVzZSBgaW1hZ2VCdWlsZGVyKClgIGluc3RlYWQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IExJTlVYX0FSTTY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdmYXJnYXRlJywgJ2xpbnV4LWFybTY0Jyk7XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBuZXcgaW1hZ2UgYnVpbGRlciB0aGF0IGJ1aWxkcyBGYXJnYXRlIHNwZWNpZmljIHJ1bm5lciBpbWFnZXMuXG4gICAqXG4gICAqIFlvdSBjYW4gY3VzdG9taXplIHRoZSBPUywgYXJjaGl0ZWN0dXJlLCBWUEMsIHN1Ym5ldCwgc2VjdXJpdHkgZ3JvdXBzLCBldGMuIGJ5IHBhc3NpbmcgaW4gcHJvcHMuXG4gICAqXG4gICAqIFlvdSBjYW4gYWRkIGNvbXBvbmVudHMgdG8gdGhlIGltYWdlIGJ1aWxkZXIgYnkgY2FsbGluZyBgaW1hZ2VCdWlsZGVyLmFkZENvbXBvbmVudCgpYC5cbiAgICpcbiAgICogVGhlIGRlZmF1bHQgT1MgaXMgVWJ1bnR1IHJ1bm5pbmcgb24geDY0IGFyY2hpdGVjdHVyZS5cbiAgICpcbiAgICogSW5jbHVkZWQgY29tcG9uZW50czpcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJlcXVpcmVkUGFja2FnZXMoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcigpYFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcykge1xuICAgIHJldHVybiBSdW5uZXJJbWFnZUJ1aWxkZXIubmV3KHNjb3BlLCBpZCwge1xuICAgICAgb3M6IE9zLkxJTlVYX1VCVU5UVSxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGNvbXBvbmVudHM6IFtcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcihwcm9wcz8ucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpKSxcbiAgICAgIF0sXG4gICAgICAuLi5wcm9wcyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDbHVzdGVyIGhvc3RpbmcgdGhlIHRhc2sgaG9zdGluZyB0aGUgcnVubmVyLlxuICAgKi9cbiAgcmVhZG9ubHkgY2x1c3RlcjogZWNzLkNsdXN0ZXI7XG5cbiAgLyoqXG4gICAqIEZhcmdhdGUgdGFzayBob3N0aW5nIHRoZSBydW5uZXIuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSB0YXNrOiBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uO1xuXG4gIC8qKlxuICAgKiBDb250YWluZXIgZGVmaW5pdGlvbiBob3N0aW5nIHRoZSBydW5uZXIuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSBjb250YWluZXI6IGVjcy5Db250YWluZXJEZWZpbml0aW9uO1xuXG4gIC8qKlxuICAgKiBMYWJlbHMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcHJvdmlkZXIuXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBWUEMgdXNlZCBmb3IgaG9zdGluZyB0aGUgcnVubmVyIHRhc2suXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU3VibmV0cyB1c2VkIGZvciBob3N0aW5nIHRoZSBydW5uZXIgdGFzay5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgcnVubmVyIHRhc2sgd2lsbCBoYXZlIGEgcHVibGljIElQLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBUaGlzIGZpZWxkIGlzIGludGVybmFsIGFuZCBzaG91bGQgbm90IGJlIGFjY2Vzc2VkIGRpcmVjdGx5LlxuICAgKi9cbiAgcmVhZG9ubHkgYXNzaWduUHVibGljSXA6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIEdyYW50IHByaW5jaXBhbCB1c2VkIHRvIGFkZCBwZXJtaXNzaW9ucyB0byB0aGUgcnVubmVyIHJvbGUuXG4gICAqL1xuICByZWFkb25seSBncmFudFByaW5jaXBhbDogaWFtLklQcmluY2lwYWw7XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcmVhZG9ubHkgY29ubmVjdGlvbnM6IGVjMi5Db25uZWN0aW9ucztcblxuICAvKipcbiAgICogVXNlIHNwb3QgcHJpY2luZyBmb3IgRmFyZ2F0ZSB0YXNrcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IHNwb3Q6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERvY2tlciBpbWFnZSBsb2FkZWQgd2l0aCBHaXRIdWIgQWN0aW9ucyBSdW5uZXIgYW5kIGl0cyBwcmVyZXF1aXNpdGVzLiBUaGUgaW1hZ2UgaXMgYnVpbHQgYnkgYW4gaW1hZ2UgYnVpbGRlciBhbmQgaXMgc3BlY2lmaWMgdG8gRmFyZ2F0ZSB0YXNrcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IGltYWdlOiBSdW5uZXJJbWFnZTtcblxuICAvKipcbiAgICogTG9nIGdyb3VwIHdoZXJlIHByb3ZpZGVkIHJ1bm5lcnMgd2lsbCBzYXZlIHRoZWlyIGxvZ3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGlzIG5vdCB0aGUgam9iIGxvZywgYnV0IHRoZSBydW5uZXIgaXRzZWxmLiBJdCB3aWxsIG5vdCBjb250YWluIG91dHB1dCBmcm9tIHRoZSBHaXRIdWIgQWN0aW9uIGJ1dCBvbmx5IG1ldGFkYXRhIG9uIGl0cyBleGVjdXRpb24uXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cDogbG9ncy5JTG9nR3JvdXA7XG5cbiAgcmVhZG9ubHkgcmV0cnlhYmxlRXJyb3JzID0gW1xuICAgICdFY3MuRWNzRXhjZXB0aW9uJyxcbiAgICAnRWNzLkxpbWl0RXhjZWVkZWRFeGNlcHRpb24nLFxuICAgICdFY3MuVXBkYXRlSW5Qcm9ncmVzc0V4Y2VwdGlvbicsXG4gIF07XG5cbiAgcHJpdmF0ZSByZWFkb25seSBncm91cD86IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBkZWZhdWx0TGFiZWxzOiBib29sZWFuO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IEZhcmdhdGVSdW5uZXJQcm92aWRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICB0aGlzLmxhYmVscyA9IHRoaXMubGFiZWxzRnJvbVByb3BlcnRpZXMoJ2ZhcmdhdGUnLCBwcm9wcz8ubGFiZWwsIHByb3BzPy5sYWJlbHMpO1xuICAgIHRoaXMuZ3JvdXAgPSBwcm9wcz8uZ3JvdXA7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcbiAgICB0aGlzLnZwYyA9IHByb3BzPy52cGMgPz8gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdkZWZhdWx0IHZwYycsIHsgaXNEZWZhdWx0OiB0cnVlIH0pO1xuICAgIHRoaXMuc3VibmV0U2VsZWN0aW9uID0gcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbjtcbiAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gcHJvcHM/LnNlY3VyaXR5R3JvdXAgPyBbcHJvcHMuc2VjdXJpdHlHcm91cF0gOiAocHJvcHM/LnNlY3VyaXR5R3JvdXBzID8/IFtuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ3NlY3VyaXR5IGdyb3VwJywgeyB2cGM6IHRoaXMudnBjIH0pXSk7XG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IG5ldyBlYzIuQ29ubmVjdGlvbnMoeyBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3VwcyB9KTtcbiAgICB0aGlzLmFzc2lnblB1YmxpY0lwID0gcHJvcHM/LmFzc2lnblB1YmxpY0lwID8/IHRydWU7XG4gICAgdGhpcy5jbHVzdGVyID0gcHJvcHM/LmNsdXN0ZXIgPyBwcm9wcy5jbHVzdGVyIDogbmV3IGVjcy5DbHVzdGVyKFxuICAgICAgdGhpcyxcbiAgICAgICdjbHVzdGVyJyxcbiAgICAgIHtcbiAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgZW5hYmxlRmFyZ2F0ZUNhcGFjaXR5UHJvdmlkZXJzOiB0cnVlLFxuICAgICAgfSxcbiAgICApO1xuICAgIHRoaXMuc3BvdCA9IHByb3BzPy5zcG90ID8/IGZhbHNlO1xuXG4gICAgY29uc3QgaW1hZ2VCdWlsZGVyID0gcHJvcHM/LmltYWdlQnVpbGRlciA/PyBGYXJnYXRlUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKHRoaXMsICdJbWFnZSBCdWlsZGVyJyk7XG4gICAgY29uc3QgaW1hZ2UgPSB0aGlzLmltYWdlID0gaW1hZ2VCdWlsZGVyLmJpbmREb2NrZXJJbWFnZSgpO1xuXG4gICAgbGV0IGFyY2g6IGVjcy5DcHVBcmNoaXRlY3R1cmU7XG4gICAgaWYgKGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICBhcmNoID0gZWNzLkNwdUFyY2hpdGVjdHVyZS5BUk02NDtcbiAgICB9IGVsc2UgaWYgKGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgYXJjaCA9IGVjcy5DcHVBcmNoaXRlY3R1cmUuWDg2XzY0O1xuICAgIH0gZWxzZSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoYCR7aW1hZ2UuYXJjaGl0ZWN0dXJlLm5hbWV9IGlzIG5vdCBzdXBwb3J0ZWQgb24gRmFyZ2F0ZWApO1xuICAgICAgYXJjaCA9IGVjcy5DcHVBcmNoaXRlY3R1cmUuWDg2XzY0OyAvLyBzbyB0aGUgY29kZSBiZWxvdyBkb2Vzbid0IHRocm93IGFuIGV4Y2VwdGlvblxuICAgIH1cblxuICAgIGxldCBmYXJnYXRlUnVubmVyQ29tbWFuZE9zID0gaW1hZ2Uub3M7XG4gICAgbGV0IG9zOiBlY3MuT3BlcmF0aW5nU3lzdGVtRmFtaWx5O1xuICAgIGlmIChpbWFnZS5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICBvcyA9IGVjcy5PcGVyYXRpbmdTeXN0ZW1GYW1pbHkuTElOVVg7XG4gICAgfSBlbHNlIGlmIChpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgb3MgPSBlY3MuT3BlcmF0aW5nU3lzdGVtRmFtaWx5LldJTkRPV1NfU0VSVkVSXzIwMTlfQ09SRTtcbiAgICAgIGlmIChwcm9wcz8uZXBoZW1lcmFsU3RvcmFnZUdpQikge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoJ0VwaGVtZXJhbCBzdG9yYWdlIGlzIG5vdCBzdXBwb3J0ZWQgb24gRmFyZ2F0ZSBXaW5kb3dzJyk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcihgJHtpbWFnZS5vcy5uYW1lfSBpcyBub3Qgc3VwcG9ydGVkIG9uIEZhcmdhdGVgKTtcbiAgICAgIG9zID0gZWNzLk9wZXJhdGluZ1N5c3RlbUZhbWlseS5MSU5VWDtcbiAgICAgIGZhcmdhdGVSdW5uZXJDb21tYW5kT3MgPSBPcy5MSU5VWF9VQlVOVFU7XG4gICAgfVxuXG4gICAgdGhpcy5sb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdsb2dzJywge1xuICAgICAgcmV0ZW50aW9uOiBwcm9wcz8ubG9nUmV0ZW50aW9uID8/IFJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgdGhpcy50YXNrID0gbmV3IGVjcy5GYXJnYXRlVGFza0RlZmluaXRpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ3Rhc2snLFxuICAgICAge1xuICAgICAgICBjcHU6IHByb3BzPy5jcHUgPz8gMTAyNCxcbiAgICAgICAgbWVtb3J5TGltaXRNaUI6IHByb3BzPy5tZW1vcnlMaW1pdE1pQiA/PyAyMDQ4LFxuICAgICAgICBlcGhlbWVyYWxTdG9yYWdlR2lCOiBpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSA/IHVuZGVmaW5lZCA6IHByb3BzPy5lcGhlbWVyYWxTdG9yYWdlR2lCID8/IDI1LFxuICAgICAgICBydW50aW1lUGxhdGZvcm06IHtcbiAgICAgICAgICBvcGVyYXRpbmdTeXN0ZW1GYW1pbHk6IG9zLFxuICAgICAgICAgIGNwdUFyY2hpdGVjdHVyZTogYXJjaCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICB0aGlzLmNvbnRhaW5lciA9IHRoaXMudGFzay5hZGRDb250YWluZXIoXG4gICAgICAncnVubmVyJyxcbiAgICAgIHtcbiAgICAgICAgaW1hZ2U6IGVjcy5Bc3NldEltYWdlLmZyb21FY3JSZXBvc2l0b3J5KGltYWdlLmltYWdlUmVwb3NpdG9yeSwgaW1hZ2UuaW1hZ2VUYWcpLFxuICAgICAgICBsb2dnaW5nOiBlY3MuQXdzTG9nRHJpdmVyLmF3c0xvZ3Moe1xuICAgICAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLFxuICAgICAgICAgIHN0cmVhbVByZWZpeDogJ3J1bm5lcicsXG4gICAgICAgIH0pLFxuICAgICAgICBjb21tYW5kOiBlY3NSdW5Db21tYW5kKGZhcmdhdGVSdW5uZXJDb21tYW5kT3MsIGZhbHNlKSxcbiAgICAgICAgdXNlcjogaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykgPyB1bmRlZmluZWQgOiAncnVubmVyJyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwgPSB0aGlzLnRhc2sudGFza1JvbGU7XG5cbiAgICAvLyBhbGxvdyBTU00gU2Vzc2lvbiBNYW5hZ2VyXG4gICAgdGhpcy50YXNrLnRhc2tSb2xlLmFkZFRvUHJpbmNpcGFsUG9saWN5KE1JTklNQUxfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZSBzdGVwIGZ1bmN0aW9uIHRhc2socykgdG8gc3RhcnQgYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBDYWxsZWQgYnkgR2l0aHViUnVubmVycyBhbmQgc2hvdWxkbid0IGJlIGNhbGxlZCBtYW51YWxseS5cbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlcnMgd29ya2Zsb3cgam9iIGRldGFpbHNcbiAgICovXG4gIGdldFN0ZXBGdW5jdGlvblRhc2socGFyYW1ldGVyczogSVJ1bm5lclJ1bnRpbWVQYXJhbWV0ZXJzKTogc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlIHtcbiAgICByZXR1cm4gbmV3IHN0ZXBmdW5jdGlvbnNfdGFza3MuRWNzUnVuVGFzayhcbiAgICAgIHRoaXMsXG4gICAgICAnU3RhdGUnLFxuICAgICAge1xuICAgICAgICBzdGF0ZU5hbWU6IGdlbmVyYXRlU3RhdGVOYW1lKHRoaXMpLFxuICAgICAgICBpbnRlZ3JhdGlvblBhdHRlcm46IEludGVncmF0aW9uUGF0dGVybi5SVU5fSk9CLCAvLyBzeW5jXG4gICAgICAgIHRhc2tEZWZpbml0aW9uOiB0aGlzLnRhc2ssXG4gICAgICAgIGNsdXN0ZXI6IHRoaXMuY2x1c3RlcixcbiAgICAgICAgbGF1bmNoVGFyZ2V0OiBuZXcgc3RlcGZ1bmN0aW9uc190YXNrcy5FY3NGYXJnYXRlTGF1bmNoVGFyZ2V0KHtcbiAgICAgICAgICBwbGF0Zm9ybVZlcnNpb246IGVjcy5GYXJnYXRlUGxhdGZvcm1WZXJzaW9uLkxBVEVTVCxcbiAgICAgICAgICBjYXBhY2l0eVByb3ZpZGVyT3B0aW9uczogc3RlcGZ1bmN0aW9uc190YXNrcy5DYXBhY2l0eVByb3ZpZGVyT3B0aW9ucy5jdXN0b20oW3tcbiAgICAgICAgICAgIGNhcGFjaXR5UHJvdmlkZXI6IHRoaXMuc3BvdCA/ICdGQVJHQVRFX1NQT1QnIDogJ0ZBUkdBVEUnLFxuICAgICAgICAgIH1dKSxcbiAgICAgICAgfSksXG4gICAgICAgIGVuYWJsZUV4ZWN1dGVDb21tYW5kOiB0aGlzLmltYWdlLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUyksXG4gICAgICAgIHByb3BhZ2F0ZWRUYWdTb3VyY2U6IGVjcy5Qcm9wYWdhdGVkVGFnU291cmNlLlRBU0tfREVGSU5JVElPTixcbiAgICAgICAgc3VibmV0czogdGhpcy5zdWJuZXRTZWxlY3Rpb24sXG4gICAgICAgIGFzc2lnblB1YmxpY0lwOiB0aGlzLmFzc2lnblB1YmxpY0lwLFxuICAgICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3VwcyxcbiAgICAgICAgY29udGFpbmVyT3ZlcnJpZGVzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgY29udGFpbmVyRGVmaW5pdGlvbjogdGhpcy5jb250YWluZXIsXG4gICAgICAgICAgICBlbnZpcm9ubWVudDogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1JVTk5FUl9UT0tFTicsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucnVubmVyVG9rZW5QYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ0pJVF9DT05GSUcnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLmppdENvbmZpZ1BhdGgsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnUlVOTkVSX05BTUUnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLnJ1bm5lck5hbWVQYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1JVTk5FUl9MQUJFTCcsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMubGFiZWxzUGF0aCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdSVU5ORVJfR1JPVVAxJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogdGhpcy5ncm91cCA/ICctLXJ1bm5lcmdyb3VwJyA6ICcnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1JVTk5FUl9HUk9VUDInLFxuICAgICAgICAgICAgICAgIHZhbHVlOiB0aGlzLmdyb3VwID8gdGhpcy5ncm91cCA6ICcnLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ0RFRkFVTFRfTEFCRUxTJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogdGhpcy5kZWZhdWx0TGFiZWxzID8gJycgOiAnLS1uby1kZWZhdWx0LWxhYmVscycsXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBuYW1lOiAnR0lUSFVCX0RPTUFJTicsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMuZ2l0aHViRG9tYWluUGF0aCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIG5hbWU6ICdPV05FUicsXG4gICAgICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMub3duZXJQYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1JFUE8nLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLnJlcG9QYXRoLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbmFtZTogJ1JFR0lTVFJBVElPTl9VUkwnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLnJlZ2lzdHJhdGlvblVybCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIGdyYW50U3RhdGVNYWNoaW5lKF86IGlhbS5JR3JhbnRhYmxlKSB7XG4gIH1cblxuICBzdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1cyB7XG4gICAgdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkuZ3JhbnQoc3RhdHVzRnVuY3Rpb25Sb2xlLCAnZWNyOkRlc2NyaWJlSW1hZ2VzJyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgbGFiZWxzOiB0aGlzLmxhYmVscyxcbiAgICAgIGNvbnN0cnVjdFBhdGg6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgdnBjQXJuOiB0aGlzLnZwYz8udnBjQXJuLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICByb2xlQXJuOiB0aGlzLnRhc2sudGFza1JvbGUucm9sZUFybixcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGltYWdlOiB7XG4gICAgICAgIGltYWdlUmVwb3NpdG9yeTogdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgaW1hZ2VUYWc6IHRoaXMuaW1hZ2UuaW1hZ2VUYWcsXG4gICAgICAgIGltYWdlQnVpbGRlckxvZ0dyb3VwOiB0aGlzLmltYWdlLmxvZ0dyb3VwPy5sb2dHcm91cE5hbWUsXG4gICAgICB9LFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIEZhcmdhdGVSdW5uZXJQcm92aWRlcn1cbiAqL1xuZXhwb3J0IGNsYXNzIEZhcmdhdGVSdW5uZXIgZXh0ZW5kcyBGYXJnYXRlUnVubmVyUHJvdmlkZXIge1xufVxuIl19