"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeBuildRunner = exports.CodeBuildRunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const path = require("path");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_codebuild_1 = require("aws-cdk-lib/aws-codebuild");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_stepfunctions_1 = require("aws-cdk-lib/aws-stepfunctions");
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
    constructor(scope, id, props) {
        super(scope, id, props);
        this.retryableErrors = [
            'CodeBuild.CodeBuildException',
            'CodeBuild.AccountLimitExceededException',
        ];
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
                    RUNNER_TOKEN: 'unspecified',
                    RUNNER_NAME: 'unspecified',
                    RUNNER_LABEL: 'unspecified',
                    OWNER: 'unspecified',
                    REPO: 'unspecified',
                    GITHUB_DOMAIN: 'github.com',
                    REGISTRATION_URL: 'unspecified',
                    RUNNER_GROUP1: '',
                    RUNNER_GROUP2: '',
                    DEFAULT_LABELS: '',
                    JIT_CONFIG: '',
                },
            },
            phases: {
                install: {
                    commands: [
                        this.dind ? 'nohup dockerd --host=unix:///var/run/docker.sock --host=tcp://127.0.0.1:2375 --storage-driver=overlay2 &' : '',
                        this.dind ? 'timeout 15 sh -c "until docker info; do echo .; sleep 1; done"' : '',
                        'if [ -n "${JIT_CONFIG}" ]; then echo "JIT mode enabled, skipping config.sh"; else if [ "${RUNNER_VERSION}" = "latest" ]; then RUNNER_FLAGS=""; else RUNNER_FLAGS="--disableupdate"; fi && sudo -Hu runner /home/runner/config.sh --unattended --url "${REGISTRATION_URL}" --token "${RUNNER_TOKEN}" --ephemeral --work _work --labels "${RUNNER_LABEL},cdkghr:started:`date +%s`" ${RUNNER_FLAGS} --name "${RUNNER_NAME}" ${RUNNER_GROUP1} ${RUNNER_GROUP2} ${DEFAULT_LABELS}; fi',
                    ],
                },
                build: {
                    commands: [
                        'if [ -n "${JIT_CONFIG}" ]; then sudo --preserve-env=AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,AWS_DEFAULT_REGION,AWS_REGION -Hu runner /home/runner/run.sh --jitconfig "${JIT_CONFIG}"; else sudo --preserve-env=AWS_CONTAINER_CREDENTIALS_RELATIVE_URI,AWS_DEFAULT_REGION,AWS_REGION -Hu runner /home/runner/run.sh; fi',
                        'STATUS=$(grep -Phors "finish job request for job [0-9a-f-]+ with result: .*" /home/runner/_diag/ | tail -n1 | awk \'{print $NF}\')',
                        '[ -n "$STATUS" ] && echo CDKGHA JOB DONE "$RUNNER_LABEL" "$STATUS"',
                    ],
                },
            },
        };
        const imageBuilder = props?.imageBuilder ?? CodeBuildRunnerProvider.imageBuilder(this, 'Image Builder');
        const image = this.image = imageBuilder.bindDockerImage();
        if (image.os.is(common_1.Os.WINDOWS)) {
            buildSpec.phases.install.commands = [
                'cd \\actions',
                'if (${Env:RUNNER_VERSION} -eq "latest") { $RunnerFlags = "" } else { $RunnerFlags = "--disableupdate" }',
                './config.cmd --unattended --url "${Env:REGISTRATION_URL}" --token "${Env:RUNNER_TOKEN}" --ephemeral --work _work --labels "${Env:RUNNER_LABEL},cdkghr:started:$(Get-Date -UFormat %s)" ${RunnerFlags} --name "${Env:RUNNER_NAME}" ${Env:RUNNER_GROUP1} ${Env:RUNNER_GROUP2} ${Env:DEFAULT_LABELS}',
            ];
            buildSpec.phases.build.commands = [
                'cd \\actions',
                './run.cmd',
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
     * Generate step function task(s) to start a new runner.
     *
     * Called by GithubRunners and shouldn't be called manually.
     *
     * @param parameters workflow job details
     */
    getStepFunctionTask(parameters) {
        return new aws_cdk_lib_1.aws_stepfunctions_tasks.CodeBuildStartBuild(this, 'State', {
            stateName: (0, common_1.generateStateName)(this),
            integrationPattern: aws_stepfunctions_1.IntegrationPattern.RUN_JOB, // sync
            project: this.project,
            environmentVariablesOverride: {
                RUNNER_TOKEN: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: parameters.runnerTokenPath,
                },
                JIT_CONFIG: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: parameters.jitConfigPath,
                },
                RUNNER_NAME: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: parameters.runnerNamePath,
                },
                RUNNER_LABEL: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: parameters.labelsPath,
                },
                RUNNER_GROUP1: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: this.group ? '--runnergroup' : '',
                },
                RUNNER_GROUP2: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: this.group ? this.group : '',
                },
                DEFAULT_LABELS: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: this.defaultLabels ? '' : '--no-default-labels',
                },
                GITHUB_DOMAIN: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: parameters.githubDomainPath,
                },
                OWNER: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: parameters.ownerPath,
                },
                REPO: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: parameters.repoPath,
                },
                REGISTRATION_URL: {
                    type: aws_cdk_lib_1.aws_codebuild.BuildEnvironmentVariableType.PLAINTEXT,
                    value: parameters.registrationUrl,
                },
            },
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
_a = JSII_RTTI_SYMBOL_1;
CodeBuildRunnerProvider[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.CodeBuildRunnerProvider", version: "0.0.0" };
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
CodeBuildRunnerProvider.LINUX_X64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'codebuild', 'linux-x64');
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
CodeBuildRunnerProvider.LINUX_ARM64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'codebuild', 'linux-arm64');
/**
 * @deprecated use {@link CodeBuildRunnerProvider}
 */
class CodeBuildRunner extends CodeBuildRunnerProvider {
}
exports.CodeBuildRunner = CodeBuildRunner;
_b = JSII_RTTI_SYMBOL_1;
CodeBuildRunner[_b] = { fqn: "@cloudsnorkel/cdk-github-runners.CodeBuildRunner", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWJ1aWxkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9jb2RlYnVpbGQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSw2QkFBNkI7QUFDN0IsNkNBVXFCO0FBQ3JCLDZEQUE0RTtBQUM1RSxtREFBcUQ7QUFDckQscUVBQW1FO0FBRW5FLHFDQVdrQjtBQUNsQixzREFBMkg7QUFtSTNIOzs7Ozs7R0FNRztBQUNILE1BQWEsdUJBQXdCLFNBQVEscUJBQVk7SUErQnZEOzs7Ozs7Ozs7Ozs7Ozs7OztPQWlCRztJQUNJLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBK0I7UUFDdEYsT0FBTyxtQ0FBa0IsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUN2QyxFQUFFLEVBQUUsV0FBRSxDQUFDLFlBQVk7WUFDbkIsWUFBWSxFQUFFLHFCQUFZLENBQUMsTUFBTTtZQUNqQyxVQUFVLEVBQUU7Z0JBQ1YscUNBQW9CLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3ZDLHFDQUFvQixDQUFDLFVBQVUsRUFBRTtnQkFDakMscUNBQW9CLENBQUMsR0FBRyxFQUFFO2dCQUMxQixxQ0FBb0IsQ0FBQyxTQUFTLEVBQUU7Z0JBQ2hDLHFDQUFvQixDQUFDLE1BQU0sRUFBRTtnQkFDN0IscUNBQW9CLENBQUMsTUFBTSxFQUFFO2dCQUM3QixxQ0FBb0IsQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLGFBQWEsSUFBSSxzQkFBYSxDQUFDLE1BQU0sRUFBRSxDQUFDO2FBQ2xGO1lBQ0QsR0FBRyxLQUFLO1NBQ1QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQTBDRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9DO1FBQzVFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBWmpCLG9CQUFlLEdBQUc7WUFDekIsOEJBQThCO1lBQzlCLHlDQUF5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YXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHtcbiAgQW5ub3RhdGlvbnMsXG4gIGF3c19jb2RlYnVpbGQgYXMgY29kZWJ1aWxkLFxuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMsXG4gIGF3c19zdGVwZnVuY3Rpb25zX3Rhc2tzIGFzIHN0ZXBmdW5jdGlvbnNfdGFza3MsXG4gIER1cmF0aW9uLFxuICBSZW1vdmFsUG9saWN5LFxufSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb21wdXRlVHlwZSwgTGludXhHcHVCdWlsZEltYWdlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgSW50ZWdyYXRpb25QYXR0ZXJuIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLXN0ZXBmdW5jdGlvbnMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQge1xuICBBcmNoaXRlY3R1cmUsXG4gIEJhc2VQcm92aWRlcixcbiAgZ2VuZXJhdGVTdGF0ZU5hbWUsXG4gIElSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyU3RhdHVzLFxuICBJUnVubmVyUnVudGltZVBhcmFtZXRlcnMsXG4gIE9zLFxuICBSdW5uZXJJbWFnZSxcbiAgUnVubmVyUHJvdmlkZXJQcm9wcyxcbiAgUnVubmVyVmVyc2lvbixcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgSVJ1bm5lckltYWdlQnVpbGRlciwgUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcywgUnVubmVySW1hZ2VDb21wb25lbnQgfSBmcm9tICcuLi9pbWFnZS1idWlsZGVycyc7XG5cblxuZXhwb3J0IGludGVyZmFjZSBDb2RlQnVpbGRSdW5uZXJQcm92aWRlclByb3BzIGV4dGVuZHMgUnVubmVyUHJvdmlkZXJQcm9wcyB7XG4gIC8qKlxuICAgKiBSdW5uZXIgaW1hZ2UgYnVpbGRlciB1c2VkIHRvIGJ1aWxkIERvY2tlciBpbWFnZXMgY29udGFpbmluZyBHaXRIdWIgUnVubmVyIGFuZCBhbGwgcmVxdWlyZW1lbnRzLlxuICAgKlxuICAgKiBUaGUgaW1hZ2UgYnVpbGRlciBtdXN0IGNvbnRhaW4gdGhlIHtAbGluayBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXJ9IGNvbXBvbmVudCB1bmxlc3MgYGRvY2tlckluRG9ja2VyYCBpcyBzZXQgdG8gZmFsc2UuXG4gICAqXG4gICAqIFRoZSBpbWFnZSBidWlsZGVyIGRldGVybWluZXMgdGhlIE9TIGFuZCBhcmNoaXRlY3R1cmUgb2YgdGhlIHJ1bm5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKClcbiAgICovXG4gIHJlYWRvbmx5IGltYWdlQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVsIHVzZWQgZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZFxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIGxhYmVsc30gaW5zdGVhZFxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWw/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2NvZGVidWlsZCddXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgcnVubmVyIGdyb3VwIG5hbWUuXG4gICAqXG4gICAqIElmIHNwZWNpZmllZCwgdGhlIHJ1bm5lciB3aWxsIGJlIHJlZ2lzdGVyZWQgd2l0aCB0aGlzIGdyb3VwIG5hbWUuIFNldHRpbmcgYSBydW5uZXIgZ3JvdXAgY2FuIGhlbHAgbWFuYWdpbmcgYWNjZXNzIHRvIHNlbGYtaG9zdGVkIHJ1bm5lcnMuIEl0XG4gICAqIHJlcXVpcmVzIGEgcGFpZCBHaXRIdWIgYWNjb3VudC5cbiAgICpcbiAgICogVGhlIGdyb3VwIG11c3QgZXhpc3Qgb3IgdGhlIHJ1bm5lciB3aWxsIG5vdCBzdGFydC5cbiAgICpcbiAgICogVXNlcnMgd2lsbCBzdGlsbCBiZSBhYmxlIHRvIHRyaWdnZXIgdGhpcyBydW5uZXIgd2l0aCB0aGUgY29ycmVjdCBsYWJlbHMuIEJ1dCB0aGUgcnVubmVyIHdpbGwgb25seSBiZSBhYmxlIHRvIHJ1biBqb2JzIGZyb20gcmVwb3MgYWxsb3dlZCB0byB1c2UgdGhlIGdyb3VwLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBWUEMgdG8gbGF1bmNoIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBubyBWUENcbiAgICovXG4gIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cCB0byBhc3NpZ24gdG8gdGhpcyBpbnN0YW5jZS5cbiAgICpcbiAgICogQGRlZmF1bHQgcHVibGljIHByb2plY3Qgd2l0aCBubyBzZWN1cml0eSBncm91cFxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIHNlY3VyaXR5R3JvdXBzfVxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cD86IGVjMi5JU2VjdXJpdHlHcm91cDtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXBzIHRvIGFzc2lnbiB0byB0aGlzIGluc3RhbmNlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBzZWN1cml0eSBncm91cCwgaWYge0BsaW5rIHZwY30gaXMgdXNlZFxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogV2hlcmUgdG8gcGxhY2UgdGhlIG5ldHdvcmsgaW50ZXJmYWNlcyB3aXRoaW4gdGhlIFZQQy5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gc3VibmV0XG4gICAqL1xuICByZWFkb25seSBzdWJuZXRTZWxlY3Rpb24/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBUaGUgdHlwZSBvZiBjb21wdXRlIHRvIHVzZSBmb3IgdGhpcyBidWlsZC5cbiAgICogU2VlIHRoZSB7QGxpbmsgQ29tcHV0ZVR5cGV9IGVudW0gZm9yIHRoZSBwb3NzaWJsZSB2YWx1ZXMuXG4gICAqXG4gICAqIFRoZSBjb21wdXRlIHR5cGUgZGV0ZXJtaW5lcyBDUFUsIG1lbW9yeSwgYW5kIGRpc2sgc3BhY2U6XG4gICAqIC0gU01BTEw6IDIgdkNQVSwgMyBHQiBSQU0sIDY0IEdCIGRpc2tcbiAgICogLSBNRURJVU06IDQgdkNQVSwgNyBHQiBSQU0sIDEyOCBHQiBkaXNrXG4gICAqIC0gTEFSR0U6IDggdkNQVSwgMTUgR0IgUkFNLCAxMjggR0IgZGlza1xuICAgKiAtIFgyX0xBUkdFOiA3MiB2Q1BVLCAxNDUgR0IgUkFNLCAyNTYgR0IgZGlzayAoTGludXgpIG9yIDgyNCBHQiBkaXNrIChXaW5kb3dzKVxuICAgKlxuICAgKiBVc2UgYSBsYXJnZXIgY29tcHV0ZSB0eXBlIHdoZW4geW91IG5lZWQgbW9yZSBkaXNrIHNwYWNlIGZvciBidWlsZGluZyBsYXJnZXIgRG9ja2VyIGltYWdlcy5cbiAgICpcbiAgICogRm9yIG1vcmUgZGV0YWlscywgc2VlIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9jb2RlYnVpbGQvbGF0ZXN0L3VzZXJndWlkZS9idWlsZC1lbnYtcmVmLWNvbXB1dGUtdHlwZXMuaHRtbCNlbnZpcm9ubWVudC50eXBlc1xuICAgKlxuICAgKiBAZGVmYXVsdCB7QGxpbmsgQ29tcHV0ZVR5cGUjU01BTEx9XG4gICAqL1xuICByZWFkb25seSBjb21wdXRlVHlwZT86IGNvZGVidWlsZC5Db21wdXRlVHlwZTtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBtaW51dGVzIGFmdGVyIHdoaWNoIEFXUyBDb2RlQnVpbGQgc3RvcHMgdGhlIGJ1aWxkIGlmIGl0J3NcbiAgICogbm90IGNvbXBsZXRlLiBGb3IgdmFsaWQgdmFsdWVzLCBzZWUgdGhlIHRpbWVvdXRJbk1pbnV0ZXMgZmllbGQgaW4gdGhlIEFXU1xuICAgKiBDb2RlQnVpbGQgVXNlciBHdWlkZS5cbiAgICpcbiAgICogQGRlZmF1bHQgRHVyYXRpb24uaG91cnMoMSlcbiAgICovXG4gIHJlYWRvbmx5IHRpbWVvdXQ/OiBEdXJhdGlvbjtcblxuICAvKipcbiAgICogU3VwcG9ydCBidWlsZGluZyBhbmQgcnVubmluZyBEb2NrZXIgaW1hZ2VzIGJ5IGVuYWJsaW5nIERvY2tlci1pbi1Eb2NrZXIgKGRpbmQpIGFuZCB0aGUgcmVxdWlyZWQgQ29kZUJ1aWxkIHByaXZpbGVnZWQgbW9kZS4gRGlzYWJsaW5nIHRoaXMgY2FuXG4gICAqIHNwZWVkIHVwIHByb3Zpc2lvbmluZyBvZiBDb2RlQnVpbGQgcnVubmVycy4gSWYgeW91IGRvbid0IGludGVuZCBvbiBydW5uaW5nIG9yIGJ1aWxkaW5nIERvY2tlciBpbWFnZXMsIGRpc2FibGUgdGhpcyBmb3IgZmFzdGVyIHN0YXJ0LXVwIHRpbWVzLlxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBkb2NrZXJJbkRvY2tlcj86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFVzZSBHUFUgY29tcHV0ZSBmb3IgYnVpbGRzLiBXaGVuIGVuYWJsZWQsIHRoZSBkZWZhdWx0IGNvbXB1dGUgdHlwZSBpcyBCVUlMRF9HRU5FUkFMMV9TTUFMTCAoNCB2Q1BVLCAxNiBHQiBSQU0sIDEgTlZJRElBIEExMEcgR1BVKS5cbiAgICpcbiAgICogWW91IGNhbiBvdmVycmlkZSB0aGUgY29tcHV0ZSB0eXBlIHVzaW5nIHRoZSBgY29tcHV0ZVR5cGVgIHByb3BlcnR5IChmb3IgZXhhbXBsZSwgdG8gdXNlIEJVSUxEX0dFTkVSQUwxX0xBUkdFIGZvciBtb3JlIHJlc291cmNlcyksXG4gICAqIHN1YmplY3QgdG8gdGhlIHN1cHBvcnRlZCBHUFUgY29tcHV0ZSB0eXBlcy5cbiAgICpcbiAgICogV2hlbiB1c2luZyBHUFUgY29tcHV0ZSwgZW5zdXJlIHlvdXIgcnVubmVyIGltYWdlIGluY2x1ZGVzIGFueSByZXF1aXJlZCBHUFUgbGlicmFyaWVzIChmb3IgZXhhbXBsZSwgQ1VEQSlcbiAgICogZWl0aGVyIGJ5IHVzaW5nIGEgYmFzZSBpbWFnZSB0aGF0IGhhcyB0aGVtIHByZWluc3RhbGxlZCAoc3VjaCBhcyBhbiBhcHByb3ByaWF0ZSBudmlkaWEvY3VkYSBpbWFnZSkgb3IgYnlcbiAgICogYWRkaW5nIGltYWdlIGNvbXBvbmVudHMgdGhhdCBpbnN0YWxsIHRoZW0uIFRoZSBkZWZhdWx0IGltYWdlIGJ1aWxkZXIgZG9lcyBub3QgYXV0b21hdGljYWxseSBzd2l0Y2ggdG8gYVxuICAgKiBDVURBLWVuYWJsZWQgYmFzZSBpbWFnZSB3aGVuIEdQVSBpcyBlbmFibGVkLlxuICAgKlxuICAgKiBHUFUgY29tcHV0ZSBpcyBvbmx5IGF2YWlsYWJsZSBmb3IgTGludXggeDY0IGltYWdlcy4gTm90IHN1cHBvcnRlZCBvbiBXaW5kb3dzIG9yIEFSTS5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGdwdT86IGJvb2xlYW47XG59XG5cbi8qKlxuICogR2l0SHViIEFjdGlvbnMgcnVubmVyIHByb3ZpZGVyIHVzaW5nIENvZGVCdWlsZCB0byBleGVjdXRlIGpvYnMuXG4gKlxuICogQ3JlYXRlcyBhIHByb2plY3QgdGhhdCBnZXRzIHN0YXJ0ZWQgZm9yIGVhY2ggam9iLlxuICpcbiAqIFRoaXMgY29uc3RydWN0IGlzIG5vdCBtZWFudCB0byBiZSB1c2VkIGJ5IGl0c2VsZi4gSXQgc2hvdWxkIGJlIHBhc3NlZCBpbiB0aGUgcHJvdmlkZXJzIHByb3BlcnR5IGZvciBHaXRIdWJSdW5uZXJzLlxuICovXG5leHBvcnQgY2xhc3MgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIgZXh0ZW5kcyBCYXNlUHJvdmlkZXIgaW1wbGVtZW50cyBJUnVubmVyUHJvdmlkZXIge1xuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCB4NjQgd2l0aCBhbGwgdGhlIHJlcXVpcmVtZW50cyBmb3IgQ29kZUJ1aWxkIHJ1bm5lci4gVXNlIHRoaXMgRG9ja2VyZmlsZSB1bmxlc3MgeW91IG5lZWQgdG8gY3VzdG9taXplIGl0IGZ1cnRoZXIgdGhhbiBhbGxvd2VkIGJ5IGhvb2tzLlxuICAgKlxuICAgKiBBdmFpbGFibGUgYnVpbGQgYXJndW1lbnRzIHRoYXQgY2FuIGJlIHNldCBpbiB0aGUgaW1hZ2UgYnVpbGRlcjpcbiAgICogKiBgQkFTRV9JTUFHRWAgc2V0cyB0aGUgYEZST01gIGxpbmUuIFRoaXMgc2hvdWxkIGJlIGFuIFVidW50dSBjb21wYXRpYmxlIGltYWdlLlxuICAgKiAqIGBFWFRSQV9QQUNLQUdFU2AgY2FuIGJlIHVzZWQgdG8gaW5zdGFsbCBhZGRpdGlvbmFsIHBhY2thZ2VzLlxuICAgKiAqIGBET0NLRVJfQ0hBTk5FTGAgb3ZlcnJpZGVzIHRoZSBjaGFubmVsIGZyb20gd2hpY2ggRG9ja2VyIHdpbGwgYmUgZG93bmxvYWRlZC4gRGVmYXVsdHMgdG8gYFwic3RhYmxlXCJgLlxuICAgKiAqIGBESU5EX0NPTU1JVGAgb3ZlcnJpZGVzIHRoZSBjb21taXQgd2hlcmUgZGluZCBpcyBmb3VuZC5cbiAgICogKiBgRE9DS0VSX1ZFUlNJT05gIG92ZXJyaWRlcyB0aGUgaW5zdGFsbGVkIERvY2tlciB2ZXJzaW9uLlxuICAgKiAqIGBET0NLRVJfQ09NUE9TRV9WRVJTSU9OYCBvdmVycmlkZXMgdGhlIGluc3RhbGxlZCBkb2NrZXItY29tcG9zZSB2ZXJzaW9uLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGltYWdlQnVpbGRlcigpYCBpbnN0ZWFkLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9YNjRfRE9DS0VSRklMRV9QQVRIID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Fzc2V0cycsICdkb2NrZXItaW1hZ2VzJywgJ2NvZGVidWlsZCcsICdsaW51eC14NjQnKTtcblxuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCBBUk02NCB3aXRoIGFsbCB0aGUgcmVxdWlyZW1lbnRzIGZvciBDb2RlQnVpbGQgcnVubmVyLiBVc2UgdGhpcyBEb2NrZXJmaWxlIHVubGVzcyB5b3UgbmVlZCB0byBjdXN0b21pemUgaXQgZnVydGhlciB0aGFuIGFsbG93ZWQgYnkgaG9va3MuXG4gICAqXG4gICAqIEF2YWlsYWJsZSBidWlsZCBhcmd1bWVudHMgdGhhdCBjYW4gYmUgc2V0IGluIHRoZSBpbWFnZSBidWlsZGVyOlxuICAgKiAqIGBCQVNFX0lNQUdFYCBzZXRzIHRoZSBgRlJPTWAgbGluZS4gVGhpcyBzaG91bGQgYmUgYW4gVWJ1bnR1IGNvbXBhdGlibGUgaW1hZ2UuXG4gICAqICogYEVYVFJBX1BBQ0tBR0VTYCBjYW4gYmUgdXNlZCB0byBpbnN0YWxsIGFkZGl0aW9uYWwgcGFja2FnZXMuXG4gICAqICogYERPQ0tFUl9DSEFOTkVMYCBvdmVycmlkZXMgdGhlIGNoYW5uZWwgZnJvbSB3aGljaCBEb2NrZXIgd2lsbCBiZSBkb3dubG9hZGVkLiBEZWZhdWx0cyB0byBgXCJzdGFibGVcImAuXG4gICAqICogYERJTkRfQ09NTUlUYCBvdmVycmlkZXMgdGhlIGNvbW1pdCB3aGVyZSBkaW5kIGlzIGZvdW5kLlxuICAgKiAqIGBET0NLRVJfVkVSU0lPTmAgb3ZlcnJpZGVzIHRoZSBpbnN0YWxsZWQgRG9ja2VyIHZlcnNpb24uXG4gICAqICogYERPQ0tFUl9DT01QT1NFX1ZFUlNJT05gIG92ZXJyaWRlcyB0aGUgaW5zdGFsbGVkIGRvY2tlci1jb21wb3NlIHZlcnNpb24uXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFVzZSBgaW1hZ2VCdWlsZGVyKClgIGluc3RlYWQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IExJTlVYX0FSTTY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdjb2RlYnVpbGQnLCAnbGludXgtYXJtNjQnKTtcblxuICAvKipcbiAgICogQ3JlYXRlIG5ldyBpbWFnZSBidWlsZGVyIHRoYXQgYnVpbGRzIENvZGVCdWlsZCBzcGVjaWZpYyBydW5uZXIgaW1hZ2VzLlxuICAgKlxuICAgKiBZb3UgY2FuIGN1c3RvbWl6ZSB0aGUgT1MsIGFyY2hpdGVjdHVyZSwgVlBDLCBzdWJuZXQsIHNlY3VyaXR5IGdyb3VwcywgZXRjLiBieSBwYXNzaW5nIGluIHByb3BzLlxuICAgKlxuICAgKiBZb3UgY2FuIGFkZCBjb21wb25lbnRzIHRvIHRoZSBpbWFnZSBidWlsZGVyIGJ5IGNhbGxpbmcgYGltYWdlQnVpbGRlci5hZGRDb21wb25lbnQoKWAuXG4gICAqXG4gICAqIFRoZSBkZWZhdWx0IE9TIGlzIFVidW50dSBydW5uaW5nIG9uIHg2NCBhcmNoaXRlY3R1cmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNvbXBvbmVudHM6XG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcigpYFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcykge1xuICAgIHJldHVybiBSdW5uZXJJbWFnZUJ1aWxkZXIubmV3KHNjb3BlLCBpZCwge1xuICAgICAgb3M6IE9zLkxJTlVYX1VCVU5UVSxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGNvbXBvbmVudHM6IFtcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcigpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIocHJvcHM/LnJ1bm5lclZlcnNpb24gPz8gUnVubmVyVmVyc2lvbi5sYXRlc3QoKSksXG4gICAgICBdLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ29kZUJ1aWxkIHByb2plY3QgaG9zdGluZyB0aGUgcnVubmVyLlxuICAgKi9cbiAgcmVhZG9ubHkgcHJvamVjdDogY29kZWJ1aWxkLlByb2plY3Q7XG5cbiAgLyoqXG4gICAqIExhYmVscyBhc3NvY2lhdGVkIHdpdGggdGhpcyBwcm92aWRlci5cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVsczogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEdyYW50IHByaW5jaXBhbCB1c2VkIHRvIGFkZCBwZXJtaXNzaW9ucyB0byB0aGUgcnVubmVyIHJvbGUuXG4gICAqL1xuICByZWFkb25seSBncmFudFByaW5jaXBhbDogaWFtLklQcmluY2lwYWw7XG5cbiAgLyoqXG4gICAqIERvY2tlciBpbWFnZSBsb2FkZWQgd2l0aCBHaXRIdWIgQWN0aW9ucyBSdW5uZXIgYW5kIGl0cyBwcmVyZXF1aXNpdGVzLiBUaGUgaW1hZ2UgaXMgYnVpbHQgYnkgYW4gaW1hZ2UgYnVpbGRlciBhbmQgaXMgc3BlY2lmaWMgdG8gQ29kZUJ1aWxkLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBUaGlzIGZpZWxkIGlzIGludGVybmFsIGFuZCBzaG91bGQgbm90IGJlIGFjY2Vzc2VkIGRpcmVjdGx5LlxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2U6IFJ1bm5lckltYWdlO1xuXG4gIC8qKlxuICAgKiBMb2cgZ3JvdXAgd2hlcmUgcHJvdmlkZWQgcnVubmVycyB3aWxsIHNhdmUgdGhlaXIgbG9ncy5cbiAgICpcbiAgICogTm90ZSB0aGF0IHRoaXMgaXMgbm90IHRoZSBqb2IgbG9nLCBidXQgdGhlIHJ1bm5lciBpdHNlbGYuIEl0IHdpbGwgbm90IGNvbnRhaW4gb3V0cHV0IGZyb20gdGhlIEdpdEh1YiBBY3Rpb24gYnV0IG9ubHkgbWV0YWRhdGEgb24gaXRzIGV4ZWN1dGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwOiBsb2dzLklMb2dHcm91cDtcblxuICByZWFkb25seSByZXRyeWFibGVFcnJvcnMgPSBbXG4gICAgJ0NvZGVCdWlsZC5Db2RlQnVpbGRFeGNlcHRpb24nLFxuICAgICdDb2RlQnVpbGQuQWNjb3VudExpbWl0RXhjZWVkZWRFeGNlcHRpb24nLFxuICBdO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgZ3JvdXA/OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBkaW5kOiBib29sZWFuO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBDb2RlQnVpbGRSdW5uZXJQcm92aWRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyB3YXJuIGFnYWluc3QgaXNvbGF0ZWQgbmV0d29ya3NcbiAgICBpZiAocHJvcHM/LnN1Ym5ldFNlbGVjdGlvbj8uc3VibmV0VHlwZSA9PSBlYzIuU3VibmV0VHlwZS5QUklWQVRFX0lTT0xBVEVEKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdQcml2YXRlIGlzb2xhdGVkIHN1Ym5ldHMgY2Fubm90IHB1bGwgZnJvbSBwdWJsaWMgRUNSIGFuZCBWUEMgZW5kcG9pbnQgaXMgbm90IHN1cHBvcnRlZCB5ZXQuICcgK1xuICAgICAgICAnU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvY29udGFpbmVycy1yb2FkbWFwL2lzc3Vlcy8xMTYwJyk7XG4gICAgfVxuXG4gICAgLy8gZXJyb3Igb3V0IG9uIG5vLW5hdCBuZXR3b3JrcyBiZWNhdXNlIHRoZSBidWlsZCB3aWxsIGhhbmdcbiAgICBpZiAocHJvcHM/LnN1Ym5ldFNlbGVjdGlvbj8uc3VibmV0VHlwZSA9PSBlYzIuU3VibmV0VHlwZS5QVUJMSUMpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdQdWJsaWMgc3VibmV0cyBkbyBub3Qgd29yayB3aXRoIENvZGVCdWlsZCBhcyBpdCBjYW5ub3QgYmUgYXNzaWduZWQgYW4gSVAuICcgK1xuICAgICAgICAnU2VlIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9jb2RlYnVpbGQvbGF0ZXN0L3VzZXJndWlkZS92cGMtc3VwcG9ydC5odG1sI2Jlc3QtcHJhY3RpY2VzLWZvci12cGNzJyk7XG4gICAgfVxuXG4gICAgdGhpcy5sYWJlbHMgPSB0aGlzLmxhYmVsc0Zyb21Qcm9wZXJ0aWVzKCdjb2RlYnVpbGQnLCBwcm9wcz8ubGFiZWwsIHByb3BzPy5sYWJlbHMpO1xuICAgIHRoaXMuZ3JvdXAgPSBwcm9wcz8uZ3JvdXA7XG4gICAgdGhpcy52cGMgPSBwcm9wcz8udnBjO1xuICAgIGlmIChwcm9wcz8uc2VjdXJpdHlHcm91cCkge1xuICAgICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IFtwcm9wcy5zZWN1cml0eUdyb3VwXTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKHByb3BzPy5zZWN1cml0eUdyb3Vwcykge1xuICAgICAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gcHJvcHMuc2VjdXJpdHlHcm91cHM7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy52cGMpIHtcbiAgICAgICAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gW25ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnU0cnLCB7IHZwYzogdGhpcy52cGMgfSldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5kaW5kID0gcHJvcHM/LmRvY2tlckluRG9ja2VyID8/IHRydWU7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcblxuICAgIGxldCBidWlsZFNwZWMgPSB7XG4gICAgICB2ZXJzaW9uOiAwLjIsXG4gICAgICBlbnY6IHtcbiAgICAgICAgdmFyaWFibGVzOiB7XG4gICAgICAgICAgUlVOTkVSX1RPS0VOOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIFJVTk5FUl9OQU1FOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIFJVTk5FUl9MQUJFTDogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBPV05FUjogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBSRVBPOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIEdJVEhVQl9ET01BSU46ICdnaXRodWIuY29tJyxcbiAgICAgICAgICBSRUdJU1RSQVRJT05fVVJMOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIFJVTk5FUl9HUk9VUDE6ICcnLFxuICAgICAgICAgIFJVTk5FUl9HUk9VUDI6ICcnLFxuICAgICAgICAgIERFRkFVTFRfTEFCRUxTOiAnJyxcbiAgICAgICAgICBKSVRfQ09ORklHOiAnJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBwaGFzZXM6IHtcbiAgICAgICAgaW5zdGFsbDoge1xuICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICB0aGlzLmRpbmQgPyAnbm9odXAgZG9ja2VyZCAtLWhvc3Q9dW5peDovLy92YXIvcnVuL2RvY2tlci5zb2NrIC0taG9zdD10Y3A6Ly8xMjcuMC4wLjE6MjM3NSAtLXN0b3JhZ2UtZHJpdmVyPW92ZXJsYXkyICYnIDogJycsXG4gICAgICAgICAgICB0aGlzLmRpbmQgPyAndGltZW91dCAxNSBzaCAtYyBcInVudGlsIGRvY2tlciBpbmZvOyBkbyBlY2hvIC47IHNsZWVwIDE7IGRvbmVcIicgOiAnJyxcbiAgICAgICAgICAgICdpZiBbIC1uIFwiJHtKSVRfQ09ORklHfVwiIF07IHRoZW4gZWNobyBcIkpJVCBtb2RlIGVuYWJsZWQsIHNraXBwaW5nIGNvbmZpZy5zaFwiOyBlbHNlIGlmIFsgXCIke1JVTk5FUl9WRVJTSU9OfVwiID0gXCJsYXRlc3RcIiBdOyB0aGVuIFJVTk5FUl9GTEFHUz1cIlwiOyBlbHNlIFJVTk5FUl9GTEFHUz1cIi0tZGlzYWJsZXVwZGF0ZVwiOyBmaSAmJiBzdWRvIC1IdSBydW5uZXIgL2hvbWUvcnVubmVyL2NvbmZpZy5zaCAtLXVuYXR0ZW5kZWQgLS11cmwgXCIke1JFR0lTVFJBVElPTl9VUkx9XCIgLS10b2tlbiBcIiR7UlVOTkVSX1RPS0VOfVwiIC0tZXBoZW1lcmFsIC0td29yayBfd29yayAtLWxhYmVscyBcIiR7UlVOTkVSX0xBQkVMfSxjZGtnaHI6c3RhcnRlZDpgZGF0ZSArJXNgXCIgJHtSVU5ORVJfRkxBR1N9IC0tbmFtZSBcIiR7UlVOTkVSX05BTUV9XCIgJHtSVU5ORVJfR1JPVVAxfSAke1JVTk5FUl9HUk9VUDJ9ICR7REVGQVVMVF9MQUJFTFN9OyBmaScsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgJ2lmIFsgLW4gXCIke0pJVF9DT05GSUd9XCIgXTsgdGhlbiBzdWRvIC0tcHJlc2VydmUtZW52PUFXU19DT05UQUlORVJfQ1JFREVOVElBTFNfUkVMQVRJVkVfVVJJLEFXU19ERUZBVUxUX1JFR0lPTixBV1NfUkVHSU9OIC1IdSBydW5uZXIgL2hvbWUvcnVubmVyL3J1bi5zaCAtLWppdGNvbmZpZyBcIiR7SklUX0NPTkZJR31cIjsgZWxzZSBzdWRvIC0tcHJlc2VydmUtZW52PUFXU19DT05UQUlORVJfQ1JFREVOVElBTFNfUkVMQVRJVkVfVVJJLEFXU19ERUZBVUxUX1JFR0lPTixBV1NfUkVHSU9OIC1IdSBydW5uZXIgL2hvbWUvcnVubmVyL3J1bi5zaDsgZmknLFxuICAgICAgICAgICAgJ1NUQVRVUz0kKGdyZXAgLVBob3JzIFwiZmluaXNoIGpvYiByZXF1ZXN0IGZvciBqb2IgWzAtOWEtZi1dKyB3aXRoIHJlc3VsdDogLipcIiAvaG9tZS9ydW5uZXIvX2RpYWcvIHwgdGFpbCAtbjEgfCBhd2sgXFwne3ByaW50ICRORn1cXCcpJyxcbiAgICAgICAgICAgICdbIC1uIFwiJFNUQVRVU1wiIF0gJiYgZWNobyBDREtHSEEgSk9CIERPTkUgXCIkUlVOTkVSX0xBQkVMXCIgXCIkU1RBVFVTXCInLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBjb25zdCBpbWFnZUJ1aWxkZXIgPSBwcm9wcz8uaW1hZ2VCdWlsZGVyID8/IENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcih0aGlzLCAnSW1hZ2UgQnVpbGRlcicpO1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZSA9IGltYWdlQnVpbGRlci5iaW5kRG9ja2VySW1hZ2UoKTtcblxuICAgIGlmIChpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgYnVpbGRTcGVjLnBoYXNlcy5pbnN0YWxsLmNvbW1hbmRzID0gW1xuICAgICAgICAnY2QgXFxcXGFjdGlvbnMnLFxuICAgICAgICAnaWYgKCR7RW52OlJVTk5FUl9WRVJTSU9OfSAtZXEgXCJsYXRlc3RcIikgeyAkUnVubmVyRmxhZ3MgPSBcIlwiIH0gZWxzZSB7ICRSdW5uZXJGbGFncyA9IFwiLS1kaXNhYmxldXBkYXRlXCIgfScsXG4gICAgICAgICcuL2NvbmZpZy5jbWQgLS11bmF0dGVuZGVkIC0tdXJsIFwiJHtFbnY6UkVHSVNUUkFUSU9OX1VSTH1cIiAtLXRva2VuIFwiJHtFbnY6UlVOTkVSX1RPS0VOfVwiIC0tZXBoZW1lcmFsIC0td29yayBfd29yayAtLWxhYmVscyBcIiR7RW52OlJVTk5FUl9MQUJFTH0sY2RrZ2hyOnN0YXJ0ZWQ6JChHZXQtRGF0ZSAtVUZvcm1hdCAlcylcIiAke1J1bm5lckZsYWdzfSAtLW5hbWUgXCIke0VudjpSVU5ORVJfTkFNRX1cIiAke0VudjpSVU5ORVJfR1JPVVAxfSAke0VudjpSVU5ORVJfR1JPVVAyfSAke0VudjpERUZBVUxUX0xBQkVMU30nLFxuICAgICAgXTtcbiAgICAgIGJ1aWxkU3BlYy5waGFzZXMuYnVpbGQuY29tbWFuZHMgPSBbXG4gICAgICAgICdjZCBcXFxcYWN0aW9ucycsXG4gICAgICAgICcuL3J1bi5jbWQnLFxuICAgICAgICAnJFNUQVRVUyA9IFNlbGVjdC1TdHJpbmcgLVBhdGggXFwnLi9fZGlhZy8qLmxvZ1xcJyAtUGF0dGVybiBcXCdmaW5pc2ggam9iIHJlcXVlc3QgZm9yIGpvYiBbMC05YS1mXFxcXC1dKyB3aXRoIHJlc3VsdDogKC4qKVxcJyB8ICV7JF8uTWF0Y2hlcy5Hcm91cHNbMV0uVmFsdWV9IHwgU2VsZWN0LU9iamVjdCAtTGFzdCAxJyxcbiAgICAgICAgJ2lmICgkU1RBVFVTKSB7IGVjaG8gXCJDREtHSEEgSk9CIERPTkUgJFxce0VudjpSVU5ORVJfTEFCRUxcXH0gJFNUQVRVU1wiIH0nLFxuICAgICAgXTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHM/LmdwdSkge1xuICAgICAgaWYgKGltYWdlLm9zLmlzKE9zLldJTkRPV1MpIHx8IGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ29kZUJ1aWxkIEdQVSBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgTGludXggeDY0IGltYWdlcy4gU2V0IGdwdTogZmFsc2Ugb3IgdXNlIGEgTGludXggeDY0IGltYWdlLicpO1xuICAgICAgfVxuICAgICAgaWYgKHByb3BzPy5jb21wdXRlVHlwZSAhPT0gdW5kZWZpbmVkICYmIHByb3BzLmNvbXB1dGVUeXBlICE9PSBDb21wdXRlVHlwZS5TTUFMTCAmJiBwcm9wcy5jb21wdXRlVHlwZSAhPT0gQ29tcHV0ZVR5cGUuTEFSR0UpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb2RlQnVpbGQgR1BVIG9ubHkgc3VwcG9ydHMgU01BTEwgKDEgR1BVKSBvciBMQVJHRSAoNCBHUFVzKS4gR290ICR7cHJvcHMuY29tcHV0ZVR5cGV9LmApO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGNob29zZSBidWlsZCBpbWFnZVxuICAgIGxldCBidWlsZEltYWdlOiBjb2RlYnVpbGQuSUJ1aWxkSW1hZ2UgfCB1bmRlZmluZWQ7XG4gICAgaWYgKGltYWdlLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgIGlmIChwcm9wcz8uZ3B1ICYmIGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICBidWlsZEltYWdlID0gTGludXhHcHVCdWlsZEltYWdlLmZyb21FY3JSZXBvc2l0b3J5KGltYWdlLmltYWdlUmVwb3NpdG9yeSwgaW1hZ2UuaW1hZ2VUYWcpO1xuICAgICAgfSBlbHNlIGlmIChpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgICAgYnVpbGRJbWFnZSA9IGNvZGVidWlsZC5MaW51eEJ1aWxkSW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LCBpbWFnZS5pbWFnZVRhZyk7XG4gICAgICB9IGVsc2UgaWYgKGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgIGJ1aWxkSW1hZ2UgPSBjb2RlYnVpbGQuTGludXhBcm1CdWlsZEltYWdlLmZyb21FY3JSZXBvc2l0b3J5KGltYWdlLmltYWdlUmVwb3NpdG9yeSwgaW1hZ2UuaW1hZ2VUYWcpO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIGlmIChpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgICAgYnVpbGRJbWFnZSA9IGNvZGVidWlsZC5XaW5kb3dzQnVpbGRJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShpbWFnZS5pbWFnZVJlcG9zaXRvcnksIGltYWdlLmltYWdlVGFnLCBjb2RlYnVpbGQuV2luZG93c0ltYWdlVHlwZS5TRVJWRVJfMjAxOSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGJ1aWxkSW1hZ2UgPT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZmluZCBzdXBwb3J0ZWQgQ29kZUJ1aWxkIGltYWdlIGZvciAke2ltYWdlLm9zLm5hbWV9LyR7aW1hZ2UuYXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgfVxuXG4gICAgLy8gY3JlYXRlIHByb2plY3RcbiAgICB0aGlzLmxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAoXG4gICAgICB0aGlzLFxuICAgICAgJ0xvZ3MnLFxuICAgICAge1xuICAgICAgICByZXRlbnRpb246IHByb3BzPy5sb2dSZXRlbnRpb24gPz8gUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICB0aGlzLnByb2plY3QgPSBuZXcgY29kZWJ1aWxkLlByb2plY3QoXG4gICAgICB0aGlzLFxuICAgICAgJ0NvZGVCdWlsZCcsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiBgR2l0SHViIEFjdGlvbnMgc2VsZi1ob3N0ZWQgcnVubmVyIGZvciBsYWJlbHMgJHt0aGlzLmxhYmVsc31gLFxuICAgICAgICBidWlsZFNwZWM6IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdChidWlsZFNwZWMpLFxuICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3VwcyxcbiAgICAgICAgc3VibmV0U2VsZWN0aW9uOiBwcm9wcz8uc3VibmV0U2VsZWN0aW9uLFxuICAgICAgICB0aW1lb3V0OiBwcm9wcz8udGltZW91dCA/PyBEdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBidWlsZEltYWdlLFxuICAgICAgICAgIGNvbXB1dGVUeXBlOiBwcm9wcz8uY29tcHV0ZVR5cGUgPz8gQ29tcHV0ZVR5cGUuU01BTEwsXG4gICAgICAgICAgcHJpdmlsZWdlZDogdGhpcy5kaW5kICYmICFpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSxcbiAgICAgICAgfSxcbiAgICAgICAgbG9nZ2luZzoge1xuICAgICAgICAgIGNsb3VkV2F0Y2g6IHtcbiAgICAgICAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICk7XG5cbiAgICB0aGlzLmdyYW50UHJpbmNpcGFsID0gdGhpcy5wcm9qZWN0LmdyYW50UHJpbmNpcGFsO1xuXG4gICAgLy8gYWxsb3cgU1NNIFNlc3Npb24gTWFuYWdlciBhY2Nlc3NcbiAgICAvLyB0aGlzLnByb2plY3Qucm9sZT8uYWRkVG9QcmluY2lwYWxQb2xpY3koTUlOSU1BTF9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQpO1xuICAgIC8vIHN0ZXAgZnVuY3Rpb24gd29uJ3QgbGV0IHVzIHBhc3MgYGRlYnVnU2Vzc2lvbkVuYWJsZWQ6IHRydWVgIHVubGVzcyB3ZSB1c2UgYmF0Y2gsIHNvIHdlIGNhbid0IHVzZSB0aGlzXG4gIH1cblxuICAvKipcbiAgICogR2VuZXJhdGUgc3RlcCBmdW5jdGlvbiB0YXNrKHMpIHRvIHN0YXJ0IGEgbmV3IHJ1bm5lci5cbiAgICpcbiAgICogQ2FsbGVkIGJ5IEdpdGh1YlJ1bm5lcnMgYW5kIHNob3VsZG4ndCBiZSBjYWxsZWQgbWFudWFsbHkuXG4gICAqXG4gICAqIEBwYXJhbSBwYXJhbWV0ZXJzIHdvcmtmbG93IGpvYiBkZXRhaWxzXG4gICAqL1xuICBnZXRTdGVwRnVuY3Rpb25UYXNrKHBhcmFtZXRlcnM6IElSdW5uZXJSdW50aW1lUGFyYW1ldGVycyk6IHN0ZXBmdW5jdGlvbnMuSUNoYWluYWJsZSB7XG4gICAgcmV0dXJuIG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLkNvZGVCdWlsZFN0YXJ0QnVpbGQoXG4gICAgICB0aGlzLFxuICAgICAgJ1N0YXRlJyxcbiAgICAgIHtcbiAgICAgICAgc3RhdGVOYW1lOiBnZW5lcmF0ZVN0YXRlTmFtZSh0aGlzKSxcbiAgICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBJbnRlZ3JhdGlvblBhdHRlcm4uUlVOX0pPQiwgLy8gc3luY1xuICAgICAgICBwcm9qZWN0OiB0aGlzLnByb2plY3QsXG4gICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzT3ZlcnJpZGU6IHtcbiAgICAgICAgICBSVU5ORVJfVE9LRU46IHtcbiAgICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLnJ1bm5lclRva2VuUGF0aCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIEpJVF9DT05GSUc6IHtcbiAgICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLmppdENvbmZpZ1BhdGgsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBSVU5ORVJfTkFNRToge1xuICAgICAgICAgICAgdHlwZTogY29kZWJ1aWxkLkJ1aWxkRW52aXJvbm1lbnRWYXJpYWJsZVR5cGUuUExBSU5URVhULFxuICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucnVubmVyTmFtZVBhdGgsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBSVU5ORVJfTEFCRUw6IHtcbiAgICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLmxhYmVsc1BhdGgsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBSVU5ORVJfR1JPVVAxOiB7XG4gICAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgICAgICB2YWx1ZTogdGhpcy5ncm91cCA/ICctLXJ1bm5lcmdyb3VwJyA6ICcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgUlVOTkVSX0dST1VQMjoge1xuICAgICAgICAgICAgdHlwZTogY29kZWJ1aWxkLkJ1aWxkRW52aXJvbm1lbnRWYXJpYWJsZVR5cGUuUExBSU5URVhULFxuICAgICAgICAgICAgdmFsdWU6IHRoaXMuZ3JvdXAgPyB0aGlzLmdyb3VwIDogJycsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBERUZBVUxUX0xBQkVMUzoge1xuICAgICAgICAgICAgdHlwZTogY29kZWJ1aWxkLkJ1aWxkRW52aXJvbm1lbnRWYXJpYWJsZVR5cGUuUExBSU5URVhULFxuICAgICAgICAgICAgdmFsdWU6IHRoaXMuZGVmYXVsdExhYmVscyA/ICcnIDogJy0tbm8tZGVmYXVsdC1sYWJlbHMnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgR0lUSFVCX0RPTUFJTjoge1xuICAgICAgICAgICAgdHlwZTogY29kZWJ1aWxkLkJ1aWxkRW52aXJvbm1lbnRWYXJpYWJsZVR5cGUuUExBSU5URVhULFxuICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMuZ2l0aHViRG9tYWluUGF0aCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIE9XTkVSOiB7XG4gICAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5vd25lclBhdGgsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBSRVBPOiB7XG4gICAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5yZXBvUGF0aCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIFJFR0lTVFJBVElPTl9VUkw6IHtcbiAgICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLnJlZ2lzdHJhdGlvblVybCxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgZ3JhbnRTdGF0ZU1hY2hpbmUoXzogaWFtLklHcmFudGFibGUpIHtcbiAgfVxuXG4gIHN0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGU6IGlhbS5JR3JhbnRhYmxlKTogSVJ1bm5lclByb3ZpZGVyU3RhdHVzIHtcbiAgICB0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5ncmFudChzdGF0dXNGdW5jdGlvblJvbGUsICdlY3I6RGVzY3JpYmVJbWFnZXMnKTtcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBsYWJlbHM6IHRoaXMubGFiZWxzLFxuICAgICAgY29uc3RydWN0UGF0aDogdGhpcy5ub2RlLnBhdGgsXG4gICAgICB2cGNBcm46IHRoaXMudnBjPy52cGNBcm4sXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcz8ubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICByb2xlQXJuOiB0aGlzLnByb2plY3Qucm9sZT8ucm9sZUFybixcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGltYWdlOiB7XG4gICAgICAgIGltYWdlUmVwb3NpdG9yeTogdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgaW1hZ2VUYWc6IHRoaXMuaW1hZ2UuaW1hZ2VUYWcsXG4gICAgICAgIGltYWdlQnVpbGRlckxvZ0dyb3VwOiB0aGlzLmltYWdlLmxvZ0dyb3VwPy5sb2dHcm91cE5hbWUsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogVGhlIG5ldHdvcmsgY29ubmVjdGlvbnMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcmVzb3VyY2UuXG4gICAqL1xuICBwdWJsaWMgZ2V0IGNvbm5lY3Rpb25zKCk6IGVjMi5Db25uZWN0aW9ucyB7XG4gICAgcmV0dXJuIHRoaXMucHJvamVjdC5jb25uZWN0aW9ucztcbiAgfVxufVxuXG4vKipcbiAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXJ9XG4gKi9cbmV4cG9ydCBjbGFzcyBDb2RlQnVpbGRSdW5uZXIgZXh0ZW5kcyBDb2RlQnVpbGRSdW5uZXJQcm92aWRlciB7XG59XG4iXX0=