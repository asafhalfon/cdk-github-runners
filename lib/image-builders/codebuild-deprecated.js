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
exports.CodeBuildImageBuilder = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const crypto = __importStar(require("crypto"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_codebuild_1 = require("aws-cdk-lib/aws-codebuild");
const aws_ecr_1 = require("aws-cdk-lib/aws-ecr");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const constructs_1 = require("constructs");
const build_image_function_1 = require("./build-image-function");
const providers_1 = require("../providers");
const utils_1 = require("../utils");
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
class CodeBuildImageBuilder extends constructs_1.Construct {
    props;
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.CodeBuildImageBuilder", version: "0.0.0" };
    /**
     * Bump this number every time the buildspec or any important setting of the project changes. It will force a rebuild of the image.
     * @private
     */
    static BUILDSPEC_VERSION = 2;
    architecture;
    os;
    repository;
    dockerfile;
    preBuild = [];
    postBuild = [];
    buildArgs = new Map();
    policyStatements = [];
    secondaryAssets = new Map();
    buildImage;
    boundImage;
    constructor(scope, id, props) {
        super(scope, id);
        this.props = props;
        if (props.subnetSelection?.subnetType == aws_cdk_lib_1.aws_ec2.SubnetType.PRIVATE_ISOLATED) {
            aws_cdk_lib_1.Annotations.of(this).addWarning('Private isolated subnets cannot pull from public ECR and VPC endpoint is not supported yet. ' +
                'See https://github.com/aws/containers-roadmap/issues/1160');
        }
        // set platform
        this.architecture = props.architecture ?? providers_1.Architecture.X86_64;
        this.os = props.os ?? providers_1.Os.LINUX;
        // create repository that only keeps one tag
        this.repository = new aws_cdk_lib_1.aws_ecr.Repository(this, 'Repository', {
            imageScanOnPush: true,
            imageTagMutability: aws_ecr_1.TagMutability.MUTABLE,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            lifecycleRules: [
                {
                    description: 'Remove untagged images that have been replaced by CodeBuild',
                    tagStatus: aws_ecr_1.TagStatus.UNTAGGED,
                    maxImageAge: aws_cdk_lib_1.Duration.days(1),
                },
            ],
        });
        // upload Dockerfile to S3 as an asset
        this.dockerfile = new aws_cdk_lib_1.aws_s3_assets.Asset(this, 'Dockerfile', {
            path: props.dockerfilePath,
        });
        // choose build image
        this.buildImage = props?.buildImage ?? this.getBuildImage();
    }
    /**
     * Uploads a folder to the build server at a given folder name.
     *
     * @param sourcePath path to source directory
     * @param destName name of destination folder
     */
    addFiles(sourcePath, destName) {
        if (this.boundImage) {
            throw new Error('Image is already bound. Use this method before passing the builder to a runner provider.');
        }
        const asset = new aws_cdk_lib_1.aws_s3_assets.Asset(this, destName, { path: sourcePath });
        this.secondaryAssets.set(destName, asset);
        this.preBuild.push(`rm -rf "${destName}" && cp -r "$CODEBUILD_SRC_DIR_${destName}" "${destName}"`); // symlinks don't work with docker
    }
    /**
     * Adds a command that runs before `docker build`.
     *
     * @param command command to add
     */
    addPreBuildCommand(command) {
        if (this.boundImage) {
            throw new Error('Image is already bound. Use this method before passing the builder to a runner provider.');
        }
        this.preBuild.push(command);
    }
    /**
     * Adds a command that runs after `docker build` and `docker push`.
     *
     * @param command command to add
     */
    addPostBuildCommand(command) {
        if (this.boundImage) {
            throw new Error('Image is already bound. Use this method before passing the builder to a runner provider.');
        }
        this.postBuild.push(command);
    }
    /**
     * Adds a build argument for Docker. See the documentation for the Dockerfile you're using for a list of supported build arguments.
     *
     * @param name build argument name
     * @param value build argument value
     */
    setBuildArg(name, value) {
        if (this.boundImage) {
            throw new Error('Image is already bound. Use this method before passing the builder to a runner provider.');
        }
        this.buildArgs.set(name, value);
    }
    /**
     * Add a policy statement to the builder to access resources required to the image build.
     *
     * @param statement IAM policy statement
     */
    addPolicyStatement(statement) {
        if (this.boundImage) {
            throw new Error('Image is already bound. Use this method before passing the builder to a runner provider.');
        }
        this.policyStatements.push(statement);
    }
    /**
     * Add extra trusted certificates. This helps deal with self-signed certificates for GitHub Enterprise Server.
     *
     * All first party Dockerfiles support this. Others may not.
     *
     * @param path path to directory containing a file called certs.pem containing all the required certificates
     */
    addExtraCertificates(path) {
        if (this.boundImage) {
            throw new Error('Image is already bound. Use this method before passing the builder to a runner provider.');
        }
        this.addFiles(path, 'extra_certs');
    }
    /**
     * Called by IRunnerProvider to finalize settings and create the image builder.
     */
    bindDockerImage() {
        if (this.boundImage) {
            return this.boundImage;
        }
        // log group for the image builds
        const logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'Logs', {
            retention: this.props.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
            removalPolicy: this.props.logRemovalPolicy ?? aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        // generate buildSpec
        const buildSpec = this.getBuildSpec(this.repository, logGroup, this.props.runnerVersion);
        // create CodeBuild project that builds Dockerfile and pushes to repository
        const project = new aws_cdk_lib_1.aws_codebuild.Project(this, 'CodeBuild', {
            description: `Build docker image for self-hosted GitHub runner ${this.node.path} (${this.os.name}/${this.architecture.name})`,
            buildSpec: aws_cdk_lib_1.aws_codebuild.BuildSpec.fromObject(buildSpec),
            source: aws_cdk_lib_1.aws_codebuild.Source.s3({
                bucket: this.dockerfile.bucket,
                path: this.dockerfile.s3ObjectKey,
            }),
            vpc: this.props.vpc,
            securityGroups: this.props.securityGroup ? [this.props.securityGroup] : undefined,
            subnetSelection: this.props.subnetSelection,
            timeout: this.props.timeout ?? aws_cdk_lib_1.Duration.hours(1),
            environment: {
                buildImage: this.buildImage,
                computeType: this.props.computeType ?? aws_codebuild_1.ComputeType.SMALL,
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
        this.policyStatements.forEach(project.addToRolePolicy);
        // call CodeBuild during deployment and delete all images from repository during destruction
        const cr = this.customResource(project);
        // rebuild image on a schedule
        this.rebuildImageOnSchedule(project, this.props.rebuildInterval);
        for (const [assetPath, asset] of this.secondaryAssets.entries()) {
            project.addSecondarySource(aws_cdk_lib_1.aws_codebuild.Source.s3({
                identifier: assetPath,
                bucket: asset.bucket,
                path: asset.s3ObjectKey,
            }));
        }
        this.boundImage = {
            imageRepository: this.repository,
            imageTag: 'latest',
            architecture: this.architecture,
            os: this.os,
            logGroup,
            runnerVersion: this.props.runnerVersion ?? providers_1.RunnerVersion.latest(),
            _dependable: cr,
        };
        return this.boundImage;
    }
    getBuildImage() {
        if (this.os.is(providers_1.Os.LINUX)) {
            if (this.architecture.is(providers_1.Architecture.X86_64)) {
                return aws_cdk_lib_1.aws_codebuild.LinuxBuildImage.STANDARD_6_0;
            }
            else if (this.architecture.is(providers_1.Architecture.ARM64)) {
                return aws_cdk_lib_1.aws_codebuild.LinuxArmBuildImage.AMAZON_LINUX_2_STANDARD_2_0;
            }
        }
        if (this.os.is(providers_1.Os.WINDOWS)) {
            throw new Error('CodeBuild cannot be used to build Windows Docker images https://github.com/docker-library/docker/issues/49');
        }
        throw new Error(`Unable to find CodeBuild image for ${this.os.name}/${this.architecture.name}`);
    }
    getBuildSpec(repository, logGroup, runnerVersion) {
        // don't forget to change BUILDSPEC_VERSION when the buildSpec changes, and you want to trigger a rebuild on deploy
        let buildArgs = '';
        for (const [name, value] of this.buildArgs.entries()) {
            buildArgs += ` --build-arg "${name}"="${value}"`;
        }
        buildArgs += ` --build-arg RUNNER_VERSION="${runnerVersion ? runnerVersion.version : providers_1.RunnerVersion.latest().version}"`;
        const thisStack = cdk.Stack.of(this);
        return {
            version: 0.2,
            env: {
                variables: {
                    REPO_ARN: repository.repositoryArn,
                    REPO_URI: repository.repositoryUri,
                    STACK_ID: 'unspecified',
                    REQUEST_ID: 'unspecified',
                    LOGICAL_RESOURCE_ID: 'unspecified',
                    RESPONSE_URL: 'unspecified',
                    RUNNER_VERSION: runnerVersion ? runnerVersion.version : providers_1.RunnerVersion.latest().version,
                },
            },
            phases: {
                pre_build: {
                    commands: this.preBuild.concat([
                        'mkdir -p extra_certs',
                        `aws ecr get-login-password --region "$AWS_DEFAULT_REGION" | docker login --username AWS --password-stdin ${thisStack.account}.dkr.ecr.${thisStack.region}.amazonaws.com`,
                    ]),
                },
                build: {
                    commands: [
                        `docker build . -t "$REPO_URI" ${buildArgs}`,
                        'docker push "$REPO_URI"',
                    ],
                },
                post_build: {
                    commands: this.postBuild.concat([
                        'STATUS="SUCCESS"',
                        'if [ $CODEBUILD_BUILD_SUCCEEDING -ne 1 ]; then STATUS="FAILED"; fi',
                        'cat <<EOF > /tmp/payload.json\n' +
                            '{\n' +
                            '  "StackId": "$STACK_ID",\n' +
                            '  "RequestId": "$REQUEST_ID",\n' +
                            '  "LogicalResourceId": "$LOGICAL_RESOURCE_ID",\n' +
                            '  "PhysicalResourceId": "$REPO_ARN",\n' +
                            '  "Status": "$STATUS",\n' +
                            `  "Reason": "See logs in ${logGroup.logGroupName}/$CODEBUILD_LOG_PATH (deploy again with \'cdk deploy -R\' or logRemovalPolicy=RemovalPolicy.RETAIN if they are already deleted)",\n` +
                            `  "Data": {"Name": "${repository.repositoryName}"}\n` +
                            '}\n' +
                            'EOF',
                        'if [ "$RESPONSE_URL" != "unspecified" ]; then jq . /tmp/payload.json; curl -fsSL -X PUT -H "Content-Type:" -d "@/tmp/payload.json" "$RESPONSE_URL"; fi',
                    ]),
                },
            },
        };
    }
    customResource(project) {
        const crHandler = (0, utils_1.singletonLambda)(build_image_function_1.BuildImageFunction, this, 'build-image', {
            description: 'Custom resource handler that triggers CodeBuild to build runner images, and cleans-up images on deletion',
            timeout: cdk.Duration.minutes(3),
            logRetention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
        });
        const policy = new aws_cdk_lib_1.aws_iam.Policy(this, 'CR Policy', {
            statements: [
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: ['codebuild:StartBuild'],
                    resources: [project.projectArn],
                }),
                new aws_cdk_lib_1.aws_iam.PolicyStatement({
                    actions: ['ecr:BatchDeleteImage', 'ecr:ListImages'],
                    resources: [this.repository.repositoryArn],
                }),
            ],
        });
        crHandler.role?.attachInlinePolicy(policy);
        const cr = new aws_cdk_lib_1.CustomResource(this, 'Builder', {
            serviceToken: crHandler.functionArn,
            resourceType: 'Custom::ImageBuilder',
            properties: {
                RepoName: this.repository.repositoryName,
                ProjectName: project.projectName,
                // We include a hash so the image is built immediately on changes, and we don't have to wait for its scheduled build.
                // This also helps make sure the changes are good. If they have a bug, the deployment will fail instead of just the scheduled build.
                BuildHash: this.hashBuildSettings(),
            },
        });
        // add dependencies to make sure resources are there when we need them
        cr.node.addDependency(project);
        cr.node.addDependency(policy);
        cr.node.addDependency(crHandler);
        return cr;
    }
    /**
     * Return hash of all settings that can affect the result image so we can trigger the build when it changes.
     * @private
     */
    hashBuildSettings() {
        // main Dockerfile
        let components = [this.dockerfile.assetHash];
        // all additional files
        for (const [name, asset] of this.secondaryAssets.entries()) {
            components.push(name);
            components.push(asset.assetHash);
        }
        // buildspec.yml version
        components.push(`v${CodeBuildImageBuilder.BUILDSPEC_VERSION}`);
        // runner version
        components.push(this.props.runnerVersion?.version ?? providers_1.RunnerVersion.latest().version);
        // user commands
        components = components.concat(this.preBuild);
        components = components.concat(this.postBuild);
        for (const [name, value] of this.buildArgs.entries()) {
            components.push(name);
            components.push(value);
        }
        // hash it
        const all = components.join('-');
        return crypto.createHash('md5').update(all).digest('hex');
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
            securityGroups: this.props.securityGroup ? [this.props.securityGroup] : [],
        });
    }
    bindAmi() {
        throw new Error('CodeBuildImageBuilder does not support building AMIs');
    }
}
exports.CodeBuildImageBuilder = CodeBuildImageBuilder;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWJ1aWxkLWRlcHJlY2F0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW1hZ2UtYnVpbGRlcnMvY29kZWJ1aWxkLWRlcHJlY2F0ZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLCtDQUFpQztBQUNqQyxpREFBbUM7QUFDbkMsNkNBYXFCO0FBQ3JCLDZEQUF3RDtBQUN4RCxpREFBK0Q7QUFDL0QsbURBQXFEO0FBQ3JELDJDQUF1QztBQUN2QyxpRUFBNEQ7QUFFNUQsNENBQXVGO0FBQ3ZGLG9DQUEyQztBQWtIM0M7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBdUJHO0FBQ0gsTUFBYSxxQkFBc0IsU0FBUSxzQkFBUztJQW1CQzs7SUFsQm5EOzs7T0FHRztJQUNLLE1BQU0sQ0FBQyxpQkFBaUIsR0FBRyxDQUFDLENBQUM7SUFFcEIsWUFBWSxDQUFlO0lBQzNCLEVBQUUsQ0FBSztJQUNQLFVBQVUsQ0FBaUI7SUFDM0IsVUFBVSxDQUFrQjtJQUNyQyxRQUFRLEdBQWEsRUFBRSxDQUFDO0lBQ3hCLFNBQVMsR0FBYSxFQUFFLENBQUM7SUFDekIsU0FBUyxHQUF3QixJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQzNDLGdCQUFnQixHQUEwQixFQUFFLENBQUM7SUFDN0MsZUFBZSxHQUFpQyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQ2pELFVBQVUsQ0FBd0I7SUFDM0MsVUFBVSxDQUFlO0lBRWpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQVcsS0FBaUM7UUFDbEYsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQURnQyxVQUFLLEdBQUwsS0FBSyxDQUE0QjtRQUdsRixJQUFJLEtBQUssQ0FBQyxlQUFlLEVBQUUsVUFBVSxJQUFJLHFCQUFHLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDekUseUJBQVcsQ0FBQyxFQUFFLENBQUMs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dCI6WyJpbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnY3J5cHRvJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBBbm5vdGF0aW9ucyxcbiAgYXdzX2NvZGVidWlsZCBhcyBjb2RlYnVpbGQsXG4gIGF3c19lYzIgYXMgZWMyLFxuICBhd3NfZWNyIGFzIGVjcixcbiAgYXdzX2V2ZW50cyBhcyBldmVudHMsXG4gIGF3c19ldmVudHNfdGFyZ2V0cyBhcyBldmVudHNfdGFyZ2V0cyxcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zM19hc3NldHMgYXMgczNfYXNzZXRzLFxuICBDdXN0b21SZXNvdXJjZSxcbiAgRHVyYXRpb24sXG4gIFJlbW92YWxQb2xpY3ksXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbXB1dGVUeXBlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgeyBUYWdNdXRhYmlsaXR5LCBUYWdTdGF0dXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEJ1aWxkSW1hZ2VGdW5jdGlvbiB9IGZyb20gJy4vYnVpbGQtaW1hZ2UtZnVuY3Rpb24nO1xuaW1wb3J0IHsgSVJ1bm5lckltYWdlQnVpbGRlciB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IEFyY2hpdGVjdHVyZSwgT3MsIFJ1bm5lckFtaSwgUnVubmVySW1hZ2UsIFJ1bm5lclZlcnNpb24gfSBmcm9tICcuLi9wcm92aWRlcnMnO1xuaW1wb3J0IHsgc2luZ2xldG9uTGFtYmRhIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKlxuQVdTIEltYWdlIEJ1aWxkZXIgd2FzIG5vdCB1c2VkIGJlY2F1c2U6XG4gIDEuIEl0J3MgdG9vIHNsb3cuIEl0IGhhcyB3ZWlyZCAxNSBtaW51dGVzIG92ZXJoZWFkIHdoZXJlIGl0IHNlZW1zIHRvIGp1c3QgYmUgd2FpdGluZy5cbiAgMi4gTm8gZWFzeSBsb2cgdmlzaWJpbGl0eS5cbiAgMy4gVmVyc2lvbnMgbmVlZCB0byBiZSBidW1wZWQgbWFudWFsbHkuXG4gKi9cblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBDb2RlQnVpbGRJbWFnZUJ1aWxkZXIgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvZGVCdWlsZEltYWdlQnVpbGRlclByb3BzIHtcbiAgLyoqXG4gICAqIEltYWdlIGFyY2hpdGVjdHVyZS5cbiAgICpcbiAgICogQGRlZmF1bHQgQXJjaGl0ZWN0dXJlLlg4Nl82NFxuICAgKi9cbiAgcmVhZG9ubHkgYXJjaGl0ZWN0dXJlPzogQXJjaGl0ZWN0dXJlO1xuXG4gIC8qKlxuICAgKiBJbWFnZSBPUy5cbiAgICpcbiAgICogQGRlZmF1bHQgT1MuTElOVVhcbiAgICovXG4gIHJlYWRvbmx5IG9zPzogT3M7XG5cbiAgLyoqXG4gICAqIFBhdGggdG8gRG9ja2VyZmlsZSB0byBiZSBidWlsdC4gSXQgY2FuIGJlIGEgcGF0aCB0byBhIERvY2tlcmZpbGUsIGEgZm9sZGVyIGNvbnRhaW5pbmcgYSBEb2NrZXJmaWxlLCBvciBhIHppcCBmaWxlIGNvbnRhaW5pbmcgYSBEb2NrZXJmaWxlLlxuICAgKi9cbiAgcmVhZG9ubHkgZG9ja2VyZmlsZVBhdGg6IHN0cmluZztcblxuICAvKipcbiAgICogVmVyc2lvbiBvZiBHaXRIdWIgUnVubmVycyB0byBpbnN0YWxsLlxuICAgKlxuICAgKiBAZGVmYXVsdCBsYXRlc3QgdmVyc2lvbiBhdmFpbGFibGVcbiAgICovXG4gIHJlYWRvbmx5IHJ1bm5lclZlcnNpb24/OiBSdW5uZXJWZXJzaW9uO1xuXG4gIC8qKlxuICAgKiBTY2hlZHVsZSB0aGUgaW1hZ2UgdG8gYmUgcmVidWlsdCBldmVyeSBnaXZlbiBpbnRlcnZhbC4gVXNlZnVsIGZvciBrZWVwaW5nIHRoZSBpbWFnZSB1cC1kby1kYXRlIHdpdGggdGhlIGxhdGVzdCBHaXRIdWIgcnVubmVyIHZlcnNpb24gYW5kIGxhdGVzdCBPUyB1cGRhdGVzLlxuICAgKlxuICAgKiBTZXQgdG8gemVybyB0byBkaXNhYmxlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBEdXJhdGlvbi5kYXlzKDcpXG4gICAqL1xuICByZWFkb25seSByZWJ1aWxkSW50ZXJ2YWw/OiBEdXJhdGlvbjtcblxuICAvKipcbiAgICogVlBDIHRvIGJ1aWxkIHRoZSBpbWFnZSBpbi5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gVlBDXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU2VjdXJpdHkgR3JvdXAgdG8gYXNzaWduIHRvIHRoaXMgaW5zdGFuY2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IHB1YmxpYyBwcm9qZWN0IHdpdGggbm8gc2VjdXJpdHkgZ3JvdXBcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA/OiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFdoZXJlIHRvIHBsYWNlIHRoZSBuZXR3b3JrIGludGVyZmFjZXMgd2l0aGluIHRoZSBWUEMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIHN1Ym5ldFxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogVGhlIHR5cGUgb2YgY29tcHV0ZSB0byB1c2UgZm9yIHRoaXMgYnVpbGQuXG4gICAqIFNlZSB0aGUge0BsaW5rIENvbXB1dGVUeXBlfSBlbnVtIGZvciB0aGUgcG9zc2libGUgdmFsdWVzLlxuICAgKlxuICAgKiBAZGVmYXVsdCB7QGxpbmsgQ29tcHV0ZVR5cGUjU01BTEx9XG4gICAqL1xuICByZWFkb25seSBjb21wdXRlVHlwZT86IGNvZGVidWlsZC5Db21wdXRlVHlwZTtcblxuICAvKipcbiAgICogQnVpbGQgaW1hZ2UgdG8gdXNlIGluIENvZGVCdWlsZC4gVGhpcyBpcyB0aGUgaW1hZ2UgdGhhdCdzIGdvaW5nIHRvIHJ1biB0aGUgY29kZSB0aGF0IGJ1aWxkcyB0aGUgcnVubmVyIGltYWdlLlxuICAgKlxuICAgKiBUaGUgb25seSBhY3Rpb24gdGFrZW4gaW4gQ29kZUJ1aWxkIGlzIHJ1bm5pbmcgYGRvY2tlciBidWlsZGAuIFlvdSB3b3VsZCB0aGVyZWZvcmUgbm90IG5lZWQgdG8gY2hhbmdlIHRoaXMgc2V0dGluZyBvZnRlbi5cbiAgICpcbiAgICogQGRlZmF1bHQgVWJ1bnR1IDIyLjA0IGZvciB4NjQgYW5kIEFtYXpvbiBMaW51eCAyIGZvciBBUk02NFxuICAgKi9cbiAgcmVhZG9ubHkgYnVpbGRJbWFnZT86IGNvZGVidWlsZC5JQnVpbGRJbWFnZTtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBtaW51dGVzIGFmdGVyIHdoaWNoIEFXUyBDb2RlQnVpbGQgc3RvcHMgdGhlIGJ1aWxkIGlmIGl0J3NcbiAgICogbm90IGNvbXBsZXRlLiBGb3IgdmFsaWQgdmFsdWVzLCBzZWUgdGhlIHRpbWVvdXRJbk1pbnV0ZXMgZmllbGQgaW4gdGhlIEFXU1xuICAgKiBDb2RlQnVpbGQgVXNlciBHdWlkZS5cbiAgICpcbiAgICogQGRlZmF1bHQgRHVyYXRpb24uaG91cnMoMSlcbiAgICovXG4gIHJlYWRvbmx5IHRpbWVvdXQ/OiBEdXJhdGlvbjtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBkYXlzIGxvZyBldmVudHMgYXJlIGtlcHQgaW4gQ2xvdWRXYXRjaCBMb2dzLiBXaGVuIHVwZGF0aW5nXG4gICAqIHRoaXMgcHJvcGVydHksIHVuc2V0dGluZyBpdCBkb2Vzbid0IHJlbW92ZSB0aGUgbG9nIHJldGVudGlvbiBwb2xpY3kuIFRvXG4gICAqIHJlbW92ZSB0aGUgcmV0ZW50aW9uIHBvbGljeSwgc2V0IHRoZSB2YWx1ZSB0byBgSU5GSU5JVEVgLlxuICAgKlxuICAgKiBAZGVmYXVsdCBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRIXG4gICAqL1xuICByZWFkb25seSBsb2dSZXRlbnRpb24/OiBsb2dzLlJldGVudGlvbkRheXM7XG5cbiAgLyoqXG4gICAqIFJlbW92YWwgcG9saWN5IGZvciBsb2dzIG9mIGltYWdlIGJ1aWxkcy4gSWYgZGVwbG95bWVudCBmYWlscyBvbiB0aGUgY3VzdG9tIHJlc291cmNlLCB0cnkgc2V0dGluZyB0aGlzIHRvIGBSZW1vdmFsUG9saWN5LlJFVEFJTmAuIFRoaXMgd2F5IHRoZSBDb2RlQnVpbGQgbG9ncyBjYW4gc3RpbGwgYmUgdmlld2VkLCBhbmQgeW91IGNhbiBzZWUgd2h5IHRoZSBidWlsZCBmYWlsZWQuXG4gICAqXG4gICAqIFdlIHRyeSB0byBub3QgbGVhdmUgYW55dGhpbmcgYmVoaW5kIHdoZW4gcmVtb3ZlZC4gQnV0IHNvbWV0aW1lcyBhIGxvZyBzdGF5aW5nIGJlaGluZCBpcyB1c2VmdWwuXG4gICAqXG4gICAqIEBkZWZhdWx0IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgKi9cbiAgcmVhZG9ubHkgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG59XG5cbi8qKlxuICogQW4gaW1hZ2UgYnVpbGRlciB0aGF0IHVzZXMgQ29kZUJ1aWxkIHRvIGJ1aWxkIERvY2tlciBpbWFnZXMgcHJlLWJha2VkIHdpdGggYWxsIHRoZSBHaXRIdWIgQWN0aW9ucyBydW5uZXIgcmVxdWlyZW1lbnRzLiBCdWlsZGVycyBjYW4gYmUgdXNlZCB3aXRoIHJ1bm5lciBwcm92aWRlcnMuXG4gKlxuICogRWFjaCBidWlsZGVyIHJlLXJ1bnMgYXV0b21hdGljYWxseSBhdCBhIHNldCBpbnRlcnZhbCB0byBtYWtlIHN1cmUgdGhlIGltYWdlcyBjb250YWluIHRoZSBsYXRlc3QgdmVyc2lvbnMgb2YgZXZlcnl0aGluZy5cbiAqXG4gKiBZb3UgY2FuIGNyZWF0ZSBhbiBpbnN0YW5jZSBvZiB0aGlzIGNvbnN0cnVjdCB0byBjdXN0b21pemUgdGhlIGltYWdlIHVzZWQgdG8gc3Bpbi11cCBydW5uZXJzLiBFYWNoIHByb3ZpZGVyIGhhcyBpdHMgb3duIHJlcXVpcmVtZW50cyBmb3Igd2hhdCBhbiBpbWFnZSBzaG91bGQgZG8uIFRoYXQncyB3aHkgdGhleSBlYWNoIHByb3ZpZGUgdGhlaXIgb3duIERvY2tlcmZpbGUuXG4gKlxuICogRm9yIGV4YW1wbGUsIHRvIHNldCBhIHNwZWNpZmljIHJ1bm5lciB2ZXJzaW9uLCByZWJ1aWxkIHRoZSBpbWFnZSBldmVyeSAyIHdlZWtzLCBhbmQgYWRkIGEgZmV3IHBhY2thZ2VzIGZvciB0aGUgRmFyZ2F0ZSBwcm92aWRlciwgdXNlOlxuICpcbiAqIGBgYFxuICogY29uc3QgYnVpbGRlciA9IG5ldyBDb2RlQnVpbGRJbWFnZUJ1aWxkZXIodGhpcywgJ0J1aWxkZXInLCB7XG4gKiAgICAgZG9ja2VyZmlsZVBhdGg6IEZhcmdhdGVSdW5uZXJQcm92aWRlci5MSU5VWF9YNjRfRE9DS0VSRklMRV9QQVRILFxuICogICAgIHJ1bm5lclZlcnNpb246IFJ1bm5lclZlcnNpb24uc3BlY2lmaWMoJzIuMjkzLjAnKSxcbiAqICAgICByZWJ1aWxkSW50ZXJ2YWw6IER1cmF0aW9uLmRheXMoMTQpLFxuICogfSk7XG4gKiBidWlsZGVyLnNldEJ1aWxkQXJnKCdFWFRSQV9QQUNLQUdFUycsICduZ2lueCB4ei11dGlscycpO1xuICogbmV3IEZhcmdhdGVSdW5uZXJQcm92aWRlcih0aGlzLCAnRmFyZ2F0ZSBwcm92aWRlcicsIHtcbiAqICAgICBsYWJlbHM6IFsnY3VzdG9taXplZC1mYXJnYXRlJ10sXG4gKiAgICAgaW1hZ2VCdWlsZGVyOiBidWlsZGVyLFxuICogfSk7XG4gKiBgYGBcbiAqXG4gKiBAZGVwcmVjYXRlZCB1c2UgUnVubmVySW1hZ2VCdWlsZGVyXG4gKi9cbmV4cG9ydCBjbGFzcyBDb2RlQnVpbGRJbWFnZUJ1aWxkZXIgZXh0ZW5kcyBDb25zdHJ1Y3QgaW1wbGVtZW50cyBJUnVubmVySW1hZ2VCdWlsZGVyIHtcbiAgLyoqXG4gICAqIEJ1bXAgdGhpcyBudW1iZXIgZXZlcnkgdGltZSB0aGUgYnVpbGRzcGVjIG9yIGFueSBpbXBvcnRhbnQgc2V0dGluZyBvZiB0aGUgcHJvamVjdCBjaGFuZ2VzLiBJdCB3aWxsIGZvcmNlIGEgcmVidWlsZCBvZiB0aGUgaW1hZ2UuXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBCVUlMRFNQRUNfVkVSU0lPTiA9IDI7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZTtcbiAgcHJpdmF0ZSByZWFkb25seSBvczogT3M7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHByaXZhdGUgcmVhZG9ubHkgZG9ja2VyZmlsZTogczNfYXNzZXRzLkFzc2V0O1xuICBwcml2YXRlIHByZUJ1aWxkOiBzdHJpbmdbXSA9IFtdO1xuICBwcml2YXRlIHBvc3RCdWlsZDogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBidWlsZEFyZ3M6IE1hcDxzdHJpbmcsIHN0cmluZz4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcG9saWN5U3RhdGVtZW50czogaWFtLlBvbGljeVN0YXRlbWVudFtdID0gW107XG4gIHByaXZhdGUgc2Vjb25kYXJ5QXNzZXRzOiBNYXA8c3RyaW5nLCBzM19hc3NldHMuQXNzZXQ+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHJlYWRvbmx5IGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5JQnVpbGRJbWFnZTtcbiAgcHJpdmF0ZSBib3VuZEltYWdlPzogUnVubmVySW1hZ2U7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcmVhZG9ubHkgcHJvcHM6IENvZGVCdWlsZEltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGlmIChwcm9wcy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCkge1xuICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnUHJpdmF0ZSBpc29sYXRlZCBzdWJuZXRzIGNhbm5vdCBwdWxsIGZyb20gcHVibGljIEVDUiBhbmQgVlBDIGVuZHBvaW50IGlzIG5vdCBzdXBwb3J0ZWQgeWV0LiAnICtcbiAgICAgICAgICAnU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvY29udGFpbmVycy1yb2FkbWFwL2lzc3Vlcy8xMTYwJyk7XG4gICAgfVxuXG4gICAgLy8gc2V0IHBsYXRmb3JtXG4gICAgdGhpcy5hcmNoaXRlY3R1cmUgPSBwcm9wcy5hcmNoaXRlY3R1cmUgPz8gQXJjaGl0ZWN0dXJlLlg4Nl82NDtcbiAgICB0aGlzLm9zID0gcHJvcHMub3MgPz8gT3MuTElOVVg7XG5cbiAgICAvLyBjcmVhdGUgcmVwb3NpdG9yeSB0aGF0IG9ubHkga2VlcHMgb25lIHRhZ1xuICAgIHRoaXMucmVwb3NpdG9yeSA9IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnUmVwb3NpdG9yeScsIHtcbiAgICAgIGltYWdlU2Nhbk9uUHVzaDogdHJ1ZSxcbiAgICAgIGltYWdlVGFnTXV0YWJpbGl0eTogVGFnTXV0YWJpbGl0eS5NVVRBQkxFLFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZW1wdHlPbkRlbGV0ZTogdHJ1ZSxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JlbW92ZSB1bnRhZ2dlZCBpbWFnZXMgdGhhdCBoYXZlIGJlZW4gcmVwbGFjZWQgYnkgQ29kZUJ1aWxkJyxcbiAgICAgICAgICB0YWdTdGF0dXM6IFRhZ1N0YXR1cy5VTlRBR0dFRCxcbiAgICAgICAgICBtYXhJbWFnZUFnZTogRHVyYXRpb24uZGF5cygxKSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyB1cGxvYWQgRG9ja2VyZmlsZSB0byBTMyBhcyBhbiBhc3NldFxuICAgIHRoaXMuZG9ja2VyZmlsZSA9IG5ldyBzM19hc3NldHMuQXNzZXQodGhpcywgJ0RvY2tlcmZpbGUnLCB7XG4gICAgICBwYXRoOiBwcm9wcy5kb2NrZXJmaWxlUGF0aCxcbiAgICB9KTtcblxuICAgIC8vIGNob29zZSBidWlsZCBpbWFnZVxuICAgIHRoaXMuYnVpbGRJbWFnZSA9IHByb3BzPy5idWlsZEltYWdlID8/IHRoaXMuZ2V0QnVpbGRJbWFnZSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwbG9hZHMgYSBmb2xkZXIgdG8gdGhlIGJ1aWxkIHNlcnZlciBhdCBhIGdpdmVuIGZvbGRlciBuYW1lLlxuICAgKlxuICAgKiBAcGFyYW0gc291cmNlUGF0aCBwYXRoIHRvIHNvdXJjZSBkaXJlY3RvcnlcbiAgICogQHBhcmFtIGRlc3ROYW1lIG5hbWUgb2YgZGVzdGluYXRpb24gZm9sZGVyXG4gICAqL1xuICBwdWJsaWMgYWRkRmlsZXMoc291cmNlUGF0aDogc3RyaW5nLCBkZXN0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuYm91bmRJbWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbWFnZSBpcyBhbHJlYWR5IGJvdW5kLiBVc2UgdGhpcyBtZXRob2QgYmVmb3JlIHBhc3NpbmcgdGhlIGJ1aWxkZXIgdG8gYSBydW5uZXIgcHJvdmlkZXIuJyk7XG4gICAgfVxuXG4gICAgY29uc3QgYXNzZXQgPSBuZXcgczNfYXNzZXRzLkFzc2V0KHRoaXMsIGRlc3ROYW1lLCB7IHBhdGg6IHNvdXJjZVBhdGggfSk7XG4gICAgdGhpcy5zZWNvbmRhcnlBc3NldHMuc2V0KGRlc3ROYW1lLCBhc3NldCk7XG4gICAgdGhpcy5wcmVCdWlsZC5wdXNoKGBybSAtcmYgXCIke2Rlc3ROYW1lfVwiICYmIGNwIC1yIFwiJENPREVCVUlMRF9TUkNfRElSXyR7ZGVzdE5hbWV9XCIgXCIke2Rlc3ROYW1lfVwiYCk7IC8vIHN5bWxpbmtzIGRvbid0IHdvcmsgd2l0aCBkb2NrZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgY29tbWFuZCB0aGF0IHJ1bnMgYmVmb3JlIGBkb2NrZXIgYnVpbGRgLlxuICAgKlxuICAgKiBAcGFyYW0gY29tbWFuZCBjb21tYW5kIHRvIGFkZFxuICAgKi9cbiAgcHVibGljIGFkZFByZUJ1aWxkQ29tbWFuZChjb21tYW5kOiBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5ib3VuZEltYWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ltYWdlIGlzIGFscmVhZHkgYm91bmQuIFVzZSB0aGlzIG1ldGhvZCBiZWZvcmUgcGFzc2luZyB0aGUgYnVpbGRlciB0byBhIHJ1bm5lciBwcm92aWRlci4nKTtcbiAgICB9XG4gICAgdGhpcy5wcmVCdWlsZC5wdXNoKGNvbW1hbmQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBjb21tYW5kIHRoYXQgcnVucyBhZnRlciBgZG9ja2VyIGJ1aWxkYCBhbmQgYGRvY2tlciBwdXNoYC5cbiAgICpcbiAgICogQHBhcmFtIGNvbW1hbmQgY29tbWFuZCB0byBhZGRcbiAgICovXG4gIHB1YmxpYyBhZGRQb3N0QnVpbGRDb21tYW5kKGNvbW1hbmQ6IHN0cmluZykge1xuICAgIGlmICh0aGlzLmJvdW5kSW1hZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW1hZ2UgaXMgYWxyZWFkeSBib3VuZC4gVXNlIHRoaXMgbWV0aG9kIGJlZm9yZSBwYXNzaW5nIHRoZSBidWlsZGVyIHRvIGEgcnVubmVyIHByb3ZpZGVyLicpO1xuICAgIH1cbiAgICB0aGlzLnBvc3RCdWlsZC5wdXNoKGNvbW1hbmQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBidWlsZCBhcmd1bWVudCBmb3IgRG9ja2VyLiBTZWUgdGhlIGRvY3VtZW50YXRpb24gZm9yIHRoZSBEb2NrZXJmaWxlIHlvdSdyZSB1c2luZyBmb3IgYSBsaXN0IG9mIHN1cHBvcnRlZCBidWlsZCBhcmd1bWVudHMuXG4gICAqXG4gICAqIEBwYXJhbSBuYW1lIGJ1aWxkIGFyZ3VtZW50IG5hbWVcbiAgICogQHBhcmFtIHZhbHVlIGJ1aWxkIGFyZ3VtZW50IHZhbHVlXG4gICAqL1xuICBwdWJsaWMgc2V0QnVpbGRBcmcobmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuYm91bmRJbWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbWFnZSBpcyBhbHJlYWR5IGJvdW5kLiBVc2UgdGhpcyBtZXRob2QgYmVmb3JlIHBhc3NpbmcgdGhlIGJ1aWxkZXIgdG8gYSBydW5uZXIgcHJvdmlkZXIuJyk7XG4gICAgfVxuICAgIHRoaXMuYnVpbGRBcmdzLnNldChuYW1lLCB2YWx1ZSk7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGEgcG9saWN5IHN0YXRlbWVudCB0byB0aGUgYnVpbGRlciB0byBhY2Nlc3MgcmVzb3VyY2VzIHJlcXVpcmVkIHRvIHRoZSBpbWFnZSBidWlsZC5cbiAgICpcbiAgICogQHBhcmFtIHN0YXRlbWVudCBJQU0gcG9saWN5IHN0YXRlbWVudFxuICAgKi9cbiAgcHVibGljIGFkZFBvbGljeVN0YXRlbWVudChzdGF0ZW1lbnQ6IGlhbS5Qb2xpY3lTdGF0ZW1lbnQpIHtcbiAgICBpZiAodGhpcy5ib3VuZEltYWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ltYWdlIGlzIGFscmVhZHkgYm91bmQuIFVzZSB0aGlzIG1ldGhvZCBiZWZvcmUgcGFzc2luZyB0aGUgYnVpbGRlciB0byBhIHJ1bm5lciBwcm92aWRlci4nKTtcbiAgICB9XG4gICAgdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLnB1c2goc3RhdGVtZW50KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgZXh0cmEgdHJ1c3RlZCBjZXJ0aWZpY2F0ZXMuIFRoaXMgaGVscHMgZGVhbCB3aXRoIHNlbGYtc2lnbmVkIGNlcnRpZmljYXRlcyBmb3IgR2l0SHViIEVudGVycHJpc2UgU2VydmVyLlxuICAgKlxuICAgKiBBbGwgZmlyc3QgcGFydHkgRG9ja2VyZmlsZXMgc3VwcG9ydCB0aGlzLiBPdGhlcnMgbWF5IG5vdC5cbiAgICpcbiAgICogQHBhcmFtIHBhdGggcGF0aCB0byBkaXJlY3RvcnkgY29udGFpbmluZyBhIGZpbGUgY2FsbGVkIGNlcnRzLnBlbSBjb250YWluaW5nIGFsbCB0aGUgcmVxdWlyZWQgY2VydGlmaWNhdGVzXG4gICAqL1xuICBwdWJsaWMgYWRkRXh0cmFDZXJ0aWZpY2F0ZXMocGF0aDogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuYm91bmRJbWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbWFnZSBpcyBhbHJlYWR5IGJvdW5kLiBVc2UgdGhpcyBtZXRob2QgYmVmb3JlIHBhc3NpbmcgdGhlIGJ1aWxkZXIgdG8gYSBydW5uZXIgcHJvdmlkZXIuJyk7XG4gICAgfVxuICAgIHRoaXMuYWRkRmlsZXMocGF0aCwgJ2V4dHJhX2NlcnRzJyk7XG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IElSdW5uZXJQcm92aWRlciB0byBmaW5hbGl6ZSBzZXR0aW5ncyBhbmQgY3JlYXRlIHRoZSBpbWFnZSBidWlsZGVyLlxuICAgKi9cbiAgcHVibGljIGJpbmREb2NrZXJJbWFnZSgpOiBSdW5uZXJJbWFnZSB7XG4gICAgaWYgKHRoaXMuYm91bmRJbWFnZSkge1xuICAgICAgcmV0dXJuIHRoaXMuYm91bmRJbWFnZTtcbiAgICB9XG5cbiAgICAvLyBsb2cgZ3JvdXAgZm9yIHRoZSBpbWFnZSBidWlsZHNcbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKFxuICAgICAgdGhpcyxcbiAgICAgICdMb2dzJyxcbiAgICAgIHtcbiAgICAgICAgcmV0ZW50aW9uOiB0aGlzLnByb3BzLmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogdGhpcy5wcm9wcy5sb2dSZW1vdmFsUG9saWN5ID8/IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIGdlbmVyYXRlIGJ1aWxkU3BlY1xuICAgIGNvbnN0IGJ1aWxkU3BlYyA9IHRoaXMuZ2V0QnVpbGRTcGVjKHRoaXMucmVwb3NpdG9yeSwgbG9nR3JvdXAsIHRoaXMucHJvcHMucnVubmVyVmVyc2lvbik7XG5cbiAgICAvLyBjcmVhdGUgQ29kZUJ1aWxkIHByb2plY3QgdGhhdCBidWlsZHMgRG9ja2VyZmlsZSBhbmQgcHVzaGVzIHRvIHJlcG9zaXRvcnlcbiAgICBjb25zdCBwcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5Qcm9qZWN0KHRoaXMsICdDb2RlQnVpbGQnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogYEJ1aWxkIGRvY2tlciBpbWFnZSBmb3Igc2VsZi1ob3N0ZWQgR2l0SHViIHJ1bm5lciAke3RoaXMubm9kZS5wYXRofSAoJHt0aGlzLm9zLm5hbWV9LyR7dGhpcy5hcmNoaXRlY3R1cmUubmFtZX0pYCxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KGJ1aWxkU3BlYyksXG4gICAgICBzb3VyY2U6IGNvZGVidWlsZC5Tb3VyY2UuczMoe1xuICAgICAgICBidWNrZXQ6IHRoaXMuZG9ja2VyZmlsZS5idWNrZXQsXG4gICAgICAgIHBhdGg6IHRoaXMuZG9ja2VyZmlsZS5zM09iamVjdEtleSxcbiAgICAgIH0pLFxuICAgICAgdnBjOiB0aGlzLnByb3BzLnZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnByb3BzLnNlY3VyaXR5R3JvdXAgPyBbdGhpcy5wcm9wcy5zZWN1cml0eUdyb3VwXSA6IHVuZGVmaW5lZCxcbiAgICAgIHN1Ym5ldFNlbGVjdGlvbjogdGhpcy5wcm9wcy5zdWJuZXRTZWxlY3Rpb24sXG4gICAgICB0aW1lb3V0OiB0aGlzLnByb3BzLnRpbWVvdXQgPz8gRHVyYXRpb24uaG91cnMoMSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiB0aGlzLmJ1aWxkSW1hZ2UsXG4gICAgICAgIGNvbXB1dGVUeXBlOiB0aGlzLnByb3BzLmNvbXB1dGVUeXBlID8/IENvbXB1dGVUeXBlLlNNQUxMLFxuICAgICAgICBwcml2aWxlZ2VkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGxvZ2dpbmc6IHtcbiAgICAgICAgY2xvdWRXYXRjaDoge1xuICAgICAgICAgIGxvZ0dyb3VwLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIHBlcm1pc3Npb25zXG4gICAgdGhpcy5yZXBvc2l0b3J5LmdyYW50UHVsbFB1c2gocHJvamVjdCk7XG4gICAgdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLmZvckVhY2gocHJvamVjdC5hZGRUb1JvbGVQb2xpY3kpO1xuXG4gICAgLy8gY2FsbCBDb2RlQnVpbGQgZHVyaW5nIGRlcGxveW1lbnQgYW5kIGRlbGV0ZSBhbGwgaW1hZ2VzIGZyb20gcmVwb3NpdG9yeSBkdXJpbmcgZGVzdHJ1Y3Rpb25cbiAgICBjb25zdCBjciA9IHRoaXMuY3VzdG9tUmVzb3VyY2UocHJvamVjdCk7XG5cbiAgICAvLyByZWJ1aWxkIGltYWdlIG9uIGEgc2NoZWR1bGVcbiAgICB0aGlzLnJlYnVpbGRJbWFnZU9uU2NoZWR1bGUocHJvamVjdCwgdGhpcy5wcm9wcy5yZWJ1aWxkSW50ZXJ2YWwpO1xuXG4gICAgZm9yIChjb25zdCBbYXNzZXRQYXRoLCBhc3NldF0gb2YgdGhpcy5zZWNvbmRhcnlBc3NldHMuZW50cmllcygpKSB7XG4gICAgICBwcm9qZWN0LmFkZFNlY29uZGFyeVNvdXJjZShjb2RlYnVpbGQuU291cmNlLnMzKHtcbiAgICAgICAgaWRlbnRpZmllcjogYXNzZXRQYXRoLFxuICAgICAgICBidWNrZXQ6IGFzc2V0LmJ1Y2tldCxcbiAgICAgICAgcGF0aDogYXNzZXQuczNPYmplY3RLZXksXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgdGhpcy5ib3VuZEltYWdlID0ge1xuICAgICAgaW1hZ2VSZXBvc2l0b3J5OiB0aGlzLnJlcG9zaXRvcnksXG4gICAgICBpbWFnZVRhZzogJ2xhdGVzdCcsXG4gICAgICBhcmNoaXRlY3R1cmU6IHRoaXMuYXJjaGl0ZWN0dXJlLFxuICAgICAgb3M6IHRoaXMub3MsXG4gICAgICBsb2dHcm91cCxcbiAgICAgIHJ1bm5lclZlcnNpb246IHRoaXMucHJvcHMucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpLFxuICAgICAgX2RlcGVuZGFibGU6IGNyLFxuICAgIH07XG4gICAgcmV0dXJuIHRoaXMuYm91bmRJbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0QnVpbGRJbWFnZSgpOiBjb2RlYnVpbGQuSUJ1aWxkSW1hZ2Uge1xuICAgIGlmICh0aGlzLm9zLmlzKE9zLkxJTlVYKSkge1xuICAgICAgaWYgKHRoaXMuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgIHJldHVybiBjb2RlYnVpbGQuTGludXhCdWlsZEltYWdlLlNUQU5EQVJEXzZfMDtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgICByZXR1cm4gY29kZWJ1aWxkLkxpbnV4QXJtQnVpbGRJbWFnZS5BTUFaT05fTElOVVhfMl9TVEFOREFSRF8yXzA7XG4gICAgICB9XG4gICAgfVxuICAgIGlmICh0aGlzLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvZGVCdWlsZCBjYW5ub3QgYmUgdXNlZCB0byBidWlsZCBXaW5kb3dzIERvY2tlciBpbWFnZXMgaHR0cHM6Ly9naXRodWIuY29tL2RvY2tlci1saWJyYXJ5L2RvY2tlci9pc3N1ZXMvNDknKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBmaW5kIENvZGVCdWlsZCBpbWFnZSBmb3IgJHt0aGlzLm9zLm5hbWV9LyR7dGhpcy5hcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0QnVpbGRTcGVjKHJlcG9zaXRvcnk6IGVjci5SZXBvc2l0b3J5LCBsb2dHcm91cDogbG9ncy5Mb2dHcm91cCwgcnVubmVyVmVyc2lvbj86IFJ1bm5lclZlcnNpb24pOiBhbnkge1xuICAgIC8vIGRvbid0IGZvcmdldCB0byBjaGFuZ2UgQlVJTERTUEVDX1ZFUlNJT04gd2hlbiB0aGUgYnVpbGRTcGVjIGNoYW5nZXMsIGFuZCB5b3Ugd2FudCB0byB0cmlnZ2VyIGEgcmVidWlsZCBvbiBkZXBsb3lcbiAgICBsZXQgYnVpbGRBcmdzID0gJyc7XG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIHRoaXMuYnVpbGRBcmdzLmVudHJpZXMoKSkge1xuICAgICAgYnVpbGRBcmdzICs9IGAgLS1idWlsZC1hcmcgXCIke25hbWV9XCI9XCIke3ZhbHVlfVwiYDtcbiAgICB9XG4gICAgYnVpbGRBcmdzICs9IGAgLS1idWlsZC1hcmcgUlVOTkVSX1ZFUlNJT049XCIke3J1bm5lclZlcnNpb24gPyBydW5uZXJWZXJzaW9uLnZlcnNpb24gOiBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpLnZlcnNpb259XCJgO1xuXG4gICAgY29uc3QgdGhpc1N0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHZlcnNpb246IDAuMixcbiAgICAgIGVudjoge1xuICAgICAgICB2YXJpYWJsZXM6IHtcbiAgICAgICAgICBSRVBPX0FSTjogcmVwb3NpdG9yeS5yZXBvc2l0b3J5QXJuLFxuICAgICAgICAgIFJFUE9fVVJJOiByZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICAgICAgU1RBQ0tfSUQ6ICd1bnNwZWNpZmllZCcsXG4gICAgICAgICAgUkVRVUVTVF9JRDogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBMT0dJQ0FMX1JFU09VUkNFX0lEOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIFJFU1BPTlNFX1VSTDogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBSVU5ORVJfVkVSU0lPTjogcnVubmVyVmVyc2lvbiA/IHJ1bm5lclZlcnNpb24udmVyc2lvbiA6IFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkudmVyc2lvbixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBwaGFzZXM6IHtcbiAgICAgICAgcHJlX2J1aWxkOiB7XG4gICAgICAgICAgY29tbWFuZHM6IHRoaXMucHJlQnVpbGQuY29uY2F0KFtcbiAgICAgICAgICAgICdta2RpciAtcCBleHRyYV9jZXJ0cycsXG4gICAgICAgICAgICBgYXdzIGVjciBnZXQtbG9naW4tcGFzc3dvcmQgLS1yZWdpb24gXCIkQVdTX0RFRkFVTFRfUkVHSU9OXCIgfCBkb2NrZXIgbG9naW4gLS11c2VybmFtZSBBV1MgLS1wYXNzd29yZC1zdGRpbiAke3RoaXNTdGFjay5hY2NvdW50fS5ka3IuZWNyLiR7dGhpc1N0YWNrLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWAsXG4gICAgICAgICAgXSksXG4gICAgICAgIH0sXG4gICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgICAgIGBkb2NrZXIgYnVpbGQgLiAtdCBcIiRSRVBPX1VSSVwiICR7YnVpbGRBcmdzfWAsXG4gICAgICAgICAgICAnZG9ja2VyIHB1c2ggXCIkUkVQT19VUklcIicsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgcG9zdF9idWlsZDoge1xuICAgICAgICAgIGNvbW1hbmRzOiB0aGlzLnBvc3RCdWlsZC5jb25jYXQoW1xuICAgICAgICAgICAgJ1NUQVRVUz1cIlNVQ0NFU1NcIicsXG4gICAgICAgICAgICAnaWYgWyAkQ09ERUJVSUxEX0JVSUxEX1NVQ0NFRURJTkcgLW5lIDEgXTsgdGhlbiBTVEFUVVM9XCJGQUlMRURcIjsgZmknLFxuICAgICAgICAgICAgJ2NhdCA8PEVPRiA+IC90bXAvcGF5bG9hZC5qc29uXFxuJyArXG4gICAgICAgICAgICAne1xcbicgK1xuICAgICAgICAgICAgJyAgXCJTdGFja0lkXCI6IFwiJFNUQUNLX0lEXCIsXFxuJyArXG4gICAgICAgICAgICAnICBcIlJlcXVlc3RJZFwiOiBcIiRSRVFVRVNUX0lEXCIsXFxuJyArXG4gICAgICAgICAgICAnICBcIkxvZ2ljYWxSZXNvdXJjZUlkXCI6IFwiJExPR0lDQUxfUkVTT1VSQ0VfSURcIixcXG4nICtcbiAgICAgICAgICAgICcgIFwiUGh5c2ljYWxSZXNvdXJjZUlkXCI6IFwiJFJFUE9fQVJOXCIsXFxuJyArXG4gICAgICAgICAgICAnICBcIlN0YXR1c1wiOiBcIiRTVEFUVVNcIixcXG4nICtcbiAgICAgICAgICAgIGAgIFwiUmVhc29uXCI6IFwiU2VlIGxvZ3MgaW4gJHtsb2dHcm91cC5sb2dHcm91cE5hbWV9LyRDT0RFQlVJTERfTE9HX1BBVEggKGRlcGxveSBhZ2FpbiB3aXRoIFxcJ2NkayBkZXBsb3kgLVJcXCcgb3IgbG9nUmVtb3ZhbFBvbGljeT1SZW1vdmFsUG9saWN5LlJFVEFJTiBpZiB0aGV5IGFyZSBhbHJlYWR5IGRlbGV0ZWQpXCIsXFxuYCArXG4gICAgICAgICAgICBgICBcIkRhdGFcIjoge1wiTmFtZVwiOiBcIiR7cmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZX1cIn1cXG5gICtcbiAgICAgICAgICAgICd9XFxuJyArXG4gICAgICAgICAgICAnRU9GJyxcbiAgICAgICAgICAgICdpZiBbIFwiJFJFU1BPTlNFX1VSTFwiICE9IFwidW5zcGVjaWZpZWRcIiBdOyB0aGVuIGpxIC4gL3RtcC9wYXlsb2FkLmpzb247IGN1cmwgLWZzU0wgLVggUFVUIC1IIFwiQ29udGVudC1UeXBlOlwiIC1kIFwiQC90bXAvcGF5bG9hZC5qc29uXCIgXCIkUkVTUE9OU0VfVVJMXCI7IGZpJyxcbiAgICAgICAgICBdKSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgY3VzdG9tUmVzb3VyY2UocHJvamVjdDogY29kZWJ1aWxkLlByb2plY3QpIHtcbiAgICBjb25zdCBjckhhbmRsZXIgPSBzaW5nbGV0b25MYW1iZGEoQnVpbGRJbWFnZUZ1bmN0aW9uLCB0aGlzLCAnYnVpbGQtaW1hZ2UnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbSByZXNvdXJjZSBoYW5kbGVyIHRoYXQgdHJpZ2dlcnMgQ29kZUJ1aWxkIHRvIGJ1aWxkIHJ1bm5lciBpbWFnZXMsIGFuZCBjbGVhbnMtdXAgaW1hZ2VzIG9uIGRlbGV0aW9uJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMpLFxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgIH0pO1xuXG4gICAgY29uc3QgcG9saWN5ID0gbmV3IGlhbS5Qb2xpY3kodGhpcywgJ0NSIFBvbGljeScsIHtcbiAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFsnY29kZWJ1aWxkOlN0YXJ0QnVpbGQnXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFtwcm9qZWN0LnByb2plY3RBcm5dLFxuICAgICAgICB9KSxcbiAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgIGFjdGlvbnM6IFsnZWNyOkJhdGNoRGVsZXRlSW1hZ2UnLCAnZWNyOkxpc3RJbWFnZXMnXSxcbiAgICAgICAgICByZXNvdXJjZXM6IFt0aGlzLnJlcG9zaXRvcnkucmVwb3NpdG9yeUFybl0sXG4gICAgICAgIH0pLFxuICAgICAgXSxcbiAgICB9KTtcbiAgICBjckhhbmRsZXIucm9sZT8uYXR0YWNoSW5saW5lUG9saWN5KHBvbGljeSk7XG5cbiAgICBjb25zdCBjciA9IG5ldyBDdXN0b21SZXNvdXJjZSh0aGlzLCAnQnVpbGRlcicsIHtcbiAgICAgIHNlcnZpY2VUb2tlbjogY3JIYW5kbGVyLmZ1bmN0aW9uQXJuLFxuICAgICAgcmVzb3VyY2VUeXBlOiAnQ3VzdG9tOjpJbWFnZUJ1aWxkZXInLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBSZXBvTmFtZTogdGhpcy5yZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lLFxuICAgICAgICBQcm9qZWN0TmFtZTogcHJvamVjdC5wcm9qZWN0TmFtZSxcbiAgICAgICAgLy8gV2UgaW5jbHVkZSBhIGhhc2ggc28gdGhlIGltYWdlIGlzIGJ1aWx0IGltbWVkaWF0ZWx5IG9uIGNoYW5nZXMsIGFuZCB3ZSBkb24ndCBoYXZlIHRvIHdhaXQgZm9yIGl0cyBzY2hlZHVsZWQgYnVpbGQuXG4gICAgICAgIC8vIFRoaXMgYWxzbyBoZWxwcyBtYWtlIHN1cmUgdGhlIGNoYW5nZXMgYXJlIGdvb2QuIElmIHRoZXkgaGF2ZSBhIGJ1ZywgdGhlIGRlcGxveW1lbnQgd2lsbCBmYWlsIGluc3RlYWQgb2YganVzdCB0aGUgc2NoZWR1bGVkIGJ1aWxkLlxuICAgICAgICBCdWlsZEhhc2g6IHRoaXMuaGFzaEJ1aWxkU2V0dGluZ3MoKSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBhZGQgZGVwZW5kZW5jaWVzIHRvIG1ha2Ugc3VyZSByZXNvdXJjZXMgYXJlIHRoZXJlIHdoZW4gd2UgbmVlZCB0aGVtXG4gICAgY3Iubm9kZS5hZGREZXBlbmRlbmN5KHByb2plY3QpO1xuICAgIGNyLm5vZGUuYWRkRGVwZW5kZW5jeShwb2xpY3kpO1xuICAgIGNyLm5vZGUuYWRkRGVwZW5kZW5jeShjckhhbmRsZXIpO1xuXG4gICAgcmV0dXJuIGNyO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiBoYXNoIG9mIGFsbCBzZXR0aW5ncyB0aGF0IGNhbiBhZmZlY3QgdGhlIHJlc3VsdCBpbWFnZSBzbyB3ZSBjYW4gdHJpZ2dlciB0aGUgYnVpbGQgd2hlbiBpdCBjaGFuZ2VzLlxuICAgKiBAcHJpdmF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBoYXNoQnVpbGRTZXR0aW5ncygpOiBzdHJpbmcge1xuICAgIC8vIG1haW4gRG9ja2VyZmlsZVxuICAgIGxldCBjb21wb25lbnRzOiBzdHJpbmdbXSA9IFt0aGlzLmRvY2tlcmZpbGUuYXNzZXRIYXNoXTtcbiAgICAvLyBhbGwgYWRkaXRpb25hbCBmaWxlc1xuICAgIGZvciAoY29uc3QgW25hbWUsIGFzc2V0XSBvZiB0aGlzLnNlY29uZGFyeUFzc2V0cy5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbXBvbmVudHMucHVzaChuYW1lKTtcbiAgICAgIGNvbXBvbmVudHMucHVzaChhc3NldC5hc3NldEhhc2gpO1xuICAgIH1cbiAgICAvLyBidWlsZHNwZWMueW1sIHZlcnNpb25cbiAgICBjb21wb25lbnRzLnB1c2goYHYke0NvZGVCdWlsZEltYWdlQnVpbGRlci5CVUlMRFNQRUNfVkVSU0lPTn1gKTtcbiAgICAvLyBydW5uZXIgdmVyc2lvblxuICAgIGNvbXBvbmVudHMucHVzaCh0aGlzLnByb3BzLnJ1bm5lclZlcnNpb24/LnZlcnNpb24gPz8gUnVubmVyVmVyc2lvbi5sYXRlc3QoKS52ZXJzaW9uKTtcbiAgICAvLyB1c2VyIGNvbW1hbmRzXG4gICAgY29tcG9uZW50cyA9IGNvbXBvbmVudHMuY29uY2F0KHRoaXMucHJlQnVpbGQpO1xuICAgIGNvbXBvbmVudHMgPSBjb21wb25lbnRzLmNvbmNhdCh0aGlzLnBvc3RCdWlsZCk7XG4gICAgZm9yIChjb25zdCBbbmFtZSwgdmFsdWVdIG9mIHRoaXMuYnVpbGRBcmdzLmVudHJpZXMoKSkge1xuICAgICAgY29tcG9uZW50cy5wdXNoKG5hbWUpO1xuICAgICAgY29tcG9uZW50cy5wdXNoKHZhbHVlKTtcbiAgICB9XG4gICAgLy8gaGFzaCBpdFxuICAgIGNvbnN0IGFsbCA9IGNvbXBvbmVudHMuam9pbignLScpO1xuICAgIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGFsbCkuZGlnZXN0KCdoZXgnKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVidWlsZEltYWdlT25TY2hlZHVsZShwcm9qZWN0OiBjb2RlYnVpbGQuUHJvamVjdCwgcmVidWlsZEludGVydmFsPzogRHVyYXRpb24pIHtcbiAgICByZWJ1aWxkSW50ZXJ2YWwgPSByZWJ1aWxkSW50ZXJ2YWwgPz8gRHVyYXRpb24uZGF5cyg3KTtcbiAgICBpZiAocmVidWlsZEludGVydmFsLnRvTWlsbGlzZWNvbmRzKCkgIT0gMCkge1xuICAgICAgY29uc3Qgc2NoZWR1bGVSdWxlID0gbmV3IGV2ZW50cy5SdWxlKHRoaXMsICdCdWlsZCBTY2hlZHVsZScsIHtcbiAgICAgICAgZGVzY3JpcHRpb246IGBSZWJ1aWxkIHJ1bm5lciBpbWFnZSBmb3IgJHt0aGlzLnJlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWV9YCxcbiAgICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKHJlYnVpbGRJbnRlcnZhbCksXG4gICAgICB9KTtcbiAgICAgIHNjaGVkdWxlUnVsZS5hZGRUYXJnZXQobmV3IGV2ZW50c190YXJnZXRzLkNvZGVCdWlsZFByb2plY3QocHJvamVjdCkpO1xuICAgIH1cbiAgfVxuXG4gIGdldCBjb25uZWN0aW9ucygpOiBlYzIuQ29ubmVjdGlvbnMge1xuICAgIHJldHVybiBuZXcgZWMyLkNvbm5lY3Rpb25zKHtcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnByb3BzLnNlY3VyaXR5R3JvdXAgPyBbdGhpcy5wcm9wcy5zZWN1cml0eUdyb3VwXSA6IFtdLFxuICAgIH0pO1xuICB9XG5cbiAgYmluZEFtaSgpOiBSdW5uZXJBbWkge1xuICAgIHRocm93IG5ldyBFcnJvcignQ29kZUJ1aWxkSW1hZ2VCdWlsZGVyIGRvZXMgbm90IHN1cHBvcnQgYnVpbGRpbmcgQU1JcycpO1xuICB9XG59XG4iXX0=