"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHubRunners = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const access_1 = require("./access");
const delete_failed_runner_function_1 = require("./delete-failed-runner-function");
const idle_runner_repear_function_1 = require("./idle-runner-repear-function");
const providers_1 = require("./providers");
const secrets_1 = require("./secrets");
const setup_function_1 = require("./setup-function");
const status_function_1 = require("./status-function");
const token_retriever_function_1 = require("./token-retriever-function");
const utils_1 = require("./utils");
const webhook_1 = require("./webhook");
const webhook_redelivery_1 = require("./webhook-redelivery");
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
class GitHubRunners extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        this.props = props;
        this.extraLambdaEnv = {};
        this.jobsCompletedMetricFiltersInitialized = false;
        this.secrets = new secrets_1.Secrets(this, 'Secrets');
        this.extraLambdaProps = {
            vpc: this.props?.vpc,
            vpcSubnets: this.props?.vpcSubnets,
            allowPublicSubnet: this.props?.allowPublicSubnet,
            securityGroups: this.lambdaSecurityGroups(),
            layers: [],
        };
        this.connections = new aws_cdk_lib_1.aws_ec2.Connections({ securityGroups: this.extraLambdaProps.securityGroups });
        this.createCertificateLayer(scope);
        if (this.props?.providers) {
            this.providers = this.props.providers;
        }
        else {
            this.providers = [
                new providers_1.CodeBuildRunnerProvider(this, 'CodeBuild'),
                new providers_1.LambdaRunnerProvider(this, 'Lambda'),
                new providers_1.FargateRunnerProvider(this, 'Fargate'),
            ];
        }
        if (this.providers.length == 0) {
            throw new Error('At least one runner provider is required');
        }
        this.checkIntersectingLabels();
        this.orchestrator = this.stateMachine(props);
        this.webhook = new webhook_1.GithubWebhookHandler(this, 'Webhook Handler', {
            orchestrator: this.orchestrator,
            secrets: this.secrets,
            access: this.props?.webhookAccess ?? access_1.LambdaAccess.lambdaUrl(),
            providers: this.providers.reduce((acc, p) => {
                acc[p.node.path] = p.labels;
                return acc;
            }, {}),
            requireSelfHostedLabel: this.props?.requireSelfHostedLabel ?? true,
            providerSelector: this.props?.providerSelector,
            extraLambdaProps: this.extraLambdaProps,
            extraLambdaEnv: this.extraLambdaEnv,
        });
        this.redeliverer = new webhook_redelivery_1.GithubWebhookRedelivery(this, 'Webhook Redelivery', {
            secrets: this.secrets,
            extraLambdaProps: this.extraLambdaProps,
            extraLambdaEnv: this.extraLambdaEnv,
        });
        this.setupUrl = this.setupFunction();
        this.statusFunction();
    }
    stateMachine(props) {
        const tokenRetrieverTask = new aws_cdk_lib_1.aws_stepfunctions_tasks.LambdaInvoke(this, 'Get Runner Token', {
            lambdaFunction: this.tokenRetriever(),
            payloadResponseOnly: true,
            resultPath: '$.runner',
            payload: aws_cdk_lib_1.aws_stepfunctions.TaskInput.fromObject({
                'owner.$': '$.owner',
                'repo.$': '$.repo',
                'installationId.$': '$.installationId',
                'labels.$': '$.labels',
                'jobId.$': '$.jobId',
                'runnerName.$': '$$.Execution.Name',
            }),
        });
        let deleteFailedRunnerFunction = this.deleteFailedRunner();
        const deleteFailedRunnerTask = new aws_cdk_lib_1.aws_stepfunctions_tasks.LambdaInvoke(this, 'Delete Failed Runner', {
            lambdaFunction: deleteFailedRunnerFunction,
            payloadResponseOnly: true,
            resultPath: '$.delete',
            payload: aws_cdk_lib_1.aws_stepfunctions.TaskInput.fromObject({
                runnerName: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$$.Execution.Name'),
                owner: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.owner'),
                repo: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.repo'),
                installationId: aws_cdk_lib_1.aws_stepfunctions.JsonPath.numberAt('$.installationId'),
                error: aws_cdk_lib_1.aws_stepfunctions.JsonPath.objectAt('$.error'),
            }),
        });
        deleteFailedRunnerTask.addRetry({
            errors: [
                'RunnerBusy',
            ],
            interval: cdk.Duration.minutes(1),
            backoffRate: 1,
            maxAttempts: 60,
        });
        const idleReaper = this.idleReaper();
        const queueIdleReaperTask = new aws_cdk_lib_1.aws_stepfunctions_tasks.SqsSendMessage(this, 'Queue Idle Reaper', {
            queue: this.idleReaperQueue(idleReaper),
            messageBody: aws_cdk_lib_1.aws_stepfunctions.TaskInput.fromObject({
                executionArn: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$$.Execution.Id'),
                runnerName: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$$.Execution.Name'),
                owner: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.owner'),
                repo: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.repo'),
                installationId: aws_cdk_lib_1.aws_stepfunctions.JsonPath.numberAt('$.installationId'),
                maxIdleSeconds: (props?.idleTimeout ?? cdk.Duration.minutes(5)).toSeconds(),
            }),
            resultPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.DISCARD,
        });
        const providerChooser = new aws_cdk_lib_1.aws_stepfunctions.Choice(this, 'Choose provider');
        for (const provider of this.providers) {
            const providerTask = provider.getStepFunctionTask({
                runnerTokenPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.runner.token'),
                runnerNamePath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$$.Execution.Name'),
                githubDomainPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.runner.domain'),
                ownerPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.owner'),
                repoPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.repo'),
                registrationUrl: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.runner.registrationUrl'),
                labelsPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.labels'),
                jitConfigPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.runner.jitConfig'),
            });
            providerChooser.when(aws_cdk_lib_1.aws_stepfunctions.Condition.and(aws_cdk_lib_1.aws_stepfunctions.Condition.stringEquals('$.provider', provider.node.path)), providerTask, {
                comment: `Labels: ${provider.labels.join(', ')}`,
            });
        }
        providerChooser.otherwise(new aws_cdk_lib_1.aws_stepfunctions.Succeed(this, 'Unknown label'));
        // Check if the token retriever indicated the job is no longer queued.
        // This prevents launching a runner for a job that was already picked up
        // by another runner (common during retries under burst load).
        const jobStillQueued = new aws_cdk_lib_1.aws_stepfunctions.Choice(this, 'Job Still Queued?');
        jobStillQueued.when(aws_cdk_lib_1.aws_stepfunctions.Condition.booleanEquals('$.runner.skip', true), new aws_cdk_lib_1.aws_stepfunctions.Succeed(this, 'Job Already Handled'));
        jobStillQueued.otherwise(providerChooser);
        const runProviders = new aws_cdk_lib_1.aws_stepfunctions.Parallel(this, 'Run Providers').branch(new aws_cdk_lib_1.aws_stepfunctions.Parallel(this, 'Error Handler').branch(
        // we get a token for every retry because the token can expire faster than the job can timeout
        tokenRetrieverTask.next(jobStillQueued)).addCatch(
        // delete runner on failure as it won't remove itself and there is a limit on the number of registered runners
        deleteFailedRunnerTask, {
            resultPath: '$.error',
        }));
        if (props?.retryOptions?.retry ?? true) {
            const interval = props?.retryOptions?.interval ?? cdk.Duration.minutes(1);
            const maxAttempts = props?.retryOptions?.maxAttempts ?? 23;
            const backoffRate = props?.retryOptions?.backoffRate ?? 1.3;
            const totalSeconds = interval.toSeconds() * backoffRate ** maxAttempts / (backoffRate - 1);
            if (totalSeconds >= cdk.Duration.days(1).toSeconds()) {
                // https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#usage-limits
                // "Job queue time - Each job for self-hosted runners can be queued for a maximum of 24 hours. If a self-hosted runner does not start executing the job within this limit, the job is terminated and fails to complete."
                aws_cdk_lib_1.Annotations.of(this).addWarning(`Total retry time is greater than 24 hours (${Math.floor(totalSeconds / 60 / 60)} hours). Jobs expire after 24 hours so it would be a waste of resources to retry further.`);
            }
            runProviders.addRetry({
                interval,
                maxAttempts,
                backoffRate,
                // we retry on everything
                // deleted idle runners will also fail, but the reaper will stop this step function to avoid endless retries
            });
        }
        let logOptions;
        if (this.props?.logOptions) {
            this.stateMachineLogGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'Logs', {
                logGroupName: props?.logOptions?.logGroupName,
                retention: props?.logOptions?.logRetention ?? aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
            logOptions = {
                destination: this.stateMachineLogGroup,
                includeExecutionData: props?.logOptions?.includeExecutionData ?? true,
                level: props?.logOptions?.level ?? aws_cdk_lib_1.aws_stepfunctions.LogLevel.ALL,
            };
        }
        const stateMachine = new aws_cdk_lib_1.aws_stepfunctions.StateMachine(this, 'Runner Orchestrator', {
            definitionBody: aws_cdk_lib_1.aws_stepfunctions.DefinitionBody.fromChainable(queueIdleReaperTask.next(runProviders)),
            logs: logOptions,
        });
        stateMachine.grantRead(idleReaper);
        stateMachine.grantExecution(idleReaper, 'states:StopExecution');
        for (const provider of this.providers) {
            provider.grantStateMachine(stateMachine);
        }
        return stateMachine;
    }
    tokenRetriever() {
        const func = new token_retriever_function_1.TokenRetrieverFunction(this, 'token-retriever', {
            description: 'Get token from GitHub Actions used to start new self-hosted runner',
            environment: {
                GITHUB_SECRET_ARN: this.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: this.secrets.githubPrivateKey.secretArn,
                ...this.extraLambdaEnv,
            },
            timeout: cdk.Duration.seconds(30),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            ...this.extraLambdaProps,
        });
        this.secrets.github.grantRead(func);
        this.secrets.githubPrivateKey.grantRead(func);
        return func;
    }
    deleteFailedRunner() {
        const func = new delete_failed_runner_function_1.DeleteFailedRunnerFunction(this, 'delete-runner', {
            description: 'Delete failed GitHub Actions runner on error',
            environment: {
                GITHUB_SECRET_ARN: this.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: this.secrets.githubPrivateKey.secretArn,
                ...this.extraLambdaEnv,
            },
            timeout: cdk.Duration.seconds(30),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            ...this.extraLambdaProps,
        });
        this.secrets.github.grantRead(func);
        this.secrets.githubPrivateKey.grantRead(func);
        return func;
    }
    statusFunction() {
        const statusFunction = new status_function_1.StatusFunction(this, 'status', {
            description: 'Provide user with status about self-hosted GitHub Actions runners',
            environment: {
                WEBHOOK_SECRET_ARN: this.secrets.webhook.secretArn,
                GITHUB_SECRET_ARN: this.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: this.secrets.githubPrivateKey.secretArn,
                SETUP_SECRET_ARN: this.secrets.setup.secretArn,
                WEBHOOK_URL: this.webhook.url,
                WEBHOOK_HANDLER_ARN: this.webhook.handler.latestVersion.functionArn,
                STEP_FUNCTION_ARN: this.orchestrator.stateMachineArn,
                STEP_FUNCTION_LOG_GROUP: this.stateMachineLogGroup?.logGroupName ?? '',
                SETUP_FUNCTION_URL: this.setupUrl,
                ...this.extraLambdaEnv,
            },
            timeout: cdk.Duration.minutes(3),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.SETUP),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            ...this.extraLambdaProps,
        });
        const providers = this.providers.flatMap(provider => {
            const status = provider.status(statusFunction);
            // Composite providers return an array, regular providers return a single status
            return Array.isArray(status) ? status : [status];
        });
        // expose providers as stack metadata as it's too big for Lambda environment variables
        // specifically integration testing got an error because lambda update request was >5kb
        const stack = cdk.Stack.of(this);
        const f = statusFunction.node.defaultChild;
        f.addPropertyOverride('Environment.Variables.LOGICAL_ID', f.logicalId);
        f.addPropertyOverride('Environment.Variables.STACK_NAME', stack.stackName);
        f.addMetadata('providers', providers);
        statusFunction.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['cloudformation:DescribeStackResource'],
            resources: [stack.stackId],
        }));
        this.secrets.webhook.grantRead(statusFunction);
        this.secrets.github.grantRead(statusFunction);
        this.secrets.githubPrivateKey.grantRead(statusFunction);
        this.secrets.setup.grantRead(statusFunction);
        this.orchestrator.grantRead(statusFunction);
        new cdk.CfnOutput(this, 'status command', {
            value: `aws --region ${stack.region} lambda invoke --function-name ${statusFunction.functionName} status.json`,
        });
        const access = this.props?.statusAccess ?? access_1.LambdaAccess.noAccess();
        const url = access.bind(this, 'status access', statusFunction);
        if (url !== '') {
            new cdk.CfnOutput(this, 'status url', {
                value: url,
            });
        }
    }
    setupFunction() {
        const setupFunction = new setup_function_1.SetupFunction(this, 'setup', {
            description: 'Setup GitHub Actions integration with self-hosted runners',
            environment: {
                SETUP_SECRET_ARN: this.secrets.setup.secretArn,
                WEBHOOK_SECRET_ARN: this.secrets.webhook.secretArn,
                GITHUB_SECRET_ARN: this.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: this.secrets.githubPrivateKey.secretArn,
                WEBHOOK_URL: this.webhook.url,
                ...this.extraLambdaEnv,
            },
            timeout: cdk.Duration.minutes(3),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.SETUP),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            ...this.extraLambdaProps,
        });
        // this.secrets.webhook.grantRead(setupFunction);
        this.secrets.webhook.grantWrite(setupFunction);
        this.secrets.github.grantRead(setupFunction);
        this.secrets.github.grantWrite(setupFunction);
        // this.secrets.githubPrivateKey.grantRead(setupFunction);
        this.secrets.githubPrivateKey.grantWrite(setupFunction);
        this.secrets.setup.grantRead(setupFunction);
        this.secrets.setup.grantWrite(setupFunction);
        const access = this.props?.setupAccess ?? access_1.LambdaAccess.lambdaUrl();
        return access.bind(this, 'setup access', setupFunction);
    }
    checkIntersectingLabels() {
        // this "algorithm" is very inefficient, but good enough for the tiny datasets we expect
        for (const p1 of this.providers) {
            for (const p2 of this.providers) {
                if (p1 == p2) {
                    continue;
                }
                if (p1.labels.every(l => p2.labels.includes(l))) {
                    if (p2.labels.every(l => p1.labels.includes(l))) {
                        throw new Error(`Both ${p1.node.path} and ${p2.node.path} use the same labels [${p1.labels.join(', ')}]`);
                    }
                    aws_cdk_lib_1.Annotations.of(p1).addWarning(`Labels [${p1.labels.join(', ')}] intersect with another provider (${p2.node.path} -- [${p2.labels.join(', ')}]). If a workflow specifies the labels [${p1.labels.join(', ')}], it is not guaranteed which provider will be used. It is recommended you do not use intersecting labels`);
                }
            }
        }
    }
    idleReaper() {
        return new idle_runner_repear_function_1.IdleRunnerRepearFunction(this, 'Idle Reaper', {
            description: 'Stop idle GitHub runners to avoid paying for runners when the job was already canceled',
            environment: {
                GITHUB_SECRET_ARN: this.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: this.secrets.githubPrivateKey.secretArn,
                ...this.extraLambdaEnv,
            },
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            timeout: cdk.Duration.minutes(5),
            ...this.extraLambdaProps,
        });
    }
    idleReaperQueue(reaper) {
        // see this comment to understand why it's a queue that's out of the step function
        // https://github.com/CloudSnorkel/cdk-github-runners/pull/314#issuecomment-1528901192
        const queue = new aws_cdk_lib_1.aws_sqs.Queue(this, 'Idle Reaper Queue', {
            deliveryDelay: cdk.Duration.minutes(10),
            visibilityTimeout: cdk.Duration.minutes(10),
        });
        reaper.addEventSource(new aws_cdk_lib_1.aws_lambda_event_sources.SqsEventSource(queue, {
            reportBatchItemFailures: true,
            maxBatchingWindow: cdk.Duration.minutes(1),
        }));
        this.secrets.github.grantRead(reaper);
        this.secrets.githubPrivateKey.grantRead(reaper);
        return queue;
    }
    lambdaSecurityGroups() {
        if (!this.props?.vpc) {
            if (this.props?.securityGroup) {
                cdk.Annotations.of(this).addWarning('securityGroup is specified, but vpc is not. securityGroup will be ignored');
            }
            if (this.props?.securityGroups) {
                cdk.Annotations.of(this).addWarning('securityGroups is specified, but vpc is not. securityGroups will be ignored');
            }
            return undefined;
        }
        if (this.props.securityGroups) {
            if (this.props.securityGroup) {
                cdk.Annotations.of(this).addWarning('Both securityGroup and securityGroups are specified. securityGroup will be ignored');
            }
            return this.props.securityGroups;
        }
        if (this.props.securityGroup) {
            return [this.props.securityGroup];
        }
        return [new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, 'Management Lambdas Security Group', { vpc: this.props.vpc })];
    }
    /**
     * Extracts all unique IRunnerProvider instances from providers and composite providers (one level only).
     * Uses a Set to ensure we don't process the same provider twice, even if it's used in multiple composites.
     *
     * @returns Set of unique IRunnerProvider instances
     */
    extractUniqueSubProviders() {
        const seen = new Set();
        for (const provider of this.providers) {
            // instanceof doesn't really work in CDK so use this hack instead
            if ('logGroup' in provider) {
                // Regular provider
                seen.add(provider);
            }
            else {
                // Composite provider - access the providers field
                for (const subProvider of provider.providers) {
                    seen.add(subProvider);
                }
            }
        }
        return seen;
    }
    /**
     * Creates a Lambda layer with certificates if extraCertificates is specified.
     */
    createCertificateLayer(scope) {
        if (!this.props?.extraCertificates) {
            return;
        }
        const certificateFiles = (0, utils_1.discoverCertificateFiles)(this.props.extraCertificates);
        // Concatenate all certificates into a single file for NODE_EXTRA_CA_CERTS
        let combinedCertContent = '';
        for (const certFile of certificateFiles) {
            const certContent = fs.readFileSync(certFile, 'utf8');
            combinedCertContent += certContent;
            // Ensure proper PEM format with newline between certificates
            if (!certContent.endsWith('\n')) {
                combinedCertContent += '\n';
            }
        }
        // Create a temporary directory, write the certificate file, create asset, then delete temp dir
        const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'certificate-layer-'));
        try {
            const certPath = path.join(workdir, 'certs.pem');
            fs.writeFileSync(certPath, combinedCertContent);
            // Set environment variable and create layer
            this.extraLambdaEnv.NODE_EXTRA_CA_CERTS = '/opt/certs.pem';
            this.extraLambdaProps.layers.push(new aws_cdk_lib_1.aws_lambda.LayerVersion(scope, 'Certificate Layer', {
                description: 'Layer containing GitHub Enterprise Server certificate(s) for cdk-github-runners',
                code: aws_cdk_lib_1.aws_lambda.Code.fromAsset(workdir),
            }));
        }
        finally {
            // Calling `fromAsset()` has copied files to the assembly, so we can delete the temporary directory.
            fs.rmSync(workdir, { recursive: true, force: true });
        }
    }
    /**
     * Metric for the number of GitHub Actions jobs completed. It has `ProviderLabels` and `Status` dimensions. The status can be one of "Succeeded", "SucceededWithIssues", "Failed", "Canceled", "Skipped", or "Abandoned".
     *
     * **WARNING:** this method creates a metric filter for each provider. Each metric has a status dimension with six possible values. These resources may incur cost.
     */
    metricJobCompleted(props) {
        if (!this.jobsCompletedMetricFiltersInitialized) {
            // we can't use logs.FilterPattern.spaceDelimited() because it has no support for ||
            // status list taken from https://github.com/actions/runner/blob/be9632302ceef50bfb36ea998cea9c94c75e5d4d/src/Sdk/DTWebApi/WebApi/TaskResult.cs
            // we need "..." for Lambda that prefixes some extra data to log lines
            const pattern = aws_cdk_lib_1.aws_logs.FilterPattern.literal('[..., marker = "CDKGHA", job = "JOB", done = "DONE", labels, status = "Succeeded" || status = "SucceededWithIssues" || status = "Failed" || status = "Canceled" || status = "Skipped" || status = "Abandoned"]');
            // Extract all unique sub-providers from regular and composite providers
            // Build a set first to avoid filtering the same log twice
            for (const p of this.extractUniqueSubProviders()) {
                const metricFilter = p.logGroup.addMetricFilter(`${p.logGroup.node.id} filter`, {
                    metricNamespace: 'GitHubRunners',
                    metricName: 'JobCompleted',
                    filterPattern: pattern,
                    metricValue: '1',
                    // can't with dimensions -- defaultValue: 0,
                    dimensions: {
                        ProviderLabels: '$labels',
                        Status: '$status',
                    },
                });
                if (metricFilter.node.defaultChild instanceof aws_cdk_lib_1.aws_logs.CfnMetricFilter) {
                    metricFilter.node.defaultChild.addPropertyOverride('MetricTransformations.0.Unit', 'Count');
                }
                else {
                    aws_cdk_lib_1.Annotations.of(metricFilter).addWarning('Unable to set metric filter Unit to Count');
                }
            }
            this.jobsCompletedMetricFiltersInitialized = true;
        }
        return new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: 'GitHubRunners',
            metricName: 'JobsCompleted',
            unit: aws_cdk_lib_1.aws_cloudwatch.Unit.COUNT,
            statistic: aws_cdk_lib_1.aws_cloudwatch.Stats.SUM,
            ...props,
        }).attachTo(this);
    }
    /**
     * Metric for successful executions.
     *
     * A successful execution doesn't always mean a runner was started. It can be successful even without any label matches.
     *
     * A successful runner doesn't mean the job it executed was successful. For that, see {@link metricJobCompleted}.
     */
    metricSucceeded(props) {
        return this.orchestrator.metricSucceeded(props);
    }
    /**
     * Metric for failed runner executions.
     *
     * A failed runner usually means the runner failed to start and so a job was never executed. It doesn't necessarily mean the job was executed and failed. For that, see {@link metricJobCompleted}.
     */
    metricFailed(props) {
        return this.orchestrator.metricFailed(props);
    }
    /**
     * Metric for the interval, in milliseconds, between the time the execution starts and the time it closes. This time may be longer than the time the runner took.
     */
    metricTime(props) {
        return this.orchestrator.metricTime(props);
    }
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
    failedImageBuildsTopic(scope) {
        scope ?? (scope = this);
        const topic = new aws_cdk_lib_1.aws_sns.Topic(scope, 'Failed Runner Image Builds');
        const stack = cdk.Stack.of(scope);
        cdk.Aspects.of(stack).add(new providers_1.CodeBuildImageBuilderFailedBuildNotifier(topic));
        cdk.Aspects.of(stack).add(new providers_1.AwsImageBuilderFailedBuildNotifier(providers_1.AwsImageBuilderFailedBuildNotifier.createFilteringTopic(scope, topic)));
        return topic;
    }
    /**
     * Creates CloudWatch Logs Insights saved queries that can be used to debug issues with the runners.
     *
     * * "Webhook errors" helps diagnose configuration issues with GitHub integration
     * * "Ignored webhook" helps understand why runners aren't started
     * * "Ignored jobs based on labels" helps debug label matching issues
     * * "Webhook started runners" helps understand which runners were started
     */
    createLogsInsightsQueries() {
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Webhook errors', {
            queryDefinitionName: 'GitHub Runners/Webhook errors',
            logGroups: [this.webhook.handler.logGroup],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                filterStatements: [
                    `strcontains(@logStream, "${this.webhook.handler.functionName}")`,
                    'level = "ERROR"',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Orchestration errors', {
            queryDefinitionName: 'GitHub Runners/Orchestration errors',
            logGroups: [(0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR)],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                filterStatements: [
                    'level = "ERROR"',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Runner image build errors', {
            queryDefinitionName: 'GitHub Runners/Runner image build errors',
            logGroups: [(0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.RUNNER_IMAGE_BUILD)],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                filterStatements: [
                    'strcontains(message, "error") or strcontains(message, "ERROR") or strcontains(message, "Error") or level = "ERROR"',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Ignored webhooks', {
            queryDefinitionName: 'GitHub Runners/Ignored webhooks',
            logGroups: [this.webhook.handler.logGroup],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                fields: ['@timestamp', 'message.notice'],
                filterStatements: [
                    `strcontains(@logStream, "${this.webhook.handler.functionName}")`,
                    'strcontains(message.notice, "Ignoring")',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Ignored jobs based on labels', {
            queryDefinitionName: 'GitHub Runners/Ignored jobs based on labels',
            logGroups: [this.webhook.handler.logGroup],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                fields: ['@timestamp', 'message.notice'],
                filterStatements: [
                    `strcontains(@logStream, "${this.webhook.handler.functionName}")`,
                    'strcontains(message.notice, "Ignoring labels")',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Webhook started runners', {
            queryDefinitionName: 'GitHub Runners/Webhook started runners',
            logGroups: [this.webhook.handler.logGroup],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                fields: ['@timestamp', 'message.sfnInput.jobUrl', 'message.sfnInput.jobLabels', 'message.sfnInput.labels', 'message.sfnInput.provider'],
                filterStatements: [
                    `strcontains(@logStream, "${this.webhook.handler.functionName}")`,
                    'message.sfnInput.jobUrl like /http.*/',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Webhook redeliveries', {
            queryDefinitionName: 'GitHub Runners/Webhook redeliveries',
            logGroups: [this.redeliverer.handler.logGroup],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                fields: ['@timestamp', 'message.notice', 'message.deliveryId', 'message.guid'],
                filterStatements: [
                    'isPresent(message.deliveryId)',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
    }
}
exports.GitHubRunners = GitHubRunners;
_a = JSII_RTTI_SYMBOL_1;
GitHubRunners[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.GitHubRunners", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVubmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3J1bm5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLHlCQUF5QjtBQUN6Qix5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLG1DQUFtQztBQUNuQyw2Q0FZcUI7QUFDckIsMkNBQXVDO0FBQ3ZDLHFDQUF3QztBQUN4QyxtRkFBNkU7QUFDN0UsK0VBQXlFO0FBQ3pFLDJDQVNxQjtBQUNyQix1Q0FBb0M7QUFDcEMscURBQWlEO0FBQ2pELHVEQUFtRDtBQUNuRCx5RUFBb0U7QUFDcEUsbUNBQXdGO0FBQ3hGLHVDQUFpRDtBQUNqRCw2REFBK0Q7QUEyTS9EOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F1Q0c7QUFDSCxNQUFhLGFBQWMsU0FBUSxzQkFBUztJQTJCMUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBVyxLQUEwQjtRQUMzRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRGdDLFVBQUssR0FBTCxLQUFLLENBQXFCO1FBTDVELG1CQUFjLEdBQTRCLEVBQUUsQ0FBQztRQUd0RCwwQ0FBcUMsR0FBRyxLQUFLLENBQUM7UUFLcEQsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLGlCQUFPLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBRTVDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRztZQUN0QixHQUFHLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHO1lBQ3BCLFVBQVUsRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFLFVBQVU7WUFDbEMsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxpQkFBaUI7WUFDaEQsY0FBYyxFQUFFLElBQUksQ0FBQyxvQkFBb0IsRUFBRTtZQUMzQyxNQUFNLEVBQUUsRUFBRTtTQUNYLENBQUM7UUFDRixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUkscUJBQUcsQ0FBQyxX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QUFudUJILHNDQW91QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7XG4gIEFubm90YXRpb25zLFxuICBhd3NfY2xvdWR3YXRjaCBhcyBjbG91ZHdhdGNoLFxuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sYW1iZGEgYXMgbGFtYmRhLFxuICBhd3NfbGFtYmRhX2V2ZW50X3NvdXJjZXMgYXMgbGFtYmRhX2V2ZW50X3NvdXJjZXMsXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zbnMgYXMgc25zLFxuICBhd3Nfc3FzIGFzIHNxcyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnMgYXMgc3RlcGZ1bmN0aW9ucyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnNfdGFza3MgYXMgc3RlcGZ1bmN0aW9uc190YXNrcyxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBMYW1iZGFBY2Nlc3MgfSBmcm9tICcuL2FjY2Vzcyc7XG5pbXBvcnQgeyBEZWxldGVGYWlsZWRSdW5uZXJGdW5jdGlvbiB9IGZyb20gJy4vZGVsZXRlLWZhaWxlZC1ydW5uZXItZnVuY3Rpb24nO1xuaW1wb3J0IHsgSWRsZVJ1bm5lclJlcGVhckZ1bmN0aW9uIH0gZnJvbSAnLi9pZGxlLXJ1bm5lci1yZXBlYXItZnVuY3Rpb24nO1xuaW1wb3J0IHtcbiAgQXdzSW1hZ2VCdWlsZGVyRmFpbGVkQnVpbGROb3RpZmllcixcbiAgQ29kZUJ1aWxkSW1hZ2VCdWlsZGVyRmFpbGVkQnVpbGROb3RpZmllcixcbiAgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIsXG4gIEZhcmdhdGVSdW5uZXJQcm92aWRlcixcbiAgSUNvbXBvc2l0ZVByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIExhbWJkYVJ1bm5lclByb3ZpZGVyLFxuICBQcm92aWRlclJldHJ5T3B0aW9ucyxcbn0gZnJvbSAnLi9wcm92aWRlcnMnO1xuaW1wb3J0IHsgU2VjcmV0cyB9IGZyb20gJy4vc2VjcmV0cyc7XG5pbXBvcnQgeyBTZXR1cEZ1bmN0aW9uIH0gZnJvbSAnLi9zZXR1cC1mdW5jdGlvbic7XG5pbXBvcnQgeyBTdGF0dXNGdW5jdGlvbiB9IGZyb20gJy4vc3RhdHVzLWZ1bmN0aW9uJztcbmltcG9ydCB7IFRva2VuUmV0cmlldmVyRnVuY3Rpb24gfSBmcm9tICcuL3Rva2VuLXJldHJpZXZlci1mdW5jdGlvbic7XG5pbXBvcnQgeyBkaXNjb3ZlckNlcnRpZmljYXRlRmlsZXMsIHNpbmdsZXRvbkxvZ0dyb3VwLCBTaW5nbGV0b25Mb2dUeXBlIH0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQgeyBHaXRodWJXZWJob29rSGFuZGxlciB9IGZyb20gJy4vd2ViaG9vayc7XG5pbXBvcnQgeyBHaXRodWJXZWJob29rUmVkZWxpdmVyeSB9IGZyb20gJy4vd2ViaG9vay1yZWRlbGl2ZXJ5JztcblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBHaXRIdWJSdW5uZXJzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2l0SHViUnVubmVyc1Byb3BzIHtcbiAgLyoqXG4gICAqIExpc3Qgb2YgcnVubmVyIHByb3ZpZGVycyB0byB1c2UuIEF0IGxlYXN0IG9uZSBwcm92aWRlciBpcyByZXF1aXJlZC4gUHJvdmlkZXIgd2lsbCBiZSBzZWxlY3RlZCB3aGVuIGl0cyBsYWJlbCBtYXRjaGVzIHRoZSBsYWJlbHMgcmVxdWVzdGVkIGJ5IHRoZSB3b3JrZmxvdyBqb2IuXG4gICAqXG4gICAqIEBkZWZhdWx0IENvZGVCdWlsZCwgTGFtYmRhIGFuZCBGYXJnYXRlIHJ1bm5lcnMgd2l0aCBhbGwgdGhlIGRlZmF1bHRzIChubyBWUEMgb3IgZGVmYXVsdCBhY2NvdW50IFZQQylcbiAgICovXG4gIHJlYWRvbmx5IHByb3ZpZGVycz86IChJUnVubmVyUHJvdmlkZXIgfCBJQ29tcG9zaXRlUHJvdmlkZXIpW107XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gcmVxdWlyZSB0aGUgYHNlbGYtaG9zdGVkYCBsYWJlbC4gSWYgYHRydWVgLCB0aGUgcnVubmVyIHdpbGwgb25seSBzdGFydCBpZiB0aGUgd29ya2Zsb3cgam9iIGV4cGxpY2l0bHkgcmVxdWVzdHMgdGhlIGBzZWxmLWhvc3RlZGAgbGFiZWwuXG4gICAqXG4gICAqIEJlIGNhcmVmdWwgd2hlbiBzZXR0aW5nIHRoaXMgdG8gYGZhbHNlYC4gQXZvaWQgc2V0dGluZyB1cCBwcm92aWRlcnMgd2l0aCBnZW5lcmljIGxhYmVsIHJlcXVpcmVtZW50cyBsaWtlIGBsaW51eGAgYXMgdGhleSBtYXkgbWF0Y2ggd29ya2Zsb3dzIHRoYXQgYXJlIG5vdCBtZWFudCB0byBydW4gb24gc2VsZi1ob3N0ZWQgcnVubmVycy5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgcmVxdWlyZVNlbGZIb3N0ZWRMYWJlbD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFZQQyB1c2VkIGZvciBhbGwgbWFuYWdlbWVudCBmdW5jdGlvbnMuIFVzZSB0aGlzIHdpdGggR2l0SHViIEVudGVycHJpc2UgU2VydmVyIGhvc3RlZCB0aGF0J3MgaW5hY2Nlc3NpYmxlIGZyb20gb3V0c2lkZSB0aGUgVlBDLlxuICAgKlxuICAgKiAqKk5vdGU6KiogVGhpcyBvbmx5IGFmZmVjdHMgbWFuYWdlbWVudCBmdW5jdGlvbnMgdGhhdCBpbnRlcmFjdCB3aXRoIEdpdEh1Yi4gTGFtYmRhIGZ1bmN0aW9ucyB0aGF0IGhlbHAgd2l0aCBydW5uZXIgaW1hZ2UgYnVpbGRpbmcgYW5kIGRvbid0IGludGVyYWN0IHdpdGggR2l0SHViIGFyZSBOT1QgYWZmZWN0ZWQgYnkgdGhpcyBzZXR0aW5nIGFuZCB3aWxsIHJ1biBvdXRzaWRlIHRoZSBWUEMuXG4gICAqXG4gICAqIE1ha2Ugc3VyZSB0aGUgc2VsZWN0ZWQgVlBDIGFuZCBzdWJuZXRzIGhhdmUgYWNjZXNzIHRvIHRoZSBmb2xsb3dpbmcgd2l0aCBlaXRoZXIgTkFUIEdhdGV3YXkgb3IgVlBDIEVuZHBvaW50czpcbiAgICogKiBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXJcbiAgICogKiBTZWNyZXRzIE1hbmFnZXJcbiAgICogKiBTUVNcbiAgICogKiBTdGVwIEZ1bmN0aW9uc1xuICAgKiAqIENsb3VkRm9ybWF0aW9uIChzdGF0dXMgZnVuY3Rpb24gb25seSlcbiAgICogKiBFQzIgKHN0YXR1cyBmdW5jdGlvbiBvbmx5KVxuICAgKiAqIEVDUiAoc3RhdHVzIGZ1bmN0aW9uIG9ubHkpXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogVlBDIHN1Ym5ldHMgdXNlZCBmb3IgYWxsIG1hbmFnZW1lbnQgZnVuY3Rpb25zLiBVc2UgdGhpcyB3aXRoIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciBob3N0ZWQgdGhhdCdzIGluYWNjZXNzaWJsZSBmcm9tIG91dHNpZGUgdGhlIFZQQy5cbiAgICpcbiAgICogKipOb3RlOioqIFRoaXMgb25seSBhZmZlY3RzIG1hbmFnZW1lbnQgZnVuY3Rpb25zIHRoYXQgaW50ZXJhY3Qgd2l0aCBHaXRIdWIuIExhbWJkYSBmdW5jdGlvbnMgdGhhdCBoZWxwIHdpdGggcnVubmVyIGltYWdlIGJ1aWxkaW5nIGFuZCBkb24ndCBpbnRlcmFjdCB3aXRoIEdpdEh1YiBhcmUgTk9UIGFmZmVjdGVkIGJ5IHRoaXMgc2V0dGluZy5cbiAgICovXG4gIHJlYWRvbmx5IHZwY1N1Ym5ldHM/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBBbGxvdyBtYW5hZ2VtZW50IGZ1bmN0aW9ucyB0byBydW4gaW4gcHVibGljIHN1Ym5ldHMuIExhbWJkYSBGdW5jdGlvbnMgaW4gYSBwdWJsaWMgc3VibmV0IGNhbiBOT1QgYWNjZXNzIHRoZSBpbnRlcm5ldC5cbiAgICpcbiAgICogKipOb3RlOioqIFRoaXMgb25seSBhZmZlY3RzIG1hbmFnZW1lbnQgZnVuY3Rpb25zIHRoYXQgaW50ZXJhY3Qgd2l0aCBHaXRIdWIuIExhbWJkYSBmdW5jdGlvbnMgdGhhdCBoZWxwIHdpdGggcnVubmVyIGltYWdlIGJ1aWxkaW5nIGFuZCBkb24ndCBpbnRlcmFjdCB3aXRoIEdpdEh1YiBhcmUgTk9UIGFmZmVjdGVkIGJ5IHRoaXMgc2V0dGluZy5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGFsbG93UHVibGljU3VibmV0PzogYm9vbGVhbjtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXAgYXR0YWNoZWQgdG8gYWxsIG1hbmFnZW1lbnQgZnVuY3Rpb25zLiBVc2UgdGhpcyB3aXRoIHRvIHByb3ZpZGUgYWNjZXNzIHRvIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciBob3N0ZWQgaW5zaWRlIGEgVlBDLlxuICAgKlxuICAgKiAqKk5vdGU6KiogVGhpcyBvbmx5IGFmZmVjdHMgbWFuYWdlbWVudCBmdW5jdGlvbnMgdGhhdCBpbnRlcmFjdCB3aXRoIEdpdEh1Yi4gTGFtYmRhIGZ1bmN0aW9ucyB0aGF0IGhlbHAgd2l0aCBydW5uZXIgaW1hZ2UgYnVpbGRpbmcgYW5kIGRvbid0IGludGVyYWN0IHdpdGggR2l0SHViIGFyZSBOT1QgYWZmZWN0ZWQgYnkgdGhpcyBzZXR0aW5nLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIHNlY3VyaXR5R3JvdXBzfSBpbnN0ZWFkXG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwPzogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgYXR0YWNoZWQgdG8gYWxsIG1hbmFnZW1lbnQgZnVuY3Rpb25zLiBVc2UgdGhpcyB0byBwcm92aWRlIG91dGJvdW5kIGFjY2VzcyBmcm9tIG1hbmFnZW1lbnQgZnVuY3Rpb25zIHRvIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciBob3N0ZWQgaW5zaWRlIGEgVlBDLlxuICAgKlxuICAgKiAqKk5vdGU6KiogVGhpcyBvbmx5IGFmZmVjdHMgbWFuYWdlbWVudCBmdW5jdGlvbnMgdGhhdCBpbnRlcmFjdCB3aXRoIEdpdEh1Yi4gTGFtYmRhIGZ1bmN0aW9ucyB0aGF0IGhlbHAgd2l0aCBydW5uZXIgaW1hZ2UgYnVpbGRpbmcgYW5kIGRvbid0IGludGVyYWN0IHdpdGggR2l0SHViIGFyZSBOT1QgYWZmZWN0ZWQgYnkgdGhpcyBzZXR0aW5nLlxuICAgKlxuICAgKiAqKk5vdGU6KiogRGVmaW5pbmcgaW5ib3VuZCBydWxlcyBvbiB0aGlzIHNlY3VyaXR5IGdyb3VwIGRvZXMgbm90aGluZy4gVGhpcyBzZWN1cml0eSBncm91cCBvbmx5IGNvbnRyb2xzIG91dGJvdW5kIGFjY2VzcyBGUk9NIHRoZSBtYW5hZ2VtZW50IGZ1bmN0aW9ucy4gVG8gbGltaXQgYWNjZXNzIFRPIHRoZSB3ZWJob29rIG9yIHNldHVwIGZ1bmN0aW9ucywgdXNlIHtAbGluayB3ZWJob29rQWNjZXNzfSBhbmQge0BsaW5rIHNldHVwQWNjZXNzfSBpbnN0ZWFkLlxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogUGF0aCB0byBhIGNlcnRpZmljYXRlIGZpbGUgKC5wZW0gb3IgLmNydCkgb3IgYSBkaXJlY3RvcnkgY29udGFpbmluZyBjZXJ0aWZpY2F0ZSBmaWxlcyAoLnBlbSBvciAuY3J0KSByZXF1aXJlZCB0byB0cnVzdCBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIuIFVzZSB0aGlzIHdoZW4gR2l0SHViIEVudGVycHJpc2UgU2VydmVyIGNlcnRpZmljYXRlcyBhcmUgc2VsZi1zaWduZWQuXG4gICAqXG4gICAqIElmIGEgZGlyZWN0b3J5IGlzIHByb3ZpZGVkLCBhbGwgLnBlbSBhbmQgLmNydCBmaWxlcyBpbiB0aGF0IGRpcmVjdG9yeSB3aWxsIGJlIHVzZWQuIFRoZSBjZXJ0aWZpY2F0ZXMgd2lsbCBiZSBjb25jYXRlbmF0ZWQgaW50byBhIHNpbmdsZSBmaWxlIGZvciB1c2UgYnkgTm9kZS5qcy5cbiAgICpcbiAgICogWW91IG1heSBhbHNvIHdhbnQgdG8gdXNlIGN1c3RvbSBpbWFnZXMgZm9yIHlvdXIgcnVubmVyIHByb3ZpZGVycyB0aGF0IGNvbnRhaW4gdGhlIHNhbWUgY2VydGlmaWNhdGVzLiBTZWUge0BsaW5rIFJ1bm5lckltYWdlQ29tcG9uZW50LmV4dHJhQ2VydGlmaWNhdGVzfS5cbiAgICpcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBjb25zdCBzZWxmU2lnbmVkQ2VydGlmaWNhdGVzID0gJ2NlcnRzL2doZXMucGVtJzsgLy8gb3IgJ3BhdGgtdG8tbXktZXh0cmEtY2VydHMtZm9sZGVyJyBmb3IgYSBkaXJlY3RvcnlcbiAgICogY29uc3QgaW1hZ2VCdWlsZGVyID0gQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKHRoaXMsICdJbWFnZSBCdWlsZGVyIHdpdGggQ2VydHMnKTtcbiAgICogaW1hZ2VCdWlsZGVyLmFkZENvbXBvbmVudChSdW5uZXJJbWFnZUNvbXBvbmVudC5leHRyYUNlcnRpZmljYXRlcyhzZWxmU2lnbmVkQ2VydGlmaWNhdGVzLCAncHJpdmF0ZS1jYScpKTtcbiAgICpcbiAgICogY29uc3QgcHJvdmlkZXIgPSBuZXcgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIodGhpcywgJ0NvZGVCdWlsZCcsIHtcbiAgICogICAgIGltYWdlQnVpbGRlcjogaW1hZ2VCdWlsZGVyLFxuICAgKiB9KTtcbiAgICpcbiAgICogbmV3IEdpdEh1YlJ1bm5lcnMoXG4gICAqICAgdGhpcyxcbiAgICogICAncnVubmVycycsXG4gICAqICAge1xuICAgKiAgICAgcHJvdmlkZXJzOiBbcHJvdmlkZXJdLFxuICAgKiAgICAgZXh0cmFDZXJ0aWZpY2F0ZXM6IHNlbGZTaWduZWRDZXJ0aWZpY2F0ZXMsXG4gICAqICAgfVxuICAgKiApO1xuICAgKiBgYGBcbiAgICovXG4gIHJlYWRvbmx5IGV4dHJhQ2VydGlmaWNhdGVzPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaW1lIHRvIHdhaXQgYmVmb3JlIHN0b3BwaW5nIGEgcnVubmVyIHRoYXQgcmVtYWlucyBpZGxlLiBJZiB0aGUgdXNlciBjYW5jZWxsZWQgdGhlIGpvYiwgb3IgaWYgYW5vdGhlciBydW5uZXIgc3RvbGUgaXQsIHRoaXMgc3RvcHMgdGhlIHJ1bm5lciB0byBhdm9pZCB3YXN0aW5nIHJlc291cmNlcy5cbiAgICpcbiAgICogQGRlZmF1bHQgNSBtaW51dGVzXG4gICAqL1xuICByZWFkb25seSBpZGxlVGltZW91dD86IGNkay5EdXJhdGlvbjtcblxuICAvKipcbiAgICogTG9nZ2luZyBvcHRpb25zIGZvciB0aGUgc3RhdGUgbWFjaGluZSB0aGF0IG1hbmFnZXMgdGhlIHJ1bm5lcnMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIGxvZ3NcbiAgICovXG4gIHJlYWRvbmx5IGxvZ09wdGlvbnM/OiBMb2dPcHRpb25zO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgY29uZmlndXJhdGlvbiBmb3IgdGhlIHNldHVwIGZ1bmN0aW9uLiBPbmNlIHlvdSBmaW5pc2ggdGhlIHNldHVwIHByb2Nlc3MsIHlvdSBjYW4gc2V0IHRoaXMgdG8gYExhbWJkYUFjY2Vzcy5ub0FjY2VzcygpYCB0byByZW1vdmUgYWNjZXNzIHRvIHRoZSBzZXR1cCBmdW5jdGlvbi4gWW91IGNhbiBhbHNvIHVzZSBgTGFtYmRhQWNjZXNzLmFwaUdhdGV3YXkoeyBhbGxvd2VkSXBzOiBbJ215LWlwLzAnXX0pYCB0byBsaW1pdCBhY2Nlc3MgdG8geW91ciBJUCBvbmx5LlxuICAgKlxuICAgKiBAZGVmYXVsdCBMYW1iZGFBY2Nlc3MubGFtYmRhVXJsKClcbiAgICovXG4gIHJlYWRvbmx5IHNldHVwQWNjZXNzPzogTGFtYmRhQWNjZXNzO1xuXG5cbiAgLyoqXG4gICAqIEFjY2VzcyBjb25maWd1cmF0aW9uIGZvciB0aGUgd2ViaG9vayBmdW5jdGlvbi4gVGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgYnkgR2l0SHViIHdoZW4gYSBuZXcgd29ya2Zsb3cgam9iIGlzIHNjaGVkdWxlZC4gRm9yIGFuIGV4dHJhIGxheWVyIG9mIHNlY3VyaXR5LCB5b3UgY2FuIHNldCB0aGlzIHRvIGBMYW1iZGFBY2Nlc3MuYXBpR2F0ZXdheSh7IGFsbG93ZWRJcHM6IExhbWJkYUFjY2Vzcy5naXRodWJXZWJob29rSXBzKCkgfSlgLlxuICAgKlxuICAgKiBZb3UgY2FuIGFsc28gc2V0IHRoaXMgdG8gYExhbWJkYUFjY2Vzcy5hcGlHYXRld2F5KHthbGxvd2VkVnBjOiB2cGMsIGFsbG93ZWRJcHM6IFsnR0hFUy5JUC5BRERSRVNTLzMyJ119KWAgaWYgeW91ciBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgaXMgaG9zdGVkIGluIGEgVlBDLiBUaGlzIHdpbGwgY3JlYXRlIGFuIEFQSSBHYXRld2F5IGVuZHBvaW50IHRoYXQncyBvbmx5IGFjY2Vzc2libGUgZnJvbSB3aXRoaW4gdGhlIFZQQy5cbiAgICpcbiAgICogKldBUk5JTkcqOiBjaGFuZ2luZyBhY2Nlc3MgdHlwZSBtYXkgY2hhbmdlIHRoZSBVUkwuIFdoZW4gdGhlIFVSTCBjaGFuZ2VzLCB5b3UgbXVzdCB1cGRhdGUgR2l0SHViIGFzIHdlbGwuXG4gICAqXG4gICAqIEBkZWZhdWx0IExhbWJkYUFjY2Vzcy5sYW1iZGFVcmwoKVxuICAgKi9cbiAgcmVhZG9ubHkgd2ViaG9va0FjY2Vzcz86IExhbWJkYUFjY2VzcztcblxuICAvKipcbiAgICogQWNjZXNzIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBzdGF0dXMgZnVuY3Rpb24uIFRoaXMgZnVuY3Rpb24gcmV0dXJucyBhIGxvdCBvZiBzZW5zaXRpdmUgaW5mb3JtYXRpb24gYWJvdXQgdGhlIHJ1bm5lciwgc28geW91IHNob3VsZCBvbmx5IGFsbG93IGFjY2VzcyB0byBpdCBmcm9tIHRydXN0ZWQgSVBzLCBpZiBhdCBhbGwuXG4gICAqXG4gICAqIEBkZWZhdWx0IExhbWJkYUFjY2Vzcy5ub0FjY2VzcygpXG4gICAqL1xuICByZWFkb25seSBzdGF0dXNBY2Nlc3M/OiBMYW1iZGFBY2Nlc3M7XG5cbiAgLyoqXG4gICAqIE9wdGlvbnMgdG8gcmV0cnkgb3BlcmF0aW9uIGluIGNhc2Ugb2YgZmFpbHVyZSBsaWtlIG1pc3NpbmcgY2FwYWNpdHksIG9yIEFQSSBxdW90YSBpc3N1ZXMuXG4gICAqXG4gICAqIEdpdEh1YiBqb2JzIHRpbWUgb3V0IGFmdGVyIG5vdCBiZWluZyBhYmxlIHRvIGdldCBhIHJ1bm5lciBmb3IgMjQgaG91cnMuIFlvdSBzaG91bGQgbm90IHJldHJ5IGZvciBtb3JlIHRoYW4gMjQgaG91cnMuXG4gICAqXG4gICAqIFRvdGFsIHRpbWUgc3BlbnQgd2FpdGluZyBjYW4gYmUgY2FsY3VsYXRlZCB3aXRoIGludGVydmFsICogKGJhY2tvZmZSYXRlIF4gbWF4QXR0ZW1wdHMpIC8gKGJhY2tvZmZSYXRlIC0gMSkuXG4gICAqXG4gICAqIEBkZWZhdWx0IHJldHJ5IDIzIHRpbWVzIHVwIHRvIGFib3V0IDI0IGhvdXJzXG4gICAqL1xuICByZWFkb25seSByZXRyeU9wdGlvbnM/OiBQcm92aWRlclJldHJ5T3B0aW9ucztcblxuICAvKipcbiAgICogT3B0aW9uYWwgTGFtYmRhIGZ1bmN0aW9uIHRvIGN1c3RvbWl6ZSBwcm92aWRlciBzZWxlY3Rpb24gbG9naWMgYW5kIGxhYmVsIGFzc2lnbm1lbnQuXG4gICAqXG4gICAqICogVGhlIGZ1bmN0aW9uIHJlY2VpdmVzIHRoZSB3ZWJob29rIHBheWxvYWQgYWxvbmcgd2l0aCBkZWZhdWx0IHByb3ZpZGVyIGFuZCBpdHMgbGFiZWxzIGFzIHtAbGluayBQcm92aWRlclNlbGVjdG9ySW5wdXR9XG4gICAqICogVGhlIGZ1bmN0aW9uIHJldHVybnMgYSBzZWxlY3RlZCBwcm92aWRlciBhbmQgaXRzIGxhYmVscyBhcyB7QGxpbmsgUHJvdmlkZXJTZWxlY3RvclJlc3VsdH1cbiAgICogKiBZb3UgY2FuIGRlY2xpbmUgdG8gcHJvdmlzaW9uIGEgcnVubmVyIGJ5IHJldHVybmluZyB1bmRlZmluZWQgYXMgdGhlIHByb3ZpZGVyIHNlbGVjdG9yIHJlc3VsdFxuICAgKiAqIFlvdSBjYW4gZnVsbHkgY3VzdG9taXplIHRoZSBsYWJlbHMgZm9yIHRoZSBhYm91dC10by1iZS1wcm92aXNpb25lZCBydW5uZXIgKGFkZCwgcmVtb3ZlLCBtb2RpZnksIGR5bmFtaWMgbGFiZWxzLCBldGMuKVxuICAgKiAqIExhYmVscyBkb24ndCBoYXZlIHRvIG1hdGNoIHRoZSBsYWJlbHMgb3JpZ2luYWxseSBjb25maWd1cmVkIGZvciB0aGUgcHJvdmlkZXIsIGJ1dCBzZWUgd2FybmluZ3MgYmVsb3dcbiAgICogKiBUaGlzIGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIHN5bmNocm9ub3VzbHkgZHVyaW5nIHdlYmhvb2sgcHJvY2Vzc2luZywgc28gaXQgc2hvdWxkIGJlIGZhc3QgYW5kIGVmZmljaWVudCAod2ViaG9vayBsaW1pdCBpcyAzMCBzZWNvbmRzIHRvdGFsKVxuICAgKlxuICAgKiAqKldBUk5JTkc6IEl0IGlzIHlvdXIgcmVzcG9uc2liaWxpdHkgdG8gZW5zdXJlIHRoZSBzZWxlY3RlZCBwcm92aWRlcidzIGxhYmVscyBtYXRjaCB0aGUgam9iJ3MgcmVxdWlyZWQgbGFiZWxzLiBJZiB5b3UgcmV0dXJuIHRoZSB3cm9uZyBsYWJlbHMsIHRoZSBydW5uZXIgd2lsbCBiZSBjcmVhdGVkIGJ1dCBHaXRIdWIgQWN0aW9ucyB3aWxsIG5vdCBhc3NpZ24gdGhlIGpvYiB0byBpdC4qKlxuICAgKlxuICAgKiAqKldBUk5JTkc6IFByb3ZpZGVyIHNlbGVjdGlvbiBpcyBub3QgYSBndWFyYW50ZWUgdGhhdCBhIHNwZWNpZmljIHByb3ZpZGVyIHdpbGwgYmUgYXNzaWduZWQgZm9yIHRoZSBqb2IuIEdpdEh1YiBBY3Rpb25zIG1heSBhc3NpZ24gdGhlIGpvYiB0byBhbnkgcnVubmVyIHdpdGggbWF0Y2hpbmcgbGFiZWxzLiBUaGUgcHJvdmlkZXIgc2VsZWN0b3Igb25seSBkZXRlcm1pbmVzIHdoaWNoIHByb3ZpZGVyJ3MgcnVubmVyIHdpbGwgYmUgKmNyZWF0ZWQqLCBidXQgR2l0SHViIEFjdGlvbnMgbWF5IHJvdXRlIHRoZSBqb2IgdG8gYW55IGF2YWlsYWJsZSBydW5uZXIgd2l0aCB0aGUgcmVxdWlyZWQgbGFiZWxzLioqXG4gICAqXG4gICAqICoqRm9yIHJlbGlhYmxlIHByb3ZpZGVyIGFzc2lnbm1lbnQgYmFzZWQgb24gam9iIGNoYXJhY3RlcmlzdGljcywgY29uc2lkZXIgdXNpbmcgcmVwby1sZXZlbCBydW5uZXIgcmVnaXN0cmF0aW9uIHdoZXJlIHlvdSBjYW4gY29udHJvbCB3aGljaCBydW5uZXJzIGFyZSBhdmFpbGFibGUgZm9yIHNwZWNpZmljIHJlcG9zaXRvcmllcy4gU2VlIHtAbGluayBTRVRVUF9HSVRIVUIubWR9IGZvciBtb3JlIGRldGFpbHMgb24gdGhlIGRpZmZlcmVudCByZWdpc3RyYXRpb24gbGV2ZWxzLiBUaGlzIGluZm9ybWF0aW9uIGlzIGFsc28gYXZhaWxhYmxlIHdoaWxlIHVzaW5nIHRoZSBzZXR1cCB3aXphcmQuXG4gICAqL1xuICByZWFkb25seSBwcm92aWRlclNlbGVjdG9yPzogbGFtYmRhLklGdW5jdGlvbjtcbn1cblxuLyoqXG4gKiBEZWZpbmVzIHdoYXQgZXhlY3V0aW9uIGhpc3RvcnkgZXZlbnRzIGFyZSBsb2dnZWQgYW5kIHdoZXJlIHRoZXkgYXJlIGxvZ2dlZC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2dPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSBsb2cgZ3JvdXAgd2hlcmUgdGhlIGV4ZWN1dGlvbiBoaXN0b3J5IGV2ZW50cyB3aWxsIGJlIGxvZ2dlZC5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwTmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogRGV0ZXJtaW5lcyB3aGV0aGVyIGV4ZWN1dGlvbiBkYXRhIGlzIGluY2x1ZGVkIGluIHlvdXIgbG9nLlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgaW5jbHVkZUV4ZWN1dGlvbkRhdGE/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBEZWZpbmVzIHdoaWNoIGNhdGVnb3J5IG9mIGV4ZWN1dGlvbiBoaXN0b3J5IGV2ZW50cyBhcmUgbG9nZ2VkLlxuICAgKlxuICAgKiBAZGVmYXVsdCBFUlJPUlxuICAgKi9cbiAgcmVhZG9ubHkgbGV2ZWw/OiBzdGVwZnVuY3Rpb25zLkxvZ0xldmVsO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGRheXMgbG9nIGV2ZW50cyBhcmUga2VwdCBpbiBDbG91ZFdhdGNoIExvZ3MuIFdoZW4gdXBkYXRpbmdcbiAgICogdGhpcyBwcm9wZXJ0eSwgdW5zZXR0aW5nIGl0IGRvZXNuJ3QgcmVtb3ZlIHRoZSBsb2cgcmV0ZW50aW9uIHBvbGljeS4gVG9cbiAgICogcmVtb3ZlIHRoZSByZXRlbnRpb24gcG9saWN5LCBzZXQgdGhlIHZhbHVlIHRvIGBJTkZJTklURWAuXG4gICAqXG4gICAqIEBkZWZhdWx0IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEhcbiAgICovXG4gIHJlYWRvbmx5IGxvZ1JldGVudGlvbj86IGxvZ3MuUmV0ZW50aW9uRGF5cztcbn1cblxuLyoqXG4gKiBDcmVhdGUgYWxsIHRoZSByZXF1aXJlZCBpbmZyYXN0cnVjdHVyZSB0byBwcm92aWRlIHNlbGYtaG9zdGVkIEdpdEh1YiBydW5uZXJzLiBJdCBjcmVhdGVzIGEgd2ViaG9vaywgc2VjcmV0cywgYW5kIGEgc3RlcCBmdW5jdGlvbiB0byBvcmNoZXN0cmF0ZSBhbGwgcnVucy4gU2VjcmV0cyBhcmUgbm90IGF1dG9tYXRpY2FsbHkgZmlsbGVkLiBTZWUgUkVBRE1FLm1kIGZvciBpbnN0cnVjdGlvbnMgb24gaG93IHRvIHNldHVwIEdpdEh1YiBpbnRlZ3JhdGlvbi5cbiAqXG4gKiBCeSBkZWZhdWx0LCB0aGlzIHdpbGwgY3JlYXRlIGEgcnVubmVyIHByb3ZpZGVyIG9mIGVhY2ggYXZhaWxhYmxlIHR5cGUgd2l0aCB0aGUgZGVmYXVsdHMuIFRoaXMgaXMgZ29vZCBlbm91Z2ggZm9yIHRoZSBpbml0aWFsIHNldHVwIHN0YWdlIHdoZW4geW91IGp1c3Qgd2FudCB0byBnZXQgR2l0SHViIGludGVncmF0aW9uIHdvcmtpbmcuXG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogbmV3IEdpdEh1YlJ1bm5lcnModGhpcywgJ3J1bm5lcnMnKTtcbiAqIGBgYFxuICpcbiAqIFVzdWFsbHkgeW91J2Qgd2FudCB0byBjb25maWd1cmUgdGhlIHJ1bm5lciBwcm92aWRlcnMgc28gdGhlIHJ1bm5lcnMgY2FuIHJ1biBpbiBhIGNlcnRhaW4gVlBDIG9yIGhhdmUgY2VydGFpbiBwZXJtaXNzaW9ucy5cbiAqXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCB2cGMgPSBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ3ZwYycsIHsgdnBjSWQ6ICd2cGMtMTIzNDU2NycgfSk7XG4gKiBjb25zdCBydW5uZXJTZyA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAncnVubmVyIHNlY3VyaXR5IGdyb3VwJywgeyB2cGM6IHZwYyB9KTtcbiAqIGNvbnN0IGRiU2cgPSBlYzIuU2VjdXJpdHlHcm91cC5mcm9tU2VjdXJpdHlHcm91cElkKHRoaXMsICdkYXRhYmFzZSBzZWN1cml0eSBncm91cCcsICdzZy0xMjM0NTY3Jyk7XG4gKiBjb25zdCBidWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdydW5uZXIgYnVja2V0Jyk7XG4gKlxuICogLy8gY3JlYXRlIGEgY3VzdG9tIENvZGVCdWlsZCBwcm92aWRlclxuICogY29uc3QgbXlQcm92aWRlciA9IG5ldyBDb2RlQnVpbGRSdW5uZXJQcm92aWRlcihcbiAqICAgdGhpcywgJ2NvZGVidWlsZCBydW5uZXInLFxuICogICB7XG4gKiAgICAgIGxhYmVsczogWydteS1jb2RlYnVpbGQnXSxcbiAqICAgICAgdnBjOiB2cGMsXG4gKiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbcnVubmVyU2ddLFxuICogICB9LFxuICogKTtcbiAqIC8vIGdyYW50IHNvbWUgcGVybWlzc2lvbnMgdG8gdGhlIHByb3ZpZGVyXG4gKiBidWNrZXQuZ3JhbnRSZWFkV3JpdGUobXlQcm92aWRlcik7XG4gKiBkYlNnLmNvbm5lY3Rpb25zLmFsbG93RnJvbShydW5uZXJTZywgZWMyLlBvcnQudGNwKDMzMDYpLCAnYWxsb3cgcnVubmVycyB0byBjb25uZWN0IHRvIE15U1FMIGRhdGFiYXNlJyk7XG4gKlxuICogLy8gY3JlYXRlIHRoZSBydW5uZXIgaW5mcmFzdHJ1Y3R1cmVcbiAqIG5ldyBHaXRIdWJSdW5uZXJzKFxuICogICB0aGlzLFxuICogICAncnVubmVycycsXG4gKiAgIHtcbiAqICAgICBwcm92aWRlcnM6IFtteVByb3ZpZGVyXSxcbiAqICAgfVxuICogKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgR2l0SHViUnVubmVycyBleHRlbmRzIENvbnN0cnVjdCBpbXBsZW1lbnRzIGVjMi5JQ29ubmVjdGFibGUge1xuICAvKipcbiAgICogQ29uZmlndXJlZCBydW5uZXIgcHJvdmlkZXJzLlxuICAgKi9cbiAgcmVhZG9ubHkgcHJvdmlkZXJzOiAoSVJ1bm5lclByb3ZpZGVyIHwgSUNvbXBvc2l0ZVByb3ZpZGVyKVtdO1xuXG4gIC8qKlxuICAgKiBTZWNyZXRzIGZvciBHaXRIdWIgY29tbXVuaWNhdGlvbiBpbmNsdWRpbmcgd2ViaG9vayBzZWNyZXQgYW5kIHJ1bm5lciBhdXRoZW50aWNhdGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IHNlY3JldHM6IFNlY3JldHM7XG5cbiAgLyoqXG4gICAqIE1hbmFnZSB0aGUgY29ubmVjdGlvbnMgb2YgYWxsIG1hbmFnZW1lbnQgZnVuY3Rpb25zLiBVc2UgdGhpcyB0byBlbmFibGUgY29ubmVjdGlvbnMgdG8geW91ciBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgaW4gYSBWUEMuXG4gICAqXG4gICAqIFRoaXMgY2Fubm90IGJlIHVzZWQgdG8gbWFuYWdlIGNvbm5lY3Rpb25zIG9mIHRoZSBydW5uZXJzLiBVc2UgdGhlIGBjb25uZWN0aW9uc2AgcHJvcGVydHkgb2YgZWFjaCBydW5uZXIgcHJvdmlkZXIgdG8gbWFuYWdlIHJ1bm5lciBjb25uZWN0aW9ucy5cbiAgICovXG4gIHJlYWRvbmx5IGNvbm5lY3Rpb25zOiBlYzIuQ29ubmVjdGlvbnM7XG5cbiAgcHJpdmF0ZSByZWFkb25seSB3ZWJob29rOiBHaXRodWJXZWJob29rSGFuZGxlcjtcbiAgcHJpdmF0ZSByZWFkb25seSByZWRlbGl2ZXJlcjogR2l0aHViV2ViaG9va1JlZGVsaXZlcnk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3JjaGVzdHJhdG9yOiBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZTtcbiAgcHJpdmF0ZSByZWFkb25seSBzZXR1cFVybDogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGV4dHJhTGFtYmRhRW52OiB7IFtwOiBzdHJpbmddOiBzdHJpbmcgfSA9IHt9O1xuICBwcml2YXRlIHJlYWRvbmx5IGV4dHJhTGFtYmRhUHJvcHM6IGxhbWJkYS5GdW5jdGlvbk9wdGlvbnM7XG4gIHByaXZhdGUgc3RhdGVNYWNoaW5lTG9nR3JvdXA/OiBsb2dzLkxvZ0dyb3VwO1xuICBwcml2YXRlIGpvYnNDb21wbGV0ZWRNZXRyaWNGaWx0ZXJzSW5pdGlhbGl6ZWQgPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCByZWFkb25seSBwcm9wcz86IEdpdEh1YlJ1bm5lcnNQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICB0aGlzLnNlY3JldHMgPSBuZXcgU2VjcmV0cyh0aGlzLCAnU2VjcmV0cycpO1xuXG4gICAgdGhpcy5leHRyYUxhbWJkYVByb3BzID0ge1xuICAgICAgdnBjOiB0aGlzLnByb3BzPy52cGMsXG4gICAgICB2cGNTdWJuZXRzOiB0aGlzLnByb3BzPy52cGNTdWJuZXRzLFxuICAgICAgYWxsb3dQdWJsaWNTdWJuZXQ6IHRoaXMucHJvcHM/LmFsbG93UHVibGljU3VibmV0LFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMubGFtYmRhU2VjdXJpdHlHcm91cHMoKSxcbiAgICAgIGxheWVyczogW10sXG4gICAgfTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zID0gbmV3IGVjMi5Db25uZWN0aW9ucyh7IHNlY3VyaXR5R3JvdXBzOiB0aGlzLmV4dHJhTGFtYmRhUHJvcHMuc2VjdXJpdHlHcm91cHMgfSk7XG5cbiAgICB0aGlzLmNyZWF0ZUNlcnRpZmljYXRlTGF5ZXIoc2NvcGUpO1xuXG4gICAgaWYgKHRoaXMucHJvcHM/LnByb3ZpZGVycykge1xuICAgICAgdGhpcy5wcm92aWRlcnMgPSB0aGlzLnByb3BzLnByb3ZpZGVycztcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5wcm92aWRlcnMgPSBbXG4gICAgICAgIG5ldyBDb2RlQnVpbGRSdW5uZXJQcm92aWRlcih0aGlzLCAnQ29kZUJ1aWxkJyksXG4gICAgICAgIG5ldyBMYW1iZGFSdW5uZXJQcm92aWRlcih0aGlzLCAnTGFtYmRhJyksXG4gICAgICAgIG5ldyBGYXJnYXRlUnVubmVyUHJvdmlkZXIodGhpcywgJ0ZhcmdhdGUnKSxcbiAgICAgIF07XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucHJvdmlkZXJzLmxlbmd0aCA9PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0F0IGxlYXN0IG9uZSBydW5uZXIgcHJvdmlkZXIgaXMgcmVxdWlyZWQnKTtcbiAgICB9XG5cbiAgICB0aGlzLmNoZWNrSW50ZXJzZWN0aW5nTGFiZWxzKCk7XG5cbiAgICB0aGlzLm9yY2hlc3RyYXRvciA9IHRoaXMuc3RhdGVNYWNoaW5lKHByb3BzKTtcbiAgICB0aGlzLndlYmhvb2sgPSBuZXcgR2l0aHViV2ViaG9va0hhbmRsZXIodGhpcywgJ1dlYmhvb2sgSGFuZGxlcicsIHtcbiAgICAgIG9yY2hlc3RyYXRvcjogdGhpcy5vcmNoZXN0cmF0b3IsXG4gICAgICBzZWNyZXRzOiB0aGlzLnNlY3JldHMsXG4gICAgICBhY2Nlc3M6IHRoaXMucHJvcHM/LndlYmhvb2tBY2Nlc3MgPz8gTGFtYmRhQWNjZXNzLmxhbWJkYVVybCgpLFxuICAgICAgcHJvdmlkZXJzOiB0aGlzLnByb3ZpZGVycy5yZWR1Y2U8UmVjb3JkPHN0cmluZywgc3RyaW5nW10+PigoYWNjLCBwKSA9PiB7XG4gICAgICAgIGFjY1twLm5vZGUucGF0aF0gPSBwLmxhYmVscztcbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgIH0sIHt9KSxcbiAgICAgIHJlcXVpcmVTZWxmSG9zdGVkTGFiZWw6IHRoaXMucHJvcHM/LnJlcXVpcmVTZWxmSG9zdGVkTGFiZWwgPz8gdHJ1ZSxcbiAgICAgIHByb3ZpZGVyU2VsZWN0b3I6IHRoaXMucHJvcHM/LnByb3ZpZGVyU2VsZWN0b3IsXG4gICAgICBleHRyYUxhbWJkYVByb3BzOiB0aGlzLmV4dHJhTGFtYmRhUHJvcHMsXG4gICAgICBleHRyYUxhbWJkYUVudjogdGhpcy5leHRyYUxhbWJkYUVudixcbiAgICB9KTtcbiAgICB0aGlzLnJlZGVsaXZlcmVyID0gbmV3IEdpdGh1YldlYmhvb2tSZWRlbGl2ZXJ5KHRoaXMsICdXZWJob29rIFJlZGVsaXZlcnknLCB7XG4gICAgICBzZWNyZXRzOiB0aGlzLnNlY3JldHMsXG4gICAgICBleHRyYUxhbWJkYVByb3BzOiB0aGlzLmV4dHJhTGFtYmRhUHJvcHMsXG4gICAgICBleHRyYUxhbWJkYUVudjogdGhpcy5leHRyYUxhbWJkYUVudixcbiAgICB9KTtcblxuICAgIHRoaXMuc2V0dXBVcmwgPSB0aGlzLnNldHVwRnVuY3Rpb24oKTtcbiAgICB0aGlzLnN0YXR1c0Z1bmN0aW9uKCk7XG4gIH1cblxuICBwcml2YXRlIHN0YXRlTWFjaGluZShwcm9wcz86IEdpdEh1YlJ1bm5lcnNQcm9wcykge1xuICAgIGNvbnN0IHRva2VuUmV0cmlldmVyVGFzayA9IG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLkxhbWJkYUludm9rZShcbiAgICAgIHRoaXMsXG4gICAgICAnR2V0IFJ1bm5lciBUb2tlbicsXG4gICAgICB7XG4gICAgICAgIGxhbWJkYUZ1bmN0aW9uOiB0aGlzLnRva2VuUmV0cmlldmVyKCksXG4gICAgICAgIHBheWxvYWRSZXNwb25zZU9ubHk6IHRydWUsXG4gICAgICAgIHJlc3VsdFBhdGg6ICckLnJ1bm5lcicsXG4gICAgICAgIHBheWxvYWQ6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICAgICdvd25lci4kJzogJyQub3duZXInLFxuICAgICAgICAgICdyZXBvLiQnOiAnJC5yZXBvJyxcbiAgICAgICAgICAnaW5zdGFsbGF0aW9uSWQuJCc6ICckLmluc3RhbGxhdGlvbklkJyxcbiAgICAgICAgICAnbGFiZWxzLiQnOiAnJC5sYWJlbHMnLFxuICAgICAgICAgICdqb2JJZC4kJzogJyQuam9iSWQnLFxuICAgICAgICAgICdydW5uZXJOYW1lLiQnOiAnJCQuRXhlY3V0aW9uLk5hbWUnLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGxldCBkZWxldGVGYWlsZWRSdW5uZXJGdW5jdGlvbiA9IHRoaXMuZGVsZXRlRmFpbGVkUnVubmVyKCk7XG4gICAgY29uc3QgZGVsZXRlRmFpbGVkUnVubmVyVGFzayA9IG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLkxhbWJkYUludm9rZShcbiAgICAgIHRoaXMsXG4gICAgICAnRGVsZXRlIEZhaWxlZCBSdW5uZXInLFxuICAgICAge1xuICAgICAgICBsYW1iZGFGdW5jdGlvbjogZGVsZXRlRmFpbGVkUnVubmVyRnVuY3Rpb24sXG4gICAgICAgIHBheWxvYWRSZXNwb25zZU9ubHk6IHRydWUsXG4gICAgICAgIHJlc3VsdFBhdGg6ICckLmRlbGV0ZScsXG4gICAgICAgIHBheWxvYWQ6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICAgIHJ1bm5lck5hbWU6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQkLkV4ZWN1dGlvbi5OYW1lJyksXG4gICAgICAgICAgb3duZXI6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQub3duZXInKSxcbiAgICAgICAgICByZXBvOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnJlcG8nKSxcbiAgICAgICAgICBpbnN0YWxsYXRpb25JZDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5udW1iZXJBdCgnJC5pbnN0YWxsYXRpb25JZCcpLFxuICAgICAgICAgIGVycm9yOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLm9iamVjdEF0KCckLmVycm9yJyksXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICApO1xuICAgIGRlbGV0ZUZhaWxlZFJ1bm5lclRhc2suYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbXG4gICAgICAgICdSdW5uZXJCdXN5JyxcbiAgICAgIF0sXG4gICAgICBpbnRlcnZhbDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICBiYWNrb2ZmUmF0ZTogMSxcbiAgICAgIG1heEF0dGVtcHRzOiA2MCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGlkbGVSZWFwZXIgPSB0aGlzLmlkbGVSZWFwZXIoKTtcbiAgICBjb25zdCBxdWV1ZUlkbGVSZWFwZXJUYXNrID0gbmV3IHN0ZXBmdW5jdGlvbnNfdGFza3MuU3FzU2VuZE1lc3NhZ2UodGhpcywgJ1F1ZXVlIElkbGUgUmVhcGVyJywge1xuICAgICAgcXVldWU6IHRoaXMuaWRsZVJlYXBlclF1ZXVlKGlkbGVSZWFwZXIpLFxuICAgICAgbWVzc2FnZUJvZHk6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBleGVjdXRpb25Bcm46IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQkLkV4ZWN1dGlvbi5JZCcpLFxuICAgICAgICBydW5uZXJOYW1lOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckJC5FeGVjdXRpb24uTmFtZScpLFxuICAgICAgICBvd25lcjogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5vd25lcicpLFxuICAgICAgICByZXBvOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnJlcG8nKSxcbiAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGgubnVtYmVyQXQoJyQuaW5zdGFsbGF0aW9uSWQnKSxcbiAgICAgICAgbWF4SWRsZVNlY29uZHM6IChwcm9wcz8uaWRsZVRpbWVvdXQgPz8gY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkpLnRvU2Vjb25kcygpLFxuICAgICAgfSksXG4gICAgICByZXN1bHRQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLkRJU0NBUkQsXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm92aWRlckNob29zZXIgPSBuZXcgc3RlcGZ1bmN0aW9ucy5DaG9pY2UodGhpcywgJ0Nob29zZSBwcm92aWRlcicpO1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgIGNvbnN0IHByb3ZpZGVyVGFzayA9IHByb3ZpZGVyLmdldFN0ZXBGdW5jdGlvblRhc2soXG4gICAgICAgIHtcbiAgICAgICAgICBydW5uZXJUb2tlblBhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQucnVubmVyLnRva2VuJyksXG4gICAgICAgICAgcnVubmVyTmFtZVBhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQkLkV4ZWN1dGlvbi5OYW1lJyksXG4gICAgICAgICAgZ2l0aHViRG9tYWluUGF0aDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5ydW5uZXIuZG9tYWluJyksXG4gICAgICAgICAgb3duZXJQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLm93bmVyJyksXG4gICAgICAgICAgcmVwb1BhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQucmVwbycpLFxuICAgICAgICAgIHJlZ2lzdHJhdGlvblVybDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5ydW5uZXIucmVnaXN0cmF0aW9uVXJsJyksXG4gICAgICAgICAgbGFiZWxzUGF0aDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5sYWJlbHMnKSxcbiAgICAgICAgICBqaXRDb25maWdQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnJ1bm5lci5qaXRDb25maWcnKSxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgICBwcm92aWRlckNob29zZXIud2hlbihcbiAgICAgICAgc3RlcGZ1bmN0aW9ucy5Db25kaXRpb24uYW5kKFxuICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuQ29uZGl0aW9uLnN0cmluZ0VxdWFscygnJC5wcm92aWRlcicsIHByb3ZpZGVyLm5vZGUucGF0aCksXG4gICAgICAgICksXG4gICAgICAgIHByb3ZpZGVyVGFzayxcbiAgICAgICAge1xuICAgICAgICAgIGNvbW1lbnQ6IGBMYWJlbHM6ICR7cHJvdmlkZXIubGFiZWxzLmpvaW4oJywgJyl9YCxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcHJvdmlkZXJDaG9vc2VyLm90aGVyd2lzZShuZXcgc3RlcGZ1bmN0aW9ucy5TdWNjZWVkKHRoaXMsICdVbmtub3duIGxhYmVsJykpO1xuXG4gICAgLy8gQ2hlY2sgaWYgdGhlIHRva2VuIHJldHJpZXZlciBpbmRpY2F0ZWQgdGhlIGpvYiBpcyBubyBsb25nZXIgcXVldWVkLlxuICAgIC8vIFRoaXMgcHJldmVudHMgbGF1bmNoaW5nIGEgcnVubmVyIGZvciBhIGpvYiB0aGF0IHdhcyBhbHJlYWR5IHBpY2tlZCB1cFxuICAgIC8vIGJ5IGFub3RoZXIgcnVubmVyIChjb21tb24gZHVyaW5nIHJldHJpZXMgdW5kZXIgYnVyc3QgbG9hZCkuXG4gICAgY29uc3Qgam9iU3RpbGxRdWV1ZWQgPSBuZXcgc3RlcGZ1bmN0aW9ucy5DaG9pY2UodGhpcywgJ0pvYiBTdGlsbCBRdWV1ZWQ/Jyk7XG4gICAgam9iU3RpbGxRdWV1ZWQud2hlbihcbiAgICAgIHN0ZXBmdW5jdGlvbnMuQ29uZGl0aW9uLmJvb2xlYW5FcXVhbHMoJyQucnVubmVyLnNraXAnLCB0cnVlKSxcbiAgICAgIG5ldyBzdGVwZnVuY3Rpb25zLlN1Y2NlZWQodGhpcywgJ0pvYiBBbHJlYWR5IEhhbmRsZWQnKSxcbiAgICApO1xuICAgIGpvYlN0aWxsUXVldWVkLm90aGVyd2lzZShwcm92aWRlckNob29zZXIpO1xuXG4gICAgY29uc3QgcnVuUHJvdmlkZXJzID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFyYWxsZWwodGhpcywgJ1J1biBQcm92aWRlcnMnKS5icmFuY2goXG4gICAgICBuZXcgc3RlcGZ1bmN0aW9ucy5QYXJhbGxlbCh0aGlzLCAnRXJyb3IgSGFuZGxlcicpLmJyYW5jaChcbiAgICAgICAgLy8gd2UgZ2V0IGEgdG9rZW4gZm9yIGV2ZXJ5IHJldHJ5IGJlY2F1c2UgdGhlIHRva2VuIGNhbiBleHBpcmUgZmFzdGVyIHRoYW4gdGhlIGpvYiBjYW4gdGltZW91dFxuICAgICAgICB0b2tlblJldHJpZXZlclRhc2submV4dChqb2JTdGlsbFF1ZXVlZCksXG4gICAgICApLmFkZENhdGNoKFxuICAgICAgICAvLyBkZWxldGUgcnVubmVyIG9uIGZhaWx1cmUgYXMgaXQgd29uJ3QgcmVtb3ZlIGl0c2VsZiBhbmQgdGhlcmUgaXMgYSBsaW1pdCBvbiB0aGUgbnVtYmVyIG9mIHJlZ2lzdGVyZWQgcnVubmVyc1xuICAgICAgICBkZWxldGVGYWlsZWRSdW5uZXJUYXNrLFxuICAgICAgICB7XG4gICAgICAgICAgcmVzdWx0UGF0aDogJyQuZXJyb3InLFxuICAgICAgICB9LFxuICAgICAgKSxcbiAgICApO1xuXG4gICAgaWYgKHByb3BzPy5yZXRyeU9wdGlvbnM/LnJldHJ5ID8/IHRydWUpIHtcbiAgICAgIGNvbnN0IGludGVydmFsID0gcHJvcHM/LnJldHJ5T3B0aW9ucz8uaW50ZXJ2YWwgPz8gY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSk7XG4gICAgICBjb25zdCBtYXhBdHRlbXB0cyA9IHByb3BzPy5yZXRyeU9wdGlvbnM/Lm1heEF0dGVtcHRzID8/IDIzO1xuICAgICAgY29uc3QgYmFja29mZlJhdGUgPSBwcm9wcz8ucmV0cnlPcHRpb25zPy5iYWNrb2ZmUmF0ZSA/PyAxLjM7XG5cbiAgICAgIGNvbnN0IHRvdGFsU2Vjb25kcyA9IGludGVydmFsLnRvU2Vjb25kcygpICogYmFja29mZlJhdGUgKiogbWF4QXR0ZW1wdHMgLyAoYmFja29mZlJhdGUgLSAxKTtcbiAgICAgIGlmICh0b3RhbFNlY29uZHMgPj0gY2RrLkR1cmF0aW9uLmRheXMoMSkudG9TZWNvbmRzKCkpIHtcbiAgICAgICAgLy8gaHR0cHM6Ly9kb2NzLmdpdGh1Yi5jb20vZW4vYWN0aW9ucy9ob3N0aW5nLXlvdXItb3duLXJ1bm5lcnMvbWFuYWdpbmctc2VsZi1ob3N0ZWQtcnVubmVycy9hYm91dC1zZWxmLWhvc3RlZC1ydW5uZXJzI3VzYWdlLWxpbWl0c1xuICAgICAgICAvLyBcIkpvYiBxdWV1ZSB0aW1lIC0gRWFjaCBqb2IgZm9yIHNlbGYtaG9zdGVkIHJ1bm5lcnMgY2FuIGJlIHF1ZXVlZCBmb3IgYSBtYXhpbXVtIG9mIDI0IGhvdXJzLiBJZiBhIHNlbGYtaG9zdGVkIHJ1bm5lciBkb2VzIG5vdCBzdGFydCBleGVjdXRpbmcgdGhlIGpvYiB3aXRoaW4gdGhpcyBsaW1pdCwgdGhlIGpvYiBpcyB0ZXJtaW5hdGVkIGFuZCBmYWlscyB0byBjb21wbGV0ZS5cIlxuICAgICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKGBUb3RhbCByZXRyeSB0aW1lIGlzIGdyZWF0ZXIgdGhhbiAyNCBob3VycyAoJHtNYXRoLmZsb29yKHRvdGFsU2Vjb25kcyAvIDYwIC8gNjApfSBob3VycykuIEpvYnMgZXhwaXJlIGFmdGVyIDI0IGhvdXJzIHNvIGl0IHdvdWxkIGJlIGEgd2FzdGUgb2YgcmVzb3VyY2VzIHRvIHJldHJ5IGZ1cnRoZXIuYCk7XG4gICAgICB9XG5cbiAgICAgIHJ1blByb3ZpZGVycy5hZGRSZXRyeSh7XG4gICAgICAgIGludGVydmFsLFxuICAgICAgICBtYXhBdHRlbXB0cyxcbiAgICAgICAgYmFja29mZlJhdGUsXG4gICAgICAgIC8vIHdlIHJldHJ5IG9uIGV2ZXJ5dGhpbmdcbiAgICAgICAgLy8gZGVsZXRlZCBpZGxlIHJ1bm5lcnMgd2lsbCBhbHNvIGZhaWwsIGJ1dCB0aGUgcmVhcGVyIHdpbGwgc3RvcCB0aGlzIHN0ZXAgZnVuY3Rpb24gdG8gYXZvaWQgZW5kbGVzcyByZXRyaWVzXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBsZXQgbG9nT3B0aW9uczogY2RrLmF3c19zdGVwZnVuY3Rpb25zLkxvZ09wdGlvbnMgfCB1bmRlZmluZWQ7XG4gICAgaWYgKHRoaXMucHJvcHM/LmxvZ09wdGlvbnMpIHtcbiAgICAgIHRoaXMuc3RhdGVNYWNoaW5lTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnTG9ncycsIHtcbiAgICAgICAgbG9nR3JvdXBOYW1lOiBwcm9wcz8ubG9nT3B0aW9ucz8ubG9nR3JvdXBOYW1lLFxuICAgICAgICByZXRlbnRpb246IHByb3BzPy5sb2dPcHRpb25zPy5sb2dSZXRlbnRpb24gPz8gbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0pO1xuXG4gICAgICBsb2dPcHRpb25zID0ge1xuICAgICAgICBkZXN0aW5hdGlvbjogdGhpcy5zdGF0ZU1hY2hpbmVMb2dHcm91cCxcbiAgICAgICAgaW5jbHVkZUV4ZWN1dGlvbkRhdGE6IHByb3BzPy5sb2dPcHRpb25zPy5pbmNsdWRlRXhlY3V0aW9uRGF0YSA/PyB0cnVlLFxuICAgICAgICBsZXZlbDogcHJvcHM/LmxvZ09wdGlvbnM/LmxldmVsID8/IHN0ZXBmdW5jdGlvbnMuTG9nTGV2ZWwuQUxMLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBzdGF0ZU1hY2hpbmUgPSBuZXcgc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmUoXG4gICAgICB0aGlzLFxuICAgICAgJ1J1bm5lciBPcmNoZXN0cmF0b3InLFxuICAgICAge1xuICAgICAgICBkZWZpbml0aW9uQm9keTogc3RlcGZ1bmN0aW9ucy5EZWZpbml0aW9uQm9keS5mcm9tQ2hhaW5hYmxlKHF1ZXVlSWRsZVJlYXBlclRhc2submV4dChydW5Qcm92aWRlcnMpKSxcbiAgICAgICAgbG9nczogbG9nT3B0aW9ucyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHN0YXRlTWFjaGluZS5ncmFudFJlYWQoaWRsZVJlYXBlcik7XG4gICAgc3RhdGVNYWNoaW5lLmdyYW50RXhlY3V0aW9uKGlkbGVSZWFwZXIsICdzdGF0ZXM6U3RvcEV4ZWN1dGlvbicpO1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgIHByb3ZpZGVyLmdyYW50U3RhdGVNYWNoaW5lKHN0YXRlTWFjaGluZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHN0YXRlTWFjaGluZTtcbiAgfVxuXG4gIHByaXZhdGUgdG9rZW5SZXRyaWV2ZXIoKSB7XG4gICAgY29uc3QgZnVuYyA9IG5ldyBUb2tlblJldHJpZXZlckZ1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgICd0b2tlbi1yZXRyaWV2ZXInLFxuICAgICAge1xuICAgICAgICBkZXNjcmlwdGlvbjogJ0dldCB0b2tlbiBmcm9tIEdpdEh1YiBBY3Rpb25zIHVzZWQgdG8gc3RhcnQgbmV3IHNlbGYtaG9zdGVkIHJ1bm5lcicsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgR0lUSFVCX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5zZWNyZXRBcm4sXG4gICAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgICAgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5PUkNIRVNUUkFUT1IpLFxuICAgICAgICBsb2dnaW5nRm9ybWF0OiBsYW1iZGEuTG9nZ2luZ0Zvcm1hdC5KU09OLFxuICAgICAgICAuLi50aGlzLmV4dHJhTGFtYmRhUHJvcHMsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViLmdyYW50UmVhZChmdW5jKTtcbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFJlYWQoZnVuYyk7XG5cbiAgICByZXR1cm4gZnVuYztcbiAgfVxuXG4gIHByaXZhdGUgZGVsZXRlRmFpbGVkUnVubmVyKCkge1xuICAgIGNvbnN0IGZ1bmMgPSBuZXcgRGVsZXRlRmFpbGVkUnVubmVyRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ2RlbGV0ZS1ydW5uZXInLFxuICAgICAge1xuICAgICAgICBkZXNjcmlwdGlvbjogJ0RlbGV0ZSBmYWlsZWQgR2l0SHViIEFjdGlvbnMgcnVubmVyIG9uIGVycm9yJyxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBHSVRIVUJfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1Yi5zZWNyZXRBcm4sXG4gICAgICAgICAgR0lUSFVCX1BSSVZBVEVfS0VZX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LnNlY3JldEFybixcbiAgICAgICAgICAuLi50aGlzLmV4dHJhTGFtYmRhRW52LFxuICAgICAgICB9LFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLk9SQ0hFU1RSQVRPUiksXG4gICAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFQcm9wcyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMuc2VjcmV0cy5naXRodWIuZ3JhbnRSZWFkKGZ1bmMpO1xuICAgIHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LmdyYW50UmVhZChmdW5jKTtcblxuICAgIHJldHVybiBmdW5jO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0dXNGdW5jdGlvbigpIHtcbiAgICBjb25zdCBzdGF0dXNGdW5jdGlvbiA9IG5ldyBTdGF0dXNGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnc3RhdHVzJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdQcm92aWRlIHVzZXIgd2l0aCBzdGF0dXMgYWJvdXQgc2VsZi1ob3N0ZWQgR2l0SHViIEFjdGlvbnMgcnVubmVycycsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgV0VCSE9PS19TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMud2ViaG9vay5zZWNyZXRBcm4sXG4gICAgICAgICAgR0lUSFVCX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5zZWNyZXRBcm4sXG4gICAgICAgICAgU0VUVVBfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLnNldHVwLnNlY3JldEFybixcbiAgICAgICAgICBXRUJIT09LX1VSTDogdGhpcy53ZWJob29rLnVybCxcbiAgICAgICAgICBXRUJIT09LX0hBTkRMRVJfQVJOOiB0aGlzLndlYmhvb2suaGFuZGxlci5sYXRlc3RWZXJzaW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgICAgIFNURVBfRlVOQ1RJT05fQVJOOiB0aGlzLm9yY2hlc3RyYXRvci5zdGF0ZU1hY2hpbmVBcm4sXG4gICAgICAgICAgU1RFUF9GVU5DVElPTl9MT0dfR1JPVVA6IHRoaXMuc3RhdGVNYWNoaW5lTG9nR3JvdXA/LmxvZ0dyb3VwTmFtZSA/PyAnJyxcbiAgICAgICAgICBTRVRVUF9GVU5DVElPTl9VUkw6IHRoaXMuc2V0dXBVcmwsXG4gICAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgICAgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMyksXG4gICAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlNFVFVQKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgY29uc3QgcHJvdmlkZXJzID0gdGhpcy5wcm92aWRlcnMuZmxhdE1hcChwcm92aWRlciA9PiB7XG4gICAgICBjb25zdCBzdGF0dXMgPSBwcm92aWRlci5zdGF0dXMoc3RhdHVzRnVuY3Rpb24pO1xuICAgICAgLy8gQ29tcG9zaXRlIHByb3ZpZGVycyByZXR1cm4gYW4gYXJyYXksIHJlZ3VsYXIgcHJvdmlkZXJzIHJldHVybiBhIHNpbmdsZSBzdGF0dXNcbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHN0YXR1cykgPyBzdGF0dXMgOiBbc3RhdHVzXTtcbiAgICB9KTtcblxuICAgIC8vIGV4cG9zZSBwcm92aWRlcnMgYXMgc3RhY2sgbWV0YWRhdGEgYXMgaXQncyB0b28gYmlnIGZvciBMYW1iZGEgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgLy8gc3BlY2lmaWNhbGx5IGludGVncmF0aW9uIHRlc3RpbmcgZ290IGFuIGVycm9yIGJlY2F1c2UgbGFtYmRhIHVwZGF0ZSByZXF1ZXN0IHdhcyA+NWtiXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2YodGhpcyk7XG4gICAgY29uc3QgZiA9IChzdGF0dXNGdW5jdGlvbi5ub2RlLmRlZmF1bHRDaGlsZCBhcyBsYW1iZGEuQ2ZuRnVuY3Rpb24pO1xuICAgIGYuYWRkUHJvcGVydHlPdmVycmlkZSgnRW52aXJvbm1lbnQuVmFyaWFibGVzLkxPR0lDQUxfSUQnLCBmLmxvZ2ljYWxJZCk7XG4gICAgZi5hZGRQcm9wZXJ0eU92ZXJyaWRlKCdFbnZpcm9ubWVudC5WYXJpYWJsZXMuU1RBQ0tfTkFNRScsIHN0YWNrLnN0YWNrTmFtZSk7XG4gICAgZi5hZGRNZXRhZGF0YSgncHJvdmlkZXJzJywgcHJvdmlkZXJzKTtcbiAgICBzdGF0dXNGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydjbG91ZGZvcm1hdGlvbjpEZXNjcmliZVN0YWNrUmVzb3VyY2UnXSxcbiAgICAgIHJlc291cmNlczogW3N0YWNrLnN0YWNrSWRdLFxuICAgIH0pKTtcblxuICAgIHRoaXMuc2VjcmV0cy53ZWJob29rLmdyYW50UmVhZChzdGF0dXNGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQoc3RhdHVzRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LmdyYW50UmVhZChzdGF0dXNGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLnNldHVwLmdyYW50UmVhZChzdGF0dXNGdW5jdGlvbik7XG4gICAgdGhpcy5vcmNoZXN0cmF0b3IuZ3JhbnRSZWFkKHN0YXR1c0Z1bmN0aW9uKTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KFxuICAgICAgdGhpcyxcbiAgICAgICdzdGF0dXMgY29tbWFuZCcsXG4gICAgICB7XG4gICAgICAgIHZhbHVlOiBgYXdzIC0tcmVnaW9uICR7c3RhY2sucmVnaW9ufSBsYW1iZGEgaW52b2tlIC0tZnVuY3Rpb24tbmFtZSAke3N0YXR1c0Z1bmN0aW9uLmZ1bmN0aW9uTmFtZX0gc3RhdHVzLmpzb25gLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgY29uc3QgYWNjZXNzID0gdGhpcy5wcm9wcz8uc3RhdHVzQWNjZXNzID8/IExhbWJkYUFjY2Vzcy5ub0FjY2VzcygpO1xuICAgIGNvbnN0IHVybCA9IGFjY2Vzcy5iaW5kKHRoaXMsICdzdGF0dXMgYWNjZXNzJywgc3RhdHVzRnVuY3Rpb24pO1xuXG4gICAgaWYgKHVybCAhPT0gJycpIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KFxuICAgICAgICB0aGlzLFxuICAgICAgICAnc3RhdHVzIHVybCcsXG4gICAgICAgIHtcbiAgICAgICAgICB2YWx1ZTogdXJsLFxuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNldHVwRnVuY3Rpb24oKTogc3RyaW5nIHtcbiAgICBjb25zdCBzZXR1cEZ1bmN0aW9uID0gbmV3IFNldHVwRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ3NldHVwJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdTZXR1cCBHaXRIdWIgQWN0aW9ucyBpbnRlZ3JhdGlvbiB3aXRoIHNlbGYtaG9zdGVkIHJ1bm5lcnMnLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIFNFVFVQX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5zZXR1cC5zZWNyZXRBcm4sXG4gICAgICAgICAgV0VCSE9PS19TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMud2ViaG9vay5zZWNyZXRBcm4sXG4gICAgICAgICAgR0lUSFVCX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5zZWNyZXRBcm4sXG4gICAgICAgICAgV0VCSE9PS19VUkw6IHRoaXMud2ViaG9vay51cmwsXG4gICAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgICAgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMyksXG4gICAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlNFVFVQKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gdGhpcy5zZWNyZXRzLndlYmhvb2suZ3JhbnRSZWFkKHNldHVwRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy53ZWJob29rLmdyYW50V3JpdGUoc2V0dXBGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQoc2V0dXBGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFdyaXRlKHNldHVwRnVuY3Rpb24pO1xuICAgIC8vIHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LmdyYW50UmVhZChzZXR1cEZ1bmN0aW9uKTtcbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFdyaXRlKHNldHVwRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5zZXR1cC5ncmFudFJlYWQoc2V0dXBGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLnNldHVwLmdyYW50V3JpdGUoc2V0dXBGdW5jdGlvbik7XG5cbiAgICBjb25zdCBhY2Nlc3MgPSB0aGlzLnByb3BzPy5zZXR1cEFjY2VzcyA/PyBMYW1iZGFBY2Nlc3MubGFtYmRhVXJsKCk7XG4gICAgcmV0dXJuIGFjY2Vzcy5iaW5kKHRoaXMsICdzZXR1cCBhY2Nlc3MnLCBzZXR1cEZ1bmN0aW9uKTtcbiAgfVxuXG4gIHByaXZhdGUgY2hlY2tJbnRlcnNlY3RpbmdMYWJlbHMoKSB7XG4gICAgLy8gdGhpcyBcImFsZ29yaXRobVwiIGlzIHZlcnkgaW5lZmZpY2llbnQsIGJ1dCBnb29kIGVub3VnaCBmb3IgdGhlIHRpbnkgZGF0YXNldHMgd2UgZXhwZWN0XG4gICAgZm9yIChjb25zdCBwMSBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgZm9yIChjb25zdCBwMiBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgICBpZiAocDEgPT0gcDIpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocDEubGFiZWxzLmV2ZXJ5KGwgPT4gcDIubGFiZWxzLmluY2x1ZGVzKGwpKSkge1xuICAgICAgICAgIGlmIChwMi5sYWJlbHMuZXZlcnkobCA9PiBwMS5sYWJlbHMuaW5jbHVkZXMobCkpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEJvdGggJHtwMS5ub2RlLnBhdGh9IGFuZCAke3AyLm5vZGUucGF0aH0gdXNlIHRoZSBzYW1lIGxhYmVscyBbJHtwMS5sYWJlbHMuam9pbignLCAnKX1dYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIEFubm90YXRpb25zLm9mKHAxKS5hZGRXYXJuaW5nKGBMYWJlbHMgWyR7cDEubGFiZWxzLmpvaW4oJywgJyl9XSBpbnRlcnNlY3Qgd2l0aCBhbm90aGVyIHByb3ZpZGVyICgke3AyLm5vZGUucGF0aH0gLS0gWyR7cDIubGFiZWxzLmpvaW4oJywgJyl9XSkuIElmIGEgd29ya2Zsb3cgc3BlY2lmaWVzIHRoZSBsYWJlbHMgWyR7cDEubGFiZWxzLmpvaW4oJywgJyl9XSwgaXQgaXMgbm90IGd1YXJhbnRlZWQgd2hpY2ggcHJvdmlkZXIgd2lsbCBiZSB1c2VkLiBJdCBpcyByZWNvbW1lbmRlZCB5b3UgZG8gbm90IHVzZSBpbnRlcnNlY3RpbmcgbGFiZWxzYCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlkbGVSZWFwZXIoKSB7XG4gICAgcmV0dXJuIG5ldyBJZGxlUnVubmVyUmVwZWFyRnVuY3Rpb24odGhpcywgJ0lkbGUgUmVhcGVyJywge1xuICAgICAgZGVzY3JpcHRpb246ICdTdG9wIGlkbGUgR2l0SHViIHJ1bm5lcnMgdG8gYXZvaWQgcGF5aW5nIGZvciBydW5uZXJzIHdoZW4gdGhlIGpvYiB3YXMgYWxyZWFkeSBjYW5jZWxlZCcsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBHSVRIVUJfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1Yi5zZWNyZXRBcm4sXG4gICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5zZWNyZXRBcm4sXG4gICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICB9LFxuICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFQcm9wcyxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgaWRsZVJlYXBlclF1ZXVlKHJlYXBlcjogbGFtYmRhLkZ1bmN0aW9uKSB7XG4gICAgLy8gc2VlIHRoaXMgY29tbWVudCB0byB1bmRlcnN0YW5kIHdoeSBpdCdzIGEgcXVldWUgdGhhdCdzIG91dCBvZiB0aGUgc3RlcCBmdW5jdGlvblxuICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzL3B1bGwvMzE0I2lzc3VlY29tbWVudC0xNTI4OTAxMTkyXG5cbiAgICBjb25zdCBxdWV1ZSA9IG5ldyBzcXMuUXVldWUodGhpcywgJ0lkbGUgUmVhcGVyIFF1ZXVlJywge1xuICAgICAgZGVsaXZlcnlEZWxheTogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKSxcbiAgICB9KTtcblxuICAgIHJlYXBlci5hZGRFdmVudFNvdXJjZShuZXcgbGFtYmRhX2V2ZW50X3NvdXJjZXMuU3FzRXZlbnRTb3VyY2UocXVldWUsIHtcbiAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiB0cnVlLFxuICAgICAgbWF4QmF0Y2hpbmdXaW5kb3c6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgIH0pKTtcblxuICAgIHRoaXMuc2VjcmV0cy5naXRodWIuZ3JhbnRSZWFkKHJlYXBlcik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuZ3JhbnRSZWFkKHJlYXBlcik7XG5cbiAgICByZXR1cm4gcXVldWU7XG4gIH1cblxuICBwcml2YXRlIGxhbWJkYVNlY3VyaXR5R3JvdXBzKCkge1xuICAgIGlmICghdGhpcy5wcm9wcz8udnBjKSB7XG4gICAgICBpZiAodGhpcy5wcm9wcz8uc2VjdXJpdHlHcm91cCkge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnc2VjdXJpdHlHcm91cCBpcyBzcGVjaWZpZWQsIGJ1dCB2cGMgaXMgbm90LiBzZWN1cml0eUdyb3VwIHdpbGwgYmUgaWdub3JlZCcpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucHJvcHM/LnNlY3VyaXR5R3JvdXBzKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdzZWN1cml0eUdyb3VwcyBpcyBzcGVjaWZpZWQsIGJ1dCB2cGMgaXMgbm90LiBzZWN1cml0eUdyb3VwcyB3aWxsIGJlIGlnbm9yZWQnKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5wcm9wcy5zZWN1cml0eUdyb3Vwcykge1xuICAgICAgaWYgKHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cCkge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnQm90aCBzZWN1cml0eUdyb3VwIGFuZCBzZWN1cml0eUdyb3VwcyBhcmUgc3BlY2lmaWVkLiBzZWN1cml0eUdyb3VwIHdpbGwgYmUgaWdub3JlZCcpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cHM7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cCkge1xuICAgICAgcmV0dXJuIFt0aGlzLnByb3BzLnNlY3VyaXR5R3JvdXBdO1xuICAgIH1cblxuICAgIHJldHVybiBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdNYW5hZ2VtZW50IExhbWJkYXMgU2VjdXJpdHkgR3JvdXAnLCB7IHZwYzogdGhpcy5wcm9wcy52cGMgfSldO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3RzIGFsbCB1bmlxdWUgSVJ1bm5lclByb3ZpZGVyIGluc3RhbmNlcyBmcm9tIHByb3ZpZGVycyBhbmQgY29tcG9zaXRlIHByb3ZpZGVycyAob25lIGxldmVsIG9ubHkpLlxuICAgKiBVc2VzIGEgU2V0IHRvIGVuc3VyZSB3ZSBkb24ndCBwcm9jZXNzIHRoZSBzYW1lIHByb3ZpZGVyIHR3aWNlLCBldmVuIGlmIGl0J3MgdXNlZCBpbiBtdWx0aXBsZSBjb21wb3NpdGVzLlxuICAgKlxuICAgKiBAcmV0dXJucyBTZXQgb2YgdW5pcXVlIElSdW5uZXJQcm92aWRlciBpbnN0YW5jZXNcbiAgICovXG4gIHByaXZhdGUgZXh0cmFjdFVuaXF1ZVN1YlByb3ZpZGVycygpOiBTZXQ8SVJ1bm5lclByb3ZpZGVyPiB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8SVJ1bm5lclByb3ZpZGVyPigpO1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgIC8vIGluc3RhbmNlb2YgZG9lc24ndCByZWFsbHkgd29yayBpbiBDREsgc28gdXNlIHRoaXMgaGFjayBpbnN0ZWFkXG4gICAgICBpZiAoJ2xvZ0dyb3VwJyBpbiBwcm92aWRlcikge1xuICAgICAgICAvLyBSZWd1bGFyIHByb3ZpZGVyXG4gICAgICAgIHNlZW4uYWRkKHByb3ZpZGVyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENvbXBvc2l0ZSBwcm92aWRlciAtIGFjY2VzcyB0aGUgcHJvdmlkZXJzIGZpZWxkXG4gICAgICAgIGZvciAoY29uc3Qgc3ViUHJvdmlkZXIgb2YgcHJvdmlkZXIucHJvdmlkZXJzKSB7XG4gICAgICAgICAgc2Vlbi5hZGQoc3ViUHJvdmlkZXIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzZWVuO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBMYW1iZGEgbGF5ZXIgd2l0aCBjZXJ0aWZpY2F0ZXMgaWYgZXh0cmFDZXJ0aWZpY2F0ZXMgaXMgc3BlY2lmaWVkLlxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVDZXJ0aWZpY2F0ZUxheWVyKHNjb3BlOiBDb25zdHJ1Y3QpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMucHJvcHM/LmV4dHJhQ2VydGlmaWNhdGVzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY2VydGlmaWNhdGVGaWxlcyA9IGRpc2NvdmVyQ2VydGlmaWNhdGVGaWxlcyh0aGlzLnByb3BzLmV4dHJhQ2VydGlmaWNhdGVzKTtcblxuICAgIC8vIENvbmNhdGVuYXRlIGFsbCBjZXJ0aWZpY2F0ZXMgaW50byBhIHNpbmdsZSBmaWxlIGZvciBOT0RFX0VYVFJBX0NBX0NFUlRTXG4gICAgbGV0IGNvbWJpbmVkQ2VydENvbnRlbnQgPSAnJztcbiAgICBmb3IgKGNvbnN0IGNlcnRGaWxlIG9mIGNlcnRpZmljYXRlRmlsZXMpIHtcbiAgICAgIGNvbnN0IGNlcnRDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGNlcnRGaWxlLCAndXRmOCcpO1xuICAgICAgY29tYmluZWRDZXJ0Q29udGVudCArPSBjZXJ0Q29udGVudDtcbiAgICAgIC8vIEVuc3VyZSBwcm9wZXIgUEVNIGZvcm1hdCB3aXRoIG5ld2xpbmUgYmV0d2VlbiBjZXJ0aWZpY2F0ZXNcbiAgICAgIGlmICghY2VydENvbnRlbnQuZW5kc1dpdGgoJ1xcbicpKSB7XG4gICAgICAgIGNvbWJpbmVkQ2VydENvbnRlbnQgKz0gJ1xcbic7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGRpcmVjdG9yeSwgd3JpdGUgdGhlIGNlcnRpZmljYXRlIGZpbGUsIGNyZWF0ZSBhc3NldCwgdGhlbiBkZWxldGUgdGVtcCBkaXJcbiAgICBjb25zdCB3b3JrZGlyID0gZnMubWtkdGVtcFN5bmMocGF0aC5qb2luKG9zLnRtcGRpcigpLCAnY2VydGlmaWNhdGUtbGF5ZXItJykpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjZXJ0UGF0aCA9IHBhdGguam9pbih3b3JrZGlyLCAnY2VydHMucGVtJyk7XG4gICAgICBmcy53cml0ZUZpbGVTeW5jKGNlcnRQYXRoLCBjb21iaW5lZENlcnRDb250ZW50KTtcblxuICAgICAgLy8gU2V0IGVudmlyb25tZW50IHZhcmlhYmxlIGFuZCBjcmVhdGUgbGF5ZXJcbiAgICAgIHRoaXMuZXh0cmFMYW1iZGFFbnYuTk9ERV9FWFRSQV9DQV9DRVJUUyA9ICcvb3B0L2NlcnRzLnBlbSc7XG4gICAgICB0aGlzLmV4dHJhTGFtYmRhUHJvcHMubGF5ZXJzIS5wdXNoKFxuICAgICAgICBuZXcgbGFtYmRhLkxheWVyVmVyc2lvbihzY29wZSwgJ0NlcnRpZmljYXRlIExheWVyJywge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTGF5ZXIgY29udGFpbmluZyBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgY2VydGlmaWNhdGUocykgZm9yIGNkay1naXRodWItcnVubmVycycsXG4gICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHdvcmtkaXIpLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIC8vIENhbGxpbmcgYGZyb21Bc3NldCgpYCBoYXMgY29waWVkIGZpbGVzIHRvIHRoZSBhc3NlbWJseSwgc28gd2UgY2FuIGRlbGV0ZSB0aGUgdGVtcG9yYXJ5IGRpcmVjdG9yeS5cbiAgICAgIGZzLnJtU3luYyh3b3JrZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1ldHJpYyBmb3IgdGhlIG51bWJlciBvZiBHaXRIdWIgQWN0aW9ucyBqb2JzIGNvbXBsZXRlZC4gSXQgaGFzIGBQcm92aWRlckxhYmVsc2AgYW5kIGBTdGF0dXNgIGRpbWVuc2lvbnMuIFRoZSBzdGF0dXMgY2FuIGJlIG9uZSBvZiBcIlN1Y2NlZWRlZFwiLCBcIlN1Y2NlZWRlZFdpdGhJc3N1ZXNcIiwgXCJGYWlsZWRcIiwgXCJDYW5jZWxlZFwiLCBcIlNraXBwZWRcIiwgb3IgXCJBYmFuZG9uZWRcIi5cbiAgICpcbiAgICogKipXQVJOSU5HOioqIHRoaXMgbWV0aG9kIGNyZWF0ZXMgYSBtZXRyaWMgZmlsdGVyIGZvciBlYWNoIHByb3ZpZGVyLiBFYWNoIG1ldHJpYyBoYXMgYSBzdGF0dXMgZGltZW5zaW9uIHdpdGggc2l4IHBvc3NpYmxlIHZhbHVlcy4gVGhlc2UgcmVzb3VyY2VzIG1heSBpbmN1ciBjb3N0LlxuICAgKi9cbiAgcHVibGljIG1ldHJpY0pvYkNvbXBsZXRlZChwcm9wcz86IGNsb3Vkd2F0Y2guTWV0cmljT3B0aW9ucyk6IGNsb3Vkd2F0Y2guTWV0cmljIHtcbiAgICBpZiAoIXRoaXMuam9ic0NvbXBsZXRlZE1ldHJpY0ZpbHRlcnNJbml0aWFsaXplZCkge1xuICAgICAgLy8gd2UgY2FuJ3QgdXNlIGxvZ3MuRmlsdGVyUGF0dGVybi5zcGFjZURlbGltaXRlZCgpIGJlY2F1c2UgaXQgaGFzIG5vIHN1cHBvcnQgZm9yIHx8XG4gICAgICAvLyBzdGF0dXMgbGlzdCB0YWtlbiBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9hY3Rpb25zL3J1bm5lci9ibG9iL2JlOTYzMjMwMmNlZWY1MGJmYjM2ZWE5OThjZWE5Yzk0Yzc1ZTVkNGQvc3JjL1Nkay9EVFdlYkFwaS9XZWJBcGkvVGFza1Jlc3VsdC5jc1xuICAgICAgLy8gd2UgbmVlZCBcIi4uLlwiIGZvciBMYW1iZGEgdGhhdCBwcmVmaXhlcyBzb21lIGV4dHJhIGRhdGEgdG8gbG9nIGxpbmVzXG4gICAgICBjb25zdCBwYXR0ZXJuID0gbG9ncy5GaWx0ZXJQYXR0ZXJuLmxpdGVyYWwoJ1suLi4sIG1hcmtlciA9IFwiQ0RLR0hBXCIsIGpvYiA9IFwiSk9CXCIsIGRvbmUgPSBcIkRPTkVcIiwgbGFiZWxzLCBzdGF0dXMgPSBcIlN1Y2NlZWRlZFwiIHx8IHN0YXR1cyA9IFwiU3VjY2VlZGVkV2l0aElzc3Vlc1wiIHx8IHN0YXR1cyA9IFwiRmFpbGVkXCIgfHwgc3RhdHVzID0gXCJDYW5jZWxlZFwiIHx8IHN0YXR1cyA9IFwiU2tpcHBlZFwiIHx8IHN0YXR1cyA9IFwiQWJhbmRvbmVkXCJdJyk7XG5cbiAgICAgIC8vIEV4dHJhY3QgYWxsIHVuaXF1ZSBzdWItcHJvdmlkZXJzIGZyb20gcmVndWxhciBhbmQgY29tcG9zaXRlIHByb3ZpZGVyc1xuICAgICAgLy8gQnVpbGQgYSBzZXQgZmlyc3QgdG8gYXZvaWQgZmlsdGVyaW5nIHRoZSBzYW1lIGxvZyB0d2ljZVxuICAgICAgZm9yIChjb25zdCBwIG9mIHRoaXMuZXh0cmFjdFVuaXF1ZVN1YlByb3ZpZGVycygpKSB7XG4gICAgICAgIGNvbnN0IG1ldHJpY0ZpbHRlciA9IHAubG9nR3JvdXAuYWRkTWV0cmljRmlsdGVyKGAke3AubG9nR3JvdXAubm9kZS5pZH0gZmlsdGVyYCwge1xuICAgICAgICAgIG1ldHJpY05hbWVzcGFjZTogJ0dpdEh1YlJ1bm5lcnMnLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdKb2JDb21wbGV0ZWQnLFxuICAgICAgICAgIGZpbHRlclBhdHRlcm46IHBhdHRlcm4sXG4gICAgICAgICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICAgICAgICAvLyBjYW4ndCB3aXRoIGRpbWVuc2lvbnMgLS0gZGVmYXVsdFZhbHVlOiAwLFxuICAgICAgICAgIGRpbWVuc2lvbnM6IHtcbiAgICAgICAgICAgIFByb3ZpZGVyTGFiZWxzOiAnJGxhYmVscycsXG4gICAgICAgICAgICBTdGF0dXM6ICckc3RhdHVzJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAobWV0cmljRmlsdGVyLm5vZGUuZGVmYXVsdENoaWxkIGluc3RhbmNlb2YgbG9ncy5DZm5NZXRyaWNGaWx0ZXIpIHtcbiAgICAgICAgICBtZXRyaWNGaWx0ZXIubm9kZS5kZWZhdWx0Q2hpbGQuYWRkUHJvcGVydHlPdmVycmlkZSgnTWV0cmljVHJhbnNmb3JtYXRpb25zLjAuVW5pdCcsICdDb3VudCcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIEFubm90YXRpb25zLm9mKG1ldHJpY0ZpbHRlcikuYWRkV2FybmluZygnVW5hYmxlIHRvIHNldCBtZXRyaWMgZmlsdGVyIFVuaXQgdG8gQ291bnQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5qb2JzQ29tcGxldGVkTWV0cmljRmlsdGVyc0luaXRpYWxpemVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgIG5hbWVzcGFjZTogJ0dpdEh1YlJ1bm5lcnMnLFxuICAgICAgbWV0cmljTmFtZTogJ0pvYnNDb21wbGV0ZWQnLFxuICAgICAgdW5pdDogY2xvdWR3YXRjaC5Vbml0LkNPVU5ULFxuICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pLmF0dGFjaFRvKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIE1ldHJpYyBmb3Igc3VjY2Vzc2Z1bCBleGVjdXRpb25zLlxuICAgKlxuICAgKiBBIHN1Y2Nlc3NmdWwgZXhlY3V0aW9uIGRvZXNuJ3QgYWx3YXlzIG1lYW4gYSBydW5uZXIgd2FzIHN0YXJ0ZWQuIEl0IGNhbiBiZSBzdWNjZXNzZnVsIGV2ZW4gd2l0aG91dCBhbnkgbGFiZWwgbWF0Y2hlcy5cbiAgICpcbiAgICogQSBzdWNjZXNzZnVsIHJ1bm5lciBkb2Vzbid0IG1lYW4gdGhlIGpvYiBpdCBleGVjdXRlZCB3YXMgc3VjY2Vzc2Z1bC4gRm9yIHRoYXQsIHNlZSB7QGxpbmsgbWV0cmljSm9iQ29tcGxldGVkfS5cbiAgICovXG4gIHB1YmxpYyBtZXRyaWNTdWNjZWVkZWQocHJvcHM/OiBjbG91ZHdhdGNoLk1ldHJpY09wdGlvbnMpOiBjbG91ZHdhdGNoLk1ldHJpYyB7XG4gICAgcmV0dXJuIHRoaXMub3JjaGVzdHJhdG9yLm1ldHJpY1N1Y2NlZWRlZChwcm9wcyk7XG4gIH1cblxuICAvKipcbiAgICogTWV0cmljIGZvciBmYWlsZWQgcnVubmVyIGV4ZWN1dGlvbnMuXG4gICAqXG4gICAqIEEgZmFpbGVkIHJ1bm5lciB1c3VhbGx5IG1lYW5zIHRoZSBydW5uZXIgZmFpbGVkIHRvIHN0YXJ0IGFuZCBzbyBhIGpvYiB3YXMgbmV2ZXIgZXhlY3V0ZWQuIEl0IGRvZXNuJ3QgbmVjZXNzYXJpbHkgbWVhbiB0aGUgam9iIHdhcyBleGVjdXRlZCBhbmQgZmFpbGVkLiBGb3IgdGhhdCwgc2VlIHtAbGluayBtZXRyaWNKb2JDb21wbGV0ZWR9LlxuICAgKi9cbiAgcHVibGljIG1ldHJpY0ZhaWxlZChwcm9wcz86IGNsb3Vkd2F0Y2guTWV0cmljT3B0aW9ucyk6IGNsb3Vkd2F0Y2guTWV0cmljIHtcbiAgICByZXR1cm4gdGhpcy5vcmNoZXN0cmF0b3IubWV0cmljRmFpbGVkKHByb3BzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBNZXRyaWMgZm9yIHRoZSBpbnRlcnZhbCwgaW4gbWlsbGlzZWNvbmRzLCBiZXR3ZWVuIHRoZSB0aW1lIHRoZSBleGVjdXRpb24gc3RhcnRzIGFuZCB0aGUgdGltZSBpdCBjbG9zZXMuIFRoaXMgdGltZSBtYXkgYmUgbG9uZ2VyIHRoYW4gdGhlIHRpbWUgdGhlIHJ1bm5lciB0b29rLlxuICAgKi9cbiAgcHVibGljIG1ldHJpY1RpbWUocHJvcHM/OiBjbG91ZHdhdGNoLk1ldHJpY09wdGlvbnMpOiBjbG91ZHdhdGNoLk1ldHJpYyB7XG4gICAgcmV0dXJuIHRoaXMub3JjaGVzdHJhdG9yLm1ldHJpY1RpbWUocHJvcHMpO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSB0b3BpYyBmb3Igbm90aWZpY2F0aW9ucyB3aGVuIGEgcnVubmVyIGltYWdlIGJ1aWxkIGZhaWxzLlxuICAgKlxuICAgKiBSdW5uZXIgaW1hZ2VzIGFyZSByZWJ1aWx0IGV2ZXJ5IHdlZWsgYnkgZGVmYXVsdC4gVGhpcyBwcm92aWRlcyB0aGUgbGF0ZXN0IEdpdEh1YiBSdW5uZXIgdmVyc2lvbiBhbmQgc29mdHdhcmUgdXBkYXRlcy5cbiAgICpcbiAgICogSWYgeW91IHdhbnQgdG8gYmUgc3VyZSB5b3UgYXJlIHVzaW5nIHRoZSBsYXRlc3QgcnVubmVyIHZlcnNpb24sIHlvdSBjYW4gdXNlIHRoaXMgdG9waWMgdG8gYmUgbm90aWZpZWQgd2hlbiBhIGJ1aWxkIGZhaWxzLlxuICAgKlxuICAgKiBXaGVuIHRoZSBpbWFnZSBidWlsZGVyIGlzIGRlZmluZWQgaW4gYSBzZXBhcmF0ZSBzdGFjayAoZS5nLiBpbiBhIHNwbGl0LXN0YWNrcyBzZXR1cCksIHBhc3MgdGhhdCBzdGFjayBvciBjb25zdHJ1Y3RcbiAgICogYXMgdGhlIG9wdGlvbmFsIHNjb3BlIHNvIHRoZSB0b3BpYyBhbmQgZmFpbHVyZS1ub3RpZmljYXRpb24gYXNwZWN0cyBhcmUgY3JlYXRlZCBpbiB0aGUgc2FtZSBzdGFjayBhcyB0aGUgaW1hZ2VcbiAgICogYnVpbGRlci4gT3RoZXJ3aXNlIHRoZSBhc3BlY3RzIG1heSBub3QgZmluZCB0aGUgaW1hZ2UgYnVpbGRlciByZXNvdXJjZXMuXG4gICAqXG4gICAqIEBwYXJhbSBzY29wZSBPcHRpb25hbCBzY29wZSAoZS5nLiB0aGUgaW1hZ2UgYnVpbGRlciBzdGFjaykgd2hlcmUgdGhlIHRvcGljIGFuZCBhc3BlY3RzIHdpbGwgYmUgY3JlYXRlZC4gRGVmYXVsdHMgdG8gdGhpcyBjb25zdHJ1Y3QuXG4gICAqL1xuICBwdWJsaWMgZmFpbGVkSW1hZ2VCdWlsZHNUb3BpYyhzY29wZT86IENvbnN0cnVjdCkge1xuICAgIHNjb3BlID8/PSB0aGlzO1xuICAgIGNvbnN0IHRvcGljID0gbmV3IHNucy5Ub3BpYyhzY29wZSwgJ0ZhaWxlZCBSdW5uZXIgSW1hZ2UgQnVpbGRzJyk7XG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2Yoc2NvcGUpO1xuICAgIGNkay5Bc3BlY3RzLm9mKHN0YWNrKS5hZGQobmV3IENvZGVCdWlsZEltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIodG9waWMpKTtcbiAgICBjZGsuQXNwZWN0cy5vZihzdGFjaykuYWRkKFxuICAgICAgbmV3IEF3c0ltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIoXG4gICAgICAgIEF3c0ltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIuY3JlYXRlRmlsdGVyaW5nVG9waWMoc2NvcGUsIHRvcGljKSxcbiAgICAgICksXG4gICAgKTtcbiAgICByZXR1cm4gdG9waWM7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBDbG91ZFdhdGNoIExvZ3MgSW5zaWdodHMgc2F2ZWQgcXVlcmllcyB0aGF0IGNhbiBiZSB1c2VkIHRvIGRlYnVnIGlzc3VlcyB3aXRoIHRoZSBydW5uZXJzLlxuICAgKlxuICAgKiAqIFwiV2ViaG9vayBlcnJvcnNcIiBoZWxwcyBkaWFnbm9zZSBjb25maWd1cmF0aW9uIGlzc3VlcyB3aXRoIEdpdEh1YiBpbnRlZ3JhdGlvblxuICAgKiAqIFwiSWdub3JlZCB3ZWJob29rXCIgaGVscHMgdW5kZXJzdGFuZCB3aHkgcnVubmVycyBhcmVuJ3Qgc3RhcnRlZFxuICAgKiAqIFwiSWdub3JlZCBqb2JzIGJhc2VkIG9uIGxhYmVsc1wiIGhlbHBzIGRlYnVnIGxhYmVsIG1hdGNoaW5nIGlzc3Vlc1xuICAgKiAqIFwiV2ViaG9vayBzdGFydGVkIHJ1bm5lcnNcIiBoZWxwcyB1bmRlcnN0YW5kIHdoaWNoIHJ1bm5lcnMgd2VyZSBzdGFydGVkXG4gICAqL1xuICBwdWJsaWMgY3JlYXRlTG9nc0luc2lnaHRzUXVlcmllcygpIHtcbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ1dlYmhvb2sgZXJyb3JzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogJ0dpdEh1YiBSdW5uZXJzL1dlYmhvb2sgZXJyb3JzJyxcbiAgICAgIGxvZ0dyb3VwczogW3RoaXMud2ViaG9vay5oYW5kbGVyLmxvZ0dyb3VwXSxcbiAgICAgIHF1ZXJ5U3RyaW5nOiBuZXcgbG9ncy5RdWVyeVN0cmluZyh7XG4gICAgICAgIGZpbHRlclN0YXRlbWVudHM6IFtcbiAgICAgICAgICBgc3RyY29udGFpbnMoQGxvZ1N0cmVhbSwgXCIke3RoaXMud2ViaG9vay5oYW5kbGVyLmZ1bmN0aW9uTmFtZX1cIilgLFxuICAgICAgICAgICdsZXZlbCA9IFwiRVJST1JcIicsXG4gICAgICAgIF0sXG4gICAgICAgIHNvcnQ6ICdAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICBsaW1pdDogMTAwLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ09yY2hlc3RyYXRpb24gZXJyb3JzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogJ0dpdEh1YiBSdW5uZXJzL09yY2hlc3RyYXRpb24gZXJyb3JzJyxcbiAgICAgIGxvZ0dyb3VwczogW3NpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKV0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgJ2xldmVsID0gXCJFUlJPUlwiJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnUnVubmVyIGltYWdlIGJ1aWxkIGVycm9ycycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6ICdHaXRIdWIgUnVubmVycy9SdW5uZXIgaW1hZ2UgYnVpbGQgZXJyb3JzJyxcbiAgICAgIGxvZ0dyb3VwczogW3NpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuUlVOTkVSX0lNQUdFX0JVSUxEKV0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgJ3N0cmNvbnRhaW5zKG1lc3NhZ2UsIFwiZXJyb3JcIikgb3Igc3RyY29udGFpbnMobWVzc2FnZSwgXCJFUlJPUlwiKSBvciBzdHJjb250YWlucyhtZXNzYWdlLCBcIkVycm9yXCIpIG9yIGxldmVsID0gXCJFUlJPUlwiJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnSWdub3JlZCB3ZWJob29rcycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6ICdHaXRIdWIgUnVubmVycy9JZ25vcmVkIHdlYmhvb2tzJyxcbiAgICAgIGxvZ0dyb3VwczogW3RoaXMud2ViaG9vay5oYW5kbGVyLmxvZ0dyb3VwXSxcbiAgICAgIHF1ZXJ5U3RyaW5nOiBuZXcgbG9ncy5RdWVyeVN0cmluZyh7XG4gICAgICAgIGZpZWxkczogWydAdGltZXN0YW1wJywgJ21lc3NhZ2Uubm90aWNlJ10sXG4gICAgICAgIGZpbHRlclN0YXRlbWVudHM6IFtcbiAgICAgICAgICBgc3RyY29udGFpbnMoQGxvZ1N0cmVhbSwgXCIke3RoaXMud2ViaG9vay5oYW5kbGVyLmZ1bmN0aW9uTmFtZX1cIilgLFxuICAgICAgICAgICdzdHJjb250YWlucyhtZXNzYWdlLm5vdGljZSwgXCJJZ25vcmluZ1wiKScsXG4gICAgICAgIF0sXG4gICAgICAgIHNvcnQ6ICdAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICBsaW1pdDogMTAwLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ0lnbm9yZWQgam9icyBiYXNlZCBvbiBsYWJlbHMnLCB7XG4gICAgICBxdWVyeURlZmluaXRpb25OYW1lOiAnR2l0SHViIFJ1bm5lcnMvSWdub3JlZCBqb2JzIGJhc2VkIG9uIGxhYmVscycsXG4gICAgICBsb2dHcm91cHM6IFt0aGlzLndlYmhvb2suaGFuZGxlci5sb2dHcm91cF0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWVsZHM6IFsnQHRpbWVzdGFtcCcsICdtZXNzYWdlLm5vdGljZSddLFxuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgYHN0cmNvbnRhaW5zKEBsb2dTdHJlYW0sIFwiJHt0aGlzLndlYmhvb2suaGFuZGxlci5mdW5jdGlvbk5hbWV9XCIpYCxcbiAgICAgICAgICAnc3RyY29udGFpbnMobWVzc2FnZS5ub3RpY2UsIFwiSWdub3JpbmcgbGFiZWxzXCIpJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnV2ViaG9vayBzdGFydGVkIHJ1bm5lcnMnLCB7XG4gICAgICBxdWVyeURlZmluaXRpb25OYW1lOiAnR2l0SHViIFJ1bm5lcnMvV2ViaG9vayBzdGFydGVkIHJ1bm5lcnMnLFxuICAgICAgbG9nR3JvdXBzOiBbdGhpcy53ZWJob29rLmhhbmRsZXIubG9nR3JvdXBdLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmllbGRzOiBbJ0B0aW1lc3RhbXAnLCAnbWVzc2FnZS5zZm5JbnB1dC5qb2JVcmwnLCAnbWVzc2FnZS5zZm5JbnB1dC5qb2JMYWJlbHMnLCAnbWVzc2FnZS5zZm5JbnB1dC5sYWJlbHMnLCAnbWVzc2FnZS5zZm5JbnB1dC5wcm92aWRlciddLFxuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgYHN0cmNvbnRhaW5zKEBsb2dTdHJlYW0sIFwiJHt0aGlzLndlYmhvb2suaGFuZGxlci5mdW5jdGlvbk5hbWV9XCIpYCxcbiAgICAgICAgICAnbWVzc2FnZS5zZm5JbnB1dC5qb2JVcmwgbGlrZSAvaHR0cC4qLycsXG4gICAgICAgIF0sXG4gICAgICAgIHNvcnQ6ICdAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICBsaW1pdDogMTAwLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ1dlYmhvb2sgcmVkZWxpdmVyaWVzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogJ0dpdEh1YiBSdW5uZXJzL1dlYmhvb2sgcmVkZWxpdmVyaWVzJyxcbiAgICAgIGxvZ0dyb3VwczogW3RoaXMucmVkZWxpdmVyZXIuaGFuZGxlci5sb2dHcm91cF0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWVsZHM6IFsnQHRpbWVzdGFtcCcsICdtZXNzYWdlLm5vdGljZScsICdtZXNzYWdlLmRlbGl2ZXJ5SWQnLCAnbWVzc2FnZS5ndWlkJ10sXG4gICAgICAgIGZpbHRlclN0YXRlbWVudHM6IFtcbiAgICAgICAgICAnaXNQcmVzZW50KG1lc3NhZ2UuZGVsaXZlcnlJZCknLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuICB9XG59XG4iXX0=