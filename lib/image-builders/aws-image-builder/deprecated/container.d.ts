import { aws_ec2 as ec2, aws_ecr as ecr, aws_logs as logs, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ImageBuilderBase } from './common';
import { Architecture, Os, RunnerAmi, RunnerImage, RunnerVersion } from '../../../providers';
import { ImageBuilderComponent } from '../builder';
/**
 * Properties for ContainerImageBuilder construct.
 */
export interface ContainerImageBuilderProps {
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
     * Parent image for the new Docker Image. You can use either Image Builder image ARN or public registry image.
     *
     * @default 'mcr.microsoft.com/windows/servercore:ltsc2019-amd64'
     */
    readonly parentImage?: string;
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
     * VPC to launch the runners in.
     *
     * @default default account VPC
     */
    readonly vpc?: ec2.IVpc;
    /**
     * Security group to assign to launched builder instances.
     *
     * @default new security group
     *
     * @deprecated use {@link securityGroups}
     */
    readonly securityGroup?: ec2.ISecurityGroup;
    /**
     * Security groups to assign to launched builder instances.
     *
     * @default new security group
     */
    readonly securityGroups?: ec2.ISecurityGroup[];
    /**
     * Where to place the network interfaces within the VPC.
     *
     * @default default VPC subnet
     */
    readonly subnetSelection?: ec2.SubnetSelection;
    /**
     * The instance type used to build the image.
     *
     * @default m6i.large
     */
    readonly instanceType?: ec2.InstanceType;
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
 * An image builder that uses AWS Image Builder to build Docker images pre-baked with all the GitHub Actions runner requirements. Builders can be used with runner providers.
 *
 * The CodeBuild builder is better and faster. Only use this one if you have no choice. For example, if you need Windows containers.
 *
 * Each builder re-runs automatically at a set interval to make sure the images contain the latest versions of everything.
 *
 * You can create an instance of this construct to customize the image used to spin-up runners. Some runner providers may require custom components. Check the runner provider documentation. The default components work with CodeBuild and Fargate.
 *
 * For example, to set a specific runner version, rebuild the image every 2 weeks, and add a few packages for the Fargate provider, use:
 *
 * ```
 * const builder = new ContainerImageBuilder(this, 'Builder', {
 *     runnerVersion: RunnerVersion.specific('2.293.0'),
 *     rebuildInterval: Duration.days(14),
 * });
 * new CodeBuildRunnerProvider(this, 'CodeBuild provider', {
 *     labels: ['custom-codebuild'],
 *     imageBuilder: builder,
 * });
 * ```
 *
 * @deprecated use RunnerImageBuilder
 */
export declare class ContainerImageBuilder extends ImageBuilderBase {
    readonly repository: ecr.IRepository;
    private readonly parentImage;
    private boundImage?;
    constructor(scope: Construct, id: string, props?: ContainerImageBuilderProps);
    private addBaseWindowsComponents;
    /**
     * Add a component to be installed before any other components. Useful for required system settings like certificates or proxy settings.
     * @param component
     */
    prependComponent(component: ImageBuilderComponent): void;
    /**
     * Add a component to be installed.
     * @param component
     */
    addComponent(component: ImageBuilderComponent): void;
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
    private imageCleaner;
    bindAmi(): RunnerAmi;
}
