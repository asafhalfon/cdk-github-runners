import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
/**
 * Props for FilterFailedBuildsFunction
 */
export interface FilterFailedBuildsFunctionProps extends lambda.FunctionOptions {
    /**
     * The Lambda runtime to use.
     * @default - Latest Node.js runtime available in the deployment region
     */
    readonly runtime?: lambda.Runtime;
}
/**
 * An AWS Lambda function which executes src/image-builders/aws-image-builder/filter-failed-builds.
 */
export declare class FilterFailedBuildsFunction extends lambda.Function {
    constructor(scope: Construct, id: string, props?: FilterFailedBuildsFunctionProps);
}
