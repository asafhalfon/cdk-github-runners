import { aws_ec2 as ec2, aws_lambda as lambda } from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface ApiGatewayAccessProps {
    /**
     * Create a private API Gateway and allow access from the specified VPC endpoints.
     *
     * Use this to make use of existing VPC endpoints or to share an endpoint between multiple functions. The VPC endpoint must point to `ec2.InterfaceVpcEndpointAwsService.APIGATEWAY`.
     *
     * No other settings are supported when using this option.
     *
     * All endpoints will be allowed access, but only the first one will be used as the URL by the runner system for setting up the webhook, and as setup URL.
     */
    readonly allowedVpcEndpoints?: ec2.IVpcEndpoint[];
    /**
     * List of IP addresses in CIDR notation that are allowed to access the API Gateway.
     *
     * If not specified on public API Gateway, all IP addresses are allowed.
     *
     * If not specified on private API Gateway, no IP addresses are allowed (but specified security groups are).
     */
    readonly allowedIps?: string[];
    /**
     * Create a private API Gateway and allow access from the specified VPC.
     */
    readonly allowedVpc?: ec2.IVpc;
    /**
     * List of security groups that are allowed to access the API Gateway.
     *
     * Only works for private API Gateways with {@link allowedVpc}.
     */
    readonly allowedSecurityGroups?: ec2.ISecurityGroup[];
}
/**
 * Access configuration options for Lambda functions like setup and webhook function. Use this to limit access to these functions.
 *
 * If you need a custom access point, you can implement this abstract class yourself. Note that the Lambda functions expect API Gateway v1 or v2 input. They also expect every URL under the constructed URL to point to the function.
 */
export declare abstract class LambdaAccess {
    /**
     * Disables access to the configured Lambda function. This is useful for the setup function after setup is done.
     */
    static noAccess(): LambdaAccess;
    /**
     * Provide access using Lambda URL. This is the default and simplest option. It puts no limits on the requester, but the Lambda functions themselves authenticate every request.
     */
    static lambdaUrl(): LambdaAccess;
    /**
     * Provide access using API Gateway. This is the most secure option, but requires additional configuration. It allows you to limit access to specific IP addresses and even to a specific VPC.
     *
     * To limit access to GitHub.com use:
     *
     * ```
     * LambdaAccess.apiGateway({
     *   allowedIps: LambdaAccess.githubWebhookIps(),
     * });
     * ```
     *
     * Alternatively, get and manually update the list manually with:
     *
     * ```
     * curl https://api.github.com/meta | jq .hooks
     * ```
     */
    static apiGateway(props?: ApiGatewayAccessProps): LambdaAccess;
    /**
     * Downloads the list of IP addresses used by GitHub.com for webhooks.
     *
     * Note that downloading dynamic data during deployment is not recommended in CDK. This is a workaround for the lack of a better solution.
     */
    static githubWebhookIps(): string[];
    /**
     * Creates all required resources and returns access URL or empty string if disabled.
     *
     * @return access URL or empty string if disabled
     */
    abstract bind(scope: Construct, id: string, lambdaFunction: lambda.Function): string;
}
