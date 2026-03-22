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
            steps.push({
                name: 'Download',
                action: 'S3Download',
                inputs,
            });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGRlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9hd3MtaW1hZ2UtYnVpbGRlci9idWlsZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsbUNBQW1DO0FBQ25DLDZDQWdCcUI7QUFDckIsaURBQW9EO0FBQ3BELG1EQUFxRDtBQUVyRCwrQkFBa0Q7QUFDbEQsNkNBQTZEO0FBQzdELDJDQUFzRTtBQUN0RSwyRUFBc0U7QUFFdEUsbUZBQTZFO0FBQzdFLHlDQUFvRjtBQUNwRiwrQ0FBMEY7QUFDMUYsdUNBQW1GO0FBQ25GLGtFQUE2RDtBQUM3RCxzQ0FBb0c7QUFvSHBHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FrQkc7QUFDSCxNQUFhLHFCQUFzQixTQUFRLEdBQUcsQ0FBQyxRQUFRO0lBYXJELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0M7UUFDOUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUhGLFdBQU0sR0FBc0IsRUFBRSxDQUFDO1FBSzlDLElBQUksQ0FBQyxRQUFRLEdBQUcsS0FBSyxDQUFDLFFBQVEsQ0FBQztRQUUvQixJQUFJLEtBQUssR0FBVSxFQUFFLENBQUM7UUFFdEIsSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDakIsSUFBSSxNQUFNLEdBQVUsRUFBRSxDQUFDO1lBQ3ZCLElBQUksZUFBZSxHQUFhLEVBQUUsQ0FBQztZQUNuQyxLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDakMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUU5QixJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7b0JBQ3ZCLE1BQU0sQ0FBQyxJQUFJLENBQUM7d0JBQ1YsTUFBTSxFQUFFLEtBQUssQ0FBQyxLQUFLLENBQUMs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QUFDO1lBQzFDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixHQUFHLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxVQUFVLENBQUMsMERBQTBELENBQUMsQ0FBQztZQUNyRyxDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7Q0FDRjtBQWhDRCxnRkFnQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHtcbiAgQW5ub3RhdGlvbnMsXG4gIGF3c19lYzIgYXMgZWMyLFxuICBhd3NfZWNyIGFzIGVjcixcbiAgYXdzX2V2ZW50cyBhcyBldmVudHMsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfaW1hZ2VidWlsZGVyIGFzIGltYWdlYnVpbGRlcixcbiAgYXdzX2xhbWJkYSBhcyBsYW1iZGEsXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zM19hc3NldHMgYXMgczNfYXNzZXRzLFxuICBhd3Nfc25zIGFzIHNucyxcbiAgYXdzX3Nuc19zdWJzY3JpcHRpb25zIGFzIHN1YnMsXG4gIEN1c3RvbVJlc291cmNlLFxuICBEdXJhdGlvbixcbiAgUmVtb3ZhbFBvbGljeSxcbiAgU3RhY2ssXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRhZ011dGFiaWxpdHkgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QsIElDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEFtaVJlY2lwZSwgZGVmYXVsdEJhc2VBbWkgfSBmcm9tICcuL2FtaSc7XG5pbXBvcnQgeyBCYXNlQ29udGFpbmVySW1hZ2UsIEJhc2VJbWFnZSB9IGZyb20gJy4vYmFzZS1pbWFnZSc7XG5pbXBvcnQgeyBDb250YWluZXJSZWNpcGUsIGRlZmF1bHRCYXNlRG9ja2VySW1hZ2UgfSBmcm9tICcuL2NvbnRhaW5lcic7XG5pbXBvcnQgeyBEZWxldGVSZXNvdXJjZXNGdW5jdGlvbiB9IGZyb20gJy4vZGVsZXRlLXJlc291cmNlcy1mdW5jdGlvbic7XG5pbXBvcnQgeyBEZWxldGVSZXNvdXJjZXNQcm9wcyB9IGZyb20gJy4vZGVsZXRlLXJlc291cmNlcy5sYW1iZGEnO1xuaW1wb3J0IHsgRmlsdGVyRmFpbGVkQnVpbGRzRnVuY3Rpb24gfSBmcm9tICcuL2ZpbHRlci1mYWlsZWQtYnVpbGRzLWZ1bmN0aW9uJztcbmltcG9ydCB7IGdlbmVyYXRlQnVpbGRXb3JrZmxvd1dpdGhEb2NrZXJTZXR1cENvbW1hbmRzLCBXb3JrZmxvdyB9IGZyb20gJy4vd29ya2Zsb3cnO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBPcywgUnVubmVyQW1pLCBSdW5uZXJJbWFnZSwgUnVubmVyVmVyc2lvbiB9IGZyb20gJy4uLy4uL3Byb3ZpZGVycyc7XG5pbXBvcnQgeyBzaW5nbGV0b25Mb2dHcm91cCwgc2luZ2xldG9uTGFtYmRhLCBTaW5nbGV0b25Mb2dUeXBlIH0gZnJvbSAnLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQnVpbGRJbWFnZUZ1bmN0aW9uIH0gZnJvbSAnLi4vYnVpbGQtaW1hZ2UtZnVuY3Rpb24nO1xuaW1wb3J0IHsgUnVubmVySW1hZ2VCdWlsZGVyQmFzZSwgUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMsIHVuaXF1ZUltYWdlQnVpbGRlck5hbWUgfSBmcm9tICcuLi9jb21tb24nO1xuXG5leHBvcnQgaW50ZXJmYWNlIEF3c0ltYWdlQnVpbGRlclJ1bm5lckltYWdlQnVpbGRlclByb3BzIHtcbiAgLyoqXG4gICAqIFRoZSBpbnN0YW5jZSB0eXBlIHVzZWQgdG8gYnVpbGQgdGhlIGltYWdlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBtNmkubGFyZ2VcbiAgICovXG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZT86IGVjMi5JbnN0YW5jZVR5cGU7XG5cbiAgLyoqXG4gICAqIFNpemUgb2Ygdm9sdW1lIGF2YWlsYWJsZSBmb3IgYnVpbGRlciBpbnN0YW5jZXMuIFRoaXMgbW9kaWZpZXMgdGhlIGJvb3Qgdm9sdW1lIHNpemUgYW5kIGRvZXNuJ3QgYWRkIGFueSBhZGRpdGlvbmFsIHZvbHVtZXMuXG4gICAqXG4gICAqIFVzZSB0aGlzIGlmIHlvdSdyZSBidWlsZGluZyBpbWFnZXMgd2l0aCBiaWcgY29tcG9uZW50cyBhbmQgbmVlZCBtb3JlIHNwYWNlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IHNpemUgZm9yIEFNSSAodXN1YWxseSAzMEdCIGZvciBMaW51eCBhbmQgNTBHQiBmb3IgV2luZG93cylcbiAgICovXG4gIHJlYWRvbmx5IHN0b3JhZ2VTaXplPzogY2RrLlNpemU7XG5cbiAgLyoqXG4gICAqIE9wdGlvbnMgZm9yIGZhc3QgbGF1bmNoLlxuICAgKlxuICAgKiBUaGlzIGlzIG9ubHkgc3VwcG9ydGVkIGZvciBXaW5kb3dzIEFNSXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IGRpc2FibGVkXG4gICAqL1xuICByZWFkb25seSBmYXN0TGF1bmNoT3B0aW9ucz86IEZhc3RMYXVuY2hPcHRpb25zO1xufVxuXG4vKipcbiAqIE9wdGlvbnMgZm9yIGZhc3QgbGF1bmNoLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEZhc3RMYXVuY2hPcHRpb25zIHtcbiAgLyoqXG4gICAqIEVuYWJsZSBmYXN0IGxhdW5jaCBmb3IgQU1JcyBnZW5lcmF0ZWQgYnkgdGhpcyBidWlsZGVyLiBJdCBjcmVhdGVzIGEgc25hcHNob3Qgb2YgdGhlIHJvb3Qgdm9sdW1lIGFuZCB1c2VzIGl0IHRvIGxhdW5jaCBuZXcgaW5zdGFuY2VzIGZhc3Rlci5cbiAgICpcbiAgICogVGhpcyBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgV2luZG93cyBBTUlzLlxuICAgKlxuICAgKiBAbm90ZSB0aGlzIGZlYXR1cmUgY29tZXMgd2l0aCBhZGRpdGlvbmFsIHJlc291cmNlIGNvc3RzLiBTZWUgdGhlIGRvY3VtZW50YXRpb24gZm9yIG1vcmUgZGV0YWlscy4gaHR0cHM6Ly9kb2NzLmF3cy5hbWF6b24uY29tL0FXU0VDMi9sYXRlc3QvV2luZG93c0d1aWRlL3dpbi1mYXN0LWxhdW5jaC1tYW5hZ2UtY29zdHMuaHRtbFxuICAgKiBAbm90ZSBlbmFibGluZyBmYXN0IGxhdW5jaCBvbiBhbiBleGlzdGluZyBidWlsZGVyIHdpbGwgbm90IGVuYWJsZSBpdCBmb3IgZXhpc3RpbmcgQU1Jcy4gSXQgd2lsbCBvbmx5IGFmZmVjdCBuZXcgQU1Jcy4gSWYgeW91IHdhbnQgaW1tZWRpYXRlIGVmZmVjdCwgdHJpZ2dlciBhIG5ldyBpbWFnZSBidWlsZC4gQWx0ZXJuYXRpdmVseSwgeW91IGNhbiBjcmVhdGUgYSBuZXcgYnVpbGRlciB3aXRoIGZhc3QgbGF1bmNoIGVuYWJsZWQgYW5kIHVzZSBpdCBmb3IgbmV3IEFNSXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBlbmFibGVkPzogYm9vbGVhbjtcblxuICAvKipcbiAgICogVGhlIG1heGltdW0gbnVtYmVyIG9mIHBhcmFsbGVsIGluc3RhbmNlcyB0aGF0IGFyZSBsYXVuY2hlZCBmb3IgY3JlYXRpbmcgcmVzb3VyY2VzLlxuICAgKlxuICAgKiBNdXN0IGJlIGF0IGxlYXN0IDYuXG4gICAqXG4gICAqIEBkZWZhdWx0IDZcbiAgICovXG4gIHJlYWRvbmx5IG1heFBhcmFsbGVsTGF1bmNoZXM/OiBudW1iZXI7XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgcHJlLXByb3Zpc2lvbmVkIHNuYXBzaG90cyB0byBrZWVwIG9uIGhhbmQgZm9yIGEgZmFzdC1sYXVuY2ggZW5hYmxlZCBXaW5kb3dzIEFNSS5cbiAgICpcbiAgICogQGRlZmF1bHQgMVxuICAgKi9cbiAgcmVhZG9ubHkgdGFyZ2V0UmVzb3VyY2VDb3VudD86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBBbiBhc3NldCBpbmNsdWRpbmcgZmlsZSBvciBkaXJlY3RvcnkgdG8gcGxhY2UgaW5zaWRlIHRoZSBidWlsdCBpbWFnZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJbWFnZUJ1aWxkZXJBc3NldCB7XG4gIC8qKlxuICAgKiBQYXRoIHRvIHBsYWNlIGFzc2V0IGluIHRoZSBpbWFnZS5cbiAgICovXG4gIHJlYWRvbmx5IHBhdGg6IHN0cmluZztcblxuICAvKipcbiAgICogQXNzZXQgdG8gcGxhY2UgaW4gdGhlIGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgYXNzZXQ6IHMzX2Fzc2V0cy5Bc3NldDtcbn1cblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBJbWFnZUJ1aWxkZXJDb21wb25lbnQgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlQnVpbGRlckNvbXBvbmVudFByb3BlcnRpZXMge1xuICAvKipcbiAgICogQ29tcG9uZW50IHBsYXRmb3JtLiBNdXN0IG1hdGNoIHRoZSBidWlsZGVyIHBsYXRmb3JtLlxuICAgKi9cbiAgcmVhZG9ubHkgcGxhdGZvcm06ICdMaW51eCcgfCAnV2luZG93cyc7XG5cbiAgLyoqXG4gICAqIENvbXBvbmVudCBkaXNwbGF5IG5hbWUuXG4gICAqL1xuICByZWFkb25seSBkaXNwbGF5TmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBDb21wb25lbnQgZGVzY3JpcHRpb24uXG4gICAqL1xuICByZWFkb25seSBkZXNjcmlwdGlvbjogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBTaGVsbCBjb21tYW5kcyB0byBydW4gd2hlbiBhZGRpbmcgdGhpcyBjb21wb25lbnQgdG8gdGhlIGltYWdlLlxuICAgKlxuICAgKiBPbiBMaW51eCwgdGhlc2UgYXJlIGJhc2ggY29tbWFuZHMuIE9uIFdpbmRvd3MsIHRoZXJlIGFyZSBQb3dlclNoZWxsIGNvbW1hbmRzLlxuICAgKi9cbiAgcmVhZG9ubHkgY29tbWFuZHM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBPcHRpb25hbCBhc3NldHMgdG8gYWRkIHRvIHRoZSBidWlsdCBpbWFnZS5cbiAgICovXG4gIHJlYWRvbmx5IGFzc2V0cz86IEltYWdlQnVpbGRlckFzc2V0W107XG5cbiAgLyoqXG4gICAqIFJlcXVpcmUgYSByZWJvb3QgYWZ0ZXIgaW5zdGFsbGluZyB0aGlzIGNvbXBvbmVudC5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IHJlYm9vdD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogQ29tcG9uZW50cyBhcmUgYSBzZXQgb2YgY29tbWFuZHMgdG8gcnVuIGFuZCBvcHRpb25hbCBmaWxlcyB0byBhZGQgdG8gYW4gaW1hZ2UuIENvbXBvbmVudHMgYXJlIHRoZSBidWlsZGluZyBibG9ja3Mgb2YgaW1hZ2VzIGJ1aWx0IGJ5IEltYWdlIEJ1aWxkZXIuXG4gKlxuICogRXhhbXBsZTpcbiAqXG4gKiBgYGBcbiAqIG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQodGhpcywgJ0FXUyBDTEknLCB7XG4gKiAgIHBsYXRmb3JtOiAnV2luZG93cycsXG4gKiAgIGRpc3BsYXlOYW1lOiAnQVdTIENMSScsXG4gKiAgIGRlc2NyaXB0aW9uOiAnSW5zdGFsbCBsYXRlc3QgdmVyc2lvbiBvZiBBV1MgQ0xJJyxcbiAqICAgY29tbWFuZHM6IFtcbiAqICAgICAnJHAgPSBTdGFydC1Qcm9jZXNzIG1zaWV4ZWMuZXhlIC1QYXNzVGhydSAtV2FpdCAtQXJndW1lbnRMaXN0IFxcJy9pIGh0dHBzOi8vYXdzY2xpLmFtYXpvbmF3cy5jb20vQVdTQ0xJVjIubXNpIC9xblxcJycsXG4gKiAgICAgJ2lmICgkcC5FeGl0Q29kZSAtbmUgMCkgeyB0aHJvdyBcIkV4aXQgY29kZSBpcyAkcC5FeGl0Q29kZVwiIH0nLFxuICogICBdLFxuICogfVxuICogYGBgXG4gKlxuICogQGRlcHJlY2F0ZWQgVXNlIGBSdW5uZXJJbWFnZUNvbXBvbmVudGAgaW5zdGVhZCBhcyB0aGlzIGJlIGludGVybmFsIHNvb24uXG4gKi9cbmV4cG9ydCBjbGFzcyBJbWFnZUJ1aWxkZXJDb21wb25lbnQgZXh0ZW5kcyBjZGsuUmVzb3VyY2Uge1xuICAvKipcbiAgICogQ29tcG9uZW50IEFSTi5cbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBhcm46IHN0cmluZztcblxuICAvKipcbiAgICogU3VwcG9ydGVkIHBsYXRmb3JtIGZvciB0aGUgY29tcG9uZW50LlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IHBsYXRmb3JtOiAnV2luZG93cycgfCAnTGludXgnO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgYXNzZXRzOiBzM19hc3NldHMuQXNzZXRbXSA9IFtdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBJbWFnZUJ1aWxkZXJDb21wb25lbnRQcm9wZXJ0aWVzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIHRoaXMucGxhdGZvcm0gPSBwcm9wcy5wbGF0Zm9ybTtcblxuICAgIGxldCBzdGVwczogYW55W10gPSBbXTtcblxuICAgIGlmIChwcm9wcy5hc3NldHMpIHtcbiAgICAgIGxldCBpbnB1dHM6IGFueVtdID0gW107XG4gICAgICBsZXQgZXh0cmFjdENvbW1hbmRzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgZm9yIChjb25zdCBhc3NldCBvZiBwcm9wcy5hc3NldHMpIHtcbiAgICAgICAgdGhpcy5hc3NldHMucHVzaChhc3NldC5hc3NldCk7XG5cbiAgICAgICAgaWYgKGFzc2V0LmFzc2V0LmlzRmlsZSkge1xuICAgICAgICAgIGlucHV0cy5wdXNoKHtcbiAgICAgICAgICAgIHNvdXJjZTogYXNzZXQuYXNzZXQuczNPYmplY3RVcmwsXG4gICAgICAgICAgICBkZXN0aW5hdGlvbjogYXNzZXQucGF0aCxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIGlmIChhc3NldC5hc3NldC5pc1ppcEFyY2hpdmUpIHtcbiAgICAgICAgICBpbnB1dHMucHVzaCh7XG4gICAgICAgICAgICBzb3VyY2U6IGFzc2V0LmFzc2V0LnMzT2JqZWN0VXJsLFxuICAgICAgICAgICAgZGVzdGluYXRpb246IGAke2Fzc2V0LnBhdGh9LnppcGAsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgaWYgKHByb3BzLnBsYXRmb3JtID09PSAnV2luZG93cycpIHtcbiAgICAgICAgICAgIGV4dHJhY3RDb21tYW5kcy5wdXNoKGBFeHBhbmQtQXJjaGl2ZSBcIiR7YXNzZXQucGF0aH0uemlwXCIgLURlc3RpbmF0aW9uUGF0aCBcIiR7YXNzZXQucGF0aH1cImApO1xuICAgICAgICAgICAgZXh0cmFjdENvbW1hbmRzLnB1c2goYGRlbCBcIiR7YXNzZXQucGF0aH0uemlwXCJgKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZXh0cmFjdENvbW1hbmRzLnB1c2goYHVuemlwIFwiJHthc3NldC5wYXRofS56aXBcIiAtZCBcIiR7YXNzZXQucGF0aH1cImApO1xuICAgICAgICAgICAgZXh0cmFjdENvbW1hbmRzLnB1c2goYHJtIFwiJHthc3NldC5wYXRofS56aXBcImApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYXNzZXQgdHlwZTogJHthc3NldC5hc3NldH1gKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBzdGVwcy5wdXNoKHtcbiAgICAgICAgbmFtZTogJ0Rvd25sb2FkJyxcbiAgICAgICAgYWN0aW9uOiAnUzNEb3dubG9hZCcsXG4gICAgICAgIGlucHV0cyxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoZXh0cmFjdENvbW1hbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgc3RlcHMucHVzaCh7XG4gICAgICAgICAgbmFtZTogJ0V4dHJhY3QnLFxuICAgICAgICAgIGFjdGlvbjogcHJvcHMucGxhdGZvcm0gPT09ICdMaW51eCcgPyAnRXhlY3V0ZUJhc2gnIDogJ0V4ZWN1dGVQb3dlclNoZWxsJyxcbiAgICAgICAgICBpbnB1dHM6IHtcbiAgICAgICAgICAgIGNvbW1hbmRzOiB0aGlzLnByZWZpeENvbW1hbmRzV2l0aEVycm9ySGFuZGxpbmcocHJvcHMucGxhdGZvcm0sIGV4dHJhY3RDb21tYW5kcyksXG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHByb3BzLmNvbW1hbmRzLmxlbmd0aCA+IDApIHtcbiAgICAgIHN0ZXBzLnB1c2goe1xuICAgICAgICBuYW1lOiAnUnVuJyxcbiAgICAgICAgYWN0aW9uOiBwcm9wcy5wbGF0Zm9ybSA9PT0gJ0xpbnV4JyA/ICdFeGVjdXRlQmFzaCcgOiAnRXhlY3V0ZVBvd2VyU2hlbGwnLFxuICAgICAgICBpbnB1dHM6IHtcbiAgICAgICAgICBjb21tYW5kczogdGhpcy5wcmVmaXhDb21tYW5kc1dpdGhFcnJvckhhbmRsaW5nKHByb3BzLnBsYXRmb3JtLCBwcm9wcy5jb21tYW5kcyksXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHMucmVib290ID8/IGZhbHNlKSB7XG4gICAgICBzdGVwcy5wdXNoKHtcbiAgICAgICAgbmFtZTogJ1JlYm9vdCcsXG4gICAgICAgIGFjdGlvbjogJ1JlYm9vdCcsXG4gICAgICAgIGlucHV0czoge30sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBkYXRhID0ge1xuICAgICAgbmFtZTogcHJvcHMuZGlzcGxheU5hbWUsXG4gICAgICBzY2hlbWFWZXJzaW9uOiAnMS4wJyxcbiAgICAgIHBoYXNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ2J1aWxkJyxcbiAgICAgICAgICBzdGVwcyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfTtcblxuICAgIGNvbnN0IG5hbWUgPSB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpO1xuICAgIGNvbnN0IGNvbXBvbmVudCA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuQ29tcG9uZW50KHRoaXMsICdDb21wb25lbnQnLCB7XG4gICAgICBuYW1lOiBuYW1lLFxuICAgICAgZGVzY3JpcHRpb246IHByb3BzLmRlc2NyaXB0aW9uLFxuICAgICAgcGxhdGZvcm06IHByb3BzLnBsYXRmb3JtLFxuICAgICAgdmVyc2lvbjogJzEuMC4wJyxcbiAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KGRhdGEpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hcm4gPSBjb21wb25lbnQuYXR0ckFybjtcbiAgfVxuXG4gIC8qKlxuICAgKiBHcmFudHMgcmVhZCBwZXJtaXNzaW9ucyB0byB0aGUgcHJpbmNpcGFsIG9uIHRoZSBhc3NldHMgYnVja2V0cy5cbiAgICpcbiAgICogQHBhcmFtIGdyYW50ZWVcbiAgICovXG4gIGdyYW50QXNzZXRzUmVhZChncmFudGVlOiBpYW0uSUdyYW50YWJsZSkge1xuICAgIGZvciAoY29uc3QgYXNzZXQgb2YgdGhpcy5hc3NldHMpIHtcbiAgICAgIGFzc2V0LmdyYW50UmVhZChncmFudGVlKTtcbiAgICB9XG4gIH1cblxuICBwcmVmaXhDb21tYW5kc1dpdGhFcnJvckhhbmRsaW5nKHBsYXRmb3JtOiAnV2luZG93cycgfCAnTGludXgnLCBjb21tYW5kczogc3RyaW5nW10pIHtcbiAgICBpZiAocGxhdGZvcm0gPT0gJ1dpbmRvd3MnKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICAnJEVycm9yQWN0aW9uUHJlZmVyZW5jZSA9IFxcJ1N0b3BcXCcnLFxuICAgICAgICAnJFByb2dyZXNzUHJlZmVyZW5jZSA9IFxcJ1NpbGVudGx5Q29udGludWVcXCcnLFxuICAgICAgICAnU2V0LVBTRGVidWcgLVRyYWNlIDEnLFxuICAgICAgXS5jb25jYXQoY29tbWFuZHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICAnc2V0IC1leCcsXG4gICAgICBdLmNvbmNhdChjb21tYW5kcyk7XG4gICAgfVxuICB9XG59XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjbGFzcyBBd3NJbWFnZUJ1aWxkZXJSdW5uZXJJbWFnZUJ1aWxkZXIgZXh0ZW5kcyBSdW5uZXJJbWFnZUJ1aWxkZXJCYXNlIHtcbiAgcHJpdmF0ZSBib3VuZERvY2tlckltYWdlPzogUnVubmVySW1hZ2U7XG4gIHByaXZhdGUgYm91bmRBbWk/OiBSdW5uZXJBbWk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3M6IE9zO1xuICBwcml2YXRlIHJlYWRvbmx5IGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlO1xuICBwcml2YXRlIHJlYWRvbmx5IGJhc2VJbWFnZTogQmFzZUNvbnRhaW5lckltYWdlO1xuICBwcml2YXRlIHJlYWRvbmx5IGJhc2VBbWk6IEJhc2VJbWFnZTtcbiAgcHJpdmF0ZSByZWFkb25seSBsb2dSZXRlbnRpb246IFJldGVudGlvbkRheXM7XG4gIHByaXZhdGUgcmVhZG9ubHkgbG9nUmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeTtcbiAgcHJpdmF0ZSByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdWJuZXRTZWxlY3Rpb246IGVjMi5TdWJuZXRTZWxlY3Rpb24gfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVidWlsZEludGVydmFsOiBjZGsuRHVyYXRpb247XG4gIHByaXZhdGUgcmVhZG9ubHkgYm91bmRDb21wb25lbnRzOiBJbWFnZUJ1aWxkZXJDb21wb25lbnRbXSA9IFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZTtcbiAgcHJpdmF0ZSBpbmZyYXN0cnVjdHVyZTogaW1hZ2VidWlsZGVyLkNmbkluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbiB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSByZWFkb25seSByb2xlOiBpYW0uUm9sZTtcbiAgcHJpdmF0ZSByZWFkb25seSBmYXN0TGF1bmNoT3B0aW9ucz86IEZhc3RMYXVuY2hPcHRpb25zO1xuICBwdWJsaWMgcmVhZG9ubHkgc3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcbiAgcHJpdmF0ZSByZWFkb25seSB3YWl0T25EZXBsb3k6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgZG9ja2VyU2V0dXBDb21tYW5kczogc3RyaW5nW107XG4gIHByaXZhdGUgcmVhZG9ubHkgdGFnczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgcHJpdmF0ZSByZWFkb25seSBjb250YWluZXJXb3JrZmxvdz86IFdvcmtmbG93O1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbnRhaW5lcldvcmtmbG93RXhlY3V0aW9uUm9sZT86IGlhbS5JUm9sZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJ1bm5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBpZiAocHJvcHM/LmNvZGVCdWlsZE9wdGlvbnMpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ2NvZGVCdWlsZE9wdGlvbnMgYXJlIGlnbm9yZWQgd2hlbiB1c2luZyBBV1MgSW1hZ2UgQnVpbGRlciB0byBidWlsZCBydW5uZXIgaW1hZ2VzLicpO1xuICAgIH1cblxuICAgIHRoaXMub3MgPSBwcm9wcz8ub3MgPz8gT3MuTElOVVhfVUJVTlRVO1xuICAgIHRoaXMuYXJjaGl0ZWN0dXJlID0gcHJvcHM/LmFyY2hpdGVjdHVyZSA/PyBBcmNoaXRlY3R1cmUuWDg2XzY0O1xuICAgIHRoaXMucmVidWlsZEludGVydmFsID0gcHJvcHM/LnJlYnVpbGRJbnRlcnZhbCA/PyBEdXJhdGlvbi5kYXlzKDcpO1xuICAgIHRoaXMubG9nUmV0ZW50aW9uID0gcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USDtcbiAgICB0aGlzLmxvZ1JlbW92YWxQb2xpY3kgPSBwcm9wcz8ubG9nUmVtb3ZhbFBvbGljeSA/PyBSZW1vdmFsUG9saWN5LkRFU1RST1k7XG4gICAgdGhpcy52cGMgPSBwcm9wcz8udnBjID8/IGVjMi5WcGMuZnJvbUxvb2t1cCh0aGlzLCAnVlBDJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwcyA/PyBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdTRycsIHsgdnBjOiB0aGlzLnZwYyB9KV07XG4gICAgdGhpcy5zdWJuZXRTZWxlY3Rpb24gPSBwcm9wcz8uc3VibmV0U2VsZWN0aW9uO1xuICAgIHRoaXMuaW5zdGFuY2VUeXBlID0gcHJvcHM/LmF3c0ltYWdlQnVpbGRlck9wdGlvbnM/Lmluc3RhbmNlVHlwZSA/PyBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLk02SSwgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSk7XG4gICAgdGhpcy5mYXN0TGF1bmNoT3B0aW9ucyA9IHByb3BzPy5hd3NJbWFnZUJ1aWxkZXJPcHRpb25zPy5mYXN0TGF1bmNoT3B0aW9ucztcbiAgICB0aGlzLnN0b3JhZ2VTaXplID0gcHJvcHM/LmF3c0ltYWdlQnVpbGRlck9wdGlvbnM/LnN0b3JhZ2VTaXplO1xuICAgIHRoaXMud2FpdE9uRGVwbG95ID0gcHJvcHM/LndhaXRPbkRlcGxveSA/PyB0cnVlO1xuICAgIHRoaXMuZG9ja2VyU2V0dXBDb21tYW5kcyA9IHByb3BzPy5kb2NrZXJTZXR1cENvbW1hbmRzID8/IFtdO1xuXG4gICAgLy8gbm9ybWFsaXplIEJhc2VDb250YWluZXJJbWFnZUlucHV0IHRvIEJhc2VDb250YWluZXJJbWFnZSAoc3RyaW5nIHN1cHBvcnQgaXMgZGVwcmVjYXRlZCwgb25seSBhdCBwdWJsaWMgQVBJIGxldmVsKVxuICAgIGNvbnN0IGJhc2VEb2NrZXJJbWFnZUlucHV0ID0gcHJvcHM/LmJhc2VEb2NrZXJJbWFnZSA/PyBkZWZhdWx0QmFzZURvY2tlckltYWdlKHRoaXMub3MpO1xuICAgIHRoaXMuYmFzZUltYWdlID0gdHlwZW9mIGJhc2VEb2NrZXJJbWFnZUlucHV0ID09PSAnc3RyaW5nJyA/IEJhc2VDb250YWluZXJJbWFnZS5mcm9tU3RyaW5nKGJhc2VEb2NrZXJJbWFnZUlucHV0KSA6IGJhc2VEb2NrZXJJbWFnZUlucHV0O1xuXG4gICAgLy8gbm9ybWFsaXplIEJhc2VJbWFnZUlucHV0IHRvIEJhc2VJbWFnZSAoc3RyaW5nIHN1cHBvcnQgaXMgZGVwcmVjYXRlZCwgb25seSBhdCBwdWJsaWMgQVBJIGxldmVsKVxuICAgIGNvbnN0IGJhc2VBbWlJbnB1dCA9IHByb3BzPy5iYXNlQW1pID8/IGRlZmF1bHRCYXNlQW1pKHRoaXMsIHRoaXMub3MsIHRoaXMuYXJjaGl0ZWN0dXJlKTtcbiAgICB0aGlzLmJhc2VBbWkgPSB0eXBlb2YgYmFzZUFtaUlucHV0ID09PSAnc3RyaW5nJyA/IEJhc2VJbWFnZS5mcm9tU3RyaW5nKGJhc2VBbWlJbnB1dCkgOiBiYXNlQW1pSW5wdXQ7XG5cbiAgICAvLyB3YXJuIGlmIHVzaW5nIGRlcHJlY2F0ZWQgc3RyaW5nIGZvcm1hdFxuICAgIGlmIChwcm9wcz8uYmFzZURvY2tlckltYWdlICYmIHR5cGVvZiBwcm9wcy5iYXNlRG9ja2VySW1hZ2UgPT09ICdzdHJpbmcnKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKFxuICAgICAgICAnUGFzc2luZyBiYXNlRG9ja2VySW1hZ2UgYXMgYSBzdHJpbmcgaXMgZGVwcmVjYXRlZC4gUGxlYXNlIHVzZSBCYXNlQ29udGFpbmVySW1hZ2Ugc3RhdGljIGZhY3RvcnkgbWV0aG9kcyBpbnN0ZWFkLCBlLmcuLCBCYXNlQ29udGFpbmVySW1hZ2UuZnJvbURvY2tlckh1YihcInVidW50dVwiLCBcIjIyLjA0XCIpIG9yIEJhc2VDb250YWluZXJJbWFnZS5mcm9tU3RyaW5nKFwicHVibGljLmVjci5hd3MvbHRzL3VidW50dToyMi4wNFwiKScsXG4gICAgICApO1xuICAgIH1cbiAgICBpZiAocHJvcHM/LmJhc2VBbWkgJiYgdHlwZW9mIHByb3BzLmJhc2VBbWkgPT09ICdzdHJpbmcnKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKFxuICAgICAgICAnUGFzc2luZyBiYXNlQW1pIGFzIGEgc3RyaW5nIGlzIGRlcHJlY2F0ZWQuIFBsZWFzZSB1c2UgQmFzZUltYWdlIHN0YXRpYyBmYWN0b3J5IG1ldGhvZHMgaW5zdGVhZCwgZS5nLiwgQmFzZUltYWdlLmZyb21BbWlJZChcImFtaS0xMjM0NVwiKSBvciBCYXNlSW1hZ2UuZnJvbVN0cmluZyhcImFybjphd3M6Li4uXCIpJyxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gdGFncyBmb3IgZmluZGluZyByZXNvdXJjZXNcbiAgICB0aGlzLnRhZ3MgPSB7XG4gICAgICAnR2l0SHViUnVubmVyczpTdGFjayc6IGNkay5TdGFjay5vZih0aGlzKS5zdGFja05hbWUsXG4gICAgICAnR2l0SHViUnVubmVyczpCdWlsZGVyJzogdGhpcy5ub2RlLnBhdGgsXG4gICAgfTtcblxuICAgIC8vIGNvbmZpcm0gaW5zdGFuY2UgdHlwZVxuICAgIGlmICghdGhpcy5hcmNoaXRlY3R1cmUuaW5zdGFuY2VUeXBlTWF0Y2godGhpcy5pbnN0YW5jZVR5cGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEJ1aWxkZXIgYXJjaGl0ZWN0dXJlICgke3RoaXMuYXJjaGl0ZWN0dXJlLm5hbWV9KSBkb2Vzbid0IG1hdGNoIHNlbGVjdGVkIGluc3RhbmNlIHR5cGUgKCR7dGhpcy5pbnN0YW5jZVR5cGV9IC8gJHt0aGlzLmluc3RhbmNlVHlwZS5hcmNoaXRlY3R1cmV9KWApO1xuICAgIH1cblxuICAgIC8vIHdhcm4gYWdhaW5zdCBpc29sYXRlZCBuZXR3b3Jrc1xuICAgIGlmIChwcm9wcz8uc3VibmV0U2VsZWN0aW9uPy5zdWJuZXRUeXBlID09IGVjMi5TdWJuZXRUeXBlLlBSSVZBVEVfSVNPTEFURUQpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ1ByaXZhdGUgaXNvbGF0ZWQgc3VibmV0cyBjYW5ub3QgcHVsbCBmcm9tIHB1YmxpYyBFQ1IgYW5kIFZQQyBlbmRwb2ludCBpcyBub3Qgc3VwcG9ydGVkIHlldC4gJyArXG4gICAgICAgICdTZWUgaHR0cHM6Ly9naXRodWIuY29tL2F3cy9jb250YWluZXJzLXJvYWRtYXAvaXNzdWVzLzExNjAnKTtcbiAgICB9XG5cbiAgICAvLyByb2xlIHRvIGJlIHVzZWQgYnkgQVdTIEltYWdlIEJ1aWxkZXJcbiAgICB0aGlzLnJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWMyLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcblxuICAgIC8vIGNyZWF0ZSBjb250YWluZXIgd29ya2Zsb3cgaWYgZG9ja2VyIHNldHVwIGNvbW1hbmRzIGFyZSBwcm92aWRlZFxuICAgIGlmICh0aGlzLmRvY2tlclNldHVwQ29tbWFuZHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhpcy5jb250YWluZXJXb3JrZmxvdyA9IGdlbmVyYXRlQnVpbGRXb3JrZmxvd1dpdGhEb2NrZXJTZXR1cENvbW1hbmRzKHRoaXMsICdCdWlsZCcsIHRoaXMub3MsIHRoaXMuZG9ja2VyU2V0dXBDb21tYW5kcyk7XG4gICAgICB0aGlzLmNvbnRhaW5lcldvcmtmbG93RXhlY3V0aW9uUm9sZSA9IGlhbS5Sb2xlLmZyb21Sb2xlQXJuKHRoaXMsICdJbWFnZSBCdWlsZGVyIFJvbGUnLCBjZGsuU3RhY2sub2YodGhpcykuZm9ybWF0QXJuKHtcbiAgICAgICAgc2VydmljZTogJ2lhbScsXG4gICAgICAgIHJlZ2lvbjogJycsXG4gICAgICAgIHJlc291cmNlOiAncm9sZScsXG4gICAgICAgIHJlc291cmNlTmFtZTogJ2F3cy1zZXJ2aWNlLXJvbGUvaW1hZ2VidWlsZGVyLmFtYXpvbmF3cy5jb20vQVdTU2VydmljZVJvbGVGb3JJbWFnZUJ1aWxkZXInLFxuICAgICAgfSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcGxhdGZvcm0oKSB7XG4gICAgaWYgKHRoaXMub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHJldHVybiAnV2luZG93cyc7XG4gICAgfVxuICAgIGlmICh0aGlzLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgIHJldHVybiAnTGludXgnO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgRXJyb3IoYE9TICR7dGhpcy5vcy5uYW1lfSBpcyBub3Qgc3VwcG9ydGVkIGJ5IEFXUyBJbWFnZSBCdWlsZGVyYCk7XG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IElSdW5uZXJQcm92aWRlciB0byBmaW5hbGl6ZSBzZXR0aW5ncyBhbmQgY3JlYXRlIHRoZSBpbWFnZSBidWlsZGVyLlxuICAgKi9cbiAgYmluZERvY2tlckltYWdlKCk6IFJ1bm5lckltYWdlIHtcbiAgICBpZiAodGhpcy5ib3VuZERvY2tlckltYWdlKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib3VuZERvY2tlckltYWdlO1xuICAgIH1cblxuICAgIC8vIGNyZWF0ZSByZXBvc2l0b3J5IHRoYXQgb25seSBrZWVwcyBvbmUgdGFnXG4gICAgY29uc3QgcmVwb3NpdG9yeSA9IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnUmVwb3NpdG9yeScsIHtcbiAgICAgIGltYWdlU2Nhbk9uUHVzaDogdHJ1ZSxcbiAgICAgIGltYWdlVGFnTXV0YWJpbGl0eTogVGFnTXV0YWJpbGl0eS5NVVRBQkxFLFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZW1wdHlPbkRlbGV0ZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRpc3QgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24odGhpcywgJ0RvY2tlciBEaXN0cmlidXRpb24nLCB7XG4gICAgICBuYW1lOiB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpLFxuICAgICAgLy8gZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXG4gICAgICBkaXN0cmlidXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICByZWdpb246IFN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICBjb250YWluZXJEaXN0cmlidXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBDb250YWluZXJUYWdzOiBbJ2xhdGVzdCddLFxuICAgICAgICAgICAgVGFyZ2V0UmVwb3NpdG9yeToge1xuICAgICAgICAgICAgICBTZXJ2aWNlOiAnRUNSJyxcbiAgICAgICAgICAgICAgUmVwb3NpdG9yeU5hbWU6IHJlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICAgdGFnczogdGhpcy50YWdzLFxuICAgIH0pO1xuXG4gICAgbGV0IGRvY2tlcmZpbGVUZW1wbGF0ZSA9IGBGUk9NIHt7eyBpbWFnZWJ1aWxkZXI6cGFyZW50SW1hZ2UgfX19XG57e3sgaW1hZ2VidWlsZGVyOmVudmlyb25tZW50cyB9fX1cbnt7eyBpbWFnZWJ1aWxkZXI6Y29tcG9uZW50cyB9fX1gO1xuXG4gICAgZm9yIChjb25zdCBjIG9mIHRoaXMuY29tcG9uZW50cykge1xuICAgICAgY29uc3QgY29tbWFuZHMgPSBjLmdldERvY2tlckNvbW1hbmRzKHRoaXMub3MsIHRoaXMuYXJjaGl0ZWN0dXJlKTtcbiAgICAgIGlmIChjb21tYW5kcy5sZW5ndGggPiAwKSB7XG4gICAgICAgIGRvY2tlcmZpbGVUZW1wbGF0ZSArPSAnXFxuJyArIGNvbW1hbmRzLmpvaW4oJ1xcbicpICsgJ1xcbic7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVjaXBlID0gbmV3IENvbnRhaW5lclJlY2lwZSh0aGlzLCAnQ29udGFpbmVyIFJlY2lwZScsIHtcbiAgICAgIHBsYXRmb3JtOiB0aGlzLnBsYXRmb3JtKCksXG4gICAgICBjb21wb25lbnRzOiB0aGlzLmJpbmRDb21wb25lbnRzKCksXG4gICAgICB0YXJnZXRSZXBvc2l0b3J5OiByZXBvc2l0b3J5LFxuICAgICAgZG9ja2VyZmlsZVRlbXBsYXRlOiBkb2NrZXJmaWxlVGVtcGxhdGUsXG4gICAgICBwYXJlbnRJbWFnZTogdGhpcy5iYXNlSW1hZ2UuaW1hZ2UsXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgfSk7XG5cbiAgICBjb25zdCBsb2cgPSB0aGlzLmNyZWF0ZUxvZygnRG9ja2VyIExvZycsIHJlY2lwZS5uYW1lKTtcbiAgICBjb25zdCBpbmZyYSA9IHRoaXMuY3JlYXRlSW5mcmFzdHJ1Y3R1cmUoW1xuICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlJyksXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0VDMkluc3RhbmNlUHJvZmlsZUZvckltYWdlQnVpbGRlckVDUkNvbnRhaW5lckJ1aWxkcycpLFxuICAgIF0pO1xuXG4gICAgaWYgKHRoaXMud2FpdE9uRGVwbG95KSB7XG4gICAgICB0aGlzLmNyZWF0ZUltYWdlKGluZnJhLCBkaXN0LCBsb2csIHVuZGVmaW5lZCwgcmVjaXBlLmFybik7XG4gICAgfVxuICAgIHRoaXMuZG9ja2VySW1hZ2VDbGVhbmVyKHJlY2lwZSwgcmVwb3NpdG9yeSk7XG5cbiAgICB0aGlzLmNyZWF0ZVBpcGVsaW5lKGluZnJhLCBkaXN0LCBsb2csIHVuZGVmaW5lZCwgcmVjaXBlLmFybik7XG5cbiAgICB0aGlzLmJvdW5kRG9ja2VySW1hZ2UgPSB7XG4gICAgICBpbWFnZVJlcG9zaXRvcnk6IHJlcG9zaXRvcnksXG4gICAgICBpbWFnZVRhZzogJ2xhdGVzdCcsXG4gICAgICBvczogdGhpcy5vcyxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBsb2dHcm91cDogbG9nLFxuICAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygndW5rbm93bicpLFxuICAgICAgLy8gbm8gZGVwZW5kYWJsZSBhcyBDbG91ZEZvcm1hdGlvbiB3aWxsIGZhaWwgdG8gZ2V0IGltYWdlIEFSTiBvbmNlIHRoZSBpbWFnZSBpcyBkZWxldGVkICh3ZSBkZWxldGUgb2xkIGltYWdlcyBkYWlseSlcbiAgICB9O1xuXG4gICAgcmV0dXJuIHRoaXMuYm91bmREb2NrZXJJbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgZG9ja2VySW1hZ2VDbGVhbmVyKHJlY2lwZTogQ29udGFpbmVyUmVjaXBlLCByZXBvc2l0b3J5OiBlY3IuSVJlcG9zaXRvcnkpIHtcbiAgICAvLyB0aGlzIGlzIGhlcmUgdG8gcHJvdmlkZSBzYWZlIHVwZ3JhZGUgZnJvbSBvbGQgY2RrLWdpdGh1Yi1ydW5uZXJzIHZlcnNpb25zXG4gICAgLy8gdGhpcyBsYW1iZGEgd2FzIHVzZWQgYnkgYSBjdXN0b20gcmVzb3VyY2UgdG8gZGVsZXRlIGFsbCBpbWFnZXMgYnVpbGRzIG9uIGNsZWFudXBcbiAgICAvLyBpZiB3ZSByZW1vdmUgdGhlIGN1c3RvbSByZXNvdXJjZSBhbmQgdGhlIGxhbWJkYSwgdGhlIG9sZCBpbWFnZXMgd2lsbCBiZSBkZWxldGVkIG9uIHVwZGF0ZVxuICAgIC8vIGtlZXBpbmcgdGhlIGxhbWJkYSBidXQgcmVtb3ZpbmcgdGhlIHBlcm1pc3Npb25zIHdpbGwgbWFrZSBzdXJlIHRoYXQgZGVsZXRpb24gd2lsbCBmYWlsXG4gICAgY29uc3Qgb2xkRGVsZXRlciA9IHNpbmdsZXRvbkxhbWJkYShCdWlsZEltYWdlRnVuY3Rpb24sIHRoaXMsICdidWlsZC1pbWFnZScsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3VzdG9tIHJlc291cmNlIGhhbmRsZXIgdGhhdCB0cmlnZ2VycyBDb2RlQnVpbGQgdG8gYnVpbGQgcnVubmVyIGltYWdlcycsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygzKSxcbiAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlJVTk5FUl9JTUFHRV9CVUlMRCksXG4gICAgICBsb2dnaW5nRm9ybWF0OiBsYW1iZGEuTG9nZ2luZ0Zvcm1hdC5KU09OLFxuICAgIH0pO1xuICAgIG9sZERlbGV0ZXIuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5ERU5ZLFxuICAgICAgYWN0aW9uczogWydpbWFnZWJ1aWxkZXI6RGVsZXRlSW1hZ2UnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgLy8gZGVsZXRlIG9sZCB2ZXJzaW9uIG9uIHVwZGF0ZSBhbmQgb24gc3RhY2sgZGVsZXRpb25cbiAgICB0aGlzLmltYWdlQ2xlYW5lcignQ29udGFpbmVyJywgcmVjaXBlLm5hbWUudG9Mb3dlckNhc2UoKSwgcmVjaXBlLnZlcnNpb24pO1xuXG4gICAgLy8gZGVsZXRlIG9sZCBkb2NrZXIgaW1hZ2VzICsgSUIgcmVzb3VyY2VzIGRhaWx5XG4gICAgbmV3IGltYWdlYnVpbGRlci5DZm5MaWZlY3ljbGVQb2xpY3kodGhpcywgJ0xpZmVjeWNsZSBQb2xpY3kgRG9ja2VyJywge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIGRlc2NyaXB0aW9uOiBgRGVsZXRlIG9sZCBHaXRIdWIgUnVubmVyIERvY2tlciBpbWFnZXMgZm9yICR7dGhpcy5ub2RlLnBhdGh9YCxcbiAgICAgIGV4ZWN1dGlvblJvbGU6IG5ldyBpYW0uUm9sZSh0aGlzLCAnTGlmZWN5Y2xlIFBvbGljeSBEb2NrZXIgUm9sZScsIHtcbiAgICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2ltYWdlYnVpbGRlci5hbWF6b25hd3MuY29tJyksXG4gICAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgICAgaWI6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uczogWyd0YWc6R2V0UmVzb3VyY2VzJywgJ2ltYWdlYnVpbGRlcjpEZWxldGVJbWFnZSddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sIC8vIEltYWdlIEJ1aWxkZXIgZG9lc24ndCBzdXBwb3J0IHNjb3BpbmcgdGhpcyA6KFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgICAgZWNyOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnZWNyOkJhdGNoR2V0SW1hZ2UnLCAnZWNyOkJhdGNoRGVsZXRlSW1hZ2UnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFtyZXBvc2l0b3J5LnJlcG9zaXRvcnlBcm5dLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KS5yb2xlQXJuLFxuICAgICAgcG9saWN5RGV0YWlsczogW3tcbiAgICAgICAgYWN0aW9uOiB7XG4gICAgICAgICAgdHlwZTogJ0RFTEVURScsXG4gICAgICAgICAgaW5jbHVkZVJlc291cmNlczoge1xuICAgICAgICAgICAgY29udGFpbmVyczogdHJ1ZSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICBmaWx0ZXI6IHtcbiAgICAgICAgICB0eXBlOiAnQ09VTlQnLFxuICAgICAgICAgIHZhbHVlOiAyLFxuICAgICAgICB9LFxuICAgICAgfV0sXG4gICAgICByZXNvdXJjZVR5cGU6ICdDT05UQUlORVJfSU1BR0UnLFxuICAgICAgcmVzb3VyY2VTZWxlY3Rpb246IHtcbiAgICAgICAgcmVjaXBlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIG5hbWU6IHJlY2lwZS5uYW1lLFxuICAgICAgICAgICAgc2VtYW50aWNWZXJzaW9uOiAnMS54LngnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGNyZWF0ZUxvZyhpZDogc3RyaW5nLCByZWNpcGVOYW1lOiBzdHJpbmcpOiBsb2dzLkxvZ0dyb3VwIHtcbiAgICByZXR1cm4gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgaWQsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvaW1hZ2VidWlsZGVyLyR7cmVjaXBlTmFtZX1gLFxuICAgICAgcmV0ZW50aW9uOiB0aGlzLmxvZ1JldGVudGlvbixcbiAgICAgIHJlbW92YWxQb2xpY3k6IHRoaXMubG9nUmVtb3ZhbFBvbGljeSxcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBjcmVhdGVJbmZyYXN0cnVjdHVyZShtYW5hZ2VkUG9saWNpZXM6IGlhbS5JTWFuYWdlZFBvbGljeVtdKTogaW1hZ2VidWlsZGVyLkNmbkluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbiB7XG4gICAgaWYgKHRoaXMuaW5mcmFzdHJ1Y3R1cmUpIHtcbiAgICAgIHJldHVybiB0aGlzLmluZnJhc3RydWN0dXJlO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgbWFuYWdlZFBvbGljeSBvZiBtYW5hZ2VkUG9saWNpZXMpIHtcbiAgICAgIHRoaXMucm9sZS5hZGRNYW5hZ2VkUG9saWN5KG1hbmFnZWRQb2xpY3kpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgY29tcG9uZW50IG9mIHRoaXMuYm91bmRDb21wb25lbnRzKSB7XG4gICAgICBjb21wb25lbnQuZ3JhbnRBc3NldHNSZWFkKHRoaXMucm9sZSk7XG4gICAgfVxuXG4gICAgdGhpcy5pbmZyYXN0cnVjdHVyZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uKHRoaXMsICdJbmZyYXN0cnVjdHVyZScsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICAvLyBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcbiAgICAgIHN1Ym5ldElkOiB0aGlzLnZwYz8uc2VsZWN0U3VibmV0cyh0aGlzLnN1Ym5ldFNlbGVjdGlvbikuc3VibmV0SWRzWzBdLFxuICAgICAgc2VjdXJpdHlHcm91cElkczogdGhpcy5zZWN1cml0eUdyb3Vwcz8ubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICBpbnN0YW5jZVR5cGVzOiBbdGhpcy5pbnN0YW5jZVR5cGUudG9TdHJpbmcoKV0sXG4gICAgICBpbnN0YW5jZU1ldGFkYXRhT3B0aW9uczoge1xuICAgICAgICBodHRwVG9rZW5zOiAncmVxdWlyZWQnLFxuICAgICAgICAvLyBDb250YWluZXIgYnVpbGRzIHJlcXVpcmUgYSBtaW5pbXVtIG9mIHR3byBob3BzLlxuICAgICAgICBodHRwUHV0UmVzcG9uc2VIb3BMaW1pdDogMixcbiAgICAgIH0sXG4gICAgICBpbnN0YW5jZVByb2ZpbGVOYW1lOiBuZXcgaWFtLkNmbkluc3RhbmNlUHJvZmlsZSh0aGlzLCAnSW5zdGFuY2UgUHJvZmlsZScsIHtcbiAgICAgICAgcm9sZXM6IFtcbiAgICAgICAgICB0aGlzLnJvbGUucm9sZU5hbWUsXG4gICAgICAgIF0sXG4gICAgICB9KS5yZWYsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gdGhpcy5pbmZyYXN0cnVjdHVyZTtcbiAgfVxuXG4gIHByaXZhdGUgd29ya2Zsb3dDb25maWcoY29udGFpbmVyUmVjaXBlQXJuPzogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuY29udGFpbmVyV29ya2Zsb3cgJiYgdGhpcy5jb250YWluZXJXb3JrZmxvd0V4ZWN1dGlvblJvbGUgJiYgY29udGFpbmVyUmVjaXBlQXJuKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICB3b3JrZmxvd3M6IFt7XG4gICAgICAgICAgd29ya2Zsb3dBcm46IHRoaXMuY29udGFpbmVyV29ya2Zsb3cuYXJuLFxuICAgICAgICB9XSxcbiAgICAgICAgZXhlY3V0aW9uUm9sZTogdGhpcy5jb250YWluZXJXb3JrZmxvd0V4ZWN1dGlvblJvbGUucm9sZUFybixcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgY3JlYXRlSW1hZ2UoaW5mcmE6IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24sIGRpc3Q6IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uLCBsb2c6IGxvZ3MuTG9nR3JvdXAsXG4gICAgaW1hZ2VSZWNpcGVBcm4/OiBzdHJpbmcsIGNvbnRhaW5lclJlY2lwZUFybj86IHN0cmluZyk6IGltYWdlYnVpbGRlci5DZm5JbWFnZSB7XG4gICAgY29uc3QgaW1hZ2UgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkltYWdlKHRoaXMsIHRoaXMuYW1pT3JDb250YWluZXJJZCgnSW1hZ2UnLCBpbWFnZVJlY2lwZUFybiwgY29udGFpbmVyUmVjaXBlQXJuKSwge1xuICAgICAgaW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uQXJuOiBpbmZyYS5hdHRyQXJuLFxuICAgICAgZGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbkFybjogZGlzdC5hdHRyQXJuLFxuICAgICAgaW1hZ2VSZWNpcGVBcm4sXG4gICAgICBjb250YWluZXJSZWNpcGVBcm4sXG4gICAgICBpbWFnZVRlc3RzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBpbWFnZVRlc3RzRW5hYmxlZDogZmFsc2UsXG4gICAgICB9LFxuICAgICAgdGFnczogdGhpcy50YWdzLFxuICAgICAgLi4udGhpcy53b3JrZmxvd0NvbmZpZyhjb250YWluZXJSZWNpcGVBcm4pLFxuICAgIH0pO1xuICAgIGltYWdlLm5vZGUuYWRkRGVwZW5kZW5jeShpbmZyYSk7XG4gICAgaW1hZ2Uubm9kZS5hZGREZXBlbmRlbmN5KGxvZyk7XG5cbiAgICAvLyBkbyBub3QgZGVsZXRlIHRoZSBpbWFnZSBhcyBpdCB3aWxsIGJlIGRlbGV0ZWQgYnkgaW1hZ2VDbGVhbmVyKCkuXG4gICAgLy8gaWYgd2UgZGVsZXRlIGl0IGhlcmUsIGltYWdlQ2xlYW5lcigpIHdvbid0IGJlIGFibGUgdG8gZmluZCB0aGUgaW1hZ2UuXG4gICAgLy8gaWYgaW1hZ2VDbGVhbmVyKCkgY2FuJ3QgZmluZCB0aGUgaW1hZ2UsIGl0IHdvbid0IGJlIGFibGUgdG8gZGVsZXRlIHRoZSBsaW5rZWQgQU1JL0RvY2tlciBpbWFnZS5cbiAgICAvLyB1c2UgUkVUQUlOX09OX1VQREFURV9PUl9ERUxFVEUsIHNvIGV2ZXJ5dGhpbmcgaXMgY2xlYW5lZCBvbmx5IG9uIHJvbGxiYWNrLlxuICAgIGltYWdlLmFwcGx5UmVtb3ZhbFBvbGljeShSZW1vdmFsUG9saWN5LlJFVEFJTl9PTl9VUERBVEVfT1JfREVMRVRFKTtcblxuICAgIHJldHVybiBpbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgYW1pT3JDb250YWluZXJJZChiYXNlSWQ6IHN0cmluZywgaW1hZ2VSZWNpcGVBcm4/OiBzdHJpbmcsIGNvbnRhaW5lclJlY2lwZUFybj86IHN0cmluZykge1xuICAgIGlmIChpbWFnZVJlY2lwZUFybikge1xuICAgICAgcmV0dXJuIGBBTUkgJHtiYXNlSWR9YDtcbiAgICB9XG4gICAgaWYgKGNvbnRhaW5lclJlY2lwZUFybikge1xuICAgICAgcmV0dXJuIGBEb2NrZXIgJHtiYXNlSWR9YDtcbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKCdFaXRoZXIgaW1hZ2VSZWNpcGVBcm4gb3IgY29udGFpbmVyUmVjaXBlQXJuIG11c3QgYmUgZGVmaW5lZCcpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGNyZWF0ZVBpcGVsaW5lKGluZnJhOiBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uLCBkaXN0OiBpbWFnZWJ1aWxkZXIuQ2ZuRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbiwgbG9nOiBsb2dzLkxvZ0dyb3VwLFxuICAgIGltYWdlUmVjaXBlQXJuPzogc3RyaW5nLCBjb250YWluZXJSZWNpcGVBcm4/OiBzdHJpbmcpOiBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VQaXBlbGluZSB7XG4gICAgLy8gc2V0IHNjaGVkdWxlXG4gICAgbGV0IHNjaGVkdWxlT3B0aW9uczogaW1hZ2VidWlsZGVyLkNmbkltYWdlUGlwZWxpbmUuU2NoZWR1bGVQcm9wZXJ0eSB8IHVuZGVmaW5lZDtcbiAgICBpZiAodGhpcy5yZWJ1aWxkSW50ZXJ2YWwudG9EYXlzKCkgPiAwKSB7XG4gICAgICBzY2hlZHVsZU9wdGlvbnMgPSB7XG4gICAgICAgIHNjaGVkdWxlRXhwcmVzc2lvbjogZXZlbnRzLlNjaGVkdWxlLnJhdGUodGhpcy5yZWJ1aWxkSW50ZXJ2YWwpLmV4cHJlc3Npb25TdHJpbmcsXG4gICAgICAgIHBpcGVsaW5lRXhlY3V0aW9uU3RhcnRDb25kaXRpb246ICdFWFBSRVNTSU9OX01BVENIX09OTFknLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBnZW5lcmF0ZSBwaXBlbGluZVxuICAgIGNvbnN0IHBpcGVsaW5lID0gbmV3IGltYWdlYnVpbGRlci5DZm5JbWFnZVBpcGVsaW5lKHRoaXMsIHRoaXMuYW1pT3JDb250YWluZXJJZCgnUGlwZWxpbmUnLCBpbWFnZVJlY2lwZUFybiwgY29udGFpbmVyUmVjaXBlQXJuKSwge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIC8vIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxuICAgICAgaW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uQXJuOiBpbmZyYS5hdHRyQXJuLFxuICAgICAgZGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbkFybjogZGlzdC5hdHRyQXJuLFxuICAgICAgaW1hZ2VSZWNpcGVBcm4sXG4gICAgICBjb250YWluZXJSZWNpcGVBcm4sXG4gICAgICBzY2hlZHVsZTogc2NoZWR1bGVPcHRpb25zLFxuICAgICAgaW1hZ2VUZXN0c0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgaW1hZ2VUZXN0c0VuYWJsZWQ6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIHRhZ3M6IHRoaXMudGFncyxcbiAgICAgIC4uLnRoaXMud29ya2Zsb3dDb25maWcoY29udGFpbmVyUmVjaXBlQXJuKSxcbiAgICB9KTtcbiAgICBwaXBlbGluZS5ub2RlLmFkZERlcGVuZGVuY3koaW5mcmEpO1xuICAgIHBpcGVsaW5lLm5vZGUuYWRkRGVwZW5kZW5jeShsb2cpO1xuXG4gICAgcmV0dXJuIHBpcGVsaW5lO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcHVibGljIGdldCBjb25uZWN0aW9ucygpOiBlYzIuQ29ubmVjdGlvbnMge1xuICAgIHJldHVybiBuZXcgZWMyLkNvbm5lY3Rpb25zKHsgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMgfSk7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGdyYW50UHJpbmNpcGFsKCk6IGlhbS5JUHJpbmNpcGFsIHtcbiAgICByZXR1cm4gdGhpcy5yb2xlO1xuICB9XG5cbiAgYmluZEFtaSgpOiBSdW5uZXJBbWkge1xuICAgIGlmICh0aGlzLmJvdW5kQW1pKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib3VuZEFtaTtcbiAgICB9XG5cbiAgICBjb25zdCBsYXVuY2hUZW1wbGF0ZSA9IG5ldyBlYzIuTGF1bmNoVGVtcGxhdGUodGhpcywgJ0xhdW5jaCB0ZW1wbGF0ZScsIHtcbiAgICAgIHJlcXVpcmVJbWRzdjI6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBsYXVuY2hUZW1wbGF0ZUNvbmZpZ3M6IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uLkxhdW5jaFRlbXBsYXRlQ29uZmlndXJhdGlvblByb3BlcnR5W10gPSBbe1xuICAgICAgbGF1bmNoVGVtcGxhdGVJZDogbGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVJZCxcbiAgICAgIHNldERlZmF1bHRWZXJzaW9uOiB0cnVlLFxuICAgIH1dO1xuICAgIGNvbnN0IGZhc3RMYXVuY2hDb25maWdzOiBpbWFnZWJ1aWxkZXIuQ2ZuRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbi5GYXN0TGF1bmNoQ29uZmlndXJhdGlvblByb3BlcnR5W10gPSBbXTtcblxuICAgIGlmICh0aGlzLmZhc3RMYXVuY2hPcHRpb25zPy5lbmFibGVkID8/IGZhbHNlKSB7XG4gICAgICBpZiAoIXRoaXMub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdGYXN0IGxhdW5jaCBpcyBvbmx5IHN1cHBvcnRlZCBmb3IgV2luZG93cycpO1xuICAgICAgfVxuXG4gICAgICAvLyBjcmVhdGUgYSBzZXBhcmF0ZSBsYXVuY2ggdGVtcGxhdGUgZm9yIGZhc3QgbGF1bmNoIHNvOlxuICAgICAgLy8gIC0gc2V0dGluZ3MgZG9uJ3QgYWZmZWN0IHRoZSBydW5uZXJzXG4gICAgICAvLyAgLSBlbmFibGluZyBmYXN0IGxhdW5jaCBvbiBhbiBleGlzdGluZyBidWlsZGVyIHdvcmtzICh3aXRob3V0IGEgbmV3IGxhdW5jaCB0ZW1wbGF0ZSwgRUMyIEltYWdlIEJ1aWxkZXIgd2lsbCB1c2UgdGhlIGZpcnN0IHZlcnNpb24gb2YgdGhlIGxhdW5jaCB0ZW1wbGF0ZSwgd2hpY2ggZG9lc24ndCBoYXZlIGluc3RhbmNlIG9yIFZQQyBjb25maWcpXG4gICAgICAvLyAgLSBzZXR0aW5nIHZwYyArIHN1Ym5ldCBvbiB0aGUgbWFpbiBsYXVuY2ggdGVtcGxhdGUgd2lsbCBjYXVzZSBSdW5JbnN0YW5jZXMgdG8gZmFpbFxuICAgICAgLy8gIC0gRUMyIEltYWdlIEJ1aWxkZXIgc2VlbXMgdG8gZ2V0IGNvbmZ1c2VkIHdpdGggd2hpY2ggbGF1bmNoIHRlbXBsYXRlIHZlcnNpb24gdG8gYmFzZSBhbnkgbmV3IHZlcnNpb24gb24sIHNvIGEgbmV3IHRlbXBsYXRlIGlzIGFsd2F5cyBiZXN0XG4gICAgICBjb25zdCBmYXN0TGF1bmNoVGVtcGxhdGUgPSBuZXcgZWMyLkNmbkxhdW5jaFRlbXBsYXRlKHRoaXMsICdGYXN0IExhdW5jaCBUZW1wbGF0ZScsIHtcbiAgICAgICAgbGF1bmNoVGVtcGxhdGVEYXRhOiB7XG4gICAgICAgICAgbWV0YWRhdGFPcHRpb25zOiB7XG4gICAgICAgICAgICBodHRwVG9rZW5zOiAncmVxdWlyZWQnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaW5zdGFuY2VUeXBlOiB0aGlzLmluc3RhbmNlVHlwZS50b1N0cmluZygpLFxuICAgICAgICAgIG5ldHdvcmtJbnRlcmZhY2VzOiBbe1xuICAgICAgICAgICAgc3VibmV0SWQ6IHRoaXMudnBjPy5zZWxlY3RTdWJuZXRzKHRoaXMuc3VibmV0U2VsZWN0aW9uKS5zdWJuZXRJZHNbMF0sXG4gICAgICAgICAgICBkZXZpY2VJbmRleDogMCxcbiAgICAgICAgICAgIGdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgICAgICB9XSxcbiAgICAgICAgICB0YWdTcGVjaWZpY2F0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICByZXNvdXJjZVR5cGU6ICdpbnN0YW5jZScsXG4gICAgICAgICAgICAgIHRhZ3M6IFt7XG4gICAgICAgICAgICAgICAga2V5OiAnTmFtZScsXG4gICAgICAgICAgICAgICAgdmFsdWU6IGAke3RoaXMubm9kZS5wYXRofS9GYXN0IExhdW5jaCBJbnN0YW5jZWAsXG4gICAgICAgICAgICAgIH1dLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgcmVzb3VyY2VUeXBlOiAndm9sdW1lJyxcbiAgICAgICAgICAgICAgdGFnczogW3tcbiAgICAgICAgICAgICAgICBrZXk6ICdOYW1lJyxcbiAgICAgICAgICAgICAgICB2YWx1ZTogYCR7dGhpcy5ub2RlLnBhdGh9L0Zhc3QgTGF1bmNoIEluc3RhbmNlYCxcbiAgICAgICAgICAgICAgfV0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHRhZ1NwZWNpZmljYXRpb25zOiBbe1xuICAgICAgICAgIHJlc291cmNlVHlwZTogJ2xhdW5jaC10ZW1wbGF0ZScsXG4gICAgICAgICAgdGFnczogW3tcbiAgICAgICAgICAgIGtleTogJ05hbWUnLFxuICAgICAgICAgICAgdmFsdWU6IGAke3RoaXMubm9kZS5wYXRofS9GYXN0IExhdW5jaCBUZW1wbGF0ZWAsXG4gICAgICAgICAgfV0sXG4gICAgICAgIH1dLFxuICAgICAgfSk7XG5cbiAgICAgIGxhdW5jaFRlbXBsYXRlQ29uZmlncy5wdXNoKHtcbiAgICAgICAgbGF1bmNoVGVtcGxhdGVJZDogZmFzdExhdW5jaFRlbXBsYXRlLmF0dHJMYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgICBzZXREZWZhdWx0VmVyc2lvbjogdHJ1ZSxcbiAgICAgIH0pO1xuICAgICAgZmFzdExhdW5jaENvbmZpZ3MucHVzaCh7XG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICAgIGxhdW5jaFRlbXBsYXRlOiB7XG4gICAgICAgICAgbGF1bmNoVGVtcGxhdGVJZDogZmFzdExhdW5jaFRlbXBsYXRlLmF0dHJMYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgICB9LFxuICAgICAgICBtYXhQYXJhbGxlbExhdW5jaGVzOiB0aGlzLmZhc3RMYXVuY2hPcHRpb25zPy5tYXhQYXJhbGxlbExhdW5jaGVzID8/IDYsXG4gICAgICAgIHNuYXBzaG90Q29uZmlndXJhdGlvbjoge1xuICAgICAgICAgIHRhcmdldFJlc291cmNlQ291bnQ6IHRoaXMuZmFzdExhdW5jaE9wdGlvbnM/LnRhcmdldFJlc291cmNlQ291bnQgPz8gMSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YWNrTmFtZSA9IGNkay5TdGFjay5vZih0aGlzKS5zdGFja05hbWU7XG4gICAgY29uc3QgYnVpbGRlck5hbWUgPSB0aGlzLm5vZGUucGF0aDtcblxuICAgIGNvbnN0IGRpc3QgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24odGhpcywgJ0FNSSBEaXN0cmlidXRpb24nLCB7XG4gICAgICBuYW1lOiB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpLFxuICAgICAgLy8gZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXG4gICAgICBkaXN0cmlidXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICByZWdpb246IFN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICBhbWlEaXN0cmlidXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBOYW1lOiBgJHtjZGsuTmFtZXMudW5pcXVlUmVzb3VyY2VOYW1lKHRoaXMsIHtcbiAgICAgICAgICAgICAgbWF4TGVuZ3RoOiAxMDAsXG4gICAgICAgICAgICAgIHNlcGFyYXRvcjogJy0nLFxuICAgICAgICAgICAgICBhbGxvd2VkU3BlY2lhbENoYXJhY3RlcnM6ICdfLScsXG4gICAgICAgICAgICB9KX0te3sgaW1hZ2VidWlsZGVyOmJ1aWxkRGF0ZSB9fWAsXG4gICAgICAgICAgICBBbWlUYWdzOiB7XG4gICAgICAgICAgICAgICdOYW1lJzogdGhpcy5ub2RlLmlkLFxuICAgICAgICAgICAgICAnR2l0SHViUnVubmVyczpTdGFjayc6IHN0YWNrTmFtZSxcbiAgICAgICAgICAgICAgJ0dpdEh1YlJ1bm5lcnM6QnVpbGRlcic6IGJ1aWxkZXJOYW1lLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGxhdW5jaFRlbXBsYXRlQ29uZmlndXJhdGlvbnM6IGxhdW5jaFRlbXBsYXRlQ29uZmlncyxcbiAgICAgICAgICBmYXN0TGF1bmNoQ29uZmlndXJhdGlvbnM6IGZhc3RMYXVuY2hDb25maWdzLmxlbmd0aCA+IDAgPyBmYXN0TGF1bmNoQ29uZmlncyA6IHVuZGVmaW5lZCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0YWdzOiB0aGlzLnRhZ3MsXG4gICAgfSk7XG5cbiAgICBjb25zdCByZWNpcGUgPSBuZXcgQW1pUmVjaXBlKHRoaXMsICdBbWkgUmVjaXBlJywge1xuICAgICAgcGxhdGZvcm06IHRoaXMucGxhdGZvcm0oKSxcbiAgICAgIGNvbXBvbmVudHM6IHRoaXMuYmluZENvbXBvbmVudHMoKSxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBiYXNlQW1pOiB0aGlzLmJhc2VBbWksXG4gICAgICBzdG9yYWdlU2l6ZTogdGhpcy5zdG9yYWdlU2l6ZSxcbiAgICAgIHRhZ3M6IHRoaXMudGFncyxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxvZyA9IHRoaXMuY3JlYXRlTG9nKCdBbWkgTG9nJywgcmVjaXBlLm5hbWUpO1xuICAgIGNvbnN0IGluZnJhID0gdGhpcy5jcmVhdGVJbmZyYXN0cnVjdHVyZShbXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSxcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnRUMySW5zdGFuY2VQcm9maWxlRm9ySW1hZ2VCdWlsZGVyJyksXG4gICAgXSk7XG4gICAgaWYgKHRoaXMud2FpdE9uRGVwbG95KSB7XG4gICAgICB0aGlzLmNyZWF0ZUltYWdlKGluZnJhLCBkaXN0LCBsb2csIHJlY2lwZS5hcm4sIHVuZGVmaW5lZCk7XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlUGlwZWxpbmUoaW5mcmEsIGRpc3QsIGxvZywgcmVjaXBlLmFybiwgdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYm91bmRBbWkgPSB7XG4gICAgICBsYXVuY2hUZW1wbGF0ZTogbGF1bmNoVGVtcGxhdGUsXG4gICAgICBhcmNoaXRlY3R1cmU6IHRoaXMuYXJjaGl0ZWN0dXJlLFxuICAgICAgb3M6IHRoaXMub3MsXG4gICAgICBsb2dHcm91cDogbG9nLFxuICAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygndW5rbm93bicpLFxuICAgIH07XG5cbiAgICB0aGlzLmFtaUNsZWFuZXIocmVjaXBlLCBzdGFja05hbWUsIGJ1aWxkZXJOYW1lKTtcblxuICAgIHJldHVybiB0aGlzLmJvdW5kQW1pO1xuICB9XG5cbiAgcHJpdmF0ZSBhbWlDbGVhbmVyKHJlY2lwZTogQW1pUmVjaXBlLCBzdGFja05hbWU6IHN0cmluZywgYnVpbGRlck5hbWU6IHN0cmluZykge1xuICAgIC8vIHRoaXMgaXMgaGVyZSB0byBwcm92aWRlIHNhZmUgdXBncmFkZSBmcm9tIG9sZCBjZGstZ2l0aHViLXJ1bm5lcnMgdmVyc2lvbnNcbiAgICAvLyB0aGlzIGxhbWJkYSB3YXMgdXNlZCBieSBhIGN1c3RvbSByZXNvdXJjZSB0byBkZWxldGUgYWxsIGFtaXMgd2hlbiB0aGUgYnVpbGRlciB3YXMgcmVtb3ZlZFxuICAgIC8vIGlmIHdlIHJlbW92ZSB0aGUgY3VzdG9tIHJlc291cmNlLCByb2xlIGFuZCBsYW1iZGEsIGFsbCBhbWlzIHdpbGwgYmUgZGVsZXRlZCBvbiB1cGRhdGVcbiAgICAvLyBrZWVwaW5nIHRoZSBqdXN0IHJvbGUgYnV0IHJlbW92aW5nIHRoZSBwZXJtaXNzaW9ucyBhbG9uZyB3aXRoIHRoZSBjdXN0b20gcmVzb3VyY2Ugd2lsbCBtYWtlIHN1cmUgdGhhdCBkZWxldGlvbiB3aWxsIGZhaWxcbiAgICBjb25zdCBzdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcbiAgICBpZiAoc3RhY2subm9kZS50cnlGaW5kQ2hpbGQoJ2RlbGV0ZS1hbWktZGNjMDM2YzgtODc2Yi00NTFlLWEyYzEtNTUyZjllMDZlOWUxJykgPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCByb2xlID0gbmV3IGlhbS5Sb2xlKHN0YWNrLCAnZGVsZXRlLWFtaS1kY2MwMzZjOC04NzZiLTQ1MWUtYTJjMS01NTJmOWUwNmU5ZTEnLCB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnRW1wdHkgcm9sZSB0byBwcmV2ZW50IGRlbGV0aW9uIG9mIEFNSXMgb24gY2RrLWdpdGh1Yi1ydW5uZXJzIHVwZ3JhZGUnLFxuICAgICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgICAgaW5saW5lUG9saWNpZXM6IHtcbiAgICAgICAgICBkZW55OiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsnZWMyOkRlcmVnaXN0ZXJJbWFnZScsICdlYzI6RGVsZXRlU25hcHNob3QnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5ERU5ZLFxuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGwxcm9sZTogaWFtLkNmblJvbGUgPSByb2xlLm5vZGUuZGVmYXVsdENoaWxkIGFzIGlhbS5DZm5Sb2xlO1xuICAgICAgbDFyb2xlLm92ZXJyaWRlTG9naWNhbElkKCdkZWxldGVhbWlkY2MwMzZjODg3NmI0NTFlYTJjMTU1MmY5ZTA2ZTllMVNlcnZpY2VSb2xlMUNDNThBNkYnKTtcbiAgICB9XG5cbiAgICAvLyBkZWxldGUgb2xkIHZlcnNpb24gb24gdXBkYXRlIGFuZCBvbiBzdGFjayBkZWxldGlvblxuICAgIHRoaXMuaW1hZ2VDbGVhbmVyKCdJbWFnZScsIHJlY2lwZS5uYW1lLnRvTG93ZXJDYXNlKCksIHJlY2lwZS52ZXJzaW9uKTtcblxuICAgIC8vIGRlbGV0ZSBvbGQgQU1JcyArIElCIHJlc291cmNlcyBkYWlseVxuICAgIG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuTGlmZWN5Y2xlUG9saWN5KHRoaXMsICdMaWZlY3ljbGUgUG9saWN5IEFNSScsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICBkZXNjcmlwdGlvbjogYERlbGV0ZSBvbGQgR2l0SHViIFJ1bm5lciBBTUlzIGZvciAke3RoaXMubm9kZS5wYXRofWAsXG4gICAgICBleGVjdXRpb25Sb2xlOiBuZXcgaWFtLlJvbGUodGhpcywgJ0xpZmVjeWNsZSBQb2xpY3kgQU1JIFJvbGUnLCB7XG4gICAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdpbWFnZWJ1aWxkZXIuYW1hem9uYXdzLmNvbScpLFxuICAgICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICAgIGliOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICAgIGFjdGlvbnM6IFsndGFnOkdldFJlc291cmNlcycsICdpbWFnZWJ1aWxkZXI6RGVsZXRlSW1hZ2UnXSxcbiAgICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBJbWFnZSBCdWlsZGVyIGRvZXNuJ3Qgc3VwcG9ydCBzY29waW5nIHRoaXMgOihcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIGFtaTogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgICBhY3Rpb25zOiBbJ2VjMjpEZXNjcmliZUltYWdlcycsICdlYzI6RGVzY3JpYmVJbWFnZUF0dHJpYnV0ZSddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgICAgYWN0aW9uczogWydlYzI6RGVyZWdpc3RlckltYWdlJywgJ2VjMjpEZWxldGVTbmFwc2hvdCddLFxuICAgICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAgICAgICAgICdhd3M6UmVzb3VyY2VUYWcvR2l0SHViUnVubmVyczpTdGFjayc6IHN0YWNrTmFtZSxcbiAgICAgICAgICAgICAgICAgICAgJ2F3czpSZXNvdXJjZVRhZy9HaXRIdWJSdW5uZXJzOkJ1aWxkZXInOiBidWlsZGVyTmFtZSxcbiAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBdLFxuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgfSkucm9sZUFybixcbiAgICAgIHBvbGljeURldGFpbHM6IFt7XG4gICAgICAgIGFjdGlvbjoge1xuICAgICAgICAgIHR5cGU6ICdERUxFVEUnLFxuICAgICAgICAgIGluY2x1ZGVSZXNvdXJjZXM6IHtcbiAgICAgICAgICAgIGFtaXM6IHRydWUsXG4gICAgICAgICAgICBzbmFwc2hvdHM6IHRydWUsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgZmlsdGVyOiB7XG4gICAgICAgICAgdHlwZTogJ0NPVU5UJyxcbiAgICAgICAgICB2YWx1ZTogMixcbiAgICAgICAgfSxcbiAgICAgIH1dLFxuICAgICAgcmVzb3VyY2VUeXBlOiAnQU1JX0lNQUdFJyxcbiAgICAgIHJlc291cmNlU2VsZWN0aW9uOiB7XG4gICAgICAgIHJlY2lwZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBuYW1lOiByZWNpcGUubmFtZSxcbiAgICAgICAgICAgIHNlbWFudGljVmVyc2lvbjogJzEueC54JyxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYmluZENvbXBvbmVudHMoKTogSW1hZ2VCdWlsZGVyQ29tcG9uZW50W10ge1xuICAgIGlmICh0aGlzLmJvdW5kQ29tcG9uZW50cy5sZW5ndGggPT0gMCkge1xuICAgICAgdGhpcy5ib3VuZENvbXBvbmVudHMucHVzaCguLi50aGlzLmNvbXBvbmVudHMubWFwKGMgPT4gYy5fYXNBd3NJbWFnZUJ1aWxkZXJDb21wb25lbnQodGhpcywgdGhpcy5vcywgdGhpcy5hcmNoaXRlY3R1cmUpKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYm91bmRDb21wb25lbnRzO1xuICB9XG5cbiAgcHJpdmF0ZSBpbWFnZUNsZWFuZXIodHlwZTogJ0NvbnRhaW5lcicgfCAnSW1hZ2UnLCByZWNpcGVOYW1lOiBzdHJpbmcsIHZlcnNpb246IHN0cmluZykge1xuICAgIGNvbnN0IGNsZWFuZXJGdW5jdGlvbiA9IHNpbmdsZXRvbkxhbWJkYShEZWxldGVSZXNvdXJjZXNGdW5jdGlvbiwgdGhpcywgJ2F3cy1pbWFnZS1idWlsZGVyLWRlbGV0ZS1yZXNvdXJjZXMnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbSByZXNvdXJjZSBoYW5kbGVyIHRoYXQgZGVsZXRlcyByZXNvdXJjZXMgb2Ygb2xkIHZlcnNpb25zIG9mIEVDMiBJbWFnZSBCdWlsZGVyIGltYWdlcycsXG4gICAgICBpbml0aWFsUG9saWN5OiBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICAnaW1hZ2VidWlsZGVyOkxpc3RJbWFnZUJ1aWxkVmVyc2lvbnMnLFxuICAgICAgICAgICAgJ2ltYWdlYnVpbGRlcjpEZWxldGVJbWFnZScsXG4gICAgICAgICAgXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFsnZWMyOkRlc2NyaWJlSW1hZ2VzJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgfSksXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbJ2VjMjpEZXJlZ2lzdGVySW1hZ2UnLCAnZWMyOkRlbGV0ZVNuYXBzaG90J10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICAgJ2F3czpSZXNvdXJjZVRhZy9HaXRIdWJSdW5uZXJzOlN0YWNrJzogY2RrLlN0YWNrLm9mKHRoaXMpLnN0YWNrTmFtZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSksXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbJ2VjcjpCYXRjaERlbGV0ZUltYWdlJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgfSksXG4gICAgICBdLFxuICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuUlVOTkVSX0lNQUdFX0JVSUxEKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksXG4gICAgfSk7XG5cbiAgICBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgYCR7dHlwZX0gQ2xlYW5lcmAsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogY2xlYW5lckZ1bmN0aW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgcmVzb3VyY2VUeXBlOiAnQ3VzdG9tOjpJbWFnZUJ1aWxkZXItRGVsZXRlLVJlc291cmNlcycsXG4gICAgICBwcm9wZXJ0aWVzOiA8RGVsZXRlUmVzb3VyY2VzUHJvcHM+e1xuICAgICAgICBJbWFnZVZlcnNpb25Bcm46IGNkay5TdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICAgIHNlcnZpY2U6ICdpbWFnZWJ1aWxkZXInLFxuICAgICAgICAgIHJlc291cmNlOiAnaW1hZ2UnLFxuICAgICAgICAgIHJlc291cmNlTmFtZTogYCR7cmVjaXBlTmFtZX0vJHt2ZXJzaW9ufWAsXG4gICAgICAgICAgYXJuRm9ybWF0OiBjZGsuQXJuRm9ybWF0LlNMQVNIX1JFU09VUkNFX05BTUUsXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY2xhc3MgQXdzSW1hZ2VCdWlsZGVyRmFpbGVkQnVpbGROb3RpZmllciBpbXBsZW1lbnRzIGNkay5JQXNwZWN0IHtcbiAgcHVibGljIHN0YXRpYyBjcmVhdGVGaWx0ZXJpbmdUb3BpYyhzY29wZTogQ29uc3RydWN0LCB0YXJnZXRUb3BpYzogc25zLlRvcGljKTogc25zLklUb3BpYyB7XG4gICAgY29uc3QgdG9waWMgPSBuZXcgc25zLlRvcGljKHNjb3BlLCAnSW1hZ2UgQnVpbGRlciBCdWlsZHMnKTtcbiAgICBjb25zdCBmaWx0ZXIgPSBuZXcgRmlsdGVyRmFpbGVkQnVpbGRzRnVuY3Rpb24oc2NvcGUsICdJbWFnZSBCdWlsZGVyIEJ1aWxkcyBGaWx0ZXInLCB7XG4gICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAoc2NvcGUsIFNpbmdsZXRvbkxvZ1R5cGUuUlVOTkVSX0lNQUdFX0JVSUxEKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBUQVJHRVRfVE9QSUNfQVJOOiB0YXJnZXRUb3BpYy50b3BpY0FybixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0b3BpYy5hZGRTdWJzY3JpcHRpb24obmV3IHN1YnMuTGFtYmRhU3Vic2NyaXB0aW9uKGZpbHRlcikpO1xuICAgIHRhcmdldFRvcGljLmdyYW50UHVibGlzaChmaWx0ZXIpO1xuXG4gICAgcmV0dXJuIHRvcGljO1xuICB9XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSB0b3BpYzogc25zLklUb3BpYykge1xuICB9XG5cbiAgcHVibGljIHZpc2l0KG5vZGU6IElDb25zdHJ1Y3QpOiB2b2lkIHtcbiAgICBpZiAobm9kZSBpbnN0YW5jZW9mIEF3c0ltYWdlQnVpbGRlclJ1bm5lckltYWdlQnVpbGRlcikge1xuICAgICAgY29uc3QgYnVpbGRlciA9IG5vZGUgYXMgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyO1xuICAgICAgY29uc3QgaW5mcmFOb2RlID0gYnVpbGRlci5ub2RlLnRyeUZpbmRDaGlsZCgnSW5mcmFzdHJ1Y3R1cmUnKTtcbiAgICAgIGlmIChpbmZyYU5vZGUpIHtcbiAgICAgICAgY29uc3QgaW5mcmEgPSBpbmZyYU5vZGUgYXMgaW1hZ2VidWlsZGVyLkNmbkluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbjtcbiAgICAgICAgaW5mcmEuc25zVG9waWNBcm4gPSB0aGlzLnRvcGljLnRvcGljQXJuO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2RrLkFubm90YXRpb25zLm9mKGJ1aWxkZXIpLmFkZFdhcm5pbmcoJ1VudXNlZCBidWlsZGVyIGNhbm5vdCBnZXQgbm90aWZpY2F0aW9ucyBvZiBmYWlsZWQgYnVpbGRzJyk7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iXX0=