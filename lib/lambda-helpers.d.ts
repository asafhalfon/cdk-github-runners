export interface StepFunctionLambdaInput {
    readonly owner: string;
    readonly repo: string;
    readonly runnerName: string;
    readonly installationId?: number;
}
/**
 * Error for problems that can only be fixed by changing the configuration, either in CDK or on GitHub. They all share
 * one error name so the step function immediately shows this isn't capacity or a flaky API, and the message says what
 * to fix. We still retry them, so a configuration fixed within the 24 hours GitHub queues a job still gets a runner.
 *
 * @internal
 */
export declare class RunnerConfigurationError extends Error {
    constructor(msg: string);
}
export declare function getSecretValue(arn: string | undefined): Promise<string>;
export declare function getSecretJsonValue(arn: string | undefined): Promise<any>;
export declare function updateSecretValue(arn: string | undefined, value: string): Promise<void>;
export declare function customResourceRespond(event: AWSLambda.CloudFormationCustomResourceEvent, responseStatus: string, reason: string, physicalResourceId: string, data: any): Promise<unknown>;
