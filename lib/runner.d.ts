import * as cdk from 'aws-cdk-lib';
import { aws_cloudwatch as cloudwatch, aws_ec2 as ec2, aws_lambda as lambda, aws_logs as logs, aws_sqs as sqs, aws_stepfunctions as stepfunctions } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LambdaAccess } from './access';
import { ICompositeProvider, IRunnerProvider, ProviderRetryOptions } from './providers';
import { Secrets } from './secrets';
/**
 * Properties for GitHubRunners
 */
export interface GitHubRunnersProps {
    /**
     * List of runner providers to use. At least one provider is required. Provider will be selected when its label matches the labels requested by the workflow job.
     *
     * @default CodeBuild, Lambda and Fargate runners with all the defaults (no VPC or default account VPC)
     */
    readonly providers?: (IRunnerProvider | ICompositeProvider)[];
    /**
     * Whether to require the `self-hosted` label. If `true`, the runner will only start if the workflow job explicitly requests the `self-hosted` label.
     *
     * Be careful when setting this to `false`. Avoid setting up providers with generic label requirements like `linux` as they may match workflows that are not meant to run on self-hosted runners.
     *
     * @default true
     */
    readonly requireSelfHostedLabel?: boolean;
    /**
     * VPC used for all management functions. Use this with GitHub Enterprise Server hosted that's inaccessible from outside the VPC.
     *
     * **Note:** This only affects management functions that interact with GitHub. Lambda functions that help with runner image building and don't interact with GitHub are NOT affected by this setting and will run outside the VPC.
     *
     * Make sure the selected VPC and subnets have access to the following with either NAT Gateway or VPC Endpoints:
     * * GitHub Enterprise Server
     * * Secrets Manager
     * * SQS
     * * Step Functions
     * * CloudFormation (status function only)
     * * EC2 (status function only)
     * * ECR (status function only)
     */
    readonly vpc?: ec2.IVpc;
    /**
     * VPC subnets used for all management functions. Use this with GitHub Enterprise Server hosted that's inaccessible from outside the VPC.
     *
     * **Note:** This only affects management functions that interact with GitHub. Lambda functions that help with runner image building and don't interact with GitHub are NOT affected by this setting.
     */
    readonly vpcSubnets?: ec2.SubnetSelection;
    /**
     * Allow management functions to run in public subnets. Lambda Functions in a public subnet can NOT access the internet.
     *
     * **Note:** This only affects management functions that interact with GitHub. Lambda functions that help with runner image building and don't interact with GitHub are NOT affected by this setting.
     *
     * @default false
     */
    readonly allowPublicSubnet?: boolean;
    /**
     * Security group attached to all management functions. Use this with to provide access to GitHub Enterprise Server hosted inside a VPC.
     *
     * **Note:** This only affects management functions that interact with GitHub. Lambda functions that help with runner image building and don't interact with GitHub are NOT affected by this setting.
     *
     * @deprecated use {@link securityGroups} instead
     */
    readonly securityGroup?: ec2.ISecurityGroup;
    /**
     * Security groups attached to all management functions. Use this to provide outbound access from management functions to GitHub Enterprise Server hosted inside a VPC.
     *
     * **Note:** This only affects management functions that interact with GitHub. Lambda functions that help with runner image building and don't interact with GitHub are NOT affected by this setting.
     *
     * **Note:** Defining inbound rules on this security group does nothing. This security group only controls outbound access FROM the management functions. To limit access TO the webhook or setup functions, use {@link webhookAccess} and {@link setupAccess} instead.
     */
    readonly securityGroups?: ec2.ISecurityGroup[];
    /**
     * Path to a certificate file (.pem or .crt) or a directory containing certificate files (.pem or .crt) required to trust GitHub Enterprise Server. Use this when GitHub Enterprise Server certificates are self-signed.
     *
     * If a directory is provided, all .pem and .crt files in that directory will be used. The certificates will be concatenated into a single file for use by Node.js.
     *
     * You may also want to use custom images for your runner providers that contain the same certificates. See {@link RunnerImageComponent.extraCertificates}.
     *
     * ```typescript
     * const selfSignedCertificates = 'certs/ghes.pem'; // or 'path-to-my-extra-certs-folder' for a directory
     * const imageBuilder = CodeBuildRunnerProvider.imageBuilder(this, 'Image Builder with Certs');
     * imageBuilder.addComponent(RunnerImageComponent.extraCertificates(selfSignedCertificates, 'private-ca'));
     *
     * const provider = new CodeBuildRunnerProvider(this, 'CodeBuild', {
     *     imageBuilder: imageBuilder,
     * });
     *
     * new GitHubRunners(
     *   this,
     *   'runners',
     *   {
     *     providers: [provider],
     *     extraCertificates: selfSignedCertificates,
     *   }
     * );
     * ```
     */
    readonly extraCertificates?: string;
    /**
     * Time to wait before stopping a runner that remains idle. If the user cancelled the job, or if another runner stole it, this stops the runner to avoid wasting resources.
     *
     * @default 5 minutes
     */
    readonly idleTimeout?: cdk.Duration;
    /**
     * Logging options for the state machine that manages the runners.
     *
     * @default no logs
     */
    readonly logOptions?: LogOptions;
    /**
     * Access configuration for the setup function. Once you finish the setup process, you can set this to `LambdaAccess.noAccess()` to remove access to the setup function. You can also use `LambdaAccess.apiGateway({ allowedIps: ['my-ip/0']})` to limit access to your IP only.
     *
     * @default LambdaAccess.lambdaUrl()
     */
    readonly setupAccess?: LambdaAccess;
    /**
     * Access configuration for the webhook function. This function is called by GitHub when a new workflow job is scheduled. For an extra layer of security, you can set this to `LambdaAccess.apiGateway({ allowedIps: LambdaAccess.githubWebhookIps() })`.
     *
     * You can also set this to `LambdaAccess.apiGateway({allowedVpc: vpc, allowedIps: ['GHES.IP.ADDRESS/32']})` if your GitHub Enterprise Server is hosted in a VPC. This will create an API Gateway endpoint that's only accessible from within the VPC.
     *
     * *WARNING*: changing access type may change the URL. When the URL changes, you must update GitHub as well.
     *
     * @default LambdaAccess.lambdaUrl()
     */
    readonly webhookAccess?: LambdaAccess;
    /**
     * Access configuration for the status function. This function returns a lot of sensitive information about the runner, so you should only allow access to it from trusted IPs, if at all.
     *
     * @default LambdaAccess.noAccess()
     */
    readonly statusAccess?: LambdaAccess;
    /**
     * Options to retry operation in case of failure like missing capacity, or API quota issues.
     *
     * GitHub jobs time out after not being able to get a runner for 24 hours. You should not retry for more than 24 hours.
     *
     * Total time spent waiting can be calculated with interval * (backoffRate ^ maxAttempts) / (backoffRate - 1).
     *
     * @default retry 23 times up to about 24 hours
     */
    readonly retryOptions?: ProviderRetryOptions;
    /**
     * Optional Lambda function to customize provider selection logic and label assignment.
     *
     * * The function receives the webhook payload along with default provider and its labels as {@link ProviderSelectorInput}
     * * The function returns a selected provider and its labels as {@link ProviderSelectorResult}
     * * You can decline to provision a runner by returning undefined as the provider selector result
     * * You can fully customize the labels for the about-to-be-provisioned runner (add, remove, modify, dynamic labels, etc.)
     * * Labels don't have to match the labels originally configured for the provider, but see warnings below
     * * This function will be called synchronously during webhook processing, so it should be fast and efficient (webhook limit is 30 seconds total)
     *
     * **WARNING: It is your responsibility to ensure the selected provider's labels match the job's required labels. If you return the wrong labels, the runner will be created but GitHub Actions will not assign the job to it.**
     *
     * **WARNING: Provider selection is not a guarantee that a specific provider will be assigned for the job. GitHub Actions may assign the job to any runner with matching labels. The provider selector only determines which provider's runner will be *created*, but GitHub Actions may route the job to any available runner with the required labels.**
     *
     * **For reliable provider assignment based on job characteristics, consider using repo-level runner registration where you can control which runners are available for specific repositories. This information is also available while using the setup wizard.
     *
     * @see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md
     */
    readonly providerSelector?: lambda.IFunction;
}
/**
 * Defines what execution history events are logged and where they are logged.
 */
export interface LogOptions {
    /**
     * The log group where the execution history events will be logged.
     */
    readonly logGroupName?: string;
    /**
     * Determines whether execution data is included in your log.
     *
     * @default false
     */
    readonly includeExecutionData?: boolean;
    /**
     * Defines which category of execution history events are logged.
     *
     * @default ERROR
     */
    readonly level?: stepfunctions.LogLevel;
    /**
     * The number of days log events are kept in CloudWatch Logs. When updating
     * this property, unsetting it doesn't remove the log retention policy. To
     * remove the retention policy, set the value to `INFINITE`.
     *
     * @default logs.RetentionDays.ONE_MONTH
     */
    readonly logRetention?: logs.RetentionDays;
}
/**
 * Create all the required infrastructure to provide self-hosted GitHub runners. It creates a webhook, secrets, and a step function to orchestrate all runs. Secrets are not automatically filled. See README.md for instructions on how to setup GitHub integration.
 *
 * By default, this will create a runner provider of each available type with the defaults. This is good enough for the initial setup stage when you just want to get GitHub integration working.
 *
 * ```typescript
 * new GitHubRunners(this, 'runners');
 * ```
 *
 * Usually you'd want to configure the runner providers so the runners can run in a certain VPC or have certain permissions.
 *
 * ```typescript
 * const vpc = ec2.Vpc.fromLookup(this, 'vpc', { vpcId: 'vpc-1234567' });
 * const runnerSg = new ec2.SecurityGroup(this, 'runner security group', { vpc: vpc });
 * const dbSg = ec2.SecurityGroup.fromSecurityGroupId(this, 'database security group', 'sg-1234567');
 * const bucket = new s3.Bucket(this, 'runner bucket');
 *
 * // create a custom CodeBuild provider
 * const myProvider = new CodeBuildRunnerProvider(
 *   this, 'codebuild runner',
 *   {
 *      labels: ['my-codebuild'],
 *      vpc: vpc,
 *      securityGroups: [runnerSg],
 *   },
 * );
 * // grant some permissions to the provider
 * bucket.grantReadWrite(myProvider);
 * dbSg.connections.allowFrom(runnerSg, ec2.Port.tcp(3306), 'allow runners to connect to MySQL database');
 *
 * // create the runner infrastructure
 * new GitHubRunners(
 *   this,
 *   'runners',
 *   {
 *     providers: [myProvider],
 *   }
 * );
 * ```
 */
export declare class GitHubRunners extends Construct implements ec2.IConnectable {
    readonly props?: GitHubRunnersProps | undefined;
    /**
     * Configured runner providers.
     */
    readonly providers: (IRunnerProvider | ICompositeProvider)[];
    /**
     * Secrets for GitHub communication including webhook secret and runner authentication.
     */
    readonly secrets: Secrets;
    /**
     * Manage the connections of all management functions. Use this to enable connections to your GitHub Enterprise Server in a VPC.
     *
     * This cannot be used to manage connections of the runners. Use the `connections` property of each runner provider to manage runner connections.
     */
    readonly connections: ec2.Connections;
    private readonly webhook;
    private readonly redeliverer;
    private readonly orchestrator;
    private readonly setupUrl;
    private readonly extraLambdaEnv;
    private readonly extraLambdaProps;
    private stateMachineLogGroup?;
    private jobsCompletedMetricFiltersInitialized;
    private warmRunnerManager?;
    private warmRunnerQueue?;
    private warmConfigHashes;
    private deleteFailedRunnerIndex;
    private deleteFailedRunnerFunction?;
    constructor(scope: Construct, id: string, props?: GitHubRunnersProps | undefined);
    private stateMachine;
    private tokenRetriever;
    private deleteFailedRunner;
    private addCatchAndCleanUp;
    private statusFunction;
    private setupFunction;
    private checkIntersectingLabels;
    private idleReaper;
    private idleReaperQueue;
    private lambdaSecurityGroups;
    /**
     * Extracts all unique IRunnerProvider instances from providers and composite providers (one level only).
     * Uses a Set to ensure we don't process the same provider twice, even if it's used in multiple composites.
     *
     * @returns Set of unique IRunnerProvider instances
     */
    private extractUniqueSubProviders;
    /**
     * Creates a Lambda layer with certificates if extraCertificates is specified.
     */
    private createCertificateLayer;
    /**
     * Metric for the number of GitHub Actions jobs completed. It has `ProviderLabels` and `Status` dimensions. The status can be one of "Succeeded", "SucceededWithIssues", "Failed", "Canceled", "Skipped", or "Abandoned".
     *
     * **WARNING:** this method creates a metric filter for each provider. Each metric has a status dimension with six possible values. These resources may incur cost.
     */
    metricJobCompleted(props?: cloudwatch.MetricOptions): cloudwatch.Metric;
    /**
     * Metric for successful executions.
     *
     * A successful execution doesn't always mean a runner was started. It can be successful even without any label matches.
     *
     * A successful runner doesn't mean the job it executed was successful. For that, see {@link metricJobCompleted}.
     */
    metricSucceeded(props?: cloudwatch.MetricOptions): cloudwatch.Metric;
    /**
     * Metric for failed runner executions.
     *
     * A failed runner usually means the runner failed to start and so a job was never executed. It doesn't necessarily mean the job was executed and failed. For that, see {@link metricJobCompleted}.
     */
    metricFailed(props?: cloudwatch.MetricOptions): cloudwatch.Metric;
    /**
     * Metric for the interval, in milliseconds, between the time the execution starts and the time it closes. This time may be longer than the time the runner took.
     */
    metricTime(props?: cloudwatch.MetricOptions): cloudwatch.Metric;
    /**
     * Creates a topic for notifications when a runner image build fails.
     *
     * Runner images are rebuilt every week by default. This provides the latest GitHub Runner version and software updates.
     *
     * If you want to be sure you are using the latest runner version, you can use this topic to be notified when a build fails.
     *
     * When the image builder is defined in a separate stack (e.g. in a split-stacks setup), pass that stack or construct
     * as the optional scope so the topic and failure-notification aspects are created in the same stack as the image
     * builder. Otherwise the aspects may not find the image builder resources.
     *
     * @param scope Optional scope (e.g. the image builder stack) where the topic and aspects will be created. Defaults to this construct.
     */
    failedImageBuildsTopic(scope?: Construct): cdk.aws_sns.Topic;
    /**
     * Creates CloudWatch Logs Insights saved queries that can be used to debug issues with the runners.
     *
     * * "Webhook errors" helps diagnose configuration issues with GitHub integration
     * * "Ignored webhook" helps understand why runners aren't started
     * * "Ignored jobs based on labels" helps debug label matching issues
     * * "Webhook started runners" helps understand which runners were started
     * * "Warm runner status" and "Warm runner errors" (when warm runners are configured)
     *
     * @param prefix Prefix for the query definitions. Defaults to "GitHub Runners".
     */
    createLogsInsightsQueries(prefix?: string): void;
    /**
     * Register a warm runner config hash. All registered hashes are passed to the
     * manager Lambda via WARM_CONFIG_HASHES env var so keepers can detect stale configs.
     *
     * @internal
     */
    _registerWarmConfigHash(hash: string): void;
    /**
     * Lazily create shared warm runner infrastructure (Lambda, SQS queue).
     * Returns the manager Lambda and queue for use as EventBridge targets.
     *
     * @internal
     */
    _ensureWarmRunnerInfra(): {
        lambda: lambda.Function;
        queue: sqs.Queue;
    };
}
