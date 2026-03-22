"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaRunner = exports.LambdaRunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const path = require("path");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const common_1 = require("./common");
const update_lambda_function_1 = require("./update-lambda-function");
const image_builders_1 = require("../image-builders");
const utils_1 = require("../utils");
/**
 * GitHub Actions runner provider using Lambda to execute jobs.
 *
 * Creates a Docker-based function that gets executed for each job.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
class LambdaRunnerProvider extends common_1.BaseProvider {
    /**
     * Create new image builder that builds Lambda specific runner images.
     *
     * You can customize the OS, architecture, VPC, subnet, security groups, etc. by passing in props.
     *
     * You can add components to the image builder by calling `imageBuilder.addComponent()`.
     *
     * The default OS is Amazon Linux 2023 running on x64 architecture.
     *
     * Included components:
     *  * `RunnerImageComponent.requiredPackages()`
     *  * `RunnerImageComponent.runnerUser()`
     *  * `RunnerImageComponent.git()`
     *  * `RunnerImageComponent.githubCli()`
     *  * `RunnerImageComponent.awsCli()`
     *  * `RunnerImageComponent.githubRunner()`
     *  * `RunnerImageComponent.lambdaEntrypoint()`
     */
    static imageBuilder(scope, id, props) {
        return image_builders_1.RunnerImageBuilder.new(scope, id, {
            os: common_1.Os.LINUX_AMAZON_2023,
            architecture: common_1.Architecture.X86_64,
            components: [
                image_builders_1.RunnerImageComponent.requiredPackages(),
                image_builders_1.RunnerImageComponent.runnerUser(),
                image_builders_1.RunnerImageComponent.git(),
                image_builders_1.RunnerImageComponent.githubCli(),
                image_builders_1.RunnerImageComponent.awsCli(),
                image_builders_1.RunnerImageComponent.githubRunner(props?.runnerVersion ?? common_1.RunnerVersion.latest()),
                image_builders_1.RunnerImageComponent.lambdaEntrypoint(),
            ],
            ...props,
        });
    }
    constructor(scope, id, props) {
        super(scope, id, props);
        this.retryableErrors = [
            'Lambda.LambdaException',
            'Lambda.Ec2ThrottledException',
            'Lambda.Ec2UnexpectedException',
            'Lambda.EniLimitReachedException',
            'Lambda.TooManyRequestsException',
        ];
        this.labels = this.labelsFromProperties('lambda', props?.label, props?.labels);
        this.group = props?.group;
        this.defaultLabels = props?.defaultLabels ?? true;
        this.vpc = props?.vpc;
        this.securityGroups = props?.securityGroup ? [props.securityGroup] : props?.securityGroups;
        const imageBuilder = props?.imageBuilder ?? LambdaRunnerProvider.imageBuilder(this, 'Image Builder');
        const image = this.image = imageBuilder.bindDockerImage();
        let architecture;
        if (image.os.isIn(common_1.Os._ALL_LINUX_VERSIONS)) {
            if (image.architecture.is(common_1.Architecture.X86_64)) {
                architecture = aws_cdk_lib_1.aws_lambda.Architecture.X86_64;
            }
            if (image.architecture.is(common_1.Architecture.ARM64)) {
                architecture = aws_cdk_lib_1.aws_lambda.Architecture.ARM_64;
            }
        }
        if (!architecture) {
            throw new Error(`Unable to find supported Lambda architecture for ${image.os.name}/${image.architecture.name}`);
        }
        if (!image._dependable) {
            // AWS Image Builder can't get us dependable images and there is no point in using it anyway. CodeBuild is so much faster.
            // This may change if Lambda starts supporting Windows images. Then we would need AWS Image Builder.
            cdk.Annotations.of(this).addError('Lambda provider can only work with images built by CodeBuild and not AWS Image Builder. `waitOnDeploy: false` is also not supported.');
        }
        // get image digest and make sure to get it every time the lambda function might be updated
        // pass all variables that may change and cause a function update
        // if we don't get the latest digest, the update may fail as a new image was already built outside the stack on a schedule
        // we automatically delete old images, so we must always get the latest digest
        const imageDigest = this.imageDigest(image, {
            version: 1, // bump this for any non-user changes like description or defaults
            labels: this.labels,
            architecture: architecture.name,
            vpc: this.vpc?.vpcId,
            securityGroups: this.securityGroups?.map(sg => sg.securityGroupId),
            vpcSubnets: props?.subnetSelection?.subnets?.map(s => s.subnetId),
            timeout: props?.timeout?.toSeconds(),
            memorySize: props?.memorySize,
            ephemeralStorageSize: props?.ephemeralStorageSize?.toKibibytes(),
            logRetention: props?.logRetention?.toFixed(),
            // update on image build too to avoid conflict of the scheduled updater and any other CDK updates like VPC
            // this also helps with rollbacks as it will always get the right digest and prevent rollbacks using deleted images from failing
            dependable: image._dependable,
        });
        this.logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'Log', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
        });
        this.function = new aws_cdk_lib_1.aws_lambda.DockerImageFunction(this, 'Function', {
            description: `GitHub Actions runner for labels ${this.labels}`,
            // CDK requires "sha256:" literal prefix -- https://github.com/aws/aws-cdk/blob/ba91ca45ad759ab5db6da17a62333e2bc11e1075/packages/%40aws-cdk/aws-ecr/lib/repository.ts#L184
            code: aws_cdk_lib_1.aws_lambda.DockerImageCode.fromEcr(image.imageRepository, { tagOrDigest: `sha256:${imageDigest}` }),
            architecture,
            vpc: this.vpc,
            securityGroups: this.securityGroups,
            vpcSubnets: props?.subnetSelection,
            timeout: props?.timeout || cdk.Duration.minutes(15),
            memorySize: props?.memorySize || 2048,
            ephemeralStorageSize: props?.ephemeralStorageSize || cdk.Size.gibibytes(10),
            logGroup: this.logGroup,
        });
        this.grantPrincipal = this.function.grantPrincipal;
        this.addImageUpdater(image);
    }
    /**
     * The network connections associated with this resource.
     */
    get connections() {
        return this.function.connections;
    }
    /**
     * Generate step function task(s) to start a new runner.
     *
     * Called by GithubRunners and shouldn't be called manually.
     *
     * @param parameters workflow job details
     */
    getStepFunctionTask(parameters) {
        return new aws_cdk_lib_1.aws_stepfunctions_tasks.LambdaInvoke(this, 'State', {
            stateName: (0, common_1.generateStateName)(this),
            lambdaFunction: this.function,
            payload: aws_cdk_lib_1.aws_stepfunctions.TaskInput.fromObject({
                token: parameters.runnerTokenPath,
                jitConfig: parameters.jitConfigPath,
                runnerName: parameters.runnerNamePath,
                label: parameters.labelsPath,
                githubDomain: parameters.githubDomainPath,
                owner: parameters.ownerPath,
                repo: parameters.repoPath,
                registrationUrl: parameters.registrationUrl,
                group: this.group ? `--runnergroup ${this.group}` : '',
                defaultLabels: this.defaultLabels ? '' : '--no-default-labels',
            }),
        });
    }
    addImageUpdater(image) {
        // Lambda needs to be pointing to a specific image digest and not just a tag.
        // Whenever we update the tag to a new digest, we need to update the lambda.
        const updater = (0, utils_1.singletonLambda)(update_lambda_function_1.UpdateLambdaFunction, this, 'update-lambda', {
            description: 'Function that updates a GitHub Actions runner function with the latest image digest after the image has been rebuilt',
            timeout: cdk.Duration.minutes(15),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.RUNNER_IMAGE_BUILD),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
        });
        updater.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['lambda:UpdateFunctionCode'],
            resources: [this.function.functionArn],
        }));
        let lambdaTarget = new aws_cdk_lib_1.aws_events_targets.LambdaFunction(updater, {
            event: aws_cdk_lib_1.aws_events.RuleTargetInput.fromObject({
                lambdaName: this.function.functionName,
                repositoryUri: image.imageRepository.repositoryUri,
                repositoryTag: image.imageTag,
            }),
        });
        const rule = image.imageRepository.onEvent('Push rule', {
            crossStackScope: this, // allow provider and image builder to be in different stacks
            description: 'Update GitHub Actions runner Lambda on ECR image push',
            eventPattern: {
                detailType: ['ECR Image Action'],
                detail: {
                    'action-type': ['PUSH'],
                    'repository-name': [image.imageRepository.repositoryName],
                    'image-tag': [image.imageTag],
                    'result': ['SUCCESS'],
                },
            },
            target: lambdaTarget,
        });
        // the event never triggers without this - not sure why
        rule.node.defaultChild.addDeletionOverride('Properties.EventPattern.resources');
    }
    grantStateMachine(_) {
    }
    status(statusFunctionRole) {
        this.image.imageRepository.grant(statusFunctionRole, 'ecr:DescribeImages');
        return {
            type: this.constructor.name,
            labels: this.labels,
            constructPath: this.node.path,
            vpcArn: this.vpc?.vpcArn,
            securityGroups: this.securityGroups?.map(sg => sg.securityGroupId),
            roleArn: this.function.role?.roleArn,
            logGroup: this.function.logGroup.logGroupName,
            image: {
                imageRepository: this.image.imageRepository.repositoryUri,
                imageTag: this.image.imageTag,
                imageBuilderLogGroup: this.image.logGroup?.logGroupName,
            },
        };
    }
    imageDigest(image, variableSettings) {
        // describe ECR image to get its digest
        // the physical id is random so the resource always runs and always gets the latest digest, even if a scheduled build replaced the stack image
        const reader = new aws_cdk_lib_1.custom_resources.AwsCustomResource(this, 'Image Digest Reader', {
            onCreate: {
                service: 'ECR',
                action: 'describeImages',
                parameters: {
                    repositoryName: image.imageRepository.repositoryName,
                    imageIds: [
                        {
                            imageTag: image.imageTag,
                        },
                    ],
                },
                physicalResourceId: aws_cdk_lib_1.custom_resources.PhysicalResourceId.of('ImageDigest'),
            },
            onUpdate: {
                service: 'ECR',
                action: 'describeImages',
                parameters: {
                    repositoryName: image.imageRepository.repositoryName,
                    imageIds: [
                        {
                            imageTag: image.imageTag,
                        },
                    ],
                },
                physicalResourceId: aws_cdk_lib_1.custom_resources.PhysicalResourceId.of('ImageDigest'),
            },
            onDelete: {
                // this will NOT be called thanks to RemovalPolicy.RETAIN below
                // we only use this to force the custom resource to be called again and get a new digest
                service: 'fake',
                action: 'fake',
                parameters: variableSettings,
            },
            policy: aws_cdk_lib_1.custom_resources.AwsCustomResourcePolicy.fromSdkCalls({
                resources: [image.imageRepository.repositoryArn],
            }),
            resourceType: 'Custom::EcrImageDigest',
            installLatestAwsSdk: false, // no need and it takes 60 seconds
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.RUNNER_IMAGE_BUILD),
        });
        // mark this resource as retainable, as there is nothing to do on delete
        const res = reader.node.tryFindChild('Resource');
        if (res) {
            // don't actually call the fake onDelete above
            res.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
        }
        else {
            throw new Error('Resource not found in AwsCustomResource. Report this bug at https://github.com/CloudSnorkel/cdk-github-runners/issues.');
        }
        // return only the digest because CDK expects 'sha256:' literal above
        return cdk.Fn.split(':', reader.getResponseField('imageDetails.0.imageDigest'), 2)[1];
    }
}
exports.LambdaRunnerProvider = LambdaRunnerProvider;
_a = JSII_RTTI_SYMBOL_1;
LambdaRunnerProvider[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.LambdaRunnerProvider", version: "0.0.0" };
/**
 * Path to Dockerfile for Linux x64 with all the requirement for Lambda runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
 *
 * Available build arguments that can be set in the image builder:
 * * `BASE_IMAGE` sets the `FROM` line. This should be similar to public.ecr.aws/lambda/nodejs:14.
 * * `EXTRA_PACKAGES` can be used to install additional packages.
 *
 * @deprecated Use `imageBuilder()` instead.
 */
LambdaRunnerProvider.LINUX_X64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'lambda', 'linux-x64');
/**
 * Path to Dockerfile for Linux ARM64 with all the requirement for Lambda runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
 *
 * Available build arguments that can be set in the image builder:
 * * `BASE_IMAGE` sets the `FROM` line. This should be similar to public.ecr.aws/lambda/nodejs:14.
 * * `EXTRA_PACKAGES` can be used to install additional packages.
 *
 * @deprecated Use `imageBuilder()` instead.
 */
LambdaRunnerProvider.LINUX_ARM64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'lambda', 'linux-arm64');
/**
 * @deprecated use {@link LambdaRunnerProvider}
 */
class LambdaRunner extends LambdaRunnerProvider {
}
exports.LambdaRunner = LambdaRunner;
_b = JSII_RTTI_SYMBOL_1;
LambdaRunner[_b] = { fqn: "@cloudsnorkel/cdk-github-runners.LambdaRunner", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9sYW1iZGEudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSw2QkFBNkI7QUFDN0IsbUNBQW1DO0FBQ25DLDZDQVVxQjtBQUNyQixtREFBcUQ7QUFFckQscUNBV2tCO0FBQ2xCLHFFQUFnRTtBQUNoRSxzREFBMkg7QUFDM0gsb0NBQWdGO0FBd0doRjs7Ozs7O0dBTUc7QUFDSCxNQUFhLG9CQUFxQixTQUFRLHFCQUFZO0lBdUJwRDs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FpQkc7SUFDSSxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3RGLE9BQU8sbUNBQWtCLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDdkMsRUFBRSxFQUFFLFdBQUUsQ0FBQyxpQkFBaUI7WUFDeEIsWUFBWSxFQUFFLHFCQUFZLENBQUMsTUFBTTtZQUNqQyxVQUFVLEVBQUU7Z0JBQ1YscUNBQW9CLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3ZDLHFDQUFvQixDQUFDLFVBQVUsRUFBRTtnQkFDakMscUNBQW9CLENBQUMsR0FBRyxFQUFFO2dCQUMxQixxQ0FBb0IsQ0FBQyxTQUFTLEVBQUU7Z0JBQ2hDLHFDQUFvQixDQUFDLE1BQU0sRUFBRTtnQkFDN0IscUNBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxhQUFhLElBQUksc0JBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDakYscUNBQW9CLENBQUMsZ0JBQWdCLEVBQUU7YUFDeEM7WUFDRCxHQUFHLEtBQUs7U0FDVCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBNENELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBaUM7UUFDekUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFkakIsb0JBQWUsR0FBRztZQUN6Qix3QkFBd0I7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ZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHtcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19ldmVudHMgYXMgZXZlbnRzLFxuICBhd3NfZXZlbnRzX3RhcmdldHMgYXMgZXZlbnRzX3RhcmdldHMsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbGFtYmRhIGFzIGxhbWJkYSxcbiAgYXdzX2xvZ3MgYXMgbG9ncyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnMgYXMgc3RlcGZ1bmN0aW9ucyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnNfdGFza3MgYXMgc3RlcGZ1bmN0aW9uc190YXNrcyxcbiAgY3VzdG9tX3Jlc291cmNlcyBhcyBjcixcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHtcbiAgQXJjaGl0ZWN0dXJlLFxuICBCYXNlUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyU3RhdHVzLFxuICBPcyxcbiAgUnVubmVySW1hZ2UsXG4gIFJ1bm5lclByb3ZpZGVyUHJvcHMsXG4gIFJ1bm5lclJ1bnRpbWVQYXJhbWV0ZXJzLFxuICBSdW5uZXJWZXJzaW9uLFxuICBnZW5lcmF0ZVN0YXRlTmFtZSxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgVXBkYXRlTGFtYmRhRnVuY3Rpb24gfSBmcm9tICcuL3VwZGF0ZS1sYW1iZGEtZnVuY3Rpb24nO1xuaW1wb3J0IHsgSVJ1bm5lckltYWdlQnVpbGRlciwgUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcywgUnVubmVySW1hZ2VDb21wb25lbnQgfSBmcm9tICcuLi9pbWFnZS1idWlsZGVycyc7XG5pbXBvcnQgeyBzaW5nbGV0b25MYW1iZGEsIHNpbmdsZXRvbkxvZ0dyb3VwLCBTaW5nbGV0b25Mb2dUeXBlIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIExhbWJkYVJ1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgRG9ja2VyIGltYWdlcyBjb250YWluaW5nIEdpdEh1YiBSdW5uZXIgYW5kIGFsbCByZXF1aXJlbWVudHMuXG4gICAqXG4gICAqIFRoZSBpbWFnZSBidWlsZGVyIG11c3QgY29udGFpbiB0aGUge0BsaW5rIFJ1bm5lckltYWdlQ29tcG9uZW50LmxhbWJkYUVudHJ5cG9pbnR9IGNvbXBvbmVudC5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgZGV0ZXJtaW5lcyB0aGUgT1MgYW5kIGFyY2hpdGVjdHVyZSBvZiB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBMYW1iZGFSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIoKVxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2VCdWlsZGVyPzogSVJ1bm5lckltYWdlQnVpbGRlcjtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgbGFiZWwgdXNlZCBmb3IgdGhpcyBwcm92aWRlci5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgbGFiZWxzfSBpbnN0ZWFkXG4gICAqL1xuICByZWFkb25seSBsYWJlbD86IHN0cmluZztcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgbGFiZWxzIHVzZWQgZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqXG4gICAqIFRoZXNlIGxhYmVscyBhcmUgdXNlZCB0byBpZGVudGlmeSB3aGljaCBwcm92aWRlciBzaG91bGQgc3Bhd24gYSBuZXcgb24tZGVtYW5kIHJ1bm5lci4gRXZlcnkgam9iIHNlbmRzIGEgd2ViaG9vayB3aXRoIHRoZSBsYWJlbHMgaXQncyBsb29raW5nIGZvclxuICAgKiBiYXNlZCBvbiBydW5zLW9uLiBXZSBtYXRjaCB0aGUgbGFiZWxzIGZyb20gdGhlIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlLiBJZiBhbGwgdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZSBhcmUgcHJlc2VudCBpbiB0aGVcbiAgICogam9iJ3MgbGFiZWxzLCB0aGlzIHByb3ZpZGVyIHdpbGwgYmUgY2hvc2VuIGFuZCBzcGF3biBhIG5ldyBydW5uZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IFsnbGFtYmRhJ11cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVscz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBydW5uZXIgZ3JvdXAgbmFtZS5cbiAgICpcbiAgICogSWYgc3BlY2lmaWVkLCB0aGUgcnVubmVyIHdpbGwgYmUgcmVnaXN0ZXJlZCB3aXRoIHRoaXMgZ3JvdXAgbmFtZS4gU2V0dGluZyBhIHJ1bm5lciBncm91cCBjYW4gaGVscCBtYW5hZ2luZyBhY2Nlc3MgdG8gc2VsZi1ob3N0ZWQgcnVubmVycy4gSXRcbiAgICogcmVxdWlyZXMgYSBwYWlkIEdpdEh1YiBhY2NvdW50LlxuICAgKlxuICAgKiBUaGUgZ3JvdXAgbXVzdCBleGlzdCBvciB0aGUgcnVubmVyIHdpbGwgbm90IHN0YXJ0LlxuICAgKlxuICAgKiBVc2VycyB3aWxsIHN0aWxsIGJlIGFibGUgdG8gdHJpZ2dlciB0aGlzIHJ1bm5lciB3aXRoIHRoZSBjb3JyZWN0IGxhYmVscy4gQnV0IHRoZSBydW5uZXIgd2lsbCBvbmx5IGJlIGFibGUgdG8gcnVuIGpvYnMgZnJvbSByZXBvcyBhbGxvd2VkIHRvIHVzZSB0aGUgZ3JvdXAuXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZFxuICAgKi9cbiAgcmVhZG9ubHkgZ3JvdXA/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBhbW91bnQgb2YgbWVtb3J5LCBpbiBNQiwgdGhhdCBpcyBhbGxvY2F0ZWQgdG8geW91ciBMYW1iZGEgZnVuY3Rpb24uXG4gICAqIExhbWJkYSB1c2VzIHRoaXMgdmFsdWUgdG8gcHJvcG9ydGlvbmFsbHkgYWxsb2NhdGUgdGhlIGFtb3VudCBvZiBDUFVcbiAgICogcG93ZXIuIEZvciBtb3JlIGluZm9ybWF0aW9uLCBzZWUgUmVzb3VyY2UgTW9kZWwgaW4gdGhlIEFXUyBMYW1iZGFcbiAgICogRGV2ZWxvcGVyIEd1aWRlLlxuICAgKlxuICAgKiBAZGVmYXVsdCAyMDQ4XG4gICAqL1xuICByZWFkb25seSBtZW1vcnlTaXplPzogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBUaGUgc2l6ZSBvZiB0aGUgZnVuY3Rpb27igJlzIC90bXAgZGlyZWN0b3J5IGluIE1pQi5cbiAgICpcbiAgICogQGRlZmF1bHQgMTAgR2lCXG4gICAqL1xuICByZWFkb25seSBlcGhlbWVyYWxTdG9yYWdlU2l6ZT86IGNkay5TaXplO1xuXG4gIC8qKlxuICAgKiBUaGUgZnVuY3Rpb24gZXhlY3V0aW9uIHRpbWUgKGluIHNlY29uZHMpIGFmdGVyIHdoaWNoIExhbWJkYSB0ZXJtaW5hdGVzXG4gICAqIHRoZSBmdW5jdGlvbi4gQmVjYXVzZSB0aGUgZXhlY3V0aW9uIHRpbWUgYWZmZWN0cyBjb3N0LCBzZXQgdGhpcyB2YWx1ZVxuICAgKiBiYXNlZCBvbiB0aGUgZnVuY3Rpb24ncyBleHBlY3RlZCBleGVjdXRpb24gdGltZS5cbiAgICpcbiAgICogQGRlZmF1bHQgRHVyYXRpb24ubWludXRlcygxNSlcbiAgICovXG4gIHJlYWRvbmx5IHRpbWVvdXQ/OiBjZGsuRHVyYXRpb247XG5cbiAgLyoqXG4gICAqIFZQQyB0byBsYXVuY2ggdGhlIHJ1bm5lcnMgaW4uXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIFZQQ1xuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwIHRvIGFzc2lnbiB0byB0aGlzIGluc3RhbmNlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBwdWJsaWMgbGFtYmRhIHdpdGggbm8gc2VjdXJpdHkgZ3JvdXBcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBzZWN1cml0eUdyb3Vwc31cbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA/OiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwcyB0byBhc3NpZ24gdG8gdGhpcyBpbnN0YW5jZS5cbiAgICpcbiAgICogQGRlZmF1bHQgcHVibGljIGxhbWJkYSB3aXRoIG5vIHNlY3VyaXR5IGdyb3VwXG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3Vwcz86IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIC8qKlxuICAgKiBXaGVyZSB0byBwbGFjZSB0aGUgbmV0d29yayBpbnRlcmZhY2VzIHdpdGhpbiB0aGUgVlBDLlxuICAgKlxuICAgKiBAZGVmYXVsdCBubyBzdWJuZXRcbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG59XG5cbi8qKlxuICogR2l0SHViIEFjdGlvbnMgcnVubmVyIHByb3ZpZGVyIHVzaW5nIExhbWJkYSB0byBleGVjdXRlIGpvYnMuXG4gKlxuICogQ3JlYXRlcyBhIERvY2tlci1iYXNlZCBmdW5jdGlvbiB0aGF0IGdldHMgZXhlY3V0ZWQgZm9yIGVhY2ggam9iLlxuICpcbiAqIFRoaXMgY29uc3RydWN0IGlzIG5vdCBtZWFudCB0byBiZSB1c2VkIGJ5IGl0c2VsZi4gSXQgc2hvdWxkIGJlIHBhc3NlZCBpbiB0aGUgcHJvdmlkZXJzIHByb3BlcnR5IGZvciBHaXRIdWJSdW5uZXJzLlxuICovXG5leHBvcnQgY2xhc3MgTGFtYmRhUnVubmVyUHJvdmlkZXIgZXh0ZW5kcyBCYXNlUHJvdmlkZXIgaW1wbGVtZW50cyBJUnVubmVyUHJvdmlkZXIge1xuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCB4NjQgd2l0aCBhbGwgdGhlIHJlcXVpcmVtZW50IGZvciBMYW1iZGEgcnVubmVyLiBVc2UgdGhpcyBEb2NrZXJmaWxlIHVubGVzcyB5b3UgbmVlZCB0byBjdXN0b21pemUgaXQgZnVydGhlciB0aGFuIGFsbG93ZWQgYnkgaG9va3MuXG4gICAqXG4gICAqIEF2YWlsYWJsZSBidWlsZCBhcmd1bWVudHMgdGhhdCBjYW4gYmUgc2V0IGluIHRoZSBpbWFnZSBidWlsZGVyOlxuICAgKiAqIGBCQVNFX0lNQUdFYCBzZXRzIHRoZSBgRlJPTWAgbGluZS4gVGhpcyBzaG91bGQgYmUgc2ltaWxhciB0byBwdWJsaWMuZWNyLmF3cy9sYW1iZGEvbm9kZWpzOjE0LlxuICAgKiAqIGBFWFRSQV9QQUNLQUdFU2AgY2FuIGJlIHVzZWQgdG8gaW5zdGFsbCBhZGRpdGlvbmFsIHBhY2thZ2VzLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGltYWdlQnVpbGRlcigpYCBpbnN0ZWFkLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9YNjRfRE9DS0VSRklMRV9QQVRIID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Fzc2V0cycsICdkb2NrZXItaW1hZ2VzJywgJ2xhbWJkYScsICdsaW51eC14NjQnKTtcblxuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCBBUk02NCB3aXRoIGFsbCB0aGUgcmVxdWlyZW1lbnQgZm9yIExhbWJkYSBydW5uZXIuIFVzZSB0aGlzIERvY2tlcmZpbGUgdW5sZXNzIHlvdSBuZWVkIHRvIGN1c3RvbWl6ZSBpdCBmdXJ0aGVyIHRoYW4gYWxsb3dlZCBieSBob29rcy5cbiAgICpcbiAgICogQXZhaWxhYmxlIGJ1aWxkIGFyZ3VtZW50cyB0aGF0IGNhbiBiZSBzZXQgaW4gdGhlIGltYWdlIGJ1aWxkZXI6XG4gICAqICogYEJBU0VfSU1BR0VgIHNldHMgdGhlIGBGUk9NYCBsaW5lLiBUaGlzIHNob3VsZCBiZSBzaW1pbGFyIHRvIHB1YmxpYy5lY3IuYXdzL2xhbWJkYS9ub2RlanM6MTQuXG4gICAqICogYEVYVFJBX1BBQ0tBR0VTYCBjYW4gYmUgdXNlZCB0byBpbnN0YWxsIGFkZGl0aW9uYWwgcGFja2FnZXMuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFVzZSBgaW1hZ2VCdWlsZGVyKClgIGluc3RlYWQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IExJTlVYX0FSTTY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdsYW1iZGEnLCAnbGludXgtYXJtNjQnKTtcblxuICAvKipcbiAgICogQ3JlYXRlIG5ldyBpbWFnZSBidWlsZGVyIHRoYXQgYnVpbGRzIExhbWJkYSBzcGVjaWZpYyBydW5uZXIgaW1hZ2VzLlxuICAgKlxuICAgKiBZb3UgY2FuIGN1c3RvbWl6ZSB0aGUgT1MsIGFyY2hpdGVjdHVyZSwgVlBDLCBzdWJuZXQsIHNlY3VyaXR5IGdyb3VwcywgZXRjLiBieSBwYXNzaW5nIGluIHByb3BzLlxuICAgKlxuICAgKiBZb3UgY2FuIGFkZCBjb21wb25lbnRzIHRvIHRoZSBpbWFnZSBidWlsZGVyIGJ5IGNhbGxpbmcgYGltYWdlQnVpbGRlci5hZGRDb21wb25lbnQoKWAuXG4gICAqXG4gICAqIFRoZSBkZWZhdWx0IE9TIGlzIEFtYXpvbiBMaW51eCAyMDIzIHJ1bm5pbmcgb24geDY0IGFyY2hpdGVjdHVyZS5cbiAgICpcbiAgICogSW5jbHVkZWQgY29tcG9uZW50czpcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJlcXVpcmVkUGFja2FnZXMoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcigpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQubGFtYmRhRW50cnlwb2ludCgpYFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcykge1xuICAgIHJldHVybiBSdW5uZXJJbWFnZUJ1aWxkZXIubmV3KHNjb3BlLCBpZCwge1xuICAgICAgb3M6IE9zLkxJTlVYX0FNQVpPTl8yMDIzLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUuWDg2XzY0LFxuICAgICAgY29tcG9uZW50czogW1xuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViUnVubmVyKHByb3BzPy5ydW5uZXJWZXJzaW9uID8/IFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5sYW1iZGFFbnRyeXBvaW50KCksXG4gICAgICBdLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIGZ1bmN0aW9uIGhvc3RpbmcgdGhlIEdpdEh1YiBydW5uZXIuXG4gICAqL1xuICByZWFkb25seSBmdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xuXG4gIC8qKlxuICAgKiBMYWJlbHMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcHJvdmlkZXIuXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBHcmFudCBwcmluY2lwYWwgdXNlZCB0byBhZGQgcGVybWlzc2lvbnMgdG8gdGhlIHJ1bm5lciByb2xlLlxuICAgKi9cbiAgcmVhZG9ubHkgZ3JhbnRQcmluY2lwYWw6IGlhbS5JUHJpbmNpcGFsO1xuXG4gIC8qKlxuICAgKiBEb2NrZXIgaW1hZ2UgbG9hZGVkIHdpdGggR2l0SHViIEFjdGlvbnMgUnVubmVyIGFuZCBpdHMgcHJlcmVxdWlzaXRlcy4gVGhlIGltYWdlIGlzIGJ1aWx0IGJ5IGFuIGltYWdlIGJ1aWxkZXIgYW5kIGlzIHNwZWNpZmljIHRvIExhbWJkYS5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVGhpcyBmaWVsZCBpcyBpbnRlcm5hbCBhbmQgc2hvdWxkIG5vdCBiZSBhY2Nlc3NlZCBkaXJlY3RseS5cbiAgICovXG4gIHJlYWRvbmx5IGltYWdlOiBSdW5uZXJJbWFnZTtcblxuICAvKipcbiAgICogTG9nIGdyb3VwIHdoZXJlIHByb3ZpZGVkIHJ1bm5lcnMgd2lsbCBzYXZlIHRoZWlyIGxvZ3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGlzIG5vdCB0aGUgam9iIGxvZywgYnV0IHRoZSBydW5uZXIgaXRzZWxmLiBJdCB3aWxsIG5vdCBjb250YWluIG91dHB1dCBmcm9tIHRoZSBHaXRIdWIgQWN0aW9uIGJ1dCBvbmx5IG1ldGFkYXRhIG9uIGl0cyBleGVjdXRpb24uXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cDogbG9ncy5JTG9nR3JvdXA7XG5cbiAgcmVhZG9ubHkgcmV0cnlhYmxlRXJyb3JzID0gW1xuICAgICdMYW1iZGEuTGFtYmRhRXhjZXB0aW9uJyxcbiAgICAnTGFtYmRhLkVjMlRocm90dGxlZEV4Y2VwdGlvbicsXG4gICAgJ0xhbWJkYS5FYzJVbmV4cGVjdGVkRXhjZXB0aW9uJyxcbiAgICAnTGFtYmRhLkVuaUxpbWl0UmVhY2hlZEV4Y2VwdGlvbicsXG4gICAgJ0xhbWJkYS5Ub29NYW55UmVxdWVzdHNFeGNlcHRpb24nLFxuICBdO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgZ3JvdXA/OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgZGVmYXVsdExhYmVsczogYm9vbGVhbjtcbiAgcHJpdmF0ZSByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcbiAgcHJpdmF0ZSByZWFkb25seSBzZWN1cml0eUdyb3Vwcz86IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogTGFtYmRhUnVubmVyUHJvdmlkZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgdGhpcy5sYWJlbHMgPSB0aGlzLmxhYmVsc0Zyb21Qcm9wZXJ0aWVzKCdsYW1iZGEnLCBwcm9wcz8ubGFiZWwsIHByb3BzPy5sYWJlbHMpO1xuICAgIHRoaXMuZ3JvdXAgPSBwcm9wcz8uZ3JvdXA7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcbiAgICB0aGlzLnZwYyA9IHByb3BzPy52cGM7XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwID8gW3Byb3BzLnNlY3VyaXR5R3JvdXBdIDogcHJvcHM/LnNlY3VyaXR5R3JvdXBzO1xuXG4gICAgY29uc3QgaW1hZ2VCdWlsZGVyID0gcHJvcHM/LmltYWdlQnVpbGRlciA/PyBMYW1iZGFSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIodGhpcywgJ0ltYWdlIEJ1aWxkZXInKTtcbiAgICBjb25zdCBpbWFnZSA9IHRoaXMuaW1hZ2UgPSBpbWFnZUJ1aWxkZXIuYmluZERvY2tlckltYWdlKCk7XG5cbiAgICBsZXQgYXJjaGl0ZWN0dXJlOiBsYW1iZGEuQXJjaGl0ZWN0dXJlIHwgdW5kZWZpbmVkO1xuICAgIGlmIChpbWFnZS5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICBpZiAoaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgIGFyY2hpdGVjdHVyZSA9IGxhbWJkYS5BcmNoaXRlY3R1cmUuWDg2XzY0O1xuICAgICAgfVxuICAgICAgaWYgKGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgIGFyY2hpdGVjdHVyZSA9IGxhbWJkYS5BcmNoaXRlY3R1cmUuQVJNXzY0O1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghYXJjaGl0ZWN0dXJlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBmaW5kIHN1cHBvcnRlZCBMYW1iZGEgYXJjaGl0ZWN0dXJlIGZvciAke2ltYWdlLm9zLm5hbWV9LyR7aW1hZ2UuYXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgfVxuXG4gICAgaWYgKCFpbWFnZS5fZGVwZW5kYWJsZSkge1xuICAgICAgLy8gQVdTIEltYWdlIEJ1aWxkZXIgY2FuJ3QgZ2V0IHVzIGRlcGVuZGFibGUgaW1hZ2VzIGFuZCB0aGVyZSBpcyBubyBwb2ludCBpbiB1c2luZyBpdCBhbnl3YXkuIENvZGVCdWlsZCBpcyBzbyBtdWNoIGZhc3Rlci5cbiAgICAgIC8vIFRoaXMgbWF5IGNoYW5nZSBpZiBMYW1iZGEgc3RhcnRzIHN1cHBvcnRpbmcgV2luZG93cyBpbWFnZXMuIFRoZW4gd2Ugd291bGQgbmVlZCBBV1MgSW1hZ2UgQnVpbGRlci5cbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcignTGFtYmRhIHByb3ZpZGVyIGNhbiBvbmx5IHdvcmsgd2l0aCBpbWFnZXMgYnVpbHQgYnkgQ29kZUJ1aWxkIGFuZCBub3QgQVdTIEltYWdlIEJ1aWxkZXIuIGB3YWl0T25EZXBsb3k6IGZhbHNlYCBpcyBhbHNvIG5vdCBzdXBwb3J0ZWQuJyk7XG4gICAgfVxuXG4gICAgLy8gZ2V0IGltYWdlIGRpZ2VzdCBhbmQgbWFrZSBzdXJlIHRvIGdldCBpdCBldmVyeSB0aW1lIHRoZSBsYW1iZGEgZnVuY3Rpb24gbWlnaHQgYmUgdXBkYXRlZFxuICAgIC8vIHBhc3MgYWxsIHZhcmlhYmxlcyB0aGF0IG1heSBjaGFuZ2UgYW5kIGNhdXNlIGEgZnVuY3Rpb24gdXBkYXRlXG4gICAgLy8gaWYgd2UgZG9uJ3QgZ2V0IHRoZSBsYXRlc3QgZGlnZXN0LCB0aGUgdXBkYXRlIG1heSBmYWlsIGFzIGEgbmV3IGltYWdlIHdhcyBhbHJlYWR5IGJ1aWx0IG91dHNpZGUgdGhlIHN0YWNrIG9uIGEgc2NoZWR1bGVcbiAgICAvLyB3ZSBhdXRvbWF0aWNhbGx5IGRlbGV0ZSBvbGQgaW1hZ2VzLCBzbyB3ZSBtdXN0IGFsd2F5cyBnZXQgdGhlIGxhdGVzdCBkaWdlc3RcbiAgICBjb25zdCBpbWFnZURpZ2VzdCA9IHRoaXMuaW1hZ2VEaWdlc3QoaW1hZ2UsIHtcbiAgICAgIHZlcnNpb246IDEsIC8vIGJ1bXAgdGhpcyBmb3IgYW55IG5vbi11c2VyIGNoYW5nZXMgbGlrZSBkZXNjcmlwdGlvbiBvciBkZWZhdWx0c1xuICAgICAgbGFiZWxzOiB0aGlzLmxhYmVscyxcbiAgICAgIGFyY2hpdGVjdHVyZTogYXJjaGl0ZWN0dXJlLm5hbWUsXG4gICAgICB2cGM6IHRoaXMudnBjPy52cGNJZCxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzPy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIHZwY1N1Ym5ldHM6IHByb3BzPy5zdWJuZXRTZWxlY3Rpb24/LnN1Ym5ldHM/Lm1hcChzID0+IHMuc3VibmV0SWQpLFxuICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQ/LnRvU2Vjb25kcygpLFxuICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUsXG4gICAgICBlcGhlbWVyYWxTdG9yYWdlU2l6ZTogcHJvcHM/LmVwaGVtZXJhbFN0b3JhZ2VTaXplPy50b0tpYmlieXRlcygpLFxuICAgICAgbG9nUmV0ZW50aW9uOiBwcm9wcz8ubG9nUmV0ZW50aW9uPy50b0ZpeGVkKCksXG4gICAgICAvLyB1cGRhdGUgb24gaW1hZ2UgYnVpbGQgdG9vIHRvIGF2b2lkIGNvbmZsaWN0IG9mIHRoZSBzY2hlZHVsZWQgdXBkYXRlciBhbmQgYW55IG90aGVyIENESyB1cGRhdGVzIGxpa2UgVlBDXG4gICAgICAvLyB0aGlzIGFsc28gaGVscHMgd2l0aCByb2xsYmFja3MgYXMgaXQgd2lsbCBhbHdheXMgZ2V0IHRoZSByaWdodCBkaWdlc3QgYW5kIHByZXZlbnQgcm9sbGJhY2tzIHVzaW5nIGRlbGV0ZWQgaW1hZ2VzIGZyb20gZmFpbGluZ1xuICAgICAgZGVwZW5kYWJsZTogaW1hZ2UuX2RlcGVuZGFibGUsXG4gICAgfSk7XG5cbiAgICB0aGlzLmxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0xvZycsIHtcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICByZXRlbnRpb246IHByb3BzPy5sb2dSZXRlbnRpb24gPz8gUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgfSk7XG5cbiAgICB0aGlzLmZ1bmN0aW9uID0gbmV3IGxhbWJkYS5Eb2NrZXJJbWFnZUZ1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgICdGdW5jdGlvbicsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiBgR2l0SHViIEFjdGlvbnMgcnVubmVyIGZvciBsYWJlbHMgJHt0aGlzLmxhYmVsc31gLFxuICAgICAgICAvLyBDREsgcmVxdWlyZXMgXCJzaGEyNTY6XCIgbGl0ZXJhbCBwcmVmaXggLS0gaHR0cHM6Ly9naXRodWIuY29tL2F3cy9hd3MtY2RrL2Jsb2IvYmE5MWNhNDVhZDc1OWFiNWRiNmRhMTdhNjIzMzNlMmJjMTFlMTA3NS9wYWNrYWdlcy8lNDBhd3MtY2RrL2F3cy1lY3IvbGliL3JlcG9zaXRvcnkudHMjTDE4NFxuICAgICAgICBjb2RlOiBsYW1iZGEuRG9ja2VySW1hZ2VDb2RlLmZyb21FY3IoaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LCB7IHRhZ09yRGlnZXN0OiBgc2hhMjU2OiR7aW1hZ2VEaWdlc3R9YCB9KSxcbiAgICAgICAgYXJjaGl0ZWN0dXJlLFxuICAgICAgICB2cGM6IHRoaXMudnBjLFxuICAgICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3VwcyxcbiAgICAgICAgdnBjU3VibmV0czogcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbixcbiAgICAgICAgdGltZW91dDogcHJvcHM/LnRpbWVvdXQgfHwgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgICBtZW1vcnlTaXplOiBwcm9wcz8ubWVtb3J5U2l6ZSB8fCAyMDQ4LFxuICAgICAgICBlcGhlbWVyYWxTdG9yYWdlU2l6ZTogcHJvcHM/LmVwaGVtZXJhbFN0b3JhZ2VTaXplIHx8IGNkay5TaXplLmdpYmlieXRlcygxMCksXG4gICAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgdGhpcy5ncmFudFByaW5jaXBhbCA9IHRoaXMuZnVuY3Rpb24uZ3JhbnRQcmluY2lwYWw7XG5cbiAgICB0aGlzLmFkZEltYWdlVXBkYXRlcihpbWFnZSk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIG5ldHdvcmsgY29ubmVjdGlvbnMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcmVzb3VyY2UuXG4gICAqL1xuICBwdWJsaWMgZ2V0IGNvbm5lY3Rpb25zKCk6IGVjMi5Db25uZWN0aW9ucyB7XG4gICAgcmV0dXJuIHRoaXMuZnVuY3Rpb24uY29ubmVjdGlvbnM7XG4gIH1cblxuICAvKipcbiAgICogR2VuZXJhdGUgc3RlcCBmdW5jdGlvbiB0YXNrKHMpIHRvIHN0YXJ0IGEgbmV3IHJ1bm5lci5cbiAgICpcbiAgICogQ2FsbGVkIGJ5IEdpdGh1YlJ1bm5lcnMgYW5kIHNob3VsZG4ndCBiZSBjYWxsZWQgbWFudWFsbHkuXG4gICAqXG4gICAqIEBwYXJhbSBwYXJhbWV0ZXJzIHdvcmtmbG93IGpvYiBkZXRhaWxzXG4gICAqL1xuICBnZXRTdGVwRnVuY3Rpb25UYXNrKHBhcmFtZXRlcnM6IFJ1bm5lclJ1bnRpbWVQYXJhbWV0ZXJzKTogc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlIHtcbiAgICByZXR1cm4gbmV3IHN0ZXBmdW5jdGlvbnNfdGFza3MuTGFtYmRhSW52b2tlKFxuICAgICAgdGhpcyxcbiAgICAgICdTdGF0ZScsXG4gICAgICB7XG4gICAgICAgIHN0YXRlTmFtZTogZ2VuZXJhdGVTdGF0ZU5hbWUodGhpcyksXG4gICAgICAgIGxhbWJkYUZ1bmN0aW9uOiB0aGlzLmZ1bmN0aW9uLFxuICAgICAgICBwYXlsb2FkOiBzdGVwZnVuY3Rpb25zLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgICB0b2tlbjogcGFyYW1ldGVycy5ydW5uZXJUb2tlblBhdGgsXG4gICAgICAgICAgaml0Q29uZmlnOiBwYXJhbWV0ZXJzLmppdENvbmZpZ1BhdGgsXG4gICAgICAgICAgcnVubmVyTmFtZTogcGFyYW1ldGVycy5ydW5uZXJOYW1lUGF0aCxcbiAgICAgICAgICBsYWJlbDogcGFyYW1ldGVycy5sYWJlbHNQYXRoLFxuICAgICAgICAgIGdpdGh1YkRvbWFpbjogcGFyYW1ldGVycy5naXRodWJEb21haW5QYXRoLFxuICAgICAgICAgIG93bmVyOiBwYXJhbWV0ZXJzLm93bmVyUGF0aCxcbiAgICAgICAgICByZXBvOiBwYXJhbWV0ZXJzLnJlcG9QYXRoLFxuICAgICAgICAgIHJlZ2lzdHJhdGlvblVybDogcGFyYW1ldGVycy5yZWdpc3RyYXRpb25VcmwsXG4gICAgICAgICAgZ3JvdXA6IHRoaXMuZ3JvdXAgPyBgLS1ydW5uZXJncm91cCAke3RoaXMuZ3JvdXB9YCA6ICcnLFxuICAgICAgICAgIGRlZmF1bHRMYWJlbHM6IHRoaXMuZGVmYXVsdExhYmVscyA/ICcnIDogJy0tbm8tZGVmYXVsdC1sYWJlbHMnLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkSW1hZ2VVcGRhdGVyKGltYWdlOiBSdW5uZXJJbWFnZSkge1xuICAgIC8vIExhbWJkYSBuZWVkcyB0byBiZSBwb2ludGluZyB0byBhIHNwZWNpZmljIGltYWdlIGRpZ2VzdCBhbmQgbm90IGp1c3QgYSB0YWcuXG4gICAgLy8gV2hlbmV2ZXIgd2UgdXBkYXRlIHRoZSB0YWcgdG8gYSBuZXcgZGlnZXN0LCB3ZSBuZWVkIHRvIHVwZGF0ZSB0aGUgbGFtYmRhLlxuXG4gICAgY29uc3QgdXBkYXRlciA9IHNpbmdsZXRvbkxhbWJkYShVcGRhdGVMYW1iZGFGdW5jdGlvbiwgdGhpcywgJ3VwZGF0ZS1sYW1iZGEnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0Z1bmN0aW9uIHRoYXQgdXBkYXRlcyBhIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBmdW5jdGlvbiB3aXRoIHRoZSBsYXRlc3QgaW1hZ2UgZGlnZXN0IGFmdGVyIHRoZSBpbWFnZSBoYXMgYmVlbiByZWJ1aWx0JyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlJVTk5FUl9JTUFHRV9CVUlMRCksXG4gICAgICBsb2dnaW5nRm9ybWF0OiBsYW1iZGEuTG9nZ2luZ0Zvcm1hdC5KU09OLFxuICAgIH0pO1xuXG4gICAgdXBkYXRlci5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydsYW1iZGE6VXBkYXRlRnVuY3Rpb25Db2RlJ10sXG4gICAgICByZXNvdXJjZXM6IFt0aGlzLmZ1bmN0aW9uLmZ1bmN0aW9uQXJuXSxcbiAgICB9KSk7XG5cbiAgICBsZXQgbGFtYmRhVGFyZ2V0ID0gbmV3IGV2ZW50c190YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHVwZGF0ZXIsIHtcbiAgICAgIGV2ZW50OiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBsYW1iZGFOYW1lOiB0aGlzLmZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcbiAgICAgICAgcmVwb3NpdG9yeVVyaTogaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICAgIHJlcG9zaXRvcnlUYWc6IGltYWdlLmltYWdlVGFnLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBjb25zdCBydWxlID0gaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5Lm9uRXZlbnQoJ1B1c2ggcnVsZScsIHtcbiAgICAgIGNyb3NzU3RhY2tTY29wZTogdGhpcywgLy8gYWxsb3cgcHJvdmlkZXIgYW5kIGltYWdlIGJ1aWxkZXIgdG8gYmUgaW4gZGlmZmVyZW50IHN0YWNrc1xuICAgICAgZGVzY3JpcHRpb246ICdVcGRhdGUgR2l0SHViIEFjdGlvbnMgcnVubmVyIExhbWJkYSBvbiBFQ1IgaW1hZ2UgcHVzaCcsXG4gICAgICBldmVudFBhdHRlcm46IHtcbiAgICAgICAgZGV0YWlsVHlwZTogWydFQ1IgSW1hZ2UgQWN0aW9uJ10sXG4gICAgICAgIGRldGFpbDoge1xuICAgICAgICAgICdhY3Rpb24tdHlwZSc6IFsnUFVTSCddLFxuICAgICAgICAgICdyZXBvc2l0b3J5LW5hbWUnOiBbaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lXSxcbiAgICAgICAgICAnaW1hZ2UtdGFnJzogW2ltYWdlLmltYWdlVGFnXSxcbiAgICAgICAgICAncmVzdWx0JzogWydTVUNDRVNTJ10sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICAgdGFyZ2V0OiBsYW1iZGFUYXJnZXQsXG4gICAgfSk7XG5cbiAgICAvLyB0aGUgZXZlbnQgbmV2ZXIgdHJpZ2dlcnMgd2l0aG91dCB0aGlzIC0gbm90IHN1cmUgd2h5XG4gICAgKHJ1bGUubm9kZS5kZWZhdWx0Q2hpbGQgYXMgZXZlbnRzLkNmblJ1bGUpLmFkZERlbGV0aW9uT3ZlcnJpZGUoJ1Byb3BlcnRpZXMuRXZlbnRQYXR0ZXJuLnJlc291cmNlcycpO1xuICB9XG5cbiAgZ3JhbnRTdGF0ZU1hY2hpbmUoXzogaWFtLklHcmFudGFibGUpIHtcbiAgfVxuXG4gIHN0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGU6IGlhbS5JR3JhbnRhYmxlKTogSVJ1bm5lclByb3ZpZGVyU3RhdHVzIHtcbiAgICB0aGlzLmltYWdlLmltYWdlUmVwb3NpdG9yeS5ncmFudChzdGF0dXNGdW5jdGlvblJvbGUsICdlY3I6RGVzY3JpYmVJbWFnZXMnKTtcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBsYWJlbHM6IHRoaXMubGFiZWxzLFxuICAgICAgY29uc3RydWN0UGF0aDogdGhpcy5ub2RlLnBhdGgsXG4gICAgICB2cGNBcm46IHRoaXMudnBjPy52cGNBcm4sXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcz8ubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICByb2xlQXJuOiB0aGlzLmZ1bmN0aW9uLnJvbGU/LnJvbGVBcm4sXG4gICAgICBsb2dHcm91cDogdGhpcy5mdW5jdGlvbi5sb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBpbWFnZToge1xuICAgICAgICBpbWFnZVJlcG9zaXRvcnk6IHRoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlVcmksXG4gICAgICAgIGltYWdlVGFnOiB0aGlzLmltYWdlLmltYWdlVGFnLFxuICAgICAgICBpbWFnZUJ1aWxkZXJMb2dHcm91cDogdGhpcy5pbWFnZS5sb2dHcm91cD8ubG9nR3JvdXBOYW1lLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBpbWFnZURpZ2VzdChpbWFnZTogUnVubmVySW1hZ2UsIHZhcmlhYmxlU2V0dGluZ3M6IGFueSk6IHN0cmluZyB7XG4gICAgLy8gZGVzY3JpYmUgRUNSIGltYWdlIHRvIGdldCBpdHMgZGlnZXN0XG4gICAgLy8gdGhlIHBoeXNpY2FsIGlkIGlzIHJhbmRvbSBzbyB0aGUgcmVzb3VyY2UgYWx3YXlzIHJ1bnMgYW5kIGFsd2F5cyBnZXRzIHRoZSBsYXRlc3QgZGlnZXN0LCBldmVuIGlmIGEgc2NoZWR1bGVkIGJ1aWxkIHJlcGxhY2VkIHRoZSBzdGFjayBpbWFnZVxuICAgIGNvbnN0IHJlYWRlciA9IG5ldyBjci5Bd3NDdXN0b21SZXNvdXJjZSh0aGlzLCAnSW1hZ2UgRGlnZXN0IFJlYWRlcicsIHtcbiAgICAgIG9uQ3JlYXRlOiB7XG4gICAgICAgIHNlcnZpY2U6ICdFQ1InLFxuICAgICAgICBhY3Rpb246ICdkZXNjcmliZUltYWdlcycsXG4gICAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgICByZXBvc2l0b3J5TmFtZTogaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lLFxuICAgICAgICAgIGltYWdlSWRzOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGltYWdlVGFnOiBpbWFnZS5pbWFnZVRhZyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgcGh5c2ljYWxSZXNvdXJjZUlkOiBjci5QaHlzaWNhbFJlc291cmNlSWQub2YoJ0ltYWdlRGlnZXN0JyksXG4gICAgICB9LFxuICAgICAgb25VcGRhdGU6IHtcbiAgICAgICAgc2VydmljZTogJ0VDUicsXG4gICAgICAgIGFjdGlvbjogJ2Rlc2NyaWJlSW1hZ2VzJyxcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIHJlcG9zaXRvcnlOYW1lOiBpbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWUsXG4gICAgICAgICAgaW1hZ2VJZHM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaW1hZ2VUYWc6IGltYWdlLmltYWdlVGFnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IGNyLlBoeXNpY2FsUmVzb3VyY2VJZC5vZignSW1hZ2VEaWdlc3QnKSxcbiAgICAgIH0sXG4gICAgICBvbkRlbGV0ZToge1xuICAgICAgICAvLyB0aGlzIHdpbGwgTk9UIGJlIGNhbGxlZCB0aGFua3MgdG8gUmVtb3ZhbFBvbGljeS5SRVRBSU4gYmVsb3dcbiAgICAgICAgLy8gd2Ugb25seSB1c2UgdGhpcyB0byBmb3JjZSB0aGUgY3VzdG9tIHJlc291cmNlIHRvIGJlIGNhbGxlZCBhZ2FpbiBhbmQgZ2V0IGEgbmV3IGRpZ2VzdFxuICAgICAgICBzZXJ2aWNlOiAnZmFrZScsXG4gICAgICAgIGFjdGlvbjogJ2Zha2UnLFxuICAgICAgICBwYXJhbWV0ZXJzOiB2YXJpYWJsZVNldHRpbmdzLFxuICAgICAgfSxcbiAgICAgIHBvbGljeTogY3IuQXdzQ3VzdG9tUmVzb3VyY2VQb2xpY3kuZnJvbVNka0NhbGxzKHtcbiAgICAgICAgcmVzb3VyY2VzOiBbaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LnJlcG9zaXRvcnlBcm5dLFxuICAgICAgfSksXG4gICAgICByZXNvdXJjZVR5cGU6ICdDdXN0b206OkVjckltYWdlRGlnZXN0JyxcbiAgICAgIGluc3RhbGxMYXRlc3RBd3NTZGs6IGZhbHNlLCAvLyBubyBuZWVkIGFuZCBpdCB0YWtlcyA2MCBzZWNvbmRzXG4gICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5SVU5ORVJfSU1BR0VfQlVJTEQpLFxuICAgIH0pO1xuXG4gICAgLy8gbWFyayB0aGlzIHJlc291cmNlIGFzIHJldGFpbmFibGUsIGFzIHRoZXJlIGlzIG5vdGhpbmcgdG8gZG8gb24gZGVsZXRlXG4gICAgY29uc3QgcmVzID0gcmVhZGVyLm5vZGUudHJ5RmluZENoaWxkKCdSZXNvdXJjZScpIGFzIGNkay5DdXN0b21SZXNvdXJjZSB8IHVuZGVmaW5lZDtcbiAgICBpZiAocmVzKSB7XG4gICAgICAvLyBkb24ndCBhY3R1YWxseSBjYWxsIHRoZSBmYWtlIG9uRGVsZXRlIGFib3ZlXG4gICAgICByZXMuYXBwbHlSZW1vdmFsUG9saWN5KGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignUmVzb3VyY2Ugbm90IGZvdW5kIGluIEF3c0N1c3RvbVJlc291cmNlLiBSZXBvcnQgdGhpcyBidWcgYXQgaHR0cHM6Ly9naXRodWIuY29tL0Nsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMvaXNzdWVzLicpO1xuICAgIH1cblxuICAgIC8vIHJldHVybiBvbmx5IHRoZSBkaWdlc3QgYmVjYXVzZSBDREsgZXhwZWN0cyAnc2hhMjU2OicgbGl0ZXJhbCBhYm92ZVxuICAgIHJldHVybiBjZGsuRm4uc3BsaXQoJzonLCByZWFkZXIuZ2V0UmVzcG9uc2VGaWVsZCgnaW1hZ2VEZXRhaWxzLjAuaW1hZ2VEaWdlc3QnKSwgMilbMV07XG4gIH1cbn1cblxuLyoqXG4gKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIExhbWJkYVJ1bm5lclByb3ZpZGVyfVxuICovXG5leHBvcnQgY2xhc3MgTGFtYmRhUnVubmVyIGV4dGVuZHMgTGFtYmRhUnVubmVyUHJvdmlkZXIge1xufVxuIl19