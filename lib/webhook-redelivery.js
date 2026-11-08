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
exports.GithubWebhookRedelivery = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const utils_1 = require("./utils");
const webhook_redelivery_function_1 = require("./webhook-redelivery-function");
/**
 * Create a Lambda that runs every 5 minutes to check for Github webhook delivery failures and retry them.
 *
 * @internal
 */
class GithubWebhookRedelivery extends constructs_1.Construct {
    /**
     * Webhook redelivery lambda function.
     */
    handler;
    constructor(scope, id, props) {
        super(scope, id);
        this.handler = new webhook_redelivery_function_1.WebhookRedeliveryFunction(this, 'Lambda', {
            description: 'Check for GitHub webhook delivery failures and redeliver them',
            environment: {
                GITHUB_SECRET_ARN: props.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: props.secrets.githubPrivateKey.secretArn,
                ...props.extraLambdaEnv,
            },
            reservedConcurrentExecutions: 1, // avoid concurrent executions
            timeout: cdk.Duration.seconds(4.5 * 60), // 4.5 minutes
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            // applicationLogLevelV2: ApplicationLogLevel.DEBUG,
            ...props.extraLambdaProps,
        });
        props.secrets.github.grantRead(this.handler);
        props.secrets.githubPrivateKey.grantRead(this.handler);
        new aws_cdk_lib_1.aws_events.Rule(this, 'Schedule', {
            schedule: aws_cdk_lib_1.aws_events.Schedule.rate(cdk.Duration.minutes(5)),
            description: 'Schedule to run the webhook redelivery lambda every 5 minutes',
            targets: [
                new aws_cdk_lib_1.aws_events_targets.LambdaFunction(this.handler, {
                    retryAttempts: 0,
                }),
            ],
        });
    }
}
exports.GithubWebhookRedelivery = GithubWebhookRedelivery;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViaG9vay1yZWRlbGl2ZXJ5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL3dlYmhvb2stcmVkZWxpdmVyeS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsNkNBQStHO0FBQy9HLDJDQUF1QztBQUV2QyxtQ0FBOEQ7QUFDOUQsK0VBQTBFO0FBd0IxRTs7OztHQUlHO0FBQ0gsTUFBYSx1QkFBd0IsU0FBUSxzQkFBUztJQUNwRDs7T0FFRztJQUNNLE9BQU8sQ0FBNEI7SUFFNUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFtQztRQUMzRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSx1REFBeUIsQ0FDMUMsSUFBSSxFQUNKLFFBQVEsRUFDUjtZQUNFLFdBQVcsRUFBRSwrREFBK0Q7WUFDNUUsV0FBVyxFQUFFO2dCQUNYLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFNBQVM7Z0JBQ2pELDZCQUE2QixFQUFFLEtBQUssQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsU0FBUztnQkFDdkUsR0FBRyxLQUFLLENBQUMsY0FBYzthQUN4QjtZQUNELDRCQUE0QixFQUFFLENBQUMsRUFBRSw4QkFBOEI7WUFDL0QsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsRUFBRSxjQUFjO1lBQ3ZELFFBQVEsRUFBRSxJQUFBLHlCQUFpQixFQUFDLElBQUksRUFBRSx3QkFBZ0IsQ0FBQyxZQUFZLENBQUM7WUFDaEUsYUFBYSxFQUFFLHdCQUFNLENBQUMsYUFBYSxDQUFDLElBQUk7WUFDeEMsb0RBQW9EO1lBQ3BELEdBQUcsS0FBSyxDQUFDLGdCQUFnQjtTQUMxQixDQUNGLENBQUM7UUFFRixLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzdDLEtBQUssQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUV2RCxJQUFJLHdCQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDaEMsUUFBUSxFQUFFLHdCQUFNLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN2RCxXQUFXLEVBQUUsK0RBQStEO1lBQzVFLE9BQU8sRUFBRTtnQkFDUCxJQUFJLGdDQUFjLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUU7b0JBQzlDLGFBQWEsRUFBRSxDQUFDO2lCQUNqQixDQUFDO2FBQ0g7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF6Q0QsMERBeUNDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IGF3c19ldmVudHMgYXMgZXZlbnRzLCBhd3NfZXZlbnRzX3RhcmdldHMgYXMgZXZlbnRzX3RhcmdldHMsIGF3c19sYW1iZGEgYXMgbGFtYmRhIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBTZWNyZXRzIH0gZnJvbSAnLi9zZWNyZXRzJztcbmltcG9ydCB7IHNpbmdsZXRvbkxvZ0dyb3VwLCBTaW5nbGV0b25Mb2dUeXBlIH0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQgeyBXZWJob29rUmVkZWxpdmVyeUZ1bmN0aW9uIH0gZnJvbSAnLi93ZWJob29rLXJlZGVsaXZlcnktZnVuY3Rpb24nO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIEdpdGh1YldlYmhvb2tSZWRlbGl2ZXJ5XG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2l0aHViV2ViaG9va1JlZGVsaXZlcnlQcm9wcyB7XG4gIC8qKlxuICAgKiBTZWNyZXRzIHVzZWQgdG8gY29tbXVuaWNhdGUgd2l0aCBHaXRIdWIuXG4gICAqL1xuICByZWFkb25seSBzZWNyZXRzOiBTZWNyZXRzO1xuXG4gIC8qKlxuICAgKiBBZGRpdGlvbmFsIExhbWJkYSBmdW5jdGlvbiBvcHRpb25zIChWUEMsIHNlY3VyaXR5IGdyb3VwcywgbGF5ZXJzLCBldGMuKS5cbiAgICovXG4gIHJlYWRvbmx5IGV4dHJhTGFtYmRhUHJvcHM/OiBsYW1iZGEuRnVuY3Rpb25PcHRpb25zO1xuXG4gIC8qKlxuICAgKiBBZGRpdGlvbmFsIGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGV4dHJhTGFtYmRhRW52PzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBMYW1iZGEgdGhhdCBydW5zIGV2ZXJ5IDUgbWludXRlcyB0byBjaGVjayBmb3IgR2l0aHViIHdlYmhvb2sgZGVsaXZlcnkgZmFpbHVyZXMgYW5kIHJldHJ5IHRoZW0uXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjbGFzcyBHaXRodWJXZWJob29rUmVkZWxpdmVyeSBleHRlbmRzIENvbnN0cnVjdCB7XG4gIC8qKlxuICAgKiBXZWJob29rIHJlZGVsaXZlcnkgbGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgaGFuZGxlcjogV2ViaG9va1JlZGVsaXZlcnlGdW5jdGlvbjtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogR2l0aHViV2ViaG9va1JlZGVsaXZlcnlQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICB0aGlzLmhhbmRsZXIgPSBuZXcgV2ViaG9va1JlZGVsaXZlcnlGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnTGFtYmRhJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdDaGVjayBmb3IgR2l0SHViIHdlYmhvb2sgZGVsaXZlcnkgZmFpbHVyZXMgYW5kIHJlZGVsaXZlciB0aGVtJyxcbiAgICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgICBHSVRIVUJfU0VDUkVUX0FSTjogcHJvcHMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiBwcm9wcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICAgIC4uLnByb3BzLmV4dHJhTGFtYmRhRW52LFxuICAgICAgICB9LFxuICAgICAgICByZXNlcnZlZENvbmN1cnJlbnRFeGVjdXRpb25zOiAxLCAvLyBhdm9pZCBjb25jdXJyZW50IGV4ZWN1dGlvbnNcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoNC41ICogNjApLCAvLyA0LjUgbWludXRlc1xuICAgICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5PUkNIRVNUUkFUT1IpLFxuICAgICAgICBsb2dnaW5nRm9ybWF0OiBsYW1iZGEuTG9nZ2luZ0Zvcm1hdC5KU09OLFxuICAgICAgICAvLyBhcHBsaWNhdGlvbkxvZ0xldmVsVjI6IEFwcGxpY2F0aW9uTG9nTGV2ZWwuREVCVUcsXG4gICAgICAgIC4uLnByb3BzLmV4dHJhTGFtYmRhUHJvcHMsXG4gICAgICB9LFxuICAgICk7XG5cbiAgICBwcm9wcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQodGhpcy5oYW5kbGVyKTtcbiAgICBwcm9wcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuZ3JhbnRSZWFkKHRoaXMuaGFuZGxlcik7XG5cbiAgICBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1NjaGVkdWxlJywge1xuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKGNkay5EdXJhdGlvbi5taW51dGVzKDUpKSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2NoZWR1bGUgdG8gcnVuIHRoZSB3ZWJob29rIHJlZGVsaXZlcnkgbGFtYmRhIGV2ZXJ5IDUgbWludXRlcycsXG4gICAgICB0YXJnZXRzOiBbXG4gICAgICAgIG5ldyBldmVudHNfdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbih0aGlzLmhhbmRsZXIsIHtcbiAgICAgICAgICByZXRyeUF0dGVtcHRzOiAwLFxuICAgICAgICB9KSxcbiAgICAgIF0sXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==