export interface StepFunctionLambdaInput {
    readonly owner: string;
    readonly repo: string;
    readonly runnerName: string;
    readonly installationId?: number;
    readonly labels: string[];
    readonly jobId?: number;
    readonly error?: {
        readonly Error: string;
        readonly Cause: string;
    };
}
export declare function getSecretValue(arn: string | undefined): Promise<string>;
export declare function getSecretJsonValue(arn: string | undefined): Promise<any>;
export declare function updateSecretValue(arn: string | undefined, value: string): Promise<void>;
export declare function customResourceRespond(event: AWSLambda.CloudFormationCustomResourceEvent, responseStatus: string, reason: string, physicalResourceId: string, data: any): Promise<unknown>;
