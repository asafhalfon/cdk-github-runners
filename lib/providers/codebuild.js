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
exports.CodeBuildRunner = exports.CodeBuildRunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const path = __importStar(require("path"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_codebuild_1 = require("aws-cdk-lib/aws-codebuild");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const common_1 = require("./common");
const image_builders_1 = require("../image-builders");
/**
 * GitHub Actions runner provider using CodeBuild to execute jobs.
 *
 * Creates a project that gets started for each job.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
class CodeBuildRunnerProvider extends common_1.BaseProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.CodeBuildRunnerProvider", version: "0.0.0" };
    /** @internal */
    static _FAMILY = 'codebuild';
    /**
     * Path to Dockerfile for Linux x64 with all the requirements for CodeBuild runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
     *
     * Available build arguments that can be set in the image builder:
     * * `BASE_IMAGE` sets the `FROM` line. This should be an Ubuntu compatible image.
     * * `EXTRA_PACKAGES` can be used to install additional packages.
     * * `DOCKER_CHANNEL` overrides the channel from which Docker will be downloaded. Defaults to `"stable"`.
     * * `DIND_COMMIT` overrides the commit where dind is found.
     * * `DOCKER_VERSION` overrides the installed Docker version.
     * * `DOCKER_COMPOSE_VERSION` overrides the installed docker-compose version.
     *
     * @deprecated Use `imageBuilder()` instead.
     */
    static LINUX_X64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'codebuild', 'linux-x64');
    /**
     * Path to Dockerfile for Linux ARM64 with all the requirements for CodeBuild runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
     *
     * Available build arguments that can be set in the image builder:
     * * `BASE_IMAGE` sets the `FROM` line. This should be an Ubuntu compatible image.
     * * `EXTRA_PACKAGES` can be used to install additional packages.
     * * `DOCKER_CHANNEL` overrides the channel from which Docker will be downloaded. Defaults to `"stable"`.
     * * `DIND_COMMIT` overrides the commit where dind is found.
     * * `DOCKER_VERSION` overrides the installed Docker version.
     * * `DOCKER_COMPOSE_VERSION` overrides the installed docker-compose version.
     *
     * @deprecated Use `imageBuilder()` instead.
     */
    static LINUX_ARM64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'codebuild', 'linux-arm64');
    /**
     * The fragment that runs any CodeBuild provider. Reads the config {@link _runnerConfig} generated for it from
     * `$.providerParams`. Renders what CodeBuildStartBuild used to render per provider.
     *
     * @internal
     */
    static _stateMachineFragment(scope) {
        const p = (common_1.providerParam);
        return new aws_cdk_lib_1.aws_stepfunctions.CustomState(scope, 'CodeBuild Runner', {
            stateJson: {
                Type: 'Task',
                Resource: `arn:${aws_cdk_lib_1.Aws.PARTITION}:states:::codebuild:startBuild.sync`,
                Parameters: {
                    'ProjectName.$': p('projectName'),
                    'EnvironmentVariablesOverride': (0, common_1.runnerEnvironment)((name, value) => ({
                        'Name': name,
                        'Type': 'PLAINTEXT',
                        'Value.$': value,
                    })),
                },
            },
        });
    }
    /**
     * Create new image builder that builds CodeBuild specific runner images.
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
     * CodeBuild project hosting the runner.
     */
    project;
    /**
     * Labels associated with this provider.
     */
    labels;
    /**
     * Grant principal used to add permissions to the runner role.
     */
    grantPrincipal;
    /**
     * Docker image loaded with GitHub Actions Runner and its prerequisites. The image is built by an image builder and is specific to CodeBuild.
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
    vpc;
    securityGroups;
    dind;
    defaultLabels;
    constructor(scope, id, props) {
        super(scope, id, props);
        // warn against isolated networks
        if (props?.subnetSelection?.subnetType == aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_ISOLATED) {
            aws_cdk_lib_1.Annotations.of(this).addWarning('Private isolated subnets cannot pull from public ECR and VPC endpoint is not supported yet. ' +
                'See https://github.com/aws/containers-roadmap/issues/1160');
        }
        // error out on no-nat networks because the build will hang
        if (props?.subnetSelection?.subnetType == aws_cdk_lib_1.aws_ec2.SubnetType.PUBLIC) {
            aws_cdk_lib_1.Annotations.of(this).addError('Public subnets do not work with CodeBuild as it cannot be assigned an IP. ' +
                'See https://docs.aws.amazon.com/codebuild/latest/userguide/vpc-support.html#best-practices-for-vpcs');
        }
        this.labels = this.labelsFromProperties('codebuild', props?.label, props?.labels);
        this.group = props?.group;
        this.vpc = props?.vpc;
        if (props?.securityGroup) {
            this.securityGroups = [props.securityGroup];
        }
        else {
            if (props?.securityGroups) {
                this.securityGroups = props.securityGroups;
            }
            else {
                if (this.vpc) {
                    this.securityGroups = [new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, 'SG', { vpc: this.vpc })];
                }
            }
        }
        this.dind = props?.dockerInDocker ?? true;
        this.defaultLabels = props?.defaultLabels ?? true;
        let buildSpec = {
            version: 0.2,
            env: {
                variables: {
                    RUNNER_JIT_CONFIG: '',
                    RUNNER_NAME: 'unspecified',
                    RUNNER_LABEL: 'unspecified',
                    OWNER: 'unspecified',
                    REPO: 'unspecified',
                    GITHUB_DOMAIN: 'github.com',
                    // DEPRECATED: remove in 1.0.0. only executions that started before JIT runners pass these, to register with a registration token.
                    RUNNER_TOKEN: 'unspecified',
                    REGISTRATION_URL: 'unspecified',
                    RUNNER_GROUP1: '',
                    RUNNER_GROUP2: '',
                    DEFAULT_LABELS: '',
                },
            },
            phases: {
                install: {
                    commands: [
                        this.dind ? 'nohup dockerd --host=unix:///var/run/docker.sock --host=tcp://127.0.0.1:2375 --storage-driver=overlay2 &' : '',
                        this.dind ? 'timeout 15 sh -c "until docker info; do echo .; sleep 1; done"' : '',
                        '/home/runner/job-reporter.sh ${RUNNER_NAME}',
                        // DEPRECATED: remove in 1.0.0. registers the runner of executions that started before JIT runners, which pass a registration token.
                        'if [ "${RUNNER_VERSION}" = "latest" ]; then RUNNER_FLAGS=""; else RUNNER_FLAGS="--disableupdate"; fi',
                        'if [ -z "${RUNNER_JIT_CONFIG}" ]; then sudo -Hu runner /home/runner/config.sh --unattended --url "${REGISTRATION_URL}" --token "${RUNNER_TOKEN}" --ephemeral --work _work --labels "${RUNNER_LABEL},cdkghr:started:`date +%s`" ${RUNNER_FLAGS} --name "${RUNNER_NAME}" ${RUNNER_GROUP1} ${RUNNER_GROUP2} ${DEFAULT_LABELS}; fi',
                    ],
                },
                build: {
                    commands: [
                        // DEPRECATED: remove the else branch in 1.0.0. it runs the runner registered with a registration token above.
                        'if [ -n "${RUNNER_JIT_CONFIG}" ]; then sudo --preserve-env=AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,AWS_DEFAULT_REGION,AWS_REGION -Hu runner /home/runner/run.sh --jitconfig "${RUNNER_JIT_CONFIG}"; else sudo --preserve-env=AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,AWS_DEFAULT_REGION,AWS_REGION -Hu runner /home/runner/run.sh; fi',
                        'STATUS=$(grep -Phors "finish job request for job [0-9a-f-]+ with result: .*" /home/runner/_diag/ | tail -n1 | awk \'{print $NF}\')',
                        'if [ -n "$STATUS" ]; then echo CDKGHA JOB DONE "$RUNNER_LABEL" "$STATUS"; fi',
                    ],
                },
            },
        };
        const imageBuilder = props?.imageBuilder ?? CodeBuildRunnerProvider.imageBuilder(this, 'Image Builder');
        const image = this.image = imageBuilder.bindDockerImage();
        if (image.os.is(common_1.Os.WINDOWS)) {
            buildSpec.phases.install.commands = [
                'cd \\actions',
                '& ./job-reporter.ps1 "${Env:RUNNER_NAME}"',
                // DEPRECATED: remove in 1.0.0. registers the runner of executions that started before JIT runners, which pass a registration token.
                'if (${Env:RUNNER_VERSION} -eq "latest") { $RunnerFlags = "" } else { $RunnerFlags = "--disableupdate" }',
                'if (-not ${Env:RUNNER_JIT_CONFIG}) { ./config.cmd --unattended --url "${Env:REGISTRATION_URL}" --token "${Env:RUNNER_TOKEN}" --ephemeral --work _work --labels "${Env:RUNNER_LABEL},cdkghr:started:$(Get-Date -UFormat %s)" ${RunnerFlags} --name "${Env:RUNNER_NAME}" ${Env:RUNNER_GROUP1} ${Env:RUNNER_GROUP2} ${Env:DEFAULT_LABELS} }',
            ];
            buildSpec.phases.build.commands = [
                'cd \\actions',
                // DEPRECATED: remove the else branch in 1.0.0. it runs the runner registered with a registration token above.
                'if (${Env:RUNNER_JIT_CONFIG}) { ./run.cmd --jitconfig "${Env:RUNNER_JIT_CONFIG}" } else { ./run.cmd }',
                '$STATUS = Select-String -Path \'./_diag/*.log\' -Pattern \'finish job request for job [0-9a-f\\-]+ with result: (.*)\' | %{$_.Matches.Groups[1].Value} | Select-Object -Last 1',
                'if ($STATUS) { echo "CDKGHA JOB DONE $\{Env:RUNNER_LABEL\} $STATUS" }',
            ];
        }
        if (props?.gpu) {
            if (image.os.is(common_1.Os.WINDOWS) || image.architecture.is(common_1.Architecture.ARM64)) {
                throw new Error('CodeBuild GPU is only supported for Linux x64 images. Set gpu: false or use a Linux x64 image.');
            }
            if (props?.computeType !== undefined && props.computeType !== aws_codebuild_1.ComputeType.SMALL && props.computeType !== aws_codebuild_1.ComputeType.LARGE) {
                throw new Error(`CodeBuild GPU only supports SMALL (1 GPU) or LARGE (4 GPUs). Got ${props.computeType}.`);
            }
        }
        // choose build image
        let buildImage;
        if (image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS)) {
            if (props?.gpu && image.architecture.is(common_1.Architecture.X86_64)) {
                buildImage = aws_codebuild_1.LinuxGpuBuildImage.fromEcrRepository(image.imageRepository, image.imageTag);
            }
            else if (image.architecture.is(common_1.Architecture.X86_64)) {
                buildImage = aws_cdk_lib_1.aws_codebuild.LinuxBuildImage.fromEcrRepository(image.imageRepository, image.imageTag);
            }
            else if (image.architecture.is(common_1.Architecture.ARM64)) {
                buildImage = aws_cdk_lib_1.aws_codebuild.LinuxArmBuildImage.fromEcrRepository(image.imageRepository, image.imageTag);
            }
        }
        if (image.os.is(common_1.Os.WINDOWS)) {
            if (image.architecture.is(common_1.Architecture.X86_64)) {
                buildImage = aws_cdk_lib_1.aws_codebuild.WindowsBuildImage.fromEcrRepository(image.imageRepository, image.imageTag, aws_cdk_lib_1.aws_codebuild.WindowsImageType.SERVER_2019);
            }
        }
        if (buildImage === undefined) {
            throw new Error(`Unable to find supported CodeBuild image for ${image.os.name}/${image.architecture.name}`);
        }
        // create project
        this.logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'Logs', {
            retention: props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        this.project = new aws_cdk_lib_1.aws_codebuild.Project(this, 'CodeBuild', {
            description: `GitHub Actions self-hosted runner for labels ${this.labels}`,
            buildSpec: aws_cdk_lib_1.aws_codebuild.BuildSpec.fromObject(buildSpec),
            vpc: this.vpc,
            securityGroups: this.securityGroups,
            subnetSelection: props?.subnetSelection,
            timeout: props?.timeout ?? aws_cdk_lib_1.Duration.hours(1),
            environment: {
                buildImage,
                computeType: props?.computeType ?? aws_codebuild_1.ComputeType.SMALL,
                privileged: this.dind && !image.os.is(common_1.Os.WINDOWS),
            },
            logging: {
                cloudWatch: {
                    logGroup: this.logGroup,
                },
            },
        });
        this.grantPrincipal = this.project.grantPrincipal;
        // allow SSM Session Manager access
        // this.project.role?.addToPrincipalPolicy(MINIMAL_SSM_SESSION_MANAGER_POLICY_STATEMENT);
        // step function won't let us pass `debugSessionEnabled: true` unless we use batch, so we can't use this
    }
    /**
     * Config for the shared CodeBuild fragment.
     *
     * @internal
     */
    _runnerConfig() {
        return {
            family: CodeBuildRunnerProvider._FAMILY,
            provider: this.node.path,
            projectName: this.project.projectName,
            runnerGroup: this.group ?? '',
            defaultLabels: (0, common_1.runnerDefaultLabels)(this.image.os, this.image.architecture, this.defaultLabels),
        };
    }
    /**
     * @internal
     */
    _grantStateMachine(stateMachineRole) {
        stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['codebuild:StartBuild', 'codebuild:StopBuild', 'codebuild:BatchGetBuilds', 'codebuild:BatchGetReports'],
            resources: [this.project.projectArn],
        }));
        // managed rule for the startBuild.sync integration
        // every CodeBuild provider emits the same statement so policy minimization keeps just one
        stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['events:PutTargets', 'events:PutRule', 'events:DescribeRule'],
            resources: [aws_cdk_lib_1.Stack.of(this).formatArn({
                    service: 'events',
                    resource: 'rule',
                    resourceName: 'StepFunctionsGetEventForCodeBuildStartBuildRule',
                    arnFormat: aws_cdk_lib_1.ArnFormat.SLASH_RESOURCE_NAME,
                })],
        }));
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
            securityGroups: this.securityGroups?.map(sg => sg.securityGroupId),
            roleArn: this.project.role?.roleArn,
            logGroup: this.logGroup.logGroupName,
            image: {
                imageRepository: this.image.imageRepository.repositoryUri,
                imageTag: this.image.imageTag,
                imageBuilderLogGroup: this.image.logGroup?.logGroupName,
            },
        };
    }
    /**
     * The network connections associated with this resource.
     */
    get connections() {
        return this.project.connections;
    }
}
exports.CodeBuildRunnerProvider = CodeBuildRunnerProvider;
/**
 * @deprecated use {@link CodeBuildRunnerProvider}
 */
class CodeBuildRunner extends CodeBuildRunnerProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.CodeBuildRunner", version: "0.0.0" };
}
exports.CodeBuildRunner = CodeBuildRunner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWJ1aWxkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9jb2RlYnVpbGQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDJDQUE2QjtBQUM3Qiw2Q0FZcUI7QUFDckIsNkRBQTRFO0FBQzVFLG1EQUFxRDtBQUVyRCxxQ0Fja0I7QUFDbEIsc0RBQTJIO0FBNEkzSDs7Ozs7O0dBTUc7QUFDSCxNQUFhLHVCQUF3QixTQUFRLHFCQUFZOztJQUN2RCxnQkFBZ0I7SUFDVCxNQUFNLENBQVUsT0FBTyxHQUFHLFdBQVcsQ0FBQztJQUU3Qzs7Ozs7Ozs7Ozs7O09BWUc7SUFDSSxNQUFNLENBQVUseUJBQXlCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLFdBQVcsRUFBRSxXQUFXLENBQUMsQ0FBQztJQUV6STs7Ozs7Ozs7Ozs7O09BWUc7SUFDSSxNQUFNLENBQVUsMkJBQTJCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsZUFBZSxFQUFFLFdBQVcsRUFBRSxhQUFhLENBQUMsQ0FBQztJQUU3STs7Ozs7T0FLRztJQUNJLE1BQU0sQ0FBQyxxQkFBcUIsQ0FBQyxLQUFnQjtRQUNsRCxNQUFNLENBQUMsR0FBRyxDQUFBLHNCQUFvQyxDQUFBLENBQUM7UUFDL0MsT0FBTyxJQUFJLCtCQUFhLENBQUMsV0FBVyxDQUFDLEtBQUssRUFBRSxrQkFBa0IsRUFBRTtZQUM5RCxTQUFTLEVBQUU7Z0JBQ1QsSUFBSSxFQUFFLE1BQU07Z0JBQ1osUUFBUSxFQUFFLE9BQU8saUJBQUcsQ0FBQyxTQUFTLHFDQUFxQztnQkFDbkUsVUFBVSxFQUFFO29CQUNWLGVBQWUsRUFBRSxDQUFDLENBQUMsYUFBYSxDQUFD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QUFFLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLFlBQVk7YUFDeEQ7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ0gsSUFBVyxXQUFXO1FBQ3BCLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUM7SUFDbEMsQ0FBQzs7QUFsV0gsMERBbVdDO0FBRUQ7O0dBRUc7QUFDSCxNQUFhLGVBQWdCLFNBQVEsdUJBQXVCOzs7QUFBNUQsMENBQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHtcbiAgQW5ub3RhdGlvbnMsXG4gIEFybkZvcm1hdCxcbiAgQXdzLFxuICBhd3NfY29kZWJ1aWxkIGFzIGNvZGVidWlsZCxcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3Nfc3RlcGZ1bmN0aW9ucyBhcyBzdGVwZnVuY3Rpb25zLFxuICBEdXJhdGlvbixcbiAgUmVtb3ZhbFBvbGljeSxcbiAgU3RhY2ssXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbXB1dGVUeXBlLCBMaW51eEdwdUJ1aWxkSW1hZ2UgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZWJ1aWxkJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gIEFyY2hpdGVjdHVyZSxcbiAgQmFzZVByb3ZpZGVyLFxuICBJUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlclN0YXR1cyxcbiAgT3MsXG4gIHJ1bm5lckVudmlyb25tZW50LFxuICBSdW5uZXJJbWFnZSxcbiAgUnVubmVyUHJvdmlkZXJQcm9wcyxcbiAgUnVubmVyVmVyc2lvbixcbiAgcHJvdmlkZXJQYXJhbSxcbiAgUnVubmVyQ29uZmlnLFxuICBydW5uZXJEZWZhdWx0TGFiZWxzLFxufSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQgeyBJUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXIsIFJ1bm5lckltYWdlQnVpbGRlclByb3BzLCBSdW5uZXJJbWFnZUNvbXBvbmVudCB9IGZyb20gJy4uL2ltYWdlLWJ1aWxkZXJzJztcblxuXG5leHBvcnQgaW50ZXJmYWNlIENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgRG9ja2VyIGltYWdlcyBjb250YWluaW5nIEdpdEh1YiBSdW5uZXIgYW5kIGFsbCByZXF1aXJlbWVudHMuXG4gICAqXG4gICAqIFRoZSBpbWFnZSBidWlsZGVyIG11c3QgY29udGFpbiB0aGUge0BsaW5rIFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcn0gY29tcG9uZW50IHVubGVzcyBgZG9ja2VySW5Eb2NrZXJgIGlzIHNldCB0byBmYWxzZS5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgZGV0ZXJtaW5lcyB0aGUgT1MgYW5kIGFyY2hpdGVjdHVyZSBvZiB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBDb2RlQnVpbGRSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIoKVxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2VCdWlsZGVyPzogSVJ1bm5lckltYWdlQnVpbGRlcjtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgbGFiZWwgdXNlZCBmb3IgdGhpcyBwcm92aWRlci5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgbGFiZWxzfSBpbnN0ZWFkXG4gICAqL1xuICByZWFkb25seSBsYWJlbD86IHN0cmluZztcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgbGFiZWxzIHVzZWQgZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqXG4gICAqIFRoZXNlIGxhYmVscyBhcmUgdXNlZCB0byBpZGVudGlmeSB3aGljaCBwcm92aWRlciBzaG91bGQgc3Bhd24gYSBuZXcgb24tZGVtYW5kIHJ1bm5lci4gRXZlcnkgam9iIHNlbmRzIGEgd2ViaG9vayB3aXRoIHRoZSBsYWJlbHMgaXQncyBsb29raW5nIGZvclxuICAgKiBiYXNlZCBvbiBydW5zLW9uLiBXZSBtYXRjaCB0aGUgbGFiZWxzIGZyb20gdGhlIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlLiBJZiBhbGwgdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZSBhcmUgcHJlc2VudCBpbiB0aGVcbiAgICogam9iJ3MgbGFiZWxzLCB0aGlzIHByb3ZpZGVyIHdpbGwgYmUgY2hvc2VuIGFuZCBzcGF3biBhIG5ldyBydW5uZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IFsnY29kZWJ1aWxkJ11cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVscz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBydW5uZXIgZ3JvdXAgbmFtZS5cbiAgICpcbiAgICogSWYgc3BlY2lmaWVkLCB0aGUgcnVubmVyIHdpbGwgYmUgcmVnaXN0ZXJlZCB3aXRoIHRoaXMgZ3JvdXAgbmFtZS4gU2V0dGluZyBhIHJ1bm5lciBncm91cCBjYW4gaGVscCBtYW5hZ2luZyBhY2Nlc3MgdG8gc2VsZi1ob3N0ZWQgcnVubmVycy4gSXRcbiAgICogcmVxdWlyZXMgYSBwYWlkIEdpdEh1YiBhY2NvdW50IGFuZCBvcmdhbml6YXRpb24gbGV2ZWwgcnVubmVyIHJlZ2lzdHJhdGlvbi5cbiAgICpcbiAgICogVGhlIGdyb3VwIG11c3QgZXhpc3Qgb3IgdGhlIHJ1bm5lciB3aWxsIG5vdCBzdGFydC5cbiAgICpcbiAgICogVXNlcnMgd2lsbCBzdGlsbCBiZSBhYmxlIHRvIHRyaWdnZXIgdGhpcyBydW5uZXIgd2l0aCB0aGUgY29ycmVjdCBsYWJlbHMuIEJ1dCB0aGUgcnVubmVyIHdpbGwgb25seSBiZSBhYmxlIHRvIHJ1biBqb2JzIGZyb20gcmVwb3MgYWxsb3dlZCB0byB1c2UgdGhlIGdyb3VwLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBWUEMgdG8gbGF1bmNoIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBubyBWUENcbiAgICovXG4gIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cCB0byBhc3NpZ24gdG8gdGhpcyBpbnN0YW5jZS5cbiAgICpcbiAgICogQGRlZmF1bHQgcHVibGljIHByb2plY3Qgd2l0aCBubyBzZWN1cml0eSBncm91cFxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIHNlY3VyaXR5R3JvdXBzfVxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cD86IGVjMi5JU2VjdXJpdHlHcm91cDtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXBzIHRvIGFzc2lnbiB0byB0aGlzIGluc3RhbmNlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBzZWN1cml0eSBncm91cCwgaWYge0BsaW5rIHZwY30gaXMgdXNlZFxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogV2hlcmUgdG8gcGxhY2UgdGhlIG5ldHdvcmsgaW50ZXJmYWNlcyB3aXRoaW4gdGhlIFZQQy5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gc3VibmV0XG4gICAqL1xuICByZWFkb25seSBzdWJuZXRTZWxlY3Rpb24/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBUaGUgdHlwZSBvZiBjb21wdXRlIHRvIHVzZSBmb3IgdGhpcyBidWlsZC5cbiAgICogU2VlIHRoZSB7QGxpbmsgQ29tcHV0ZVR5cGV9IGVudW0gZm9yIHRoZSBwb3NzaWJsZSB2YWx1ZXMuXG4gICAqXG4gICAqIFRoZSBjb21wdXRlIHR5cGUgZGV0ZXJtaW5lcyBDUFUsIG1lbW9yeSwgYW5kIGRpc2sgc3BhY2U6XG4gICAqIC0gU01BTEw6IDIgdkNQVSwgMyBHQiBSQU0sIDY0IEdCIGRpc2tcbiAgICogLSBNRURJVU06IDQgdkNQVSwgNyBHQiBSQU0sIDEyOCBHQiBkaXNrXG4gICAqIC0gTEFSR0U6IDggdkNQVSwgMTUgR0IgUkFNLCAxMjggR0IgZGlza1xuICAgKiAtIFgyX0xBUkdFOiA3MiB2Q1BVLCAxNDUgR0IgUkFNLCAyNTYgR0IgZGlzayAoTGludXgpIG9yIDgyNCBHQiBkaXNrIChXaW5kb3dzKVxuICAgKlxuICAgKiBVc2UgYSBsYXJnZXIgY29tcHV0ZSB0eXBlIHdoZW4geW91IG5lZWQgbW9yZSBkaXNrIHNwYWNlIGZvciBidWlsZGluZyBsYXJnZXIgRG9ja2VyIGltYWdlcy5cbiAgICpcbiAgICogRm9yIG1vcmUgZGV0YWlscywgc2VlIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9jb2RlYnVpbGQvbGF0ZXN0L3VzZXJndWlkZS9idWlsZC1lbnYtcmVmLWNvbXB1dGUtdHlwZXMuaHRtbCNlbnZpcm9ubWVudC50eXBlc1xuICAgKlxuICAgKiBAZGVmYXVsdCB7QGxpbmsgQ29tcHV0ZVR5cGUjU01BTEx9XG4gICAqL1xuICByZWFkb25seSBjb21wdXRlVHlwZT86IGNvZGVidWlsZC5Db21wdXRlVHlwZTtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBtaW51dGVzIGFmdGVyIHdoaWNoIEFXUyBDb2RlQnVpbGQgc3RvcHMgdGhlIGJ1aWxkIGlmIGl0J3NcbiAgICogbm90IGNvbXBsZXRlLiBGb3IgdmFsaWQgdmFsdWVzLCBzZWUgdGhlIHRpbWVvdXRJbk1pbnV0ZXMgZmllbGQgaW4gdGhlIEFXU1xuICAgKiBDb2RlQnVpbGQgVXNlciBHdWlkZS5cbiAgICpcbiAgICogQGRlZmF1bHQgRHVyYXRpb24uaG91cnMoMSlcbiAgICovXG4gIHJlYWRvbmx5IHRpbWVvdXQ/OiBEdXJhdGlvbjtcblxuICAvKipcbiAgICogU3VwcG9ydCBidWlsZGluZyBhbmQgcnVubmluZyBEb2NrZXIgaW1hZ2VzIGJ5IGVuYWJsaW5nIERvY2tlci1pbi1Eb2NrZXIgKGRpbmQpIGFuZCB0aGUgcmVxdWlyZWQgQ29kZUJ1aWxkIHByaXZpbGVnZWQgbW9kZS4gRGlzYWJsaW5nIHRoaXMgY2FuXG4gICAqIHNwZWVkIHVwIHByb3Zpc2lvbmluZyBvZiBDb2RlQnVpbGQgcnVubmVycy4gSWYgeW91IGRvbid0IGludGVuZCBvbiBydW5uaW5nIG9yIGJ1aWxkaW5nIERvY2tlciBpbWFnZXMsIGRpc2FibGUgdGhpcyBmb3IgZmFzdGVyIHN0YXJ0LXVwIHRpbWVzLlxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBkb2NrZXJJbkRvY2tlcj86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFVzZSBHUFUgY29tcHV0ZSBmb3IgYnVpbGRzLiBXaGVuIGVuYWJsZWQsIHRoZSBkZWZhdWx0IGNvbXB1dGUgdHlwZSBpcyBCVUlMRF9HRU5FUkFMMV9TTUFMTCAoNCB2Q1BVLCAxNiBHQiBSQU0sIDEgTlZJRElBIEExMEcgR1BVKS5cbiAgICpcbiAgICogWW91IGNhbiBvdmVycmlkZSB0aGUgY29tcHV0ZSB0eXBlIHVzaW5nIHRoZSBgY29tcHV0ZVR5cGVgIHByb3BlcnR5IChmb3IgZXhhbXBsZSwgdG8gdXNlIEJVSUxEX0dFTkVSQUwxX0xBUkdFIGZvciBtb3JlIHJlc291cmNlcyksXG4gICAqIHN1YmplY3QgdG8gdGhlIHN1cHBvcnRlZCBHUFUgY29tcHV0ZSB0eXBlcy5cbiAgICpcbiAgICogV2hlbiB1c2luZyBHUFUgY29tcHV0ZSwgZW5zdXJlIHlvdXIgcnVubmVyIGltYWdlIGluY2x1ZGVzIGFueSByZXF1aXJlZCBHUFUgbGlicmFyaWVzIChmb3IgZXhhbXBsZSwgQ1VEQSlcbiAgICogZWl0aGVyIGJ5IHVzaW5nIGEgYmFzZSBpbWFnZSB0aGF0IGhhcyB0aGVtIHByZWluc3RhbGxlZCAoc3VjaCBhcyBhbiBhcHByb3ByaWF0ZSBudmlkaWEvY3VkYSBpbWFnZSkgb3IgYnlcbiAgICogYWRkaW5nIGltYWdlIGNvbXBvbmVudHMgdGhhdCBpbnN0YWxsIHRoZW0uIFRoZSBkZWZhdWx0IGltYWdlIGJ1aWxkZXIgZG9lcyBub3QgYXV0b21hdGljYWxseSBzd2l0Y2ggdG8gYVxuICAgKiBDVURBLWVuYWJsZWQgYmFzZSBpbWFnZSB3aGVuIEdQVSBpcyBlbmFibGVkLlxuICAgKlxuICAgKiBHUFUgY29tcHV0ZSBpcyBvbmx5IGF2YWlsYWJsZSBmb3IgTGludXggeDY0IGltYWdlcy4gTm90IHN1cHBvcnRlZCBvbiBXaW5kb3dzIG9yIEFSTS5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGdwdT86IGJvb2xlYW47XG59XG5cbi8qKlxuICogUnVubmVyIGNvbmZpZyBmb3IgdGhlIENvZGVCdWlsZCBmYW1pbHkgZnJhZ21lbnQuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmludGVyZmFjZSBDb2RlQnVpbGRSdW5uZXJDb25maWcgZXh0ZW5kcyBSdW5uZXJDb25maWcge1xuICByZWFkb25seSBwcm9qZWN0TmFtZTogc3RyaW5nO1xufVxuXG4vKipcbiAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBwcm92aWRlciB1c2luZyBDb2RlQnVpbGQgdG8gZXhlY3V0ZSBqb2JzLlxuICpcbiAqIENyZWF0ZXMgYSBwcm9qZWN0IHRoYXQgZ2V0cyBzdGFydGVkIGZvciBlYWNoIGpvYi5cbiAqXG4gKiBUaGlzIGNvbnN0cnVjdCBpcyBub3QgbWVhbnQgdG8gYmUgdXNlZCBieSBpdHNlbGYuIEl0IHNob3VsZCBiZSBwYXNzZWQgaW4gdGhlIHByb3ZpZGVycyBwcm9wZXJ0eSBmb3IgR2l0SHViUnVubmVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyLCBJUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqIEBpbnRlcm5hbCAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IF9GQU1JTFkgPSAnY29kZWJ1aWxkJztcblxuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCB4NjQgd2l0aCBhbGwgdGhlIHJlcXVpcmVtZW50cyBmb3IgQ29kZUJ1aWxkIHJ1bm5lci4gVXNlIHRoaXMgRG9ja2VyZmlsZSB1bmxlc3MgeW91IG5lZWQgdG8gY3VzdG9taXplIGl0IGZ1cnRoZXIgdGhhbiBhbGxvd2VkIGJ5IGhvb2tzLlxuICAgKlxuICAgKiBBdmFpbGFibGUgYnVpbGQgYXJndW1lbnRzIHRoYXQgY2FuIGJlIHNldCBpbiB0aGUgaW1hZ2UgYnVpbGRlcjpcbiAgICogKiBgQkFTRV9JTUFHRWAgc2V0cyB0aGUgYEZST01gIGxpbmUuIFRoaXMgc2hvdWxkIGJlIGFuIFVidW50dSBjb21wYXRpYmxlIGltYWdlLlxuICAgKiAqIGBFWFRSQV9QQUNLQUdFU2AgY2FuIGJlIHVzZWQgdG8gaW5zdGFsbCBhZGRpdGlvbmFsIHBhY2thZ2VzLlxuICAgKiAqIGBET0NLRVJfQ0hBTk5FTGAgb3ZlcnJpZGVzIHRoZSBjaGFubmVsIGZyb20gd2hpY2ggRG9ja2VyIHdpbGwgYmUgZG93bmxvYWRlZC4gRGVmYXVsdHMgdG8gYFwic3RhYmxlXCJgLlxuICAgKiAqIGBESU5EX0NPTU1JVGAgb3ZlcnJpZGVzIHRoZSBjb21taXQgd2hlcmUgZGluZCBpcyBmb3VuZC5cbiAgICogKiBgRE9DS0VSX1ZFUlNJT05gIG92ZXJyaWRlcyB0aGUgaW5zdGFsbGVkIERvY2tlciB2ZXJzaW9uLlxuICAgKiAqIGBET0NLRVJfQ09NUE9TRV9WRVJTSU9OYCBvdmVycmlkZXMgdGhlIGluc3RhbGxlZCBkb2NrZXItY29tcG9zZSB2ZXJzaW9uLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGltYWdlQnVpbGRlcigpYCBpbnN0ZWFkLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9YNjRfRE9DS0VSRklMRV9QQVRIID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Fzc2V0cycsICdkb2NrZXItaW1hZ2VzJywgJ2NvZGVidWlsZCcsICdsaW51eC14NjQnKTtcblxuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCBBUk02NCB3aXRoIGFsbCB0aGUgcmVxdWlyZW1lbnRzIGZvciBDb2RlQnVpbGQgcnVubmVyLiBVc2UgdGhpcyBEb2NrZXJmaWxlIHVubGVzcyB5b3UgbmVlZCB0byBjdXN0b21pemUgaXQgZnVydGhlciB0aGFuIGFsbG93ZWQgYnkgaG9va3MuXG4gICAqXG4gICAqIEF2YWlsYWJsZSBidWlsZCBhcmd1bWVudHMgdGhhdCBjYW4gYmUgc2V0IGluIHRoZSBpbWFnZSBidWlsZGVyOlxuICAgKiAqIGBCQVNFX0lNQUdFYCBzZXRzIHRoZSBgRlJPTWAgbGluZS4gVGhpcyBzaG91bGQgYmUgYW4gVWJ1bnR1IGNvbXBhdGlibGUgaW1hZ2UuXG4gICAqICogYEVYVFJBX1BBQ0tBR0VTYCBjYW4gYmUgdXNlZCB0byBpbnN0YWxsIGFkZGl0aW9uYWwgcGFja2FnZXMuXG4gICAqICogYERPQ0tFUl9DSEFOTkVMYCBvdmVycmlkZXMgdGhlIGNoYW5uZWwgZnJvbSB3aGljaCBEb2NrZXIgd2lsbCBiZSBkb3dubG9hZGVkLiBEZWZhdWx0cyB0byBgXCJzdGFibGVcImAuXG4gICAqICogYERJTkRfQ09NTUlUYCBvdmVycmlkZXMgdGhlIGNvbW1pdCB3aGVyZSBkaW5kIGlzIGZvdW5kLlxuICAgKiAqIGBET0NLRVJfVkVSU0lPTmAgb3ZlcnJpZGVzIHRoZSBpbnN0YWxsZWQgRG9ja2VyIHZlcnNpb24uXG4gICAqICogYERPQ0tFUl9DT01QT1NFX1ZFUlNJT05gIG92ZXJyaWRlcyB0aGUgaW5zdGFsbGVkIGRvY2tlci1jb21wb3NlIHZlcnNpb24uXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFVzZSBgaW1hZ2VCdWlsZGVyKClgIGluc3RlYWQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IExJTlVYX0FSTTY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdjb2RlYnVpbGQnLCAnbGludXgtYXJtNjQnKTtcblxuICAvKipcbiAgICogVGhlIGZyYWdtZW50IHRoYXQgcnVucyBhbnkgQ29kZUJ1aWxkIHByb3ZpZGVyLiBSZWFkcyB0aGUgY29uZmlnIHtAbGluayBfcnVubmVyQ29uZmlnfSBnZW5lcmF0ZWQgZm9yIGl0IGZyb21cbiAgICogYCQucHJvdmlkZXJQYXJhbXNgLiBSZW5kZXJzIHdoYXQgQ29kZUJ1aWxkU3RhcnRCdWlsZCB1c2VkIHRvIHJlbmRlciBwZXIgcHJvdmlkZXIuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBfc3RhdGVNYWNoaW5lRnJhZ21lbnQoc2NvcGU6IENvbnN0cnVjdCk6IHN0ZXBmdW5jdGlvbnMuSUNoYWluYWJsZSB7XG4gICAgY29uc3QgcCA9IHByb3ZpZGVyUGFyYW08Q29kZUJ1aWxkUnVubmVyQ29uZmlnPjtcbiAgICByZXR1cm4gbmV3IHN0ZXBmdW5jdGlvbnMuQ3VzdG9tU3RhdGUoc2NvcGUsICdDb2RlQnVpbGQgUnVubmVyJywge1xuICAgICAgc3RhdGVKc29uOiB7XG4gICAgICAgIFR5cGU6ICdUYXNrJyxcbiAgICAgICAgUmVzb3VyY2U6IGBhcm46JHtBd3MuUEFSVElUSU9OfTpzdGF0ZXM6Ojpjb2RlYnVpbGQ6c3RhcnRCdWlsZC5zeW5jYCxcbiAgICAgICAgUGFyYW1ldGVyczoge1xuICAgICAgICAgICdQcm9qZWN0TmFtZS4kJzogcCgncHJvamVjdE5hbWUnKSxcbiAgICAgICAgICAnRW52aXJvbm1lbnRWYXJpYWJsZXNPdmVycmlkZSc6IHJ1bm5lckVudmlyb25tZW50KChuYW1lLCB2YWx1ZSkgPT4gKHtcbiAgICAgICAgICAgICdOYW1lJzogbmFtZSxcbiAgICAgICAgICAgICdUeXBlJzogJ1BMQUlOVEVYVCcsXG4gICAgICAgICAgICAnVmFsdWUuJCc6IHZhbHVlLFxuICAgICAgICAgIH0pKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIG5ldyBpbWFnZSBidWlsZGVyIHRoYXQgYnVpbGRzIENvZGVCdWlsZCBzcGVjaWZpYyBydW5uZXIgaW1hZ2VzLlxuICAgKlxuICAgKiBZb3UgY2FuIGN1c3RvbWl6ZSB0aGUgT1MsIGFyY2hpdGVjdHVyZSwgVlBDLCBzdWJuZXQsIHNlY3VyaXR5IGdyb3VwcywgZXRjLiBieSBwYXNzaW5nIGluIHByb3BzLlxuICAgKlxuICAgKiBZb3UgY2FuIGFkZCBjb21wb25lbnRzIHRvIHRoZSBpbWFnZSBidWlsZGVyIGJ5IGNhbGxpbmcgYGltYWdlQnVpbGRlci5hZGRDb21wb25lbnQoKWAuXG4gICAqXG4gICAqIFRoZSBkZWZhdWx0IE9TIGlzIFVidW50dSBydW5uaW5nIG9uIHg2NCBhcmNoaXRlY3R1cmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNvbXBvbmVudHM6XG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcigpYFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcykge1xuICAgIHJldHVybiBSdW5uZXJJbWFnZUJ1aWxkZXIubmV3KHNjb3BlLCBpZCwge1xuICAgICAgb3M6IE9zLkxJTlVYX1VCVU5UVSxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGNvbXBvbmVudHM6IFtcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcigpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIocHJvcHM/LnJ1bm5lclZlcnNpb24gPz8gUnVubmVyVmVyc2lvbi5sYXRlc3QoKSksXG4gICAgICBdLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ29kZUJ1aWxkIHByb2plY3QgaG9zdGluZyB0aGUgcnVubmVyLlxuICAgKi9cbiAgcmVhZG9ubHkgcHJvamVjdDogY29kZWJ1aWxkLlByb2plY3Q7XG5cbiAgLyoqXG4gICAqIExhYmVscyBhc3NvY2lhdGVkIHdpdGggdGhpcyBwcm92aWRlci5cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVsczogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEdyYW50IHByaW5jaXBhbCB1c2VkIHRvIGFkZCBwZXJtaXNzaW9ucyB0byB0aGUgcnVubmVyIHJvbGUuXG4gICAqL1xuICByZWFkb25seSBncmFudFByaW5jaXBhbDogaWFtLklQcmluY2lwYWw7XG5cbiAgLyoqXG4gICAqIERvY2tlciBpbWFnZSBsb2FkZWQgd2l0aCBHaXRIdWIgQWN0aW9ucyBSdW5uZXIgYW5kIGl0cyBwcmVyZXF1aXNpdGVzLiBUaGUgaW1hZ2UgaXMgYnVpbHQgYnkgYW4gaW1hZ2UgYnVpbGRlciBhbmQgaXMgc3BlY2lmaWMgdG8gQ29kZUJ1aWxkLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBUaGlzIGZpZWxkIGlzIGludGVybmFsIGFuZCBzaG91bGQgbm90IGJlIGFjY2Vzc2VkIGRpcmVjdGx5LlxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2U6IFJ1bm5lckltYWdlO1xuXG4gIC8qKlxuICAgKiBMb2cgZ3JvdXAgd2hlcmUgcHJvdmlkZWQgcnVubmVycyB3aWxsIHNhdmUgdGhlaXIgbG9ncy5cbiAgICpcbiAgICogTm90ZSB0aGF0IHRoaXMgaXMgbm90IHRoZSBqb2IgbG9nLCBidXQgdGhlIHJ1bm5lciBpdHNlbGYuIEl0IHdpbGwgbm90IGNvbnRhaW4gb3V0cHV0IGZyb20gdGhlIEdpdEh1YiBBY3Rpb24gYnV0IG9ubHkgbWV0YWRhdGEgb24gaXRzIGV4ZWN1dGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwOiBsb2dzLklMb2dHcm91cDtcblxuXG4gIHByaXZhdGUgcmVhZG9ubHkgZ3JvdXA/OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBkaW5kOiBib29sZWFuO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBDb2RlQnVpbGRSdW5uZXJQcm92aWRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyB3YXJuIGFnYWluc3QgaXNvbGF0ZWQgbmV0d29ya3NcbiAgICBpZiAocHJvcHM/LnN1Ym5ldFNlbGVjdGlvbj8uc3VibmV0VHlwZSA9PSBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVEKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdQcml2YXRlIGlzb2xhdGVkIHN1Ym5ldHMgY2Fubm90IHB1bGwgZnJvbSBwdWJsaWMgRUNSIGFuZCBWUEMgZW5kcG9pbnQgaXMgbm90IHN1cHBvcnRlZCB5ZXQuICcgK1xuICAgICAgICAnU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvY29udGFpbmVycy1yb2FkbWFwL2lzc3Vlcy8xMTYwJyk7XG4gICAgfVxuXG4gICAgLy8gZXJyb3Igb3V0IG9uIG5vLW5hdCBuZXR3b3JrcyBiZWNhdXNlIHRoZSBidWlsZCB3aWxsIGhhbmdcbiAgICBpZiAocHJvcHM/LnN1Ym5ldFNlbGVjdGlvbj8uc3VibmV0VHlwZSA9PSBlYzIuU3VibmV0VHlwZS5QVUJMSUMpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdQdWJsaWMgc3VibmV0cyBkbyBub3Qgd29yayB3aXRoIENvZGVCdWlsZCBhcyBpdCBjYW5ub3QgYmUgYXNzaWduZWQgYW4gSVAuICcgK1xuICAgICAgICAnU2VlIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9jb2RlYnVpbGQvbGF0ZXN0L3VzZXJndWlkZS92cGMtc3VwcG9ydC5odG1sI2Jlc3QtcHJhY3RpY2VzLWZvci12cGNzJyk7XG4gICAgfVxuXG4gICAgdGhpcy5sYWJlbHMgPSB0aGlzLmxhYmVsc0Zyb21Qcm9wZXJ0aWVzKCdjb2RlYnVpbGQnLCBwcm9wcz8ubGFiZWwsIHByb3BzPy5sYWJlbHMpO1xuICAgIHRoaXMuZ3JvdXAgPSBwcm9wcz8uZ3JvdXA7XG4gICAgdGhpcy52cGMgPSBwcm9wcz8udnBjO1xuICAgIGlmIChwcm9wcz8uc2VjdXJpdHlHcm91cCkge1xuICAgICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IFtwcm9wcy5zZWN1cml0eUdyb3VwXTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHByb3BzPy5zZWN1cml0eUdyb3Vwcykge1xuICAgICAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gcHJvcHMuc2VjdXJpdHlHcm91cHM7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy52cGMpIHtcbiAgICAgICAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gW25ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnU0cnLCB7IHZwYzogdGhpcy52cGMgfSldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5kaW5kID0gcHJvcHM/LmRvY2tlckluRG9ja2VyID8/IHRydWU7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcblxuICAgIGxldCBidWlsZFNwZWMgPSB7XG4gICAgICB2ZXJzaW9uOiAwLjIsXG4gICAgICBlbnY6IHtcbiAgICAgICAgdmFyaWFibGVzOiB7XG4gICAgICAgICAgUlVOTkVSX0pJVF9DT05GSUc6ICcnLFxuICAgICAgICAgIFJVTk5FUl9OQU1FOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIFJVTk5FUl9MQUJFTDogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBPV05FUjogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBSRVBPOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIEdJVEhVQl9ET01BSU46ICdnaXRodWIuY29tJyxcbiAgICAgICAgICAvLyBERVBSRUNBVEVEOiByZW1vdmUgaW4gMS4wLjAuIG9ubHkgZXhlY3V0aW9ucyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIEpJVCBydW5uZXJzIHBhc3MgdGhlc2UsIHRvIHJlZ2lzdGVyIHdpdGggYSByZWdpc3RyYXRpb24gdG9rZW4uXG4gICAgICAgICAgUlVOTkVSX1RPS0VOOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIFJFR0lTVFJBVElPTl9VUkw6ICd1bnNwZWNpZmllZCcsXG4gICAgICAgICAgUlVOTkVSX0dST1VQMTogJycsXG4gICAgICAgICAgUlVOTkVSX0dST1VQMjogJycsXG4gICAgICAgICAgREVGQVVMVF9MQUJFTFM6ICcnLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHBoYXNlczoge1xuICAgICAgICBpbnN0YWxsOiB7XG4gICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgIHRoaXMuZGluZCA/ICdub2h1cCBkb2NrZXJkIC0taG9zdD11bml4Oi8vL3Zhci9ydW4vZG9ja2VyLnNvY2sgLS1ob3N0PXRjcDovLzEyNy4wLjAuMToyMzc1IC0tc3RvcmFnZS1kcml2ZXI9b3ZlcmxheTIgJicgOiAnJyxcbiAgICAgICAgICAgIHRoaXMuZGluZCA/ICd0aW1lb3V0IDE1IHNoIC1jIFwidW50aWwgZG9ja2VyIGluZm87IGRvIGVjaG8gLjsgc2xlZXAgMTsgZG9uZVwiJyA6ICcnLFxuICAgICAgICAgICAgJy9ob21lL3J1bm5lci9qb2ItcmVwb3J0ZXIuc2ggJHtSVU5ORVJfTkFNRX0nLFxuICAgICAgICAgICAgLy8gREVQUkVDQVRFRDogcmVtb3ZlIGluIDEuMC4wLiByZWdpc3RlcnMgdGhlIHJ1bm5lciBvZiBleGVjdXRpb25zIHRoYXQgc3RhcnRlZCBiZWZvcmUgSklUIHJ1bm5lcnMsIHdoaWNoIHBhc3MgYSByZWdpc3RyYXRpb24gdG9rZW4uXG4gICAgICAgICAgICAnaWYgWyBcIiR7UlVOTkVSX1ZFUlNJT059XCIgPSBcImxhdGVzdFwiIF07IHRoZW4gUlVOTkVSX0ZMQUdTPVwiXCI7IGVsc2UgUlVOTkVSX0ZMQUdTPVwiLS1kaXNhYmxldXBkYXRlXCI7IGZpJyxcbiAgICAgICAgICAgICdpZiBbIC16IFwiJHtSVU5ORVJfSklUX0NPTkZJR31cIiBdOyB0aGVuIHN1ZG8gLUh1IHJ1bm5lciAvaG9tZS9ydW5uZXIvY29uZmlnLnNoIC0tdW5hdHRlbmRlZCAtLXVybCBcIiR7UkVHSVNUUkFUSU9OX1VSTH1cIiAtLXRva2VuIFwiJHtSVU5ORVJfVE9LRU59XCIgLS1lcGhlbWVyYWwgLS13b3JrIF93b3JrIC0tbGFiZWxzIFwiJHtSVU5ORVJfTEFCRUx9LGNka2docjpzdGFydGVkOmBkYXRlICslc2BcIiAke1JVTk5FUl9GTEFHU30gLS1uYW1lIFwiJHtSVU5ORVJfTkFNRX1cIiAke1JVTk5FUl9HUk9VUDF9ICR7UlVOTkVSX0dST1VQMn0gJHtERUZBVUxUX0xBQkVMU307IGZpJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICBidWlsZDoge1xuICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAvLyBERVBSRUNBVEVEOiByZW1vdmUgdGhlIGVsc2UgYnJhbmNoIGluIDEuMC4wLiBpdCBydW5zIHRoZSBydW5uZXIgcmVnaXN0ZXJlZCB3aXRoIGEgcmVnaXN0cmF0aW9uIHRva2VuIGFib3ZlLlxuICAgICAgICAgICAgJ2lmIFsgLW4gXCIke1JVTk5FUl9KSVRfQ09ORklHfVwiIF07IHRoZW4gc3VkbyAtLXByZXNlcnZlLWVudj1BV1NfQ09OVEFJTkVSX0NSRURFTlRJQUxTX1JFTEFUSVZFX1VSSSxBV1NfREVGQVVMVF9SRUdJT04sQVdTX1JFR0lPTiAtSHUgcnVubmVyIC9ob21lL3J1bm5lci9ydW4uc2ggLS1qaXRjb25maWcgXCIke1JVTk5FUl9KSVRfQ09ORklHfVwiOyBlbHNlIHN1ZG8gLS1wcmVzZXJ2ZS1lbnY9QVdTX0NPTlRBSU5FUl9DUkVERU5USUFMU19SRUxBVElWRV9VUkksQVdTX0RFRkFVTFRfUkVHSU9OLEFXU19SRUdJT04gLUh1IHJ1bm5lciAvaG9tZS9ydW5uZXIvcnVuLnNoOyBmaScsXG4gICAgICAgICAgICAnU1RBVFVTPSQoZ3JlcCAtUGhvcnMgXCJmaW5pc2ggam9iIHJlcXVlc3QgZm9yIGpvYiBbMC05YS1mLV0rIHdpdGggcmVzdWx0OiAuKlwiIC9ob21lL3J1bm5lci9fZGlhZy8gfCB0YWlsIC1uMSB8IGF3ayBcXCd7cHJpbnQgJE5GfVxcJyknLFxuICAgICAgICAgICAgJ2lmIFsgLW4gXCIkU1RBVFVTXCIgXTsgdGhlbiBlY2hvIENES0dIQSBKT0IgRE9ORSBcIiRSVU5ORVJfTEFCRUxcIiBcIiRTVEFUVVNcIjsgZmknLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBjb25zdCBpbWFnZUJ1aWxkZXIgPSBwcm9wcz8uaW1hZ2VCdWlsZGVyID8/IENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcih0aGlzLCAnSW1hZ2UgQnVpbGRlcicpO1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZSA9IGltYWdlQnVpbGRlci5iaW5kRG9ja2VySW1hZ2UoKTtcblxuICAgIGlmIChpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgYnVpbGRTcGVjLnBoYXNlcy5pbnN0YWxsLmNvbW1hbmRzID0gW1xuICAgICAgICAnY2QgXFxcXGFjdGlvbnMnLFxuICAgICAgICAnJiAuL2pvYi1yZXBvcnRlci5wczEgXCIke0VudjpSVU5ORVJfTkFNRX1cIicsXG4gICAgICAgIC8vIERFUFJFQ0FURUQ6IHJlbW92ZSBpbiAxLjAuMC4gcmVnaXN0ZXJzIHRoZSBydW5uZXIgb2YgZXhlY3V0aW9ucyB0aGF0IHN0YXJ0ZWQgYmVmb3JlIEpJVCBydW5uZXJzLCB3aGljaCBwYXNzIGEgcmVnaXN0cmF0aW9uIHRva2VuLlxuICAgICAgICAnaWYgKCR7RW52OlJVTk5FUl9WRVJTSU9OfSAtZXEgXCJsYXRlc3RcIikgeyAkUnVubmVyRmxhZ3MgPSBcIlwiIH0gZWxzZSB7ICRSdW5uZXJGbGFncyA9IFwiLS1kaXNhYmxldXBkYXRlXCIgfScsXG4gICAgICAgICdpZiAoLW5vdCAke0VudjpSVU5ORVJfSklUX0NPTkZJR30pIHsgLi9jb25maWcuY21kIC0tdW5hdHRlbmRlZCAtLXVybCBcIiR7RW52OlJFR0lTVFJBVElPTl9VUkx9XCIgLS10b2tlbiBcIiR7RW52OlJVTk5FUl9UT0tFTn1cIiAtLWVwaGVtZXJhbCAtLXdvcmsgX3dvcmsgLS1sYWJlbHMgXCIke0VudjpSVU5ORVJfTEFCRUx9LGNka2docjpzdGFydGVkOiQoR2V0LURhdGUgLVVGb3JtYXQgJXMpXCIgJHtSdW5uZXJGbGFnc30gLS1uYW1lIFwiJHtFbnY6UlVOTkVSX05BTUV9XCIgJHtFbnY6UlVOTkVSX0dST1VQMX0gJHtFbnY6UlVOTkVSX0dST1VQMn0gJHtFbnY6REVGQVVMVF9MQUJFTFN9IH0nLFxuICAgICAgXTtcbiAgICAgIGJ1aWxkU3BlYy5waGFzZXMuYnVpbGQuY29tbWFuZHMgPSBbXG4gICAgICAgICdjZCBcXFxcYWN0aW9ucycsXG4gICAgICAgIC8vIERFUFJFQ0FURUQ6IHJlbW92ZSB0aGUgZWxzZSBicmFuY2ggaW4gMS4wLjAuIGl0IHJ1bnMgdGhlIHJ1bm5lciByZWdpc3RlcmVkIHdpdGggYSByZWdpc3RyYXRpb24gdG9rZW4gYWJvdmUuXG4gICAgICAgICdpZiAoJHtFbnY6UlVOTkVSX0pJVF9DT05GSUd9KSB7IC4vcnVuLmNtZCAtLWppdGNvbmZpZyBcIiR7RW52OlJVTk5FUl9KSVRfQ09ORklHfVwiIH0gZWxzZSB7IC4vcnVuLmNtZCB9JyxcbiAgICAgICAgJyRTVEFUVVMgPSBTZWxlY3QtU3RyaW5nIC1QYXRoIFxcJy4vX2RpYWcvKi5sb2dcXCcgLVBhdHRlcm4gXFwnZmluaXNoIGpvYiByZXF1ZXN0IGZvciBqb2IgWzAtOWEtZlxcXFwtXSsgd2l0aCByZXN1bHQ6ICguKilcXCcgfCAleyRfLk1hdGNoZXMuR3JvdXBzWzFdLlZhbHVlfSB8IFNlbGVjdC1PYmplY3QgLUxhc3QgMScsXG4gICAgICAgICdpZiAoJFNUQVRVUykgeyBlY2hvIFwiQ0RLR0hBIEpPQiBET05FICRcXHtFbnY6UlVOTkVSX0xBQkVMXFx9ICRTVEFUVVNcIiB9JyxcbiAgICAgIF07XG4gICAgfVxuXG4gICAgaWYgKHByb3BzPy5ncHUpIHtcbiAgICAgIGlmIChpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSB8fCBpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvZGVCdWlsZCBHUFUgaXMgb25seSBzdXBwb3J0ZWQgZm9yIExpbnV4IHg2NCBpbWFnZXMuIFNldCBncHU6IGZhbHNlIG9yIHVzZSBhIExpbnV4IHg2NCBpbWFnZS4nKTtcbiAgICAgIH1cbiAgICAgIGlmIChwcm9wcz8uY29tcHV0ZVR5cGUgIT09IHVuZGVmaW5lZCAmJiBwcm9wcy5jb21wdXRlVHlwZSAhPT0gQ29tcHV0ZVR5cGUuU01BTEwgJiYgcHJvcHMuY29tcHV0ZVR5cGUgIT09IENvbXB1dGVUeXBlLkxBUkdFKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ29kZUJ1aWxkIEdQVSBvbmx5IHN1cHBvcnRzIFNNQUxMICgxIEdQVSkgb3IgTEFSR0UgKDQgR1BVcykuIEdvdCAke3Byb3BzLmNvbXB1dGVUeXBlfS5gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBjaG9vc2UgYnVpbGQgaW1hZ2VcbiAgICBsZXQgYnVpbGRJbWFnZTogY29kZWJ1aWxkLklCdWlsZEltYWdlIHwgdW5kZWZpbmVkO1xuICAgIGlmIChpbWFnZS5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICBpZiAocHJvcHM/LmdwdSAmJiBpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgICAgYnVpbGRJbWFnZSA9IExpbnV4R3B1QnVpbGRJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShpbWFnZS5pbWFnZVJlcG9zaXRvcnksIGltYWdlLmltYWdlVGFnKTtcbiAgICAgIH0gZWxzZSBpZiAoaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgIGJ1aWxkSW1hZ2UgPSBjb2RlYnVpbGQuTGludXhCdWlsZEltYWdlLmZyb21FY3JSZXBvc2l0b3J5KGltYWdlLmltYWdlUmVwb3NpdG9yeSwgaW1hZ2UuaW1hZ2VUYWcpO1xuICAgICAgfSBlbHNlIGlmIChpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgICBidWlsZEltYWdlID0gY29kZWJ1aWxkLkxpbnV4QXJtQnVpbGRJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShpbWFnZS5pbWFnZVJlcG9zaXRvcnksIGltYWdlLmltYWdlVGFnKTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKGltYWdlLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICBpZiAoaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgIGJ1aWxkSW1hZ2UgPSBjb2RlYnVpbGQuV2luZG93c0J1aWxkSW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LCBpbWFnZS5pbWFnZVRhZywgY29kZWJ1aWxkLldpbmRvd3NJbWFnZVR5cGUuU0VSVkVSXzIwMTkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChidWlsZEltYWdlID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGZpbmQgc3VwcG9ydGVkIENvZGVCdWlsZCBpbWFnZSBmb3IgJHtpbWFnZS5vcy5uYW1lfS8ke2ltYWdlLmFyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgIH1cblxuICAgIC8vIGNyZWF0ZSBwcm9qZWN0XG4gICAgdGhpcy5sb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKFxuICAgICAgdGhpcyxcbiAgICAgICdMb2dzJyxcbiAgICAgIHtcbiAgICAgICAgcmV0ZW50aW9uOiBwcm9wcz8ubG9nUmV0ZW50aW9uID8/IFJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB9LFxuICAgICk7XG4gICAgdGhpcy5wcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5Qcm9qZWN0KFxuICAgICAgdGhpcyxcbiAgICAgICdDb2RlQnVpbGQnLFxuICAgICAge1xuICAgICAgICBkZXNjcmlwdGlvbjogYEdpdEh1YiBBY3Rpb25zIHNlbGYtaG9zdGVkIHJ1bm5lciBmb3IgbGFiZWxzICR7dGhpcy5sYWJlbHN9YCxcbiAgICAgICAgYnVpbGRTcGVjOiBjb2RlYnVpbGQuQnVpbGRTcGVjLmZyb21PYmplY3QoYnVpbGRTcGVjKSxcbiAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgICAgIHN1Ym5ldFNlbGVjdGlvbjogcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbixcbiAgICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQgPz8gRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgYnVpbGRJbWFnZSxcbiAgICAgICAgICBjb21wdXRlVHlwZTogcHJvcHM/LmNvbXB1dGVUeXBlID8/IENvbXB1dGVUeXBlLlNNQUxMLFxuICAgICAgICAgIHByaXZpbGVnZWQ6IHRoaXMuZGluZCAmJiAhaW1hZ2Uub3MuaXMoT3MuV0lORE9XUyksXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ2dpbmc6IHtcbiAgICAgICAgICBjbG91ZFdhdGNoOiB7XG4gICAgICAgICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgdGhpcy5ncmFudFByaW5jaXBhbCA9IHRoaXMucHJvamVjdC5ncmFudFByaW5jaXBhbDtcblxuICAgIC8vIGFsbG93IFNTTSBTZXNzaW9uIE1hbmFnZXIgYWNjZXNzXG4gICAgLy8gdGhpcy5wcm9qZWN0LnJvbGU/LmFkZFRvUHJpbmNpcGFsUG9saWN5KE1JTklNQUxfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UKTtcbiAgICAvLyBzdGVwIGZ1bmN0aW9uIHdvbid0IGxldCB1cyBwYXNzIGBkZWJ1Z1Nlc3Npb25FbmFibGVkOiB0cnVlYCB1bmxlc3Mgd2UgdXNlIGJhdGNoLCBzbyB3ZSBjYW4ndCB1c2UgdGhpc1xuICB9XG5cbiAgLyoqXG4gICAqIENvbmZpZyBmb3IgdGhlIHNoYXJlZCBDb2RlQnVpbGQgZnJhZ21lbnQuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgX3J1bm5lckNvbmZpZygpOiBDb2RlQnVpbGRSdW5uZXJDb25maWcge1xuICAgIHJldHVybiB7XG4gICAgICBmYW1pbHk6IENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyLl9GQU1JTFksXG4gICAgICBwcm92aWRlcjogdGhpcy5ub2RlLnBhdGgsXG4gICAgICBwcm9qZWN0TmFtZTogdGhpcy5wcm9qZWN0LnByb2plY3ROYW1lLFxuICAgICAgcnVubmVyR3JvdXA6IHRoaXMuZ3JvdXAgPz8gJycsXG4gICAgICBkZWZhdWx0TGFiZWxzOiBydW5uZXJEZWZhdWx0TGFiZWxzKHRoaXMuaW1hZ2Uub3MsIHRoaXMuaW1hZ2UuYXJjaGl0ZWN0dXJlLCB0aGlzLmRlZmF1bHRMYWJlbHMpLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lUm9sZTogaWFtLklHcmFudGFibGUpIHtcbiAgICBzdGF0ZU1hY2hpbmVSb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOlN0YXJ0QnVpbGQnLCAnY29kZWJ1aWxkOlN0b3BCdWlsZCcsICdjb2RlYnVpbGQ6QmF0Y2hHZXRCdWlsZHMnLCAnY29kZWJ1aWxkOkJhdGNoR2V0UmVwb3J0cyddLFxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5wcm9qZWN0LnByb2plY3RBcm5dLFxuICAgIH0pKTtcbiAgICAvLyBtYW5hZ2VkIHJ1bGUgZm9yIHRoZSBzdGFydEJ1aWxkLnN5bmMgaW50ZWdyYXRpb25cbiAgICAvLyBldmVyeSBDb2RlQnVpbGQgcHJvdmlkZXIgZW1pdHMgdGhlIHNhbWUgc3RhdGVtZW50IHNvIHBvbGljeSBtaW5pbWl6YXRpb24ga2VlcHMganVzdCBvbmVcbiAgICBzdGF0ZU1hY2hpbmVSb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZXZlbnRzOlB1dFRhcmdldHMnLCAnZXZlbnRzOlB1dFJ1bGUnLCAnZXZlbnRzOkRlc2NyaWJlUnVsZSddLFxuICAgICAgcmVzb3VyY2VzOiBbU3RhY2sub2YodGhpcykuZm9ybWF0QXJuKHtcbiAgICAgICAgc2VydmljZTogJ2V2ZW50cycsXG4gICAgICAgIHJlc291cmNlOiAncnVsZScsXG4gICAgICAgIHJlc291cmNlTmFtZTogJ1N0ZXBGdW5jdGlvbnNHZXRFdmVudEZvckNvZGVCdWlsZFN0YXJ0QnVpbGRSdWxlJyxcbiAgICAgICAgYXJuRm9ybWF0OiBBcm5Gb3JtYXQuU0xBU0hfUkVTT1VSQ0VfTkFNRSxcbiAgICAgIH0pXSxcbiAgICB9KSk7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfc3RhdHVzKHN0YXR1c0Z1bmN0aW9uUm9sZTogaWFtLklHcmFudGFibGUpOiBJUnVubmVyUHJvdmlkZXJTdGF0dXMge1xuICAgIHRoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LmdyYW50KHN0YXR1c0Z1bmN0aW9uUm9sZSwgJ2VjcjpEZXNjcmliZUltYWdlcycpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIGxhYmVsczogdGhpcy5sYWJlbHMsXG4gICAgICBjb25zdHJ1Y3RQYXRoOiB0aGlzLm5vZGUucGF0aCxcbiAgICAgIHZwY0FybjogdGhpcy52cGM/LnZwY0FybixcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzPy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIHJvbGVBcm46IHRoaXMucHJvamVjdC5yb2xlPy5yb2xlQXJuLFxuICAgICAgbG9nR3JvdXA6IHRoaXMubG9nR3JvdXAubG9nR3JvdXBOYW1lLFxuICAgICAgaW1hZ2U6IHtcbiAgICAgICAgaW1hZ2VSZXBvc2l0b3J5OiB0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgICBpbWFnZVRhZzogdGhpcy5pbWFnZS5pbWFnZVRhZyxcbiAgICAgICAgaW1hZ2VCdWlsZGVyTG9nR3JvdXA6IHRoaXMuaW1hZ2UubG9nR3JvdXA/LmxvZ0dyb3VwTmFtZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbmV0d29yayBjb25uZWN0aW9ucyBhc3NvY2lhdGVkIHdpdGggdGhpcyByZXNvdXJjZS5cbiAgICovXG4gIHB1YmxpYyBnZXQgY29ubmVjdGlvbnMoKTogZWMyLkNvbm5lY3Rpb25zIHtcbiAgICByZXR1cm4gdGhpcy5wcm9qZWN0LmNvbm5lY3Rpb25zO1xuICB9XG59XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBDb2RlQnVpbGRSdW5uZXJQcm92aWRlcn1cbiAqL1xuZXhwb3J0IGNsYXNzIENvZGVCdWlsZFJ1bm5lciBleHRlbmRzIENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyIHtcbn1cbiJdfQ==