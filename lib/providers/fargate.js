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
exports.FargateRunner = exports.FargateRunnerProvider = void 0;
exports.ecsRunCommand = ecsRunCommand;
exports.grantEcsRunTask = grantEcsRunTask;
exports.cleanEcsTag = cleanEcsTag;
exports.ecsTags = ecsTags;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const path = __importStar(require("path"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const common_1 = require("./common");
const image_builders_1 = require("../image-builders");
const lambda_common_1 = require("../lambda-common");
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
        ./job-reporter.sh "$RUNNER_NAME" &&
        if [ -n "$RUNNER_JIT_CONFIG" ]; then
          ./run.sh --jitconfig "$RUNNER_JIT_CONFIG";
        else
          # DEPRECATED: remove in 1.0.0 with this whole else branch. executions that started before JIT runners pass a registration token instead.
          if [ "$RUNNER_VERSION" = "latest" ]; then RUNNER_FLAGS=""; else RUNNER_FLAGS="--disableupdate"; fi &&
          ./config.sh --unattended --url "$REGISTRATION_URL" --token "$RUNNER_TOKEN" --ephemeral --work _work --labels "$RUNNER_LABEL,cdkghr:started:\`date +%s\`" $RUNNER_FLAGS --name "$RUNNER_NAME" $RUNNER_GROUP1 $RUNNER_GROUP2 $DEFAULT_LABELS &&
          ./run.sh;
        fi &&
        STATUS=$(grep -Phors "finish job request for job [0-9a-f-]+ with result: .*" _diag | tail -n1 | awk '{print $NF}') &&
        if [ -n "$STATUS" ]; then echo CDKGHA JOB DONE "$RUNNER_LABEL" "$STATUS"; fi`,
        ];
    }
    else if (os.is(common_1.Os.WINDOWS)) {
        // DEPRECATED: remove in 1.0.0 with the else branch below. executions that started before JIT runners pass a registration token instead.
        return [
            'powershell', '-Command',
            `cd \\actions ;
        & ./job-reporter.ps1 "$Env:RUNNER_NAME" ;
        if ($Env:RUNNER_JIT_CONFIG) {
          ./run.cmd --jitconfig "$Env:RUNNER_JIT_CONFIG"
        } else {
          if ($Env:RUNNER_VERSION -eq "latest") { $RunnerFlags = "" } else { $RunnerFlags = "--disableupdate" }
          ./config.cmd --unattended --url "$Env:REGISTRATION_URL" --token "$Env:RUNNER_TOKEN" --ephemeral --work _work --labels "$Env:RUNNER_LABEL,cdkghr:started:\$(Get-Date -UFormat +%s)" $RunnerFlags --name "$Env:RUNNER_NAME" $Env:RUNNER_GROUP1 $Env:RUNNER_GROUP2 $Env:DEFAULT_LABELS
          ./run.cmd
        } ;
        $STATUS = Select-String -Path './_diag/*.log' -Pattern 'finish job request for job [0-9a-f\\-]+ with result: (.*)' | %{$_.Matches.Groups[1].Value} | Select-Object -Last 1 ;
        if ($STATUS) { echo "CDKGHA JOB DONE $Env:RUNNER_LABEL $STATUS" }`,
        ];
    }
    else {
        throw new Error(`Fargate runner doesn't support ${os.name}`);
    }
}
/**
 * Grant the state machine role whatever ecs:runTask.sync needs to run and track a task definition. Same
 * statements stepfunctions_tasks.EcsRunTask would have generated for us.
 *
 * @internal
 */
function grantEcsRunTask(scope, stateMachineRole, task) {
    const stack = cdk.Stack.of(scope);
    // grant on the unversioned task definition arn so we can always run the latest revision
    const arnComponents = stack.splitArn(task.taskDefinitionArn, cdk.ArnFormat.SLASH_RESOURCE_NAME);
    let resourceName = arnComponents.resourceName;
    if (resourceName) {
        resourceName = resourceName.split(':')[0];
    }
    const familyArn = stack.formatArn({
        partition: arnComponents.partition,
        service: arnComponents.service,
        account: arnComponents.account,
        region: arnComponents.region,
        resource: arnComponents.resource,
        arnFormat: arnComponents.arnFormat,
        resourceName,
    });
    stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ['ecs:RunTask'],
        resources: [`${familyArn}:*`],
    }));
    stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ['ecs:StopTask', 'ecs:DescribeTasks'],
        resources: ['*'],
    }));
    // tagging the task on creation needs its own permission
    stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ['ecs:TagResource'],
        resources: ['*'],
        conditions: {
            StringEquals: {
                'ecs:CreateAction': 'RunTask',
            },
        },
    }));
    const passedRoles = [task.taskRole.roleArn];
    if (task.executionRole) {
        passedRoles.push(task.executionRole.roleArn);
    }
    stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: passedRoles,
    }));
    // managed rule for the runTask.sync integration
    // every ECS and Fargate provider emits the same statement so policy minimization keeps just one
    stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
        actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
        resources: [stack.formatArn({
                service: 'events',
                resource: 'rule',
                resourceName: 'StepFunctionsGetEventsForECSTaskRule',
            })],
    }));
}
/**
 * @internal
 */
function cleanEcsTag(scope, description, value) {
    const cleaned = value.replace(/[^\p{L}\p{Z}\p{N}_.:/=+\-@]/gu, '_').slice(0, 256);
    if (cleaned !== value) {
        cdk.Annotations.of(scope).addWarning(`ECS tags can only contain up to 256 letters, numbers, spaces, and _ . : / = + - @, so the ${description} will be tagged as ` +
            `${JSON.stringify(cleaned.slice(0, 100))}`);
    }
    return cleaned;
}
/**
 * Tags for a runner task, on top of the standard runner tags the orchestrator merges in at runtime.
 *
 * ECS is a lot pickier about tags than EC2. It doesn't allow commas which we use in labels, no parenthesis, no brackets, and others. For data that
 * used to allow those characters, we clean up the tag and warn the user. For tags manually set on the provider (new feature), we instead error out.
 *
 * `Name`, `GitHubRunners:Repo` and `GitHubRunners:Labels` are left to the orchestrator. The first two are built out of the repository name and the
 * webhook delivery id, and GitHub doesn't allow anything ECS would reject. Labels are only known when a job comes in, so the orchestrator cleans
 * them up instead (see `cleanLabels` in selectProviderParams). Unlike EC2 tags, they end up separated with spaces. Which honestly is quite annoying.
 *
 * @internal
 */
function ecsTags(scope, tags) {
    // https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_Tag.html
    const allowed = /^[\p{L}\p{Z}\p{N}_.:/=+\-@]*$/u;
    const check = (description, value, maxLength) => {
        if (!allowed.test(value)) {
            cdk.Annotations.of(scope).addError(`Bad character in ${description}. ECS tags can only contain letters, numbers, spaces, and _ . : / = + - @: ${JSON.stringify(value.slice(0, 100))}`);
        }
        if (value.length > maxLength) {
            cdk.Annotations.of(scope).addError(`Too many characters in ${description}. ECS tags are limited to ${maxLength} characters: ${JSON.stringify(value.slice(0, 100))}`);
        }
    };
    if (Object.keys(tags).length > 45) {
        cdk.Annotations.of(scope).addError('Too many tags. ECS tags are limited to 50 tags, and 5 are already used by the orchestrator.');
    }
    for (const [key, value] of Object.entries(tags)) {
        if (!key) {
            cdk.Annotations.of(scope).addError('Tag names cannot be empty');
        }
        if (key.toLowerCase().startsWith('aws:')) {
            cdk.Annotations.of(scope).addError(`Tag names cannot start with "aws:": ${JSON.stringify(key)}`);
        }
        if (key.startsWith(lambda_common_1.ReservedTags.PREFIX)) {
            cdk.Annotations.of(scope).addError(`Tag names cannot start with "${lambda_common_1.ReservedTags.PREFIX}": ${JSON.stringify(key)}`);
        }
        check('tag name', key, 128);
        check('tag value', value, 256);
    }
    // the user's tags come last so they can override ours, just like they override the orchestrator's standard tags
    return {
        'GitHubRunners:Provider': cleanEcsTag(scope, 'provider construct path', scope.node.path),
        ...tags,
    };
}
/**
 * GitHub Actions runner provider using Fargate to execute jobs.
 *
 * Creates a task definition with a single container that gets started for each job.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
class FargateRunnerProvider extends common_1.BaseProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.FargateRunnerProvider", version: "0.0.0" };
    /** @internal */
    static _FAMILY = 'fargate';
    /**
     * Path to Dockerfile for Linux x64 with all the requirement for Fargate runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
     *
     * Available build arguments that can be set in the image builder:
     * * `BASE_IMAGE` sets the `FROM` line. This should be an Ubuntu compatible image.
     * * `EXTRA_PACKAGES` can be used to install additional packages.
     *
     * @deprecated Use `imageBuilder()` instead.
     */
    static LINUX_X64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'fargate', 'linux-x64');
    /**
     * Path to Dockerfile for Linux ARM64 with all the requirement for Fargate runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
     *
     * Available build arguments that can be set in the image builder:
     * * `BASE_IMAGE` sets the `FROM` line. This should be an Ubuntu compatible image.
     * * `EXTRA_PACKAGES` can be used to install additional packages.
     *
     * @deprecated Use `imageBuilder()` instead.
     */
    static LINUX_ARM64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'fargate', 'linux-arm64');
    /**
     * The fragment that runs any Fargate provider. Reads the config {@link _runnerConfig} generated for it from
     * `$.providerParams`. Renders what EcsRunTask used to render per provider.
     *
     * @internal
     */
    static _stateMachineFragment(scope) {
        const p = (common_1.providerParam);
        return new aws_cdk_lib_1.aws_stepfunctions.CustomState(scope, 'Fargate Runner', {
            stateJson: {
                Type: 'Task',
                Resource: `arn:${cdk.Aws.PARTITION}:states:::ecs:runTask.sync`,
                Parameters: {
                    'Cluster.$': p('clusterArn'),
                    'TaskDefinition.$': p('taskDefinitionFamily'),
                    'NetworkConfiguration': {
                        AwsvpcConfiguration: {
                            'AssignPublicIp.$': p('assignPublicIp'),
                            'Subnets.$': p('subnets'),
                            'SecurityGroups.$': p('securityGroups'),
                        },
                    },
                    'Overrides': {
                        ContainerOverrides: [{
                                'Name.$': p('containerName'),
                                'Environment': (0, common_1.runnerEnvironment)((name, value) => ({ 'Name': name, 'Value.$': value })),
                            }],
                    },
                    'PropagateTags': 'TASK_DEFINITION',
                    'Tags.$': p('tags'), // the provider's tags, already merged with the standard runner tags by the orchestrator
                    'CapacityProviderStrategy': [{
                            'CapacityProvider.$': p('capacityProvider'),
                        }],
                    'PlatformVersion': 'LATEST',
                    'EnableExecuteCommand.$': p('enableExecuteCommand'),
                },
            },
        });
    }
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
    /**
     * Cluster hosting the task hosting the runner.
     */
    cluster;
    /**
     * Fargate task hosting the runner.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    task;
    /**
     * Container definition hosting the runner.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    container;
    /**
     * Labels associated with this provider.
     */
    labels;
    /**
     * VPC used for hosting the runner task.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    vpc;
    /**
     * Subnets used for hosting the runner task.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    subnetSelection;
    /**
     * Whether runner task will have a public IP.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    assignPublicIp;
    /**
     * Grant principal used to add permissions to the runner role.
     */
    grantPrincipal;
    /**
     * The network connections associated with this resource.
     */
    connections;
    /**
     * Use spot pricing for Fargate tasks.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    spot;
    /**
     * Docker image loaded with GitHub Actions Runner and its prerequisites. The image is built by an image builder and is specific to Fargate tasks.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    image;
    /**
     * Log group where provided runners will save their logs.
     *
     * Note that this is not the job log, but the runner itself. It will not contain output from the GitHub Action but only metadata on its execution.
     */
    logGroup;
    group;
    defaultLabels;
    securityGroups;
    tags;
    constructor(scope, id, props) {
        super(scope, id, props);
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
        this.tags = ecsTags(this, props?.tags ?? {});
        // all providers add this tag, but ECS/Fargate tags need to be cleaned
        cdk.Tags.of(this).add('GitHubRunners:Provider', cleanEcsTag(this, 'provider tag', this.node.path));
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
     * Config for the shared Fargate fragment.
     *
     * @internal
     */
    _runnerConfig() {
        // same subnet selection EcsRunTask defaults to: whatever was asked for, or public/private per assignPublicIp
        const subnetSelection = this.subnetSelection ??
            { subnetType: this.assignPublicIp ? aws_cdk_lib_1.aws_ec2.SubnetType.PUBLIC : aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS };
        return {
            family: FargateRunnerProvider._FAMILY,
            provider: this.node.path,
            clusterArn: this.cluster.clusterArn,
            taskDefinitionFamily: this.task.family,
            containerName: this.container.containerName,
            capacityProvider: this.spot ? 'FARGATE_SPOT' : 'FARGATE',
            enableExecuteCommand: this.image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS),
            subnets: this.cluster.vpc.selectSubnets(subnetSelection).subnetIds,
            securityGroups: this.securityGroups.map(sg => sg.securityGroupId),
            assignPublicIp: this.assignPublicIp ? 'ENABLED' : 'DISABLED',
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
        grantEcsRunTask(this, stateMachineRole, this.task);
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
exports.FargateRunnerProvider = FargateRunnerProvider;
/**
 * @deprecated use {@link FargateRunnerProvider}
 */
class FargateRunner extends FargateRunnerProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.FargateRunner", version: "0.0.0" };
}
exports.FargateRunner = FargateRunner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFyZ2F0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9wcm92aWRlcnMvZmFyZ2F0ZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUF5TEEsc0NBMkNDO0FBUUQsMENBMERDO0FBS0Qsa0NBU0M7QUFjRCwwQkF3Q0M7O0FBMVdELDJDQUE2QjtBQUM3QixpREFBbUM7QUFDbkMsNkNBQWtKO0FBQ2xKLG1EQUFxRDtBQUVyRCxxQ0Fha0I7QUFDbEIsc0RBQTJIO0FBQzNILG9EQUFnRDtBQUNoRCxvQ0FBd0U7QUFpS3hFOztHQUVHO0FBQ0gsU0FBZ0IsYUFBYSxDQUFDLEVBQU0sRUFBRSxJQUFhO0lBQ2pELElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxXQUFFLENBQUMsbUJBQW1CLENBQUMsRUFBRSxDQUFDO1FBQ3BDLElBQUksV0FBVyxHQUFHLEVBQUUsQ0FBQztRQUNyQixJQUFJLElBQUksRUFBRSxDQUFDO1lBQ1QsV0FBVyxHQUFHLGdIQUFnSDtnQkFDNUgsZ0VBQWdFLENBQUM7UUFDckUsQ0FBQztRQUVELE9BQU87WUFDTCxJQUFJLEVBQUUsSUFBSTtZQUNWLEdBQUcsV0FBVzs7Ozs7Ozs7Ozs7O3FGQVlpRTtTQUNoRixDQUFDO0lBQ0osQ0FBQztTQUFNLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxXQUFFLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUM3Qix3SUFBd0k7UUFDeEksT0FBTztZQUNMLFlBQVksRUFBRSxVQUFVO1lBQ3hCOzs7Ozs7Ozs7OzBFQVVvRTtTQUNyRSxDQUFDO0lBQ0osQ0FBQztTQUFNLENBQUM7UUFDTixNQUFNLElBQUksS0FBSyxDQUFDLGtDQUFrQyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUMvRCxDQUFDO0FBQ0gsQ0FBQztBQUVEOzs7OztHQUtHO0FBQ0gsU0FBZ0IsZUFBZSxDQUFDLEtBQWdCLEVBQUUsZ0JB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QUNGLENBQUM7SUFDSixDQUFDOztBQXhVSCxzREF5VUM7QUFFRDs7R0FFRztBQUNILE1BQWEsYUFBYyxTQUFRLHFCQUFxQjs7O0FBQXhELHNDQUNDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBhd3NfZWMyIGFzIGVjMiwgYXdzX2VjcyBhcyBlY3MsIGF3c19pYW0gYXMgaWFtLCBhd3NfbG9ncyBhcyBsb2dzLCBhd3Nfc3RlcGZ1bmN0aW9ucyBhcyBzdGVwZnVuY3Rpb25zLCBSZW1vdmFsUG9saWN5IH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHtcbiAgQXJjaGl0ZWN0dXJlLFxuICBCYXNlUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyU3RhdHVzLFxuICBPcyxcbiAgcnVubmVyRW52aXJvbm1lbnQsXG4gIFJ1bm5lckltYWdlLFxuICBSdW5uZXJQcm92aWRlclByb3BzLFxuICBSdW5uZXJWZXJzaW9uLFxuICBwcm92aWRlclBhcmFtLFxuICBSdW5uZXJDb25maWcsXG4gIHJ1bm5lckRlZmF1bHRMYWJlbHMsXG59IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IElSdW5uZXJJbWFnZUJ1aWxkZXIsIFJ1bm5lckltYWdlQnVpbGRlciwgUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMsIFJ1bm5lckltYWdlQ29tcG9uZW50IH0gZnJvbSAnLi4vaW1hZ2UtYnVpbGRlcnMnO1xuaW1wb3J0IHsgUmVzZXJ2ZWRUYWdzIH0gZnJvbSAnLi4vbGFtYmRhLWNvbW1vbic7XG5pbXBvcnQgeyBNSU5JTUFMX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCB9IGZyb20gJy4uL3V0aWxzJztcblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBGYXJnYXRlUnVubmVyUHJvdmlkZXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgRG9ja2VyIGltYWdlcyBjb250YWluaW5nIEdpdEh1YiBSdW5uZXIgYW5kIGFsbCByZXF1aXJlbWVudHMuXG4gICAqXG4gICAqIFRoZSBpbWFnZSBidWlsZGVyIGRldGVybWluZXMgdGhlIE9TIGFuZCBhcmNoaXRlY3R1cmUgb2YgdGhlIHJ1bm5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcigpXG4gICAqL1xuICByZWFkb25seSBpbWFnZUJ1aWxkZXI/OiBJUnVubmVySW1hZ2VCdWlsZGVyO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBsYWJlbCB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBsYWJlbHN9IGluc3RlYWRcbiAgICovXG4gIHJlYWRvbmx5IGxhYmVsPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBsYWJlbHMgdXNlZCBmb3IgdGhpcyBwcm92aWRlci5cbiAgICpcbiAgICogVGhlc2UgbGFiZWxzIGFyZSB1c2VkIHRvIGlkZW50aWZ5IHdoaWNoIHByb3ZpZGVyIHNob3VsZCBzcGF3biBhIG5ldyBvbi1kZW1hbmQgcnVubmVyLiBFdmVyeSBqb2Igc2VuZHMgYSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBpdCdzIGxvb2tpbmcgZm9yXG4gICAqIGJhc2VkIG9uIHJ1bnMtb24uIFdlIG1hdGNoIHRoZSBsYWJlbHMgZnJvbSB0aGUgd2ViaG9vayB3aXRoIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUuIElmIGFsbCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlIGFyZSBwcmVzZW50IGluIHRoZVxuICAgKiBqb2IncyBsYWJlbHMsIHRoaXMgcHJvdmlkZXIgd2lsbCBiZSBjaG9zZW4gYW5kIHNwYXduIGEgbmV3IHJ1bm5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgWydmYXJnYXRlJ11cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVscz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBydW5uZXIgZ3JvdXAgbmFtZS5cbiAgICpcbiAgICogSWYgc3BlY2lmaWVkLCB0aGUgcnVubmVyIHdpbGwgYmUgcmVnaXN0ZXJlZCB3aXRoIHRoaXMgZ3JvdXAgbmFtZS4gU2V0dGluZyBhIHJ1bm5lciBncm91cCBjYW4gaGVscCBtYW5hZ2luZyBhY2Nlc3MgdG8gc2VsZi1ob3N0ZWQgcnVubmVycy4gSXRcbiAgICogcmVxdWlyZXMgYSBwYWlkIEdpdEh1YiBhY2NvdW50IGFuZCBvcmdhbml6YXRpb24gbGV2ZWwgcnVubmVyIHJlZ2lzdHJhdGlvbi5cbiAgICpcbiAgICogVGhlIGdyb3VwIG11c3QgZXhpc3Qgb3IgdGhlIHJ1bm5lciB3aWxsIG5vdCBzdGFydC5cbiAgICpcbiAgICogVXNlcnMgd2lsbCBzdGlsbCBiZSBhYmxlIHRvIHRyaWdnZXIgdGhpcyBydW5uZXIgd2l0aCB0aGUgY29ycmVjdCBsYWJlbHMuIEJ1dCB0aGUgcnVubmVyIHdpbGwgb25seSBiZSBhYmxlIHRvIHJ1biBqb2JzIGZyb20gcmVwb3MgYWxsb3dlZCB0byB1c2UgdGhlIGdyb3VwLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBWUEMgdG8gbGF1bmNoIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IGFjY291bnQgVlBDXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU3VibmV0cyB0byBydW4gdGhlIHJ1bm5lcnMgaW4uXG4gICAqXG4gICAqIEBkZWZhdWx0IEZhcmdhdGUgZGVmYXVsdFxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXAgdG8gYXNzaWduIHRvIHRoZSB0YXNrLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBzZWN1cml0eSBncm91cFxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIHNlY3VyaXR5R3JvdXBzfVxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cD86IGVjMi5JU2VjdXJpdHlHcm91cDtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXBzIHRvIGFzc2lnbiB0byB0aGUgdGFzay5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgLyoqXG4gICAqIEV4aXN0aW5nIEZhcmdhdGUgY2x1c3RlciB0byB1c2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IGEgbmV3IGNsdXN0ZXJcbiAgICovXG4gIHJlYWRvbmx5IGNsdXN0ZXI/OiBlY3MuQ2x1c3RlcjtcblxuICAvKipcbiAgICogQXNzaWduIHB1YmxpYyBJUCB0byB0aGUgcnVubmVyIHRhc2suXG4gICAqXG4gICAqIE1ha2Ugc3VyZSB0aGUgdGFzayB3aWxsIGhhdmUgYWNjZXNzIHRvIEdpdEh1Yi4gQSBwdWJsaWMgSVAgbWlnaHQgYmUgcmVxdWlyZWQgdW5sZXNzIHlvdSBoYXZlIE5BVCBnYXRld2F5LlxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBhc3NpZ25QdWJsaWNJcD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgY3B1IHVuaXRzIHVzZWQgYnkgdGhlIHRhc2suIEZvciB0YXNrcyB1c2luZyB0aGUgRmFyZ2F0ZSBsYXVuY2ggdHlwZSxcbiAgICogdGhpcyBmaWVsZCBpcyByZXF1aXJlZCBhbmQgeW91IG11c3QgdXNlIG9uZSBvZiB0aGUgZm9sbG93aW5nIHZhbHVlcyxcbiAgICogd2hpY2ggZGV0ZXJtaW5lcyB5b3VyIHJhbmdlIG9mIHZhbGlkIHZhbHVlcyBmb3IgdGhlIG1lbW9yeSBwYXJhbWV0ZXI6XG4gICAqXG4gICAqIDI1NiAoLjI1IHZDUFUpIC0gQXZhaWxhYmxlIG1lbW9yeSB2YWx1ZXM6IDUxMiAoMC41IEdCKSwgMTAyNCAoMSBHQiksIDIwNDggKDIgR0IpXG4gICAqXG4gICAqIDUxMiAoLjUgdkNQVSkgLSBBdmFpbGFibGUgbWVtb3J5IHZhbHVlczogMTAyNCAoMSBHQiksIDIwNDggKDIgR0IpLCAzMDcyICgzIEdCKSwgNDA5NiAoNCBHQilcbiAgICpcbiAgICogMTAyNCAoMSB2Q1BVKSAtIEF2YWlsYWJsZSBtZW1vcnkgdmFsdWVzOiAyMDQ4ICgyIEdCKSwgMzA3MiAoMyBHQiksIDQwOTYgKDQgR0IpLCA1MTIwICg1IEdCKSwgNjE0NCAoNiBHQiksIDcxNjggKDcgR0IpLCA4MTkyICg4IEdCKVxuICAgKlxuICAgKiAyMDQ4ICgyIHZDUFUpIC0gQXZhaWxhYmxlIG1lbW9yeSB2YWx1ZXM6IEJldHdlZW4gNDA5NiAoNCBHQikgYW5kIDE2Mzg0ICgxNiBHQikgaW4gaW5jcmVtZW50cyBvZiAxMDI0ICgxIEdCKVxuICAgKlxuICAgKiA0MDk2ICg0IHZDUFUpIC0gQXZhaWxhYmxlIG1lbW9yeSB2YWx1ZXM6IEJldHdlZW4gODE5MiAoOCBHQikgYW5kIDMwNzIwICgzMCBHQikgaW4gaW5jcmVtZW50cyBvZiAxMDI0ICgxIEdCKVxuICAgKlxuICAgKiBAZGVmYXVsdCAxMDI0XG4gICAqL1xuICByZWFkb25seSBjcHU/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBhbW91bnQgKGluIE1pQikgb2YgbWVtb3J5IHVzZWQgYnkgdGhlIHRhc2suIEZvciB0YXNrcyB1c2luZyB0aGUgRmFyZ2F0ZSBsYXVuY2ggdHlwZSxcbiAgICogdGhpcyBmaWVsZCBpcyByZXF1aXJlZCBhbmQgeW91IG11c3QgdXNlIG9uZSBvZiB0aGUgZm9sbG93aW5nIHZhbHVlcywgd2hpY2ggZGV0ZXJtaW5lcyB5b3VyIHJhbmdlIG9mIHZhbGlkIHZhbHVlcyBmb3IgdGhlIGNwdSBwYXJhbWV0ZXI6XG4gICAqXG4gICAqIDUxMiAoMC41IEdCKSwgMTAyNCAoMSBHQiksIDIwNDggKDIgR0IpIC0gQXZhaWxhYmxlIGNwdSB2YWx1ZXM6IDI1NiAoLjI1IHZDUFUpXG4gICAqXG4gICAqIDEwMjQgKDEgR0IpLCAyMDQ4ICgyIEdCKSwgMzA3MiAoMyBHQiksIDQwOTYgKDQgR0IpIC0gQXZhaWxhYmxlIGNwdSB2YWx1ZXM6IDUxMiAoLjUgdkNQVSlcbiAgICpcbiAgICogMjA0OCAoMiBHQiksIDMwNzIgKDMgR0IpLCA0MDk2ICg0IEdCKSwgNTEyMCAoNSBHQiksIDYxNDQgKDYgR0IpLCA3MTY4ICg3IEdCKSwgODE5MiAoOCBHQikgLSBBdmFpbGFibGUgY3B1IHZhbHVlczogMTAyNCAoMSB2Q1BVKVxuICAgKlxuICAgKiBCZXR3ZWVuIDQwOTYgKDQgR0IpIGFuZCAxNjM4NCAoMTYgR0IpIGluIGluY3JlbWVudHMgb2YgMTAyNCAoMSBHQikgLSBBdmFpbGFibGUgY3B1IHZhbHVlczogMjA0OCAoMiB2Q1BVKVxuICAgKlxuICAgKiBCZXR3ZWVuIDgxOTIgKDggR0IpIGFuZCAzMDcyMCAoMzAgR0IpIGluIGluY3JlbWVudHMgb2YgMTAyNCAoMSBHQikgLSBBdmFpbGFibGUgY3B1IHZhbHVlczogNDA5NiAoNCB2Q1BVKVxuICAgKlxuICAgKiBAZGVmYXVsdCAyMDQ4XG4gICAqL1xuICByZWFkb25seSBtZW1vcnlMaW1pdE1pQj86IG51bWJlcjtcblxuICAvKipcbiAgICogVGhlIGFtb3VudCAoaW4gR2lCKSBvZiBlcGhlbWVyYWwgc3RvcmFnZSB0byBiZSBhbGxvY2F0ZWQgdG8gdGhlIHRhc2suIFRoZSBtYXhpbXVtIHN1cHBvcnRlZCB2YWx1ZSBpcyAyMDAgR2lCLlxuICAgKlxuICAgKiBOT1RFOiBUaGlzIHBhcmFtZXRlciBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgdGFza3MgaG9zdGVkIG9uIEFXUyBGYXJnYXRlIHVzaW5nIHBsYXRmb3JtIHZlcnNpb24gMS40LjAgb3IgbGF0ZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IDIwXG4gICAqL1xuICByZWFkb25seSBlcGhlbWVyYWxTdG9yYWdlR2lCPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBVc2UgRmFyZ2F0ZSBzcG90IGNhcGFjaXR5IHByb3ZpZGVyIHRvIHNhdmUgbW9uZXkuXG4gICAqXG4gICAqICogUnVubmVycyBtYXkgZmFpbCB0byBzdGFydCBkdWUgdG8gbWlzc2luZyBjYXBhY2l0eS5cbiAgICogKiBSdW5uZXJzIG1pZ2h0IGJlIHN0b3BwZWQgcHJlbWF0dXJlbHkgd2l0aCBzcG90IHByaWNpbmcuXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBzcG90PzogYm9vbGVhbjtcblxuICAvKipcbiAgICogQWRkaXRpb25hbCB0YWdzIHRvIGFwcGx5IHRvIGxhdW5jaGVkIHJ1bm5lciB0YXNrcy5cbiAgICpcbiAgICogVGhlc2UgYWRkaXRpb25hbCB0YWdzIGFyZSBzZXQgb24gdG9wIG9mIGBOYW1lYCwgYEdpdEh1YlJ1bm5lcnM6UHJvdmlkZXJgLCBgR2l0SHViUnVubmVyczpSZXBvYCwgYW5kIGBHaXRIdWJSdW5uZXJzOkxhYmVsc2AuXG4gICAqIFlvdSBtYXkgbm90IG92ZXJyaWRlIHRhZ3Mgd2l0aCB0aGUgYEdpdEh1YlJ1bm5lcnM6YCBwcmVmaXguXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIGFkZGl0aW9uYWwgdGFnc1xuICAgKi9cbiAgcmVhZG9ubHkgdGFncz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG59XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlY3NSdW5Db21tYW5kKG9zOiBPcywgZGluZDogYm9vbGVhbik6IHN0cmluZ1tdIHtcbiAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICBsZXQgZGluZENvbW1hbmQgPSAnJztcbiAgICBpZiAoZGluZCkge1xuICAgICAgZGluZENvbW1hbmQgPSAnbm9odXAgc3VkbyBkb2NrZXJkIC0taG9zdD11bml4Oi8vL3Zhci9ydW4vZG9ja2VyLnNvY2sgLS1ob3N0PXRjcDovLzEyNy4wLjAuMToyMzc1IC0tc3RvcmFnZS1kcml2ZXI9b3ZlcmxheTIgJiAnICtcbiAgICAgICAgJ3RpbWVvdXQgMTUgc2ggLWMgXCJ1bnRpbCBkb2NrZXIgaW5mbzsgZG8gZWNobyAuOyBzbGVlcCAxOyBkb25lXCInO1xuICAgIH1cblxuICAgIHJldHVybiBbXG4gICAgICAnc2gnLCAnLWMnLFxuICAgICAgYCR7ZGluZENvbW1hbmR9XG4gICAgICAgIGNkIC9ob21lL3J1bm5lciAmJlxuICAgICAgICAuL2pvYi1yZXBvcnRlci5zaCBcIiRSVU5ORVJfTkFNRVwiICYmXG4gICAgICAgIGlmIFsgLW4gXCIkUlVOTkVSX0pJVF9DT05GSUdcIiBdOyB0aGVuXG4gICAgICAgICAgLi9ydW4uc2ggLS1qaXRjb25maWcgXCIkUlVOTkVSX0pJVF9DT05GSUdcIjtcbiAgICAgICAgZWxzZVxuICAgICAgICAgICMgREVQUkVDQVRFRDogcmVtb3ZlIGluIDEuMC4wIHdpdGggdGhpcyB3aG9sZSBlbHNlIGJyYW5jaC4gZXhlY3V0aW9ucyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIEpJVCBydW5uZXJzIHBhc3MgYSByZWdpc3RyYXRpb24gdG9rZW4gaW5zdGVhZC5cbiAgICAgICAgICBpZiBbIFwiJFJVTk5FUl9WRVJTSU9OXCIgPSBcImxhdGVzdFwiIF07IHRoZW4gUlVOTkVSX0ZMQUdTPVwiXCI7IGVsc2UgUlVOTkVSX0ZMQUdTPVwiLS1kaXNhYmxldXBkYXRlXCI7IGZpICYmXG4gICAgICAgICAgLi9jb25maWcuc2ggLS11bmF0dGVuZGVkIC0tdXJsIFwiJFJFR0lTVFJBVElPTl9VUkxcIiAtLXRva2VuIFwiJFJVTk5FUl9UT0tFTlwiIC0tZXBoZW1lcmFsIC0td29yayBfd29yayAtLWxhYmVscyBcIiRSVU5ORVJfTEFCRUwsY2RrZ2hyOnN0YXJ0ZWQ6XFxgZGF0ZSArJXNcXGBcIiAkUlVOTkVSX0ZMQUdTIC0tbmFtZSBcIiRSVU5ORVJfTkFNRVwiICRSVU5ORVJfR1JPVVAxICRSVU5ORVJfR1JPVVAyICRERUZBVUxUX0xBQkVMUyAmJlxuICAgICAgICAgIC4vcnVuLnNoO1xuICAgICAgICBmaSAmJlxuICAgICAgICBTVEFUVVM9JChncmVwIC1QaG9ycyBcImZpbmlzaCBqb2IgcmVxdWVzdCBmb3Igam9iIFswLTlhLWYtXSsgd2l0aCByZXN1bHQ6IC4qXCIgX2RpYWcgfCB0YWlsIC1uMSB8IGF3ayAne3ByaW50ICRORn0nKSAmJlxuICAgICAgICBpZiBbIC1uIFwiJFNUQVRVU1wiIF07IHRoZW4gZWNobyBDREtHSEEgSk9CIERPTkUgXCIkUlVOTkVSX0xBQkVMXCIgXCIkU1RBVFVTXCI7IGZpYCxcbiAgICBdO1xuICB9IGVsc2UgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgLy8gREVQUkVDQVRFRDogcmVtb3ZlIGluIDEuMC4wIHdpdGggdGhlIGVsc2UgYnJhbmNoIGJlbG93LiBleGVjdXRpb25zIHRoYXQgc3RhcnRlZCBiZWZvcmUgSklUIHJ1bm5lcnMgcGFzcyBhIHJlZ2lzdHJhdGlvbiB0b2tlbiBpbnN0ZWFkLlxuICAgIHJldHVybiBbXG4gICAgICAncG93ZXJzaGVsbCcsICctQ29tbWFuZCcsXG4gICAgICBgY2QgXFxcXGFjdGlvbnMgO1xuICAgICAgICAmIC4vam9iLXJlcG9ydGVyLnBzMSBcIiRFbnY6UlVOTkVSX05BTUVcIiA7XG4gICAgICAgIGlmICgkRW52OlJVTk5FUl9KSVRfQ09ORklHKSB7XG4gICAgICAgICAgLi9ydW4uY21kIC0taml0Y29uZmlnIFwiJEVudjpSVU5ORVJfSklUX0NPTkZJR1wiXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKCRFbnY6UlVOTkVSX1ZFUlNJT04gLWVxIFwibGF0ZXN0XCIpIHsgJFJ1bm5lckZsYWdzID0gXCJcIiB9IGVsc2UgeyAkUnVubmVyRmxhZ3MgPSBcIi0tZGlzYWJsZXVwZGF0ZVwiIH1cbiAgICAgICAgICAuL2NvbmZpZy5jbWQgLS11bmF0dGVuZGVkIC0tdXJsIFwiJEVudjpSRUdJU1RSQVRJT05fVVJMXCIgLS10b2tlbiBcIiRFbnY6UlVOTkVSX1RPS0VOXCIgLS1lcGhlbWVyYWwgLS13b3JrIF93b3JrIC0tbGFiZWxzIFwiJEVudjpSVU5ORVJfTEFCRUwsY2RrZ2hyOnN0YXJ0ZWQ6XFwkKEdldC1EYXRlIC1VRm9ybWF0ICslcylcIiAkUnVubmVyRmxhZ3MgLS1uYW1lIFwiJEVudjpSVU5ORVJfTkFNRVwiICRFbnY6UlVOTkVSX0dST1VQMSAkRW52OlJVTk5FUl9HUk9VUDIgJEVudjpERUZBVUxUX0xBQkVMU1xuICAgICAgICAgIC4vcnVuLmNtZFxuICAgICAgICB9IDtcbiAgICAgICAgJFNUQVRVUyA9IFNlbGVjdC1TdHJpbmcgLVBhdGggJy4vX2RpYWcvKi5sb2cnIC1QYXR0ZXJuICdmaW5pc2ggam9iIHJlcXVlc3QgZm9yIGpvYiBbMC05YS1mXFxcXC1dKyB3aXRoIHJlc3VsdDogKC4qKScgfCAleyRfLk1hdGNoZXMuR3JvdXBzWzFdLlZhbHVlfSB8IFNlbGVjdC1PYmplY3QgLUxhc3QgMSA7XG4gICAgICAgIGlmICgkU1RBVFVTKSB7IGVjaG8gXCJDREtHSEEgSk9CIERPTkUgJEVudjpSVU5ORVJfTEFCRUwgJFNUQVRVU1wiIH1gLFxuICAgIF07XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBGYXJnYXRlIHJ1bm5lciBkb2Vzbid0IHN1cHBvcnQgJHtvcy5uYW1lfWApO1xuICB9XG59XG5cbi8qKlxuICogR3JhbnQgdGhlIHN0YXRlIG1hY2hpbmUgcm9sZSB3aGF0ZXZlciBlY3M6cnVuVGFzay5zeW5jIG5lZWRzIHRvIHJ1biBhbmQgdHJhY2sgYSB0YXNrIGRlZmluaXRpb24uIFNhbWVcbiAqIHN0YXRlbWVudHMgc3RlcGZ1bmN0aW9uc190YXNrcy5FY3NSdW5UYXNrIHdvdWxkIGhhdmUgZ2VuZXJhdGVkIGZvciB1cy5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdyYW50RWNzUnVuVGFzayhzY29wZTogQ29uc3RydWN0LCBzdGF0ZU1hY2hpbmVSb2xlOiBpYW0uSUdyYW50YWJsZSwgdGFzazogZWNzLlRhc2tEZWZpbml0aW9uKSB7XG4gIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHNjb3BlKTtcblxuICAvLyBncmFudCBvbiB0aGUgdW52ZXJzaW9uZWQgdGFzayBkZWZpbml0aW9uIGFybiBzbyB3ZSBjYW4gYWx3YXlzIHJ1biB0aGUgbGF0ZXN0IHJldmlzaW9uXG4gIGNvbnN0IGFybkNvbXBvbmVudHMgPSBzdGFjay5zcGxpdEFybih0YXNrLnRhc2tEZWZpbml0aW9uQXJuLCBjZGsuQXJuRm9ybWF0LlNMQVNIX1JFU09VUkNFX05BTUUpO1xuICBsZXQgcmVzb3VyY2VOYW1lID0gYXJuQ29tcG9uZW50cy5yZXNvdXJjZU5hbWU7XG4gIGlmIChyZXNvdXJjZU5hbWUpIHtcbiAgICByZXNvdXJjZU5hbWUgPSByZXNvdXJjZU5hbWUuc3BsaXQoJzonKVswXTtcbiAgfVxuICBjb25zdCBmYW1pbHlBcm4gPSBzdGFjay5mb3JtYXRBcm4oe1xuICAgIHBhcnRpdGlvbjogYXJuQ29tcG9uZW50cy5wYXJ0aXRpb24sXG4gICAgc2VydmljZTogYXJuQ29tcG9uZW50cy5zZXJ2aWNlLFxuICAgIGFjY291bnQ6IGFybkNvbXBvbmVudHMuYWNjb3VudCxcbiAgICByZWdpb246IGFybkNvbXBvbmVudHMucmVnaW9uLFxuICAgIHJlc291cmNlOiBhcm5Db21wb25lbnRzLnJlc291cmNlLFxuICAgIGFybkZvcm1hdDogYXJuQ29tcG9uZW50cy5hcm5Gb3JtYXQsXG4gICAgcmVzb3VyY2VOYW1lLFxuICB9KTtcbiAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgYWN0aW9uczogWydlY3M6UnVuVGFzayddLFxuICAgIHJlc291cmNlczogW2Ake2ZhbWlseUFybn06KmBdLFxuICB9KSk7XG5cbiAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgYWN0aW9uczogWydlY3M6U3RvcFRhc2snLCAnZWNzOkRlc2NyaWJlVGFza3MnXSxcbiAgICByZXNvdXJjZXM6IFsnKiddLFxuICB9KSk7XG5cbiAgLy8gdGFnZ2luZyB0aGUgdGFzayBvbiBjcmVhdGlvbiBuZWVkcyBpdHMgb3duIHBlcm1pc3Npb25cbiAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgYWN0aW9uczogWydlY3M6VGFnUmVzb3VyY2UnXSxcbiAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAnZWNzOkNyZWF0ZUFjdGlvbic6ICdSdW5UYXNrJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSkpO1xuXG4gIGNvbnN0IHBhc3NlZFJvbGVzID0gW3Rhc2sudGFza1JvbGUucm9sZUFybl07XG4gIGlmICh0YXNrLmV4ZWN1dGlvblJvbGUpIHtcbiAgICBwYXNzZWRSb2xlcy5wdXNoKHRhc2suZXhlY3V0aW9uUm9sZS5yb2xlQXJuKTtcbiAgfVxuICBzdGF0ZU1hY2hpbmVSb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICBhY3Rpb25zOiBbJ2lhbTpQYXNzUm9sZSddLFxuICAgIHJlc291cmNlczogcGFzc2VkUm9sZXMsXG4gIH0pKTtcblxuICAvLyBtYW5hZ2VkIHJ1bGUgZm9yIHRoZSBydW5UYXNrLnN5bmMgaW50ZWdyYXRpb25cbiAgLy8gZXZlcnkgRUNTIGFuZCBGYXJnYXRlIHByb3ZpZGVyIGVtaXRzIHRoZSBzYW1lIHN0YXRlbWVudCBzbyBwb2xpY3kgbWluaW1pemF0aW9uIGtlZXBzIGp1c3Qgb25lXG4gIHN0YXRlTWFjaGluZVJvbGUuZ3JhbnRQcmluY2lwYWwuYWRkVG9QcmluY2lwYWxQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgIGFjdGlvbnM6IFsnZXZlbnRzOlB1dFRhcmdldHMnLCAnZXZlbnRzOlB1dFJ1bGUnLCAnZXZlbnRzOkRlc2NyaWJlUnVsZSddLFxuICAgIHJlc291cmNlczogW3N0YWNrLmZvcm1hdEFybih7XG4gICAgICBzZXJ2aWNlOiAnZXZlbnRzJyxcbiAgICAgIHJlc291cmNlOiAncnVsZScsXG4gICAgICByZXNvdXJjZU5hbWU6ICdTdGVwRnVuY3Rpb25zR2V0RXZlbnRzRm9yRUNTVGFza1J1bGUnLFxuICAgIH0pXSxcbiAgfSkpO1xufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gY2xlYW5FY3NUYWcoc2NvcGU6IENvbnN0cnVjdCwgZGVzY3JpcHRpb246IHN0cmluZywgdmFsdWU6IHN0cmluZykge1xuICBjb25zdCBjbGVhbmVkID0gdmFsdWUucmVwbGFjZSgvW15cXHB7TH1cXHB7Wn1cXHB7Tn1fLjovPStcXC1AXS9ndSwgJ18nKS5zbGljZSgwLCAyNTYpO1xuICBpZiAoY2xlYW5lZCAhPT0gdmFsdWUpIHtcbiAgICBjZGsuQW5ub3RhdGlvbnMub2Yoc2NvcGUpLmFkZFdhcm5pbmcoXG4gICAgICBgRUNTIHRhZ3MgY2FuIG9ubHkgY29udGFpbiB1cCB0byAyNTYgbGV0dGVycywgbnVtYmVycywgc3BhY2VzLCBhbmQgXyAuIDogLyA9ICsgLSBALCBzbyB0aGUgJHtkZXNjcmlwdGlvbn0gd2lsbCBiZSB0YWdnZWQgYXMgYCArXG4gICAgICBgJHtKU09OLnN0cmluZ2lmeShjbGVhbmVkLnNsaWNlKDAsIDEwMCkpfWAsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gY2xlYW5lZDtcbn1cblxuLyoqXG4gKiBUYWdzIGZvciBhIHJ1bm5lciB0YXNrLCBvbiB0b3Agb2YgdGhlIHN0YW5kYXJkIHJ1bm5lciB0YWdzIHRoZSBvcmNoZXN0cmF0b3IgbWVyZ2VzIGluIGF0IHJ1bnRpbWUuXG4gKlxuICogRUNTIGlzIGEgbG90IHBpY2tpZXIgYWJvdXQgdGFncyB0aGFuIEVDMi4gSXQgZG9lc24ndCBhbGxvdyBjb21tYXMgd2hpY2ggd2UgdXNlIGluIGxhYmVscywgbm8gcGFyZW50aGVzaXMsIG5vIGJyYWNrZXRzLCBhbmQgb3RoZXJzLiBGb3IgZGF0YSB0aGF0XG4gKiB1c2VkIHRvIGFsbG93IHRob3NlIGNoYXJhY3RlcnMsIHdlIGNsZWFuIHVwIHRoZSB0YWcgYW5kIHdhcm4gdGhlIHVzZXIuIEZvciB0YWdzIG1hbnVhbGx5IHNldCBvbiB0aGUgcHJvdmlkZXIgKG5ldyBmZWF0dXJlKSwgd2UgaW5zdGVhZCBlcnJvciBvdXQuXG4gKlxuICogYE5hbWVgLCBgR2l0SHViUnVubmVyczpSZXBvYCBhbmQgYEdpdEh1YlJ1bm5lcnM6TGFiZWxzYCBhcmUgbGVmdCB0byB0aGUgb3JjaGVzdHJhdG9yLiBUaGUgZmlyc3QgdHdvIGFyZSBidWlsdCBvdXQgb2YgdGhlIHJlcG9zaXRvcnkgbmFtZSBhbmQgdGhlXG4gKiB3ZWJob29rIGRlbGl2ZXJ5IGlkLCBhbmQgR2l0SHViIGRvZXNuJ3QgYWxsb3cgYW55dGhpbmcgRUNTIHdvdWxkIHJlamVjdC4gTGFiZWxzIGFyZSBvbmx5IGtub3duIHdoZW4gYSBqb2IgY29tZXMgaW4sIHNvIHRoZSBvcmNoZXN0cmF0b3IgY2xlYW5zXG4gKiB0aGVtIHVwIGluc3RlYWQgKHNlZSBgY2xlYW5MYWJlbHNgIGluIHNlbGVjdFByb3ZpZGVyUGFyYW1zKS4gVW5saWtlIEVDMiB0YWdzLCB0aGV5IGVuZCB1cCBzZXBhcmF0ZWQgd2l0aCBzcGFjZXMuIFdoaWNoIGhvbmVzdGx5IGlzIHF1aXRlIGFubm95aW5nLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gZWNzVGFncyhzY29wZTogQ29uc3RydWN0LCB0YWdzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9KTogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfSB7XG4gIC8vIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BbWF6b25FQ1MvbGF0ZXN0L0FQSVJlZmVyZW5jZS9BUElfVGFnLmh0bWxcbiAgY29uc3QgYWxsb3dlZCA9IC9eW1xccHtMfVxccHtafVxccHtOfV8uOi89K1xcLUBdKiQvdTtcblxuICBjb25zdCBjaGVjayA9IChkZXNjcmlwdGlvbjogc3RyaW5nLCB2YWx1ZTogc3RyaW5nLCBtYXhMZW5ndGg6IG51bWJlcikgPT4ge1xuICAgIGlmICghYWxsb3dlZC50ZXN0KHZhbHVlKSkge1xuICAgICAgY2RrLkFubm90YXRpb25zLm9mKHNjb3BlKS5hZGRFcnJvcihcbiAgICAgICAgYEJhZCBjaGFyYWN0ZXIgaW4gJHtkZXNjcmlwdGlvbn0uIEVDUyB0YWdzIGNhbiBvbmx5IGNvbnRhaW4gbGV0dGVycywgbnVtYmVycywgc3BhY2VzLCBhbmQgXyAuIDogLyA9ICsgLSBAOiAke0pTT04uc3RyaW5naWZ5KHZhbHVlLnNsaWNlKDAsIDEwMCkpfWAsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAodmFsdWUubGVuZ3RoID4gbWF4TGVuZ3RoKSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2Yoc2NvcGUpLmFkZEVycm9yKFxuICAgICAgICBgVG9vIG1hbnkgY2hhcmFjdGVycyBpbiAke2Rlc2NyaXB0aW9ufS4gRUNTIHRhZ3MgYXJlIGxpbWl0ZWQgdG8gJHttYXhMZW5ndGh9IGNoYXJhY3RlcnM6ICR7SlNPTi5zdHJpbmdpZnkodmFsdWUuc2xpY2UoMCwgMTAwKSl9YCxcbiAgICAgICk7XG4gICAgfVxuICB9O1xuXG4gIGlmIChPYmplY3Qua2V5cyh0YWdzKS5sZW5ndGggPiA0NSkge1xuICAgIGNkay5Bbm5vdGF0aW9ucy5vZihzY29wZSkuYWRkRXJyb3IoJ1RvbyBtYW55IHRhZ3MuIEVDUyB0YWdzIGFyZSBsaW1pdGVkIHRvIDUwIHRhZ3MsIGFuZCA1IGFyZSBhbHJlYWR5IHVzZWQgYnkgdGhlIG9yY2hlc3RyYXRvci4nICk7XG4gIH1cblxuICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyh0YWdzKSkge1xuICAgIGlmICgha2V5KSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2Yoc2NvcGUpLmFkZEVycm9yKCdUYWcgbmFtZXMgY2Fubm90IGJlIGVtcHR5Jyk7XG4gICAgfVxuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKS5zdGFydHNXaXRoKCdhd3M6JykpIHtcbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZihzY29wZSkuYWRkRXJyb3IoYFRhZyBuYW1lcyBjYW5ub3Qgc3RhcnQgd2l0aCBcImF3czpcIjogJHtKU09OLnN0cmluZ2lmeShrZXkpfWApO1xuICAgIH1cbiAgICBpZiAoa2V5LnN0YXJ0c1dpdGgoUmVzZXJ2ZWRUYWdzLlBSRUZJWCkpIHtcbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZihzY29wZSkuYWRkRXJyb3IoYFRhZyBuYW1lcyBjYW5ub3Qgc3RhcnQgd2l0aCBcIiR7UmVzZXJ2ZWRUYWdzLlBSRUZJWH1cIjogJHtKU09OLnN0cmluZ2lmeShrZXkpfWApO1xuICAgIH1cbiAgICBjaGVjaygndGFnIG5hbWUnLCBrZXksIDEyOCk7XG4gICAgY2hlY2soJ3RhZyB2YWx1ZScsIHZhbHVlLCAyNTYpO1xuICB9XG5cbiAgLy8gdGhlIHVzZXIncyB0YWdzIGNvbWUgbGFzdCBzbyB0aGV5IGNhbiBvdmVycmlkZSBvdXJzLCBqdXN0IGxpa2UgdGhleSBvdmVycmlkZSB0aGUgb3JjaGVzdHJhdG9yJ3Mgc3RhbmRhcmQgdGFnc1xuICByZXR1cm4ge1xuICAgICdHaXRIdWJSdW5uZXJzOlByb3ZpZGVyJzogY2xlYW5FY3NUYWcoc2NvcGUsICdwcm92aWRlciBjb25zdHJ1Y3QgcGF0aCcsIHNjb3BlLm5vZGUucGF0aCksXG4gICAgLi4udGFncyxcbiAgfTtcbn1cblxuLyoqXG4gKiBSdW5uZXIgY29uZmlnIGZvciB0aGUgRmFyZ2F0ZSBmYW1pbHkgZnJhZ21lbnQuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmludGVyZmFjZSBGYXJnYXRlUnVubmVyQ29uZmlnIGV4dGVuZHMgUnVubmVyQ29uZmlnIHtcbiAgcmVhZG9ubHkgY2x1c3RlckFybjogc3RyaW5nO1xuICByZWFkb25seSB0YXNrRGVmaW5pdGlvbkZhbWlseTogc3RyaW5nO1xuICByZWFkb25seSBjb250YWluZXJOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGNhcGFjaXR5UHJvdmlkZXI6IHN0cmluZztcbiAgcmVhZG9ubHkgZW5hYmxlRXhlY3V0ZUNvbW1hbmQ6IGJvb2xlYW47XG4gIHJlYWRvbmx5IHN1Ym5ldHM6IHN0cmluZ1tdO1xuICByZWFkb25seSBzZWN1cml0eUdyb3Vwczogc3RyaW5nW107XG4gIHJlYWRvbmx5IGFzc2lnblB1YmxpY0lwOiBzdHJpbmc7XG59XG5cbi8qKlxuICogR2l0SHViIEFjdGlvbnMgcnVubmVyIHByb3ZpZGVyIHVzaW5nIEZhcmdhdGUgdG8gZXhlY3V0ZSBqb2JzLlxuICpcbiAqIENyZWF0ZXMgYSB0YXNrIGRlZmluaXRpb24gd2l0aCBhIHNpbmdsZSBjb250YWluZXIgdGhhdCBnZXRzIHN0YXJ0ZWQgZm9yIGVhY2ggam9iLlxuICpcbiAqIFRoaXMgY29uc3RydWN0IGlzIG5vdCBtZWFudCB0byBiZSB1c2VkIGJ5IGl0c2VsZi4gSXQgc2hvdWxkIGJlIHBhc3NlZCBpbiB0aGUgcHJvdmlkZXJzIHByb3BlcnR5IGZvciBHaXRIdWJSdW5uZXJzLlxuICovXG5leHBvcnQgY2xhc3MgRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqIEBpbnRlcm5hbCAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IF9GQU1JTFkgPSAnZmFyZ2F0ZSc7XG5cbiAgLyoqXG4gICAqIFBhdGggdG8gRG9ja2VyZmlsZSBmb3IgTGludXggeDY0IHdpdGggYWxsIHRoZSByZXF1aXJlbWVudCBmb3IgRmFyZ2F0ZSBydW5uZXIuIFVzZSB0aGlzIERvY2tlcmZpbGUgdW5sZXNzIHlvdSBuZWVkIHRvIGN1c3RvbWl6ZSBpdCBmdXJ0aGVyIHRoYW4gYWxsb3dlZCBieSBob29rcy5cbiAgICpcbiAgICogQXZhaWxhYmxlIGJ1aWxkIGFyZ3VtZW50cyB0aGF0IGNhbiBiZSBzZXQgaW4gdGhlIGltYWdlIGJ1aWxkZXI6XG4gICAqICogYEJBU0VfSU1BR0VgIHNldHMgdGhlIGBGUk9NYCBsaW5lLiBUaGlzIHNob3VsZCBiZSBhbiBVYnVudHUgY29tcGF0aWJsZSBpbWFnZS5cbiAgICogKiBgRVhUUkFfUEFDS0FHRVNgIGNhbiBiZSB1c2VkIHRvIGluc3RhbGwgYWRkaXRpb25hbCBwYWNrYWdlcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBpbWFnZUJ1aWxkZXIoKWAgaW5zdGVhZC5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgTElOVVhfWDY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdmYXJnYXRlJywgJ2xpbnV4LXg2NCcpO1xuXG4gIC8qKlxuICAgKiBQYXRoIHRvIERvY2tlcmZpbGUgZm9yIExpbnV4IEFSTTY0IHdpdGggYWxsIHRoZSByZXF1aXJlbWVudCBmb3IgRmFyZ2F0ZSBydW5uZXIuIFVzZSB0aGlzIERvY2tlcmZpbGUgdW5sZXNzIHlvdSBuZWVkIHRvIGN1c3RvbWl6ZSBpdCBmdXJ0aGVyIHRoYW4gYWxsb3dlZCBieSBob29rcy5cbiAgICpcbiAgICogQXZhaWxhYmxlIGJ1aWxkIGFyZ3VtZW50cyB0aGF0IGNhbiBiZSBzZXQgaW4gdGhlIGltYWdlIGJ1aWxkZXI6XG4gICAqICogYEJBU0VfSU1BR0VgIHNldHMgdGhlIGBGUk9NYCBsaW5lLiBUaGlzIHNob3VsZCBiZSBhbiBVYnVudHUgY29tcGF0aWJsZSBpbWFnZS5cbiAgICogKiBgRVhUUkFfUEFDS0FHRVNgIGNhbiBiZSB1c2VkIHRvIGluc3RhbGwgYWRkaXRpb25hbCBwYWNrYWdlcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBpbWFnZUJ1aWxkZXIoKWAgaW5zdGVhZC5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgTElOVVhfQVJNNjRfRE9DS0VSRklMRV9QQVRIID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Fzc2V0cycsICdkb2NrZXItaW1hZ2VzJywgJ2ZhcmdhdGUnLCAnbGludXgtYXJtNjQnKTtcblxuICAvKipcbiAgICogVGhlIGZyYWdtZW50IHRoYXQgcnVucyBhbnkgRmFyZ2F0ZSBwcm92aWRlci4gUmVhZHMgdGhlIGNvbmZpZyB7QGxpbmsgX3J1bm5lckNvbmZpZ30gZ2VuZXJhdGVkIGZvciBpdCBmcm9tXG4gICAqIGAkLnByb3ZpZGVyUGFyYW1zYC4gUmVuZGVycyB3aGF0IEVjc1J1blRhc2sgdXNlZCB0byByZW5kZXIgcGVyIHByb3ZpZGVyLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgX3N0YXRlTWFjaGluZUZyYWdtZW50KHNjb3BlOiBDb25zdHJ1Y3QpOiBzdGVwZnVuY3Rpb25zLklDaGFpbmFibGUge1xuICAgIGNvbnN0IHAgPSBwcm92aWRlclBhcmFtPEZhcmdhdGVSdW5uZXJDb25maWc+O1xuICAgIHJldHVybiBuZXcgc3RlcGZ1bmN0aW9ucy5DdXN0b21TdGF0ZShzY29wZSwgJ0ZhcmdhdGUgUnVubmVyJywge1xuICAgICAgc3RhdGVKc29uOiB7XG4gICAgICAgIFR5cGU6ICdUYXNrJyxcbiAgICAgICAgUmVzb3VyY2U6IGBhcm46JHtjZGsuQXdzLlBBUlRJVElPTn06c3RhdGVzOjo6ZWNzOnJ1blRhc2suc3luY2AsXG4gICAgICAgIFBhcmFtZXRlcnM6IHtcbiAgICAgICAgICAnQ2x1c3Rlci4kJzogcCgnY2x1c3RlckFybicpLFxuICAgICAgICAgICdUYXNrRGVmaW5pdGlvbi4kJzogcCgndGFza0RlZmluaXRpb25GYW1pbHknKSxcbiAgICAgICAgICAnTmV0d29ya0NvbmZpZ3VyYXRpb24nOiB7XG4gICAgICAgICAgICBBd3N2cGNDb25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICAgICdBc3NpZ25QdWJsaWNJcC4kJzogcCgnYXNzaWduUHVibGljSXAnKSxcbiAgICAgICAgICAgICAgJ1N1Ym5ldHMuJCc6IHAoJ3N1Ym5ldHMnKSxcbiAgICAgICAgICAgICAgJ1NlY3VyaXR5R3JvdXBzLiQnOiBwKCdzZWN1cml0eUdyb3VwcycpLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgICdPdmVycmlkZXMnOiB7XG4gICAgICAgICAgICBDb250YWluZXJPdmVycmlkZXM6IFt7XG4gICAgICAgICAgICAgICdOYW1lLiQnOiBwKCdjb250YWluZXJOYW1lJyksXG4gICAgICAgICAgICAgICdFbnZpcm9ubWVudCc6IHJ1bm5lckVudmlyb25tZW50KChuYW1lLCB2YWx1ZSkgPT4gKHsgJ05hbWUnOiBuYW1lLCAnVmFsdWUuJCc6IHZhbHVlIH0pKSxcbiAgICAgICAgICAgIH1dLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgJ1Byb3BhZ2F0ZVRhZ3MnOiAnVEFTS19ERUZJTklUSU9OJyxcbiAgICAgICAgICAnVGFncy4kJzogcCgndGFncycpLCAvLyB0aGUgcHJvdmlkZXIncyB0YWdzLCBhbHJlYWR5IG1lcmdlZCB3aXRoIHRoZSBzdGFuZGFyZCBydW5uZXIgdGFncyBieSB0aGUgb3JjaGVzdHJhdG9yXG4gICAgICAgICAgJ0NhcGFjaXR5UHJvdmlkZXJTdHJhdGVneSc6IFt7XG4gICAgICAgICAgICAnQ2FwYWNpdHlQcm92aWRlci4kJzogcCgnY2FwYWNpdHlQcm92aWRlcicpLFxuICAgICAgICAgIH1dLFxuICAgICAgICAgICdQbGF0Zm9ybVZlcnNpb24nOiAnTEFURVNUJyxcbiAgICAgICAgICAnRW5hYmxlRXhlY3V0ZUNvbW1hbmQuJCc6IHAoJ2VuYWJsZUV4ZWN1dGVDb21tYW5kJyksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBuZXcgaW1hZ2UgYnVpbGRlciB0aGF0IGJ1aWxkcyBGYXJnYXRlIHNwZWNpZmljIHJ1bm5lciBpbWFnZXMuXG4gICAqXG4gICAqIFlvdSBjYW4gY3VzdG9taXplIHRoZSBPUywgYXJjaGl0ZWN0dXJlLCBWUEMsIHN1Ym5ldCwgc2VjdXJpdHkgZ3JvdXBzLCBldGMuIGJ5IHBhc3NpbmcgaW4gcHJvcHMuXG4gICAqXG4gICAqIFlvdSBjYW4gYWRkIGNvbXBvbmVudHMgdG8gdGhlIGltYWdlIGJ1aWxkZXIgYnkgY2FsbGluZyBgaW1hZ2VCdWlsZGVyLmFkZENvbXBvbmVudCgpYC5cbiAgICpcbiAgICogVGhlIGRlZmF1bHQgT1MgaXMgVWJ1bnR1IHJ1bm5pbmcgb24geDY0IGFyY2hpdGVjdHVyZS5cbiAgICpcbiAgICogSW5jbHVkZWQgY29tcG9uZW50czpcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJlcXVpcmVkUGFja2FnZXMoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcigpYFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcykge1xuICAgIHJldHVybiBSdW5uZXJJbWFnZUJ1aWxkZXIubmV3KHNjb3BlLCBpZCwge1xuICAgICAgb3M6IE9zLkxJTlVYX1VCVU5UVSxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGNvbXBvbmVudHM6IFtcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcihwcm9wcz8ucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpKSxcbiAgICAgIF0sXG4gICAgICAuLi5wcm9wcyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDbHVzdGVyIGhvc3RpbmcgdGhlIHRhc2sgaG9zdGluZyB0aGUgcnVubmVyLlxuICAgKi9cbiAgcmVhZG9ubHkgY2x1c3RlcjogZWNzLkNsdXN0ZXI7XG5cbiAgLyoqXG4gICAqIEZhcmdhdGUgdGFzayBob3N0aW5nIHRoZSBydW5uZXIuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSB0YXNrOiBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uO1xuXG4gIC8qKlxuICAgKiBDb250YWluZXIgZGVmaW5pdGlvbiBob3N0aW5nIHRoZSBydW5uZXIuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSBjb250YWluZXI6IGVjcy5Db250YWluZXJEZWZpbml0aW9uO1xuXG4gIC8qKlxuICAgKiBMYWJlbHMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcHJvdmlkZXIuXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBWUEMgdXNlZCBmb3IgaG9zdGluZyB0aGUgcnVubmVyIHRhc2suXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU3VibmV0cyB1c2VkIGZvciBob3N0aW5nIHRoZSBydW5uZXIgdGFzay5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgcnVubmVyIHRhc2sgd2lsbCBoYXZlIGEgcHVibGljIElQLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBUaGlzIGZpZWxkIGlzIGludGVybmFsIGFuZCBzaG91bGQgbm90IGJlIGFjY2Vzc2VkIGRpcmVjdGx5LlxuICAgKi9cbiAgcmVhZG9ubHkgYXNzaWduUHVibGljSXA6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIEdyYW50IHByaW5jaXBhbCB1c2VkIHRvIGFkZCBwZXJtaXNzaW9ucyB0byB0aGUgcnVubmVyIHJvbGUuXG4gICAqL1xuICByZWFkb25seSBncmFudFByaW5jaXBhbDogaWFtLklQcmluY2lwYWw7XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcmVhZG9ubHkgY29ubmVjdGlvbnM6IGVjMi5Db25uZWN0aW9ucztcblxuICAvKipcbiAgICogVXNlIHNwb3QgcHJpY2luZyBmb3IgRmFyZ2F0ZSB0YXNrcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IHNwb3Q6IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERvY2tlciBpbWFnZSBsb2FkZWQgd2l0aCBHaXRIdWIgQWN0aW9ucyBSdW5uZXIgYW5kIGl0cyBwcmVyZXF1aXNpdGVzLiBUaGUgaW1hZ2UgaXMgYnVpbHQgYnkgYW4gaW1hZ2UgYnVpbGRlciBhbmQgaXMgc3BlY2lmaWMgdG8gRmFyZ2F0ZSB0YXNrcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IGltYWdlOiBSdW5uZXJJbWFnZTtcblxuICAvKipcbiAgICogTG9nIGdyb3VwIHdoZXJlIHByb3ZpZGVkIHJ1bm5lcnMgd2lsbCBzYXZlIHRoZWlyIGxvZ3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGlzIG5vdCB0aGUgam9iIGxvZywgYnV0IHRoZSBydW5uZXIgaXRzZWxmLiBJdCB3aWxsIG5vdCBjb250YWluIG91dHB1dCBmcm9tIHRoZSBHaXRIdWIgQWN0aW9uIGJ1dCBvbmx5IG1ldGFkYXRhIG9uIGl0cyBleGVjdXRpb24uXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cDogbG9ncy5JTG9nR3JvdXA7XG5cblxuICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM6IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IHRhZ3M6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBGYXJnYXRlUnVubmVyUHJvdmlkZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgdGhpcy5sYWJlbHMgPSB0aGlzLmxhYmVsc0Zyb21Qcm9wZXJ0aWVzKCdmYXJnYXRlJywgcHJvcHM/LmxhYmVsLCBwcm9wcz8ubGFiZWxzKTtcbiAgICB0aGlzLmdyb3VwID0gcHJvcHM/Lmdyb3VwO1xuICAgIHRoaXMuZGVmYXVsdExhYmVscyA9IHByb3BzPy5kZWZhdWx0TGFiZWxzID8/IHRydWU7XG4gICAgdGhpcy52cGMgPSBwcm9wcz8udnBjID8/IGVjMi5WcGMuZnJvbUxvb2t1cCh0aGlzLCAnZGVmYXVsdCB2cGMnLCB7IGlzRGVmYXVsdDogdHJ1ZSB9KTtcbiAgICB0aGlzLnN1Ym5ldFNlbGVjdGlvbiA9IHByb3BzPy5zdWJuZXRTZWxlY3Rpb247XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwID8gW3Byb3BzLnNlY3VyaXR5R3JvdXBdIDogKHByb3BzPy5zZWN1cml0eUdyb3VwcyA/PyBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdzZWN1cml0eSBncm91cCcsIHsgdnBjOiB0aGlzLnZwYyB9KV0pO1xuICAgIHRoaXMuY29ubmVjdGlvbnMgPSBuZXcgZWMyLkNvbm5lY3Rpb25zKHsgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMgfSk7XG4gICAgdGhpcy5hc3NpZ25QdWJsaWNJcCA9IHByb3BzPy5hc3NpZ25QdWJsaWNJcCA/PyB0cnVlO1xuICAgIHRoaXMuY2x1c3RlciA9IHByb3BzPy5jbHVzdGVyID8gcHJvcHMuY2x1c3RlciA6IG5ldyBlY3MuQ2x1c3RlcihcbiAgICAgIHRoaXMsXG4gICAgICAnY2x1c3RlcicsXG4gICAgICB7XG4gICAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICAgIGVuYWJsZUZhcmdhdGVDYXBhY2l0eVByb3ZpZGVyczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICB0aGlzLnNwb3QgPSBwcm9wcz8uc3BvdCA/PyBmYWxzZTtcbiAgICB0aGlzLnRhZ3MgPSBlY3NUYWdzKHRoaXMsIHByb3BzPy50YWdzID8/IHt9KTtcblxuICAgIC8vIGFsbCBwcm92aWRlcnMgYWRkIHRoaXMgdGFnLCBidXQgRUNTL0ZhcmdhdGUgdGFncyBuZWVkIHRvIGJlIGNsZWFuZWRcbiAgICBjZGsuVGFncy5vZih0aGlzKS5hZGQoJ0dpdEh1YlJ1bm5lcnM6UHJvdmlkZXInLCBjbGVhbkVjc1RhZyh0aGlzLCAncHJvdmlkZXIgdGFnJywgdGhpcy5ub2RlLnBhdGgpKTtcblxuICAgIGNvbnN0IGltYWdlQnVpbGRlciA9IHByb3BzPy5pbWFnZUJ1aWxkZXIgPz8gRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcih0aGlzLCAnSW1hZ2UgQnVpbGRlcicpO1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZSA9IGltYWdlQnVpbGRlci5iaW5kRG9ja2VySW1hZ2UoKTtcblxuICAgIGxldCBhcmNoOiBlY3MuQ3B1QXJjaGl0ZWN0dXJlO1xuICAgIGlmIChpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgYXJjaCA9IGVjcy5DcHVBcmNoaXRlY3R1cmUuQVJNNjQ7XG4gICAgfSBlbHNlIGlmIChpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgIGFyY2ggPSBlY3MuQ3B1QXJjaGl0ZWN0dXJlLlg4Nl82NDtcbiAgICB9IGVsc2Uge1xuICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKGAke2ltYWdlLmFyY2hpdGVjdHVyZS5uYW1lfSBpcyBub3Qgc3VwcG9ydGVkIG9uIEZhcmdhdGVgKTtcbiAgICAgIGFyY2ggPSBlY3MuQ3B1QXJjaGl0ZWN0dXJlLlg4Nl82NDsgLy8gc28gdGhlIGNvZGUgYmVsb3cgZG9lc24ndCB0aHJvdyBhbiBleGNlcHRpb25cbiAgICB9XG5cbiAgICBsZXQgZmFyZ2F0ZVJ1bm5lckNvbW1hbmRPcyA9IGltYWdlLm9zO1xuICAgIGxldCBvczogZWNzLk9wZXJhdGluZ1N5c3RlbUZhbWlseTtcbiAgICBpZiAoaW1hZ2Uub3MuaXNJbihPcy5fQUxMX0xJTlVYX1ZFUlNJT05TKSkge1xuICAgICAgb3MgPSBlY3MuT3BlcmF0aW5nU3lzdGVtRmFtaWx5LkxJTlVYO1xuICAgIH0gZWxzZSBpZiAoaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIG9zID0gZWNzLk9wZXJhdGluZ1N5c3RlbUZhbWlseS5XSU5ET1dTX1NFUlZFUl8yMDE5X0NPUkU7XG4gICAgICBpZiAocHJvcHM/LmVwaGVtZXJhbFN0b3JhZ2VHaUIpIHtcbiAgICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdFcGhlbWVyYWwgc3RvcmFnZSBpcyBub3Qgc3VwcG9ydGVkIG9uIEZhcmdhdGUgV2luZG93cycpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoYCR7aW1hZ2Uub3MubmFtZX0gaXMgbm90IHN1cHBvcnRlZCBvbiBGYXJnYXRlYCk7XG4gICAgICBvcyA9IGVjcy5PcGVyYXRpbmdTeXN0ZW1GYW1pbHkuTElOVVg7XG4gICAgICBmYXJnYXRlUnVubmVyQ29tbWFuZE9zID0gT3MuTElOVVhfVUJVTlRVO1xuICAgIH1cblxuICAgIHRoaXMubG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnbG9ncycsIHtcbiAgICAgIHJldGVudGlvbjogcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIHRoaXMudGFzayA9IG5ldyBlY3MuRmFyZ2F0ZVRhc2tEZWZpbml0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgICd0YXNrJyxcbiAgICAgIHtcbiAgICAgICAgY3B1OiBwcm9wcz8uY3B1ID8/IDEwMjQsXG4gICAgICAgIG1lbW9yeUxpbWl0TWlCOiBwcm9wcz8ubWVtb3J5TGltaXRNaUIgPz8gMjA0OCxcbiAgICAgICAgZXBoZW1lcmFsU3RvcmFnZUdpQjogaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykgPyB1bmRlZmluZWQgOiBwcm9wcz8uZXBoZW1lcmFsU3RvcmFnZUdpQiA/PyAyNSxcbiAgICAgICAgcnVudGltZVBsYXRmb3JtOiB7XG4gICAgICAgICAgb3BlcmF0aW5nU3lzdGVtRmFtaWx5OiBvcyxcbiAgICAgICAgICBjcHVBcmNoaXRlY3R1cmU6IGFyY2gsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICk7XG4gICAgdGhpcy5jb250YWluZXIgPSB0aGlzLnRhc2suYWRkQ29udGFpbmVyKFxuICAgICAgJ3J1bm5lcicsXG4gICAgICB7XG4gICAgICAgIGltYWdlOiBlY3MuQXNzZXRJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShpbWFnZS5pbWFnZVJlcG9zaXRvcnksIGltYWdlLmltYWdlVGFnKSxcbiAgICAgICAgbG9nZ2luZzogZWNzLkF3c0xvZ0RyaXZlci5hd3NMb2dzKHtcbiAgICAgICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cCxcbiAgICAgICAgICBzdHJlYW1QcmVmaXg6ICdydW5uZXInLFxuICAgICAgICB9KSxcbiAgICAgICAgY29tbWFuZDogZWNzUnVuQ29tbWFuZChmYXJnYXRlUnVubmVyQ29tbWFuZE9zLCBmYWxzZSksXG4gICAgICAgIHVzZXI6IGltYWdlLm9zLmlzKE9zLldJTkRPV1MpID8gdW5kZWZpbmVkIDogJ3J1bm5lcicsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICB0aGlzLmdyYW50UHJpbmNpcGFsID0gdGhpcy50YXNrLnRhc2tSb2xlO1xuXG4gICAgLy8gYWxsb3cgU1NNIFNlc3Npb24gTWFuYWdlclxuICAgIHRoaXMudGFzay50YXNrUm9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShNSU5JTUFMX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCk7XG4gIH1cblxuICAvKipcbiAgICogQ29uZmlnIGZvciB0aGUgc2hhcmVkIEZhcmdhdGUgZnJhZ21lbnQuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgX3J1bm5lckNvbmZpZygpOiBGYXJnYXRlUnVubmVyQ29uZmlnIHtcbiAgICAvLyBzYW1lIHN1Ym5ldCBzZWxlY3Rpb24gRWNzUnVuVGFzayBkZWZhdWx0cyB0bzogd2hhdGV2ZXIgd2FzIGFza2VkIGZvciwgb3IgcHVibGljL3ByaXZhdGUgcGVyIGFzc2lnblB1YmxpY0lwXG4gICAgY29uc3Qgc3VibmV0U2VsZWN0aW9uID0gdGhpcy5zdWJuZXRTZWxlY3Rpb24gPz9cbiAgICAgIHsgc3VibmV0VHlwZTogdGhpcy5hc3NpZ25QdWJsaWNJcCA/IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyA6IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfV0lUSF9FR1JFU1MgfTtcblxuICAgIHJldHVybiB7XG4gICAgICBmYW1pbHk6IEZhcmdhdGVSdW5uZXJQcm92aWRlci5fRkFNSUxZLFxuICAgICAgcHJvdmlkZXI6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgY2x1c3RlckFybjogdGhpcy5jbHVzdGVyLmNsdXN0ZXJBcm4sXG4gICAgICB0YXNrRGVmaW5pdGlvbkZhbWlseTogdGhpcy50YXNrLmZhbWlseSxcbiAgICAgIGNvbnRhaW5lck5hbWU6IHRoaXMuY29udGFpbmVyLmNvbnRhaW5lck5hbWUsXG4gICAgICBjYXBhY2l0eVByb3ZpZGVyOiB0aGlzLnNwb3QgPyAnRkFSR0FURV9TUE9UJyA6ICdGQVJHQVRFJyxcbiAgICAgIGVuYWJsZUV4ZWN1dGVDb21tYW5kOiB0aGlzLmltYWdlLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUyksXG4gICAgICBzdWJuZXRzOiB0aGlzLmNsdXN0ZXIudnBjLnNlbGVjdFN1Ym5ldHMoc3VibmV0U2VsZWN0aW9uKS5zdWJuZXRJZHMsXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIGFzc2lnblB1YmxpY0lwOiB0aGlzLmFzc2lnblB1YmxpY0lwID8gJ0VOQUJMRUQnIDogJ0RJU0FCTEVEJyxcbiAgICAgIC8vIHRoZSBjbGVhbmVkIHVwIHByb3ZpZGVyIHBhdGggcGx1cyB3aGF0ZXZlciB0aGUgdXNlciBhc2tlZCBmb3JcbiAgICAgIC8vIHNlZSBzZWxlY3RQcm92aWRlclBhcmFtcygpIGluIHJ1bm5lci50cywgd2hpY2ggbWVyZ2VzIHRoZSByZXN0IG9mIHRoZSBzdGFuZGFyZCBydW5uZXIgdGFncyBpbiBhdCBydW50aW1lXG4gICAgICB0YWdzOiBPYmplY3QuZW50cmllcyh0aGlzLnRhZ3MpLm1hcCgoW0tleSwgVmFsdWVdKSA9PiAoeyBLZXksIFZhbHVlIH0pKSxcbiAgICAgIGNsZWFuTGFiZWxzOiB0cnVlLFxuICAgICAgcnVubmVyR3JvdXA6IHRoaXMuZ3JvdXAgPz8gJycsXG4gICAgICBkZWZhdWx0TGFiZWxzOiBydW5uZXJEZWZhdWx0TGFiZWxzKHRoaXMuaW1hZ2Uub3MsIHRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLCB0aGlzLmRlZmF1bHRMYWJlbHMpLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lUm9sZTogaWFtLklHcmFudGFibGUpIHtcbiAgICBncmFudEVjc1J1blRhc2sodGhpcywgc3RhdGVNYWNoaW5lUm9sZSwgdGhpcy50YXNrKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9zdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1cyB7XG4gICAgdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkuZ3JhbnQoc3RhdHVzRnVuY3Rpb25Sb2xlLCAnZWNyOkRlc2NyaWJlSW1hZ2VzJyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgbGFiZWxzOiB0aGlzLmxhYmVscyxcbiAgICAgIGNvbnN0cnVjdFBhdGg6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgdnBjQXJuOiB0aGlzLnZwYz8udnBjQXJuLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICByb2xlQXJuOiB0aGlzLnRhc2sudGFza1JvbGUucm9sZUFybixcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGltYWdlOiB7XG4gICAgICAgIGltYWdlUmVwb3NpdG9yeTogdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgaW1hZ2VUYWc6IHRoaXMuaW1hZ2UuaW1hZ2VUYWcsXG4gICAgICAgIGltYWdlQnVpbGRlckxvZ0dyb3VwOiB0aGlzLmltYWdlLmxvZ0dyb3VwPy5sb2dHcm91cE5hbWUsXG4gICAgICB9LFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIEZhcmdhdGVSdW5uZXJQcm92aWRlcn1cbiAqL1xuZXhwb3J0IGNsYXNzIEZhcmdhdGVSdW5uZXIgZXh0ZW5kcyBGYXJnYXRlUnVubmVyUHJvdmlkZXIge1xufVxuIl19