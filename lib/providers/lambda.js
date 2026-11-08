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
exports.LambdaRunner = exports.LambdaRunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const path = __importStar(require("path"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const constructs_1 = require("constructs");
const common_1 = require("./common");
const update_lambda_function_1 = require("./update-lambda-function");
const image_builders_1 = require("../image-builders");
const utils_1 = require("../utils");
/**
 * GitHub Actions runner provider using Lambda to execute jobs.
 *
 * Creates a Docker-based function that gets executed for each job.
 *
 * Execution environments can be reused between jobs. All jobs that can run on the same function should be equally trusted. See
 * https://github.com/CloudSnorkel/cdk-github-runners#job-isolation
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
class LambdaRunnerProvider extends common_1.BaseProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.LambdaRunnerProvider", version: "0.0.0" };
    /** @internal */
    static _FAMILY = 'lambda';
    /**
     * Path to Dockerfile for Linux x64 with all the requirement for Lambda runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
     *
     * Available build arguments that can be set in the image builder:
     * * `BASE_IMAGE` sets the `FROM` line. This should be similar to public.ecr.aws/lambda/nodejs:14.
     * * `EXTRA_PACKAGES` can be used to install additional packages.
     *
     * @deprecated Use `imageBuilder()` instead.
     */
    static LINUX_X64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'lambda', 'linux-x64');
    /**
     * Path to Dockerfile for Linux ARM64 with all the requirement for Lambda runner. Use this Dockerfile unless you need to customize it further than allowed by hooks.
     *
     * Available build arguments that can be set in the image builder:
     * * `BASE_IMAGE` sets the `FROM` line. This should be similar to public.ecr.aws/lambda/nodejs:14.
     * * `EXTRA_PACKAGES` can be used to install additional packages.
     *
     * @deprecated Use `imageBuilder()` instead.
     */
    static LINUX_ARM64_DOCKERFILE_PATH = path.join(__dirname, '..', '..', 'assets', 'docker-images', 'lambda', 'linux-arm64');
    /**
     * The fragment that runs any Lambda provider. Reads the config {@link _runnerConfig} generated for it from
     * `$.providerParams`. Renders what LambdaInvoke used to render per provider.
     *
     * @internal
     */
    static _stateMachineFragment(scope) {
        const p = (common_1.providerParam);
        return new aws_cdk_lib_1.aws_stepfunctions.CustomState(scope, 'Lambda Runner', {
            stateJson: {
                Type: 'Task',
                Resource: `arn:${cdk.Aws.PARTITION}:states:::lambda:invoke`,
                Parameters: {
                    'FunctionName.$': p('functionArn'),
                    'Payload': {
                        'jitConfig.$': common_1.RUNNER_INPUT.jitConfig,
                        'runnerName.$': common_1.RUNNER_INPUT.name,
                        'label.$': common_1.RUNNER_INPUT.labels,
                        'githubDomain.$': common_1.RUNNER_INPUT.domain,
                        'owner.$': common_1.RUNNER_INPUT.owner,
                        'repo.$': common_1.RUNNER_INPUT.repo,
                    },
                },
                // the transient errors LambdaInvoke retries for us by default
                Retry: [{
                        ErrorEquals: [
                            'Lambda.ClientExecutionTimeoutException',
                            'Lambda.ServiceException',
                            'Lambda.AWSLambdaException',
                            'Lambda.SdkClientException',
                        ],
                        IntervalSeconds: 2,
                        MaxAttempts: 6,
                        BackoffRate: 2,
                    }],
            },
        });
    }
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
    /**
     * The function hosting the GitHub runner.
     */
    function;
    /**
     * Labels associated with this provider.
     */
    labels;
    /**
     * Grant principal used to add permissions to the runner role.
     */
    grantPrincipal;
    /**
     * Docker image loaded with GitHub Actions Runner and its prerequisites. The image is built by an image builder and is specific to Lambda.
     *
     * @deprecated This field is internal and should not be accessed directly.
     */
    image;
    /**
     * Log group where provided runners will save their logs.
     *
     * Note that this is not the job log, but the runner itself. It will not contain output from the GitHub Action but only metadata on its execution.
     */
    logGroup;
    group;
    defaultLabels;
    vpc;
    securityGroups;
    constructor(scope, id, props) {
        super(scope, id, props);
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
        this.logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'Log', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
        });
        this.function = new aws_cdk_lib_1.aws_lambda.DockerImageFunction(this, 'Function', {
            description: `GitHub Actions runner for labels ${this.labels}`,
            // we point to `latest` (or the tag the user chose) which is always the right image tag for the latest build
            // but lambda "locks in" the image digest when the function is created
            // we have this.imageUpdater() to update the function with the latest image digest whenever the image is rebuilt
            code: aws_cdk_lib_1.aws_lambda.DockerImageCode.fromEcr(image.imageRepository, { tagOrDigest: image.imageTag }),
            architecture,
            vpc: this.vpc,
            securityGroups: this.securityGroups,
            vpcSubnets: props?.subnetSelection,
            timeout: props?.timeout || cdk.Duration.minutes(15),
            memorySize: props?.memorySize || 2048,
            ephemeralStorageSize: props?.ephemeralStorageSize || cdk.Size.gibibytes(10),
            logGroup: this.logGroup,
        });
        // the image must exist before the function is created, or Lambda won't be able to resolve the tag
        if (image._dependable) {
            this.function.node.addDependency(image._dependable);
            // we used to pass the wait condition ref around as a string, which created a cross-stack export when the image
            // builder and the provider were in separate stacks. we now depend on the wait condition itself, so nothing
            // references the ref anymore. keep exporting it, so upgrades don't fail with "export cannot be deleted as it is
            // in use". TODO deprecated hack - remove in a future version once everyone has upgraded.
            if (constructs_1.Construct.isConstruct(image._dependable) && aws_cdk_lib_1.aws_cloudformation.CfnWaitCondition.isCfnWaitCondition(image._dependable)) {
                if (cdk.Stack.of(image._dependable) !== cdk.Stack.of(this)) { // cross-stack
                    if (!cdk.Stack.of(image._dependable).nestedStackParent) { // not a nested stack
                        cdk.Stack.of(image._dependable).exportValue(image._dependable.ref);
                    }
                }
            }
        }
        this.grantPrincipal = this.function.grantPrincipal;
        this.addImageUpdater(image);
    }
    /**
     * The network connections associated with this resource.
     */
    get connections() {
        return this.function.connections;
    }
    addImageUpdater(image) {
        // Lambda resolves the image tag when the function is created or updated, and then sticks to that image.
        // Lambda doesn't automatically follow the tag on image push.
        // whenever a new image is pushed, we have to explicitly tell the function to use it.
        // corner case issue: if the user updates the function and its code on the same deploy, both CloudFormation and our rule here will try to update
        // the function at the same time. both retry. our updater retries for 15 minutes times 3 Lambda retries. if for whatever reason CloudFormation
        // takes longer than that, the updater will fail and the function will be left with the old image. the image should be automatically updated on
        // the next scheduled image update and the function will be updated with the latest image. this is a rare case and should not happen often, but it
        // is possible.
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
    /**
     * Config for the shared Lambda fragment.
     *
     * @internal
     */
    _runnerConfig() {
        return {
            family: LambdaRunnerProvider._FAMILY,
            provider: this.node.path,
            functionArn: this.function.functionArn,
            runnerGroup: this.group ?? '',
            defaultLabels: (0, common_1.runnerDefaultLabels)(this.image.os, this.image.architecture, this.defaultLabels),
        };
    }
    /**
     * @internal
     */
    _grantStateMachine(stateMachineRole) {
        this.function.grantInvoke(stateMachineRole);
    }
    /**
     * @internal
     */
    _status(statusFunctionRole) {
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
}
exports.LambdaRunnerProvider = LambdaRunnerProvider;
/**
 * @deprecated use {@link LambdaRunnerProvider}
 */
class LambdaRunner extends LambdaRunnerProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.LambdaRunner", version: "0.0.0" };
}
exports.LambdaRunner = LambdaRunner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9sYW1iZGEudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLDJDQUE2QjtBQUM3QixpREFBbUM7QUFDbkMsNkNBU3FCO0FBQ3JCLG1EQUFxRDtBQUNyRCwyQ0FBdUM7QUFDdkMscUNBR2tCO0FBQ2xCLHFFQUFnRTtBQUNoRSxzREFBMkg7QUFDM0gsb0NBQWdGO0FBaUhoRjs7Ozs7Ozs7O0dBU0c7QUFDSCxNQUFhLG9CQUFxQixTQUFRLHFCQUFZOztJQUNwRCxnQkFBZ0I7SUFDVCxNQUFNLENBQVUsT0FBTyxHQUFHLFFBQVEsQ0FBQztJQUUxQzs7Ozs7Ozs7T0FRRztJQUNJLE1BQU0sQ0FBVSx5QkFBeUIsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUUsUUFBUSxFQUFFLFdBQVcsQ0FBQyxDQUFDO0lBRXRJOzs7Ozs7OztPQVFHO0lBQ0ksTUFBTSxDQUFVLDJCQUEyQixHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLGVBQWUsRUFBRSxRQUFRLEVBQUUsYUFBYSxDQUFDLENBQUM7SUFFMUk7Ozs7O09BS0c7SUFDSSxNQUFNLENBQUMscUJBQXFCLENBQUMsS0FBZ0I7UUFDbEQsTUFBTSxDQUFDLEdBQUcsQ0FBQSxzQkFBaUMsQ0FBQSxDQUFDO1FBQzVDLE9BQU8sSUFBSSwrQkFBYSxDQUFDLFdBQVcsQ0FBQyxLQUFLLEVBQUUsZUFBZSxFQUFFO1lBQzNELFNBQVMsRUFBRTtnQkFDVCxJQUFJLEVBQUUsTUFBTTtnQkFDWixRQUFRLEVBQUUsT0FBTyxHQUFHLENBQUMsR0FBRyxDQUFDLFNBQVMseUJBQXlCO2dCQUMzRCxVQUFVLEVBQUU7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LEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxlQUFlLENBQUMsYUFBYTtnQkFDekQsUUFBUSxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUTtnQkFDN0Isb0JBQW9CLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxRQUFRLEVBQUUsWUFBWTthQUN4RDtTQUNGLENBQUM7SUFDSixDQUFDOztBQXpUSCxvREEwVEM7QUFFRDs7R0FFRztBQUNILE1BQWEsWUFBYSxTQUFRLG9CQUFvQjs7O0FBQXRELG9DQUNDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBhd3NfY2xvdWRmb3JtYXRpb24gYXMgY2xvdWRmb3JtYXRpb24sXG4gIGF3c19lYzIgYXMgZWMyLFxuICBhd3NfZXZlbnRzIGFzIGV2ZW50cyxcbiAgYXdzX2V2ZW50c190YXJnZXRzIGFzIGV2ZW50c190YXJnZXRzLFxuICBhd3NfaWFtIGFzIGlhbSxcbiAgYXdzX2xhbWJkYSBhcyBsYW1iZGEsXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMsXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gIEFyY2hpdGVjdHVyZSwgQmFzZVByb3ZpZGVyLCBJUnVubmVyUHJvdmlkZXIsIElSdW5uZXJQcm92aWRlclN0YXR1cywgT3MsIHByb3ZpZGVyUGFyYW0sIFJVTk5FUl9JTlBVVCxcbiAgUnVubmVyQ29uZmlnLCBSdW5uZXJJbWFnZSwgUnVubmVyUHJvdmlkZXJQcm9wcywgUnVubmVyVmVyc2lvbiwgcnVubmVyRGVmYXVsdExhYmVscyxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgVXBkYXRlTGFtYmRhRnVuY3Rpb24gfSBmcm9tICcuL3VwZGF0ZS1sYW1iZGEtZnVuY3Rpb24nO1xuaW1wb3J0IHsgSVJ1bm5lckltYWdlQnVpbGRlciwgUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcywgUnVubmVySW1hZ2VDb21wb25lbnQgfSBmcm9tICcuLi9pbWFnZS1idWlsZGVycyc7XG5pbXBvcnQgeyBzaW5nbGV0b25MYW1iZGEsIHNpbmdsZXRvbkxvZ0dyb3VwLCBTaW5nbGV0b25Mb2dUeXBlIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIExhbWJkYVJ1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgRG9ja2VyIGltYWdlcyBjb250YWluaW5nIEdpdEh1YiBSdW5uZXIgYW5kIGFsbCByZXF1aXJlbWVudHMuXG4gICAqXG4gICAqIFRoZSBpbWFnZSBidWlsZGVyIG11c3QgY29udGFpbiB0aGUge0BsaW5rIFJ1bm5lckltYWdlQ29tcG9uZW50LmxhbWJkYUVudHJ5cG9pbnR9IGNvbXBvbmVudC5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgZGV0ZXJtaW5lcyB0aGUgT1MgYW5kIGFyY2hpdGVjdHVyZSBvZiB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBMYW1iZGFSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIoKVxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2VCdWlsZGVyPzogSVJ1bm5lckltYWdlQnVpbGRlcjtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgbGFiZWwgdXNlZCBmb3IgdGhpcyBwcm92aWRlci5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgbGFiZWxzfSBpbnN0ZWFkXG4gICAqL1xuICByZWFkb25seSBsYWJlbD86IHN0cmluZztcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgbGFiZWxzIHVzZWQgZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqXG4gICAqIFRoZXNlIGxhYmVscyBhcmUgdXNlZCB0byBpZGVudGlmeSB3aGljaCBwcm92aWRlciBzaG91bGQgc3Bhd24gYSBuZXcgb24tZGVtYW5kIHJ1bm5lci4gRXZlcnkgam9iIHNlbmRzIGEgd2ViaG9vayB3aXRoIHRoZSBsYWJlbHMgaXQncyBsb29raW5nIGZvclxuICAgKiBiYXNlZCBvbiBydW5zLW9uLiBXZSBtYXRjaCB0aGUgbGFiZWxzIGZyb20gdGhlIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlLiBJZiBhbGwgdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZSBhcmUgcHJlc2VudCBpbiB0aGVcbiAgICogam9iJ3MgbGFiZWxzLCB0aGlzIHByb3ZpZGVyIHdpbGwgYmUgY2hvc2VuIGFuZCBzcGF3biBhIG5ldyBydW5uZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IFsnbGFtYmRhJ11cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVscz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBydW5uZXIgZ3JvdXAgbmFtZS5cbiAgICpcbiAgICogSWYgc3BlY2lmaWVkLCB0aGUgcnVubmVyIHdpbGwgYmUgcmVnaXN0ZXJlZCB3aXRoIHRoaXMgZ3JvdXAgbmFtZS4gU2V0dGluZyBhIHJ1bm5lciBncm91cCBjYW4gaGVscCBtYW5hZ2luZyBhY2Nlc3MgdG8gc2VsZi1ob3N0ZWQgcnVubmVycy4gSXRcbiAgICogcmVxdWlyZXMgYSBwYWlkIEdpdEh1YiBhY2NvdW50IGFuZCBvcmdhbml6YXRpb24gbGV2ZWwgcnVubmVyIHJlZ2lzdHJhdGlvbi5cbiAgICpcbiAgICogVGhlIGdyb3VwIG11c3QgZXhpc3Qgb3IgdGhlIHJ1bm5lciB3aWxsIG5vdCBzdGFydC5cbiAgICpcbiAgICogVXNlcnMgd2lsbCBzdGlsbCBiZSBhYmxlIHRvIHRyaWdnZXIgdGhpcyBydW5uZXIgd2l0aCB0aGUgY29ycmVjdCBsYWJlbHMuIEJ1dCB0aGUgcnVubmVyIHdpbGwgb25seSBiZSBhYmxlIHRvIHJ1biBqb2JzIGZyb20gcmVwb3MgYWxsb3dlZCB0byB1c2UgdGhlIGdyb3VwLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgYW1vdW50IG9mIG1lbW9yeSwgaW4gTUIsIHRoYXQgaXMgYWxsb2NhdGVkIHRvIHlvdXIgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKiBMYW1iZGEgdXNlcyB0aGlzIHZhbHVlIHRvIHByb3BvcnRpb25hbGx5IGFsbG9jYXRlIHRoZSBhbW91bnQgb2YgQ1BVXG4gICAqIHBvd2VyLiBGb3IgbW9yZSBpbmZvcm1hdGlvbiwgc2VlIFJlc291cmNlIE1vZGVsIGluIHRoZSBBV1MgTGFtYmRhXG4gICAqIERldmVsb3BlciBHdWlkZS5cbiAgICpcbiAgICogQGRlZmF1bHQgMjA0OFxuICAgKi9cbiAgcmVhZG9ubHkgbWVtb3J5U2l6ZT86IG51bWJlcjtcblxuICAvKipcbiAgICogVGhlIHNpemUgb2YgdGhlIGZ1bmN0aW9u4oCZcyAvdG1wIGRpcmVjdG9yeSBpbiBNaUIuXG4gICAqXG4gICAqIEBkZWZhdWx0IDEwIEdpQlxuICAgKi9cbiAgcmVhZG9ubHkgZXBoZW1lcmFsU3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcblxuICAvKipcbiAgICogVGhlIGZ1bmN0aW9uIGV4ZWN1dGlvbiB0aW1lIChpbiBzZWNvbmRzKSBhZnRlciB3aGljaCBMYW1iZGEgdGVybWluYXRlc1xuICAgKiB0aGUgZnVuY3Rpb24uIEJlY2F1c2UgdGhlIGV4ZWN1dGlvbiB0aW1lIGFmZmVjdHMgY29zdCwgc2V0IHRoaXMgdmFsdWVcbiAgICogYmFzZWQgb24gdGhlIGZ1bmN0aW9uJ3MgZXhwZWN0ZWQgZXhlY3V0aW9uIHRpbWUuXG4gICAqXG4gICAqIEBkZWZhdWx0IER1cmF0aW9uLm1pbnV0ZXMoMTUpXG4gICAqL1xuICByZWFkb25seSB0aW1lb3V0PzogY2RrLkR1cmF0aW9uO1xuXG4gIC8qKlxuICAgKiBWUEMgdG8gbGF1bmNoIHRoZSBydW5uZXJzIGluLlxuICAgKlxuICAgKiBAZGVmYXVsdCBubyBWUENcbiAgICovXG4gIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cCB0byBhc3NpZ24gdG8gdGhpcyBpbnN0YW5jZS5cbiAgICpcbiAgICogQGRlZmF1bHQgcHVibGljIGxhbWJkYSB3aXRoIG5vIHNlY3VyaXR5IGdyb3VwXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgc2VjdXJpdHlHcm91cHN9XG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwPzogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgdG8gYXNzaWduIHRvIHRoaXMgaW5zdGFuY2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IHB1YmxpYyBsYW1iZGEgd2l0aCBubyBzZWN1cml0eSBncm91cFxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogV2hlcmUgdG8gcGxhY2UgdGhlIG5ldHdvcmsgaW50ZXJmYWNlcyB3aXRoaW4gdGhlIFZQQy5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gc3VibmV0XG4gICAqL1xuICByZWFkb25seSBzdWJuZXRTZWxlY3Rpb24/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xufVxuXG4vKipcbiAqIFJ1bm5lciBjb25maWcgZm9yIHRoZSBMYW1iZGEgZmFtaWx5IGZyYWdtZW50LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIExhbWJkYVJ1bm5lckNvbmZpZyBleHRlbmRzIFJ1bm5lckNvbmZpZyB7XG4gIHJlYWRvbmx5IGZ1bmN0aW9uQXJuOiBzdHJpbmc7XG59XG5cbi8qKlxuICogR2l0SHViIEFjdGlvbnMgcnVubmVyIHByb3ZpZGVyIHVzaW5nIExhbWJkYSB0byBleGVjdXRlIGpvYnMuXG4gKlxuICogQ3JlYXRlcyBhIERvY2tlci1iYXNlZCBmdW5jdGlvbiB0aGF0IGdldHMgZXhlY3V0ZWQgZm9yIGVhY2ggam9iLlxuICpcbiAqIEV4ZWN1dGlvbiBlbnZpcm9ubWVudHMgY2FuIGJlIHJldXNlZCBiZXR3ZWVuIGpvYnMuIEFsbCBqb2JzIHRoYXQgY2FuIHJ1biBvbiB0aGUgc2FtZSBmdW5jdGlvbiBzaG91bGQgYmUgZXF1YWxseSB0cnVzdGVkLiBTZWVcbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzI2pvYi1pc29sYXRpb25cbiAqXG4gKiBUaGlzIGNvbnN0cnVjdCBpcyBub3QgbWVhbnQgdG8gYmUgdXNlZCBieSBpdHNlbGYuIEl0IHNob3VsZCBiZSBwYXNzZWQgaW4gdGhlIHByb3ZpZGVycyBwcm9wZXJ0eSBmb3IgR2l0SHViUnVubmVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIExhbWJkYVJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqIEBpbnRlcm5hbCAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IF9GQU1JTFkgPSAnbGFtYmRhJztcblxuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCB4NjQgd2l0aCBhbGwgdGhlIHJlcXVpcmVtZW50IGZvciBMYW1iZGEgcnVubmVyLiBVc2UgdGhpcyBEb2NrZXJmaWxlIHVubGVzcyB5b3UgbmVlZCB0byBjdXN0b21pemUgaXQgZnVydGhlciB0aGFuIGFsbG93ZWQgYnkgaG9va3MuXG4gICAqXG4gICAqIEF2YWlsYWJsZSBidWlsZCBhcmd1bWVudHMgdGhhdCBjYW4gYmUgc2V0IGluIHRoZSBpbWFnZSBidWlsZGVyOlxuICAgKiAqIGBCQVNFX0lNQUdFYCBzZXRzIHRoZSBgRlJPTWAgbGluZS4gVGhpcyBzaG91bGQgYmUgc2ltaWxhciB0byBwdWJsaWMuZWNyLmF3cy9sYW1iZGEvbm9kZWpzOjE0LlxuICAgKiAqIGBFWFRSQV9QQUNLQUdFU2AgY2FuIGJlIHVzZWQgdG8gaW5zdGFsbCBhZGRpdGlvbmFsIHBhY2thZ2VzLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCBVc2UgYGltYWdlQnVpbGRlcigpYCBpbnN0ZWFkLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyByZWFkb25seSBMSU5VWF9YNjRfRE9DS0VSRklMRV9QQVRIID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Fzc2V0cycsICdkb2NrZXItaW1hZ2VzJywgJ2xhbWJkYScsICdsaW51eC14NjQnKTtcblxuICAvKipcbiAgICogUGF0aCB0byBEb2NrZXJmaWxlIGZvciBMaW51eCBBUk02NCB3aXRoIGFsbCB0aGUgcmVxdWlyZW1lbnQgZm9yIExhbWJkYSBydW5uZXIuIFVzZSB0aGlzIERvY2tlcmZpbGUgdW5sZXNzIHlvdSBuZWVkIHRvIGN1c3RvbWl6ZSBpdCBmdXJ0aGVyIHRoYW4gYWxsb3dlZCBieSBob29rcy5cbiAgICpcbiAgICogQXZhaWxhYmxlIGJ1aWxkIGFyZ3VtZW50cyB0aGF0IGNhbiBiZSBzZXQgaW4gdGhlIGltYWdlIGJ1aWxkZXI6XG4gICAqICogYEJBU0VfSU1BR0VgIHNldHMgdGhlIGBGUk9NYCBsaW5lLiBUaGlzIHNob3VsZCBiZSBzaW1pbGFyIHRvIHB1YmxpYy5lY3IuYXdzL2xhbWJkYS9ub2RlanM6MTQuXG4gICAqICogYEVYVFJBX1BBQ0tBR0VTYCBjYW4gYmUgdXNlZCB0byBpbnN0YWxsIGFkZGl0aW9uYWwgcGFja2FnZXMuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFVzZSBgaW1hZ2VCdWlsZGVyKClgIGluc3RlYWQuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IExJTlVYX0FSTTY0X0RPQ0tFUkZJTEVfUEFUSCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAnZG9ja2VyLWltYWdlcycsICdsYW1iZGEnLCAnbGludXgtYXJtNjQnKTtcblxuICAvKipcbiAgICogVGhlIGZyYWdtZW50IHRoYXQgcnVucyBhbnkgTGFtYmRhIHByb3ZpZGVyLiBSZWFkcyB0aGUgY29uZmlnIHtAbGluayBfcnVubmVyQ29uZmlnfSBnZW5lcmF0ZWQgZm9yIGl0IGZyb21cbiAgICogYCQucHJvdmlkZXJQYXJhbXNgLiBSZW5kZXJzIHdoYXQgTGFtYmRhSW52b2tlIHVzZWQgdG8gcmVuZGVyIHBlciBwcm92aWRlci5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIF9zdGF0ZU1hY2hpbmVGcmFnbWVudChzY29wZTogQ29uc3RydWN0KTogc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlIHtcbiAgICBjb25zdCBwID0gcHJvdmlkZXJQYXJhbTxMYW1iZGFSdW5uZXJDb25maWc+O1xuICAgIHJldHVybiBuZXcgc3RlcGZ1bmN0aW9ucy5DdXN0b21TdGF0ZShzY29wZSwgJ0xhbWJkYSBSdW5uZXInLCB7XG4gICAgICBzdGF0ZUpzb246IHtcbiAgICAgICAgVHlwZTogJ1Rhc2snLFxuICAgICAgICBSZXNvdXJjZTogYGFybjoke2Nkay5Bd3MuUEFSVElUSU9OfTpzdGF0ZXM6OjpsYW1iZGE6aW52b2tlYCxcbiAgICAgICAgUGFyYW1ldGVyczoge1xuICAgICAgICAgICdGdW5jdGlvbk5hbWUuJCc6IHAoJ2Z1bmN0aW9uQXJuJyksXG4gICAgICAgICAgJ1BheWxvYWQnOiB7XG4gICAgICAgICAgICAnaml0Q29uZmlnLiQnOiBSVU5ORVJfSU5QVVQuaml0Q29uZmlnLFxuICAgICAgICAgICAgJ3J1bm5lck5hbWUuJCc6IFJVTk5FUl9JTlBVVC5uYW1lLFxuICAgICAgICAgICAgJ2xhYmVsLiQnOiBSVU5ORVJfSU5QVVQubGFiZWxzLFxuICAgICAgICAgICAgJ2dpdGh1YkRvbWFpbi4kJzogUlVOTkVSX0lOUFVULmRvbWFpbixcbiAgICAgICAgICAgICdvd25lci4kJzogUlVOTkVSX0lOUFVULm93bmVyLFxuICAgICAgICAgICAgJ3JlcG8uJCc6IFJVTk5FUl9JTlBVVC5yZXBvLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIC8vIHRoZSB0cmFuc2llbnQgZXJyb3JzIExhbWJkYUludm9rZSByZXRyaWVzIGZvciB1cyBieSBkZWZhdWx0XG4gICAgICAgIFJldHJ5OiBbe1xuICAgICAgICAgIEVycm9yRXF1YWxzOiBbXG4gICAgICAgICAgICAnTGFtYmRhLkNsaWVudEV4ZWN1dGlvblRpbWVvdXRFeGNlcHRpb24nLFxuICAgICAgICAgICAgJ0xhbWJkYS5TZXJ2aWNlRXhjZXB0aW9uJyxcbiAgICAgICAgICAgICdMYW1iZGEuQVdTTGFtYmRhRXhjZXB0aW9uJyxcbiAgICAgICAgICAgICdMYW1iZGEuU2RrQ2xpZW50RXhjZXB0aW9uJyxcbiAgICAgICAgICBdLFxuICAgICAgICAgIEludGVydmFsU2Vjb25kczogMixcbiAgICAgICAgICBNYXhBdHRlbXB0czogNixcbiAgICAgICAgICBCYWNrb2ZmUmF0ZTogMixcbiAgICAgICAgfV0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBuZXcgaW1hZ2UgYnVpbGRlciB0aGF0IGJ1aWxkcyBMYW1iZGEgc3BlY2lmaWMgcnVubmVyIGltYWdlcy5cbiAgICpcbiAgICogWW91IGNhbiBjdXN0b21pemUgdGhlIE9TLCBhcmNoaXRlY3R1cmUsIFZQQywgc3VibmV0LCBzZWN1cml0eSBncm91cHMsIGV0Yy4gYnkgcGFzc2luZyBpbiBwcm9wcy5cbiAgICpcbiAgICogWW91IGNhbiBhZGQgY29tcG9uZW50cyB0byB0aGUgaW1hZ2UgYnVpbGRlciBieSBjYWxsaW5nIGBpbWFnZUJ1aWxkZXIuYWRkQ29tcG9uZW50KClgLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBPUyBpcyBBbWF6b24gTGludXggMjAyMyBydW5uaW5nIG9uIHg2NCBhcmNoaXRlY3R1cmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNvbXBvbmVudHM6XG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmxhbWJkYUVudHJ5cG9pbnQoKWBcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgaW1hZ2VCdWlsZGVyKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMpIHtcbiAgICByZXR1cm4gUnVubmVySW1hZ2VCdWlsZGVyLm5ldyhzY29wZSwgaWQsIHtcbiAgICAgIG9zOiBPcy5MSU5VWF9BTUFaT05fMjAyMyxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGNvbXBvbmVudHM6IFtcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcihwcm9wcz8ucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQubGFtYmRhRW50cnlwb2ludCgpLFxuICAgICAgXSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBmdW5jdGlvbiBob3N0aW5nIHRoZSBHaXRIdWIgcnVubmVyLlxuICAgKi9cbiAgcmVhZG9ubHkgZnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbjtcblxuICAvKipcbiAgICogTGFiZWxzIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHByb3ZpZGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR3JhbnQgcHJpbmNpcGFsIHVzZWQgdG8gYWRkIHBlcm1pc3Npb25zIHRvIHRoZSBydW5uZXIgcm9sZS5cbiAgICovXG4gIHJlYWRvbmx5IGdyYW50UHJpbmNpcGFsOiBpYW0uSVByaW5jaXBhbDtcblxuICAvKipcbiAgICogRG9ja2VyIGltYWdlIGxvYWRlZCB3aXRoIEdpdEh1YiBBY3Rpb25zIFJ1bm5lciBhbmQgaXRzIHByZXJlcXVpc2l0ZXMuIFRoZSBpbWFnZSBpcyBidWlsdCBieSBhbiBpbWFnZSBidWlsZGVyIGFuZCBpcyBzcGVjaWZpYyB0byBMYW1iZGEuXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIFRoaXMgZmllbGQgaXMgaW50ZXJuYWwgYW5kIHNob3VsZCBub3QgYmUgYWNjZXNzZWQgZGlyZWN0bHkuXG4gICAqL1xuICByZWFkb25seSBpbWFnZTogUnVubmVySW1hZ2U7XG5cbiAgLyoqXG4gICAqIExvZyBncm91cCB3aGVyZSBwcm92aWRlZCBydW5uZXJzIHdpbGwgc2F2ZSB0aGVpciBsb2dzLlxuICAgKlxuICAgKiBOb3RlIHRoYXQgdGhpcyBpcyBub3QgdGhlIGpvYiBsb2csIGJ1dCB0aGUgcnVubmVyIGl0c2VsZi4gSXQgd2lsbCBub3QgY29udGFpbiBvdXRwdXQgZnJvbSB0aGUgR2l0SHViIEFjdGlvbiBidXQgb25seSBtZXRhZGF0YSBvbiBpdHMgZXhlY3V0aW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgbG9nR3JvdXA6IGxvZ3MuSUxvZ0dyb3VwO1xuXG5cbiAgcHJpdmF0ZSByZWFkb25seSBncm91cD86IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBkZWZhdWx0TGFiZWxzOiBib29sZWFuO1xuICBwcml2YXRlIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBMYW1iZGFSdW5uZXJQcm92aWRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICB0aGlzLmxhYmVscyA9IHRoaXMubGFiZWxzRnJvbVByb3BlcnRpZXMoJ2xhbWJkYScsIHByb3BzPy5sYWJlbCwgcHJvcHM/LmxhYmVscyk7XG4gICAgdGhpcy5ncm91cCA9IHByb3BzPy5ncm91cDtcbiAgICB0aGlzLmRlZmF1bHRMYWJlbHMgPSBwcm9wcz8uZGVmYXVsdExhYmVscyA/PyB0cnVlO1xuICAgIHRoaXMudnBjID0gcHJvcHM/LnZwYztcbiAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gcHJvcHM/LnNlY3VyaXR5R3JvdXAgPyBbcHJvcHMuc2VjdXJpdHlHcm91cF0gOiBwcm9wcz8uc2VjdXJpdHlHcm91cHM7XG5cbiAgICBjb25zdCBpbWFnZUJ1aWxkZXIgPSBwcm9wcz8uaW1hZ2VCdWlsZGVyID8/IExhbWJkYVJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcih0aGlzLCAnSW1hZ2UgQnVpbGRlcicpO1xuICAgIGNvbnN0IGltYWdlID0gdGhpcy5pbWFnZSA9IGltYWdlQnVpbGRlci5iaW5kRG9ja2VySW1hZ2UoKTtcblxuICAgIGxldCBhcmNoaXRlY3R1cmU6IGxhbWJkYS5BcmNoaXRlY3R1cmUgfCB1bmRlZmluZWQ7XG4gICAgaWYgKGltYWdlLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgIGlmIChpbWFnZS5hcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgICAgYXJjaGl0ZWN0dXJlID0gbGFtYmRhLkFyY2hpdGVjdHVyZS5YODZfNjQ7XG4gICAgICB9XG4gICAgICBpZiAoaW1hZ2UuYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgICAgYXJjaGl0ZWN0dXJlID0gbGFtYmRhLkFyY2hpdGVjdHVyZS5BUk1fNjQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCFhcmNoaXRlY3R1cmUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5hYmxlIHRvIGZpbmQgc3VwcG9ydGVkIExhbWJkYSBhcmNoaXRlY3R1cmUgZm9yICR7aW1hZ2Uub3MubmFtZX0vJHtpbWFnZS5hcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICB9XG5cbiAgICBpZiAoIWltYWdlLl9kZXBlbmRhYmxlKSB7XG4gICAgICAvLyBBV1MgSW1hZ2UgQnVpbGRlciBjYW4ndCBnZXQgdXMgZGVwZW5kYWJsZSBpbWFnZXMgYW5kIHRoZXJlIGlzIG5vIHBvaW50IGluIHVzaW5nIGl0IGFueXdheS4gQ29kZUJ1aWxkIGlzIHNvIG11Y2ggZmFzdGVyLlxuICAgICAgLy8gVGhpcyBtYXkgY2hhbmdlIGlmIExhbWJkYSBzdGFydHMgc3VwcG9ydGluZyBXaW5kb3dzIGltYWdlcy4gVGhlbiB3ZSB3b3VsZCBuZWVkIEFXUyBJbWFnZSBCdWlsZGVyLlxuICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdMYW1iZGEgcHJvdmlkZXIgY2FuIG9ubHkgd29yayB3aXRoIGltYWdlcyBidWlsdCBieSBDb2RlQnVpbGQgYW5kIG5vdCBBV1MgSW1hZ2UgQnVpbGRlci4gYHdhaXRPbkRlcGxveTogZmFsc2VgIGlzIGFsc28gbm90IHN1cHBvcnRlZC4nKTtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0xvZycsIHtcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICByZXRlbnRpb246IHByb3BzPy5sb2dSZXRlbnRpb24gPz8gUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgfSk7XG5cbiAgICB0aGlzLmZ1bmN0aW9uID0gbmV3IGxhbWJkYS5Eb2NrZXJJbWFnZUZ1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgICdGdW5jdGlvbicsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiBgR2l0SHViIEFjdGlvbnMgcnVubmVyIGZvciBsYWJlbHMgJHt0aGlzLmxhYmVsc31gLFxuICAgICAgICAvLyB3ZSBwb2ludCB0byBgbGF0ZXN0YCAob3IgdGhlIHRhZyB0aGUgdXNlciBjaG9zZSkgd2hpY2ggaXMgYWx3YXlzIHRoZSByaWdodCBpbWFnZSB0YWcgZm9yIHRoZSBsYXRlc3QgYnVpbGRcbiAgICAgICAgLy8gYnV0IGxhbWJkYSBcImxvY2tzIGluXCIgdGhlIGltYWdlIGRpZ2VzdCB3aGVuIHRoZSBmdW5jdGlvbiBpcyBjcmVhdGVkXG4gICAgICAgIC8vIHdlIGhhdmUgdGhpcy5pbWFnZVVwZGF0ZXIoKSB0byB1cGRhdGUgdGhlIGZ1bmN0aW9uIHdpdGggdGhlIGxhdGVzdCBpbWFnZSBkaWdlc3Qgd2hlbmV2ZXIgdGhlIGltYWdlIGlzIHJlYnVpbHRcbiAgICAgICAgY29kZTogbGFtYmRhLkRvY2tlckltYWdlQ29kZS5mcm9tRWNyKGltYWdlLmltYWdlUmVwb3NpdG9yeSwgeyB0YWdPckRpZ2VzdDogaW1hZ2UuaW1hZ2VUYWcgfSksXG4gICAgICAgIGFyY2hpdGVjdHVyZSxcbiAgICAgICAgdnBjOiB0aGlzLnZwYyxcbiAgICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgICAgIHZwY1N1Ym5ldHM6IHByb3BzPy5zdWJuZXRTZWxlY3Rpb24sXG4gICAgICAgIHRpbWVvdXQ6IHByb3BzPy50aW1lb3V0IHx8IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgbWVtb3J5U2l6ZTogcHJvcHM/Lm1lbW9yeVNpemUgfHwgMjA0OCxcbiAgICAgICAgZXBoZW1lcmFsU3RvcmFnZVNpemU6IHByb3BzPy5lcGhlbWVyYWxTdG9yYWdlU2l6ZSB8fCBjZGsuU2l6ZS5naWJpYnl0ZXMoMTApLFxuICAgICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cCxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIHRoZSBpbWFnZSBtdXN0IGV4aXN0IGJlZm9yZSB0aGUgZnVuY3Rpb24gaXMgY3JlYXRlZCwgb3IgTGFtYmRhIHdvbid0IGJlIGFibGUgdG8gcmVzb2x2ZSB0aGUgdGFnXG4gICAgaWYgKGltYWdlLl9kZXBlbmRhYmxlKSB7XG4gICAgICB0aGlzLmZ1bmN0aW9uLm5vZGUuYWRkRGVwZW5kZW5jeShpbWFnZS5fZGVwZW5kYWJsZSk7XG5cbiAgICAgIC8vIHdlIHVzZWQgdG8gcGFzcyB0aGUgd2FpdCBjb25kaXRpb24gcmVmIGFyb3VuZCBhcyBhIHN0cmluZywgd2hpY2ggY3JlYXRlZCBhIGNyb3NzLXN0YWNrIGV4cG9ydCB3aGVuIHRoZSBpbWFnZVxuICAgICAgLy8gYnVpbGRlciBhbmQgdGhlIHByb3ZpZGVyIHdlcmUgaW4gc2VwYXJhdGUgc3RhY2tzLiB3ZSBub3cgZGVwZW5kIG9uIHRoZSB3YWl0IGNvbmRpdGlvbiBpdHNlbGYsIHNvIG5vdGhpbmdcbiAgICAgIC8vIHJlZmVyZW5jZXMgdGhlIHJlZiBhbnltb3JlLiBrZWVwIGV4cG9ydGluZyBpdCwgc28gdXBncmFkZXMgZG9uJ3QgZmFpbCB3aXRoIFwiZXhwb3J0IGNhbm5vdCBiZSBkZWxldGVkIGFzIGl0IGlzXG4gICAgICAvLyBpbiB1c2VcIi4gVE9ETyBkZXByZWNhdGVkIGhhY2sgLSByZW1vdmUgaW4gYSBmdXR1cmUgdmVyc2lvbiBvbmNlIGV2ZXJ5b25lIGhhcyB1cGdyYWRlZC5cbiAgICAgIGlmIChDb25zdHJ1Y3QuaXNDb25zdHJ1Y3QoaW1hZ2UuX2RlcGVuZGFibGUpICYmIGNsb3VkZm9ybWF0aW9uLkNmbldhaXRDb25kaXRpb24uaXNDZm5XYWl0Q29uZGl0aW9uKGltYWdlLl9kZXBlbmRhYmxlKSkge1xuICAgICAgICBpZiAoY2RrLlN0YWNrLm9mKGltYWdlLl9kZXBlbmRhYmxlKSAhPT0gY2RrLlN0YWNrLm9mKHRoaXMpKSB7IC8vIGNyb3NzLXN0YWNrXG4gICAgICAgICAgaWYgKCFjZGsuU3RhY2sub2YoaW1hZ2UuX2RlcGVuZGFibGUpLm5lc3RlZFN0YWNrUGFyZW50KSB7IC8vIG5vdCBhIG5lc3RlZCBzdGFja1xuICAgICAgICAgICAgY2RrLlN0YWNrLm9mKGltYWdlLl9kZXBlbmRhYmxlKS5leHBvcnRWYWx1ZShpbWFnZS5fZGVwZW5kYWJsZS5yZWYpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwgPSB0aGlzLmZ1bmN0aW9uLmdyYW50UHJpbmNpcGFsO1xuXG4gICAgdGhpcy5hZGRJbWFnZVVwZGF0ZXIoaW1hZ2UpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcHVibGljIGdldCBjb25uZWN0aW9ucygpOiBlYzIuQ29ubmVjdGlvbnMge1xuICAgIHJldHVybiB0aGlzLmZ1bmN0aW9uLmNvbm5lY3Rpb25zO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRJbWFnZVVwZGF0ZXIoaW1hZ2U6IFJ1bm5lckltYWdlKSB7XG4gICAgLy8gTGFtYmRhIHJlc29sdmVzIHRoZSBpbWFnZSB0YWcgd2hlbiB0aGUgZnVuY3Rpb24gaXMgY3JlYXRlZCBvciB1cGRhdGVkLCBhbmQgdGhlbiBzdGlja3MgdG8gdGhhdCBpbWFnZS5cbiAgICAvLyBMYW1iZGEgZG9lc24ndCBhdXRvbWF0aWNhbGx5IGZvbGxvdyB0aGUgdGFnIG9uIGltYWdlIHB1c2guXG4gICAgLy8gd2hlbmV2ZXIgYSBuZXcgaW1hZ2UgaXMgcHVzaGVkLCB3ZSBoYXZlIHRvIGV4cGxpY2l0bHkgdGVsbCB0aGUgZnVuY3Rpb24gdG8gdXNlIGl0LlxuXG4gICAgLy8gY29ybmVyIGNhc2UgaXNzdWU6IGlmIHRoZSB1c2VyIHVwZGF0ZXMgdGhlIGZ1bmN0aW9uIGFuZCBpdHMgY29kZSBvbiB0aGUgc2FtZSBkZXBsb3ksIGJvdGggQ2xvdWRGb3JtYXRpb24gYW5kIG91ciBydWxlIGhlcmUgd2lsbCB0cnkgdG8gdXBkYXRlXG4gICAgLy8gdGhlIGZ1bmN0aW9uIGF0IHRoZSBzYW1lIHRpbWUuIGJvdGggcmV0cnkuIG91ciB1cGRhdGVyIHJldHJpZXMgZm9yIDE1IG1pbnV0ZXMgdGltZXMgMyBMYW1iZGEgcmV0cmllcy4gaWYgZm9yIHdoYXRldmVyIHJlYXNvbiBDbG91ZEZvcm1hdGlvblxuICAgIC8vIHRha2VzIGxvbmdlciB0aGFuIHRoYXQsIHRoZSB1cGRhdGVyIHdpbGwgZmFpbCBhbmQgdGhlIGZ1bmN0aW9uIHdpbGwgYmUgbGVmdCB3aXRoIHRoZSBvbGQgaW1hZ2UuIHRoZSBpbWFnZSBzaG91bGQgYmUgYXV0b21hdGljYWxseSB1cGRhdGVkIG9uXG4gICAgLy8gdGhlIG5leHQgc2NoZWR1bGVkIGltYWdlIHVwZGF0ZSBhbmQgdGhlIGZ1bmN0aW9uIHdpbGwgYmUgdXBkYXRlZCB3aXRoIHRoZSBsYXRlc3QgaW1hZ2UuIHRoaXMgaXMgYSByYXJlIGNhc2UgYW5kIHNob3VsZCBub3QgaGFwcGVuIG9mdGVuLCBidXQgaXRcbiAgICAvLyBpcyBwb3NzaWJsZS5cblxuICAgIGNvbnN0IHVwZGF0ZXIgPSBzaW5nbGV0b25MYW1iZGEoVXBkYXRlTGFtYmRhRnVuY3Rpb24sIHRoaXMsICd1cGRhdGUtbGFtYmRhJywge1xuICAgICAgZGVzY3JpcHRpb246ICdGdW5jdGlvbiB0aGF0IHVwZGF0ZXMgYSBHaXRIdWIgQWN0aW9ucyBydW5uZXIgZnVuY3Rpb24gd2l0aCB0aGUgbGF0ZXN0IGltYWdlIGRpZ2VzdCBhZnRlciB0aGUgaW1hZ2UgaGFzIGJlZW4gcmVidWlsdCcsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5SVU5ORVJfSU1BR0VfQlVJTEQpLFxuICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICB9KTtcblxuICAgIHVwZGF0ZXIuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnbGFtYmRhOlVwZGF0ZUZ1bmN0aW9uQ29kZSddLFxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5mdW5jdGlvbi5mdW5jdGlvbkFybl0sXG4gICAgfSkpO1xuXG4gICAgbGV0IGxhbWJkYVRhcmdldCA9IG5ldyBldmVudHNfdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih1cGRhdGVyLCB7XG4gICAgICBldmVudDogZXZlbnRzLlJ1bGVUYXJnZXRJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgbGFtYmRhTmFtZTogdGhpcy5mdW5jdGlvbi5mdW5jdGlvbk5hbWUsXG4gICAgICAgIHJlcG9zaXRvcnlVcmk6IGltYWdlLmltYWdlUmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpLFxuICAgICAgICByZXBvc2l0b3J5VGFnOiBpbWFnZS5pbWFnZVRhZyxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcnVsZSA9IGltYWdlLmltYWdlUmVwb3NpdG9yeS5vbkV2ZW50KCdQdXNoIHJ1bGUnLCB7XG4gICAgICBjcm9zc1N0YWNrU2NvcGU6IHRoaXMsIC8vIGFsbG93IHByb3ZpZGVyIGFuZCBpbWFnZSBidWlsZGVyIHRvIGJlIGluIGRpZmZlcmVudCBzdGFja3NcbiAgICAgIGRlc2NyaXB0aW9uOiAnVXBkYXRlIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBMYW1iZGEgb24gRUNSIGltYWdlIHB1c2gnLFxuICAgICAgZXZlbnRQYXR0ZXJuOiB7XG4gICAgICAgIGRldGFpbFR5cGU6IFsnRUNSIEltYWdlIEFjdGlvbiddLFxuICAgICAgICBkZXRhaWw6IHtcbiAgICAgICAgICAnYWN0aW9uLXR5cGUnOiBbJ1BVU0gnXSxcbiAgICAgICAgICAncmVwb3NpdG9yeS1uYW1lJzogW2ltYWdlLmltYWdlUmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZV0sXG4gICAgICAgICAgJ2ltYWdlLXRhZyc6IFtpbWFnZS5pbWFnZVRhZ10sXG4gICAgICAgICAgJ3Jlc3VsdCc6IFsnU1VDQ0VTUyddLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICAgIHRhcmdldDogbGFtYmRhVGFyZ2V0LFxuICAgIH0pO1xuXG4gICAgLy8gdGhlIGV2ZW50IG5ldmVyIHRyaWdnZXJzIHdpdGhvdXQgdGhpcyAtIG5vdCBzdXJlIHdoeVxuICAgIChydWxlLm5vZGUuZGVmYXVsdENoaWxkIGFzIGV2ZW50cy5DZm5SdWxlKS5hZGREZWxldGlvbk92ZXJyaWRlKCdQcm9wZXJ0aWVzLkV2ZW50UGF0dGVybi5yZXNvdXJjZXMnKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25maWcgZm9yIHRoZSBzaGFyZWQgTGFtYmRhIGZyYWdtZW50LlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9ydW5uZXJDb25maWcoKTogTGFtYmRhUnVubmVyQ29uZmlnIHtcbiAgICByZXR1cm4ge1xuICAgICAgZmFtaWx5OiBMYW1iZGFSdW5uZXJQcm92aWRlci5fRkFNSUxZLFxuICAgICAgcHJvdmlkZXI6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgZnVuY3Rpb25Bcm46IHRoaXMuZnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICBydW5uZXJHcm91cDogdGhpcy5ncm91cCA/PyAnJyxcbiAgICAgIGRlZmF1bHRMYWJlbHM6IHJ1bm5lckRlZmF1bHRMYWJlbHModGhpcy5pbWFnZS5vcywgdGhpcy5pbWFnZS5hcmNoaXRlY3R1cmUsIHRoaXMuZGVmYXVsdExhYmVscyksXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9ncmFudFN0YXRlTWFjaGluZShzdGF0ZU1hY2hpbmVSb2xlOiBpYW0uSUdyYW50YWJsZSkge1xuICAgIHRoaXMuZnVuY3Rpb24uZ3JhbnRJbnZva2Uoc3RhdGVNYWNoaW5lUm9sZSk7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfc3RhdHVzKHN0YXR1c0Z1bmN0aW9uUm9sZTogaWFtLklHcmFudGFibGUpOiBJUnVubmVyUHJvdmlkZXJTdGF0dXMge1xuICAgIHRoaXMuaW1hZ2UuaW1hZ2VSZXBvc2l0b3J5LmdyYW50KHN0YXR1c0Z1bmN0aW9uUm9sZSwgJ2VjcjpEZXNjcmliZUltYWdlcycpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIGxhYmVsczogdGhpcy5sYWJlbHMsXG4gICAgICBjb25zdHJ1Y3RQYXRoOiB0aGlzLm5vZGUucGF0aCxcbiAgICAgIHZwY0FybjogdGhpcy52cGM/LnZwY0FybixcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzPy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIHJvbGVBcm46IHRoaXMuZnVuY3Rpb24ucm9sZT8ucm9sZUFybixcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmZ1bmN0aW9uLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGltYWdlOiB7XG4gICAgICAgIGltYWdlUmVwb3NpdG9yeTogdGhpcy5pbWFnZS5pbWFnZVJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaSxcbiAgICAgICAgaW1hZ2VUYWc6IHRoaXMuaW1hZ2UuaW1hZ2VUYWcsXG4gICAgICAgIGltYWdlQnVpbGRlckxvZ0dyb3VwOiB0aGlzLmltYWdlLmxvZ0dyb3VwPy5sb2dHcm91cE5hbWUsXG4gICAgICB9LFxuICAgIH07XG4gIH1cbn1cblxuLyoqXG4gKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIExhbWJkYVJ1bm5lclByb3ZpZGVyfVxuICovXG5leHBvcnQgY2xhc3MgTGFtYmRhUnVubmVyIGV4dGVuZHMgTGFtYmRhUnVubmVyUHJvdmlkZXIge1xufVxuIl19