"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaAccess = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const child_process_1 = require("child_process");
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_iam_1 = require("aws-cdk-lib/aws-iam");
const aws_lambda_1 = require("aws-cdk-lib/aws-lambda");
/**
 * Access configuration options for Lambda functions like setup and webhook function. Use this to limit access to these functions.
 *
 * If you need a custom access point, you can implement this abstract class yourself. Note that the Lambda functions expect API Gateway v1 or v2 input. They also expect every URL under the constructed URL to point to the function.
 */
class LambdaAccess {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.LambdaAccess", version: "0.0.0" };
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
    props;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYWNjZXNzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2FjY2Vzcy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQTZDO0FBQzdDLGlEQUFtQztBQUNuQyw2Q0FBaUg7QUFDakgsaURBQXFEO0FBQ3JELHVEQUE2RDtBQXNDN0Q7Ozs7R0FJRztBQUNILE1BQXNCLFlBQVk7O0lBQ2hDOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFFBQVE7UUFDYixPQUFPLElBQUksUUFBUSxFQUFFLENBQUM7SUFDeEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsTUFBTSxDQUFDLFNBQVM7UUFDZCxPQUFPLElBQUksU0FBUyxFQUFFLENBQUM7SUFDekIsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7Ozs7O09BZ0JHO0lBQ0gsTUFBTSxDQUFDLFVBQVUsQ0FBQyxLQUE2QjtRQUM3QyxPQUFPLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQy9CLENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsTUFBTSxDQUFDLGdCQUFnQjtRQUNyQixNQUFNLFVBQVUsR0FBRyxJQUFBLDRCQUFZLEVBQUMsTUFBTSxFQUFFLENBQUMsT0FBTyxFQUFFLDZCQUE2QixDQUFDLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztRQUM3RixNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzlDLE9BQU8sY0FBYyxDQUFDLEtBQUssQ0FBQztJQUM5QixDQUFDOztBQTdDSCxvQ0FxREM7QUFFRDs7R0FFRztBQUNILE1BQU0sUUFBUyxTQUFRLFlBQVk7SUFDMUIsSUFBSSxDQUFDLFVBQXFCLEVBQUUsR0FBVyxFQUFFLGVBQWdDO1FBQzlFLE9BQU8sRUFBRSxDQUFDO0lBQ1osQ0FBQztDQUNGO0FBRUQ7O0dBRUc7QUFDSCxNQUFNLFNBQVUsU0FBUSxZQUFZO0lBQzNCLElBQUksQ0FB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QUFjLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFcEMsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixtRkFBbUY7WUFDbkYsMkdBQTJHO1lBQzNHLE9BQU8sV0FBVyxHQUFHLENBQUMsU0FBUyxJQUFJLFdBQVcsQ0FBQyxhQUFhLGdCQUFnQixNQUFNLGtCQUFrQixHQUFHLENBQUMsZUFBZSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ3RJLENBQUM7UUFFRCxPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUM7SUFDakIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZXhlY0ZpbGVTeW5jIH0gZnJvbSAnY2hpbGRfcHJvY2Vzcyc7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgYXdzX2FwaWdhdGV3YXkgYXMgYXBpZ2F0ZXdheSwgYXdzX2VjMiBhcyBlYzIsIGF3c19pYW0gYXMgaWFtLCBhd3NfbGFtYmRhIGFzIGxhbWJkYSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFBvbGljeURvY3VtZW50IH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgeyBGdW5jdGlvblVybEF1dGhUeXBlIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuXG5leHBvcnQgaW50ZXJmYWNlIEFwaUdhdGV3YXlBY2Nlc3NQcm9wcyB7XG4gIC8qKlxuICAgKiBDcmVhdGUgYSBwcml2YXRlIEFQSSBHYXRld2F5IGFuZCBhbGxvdyBhY2Nlc3MgZnJvbSB0aGUgc3BlY2lmaWVkIFZQQyBlbmRwb2ludHMuXG4gICAqXG4gICAqIFVzZSB0aGlzIHRvIG1ha2UgdXNlIG9mIGV4aXN0aW5nIFZQQyBlbmRwb2ludHMgb3IgdG8gc2hhcmUgYW4gZW5kcG9pbnQgYmV0d2VlbiBtdWx0aXBsZSBmdW5jdGlvbnMuIFRoZSBWUEMgZW5kcG9pbnQgbXVzdCBwb2ludCB0byBgZWMyLkludGVyZmFjZVZwY0VuZHBvaW50QXdzU2VydmljZS5BUElHQVRFV0FZYC5cbiAgICpcbiAgICogTm8gb3RoZXIgc2V0dGluZ3MgYXJlIHN1cHBvcnRlZCB3aGVuIHVzaW5nIHRoaXMgb3B0aW9uLlxuICAgKlxuICAgKiBBbGwgZW5kcG9pbnRzIHdpbGwgYmUgYWxsb3dlZCBhY2Nlc3MsIGJ1dCBvbmx5IHRoZSBmaXJzdCBvbmUgd2lsbCBiZSB1c2VkIGFzIHRoZSBVUkwgYnkgdGhlIHJ1bm5lciBzeXN0ZW0gZm9yIHNldHRpbmcgdXAgdGhlIHdlYmhvb2ssIGFuZCBhcyBzZXR1cCBVUkwuXG4gICAqL1xuICByZWFkb25seSBhbGxvd2VkVnBjRW5kcG9pbnRzPzogZWMyLklWcGNFbmRwb2ludFtdO1xuXG4gIC8qKlxuICAgKiBMaXN0IG9mIElQIGFkZHJlc3NlcyBpbiBDSURSIG5vdGF0aW9uIHRoYXQgYXJlIGFsbG93ZWQgdG8gYWNjZXNzIHRoZSBBUEkgR2F0ZXdheS5cbiAgICpcbiAgICogSWYgbm90IHNwZWNpZmllZCBvbiBwdWJsaWMgQVBJIEdhdGV3YXksIGFsbCBJUCBhZGRyZXNzZXMgYXJlIGFsbG93ZWQuXG4gICAqXG4gICAqIElmIG5vdCBzcGVjaWZpZWQgb24gcHJpdmF0ZSBBUEkgR2F0ZXdheSwgbm8gSVAgYWRkcmVzc2VzIGFyZSBhbGxvd2VkIChidXQgc3BlY2lmaWVkIHNlY3VyaXR5IGdyb3VwcyBhcmUpLlxuICAgKi9cbiAgcmVhZG9ubHkgYWxsb3dlZElwcz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBwcml2YXRlIEFQSSBHYXRld2F5IGFuZCBhbGxvdyBhY2Nlc3MgZnJvbSB0aGUgc3BlY2lmaWVkIFZQQy5cbiAgICovXG4gIHJlYWRvbmx5IGFsbG93ZWRWcGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogTGlzdCBvZiBzZWN1cml0eSBncm91cHMgdGhhdCBhcmUgYWxsb3dlZCB0byBhY2Nlc3MgdGhlIEFQSSBHYXRld2F5LlxuICAgKlxuICAgKiBPbmx5IHdvcmtzIGZvciBwcml2YXRlIEFQSSBHYXRld2F5cyB3aXRoIHtAbGluayBhbGxvd2VkVnBjfS5cbiAgICovXG4gIHJlYWRvbmx5IGFsbG93ZWRTZWN1cml0eUdyb3Vwcz86IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xufVxuXG4vKipcbiAqIEFjY2VzcyBjb25maWd1cmF0aW9uIG9wdGlvbnMgZm9yIExhbWJkYSBmdW5jdGlvbnMgbGlrZSBzZXR1cCBhbmQgd2ViaG9vayBmdW5jdGlvbi4gVXNlIHRoaXMgdG8gbGltaXQgYWNjZXNzIHRvIHRoZXNlIGZ1bmN0aW9ucy5cbiAqXG4gKiBJZiB5b3UgbmVlZCBhIGN1c3RvbSBhY2Nlc3MgcG9pbnQsIHlvdSBjYW4gaW1wbGVtZW50IHRoaXMgYWJzdHJhY3QgY2xhc3MgeW91cnNlbGYuIE5vdGUgdGhhdCB0aGUgTGFtYmRhIGZ1bmN0aW9ucyBleHBlY3QgQVBJIEdhdGV3YXkgdjEgb3IgdjIgaW5wdXQuIFRoZXkgYWxzbyBleHBlY3QgZXZlcnkgVVJMIHVuZGVyIHRoZSBjb25zdHJ1Y3RlZCBVUkwgdG8gcG9pbnQgdG8gdGhlIGZ1bmN0aW9uLlxuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgTGFtYmRhQWNjZXNzIHtcbiAgLyoqXG4gICAqIERpc2FibGVzIGFjY2VzcyB0byB0aGUgY29uZmlndXJlZCBMYW1iZGEgZnVuY3Rpb24uIFRoaXMgaXMgdXNlZnVsIGZvciB0aGUgc2V0dXAgZnVuY3Rpb24gYWZ0ZXIgc2V0dXAgaXMgZG9uZS5cbiAgICovXG4gIHN0YXRpYyBub0FjY2VzcygpOiBMYW1iZGFBY2Nlc3Mge1xuICAgIHJldHVybiBuZXcgTm9BY2Nlc3MoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm92aWRlIGFjY2VzcyB1c2luZyBMYW1iZGEgVVJMLiBUaGlzIGlzIHRoZSBkZWZhdWx0IGFuZCBzaW1wbGVzdCBvcHRpb24uIEl0IHB1dHMgbm8gbGltaXRzIG9uIHRoZSByZXF1ZXN0ZXIsIGJ1dCB0aGUgTGFtYmRhIGZ1bmN0aW9ucyB0aGVtc2VsdmVzIGF1dGhlbnRpY2F0ZSBldmVyeSByZXF1ZXN0LlxuICAgKi9cbiAgc3RhdGljIGxhbWJkYVVybCgpOiBMYW1iZGFBY2Nlc3Mge1xuICAgIHJldHVybiBuZXcgTGFtYmRhVXJsKCk7XG4gIH1cblxuICAvKipcbiAgICogUHJvdmlkZSBhY2Nlc3MgdXNpbmcgQVBJIEdhdGV3YXkuIFRoaXMgaXMgdGhlIG1vc3Qgc2VjdXJlIG9wdGlvbiwgYnV0IHJlcXVpcmVzIGFkZGl0aW9uYWwgY29uZmlndXJhdGlvbi4gSXQgYWxsb3dzIHlvdSB0byBsaW1pdCBhY2Nlc3MgdG8gc3BlY2lmaWMgSVAgYWRkcmVzc2VzIGFuZCBldmVuIHRvIGEgc3BlY2lmaWMgVlBDLlxuICAgKlxuICAgKiBUbyBsaW1pdCBhY2Nlc3MgdG8gR2l0SHViLmNvbSB1c2U6XG4gICAqXG4gICAqIGBgYFxuICAgKiBMYW1iZGFBY2Nlc3MuYXBpR2F0ZXdheSh7XG4gICAqICAgYWxsb3dlZElwczogTGFtYmRhQWNjZXNzLmdpdGh1YldlYmhvb2tJcHMoKSxcbiAgICogfSk7XG4gICAqIGBgYFxuICAgKlxuICAgKiBBbHRlcm5hdGl2ZWx5LCBnZXQgYW5kIG1hbnVhbGx5IHVwZGF0ZSB0aGUgbGlzdCBtYW51YWxseSB3aXRoOlxuICAgKlxuICAgKiBgYGBcbiAgICogY3VybCBodHRwczovL2FwaS5naXRodWIuY29tL21ldGEgfCBqcSAuaG9va3NcbiAgICogYGBgXG4gICAqL1xuICBzdGF0aWMgYXBpR2F0ZXdheShwcm9wcz86IEFwaUdhdGV3YXlBY2Nlc3NQcm9wcyk6IExhbWJkYUFjY2VzcyB7XG4gICAgcmV0dXJuIG5ldyBBcGlHYXRld2F5KHByb3BzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBEb3dubG9hZHMgdGhlIGxpc3Qgb2YgSVAgYWRkcmVzc2VzIHVzZWQgYnkgR2l0SHViLmNvbSBmb3Igd2ViaG9va3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCBkb3dubG9hZGluZyBkeW5hbWljIGRhdGEgZHVyaW5nIGRlcGxveW1lbnQgaXMgbm90IHJlY29tbWVuZGVkIGluIENESy4gVGhpcyBpcyBhIHdvcmthcm91bmQgZm9yIHRoZSBsYWNrIG9mIGEgYmV0dGVyIHNvbHV0aW9uLlxuICAgKi9cbiAgc3RhdGljIGdpdGh1YldlYmhvb2tJcHMoKTogc3RyaW5nW10ge1xuICAgIGNvbnN0IGdpdGh1Yk1ldGEgPSBleGVjRmlsZVN5bmMoJ2N1cmwnLCBbJy1mc1NMJywgJ2h0dHBzOi8vYXBpLmdpdGh1Yi5jb20vbWV0YSddKS50b1N0cmluZygpO1xuICAgIGNvbnN0IGdpdGh1Yk1ldGFKc29uID0gSlNPTi5wYXJzZShnaXRodWJNZXRhKTtcbiAgICByZXR1cm4gZ2l0aHViTWV0YUpzb24uaG9va3M7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhbGwgcmVxdWlyZWQgcmVzb3VyY2VzIGFuZCByZXR1cm5zIGFjY2VzcyBVUkwgb3IgZW1wdHkgc3RyaW5nIGlmIGRpc2FibGVkLlxuICAgKlxuICAgKiBAcmV0dXJuIGFjY2VzcyBVUkwgb3IgZW1wdHkgc3RyaW5nIGlmIGRpc2FibGVkXG4gICAqL1xuICBwdWJsaWMgYWJzdHJhY3QgYmluZChzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBsYW1iZGFGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uKTogc3RyaW5nO1xufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5jbGFzcyBOb0FjY2VzcyBleHRlbmRzIExhbWJkYUFjY2VzcyB7XG4gIHB1YmxpYyBiaW5kKF9jb25zdHJ1Y3Q6IENvbnN0cnVjdCwgX2lkOiBzdHJpbmcsIF9sYW1iZGFGdW5jdGlvbjogbGFtYmRhLkZ1bmN0aW9uKTogc3RyaW5nIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuY2xhc3MgTGFtYmRhVXJsIGV4dGVuZHMgTGFtYmRhQWNjZXNzIHtcbiAgcHVibGljIGJpbmQoX2NvbnN0cnVjdDogQ29uc3RydWN0LCBfaWQ6IHN0cmluZywgbGFtYmRhRnVuY3Rpb246IGxhbWJkYS5GdW5jdGlvbik6IHN0cmluZyB7XG4gICAgcmV0dXJuIGxhbWJkYUZ1bmN0aW9uLmFkZEZ1bmN0aW9uVXJsKHtcbiAgICAgIGF1dGhUeXBlOiBGdW5jdGlvblVybEF1dGhUeXBlLk5PTkUsXG4gICAgfSkudXJsO1xuICB9XG59XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmNsYXNzIEFwaUdhdGV3YXkge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IHByb3BzPzogQXBpR2F0ZXdheUFjY2Vzc1Byb3BzKSB7fVxuXG4gIHB1YmxpYyBiaW5kKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGxhbWJkYUZ1bmN0aW9uOiBsYW1iZGEuRnVuY3Rpb24pOiBzdHJpbmcge1xuICAgIGxldCBwb2xpY3k6IGlhbS5Qb2xpY3lEb2N1bWVudDtcbiAgICBsZXQgZW5kcG9pbnRDb25maWc6IGFwaWdhdGV3YXkuRW5kcG9pbnRDb25maWd1cmF0aW9uIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgIGxldCB2cGNFbmRwb2ludDogZWMyLklWcGNFbmRwb2ludCB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICBjb25zdCByZWdpb24gPSBjZGsuU3RhY2sub2Yoc2NvcGUpLnJlZ2lvbjtcblxuICAgIGlmICh0aGlzLnByb3BzPy5hbGxvd2VkVnBjRW5kcG9pbnRzKSB7XG4gICAgICAvLyBwcml2YXRlIGFwaSBnYXRld2F5IHdpdGggZXhpc3RpbmcgdnBjIGVuZHBvaW50c1xuICAgICAgaWYgKHRoaXMucHJvcHM/LmFsbG93ZWRTZWN1cml0eUdyb3Vwcykge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2Yoc2NvcGUpLmFkZEVycm9yKCdhbGxvd2VkU2VjdXJpdHlHcm91cHMgY2Fubm90IGJlIHVzZWQgd2hlbiBhbGxvd2VkVnBjRW5kcG9pbnRzIGlzIHNwZWNpZmllZC4nKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnByb3BzPy5hbGxvd2VkSXBzKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZihzY29wZSkuYWRkRXJyb3IoJ2FsbG93ZWRJcHMgY2Fubm90IGJlIHVzZWQgd2hlbiBhbGxvd2VkVnBjRW5kcG9pbnRzIGlzIHNwZWNpZmllZC4nKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLnByb3BzPy5hbGxvd2VkVnBjKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZihzY29wZSkuYWRkRXJyb3IoJ2FsbG93ZWRWcGMgY2Fubm90IGJlIHVzZWQgd2hlbiBhbGxvd2VkVnBjRW5kcG9pbnRzIGlzIHNwZWNpZmllZC4nKTtcbiAgICAgIH1cblxuICAgICAgZW5kcG9pbnRDb25maWcgPSB7XG4gICAgICAgIHR5cGVzOiBbYXBpZ2F0ZXdheS5FbmRwb2ludFR5cGUuUFJJVkFURV0sXG4gICAgICAgIHZwY0VuZHBvaW50czogdGhpcy5wcm9wcy5hbGxvd2VkVnBjRW5kcG9pbnRzLFxuICAgICAgfTtcblxuICAgICAgcG9saWN5ID0gUG9saWN5RG9jdW1lbnQuZnJvbUpzb24oe1xuICAgICAgICBWZXJzaW9uOiAnMjAxMi0xMC0xNycsXG4gICAgICAgIFN0YXRlbWVudDogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIEVmZmVjdDogJ0FsbG93JyxcbiAgICAgICAgICAgIFByaW5jaXBhbDogJyonLFxuICAgICAgICAgICAgQWN0aW9uOiAnZXhlY3V0ZS1hcGk6SW52b2tlJyxcbiAgICAgICAgICAgIFJlc291cmNlOiAnZXhlY3V0ZS1hcGk6LyovKi8qJyxcbiAgICAgICAgICAgIENvbmRpdGlvbjoge1xuICAgICAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICAgICAnYXdzOlNvdXJjZVZwY2UnOiB0aGlzLnByb3BzLmFsbG93ZWRWcGNFbmRwb2ludHMubWFwKHZlID0+IHZlLnZwY0VuZHBvaW50SWQpLFxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgfSk7XG5cbiAgICAgIHZwY0VuZHBvaW50ID0gdGhpcy5wcm9wcy5hbGxvd2VkVnBjRW5kcG9pbnRzWzBdO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wcm9wcz8uYWxsb3dlZFZwYykge1xuICAgICAgLy8gcHJpdmF0ZSBhcGkgZ2F0ZXdheVxuICAgICAgY29uc3Qgc2cgPSBuZXcgZWMyLlNlY3VyaXR5R3JvdXAoc2NvcGUsIGAke2lkfS9TR2AsIHtcbiAgICAgICAgdnBjOiB0aGlzLnByb3BzLmFsbG93ZWRWcGMsXG4gICAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IHRydWUsXG4gICAgICB9KTtcblxuICAgICAgZm9yIChjb25zdCBvdGhlclNnIG9mIHRoaXMucHJvcHM/LmFsbG93ZWRTZWN1cml0eUdyb3VwcyA/PyBbXSkge1xuICAgICAgICBzZy5jb25uZWN0aW9ucy5hbGxvd0Zyb20ob3RoZXJTZywgZWMyLlBvcnQudGNwKDQ0MykpO1xuICAgICAgfVxuXG4gICAgICBmb3IgKGNvbnN0IGlwIG9mIHRoaXMucHJvcHM/LmFsbG93ZWRJcHMgPz8gW10pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBzZy5jb25uZWN0aW9ucy5hbGxvd0Zyb20oZWMyLlBlZXIuaXB2NChpcCksIGVjMi5Qb3J0LnRjcCg0NDMpKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gcG9vciBhdHRlbXB0IGF0IHN1cHBvcnRpbmcgYm90aCBJUHY0IGFuZCBJUHY2XG4gICAgICAgICAgLy8gd2UgY2FuJ3QgYWNjZXB0IGVjMi5JUGVlciBiZWNhdXNlIHRoYXQgZG9lc24ndCB3b3JrIGZvciBwdWJsaWMgQVBJIEdhdGV3YXlcbiAgICAgICAgICBzZy5jb25uZWN0aW9ucy5hbGxvd0Zyb20oZWMyLlBlZXIuaXB2NihpcCksIGVjMi5Qb3J0LnRjcCg0NDMpKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICB2cGNFbmRwb2ludCA9IG5ldyBlYzIuSW50ZXJmYWNlVnBjRW5kcG9pbnQoc2NvcGUsIGAke2lkfS9WcGNFbmRwb2ludGAsIHtcbiAgICAgICAgdnBjOiB0aGlzLnByb3BzLmFsbG93ZWRWcGMsXG4gICAgICAgIHNlcnZpY2U6IGVjMi5JbnRlcmZhY2VWcGNFbmRwb2ludEF3c1NlcnZpY2UuQVBJR0FURVdBWSxcbiAgICAgICAgcHJpdmF0ZURuc0VuYWJsZWQ6IGZhbHNlLFxuICAgICAgICBzZWN1cml0eUdyb3VwczogW3NnXSxcbiAgICAgICAgb3BlbjogZmFsc2UsXG4gICAgICB9KTtcblxuICAgICAgZW5kcG9pbnRDb25maWcgPSB7XG4gICAgICAgIHR5cGVzOiBbYXBpZ2F0ZXdheS5FbmRwb2ludFR5cGUuUFJJVkFURV0sXG4gICAgICAgIHZwY0VuZHBvaW50czogW3ZwY0VuZHBvaW50XSxcbiAgICAgIH07XG5cbiAgICAgIHBvbGljeSA9IFBvbGljeURvY3VtZW50LmZyb21Kc29uKHtcbiAgICAgICAgVmVyc2lvbjogJzIwMTItMTAtMTcnLFxuICAgICAgICBTdGF0ZW1lbnQ6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBFZmZlY3Q6ICdBbGxvdycsXG4gICAgICAgICAgICBQcmluY2lwYWw6ICcqJyxcbiAgICAgICAgICAgIEFjdGlvbjogJ2V4ZWN1dGUtYXBpOkludm9rZScsXG4gICAgICAgICAgICBSZXNvdXJjZTogJ2V4ZWN1dGUtYXBpOi8qLyovKicsXG4gICAgICAgICAgICBDb25kaXRpb246IHtcbiAgICAgICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAgICAgJ2F3czpTb3VyY2VWcGNlJzogdnBjRW5kcG9pbnQudnBjRW5kcG9pbnRJZCxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBwdWJsaWMgYXBpIGdhdGV3YXlcbiAgICAgIGlmICh0aGlzLnByb3BzPy5hbGxvd2VkU2VjdXJpdHlHcm91cHMpIHtcbiAgICAgICAgY2RrLkFubm90YXRpb25zLm9mKHNjb3BlKS5hZGRFcnJvcignYWxsb3dlZFNlY3VyaXR5R3JvdXBzIGNhbm5vdCBiZSB1c2VkIHdoZW4gYWxsb3dlZFZwYyBpcyBub3Qgc3BlY2lmaWVkLicpO1xuICAgICAgfVxuXG4gICAgICBwb2xpY3kgPSBQb2xpY3lEb2N1bWVudC5mcm9tSnNvbih7XG4gICAgICAgIFZlcnNpb246ICcyMDEyLTEwLTE3JyxcbiAgICAgICAgU3RhdGVtZW50OiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgRWZmZWN0OiAnQWxsb3cnLFxuICAgICAgICAgICAgUHJpbmNpcGFsOiAnKicsXG4gICAgICAgICAgICBBY3Rpb246ICdleGVjdXRlLWFwaTpJbnZva2UnLFxuICAgICAgICAgICAgUmVzb3VyY2U6ICdleGVjdXRlLWFwaTovKi8qLyonLFxuICAgICAgICAgICAgQ29uZGl0aW9uOiB7XG4gICAgICAgICAgICAgIElwQWRkcmVzczoge1xuICAgICAgICAgICAgICAgICdhd3M6U291cmNlSXAnOiB0aGlzLnByb3BzPy5hbGxvd2VkSXBzID8/IFsnMC4wLjAuMC8wJ10sXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBjb25zdCBhcGkgPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFSZXN0QXBpKHNjb3BlLCBpZCwge1xuICAgICAgaGFuZGxlcjogbGFtYmRhRnVuY3Rpb24sXG4gICAgICBwcm94eTogdHJ1ZSxcbiAgICAgIGNsb3VkV2F0Y2hSb2xlOiBmYWxzZSxcbiAgICAgIGVuZHBvaW50Q29uZmlndXJhdGlvbjogZW5kcG9pbnRDb25maWcsXG4gICAgICBwb2xpY3ksXG4gICAgfSk7XG5cbiAgICAvLyByZW1vdmUgQ2ZuT3V0cHV0XG4gICAgYXBpLm5vZGUudHJ5UmVtb3ZlQ2hpbGQoJ0VuZHBvaW50Jyk7XG5cbiAgICBpZiAodnBjRW5kcG9pbnQpIHtcbiAgICAgIC8vIGVuYWJsaW5nIHByaXZhdGUgRE5TIGFmZmVjdHMgdGhlIGVudGlyZSBWUEMsIHNvIHdlIHVzZSB0aGUgUm91dGU1MyBhbGlhcyBpbnN0ZWFkXG4gICAgICAvLyBodHRwczovL2RvY3MuYXdzLmFtYXpvbi5jb20vYXBpZ2F0ZXdheS9sYXRlc3QvZGV2ZWxvcGVyZ3VpZGUvYXBpZ2F0ZXdheS1wcml2YXRlLWFwaS10ZXN0LWludm9rZS11cmwuaHRtbFxuICAgICAgcmV0dXJuIGBodHRwczovLyR7YXBpLnJlc3RBcGlJZH0tJHt2cGNFbmRwb2ludC52cGNFbmRwb2ludElkfS5leGVjdXRlLWFwaS4ke3JlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke2FwaS5kZXBsb3ltZW50U3RhZ2Uuc3RhZ2VOYW1lfWA7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFwaS51cmw7XG4gIH1cbn1cbiJdfQ==