import { aws_codebuild as codebuild, aws_ec2 as ec2, aws_iam as iam, aws_logs as logs, aws_stepfunctions as stepfunctions, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseProvider, IRunnerProvider, IRunnerProviderStatus, RunnerImage, RunnerProviderProps, RunnerRuntimeParameters } from './common';
import { IRunnerImageBuilder, RunnerImageBuilderProps } from '../image-builders';
export interface CodeBuildRunnerProviderProps extends RunnerProviderProps {
    /**
     * Runner image builder used to build Docker images containing GitHub Runner and all requirements.
     *
     * The image builder must contain the {@link RunnerImageComponent.docker} component unless `dockerInDocker` is set to false.
     *
     * The image builder determines the OS and architecture of the runner.
     *
     * @default CodeBuildRunnerProvider.imageBuilder()
     */
    readonly imageBuilder?: IRunnerImageBuilder;
    /**
     * GitHub Actions label used for this provider.
     *
     * @default undefined
     * @deprecated use {@link labels} instead
     */
    readonly label?: string;
    /**
     * GitHub Actions labels used for this provider.
     *
     * These labels are used to identify which provider should spawn a new on-demand runner. Every job sends a webhook with the labels it's looking for
     * based on runs-on. We match the labels from the webhook with the labels specified here. If all the labels specified here are present in the
     * job's labels, this provider will be chosen and spawn a new runner.
     *
     * @default ['codebuild']
     */
    readonly labels?: string[];
    /**
     * GitHub Actions runner group name.
     *
     * If specified, the runner will be registered with this group name. Setting a runner group can help managing access to self-hosted runners. It
     * requires a paid GitHub account.
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
     * @default no VPC
     */
    readonly vpc?: ec2.IVpc;
    /**
     * Security group to assign to this instance.
     *
     * @default public project with no security group
     *
     * @deprecated use {@link securityGroups}
     */
    readonly securityGroup?: ec2.ISecurityGroup;
    /**
     * Security groups to assign to this instance.
     *
     * @default a new security group, if {@link vpc} is used
     */
    readonly securityGroups?: ec2.ISecurityGroup[];
    /**
     * Where to place the network interfaces within the VPC.
     *
     * @default no subnet
     */
    readonly subnetSelection?: ec2.SubnetSelection;
    /**
     * The type of compute to use for this build.
     * See the {@link ComputeType} enum for the possible values.
     *
     * The compute type determines CPU, memory, and disk space:
     * - SMALL: 2 vCPU, 3 GB RAM, 64 GB disk
     * - MEDIUM: 4 vCPU, 7 GB RAM, 128 GB disk
     * - LARGE: 8 vCPU, 15 GB RAM, 128 GB disk
     * - X2_LARGE: 72 vCPU, 145 GB RAM, 256 GB disk (Linux) or 824 GB disk (Windows)
     *
     * Use a larger compute type when you need more disk space for building larger Docker images.
     *
     * For more details, see https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-compute-types.html#environment.types
     *
     * @default {@link ComputeType#SMALL}
     */
    readonly computeType?: codebuild.ComputeType;
    /**
     * The number of minutes after which AWS CodeBuild stops the build if it's
     * not complete. For valid values, see the timeoutInMinutes field in the AWS
     * CodeBuild User Guide.
     *
     * @default Duration.hours(1)
     */
    readonly timeout?: Duration;
    /**
     * Support building and running Docker images by enabling Docker-in-Docker (dind) and the required CodeBuild privileged mode. Disabling this can
     * speed up provisioning of CodeBuild runners. If you don't intend on running or building Docker images, disable this for faster start-up times.
     *
     * @default true
     */
    readonly dockerInDocker?: boolean;
}
/**
 * GitHub Actions runner provider using CodeBuild to execute jobs.
 *
 * Creates a project that gets started for each job.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
export declare class CodeBuildRunnerProvider extends BaseProvider implements IRunnerProvider {
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
    static readonly LINUX_X64_DOCKERFILE_PATH: string;
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
    static readonly LINUX_ARM64_DOCKERFILE_PATH: string;
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
    static imageBuilder(scope: Construct, id: string, props?: RunnerImageBuilderProps): import("../image-builders").IConfigurableRunnerImageBuilder;
    /**
     * CodeBuild project hosting the runner.
     */
    readonly project: codebuild.Project;
    /**
     * Labels associated with this provider.
     */
    readonly labels: string[];
    /**
     * Grant principal used to add permissions to the runner role.
     */
    readonly grantPrincipal: iam.IPrincipal;
    /**
     * Docker image loaded with GitHub Actions Runner and its prerequisites. The image is built by an image builder and is specific to CodeBuild.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    readonly image: RunnerImage;
    /**
     * Log group where provided runners will save their logs.
     *
     * Note that this is not the job log, but the runner itself. It will not contain output from the GitHub Action but only metadata on its execution.
     */
    readonly logGroup: logs.ILogGroup;
    readonly retryableErrors: string[];
    private readonly group?;
    private readonly vpc?;
    private readonly securityGroups?;
    private readonly dind;
    private readonly defaultLabels;
    constructor(scope: Construct, id: string, props?: CodeBuildRunnerProviderProps);
    /**
     * Generate step function task(s) to start a new runner.
     *
     * Called by GithubRunners and shouldn't be called manually.
     *
     * @param parameters workflow job details
     */
    getStepFunctionTask(parameters: RunnerRuntimeParameters): stepfunctions.IChainable;
    grantStateMachine(_: iam.IGrantable): void;
    status(statusFunctionRole: iam.IGrantable): IRunnerProviderStatus;
    /**
     * The network connections associated with this resource.
     */
    get connections(): ec2.Connections;
}
/**
 * @deprecated use {@link CodeBuildRunnerProvider}
 */
export declare class CodeBuildRunner extends CodeBuildRunnerProvider {
}
