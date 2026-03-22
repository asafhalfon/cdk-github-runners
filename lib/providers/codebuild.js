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
        // choose build image
        let buildImage;
        if (image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS)) {
            if (image.architecture.is(common_1.Architecture.X86_64)) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWJ1aWxkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9jb2RlYnVpbGQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSw2QkFBNkI7QUFDN0IsNkNBVXFCO0FBQ3JCLDZEQUF3RDtBQUN4RCxtREFBcUQ7QUFDckQscUVBQW1FO0FBRW5FLHFDQVdrQjtBQUNsQixzREFBMkg7QUFrSDNIOzs7Ozs7R0FNRztBQUNILE1BQWEsdUJBQXdCLFNBQVEscUJBQVk7SUErQnZEOzs7Ozs7Ozs7Ozs7Ozs7OztPQWlCRztJQUNJLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBK0I7UUFDdEYsT0FBTyxtQ0FBa0IsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUN2QyxFQUFFLEVBQUUsV0FBRSxDQUFDLFlBQVk7WUFDbkIsWUFBWSxFQUFFLHFCQUFZLENBQUMsTUFBTTtZQUNqQyxVQUFVLEVBQUU7Z0JBQ1YscUNBQW9CLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3ZDLHFDQUFvQixDQUFDLFVBQVUsRUFBRTtnQkFDakMscUNBQW9CLENBQUMsR0FBRyxFQUFFO2dCQUMxQixxQ0FBb0IsQ0FBQyxTQUFTLEVBQUU7Z0JBQ2hDLHFDQUFvQixDQUFDLE1BQU0sRUFBRTtnQkFDN0IscUNBQW9CLENBQUMsTUFBTSxFQUFFO2dCQUM3QixxQ0FBb0IsQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLGFBQWEsSUFBSSxzQkFBYSxDQUFDLE1BQU0sRUFBRSxDQUFDO2FBQ2xGO1lBQ0QsR0FBRyxLQUFLO1NBQ1QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQTBDRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9DO1FBQzVFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBWmpCLG9CQUFlLEdBQUc7WUFDekIsOEJBQThCO1lBQzlCLHlDQUF5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RSxRQUFRLEVBQUUsZUFBZSxFQUFFLFdBQVcsRUFBRSxXQUFXLENBQUMsQUFBeEYsQ0FBeUY7QUFFekk7Ozs7Ozs7Ozs7OztHQVlHO0FBQ29CLG1EQUEyQixHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxXQUFXLEVBQUUsYUFBYSxDQUFDLEFBQTFGLENBQTJGO0FBMlQvSTs7R0FFRztBQUNILE1BQWEsZUFBZ0IsU0FBUSx1QkFBdUI7O0FBQTVELDBDQUNDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7XG4gIEFubm90YXRpb25zLFxuICBhd3NfY29kZWJ1aWxkIGFzIGNvZGVidWlsZCxcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3Nfc3RlcGZ1bmN0aW9ucyBhcyBzdGVwZnVuY3Rpb25zLFxuICBhd3Nfc3RlcGZ1bmN0aW9uc190YXNrcyBhcyBzdGVwZnVuY3Rpb25zX3Rhc2tzLFxuICBEdXJhdGlvbixcbiAgUmVtb3ZhbFBvbGljeSxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29tcHV0ZVR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZWJ1aWxkJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBJbnRlZ3JhdGlvblBhdHRlcm4gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gIEFyY2hpdGVjdHVyZSxcbiAgQmFzZVByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlclN0YXR1cyxcbiAgT3MsXG4gIFJ1bm5lckltYWdlLFxuICBSdW5uZXJQcm92aWRlclByb3BzLFxuICBSdW5uZXJSdW50aW1lUGFyYW1ldGVycyxcbiAgUnVubmVyVmVyc2lvbixcbiAgZ2VuZXJhdGVTdGF0ZU5hbWUsXG59IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IElSdW5uZXJJbWFnZUJ1aWxkZXIsIFJ1bm5lckltYWdlQnVpbGRlciwgUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMsIFJ1bm5lckltYWdlQ29tcG9uZW50IH0gZnJvbSAnLi4vaW1hZ2UtYnVpbGRlcnMnO1xuXG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXJQcm9wcyBleHRlbmRzIFJ1bm5lclByb3ZpZGVyUHJvcHMge1xuICAvKipcbiAgICogUnVubmVyIGltYWdlIGJ1aWxkZXIgdXNlZCB0byBidWlsZCBEb2NrZXIgaW1hZ2VzIGNvbnRhaW5pbmcgR2l0SHViIFJ1bm5lciBhbmQgYWxsIHJlcXVpcmVtZW50cy5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgbXVzdCBjb250YWluIHRoZSB7QGxpbmsgUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyfSBjb21wb25lbnQgdW5sZXNzIGBkb2NrZXJJbkRvY2tlcmAgaXMgc2V0IHRvIGZhbHNlLlxuICAgKlxuICAgKiBUaGUgaW1hZ2UgYnVpbGRlciBkZXRlcm1pbmVzIHRoZSBPUyBhbmQgYXJjaGl0ZWN0dXJlIG9mIHRoZSBydW5uZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcigpXG4gICAqL1xuICByZWFkb25seSBpbWFnZUJ1aWxkZXI/OiBJUnVubmVySW1hZ2VCdWlsZGVyO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBsYWJlbCB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBsYWJlbHN9IGluc3RlYWRcbiAgICovXG4gIHJlYWRvbmx5IGxhYmVsPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBsYWJlbHMgdXNlZCBmb3IgdGhpcyBwcm92aWRlci5cbiAgICpcbiAgICogVGhlc2UgbGFiZWxzIGFyZSB1c2VkIHRvIGlkZW50aWZ5IHdoaWNoIHByb3ZpZGVyIHNob3VsZCBzcGF3biBhIG5ldyBvbi1kZW1hbmQgcnVubmVyLiBFdmVyeSBqb2Igc2VuZHMgYSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBpdCdzIGxvb2tpbmcgZm9yXG4gICAqIGJhc2VkIG9uIHJ1bnMtb24uIFdlIG1hdGNoIHRoZSBsYWJlbHMgZnJvbSB0aGUgd2ViaG9vayB3aXRoIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUuIElmIGFsbCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlIGFyZSBwcmVzZW50IGluIHRoZVxuICAgKiBqb2IncyBsYWJlbHMsIHRoaXMgcHJvdmlkZXIgd2lsbCBiZSBjaG9zZW4gYW5kIHNwYXduIGEgbmV3IHJ1bm5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgWydjb2RlYnVpbGQnXVxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBncm91cCBuYW1lLlxuICAgKlxuICAgKiBJZiBzcGVjaWZpZWQsIHRoZSBydW5uZXIgd2lsbCBiZSByZWdpc3RlcmVkIHdpdGggdGhpcyBncm91cCBuYW1lLiBTZXR0aW5nIGEgcnVubmVyIGdyb3VwIGNhbiBoZWxwIG1hbmFnaW5nIGFjY2VzcyB0byBzZWxmLWhvc3RlZCBydW5uZXJzLiBJdFxuICAgKiByZXF1aXJlcyBhIHBhaWQgR2l0SHViIGFjY291bnQuXG4gICAqXG4gICAqIFRoZSBncm91cCBtdXN0IGV4aXN0IG9yIHRoZSBydW5uZXIgd2lsbCBub3Qgc3RhcnQuXG4gICAqXG4gICAqIFVzZXJzIHdpbGwgc3RpbGwgYmUgYWJsZSB0byB0cmlnZ2VyIHRoaXMgcnVubmVyIHdpdGggdGhlIGNvcnJlY3QgbGFiZWxzLiBCdXQgdGhlIHJ1bm5lciB3aWxsIG9ubHkgYmUgYWJsZSB0byBydW4gam9icyBmcm9tIHJlcG9zIGFsbG93ZWQgdG8gdXNlIHRoZSBncm91cC5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBncm91cD86IHN0cmluZztcblxuICAvKipcbiAgICogVlBDIHRvIGxhdW5jaCB0aGUgcnVubmVycyBpbi5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gVlBDXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXAgdG8gYXNzaWduIHRvIHRoaXMgaW5zdGFuY2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IHB1YmxpYyBwcm9qZWN0IHdpdGggbm8gc2VjdXJpdHkgZ3JvdXBcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBzZWN1cml0eUdyb3Vwc31cbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA/OiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwcyB0byBhc3NpZ24gdG8gdGhpcyBpbnN0YW5jZS5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgc2VjdXJpdHkgZ3JvdXAsIGlmIHtAbGluayB2cGN9IGlzIHVzZWRcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgLyoqXG4gICAqIFdoZXJlIHRvIHBsYWNlIHRoZSBuZXR3b3JrIGludGVyZmFjZXMgd2l0aGluIHRoZSBWUEMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIHN1Ym5ldFxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogVGhlIHR5cGUgb2YgY29tcHV0ZSB0byB1c2UgZm9yIHRoaXMgYnVpbGQuXG4gICAqIFNlZSB0aGUge0BsaW5rIENvbXB1dGVUeXBlfSBlbnVtIGZvciB0aGUgcG9zc2libGUgdmFsdWVzLlxuICAgKlxuICAgKiBUaGUgY29tcHV0ZSB0eXBlIGRldGVybWluZXMgQ1BVLCBtZW1vcnksIGFuZCBkaXNrIHNwYWNlOlxuICAgKiAtIFNNQUxMOiAyIHZDUFUsIDMgR0IgUkFNLCA2NCBHQiBkaXNrXG4gICAqIC0gTUVESVVNOiA0IHZDUFUsIDcgR0IgUkFNLCAxMjggR0IgZGlza1xuICAgKiAtIExBUkdFOiA4IHZDUFUsIDE1IEdCIFJBTSwgMTI4IEdCIGRpc2tcbiAgICogLSBYMl9MQVJHRTogNzIgdkNQVSwgMTQ1IEdCIFJBTSwgMjU2IEdCIGRpc2sgKExpbnV4KSBvciA4MjQgR0IgZGlzayAoV2luZG93cylcbiAgICpcbiAgICogVXNlIGEgbGFyZ2VyIGNvbXB1dGUgdHlwZSB3aGVuIHlvdSBuZWVkIG1vcmUgZGlzayBzcGFjZSBmb3IgYnVpbGRpbmcgbGFyZ2VyIERvY2tlciBpbWFnZXMuXG4gICAqXG4gICAqIEZvciBtb3JlIGRldGFpbHMsIHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY29kZWJ1aWxkL2xhdGVzdC91c2VyZ3VpZGUvYnVpbGQtZW52LXJlZi1jb21wdXRlLXR5cGVzLmh0bWwjZW52aXJvbm1lbnQudHlwZXNcbiAgICpcbiAgICogQGRlZmF1bHQge0BsaW5rIENvbXB1dGVUeXBlI1NNQUxMfVxuICAgKi9cbiAgcmVhZG9ubHkgY29tcHV0ZVR5cGU/OiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGU7XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgbWludXRlcyBhZnRlciB3aGljaCBBV1MgQ29kZUJ1aWxkIHN0b3BzIHRoZSBidWlsZCBpZiBpdCdzXG4gICAqIG5vdCBjb21wbGV0ZS4gRm9yIHZhbGlkIHZhbHVlcywgc2VlIHRoZSB0aW1lb3V0SW5NaW51dGVzIGZpZWxkIGluIHRoZSBBV1NcbiAgICogQ29kZUJ1aWxkIFVzZXIgR3VpZGUuXG4gICAqXG4gICAqIEBkZWZhdWx0IER1cmF0aW9uLmhvdXJzKDEpXG4gICAqL1xuICByZWFkb25seSB0aW1lb3V0PzogRHVyYXRpb247XG5cbiAgLyoqXG4gICAqIFN1cHBvcnQgYnVpbGRpbmcgYW5kIHJ1bm5pbmcgRG9ja2VyIGltYWdlcyBieSBlbmFibGluZyBEb2NrZXItaW4tRG9ja2VyIChkaW5kKSBhbmQgdGhlIHJlcXVpcmVkIENvZGVCdWlsZCBwcml2aWxlZ2VkIG1vZGUuIERpc2FibGluZyB0aGlzIGNhblxuICAgKiBzcGVlZCB1cCBwcm92aXNpb25pbmcgb2YgQ29kZUJ1aWxkIHJ1bm5lcnMuIElmIHlvdSBkb24ndCBpbnRlbmQgb24gcnVubmluZyBvciBidWlsZGluZyBEb2NrZXIgaW1hZ2VzLCBkaXNhYmxlIHRoaXMgZm9yIGZhc3RlciBzdGFydC11cCB0aW1lcy5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgZG9ja2VySW5Eb2NrZXI/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBwcm92aWRlciB1c2luZyBDb2RlQnVpbGQgdG8gZXhlY3V0ZSBqb2JzLlxuICpcbiAqIENyZWF0ZXMgYSBwcm9qZWN0IHRoYXQgZ2V0cyBzdGFydGVkIGZvciBlYWNoIGpvYi5cbiAqXG4gKiBUaGlzIGNvbnN0cnVjdCBpcyBub3QgbWVhbnQgdG8gYmUgdXNlZCBieSBpdHNlbGYuIEl0IHNob3VsZCBiZSBwYXNzZWQgaW4gdGhlIHByb3ZpZGVycyBwcm9wZXJ0eSBmb3IgR2l0SHViUnVubmVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqXG4gICAqIFBhdGggdG8gRG9ja2VyZmlsZSBmb3IgTGludXggeDY0IHdpdGggYWxsIHRoZSByZXF1aXJlbWVudHMgZm9yIENvZGVCdWlsZCBydW5uZXIuIFVzZSB0aGlzIERvY2tlcmZpbGUgdW5sZXNzIHlvdSBuZWVkIHRvIGN1c3RvbWl6ZSBpdCBmdXJ0aGVyIHRoYW4gYWxsb3dlZCBieSBob29rcy5cbiAgICpcbiAgICogQXZhaWxhYmxlIGJ1aWxkIGFyZ3VtZW50cyB0aGF0IGNhbiBiZSBzZXQgaW4gdGhlIGltYWdlIGJ1aWxkZXI6XG4gICAqICogYEJBU0VfSU1BR0VgIHNldHMgdGhlIGBGUk9NYCBsaW5lLiBUaGlzIHNob3VsZCBiZSBhbiBVYnVudHUgY29tcGF0aWJsZSBpbWFnZS5cbiAgICogKiBgRVhUUkFfUEFDS0FHRVNgIGNhbiBiZSB1c2VkIHRvIGluc3RhbGwgYWRkaXRpb25hbCBwYWNrYWdlcy5cbiAgICogKiBgRE9DS0VSX0NIQU5ORUxgIG92ZXJyaWRlcyB0aGUgY2hhbm5lbCBmcm9tIHdoaWNoIERvY2tlciB3aWxsIGJlIGRvd25sb2FkZWQuIERlZmF1bHRzIHRvIGBcInN0YWJsZVwiYC5cbiAgICogKiBgRElORF9DT01NSVRgIG92ZXJyaWRlcyB0aGUgY29tbWl0IHdoZXJlIGRpbmQgaXMgZm91bmQuXG4gICAqICogYERPQ0tFUl9WRVJTSU9OYCBvdmVycmlkZXMgdGhlIGluc3RhbGxlZCBEb2NrZXIgdmVyc2lvbi5cbiAgICogKiBgRE9DS0VSX0NPTVBPU0VfVkVSU0lPTmAgb3ZlcnJpZGVzIHRoZSBpbnN0YWxsZWQgZG9ja2VyLWNvbXBvc2UgdmVyc2lvbi5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBpbWFnZUJ1aWxkZXIoKWAgaW5zdGVhZC5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgTElOVVhfWDY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdjb2RlYnVpbGQnLCAnbGludXgteDY0Jyk7XG5cbiAgLyoqXG4gICAqIFBhdGggdG8gRG9ja2VyZmlsZSBmb3IgTGludXggQVJNNjQgd2l0aCBhbGwgdGhlIHJlcXVpcmVtZW50cyBmb3IgQ29kZUJ1aWxkIHJ1bm5lci4gVXNlIHRoaXMgRG9ja2VyZmlsZSB1bmxlc3MgeW91IG5lZWQgdG8gY3VzdG9taXplIGl0IGZ1cnRoZXIgdGhhbiBhbGxvd2VkIGJ5IGhvb2tzLlxuICAgKlxuICAgKiBBdmFpbGFibGUgYnVpbGQgYXJndW1lbnRzIHRoYXQgY2FuIGJlIHNldCBpbiB0aGUgaW1hZ2UgYnVpbGRlcjpcbiAgICogKiBgQkFTRV9JTUFHRWAgc2V0cyB0aGUgYEZST01gIGxpbmUuIFRoaXMgc2hvdWxkIGJlIGFuIFVidW50dSBjb21wYXRpYmxlIGltYWdlLlxuICAgKiAqIGBFWFRSQV9QQUNLQUdFU2AgY2FuIGJlIHVzZWQgdG8gaW5zdGFsbCBhZGRpdGlvbmFsIHBhY2thZ2VzLlxuICAgKiAqIGBET0NLRVJfQ0hBTk5FTGAgb3ZlcnJpZGVzIHRoZSBjaGFubmVsIGZyb20gd2hpY2ggRG9ja2VyIHdpbGwgYmUgZG93bmxvYWRlZC4gRGVmYXVsdHMgdG8gYFwic3RhYmxlXCJgLlxuICAgKiAqIGBESU5EX0NPTU1JVGAgb3ZlcnJpZGVzIHRoZSBjb21taXQgd2hlcmUgZGluZCBpcyBmb3VuZC5cbiAgICogKiBgRE9DS0VSX1ZFUlNJT05gIG92ZXJyaWRlcyB0aGUgaW5zdGFsbGVkIERvY2tlciB2ZXJzaW9uLlxuICAgKiAqIGBET0NLRVJfQ09NUE9TRV9WRVJTSU9OYCBvdmVycmlkZXMgdGhlIGluc3RhbGxlZCBkb2NrZXItY29tcG9zZSB2ZXJzaW9uLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGltYWdlQnVpbGRlcigpYCBpbnN0ZWFkLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9BUk02NF9ET0NLRVJGSUxFX1BBVEggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnYXNzZXRzJywgJ2RvY2tlci1pbWFnZXMnLCAnY29kZWJ1aWxkJywgJ2xpbnV4LWFybTY0Jyk7XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBuZXcgaW1hZ2UgYnVpbGRlciB0aGF0IGJ1aWxkcyBDb2RlQnVpbGQgc3BlY2lmaWMgcnVubmVyIGltYWdlcy5cbiAgICpcbiAgICogWW91IGNhbiBjdXN0b21pemUgdGhlIE9TLCBhcmNoaXRlY3R1cmUsIFZQQywgc3VibmV0LCBzZWN1cml0eSBncm91cHMsIGV0Yy4gYnkgcGFzc2luZyBpbiBwcm9wcy5cbiAgICpcbiAgICogWW91IGNhbiBhZGQgY29tcG9uZW50cyB0byB0aGUgaW1hZ2UgYnVpbGRlciBieSBjYWxsaW5nIGBpbWFnZUJ1aWxkZXIuYWRkQ29tcG9uZW50KClgLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBPUyBpcyBVYnVudHUgcnVubmluZyBvbiB4NjQgYXJjaGl0ZWN0dXJlLlxuICAgKlxuICAgKiBJbmNsdWRlZCBjb21wb25lbnRzOlxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucnVubmVyVXNlcigpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmF3c0NsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIoKWBcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgaW1hZ2VCdWlsZGVyKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMpIHtcbiAgICByZXR1cm4gUnVubmVySW1hZ2VCdWlsZGVyLm5ldyhzY29wZSwgaWQsIHtcbiAgICAgIG9zOiBPcy5MSU5VWF9VQlVOVFUsXG4gICAgICBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZS5YODZfNjQsXG4gICAgICBjb21wb25lbnRzOiBbXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LnJlcXVpcmVkUGFja2FnZXMoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucnVubmVyVXNlcigpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmF3c0NsaSgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViUnVubmVyKHByb3BzPy5ydW5uZXJWZXJzaW9uID8/IFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkpLFxuICAgICAgXSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENvZGVCdWlsZCBwcm9qZWN0IGhvc3RpbmcgdGhlIHJ1bm5lci5cbiAgICovXG4gIHJlYWRvbmx5IHByb2plY3Q6IGNvZGVidWlsZC5Qcm9qZWN0O1xuXG4gIC8qKlxuICAgKiBMYWJlbHMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcHJvdmlkZXIuXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBHcmFudCBwcmluY2lwYWwgdXNlZCB0byBhZGQgcGVybWlzc2lvbnMgdG8gdGhlIHJ1bm5lciByb2xlLlxuICAgKi9cbiAgcmVhZG9ubHkgZ3JhbnRQcmluY2lwYWw6IGlhbS5JUHJpbmNpcGFsO1xuXG4gIC8qKlxuICAgKiBEb2NrZXIgaW1hZ2UgbG9hZGVkIHdpdGggR2l0SHViIEFjdGlvbnMgUnVubmVyIGFuZCBpdHMgcHJlcmVxdWlzaXRlcy4gVGhlIGltYWdlIGlzIGJ1aWx0IGJ5IGFuIGltYWdlIGJ1aWxkZXIgYW5kIGlzIHNwZWNpZmljIHRvIENvZGVCdWlsZC5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IGltYWdlOiBSdW5uZXJJbWFnZTtcblxuICAvKipcbiAgICogTG9nIGdyb3VwIHdoZXJlIHByb3ZpZGVkIHJ1bm5lcnMgd2lsbCBzYXZlIHRoZWlyIGxvZ3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGlzIG5vdCB0aGUgam9iIGxvZywgYnV0IHRoZSBydW5uZXIgaXRzZWxmLiBJdCB3aWxsIG5vdCBjb250YWluIG91dHB1dCBmcm9tIHRoZSBHaXRIdWIgQWN0aW9uIGJ1dCBvbmx5IG1ldGFkYXRhIG9uIGl0cyBleGVjdXRpb24uXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cDogbG9ncy5JTG9nR3JvdXA7XG5cbiAgcmVhZG9ubHkgcmV0cnlhYmxlRXJyb3JzID0gW1xuICAgICdDb2RlQnVpbGQuQ29kZUJ1aWxkRXhjZXB0aW9uJyxcbiAgICAnQ29kZUJ1aWxkLkFjY291bnRMaW1pdEV4Y2VlZGVkRXhjZXB0aW9uJyxcbiAgXTtcblxuICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG4gIHByaXZhdGUgcmVhZG9ubHkgZGluZDogYm9vbGVhbjtcbiAgcHJpdmF0ZSByZWFkb25seSBkZWZhdWx0TGFiZWxzOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgLy8gd2FybiBhZ2FpbnN0IGlzb2xhdGVkIG5ldHdvcmtzXG4gICAgaWYgKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCkge1xuICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnUHJpdmF0ZSBpc29sYXRlZCBzdWJuZXRzIGNhbm5vdCBwdWxsIGZyb20gcHVibGljIEVDUiBhbmQgVlBDIGVuZHBvaW50IGlzIG5vdCBzdXBwb3J0ZWQgeWV0LiAnICtcbiAgICAgICAgJ1NlZSBodHRwczovL2dpdGh1Yi5jb20vYXdzL2NvbnRhaW5lcnMtcm9hZG1hcC9pc3N1ZXMvMTE2MCcpO1xuICAgIH1cblxuICAgIC8vIGVycm9yIG91dCBvbiBuby1uYXQgbmV0d29ya3MgYmVjYXVzZSB0aGUgYnVpbGQgd2lsbCBoYW5nXG4gICAgaWYgKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFVCTElDKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcignUHVibGljIHN1Ym5ldHMgZG8gbm90IHdvcmsgd2l0aCBDb2RlQnVpbGQgYXMgaXQgY2Fubm90IGJlIGFzc2lnbmVkIGFuIElQLiAnICtcbiAgICAgICAgJ1NlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY29kZWJ1aWxkL2xhdGVzdC91c2VyZ3VpZGUvdnBjLXN1cHBvcnQuaHRtbCNiZXN0LXByYWN0aWNlcy1mb3ItdnBjcycpO1xuICAgIH1cblxuICAgIHRoaXMubGFiZWxzID0gdGhpcy5sYWJlbHNGcm9tUHJvcGVydGllcygnY29kZWJ1aWxkJywgcHJvcHM/LmxhYmVsLCBwcm9wcz8ubGFiZWxzKTtcbiAgICB0aGlzLmdyb3VwID0gcHJvcHM/Lmdyb3VwO1xuICAgIHRoaXMudnBjID0gcHJvcHM/LnZwYztcbiAgICBpZiAocHJvcHM/LnNlY3VyaXR5R3JvdXApIHtcbiAgICAgIHRoaXMuc2VjdXJpdHlHcm91cHMgPSBbcHJvcHMuc2VjdXJpdHlHcm91cF07XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChwcm9wcz8uc2VjdXJpdHlHcm91cHMpIHtcbiAgICAgICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzLnNlY3VyaXR5R3JvdXBzO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMudnBjKSB7XG4gICAgICAgICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IFtuZXcgZWMyLlNlY3VyaXR5R3JvdXAodGhpcywgJ1NHJywgeyB2cGM6IHRoaXMudnBjIH0pXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuZGluZCA9IHByb3BzPy5kb2NrZXJJbkRvY2tlciA/PyB0cnVlO1xuICAgIHRoaXMuZGVmYXVsdExhYmVscyA9IHByb3BzPy5kZWZhdWx0TGFiZWxzID8/IHRydWU7XG5cbiAgICBsZXQgYnVpbGRTcGVjID0ge1xuICAgICAgdmVyc2lvbjogMC4yLFxuICAgICAgZW52OiB7XG4gICAgICAgIHZhcmlhYmxlczoge1xuICAgICAgICAgIFJVTk5FUl9UT0tFTjogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBSVU5ORVJfTkFNRTogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBSVU5ORVJfTEFCRUw6ICd1bnNwZWNpZmllZCcsXG4gICAgICAgICAgT1dORVI6ICd1bnNwZWNpZmllZCcsXG4gICAgICAgICAgUkVQTzogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBHSVRIVUJfRE9NQUlOOiAnZ2l0aHViLmNvbScsXG4gICAgICAgICAgUkVHSVNUUkFUSU9OX1VSTDogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBSVU5ORVJfR1JPVVAxOiAnJyxcbiAgICAgICAgICBSVU5ORVJfR1JPVVAyOiAnJyxcbiAgICAgICAgICBERUZBVUxUX0xBQkVMUzogJycsXG4gICAgICAgICAgSklUX0NPTkZJRzogJycsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgcGhhc2VzOiB7XG4gICAgICAgIGluc3RhbGw6IHtcbiAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgdGhpcy5kaW5kID8gJ25vaHVwIGRvY2tlcmQgLS1ob3N0PXVuaXg6Ly8vdmFyL3J1bi9kb2NrZXIuc29jayAtLWhvc3Q9dGNwOi8vMTI3LjAuMC4xOjIzNzUgLS1zdG9yYWdlLWRyaXZlcj1vdmVybGF5MiAmJyA6ICcnLFxuICAgICAgICAgICAgdGhpcy5kaW5kID8gJ3RpbWVvdXQgMTUgc2ggLWMgXCJ1bnRpbCBkb2NrZXIgaW5mbzsgZG8gZWNobyAuOyBzbGVlcCAxOyBkb25lXCInIDogJycsXG4gICAgICAgICAgICAnaWYgWyAtbiBcIiR7SklUX0NPTkZJR31cIiBdOyB0aGVuIGVjaG8gXCJKSVQgbW9kZSBlbmFibGVkLCBza2lwcGluZyBjb25maWcuc2hcIjsgZWxzZSBpZiBbIFwiJHtSVU5ORVJfVkVSU0lPTn1cIiA9IFwibGF0ZXN0XCIgXTsgdGhlbiBSVU5ORVJfRkxBR1M9XCJcIjsgZWxzZSBSVU5ORVJfRkxBR1M9XCItLWRpc2FibGV1cGRhdGVcIjsgZmkgJiYgc3VkbyAtSHUgcnVubmVyIC9ob21lL3J1bm5lci9jb25maWcuc2ggLS11bmF0dGVuZGVkIC0tdXJsIFwiJHtSRUdJU1RSQVRJT05fVVJMfVwiIC0tdG9rZW4gXCIke1JVTk5FUl9UT0tFTn1cIiAtLWVwaGVtZXJhbCAtLXdvcmsgX3dvcmsgLS1sYWJlbHMgXCIke1JVTk5FUl9MQUJFTH0sY2RrZ2hyOnN0YXJ0ZWQ6YGRhdGUgKyVzYFwiICR7UlVOTkVSX0ZMQUdTfSAtLW5hbWUgXCIke1JVTk5FUl9OQU1FfVwiICR7UlVOTkVSX0dST1VQMX0gJHtSVU5ORVJfR1JPVVAyfSAke0RFRkFVTFRfTEFCRUxTfTsgZmknLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICdpZiBbIC1uIFwiJHtKSVRfQ09ORklHfVwiIF07IHRoZW4gc3VkbyAtLXByZXNlcnZlLWVudj1BV1NfQ09OVEFJTkVSX0NSRURFTlRJQUxTX1JFTEFUSVZFX1VSSSxBV1NfREVGQVVMVF9SRUdJT04sQVdTX1JFR0lPTiAtSHUgcnVubmVyIC9ob21lL3J1bm5lci9ydW4uc2ggLS1qaXRjb25maWcgXCIke0pJVF9DT05GSUd9XCI7IGVsc2Ugc3VkbyAtLXByZXNlcnZlLWVudj1BV1NfQ09OVEFJTkVSX0NSRURFTlRJQUxTX1JFTEFUSVZFX1VSSSxBV1NfREVGQVVMVF9SRUdJT04sQVdTX1JFR0lPTiAtSHUgcnVubmVyIC9ob21lL3J1bm5lci9ydW4uc2g7IGZpJyxcbiAgICAgICAgICAgICdTVEFUVVM9JChncmVwIC1QaG9ycyBcImZpbmlzaCBqb2IgcmVxdWVzdCBmb3Igam9iIFswLTlhLWYtXSsgd2l0aCByZXN1bHQ6IC4qXCIgL2hvbWUvcnVubmVyL19kaWFnLyB8IHRhaWwgLW4xIHwgYXdrIFxcJ3twcmludCAkTkZ9XFwnKScsXG4gICAgICAgICAgICAnWyAtbiBcIiRTVEFUVVNcIiBdICYmIGVjaG8gQ0RLR0hBIEpPQiBET05FIFwiJFJVTk5FUl9MQUJFTFwiIFwiJFNUQVRVU1wiJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgY29uc3QgaW1hZ2VCdWlsZGVyID0gcHJvcHM/LmltYWdlQnVpbGRlciA/PyBDb2RlQnVpbGRSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIodGhpcywgJ0ltYWdlIEJ1aWxkZXInKTtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2UgPSBpbWFnZUJ1aWxkZXIuYmluZERvY2tlckltYWdlKCk7XG5cbiAgICBpZiAoaW1hZ2Uub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIGJ1aWxkU3BlYy5waGFzZXMuaW5zdGFsbC5jb21tYW5kcyA9IFtcbiAgICAgICAgJ2NkIFxcXFxhY3Rpb25zJyxcbiAgICAgICAgJ2lmICgke0VudjpSVU5ORVJfVkVSU0lPTn0gLWVxIFwibGF0ZXN0XCIpIHsgJFJ1bm5lckZsYWdzID0gXCJcIiB9IGVsc2UgeyAkUnVubmVyRmxhZ3MgPSBcIi0tZGlzYWJsZXVwZGF0ZVwiIH0nLFxuICAgICAgICAnLi9jb25maWcuY21kIC0tdW5hdHRlbmRlZCAtLXVybCBcIiR7RW52OlJFR0lTVFJBVElPTl9VUkx9XCIgLS10b2tlbiBcIiR7RW52OlJVTk5FUl9UT0tFTn1cIiAtLWVwaGVtZXJhbCAtLXdvcmsgX3dvcmsgLS1sYWJlbHMgXCIke0VudjpSVU5ORVJfTEFCRUx9LGNka2docjpzdGFydGVkOiQoR2V0LURhdGUgLVVGb3JtYXQgJXMpXCIgJHtSdW5uZXJGbGFnc30gLS1uYW1lIFwiJHtFbnY6UlVOTkVSX05BTUV9XCIgJHtFbnY6UlVOTkVSX0dST1VQMX0gJHtFbnY6UlVOTkVSX0dST1VQMn0gJHtFbnY6REVGQVVMVF9MQUJFTFN9JyxcbiAgICAgIF07XG4gICAgICBidWlsZFNwZWMucGhhc2VzLmJ1aWxkLmNvbW1hbmRzID0gW1xuICAgICAgICAnY2QgXFxcXGFjdGlvbnMnLFxuICAgICAgICAnLi9ydW4uY21kJyxcbiAgICAgICAgJyRTVEFUVVMgPSBTZWxlY3QtU3RyaW5nIC1QYXRoIFxcJy4vX2RpYWcvKi5sb2dcXCcgLVBhdHRlcm4gXFwnZmluaXNoIGpvYiByZXF1ZXN0IGZvciBqb2IgWzAtOWEtZlxcXFwtXSsgd2l0aCByZXN1bHQ6ICguKilcXCcgfCAleyRfLk1hdGNoZXMuR3JvdXBzWzFdLlZhbHVlfSB8IFNlbGVjdC1PYmplY3QgLUxhc3QgMScsXG4gICAgICAgICdpZiAoJFNUQVRVUykgeyBlY2hvIFwiQ0RLR0hBIEpPQiBET05FICRcXHtFbnY6UlVOTkVSX0xBQkVMXFx9ICRTVEFUVVNcIiB9JyxcbiAgICAgIF07XG4gICAgfVxuXG4gICAgLy8gY2hvb3NlIGJ1aWxkIGltYWdlXG4gICAgbGV0IGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5JQnVpbGRJbWFnZSB8IHVuZGVmaW5lZDtcbiAgICBpZiAoaW1hZ2Uub3MuaXNJbihPcy5fQUxMX0xJTlVYX1ZFUlNJT05TKSkge1xuICAgICAgaWYgKGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICBidWlsZEltYWdlID0gY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5mcm9tRWNyUmVwb3NpdG9yeShpbWFnZS5pbWFnZVJlcG9zaXRvcnksIGltYWdlLmltYWdlVGFnKTtcbiAgICAgIH0gZWxzZSBpZiAoaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgICAgYnVpbGRJbWFnZSA9IGNvZGVidWlsZC5MaW51eEFybUJ1aWxkSW1hZ2UuZnJvbUVjclJlcG9zaXRvcnkoaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LCBpbWFnZS5pbWFnZVRhZyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChpbWFnZS5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgaWYgKGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICBidWlsZEltYWdlID0gY29kZWJ1aWxkLldpbmRvd3NCdWlsZEltYWdlLmZyb21FY3JSZXBvc2l0b3J5KGltYWdlLmltYWdlUmVwb3NpdG9yeSwgaW1hZ2UuaW1hZ2VUYWcsIGNvZGVidWlsZC5XaW5kb3dzSW1hZ2VUeXBlLlNFUlZFUl8yMDE5KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYnVpbGRJbWFnZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBmaW5kIHN1cHBvcnRlZCBDb2RlQnVpbGQgaW1hZ2UgZm9yICR7aW1hZ2Uub3MubmFtZX0vJHtpbWFnZS5hcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICB9XG5cbiAgICAvLyBjcmVhdGUgcHJvamVjdFxuICAgIHRoaXMubG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cChcbiAgICAgIHRoaXMsXG4gICAgICAnTG9ncycsXG4gICAgICB7XG4gICAgICAgIHJldGVudGlvbjogcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgfSxcbiAgICApO1xuICAgIHRoaXMucHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUHJvamVjdChcbiAgICAgIHRoaXMsXG4gICAgICAnQ29kZUJ1aWxkJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246IGBHaXRIdWIgQWN0aW9ucyBzZWxmLWhvc3RlZCBydW5uZXIgZm9yIGxhYmVscyAke3RoaXMubGFiZWxzfWAsXG4gICAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KGJ1aWxkU3BlYyksXG4gICAgICAgIHZwYzogdGhpcy52cGMsXG4gICAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzLFxuICAgICAgICBzdWJuZXRTZWxlY3Rpb246IHByb3BzPy5zdWJuZXRTZWxlY3Rpb24sXG4gICAgICAgIHRpbWVvdXQ6IHByb3BzPy50aW1lb3V0ID8/IER1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIGJ1aWxkSW1hZ2UsXG4gICAgICAgICAgY29tcHV0ZVR5cGU6IHByb3BzPy5jb21wdXRlVHlwZSA/PyBDb21wdXRlVHlwZS5TTUFMTCxcbiAgICAgICAgICBwcml2aWxlZ2VkOiB0aGlzLmRpbmQgJiYgIWltYWdlLm9zLmlzKE9zLldJTkRPV1MpLFxuICAgICAgICB9LFxuICAgICAgICBsb2dnaW5nOiB7XG4gICAgICAgICAgY2xvdWRXYXRjaDoge1xuICAgICAgICAgICAgbG9nR3JvdXA6IHRoaXMubG9nR3JvdXAsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwgPSB0aGlzLnByb2plY3QuZ3JhbnRQcmluY2lwYWw7XG5cbiAgICAvLyBhbGxvdyBTU00gU2Vzc2lvbiBNYW5hZ2VyIGFjY2Vzc1xuICAgIC8vIHRoaXMucHJvamVjdC5yb2xlPy5hZGRUb1ByaW5jaXBhbFBvbGljeShNSU5JTUFMX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCk7XG4gICAgLy8gc3RlcCBmdW5jdGlvbiB3b24ndCBsZXQgdXMgcGFzcyBgZGVidWdTZXNzaW9uRW5hYmxlZDogdHJ1ZWAgdW5sZXNzIHdlIHVzZSBiYXRjaCwgc28gd2UgY2FuJ3QgdXNlIHRoaXNcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZSBzdGVwIGZ1bmN0aW9uIHRhc2socykgdG8gc3RhcnQgYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBDYWxsZWQgYnkgR2l0aHViUnVubmVycyBhbmQgc2hvdWxkbid0IGJlIGNhbGxlZCBtYW51YWxseS5cbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlcnMgd29ya2Zsb3cgam9iIGRldGFpbHNcbiAgICovXG4gIGdldFN0ZXBGdW5jdGlvblRhc2socGFyYW1ldGVyczogUnVubmVyUnVudGltZVBhcmFtZXRlcnMpOiBzdGVwZnVuY3Rpb25zLklDaGFpbmFibGUge1xuICAgIHJldHVybiBuZXcgc3RlcGZ1bmN0aW9uc190YXNrcy5Db2RlQnVpbGRTdGFydEJ1aWxkKFxuICAgICAgdGhpcyxcbiAgICAgICdTdGF0ZScsXG4gICAgICB7XG4gICAgICAgIHN0YXRlTmFtZTogZ2VuZXJhdGVTdGF0ZU5hbWUodGhpcyksXG4gICAgICAgIGludGVncmF0aW9uUGF0dGVybjogSW50ZWdyYXRpb25QYXR0ZXJuLlJVTl9KT0IsIC8vIHN5bmNcbiAgICAgICAgcHJvamVjdDogdGhpcy5wcm9qZWN0LFxuICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlc092ZXJyaWRlOiB7XG4gICAgICAgICAgUlVOTkVSX1RPS0VOOiB7XG4gICAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5ydW5uZXJUb2tlblBhdGgsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBKSVRfQ09ORklHOiB7XG4gICAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5qaXRDb25maWdQYXRoLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgUlVOTkVSX05BTUU6IHtcbiAgICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLnJ1bm5lck5hbWVQYXRoLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgUlVOTkVSX0xBQkVMOiB7XG4gICAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5sYWJlbHNQYXRoLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgUlVOTkVSX0dST1VQMToge1xuICAgICAgICAgICAgdHlwZTogY29kZWJ1aWxkLkJ1aWxkRW52aXJvbm1lbnRWYXJpYWJsZVR5cGUuUExBSU5URVhULFxuICAgICAgICAgICAgdmFsdWU6IHRoaXMuZ3JvdXAgPyAnLS1ydW5uZXJncm91cCcgOiAnJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIFJVTk5FUl9HUk9VUDI6IHtcbiAgICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgICAgIHZhbHVlOiB0aGlzLmdyb3VwID8gdGhpcy5ncm91cCA6ICcnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgREVGQVVMVF9MQUJFTFM6IHtcbiAgICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgICAgIHZhbHVlOiB0aGlzLmRlZmF1bHRMYWJlbHMgPyAnJyA6ICctLW5vLWRlZmF1bHQtbGFiZWxzJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIEdJVEhVQl9ET01BSU46IHtcbiAgICAgICAgICAgIHR5cGU6IGNvZGVidWlsZC5CdWlsZEVudmlyb25tZW50VmFyaWFibGVUeXBlLlBMQUlOVEVYVCxcbiAgICAgICAgICAgIHZhbHVlOiBwYXJhbWV0ZXJzLmdpdGh1YkRvbWFpblBhdGgsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBPV05FUjoge1xuICAgICAgICAgICAgdHlwZTogY29kZWJ1aWxkLkJ1aWxkRW52aXJvbm1lbnRWYXJpYWJsZVR5cGUuUExBSU5URVhULFxuICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMub3duZXJQYXRoLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgUkVQTzoge1xuICAgICAgICAgICAgdHlwZTogY29kZWJ1aWxkLkJ1aWxkRW52aXJvbm1lbnRWYXJpYWJsZVR5cGUuUExBSU5URVhULFxuICAgICAgICAgICAgdmFsdWU6IHBhcmFtZXRlcnMucmVwb1BhdGgsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBSRUdJU1RSQVRJT05fVVJMOiB7XG4gICAgICAgICAgICB0eXBlOiBjb2RlYnVpbGQuQnVpbGRFbnZpcm9ubWVudFZhcmlhYmxlVHlwZS5QTEFJTlRFWFQsXG4gICAgICAgICAgICB2YWx1ZTogcGFyYW1ldGVycy5yZWdpc3RyYXRpb25VcmwsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIGdyYW50U3RhdGVNYWNoaW5lKF86IGlhbS5JR3JhbnRhYmxlKSB7XG4gIH1cblxuICBzdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1cyB7XG4gICAgdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkuZ3JhbnQoc3RhdHVzRnVuY3Rpb25Sb2xlLCAnZWNyOkRlc2NyaWJlSW1hZ2VzJyk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgbGFiZWxzOiB0aGlzLmxhYmVscyxcbiAgICAgIGNvbnN0cnVjdFBhdGg6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgdnBjQXJuOiB0aGlzLnZwYz8udnBjQXJuLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHM/Lm1hcChzZyA9PiBzZy5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgcm9sZUFybjogdGhpcy5wcm9qZWN0LnJvbGU/LnJvbGVBcm4sXG4gICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBpbWFnZToge1xuICAgICAgICBpbWFnZVJlcG9zaXRvcnk6IHRoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICAgIGltYWdlVGFnOiB0aGlzLmltYWdlLmltYWdlVGFnLFxuICAgICAgICBpbWFnZUJ1aWxkZXJMb2dHcm91cDogdGhpcy5pbWFnZS5sb2dHcm91cD8ubG9nR3JvdXBOYW1lLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcHVibGljIGdldCBjb25uZWN0aW9ucygpOiBlYzIuQ29ubmVjdGlvbnMge1xuICAgIHJldHVybiB0aGlzLnByb2plY3QuY29ubmVjdGlvbnM7XG4gIH1cbn1cblxuLyoqXG4gKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyfVxuICovXG5leHBvcnQgY2xhc3MgQ29kZUJ1aWxkUnVubmVyIGV4dGVuZHMgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIge1xufVxuIl19