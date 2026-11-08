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
exports.Secrets = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk = __importStar(require("aws-cdk-lib"));
const constructs_1 = require("constructs");
const lambda_common_1 = require("./lambda-common");
/**
 * Secrets required for GitHub runners operation.
 */
class Secrets extends constructs_1.Construct {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.Secrets", version: "0.0.0" };
    /**
     * Webhook secret used to confirm events are coming from GitHub and nowhere else.
     */
    webhook;
    /**
     * Authentication secret for GitHub containing either app details or personal access token. This secret is used to register runners and
     * cancel jobs when the runner fails to start.
     *
     * This secret is meant to be edited by the user after being created.
     */
    github;
    /**
     * GitHub app private key. Not needed when using personal access tokens.
     *
     * This secret is meant to be edited by the user after being created. It is separate than the main GitHub secret because inserting private keys into JSON is hard.
     */
    githubPrivateKey;
    /**
     * Setup secret used to authenticate user for our setup wizard. Should be empty after setup has been completed.
     */
    setup;
    constructor(scope, id) {
        super(scope, id);
        this.webhook = new aws_cdk_lib_1.aws_secretsmanager.Secret(this, 'Webhook', {
            description: 'Webhook secret used to confirm events are coming from GitHub and nowhere else. This secret is used for webhook signature validation. For setup instructions, see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md',
            generateSecretString: {
                secretStringTemplate: '{}',
                generateStringKey: 'webhookSecret',
                includeSpace: false,
                excludePunctuation: true,
            },
        });
        this.github = new aws_cdk_lib_1.aws_secretsmanager.Secret(this, 'GitHub', {
            description: 'Authentication secret for GitHub containing either app details (appId) or personal access token (personalAuthToken). This secret is used to register runners. For setup instructions, see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    domain: 'github.com',
                    appId: '',
                    personalAuthToken: '',
                    // we can't uncomment the following because changing the template overrides existing values on version upgrade :(
                    // runnerLevel: 'repo'
                }),
                generateStringKey: 'dummy',
                includeSpace: false,
                excludePunctuation: true,
            },
        });
        // we create a separate secret for the private key because putting it in JSON secret is hard for the user
        this.githubPrivateKey = new aws_cdk_lib_1.aws_secretsmanager.Secret(this, 'GitHub Private Key', {
            description: 'GitHub app private key (RSA private key in PEM format). This secret is only needed when using GitHub App authentication. Not required when using personal access tokens. For setup instructions, see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md',
            secretStringValue: cdk.SecretValue.unsafePlainText(lambda_common_1.GITHUB_PRIVATE_KEY_PLACEHOLDER),
        });
        this.setup = new aws_cdk_lib_1.aws_secretsmanager.Secret(this, 'Setup', {
            description: 'Setup secret used to authenticate users for the setup wizard. This secret contains a temporary token that should be empty after setup has been completed. Check the CloudFormation stack output for the status command to get the full setup URL. For setup instructions, see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    token: '',
                }),
                generateStringKey: 'token',
                includeSpace: false,
                excludePunctuation: true,
            },
        });
    }
}
exports.Secrets = Secrets;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjcmV0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9zZWNyZXRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSw2Q0FBbUU7QUFDbkUsaURBQW1DO0FBQ25DLDJDQUF1QztBQUN2QyxtREFBaUU7QUFFakU7O0dBRUc7QUFDSCxNQUFhLE9BQVEsU0FBUSxzQkFBUzs7SUFDcEM7O09BRUc7SUFDTSxPQUFPLENBQXdCO0lBRXhDOzs7OztPQUtHO0lBQ00sTUFBTSxDQUF3QjtJQUV2Qzs7OztPQUlHO0lBQ00sZ0JBQWdCLENBQXdCO0lBRWpEOztPQUVHO0lBQ00sS0FBSyxDQUF3QjtJQUV0QyxZQUFZLEtBQWdCLEVBQUUsRUFBVTtRQUN0QyxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLE1BQU0sQ0FDdEMsSUFBSSxFQUNKLFNBQVMsRUFDVDtZQUNFLFdBQVcsRUFBRSwrT0FBK087WUFDNVAsb0JBQW9CLEVBQUU7Z0JBQ3BCLG9CQUFvQixFQUFFLElBQUk7Z0JBQzFCLGlCQUFpQixFQUFFLGVBQWU7Z0JBQ2xDLFlBQVksRUFBRSxLQUFLO2dCQUNuQixrQkFBa0IsRUFBRSxJQUFJO2FBQ3pCO1NBQ0YsQ0FDRixDQUFDO1FBRUYsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLGdDQUFjLENBQUMsTUFBTSxDQUNyQyxJQUFJLEVBQ0osUUFBUSxFQUNSO1lBQ0UsV0FBVyxFQUFFLHdRQUF3UTtZQUNyUixvQkFBb0IsRUFBRTtnQkFDcEIsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDbkMsTUFBTSxFQUFFLFlBQVk7b0JBQ3BCLEtBQUssRUFBRSxFQUFFO29CQUNULGlCQUFpQixFQUFFLEVBQUU7b0JBQ3JCLGlIQUFpSDtvQkFDakgsc0JBQXNCO2lCQUN2QixDQUFDO2dCQUNGLGlCQUFpQixFQUFFLE9BQU87Z0JBQzFCLFlBQVksRUFBRSxLQUFLO2dCQUNuQixrQkFBa0IsRUFBRSxJQUFJO2FBQ3pCO1NBQ0YsQ0FDRixDQUFDO1FBRUYseUdBQXlHO1FBQ3pHLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLGdDQUFjLENBQUMsTUFBTSxDQUMvQyxJQUFJLEVBQ0osb0JBQW9CLEVBQ3BCO1lBQ0UsV0FBVyxFQUFFLG1SQUFtUjtZQUNoUyxpQkFBaUIsRUFBRSxHQUFHLENBQUMsV0FBVyxDQUFDLGVBQWUsQ0FBQyw4Q0FBOEIsQ0FBQztTQUNuRixDQUNGLENBQUM7UUFFRixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksZ0NBQWMsQ0FBQyxNQUFNLENBQ3BDLElBQUksRUFDSixPQUFPLEVBQ1A7WUFDRSxXQUFXLEVBQUUsNFZBQTRWO1lBQ3pXLG9CQUFvQixFQUFFO2dCQUNwQixvQkFBb0IsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQyxLQUFLLEVBQUUsRUFBRTtpQkFDVixDQUFDO2dCQUNGLGlCQUFpQixFQUFFLE9BQU87Z0JBQzFCLFlBQVksRUFBRSxLQUFLO2dCQUNuQixrQkFBa0IsRUFBRSxJQUFJO2FBQ3pCO1NBQ0YsQ0FDRixDQUFDO0lBQ0osQ0FBQzs7QUF4RkgsMEJBeUZDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXdzX3NlY3JldHNtYW5hZ2VyIGFzIHNlY3JldHNtYW5hZ2VyIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgR0lUSFVCX1BSSVZBVEVfS0VZX1BMQUNFSE9MREVSIH0gZnJvbSAnLi9sYW1iZGEtY29tbW9uJztcblxuLyoqXG4gKiBTZWNyZXRzIHJlcXVpcmVkIGZvciBHaXRIdWIgcnVubmVycyBvcGVyYXRpb24uXG4gKi9cbmV4cG9ydCBjbGFzcyBTZWNyZXRzIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgLyoqXG4gICAqIFdlYmhvb2sgc2VjcmV0IHVzZWQgdG8gY29uZmlybSBldmVudHMgYXJlIGNvbWluZyBmcm9tIEdpdEh1YiBhbmQgbm93aGVyZSBlbHNlLlxuICAgKi9cbiAgcmVhZG9ubHkgd2ViaG9vazogc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuXG4gIC8qKlxuICAgKiBBdXRoZW50aWNhdGlvbiBzZWNyZXQgZm9yIEdpdEh1YiBjb250YWluaW5nIGVpdGhlciBhcHAgZGV0YWlscyBvciBwZXJzb25hbCBhY2Nlc3MgdG9rZW4uIFRoaXMgc2VjcmV0IGlzIHVzZWQgdG8gcmVnaXN0ZXIgcnVubmVycyBhbmRcbiAgICogY2FuY2VsIGpvYnMgd2hlbiB0aGUgcnVubmVyIGZhaWxzIHRvIHN0YXJ0LlxuICAgKlxuICAgKiBUaGlzIHNlY3JldCBpcyBtZWFudCB0byBiZSBlZGl0ZWQgYnkgdGhlIHVzZXIgYWZ0ZXIgYmVpbmcgY3JlYXRlZC5cbiAgICovXG4gIHJlYWRvbmx5IGdpdGh1Yjogc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgYXBwIHByaXZhdGUga2V5LiBOb3QgbmVlZGVkIHdoZW4gdXNpbmcgcGVyc29uYWwgYWNjZXNzIHRva2Vucy5cbiAgICpcbiAgICogVGhpcyBzZWNyZXQgaXMgbWVhbnQgdG8gYmUgZWRpdGVkIGJ5IHRoZSB1c2VyIGFmdGVyIGJlaW5nIGNyZWF0ZWQuIEl0IGlzIHNlcGFyYXRlIHRoYW4gdGhlIG1haW4gR2l0SHViIHNlY3JldCBiZWNhdXNlIGluc2VydGluZyBwcml2YXRlIGtleXMgaW50byBKU09OIGlzIGhhcmQuXG4gICAqL1xuICByZWFkb25seSBnaXRodWJQcml2YXRlS2V5OiBzZWNyZXRzbWFuYWdlci5TZWNyZXQ7XG5cbiAgLyoqXG4gICAqIFNldHVwIHNlY3JldCB1c2VkIHRvIGF1dGhlbnRpY2F0ZSB1c2VyIGZvciBvdXIgc2V0dXAgd2l6YXJkLiBTaG91bGQgYmUgZW1wdHkgYWZ0ZXIgc2V0dXAgaGFzIGJlZW4gY29tcGxldGVkLlxuICAgKi9cbiAgcmVhZG9ubHkgc2V0dXA6IHNlY3JldHNtYW5hZ2VyLlNlY3JldDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIHRoaXMud2ViaG9vayA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQoXG4gICAgICB0aGlzLFxuICAgICAgJ1dlYmhvb2snLFxuICAgICAge1xuICAgICAgICBkZXNjcmlwdGlvbjogJ1dlYmhvb2sgc2VjcmV0IHVzZWQgdG8gY29uZmlybSBldmVudHMgYXJlIGNvbWluZyBmcm9tIEdpdEh1YiBhbmQgbm93aGVyZSBlbHNlLiBUaGlzIHNlY3JldCBpcyB1c2VkIGZvciB3ZWJob29rIHNpZ25hdHVyZSB2YWxpZGF0aW9uLiBGb3Igc2V0dXAgaW5zdHJ1Y3Rpb25zLCBzZWUgaHR0cHM6Ly9naXRodWIuY29tL0Nsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMvYmxvYi9tYWluL1NFVFVQX0dJVEhVQi5tZCcsXG4gICAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7XG4gICAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6ICd7fScsXG4gICAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICd3ZWJob29rU2VjcmV0JyxcbiAgICAgICAgICBpbmNsdWRlU3BhY2U6IGZhbHNlLFxuICAgICAgICAgIGV4Y2x1ZGVQdW5jdHVhdGlvbjogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMuZ2l0aHViID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldChcbiAgICAgIHRoaXMsXG4gICAgICAnR2l0SHViJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdBdXRoZW50aWNhdGlvbiBzZWNyZXQgZm9yIEdpdEh1YiBjb250YWluaW5nIGVpdGhlciBhcHAgZGV0YWlscyAoYXBwSWQpIG9yIHBlcnNvbmFsIGFjY2VzcyB0b2tlbiAocGVyc29uYWxBdXRoVG9rZW4pLiBUaGlzIHNlY3JldCBpcyB1c2VkIHRvIHJlZ2lzdGVyIHJ1bm5lcnMuIEZvciBzZXR1cCBpbnN0cnVjdGlvbnMsIHNlZSBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycy9ibG9iL21haW4vU0VUVVBfR0lUSFVCLm1kJyxcbiAgICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgICBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgZG9tYWluOiAnZ2l0aHViLmNvbScsXG4gICAgICAgICAgICBhcHBJZDogJycsXG4gICAgICAgICAgICBwZXJzb25hbEF1dGhUb2tlbjogJycsXG4gICAgICAgICAgICAvLyB3ZSBjYW4ndCB1bmNvbW1lbnQgdGhlIGZvbGxvd2luZyBiZWNhdXNlIGNoYW5naW5nIHRoZSB0ZW1wbGF0ZSBvdmVycmlkZXMgZXhpc3RpbmcgdmFsdWVzIG9uIHZlcnNpb24gdXBncmFkZSA6KFxuICAgICAgICAgICAgLy8gcnVubmVyTGV2ZWw6ICdyZXBvJ1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAnZHVtbXknLFxuICAgICAgICAgIGluY2x1ZGVTcGFjZTogZmFsc2UsXG4gICAgICAgICAgZXhjbHVkZVB1bmN0dWF0aW9uOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gd2UgY3JlYXRlIGEgc2VwYXJhdGUgc2VjcmV0IGZvciB0aGUgcHJpdmF0ZSBrZXkgYmVjYXVzZSBwdXR0aW5nIGl0IGluIEpTT04gc2VjcmV0IGlzIGhhcmQgZm9yIHRoZSB1c2VyXG4gICAgdGhpcy5naXRodWJQcml2YXRlS2V5ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldChcbiAgICAgIHRoaXMsXG4gICAgICAnR2l0SHViIFByaXZhdGUgS2V5JyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdHaXRIdWIgYXBwIHByaXZhdGUga2V5IChSU0EgcHJpdmF0ZSBrZXkgaW4gUEVNIGZvcm1hdCkuIFRoaXMgc2VjcmV0IGlzIG9ubHkgbmVlZGVkIHdoZW4gdXNpbmcgR2l0SHViIEFwcCBhdXRoZW50aWNhdGlvbi4gTm90IHJlcXVpcmVkIHdoZW4gdXNpbmcgcGVyc29uYWwgYWNjZXNzIHRva2Vucy4gRm9yIHNldHVwIGluc3RydWN0aW9ucywgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzL2Jsb2IvbWFpbi9TRVRVUF9HSVRIVUIubWQnLFxuICAgICAgICBzZWNyZXRTdHJpbmdWYWx1ZTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dChHSVRIVUJfUFJJVkFURV9LRVlfUExBQ0VIT0xERVIpLFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgdGhpcy5zZXR1cCA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQoXG4gICAgICB0aGlzLFxuICAgICAgJ1NldHVwJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdTZXR1cCBzZWNyZXQgdXNlZCB0byBhdXRoZW50aWNhdGUgdXNlcnMgZm9yIHRoZSBzZXR1cCB3aXphcmQuIFRoaXMgc2VjcmV0IGNvbnRhaW5zIGEgdGVtcG9yYXJ5IHRva2VuIHRoYXQgc2hvdWxkIGJlIGVtcHR5IGFmdGVyIHNldHVwIGhhcyBiZWVuIGNvbXBsZXRlZC4gQ2hlY2sgdGhlIENsb3VkRm9ybWF0aW9uIHN0YWNrIG91dHB1dCBmb3IgdGhlIHN0YXR1cyBjb21tYW5kIHRvIGdldCB0aGUgZnVsbCBzZXR1cCBVUkwuIEZvciBzZXR1cCBpbnN0cnVjdGlvbnMsIHNlZSBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycy9ibG9iL21haW4vU0VUVVBfR0lUSFVCLm1kJyxcbiAgICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgICBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgdG9rZW46ICcnLFxuICAgICAgICAgIH0pLFxuICAgICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAndG9rZW4nLFxuICAgICAgICAgIGluY2x1ZGVTcGFjZTogZmFsc2UsXG4gICAgICAgICAgZXhjbHVkZVB1bmN0dWF0aW9uOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuICB9XG59XG4iXX0=