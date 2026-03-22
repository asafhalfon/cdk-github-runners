import * as cdk from 'aws-cdk-lib';
import { aws_codebuild as codebuild, aws_ec2 as ec2, aws_iam as iam, aws_sns as sns, Duration } from 'aws-cdk-lib';
import { Construct, IConstruct } from 'constructs';
import { RunnerImageBuilderBase, RunnerImageBuilderProps } from './common';
import { RunnerAmi, RunnerImage } from '../providers';
export interface CodeBuildRunnerImageBuilderProps {
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
     * Build image to use in CodeBuild. This is the image that's going to run the code that builds the runner image.
     *
     * The only action taken in CodeBuild is running `docker build`. You would therefore not need to change this setting often.
     *
     * @default Amazon Linux 2023
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
}
/**
 * @internal
 */
export declare class CodeBuildRunnerImageBuilder extends RunnerImageBuilderBase {
    private boundDockerImage?;
    private readonly os;
    private readonly architecture;
    private readonly baseImage;
    private readonly logRetention;
    private readonly logRemovalPolicy;
    private readonly vpc;
    private readonly securityGroups;
    private readonly buildImage;
    private readonly repository;
    private readonly subnetSelection;
    private readonly timeout;
    private readonly computeType;
    private readonly rebuildInterval;
    private readonly role;
    private readonly waitOnDeploy;
    private readonly dockerSetupCommands;
    constructor(scope: Construct, id: string, props?: RunnerImageBuilderProps);
    bindAmi(): RunnerAmi;
    bindDockerImage(): RunnerImage;
    private getDefaultBuildImage;
    private getDockerfileGenerationCommands;
    private getBuildSpec;
    private customResource;
    private rebuildImageOnSchedule;
    get connections(): ec2.Connections;
    get grantPrincipal(): iam.IPrincipal;
}
/**
 * @internal
 */
export declare class CodeBuildImageBuilderFailedBuildNotifier implements cdk.IAspect {
    private topic;
    constructor(topic: sns.ITopic);
    visit(node: IConstruct): void;
}
