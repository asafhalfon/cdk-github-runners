import { aws_dynamodb as dynamodb, aws_lambda as lambda, aws_logs as logs, aws_sqs as sqs, aws_stepfunctions as stepfunctions } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Secrets } from './secrets';
import { StolenRunnerHandlerFunction } from './stolen-runner-handler-function';
/**
 * Properties for StolenRunnerDetector.
 *
 * @internal
 */
export interface StolenRunnerDetectorProps {
    /**
     * Secrets used to communicate with GitHub.
     */
    readonly secrets: Secrets;
    /**
     * Step function that starts runners. Used to start replacement runners and to know when runners are done.
     */
    readonly orchestrator: stepfunctions.StateMachine;
    /**
     * Log groups the runners write to. Runners report which job landed on them, and this is where those reports come out.
     */
    readonly runnerLogGroups: logs.ILogGroup[];
    /**
     * Additional Lambda function options (VPC, security groups, layers, etc.).
     */
    readonly extraLambdaProps?: lambda.FunctionOptions;
    /**
     * Additional environment variables for the Lambda function.
     */
    readonly extraLambdaEnv?: {
        [key: string]: string;
    };
}
/**
 * Remembers which jobs we start runners for, listens to runners reporting the jobs they pick up, and starts
 * another runner whenever one of ours runs a job we didn't start a runner for.
 *
 * We collect a set of jobs we started runners for.
 * Then for each job a runner picks up, we check if it was in that set.
 * If it wasn't in that set, the runner was stolen.
 * We start a new runner of the exact same type if it was stolen.
 *
 * @internal
 */
export declare class StolenRunnerDetector extends Construct {
    /**
     * DynamoDB table holding the jobs we started runners for. Has TTL so data doesn't live here forever.
     */
    readonly table: dynamodb.Table;
    /**
     * Queue of runner reports waiting to be checked.
     */
    readonly queue: sqs.Queue;
    /**
     * Function that checks assignments and starts replacement runners.
     */
    readonly handler: StolenRunnerHandlerFunction;
    private readonly ttlSeconds;
    constructor(scope: Construct, id: string, props: StolenRunnerDetectorProps);
    grantRecordRunners(func: lambda.Function): void;
}
