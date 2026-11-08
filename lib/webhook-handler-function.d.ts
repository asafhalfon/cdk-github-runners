import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
/**
 * Props for WebhookHandlerFunction
 */
export interface WebhookHandlerFunctionProps extends lambda.FunctionOptions {
    /**
     * The Lambda runtime to use.
     * @default - Latest Node.js runtime available in the deployment region
     */
    readonly runtime?: lambda.Runtime;
}
/**
 * An AWS Lambda function which executes src/webhook-handler.
 */
export declare class WebhookHandlerFunction extends lambda.Function {
    constructor(scope: Construct, id: string, props?: WebhookHandlerFunctionProps);
}
