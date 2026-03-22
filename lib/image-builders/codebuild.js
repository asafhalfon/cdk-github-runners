"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeBuildImageBuilderFailedBuildNotifier = exports.CodeBuildRunnerImageBuilder = void 0;
const crypto = require("node:crypto");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_codebuild_1 = require("aws-cdk-lib/aws-codebuild");
const aws_ecr_1 = require("aws-cdk-lib/aws-ecr");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_image_builder_1 = require("./aws-image-builder");
const base_image_1 = require("./aws-image-builder/base-image");
const build_image_function_1 = require("./build-image-function");
const common_1 = require("./common");
const providers_1 = require("../providers");
const utils_1 = require("../utils");
/**
 * @internal
 */
class CodeBuildRunnerImageBuilder extends common_1.RunnerImageBuilderBase {
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
        this.baseImage = typeof baseDockerImageInput === 'string' ? base_image_1.BaseContainerImage.fromString(baseDockerImageInput) : baseDockerImageInput;
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
        const hash = crypto.createHash('md5').update(hashedComponents.join('\n')).digest('hex').slice(0, 10);
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
                        'if [ "$WAIT_HANDLE" != "unspecified" ]; then jq . /tmp/payload.json; curl -fsSL -X PUT -H "Content-Type:" -d "@/tmp/payload.json" "$WAIT_HANDLE"; fi',
                        // generate and push soci index
                        // we do this after finishing the build, so we don't have to wait. it's also not required, so it's ok if it fails
                        'if [ `docker inspect --format=\'{{json .Config.Labels.DISABLE_SOCI}}\' "$REPO_URI"` = "null" ]; then\n' +
                            'docker rmi "$REPO_URI"\n' + // it downloads the image again to /tmp, so save on space
                            'LATEST_SOCI_VERSION=`curl -w "%{redirect_url}" -fsS https://github.com/CloudSnorkel/standalone-soci-indexer/releases/latest | grep -oE "[^/]+$"`\n' +
                            `curl -fsSL https://github.com/CloudSnorkel/standalone-soci-indexer/releases/download/$\{LATEST_SOCI_VERSION}/standalone-soci-indexer_Linux_${archUrl}.tar.gz | tar xz\n` +
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
        const policy = new aws_cdk_lib_1.aws_iam.Policy(this, 'CR Policy', {
            statements: [
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: ['codebuild:StartBuild'],
                    resources: [project.projectArn],
                }),
            ],
        });
        crHandler.role.attachInlinePolicy(policy);
        let waitHandleRef = 'unspecified';
        let waitDependable = '';
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
            waitDependable = wait.ref;
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
        cr.node.addDependency(policy);
        cr.node.addDependency(crHandler.role);
        cr.node.addDependency(crHandler);
        return waitDependable; // user needs to wait on wait handle which is triggered when the image is built
    }
    rebuildImageOnSchedule(project, rebuildInterval) {
        rebuildInterval = rebuildInterval ?? aws_cdk_lib_1.Duration.days(7);
        if (rebuildInterval.toMilliseconds() != 0) {
            const scheduleRule = new aws_cdk_lib_1.aws_events.Rule(this, 'Build Schedule', {
                description: `Rebuild runner image for ${this.repository.repositoryName}`,
                schedule: aws_cdk_lib_1.aws_events.Schedule.rate(rebuildInterval),
            });
            scheduleRule.addTarget(new aws_cdk_lib_1.aws_events_targets.CodeBuildProject(project));
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWJ1aWxkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2NvZGVidWlsZC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxzQ0FBc0M7QUFDdEMsbUNBQW1DO0FBQ25DLDZDQWdCcUI7QUFDckIsNkRBQXdEO0FBQ3hELGlEQUErRDtBQUMvRCxtREFBcUQ7QUFFckQsMkRBQTZEO0FBQzdELCtEQUFvRTtBQUNwRSxpRUFBNEQ7QUFFNUQscUNBQTJFO0FBQzNFLDRDQUF1RjtBQUN2RixvQ0FBZ0Y7QUF5Q2hGOztHQUVHO0FBQ0gsTUFBYSwyQkFBNEIsU0FBUSwrQkFBc0I7SUFtQnJFLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBK0I7UUFDdkUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsSUFBSSxLQUFLLEVBQUUsc0JBQXNCLEVBQUUsQ0FBQztZQUNsQyx5QkFBVyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxVQUFVLENBQUMsK0VBQStFLENBQUMsQ0FBQztRQUNuSCxDQUFDO1FBRUQsSUFBSSxDQUFDLEVBQUUsR0FBRyxLQUFLLEVBQUUsRUFBRSxJQUFJLGNBQUUsQ0FBQyxZQUFZLENBQUM7UUFDdkMsSUFBSSxDQUFDLFlBQVksR0FBRyxLQUFLLEVBQUUsWUFBWSxJQUFJLHdCQUFZLENBQUMsTUFBTSxDQUFDO1FBQy9ELElBQUksQ0FBQyxlQUFlLEdBQUcsS0FBSyxFQUFFLGVBQWUsSUFBSSxzQkFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNsRSxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssRUFBRSxZQUFZLElBQUksd0JBQWEsQ0FBQyxTQUFTLENBQUM7UUFDbkUsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEtBQUssRUFBRSxnQkFBZ0IsSUFBSSwyQkFBYSxDQUFDLE9BQU8sQ0FBQztRQUN6RSxJQUFJLENB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aEIsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQ25CLENBQUM7Q0FDRjtBQTlYRCxrRUE4WEM7QUFFRDs7R0FFRztBQUNILE1BQWEsd0NBQXdDO0lBQ25ELFlBQW9CLEtBQWlCO1FBQWpCLFVBQUssR0FBTCxLQUFLLENBQVk7SUFDckMsQ0FBQztJQUVNLEtBQUssQ0FBQyxJQUFnQjtRQUMzQixJQUFJLElBQUksWUFBWSwyQkFBMkIsRUFBRSxDQUFDO1lBQ2hELE1BQU0sT0FBTyxHQUFHLElBQW1DLENBQUM7WUFDcEQsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxDQUFDLENBQUM7WUFDM0QsSUFBSSxXQUFXLEVBQUUsQ0FBQztnQkFDaEIsTUFBTSxPQUFPLEdBQUcsV0FBZ0MsQ0FBQztnQkFDakQsT0FBTyxDQUFDLG1CQUFtQixDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDekQsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLEdBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDLFVBQVUsQ0FBQywwREFBMEQsQ0FBQyxDQUFDO1lBQ3JHLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBaEJELDRGQWdCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0byc7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHtcbiAgQW5ub3RhdGlvbnMsXG4gIGF3c19jbG91ZGZvcm1hdGlvbiBhcyBjbG91ZGZvcm1hdGlvbixcbiAgYXdzX2NvZGVidWlsZCBhcyBjb2RlYnVpbGQsXG4gIGF3c19lYzIgYXMgZWMyLFxuICBhd3NfZWNyIGFzIGVjcixcbiAgYXdzX2V2ZW50cyBhcyBldmVudHMsXG4gIGF3c19ldmVudHNfdGFyZ2V0cyBhcyBldmVudHNfdGFyZ2V0cyxcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sYW1iZGEgYXMgbGFtYmRhLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3NfczNfYXNzZXRzIGFzIHMzX2Fzc2V0cyxcbiAgYXdzX3NucyBhcyBzbnMsXG4gIEN1c3RvbVJlc291cmNlLFxuICBEdXJhdGlvbixcbiAgUmVtb3ZhbFBvbGljeSxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29tcHV0ZVR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZWJ1aWxkJztcbmltcG9ydCB7IFRhZ011dGFiaWxpdHksIFRhZ1N0YXR1cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCwgSUNvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgZGVmYXVsdEJhc2VEb2NrZXJJbWFnZSB9IGZyb20gJy4vYXdzLWltYWdlLWJ1aWxkZXInO1xuaW1wb3J0IHsgQmFzZUNvbnRhaW5lckltYWdlIH0gZnJvbSAnLi9hd3MtaW1hZ2UtYnVpbGRlci9iYXNlLWltYWdlJztcbmltcG9ydCB7IEJ1aWxkSW1hZ2VGdW5jdGlvbiB9IGZyb20gJy4vYnVpbGQtaW1hZ2UtZnVuY3Rpb24nO1xuaW1wb3J0IHsgQnVpbGRJbWFnZUZ1bmN0aW9uUHJvcGVydGllcyB9IGZyb20gJy4vYnVpbGQtaW1hZ2UubGFtYmRhJztcbmltcG9ydCB7IFJ1bm5lckltYWdlQnVpbGRlckJhc2UsIFJ1bm5lckltYWdlQnVpbGRlclByb3BzIH0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBPcywgUnVubmVyQW1pLCBSdW5uZXJJbWFnZSwgUnVubmVyVmVyc2lvbiB9IGZyb20gJy4uL3Byb3ZpZGVycyc7XG5pbXBvcnQgeyBzaW5nbGV0b25MYW1iZGEsIHNpbmdsZXRvbkxvZ0dyb3VwLCBTaW5nbGV0b25Mb2dUeXBlIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29kZUJ1aWxkUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMge1xuICAvKipcbiAgICogVGhlIHR5cGUgb2YgY29tcHV0ZSB0byB1c2UgZm9yIHRoaXMgYnVpbGQuXG4gICAqIFNlZSB0aGUge0BsaW5rIENvbXB1dGVUeXBlfSBlbnVtIGZvciB0aGUgcG9zc2libGUgdmFsdWVzLlxuICAgKlxuICAgKiBUaGUgY29tcHV0ZSB0eXBlIGRldGVybWluZXMgQ1BVLCBtZW1vcnksIGFuZCBkaXNrIHNwYWNlOlxuICAgKiAtIFNNQUxMOiAyIHZDUFUsIDMgR0IgUkFNLCA2NCBHQiBkaXNrXG4gICAqIC0gTUVESVVNOiA0IHZDUFUsIDcgR0IgUkFNLCAxMjggR0IgZGlza1xuICAgKiAtIExBUkdFOiA4IHZDUFUsIDE1IEdCIFJBTSwgMTI4IEdCIGRpc2tcbiAgICogLSBYMl9MQVJHRTogNzIgdkNQVSwgMTQ1IEdCIFJBTSwgMjU2IEdCIGRpc2sgKExpbnV4KSBvciA4MjQgR0IgZGlzayAoV2luZG93cylcbiAgICpcbiAgICogVXNlIGEgbGFyZ2VyIGNvbXB1dGUgdHlwZSB3aGVuIHlvdSBuZWVkIG1vcmUgZGlzayBzcGFjZSBmb3IgYnVpbGRpbmcgbGFyZ2VyIERvY2tlciBpbWFnZXMuXG4gICAqXG4gICAqIEZvciBtb3JlIGRldGFpbHMsIHNlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY29kZWJ1aWxkL2xhdGVzdC91c2VyZ3VpZGUvYnVpbGQtZW52LXJlZi1jb21wdXRlLXR5cGVzLmh0bWwjZW52aXJvbm1lbnQudHlwZXNcbiAgICpcbiAgICogQGRlZmF1bHQge0BsaW5rIENvbXB1dGVUeXBlI1NNQUxMfVxuICAgKi9cbiAgcmVhZG9ubHkgY29tcHV0ZVR5cGU/OiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGU7XG5cbiAgLyoqXG4gICAqIEJ1aWxkIGltYWdlIHRvIHVzZSBpbiBDb2RlQnVpbGQuIFRoaXMgaXMgdGhlIGltYWdlIHRoYXQncyBnb2luZyB0byBydW4gdGhlIGNvZGUgdGhhdCBidWlsZHMgdGhlIHJ1bm5lciBpbWFnZS5cbiAgICpcbiAgICogVGhlIG9ubHkgYWN0aW9uIHRha2VuIGluIENvZGVCdWlsZCBpcyBydW5uaW5nIGBkb2NrZXIgYnVpbGRgLiBZb3Ugd291bGQgdGhlcmVmb3JlIG5vdCBuZWVkIHRvIGNoYW5nZSB0aGlzIHNldHRpbmcgb2Z0ZW4uXG4gICAqXG4gICAqIEBkZWZhdWx0IEFtYXpvbiBMaW51eCAyMDIzXG4gICAqL1xuICByZWFkb25seSBidWlsZEltYWdlPzogY29kZWJ1aWxkLklCdWlsZEltYWdlO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIG1pbnV0ZXMgYWZ0ZXIgd2hpY2ggQVdTIENvZGVCdWlsZCBzdG9wcyB0aGUgYnVpbGQgaWYgaXQnc1xuICAgKiBub3QgY29tcGxldGUuIEZvciB2YWxpZCB2YWx1ZXMsIHNlZSB0aGUgdGltZW91dEluTWludXRlcyBmaWVsZCBpbiB0aGUgQVdTXG4gICAqIENvZGVCdWlsZCBVc2VyIEd1aWRlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBEdXJhdGlvbi5ob3VycygxKVxuICAgKi9cbiAgcmVhZG9ubHkgdGltZW91dD86IER1cmF0aW9uO1xufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY2xhc3MgQ29kZUJ1aWxkUnVubmVySW1hZ2VCdWlsZGVyIGV4dGVuZHMgUnVubmVySW1hZ2VCdWlsZGVyQmFzZSB7XG4gIHByaXZhdGUgYm91bmREb2NrZXJJbWFnZT86IFJ1bm5lckltYWdlO1xuICBwcml2YXRlIHJlYWRvbmx5IG9zOiBPcztcbiAgcHJpdmF0ZSByZWFkb25seSBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZTtcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlSW1hZ2U6IEJhc2VDb250YWluZXJJbWFnZTtcbiAgcHJpdmF0ZSByZWFkb25seSBsb2dSZXRlbnRpb246IFJldGVudGlvbkRheXM7XG4gIHByaXZhdGUgcmVhZG9ubHkgbG9nUmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeTtcbiAgcHJpdmF0ZSByZWFkb25seSB2cGM6IGVjMi5JVnBjIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXSB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSByZWFkb25seSBidWlsZEltYWdlOiBjb2RlYnVpbGQuSUJ1aWxkSW1hZ2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uOiBlYzIuU3VibmV0U2VsZWN0aW9uIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IHRpbWVvdXQ6IGNkay5EdXJhdGlvbjtcbiAgcHJpdmF0ZSByZWFkb25seSBjb21wdXRlVHlwZTogY29kZWJ1aWxkLkNvbXB1dGVUeXBlO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlYnVpbGRJbnRlcnZhbDogY2RrLkR1cmF0aW9uO1xuICBwcml2YXRlIHJlYWRvbmx5IHJvbGU6IGlhbS5Sb2xlO1xuICBwcml2YXRlIHJlYWRvbmx5IHdhaXRPbkRlcGxveTogYm9vbGVhbjtcbiAgcHJpdmF0ZSByZWFkb25seSBkb2NrZXJTZXR1cENvbW1hbmRzOiBzdHJpbmdbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJ1bm5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBpZiAocHJvcHM/LmF3c0ltYWdlQnVpbGRlck9wdGlvbnMpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ2F3c0ltYWdlQnVpbGRlck9wdGlvbnMgYXJlIGlnbm9yZWQgd2hlbiB1c2luZyBDb2RlQnVpbGQgcnVubmVyIGltYWdlIGJ1aWxkZXIuJyk7XG4gICAgfVxuXG4gICAgdGhpcy5vcyA9IHByb3BzPy5vcyA/PyBPcy5MSU5VWF9VQlVOVFU7XG4gICAgdGhpcy5hcmNoaXRlY3R1cmUgPSBwcm9wcz8uYXJjaGl0ZWN0dXJlID8/IEFyY2hpdGVjdHVyZS5YODZfNjQ7XG4gICAgdGhpcy5yZWJ1aWxkSW50ZXJ2YWwgPSBwcm9wcz8ucmVidWlsZEludGVydmFsID8/IER1cmF0aW9uLmRheXMoNyk7XG4gICAgdGhpcy5sb2dSZXRlbnRpb24gPSBwcm9wcz8ubG9nUmV0ZW50aW9uID8/IFJldGVudGlvbkRheXMuT05FX01PTlRIO1xuICAgIHRoaXMubG9nUmVtb3ZhbFBvbGljeSA9IHByb3BzPy5sb2dSZW1vdmFsUG9saWN5ID8/IFJlbW92YWxQb2xpY3kuREVTVFJPWTtcbiAgICB0aGlzLnZwYyA9IHByb3BzPy52cGM7XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwcztcbiAgICB0aGlzLnN1Ym5ldFNlbGVjdGlvbiA9IHByb3BzPy5zdWJuZXRTZWxlY3Rpb247XG4gICAgdGhpcy50aW1lb3V0ID0gcHJvcHM/LmNvZGVCdWlsZE9wdGlvbnM/LnRpbWVvdXQgPz8gRHVyYXRpb24uaG91cnMoMSk7XG4gICAgdGhpcy5jb21wdXRlVHlwZSA9IHByb3BzPy5jb2RlQnVpbGRPcHRpb25zPy5jb21wdXRlVHlwZSA/PyBDb21wdXRlVHlwZS5TTUFMTDtcbiAgICB0aGlzLmJ1aWxkSW1hZ2UgPSBwcm9wcz8uY29kZUJ1aWxkT3B0aW9ucz8uYnVpbGRJbWFnZSA/PyB0aGlzLmdldERlZmF1bHRCdWlsZEltYWdlKCk7XG4gICAgdGhpcy53YWl0T25EZXBsb3kgPSBwcm9wcz8ud2FpdE9uRGVwbG95ID8/IHRydWU7XG4gICAgdGhpcy5kb2NrZXJTZXR1cENvbW1hbmRzID0gcHJvcHM/LmRvY2tlclNldHVwQ29tbWFuZHMgPz8gW107XG5cbiAgICAvLyBub3JtYWxpemUgQmFzZUNvbnRhaW5lckltYWdlSW5wdXQgdG8gQmFzZUNvbnRhaW5lckltYWdlIChzdHJpbmcgc3VwcG9ydCBpcyBkZXByZWNhdGVkLCBvbmx5IGF0IHB1YmxpYyBBUEkgbGV2ZWwpXG4gICAgY29uc3QgYmFzZURvY2tlckltYWdlSW5wdXQgPSBwcm9wcz8uYmFzZURvY2tlckltYWdlID8/IGRlZmF1bHRCYXNlRG9ja2VySW1hZ2UodGhpcy5vcyk7XG4gICAgdGhpcy5iYXNlSW1hZ2UgPSB0eXBlb2YgYmFzZURvY2tlckltYWdlSW5wdXQgPT09ICdzdHJpbmcnID8gQmFzZUNvbnRhaW5lckltYWdlLmZyb21TdHJpbmcoYmFzZURvY2tlckltYWdlSW5wdXQpIDogYmFzZURvY2tlckltYWdlSW5wdXQ7XG5cbiAgICAvLyB3YXJuIGlmIHVzaW5nIGRlcHJlY2F0ZWQgc3RyaW5nIGZvcm1hdCAob25seSBpZiB1c2VyIGV4cGxpY2l0bHkgcHJvdmlkZWQgaXQpXG4gICAgaWYgKHByb3BzPy5iYXNlRG9ja2VySW1hZ2UgJiYgdHlwZW9mIHByb3BzLmJhc2VEb2NrZXJJbWFnZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoXG4gICAgICAgICdQYXNzaW5nIGJhc2VEb2NrZXJJbWFnZSBhcyBhIHN0cmluZyBpcyBkZXByZWNhdGVkLiBQbGVhc2UgdXNlIEJhc2VDb250YWluZXJJbWFnZSBzdGF0aWMgZmFjdG9yeSBtZXRob2RzIGluc3RlYWQsIGUuZy4sIEJhc2VDb250YWluZXJJbWFnZS5mcm9tRG9ja2VySHViKFwidWJ1bnR1XCIsIFwiMjIuMDRcIikgb3IgQmFzZUNvbnRhaW5lckltYWdlLmZyb21TdHJpbmcoXCJwdWJsaWMuZWNyLmF3cy9sdHMvdWJ1bnR1OjIyLjA0XCIpJyxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gd2FybiBhZ2FpbnN0IGlzb2xhdGVkIG5ldHdvcmtzXG4gICAgaWYgKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCkge1xuICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnUHJpdmF0ZSBpc29sYXRlZCBzdWJuZXRzIGNhbm5vdCBwdWxsIGZyb20gcHVibGljIEVDUiBhbmQgVlBDIGVuZHBvaW50IGlzIG5vdCBzdXBwb3J0ZWQgeWV0LiAnICtcbiAgICAgICAgJ1NlZSBodHRwczovL2dpdGh1Yi5jb20vYXdzL2NvbnRhaW5lcnMtcm9hZG1hcC9pc3N1ZXMvMTE2MCcpO1xuICAgIH1cblxuICAgIC8vIGVycm9yIG91dCBvbiBuby1uYXQgbmV0d29ya3MgYmVjYXVzZSB0aGUgYnVpbGQgd2lsbCBoYW5nXG4gICAgaWYgKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFVCTElDKSB7XG4gICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcignUHVibGljIHN1Ym5ldHMgZG8gbm90IHdvcmsgd2l0aCBDb2RlQnVpbGQgYXMgaXQgY2Fubm90IGJlIGFzc2lnbmVkIGFuIElQLiAnICtcbiAgICAgICAgJ1NlZSBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vY29kZWJ1aWxkL2xhdGVzdC91c2VyZ3VpZGUvdnBjLXN1cHBvcnQuaHRtbCNiZXN0LXByYWN0aWNlcy1mb3ItdnBjcycpO1xuICAgIH1cblxuICAgIC8vIGNoZWNrIHRpbWVvdXRcbiAgICBpZiAodGhpcy50aW1lb3V0LnRvU2Vjb25kcygpID4gRHVyYXRpb24uaG91cnMoOCkudG9TZWNvbmRzKCkpIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdDb2RlQnVpbGQgcnVubmVyIGltYWdlIGJ1aWxkZXIgdGltZW91dCBtdXN0IDggaG91cnMgb3IgbGVzcy4nKTtcbiAgICB9XG5cbiAgICAvLyBjcmVhdGUgc2VydmljZSByb2xlIGZvciBDb2RlQnVpbGRcbiAgICB0aGlzLnJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnY29kZWJ1aWxkLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcblxuICAgIC8vIGNyZWF0ZSByZXBvc2l0b3J5IHRoYXQgb25seSBrZWVwcyBvbmUgdGFnXG4gICAgdGhpcy5yZXBvc2l0b3J5ID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdSZXBvc2l0b3J5Jywge1xuICAgICAgaW1hZ2VTY2FuT25QdXNoOiB0cnVlLFxuICAgICAgaW1hZ2VUYWdNdXRhYmlsaXR5OiBUYWdNdXRhYmlsaXR5Lk1VVEFCTEUsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBlbXB0eU9uRGVsZXRlOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVtb3ZlIHNvY2kgaW5kZXhlcyBmb3IgcmVwbGFjZWQgaW1hZ2VzJyxcbiAgICAgICAgICB0YWdTdGF0dXM6IFRhZ1N0YXR1cy5UQUdHRUQsXG4gICAgICAgICAgdGFnUHJlZml4TGlzdDogWydzaGEyNTYtJ10sXG4gICAgICAgICAgbWF4SW1hZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVtb3ZlIHVudGFnZ2VkIGltYWdlcyB0aGF0IGhhdmUgYmVlbiByZXBsYWNlZCBieSBDb2RlQnVpbGQnLFxuICAgICAgICAgIHRhZ1N0YXR1czogVGFnU3RhdHVzLlVOVEFHR0VELFxuICAgICAgICAgIG1heEltYWdlQWdlOiBEdXJhdGlvbi5kYXlzKDEpLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcbiAgfVxuXG4gIGJpbmRBbWkoKTogUnVubmVyQW1pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvZGVCdWlsZCBpbWFnZSBidWlsZGVyIGNhbm5vdCBiZSB1c2VkIHRvIGJ1aWxkIEFNSScpO1xuICB9XG5cbiAgYmluZERvY2tlckltYWdlKCk6IFJ1bm5lckltYWdlIHtcbiAgICBpZiAodGhpcy5ib3VuZERvY2tlckltYWdlKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib3VuZERvY2tlckltYWdlO1xuICAgIH1cblxuICAgIC8vIGxvZyBncm91cCBmb3IgdGhlIGltYWdlIGJ1aWxkc1xuICAgIGNvbnN0IGxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAoXG4gICAgICB0aGlzLFxuICAgICAgJ0xvZ3MnLFxuICAgICAge1xuICAgICAgICByZXRlbnRpb246IHRoaXMubG9nUmV0ZW50aW9uID8/IFJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiB0aGlzLmxvZ1JlbW92YWxQb2xpY3kgPz8gUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gZ2VuZXJhdGUgYnVpbGRTcGVjXG4gICAgY29uc3QgW2J1aWxkU3BlYywgYnVpbGRTcGVjSGFzaF0gPSB0aGlzLmdldEJ1aWxkU3BlYyh0aGlzLnJlcG9zaXRvcnkpO1xuXG4gICAgLy8gY3JlYXRlIENvZGVCdWlsZCBwcm9qZWN0IHRoYXQgYnVpbGRzIERvY2tlcmZpbGUgYW5kIHB1c2hlcyB0byByZXBvc2l0b3J5XG4gICAgY29uc3QgcHJvamVjdCA9IG5ldyBjb2RlYnVpbGQuUHJvamVjdCh0aGlzLCAnQ29kZUJ1aWxkJywge1xuICAgICAgZGVzY3JpcHRpb246IGBCdWlsZCBkb2NrZXIgaW1hZ2UgZm9yIHNlbGYtaG9zdGVkIEdpdEh1YiBydW5uZXIgJHt0aGlzLm5vZGUucGF0aH0gKCR7dGhpcy5vcy5uYW1lfS8ke3RoaXMuYXJjaGl0ZWN0dXJlLm5hbWV9KWAsXG4gICAgICBidWlsZFNwZWMsXG4gICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgICBzdWJuZXRTZWxlY3Rpb246IHRoaXMuc3VibmV0U2VsZWN0aW9uLFxuICAgICAgcm9sZTogdGhpcy5yb2xlLFxuICAgICAgdGltZW91dDogdGhpcy50aW1lb3V0LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogdGhpcy5idWlsZEltYWdlLFxuICAgICAgICBjb21wdXRlVHlwZTogdGhpcy5jb21wdXRlVHlwZSxcbiAgICAgICAgcHJpdmlsZWdlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBsb2dnaW5nOiB7XG4gICAgICAgIGNsb3VkV2F0Y2g6IHtcbiAgICAgICAgICBsb2dHcm91cCxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBwZXJtaXNzaW9uc1xuICAgIHRoaXMucmVwb3NpdG9yeS5ncmFudFB1bGxQdXNoKHByb2plY3QpO1xuXG4gICAgLy8gR3JhbnQgcHVsbCBwZXJtaXNzaW9ucyBmb3IgYmFzZSBpbWFnZSBFQ1IgcmVwb3NpdG9yeSBpZiBhcHBsaWNhYmxlXG4gICAgaWYgKHRoaXMuYmFzZUltYWdlLmVjclJlcG9zaXRvcnkpIHtcbiAgICAgIHRoaXMuYmFzZUltYWdlLmVjclJlcG9zaXRvcnkuZ3JhbnRQdWxsKHByb2plY3QpO1xuICAgIH1cblxuICAgIC8vIGNhbGwgQ29kZUJ1aWxkIGR1cmluZyBkZXBsb3ltZW50XG4gICAgY29uc3QgY29tcGxldGVkSW1hZ2UgPSB0aGlzLmN1c3RvbVJlc291cmNlKHByb2plY3QsIGJ1aWxkU3BlY0hhc2gpO1xuXG4gICAgLy8gcmVidWlsZCBpbWFnZSBvbiBhIHNjaGVkdWxlXG4gICAgdGhpcy5yZWJ1aWxkSW1hZ2VPblNjaGVkdWxlKHByb2plY3QsIHRoaXMucmVidWlsZEludGVydmFsKTtcblxuICAgIC8vIHJldHVybiB0aGUgaW1hZ2VcbiAgICB0aGlzLmJvdW5kRG9ja2VySW1hZ2UgPSB7XG4gICAgICBpbWFnZVJlcG9zaXRvcnk6IHRoaXMucmVwb3NpdG9yeSxcbiAgICAgIGltYWdlVGFnOiAnbGF0ZXN0JyxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBvczogdGhpcy5vcyxcbiAgICAgIGxvZ0dyb3VwLFxuICAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygndW5rbm93bicpLFxuICAgICAgX2RlcGVuZGFibGU6IGNvbXBsZXRlZEltYWdlLFxuICAgIH07XG4gICAgcmV0dXJuIHRoaXMuYm91bmREb2NrZXJJbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0RGVmYXVsdEJ1aWxkSW1hZ2UoKTogY29kZWJ1aWxkLklCdWlsZEltYWdlIHtcbiAgICBpZiAodGhpcy5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICAvLyBDb2RlQnVpbGQganVzdCBydW5zIGBkb2NrZXIgYnVpbGRgIHNvIGl0cyBPUyBkb2Vzbid0IHJlYWxseSBtYXR0ZXJcbiAgICAgIGlmICh0aGlzLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICByZXR1cm4gY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5BTUFaT05fTElOVVhfMl81O1xuICAgICAgfSBlbHNlIGlmICh0aGlzLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgIHJldHVybiBjb2RlYnVpbGQuTGludXhBcm1CdWlsZEltYWdlLkFNQVpPTl9MSU5VWF8yX1NUQU5EQVJEXzNfMDtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHRoaXMub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29kZUJ1aWxkIGNhbm5vdCBiZSB1c2VkIHRvIGJ1aWxkIFdpbmRvd3MgRG9ja2VyIGltYWdlcyBodHRwczovL2dpdGh1Yi5jb20vZG9ja2VyLWxpYnJhcnkvZG9ja2VyL2lzc3Vlcy80OScpO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGZpbmQgQ29kZUJ1aWxkIGltYWdlIGZvciAke3RoaXMub3MubmFtZX0vJHt0aGlzLmFyY2hpdGVjdHVyZS5uYW1lfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXREb2NrZXJmaWxlR2VuZXJhdGlvbkNvbW1hbmRzKCk6IFtzdHJpbmdbXSwgc3RyaW5nW11dIHtcbiAgICBsZXQgaGFzaGVkQ29tcG9uZW50czogc3RyaW5nW10gPSBbXTtcbiAgICBsZXQgY29tbWFuZHMgPSBbXTtcbiAgICBsZXQgZG9ja2VyZmlsZSA9IGBGUk9NICR7dGhpcy5iYXNlSW1hZ2UuaW1hZ2V9XFxuVk9MVU1FIC92YXIvbGliL2RvY2tlclxcbmA7XG5cbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY29tcG9uZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgY29uc3QgY29tcG9uZW50TmFtZSA9IHRoaXMuY29tcG9uZW50c1tpXS5uYW1lO1xuICAgICAgY29uc3Qgc2FmZUNvbXBvbmVudE5hbWUgPSBjb21wb25lbnROYW1lLnJlcGxhY2UoL1teYS16QS1aMC05LV0vZywgJ18nKTtcbiAgICAgIGNvbnN0IGFzc2V0RGVzY3JpcHRvcnMgPSB0aGlzLmNvbXBvbmVudHNbaV0uZ2V0QXNzZXRzKHRoaXMub3MsIHRoaXMuYXJjaGl0ZWN0dXJlKTtcblxuICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCBhc3NldERlc2NyaXB0b3JzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmICh0aGlzLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2FuJ3QgYWRkIGFzc2V0IGFzIHdlIGNhbid0IGJ1aWxkIFdpbmRvd3MgRG9ja2VyIGltYWdlcyBvbiBDb2RlQnVpbGRcIik7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBhc3NldCA9IG5ldyBzM19hc3NldHMuQXNzZXQodGhpcywgYENvbXBvbmVudCAke2l9ICR7Y29tcG9uZW50TmFtZX0gQXNzZXQgJHtqfWAsIHtcbiAgICAgICAgICBwYXRoOiBhc3NldERlc2NyaXB0b3JzW2pdLnNvdXJjZSxcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKGFzc2V0LmlzRmlsZSkge1xuICAgICAgICAgIGNvbW1hbmRzLnB1c2goYGF3cyBzMyBjcCAke2Fzc2V0LnMzT2JqZWN0VXJsfSBhc3NldCR7aX0tJHtzYWZlQ29tcG9uZW50TmFtZX0tJHtqfWApO1xuICAgICAgICB9IGVsc2UgaWYgKGFzc2V0LmlzWmlwQXJjaGl2ZSkge1xuICAgICAgICAgIGNvbW1hbmRzLnB1c2goYGF3cyBzMyBjcCAke2Fzc2V0LnMzT2JqZWN0VXJsfSBhc3NldCR7aX0tJHtzYWZlQ29tcG9uZW50TmFtZX0tJHtqfS56aXBgKTtcbiAgICAgICAgICBjb21tYW5kcy5wdXNoKGB1bnppcCBhc3NldCR7aX0tJHtzYWZlQ29tcG9uZW50TmFtZX0tJHtqfS56aXAgLWQgYXNzZXQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LSR7an1gKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gYXNzZXQgdHlwZTogJHthc3NldH1gKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGRvY2tlcmZpbGUgKz0gYENPUFkgYXNzZXQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LSR7an0gJHthc3NldERlc2NyaXB0b3JzW2pdLnRhcmdldH1cXG5gO1xuICAgICAgICBoYXNoZWRDb21wb25lbnRzLnB1c2goYF9fIEFTU0VUIEZJTEUgJHthc3NldC5hc3NldEhhc2h9ICR7aX0tJHtjb21wb25lbnROYW1lfS0ke2p9ICR7YXNzZXREZXNjcmlwdG9yc1tqXS50YXJnZXR9YCk7XG5cbiAgICAgICAgYXNzZXQuZ3JhbnRSZWFkKHRoaXMpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb21wb25lbnRDb21tYW5kcyA9IHRoaXMuY29tcG9uZW50c1tpXS5nZXRDb21tYW5kcyh0aGlzLm9zLCB0aGlzLmFyY2hpdGVjdHVyZSk7XG4gICAgICBjb25zdCBzY3JpcHQgPSAnIyEvYmluL2Jhc2hcXG5zZXQgLWV4dW8gcGlwZWZhaWxcXG4nICsgY29tcG9uZW50Q29tbWFuZHMuam9pbignXFxuJyk7XG4gICAgICBjb21tYW5kcy5wdXNoKGBjYXQgPiBjb21wb25lbnQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LnNoIDw8J0VPRkdJVEhVQlJVTk5FUlNET0NLRVJGSUxFJ1xcbiR7c2NyaXB0fVxcbkVPRkdJVEhVQlJVTk5FUlNET0NLRVJGSUxFYCk7XG4gICAgICBjb21tYW5kcy5wdXNoKGBjaG1vZCAreCBjb21wb25lbnQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LnNoYCk7XG4gICAgICBoYXNoZWRDb21wb25lbnRzLnB1c2goYF9fIENPTU1BTkQgJHtpfSAke2NvbXBvbmVudE5hbWV9ICR7c2NyaXB0fWApO1xuICAgICAgZG9ja2VyZmlsZSArPSBgQ09QWSBjb21wb25lbnQke2l9LSR7c2FmZUNvbXBvbmVudE5hbWV9LnNoIC90bXBcXG5gO1xuICAgICAgZG9ja2VyZmlsZSArPSBgUlVOIC90bXAvY29tcG9uZW50JHtpfS0ke3NhZmVDb21wb25lbnROYW1lfS5zaFxcbmA7XG5cbiAgICAgIGNvbnN0IGRvY2tlckNvbW1hbmRzID0gdGhpcy5jb21wb25lbnRzW2ldLmdldERvY2tlckNvbW1hbmRzKHRoaXMub3MsIHRoaXMuYXJjaGl0ZWN0dXJlKTtcbiAgICAgIGRvY2tlcmZpbGUgKz0gZG9ja2VyQ29tbWFuZHMuam9pbignXFxuJykgKyAnXFxuJztcbiAgICAgIGhhc2hlZENvbXBvbmVudHMucHVzaChgX18gRE9DS0VSIENPTU1BTkQgJHtpfSAke2RvY2tlckNvbW1hbmRzLmpvaW4oJ1xcbicpfWApO1xuICAgIH1cblxuICAgIGNvbW1hbmRzLnB1c2goYGNhdCA+IERvY2tlcmZpbGUgPDwnRU9GR0lUSFVCUlVOTkVSU0RPQ0tFUkZJTEUnXFxuJHtkb2NrZXJmaWxlfVxcbkVPRkdJVEhVQlJVTk5FUlNET0NLRVJGSUxFYCk7XG5cbiAgICByZXR1cm4gW2NvbW1hbmRzLCBoYXNoZWRDb21wb25lbnRzXTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0QnVpbGRTcGVjKHJlcG9zaXRvcnk6IGVjci5SZXBvc2l0b3J5KTogW2NvZGVidWlsZC5CdWlsZFNwZWMsIHN0cmluZ10ge1xuICAgIGNvbnN0IHRoaXNTdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcblxuICAgIGxldCBhcmNoVXJsO1xuICAgIGlmICh0aGlzLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgYXJjaFVybCA9ICd4ODZfNjQnO1xuICAgIH0gZWxzZSBpZiAodGhpcy5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgYXJjaFVybCA9ICdhcm02NCc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIGZvciByZXF1aXJlZCBDb2RlQnVpbGQ6ICR7dGhpcy5hcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICB9XG5cbiAgICBjb25zdCBbY29tbWFuZHMsIGNvbW1hbmRzSGFzaGVkQ29tcG9uZW50c10gPSB0aGlzLmdldERvY2tlcmZpbGVHZW5lcmF0aW9uQ29tbWFuZHMoKTtcblxuICAgIGNvbnN0IGJ1aWxkU3BlY1ZlcnNpb24gPSAndjInOyAvLyBjaGFuZ2UgdGhpcyBldmVyeSB0aW1lIHRoZSBidWlsZCBzcGVjIGNoYW5nZXNcbiAgICBjb25zdCBoYXNoZWRDb21wb25lbnRzID0gY29tbWFuZHNIYXNoZWRDb21wb25lbnRzLmNvbmNhdChidWlsZFNwZWNWZXJzaW9uLCB0aGlzLmFyY2hpdGVjdHVyZS5uYW1lLCB0aGlzLmJhc2VJbWFnZS5pbWFnZSwgdGhpcy5vcy5uYW1lKTtcbiAgICBjb25zdCBoYXNoID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShoYXNoZWRDb21wb25lbnRzLmpvaW4oJ1xcbicpKS5kaWdlc3QoJ2hleCcpLnNsaWNlKDAsIDEwKTtcblxuICAgIGNvbnN0IGJ1aWxkU3BlYyA9IGNvZGVidWlsZC5CdWlsZFNwZWMuZnJvbU9iamVjdCh7XG4gICAgICB2ZXJzaW9uOiAwLjIsXG4gICAgICBlbnY6IHtcbiAgICAgICAgdmFyaWFibGVzOiB7XG4gICAgICAgICAgUkVQT19BUk46IHJlcG9zaXRvcnkucmVwb3NpdG9yeUFybixcbiAgICAgICAgICBSRVBPX1VSSTogcmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgICAgIFdBSVRfSEFORExFOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIEJBU0hfRU5WOiAnY29kZWJ1aWxkLWxvZy5zaCcsXG4gICAgICAgIH0sXG4gICAgICAgIHNoZWxsOiAnYmFzaCcsXG4gICAgICB9LFxuICAgICAgcGhhc2VzOiB7XG4gICAgICAgIC8vIHdlIGNhbid0IHVzZSBwcmVfYnVpbGQuIHRoZSB3YWl0IGhhbmRsZSB3aWxsIG5ldmVyIGNvbXBsZXRlIGlmIHByZV9idWlsZCBmYWlscyBhcyBwb3N0X2J1aWxkIHdvbid0IHJ1bi4gdGhpcyBjYW4gY2F1c2UgdGltZW91dHMgZHVyaW5nIGRlcGxveW1lbnQuXG4gICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgICdlY2hvIFwiZXhlYyA+ID4odGVlIC1hIC90bXAvY29kZWJ1aWxkLmxvZykgMj4mMVwiID4gY29kZWJ1aWxkLWxvZy5zaCcsXG4gICAgICAgICAgICBgYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gXCIkQVdTX0RFRkFVTFRfUkVHSU9OXCIgfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAke3RoaXNTdGFjay5hY2NvdW50fS5ka3IuZWNyLiR7dGhpc1N0YWNrLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsXG4gICAgICAgICAgICAuLi50aGlzLmRvY2tlclNldHVwQ29tbWFuZHMsXG4gICAgICAgICAgICAuLi5jb21tYW5kcyxcbiAgICAgICAgICAgICdkb2NrZXIgYnVpbGQgLS1wcm9ncmVzcyBwbGFpbiAuIC10IFwiJFJFUE9fVVJJXCInLFxuICAgICAgICAgICAgJ2RvY2tlciBwdXNoIFwiJFJFUE9fVVJJXCInLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHBvc3RfYnVpbGQ6IHtcbiAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgJ3JtIC1mIGNvZGVidWlsZC1sb2cuc2ggJiYgU1RBVFVTPVwiU1VDQ0VTU1wiJyxcbiAgICAgICAgICAgICdpZiBbICRDT0RFQlVJTERfQlVJTERfU1VDQ0VFRElORyAtbmUgMSBdOyB0aGVuIFNUQVRVUz1cIkZBSUxVUkVcIjsgZmknLFxuICAgICAgICAgICAgJ2NhdCA8PEVPRiA+IC90bXAvcGF5bG9hZC5qc29uXFxuJyArXG4gICAgICAgICAgICAne1xcbicgK1xuICAgICAgICAgICAgJyAgXCJTdGF0dXNcIjogXCIkU1RBVFVTXCIsXFxuJyArXG4gICAgICAgICAgICAnICBcIlVuaXF1ZUlkXCI6IFwiYnVpbGRcIixcXG4nICtcbiAgICAgICAgICAgIC8vIHdlIHJlbW92ZSBub24tcHJpbnRhYmxlIGNoYXJhY3RlcnMgZnJvbSB0aGUgbG9nIGJlY2F1c2UgQ2xvdWRGb3JtYXRpb24gZG9lc24ndCBsaWtlIHRoZW1cbiAgICAgICAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MtY2xvdWRmb3JtYXRpb24vY2xvdWRmb3JtYXRpb24tY292ZXJhZ2Utcm9hZG1hcC9pc3N1ZXMvMTYwMVxuICAgICAgICAgICAgJyAgXCJSZWFzb25cIjogYHNlZCBcXCdzL1teWzpwcmludDpdXS8vZ1xcJyAvdG1wL2NvZGVidWlsZC5sb2cgfCB0YWlsIC1jIDQwMCB8IGpxIC1Sc2EgLmAsXFxuJyArXG4gICAgICAgICAgICAvLyBmb3IgbGFtYmRhIGFsd2F5cyBnZXQgYSBuZXcgdmFsdWUgYmVjYXVzZSB0aGVyZSBpcyBhbHdheXMgYSBuZXcgaW1hZ2UgaGFzaFxuICAgICAgICAgICAgJyAgXCJEYXRhXCI6IFwiJFJBTkRPTVwiXFxuJyArXG4gICAgICAgICAgICAnfVxcbicgK1xuICAgICAgICAgICAgJ0VPRicsXG4gICAgICAgICAgICAnaWYgWyBcIiRXQUlUX0hBTkRMRVwiICE9IFwidW5zcGVjaWZpZWRcIiBdOyB0aGVuIGpxIC4gL3RtcC9wYXlsb2FkLmpzb247IGN1cmwgLWZzU0wgLVggUFVUIC1IIFwiQ29udGVudC1UeXBlOlwiIC1kIFwiQC90bXAvcGF5bG9hZC5qc29uXCIgXCIkV0FJVF9IQU5ETEVcIjsgZmknLFxuICAgICAgICAgICAgLy8gZ2VuZXJhdGUgYW5kIHB1c2ggc29jaSBpbmRleFxuICAgICAgICAgICAgLy8gd2UgZG8gdGhpcyBhZnRlciBmaW5pc2hpbmcgdGhlIGJ1aWxkLCBzbyB3ZSBkb24ndCBoYXZlIHRvIHdhaXQuIGl0J3MgYWxzbyBub3QgcmVxdWlyZWQsIHNvIGl0J3Mgb2sgaWYgaXQgZmFpbHNcbiAgICAgICAgICAgICdpZiBbIGBkb2NrZXIgaW5zcGVjdCAtLWZvcm1hdD1cXCd7e2pzb24gLkNvbmZpZy5MYWJlbHMuRElTQUJMRV9TT0NJfX1cXCcgXCIkUkVQT19VUklcImAgPSBcIm51bGxcIiBdOyB0aGVuXFxuJyArXG4gICAgICAgICAgICAnZG9ja2VyIHJtaSBcIiRSRVBPX1VSSVwiXFxuJyArIC8vIGl0IGRvd25sb2FkcyB0aGUgaW1hZ2UgYWdhaW4gdG8gL3RtcCwgc28gc2F2ZSBvbiBzcGFjZVxuICAgICAgICAgICAgJ0xBVEVTVF9TT0NJX1ZFUlNJT049YGN1cmwgLXcgXCIle3JlZGlyZWN0X3VybH1cIiAtZnNTIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvc3RhbmRhbG9uZS1zb2NpLWluZGV4ZXIvcmVsZWFzZXMvbGF0ZXN0IHwgZ3JlcCAtb0UgXCJbXi9dKyRcImBcXG4nICtcbiAgICAgICAgICAgIGBjdXJsIC1mc1NMIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvc3RhbmRhbG9uZS1zb2NpLWluZGV4ZXIvcmVsZWFzZXMvZG93bmxvYWQvJFxce0xBVEVTVF9TT0NJX1ZFUlNJT059L3N0YW5kYWxvbmUtc29jaS1pbmRleGVyX0xpbnV4XyR7YXJjaFVybH0udGFyLmd6IHwgdGFyIHh6XFxuYCArXG4gICAgICAgICAgICAnLi9zdGFuZGFsb25lLXNvY2ktaW5kZXhlciBcIiRSRVBPX1VSSVwiXFxuJyArXG4gICAgICAgICAgICAnZmknLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIFtidWlsZFNwZWMsIGhhc2hdO1xuICB9XG5cbiAgcHJpdmF0ZSBjdXN0b21SZXNvdXJjZShwcm9qZWN0OiBjb2RlYnVpbGQuUHJvamVjdCwgYnVpbGRTcGVjSGFzaDogc3RyaW5nKSB7XG4gICAgY29uc3QgY3JIYW5kbGVyID0gc2luZ2xldG9uTGFtYmRhKEJ1aWxkSW1hZ2VGdW5jdGlvbiwgdGhpcywgJ2J1aWxkLWltYWdlJywge1xuICAgICAgZGVzY3JpcHRpb246ICdDdXN0b20gcmVzb3VyY2UgaGFuZGxlciB0aGF0IHRyaWdnZXJzIENvZGVCdWlsZCB0byBidWlsZCBydW5uZXIgaW1hZ2VzJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMpLFxuICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuUlVOTkVSX0lNQUdFX0JVSUxEKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgfSk7XG5cbiAgICBjb25zdCBwb2xpY3kgPSBuZXcgaWFtLlBvbGljeSh0aGlzLCAnQ1IgUG9saWN5Jywge1xuICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgYWN0aW9uczogWydjb2RlYnVpbGQ6U3RhcnRCdWlsZCddLFxuICAgICAgICAgIHJlc291cmNlczogW3Byb2plY3QucHJvamVjdEFybl0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBjckhhbmRsZXIucm9sZSEuYXR0YWNoSW5saW5lUG9saWN5KHBvbGljeSk7XG5cbiAgICBsZXQgd2FpdEhhbmRsZVJlZiA9ICd1bnNwZWNpZmllZCc7XG4gICAgbGV0IHdhaXREZXBlbmRhYmxlID0gJyc7XG5cbiAgICBpZiAodGhpcy53YWl0T25EZXBsb3kpIHtcbiAgICAgIC8vIFdhaXQgaGFuZGxlIGxldHMgdXMgd2FpdCBmb3IgbG9uZ2VyIHRoYW4gYW4gaG91ciBmb3IgdGhlIGltYWdlIGJ1aWxkIHRvIGNvbXBsZXRlLlxuICAgICAgLy8gV2UgZ2VuZXJhdGUgYSBuZXcgd2FpdCBoYW5kbGUgZm9yIGJ1aWxkIHNwZWMgY2hhbmdlcyB0byBndWFyYW50ZWUgYSBuZXcgaW1hZ2UgaXMgYnVpbHQuXG4gICAgICAvLyBUaGlzIGFsc28gaGVscHMgbWFrZSBzdXJlIHRoZSBjaGFuZ2VzIGFyZSBnb29kLiBJZiB0aGV5IGhhdmUgYSBidWcsIHRoZSBkZXBsb3ltZW50IHdpbGwgZmFpbCBpbnN0ZWFkIG9mIGp1c3QgdGhlIHNjaGVkdWxlZCBidWlsZC5cbiAgICAgIC8vIEZpbmFsbHksIGl0J3MgcmVjb21tZW5kZWQgYnkgQ2xvdWRGb3JtYXRpb24gZG9jcyB0byBub3QgcmV1c2Ugd2FpdCBoYW5kbGVzIG9yIG9sZCByZXNwb25zZXMgbWF5IGludGVyZmVyZSBpbiBzb21lIGNhc2VzLlxuICAgICAgY29uc3QgaGFuZGxlID0gbmV3IGNsb3VkZm9ybWF0aW9uLkNmbldhaXRDb25kaXRpb25IYW5kbGUodGhpcywgYEJ1aWxkIFdhaXQgSGFuZGxlICR7YnVpbGRTcGVjSGFzaH1gKTtcbiAgICAgIGNvbnN0IHdhaXQgPSBuZXcgY2xvdWRmb3JtYXRpb24uQ2ZuV2FpdENvbmRpdGlvbih0aGlzLCBgQnVpbGQgV2FpdCAke2J1aWxkU3BlY0hhc2h9YCwge1xuICAgICAgICBoYW5kbGU6IGhhbmRsZS5yZWYsXG4gICAgICAgIHRpbWVvdXQ6IHRoaXMudGltZW91dC50b1NlY29uZHMoKS50b1N0cmluZygpLCAvLyBkb24ndCB3YWl0IGxvbmdlciB0aGFuIHRoZSBidWlsZCB0aW1lb3V0XG4gICAgICAgIGNvdW50OiAxLFxuICAgICAgfSk7XG4gICAgICB3YWl0SGFuZGxlUmVmID0gaGFuZGxlLnJlZjtcbiAgICAgIHdhaXREZXBlbmRhYmxlID0gd2FpdC5yZWY7XG4gICAgfVxuXG4gICAgY29uc3QgY3IgPSBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0J1aWxkZXInLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGNySGFuZGxlci5mdW5jdGlvbkFybixcbiAgICAgIHJlc291cmNlVHlwZTogJ0N1c3RvbTo6SW1hZ2VCdWlsZGVyJyxcbiAgICAgIHByb3BlcnRpZXM6IDxCdWlsZEltYWdlRnVuY3Rpb25Qcm9wZXJ0aWVzPntcbiAgICAgICAgUmVwb05hbWU6IHRoaXMucmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZSxcbiAgICAgICAgUHJvamVjdE5hbWU6IHByb2plY3QucHJvamVjdE5hbWUsXG4gICAgICAgIFdhaXRIYW5kbGU6IHdhaXRIYW5kbGVSZWYsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gYWRkIGRlcGVuZGVuY2llcyB0byBtYWtlIHN1cmUgcmVzb3VyY2VzIGFyZSB0aGVyZSB3aGVuIHdlIG5lZWQgdGhlbVxuICAgIGNyLm5vZGUuYWRkRGVwZW5kZW5jeShwcm9qZWN0KTtcbiAgICBjci5ub2RlLmFkZERlcGVuZGVuY3kodGhpcy5yb2xlKTtcbiAgICBjci5ub2RlLmFkZERlcGVuZGVuY3kocG9saWN5KTtcbiAgICBjci5ub2RlLmFkZERlcGVuZGVuY3koY3JIYW5kbGVyLnJvbGUhKTtcbiAgICBjci5ub2RlLmFkZERlcGVuZGVuY3koY3JIYW5kbGVyKTtcblxuICAgIHJldHVybiB3YWl0RGVwZW5kYWJsZTsgLy8gdXNlciBuZWVkcyB0byB3YWl0IG9uIHdhaXQgaGFuZGxlIHdoaWNoIGlzIHRyaWdnZXJlZCB3aGVuIHRoZSBpbWFnZSBpcyBidWlsdFxuICB9XG5cbiAgcHJpdmF0ZSByZWJ1aWxkSW1hZ2VPblNjaGVkdWxlKHByb2plY3Q6IGNvZGVidWlsZC5Qcm9qZWN0LCByZWJ1aWxkSW50ZXJ2YWw/OiBEdXJhdGlvbikge1xuICAgIHJlYnVpbGRJbnRlcnZhbCA9IHJlYnVpbGRJbnRlcnZhbCA/PyBEdXJhdGlvbi5kYXlzKDcpO1xuICAgIGlmIChyZWJ1aWxkSW50ZXJ2YWwudG9NaWxsaXNlY29uZHMoKSAhPSAwKSB7XG4gICAgICBjb25zdCBzY2hlZHVsZVJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ0J1aWxkIFNjaGVkdWxlJywge1xuICAgICAgICBkZXNjcmlwdGlvbjogYFJlYnVpbGQgcnVubmVyIGltYWdlIGZvciAke3RoaXMucmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZX1gLFxuICAgICAgICBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLnJhdGUocmVidWlsZEludGVydmFsKSxcbiAgICAgIH0pO1xuICAgICAgc2NoZWR1bGVSdWxlLmFkZFRhcmdldChuZXcgZXZlbnRzX3RhcmdldHMuQ29kZUJ1aWxkUHJvamVjdChwcm9qZWN0KSk7XG4gICAgfVxuICB9XG5cbiAgZ2V0IGNvbm5lY3Rpb25zKCk6IGVjMi5Db25uZWN0aW9ucyB7XG4gICAgcmV0dXJuIG5ldyBlYzIuQ29ubmVjdGlvbnMoe1xuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgfSk7XG4gIH1cblxuICBnZXQgZ3JhbnRQcmluY2lwYWwoKTogaWFtLklQcmluY2lwYWwge1xuICAgIHJldHVybiB0aGlzLnJvbGU7XG4gIH1cbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNsYXNzIENvZGVCdWlsZEltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIgaW1wbGVtZW50cyBjZGsuSUFzcGVjdCB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgdG9waWM6IHNucy5JVG9waWMpIHtcbiAgfVxuXG4gIHB1YmxpYyB2aXNpdChub2RlOiBJQ29uc3RydWN0KTogdm9pZCB7XG4gICAgaWYgKG5vZGUgaW5zdGFuY2VvZiBDb2RlQnVpbGRSdW5uZXJJbWFnZUJ1aWxkZXIpIHtcbiAgICAgIGNvbnN0IGJ1aWxkZXIgPSBub2RlIGFzIENvZGVCdWlsZFJ1bm5lckltYWdlQnVpbGRlcjtcbiAgICAgIGNvbnN0IHByb2plY3ROb2RlID0gYnVpbGRlci5ub2RlLnRyeUZpbmRDaGlsZCgnQ29kZUJ1aWxkJyk7XG4gICAgICBpZiAocHJvamVjdE5vZGUpIHtcbiAgICAgICAgY29uc3QgcHJvamVjdCA9IHByb2plY3ROb2RlIGFzIGNvZGVidWlsZC5Qcm9qZWN0O1xuICAgICAgICBwcm9qZWN0Lm5vdGlmeU9uQnVpbGRGYWlsZWQoJ0J1aWxkRmFpbGVkJywgdGhpcy50b3BpYyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YoYnVpbGRlcikuYWRkV2FybmluZygnVW51c2VkIGJ1aWxkZXIgY2Fubm90IGdldCBub3RpZmljYXRpb25zIG9mIGZhaWxlZCBidWlsZHMnKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==