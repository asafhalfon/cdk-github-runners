"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Secrets = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk = require("aws-cdk-lib");
const constructs_1 = require("constructs");
/**
 * Secrets required for GitHub runners operation.
 */
class Secrets extends constructs_1.Construct {
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
            secretStringValue: cdk.SecretValue.unsafePlainText('-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----'),
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
_a = JSII_RTTI_SYMBOL_1;
Secrets[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.Secrets", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjcmV0cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9zZWNyZXRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsNkNBQW1FO0FBQ25FLG1DQUFtQztBQUNuQywyQ0FBdUM7QUFFdkM7O0dBRUc7QUFDSCxNQUFhLE9BQVEsU0FBUSxzQkFBUztJQTBCcEMsWUFBWSxLQUFnQixFQUFFLEVBQVU7UUFDdEMsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksZ0NBQWMsQ0FBQyxNQUFNLENBQ3RDLElBQUksRUFDSixTQUFTLEVBQ1Q7WUFDRSxXQUFXLEVBQUUsK09BQStPO1lBQzVQLG9CQUFvQixFQUFFO2dCQUNwQixvQkFBb0IsRUFBRSxJQUFJO2dCQUMxQixpQkFBaUIsRUFBRSxlQUFlO2dCQUNsQyxZQUFZLEVBQUUsS0FBSztnQkFDbkIsa0JBQWtCLEVBQUUsSUFBSTthQUN6QjtTQUNGLENBQ0YsQ0FBQztRQUVGLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLE1BQU0sQ0FDckMsSUFBSSxFQUNKLFFBQVEsRUFDUjtZQUNFLFdBQVcsRUFBRSx3UUFBd1E7WUFDclIsb0JBQW9CLEVBQUU7Z0JBQ3BCLG9CQUFvQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7b0JBQ25DLE1BQU0sRUFBRSxZQUFZO29CQUNwQixLQUFLLEVBQUUsRUFBRTtvQkFDVCxpQkFBaUIsRUFBRSxFQUFFO29CQUNyQixpSEFBaUg7b0JBQ2pILHNCQUFzQjtpQkFDdkIsQ0FBQztnQkFDRixpQkFBaUIsRUFBRSxPQUFPO2dCQUMxQixZQUFZLEVBQUUsS0FBSztnQkFDbkIsa0JBQWtCLEVBQUUsSUFBSTthQUN6QjtTQUNGLENBQ0YsQ0FBQztRQUVGLHlHQUF5RztRQUN6RyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxnQ0FBYyxDQUFDLE1BQU0sQ0FDL0MsSUFBSSxFQUNKLG9CQUFvQixFQUNwQjtZQUNFLFdBQVcsRUFBRSxtUkFBbVI7WUFDaFMsaUJBQWlCLEVBQUUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxlQUFlLENBQUMscUVBQXFFLENBQUM7U0FDMUgsQ0FDRixDQUFDO1FBRUYsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLGdDQUFjLENBQUMsTUFBTSxDQUNwQyxJQUFJLEVBQ0osT0FBTyxFQUNQO1lBQ0UsV0FBVyxFQUFFLDRWQUE0VjtZQUN6VyxvQkFBb0IsRUFBRTtnQkFDcEIsb0JBQW9CLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDbkMsS0FBSyxFQUFFLEVBQUU7aUJBQ1YsQ0FBQztnQkFDRixpQkFBaUIsRUFBRSxPQUFPO2dCQUMxQixZQUFZLEVBQUUsS0FBSztnQkFDbkIsa0JBQWtCLEVBQUUsSUFBSTthQUN6QjtTQUNGLENBQ0YsQ0FBQztJQUNKLENBQUM7O0FBeEZILDBCQXlGQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IGF3c19zZWNyZXRzbWFuYWdlciBhcyBzZWNyZXRzbWFuYWdlciB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuLyoqXG4gKiBTZWNyZXRzIHJlcXVpcmVkIGZvciBHaXRIdWIgcnVubmVycyBvcGVyYXRpb24uXG4gKi9cbmV4cG9ydCBjbGFzcyBTZWNyZXRzIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgLyoqXG4gICAqIFdlYmhvb2sgc2VjcmV0IHVzZWQgdG8gY29uZmlybSBldmVudHMgYXJlIGNvbWluZyBmcm9tIEdpdEh1YiBhbmQgbm93aGVyZSBlbHNlLlxuICAgKi9cbiAgcmVhZG9ubHkgd2ViaG9vazogc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuXG4gIC8qKlxuICAgKiBBdXRoZW50aWNhdGlvbiBzZWNyZXQgZm9yIEdpdEh1YiBjb250YWluaW5nIGVpdGhlciBhcHAgZGV0YWlscyBvciBwZXJzb25hbCBhY2Nlc3MgdG9rZW4uIFRoaXMgc2VjcmV0IGlzIHVzZWQgdG8gcmVnaXN0ZXIgcnVubmVycyBhbmRcbiAgICogY2FuY2VsIGpvYnMgd2hlbiB0aGUgcnVubmVyIGZhaWxzIHRvIHN0YXJ0LlxuICAgKlxuICAgKiBUaGlzIHNlY3JldCBpcyBtZWFudCB0byBiZSBlZGl0ZWQgYnkgdGhlIHVzZXIgYWZ0ZXIgYmVpbmcgY3JlYXRlZC5cbiAgICovXG4gIHJlYWRvbmx5IGdpdGh1Yjogc2VjcmV0c21hbmFnZXIuU2VjcmV0O1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgYXBwIHByaXZhdGUga2V5LiBOb3QgbmVlZGVkIHdoZW4gdXNpbmcgcGVyc29uYWwgYWNjZXNzIHRva2Vucy5cbiAgICpcbiAgICogVGhpcyBzZWNyZXQgaXMgbWVhbnQgdG8gYmUgZWRpdGVkIGJ5IHRoZSB1c2VyIGFmdGVyIGJlaW5nIGNyZWF0ZWQuIEl0IGlzIHNlcGFyYXRlIHRoYW4gdGhlIG1haW4gR2l0SHViIHNlY3JldCBiZWNhdXNlIGluc2VydGluZyBwcml2YXRlIGtleXMgaW50byBKU09OIGlzIGhhcmQuXG4gICAqL1xuICByZWFkb25seSBnaXRodWJQcml2YXRlS2V5OiBzZWNyZXRzbWFuYWdlci5TZWNyZXQ7XG5cbiAgLyoqXG4gICAqIFNldHVwIHNlY3JldCB1c2VkIHRvIGF1dGhlbnRpY2F0ZSB1c2VyIGZvciBvdXIgc2V0dXAgd2l6YXJkLiBTaG91bGQgYmUgZW1wdHkgYWZ0ZXIgc2V0dXAgaGFzIGJlZW4gY29tcGxldGVkLlxuICAgKi9cbiAgcmVhZG9ubHkgc2V0dXA6IHNlY3JldHNtYW5hZ2VyLlNlY3JldDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIHRoaXMud2ViaG9vayA9IG5ldyBzZWNyZXRzbWFuYWdlci5TZWNyZXQoXG4gICAgICB0aGlzLFxuICAgICAgJ1dlYmhvb2snLFxuICAgICAge1xuICAgICAgICBkZXNjcmlwdGlvbjogJ1dlYmhvb2sgc2VjcmV0IHVzZWQgdG8gY29uZmlybSBldmVudHMgYXJlIGNvbWluZyBmcm9tIEdpdEh1YiBhbmQgbm93aGVyZSBlbHNlLiBUaGlzIHNlY3JldCBpcyB1c2VkIGZvciB3ZWJob29rIHNpZ25hdHVyZSB2YWxpZGF0aW9uLiBGb3Igc2V0dXAgaW5zdHJ1Y3Rpb25zLCBzZWUgaHR0cHM6Ly9naXRodWIuY29tL0Nsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMvYmxvYi9tYWluL1NFVFVQX0dJVEhVQi5tZCcsXG4gICAgICAgIGdlbmVyYXRlU2VjcmV0U3RyaW5nOiB7XG4gICAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6ICd7fScsXG4gICAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICd3ZWJob29rU2VjcmV0JyxcbiAgICAgICAgICBpbmNsdWRlU3BhY2U6IGZhbHNlLFxuICAgICAgICAgIGV4Y2x1ZGVQdW5jdHVhdGlvbjogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgKTtcblxuICAgIHRoaXMuZ2l0aHViID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldChcbiAgICAgIHRoaXMsXG4gICAgICAnR2l0SHViJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdBdXRoZW50aWNhdGlvbiBzZWNyZXQgZm9yIEdpdEh1YiBjb250YWluaW5nIGVpdGhlciBhcHAgZGV0YWlscyAoYXBwSWQpIG9yIHBlcnNvbmFsIGFjY2VzcyB0b2tlbiAocGVyc29uYWxBdXRoVG9rZW4pLiBUaGlzIHNlY3JldCBpcyB1c2VkIHRvIHJlZ2lzdGVyIHJ1bm5lcnMuIEZvciBzZXR1cCBpbnN0cnVjdGlvbnMsIHNlZSBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycy9ibG9iL21haW4vU0VUVVBfR0lUSFVCLm1kJyxcbiAgICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgICBzZWNyZXRTdHJpbmdUZW1wbGF0ZTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgZG9tYWluOiAnZ2l0aHViLmNvbScsXG4gICAgICAgICAgICBhcHBJZDogJycsXG4gICAgICAgICAgICBwZXJzb25hbEF1dGhUb2tlbjogJycsXG4gICAgICAgICAgICAvLyB3ZSBjYW4ndCB1bmNvbW1lbnQgdGhlIGZvbGxvd2luZyBiZWNhdXNlIGNoYW5naW5nIHRoZSB0ZW1wbGF0ZSBvdmVycmlkZXMgZXhpc3RpbmcgdmFsdWVzIG9uIHZlcnNpb24gdXBncmFkZSA6KFxuICAgICAgICAgICAgLy8gcnVubmVyTGV2ZWw6ICdyZXBvJ1xuICAgICAgICAgIH0pLFxuICAgICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAnZHVtbXknLFxuICAgICAgICAgIGluY2x1ZGVTcGFjZTogZmFsc2UsXG4gICAgICAgICAgZXhjbHVkZVB1bmN0dWF0aW9uOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICApO1xuXG4gICAgLy8gd2UgY3JlYXRlIGEgc2VwYXJhdGUgc2VjcmV0IGZvciB0aGUgcHJpdmF0ZSBrZXkgYmVjYXVzZSBwdXR0aW5nIGl0IGluIEpTT04gc2VjcmV0IGlzIGhhcmQgZm9yIHRoZSB1c2VyXG4gICAgdGhpcy5naXRodWJQcml2YXRlS2V5ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldChcbiAgICAgIHRoaXMsXG4gICAgICAnR2l0SHViIFByaXZhdGUgS2V5JyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdHaXRIdWIgYXBwIHByaXZhdGUga2V5IChSU0EgcHJpdmF0ZSBrZXkgaW4gUEVNIGZvcm1hdCkuIFRoaXMgc2VjcmV0IGlzIG9ubHkgbmVlZGVkIHdoZW4gdXNpbmcgR2l0SHViIEFwcCBhdXRoZW50aWNhdGlvbi4gTm90IHJlcXVpcmVkIHdoZW4gdXNpbmcgcGVyc29uYWwgYWNjZXNzIHRva2Vucy4gRm9yIHNldHVwIGluc3RydWN0aW9ucywgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzL2Jsb2IvbWFpbi9TRVRVUF9HSVRIVUIubWQnLFxuICAgICAgICBzZWNyZXRTdHJpbmdWYWx1ZTogY2RrLlNlY3JldFZhbHVlLnVuc2FmZVBsYWluVGV4dCgnLS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLVxcbi4uLlxcbi0tLS0tRU5EIFJTQSBQUklWQVRFIEtFWS0tLS0tJyksXG4gICAgICB9LFxuICAgICk7XG5cbiAgICB0aGlzLnNldHVwID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldChcbiAgICAgIHRoaXMsXG4gICAgICAnU2V0dXAnLFxuICAgICAge1xuICAgICAgICBkZXNjcmlwdGlvbjogJ1NldHVwIHNlY3JldCB1c2VkIHRvIGF1dGhlbnRpY2F0ZSB1c2VycyBmb3IgdGhlIHNldHVwIHdpemFyZC4gVGhpcyBzZWNyZXQgY29udGFpbnMgYSB0ZW1wb3JhcnkgdG9rZW4gdGhhdCBzaG91bGQgYmUgZW1wdHkgYWZ0ZXIgc2V0dXAgaGFzIGJlZW4gY29tcGxldGVkLiBDaGVjayB0aGUgQ2xvdWRGb3JtYXRpb24gc3RhY2sgb3V0cHV0IGZvciB0aGUgc3RhdHVzIGNvbW1hbmQgdG8gZ2V0IHRoZSBmdWxsIHNldHVwIFVSTC4gRm9yIHNldHVwIGluc3RydWN0aW9ucywgc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzL2Jsb2IvbWFpbi9TRVRVUF9HSVRIVUIubWQnLFxuICAgICAgICBnZW5lcmF0ZVNlY3JldFN0cmluZzoge1xuICAgICAgICAgIHNlY3JldFN0cmluZ1RlbXBsYXRlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICB0b2tlbjogJycsXG4gICAgICAgICAgfSksXG4gICAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICd0b2tlbicsXG4gICAgICAgICAgaW5jbHVkZVNwYWNlOiBmYWxzZSxcbiAgICAgICAgICBleGNsdWRlUHVuY3R1YXRpb246IHRydWUsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgICk7XG4gIH1cbn1cbiJdfQ==