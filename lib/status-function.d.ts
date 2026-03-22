import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
/**
 * Props for StatusFunction
 */
export interface StatusFunctionProps extends lambda.FunctionOptions {
    /**
     * The Lambda runtime to use.
     * @default - Latest Node.js runtime available in the deployment region
     */
    readonly runtime?: lambda.Runtime;
}
/**
 * An AWS Lambda function which executes src/status.
 */
export declare class StatusFunction extends lambda.Function {
    constructor(scope: Construct, id: string, props?: StatusFunctionProps);
}
