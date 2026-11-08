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
exports.AwsImageBuilderFailedBuildNotifier = exports.AwsImageBuilderRunnerImageBuilder = exports.ImageBuilderComponent = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_ecr_1 = require("aws-cdk-lib/aws-ecr");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const ami_1 = require("./ami");
const base_image_1 = require("./base-image");
const container_1 = require("./container");
const delete_resources_function_1 = require("./delete-resources-function");
const filter_failed_builds_function_1 = require("./filter-failed-builds-function");
const workflow_1 = require("./workflow");
const providers_1 = require("../../providers");
const utils_1 = require("../../utils");
const build_image_function_1 = require("../build-image-function");
const common_1 = require("../common");
/**
 * Components are a set of commands to run and optional files to add to an image. Components are the building blocks of images built by Image Builder.
 *
 * Example:
 *
 * ```
 * new ImageBuilderComponent(this, 'AWS CLI', {
 *   platform: 'Windows',
 *   displayName: 'AWS CLI',
 *   description: 'Install latest version of AWS CLI',
 *   commands: [
 *     '$p = Start-Process msiexec.exe -PassThru -Wait -ArgumentList \'/i https://awscli.amazonaws.com/AWSCLIV2.msi /qn\'',
 *     'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
 *   ],
 * }
 * ```
 *
 * @deprecated Use `RunnerImageComponent` instead as this be internal soon.
 */
class ImageBuilderComponent extends cdk.Resource {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.ImageBuilderComponent", version: "0.0.0" };
    /**
     * Component ARN.
     */
    arn;
    /**
     * Supported platform for the component.
     */
    platform;
    assets = [];
    constructor(scope, id, props) {
        super(scope, id);
        this.platform = props.platform;
        let steps = [];
        if (props.assets) {
            let inputs = [];
            let extractCommands = [];
            for (const asset of props.assets) {
                this.assets.push(asset.asset);
                if (asset.asset.isFile) {
                    inputs.push({
                        source: asset.asset.s3ObjectUrl,
                        destination: asset.path,
                    });
                }
                else if (asset.asset.isZipArchive) {
                    inputs.push({
                        source: asset.asset.s3ObjectUrl,
                        destination: `${asset.path}.zip`,
                    });
                    if (props.platform === 'Windows') {
                        extractCommands.push(`Expand-Archive "${asset.path}.zip" -DestinationPath "${asset.path}"`);
                        extractCommands.push(`del "${asset.path}.zip"`);
                    }
                    else {
                        extractCommands.push(`unzip "${asset.path}.zip" -d "${asset.path}"`);
                        extractCommands.push(`rm "${asset.path}.zip"`);
                    }
                }
                else {
                    throw new Error(`Unknown asset type: ${asset.asset}`);
                }
            }
            if (inputs.length > 0) {
                steps.push({
                    name: 'Download',
                    action: 'S3Download',
                    inputs,
                });
            }
            if (extractCommands.length > 0) {
                steps.push({
                    name: 'Extract',
                    action: props.platform === 'Linux' ? 'ExecuteBash' : 'ExecutePowerShell',
                    inputs: {
                        commands: this.prefixCommandsWithErrorHandling(props.platform, extractCommands),
                    },
                });
            }
        }
        if (props.commands.length > 0) {
            steps.push({
                name: 'Run',
                action: props.platform === 'Linux' ? 'ExecuteBash' : 'ExecutePowerShell',
                inputs: {
                    commands: this.prefixCommandsWithErrorHandling(props.platform, props.commands),
                },
            });
        }
        if (props.reboot ?? false) {
            steps.push({
                name: 'Reboot',
                action: 'Reboot',
                inputs: {},
            });
        }
        const data = {
            name: props.displayName,
            schemaVersion: '1.0',
            phases: [
                {
                    name: 'build',
                    steps,
                },
            ],
        };
        const name = (0, common_1.uniqueImageBuilderName)(this);
        const component = new aws_cdk_lib_1.aws_imagebuilder.CfnComponent(this, 'Component', {
            name: name,
            description: props.description,
            platform: props.platform,
            version: '1.0.0',
            data: JSON.stringify(data),
        });
        this.arn = component.attrArn;
    }
    /**
     * Grants read permissions to the principal on the assets buckets.
     *
     * @param grantee
     */
    grantAssetsRead(grantee) {
        for (const asset of this.assets) {
            asset.grantRead(grantee);
        }
    }
    prefixCommandsWithErrorHandling(platform, commands) {
        if (platform == 'Windows') {
            return [
                '$ErrorActionPreference = \'Stop\'',
                '$ProgressPreference = \'SilentlyContinue\'',
                'Set-PSDebug -Trace 1',
            ].concat(commands);
        }
        else {
            return [
                'set -ex',
            ].concat(commands);
        }
    }
}
exports.ImageBuilderComponent = ImageBuilderComponent;
/**
 * @internal
 */
class AwsImageBuilderRunnerImageBuilder extends common_1.RunnerImageBuilderBase {
    boundDockerImage;
    boundAmi;
    os;
    architecture;
    baseImage;
    baseAmi;
    logRetention;
    logRemovalPolicy;
    vpc;
    securityGroups;
    subnetSelection;
    rebuildInterval;
    boundComponents = [];
    instanceType;
    infrastructure;
    role;
    fastLaunchOptions;
    storageSize;
    waitOnDeploy;
    dockerSetupCommands;
    tags;
    amiTags;
    containerWorkflow;
    containerWorkflowExecutionRole;
    constructor(scope, id, props) {
        super(scope, id, props);
        if (props?.codeBuildOptions) {
            aws_cdk_lib_1.Annotations.of(this).addWarning('codeBuildOptions are ignored when using AWS Image Builder to build runner images.');
        }
        this.os = props?.os ?? providers_1.Os.LINUX_UBUNTU;
        this.architecture = props?.architecture ?? providers_1.Architecture.X86_64;
        this.rebuildInterval = props?.rebuildInterval ?? aws_cdk_lib_1.Duration.days(7);
        this.logRetention = props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH;
        this.logRemovalPolicy = props?.logRemovalPolicy ?? aws_cdk_lib_1.RemovalPolicy.DESTROY;
        this.vpc = props?.vpc ?? aws_cdk_lib_1.aws_ec2.Vpc.fromLookup(this, 'VPC', { isDefault: true });
        this.securityGroups = props?.securityGroups ?? [new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, 'SG', { vpc: this.vpc })];
        this.subnetSelection = props?.subnetSelection;
        this.instanceType = props?.awsImageBuilderOptions?.instanceType ?? aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.M6I, aws_cdk_lib_1.aws_ec2.InstanceSize.LARGE);
        this.fastLaunchOptions = props?.awsImageBuilderOptions?.fastLaunchOptions;
        this.storageSize = props?.awsImageBuilderOptions?.storageSize;
        this.amiTags = props?.awsImageBuilderOptions?.amiTags ?? {};
        if ('GitHubRunners:Stack' in this.amiTags) {
            aws_cdk_lib_1.Annotations.of(this).addWarning('Overriding the GitHubRunners:Stack AMI tag can prevent old AMIs from being deleted. You will have to delete them yourself.');
        }
        this.waitOnDeploy = props?.waitOnDeploy ?? true;
        this.dockerSetupCommands = props?.dockerSetupCommands ?? [];
        // normalize BaseContainerImageInput to BaseContainerImage (string support is deprecated, only at public API level)
        const baseDockerImageInput = props?.baseDockerImage ?? (0, container_1.defaultBaseDockerImage)(this.os);
        this.baseImage = typeof baseDockerImageInput === 'string' ? base_image_1.BaseContainerImage.fromString(baseDockerImageInput) : baseDockerImageInput;
        // normalize BaseImageInput to BaseImage (string support is deprecated, only at public API level)
        const baseAmiInput = props?.baseAmi ?? (0, ami_1.defaultBaseAmi)(this, this.os, this.architecture);
        this.baseAmi = typeof baseAmiInput === 'string' ? base_image_1.BaseImage.fromString(baseAmiInput) : baseAmiInput;
        // warn if using deprecated string format
        if (props?.baseDockerImage && typeof props.baseDockerImage === 'string') {
            aws_cdk_lib_1.Annotations.of(this).addWarning('Passing baseDockerImage as a string is deprecated. Please use BaseContainerImage static factory methods instead, e.g., BaseContainerImage.fromDockerHub("ubuntu", "22.04") or BaseContainerImage.fromString("public.ecr.aws/lts/ubuntu:22.04")');
        }
        if (props?.baseAmi && typeof props.baseAmi === 'string') {
            aws_cdk_lib_1.Annotations.of(this).addWarning('Passing baseAmi as a string is deprecated. Please use BaseImage static factory methods instead, e.g., BaseImage.fromAmiId("ami-12345") or BaseImage.fromString("arn:aws:...")');
        }
        // tags for finding resources
        this.tags = {
            'GitHubRunners:Stack': cdk.Stack.of(this).stackName,
            'GitHubRunners:Builder': this.node.path,
        };
        // confirm instance type
        if (!this.architecture.instanceTypeMatch(this.instanceType)) {
            throw new Error(`Builder architecture (${this.architecture.name}) doesn't match selected instance type (${this.instanceType} / ${this.instanceType.architecture})`);
        }
        // warn against isolated networks
        if (props?.subnetSelection?.subnetType == aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_ISOLATED) {
            aws_cdk_lib_1.Annotations.of(this).addWarning('Private isolated subnets cannot pull from public ECR and VPC endpoint is not supported yet. ' +
                'See https://github.com/aws/containers-roadmap/issues/1160');
        }
        // role to be used by AWS Image Builder
        this.role = new aws_cdk_lib_1.aws_iam.Role(this, 'Role', {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('ec2.amazonaws.com'),
        });
        // create container workflow if docker setup commands are provided
        if (this.dockerSetupCommands.length > 0) {
            this.containerWorkflow = (0, workflow_1.generateBuildWorkflowWithDockerSetupCommands)(this, 'Build', this.os, this.dockerSetupCommands);
            this.containerWorkflowExecutionRole = aws_cdk_lib_1.aws_iam.Role.fromRoleArn(this, 'Image Builder Role', cdk.Stack.of(this).formatArn({
                service: 'iam',
                region: '',
                resource: 'role',
                resourceName: 'aws-service-role/imagebuilder.amazonaws.com/AWSServiceRoleForImageBuilder',
            }));
        }
    }
    platform() {
        if (this.os.is(providers_1.Os.WINDOWS)) {
            return 'Windows';
        }
        if (this.os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
            return 'Linux';
        }
        throw new Error(`OS ${this.os.name} is not supported by AWS Image Builder`);
    }
    /**
     * Called by IRunnerProvider to finalize settings and create the image builder.
     */
    bindDockerImage() {
        if (this.boundDockerImage) {
            return this.boundDockerImage;
        }
        // old images are deleted by imageCleaner() as it's the only thing that knows which one is still in use.
        // the lifecycle rule only picks up images that lost their tags, which the cleaner can no longer find through EC2 Image Builder.
        const repository = new aws_cdk_lib_1.aws_ecr.Repository(this, 'Repository', {
            imageScanOnPush: true,
            imageTagMutability: aws_ecr_1.TagMutability.MUTABLE,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            lifecycleRules: [
                {
                    description: 'Remove untagged images left behind by interrupted pushes',
                    tagStatus: aws_ecr_1.TagStatus.UNTAGGED,
                    maxImageAge: aws_cdk_lib_1.Duration.days(1),
                },
            ],
        });
        const dist = new aws_cdk_lib_1.aws_imagebuilder.CfnDistributionConfiguration(this, 'Docker Distribution', {
            name: (0, common_1.uniqueImageBuilderName)(this),
            // description: this.description,
            distributions: [
                {
                    region: aws_cdk_lib_1.Stack.of(this).region,
                    containerDistributionConfiguration: {
                        ContainerTags: ['latest'],
                        TargetRepository: {
                            Service: 'ECR',
                            RepositoryName: repository.repositoryName,
                        },
                    },
                },
            ],
            tags: this.tags,
        });
        let dockerfileTemplate = `FROM {{{ imagebuilder:parentImage }}}
{{{ imagebuilder:environments }}}
{{{ imagebuilder:components }}}`;
        for (const c of this.components) {
            const commands = c.getDockerCommands(this.os, this.architecture);
            if (commands.length > 0) {
                dockerfileTemplate += '\n' + commands.join('\n') + '\n';
            }
        }
        const recipe = new container_1.ContainerRecipe(this, 'Container Recipe', {
            platform: this.platform(),
            components: this.bindComponents(),
            targetRepository: repository,
            dockerfileTemplate: dockerfileTemplate,
            parentImage: this.baseImage.image,
            tags: this.tags,
        });
        const log = this.createLog('Docker Log', recipe.name);
        const infra = this.createInfrastructure([
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilderECRContainerBuilds'),
        ]);
        if (this.waitOnDeploy) {
            this.createImage(infra, dist, log, undefined, recipe.arn);
        }
        this.dockerImageCleaner(recipe);
        this.createPipeline(infra, dist, log, undefined, recipe.arn);
        this.boundDockerImage = {
            imageRepository: repository,
            imageTag: 'latest',
            os: this.os,
            architecture: this.architecture,
            logGroup: log,
            runnerVersion: providers_1.RunnerVersion.specific('unknown'),
            // no dependable as CloudFormation will fail to get image ARN once the image is deleted (we delete old images daily)
        };
        return this.boundDockerImage;
    }
    dockerImageCleaner(recipe) {
        // this is here to provide safe upgrade from old cdk-github-runners versions
        // this lambda was used by a custom resource to delete all images builds on cleanup
        // if we remove the custom resource and the lambda, the old images will be deleted on update
        // keeping the lambda but removing the permissions will make sure that deletion will fail
        const oldDeleter = (0, utils_1.singletonLambda)(build_image_function_1.BuildImageFunction, this, 'build-image', {
            description: 'Custom resource handler that triggers CodeBuild to build runner images',
            timeout: cdk.Duration.minutes(3),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.RUNNER_IMAGE_BUILD),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
        });
        oldDeleter.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            effect: aws_cdk_lib_1.aws_iam.Effect.DENY,
            actions: ['imagebuilder:DeleteImage'],
            resources: ['*'],
        }));
        // delete old Docker images daily, and everything when this builder is removed
        this.imageCleaner('Container', recipe.name, recipe.version);
    }
    createLog(id, recipeName) {
        return new aws_cdk_lib_1.aws_logs.LogGroup(this, id, {
            logGroupName: `/aws/imagebuilder/${recipeName}`,
            retention: this.logRetention,
            removalPolicy: this.logRemovalPolicy,
        });
    }
    createInfrastructure(managedPolicies) {
        if (this.infrastructure) {
            return this.infrastructure;
        }
        for (const managedPolicy of managedPolicies) {
            this.role.addManagedPolicy(managedPolicy);
        }
        for (const component of this.boundComponents) {
            component.grantAssetsRead(this.role);
        }
        this.infrastructure = new aws_cdk_lib_1.aws_imagebuilder.CfnInfrastructureConfiguration(this, 'Infrastructure', {
            name: (0, common_1.uniqueImageBuilderName)(this),
            // description: this.description,
            subnetId: this.vpc?.selectSubnets(this.subnetSelection).subnetIds[0],
            securityGroupIds: this.securityGroups?.map(sg => sg.securityGroupId),
            instanceTypes: [this.instanceType.toString()],
            instanceMetadataOptions: {
                httpTokens: 'required',
                // Container builds require a minimum of two hops.
                httpPutResponseHopLimit: 2,
            },
            instanceProfileName: new aws_cdk_lib_1.aws_iam.CfnInstanceProfile(this, 'Instance Profile', {
                roles: [
                    this.role.roleName,
                ],
            }).ref,
        });
        return this.infrastructure;
    }
    workflowConfig(containerRecipeArn) {
        if (this.containerWorkflow && this.containerWorkflowExecutionRole && containerRecipeArn) {
            return {
                workflows: [{
                        workflowArn: this.containerWorkflow.arn,
                    }],
                executionRole: this.containerWorkflowExecutionRole.roleArn,
            };
        }
        return undefined;
    }
    createImage(infra, dist, log, imageRecipeArn, containerRecipeArn) {
        const image = new aws_cdk_lib_1.aws_imagebuilder.CfnImage(this, this.amiOrContainerId('Image', imageRecipeArn, containerRecipeArn), {
            infrastructureConfigurationArn: infra.attrArn,
            distributionConfigurationArn: dist.attrArn,
            imageRecipeArn,
            containerRecipeArn,
            imageTestsConfiguration: {
                imageTestsEnabled: false,
            },
            tags: this.tags,
            ...this.workflowConfig(containerRecipeArn),
        });
        image.node.addDependency(infra);
        image.node.addDependency(log);
        // do not delete the image as it will be deleted by imageCleaner().
        // if we delete it here, imageCleaner() won't be able to find the image.
        // if imageCleaner() can't find the image, it won't be able to delete the linked AMI/Docker image.
        // use RETAIN_ON_UPDATE_OR_DELETE, so everything is cleaned only on rollback.
        image.applyRemovalPolicy(aws_cdk_lib_1.RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);
        return image;
    }
    amiOrContainerId(baseId, imageRecipeArn, containerRecipeArn) {
        if (imageRecipeArn) {
            return `AMI ${baseId}`;
        }
        if (containerRecipeArn) {
            return `Docker ${baseId}`;
        }
        throw new Error('Either imageRecipeArn or containerRecipeArn must be defined');
    }
    createPipeline(infra, dist, log, imageRecipeArn, containerRecipeArn) {
        // set schedule
        let scheduleOptions;
        if (this.rebuildInterval.toMilliseconds() > 0) {
            scheduleOptions = {
                scheduleExpression: aws_cdk_lib_1.aws_events.Schedule.rate(this.rebuildInterval).expressionString,
                pipelineExecutionStartCondition: 'EXPRESSION_MATCH_ONLY',
            };
        }
        // generate pipeline
        const pipeline = new aws_cdk_lib_1.aws_imagebuilder.CfnImagePipeline(this, this.amiOrContainerId('Pipeline', imageRecipeArn, containerRecipeArn), {
            name: (0, common_1.uniqueImageBuilderName)(this),
            // description: this.description,
            infrastructureConfigurationArn: infra.attrArn,
            distributionConfigurationArn: dist.attrArn,
            imageRecipeArn,
            containerRecipeArn,
            schedule: scheduleOptions,
            imageTestsConfiguration: {
                imageTestsEnabled: false,
            },
            tags: this.tags,
            ...this.workflowConfig(containerRecipeArn),
        });
        pipeline.node.addDependency(infra);
        pipeline.node.addDependency(log);
        return pipeline;
    }
    /**
     * The network connections associated with this resource.
     */
    get connections() {
        return new aws_cdk_lib_1.aws_ec2.Connections({ securityGroups: this.securityGroups });
    }
    get grantPrincipal() {
        return this.role;
    }
    bindAmi() {
        if (this.boundAmi) {
            return this.boundAmi;
        }
        const launchTemplate = new aws_cdk_lib_1.aws_ec2.LaunchTemplate(this, 'Launch template', {
            requireImdsv2: true,
        });
        const launchTemplateConfigs = [{
                launchTemplateId: launchTemplate.launchTemplateId,
                setDefaultVersion: true,
            }];
        const fastLaunchConfigs = [];
        if (this.fastLaunchOptions?.enabled ?? false) {
            if (!this.os.is(providers_1.Os.WINDOWS)) {
                throw new Error('Fast launch is only supported for Windows');
            }
            // create a separate launch template for fast launch so:
            //  - settings don't affect the runners
            //  - enabling fast launch on an existing builder works (without a new launch template, EC2 Image Builder will use the first version of the launch template, which doesn't have instance or VPC config)
            //  - setting vpc + subnet on the main launch template will cause RunInstances to fail
            //  - EC2 Image Builder seems to get confused with which launch template version to base any new version on, so a new template is always best
            const fastLaunchTemplate = new aws_cdk_lib_1.aws_ec2.CfnLaunchTemplate(this, 'Fast Launch Template', {
                launchTemplateData: {
                    metadataOptions: {
                        httpTokens: 'required',
                    },
                    instanceType: this.instanceType.toString(),
                    networkInterfaces: [{
                            subnetId: this.vpc?.selectSubnets(this.subnetSelection).subnetIds[0],
                            deviceIndex: 0,
                            groups: this.securityGroups.map(sg => sg.securityGroupId),
                        }],
                    tagSpecifications: [
                        {
                            resourceType: 'instance',
                            tags: [{
                                    key: 'Name',
                                    value: `${this.node.path}/Fast Launch Instance`,
                                }],
                        },
                        {
                            resourceType: 'volume',
                            tags: [{
                                    key: 'Name',
                                    value: `${this.node.path}/Fast Launch Instance`,
                                }],
                        },
                    ],
                },
                tagSpecifications: [{
                        resourceType: 'launch-template',
                        tags: [{
                                key: 'Name',
                                value: `${this.node.path}/Fast Launch Template`,
                            }],
                    }],
            });
            launchTemplateConfigs.push({
                launchTemplateId: fastLaunchTemplate.attrLaunchTemplateId,
                setDefaultVersion: true,
            });
            fastLaunchConfigs.push({
                enabled: true,
                launchTemplate: {
                    launchTemplateId: fastLaunchTemplate.attrLaunchTemplateId,
                },
                maxParallelLaunches: this.fastLaunchOptions?.maxParallelLaunches ?? 6,
                snapshotConfiguration: {
                    targetResourceCount: this.fastLaunchOptions?.targetResourceCount ?? 1,
                },
            });
        }
        const stackName = cdk.Stack.of(this).stackName;
        const builderName = this.node.path;
        const dist = new aws_cdk_lib_1.aws_imagebuilder.CfnDistributionConfiguration(this, 'AMI Distribution', {
            name: (0, common_1.uniqueImageBuilderName)(this),
            // description: this.description,
            distributions: [
                {
                    region: aws_cdk_lib_1.Stack.of(this).region,
                    amiDistributionConfiguration: {
                        Name: `${cdk.Names.uniqueResourceName(this, {
                            maxLength: 100,
                            separator: '-',
                            allowedSpecialCharacters: '_-',
                        })}-{{ imagebuilder:buildDate }}`,
                        AmiTags: {
                            'Name': this.node.id,
                            'GitHubRunners:Stack': stackName,
                            'GitHubRunners:Builder': builderName,
                            ...this.amiTags,
                        },
                    },
                    launchTemplateConfigurations: launchTemplateConfigs,
                    fastLaunchConfigurations: fastLaunchConfigs.length > 0 ? fastLaunchConfigs : undefined,
                },
            ],
            tags: this.tags,
        });
        const recipe = new ami_1.AmiRecipe(this, 'Ami Recipe', {
            platform: this.platform(),
            components: this.bindComponents(),
            architecture: this.architecture,
            baseAmi: this.baseAmi,
            storageSize: this.storageSize,
            tags: this.tags,
        });
        const log = this.createLog('Ami Log', recipe.name);
        const infra = this.createInfrastructure([
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilder'),
        ]);
        if (this.waitOnDeploy) {
            this.createImage(infra, dist, log, recipe.arn, undefined);
        }
        this.createPipeline(infra, dist, log, recipe.arn, undefined);
        this.boundAmi = {
            launchTemplate: launchTemplate,
            architecture: this.architecture,
            os: this.os,
            logGroup: log,
            runnerVersion: providers_1.RunnerVersion.specific('unknown'),
            cacheKey: recipe.version, // re-evaluate AMI whenever the recipe changes
        };
        this.amiCleaner(recipe, launchTemplate);
        return this.boundAmi;
    }
    amiCleaner(recipe, launchTemplate) {
        // this is here to provide safe upgrade from old cdk-github-runners versions
        // this lambda was used by a custom resource to delete all amis when the builder was removed
        // if we remove the custom resource, role and lambda, all amis will be deleted on update
        // keeping the just role but removing the permissions along with the custom resource will make sure that deletion will fail
        const stack = cdk.Stack.of(this);
        if (stack.node.tryFindChild('delete-ami-dcc036c8-876b-451e-a2c1-552f9e06e9e1') == undefined) {
            const role = new aws_cdk_lib_1.aws_iam.Role(stack, 'delete-ami-dcc036c8-876b-451e-a2c1-552f9e06e9e1', {
                description: 'Empty role to prevent deletion of AMIs on cdk-github-runners upgrade',
                assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
                inlinePolicies: {
                    deny: new aws_cdk_lib_1.aws_iam.PolicyDocument({
                        statements: [
                            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                                actions: ['ec2:DeregisterImage', 'ec2:DeleteSnapshot'],
                                resources: ['*'],
                                effect: aws_cdk_lib_1.aws_iam.Effect.DENY,
                            }),
                        ],
                    }),
                },
            });
            const l1role = role.node.defaultChild;
            l1role.overrideLogicalId('deleteamidcc036c8876b451ea2c1552f9e06e9e1ServiceRole1CC58A6F');
        }
        // delete old AMIs daily, and everything when this builder is removed
        this.imageCleaner('Image', recipe.name, recipe.version, launchTemplate);
    }
    bindComponents() {
        if (this.boundComponents.length == 0) {
            this.boundComponents.push(...this.components.map(c => c._asAwsImageBuilderComponent(this, this.os, this.architecture)));
        }
        return this.boundComponents;
    }
    /**
     * Set up cleanup of images built by this builder
     *
     * A single Lambda handles both paths. On a schedule it deletes old images, but keeping the latest 2 and the one the launch template points at.
     * On removal of the builder, or deletion of the stack, a custom resource has it delete every image of this builder.
     *
     * The custom resource always reports the same physical resource id, so CloudFormation never replaces it. That's what makes deleting everything
     * safe: `Delete` can then only mean the builder is going away, and never an update or a rollback of one.
     */
    imageCleaner(type, recipeName, version, launchTemplate) {
        const cleanerFunction = (0, utils_1.singletonLambda)(delete_resources_function_1.DeleteResourcesFunction, this, 'aws-image-builder-delete-resources', {
            description: 'Deletes old EC2 Image Builder runner images, and all of them when their builder is removed',
            initialPolicy: [
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: [
                        'imagebuilder:ListImages',
                        'imagebuilder:ListImageBuildVersions',
                        'imagebuilder:DeleteImage',
                    ],
                    resources: ['*'],
                }),
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: ['ec2:DescribeImages', 'ec2:DescribeLaunchTemplateVersions'],
                    resources: ['*'],
                }),
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: ['ec2:DeregisterImage', 'ec2:DeleteSnapshot'],
                    resources: ['*'],
                    conditions: {
                        StringEquals: {
                            'aws:ResourceTag/GitHubRunners:Stack': cdk.Stack.of(this).stackName,
                        },
                    },
                }),
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: ['ecr:BatchDeleteImage'],
                    resources: ['*'],
                }),
            ],
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.RUNNER_IMAGE_BUILD),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            timeout: cdk.Duration.minutes(10),
        });
        const target = {
            RecipeName: recipeName,
            LaunchTemplateId: launchTemplate?.launchTemplateId,
        };
        // delete everything when this builder is removed or the stack is deleted
        new aws_cdk_lib_1.CustomResource(this, `${type} Cleaner`, {
            serviceToken: cleanerFunction.functionArn,
            resourceType: 'Custom::ImageBuilder-Delete-Resources',
            properties: {
                ...target,
                // this one property is for backwards compatibility. versions 0.16.0 and older used it. if we remove it and an upgrade from 0.16.0 fails, then
                // old code can end up running on these properties as it cleans up the update. without this property, the old code will delete every image in
                // the account. it assumed ImageVersionArn was sent and passed it as-is to ListImageBuildVersionsCommand which will happily return all images
                // in the account when imageVersionArn is undefined.
                // it is also used for successful upgrades from 0.16.0 with the corner case of the deployment also removing a builder at the same time as the
                // upgrade. in that case, the new code will run against the old properties. so technically not the one we send here, but it's relevant.
                ImageVersionArn: cdk.Stack.of(this).formatArn({
                    service: 'imagebuilder',
                    resource: 'image',
                    resourceName: `${recipeName.toLowerCase()}/${version}`,
                    arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
                }),
            },
        });
        // delete old images daily
        new aws_cdk_lib_1.aws_events.Rule(this, `${type} Cleaner Schedule`, {
            description: `Delete old GitHub Runner images for ${this.node.path}`,
            schedule: aws_cdk_lib_1.aws_events.Schedule.rate(aws_cdk_lib_1.Duration.days(1)),
            targets: [
                new aws_cdk_lib_1.aws_events_targets.LambdaFunction(cleanerFunction, {
                    event: aws_cdk_lib_1.aws_events.RuleTargetInput.fromObject({
                        RequestType: 'Scheduled',
                        ...target,
                    }),
                }),
            ],
        });
    }
}
exports.AwsImageBuilderRunnerImageBuilder = AwsImageBuilderRunnerImageBuilder;
/**
 * @internal
 */
class AwsImageBuilderFailedBuildNotifier {
    topic;
    static createFilteringTopic(scope, targetTopic) {
        const topic = new aws_cdk_lib_1.aws_sns.Topic(scope, 'Image Builder Builds');
        const filter = new filter_failed_builds_function_1.FilterFailedBuildsFunction(scope, 'Image Builder Builds Filter', {
            logGroup: (0, utils_1.singletonLogGroup)(scope, utils_1.SingletonLogType.RUNNER_IMAGE_BUILD),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            environment: {
                TARGET_TOPIC_ARN: targetTopic.topicArn,
            },
        });
        topic.addSubscription(new aws_cdk_lib_1.aws_sns_subscriptions.LambdaSubscription(filter));
        targetTopic.grantPublish(filter);
        return topic;
    }
    constructor(topic) {
        this.topic = topic;
    }
    visit(node) {
        if (node instanceof AwsImageBuilderRunnerImageBuilder) {
            const builder = node;
            const infraNode = builder.node.tryFindChild('Infrastructure');
            if (infraNode) {
                const infra = infraNode;
                infra.snsTopicArn = this.topic.topicArn;
            }
            else {
                cdk.Annotations.of(builder).addWarning('Unused builder cannot get notifications of failed builds');
            }
        }
    }
}
exports.AwsImageBuilderFailedBuildNotifier = AwsImageBuilderFailedBuildNotifier;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9hd3MtaW1hZ2UtYnVpbGRlci9idWlsZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsNkNBaUJxQjtBQUNyQixpREFBK0Q7QUFDL0QsbURBQXFEO0FBRXJELCtCQUFrRDtBQUNsRCw2Q0FBNkQ7QUFDN0QsMkNBQXNFO0FBQ3RFLDJFQUFzRTtBQUV0RSxtRkFBNkU7QUFDN0UseUNBQW9GO0FBQ3BGLCtDQUEwRjtBQUMxRix1Q0FBbUY7QUFDbkYsa0VBQTZEO0FBQzdELHNDQUFvRztBQWlJcEc7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQWtCRztBQUNILE1BQWEscUJBQXNCLFNBQVEsR0FBRyxDQUFDLFFBQVE7O0lBQ3JEOztPQUVHO0lBQ2EsR0FBRyxDQUFTO0lBRTVCOztPQUVHO0lBQ2EsUUFBUSxDQUFzQjtJQUU3QixNQUFNLEdBQXNCLEVBQUUsQ0FBQztJQUVoRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNDO1FBQzlFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsSUFBSSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDO1FBRS9CLElBQUksS0FBSyxHQUFVLEVBQUUsQ0FBQztRQUV0QixJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztZQUNqQixJQUFJLE1BQU0sR0FBVSxFQUFFLENBQUM7WUFDdkIsSUFBSSxlQUFlLEdBQWEsRUFBRSxDQUFDO1lBQ25DLEtBQUssTUFBTSxLQUFLLElBQUksS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUNqQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBRTlCLElBQUksS0FBSyxDQUFD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QU0sS0FBSyxHQUFHLFNBQXdELENBQUM7Z0JBQ3ZFLEtBQUssQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUM7WUFDMUMsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLEdBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFVBQVUsQ0FBQywwREFBMEQsQ0FBQyxDQUFDO1lBQ3JHLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBaENELGdGQWdDQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBBbm5vdGF0aW9ucyxcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19lY3IgYXMgZWNyLFxuICBhd3NfZXZlbnRzIGFzIGV2ZW50cyxcbiAgYXdzX2V2ZW50c190YXJnZXRzIGFzIGV2ZW50c190YXJnZXRzLFxuICBhd3NfaWFtIGFzIGlhbSxcbiAgYXdzX2ltYWdlYnVpbGRlciBhcyBpbWFnZWJ1aWxkZXIsXG4gIGF3c19sYW1iZGEgYXMgbGFtYmRhLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3NfczNfYXNzZXRzIGFzIHMzX2Fzc2V0cyxcbiAgYXdzX3NucyBhcyBzbnMsXG4gIGF3c19zbnNfc3Vic2NyaXB0aW9ucyBhcyBzdWJzLFxuICBDdXN0b21SZXNvdXJjZSxcbiAgRHVyYXRpb24sXG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrLFxufSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBUYWdNdXRhYmlsaXR5LCBUYWdTdGF0dXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QsIElDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEFtaVJlY2lwZSwgZGVmYXVsdEJhc2VBbWkgfSBmcm9tICcuL2FtaSc7XG5pbXBvcnQgeyBCYXNlQ29udGFpbmVySW1hZ2UsIEJhc2VJbWFnZSB9IGZyb20gJy4vYmFzZS1pbWFnZSc7XG5pbXBvcnQgeyBDb250YWluZXJSZWNpcGUsIGRlZmF1bHRCYXNlRG9ja2VySW1hZ2UgfSBmcm9tICcuL2NvbnRhaW5lcic7XG5pbXBvcnQgeyBEZWxldGVSZXNvdXJjZXNGdW5jdGlvbiB9IGZyb20gJy4vZGVsZXRlLXJlc291cmNlcy1mdW5jdGlvbic7XG5pbXBvcnQgeyBDbGVhbmVyVGFyZ2V0LCBEZWxldGVSZXNvdXJjZXNQcm9wcywgU2NoZWR1bGVkQ2xlYW51cEV2ZW50IH0gZnJvbSAnLi9kZWxldGUtcmVzb3VyY2VzLmxhbWJkYSc7XG5pbXBvcnQgeyBGaWx0ZXJGYWlsZWRCdWlsZHNGdW5jdGlvbiB9IGZyb20gJy4vZmlsdGVyLWZhaWxlZC1idWlsZHMtZnVuY3Rpb24nO1xuaW1wb3J0IHsgZ2VuZXJhdGVCdWlsZFdvcmtmbG93V2l0aERvY2tlclNldHVwQ29tbWFuZHMsIFdvcmtmbG93IH0gZnJvbSAnLi93b3JrZmxvdyc7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIE9zLCBSdW5uZXJBbWksIFJ1bm5lckltYWdlLCBSdW5uZXJWZXJzaW9uIH0gZnJvbSAnLi4vLi4vcHJvdmlkZXJzJztcbmltcG9ydCB7IHNpbmdsZXRvbkxvZ0dyb3VwLCBzaW5nbGV0b25MYW1iZGEsIFNpbmdsZXRvbkxvZ1R5cGUgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBCdWlsZEltYWdlRnVuY3Rpb24gfSBmcm9tICcuLi9idWlsZC1pbWFnZS1mdW5jdGlvbic7XG5pbXBvcnQgeyBSdW5uZXJJbWFnZUJ1aWxkZXJCYXNlLCBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcywgdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSB9IGZyb20gJy4uL2NvbW1vbic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMge1xuICAvKipcbiAgICogVGhlIGluc3RhbmNlIHR5cGUgdXNlZCB0byBidWlsZCB0aGUgaW1hZ2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IG02aS5sYXJnZVxuICAgKi9cbiAgcmVhZG9ubHkgaW5zdGFuY2VUeXBlPzogZWMyLkluc3RhbmNlVHlwZTtcblxuICAvKipcbiAgICogU2l6ZSBvZiB2b2x1bWUgYXZhaWxhYmxlIGZvciBidWlsZGVyIGluc3RhbmNlcy4gVGhpcyBtb2RpZmllcyB0aGUgYm9vdCB2b2x1bWUgc2l6ZSBhbmQgZG9lc24ndCBhZGQgYW55IGFkZGl0aW9uYWwgdm9sdW1lcy5cbiAgICpcbiAgICogVXNlIHRoaXMgaWYgeW91J3JlIGJ1aWxkaW5nIGltYWdlcyB3aXRoIGJpZyBjb21wb25lbnRzIGFuZCBuZWVkIG1vcmUgc3BhY2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgc2l6ZSBmb3IgQU1JICh1c3VhbGx5IDMwR0IgZm9yIExpbnV4IGFuZCA1MEdCIGZvciBXaW5kb3dzKVxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcblxuICAvKipcbiAgICogT3B0aW9ucyBmb3IgZmFzdCBsYXVuY2guXG4gICAqXG4gICAqIFRoaXMgaXMgb25seSBzdXBwb3J0ZWQgZm9yIFdpbmRvd3MgQU1Jcy5cbiAgICpcbiAgICogQGRlZmF1bHQgZGlzYWJsZWRcbiAgICovXG4gIHJlYWRvbmx5IGZhc3RMYXVuY2hPcHRpb25zPzogRmFzdExhdW5jaE9wdGlvbnM7XG5cbiAgLyoqXG4gICAqIEFkZGl0aW9uYWwgdGFncyB0byBhcHBseSB0byB0aGUgQU1JIGJ1aWx0IGJ5IHRoaXMgYnVpbGRlci5cbiAgICpcbiAgICogVGhlc2UgYWRkaXRpb25hbCB0YWdzIGFyZSBzZXQgb24gdG9wIG9mIGBOYW1lYCwgYEdpdEh1YlJ1bm5lcnM6U3RhY2tgLCBhbmQgYEdpdEh1YlJ1bm5lcnM6QnVpbGRlcmAuXG4gICAqIFlvdSBtYXkgb3ZlcnJpZGUgdGhlIGJ1aWx0LWluIHRhZ3MuXG4gICAqXG4gICAqIE92ZXJyaWRpbmcgYEdpdEh1YlJ1bm5lcnM6U3RhY2tgIHdpbGwgc3RvcCBvbGQgQU1JcyBmcm9tIGJlaW5nIGRlbGV0ZWQsIGFzIHRoZSBpbWFnZSBjbGVhbmVyIGlzIG9ubHkgYWxsb3dlZCB0byB0b3VjaCBBTUlzIHRhZ2dlZCB3aXRoIHRoZSBuYW1lXG4gICAqIG9mIHRoZSBzdGFjayBpdCBsaXZlcyBpbi4gWW91IHdpbGwgaGF2ZSB0byBkZWxldGUgdGhvc2UgQU1JcyB5b3Vyc2VsZi5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gYWRkaXRpb25hbCB0YWdzXG4gICAqL1xuICByZWFkb25seSBhbWlUYWdzPzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbn1cblxuLyoqXG4gKiBPcHRpb25zIGZvciBmYXN0IGxhdW5jaC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBGYXN0TGF1bmNoT3B0aW9ucyB7XG4gIC8qKlxuICAgKiBFbmFibGUgZmFzdCBsYXVuY2ggZm9yIEFNSXMgZ2VuZXJhdGVkIGJ5IHRoaXMgYnVpbGRlci4gSXQgY3JlYXRlcyBhIHNuYXBzaG90IG9mIHRoZSByb290IHZvbHVtZSBhbmQgdXNlcyBpdCB0byBsYXVuY2ggbmV3IGluc3RhbmNlcyBmYXN0ZXIuXG4gICAqXG4gICAqIFRoaXMgaXMgb25seSBzdXBwb3J0ZWQgZm9yIFdpbmRvd3MgQU1Jcy5cbiAgICpcbiAgICogQG5vdGUgdGhpcyBmZWF0dXJlIGNvbWVzIHdpdGggYWRkaXRpb25hbCByZXNvdXJjZSBjb3N0cy4gU2VlIHRoZSBkb2N1bWVudGF0aW9uIGZvciBtb3JlIGRldGFpbHMuIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9BV1NFQzIvbGF0ZXN0L1dpbmRvd3NHdWlkZS93aW4tZmFzdC1sYXVuY2gtbWFuYWdlLWNvc3RzLmh0bWxcbiAgICogQG5vdGUgZW5hYmxpbmcgZmFzdCBsYXVuY2ggb24gYW4gZXhpc3RpbmcgYnVpbGRlciB3aWxsIG5vdCBlbmFibGUgaXQgZm9yIGV4aXN0aW5nIEFNSXMuIEl0IHdpbGwgb25seSBhZmZlY3QgbmV3IEFNSXMuIElmIHlvdSB3YW50IGltbWVkaWF0ZSBlZmZlY3QsIHRyaWdnZXIgYSBuZXcgaW1hZ2UgYnVpbGQuIEFsdGVybmF0aXZlbHksIHlvdSBjYW4gY3JlYXRlIGEgbmV3IGJ1aWxkZXIgd2l0aCBmYXN0IGxhdW5jaCBlbmFibGVkIGFuZCB1c2UgaXQgZm9yIG5ldyBBTUlzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgZW5hYmxlZD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFRoZSBtYXhpbXVtIG51bWJlciBvZiBwYXJhbGxlbCBpbnN0YW5jZXMgdGhhdCBhcmUgbGF1bmNoZWQgZm9yIGNyZWF0aW5nIHJlc291cmNlcy5cbiAgICpcbiAgICogTXVzdCBiZSBhdCBsZWFzdCA2LlxuICAgKlxuICAgKiBAZGVmYXVsdCA2XG4gICAqL1xuICByZWFkb25seSBtYXhQYXJhbGxlbExhdW5jaGVzPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIHByZS1wcm92aXNpb25lZCBzbmFwc2hvdHMgdG8ga2VlcCBvbiBoYW5kIGZvciBhIGZhc3QtbGF1bmNoIGVuYWJsZWQgV2luZG93cyBBTUkuXG4gICAqXG4gICAqIEBkZWZhdWx0IDFcbiAgICovXG4gIHJlYWRvbmx5IHRhcmdldFJlc291cmNlQ291bnQ/OiBudW1iZXI7XG59XG5cbi8qKlxuICogQW4gYXNzZXQgaW5jbHVkaW5nIGZpbGUgb3IgZGlyZWN0b3J5IHRvIHBsYWNlIGluc2lkZSB0aGUgYnVpbHQgaW1hZ2UuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSW1hZ2VCdWlsZGVyQXNzZXQge1xuICAvKipcbiAgICogUGF0aCB0byBwbGFjZSBhc3NldCBpbiB0aGUgaW1hZ2UuXG4gICAqL1xuICByZWFkb25seSBwYXRoOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEFzc2V0IHRvIHBsYWNlIGluIHRoZSBpbWFnZS5cbiAgICovXG4gIHJlYWRvbmx5IGFzc2V0OiBzM19hc3NldHMuQXNzZXQ7XG59XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgSW1hZ2VCdWlsZGVyQ29tcG9uZW50IGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJbWFnZUJ1aWxkZXJDb21wb25lbnRQcm9wZXJ0aWVzIHtcbiAgLyoqXG4gICAqIENvbXBvbmVudCBwbGF0Zm9ybS4gTXVzdCBtYXRjaCB0aGUgYnVpbGRlciBwbGF0Zm9ybS5cbiAgICovXG4gIHJlYWRvbmx5IHBsYXRmb3JtOiAnTGludXgnIHwgJ1dpbmRvd3MnO1xuXG4gIC8qKlxuICAgKiBDb21wb25lbnQgZGlzcGxheSBuYW1lLlxuICAgKi9cbiAgcmVhZG9ubHkgZGlzcGxheU5hbWU6IHN0cmluZztcblxuICAvKipcbiAgICogQ29tcG9uZW50IGRlc2NyaXB0aW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgZGVzY3JpcHRpb246IHN0cmluZztcblxuICAvKipcbiAgICogU2hlbGwgY29tbWFuZHMgdG8gcnVuIHdoZW4gYWRkaW5nIHRoaXMgY29tcG9uZW50IHRvIHRoZSBpbWFnZS5cbiAgICpcbiAgICogT24gTGludXgsIHRoZXNlIGFyZSBiYXNoIGNvbW1hbmRzLiBPbiBXaW5kb3dzLCB0aGVyZSBhcmUgUG93ZXJTaGVsbCBjb21tYW5kcy5cbiAgICovXG4gIHJlYWRvbmx5IGNvbW1hbmRzOiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogT3B0aW9uYWwgYXNzZXRzIHRvIGFkZCB0byB0aGUgYnVpbHQgaW1hZ2UuXG4gICAqL1xuICByZWFkb25seSBhc3NldHM/OiBJbWFnZUJ1aWxkZXJBc3NldFtdO1xuXG4gIC8qKlxuICAgKiBSZXF1aXJlIGEgcmVib290IGFmdGVyIGluc3RhbGxpbmcgdGhpcyBjb21wb25lbnQuXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSByZWJvb3Q/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIENvbXBvbmVudHMgYXJlIGEgc2V0IG9mIGNvbW1hbmRzIHRvIHJ1biBhbmQgb3B0aW9uYWwgZmlsZXMgdG8gYWRkIHRvIGFuIGltYWdlLiBDb21wb25lbnRzIGFyZSB0aGUgYnVpbGRpbmcgYmxvY2tzIG9mIGltYWdlcyBidWlsdCBieSBJbWFnZSBCdWlsZGVyLlxuICpcbiAqIEV4YW1wbGU6XG4gKlxuICogYGBgXG4gKiBuZXcgSW1hZ2VCdWlsZGVyQ29tcG9uZW50KHRoaXMsICdBV1MgQ0xJJywge1xuICogICBwbGF0Zm9ybTogJ1dpbmRvd3MnLFxuICogICBkaXNwbGF5TmFtZTogJ0FXUyBDTEknLFxuICogICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgbGF0ZXN0IHZlcnNpb24gb2YgQVdTIENMSScsXG4gKiAgIGNvbW1hbmRzOiBbXG4gKiAgICAgJyRwID0gU3RhcnQtUHJvY2VzcyBtc2lleGVjLmV4ZSAtUGFzc1RocnUgLVdhaXQgLUFyZ3VtZW50TGlzdCBcXCcvaSBodHRwczovL2F3c2NsaS5hbWF6b25hd3MuY29tL0FXU0NMSVYyLm1zaSAvcW5cXCcnLFxuICogICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAqICAgXSxcbiAqIH1cbiAqIGBgYFxuICpcbiAqIEBkZXByZWNhdGVkIFVzZSBgUnVubmVySW1hZ2VDb21wb25lbnRgIGluc3RlYWQgYXMgdGhpcyBiZSBpbnRlcm5hbCBzb29uLlxuICovXG5leHBvcnQgY2xhc3MgSW1hZ2VCdWlsZGVyQ29tcG9uZW50IGV4dGVuZHMgY2RrLlJlc291cmNlIHtcbiAgLyoqXG4gICAqIENvbXBvbmVudCBBUk4uXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgYXJuOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFN1cHBvcnRlZCBwbGF0Zm9ybSBmb3IgdGhlIGNvbXBvbmVudC5cbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBwbGF0Zm9ybTogJ1dpbmRvd3MnIHwgJ0xpbnV4JztcblxuICBwcml2YXRlIHJlYWRvbmx5IGFzc2V0czogczNfYXNzZXRzLkFzc2V0W10gPSBbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogSW1hZ2VCdWlsZGVyQ29tcG9uZW50UHJvcGVydGllcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICB0aGlzLnBsYXRmb3JtID0gcHJvcHMucGxhdGZvcm07XG5cbiAgICBsZXQgc3RlcHM6IGFueVtdID0gW107XG5cbiAgICBpZiAocHJvcHMuYXNzZXRzKSB7XG4gICAgICBsZXQgaW5wdXRzOiBhbnlbXSA9IFtdO1xuICAgICAgbGV0IGV4dHJhY3RDb21tYW5kczogc3RyaW5nW10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgYXNzZXQgb2YgcHJvcHMuYXNzZXRzKSB7XG4gICAgICAgIHRoaXMuYXNzZXRzLnB1c2goYXNzZXQuYXNzZXQpO1xuXG4gICAgICAgIGlmIChhc3NldC5hc3NldC5pc0ZpbGUpIHtcbiAgICAgICAgICBpbnB1dHMucHVzaCh7XG4gICAgICAgICAgICBzb3VyY2U6IGFzc2V0LmFzc2V0LnMzT2JqZWN0VXJsLFxuICAgICAgICAgICAgZGVzdGluYXRpb246IGFzc2V0LnBhdGgsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSBpZiAoYXNzZXQuYXNzZXQuaXNaaXBBcmNoaXZlKSB7XG4gICAgICAgICAgaW5wdXRzLnB1c2goe1xuICAgICAgICAgICAgc291cmNlOiBhc3NldC5hc3NldC5zM09iamVjdFVybCxcbiAgICAgICAgICAgIGRlc3RpbmF0aW9uOiBgJHthc3NldC5wYXRofS56aXBgLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChwcm9wcy5wbGF0Zm9ybSA9PT0gJ1dpbmRvd3MnKSB7XG4gICAgICAgICAgICBleHRyYWN0Q29tbWFuZHMucHVzaChgRXhwYW5kLUFyY2hpdmUgXCIke2Fzc2V0LnBhdGh9LnppcFwiIC1EZXN0aW5hdGlvblBhdGggXCIke2Fzc2V0LnBhdGh9XCJgKTtcbiAgICAgICAgICAgIGV4dHJhY3RDb21tYW5kcy5wdXNoKGBkZWwgXCIke2Fzc2V0LnBhdGh9LnppcFwiYCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGV4dHJhY3RDb21tYW5kcy5wdXNoKGB1bnppcCBcIiR7YXNzZXQucGF0aH0uemlwXCIgLWQgXCIke2Fzc2V0LnBhdGh9XCJgKTtcbiAgICAgICAgICAgIGV4dHJhY3RDb21tYW5kcy5wdXNoKGBybSBcIiR7YXNzZXQucGF0aH0uemlwXCJgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGFzc2V0IHR5cGU6ICR7YXNzZXQuYXNzZXR9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGlucHV0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHN0ZXBzLnB1c2goe1xuICAgICAgICAgIG5hbWU6ICdEb3dubG9hZCcsXG4gICAgICAgICAgYWN0aW9uOiAnUzNEb3dubG9hZCcsXG4gICAgICAgICAgaW5wdXRzLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgaWYgKGV4dHJhY3RDb21tYW5kcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHN0ZXBzLnB1c2goe1xuICAgICAgICAgIG5hbWU6ICdFeHRyYWN0JyxcbiAgICAgICAgICBhY3Rpb246IHByb3BzLnBsYXRmb3JtID09PSAnTGludXgnID8gJ0V4ZWN1dGVCYXNoJyA6ICdFeGVjdXRlUG93ZXJTaGVsbCcsXG4gICAgICAgICAgaW5wdXRzOiB7XG4gICAgICAgICAgICBjb21tYW5kczogdGhpcy5wcmVmaXhDb21tYW5kc1dpdGhFcnJvckhhbmRsaW5nKHByb3BzLnBsYXRmb3JtLCBleHRyYWN0Q29tbWFuZHMpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChwcm9wcy5jb21tYW5kcy5sZW5ndGggPiAwKSB7XG4gICAgICBzdGVwcy5wdXNoKHtcbiAgICAgICAgbmFtZTogJ1J1bicsXG4gICAgICAgIGFjdGlvbjogcHJvcHMucGxhdGZvcm0gPT09ICdMaW51eCcgPyAnRXhlY3V0ZUJhc2gnIDogJ0V4ZWN1dGVQb3dlclNoZWxsJyxcbiAgICAgICAgaW5wdXRzOiB7XG4gICAgICAgICAgY29tbWFuZHM6IHRoaXMucHJlZml4Q29tbWFuZHNXaXRoRXJyb3JIYW5kbGluZyhwcm9wcy5wbGF0Zm9ybSwgcHJvcHMuY29tbWFuZHMpLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHByb3BzLnJlYm9vdCA/PyBmYWxzZSkge1xuICAgICAgc3RlcHMucHVzaCh7XG4gICAgICAgIG5hbWU6ICdSZWJvb3QnLFxuICAgICAgICBhY3Rpb246ICdSZWJvb3QnLFxuICAgICAgICBpbnB1dHM6IHt9LFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgZGF0YSA9IHtcbiAgICAgIG5hbWU6IHByb3BzLmRpc3BsYXlOYW1lLFxuICAgICAgc2NoZW1hVmVyc2lvbjogJzEuMCcsXG4gICAgICBwaGFzZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdidWlsZCcsXG4gICAgICAgICAgc3RlcHMsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH07XG5cbiAgICBjb25zdCBuYW1lID0gdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKTtcbiAgICBjb25zdCBjb21wb25lbnQgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkNvbXBvbmVudCh0aGlzLCAnQ29tcG9uZW50Jywge1xuICAgICAgbmFtZTogbmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiBwcm9wcy5kZXNjcmlwdGlvbixcbiAgICAgIHBsYXRmb3JtOiBwcm9wcy5wbGF0Zm9ybSxcbiAgICAgIHZlcnNpb246ICcxLjAuMCcsXG4gICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeShkYXRhKSxcbiAgICB9KTtcblxuICAgIHRoaXMuYXJuID0gY29tcG9uZW50LmF0dHJBcm47XG4gIH1cblxuICAvKipcbiAgICogR3JhbnRzIHJlYWQgcGVybWlzc2lvbnMgdG8gdGhlIHByaW5jaXBhbCBvbiB0aGUgYXNzZXRzIGJ1Y2tldHMuXG4gICAqXG4gICAqIEBwYXJhbSBncmFudGVlXG4gICAqL1xuICBncmFudEFzc2V0c1JlYWQoZ3JhbnRlZTogaWFtLklHcmFudGFibGUpIHtcbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIHRoaXMuYXNzZXRzKSB7XG4gICAgICBhc3NldC5ncmFudFJlYWQoZ3JhbnRlZSk7XG4gICAgfVxuICB9XG5cbiAgcHJlZml4Q29tbWFuZHNXaXRoRXJyb3JIYW5kbGluZyhwbGF0Zm9ybTogJ1dpbmRvd3MnIHwgJ0xpbnV4JywgY29tbWFuZHM6IHN0cmluZ1tdKSB7XG4gICAgaWYgKHBsYXRmb3JtID09ICdXaW5kb3dzJykge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgJyRFcnJvckFjdGlvblByZWZlcmVuY2UgPSBcXCdTdG9wXFwnJyxcbiAgICAgICAgJyRQcm9ncmVzc1ByZWZlcmVuY2UgPSBcXCdTaWxlbnRseUNvbnRpbnVlXFwnJyxcbiAgICAgICAgJ1NldC1QU0RlYnVnIC1UcmFjZSAxJyxcbiAgICAgIF0uY29uY2F0KGNvbW1hbmRzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgJ3NldCAtZXgnLFxuICAgICAgXS5jb25jYXQoY29tbWFuZHMpO1xuICAgIH1cbiAgfVxufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY2xhc3MgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyIGV4dGVuZHMgUnVubmVySW1hZ2VCdWlsZGVyQmFzZSB7XG4gIHByaXZhdGUgYm91bmREb2NrZXJJbWFnZT86IFJ1bm5lckltYWdlO1xuICBwcml2YXRlIGJvdW5kQW1pPzogUnVubmVyQW1pO1xuICBwcml2YXRlIHJlYWRvbmx5IG9zOiBPcztcbiAgcHJpdmF0ZSByZWFkb25seSBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZTtcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlSW1hZ2U6IEJhc2VDb250YWluZXJJbWFnZTtcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlQW1pOiBCYXNlSW1hZ2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgbG9nUmV0ZW50aW9uOiBSZXRlbnRpb25EYXlzO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZ1JlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3k7XG4gIHByaXZhdGUgcmVhZG9ubHkgdnBjOiBlYzIuSVZwYztcbiAgcHJpdmF0ZSByZWFkb25seSBzZWN1cml0eUdyb3VwczogZWMyLklTZWN1cml0eUdyb3VwW107XG4gIHByaXZhdGUgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uOiBlYzIuU3VibmV0U2VsZWN0aW9uIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlYnVpbGRJbnRlcnZhbDogY2RrLkR1cmF0aW9uO1xuICBwcml2YXRlIHJlYWRvbmx5IGJvdW5kQ29tcG9uZW50czogSW1hZ2VCdWlsZGVyQ29tcG9uZW50W10gPSBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBpbnN0YW5jZVR5cGU6IGVjMi5JbnN0YW5jZVR5cGU7XG4gIHByaXZhdGUgaW5mcmFzdHJ1Y3R1cmU6IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgcm9sZTogaWFtLlJvbGU7XG4gIHByaXZhdGUgcmVhZG9ubHkgZmFzdExhdW5jaE9wdGlvbnM/OiBGYXN0TGF1bmNoT3B0aW9ucztcbiAgcHVibGljIHJlYWRvbmx5IHN0b3JhZ2VTaXplPzogY2RrLlNpemU7XG4gIHByaXZhdGUgcmVhZG9ubHkgd2FpdE9uRGVwbG95OiBib29sZWFuO1xuICBwcml2YXRlIHJlYWRvbmx5IGRvY2tlclNldHVwQ29tbWFuZHM6IHN0cmluZ1tdO1xuICBwcml2YXRlIHJlYWRvbmx5IHRhZ3M6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG4gIHByaXZhdGUgcmVhZG9ubHkgYW1pVGFnczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgcHJpdmF0ZSByZWFkb25seSBjb250YWluZXJXb3JrZmxvdz86IFdvcmtmbG93O1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbnRhaW5lcldvcmtmbG93RXhlY3V0aW9uUm9sZT86IGlhbS5JUm9sZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJ1bm5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBpZiAocHJvcHM/LmNvZGVCdWlsZE9wdGlvbnMpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ2NvZGVCdWlsZE9wdGlvbnMgYXJlIGlnbm9yZWQgd2hlbiB1c2luZyBBV1MgSW1hZ2UgQnVpbGRlciB0byBidWlsZCBydW5uZXIgaW1hZ2VzLicpO1xuICAgIH1cblxuICAgIHRoaXMub3MgPSBwcm9wcz8ub3MgPz8gT3MuTElOVVhfVUJVTlRVO1xuICAgIHRoaXMuYXJjaGl0ZWN0dXJlID0gcHJvcHM/LmFyY2hpdGVjdHVyZSA/PyBBcmNoaXRlY3R1cmUuWDg2XzY0O1xuICAgIHRoaXMucmVidWlsZEludGVydmFsID0gcHJvcHM/LnJlYnVpbGRJbnRlcnZhbCA/PyBEdXJhdGlvbi5kYXlzKDcpO1xuICAgIHRoaXMubG9nUmV0ZW50aW9uID0gcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USDtcbiAgICB0aGlzLmxvZ1JlbW92YWxQb2xpY3kgPSBwcm9wcz8ubG9nUmVtb3ZhbFBvbGljeSA/PyBSZW1vdmFsUG9saWN5LkRFU1RST1k7XG4gICAgdGhpcy52cGMgPSBwcm9wcz8udnBjID8/IGVjMi5WcGMuZnJvbUxvb2t1cCh0aGlzLCAnVlBDJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwcyA/PyBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdTRycsIHsgdnBjOiB0aGlzLnZwYyB9KV07XG4gICAgdGhpcy5zdWJuZXRTZWxlY3Rpb24gPSBwcm9wcz8uc3VibmV0U2VsZWN0aW9uO1xuICAgIHRoaXMuaW5zdGFuY2VUeXBlID0gcHJvcHM/LmF3c0ltYWdlQnVpbGRlck9wdGlvbnM/Lmluc3RhbmNlVHlwZSA/PyBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLk02SSwgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSk7XG4gICAgdGhpcy5mYXN0TGF1bmNoT3B0aW9ucyA9IHByb3BzPy5hd3NJbWFnZUJ1aWxkZXJPcHRpb25zPy5mYXN0TGF1bmNoT3B0aW9ucztcbiAgICB0aGlzLnN0b3JhZ2VTaXplID0gcHJvcHM/LmF3c0ltYWdlQnVpbGRlck9wdGlvbnM/LnN0b3JhZ2VTaXplO1xuICAgIHRoaXMuYW1pVGFncyA9IHByb3BzPy5hd3NJbWFnZUJ1aWxkZXJPcHRpb25zPy5hbWlUYWdzID8/IHt9O1xuXG4gICAgaWYgKCdHaXRIdWJSdW5uZXJzOlN0YWNrJyBpbiB0aGlzLmFtaVRhZ3MpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ092ZXJyaWRpbmcgdGhlIEdpdEh1YlJ1bm5lcnM6U3RhY2sgQU1JIHRhZyBjYW4gcHJldmVudCBvbGQgQU1JcyBmcm9tIGJlaW5nIGRlbGV0ZWQuIFlvdSB3aWxsIGhhdmUgdG8gZGVsZXRlIHRoZW0geW91cnNlbGYuJyk7XG4gICAgfVxuXG4gICAgdGhpcy53YWl0T25EZXBsb3kgPSBwcm9wcz8ud2FpdE9uRGVwbG95ID8/IHRydWU7XG4gICAgdGhpcy5kb2NrZXJTZXR1cENvbW1hbmRzID0gcHJvcHM/LmRvY2tlclNldHVwQ29tbWFuZHMgPz8gW107XG5cbiAgICAvLyBub3JtYWxpemUgQmFzZUNvbnRhaW5lckltYWdlSW5wdXQgdG8gQmFzZUNvbnRhaW5lckltYWdlIChzdHJpbmcgc3VwcG9ydCBpcyBkZXByZWNhdGVkLCBvbmx5IGF0IHB1YmxpYyBBUEkgbGV2ZWwpXG4gICAgY29uc3QgYmFzZURvY2tlckltYWdlSW5wdXQgPSBwcm9wcz8uYmFzZURvY2tlckltYWdlID8/IGRlZmF1bHRCYXNlRG9ja2VySW1hZ2UodGhpcy5vcyk7XG4gICAgdGhpcy5iYXNlSW1hZ2UgPSB0eXBlb2YgYmFzZURvY2tlckltYWdlSW5wdXQgPT09ICdzdHJpbmcnID8gQmFzZUNvbnRhaW5lckltYWdlLmZyb21TdHJpbmcoYmFzZURvY2tlckltYWdlSW5wdXQpIDogYmFzZURvY2tlckltYWdlSW5wdXQ7XG5cbiAgICAvLyBub3JtYWxpemUgQmFzZUltYWdlSW5wdXQgdG8gQmFzZUltYWdlIChzdHJpbmcgc3VwcG9ydCBpcyBkZXByZWNhdGVkLCBvbmx5IGF0IHB1YmxpYyBBUEkgbGV2ZWwpXG4gICAgY29uc3QgYmFzZUFtaUlucHV0ID0gcHJvcHM/LmJhc2VBbWkgPz8gZGVmYXVsdEJhc2VBbWkodGhpcywgdGhpcy5vcywgdGhpcy5hcmNoaXRlY3R1cmUpO1xuICAgIHRoaXMuYmFzZUFtaSA9IHR5cGVvZiBiYXNlQW1pSW5wdXQgPT09ICdzdHJpbmcnID8gQmFzZUltYWdlLmZyb21TdHJpbmcoYmFzZUFtaUlucHV0KSA6IGJhc2VBbWlJbnB1dDtcblxuICAgIC8vIHdhcm4gaWYgdXNpbmcgZGVwcmVjYXRlZCBzdHJpbmcgZm9ybWF0XG4gICAgaWYgKHByb3BzPy5iYXNlRG9ja2VySW1hZ2UgJiYgdHlwZW9mIHByb3BzLmJhc2VEb2NrZXJJbWFnZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoXG4gICAgICAgICdQYXNzaW5nIGJhc2VEb2NrZXJJbWFnZSBhcyBhIHN0cmluZyBpcyBkZXByZWNhdGVkLiBQbGVhc2UgdXNlIEJhc2VDb250YWluZXJJbWFnZSBzdGF0aWMgZmFjdG9yeSBtZXRob2RzIGluc3RlYWQsIGUuZy4sIEJhc2VDb250YWluZXJJbWFnZS5mcm9tRG9ja2VySHViKFwidWJ1bnR1XCIsIFwiMjIuMDRcIikgb3IgQmFzZUNvbnRhaW5lckltYWdlLmZyb21TdHJpbmcoXCJwdWJsaWMuZWNyLmF3cy9sdHMvdWJ1bnR1OjIyLjA0XCIpJyxcbiAgICAgICk7XG4gICAgfVxuICAgIGlmIChwcm9wcz8uYmFzZUFtaSAmJiB0eXBlb2YgcHJvcHMuYmFzZUFtaSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoXG4gICAgICAgICdQYXNzaW5nIGJhc2VBbWkgYXMgYSBzdHJpbmcgaXMgZGVwcmVjYXRlZC4gUGxlYXNlIHVzZSBCYXNlSW1hZ2Ugc3RhdGljIGZhY3RvcnkgbWV0aG9kcyBpbnN0ZWFkLCBlLmcuLCBCYXNlSW1hZ2UuZnJvbUFtaUlkKFwiYW1pLTEyMzQ1XCIpIG9yIEJhc2VJbWFnZS5mcm9tU3RyaW5nKFwiYXJuOmF3czouLi5cIiknLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyB0YWdzIGZvciBmaW5kaW5nIHJlc291cmNlc1xuICAgIHRoaXMudGFncyA9IHtcbiAgICAgICdHaXRIdWJSdW5uZXJzOlN0YWNrJzogY2RrLlN0YWNrLm9mKHRoaXMpLnN0YWNrTmFtZSxcbiAgICAgICdHaXRIdWJSdW5uZXJzOkJ1aWxkZXInOiB0aGlzLm5vZGUucGF0aCxcbiAgICB9O1xuXG4gICAgLy8gY29uZmlybSBpbnN0YW5jZSB0eXBlXG4gICAgaWYgKCF0aGlzLmFyY2hpdGVjdHVyZS5pbnN0YW5jZVR5cGVNYXRjaCh0aGlzLmluc3RhbmNlVHlwZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQnVpbGRlciBhcmNoaXRlY3R1cmUgKCR7dGhpcy5hcmNoaXRlY3R1cmUubmFtZX0pIGRvZXNuJ3QgbWF0Y2ggc2VsZWN0ZWQgaW5zdGFuY2UgdHlwZSAoJHt0aGlzLmluc3RhbmNlVHlwZX0gLyAke3RoaXMuaW5zdGFuY2VUeXBlLmFyY2hpdGVjdHVyZX0pYCk7XG4gICAgfVxuXG4gICAgLy8gd2FybiBhZ2FpbnN0IGlzb2xhdGVkIG5ldHdvcmtzXG4gICAgaWYgKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCkge1xuICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnUHJpdmF0ZSBpc29sYXRlZCBzdWJuZXRzIGNhbm5vdCBwdWxsIGZyb20gcHVibGljIEVDUiBhbmQgVlBDIGVuZHBvaW50IGlzIG5vdCBzdXBwb3J0ZWQgeWV0LiAnICtcbiAgICAgICAgJ1NlZSBodHRwczovL2dpdGh1Yi5jb20vYXdzL2NvbnRhaW5lcnMtcm9hZG1hcC9pc3N1ZXMvMTE2MCcpO1xuICAgIH1cblxuICAgIC8vIHJvbGUgdG8gYmUgdXNlZCBieSBBV1MgSW1hZ2UgQnVpbGRlclxuICAgIHRoaXMucm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlYzIuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuXG4gICAgLy8gY3JlYXRlIGNvbnRhaW5lciB3b3JrZmxvdyBpZiBkb2NrZXIgc2V0dXAgY29tbWFuZHMgYXJlIHByb3ZpZGVkXG4gICAgaWYgKHRoaXMuZG9ja2VyU2V0dXBDb21tYW5kcy5sZW5ndGggPiAwKSB7XG4gICAgICB0aGlzLmNvbnRhaW5lcldvcmtmbG93ID0gZ2VuZXJhdGVCdWlsZFdvcmtmbG93V2l0aERvY2tlclNldHVwQ29tbWFuZHModGhpcywgJ0J1aWxkJywgdGhpcy5vcywgdGhpcy5kb2NrZXJTZXR1cENvbW1hbmRzKTtcbiAgICAgIHRoaXMuY29udGFpbmVyV29ya2Zsb3dFeGVjdXRpb25Sb2xlID0gaWFtLlJvbGUuZnJvbVJvbGVBcm4odGhpcywgJ0ltYWdlIEJ1aWxkZXIgUm9sZScsIGNkay5TdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICBzZXJ2aWNlOiAnaWFtJyxcbiAgICAgICAgcmVnaW9uOiAnJyxcbiAgICAgICAgcmVzb3VyY2U6ICdyb2xlJyxcbiAgICAgICAgcmVzb3VyY2VOYW1lOiAnYXdzLXNlcnZpY2Utcm9sZS9pbWFnZWJ1aWxkZXIuYW1hem9uYXdzLmNvbS9BV1NTZXJ2aWNlUm9sZUZvckltYWdlQnVpbGRlcicsXG4gICAgICB9KSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwbGF0Zm9ybSgpIHtcbiAgICBpZiAodGhpcy5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgcmV0dXJuICdXaW5kb3dzJztcbiAgICB9XG4gICAgaWYgKHRoaXMub3MuaXNJbihPcy5fQUxMX0xJTlVYX1ZFUlNJT05TKSkge1xuICAgICAgcmV0dXJuICdMaW51eCc7XG4gICAgfVxuICAgIHRocm93IG5ldyBFcnJvcihgT1MgJHt0aGlzLm9zLm5hbWV9IGlzIG5vdCBzdXBwb3J0ZWQgYnkgQVdTIEltYWdlIEJ1aWxkZXJgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgSVJ1bm5lclByb3ZpZGVyIHRvIGZpbmFsaXplIHNldHRpbmdzIGFuZCBjcmVhdGUgdGhlIGltYWdlIGJ1aWxkZXIuXG4gICAqL1xuICBiaW5kRG9ja2VySW1hZ2UoKTogUnVubmVySW1hZ2Uge1xuICAgIGlmICh0aGlzLmJvdW5kRG9ja2VySW1hZ2UpIHtcbiAgICAgIHJldHVybiB0aGlzLmJvdW5kRG9ja2VySW1hZ2U7XG4gICAgfVxuXG4gICAgLy8gb2xkIGltYWdlcyBhcmUgZGVsZXRlZCBieSBpbWFnZUNsZWFuZXIoKSBhcyBpdCdzIHRoZSBvbmx5IHRoaW5nIHRoYXQga25vd3Mgd2hpY2ggb25lIGlzIHN0aWxsIGluIHVzZS5cbiAgICAvLyB0aGUgbGlmZWN5Y2xlIHJ1bGUgb25seSBwaWNrcyB1cCBpbWFnZXMgdGhhdCBsb3N0IHRoZWlyIHRhZ3MsIHdoaWNoIHRoZSBjbGVhbmVyIGNhbiBubyBsb25nZXIgZmluZCB0aHJvdWdoIEVDMiBJbWFnZSBCdWlsZGVyLlxuICAgIGNvbnN0IHJlcG9zaXRvcnkgPSBuZXcgZWNyLlJlcG9zaXRvcnkodGhpcywgJ1JlcG9zaXRvcnknLCB7XG4gICAgICBpbWFnZVNjYW5PblB1c2g6IHRydWUsXG4gICAgICBpbWFnZVRhZ011dGFiaWxpdHk6IFRhZ011dGFiaWxpdHkuTVVUQUJMRSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGVtcHR5T25EZWxldGU6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgZGVzY3JpcHRpb246ICdSZW1vdmUgdW50YWdnZWQgaW1hZ2VzIGxlZnQgYmVoaW5kIGJ5IGludGVycnVwdGVkIHB1c2hlcycsXG4gICAgICAgICAgdGFnU3RhdHVzOiBUYWdTdGF0dXMuVU5UQUdHRUQsXG4gICAgICAgICAgbWF4SW1hZ2VBZ2U6IER1cmF0aW9uLmRheXMoMSksXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZGlzdCA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbih0aGlzLCAnRG9ja2VyIERpc3RyaWJ1dGlvbicsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICAvLyBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcbiAgICAgIGRpc3RyaWJ1dGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHJlZ2lvbjogU3RhY2sub2YodGhpcykucmVnaW9uLFxuICAgICAgICAgIGNvbnRhaW5lckRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgIENvbnRhaW5lclRhZ3M6IFsnbGF0ZXN0J10sXG4gICAgICAgICAgICBUYXJnZXRSZXBvc2l0b3J5OiB7XG4gICAgICAgICAgICAgIFNlcnZpY2U6ICdFQ1InLFxuICAgICAgICAgICAgICBSZXBvc2l0b3J5TmFtZTogcmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgfSk7XG5cbiAgICBsZXQgZG9ja2VyZmlsZVRlbXBsYXRlID0gYEZST00ge3t7IGltYWdlYnVpbGRlcjpwYXJlbnRJbWFnZSB9fX1cbnt7eyBpbWFnZWJ1aWxkZXI6ZW52aXJvbm1lbnRzIH19fVxue3t7IGltYWdlYnVpbGRlcjpjb21wb25lbnRzIH19fWA7XG5cbiAgICBmb3IgKGNvbnN0IGMgb2YgdGhpcy5jb21wb25lbnRzKSB7XG4gICAgICBjb25zdCBjb21tYW5kcyA9IGMuZ2V0RG9ja2VyQ29tbWFuZHModGhpcy5vcywgdGhpcy5hcmNoaXRlY3R1cmUpO1xuICAgICAgaWYgKGNvbW1hbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgZG9ja2VyZmlsZVRlbXBsYXRlICs9ICdcXG4nICsgY29tbWFuZHMuam9pbignXFxuJykgKyAnXFxuJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByZWNpcGUgPSBuZXcgQ29udGFpbmVyUmVjaXBlKHRoaXMsICdDb250YWluZXIgUmVjaXBlJywge1xuICAgICAgcGxhdGZvcm06IHRoaXMucGxhdGZvcm0oKSxcbiAgICAgIGNvbXBvbmVudHM6IHRoaXMuYmluZENvbXBvbmVudHMoKSxcbiAgICAgIHRhcmdldFJlcG9zaXRvcnk6IHJlcG9zaXRvcnksXG4gICAgICBkb2NrZXJmaWxlVGVtcGxhdGU6IGRvY2tlcmZpbGVUZW1wbGF0ZSxcbiAgICAgIHBhcmVudEltYWdlOiB0aGlzLmJhc2VJbWFnZS5pbWFnZSxcbiAgICAgIHRhZ3M6IHRoaXMudGFncyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxvZyA9IHRoaXMuY3JlYXRlTG9nKCdEb2NrZXIgTG9nJywgcmVjaXBlLm5hbWUpO1xuICAgIGNvbnN0IGluZnJhID0gdGhpcy5jcmVhdGVJbmZyYXN0cnVjdHVyZShbXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSxcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnRUMySW5zdGFuY2VQcm9maWxlRm9ySW1hZ2VCdWlsZGVyRUNSQ29udGFpbmVyQnVpbGRzJyksXG4gICAgXSk7XG5cbiAgICBpZiAodGhpcy53YWl0T25EZXBsb3kpIHtcbiAgICAgIHRoaXMuY3JlYXRlSW1hZ2UoaW5mcmEsIGRpc3QsIGxvZywgdW5kZWZpbmVkLCByZWNpcGUuYXJuKTtcbiAgICB9XG4gICAgdGhpcy5kb2NrZXJJbWFnZUNsZWFuZXIocmVjaXBlKTtcblxuICAgIHRoaXMuY3JlYXRlUGlwZWxpbmUoaW5mcmEsIGRpc3QsIGxvZywgdW5kZWZpbmVkLCByZWNpcGUuYXJuKTtcblxuICAgIHRoaXMuYm91bmREb2NrZXJJbWFnZSA9IHtcbiAgICAgIGltYWdlUmVwb3NpdG9yeTogcmVwb3NpdG9yeSxcbiAgICAgIGltYWdlVGFnOiAnbGF0ZXN0JyxcbiAgICAgIG9zOiB0aGlzLm9zLFxuICAgICAgYXJjaGl0ZWN0dXJlOiB0aGlzLmFyY2hpdGVjdHVyZSxcbiAgICAgIGxvZ0dyb3VwOiBsb2csXG4gICAgICBydW5uZXJWZXJzaW9uOiBSdW5uZXJWZXJzaW9uLnNwZWNpZmljKCd1bmtub3duJyksXG4gICAgICAvLyBubyBkZXBlbmRhYmxlIGFzIENsb3VkRm9ybWF0aW9uIHdpbGwgZmFpbCB0byBnZXQgaW1hZ2UgQVJOIG9uY2UgdGhlIGltYWdlIGlzIGRlbGV0ZWQgKHdlIGRlbGV0ZSBvbGQgaW1hZ2VzIGRhaWx5KVxuICAgIH07XG5cbiAgICByZXR1cm4gdGhpcy5ib3VuZERvY2tlckltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBkb2NrZXJJbWFnZUNsZWFuZXIocmVjaXBlOiBDb250YWluZXJSZWNpcGUpIHtcbiAgICAvLyB0aGlzIGlzIGhlcmUgdG8gcHJvdmlkZSBzYWZlIHVwZ3JhZGUgZnJvbSBvbGQgY2RrLWdpdGh1Yi1ydW5uZXJzIHZlcnNpb25zXG4gICAgLy8gdGhpcyBsYW1iZGEgd2FzIHVzZWQgYnkgYSBjdXN0b20gcmVzb3VyY2UgdG8gZGVsZXRlIGFsbCBpbWFnZXMgYnVpbGRzIG9uIGNsZWFudXBcbiAgICAvLyBpZiB3ZSByZW1vdmUgdGhlIGN1c3RvbSByZXNvdXJjZSBhbmQgdGhlIGxhbWJkYSwgdGhlIG9sZCBpbWFnZXMgd2lsbCBiZSBkZWxldGVkIG9uIHVwZGF0ZVxuICAgIC8vIGtlZXBpbmcgdGhlIGxhbWJkYSBidXQgcmVtb3ZpbmcgdGhlIHBlcm1pc3Npb25zIHdpbGwgbWFrZSBzdXJlIHRoYXQgZGVsZXRpb24gd2lsbCBmYWlsXG4gICAgY29uc3Qgb2xkRGVsZXRlciA9IHNpbmdsZXRvbkxhbWJkYShCdWlsZEltYWdlRnVuY3Rpb24sIHRoaXMsICdidWlsZC1pbWFnZScsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3VzdG9tIHJlc291cmNlIGhhbmRsZXIgdGhhdCB0cmlnZ2VycyBDb2RlQnVpbGQgdG8gYnVpbGQgcnVubmVyIGltYWdlcycsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygzKSxcbiAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlJVTk5FUl9JTUFHRV9CVUlMRCksXG4gICAgICBsb2dnaW5nRm9ybWF0OiBsYW1iZGEuTG9nZ2luZ0Zvcm1hdC5KU09OLFxuICAgIH0pO1xuICAgIG9sZERlbGV0ZXIuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5ERU5ZLFxuICAgICAgYWN0aW9uczogWydpbWFnZWJ1aWxkZXI6RGVsZXRlSW1hZ2UnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gZGVsZXRlIG9sZCBEb2NrZXIgaW1hZ2VzIGRhaWx5LCBhbmQgZXZlcnl0aGluZyB3aGVuIHRoaXMgYnVpbGRlciBpcyByZW1vdmVkXG4gICAgdGhpcy5pbWFnZUNsZWFuZXIoJ0NvbnRhaW5lcicsIHJlY2lwZS5uYW1lLCByZWNpcGUudmVyc2lvbik7XG4gIH1cblxuICBwcm90ZWN0ZWQgY3JlYXRlTG9nKGlkOiBzdHJpbmcsIHJlY2lwZU5hbWU6IHN0cmluZyk6IGxvZ3MuTG9nR3JvdXAge1xuICAgIHJldHVybiBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCBpZCwge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9pbWFnZWJ1aWxkZXIvJHtyZWNpcGVOYW1lfWAsXG4gICAgICByZXRlbnRpb246IHRoaXMubG9nUmV0ZW50aW9uLFxuICAgICAgcmVtb3ZhbFBvbGljeTogdGhpcy5sb2dSZW1vdmFsUG9saWN5LFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGNyZWF0ZUluZnJhc3RydWN0dXJlKG1hbmFnZWRQb2xpY2llczogaWFtLklNYW5hZ2VkUG9saWN5W10pOiBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uIHtcbiAgICBpZiAodGhpcy5pbmZyYXN0cnVjdHVyZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaW5mcmFzdHJ1Y3R1cmU7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBtYW5hZ2VkUG9saWN5IG9mIG1hbmFnZWRQb2xpY2llcykge1xuICAgICAgdGhpcy5yb2xlLmFkZE1hbmFnZWRQb2xpY3kobWFuYWdlZFBvbGljeSk7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBjb21wb25lbnQgb2YgdGhpcy5ib3VuZENvbXBvbmVudHMpIHtcbiAgICAgIGNvbXBvbmVudC5ncmFudEFzc2V0c1JlYWQodGhpcy5yb2xlKTtcbiAgICB9XG5cbiAgICB0aGlzLmluZnJhc3RydWN0dXJlID0gbmV3IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24odGhpcywgJ0luZnJhc3RydWN0dXJlJywge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIC8vIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxuICAgICAgc3VibmV0SWQ6IHRoaXMudnBjPy5zZWxlY3RTdWJuZXRzKHRoaXMuc3VibmV0U2VsZWN0aW9uKS5zdWJuZXRJZHNbMF0sXG4gICAgICBzZWN1cml0eUdyb3VwSWRzOiB0aGlzLnNlY3VyaXR5R3JvdXBzPy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIGluc3RhbmNlVHlwZXM6IFt0aGlzLmluc3RhbmNlVHlwZS50b1N0cmluZygpXSxcbiAgICAgIGluc3RhbmNlTWV0YWRhdGFPcHRpb25zOiB7XG4gICAgICAgIGh0dHBUb2tlbnM6ICdyZXF1aXJlZCcsXG4gICAgICAgIC8vIENvbnRhaW5lciBidWlsZHMgcmVxdWlyZSBhIG1pbmltdW0gb2YgdHdvIGhvcHMuXG4gICAgICAgIGh0dHBQdXRSZXNwb25zZUhvcExpbWl0OiAyLFxuICAgICAgfSxcbiAgICAgIGluc3RhbmNlUHJvZmlsZU5hbWU6IG5ldyBpYW0uQ2ZuSW5zdGFuY2VQcm9maWxlKHRoaXMsICdJbnN0YW5jZSBQcm9maWxlJywge1xuICAgICAgICByb2xlczogW1xuICAgICAgICAgIHRoaXMucm9sZS5yb2xlTmFtZSxcbiAgICAgICAgXSxcbiAgICAgIH0pLnJlZixcbiAgICB9KTtcblxuICAgIHJldHVybiB0aGlzLmluZnJhc3RydWN0dXJlO1xuICB9XG5cbiAgcHJpdmF0ZSB3b3JrZmxvd0NvbmZpZyhjb250YWluZXJSZWNpcGVBcm4/OiBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5jb250YWluZXJXb3JrZmxvdyAmJiB0aGlzLmNvbnRhaW5lcldvcmtmbG93RXhlY3V0aW9uUm9sZSAmJiBjb250YWluZXJSZWNpcGVBcm4pIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHdvcmtmbG93czogW3tcbiAgICAgICAgICB3b3JrZmxvd0FybjogdGhpcy5jb250YWluZXJXb3JrZmxvdy5hcm4sXG4gICAgICAgIH1dLFxuICAgICAgICBleGVjdXRpb25Sb2xlOiB0aGlzLmNvbnRhaW5lcldvcmtmbG93RXhlY3V0aW9uUm9sZS5yb2xlQXJuLFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuXG4gIHByb3RlY3RlZCBjcmVhdGVJbWFnZShpbmZyYTogaW1hZ2VidWlsZGVyLkNmbkluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbiwgZGlzdDogaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24sIGxvZzogbG9ncy5Mb2dHcm91cCxcbiAgICBpbWFnZVJlY2lwZUFybj86IHN0cmluZywgY29udGFpbmVyUmVjaXBlQXJuPzogc3RyaW5nKTogaW1hZ2VidWlsZGVyLkNmbkltYWdlIHtcbiAgICBjb25zdCBpbWFnZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2UodGhpcywgdGhpcy5hbWlPckNvbnRhaW5lcklkKCdJbWFnZScsIGltYWdlUmVjaXBlQXJuLCBjb250YWluZXJSZWNpcGVBcm4pLCB7XG4gICAgICBpbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb25Bcm46IGluZnJhLmF0dHJBcm4sXG4gICAgICBkaXN0cmlidXRpb25Db25maWd1cmF0aW9uQXJuOiBkaXN0LmF0dHJBcm4sXG4gICAgICBpbWFnZVJlY2lwZUFybixcbiAgICAgIGNvbnRhaW5lclJlY2lwZUFybixcbiAgICAgIGltYWdlVGVzdHNDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIGltYWdlVGVzdHNFbmFibGVkOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgICAuLi50aGlzLndvcmtmbG93Q29uZmlnKGNvbnRhaW5lclJlY2lwZUFybiksXG4gICAgfSk7XG4gICAgaW1hZ2Uubm9kZS5hZGREZXBlbmRlbmN5KGluZnJhKTtcbiAgICBpbWFnZS5ub2RlLmFkZERlcGVuZGVuY3kobG9nKTtcblxuICAgIC8vIGRvIG5vdCBkZWxldGUgdGhlIGltYWdlIGFzIGl0IHdpbGwgYmUgZGVsZXRlZCBieSBpbWFnZUNsZWFuZXIoKS5cbiAgICAvLyBpZiB3ZSBkZWxldGUgaXQgaGVyZSwgaW1hZ2VDbGVhbmVyKCkgd29uJ3QgYmUgYWJsZSB0byBmaW5kIHRoZSBpbWFnZS5cbiAgICAvLyBpZiBpbWFnZUNsZWFuZXIoKSBjYW4ndCBmaW5kIHRoZSBpbWFnZSwgaXQgd29uJ3QgYmUgYWJsZSB0byBkZWxldGUgdGhlIGxpbmtlZCBBTUkvRG9ja2VyIGltYWdlLlxuICAgIC8vIHVzZSBSRVRBSU5fT05fVVBEQVRFX09SX0RFTEVURSwgc28gZXZlcnl0aGluZyBpcyBjbGVhbmVkIG9ubHkgb24gcm9sbGJhY2suXG4gICAgaW1hZ2UuYXBwbHlSZW1vdmFsUG9saWN5KFJlbW92YWxQb2xpY3kuUkVUQUlOX09OX1VQREFURV9PUl9ERUxFVEUpO1xuXG4gICAgcmV0dXJuIGltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBhbWlPckNvbnRhaW5lcklkKGJhc2VJZDogc3RyaW5nLCBpbWFnZVJlY2lwZUFybj86IHN0cmluZywgY29udGFpbmVyUmVjaXBlQXJuPzogc3RyaW5nKSB7XG4gICAgaWYgKGltYWdlUmVjaXBlQXJuKSB7XG4gICAgICByZXR1cm4gYEFNSSAke2Jhc2VJZH1gO1xuICAgIH1cbiAgICBpZiAoY29udGFpbmVyUmVjaXBlQXJuKSB7XG4gICAgICByZXR1cm4gYERvY2tlciAke2Jhc2VJZH1gO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0VpdGhlciBpbWFnZVJlY2lwZUFybiBvciBjb250YWluZXJSZWNpcGVBcm4gbXVzdCBiZSBkZWZpbmVkJyk7XG4gIH1cblxuICBwcm90ZWN0ZWQgY3JlYXRlUGlwZWxpbmUoaW5mcmE6IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24sIGRpc3Q6IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uLCBsb2c6IGxvZ3MuTG9nR3JvdXAsXG4gICAgaW1hZ2VSZWNpcGVBcm4/OiBzdHJpbmcsIGNvbnRhaW5lclJlY2lwZUFybj86IHN0cmluZyk6IGltYWdlYnVpbGRlci5DZm5JbWFnZVBpcGVsaW5lIHtcbiAgICAvLyBzZXQgc2NoZWR1bGVcbiAgICBsZXQgc2NoZWR1bGVPcHRpb25zOiBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VQaXBlbGluZS5TY2hlZHVsZVByb3BlcnR5IHwgdW5kZWZpbmVkO1xuICAgIGlmICh0aGlzLnJlYnVpbGRJbnRlcnZhbC50b01pbGxpc2Vjb25kcygpID4gMCkge1xuICAgICAgc2NoZWR1bGVPcHRpb25zID0ge1xuICAgICAgICBzY2hlZHVsZUV4cHJlc3Npb246IGV2ZW50cy5TY2hlZHVsZS5yYXRlKHRoaXMucmVidWlsZEludGVydmFsKS5leHByZXNzaW9uU3RyaW5nLFxuICAgICAgICBwaXBlbGluZUV4ZWN1dGlvblN0YXJ0Q29uZGl0aW9uOiAnRVhQUkVTU0lPTl9NQVRDSF9PTkxZJyxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gZ2VuZXJhdGUgcGlwZWxpbmVcbiAgICBjb25zdCBwaXBlbGluZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VQaXBlbGluZSh0aGlzLCB0aGlzLmFtaU9yQ29udGFpbmVySWQoJ1BpcGVsaW5lJywgaW1hZ2VSZWNpcGVBcm4sIGNvbnRhaW5lclJlY2lwZUFybiksIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICAvLyBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcbiAgICAgIGluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbkFybjogaW5mcmEuYXR0ckFybixcbiAgICAgIGRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb25Bcm46IGRpc3QuYXR0ckFybixcbiAgICAgIGltYWdlUmVjaXBlQXJuLFxuICAgICAgY29udGFpbmVyUmVjaXBlQXJuLFxuICAgICAgc2NoZWR1bGU6IHNjaGVkdWxlT3B0aW9ucyxcbiAgICAgIGltYWdlVGVzdHNDb25maWd1cmF0aW9uOiB7XG4gICAgICAgIGltYWdlVGVzdHNFbmFibGVkOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgICAuLi50aGlzLndvcmtmbG93Q29uZmlnKGNvbnRhaW5lclJlY2lwZUFybiksXG4gICAgfSk7XG4gICAgcGlwZWxpbmUubm9kZS5hZGREZXBlbmRlbmN5KGluZnJhKTtcbiAgICBwaXBlbGluZS5ub2RlLmFkZERlcGVuZGVuY3kobG9nKTtcblxuICAgIHJldHVybiBwaXBlbGluZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbmV0d29yayBjb25uZWN0aW9ucyBhc3NvY2lhdGVkIHdpdGggdGhpcyByZXNvdXJjZS5cbiAgICovXG4gIHB1YmxpYyBnZXQgY29ubmVjdGlvbnMoKTogZWMyLkNvbm5lY3Rpb25zIHtcbiAgICByZXR1cm4gbmV3IGVjMi5Db25uZWN0aW9ucyh7IHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzIH0pO1xuICB9XG5cbiAgcHVibGljIGdldCBncmFudFByaW5jaXBhbCgpOiBpYW0uSVByaW5jaXBhbCB7XG4gICAgcmV0dXJuIHRoaXMucm9sZTtcbiAgfVxuXG4gIGJpbmRBbWkoKTogUnVubmVyQW1pIHtcbiAgICBpZiAodGhpcy5ib3VuZEFtaSkge1xuICAgICAgcmV0dXJuIHRoaXMuYm91bmRBbWk7XG4gICAgfVxuXG4gICAgY29uc3QgbGF1bmNoVGVtcGxhdGUgPSBuZXcgZWMyLkxhdW5jaFRlbXBsYXRlKHRoaXMsICdMYXVuY2ggdGVtcGxhdGUnLCB7XG4gICAgICByZXF1aXJlSW1kc3YyOiB0cnVlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgbGF1bmNoVGVtcGxhdGVDb25maWdzOiBpbWFnZWJ1aWxkZXIuQ2ZuRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbi5MYXVuY2hUZW1wbGF0ZUNvbmZpZ3VyYXRpb25Qcm9wZXJ0eVtdID0gW3tcbiAgICAgIGxhdW5jaFRlbXBsYXRlSWQ6IGxhdW5jaFRlbXBsYXRlLmxhdW5jaFRlbXBsYXRlSWQsXG4gICAgICBzZXREZWZhdWx0VmVyc2lvbjogdHJ1ZSxcbiAgICB9XTtcbiAgICBjb25zdCBmYXN0TGF1bmNoQ29uZmlnczogaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24uRmFzdExhdW5jaENvbmZpZ3VyYXRpb25Qcm9wZXJ0eVtdID0gW107XG5cbiAgICBpZiAodGhpcy5mYXN0TGF1bmNoT3B0aW9ucz8uZW5hYmxlZCA/PyBmYWxzZSkge1xuICAgICAgaWYgKCF0aGlzLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignRmFzdCBsYXVuY2ggaXMgb25seSBzdXBwb3J0ZWQgZm9yIFdpbmRvd3MnKTtcbiAgICAgIH1cblxuICAgICAgLy8gY3JlYXRlIGEgc2VwYXJhdGUgbGF1bmNoIHRlbXBsYXRlIGZvciBmYXN0IGxhdW5jaCBzbzpcbiAgICAgIC8vICAtIHNldHRpbmdzIGRvbid0IGFmZmVjdCB0aGUgcnVubmVyc1xuICAgICAgLy8gIC0gZW5hYmxpbmcgZmFzdCBsYXVuY2ggb24gYW4gZXhpc3RpbmcgYnVpbGRlciB3b3JrcyAod2l0aG91dCBhIG5ldyBsYXVuY2ggdGVtcGxhdGUsIEVDMiBJbWFnZSBCdWlsZGVyIHdpbGwgdXNlIHRoZSBmaXJzdCB2ZXJzaW9uIG9mIHRoZSBsYXVuY2ggdGVtcGxhdGUsIHdoaWNoIGRvZXNuJ3QgaGF2ZSBpbnN0YW5jZSBvciBWUEMgY29uZmlnKVxuICAgICAgLy8gIC0gc2V0dGluZyB2cGMgKyBzdWJuZXQgb24gdGhlIG1haW4gbGF1bmNoIHRlbXBsYXRlIHdpbGwgY2F1c2UgUnVuSW5zdGFuY2VzIHRvIGZhaWxcbiAgICAgIC8vICAtIEVDMiBJbWFnZSBCdWlsZGVyIHNlZW1zIHRvIGdldCBjb25mdXNlZCB3aXRoIHdoaWNoIGxhdW5jaCB0ZW1wbGF0ZSB2ZXJzaW9uIHRvIGJhc2UgYW55IG5ldyB2ZXJzaW9uIG9uLCBzbyBhIG5ldyB0ZW1wbGF0ZSBpcyBhbHdheXMgYmVzdFxuICAgICAgY29uc3QgZmFzdExhdW5jaFRlbXBsYXRlID0gbmV3IGVjMi5DZm5MYXVuY2hUZW1wbGF0ZSh0aGlzLCAnRmFzdCBMYXVuY2ggVGVtcGxhdGUnLCB7XG4gICAgICAgIGxhdW5jaFRlbXBsYXRlRGF0YToge1xuICAgICAgICAgIG1ldGFkYXRhT3B0aW9uczoge1xuICAgICAgICAgICAgaHR0cFRva2VuczogJ3JlcXVpcmVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGluc3RhbmNlVHlwZTogdGhpcy5pbnN0YW5jZVR5cGUudG9TdHJpbmcoKSxcbiAgICAgICAgICBuZXR3b3JrSW50ZXJmYWNlczogW3tcbiAgICAgICAgICAgIHN1Ym5ldElkOiB0aGlzLnZwYz8uc2VsZWN0U3VibmV0cyh0aGlzLnN1Ym5ldFNlbGVjdGlvbikuc3VibmV0SWRzWzBdLFxuICAgICAgICAgICAgZGV2aWNlSW5kZXg6IDAsXG4gICAgICAgICAgICBncm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICAgICAgfV0sXG4gICAgICAgICAgdGFnU3BlY2lmaWNhdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiAnaW5zdGFuY2UnLFxuICAgICAgICAgICAgICB0YWdzOiBbe1xuICAgICAgICAgICAgICAgIGtleTogJ05hbWUnLFxuICAgICAgICAgICAgICAgIHZhbHVlOiBgJHt0aGlzLm5vZGUucGF0aH0vRmFzdCBMYXVuY2ggSW5zdGFuY2VgLFxuICAgICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHJlc291cmNlVHlwZTogJ3ZvbHVtZScsXG4gICAgICAgICAgICAgIHRhZ3M6IFt7XG4gICAgICAgICAgICAgICAga2V5OiAnTmFtZScsXG4gICAgICAgICAgICAgICAgdmFsdWU6IGAke3RoaXMubm9kZS5wYXRofS9GYXN0IExhdW5jaCBJbnN0YW5jZWAsXG4gICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICB0YWdTcGVjaWZpY2F0aW9uczogW3tcbiAgICAgICAgICByZXNvdXJjZVR5cGU6ICdsYXVuY2gtdGVtcGxhdGUnLFxuICAgICAgICAgIHRhZ3M6IFt7XG4gICAgICAgICAgICBrZXk6ICdOYW1lJyxcbiAgICAgICAgICAgIHZhbHVlOiBgJHt0aGlzLm5vZGUucGF0aH0vRmFzdCBMYXVuY2ggVGVtcGxhdGVgLFxuICAgICAgICAgIH1dLFxuICAgICAgICB9XSxcbiAgICAgIH0pO1xuXG4gICAgICBsYXVuY2hUZW1wbGF0ZUNvbmZpZ3MucHVzaCh7XG4gICAgICAgIGxhdW5jaFRlbXBsYXRlSWQ6IGZhc3RMYXVuY2hUZW1wbGF0ZS5hdHRyTGF1bmNoVGVtcGxhdGVJZCxcbiAgICAgICAgc2V0RGVmYXVsdFZlcnNpb246IHRydWUsXG4gICAgICB9KTtcbiAgICAgIGZhc3RMYXVuY2hDb25maWdzLnB1c2goe1xuICAgICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgICBsYXVuY2hUZW1wbGF0ZToge1xuICAgICAgICAgIGxhdW5jaFRlbXBsYXRlSWQ6IGZhc3RMYXVuY2hUZW1wbGF0ZS5hdHRyTGF1bmNoVGVtcGxhdGVJZCxcbiAgICAgICAgfSxcbiAgICAgICAgbWF4UGFyYWxsZWxMYXVuY2hlczogdGhpcy5mYXN0TGF1bmNoT3B0aW9ucz8ubWF4UGFyYWxsZWxMYXVuY2hlcyA/PyA2LFxuICAgICAgICBzbmFwc2hvdENvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICB0YXJnZXRSZXNvdXJjZUNvdW50OiB0aGlzLmZhc3RMYXVuY2hPcHRpb25zPy50YXJnZXRSZXNvdXJjZUNvdW50ID8/IDEsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBzdGFja05hbWUgPSBjZGsuU3RhY2sub2YodGhpcykuc3RhY2tOYW1lO1xuICAgIGNvbnN0IGJ1aWxkZXJOYW1lID0gdGhpcy5ub2RlLnBhdGg7XG5cbiAgICBjb25zdCBkaXN0ID0gbmV3IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uKHRoaXMsICdBTUkgRGlzdHJpYnV0aW9uJywge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIC8vIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxuICAgICAgZGlzdHJpYnV0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcmVnaW9uOiBTdGFjay5vZih0aGlzKS5yZWdpb24sXG4gICAgICAgICAgYW1pRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgTmFtZTogYCR7Y2RrLk5hbWVzLnVuaXF1ZVJlc291cmNlTmFtZSh0aGlzLCB7XG4gICAgICAgICAgICAgIG1heExlbmd0aDogMTAwLFxuICAgICAgICAgICAgICBzZXBhcmF0b3I6ICctJyxcbiAgICAgICAgICAgICAgYWxsb3dlZFNwZWNpYWxDaGFyYWN0ZXJzOiAnXy0nLFxuICAgICAgICAgICAgfSl9LXt7IGltYWdlYnVpbGRlcjpidWlsZERhdGUgfX1gLFxuICAgICAgICAgICAgQW1pVGFnczoge1xuICAgICAgICAgICAgICAnTmFtZSc6IHRoaXMubm9kZS5pZCxcbiAgICAgICAgICAgICAgJ0dpdEh1YlJ1bm5lcnM6U3RhY2snOiBzdGFja05hbWUsXG4gICAgICAgICAgICAgICdHaXRIdWJSdW5uZXJzOkJ1aWxkZXInOiBidWlsZGVyTmFtZSxcbiAgICAgICAgICAgICAgLi4udGhpcy5hbWlUYWdzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGxhdW5jaFRlbXBsYXRlQ29uZmlndXJhdGlvbnM6IGxhdW5jaFRlbXBsYXRlQ29uZmlncyxcbiAgICAgICAgICBmYXN0TGF1bmNoQ29uZmlndXJhdGlvbnM6IGZhc3RMYXVuY2hDb25maWdzLmxlbmd0aCA+IDAgPyBmYXN0TGF1bmNoQ29uZmlncyA6IHVuZGVmaW5lZCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgfSk7XG5cbiAgICBjb25zdCByZWNpcGUgPSBuZXcgQW1pUmVjaXBlKHRoaXMsICdBbWkgUmVjaXBlJywge1xuICAgICAgcGxhdGZvcm06IHRoaXMucGxhdGZvcm0oKSxcbiAgICAgIGNvbXBvbmVudHM6IHRoaXMuYmluZENvbXBvbmVudHMoKSxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBiYXNlQW1pOiB0aGlzLmJhc2VBbWksXG4gICAgICBzdG9yYWdlU2l6ZTogdGhpcy5zdG9yYWdlU2l6ZSxcbiAgICAgIHRhZ3M6IHRoaXMudGFncyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxvZyA9IHRoaXMuY3JlYXRlTG9nKCdBbWkgTG9nJywgcmVjaXBlLm5hbWUpO1xuICAgIGNvbnN0IGluZnJhID0gdGhpcy5jcmVhdGVJbmZyYXN0cnVjdHVyZShbXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSxcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnRUMySW5zdGFuY2VQcm9maWxlRm9ySW1hZ2VCdWlsZGVyJyksXG4gICAgXSk7XG4gICAgaWYgKHRoaXMud2FpdE9uRGVwbG95KSB7XG4gICAgICB0aGlzLmNyZWF0ZUltYWdlKGluZnJhLCBkaXN0LCBsb2csIHJlY2lwZS5hcm4sIHVuZGVmaW5lZCk7XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlUGlwZWxpbmUoaW5mcmEsIGRpc3QsIGxvZywgcmVjaXBlLmFybiwgdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYm91bmRBbWkgPSB7XG4gICAgICBsYXVuY2hUZW1wbGF0ZTogbGF1bmNoVGVtcGxhdGUsXG4gICAgICBhcmNoaXRlY3R1cmU6IHRoaXMuYXJjaGl0ZWN0dXJlLFxuICAgICAgb3M6IHRoaXMub3MsXG4gICAgICBsb2dHcm91cDogbG9nLFxuICAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygndW5rbm93bicpLFxuICAgICAgY2FjaGVLZXk6IHJlY2lwZS52ZXJzaW9uLCAvLyByZS1ldmFsdWF0ZSBBTUkgd2hlbmV2ZXIgdGhlIHJlY2lwZSBjaGFuZ2VzXG4gICAgfTtcblxuICAgIHRoaXMuYW1pQ2xlYW5lcihyZWNpcGUsIGxhdW5jaFRlbXBsYXRlKTtcblxuICAgIHJldHVybiB0aGlzLmJvdW5kQW1pO1xuICB9XG5cbiAgcHJpdmF0ZSBhbWlDbGVhbmVyKHJlY2lwZTogQW1pUmVjaXBlLCBsYXVuY2hUZW1wbGF0ZTogZWMyLkxhdW5jaFRlbXBsYXRlKSB7XG4gICAgLy8gdGhpcyBpcyBoZXJlIHRvIHByb3ZpZGUgc2FmZSB1cGdyYWRlIGZyb20gb2xkIGNkay1naXRodWItcnVubmVycyB2ZXJzaW9uc1xuICAgIC8vIHRoaXMgbGFtYmRhIHdhcyB1c2VkIGJ5IGEgY3VzdG9tIHJlc291cmNlIHRvIGRlbGV0ZSBhbGwgYW1pcyB3aGVuIHRoZSBidWlsZGVyIHdhcyByZW1vdmVkXG4gICAgLy8gaWYgd2UgcmVtb3ZlIHRoZSBjdXN0b20gcmVzb3VyY2UsIHJvbGUgYW5kIGxhbWJkYSwgYWxsIGFtaXMgd2lsbCBiZSBkZWxldGVkIG9uIHVwZGF0ZVxuICAgIC8vIGtlZXBpbmcgdGhlIGp1c3Qgcm9sZSBidXQgcmVtb3ZpbmcgdGhlIHBlcm1pc3Npb25zIGFsb25nIHdpdGggdGhlIGN1c3RvbSByZXNvdXJjZSB3aWxsIG1ha2Ugc3VyZSB0aGF0IGRlbGV0aW9uIHdpbGwgZmFpbFxuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xuICAgIGlmIChzdGFjay5ub2RlLnRyeUZpbmRDaGlsZCgnZGVsZXRlLWFtaS1kY2MwMzZjOC04NzZiLTQ1MWUtYTJjMS01NTJmOWUwNmU5ZTEnKSA9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IHJvbGUgPSBuZXcgaWFtLlJvbGUoc3RhY2ssICdkZWxldGUtYW1pLWRjYzAzNmM4LTg3NmItNDUxZS1hMmMxLTU1MmY5ZTA2ZTllMScsIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdFbXB0eSByb2xlIHRvIHByZXZlbnQgZGVsZXRpb24gb2YgQU1JcyBvbiBjZGstZ2l0aHViLXJ1bm5lcnMgdXBncmFkZScsXG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIGRlbnk6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydlYzI6RGVyZWdpc3RlckltYWdlJywgJ2VjMjpEZWxldGVTbmFwc2hvdCddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkRFTlksXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgbDFyb2xlOiBpYW0uQ2ZuUm9sZSA9IHJvbGUubm9kZS5kZWZhdWx0Q2hpbGQgYXMgaWFtLkNmblJvbGU7XG4gICAgICBsMXJvbGUub3ZlcnJpZGVMb2dpY2FsSWQoJ2RlbGV0ZWFtaWRjYzAzNmM4ODc2YjQ1MWVhMmMxNTUyZjllMDZlOWUxU2VydmljZVJvbGUxQ0M1OEE2RicpO1xuICAgIH1cblxuICAgIC8vIGRlbGV0ZSBvbGQgQU1JcyBkYWlseSwgYW5kIGV2ZXJ5dGhpbmcgd2hlbiB0aGlzIGJ1aWxkZXIgaXMgcmVtb3ZlZFxuICAgIHRoaXMuaW1hZ2VDbGVhbmVyKCdJbWFnZScsIHJlY2lwZS5uYW1lLCByZWNpcGUudmVyc2lvbiwgbGF1bmNoVGVtcGxhdGUpO1xuICB9XG5cbiAgcHJpdmF0ZSBiaW5kQ29tcG9uZW50cygpOiBJbWFnZUJ1aWxkZXJDb21wb25lbnRbXSB7XG4gICAgaWYgKHRoaXMuYm91bmRDb21wb25lbnRzLmxlbmd0aCA9PSAwKSB7XG4gICAgICB0aGlzLmJvdW5kQ29tcG9uZW50cy5wdXNoKC4uLnRoaXMuY29tcG9uZW50cy5tYXAoYyA9PiBjLl9hc0F3c0ltYWdlQnVpbGRlckNvbXBvbmVudCh0aGlzLCB0aGlzLm9zLCB0aGlzLmFyY2hpdGVjdHVyZSkpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5ib3VuZENvbXBvbmVudHM7XG4gIH1cblxuICAvKipcbiAgICogU2V0IHVwIGNsZWFudXAgb2YgaW1hZ2VzIGJ1aWx0IGJ5IHRoaXMgYnVpbGRlclxuICAgKlxuICAgKiBBIHNpbmdsZSBMYW1iZGEgaGFuZGxlcyBib3RoIHBhdGhzLiBPbiBhIHNjaGVkdWxlIGl0IGRlbGV0ZXMgb2xkIGltYWdlcywgYnV0IGtlZXBpbmcgdGhlIGxhdGVzdCAyIGFuZCB0aGUgb25lIHRoZSBsYXVuY2ggdGVtcGxhdGUgcG9pbnRzIGF0LlxuICAgKiBPbiByZW1vdmFsIG9mIHRoZSBidWlsZGVyLCBvciBkZWxldGlvbiBvZiB0aGUgc3RhY2ssIGEgY3VzdG9tIHJlc291cmNlIGhhcyBpdCBkZWxldGUgZXZlcnkgaW1hZ2Ugb2YgdGhpcyBidWlsZGVyLlxuICAgKlxuICAgKiBUaGUgY3VzdG9tIHJlc291cmNlIGFsd2F5cyByZXBvcnRzIHRoZSBzYW1lIHBoeXNpY2FsIHJlc291cmNlIGlkLCBzbyBDbG91ZEZvcm1hdGlvbiBuZXZlciByZXBsYWNlcyBpdC4gVGhhdCdzIHdoYXQgbWFrZXMgZGVsZXRpbmcgZXZlcnl0aGluZ1xuICAgKiBzYWZlOiBgRGVsZXRlYCBjYW4gdGhlbiBvbmx5IG1lYW4gdGhlIGJ1aWxkZXIgaXMgZ29pbmcgYXdheSwgYW5kIG5ldmVyIGFuIHVwZGF0ZSBvciBhIHJvbGxiYWNrIG9mIG9uZS5cbiAgICovXG4gIHByaXZhdGUgaW1hZ2VDbGVhbmVyKHR5cGU6ICdDb250YWluZXInIHwgJ0ltYWdlJywgcmVjaXBlTmFtZTogc3RyaW5nLCB2ZXJzaW9uOiBzdHJpbmcsIGxhdW5jaFRlbXBsYXRlPzogZWMyLkxhdW5jaFRlbXBsYXRlKSB7XG4gICAgY29uc3QgY2xlYW5lckZ1bmN0aW9uID0gc2luZ2xldG9uTGFtYmRhKERlbGV0ZVJlc291cmNlc0Z1bmN0aW9uLCB0aGlzLCAnYXdzLWltYWdlLWJ1aWxkZXItZGVsZXRlLXJlc291cmNlcycsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGVsZXRlcyBvbGQgRUMyIEltYWdlIEJ1aWxkZXIgcnVubmVyIGltYWdlcywgYW5kIGFsbCBvZiB0aGVtIHdoZW4gdGhlaXIgYnVpbGRlciBpcyByZW1vdmVkJyxcbiAgICAgIGluaXRpYWxQb2xpY3k6IFtcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICdpbWFnZWJ1aWxkZXI6TGlzdEltYWdlcycsXG4gICAgICAgICAgICAnaW1hZ2VidWlsZGVyOkxpc3RJbWFnZUJ1aWxkVmVyc2lvbnMnLFxuICAgICAgICAgICAgJ2ltYWdlYnVpbGRlcjpEZWxldGVJbWFnZScsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFsnZWMyOkRlc2NyaWJlSW1hZ2VzJywgJ2VjMjpEZXNjcmliZUxhdW5jaFRlbXBsYXRlVmVyc2lvbnMnXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFsnZWMyOkRlcmVnaXN0ZXJJbWFnZScsICdlYzI6RGVsZXRlU25hcHNob3QnXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgICAnYXdzOlJlc291cmNlVGFnL0dpdEh1YlJ1bm5lcnM6U3RhY2snOiBjZGsuU3RhY2sub2YodGhpcykuc3RhY2tOYW1lLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFsnZWNyOkJhdGNoRGVsZXRlSW1hZ2UnXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5SVU5ORVJfSU1BR0VfQlVJTEQpLFxuICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHRhcmdldDogQ2xlYW5lclRhcmdldCA9IHtcbiAgICAgIFJlY2lwZU5hbWU6IHJlY2lwZU5hbWUsXG4gICAgICBMYXVuY2hUZW1wbGF0ZUlkOiBsYXVuY2hUZW1wbGF0ZT8ubGF1bmNoVGVtcGxhdGVJZCxcbiAgICB9O1xuXG4gICAgLy8gZGVsZXRlIGV2ZXJ5dGhpbmcgd2hlbiB0aGlzIGJ1aWxkZXIgaXMgcmVtb3ZlZCBvciB0aGUgc3RhY2sgaXMgZGVsZXRlZFxuICAgIG5ldyBDdXN0b21SZXNvdXJjZSh0aGlzLCBgJHt0eXBlfSBDbGVhbmVyYCwge1xuICAgICAgc2VydmljZVRva2VuOiBjbGVhbmVyRnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICByZXNvdXJjZVR5cGU6ICdDdXN0b206OkltYWdlQnVpbGRlci1EZWxldGUtUmVzb3VyY2VzJyxcbiAgICAgIHByb3BlcnRpZXM6IDxEZWxldGVSZXNvdXJjZXNQcm9wcz57XG4gICAgICAgIC4uLnRhcmdldCxcbiAgICAgICAgLy8gdGhpcyBvbmUgcHJvcGVydHkgaXMgZm9yIGJhY2t3YXJkcyBjb21wYXRpYmlsaXR5LiB2ZXJzaW9ucyAwLjE2LjAgYW5kIG9sZGVyIHVzZWQgaXQuIGlmIHdlIHJlbW92ZSBpdCBhbmQgYW4gdXBncmFkZSBmcm9tIDAuMTYuMCBmYWlscywgdGhlblxuICAgICAgICAvLyBvbGQgY29kZSBjYW4gZW5kIHVwIHJ1bm5pbmcgb24gdGhlc2UgcHJvcGVydGllcyBhcyBpdCBjbGVhbnMgdXAgdGhlIHVwZGF0ZS4gd2l0aG91dCB0aGlzIHByb3BlcnR5LCB0aGUgb2xkIGNvZGUgd2lsbCBkZWxldGUgZXZlcnkgaW1hZ2UgaW5cbiAgICAgICAgLy8gdGhlIGFjY291bnQuIGl0IGFzc3VtZWQgSW1hZ2VWZXJzaW9uQXJuIHdhcyBzZW50IGFuZCBwYXNzZWQgaXQgYXMtaXMgdG8gTGlzdEltYWdlQnVpbGRWZXJzaW9uc0NvbW1hbmQgd2hpY2ggd2lsbCBoYXBwaWx5IHJldHVybiBhbGwgaW1hZ2VzXG4gICAgICAgIC8vIGluIHRoZSBhY2NvdW50IHdoZW4gaW1hZ2VWZXJzaW9uQXJuIGlzIHVuZGVmaW5lZC5cbiAgICAgICAgLy8gaXQgaXMgYWxzbyB1c2VkIGZvciBzdWNjZXNzZnVsIHVwZ3JhZGVzIGZyb20gMC4xNi4wIHdpdGggdGhlIGNvcm5lciBjYXNlIG9mIHRoZSBkZXBsb3ltZW50IGFsc28gcmVtb3ZpbmcgYSBidWlsZGVyIGF0IHRoZSBzYW1lIHRpbWUgYXMgdGhlXG4gICAgICAgIC8vIHVwZ3JhZGUuIGluIHRoYXQgY2FzZSwgdGhlIG5ldyBjb2RlIHdpbGwgcnVuIGFnYWluc3QgdGhlIG9sZCBwcm9wZXJ0aWVzLiBzbyB0ZWNobmljYWxseSBub3QgdGhlIG9uZSB3ZSBzZW5kIGhlcmUsIGJ1dCBpdCdzIHJlbGV2YW50LlxuICAgICAgICBJbWFnZVZlcnNpb25Bcm46IGNkay5TdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICAgIHNlcnZpY2U6ICdpbWFnZWJ1aWxkZXInLFxuICAgICAgICAgIHJlc291cmNlOiAnaW1hZ2UnLFxuICAgICAgICAgIHJlc291cmNlTmFtZTogYCR7cmVjaXBlTmFtZS50b0xvd2VyQ2FzZSgpfS8ke3ZlcnNpb259YCxcbiAgICAgICAgICBhcm5Gb3JtYXQ6IGNkay5Bcm5Gb3JtYXQuU0xBU0hfUkVTT1VSQ0VfTkFNRSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gZGVsZXRlIG9sZCBpbWFnZXMgZGFpbHlcbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgYCR7dHlwZX0gQ2xlYW5lciBTY2hlZHVsZWAsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiBgRGVsZXRlIG9sZCBHaXRIdWIgUnVubmVyIGltYWdlcyBmb3IgJHt0aGlzLm5vZGUucGF0aH1gLFxuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKER1cmF0aW9uLmRheXMoMSkpLFxuICAgICAgdGFyZ2V0czogW1xuICAgICAgICBuZXcgZXZlbnRzX3RhcmdldHMuTGFtYmRhRnVuY3Rpb24oY2xlYW5lckZ1bmN0aW9uLCB7XG4gICAgICAgICAgZXZlbnQ6IGV2ZW50cy5SdWxlVGFyZ2V0SW5wdXQuZnJvbU9iamVjdCg8U2NoZWR1bGVkQ2xlYW51cEV2ZW50PntcbiAgICAgICAgICAgIFJlcXVlc3RUeXBlOiAnU2NoZWR1bGVkJyxcbiAgICAgICAgICAgIC4uLnRhcmdldCxcbiAgICAgICAgICB9KSxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgIH0pO1xuICB9XG59XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjbGFzcyBBd3NJbWFnZUJ1aWxkZXJGYWlsZWRCdWlsZE5vdGlmaWVyIGltcGxlbWVudHMgY2RrLklBc3BlY3Qge1xuICBwdWJsaWMgc3RhdGljIGNyZWF0ZUZpbHRlcmluZ1RvcGljKHNjb3BlOiBDb25zdHJ1Y3QsIHRhcmdldFRvcGljOiBzbnMuVG9waWMpOiBzbnMuSVRvcGljIHtcbiAgICBjb25zdCB0b3BpYyA9IG5ldyBzbnMuVG9waWMoc2NvcGUsICdJbWFnZSBCdWlsZGVyIEJ1aWxkcycpO1xuICAgIGNvbnN0IGZpbHRlciA9IG5ldyBGaWx0ZXJGYWlsZWRCdWlsZHNGdW5jdGlvbihzY29wZSwgJ0ltYWdlIEJ1aWxkZXIgQnVpbGRzIEZpbHRlcicsIHtcbiAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cChzY29wZSwgU2luZ2xldG9uTG9nVHlwZS5SVU5ORVJfSU1BR0VfQlVJTEQpLFxuICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIFRBUkdFVF9UT1BJQ19BUk46IHRhcmdldFRvcGljLnRvcGljQXJuLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRvcGljLmFkZFN1YnNjcmlwdGlvbihuZXcgc3Vicy5MYW1iZGFTdWJzY3JpcHRpb24oZmlsdGVyKSk7XG4gICAgdGFyZ2V0VG9waWMuZ3JhbnRQdWJsaXNoKGZpbHRlcik7XG5cbiAgICByZXR1cm4gdG9waWM7XG4gIH1cblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHRvcGljOiBzbnMuSVRvcGljKSB7XG4gIH1cblxuICBwdWJsaWMgdmlzaXQobm9kZTogSUNvbnN0cnVjdCk6IHZvaWQge1xuICAgIGlmIChub2RlIGluc3RhbmNlb2YgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyKSB7XG4gICAgICBjb25zdCBidWlsZGVyID0gbm9kZSBhcyBBd3NJbWFnZUJ1aWxkZXJSdW5uZXJJbWFnZUJ1aWxkZXI7XG4gICAgICBjb25zdCBpbmZyYU5vZGUgPSBidWlsZGVyLm5vZGUudHJ5RmluZENoaWxkKCdJbmZyYXN0cnVjdHVyZScpO1xuICAgICAgaWYgKGluZnJhTm9kZSkge1xuICAgICAgICBjb25zdCBpbmZyYSA9IGluZnJhTm9kZSBhcyBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uO1xuICAgICAgICBpbmZyYS5zbnNUb3BpY0FybiA9IHRoaXMudG9waWMudG9waWNBcm47XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YoYnVpbGRlcikuYWRkV2FybmluZygnVW51c2VkIGJ1aWxkZXIgY2Fubm90IGdldCBub3RpZmljYXRpb25zIG9mIGZhaWxlZCBidWlsZHMnKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==