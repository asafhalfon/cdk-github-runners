import * as AWSLambda from 'aws-lambda';
/**
 * @internal
 */
export interface BuildImageFunctionProperties {
    ServiceToken: string;
    RepoName: string;
    ProjectName: string;
    WaitHandle: string;
}
export declare function handler(event: AWSLambda.CloudFormationCustomResourceEvent, context: AWSLambda.Context): Promise<void>;
