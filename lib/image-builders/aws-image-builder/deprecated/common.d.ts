import { aws_ec2 as ec2, aws_iam as iam, aws_imagebuilder as imagebuilder, aws_logs as logs } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Architecture, Os, RunnerAmi, RunnerImage, RunnerVersion } from '../../../providers';
import { ImageBuilderBaseProps, IRunnerImageBuilder } from '../../common';
import { ImageBuilderComponent } from '../builder';
/**
 * @internal
 */
export declare abstract class ImageBuilderBase extends Construct implements IRunnerImageBuilder {
    protected readonly architecture: Architecture;
    protected readonly os: Os;
    protected readonly platform: 'Windows' | 'Linux';
    protected readonly description: string;
    protected readonly runnerVersion: RunnerVersion;
    protected components: ImageBuilderComponent[];
    private readonly vpc;
    private readonly subnetId;
    private readonly securityGroups;
    private readonly instanceType;
    private readonly rebuildInterval;
    private readonly logRetention;
    private readonly logRemovalPolicy;
    protected constructor(scope: Construct, id: string, props: ImageBuilderBaseProps);
    protected createLog(recipeName: string): logs.LogGroup;
    protected createInfrastructure(managedPolicies: iam.IManagedPolicy[]): imagebuilder.CfnInfrastructureConfiguration;
    protected createImage(infra: imagebuilder.CfnInfrastructureConfiguration, dist: imagebuilder.CfnDistributionConfiguration, log: logs.LogGroup, imageRecipeArn?: string, containerRecipeArn?: string): imagebuilder.CfnImage;
    protected createPipeline(infra: imagebuilder.CfnInfrastructureConfiguration, dist: imagebuilder.CfnDistributionConfiguration, log: logs.LogGroup, imageRecipeArn?: string, containerRecipeArn?: string): imagebuilder.CfnImagePipeline;
    /**
     * The network connections associated with this resource.
     */
    get connections(): ec2.Connections;
    abstract bindDockerImage(): RunnerImage;
    abstract bindAmi(): RunnerAmi;
}
