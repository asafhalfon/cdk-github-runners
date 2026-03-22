"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaAccess = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const child_process_1 = require("child_process");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
/**
 * Access configuration options for Lambda functions like setup and webhook function. Use this to limit access to these functions.
 *
 * If you need a custom access point, you can implement this abstract class yourself. Note that the Lambda functions expect API Gateway v1 or v2 input. They also expect every URL under the constructed URL to point to the function.
 */
class LambdaAccess {
    /**
     * Disables access to the configured Lambda function. This is useful for the setup function after setup is done.
     */
    static noAccess() {
        return new NoAccess();
    }
    /**
     * Provide access using Lambda URL. This is the default and simplest option. It puts no limits on the requester, but the Lambda functions themselves authenticate every request.
     */
    static lambdaUrl() {
        return new LambdaUrl();
    }
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
    static apiGateway(props) {
        return new ApiGateway(props);
    }
    /**
     * Downloads the list of IP addresses used by GitHub.com for webhooks.
     *
     * Note that downloading dynamic data during deployment is not recommended in CDK. This is a workaround for the lack of a better solution.
     */
    static githubWebhookIps() {
        const githubMeta = (0, child_process_1.execFileSync)('curl', ['-fsSL', 'https://api.github.com/meta']).toString();
        const githubMetaJson = JSON.parse(githubMeta);
        return githubMetaJson.hooks;
    }
}
exports.LambdaAccess = LambdaAccess;
_a = JSII_RTTI_SYMBOL_1;
LambdaAccess[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.LambdaAccess", version: "0.0.0" };
/**
 * @internal
 */
class NoAccess extends LambdaAccess {
    bind(_construct, _id, _lambdaFunction) {
        return '';
    }
}
/**
 * @internal
 */
class LambdaUrl extends LambdaAccess {
    bind(_construct, _id, lambdaFunction) {
        return lambdaFunction.addFunctionUrl({
            authType: aws_lambda_1.FunctionUrlAuthType.NONE,
        }).url;
    }
}
/**
 * @internal
 */
class ApiGateway {
    constructor(props) {
        this.props = props;
    }
    bind(scope, id, lambdaFunction) {
        let policy;
        let endpointConfig = undefined;
        let vpcEndpoint = undefined;
        const region = cdk.Stack.of(scope).region;
        if (this.props?.allowedVpcEndpoints) {
            // private api gateway with existing vpc endpoints
            if (this.props?.allowedSecurityGroups) {
                cdk.Annotations.of(scope).addError('allowedSecurityGroups cannot be used when allowedVpcEndpoints is specified.');
            }
            if (this.props?.allowedIps) {
                cdk.Annotations.of(scope).addError('allowedIps cannot be used when allowedVpcEndpoints is specified.');
            }
            if (this.props?.allowedVpc) {
                cdk.Annotations.of(scope).addError('allowedVpc cannot be used when allowedVpcEndpoints is specified.');
            }
            endpointConfig = {
                types: [aws_cdk_lib_1.aws_apigateway.EndpointType.PRIVATE],
                vpcEndpoints: this.props.allowedVpcEndpoints,
            };
            policy = aws_iam_1.PolicyDocument.fromJson({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: '*',
                        Action: 'execute-api:Invoke',
                        Resource: 'execute-api:/*/*/*',
                        Condition: {
                            StringEquals: {
                                'aws:SourceVpce': this.props.allowedVpcEndpoints.map(ve => ve.vpcEndpointId),
                            },
                        },
                    },
                ],
            });
            vpcEndpoint = this.props.allowedVpcEndpoints[0];
        }
        else if (this.props?.allowedVpc) {
            // private api gateway
            const sg = new aws_cdk_lib_1.aws_ec2.SecurityGroup(scope, `${id}/SG`, {
                vpc: this.props.allowedVpc,
                allowAllOutbound: true,
            });
            for (const otherSg of this.props?.allowedSecurityGroups ?? []) {
                sg.connections.allowFrom(otherSg, aws_cdk_lib_1.aws_ec2.Port.tcp(443));
            }
            for (const ip of this.props?.allowedIps ?? []) {
                try {
                    sg.connections.allowFrom(aws_cdk_lib_1.aws_ec2.Peer.ipv4(ip), aws_cdk_lib_1.aws_ec2.Port.tcp(443));
                }
                catch {
                    // poor attempt at supporting both IPv4 and IPv6
                    // we can't accept ec2.IPeer because that doesn't work for public API Gateway
                    sg.connections.allowFrom(aws_cdk_lib_1.aws_ec2.Peer.ipv6(ip), aws_cdk_lib_1.aws_ec2.Port.tcp(443));
                }
            }
            vpcEndpoint = new aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpoint(scope, `${id}/VpcEndpoint`, {
                vpc: this.props.allowedVpc,
                service: aws_cdk_lib_1.aws_ec2.InterfaceVpcEndpointAwsService.APIGATEWAY,
                privateDnsEnabled: false,
                securityGroups: [sg],
                open: false,
            });
            endpointConfig = {
                types: [aws_cdk_lib_1.aws_apigateway.EndpointType.PRIVATE],
                vpcEndpoints: [vpcEndpoint],
            };
            policy = aws_iam_1.PolicyDocument.fromJson({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: '*',
                        Action: 'execute-api:Invoke',
                        Resource: 'execute-api:/*/*/*',
                        Condition: {
                            StringEquals: {
                                'aws:SourceVpce': vpcEndpoint.vpcEndpointId,
                            },
                        },
                    },
                ],
            });
        }
        else {
            // public api gateway
            if (this.props?.allowedSecurityGroups) {
                cdk.Annotations.of(scope).addError('allowedSecurityGroups cannot be used when allowedVpc is not specified.');
            }
            policy = aws_iam_1.PolicyDocument.fromJson({
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Principal: '*',
                        Action: 'execute-api:Invoke',
                        Resource: 'execute-api:/*/*/*',
                        Condition: {
                            IpAddress: {
                                'aws:SourceIp': this.props?.allowedIps ?? ['0.0.0.0/0'],
                            },
                        },
                    },
                ],
            });
        }
        const api = new aws_cdk_lib_1.aws_apigateway.LambdaRestApi(scope, id, {
            handler: lambdaFunction,
            proxy: true,
            cloudWatchRole: false,
            endpointConfiguration: endpointConfig,
            policy,
        });
        // remove CfnOutput
        api.node.tryRemoveChild('Endpoint');
        if (vpcEndpoint) {
            // enabling private DNS affects the entire VPC, so we use the Route53 alias instead
            // https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-private-api-test-invoke-url.html
            return `https://${api.restApiId}-${vpcEndpoint.vpcEndpointId}.execute-api.${region}.amazonaws.com/${api.deploymentStage.stageName}`;
        }
        return api.url;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWNjZXNzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2FjY2Vzcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLGlEQUE2QztBQUM3QyxtQ0FBbUM7QUFDbkMsNkNBQWlIO0FBQ2pILGlEQUFxRDtBQUNyRCx1REFBNkQ7QUFzQzdEOzs7O0dBSUc7QUFDSCxNQUFzQixZQUFZO0lBQ2hDOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFFBQVE7UUFDYixPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFNBQVM7UUFDZCxPQUFPLElBQUksU0FBUyxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7O09BZ0JHO0lBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxLQUE2QjtRQUM3QyxPQUFPLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQy9CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLGdCQUFnQjtRQUNyQixNQUFNLFVBQVUsR0FBRyxJQUFBLDRCQUFZLEVBQUMsTUFBTSxFQUFFLENBQUMsT0FBTyxFQUFFLDZCQUE2QixDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUM3RixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzlDLE9BQU8sY0FBYyxDQUFDLEtBQUssQ0FBQztJQUM5QixDQUFDOztBQTdDSCxvQ0FxREM7OztBQUVEOztHQUVHO0FBQ0gsTUFBTSxRQUFTLFNBQVEsWUFBWTtJQUMxQixJQUFJLENBQUMsVUFBcUIsRUFBRSxHQUFXLEVBQUUsZUFBZ0M7UUFDOUUsT0FBTyxFQUFFLENBQUM7SUFDWixDQUFDO0NBQ0Y7QUFFRDs7R0FFRztBQUNILE1BQU0sU0FBVSxTQUFRLFlBQVk7SUFDM0IsSUFBSSxDQUFDLFVBQXFCLEVBQUUsR0FBVyxFQUFFLGNBQStCO1FB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QVcsRUFBRSxDQUFDO1lBQ2hCLG1GQUFtRjtZQUNuRiwyR0FBMkc7WUFDM0csT0FBTyxXQUFXLEdBQUcsQ0FBQyxTQUFTLElBQUksV0FBVyxDQUFDLGFBQWEsZ0JBQWdCLE1BQU0sa0JBQWtCLEdBQUcsQ0FBQyxlQUFlLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDdEksQ0FBQztRQUVELE9BQU8sR0FBRyxDQUFDLEdBQUcsQ0FBQztJQUNqQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBleGVjRmlsZVN5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBhd3NfYXBpZ2F0ZXdheSBhcyBhcGlnYXRld2F5LCBhd3NfZWMyIGFzIGVjMiwgYXdzX2lhbSBhcyBpYW0sIGF3c19sYW1iZGEgYXMgbGFtYmRhIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgUG9saWN5RG9jdW1lbnQgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCB7IEZ1bmN0aW9uVXJsQXV0aFR5cGUgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5cbmV4cG9ydCBpbnRlcmZhY2UgQXBpR2F0ZXdheUFjY2Vzc1Byb3BzIHtcbiAgLyoqXG4gICAqIENyZWF0ZSBhIHByaXZhdGUgQVBJIEdhdGV3YXkgYW5kIGFsbG93IGFjY2VzcyBmcm9tIHRoZSBzcGVjaWZpZWQgVlBDIGVuZHBvaW50cy5cbiAgICpcbiAgICogVXNlIHRoaXMgdG8gbWFrZSB1c2Ugb2YgZXhpc3RpbmcgVlBDIGVuZHBvaW50cyBvciB0byBzaGFyZSBhbiBlbmRwb2ludCBiZXR3ZWVuIG11bHRpcGxlIGZ1bmN0aW9ucy4gVGhlIFZQQyBlbmRwb2ludCBtdXN0IHBvaW50IHRvIGBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnRBd3NTZXJ2aWNlLkFQSUdBVEVXQVlgLlxuICAgKlxuICAgKiBObyBvdGhlciBzZXR0aW5ncyBhcmUgc3VwcG9ydGVkIHdoZW4gdXNpbmcgdGhpcyBvcHRpb24uXG4gICAqXG4gICAqIEFsbCBlbmRwb2ludHMgd2lsbCBiZSBhbGxvd2VkIGFjY2VzcywgYnV0IG9ubHkgdGhlIGZpcnN0IG9uZSB3aWxsIGJlIHVzZWQgYXMgdGhlIFVSTCBieSB0aGUgcnVubmVyIHN5c3RlbSBmb3Igc2V0dGluZyB1cCB0aGUgd2ViaG9vaywgYW5kIGFzIHNldHVwIFVSTC5cbiAgICovXG4gIHJlYWRvbmx5IGFsbG93ZWRWcGNFbmRwb2ludHM/OiBlYzIuSVZwY0VuZHBvaW50W107XG5cbiAgLyoqXG4gICAqIExpc3Qgb2YgSVAgYWRkcmVzc2VzIGluIENJRFIgbm90YXRpb24gdGhhdCBhcmUgYWxsb3dlZCB0byBhY2Nlc3MgdGhlIEFQSSBHYXRld2F5LlxuICAgKlxuICAgKiBJZiBub3Qgc3BlY2lmaWVkIG9uIHB1YmxpYyBBUEkgR2F0ZXdheSwgYWxsIElQIGFkZHJlc3NlcyBhcmUgYWxsb3dlZC5cbiAgICpcbiAgICogSWYgbm90IHNwZWNpZmllZCBvbiBwcml2YXRlIEFQSSBHYXRld2F5LCBubyBJUCBhZGRyZXNzZXMgYXJlIGFsbG93ZWQgKGJ1dCBzcGVjaWZpZWQgc2VjdXJpdHkgZ3JvdXBzIGFyZSkuXG4gICAqL1xuICByZWFkb25seSBhbGxvd2VkSXBzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIHByaXZhdGUgQVBJIEdhdGV3YXkgYW5kIGFsbG93IGFjY2VzcyBmcm9tIHRoZSBzcGVjaWZpZWQgVlBDLlxuICAgKi9cbiAgcmVhZG9ubHkgYWxsb3dlZFZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBMaXN0IG9mIHNlY3VyaXR5IGdyb3VwcyB0aGF0IGFyZSBhbGxvd2VkIHRvIGFjY2VzcyB0aGUgQVBJIEdhdGV3YXkuXG4gICAqXG4gICAqIE9ubHkgd29ya3MgZm9yIHByaXZhdGUgQVBJIEdhdGV3YXlzIHdpdGgge0BsaW5rIGFsbG93ZWRWcGN9LlxuICAgKi9cbiAgcmVhZG9ubHkgYWxsb3dlZFNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG59XG5cbi8qKlxuICogQWNjZXNzIGNvbmZpZ3VyYXRpb24gb3B0aW9ucyBmb3IgTGFtYmRhIGZ1bmN0aW9ucyBsaWtlIHNldHVwIGFuZCB3ZWJob29rIGZ1bmN0aW9uLiBVc2UgdGhpcyB0byBsaW1pdCBhY2Nlc3MgdG8gdGhlc2UgZnVuY3Rpb25zLlxuICpcbiAqIElmIHlvdSBuZWVkIGEgY3VzdG9tIGFjY2VzcyBwb2ludCwgeW91IGNhbiBpbXBsZW1lbnQgdGhpcyBhYnN0cmFjdCBjbGFzcyB5b3Vyc2VsZi4gTm90ZSB0aGF0IHRoZSBMYW1iZGEgZnVuY3Rpb25zIGV4cGVjdCBBUEkgR2F0ZXdheSB2MSBvciB2MiBpbnB1dC4gVGhleSBhbHNvIGV4cGVjdCBldmVyeSBVUkwgdW5kZXIgdGhlIGNvbnN0cnVjdGVkIFVSTCB0byBwb2ludCB0byB0aGUgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBMYW1iZGFBY2Nlc3Mge1xuICAvKipcbiAgICogRGlzYWJsZXMgYWNjZXNzIHRvIHRoZSBjb25maWd1cmVkIExhbWJkYSBmdW5jdGlvbi4gVGhpcyBpcyB1c2VmdWwgZm9yIHRoZSBzZXR1cCBmdW5jdGlvbiBhZnRlciBzZXR1cCBpcyBkb25lLlxuICAgKi9cbiAgc3RhdGljIG5vQWNjZXNzKCk6IExhbWJkYUFjY2VzcyB7XG4gICAgcmV0dXJuIG5ldyBOb0FjY2VzcygpO1xuICB9XG5cbiAgLyoqXG4gICAqIFByb3ZpZGUgYWNjZXNzIHVzaW5nIExhbWJkYSBVUkwuIFRoaXMgaXMgdGhlIGRlZmF1bHQgYW5kIHNpbXBsZXN0IG9wdGlvbi4gSXQgcHV0cyBubyBsaW1pdHMgb24gdGhlIHJlcXVlc3RlciwgYnV0IHRoZSBMYW1iZGEgZnVuY3Rpb25zIHRoZW1zZWx2ZXMgYXV0aGVudGljYXRlIGV2ZXJ5IHJlcXVlc3QuXG4gICAqL1xuICBzdGF0aWMgbGFtYmRhVXJsKCk6IExhbWJkYUFjY2VzcyB7XG4gICAgcmV0dXJuIG5ldyBMYW1iZGFVcmwoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm92aWRlIGFjY2VzcyB1c2luZyBBUEkgR2F0ZXdheS4gVGhpcyBpcyB0aGUgbW9zdCBzZWN1cmUgb3B0aW9uLCBidXQgcmVxdWlyZXMgYWRkaXRpb25hbCBjb25maWd1cmF0aW9uLiBJdCBhbGxvd3MgeW91IHRvIGxpbWl0IGFjY2VzcyB0byBzcGVjaWZpYyBJUCBhZGRyZXNzZXMgYW5kIGV2ZW4gdG8gYSBzcGVjaWZpYyBWUEMuXG4gICAqXG4gICAqIFRvIGxpbWl0IGFjY2VzcyB0byBHaXRIdWIuY29tIHVzZTpcbiAgICpcbiAgICogYGBgXG4gICAqIExhbWJkYUFjY2Vzcy5hcGlHYXRld2F5KHtcbiAgICogICBhbGxvd2VkSXBzOiBMYW1iZGFBY2Nlc3MuZ2l0aHViV2ViaG9va0lwcygpLFxuICAgKiB9KTtcbiAgICogYGBgXG4gICAqXG4gICAqIEFsdGVybmF0aXZlbHksIGdldCBhbmQgbWFudWFsbHkgdXBkYXRlIHRoZSBsaXN0IG1hbnVhbGx5IHdpdGg6XG4gICAqXG4gICAqIGBgYFxuICAgKiBjdXJsIGh0dHBzOi8vYXBpLmdpdGh1Yi5jb20vbWV0YSB8IGpxIC5ob29rc1xuICAgKiBgYGBcbiAgICovXG4gIHN0YXRpYyBhcGlHYXRld2F5KHByb3BzPzogQXBpR2F0ZXdheUFjY2Vzc1Byb3BzKTogTGFtYmRhQWNjZXNzIHtcbiAgICByZXR1cm4gbmV3IEFwaUdhdGV3YXkocHJvcHMpO1xuICB9XG5cbiAgLyoqXG4gICAqIERvd25sb2FkcyB0aGUgbGlzdCBvZiBJUCBhZGRyZXNzZXMgdXNlZCBieSBHaXRIdWIuY29tIGZvciB3ZWJob29rcy5cbiAgICpcbiAgICogTm90ZSB0aGF0IGRvd25sb2FkaW5nIGR5bmFtaWMgZGF0YSBkdXJpbmcgZGVwbG95bWVudCBpcyBub3QgcmVjb21tZW5kZWQgaW4gQ0RLLiBUaGlzIGlzIGEgd29ya2Fyb3VuZCBmb3IgdGhlIGxhY2sgb2YgYSBiZXR0ZXIgc29sdXRpb24uXG4gICAqL1xuICBzdGF0aWMgZ2l0aHViV2ViaG9va0lwcygpOiBzdHJpbmdbXSB7XG4gICAgY29uc3QgZ2l0aHViTWV0YSA9IGV4ZWNGaWxlU3luYygnY3VybCcsIFsnLWZzU0wnLCAnaHR0cHM6Ly9hcGkuZ2l0aHViLmNvbS9tZXRhJ10pLnRvU3RyaW5nKCk7XG4gICAgY29uc3QgZ2l0aHViTWV0YUpzb24gPSBKU09OLnBhcnNlKGdpdGh1Yk1ldGEpO1xuICAgIHJldHVybiBnaXRodWJNZXRhSnNvbi5ob29rcztcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGFsbCByZXF1aXJlZCByZXNvdXJjZXMgYW5kIHJldHVybnMgYWNjZXNzIFVSTCBvciBlbXB0eSBzdHJpbmcgaWYgZGlzYWJsZWQuXG4gICAqXG4gICAqIEByZXR1cm4gYWNjZXNzIFVSTCBvciBlbXB0eSBzdHJpbmcgaWYgZGlzYWJsZWRcbiAgICovXG4gIHB1YmxpYyBhYnN0cmFjdCBiaW5kKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb24pOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmNsYXNzIE5vQWNjZXNzIGV4dGVuZHMgTGFtYmRhQWNjZXNzIHtcbiAgcHVibGljIGJpbmQoX2NvbnN0cnVjdDogQ29uc3RydWN0LCBfaWQ6IHN0cmluZywgX2xhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb24pOiBzdHJpbmcge1xuICAgIHJldHVybiAnJztcbiAgfVxufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5jbGFzcyBMYW1iZGFVcmwgZXh0ZW5kcyBMYW1iZGFBY2Nlc3Mge1xuICBwdWJsaWMgYmluZChfY29uc3RydWN0OiBDb25zdHJ1Y3QsIF9pZDogc3RyaW5nLCBsYW1iZGFGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uKTogc3RyaW5nIHtcbiAgICByZXR1cm4gbGFtYmRhRnVuY3Rpb24uYWRkRnVuY3Rpb25Vcmwoe1xuICAgICAgYXV0aFR5cGU6IEZ1bmN0aW9uVXJsQXV0aFR5cGUuTk9ORSxcbiAgICB9KS51cmw7XG4gIH1cbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuY2xhc3MgQXBpR2F0ZXdheSB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcHJvcHM/OiBBcGlHYXRld2F5QWNjZXNzUHJvcHMpIHt9XG5cbiAgcHVibGljIGJpbmQoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgbGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbik6IHN0cmluZyB7XG4gICAgbGV0IHBvbGljeTogaWFtLlBvbGljeURvY3VtZW50O1xuICAgIGxldCBlbmRwb2ludENvbmZpZzogYXBpZ2F0ZXdheS5FbmRwb2ludENvbmZpZ3VyYXRpb24gfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XG4gICAgbGV0IHZwY0VuZHBvaW50OiBlYzIuSVZwY0VuZHBvaW50IHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IHJlZ2lvbiA9IGNkay5TdGFjay5vZihzY29wZSkucmVnaW9uO1xuXG4gICAgaWYgKHRoaXMucHJvcHM/LmFsbG93ZWRWcGNFbmRwb2ludHMpIHtcbiAgICAgIC8vIHByaXZhdGUgYXBpIGdhdGV3YXkgd2l0aCBleGlzdGluZyB2cGMgZW5kcG9pbnRzXG4gICAgICBpZiAodGhpcy5wcm9wcz8uYWxsb3dlZFNlY3VyaXR5R3JvdXBzKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZihzY29wZSkuYWRkRXJyb3IoJ2FsbG93ZWRTZWN1cml0eUdyb3VwcyBjYW5ub3QgYmUgdXNlZCB3aGVuIGFsbG93ZWRWcGNFbmRwb2ludHMgaXMgc3BlY2lmaWVkLicpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucHJvcHM/LmFsbG93ZWRJcHMpIHtcbiAgICAgICAgY2RrLkFubm90YXRpb25zLm9mKHNjb3BlKS5hZGRFcnJvcignYWxsb3dlZElwcyBjYW5ub3QgYmUgdXNlZCB3aGVuIGFsbG93ZWRWcGNFbmRwb2ludHMgaXMgc3BlY2lmaWVkLicpO1xuICAgICAgfVxuICAgICAgaWYgKHRoaXMucHJvcHM/LmFsbG93ZWRWcGMpIHtcbiAgICAgICAgY2RrLkFubm90YXRpb25zLm9mKHNjb3BlKS5hZGRFcnJvcignYWxsb3dlZFZwYyBjYW5ub3QgYmUgdXNlZCB3aGVuIGFsbG93ZWRWcGNFbmRwb2ludHMgaXMgc3BlY2lmaWVkLicpO1xuICAgICAgfVxuXG4gICAgICBlbmRwb2ludENvbmZpZyA9IHtcbiAgICAgICAgdHlwZXM6IFthcGlnYXRld2F5LkVuZHBvaW50VHlwZS5QUklWQVRFXSxcbiAgICAgICAgdnBjRW5kcG9pbnRzOiB0aGlzLnByb3BzLmFsbG93ZWRWcGNFbmRwb2ludHMsXG4gICAgICB9O1xuXG4gICAgICBwb2xpY3kgPSBQb2xpY3lEb2N1bWVudC5mcm9tSnNvbih7XG4gICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgICAgICAgU3RhdGVtZW50OiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgUHJpbmNpcGFsOiAnKicsXG4gICAgICAgICAgICBBY3Rpb246ICdleGVjdXRlLWFwaTpJbnZva2UnLFxuICAgICAgICAgICAgUmVzb3VyY2U6ICdleGVjdXRlLWFwaTovKi8qLyonLFxuICAgICAgICAgICAgQ29uZGl0aW9uOiB7XG4gICAgICAgICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICAgICAgICdhd3M6U291cmNlVnBjZSc6IHRoaXMucHJvcHMuYWxsb3dlZFZwY0VuZHBvaW50cy5tYXAodmUgPT4gdmUudnBjRW5kcG9pbnRJZCksXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9KTtcblxuICAgICAgdnBjRW5kcG9pbnQgPSB0aGlzLnByb3BzLmFsbG93ZWRWcGNFbmRwb2ludHNbMF07XG4gICAgfSBlbHNlIGlmICh0aGlzLnByb3BzPy5hbGxvd2VkVnBjKSB7XG4gICAgICAvLyBwcml2YXRlIGFwaSBnYXRld2F5XG4gICAgICBjb25zdCBzZyA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cChzY29wZSwgYCR7aWR9L1NHYCwge1xuICAgICAgICB2cGM6IHRoaXMucHJvcHMuYWxsb3dlZFZwYyxcbiAgICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICAgIH0pO1xuXG4gICAgICBmb3IgKGNvbnN0IG90aGVyU2cgb2YgdGhpcy5wcm9wcz8uYWxsb3dlZFNlY3VyaXR5R3JvdXBzID8/IFtdKSB7XG4gICAgICAgIHNnLmNvbm5lY3Rpb25zLmFsbG93RnJvbShvdGhlclNnLCBlYzIuUG9ydC50Y3AoNDQzKSk7XG4gICAgICB9XG5cbiAgICAgIGZvciAoY29uc3QgaXAgb2YgdGhpcy5wcm9wcz8uYWxsb3dlZElwcyA/PyBbXSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHNnLmNvbm5lY3Rpb25zLmFsbG93RnJvbShlYzIuUGVlci5pcHY0KGlwKSwgZWMyLlBvcnQudGNwKDQ0MykpO1xuICAgICAgICB9IGNhdGNoIHtcbiAgICAgICAgICAvLyBwb29yIGF0dGVtcHQgYXQgc3VwcG9ydGluZyBib3RoIElQdjQgYW5kIElQdjZcbiAgICAgICAgICAvLyB3ZSBjYW4ndCBhY2NlcHQgZWMyLklQZWVyIGJlY2F1c2UgdGhhdCBkb2Vzbid0IHdvcmsgZm9yIHB1YmxpYyBBUEkgR2F0ZXdheVxuICAgICAgICAgIHNnLmNvbm5lY3Rpb25zLmFsbG93RnJvbShlYzIuUGVlci5pcHY2KGlwKSwgZWMyLlBvcnQudGNwKDQ0MykpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHZwY0VuZHBvaW50ID0gbmV3IGVjMi5JbnRlcmZhY2VWcGNFbmRwb2ludChzY29wZSwgYCR7aWR9L1ZwY0VuZHBvaW50YCwge1xuICAgICAgICB2cGM6IHRoaXMucHJvcHMuYWxsb3dlZFZwYyxcbiAgICAgICAgc2VydmljZTogZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5BUElHQVRFV0FZLFxuICAgICAgICBwcml2YXRlRG5zRW5hYmxlZDogZmFsc2UsXG4gICAgICAgIHNlY3VyaXR5R3JvdXBzOiBbc2ddLFxuICAgICAgICBvcGVuOiBmYWxzZSxcbiAgICAgIH0pO1xuXG4gICAgICBlbmRwb2ludENvbmZpZyA9IHtcbiAgICAgICAgdHlwZXM6IFthcGlnYXRld2F5LkVuZHBvaW50VHlwZS5QUklWQVRFXSxcbiAgICAgICAgdnBjRW5kcG9pbnRzOiBbdnBjRW5kcG9pbnRdLFxuICAgICAgfTtcblxuICAgICAgcG9saWN5ID0gUG9saWN5RG9jdW1lbnQuZnJvbUpzb24oe1xuICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICAgIFN0YXRlbWVudDogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgIFByaW5jaXBhbDogJyonLFxuICAgICAgICAgICAgQWN0aW9uOiAnZXhlY3V0ZS1hcGk6SW52b2tlJyxcbiAgICAgICAgICAgIFJlc291cmNlOiAnZXhlY3V0ZS1hcGk6LyovKi8qJyxcbiAgICAgICAgICAgIENvbmRpdGlvbjoge1xuICAgICAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICAgICAnYXdzOlNvdXJjZVZwY2UnOiB2cGNFbmRwb2ludC52cGNFbmRwb2ludElkLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHB1YmxpYyBhcGkgZ2F0ZXdheVxuICAgICAgaWYgKHRoaXMucHJvcHM/LmFsbG93ZWRTZWN1cml0eUdyb3Vwcykge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2Yoc2NvcGUpLmFkZEVycm9yKCdhbGxvd2VkU2VjdXJpdHlHcm91cHMgY2Fubm90IGJlIHVzZWQgd2hlbiBhbGxvd2VkVnBjIGlzIG5vdCBzcGVjaWZpZWQuJyk7XG4gICAgICB9XG5cbiAgICAgIHBvbGljeSA9IFBvbGljeURvY3VtZW50LmZyb21Kc29uKHtcbiAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICAgICAgICBQcmluY2lwYWw6ICcqJyxcbiAgICAgICAgICAgIEFjdGlvbjogJ2V4ZWN1dGUtYXBpOkludm9rZScsXG4gICAgICAgICAgICBSZXNvdXJjZTogJ2V4ZWN1dGUtYXBpOi8qLyovKicsXG4gICAgICAgICAgICBDb25kaXRpb246IHtcbiAgICAgICAgICAgICAgSXBBZGRyZXNzOiB7XG4gICAgICAgICAgICAgICAgJ2F3czpTb3VyY2VJcCc6IHRoaXMucHJvcHM/LmFsbG93ZWRJcHMgPz8gWycwLjAuMC4wLzAnXSxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYVJlc3RBcGkoc2NvcGUsIGlkLCB7XG4gICAgICBoYW5kbGVyOiBsYW1iZGFGdW5jdGlvbixcbiAgICAgIHByb3h5OiB0cnVlLFxuICAgICAgY2xvdWRXYXRjaFJvbGU6IGZhbHNlLFxuICAgICAgZW5kcG9pbnRDb25maWd1cmF0aW9uOiBlbmRwb2ludENvbmZpZyxcbiAgICAgIHBvbGljeSxcbiAgICB9KTtcblxuICAgIC8vIHJlbW92ZSBDZm5PdXRwdXRcbiAgICBhcGkubm9kZS50cnlSZW1vdmVDaGlsZCgnRW5kcG9pbnQnKTtcblxuICAgIGlmICh2cGNFbmRwb2ludCkge1xuICAgICAgLy8gZW5hYmxpbmcgcHJpdmF0ZSBETlMgYWZmZWN0cyB0aGUgZW50aXJlIFZQQywgc28gd2UgdXNlIHRoZSBSb3V0ZTUzIGFsaWFzIGluc3RlYWRcbiAgICAgIC8vIGh0dHBzOi8vZG9jcy5hd3MuYW1hem9uLmNvbS9hcGlnYXRld2F5L2xhdGVzdC9kZXZlbG9wZXJndWlkZS9hcGlnYXRld2F5LXByaXZhdGUtYXBpLXRlc3QtaW52b2tlLXVybC5odG1sXG4gICAgICByZXR1cm4gYGh0dHBzOi8vJHthcGkucmVzdEFwaUlkfS0ke3ZwY0VuZHBvaW50LnZwY0VuZHBvaW50SWR9LmV4ZWN1dGUtYXBpLiR7cmVnaW9ufS5hbWF6b25hd3MuY29tLyR7YXBpLmRlcGxveW1lbnRTdGFnZS5zdGFnZU5hbWV9YDtcbiAgICB9XG5cbiAgICByZXR1cm4gYXBpLnVybDtcbiAgfVxufVxuIl19