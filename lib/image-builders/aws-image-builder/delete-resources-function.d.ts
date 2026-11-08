import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
/**
 * Props for DeleteResourcesFunction
 */
export interface DeleteResourcesFunctionProps extends lambda.FunctionOptions {
    /**
     * The Lambda runtime to use.
     * @default - Latest Node.js runtime available in the deployment region
     */
    readonly runtime?: lambda.Runtime;
}
/**
 * An AWS Lambda function which executes src/image-builders/aws-image-builder/delete-resources.
 */
export declare class DeleteResourcesFunction extends lambda.Function {
    constructor(scope: Construct, id: string, props?: DeleteResourcesFunctionProps);
}
