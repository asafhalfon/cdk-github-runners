"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AwsImageBuilderFailedBuildNotifier = exports.AwsImageBuilderRunnerImageBuilder = exports.ImageBuilderComponent = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = require("aws-cdk-lib");
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
    constructor(scope, id, props) {
        super(scope, id);
        this.assets = [];
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
            // AWS Image Builder now rejects an S3Download step with no inputs ("Action S3Download has no inputs")
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
_a = JSII_RTTI_SYMBOL_1;
ImageBuilderComponent[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.ImageBuilderComponent", version: "0.0.0" };
/**
 * @internal
 */
class AwsImageBuilderRunnerImageBuilder extends common_1.RunnerImageBuilderBase {
    constructor(scope, id, props) {
        super(scope, id, props);
        this.boundComponents = [];
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
        // create repository that only keeps one tag
        const repository = new aws_cdk_lib_1.aws_ecr.Repository(this, 'Repository', {
            imageScanOnPush: true,
            imageTagMutability: aws_ecr_1.TagMutability.MUTABLE,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
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
        this.dockerImageCleaner(recipe, repository);
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
    dockerImageCleaner(recipe, repository) {
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
        // delete old version on update and on stack deletion
        this.imageCleaner('Container', recipe.name.toLowerCase(), recipe.version);
        // delete old docker images + IB resources daily
        new aws_cdk_lib_1.aws_imagebuilder.CfnLifecyclePolicy(this, 'Lifecycle Policy Docker', {
            name: (0, common_1.uniqueImageBuilderName)(this),
            description: `Delete old GitHub Runner Docker images for ${this.node.path}`,
            executionRole: new aws_cdk_lib_1.aws_iam.Role(this, 'Lifecycle Policy Docker Role', {
                assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('imagebuilder.amazonaws.com'),
                inlinePolicies: {
                    ib: new aws_cdk_lib_1.aws_iam.PolicyDocument({
                        statements: [
                            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                                actions: ['tag:GetResources', 'imagebuilder:DeleteImage'],
                                resources: ['*'], // Image Builder doesn't support scoping this :(
                            }),
                        ],
                    }),
                    ecr: new aws_cdk_lib_1.aws_iam.PolicyDocument({
                        statements: [
                            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                                actions: ['ecr:BatchGetImage', 'ecr:BatchDeleteImage'],
                                resources: [repository.repositoryArn],
                            }),
                        ],
                    }),
                },
            }).roleArn,
            policyDetails: [{
                    action: {
                        type: 'DELETE',
                        includeResources: {
                            containers: true,
                        },
                    },
                    filter: {
                        type: 'COUNT',
                        value: 2,
                    },
                }],
            resourceType: 'CONTAINER_IMAGE',
            resourceSelection: {
                recipes: [
                    {
                        name: recipe.name,
                        semanticVersion: '1.x.x',
                    },
                ],
            },
        });
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
        if (this.rebuildInterval.toDays() > 0) {
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
        };
        this.amiCleaner(recipe, stackName, builderName);
        return this.boundAmi;
    }
    amiCleaner(recipe, stackName, builderName) {
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
        // delete old version on update and on stack deletion
        this.imageCleaner('Image', recipe.name.toLowerCase(), recipe.version);
        // delete old AMIs + IB resources daily
        new aws_cdk_lib_1.aws_imagebuilder.CfnLifecyclePolicy(this, 'Lifecycle Policy AMI', {
            name: (0, common_1.uniqueImageBuilderName)(this),
            description: `Delete old GitHub Runner AMIs for ${this.node.path}`,
            executionRole: new aws_cdk_lib_1.aws_iam.Role(this, 'Lifecycle Policy AMI Role', {
                assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('imagebuilder.amazonaws.com'),
                inlinePolicies: {
                    ib: new aws_cdk_lib_1.aws_iam.PolicyDocument({
                        statements: [
                            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                                actions: ['tag:GetResources', 'imagebuilder:DeleteImage'],
                                resources: ['*'], // Image Builder doesn't support scoping this :(
                            }),
                        ],
                    }),
                    ami: new aws_cdk_lib_1.aws_iam.PolicyDocument({
                        statements: [
                            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                                actions: ['ec2:DescribeImages', 'ec2:DescribeImageAttribute'],
                                resources: ['*'],
                            }),
                            new aws_cdk_lib_1.aws_iam.PolicyStatement({
                                actions: ['ec2:DeregisterImage', 'ec2:DeleteSnapshot'],
                                resources: ['*'],
                                conditions: {
                                    StringEquals: {
                                        'aws:ResourceTag/GitHubRunners:Stack': stackName,
                                        'aws:ResourceTag/GitHubRunners:Builder': builderName,
                                    },
                                },
                            }),
                        ],
                    }),
                },
            }).roleArn,
            policyDetails: [{
                    action: {
                        type: 'DELETE',
                        includeResources: {
                            amis: true,
                            snapshots: true,
                        },
                    },
                    filter: {
                        type: 'COUNT',
                        value: 2,
                    },
                }],
            resourceType: 'AMI_IMAGE',
            resourceSelection: {
                recipes: [
                    {
                        name: recipe.name,
                        semanticVersion: '1.x.x',
                    },
                ],
            },
        });
    }
    bindComponents() {
        if (this.boundComponents.length == 0) {
            this.boundComponents.push(...this.components.map(c => c._asAwsImageBuilderComponent(this, this.os, this.architecture)));
        }
        return this.boundComponents;
    }
    imageCleaner(type, recipeName, version) {
        const cleanerFunction = (0, utils_1.singletonLambda)(delete_resources_function_1.DeleteResourcesFunction, this, 'aws-image-builder-delete-resources', {
            description: 'Custom resource handler that deletes resources of old versions of EC2 Image Builder images',
            initialPolicy: [
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: [
                        'imagebuilder:ListImageBuildVersions',
                        'imagebuilder:DeleteImage',
                    ],
                    resources: ['*'],
                }),
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: ['ec2:DescribeImages'],
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
        new aws_cdk_lib_1.CustomResource(this, `${type} Cleaner`, {
            serviceToken: cleanerFunction.functionArn,
            resourceType: 'Custom::ImageBuilder-Delete-Resources',
            properties: {
                ImageVersionArn: cdk.Stack.of(this).formatArn({
                    service: 'imagebuilder',
                    resource: 'image',
                    resourceName: `${recipeName}/${version}`,
                    arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME,
                }),
            },
        });
    }
}
exports.AwsImageBuilderRunnerImageBuilder = AwsImageBuilderRunnerImageBuilder;
/**
 * @internal
 */
class AwsImageBuilderFailedBuildNotifier {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9hd3MtaW1hZ2UtYnVpbGRlci9idWlsZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsbUNBQW1DO0FBQ25DLDZDQWdCcUI7QUFDckIsaURBQW9EO0FBQ3BELG1EQUFxRDtBQUVyRCwrQkFBa0Q7QUFDbEQsNkNBQTZEO0FBQzdELDJDQUFzRTtBQUN0RSwyRUFBc0U7QUFFdEUsbUZBQTZFO0FBQzdFLHlDQUFvRjtBQUNwRiwrQ0FBMEY7QUFDMUYsdUNBQW1GO0FBQ25GLGtFQUE2RDtBQUM3RCxzQ0FBb0c7QUFvSHBHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7QUFDSCxNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxRQUFRO0lBYXJELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0M7UUFDOUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUhGLFdBQU0sR0FBc0IsRUFBRSxDQUFDO1FBSzlDLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQztRQUUvQixJQUFJLEtBQUssR0FBVSxFQUFFLENBQUM7UUFFdEIsSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDakIsSUFBSSxNQUFNLEdBQVUsRUFBRSxDQUFDO1lBQ3ZCLElBQUksZUFBZSxHQUFhLEVBQUUsQ0FBQztZQUNuQyxLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDakMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUU5QixJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7b0JBQ3ZCLE1BQU0sQ0FBQyxJQUFJLENBQUM7d0JBQ1YsTUFBTSxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMs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SyxHQUFHLFNBQXdELENBQUM7Z0JBQ3ZFLEtBQUssQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUM7WUFDMUMsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLEdBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFVBQVUsQ0FBQywwREFBMEQsQ0FBQyxDQUFDO1lBQ3JHLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBaENELGdGQWdDQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBBbm5vdGF0aW9ucyxcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19lY3IgYXMgZWNyLFxuICBhd3NfZXZlbnRzIGFzIGV2ZW50cyxcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19pbWFnZWJ1aWxkZXIgYXMgaW1hZ2VidWlsZGVyLFxuICBhd3NfbGFtYmRhIGFzIGxhbWJkYSxcbiAgYXdzX2xvZ3MgYXMgbG9ncyxcbiAgYXdzX3MzX2Fzc2V0cyBhcyBzM19hc3NldHMsXG4gIGF3c19zbnMgYXMgc25zLFxuICBhd3Nfc25zX3N1YnNjcmlwdGlvbnMgYXMgc3VicyxcbiAgQ3VzdG9tUmVzb3VyY2UsXG4gIER1cmF0aW9uLFxuICBSZW1vdmFsUG9saWN5LFxuICBTdGFjayxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgVGFnTXV0YWJpbGl0eSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCwgSUNvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQW1pUmVjaXBlLCBkZWZhdWx0QmFzZUFtaSB9IGZyb20gJy4vYW1pJztcbmltcG9ydCB7IEJhc2VDb250YWluZXJJbWFnZSwgQmFzZUltYWdlIH0gZnJvbSAnLi9iYXNlLWltYWdlJztcbmltcG9ydCB7IENvbnRhaW5lclJlY2lwZSwgZGVmYXVsdEJhc2VEb2NrZXJJbWFnZSB9IGZyb20gJy4vY29udGFpbmVyJztcbmltcG9ydCB7IERlbGV0ZVJlc291cmNlc0Z1bmN0aW9uIH0gZnJvbSAnLi9kZWxldGUtcmVzb3VyY2VzLWZ1bmN0aW9uJztcbmltcG9ydCB7IERlbGV0ZVJlc291cmNlc1Byb3BzIH0gZnJvbSAnLi9kZWxldGUtcmVzb3VyY2VzLmxhbWJkYSc7XG5pbXBvcnQgeyBGaWx0ZXJGYWlsZWRCdWlsZHNGdW5jdGlvbiB9IGZyb20gJy4vZmlsdGVyLWZhaWxlZC1idWlsZHMtZnVuY3Rpb24nO1xuaW1wb3J0IHsgZ2VuZXJhdGVCdWlsZFdvcmtmbG93V2l0aERvY2tlclNldHVwQ29tbWFuZHMsIFdvcmtmbG93IH0gZnJvbSAnLi93b3JrZmxvdyc7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIE9zLCBSdW5uZXJBbWksIFJ1bm5lckltYWdlLCBSdW5uZXJWZXJzaW9uIH0gZnJvbSAnLi4vLi4vcHJvdmlkZXJzJztcbmltcG9ydCB7IHNpbmdsZXRvbkxvZ0dyb3VwLCBzaW5nbGV0b25MYW1iZGEsIFNpbmdsZXRvbkxvZ1R5cGUgfSBmcm9tICcuLi8uLi91dGlscyc7XG5pbXBvcnQgeyBCdWlsZEltYWdlRnVuY3Rpb24gfSBmcm9tICcuLi9idWlsZC1pbWFnZS1mdW5jdGlvbic7XG5pbXBvcnQgeyBSdW5uZXJJbWFnZUJ1aWxkZXJCYXNlLCBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcywgdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSB9IGZyb20gJy4uL2NvbW1vbic7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMge1xuICAvKipcbiAgICogVGhlIGluc3RhbmNlIHR5cGUgdXNlZCB0byBidWlsZCB0aGUgaW1hZ2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IG02aS5sYXJnZVxuICAgKi9cbiAgcmVhZG9ubHkgaW5zdGFuY2VUeXBlPzogZWMyLkluc3RhbmNlVHlwZTtcblxuICAvKipcbiAgICogU2l6ZSBvZiB2b2x1bWUgYXZhaWxhYmxlIGZvciBidWlsZGVyIGluc3RhbmNlcy4gVGhpcyBtb2RpZmllcyB0aGUgYm9vdCB2b2x1bWUgc2l6ZSBhbmQgZG9lc24ndCBhZGQgYW55IGFkZGl0aW9uYWwgdm9sdW1lcy5cbiAgICpcbiAgICogVXNlIHRoaXMgaWYgeW91J3JlIGJ1aWxkaW5nIGltYWdlcyB3aXRoIGJpZyBjb21wb25lbnRzIGFuZCBuZWVkIG1vcmUgc3BhY2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgc2l6ZSBmb3IgQU1JICh1c3VhbGx5IDMwR0IgZm9yIExpbnV4IGFuZCA1MEdCIGZvciBXaW5kb3dzKVxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcblxuICAvKipcbiAgICogT3B0aW9ucyBmb3IgZmFzdCBsYXVuY2guXG4gICAqXG4gICAqIFRoaXMgaXMgb25seSBzdXBwb3J0ZWQgZm9yIFdpbmRvd3MgQU1Jcy5cbiAgICpcbiAgICogQGRlZmF1bHQgZGlzYWJsZWRcbiAgICovXG4gIHJlYWRvbmx5IGZhc3RMYXVuY2hPcHRpb25zPzogRmFzdExhdW5jaE9wdGlvbnM7XG59XG5cbi8qKlxuICogT3B0aW9ucyBmb3IgZmFzdCBsYXVuY2guXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRmFzdExhdW5jaE9wdGlvbnMge1xuICAvKipcbiAgICogRW5hYmxlIGZhc3QgbGF1bmNoIGZvciBBTUlzIGdlbmVyYXRlZCBieSB0aGlzIGJ1aWxkZXIuIEl0IGNyZWF0ZXMgYSBzbmFwc2hvdCBvZiB0aGUgcm9vdCB2b2x1bWUgYW5kIHVzZXMgaXQgdG8gbGF1bmNoIG5ldyBpbnN0YW5jZXMgZmFzdGVyLlxuICAgKlxuICAgKiBUaGlzIGlzIG9ubHkgc3VwcG9ydGVkIGZvciBXaW5kb3dzIEFNSXMuXG4gICAqXG4gICAqIEBub3RlIHRoaXMgZmVhdHVyZSBjb21lcyB3aXRoIGFkZGl0aW9uYWwgcmVzb3VyY2UgY29zdHMuIFNlZSB0aGUgZG9jdW1lbnRhdGlvbiBmb3IgbW9yZSBkZXRhaWxzLiBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vQVdTRUMyL2xhdGVzdC9XaW5kb3dzR3VpZGUvd2luLWZhc3QtbGF1bmNoLW1hbmFnZS1jb3N0cy5odG1sXG4gICAqIEBub3RlIGVuYWJsaW5nIGZhc3QgbGF1bmNoIG9uIGFuIGV4aXN0aW5nIGJ1aWxkZXIgd2lsbCBub3QgZW5hYmxlIGl0IGZvciBleGlzdGluZyBBTUlzLiBJdCB3aWxsIG9ubHkgYWZmZWN0IG5ldyBBTUlzLiBJZiB5b3Ugd2FudCBpbW1lZGlhdGUgZWZmZWN0LCB0cmlnZ2VyIGEgbmV3IGltYWdlIGJ1aWxkLiBBbHRlcm5hdGl2ZWx5LCB5b3UgY2FuIGNyZWF0ZSBhIG5ldyBidWlsZGVyIHdpdGggZmFzdCBsYXVuY2ggZW5hYmxlZCBhbmQgdXNlIGl0IGZvciBuZXcgQU1Jcy5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGVuYWJsZWQ/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBUaGUgbWF4aW11bSBudW1iZXIgb2YgcGFyYWxsZWwgaW5zdGFuY2VzIHRoYXQgYXJlIGxhdW5jaGVkIGZvciBjcmVhdGluZyByZXNvdXJjZXMuXG4gICAqXG4gICAqIE11c3QgYmUgYXQgbGVhc3QgNi5cbiAgICpcbiAgICogQGRlZmF1bHQgNlxuICAgKi9cbiAgcmVhZG9ubHkgbWF4UGFyYWxsZWxMYXVuY2hlcz86IG51bWJlcjtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBwcmUtcHJvdmlzaW9uZWQgc25hcHNob3RzIHRvIGtlZXAgb24gaGFuZCBmb3IgYSBmYXN0LWxhdW5jaCBlbmFibGVkIFdpbmRvd3MgQU1JLlxuICAgKlxuICAgKiBAZGVmYXVsdCAxXG4gICAqL1xuICByZWFkb25seSB0YXJnZXRSZXNvdXJjZUNvdW50PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEFuIGFzc2V0IGluY2x1ZGluZyBmaWxlIG9yIGRpcmVjdG9yeSB0byBwbGFjZSBpbnNpZGUgdGhlIGJ1aWx0IGltYWdlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlQnVpbGRlckFzc2V0IHtcbiAgLyoqXG4gICAqIFBhdGggdG8gcGxhY2UgYXNzZXQgaW4gdGhlIGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgcGF0aDogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBBc3NldCB0byBwbGFjZSBpbiB0aGUgaW1hZ2UuXG4gICAqL1xuICByZWFkb25seSBhc3NldDogczNfYXNzZXRzLkFzc2V0O1xufVxuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIEltYWdlQnVpbGRlckNvbXBvbmVudCBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSW1hZ2VCdWlsZGVyQ29tcG9uZW50UHJvcGVydGllcyB7XG4gIC8qKlxuICAgKiBDb21wb25lbnQgcGxhdGZvcm0uIE11c3QgbWF0Y2ggdGhlIGJ1aWxkZXIgcGxhdGZvcm0uXG4gICAqL1xuICByZWFkb25seSBwbGF0Zm9ybTogJ0xpbnV4JyB8ICdXaW5kb3dzJztcblxuICAvKipcbiAgICogQ29tcG9uZW50IGRpc3BsYXkgbmFtZS5cbiAgICovXG4gIHJlYWRvbmx5IGRpc3BsYXlOYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIENvbXBvbmVudCBkZXNjcmlwdGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGRlc2NyaXB0aW9uOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFNoZWxsIGNvbW1hbmRzIHRvIHJ1biB3aGVuIGFkZGluZyB0aGlzIGNvbXBvbmVudCB0byB0aGUgaW1hZ2UuXG4gICAqXG4gICAqIE9uIExpbnV4LCB0aGVzZSBhcmUgYmFzaCBjb21tYW5kcy4gT24gV2luZG93cywgdGhlcmUgYXJlIFBvd2VyU2hlbGwgY29tbWFuZHMuXG4gICAqL1xuICByZWFkb25seSBjb21tYW5kczogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIE9wdGlvbmFsIGFzc2V0cyB0byBhZGQgdG8gdGhlIGJ1aWx0IGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgYXNzZXRzPzogSW1hZ2VCdWlsZGVyQXNzZXRbXTtcblxuICAvKipcbiAgICogUmVxdWlyZSBhIHJlYm9vdCBhZnRlciBpbnN0YWxsaW5nIHRoaXMgY29tcG9uZW50LlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgcmVib290PzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBDb21wb25lbnRzIGFyZSBhIHNldCBvZiBjb21tYW5kcyB0byBydW4gYW5kIG9wdGlvbmFsIGZpbGVzIHRvIGFkZCB0byBhbiBpbWFnZS4gQ29tcG9uZW50cyBhcmUgdGhlIGJ1aWxkaW5nIGJsb2NrcyBvZiBpbWFnZXMgYnVpbHQgYnkgSW1hZ2UgQnVpbGRlci5cbiAqXG4gKiBFeGFtcGxlOlxuICpcbiAqIGBgYFxuICogbmV3IEltYWdlQnVpbGRlckNvbXBvbmVudCh0aGlzLCAnQVdTIENMSScsIHtcbiAqICAgcGxhdGZvcm06ICdXaW5kb3dzJyxcbiAqICAgZGlzcGxheU5hbWU6ICdBV1MgQ0xJJyxcbiAqICAgZGVzY3JpcHRpb246ICdJbnN0YWxsIGxhdGVzdCB2ZXJzaW9uIG9mIEFXUyBDTEknLFxuICogICBjb21tYW5kczogW1xuICogICAgICckcCA9IFN0YXJ0LVByb2Nlc3MgbXNpZXhlYy5leGUgLVBhc3NUaHJ1IC1XYWl0IC1Bcmd1bWVudExpc3QgXFwnL2kgaHR0cHM6Ly9hd3NjbGkuYW1hem9uYXdzLmNvbS9BV1NDTElWMi5tc2kgL3FuXFwnJyxcbiAqICAgICAnaWYgKCRwLkV4aXRDb2RlIC1uZSAwKSB7IHRocm93IFwiRXhpdCBjb2RlIGlzICRwLkV4aXRDb2RlXCIgfScsXG4gKiAgIF0sXG4gKiB9XG4gKiBgYGBcbiAqXG4gKiBAZGVwcmVjYXRlZCBVc2UgYFJ1bm5lckltYWdlQ29tcG9uZW50YCBpbnN0ZWFkIGFzIHRoaXMgYmUgaW50ZXJuYWwgc29vbi5cbiAqL1xuZXhwb3J0IGNsYXNzIEltYWdlQnVpbGRlckNvbXBvbmVudCBleHRlbmRzIGNkay5SZXNvdXJjZSB7XG4gIC8qKlxuICAgKiBDb21wb25lbnQgQVJOLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGFybjogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBTdXBwb3J0ZWQgcGxhdGZvcm0gZm9yIHRoZSBjb21wb25lbnQuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgcGxhdGZvcm06ICdXaW5kb3dzJyB8ICdMaW51eCc7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBhc3NldHM6IHMzX2Fzc2V0cy5Bc3NldFtdID0gW107XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEltYWdlQnVpbGRlckNvbXBvbmVudFByb3BlcnRpZXMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgdGhpcy5wbGF0Zm9ybSA9IHByb3BzLnBsYXRmb3JtO1xuXG4gICAgbGV0IHN0ZXBzOiBhbnlbXSA9IFtdO1xuXG4gICAgaWYgKHByb3BzLmFzc2V0cykge1xuICAgICAgbGV0IGlucHV0czogYW55W10gPSBbXTtcbiAgICAgIGxldCBleHRyYWN0Q29tbWFuZHM6IHN0cmluZ1tdID0gW107XG4gICAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIHByb3BzLmFzc2V0cykge1xuICAgICAgICB0aGlzLmFzc2V0cy5wdXNoKGFzc2V0LmFzc2V0KTtcblxuICAgICAgICBpZiAoYXNzZXQuYXNzZXQuaXNGaWxlKSB7XG4gICAgICAgICAgaW5wdXRzLnB1c2goe1xuICAgICAgICAgICAgc291cmNlOiBhc3NldC5hc3NldC5zM09iamVjdFVybCxcbiAgICAgICAgICAgIGRlc3RpbmF0aW9uOiBhc3NldC5wYXRoLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKGFzc2V0LmFzc2V0LmlzWmlwQXJjaGl2ZSkge1xuICAgICAgICAgIGlucHV0cy5wdXNoKHtcbiAgICAgICAgICAgIHNvdXJjZTogYXNzZXQuYXNzZXQuczNPYmplY3RVcmwsXG4gICAgICAgICAgICBkZXN0aW5hdGlvbjogYCR7YXNzZXQucGF0aH0uemlwYCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBpZiAocHJvcHMucGxhdGZvcm0gPT09ICdXaW5kb3dzJykge1xuICAgICAgICAgICAgZXh0cmFjdENvbW1hbmRzLnB1c2goYEV4cGFuZC1BcmNoaXZlIFwiJHthc3NldC5wYXRofS56aXBcIiAtRGVzdGluYXRpb25QYXRoIFwiJHthc3NldC5wYXRofVwiYCk7XG4gICAgICAgICAgICBleHRyYWN0Q29tbWFuZHMucHVzaChgZGVsIFwiJHthc3NldC5wYXRofS56aXBcImApO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBleHRyYWN0Q29tbWFuZHMucHVzaChgdW56aXAgXCIke2Fzc2V0LnBhdGh9LnppcFwiIC1kIFwiJHthc3NldC5wYXRofVwiYCk7XG4gICAgICAgICAgICBleHRyYWN0Q29tbWFuZHMucHVzaChgcm0gXCIke2Fzc2V0LnBhdGh9LnppcFwiYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBhc3NldCB0eXBlOiAke2Fzc2V0LmFzc2V0fWApO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIEFXUyBJbWFnZSBCdWlsZGVyIG5vdyByZWplY3RzIGFuIFMzRG93bmxvYWQgc3RlcCB3aXRoIG5vIGlucHV0cyAoXCJBY3Rpb24gUzNEb3dubG9hZCBoYXMgbm8gaW5wdXRzXCIpXG4gICAgICBpZiAoaW5wdXRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc3RlcHMucHVzaCh7XG4gICAgICAgICAgbmFtZTogJ0Rvd25sb2FkJyxcbiAgICAgICAgICBhY3Rpb246ICdTM0Rvd25sb2FkJyxcbiAgICAgICAgICBpbnB1dHMsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoZXh0cmFjdENvbW1hbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc3RlcHMucHVzaCh7XG4gICAgICAgICAgbmFtZTogJ0V4dHJhY3QnLFxuICAgICAgICAgIGFjdGlvbjogcHJvcHMucGxhdGZvcm0gPT09ICdMaW51eCcgPyAnRXhlY3V0ZUJhc2gnIDogJ0V4ZWN1dGVQb3dlclNoZWxsJyxcbiAgICAgICAgICBpbnB1dHM6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiB0aGlzLnByZWZpeENvbW1hbmRzV2l0aEVycm9ySGFuZGxpbmcocHJvcHMucGxhdGZvcm0sIGV4dHJhY3RDb21tYW5kcyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHByb3BzLmNvbW1hbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHN0ZXBzLnB1c2goe1xuICAgICAgICBuYW1lOiAnUnVuJyxcbiAgICAgICAgYWN0aW9uOiBwcm9wcy5wbGF0Zm9ybSA9PT0gJ0xpbnV4JyA/ICdFeGVjdXRlQmFzaCcgOiAnRXhlY3V0ZVBvd2VyU2hlbGwnLFxuICAgICAgICBpbnB1dHM6IHtcbiAgICAgICAgICBjb21tYW5kczogdGhpcy5wcmVmaXhDb21tYW5kc1dpdGhFcnJvckhhbmRsaW5nKHByb3BzLnBsYXRmb3JtLCBwcm9wcy5jb21tYW5kcyksXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHMucmVib290ID8/IGZhbHNlKSB7XG4gICAgICBzdGVwcy5wdXNoKHtcbiAgICAgICAgbmFtZTogJ1JlYm9vdCcsXG4gICAgICAgIGFjdGlvbjogJ1JlYm9vdCcsXG4gICAgICAgIGlucHV0czoge30sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0ge1xuICAgICAgbmFtZTogcHJvcHMuZGlzcGxheU5hbWUsXG4gICAgICBzY2hlbWFWZXJzaW9uOiAnMS4wJyxcbiAgICAgIHBoYXNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2J1aWxkJyxcbiAgICAgICAgICBzdGVwcyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfTtcblxuICAgIGNvbnN0IG5hbWUgPSB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpO1xuICAgIGNvbnN0IGNvbXBvbmVudCA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuQ29tcG9uZW50KHRoaXMsICdDb21wb25lbnQnLCB7XG4gICAgICBuYW1lOiBuYW1lLFxuICAgICAgZGVzY3JpcHRpb246IHByb3BzLmRlc2NyaXB0aW9uLFxuICAgICAgcGxhdGZvcm06IHByb3BzLnBsYXRmb3JtLFxuICAgICAgdmVyc2lvbjogJzEuMC4wJyxcbiAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hcm4gPSBjb21wb25lbnQuYXR0ckFybjtcbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFudHMgcmVhZCBwZXJtaXNzaW9ucyB0byB0aGUgcHJpbmNpcGFsIG9uIHRoZSBhc3NldHMgYnVja2V0cy5cbiAgICpcbiAgICogQHBhcmFtIGdyYW50ZWVcbiAgICovXG4gIGdyYW50QXNzZXRzUmVhZChncmFudGVlOiBpYW0uSUdyYW50YWJsZSkge1xuICAgIGZvciAoY29uc3QgYXNzZXQgb2YgdGhpcy5hc3NldHMpIHtcbiAgICAgIGFzc2V0LmdyYW50UmVhZChncmFudGVlKTtcbiAgICB9XG4gIH1cblxuICBwcmVmaXhDb21tYW5kc1dpdGhFcnJvckhhbmRsaW5nKHBsYXRmb3JtOiAnV2luZG93cycgfCAnTGludXgnLCBjb21tYW5kczogc3RyaW5nW10pIHtcbiAgICBpZiAocGxhdGZvcm0gPT0gJ1dpbmRvd3MnKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICAnJEVycm9yQWN0aW9uUHJlZmVyZW5jZSA9IFxcJ1N0b3BcXCcnLFxuICAgICAgICAnJFByb2dyZXNzUHJlZmVyZW5jZSA9IFxcJ1NpbGVudGx5Q29udGludWVcXCcnLFxuICAgICAgICAnU2V0LVBTRGVidWcgLVRyYWNlIDEnLFxuICAgICAgXS5jb25jYXQoY29tbWFuZHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICAnc2V0IC1leCcsXG4gICAgICBdLmNvbmNhdChjb21tYW5kcyk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjbGFzcyBBd3NJbWFnZUJ1aWxkZXJSdW5uZXJJbWFnZUJ1aWxkZXIgZXh0ZW5kcyBSdW5uZXJJbWFnZUJ1aWxkZXJCYXNlIHtcbiAgcHJpdmF0ZSBib3VuZERvY2tlckltYWdlPzogUnVubmVySW1hZ2U7XG4gIHByaXZhdGUgYm91bmRBbWk/OiBSdW5uZXJBbWk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3M6IE9zO1xuICBwcml2YXRlIHJlYWRvbmx5IGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlO1xuICBwcml2YXRlIHJlYWRvbmx5IGJhc2VJbWFnZTogQmFzZUNvbnRhaW5lckltYWdlO1xuICBwcml2YXRlIHJlYWRvbmx5IGJhc2VBbWk6IEJhc2VJbWFnZTtcbiAgcHJpdmF0ZSByZWFkb25seSBsb2dSZXRlbnRpb246IFJldGVudGlvbkRheXM7XG4gIHByaXZhdGUgcmVhZG9ubHkgbG9nUmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeTtcbiAgcHJpdmF0ZSByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdWJuZXRTZWxlY3Rpb246IGVjMi5TdWJuZXRTZWxlY3Rpb24gfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVidWlsZEludGVydmFsOiBjZGsuRHVyYXRpb247XG4gIHByaXZhdGUgcmVhZG9ubHkgYm91bmRDb21wb25lbnRzOiBJbWFnZUJ1aWxkZXJDb21wb25lbnRbXSA9IFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZTtcbiAgcHJpdmF0ZSBpbmZyYXN0cnVjdHVyZTogaW1hZ2VidWlsZGVyLkNmbkluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSByZWFkb25seSByb2xlOiBpYW0uUm9sZTtcbiAgcHJpdmF0ZSByZWFkb25seSBmYXN0TGF1bmNoT3B0aW9ucz86IEZhc3RMYXVuY2hPcHRpb25zO1xuICBwdWJsaWMgcmVhZG9ubHkgc3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcbiAgcHJpdmF0ZSByZWFkb25seSB3YWl0T25EZXBsb3k6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgZG9ja2VyU2V0dXBDb21tYW5kczogc3RyaW5nW107XG4gIHByaXZhdGUgcmVhZG9ubHkgdGFnczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgcHJpdmF0ZSByZWFkb25seSBjb250YWluZXJXb3JrZmxvdz86IFdvcmtmbG93O1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbnRhaW5lcldvcmtmbG93RXhlY3V0aW9uUm9sZT86IGlhbS5JUm9sZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJ1bm5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBpZiAocHJvcHM/LmNvZGVCdWlsZE9wdGlvbnMpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ2NvZGVCdWlsZE9wdGlvbnMgYXJlIGlnbm9yZWQgd2hlbiB1c2luZyBBV1MgSW1hZ2UgQnVpbGRlciB0byBidWlsZCBydW5uZXIgaW1hZ2VzLicpO1xuICAgIH1cblxuICAgIHRoaXMub3MgPSBwcm9wcz8ub3MgPz8gT3MuTElOVVhfVUJVTlRVO1xuICAgIHRoaXMuYXJjaGl0ZWN0dXJlID0gcHJvcHM/LmFyY2hpdGVjdHVyZSA/PyBBcmNoaXRlY3R1cmUuWDg2XzY0O1xuICAgIHRoaXMucmVidWlsZEludGVydmFsID0gcHJvcHM/LnJlYnVpbGRJbnRlcnZhbCA/PyBEdXJhdGlvbi5kYXlzKDcpO1xuICAgIHRoaXMubG9nUmV0ZW50aW9uID0gcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USDtcbiAgICB0aGlzLmxvZ1JlbW92YWxQb2xpY3kgPSBwcm9wcz8ubG9nUmVtb3ZhbFBvbGljeSA/PyBSZW1vdmFsUG9saWN5LkRFU1RST1k7XG4gICAgdGhpcy52cGMgPSBwcm9wcz8udnBjID8/IGVjMi5WcGMuZnJvbUxvb2t1cCh0aGlzLCAnVlBDJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwcyA/PyBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdTRycsIHsgdnBjOiB0aGlzLnZwYyB9KV07XG4gICAgdGhpcy5zdWJuZXRTZWxlY3Rpb24gPSBwcm9wcz8uc3VibmV0U2VsZWN0aW9uO1xuICAgIHRoaXMuaW5zdGFuY2VUeXBlID0gcHJvcHM/LmF3c0ltYWdlQnVpbGRlck9wdGlvbnM/Lmluc3RhbmNlVHlwZSA/PyBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLk02SSwgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSk7XG4gICAgdGhpcy5mYXN0TGF1bmNoT3B0aW9ucyA9IHByb3BzPy5hd3NJbWFnZUJ1aWxkZXJPcHRpb25zPy5mYXN0TGF1bmNoT3B0aW9ucztcbiAgICB0aGlzLnN0b3JhZ2VTaXplID0gcHJvcHM/LmF3c0ltYWdlQnVpbGRlck9wdGlvbnM/LnN0b3JhZ2VTaXplO1xuICAgIHRoaXMud2FpdE9uRGVwbG95ID0gcHJvcHM/LndhaXRPbkRlcGxveSA/PyB0cnVlO1xuICAgIHRoaXMuZG9ja2VyU2V0dXBDb21tYW5kcyA9IHByb3BzPy5kb2NrZXJTZXR1cENvbW1hbmRzID8/IFtdO1xuXG4gICAgLy8gbm9ybWFsaXplIEJhc2VDb250YWluZXJJbWFnZUlucHV0IHRvIEJhc2VDb250YWluZXJJbWFnZSAoc3RyaW5nIHN1cHBvcnQgaXMgZGVwcmVjYXRlZCwgb25seSBhdCBwdWJsaWMgQVBJIGxldmVsKVxuICAgIGNvbnN0IGJhc2VEb2NrZXJJbWFnZUlucHV0ID0gcHJvcHM/LmJhc2VEb2NrZXJJbWFnZSA/PyBkZWZhdWx0QmFzZURvY2tlckltYWdlKHRoaXMub3MpO1xuICAgIHRoaXMuYmFzZUltYWdlID0gdHlwZW9mIGJhc2VEb2NrZXJJbWFnZUlucHV0ID09PSAnc3RyaW5nJyA/IEJhc2VDb250YWluZXJJbWFnZS5mcm9tU3RyaW5nKGJhc2VEb2NrZXJJbWFnZUlucHV0KSA6IGJhc2VEb2NrZXJJbWFnZUlucHV0O1xuXG4gICAgLy8gbm9ybWFsaXplIEJhc2VJbWFnZUlucHV0IHRvIEJhc2VJbWFnZSAoc3RyaW5nIHN1cHBvcnQgaXMgZGVwcmVjYXRlZCwgb25seSBhdCBwdWJsaWMgQVBJIGxldmVsKVxuICAgIGNvbnN0IGJhc2VBbWlJbnB1dCA9IHByb3BzPy5iYXNlQW1pID8/IGRlZmF1bHRCYXNlQW1pKHRoaXMsIHRoaXMub3MsIHRoaXMuYXJjaGl0ZWN0dXJlKTtcbiAgICB0aGlzLmJhc2VBbWkgPSB0eXBlb2YgYmFzZUFtaUlucHV0ID09PSAnc3RyaW5nJyA/IEJhc2VJbWFnZS5mcm9tU3RyaW5nKGJhc2VBbWlJbnB1dCkgOiBiYXNlQW1pSW5wdXQ7XG5cbiAgICAvLyB3YXJuIGlmIHVzaW5nIGRlcHJlY2F0ZWQgc3RyaW5nIGZvcm1hdFxuICAgIGlmIChwcm9wcz8uYmFzZURvY2tlckltYWdlICYmIHR5cGVvZiBwcm9wcy5iYXNlRG9ja2VySW1hZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKFxuICAgICAgICAnUGFzc2luZyBiYXNlRG9ja2VySW1hZ2UgYXMgYSBzdHJpbmcgaXMgZGVwcmVjYXRlZC4gUGxlYXNlIHVzZSBCYXNlQ29udGFpbmVySW1hZ2Ugc3RhdGljIGZhY3RvcnkgbWV0aG9kcyBpbnN0ZWFkLCBlLmcuLCBCYXNlQ29udGFpbmVySW1hZ2UuZnJvbURvY2tlckh1YihcInVidW50dVwiLCBcIjIyLjA0XCIpIG9yIEJhc2VDb250YWluZXJJbWFnZS5mcm9tU3RyaW5nKFwicHVibGljLmVjci5hd3MvbHRzL3VidW50dToyMi4wNFwiKScsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocHJvcHM/LmJhc2VBbWkgJiYgdHlwZW9mIHByb3BzLmJhc2VBbWkgPT09ICdzdHJpbmcnKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKFxuICAgICAgICAnUGFzc2luZyBiYXNlQW1pIGFzIGEgc3RyaW5nIGlzIGRlcHJlY2F0ZWQuIFBsZWFzZSB1c2UgQmFzZUltYWdlIHN0YXRpYyBmYWN0b3J5IG1ldGhvZHMgaW5zdGVhZCwgZS5nLiwgQmFzZUltYWdlLmZyb21BbWlJZChcImFtaS0xMjM0NVwiKSBvciBCYXNlSW1hZ2UuZnJvbVN0cmluZyhcImFybjphd3M6Li4uXCIpJyxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gdGFncyBmb3IgZmluZGluZyByZXNvdXJjZXNcbiAgICB0aGlzLnRhZ3MgPSB7XG4gICAgICAnR2l0SHViUnVubmVyczpTdGFjayc6IGNkay5TdGFjay5vZih0aGlzKS5zdGFja05hbWUsXG4gICAgICAnR2l0SHViUnVubmVyczpCdWlsZGVyJzogdGhpcy5ub2RlLnBhdGgsXG4gICAgfTtcblxuICAgIC8vIGNvbmZpcm0gaW5zdGFuY2UgdHlwZVxuICAgIGlmICghdGhpcy5hcmNoaXRlY3R1cmUuaW5zdGFuY2VUeXBlTWF0Y2godGhpcy5pbnN0YW5jZVR5cGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEJ1aWxkZXIgYXJjaGl0ZWN0dXJlICgke3RoaXMuYXJjaGl0ZWN0dXJlLm5hbWV9KSBkb2Vzbid0IG1hdGNoIHNlbGVjdGVkIGluc3RhbmNlIHR5cGUgKCR7dGhpcy5pbnN0YW5jZVR5cGV9IC8gJHt0aGlzLmluc3RhbmNlVHlwZS5hcmNoaXRlY3R1cmV9KWApO1xuICAgIH1cblxuICAgIC8vIHdhcm4gYWdhaW5zdCBpc29sYXRlZCBuZXR3b3Jrc1xuICAgIGlmIChwcm9wcz8uc3VibmV0U2VsZWN0aW9uPy5zdWJuZXRUeXBlID09IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ1ByaXZhdGUgaXNvbGF0ZWQgc3VibmV0cyBjYW5ub3QgcHVsbCBmcm9tIHB1YmxpYyBFQ1IgYW5kIFZQQyBlbmRwb2ludCBpcyBub3Qgc3VwcG9ydGVkIHlldC4gJyArXG4gICAgICAgICdTZWUgaHR0cHM6Ly9naXRodWIuY29tL2F3cy9jb250YWluZXJzLXJvYWRtYXAvaXNzdWVzLzExNjAnKTtcbiAgICB9XG5cbiAgICAvLyByb2xlIHRvIGJlIHVzZWQgYnkgQVdTIEltYWdlIEJ1aWxkZXJcbiAgICB0aGlzLnJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWMyLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcblxuICAgIC8vIGNyZWF0ZSBjb250YWluZXIgd29ya2Zsb3cgaWYgZG9ja2VyIHNldHVwIGNvbW1hbmRzIGFyZSBwcm92aWRlZFxuICAgIGlmICh0aGlzLmRvY2tlclNldHVwQ29tbWFuZHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5jb250YWluZXJXb3JrZmxvdyA9IGdlbmVyYXRlQnVpbGRXb3JrZmxvd1dpdGhEb2NrZXJTZXR1cENvbW1hbmRzKHRoaXMsICdCdWlsZCcsIHRoaXMub3MsIHRoaXMuZG9ja2VyU2V0dXBDb21tYW5kcyk7XG4gICAgICB0aGlzLmNvbnRhaW5lcldvcmtmbG93RXhlY3V0aW9uUm9sZSA9IGlhbS5Sb2xlLmZyb21Sb2xlQXJuKHRoaXMsICdJbWFnZSBCdWlsZGVyIFJvbGUnLCBjZGsuU3RhY2sub2YodGhpcykuZm9ybWF0QXJuKHtcbiAgICAgICAgc2VydmljZTogJ2lhbScsXG4gICAgICAgIHJlZ2lvbjogJycsXG4gICAgICAgIHJlc291cmNlOiAncm9sZScsXG4gICAgICAgIHJlc291cmNlTmFtZTogJ2F3cy1zZXJ2aWNlLXJvbGUvaW1hZ2VidWlsZGVyLmFtYXpvbmF3cy5jb20vQVdTU2VydmljZVJvbGVGb3JJbWFnZUJ1aWxkZXInLFxuICAgICAgfSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcGxhdGZvcm0oKSB7XG4gICAgaWYgKHRoaXMub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHJldHVybiAnV2luZG93cyc7XG4gICAgfVxuICAgIGlmICh0aGlzLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgIHJldHVybiAnTGludXgnO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYE9TICR7dGhpcy5vcy5uYW1lfSBpcyBub3Qgc3VwcG9ydGVkIGJ5IEFXUyBJbWFnZSBCdWlsZGVyYCk7XG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IElSdW5uZXJQcm92aWRlciB0byBmaW5hbGl6ZSBzZXR0aW5ncyBhbmQgY3JlYXRlIHRoZSBpbWFnZSBidWlsZGVyLlxuICAgKi9cbiAgYmluZERvY2tlckltYWdlKCk6IFJ1bm5lckltYWdlIHtcbiAgICBpZiAodGhpcy5ib3VuZERvY2tlckltYWdlKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib3VuZERvY2tlckltYWdlO1xuICAgIH1cblxuICAgIC8vIGNyZWF0ZSByZXBvc2l0b3J5IHRoYXQgb25seSBrZWVwcyBvbmUgdGFnXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnUmVwb3NpdG9yeScsIHtcbiAgICAgIGltYWdlU2Nhbk9uUHVzaDogdHJ1ZSxcbiAgICAgIGltYWdlVGFnTXV0YWJpbGl0eTogVGFnTXV0YWJpbGl0eS5NVVRBQkxFLFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZW1wdHlPbkRlbGV0ZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRpc3QgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24odGhpcywgJ0RvY2tlciBEaXN0cmlidXRpb24nLCB7XG4gICAgICBuYW1lOiB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpLFxuICAgICAgLy8gZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXG4gICAgICBkaXN0cmlidXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICByZWdpb246IFN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICBjb250YWluZXJEaXN0cmlidXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJUYWdzOiBbJ2xhdGVzdCddLFxuICAgICAgICAgICAgVGFyZ2V0UmVwb3NpdG9yeToge1xuICAgICAgICAgICAgICBTZXJ2aWNlOiAnRUNSJyxcbiAgICAgICAgICAgICAgUmVwb3NpdG9yeU5hbWU6IHJlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdGFnczogdGhpcy50YWdzLFxuICAgIH0pO1xuXG4gICAgbGV0IGRvY2tlcmZpbGVUZW1wbGF0ZSA9IGBGUk9NIHt7eyBpbWFnZWJ1aWxkZXI6cGFyZW50SW1hZ2UgfX19XG57e3sgaW1hZ2VidWlsZGVyOmVudmlyb25tZW50cyB9fX1cbnt7eyBpbWFnZWJ1aWxkZXI6Y29tcG9uZW50cyB9fX1gO1xuXG4gICAgZm9yIChjb25zdCBjIG9mIHRoaXMuY29tcG9uZW50cykge1xuICAgICAgY29uc3QgY29tbWFuZHMgPSBjLmdldERvY2tlckNvbW1hbmRzKHRoaXMub3MsIHRoaXMuYXJjaGl0ZWN0dXJlKTtcbiAgICAgIGlmIChjb21tYW5kcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGRvY2tlcmZpbGVUZW1wbGF0ZSArPSAnXFxuJyArIGNvbW1hbmRzLmpvaW4oJ1xcbicpICsgJ1xcbic7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVjaXBlID0gbmV3IENvbnRhaW5lclJlY2lwZSh0aGlzLCAnQ29udGFpbmVyIFJlY2lwZScsIHtcbiAgICAgIHBsYXRmb3JtOiB0aGlzLnBsYXRmb3JtKCksXG4gICAgICBjb21wb25lbnRzOiB0aGlzLmJpbmRDb21wb25lbnRzKCksXG4gICAgICB0YXJnZXRSZXBvc2l0b3J5OiByZXBvc2l0b3J5LFxuICAgICAgZG9ja2VyZmlsZVRlbXBsYXRlOiBkb2NrZXJmaWxlVGVtcGxhdGUsXG4gICAgICBwYXJlbnRJbWFnZTogdGhpcy5iYXNlSW1hZ2UuaW1hZ2UsXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgfSk7XG5cbiAgICBjb25zdCBsb2cgPSB0aGlzLmNyZWF0ZUxvZygnRG9ja2VyIExvZycsIHJlY2lwZS5uYW1lKTtcbiAgICBjb25zdCBpbmZyYSA9IHRoaXMuY3JlYXRlSW5mcmFzdHJ1Y3R1cmUoW1xuICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlJyksXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0VDMkluc3RhbmNlUHJvZmlsZUZvckltYWdlQnVpbGRlckVDUkNvbnRhaW5lckJ1aWxkcycpLFxuICAgIF0pO1xuXG4gICAgaWYgKHRoaXMud2FpdE9uRGVwbG95KSB7XG4gICAgICB0aGlzLmNyZWF0ZUltYWdlKGluZnJhLCBkaXN0LCBsb2csIHVuZGVmaW5lZCwgcmVjaXBlLmFybik7XG4gICAgfVxuICAgIHRoaXMuZG9ja2VySW1hZ2VDbGVhbmVyKHJlY2lwZSwgcmVwb3NpdG9yeSk7XG5cbiAgICB0aGlzLmNyZWF0ZVBpcGVsaW5lKGluZnJhLCBkaXN0LCBsb2csIHVuZGVmaW5lZCwgcmVjaXBlLmFybik7XG5cbiAgICB0aGlzLmJvdW5kRG9ja2VySW1hZ2UgPSB7XG4gICAgICBpbWFnZVJlcG9zaXRvcnk6IHJlcG9zaXRvcnksXG4gICAgICBpbWFnZVRhZzogJ2xhdGVzdCcsXG4gICAgICBvczogdGhpcy5vcyxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBsb2dHcm91cDogbG9nLFxuICAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygndW5rbm93bicpLFxuICAgICAgLy8gbm8gZGVwZW5kYWJsZSBhcyBDbG91ZEZvcm1hdGlvbiB3aWxsIGZhaWwgdG8gZ2V0IGltYWdlIEFSTiBvbmNlIHRoZSBpbWFnZSBpcyBkZWxldGVkICh3ZSBkZWxldGUgb2xkIGltYWdlcyBkYWlseSlcbiAgICB9O1xuXG4gICAgcmV0dXJuIHRoaXMuYm91bmREb2NrZXJJbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgZG9ja2VySW1hZ2VDbGVhbmVyKHJlY2lwZTogQ29udGFpbmVyUmVjaXBlLCByZXBvc2l0b3J5OiBlY3IuSVJlcG9zaXRvcnkpIHtcbiAgICAvLyB0aGlzIGlzIGhlcmUgdG8gcHJvdmlkZSBzYWZlIHVwZ3JhZGUgZnJvbSBvbGQgY2RrLWdpdGh1Yi1ydW5uZXJzIHZlcnNpb25zXG4gICAgLy8gdGhpcyBsYW1iZGEgd2FzIHVzZWQgYnkgYSBjdXN0b20gcmVzb3VyY2UgdG8gZGVsZXRlIGFsbCBpbWFnZXMgYnVpbGRzIG9uIGNsZWFudXBcbiAgICAvLyBpZiB3ZSByZW1vdmUgdGhlIGN1c3RvbSByZXNvdXJjZSBhbmQgdGhlIGxhbWJkYSwgdGhlIG9sZCBpbWFnZXMgd2lsbCBiZSBkZWxldGVkIG9uIHVwZGF0ZVxuICAgIC8vIGtlZXBpbmcgdGhlIGxhbWJkYSBidXQgcmVtb3ZpbmcgdGhlIHBlcm1pc3Npb25zIHdpbGwgbWFrZSBzdXJlIHRoYXQgZGVsZXRpb24gd2lsbCBmYWlsXG4gICAgY29uc3Qgb2xkRGVsZXRlciA9IHNpbmdsZXRvbkxhbWJkYShCdWlsZEltYWdlRnVuY3Rpb24sIHRoaXMsICdidWlsZC1pbWFnZScsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3VzdG9tIHJlc291cmNlIGhhbmRsZXIgdGhhdCB0cmlnZ2VycyBDb2RlQnVpbGQgdG8gYnVpbGQgcnVubmVyIGltYWdlcycsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygzKSxcbiAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlJVTk5FUl9JTUFHRV9CVUlMRCksXG4gICAgICBsb2dnaW5nRm9ybWF0OiBsYW1iZGEuTG9nZ2luZ0Zvcm1hdC5KU09OLFxuICAgIH0pO1xuICAgIG9sZERlbGV0ZXIuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5ERU5ZLFxuICAgICAgYWN0aW9uczogWydpbWFnZWJ1aWxkZXI6RGVsZXRlSW1hZ2UnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gZGVsZXRlIG9sZCB2ZXJzaW9uIG9uIHVwZGF0ZSBhbmQgb24gc3RhY2sgZGVsZXRpb25cbiAgICB0aGlzLmltYWdlQ2xlYW5lcignQ29udGFpbmVyJywgcmVjaXBlLm5hbWUudG9Mb3dlckNhc2UoKSwgcmVjaXBlLnZlcnNpb24pO1xuXG4gICAgLy8gZGVsZXRlIG9sZCBkb2NrZXIgaW1hZ2VzICsgSUIgcmVzb3VyY2VzIGRhaWx5XG4gICAgbmV3IGltYWdlYnVpbGRlci5DZm5MaWZlY3ljbGVQb2xpY3kodGhpcywgJ0xpZmVjeWNsZSBQb2xpY3kgRG9ja2VyJywge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIGRlc2NyaXB0aW9uOiBgRGVsZXRlIG9sZCBHaXRIdWIgUnVubmVyIERvY2tlciBpbWFnZXMgZm9yICR7dGhpcy5ub2RlLnBhdGh9YCxcbiAgICAgIGV4ZWN1dGlvblJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnTGlmZWN5Y2xlIFBvbGljeSBEb2NrZXIgUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2ltYWdlYnVpbGRlci5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgaWI6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uczogWyd0YWc6R2V0UmVzb3VyY2VzJywgJ2ltYWdlYnVpbGRlcjpEZWxldGVJbWFnZSddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sIC8vIEltYWdlIEJ1aWxkZXIgZG9lc24ndCBzdXBwb3J0IHNjb3BpbmcgdGhpcyA6KFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgICAgZWNyOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnZWNyOkJhdGNoR2V0SW1hZ2UnLCAnZWNyOkJhdGNoRGVsZXRlSW1hZ2UnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtyZXBvc2l0b3J5LnJlcG9zaXRvcnlBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KS5yb2xlQXJuLFxuICAgICAgcG9saWN5RGV0YWlsczogW3tcbiAgICAgICAgYWN0aW9uOiB7XG4gICAgICAgICAgdHlwZTogJ0RFTEVURScsXG4gICAgICAgICAgaW5jbHVkZVJlc291cmNlczoge1xuICAgICAgICAgICAgY29udGFpbmVyczogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBmaWx0ZXI6IHtcbiAgICAgICAgICB0eXBlOiAnQ09VTlQnLFxuICAgICAgICAgIHZhbHVlOiAyLFxuICAgICAgICB9LFxuICAgICAgfV0sXG4gICAgICByZXNvdXJjZVR5cGU6ICdDT05UQUlORVJfSU1BR0UnLFxuICAgICAgcmVzb3VyY2VTZWxlY3Rpb246IHtcbiAgICAgICAgcmVjaXBlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6IHJlY2lwZS5uYW1lLFxuICAgICAgICAgICAgc2VtYW50aWNWZXJzaW9uOiAnMS54LngnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGNyZWF0ZUxvZyhpZDogc3RyaW5nLCByZWNpcGVOYW1lOiBzdHJpbmcpOiBsb2dzLkxvZ0dyb3VwIHtcbiAgICByZXR1cm4gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgaWQsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvaW1hZ2VidWlsZGVyLyR7cmVjaXBlTmFtZX1gLFxuICAgICAgcmV0ZW50aW9uOiB0aGlzLmxvZ1JldGVudGlvbixcbiAgICAgIHJlbW92YWxQb2xpY3k6IHRoaXMubG9nUmVtb3ZhbFBvbGljeSxcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBjcmVhdGVJbmZyYXN0cnVjdHVyZShtYW5hZ2VkUG9saWNpZXM6IGlhbS5JTWFuYWdlZFBvbGljeVtdKTogaW1hZ2VidWlsZGVyLkNmbkluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbiB7XG4gICAgaWYgKHRoaXMuaW5mcmFzdHJ1Y3R1cmUpIHtcbiAgICAgIHJldHVybiB0aGlzLmluZnJhc3RydWN0dXJlO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbWFuYWdlZFBvbGljeSBvZiBtYW5hZ2VkUG9saWNpZXMpIHtcbiAgICAgIHRoaXMucm9sZS5hZGRNYW5hZ2VkUG9saWN5KG1hbmFnZWRQb2xpY3kpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgY29tcG9uZW50IG9mIHRoaXMuYm91bmRDb21wb25lbnRzKSB7XG4gICAgICBjb21wb25lbnQuZ3JhbnRBc3NldHNSZWFkKHRoaXMucm9sZSk7XG4gICAgfVxuXG4gICAgdGhpcy5pbmZyYXN0cnVjdHVyZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uKHRoaXMsICdJbmZyYXN0cnVjdHVyZScsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICAvLyBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcbiAgICAgIHN1Ym5ldElkOiB0aGlzLnZwYz8uc2VsZWN0U3VibmV0cyh0aGlzLnN1Ym5ldFNlbGVjdGlvbikuc3VibmV0SWRzWzBdLFxuICAgICAgc2VjdXJpdHlHcm91cElkczogdGhpcy5zZWN1cml0eUdyb3Vwcz8ubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICBpbnN0YW5jZVR5cGVzOiBbdGhpcy5pbnN0YW5jZVR5cGUudG9TdHJpbmcoKV0sXG4gICAgICBpbnN0YW5jZU1ldGFkYXRhT3B0aW9uczoge1xuICAgICAgICBodHRwVG9rZW5zOiAncmVxdWlyZWQnLFxuICAgICAgICAvLyBDb250YWluZXIgYnVpbGRzIHJlcXVpcmUgYSBtaW5pbXVtIG9mIHR3byBob3BzLlxuICAgICAgICBodHRwUHV0UmVzcG9uc2VIb3BMaW1pdDogMixcbiAgICAgIH0sXG4gICAgICBpbnN0YW5jZVByb2ZpbGVOYW1lOiBuZXcgaWFtLkNmbkluc3RhbmNlUHJvZmlsZSh0aGlzLCAnSW5zdGFuY2UgUHJvZmlsZScsIHtcbiAgICAgICAgcm9sZXM6IFtcbiAgICAgICAgICB0aGlzLnJvbGUucm9sZU5hbWUsXG4gICAgICAgIF0sXG4gICAgICB9KS5yZWYsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5pbmZyYXN0cnVjdHVyZTtcbiAgfVxuXG4gIHByaXZhdGUgd29ya2Zsb3dDb25maWcoY29udGFpbmVyUmVjaXBlQXJuPzogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuY29udGFpbmVyV29ya2Zsb3cgJiYgdGhpcy5jb250YWluZXJXb3JrZmxvd0V4ZWN1dGlvblJvbGUgJiYgY29udGFpbmVyUmVjaXBlQXJuKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB3b3JrZmxvd3M6IFt7XG4gICAgICAgICAgd29ya2Zsb3dBcm46IHRoaXMuY29udGFpbmVyV29ya2Zsb3cuYXJuLFxuICAgICAgICB9XSxcbiAgICAgICAgZXhlY3V0aW9uUm9sZTogdGhpcy5jb250YWluZXJXb3JrZmxvd0V4ZWN1dGlvblJvbGUucm9sZUFybixcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgY3JlYXRlSW1hZ2UoaW5mcmE6IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24sIGRpc3Q6IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uLCBsb2c6IGxvZ3MuTG9nR3JvdXAsXG4gICAgaW1hZ2VSZWNpcGVBcm4/OiBzdHJpbmcsIGNvbnRhaW5lclJlY2lwZUFybj86IHN0cmluZyk6IGltYWdlYnVpbGRlci5DZm5JbWFnZSB7XG4gICAgY29uc3QgaW1hZ2UgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkltYWdlKHRoaXMsIHRoaXMuYW1pT3JDb250YWluZXJJZCgnSW1hZ2UnLCBpbWFnZVJlY2lwZUFybiwgY29udGFpbmVyUmVjaXBlQXJuKSwge1xuICAgICAgaW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uQXJuOiBpbmZyYS5hdHRyQXJuLFxuICAgICAgZGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbkFybjogZGlzdC5hdHRyQXJuLFxuICAgICAgaW1hZ2VSZWNpcGVBcm4sXG4gICAgICBjb250YWluZXJSZWNpcGVBcm4sXG4gICAgICBpbWFnZVRlc3RzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBpbWFnZVRlc3RzRW5hYmxlZDogZmFsc2UsXG4gICAgICB9LFxuICAgICAgdGFnczogdGhpcy50YWdzLFxuICAgICAgLi4udGhpcy53b3JrZmxvd0NvbmZpZyhjb250YWluZXJSZWNpcGVBcm4pLFxuICAgIH0pO1xuICAgIGltYWdlLm5vZGUuYWRkRGVwZW5kZW5jeShpbmZyYSk7XG4gICAgaW1hZ2Uubm9kZS5hZGREZXBlbmRlbmN5KGxvZyk7XG5cbiAgICAvLyBkbyBub3QgZGVsZXRlIHRoZSBpbWFnZSBhcyBpdCB3aWxsIGJlIGRlbGV0ZWQgYnkgaW1hZ2VDbGVhbmVyKCkuXG4gICAgLy8gaWYgd2UgZGVsZXRlIGl0IGhlcmUsIGltYWdlQ2xlYW5lcigpIHdvbid0IGJlIGFibGUgdG8gZmluZCB0aGUgaW1hZ2UuXG4gICAgLy8gaWYgaW1hZ2VDbGVhbmVyKCkgY2FuJ3QgZmluZCB0aGUgaW1hZ2UsIGl0IHdvbid0IGJlIGFibGUgdG8gZGVsZXRlIHRoZSBsaW5rZWQgQU1JL0RvY2tlciBpbWFnZS5cbiAgICAvLyB1c2UgUkVUQUlOX09OX1VQREFURV9PUl9ERUxFVEUsIHNvIGV2ZXJ5dGhpbmcgaXMgY2xlYW5lZCBvbmx5IG9uIHJvbGxiYWNrLlxuICAgIGltYWdlLmFwcGx5UmVtb3ZhbFBvbGljeShSZW1vdmFsUG9saWN5LlJFVEFJTl9PTl9VUERBVEVfT1JfREVMRVRFKTtcblxuICAgIHJldHVybiBpbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgYW1pT3JDb250YWluZXJJZChiYXNlSWQ6IHN0cmluZywgaW1hZ2VSZWNpcGVBcm4/OiBzdHJpbmcsIGNvbnRhaW5lclJlY2lwZUFybj86IHN0cmluZykge1xuICAgIGlmIChpbWFnZVJlY2lwZUFybikge1xuICAgICAgcmV0dXJuIGBBTUkgJHtiYXNlSWR9YDtcbiAgICB9XG4gICAgaWYgKGNvbnRhaW5lclJlY2lwZUFybikge1xuICAgICAgcmV0dXJuIGBEb2NrZXIgJHtiYXNlSWR9YDtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKCdFaXRoZXIgaW1hZ2VSZWNpcGVBcm4gb3IgY29udGFpbmVyUmVjaXBlQXJuIG11c3QgYmUgZGVmaW5lZCcpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGNyZWF0ZVBpcGVsaW5lKGluZnJhOiBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uLCBkaXN0OiBpbWFnZWJ1aWxkZXIuQ2ZuRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbiwgbG9nOiBsb2dzLkxvZ0dyb3VwLFxuICAgIGltYWdlUmVjaXBlQXJuPzogc3RyaW5nLCBjb250YWluZXJSZWNpcGVBcm4/OiBzdHJpbmcpOiBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VQaXBlbGluZSB7XG4gICAgLy8gc2V0IHNjaGVkdWxlXG4gICAgbGV0IHNjaGVkdWxlT3B0aW9uczogaW1hZ2VidWlsZGVyLkNmbkltYWdlUGlwZWxpbmUuU2NoZWR1bGVQcm9wZXJ0eSB8IHVuZGVmaW5lZDtcbiAgICBpZiAodGhpcy5yZWJ1aWxkSW50ZXJ2YWwudG9EYXlzKCkgPiAwKSB7XG4gICAgICBzY2hlZHVsZU9wdGlvbnMgPSB7XG4gICAgICAgIHNjaGVkdWxlRXhwcmVzc2lvbjogZXZlbnRzLlNjaGVkdWxlLnJhdGUodGhpcy5yZWJ1aWxkSW50ZXJ2YWwpLmV4cHJlc3Npb25TdHJpbmcsXG4gICAgICAgIHBpcGVsaW5lRXhlY3V0aW9uU3RhcnRDb25kaXRpb246ICdFWFBSRVNTSU9OX01BVENIX09OTFknLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBnZW5lcmF0ZSBwaXBlbGluZVxuICAgIGNvbnN0IHBpcGVsaW5lID0gbmV3IGltYWdlYnVpbGRlci5DZm5JbWFnZVBpcGVsaW5lKHRoaXMsIHRoaXMuYW1pT3JDb250YWluZXJJZCgnUGlwZWxpbmUnLCBpbWFnZVJlY2lwZUFybiwgY29udGFpbmVyUmVjaXBlQXJuKSwge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIC8vIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxuICAgICAgaW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uQXJuOiBpbmZyYS5hdHRyQXJuLFxuICAgICAgZGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbkFybjogZGlzdC5hdHRyQXJuLFxuICAgICAgaW1hZ2VSZWNpcGVBcm4sXG4gICAgICBjb250YWluZXJSZWNpcGVBcm4sXG4gICAgICBzY2hlZHVsZTogc2NoZWR1bGVPcHRpb25zLFxuICAgICAgaW1hZ2VUZXN0c0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgaW1hZ2VUZXN0c0VuYWJsZWQ6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIHRhZ3M6IHRoaXMudGFncyxcbiAgICAgIC4uLnRoaXMud29ya2Zsb3dDb25maWcoY29udGFpbmVyUmVjaXBlQXJuKSxcbiAgICB9KTtcbiAgICBwaXBlbGluZS5ub2RlLmFkZERlcGVuZGVuY3koaW5mcmEpO1xuICAgIHBpcGVsaW5lLm5vZGUuYWRkRGVwZW5kZW5jeShsb2cpO1xuXG4gICAgcmV0dXJuIHBpcGVsaW5lO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcHVibGljIGdldCBjb25uZWN0aW9ucygpOiBlYzIuQ29ubmVjdGlvbnMge1xuICAgIHJldHVybiBuZXcgZWMyLkNvbm5lY3Rpb25zKHsgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMgfSk7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGdyYW50UHJpbmNpcGFsKCk6IGlhbS5JUHJpbmNpcGFsIHtcbiAgICByZXR1cm4gdGhpcy5yb2xlO1xuICB9XG5cbiAgYmluZEFtaSgpOiBSdW5uZXJBbWkge1xuICAgIGlmICh0aGlzLmJvdW5kQW1pKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib3VuZEFtaTtcbiAgICB9XG5cbiAgICBjb25zdCBsYXVuY2hUZW1wbGF0ZSA9IG5ldyBlYzIuTGF1bmNoVGVtcGxhdGUodGhpcywgJ0xhdW5jaCB0ZW1wbGF0ZScsIHtcbiAgICAgIHJlcXVpcmVJbWRzdjI6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBsYXVuY2hUZW1wbGF0ZUNvbmZpZ3M6IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uLkxhdW5jaFRlbXBsYXRlQ29uZmlndXJhdGlvblByb3BlcnR5W10gPSBbe1xuICAgICAgbGF1bmNoVGVtcGxhdGVJZDogbGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVJZCxcbiAgICAgIHNldERlZmF1bHRWZXJzaW9uOiB0cnVlLFxuICAgIH1dO1xuICAgIGNvbnN0IGZhc3RMYXVuY2hDb25maWdzOiBpbWFnZWJ1aWxkZXIuQ2ZuRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbi5GYXN0TGF1bmNoQ29uZmlndXJhdGlvblByb3BlcnR5W10gPSBbXTtcblxuICAgIGlmICh0aGlzLmZhc3RMYXVuY2hPcHRpb25zPy5lbmFibGVkID8/IGZhbHNlKSB7XG4gICAgICBpZiAoIXRoaXMub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYXN0IGxhdW5jaCBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgV2luZG93cycpO1xuICAgICAgfVxuXG4gICAgICAvLyBjcmVhdGUgYSBzZXBhcmF0ZSBsYXVuY2ggdGVtcGxhdGUgZm9yIGZhc3QgbGF1bmNoIHNvOlxuICAgICAgLy8gIC0gc2V0dGluZ3MgZG9uJ3QgYWZmZWN0IHRoZSBydW5uZXJzXG4gICAgICAvLyAgLSBlbmFibGluZyBmYXN0IGxhdW5jaCBvbiBhbiBleGlzdGluZyBidWlsZGVyIHdvcmtzICh3aXRob3V0IGEgbmV3IGxhdW5jaCB0ZW1wbGF0ZSwgRUMyIEltYWdlIEJ1aWxkZXIgd2lsbCB1c2UgdGhlIGZpcnN0IHZlcnNpb24gb2YgdGhlIGxhdW5jaCB0ZW1wbGF0ZSwgd2hpY2ggZG9lc24ndCBoYXZlIGluc3RhbmNlIG9yIFZQQyBjb25maWcpXG4gICAgICAvLyAgLSBzZXR0aW5nIHZwYyArIHN1Ym5ldCBvbiB0aGUgbWFpbiBsYXVuY2ggdGVtcGxhdGUgd2lsbCBjYXVzZSBSdW5JbnN0YW5jZXMgdG8gZmFpbFxuICAgICAgLy8gIC0gRUMyIEltYWdlIEJ1aWxkZXIgc2VlbXMgdG8gZ2V0IGNvbmZ1c2VkIHdpdGggd2hpY2ggbGF1bmNoIHRlbXBsYXRlIHZlcnNpb24gdG8gYmFzZSBhbnkgbmV3IHZlcnNpb24gb24sIHNvIGEgbmV3IHRlbXBsYXRlIGlzIGFsd2F5cyBiZXN0XG4gICAgICBjb25zdCBmYXN0TGF1bmNoVGVtcGxhdGUgPSBuZXcgZWMyLkNmbkxhdW5jaFRlbXBsYXRlKHRoaXMsICdGYXN0IExhdW5jaCBUZW1wbGF0ZScsIHtcbiAgICAgICAgbGF1bmNoVGVtcGxhdGVEYXRhOiB7XG4gICAgICAgICAgbWV0YWRhdGFPcHRpb25zOiB7XG4gICAgICAgICAgICBodHRwVG9rZW5zOiAncmVxdWlyZWQnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaW5zdGFuY2VUeXBlOiB0aGlzLmluc3RhbmNlVHlwZS50b1N0cmluZygpLFxuICAgICAgICAgIG5ldHdvcmtJbnRlcmZhY2VzOiBbe1xuICAgICAgICAgICAgc3VibmV0SWQ6IHRoaXMudnBjPy5zZWxlY3RTdWJuZXRzKHRoaXMuc3VibmV0U2VsZWN0aW9uKS5zdWJuZXRJZHNbMF0sXG4gICAgICAgICAgICBkZXZpY2VJbmRleDogMCxcbiAgICAgICAgICAgIGdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgICAgICB9XSxcbiAgICAgICAgICB0YWdTcGVjaWZpY2F0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICByZXNvdXJjZVR5cGU6ICdpbnN0YW5jZScsXG4gICAgICAgICAgICAgIHRhZ3M6IFt7XG4gICAgICAgICAgICAgICAga2V5OiAnTmFtZScsXG4gICAgICAgICAgICAgICAgdmFsdWU6IGAke3RoaXMubm9kZS5wYXRofS9GYXN0IExhdW5jaCBJbnN0YW5jZWAsXG4gICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiAndm9sdW1lJyxcbiAgICAgICAgICAgICAgdGFnczogW3tcbiAgICAgICAgICAgICAgICBrZXk6ICdOYW1lJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogYCR7dGhpcy5ub2RlLnBhdGh9L0Zhc3QgTGF1bmNoIEluc3RhbmNlYCxcbiAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHRhZ1NwZWNpZmljYXRpb25zOiBbe1xuICAgICAgICAgIHJlc291cmNlVHlwZTogJ2xhdW5jaC10ZW1wbGF0ZScsXG4gICAgICAgICAgdGFnczogW3tcbiAgICAgICAgICAgIGtleTogJ05hbWUnLFxuICAgICAgICAgICAgdmFsdWU6IGAke3RoaXMubm9kZS5wYXRofS9GYXN0IExhdW5jaCBUZW1wbGF0ZWAsXG4gICAgICAgICAgfV0sXG4gICAgICAgIH1dLFxuICAgICAgfSk7XG5cbiAgICAgIGxhdW5jaFRlbXBsYXRlQ29uZmlncy5wdXNoKHtcbiAgICAgICAgbGF1bmNoVGVtcGxhdGVJZDogZmFzdExhdW5jaFRlbXBsYXRlLmF0dHJMYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgICBzZXREZWZhdWx0VmVyc2lvbjogdHJ1ZSxcbiAgICAgIH0pO1xuICAgICAgZmFzdExhdW5jaENvbmZpZ3MucHVzaCh7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGxhdW5jaFRlbXBsYXRlOiB7XG4gICAgICAgICAgbGF1bmNoVGVtcGxhdGVJZDogZmFzdExhdW5jaFRlbXBsYXRlLmF0dHJMYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgICB9LFxuICAgICAgICBtYXhQYXJhbGxlbExhdW5jaGVzOiB0aGlzLmZhc3RMYXVuY2hPcHRpb25zPy5tYXhQYXJhbGxlbExhdW5jaGVzID8/IDYsXG4gICAgICAgIHNuYXBzaG90Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIHRhcmdldFJlc291cmNlQ291bnQ6IHRoaXMuZmFzdExhdW5jaE9wdGlvbnM/LnRhcmdldFJlc291cmNlQ291bnQgPz8gMSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YWNrTmFtZSA9IGNkay5TdGFjay5vZih0aGlzKS5zdGFja05hbWU7XG4gICAgY29uc3QgYnVpbGRlck5hbWUgPSB0aGlzLm5vZGUucGF0aDtcblxuICAgIGNvbnN0IGRpc3QgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24odGhpcywgJ0FNSSBEaXN0cmlidXRpb24nLCB7XG4gICAgICBuYW1lOiB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpLFxuICAgICAgLy8gZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXG4gICAgICBkaXN0cmlidXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICByZWdpb246IFN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICBhbWlEaXN0cmlidXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBOYW1lOiBgJHtjZGsuTmFtZXMudW5pcXVlUmVzb3VyY2VOYW1lKHRoaXMsIHtcbiAgICAgICAgICAgICAgbWF4TGVuZ3RoOiAxMDAsXG4gICAgICAgICAgICAgIHNlcGFyYXRvcjogJy0nLFxuICAgICAgICAgICAgICBhbGxvd2VkU3BlY2lhbENoYXJhY3RlcnM6ICdfLScsXG4gICAgICAgICAgICB9KX0te3sgaW1hZ2VidWlsZGVyOmJ1aWxkRGF0ZSB9fWAsXG4gICAgICAgICAgICBBbWlUYWdzOiB7XG4gICAgICAgICAgICAgICdOYW1lJzogdGhpcy5ub2RlLmlkLFxuICAgICAgICAgICAgICAnR2l0SHViUnVubmVyczpTdGFjayc6IHN0YWNrTmFtZSxcbiAgICAgICAgICAgICAgJ0dpdEh1YlJ1bm5lcnM6QnVpbGRlcic6IGJ1aWxkZXJOYW1lLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGxhdW5jaFRlbXBsYXRlQ29uZmlndXJhdGlvbnM6IGxhdW5jaFRlbXBsYXRlQ29uZmlncyxcbiAgICAgICAgICBmYXN0TGF1bmNoQ29uZmlndXJhdGlvbnM6IGZhc3RMYXVuY2hDb25maWdzLmxlbmd0aCA+IDAgPyBmYXN0TGF1bmNoQ29uZmlncyA6IHVuZGVmaW5lZCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgfSk7XG5cbiAgICBjb25zdCByZWNpcGUgPSBuZXcgQW1pUmVjaXBlKHRoaXMsICdBbWkgUmVjaXBlJywge1xuICAgICAgcGxhdGZvcm06IHRoaXMucGxhdGZvcm0oKSxcbiAgICAgIGNvbXBvbmVudHM6IHRoaXMuYmluZENvbXBvbmVudHMoKSxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBiYXNlQW1pOiB0aGlzLmJhc2VBbWksXG4gICAgICBzdG9yYWdlU2l6ZTogdGhpcy5zdG9yYWdlU2l6ZSxcbiAgICAgIHRhZ3M6IHRoaXMudGFncyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxvZyA9IHRoaXMuY3JlYXRlTG9nKCdBbWkgTG9nJywgcmVjaXBlLm5hbWUpO1xuICAgIGNvbnN0IGluZnJhID0gdGhpcy5jcmVhdGVJbmZyYXN0cnVjdHVyZShbXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSxcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnRUMySW5zdGFuY2VQcm9maWxlRm9ySW1hZ2VCdWlsZGVyJyksXG4gICAgXSk7XG4gICAgaWYgKHRoaXMud2FpdE9uRGVwbG95KSB7XG4gICAgICB0aGlzLmNyZWF0ZUltYWdlKGluZnJhLCBkaXN0LCBsb2csIHJlY2lwZS5hcm4sIHVuZGVmaW5lZCk7XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlUGlwZWxpbmUoaW5mcmEsIGRpc3QsIGxvZywgcmVjaXBlLmFybiwgdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYm91bmRBbWkgPSB7XG4gICAgICBsYXVuY2hUZW1wbGF0ZTogbGF1bmNoVGVtcGxhdGUsXG4gICAgICBhcmNoaXRlY3R1cmU6IHRoaXMuYXJjaGl0ZWN0dXJlLFxuICAgICAgb3M6IHRoaXMub3MsXG4gICAgICBsb2dHcm91cDogbG9nLFxuICAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygndW5rbm93bicpLFxuICAgIH07XG5cbiAgICB0aGlzLmFtaUNsZWFuZXIocmVjaXBlLCBzdGFja05hbWUsIGJ1aWxkZXJOYW1lKTtcblxuICAgIHJldHVybiB0aGlzLmJvdW5kQW1pO1xuICB9XG5cbiAgcHJpdmF0ZSBhbWlDbGVhbmVyKHJlY2lwZTogQW1pUmVjaXBlLCBzdGFja05hbWU6IHN0cmluZywgYnVpbGRlck5hbWU6IHN0cmluZykge1xuICAgIC8vIHRoaXMgaXMgaGVyZSB0byBwcm92aWRlIHNhZmUgdXBncmFkZSBmcm9tIG9sZCBjZGstZ2l0aHViLXJ1bm5lcnMgdmVyc2lvbnNcbiAgICAvLyB0aGlzIGxhbWJkYSB3YXMgdXNlZCBieSBhIGN1c3RvbSByZXNvdXJjZSB0byBkZWxldGUgYWxsIGFtaXMgd2hlbiB0aGUgYnVpbGRlciB3YXMgcmVtb3ZlZFxuICAgIC8vIGlmIHdlIHJlbW92ZSB0aGUgY3VzdG9tIHJlc291cmNlLCByb2xlIGFuZCBsYW1iZGEsIGFsbCBhbWlzIHdpbGwgYmUgZGVsZXRlZCBvbiB1cGRhdGVcbiAgICAvLyBrZWVwaW5nIHRoZSBqdXN0IHJvbGUgYnV0IHJlbW92aW5nIHRoZSBwZXJtaXNzaW9ucyBhbG9uZyB3aXRoIHRoZSBjdXN0b20gcmVzb3VyY2Ugd2lsbCBtYWtlIHN1cmUgdGhhdCBkZWxldGlvbiB3aWxsIGZhaWxcbiAgICBjb25zdCBzdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcbiAgICBpZiAoc3RhY2subm9kZS50cnlGaW5kQ2hpbGQoJ2RlbGV0ZS1hbWktZGNjMDM2YzgtODc2Yi00NTFlLWEyYzEtNTUyZjllMDZlOWUxJykgPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCByb2xlID0gbmV3IGlhbS5Sb2xlKHN0YWNrLCAnZGVsZXRlLWFtaS1kY2MwMzZjOC04NzZiLTQ1MWUtYTJjMS01NTJmOWUwNmU5ZTEnLCB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnRW1wdHkgcm9sZSB0byBwcmV2ZW50IGRlbGV0aW9uIG9mIEFNSXMgb24gY2RrLWdpdGh1Yi1ydW5uZXJzIHVwZ3JhZGUnLFxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBkZW55OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnZWMyOkRlcmVnaXN0ZXJJbWFnZScsICdlYzI6RGVsZXRlU25hcHNob3QnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5ERU5ZLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGwxcm9sZTogaWFtLkNmblJvbGUgPSByb2xlLm5vZGUuZGVmYXVsdENoaWxkIGFzIGlhbS5DZm5Sb2xlO1xuICAgICAgbDFyb2xlLm92ZXJyaWRlTG9naWNhbElkKCdkZWxldGVhbWlkY2MwMzZjODg3NmI0NTFlYTJjMTU1MmY5ZTA2ZTllMVNlcnZpY2VSb2xlMUNDNThBNkYnKTtcbiAgICB9XG5cbiAgICAvLyBkZWxldGUgb2xkIHZlcnNpb24gb24gdXBkYXRlIGFuZCBvbiBzdGFjayBkZWxldGlvblxuICAgIHRoaXMuaW1hZ2VDbGVhbmVyKCdJbWFnZScsIHJlY2lwZS5uYW1lLnRvTG93ZXJDYXNlKCksIHJlY2lwZS52ZXJzaW9uKTtcblxuICAgIC8vIGRlbGV0ZSBvbGQgQU1JcyArIElCIHJlc291cmNlcyBkYWlseVxuICAgIG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuTGlmZWN5Y2xlUG9saWN5KHRoaXMsICdMaWZlY3ljbGUgUG9saWN5IEFNSScsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICBkZXNjcmlwdGlvbjogYERlbGV0ZSBvbGQgR2l0SHViIFJ1bm5lciBBTUlzIGZvciAke3RoaXMubm9kZS5wYXRofWAsXG4gICAgICBleGVjdXRpb25Sb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ0xpZmVjeWNsZSBQb2xpY3kgQU1JIFJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdpbWFnZWJ1aWxkZXIuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIGliOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsndGFnOkdldFJlc291cmNlcycsICdpbWFnZWJ1aWxkZXI6RGVsZXRlSW1hZ2UnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBJbWFnZSBCdWlsZGVyIGRvZXNuJ3Qgc3VwcG9ydCBzY29waW5nIHRoaXMgOihcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIGFtaTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2VjMjpEZXNjcmliZUltYWdlcycsICdlYzI6RGVzY3JpYmVJbWFnZUF0dHJpYnV0ZSddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydlYzI6RGVyZWdpc3RlckltYWdlJywgJ2VjMjpEZWxldGVTbmFwc2hvdCddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAgICAgICAgICdhd3M6UmVzb3VyY2VUYWcvR2l0SHViUnVubmVyczpTdGFjayc6IHN0YWNrTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgJ2F3czpSZXNvdXJjZVRhZy9HaXRIdWJSdW5uZXJzOkJ1aWxkZXInOiBidWlsZGVyTmFtZSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSkucm9sZUFybixcbiAgICAgIHBvbGljeURldGFpbHM6IFt7XG4gICAgICAgIGFjdGlvbjoge1xuICAgICAgICAgIHR5cGU6ICdERUxFVEUnLFxuICAgICAgICAgIGluY2x1ZGVSZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIGFtaXM6IHRydWUsXG4gICAgICAgICAgICBzbmFwc2hvdHM6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZmlsdGVyOiB7XG4gICAgICAgICAgdHlwZTogJ0NPVU5UJyxcbiAgICAgICAgICB2YWx1ZTogMixcbiAgICAgICAgfSxcbiAgICAgIH1dLFxuICAgICAgcmVzb3VyY2VUeXBlOiAnQU1JX0lNQUdFJyxcbiAgICAgIHJlc291cmNlU2VsZWN0aW9uOiB7XG4gICAgICAgIHJlY2lwZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiByZWNpcGUubmFtZSxcbiAgICAgICAgICAgIHNlbWFudGljVmVyc2lvbjogJzEueC54JyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYmluZENvbXBvbmVudHMoKTogSW1hZ2VCdWlsZGVyQ29tcG9uZW50W10ge1xuICAgIGlmICh0aGlzLmJvdW5kQ29tcG9uZW50cy5sZW5ndGggPT0gMCkge1xuICAgICAgdGhpcy5ib3VuZENvbXBvbmVudHMucHVzaCguLi50aGlzLmNvbXBvbmVudHMubWFwKGMgPT4gYy5fYXNBd3NJbWFnZUJ1aWxkZXJDb21wb25lbnQodGhpcywgdGhpcy5vcywgdGhpcy5hcmNoaXRlY3R1cmUpKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYm91bmRDb21wb25lbnRzO1xuICB9XG5cbiAgcHJpdmF0ZSBpbWFnZUNsZWFuZXIodHlwZTogJ0NvbnRhaW5lcicgfCAnSW1hZ2UnLCByZWNpcGVOYW1lOiBzdHJpbmcsIHZlcnNpb246IHN0cmluZykge1xuICAgIGNvbnN0IGNsZWFuZXJGdW5jdGlvbiA9IHNpbmdsZXRvbkxhbWJkYShEZWxldGVSZXNvdXJjZXNGdW5jdGlvbiwgdGhpcywgJ2F3cy1pbWFnZS1idWlsZGVyLWRlbGV0ZS1yZXNvdXJjZXMnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbSByZXNvdXJjZSBoYW5kbGVyIHRoYXQgZGVsZXRlcyByZXNvdXJjZXMgb2Ygb2xkIHZlcnNpb25zIG9mIEVDMiBJbWFnZSBCdWlsZGVyIGltYWdlcycsXG4gICAgICBpbml0aWFsUG9saWN5OiBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAnaW1hZ2VidWlsZGVyOkxpc3RJbWFnZUJ1aWxkVmVyc2lvbnMnLFxuICAgICAgICAgICAgJ2ltYWdlYnVpbGRlcjpEZWxldGVJbWFnZScsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFsnZWMyOkRlc2NyaWJlSW1hZ2VzJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgfSksXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbJ2VjMjpEZXJlZ2lzdGVySW1hZ2UnLCAnZWMyOkRlbGV0ZVNuYXBzaG90J10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICAgJ2F3czpSZXNvdXJjZVRhZy9HaXRIdWJSdW5uZXJzOlN0YWNrJzogY2RrLlN0YWNrLm9mKHRoaXMpLnN0YWNrTmFtZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbJ2VjcjpCYXRjaERlbGV0ZUltYWdlJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuUlVOTkVSX0lNQUdFX0JVSUxEKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksXG4gICAgfSk7XG5cbiAgICBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgYCR7dHlwZX0gQ2xlYW5lcmAsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogY2xlYW5lckZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgcmVzb3VyY2VUeXBlOiAnQ3VzdG9tOjpJbWFnZUJ1aWxkZXItRGVsZXRlLVJlc291cmNlcycsXG4gICAgICBwcm9wZXJ0aWVzOiA8RGVsZXRlUmVzb3VyY2VzUHJvcHM+e1xuICAgICAgICBJbWFnZVZlcnNpb25Bcm46IGNkay5TdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICAgIHNlcnZpY2U6ICdpbWFnZWJ1aWxkZXInLFxuICAgICAgICAgIHJlc291cmNlOiAnaW1hZ2UnLFxuICAgICAgICAgIHJlc291cmNlTmFtZTogYCR7cmVjaXBlTmFtZX0vJHt2ZXJzaW9ufWAsXG4gICAgICAgICAgYXJuRm9ybWF0OiBjZGsuQXJuRm9ybWF0LlNMQVNIX1JFU09VUkNFX05BTUUsXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY2xhc3MgQXdzSW1hZ2VCdWlsZGVyRmFpbGVkQnVpbGROb3RpZmllciBpbXBsZW1lbnRzIGNkay5JQXNwZWN0IHtcbiAgcHVibGljIHN0YXRpYyBjcmVhdGVGaWx0ZXJpbmdUb3BpYyhzY29wZTogQ29uc3RydWN0LCB0YXJnZXRUb3BpYzogc25zLlRvcGljKTogc25zLklUb3BpYyB7XG4gICAgY29uc3QgdG9waWMgPSBuZXcgc25zLlRvcGljKHNjb3BlLCAnSW1hZ2UgQnVpbGRlciBCdWlsZHMnKTtcbiAgICBjb25zdCBmaWx0ZXIgPSBuZXcgRmlsdGVyRmFpbGVkQnVpbGRzRnVuY3Rpb24oc2NvcGUsICdJbWFnZSBCdWlsZGVyIEJ1aWxkcyBGaWx0ZXInLCB7XG4gICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAoc2NvcGUsIFNpbmdsZXRvbkxvZ1R5cGUuUlVOTkVSX0lNQUdFX0JVSUxEKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBUQVJHRVRfVE9QSUNfQVJOOiB0YXJnZXRUb3BpYy50b3BpY0FybixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0b3BpYy5hZGRTdWJzY3JpcHRpb24obmV3IHN1YnMuTGFtYmRhU3Vic2NyaXB0aW9uKGZpbHRlcikpO1xuICAgIHRhcmdldFRvcGljLmdyYW50UHVibGlzaChmaWx0ZXIpO1xuXG4gICAgcmV0dXJuIHRvcGljO1xuICB9XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSB0b3BpYzogc25zLklUb3BpYykge1xuICB9XG5cbiAgcHVibGljIHZpc2l0KG5vZGU6IElDb25zdHJ1Y3QpOiB2b2lkIHtcbiAgICBpZiAobm9kZSBpbnN0YW5jZW9mIEF3c0ltYWdlQnVpbGRlclJ1bm5lckltYWdlQnVpbGRlcikge1xuICAgICAgY29uc3QgYnVpbGRlciA9IG5vZGUgYXMgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyO1xuICAgICAgY29uc3QgaW5mcmFOb2RlID0gYnVpbGRlci5ub2RlLnRyeUZpbmRDaGlsZCgnSW5mcmFzdHJ1Y3R1cmUnKTtcbiAgICAgIGlmIChpbmZyYU5vZGUpIHtcbiAgICAgICAgY29uc3QgaW5mcmEgPSBpbmZyYU5vZGUgYXMgaW1hZ2VidWlsZGVyLkNmbkluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbjtcbiAgICAgICAgaW5mcmEuc25zVG9waWNBcm4gPSB0aGlzLnRvcGljLnRvcGljQXJuO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2RrLkFubm90YXRpb25zLm9mKGJ1aWxkZXIpLmFkZFdhcm5pbmcoJ1VudXNlZCBidWlsZGVyIGNhbm5vdCBnZXQgbm90aWZpY2F0aW9ucyBvZiBmYWlsZWQgYnVpbGRzJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iXX0=