import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2, aws_iam as iam, aws_lambda as lambda, aws_logs as logs, aws_stepfunctions as stepfunctions } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseProvider, IRunnerProvider, IRunnerProviderStatus, RunnerImage, RunnerProviderProps, RunnerRuntimeParameters } from './common';
import { IRunnerImageBuilder, RunnerImageBuilderProps } from '../image-builders';
export interface LambdaRunnerProviderProps extends RunnerProviderProps {
    /**
     * Runner image builder used to build Docker images containing GitHub Runner and all requirements.
     *
     * The image builder must contain the {@link RunnerImageComponent.lambdaEntrypoint} component.
     *
     * The image builder determines the OS and architecture of the runner.
     *
     * @default LambdaRunnerProvider.imageBuilder()
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
     * @default ['lambda']
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
     * The amount of memory, in MB, that is allocated to your Lambda function.
     * Lambda uses this value to proportionally allocate the amount of CPU
     * power. For more information, see Resource Model in the AWS Lambda
     * Developer Guide.
     *
     * @default 2048
     */
    readonly memorySize?: number;
    /**
     * The size of the function’s /tmp directory in MiB.
     *
     * @default 10 GiB
     */
    readonly ephemeralStorageSize?: cdk.Size;
    /**
     * The function execution time (in seconds) after which Lambda terminates
     * the function. Because the execution time affects cost, set this value
     * based on the function's expected execution time.
     *
     * @default Duration.minutes(15)
     */
    readonly timeout?: cdk.Duration;
    /**
     * VPC to launch the runners in.
     *
     * @default no VPC
     */
    readonly vpc?: ec2.IVpc;
    /**
     * Security group to assign to this instance.
     *
     * @default public lambda with no security group
     *
     * @deprecated use {@link securityGroups}
     */
    readonly securityGroup?: ec2.ISecurityGroup;
    /**
     * Security groups to assign to this instance.
     *
     * @default public lambda with no security group
     */
    readonly securityGroups?: ec2.ISecurityGroup[];
    /**
     * Where to place the network interfaces within the VPC.
     *
     * @default no subnet
     */
    readonly subnetSelection?: ec2.SubnetSelection;
}
/**
 * GitHub Actions runner provider using Lambda to execute jobs.
 *
 * Creates a Docker-based function that gets executed for each job.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
export declare class LambdaRunnerProvider extends BaseProvider implements IRunnerProvider {
    /**
     * Path to Dockerfile for Linux x64 with all the requirement for Lambda runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
     *
     * Available build arguments that can be set in the image builder:
     * * `BASE_IMAGE` sets the `FROM` line. This should be similar to public.ecr.aws/lambda/nodejs:14.
     * * `EXTRA_PACKAGES` can be used to install additional packages.
     *
     * @deprecated Use `imageBuilder()` instead.
     */
    static readonly LINUX_X64_DOCKERFILE_PATH: string;
    /**
     * Path to Dockerfile for Linux ARM64 with all the requirement for Lambda runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
     *
     * Available build arguments that can be set in the image builder:
     * * `BASE_IMAGE` sets the `FROM` line. This should be similar to public.ecr.aws/lambda/nodejs:14.
     * * `EXTRA_PACKAGES` can be used to install additional packages.
     *
     * @deprecated Use `imageBuilder()` instead.
     */
    static readonly LINUX_ARM64_DOCKERFILE_PATH: string;
    /**
     * Create new image builder that builds Lambda specific runner images.
     *
     * You can customize the OS, architecture, VPC, subnet, security groups, etc. by passing in props.
     *
     * You can add components to the image builder by calling `imageBuilder.addComponent()`.
     *
     * The default OS is Amazon Linux 2023 running on x64 architecture.
     *
     * Included components:
     *  * `RunnerImageComponent.requiredPackages()`
     *  * `RunnerImageComponent.runnerUser()`
     *  * `RunnerImageComponent.git()`
     *  * `RunnerImageComponent.githubCli()`
     *  * `RunnerImageComponent.awsCli()`
     *  * `RunnerImageComponent.githubRunner()`
     *  * `RunnerImageComponent.lambdaEntrypoint()`
     */
    static imageBuilder(scope: Construct, id: string, props?: RunnerImageBuilderProps): import("../image-builders").IConfigurableRunnerImageBuilder;
    /**
     * The function hosting the GitHub runner.
     */
    readonly function: lambda.Function;
    /**
     * Labels associated with this provider.
     */
    readonly labels: string[];
    /**
     * Grant principal used to add permissions to the runner role.
     */
    readonly grantPrincipal: iam.IPrincipal;
    /**
     * Docker image loaded with GitHub Actions Runner and its prerequisites. The image is built by an image builder and is specific to Lambda.
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
    private readonly defaultLabels;
    private readonly vpc?;
    private readonly securityGroups?;
    constructor(scope: Construct, id: string, props?: LambdaRunnerProviderProps);
    /**
     * The network connections associated with this resource.
     */
    get connections(): ec2.Connections;
    /**
     * Generate step function task(s) to start a new runner.
     *
     * Called by GithubRunners and shouldn't be called manually.
     *
     * @param parameters workflow job details
     */
    getStepFunctionTask(parameters: RunnerRuntimeParameters): stepfunctions.IChainable;
    private addImageUpdater;
    grantStateMachine(_: iam.IGrantable): void;
    status(statusFunctionRole: iam.IGrantable): IRunnerProviderStatus;
    private imageDigest;
}
/**
 * @deprecated use {@link LambdaRunnerProvider}
 */
export declare class LambdaRunner extends LambdaRunnerProvider {
}
