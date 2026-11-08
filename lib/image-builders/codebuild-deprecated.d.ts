import { aws_codebuild as codebuild, aws_ec2 as ec2, aws_iam as iam, aws_logs as logs, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IRunnerImageBuilder } from './common';
import { Architecture, Os, RunnerAmi, RunnerImage, RunnerVersion } from '../providers';
/**
 * Properties for CodeBuildImageBuilder construct.
 */
export interface CodeBuildImageBuilderProps {
    /**
     * Image architecture.
     *
     * @default Architecture.X86_64
     */
    readonly architecture?: Architecture;
    /**
     * Image OS.
     *
     * @default OS.LINUX
     */
    readonly os?: Os;
    /**
     * Path to Dockerfile to be built. It can be a path to a Dockerfile, a folder containing a Dockerfile, or a zip file containing a Dockerfile.
     */
    readonly dockerfilePath: string;
    /**
     * Version of GitHub Runners to install.
     *
     * @default latest version available
     */
    readonly runnerVersion?: RunnerVersion;
    /**
     * Schedule the image to be rebuilt every given interval. Useful for keeping the image up-do-date with the latest GitHub runner version and latest OS updates.
     *
     * Set to zero to disable.
     *
     * @default Duration.days(7)
     */
    readonly rebuildInterval?: Duration;
    /**
     * VPC to build the image in.
     *
     * @default no VPC
     */
    readonly vpc?: ec2.IVpc;
    /**
     * Security Group to assign to this instance.
     *
     * @default public project with no security group
     */
    readonly securityGroup?: ec2.ISecurityGroup;
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
     * @default {@link ComputeType#SMALL}
     */
    readonly computeType?: codebuild.ComputeType;
    /**
     * Build image to use in CodeBuild. This is the image that's going to run the code that builds the runner image.
     *
     * The only action taken in CodeBuild is running `docker build`. You would therefore not need to change this setting often.
     *
     * @default Ubuntu 22.04 for x64 and Amazon Linux 2 for ARM64
     */
    readonly buildImage?: codebuild.IBuildImage;
    /**
     * The number of minutes after which AWS CodeBuild stops the build if it's
     * not complete. For valid values, see the timeoutInMinutes field in the AWS
     * CodeBuild User Guide.
     *
     * @default Duration.hours(1)
     */
    readonly timeout?: Duration;
    /**
     * The number of days log events are kept in CloudWatch Logs. When updating
     * this property, unsetting it doesn't remove the log retention policy. To
     * remove the retention policy, set the value to `INFINITE`.
     *
     * @default logs.RetentionDays.ONE_MONTH
     */
    readonly logRetention?: logs.RetentionDays;
    /**
     * Removal policy for logs of image builds. If deployment fails on the custom resource, try setting this to `RemovalPolicy.RETAIN`. This way the CodeBuild logs can still be viewed, and you can see why the build failed.
     *
     * We try to not leave anything behind when removed. But sometimes a log staying behind is useful.
     *
     * @default RemovalPolicy.DESTROY
     */
    readonly logRemovalPolicy?: RemovalPolicy;
}
/**
 * An image builder that uses CodeBuild to build Docker images pre-baked with all the GitHub Actions runner requirements. Builders can be used with runner providers.
 *
 * Each builder re-runs automatically at a set interval to make sure the images contain the latest versions of everything.
 *
 * You can create an instance of this construct to customize the image used to spin-up runners. Each provider has its own requirements for what an image should do. That's why they each provide their own Dockerfile.
 *
 * For example, to set a specific runner version, rebuild the image every 2 weeks, and add a few packages for the Fargate provider, use:
 *
 * ```
 * const builder = new CodeBuildImageBuilder(this, 'Builder', {
 *     dockerfilePath: FargateRunnerProvider.LINUX_X64_DOCKERFILE_PATH,
 *     runnerVersion: RunnerVersion.specific('2.293.0'),
 *     rebuildInterval: Duration.days(14),
 * });
 * builder.setBuildArg('EXTRA_PACKAGES', 'nginx xz-utils');
 * new FargateRunnerProvider(this, 'Fargate provider', {
 *     labels: ['customized-fargate'],
 *     imageBuilder: builder,
 * });
 * ```
 *
 * @deprecated use RunnerImageBuilder
 */
export declare class CodeBuildImageBuilder extends Construct implements IRunnerImageBuilder {
    readonly props: CodeBuildImageBuilderProps;
    /**
     * Bump this number every time the buildspec or any important setting of the project changes. It will force a rebuild of the image.
     * @private
     */
    private static BUILDSPEC_VERSION;
    private readonly architecture;
    private readonly os;
    private readonly repository;
    private readonly dockerfile;
    private preBuild;
    private postBuild;
    private buildArgs;
    private policyStatements;
    private secondaryAssets;
    private readonly buildImage;
    private boundImage?;
    constructor(scope: Construct, id: string, props: CodeBuildImageBuilderProps);
    /**
     * Uploads a folder to the build server at a given folder name.
     *
     * @param sourcePath path to source directory
     * @param destName name of destination folder
     */
    addFiles(sourcePath: string, destName: string): void;
    /**
     * Adds a command that runs before `docker build`.
     *
     * @param command command to add
     */
    addPreBuildCommand(command: string): void;
    /**
     * Adds a command that runs after `docker build` and `docker push`.
     *
     * @param command command to add
     */
    addPostBuildCommand(command: string): void;
    /**
     * Adds a build argument for Docker. See the documentation for the Dockerfile you're using for a list of supported build arguments.
     *
     * @param name build argument name
     * @param value build argument value
     */
    setBuildArg(name: string, value: string): void;
    /**
     * Add a policy statement to the builder to access resources required to the image build.
     *
     * @param statement IAM policy statement
     */
    addPolicyStatement(statement: iam.PolicyStatement): void;
    /**
     * Add extra trusted certificates. This helps deal with self-signed certificates for GitHub Enterprise Server.
     *
     * All first party Dockerfiles support this. Others may not.
     *
     * @param path path to directory containing a file called certs.pem containing all the required certificates
     */
    addExtraCertificates(path: string): void;
    /**
     * Called by IRunnerProvider to finalize settings and create the image builder.
     */
    bindDockerImage(): RunnerImage;
    private getBuildImage;
    private getBuildSpec;
    private customResource;
    /**
     * Return hash of all settings that can affect the result image so we can trigger the build when it changes.
     * @private
     */
    private hashBuildSettings;
    private rebuildImageOnSchedule;
    get connections(): ec2.Connections;
    bindAmi(): RunnerAmi;
}
