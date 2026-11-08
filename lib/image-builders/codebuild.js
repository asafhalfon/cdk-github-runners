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
exports.CodeBuildImageBuilderFailedBuildNotifier = exports.CodeBuildRunnerImageBuilder = void 0;
const crypto = __importStar(require("node:crypto"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_codebuild_1 = require("aws-cdk-lib/aws-codebuild");
const aws_ecr_1 = require("aws-cdk-lib/aws-ecr");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_image_builder_1 = require("./aws-image-builder");
const build_image_function_1 = require("./build-image-function");
const common_1 = require("./common");
const providers_1 = require("../providers");
const utils_1 = require("../utils");
/**
 * @internal
 */
class CodeBuildRunnerImageBuilder extends common_1.RunnerImageBuilderBase {
    boundDockerImage;
    os;
    architecture;
    baseImage;
    logRetention;
    logRemovalPolicy;
    vpc;
    securityGroups;
    buildImage;
    repository;
    subnetSelection;
    timeout;
    computeType;
    rebuildInterval;
    role;
    waitOnDeploy;
    dockerSetupCommands;
    constructor(scope, id, props) {
        super(scope, id, props);
        if (props?.awsImageBuilderOptions) {
            aws_cdk_lib_1.Annotations.of(this).addWarning('awsImageBuilderOptions are ignored when using CodeBuild runner image builder.');
        }
        this.os = props?.os ?? providers_1.Os.LINUX_UBUNTU;
        this.architecture = props?.architecture ?? providers_1.Architecture.X86_64;
        this.rebuildInterval = props?.rebuildInterval ?? aws_cdk_lib_1.Duration.days(7);
        this.logRetention = props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH;
        this.logRemovalPolicy = props?.logRemovalPolicy ?? aws_cdk_lib_1.RemovalPolicy.DESTROY;
        this.vpc = props?.vpc;
        this.securityGroups = props?.securityGroups;
        this.subnetSelection = props?.subnetSelection;
        this.timeout = props?.codeBuildOptions?.timeout ?? aws_cdk_lib_1.Duration.hours(1);
        this.computeType = props?.codeBuildOptions?.computeType ?? aws_codebuild_1.ComputeType.SMALL;
        this.buildImage = props?.codeBuildOptions?.buildImage ?? this.getDefaultBuildImage();
        this.waitOnDeploy = props?.waitOnDeploy ?? true;
        this.dockerSetupCommands = props?.dockerSetupCommands ?? [];
        // normalize BaseContainerImageInput to BaseContainerImage (string support is deprecated, only at public API level)
        const baseDockerImageInput = props?.baseDockerImage ?? (0, aws_image_builder_1.defaultBaseDockerImage)(this.os);
        this.baseImage = typeof baseDockerImageInput === 'string' ? aws_image_builder_1.BaseContainerImage.fromString(baseDockerImageInput) : baseDockerImageInput;
        // warn if using deprecated string format (only if user explicitly provided it)
        if (props?.baseDockerImage && typeof props.baseDockerImage === 'string') {
            aws_cdk_lib_1.Annotations.of(this).addWarning('Passing baseDockerImage as a string is deprecated. Please use BaseContainerImage static factory methods instead, e.g., BaseContainerImage.fromDockerHub("ubuntu", "22.04") or BaseContainerImage.fromString("public.ecr.aws/lts/ubuntu:22.04")');
        }
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
        // check timeout
        if (this.timeout.toSeconds() > aws_cdk_lib_1.Duration.hours(8).toSeconds()) {
            aws_cdk_lib_1.Annotations.of(this).addError('CodeBuild runner image builder timeout must 8 hours or less.');
        }
        // create service role for CodeBuild
        this.role = new aws_cdk_lib_1.aws_iam.Role(this, 'Role', {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('codebuild.amazonaws.com'),
        });
        // create repository that only keeps one tag
        this.repository = new aws_cdk_lib_1.aws_ecr.Repository(this, 'Repository', {
            imageScanOnPush: true,
            imageTagMutability: aws_ecr_1.TagMutability.MUTABLE,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            lifecycleRules: [
                {
                    description: 'Remove soci indexes for replaced images',
                    tagStatus: aws_ecr_1.TagStatus.TAGGED,
                    tagPrefixList: ['sha256-'],
                    maxImageCount: 1,
                },
                {
                    description: 'Remove untagged images that have been replaced by CodeBuild',
                    tagStatus: aws_ecr_1.TagStatus.UNTAGGED,
                    maxImageAge: aws_cdk_lib_1.Duration.days(1),
                },
            ],
        });
    }
    bindAmi() {
        throw new Error('CodeBuild image builder cannot be used to build AMI');
    }
    bindDockerImage() {
        if (this.boundDockerImage) {
            return this.boundDockerImage;
        }
        // log group for the image builds
        const logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'Logs', {
            retention: this.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
            removalPolicy: this.logRemovalPolicy ?? aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        // generate buildSpec
        const [buildSpec, buildSpecHash] = this.getBuildSpec(this.repository);
        // create CodeBuild project that builds Dockerfile and pushes to repository
        const project = new aws_cdk_lib_1.aws_codebuild.Project(this, 'CodeBuild', {
            description: `Build docker image for self-hosted GitHub runner ${this.node.path} (${this.os.name}/${this.architecture.name})`,
            buildSpec,
            vpc: this.vpc,
            securityGroups: this.securityGroups,
            subnetSelection: this.subnetSelection,
            role: this.role,
            timeout: this.timeout,
            environment: {
                buildImage: this.buildImage,
                computeType: this.computeType,
                privileged: true,
            },
            logging: {
                cloudWatch: {
                    logGroup,
                },
            },
        });
        // permissions
        this.repository.grantPullPush(project);
        // Grant pull permissions for base image ECR repository if applicable
        if (this.baseImage.ecrRepository) {
            this.baseImage.ecrRepository.grantPull(project);
        }
        // call CodeBuild during deployment
        const completedImage = this.customResource(project, buildSpecHash);
        // rebuild image on a schedule
        this.rebuildImageOnSchedule(project, this.rebuildInterval);
        // return the image
        this.boundDockerImage = {
            imageRepository: this.repository,
            imageTag: 'latest',
            architecture: this.architecture,
            os: this.os,
            logGroup,
            runnerVersion: providers_1.RunnerVersion.specific('unknown'),
            _dependable: completedImage,
        };
        return this.boundDockerImage;
    }
    getDefaultBuildImage() {
        if (this.os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
            // CodeBuild just runs `docker build` so its OS doesn't really matter
            if (this.architecture.is(providers_1.Architecture.X86_64)) {
                return aws_cdk_lib_1.aws_codebuild.LinuxBuildImage.AMAZON_LINUX_2_5;
            }
            else if (this.architecture.is(providers_1.Architecture.ARM64)) {
                return aws_cdk_lib_1.aws_codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_3_0;
            }
        }
        if (this.os.is(providers_1.Os.WINDOWS)) {
            throw new Error('CodeBuild cannot be used to build Windows Docker images https://github.com/docker-library/docker/issues/49');
        }
        throw new Error(`Unable to find CodeBuild image for ${this.os.name}/${this.architecture.name}`);
    }
    getDockerfileGenerationCommands() {
        let hashedComponents = [];
        let commands = [];
        let dockerfile = `FROM ${this.baseImage.image}\nVOLUME /var/lib/docker\n`;
        for (let i = 0; i < this.components.length; i++) {
            const componentName = this.components[i].name;
            const safeComponentName = componentName.replace(/[^a-zA-Z0-9-]/g, '_');
            const assetDescriptors = this.components[i].getAssets(this.os, this.architecture);
            for (let j = 0; j < assetDescriptors.length; j++) {
                if (this.os.is(providers_1.Os.WINDOWS)) {
                    throw new Error("Can't add asset as we can't build Windows Docker images on CodeBuild");
                }
                const asset = new aws_cdk_lib_1.aws_s3_assets.Asset(this, `Component ${i} ${componentName} Asset ${j}`, {
                    path: assetDescriptors[j].source,
                });
                if (asset.isFile) {
                    commands.push(`aws s3 cp ${asset.s3ObjectUrl} asset${i}-${safeComponentName}-${j}`);
                }
                else if (asset.isZipArchive) {
                    commands.push(`aws s3 cp ${asset.s3ObjectUrl} asset${i}-${safeComponentName}-${j}.zip`);
                    commands.push(`unzip asset${i}-${safeComponentName}-${j}.zip -d asset${i}-${safeComponentName}-${j}`);
                }
                else {
                    throw new Error(`Unknown asset type: ${asset}`);
                }
                dockerfile += `COPY asset${i}-${safeComponentName}-${j} ${assetDescriptors[j].target}\n`;
                hashedComponents.push(`__ ASSET FILE ${asset.assetHash} ${i}-${componentName}-${j} ${assetDescriptors[j].target}`);
                asset.grantRead(this);
            }
            const componentCommands = this.components[i].getCommands(this.os, this.architecture);
            const script = '#!/bin/bash\nset -exuo pipefail\n' + componentCommands.join('\n');
            commands.push(`cat > component${i}-${safeComponentName}.sh <<'EOFGITHUBRUNNERSDOCKERFILE'\n${script}\nEOFGITHUBRUNNERSDOCKERFILE`);
            commands.push(`chmod +x component${i}-${safeComponentName}.sh`);
            hashedComponents.push(`__ COMMAND ${i} ${componentName} ${script}`);
            dockerfile += `COPY component${i}-${safeComponentName}.sh /tmp\n`;
            dockerfile += `RUN /tmp/component${i}-${safeComponentName}.sh\n`;
            const dockerCommands = this.components[i].getDockerCommands(this.os, this.architecture);
            dockerfile += dockerCommands.join('\n') + '\n';
            hashedComponents.push(`__ DOCKER COMMAND ${i} ${dockerCommands.join('\n')}`);
        }
        commands.push(`cat > Dockerfile <<'EOFGITHUBRUNNERSDOCKERFILE'\n${dockerfile}\nEOFGITHUBRUNNERSDOCKERFILE`);
        return [commands, hashedComponents];
    }
    getBuildSpec(repository) {
        const thisStack = cdk.Stack.of(this);
        let archUrl;
        if (this.architecture.is(providers_1.Architecture.X86_64)) {
            archUrl = 'x86_64';
        }
        else if (this.architecture.is(providers_1.Architecture.ARM64)) {
            archUrl = 'arm64';
        }
        else {
            throw new Error(`Unsupported architecture for required CodeBuild: ${this.architecture.name}`);
        }
        const [commands, commandsHashedComponents] = this.getDockerfileGenerationCommands();
        const buildSpecVersion = 'v2'; // change this every time the build spec changes
        const hashedComponents = commandsHashedComponents.concat(buildSpecVersion, this.architecture.name, this.baseImage.image, this.os.name);
        // hash tokens by their resolved form, not by the `${Token[TOKEN.NN]}` placeholder whose counter changes between synths
        let hashInput = hashedComponents.join('\n');
        if (cdk.Token.isUnresolved(hashInput)) {
            hashInput = JSON.stringify(thisStack.resolve(hashInput));
        }
        const hash = crypto.createHash('md5').update(hashInput).digest('hex').slice(0, 10);
        const buildSpec = aws_cdk_lib_1.aws_codebuild.BuildSpec.fromObject({
            version: 0.2,
            env: {
                variables: {
                    REPO_ARN: repository.repositoryArn,
                    REPO_URI: repository.repositoryUri,
                    WAIT_HANDLE: 'unspecified',
                    BASH_ENV: 'codebuild-log.sh',
                },
                shell: 'bash',
            },
            phases: {
                // we can't use pre_build. the wait handle will never complete if pre_build fails as post_build won't run. this can cause timeouts during deployment.
                build: {
                    commands: [
                        'echo "exec > >(tee -a /tmp/codebuild.log) 2>&1" > codebuild-log.sh',
                        `aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin ${thisStack.account}.dkr.ecr.${thisStack.region}.amazonaws.com`,
                        ...this.dockerSetupCommands,
                        ...commands,
                        'docker build --progress plain . -t "$REPO_URI"',
                        'docker push "$REPO_URI"',
                    ],
                },
                post_build: {
                    commands: [
                        'rm -f codebuild-log.sh && STATUS="SUCCESS"',
                        'if [ $CODEBUILD_BUILD_SUCCEEDING -ne 1 ]; then STATUS="FAILURE"; fi',
                        'cat <<EOF > /tmp/payload.json\n' +
                            '{\n' +
                            '  "Status": "$STATUS",\n' +
                            '  "UniqueId": "build",\n' +
                            // we remove non-printable characters from the log because CloudFormation doesn't like them
                            // https://github.com/aws-cloudformation/cloudformation-coverage-roadmap/issues/1601
                            '  "Reason": `sed \'s/[^[:print:]]//g\' /tmp/codebuild.log | tail -c 400 | jq -Rsa .`,\n' +
                            // for lambda always get a new value because there is always a new image hash
                            '  "Data": "$RANDOM"\n' +
                            '}\n' +
                            'EOF',
                        'if [ "$WAIT_HANDLE" != "unspecified" ]; then jq . /tmp/payload.json; curl --retry 5 --retry-delay 30 --retry-all-errors -fsSL -X PUT -H "Content-Type:" -d "@/tmp/payload.json" "$WAIT_HANDLE"; fi',
                        // generate and push soci index
                        // we do this after finishing the build, so we don't have to wait. it's also not required, so it's ok if it fails
                        'if ! SOCI_LABEL=`docker inspect --format=\'{{json .Config.Labels.DISABLE_SOCI}}\' "$REPO_URI" 2>/dev/null`; then\n' +
                            'echo "Skipping soci index: no image to index, the build never produced $REPO_URI"\n' +
                            'elif [ "$SOCI_LABEL" = "null" ]; then\n' +
                            'docker rmi "$REPO_URI"\n' + // it downloads the image again to /tmp, so save on space
                            'LATEST_SOCI_VERSION=`curl --retry 5 --retry-delay 30 --retry-all-errors -fsSL -o /dev/null -w "%{url_effective}" https://github.com/CloudSnorkel/standalone-soci-indexer/releases/latest | grep -oE "[^/]+$"`\n' +
                            `curl --retry 5 --retry-delay 30 --retry-all-errors -fsSL https://github.com/CloudSnorkel/standalone-soci-indexer/releases/download/$\{LATEST_SOCI_VERSION}/standalone-soci-indexer_Linux_${archUrl}.tar.gz | tar xz\n` +
                            './standalone-soci-indexer "$REPO_URI"\n' +
                            'fi',
                    ],
                },
            },
        });
        return [buildSpec, hash];
    }
    customResource(project, buildSpecHash) {
        const crHandler = (0, utils_1.singletonLambda)(build_image_function_1.BuildImageFunction, this, 'build-image', {
            description: 'Custom resource handler that triggers CodeBuild to build runner images',
            timeout: cdk.Duration.minutes(3),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.RUNNER_IMAGE_BUILD),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
        });
        const startBuildPolicy = crHandler.role.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['codebuild:StartBuild'],
            resources: [project.projectArn],
        }));
        let waitHandleRef = 'unspecified';
        let waitDependable;
        if (this.waitOnDeploy) {
            // Wait handle lets us wait for longer than an hour for the image build to complete.
            // We generate a new wait handle for build spec changes to guarantee a new image is built.
            // This also helps make sure the changes are good. If they have a bug, the deployment will fail instead of just the scheduled build.
            // Finally, it's recommended by CloudFormation docs to not reuse wait handles or old responses may interfere in some cases.
            const handle = new aws_cdk_lib_1.aws_cloudformation.CfnWaitConditionHandle(this, `Build Wait Handle ${buildSpecHash}`);
            const wait = new aws_cdk_lib_1.aws_cloudformation.CfnWaitCondition(this, `Build Wait ${buildSpecHash}`, {
                handle: handle.ref,
                timeout: this.timeout.toSeconds().toString(), // don't wait longer than the build timeout
                count: 1,
            });
            waitHandleRef = handle.ref;
            waitDependable = wait;
        }
        const cr = new aws_cdk_lib_1.CustomResource(this, 'Builder', {
            serviceToken: crHandler.functionArn,
            resourceType: 'Custom::ImageBuilder',
            properties: {
                RepoName: this.repository.repositoryName,
                ProjectName: project.projectName,
                WaitHandle: waitHandleRef,
            },
        });
        // add dependencies to make sure resources are there when we need them
        cr.node.addDependency(project);
        cr.node.addDependency(this.role);
        cr.node.addDependency(startBuildPolicy.policyDependable);
        cr.node.addDependency(crHandler.role);
        cr.node.addDependency(crHandler);
        return waitDependable; // user needs to wait on the wait condition which is signaled when the image is built
    }
    rebuildImageOnSchedule(project, rebuildInterval) {
        rebuildInterval = rebuildInterval ?? aws_cdk_lib_1.Duration.days(7);
        if (rebuildInterval.toMilliseconds() != 0) {
            const scheduleRule = new aws_cdk_lib_1.aws_events.Rule(this, 'Build Schedule', {
                description: `Rebuild runner image for ${this.repository.repositoryName}`,
                schedule: aws_cdk_lib_1.aws_events.Schedule.rate(rebuildInterval),
            });
            scheduleRule.addTarget(new aws_cdk_lib_1.aws_events_targets.CodeBuildProject(project, {
                // all image builders in the stack share one role, so we don't create a role and a policy per builder
                eventRole: (0, utils_1.singletonRole)(this, 'Build Schedule Role', new aws_cdk_lib_1.aws_iam.ServicePrincipal('events.amazonaws.com')),
            }));
        }
    }
    get connections() {
        return new aws_cdk_lib_1.aws_ec2.Connections({
            securityGroups: this.securityGroups,
        });
    }
    get grantPrincipal() {
        return this.role;
    }
}
exports.CodeBuildRunnerImageBuilder = CodeBuildRunnerImageBuilder;
/**
 * @internal
 */
class CodeBuildImageBuilderFailedBuildNotifier {
    topic;
    constructor(topic) {
        this.topic = topic;
    }
    visit(node) {
        if (node instanceof CodeBuildRunnerImageBuilder) {
            const builder = node;
            const projectNode = builder.node.tryFindChild('CodeBuild');
            if (projectNode) {
                const project = projectNode;
                project.notifyOnBuildFailed('BuildFailed', this.topic);
            }
            else {
                cdk.Annotations.of(builder).addWarning('Unused builder cannot get notifications of failed builds');
            }
        }
    }
}
exports.CodeBuildImageBuilderFailedBuildNotifier = CodeBuildImageBuilderFailedBuildNotifier;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWJ1aWxkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2NvZGVidWlsZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxvREFBc0M7QUFDdEMsaURBQW1DO0FBQ25DLDZDQWdCcUI7QUFDckIsNkRBQXdEO0FBQ3hELGlEQUErRDtBQUMvRCxtREFBcUQ7QUFFckQsMkRBQWlGO0FBQ2pGLGlFQUE0RDtBQUU1RCxxQ0FBMkU7QUFDM0UsNENBQXVGO0FBQ3ZGLG9DQUErRjtBQXlDL0Y7O0dBRUc7QUFDSCxNQUFhLDJCQUE0QixTQUFRLCtCQUFzQjtJQUM3RCxnQkFBZ0IsQ0FBZTtJQUN0QixFQUFFLENBQUs7SUFDUCxZQUFZLENBQWU7SUFDM0IsU0FBUyxDQUFxQjtJQUM5QixZQUFZLENBQWdCO0lBQzVCLGdCQUFnQixDQUFnQjtJQUNoQyxHQUFHLENBQXVCO0lBQzFCLGNBQWMsQ0FBbUM7SUFDakQsVUFBVSxDQUF3QjtJQUNsQyxVQUFVLENBQWlCO0lBQzNCLGVBQWUsQ0FBa0M7SUFDakQsT0FBTyxDQUFlO0lBQ3RCLFdBQVcsQ0FBd0I7SUFDbkMsZUFBZSxDQUFlO0lBQzlCLElBQUksQ0FBVztJQUNmLFlBQVksQ0FBVTtJQUN0QixtQkFBbUIsQ0FBVztJQUUvQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3ZFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLElBQUksS0FBSyxFQUFFLHNCQUFzQixFQUFFLENBQUM7WUFDbEMseUJBQVcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxDQUFDLCtFQUErRSxDQUFDLENBQUM7UUFDbkgsQ0FBQztRQUVELElBQUksQ0FBQyxFQUFFLEdBQUcsS0FBSyxFQUFFLEVBQUUsSUFBSSxjQUFFLENBQUMsWUFBWSxDQUFDO1FBQ3ZDLElBQUksQ0FBQyxZQUFZLEdBQUcsS0FBSyxFQUFFLFlBQVksSUFBSSx3QkFBWSxDQUFDLE1BQU0sQ0FBQztRQUMvRCxJQUFJLENBQUMsZUFBZSxHQUFHLEtBQUssRUFBRSxlQUFlLElBQUksc0JBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDbEUsSUFBSSxDQUFDLFlBQVksR0FBRyxLQUFLLEVBQUUsWUFBWSxJQUFJLHdCQUFhLENBQUMsU0FBUyxDQUFDO1FBQ25FLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxLQUFLLEVBQUUsZ0JBQWdCLElBQUksMkJBQWEsQ0FBQyxPQUFPLENBQUM7UUFDekUsSUFBSSxDQUFDLEdBQUcsR0FBRyxLQUFLLEVBQUUsR0FBRyxDQUFDO1FBQ3RCLElBQUksQ0FBQyxjQUFjLEdBQUcsS0FBSyxFQUFFLGNBQWMsQ0FBQztRQUM1QyxJQUFJLENBQUMsZUFBZSxHQUFHLEtBQUssRUFBRSxlQUFlLENBQUM7UUFDOUMsSUFBSSxDQUFDLE9BQU8sR0FBRyxLQUFLLEVBQUUsZ0JBQWdCLEVBQUUsT0FBTyxJQUFJLHNCQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3JFLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxFQUFFLGdCQUFnQixFQUFFLFdBQVcsSUFBSSwyQkFBVyxDQUFDLEtBQUssQ0FBQztRQUM3RSxJQUFJLENBQUMsVUFBVSxHQUFHLEtBQUssRUFBRSxnQkFBZ0IsRUFBRSxVQUFVLElBQUksSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7UUFDckYsSUFBSSxDQUFDLFlBQVksR0FBRyxLQUFLLEVBQUUsWUFBWSxJQUFJLElBQUksQ0FBQztRQUNoRCxJQUFJLENBQUMsbUJBQW1CLEdBQUcsS0FBSyxFQUFFLG1CQUFtQixJQUFJLEVBQUUsQ0FBQztRQUU1RCxtSEFBbUg7UUFDbkgsTUFBTSxvQkFBb0IsR0FBRyxLQUFLLEVBQUUsZUFBZSxJQUFJLElBQUEsMENBQXNCLEVBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZGLElBQUksQ0FBQyxTQUFTLEdBQUcsT0FBTyxvQkFBb0IsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLHNDQUFrQixDQUFDLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQztRQUV2SSwrRUFBK0U7UUFDL0UsSUFBSSxLQUFLLEVBQUUsZUFBZSxJQUFJLE9BQU8sS0FBSyxDQUFDLGVBQWUsS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN4RSx5QkFBVyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQzdCLGdQQUFnUCxDQUNqUCxDQUFDO1FBQ0osQ0FBQztRQUVELGlDQUFpQztRQUNqQyxJQUFJLEtBQUssRUFBRSxlQUFlLEVBQUUsVUFBVSxJQUFJLHFCQUFHLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDMUUseUJBQVcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxDQUFDLDhGQUE4RjtnQkFDNUgsMkRBQTJELENBQUMsQ0FBQztRQUNqRSxDQUFDO1FBRUQsMkRBQTJEO1FBQzNELElBQUksS0FBSyxFQUFFLGVBQWUsRUFBRSxVQUFVLElBQUkscUJBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDaEUseUJBQVcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLDRFQUE0RTtnQkFDeEcscUdBQXFHLENBQUMsQ0FBQztRQUMzRyxDQUFDO1FBRUQsZ0JBQWdCO1FBQ2hCLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsR0FBRyxzQkFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDO1lBQzdELHlCQUFXLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyw4REFBOEQsQ0FBQyxDQUFDO1FBQ2hHLENBQUM7UUFFRCxvQ0FBb0M7UUFDcEMsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLHFCQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUU7WUFDckMsU0FBUyxFQUFFLElBQUkscUJBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyx5QkFBeUIsQ0FBQztTQUMvRCxDQUFDLENBQUM7UUFFSCw0Q0FBNEM7UUFDNUMsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLHFCQUFHLENBQUMsVUFBVSxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUU7WUFDdkQsZUFBZSxFQUFFLElBQUk7WUFDckIsa0JBQWtCLEVBQUUsdUJBQWEsQ0FBQyxPQUFPO1lBQ3pDLGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87WUFDcEMsYUFBYSxFQUFFLElBQUk7WUFDbkIsY0FBYyxFQUFFO2dCQUNkO29CQUNFLFdBQVcsRUFBRSx5Q0FBeUM7b0JBQ3RELFNBQVMsRUFBRSxtQkFBUyxDQUFDLE1BQU07b0JBQzNCLGFBQWEsRUFBRSxDQUFDLFNBQVMsQ0FBQztvQkFDMUIsYUFBYSxFQUFFLENBQUM7aUJBQ2pCO2dCQUNEO29CQUNFLFdBQVcsRUFBRSw2REFBNkQ7b0JBQzFFLFNBQVMsRUFBRSxtQkFBUyxDQUFDLFFBQVE7b0JBQzdCLFdBQVcsRUFBRSxzQkFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7aUJBQzlCO2FBQ0Y7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRUQsT0FBTztRQUNMLE1BQU0sSUFBSSxLQUFLLENBQUMscURBQXFELENBQUMsQ0FBQztJQUN6RSxDQUFDO0lBRUQsZUFBZTtRQUNiLElBQUksSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDMUIsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUM7UUFDL0IsQ0FBQztRQUVELGlDQUFpQztRQUNqQyxNQUFNLFFBQVEsR0FBRyxJQUFJLHNCQUFJLENBQUMsUUFBUSxDQUNoQyxJQUFJLEVBQ0osTUFBTSxFQUNOO1lBQ0UsU0FBUyxFQUFFLElBQUksQ0FBQyxZQUFZLElBQUksd0JBQWEsQ0FBQyxTQUFTO1lBQ3ZELGFBQWEsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLElBQUksMkJBQWEsQ0FBQyxPQUFPO1NBQzlELENBQ0YsQ0FBQztRQUVGLHFCQUFxQjtRQUNyQixNQUFNLENBQUMsU0FBUyxFQUFFLGFBQWEsQ0FBQyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBRXRFLDJFQUEyRTtRQUMzRSxNQUFNLE9BQU8sR0FBRyxJQUFJLDJCQUFTLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7WUFDdkQsV0FBVyxFQUFFLG9EQUFvRCxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksR0FBRztZQUM3SCxTQUFTO1lBQ1QsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHO1lBQ2IsY0FBYyxFQUFFLElBQUksQ0FBQyxjQUFjO1lBQ25DLGVBQWUsRUFBRSxJQUFJLENBQUMsZUFBZTtZQUNyQyxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDZixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsV0FBVyxFQUFFO2dCQUNYLFVBQVUsRUFBRSxJQUFJLENBQUMsVUFBVTtnQkFDM0IsV0FBVyxFQUFFLElBQUksQ0FBQyxXQUFXO2dCQUM3QixVQUFVLEVBQUUsSUFBSTthQUNqQjtZQUNELE9BQU8sRUFBRTtnQkFDUCxVQUFVLEVBQUU7b0JBQ1YsUUFBUTtpQkFDVDthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsY0FBYztRQUNkLElBQUksQ0FBQyxVQUFVLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBRXZDLHFFQUFxRTtRQUNyRSxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsYUFBYSxFQUFFLENBQUM7WUFDakMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ2xELENBQUM7UUFFRCxtQ0FBbUM7UUFDbkMsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLEVBQUUsYUFBYSxDQUFDLENBQUM7UUFFbkUsOEJBQThCO1FBQzlCLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLGVBQWUsQ0FBQyxDQUFDO1FBRTNELG1CQUFtQjtRQUNuQixJQUFJLENBQUMsZ0JBQWdCLEdBQUc7WUFDdEIsZUFBZSxFQUFFLElBQUksQ0FBQyxVQUFVO1lBQ2hDLFFBQVEsRUFBRSxRQUFRO1lBQ2xCLFlBQVksRUFBRSxJQUFJLENBQUMsWUFBWTtZQUMvQixFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUU7WUFDWCxRQUFRO1lBQ1IsYUFBYSxFQUFFLHlCQUFhLENBQUMsUUFBUSxDQUFDLFNBQVMsQ0FBQztZQUNoRCxXQUFXLEVBQUUsY0FBYztTQUM1QixDQUFDO1FBQ0YsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUM7SUFDL0IsQ0FBQztJQUVPLG9CQUFvQjtRQUMxQixJQUFJLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLGNBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLENBQUM7WUFDekMscUVBQXFFO1lBQ3JFLElBQUksSUFBSSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMsd0JBQVksQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDO2dCQUM5QyxPQUFPLDJCQUFTLENBQUMsZUFBZSxDQUFDLGdCQUFnQixDQUFDO1lBQ3BELENBQUM7aUJBQU0sSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLEVBQUUsQ0FBQyx3QkFBWSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3BELE9BQU8sMkJBQVMsQ0FBQyxrQkFBa0IsQ0FBQywyQkFBMkIsQ0FBQztZQUNsRSxDQUFDO1FBQ0gsQ0FBQztRQUNELElBQUksSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsY0FBRSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDM0IsTUFBTSxJQUFJLEtBQUssQ0FBQyw0R0FBNEcsQ0FBQyxDQUFDO1FBQ2hJLENBQUM7UUFFRCxNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7SUFDbEcsQ0FBQztJQUVPLCtCQUErQjtRQUNyQyxJQUFJLGdCQUFnQixHQUFhLEVBQUUsQ0FBQztRQUNwQyxJQUFJLFFBQVEsR0FBRyxFQUFFLENBQUM7UUFDbEIsSUFBSSxVQUFVLEdBQUcsUUFBUSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssNEJBQTRCLENBQUM7UUFFMUUsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDaEQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUM7WUFDOUMsTUFBTSxpQkFBaUIsR0FBRyxhQUFhLENBQUMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQ3ZFLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFFbEYsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO2dCQUNqRCxJQUFJLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLGNBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO29CQUMzQixNQUFNLElBQUksS0FBSyxDQUFDLHNFQUFzRSxDQUFDLENBQUM7Z0JBQzFGLENBQUM7Z0JBRUQsTUFBTSxLQUFLLEdBQUcsSUFBSSwyQkFBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsYUFBYSxDQUFDLElBQUksYUFBYSxVQUFVLENBQUMsRUFBRSxFQUFFO29CQUNwRixJQUFJLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTTtpQkFDakMsQ0FBQyxDQUFDO2dCQUVILElBQUksS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO29CQUNqQixRQUFRLENBQUMsSUFBSSxDQUFDLGFBQWEsS0FBSyxDQUFDLFdBQVcsU0FBUyxDQUFDLElBQUksaUJBQWlCLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztnQkFDdEYsQ0FBQztxQkFBTSxJQUFJLEtBQUssQ0FBQyxZQUFZLEVBQUUsQ0FBQztvQkFDOUIsUUFBUSxDQUFDLElBQUksQ0FBQyxhQUFhLEtBQUssQ0FBQyxXQUFXLFNBQVMsQ0FBQyxJQUFJLGlCQUFpQixJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7b0JBQ3hGLFFBQVEsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksaUJBQWlCLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLGlCQUFpQixJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ3hHLENBQUM7cUJBQU0sQ0FBQztvQkFDTixNQUFNLElBQUksS0FBSyxDQUFDLHVCQUF1QixLQUFLLEVBQUUsQ0FBQyxDQUFDO2dCQUNsRCxDQUFDO2dCQUVELFVBQVUsSUFBSSxhQUFhLENBQUMsSUFBSSxpQkFBaUIsSUFBSSxDQUFDLElBQUksZ0JBQWdCLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUM7Z0JBQ3pGLGdCQUFnQixDQUFDLElBQUksQ0FBQyxpQkFBaUIsS0FBSyxDQUFDLFNBQVMsSUFBSSxDQUFDLElBQUksYUFBYSxJQUFJLENBQUMsSUFBSSxnQkFBZ0IsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO2dCQUVuSCxLQUFLLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3hCLENBQUM7WUFFRCxNQUFNLGlCQUFpQixHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQ3JGLE1BQU0sTUFBTSxHQUFHLG1DQUFtQyxHQUFHLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUNsRixRQUFRLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksaUJBQWlCLHVDQUF1QyxNQUFNLDhCQUE4QixDQUFDLENBQUM7WUFDbkksUUFBUSxDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLGlCQUFpQixLQUFLLENBQUMsQ0FBQztZQUNoRSxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksYUFBYSxJQUFJLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFDcEUsVUFBVSxJQUFJLGlCQUFpQixDQUFDLElBQUksaUJBQWlCLFlBQVksQ0FBQztZQUNsRSxVQUFVLElBQUkscUJBQXFCLENBQUMsSUFBSSxpQkFBaUIsT0FBTyxDQUFDO1lBRWpFLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUM7WUFDeEYsVUFBVSxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSSxDQUFDO1lBQy9DLGdCQUFnQixDQUFDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQy9FLENBQUM7UUFFRCxRQUFRLENBQUMsSUFBSSxDQUFDLG9EQUFvRCxVQUFVLDhCQUE4QixDQUFDLENBQUM7UUFFNUcsT0FBTyxDQUFDLFFBQVEsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO0lBQ3RDLENBQUM7SUFFTyxZQUFZLENBQUMsVUFBMEI7UUFDN0MsTUFBTSxTQUFTLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFckMsSUFBSSxPQUFPLENBQUM7UUFDWixJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLHdCQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUM5QyxPQUFPLEdBQUcsUUFBUSxDQUFDO1FBQ3JCLENBQUM7YUFBTSxJQUFJLElBQUksQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLHdCQUFZLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNwRCxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3BCLENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQyxvREFBb0QsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ2hHLENBQUM7UUFFRCxNQUFNLENBQUMsUUFBUSxFQUFFLHdCQUF3QixDQUFDLEdBQUcsSUFBSSxDQUFDLCtCQUErQixFQUFFLENBQUM7UUFFcEYsTUFBTSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsQ0FBQyxnREFBZ0Q7UUFDL0UsTUFBTSxnQkFBZ0IsR0FBRyx3QkFBd0IsQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN2SSx1SEFBdUg7UUFDdkgsSUFBSSxTQUFTLEdBQUcsZ0JBQWdCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQzVDLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQztZQUN0QyxTQUFTLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUM7UUFDM0QsQ0FBQztRQUNELE1BQU0sSUFBSSxHQUFHLE1BQU0sQ0FBQyxVQUFVLENBQUMsS0FBSyxDQUFDLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRW5GLE1BQU0sU0FBUyxHQUFHLDJCQUFTLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQztZQUMvQyxPQUFPLEVBQUUsR0FBRztZQUNaLEdBQUcsRUFBRTtnQkFDSCxTQUFTLEVBQUU7b0JBQ1QsUUFBUSxFQUFFLFVBQVUsQ0FBQyxhQUFhO29CQUNsQyxRQUFRLEVBQUUsVUFBVSxDQUFDLGFBQWE7b0JBQ2xDLFdBQVcsRUFBRSxhQUFhO29CQUMxQixRQUFRLEVBQUUsa0JBQWtCO2lCQUM3QjtnQkFDRCxLQUFLLEVBQUUsTUFBTTthQUNkO1lBQ0QsTUFBTSxFQUFFO2dCQUNOLHFKQUFxSjtnQkFDckosS0FBSyxFQUFFO29CQUNMLFFBQVEsRUFBRTt3QkFDUixvRUFBb0U7d0JBQ3BFLDRHQUE0RyxTQUFTLENBQUMsT0FBTyxZQUFZLFNBQVMsQ0FBQyxNQUFNLGdCQUFnQjt3QkFDekssR0FBRyxJQUFJLENBQUMsbUJBQW1CO3dCQUMzQixHQUFHLFFBQVE7d0JBQ1gsZ0RBQWdEO3dCQUNoRCx5QkFBeUI7cUJBQzFCO2lCQUNGO2dCQUNELFVBQVUsRUFBRTtvQkFDVixRQUFRLEVBQUU7d0JBQ1IsNENBQTRDO3dCQUM1QyxxRUFBcUU7d0JBQ3JFLGlDQUFpQzs0QkFDakMsS0FBSzs0QkFDTCwwQkFBMEI7NEJBQzFCLDBCQUEwQjs0QkFDMUIsMkZBQTJGOzRCQUMzRixvRkFBb0Y7NEJBQ3BGLHlGQUF5Rjs0QkFDekYsNkVBQTZFOzRCQUM3RSx1QkFBdUI7NEJBQ3ZCLEtBQUs7NEJBQ0wsS0FBSzt3QkFDTCxvTUFBb007d0JBQ3BNLCtCQUErQjt3QkFDL0IsaUhBQWlIO3dCQUNqSCxvSEFBb0g7NEJBQ3BILHFGQUFxRjs0QkFDckYseUNBQXlDOzRCQUN6QywwQkFBMEIsR0FBRyx5REFBeUQ7NEJBQ3RGLGlOQUFpTjs0QkFDak4sNExBQTRMLE9BQU8sb0JBQW9COzRCQUN2Tix5Q0FBeUM7NEJBQ3pDLElBQUk7cUJBQ0w7aUJBQ0Y7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILE9BQU8sQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDM0IsQ0FBQztJQUVPLGNBQWMsQ0FBQyxPQUEwQixFQUFFLGFBQXFCO1FBQ3RFLE1BQU0sU0FBUyxHQUFHLElBQUEsdUJBQWUsRUFBQyx5Q0FBa0IsRUFBRSxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3pFLFdBQVcsRUFBRSx3RUFBd0U7WUFDckYsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztZQUNoQyxRQUFRLEVBQUUsSUFBQSx5QkFBaUIsRUFBQyxJQUFJLEVBQUUsd0JBQWdCLENBQUMsa0JBQWtCLENBQUM7WUFDdEUsYUFBYSxFQUFFLHdCQUFNLENBQUMsYUFBYSxDQUFDLElBQUk7U0FDekMsQ0FBQyxDQUFDO1FBRUgsTUFBTSxnQkFBZ0IsR0FBRyxTQUFTLENBQUMsSUFBSyxDQUFDLG9CQUFvQixDQUFDLElBQUkscUJBQUcsQ0FBQyxlQUFlLENBQUM7WUFDcEYsT0FBTyxFQUFFLENBQUMsc0JBQXNCLENBQUM7WUFDakMsU0FBUyxFQUFFLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQztTQUNoQyxDQUFDLENBQUMsQ0FBQztRQUVKLElBQUksYUFBYSxHQUFHLGFBQWEsQ0FBQztRQUNsQyxJQUFJLGNBQTJELENBQUM7UUFFaEUsSUFBSSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDdEIsb0ZBQW9GO1lBQ3BGLDBGQUEwRjtZQUMxRixvSUFBb0k7WUFDcEksMkhBQTJIO1lBQzNILE1BQU0sTUFBTSxHQUFHLElBQUksZ0NBQWMsQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLEVBQUUscUJBQXFCLGFBQWEsRUFBRSxDQUFDLENBQUM7WUFDckcsTUFBTSxJQUFJLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxjQUFjLGFBQWEsRUFBRSxFQUFFO2dCQUNwRixNQUFNLEVBQUUsTUFBTSxDQUFDLEdBQUc7Z0JBQ2xCLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxDQUFDLFFBQVEsRUFBRSxFQUFFLDJDQUEyQztnQkFDekYsS0FBSyxFQUFFLENBQUM7YUFDVCxDQUFDLENBQUM7WUFDSCxhQUFhLEdBQUcsTUFBTSxDQUFDLEdBQUcsQ0FBQztZQUMzQixjQUFjLEdBQUcsSUFBSSxDQUFDO1FBQ3hCLENBQUM7UUFFRCxNQUFNLEVBQUUsR0FBRyxJQUFJLDRCQUFjLENBQUMsSUFBSSxFQUFFLFNBQVMsRUFBRTtZQUM3QyxZQUFZLEVBQUUsU0FBUyxDQUFDLFdBQVc7WUFDbkMsWUFBWSxFQUFFLHNCQUFzQjtZQUNwQyxVQUFVLEVBQWdDO2dCQUN4QyxRQUFRLEVBQUUsSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjO2dCQUN4QyxXQUFXLEVBQUUsT0FBTyxDQUFDLFdBQVc7Z0JBQ2hDLFVBQVUsRUFBRSxhQUFhO2FBQzFCO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsc0VBQXNFO1FBQ3RFLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQy9CLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNqQyxFQUFFLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxnQkFBaUIsQ0FBQyxDQUFDO1FBQzFELEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FBQyxJQUFLLENBQUMsQ0FBQztRQUN2QyxFQUFFLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUVqQyxPQUFPLGNBQWMsQ0FBQyxDQUFDLHFGQUFxRjtJQUM5RyxDQUFDO0lBRU8sc0JBQXNCLENBQUMsT0FBMEIsRUFBRSxlQUEwQjtRQUNuRixlQUFlLEdBQUcsZUFBZSxJQUFJLHNCQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3RELElBQUksZUFBZSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQzFDLE1BQU0sWUFBWSxHQUFHLElBQUksd0JBQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO2dCQUMzRCxXQUFXLEVBQUUsNEJBQTRCLElBQUksQ0FBQyxVQUFVLENBQUMsY0FBYyxFQUFFO2dCQUN6RSxRQUFRLEVBQUUsd0JBQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLGVBQWUsQ0FBQzthQUNoRCxDQUFDLENBQUM7WUFDSCxZQUFZLENBQUMsU0FBUyxDQUFDLElBQUksZ0NBQWMsQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFPLEVBQUU7Z0JBQ2xFLHFHQUFxRztnQkFDckcsU0FBUyxFQUFFLElBQUEscUJBQWEsRUFBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUUsSUFBSSxxQkFBRyxDQUFDLGdCQUFnQixDQUFDLHNCQUFzQixDQUFDLENBQUM7YUFDeEcsQ0FBQyxDQUFDLENBQUM7UUFDTixDQUFDO0lBQ0gsQ0FBQztJQUVELElBQUksV0FBVztRQUNiLE9BQU8sSUFBSSxxQkFBRyxDQUFDLFdBQVcsQ0FBQztZQUN6QixjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWM7U0FDcEMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELElBQUksY0FBYztRQUNoQixPQUFPLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDbkIsQ0FBQztDQUNGO0FBbllELGtFQW1ZQztBQUVEOztHQUVHO0FBQ0gsTUFBYSx3Q0FBd0M7SUFDL0I7SUFBcEIsWUFBb0IsS0FBaUI7UUFBakIsVUFBSyxHQUFMLEtBQUssQ0FBWTtJQUNyQyxDQUFDO0lBRU0sS0FBSyxDQUFDLElBQWdCO1FBQzNCLElBQUksSUFBSSxZQUFZLDJCQUEyQixFQUFFLENBQUM7WUFDaEQsTUFBTSxPQUFPLEdBQUcsSUFBbUMsQ0FBQztZQUNwRCxNQUFNLFdBQVcsR0FBRyxPQUFPLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUMzRCxJQUFJLFdBQVcsRUFBRSxDQUFDO2dCQUNoQixNQUFNLE9BQU8sR0FBRyxXQUFnQyxDQUFDO2dCQUNqRCxPQUFPLENBQUMsbUJBQW1CLENBQUMsYUFBYSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUN6RCxDQUFDO2lCQUFNLENBQUM7Z0JBQ04sR0FBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsVUFBVSxDQUFDLDBEQUEwRCxDQUFDLENBQUM7WUFDckcsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFoQkQsNEZBZ0JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ25vZGU6Y3J5cHRvJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBBbm5vdGF0aW9ucyxcbiAgYXdzX2Nsb3VkZm9ybWF0aW9uIGFzIGNsb3VkZm9ybWF0aW9uLFxuICBhd3NfY29kZWJ1aWxkIGFzIGNvZGVidWlsZCxcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19lY3IgYXMgZWNyLFxuICBhd3NfZXZlbnRzIGFzIGV2ZW50cyxcbiAgYXdzX2V2ZW50c190YXJnZXRzIGFzIGV2ZW50c190YXJnZXRzLFxuICBhd3NfaWFtIGFzIGlhbSxcbiAgYXdzX2xhbWJkYSBhcyBsYW1iZGEsXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zM19hc3NldHMgYXMgczNfYXNzZXRzLFxuICBhd3Nfc25zIGFzIHNucyxcbiAgQ3VzdG9tUmVzb3VyY2UsXG4gIER1cmF0aW9uLFxuICBSZW1vdmFsUG9saWN5LFxufSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb21wdXRlVHlwZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlYnVpbGQnO1xuaW1wb3J0IHsgVGFnTXV0YWJpbGl0eSwgVGFnU3RhdHVzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgQ29uc3RydWN0LCBJQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBCYXNlQ29udGFpbmVySW1hZ2UsIGRlZmF1bHRCYXNlRG9ja2VySW1hZ2UgfSBmcm9tICcuL2F3cy1pbWFnZS1idWlsZGVyJztcbmltcG9ydCB7IEJ1aWxkSW1hZ2VGdW5jdGlvbiB9IGZyb20gJy4vYnVpbGQtaW1hZ2UtZnVuY3Rpb24nO1xuaW1wb3J0IHsgQnVpbGRJbWFnZUZ1bmN0aW9uUHJvcGVydGllcyB9IGZyb20gJy4vYnVpbGQtaW1hZ2UubGFtYmRhJztcbmltcG9ydCB7IFJ1bm5lckltYWdlQnVpbGRlckJhc2UsIFJ1bm5lckltYWdlQnVpbGRlclByb3BzIH0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBPcywgUnVubmVyQW1pLCBSdW5uZXJJbWFnZSwgUnVubmVyVmVyc2lvbiB9IGZyb20gJy4uL3Byb3ZpZGVycyc7XG5pbXBvcnQgeyBzaW5nbGV0b25MYW1iZGEsIHNpbmdsZXRvbkxvZ0dyb3VwLCBTaW5nbGV0b25Mb2dUeXBlLCBzaW5nbGV0b25Sb2xlIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZUJ1aWxkUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMge1xuICAvKipcbiAgICogVGhlIHR5cGUgb2YgY29tcHV0ZSB0byB1c2UgZm9yIHRoaXMgYnVpbGQuXG4gICAqIFNlZSB0aGUge0BsaW5rIENvbXB1dGVUeXBlfSBlbnVtIGZvciB0aGUgcG9zc2libGUgdmFsdWVzLlxuICAgKlxuICAgKiBUaGUgY29tcHV0ZSB0eXBlIGRldGVybWluZXMgQ1BVLCBtZW1vcnksIGFuZCBkaXNrIHNwYWNlOlxuICAgKiAtIFNNQUxMOiAyIHZDUFUsIDMgR0IgUkFNLCA2NCBHQiBkaXNrXG4gICAqIC0gTUVESVVNOiA0IHZDUFUsIDcgR0IgUkFNLCAxMjggR0IgZGlza1xuICAgKiAtIExBUkdFOiA4IHZDUFUsIDE1IEdCIFJBTSwgMTI4IEdCIGRpc2tcbiAgICogLSBYMl9MQVJHRTogNzIgdkNQVSwgMTQ1IEdCIFJBTSwgMjU2IEdCIGRpc2sgKExpbnV4KSBvciA4MjQgR0IgZGlzayAoV2luZG93cylcbiAgICpcbiAgICogVXNlIGEgbGFyZ2VyIGNvbXB1dGUgdHlwZSB3aGVuIHlvdSBuZWVkIG1vcmUgZGlzayBzcGFjZSBmb3IgYnVpbGRpbmcgbGFyZ2VyIERvY2tlciBpbWFnZXMuXG4gICAqXG4gICAqIEZvciBtb3JlIGRldGFpbHMsIHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY29kZWJ1aWxkL2xhdGVzdC91c2VyZ3VpZGUvYnVpbGQtZW52LXJlZi1jb21wdXRlLXR5cGVzLmh0bWwjZW52aXJvbm1lbnQudHlwZXNcbiAgICpcbiAgICogQGRlZmF1bHQge0BsaW5rIENvbXB1dGVUeXBlI1NNQUxMfVxuICAgKi9cbiAgcmVhZG9ubHkgY29tcHV0ZVR5cGU/OiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGU7XG5cbiAgLyoqXG4gICAqIEJ1aWxkIGltYWdlIHRvIHVzZSBpbiBDb2RlQnVpbGQuIFRoaXMgaXMgdGhlIGltYWdlIHRoYXQncyBnb2luZyB0byBydW4gdGhlIGNvZGUgdGhhdCBidWlsZHMgdGhlIHJ1bm5lciBpbWFnZS5cbiAgICpcbiAgICogVGhlIG9ubHkgYWN0aW9uIHRha2VuIGluIENvZGVCdWlsZCBpcyBydW5uaW5nIGBkb2NrZXIgYnVpbGRgLiBZb3Ugd291bGQgdGhlcmVmb3JlIG5vdCBuZWVkIHRvIGNoYW5nZSB0aGlzIHNldHRpbmcgb2Z0ZW4uXG4gICAqXG4gICAqIEBkZWZhdWx0IEFtYXpvbiBMaW51eCAyMDIzXG4gICAqL1xuICByZWFkb25seSBidWlsZEltYWdlPzogY29kZWJ1aWxkLklCdWlsZEltYWdlO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIG1pbnV0ZXMgYWZ0ZXIgd2hpY2ggQVdTIENvZGVCdWlsZCBzdG9wcyB0aGUgYnVpbGQgaWYgaXQnc1xuICAgKiBub3QgY29tcGxldGUuIEZvciB2YWxpZCB2YWx1ZXMsIHNlZSB0aGUgdGltZW91dEluTWludXRlcyBmaWVsZCBpbiB0aGUgQVdTXG4gICAqIENvZGVCdWlsZCBVc2VyIEd1aWRlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBEdXJhdGlvbi5ob3VycygxKVxuICAgKi9cbiAgcmVhZG9ubHkgdGltZW91dD86IER1cmF0aW9uO1xufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY2xhc3MgQ29kZUJ1aWxkUnVubmVySW1hZ2VCdWlsZGVyIGV4dGVuZHMgUnVubmVySW1hZ2VCdWlsZGVyQmFzZSB7XG4gIHByaXZhdGUgYm91bmREb2NrZXJJbWFnZT86IFJ1bm5lckltYWdlO1xuICBwcml2YXRlIHJlYWRvbmx5IG9zOiBPcztcbiAgcHJpdmF0ZSByZWFkb25seSBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZTtcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlSW1hZ2U6IEJhc2VDb250YWluZXJJbWFnZTtcbiAgcHJpdmF0ZSByZWFkb25seSBsb2dSZXRlbnRpb246IFJldGVudGlvbkRheXM7XG4gIHByaXZhdGUgcmVhZG9ubHkgbG9nUmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeTtcbiAgcHJpdmF0ZSByZWFkb25seSB2cGM6IGVjMi5JVnBjIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXSB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSByZWFkb25seSBidWlsZEltYWdlOiBjb2RlYnVpbGQuSUJ1aWxkSW1hZ2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uOiBlYzIuU3VibmV0U2VsZWN0aW9uIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IHRpbWVvdXQ6IGNkay5EdXJhdGlvbjtcbiAgcHJpdmF0ZSByZWFkb25seSBjb21wdXRlVHlwZTogY29kZWJ1aWxkLkNvbXB1dGVUeXBlO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlYnVpbGRJbnRlcnZhbDogY2RrLkR1cmF0aW9uO1xuICBwcml2YXRlIHJlYWRvbmx5IHJvbGU6IGlhbS5Sb2xlO1xuICBwcml2YXRlIHJlYWRvbmx5IHdhaXRPbkRlcGxveTogYm9vbGVhbjtcbiAgcHJpdmF0ZSByZWFkb25seSBkb2NrZXJTZXR1cENvbW1hbmRzOiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJ1bm5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBpZiAocHJvcHM/LmF3c0ltYWdlQnVpbGRlck9wdGlvbnMpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ2F3c0ltYWdlQnVpbGRlck9wdGlvbnMgYXJlIGlnbm9yZWQgd2hlbiB1c2luZyBDb2RlQnVpbGQgcnVubmVyIGltYWdlIGJ1aWxkZXIuJyk7XG4gICAgfVxuXG4gICAgdGhpcy5vcyA9IHByb3BzPy5vcyA/PyBPcy5MSU5VWF9VQlVOVFU7XG4gICAgdGhpcy5hcmNoaXRlY3R1cmUgPSBwcm9wcz8uYXJjaGl0ZWN0dXJlID8/IEFyY2hpdGVjdHVyZS5YODZfNjQ7XG4gICAgdGhpcy5yZWJ1aWxkSW50ZXJ2YWwgPSBwcm9wcz8ucmVidWlsZEludGVydmFsID8/IER1cmF0aW9uLmRheXMoNyk7XG4gICAgdGhpcy5sb2dSZXRlbnRpb24gPSBwcm9wcz8ubG9nUmV0ZW50aW9uID8/IFJldGVudGlvbkRheXMuT05FX01PTlRIO1xuICAgIHRoaXMubG9nUmVtb3ZhbFBvbGljeSA9IHByb3BzPy5sb2dSZW1vdmFsUG9saWN5ID8/IFJlbW92YWxQb2xpY3kuREVTVFJPWTtcbiAgICB0aGlzLnZwYyA9IHByb3BzPy52cGM7XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwcztcbiAgICB0aGlzLnN1Ym5ldFNlbGVjdGlvbiA9IHByb3BzPy5zdWJuZXRTZWxlY3Rpb247XG4gICAgdGhpcy50aW1lb3V0ID0gcHJvcHM/LmNvZGVCdWlsZE9wdGlvbnM/LnRpbWVvdXQgPz8gRHVyYXRpb24uaG91cnMoMSk7XG4gICAgdGhpcy5jb21wdXRlVHlwZSA9IHByb3BzPy5jb2RlQnVpbGRPcHRpb25zPy5jb21wdXRlVHlwZSA/PyBDb21wdXRlVHlwZS5TTUFMTDtcbiAgICB0aGlzLmJ1aWxkSW1hZ2UgPSBwcm9wcz8uY29kZUJ1aWxkT3B0aW9ucz8uYnVpbGRJbWFnZSA/PyB0aGlzLmdldERlZmF1bHRCdWlsZEltYWdlKCk7XG4gICAgdGhpcy53YWl0T25EZXBsb3kgPSBwcm9wcz8ud2FpdE9uRGVwbG95ID8/IHRydWU7XG4gICAgdGhpcy5kb2NrZXJTZXR1cENvbW1hbmRzID0gcHJvcHM/LmRvY2tlclNldHVwQ29tbWFuZHMgPz8gW107XG5cbiAgICAvLyBub3JtYWxpemUgQmFzZUNvbnRhaW5lckltYWdlSW5wdXQgdG8gQmFzZUNvbnRhaW5lckltYWdlIChzdHJpbmcgc3VwcG9ydCBpcyBkZXByZWNhdGVkLCBvbmx5IGF0IHB1YmxpYyBBUEkgbGV2ZWwpXG4gICAgY29uc3QgYmFzZURvY2tlckltYWdlSW5wdXQgPSBwcm9wcz8uYmFzZURvY2tlckltYWdlID8/IGRlZmF1bHRCYXNlRG9ja2VySW1hZ2UodGhpcy5vcyk7XG4gICAgdGhpcy5iYXNlSW1hZ2UgPSB0eXBlb2YgYmFzZURvY2tlckltYWdlSW5wdXQgPT09ICdzdHJpbmcnID8gQmFzZUNvbnRhaW5lckltYWdlLmZyb21TdHJpbmcoYmFzZURvY2tlckltYWdlSW5wdXQpIDogYmFzZURvY2tlckltYWdlSW5wdXQ7XG5cbiAgICAvLyB3YXJuIGlmIHVzaW5nIGRlcHJlY2F0ZWQgc3RyaW5nIGZvcm1hdCAob25seSBpZiB1c2VyIGV4cGxpY2l0bHkgcHJvdmlkZWQgaXQpXG4gICAgaWYgKHByb3BzPy5iYXNlRG9ja2VySW1hZ2UgJiYgdHlwZW9mIHByb3BzLmJhc2VEb2NrZXJJbWFnZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoXG4gICAgICAgICdQYXNzaW5nIGJhc2VEb2NrZXJJbWFnZSBhcyBhIHN0cmluZyBpcyBkZXByZWNhdGVkLiBQbGVhc2UgdXNlIEJhc2VDb250YWluZXJJbWFnZSBzdGF0aWMgZmFjdG9yeSBtZXRob2RzIGluc3RlYWQsIGUuZy4sIEJhc2VDb250YWluZXJJbWFnZS5mcm9tRG9ja2VySHViKFwidWJ1bnR1XCIsIFwiMjIuMDRcIikgb3IgQmFzZUNvbnRhaW5lckltYWdlLmZyb21TdHJpbmcoXCJwdWJsaWMuZWNyLmF3cy9sdHMvdWJ1bnR1OjIyLjA0XCIpJyxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gd2FybiBhZ2FpbnN0IGlzb2xhdGVkIG5ldHdvcmtzXG4gICAgaWYgKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCkge1xuICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnUHJpdmF0ZSBpc29sYXRlZCBzdWJuZXRzIGNhbm5vdCBwdWxsIGZyb20gcHVibGljIEVDUiBhbmQgVlBDIGVuZHBvaW50IGlzIG5vdCBzdXBwb3J0ZWQgeWV0LiAnICtcbiAgICAgICAgJ1NlZSBodHRwczovL2dpdGh1Yi5jb20vYXdzL2NvbnRhaW5lcnMtcm9hZG1hcC9pc3N1ZXMvMTE2MCcpO1xuICAgIH1cblxuICAgIC8vIGVycm9yIG91dCBvbiBuby1uYXQgbmV0d29ya3MgYmVjYXVzZSB0aGUgYnVpbGQgd2lsbCBoYW5nXG4gICAgaWYgKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFVCTElDKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcignUHVibGljIHN1Ym5ldHMgZG8gbm90IHdvcmsgd2l0aCBDb2RlQnVpbGQgYXMgaXQgY2Fubm90IGJlIGFzc2lnbmVkIGFuIElQLiAnICtcbiAgICAgICAgJ1NlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY29kZWJ1aWxkL2xhdGVzdC91c2VyZ3VpZGUvdnBjLXN1cHBvcnQuaHRtbCNiZXN0LXByYWN0aWNlcy1mb3ItdnBjcycpO1xuICAgIH1cblxuICAgIC8vIGNoZWNrIHRpbWVvdXRcbiAgICBpZiAodGhpcy50aW1lb3V0LnRvU2Vjb25kcygpID4gRHVyYXRpb24uaG91cnMoOCkudG9TZWNvbmRzKCkpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdDb2RlQnVpbGQgcnVubmVyIGltYWdlIGJ1aWxkZXIgdGltZW91dCBtdXN0IDggaG91cnMgb3IgbGVzcy4nKTtcbiAgICB9XG5cbiAgICAvLyBjcmVhdGUgc2VydmljZSByb2xlIGZvciBDb2RlQnVpbGRcbiAgICB0aGlzLnJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnY29kZWJ1aWxkLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcblxuICAgIC8vIGNyZWF0ZSByZXBvc2l0b3J5IHRoYXQgb25seSBrZWVwcyBvbmUgdGFnXG4gICAgdGhpcy5yZXBvc2l0b3J5ID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdSZXBvc2l0b3J5Jywge1xuICAgICAgaW1hZ2VTY2FuT25QdXNoOiB0cnVlLFxuICAgICAgaW1hZ2VUYWdNdXRhYmlsaXR5OiBUYWdNdXRhYmlsaXR5Lk1VVEFCTEUsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBlbXB0eU9uRGVsZXRlOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVtb3ZlIHNvY2kgaW5kZXhlcyBmb3IgcmVwbGFjZWQgaW1hZ2VzJyxcbiAgICAgICAgICB0YWdTdGF0dXM6IFRhZ1N0YXR1cy5UQUdHRUQsXG4gICAgICAgICAgdGFnUHJlZml4TGlzdDogWydzaGEyNTYtJ10sXG4gICAgICAgICAgbWF4SW1hZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVtb3ZlIHVudGFnZ2VkIGltYWdlcyB0aGF0IGhhdmUgYmVlbiByZXBsYWNlZCBieSBDb2RlQnVpbGQnLFxuICAgICAgICAgIHRhZ1N0YXR1czogVGFnU3RhdHVzLlVOVEFHR0VELFxuICAgICAgICAgIG1heEltYWdlQWdlOiBEdXJhdGlvbi5kYXlzKDEpLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgfVxuXG4gIGJpbmRBbWkoKTogUnVubmVyQW1pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvZGVCdWlsZCBpbWFnZSBidWlsZGVyIGNhbm5vdCBiZSB1c2VkIHRvIGJ1aWxkIEFNSScpO1xuICB9XG5cbiAgYmluZERvY2tlckltYWdlKCk6IFJ1bm5lckltYWdlIHtcbiAgICBpZiAodGhpcy5ib3VuZERvY2tlckltYWdlKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib3VuZERvY2tlckltYWdlO1xuICAgIH1cblxuICAgIC8vIGxvZyBncm91cCBmb3IgdGhlIGltYWdlIGJ1aWxkc1xuICAgIGNvbnN0IGxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAoXG4gICAgICB0aGlzLFxuICAgICAgJ0xvZ3MnLFxuICAgICAge1xuICAgICAgICByZXRlbnRpb246IHRoaXMubG9nUmV0ZW50aW9uID8/IFJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiB0aGlzLmxvZ1JlbW92YWxQb2xpY3kgPz8gUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gZ2VuZXJhdGUgYnVpbGRTcGVjXG4gICAgY29uc3QgW2J1aWxkU3BlYywgYnVpbGRTcGVjSGFzaF0gPSB0aGlzLmdldEJ1aWxkU3BlYyh0aGlzLnJlcG9zaXRvcnkpO1xuXG4gICAgLy8gY3JlYXRlIENvZGVCdWlsZCBwcm9qZWN0IHRoYXQgYnVpbGRzIERvY2tlcmZpbGUgYW5kIHB1c2hlcyB0byByZXBvc2l0b3J5XG4gICAgY29uc3QgcHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUHJvamVjdCh0aGlzLCAnQ29kZUJ1aWxkJywge1xuICAgICAgZGVzY3JpcHRpb246IGBCdWlsZCBkb2NrZXIgaW1hZ2UgZm9yIHNlbGYtaG9zdGVkIEdpdEh1YiBydW5uZXIgJHt0aGlzLm5vZGUucGF0aH0gKCR7dGhpcy5vcy5uYW1lfS8ke3RoaXMuYXJjaGl0ZWN0dXJlLm5hbWV9KWAsXG4gICAgICBidWlsZFNwZWMsXG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgICBzdWJuZXRTZWxlY3Rpb246IHRoaXMuc3VibmV0U2VsZWN0aW9uLFxuICAgICAgcm9sZTogdGhpcy5yb2xlLFxuICAgICAgdGltZW91dDogdGhpcy50aW1lb3V0LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogdGhpcy5idWlsZEltYWdlLFxuICAgICAgICBjb21wdXRlVHlwZTogdGhpcy5jb21wdXRlVHlwZSxcbiAgICAgICAgcHJpdmlsZWdlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBsb2dnaW5nOiB7XG4gICAgICAgIGNsb3VkV2F0Y2g6IHtcbiAgICAgICAgICBsb2dHcm91cCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBwZXJtaXNzaW9uc1xuICAgIHRoaXMucmVwb3NpdG9yeS5ncmFudFB1bGxQdXNoKHByb2plY3QpO1xuXG4gICAgLy8gR3JhbnQgcHVsbCBwZXJtaXNzaW9ucyBmb3IgYmFzZSBpbWFnZSBFQ1IgcmVwb3NpdG9yeSBpZiBhcHBsaWNhYmxlXG4gICAgaWYgKHRoaXMuYmFzZUltYWdlLmVjclJlcG9zaXRvcnkpIHtcbiAgICAgIHRoaXMuYmFzZUltYWdlLmVjclJlcG9zaXRvcnkuZ3JhbnRQdWxsKHByb2plY3QpO1xuICAgIH1cblxuICAgIC8vIGNhbGwgQ29kZUJ1aWxkIGR1cmluZyBkZXBsb3ltZW50XG4gICAgY29uc3QgY29tcGxldGVkSW1hZ2UgPSB0aGlzLmN1c3RvbVJlc291cmNlKHByb2plY3QsIGJ1aWxkU3BlY0hhc2gpO1xuXG4gICAgLy8gcmVidWlsZCBpbWFnZSBvbiBhIHNjaGVkdWxlXG4gICAgdGhpcy5yZWJ1aWxkSW1hZ2VPblNjaGVkdWxlKHByb2plY3QsIHRoaXMucmVidWlsZEludGVydmFsKTtcblxuICAgIC8vIHJldHVybiB0aGUgaW1hZ2VcbiAgICB0aGlzLmJvdW5kRG9ja2VySW1hZ2UgPSB7XG4gICAgICBpbWFnZVJlcG9zaXRvcnk6IHRoaXMucmVwb3NpdG9yeSxcbiAgICAgIGltYWdlVGFnOiAnbGF0ZXN0JyxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBvczogdGhpcy5vcyxcbiAgICAgIGxvZ0dyb3VwLFxuICAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygndW5rbm93bicpLFxuICAgICAgX2RlcGVuZGFibGU6IGNvbXBsZXRlZEltYWdlLFxuICAgIH07XG4gICAgcmV0dXJuIHRoaXMuYm91bmREb2NrZXJJbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0RGVmYXVsdEJ1aWxkSW1hZ2UoKTogY29kZWJ1aWxkLklCdWlsZEltYWdlIHtcbiAgICBpZiAodGhpcy5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICAvLyBDb2RlQnVpbGQganVzdCBydW5zIGBkb2NrZXIgYnVpbGRgIHNvIGl0cyBPUyBkb2Vzbid0IHJlYWxseSBtYXR0ZXJcbiAgICAgIGlmICh0aGlzLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICByZXR1cm4gY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5BTUFaT05fTElOVVhfMl81O1xuICAgICAgfSBlbHNlIGlmICh0aGlzLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgIHJldHVybiBjb2RlYnVpbGQuTGludXhBcm1CdWlsZEltYWdlLkFNQVpPTl9MSU5VWF8yX1NUQU5EQVJEXzNfMDtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHRoaXMub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29kZUJ1aWxkIGNhbm5vdCBiZSB1c2VkIHRvIGJ1aWxkIFdpbmRvd3MgRG9ja2VyIGltYWdlcyBodHRwczovL2dpdGh1Yi5jb20vZG9ja2VyLWxpYnJhcnkvZG9ja2VyL2lzc3Vlcy80OScpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGZpbmQgQ29kZUJ1aWxkIGltYWdlIGZvciAke3RoaXMub3MubmFtZX0vJHt0aGlzLmFyY2hpdGVjdHVyZS5uYW1lfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXREb2NrZXJmaWxlR2VuZXJhdGlvbkNvbW1hbmRzKCk6IFtzdHJpbmdbXSwgc3RyaW5nW11dIHtcbiAgICBsZXQgaGFzaGVkQ29tcG9uZW50czogc3RyaW5nW10gPSBbXTtcbiAgICBsZXQgY29tbWFuZHMgPSBbXTtcbiAgICBsZXQgZG9ja2VyZmlsZSA9IGBGUk9NICR7dGhpcy5iYXNlSW1hZ2UuaW1hZ2V9XFxuVk9MVU1FIC92YXIvbGliL2RvY2tlclxcbmA7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY29tcG9uZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgY29tcG9uZW50TmFtZSA9IHRoaXMuY29tcG9uZW50c1tpXS5uYW1lO1xuICAgICAgY29uc3Qgc2FmZUNvbXBvbmVudE5hbWUgPSBjb21wb25lbnROYW1lLnJlcGxhY2UoL1teYS16QS1aMC05LV0vZywgJ18nKTtcbiAgICAgIGNvbnN0IGFzc2V0RGVzY3JpcHRvcnMgPSB0aGlzLmNvbXBvbmVudHNbaV0uZ2V0QXNzZXRzKHRoaXMub3MsIHRoaXMuYXJjaGl0ZWN0dXJlKTtcblxuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBhc3NldERlc2NyaXB0b3JzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmICh0aGlzLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgYWRkIGFzc2V0IGFzIHdlIGNhbid0IGJ1aWxkIFdpbmRvd3MgRG9ja2VyIGltYWdlcyBvbiBDb2RlQnVpbGRcIik7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhc3NldCA9IG5ldyBzM19hc3NldHMuQXNzZXQodGhpcywgYENvbXBvbmVudCAke2l9ICR7Y29tcG9uZW50TmFtZX0gQXNzZXQgJHtqfWAsIHtcbiAgICAgICAgICBwYXRoOiBhc3NldERlc2NyaXB0b3JzW2pdLnNvdXJjZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGFzc2V0LmlzRmlsZSkge1xuICAgICAgICAgIGNvbW1hbmRzLnB1c2goYGF3cyBzMyBjcCAke2Fzc2V0LnMzT2JqZWN0VXJsfSBhc3NldCR7aX0tJHtzYWZlQ29tcG9uZW50TmFtZX0tJHtqfWApO1xuICAgICAgICB9IGVsc2UgaWYgKGFzc2V0LmlzWmlwQXJjaGl2ZSkge1xuICAgICAgICAgIGNvbW1hbmRzLnB1c2goYGF3cyBzMyBjcCAke2Fzc2V0LnMzT2JqZWN0VXJsfSBhc3NldCR7aX0tJHtzYWZlQ29tcG9uZW50TmFtZX0tJHtqfS56aXBgKTtcbiAgICAgICAgICBjb21tYW5kcy5wdXNoKGB1bnppcCBhc3NldCR7aX0tJHtzYWZlQ29tcG9uZW50TmFtZX0tJHtqfS56aXAgLWQgYXNzZXQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LSR7an1gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYXNzZXQgdHlwZTogJHthc3NldH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRvY2tlcmZpbGUgKz0gYENPUFkgYXNzZXQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LSR7an0gJHthc3NldERlc2NyaXB0b3JzW2pdLnRhcmdldH1cXG5gO1xuICAgICAgICBoYXNoZWRDb21wb25lbnRzLnB1c2goYF9fIEFTU0VUIEZJTEUgJHthc3NldC5hc3NldEhhc2h9ICR7aX0tJHtjb21wb25lbnROYW1lfS0ke2p9ICR7YXNzZXREZXNjcmlwdG9yc1tqXS50YXJnZXR9YCk7XG5cbiAgICAgICAgYXNzZXQuZ3JhbnRSZWFkKHRoaXMpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb21wb25lbnRDb21tYW5kcyA9IHRoaXMuY29tcG9uZW50c1tpXS5nZXRDb21tYW5kcyh0aGlzLm9zLCB0aGlzLmFyY2hpdGVjdHVyZSk7XG4gICAgICBjb25zdCBzY3JpcHQgPSAnIyEvYmluL2Jhc2hcXG5zZXQgLWV4dW8gcGlwZWZhaWxcXG4nICsgY29tcG9uZW50Q29tbWFuZHMuam9pbignXFxuJyk7XG4gICAgICBjb21tYW5kcy5wdXNoKGBjYXQgPiBjb21wb25lbnQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LnNoIDw8J0VPRkdJVEhVQlJVTk5FUlNET0NLRVJGSUxFJ1xcbiR7c2NyaXB0fVxcbkVPRkdJVEhVQlJVTk5FUlNET0NLRVJGSUxFYCk7XG4gICAgICBjb21tYW5kcy5wdXNoKGBjaG1vZCAreCBjb21wb25lbnQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LnNoYCk7XG4gICAgICBoYXNoZWRDb21wb25lbnRzLnB1c2goYF9fIENPTU1BTkQgJHtpfSAke2NvbXBvbmVudE5hbWV9ICR7c2NyaXB0fWApO1xuICAgICAgZG9ja2VyZmlsZSArPSBgQ09QWSBjb21wb25lbnQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LnNoIC90bXBcXG5gO1xuICAgICAgZG9ja2VyZmlsZSArPSBgUlVOIC90bXAvY29tcG9uZW50JHtpfS0ke3NhZmVDb21wb25lbnROYW1lfS5zaFxcbmA7XG5cbiAgICAgIGNvbnN0IGRvY2tlckNvbW1hbmRzID0gdGhpcy5jb21wb25lbnRzW2ldLmdldERvY2tlckNvbW1hbmRzKHRoaXMub3MsIHRoaXMuYXJjaGl0ZWN0dXJlKTtcbiAgICAgIGRvY2tlcmZpbGUgKz0gZG9ja2VyQ29tbWFuZHMuam9pbignXFxuJykgKyAnXFxuJztcbiAgICAgIGhhc2hlZENvbXBvbmVudHMucHVzaChgX18gRE9DS0VSIENPTU1BTkQgJHtpfSAke2RvY2tlckNvbW1hbmRzLmpvaW4oJ1xcbicpfWApO1xuICAgIH1cblxuICAgIGNvbW1hbmRzLnB1c2goYGNhdCA+IERvY2tlcmZpbGUgPDwnRU9GR0lUSFVCUlVOTkVSU0RPQ0tFUkZJTEUnXFxuJHtkb2NrZXJmaWxlfVxcbkVPRkdJVEhVQlJVTk5FUlNET0NLRVJGSUxFYCk7XG5cbiAgICByZXR1cm4gW2NvbW1hbmRzLCBoYXNoZWRDb21wb25lbnRzXTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0QnVpbGRTcGVjKHJlcG9zaXRvcnk6IGVjci5SZXBvc2l0b3J5KTogW2NvZGVidWlsZC5CdWlsZFNwZWMsIHN0cmluZ10ge1xuICAgIGNvbnN0IHRoaXNTdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcblxuICAgIGxldCBhcmNoVXJsO1xuICAgIGlmICh0aGlzLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgYXJjaFVybCA9ICd4ODZfNjQnO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgYXJjaFVybCA9ICdhcm02NCc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIGZvciByZXF1aXJlZCBDb2RlQnVpbGQ6ICR7dGhpcy5hcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBbY29tbWFuZHMsIGNvbW1hbmRzSGFzaGVkQ29tcG9uZW50c10gPSB0aGlzLmdldERvY2tlcmZpbGVHZW5lcmF0aW9uQ29tbWFuZHMoKTtcblxuICAgIGNvbnN0IGJ1aWxkU3BlY1ZlcnNpb24gPSAndjInOyAvLyBjaGFuZ2UgdGhpcyBldmVyeSB0aW1lIHRoZSBidWlsZCBzcGVjIGNoYW5nZXNcbiAgICBjb25zdCBoYXNoZWRDb21wb25lbnRzID0gY29tbWFuZHNIYXNoZWRDb21wb25lbnRzLmNvbmNhdChidWlsZFNwZWNWZXJzaW9uLCB0aGlzLmFyY2hpdGVjdHVyZS5uYW1lLCB0aGlzLmJhc2VJbWFnZS5pbWFnZSwgdGhpcy5vcy5uYW1lKTtcbiAgICAvLyBoYXNoIHRva2VucyBieSB0aGVpciByZXNvbHZlZCBmb3JtLCBub3QgYnkgdGhlIGAke1Rva2VuW1RPS0VOLk5OXX1gIHBsYWNlaG9sZGVyIHdob3NlIGNvdW50ZXIgY2hhbmdlcyBiZXR3ZWVuIHN5bnRoc1xuICAgIGxldCBoYXNoSW5wdXQgPSBoYXNoZWRDb21wb25lbnRzLmpvaW4oJ1xcbicpO1xuICAgIGlmIChjZGsuVG9rZW4uaXNVbnJlc29sdmVkKGhhc2hJbnB1dCkpIHtcbiAgICAgIGhhc2hJbnB1dCA9IEpTT04uc3RyaW5naWZ5KHRoaXNTdGFjay5yZXNvbHZlKGhhc2hJbnB1dCkpO1xuICAgIH1cbiAgICBjb25zdCBoYXNoID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShoYXNoSW5wdXQpLmRpZ2VzdCgnaGV4Jykuc2xpY2UoMCwgMTApO1xuXG4gICAgY29uc3QgYnVpbGRTcGVjID0gY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KHtcbiAgICAgIHZlcnNpb246IDAuMixcbiAgICAgIGVudjoge1xuICAgICAgICB2YXJpYWJsZXM6IHtcbiAgICAgICAgICBSRVBPX0FSTjogcmVwb3NpdG9yeS5yZXBvc2l0b3J5QXJuLFxuICAgICAgICAgIFJFUE9fVVJJOiByZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICAgICAgV0FJVF9IQU5ETEU6ICd1bnNwZWNpZmllZCcsXG4gICAgICAgICAgQkFTSF9FTlY6ICdjb2RlYnVpbGQtbG9nLnNoJyxcbiAgICAgICAgfSxcbiAgICAgICAgc2hlbGw6ICdiYXNoJyxcbiAgICAgIH0sXG4gICAgICBwaGFzZXM6IHtcbiAgICAgICAgLy8gd2UgY2FuJ3QgdXNlIHByZV9idWlsZC4gdGhlIHdhaXQgaGFuZGxlIHdpbGwgbmV2ZXIgY29tcGxldGUgaWYgcHJlX2J1aWxkIGZhaWxzIGFzIHBvc3RfYnVpbGQgd29uJ3QgcnVuLiB0aGlzIGNhbiBjYXVzZSB0aW1lb3V0cyBkdXJpbmcgZGVwbG95bWVudC5cbiAgICAgICAgYnVpbGQ6IHtcbiAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgJ2VjaG8gXCJleGVjID4gPih0ZWUgLWEgL3RtcC9jb2RlYnVpbGQubG9nKSAyPiYxXCIgPiBjb2RlYnVpbGQtbG9nLnNoJyxcbiAgICAgICAgICAgIGBhd3MgZWNyIGdldC1sb2dpbi1wYXNzd29yZCAtLXJlZ2lvbiBcIiRBV1NfREVGQVVMVF9SRUdJT05cIiB8IGRvY2tlciBsb2dpbiAtLXVzZXJuYW1lIEFXUyAtLXBhc3N3b3JkLXN0ZGluICR7dGhpc1N0YWNrLmFjY291bnR9LmRrci5lY3IuJHt0aGlzU3RhY2sucmVnaW9ufS5hbWF6b25hd3MuY29tYCxcbiAgICAgICAgICAgIC4uLnRoaXMuZG9ja2VyU2V0dXBDb21tYW5kcyxcbiAgICAgICAgICAgIC4uLmNvbW1hbmRzLFxuICAgICAgICAgICAgJ2RvY2tlciBidWlsZCAtLXByb2dyZXNzIHBsYWluIC4gLXQgXCIkUkVQT19VUklcIicsXG4gICAgICAgICAgICAnZG9ja2VyIHB1c2ggXCIkUkVQT19VUklcIicsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgcG9zdF9idWlsZDoge1xuICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICAncm0gLWYgY29kZWJ1aWxkLWxvZy5zaCAmJiBTVEFUVVM9XCJTVUNDRVNTXCInLFxuICAgICAgICAgICAgJ2lmIFsgJENPREVCVUlMRF9CVUlMRF9TVUNDRUVESU5HIC1uZSAxIF07IHRoZW4gU1RBVFVTPVwiRkFJTFVSRVwiOyBmaScsXG4gICAgICAgICAgICAnY2F0IDw8RU9GID4gL3RtcC9wYXlsb2FkLmpzb25cXG4nICtcbiAgICAgICAgICAgICd7XFxuJyArXG4gICAgICAgICAgICAnICBcIlN0YXR1c1wiOiBcIiRTVEFUVVNcIixcXG4nICtcbiAgICAgICAgICAgICcgIFwiVW5pcXVlSWRcIjogXCJidWlsZFwiLFxcbicgK1xuICAgICAgICAgICAgLy8gd2UgcmVtb3ZlIG5vbi1wcmludGFibGUgY2hhcmFjdGVycyBmcm9tIHRoZSBsb2cgYmVjYXVzZSBDbG91ZEZvcm1hdGlvbiBkb2Vzbid0IGxpa2UgdGhlbVxuICAgICAgICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL2F3cy1jbG91ZGZvcm1hdGlvbi9jbG91ZGZvcm1hdGlvbi1jb3ZlcmFnZS1yb2FkbWFwL2lzc3Vlcy8xNjAxXG4gICAgICAgICAgICAnICBcIlJlYXNvblwiOiBgc2VkIFxcJ3MvW15bOnByaW50Ol1dLy9nXFwnIC90bXAvY29kZWJ1aWxkLmxvZyB8IHRhaWwgLWMgNDAwIHwganEgLVJzYSAuYCxcXG4nICtcbiAgICAgICAgICAgIC8vIGZvciBsYW1iZGEgYWx3YXlzIGdldCBhIG5ldyB2YWx1ZSBiZWNhdXNlIHRoZXJlIGlzIGFsd2F5cyBhIG5ldyBpbWFnZSBoYXNoXG4gICAgICAgICAgICAnICBcIkRhdGFcIjogXCIkUkFORE9NXCJcXG4nICtcbiAgICAgICAgICAgICd9XFxuJyArXG4gICAgICAgICAgICAnRU9GJyxcbiAgICAgICAgICAgICdpZiBbIFwiJFdBSVRfSEFORExFXCIgIT0gXCJ1bnNwZWNpZmllZFwiIF07IHRoZW4ganEgLiAvdG1wL3BheWxvYWQuanNvbjsgY3VybCAtLXJldHJ5IDUgLS1yZXRyeS1kZWxheSAzMCAtLXJldHJ5LWFsbC1lcnJvcnMgLWZzU0wgLVggUFVUIC1IIFwiQ29udGVudC1UeXBlOlwiIC1kIFwiQC90bXAvcGF5bG9hZC5qc29uXCIgXCIkV0FJVF9IQU5ETEVcIjsgZmknLFxuICAgICAgICAgICAgLy8gZ2VuZXJhdGUgYW5kIHB1c2ggc29jaSBpbmRleFxuICAgICAgICAgICAgLy8gd2UgZG8gdGhpcyBhZnRlciBmaW5pc2hpbmcgdGhlIGJ1aWxkLCBzbyB3ZSBkb24ndCBoYXZlIHRvIHdhaXQuIGl0J3MgYWxzbyBub3QgcmVxdWlyZWQsIHNvIGl0J3Mgb2sgaWYgaXQgZmFpbHNcbiAgICAgICAgICAgICdpZiAhIFNPQ0lfTEFCRUw9YGRvY2tlciBpbnNwZWN0IC0tZm9ybWF0PVxcJ3t7anNvbiAuQ29uZmlnLkxhYmVscy5ESVNBQkxFX1NPQ0l9fVxcJyBcIiRSRVBPX1VSSVwiIDI+L2Rldi9udWxsYDsgdGhlblxcbicgK1xuICAgICAgICAgICAgJ2VjaG8gXCJTa2lwcGluZyBzb2NpIGluZGV4OiBubyBpbWFnZSB0byBpbmRleCwgdGhlIGJ1aWxkIG5ldmVyIHByb2R1Y2VkICRSRVBPX1VSSVwiXFxuJyArXG4gICAgICAgICAgICAnZWxpZiBbIFwiJFNPQ0lfTEFCRUxcIiA9IFwibnVsbFwiIF07IHRoZW5cXG4nICtcbiAgICAgICAgICAgICdkb2NrZXIgcm1pIFwiJFJFUE9fVVJJXCJcXG4nICsgLy8gaXQgZG93bmxvYWRzIHRoZSBpbWFnZSBhZ2FpbiB0byAvdG1wLCBzbyBzYXZlIG9uIHNwYWNlXG4gICAgICAgICAgICAnTEFURVNUX1NPQ0lfVkVSU0lPTj1gY3VybCAtLXJldHJ5IDUgLS1yZXRyeS1kZWxheSAzMCAtLXJldHJ5LWFsbC1lcnJvcnMgLWZzU0wgLW8gL2Rldi9udWxsIC13IFwiJXt1cmxfZWZmZWN0aXZlfVwiIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvc3RhbmRhbG9uZS1zb2NpLWluZGV4ZXIvcmVsZWFzZXMvbGF0ZXN0IHwgZ3JlcCAtb0UgXCJbXi9dKyRcImBcXG4nICtcbiAgICAgICAgICAgIGBjdXJsIC0tcmV0cnkgNSAtLXJldHJ5LWRlbGF5IDMwIC0tcmV0cnktYWxsLWVycm9ycyAtZnNTTCBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL3N0YW5kYWxvbmUtc29jaS1pbmRleGVyL3JlbGVhc2VzL2Rvd25sb2FkLyRcXHtMQVRFU1RfU09DSV9WRVJTSU9OfS9zdGFuZGFsb25lLXNvY2ktaW5kZXhlcl9MaW51eF8ke2FyY2hVcmx9LnRhci5neiB8IHRhciB4elxcbmAgK1xuICAgICAgICAgICAgJy4vc3RhbmRhbG9uZS1zb2NpLWluZGV4ZXIgXCIkUkVQT19VUklcIlxcbicgK1xuICAgICAgICAgICAgJ2ZpJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHJldHVybiBbYnVpbGRTcGVjLCBoYXNoXTtcbiAgfVxuXG4gIHByaXZhdGUgY3VzdG9tUmVzb3VyY2UocHJvamVjdDogY29kZWJ1aWxkLlByb2plY3QsIGJ1aWxkU3BlY0hhc2g6IHN0cmluZykge1xuICAgIGNvbnN0IGNySGFuZGxlciA9IHNpbmdsZXRvbkxhbWJkYShCdWlsZEltYWdlRnVuY3Rpb24sIHRoaXMsICdidWlsZC1pbWFnZScsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ3VzdG9tIHJlc291cmNlIGhhbmRsZXIgdGhhdCB0cmlnZ2VycyBDb2RlQnVpbGQgdG8gYnVpbGQgcnVubmVyIGltYWdlcycsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygzKSxcbiAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlJVTk5FUl9JTUFHRV9CVUlMRCksXG4gICAgICBsb2dnaW5nRm9ybWF0OiBsYW1iZGEuTG9nZ2luZ0Zvcm1hdC5KU09OLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc3RhcnRCdWlsZFBvbGljeSA9IGNySGFuZGxlci5yb2xlIS5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2NvZGVidWlsZDpTdGFydEJ1aWxkJ10sXG4gICAgICByZXNvdXJjZXM6IFtwcm9qZWN0LnByb2plY3RBcm5dLFxuICAgIH0pKTtcblxuICAgIGxldCB3YWl0SGFuZGxlUmVmID0gJ3Vuc3BlY2lmaWVkJztcbiAgICBsZXQgd2FpdERlcGVuZGFibGU6IGNsb3VkZm9ybWF0aW9uLkNmbldhaXRDb25kaXRpb24gfCB1bmRlZmluZWQ7XG5cbiAgICBpZiAodGhpcy53YWl0T25EZXBsb3kpIHtcbiAgICAgIC8vIFdhaXQgaGFuZGxlIGxldHMgdXMgd2FpdCBmb3IgbG9uZ2VyIHRoYW4gYW4gaG91ciBmb3IgdGhlIGltYWdlIGJ1aWxkIHRvIGNvbXBsZXRlLlxuICAgICAgLy8gV2UgZ2VuZXJhdGUgYSBuZXcgd2FpdCBoYW5kbGUgZm9yIGJ1aWxkIHNwZWMgY2hhbmdlcyB0byBndWFyYW50ZWUgYSBuZXcgaW1hZ2UgaXMgYnVpbHQuXG4gICAgICAvLyBUaGlzIGFsc28gaGVscHMgbWFrZSBzdXJlIHRoZSBjaGFuZ2VzIGFyZSBnb29kLiBJZiB0aGV5IGhhdmUgYSBidWcsIHRoZSBkZXBsb3ltZW50IHdpbGwgZmFpbCBpbnN0ZWFkIG9mIGp1c3QgdGhlIHNjaGVkdWxlZCBidWlsZC5cbiAgICAgIC8vIEZpbmFsbHksIGl0J3MgcmVjb21tZW5kZWQgYnkgQ2xvdWRGb3JtYXRpb24gZG9jcyB0byBub3QgcmV1c2Ugd2FpdCBoYW5kbGVzIG9yIG9sZCByZXNwb25zZXMgbWF5IGludGVyZmVyZSBpbiBzb21lIGNhc2VzLlxuICAgICAgY29uc3QgaGFuZGxlID0gbmV3IGNsb3VkZm9ybWF0aW9uLkNmbldhaXRDb25kaXRpb25IYW5kbGUodGhpcywgYEJ1aWxkIFdhaXQgSGFuZGxlICR7YnVpbGRTcGVjSGFzaH1gKTtcbiAgICAgIGNvbnN0IHdhaXQgPSBuZXcgY2xvdWRmb3JtYXRpb24uQ2ZuV2FpdENvbmRpdGlvbih0aGlzLCBgQnVpbGQgV2FpdCAke2J1aWxkU3BlY0hhc2h9YCwge1xuICAgICAgICBoYW5kbGU6IGhhbmRsZS5yZWYsXG4gICAgICAgIHRpbWVvdXQ6IHRoaXMudGltZW91dC50b1NlY29uZHMoKS50b1N0cmluZygpLCAvLyBkb24ndCB3YWl0IGxvbmdlciB0aGFuIHRoZSBidWlsZCB0aW1lb3V0XG4gICAgICAgIGNvdW50OiAxLFxuICAgICAgfSk7XG4gICAgICB3YWl0SGFuZGxlUmVmID0gaGFuZGxlLnJlZjtcbiAgICAgIHdhaXREZXBlbmRhYmxlID0gd2FpdDtcbiAgICB9XG5cbiAgICBjb25zdCBjciA9IG5ldyBDdXN0b21SZXNvdXJjZSh0aGlzLCAnQnVpbGRlcicsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogY3JIYW5kbGVyLmZ1bmN0aW9uQXJuLFxuICAgICAgcmVzb3VyY2VUeXBlOiAnQ3VzdG9tOjpJbWFnZUJ1aWxkZXInLFxuICAgICAgcHJvcGVydGllczogPEJ1aWxkSW1hZ2VGdW5jdGlvblByb3BlcnRpZXM+e1xuICAgICAgICBSZXBvTmFtZTogdGhpcy5yZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lLFxuICAgICAgICBQcm9qZWN0TmFtZTogcHJvamVjdC5wcm9qZWN0TmFtZSxcbiAgICAgICAgV2FpdEhhbmRsZTogd2FpdEhhbmRsZVJlZixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBhZGQgZGVwZW5kZW5jaWVzIHRvIG1ha2Ugc3VyZSByZXNvdXJjZXMgYXJlIHRoZXJlIHdoZW4gd2UgbmVlZCB0aGVtXG4gICAgY3Iubm9kZS5hZGREZXBlbmRlbmN5KHByb2plY3QpO1xuICAgIGNyLm5vZGUuYWRkRGVwZW5kZW5jeSh0aGlzLnJvbGUpO1xuICAgIGNyLm5vZGUuYWRkRGVwZW5kZW5jeShzdGFydEJ1aWxkUG9saWN5LnBvbGljeURlcGVuZGFibGUhKTtcbiAgICBjci5ub2RlLmFkZERlcGVuZGVuY3koY3JIYW5kbGVyLnJvbGUhKTtcbiAgICBjci5ub2RlLmFkZERlcGVuZGVuY3koY3JIYW5kbGVyKTtcblxuICAgIHJldHVybiB3YWl0RGVwZW5kYWJsZTsgLy8gdXNlciBuZWVkcyB0byB3YWl0IG9uIHRoZSB3YWl0IGNvbmRpdGlvbiB3aGljaCBpcyBzaWduYWxlZCB3aGVuIHRoZSBpbWFnZSBpcyBidWlsdFxuICB9XG5cbiAgcHJpdmF0ZSByZWJ1aWxkSW1hZ2VPblNjaGVkdWxlKHByb2plY3Q6IGNvZGVidWlsZC5Qcm9qZWN0LCByZWJ1aWxkSW50ZXJ2YWw/OiBEdXJhdGlvbikge1xuICAgIHJlYnVpbGRJbnRlcnZhbCA9IHJlYnVpbGRJbnRlcnZhbCA/PyBEdXJhdGlvbi5kYXlzKDcpO1xuICAgIGlmIChyZWJ1aWxkSW50ZXJ2YWwudG9NaWxsaXNlY29uZHMoKSAhPSAwKSB7XG4gICAgICBjb25zdCBzY2hlZHVsZVJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0J1aWxkIFNjaGVkdWxlJywge1xuICAgICAgICBkZXNjcmlwdGlvbjogYFJlYnVpbGQgcnVubmVyIGltYWdlIGZvciAke3RoaXMucmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZX1gLFxuICAgICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLnJhdGUocmVidWlsZEludGVydmFsKSxcbiAgICAgIH0pO1xuICAgICAgc2NoZWR1bGVSdWxlLmFkZFRhcmdldChuZXcgZXZlbnRzX3RhcmdldHMuQ29kZUJ1aWxkUHJvamVjdChwcm9qZWN0LCB7XG4gICAgICAgIC8vIGFsbCBpbWFnZSBidWlsZGVycyBpbiB0aGUgc3RhY2sgc2hhcmUgb25lIHJvbGUsIHNvIHdlIGRvbid0IGNyZWF0ZSBhIHJvbGUgYW5kIGEgcG9saWN5IHBlciBidWlsZGVyXG4gICAgICAgIGV2ZW50Um9sZTogc2luZ2xldG9uUm9sZSh0aGlzLCAnQnVpbGQgU2NoZWR1bGUgUm9sZScsIG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZXZlbnRzLmFtYXpvbmF3cy5jb20nKSksXG4gICAgICB9KSk7XG4gICAgfVxuICB9XG5cbiAgZ2V0IGNvbm5lY3Rpb25zKCk6IGVjMi5Db25uZWN0aW9ucyB7XG4gICAgcmV0dXJuIG5ldyBlYzIuQ29ubmVjdGlvbnMoe1xuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgfSk7XG4gIH1cblxuICBnZXQgZ3JhbnRQcmluY2lwYWwoKTogaWFtLklQcmluY2lwYWwge1xuICAgIHJldHVybiB0aGlzLnJvbGU7XG4gIH1cbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNsYXNzIENvZGVCdWlsZEltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIgaW1wbGVtZW50cyBjZGsuSUFzcGVjdCB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgdG9waWM6IHNucy5JVG9waWMpIHtcbiAgfVxuXG4gIHB1YmxpYyB2aXNpdChub2RlOiBJQ29uc3RydWN0KTogdm9pZCB7XG4gICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBDb2RlQnVpbGRSdW5uZXJJbWFnZUJ1aWxkZXIpIHtcbiAgICAgIGNvbnN0IGJ1aWxkZXIgPSBub2RlIGFzIENvZGVCdWlsZFJ1bm5lckltYWdlQnVpbGRlcjtcbiAgICAgIGNvbnN0IHByb2plY3ROb2RlID0gYnVpbGRlci5ub2RlLnRyeUZpbmRDaGlsZCgnQ29kZUJ1aWxkJyk7XG4gICAgICBpZiAocHJvamVjdE5vZGUpIHtcbiAgICAgICAgY29uc3QgcHJvamVjdCA9IHByb2plY3ROb2RlIGFzIGNvZGVidWlsZC5Qcm9qZWN0O1xuICAgICAgICBwcm9qZWN0Lm5vdGlmeU9uQnVpbGRGYWlsZWQoJ0J1aWxkRmFpbGVkJywgdGhpcy50b3BpYyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YoYnVpbGRlcikuYWRkV2FybmluZygnVW51c2VkIGJ1aWxkZXIgY2Fubm90IGdldCBub3RpZmljYXRpb25zIG9mIGZhaWxlZCBidWlsZHMnKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==