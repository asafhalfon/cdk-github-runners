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
exports.GitHubRunners = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const access_1 = require("./access");
const delete_failed_runner_function_1 = require("./delete-failed-runner-function");
const idle_runner_repear_function_1 = require("./idle-runner-repear-function");
const lambda_common_1 = require("./lambda-common");
const providers_1 = require("./providers");
const secrets_1 = require("./secrets");
const setup_function_1 = require("./setup-function");
const status_function_1 = require("./status-function");
const stolen_runners_1 = require("./stolen-runners");
const token_retriever_function_1 = require("./token-retriever-function");
const utils_1 = require("./utils");
const warm_runner_manager_function_1 = require("./warm-runner-manager-function");
const webhook_1 = require("./webhook");
const webhook_redelivery_1 = require("./webhook-redelivery");
/**
 * One state machine fragment per runner family. Each fragment reads the provider config out of the execution state,
 * so the state machine doesn't grow with the number of providers.
 */
const FAMILY_FRAGMENTS = new Map([
    [providers_1.CodeBuildRunnerProvider._FAMILY, providers_1.CodeBuildRunnerProvider._stateMachineFragment],
    [providers_1.Ec2RunnerProvider._FAMILY, providers_1.Ec2RunnerProvider._stateMachineFragment],
    [providers_1.EcsRunnerProvider._FAMILY, providers_1.EcsRunnerProvider._stateMachineFragment],
    [providers_1.FargateRunnerProvider._FAMILY, providers_1.FargateRunnerProvider._stateMachineFragment],
    [providers_1.LambdaRunnerProvider._FAMILY, providers_1.LambdaRunnerProvider._stateMachineFragment],
]);
/**
 * JSONata expression that points `$.providerParams` at `configExpr` and merges the standard runner tags into its `tags` field. Also handles
 * distribution in one simple step.
 *
 * Tags are included even for provider that may not use them for debugging purposes. They are visible in the step function state.
 *
 * The standard tags only have values at runtime, so providers can't bake them in at synth time. Provider tags can override our tags, except for the
 * `GitHubRunners:` prefixed ones, which providers reject at synth. That keeps `GitHubRunners:Runner`, used for instance termination, as something
 * only we can set. It also prevents duplicate tags from reaching ec2:RunInstances that doesn't like those.
 *
 * `GitHubRunners:Provider` should name the provider that actually runs the job, which is not `$.provider` when we got here through a composite, so
 * the config's own `provider` field wins when it has one.
 *
 * `runnerGroup` and `defaultLabels` get defaults so an unknown provider, whose lookup finds nothing, still produces params the next states can read.
 * Without it the token retriever fails on a missing reference path instead of reaching `Unknown provider`.
 *
 * Labels are tagged as they come in, so the tag shows what the runner registers with, warm runner and provider selector labels included. Configs
 * that ask for `cleanLabels` get the same labels with spaces instead of the commas ECS rejects, and anything else it rejects as an underscore.
 */
function selectProviderParams(scope, configExpr) {
    return `$merge([
    $states.input,
    {'providerParams': (
      $selected := ${configExpr};
      $r := $random() * $selected.totalWeight;
      $config := $exists($selected.distribute) ? $selected.distribute[threshold > $r][0].config : $selected;
      $merge([{'family': 'provider not found', 'runnerGroup': '', 'defaultLabels': []}, $config, {'tags': $append(
        [
          {'Key': 'Name', 'Value': $states.context.Execution.Name},
          {'Key': '${lambda_common_1.ReservedTags.STACK}', 'Value': '${cdk.Stack.of(scope).stackName}'},
          {'Key': '${lambda_common_1.ReservedTags.PROVIDER}', 'Value': $config.provider},
          {'Key': '${lambda_common_1.ReservedTags.REPO}', 'Value': $states.input.owner & '/' & $states.input.repo},
          {'Key': '${lambda_common_1.ReservedTags.LABELS}', 'Value': $config.cleanLabels ? $replace($join($split($states.input.labels, ','), ' '), /[^A-Za-z0-9 _.:\\/=+@-]/, '_') : $states.input.labels},
          {'Key': '${lambda_common_1.ReservedTags.RUNNER}', 'Value': $states.context.Execution.Name}
        ][$not(Key in $config.tags.Key)],
        $config.tags)}])
    )}
  ])`;
}
/**
 * Every family a provider config can reach, walking fallback chains and distribution lists.
 */
function configFamilies(config) {
    if (!config) {
        return [];
    }
    if ('distribute' in config) {
        return config.distribute.flatMap(option => configFamilies(option.config));
    }
    return [config.family, ...configFamilies(config.fallback)];
}
/**
 * Big static strings the fragments read from `$.config`, like the EC2 userdata templates. They stay out of the
 * per-provider configs because every provider of the family shares them.
 */
const FAMILY_CONSTANTS = new Map([
    [providers_1.Ec2RunnerProvider._FAMILY, providers_1.Ec2RunnerProvider._stateMachineConstants],
]);
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
    props;
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.GitHubRunners", version: "0.0.0" };
    /**
     * Configured runner providers.
     */
    providers;
    /**
     * Secrets for GitHub communication including webhook secret and runner authentication.
     */
    secrets;
    /**
     * Manage the connections of all management functions. Use this to enable connections to your GitHub Enterprise Server in a VPC.
     *
     * This cannot be used to manage connections of the runners. Use the `connections` property of each runner provider to manage runner connections.
     */
    connections;
    webhook;
    redeliverer;
    orchestrator;
    stolenRunnerDetector;
    setupUrl;
    extraLambdaEnv = {};
    extraLambdaProps;
    stateMachineLogGroup;
    parameterizedProviders = [];
    jobsCompletedMetricFiltersInitialized = false;
    stolenRunnersMetricFilterInitialized = false;
    stoppedRunnersMetricFilterInitialized = false;
    multipleProvidersMetricFilterInitialized = false;
    warmRunnerManager;
    warmRunnerQueue;
    warmConfigHashes = [];
    warmMaxDuration = 0;
    idleReaperFunction;
    managementFunctions = [];
    constructor(scope, id, props) {
        super(scope, id);
        this.props = props;
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
        // the state machine only knows how to run the built-in providers
        // instanceof doesn't really work in CDK so duck-type instead
        for (const provider of this.providers) {
            if (!(0, providers_1.isParameterizedRunnerProvider)(provider)) {
                aws_cdk_lib_1.Annotations.of(provider).addError('Custom runner providers are not supported. Use the built-in providers, or open an issue describing your use case.');
                continue;
            }
            this.parameterizedProviders.push(provider);
        }
        this.idleReaperFunction = this.idleReaper();
        this.orchestrator = this.stateMachine(props);
        this.stolenRunnerDetector = new stolen_runners_1.StolenRunnerDetector(this, 'Stolen Runners', {
            secrets: this.secrets,
            orchestrator: this.orchestrator,
            runnerLogGroups: [...this.extractUniqueSubProviders()].map(p => p.logGroup),
            extraLambdaProps: this.extraLambdaProps,
            extraLambdaEnv: this.extraLambdaEnv,
        });
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
            stolenRunnerQueue: this.stolenRunnerDetector.queue,
            extraLambdaProps: this.extraLambdaProps,
            extraLambdaEnv: this.extraLambdaEnv,
            idleTimeoutSeconds: this.props?.idleTimeout?.toSeconds(),
        });
        this.stolenRunnerDetector.grantRecordRunners(this.webhook.handler);
        this.stolenRunnerDetector.grantRecordRunners(this.idleReaperFunction);
        this.redeliverer = new webhook_redelivery_1.GithubWebhookRedelivery(this, 'Webhook Redelivery', {
            secrets: this.secrets,
            extraLambdaProps: this.extraLambdaProps,
            extraLambdaEnv: this.extraLambdaEnv,
        });
        this.managementFunctions.push(this.webhook.handler, this.redeliverer.handler, this.stolenRunnerDetector.handler);
        this.setupUrl = this.setupFunction();
        this.statusFunction();
    }
    stateMachine(props) {
        // runs after the config is selected so it can check the selected config against the GitHub setup, and fail before any provider starts an
        // instance, a build, or a task
        const tokenRetrieverTask = new aws_cdk_lib_1.aws_stepfunctions_tasks.LambdaInvoke(this, 'Get Runner Token', {
            lambdaFunction: this.tokenRetriever(),
            payloadResponseOnly: true,
            resultPath: '$.runner',
            payload: aws_cdk_lib_1.aws_stepfunctions.TaskInput.fromObject({
                owner: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.owner'),
                repo: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.repo'),
                runnerName: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$$.Execution.Name'),
                installationId: aws_cdk_lib_1.aws_stepfunctions.JsonPath.numberAt('$.installationId'),
                group: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.providerParams.runnerGroup'),
                labels: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.labels'),
                defaultLabels: aws_cdk_lib_1.aws_stepfunctions.JsonPath.listAt('$.providerParams.defaultLabels'),
            }),
        });
        const defaultIdleSeconds = (props?.idleTimeout ?? cdk.Duration.minutes(5)).toSeconds();
        const queueIdleReaperTask = new aws_cdk_lib_1.aws_stepfunctions_tasks.SqsSendMessage(this, 'Queue Idle Reaper', {
            queue: this.idleReaperQueue(this.idleReaperFunction),
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
        // we embed every provider's config in the definition and look it up by the provider path the webhook sends
        // the fragments then read it from $.providerParams, so one fragment per family runs any number of providers
        const providerConfigs = {};
        const usedFamilies = new Set();
        for (const provider of this.parameterizedProviders) {
            const providerConfig = provider._runnerConfig();
            providerConfigs[provider.node.path] = providerConfig;
            for (const family of configFamilies(providerConfig)) {
                if (!FAMILY_FRAGMENTS.has(family)) {
                    aws_cdk_lib_1.Annotations.of(provider).addError(`Unknown runner family "${family}". Available families are: ${[...FAMILY_FRAGMENTS.keys()].sort().join(', ')}.`);
                    continue;
                }
                usedFamilies.add(family);
            }
        }
        const families = [...usedFamilies].sort();
        const providerConsts = {};
        for (const family of families) {
            Object.assign(providerConsts, FAMILY_CONSTANTS.get(family)?.() ?? {});
        }
        const configPass = new aws_cdk_lib_1.aws_stepfunctions.Pass(this, 'Load Config', {
            // variables that don't need to be part of the state
            // states are limited to 256kb but variables can have up to 10mb
            // easier to debug with smaller states too
            assign: {
                providerConfigs,
                ...providerConsts,
            },
        });
        const selectConfig = new aws_cdk_lib_1.aws_stepfunctions.Pass(this, 'Select Provider Config', {
            queryLanguage: aws_cdk_lib_1.aws_stepfunctions.QueryLanguage.JSONATA,
            outputs: `{% ${selectProviderParams(this, '$lookup($providerConfigs, $states.input.provider)')} %}`,
        });
        const providerFamilyChooser = new aws_cdk_lib_1.aws_stepfunctions.Choice(this, 'Choose Provider Family');
        // one fragment per family in use, with stable construct IDs so adding or removing providers doesn't change the state machine
        for (const family of families) {
            const builder = FAMILY_FRAGMENTS.get(family);
            providerFamilyChooser.when(aws_cdk_lib_1.aws_stepfunctions.Condition.stringEquals('$.providerParams.family', family), builder(this));
        }
        providerFamilyChooser.otherwise(new aws_cdk_lib_1.aws_stepfunctions.Succeed(this, 'Unknown provider'));
        // a config can chain a fallback to try when it fails (CompositeProvider.fallback, EC2 subnets)
        // this parallel catches the failure, cleans up the runner, and loops back with the next config
        const tryProvider = new aws_cdk_lib_1.aws_stepfunctions.Parallel(this, 'Try Provider').branch(providerFamilyChooser);
        const fallbackCleanup = new aws_cdk_lib_1.aws_stepfunctions_tasks.LambdaInvoke(this, 'Clean Up Failed Runner', {
            comment: 'Clean-up failed runner from GitHub Actions (if present)',
            lambdaFunction: this.deleteFailedRunner(),
            payloadResponseOnly: true,
            resultPath: '$.delete',
            payload: aws_cdk_lib_1.aws_stepfunctions.TaskInput.fromObject({
                runnerName: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$$.Execution.Name'),
                owner: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.owner'),
                repo: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.repo'),
                installationId: aws_cdk_lib_1.aws_stepfunctions.JsonPath.numberAt('$.installationId'),
                family: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.providerParams.family'),
                // always there as the catch below puts it there. only logged so failure reasons can be seen without state machine logging
                error: aws_cdk_lib_1.aws_stepfunctions.JsonPath.objectAt('$.error'),
            }),
        });
        // any error means we can't be sure the runner is gone. we don't try to tell them apart (#1007)
        fallbackCleanup.addRetry({
            errors: [aws_cdk_lib_1.aws_stepfunctions.Errors.ALL],
            interval: cdk.Duration.minutes(1),
            backoffRate: 1,
            maxAttempts: 60,
        });
        const fallbackChoice = new aws_cdk_lib_1.aws_stepfunctions.Choice(this, 'Fallback Configured?');
        const useFallback = new aws_cdk_lib_1.aws_stepfunctions.Pass(this, 'Use Fallback Config', {
            queryLanguage: aws_cdk_lib_1.aws_stepfunctions.QueryLanguage.JSONATA,
            outputs: `{% ${selectProviderParams(this, '$states.input.providerParams.fallback')} %}`,
        });
        const allFailed = new aws_cdk_lib_1.aws_stepfunctions.Fail(this, 'All Attempts Failed', {
            // re-raise the last error so the outer catch and retry see the original failure
            // it's a state of its own so a red clean-up always means the clean-up itself broke (#989)
            comment: 'Fail the execution with the original error that stopped the runner',
            errorPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.error.Error'),
            causePath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.error.Cause'),
        });
        // we couldn't delete the runner, so any further attempt would probably fail to register under the same name. we stop the whole execution instead
        // of wasting resources on runners that won't even be able to register. the cleanup can fail with any error, so this state gives them all one name
        // that the outer retry can skip. the original error is kept in the cause.
        // we stop the execution, but at this point either:
        //   * the runner is still running a job: a new runner wouldn't help and would just be extra.
        //   * permanent failure (e.g. missing permissions): the user has to fix it anyway. starting a new runner will not help.
        //   * GitHub outage longer than an hour: a.k.a. monday morning but either way acceptable point to give up.
        // the idle reaper keeps watching runners of failed executions, so whatever is left behind still gets cleaned up.
        const runnerNotDeleted = new aws_cdk_lib_1.aws_stepfunctions.Fail(this, 'Runner Not Deleted', {
            comment: 'Give up on this runner without retrying as it would fail to register under the same name',
            error: 'RunnerNotDeleted',
            causePath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.delete.Cause'),
        });
        tryProvider.addCatch(fallbackCleanup, { errors: [aws_cdk_lib_1.aws_stepfunctions.Errors.ALL], resultPath: '$.error' });
        fallbackCleanup.next(fallbackChoice);
        fallbackCleanup.addCatch(runnerNotDeleted, { errors: [aws_cdk_lib_1.aws_stepfunctions.Errors.ALL], resultPath: '$.delete' });
        fallbackChoice.when(aws_cdk_lib_1.aws_stepfunctions.Condition.isPresent('$.providerParams.fallback'), useFallback);
        fallbackChoice.otherwise(allFailed);
        // fallback can have a different group, OS, or architecture so each fallback gets a JIT config of its own
        useFallback.next(tokenRetrieverTask);
        // one parallel is enough now: the fallback loop above already cleaned up the runner before it gave up
        // we used to need two nested ones just to clean up before the retry, because Retry runs before Catch
        const runProviders = new aws_cdk_lib_1.aws_stepfunctions.Parallel(this, 'Run Providers').branch(
        // we get a JIT config for every retry and every fallback, because the clean-up before them deletes the runner it registered
        selectConfig.next(tokenRetrieverTask).next(tryProvider));
        if (props?.retryOptions?.retry ?? true) {
            // we aim to wait at most 24 hours because that's when github jobs time out
            const interval = props?.retryOptions?.interval ?? cdk.Duration.minutes(1);
            // a shorter maxDelay needs more attempts to cover the same 24 hours, and every attempt costs execution history
            // events that Step Functions caps at 25,000. measured on this state machine, a failed attempt costs 25 events
            // for a provider with no fallback and 73 for a four config fallback chain, so 210 attempts land around 15,000
            // while a 5 minute cap would need ~600 attempts and go right past it
            //
            // those are normal path numbers and not a ceiling. a longer fallback chain costs more. an attempt whose clean-up
            // keeps failing costs 793, but that ends the execution so it only happens once
            //
            // if the execution history limit does hit, we will end give up on this runner. this would only happen when we
            // are having lots of issues provisioning a runners. stolen runner detector may end up replacing it when the
            // errors finally stop.
            const maxDelay = props?.retryOptions?.maxDelay ?? cdk.Duration.minutes(15);
            const maxAttempts = props?.retryOptions?.maxAttempts ?? 210;
            const backoffRate = props?.retryOptions?.backoffRate ?? 2;
            // jitter picks a random wait between zero and the interval, so we wait half of it on average
            // we aim a bit over 24 hours so most jobs keep retrying for the whole day they can wait
            // if we do stop early, the job will steal another runner and the stolen runner detector will replace it
            //
            // the wait grows geometrically until it hits maxDelay and stays there, so the total is a geometric
            // series plus a flat tail. maxAttempts is a public option, so we don't want to loop over it
            const growingAttempts = backoffRate > 1
                ? Math.min(maxAttempts, Math.max(0, Math.ceil(Math.log(maxDelay.toSeconds() / interval.toSeconds()) / Math.log(backoffRate))))
                : (interval.toSeconds() < maxDelay.toSeconds() ? maxAttempts : 0);
            const growingSeconds = backoffRate === 1
                ? interval.toSeconds() * growingAttempts
                : interval.toSeconds() * (backoffRate ** growingAttempts - 1) / (backoffRate - 1);
            const totalSeconds = (growingSeconds + (maxAttempts - growingAttempts) * maxDelay.toSeconds()) / 2;
            // the default overshoots 24 hours on purpose, so only complain when it's clearly more than a job can use
            if (totalSeconds >= cdk.Duration.hours(30).toSeconds()) {
                // https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners#usage-limits
                // "Job queue time - Each job for self-hosted runners can be queued for a maximum of 24 hours. If a self-hosted runner does not start
                // executing the job within this limit, the job is terminated and fails to complete."
                aws_cdk_lib_1.Annotations.of(this).addWarning(`Average total retry time is ${Math.floor(totalSeconds / 60 / 60)} hours. Jobs expire after 24`
                    + ' hours so it would be a waste of resources to retry further.');
            }
            // see `runnerNotDeleted` above
            runProviders.addRetry({
                errors: ['RunnerNotDeleted'],
                maxAttempts: 0,
            });
            runProviders.addRetry({
                interval,
                maxDelay,
                maxAttempts,
                backoffRate,
                // without jitter every runner that failed on the same missing capacity or API quota comes back at the exact same time
                jitterStrategy: aws_cdk_lib_1.aws_stepfunctions.JitterType.FULL,
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
            definitionBody: aws_cdk_lib_1.aws_stepfunctions.DefinitionBody.fromChainable(queueIdleReaperTask.next(configPass).next(runProviders)),
            definitionSubstitutions: (0, utils_1.dedupeStateMachineTokens)(this, { providerConfigs, providerConsts }),
            logs: logOptions,
        });
        stateMachine.grantRead(this.idleReaperFunction);
        stateMachine.grantExecution(this.idleReaperFunction, 'states:StopExecution');
        for (const provider of this.parameterizedProviders) {
            provider._grantStateMachine(stateMachine);
        }
        return stateMachine;
    }
    tokenRetriever() {
        const func = new token_retriever_function_1.TokenRetrieverFunction(this, 'token-retriever', {
            description: 'Get just-in-time config from GitHub Actions used to start new self-hosted runner',
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
        this.managementFunctions.push(func);
        return func;
    }
    /**
     * Let a cleanup function terminate EC2 instances that outlived their job.
     */
    grantRunnerInstanceCleanup(func) {
        func.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['ec2:DescribeInstances'],
            resources: ['*'],
        }));
        func.addToRolePolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['ec2:TerminateInstances'],
            resources: ['*'],
            conditions: {
                // this is a runner from our stack
                StringEquals: {
                    [`ec2:ResourceTag/${lambda_common_1.ReservedTags.STACK}`]: cdk.Stack.of(this).stackName,
                },
                // "the tag exists", whatever runner name is in it
                Null: {
                    [`ec2:ResourceTag/${lambda_common_1.ReservedTags.RUNNER}`]: 'false',
                },
            },
        }));
        func.addEnvironment('STACK_NAME', cdk.Stack.of(this).stackName);
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
        this.grantRunnerInstanceCleanup(func);
        this.managementFunctions.push(func);
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
        // composite providers return an array of statuses, regular providers return a single status
        const providers = this.parameterizedProviders.flatMap(provider => provider._status(statusFunction));
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
        this.managementFunctions.push(statusFunction);
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
        this.managementFunctions.push(setupFunction);
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
                // GitHub labels are case-insensitive
                const p1Labels = p1.labels.map(l => l.toLowerCase());
                const p2Labels = p2.labels.map(l => l.toLowerCase());
                if (p1Labels.every(l => p2Labels.includes(l))) {
                    if (p2Labels.every(l => p1Labels.includes(l))) {
                        aws_cdk_lib_1.Annotations.of(this).addError(`Both ${p1.node.path} and ${p2.node.path} use the same labels [${p1.labels.join(', ')}]`);
                        return;
                    }
                    aws_cdk_lib_1.Annotations.of(p1).addWarning(`Labels [${p1.labels.join(', ')}] intersect with another provider (${p2.node.path} -- [${p2.labels.join(', ')}]). If a workflow specifies the labels [${p1.labels.join(', ')}], it is not guaranteed which provider will be used. It is recommended you do not use intersecting labels`);
                }
            }
        }
    }
    idleReaper() {
        const func = new idle_runner_repear_function_1.IdleRunnerRepearFunction(this, 'Idle Reaper', {
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
        this.managementFunctions.push(func);
        return func;
    }
    idleReaperQueue(reaper) {
        // see this comment to understand why it's a queue that's out of the step function
        // https://github.com/CloudSnorkel/cdk-github-runners/pull/314#issuecomment-1528901192
        // the reaper only stops a runner it saw idle twice, one delivery apart, so a runner gets reaped somewhere between 5 and 10 minutes after
        // it went idle with the default idle timeout. a runner that is still booting is not online yet, so it doesn't count as idle.
        const queue = new aws_cdk_lib_1.aws_sqs.Queue(this, 'Idle Reaper Queue', {
            deliveryDelay: cdk.Duration.minutes(5),
            visibilityTimeout: cdk.Duration.minutes(5),
        });
        // trigger reaper function from queue
        reaper.addEventSource(new aws_cdk_lib_1.aws_lambda_event_sources.SqsEventSource(queue, {
            reportBatchItemFailures: true,
            maxBatchingWindow: cdk.Duration.minutes(1),
            batchSize: 10,
        }));
        // the reaper sends itself a new message when it first sees a runner idle
        reaper.addEnvironment('IDLE_REAPER_QUEUE_URL', queue.queueUrl);
        queue.grantSendMessages(reaper);
        // access to required github secrets and runner cleanup
        this.secrets.github.grantRead(reaper);
        this.secrets.githubPrivateKey.grantRead(reaper);
        this.grantRunnerInstanceCleanup(reaper);
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
     * Metric for the number of runners that were stolen by a job that shouldn't have been assigned to them.
     *
     * A high number here means your runners are shared with jobs you didn't mean to serve. Use the "Stolen runners"
     * CloudWatch Logs Insights query created by {@link createLogsInsightsQueries} to see which repositories and jobs
     * are taking them.
     *
     * This metric has two dimensions:
     *  1. `Replaced` which is "true" or "false" indicating whether the stolen runner was replaced. A runner may not be replaced if it was stolen too
     *     many times in a row. The current limit is 3. When this is false, there is probably a bug in our detection or something misconfigured.
     *  2. `Provider` is the provider construct path of the runner that was stolen. You can check your code to see which labels it has that may cause
     *     it to be stolen. The logs insights queries can provide even more information about the stolen runners.
     *
     * **WARNING:** this method creates a metric filter. This resource may incur cost.
     */
    metricStolenRunners(props) {
        if (!this.stolenRunnersMetricFilterInitialized) {
            (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR).addMetricFilter('Stolen Runners filter', {
                metricNamespace: 'GitHubRunners',
                metricName: 'StolenRunners',
                filterPattern: aws_cdk_lib_1.aws_logs.FilterPattern.stringValue('$.message.metric', '=', 'StolenRunnerDetected'),
                metricValue: '1',
                // can't with dimensions -- defaultValue: 0,
                dimensions: {
                    Replaced: '$.message.replaced',
                    Provider: '$.message.provider',
                },
            });
            this.stolenRunnersMetricFilterInitialized = true;
        }
        return new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: 'GitHubRunners',
            metricName: 'StolenRunners',
            unit: aws_cdk_lib_1.aws_cloudwatch.Unit.COUNT,
            statistic: aws_cdk_lib_1.aws_cloudwatch.Stats.SUM,
            ...props,
        }).attachTo(this);
    }
    /**
     * Metric for the number of jobs whose labels matched more than one provider.
     *
     * We start a runner from the first matching provider, but GitHub may give such a job a runner from any of them, including one started for
     * another job. Stolen runner detection starts another runner for the job left behind, but the job itself may run on a provider you didn't
     * expect. Anything over zero means some workflows ask for too few labels. Add labels to those jobs so they match only one provider. Use the
     * "Jobs matching multiple providers" CloudWatch Logs Insights query created by {@link createLogsInsightsQueries} to find them.
     *
     * Jobs routed by a provider selector are not counted, as the selector picks the provider.
     *
     * **WARNING:** this method creates a metric filter. This resource may incur cost.
     */
    metricJobsMatchingMultipleProviders(props) {
        if (!this.multipleProvidersMetricFilterInitialized) {
            (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR).addMetricFilter('Multiple Providers filter', {
                metricNamespace: 'GitHubRunners',
                metricName: 'JobsMatchingMultipleProviders',
                filterPattern: aws_cdk_lib_1.aws_logs.FilterPattern.stringValue('$.message.metric', '=', 'MultipleProvidersMatched'),
                metricValue: '1',
                unit: aws_cdk_lib_1.aws_cloudwatch.Unit.COUNT,
                defaultValue: 0,
            });
            this.multipleProvidersMetricFilterInitialized = true;
        }
        return new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: 'GitHubRunners',
            metricName: 'JobsMatchingMultipleProviders',
            unit: aws_cdk_lib_1.aws_cloudwatch.Unit.COUNT,
            statistic: aws_cdk_lib_1.aws_cloudwatch.Stats.SUM,
            ...props,
        }).attachTo(this);
    }
    /**
     * Metric for the number of runners we stopped on purpose before they got a job.
     *
     * These step function executions end up as aborted and not failed, so they don't show up in {@link metricFailed}.
     *
     * This metric has one dimension, `Reason`, which is the error the step function was stopped with:
     *  * `IdleRunner`: the runner was idle for longer than its idle timeout and was reaped. This is usually a runner whose job was taken by
     *    another runner, or a job that was canceled before it started.
     *  * `StaleWarmRunner`: a warm runner was replaced because its configuration changed.
     *  * `WarmRunnerExpired`: a warm runner reached the end of its duration.
     *  * `WarmRunnerBadDeadline`: a warm runner had an invalid deadline and was stopped.
     *
     * **WARNING:** this method creates a metric filter. This resource may incur cost.
     */
    metricStoppedRunners(props) {
        if (!this.stoppedRunnersMetricFilterInitialized) {
            (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR).addMetricFilter('Stopped Runners filter', {
                metricNamespace: 'GitHubRunners',
                metricName: 'StoppedRunners',
                filterPattern: aws_cdk_lib_1.aws_logs.FilterPattern.stringValue('$.message.metric', '=', 'RunnerStopped'),
                metricValue: '1',
                // can't with dimensions -- defaultValue: 0,
                dimensions: {
                    Reason: '$.message.reason',
                },
            });
            this.stoppedRunnersMetricFilterInitialized = true;
        }
        return new aws_cdk_lib_1.aws_cloudwatch.Metric({
            namespace: 'GitHubRunners',
            metricName: 'StoppedRunners',
            unit: aws_cdk_lib_1.aws_cloudwatch.Unit.COUNT,
            statistic: aws_cdk_lib_1.aws_cloudwatch.Stats.SUM,
            ...props,
        }).attachTo(this);
    }
    /**
     * Metric for the number of failed invocations of the management Lambda functions.
     *
     * These are the functions that handle webhooks, retrieve runner tokens, stop idle runners, replace stolen runners, etc. Anything over zero means
     * jobs may not have gotten a runner. You should use this metric to trigger an alarm.
     *
     * Only unhandled errors are counted here, as reported by Lambda itself. Errors that are handled and logged, like a webhook with a bad signature,
     * are not failed invocations. Use the "Webhook errors" and "Orchestration errors" queries created by {@link createLogsInsightsQueries} to find
     * those.
     *
     * Management functions created after this method is called are not included. Call it last if you use warm runners.
     */
    metricLambdaErrors(props) {
        const errors = {};
        this.managementFunctions.forEach((f, i) => {
            errors[`e${i}`] = f.metricErrors();
        });
        return new aws_cdk_lib_1.aws_cloudwatch.MathExpression({
            // SUM() and not e0+e1+... so periods where only some of the functions ran still get a value
            expression: `SUM([${Object.keys(errors).join(',')}])`,
            usingMetrics: errors,
            label: 'Errors',
            ...props,
        });
    }
    /**
     * Creates a topic for notifications when a runner image build fails.
     *
     * Runner images are rebuilt every week by default. This provides the latest GitHub Runner version and software updates.
     *
     * If you want to be sure you are using the latest runner version, you can use this topic to be notified when a build fails.
     *
     * Email subscribers get a short summary with the failure reason and a link to the logs. Other subscribers get the original
     * JSON notification from CodeBuild or EC2 Image Builder.
     *
     * When the image builder is defined in a separate stack (e.g. in a split-stacks setup), pass that stack or construct
     * as the optional scope so the topic and failure-notification aspects are created in the same stack as the image
     * builder. Otherwise the aspects may not find the image builder resources.
     *
     * @param scope Optional scope (e.g. the image builder stack) where the topic and aspects will be created. Defaults to this construct.
     */
    failedImageBuildsTopic(scope) {
        scope ??= this;
        const topic = new aws_cdk_lib_1.aws_sns.Topic(scope, 'Failed Runner Image Builds');
        const stack = cdk.Stack.of(scope);
        const filteringTopic = providers_1.AwsImageBuilderFailedBuildNotifier.createFilteringTopic(scope, topic);
        cdk.Aspects.of(stack).add(new providers_1.CodeBuildImageBuilderFailedBuildNotifier(filteringTopic));
        cdk.Aspects.of(stack).add(new providers_1.AwsImageBuilderFailedBuildNotifier(filteringTopic));
        return topic;
    }
    /**
     * Creates CloudWatch Logs Insights saved queries that can be used to debug issues with the runners.
     *
     * * "Webhook errors" helps diagnose configuration issues with GitHub integration
     * * "Ignored webhook" helps understand why runners aren't started
     * * "Ignored jobs based on labels" helps debug label matching issues
     * * "Webhook started runners" helps understand which runners were started
     * * "Jobs matching multiple providers" lists jobs that need more labels so they match only one provider
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
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Stolen runners', {
            queryDefinitionName: `${prefix}/Stolen runners`,
            logGroups: [(0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR)],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                fields: [
                    '@timestamp', 'message.notice', 'message.stolenRunnerName', 'message.runnerName', 'message.stolenByJobId',
                    'message.jobUrl', 'message.owner', 'message.repo', 'message.provider',
                ],
                filterStatements: [
                    'isPresent(message.metric) and strcontains(message.metric, "Stolen")',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Jobs matching multiple providers', {
            queryDefinitionName: `${prefix}/Jobs matching multiple providers`,
            logGroups: [this.webhook.handler.logGroup],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                // labels and providers are arrays, which Logs Insights splits into one field per item, so the full record shows them
                fields: ['@timestamp', 'message.jobUrl', 'message.provider', '@message'],
                filterStatements: [
                    'message.metric = "MultipleProvidersMatched"',
                ],
                sort: '@timestamp desc',
                limit: 100,
            }),
        });
        new aws_cdk_lib_1.aws_logs.QueryDefinition(this, 'Warm runner status', {
            queryDefinitionName: `${prefix}/Warm runner status`,
            logGroups: [(0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR)],
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                fields: ['@timestamp', 'message.notice', 'message.runnerName', 'message.providerPath', 'message.started', 'message.stillRunning', 'message.runnerBusy'],
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
                fields: ['@timestamp', 'message.notice', 'message.runnerName', 'message.error'],
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
     * Creates a CloudWatch dashboard with the metrics you need to know if your runners are healthy.
     *
     * It's split into sections, each with a short explanation of what its numbers mean and which ones to watch:
     *
     * * **Jobs**: are jobs running and passing, and which runner is failing them?
     * * **Runners**: do runners start, how long do they take (and therefore cost), and why do they fail to start?
     * * **Runner assignment**: are runners taken by jobs they weren't started for, do jobs match more than one provider, and why
     *   were runners stopped before getting a job?
     * * **Management functions (orchestration)**: is GitHub reaching the webhook, and is any of our code failing?
     *
     * **WARNING:** this method calls {@link metricJobCompleted}, {@link metricStolenRunners}, {@link metricStoppedRunners} and
     * {@link metricJobsMatchingMultipleProviders} which create metric filters. These resources may incur cost.
     *
     * This dashboard is very basic. Pull requests and issues are welcome to improve it.
     *
     * @param name Name of the dashboard. Defaults to "GitHub-Runners".
     */
    createDashboard(name = 'GitHub-Runners') {
        // create the metric filters behind these metrics
        this.metricJobCompleted();
        this.metricStolenRunners();
        this.metricStoppedRunners();
        // our log metric filters add dimensions, and a metric with dimensions can only be read with those dimensions.
        // search expressions let us sum them all up without listing every dimension value.
        const search = (label, metricName, dimensions) => {
            const query = ['Namespace="GitHubRunners"', `MetricName="${metricName}"`, dimensions].filter(q => q).join(' ');
            return new aws_cdk_lib_1.aws_cloudwatch.MathExpression({
                expression: `SUM(SEARCH('${query}', 'Sum'))`,
                label,
                usingMetrics: {},
            });
        };
        const jobs = (status, label) => search(label, 'JobCompleted', `Status="${status}"`);
        const dashboard = new aws_cdk_lib_1.aws_cloudwatch.Dashboard(this, 'Dashboard', {
            dashboardName: name,
            defaultInterval: cdk.Duration.days(1),
        });
        // a full width text widget that starts a section and explains its numbers
        const section = (height, ...lines) => dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.TextWidget({
            markdown: lines.join('\n'),
            width: 24,
            height,
        }));
        section(3, '# GitHub Runners', 'Each GitHub Actions job that asks for a self-hosted runner sends a webhook. We start a runner for it from the provider that matches the job labels. ' +
            'The runner registers with GitHub, runs one job, and goes away.', '', 'Alarm on **Runners failed to start**, **Lambda errors** and **Jobs matching multiple providers**. ' +
            'When any of them is over zero, jobs may be waiting for a runner that will never come. ' +
            'Also subscribe to `failedImageBuildsTopic()` so you know when runner images stop getting updates.');
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.SingleValueWidget({
            title: 'Summary',
            metrics: [
                jobs('Succeeded', 'Jobs succeeded'),
                jobs('Failed', 'Jobs failed'),
                this.metricFailed({ label: 'Runners failed to start' }),
                search('Stolen runners', 'StolenRunners'),
                this.metricJobsMatchingMultipleProviders({ label: 'Jobs matching multiple providers' }),
                search('Idle runners stopped', 'StoppedRunners', 'Reason="IdleRunner"'),
                this.metricLambdaErrors({ label: 'Lambda errors' }),
            ],
            // totals for the dashboard time range instead of just the last period
            setPeriodToTimeRange: true,
            width: 24,
            height: 5,
        }));
        section(2, '## Jobs', 'Jobs that ran on our runners, counted when the runner finishes them. These are the results your users see in GitHub. ' +
            'A failed job is usually a problem in the workflow, not the runner. But if one runner label fails much more than the others, ' +
            'its image may be missing something the jobs need. **Abandoned** means the runner went away in the middle of the job.');
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Jobs completed by status',
            // status list taken from https://github.com/actions/runner/blob/be9632302ceef50bfb36ea998cea9c94c75e5d4d/src/Sdk/DTWebApi/WebApi/TaskResult.cs
            left: ['Succeeded', 'SucceededWithIssues', 'Failed', 'Canceled', 'Skipped', 'Abandoned'].map(s => jobs(s, s)),
            stacked: true,
            width: 12,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Failed jobs by runner label',
            // a search expression can't be labeled per provider, so list the providers to keep the legend readable. this
            // misses labels coming from a custom providerSelector, but "Jobs completed by status" still counts those.
            left: [...this.extractUniqueSubProviders()].map(p => new aws_cdk_lib_1.aws_cloudwatch.Metric({
                namespace: 'GitHubRunners',
                metricName: 'JobCompleted',
                dimensionsMap: {
                    ProviderLabels: p.labels.join(','),
                    Status: 'Failed',
                },
                label: p.labels.join(', '),
                statistic: aws_cdk_lib_1.aws_cloudwatch.Stats.SUM,
            })),
            stacked: true,
            width: 12,
        }));
        section(3, '## Runners', 'Every runner we start is one step function execution. **Succeeded** means the runner started, ran and exited. ' +
            '**Failed** means it never managed to start, so the job it was started for may wait until GitHub gives up on it. ' +
            'Alarm on failed. **Recent failed attempts** below shows why. ' +
            '**Aborted** runners were stopped on purpose and are explained in the next section.', '', '**Runner time** includes start-up, so it\'s close to what you pay for each runner. A jump usually means slower start-ups or longer jobs.');
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Runner executions',
            left: [
                this.metricSucceeded({ label: 'Succeeded' }),
                this.metricFailed({ label: 'Failed' }),
                this.orchestrator.metricTimedOut({ label: 'Timed out' }),
                // stopped on purpose, see "Stopped runners by reason"
                this.orchestrator.metricAborted({ label: 'Aborted' }),
            ],
            stacked: true,
            width: 12,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Runner time (including start-up)',
            left: [
                this.metricTime({ statistic: aws_cdk_lib_1.aws_cloudwatch.Stats.p(50), label: 'p50' }),
                this.metricTime({ statistic: aws_cdk_lib_1.aws_cloudwatch.Stats.p(90), label: 'p90' }),
                this.metricTime({ statistic: aws_cdk_lib_1.aws_cloudwatch.Stats.MAXIMUM, label: 'max' }),
            ],
            width: 12,
        }));
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.LogQueryWidget({
            title: 'Recent failed attempts',
            logGroupNames: [(0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR).logGroupName],
            view: aws_cdk_lib_1.aws_cloudwatch.LogQueryVisualizationType.TABLE,
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                // logged by the clean-up function, which every failed attempt goes through. retries and fallbacks fail more
                // than once, so a runner can show up here many times before it starts or gives up.
                fields: [
                    '@timestamp',
                    'message.error.Error as error',
                    'message.family as family',
                    'message.runnerName as runner',
                    'message.repo as repo',
                    'message.error.Cause as cause',
                ],
                filterStatements: [
                    'message.notice = "Runner failed"',
                ],
                sort: '@timestamp desc',
                limit: 20,
            }).toString(),
            width: 24,
            height: 6,
        }));
        section(5, '## Runner assignment', 'We start each runner for a specific job, but GitHub can give it to any queued job with matching labels. ' +
            'When two of our jobs swap runners, nothing is lost and nothing is counted here.', '', '**Stolen runners** were taken by a job that left the job they were started for without a runner. That\'s a job we didn\'t start ' +
            'a runner for, like one from a repository we don\'t serve, or one whose own runner can\'t run the job left behind. ' +
            'We start a replacement for each. **Not replaced** means the same job lost its runner too many times in a row and may wait forever. ' +
            'Use the "Stolen runners" Logs Insights query to see who took them.', '', '**Jobs matching multiple providers** ask for too few labels, so they may run on a provider you didn\'t expect and take runners from other jobs. ' +
            'Add labels to those jobs. Use the "Jobs matching multiple providers" Logs Insights query to find them and the providers they matched. ' +
            'Both queries are created by `createLogsInsightsQueries()`.', '', '**Idle runners stopped** never got a job before their idle timeout. These are usually runners started for jobs that were canceled before ' +
            'the runner was ready, or the extra runner left over after a stolen runner was replaced.', '', 'You shouldn\'t see big numbers for any of these. Each one is a runner that was started for nothing, so you\'re wasting resources. ' +
            'Stolen runners and jobs matching multiple providers may also leave jobs hanging.');
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Stolen runners',
            // not replaced means the replacement limit was hit, so the job may be left without a runner
            left: [
                search('Replaced', 'StolenRunners', 'Replaced="true"'),
                search('Not replaced', 'StolenRunners', 'Replaced="false"'),
            ],
            stacked: true,
            width: 8,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Jobs matching multiple providers',
            left: [this.metricJobsMatchingMultipleProviders({ label: 'Jobs' })],
            width: 8,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Stopped runners by reason',
            // these executions are aborted on purpose, so they're not counted as failed. see metricStoppedRunners() for what each reason means
            left: ['IdleRunner', 'StaleWarmRunner', 'WarmRunnerExpired', 'WarmRunnerBadDeadline']
                .map(r => search(r, 'StoppedRunners', `Reason="${r}"`)),
            stacked: true,
            width: 8,
        }));
        section(3, '## Management functions (orchestration)', 'The Lambda functions that orchestrate runners: they receive webhooks, start runners, stop idle runners and replace stolen ones. ' +
            'Their logs are in the orchestrator log group, and the "Orchestration errors" Logs Insights query finds their errors. ' +
            'If jobs are queued and the webhook gets no requests, GitHub isn\'t reaching it. Check the webhook deliveries of your GitHub app. ' +
            '**Lambda errors** over zero means jobs may not get a runner. Alarm on it, and see **Recent errors** below for what went wrong.');
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Webhook',
            left: [
                this.webhook.handler.metricInvocations({ label: 'Requests' }),
                this.webhook.handler.metricErrors({ label: 'Errors' }),
            ],
            width: 12,
        }), new aws_cdk_lib_1.aws_cloudwatch.GraphWidget({
            title: 'Lambda errors',
            // one series per function, so a spike points at the function that needs looking at
            left: this.managementFunctions.map(f => f.metricErrors({
                label: f.node.path.slice(this.node.path.length + 1),
            })),
            stacked: true,
            width: 12,
        }));
        // the orchestrator, webhook and runner management functions log here, setup and status log separately
        dashboard.addWidgets(new aws_cdk_lib_1.aws_cloudwatch.LogQueryWidget({
            title: 'Recent errors',
            logGroupNames: [
                (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR).logGroupName,
                (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.SETUP).logGroupName,
            ],
            view: aws_cdk_lib_1.aws_cloudwatch.LogQueryVisualizationType.TABLE,
            queryString: new aws_cdk_lib_1.aws_logs.QueryString({
                // we log JSON, so `message` is an object and shows up as an empty column. pick out the human readable part of
                // the errors we log ourselves and of the ones Lambda logs for us, and keep the raw record for the details.
                fields: [
                    '@timestamp',
                    '@logStream',
                    'coalesce(message.notice, message.errorMessage, message.name) as error',
                    '@message',
                ],
                filterStatements: [
                    'level = "ERROR"',
                ],
                sort: '@timestamp desc',
                limit: 20,
            }).toString(),
            width: 24,
            height: 6,
        }));
        return dashboard;
    }
    /**
     * Register a warm runner config hash. All registered hashes are passed to the
     * manager Lambda via WARM_CONFIG_HASHES env var so keepers can detect stale configs.
     * The longest duration is passed via WARM_MAX_DURATION_SECONDS so keepers can reject bogus deadlines.
     *
     * @internal
     */
    _registerWarmConfigHash(hash, duration) {
        this.warmConfigHashes.push(hash);
        this.warmMaxDuration = Math.max(this.warmMaxDuration, duration);
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
                WARM_MAX_DURATION_SECONDS: cdk.Lazy.string({ produce: () => this.warmMaxDuration.toString() }),
                ...this.extraLambdaEnv,
            },
            timeout: cdk.Duration.seconds(50),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            // keeper messages enqueue their own replacement, so a busy runner slot is an intentional Lambda -> SQS -> Lambda chain
            // it's bounded by the absolute deadline and rate limited by the keeper, so AWS recursion detection is not needed
            recursiveLoop: aws_cdk_lib_1.aws_lambda.RecursiveLoop.ALLOW,
            ...this.extraLambdaProps,
        });
        this.managementFunctions.push(this.warmRunnerManager);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnVubmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3J1bm5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsdUNBQXlCO0FBQ3pCLHVDQUF5QjtBQUN6QiwyQ0FBNkI7QUFDN0IsaURBQW1DO0FBQ25DLDZDQVlxQjtBQUNyQiwyQ0FBdUM7QUFDdkMscUNBQXdDO0FBQ3hDLG1GQUE2RTtBQUM3RSwrRUFBeUU7QUFDekUsbURBQStDO0FBQy9DLDJDQWNxQjtBQUNyQix1Q0FBb0M7QUFDcEMscURBQWlEO0FBQ2pELHVEQUFtRDtBQUNuRCxxREFBd0Q7QUFDeEQseUVBQW9FO0FBRXBFLG1DQUFrSDtBQUNsSCxpRkFBMkU7QUFDM0UsdUNBQWlEO0FBQ2pELDZEQUErRDtBQUUvRDs7O0dBR0c7QUFDSCxNQUFNLGdCQUFnQixHQUFHLElBQUksR0FBRyxDQUF5RDtJQUN2RixDQUFDLG1DQUF1QixDQUFDLE9BQU8sRUFBRSxtQ0FBdUIsQ0FBQyxxQkFBcUIsQ0FBQztJQUNoRixDQUFDLDZCQUFpQixDQUFDLE9BQU8sRUFBRSw2QkFBaUIsQ0FBQyxxQkFBcUIsQ0FBQztJQUNwRSxDQUFDLDZCQUFpQixDQUFDLE9BQU8sRUFBRSw2QkFBaUIsQ0FBQyxxQkFBcUIsQ0FBQztJQUNwRSxDQUFDLGlDQUFxQixDQUFDLE9BQU8sRUFBRSxpQ0FBcUIsQ0FBQyxxQkFBcUIsQ0FBQztJQUM1RSxDQUFDLGdDQUFvQixDQUFDLE9BQU8sRUFBRSxnQ0FBb0IsQ0FBQyxxQkFBcUIsQ0FBQztDQUMzRSxDQUFDLENBQUM7QUFHSDs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBa0JHO0FBQ0gsU0FBUyxvQkFBb0IsQ0FBQyxLQUFnQixFQUFFLFVBQWtCO0lBQ2hFLE9BQU87OztxQkFHWSxVQUFVOzs7Ozs7cUJBTVYsNEJBQVksQ0FBQyxLQUFLLGdCQUFnQixHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUs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QUMsaUJBQWlCLENBQUMsQ0FBQztRQUNoRSxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNwRCxJQUFJLENBQUMsWUFBWSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBQzlELElBQUksQ0FBQyxZQUFZLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxzQkFBc0IsQ0FBQyxDQUFDO1FBRWpGLElBQUksQ0FBQyxpQkFBaUIsQ0FBQyxjQUFjLENBQUMsSUFBSSxzQ0FBb0IsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLGVBQWUsRUFBRTtZQUNsRyx1QkFBdUIsRUFBRSxJQUFJO1lBQzdCLGlCQUFpQixFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUMzQyxTQUFTLEVBQUUsRUFBRTtTQUNkLENBQUMsQ0FBQyxDQUFDO1FBQ0osSUFBSSxDQUFDLGVBQWUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUUvRCxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxLQUFLLEVBQUUsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO0lBQ3pFLENBQUM7O0FBNTdDSCxzQ0E2N0NDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnb3MnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBBbm5vdGF0aW9ucyxcbiAgYXdzX2Nsb3Vkd2F0Y2ggYXMgY2xvdWR3YXRjaCxcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbGFtYmRhIGFzIGxhbWJkYSxcbiAgYXdzX2xhbWJkYV9ldmVudF9zb3VyY2VzIGFzIGxhbWJkYV9ldmVudF9zb3VyY2VzLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3Nfc25zIGFzIHNucyxcbiAgYXdzX3NxcyBhcyBzcXMsXG4gIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMsXG4gIGF3c19zdGVwZnVuY3Rpb25zX3Rhc2tzIGFzIHN0ZXBmdW5jdGlvbnNfdGFza3MsXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgTGFtYmRhQWNjZXNzIH0gZnJvbSAnLi9hY2Nlc3MnO1xuaW1wb3J0IHsgRGVsZXRlRmFpbGVkUnVubmVyRnVuY3Rpb24gfSBmcm9tICcuL2RlbGV0ZS1mYWlsZWQtcnVubmVyLWZ1bmN0aW9uJztcbmltcG9ydCB7IElkbGVSdW5uZXJSZXBlYXJGdW5jdGlvbiB9IGZyb20gJy4vaWRsZS1ydW5uZXItcmVwZWFyLWZ1bmN0aW9uJztcbmltcG9ydCB7IFJlc2VydmVkVGFncyB9IGZyb20gJy4vbGFtYmRhLWNvbW1vbic7XG5pbXBvcnQge1xuICBBbnlSdW5uZXJDb25maWcsXG4gIEF3c0ltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIsXG4gIENvZGVCdWlsZEltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIsXG4gIENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyLFxuICBFYzJSdW5uZXJQcm92aWRlcixcbiAgRWNzUnVubmVyUHJvdmlkZXIsXG4gIEZhcmdhdGVSdW5uZXJQcm92aWRlcixcbiAgSUNvbXBvc2l0ZVByb3ZpZGVyLFxuICBJUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIGlzUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyLFxuICBMYW1iZGFSdW5uZXJQcm92aWRlcixcbiAgUHJvdmlkZXJSZXRyeU9wdGlvbnMsXG59IGZyb20gJy4vcHJvdmlkZXJzJztcbmltcG9ydCB7IFNlY3JldHMgfSBmcm9tICcuL3NlY3JldHMnO1xuaW1wb3J0IHsgU2V0dXBGdW5jdGlvbiB9IGZyb20gJy4vc2V0dXAtZnVuY3Rpb24nO1xuaW1wb3J0IHsgU3RhdHVzRnVuY3Rpb24gfSBmcm9tICcuL3N0YXR1cy1mdW5jdGlvbic7XG5pbXBvcnQgeyBTdG9sZW5SdW5uZXJEZXRlY3RvciB9IGZyb20gJy4vc3RvbGVuLXJ1bm5lcnMnO1xuaW1wb3J0IHsgVG9rZW5SZXRyaWV2ZXJGdW5jdGlvbiB9IGZyb20gJy4vdG9rZW4tcmV0cmlldmVyLWZ1bmN0aW9uJztcbmltcG9ydCB7IFRva2VuUmV0cmlldmVySW5wdXQgfSBmcm9tICcuL3Rva2VuLXJldHJpZXZlci5sYW1iZGEnO1xuaW1wb3J0IHsgZGVkdXBlU3RhdGVNYWNoaW5lVG9rZW5zLCBkaXNjb3ZlckNlcnRpZmljYXRlRmlsZXMsIHNpbmdsZXRvbkxvZ0dyb3VwLCBTaW5nbGV0b25Mb2dUeXBlIH0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQgeyBXYXJtUnVubmVyTWFuYWdlckZ1bmN0aW9uIH0gZnJvbSAnLi93YXJtLXJ1bm5lci1tYW5hZ2VyLWZ1bmN0aW9uJztcbmltcG9ydCB7IEdpdGh1YldlYmhvb2tIYW5kbGVyIH0gZnJvbSAnLi93ZWJob29rJztcbmltcG9ydCB7IEdpdGh1YldlYmhvb2tSZWRlbGl2ZXJ5IH0gZnJvbSAnLi93ZWJob29rLXJlZGVsaXZlcnknO1xuXG4vKipcbiAqIE9uZSBzdGF0ZSBtYWNoaW5lIGZyYWdtZW50IHBlciBydW5uZXIgZmFtaWx5LiBFYWNoIGZyYWdtZW50IHJlYWRzIHRoZSBwcm92aWRlciBjb25maWcgb3V0IG9mIHRoZSBleGVjdXRpb24gc3RhdGUsXG4gKiBzbyB0aGUgc3RhdGUgbWFjaGluZSBkb2Vzbid0IGdyb3cgd2l0aCB0aGUgbnVtYmVyIG9mIHByb3ZpZGVycy5cbiAqL1xuY29uc3QgRkFNSUxZX0ZSQUdNRU5UUyA9IG5ldyBNYXA8c3RyaW5nLCAoc2NvcGU6IENvbnN0cnVjdCkgPT4gc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlPihbXG4gIFtDb2RlQnVpbGRSdW5uZXJQcm92aWRlci5fRkFNSUxZLCBDb2RlQnVpbGRSdW5uZXJQcm92aWRlci5fc3RhdGVNYWNoaW5lRnJhZ21lbnRdLFxuICBbRWMyUnVubmVyUHJvdmlkZXIuX0ZBTUlMWSwgRWMyUnVubmVyUHJvdmlkZXIuX3N0YXRlTWFjaGluZUZyYWdtZW50XSxcbiAgW0Vjc1J1bm5lclByb3ZpZGVyLl9GQU1JTFksIEVjc1J1bm5lclByb3ZpZGVyLl9zdGF0ZU1hY2hpbmVGcmFnbWVudF0sXG4gIFtGYXJnYXRlUnVubmVyUHJvdmlkZXIuX0ZBTUlMWSwgRmFyZ2F0ZVJ1bm5lclByb3ZpZGVyLl9zdGF0ZU1hY2hpbmVGcmFnbWVudF0sXG4gIFtMYW1iZGFSdW5uZXJQcm92aWRlci5fRkFNSUxZLCBMYW1iZGFSdW5uZXJQcm92aWRlci5fc3RhdGVNYWNoaW5lRnJhZ21lbnRdLFxuXSk7XG5cblxuLyoqXG4gKiBKU09OYXRhIGV4cHJlc3Npb24gdGhhdCBwb2ludHMgYCQucHJvdmlkZXJQYXJhbXNgIGF0IGBjb25maWdFeHByYCBhbmQgbWVyZ2VzIHRoZSBzdGFuZGFyZCBydW5uZXIgdGFncyBpbnRvIGl0cyBgdGFnc2AgZmllbGQuIEFsc28gaGFuZGxlc1xuICogZGlzdHJpYnV0aW9uIGluIG9uZSBzaW1wbGUgc3RlcC5cbiAqXG4gKiBUYWdzIGFyZSBpbmNsdWRlZCBldmVuIGZvciBwcm92aWRlciB0aGF0IG1heSBub3QgdXNlIHRoZW0gZm9yIGRlYnVnZ2luZyBwdXJwb3Nlcy4gVGhleSBhcmUgdmlzaWJsZSBpbiB0aGUgc3RlcCBmdW5jdGlvbiBzdGF0ZS5cbiAqXG4gKiBUaGUgc3RhbmRhcmQgdGFncyBvbmx5IGhhdmUgdmFsdWVzIGF0IHJ1bnRpbWUsIHNvIHByb3ZpZGVycyBjYW4ndCBiYWtlIHRoZW0gaW4gYXQgc3ludGggdGltZS4gUHJvdmlkZXIgdGFncyBjYW4gb3ZlcnJpZGUgb3VyIHRhZ3MsIGV4Y2VwdCBmb3IgdGhlXG4gKiBgR2l0SHViUnVubmVyczpgIHByZWZpeGVkIG9uZXMsIHdoaWNoIHByb3ZpZGVycyByZWplY3QgYXQgc3ludGguIFRoYXQga2VlcHMgYEdpdEh1YlJ1bm5lcnM6UnVubmVyYCwgdXNlZCBmb3IgaW5zdGFuY2UgdGVybWluYXRpb24sIGFzIHNvbWV0aGluZ1xuICogb25seSB3ZSBjYW4gc2V0LiBJdCBhbHNvIHByZXZlbnRzIGR1cGxpY2F0ZSB0YWdzIGZyb20gcmVhY2hpbmcgZWMyOlJ1bkluc3RhbmNlcyB0aGF0IGRvZXNuJ3QgbGlrZSB0aG9zZS5cbiAqXG4gKiBgR2l0SHViUnVubmVyczpQcm92aWRlcmAgc2hvdWxkIG5hbWUgdGhlIHByb3ZpZGVyIHRoYXQgYWN0dWFsbHkgcnVucyB0aGUgam9iLCB3aGljaCBpcyBub3QgYCQucHJvdmlkZXJgIHdoZW4gd2UgZ290IGhlcmUgdGhyb3VnaCBhIGNvbXBvc2l0ZSwgc29cbiAqIHRoZSBjb25maWcncyBvd24gYHByb3ZpZGVyYCBmaWVsZCB3aW5zIHdoZW4gaXQgaGFzIG9uZS5cbiAqXG4gKiBgcnVubmVyR3JvdXBgIGFuZCBgZGVmYXVsdExhYmVsc2AgZ2V0IGRlZmF1bHRzIHNvIGFuIHVua25vd24gcHJvdmlkZXIsIHdob3NlIGxvb2t1cCBmaW5kcyBub3RoaW5nLCBzdGlsbCBwcm9kdWNlcyBwYXJhbXMgdGhlIG5leHQgc3RhdGVzIGNhbiByZWFkLlxuICogV2l0aG91dCBpdCB0aGUgdG9rZW4gcmV0cmlldmVyIGZhaWxzIG9uIGEgbWlzc2luZyByZWZlcmVuY2UgcGF0aCBpbnN0ZWFkIG9mIHJlYWNoaW5nIGBVbmtub3duIHByb3ZpZGVyYC5cbiAqXG4gKiBMYWJlbHMgYXJlIHRhZ2dlZCBhcyB0aGV5IGNvbWUgaW4sIHNvIHRoZSB0YWcgc2hvd3Mgd2hhdCB0aGUgcnVubmVyIHJlZ2lzdGVycyB3aXRoLCB3YXJtIHJ1bm5lciBhbmQgcHJvdmlkZXIgc2VsZWN0b3IgbGFiZWxzIGluY2x1ZGVkLiBDb25maWdzXG4gKiB0aGF0IGFzayBmb3IgYGNsZWFuTGFiZWxzYCBnZXQgdGhlIHNhbWUgbGFiZWxzIHdpdGggc3BhY2VzIGluc3RlYWQgb2YgdGhlIGNvbW1hcyBFQ1MgcmVqZWN0cywgYW5kIGFueXRoaW5nIGVsc2UgaXQgcmVqZWN0cyBhcyBhbiB1bmRlcnNjb3JlLlxuICovXG5mdW5jdGlvbiBzZWxlY3RQcm92aWRlclBhcmFtcyhzY29wZTogQ29uc3RydWN0LCBjb25maWdFeHByOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYCRtZXJnZShbXG4gICAgJHN0YXRlcy5pbnB1dCxcbiAgICB7J3Byb3ZpZGVyUGFyYW1zJzogKFxuICAgICAgJHNlbGVjdGVkIDo9ICR7Y29uZmlnRXhwcn07XG4gICAgICAkciA6PSAkcmFuZG9tKCkgKiAkc2VsZWN0ZWQudG90YWxXZWlnaHQ7XG4gICAgICAkY29uZmlnIDo9ICRleGlzdHMoJHNlbGVjdGVkLmRpc3RyaWJ1dGUpID8gJHNlbGVjdGVkLmRpc3RyaWJ1dGVbdGhyZXNob2xkID4gJHJdWzBdLmNvbmZpZyA6ICRzZWxlY3RlZDtcbiAgICAgICRtZXJnZShbeydmYW1pbHknOiAncHJvdmlkZXIgbm90IGZvdW5kJywgJ3J1bm5lckdyb3VwJzogJycsICdkZWZhdWx0TGFiZWxzJzogW119LCAkY29uZmlnLCB7J3RhZ3MnOiAkYXBwZW5kKFxuICAgICAgICBbXG4gICAgICAgICAgeydLZXknOiAnTmFtZScsICdWYWx1ZSc6ICRzdGF0ZXMuY29udGV4dC5FeGVjdXRpb24uTmFtZX0sXG4gICAgICAgICAgeydLZXknOiAnJHtSZXNlcnZlZFRhZ3MuU1RBQ0t9JywgJ1ZhbHVlJzogJyR7Y2RrLlN0YWNrLm9mKHNjb3BlKS5zdGFja05hbWV9J30sXG4gICAgICAgICAgeydLZXknOiAnJHtSZXNlcnZlZFRhZ3MuUFJPVklERVJ9JywgJ1ZhbHVlJzogJGNvbmZpZy5wcm92aWRlcn0sXG4gICAgICAgICAgeydLZXknOiAnJHtSZXNlcnZlZFRhZ3MuUkVQT30nLCAnVmFsdWUnOiAkc3RhdGVzLmlucHV0Lm93bmVyICYgJy8nICYgJHN0YXRlcy5pbnB1dC5yZXBvfSxcbiAgICAgICAgICB7J0tleSc6ICcke1Jlc2VydmVkVGFncy5MQUJFTFN9JywgJ1ZhbHVlJzogJGNvbmZpZy5jbGVhbkxhYmVscyA/ICRyZXBsYWNlKCRqb2luKCRzcGxpdCgkc3RhdGVzLmlucHV0LmxhYmVscywgJywnKSwgJyAnKSwgL1teQS1aYS16MC05IF8uOlxcXFwvPStALV0vLCAnXycpIDogJHN0YXRlcy5pbnB1dC5sYWJlbHN9LFxuICAgICAgICAgIHsnS2V5JzogJyR7UmVzZXJ2ZWRUYWdzLlJVTk5FUn0nLCAnVmFsdWUnOiAkc3RhdGVzLmNvbnRleHQuRXhlY3V0aW9uLk5hbWV9XG4gICAgICAgIF1bJG5vdChLZXkgaW4gJGNvbmZpZy50YWdzLktleSldLFxuICAgICAgICAkY29uZmlnLnRhZ3MpfV0pXG4gICAgKX1cbiAgXSlgO1xufVxuXG4vKipcbiAqIEV2ZXJ5IGZhbWlseSBhIHByb3ZpZGVyIGNvbmZpZyBjYW4gcmVhY2gsIHdhbGtpbmcgZmFsbGJhY2sgY2hhaW5zIGFuZCBkaXN0cmlidXRpb24gbGlzdHMuXG4gKi9cbmZ1bmN0aW9uIGNvbmZpZ0ZhbWlsaWVzKGNvbmZpZz86IEFueVJ1bm5lckNvbmZpZyk6IHN0cmluZ1tdIHtcbiAgaWYgKCFjb25maWcpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgaWYgKCdkaXN0cmlidXRlJyBpbiBjb25maWcpIHtcbiAgICByZXR1cm4gY29uZmlnLmRpc3RyaWJ1dGUuZmxhdE1hcChvcHRpb24gPT4gY29uZmlnRmFtaWxpZXMob3B0aW9uLmNvbmZpZykpO1xuICB9XG4gIHJldHVybiBbY29uZmlnLmZhbWlseSwgLi4uY29uZmlnRmFtaWxpZXMoY29uZmlnLmZhbGxiYWNrKV07XG59XG5cbi8qKlxuICogQmlnIHN0YXRpYyBzdHJpbmdzIHRoZSBmcmFnbWVudHMgcmVhZCBmcm9tIGAkLmNvbmZpZ2AsIGxpa2UgdGhlIEVDMiB1c2VyZGF0YSB0ZW1wbGF0ZXMuIFRoZXkgc3RheSBvdXQgb2YgdGhlXG4gKiBwZXItcHJvdmlkZXIgY29uZmlncyBiZWNhdXNlIGV2ZXJ5IHByb3ZpZGVyIG9mIHRoZSBmYW1pbHkgc2hhcmVzIHRoZW0uXG4gKi9cbmNvbnN0IEZBTUlMWV9DT05TVEFOVFMgPSBuZXcgTWFwPHN0cmluZywgKCkgPT4gUmVjb3JkPHN0cmluZywgc3RyaW5nPj4oW1xuICBbRWMyUnVubmVyUHJvdmlkZXIuX0ZBTUlMWSwgRWMyUnVubmVyUHJvdmlkZXIuX3N0YXRlTWFjaGluZUNvbnN0YW50c10sXG5dKTtcblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBHaXRIdWJSdW5uZXJzXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2l0SHViUnVubmVyc1Byb3BzIHtcbiAgLyoqXG4gICAqIExpc3Qgb2YgcnVubmVyIHByb3ZpZGVycyB0byB1c2UuIEF0IGxlYXN0IG9uZSBwcm92aWRlciBpcyByZXF1aXJlZC4gUHJvdmlkZXIgd2lsbCBiZSBzZWxlY3RlZCB3aGVuIGl0cyBsYWJlbCBtYXRjaGVzIHRoZSBsYWJlbHMgcmVxdWVzdGVkIGJ5IHRoZSB3b3JrZmxvdyBqb2IuXG4gICAqXG4gICAqIEBkZWZhdWx0IENvZGVCdWlsZCwgTGFtYmRhIGFuZCBGYXJnYXRlIHJ1bm5lcnMgd2l0aCBhbGwgdGhlIGRlZmF1bHRzIChubyBWUEMgb3IgZGVmYXVsdCBhY2NvdW50IFZQQylcbiAgICovXG4gIHJlYWRvbmx5IHByb3ZpZGVycz86IChJUnVubmVyUHJvdmlkZXIgfCBJQ29tcG9zaXRlUHJvdmlkZXIpW107XG5cbiAgLyoqXG4gICAqIFdoZXRoZXIgdG8gcmVxdWlyZSB0aGUgYHNlbGYtaG9zdGVkYCBsYWJlbC4gSWYgYHRydWVgLCB0aGUgcnVubmVyIHdpbGwgb25seSBzdGFydCBpZiB0aGUgd29ya2Zsb3cgam9iIGV4cGxpY2l0bHkgcmVxdWVzdHMgdGhlIGBzZWxmLWhvc3RlZGAgbGFiZWwuXG4gICAqXG4gICAqIEJlIGNhcmVmdWwgd2hlbiBzZXR0aW5nIHRoaXMgdG8gYGZhbHNlYC4gQXZvaWQgc2V0dGluZyB1cCBwcm92aWRlcnMgd2l0aCBnZW5lcmljIGxhYmVsIHJlcXVpcmVtZW50cyBsaWtlIGBsaW51eGAgYXMgdGhleSBtYXkgbWF0Y2ggd29ya2Zsb3dzIHRoYXQgYXJlIG5vdCBtZWFudCB0byBydW4gb24gc2VsZi1ob3N0ZWQgcnVubmVycy5cbiAgICpcbiAgICogQGRlZmF1bHQgdHJ1ZVxuICAgKi9cbiAgcmVhZG9ubHkgcmVxdWlyZVNlbGZIb3N0ZWRMYWJlbD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFZQQyB1c2VkIGZvciBhbGwgbWFuYWdlbWVudCBmdW5jdGlvbnMuIFVzZSB0aGlzIHdpdGggR2l0SHViIEVudGVycHJpc2UgU2VydmVyIGhvc3RlZCB0aGF0J3MgaW5hY2Nlc3NpYmxlIGZyb20gb3V0c2lkZSB0aGUgVlBDLlxuICAgKlxuICAgKiAqKk5vdGU6KiogVGhpcyBvbmx5IGFmZmVjdHMgbWFuYWdlbWVudCBmdW5jdGlvbnMgdGhhdCBpbnRlcmFjdCB3aXRoIEdpdEh1Yi4gTGFtYmRhIGZ1bmN0aW9ucyB0aGF0IGhlbHAgd2l0aCBydW5uZXIgaW1hZ2UgYnVpbGRpbmcgYW5kIGRvbid0IGludGVyYWN0IHdpdGggR2l0SHViIGFyZSBOT1QgYWZmZWN0ZWQgYnkgdGhpcyBzZXR0aW5nIGFuZCB3aWxsIHJ1biBvdXRzaWRlIHRoZSBWUEMuXG4gICAqXG4gICAqIE1ha2Ugc3VyZSB0aGUgc2VsZWN0ZWQgVlBDIGFuZCBzdWJuZXRzIGhhdmUgYWNjZXNzIHRvIHRoZSBmb2xsb3dpbmcgd2l0aCBlaXRoZXIgTkFUIEdhdGV3YXkgb3IgVlBDIEVuZHBvaW50czpcbiAgICogKiBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXJcbiAgICogKiBTZWNyZXRzIE1hbmFnZXJcbiAgICogKiBTUVNcbiAgICogKiBTdGVwIEZ1bmN0aW9uc1xuICAgKiAqIENsb3VkRm9ybWF0aW9uIChzdGF0dXMgZnVuY3Rpb24gb25seSlcbiAgICogKiBFQzJcbiAgICogKiBFQ1IgKHN0YXR1cyBmdW5jdGlvbiBvbmx5KVxuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFZQQyBzdWJuZXRzIHVzZWQgZm9yIGFsbCBtYW5hZ2VtZW50IGZ1bmN0aW9ucy4gVXNlIHRoaXMgd2l0aCBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgaG9zdGVkIHRoYXQncyBpbmFjY2Vzc2libGUgZnJvbSBvdXRzaWRlIHRoZSBWUEMuXG4gICAqXG4gICAqICoqTm90ZToqKiBUaGlzIG9ubHkgYWZmZWN0cyBtYW5hZ2VtZW50IGZ1bmN0aW9ucyB0aGF0IGludGVyYWN0IHdpdGggR2l0SHViLiBMYW1iZGEgZnVuY3Rpb25zIHRoYXQgaGVscCB3aXRoIHJ1bm5lciBpbWFnZSBidWlsZGluZyBhbmQgZG9uJ3QgaW50ZXJhY3Qgd2l0aCBHaXRIdWIgYXJlIE5PVCBhZmZlY3RlZCBieSB0aGlzIHNldHRpbmcuXG4gICAqL1xuICByZWFkb25seSB2cGNTdWJuZXRzPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogQWxsb3cgbWFuYWdlbWVudCBmdW5jdGlvbnMgdG8gcnVuIGluIHB1YmxpYyBzdWJuZXRzLiBMYW1iZGEgRnVuY3Rpb25zIGluIGEgcHVibGljIHN1Ym5ldCBjYW4gTk9UIGFjY2VzcyB0aGUgaW50ZXJuZXQuXG4gICAqXG4gICAqICoqTm90ZToqKiBUaGlzIG9ubHkgYWZmZWN0cyBtYW5hZ2VtZW50IGZ1bmN0aW9ucyB0aGF0IGludGVyYWN0IHdpdGggR2l0SHViLiBMYW1iZGEgZnVuY3Rpb25zIHRoYXQgaGVscCB3aXRoIHJ1bm5lciBpbWFnZSBidWlsZGluZyBhbmQgZG9uJ3QgaW50ZXJhY3Qgd2l0aCBHaXRIdWIgYXJlIE5PVCBhZmZlY3RlZCBieSB0aGlzIHNldHRpbmcuXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBhbGxvd1B1YmxpY1N1Ym5ldD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwIGF0dGFjaGVkIHRvIGFsbCBtYW5hZ2VtZW50IGZ1bmN0aW9ucy4gVXNlIHRoaXMgd2l0aCB0byBwcm92aWRlIGFjY2VzcyB0byBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgaG9zdGVkIGluc2lkZSBhIFZQQy5cbiAgICpcbiAgICogKipOb3RlOioqIFRoaXMgb25seSBhZmZlY3RzIG1hbmFnZW1lbnQgZnVuY3Rpb25zIHRoYXQgaW50ZXJhY3Qgd2l0aCBHaXRIdWIuIExhbWJkYSBmdW5jdGlvbnMgdGhhdCBoZWxwIHdpdGggcnVubmVyIGltYWdlIGJ1aWxkaW5nIGFuZCBkb24ndCBpbnRlcmFjdCB3aXRoIEdpdEh1YiBhcmUgTk9UIGFmZmVjdGVkIGJ5IHRoaXMgc2V0dGluZy5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBzZWN1cml0eUdyb3Vwc30gaW5zdGVhZFxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cD86IGVjMi5JU2VjdXJpdHlHcm91cDtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXBzIGF0dGFjaGVkIHRvIGFsbCBtYW5hZ2VtZW50IGZ1bmN0aW9ucy4gVXNlIHRoaXMgdG8gcHJvdmlkZSBvdXRib3VuZCBhY2Nlc3MgZnJvbSBtYW5hZ2VtZW50IGZ1bmN0aW9ucyB0byBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgaG9zdGVkIGluc2lkZSBhIFZQQy5cbiAgICpcbiAgICogKipOb3RlOioqIFRoaXMgb25seSBhZmZlY3RzIG1hbmFnZW1lbnQgZnVuY3Rpb25zIHRoYXQgaW50ZXJhY3Qgd2l0aCBHaXRIdWIuIExhbWJkYSBmdW5jdGlvbnMgdGhhdCBoZWxwIHdpdGggcnVubmVyIGltYWdlIGJ1aWxkaW5nIGFuZCBkb24ndCBpbnRlcmFjdCB3aXRoIEdpdEh1YiBhcmUgTk9UIGFmZmVjdGVkIGJ5IHRoaXMgc2V0dGluZy5cbiAgICpcbiAgICogKipOb3RlOioqIERlZmluaW5nIGluYm91bmQgcnVsZXMgb24gdGhpcyBzZWN1cml0eSBncm91cCBkb2VzIG5vdGhpbmcuIFRoaXMgc2VjdXJpdHkgZ3JvdXAgb25seSBjb250cm9scyBvdXRib3VuZCBhY2Nlc3MgRlJPTSB0aGUgbWFuYWdlbWVudCBmdW5jdGlvbnMuIFRvIGxpbWl0IGFjY2VzcyBUTyB0aGUgd2ViaG9vayBvciBzZXR1cCBmdW5jdGlvbnMsIHVzZSB7QGxpbmsgd2ViaG9va0FjY2Vzc30gYW5kIHtAbGluayBzZXR1cEFjY2Vzc30gaW5zdGVhZC5cbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgLyoqXG4gICAqIFBhdGggdG8gYSBjZXJ0aWZpY2F0ZSBmaWxlICgucGVtIG9yIC5jcnQpIG9yIGEgZGlyZWN0b3J5IGNvbnRhaW5pbmcgY2VydGlmaWNhdGUgZmlsZXMgKC5wZW0gb3IgLmNydCkgcmVxdWlyZWQgdG8gdHJ1c3QgR2l0SHViIEVudGVycHJpc2UgU2VydmVyLiBVc2UgdGhpcyB3aGVuIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciBjZXJ0aWZpY2F0ZXMgYXJlIHNlbGYtc2lnbmVkLlxuICAgKlxuICAgKiBJZiBhIGRpcmVjdG9yeSBpcyBwcm92aWRlZCwgYWxsIC5wZW0gYW5kIC5jcnQgZmlsZXMgaW4gdGhhdCBkaXJlY3Rvcnkgd2lsbCBiZSB1c2VkLiBUaGUgY2VydGlmaWNhdGVzIHdpbGwgYmUgY29uY2F0ZW5hdGVkIGludG8gYSBzaW5nbGUgZmlsZSBmb3IgdXNlIGJ5IE5vZGUuanMuXG4gICAqXG4gICAqIFlvdSBtYXkgYWxzbyB3YW50IHRvIHVzZSBjdXN0b20gaW1hZ2VzIGZvciB5b3VyIHJ1bm5lciBwcm92aWRlcnMgdGhhdCBjb250YWluIHRoZSBzYW1lIGNlcnRpZmljYXRlcy4gU2VlIHtAbGluayBSdW5uZXJJbWFnZUNvbXBvbmVudC5leHRyYUNlcnRpZmljYXRlc30uXG4gICAqXG4gICAqIGBgYHR5cGVzY3JpcHRcbiAgICogY29uc3Qgc2VsZlNpZ25lZENlcnRpZmljYXRlcyA9ICdjZXJ0cy9naGVzLnBlbSc7IC8vIG9yICdwYXRoLXRvLW15LWV4dHJhLWNlcnRzLWZvbGRlcicgZm9yIGEgZGlyZWN0b3J5XG4gICAqIGNvbnN0IGltYWdlQnVpbGRlciA9IENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcih0aGlzLCAnSW1hZ2UgQnVpbGRlciB3aXRoIENlcnRzJyk7XG4gICAqIGltYWdlQnVpbGRlci5hZGRDb21wb25lbnQoUnVubmVySW1hZ2VDb21wb25lbnQuZXh0cmFDZXJ0aWZpY2F0ZXMoc2VsZlNpZ25lZENlcnRpZmljYXRlcywgJ3ByaXZhdGUtY2EnKSk7XG4gICAqXG4gICAqIGNvbnN0IHByb3ZpZGVyID0gbmV3IENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyKHRoaXMsICdDb2RlQnVpbGQnLCB7XG4gICAqICAgICBpbWFnZUJ1aWxkZXI6IGltYWdlQnVpbGRlcixcbiAgICogfSk7XG4gICAqXG4gICAqIG5ldyBHaXRIdWJSdW5uZXJzKFxuICAgKiAgIHRoaXMsXG4gICAqICAgJ3J1bm5lcnMnLFxuICAgKiAgIHtcbiAgICogICAgIHByb3ZpZGVyczogW3Byb3ZpZGVyXSxcbiAgICogICAgIGV4dHJhQ2VydGlmaWNhdGVzOiBzZWxmU2lnbmVkQ2VydGlmaWNhdGVzLFxuICAgKiAgIH1cbiAgICogKTtcbiAgICogYGBgXG4gICAqL1xuICByZWFkb25seSBleHRyYUNlcnRpZmljYXRlcz86IHN0cmluZztcblxuICAvKipcbiAgICogVGltZSB0byB3YWl0IGJlZm9yZSBzdG9wcGluZyBhIHJ1bm5lciB0aGF0IHJlbWFpbnMgaWRsZS4gSWYgdGhlIHVzZXIgY2FuY2VsbGVkIHRoZSBqb2IsIG9yIGlmIGFub3RoZXIgcnVubmVyIHN0b2xlIGl0LCB0aGlzIHN0b3BzIHRoZSBydW5uZXIgdG8gYXZvaWQgd2FzdGluZyByZXNvdXJjZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IDUgbWludXRlc1xuICAgKi9cbiAgcmVhZG9ubHkgaWRsZVRpbWVvdXQ/OiBjZGsuRHVyYXRpb247XG5cbiAgLyoqXG4gICAqIExvZ2dpbmcgb3B0aW9ucyBmb3IgdGhlIHN0YXRlIG1hY2hpbmUgdGhhdCBtYW5hZ2VzIHRoZSBydW5uZXJzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBubyBsb2dzXG4gICAqL1xuICByZWFkb25seSBsb2dPcHRpb25zPzogTG9nT3B0aW9ucztcblxuICAvKipcbiAgICogQWNjZXNzIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBzZXR1cCBmdW5jdGlvbi4gT25jZSB5b3UgZmluaXNoIHRoZSBzZXR1cCBwcm9jZXNzLCB5b3UgY2FuIHNldCB0aGlzIHRvIGBMYW1iZGFBY2Nlc3Mubm9BY2Nlc3MoKWAgdG8gcmVtb3ZlIGFjY2VzcyB0byB0aGUgc2V0dXAgZnVuY3Rpb24uIFlvdSBjYW4gYWxzbyB1c2UgYExhbWJkYUFjY2Vzcy5hcGlHYXRld2F5KHsgYWxsb3dlZElwczogWydteS1pcC8wJ119KWAgdG8gbGltaXQgYWNjZXNzIHRvIHlvdXIgSVAgb25seS5cbiAgICpcbiAgICogQGRlZmF1bHQgTGFtYmRhQWNjZXNzLmxhbWJkYVVybCgpXG4gICAqL1xuICByZWFkb25seSBzZXR1cEFjY2Vzcz86IExhbWJkYUFjY2VzcztcblxuXG4gIC8qKlxuICAgKiBBY2Nlc3MgY29uZmlndXJhdGlvbiBmb3IgdGhlIHdlYmhvb2sgZnVuY3Rpb24uIFRoaXMgZnVuY3Rpb24gaXMgY2FsbGVkIGJ5IEdpdEh1YiB3aGVuIGEgbmV3IHdvcmtmbG93IGpvYiBpcyBzY2hlZHVsZWQuIEZvciBhbiBleHRyYSBsYXllciBvZiBzZWN1cml0eSwgeW91IGNhbiBzZXQgdGhpcyB0byBgTGFtYmRhQWNjZXNzLmFwaUdhdGV3YXkoeyBhbGxvd2VkSXBzOiBMYW1iZGFBY2Nlc3MuZ2l0aHViV2ViaG9va0lwcygpIH0pYC5cbiAgICpcbiAgICogWW91IGNhbiBhbHNvIHNldCB0aGlzIHRvIGBMYW1iZGFBY2Nlc3MuYXBpR2F0ZXdheSh7YWxsb3dlZFZwYzogdnBjLCBhbGxvd2VkSXBzOiBbJ0dIRVMuSVAuQUREUkVTUy8zMiddfSlgIGlmIHlvdXIgR2l0SHViIEVudGVycHJpc2UgU2VydmVyIGlzIGhvc3RlZCBpbiBhIFZQQy4gVGhpcyB3aWxsIGNyZWF0ZSBhbiBBUEkgR2F0ZXdheSBlbmRwb2ludCB0aGF0J3Mgb25seSBhY2Nlc3NpYmxlIGZyb20gd2l0aGluIHRoZSBWUEMuXG4gICAqXG4gICAqICpXQVJOSU5HKjogY2hhbmdpbmcgYWNjZXNzIHR5cGUgbWF5IGNoYW5nZSB0aGUgVVJMLiBXaGVuIHRoZSBVUkwgY2hhbmdlcywgeW91IG11c3QgdXBkYXRlIEdpdEh1YiBhcyB3ZWxsLlxuICAgKlxuICAgKiBAZGVmYXVsdCBMYW1iZGFBY2Nlc3MubGFtYmRhVXJsKClcbiAgICovXG4gIHJlYWRvbmx5IHdlYmhvb2tBY2Nlc3M/OiBMYW1iZGFBY2Nlc3M7XG5cbiAgLyoqXG4gICAqIEFjY2VzcyBjb25maWd1cmF0aW9uIGZvciB0aGUgc3RhdHVzIGZ1bmN0aW9uLiBUaGlzIGZ1bmN0aW9uIHJldHVybnMgYSBsb3Qgb2Ygc2Vuc2l0aXZlIGluZm9ybWF0aW9uIGFib3V0IHRoZSBydW5uZXIsIHNvIHlvdSBzaG91bGQgb25seSBhbGxvdyBhY2Nlc3MgdG8gaXQgZnJvbSB0cnVzdGVkIElQcywgaWYgYXQgYWxsLlxuICAgKlxuICAgKiBAZGVmYXVsdCBMYW1iZGFBY2Nlc3Mubm9BY2Nlc3MoKVxuICAgKi9cbiAgcmVhZG9ubHkgc3RhdHVzQWNjZXNzPzogTGFtYmRhQWNjZXNzO1xuXG4gIC8qKlxuICAgKiBPcHRpb25zIHRvIHJldHJ5IG9wZXJhdGlvbiBpbiBjYXNlIG9mIGZhaWx1cmUgbGlrZSBtaXNzaW5nIGNhcGFjaXR5LCBvciBBUEkgcXVvdGEgaXNzdWVzLlxuICAgKlxuICAgKiBHaXRIdWIgam9icyB0aW1lIG91dCBhZnRlciBub3QgYmVpbmcgYWJsZSB0byBnZXQgYSBydW5uZXIgZm9yIDI0IGhvdXJzLiBZb3Ugc2hvdWxkIG5vdCByZXRyeSBmb3IgbW9yZSB0aGFuIDI0IGhvdXJzLlxuICAgKlxuICAgKiBSZXRyaWVzIHVzZSBmdWxsIGppdHRlciwgc28gdG90YWwgdGltZSBzcGVudCB3YWl0aW5nIGlzIGFib3V0IGhhbGYgdGhlIHN1bSBvZiBtaW4oaW50ZXJ2YWwgKiBiYWNrb2ZmUmF0ZSBeIGF0dGVtcHQsIG1heERlbGF5KSBvdmVyIGFsbCBhdHRlbXB0cy5cbiAgICpcbiAgICogQGRlZmF1bHQgcmV0cnkgMjEwIHRpbWVzIG92ZXIgYSBiaXQgbW9yZSB0aGFuIDI0IGhvdXJzXG4gICAqL1xuICByZWFkb25seSByZXRyeU9wdGlvbnM/OiBQcm92aWRlclJldHJ5T3B0aW9ucztcblxuICAvKipcbiAgICogT3B0aW9uYWwgTGFtYmRhIGZ1bmN0aW9uIHRvIGN1c3RvbWl6ZSBwcm92aWRlciBzZWxlY3Rpb24gbG9naWMgYW5kIGxhYmVsIGFzc2lnbm1lbnQuXG4gICAqXG4gICAqICogVGhlIGZ1bmN0aW9uIHJlY2VpdmVzIHRoZSB3ZWJob29rIHBheWxvYWQgYWxvbmcgd2l0aCBkZWZhdWx0IHByb3ZpZGVyIGFuZCBpdHMgbGFiZWxzIGFzIHtAbGluayBQcm92aWRlclNlbGVjdG9ySW5wdXR9XG4gICAqICogVGhlIGZ1bmN0aW9uIHJldHVybnMgYSBzZWxlY3RlZCBwcm92aWRlciBhbmQgaXRzIGxhYmVscyBhcyB7QGxpbmsgUHJvdmlkZXJTZWxlY3RvclJlc3VsdH1cbiAgICogKiBZb3UgY2FuIGRlY2xpbmUgdG8gcHJvdmlzaW9uIGEgcnVubmVyIGJ5IHJldHVybmluZyB1bmRlZmluZWQgYXMgdGhlIHByb3ZpZGVyIGluIHRoZSBzZWxlY3RvciByZXN1bHRcbiAgICogKiBZb3UgY2FuIGZ1bGx5IGN1c3RvbWl6ZSB0aGUgbGFiZWxzIGZvciB0aGUgYWJvdXQtdG8tYmUtcHJvdmlzaW9uZWQgcnVubmVyIChhZGQsIHJlbW92ZSwgbW9kaWZ5LCBkeW5hbWljIGxhYmVscywgZXRjLilcbiAgICogKiBMYWJlbHMgZG9uJ3QgaGF2ZSB0byBtYXRjaCB0aGUgbGFiZWxzIG9yaWdpbmFsbHkgY29uZmlndXJlZCBmb3IgdGhlIHByb3ZpZGVyLCBidXQgc2VlIHdhcm5pbmdzIGJlbG93XG4gICAqICogVGhpcyBmdW5jdGlvbiB3aWxsIGJlIGNhbGxlZCBzeW5jaHJvbm91c2x5IGR1cmluZyB3ZWJob29rIHByb2Nlc3NpbmcsIHNvIGl0IHNob3VsZCBiZSBmYXN0IGFuZCBlZmZpY2llbnQgKHdlYmhvb2sgbGltaXQgaXMgMzAgc2Vjb25kcyB0b3RhbClcbiAgICpcbiAgICogKipXQVJOSU5HOiBJdCBpcyB5b3VyIHJlc3BvbnNpYmlsaXR5IHRvIGVuc3VyZSB0aGUgc2VsZWN0ZWQgcHJvdmlkZXIncyBsYWJlbHMgbWF0Y2ggdGhlIGpvYidzIHJlcXVpcmVkIGxhYmVscy4gSWYgeW91IHJldHVybiB0aGUgd3JvbmcgbGFiZWxzLCB0aGUgcnVubmVyIHdpbGwgYmUgY3JlYXRlZCBidXQgR2l0SHViIEFjdGlvbnMgd2lsbCBub3QgYXNzaWduIHRoZSBqb2IgdG8gaXQuKipcbiAgICpcbiAgICogKipXQVJOSU5HOiBQcm92aWRlciBzZWxlY3Rpb24gaXMgbm90IGEgZ3VhcmFudGVlIHRoYXQgYSBzcGVjaWZpYyBwcm92aWRlciB3aWxsIGJlIGFzc2lnbmVkIGZvciB0aGUgam9iLiBHaXRIdWIgQWN0aW9ucyBtYXkgYXNzaWduIHRoZSBqb2IgdG8gYW55IHJ1bm5lciB3aXRoIG1hdGNoaW5nIGxhYmVscy4gVGhlIHByb3ZpZGVyIHNlbGVjdG9yIG9ubHkgZGV0ZXJtaW5lcyB3aGljaCBwcm92aWRlcidzIHJ1bm5lciB3aWxsIGJlICpjcmVhdGVkKiwgYnV0IEdpdEh1YiBBY3Rpb25zIG1heSByb3V0ZSB0aGUgam9iIHRvIGFueSBhdmFpbGFibGUgcnVubmVyIHdpdGggdGhlIHJlcXVpcmVkIGxhYmVscy4qKlxuICAgKlxuICAgKiAqKkZvciByZWxpYWJsZSBwcm92aWRlciBhc3NpZ25tZW50IGJhc2VkIG9uIGpvYiBjaGFyYWN0ZXJpc3RpY3MsIGNvbnNpZGVyIHVzaW5nIHJlcG8tbGV2ZWwgcnVubmVyIHJlZ2lzdHJhdGlvbiB3aGVyZSB5b3UgY2FuIGNvbnRyb2wgd2hpY2ggcnVubmVycyBhcmUgYXZhaWxhYmxlIGZvciBzcGVjaWZpYyByZXBvc2l0b3JpZXMuIFRoaXMgaW5mb3JtYXRpb24gaXMgYWxzbyBhdmFpbGFibGUgd2hpbGUgdXNpbmcgdGhlIHNldHVwIHdpemFyZC5cbiAgICpcbiAgICogQHNlZSBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycy9ibG9iL21haW4vU0VUVVBfR0lUSFVCLm1kXG4gICAqL1xuICByZWFkb25seSBwcm92aWRlclNlbGVjdG9yPzogbGFtYmRhLklGdW5jdGlvbjtcbn1cblxuLyoqXG4gKiBEZWZpbmVzIHdoYXQgZXhlY3V0aW9uIGhpc3RvcnkgZXZlbnRzIGFyZSBsb2dnZWQgYW5kIHdoZXJlIHRoZXkgYXJlIGxvZ2dlZC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2dPcHRpb25zIHtcbiAgLyoqXG4gICAqIFRoZSBsb2cgZ3JvdXAgd2hlcmUgdGhlIGV4ZWN1dGlvbiBoaXN0b3J5IGV2ZW50cyB3aWxsIGJlIGxvZ2dlZC5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwTmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogRGV0ZXJtaW5lcyB3aGV0aGVyIGV4ZWN1dGlvbiBkYXRhIGlzIGluY2x1ZGVkIGluIHlvdXIgbG9nLlxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBpbmNsdWRlRXhlY3V0aW9uRGF0YT86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIERlZmluZXMgd2hpY2ggY2F0ZWdvcnkgb2YgZXhlY3V0aW9uIGhpc3RvcnkgZXZlbnRzIGFyZSBsb2dnZWQuXG4gICAqXG4gICAqIEBkZWZhdWx0IEFMTFxuICAgKi9cbiAgcmVhZG9ubHkgbGV2ZWw/OiBzdGVwZnVuY3Rpb25zLkxvZ0xldmVsO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGRheXMgbG9nIGV2ZW50cyBhcmUga2VwdCBpbiBDbG91ZFdhdGNoIExvZ3MuIFdoZW4gdXBkYXRpbmdcbiAgICogdGhpcyBwcm9wZXJ0eSwgdW5zZXR0aW5nIGl0IGRvZXNuJ3QgcmVtb3ZlIHRoZSBsb2cgcmV0ZW50aW9uIHBvbGljeS4gVG9cbiAgICogcmVtb3ZlIHRoZSByZXRlbnRpb24gcG9saWN5LCBzZXQgdGhlIHZhbHVlIHRvIGBJTkZJTklURWAuXG4gICAqXG4gICAqIEBkZWZhdWx0IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEhcbiAgICovXG4gIHJlYWRvbmx5IGxvZ1JldGVudGlvbj86IGxvZ3MuUmV0ZW50aW9uRGF5cztcbn1cblxuLyoqXG4gKiBDcmVhdGUgYWxsIHRoZSByZXF1aXJlZCBpbmZyYXN0cnVjdHVyZSB0byBwcm92aWRlIHNlbGYtaG9zdGVkIEdpdEh1YiBydW5uZXJzLiBJdCBjcmVhdGVzIGEgd2ViaG9vaywgc2VjcmV0cywgYW5kIGEgc3RlcCBmdW5jdGlvbiB0byBvcmNoZXN0cmF0ZSBhbGwgcnVucy4gU2VjcmV0cyBhcmUgbm90IGF1dG9tYXRpY2FsbHkgZmlsbGVkLiBTZWUgUkVBRE1FLm1kIGZvciBpbnN0cnVjdGlvbnMgb24gaG93IHRvIHNldHVwIEdpdEh1YiBpbnRlZ3JhdGlvbi5cbiAqXG4gKiBCeSBkZWZhdWx0LCB0aGlzIHdpbGwgY3JlYXRlIGEgcnVubmVyIHByb3ZpZGVyIG9mIGVhY2ggYXZhaWxhYmxlIHR5cGUgd2l0aCB0aGUgZGVmYXVsdHMuIFRoaXMgaXMgZ29vZCBlbm91Z2ggZm9yIHRoZSBpbml0aWFsIHNldHVwIHN0YWdlIHdoZW4geW91IGp1c3Qgd2FudCB0byBnZXQgR2l0SHViIGludGVncmF0aW9uIHdvcmtpbmcuXG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogbmV3IEdpdEh1YlJ1bm5lcnModGhpcywgJ3J1bm5lcnMnKTtcbiAqIGBgYFxuICpcbiAqIFVzdWFsbHkgeW91J2Qgd2FudCB0byBjb25maWd1cmUgdGhlIHJ1bm5lciBwcm92aWRlcnMgc28gdGhlIHJ1bm5lcnMgY2FuIHJ1biBpbiBhIGNlcnRhaW4gVlBDIG9yIGhhdmUgY2VydGFpbiBwZXJtaXNzaW9ucy5cbiAqXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBjb25zdCB2cGMgPSBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ3ZwYycsIHsgdnBjSWQ6ICd2cGMtMTIzNDU2NycgfSk7XG4gKiBjb25zdCBydW5uZXJTZyA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAncnVubmVyIHNlY3VyaXR5IGdyb3VwJywgeyB2cGM6IHZwYyB9KTtcbiAqIGNvbnN0IGRiU2cgPSBlYzIuU2VjdXJpdHlHcm91cC5mcm9tU2VjdXJpdHlHcm91cElkKHRoaXMsICdkYXRhYmFzZSBzZWN1cml0eSBncm91cCcsICdzZy0xMjM0NTY3Jyk7XG4gKiBjb25zdCBidWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdydW5uZXIgYnVja2V0Jyk7XG4gKlxuICogLy8gY3JlYXRlIGEgY3VzdG9tIENvZGVCdWlsZCBwcm92aWRlclxuICogY29uc3QgbXlQcm92aWRlciA9IG5ldyBDb2RlQnVpbGRSdW5uZXJQcm92aWRlcihcbiAqICAgdGhpcywgJ2NvZGVidWlsZCBydW5uZXInLFxuICogICB7XG4gKiAgICAgIGxhYmVsczogWydteS1jb2RlYnVpbGQnXSxcbiAqICAgICAgdnBjOiB2cGMsXG4gKiAgICAgIHNlY3VyaXR5R3JvdXBzOiBbcnVubmVyU2ddLFxuICogICB9LFxuICogKTtcbiAqIC8vIGdyYW50IHNvbWUgcGVybWlzc2lvbnMgdG8gdGhlIHByb3ZpZGVyXG4gKiBidWNrZXQuZ3JhbnRSZWFkV3JpdGUobXlQcm92aWRlcik7XG4gKiBkYlNnLmNvbm5lY3Rpb25zLmFsbG93RnJvbShydW5uZXJTZywgZWMyLlBvcnQudGNwKDMzMDYpLCAnYWxsb3cgcnVubmVycyB0byBjb25uZWN0IHRvIE15U1FMIGRhdGFiYXNlJyk7XG4gKlxuICogLy8gY3JlYXRlIHRoZSBydW5uZXIgaW5mcmFzdHJ1Y3R1cmVcbiAqIG5ldyBHaXRIdWJSdW5uZXJzKFxuICogICB0aGlzLFxuICogICAncnVubmVycycsXG4gKiAgIHtcbiAqICAgICBwcm92aWRlcnM6IFtteVByb3ZpZGVyXSxcbiAqICAgfVxuICogKTtcbiAqIGBgYFxuICovXG5leHBvcnQgY2xhc3MgR2l0SHViUnVubmVycyBleHRlbmRzIENvbnN0cnVjdCBpbXBsZW1lbnRzIGVjMi5JQ29ubmVjdGFibGUge1xuICAvKipcbiAgICogQ29uZmlndXJlZCBydW5uZXIgcHJvdmlkZXJzLlxuICAgKi9cbiAgcmVhZG9ubHkgcHJvdmlkZXJzOiAoSVJ1bm5lclByb3ZpZGVyIHwgSUNvbXBvc2l0ZVByb3ZpZGVyKVtdO1xuXG4gIC8qKlxuICAgKiBTZWNyZXRzIGZvciBHaXRIdWIgY29tbXVuaWNhdGlvbiBpbmNsdWRpbmcgd2ViaG9vayBzZWNyZXQgYW5kIHJ1bm5lciBhdXRoZW50aWNhdGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IHNlY3JldHM6IFNlY3JldHM7XG5cbiAgLyoqXG4gICAqIE1hbmFnZSB0aGUgY29ubmVjdGlvbnMgb2YgYWxsIG1hbmFnZW1lbnQgZnVuY3Rpb25zLiBVc2UgdGhpcyB0byBlbmFibGUgY29ubmVjdGlvbnMgdG8geW91ciBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgaW4gYSBWUEMuXG4gICAqXG4gICAqIFRoaXMgY2Fubm90IGJlIHVzZWQgdG8gbWFuYWdlIGNvbm5lY3Rpb25zIG9mIHRoZSBydW5uZXJzLiBVc2UgdGhlIGBjb25uZWN0aW9uc2AgcHJvcGVydHkgb2YgZWFjaCBydW5uZXIgcHJvdmlkZXIgdG8gbWFuYWdlIHJ1bm5lciBjb25uZWN0aW9ucy5cbiAgICovXG4gIHJlYWRvbmx5IGNvbm5lY3Rpb25zOiBlYzIuQ29ubmVjdGlvbnM7XG5cbiAgcHJpdmF0ZSByZWFkb25seSB3ZWJob29rOiBHaXRodWJXZWJob29rSGFuZGxlcjtcbiAgcHJpdmF0ZSByZWFkb25seSByZWRlbGl2ZXJlcjogR2l0aHViV2ViaG9va1JlZGVsaXZlcnk7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3JjaGVzdHJhdG9yOiBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdG9sZW5SdW5uZXJEZXRlY3RvcjogU3RvbGVuUnVubmVyRGV0ZWN0b3I7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2V0dXBVcmw6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBleHRyYUxhbWJkYUVudjogeyBbcDogc3RyaW5nXTogc3RyaW5nIH0gPSB7fTtcbiAgcHJpdmF0ZSByZWFkb25seSBleHRyYUxhbWJkYVByb3BzOiBsYW1iZGEuRnVuY3Rpb25PcHRpb25zO1xuICBwcml2YXRlIHN0YXRlTWFjaGluZUxvZ0dyb3VwPzogbG9ncy5Mb2dHcm91cDtcbiAgcHJpdmF0ZSByZWFkb25seSBwYXJhbWV0ZXJpemVkUHJvdmlkZXJzOiBJUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyW10gPSBbXTtcbiAgcHJpdmF0ZSBqb2JzQ29tcGxldGVkTWV0cmljRmlsdGVyc0luaXRpYWxpemVkID0gZmFsc2U7XG4gIHByaXZhdGUgc3RvbGVuUnVubmVyc01ldHJpY0ZpbHRlckluaXRpYWxpemVkID0gZmFsc2U7XG4gIHByaXZhdGUgc3RvcHBlZFJ1bm5lcnNNZXRyaWNGaWx0ZXJJbml0aWFsaXplZCA9IGZhbHNlO1xuICBwcml2YXRlIG11bHRpcGxlUHJvdmlkZXJzTWV0cmljRmlsdGVySW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSB3YXJtUnVubmVyTWFuYWdlcj86IGxhbWJkYS5GdW5jdGlvbjtcbiAgcHJpdmF0ZSB3YXJtUnVubmVyUXVldWU/OiBzcXMuUXVldWU7XG4gIHByaXZhdGUgd2FybUNvbmZpZ0hhc2hlczogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSB3YXJtTWF4RHVyYXRpb24gPSAwO1xuICBwcml2YXRlIHJlYWRvbmx5IGlkbGVSZWFwZXJGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uO1xuICBwcml2YXRlIHJlYWRvbmx5IG1hbmFnZW1lbnRGdW5jdGlvbnM6IGxhbWJkYS5JRnVuY3Rpb25bXSA9IFtdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHJlYWRvbmx5IHByb3BzPzogR2l0SHViUnVubmVyc1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIHRoaXMuc2VjcmV0cyA9IG5ldyBTZWNyZXRzKHRoaXMsICdTZWNyZXRzJyk7XG5cbiAgICB0aGlzLmV4dHJhTGFtYmRhUHJvcHMgPSB7XG4gICAgICB2cGM6IHRoaXMucHJvcHM/LnZwYyxcbiAgICAgIHZwY1N1Ym5ldHM6IHRoaXMucHJvcHM/LnZwY1N1Ym5ldHMsXG4gICAgICBhbGxvd1B1YmxpY1N1Ym5ldDogdGhpcy5wcm9wcz8uYWxsb3dQdWJsaWNTdWJuZXQsXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5sYW1iZGFTZWN1cml0eUdyb3VwcygpLFxuICAgICAgbGF5ZXJzOiBbXSxcbiAgICB9O1xuICAgIHRoaXMuY29ubmVjdGlvbnMgPSBuZXcgZWMyLkNvbm5lY3Rpb25zKHsgc2VjdXJpdHlHcm91cHM6IHRoaXMuZXh0cmFMYW1iZGFQcm9wcy5zZWN1cml0eUdyb3VwcyB9KTtcblxuICAgIHRoaXMuY3JlYXRlQ2VydGlmaWNhdGVMYXllcihzY29wZSk7XG5cbiAgICBpZiAodGhpcy5wcm9wcz8ucHJvdmlkZXJzKSB7XG4gICAgICB0aGlzLnByb3ZpZGVycyA9IHRoaXMucHJvcHMucHJvdmlkZXJzO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnByb3ZpZGVycyA9IFtcbiAgICAgICAgbmV3IENvZGVCdWlsZFJ1bm5lclByb3ZpZGVyKHRoaXMsICdDb2RlQnVpbGQnKSxcbiAgICAgICAgbmV3IExhbWJkYVJ1bm5lclByb3ZpZGVyKHRoaXMsICdMYW1iZGEnKSxcbiAgICAgICAgbmV3IEZhcmdhdGVSdW5uZXJQcm92aWRlcih0aGlzLCAnRmFyZ2F0ZScpLFxuICAgICAgXTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5wcm92aWRlcnMubGVuZ3RoID09IDApIHtcbiAgICAgIEFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdBdCBsZWFzdCBvbmUgcnVubmVyIHByb3ZpZGVyIGlzIHJlcXVpcmVkJyk7XG4gICAgfVxuXG4gICAgdGhpcy5jaGVja0ludGVyc2VjdGluZ0xhYmVscygpO1xuXG4gICAgLy8gdGhlIHN0YXRlIG1hY2hpbmUgb25seSBrbm93cyBob3cgdG8gcnVuIHRoZSBidWlsdC1pbiBwcm92aWRlcnNcbiAgICAvLyBpbnN0YW5jZW9mIGRvZXNuJ3QgcmVhbGx5IHdvcmsgaW4gQ0RLIHNvIGR1Y2stdHlwZSBpbnN0ZWFkXG4gICAgZm9yIChjb25zdCBwcm92aWRlciBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgaWYgKCFpc1BhcmFtZXRlcml6ZWRSdW5uZXJQcm92aWRlcihwcm92aWRlcikpIHtcbiAgICAgICAgQW5ub3RhdGlvbnMub2YocHJvdmlkZXIpLmFkZEVycm9yKFxuICAgICAgICAgICdDdXN0b20gcnVubmVyIHByb3ZpZGVycyBhcmUgbm90IHN1cHBvcnRlZC4gVXNlIHRoZSBidWlsdC1pbiBwcm92aWRlcnMsIG9yIG9wZW4gYW4gaXNzdWUgZGVzY3JpYmluZyB5b3VyIHVzZSBjYXNlLicsXG4gICAgICAgICk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdGhpcy5wYXJhbWV0ZXJpemVkUHJvdmlkZXJzLnB1c2gocHJvdmlkZXIpO1xuICAgIH1cblxuICAgIHRoaXMuaWRsZVJlYXBlckZ1bmN0aW9uID0gdGhpcy5pZGxlUmVhcGVyKCk7XG4gICAgdGhpcy5vcmNoZXN0cmF0b3IgPSB0aGlzLnN0YXRlTWFjaGluZShwcm9wcyk7XG4gICAgdGhpcy5zdG9sZW5SdW5uZXJEZXRlY3RvciA9IG5ldyBTdG9sZW5SdW5uZXJEZXRlY3Rvcih0aGlzLCAnU3RvbGVuIFJ1bm5lcnMnLCB7XG4gICAgICBzZWNyZXRzOiB0aGlzLnNlY3JldHMsXG4gICAgICBvcmNoZXN0cmF0b3I6IHRoaXMub3JjaGVzdHJhdG9yLFxuICAgICAgcnVubmVyTG9nR3JvdXBzOiBbLi4udGhpcy5leHRyYWN0VW5pcXVlU3ViUHJvdmlkZXJzKCldLm1hcChwID0+IHAubG9nR3JvdXApLFxuICAgICAgZXh0cmFMYW1iZGFQcm9wczogdGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgZXh0cmFMYW1iZGFFbnY6IHRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgfSk7XG4gICAgdGhpcy53ZWJob29rID0gbmV3IEdpdGh1YldlYmhvb2tIYW5kbGVyKHRoaXMsICdXZWJob29rIEhhbmRsZXInLCB7XG4gICAgICBvcmNoZXN0cmF0b3I6IHRoaXMub3JjaGVzdHJhdG9yLFxuICAgICAgc2VjcmV0czogdGhpcy5zZWNyZXRzLFxuICAgICAgYWNjZXNzOiB0aGlzLnByb3BzPy53ZWJob29rQWNjZXNzID8/IExhbWJkYUFjY2Vzcy5sYW1iZGFVcmwoKSxcbiAgICAgIHByb3ZpZGVyczogdGhpcy5wcm92aWRlcnMucmVkdWNlPFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPj4oKGFjYywgcCkgPT4ge1xuICAgICAgICBhY2NbcC5ub2RlLnBhdGhdID0gcC5sYWJlbHM7XG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgICB9LCB7fSksXG4gICAgICByZXF1aXJlU2VsZkhvc3RlZExhYmVsOiB0aGlzLnByb3BzPy5yZXF1aXJlU2VsZkhvc3RlZExhYmVsID8/IHRydWUsXG4gICAgICBwcm92aWRlclNlbGVjdG9yOiB0aGlzLnByb3BzPy5wcm92aWRlclNlbGVjdG9yLFxuICAgICAgc3RvbGVuUnVubmVyUXVldWU6IHRoaXMuc3RvbGVuUnVubmVyRGV0ZWN0b3IucXVldWUsXG4gICAgICBleHRyYUxhbWJkYVByb3BzOiB0aGlzLmV4dHJhTGFtYmRhUHJvcHMsXG4gICAgICBleHRyYUxhbWJkYUVudjogdGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgIGlkbGVUaW1lb3V0U2Vjb25kczogdGhpcy5wcm9wcz8uaWRsZVRpbWVvdXQ/LnRvU2Vjb25kcygpLFxuICAgIH0pO1xuICAgIHRoaXMuc3RvbGVuUnVubmVyRGV0ZWN0b3IuZ3JhbnRSZWNvcmRSdW5uZXJzKHRoaXMud2ViaG9vay5oYW5kbGVyKTtcbiAgICB0aGlzLnN0b2xlblJ1bm5lckRldGVjdG9yLmdyYW50UmVjb3JkUnVubmVycyh0aGlzLmlkbGVSZWFwZXJGdW5jdGlvbik7XG4gICAgdGhpcy5yZWRlbGl2ZXJlciA9IG5ldyBHaXRodWJXZWJob29rUmVkZWxpdmVyeSh0aGlzLCAnV2ViaG9vayBSZWRlbGl2ZXJ5Jywge1xuICAgICAgc2VjcmV0czogdGhpcy5zZWNyZXRzLFxuICAgICAgZXh0cmFMYW1iZGFQcm9wczogdGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgZXh0cmFMYW1iZGFFbnY6IHRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgfSk7XG5cbiAgICB0aGlzLm1hbmFnZW1lbnRGdW5jdGlvbnMucHVzaCh0aGlzLndlYmhvb2suaGFuZGxlciwgdGhpcy5yZWRlbGl2ZXJlci5oYW5kbGVyLCB0aGlzLnN0b2xlblJ1bm5lckRldGVjdG9yLmhhbmRsZXIpO1xuXG4gICAgdGhpcy5zZXR1cFVybCA9IHRoaXMuc2V0dXBGdW5jdGlvbigpO1xuICAgIHRoaXMuc3RhdHVzRnVuY3Rpb24oKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGVNYWNoaW5lKHByb3BzPzogR2l0SHViUnVubmVyc1Byb3BzKSB7XG4gICAgLy8gcnVucyBhZnRlciB0aGUgY29uZmlnIGlzIHNlbGVjdGVkIHNvIGl0IGNhbiBjaGVjayB0aGUgc2VsZWN0ZWQgY29uZmlnIGFnYWluc3QgdGhlIEdpdEh1YiBzZXR1cCwgYW5kIGZhaWwgYmVmb3JlIGFueSBwcm92aWRlciBzdGFydHMgYW5cbiAgICAvLyBpbnN0YW5jZSwgYSBidWlsZCwgb3IgYSB0YXNrXG4gICAgY29uc3QgdG9rZW5SZXRyaWV2ZXJUYXNrID0gbmV3IHN0ZXBmdW5jdGlvbnNfdGFza3MuTGFtYmRhSW52b2tlKFxuICAgICAgdGhpcyxcbiAgICAgICdHZXQgUnVubmVyIFRva2VuJyxcbiAgICAgIHtcbiAgICAgICAgbGFtYmRhRnVuY3Rpb246IHRoaXMudG9rZW5SZXRyaWV2ZXIoKSxcbiAgICAgICAgcGF5bG9hZFJlc3BvbnNlT25seTogdHJ1ZSxcbiAgICAgICAgcmVzdWx0UGF0aDogJyQucnVubmVyJyxcbiAgICAgICAgcGF5bG9hZDogc3RlcGZ1bmN0aW9ucy5UYXNrSW5wdXQuZnJvbU9iamVjdCg8VG9rZW5SZXRyaWV2ZXJJbnB1dD57XG4gICAgICAgICAgb3duZXI6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQub3duZXInKSxcbiAgICAgICAgICByZXBvOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnJlcG8nKSxcbiAgICAgICAgICBydW5uZXJOYW1lOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckJC5FeGVjdXRpb24uTmFtZScpLFxuICAgICAgICAgIGluc3RhbGxhdGlvbklkOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLm51bWJlckF0KCckLmluc3RhbGxhdGlvbklkJyksXG4gICAgICAgICAgZ3JvdXA6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQucHJvdmlkZXJQYXJhbXMucnVubmVyR3JvdXAnKSxcbiAgICAgICAgICBsYWJlbHM6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQubGFiZWxzJyksXG4gICAgICAgICAgZGVmYXVsdExhYmVsczogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5saXN0QXQoJyQucHJvdmlkZXJQYXJhbXMuZGVmYXVsdExhYmVscycpLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIGNvbnN0IGRlZmF1bHRJZGxlU2Vjb25kcyA9IChwcm9wcz8uaWRsZVRpbWVvdXQgPz8gY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkpLnRvU2Vjb25kcygpO1xuXG4gICAgY29uc3QgcXVldWVJZGxlUmVhcGVyVGFzayA9IG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLlNxc1NlbmRNZXNzYWdlKHRoaXMsICdRdWV1ZSBJZGxlIFJlYXBlcicsIHtcbiAgICAgIHF1ZXVlOiB0aGlzLmlkbGVSZWFwZXJRdWV1ZSh0aGlzLmlkbGVSZWFwZXJGdW5jdGlvbiksXG4gICAgICBxdWVyeUxhbmd1YWdlOiBzdGVwZnVuY3Rpb25zLlF1ZXJ5TGFuZ3VhZ2UuSlNPTkFUQSxcbiAgICAgIG1lc3NhZ2VCb2R5OiBzdGVwZnVuY3Rpb25zLlRhc2tJbnB1dC5mcm9tT2JqZWN0KHtcbiAgICAgICAgZXhlY3V0aW9uQXJuOiAneyUgJHN0YXRlcy5jb250ZXh0LkV4ZWN1dGlvbi5JZCAlfScsXG4gICAgICAgIHJ1bm5lck5hbWU6ICd7JSAkc3RhdGVzLmNvbnRleHQuRXhlY3V0aW9uLk5hbWUgJX0nLFxuICAgICAgICBvd25lcjogJ3slICRzdGF0ZXMuaW5wdXQub3duZXIgJX0nLFxuICAgICAgICByZXBvOiAneyUgJHN0YXRlcy5pbnB1dC5yZXBvICV9JyxcbiAgICAgICAgaW5zdGFsbGF0aW9uSWQ6ICd7JSAkc3RhdGVzLmlucHV0Lmluc3RhbGxhdGlvbklkICV9JyxcbiAgICAgICAgbWF4SWRsZVNlY29uZHM6IGB7JSAkZXhpc3RzKCRzdGF0ZXMuaW5wdXQubWF4SWRsZVNlY29uZHMpID8gJHN0YXRlcy5pbnB1dC5tYXhJZGxlU2Vjb25kcyA6ICR7ZGVmYXVsdElkbGVTZWNvbmRzfSAlfWAsXG4gICAgICB9KSxcbiAgICAgIG91dHB1dHM6ICd7JSAkc3RhdGVzLmlucHV0ICV9JywgLy8gZGlzY2FyZFxuICAgIH0pO1xuXG4gICAgLy8gd2UgZW1iZWQgZXZlcnkgcHJvdmlkZXIncyBjb25maWcgaW4gdGhlIGRlZmluaXRpb24gYW5kIGxvb2sgaXQgdXAgYnkgdGhlIHByb3ZpZGVyIHBhdGggdGhlIHdlYmhvb2sgc2VuZHNcbiAgICAvLyB0aGUgZnJhZ21lbnRzIHRoZW4gcmVhZCBpdCBmcm9tICQucHJvdmlkZXJQYXJhbXMsIHNvIG9uZSBmcmFnbWVudCBwZXIgZmFtaWx5IHJ1bnMgYW55IG51bWJlciBvZiBwcm92aWRlcnNcbiAgICBjb25zdCBwcm92aWRlckNvbmZpZ3M6IFJlY29yZDxzdHJpbmcsIEFueVJ1bm5lckNvbmZpZz4gPSB7fTtcbiAgICBjb25zdCB1c2VkRmFtaWxpZXMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIHRoaXMucGFyYW1ldGVyaXplZFByb3ZpZGVycykge1xuICAgICAgY29uc3QgcHJvdmlkZXJDb25maWcgPSBwcm92aWRlci5fcnVubmVyQ29uZmlnKCk7XG4gICAgICBwcm92aWRlckNvbmZpZ3NbcHJvdmlkZXIubm9kZS5wYXRoXSA9IHByb3ZpZGVyQ29uZmlnO1xuICAgICAgZm9yIChjb25zdCBmYW1pbHkgb2YgY29uZmlnRmFtaWxpZXMocHJvdmlkZXJDb25maWcpKSB7XG4gICAgICAgIGlmICghRkFNSUxZX0ZSQUdNRU5UUy5oYXMoZmFtaWx5KSkge1xuICAgICAgICAgIEFubm90YXRpb25zLm9mKHByb3ZpZGVyKS5hZGRFcnJvcihcbiAgICAgICAgICAgIGBVbmtub3duIHJ1bm5lciBmYW1pbHkgXCIke2ZhbWlseX1cIi4gQXZhaWxhYmxlIGZhbWlsaWVzIGFyZTogJHtbLi4uRkFNSUxZX0ZSQUdNRU5UUy5rZXlzKCldLnNvcnQoKS5qb2luKCcsICcpfS5gLFxuICAgICAgICAgICk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgdXNlZEZhbWlsaWVzLmFkZChmYW1pbHkpO1xuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBmYW1pbGllcyA9IFsuLi51c2VkRmFtaWxpZXNdLnNvcnQoKTtcbiAgICBjb25zdCBwcm92aWRlckNvbnN0czogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9O1xuICAgIGZvciAoY29uc3QgZmFtaWx5IG9mIGZhbWlsaWVzKSB7XG4gICAgICBPYmplY3QuYXNzaWduKHByb3ZpZGVyQ29uc3RzLCBGQU1JTFlfQ09OU1RBTlRTLmdldChmYW1pbHkpPy4oKSA/PyB7fSk7XG4gICAgfVxuICAgIGNvbnN0IGNvbmZpZ1Bhc3MgPSBuZXcgc3RlcGZ1bmN0aW9ucy5QYXNzKHRoaXMsICdMb2FkIENvbmZpZycsIHtcbiAgICAgIC8vIHZhcmlhYmxlcyB0aGF0IGRvbid0IG5lZWQgdG8gYmUgcGFydCBvZiB0aGUgc3RhdGVcbiAgICAgIC8vIHN0YXRlcyBhcmUgbGltaXRlZCB0byAyNTZrYiBidXQgdmFyaWFibGVzIGNhbiBoYXZlIHVwIHRvIDEwbWJcbiAgICAgIC8vIGVhc2llciB0byBkZWJ1ZyB3aXRoIHNtYWxsZXIgc3RhdGVzIHRvb1xuICAgICAgYXNzaWduOiB7XG4gICAgICAgIHByb3ZpZGVyQ29uZmlncyxcbiAgICAgICAgLi4ucHJvdmlkZXJDb25zdHMsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3Qgc2VsZWN0Q29uZmlnID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFzcyh0aGlzLCAnU2VsZWN0IFByb3ZpZGVyIENvbmZpZycsIHtcbiAgICAgIHF1ZXJ5TGFuZ3VhZ2U6IHN0ZXBmdW5jdGlvbnMuUXVlcnlMYW5ndWFnZS5KU09OQVRBLFxuICAgICAgb3V0cHV0czogYHslICR7c2VsZWN0UHJvdmlkZXJQYXJhbXModGhpcywgJyRsb29rdXAoJHByb3ZpZGVyQ29uZmlncywgJHN0YXRlcy5pbnB1dC5wcm92aWRlciknKX0gJX1gLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcHJvdmlkZXJGYW1pbHlDaG9vc2VyID0gbmV3IHN0ZXBmdW5jdGlvbnMuQ2hvaWNlKHRoaXMsICdDaG9vc2UgUHJvdmlkZXIgRmFtaWx5Jyk7XG5cblxuICAgIC8vIG9uZSBmcmFnbWVudCBwZXIgZmFtaWx5IGluIHVzZSwgd2l0aCBzdGFibGUgY29uc3RydWN0IElEcyBzbyBhZGRpbmcgb3IgcmVtb3ZpbmcgcHJvdmlkZXJzIGRvZXNuJ3QgY2hhbmdlIHRoZSBzdGF0ZSBtYWNoaW5lXG4gICAgZm9yIChjb25zdCBmYW1pbHkgb2YgZmFtaWxpZXMpIHtcbiAgICAgIGNvbnN0IGJ1aWxkZXIgPSBGQU1JTFlfRlJBR01FTlRTLmdldChmYW1pbHkpITtcbiAgICAgIHByb3ZpZGVyRmFtaWx5Q2hvb3Nlci53aGVuKFxuICAgICAgICBzdGVwZnVuY3Rpb25zLkNvbmRpdGlvbi5zdHJpbmdFcXVhbHMoJyQucHJvdmlkZXJQYXJhbXMuZmFtaWx5JywgZmFtaWx5KSxcbiAgICAgICAgYnVpbGRlcih0aGlzKSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcHJvdmlkZXJGYW1pbHlDaG9vc2VyLm90aGVyd2lzZShuZXcgc3RlcGZ1bmN0aW9ucy5TdWNjZWVkKHRoaXMsICdVbmtub3duIHByb3ZpZGVyJykpO1xuXG4gICAgLy8gYSBjb25maWcgY2FuIGNoYWluIGEgZmFsbGJhY2sgdG8gdHJ5IHdoZW4gaXQgZmFpbHMgKENvbXBvc2l0ZVByb3ZpZGVyLmZhbGxiYWNrLCBFQzIgc3VibmV0cylcbiAgICAvLyB0aGlzIHBhcmFsbGVsIGNhdGNoZXMgdGhlIGZhaWx1cmUsIGNsZWFucyB1cCB0aGUgcnVubmVyLCBhbmQgbG9vcHMgYmFjayB3aXRoIHRoZSBuZXh0IGNvbmZpZ1xuICAgIGNvbnN0IHRyeVByb3ZpZGVyID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFyYWxsZWwodGhpcywgJ1RyeSBQcm92aWRlcicpLmJyYW5jaChwcm92aWRlckZhbWlseUNob29zZXIpO1xuXG4gICAgY29uc3QgZmFsbGJhY2tDbGVhbnVwID0gbmV3IHN0ZXBmdW5jdGlvbnNfdGFza3MuTGFtYmRhSW52b2tlKHRoaXMsICdDbGVhbiBVcCBGYWlsZWQgUnVubmVyJywge1xuICAgICAgY29tbWVudDogJ0NsZWFuLXVwIGZhaWxlZCBydW5uZXIgZnJvbSBHaXRIdWIgQWN0aW9ucyAoaWYgcHJlc2VudCknLFxuICAgICAgbGFtYmRhRnVuY3Rpb246IHRoaXMuZGVsZXRlRmFpbGVkUnVubmVyKCksXG4gICAgICBwYXlsb2FkUmVzcG9uc2VPbmx5OiB0cnVlLFxuICAgICAgcmVzdWx0UGF0aDogJyQuZGVsZXRlJyxcbiAgICAgIHBheWxvYWQ6IHN0ZXBmdW5jdGlvbnMuVGFza0lucHV0LmZyb21PYmplY3Qoe1xuICAgICAgICBydW5uZXJOYW1lOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckJC5FeGVjdXRpb24uTmFtZScpLFxuICAgICAgICBvd25lcjogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5vd25lcicpLFxuICAgICAgICByZXBvOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnJlcG8nKSxcbiAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGgubnVtYmVyQXQoJyQuaW5zdGFsbGF0aW9uSWQnKSxcbiAgICAgICAgZmFtaWx5OiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLnByb3ZpZGVyUGFyYW1zLmZhbWlseScpLFxuICAgICAgICAvLyBhbHdheXMgdGhlcmUgYXMgdGhlIGNhdGNoIGJlbG93IHB1dHMgaXQgdGhlcmUuIG9ubHkgbG9nZ2VkIHNvIGZhaWx1cmUgcmVhc29ucyBjYW4gYmUgc2VlbiB3aXRob3V0IHN0YXRlIG1hY2hpbmUgbG9nZ2luZ1xuICAgICAgICBlcnJvcjogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5vYmplY3RBdCgnJC5lcnJvcicpLFxuICAgICAgfSksXG4gICAgfSk7XG4gICAgLy8gYW55IGVycm9yIG1lYW5zIHdlIGNhbid0IGJlIHN1cmUgdGhlIHJ1bm5lciBpcyBnb25lLiB3ZSBkb24ndCB0cnkgdG8gdGVsbCB0aGVtIGFwYXJ0ICgjMTAwNylcbiAgICBmYWxsYmFja0NsZWFudXAuYWRkUmV0cnkoe1xuICAgICAgZXJyb3JzOiBbc3RlcGZ1bmN0aW9ucy5FcnJvcnMuQUxMXSxcbiAgICAgIGludGVydmFsOiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgIGJhY2tvZmZSYXRlOiAxLFxuICAgICAgbWF4QXR0ZW1wdHM6IDYwLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZmFsbGJhY2tDaG9pY2UgPSBuZXcgc3RlcGZ1bmN0aW9ucy5DaG9pY2UodGhpcywgJ0ZhbGxiYWNrIENvbmZpZ3VyZWQ/Jyk7XG4gICAgY29uc3QgdXNlRmFsbGJhY2sgPSBuZXcgc3RlcGZ1bmN0aW9ucy5QYXNzKHRoaXMsICdVc2UgRmFsbGJhY2sgQ29uZmlnJywge1xuICAgICAgcXVlcnlMYW5ndWFnZTogc3RlcGZ1bmN0aW9ucy5RdWVyeUxhbmd1YWdlLkpTT05BVEEsXG4gICAgICBvdXRwdXRzOiBgeyUgJHtzZWxlY3RQcm92aWRlclBhcmFtcyh0aGlzLCAnJHN0YXRlcy5pbnB1dC5wcm92aWRlclBhcmFtcy5mYWxsYmFjaycpfSAlfWAsXG4gICAgfSk7XG4gICAgY29uc3QgYWxsRmFpbGVkID0gbmV3IHN0ZXBmdW5jdGlvbnMuRmFpbCh0aGlzLCAnQWxsIEF0dGVtcHRzIEZhaWxlZCcsIHtcbiAgICAgIC8vIHJlLXJhaXNlIHRoZSBsYXN0IGVycm9yIHNvIHRoZSBvdXRlciBjYXRjaCBhbmQgcmV0cnkgc2VlIHRoZSBvcmlnaW5hbCBmYWlsdXJlXG4gICAgICAvLyBpdCdzIGEgc3RhdGUgb2YgaXRzIG93biBzbyBhIHJlZCBjbGVhbi11cCBhbHdheXMgbWVhbnMgdGhlIGNsZWFuLXVwIGl0c2VsZiBicm9rZSAoIzk4OSlcbiAgICAgIGNvbW1lbnQ6ICdGYWlsIHRoZSBleGVjdXRpb24gd2l0aCB0aGUgb3JpZ2luYWwgZXJyb3IgdGhhdCBzdG9wcGVkIHRoZSBydW5uZXInLFxuICAgICAgZXJyb3JQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLmVycm9yLkVycm9yJyksXG4gICAgICBjYXVzZVBhdGg6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguc3RyaW5nQXQoJyQuZXJyb3IuQ2F1c2UnKSxcbiAgICB9KTtcblxuICAgIC8vIHdlIGNvdWxkbid0IGRlbGV0ZSB0aGUgcnVubmVyLCBzbyBhbnkgZnVydGhlciBhdHRlbXB0IHdvdWxkIHByb2JhYmx5IGZhaWwgdG8gcmVnaXN0ZXIgdW5kZXIgdGhlIHNhbWUgbmFtZS4gd2Ugc3RvcCB0aGUgd2hvbGUgZXhlY3V0aW9uIGluc3RlYWRcbiAgICAvLyBvZiB3YXN0aW5nIHJlc291cmNlcyBvbiBydW5uZXJzIHRoYXQgd29uJ3QgZXZlbiBiZSBhYmxlIHRvIHJlZ2lzdGVyLiB0aGUgY2xlYW51cCBjYW4gZmFpbCB3aXRoIGFueSBlcnJvciwgc28gdGhpcyBzdGF0ZSBnaXZlcyB0aGVtIGFsbCBvbmUgbmFtZVxuICAgIC8vIHRoYXQgdGhlIG91dGVyIHJldHJ5IGNhbiBza2lwLiB0aGUgb3JpZ2luYWwgZXJyb3IgaXMga2VwdCBpbiB0aGUgY2F1c2UuXG4gICAgLy8gd2Ugc3RvcCB0aGUgZXhlY3V0aW9uLCBidXQgYXQgdGhpcyBwb2ludCBlaXRoZXI6XG4gICAgLy8gICAqIHRoZSBydW5uZXIgaXMgc3RpbGwgcnVubmluZyBhIGpvYjogYSBuZXcgcnVubmVyIHdvdWxkbid0IGhlbHAgYW5kIHdvdWxkIGp1c3QgYmUgZXh0cmEuXG4gICAgLy8gICAqIHBlcm1hbmVudCBmYWlsdXJlIChlLmcuIG1pc3NpbmcgcGVybWlzc2lvbnMpOiB0aGUgdXNlciBoYXMgdG8gZml4IGl0IGFueXdheS4gc3RhcnRpbmcgYSBuZXcgcnVubmVyIHdpbGwgbm90IGhlbHAuXG4gICAgLy8gICAqIEdpdEh1YiBvdXRhZ2UgbG9uZ2VyIHRoYW4gYW4gaG91cjogYS5rLmEuIG1vbmRheSBtb3JuaW5nIGJ1dCBlaXRoZXIgd2F5IGFjY2VwdGFibGUgcG9pbnQgdG8gZ2l2ZSB1cC5cbiAgICAvLyB0aGUgaWRsZSByZWFwZXIga2VlcHMgd2F0Y2hpbmcgcnVubmVycyBvZiBmYWlsZWQgZXhlY3V0aW9ucywgc28gd2hhdGV2ZXIgaXMgbGVmdCBiZWhpbmQgc3RpbGwgZ2V0cyBjbGVhbmVkIHVwLlxuICAgIGNvbnN0IHJ1bm5lck5vdERlbGV0ZWQgPSBuZXcgc3RlcGZ1bmN0aW9ucy5GYWlsKHRoaXMsICdSdW5uZXIgTm90IERlbGV0ZWQnLCB7XG4gICAgICBjb21tZW50OiAnR2l2ZSB1cCBvbiB0aGlzIHJ1bm5lciB3aXRob3V0IHJldHJ5aW5nIGFzIGl0IHdvdWxkIGZhaWwgdG8gcmVnaXN0ZXIgdW5kZXIgdGhlIHNhbWUgbmFtZScsXG4gICAgICBlcnJvcjogJ1J1bm5lck5vdERlbGV0ZWQnLFxuICAgICAgY2F1c2VQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLmRlbGV0ZS5DYXVzZScpLFxuICAgIH0pO1xuXG4gICAgdHJ5UHJvdmlkZXIuYWRkQ2F0Y2goZmFsbGJhY2tDbGVhbnVwLCB7IGVycm9yczogW3N0ZXBmdW5jdGlvbnMuRXJyb3JzLkFMTF0sIHJlc3VsdFBhdGg6ICckLmVycm9yJyB9KTtcbiAgICBmYWxsYmFja0NsZWFudXAubmV4dChmYWxsYmFja0Nob2ljZSk7XG4gICAgZmFsbGJhY2tDbGVhbnVwLmFkZENhdGNoKHJ1bm5lck5vdERlbGV0ZWQsIHsgZXJyb3JzOiBbc3RlcGZ1bmN0aW9ucy5FcnJvcnMuQUxMXSwgcmVzdWx0UGF0aDogJyQuZGVsZXRlJyB9KTtcbiAgICBmYWxsYmFja0Nob2ljZS53aGVuKHN0ZXBmdW5jdGlvbnMuQ29uZGl0aW9uLmlzUHJlc2VudCgnJC5wcm92aWRlclBhcmFtcy5mYWxsYmFjaycpLCB1c2VGYWxsYmFjayk7XG4gICAgZmFsbGJhY2tDaG9pY2Uub3RoZXJ3aXNlKGFsbEZhaWxlZCk7XG4gICAgLy8gZmFsbGJhY2sgY2FuIGhhdmUgYSBkaWZmZXJlbnQgZ3JvdXAsIE9TLCBvciBhcmNoaXRlY3R1cmUgc28gZWFjaCBmYWxsYmFjayBnZXRzIGEgSklUIGNvbmZpZyBvZiBpdHMgb3duXG4gICAgdXNlRmFsbGJhY2submV4dCh0b2tlblJldHJpZXZlclRhc2spO1xuXG4gICAgLy8gb25lIHBhcmFsbGVsIGlzIGVub3VnaCBub3c6IHRoZSBmYWxsYmFjayBsb29wIGFib3ZlIGFscmVhZHkgY2xlYW5lZCB1cCB0aGUgcnVubmVyIGJlZm9yZSBpdCBnYXZlIHVwXG4gICAgLy8gd2UgdXNlZCB0byBuZWVkIHR3byBuZXN0ZWQgb25lcyBqdXN0IHRvIGNsZWFuIHVwIGJlZm9yZSB0aGUgcmV0cnksIGJlY2F1c2UgUmV0cnkgcnVucyBiZWZvcmUgQ2F0Y2hcbiAgICBjb25zdCBydW5Qcm92aWRlcnMgPSBuZXcgc3RlcGZ1bmN0aW9ucy5QYXJhbGxlbCh0aGlzLCAnUnVuIFByb3ZpZGVycycpLmJyYW5jaChcbiAgICAgIC8vIHdlIGdldCBhIEpJVCBjb25maWcgZm9yIGV2ZXJ5IHJldHJ5IGFuZCBldmVyeSBmYWxsYmFjaywgYmVjYXVzZSB0aGUgY2xlYW4tdXAgYmVmb3JlIHRoZW0gZGVsZXRlcyB0aGUgcnVubmVyIGl0IHJlZ2lzdGVyZWRcbiAgICAgIHNlbGVjdENvbmZpZy5uZXh0KHRva2VuUmV0cmlldmVyVGFzaykubmV4dCh0cnlQcm92aWRlciksXG4gICAgKTtcblxuICAgIGlmIChwcm9wcz8ucmV0cnlPcHRpb25zPy5yZXRyeSA/PyB0cnVlKSB7XG4gICAgICAvLyB3ZSBhaW0gdG8gd2FpdCBhdCBtb3N0IDI0IGhvdXJzIGJlY2F1c2UgdGhhdCdzIHdoZW4gZ2l0aHViIGpvYnMgdGltZSBvdXRcbiAgICAgIGNvbnN0IGludGVydmFsID0gcHJvcHM/LnJldHJ5T3B0aW9ucz8uaW50ZXJ2YWwgPz8gY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMSk7XG4gICAgICAvLyBhIHNob3J0ZXIgbWF4RGVsYXkgbmVlZHMgbW9yZSBhdHRlbXB0cyB0byBjb3ZlciB0aGUgc2FtZSAyNCBob3VycywgYW5kIGV2ZXJ5IGF0dGVtcHQgY29zdHMgZXhlY3V0aW9uIGhpc3RvcnlcbiAgICAgIC8vIGV2ZW50cyB0aGF0IFN0ZXAgRnVuY3Rpb25zIGNhcHMgYXQgMjUsMDAwLiBtZWFzdXJlZCBvbiB0aGlzIHN0YXRlIG1hY2hpbmUsIGEgZmFpbGVkIGF0dGVtcHQgY29zdHMgMjUgZXZlbnRzXG4gICAgICAvLyBmb3IgYSBwcm92aWRlciB3aXRoIG5vIGZhbGxiYWNrIGFuZCA3MyBmb3IgYSBmb3VyIGNvbmZpZyBmYWxsYmFjayBjaGFpbiwgc28gMjEwIGF0dGVtcHRzIGxhbmQgYXJvdW5kIDE1LDAwMFxuICAgICAgLy8gd2hpbGUgYSA1IG1pbnV0ZSBjYXAgd291bGQgbmVlZCB+NjAwIGF0dGVtcHRzIGFuZCBnbyByaWdodCBwYXN0IGl0XG4gICAgICAvL1xuICAgICAgLy8gdGhvc2UgYXJlIG5vcm1hbCBwYXRoIG51bWJlcnMgYW5kIG5vdCBhIGNlaWxpbmcuIGEgbG9uZ2VyIGZhbGxiYWNrIGNoYWluIGNvc3RzIG1vcmUuIGFuIGF0dGVtcHQgd2hvc2UgY2xlYW4tdXBcbiAgICAgIC8vIGtlZXBzIGZhaWxpbmcgY29zdHMgNzkzLCBidXQgdGhhdCBlbmRzIHRoZSBleGVjdXRpb24gc28gaXQgb25seSBoYXBwZW5zIG9uY2VcbiAgICAgIC8vXG4gICAgICAvLyBpZiB0aGUgZXhlY3V0aW9uIGhpc3RvcnkgbGltaXQgZG9lcyBoaXQsIHdlIHdpbGwgZW5kIGdpdmUgdXAgb24gdGhpcyBydW5uZXIuIHRoaXMgd291bGQgb25seSBoYXBwZW4gd2hlbiB3ZVxuICAgICAgLy8gYXJlIGhhdmluZyBsb3RzIG9mIGlzc3VlcyBwcm92aXNpb25pbmcgYSBydW5uZXJzLiBzdG9sZW4gcnVubmVyIGRldGVjdG9yIG1heSBlbmQgdXAgcmVwbGFjaW5nIGl0IHdoZW4gdGhlXG4gICAgICAvLyBlcnJvcnMgZmluYWxseSBzdG9wLlxuICAgICAgY29uc3QgbWF4RGVsYXkgPSBwcm9wcz8ucmV0cnlPcHRpb25zPy5tYXhEZWxheSA/PyBjZGsuRHVyYXRpb24ubWludXRlcygxNSk7XG4gICAgICBjb25zdCBtYXhBdHRlbXB0cyA9IHByb3BzPy5yZXRyeU9wdGlvbnM/Lm1heEF0dGVtcHRzID8/IDIxMDtcbiAgICAgIGNvbnN0IGJhY2tvZmZSYXRlID0gcHJvcHM/LnJldHJ5T3B0aW9ucz8uYmFja29mZlJhdGUgPz8gMjtcblxuICAgICAgLy8gaml0dGVyIHBpY2tzIGEgcmFuZG9tIHdhaXQgYmV0d2VlbiB6ZXJvIGFuZCB0aGUgaW50ZXJ2YWwsIHNvIHdlIHdhaXQgaGFsZiBvZiBpdCBvbiBhdmVyYWdlXG4gICAgICAvLyB3ZSBhaW0gYSBiaXQgb3ZlciAyNCBob3VycyBzbyBtb3N0IGpvYnMga2VlcCByZXRyeWluZyBmb3IgdGhlIHdob2xlIGRheSB0aGV5IGNhbiB3YWl0XG4gICAgICAvLyBpZiB3ZSBkbyBzdG9wIGVhcmx5LCB0aGUgam9iIHdpbGwgc3RlYWwgYW5vdGhlciBydW5uZXIgYW5kIHRoZSBzdG9sZW4gcnVubmVyIGRldGVjdG9yIHdpbGwgcmVwbGFjZSBpdFxuICAgICAgLy9cbiAgICAgIC8vIHRoZSB3YWl0IGdyb3dzIGdlb21ldHJpY2FsbHkgdW50aWwgaXQgaGl0cyBtYXhEZWxheSBhbmQgc3RheXMgdGhlcmUsIHNvIHRoZSB0b3RhbCBpcyBhIGdlb21ldHJpY1xuICAgICAgLy8gc2VyaWVzIHBsdXMgYSBmbGF0IHRhaWwuIG1heEF0dGVtcHRzIGlzIGEgcHVibGljIG9wdGlvbiwgc28gd2UgZG9uJ3Qgd2FudCB0byBsb29wIG92ZXIgaXRcbiAgICAgIGNvbnN0IGdyb3dpbmdBdHRlbXB0cyA9IGJhY2tvZmZSYXRlID4gMVxuICAgICAgICA/IE1hdGgubWluKG1heEF0dGVtcHRzLCBNYXRoLm1heCgwLCBNYXRoLmNlaWwoTWF0aC5sb2cobWF4RGVsYXkudG9TZWNvbmRzKCkgLyBpbnRlcnZhbC50b1NlY29uZHMoKSkgLyBNYXRoLmxvZyhiYWNrb2ZmUmF0ZSkpKSlcbiAgICAgICAgOiAoaW50ZXJ2YWwudG9TZWNvbmRzKCkgPCBtYXhEZWxheS50b1NlY29uZHMoKSA/IG1heEF0dGVtcHRzIDogMCk7XG4gICAgICBjb25zdCBncm93aW5nU2Vjb25kcyA9IGJhY2tvZmZSYXRlID09PSAxXG4gICAgICAgID8gaW50ZXJ2YWwudG9TZWNvbmRzKCkgKiBncm93aW5nQXR0ZW1wdHNcbiAgICAgICAgOiBpbnRlcnZhbC50b1NlY29uZHMoKSAqIChiYWNrb2ZmUmF0ZSAqKiBncm93aW5nQXR0ZW1wdHMgLSAxKSAvIChiYWNrb2ZmUmF0ZSAtIDEpO1xuICAgICAgY29uc3QgdG90YWxTZWNvbmRzID0gKGdyb3dpbmdTZWNvbmRzICsgKG1heEF0dGVtcHRzIC0gZ3Jvd2luZ0F0dGVtcHRzKSAqIG1heERlbGF5LnRvU2Vjb25kcygpKSAvIDI7XG5cbiAgICAgIC8vIHRoZSBkZWZhdWx0IG92ZXJzaG9vdHMgMjQgaG91cnMgb24gcHVycG9zZSwgc28gb25seSBjb21wbGFpbiB3aGVuIGl0J3MgY2xlYXJseSBtb3JlIHRoYW4gYSBqb2IgY2FuIHVzZVxuICAgICAgaWYgKHRvdGFsU2Vjb25kcyA+PSBjZGsuRHVyYXRpb24uaG91cnMoMzApLnRvU2Vjb25kcygpKSB7XG4gICAgICAgIC8vIGh0dHBzOi8vZG9jcy5naXRodWIuY29tL2VuL2FjdGlvbnMvaG9zdGluZy15b3VyLW93bi1ydW5uZXJzL21hbmFnaW5nLXNlbGYtaG9zdGVkLXJ1bm5lcnMvYWJvdXQtc2VsZi1ob3N0ZWQtcnVubmVycyN1c2FnZS1saW1pdHNcbiAgICAgICAgLy8gXCJKb2IgcXVldWUgdGltZSAtIEVhY2ggam9iIGZvciBzZWxmLWhvc3RlZCBydW5uZXJzIGNhbiBiZSBxdWV1ZWQgZm9yIGEgbWF4aW11bSBvZiAyNCBob3Vycy4gSWYgYSBzZWxmLWhvc3RlZCBydW5uZXIgZG9lcyBub3Qgc3RhcnRcbiAgICAgICAgLy8gZXhlY3V0aW5nIHRoZSBqb2Igd2l0aGluIHRoaXMgbGltaXQsIHRoZSBqb2IgaXMgdGVybWluYXRlZCBhbmQgZmFpbHMgdG8gY29tcGxldGUuXCJcbiAgICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZyhgQXZlcmFnZSB0b3RhbCByZXRyeSB0aW1lIGlzICR7TWF0aC5mbG9vcih0b3RhbFNlY29uZHMgLyA2MCAvIDYwKX0gaG91cnMuIEpvYnMgZXhwaXJlIGFmdGVyIDI0YFxuICAgICAgICAgICsgJyBob3VycyBzbyBpdCB3b3VsZCBiZSBhIHdhc3RlIG9mIHJlc291cmNlcyB0byByZXRyeSBmdXJ0aGVyLicpO1xuICAgICAgfVxuXG4gICAgICAvLyBzZWUgYHJ1bm5lck5vdERlbGV0ZWRgIGFib3ZlXG4gICAgICBydW5Qcm92aWRlcnMuYWRkUmV0cnkoe1xuICAgICAgICBlcnJvcnM6IFsnUnVubmVyTm90RGVsZXRlZCddLFxuICAgICAgICBtYXhBdHRlbXB0czogMCxcbiAgICAgIH0pO1xuICAgICAgcnVuUHJvdmlkZXJzLmFkZFJldHJ5KHtcbiAgICAgICAgaW50ZXJ2YWwsXG4gICAgICAgIG1heERlbGF5LFxuICAgICAgICBtYXhBdHRlbXB0cyxcbiAgICAgICAgYmFja29mZlJhdGUsXG4gICAgICAgIC8vIHdpdGhvdXQgaml0dGVyIGV2ZXJ5IHJ1bm5lciB0aGF0IGZhaWxlZCBvbiB0aGUgc2FtZSBtaXNzaW5nIGNhcGFjaXR5IG9yIEFQSSBxdW90YSBjb21lcyBiYWNrIGF0IHRoZSBleGFjdCBzYW1lIHRpbWVcbiAgICAgICAgaml0dGVyU3RyYXRlZ3k6IHN0ZXBmdW5jdGlvbnMuSml0dGVyVHlwZS5GVUxMLFxuICAgICAgICAvLyB3ZSByZXRyeSBvbiBldmVyeXRoaW5nXG4gICAgICAgIC8vIGRlbGV0ZWQgaWRsZSBydW5uZXJzIHdpbGwgYWxzbyBmYWlsLCBidXQgdGhlIHJlYXBlciB3aWxsIHN0b3AgdGhpcyBzdGVwIGZ1bmN0aW9uIHRvIGF2b2lkIGVuZGxlc3MgcmV0cmllc1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgbGV0IGxvZ09wdGlvbnM6IGNkay5hd3Nfc3RlcGZ1bmN0aW9ucy5Mb2dPcHRpb25zIHwgdW5kZWZpbmVkO1xuICAgIGlmICh0aGlzLnByb3BzPy5sb2dPcHRpb25zKSB7XG4gICAgICB0aGlzLnN0YXRlTWFjaGluZUxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0xvZ3MnLCB7XG4gICAgICAgIGxvZ0dyb3VwTmFtZTogcHJvcHM/LmxvZ09wdGlvbnM/LmxvZ0dyb3VwTmFtZSxcbiAgICAgICAgcmV0ZW50aW9uOiBwcm9wcz8ubG9nT3B0aW9ucz8ubG9nUmV0ZW50aW9uID8/IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB9KTtcblxuICAgICAgbG9nT3B0aW9ucyA9IHtcbiAgICAgICAgZGVzdGluYXRpb246IHRoaXMuc3RhdGVNYWNoaW5lTG9nR3JvdXAsXG4gICAgICAgIGluY2x1ZGVFeGVjdXRpb25EYXRhOiBwcm9wcz8ubG9nT3B0aW9ucz8uaW5jbHVkZUV4ZWN1dGlvbkRhdGEgPz8gdHJ1ZSxcbiAgICAgICAgbGV2ZWw6IHByb3BzPy5sb2dPcHRpb25zPy5sZXZlbCA/PyBzdGVwZnVuY3Rpb25zLkxvZ0xldmVsLkFMTCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdGVNYWNoaW5lID0gbmV3IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lKFxuICAgICAgdGhpcyxcbiAgICAgICdSdW5uZXIgT3JjaGVzdHJhdG9yJyxcbiAgICAgIHtcbiAgICAgICAgZGVmaW5pdGlvbkJvZHk6IHN0ZXBmdW5jdGlvbnMuRGVmaW5pdGlvbkJvZHkuZnJvbUNoYWluYWJsZShxdWV1ZUlkbGVSZWFwZXJUYXNrLm5leHQoY29uZmlnUGFzcykubmV4dChydW5Qcm92aWRlcnMpKSxcbiAgICAgICAgZGVmaW5pdGlvblN1YnN0aXR1dGlvbnM6IGRlZHVwZVN0YXRlTWFjaGluZVRva2Vucyh0aGlzLCB7IHByb3ZpZGVyQ29uZmlncywgcHJvdmlkZXJDb25zdHMgfSksXG4gICAgICAgIGxvZ3M6IGxvZ09wdGlvbnMsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICBzdGF0ZU1hY2hpbmUuZ3JhbnRSZWFkKHRoaXMuaWRsZVJlYXBlckZ1bmN0aW9uKTtcbiAgICBzdGF0ZU1hY2hpbmUuZ3JhbnRFeGVjdXRpb24odGhpcy5pZGxlUmVhcGVyRnVuY3Rpb24sICdzdGF0ZXM6U3RvcEV4ZWN1dGlvbicpO1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgdGhpcy5wYXJhbWV0ZXJpemVkUHJvdmlkZXJzKSB7XG4gICAgICBwcm92aWRlci5fZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc3RhdGVNYWNoaW5lO1xuICB9XG5cbiAgcHJpdmF0ZSB0b2tlblJldHJpZXZlcigpIHtcbiAgICBjb25zdCBmdW5jID0gbmV3IFRva2VuUmV0cmlldmVyRnVuY3Rpb24oXG4gICAgICB0aGlzLFxuICAgICAgJ3Rva2VuLXJldHJpZXZlcicsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnR2V0IGp1c3QtaW4tdGltZSBjb25maWcgZnJvbSBHaXRIdWIgQWN0aW9ucyB1c2VkIHRvIHN0YXJ0IG5ldyBzZWxmLWhvc3RlZCBydW5uZXInLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIEdJVEhVQl9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViLnNlY3JldEFybixcbiAgICAgICAgICBHSVRIVUJfUFJJVkFURV9LRVlfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQoZnVuYyk7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuZ3JhbnRSZWFkKGZ1bmMpO1xuXG4gICAgdGhpcy5tYW5hZ2VtZW50RnVuY3Rpb25zLnB1c2goZnVuYyk7XG5cbiAgICByZXR1cm4gZnVuYztcbiAgfVxuXG4gIC8qKlxuICAgKiBMZXQgYSBjbGVhbnVwIGZ1bmN0aW9uIHRlcm1pbmF0ZSBFQzIgaW5zdGFuY2VzIHRoYXQgb3V0bGl2ZWQgdGhlaXIgam9iLlxuICAgKi9cbiAgcHJpdmF0ZSBncmFudFJ1bm5lckluc3RhbmNlQ2xlYW51cChmdW5jOiBsYW1iZGEuRnVuY3Rpb24pIHtcbiAgICBmdW5jLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2VjMjpEZXNjcmliZUluc3RhbmNlcyddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICBmdW5jLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2VjMjpUZXJtaW5hdGVJbnN0YW5jZXMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIC8vIHRoaXMgaXMgYSBydW5uZXIgZnJvbSBvdXIgc3RhY2tcbiAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgW2BlYzI6UmVzb3VyY2VUYWcvJHtSZXNlcnZlZFRhZ3MuU1RBQ0t9YF06IGNkay5TdGFjay5vZih0aGlzKS5zdGFja05hbWUsXG4gICAgICAgIH0sXG4gICAgICAgIC8vIFwidGhlIHRhZyBleGlzdHNcIiwgd2hhdGV2ZXIgcnVubmVyIG5hbWUgaXMgaW4gaXRcbiAgICAgICAgTnVsbDoge1xuICAgICAgICAgIFtgZWMyOlJlc291cmNlVGFnLyR7UmVzZXJ2ZWRUYWdzLlJVTk5FUn1gXTogJ2ZhbHNlJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgZnVuYy5hZGRFbnZpcm9ubWVudCgnU1RBQ0tfTkFNRScsIGNkay5TdGFjay5vZih0aGlzKS5zdGFja05hbWUpO1xuICB9XG5cbiAgcHJpdmF0ZSBkZWxldGVGYWlsZWRSdW5uZXIoKSB7XG4gICAgY29uc3QgZnVuYyA9IG5ldyBEZWxldGVGYWlsZWRSdW5uZXJGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnZGVsZXRlLXJ1bm5lcicsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnRGVsZXRlIGZhaWxlZCBHaXRIdWIgQWN0aW9ucyBydW5uZXIgb24gZXJyb3InLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIEdJVEhVQl9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViLnNlY3JldEFybixcbiAgICAgICAgICBHSVRIVUJfUFJJVkFURV9LRVlfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQoZnVuYyk7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuZ3JhbnRSZWFkKGZ1bmMpO1xuICAgIHRoaXMuZ3JhbnRSdW5uZXJJbnN0YW5jZUNsZWFudXAoZnVuYyk7XG5cbiAgICB0aGlzLm1hbmFnZW1lbnRGdW5jdGlvbnMucHVzaChmdW5jKTtcblxuICAgIHJldHVybiBmdW5jO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0dXNGdW5jdGlvbigpIHtcbiAgICBjb25zdCBzdGF0dXNGdW5jdGlvbiA9IG5ldyBTdGF0dXNGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnc3RhdHVzJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdQcm92aWRlIHVzZXIgd2l0aCBzdGF0dXMgYWJvdXQgc2VsZi1ob3N0ZWQgR2l0SHViIEFjdGlvbnMgcnVubmVycycsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgV0VCSE9PS19TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMud2ViaG9vay5zZWNyZXRBcm4sXG4gICAgICAgICAgR0lUSFVCX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5zZWNyZXRBcm4sXG4gICAgICAgICAgU0VUVVBfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLnNldHVwLnNlY3JldEFybixcbiAgICAgICAgICBXRUJIT09LX1VSTDogdGhpcy53ZWJob29rLnVybCxcbiAgICAgICAgICBXRUJIT09LX0hBTkRMRVJfQVJOOiB0aGlzLndlYmhvb2suaGFuZGxlci5sYXRlc3RWZXJzaW9uLmZ1bmN0aW9uQXJuLFxuICAgICAgICAgIFNURVBfRlVOQ1RJT05fQVJOOiB0aGlzLm9yY2hlc3RyYXRvci5zdGF0ZU1hY2hpbmVBcm4sXG4gICAgICAgICAgU1RFUF9GVU5DVElPTl9MT0dfR1JPVVA6IHRoaXMuc3RhdGVNYWNoaW5lTG9nR3JvdXA/LmxvZ0dyb3VwTmFtZSA/PyAnJyxcbiAgICAgICAgICBTRVRVUF9GVU5DVElPTl9VUkw6IHRoaXMuc2V0dXBVcmwsXG4gICAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYUVudixcbiAgICAgICAgfSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMyksXG4gICAgICAgIGxvZ0dyb3VwOiBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlNFVFVQKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gY29tcG9zaXRlIHByb3ZpZGVycyByZXR1cm4gYW4gYXJyYXkgb2Ygc3RhdHVzZXMsIHJlZ3VsYXIgcHJvdmlkZXJzIHJldHVybiBhIHNpbmdsZSBzdGF0dXNcbiAgICBjb25zdCBwcm92aWRlcnMgPSB0aGlzLnBhcmFtZXRlcml6ZWRQcm92aWRlcnMuZmxhdE1hcChwcm92aWRlciA9PiBwcm92aWRlci5fc3RhdHVzKHN0YXR1c0Z1bmN0aW9uKSk7XG5cbiAgICAvLyBleHBvc2UgcHJvdmlkZXJzIGFzIHN0YWNrIG1ldGFkYXRhIGFzIGl0J3MgdG9vIGJpZyBmb3IgTGFtYmRhIGVudmlyb25tZW50IHZhcmlhYmxlc1xuICAgIC8vIHNwZWNpZmljYWxseSBpbnRlZ3JhdGlvbiB0ZXN0aW5nIGdvdCBhbiBlcnJvciBiZWNhdXNlIGxhbWJkYSB1cGRhdGUgcmVxdWVzdCB3YXMgPjVrYlxuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHRoaXMpO1xuICAgIGNvbnN0IGYgPSAoc3RhdHVzRnVuY3Rpb24ubm9kZS5kZWZhdWx0Q2hpbGQgYXMgbGFtYmRhLkNmbkZ1bmN0aW9uKTtcbiAgICBmLmFkZFByb3BlcnR5T3ZlcnJpZGUoJ0Vudmlyb25tZW50LlZhcmlhYmxlcy5MT0dJQ0FMX0lEJywgZi5sb2dpY2FsSWQpO1xuICAgIGYuYWRkUHJvcGVydHlPdmVycmlkZSgnRW52aXJvbm1lbnQuVmFyaWFibGVzLlNUQUNLX05BTUUnLCBzdGFjay5zdGFja05hbWUpO1xuICAgIGYuYWRkTWV0YWRhdGEoJ3Byb3ZpZGVycycsIHByb3ZpZGVycyk7XG4gICAgc3RhdHVzRnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnY2xvdWRmb3JtYXRpb246RGVzY3JpYmVTdGFja1Jlc291cmNlJ10sXG4gICAgICByZXNvdXJjZXM6IFtzdGFjay5zdGFja0lkXSxcbiAgICB9KSk7XG5cbiAgICB0aGlzLnNlY3JldHMud2ViaG9vay5ncmFudFJlYWQoc3RhdHVzRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5naXRodWIuZ3JhbnRSZWFkKHN0YXR1c0Z1bmN0aW9uKTtcbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFJlYWQoc3RhdHVzRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5zZXR1cC5ncmFudFJlYWQoc3RhdHVzRnVuY3Rpb24pO1xuICAgIHRoaXMub3JjaGVzdHJhdG9yLmdyYW50UmVhZChzdGF0dXNGdW5jdGlvbik7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dChcbiAgICAgIHRoaXMsXG4gICAgICAnc3RhdHVzIGNvbW1hbmQnLFxuICAgICAge1xuICAgICAgICB2YWx1ZTogYGF3cyAtLXJlZ2lvbiAke3N0YWNrLnJlZ2lvbn0gbGFtYmRhIGludm9rZSAtLWZ1bmN0aW9uLW5hbWUgJHtzdGF0dXNGdW5jdGlvbi5mdW5jdGlvbk5hbWV9IHN0YXR1cy5qc29uYCxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMubWFuYWdlbWVudEZ1bmN0aW9ucy5wdXNoKHN0YXR1c0Z1bmN0aW9uKTtcblxuICAgIGNvbnN0IGFjY2VzcyA9IHRoaXMucHJvcHM/LnN0YXR1c0FjY2VzcyA/PyBMYW1iZGFBY2Nlc3Mubm9BY2Nlc3MoKTtcbiAgICBjb25zdCB1cmwgPSBhY2Nlc3MuYmluZCh0aGlzLCAnc3RhdHVzIGFjY2VzcycsIHN0YXR1c0Z1bmN0aW9uKTtcblxuICAgIGlmICh1cmwgIT09ICcnKSB7XG4gICAgICBuZXcgY2RrLkNmbk91dHB1dChcbiAgICAgICAgdGhpcyxcbiAgICAgICAgJ3N0YXR1cyB1cmwnLFxuICAgICAgICB7XG4gICAgICAgICAgdmFsdWU6IHVybCxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cEZ1bmN0aW9uKCk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2V0dXBGdW5jdGlvbiA9IG5ldyBTZXR1cEZ1bmN0aW9uKFxuICAgICAgdGhpcyxcbiAgICAgICdzZXR1cCcsXG4gICAgICB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnU2V0dXAgR2l0SHViIEFjdGlvbnMgaW50ZWdyYXRpb24gd2l0aCBzZWxmLWhvc3RlZCBydW5uZXJzJyxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBTRVRVUF9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuc2V0dXAuc2VjcmV0QXJuLFxuICAgICAgICAgIFdFQkhPT0tfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLndlYmhvb2suc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViLnNlY3JldEFybixcbiAgICAgICAgICBHSVRIVUJfUFJJVkFURV9LRVlfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICAgIFdFQkhPT0tfVVJMOiB0aGlzLndlYmhvb2sudXJsLFxuICAgICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMpLFxuICAgICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5TRVRVUCksXG4gICAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFQcm9wcyxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIC8vIHRoaXMuc2VjcmV0cy53ZWJob29rLmdyYW50UmVhZChzZXR1cEZ1bmN0aW9uKTtcbiAgICB0aGlzLnNlY3JldHMud2ViaG9vay5ncmFudFdyaXRlKHNldHVwRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5naXRodWIuZ3JhbnRSZWFkKHNldHVwRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5naXRodWIuZ3JhbnRXcml0ZShzZXR1cEZ1bmN0aW9uKTtcbiAgICAvLyB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFJlYWQoc2V0dXBGdW5jdGlvbik7XG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuZ3JhbnRXcml0ZShzZXR1cEZ1bmN0aW9uKTtcbiAgICB0aGlzLnNlY3JldHMuc2V0dXAuZ3JhbnRSZWFkKHNldHVwRnVuY3Rpb24pO1xuICAgIHRoaXMuc2VjcmV0cy5zZXR1cC5ncmFudFdyaXRlKHNldHVwRnVuY3Rpb24pO1xuXG4gICAgdGhpcy5tYW5hZ2VtZW50RnVuY3Rpb25zLnB1c2goc2V0dXBGdW5jdGlvbik7XG5cbiAgICBjb25zdCBhY2Nlc3MgPSB0aGlzLnByb3BzPy5zZXR1cEFjY2VzcyA/PyBMYW1iZGFBY2Nlc3MubGFtYmRhVXJsKCk7XG4gICAgcmV0dXJuIGFjY2Vzcy5iaW5kKHRoaXMsICdzZXR1cCBhY2Nlc3MnLCBzZXR1cEZ1bmN0aW9uKTtcbiAgfVxuXG4gIHByaXZhdGUgY2hlY2tJbnRlcnNlY3RpbmdMYWJlbHMoKSB7XG4gICAgLy8gdGhpcyBcImFsZ29yaXRobVwiIGlzIHZlcnkgaW5lZmZpY2llbnQsIGJ1dCBnb29kIGVub3VnaCBmb3IgdGhlIHRpbnkgZGF0YXNldHMgd2UgZXhwZWN0XG4gICAgZm9yIChjb25zdCBwMSBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgZm9yIChjb25zdCBwMiBvZiB0aGlzLnByb3ZpZGVycykge1xuICAgICAgICBpZiAocDEgPT0gcDIpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBHaXRIdWIgbGFiZWxzIGFyZSBjYXNlLWluc2Vuc2l0aXZlXG4gICAgICAgIGNvbnN0IHAxTGFiZWxzID0gcDEubGFiZWxzLm1hcChsID0+IGwudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIGNvbnN0IHAyTGFiZWxzID0gcDIubGFiZWxzLm1hcChsID0+IGwudG9Mb3dlckNhc2UoKSk7XG4gICAgICAgIGlmIChwMUxhYmVscy5ldmVyeShsID0+IHAyTGFiZWxzLmluY2x1ZGVzKGwpKSkge1xuICAgICAgICAgIGlmIChwMkxhYmVscy5ldmVyeShsID0+IHAxTGFiZWxzLmluY2x1ZGVzKGwpKSkge1xuICAgICAgICAgICAgQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoYEJvdGggJHtwMS5ub2RlLnBhdGh9IGFuZCAke3AyLm5vZGUucGF0aH0gdXNlIHRoZSBzYW1lIGxhYmVscyBbJHtwMS5sYWJlbHMuam9pbignLCAnKX1dYCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIEFubm90YXRpb25zLm9mKHAxKS5hZGRXYXJuaW5nKGBMYWJlbHMgWyR7cDEubGFiZWxzLmpvaW4oJywgJyl9XSBpbnRlcnNlY3Qgd2l0aCBhbm90aGVyIHByb3ZpZGVyICgke3AyLm5vZGUucGF0aH0gLS0gWyR7cDIubGFiZWxzLmpvaW4oJywgJyl9XSkuIElmIGEgd29ya2Zsb3cgc3BlY2lmaWVzIHRoZSBsYWJlbHMgWyR7cDEubGFiZWxzLmpvaW4oJywgJyl9XSwgaXQgaXMgbm90IGd1YXJhbnRlZWQgd2hpY2ggcHJvdmlkZXIgd2lsbCBiZSB1c2VkLiBJdCBpcyByZWNvbW1lbmRlZCB5b3UgZG8gbm90IHVzZSBpbnRlcnNlY3RpbmcgbGFiZWxzYCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlkbGVSZWFwZXIoKSB7XG4gICAgY29uc3QgZnVuYyA9IG5ldyBJZGxlUnVubmVyUmVwZWFyRnVuY3Rpb24odGhpcywgJ0lkbGUgUmVhcGVyJywge1xuICAgICAgZGVzY3JpcHRpb246ICdTdG9wIGlkbGUgR2l0SHViIHJ1bm5lcnMgdG8gYXZvaWQgcGF5aW5nIGZvciBydW5uZXJzIHdoZW4gdGhlIGpvYiB3YXMgYWxyZWFkeSBjYW5jZWxlZCcsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBHSVRIVUJfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1Yi5zZWNyZXRBcm4sXG4gICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5zZWNyZXRBcm4sXG4gICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICB9LFxuICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFQcm9wcyxcbiAgICB9KTtcblxuICAgIHRoaXMubWFuYWdlbWVudEZ1bmN0aW9ucy5wdXNoKGZ1bmMpO1xuXG4gICAgcmV0dXJuIGZ1bmM7XG4gIH1cblxuICBwcml2YXRlIGlkbGVSZWFwZXJRdWV1ZShyZWFwZXI6IGxhbWJkYS5GdW5jdGlvbikge1xuICAgIC8vIHNlZSB0aGlzIGNvbW1lbnQgdG8gdW5kZXJzdGFuZCB3aHkgaXQncyBhIHF1ZXVlIHRoYXQncyBvdXQgb2YgdGhlIHN0ZXAgZnVuY3Rpb25cbiAgICAvLyBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycy9wdWxsLzMxNCNpc3N1ZWNvbW1lbnQtMTUyODkwMTE5MlxuXG4gICAgLy8gdGhlIHJlYXBlciBvbmx5IHN0b3BzIGEgcnVubmVyIGl0IHNhdyBpZGxlIHR3aWNlLCBvbmUgZGVsaXZlcnkgYXBhcnQsIHNvIGEgcnVubmVyIGdldHMgcmVhcGVkIHNvbWV3aGVyZSBiZXR3ZWVuIDUgYW5kIDEwIG1pbnV0ZXMgYWZ0ZXJcbiAgICAvLyBpdCB3ZW50IGlkbGUgd2l0aCB0aGUgZGVmYXVsdCBpZGxlIHRpbWVvdXQuIGEgcnVubmVyIHRoYXQgaXMgc3RpbGwgYm9vdGluZyBpcyBub3Qgb25saW5lIHlldCwgc28gaXQgZG9lc24ndCBjb3VudCBhcyBpZGxlLlxuICAgIGNvbnN0IHF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnSWRsZSBSZWFwZXIgUXVldWUnLCB7XG4gICAgICBkZWxpdmVyeURlbGF5OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICB9KTtcblxuICAgIC8vIHRyaWdnZXIgcmVhcGVyIGZ1bmN0aW9uIGZyb20gcXVldWVcbiAgICByZWFwZXIuYWRkRXZlbnRTb3VyY2UobmV3IGxhbWJkYV9ldmVudF9zb3VyY2VzLlNxc0V2ZW50U291cmNlKHF1ZXVlLCB7XG4gICAgICByZXBvcnRCYXRjaEl0ZW1GYWlsdXJlczogdHJ1ZSxcbiAgICAgIG1heEJhdGNoaW5nV2luZG93OiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICAgIGJhdGNoU2l6ZTogMTAsXG4gICAgfSkpO1xuXG4gICAgLy8gdGhlIHJlYXBlciBzZW5kcyBpdHNlbGYgYSBuZXcgbWVzc2FnZSB3aGVuIGl0IGZpcnN0IHNlZXMgYSBydW5uZXIgaWRsZVxuICAgIHJlYXBlci5hZGRFbnZpcm9ubWVudCgnSURMRV9SRUFQRVJfUVVFVUVfVVJMJywgcXVldWUucXVldWVVcmwpO1xuICAgIHF1ZXVlLmdyYW50U2VuZE1lc3NhZ2VzKHJlYXBlcik7XG5cbiAgICAvLyBhY2Nlc3MgdG8gcmVxdWlyZWQgZ2l0aHViIHNlY3JldHMgYW5kIHJ1bm5lciBjbGVhbnVwXG4gICAgdGhpcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQocmVhcGVyKTtcbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFJlYWQocmVhcGVyKTtcbiAgICB0aGlzLmdyYW50UnVubmVySW5zdGFuY2VDbGVhbnVwKHJlYXBlcik7XG5cbiAgICByZXR1cm4gcXVldWU7XG4gIH1cblxuICBwcml2YXRlIGxhbWJkYVNlY3VyaXR5R3JvdXBzKCkge1xuICAgIGlmICghdGhpcy5wcm9wcz8udnBjKSB7XG4gICAgICBpZiAodGhpcy5wcm9wcz8uc2VjdXJpdHlHcm91cCkge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnc2VjdXJpdHlHcm91cCBpcyBzcGVjaWZpZWQsIGJ1dCB2cGMgaXMgbm90LiBzZWN1cml0eUdyb3VwIHdpbGwgYmUgaWdub3JlZCcpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucHJvcHM/LnNlY3VyaXR5R3JvdXBzKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdzZWN1cml0eUdyb3VwcyBpcyBzcGVjaWZpZWQsIGJ1dCB2cGMgaXMgbm90LiBzZWN1cml0eUdyb3VwcyB3aWxsIGJlIGlnbm9yZWQnKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5wcm9wcy5zZWN1cml0eUdyb3Vwcykge1xuICAgICAgaWYgKHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cCkge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnQm90aCBzZWN1cml0eUdyb3VwIGFuZCBzZWN1cml0eUdyb3VwcyBhcmUgc3BlY2lmaWVkLiBzZWN1cml0eUdyb3VwIHdpbGwgYmUgaWdub3JlZCcpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cHM7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucHJvcHMuc2VjdXJpdHlHcm91cCkge1xuICAgICAgcmV0dXJuIFt0aGlzLnByb3BzLnNlY3VyaXR5R3JvdXBdO1xuICAgIH1cblxuICAgIHJldHVybiBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdNYW5hZ2VtZW50IExhbWJkYXMgU2VjdXJpdHkgR3JvdXAnLCB7IHZwYzogdGhpcy5wcm9wcy52cGMgfSldO1xuICB9XG5cbiAgLyoqXG4gICAqIEV4dHJhY3RzIGFsbCB1bmlxdWUgSVJ1bm5lclByb3ZpZGVyIGluc3RhbmNlcyBmcm9tIHByb3ZpZGVycyBhbmQgY29tcG9zaXRlIHByb3ZpZGVycyAob25lIGxldmVsIG9ubHkpLlxuICAgKiBVc2VzIGEgU2V0IHRvIGVuc3VyZSB3ZSBkb24ndCBwcm9jZXNzIHRoZSBzYW1lIHByb3ZpZGVyIHR3aWNlLCBldmVuIGlmIGl0J3MgdXNlZCBpbiBtdWx0aXBsZSBjb21wb3NpdGVzLlxuICAgKlxuICAgKiBAcmV0dXJucyBTZXQgb2YgdW5pcXVlIElSdW5uZXJQcm92aWRlciBpbnN0YW5jZXNcbiAgICovXG4gIHByaXZhdGUgZXh0cmFjdFVuaXF1ZVN1YlByb3ZpZGVycygpOiBTZXQ8SVJ1bm5lclByb3ZpZGVyPiB7XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8SVJ1bm5lclByb3ZpZGVyPigpO1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgIC8vIGluc3RhbmNlb2YgZG9lc24ndCByZWFsbHkgd29yayBpbiBDREsgc28gdXNlIHRoaXMgaGFjayBpbnN0ZWFkXG4gICAgICBpZiAoJ2xvZ0dyb3VwJyBpbiBwcm92aWRlcikge1xuICAgICAgICAvLyBSZWd1bGFyIHByb3ZpZGVyXG4gICAgICAgIHNlZW4uYWRkKHByb3ZpZGVyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENvbXBvc2l0ZSBwcm92aWRlciAtIGFjY2VzcyB0aGUgcHJvdmlkZXJzIGZpZWxkXG4gICAgICAgIGZvciAoY29uc3Qgc3ViUHJvdmlkZXIgb2YgcHJvdmlkZXIucHJvdmlkZXJzKSB7XG4gICAgICAgICAgc2Vlbi5hZGQoc3ViUHJvdmlkZXIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzZWVuO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBMYW1iZGEgbGF5ZXIgd2l0aCBjZXJ0aWZpY2F0ZXMgaWYgZXh0cmFDZXJ0aWZpY2F0ZXMgaXMgc3BlY2lmaWVkLlxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVDZXJ0aWZpY2F0ZUxheWVyKHNjb3BlOiBDb25zdHJ1Y3QpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMucHJvcHM/LmV4dHJhQ2VydGlmaWNhdGVzKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY2VydGlmaWNhdGVGaWxlcyA9IGRpc2NvdmVyQ2VydGlmaWNhdGVGaWxlcyh0aGlzLnByb3BzLmV4dHJhQ2VydGlmaWNhdGVzKTtcblxuICAgIC8vIENvbmNhdGVuYXRlIGFsbCBjZXJ0aWZpY2F0ZXMgaW50byBhIHNpbmdsZSBmaWxlIGZvciBOT0RFX0VYVFJBX0NBX0NFUlRTXG4gICAgbGV0IGNvbWJpbmVkQ2VydENvbnRlbnQgPSAnJztcbiAgICBmb3IgKGNvbnN0IGNlcnRGaWxlIG9mIGNlcnRpZmljYXRlRmlsZXMpIHtcbiAgICAgIGNvbnN0IGNlcnRDb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGNlcnRGaWxlLCAndXRmOCcpO1xuICAgICAgY29tYmluZWRDZXJ0Q29udGVudCArPSBjZXJ0Q29udGVudDtcbiAgICAgIC8vIEVuc3VyZSBwcm9wZXIgUEVNIGZvcm1hdCB3aXRoIG5ld2xpbmUgYmV0d2VlbiBjZXJ0aWZpY2F0ZXNcbiAgICAgIGlmICghY2VydENvbnRlbnQuZW5kc1dpdGgoJ1xcbicpKSB7XG4gICAgICAgIGNvbWJpbmVkQ2VydENvbnRlbnQgKz0gJ1xcbic7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGRpcmVjdG9yeSwgd3JpdGUgdGhlIGNlcnRpZmljYXRlIGZpbGUsIGNyZWF0ZSBhc3NldCwgdGhlbiBkZWxldGUgdGVtcCBkaXJcbiAgICBjb25zdCB3b3JrZGlyID0gZnMubWtkdGVtcFN5bmMocGF0aC5qb2luKG9zLnRtcGRpcigpLCAnY2VydGlmaWNhdGUtbGF5ZXItJykpO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjZXJ0UGF0aCA9IHBhdGguam9pbih3b3JrZGlyLCAnY2VydHMucGVtJyk7XG4gICAgICBmcy53cml0ZUZpbGVTeW5jKGNlcnRQYXRoLCBjb21iaW5lZENlcnRDb250ZW50KTtcblxuICAgICAgLy8gU2V0IGVudmlyb25tZW50IHZhcmlhYmxlIGFuZCBjcmVhdGUgbGF5ZXJcbiAgICAgIHRoaXMuZXh0cmFMYW1iZGFFbnYuTk9ERV9FWFRSQV9DQV9DRVJUUyA9ICcvb3B0L2NlcnRzLnBlbSc7XG4gICAgICB0aGlzLmV4dHJhTGFtYmRhUHJvcHMubGF5ZXJzIS5wdXNoKFxuICAgICAgICBuZXcgbGFtYmRhLkxheWVyVmVyc2lvbihzY29wZSwgJ0NlcnRpZmljYXRlIExheWVyJywge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnTGF5ZXIgY29udGFpbmluZyBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIgY2VydGlmaWNhdGUocykgZm9yIGNkay1naXRodWItcnVubmVycycsXG4gICAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHdvcmtkaXIpLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIC8vIENhbGxpbmcgYGZyb21Bc3NldCgpYCBoYXMgY29waWVkIGZpbGVzIHRvIHRoZSBhc3NlbWJseSwgc28gd2UgY2FuIGRlbGV0ZSB0aGUgdGVtcG9yYXJ5IGRpcmVjdG9yeS5cbiAgICAgIGZzLnJtU3luYyh3b3JrZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSwgZm9yY2U6IHRydWUgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIE1ldHJpYyBmb3IgdGhlIG51bWJlciBvZiBHaXRIdWIgQWN0aW9ucyBqb2JzIGNvbXBsZXRlZC4gSXQgaGFzIGBQcm92aWRlckxhYmVsc2AgYW5kIGBTdGF0dXNgIGRpbWVuc2lvbnMuIFRoZSBzdGF0dXMgY2FuIGJlIG9uZSBvZiBcIlN1Y2NlZWRlZFwiLCBcIlN1Y2NlZWRlZFdpdGhJc3N1ZXNcIiwgXCJGYWlsZWRcIiwgXCJDYW5jZWxlZFwiLCBcIlNraXBwZWRcIiwgb3IgXCJBYmFuZG9uZWRcIi5cbiAgICpcbiAgICogKipXQVJOSU5HOioqIHRoaXMgbWV0aG9kIGNyZWF0ZXMgYSBtZXRyaWMgZmlsdGVyIGZvciBlYWNoIHByb3ZpZGVyLiBFYWNoIG1ldHJpYyBoYXMgYSBzdGF0dXMgZGltZW5zaW9uIHdpdGggc2l4IHBvc3NpYmxlIHZhbHVlcy4gVGhlc2UgcmVzb3VyY2VzIG1heSBpbmN1ciBjb3N0LlxuICAgKi9cbiAgcHVibGljIG1ldHJpY0pvYkNvbXBsZXRlZChwcm9wcz86IGNsb3Vkd2F0Y2guTWV0cmljT3B0aW9ucyk6IGNsb3Vkd2F0Y2guTWV0cmljIHtcbiAgICBpZiAoIXRoaXMuam9ic0NvbXBsZXRlZE1ldHJpY0ZpbHRlcnNJbml0aWFsaXplZCkge1xuICAgICAgLy8gd2UgY2FuJ3QgdXNlIGxvZ3MuRmlsdGVyUGF0dGVybi5zcGFjZURlbGltaXRlZCgpIGJlY2F1c2UgaXQgaGFzIG5vIHN1cHBvcnQgZm9yIHx8XG4gICAgICAvLyBzdGF0dXMgbGlzdCB0YWtlbiBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9hY3Rpb25zL3J1bm5lci9ibG9iL2JlOTYzMjMwMmNlZWY1MGJmYjM2ZWE5OThjZWE5Yzk0Yzc1ZTVkNGQvc3JjL1Nkay9EVFdlYkFwaS9XZWJBcGkvVGFza1Jlc3VsdC5jc1xuICAgICAgLy8gd2UgbmVlZCBcIi4uLlwiIGZvciBMYW1iZGEgdGhhdCBwcmVmaXhlcyBzb21lIGV4dHJhIGRhdGEgdG8gbG9nIGxpbmVzXG4gICAgICBjb25zdCBwYXR0ZXJuID0gbG9ncy5GaWx0ZXJQYXR0ZXJuLmxpdGVyYWwoJ1suLi4sIG1hcmtlciA9IFwiQ0RLR0hBXCIsIGpvYiA9IFwiSk9CXCIsIGRvbmUgPSBcIkRPTkVcIiwgbGFiZWxzLCBzdGF0dXMgPSBcIlN1Y2NlZWRlZFwiIHx8IHN0YXR1cyA9IFwiU3VjY2VlZGVkV2l0aElzc3Vlc1wiIHx8IHN0YXR1cyA9IFwiRmFpbGVkXCIgfHwgc3RhdHVzID0gXCJDYW5jZWxlZFwiIHx8IHN0YXR1cyA9IFwiU2tpcHBlZFwiIHx8IHN0YXR1cyA9IFwiQWJhbmRvbmVkXCJdJyk7XG5cbiAgICAgIC8vIEV4dHJhY3QgYWxsIHVuaXF1ZSBzdWItcHJvdmlkZXJzIGZyb20gcmVndWxhciBhbmQgY29tcG9zaXRlIHByb3ZpZGVyc1xuICAgICAgLy8gQnVpbGQgYSBzZXQgZmlyc3QgdG8gYXZvaWQgZmlsdGVyaW5nIHRoZSBzYW1lIGxvZyB0d2ljZVxuICAgICAgZm9yIChjb25zdCBwIG9mIHRoaXMuZXh0cmFjdFVuaXF1ZVN1YlByb3ZpZGVycygpKSB7XG4gICAgICAgIGNvbnN0IG1ldHJpY0ZpbHRlciA9IHAubG9nR3JvdXAuYWRkTWV0cmljRmlsdGVyKGAke3AubG9nR3JvdXAubm9kZS5pZH0gZmlsdGVyYCwge1xuICAgICAgICAgIG1ldHJpY05hbWVzcGFjZTogJ0dpdEh1YlJ1bm5lcnMnLFxuICAgICAgICAgIG1ldHJpY05hbWU6ICdKb2JDb21wbGV0ZWQnLFxuICAgICAgICAgIGZpbHRlclBhdHRlcm46IHBhdHRlcm4sXG4gICAgICAgICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICAgICAgICAvLyBjYW4ndCB3aXRoIGRpbWVuc2lvbnMgLS0gZGVmYXVsdFZhbHVlOiAwLFxuICAgICAgICAgIGRpbWVuc2lvbnM6IHtcbiAgICAgICAgICAgIFByb3ZpZGVyTGFiZWxzOiAnJGxhYmVscycsXG4gICAgICAgICAgICBTdGF0dXM6ICckc3RhdHVzJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcblxuICAgICAgICBpZiAobWV0cmljRmlsdGVyLm5vZGUuZGVmYXVsdENoaWxkIGluc3RhbmNlb2YgbG9ncy5DZm5NZXRyaWNGaWx0ZXIpIHtcbiAgICAgICAgICBtZXRyaWNGaWx0ZXIubm9kZS5kZWZhdWx0Q2hpbGQuYWRkUHJvcGVydHlPdmVycmlkZSgnTWV0cmljVHJhbnNmb3JtYXRpb25zLjAuVW5pdCcsICdDb3VudCcpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIEFubm90YXRpb25zLm9mKG1ldHJpY0ZpbHRlcikuYWRkV2FybmluZygnVW5hYmxlIHRvIHNldCBtZXRyaWMgZmlsdGVyIFVuaXQgdG8gQ291bnQnKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5qb2JzQ29tcGxldGVkTWV0cmljRmlsdGVyc0luaXRpYWxpemVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgIG5hbWVzcGFjZTogJ0dpdEh1YlJ1bm5lcnMnLFxuICAgICAgbWV0cmljTmFtZTogJ0pvYnNDb21wbGV0ZWQnLFxuICAgICAgdW5pdDogY2xvdWR3YXRjaC5Vbml0LkNPVU5ULFxuICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pLmF0dGFjaFRvKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIE1ldHJpYyBmb3Igc3VjY2Vzc2Z1bCBleGVjdXRpb25zLlxuICAgKlxuICAgKiBBIHN1Y2Nlc3NmdWwgZXhlY3V0aW9uIGRvZXNuJ3QgYWx3YXlzIG1lYW4gYSBydW5uZXIgd2FzIHN0YXJ0ZWQuIEl0IGNhbiBiZSBzdWNjZXNzZnVsIGV2ZW4gd2l0aG91dCBhbnkgbGFiZWwgbWF0Y2hlcy5cbiAgICpcbiAgICogQSBzdWNjZXNzZnVsIHJ1bm5lciBkb2Vzbid0IG1lYW4gdGhlIGpvYiBpdCBleGVjdXRlZCB3YXMgc3VjY2Vzc2Z1bC4gRm9yIHRoYXQsIHNlZSB7QGxpbmsgbWV0cmljSm9iQ29tcGxldGVkfS5cbiAgICovXG4gIHB1YmxpYyBtZXRyaWNTdWNjZWVkZWQocHJvcHM/OiBjbG91ZHdhdGNoLk1ldHJpY09wdGlvbnMpOiBjbG91ZHdhdGNoLk1ldHJpYyB7XG4gICAgcmV0dXJuIHRoaXMub3JjaGVzdHJhdG9yLm1ldHJpY1N1Y2NlZWRlZChwcm9wcyk7XG4gIH1cblxuICAvKipcbiAgICogTWV0cmljIGZvciBmYWlsZWQgcnVubmVyIGV4ZWN1dGlvbnMuXG4gICAqXG4gICAqIEEgZmFpbGVkIHJ1bm5lciB1c3VhbGx5IG1lYW5zIHRoZSBydW5uZXIgZmFpbGVkIHRvIHN0YXJ0IGFuZCBzbyBhIGpvYiB3YXMgbmV2ZXIgZXhlY3V0ZWQuIEl0IGRvZXNuJ3QgbmVjZXNzYXJpbHkgbWVhbiB0aGUgam9iIHdhcyBleGVjdXRlZCBhbmQgZmFpbGVkLiBGb3IgdGhhdCwgc2VlIHtAbGluayBtZXRyaWNKb2JDb21wbGV0ZWR9LlxuICAgKi9cbiAgcHVibGljIG1ldHJpY0ZhaWxlZChwcm9wcz86IGNsb3Vkd2F0Y2guTWV0cmljT3B0aW9ucyk6IGNsb3Vkd2F0Y2guTWV0cmljIHtcbiAgICByZXR1cm4gdGhpcy5vcmNoZXN0cmF0b3IubWV0cmljRmFpbGVkKHByb3BzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBNZXRyaWMgZm9yIHRoZSBpbnRlcnZhbCwgaW4gbWlsbGlzZWNvbmRzLCBiZXR3ZWVuIHRoZSB0aW1lIHRoZSBleGVjdXRpb24gc3RhcnRzIGFuZCB0aGUgdGltZSBpdCBjbG9zZXMuIFRoaXMgdGltZSBtYXkgYmUgbG9uZ2VyIHRoYW4gdGhlIHRpbWUgdGhlIHJ1bm5lciB0b29rLlxuICAgKi9cbiAgcHVibGljIG1ldHJpY1RpbWUocHJvcHM/OiBjbG91ZHdhdGNoLk1ldHJpY09wdGlvbnMpOiBjbG91ZHdhdGNoLk1ldHJpYyB7XG4gICAgcmV0dXJuIHRoaXMub3JjaGVzdHJhdG9yLm1ldHJpY1RpbWUocHJvcHMpO1xuICB9XG5cbiAgLyoqXG4gICAqIE1ldHJpYyBmb3IgdGhlIG51bWJlciBvZiBydW5uZXJzIHRoYXQgd2VyZSBzdG9sZW4gYnkgYSBqb2IgdGhhdCBzaG91bGRuJ3QgaGF2ZSBiZWVuIGFzc2lnbmVkIHRvIHRoZW0uXG4gICAqXG4gICAqIEEgaGlnaCBudW1iZXIgaGVyZSBtZWFucyB5b3VyIHJ1bm5lcnMgYXJlIHNoYXJlZCB3aXRoIGpvYnMgeW91IGRpZG4ndCBtZWFuIHRvIHNlcnZlLiBVc2UgdGhlIFwiU3RvbGVuIHJ1bm5lcnNcIlxuICAgKiBDbG91ZFdhdGNoIExvZ3MgSW5zaWdodHMgcXVlcnkgY3JlYXRlZCBieSB7QGxpbmsgY3JlYXRlTG9nc0luc2lnaHRzUXVlcmllc30gdG8gc2VlIHdoaWNoIHJlcG9zaXRvcmllcyBhbmQgam9ic1xuICAgKiBhcmUgdGFraW5nIHRoZW0uXG4gICAqXG4gICAqIFRoaXMgbWV0cmljIGhhcyB0d28gZGltZW5zaW9uczpcbiAgICogIDEuIGBSZXBsYWNlZGAgd2hpY2ggaXMgXCJ0cnVlXCIgb3IgXCJmYWxzZVwiIGluZGljYXRpbmcgd2hldGhlciB0aGUgc3RvbGVuIHJ1bm5lciB3YXMgcmVwbGFjZWQuIEEgcnVubmVyIG1heSBub3QgYmUgcmVwbGFjZWQgaWYgaXQgd2FzIHN0b2xlbiB0b29cbiAgICogICAgIG1hbnkgdGltZXMgaW4gYSByb3cuIFRoZSBjdXJyZW50IGxpbWl0IGlzIDMuIFdoZW4gdGhpcyBpcyBmYWxzZSwgdGhlcmUgaXMgcHJvYmFibHkgYSBidWcgaW4gb3VyIGRldGVjdGlvbiBvciBzb21ldGhpbmcgbWlzY29uZmlndXJlZC5cbiAgICogIDIuIGBQcm92aWRlcmAgaXMgdGhlIHByb3ZpZGVyIGNvbnN0cnVjdCBwYXRoIG9mIHRoZSBydW5uZXIgdGhhdCB3YXMgc3RvbGVuLiBZb3UgY2FuIGNoZWNrIHlvdXIgY29kZSB0byBzZWUgd2hpY2ggbGFiZWxzIGl0IGhhcyB0aGF0IG1heSBjYXVzZVxuICAgKiAgICAgaXQgdG8gYmUgc3RvbGVuLiBUaGUgbG9ncyBpbnNpZ2h0cyBxdWVyaWVzIGNhbiBwcm92aWRlIGV2ZW4gbW9yZSBpbmZvcm1hdGlvbiBhYm91dCB0aGUgc3RvbGVuIHJ1bm5lcnMuXG4gICAqXG4gICAqICoqV0FSTklORzoqKiB0aGlzIG1ldGhvZCBjcmVhdGVzIGEgbWV0cmljIGZpbHRlci4gVGhpcyByZXNvdXJjZSBtYXkgaW5jdXIgY29zdC5cbiAgICovXG4gIHB1YmxpYyBtZXRyaWNTdG9sZW5SdW5uZXJzKHByb3BzPzogY2xvdWR3YXRjaC5NZXRyaWNPcHRpb25zKTogY2xvdWR3YXRjaC5NZXRyaWMge1xuICAgIGlmICghdGhpcy5zdG9sZW5SdW5uZXJzTWV0cmljRmlsdGVySW5pdGlhbGl6ZWQpIHtcbiAgICAgIHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKS5hZGRNZXRyaWNGaWx0ZXIoJ1N0b2xlbiBSdW5uZXJzIGZpbHRlcicsIHtcbiAgICAgICAgbWV0cmljTmFtZXNwYWNlOiAnR2l0SHViUnVubmVycycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdTdG9sZW5SdW5uZXJzJyxcbiAgICAgICAgZmlsdGVyUGF0dGVybjogbG9ncy5GaWx0ZXJQYXR0ZXJuLnN0cmluZ1ZhbHVlKCckLm1lc3NhZ2UubWV0cmljJywgJz0nLCAnU3RvbGVuUnVubmVyRGV0ZWN0ZWQnKSxcbiAgICAgICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICAgICAgLy8gY2FuJ3Qgd2l0aCBkaW1lbnNpb25zIC0tIGRlZmF1bHRWYWx1ZTogMCxcbiAgICAgICAgZGltZW5zaW9uczoge1xuICAgICAgICAgIFJlcGxhY2VkOiAnJC5tZXNzYWdlLnJlcGxhY2VkJyxcbiAgICAgICAgICBQcm92aWRlcjogJyQubWVzc2FnZS5wcm92aWRlcicsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHRoaXMuc3RvbGVuUnVubmVyc01ldHJpY0ZpbHRlckluaXRpYWxpemVkID0gdHJ1ZTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgIG5hbWVzcGFjZTogJ0dpdEh1YlJ1bm5lcnMnLFxuICAgICAgbWV0cmljTmFtZTogJ1N0b2xlblJ1bm5lcnMnLFxuICAgICAgdW5pdDogY2xvdWR3YXRjaC5Vbml0LkNPVU5ULFxuICAgICAgc3RhdGlzdGljOiBjbG91ZHdhdGNoLlN0YXRzLlNVTSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pLmF0dGFjaFRvKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIE1ldHJpYyBmb3IgdGhlIG51bWJlciBvZiBqb2JzIHdob3NlIGxhYmVscyBtYXRjaGVkIG1vcmUgdGhhbiBvbmUgcHJvdmlkZXIuXG4gICAqXG4gICAqIFdlIHN0YXJ0IGEgcnVubmVyIGZyb20gdGhlIGZpcnN0IG1hdGNoaW5nIHByb3ZpZGVyLCBidXQgR2l0SHViIG1heSBnaXZlIHN1Y2ggYSBqb2IgYSBydW5uZXIgZnJvbSBhbnkgb2YgdGhlbSwgaW5jbHVkaW5nIG9uZSBzdGFydGVkIGZvclxuICAgKiBhbm90aGVyIGpvYi4gU3RvbGVuIHJ1bm5lciBkZXRlY3Rpb24gc3RhcnRzIGFub3RoZXIgcnVubmVyIGZvciB0aGUgam9iIGxlZnQgYmVoaW5kLCBidXQgdGhlIGpvYiBpdHNlbGYgbWF5IHJ1biBvbiBhIHByb3ZpZGVyIHlvdSBkaWRuJ3RcbiAgICogZXhwZWN0LiBBbnl0aGluZyBvdmVyIHplcm8gbWVhbnMgc29tZSB3b3JrZmxvd3MgYXNrIGZvciB0b28gZmV3IGxhYmVscy4gQWRkIGxhYmVscyB0byB0aG9zZSBqb2JzIHNvIHRoZXkgbWF0Y2ggb25seSBvbmUgcHJvdmlkZXIuIFVzZSB0aGVcbiAgICogXCJKb2JzIG1hdGNoaW5nIG11bHRpcGxlIHByb3ZpZGVyc1wiIENsb3VkV2F0Y2ggTG9ncyBJbnNpZ2h0cyBxdWVyeSBjcmVhdGVkIGJ5IHtAbGluayBjcmVhdGVMb2dzSW5zaWdodHNRdWVyaWVzfSB0byBmaW5kIHRoZW0uXG4gICAqXG4gICAqIEpvYnMgcm91dGVkIGJ5IGEgcHJvdmlkZXIgc2VsZWN0b3IgYXJlIG5vdCBjb3VudGVkLCBhcyB0aGUgc2VsZWN0b3IgcGlja3MgdGhlIHByb3ZpZGVyLlxuICAgKlxuICAgKiAqKldBUk5JTkc6KiogdGhpcyBtZXRob2QgY3JlYXRlcyBhIG1ldHJpYyBmaWx0ZXIuIFRoaXMgcmVzb3VyY2UgbWF5IGluY3VyIGNvc3QuXG4gICAqL1xuICBwdWJsaWMgbWV0cmljSm9ic01hdGNoaW5nTXVsdGlwbGVQcm92aWRlcnMocHJvcHM/OiBjbG91ZHdhdGNoLk1ldHJpY09wdGlvbnMpOiBjbG91ZHdhdGNoLk1ldHJpYyB7XG4gICAgaWYgKCF0aGlzLm11bHRpcGxlUHJvdmlkZXJzTWV0cmljRmlsdGVySW5pdGlhbGl6ZWQpIHtcbiAgICAgIHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKS5hZGRNZXRyaWNGaWx0ZXIoJ011bHRpcGxlIFByb3ZpZGVycyBmaWx0ZXInLCB7XG4gICAgICAgIG1ldHJpY05hbWVzcGFjZTogJ0dpdEh1YlJ1bm5lcnMnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnSm9ic01hdGNoaW5nTXVsdGlwbGVQcm92aWRlcnMnLFxuICAgICAgICBmaWx0ZXJQYXR0ZXJuOiBsb2dzLkZpbHRlclBhdHRlcm4uc3RyaW5nVmFsdWUoJyQubWVzc2FnZS5tZXRyaWMnLCAnPScsICdNdWx0aXBsZVByb3ZpZGVyc01hdGNoZWQnKSxcbiAgICAgICAgbWV0cmljVmFsdWU6ICcxJyxcbiAgICAgICAgdW5pdDogY2xvdWR3YXRjaC5Vbml0LkNPVU5ULFxuICAgICAgICBkZWZhdWx0VmFsdWU6IDAsXG4gICAgICB9KTtcbiAgICAgIHRoaXMubXVsdGlwbGVQcm92aWRlcnNNZXRyaWNGaWx0ZXJJbml0aWFsaXplZCA9IHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICBuYW1lc3BhY2U6ICdHaXRIdWJSdW5uZXJzJyxcbiAgICAgIG1ldHJpY05hbWU6ICdKb2JzTWF0Y2hpbmdNdWx0aXBsZVByb3ZpZGVycycsXG4gICAgICB1bml0OiBjbG91ZHdhdGNoLlVuaXQuQ09VTlQsXG4gICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuU1VNLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSkuYXR0YWNoVG8odGhpcyk7XG4gIH1cblxuICAvKipcbiAgICogTWV0cmljIGZvciB0aGUgbnVtYmVyIG9mIHJ1bm5lcnMgd2Ugc3RvcHBlZCBvbiBwdXJwb3NlIGJlZm9yZSB0aGV5IGdvdCBhIGpvYi5cbiAgICpcbiAgICogVGhlc2Ugc3RlcCBmdW5jdGlvbiBleGVjdXRpb25zIGVuZCB1cCBhcyBhYm9ydGVkIGFuZCBub3QgZmFpbGVkLCBzbyB0aGV5IGRvbid0IHNob3cgdXAgaW4ge0BsaW5rIG1ldHJpY0ZhaWxlZH0uXG4gICAqXG4gICAqIFRoaXMgbWV0cmljIGhhcyBvbmUgZGltZW5zaW9uLCBgUmVhc29uYCwgd2hpY2ggaXMgdGhlIGVycm9yIHRoZSBzdGVwIGZ1bmN0aW9uIHdhcyBzdG9wcGVkIHdpdGg6XG4gICAqICAqIGBJZGxlUnVubmVyYDogdGhlIHJ1bm5lciB3YXMgaWRsZSBmb3IgbG9uZ2VyIHRoYW4gaXRzIGlkbGUgdGltZW91dCBhbmQgd2FzIHJlYXBlZC4gVGhpcyBpcyB1c3VhbGx5IGEgcnVubmVyIHdob3NlIGpvYiB3YXMgdGFrZW4gYnlcbiAgICogICAgYW5vdGhlciBydW5uZXIsIG9yIGEgam9iIHRoYXQgd2FzIGNhbmNlbGVkIGJlZm9yZSBpdCBzdGFydGVkLlxuICAgKiAgKiBgU3RhbGVXYXJtUnVubmVyYDogYSB3YXJtIHJ1bm5lciB3YXMgcmVwbGFjZWQgYmVjYXVzZSBpdHMgY29uZmlndXJhdGlvbiBjaGFuZ2VkLlxuICAgKiAgKiBgV2FybVJ1bm5lckV4cGlyZWRgOiBhIHdhcm0gcnVubmVyIHJlYWNoZWQgdGhlIGVuZCBvZiBpdHMgZHVyYXRpb24uXG4gICAqICAqIGBXYXJtUnVubmVyQmFkRGVhZGxpbmVgOiBhIHdhcm0gcnVubmVyIGhhZCBhbiBpbnZhbGlkIGRlYWRsaW5lIGFuZCB3YXMgc3RvcHBlZC5cbiAgICpcbiAgICogKipXQVJOSU5HOioqIHRoaXMgbWV0aG9kIGNyZWF0ZXMgYSBtZXRyaWMgZmlsdGVyLiBUaGlzIHJlc291cmNlIG1heSBpbmN1ciBjb3N0LlxuICAgKi9cbiAgcHVibGljIG1ldHJpY1N0b3BwZWRSdW5uZXJzKHByb3BzPzogY2xvdWR3YXRjaC5NZXRyaWNPcHRpb25zKTogY2xvdWR3YXRjaC5NZXRyaWMge1xuICAgIGlmICghdGhpcy5zdG9wcGVkUnVubmVyc01ldHJpY0ZpbHRlckluaXRpYWxpemVkKSB7XG4gICAgICBzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLk9SQ0hFU1RSQVRPUikuYWRkTWV0cmljRmlsdGVyKCdTdG9wcGVkIFJ1bm5lcnMgZmlsdGVyJywge1xuICAgICAgICBtZXRyaWNOYW1lc3BhY2U6ICdHaXRIdWJSdW5uZXJzJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ1N0b3BwZWRSdW5uZXJzJyxcbiAgICAgICAgZmlsdGVyUGF0dGVybjogbG9ncy5GaWx0ZXJQYXR0ZXJuLnN0cmluZ1ZhbHVlKCckLm1lc3NhZ2UubWV0cmljJywgJz0nLCAnUnVubmVyU3RvcHBlZCcpLFxuICAgICAgICBtZXRyaWNWYWx1ZTogJzEnLFxuICAgICAgICAvLyBjYW4ndCB3aXRoIGRpbWVuc2lvbnMgLS0gZGVmYXVsdFZhbHVlOiAwLFxuICAgICAgICBkaW1lbnNpb25zOiB7XG4gICAgICAgICAgUmVhc29uOiAnJC5tZXNzYWdlLnJlYXNvbicsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHRoaXMuc3RvcHBlZFJ1bm5lcnNNZXRyaWNGaWx0ZXJJbml0aWFsaXplZCA9IHRydWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICBuYW1lc3BhY2U6ICdHaXRIdWJSdW5uZXJzJyxcbiAgICAgIG1ldHJpY05hbWU6ICdTdG9wcGVkUnVubmVycycsXG4gICAgICB1bml0OiBjbG91ZHdhdGNoLlVuaXQuQ09VTlQsXG4gICAgICBzdGF0aXN0aWM6IGNsb3Vkd2F0Y2guU3RhdHMuU1VNLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSkuYXR0YWNoVG8odGhpcyk7XG4gIH1cblxuICAvKipcbiAgICogTWV0cmljIGZvciB0aGUgbnVtYmVyIG9mIGZhaWxlZCBpbnZvY2F0aW9ucyBvZiB0aGUgbWFuYWdlbWVudCBMYW1iZGEgZnVuY3Rpb25zLlxuICAgKlxuICAgKiBUaGVzZSBhcmUgdGhlIGZ1bmN0aW9ucyB0aGF0IGhhbmRsZSB3ZWJob29rcywgcmV0cmlldmUgcnVubmVyIHRva2Vucywgc3RvcCBpZGxlIHJ1bm5lcnMsIHJlcGxhY2Ugc3RvbGVuIHJ1bm5lcnMsIGV0Yy4gQW55dGhpbmcgb3ZlciB6ZXJvIG1lYW5zXG4gICAqIGpvYnMgbWF5IG5vdCBoYXZlIGdvdHRlbiBhIHJ1bm5lci4gWW91IHNob3VsZCB1c2UgdGhpcyBtZXRyaWMgdG8gdHJpZ2dlciBhbiBhbGFybS5cbiAgICpcbiAgICogT25seSB1bmhhbmRsZWQgZXJyb3JzIGFyZSBjb3VudGVkIGhlcmUsIGFzIHJlcG9ydGVkIGJ5IExhbWJkYSBpdHNlbGYuIEVycm9ycyB0aGF0IGFyZSBoYW5kbGVkIGFuZCBsb2dnZWQsIGxpa2UgYSB3ZWJob29rIHdpdGggYSBiYWQgc2lnbmF0dXJlLFxuICAgKiBhcmUgbm90IGZhaWxlZCBpbnZvY2F0aW9ucy4gVXNlIHRoZSBcIldlYmhvb2sgZXJyb3JzXCIgYW5kIFwiT3JjaGVzdHJhdGlvbiBlcnJvcnNcIiBxdWVyaWVzIGNyZWF0ZWQgYnkge0BsaW5rIGNyZWF0ZUxvZ3NJbnNpZ2h0c1F1ZXJpZXN9IHRvIGZpbmRcbiAgICogdGhvc2UuXG4gICAqXG4gICAqIE1hbmFnZW1lbnQgZnVuY3Rpb25zIGNyZWF0ZWQgYWZ0ZXIgdGhpcyBtZXRob2QgaXMgY2FsbGVkIGFyZSBub3QgaW5jbHVkZWQuIENhbGwgaXQgbGFzdCBpZiB5b3UgdXNlIHdhcm0gcnVubmVycy5cbiAgICovXG4gIHB1YmxpYyBtZXRyaWNMYW1iZGFFcnJvcnMocHJvcHM/OiBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uT3B0aW9ucyk6IGNsb3Vkd2F0Y2guTWF0aEV4cHJlc3Npb24ge1xuICAgIGNvbnN0IGVycm9yczogUmVjb3JkPHN0cmluZywgY2xvdWR3YXRjaC5JTWV0cmljPiA9IHt9O1xuICAgIHRoaXMubWFuYWdlbWVudEZ1bmN0aW9ucy5mb3JFYWNoKChmLCBpKSA9PiB7XG4gICAgICBlcnJvcnNbYGUke2l9YF0gPSBmLm1ldHJpY0Vycm9ycygpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG5ldyBjbG91ZHdhdGNoLk1hdGhFeHByZXNzaW9uKHtcbiAgICAgIC8vIFNVTSgpIGFuZCBub3QgZTArZTErLi4uIHNvIHBlcmlvZHMgd2hlcmUgb25seSBzb21lIG9mIHRoZSBmdW5jdGlvbnMgcmFuIHN0aWxsIGdldCBhIHZhbHVlXG4gICAgICBleHByZXNzaW9uOiBgU1VNKFske09iamVjdC5rZXlzKGVycm9ycykuam9pbignLCcpfV0pYCxcbiAgICAgIHVzaW5nTWV0cmljczogZXJyb3JzLFxuICAgICAgbGFiZWw6ICdFcnJvcnMnLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHRvcGljIGZvciBub3RpZmljYXRpb25zIHdoZW4gYSBydW5uZXIgaW1hZ2UgYnVpbGQgZmFpbHMuXG4gICAqXG4gICAqIFJ1bm5lciBpbWFnZXMgYXJlIHJlYnVpbHQgZXZlcnkgd2VlayBieSBkZWZhdWx0LiBUaGlzIHByb3ZpZGVzIHRoZSBsYXRlc3QgR2l0SHViIFJ1bm5lciB2ZXJzaW9uIGFuZCBzb2Z0d2FyZSB1cGRhdGVzLlxuICAgKlxuICAgKiBJZiB5b3Ugd2FudCB0byBiZSBzdXJlIHlvdSBhcmUgdXNpbmcgdGhlIGxhdGVzdCBydW5uZXIgdmVyc2lvbiwgeW91IGNhbiB1c2UgdGhpcyB0b3BpYyB0byBiZSBub3RpZmllZCB3aGVuIGEgYnVpbGQgZmFpbHMuXG4gICAqXG4gICAqIEVtYWlsIHN1YnNjcmliZXJzIGdldCBhIHNob3J0IHN1bW1hcnkgd2l0aCB0aGUgZmFpbHVyZSByZWFzb24gYW5kIGEgbGluayB0byB0aGUgbG9ncy4gT3RoZXIgc3Vic2NyaWJlcnMgZ2V0IHRoZSBvcmlnaW5hbFxuICAgKiBKU09OIG5vdGlmaWNhdGlvbiBmcm9tIENvZGVCdWlsZCBvciBFQzIgSW1hZ2UgQnVpbGRlci5cbiAgICpcbiAgICogV2hlbiB0aGUgaW1hZ2UgYnVpbGRlciBpcyBkZWZpbmVkIGluIGEgc2VwYXJhdGUgc3RhY2sgKGUuZy4gaW4gYSBzcGxpdC1zdGFja3Mgc2V0dXApLCBwYXNzIHRoYXQgc3RhY2sgb3IgY29uc3RydWN0XG4gICAqIGFzIHRoZSBvcHRpb25hbCBzY29wZSBzbyB0aGUgdG9waWMgYW5kIGZhaWx1cmUtbm90aWZpY2F0aW9uIGFzcGVjdHMgYXJlIGNyZWF0ZWQgaW4gdGhlIHNhbWUgc3RhY2sgYXMgdGhlIGltYWdlXG4gICAqIGJ1aWxkZXIuIE90aGVyd2lzZSB0aGUgYXNwZWN0cyBtYXkgbm90IGZpbmQgdGhlIGltYWdlIGJ1aWxkZXIgcmVzb3VyY2VzLlxuICAgKlxuICAgKiBAcGFyYW0gc2NvcGUgT3B0aW9uYWwgc2NvcGUgKGUuZy4gdGhlIGltYWdlIGJ1aWxkZXIgc3RhY2spIHdoZXJlIHRoZSB0b3BpYyBhbmQgYXNwZWN0cyB3aWxsIGJlIGNyZWF0ZWQuIERlZmF1bHRzIHRvIHRoaXMgY29uc3RydWN0LlxuICAgKi9cbiAgcHVibGljIGZhaWxlZEltYWdlQnVpbGRzVG9waWMoc2NvcGU/OiBDb25zdHJ1Y3QpIHtcbiAgICBzY29wZSA/Pz0gdGhpcztcbiAgICBjb25zdCB0b3BpYyA9IG5ldyBzbnMuVG9waWMoc2NvcGUsICdGYWlsZWQgUnVubmVyIEltYWdlIEJ1aWxkcycpO1xuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHNjb3BlKTtcbiAgICBjb25zdCBmaWx0ZXJpbmdUb3BpYyA9IEF3c0ltYWdlQnVpbGRlckZhaWxlZEJ1aWxkTm90aWZpZXIuY3JlYXRlRmlsdGVyaW5nVG9waWMoc2NvcGUsIHRvcGljKTtcbiAgICBjZGsuQXNwZWN0cy5vZihzdGFjaykuYWRkKG5ldyBDb2RlQnVpbGRJbWFnZUJ1aWxkZXJGYWlsZWRCdWlsZE5vdGlmaWVyKGZpbHRlcmluZ1RvcGljKSk7XG4gICAgY2RrLkFzcGVjdHMub2Yoc3RhY2spLmFkZChuZXcgQXdzSW1hZ2VCdWlsZGVyRmFpbGVkQnVpbGROb3RpZmllcihmaWx0ZXJpbmdUb3BpYykpO1xuICAgIHJldHVybiB0b3BpYztcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIENsb3VkV2F0Y2ggTG9ncyBJbnNpZ2h0cyBzYXZlZCBxdWVyaWVzIHRoYXQgY2FuIGJlIHVzZWQgdG8gZGVidWcgaXNzdWVzIHdpdGggdGhlIHJ1bm5lcnMuXG4gICAqXG4gICAqICogXCJXZWJob29rIGVycm9yc1wiIGhlbHBzIGRpYWdub3NlIGNvbmZpZ3VyYXRpb24gaXNzdWVzIHdpdGggR2l0SHViIGludGVncmF0aW9uXG4gICAqICogXCJJZ25vcmVkIHdlYmhvb2tcIiBoZWxwcyB1bmRlcnN0YW5kIHdoeSBydW5uZXJzIGFyZW4ndCBzdGFydGVkXG4gICAqICogXCJJZ25vcmVkIGpvYnMgYmFzZWQgb24gbGFiZWxzXCIgaGVscHMgZGVidWcgbGFiZWwgbWF0Y2hpbmcgaXNzdWVzXG4gICAqICogXCJXZWJob29rIHN0YXJ0ZWQgcnVubmVyc1wiIGhlbHBzIHVuZGVyc3RhbmQgd2hpY2ggcnVubmVycyB3ZXJlIHN0YXJ0ZWRcbiAgICogKiBcIkpvYnMgbWF0Y2hpbmcgbXVsdGlwbGUgcHJvdmlkZXJzXCIgbGlzdHMgam9icyB0aGF0IG5lZWQgbW9yZSBsYWJlbHMgc28gdGhleSBtYXRjaCBvbmx5IG9uZSBwcm92aWRlclxuICAgKiAqIFwiV2FybSBydW5uZXIgc3RhdHVzXCIgYW5kIFwiV2FybSBydW5uZXIgZXJyb3JzXCIgKHdoZW4gd2FybSBydW5uZXJzIGFyZSBjb25maWd1cmVkKVxuICAgKlxuICAgKiBAcGFyYW0gcHJlZml4IFByZWZpeCBmb3IgdGhlIHF1ZXJ5IGRlZmluaXRpb25zLiBEZWZhdWx0cyB0byBcIkdpdEh1YiBSdW5uZXJzXCIuXG4gICAqL1xuICBwdWJsaWMgY3JlYXRlTG9nc0luc2lnaHRzUXVlcmllcyhwcmVmaXggPSAnR2l0SHViIFJ1bm5lcnMnKSB7XG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdXZWJob29rIGVycm9ycycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vV2ViaG9vayBlcnJvcnNgLFxuICAgICAgbG9nR3JvdXBzOiBbdGhpcy53ZWJob29rLmhhbmRsZXIubG9nR3JvdXBdLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgIGBzdHJjb250YWlucyhAbG9nU3RyZWFtLCBcIiR7dGhpcy53ZWJob29rLmhhbmRsZXIuZnVuY3Rpb25OYW1lfVwiKWAsXG4gICAgICAgICAgJ2xldmVsID0gXCJFUlJPUlwiJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnT3JjaGVzdHJhdGlvbiBlcnJvcnMnLCB7XG4gICAgICBxdWVyeURlZmluaXRpb25OYW1lOiBgJHtwcmVmaXh9L09yY2hlc3RyYXRpb24gZXJyb3JzYCxcbiAgICAgIGxvZ0dyb3VwczogW3NpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKV0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgJ2xldmVsID0gXCJFUlJPUlwiJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnUnVubmVyIGltYWdlIGJ1aWxkIGVycm9ycycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vUnVubmVyIGltYWdlIGJ1aWxkIGVycm9yc2AsXG4gICAgICBsb2dHcm91cHM6IFtzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLlJVTk5FUl9JTUFHRV9CVUlMRCldLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgICdzdHJjb250YWlucyhtZXNzYWdlLCBcImVycm9yXCIpIG9yIHN0cmNvbnRhaW5zKG1lc3NhZ2UsIFwiRVJST1JcIikgb3Igc3RyY29udGFpbnMobWVzc2FnZSwgXCJFcnJvclwiKSBvciBsZXZlbCA9IFwiRVJST1JcIicsXG4gICAgICAgIF0sXG4gICAgICAgIHNvcnQ6ICdAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICBsaW1pdDogMTAwLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ0lnbm9yZWQgd2ViaG9va3MnLCB7XG4gICAgICBxdWVyeURlZmluaXRpb25OYW1lOiBgJHtwcmVmaXh9L0lnbm9yZWQgd2ViaG9va3NgLFxuICAgICAgbG9nR3JvdXBzOiBbdGhpcy53ZWJob29rLmhhbmRsZXIubG9nR3JvdXBdLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmllbGRzOiBbJ0B0aW1lc3RhbXAnLCAnbWVzc2FnZS5ub3RpY2UnXSxcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgIGBzdHJjb250YWlucyhAbG9nU3RyZWFtLCBcIiR7dGhpcy53ZWJob29rLmhhbmRsZXIuZnVuY3Rpb25OYW1lfVwiKWAsXG4gICAgICAgICAgJ3N0cmNvbnRhaW5zKG1lc3NhZ2Uubm90aWNlLCBcIklnbm9yaW5nXCIpJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnSWdub3JlZCBqb2JzIGJhc2VkIG9uIGxhYmVscycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vSWdub3JlZCBqb2JzIGJhc2VkIG9uIGxhYmVsc2AsXG4gICAgICBsb2dHcm91cHM6IFt0aGlzLndlYmhvb2suaGFuZGxlci5sb2dHcm91cF0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWVsZHM6IFsnQHRpbWVzdGFtcCcsICdtZXNzYWdlLm5vdGljZSddLFxuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgYHN0cmNvbnRhaW5zKEBsb2dTdHJlYW0sIFwiJHt0aGlzLndlYmhvb2suaGFuZGxlci5mdW5jdGlvbk5hbWV9XCIpYCxcbiAgICAgICAgICAnc3RyY29udGFpbnMobWVzc2FnZS5ub3RpY2UsIFwiSWdub3JpbmcgbGFiZWxzXCIpJyxcbiAgICAgICAgXSxcbiAgICAgICAgc29ydDogJ0B0aW1lc3RhbXAgZGVzYycsXG4gICAgICAgIGxpbWl0OiAxMDAsXG4gICAgICB9KSxcbiAgICB9KTtcblxuICAgIG5ldyBsb2dzLlF1ZXJ5RGVmaW5pdGlvbih0aGlzLCAnV2ViaG9vayBzdGFydGVkIHJ1bm5lcnMnLCB7XG4gICAgICBxdWVyeURlZmluaXRpb25OYW1lOiBgJHtwcmVmaXh9L1dlYmhvb2sgc3RhcnRlZCBydW5uZXJzYCxcbiAgICAgIGxvZ0dyb3VwczogW3RoaXMud2ViaG9vay5oYW5kbGVyLmxvZ0dyb3VwXSxcbiAgICAgIHF1ZXJ5U3RyaW5nOiBuZXcgbG9ncy5RdWVyeVN0cmluZyh7XG4gICAgICAgIGZpZWxkczogWydAdGltZXN0YW1wJywgJ21lc3NhZ2Uuc2ZuSW5wdXQuam9iVXJsJywgJ21lc3NhZ2Uuc2ZuSW5wdXQuam9iTGFiZWxzJywgJ21lc3NhZ2Uuc2ZuSW5wdXQubGFiZWxzJywgJ21lc3NhZ2Uuc2ZuSW5wdXQucHJvdmlkZXInXSxcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgIGBzdHJjb250YWlucyhAbG9nU3RyZWFtLCBcIiR7dGhpcy53ZWJob29rLmhhbmRsZXIuZnVuY3Rpb25OYW1lfVwiKWAsXG4gICAgICAgICAgJ21lc3NhZ2Uuc2ZuSW5wdXQuam9iVXJsIGxpa2UgL2h0dHAuKi8nLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdXZWJob29rIHJlZGVsaXZlcmllcycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vV2ViaG9vayByZWRlbGl2ZXJpZXNgLFxuICAgICAgbG9nR3JvdXBzOiBbdGhpcy5yZWRlbGl2ZXJlci5oYW5kbGVyLmxvZ0dyb3VwXSxcbiAgICAgIHF1ZXJ5U3RyaW5nOiBuZXcgbG9ncy5RdWVyeVN0cmluZyh7XG4gICAgICAgIGZpZWxkczogWydAdGltZXN0YW1wJywgJ21lc3NhZ2Uubm90aWNlJywgJ21lc3NhZ2UuZGVsaXZlcnlJZCcsICdtZXNzYWdlLmd1aWQnXSxcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgICdpc1ByZXNlbnQobWVzc2FnZS5kZWxpdmVyeUlkKScsXG4gICAgICAgIF0sXG4gICAgICAgIHNvcnQ6ICdAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICBsaW1pdDogMTAwLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ1N0b2xlbiBydW5uZXJzJywge1xuICAgICAgcXVlcnlEZWZpbml0aW9uTmFtZTogYCR7cHJlZml4fS9TdG9sZW4gcnVubmVyc2AsXG4gICAgICBsb2dHcm91cHM6IFtzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLk9SQ0hFU1RSQVRPUildLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmllbGRzOiBbXG4gICAgICAgICAgJ0B0aW1lc3RhbXAnLCAnbWVzc2FnZS5ub3RpY2UnLCAnbWVzc2FnZS5zdG9sZW5SdW5uZXJOYW1lJywgJ21lc3NhZ2UucnVubmVyTmFtZScsICdtZXNzYWdlLnN0b2xlbkJ5Sm9iSWQnLFxuICAgICAgICAgICdtZXNzYWdlLmpvYlVybCcsICdtZXNzYWdlLm93bmVyJywgJ21lc3NhZ2UucmVwbycsICdtZXNzYWdlLnByb3ZpZGVyJyxcbiAgICAgICAgXSxcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgICdpc1ByZXNlbnQobWVzc2FnZS5tZXRyaWMpIGFuZCBzdHJjb250YWlucyhtZXNzYWdlLm1ldHJpYywgXCJTdG9sZW5cIiknLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdKb2JzIG1hdGNoaW5nIG11bHRpcGxlIHByb3ZpZGVycycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vSm9icyBtYXRjaGluZyBtdWx0aXBsZSBwcm92aWRlcnNgLFxuICAgICAgbG9nR3JvdXBzOiBbdGhpcy53ZWJob29rLmhhbmRsZXIubG9nR3JvdXBdLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgLy8gbGFiZWxzIGFuZCBwcm92aWRlcnMgYXJlIGFycmF5cywgd2hpY2ggTG9ncyBJbnNpZ2h0cyBzcGxpdHMgaW50byBvbmUgZmllbGQgcGVyIGl0ZW0sIHNvIHRoZSBmdWxsIHJlY29yZCBzaG93cyB0aGVtXG4gICAgICAgIGZpZWxkczogWydAdGltZXN0YW1wJywgJ21lc3NhZ2Uuam9iVXJsJywgJ21lc3NhZ2UucHJvdmlkZXInLCAnQG1lc3NhZ2UnXSxcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgICdtZXNzYWdlLm1ldHJpYyA9IFwiTXVsdGlwbGVQcm92aWRlcnNNYXRjaGVkXCInLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuXG4gICAgbmV3IGxvZ3MuUXVlcnlEZWZpbml0aW9uKHRoaXMsICdXYXJtIHJ1bm5lciBzdGF0dXMnLCB7XG4gICAgICBxdWVyeURlZmluaXRpb25OYW1lOiBgJHtwcmVmaXh9L1dhcm0gcnVubmVyIHN0YXR1c2AsXG4gICAgICBsb2dHcm91cHM6IFtzaW5nbGV0b25Mb2dHcm91cCh0aGlzLCBTaW5nbGV0b25Mb2dUeXBlLk9SQ0hFU1RSQVRPUildLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgZmllbGRzOiBbJ0B0aW1lc3RhbXAnLCAnbWVzc2FnZS5ub3RpY2UnLCAnbWVzc2FnZS5ydW5uZXJOYW1lJywgJ21lc3NhZ2UucHJvdmlkZXJQYXRoJywgJ21lc3NhZ2Uuc3RhcnRlZCcsICdtZXNzYWdlLnN0aWxsUnVubmluZycsICdtZXNzYWdlLnJ1bm5lckJ1c3knXSxcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgIGNkay5MYXp5LnN0cmluZyh7XG4gICAgICAgICAgICBwcm9kdWNlOiAoKSA9PiB7XG4gICAgICAgICAgICAgIGlmICh0aGlzLndhcm1SdW5uZXJNYW5hZ2VyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGBzdHJjb250YWlucyhAbG9nU3RyZWFtLCBcIiR7dGhpcy53YXJtUnVubmVyTWFuYWdlci5mdW5jdGlvbk5hbWV9XCIpYDtcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJ1dBUk0gUlVOTkVSUyBOT1QgRU5BQkxFRCc7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHNvcnQ6ICdAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICBsaW1pdDogMjAwLFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICBuZXcgbG9ncy5RdWVyeURlZmluaXRpb24odGhpcywgJ1dhcm0gcnVubmVyIGVycm9ycycsIHtcbiAgICAgIHF1ZXJ5RGVmaW5pdGlvbk5hbWU6IGAke3ByZWZpeH0vV2FybSBydW5uZXIgZXJyb3JzYCxcbiAgICAgIGxvZ0dyb3VwczogW3NpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKV0sXG4gICAgICBxdWVyeVN0cmluZzogbmV3IGxvZ3MuUXVlcnlTdHJpbmcoe1xuICAgICAgICBmaWVsZHM6IFsnQHRpbWVzdGFtcCcsICdtZXNzYWdlLm5vdGljZScsICdtZXNzYWdlLnJ1bm5lck5hbWUnLCAnbWVzc2FnZS5lcnJvciddLFxuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgY2RrLkxhenkuc3RyaW5nKHtcbiAgICAgICAgICAgIHByb2R1Y2U6ICgpID0+IHtcbiAgICAgICAgICAgICAgaWYgKHRoaXMud2FybVJ1bm5lck1hbmFnZXIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gYHN0cmNvbnRhaW5zKEBsb2dTdHJlYW0sIFwiJHt0aGlzLndhcm1SdW5uZXJNYW5hZ2VyLmZ1bmN0aW9uTmFtZX1cIilgO1xuICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiAnV0FSTSBSVU5ORVJTIE5PVCBFTkFCTEVEJztcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9KSxcbiAgICAgICAgICAnbGV2ZWwgPSBcIkVSUk9SXCInLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDEwMCxcbiAgICAgIH0pLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBDbG91ZFdhdGNoIGRhc2hib2FyZCB3aXRoIHRoZSBtZXRyaWNzIHlvdSBuZWVkIHRvIGtub3cgaWYgeW91ciBydW5uZXJzIGFyZSBoZWFsdGh5LlxuICAgKlxuICAgKiBJdCdzIHNwbGl0IGludG8gc2VjdGlvbnMsIGVhY2ggd2l0aCBhIHNob3J0IGV4cGxhbmF0aW9uIG9mIHdoYXQgaXRzIG51bWJlcnMgbWVhbiBhbmQgd2hpY2ggb25lcyB0byB3YXRjaDpcbiAgICpcbiAgICogKiAqKkpvYnMqKjogYXJlIGpvYnMgcnVubmluZyBhbmQgcGFzc2luZywgYW5kIHdoaWNoIHJ1bm5lciBpcyBmYWlsaW5nIHRoZW0/XG4gICAqICogKipSdW5uZXJzKio6IGRvIHJ1bm5lcnMgc3RhcnQsIGhvdyBsb25nIGRvIHRoZXkgdGFrZSAoYW5kIHRoZXJlZm9yZSBjb3N0KSwgYW5kIHdoeSBkbyB0aGV5IGZhaWwgdG8gc3RhcnQ/XG4gICAqICogKipSdW5uZXIgYXNzaWdubWVudCoqOiBhcmUgcnVubmVycyB0YWtlbiBieSBqb2JzIHRoZXkgd2VyZW4ndCBzdGFydGVkIGZvciwgZG8gam9icyBtYXRjaCBtb3JlIHRoYW4gb25lIHByb3ZpZGVyLCBhbmQgd2h5XG4gICAqICAgd2VyZSBydW5uZXJzIHN0b3BwZWQgYmVmb3JlIGdldHRpbmcgYSBqb2I/XG4gICAqICogKipNYW5hZ2VtZW50IGZ1bmN0aW9ucyAob3JjaGVzdHJhdGlvbikqKjogaXMgR2l0SHViIHJlYWNoaW5nIHRoZSB3ZWJob29rLCBhbmQgaXMgYW55IG9mIG91ciBjb2RlIGZhaWxpbmc/XG4gICAqXG4gICAqICoqV0FSTklORzoqKiB0aGlzIG1ldGhvZCBjYWxscyB7QGxpbmsgbWV0cmljSm9iQ29tcGxldGVkfSwge0BsaW5rIG1ldHJpY1N0b2xlblJ1bm5lcnN9LCB7QGxpbmsgbWV0cmljU3RvcHBlZFJ1bm5lcnN9IGFuZFxuICAgKiB7QGxpbmsgbWV0cmljSm9ic01hdGNoaW5nTXVsdGlwbGVQcm92aWRlcnN9IHdoaWNoIGNyZWF0ZSBtZXRyaWMgZmlsdGVycy4gVGhlc2UgcmVzb3VyY2VzIG1heSBpbmN1ciBjb3N0LlxuICAgKlxuICAgKiBUaGlzIGRhc2hib2FyZCBpcyB2ZXJ5IGJhc2ljLiBQdWxsIHJlcXVlc3RzIGFuZCBpc3N1ZXMgYXJlIHdlbGNvbWUgdG8gaW1wcm92ZSBpdC5cbiAgICpcbiAgICogQHBhcmFtIG5hbWUgTmFtZSBvZiB0aGUgZGFzaGJvYXJkLiBEZWZhdWx0cyB0byBcIkdpdEh1Yi1SdW5uZXJzXCIuXG4gICAqL1xuICBwdWJsaWMgY3JlYXRlRGFzaGJvYXJkKG5hbWUgPSAnR2l0SHViLVJ1bm5lcnMnKTogY2xvdWR3YXRjaC5EYXNoYm9hcmQge1xuICAgIC8vIGNyZWF0ZSB0aGUgbWV0cmljIGZpbHRlcnMgYmVoaW5kIHRoZXNlIG1ldHJpY3NcbiAgICB0aGlzLm1ldHJpY0pvYkNvbXBsZXRlZCgpO1xuICAgIHRoaXMubWV0cmljU3RvbGVuUnVubmVycygpO1xuICAgIHRoaXMubWV0cmljU3RvcHBlZFJ1bm5lcnMoKTtcblxuICAgIC8vIG91ciBsb2cgbWV0cmljIGZpbHRlcnMgYWRkIGRpbWVuc2lvbnMsIGFuZCBhIG1ldHJpYyB3aXRoIGRpbWVuc2lvbnMgY2FuIG9ubHkgYmUgcmVhZCB3aXRoIHRob3NlIGRpbWVuc2lvbnMuXG4gICAgLy8gc2VhcmNoIGV4cHJlc3Npb25zIGxldCB1cyBzdW0gdGhlbSBhbGwgdXAgd2l0aG91dCBsaXN0aW5nIGV2ZXJ5IGRpbWVuc2lvbiB2YWx1ZS5cbiAgICBjb25zdCBzZWFyY2ggPSAobGFiZWw6IHN0cmluZywgbWV0cmljTmFtZTogc3RyaW5nLCBkaW1lbnNpb25zPzogc3RyaW5nKSA9PiB7XG4gICAgICBjb25zdCBxdWVyeSA9IFsnTmFtZXNwYWNlPVwiR2l0SHViUnVubmVyc1wiJywgYE1ldHJpY05hbWU9XCIke21ldHJpY05hbWV9XCJgLCBkaW1lbnNpb25zXS5maWx0ZXIocSA9PiBxKS5qb2luKCcgJyk7XG4gICAgICByZXR1cm4gbmV3IGNsb3Vkd2F0Y2guTWF0aEV4cHJlc3Npb24oe1xuICAgICAgICBleHByZXNzaW9uOiBgU1VNKFNFQVJDSCgnJHtxdWVyeX0nLCAnU3VtJykpYCxcbiAgICAgICAgbGFiZWwsXG4gICAgICAgIHVzaW5nTWV0cmljczoge30sXG4gICAgICB9KTtcbiAgICB9O1xuICAgIGNvbnN0IGpvYnMgPSAoc3RhdHVzOiBzdHJpbmcsIGxhYmVsOiBzdHJpbmcpID0+IHNlYXJjaChsYWJlbCwgJ0pvYkNvbXBsZXRlZCcsIGBTdGF0dXM9XCIke3N0YXR1c31cImApO1xuXG4gICAgY29uc3QgZGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiBuYW1lLFxuICAgICAgZGVmYXVsdEludGVydmFsOiBjZGsuRHVyYXRpb24uZGF5cygxKSxcbiAgICB9KTtcblxuICAgIC8vIGEgZnVsbCB3aWR0aCB0ZXh0IHdpZGdldCB0aGF0IHN0YXJ0cyBhIHNlY3Rpb24gYW5kIGV4cGxhaW5zIGl0cyBudW1iZXJzXG4gICAgY29uc3Qgc2VjdGlvbiA9IChoZWlnaHQ6IG51bWJlciwgLi4ubGluZXM6IHN0cmluZ1tdKSA9PiBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhuZXcgY2xvdWR3YXRjaC5UZXh0V2lkZ2V0KHtcbiAgICAgIG1hcmtkb3duOiBsaW5lcy5qb2luKCdcXG4nKSxcbiAgICAgIHdpZHRoOiAyNCxcbiAgICAgIGhlaWdodCxcbiAgICB9KSk7XG5cbiAgICBzZWN0aW9uKDMsXG4gICAgICAnIyBHaXRIdWIgUnVubmVycycsXG4gICAgICAnRWFjaCBHaXRIdWIgQWN0aW9ucyBqb2IgdGhhdCBhc2tzIGZvciBhIHNlbGYtaG9zdGVkIHJ1bm5lciBzZW5kcyBhIHdlYmhvb2suIFdlIHN0YXJ0IGEgcnVubmVyIGZvciBpdCBmcm9tIHRoZSBwcm92aWRlciB0aGF0IG1hdGNoZXMgdGhlIGpvYiBsYWJlbHMuICcgK1xuICAgICAgJ1RoZSBydW5uZXIgcmVnaXN0ZXJzIHdpdGggR2l0SHViLCBydW5zIG9uZSBqb2IsIGFuZCBnb2VzIGF3YXkuJyxcbiAgICAgICcnLFxuICAgICAgJ0FsYXJtIG9uICoqUnVubmVycyBmYWlsZWQgdG8gc3RhcnQqKiwgKipMYW1iZGEgZXJyb3JzKiogYW5kICoqSm9icyBtYXRjaGluZyBtdWx0aXBsZSBwcm92aWRlcnMqKi4gJyArXG4gICAgICAnV2hlbiBhbnkgb2YgdGhlbSBpcyBvdmVyIHplcm8sIGpvYnMgbWF5IGJlIHdhaXRpbmcgZm9yIGEgcnVubmVyIHRoYXQgd2lsbCBuZXZlciBjb21lLiAnICtcbiAgICAgICdBbHNvIHN1YnNjcmliZSB0byBgZmFpbGVkSW1hZ2VCdWlsZHNUb3BpYygpYCBzbyB5b3Uga25vdyB3aGVuIHJ1bm5lciBpbWFnZXMgc3RvcCBnZXR0aW5nIHVwZGF0ZXMuJyxcbiAgICApO1xuXG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMobmV3IGNsb3Vkd2F0Y2guU2luZ2xlVmFsdWVXaWRnZXQoe1xuICAgICAgdGl0bGU6ICdTdW1tYXJ5JyxcbiAgICAgIG1ldHJpY3M6IFtcbiAgICAgICAgam9icygnU3VjY2VlZGVkJywgJ0pvYnMgc3VjY2VlZGVkJyksXG4gICAgICAgIGpvYnMoJ0ZhaWxlZCcsICdKb2JzIGZhaWxlZCcpLFxuICAgICAgICB0aGlzLm1ldHJpY0ZhaWxlZCh7IGxhYmVsOiAnUnVubmVycyBmYWlsZWQgdG8gc3RhcnQnIH0pLFxuICAgICAgICBzZWFyY2goJ1N0b2xlbiBydW5uZXJzJywgJ1N0b2xlblJ1bm5lcnMnKSxcbiAgICAgICAgdGhpcy5tZXRyaWNKb2JzTWF0Y2hpbmdNdWx0aXBsZVByb3ZpZGVycyh7IGxhYmVsOiAnSm9icyBtYXRjaGluZyBtdWx0aXBsZSBwcm92aWRlcnMnIH0pLFxuICAgICAgICBzZWFyY2goJ0lkbGUgcnVubmVycyBzdG9wcGVkJywgJ1N0b3BwZWRSdW5uZXJzJywgJ1JlYXNvbj1cIklkbGVSdW5uZXJcIicpLFxuICAgICAgICB0aGlzLm1ldHJpY0xhbWJkYUVycm9ycyh7IGxhYmVsOiAnTGFtYmRhIGVycm9ycycgfSksXG4gICAgICBdLFxuICAgICAgLy8gdG90YWxzIGZvciB0aGUgZGFzaGJvYXJkIHRpbWUgcmFuZ2UgaW5zdGVhZCBvZiBqdXN0IHRoZSBsYXN0IHBlcmlvZFxuICAgICAgc2V0UGVyaW9kVG9UaW1lUmFuZ2U6IHRydWUsXG4gICAgICB3aWR0aDogMjQsXG4gICAgICBoZWlnaHQ6IDUsXG4gICAgfSkpO1xuXG4gICAgc2VjdGlvbigyLFxuICAgICAgJyMjIEpvYnMnLFxuICAgICAgJ0pvYnMgdGhhdCByYW4gb24gb3VyIHJ1bm5lcnMsIGNvdW50ZWQgd2hlbiB0aGUgcnVubmVyIGZpbmlzaGVzIHRoZW0uIFRoZXNlIGFyZSB0aGUgcmVzdWx0cyB5b3VyIHVzZXJzIHNlZSBpbiBHaXRIdWIuICcgK1xuICAgICAgJ0EgZmFpbGVkIGpvYiBpcyB1c3VhbGx5IGEgcHJvYmxlbSBpbiB0aGUgd29ya2Zsb3csIG5vdCB0aGUgcnVubmVyLiBCdXQgaWYgb25lIHJ1bm5lciBsYWJlbCBmYWlscyBtdWNoIG1vcmUgdGhhbiB0aGUgb3RoZXJzLCAnICtcbiAgICAgICdpdHMgaW1hZ2UgbWF5IGJlIG1pc3Npbmcgc29tZXRoaW5nIHRoZSBqb2JzIG5lZWQuICoqQWJhbmRvbmVkKiogbWVhbnMgdGhlIHJ1bm5lciB3ZW50IGF3YXkgaW4gdGhlIG1pZGRsZSBvZiB0aGUgam9iLicsXG4gICAgKTtcblxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0pvYnMgY29tcGxldGVkIGJ5IHN0YXR1cycsXG4gICAgICAgIC8vIHN0YXR1cyBsaXN0IHRha2VuIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL2FjdGlvbnMvcnVubmVyL2Jsb2IvYmU5NjMyMzAyY2VlZjUwYmZiMzZlYTk5OGNlYTljOTRjNzVlNWQ0ZC9zcmMvU2RrL0RUV2ViQXBpL1dlYkFwaS9UYXNrUmVzdWx0LmNzXG4gICAgICAgIGxlZnQ6IFsnU3VjY2VlZGVkJywgJ1N1Y2NlZWRlZFdpdGhJc3N1ZXMnLCAnRmFpbGVkJywgJ0NhbmNlbGVkJywgJ1NraXBwZWQnLCAnQWJhbmRvbmVkJ10ubWFwKHMgPT4gam9icyhzLCBzKSksXG4gICAgICAgIHN0YWNrZWQ6IHRydWUsXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0ZhaWxlZCBqb2JzIGJ5IHJ1bm5lciBsYWJlbCcsXG4gICAgICAgIC8vIGEgc2VhcmNoIGV4cHJlc3Npb24gY2FuJ3QgYmUgbGFiZWxlZCBwZXIgcHJvdmlkZXIsIHNvIGxpc3QgdGhlIHByb3ZpZGVycyB0byBrZWVwIHRoZSBsZWdlbmQgcmVhZGFibGUuIHRoaXNcbiAgICAgICAgLy8gbWlzc2VzIGxhYmVscyBjb21pbmcgZnJvbSBhIGN1c3RvbSBwcm92aWRlclNlbGVjdG9yLCBidXQgXCJKb2JzIGNvbXBsZXRlZCBieSBzdGF0dXNcIiBzdGlsbCBjb3VudHMgdGhvc2UuXG4gICAgICAgIGxlZnQ6IFsuLi50aGlzLmV4dHJhY3RVbmlxdWVTdWJQcm92aWRlcnMoKV0ubWFwKHAgPT4gbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICBuYW1lc3BhY2U6ICdHaXRIdWJSdW5uZXJzJyxcbiAgICAgICAgICBtZXRyaWNOYW1lOiAnSm9iQ29tcGxldGVkJyxcbiAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgICBQcm92aWRlckxhYmVsczogcC5sYWJlbHMuam9pbignLCcpLFxuICAgICAgICAgICAgU3RhdHVzOiAnRmFpbGVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGxhYmVsOiBwLmxhYmVscy5qb2luKCcsICcpLFxuICAgICAgICAgIHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5TVU0sXG4gICAgICAgIH0pKSxcbiAgICAgICAgc3RhY2tlZDogdHJ1ZSxcbiAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIHNlY3Rpb24oMyxcbiAgICAgICcjIyBSdW5uZXJzJyxcbiAgICAgICdFdmVyeSBydW5uZXIgd2Ugc3RhcnQgaXMgb25lIHN0ZXAgZnVuY3Rpb24gZXhlY3V0aW9uLiAqKlN1Y2NlZWRlZCoqIG1lYW5zIHRoZSBydW5uZXIgc3RhcnRlZCwgcmFuIGFuZCBleGl0ZWQuICcgK1xuICAgICAgJyoqRmFpbGVkKiogbWVhbnMgaXQgbmV2ZXIgbWFuYWdlZCB0byBzdGFydCwgc28gdGhlIGpvYiBpdCB3YXMgc3RhcnRlZCBmb3IgbWF5IHdhaXQgdW50aWwgR2l0SHViIGdpdmVzIHVwIG9uIGl0LiAnICtcbiAgICAgICdBbGFybSBvbiBmYWlsZWQuICoqUmVjZW50IGZhaWxlZCBhdHRlbXB0cyoqIGJlbG93IHNob3dzIHdoeS4gJyArXG4gICAgICAnKipBYm9ydGVkKiogcnVubmVycyB3ZXJlIHN0b3BwZWQgb24gcHVycG9zZSBhbmQgYXJlIGV4cGxhaW5lZCBpbiB0aGUgbmV4dCBzZWN0aW9uLicsXG4gICAgICAnJyxcbiAgICAgICcqKlJ1bm5lciB0aW1lKiogaW5jbHVkZXMgc3RhcnQtdXAsIHNvIGl0XFwncyBjbG9zZSB0byB3aGF0IHlvdSBwYXkgZm9yIGVhY2ggcnVubmVyLiBBIGp1bXAgdXN1YWxseSBtZWFucyBzbG93ZXIgc3RhcnQtdXBzIG9yIGxvbmdlciBqb2JzLicsXG4gICAgKTtcblxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1J1bm5lciBleGVjdXRpb25zJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIHRoaXMubWV0cmljU3VjY2VlZGVkKHsgbGFiZWw6ICdTdWNjZWVkZWQnIH0pLFxuICAgICAgICAgIHRoaXMubWV0cmljRmFpbGVkKHsgbGFiZWw6ICdGYWlsZWQnIH0pLFxuICAgICAgICAgIHRoaXMub3JjaGVzdHJhdG9yLm1ldHJpY1RpbWVkT3V0KHsgbGFiZWw6ICdUaW1lZCBvdXQnIH0pLFxuICAgICAgICAgIC8vIHN0b3BwZWQgb24gcHVycG9zZSwgc2VlIFwiU3RvcHBlZCBydW5uZXJzIGJ5IHJlYXNvblwiXG4gICAgICAgICAgdGhpcy5vcmNoZXN0cmF0b3IubWV0cmljQWJvcnRlZCh7IGxhYmVsOiAnQWJvcnRlZCcgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHN0YWNrZWQ6IHRydWUsXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1J1bm5lciB0aW1lIChpbmNsdWRpbmcgc3RhcnQtdXApJyxcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIHRoaXMubWV0cmljVGltZSh7IHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5wKDUwKSwgbGFiZWw6ICdwNTAnIH0pLFxuICAgICAgICAgIHRoaXMubWV0cmljVGltZSh7IHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5wKDkwKSwgbGFiZWw6ICdwOTAnIH0pLFxuICAgICAgICAgIHRoaXMubWV0cmljVGltZSh7IHN0YXRpc3RpYzogY2xvdWR3YXRjaC5TdGF0cy5NQVhJTVVNLCBsYWJlbDogJ21heCcgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBkYXNoYm9hcmQuYWRkV2lkZ2V0cyhuZXcgY2xvdWR3YXRjaC5Mb2dRdWVyeVdpZGdldCh7XG4gICAgICB0aXRsZTogJ1JlY2VudCBmYWlsZWQgYXR0ZW1wdHMnLFxuICAgICAgbG9nR3JvdXBOYW1lczogW3NpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKS5sb2dHcm91cE5hbWVdLFxuICAgICAgdmlldzogY2xvdWR3YXRjaC5Mb2dRdWVyeVZpc3VhbGl6YXRpb25UeXBlLlRBQkxFLFxuICAgICAgcXVlcnlTdHJpbmc6IG5ldyBsb2dzLlF1ZXJ5U3RyaW5nKHtcbiAgICAgICAgLy8gbG9nZ2VkIGJ5IHRoZSBjbGVhbi11cCBmdW5jdGlvbiwgd2hpY2ggZXZlcnkgZmFpbGVkIGF0dGVtcHQgZ29lcyB0aHJvdWdoLiByZXRyaWVzIGFuZCBmYWxsYmFja3MgZmFpbCBtb3JlXG4gICAgICAgIC8vIHRoYW4gb25jZSwgc28gYSBydW5uZXIgY2FuIHNob3cgdXAgaGVyZSBtYW55IHRpbWVzIGJlZm9yZSBpdCBzdGFydHMgb3IgZ2l2ZXMgdXAuXG4gICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICdAdGltZXN0YW1wJyxcbiAgICAgICAgICAnbWVzc2FnZS5lcnJvci5FcnJvciBhcyBlcnJvcicsXG4gICAgICAgICAgJ21lc3NhZ2UuZmFtaWx5IGFzIGZhbWlseScsXG4gICAgICAgICAgJ21lc3NhZ2UucnVubmVyTmFtZSBhcyBydW5uZXInLFxuICAgICAgICAgICdtZXNzYWdlLnJlcG8gYXMgcmVwbycsXG4gICAgICAgICAgJ21lc3NhZ2UuZXJyb3IuQ2F1c2UgYXMgY2F1c2UnLFxuICAgICAgICBdLFxuICAgICAgICBmaWx0ZXJTdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgJ21lc3NhZ2Uubm90aWNlID0gXCJSdW5uZXIgZmFpbGVkXCInLFxuICAgICAgICBdLFxuICAgICAgICBzb3J0OiAnQHRpbWVzdGFtcCBkZXNjJyxcbiAgICAgICAgbGltaXQ6IDIwLFxuICAgICAgfSkudG9TdHJpbmcoKSxcbiAgICAgIHdpZHRoOiAyNCxcbiAgICAgIGhlaWdodDogNixcbiAgICB9KSk7XG5cbiAgICBzZWN0aW9uKDUsXG4gICAgICAnIyMgUnVubmVyIGFzc2lnbm1lbnQnLFxuICAgICAgJ1dlIHN0YXJ0IGVhY2ggcnVubmVyIGZvciBhIHNwZWNpZmljIGpvYiwgYnV0IEdpdEh1YiBjYW4gZ2l2ZSBpdCB0byBhbnkgcXVldWVkIGpvYiB3aXRoIG1hdGNoaW5nIGxhYmVscy4gJyArXG4gICAgICAnV2hlbiB0d28gb2Ygb3VyIGpvYnMgc3dhcCBydW5uZXJzLCBub3RoaW5nIGlzIGxvc3QgYW5kIG5vdGhpbmcgaXMgY291bnRlZCBoZXJlLicsXG4gICAgICAnJyxcbiAgICAgICcqKlN0b2xlbiBydW5uZXJzKiogd2VyZSB0YWtlbiBieSBhIGpvYiB0aGF0IGxlZnQgdGhlIGpvYiB0aGV5IHdlcmUgc3RhcnRlZCBmb3Igd2l0aG91dCBhIHJ1bm5lci4gVGhhdFxcJ3MgYSBqb2Igd2UgZGlkblxcJ3Qgc3RhcnQgJyArXG4gICAgICAnYSBydW5uZXIgZm9yLCBsaWtlIG9uZSBmcm9tIGEgcmVwb3NpdG9yeSB3ZSBkb25cXCd0IHNlcnZlLCBvciBvbmUgd2hvc2Ugb3duIHJ1bm5lciBjYW5cXCd0IHJ1biB0aGUgam9iIGxlZnQgYmVoaW5kLiAnICtcbiAgICAgICdXZSBzdGFydCBhIHJlcGxhY2VtZW50IGZvciBlYWNoLiAqKk5vdCByZXBsYWNlZCoqIG1lYW5zIHRoZSBzYW1lIGpvYiBsb3N0IGl0cyBydW5uZXIgdG9vIG1hbnkgdGltZXMgaW4gYSByb3cgYW5kIG1heSB3YWl0IGZvcmV2ZXIuICcgK1xuICAgICAgJ1VzZSB0aGUgXCJTdG9sZW4gcnVubmVyc1wiIExvZ3MgSW5zaWdodHMgcXVlcnkgdG8gc2VlIHdobyB0b29rIHRoZW0uJyxcbiAgICAgICcnLFxuICAgICAgJyoqSm9icyBtYXRjaGluZyBtdWx0aXBsZSBwcm92aWRlcnMqKiBhc2sgZm9yIHRvbyBmZXcgbGFiZWxzLCBzbyB0aGV5IG1heSBydW4gb24gYSBwcm92aWRlciB5b3UgZGlkblxcJ3QgZXhwZWN0IGFuZCB0YWtlIHJ1bm5lcnMgZnJvbSBvdGhlciBqb2JzLiAnICtcbiAgICAgICdBZGQgbGFiZWxzIHRvIHRob3NlIGpvYnMuIFVzZSB0aGUgXCJKb2JzIG1hdGNoaW5nIG11bHRpcGxlIHByb3ZpZGVyc1wiIExvZ3MgSW5zaWdodHMgcXVlcnkgdG8gZmluZCB0aGVtIGFuZCB0aGUgcHJvdmlkZXJzIHRoZXkgbWF0Y2hlZC4gJyArXG4gICAgICAnQm90aCBxdWVyaWVzIGFyZSBjcmVhdGVkIGJ5IGBjcmVhdGVMb2dzSW5zaWdodHNRdWVyaWVzKClgLicsXG4gICAgICAnJyxcbiAgICAgICcqKklkbGUgcnVubmVycyBzdG9wcGVkKiogbmV2ZXIgZ290IGEgam9iIGJlZm9yZSB0aGVpciBpZGxlIHRpbWVvdXQuIFRoZXNlIGFyZSB1c3VhbGx5IHJ1bm5lcnMgc3RhcnRlZCBmb3Igam9icyB0aGF0IHdlcmUgY2FuY2VsZWQgYmVmb3JlICcgK1xuICAgICAgJ3RoZSBydW5uZXIgd2FzIHJlYWR5LCBvciB0aGUgZXh0cmEgcnVubmVyIGxlZnQgb3ZlciBhZnRlciBhIHN0b2xlbiBydW5uZXIgd2FzIHJlcGxhY2VkLicsXG4gICAgICAnJyxcbiAgICAgICdZb3Ugc2hvdWxkblxcJ3Qgc2VlIGJpZyBudW1iZXJzIGZvciBhbnkgb2YgdGhlc2UuIEVhY2ggb25lIGlzIGEgcnVubmVyIHRoYXQgd2FzIHN0YXJ0ZWQgZm9yIG5vdGhpbmcsIHNvIHlvdVxcJ3JlIHdhc3RpbmcgcmVzb3VyY2VzLiAnICtcbiAgICAgICdTdG9sZW4gcnVubmVycyBhbmQgam9icyBtYXRjaGluZyBtdWx0aXBsZSBwcm92aWRlcnMgbWF5IGFsc28gbGVhdmUgam9icyBoYW5naW5nLicsXG4gICAgKTtcblxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1N0b2xlbiBydW5uZXJzJyxcbiAgICAgICAgLy8gbm90IHJlcGxhY2VkIG1lYW5zIHRoZSByZXBsYWNlbWVudCBsaW1pdCB3YXMgaGl0LCBzbyB0aGUgam9iIG1heSBiZSBsZWZ0IHdpdGhvdXQgYSBydW5uZXJcbiAgICAgICAgbGVmdDogW1xuICAgICAgICAgIHNlYXJjaCgnUmVwbGFjZWQnLCAnU3RvbGVuUnVubmVycycsICdSZXBsYWNlZD1cInRydWVcIicpLFxuICAgICAgICAgIHNlYXJjaCgnTm90IHJlcGxhY2VkJywgJ1N0b2xlblJ1bm5lcnMnLCAnUmVwbGFjZWQ9XCJmYWxzZVwiJyksXG4gICAgICAgIF0sXG4gICAgICAgIHN0YWNrZWQ6IHRydWUsXG4gICAgICAgIHdpZHRoOiA4LFxuICAgICAgfSksXG4gICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgIHRpdGxlOiAnSm9icyBtYXRjaGluZyBtdWx0aXBsZSBwcm92aWRlcnMnLFxuICAgICAgICBsZWZ0OiBbdGhpcy5tZXRyaWNKb2JzTWF0Y2hpbmdNdWx0aXBsZVByb3ZpZGVycyh7IGxhYmVsOiAnSm9icycgfSldLFxuICAgICAgICB3aWR0aDogOCxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1N0b3BwZWQgcnVubmVycyBieSByZWFzb24nLFxuICAgICAgICAvLyB0aGVzZSBleGVjdXRpb25zIGFyZSBhYm9ydGVkIG9uIHB1cnBvc2UsIHNvIHRoZXkncmUgbm90IGNvdW50ZWQgYXMgZmFpbGVkLiBzZWUgbWV0cmljU3RvcHBlZFJ1bm5lcnMoKSBmb3Igd2hhdCBlYWNoIHJlYXNvbiBtZWFuc1xuICAgICAgICBsZWZ0OiBbJ0lkbGVSdW5uZXInLCAnU3RhbGVXYXJtUnVubmVyJywgJ1dhcm1SdW5uZXJFeHBpcmVkJywgJ1dhcm1SdW5uZXJCYWREZWFkbGluZSddXG4gICAgICAgICAgLm1hcChyID0+IHNlYXJjaChyLCAnU3RvcHBlZFJ1bm5lcnMnLCBgUmVhc29uPVwiJHtyfVwiYCkpLFxuICAgICAgICBzdGFja2VkOiB0cnVlLFxuICAgICAgICB3aWR0aDogOCxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBzZWN0aW9uKDMsXG4gICAgICAnIyMgTWFuYWdlbWVudCBmdW5jdGlvbnMgKG9yY2hlc3RyYXRpb24pJyxcbiAgICAgICdUaGUgTGFtYmRhIGZ1bmN0aW9ucyB0aGF0IG9yY2hlc3RyYXRlIHJ1bm5lcnM6IHRoZXkgcmVjZWl2ZSB3ZWJob29rcywgc3RhcnQgcnVubmVycywgc3RvcCBpZGxlIHJ1bm5lcnMgYW5kIHJlcGxhY2Ugc3RvbGVuIG9uZXMuICcgK1xuICAgICAgJ1RoZWlyIGxvZ3MgYXJlIGluIHRoZSBvcmNoZXN0cmF0b3IgbG9nIGdyb3VwLCBhbmQgdGhlIFwiT3JjaGVzdHJhdGlvbiBlcnJvcnNcIiBMb2dzIEluc2lnaHRzIHF1ZXJ5IGZpbmRzIHRoZWlyIGVycm9ycy4gJyArXG4gICAgICAnSWYgam9icyBhcmUgcXVldWVkIGFuZCB0aGUgd2ViaG9vayBnZXRzIG5vIHJlcXVlc3RzLCBHaXRIdWIgaXNuXFwndCByZWFjaGluZyBpdC4gQ2hlY2sgdGhlIHdlYmhvb2sgZGVsaXZlcmllcyBvZiB5b3VyIEdpdEh1YiBhcHAuICcgK1xuICAgICAgJyoqTGFtYmRhIGVycm9ycyoqIG92ZXIgemVybyBtZWFucyBqb2JzIG1heSBub3QgZ2V0IGEgcnVubmVyLiBBbGFybSBvbiBpdCwgYW5kIHNlZSAqKlJlY2VudCBlcnJvcnMqKiBiZWxvdyBmb3Igd2hhdCB3ZW50IHdyb25nLicsXG4gICAgKTtcblxuICAgIGRhc2hib2FyZC5hZGRXaWRnZXRzKFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ1dlYmhvb2snLFxuICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgdGhpcy53ZWJob29rLmhhbmRsZXIubWV0cmljSW52b2NhdGlvbnMoeyBsYWJlbDogJ1JlcXVlc3RzJyB9KSxcbiAgICAgICAgICB0aGlzLndlYmhvb2suaGFuZGxlci5tZXRyaWNFcnJvcnMoeyBsYWJlbDogJ0Vycm9ycycgfSksXG4gICAgICAgIF0sXG4gICAgICAgIHdpZHRoOiAxMixcbiAgICAgIH0pLFxuICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICB0aXRsZTogJ0xhbWJkYSBlcnJvcnMnLFxuICAgICAgICAvLyBvbmUgc2VyaWVzIHBlciBmdW5jdGlvbiwgc28gYSBzcGlrZSBwb2ludHMgYXQgdGhlIGZ1bmN0aW9uIHRoYXQgbmVlZHMgbG9va2luZyBhdFxuICAgICAgICBsZWZ0OiB0aGlzLm1hbmFnZW1lbnRGdW5jdGlvbnMubWFwKGYgPT4gZi5tZXRyaWNFcnJvcnMoe1xuICAgICAgICAgIGxhYmVsOiBmLm5vZGUucGF0aC5zbGljZSh0aGlzLm5vZGUucGF0aC5sZW5ndGggKyAxKSxcbiAgICAgICAgfSkpLFxuICAgICAgICBzdGFja2VkOiB0cnVlLFxuICAgICAgICB3aWR0aDogMTIsXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgLy8gdGhlIG9yY2hlc3RyYXRvciwgd2ViaG9vayBhbmQgcnVubmVyIG1hbmFnZW1lbnQgZnVuY3Rpb25zIGxvZyBoZXJlLCBzZXR1cCBhbmQgc3RhdHVzIGxvZyBzZXBhcmF0ZWx5XG4gICAgZGFzaGJvYXJkLmFkZFdpZGdldHMobmV3IGNsb3Vkd2F0Y2guTG9nUXVlcnlXaWRnZXQoe1xuICAgICAgdGl0bGU6ICdSZWNlbnQgZXJyb3JzJyxcbiAgICAgIGxvZ0dyb3VwTmFtZXM6IFtcbiAgICAgICAgc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5PUkNIRVNUUkFUT1IpLmxvZ0dyb3VwTmFtZSxcbiAgICAgICAgc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5TRVRVUCkubG9nR3JvdXBOYW1lLFxuICAgICAgXSxcbiAgICAgIHZpZXc6IGNsb3Vkd2F0Y2guTG9nUXVlcnlWaXN1YWxpemF0aW9uVHlwZS5UQUJMRSxcbiAgICAgIHF1ZXJ5U3RyaW5nOiBuZXcgbG9ncy5RdWVyeVN0cmluZyh7XG4gICAgICAgIC8vIHdlIGxvZyBKU09OLCBzbyBgbWVzc2FnZWAgaXMgYW4gb2JqZWN0IGFuZCBzaG93cyB1cCBhcyBhbiBlbXB0eSBjb2x1bW4uIHBpY2sgb3V0IHRoZSBodW1hbiByZWFkYWJsZSBwYXJ0IG9mXG4gICAgICAgIC8vIHRoZSBlcnJvcnMgd2UgbG9nIG91cnNlbHZlcyBhbmQgb2YgdGhlIG9uZXMgTGFtYmRhIGxvZ3MgZm9yIHVzLCBhbmQga2VlcCB0aGUgcmF3IHJlY29yZCBmb3IgdGhlIGRldGFpbHMuXG4gICAgICAgIGZpZWxkczogW1xuICAgICAgICAgICdAdGltZXN0YW1wJyxcbiAgICAgICAgICAnQGxvZ1N0cmVhbScsXG4gICAgICAgICAgJ2NvYWxlc2NlKG1lc3NhZ2Uubm90aWNlLCBtZXNzYWdlLmVycm9yTWVzc2FnZSwgbWVzc2FnZS5uYW1lKSBhcyBlcnJvcicsXG4gICAgICAgICAgJ0BtZXNzYWdlJyxcbiAgICAgICAgXSxcbiAgICAgICAgZmlsdGVyU3RhdGVtZW50czogW1xuICAgICAgICAgICdsZXZlbCA9IFwiRVJST1JcIicsXG4gICAgICAgIF0sXG4gICAgICAgIHNvcnQ6ICdAdGltZXN0YW1wIGRlc2MnLFxuICAgICAgICBsaW1pdDogMjAsXG4gICAgICB9KS50b1N0cmluZygpLFxuICAgICAgd2lkdGg6IDI0LFxuICAgICAgaGVpZ2h0OiA2LFxuICAgIH0pKTtcblxuICAgIHJldHVybiBkYXNoYm9hcmQ7XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYSB3YXJtIHJ1bm5lciBjb25maWcgaGFzaC4gQWxsIHJlZ2lzdGVyZWQgaGFzaGVzIGFyZSBwYXNzZWQgdG8gdGhlXG4gICAqIG1hbmFnZXIgTGFtYmRhIHZpYSBXQVJNX0NPTkZJR19IQVNIRVMgZW52IHZhciBzbyBrZWVwZXJzIGNhbiBkZXRlY3Qgc3RhbGUgY29uZmlncy5cbiAgICogVGhlIGxvbmdlc3QgZHVyYXRpb24gaXMgcGFzc2VkIHZpYSBXQVJNX01BWF9EVVJBVElPTl9TRUNPTkRTIHNvIGtlZXBlcnMgY2FuIHJlamVjdCBib2d1cyBkZWFkbGluZXMuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHVibGljIF9yZWdpc3Rlcldhcm1Db25maWdIYXNoKGhhc2g6IHN0cmluZywgZHVyYXRpb246IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMud2FybUNvbmZpZ0hhc2hlcy5wdXNoKGhhc2gpO1xuICAgIHRoaXMud2FybU1heER1cmF0aW9uID0gTWF0aC5tYXgodGhpcy53YXJtTWF4RHVyYXRpb24sIGR1cmF0aW9uKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYXppbHkgY3JlYXRlIHNoYXJlZCB3YXJtIHJ1bm5lciBpbmZyYXN0cnVjdHVyZSAoTGFtYmRhLCBTUVMgcXVldWUpLlxuICAgKiBSZXR1cm5zIHRoZSBtYW5hZ2VyIExhbWJkYSBhbmQgcXVldWUgZm9yIHVzZSBhcyBFdmVudEJyaWRnZSB0YXJnZXRzLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyBfZW5zdXJlV2FybVJ1bm5lckluZnJhKCk6IHsgbGFtYmRhOiBsYW1iZGEuRnVuY3Rpb247IHF1ZXVlOiBzcXMuUXVldWUgfSB7XG4gICAgaWYgKHRoaXMud2FybVJ1bm5lck1hbmFnZXIgJiYgdGhpcy53YXJtUnVubmVyUXVldWUpIHtcbiAgICAgIHJldHVybiB7IGxhbWJkYTogdGhpcy53YXJtUnVubmVyTWFuYWdlciwgcXVldWU6IHRoaXMud2FybVJ1bm5lclF1ZXVlIH07XG4gICAgfVxuXG4gICAgdGhpcy53YXJtUnVubmVyUXVldWUgPSBuZXcgc3FzLlF1ZXVlKHRoaXMsICdXYXJtIFJ1bm5lciBRdWV1ZScsIHtcbiAgICAgIHZpc2liaWxpdHlUaW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcygxKSxcbiAgICB9KTtcblxuICAgIHRoaXMud2FybVJ1bm5lck1hbmFnZXIgPSBuZXcgV2FybVJ1bm5lck1hbmFnZXJGdW5jdGlvbih0aGlzLCAnV2FybSBSdW5uZXIgTWFuYWdlcicsIHtcbiAgICAgIGRlc2NyaXB0aW9uOiAnTWFuYWdlIHdhcm0gR2l0SHViIHJ1bm5lcnM6IGZpbGwgb24gaW52b2tlLCBrZWVwIGFsaXZlIHZpYSBTUVMnLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgR0lUSFVCX1NFQ1JFVF9BUk46IHRoaXMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICBHSVRIVUJfUFJJVkFURV9LRVlfU0VDUkVUX0FSTjogdGhpcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICBTVEVQX0ZVTkNUSU9OX0FSTjogdGhpcy5vcmNoZXN0cmF0b3Iuc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgICBXQVJNX1JVTk5FUl9RVUVVRV9VUkw6IHRoaXMud2FybVJ1bm5lclF1ZXVlLnF1ZXVlVXJsLFxuICAgICAgICBXQVJNX0NPTkZJR19IQVNIRVM6IGNkay5MYXp5LnN0cmluZyh7IHByb2R1Y2U6ICgpID0+IHRoaXMud2FybUNvbmZpZ0hhc2hlcy5qb2luKCcsJykgfSksXG4gICAgICAgIFdBUk1fTUFYX0RVUkFUSU9OX1NFQ09ORFM6IGNkay5MYXp5LnN0cmluZyh7IHByb2R1Y2U6ICgpID0+IHRoaXMud2FybU1heER1cmF0aW9uLnRvU3RyaW5nKCkgfSksXG4gICAgICAgIC4uLnRoaXMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNTApLFxuICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKSxcbiAgICAgIGxvZ2dpbmdGb3JtYXQ6IGxhbWJkYS5Mb2dnaW5nRm9ybWF0LkpTT04sXG4gICAgICAvLyBrZWVwZXIgbWVzc2FnZXMgZW5xdWV1ZSB0aGVpciBvd24gcmVwbGFjZW1lbnQsIHNvIGEgYnVzeSBydW5uZXIgc2xvdCBpcyBhbiBpbnRlbnRpb25hbCBMYW1iZGEgLT4gU1FTIC0+IExhbWJkYSBjaGFpblxuICAgICAgLy8gaXQncyBib3VuZGVkIGJ5IHRoZSBhYnNvbHV0ZSBkZWFkbGluZSBhbmQgcmF0ZSBsaW1pdGVkIGJ5IHRoZSBrZWVwZXIsIHNvIEFXUyByZWN1cnNpb24gZGV0ZWN0aW9uIGlzIG5vdCBuZWVkZWRcbiAgICAgIHJlY3Vyc2l2ZUxvb3A6IGxhbWJkYS5SZWN1cnNpdmVMb29wLkFMTE9XLFxuICAgICAgLi4udGhpcy5leHRyYUxhbWJkYVByb3BzLFxuICAgIH0pO1xuXG4gICAgdGhpcy5tYW5hZ2VtZW50RnVuY3Rpb25zLnB1c2godGhpcy53YXJtUnVubmVyTWFuYWdlcik7XG5cbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViLmdyYW50UmVhZCh0aGlzLndhcm1SdW5uZXJNYW5hZ2VyKTtcbiAgICB0aGlzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFJlYWQodGhpcy53YXJtUnVubmVyTWFuYWdlcik7XG4gICAgdGhpcy5vcmNoZXN0cmF0b3IuZ3JhbnRSZWFkKHRoaXMud2FybVJ1bm5lck1hbmFnZXIpO1xuICAgIHRoaXMub3JjaGVzdHJhdG9yLmdyYW50U3RhcnRFeGVjdXRpb24odGhpcy53YXJtUnVubmVyTWFuYWdlcik7XG4gICAgdGhpcy5vcmNoZXN0cmF0b3IuZ3JhbnRFeGVjdXRpb24odGhpcy53YXJtUnVubmVyTWFuYWdlciwgJ3N0YXRlczpTdG9wRXhlY3V0aW9uJyk7XG5cbiAgICB0aGlzLndhcm1SdW5uZXJNYW5hZ2VyLmFkZEV2ZW50U291cmNlKG5ldyBsYW1iZGFfZXZlbnRfc291cmNlcy5TcXNFdmVudFNvdXJjZSh0aGlzLndhcm1SdW5uZXJRdWV1ZSwge1xuICAgICAgcmVwb3J0QmF0Y2hJdGVtRmFpbHVyZXM6IHRydWUsXG4gICAgICBtYXhCYXRjaGluZ1dpbmRvdzogY2RrLkR1cmF0aW9uLnNlY29uZHMoMTApLFxuICAgICAgYmF0Y2hTaXplOiAxMCxcbiAgICB9KSk7XG4gICAgdGhpcy53YXJtUnVubmVyUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXModGhpcy53YXJtUnVubmVyTWFuYWdlcik7XG5cbiAgICByZXR1cm4geyBsYW1iZGE6IHRoaXMud2FybVJ1bm5lck1hbmFnZXIsIHF1ZXVlOiB0aGlzLndhcm1SdW5uZXJRdWV1ZSB9O1xuICB9XG59XG4iXX0=