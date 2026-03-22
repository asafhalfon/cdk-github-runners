"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeBuildImageBuilder = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const crypto = require("crypto");
const cdk = require("aws-cdk-lib");
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
    constructor(scope, id, props) {
        super(scope, id);
        this.props = props;
        this.preBuild = [];
        this.postBuild = [];
        this.buildArgs = new Map();
        this.policyStatements = [];
        this.secondaryAssets = new Map();
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
            _dependable: cr.ref,
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
_a = JSII_RTTI_SYMBOL_1;
CodeBuildImageBuilder[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.CodeBuildImageBuilder", version: "0.0.0" };
/**
 * Bump this number every time the buildspec or any important setting of the project changes. It will force a rebuild of the image.
 * @private
 */
CodeBuildImageBuilder.BUILDSPEC_VERSION = 2;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29kZWJ1aWxkLWRlcHJlY2F0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvaW1hZ2UtYnVpbGRlcnMvY29kZWJ1aWxkLWRlcHJlY2F0ZWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxpQ0FBaUM7QUFDakMsbUNBQW1DO0FBQ25DLDZDQWFxQjtBQUNyQiw2REFBd0Q7QUFDeEQsaURBQStEO0FBQy9ELG1EQUFxRDtBQUNyRCwyQ0FBdUM7QUFDdkMsaUVBQTREO0FBRTVELDRDQUF1RjtBQUN2RixvQ0FBMkM7QUFrSDNDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQXVCRztBQUNILE1BQWEscUJBQXNCLFNBQVEsc0JBQVM7SUFtQmxELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQVcsS0FBaUM7UUFDbEYsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQURnQyxVQUFLLEdBQUwsS0FBSyxDQUE0QjtRQVI1RSxhQUFRLEdBQWEsRUFBRSxDQUFDO1FBQ3hCLGNBQVMsR0FBYSxFQUFFLENBQUM7UUFDekIsY0FBUyxHQUF3QixJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQzNDLHFCQUFnQixHQUEwQixFQUFFLENBQUM7UUFDN0Msb0JBQWUsR0FBaUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQU9oRSxJQUFJLEtBQUssQ0FBQyxlQUFlLEVBQUUsVUFBVSxJQUFJLHFCQUFHLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFLENBQUM7WUFDekUseUJBQVcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxDQUFDLDhGQUE4RjtnQkFDMUgsMkRBQTJELENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBRUQsZUFBZTtRQUNmLElBQUksQ0FBQyxZQUFZLEdBQUcsS0FBSyxDQUFDLFlBQVksSUFBSSx3QkFBWSxDQUFDLE1BQU0sQ0FBQztRQUM5RCxJQUFJLENBQUMsRUFBRSxHQUFHLEtBQUssQ0FBQyxFQUFFLElB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LENBQUM7SUFFTyxzQkFBc0IsQ0FBQyxPQUEwQixFQUFFLGVBQTBCO1FBQ25GLGVBQWUsR0FBRyxlQUFlLElBQUksc0JBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdEQsSUFBSSxlQUFlLENBQUMsY0FBYyxFQUFFLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDMUMsTUFBTSxZQUFZLEdBQUcsSUFBSSx3QkFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7Z0JBQzNELFdBQVcsRUFBRSw0QkFBNEIsSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLEVBQUU7Z0JBQ3pFLFFBQVEsRUFBRSx3QkFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDO2FBQ2hELENBQUMsQ0FBQztZQUNILFlBQVksQ0FBQyxTQUFTLENBQUMsSUFBSSxnQ0FBYyxDQUFDLGdCQUFnQixDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7UUFDdkUsQ0FBQztJQUNILENBQUM7SUFFRCxJQUFJLFdBQVc7UUFDYixPQUFPLElBQUkscUJBQUcsQ0FBQyxXQUFXLENBQUM7WUFDekIsY0FBYyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUU7U0FDM0UsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU87UUFDTCxNQUFNLElBQUksS0FBSyxDQUFDLHNEQUFzRCxDQUFDLENBQUM7SUFDMUUsQ0FBQzs7QUFsWEgsc0RBbVhDOzs7QUFsWEM7OztHQUdHO0FBQ1ksdUNBQWlCLEdBQUcsQ0FBQyxBQUFKLENBQUsiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnY3J5cHRvJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBBbm5vdGF0aW9ucyxcbiAgYXdzX2NvZGVidWlsZCBhcyBjb2RlYnVpbGQsXG4gIGF3c19lYzIgYXMgZWMyLFxuICBhd3NfZWNyIGFzIGVjcixcbiAgYXdzX2V2ZW50cyBhcyBldmVudHMsXG4gIGF3c19ldmVudHNfdGFyZ2V0cyBhcyBldmVudHNfdGFyZ2V0cyxcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zM19hc3NldHMgYXMgczNfYXNzZXRzLFxuICBDdXN0b21SZXNvdXJjZSxcbiAgRHVyYXRpb24sXG4gIFJlbW92YWxQb2xpY3ksXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbXB1dGVUeXBlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVidWlsZCc7XG5pbXBvcnQgeyBUYWdNdXRhYmlsaXR5LCBUYWdTdGF0dXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEJ1aWxkSW1hZ2VGdW5jdGlvbiB9IGZyb20gJy4vYnVpbGQtaW1hZ2UtZnVuY3Rpb24nO1xuaW1wb3J0IHsgSVJ1bm5lckltYWdlQnVpbGRlciB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IEFyY2hpdGVjdHVyZSwgT3MsIFJ1bm5lckFtaSwgUnVubmVySW1hZ2UsIFJ1bm5lclZlcnNpb24gfSBmcm9tICcuLi9wcm92aWRlcnMnO1xuaW1wb3J0IHsgc2luZ2xldG9uTGFtYmRhIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vKlxuQVdTIEltYWdlIEJ1aWxkZXIgd2FzIG5vdCB1c2VkIGJlY2F1c2U6XG4gIDEuIEl0J3MgdG9vIHNsb3cuIEl0IGhhcyB3ZWlyZCAxNSBtaW51dGVzIG92ZXJoZWFkIHdoZXJlIGl0IHNlZW1zIHRvIGp1c3QgYmUgd2FpdGluZy5cbiAgMi4gTm8gZWFzeSBsb2cgdmlzaWJpbGl0eS5cbiAgMy4gVmVyc2lvbnMgbmVlZCB0byBiZSBidW1wZWQgbWFudWFsbHkuXG4gKi9cblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBDb2RlQnVpbGRJbWFnZUJ1aWxkZXIgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvZGVCdWlsZEltYWdlQnVpbGRlclByb3BzIHtcbiAgLyoqXG4gICAqIEltYWdlIGFyY2hpdGVjdHVyZS5cbiAgICpcbiAgICogQGRlZmF1bHQgQXJjaGl0ZWN0dXJlLlg4Nl82NFxuICAgKi9cbiAgcmVhZG9ubHkgYXJjaGl0ZWN0dXJlPzogQXJjaGl0ZWN0dXJlO1xuXG4gIC8qKlxuICAgKiBJbWFnZSBPUy5cbiAgICpcbiAgICogQGRlZmF1bHQgT1MuTElOVVhcbiAgICovXG4gIHJlYWRvbmx5IG9zPzogT3M7XG5cbiAgLyoqXG4gICAqIFBhdGggdG8gRG9ja2VyZmlsZSB0byBiZSBidWlsdC4gSXQgY2FuIGJlIGEgcGF0aCB0byBhIERvY2tlcmZpbGUsIGEgZm9sZGVyIGNvbnRhaW5pbmcgYSBEb2NrZXJmaWxlLCBvciBhIHppcCBmaWxlIGNvbnRhaW5pbmcgYSBEb2NrZXJmaWxlLlxuICAgKi9cbiAgcmVhZG9ubHkgZG9ja2VyZmlsZVBhdGg6IHN0cmluZztcblxuICAvKipcbiAgICogVmVyc2lvbiBvZiBHaXRIdWIgUnVubmVycyB0byBpbnN0YWxsLlxuICAgKlxuICAgKiBAZGVmYXVsdCBsYXRlc3QgdmVyc2lvbiBhdmFpbGFibGVcbiAgICovXG4gIHJlYWRvbmx5IHJ1bm5lclZlcnNpb24/OiBSdW5uZXJWZXJzaW9uO1xuXG4gIC8qKlxuICAgKiBTY2hlZHVsZSB0aGUgaW1hZ2UgdG8gYmUgcmVidWlsdCBldmVyeSBnaXZlbiBpbnRlcnZhbC4gVXNlZnVsIGZvciBrZWVwaW5nIHRoZSBpbWFnZSB1cC1kby1kYXRlIHdpdGggdGhlIGxhdGVzdCBHaXRIdWIgcnVubmVyIHZlcnNpb24gYW5kIGxhdGVzdCBPUyB1cGRhdGVzLlxuICAgKlxuICAgKiBTZXQgdG8gemVybyB0byBkaXNhYmxlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBEdXJhdGlvbi5kYXlzKDcpXG4gICAqL1xuICByZWFkb25seSByZWJ1aWxkSW50ZXJ2YWw/OiBEdXJhdGlvbjtcblxuICAvKipcbiAgICogVlBDIHRvIGJ1aWxkIHRoZSBpbWFnZSBpbi5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gVlBDXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU2VjdXJpdHkgR3JvdXAgdG8gYXNzaWduIHRvIHRoaXMgaW5zdGFuY2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IHB1YmxpYyBwcm9qZWN0IHdpdGggbm8gc2VjdXJpdHkgZ3JvdXBcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA/OiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFdoZXJlIHRvIHBsYWNlIHRoZSBuZXR3b3JrIGludGVyZmFjZXMgd2l0aGluIHRoZSBWUEMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIHN1Ym5ldFxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogVGhlIHR5cGUgb2YgY29tcHV0ZSB0byB1c2UgZm9yIHRoaXMgYnVpbGQuXG4gICAqIFNlZSB0aGUge0BsaW5rIENvbXB1dGVUeXBlfSBlbnVtIGZvciB0aGUgcG9zc2libGUgdmFsdWVzLlxuICAgKlxuICAgKiBAZGVmYXVsdCB7QGxpbmsgQ29tcHV0ZVR5cGUjU01BTEx9XG4gICAqL1xuICByZWFkb25seSBjb21wdXRlVHlwZT86IGNvZGVidWlsZC5Db21wdXRlVHlwZTtcblxuICAvKipcbiAgICogQnVpbGQgaW1hZ2UgdG8gdXNlIGluIENvZGVCdWlsZC4gVGhpcyBpcyB0aGUgaW1hZ2UgdGhhdCdzIGdvaW5nIHRvIHJ1biB0aGUgY29kZSB0aGF0IGJ1aWxkcyB0aGUgcnVubmVyIGltYWdlLlxuICAgKlxuICAgKiBUaGUgb25seSBhY3Rpb24gdGFrZW4gaW4gQ29kZUJ1aWxkIGlzIHJ1bm5pbmcgYGRvY2tlciBidWlsZGAuIFlvdSB3b3VsZCB0aGVyZWZvcmUgbm90IG5lZWQgdG8gY2hhbmdlIHRoaXMgc2V0dGluZyBvZnRlbi5cbiAgICpcbiAgICogQGRlZmF1bHQgVWJ1bnR1IDIyLjA0IGZvciB4NjQgYW5kIEFtYXpvbiBMaW51eCAyIGZvciBBUk02NFxuICAgKi9cbiAgcmVhZG9ubHkgYnVpbGRJbWFnZT86IGNvZGVidWlsZC5JQnVpbGRJbWFnZTtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBtaW51dGVzIGFmdGVyIHdoaWNoIEFXUyBDb2RlQnVpbGQgc3RvcHMgdGhlIGJ1aWxkIGlmIGl0J3NcbiAgICogbm90IGNvbXBsZXRlLiBGb3IgdmFsaWQgdmFsdWVzLCBzZWUgdGhlIHRpbWVvdXRJbk1pbnV0ZXMgZmllbGQgaW4gdGhlIEFXU1xuICAgKiBDb2RlQnVpbGQgVXNlciBHdWlkZS5cbiAgICpcbiAgICogQGRlZmF1bHQgRHVyYXRpb24uaG91cnMoMSlcbiAgICovXG4gIHJlYWRvbmx5IHRpbWVvdXQ/OiBEdXJhdGlvbjtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBkYXlzIGxvZyBldmVudHMgYXJlIGtlcHQgaW4gQ2xvdWRXYXRjaCBMb2dzLiBXaGVuIHVwZGF0aW5nXG4gICAqIHRoaXMgcHJvcGVydHksIHVuc2V0dGluZyBpdCBkb2Vzbid0IHJlbW92ZSB0aGUgbG9nIHJldGVudGlvbiBwb2xpY3kuIFRvXG4gICAqIHJlbW92ZSB0aGUgcmV0ZW50aW9uIHBvbGljeSwgc2V0IHRoZSB2YWx1ZSB0byBgSU5GSU5JVEVgLlxuICAgKlxuICAgKiBAZGVmYXVsdCBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRIXG4gICAqL1xuICByZWFkb25seSBsb2dSZXRlbnRpb24/OiBsb2dzLlJldGVudGlvbkRheXM7XG5cbiAgLyoqXG4gICAqIFJlbW92YWwgcG9saWN5IGZvciBsb2dzIG9mIGltYWdlIGJ1aWxkcy4gSWYgZGVwbG95bWVudCBmYWlscyBvbiB0aGUgY3VzdG9tIHJlc291cmNlLCB0cnkgc2V0dGluZyB0aGlzIHRvIGBSZW1vdmFsUG9saWN5LlJFVEFJTmAuIFRoaXMgd2F5IHRoZSBDb2RlQnVpbGQgbG9ncyBjYW4gc3RpbGwgYmUgdmlld2VkLCBhbmQgeW91IGNhbiBzZWUgd2h5IHRoZSBidWlsZCBmYWlsZWQuXG4gICAqXG4gICAqIFdlIHRyeSB0byBub3QgbGVhdmUgYW55dGhpbmcgYmVoaW5kIHdoZW4gcmVtb3ZlZC4gQnV0IHNvbWV0aW1lcyBhIGxvZyBzdGF5aW5nIGJlaGluZCBpcyB1c2VmdWwuXG4gICAqXG4gICAqIEBkZWZhdWx0IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgKi9cbiAgcmVhZG9ubHkgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG59XG5cbi8qKlxuICogQW4gaW1hZ2UgYnVpbGRlciB0aGF0IHVzZXMgQ29kZUJ1aWxkIHRvIGJ1aWxkIERvY2tlciBpbWFnZXMgcHJlLWJha2VkIHdpdGggYWxsIHRoZSBHaXRIdWIgQWN0aW9ucyBydW5uZXIgcmVxdWlyZW1lbnRzLiBCdWlsZGVycyBjYW4gYmUgdXNlZCB3aXRoIHJ1bm5lciBwcm92aWRlcnMuXG4gKlxuICogRWFjaCBidWlsZGVyIHJlLXJ1bnMgYXV0b21hdGljYWxseSBhdCBhIHNldCBpbnRlcnZhbCB0byBtYWtlIHN1cmUgdGhlIGltYWdlcyBjb250YWluIHRoZSBsYXRlc3QgdmVyc2lvbnMgb2YgZXZlcnl0aGluZy5cbiAqXG4gKiBZb3UgY2FuIGNyZWF0ZSBhbiBpbnN0YW5jZSBvZiB0aGlzIGNvbnN0cnVjdCB0byBjdXN0b21pemUgdGhlIGltYWdlIHVzZWQgdG8gc3Bpbi11cCBydW5uZXJzLiBFYWNoIHByb3ZpZGVyIGhhcyBpdHMgb3duIHJlcXVpcmVtZW50cyBmb3Igd2hhdCBhbiBpbWFnZSBzaG91bGQgZG8uIFRoYXQncyB3aHkgdGhleSBlYWNoIHByb3ZpZGUgdGhlaXIgb3duIERvY2tlcmZpbGUuXG4gKlxuICogRm9yIGV4YW1wbGUsIHRvIHNldCBhIHNwZWNpZmljIHJ1bm5lciB2ZXJzaW9uLCByZWJ1aWxkIHRoZSBpbWFnZSBldmVyeSAyIHdlZWtzLCBhbmQgYWRkIGEgZmV3IHBhY2thZ2VzIGZvciB0aGUgRmFyZ2F0ZSBwcm92aWRlciwgdXNlOlxuICpcbiAqIGBgYFxuICogY29uc3QgYnVpbGRlciA9IG5ldyBDb2RlQnVpbGRJbWFnZUJ1aWxkZXIodGhpcywgJ0J1aWxkZXInLCB7XG4gKiAgICAgZG9ja2VyZmlsZVBhdGg6IEZhcmdhdGVSdW5uZXJQcm92aWRlci5MSU5VWF9YNjRfRE9DS0VSRklMRV9QQVRILFxuICogICAgIHJ1bm5lclZlcnNpb246IFJ1bm5lclZlcnNpb24uc3BlY2lmaWMoJzIuMjkzLjAnKSxcbiAqICAgICByZWJ1aWxkSW50ZXJ2YWw6IER1cmF0aW9uLmRheXMoMTQpLFxuICogfSk7XG4gKiBidWlsZGVyLnNldEJ1aWxkQXJnKCdFWFRSQV9QQUNLQUdFUycsICduZ2lueCB4ei11dGlscycpO1xuICogbmV3IEZhcmdhdGVSdW5uZXJQcm92aWRlcih0aGlzLCAnRmFyZ2F0ZSBwcm92aWRlcicsIHtcbiAqICAgICBsYWJlbHM6IFsnY3VzdG9taXplZC1mYXJnYXRlJ10sXG4gKiAgICAgaW1hZ2VCdWlsZGVyOiBidWlsZGVyLFxuICogfSk7XG4gKiBgYGBcbiAqXG4gKiBAZGVwcmVjYXRlZCB1c2UgUnVubmVySW1hZ2VCdWlsZGVyXG4gKi9cbmV4cG9ydCBjbGFzcyBDb2RlQnVpbGRJbWFnZUJ1aWxkZXIgZXh0ZW5kcyBDb25zdHJ1Y3QgaW1wbGVtZW50cyBJUnVubmVySW1hZ2VCdWlsZGVyIHtcbiAgLyoqXG4gICAqIEJ1bXAgdGhpcyBudW1iZXIgZXZlcnkgdGltZSB0aGUgYnVpbGRzcGVjIG9yIGFueSBpbXBvcnRhbnQgc2V0dGluZyBvZiB0aGUgcHJvamVjdCBjaGFuZ2VzLiBJdCB3aWxsIGZvcmNlIGEgcmVidWlsZCBvZiB0aGUgaW1hZ2UuXG4gICAqIEBwcml2YXRlXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBCVUlMRFNQRUNfVkVSU0lPTiA9IDI7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZTtcbiAgcHJpdmF0ZSByZWFkb25seSBvczogT3M7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVwb3NpdG9yeTogZWNyLlJlcG9zaXRvcnk7XG4gIHByaXZhdGUgcmVhZG9ubHkgZG9ja2VyZmlsZTogczNfYXNzZXRzLkFzc2V0O1xuICBwcml2YXRlIHByZUJ1aWxkOiBzdHJpbmdbXSA9IFtdO1xuICBwcml2YXRlIHBvc3RCdWlsZDogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBidWlsZEFyZ3M6IE1hcDxzdHJpbmcsIHN0cmluZz4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcG9saWN5U3RhdGVtZW50czogaWFtLlBvbGljeVN0YXRlbWVudFtdID0gW107XG4gIHByaXZhdGUgc2Vjb25kYXJ5QXNzZXRzOiBNYXA8c3RyaW5nLCBzM19hc3NldHMuQXNzZXQ+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHJlYWRvbmx5IGJ1aWxkSW1hZ2U6IGNvZGVidWlsZC5JQnVpbGRJbWFnZTtcbiAgcHJpdmF0ZSBib3VuZEltYWdlPzogUnVubmVySW1hZ2U7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcmVhZG9ubHkgcHJvcHM6IENvZGVCdWlsZEltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIGlmIChwcm9wcy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldFR5cGUgPT0gZWMyLlN1Ym5ldFR5cGUuUFJJVkFURV9JU09MQVRFRCkge1xuICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnUHJpdmF0ZSBpc29sYXRlZCBzdWJuZXRzIGNhbm5vdCBwdWxsIGZyb20gcHVibGljIEVDUiBhbmQgVlBDIGVuZHBvaW50IGlzIG5vdCBzdXBwb3J0ZWQgeWV0LiAnICtcbiAgICAgICAgICAnU2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvY29udGFpbmVycy1yb2FkbWFwL2lzc3Vlcy8xMTYwJyk7XG4gICAgfVxuXG4gICAgLy8gc2V0IHBsYXRmb3JtXG4gICAgdGhpcy5hcmNoaXRlY3R1cmUgPSBwcm9wcy5hcmNoaXRlY3R1cmUgPz8gQXJjaGl0ZWN0dXJlLlg4Nl82NDtcbiAgICB0aGlzLm9zID0gcHJvcHMub3MgPz8gT3MuTElOVVg7XG5cbiAgICAvLyBjcmVhdGUgcmVwb3NpdG9yeSB0aGF0IG9ubHkga2VlcHMgb25lIHRhZ1xuICAgIHRoaXMucmVwb3NpdG9yeSA9IG5ldyBlY3IuUmVwb3NpdG9yeSh0aGlzLCAnUmVwb3NpdG9yeScsIHtcbiAgICAgIGltYWdlU2Nhbk9uUHVzaDogdHJ1ZSxcbiAgICAgIGltYWdlVGFnTXV0YWJpbGl0eTogVGFnTXV0YWJpbGl0eS5NVVRBQkxFLFxuICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgZW1wdHlPbkRlbGV0ZTogdHJ1ZSxcbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBkZXNjcmlwdGlvbjogJ1JlbW92ZSB1bnRhZ2dlZCBpbWFnZXMgdGhhdCBoYXZlIGJlZW4gcmVwbGFjZWQgYnkgQ29kZUJ1aWxkJyxcbiAgICAgICAgICB0YWdTdGF0dXM6IFRhZ1N0YXR1cy5VTlRBR0dFRCxcbiAgICAgICAgICBtYXhJbWFnZUFnZTogRHVyYXRpb24uZGF5cygxKSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyB1cGxvYWQgRG9ja2VyZmlsZSB0byBTMyBhcyBhbiBhc3NldFxuICAgIHRoaXMuZG9ja2VyZmlsZSA9IG5ldyBzM19hc3NldHMuQXNzZXQodGhpcywgJ0RvY2tlcmZpbGUnLCB7XG4gICAgICBwYXRoOiBwcm9wcy5kb2NrZXJmaWxlUGF0aCxcbiAgICB9KTtcblxuICAgIC8vIGNob29zZSBidWlsZCBpbWFnZVxuICAgIHRoaXMuYnVpbGRJbWFnZSA9IHByb3BzPy5idWlsZEltYWdlID8/IHRoaXMuZ2V0QnVpbGRJbWFnZSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFVwbG9hZHMgYSBmb2xkZXIgdG8gdGhlIGJ1aWxkIHNlcnZlciBhdCBhIGdpdmVuIGZvbGRlciBuYW1lLlxuICAgKlxuICAgKiBAcGFyYW0gc291cmNlUGF0aCBwYXRoIHRvIHNvdXJjZSBkaXJlY3RvcnlcbiAgICogQHBhcmFtIGRlc3ROYW1lIG5hbWUgb2YgZGVzdGluYXRpb24gZm9sZGVyXG4gICAqL1xuICBwdWJsaWMgYWRkRmlsZXMoc291cmNlUGF0aDogc3RyaW5nLCBkZXN0TmFtZTogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuYm91bmRJbWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbWFnZSBpcyBhbHJlYWR5IGJvdW5kLiBVc2UgdGhpcyBtZXRob2QgYmVmb3JlIHBhc3NpbmcgdGhlIGJ1aWxkZXIgdG8gYSBydW5uZXIgcHJvdmlkZXIuJyk7XG4gICAgfVxuXG4gICAgY29uc3QgYXNzZXQgPSBuZXcgczNfYXNzZXRzLkFzc2V0KHRoaXMsIGRlc3ROYW1lLCB7IHBhdGg6IHNvdXJjZVBhdGggfSk7XG4gICAgdGhpcy5zZWNvbmRhcnlBc3NldHMuc2V0KGRlc3ROYW1lLCBhc3NldCk7XG4gICAgdGhpcy5wcmVCdWlsZC5wdXNoKGBybSAtcmYgXCIke2Rlc3ROYW1lfVwiICYmIGNwIC1yIFwiJENPREVCVUlMRF9TUkNfRElSXyR7ZGVzdE5hbWV9XCIgXCIke2Rlc3ROYW1lfVwiYCk7IC8vIHN5bWxpbmtzIGRvbid0IHdvcmsgd2l0aCBkb2NrZXJcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGRzIGEgY29tbWFuZCB0aGF0IHJ1bnMgYmVmb3JlIGBkb2NrZXIgYnVpbGRgLlxuICAgKlxuICAgKiBAcGFyYW0gY29tbWFuZCBjb21tYW5kIHRvIGFkZFxuICAgKi9cbiAgcHVibGljIGFkZFByZUJ1aWxkQ29tbWFuZChjb21tYW5kOiBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5ib3VuZEltYWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ltYWdlIGlzIGFscmVhZHkgYm91bmQuIFVzZSB0aGlzIG1ldGhvZCBiZWZvcmUgcGFzc2luZyB0aGUgYnVpbGRlciB0byBhIHJ1bm5lciBwcm92aWRlci4nKTtcbiAgICB9XG4gICAgdGhpcy5wcmVCdWlsZC5wdXNoKGNvbW1hbmQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBjb21tYW5kIHRoYXQgcnVucyBhZnRlciBgZG9ja2VyIGJ1aWxkYCBhbmQgYGRvY2tlciBwdXNoYC5cbiAgICpcbiAgICogQHBhcmFtIGNvbW1hbmQgY29tbWFuZCB0byBhZGRcbiAgICovXG4gIHB1YmxpYyBhZGRQb3N0QnVpbGRDb21tYW5kKGNvbW1hbmQ6IHN0cmluZykge1xuICAgIGlmICh0aGlzLmJvdW5kSW1hZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW1hZ2UgaXMgYWxyZWFkeSBib3VuZC4gVXNlIHRoaXMgbWV0aG9kIGJlZm9yZSBwYXNzaW5nIHRoZSBidWlsZGVyIHRvIGEgcnVubmVyIHByb3ZpZGVyLicpO1xuICAgIH1cbiAgICB0aGlzLnBvc3RCdWlsZC5wdXNoKGNvbW1hbmQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZHMgYSBidWlsZCBhcmd1bWVudCBmb3IgRG9ja2VyLiBTZWUgdGhlIGRvY3VtZW50YXRpb24gZm9yIHRoZSBEb2NrZXJmaWxlIHlvdSdyZSB1c2luZyBmb3IgYSBsaXN0IG9mIHN1cHBvcnRlZCBidWlsZCBhcmd1bWVudHMuXG4gICAqXG4gICAqIEBwYXJhbSBuYW1lIGJ1aWxkIGFyZ3VtZW50IG5hbWVcbiAgICogQHBhcmFtIHZhbHVlIGJ1aWxkIGFyZ3VtZW50IHZhbHVlXG4gICAqL1xuICBwdWJsaWMgc2V0QnVpbGRBcmcobmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuYm91bmRJbWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbWFnZSBpcyBhbHJlYWR5IGJvdW5kLiBVc2UgdGhpcyBtZXRob2QgYmVmb3JlIHBhc3NpbmcgdGhlIGJ1aWxkZXIgdG8gYSBydW5uZXIgcHJvdmlkZXIuJyk7XG4gICAgfVxuICAgIHRoaXMuYnVpbGRBcmdzLnNldChuYW1lLCB2YWx1ZSk7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGEgcG9saWN5IHN0YXRlbWVudCB0byB0aGUgYnVpbGRlciB0byBhY2Nlc3MgcmVzb3VyY2VzIHJlcXVpcmVkIHRvIHRoZSBpbWFnZSBidWlsZC5cbiAgICpcbiAgICogQHBhcmFtIHN0YXRlbWVudCBJQU0gcG9saWN5IHN0YXRlbWVudFxuICAgKi9cbiAgcHVibGljIGFkZFBvbGljeVN0YXRlbWVudChzdGF0ZW1lbnQ6IGlhbS5Qb2xpY3lTdGF0ZW1lbnQpIHtcbiAgICBpZiAodGhpcy5ib3VuZEltYWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ltYWdlIGlzIGFscmVhZHkgYm91bmQuIFVzZSB0aGlzIG1ldGhvZCBiZWZvcmUgcGFzc2luZyB0aGUgYnVpbGRlciB0byBhIHJ1bm5lciBwcm92aWRlci4nKTtcbiAgICB9XG4gICAgdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLnB1c2goc3RhdGVtZW50KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgZXh0cmEgdHJ1c3RlZCBjZXJ0aWZpY2F0ZXMuIFRoaXMgaGVscHMgZGVhbCB3aXRoIHNlbGYtc2lnbmVkIGNlcnRpZmljYXRlcyBmb3IgR2l0SHViIEVudGVycHJpc2UgU2VydmVyLlxuICAgKlxuICAgKiBBbGwgZmlyc3QgcGFydHkgRG9ja2VyZmlsZXMgc3VwcG9ydCB0aGlzLiBPdGhlcnMgbWF5IG5vdC5cbiAgICpcbiAgICogQHBhcmFtIHBhdGggcGF0aCB0byBkaXJlY3RvcnkgY29udGFpbmluZyBhIGZpbGUgY2FsbGVkIGNlcnRzLnBlbSBjb250YWluaW5nIGFsbCB0aGUgcmVxdWlyZWQgY2VydGlmaWNhdGVzXG4gICAqL1xuICBwdWJsaWMgYWRkRXh0cmFDZXJ0aWZpY2F0ZXMocGF0aDogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMuYm91bmRJbWFnZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbWFnZSBpcyBhbHJlYWR5IGJvdW5kLiBVc2UgdGhpcyBtZXRob2QgYmVmb3JlIHBhc3NpbmcgdGhlIGJ1aWxkZXIgdG8gYSBydW5uZXIgcHJvdmlkZXIuJyk7XG4gICAgfVxuICAgIHRoaXMuYWRkRmlsZXMocGF0aCwgJ2V4dHJhX2NlcnRzJyk7XG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IElSdW5uZXJQcm92aWRlciB0byBmaW5hbGl6ZSBzZXR0aW5ncyBhbmQgY3JlYXRlIHRoZSBpbWFnZSBidWlsZGVyLlxuICAgKi9cbiAgcHVibGljIGJpbmREb2NrZXJJbWFnZSgpOiBSdW5uZXJJbWFnZSB7XG4gICAgaWYgKHRoaXMuYm91bmRJbWFnZSkge1xuICAgICAgcmV0dXJuIHRoaXMuYm91bmRJbWFnZTtcbiAgICB9XG5cbiAgICAvLyBsb2cgZ3JvdXAgZm9yIHRoZSBpbWFnZSBidWlsZHNcbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKFxuICAgICAgdGhpcyxcbiAgICAgICdMb2dzJyxcbiAgICAgIHtcbiAgICAgICAgcmV0ZW50aW9uOiB0aGlzLnByb3BzLmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogdGhpcy5wcm9wcy5sb2dSZW1vdmFsUG9saWN5ID8/IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIGdlbmVyYXRlIGJ1aWxkU3BlY1xuICAgIGNvbnN0IGJ1aWxkU3BlYyA9IHRoaXMuZ2V0QnVpbGRTcGVjKHRoaXMucmVwb3NpdG9yeSwgbG9nR3JvdXAsIHRoaXMucHJvcHMucnVubmVyVmVyc2lvbik7XG5cbiAgICAvLyBjcmVhdGUgQ29kZUJ1aWxkIHByb2plY3QgdGhhdCBidWlsZHMgRG9ja2VyZmlsZSBhbmQgcHVzaGVzIHRvIHJlcG9zaXRvcnlcbiAgICBjb25zdCBwcm9qZWN0ID0gbmV3IGNvZGVidWlsZC5Qcm9qZWN0KHRoaXMsICdDb2RlQnVpbGQnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogYEJ1aWxkIGRvY2tlciBpbWFnZSBmb3Igc2VsZi1ob3N0ZWQgR2l0SHViIHJ1bm5lciAke3RoaXMubm9kZS5wYXRofSAoJHt0aGlzLm9zLm5hbWV9LyR7dGhpcy5hcmNoaXRlY3R1cmUubmFtZX0pYCxcbiAgICAgIGJ1aWxkU3BlYzogY29kZWJ1aWxkLkJ1aWxkU3BlYy5mcm9tT2JqZWN0KGJ1aWxkU3BlYyksXG4gICAgICBzb3VyY2U6IGNvZGVidWlsZC5Tb3VyY2UuczMoe1xuICAgICAgICBidWNrZXQ6IHRoaXMuZG9ja2VyZmlsZS5idWNrZXQsXG4gICAgICAgIHBhdGg6IHRoaXMuZG9ja2VyZmlsZS5zM09iamVjdEtleSxcbiAgICAgIH0pLFxuICAgICAgdnBjOiB0aGlzLnByb3BzLnZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnByb3BzLnNlY3VyaXR5R3JvdXAgPyBbdGhpcy5wcm9wcy5zZWN1cml0eUdyb3VwXSA6IHVuZGVmaW5lZCxcbiAgICAgIHN1Ym5ldFNlbGVjdGlvbjogdGhpcy5wcm9wcy5zdWJuZXRTZWxlY3Rpb24sXG4gICAgICB0aW1lb3V0OiB0aGlzLnByb3BzLnRpbWVvdXQgPz8gRHVyYXRpb24uaG91cnMoMSksXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBidWlsZEltYWdlOiB0aGlzLmJ1aWxkSW1hZ2UsXG4gICAgICAgIGNvbXB1dGVUeXBlOiB0aGlzLnByb3BzLmNvbXB1dGVUeXBlID8/IENvbXB1dGVUeXBlLlNNQUxMLFxuICAgICAgICBwcml2aWxlZ2VkOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGxvZ2dpbmc6IHtcbiAgICAgICAgY2xvdWRXYXRjaDoge1xuICAgICAgICAgIGxvZ0dyb3VwLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIHBlcm1pc3Npb25zXG4gICAgdGhpcy5yZXBvc2l0b3J5LmdyYW50UHVsbFB1c2gocHJvamVjdCk7XG4gICAgdGhpcy5wb2xpY3lTdGF0ZW1lbnRzLmZvckVhY2gocHJvamVjdC5hZGRUb1JvbGVQb2xpY3kpO1xuXG4gICAgLy8gY2FsbCBDb2RlQnVpbGQgZHVyaW5nIGRlcGxveW1lbnQgYW5kIGRlbGV0ZSBhbGwgaW1hZ2VzIGZyb20gcmVwb3NpdG9yeSBkdXJpbmcgZGVzdHJ1Y3Rpb25cbiAgICBjb25zdCBjciA9IHRoaXMuY3VzdG9tUmVzb3VyY2UocHJvamVjdCk7XG5cbiAgICAvLyByZWJ1aWxkIGltYWdlIG9uIGEgc2NoZWR1bGVcbiAgICB0aGlzLnJlYnVpbGRJbWFnZU9uU2NoZWR1bGUocHJvamVjdCwgdGhpcy5wcm9wcy5yZWJ1aWxkSW50ZXJ2YWwpO1xuXG4gICAgZm9yIChjb25zdCBbYXNzZXRQYXRoLCBhc3NldF0gb2YgdGhpcy5zZWNvbmRhcnlBc3NldHMuZW50cmllcygpKSB7XG4gICAgICBwcm9qZWN0LmFkZFNlY29uZGFyeVNvdXJjZShjb2RlYnVpbGQuU291cmNlLnMzKHtcbiAgICAgICAgaWRlbnRpZmllcjogYXNzZXRQYXRoLFxuICAgICAgICBidWNrZXQ6IGFzc2V0LmJ1Y2tldCxcbiAgICAgICAgcGF0aDogYXNzZXQuczNPYmplY3RLZXksXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgdGhpcy5ib3VuZEltYWdlID0ge1xuICAgICAgaW1hZ2VSZXBvc2l0b3J5OiB0aGlzLnJlcG9zaXRvcnksXG4gICAgICBpbWFnZVRhZzogJ2xhdGVzdCcsXG4gICAgICBhcmNoaXRlY3R1cmU6IHRoaXMuYXJjaGl0ZWN0dXJlLFxuICAgICAgb3M6IHRoaXMub3MsXG4gICAgICBsb2dHcm91cCxcbiAgICAgIHJ1bm5lclZlcnNpb246IHRoaXMucHJvcHMucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpLFxuICAgICAgX2RlcGVuZGFibGU6IGNyLnJlZixcbiAgICB9O1xuICAgIHJldHVybiB0aGlzLmJvdW5kSW1hZ2U7XG4gIH1cblxuICBwcml2YXRlIGdldEJ1aWxkSW1hZ2UoKTogY29kZWJ1aWxkLklCdWlsZEltYWdlIHtcbiAgICBpZiAodGhpcy5vcy5pcyhPcy5MSU5VWCkpIHtcbiAgICAgIGlmICh0aGlzLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICByZXR1cm4gY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5TVEFOREFSRF82XzA7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgICAgcmV0dXJuIGNvZGVidWlsZC5MaW51eEFybUJ1aWxkSW1hZ2UuQU1BWk9OX0xJTlVYXzJfU1RBTkRBUkRfMl8wO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAodGhpcy5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb2RlQnVpbGQgY2Fubm90IGJlIHVzZWQgdG8gYnVpbGQgV2luZG93cyBEb2NrZXIgaW1hZ2VzIGh0dHBzOi8vZ2l0aHViLmNvbS9kb2NrZXItbGlicmFyeS9kb2NrZXIvaXNzdWVzLzQ5Jyk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZmluZCBDb2RlQnVpbGQgaW1hZ2UgZm9yICR7dGhpcy5vcy5uYW1lfS8ke3RoaXMuYXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gIH1cblxuICBwcml2YXRlIGdldEJ1aWxkU3BlYyhyZXBvc2l0b3J5OiBlY3IuUmVwb3NpdG9yeSwgbG9nR3JvdXA6IGxvZ3MuTG9nR3JvdXAsIHJ1bm5lclZlcnNpb24/OiBSdW5uZXJWZXJzaW9uKTogYW55IHtcbiAgICAvLyBkb24ndCBmb3JnZXQgdG8gY2hhbmdlIEJVSUxEU1BFQ19WRVJTSU9OIHdoZW4gdGhlIGJ1aWxkU3BlYyBjaGFuZ2VzLCBhbmQgeW91IHdhbnQgdG8gdHJpZ2dlciBhIHJlYnVpbGQgb24gZGVwbG95XG4gICAgbGV0IGJ1aWxkQXJncyA9ICcnO1xuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiB0aGlzLmJ1aWxkQXJncy5lbnRyaWVzKCkpIHtcbiAgICAgIGJ1aWxkQXJncyArPSBgIC0tYnVpbGQtYXJnIFwiJHtuYW1lfVwiPVwiJHt2YWx1ZX1cImA7XG4gICAgfVxuICAgIGJ1aWxkQXJncyArPSBgIC0tYnVpbGQtYXJnIFJVTk5FUl9WRVJTSU9OPVwiJHtydW5uZXJWZXJzaW9uID8gcnVubmVyVmVyc2lvbi52ZXJzaW9uIDogUnVubmVyVmVyc2lvbi5sYXRlc3QoKS52ZXJzaW9ufVwiYDtcblxuICAgIGNvbnN0IHRoaXNTdGFjayA9IGNkay5TdGFjay5vZih0aGlzKTtcblxuICAgIHJldHVybiB7XG4gICAgICB2ZXJzaW9uOiAwLjIsXG4gICAgICBlbnY6IHtcbiAgICAgICAgdmFyaWFibGVzOiB7XG4gICAgICAgICAgUkVQT19BUk46IHJlcG9zaXRvcnkucmVwb3NpdG9yeUFybixcbiAgICAgICAgICBSRVBPX1VSSTogcmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgICAgIFNUQUNLX0lEOiAndW5zcGVjaWZpZWQnLFxuICAgICAgICAgIFJFUVVFU1RfSUQ6ICd1bnNwZWNpZmllZCcsXG4gICAgICAgICAgTE9HSUNBTF9SRVNPVVJDRV9JRDogJ3Vuc3BlY2lmaWVkJyxcbiAgICAgICAgICBSRVNQT05TRV9VUkw6ICd1bnNwZWNpZmllZCcsXG4gICAgICAgICAgUlVOTkVSX1ZFUlNJT046IHJ1bm5lclZlcnNpb24gPyBydW5uZXJWZXJzaW9uLnZlcnNpb24gOiBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpLnZlcnNpb24sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgcGhhc2VzOiB7XG4gICAgICAgIHByZV9idWlsZDoge1xuICAgICAgICAgIGNvbW1hbmRzOiB0aGlzLnByZUJ1aWxkLmNvbmNhdChbXG4gICAgICAgICAgICAnbWtkaXIgLXAgZXh0cmFfY2VydHMnLFxuICAgICAgICAgICAgYGF3cyBlY3IgZ2V0LWxvZ2luLXBhc3N3b3JkIC0tcmVnaW9uIFwiJEFXU19ERUZBVUxUX1JFR0lPTlwiIHwgZG9ja2VyIGxvZ2luIC0tdXNlcm5hbWUgQVdTIC0tcGFzc3dvcmQtc3RkaW4gJHt0aGlzU3RhY2suYWNjb3VudH0uZGtyLmVjci4ke3RoaXNTdGFjay5yZWdpb259LmFtYXpvbmF3cy5jb21gLFxuICAgICAgICAgIF0pLFxuICAgICAgICB9LFxuICAgICAgICBidWlsZDoge1xuICAgICAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICAgICBgZG9ja2VyIGJ1aWxkIC4gLXQgXCIkUkVQT19VUklcIiAke2J1aWxkQXJnc31gLFxuICAgICAgICAgICAgJ2RvY2tlciBwdXNoIFwiJFJFUE9fVVJJXCInLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHBvc3RfYnVpbGQ6IHtcbiAgICAgICAgICBjb21tYW5kczogdGhpcy5wb3N0QnVpbGQuY29uY2F0KFtcbiAgICAgICAgICAgICdTVEFUVVM9XCJTVUNDRVNTXCInLFxuICAgICAgICAgICAgJ2lmIFsgJENPREVCVUlMRF9CVUlMRF9TVUNDRUVESU5HIC1uZSAxIF07IHRoZW4gU1RBVFVTPVwiRkFJTEVEXCI7IGZpJyxcbiAgICAgICAgICAgICdjYXQgPDxFT0YgPiAvdG1wL3BheWxvYWQuanNvblxcbicgK1xuICAgICAgICAgICAgJ3tcXG4nICtcbiAgICAgICAgICAgICcgIFwiU3RhY2tJZFwiOiBcIiRTVEFDS19JRFwiLFxcbicgK1xuICAgICAgICAgICAgJyAgXCJSZXF1ZXN0SWRcIjogXCIkUkVRVUVTVF9JRFwiLFxcbicgK1xuICAgICAgICAgICAgJyAgXCJMb2dpY2FsUmVzb3VyY2VJZFwiOiBcIiRMT0dJQ0FMX1JFU09VUkNFX0lEXCIsXFxuJyArXG4gICAgICAgICAgICAnICBcIlBoeXNpY2FsUmVzb3VyY2VJZFwiOiBcIiRSRVBPX0FSTlwiLFxcbicgK1xuICAgICAgICAgICAgJyAgXCJTdGF0dXNcIjogXCIkU1RBVFVTXCIsXFxuJyArXG4gICAgICAgICAgICBgICBcIlJlYXNvblwiOiBcIlNlZSBsb2dzIGluICR7bG9nR3JvdXAubG9nR3JvdXBOYW1lfS8kQ09ERUJVSUxEX0xPR19QQVRIIChkZXBsb3kgYWdhaW4gd2l0aCBcXCdjZGsgZGVwbG95IC1SXFwnIG9yIGxvZ1JlbW92YWxQb2xpY3k9UmVtb3ZhbFBvbGljeS5SRVRBSU4gaWYgdGhleSBhcmUgYWxyZWFkeSBkZWxldGVkKVwiLFxcbmAgK1xuICAgICAgICAgICAgYCAgXCJEYXRhXCI6IHtcIk5hbWVcIjogXCIke3JlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWV9XCJ9XFxuYCArXG4gICAgICAgICAgICAnfVxcbicgK1xuICAgICAgICAgICAgJ0VPRicsXG4gICAgICAgICAgICAnaWYgWyBcIiRSRVNQT05TRV9VUkxcIiAhPSBcInVuc3BlY2lmaWVkXCIgXTsgdGhlbiBqcSAuIC90bXAvcGF5bG9hZC5qc29uOyBjdXJsIC1mc1NMIC1YIFBVVCAtSCBcIkNvbnRlbnQtVHlwZTpcIiAtZCBcIkAvdG1wL3BheWxvYWQuanNvblwiIFwiJFJFU1BPTlNFX1VSTFwiOyBmaScsXG4gICAgICAgICAgXSksXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGN1c3RvbVJlc291cmNlKHByb2plY3Q6IGNvZGVidWlsZC5Qcm9qZWN0KSB7XG4gICAgY29uc3QgY3JIYW5kbGVyID0gc2luZ2xldG9uTGFtYmRhKEJ1aWxkSW1hZ2VGdW5jdGlvbiwgdGhpcywgJ2J1aWxkLWltYWdlJywge1xuICAgICAgZGVzY3JpcHRpb246ICdDdXN0b20gcmVzb3VyY2UgaGFuZGxlciB0aGF0IHRyaWdnZXJzIENvZGVCdWlsZCB0byBidWlsZCBydW5uZXIgaW1hZ2VzLCBhbmQgY2xlYW5zLXVwIGltYWdlcyBvbiBkZWxldGlvbicsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygzKSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICB9KTtcblxuICAgIGNvbnN0IHBvbGljeSA9IG5ldyBpYW0uUG9saWN5KHRoaXMsICdDUiBQb2xpY3knLCB7XG4gICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbJ2NvZGVidWlsZDpTdGFydEJ1aWxkJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbcHJvamVjdC5wcm9qZWN0QXJuXSxcbiAgICAgICAgfSksXG4gICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICBhY3Rpb25zOiBbJ2VjcjpCYXRjaERlbGV0ZUltYWdlJywgJ2VjcjpMaXN0SW1hZ2VzJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbdGhpcy5yZXBvc2l0b3J5LnJlcG9zaXRvcnlBcm5dLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG4gICAgY3JIYW5kbGVyLnJvbGU/LmF0dGFjaElubGluZVBvbGljeShwb2xpY3kpO1xuXG4gICAgY29uc3QgY3IgPSBuZXcgQ3VzdG9tUmVzb3VyY2UodGhpcywgJ0J1aWxkZXInLCB7XG4gICAgICBzZXJ2aWNlVG9rZW46IGNySGFuZGxlci5mdW5jdGlvbkFybixcbiAgICAgIHJlc291cmNlVHlwZTogJ0N1c3RvbTo6SW1hZ2VCdWlsZGVyJyxcbiAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgUmVwb05hbWU6IHRoaXMucmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZSxcbiAgICAgICAgUHJvamVjdE5hbWU6IHByb2plY3QucHJvamVjdE5hbWUsXG4gICAgICAgIC8vIFdlIGluY2x1ZGUgYSBoYXNoIHNvIHRoZSBpbWFnZSBpcyBidWlsdCBpbW1lZGlhdGVseSBvbiBjaGFuZ2VzLCBhbmQgd2UgZG9uJ3QgaGF2ZSB0byB3YWl0IGZvciBpdHMgc2NoZWR1bGVkIGJ1aWxkLlxuICAgICAgICAvLyBUaGlzIGFsc28gaGVscHMgbWFrZSBzdXJlIHRoZSBjaGFuZ2VzIGFyZSBnb29kLiBJZiB0aGV5IGhhdmUgYSBidWcsIHRoZSBkZXBsb3ltZW50IHdpbGwgZmFpbCBpbnN0ZWFkIG9mIGp1c3QgdGhlIHNjaGVkdWxlZCBidWlsZC5cbiAgICAgICAgQnVpbGRIYXNoOiB0aGlzLmhhc2hCdWlsZFNldHRpbmdzKCksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gYWRkIGRlcGVuZGVuY2llcyB0byBtYWtlIHN1cmUgcmVzb3VyY2VzIGFyZSB0aGVyZSB3aGVuIHdlIG5lZWQgdGhlbVxuICAgIGNyLm5vZGUuYWRkRGVwZW5kZW5jeShwcm9qZWN0KTtcbiAgICBjci5ub2RlLmFkZERlcGVuZGVuY3kocG9saWN5KTtcbiAgICBjci5ub2RlLmFkZERlcGVuZGVuY3koY3JIYW5kbGVyKTtcblxuICAgIHJldHVybiBjcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gaGFzaCBvZiBhbGwgc2V0dGluZ3MgdGhhdCBjYW4gYWZmZWN0IHRoZSByZXN1bHQgaW1hZ2Ugc28gd2UgY2FuIHRyaWdnZXIgdGhlIGJ1aWxkIHdoZW4gaXQgY2hhbmdlcy5cbiAgICogQHByaXZhdGVcbiAgICovXG4gIHByaXZhdGUgaGFzaEJ1aWxkU2V0dGluZ3MoKTogc3RyaW5nIHtcbiAgICAvLyBtYWluIERvY2tlcmZpbGVcbiAgICBsZXQgY29tcG9uZW50czogc3RyaW5nW10gPSBbdGhpcy5kb2NrZXJmaWxlLmFzc2V0SGFzaF07XG4gICAgLy8gYWxsIGFkZGl0aW9uYWwgZmlsZXNcbiAgICBmb3IgKGNvbnN0IFtuYW1lLCBhc3NldF0gb2YgdGhpcy5zZWNvbmRhcnlBc3NldHMuZW50cmllcygpKSB7XG4gICAgICBjb21wb25lbnRzLnB1c2gobmFtZSk7XG4gICAgICBjb21wb25lbnRzLnB1c2goYXNzZXQuYXNzZXRIYXNoKTtcbiAgICB9XG4gICAgLy8gYnVpbGRzcGVjLnltbCB2ZXJzaW9uXG4gICAgY29tcG9uZW50cy5wdXNoKGB2JHtDb2RlQnVpbGRJbWFnZUJ1aWxkZXIuQlVJTERTUEVDX1ZFUlNJT059YCk7XG4gICAgLy8gcnVubmVyIHZlcnNpb25cbiAgICBjb21wb25lbnRzLnB1c2godGhpcy5wcm9wcy5ydW5uZXJWZXJzaW9uPy52ZXJzaW9uID8/IFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkudmVyc2lvbik7XG4gICAgLy8gdXNlciBjb21tYW5kc1xuICAgIGNvbXBvbmVudHMgPSBjb21wb25lbnRzLmNvbmNhdCh0aGlzLnByZUJ1aWxkKTtcbiAgICBjb21wb25lbnRzID0gY29tcG9uZW50cy5jb25jYXQodGhpcy5wb3N0QnVpbGQpO1xuICAgIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiB0aGlzLmJ1aWxkQXJncy5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbXBvbmVudHMucHVzaChuYW1lKTtcbiAgICAgIGNvbXBvbmVudHMucHVzaCh2YWx1ZSk7XG4gICAgfVxuICAgIC8vIGhhc2ggaXRcbiAgICBjb25zdCBhbGwgPSBjb21wb25lbnRzLmpvaW4oJy0nKTtcbiAgICByZXR1cm4gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShhbGwpLmRpZ2VzdCgnaGV4Jyk7XG4gIH1cblxuICBwcml2YXRlIHJlYnVpbGRJbWFnZU9uU2NoZWR1bGUocHJvamVjdDogY29kZWJ1aWxkLlByb2plY3QsIHJlYnVpbGRJbnRlcnZhbD86IER1cmF0aW9uKSB7XG4gICAgcmVidWlsZEludGVydmFsID0gcmVidWlsZEludGVydmFsID8/IER1cmF0aW9uLmRheXMoNyk7XG4gICAgaWYgKHJlYnVpbGRJbnRlcnZhbC50b01pbGxpc2Vjb25kcygpICE9IDApIHtcbiAgICAgIGNvbnN0IHNjaGVkdWxlUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnQnVpbGQgU2NoZWR1bGUnLCB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiBgUmVidWlsZCBydW5uZXIgaW1hZ2UgZm9yICR7dGhpcy5yZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lfWAsXG4gICAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUucmF0ZShyZWJ1aWxkSW50ZXJ2YWwpLFxuICAgICAgfSk7XG4gICAgICBzY2hlZHVsZVJ1bGUuYWRkVGFyZ2V0KG5ldyBldmVudHNfdGFyZ2V0cy5Db2RlQnVpbGRQcm9qZWN0KHByb2plY3QpKTtcbiAgICB9XG4gIH1cblxuICBnZXQgY29ubmVjdGlvbnMoKTogZWMyLkNvbm5lY3Rpb25zIHtcbiAgICByZXR1cm4gbmV3IGVjMi5Db25uZWN0aW9ucyh7XG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5wcm9wcy5zZWN1cml0eUdyb3VwID8gW3RoaXMucHJvcHMuc2VjdXJpdHlHcm91cF0gOiBbXSxcbiAgICB9KTtcbiAgfVxuXG4gIGJpbmRBbWkoKTogUnVubmVyQW1pIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvZGVCdWlsZEltYWdlQnVpbGRlciBkb2VzIG5vdCBzdXBwb3J0IGJ1aWxkaW5nIEFNSXMnKTtcbiAgfVxufVxuIl19