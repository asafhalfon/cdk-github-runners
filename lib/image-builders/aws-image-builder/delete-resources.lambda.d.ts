import * as AWSLambda from 'aws-lambda';
/**
 * @internal
 */
export interface DeleteResourcesProps {
    ServiceToken: string;
    ImageVersionArn: string;
}
export declare function handler(event: AWSLambda.CloudFormationCustomResourceEvent, _context: AWSLambda.Context): Promise<void>;
