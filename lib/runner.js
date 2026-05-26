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
const warm_runner_manager_function_1 = require("./warm-runner-manager-function");
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
        this.warmConfigHashes = [];
        this.deleteFailedRunnerIndex = 0;
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
            aws_cdk_lib_1.Annotations.of(this).addError('At least one runner provider is required');
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
            idleTimeoutSeconds: this.props?.idleTimeout?.toSeconds(),
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
        const idleReaper = this.idleReaper();
        const defaultIdleSeconds = (props?.idleTimeout ?? cdk.Duration.minutes(5)).toSeconds();
        const queueIdleReaperTask = new aws_cdk_lib_1.aws_stepfunctions_tasks.SqsSendMessage(this, 'Queue Idle Reaper', {
            queue: this.idleReaperQueue(idleReaper),
            queryLanguage: aws_cdk_lib_1.aws_stepfunctions.QueryLanguage.JSONATA,
            messageBody: aws_cdk_lib_1.aws_stepfunctions.TaskInput.fromObject({
                executionArn: '{% $states.context.Execution.Id %}',
                runnerName: '{% $states.context.Execution.Name %}',
                owner: '{% $states.input.owner %}',
                repo: '{% $states.input.repo %}',
                installationId: '{% $states.input.installationId %}',
                maxIdleSeconds: `{% $exists($states.input.maxIdleSeconds) ? $states.input.maxIdleSeconds : ${defaultIdleSeconds} %}`,
            }),
            outputs: '{% $states.input %}', // discard
        });
        const providerConsts = (0, providers_1.mergeConstMaps)(...this.providers.map(p => p.stepFunctionConstants()));
        const afterRunnerToken = Object.keys(providerConsts).length > 0
            ? tokenRetrieverTask.next(new aws_cdk_lib_1.aws_stepfunctions.Pass(this, 'Provider Constants', {
                parameters: providerConsts,
                resultPath: '$.consts',
            }))
            : tokenRetrieverTask;
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
                addCatchAndCleanUp: (state, next) => this.addCatchAndCleanUp(state, next),
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
        const errorHandler = new aws_cdk_lib_1.aws_stepfunctions.Parallel(this, 'Error Handler').branch(
        // we get a token for every retry because the token can expire faster than the job can timeout
        afterRunnerToken.next(jobStillQueued));
        this.addCatchAndCleanUp(errorHandler);
        const runProviders = new aws_cdk_lib_1.aws_stepfunctions.Parallel(this, 'Run Providers').branch(errorHandler);
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
    addCatchAndCleanUp(state, next) {
        this.deleteFailedRunnerFunction ?? (this.deleteFailedRunnerFunction = this.deleteFailedRunner());
        this.deleteFailedRunnerIndex++;
        const task = new aws_cdk_lib_1.aws_stepfunctions_tasks.LambdaInvoke(this, `Delete Failed Runner ${this.deleteFailedRunnerIndex}`, {
            stateName: `Delete Failed Runner ${this.deleteFailedRunnerIndex}`,
            comment: 'Clean-up failed runner from GitHub Actions (if present)',
            lambdaFunction: this.deleteFailedRunnerFunction,
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
        task.addRetry({
            errors: ['RunnerBusy'],
            interval: cdk.Duration.minutes(1),
            backoffRate: 1,
            maxAttempts: 60,
        });
        if (next) {
            const nextStart = next.startState;
            task.next(nextStart);
            task.addCatch(nextStart, {
                errors: [aws_cdk_lib_1.aws_stepfunctions.Errors.ALL],
                resultPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.DISCARD,
            });
        }
        state.addCatch(task, {
            errors: [aws_cdk_lib_1.aws_stepfunctions.Errors.ALL],
            resultPath: '$.error',
        });
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
                        aws_cdk_lib_1.Annotations.of(this).addError(`Both ${p1.node.path} and ${p2.node.path} use the same labels [${p1.labels.join(', ')}]`);
                        return;
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
            batchSize: 10,
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
     * * "Warm runner status" and "Warm runner errors" (when warm runners are configured)
     *
     * @param prefix Prefix for the query definitions. Defaults to "GitHub Runners".
     */
    createLogsInsightsQueries(prefix = 'GitHub Runners') {
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Webhook errors', {
            queryDefinitionName: `${prefix}/Webhook errors`,
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
            queryDefinitionName: `${prefix}/Orchestration errors`,
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
            queryDefinitionName: `${prefix}/Runner image build errors`,
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
            queryDefinitionName: `${prefix}/Ignored webhooks`,
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
            queryDefinitionName: `${prefix}/Ignored jobs based on labels`,
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
            queryDefinitionName: `${prefix}/Webhook started runners`,
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
            queryDefinitionName: `${prefix}/Webhook redeliveries`,
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
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Warm runner status', {
            queryDefinitionName: `${prefix}/Warm runner status`,
            logGroups: [(0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR)],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                fields: ['@timestamp', 'message.notice', 'message.input.runnerName', 'message.input.providerPath', 'message.started', 'message.stillRunning', 'message.runnerBusy'],
                filterStatements: [
                    cdk.Lazy.string({
                        produce: () => {
                            if (this.warmRunnerManager) {
                                return `strcontains(@logStream, "${this.warmRunnerManager.functionName}")`;
                            }
                            else {
                                return 'WARM RUNNERS NOT ENABLED';
                            }
                        },
                    }),
                ],
                sort: '@timestamp desc',
                limit: 200,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Warm runner errors', {
            queryDefinitionName: `${prefix}/Warm runner errors`,
            logGroups: [(0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR)],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                fields: ['@timestamp', 'message.notice', 'message.input.runnerName', 'message.error'],
                filterStatements: [
                    cdk.Lazy.string({
                        produce: () => {
                            if (this.warmRunnerManager) {
                                return `strcontains(@logStream, "${this.warmRunnerManager.functionName}")`;
                            }
                            else {
                                return 'WARM RUNNERS NOT ENABLED';
                            }
                        },
                    }),
                    'level = "ERROR"',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
    }
    /**
     * Register a warm runner config hash. All registered hashes are passed to the
     * manager Lambda via WARM_CONFIG_HASHES env var so keepers can detect stale configs.
     *
     * @internal
     */
    _registerWarmConfigHash(hash) {
        this.warmConfigHashes.push(hash);
    }
    /**
     * Lazily create shared warm runner infrastructure (Lambda, SQS queue).
     * Returns the manager Lambda and queue for use as EventBridge targets.
     *
     * @internal
     */
    _ensureWarmRunnerInfra() {
        if (this.warmRunnerManager && this.warmRunnerQueue) {
            return { lambda: this.warmRunnerManager, queue: this.warmRunnerQueue };
        }
        this.warmRunnerQueue = new aws_cdk_lib_1.aws_sqs.Queue(this, 'Warm Runner Queue', {
            visibilityTimeout: cdk.Duration.minutes(1),
        });
        this.warmRunnerManager = new warm_runner_manager_function_1.WarmRunnerManagerFunction(this, 'Warm Runner Manager', {
            description: 'Manage warm GitHub runners: fill on invoke, keep alive via SQS',
            environment: {
                GITHUB_SECRET_ARN: this.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: this.secrets.githubPrivateKey.secretArn,
                STEP_FUNCTION_ARN: this.orchestrator.stateMachineArn,
                WARM_RUNNER_QUEUE_URL: this.warmRunnerQueue.queueUrl,
                WARM_CONFIG_HASHES: cdk.Lazy.string({ produce: () => this.warmConfigHashes.join(',') }),
                ...this.extraLambdaEnv,
            },
            timeout: cdk.Duration.seconds(50),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            ...this.extraLambdaProps,
        });
        this.secrets.github.grantRead(this.warmRunnerManager);
        this.secrets.githubPrivateKey.grantRead(this.warmRunnerManager);
        this.orchestrator.grantRead(this.warmRunnerManager);
        this.orchestrator.grantStartExecution(this.warmRunnerManager);
        this.orchestrator.grantExecution(this.warmRunnerManager, 'states:StopExecution');
        this.warmRunnerManager.addEventSource(new aws_cdk_lib_1.aws_lambda_event_sources.SqsEventSource(this.warmRunnerQueue, {
            reportBatchItemFailures: true,
            maxBatchingWindow: cdk.Duration.seconds(10),
            batchSize: 10,
        }));
        this.warmRunnerQueue.grantSendMessages(this.warmRunnerManager);
        return { lambda: this.warmRunnerManager, queue: this.warmRunnerQueue };
    }
}
exports.GitHubRunners = GitHubRunners;
_a = JSII_RTTI_SYMBOL_1;
GitHubRunners[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.GitHubRunners", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVubmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3J1bm5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLHlCQUF5QjtBQUN6Qix5QkFBeUI7QUFDekIsNkJBQTZCO0FBQzdCLG1DQUFtQztBQUNuQyw2Q0FZcUI7QUFDckIsMkNBQXVDO0FBQ3ZDLHFDQUF3QztBQUN4QyxtRkFBNkU7QUFDN0UsK0VBQXlFO0FBQ3pFLDJDQVVxQjtBQUNyQix1Q0FBb0M7QUFDcEMscURBQWlEO0FBQ2pELHVEQUFtRDtBQUNuRCx5RUFBb0U7QUFDcEUsbUNBQXdGO0FBQ3hGLGlGQUEyRTtBQUMzRSx1Q0FBaUQ7QUFDakQsNkRBQStEO0FBNk0vRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBdUNHO0FBQ0gsTUFBYSxhQUFjLFNBQVEsc0JBQVM7SUFnQzFDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQVcsS0FBMEI7UUFDM0UsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQURnQyxVQUFLLEdBQUwsS0FBSyxDQUFxQjtRQVY1RCxtQkFBYyxHQUE0QixFQUFFLENBQUM7UUFHdEQsMENBQXFDLEdBQUcsS0FBSyxDQUFDO1FBRzlDLHFCQUFnQixHQUFhLEVBQUUsQ0FBQztRQUNoQyw0QkFBdUIsR0FBRyxDQUFDLENBQUM7UUFNbEMsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLGlCQUFPLENBQUMsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBRTVDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRztZQUN0QixHQUFHLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxHQUFHO1lBQ3BCLFVBQVUsRUFBRSxJQUFJLENBQUMsS0FBSyxFQUFFLFVBQVU7WUFDbEMsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxpQkFBaUI7WUFDaEQsY0FBYyxFQUFFLElBQUksQ0FBQyxvQkFBb0IsRUFBRTtZQUMz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QyxnQkFBZ0I7U0FDekIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBQ3RELElBQUksQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBQ2hFLElBQUksQ0FBQyxZQUFZLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBQ3BELElBQUksQ0FBQyxZQUFZLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUM7UUFDOUQsSUFBSSxDQUFDLFlBQVksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLGlCQUFpQixFQUFFLHNCQUFzQixDQUFDLENBQUM7UUFFakYsSUFBSSxDQUFDLGlCQUFpQixDQUFDLGNBQWMsQ0FBQyxJQUFJLHNDQUFvQixDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsZUFBZSxFQUFFO1lBQ2xHLHVCQUF1QixFQUFFLElBQUk7WUFDN0IsaUJBQWlCLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQzNDLFNBQVMsRUFBRSxFQUFFO1NBQ2QsQ0FBQyxDQUFDLENBQUM7UUFDSixJQUFJLENBQUMsZUFBZSxDQUFDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBRS9ELE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7SUFDekUsQ0FBQzs7QUF2MkJILHNDQXcyQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7XG4gIEFubm90YXRpb25zLFxuICBhd3NfY2xvdWR3YXRjaCBhcyBjbG91ZHdhdGNoLFxuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sYW1iZGEgYXMgbGFtYmRhLFxuICBhd3NfbGFtYmRhX2V2ZW50X3NvdXJjZXMgYXMgbGFtYmRhX2V2ZW50X3NvdXJjZXMsXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zbnMgYXMgc25zLFxuICBhd3Nfc3FzIGFzIHNxcyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnMgYXMgc3RlcGZ1bmN0aW9ucyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnNfdGFza3MgYXMgc3RlcGZ1bmN0aW9uc190YXNrcyxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBMYW1iZGFBY2Nlc3MgfSBmcm9tICcuL2FjY2Vzcyc7XG5pbXBvcnQgeyBEZWxldGVGYWlsZWRSdW5uZXJGdW5jdGlvbiB9IGZyb20gJy4vZGVsZXRlLWZhaWxlZC1ydW5uZXItZnVuY3Rpb24nO1xuaW1wb3J0IHsgSWRsZVJ1bm5lclJlcGVhckZ1bmN0aW9uIH0gZnJvbSAnLi9pZGxlLXJ1bm5lci1yZXBlYXItZnVuY3Rpb24nO1xuaW1wb3J0IHtcbiAgQXdzSW1hZ2VCdWlsZGVyRmFpbGVkQnVpbGROb3RpZmllcixcbiAgQ29kZUJ1aWxkSW1hZ2VCdWlsZGVyRmFpbGVkQnVpbGROb3RpZmllcixcbiAgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIsXG4gIEZhcmdhdGVSdW5uZXJQcm92aWRlcixcbiAgSUNvbXBvc2l0ZVByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIExhbWJkYVJ1bm5lclByb3ZpZGVyLFxuICBtZXJnZUNvbnN0TWFwcyxcbiAgUHJvdmlkZXJSZXRyeU9wdGlvbnMsXG59IGZyb20gJy4vcHJvdmlkZXJzJztcbmltcG9ydCB7IFNlY3JldHMgfSBmcm9tICcuL3NlY3JldHMnO1xuaW1wb3J0IHsgU2V0dXBGdW5jdGlvbiB9IGZyb20gJy4vc2V0dXAtZnVuY3Rpb24nO1xuaW1wb3J0IHsgU3RhdHVzRnVuY3Rpb24gfSBmcm9tICcuL3N0YXR1cy1mdW5jdGlvbic7XG5pbXBvcnQgeyBUb2tlblJldHJpZXZlckZ1bmN0aW9uIH0gZnJvbSAnLi90b2tlbi1yZXRyaWV2ZXItZnVuY3Rpb24nO1xuaW1wb3J0IHsgZGlzY292ZXJDZXJ0aWZpY2F0ZUZpbGVzLCBzaW5nbGV0b25Mb2dHcm91cCwgU2luZ2xldG9uTG9nVHlwZSB9IGZyb20gJy4vdXRpbHMnO1xuaW1wb3J0IHsgV2FybVJ1bm5lck1hbmFnZXJGdW5jdGlvbiB9IGZyb20gJy4vd2FybS1ydW5uZXItbWFuYWdlci1mdW5jdGlvbic7XG5pbXBvcnQgeyBHaXRodWJXZWJob29rSGFuZGxlciB9IGZyb20gJy4vd2ViaG9vayc7XG5pbXBvcnQgeyBHaXRodWJXZWJob29rUmVkZWxpdmVyeSB9IGZyb20gJy4vd2ViaG9vay1yZWRlbGl2ZXJ5JztcblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBHaXRIdWJSdW5uZXJzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2l0SHViUnVubmVyc1Byb3BzIHtcbiAgLyoqXG4gICAqIExpc3Qgb2YgcnVubmVyIHByb3ZpZGVycyB0byB1c2UuIEF0IGxlYXN0IG9uZSBwcm92aWRlciBpcyByZXF1aXJlZC4gUHJvdmlkZXIgd2lsbCBiZSBzZWxlY3RlZCB3aGVuIGl0cyBsYWJlbCBtYXRjaGVzIHRoZSBsYWJlbHMgcmVxdWVzdGVkIGJ5IHRoZSB3b3JrZmxvdyBqb2IuXG4gICAqXG4gICAqIEBkZWZhdWx0IENvZGVCdWlsZCwgTGFtYmRhIGFuZCBGYXJnYXRlIHJ1bm5lcnMgd2l0aCBhbGwgdGhlIGRlZmF1bHRzIChubyBWUEMgb3IgZGVmYXVsdCBhY2NvdW50IFZQQylcbiAgICovXG4gIHJlYWRvbmx5IHByb3ZpZGVycz86IChJUnVubmVyUHJvdmlkZXIgfCBJQ29tcG9zaXRlUHJvdmlkZXIpW107XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gcmVxdWlyZSB0aGUgYHNlbGYtaG9zdGVkYCBsYWJlbC4gSWYgYHRydWVgLCB0aGUgcnVubmVyIHdpbGwgb25seSBzdGFydCBpZiB0aGUgd29ya2Zsb3cgam9iIGV4cGxpY2l0bHkgcmVxdWVzdHMgdGhlIGBzZWxmLWhvc3RlZGAgbGFiZWwuXG4gICAqXG4gICAqIEJlIGNhcmVmdWwgd2hlbiBzZXR0aW5nIHRoaXMgdG8gYGZhbHNlYC4gQXZvaWQgc2V0dGluZyB1cCBwcm92aWRlcnMgd2l0aCBnZW5lcmljIGxhYmVsIHJlcXVpcmVtZW50cyBsaWtlIGBsaW51eGAgYXMgdGhleSBtYXkgbWF0Y2ggd29ya2Zsb3dzIHRoYXQgYXJlIG5vdCBtZWFudCB0byBydW4gb24gc2VsZi1ob3N0ZWQgcnVubmVycy5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgcmVxdWlyZVNlbGZIb3N0ZWRMYWJlbD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFZQQyB1c2VkIGZvciBhbGwgbWFuYWdlbWVudCBmdW5jdGlvbnMuIFVzZSB0aGlzIHdpdGggR2l0SHViIEVudGVycHJpc2UgU2VydmVyIGhvc3RlZCB0aGF0J3MgaW5hY2Nlc3NpYmxlIGZyb20gb3V0c2lkZSB0aGUgVlBDLlxuICAgKlxuICAgKiAqKk5vdGU6KiogVGhpcyBvbmx5IGFmZmVjdHMgbWFuYWdlbWVudCBmdW5jdGlvbnMgdGhhdCBpbnRlcmFjdCB3aXRoIEdpdEh1Yi4gTGFtYmRhIGZ1bmN0aW9ucyB0aGF0IGhlbHAgd2l0aCBydW5uZXIgaW1hZ2UgYnVpbGRpbmcgYW5kIGRvbid0IGludGVyYWN0IHdpdGggR2l0SHViIGFyZSBOT1QgYWZmZWN0ZWQgYnkgdGhpcyBzZXR0aW5nIGFuZCB3aWxsIHJ1biBvdXRzaWRlIHRoZSBWUEMuXG4gICAqXG4gICAqIE1ha2Ugc3VyZSB0aGUgc2VsZWN0ZWQgVlBDIGFuZCBzdWJuZXRzIGhhdmUgYWNjZXNzIHRvIHRoZSBmb2xsb3dpbmcgd2l0aCBlaXRoZXIgTkFUIEdhdGV3YXkgb3IgVlBDIEVuZHBvaW50czpcbiAgICogKiBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXJcbiAgICogKiBTZWNyZXRzIE1hbmFnZXJcbiAgICogKiBTUVNcbiAgICogKiBTdGVwIEZ1bmN0aW9uc1xuICAgKiAqIENsb3VkRm9ybWF0aW9uIChzdGF0dXMgZnVuY3Rpb24gb25seSlcbiAgICogKiBFQzIgKHN0YXR1cyBmdW5jdGlvbiBvbmx5KVxuICAgKiAqIEVDUiAoc3RhdHVzIGZ1bmN0aW9uIG9ubHkpXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogVlBDIHN1Ym5ldHMgdXNlZCBmb3IgYWxsIG1hbmFnZW1lbnQgZnVuY3Rpb25zLiBVc2UgdGhpcyB3aXRoIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciBob3N0ZWQgdGhhdCdzIGluYWNjZXNzaWJsZSBmcm9tIG91dHNpZGUgdGhlIFZQQy5cbiAgICpcbiAgICogKipOb3RlOioqIFRoaXMgb25seSBhZmZlY3RzIG1hbmFnZW1lbnQgZnVuY3Rpb25zIHRoYXQgaW50ZXJhY3Qgd2l0aCBHaXRIdWIuIExhbWJkYSBmdW5jdGlvbnMgdGhhdCBoZWxwIHdpdGggcnVubmVyIGltYWdlIGJ1aWxkaW5nIGFuZCBkb24ndCBpbnRlcmFjdCB3aXRoIEdpdEh1YiBhcmUgTk9UIGFmZmVjdGVkIGJ5IHRoaXMgc2V0dGluZy5cbiAgICovXG4gIHJlYWRvbmx5IHZwY1N1Ym5ldHM/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBBbGxvdyBtYW5hZ2VtZW50IGZ1bmN0aW9ucyB0byBydW4gaW4gcHVibGljIHN1Ym5ldHMuIExhbWJkYSBGdW5jdGlvbnMgaW4gYSBwdWJsaWMgc3VibmV0IGNhbiBOT1QgYWNjZXNzIHRoZSBpbnRlcm5ldC5cbiAgICpcbiAgICogKipOb3RlOioqIFRoaXMgb25seSBhZmZlY3RzIG1hbmFnZW1lbnQgZnVuY3Rpb25zIHRoYXQgaW50ZXJhY3Qgd2l0aCBHaXRIdWIuIExhbWJkYSBmdW5jdGlvbnMgdGhhdCBoZWxwIHdpdGggcnVubmVyIGltYWdlIGJ1aWxkaW5nIGFuZCBkb24ndCBpbnRlcmFjdCB3aXRoIEdpdEh1YiBhcmUgTk9UIGFmZmVjdGVkIGJ5IHRoaXMgc2V0dGluZy5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IGFsbG93UHVibGljU3VibmV0PzogYm9vbGVhbjtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXAgYXR0YWNoZWQgdG8gYWxsIG1hbmFnZW1lbnQgZnVuY3Rpb25zLiBVc2UgdGhpcyB3aXRoIHRvIHByb3ZpZGUgYWNjZXNzIHRvIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciBob3N0ZWQgaW5zaWRlIGEgVlBDLlxuICAgKlxuICAgKiAqKk5vdGU6KiogVGhpcyBvbmx5IGFmZmVjdHMgbWFuYWdlbWVudCBmdW5jdGlvbnMgdGhhdCBpbnRlcmFjdCB3aXRoIEdpdEh1Yi4gTGFtYmRhIGZ1bmN0aW9ucyB0aGF0IGhlbHAgd2l0aCBydW5uZXIgaW1hZ2UgYnVpbGRpbmcgYW5kIGRvbid0IGludGVyYWN0IHdpdGggR2l0SHViIGFyZSBOT1QgYWZmZWN0ZWQgYnkgdGhpcyBzZXR0aW5nLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIHNlY3VyaXR5R3JvdXBzfSBpbnN0ZWFkXG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwPzogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgYXR0YWNoZWQgdG8gYWxsIG1hbmFnZW1lbnQgZnVuY3Rpb25zLiBVc2UgdGhpcyB0byBwcm92aWRlIG91dGJvdW5kIGFjY2VzcyBmcm9tIG1hbmFnZW1lbnQgZnVuY3Rpb25zIHRvIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciBob3N0ZWQgaW5zaWRlIGEgVlBDLlxuICAgKlxuICAgKiAqKk5vdGU6KiogVGhpcyBvbmx5IGFmZmVjdHMgbWFuYWdlbWVudCBmdW5jdGlvbnMgdGhhdCBpbnRlcmFjdCB3aXRoIEdpdEh1Yi4gTGFtYmRhIGZ1bmN0aW9ucyB0aGF0IGhlbHAgd2l0aCBydW5uZXIgaW1hZ2UgYnVpbGRpbmcgYW5kIGRvbid0IGludGVyYWN0IHdpdGggR2l0SHViIGFyZSBOT1QgYWZmZWN0ZWQgYnkgdGhpcyBzZXR0aW5nLlxuICAgKlxuICAgKiAqKk5vdGU6KiogRGVmaW5pbmcgaW5ib3VuZCBydWxlcyBvbiB0aGlzIHNlY3VyaXR5IGdyb3VwIGRvZXMgbm90aGluZy4gVGhpcyBzZWN1cml0eSBncm91cCBvbmx5IGNvbnRyb2xzIG91dGJvdW5kIGFjY2VzcyBGUk9NIHRoZSBtYW5hZ2VtZW50IGZ1bmN0aW9ucy4gVG8gbGltaXQgYWNjZXNzIFRPIHRoZSB3ZWJob29rIG9yIHNldHVwIGZ1bmN0aW9ucywgdXNlIHtAbGluayB3ZWJob29rQWNjZXNzfSBhbmQge0BsaW5rIHNldHVwQWNjZXNzfSBpbnN0ZWFkLlxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogUGF0aCB0byBhIGNlcnRpZmljYXRlIGZpbGUgKC5wZW0gb3IgLmNydCkgb3IgYSBkaXJlY3RvcnkgY29udGFpbmluZyBjZXJ0aWZpY2F0ZSBmaWxlcyAoLnBlbSBvciAuY3J0KSByZXF1aXJlZCB0byB0cnVzdCBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIuIFVzZSB0aGlzIHdoZW4gR2l0SHViIEVudGVycHJpc2UgU2VydmVyIGNlcnRpZmljYXRlcyBhcmUgc2VsZi1zaWduZWQuXG4gICAqXG4gICAqIElmIGEgZGlyZWN0b3J5IGlzIHByb3ZpZGVkLCBhbGwgLnBlbSBhbmQgLmNydCBmaWxlcyBpbiB0aGF0IGRpcmVjdG9yeSB3aWxsIGJlIHVzZWQuIFRoZSBjZXJ0aWZpY2F0ZXMgd2lsbCBiZSBjb25jYXRlbmF0ZWQgaW50byBhIHNpbmdsZSBmaWxlIGZvciB1c2UgYnkgTm9kZS5qcy5cbiAgICpcbiAgICogWW91IG1heSBhbHNvIHdhbnQgdG8gdXNlIGN1c3RvbSBpbWFnZXMgZm9yIHlvdXIgcnVubmVyIHByb3ZpZGVycyB0aGF0IGNvbnRhaW4gdGhlIHNhbWUgY2VydGlmaWNhdGVzLiBTZWUge0BsaW5rIFJ1bm5lckltYWdlQ29tcG9uZW50LmV4dHJhQ2VydGlmaWNhdGVzfS5cbiAgICpcbiAgICogYGBgdHlwZXNjcmlwdFxuICAgKiBjb25zdCBzZWxmU2lnbmVkQ2VydGlmaWNhdGVzID0gJ2NlcnRzL2doZXMucGVtJzsgLy8gb3IgJ3BhdGgtdG8tbXktZXh0cmEtY2VydHMtZm9sZGVyJyBmb3IgYSBkaXJlY3RvcnlcbiAgICogY29uc3QgaW1hZ2VCdWlsZGVyID0gQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKHRoaXMsICdJbWFnZSBCdWlsZGVyIHdpdGggQ2VydHMnKTtcbiAgICogaW1hZ2VCdWlsZGVyLmFkZENvbXBvbmVudChSdW5uZXJJbWFnZUNvbXBvbmVudC5leHRyYUNlcnRpZmljYXRlcyhzZWxmU2lnbmVkQ2VydGlmaWNhdGVzLCAncHJpdmF0ZS1jYScpKTtcbiAgICpcbiAgICogY29uc3QgcHJvdmlkZXIgPSBuZXcgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIodGhpcywgJ0NvZGVCdWlsZCcsIHtcbiAgICogICAgIGltYWdlQnVpbGRlcjogaW1hZ2VCdWlsZGVyLFxuICAgKiB9KTtcbiAgICpcbiAgICogbmV3IEdpdEh1YlJ1bm5lcnMoXG4gICAqICAgdGhpcyxcbiAgICogICAncnVubmVycycsXG4gICAqICAge1xuICAgKiAgICAgcHJvdmlkZXJzOiBbcHJvdmlkZXJdLFxuICAgKiAgICAgZXh0cmFDZXJ0aWZpY2F0ZXM6IHNlbGZTaWduZWRDZXJ0aWZpY2F0ZXMsXG4gICAqICAgfVxuICAgKiApO1xuICAgKiBgYGBcbiAgICovXG4gIHJlYWRvbmx5IGV4dHJhQ2VydGlmaWNhdGVzPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaW1lIHRvIHdhaXQgYmVmb3JlIHN0b3BwaW5nIGEgcnVubmVyIHRoYXQgcmVtYWlucyBpZGxlLiBJZiB0aGUgdXNlciBjYW5jZWxsZWQgdGhlIGpvYiwgb3IgaWYgYW5vdGhlciBydW5uZXIgc3RvbGUgaXQsIHRoaXMgc3RvcHMgdGhlIHJ1bm5lciB0byBhdm9pZCB3YXN0aW5nIHJlc291cmNlcy5cbiAgICpcbiAgICogQGRlZmF1bHQgNSBtaW51dGVzXG4gICAqL1xuICByZWFkb25seSBpZGxlVGltZW91dD86IGNkay5EdXJhdGlvbjtcblxuICAvKipcbiAgICogTG9nZ2luZyBvcHRpb25zIGZvciB0aGUgc3RhdGUgbWFjaGluZSB0aGF0IG1hbmFnZXMgdGhlIHJ1bm5lcnMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIGxvZ3NcbiAgICovXG4gIHJlYWRvbmx5IGxvZ09wdGlvbnM/OiBMb2dPcHRpb25zO1xuXG4gIC8qKlxuICAgKiBBY2Nlc3MgY29uZmlndXJhdGlvbiBmb3IgdGhlIHNldHVwIGZ1bmN0aW9uLiBPbmNlIHlvdSBmaW5pc2ggdGhlIHNldHVwIHByb2Nlc3MsIHlvdSBjYW4gc2V0IHRoaXMgdG8gYExhbWJkYUFjY2Vzcy5ub0FjY2VzcygpYCB0byByZW1vdmUgYWNjZXNzIHRvIHRoZSBzZXR1cCBmdW5jdGlvbi4gWW91IGNhbiBhbHNvIHVzZSBgTGFtYmRhQWNjZXNzLmFwaUdhdGV3YXkoeyBhbGxvd2VkSXBzOiBbJ215LWlwLzAnXX0pYCB0byBsaW1pdCBhY2Nlc3MgdG8geW91ciBJUCBvbmx5LlxuICAgKlxuICAgKiBAZGVmYXVsdCBMYW1iZGFBY2Nlc3MubGFtYmRhVXJsKClcbiAgICovXG4gIHJlYWRvbmx5IHNldHVwQWNjZXNzPzogTGFtYmRhQWNjZXNzO1xuXG5cbiAgLyoqXG4gICAqIEFjY2VzcyBjb25maWd1cmF0aW9uIGZvciB0aGUgd2ViaG9vayBmdW5jdGlvbi4gVGhpcyBmdW5jdGlvbiBpcyBjYWxsZWQgYnkgR2l0SHViIHdoZW4gYSBuZXcgd29ya2Zsb3cgam9iIGlzIHNjaGVkdWxlZC4gRm9yIGFuIGV4dHJhIGxheWVyIG9mIHNlY3VyaXR5LCB5b3UgY2FuIHNldCB0aGlzIHRvIGBMYW1iZGFBY2Nlc3MuYXBpR2F0ZXdheSh7IGFsbG93ZWRJcHM6IExhbWJkYUFjY2Vzcy5naXRodWJXZWJob29rSXBzKCkgfSlgLlxuICAgKlxuICAgKiBZb3UgY2FuIGFsc28gc2V0IHRoaXMgdG8gYExhbWJkYUFjY2Vzcy5hcGlHYXRld2F5KHthbGxvd2VkVnBjOiB2cGMsIGFsbG93ZWRJcHM6IFsnR0hFUy5JUC5BRERSRVNTLzMyJ119KWAgaWYgeW91ciBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgaXMgaG9zdGVkIGluIGEgVlBDLiBUaGlzIHdpbGwgY3JlYXRlIGFuIEFQSSBHYXRld2F5IGVuZHBvaW50IHRoYXQncyBvbmx5IGFjY2Vzc2libGUgZnJvbSB3aXRoaW4gdGhlIFZQQy5cbiAgICpcbiAgICogKldBUk5JTkcqOiBjaGFuZ2luZyBhY2Nlc3MgdHlwZSBtYXkgY2hhbmdlIHRoZSBVUkwuIFdoZW4gdGhlIFVSTCBjaGFuZ2VzLCB5b3UgbXVzdCB1cGRhdGUgR2l0SHViIGFzIHdlbGwuXG4gICAqXG4gICAqIEBkZWZhdWx0IExhbWJkYUFjY2Vzcy5sYW1iZGFVcmwoKVxuICAgKi9cbiAgcmVhZG9ubHkgd2ViaG9va0FjY2Vzcz86IExhbWJkYUFjY2VzcztcblxuICAvKipcbiAgICogQWNjZXNzIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBzdGF0dXMgZnVuY3Rpb24uIFRoaXMgZnVuY3Rpb24gcmV0dXJucyBhIGxvdCBvZiBzZW5zaXRpdmUgaW5mb3JtYXRpb24gYWJvdXQgdGhlIHJ1bm5lciwgc28geW91IHNob3VsZCBvbmx5IGFsbG93IGFjY2VzcyB0byBpdCBmcm9tIHRydXN0ZWQgSVBzLCBpZiBhdCBhbGwuXG4gICAqXG4gICAqIEBkZWZhdWx0IExhbWJkYUFjY2Vzcy5ub0FjY2VzcygpXG4gICAqL1xuICByZWFkb25seSBzdGF0dXNBY2Nlc3M/OiBMYW1iZGFBY2Nlc3M7XG5cbiAgLyoqXG4gICAqIE9wdGlvbnMgdG8gcmV0cnkgb3BlcmF0aW9uIGluIGNhc2Ugb2YgZmFpbHVyZSBsaWtlIG1pc3NpbmcgY2FwYWNpdHksIG9yIEFQSSBxdW90YSBpc3N1ZXMuXG4gICAqXG4gICAqIEdpdEh1YiBqb2JzIHRpbWUgb3V0IGFmdGVyIG5vdCBiZWluZyBhYmxlIHRvIGdldCBhIHJ1bm5lciBmb3IgMjQgaG91cnMuIFlvdSBzaG91bGQgbm90IHJldHJ5IGZvciBtb3JlIHRoYW4gMjQgaG91cnMuXG4gICAqXG4gICAqIFRvdGFsIHRpbWUgc3BlbnQgd2FpdGluZyBjYW4gYmUgY2FsY3VsYXRlZCB3aXRoIGludGVydmFsICogKGJhY2tvZmZSYXRlIF4gbWF4QXR0ZW1wdHMpIC8gKGJhY2tvZmZSYXRlIC0gMSkuXG4gICAqXG4gICAqIEBkZWZhdWx0IHJldHJ5IDIzIHRpbWVzIHVwIHRvIGFib3V0IDI0IGhvdXJzXG4gICAqL1xuICByZWFkb25seSByZXRyeU9wdGlvbnM/OiBQcm92aWRlclJldHJ5T3B0aW9ucztcblxuICAvKipcbiAgICogT3B0aW9uYWwgTGFtYmRhIGZ1bmN0aW9uIHRvIGN1c3RvbWl6ZSBwcm92aWRlciBzZWxlY3Rpb24gbG9naWMgYW5kIGxhYmVsIGFzc2lnbm1lbnQuXG4gICAqXG4gICAqICogVGhlIGZ1bmN0aW9uIHJlY2VpdmVzIHRoZSB3ZWJob29rIHBheWxvYWQgYWxvbmcgd2l0aCBkZWZhdWx0IHByb3ZpZGVyIGFuZCBpdHMgbGFiZWxzIGFzIHtAbGluayBQcm92aWRlclNlbGVjdG9ySW5wdXR9XG4gICAqICogVGhlIGZ1bmN0aW9uIHJldHVybnMgYSBzZWxlY3RlZCBwcm92aWRlciBhbmQgaXRzIGxhYmVscyBhcyB7QGxpbmsgUHJvdmlkZXJTZWxlY3RvclJlc3VsdH1cbiAgICogKiBZb3UgY2FuIGRlY2xpbmUgdG8gcHJvdmlzaW9uIGEgcnVubmVyIGJ5IHJldHVybmluZyB1bmRlZmluZWQgYXMgdGhlIHByb3ZpZGVyIHNlbGVjdG9yIHJlc3VsdFxuICAgKiAqIFlvdSBjYW4gZnVsbHkgY3VzdG9taXplIHRoZSBsYWJlbHMgZm9yIHRoZSBhYm91dC10by1iZS1wcm92aXNpb25lZCBydW5uZXIgKGFkZCwgcmVtb3ZlLCBtb2RpZnksIGR5bmFtaWMgbGFiZWxzLCBldGMuKVxuICAgKiAqIExhYmVscyBkb24ndCBoYXZlIHRvIG1hdGNoIHRoZSBsYWJlbHMgb3JpZ2luYWxseSBjb25maWd1cmVkIGZvciB0aGUgcHJvdmlkZXIsIGJ1dCBzZWUgd2FybmluZ3MgYmVsb3dcbiAgICogKiBUaGlzIGZ1bmN0aW9uIHdpbGwgYmUgY2FsbGVkIHN5bmNocm9ub3VzbHkgZHVyaW5nIHdlYmhvb2sgcHJvY2Vzc2luZywgc28gaXQgc2hvdWxkIGJlIGZhc3QgYW5kIGVmZmljaWVudCAod2ViaG9vayBsaW1pdCBpcyAzMCBzZWNvbmRzIHRvdGFsKVxuICAgKlxuICAgKiAqKldBUk5JTkc6IEl0IGlzIHlvdXIgcmVzcG9uc2liaWxpdHkgdG8gZW5zdXJlIHRoZSBzZWxlY3RlZCBwcm92aWRlcidzIGxhYmVscyBtYXRjaCB0aGUgam9iJ3MgcmVxdWlyZWQgbGFiZWxzLiBJZiB5b3UgcmV0dXJuIHRoZSB3cm9uZyBsYWJlbHMsIHRoZSBydW5uZXIgd2lsbCBiZSBjcmVhdGVkIGJ1dCBHaXRIdWIgQWN0aW9ucyB3aWxsIG5vdCBhc3NpZ24gdGhlIGpvYiB0byBpdC4qKlxuICAgKlxuICAgKiAqKldBUk5JTkc6IFByb3ZpZGVyIHNlbGVjdGlvbiBpcyBub3QgYSBndWFyYW50ZWUgdGhhdCBhIHNwZWNpZmljIHByb3ZpZGVyIHdpbGwgYmUgYXNzaWduZWQgZm9yIHRoZSBqb2IuIEdpdEh1YiBBY3Rpb25zIG1heSBhc3NpZ24gdGhlIGpvYiB0byBhbnkgcnVubmVyIHdpdGggbWF0Y2hpbmcgbGFiZWxzLiBUaGUgcHJvdmlkZXIgc2VsZWN0b3Igb25seSBkZXRlcm1pbmVzIHdoaWNoIHByb3ZpZGVyJ3MgcnVubmVyIHdpbGwgYmUgKmNyZWF0ZWQqLCBidXQgR2l0SHViIEFjdGlvbnMgbWF5IHJvdXRlIHRoZSBqb2IgdG8gYW55IGF2YWlsYWJsZSBydW5uZXIgd2l0aCB0aGUgcmVxdWlyZWQgbGFiZWxzLioqXG4gICAqXG4gICAqICoqRm9yIHJlbGlhYmxlIHByb3ZpZGVyIGFzc2lnbm1lbnQgYmFzZWQgb24gam9iIGNoYXJhY3RlcmlzdGljcywgY29uc2lkZXIgdXNpbmcgcmVwby1sZXZlbCBydW5uZXIgcmVnaXN0cmF0aW9uIHdoZXJlIHlvdSBjYW4gY29udHJvbCB3aGljaCBydW5uZXJzIGFyZSBhdmFpbGFibGUgZm9yIHNwZWNpZmljIHJlcG9zaXRvcmllcy4gVGhpcyBpbmZvcm1hdGlvbiBpcyBhbHNvIGF2YWlsYWJsZSB3aGlsZSB1c2luZyB0aGUgc2V0dXAgd2l6YXJkLlxuICAgKlxuICAgKiBAc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzL2Jsb2IvbWFpbi9TRVRVUF9HSVRIVUIubWRcbiAgICovXG4gIHJlYWRvbmx5IHByb3ZpZGVyU2VsZWN0b3I/OiBsYW1iZGEuSUZ1bmN0aW9uO1xufVxuXG4vKipcbiAqIERlZmluZXMgd2hhdCBleGVjdXRpb24gaGlzdG9yeSBldmVudHMgYXJlIGxvZ2dlZCBhbmQgd2hlcmUgdGhleSBhcmUgbG9nZ2VkLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExvZ09wdGlvbnMge1xuICAvKipcbiAgICogVGhlIGxvZyBncm91cCB3aGVyZSB0aGUgZXhlY3V0aW9uIGhpc3RvcnkgZXZlbnRzIHdpbGwgYmUgbG9nZ2VkLlxuICAgKi9cbiAgcmVhZG9ubHkgbG9nR3JvdXBOYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBEZXRlcm1pbmVzIHdoZXRoZXIgZXhlY3V0aW9uIGRhdGEgaXMgaW5jbHVkZWQgaW4geW91ciBsb2cuXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBpbmNsdWRlRXhlY3V0aW9uRGF0YT86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERlZmluZXMgd2hpY2ggY2F0ZWdvcnkgb2YgZXhlY3V0aW9uIGhpc3RvcnkgZXZlbnRzIGFyZSBsb2dnZWQuXG4gICAqXG4gICAqIEBkZWZhdWx0IEVSUk9SXG4gICAqL1xuICByZWFkb25seSBsZXZlbD86IHN0ZXBmdW5jdGlvbnMuTG9nTGV2ZWw7XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgZGF5cyBsb2cgZXZlbnRzIGFyZSBrZXB0IGluIENsb3VkV2F0Y2ggTG9ncy4gV2hlbiB1cGRhdGluZ1xuICAgKiB0aGlzIHByb3BlcnR5LCB1bnNldHRpbmcgaXQgZG9lc24ndCByZW1vdmUgdGhlIGxvZyByZXRlbnRpb24gcG9saWN5LiBUb1xuICAgKiByZW1vdmUgdGhlIHJldGVudGlvbiBwb2xpY3ksIHNldCB0aGUgdmFsdWUgdG8gYElORklOSVRFYC5cbiAgICpcbiAgICogQGRlZmF1bHQgbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USFxuICAgKi9cbiAgcmVhZG9ubHkgbG9nUmV0ZW50aW9uPzogbG9ncy5SZXRlbnRpb25EYXlzO1xufVxuXG4vKipcbiAqIENyZWF0ZSBhbGwgdGhlIHJlcXVpcmVkIGluZnJhc3RydWN0dXJlIHRvIHByb3ZpZGUgc2VsZi1ob3N0ZWQgR2l0SHViIHJ1bm5lcnMuIEl0IGNyZWF0ZXMgYSB3ZWJob29rLCBzZWNyZXRzLCBhbmQgYSBzdGVwIGZ1bmN0aW9uIHRvIG9yY2hlc3RyYXRlIGFsbCBydW5zLiBTZWNyZXRzIGFyZSBub3QgYXV0b21hdGljYWxseSBmaWxsZWQuIFNlZSBSRUFETUUubWQgZm9yIGluc3RydWN0aW9ucyBvbiBob3cgdG8gc2V0dXAgR2l0SHViIGludGVncmF0aW9uLlxuICpcbiAqIEJ5IGRlZmF1bHQsIHRoaXMgd2lsbCBjcmVhdGUgYSBydW5uZXIgcHJvdmlkZXIgb2YgZWFjaCBhdmFpbGFibGUgdHlwZSB3aXRoIHRoZSBkZWZhdWx0cy4gVGhpcyBpcyBnb29kIGVub3VnaCBmb3IgdGhlIGluaXRpYWwgc2V0dXAgc3RhZ2Ugd2hlbiB5b3UganVzdCB3YW50IHRvIGdldCBHaXRIdWIgaW50ZWdyYXRpb24gd29ya2luZy5cbiAqXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBuZXcgR2l0SHViUnVubmVycyh0aGlzLCAncnVubmVycycpO1xuICogYGBgXG4gKlxuICogVXN1YWxseSB5b3UnZCB3YW50IHRvIGNvbmZpZ3VyZSB0aGUgcnVubmVyIHByb3ZpZGVycyBzbyB0aGUgcnVubmVycyBjYW4gcnVuIGluIGEgY2VydGFpbiBWUEMgb3IgaGF2ZSBjZXJ0YWluIHBlcm1pc3Npb25zLlxuICpcbiAqIGBgYHR5cGVzY3JpcHRcbiAqIGNvbnN0IHZwYyA9IGVjMi5WcGMuZnJvbUxvb2t1cCh0aGlzLCAndnBjJywgeyB2cGNJZDogJ3ZwYy0xMjM0NTY3JyB9KTtcbiAqIGNvbnN0IHJ1bm5lclNnID0gbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdydW5uZXIgc2VjdXJpdHkgZ3JvdXAnLCB7IHZwYzogdnBjIH0pO1xuICogY29uc3QgZGJTZyA9IGVjMi5TZWN1cml0eUdyb3VwLmZyb21TZWN1cml0eUdyb3VwSWQodGhpcywgJ2RhdGFiYXNlIHNlY3VyaXR5IGdyb3VwJywgJ3NnLTEyMzQ1NjcnKTtcbiAqIGNvbnN0IGJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ3J1bm5lciBidWNrZXQnKTtcbiAqXG4gKiAvLyBjcmVhdGUgYSBjdXN0b20gQ29kZUJ1aWxkIHByb3ZpZGVyXG4gKiBjb25zdCBteVByb3ZpZGVyID0gbmV3IENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyKFxuICogICB0aGlzLCAnY29kZWJ1aWxkIHJ1bm5lcicsXG4gKiAgIHtcbiAqICAgICAgbGFiZWxzOiBbJ215LWNvZGVidWlsZCddLFxuICogICAgICB2cGM6IHZwYyxcbiAqICAgICAgc2VjdXJpdHlHcm91cHM6IFtydW5uZXJTZ10sXG4gKiAgIH0sXG4gKiApO1xuICogLy8gZ3JhbnQgc29tZSBwZXJtaXNzaW9ucyB0byB0aGUgcHJvdmlkZXJcbiAqIGJ1Y2tldC5ncmFudFJlYWRXcml0ZShteVByb3ZpZGVyKTtcbiAqIGRiU2cuY29ubmVjdGlvbnMuYWxsb3dGcm9tKHJ1bm5lclNnLCBlYzIuUG9ydC50Y3AoMzMwNiksICdhbGxvdyBydW5uZXJzIHRvIGNvbm5lY3QgdG8gTXlTUUwgZGF0YWJhc2UnKTtcbiAqXG4gKiAvLyBjcmVhdGUgdGhlIHJ1bm5lciBpbmZyYXN0cnVjdHVyZVxuICogbmV3IEdpdEh1YlJ1bm5lcnMoXG4gKiAgIHRoaXMsXG4gKiAgICdydW5uZXJzJyxcbiAqICAge1xuICogICAgIHByb3ZpZGVyczogW215UHJvdmlkZXJdLFxuICogICB9XG4gKiApO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBHaXRIdWJSdW5uZXJzIGV4dGVuZHMgQ29uc3RydWN0IGltcGxlbWVudHMgZWMyLklDb25uZWN0YWJsZSB7XG4gIC8qKlxuICAgKiBDb25maWd1cmVkIHJ1bm5lciBwcm92aWRlcnMuXG4gICAqL1xuICByZWFkb25seSBwcm92aWRlcnM6IChJUnVubmVyUHJvdmlkZXIgfCBJQ29tcG9zaXRlUHJvdmlkZXIpW107XG5cbiAgLyoqXG4gICAqIFNlY3JldHMgZm9yIEdpdEh1YiBjb21tdW5pY2F0aW9uIGluY2x1ZGluZyB3ZWJob29rIHNlY3JldCBhbmQgcnVubmVyIGF1dGhlbnRpY2F0aW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgc2VjcmV0czogU2VjcmV0cztcblxuICAvKipcbiAgICogTWFuYWdlIHRoZSBjb25uZWN0aW9ucyBvZiBhbGwgbWFuYWdlbWVudCBmdW5jdGlvbnMuIFVzZSB0aGlzIHRvIGVuYWJsZSBjb25uZWN0aW9ucyB0byB5b3VyIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciBpbiBhIFZQQy5cbiAgICpcbiAgICogVGhpcyBjYW5ub3QgYmUgdXNlZCB0byBtYW5hZ2UgY29ubmVjdGlvbnMgb2YgdGhlIHJ1bm5lcnMuIFVzZSB0aGUgYGNvbm5lY3Rpb25zYCBwcm9wZXJ0eSBvZiBlYWNoIHJ1bm5lciBwcm92aWRlciB0byBtYW5hZ2UgcnVubmVyIGNvbm5lY3Rpb25zLlxuICAgKi9cbiAgcmVhZG9ubHkgY29ubmVjdGlvbnM6IGVjMi5Db25uZWN0aW9ucztcblxuICBwcml2YXRlIHJlYWRvbmx5IHdlYmhvb2s6IEdpdGh1YldlYmhvb2tIYW5kbGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlZGVsaXZlcmVyOiBHaXRodWJXZWJob29rUmVkZWxpdmVyeTtcbiAgcHJpdmF0ZSByZWFkb25seSBvcmNoZXN0cmF0b3I6IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldHVwVXJsOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgZXh0cmFMYW1iZGFFbnY6IHsgW3A6IHN0cmluZ106IHN0cmluZyB9ID0ge307XG4gIHByaXZhdGUgcmVhZG9ubHkgZXh0cmFMYW1iZGFQcm9wczogbGFtYmRhLkZ1bmN0aW9uT3B0aW9ucztcbiAgcHJpdmF0ZSBzdGF0ZU1hY2hpbmVMb2dHcm91cD86IGxvZ3MuTG9nR3JvdXA7XG4gIHByaXZhdGUgam9ic0NvbXBsZXRlZE1ldHJpY0ZpbHRlcnNJbml0aWFsaXplZCA9IGZhbHNlO1xuICBwcml2YXRlIHdhcm1SdW5uZXJNYW5hZ2VyPzogbGFtYmRhLkZ1bmN0aW9uO1xuICBwcml2YXRlIHdhcm1SdW5uZXJRdWV1ZT86IHNxcy5RdWV1ZTtcbiAgcHJpdmF0ZSB3YXJtQ29uZmlnSGFzaGVzOiBzdHJpbmdbXSA9IFtdO1xuICBwcml2YXRlIGRlbGV0ZUZhaWxlZFJ1bm5lckluZGV4ID0gMDtcbiAgcHJpdmF0ZSBkZWxldGVGYWlsZWRSdW5uZXJGdW5jdGlvbj86IGxhbWJkYS5JRnVuY3Rpb247XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcmVhZG9ubHkgcHJvcHM/OiBHaXRIdWJSdW5uZXJzUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuXG4gICAgdGhpcy5zZWNyZXRzID0gbmV3IFNlY3JldHModGhpcywgJ1NlY3JldHMnKTtcblxuICAgIHRoaXMuZXh0cmFMYW1iZGFQcm9wcyA9IHtcbiAgICAgIHZwYzogdGhpcy5wcm9wcz8udnBjLFxuICAgICAgdnBjU3VibmV0czogdGhpcy5wcm9wcz8udnBjU3VibmV0cyxcbiAgICAgIGFsbG93UHVibGljU3VibmV0OiB0aGlzLnByb3BzPy5hbGxvd1B1YmxpY1N1Ym5ldCxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLmxhbWJkYVNlY3VyaXR5R3JvdXBzKCksXG4gICAgICBsYXllcnM6IFtdLFxuICAgIH07XG4gICAgdGhpcy5jb25uZWN0aW9ucyA9IG5ldyBlYzIuQ29ubmVjdGlvbnMoeyBzZWN1cml0eUdyb3VwczogdGhpcy5leHRyYUxhbWJkYVByb3BzLnNlY3VyaXR5R3JvdXBzIH0pO1xuXG4gICAgdGhpcy5jcmVhdGVDZXJ0aWZpY2F0ZUxheWVyKHNjb3BlKTtcblxuICAgIGlmICh0aGlzLnByb3BzPy5wcm92aWRlcnMpIHtcbiAgICAgIHRoaXMucHJvdmlkZXJzID0gdGhpcy5wcm9wcy5wcm92aWRlcnM7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucHJvdmlkZXJzID0gW1xuICAgICAgICBuZXcgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIodGhpcywgJ0NvZGVCdWlsZCcpLFxuICAgICAgICBuZXcgTGFtYmRhUnVubmVyUHJvdmlkZXIodGhpcywgJ0xhbWJkYScpLFxuICAgICAgICBuZXcgRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyKHRoaXMsICdGYXJnYXRlJyksXG4gICAgICBdO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnByb3ZpZGVycy5sZW5ndGggPT0gMCkge1xuICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoJ0F0IGxlYXN0IG9uZSBydW5uZXIgcHJvdmlkZXIgaXMgcmVxdWlyZWQnKTtcbiAgICB9XG5cbiAgICB0aGlzLmNoZWNrSW50ZXJzZWN0aW5nTGFiZWxzKCk7XG5cbiAgICB0aGlzLm9yY2hlc3RyYXRvciA9IHRoaXMuc3RhdGVNYWNoaW5lKHByb3BzKTtcbiAgICB0aGlzLndlYmhvb2sgPSBuZXcgR2l0aHViV2ViaG9va0hhbmRsZXIodGhpcywgJ1dlYmhvb2sgSGFuZGxlcicsIHtcbiAgICAgIG9yY2hlc3RyYXRvcjogdGhpcy5vcmNoZXN0cmF0b3IsXG4gICAgICBzZWNyZXRzOiB0aGlzLnNlY3JldHMsXG4gICAgICBhY2Nlc3M6IHRoaXMucHJvcHM/LndlYmhvb2tBY2Nlc3MgPz8gTGFtYmRhQWNjZXNzLmxhbWJkYVVybCgpLFxuICAgICAgcHJvdmlkZXJzOiB0aGlzLnByb3ZpZGVycy5yZWR1Y2U8UmVjb3JkPHN0cmluZywgc3RyaW5nW10+PigoYWNjLCBwKSA9PiB7XG4gICAgICAgIGFjY1twLm5vZGUucGF0aF0gPSBwLmxhYmVscztcbiAgICAgICAgcmV0dXJuIGFjYztcbiAgICAgIH0sIHt9KSxcbiAgICAgIHJlcXVpcmVTZWxmSG9zdGVkTGFiZWw6IHRoaXMucHJvcHM/LnJlcXVpcmVTZWxmSG9zdGVkTGFiZWwgPz8gdHJ1ZSxcbiAgICAgIHByb3ZpZGVyU2VsZWN0b3I6IHRoaXMucHJvcHM/LnByb3ZpZGVyU2VsZWN0b3IsXG4gICAgICBleHRyYUxhbWJkYVByb3BzOiB0aGlzLmV4dHJhTGFtYmRhUHJvcHMsXG4gICAgICBleHRyYUxhbWJkYUVudjogdGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgIGlkbGVUaW1lb3V0U2Vjb25kczogdGhpcy5wcm9wcz8uaWRsZVRpbWVvdXQ/LnRvU2Vjb25kcygpLFxuICAgIH0pO1xuICAgIHRoaXMucmVkZWxpdmVyZXIgPSBuZXcgR2l0aHViV2ViaG9va1JlZGVsaXZlcnkodGhpcywgJ1dlYmhvb2sgUmVkZWxpdmVyeScsIHtcbiAgICAgIHNlY3JldHM6IHRoaXMuc2VjcmV0cyxcbiAgICAgIGV4dHJhTGFtYmRhUHJvcHM6IHRoaXMuZXh0cmFMYW1iZGFQcm9wcyxcbiAgICAgIGV4dHJhTGFtYmRhRW52OiB0aGlzLmV4dHJhTGFtYmRhRW52LFxuICAgIH0pO1xuXG4gICAgdGhpcy5zZXR1cFVybCA9IHRoaXMuc2V0dXBGdW5jdGlvbigpO1xuICAgIHRoaXMuc3RhdHVzRnVuY3Rpb24oKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGVNYWNoaW5lKHByb3BzPzogR2l0SHViUnVubmVyc1Byb3BzKSB7XG4gICAgY29uc3QgdG9rZW5SZXRyaWV2ZXJUYXNrID0gbmV3IHN0ZXBmdW5jdGlvbnNfdGFza3MuTGFtYmRhSW52b2tlKFxuICAgICAgdGhpcyxcbiAgICAgICdHZXQgUnVubmVyIFRva2VuJyxcbiAgICAgIHtcbiAgICAgICAgbGFtYmRhRnVuY3Rpb246IHRoaXMudG9rZW5SZXRyaWV2ZXIoKSxcbiAgICAgICAgcGF5bG9hZFJlc3BvbnNlT25seTogdHJ1ZSxcbiAgICAgICAgcmVzdWx0UGF0aDogJyQucnVubmVyJyxcbiAgICAgICAgcGF5bG9hZDogc3RlcGZ1bmN0aW9ucy5UYXNrSW5wdXQuZnJvbU9iamVjdCh7XG4gICAgICAgICAgJ293bmVyLiQnOiAnJC5vd25lcicsXG4gICAgICAgICAgJ3JlcG8uJCc6ICckLnJlcG8nLFxuICAgICAgICAgICdpbnN0YWxsYXRpb25JZC4kJzogJyQuaW5zdGFsbGF0aW9uSWQnLFxuICAgICAgICAgICdsYWJlbHMuJCc6ICckLmxhYmVscycsXG4gICAgICAgICAgJ2pvYklkLiQnOiAnJC5qb2JJZCcsXG4gICAgICAgICAgJ3J1bm5lck5hbWUuJCc6ICckJC5FeGVjdXRpb24uTmFtZScsXG4gICAgICAgIH0pLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgY29uc3QgaWRsZVJlYXBlciA9IHRoaXMuaWRsZVJlYXBlcigpO1xuICAgIGNvbnN0IGRlZmF1bHRJZGxlU2Vjb25kcyA9IChwcm9wcz8uaWRsZVRpbWVvdXQgPz8gY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkpLnRvU2Vjb25kcygpO1xuXG4gICAgY29uc3QgcXVldWVJZGxlUmVhcGVyVGFzayA9IG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLlNxc1NlbmRNZXNzYWdlKHRoaXMsICdRdWV1ZSBJZGxlIFJlYXBlcicsIHtcbiAgICAgIHF1ZXVlOiB0aGlzLmlkbGVSZWFwZXJRdWV1ZShpZGxlUmVhcGVyKSxcbiAgICAgIHF1ZXJ5TGFuZ3VhZ2U6IHN0ZXBmdW5jdGlvbnMuUXVlcnlMYW5ndWFnZS5KU09OQVRBLFxuICAgICAgbWVzc2FnZUJvZHk6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBleGVjdXRpb25Bcm46ICd7JSAkc3RhdGVzLmNvbnRleHQuRXhlY3V0aW9uLklkICV9JyxcbiAgICAgICAgcnVubmVyTmFtZTogJ3slICRzdGF0ZXMuY29udGV4dC5FeGVjdXRpb24uTmFtZSAlfScsXG4gICAgICAgIG93bmVyOiAneyUgJHN0YXRlcy5pbnB1dC5vd25lciAlfScsXG4gICAgICAgIHJlcG86ICd7JSAkc3RhdGVzLmlucHV0LnJlcG8gJX0nLFxuICAgICAgICBpbnN0YWxsYXRpb25JZDogJ3slICRzdGF0ZXMuaW5wdXQuaW5zdGFsbGF0aW9uSWQgJX0nLFxuICAgICAgICBtYXhJZGxlU2Vjb25kczogYHslICRleGlzdHMoJHN0YXRlcy5pbnB1dC5tYXhJZGxlU2Vjb25kcykgPyAkc3RhdGVzLmlucHV0Lm1heElkbGVTZWNvbmRzIDogJHtkZWZhdWx0SWRsZVNlY29uZHN9ICV9YCxcbiAgICAgIH0pLFxuICAgICAgb3V0cHV0czogJ3slICRzdGF0ZXMuaW5wdXQgJX0nLCAvLyBkaXNjYXJkXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm92aWRlckNvbnN0cyA9IG1lcmdlQ29uc3RNYXBzKC4uLnRoaXMucHJvdmlkZXJzLm1hcChwID0+IHAuc3RlcEZ1bmN0aW9uQ29uc3RhbnRzKCkpKTtcbiAgICBjb25zdCBhZnRlclJ1bm5lclRva2VuID1cbiAgICAgIE9iamVjdC5rZXlzKHByb3ZpZGVyQ29uc3RzKS5sZW5ndGggPiAwXG4gICAgICAgID8gdG9rZW5SZXRyaWV2ZXJUYXNrLm5leHQoXG4gICAgICAgICAgbmV3IHN0ZXBmdW5jdGlvbnMuUGFzcyh0aGlzLCAnUHJvdmlkZXIgQ29uc3RhbnRzJywge1xuICAgICAgICAgICAgcGFyYW1ldGVyczogcHJvdmlkZXJDb25zdHMsXG4gICAgICAgICAgICByZXN1bHRQYXRoOiAnJC5jb25zdHMnLFxuICAgICAgICAgIH0pLFxuICAgICAgICApXG4gICAgICAgIDogdG9rZW5SZXRyaWV2ZXJUYXNrO1xuXG4gICAgY29uc3QgcHJvdmlkZXJDaG9vc2VyID0gbmV3IHN0ZXBmdW5jdGlvbnMuQ2hvaWNlKHRoaXMsICdDaG9vc2UgcHJvdmlkZXInKTtcbiAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIHRoaXMucHJvdmlkZXJzKSB7XG4gICAgICBjb25zdCBwcm92aWRlclRhc2sgPSBwcm92aWRlci5nZXRTdGVwRnVuY3Rpb25UYXNrKFxuICAgICAgICB7XG4gICAgICAgICAgcnVubmVyVG9rZW5QYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnJ1bm5lci50b2tlbicpLFxuICAgICAgICAgIHJ1bm5lck5hbWVQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckJC5FeGVjdXRpb24uTmFtZScpLFxuICAgICAgICAgIGdpdGh1YkRvbWFpblBhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQucnVubmVyLmRvbWFpbicpLFxuICAgICAgICAgIG93bmVyUGF0aDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5vd25lcicpLFxuICAgICAgICAgIHJlcG9QYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnJlcG8nKSxcbiAgICAgICAgICByZWdpc3RyYXRpb25Vcmw6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQucnVubmVyLnJlZ2lzdHJhdGlvblVybCcpLFxuICAgICAgICAgIGxhYmVsc1BhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQubGFiZWxzJyksXG4gICAgICAgICAgaml0Q29uZmlnUGF0aDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5ydW5uZXIuaml0Q29uZmlnJyksXG4gICAgICAgICAgYWRkQ2F0Y2hBbmRDbGVhblVwOiAoc3RhdGUsIG5leHQpID0+IHRoaXMuYWRkQ2F0Y2hBbmRDbGVhblVwKHN0YXRlLCBuZXh0KSxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgICBwcm92aWRlckNob29zZXIud2hlbihcbiAgICAgICAgc3RlcGZ1bmN0aW9ucy5Db25kaXRpb24uYW5kKFxuICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuQ29uZGl0aW9uLnN0cmluZ0VxdWFscygnJC5wcm92aWRlcicsIHByb3ZpZGVyLm5vZGUucGF0aCksXG4gICAgICAgICksXG4gICAgICAgIHByb3ZpZGVyVGFzayxcbiAgICAgICAge1xuICAgICAgICAgIGNvbW1lbnQ6IGBMYWJlbHM6ICR7cHJvdmlkZXIubGFiZWxzLmpvaW4oJywgJyl9YCxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcHJvdmlkZXJDaG9vc2VyLm90aGVyd2lzZShuZXcgc3RlcGZ1bmN0aW9ucy5TdWNjZWVkKHRoaXMsICdVbmtub3duIGxhYmVsJykpO1xuXG4gICAgLy8gQ2hlY2sgaWYgdGhlIHRva2VuIHJldHJpZXZlciBpbmRpY2F0ZWQgdGhlIGpvYiBpcyBubyBsb25nZXIgcXVldWVkLlxuICAgIC8vIFRoaXMgcHJldmVudHMgbGF1bmNoaW5nIGEgcnVubmVyIGZvciBhIGpvYiB0aGF0IHdhcyBhbHJlYWR5IHBpY2tlZCB1cFxuICAgIC8vIGJ5IGFub3RoZXIgcnVubmVyIChjb21tb24gZHVyaW5nIHJldHJpZXMgdW5kZXIgYnVyc3QgbG9hZCkuXG4gICAgY29uc3Qgam9iU3RpbGxRdWV1ZWQgPSBuZXcgc3RlcGZ1bmN0aW9ucy5DaG9pY2UodGhpcywgJ0pvYiBTdGlsbCBRdWV1ZWQ/Jyk7XG4gICAgam9iU3RpbGxRdWV1ZWQud2hlbihcbiAgICAgIHN0ZXBmdW5jdGlvbnMuQ29uZGl0aW9uLmJvb2xlYW5FcXVhbHMoJyQucnVubmVyLnNraXAnLCB0cnVlKSxcbiAgICAgIG5ldyBzdGVwZnVuY3Rpb25zLlN1Y2NlZWQodGhpcywgJ0pvYiBBbHJlYWR5IEhhbmRsZWQnKSxcbiAgICApO1xuICAgIGpvYlN0aWxsUXVldWVkLm90aGVyd2lzZShwcm92aWRlckNob29zZXIpO1xuXG4gICAgY29uc3QgZXJyb3JIYW5kbGVyID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFyYWxsZWwodGhpcywgJ0Vycm9yIEhhbmRsZXInKS5icmFuY2goXG4gICAgICAvLyB3ZSBnZXQgYSB0b2tlbiBmb3IgZXZlcnkgcmV0cnkgYmVjYXVzZSB0aGUgdG9rZW4gY2FuIGV4cGlyZSBmYXN0ZXIgdGhhbiB0aGUgam9iIGNhbiB0aW1lb3V0XG4gICAgICBhZnRlclJ1bm5lclRva2VuLm5leHQoam9iU3RpbGxRdWV1ZWQpLFxuICAgICk7XG4gICAgdGhpcy5hZGRDYXRjaEFuZENsZWFuVXAoZXJyb3JIYW5kbGVyKTtcblxuICAgIGNvbnN0IHJ1blByb3ZpZGVycyA9IG5ldyBzdGVwZnVuY3Rpb25zLlBhcmFsbGVsKHRoaXMsICdSdW4gUHJvdmlkZXJzJykuYnJhbmNoKGVycm9ySGFuZGxlcik7XG5cbiAgICBpZiAocHJvcHM/LnJldHJ5T3B0aW9ucz8ucmV0cnkgPz8gdHJ1ZSkge1xuICAgICAgY29uc3QgaW50ZXJ2YWwgPSBwcm9wcz8ucmV0cnlPcHRpb25zPy5pbnRlcnZhbCA/PyBjZGsuRHVyYXRpb24ubWludXRlcygxKTtcbiAgICAgIGNvbnN0IG1heEF0dGVtcHRzID0gcHJvcHM/LnJldHJ5T3B0aW9ucz8ubWF4QXR0ZW1wdHMgPz8gMjM7XG4gICAgICBjb25zdCBiYWNrb2ZmUmF0ZSA9IHByb3BzPy5yZXRyeU9wdGlvbnM/LmJhY2tvZmZSYXRlID8/IDEuMztcblxuICAgICAgY29uc3QgdG90YWxTZWNvbmRzID0gaW50ZXJ2YWwudG9TZWNvbmRzKCkgKiBiYWNrb2ZmUmF0ZSAqKiBtYXhBdHRlbXB0cyAvIChiYWNrb2ZmUmF0ZSAtIDEpO1xuICAgICAgaWYgKHRvdGFsU2Vjb25kcyA+PSBjZGsuRHVyYXRpb24uZGF5cygxKS50b1NlY29uZHMoKSkge1xuICAgICAgICAvLyBodHRwczovL2RvY3MuZ2l0aHViLmNvbS9lbi9hY3Rpb25zL2hvc3RpbmcteW91ci1vd24tcnVubmVycy9tYW5hZ2luZy1zZWxmLWhvc3RlZC1ydW5uZXJzL2Fib3V0LXNlbGYtaG9zdGVkLXJ1bm5lcnMjdXNhZ2UtbGltaXRzXG4gICAgICAgIC8vIFwiSm9iIHF1ZXVlIHRpbWUgLSBFYWNoIGpvYiBmb3Igc2VsZi1ob3N0ZWQgcnVubmVycyBjYW4gYmUgcXVldWVkIGZvciBhIG1heGltdW0gb2YgMjQgaG91cnMuIElmIGEgc2VsZi1ob3N0ZWQgcnVubmVyIGRvZXMgbm90IHN0YXJ0IGV4ZWN1dGluZyB0aGUgam9iIHdpdGhpbiB0aGlzIGxpbWl0LCB0aGUgam9iIGlzIHRlcm1pbmF0ZWQgYW5kIGZhaWxzIHRvIGNvbXBsZXRlLlwiXG4gICAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoYFRvdGFsIHJldHJ5IHRpbWUgaXMgZ3JlYXRlciB0aGFuIDI0IGhvdXJzICgke01hdGguZmxvb3IodG90YWxTZWNvbmRzIC8gNjAgLyA2MCl9IGhvdXJzKS4gSm9icyBleHBpcmUgYWZ0ZXIgMjQgaG91cnMgc28gaXQgd291bGQgYmUgYSB3YXN0ZSBvZiByZXNvdXJjZXMgdG8gcmV0cnkgZnVydGhlci5gKTtcbiAgICAgIH1cblxuICAgICAgcnVuUHJvdmlkZXJzLmFkZFJldHJ5KHtcbiAgICAgICAgaW50ZXJ2YWwsXG4gICAgICAgIG1heEF0dGVtcHRzLFxuICAgICAgICBiYWNrb2ZmUmF0ZSxcbiAgICAgICAgLy8gd2UgcmV0cnkgb24gZXZlcnl0aGluZ1xuICAgICAgICAvLyBkZWxldGVkIGlkbGUgcnVubmVycyB3aWxsIGFsc28gZmFpbCwgYnV0IHRoZSByZWFwZXIgd2lsbCBzdG9wIHRoaXMgc3RlcCBmdW5jdGlvbiB0byBhdm9pZCBlbmRsZXNzIHJldHJpZXNcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGxldCBsb2dPcHRpb25zOiBjZGsuYXdzX3N0ZXBmdW5jdGlvbnMuTG9nT3B0aW9ucyB8IHVuZGVmaW5lZDtcbiAgICBpZiAodGhpcy5wcm9wcz8ubG9nT3B0aW9ucykge1xuICAgICAgdGhpcy5zdGF0ZU1hY2hpbmVMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdMb2dzJywge1xuICAgICAgICBsb2dHcm91cE5hbWU6IHByb3BzPy5sb2dPcHRpb25zPy5sb2dHcm91cE5hbWUsXG4gICAgICAgIHJldGVudGlvbjogcHJvcHM/LmxvZ09wdGlvbnM/LmxvZ1JldGVudGlvbiA/PyBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgfSk7XG5cbiAgICAgIGxvZ09wdGlvbnMgPSB7XG4gICAgICAgIGRlc3RpbmF0aW9uOiB0aGlzLnN0YXRlTWFjaGluZUxvZ0dyb3VwLFxuICAgICAgICBpbmNsdWRlRXhlY3V0aW9uRGF0YTogcHJvcHM/LmxvZ09wdGlvbnM/LmluY2x1ZGVFeGVjdXRpb25EYXRhID8/IHRydWUsXG4gICAgICAgIGxldmVsOiBwcm9wcz8ubG9nT3B0aW9ucz8ubGV2ZWwgPz8gc3RlcGZ1bmN0aW9ucy5Mb2dMZXZlbC5BTEwsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXRlTWFjaGluZSA9IG5ldyBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZShcbiAgICAgIHRoaXMsXG4gICAgICAnUnVubmVyIE9yY2hlc3RyYXRvcicsXG4gICAgICB7XG4gICAgICAgIGRlZmluaXRpb25Cb2R5OiBzdGVwZnVuY3Rpb25zLkRlZmluaXRpb25Cb2R5LmZyb21DaGFpbmFibGUocXVldWVJZGxlUmVhcGVyVGFzay5uZXh0KHJ1blByb3ZpZGVycykpLFxuICAgICAgICBsb2dzOiBsb2dPcHRpb25zLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgc3RhdGVNYWNoaW5lLmdyYW50UmVhZChpZGxlUmVhcGVyKTtcbiAgICBzdGF0ZU1hY2hpbmUuZ3JhbnRFeGVjdXRpb24oaWRsZVJlYXBlciwgJ3N0YXRlczpTdG9wRXhlY3V0aW9uJyk7XG4gICAgZm9yIChjb25zdCBwcm92aWRlciBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgcHJvdmlkZXIuZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc3RhdGVNYWNoaW5lO1xuICB9XG5cbiAgcHJpdmF0ZSB0b2tlblJldHJpZXZlcigpIHtcbiAgICBjb25zdCBmdW5jID0gbmV3IFRva2VuUmV0cmlldmVyRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ3Rva2VuLXJldHJpZXZlcicsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnR2V0IHRva2VuIGZyb20gR2l0SHViIEFjdGlvbnMgdXNlZCB0byBzdGFydCBuZXcgc2VsZi1ob3N0ZWQgcnVubmVyJyxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBHSVRIVUJfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1Yi5zZWNyZXRBcm4sXG4gICAgICAgICAgR0lUSFVCX1BSSVZBVEVfS0VZX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LnNlY3JldEFybixcbiAgICAgICAgICAuLi50aGlzLmV4dHJhTGFtYmRhRW52LFxuICAgICAgICB9LFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLk9SQ0hFU1RSQVRPUiksXG4gICAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFQcm9wcyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMuc2VjcmV0cy5naXRodWIuZ3JhbnRSZWFkKGZ1bmMpO1xuICAgIHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LmdyYW50UmVhZChmdW5jKTtcblxuICAgIHJldHVybiBmdW5jO1xuICB9XG5cbiAgcHJpdmF0ZSBkZWxldGVGYWlsZWRSdW5uZXIoKSB7XG4gICAgY29uc3QgZnVuYyA9IG5ldyBEZWxldGVGYWlsZWRSdW5uZXJGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnZGVsZXRlLXJ1bm5lcicsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnRGVsZXRlIGZhaWxlZCBHaXRIdWIgQWN0aW9ucyBydW5uZXIgb24gZXJyb3InLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIEdJVEhVQl9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViLnNlY3JldEFybixcbiAgICAgICAgICBHSVRIVUJfUFJJVkFURV9LRVlfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQoZnVuYyk7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuZ3JhbnRSZWFkKGZ1bmMpO1xuXG4gICAgcmV0dXJuIGZ1bmM7XG4gIH1cblxuICBwcml2YXRlIGFkZENhdGNoQW5kQ2xlYW5VcChzdGF0ZTogc3RlcGZ1bmN0aW9ucy5UYXNrU3RhdGVCYXNlIHwgc3RlcGZ1bmN0aW9ucy5QYXJhbGxlbCB8IHN0ZXBmdW5jdGlvbnMuTWFwLCBuZXh0Pzogc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlKSB7XG4gICAgdGhpcy5kZWxldGVGYWlsZWRSdW5uZXJGdW5jdGlvbiA/Pz0gdGhpcy5kZWxldGVGYWlsZWRSdW5uZXIoKTtcbiAgICB0aGlzLmRlbGV0ZUZhaWxlZFJ1bm5lckluZGV4Kys7XG4gICAgY29uc3QgdGFzayA9IG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLkxhbWJkYUludm9rZSh0aGlzLCBgRGVsZXRlIEZhaWxlZCBSdW5uZXIgJHt0aGlzLmRlbGV0ZUZhaWxlZFJ1bm5lckluZGV4fWAsIHtcbiAgICAgIHN0YXRlTmFtZTogYERlbGV0ZSBGYWlsZWQgUnVubmVyICR7dGhpcy5kZWxldGVGYWlsZWRSdW5uZXJJbmRleH1gLFxuICAgICAgY29tbWVudDogJ0NsZWFuLXVwIGZhaWxlZCBydW5uZXIgZnJvbSBHaXRIdWIgQWN0aW9ucyAoaWYgcHJlc2VudCknLFxuICAgICAgbGFtYmRhRnVuY3Rpb246IHRoaXMuZGVsZXRlRmFpbGVkUnVubmVyRnVuY3Rpb24sXG4gICAgICBwYXlsb2FkUmVzcG9uc2VPbmx5OiB0cnVlLFxuICAgICAgcmVzdWx0UGF0aDogJyQuZGVsZXRlJyxcbiAgICAgIHBheWxvYWQ6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBydW5uZXJOYW1lOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckJC5FeGVjdXRpb24uTmFtZScpLFxuICAgICAgICBvd25lcjogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5vd25lcicpLFxuICAgICAgICByZXBvOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnJlcG8nKSxcbiAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGgubnVtYmVyQXQoJyQuaW5zdGFsbGF0aW9uSWQnKSxcbiAgICAgICAgZXJyb3I6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGgub2JqZWN0QXQoJyQuZXJyb3InKSxcbiAgICAgIH0pLFxuICAgIH0pO1xuICAgIHRhc2suYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbJ1J1bm5lckJ1c3knXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgIGJhY2tvZmZSYXRlOiAxLFxuICAgICAgbWF4QXR0ZW1wdHM6IDYwLFxuICAgIH0pO1xuICAgIGlmIChuZXh0KSB7XG4gICAgICBjb25zdCBuZXh0U3RhcnQgPSBuZXh0LnN0YXJ0U3RhdGU7XG4gICAgICB0YXNrLm5leHQobmV4dFN0YXJ0KTtcbiAgICAgIHRhc2suYWRkQ2F0Y2gobmV4dFN0YXJ0LCB7XG4gICAgICAgIGVycm9yczogW3N0ZXBmdW5jdGlvbnMuRXJyb3JzLkFMTF0sXG4gICAgICAgIHJlc3VsdFBhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguRElTQ0FSRCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBzdGF0ZS5hZGRDYXRjaCh0YXNrLCB7XG4gICAgICBlcnJvcnM6IFtzdGVwZnVuY3Rpb25zLkVycm9ycy5BTExdLFxuICAgICAgcmVzdWx0UGF0aDogJyQuZXJyb3InLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0dXNGdW5jdGlvbigpIHtcbiAgICBjb25zdCBzdGF0dXNGdW5jdGlvbiA9IG5ldyBTdGF0dXNGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnc3RhdHVzJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdQcm92aWRlIHVzZXIgd2l0aCBzdGF0dXMgYWJvdXQgc2VsZi1ob3N0ZWQgR2l0SHViIEFjdGlvbnMgcnVubmVycycsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgV0VCSE9PS19TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMud2ViaG9vay5zZWNyZXRBcm4sXG4gICAgICAgICAgR0lUSFVCX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5zZWNyZXRBcm4sXG4gICAgICAgICAgU0VUVVBfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLnNldHVwLnNlY3JldEFybixcbiAgICAgICAgICBXRUJIT09LX1VSTDogdGhpcy53ZWJob29rLnVybCxcbiAgICAgICAgICBXRUJIT09LX0hBTkRMRVJfQVJOOiB0aGlzLndlYmhvb2suaGFuZGxlci5sYXRlc3RWZXJzaW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgICAgIFNURVBfRlVOQ1RJT05fQVJOOiB0aGlzLm9yY2hlc3RyYXRvci5zdGF0ZU1hY2hpbmVBcm4sXG4gICAgICAgICAgU1RFUF9GVU5DVElPTl9MT0dfR1JPVVA6IHRoaXMuc3RhdGVNYWNoaW5lTG9nR3JvdXA/LmxvZ0dyb3VwTmFtZSA/PyAnJyxcbiAgICAgICAgICBTRVRVUF9GVU5DVElPTl9VUkw6IHRoaXMuc2V0dXBVcmwsXG4gICAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgICAgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMyksXG4gICAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlNFVFVQKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgY29uc3QgcHJvdmlkZXJzID0gdGhpcy5wcm92aWRlcnMuZmxhdE1hcChwcm92aWRlciA9PiB7XG4gICAgICBjb25zdCBzdGF0dXMgPSBwcm92aWRlci5zdGF0dXMoc3RhdHVzRnVuY3Rpb24pO1xuICAgICAgLy8gQ29tcG9zaXRlIHByb3ZpZGVycyByZXR1cm4gYW4gYXJyYXksIHJlZ3VsYXIgcHJvdmlkZXJzIHJldHVybiBhIHNpbmdsZSBzdGF0dXNcbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHN0YXR1cykgPyBzdGF0dXMgOiBbc3RhdHVzXTtcbiAgICB9KTtcblxuICAgIC8vIGV4cG9zZSBwcm92aWRlcnMgYXMgc3RhY2sgbWV0YWRhdGEgYXMgaXQncyB0b28gYmlnIGZvciBMYW1iZGEgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gICAgLy8gc3BlY2lmaWNhbGx5IGludGVncmF0aW9uIHRlc3RpbmcgZ290IGFuIGVycm9yIGJlY2F1c2UgbGFtYmRhIHVwZGF0ZSByZXF1ZXN0IHdhcyA+NWtiXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2YodGhpcyk7XG4gICAgY29uc3QgZiA9IChzdGF0dXNGdW5jdGlvbi5ub2RlLmRlZmF1bHRDaGlsZCBhcyBsYW1iZGEuQ2ZuRnVuY3Rpb24pO1xuICAgIGYuYWRkUHJvcGVydHlPdmVycmlkZSgnRW52aXJvbm1lbnQuVmFyaWFibGVzLkxPR0lDQUxfSUQnLCBmLmxvZ2ljYWxJZCk7XG4gICAgZi5hZGRQcm9wZXJ0eU92ZXJyaWRlKCdFbnZpcm9ubWVudC5WYXJpYWJsZXMuU1RBQ0tfTkFNRScsIHN0YWNrLnN0YWNrTmFtZSk7XG4gICAgZi5hZGRNZXRhZGF0YSgncHJvdmlkZXJzJywgcHJvdmlkZXJzKTtcbiAgICBzdGF0dXNGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydjbG91ZGZvcm1hdGlvbjpEZXNjcmliZVN0YWNrUmVzb3VyY2UnXSxcbiAgICAgIHJlc291cmNlczogW3N0YWNrLnN0YWNrSWRdLFxuICAgIH0pKTtcblxuICAgIHRoaXMuc2VjcmV0cy53ZWJob29rLmdyYW50UmVhZChzdGF0dXNGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQoc3RhdHVzRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LmdyYW50UmVhZChzdGF0dXNGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLnNldHVwLmdyYW50UmVhZChzdGF0dXNGdW5jdGlvbik7XG4gICAgdGhpcy5vcmNoZXN0cmF0b3IuZ3JhbnRSZWFkKHN0YXR1c0Z1bmN0aW9uKTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KFxuICAgICAgdGhpcyxcbiAgICAgICdzdGF0dXMgY29tbWFuZCcsXG4gICAgICB7XG4gICAgICAgIHZhbHVlOiBgYXdzIC0tcmVnaW9uICR7c3RhY2sucmVnaW9ufSBsYW1iZGEgaW52b2tlIC0tZnVuY3Rpb24tbmFtZSAke3N0YXR1c0Z1bmN0aW9uLmZ1bmN0aW9uTmFtZX0gc3RhdHVzLmpzb25gLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgY29uc3QgYWNjZXNzID0gdGhpcy5wcm9wcz8uc3RhdHVzQWNjZXNzID8/IExhbWJkYUFjY2Vzcy5ub0FjY2VzcygpO1xuICAgIGNvbnN0IHVybCA9IGFjY2Vzcy5iaW5kKHRoaXMsICdzdGF0dXMgYWNjZXNzJywgc3RhdHVzRnVuY3Rpb24pO1xuXG4gICAgaWYgKHVybCAhPT0gJycpIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KFxuICAgICAgICB0aGlzLFxuICAgICAgICAnc3RhdHVzIHVybCcsXG4gICAgICAgIHtcbiAgICAgICAgICB2YWx1ZTogdXJsLFxuICAgICAgICB9LFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNldHVwRnVuY3Rpb24oKTogc3RyaW5nIHtcbiAgICBjb25zdCBzZXR1cEZ1bmN0aW9uID0gbmV3IFNldHVwRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ3NldHVwJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdTZXR1cCBHaXRIdWIgQWN0aW9ucyBpbnRlZ3JhdGlvbiB3aXRoIHNlbGYtaG9zdGVkIHJ1bm5lcnMnLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIFNFVFVQX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5zZXR1cC5zZWNyZXRBcm4sXG4gICAgICAgICAgV0VCSE9PS19TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMud2ViaG9vay5zZWNyZXRBcm4sXG4gICAgICAgICAgR0lUSFVCX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5zZWNyZXRBcm4sXG4gICAgICAgICAgV0VCSE9PS19VUkw6IHRoaXMud2ViaG9vay51cmwsXG4gICAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgICAgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMyksXG4gICAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlNFVFVQKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gdGhpcy5zZWNyZXRzLndlYmhvb2suZ3JhbnRSZWFkKHNldHVwRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy53ZWJob29rLmdyYW50V3JpdGUoc2V0dXBGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQoc2V0dXBGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFdyaXRlKHNldHVwRnVuY3Rpb24pO1xuICAgIC8vIHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LmdyYW50UmVhZChzZXR1cEZ1bmN0aW9uKTtcbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFdyaXRlKHNldHVwRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5zZXR1cC5ncmFudFJlYWQoc2V0dXBGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLnNldHVwLmdyYW50V3JpdGUoc2V0dXBGdW5jdGlvbik7XG5cbiAgICBjb25zdCBhY2Nlc3MgPSB0aGlzLnByb3BzPy5zZXR1cEFjY2VzcyA/PyBMYW1iZGFBY2Nlc3MubGFtYmRhVXJsKCk7XG4gICAgcmV0dXJuIGFjY2Vzcy5iaW5kKHRoaXMsICdzZXR1cCBhY2Nlc3MnLCBzZXR1cEZ1bmN0aW9uKTtcbiAgfVxuXG4gIHByaXZhdGUgY2hlY2tJbnRlcnNlY3RpbmdMYWJlbHMoKSB7XG4gICAgLy8gdGhpcyBcImFsZ29yaXRobVwiIGlzIHZlcnkgaW5lZmZpY2llbnQsIGJ1dCBnb29kIGVub3VnaCBmb3IgdGhlIHRpbnkgZGF0YXNldHMgd2UgZXhwZWN0XG4gICAgZm9yIChjb25zdCBwMSBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgZm9yIChjb25zdCBwMiBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgICBpZiAocDEgPT0gcDIpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAocDEubGFiZWxzLmV2ZXJ5KGwgPT4gcDIubGFiZWxzLmluY2x1ZGVzKGwpKSkge1xuICAgICAgICAgIGlmIChwMi5sYWJlbHMuZXZlcnkobCA9PiBwMS5sYWJlbHMuaW5jbHVkZXMobCkpKSB7XG4gICAgICAgICAgICBBbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcihgQm90aCAke3AxLm5vZGUucGF0aH0gYW5kICR7cDIubm9kZS5wYXRofSB1c2UgdGhlIHNhbWUgbGFiZWxzIFske3AxLmxhYmVscy5qb2luKCcsICcpfV1gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgICAgQW5ub3RhdGlvbnMub2YocDEpLmFkZFdhcm5pbmcoYExhYmVscyBbJHtwMS5sYWJlbHMuam9pbignLCAnKX1dIGludGVyc2VjdCB3aXRoIGFub3RoZXIgcHJvdmlkZXIgKCR7cDIubm9kZS5wYXRofSAtLSBbJHtwMi5sYWJlbHMuam9pbignLCAnKX1dKS4gSWYgYSB3b3JrZmxvdyBzcGVjaWZpZXMgdGhlIGxhYmVscyBbJHtwMS5sYWJlbHMuam9pbignLCAnKX1dLCBpdCBpcyBub3QgZ3VhcmFudGVlZCB3aGljaCBwcm92aWRlciB3aWxsIGJlIHVzZWQuIEl0IGlzIHJlY29tbWVuZGVkIHlvdSBkbyBub3QgdXNlIGludGVyc2VjdGluZyBsYWJlbHNgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaWRsZVJlYXBlcigpIHtcbiAgICByZXR1cm4gbmV3IElkbGVSdW5uZXJSZXBlYXJGdW5jdGlvbih0aGlzLCAnSWRsZSBSZWFwZXInLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ1N0b3AgaWRsZSBHaXRIdWIgcnVubmVycyB0byBhdm9pZCBwYXlpbmcgZm9yIHJ1bm5lcnMgd2hlbiB0aGUgam9iIHdhcyBhbHJlYWR5IGNhbmNlbGVkJyxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIEdJVEhVQl9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViLnNlY3JldEFybixcbiAgICAgICAgR0lUSFVCX1BSSVZBVEVfS0VZX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWJQcml2YXRlS2V5LnNlY3JldEFybixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgIH0sXG4gICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5PUkNIRVNUUkFUT1IpLFxuICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBpZGxlUmVhcGVyUXVldWUocmVhcGVyOiBsYW1iZGEuRnVuY3Rpb24pIHtcbiAgICAvLyBzZWUgdGhpcyBjb21tZW50IHRvIHVuZGVyc3RhbmQgd2h5IGl0J3MgYSBxdWV1ZSB0aGF0J3Mgb3V0IG9mIHRoZSBzdGVwIGZ1bmN0aW9uXG4gICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL0Nsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMvcHVsbC8zMTQjaXNzdWVjb21tZW50LTE1Mjg5MDExOTJcblxuICAgIGNvbnN0IHF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnSWRsZSBSZWFwZXIgUXVldWUnLCB7XG4gICAgICBkZWxpdmVyeURlbGF5OiBjZGsuRHVyYXRpb24ubWludXRlcygxMCksXG4gICAgICB2aXNpYmlsaXR5VGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApLFxuICAgIH0pO1xuXG4gICAgcmVhcGVyLmFkZEV2ZW50U291cmNlKG5ldyBsYW1iZGFfZXZlbnRfc291cmNlcy5TcXNFdmVudFNvdXJjZShxdWV1ZSwge1xuICAgICAgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM6IHRydWUsXG4gICAgICBtYXhCYXRjaGluZ1dpbmRvdzogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSksXG4gICAgICBiYXRjaFNpemU6IDEwLFxuICAgIH0pKTtcblxuICAgIHRoaXMuc2VjcmV0cy5naXRodWIuZ3JhbnRSZWFkKHJlYXBlcik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuZ3JhbnRSZWFkKHJlYXBlcik7XG5cbiAgICByZXR1cm4gcXVldWU7XG4gIH1cblxuICBwcml2YXRlIGxhbWJkYVNlY3VyaXR5R3JvdXBzKCkge1xuICAgIGlmICghdGhpcy5wcm9wcz8udnBjKSB7XG4gICAgICBpZiAodGhpcy5wcm9wcz8uc2VjdXJpdHlHcm91cCkge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnc2VjdXJpdHlHcm91cCBpcyBzcGVjaWZpZWQsIGJ1dCB2cGMgaXMgbm90LiBzZWN1cml0eUdyb3VwIHdpbGwgYmUgaWdub3JlZCcpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucHJvcHM/LnNlY3VyaXR5R3JvdXBzKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdzZWN1cml0eUdyb3VwcyBpcyBzcGVjaWZpZWQsIGJ1dCB2cGMgaXMgbm90LiBzZWN1cml0eUdyb3VwcyB3aWxsIGJlIGlnbm9yZWQnKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5wcm9wcy5zZWN1cml0eUdyb3Vwcykge1xuICAgICAgaWYgKHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cCkge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnQm90aCBzZWN1cml0eUdyb3VwIGFuZCBzZWN1cml0eUdyb3VwcyBhcmUgc3BlY2lmaWVkLiBzZWN1cml0eUdyb3VwIHdpbGwgYmUgaWdub3JlZCcpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cHM7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cCkge1xuICAgICAgcmV0dXJuIFt0aGlzLnByb3BzLnNlY3VyaXR5R3JvdXBdO1xuICAgIH1cblxuICAgIHJldHVybiBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdNYW5hZ2VtZW50IExhbWJkYXMgU2VjdXJpdHkgR3JvdXAnLCB7IHZwYzogdGhpcy5wcm9wcy52cGMgfSldO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3RzIGFsbCB1bmlxdWUgSVJ1bm5lclByb3ZpZGVyIGluc3RhbmNlcyBmcm9tIHByb3ZpZGVycyBhbmQgY29tcG9zaXRlIHByb3ZpZGVycyAob25lIGxldmVsIG9ubHkpLlxuICAgKiBVc2VzIGEgU2V0IHRvIGVuc3VyZSB3ZSBkb24ndCBwcm9jZXNzIHRoZSBzYW1lIHByb3ZpZGVyIHR3aWNlLCBldmVuIGlmIGl0J3MgdXNlZCBpbiBtdWx0aXBsZSBjb21wb3NpdGVzLlxuICAgKlxuICAgKiBAcmV0dXJucyBTZXQgb2YgdW5pcXVlIElSdW5uZXJQcm92aWRlciBpbnN0YW5jZXNcbiAgICovXG4gIHByaXZhdGUgZXh0cmFjdFVuaXF1ZVN1YlByb3ZpZGVycygpOiBTZXQ8SVJ1bm5lclByb3ZpZGVyPiB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8SVJ1bm5lclByb3ZpZGVyPigpO1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgIC8vIGluc3RhbmNlb2YgZG9lc24ndCByZWFsbHkgd29yayBpbiBDREsgc28gdXNlIHRoaXMgaGFjayBpbnN0ZWFkXG4gICAgICBpZiAoJ2xvZ0dyb3VwJyBpbiBwcm92aWRlcikge1xuICAgICAgICAvLyBSZWd1bGFyIHByb3ZpZGVyXG4gICAgICAgIHNlZW4uYWRkKHByb3ZpZGVyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENvbXBvc2l0ZSBwcm92aWRlciAtIGFjY2VzcyB0aGUgcHJvdmlkZXJzIGZpZWxkXG4gICAgICAgIGZvciAoY29uc3Qgc3ViUHJvdmlkZXIgb2YgcHJvdmlkZXIucHJvdmlkZXJzKSB7XG4gICAgICAgICAgc2Vlbi5hZGQoc3ViUHJvdmlkZXIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzZWVuO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBMYW1iZGEgbGF5ZXIgd2l0aCBjZXJ0aWZpY2F0ZXMgaWYgZXh0cmFDZXJ0aWZpY2F0ZXMgaXMgc3BlY2lmaWVkLlxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVDZXJ0aWZpY2F0ZUxheWVyKHNjb3BlOiBDb25zdHJ1Y3QpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMucHJvcHM/LmV4dHJhQ2VydGlmaWNhdGVzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY2VydGlmaWNhdGVGaWxlcyA9IGRpc2NvdmVyQ2VydGlmaWNhdGVGaWxlcyh0aGlzLnByb3BzLmV4dHJhQ2VydGlmaWNhdGVzKTtcblxuICAgIC8vIENvbmNhdGVuYXRlIGFsbCBjZXJ0aWZpY2F0ZXMgaW50byBhIHNpbmdsZSBmaWxlIGZvciBOT0RFX0VYVFJBX0NBX0NFUlRTXG4gICAgbGV0IGNvbWJpbmVkQ2VydENvbnRlbnQgPSAnJztcbiAgICBmb3IgKGNvbnN0IGNlcnRGaWxlIG9mIGNlcnRpZmljYXRlRmlsZXMpIHtcbiAgICAgIGNvbnN0IGNlcnRDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGNlcnRGaWxlLCAndXRmOCcpO1xuICAgICAgY29tYmluZWRDZXJ0Q29udGVudCArPSBjZXJ0Q29udGVudDtcbiAgICAgIC8vIEVuc3VyZSBwcm9wZXIgUEVNIGZvcm1hdCB3aXRoIG5ld2xpbmUgYmV0d2VlbiBjZXJ0aWZpY2F0ZXNcbiAgICAgIGlmICghY2VydENvbnRlbnQuZW5kc1dpdGgoJ1xcbicpKSB7XG4gICAgICAgIGNvbWJpbmVkQ2VydENvbnRlbnQgKz0gJ1xcbic7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGRpcmVjdG9yeSwgd3JpdGUgdGhlIGNlcnRpZmljYXRlIGZpbGUsIGNyZWF0ZSBhc3NldCwgdGhlbiBkZWxldGUgdGVtcCBkaXJcbiAgICBjb25zdCB3b3JrZGlyID0gZnMubWtkdGVtcFN5bmMocGF0aC5qb2luKG9zLnRtcGRpcigpLCAnY2VydGlmaWNhdGUtbGF5ZXItJykpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjZXJ0UGF0aCA9IHBhdGguam9pbih3b3JrZGlyLCAnY2VydHMucGVtJyk7XG4gICAgICBmcy53cml0ZUZpbGVTeW5jKGNlcnRQYXRoLCBjb21iaW5lZENlcnRDb250ZW50KTtcblxuICAgICAgLy8gU2V0IGVudmlyb25tZW50IHZhcmlhYmxlIGFuZCBjcmVhdGUgbGF5ZXJcbiAgICAgIHRoaXMuZXh0cmFMYW1iZGFFbnYuTk9ERV9FWFRSQV9DQV9DRVJUUyA9ICcvb3B0L2NlcnRzLnBlbSc7XG4gICAgICB0aGlzLmV4dHJhTGFtYmRhUHJvcHMubGF5ZXJzIS5wdXNoKFxuICAgICAgICBuZXcgbGFtYmRhLkxheWVyVmVyc2lvbihzY29wZSwgJ0NlcnRpZmljYXRlIExheWVyJywge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTGF5ZXIgY29udGFpbmluZyBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgY2VydGlmaWNhdGUocykgZm9yIGNkay1naXRodWItcnVubmVycycsXG4gICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHdvcmtkaXIpLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIC8vIENhbGxpbmcgYGZyb21Bc3NldCgpYCBoYXMgY29waWVkIGZpbGVzIHRvIHRoZSBhc3NlbWJseSwgc28gd2UgY2FuIGRlbGV0ZSB0aGUgdGVtcG9yYXJ5IGRpcmVjdG9yeS5cbiAgICAgIGZzLnJtU3luYyh3b3JrZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1ldHJpYyBmb3IgdGhlIG51bWJlciBvZiBHaXRIdWIgQWN0aW9ucyBqb2JzIGNvbXBsZXRlZC4gSXQgaGFzIGBQcm92aWRlckxhYmVsc2AgYW5kIGBTdGF0dXNgIGRpbWVuc2lvbnMuIFRoZSBzdGF0dXMgY2FuIGJlIG9uZSBvZiBcIlN1Y2NlZWRlZFwiLCBcIlN1Y2NlZWRlZFdpdGhJc3N1ZXNcIiwgXCJGYWlsZWRcIiwgXCJDYW5jZWxlZFwiLCBcIlNraXBwZWRcIiwgb3IgXCJBYmFuZG9uZWRcIi5cbiAgICpcbiAgICogKipXQVJOSU5HOioqIHRoaXMgbWV0aG9kIGNyZWF0ZXMgYSBtZXRyaWMgZmlsdGVyIGZvciBlYWNoIHByb3ZpZGVyLiBFYWNoIG1ldHJpYyBoYXMgYSBzdGF0dXMgZGltZW5zaW9uIHdpdGggc2l4IHBvc3NpYmxlIHZhbHVlcy4gVGhlc2UgcmVzb3VyY2VzIG1heSBpbmN1ciBjb3N0LlxuICAgKi9cbiAgcHVibGljIG1ldHJpY0pvYkNvbXBsZXRlZChwcm9wcz86IGNsb3Vkd2F0Y2guTWV0cmljT3B0aW9ucyk6IGNsb3Vkd2F0Y2guTWV0cmljIHtcbiAgICBpZiAoIXRoaXMuam9ic0NvbXBsZXRlZE1ldHJpY0ZpbHRlcnNJbml0aWFsaXplZCkge1xuICAgICAgLy8gd2UgY2FuJ3QgdXNlIGxvZ3MuRmlsdGVyUGF0dGVybi5zcGFjZURlbGltaXRlZCgpIGJlY2F1c2UgaXQgaGFzIG5vIHN1cHBvcnQgZm9yIHx8XG4gICAgICAvLyBzdGF0dXMgbGlzdCB0YWtlbiBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9hY3Rpb25zL3J1bm5lci9ibG9iL2JlOTYzMjMwMmNlZWY1MGJmYjM2ZWE5OThjZWE5Yzk0Yzc1ZTVkNGQvc3JjL1Nkay9EVFdlYkFwaS9XZWJBcGkvVGFza1Jlc3VsdC5jc1xuICAgICAgLy8gd2UgbmVlZCBcIi4uLlwiIGZvciBMYW1iZGEgdGhhdCBwcmVmaXhlcyBzb21lIGV4dHJhIGRhdGEgdG8gbG9nIGxpbmVzXG4gICAgICBjb25zdCBwYXR0ZXJuID0gbG9ncy5GaWx0ZXJQYXR0ZXJuLmxpdGVyYWwoJ1suLi4sIG1hcmtlciA9IFwiQ0RLR0hBXCIsIGpvYiA9IFwiSk9CXCIsIGRvbmUgPSBcIkRPTkVcIiwgbGFiZWxzLCBzdGF0dXMgPSBcIlN1Y2NlZWRlZFwiIHx8IHN0YXR1cyA9IFwiU3VjY2VlZGVkV2l0aElzc3Vlc1wiIHx8IHN0YXR1cyA9IFwiRmFpbGVkXCIgfHwgc3RhdHVzID0gXCJDYW5jZWxlZFwiIHx8IHN0YXR1cyA9IFwiU2tpcHBlZFwiIHx8IHN0YXR1cyA9IFwiQWJhbmRvbmVkXCJdJyk7XG5cbiAgICAgIC8vIEV4dHJhY3QgYWxsIHVuaXF1ZSBzdWItcHJvdmlkZXJzIGZyb20gcmVndWxhciBhbmQgY29tcG9zaXRlIHByb3ZpZGVyc1xuICAgICAgLy8gQnVpbGQgYSBzZXQgZmlyc3QgdG8gYXZvaWQgZmlsdGVyaW5nIHRoZSBzYW1lIGxvZyB0d2ljZVxuICAgICAgZm9yIChjb25zdCBwIG9mIHRoaXMuZXh0cmFjdFVuaXF1ZVN1YlByb3ZpZGVycygpKSB7XG4gICAgICAgIGNvbnN0IG1ldHJpY0ZpbHRlciA9IHAubG9nR3JvdXAuYWRkTWV0cmljRmlsdGVyKGAke3AubG9nR3JvdXAubm9kZS5pZH0gZmlsdGVyYCwge1xuICAgICAgICAgIG1ldHJpY05hbWVzcGFjZTogJ0dpdEh1YlJ1bm5lcnMnLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdKb2JDb21wbGV0ZWQnLFxuICAgICAgICAgIGZpbHRlclBhdHRlcm46IHBhdHRlcm4sXG4gICAgICAgICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICAgICAgICAvLyBjYW4ndCB3aXRoIGRpbWVuc2lvbnMgLS0gZGVmYXVsdFZhbHVlOiAwLFxuICAgICAgICAgIGRpbWVuc2lvbnM6IHtcbiAgICAgICAgICAgIFByb3ZpZGVyTGFiZWxzOiAnJGxhYmVscycsXG4gICAgICAgICAgICBTdGF0dXM6ICckc3RhdHVzJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAobWV0cmljRmlsdGVyLm5vZGUuZGVmYXVsdENoaWxkIGluc3RhbmNlb2YgbG9ncy5DZm5NZXRyaWNGaWx0ZXIpIHtcbiAgICAgICAgICBtZXRyaWNGaWx0ZXIubm9kZS5kZWZhdWx0Q2hpbGQuYWRkUHJvcGVydHlPdmVycmlkZSgnTWV0cmljVHJhbnNmb3JtYXRpb25zLjAuVW5pdCcsICdDb3VudCcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIEFubm90YXRpb25zLm9mKG1ldHJpY0ZpbHRlcikuYWRkV2FybmluZygnVW5hYmxlIHRvIHNldCBtZXRyaWMgZmlsdGVyIFVuaXQgdG8gQ291bnQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5qb2JzQ29tcGxldGVkTWV0cmljRmlsdGVyc0luaXRpYWxpemVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgIG5hbWVzcGFjZTogJ0dpdEh1YlJ1bm5lcnMnLFxuICAgICAgbWV0cmljTmFtZTogJ0pvYnNDb21wbGV0ZWQnLFxuICAgICAgdW5pdDogY2xvdWR3YXRjaC5Vbml0LkNPVU5ULFxuICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pLmF0dGFjaFRvKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIE1ldHJpYyBmb3Igc3VjY2Vzc2Z1bCBleGVjdXRpb25zLlxuICAgKlxuICAgKiBBIHN1Y2Nlc3NmdWwgZXhlY3V0aW9uIGRvZXNuJ3QgYWx3YXlzIG1lYW4gYSBydW5uZXIgd2FzIHN0YXJ0ZWQuIEl0IGNhbiBiZSBzdWNjZXNzZnVsIGV2ZW4gd2l0aG91dCBhbnkgbGFiZWwgbWF0Y2hlcy5cbiAgICpcbiAgICogQSBzdWNjZXNzZnVsIHJ1bm5lciBkb2Vzbid0IG1lYW4gdGhlIGpvYiBpdCBleGVjdXRlZCB3YXMgc3VjY2Vzc2Z1bC4gRm9yIHRoYXQsIHNlZSB7QGxpbmsgbWV0cmljSm9iQ29tcGxldGVkfS5cbiAgICovXG4gIHB1YmxpYyBtZXRyaWNTdWNjZWVkZWQocHJvcHM/OiBjbG91ZHdhdGNoLk1ldHJpY09wdGlvbnMpOiBjbG91ZHdhdGNoLk1ldHJpYyB7XG4gICAgcmV0dXJuIHRoaXMub3JjaGVzdHJhdG9yLm1ldHJpY1N1Y2NlZWRlZChwcm9wcyk7XG4gIH1cblxuICAvKipcbiAgICogTWV0cmljIGZvciBmYWlsZWQgcnVubmVyIGV4ZWN1dGlvbnMuXG4gICAqXG4gICAqIEEgZmFpbGVkIHJ1bm5lciB1c3VhbGx5IG1lYW5zIHRoZSBydW5uZXIgZmFpbGVkIHRvIHN0YXJ0IGFuZCBzbyBhIGpvYiB3YXMgbmV2ZXIgZXhlY3V0ZWQuIEl0IGRvZXNuJ3QgbmVjZXNzYXJpbHkgbWVhbiB0aGUgam9iIHdhcyBleGVjdXRlZCBhbmQgZmFpbGVkLiBGb3IgdGhhdCwgc2VlIHtAbGluayBtZXRyaWNKb2JDb21wbGV0ZWR9LlxuICAgKi9cbiAgcHVibGljIG1ldHJpY0ZhaWxlZChwcm9wcz86IGNsb3Vkd2F0Y2guTWV0cmljT3B0aW9ucyk6IGNsb3Vkd2F0Y2guTWV0cmljIHtcbiAgICByZXR1cm4gdGhpcy5vcmNoZXN0cmF0b3IubWV0cmljRmFpbGVkKHByb3BzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBNZXRyaWMgZm9yIHRoZSBpbnRlcnZhbCwgaW4gbWlsbGlzZWNvbmRzLCBiZXR3ZWVuIHRoZSB0aW1lIHRoZSBleGVjdXRpb24gc3RhcnRzIGFuZCB0aGUgdGltZSBpdCBjbG9zZXMuIFRoaXMgdGltZSBtYXkgYmUgbG9uZ2VyIHRoYW4gdGhlIHRpbWUgdGhlIHJ1bm5lciB0b29rLlxuICAgKi9cbiAgcHVibGljIG1ldHJpY1RpbWUocHJvcHM/OiBjbG91ZHdhdGNoLk1ldHJpY09wdGlvbnMpOiBjbG91ZHdhdGNoLk1ldHJpYyB7XG4gICAgcmV0dXJuIHRoaXMub3JjaGVzdHJhdG9yLm1ldHJpY1RpbWUocHJvcHMpO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSB0b3BpYyBmb3Igbm90aWZpY2F0aW9ucyB3aGVuIGEgcnVubmVyIGltYWdlIGJ1aWxkIGZhaWxzLlxuICAgKlxuICAgKiBSdW5uZXIgaW1hZ2VzIGFyZSByZWJ1aWx0IGV2ZXJ5IHdlZWsgYnkgZGVmYXVsdC4gVGhpcyBwcm92aWRlcyB0aGUgbGF0ZXN0IEdpdEh1YiBSdW5uZXIgdmVyc2lvbiBhbmQgc29mdHdhcmUgdXBkYXRlcy5cbiAgICpcbiAgICogSWYgeW91IHdhbnQgdG8gYmUgc3VyZSB5b3UgYXJlIHVzaW5nIHRoZSBsYXRlc3QgcnVubmVyIHZlcnNpb24sIHlvdSBjYW4gdXNlIHRoaXMgdG9waWMgdG8gYmUgbm90aWZpZWQgd2hlbiBhIGJ1aWxkIGZhaWxzLlxuICAgKlxuICAgKiBXaGVuIHRoZSBpbWFnZSBidWlsZGVyIGlzIGRlZmluZWQgaW4gYSBzZXBhcmF0ZSBzdGFjayAoZS5nLiBpbiBhIHNwbGl0LXN0YWNrcyBzZXR1cCksIHBhc3MgdGhhdCBzdGFjayBvciBjb25zdHJ1Y3RcbiAgICogYXMgdGhlIG9wdGlvbmFsIHNjb3BlIHNvIHRoZSB0b3BpYyBhbmQgZmFpbHVyZS1ub3RpZmljYXRpb24gYXNwZWN0cyBhcmUgY3JlYXRlZCBpbiB0aGUgc2FtZSBzdGFjayBhcyB0aGUgaW1hZ2VcbiAgICogYnVpbGRlci4gT3RoZXJ3aXNlIHRoZSBhc3BlY3RzIG1heSBub3QgZmluZCB0aGUgaW1hZ2UgYnVpbGRlciByZXNvdXJjZXMuXG4gICAqXG4gICAqIEBwYXJhbSBzY29wZSBPcHRpb25hbCBzY29wZSAoZS5nLiB0aGUgaW1hZ2UgYnVpbGRlciBzdGFjaykgd2hlcmUgdGhlIHRvcGljIGFuZCBhc3BlY3RzIHdpbGwgYmUgY3JlYXRlZC4gRGVmYXVsdHMgdG8gdGhpcyBjb25zdHJ1Y3QuXG4gICAqL1xuICBwdWJsaWMgZmFpbGVkSW1hZ2VCdWlsZHNUb3BpYyhzY29wZT86IENvbnN0cnVjdCkge1xuICAgIHNjb3BlID8/PSB0aGlzO1xuICAgIGNvbnN0IHRvcGljID0gbmV3IHNucy5Ub3BpYyhzY29wZSwgJ0ZhaWxlZCBSdW5uZXIgSW1hZ2UgQnVpbGRzJyk7XG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2Yoc2NvcGUpO1xuICAgIGNkay5Bc3BlY3RzLm9mKHN0YWNrKS5hZGQobmV3IENvZGVCdWlsZEltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIodG9waWMpKTtcbiAgICBjZGsuQXNwZWN0cy5vZihzdGFjaykuYWRkKFxuICAgICAgbmV3IEF3c0ltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIoXG4gICAgICAgIEF3c0ltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIuY3JlYXRlRmlsdGVyaW5nVG9waWMoc2NvcGUsIHRvcGljKSxcbiAgICAgICksXG4gICAgKTtcbiAgICByZXR1cm4gdG9waWM7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBDbG91ZFdhdGNoIExvZ3MgSW5zaWdodHMgc2F2ZWQgcXVlcmllcyB0aGF0IGNhbiBiZSB1c2VkIHRvIGRlYnVnIGlzc3VlcyB3aXRoIHRoZSBydW5uZXJzLlxuICAgKlxuICAgKiAqIFwiV2ViaG9vayBlcnJvcnNcIiBoZWxwcyBkaWFnbm9zZSBjb25maWd1cmF0aW9uIGlzc3VlcyB3aXRoIEdpdEh1YiBpbnRlZ3JhdGlvblxuICAgKiAqIFwiSWdub3JlZCB3ZWJob29rXCIgaGVscHMgdW5kZXJzdGFuZCB3aHkgcnVubmVycyBhcmVuJ3Qgc3RhcnRlZFxuICAgKiAqIFwiSWdub3JlZCBqb2JzIGJhc2VkIG9uIGxhYmVsc1wiIGhlbHBzIGRlYnVnIGxhYmVsIG1hdGNoaW5nIGlzc3Vlc1xuICAgKiAqIFwiV2ViaG9vayBzdGFydGVkIHJ1bm5lcnNcIiBoZWxwcyB1bmRlcnN0YW5kIHdoaWNoIHJ1bm5lcnMgd2VyZSBzdGFydGVkXG4gICAqICogXCJXYXJtIHJ1bm5lciBzdGF0dXNcIiBhbmQgXCJXYXJtIHJ1bm5lciBlcnJvcnNcIiAod2hlbiB3YXJtIHJ1bm5lcnMgYXJlIGNvbmZpZ3VyZWQpXG4gICAqXG4gICAqIEBwYXJhbSBwcmVmaXggUHJlZml4IGZvciB0aGUgcXVlcnkgZGVmaW5pdGlvbnMuIERlZmF1bHRzIHRvIFwiR2l0SHViIFJ1bm5lcnNcIi5cbiAgICovXG4gIHB1YmxpYyBjcmVhdGVMb2dzSW5zaWdodHNRdWVyaWVzKHByZWZpeCA9ICdHaXRIdWIgUnVubmVycycpIHtcbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ1dlYmhvb2sgZXJyb3JzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogYCR7cHJlZml4fS9XZWJob29rIGVycm9yc2AsXG4gICAgICBsb2dHcm91cHM6IFt0aGlzLndlYmhvb2suaGFuZGxlci5sb2dHcm91cF0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgYHN0cmNvbnRhaW5zKEBsb2dTdHJlYW0sIFwiJHt0aGlzLndlYmhvb2suaGFuZGxlci5mdW5jdGlvbk5hbWV9XCIpYCxcbiAgICAgICAgICAnbGV2ZWwgPSBcIkVSUk9SXCInLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdPcmNoZXN0cmF0aW9uIGVycm9ycycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vT3JjaGVzdHJhdGlvbiBlcnJvcnNgLFxuICAgICAgbG9nR3JvdXBzOiBbc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5PUkNIRVNUUkFUT1IpXSxcbiAgICAgIHF1ZXJ5U3RyaW5nOiBuZXcgbG9ncy5RdWVyeVN0cmluZyh7XG4gICAgICAgIGZpbHRlclN0YXRlbWVudHM6IFtcbiAgICAgICAgICAnbGV2ZWwgPSBcIkVSUk9SXCInLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdSdW5uZXIgaW1hZ2UgYnVpbGQgZXJyb3JzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogYCR7cHJlZml4fS9SdW5uZXIgaW1hZ2UgYnVpbGQgZXJyb3JzYCxcbiAgICAgIGxvZ0dyb3VwczogW3NpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuUlVOTkVSX0lNQUdFX0JVSUxEKV0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgJ3N0cmNvbnRhaW5zKG1lc3NhZ2UsIFwiZXJyb3JcIikgb3Igc3RyY29udGFpbnMobWVzc2FnZSwgXCJFUlJPUlwiKSBvciBzdHJjb250YWlucyhtZXNzYWdlLCBcIkVycm9yXCIpIG9yIGxldmVsID0gXCJFUlJPUlwiJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnSWdub3JlZCB3ZWJob29rcycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vSWdub3JlZCB3ZWJob29rc2AsXG4gICAgICBsb2dHcm91cHM6IFt0aGlzLndlYmhvb2suaGFuZGxlci5sb2dHcm91cF0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWVsZHM6IFsnQHRpbWVzdGFtcCcsICdtZXNzYWdlLm5vdGljZSddLFxuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgYHN0cmNvbnRhaW5zKEBsb2dTdHJlYW0sIFwiJHt0aGlzLndlYmhvb2suaGFuZGxlci5mdW5jdGlvbk5hbWV9XCIpYCxcbiAgICAgICAgICAnc3RyY29udGFpbnMobWVzc2FnZS5ub3RpY2UsIFwiSWdub3JpbmdcIiknLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdJZ25vcmVkIGpvYnMgYmFzZWQgb24gbGFiZWxzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogYCR7cHJlZml4fS9JZ25vcmVkIGpvYnMgYmFzZWQgb24gbGFiZWxzYCxcbiAgICAgIGxvZ0dyb3VwczogW3RoaXMud2ViaG9vay5oYW5kbGVyLmxvZ0dyb3VwXSxcbiAgICAgIHF1ZXJ5U3RyaW5nOiBuZXcgbG9ncy5RdWVyeVN0cmluZyh7XG4gICAgICAgIGZpZWxkczogWydAdGltZXN0YW1wJywgJ21lc3NhZ2Uubm90aWNlJ10sXG4gICAgICAgIGZpbHRlclN0YXRlbWVudHM6IFtcbiAgICAgICAgICBgc3RyY29udGFpbnMoQGxvZ1N0cmVhbSwgXCIke3RoaXMud2ViaG9vay5oYW5kbGVyLmZ1bmN0aW9uTmFtZX1cIilgLFxuICAgICAgICAgICdzdHJjb250YWlucyhtZXNzYWdlLm5vdGljZSwgXCJJZ25vcmluZyBsYWJlbHNcIiknLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdXZWJob29rIHN0YXJ0ZWQgcnVubmVycycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vV2ViaG9vayBzdGFydGVkIHJ1bm5lcnNgLFxuICAgICAgbG9nR3JvdXBzOiBbdGhpcy53ZWJob29rLmhhbmRsZXIubG9nR3JvdXBdLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmllbGRzOiBbJ0B0aW1lc3RhbXAnLCAnbWVzc2FnZS5zZm5JbnB1dC5qb2JVcmwnLCAnbWVzc2FnZS5zZm5JbnB1dC5qb2JMYWJlbHMnLCAnbWVzc2FnZS5zZm5JbnB1dC5sYWJlbHMnLCAnbWVzc2FnZS5zZm5JbnB1dC5wcm92aWRlciddLFxuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgYHN0cmNvbnRhaW5zKEBsb2dTdHJlYW0sIFwiJHt0aGlzLndlYmhvb2suaGFuZGxlci5mdW5jdGlvbk5hbWV9XCIpYCxcbiAgICAgICAgICAnbWVzc2FnZS5zZm5JbnB1dC5qb2JVcmwgbGlrZSAvaHR0cC4qLycsXG4gICAgICAgIF0sXG4gICAgICAgIHNvcnQ6ICdAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICBsaW1pdDogMTAwLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ1dlYmhvb2sgcmVkZWxpdmVyaWVzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogYCR7cHJlZml4fS9XZWJob29rIHJlZGVsaXZlcmllc2AsXG4gICAgICBsb2dHcm91cHM6IFt0aGlzLnJlZGVsaXZlcmVyLmhhbmRsZXIubG9nR3JvdXBdLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmllbGRzOiBbJ0B0aW1lc3RhbXAnLCAnbWVzc2FnZS5ub3RpY2UnLCAnbWVzc2FnZS5kZWxpdmVyeUlkJywgJ21lc3NhZ2UuZ3VpZCddLFxuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgJ2lzUHJlc2VudChtZXNzYWdlLmRlbGl2ZXJ5SWQpJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnV2FybSBydW5uZXIgc3RhdHVzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogYCR7cHJlZml4fS9XYXJtIHJ1bm5lciBzdGF0dXNgLFxuICAgICAgbG9nR3JvdXBzOiBbc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5PUkNIRVNUUkFUT1IpXSxcbiAgICAgIHF1ZXJ5U3RyaW5nOiBuZXcgbG9ncy5RdWVyeVN0cmluZyh7XG4gICAgICAgIGZpZWxkczogWydAdGltZXN0YW1wJywgJ21lc3NhZ2Uubm90aWNlJywgJ21lc3NhZ2UuaW5wdXQucnVubmVyTmFtZScsICdtZXNzYWdlLmlucHV0LnByb3ZpZGVyUGF0aCcsICdtZXNzYWdlLnN0YXJ0ZWQnLCAnbWVzc2FnZS5zdGlsbFJ1bm5pbmcnLCAnbWVzc2FnZS5ydW5uZXJCdXN5J10sXG4gICAgICAgIGZpbHRlclN0YXRlbWVudHM6IFtcbiAgICAgICAgICBjZGsuTGF6eS5zdHJpbmcoe1xuICAgICAgICAgICAgcHJvZHVjZTogKCkgPT4ge1xuICAgICAgICAgICAgICBpZiAodGhpcy53YXJtUnVubmVyTWFuYWdlcikge1xuICAgICAgICAgICAgICAgIHJldHVybiBgc3RyY29udGFpbnMoQGxvZ1N0cmVhbSwgXCIke3RoaXMud2FybVJ1bm5lck1hbmFnZXIuZnVuY3Rpb25OYW1lfVwiKWA7XG4gICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICdXQVJNIFJVTk5FUlMgTk9UIEVOQUJMRUQnO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0pLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDIwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdXYXJtIHJ1bm5lciBlcnJvcnMnLCB7XG4gICAgICBxdWVyeURlZmluaXRpb25OYW1lOiBgJHtwcmVmaXh9L1dhcm0gcnVubmVyIGVycm9yc2AsXG4gICAgICBsb2dHcm91cHM6IFtzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLk9SQ0hFU1RSQVRPUildLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmllbGRzOiBbJ0B0aW1lc3RhbXAnLCAnbWVzc2FnZS5ub3RpY2UnLCAnbWVzc2FnZS5pbnB1dC5ydW5uZXJOYW1lJywgJ21lc3NhZ2UuZXJyb3InXSxcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgIGNkay5MYXp5LnN0cmluZyh7XG4gICAgICAgICAgICBwcm9kdWNlOiAoKSA9PiB7XG4gICAgICAgICAgICAgIGlmICh0aGlzLndhcm1SdW5uZXJNYW5hZ2VyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBzdHJjb250YWlucyhAbG9nU3RyZWFtLCBcIiR7dGhpcy53YXJtUnVubmVyTWFuYWdlci5mdW5jdGlvbk5hbWV9XCIpYDtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1dBUk0gUlVOTkVSUyBOT1QgRU5BQkxFRCc7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSksXG4gICAgICAgICAgJ2xldmVsID0gXCJFUlJPUlwiJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlciBhIHdhcm0gcnVubmVyIGNvbmZpZyBoYXNoLiBBbGwgcmVnaXN0ZXJlZCBoYXNoZXMgYXJlIHBhc3NlZCB0byB0aGVcbiAgICogbWFuYWdlciBMYW1iZGEgdmlhIFdBUk1fQ09ORklHX0hBU0hFUyBlbnYgdmFyIHNvIGtlZXBlcnMgY2FuIGRldGVjdCBzdGFsZSBjb25maWdzLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBfcmVnaXN0ZXJXYXJtQ29uZmlnSGFzaChoYXNoOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLndhcm1Db25maWdIYXNoZXMucHVzaChoYXNoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYXppbHkgY3JlYXRlIHNoYXJlZCB3YXJtIHJ1bm5lciBpbmZyYXN0cnVjdHVyZSAoTGFtYmRhLCBTUVMgcXVldWUpLlxuICAgKiBSZXR1cm5zIHRoZSBtYW5hZ2VyIExhbWJkYSBhbmQgcXVldWUgZm9yIHVzZSBhcyBFdmVudEJyaWRnZSB0YXJnZXRzLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBfZW5zdXJlV2FybVJ1bm5lckluZnJhKCk6IHsgbGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247IHF1ZXVlOiBzcXMuUXVldWUgfSB7XG4gICAgaWYgKHRoaXMud2FybVJ1bm5lck1hbmFnZXIgJiYgdGhpcy53YXJtUnVubmVyUXVldWUpIHtcbiAgICAgIHJldHVybiB7IGxhbWJkYTogdGhpcy53YXJtUnVubmVyTWFuYWdlciwgcXVldWU6IHRoaXMud2FybVJ1bm5lclF1ZXVlIH07XG4gICAgfVxuXG4gICAgdGhpcy53YXJtUnVubmVyUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdXYXJtIFJ1bm5lciBRdWV1ZScsIHtcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICB9KTtcblxuICAgIHRoaXMud2FybVJ1bm5lck1hbmFnZXIgPSBuZXcgV2FybVJ1bm5lck1hbmFnZXJGdW5jdGlvbih0aGlzLCAnV2FybSBSdW5uZXIgTWFuYWdlcicsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnTWFuYWdlIHdhcm0gR2l0SHViIHJ1bm5lcnM6IGZpbGwgb24gaW52b2tlLCBrZWVwIGFsaXZlIHZpYSBTUVMnLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgR0lUSFVCX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICBHSVRIVUJfUFJJVkFURV9LRVlfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICBTVEVQX0ZVTkNUSU9OX0FSTjogdGhpcy5vcmNoZXN0cmF0b3Iuc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgICBXQVJNX1JVTk5FUl9RVUVVRV9VUkw6IHRoaXMud2FybVJ1bm5lclF1ZXVlLnF1ZXVlVXJsLFxuICAgICAgICBXQVJNX0NPTkZJR19IQVNIRVM6IGNkay5MYXp5LnN0cmluZyh7IHByb2R1Y2U6ICgpID0+IHRoaXMud2FybUNvbmZpZ0hhc2hlcy5qb2luKCcsJykgfSksXG4gICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNTApLFxuICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICAuLi50aGlzLmV4dHJhTGFtYmRhUHJvcHMsXG4gICAgfSk7XG5cbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViLmdyYW50UmVhZCh0aGlzLndhcm1SdW5uZXJNYW5hZ2VyKTtcbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFJlYWQodGhpcy53YXJtUnVubmVyTWFuYWdlcik7XG4gICAgdGhpcy5vcmNoZXN0cmF0b3IuZ3JhbnRSZWFkKHRoaXMud2FybVJ1bm5lck1hbmFnZXIpO1xuICAgIHRoaXMub3JjaGVzdHJhdG9yLmdyYW50U3RhcnRFeGVjdXRpb24odGhpcy53YXJtUnVubmVyTWFuYWdlcik7XG4gICAgdGhpcy5vcmNoZXN0cmF0b3IuZ3JhbnRFeGVjdXRpb24odGhpcy53YXJtUnVubmVyTWFuYWdlciwgJ3N0YXRlczpTdG9wRXhlY3V0aW9uJyk7XG5cbiAgICB0aGlzLndhcm1SdW5uZXJNYW5hZ2VyLmFkZEV2ZW50U291cmNlKG5ldyBsYW1iZGFfZXZlbnRfc291cmNlcy5TcXNFdmVudFNvdXJjZSh0aGlzLndhcm1SdW5uZXJRdWV1ZSwge1xuICAgICAgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM6IHRydWUsXG4gICAgICBtYXhCYXRjaGluZ1dpbmRvdzogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxuICAgICAgYmF0Y2hTaXplOiAxMCxcbiAgICB9KSk7XG4gICAgdGhpcy53YXJtUnVubmVyUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXModGhpcy53YXJtUnVubmVyTWFuYWdlcik7XG5cbiAgICByZXR1cm4geyBsYW1iZGE6IHRoaXMud2FybVJ1bm5lck1hbmFnZXIsIHF1ZXVlOiB0aGlzLndhcm1SdW5uZXJRdWV1ZSB9O1xuICB9XG59XG4iXX0=