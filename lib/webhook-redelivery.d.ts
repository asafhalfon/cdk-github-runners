import { aws_lambda as lambda } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Secrets } from './secrets';
import { WebhookRedeliveryFunction } from './webhook-redelivery-function';
/**
 * Properties for GithubWebhookRedelivery
 *
 * @internal
 */
export interface GithubWebhookRedeliveryProps {
    /**
     * Secrets used to communicate with GitHub.
     */
    readonly secrets: Secrets;
    /**
     * Additional Lambda function options (VPC, security groups, layers, etc.).
     */
    readonly extraLambdaProps?: lambda.FunctionOptions;
    /**
     * Additional environment variables for the Lambda function.
     */
    readonly extraLambdaEnv?: {
        [key: string]: string;
    };
}
/**
 * Create a Lambda that runs every 5 minutes to check for Github webhook delivery failures and retry them.
 *
 * @internal
 */
export declare class GithubWebhookRedelivery extends Construct {
    /**
     * Webhook redelivery lambda function.
     */
    readonly handler: WebhookRedeliveryFunction;
    constructor(scope: Construct, id: string, props: GithubWebhookRedeliveryProps);
}
