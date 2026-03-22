import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
/**
 * Props for UpdateLambdaFunction
 */
export interface UpdateLambdaFunctionProps extends lambda.FunctionOptions {
    /**
     * The Lambda runtime to use.
     * @default - Latest Node.js runtime available in the deployment region
     */
    readonly runtime?: lambda.Runtime;
}
/**
 * An AWS Lambda function which executes src/providers/update-lambda.
 */
export declare class UpdateLambdaFunction extends lambda.Function {
    constructor(scope: Construct, id: string, props?: UpdateLambdaFunctionProps);
}
