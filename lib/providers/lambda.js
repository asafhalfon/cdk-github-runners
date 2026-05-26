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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9sYW1iZGEudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSw2QkFBNkI7QUFDN0IsbUNBQW1DO0FBQ25DLDZDQVVxQjtBQUNyQixtREFBcUQ7QUFFckQscUNBV2tCO0FBQ2xCLHFFQUFnRTtBQUNoRSxzREFBMkg7QUFDM0gsb0NBQWdGO0FBd0doRjs7Ozs7O0dBTUc7QUFDSCxNQUFhLG9CQUFxQixTQUFRLHFCQUFZO0lBdUJwRDs7Ozs7Ozs7Ozs7Ozs7Ozs7T0FpQkc7SUFDSSxNQUFNLENBQUMsWUFBWSxDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3RGLE9BQU8sbUNBQWtCLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDdkMsRUFBRSxFQUFFLFdBQUUsQ0FBQyxpQkFBaUI7WUFDeEIsWUFBWSxFQUFFLHFCQUFZLENBQUMsTUFBTTtZQUNqQyxVQUFVLEVBQUU7Z0JBQ1YscUNBQW9CLENBQUMsZ0JBQWdCLEVBQUU7Z0JBQ3ZDLHFDQUFvQixDQUFDLFVBQVUsRUFBRTtnQkFDakMscUNBQW9CLENBQUMsR0FBRyxFQUFFO2dCQUMxQixxQ0FBb0IsQ0FBQyxTQUFTLEVBQUU7Z0JBQ2hDLHFDQUFvQixDQUFDLE1BQU0sRUFBRTtnQkFDN0IscUNBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxhQUFhLElBQUksc0JBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDakYscUNBQW9CLENBQUMsZ0JBQWdCLEVBQUU7YUFDeEM7WUFDRCxHQUFHLEtBQUs7U0FDVCxDQUFDLENBQUM7SUFDTCxDQUFDO0lBNENELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBaUM7UUFDekUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFkakIsb0JBQWUsR0FBRztZQUN6Qix3QkFBd0I7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ZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHtcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19ldmVudHMgYXMgZXZlbnRzLFxuICBhd3NfZXZlbnRzX3RhcmdldHMgYXMgZXZlbnRzX3RhcmdldHMsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbGFtYmRhIGFzIGxhbWJkYSxcbiAgYXdzX2xvZ3MgYXMgbG9ncyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnMgYXMgc3RlcGZ1bmN0aW9ucyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnNfdGFza3MgYXMgc3RlcGZ1bmN0aW9uc190YXNrcyxcbiAgY3VzdG9tX3Jlc291cmNlcyBhcyBjcixcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgUmV0ZW50aW9uRGF5cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHtcbiAgQXJjaGl0ZWN0dXJlLFxuICBCYXNlUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyU3RhdHVzLFxuICBJUnVubmVyUnVudGltZVBhcmFtZXRlcnMsXG4gIE9zLFxuICBSdW5uZXJJbWFnZSxcbiAgUnVubmVyUHJvdmlkZXJQcm9wcyxcbiAgUnVubmVyVmVyc2lvbixcbiAgZ2VuZXJhdGVTdGF0ZU5hbWUsXG59IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IFVwZGF0ZUxhbWJkYUZ1bmN0aW9uIH0gZnJvbSAnLi91cGRhdGUtbGFtYmRhLWZ1bmN0aW9uJztcbmltcG9ydCB7IElSdW5uZXJJbWFnZUJ1aWxkZXIsIFJ1bm5lckltYWdlQnVpbGRlciwgUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMsIFJ1bm5lckltYWdlQ29tcG9uZW50IH0gZnJvbSAnLi4vaW1hZ2UtYnVpbGRlcnMnO1xuaW1wb3J0IHsgc2luZ2xldG9uTGFtYmRhLCBzaW5nbGV0b25Mb2dHcm91cCwgU2luZ2xldG9uTG9nVHlwZSB9IGZyb20gJy4uL3V0aWxzJztcblxuZXhwb3J0IGludGVyZmFjZSBMYW1iZGFSdW5uZXJQcm92aWRlclByb3BzIGV4dGVuZHMgUnVubmVyUHJvdmlkZXJQcm9wcyB7XG4gIC8qKlxuICAgKiBSdW5uZXIgaW1hZ2UgYnVpbGRlciB1c2VkIHRvIGJ1aWxkIERvY2tlciBpbWFnZXMgY29udGFpbmluZyBHaXRIdWIgUnVubmVyIGFuZCBhbGwgcmVxdWlyZW1lbnRzLlxuICAgKlxuICAgKiBUaGUgaW1hZ2UgYnVpbGRlciBtdXN0IGNvbnRhaW4gdGhlIHtAbGluayBSdW5uZXJJbWFnZUNvbXBvbmVudC5sYW1iZGFFbnRyeXBvaW50fSBjb21wb25lbnQuXG4gICAqXG4gICAqIFRoZSBpbWFnZSBidWlsZGVyIGRldGVybWluZXMgdGhlIE9TIGFuZCBhcmNoaXRlY3R1cmUgb2YgdGhlIHJ1bm5lci5cbiAgICpcbiAgICogQGRlZmF1bHQgTGFtYmRhUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKClcbiAgICovXG4gIHJlYWRvbmx5IGltYWdlQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVsIHVzZWQgZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZFxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIGxhYmVsc30gaW5zdGVhZFxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWw/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2xhbWJkYSddXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgcnVubmVyIGdyb3VwIG5hbWUuXG4gICAqXG4gICAqIElmIHNwZWNpZmllZCwgdGhlIHJ1bm5lciB3aWxsIGJlIHJlZ2lzdGVyZWQgd2l0aCB0aGlzIGdyb3VwIG5hbWUuIFNldHRpbmcgYSBydW5uZXIgZ3JvdXAgY2FuIGhlbHAgbWFuYWdpbmcgYWNjZXNzIHRvIHNlbGYtaG9zdGVkIHJ1bm5lcnMuIEl0XG4gICAqIHJlcXVpcmVzIGEgcGFpZCBHaXRIdWIgYWNjb3VudC5cbiAgICpcbiAgICogVGhlIGdyb3VwIG11c3QgZXhpc3Qgb3IgdGhlIHJ1bm5lciB3aWxsIG5vdCBzdGFydC5cbiAgICpcbiAgICogVXNlcnMgd2lsbCBzdGlsbCBiZSBhYmxlIHRvIHRyaWdnZXIgdGhpcyBydW5uZXIgd2l0aCB0aGUgY29ycmVjdCBsYWJlbHMuIEJ1dCB0aGUgcnVubmVyIHdpbGwgb25seSBiZSBhYmxlIHRvIHJ1biBqb2JzIGZyb20gcmVwb3MgYWxsb3dlZCB0byB1c2UgdGhlIGdyb3VwLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgYW1vdW50IG9mIG1lbW9yeSwgaW4gTUIsIHRoYXQgaXMgYWxsb2NhdGVkIHRvIHlvdXIgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKiBMYW1iZGEgdXNlcyB0aGlzIHZhbHVlIHRvIHByb3BvcnRpb25hbGx5IGFsbG9jYXRlIHRoZSBhbW91bnQgb2YgQ1BVXG4gICAqIHBvd2VyLiBGb3IgbW9yZSBpbmZvcm1hdGlvbiwgc2VlIFJlc291cmNlIE1vZGVsIGluIHRoZSBBV1MgTGFtYmRhXG4gICAqIERldmVsb3BlciBHdWlkZS5cbiAgICpcbiAgICogQGRlZmF1bHQgMjA0OFxuICAgKi9cbiAgcmVhZG9ubHkgbWVtb3J5U2l6ZT86IG51bWJlcjtcblxuICAvKipcbiAgICogVGhlIHNpemUgb2YgdGhlIGZ1bmN0aW9u4oCZcyAvdG1wIGRpcmVjdG9yeSBpbiBNaUIuXG4gICAqXG4gICAqIEBkZWZhdWx0IDEwIEdpQlxuICAgKi9cbiAgcmVhZG9ubHkgZXBoZW1lcmFsU3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcblxuICAvKipcbiAgICogVGhlIGZ1bmN0aW9uIGV4ZWN1dGlvbiB0aW1lIChpbiBzZWNvbmRzKSBhZnRlciB3aGljaCBMYW1iZGEgdGVybWluYXRlc1xuICAgKiB0aGUgZnVuY3Rpb24uIEJlY2F1c2UgdGhlIGV4ZWN1dGlvbiB0aW1lIGFmZmVjdHMgY29zdCwgc2V0IHRoaXMgdmFsdWVcbiAgICogYmFzZWQgb24gdGhlIGZ1bmN0aW9uJ3MgZXhwZWN0ZWQgZXhlY3V0aW9uIHRpbWUuXG4gICAqXG4gICAqIEBkZWZhdWx0IER1cmF0aW9uLm1pbnV0ZXMoMTUpXG4gICAqL1xuICByZWFkb25seSB0aW1lb3V0PzogY2RrLkR1cmF0aW9uO1xuXG4gIC8qKlxuICAgKiBWUEMgdG8gbGF1bmNoIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBubyBWUENcbiAgICovXG4gIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cCB0byBhc3NpZ24gdG8gdGhpcyBpbnN0YW5jZS5cbiAgICpcbiAgICogQGRlZmF1bHQgcHVibGljIGxhbWJkYSB3aXRoIG5vIHNlY3VyaXR5IGdyb3VwXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgc2VjdXJpdHlHcm91cHN9XG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwPzogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgdG8gYXNzaWduIHRvIHRoaXMgaW5zdGFuY2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IHB1YmxpYyBsYW1iZGEgd2l0aCBubyBzZWN1cml0eSBncm91cFxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogV2hlcmUgdG8gcGxhY2UgdGhlIG5ldHdvcmsgaW50ZXJmYWNlcyB3aXRoaW4gdGhlIFZQQy5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gc3VibmV0XG4gICAqL1xuICByZWFkb25seSBzdWJuZXRTZWxlY3Rpb24/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xufVxuXG4vKipcbiAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBwcm92aWRlciB1c2luZyBMYW1iZGEgdG8gZXhlY3V0ZSBqb2JzLlxuICpcbiAqIENyZWF0ZXMgYSBEb2NrZXItYmFzZWQgZnVuY3Rpb24gdGhhdCBnZXRzIGV4ZWN1dGVkIGZvciBlYWNoIGpvYi5cbiAqXG4gKiBUaGlzIGNvbnN0cnVjdCBpcyBub3QgbWVhbnQgdG8gYmUgdXNlZCBieSBpdHNlbGYuIEl0IHNob3VsZCBiZSBwYXNzZWQgaW4gdGhlIHByb3ZpZGVycyBwcm9wZXJ0eSBmb3IgR2l0SHViUnVubmVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIExhbWJkYVJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqXG4gICAqIFBhdGggdG8gRG9ja2VyZmlsZSBmb3IgTGludXggeDY0IHdpdGggYWxsIHRoZSByZXF1aXJlbWVudCBmb3IgTGFtYmRhIHJ1bm5lci4gVXNlIHRoaXMgRG9ja2VyZmlsZSB1bmxlc3MgeW91IG5lZWQgdG8gY3VzdG9taXplIGl0IGZ1cnRoZXIgdGhhbiBhbGxvd2VkIGJ5IGhvb2tzLlxuICAgKlxuICAgKiBBdmFpbGFibGUgYnVpbGQgYXJndW1lbnRzIHRoYXQgY2FuIGJlIHNldCBpbiB0aGUgaW1hZ2UgYnVpbGRlcjpcbiAgICogKiBgQkFTRV9JTUFHRWAgc2V0cyB0aGUgYEZST01gIGxpbmUuIFRoaXMgc2hvdWxkIGJlIHNpbWlsYXIgdG8gcHVibGljLmVjci5hd3MvbGFtYmRhL25vZGVqczoxNC5cbiAgICogKiBgRVhUUkFfUEFDS0FHRVNgIGNhbiBiZSB1c2VkIHRvIGluc3RhbGwgYWRkaXRpb25hbCBwYWNrYWdlcy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgVXNlIGBpbWFnZUJ1aWxkZXIoKWAgaW5zdGVhZC5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgcmVhZG9ubHkgTElOVVhfWDY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdsYW1iZGEnLCAnbGludXgteDY0Jyk7XG5cbiAgLyoqXG4gICAqIFBhdGggdG8gRG9ja2VyZmlsZSBmb3IgTGludXggQVJNNjQgd2l0aCBhbGwgdGhlIHJlcXVpcmVtZW50IGZvciBMYW1iZGEgcnVubmVyLiBVc2UgdGhpcyBEb2NrZXJmaWxlIHVubGVzcyB5b3UgbmVlZCB0byBjdXN0b21pemUgaXQgZnVydGhlciB0aGFuIGFsbG93ZWQgYnkgaG9va3MuXG4gICAqXG4gICAqIEF2YWlsYWJsZSBidWlsZCBhcmd1bWVudHMgdGhhdCBjYW4gYmUgc2V0IGluIHRoZSBpbWFnZSBidWlsZGVyOlxuICAgKiAqIGBCQVNFX0lNQUdFYCBzZXRzIHRoZSBgRlJPTWAgbGluZS4gVGhpcyBzaG91bGQgYmUgc2ltaWxhciB0byBwdWJsaWMuZWNyLmF3cy9sYW1iZGEvbm9kZWpzOjE0LlxuICAgKiAqIGBFWFRSQV9QQUNLQUdFU2AgY2FuIGJlIHVzZWQgdG8gaW5zdGFsbCBhZGRpdGlvbmFsIHBhY2thZ2VzLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGltYWdlQnVpbGRlcigpYCBpbnN0ZWFkLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9BUk02NF9ET0NLRVJGSUxFX1BBVEggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnYXNzZXRzJywgJ2RvY2tlci1pbWFnZXMnLCAnbGFtYmRhJywgJ2xpbnV4LWFybTY0Jyk7XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBuZXcgaW1hZ2UgYnVpbGRlciB0aGF0IGJ1aWxkcyBMYW1iZGEgc3BlY2lmaWMgcnVubmVyIGltYWdlcy5cbiAgICpcbiAgICogWW91IGNhbiBjdXN0b21pemUgdGhlIE9TLCBhcmNoaXRlY3R1cmUsIFZQQywgc3VibmV0LCBzZWN1cml0eSBncm91cHMsIGV0Yy4gYnkgcGFzc2luZyBpbiBwcm9wcy5cbiAgICpcbiAgICogWW91IGNhbiBhZGQgY29tcG9uZW50cyB0byB0aGUgaW1hZ2UgYnVpbGRlciBieSBjYWxsaW5nIGBpbWFnZUJ1aWxkZXIuYWRkQ29tcG9uZW50KClgLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBPUyBpcyBBbWF6b24gTGludXggMjAyMyBydW5uaW5nIG9uIHg2NCBhcmNoaXRlY3R1cmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNvbXBvbmVudHM6XG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmxhbWJkYUVudHJ5cG9pbnQoKWBcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgaW1hZ2VCdWlsZGVyKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMpIHtcbiAgICByZXR1cm4gUnVubmVySW1hZ2VCdWlsZGVyLm5ldyhzY29wZSwgaWQsIHtcbiAgICAgIG9zOiBPcy5MSU5VWF9BTUFaT05fMjAyMyxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGNvbXBvbmVudHM6IFtcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcihwcm9wcz8ucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQubGFtYmRhRW50cnlwb2ludCgpLFxuICAgICAgXSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBmdW5jdGlvbiBob3N0aW5nIHRoZSBHaXRIdWIgcnVubmVyLlxuICAgKi9cbiAgcmVhZG9ubHkgZnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcblxuICAvKipcbiAgICogTGFiZWxzIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHByb3ZpZGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR3JhbnQgcHJpbmNpcGFsIHVzZWQgdG8gYWRkIHBlcm1pc3Npb25zIHRvIHRoZSBydW5uZXIgcm9sZS5cbiAgICovXG4gIHJlYWRvbmx5IGdyYW50UHJpbmNpcGFsOiBpYW0uSVByaW5jaXBhbDtcblxuICAvKipcbiAgICogRG9ja2VyIGltYWdlIGxvYWRlZCB3aXRoIEdpdEh1YiBBY3Rpb25zIFJ1bm5lciBhbmQgaXRzIHByZXJlcXVpc2l0ZXMuIFRoZSBpbWFnZSBpcyBidWlsdCBieSBhbiBpbWFnZSBidWlsZGVyIGFuZCBpcyBzcGVjaWZpYyB0byBMYW1iZGEuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSBpbWFnZTogUnVubmVySW1hZ2U7XG5cbiAgLyoqXG4gICAqIExvZyBncm91cCB3aGVyZSBwcm92aWRlZCBydW5uZXJzIHdpbGwgc2F2ZSB0aGVpciBsb2dzLlxuICAgKlxuICAgKiBOb3RlIHRoYXQgdGhpcyBpcyBub3QgdGhlIGpvYiBsb2csIGJ1dCB0aGUgcnVubmVyIGl0c2VsZi4gSXQgd2lsbCBub3QgY29udGFpbiBvdXRwdXQgZnJvbSB0aGUgR2l0SHViIEFjdGlvbiBidXQgb25seSBtZXRhZGF0YSBvbiBpdHMgZXhlY3V0aW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgbG9nR3JvdXA6IGxvZ3MuSUxvZ0dyb3VwO1xuXG4gIHJlYWRvbmx5IHJldHJ5YWJsZUVycm9ycyA9IFtcbiAgICAnTGFtYmRhLkxhbWJkYUV4Y2VwdGlvbicsXG4gICAgJ0xhbWJkYS5FYzJUaHJvdHRsZWRFeGNlcHRpb24nLFxuICAgICdMYW1iZGEuRWMyVW5leHBlY3RlZEV4Y2VwdGlvbicsXG4gICAgJ0xhbWJkYS5FbmlMaW1pdFJlYWNoZWRFeGNlcHRpb24nLFxuICAgICdMYW1iZGEuVG9vTWFueVJlcXVlc3RzRXhjZXB0aW9uJyxcbiAgXTtcblxuICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IExhbWJkYVJ1bm5lclByb3ZpZGVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIHRoaXMubGFiZWxzID0gdGhpcy5sYWJlbHNGcm9tUHJvcGVydGllcygnbGFtYmRhJywgcHJvcHM/LmxhYmVsLCBwcm9wcz8ubGFiZWxzKTtcbiAgICB0aGlzLmdyb3VwID0gcHJvcHM/Lmdyb3VwO1xuICAgIHRoaXMuZGVmYXVsdExhYmVscyA9IHByb3BzPy5kZWZhdWx0TGFiZWxzID8/IHRydWU7XG4gICAgdGhpcy52cGMgPSBwcm9wcz8udnBjO1xuICAgIHRoaXMuc2VjdXJpdHlHcm91cHMgPSBwcm9wcz8uc2VjdXJpdHlHcm91cCA/IFtwcm9wcy5zZWN1cml0eUdyb3VwXSA6IHByb3BzPy5zZWN1cml0eUdyb3VwcztcblxuICAgIGNvbnN0IGltYWdlQnVpbGRlciA9IHByb3BzPy5pbWFnZUJ1aWxkZXIgPz8gTGFtYmRhUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKHRoaXMsICdJbWFnZSBCdWlsZGVyJyk7XG4gICAgY29uc3QgaW1hZ2UgPSB0aGlzLmltYWdlID0gaW1hZ2VCdWlsZGVyLmJpbmREb2NrZXJJbWFnZSgpO1xuXG4gICAgbGV0IGFyY2hpdGVjdHVyZTogbGFtYmRhLkFyY2hpdGVjdHVyZSB8IHVuZGVmaW5lZDtcbiAgICBpZiAoaW1hZ2Uub3MuaXNJbihPcy5fQUxMX0xJTlVYX1ZFUlNJT05TKSkge1xuICAgICAgaWYgKGltYWdlLmFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICBhcmNoaXRlY3R1cmUgPSBsYW1iZGEuQXJjaGl0ZWN0dXJlLlg4Nl82NDtcbiAgICAgIH1cbiAgICAgIGlmIChpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgICBhcmNoaXRlY3R1cmUgPSBsYW1iZGEuQXJjaGl0ZWN0dXJlLkFSTV82NDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIWFyY2hpdGVjdHVyZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmFibGUgdG8gZmluZCBzdXBwb3J0ZWQgTGFtYmRhIGFyY2hpdGVjdHVyZSBmb3IgJHtpbWFnZS5vcy5uYW1lfS8ke2ltYWdlLmFyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgIH1cblxuICAgIGlmICghaW1hZ2UuX2RlcGVuZGFibGUpIHtcbiAgICAgIC8vIEFXUyBJbWFnZSBCdWlsZGVyIGNhbid0IGdldCB1cyBkZXBlbmRhYmxlIGltYWdlcyBhbmQgdGhlcmUgaXMgbm8gcG9pbnQgaW4gdXNpbmcgaXQgYW55d2F5LiBDb2RlQnVpbGQgaXMgc28gbXVjaCBmYXN0ZXIuXG4gICAgICAvLyBUaGlzIG1heSBjaGFuZ2UgaWYgTGFtYmRhIHN0YXJ0cyBzdXBwb3J0aW5nIFdpbmRvd3MgaW1hZ2VzLiBUaGVuIHdlIHdvdWxkIG5lZWQgQVdTIEltYWdlIEJ1aWxkZXIuXG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoJ0xhbWJkYSBwcm92aWRlciBjYW4gb25seSB3b3JrIHdpdGggaW1hZ2VzIGJ1aWx0IGJ5IENvZGVCdWlsZCBhbmQgbm90IEFXUyBJbWFnZSBCdWlsZGVyLiBgd2FpdE9uRGVwbG95OiBmYWxzZWAgaXMgYWxzbyBub3Qgc3VwcG9ydGVkLicpO1xuICAgIH1cblxuICAgIC8vIGdldCBpbWFnZSBkaWdlc3QgYW5kIG1ha2Ugc3VyZSB0byBnZXQgaXQgZXZlcnkgdGltZSB0aGUgbGFtYmRhIGZ1bmN0aW9uIG1pZ2h0IGJlIHVwZGF0ZWRcbiAgICAvLyBwYXNzIGFsbCB2YXJpYWJsZXMgdGhhdCBtYXkgY2hhbmdlIGFuZCBjYXVzZSBhIGZ1bmN0aW9uIHVwZGF0ZVxuICAgIC8vIGlmIHdlIGRvbid0IGdldCB0aGUgbGF0ZXN0IGRpZ2VzdCwgdGhlIHVwZGF0ZSBtYXkgZmFpbCBhcyBhIG5ldyBpbWFnZSB3YXMgYWxyZWFkeSBidWlsdCBvdXRzaWRlIHRoZSBzdGFjayBvbiBhIHNjaGVkdWxlXG4gICAgLy8gd2UgYXV0b21hdGljYWxseSBkZWxldGUgb2xkIGltYWdlcywgc28gd2UgbXVzdCBhbHdheXMgZ2V0IHRoZSBsYXRlc3QgZGlnZXN0XG4gICAgY29uc3QgaW1hZ2VEaWdlc3QgPSB0aGlzLmltYWdlRGlnZXN0KGltYWdlLCB7XG4gICAgICB2ZXJzaW9uOiAxLCAvLyBidW1wIHRoaXMgZm9yIGFueSBub24tdXNlciBjaGFuZ2VzIGxpa2UgZGVzY3JpcHRpb24gb3IgZGVmYXVsdHNcbiAgICAgIGxhYmVsczogdGhpcy5sYWJlbHMsXG4gICAgICBhcmNoaXRlY3R1cmU6IGFyY2hpdGVjdHVyZS5uYW1lLFxuICAgICAgdnBjOiB0aGlzLnZwYz8udnBjSWQsXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcz8ubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICB2cGNTdWJuZXRzOiBwcm9wcz8uc3VibmV0U2VsZWN0aW9uPy5zdWJuZXRzPy5tYXAocyA9PiBzLnN1Ym5ldElkKSxcbiAgICAgIHRpbWVvdXQ6IHByb3BzPy50aW1lb3V0Py50b1NlY29uZHMoKSxcbiAgICAgIG1lbW9yeVNpemU6IHByb3BzPy5tZW1vcnlTaXplLFxuICAgICAgZXBoZW1lcmFsU3RvcmFnZVNpemU6IHByb3BzPy5lcGhlbWVyYWxTdG9yYWdlU2l6ZT8udG9LaWJpYnl0ZXMoKSxcbiAgICAgIGxvZ1JldGVudGlvbjogcHJvcHM/LmxvZ1JldGVudGlvbj8udG9GaXhlZCgpLFxuICAgICAgLy8gdXBkYXRlIG9uIGltYWdlIGJ1aWxkIHRvbyB0byBhdm9pZCBjb25mbGljdCBvZiB0aGUgc2NoZWR1bGVkIHVwZGF0ZXIgYW5kIGFueSBvdGhlciBDREsgdXBkYXRlcyBsaWtlIFZQQ1xuICAgICAgLy8gdGhpcyBhbHNvIGhlbHBzIHdpdGggcm9sbGJhY2tzIGFzIGl0IHdpbGwgYWx3YXlzIGdldCB0aGUgcmlnaHQgZGlnZXN0IGFuZCBwcmV2ZW50IHJvbGxiYWNrcyB1c2luZyBkZWxldGVkIGltYWdlcyBmcm9tIGZhaWxpbmdcbiAgICAgIGRlcGVuZGFibGU6IGltYWdlLl9kZXBlbmRhYmxlLFxuICAgIH0pO1xuXG4gICAgdGhpcy5sb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdMb2cnLCB7XG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgcmV0ZW50aW9uOiBwcm9wcz8ubG9nUmV0ZW50aW9uID8/IFJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgIH0pO1xuXG4gICAgdGhpcy5mdW5jdGlvbiA9IG5ldyBsYW1iZGEuRG9ja2VySW1hZ2VGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnRnVuY3Rpb24nLFxuICAgICAge1xuICAgICAgICBkZXNjcmlwdGlvbjogYEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBmb3IgbGFiZWxzICR7dGhpcy5sYWJlbHN9YCxcbiAgICAgICAgLy8gQ0RLIHJlcXVpcmVzIFwic2hhMjU2OlwiIGxpdGVyYWwgcHJlZml4IC0tIGh0dHBzOi8vZ2l0aHViLmNvbS9hd3MvYXdzLWNkay9ibG9iL2JhOTFjYTQ1YWQ3NTlhYjVkYjZkYTE3YTYyMzMzZTJiYzExZTEwNzUvcGFja2FnZXMvJTQwYXdzLWNkay9hd3MtZWNyL2xpYi9yZXBvc2l0b3J5LnRzI0wxODRcbiAgICAgICAgY29kZTogbGFtYmRhLkRvY2tlckltYWdlQ29kZS5mcm9tRWNyKGltYWdlLmltYWdlUmVwb3NpdG9yeSwgeyB0YWdPckRpZ2VzdDogYHNoYTI1Njoke2ltYWdlRGlnZXN0fWAgfSksXG4gICAgICAgIGFyY2hpdGVjdHVyZSxcbiAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgICAgIHZwY1N1Ym5ldHM6IHByb3BzPy5zdWJuZXRTZWxlY3Rpb24sXG4gICAgICAgIHRpbWVvdXQ6IHByb3BzPy50aW1lb3V0IHx8IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgMjA0OCxcbiAgICAgICAgZXBoZW1lcmFsU3RvcmFnZVNpemU6IHByb3BzPy5lcGhlbWVyYWxTdG9yYWdlU2l6ZSB8fCBjZGsuU2l6ZS5naWJpYnl0ZXMoMTApLFxuICAgICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cCxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwgPSB0aGlzLmZ1bmN0aW9uLmdyYW50UHJpbmNpcGFsO1xuXG4gICAgdGhpcy5hZGRJbWFnZVVwZGF0ZXIoaW1hZ2UpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcHVibGljIGdldCBjb25uZWN0aW9ucygpOiBlYzIuQ29ubmVjdGlvbnMge1xuICAgIHJldHVybiB0aGlzLmZ1bmN0aW9uLmNvbm5lY3Rpb25zO1xuICB9XG5cbiAgLyoqXG4gICAqIEdlbmVyYXRlIHN0ZXAgZnVuY3Rpb24gdGFzayhzKSB0byBzdGFydCBhIG5ldyBydW5uZXIuXG4gICAqXG4gICAqIENhbGxlZCBieSBHaXRodWJSdW5uZXJzIGFuZCBzaG91bGRuJ3QgYmUgY2FsbGVkIG1hbnVhbGx5LlxuICAgKlxuICAgKiBAcGFyYW0gcGFyYW1ldGVycyB3b3JrZmxvdyBqb2IgZGV0YWlsc1xuICAgKi9cbiAgZ2V0U3RlcEZ1bmN0aW9uVGFzayhwYXJhbWV0ZXJzOiBJUnVubmVyUnVudGltZVBhcmFtZXRlcnMpOiBzdGVwZnVuY3Rpb25zLklDaGFpbmFibGUge1xuICAgIHJldHVybiBuZXcgc3RlcGZ1bmN0aW9uc190YXNrcy5MYW1iZGFJbnZva2UoXG4gICAgICB0aGlzLFxuICAgICAgJ1N0YXRlJyxcbiAgICAgIHtcbiAgICAgICAgc3RhdGVOYW1lOiBnZW5lcmF0ZVN0YXRlTmFtZSh0aGlzKSxcbiAgICAgICAgbGFtYmRhRnVuY3Rpb246IHRoaXMuZnVuY3Rpb24sXG4gICAgICAgIHBheWxvYWQ6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICAgIHRva2VuOiBwYXJhbWV0ZXJzLnJ1bm5lclRva2VuUGF0aCxcbiAgICAgICAgICBqaXRDb25maWc6IHBhcmFtZXRlcnMuaml0Q29uZmlnUGF0aCxcbiAgICAgICAgICBydW5uZXJOYW1lOiBwYXJhbWV0ZXJzLnJ1bm5lck5hbWVQYXRoLFxuICAgICAgICAgIGxhYmVsOiBwYXJhbWV0ZXJzLmxhYmVsc1BhdGgsXG4gICAgICAgICAgZ2l0aHViRG9tYWluOiBwYXJhbWV0ZXJzLmdpdGh1YkRvbWFpblBhdGgsXG4gICAgICAgICAgb3duZXI6IHBhcmFtZXRlcnMub3duZXJQYXRoLFxuICAgICAgICAgIHJlcG86IHBhcmFtZXRlcnMucmVwb1BhdGgsXG4gICAgICAgICAgcmVnaXN0cmF0aW9uVXJsOiBwYXJhbWV0ZXJzLnJlZ2lzdHJhdGlvblVybCxcbiAgICAgICAgICBncm91cDogdGhpcy5ncm91cCA/IGAtLXJ1bm5lcmdyb3VwICR7dGhpcy5ncm91cH1gIDogJycsXG4gICAgICAgICAgZGVmYXVsdExhYmVsczogdGhpcy5kZWZhdWx0TGFiZWxzID8gJycgOiAnLS1uby1kZWZhdWx0LWxhYmVscycsXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRJbWFnZVVwZGF0ZXIoaW1hZ2U6IFJ1bm5lckltYWdlKSB7XG4gICAgLy8gTGFtYmRhIG5lZWRzIHRvIGJlIHBvaW50aW5nIHRvIGEgc3BlY2lmaWMgaW1hZ2UgZGlnZXN0IGFuZCBub3QganVzdCBhIHRhZy5cbiAgICAvLyBXaGVuZXZlciB3ZSB1cGRhdGUgdGhlIHRhZyB0byBhIG5ldyBkaWdlc3QsIHdlIG5lZWQgdG8gdXBkYXRlIHRoZSBsYW1iZGEuXG5cbiAgICBjb25zdCB1cGRhdGVyID0gc2luZ2xldG9uTGFtYmRhKFVwZGF0ZUxhbWJkYUZ1bmN0aW9uLCB0aGlzLCAndXBkYXRlLWxhbWJkYScsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnRnVuY3Rpb24gdGhhdCB1cGRhdGVzIGEgR2l0SHViIEFjdGlvbnMgcnVubmVyIGZ1bmN0aW9uIHdpdGggdGhlIGxhdGVzdCBpbWFnZSBkaWdlc3QgYWZ0ZXIgdGhlIGltYWdlIGhhcyBiZWVuIHJlYnVpbHQnLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuUlVOTkVSX0lNQUdFX0JVSUxEKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgfSk7XG5cbiAgICB1cGRhdGVyLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpVcGRhdGVGdW5jdGlvbkNvZGUnXSxcbiAgICAgIHJlc291cmNlczogW3RoaXMuZnVuY3Rpb24uZnVuY3Rpb25Bcm5dLFxuICAgIH0pKTtcblxuICAgIGxldCBsYW1iZGFUYXJnZXQgPSBuZXcgZXZlbnRzX3RhcmdldHMuTGFtYmRhRnVuY3Rpb24odXBkYXRlciwge1xuICAgICAgZXZlbnQ6IGV2ZW50cy5SdWxlVGFyZ2V0SW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgIGxhbWJkYU5hbWU6IHRoaXMuZnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgICByZXBvc2l0b3J5VXJpOiBpbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgcmVwb3NpdG9yeVRhZzogaW1hZ2UuaW1hZ2VUYWcsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJ1bGUgPSBpbWFnZS5pbWFnZVJlcG9zaXRvcnkub25FdmVudCgnUHVzaCBydWxlJywge1xuICAgICAgY3Jvc3NTdGFja1Njb3BlOiB0aGlzLCAvLyBhbGxvdyBwcm92aWRlciBhbmQgaW1hZ2UgYnVpbGRlciB0byBiZSBpbiBkaWZmZXJlbnQgc3RhY2tzXG4gICAgICBkZXNjcmlwdGlvbjogJ1VwZGF0ZSBHaXRIdWIgQWN0aW9ucyBydW5uZXIgTGFtYmRhIG9uIEVDUiBpbWFnZSBwdXNoJyxcbiAgICAgIGV2ZW50UGF0dGVybjoge1xuICAgICAgICBkZXRhaWxUeXBlOiBbJ0VDUiBJbWFnZSBBY3Rpb24nXSxcbiAgICAgICAgZGV0YWlsOiB7XG4gICAgICAgICAgJ2FjdGlvbi10eXBlJzogWydQVVNIJ10sXG4gICAgICAgICAgJ3JlcG9zaXRvcnktbmFtZSc6IFtpbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWVdLFxuICAgICAgICAgICdpbWFnZS10YWcnOiBbaW1hZ2UuaW1hZ2VUYWddLFxuICAgICAgICAgICdyZXN1bHQnOiBbJ1NVQ0NFU1MnXSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICB0YXJnZXQ6IGxhbWJkYVRhcmdldCxcbiAgICB9KTtcblxuICAgIC8vIHRoZSBldmVudCBuZXZlciB0cmlnZ2VycyB3aXRob3V0IHRoaXMgLSBub3Qgc3VyZSB3aHlcbiAgICAocnVsZS5ub2RlLmRlZmF1bHRDaGlsZCBhcyBldmVudHMuQ2ZuUnVsZSkuYWRkRGVsZXRpb25PdmVycmlkZSgnUHJvcGVydGllcy5FdmVudFBhdHRlcm4ucmVzb3VyY2VzJyk7XG4gIH1cblxuICBncmFudFN0YXRlTWFjaGluZShfOiBpYW0uSUdyYW50YWJsZSkge1xuICB9XG5cbiAgc3RhdHVzKHN0YXR1c0Z1bmN0aW9uUm9sZTogaWFtLklHcmFudGFibGUpOiBJUnVubmVyUHJvdmlkZXJTdGF0dXMge1xuICAgIHRoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LmdyYW50KHN0YXR1c0Z1bmN0aW9uUm9sZSwgJ2VjcjpEZXNjcmliZUltYWdlcycpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIGxhYmVsczogdGhpcy5sYWJlbHMsXG4gICAgICBjb25zdHJ1Y3RQYXRoOiB0aGlzLm5vZGUucGF0aCxcbiAgICAgIHZwY0FybjogdGhpcy52cGM/LnZwY0FybixcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzPy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIHJvbGVBcm46IHRoaXMuZnVuY3Rpb24ucm9sZT8ucm9sZUFybixcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmZ1bmN0aW9uLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGltYWdlOiB7XG4gICAgICAgIGltYWdlUmVwb3NpdG9yeTogdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgaW1hZ2VUYWc6IHRoaXMuaW1hZ2UuaW1hZ2VUYWcsXG4gICAgICAgIGltYWdlQnVpbGRlckxvZ0dyb3VwOiB0aGlzLmltYWdlLmxvZ0dyb3VwPy5sb2dHcm91cE5hbWUsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGltYWdlRGlnZXN0KGltYWdlOiBSdW5uZXJJbWFnZSwgdmFyaWFibGVTZXR0aW5nczogYW55KTogc3RyaW5nIHtcbiAgICAvLyBkZXNjcmliZSBFQ1IgaW1hZ2UgdG8gZ2V0IGl0cyBkaWdlc3RcbiAgICAvLyB0aGUgcGh5c2ljYWwgaWQgaXMgcmFuZG9tIHNvIHRoZSByZXNvdXJjZSBhbHdheXMgcnVucyBhbmQgYWx3YXlzIGdldHMgdGhlIGxhdGVzdCBkaWdlc3QsIGV2ZW4gaWYgYSBzY2hlZHVsZWQgYnVpbGQgcmVwbGFjZWQgdGhlIHN0YWNrIGltYWdlXG4gICAgY29uc3QgcmVhZGVyID0gbmV3IGNyLkF3c0N1c3RvbVJlc291cmNlKHRoaXMsICdJbWFnZSBEaWdlc3QgUmVhZGVyJywge1xuICAgICAgb25DcmVhdGU6IHtcbiAgICAgICAgc2VydmljZTogJ0VDUicsXG4gICAgICAgIGFjdGlvbjogJ2Rlc2NyaWJlSW1hZ2VzJyxcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIHJlcG9zaXRvcnlOYW1lOiBpbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWUsXG4gICAgICAgICAgaW1hZ2VJZHM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgaW1hZ2VUYWc6IGltYWdlLmltYWdlVGFnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICBwaHlzaWNhbFJlc291cmNlSWQ6IGNyLlBoeXNpY2FsUmVzb3VyY2VJZC5vZignSW1hZ2VEaWdlc3QnKSxcbiAgICAgIH0sXG4gICAgICBvblVwZGF0ZToge1xuICAgICAgICBzZXJ2aWNlOiAnRUNSJyxcbiAgICAgICAgYWN0aW9uOiAnZGVzY3JpYmVJbWFnZXMnLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgcmVwb3NpdG9yeU5hbWU6IGltYWdlLmltYWdlUmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZSxcbiAgICAgICAgICBpbWFnZUlkczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBpbWFnZVRhZzogaW1hZ2UuaW1hZ2VUYWcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICAgIHBoeXNpY2FsUmVzb3VyY2VJZDogY3IuUGh5c2ljYWxSZXNvdXJjZUlkLm9mKCdJbWFnZURpZ2VzdCcpLFxuICAgICAgfSxcbiAgICAgIG9uRGVsZXRlOiB7XG4gICAgICAgIC8vIHRoaXMgd2lsbCBOT1QgYmUgY2FsbGVkIHRoYW5rcyB0byBSZW1vdmFsUG9saWN5LlJFVEFJTiBiZWxvd1xuICAgICAgICAvLyB3ZSBvbmx5IHVzZSB0aGlzIHRvIGZvcmNlIHRoZSBjdXN0b20gcmVzb3VyY2UgdG8gYmUgY2FsbGVkIGFnYWluIGFuZCBnZXQgYSBuZXcgZGlnZXN0XG4gICAgICAgIHNlcnZpY2U6ICdmYWtlJyxcbiAgICAgICAgYWN0aW9uOiAnZmFrZScsXG4gICAgICAgIHBhcmFtZXRlcnM6IHZhcmlhYmxlU2V0dGluZ3MsXG4gICAgICB9LFxuICAgICAgcG9saWN5OiBjci5Bd3NDdXN0b21SZXNvdXJjZVBvbGljeS5mcm9tU2RrQ2FsbHMoe1xuICAgICAgICByZXNvdXJjZXM6IFtpbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeUFybl0sXG4gICAgICB9KSxcbiAgICAgIHJlc291cmNlVHlwZTogJ0N1c3RvbTo6RWNySW1hZ2VEaWdlc3QnLFxuICAgICAgaW5zdGFsbExhdGVzdEF3c1NkazogZmFsc2UsIC8vIG5vIG5lZWQgYW5kIGl0IHRha2VzIDYwIHNlY29uZHNcbiAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlJVTk5FUl9JTUFHRV9CVUlMRCksXG4gICAgfSk7XG5cbiAgICAvLyBtYXJrIHRoaXMgcmVzb3VyY2UgYXMgcmV0YWluYWJsZSwgYXMgdGhlcmUgaXMgbm90aGluZyB0byBkbyBvbiBkZWxldGVcbiAgICBjb25zdCByZXMgPSByZWFkZXIubm9kZS50cnlGaW5kQ2hpbGQoJ1Jlc291cmNlJykgYXMgY2RrLkN1c3RvbVJlc291cmNlIHwgdW5kZWZpbmVkO1xuICAgIGlmIChyZXMpIHtcbiAgICAgIC8vIGRvbid0IGFjdHVhbGx5IGNhbGwgdGhlIGZha2Ugb25EZWxldGUgYWJvdmVcbiAgICAgIHJlcy5hcHBseVJlbW92YWxQb2xpY3koY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdSZXNvdXJjZSBub3QgZm91bmQgaW4gQXdzQ3VzdG9tUmVzb3VyY2UuIFJlcG9ydCB0aGlzIGJ1ZyBhdCBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycy9pc3N1ZXMuJyk7XG4gICAgfVxuXG4gICAgLy8gcmV0dXJuIG9ubHkgdGhlIGRpZ2VzdCBiZWNhdXNlIENESyBleHBlY3RzICdzaGEyNTY6JyBsaXRlcmFsIGFib3ZlXG4gICAgcmV0dXJuIGNkay5Gbi5zcGxpdCgnOicsIHJlYWRlci5nZXRSZXNwb25zZUZpZWxkKCdpbWFnZURldGFpbHMuMC5pbWFnZURpZ2VzdCcpLCAyKVsxXTtcbiAgfVxufVxuXG4vKipcbiAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgTGFtYmRhUnVubmVyUHJvdmlkZXJ9XG4gKi9cbmV4cG9ydCBjbGFzcyBMYW1iZGFSdW5uZXIgZXh0ZW5kcyBMYW1iZGFSdW5uZXJQcm92aWRlciB7XG59XG4iXX0=