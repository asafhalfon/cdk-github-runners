import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
/**
 * Props for SetupFunction
 */
export interface SetupFunctionProps extends lambda.FunctionOptions {
    /**
     * The Lambda runtime to use.
     * @default - Latest Node.js runtime available in the deployment region
     */
    readonly runtime?: lambda.Runtime;
}
/**
 * An AWS Lambda function which executes src/setup.
 */
export declare class SetupFunction extends lambda.Function {
    constructor(scope: Construct, id: string, props?: SetupFunctionProps);
}
