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
exports.StolenRunnerDetector = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const stolen_runner_handler_function_1 = require("./stolen-runner-handler-function");
const utils_1 = require("./utils");
/**
 * Remembers which jobs we start runners for, listens to runners reporting the jobs they pick up, and starts
 * another runner whenever one of ours runs a job we didn't start a runner for.
 *
 * We collect a set of jobs we started runners for.
 * Then for each job a runner picks up, we check if it was in that set.
 * If it wasn't in that set, the runner was stolen.
 * We start a new runner of the exact same type if it was stolen.
 *
 * @internal
 */
class StolenRunnerDetector extends constructs_1.Construct {
    /**
     * DynamoDB table holding the jobs we started runners for. Has TTL so data doesn't live here forever.
     */
    table;
    /**
     * Queue of runner reports waiting to be checked.
     */
    queue;
    /**
     * Function that checks assignments and starts replacement runners.
     */
    handler;
    ttlSeconds;
    constructor(scope, id, props) {
        super(scope, id);
        // leave record long enough for github's 24-hour job timeout + our step function 24 hour timeout
        this.ttlSeconds = cdk.Duration.days(3).toSeconds();
        this.table = new aws_cdk_lib_1.aws_dynamodb.Table(this, 'Jobs', {
            partitionKey: { name: 'pk', type: aws_cdk_lib_1.aws_dynamodb.AttributeType.STRING },
            billingMode: aws_cdk_lib_1.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
            timeToLiveAttribute: 'ttl',
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        this.queue = new aws_cdk_lib_1.aws_sqs.Queue(this, 'Queue', {
            // FIFO for the deduplication, not the ordering. a runner runs one job, so it has exactly one thing to tell
            // us, but we hear it twice: once from the workflow_job.in_progress webhook and once from the runner's log.
            // sending both with MessageDeduplicationId set to the runner name will only allow the first message.
            // this saves us on extra work and protects from buggy or malicious runners reporting too much.
            // deduplication is a fixed five minute window.
            fifo: true,
            // delay testing runner reports by a minute to give workflow_job.queued webhook a chance to arrive and be recorded
            deliveryDelay: cdk.Duration.minutes(1),
            visibilityTimeout: cdk.Duration.minutes(3),
            // a report is only worth acting on while the abandoned job is still waiting for a runner, so there is no
            // point keeping one for days. this also bounds anything that fails forever without needing a dead letter
            // queue full of reports nobody will ever look at.
            retentionPeriod: cdk.Duration.hours(1),
        });
        this.handler = new stolen_runner_handler_function_1.StolenRunnerHandlerFunction(this, 'Handler', {
            description: 'Detect GitHub Actions runners stolen by other jobs and start a new runner for the abandoned job',
            environment: {
                GITHUB_SECRET_ARN: props.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: props.secrets.githubPrivateKey.secretArn,
                STEP_FUNCTION_ARN: props.orchestrator.stateMachineArn,
                RUNNER_TRACKER_TABLE: this.table.tableName,
                RUNNER_TRACKER_TTL_SECONDS: `${this.ttlSeconds}`,
                JOB_ASSIGNMENT_QUEUE_URL: this.queue.queueUrl,
                ...props.extraLambdaEnv,
            },
            timeout: cdk.Duration.minutes(2),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            ...props.extraLambdaProps,
        });
        this.handler.addEventSource(new aws_cdk_lib_1.aws_lambda_event_sources.SqsEventSource(this.queue, {
            reportBatchItemFailures: true,
            batchSize: 10,
        }));
        this.table.grantReadWriteData(this.handler);
        this.queue.grantSendMessages(this.handler);
        props.secrets.github.grantRead(this.handler);
        props.secrets.githubPrivateKey.grantRead(this.handler);
        props.orchestrator.grantStartExecution(this.handler);
        props.orchestrator.grantExecution(this.handler, 'states:DescribeExecution');
        // runners report which job they were handed the moment it's assigned, by printing a line to their own log.
        // that's the only signal we can safely get from a runner that might be running in an isolated subnet or without permissions.
        // runners also technically run untrusted code so we don't want to give them credentials to call API or touch a queue or anything like that.
        const destination = new aws_cdk_lib_1.aws_logs_destinations.LambdaDestination(this.handler, { addPermissions: false /* too many resources */ });
        this.handler.addPermission('Runner Reports', {
            principal: new aws_cdk_lib_1.aws_iam.ServicePrincipal('logs.amazonaws.com'),
            sourceArn: cdk.Stack.of(this).formatArn({
                service: 'logs',
                resource: 'log-group',
                resourceName: '*',
                arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
            }),
            sourceAccount: cdk.Stack.of(this).account,
        });
        const permNode = this.handler.node.findChild('Runner Reports');
        for (const logGroup of props.runnerLogGroups) {
            const sub = new aws_cdk_lib_1.aws_logs.SubscriptionFilter(this, `Runner Reports ${logGroup.node.addr.slice(0, 8)}`, {
                logGroup,
                destination,
                filterPattern: aws_cdk_lib_1.aws_logs.FilterPattern.literal('"CDKGHR JOB RUNNER="'),
            });
            sub.node.addDependency(permNode);
        }
    }
    grantRecordRunners(func) {
        func.addEnvironment('RUNNER_TRACKER_TABLE', this.table.tableName);
        func.addEnvironment('RUNNER_TRACKER_TTL_SECONDS', `${this.ttlSeconds}`);
        this.table.grantReadWriteData(func);
    }
}
exports.StolenRunnerDetector = StolenRunnerDetector;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvbGVuLXJ1bm5lcnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvc3RvbGVuLXJ1bm5lcnMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLDZDQVNxQjtBQUNyQiwyQ0FBdUM7QUFFdkMscUZBQStFO0FBQy9FLG1DQUE4RDtBQWtDOUQ7Ozs7Ozs7Ozs7R0FVRztBQUNILE1BQWEsb0JBQXFCLFNBQVEsc0JBQVM7SUFDakQ7O09BRUc7SUFDTSxLQUFLLENBQWlCO0lBRS9COztPQUVHO0lBQ00sS0FBSyxDQUFZO0lBRTFCOztPQUVHO0lBQ00sT0FBTyxDQUE4QjtJQUU3QixVQUFVLENBQVM7SUFFcEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFnQztRQUN4RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLGdHQUFnRztRQUNoRyxJQUFJLENBQUMsVUFBVSxHQUFHLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBRW5ELElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSwwQkFBUSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsTUFBTSxFQUFFO1lBQzVDLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLDBCQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNqRSxXQUFXLEVBQUUsMEJBQVEsQ0FBQyxXQUFXLENBQUMsZUFBZTtZQUNqRCxtQkFBbUIsRUFBRSxLQUFLO1lBQzFCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLHFCQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7WUFDeEMsMkdB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REEyR0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHtcbiAgYXdzX2R5bmFtb2RiIGFzIGR5bmFtb2RiLFxuICBhd3NfaWFtIGFzIGlhbSxcbiAgYXdzX2xhbWJkYSBhcyBsYW1iZGEsXG4gIGF3c19sYW1iZGFfZXZlbnRfc291cmNlcyBhcyBsYW1iZGFfZXZlbnRfc291cmNlcyxcbiAgYXdzX2xvZ3MgYXMgbG9ncyxcbiAgYXdzX2xvZ3NfZGVzdGluYXRpb25zIGFzIGxvZ3NfZGVzdGluYXRpb25zLFxuICBhd3Nfc3FzIGFzIHNxcyxcbiAgYXdzX3N0ZXBmdW5jdGlvbnMgYXMgc3RlcGZ1bmN0aW9ucyxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBTZWNyZXRzIH0gZnJvbSAnLi9zZWNyZXRzJztcbmltcG9ydCB7IFN0b2xlblJ1bm5lckhhbmRsZXJGdW5jdGlvbiB9IGZyb20gJy4vc3RvbGVuLXJ1bm5lci1oYW5kbGVyLWZ1bmN0aW9uJztcbmltcG9ydCB7IHNpbmdsZXRvbkxvZ0dyb3VwLCBTaW5nbGV0b25Mb2dUeXBlIH0gZnJvbSAnLi91dGlscyc7XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgU3RvbGVuUnVubmVyRGV0ZWN0b3IuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RvbGVuUnVubmVyRGV0ZWN0b3JQcm9wcyB7XG4gIC8qKlxuICAgKiBTZWNyZXRzIHVzZWQgdG8gY29tbXVuaWNhdGUgd2l0aCBHaXRIdWIuXG4gICAqL1xuICByZWFkb25seSBzZWNyZXRzOiBTZWNyZXRzO1xuXG4gIC8qKlxuICAgKiBTdGVwIGZ1bmN0aW9uIHRoYXQgc3RhcnRzIHJ1bm5lcnMuIFVzZWQgdG8gc3RhcnQgcmVwbGFjZW1lbnQgcnVubmVycyBhbmQgdG8ga25vdyB3aGVuIHJ1bm5lcnMgYXJlIGRvbmUuXG4gICAqL1xuICByZWFkb25seSBvcmNoZXN0cmF0b3I6IHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lO1xuXG4gIC8qKlxuICAgKiBMb2cgZ3JvdXBzIHRoZSBydW5uZXJzIHdyaXRlIHRvLiBSdW5uZXJzIHJlcG9ydCB3aGljaCBqb2IgbGFuZGVkIG9uIHRoZW0sIGFuZCB0aGlzIGlzIHdoZXJlIHRob3NlIHJlcG9ydHMgY29tZSBvdXQuXG4gICAqL1xuICByZWFkb25seSBydW5uZXJMb2dHcm91cHM6IGxvZ3MuSUxvZ0dyb3VwW107XG5cbiAgLyoqXG4gICAqIEFkZGl0aW9uYWwgTGFtYmRhIGZ1bmN0aW9uIG9wdGlvbnMgKFZQQywgc2VjdXJpdHkgZ3JvdXBzLCBsYXllcnMsIGV0Yy4pLlxuICAgKi9cbiAgcmVhZG9ubHkgZXh0cmFMYW1iZGFQcm9wcz86IGxhbWJkYS5GdW5jdGlvbk9wdGlvbnM7XG5cbiAgLyoqXG4gICAqIEFkZGl0aW9uYWwgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciB0aGUgTGFtYmRhIGZ1bmN0aW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgZXh0cmFMYW1iZGFFbnY/OiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9O1xufVxuXG4vKipcbiAqIFJlbWVtYmVycyB3aGljaCBqb2JzIHdlIHN0YXJ0IHJ1bm5lcnMgZm9yLCBsaXN0ZW5zIHRvIHJ1bm5lcnMgcmVwb3J0aW5nIHRoZSBqb2JzIHRoZXkgcGljayB1cCwgYW5kIHN0YXJ0c1xuICogYW5vdGhlciBydW5uZXIgd2hlbmV2ZXIgb25lIG9mIG91cnMgcnVucyBhIGpvYiB3ZSBkaWRuJ3Qgc3RhcnQgYSBydW5uZXIgZm9yLlxuICpcbiAqIFdlIGNvbGxlY3QgYSBzZXQgb2Ygam9icyB3ZSBzdGFydGVkIHJ1bm5lcnMgZm9yLlxuICogVGhlbiBmb3IgZWFjaCBqb2IgYSBydW5uZXIgcGlja3MgdXAsIHdlIGNoZWNrIGlmIGl0IHdhcyBpbiB0aGF0IHNldC5cbiAqIElmIGl0IHdhc24ndCBpbiB0aGF0IHNldCwgdGhlIHJ1bm5lciB3YXMgc3RvbGVuLlxuICogV2Ugc3RhcnQgYSBuZXcgcnVubmVyIG9mIHRoZSBleGFjdCBzYW1lIHR5cGUgaWYgaXQgd2FzIHN0b2xlbi5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNsYXNzIFN0b2xlblJ1bm5lckRldGVjdG9yIGV4dGVuZHMgQ29uc3RydWN0IHtcbiAgLyoqXG4gICAqIER5bmFtb0RCIHRhYmxlIGhvbGRpbmcgdGhlIGpvYnMgd2Ugc3RhcnRlZCBydW5uZXJzIGZvci4gSGFzIFRUTCBzbyBkYXRhIGRvZXNuJ3QgbGl2ZSBoZXJlIGZvcmV2ZXIuXG4gICAqL1xuICByZWFkb25seSB0YWJsZTogZHluYW1vZGIuVGFibGU7XG5cbiAgLyoqXG4gICAqIFF1ZXVlIG9mIHJ1bm5lciByZXBvcnRzIHdhaXRpbmcgdG8gYmUgY2hlY2tlZC5cbiAgICovXG4gIHJlYWRvbmx5IHF1ZXVlOiBzcXMuUXVldWU7XG5cbiAgLyoqXG4gICAqIEZ1bmN0aW9uIHRoYXQgY2hlY2tzIGFzc2lnbm1lbnRzIGFuZCBzdGFydHMgcmVwbGFjZW1lbnQgcnVubmVycy5cbiAgICovXG4gIHJlYWRvbmx5IGhhbmRsZXI6IFN0b2xlblJ1bm5lckhhbmRsZXJGdW5jdGlvbjtcblxuICBwcml2YXRlIHJlYWRvbmx5IHR0bFNlY29uZHM6IG51bWJlcjtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU3RvbGVuUnVubmVyRGV0ZWN0b3JQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICAvLyBsZWF2ZSByZWNvcmQgbG9uZyBlbm91Z2ggZm9yIGdpdGh1YidzIDI0LWhvdXIgam9iIHRpbWVvdXQgKyBvdXIgc3RlcCBmdW5jdGlvbiAyNCBob3VyIHRpbWVvdXRcbiAgICB0aGlzLnR0bFNlY29uZHMgPSBjZGsuRHVyYXRpb24uZGF5cygzKS50b1NlY29uZHMoKTtcblxuICAgIHRoaXMudGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0pvYnMnLCB7XG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3BrJywgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcgfSxcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXG4gICAgICB0aW1lVG9MaXZlQXR0cmlidXRlOiAndHRsJyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICB0aGlzLnF1ZXVlID0gbmV3IHNxcy5RdWV1ZSh0aGlzLCAnUXVldWUnLCB7XG4gICAgICAvLyBGSUZPIGZvciB0aGUgZGVkdXBsaWNhdGlvbiwgbm90IHRoZSBvcmRlcmluZy4gYSBydW5uZXIgcnVucyBvbmUgam9iLCBzbyBpdCBoYXMgZXhhY3RseSBvbmUgdGhpbmcgdG8gdGVsbFxuICAgICAgLy8gdXMsIGJ1dCB3ZSBoZWFyIGl0IHR3aWNlOiBvbmNlIGZyb20gdGhlIHdvcmtmbG93X2pvYi5pbl9wcm9ncmVzcyB3ZWJob29rIGFuZCBvbmNlIGZyb20gdGhlIHJ1bm5lcidzIGxvZy5cbiAgICAgIC8vIHNlbmRpbmcgYm90aCB3aXRoIE1lc3NhZ2VEZWR1cGxpY2F0aW9uSWQgc2V0IHRvIHRoZSBydW5uZXIgbmFtZSB3aWxsIG9ubHkgYWxsb3cgdGhlIGZpcnN0IG1lc3NhZ2UuXG4gICAgICAvLyB0aGlzIHNhdmVzIHVzIG9uIGV4dHJhIHdvcmsgYW5kIHByb3RlY3RzIGZyb20gYnVnZ3kgb3IgbWFsaWNpb3VzIHJ1bm5lcnMgcmVwb3J0aW5nIHRvbyBtdWNoLlxuICAgICAgLy8gZGVkdXBsaWNhdGlvbiBpcyBhIGZpeGVkIGZpdmUgbWludXRlIHdpbmRvdy5cbiAgICAgIGZpZm86IHRydWUsXG4gICAgICAvLyBkZWxheSB0ZXN0aW5nIHJ1bm5lciByZXBvcnRzIGJ5IGEgbWludXRlIHRvIGdpdmUgd29ya2Zsb3dfam9iLnF1ZXVlZCB3ZWJob29rIGEgY2hhbmNlIHRvIGFycml2ZSBhbmQgYmUgcmVjb3JkZWRcbiAgICAgIGRlbGl2ZXJ5RGVsYXk6IGNkay5EdXJhdGlvbi5taW51dGVzKDEpLFxuICAgICAgdmlzaWJpbGl0eVRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMpLFxuICAgICAgLy8gYSByZXBvcnQgaXMgb25seSB3b3J0aCBhY3Rpbmcgb24gd2hpbGUgdGhlIGFiYW5kb25lZCBqb2IgaXMgc3RpbGwgd2FpdGluZyBmb3IgYSBydW5uZXIsIHNvIHRoZXJlIGlzIG5vXG4gICAgICAvLyBwb2ludCBrZWVwaW5nIG9uZSBmb3IgZGF5cy4gdGhpcyBhbHNvIGJvdW5kcyBhbnl0aGluZyB0aGF0IGZhaWxzIGZvcmV2ZXIgd2l0aG91dCBuZWVkaW5nIGEgZGVhZCBsZXR0ZXJcbiAgICAgIC8vIHF1ZXVlIGZ1bGwgb2YgcmVwb3J0cyBub2JvZHkgd2lsbCBldmVyIGxvb2sgYXQuXG4gICAgICByZXRlbnRpb25QZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICB9KTtcblxuICAgIHRoaXMuaGFuZGxlciA9IG5ldyBTdG9sZW5SdW5uZXJIYW5kbGVyRnVuY3Rpb24odGhpcywgJ0hhbmRsZXInLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0RldGVjdCBHaXRIdWIgQWN0aW9ucyBydW5uZXJzIHN0b2xlbiBieSBvdGhlciBqb2JzIGFuZCBzdGFydCBhIG5ldyBydW5uZXIgZm9yIHRoZSBhYmFuZG9uZWQgam9iJyxcbiAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgIEdJVEhVQl9TRUNSRVRfQVJOOiBwcm9wcy5zZWNyZXRzLmdpdGh1Yi5zZWNyZXRBcm4sXG4gICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiBwcm9wcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICBTVEVQX0ZVTkNUSU9OX0FSTjogcHJvcHMub3JjaGVzdHJhdG9yLnN0YXRlTWFjaGluZUFybixcbiAgICAgICAgUlVOTkVSX1RSQUNLRVJfVEFCTEU6IHRoaXMudGFibGUudGFibGVOYW1lLFxuICAgICAgICBSVU5ORVJfVFJBQ0tFUl9UVExfU0VDT05EUzogYCR7dGhpcy50dGxTZWNvbmRzfWAsXG4gICAgICAgIEpPQl9BU1NJR05NRU5UX1FVRVVFX1VSTDogdGhpcy5xdWV1ZS5xdWV1ZVVybCxcbiAgICAgICAgLi4ucHJvcHMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICB9LFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMiksXG4gICAgICBsb2dHcm91cDogc2luZ2xldG9uTG9nR3JvdXAodGhpcywgU2luZ2xldG9uTG9nVHlwZS5PUkNIRVNUUkFUT1IpLFxuICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgIC4uLnByb3BzLmV4dHJhTGFtYmRhUHJvcHMsXG4gICAgfSk7XG5cbiAgICB0aGlzLmhhbmRsZXIuYWRkRXZlbnRTb3VyY2UobmV3IGxhbWJkYV9ldmVudF9zb3VyY2VzLlNxc0V2ZW50U291cmNlKHRoaXMucXVldWUsIHtcbiAgICAgIHJlcG9ydEJhdGNoSXRlbUZhaWx1cmVzOiB0cnVlLFxuICAgICAgYmF0Y2hTaXplOiAxMCxcbiAgICB9KSk7XG5cbiAgICB0aGlzLnRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YSh0aGlzLmhhbmRsZXIpO1xuICAgIHRoaXMucXVldWUuZ3JhbnRTZW5kTWVzc2FnZXModGhpcy5oYW5kbGVyKTtcbiAgICBwcm9wcy5zZWNyZXRzLmdpdGh1Yi5ncmFudFJlYWQodGhpcy5oYW5kbGVyKTtcbiAgICBwcm9wcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuZ3JhbnRSZWFkKHRoaXMuaGFuZGxlcik7XG4gICAgcHJvcHMub3JjaGVzdHJhdG9yLmdyYW50U3RhcnRFeGVjdXRpb24odGhpcy5oYW5kbGVyKTtcbiAgICBwcm9wcy5vcmNoZXN0cmF0b3IuZ3JhbnRFeGVjdXRpb24odGhpcy5oYW5kbGVyLCAnc3RhdGVzOkRlc2NyaWJlRXhlY3V0aW9uJyk7XG5cbiAgICAvLyBydW5uZXJzIHJlcG9ydCB3aGljaCBqb2IgdGhleSB3ZXJlIGhhbmRlZCB0aGUgbW9tZW50IGl0J3MgYXNzaWduZWQsIGJ5IHByaW50aW5nIGEgbGluZSB0byB0aGVpciBvd24gbG9nLlxuICAgIC8vIHRoYXQncyB0aGUgb25seSBzaWduYWwgd2UgY2FuIHNhZmVseSBnZXQgZnJvbSBhIHJ1bm5lciB0aGF0IG1pZ2h0IGJlIHJ1bm5pbmcgaW4gYW4gaXNvbGF0ZWQgc3VibmV0IG9yIHdpdGhvdXQgcGVybWlzc2lvbnMuXG4gICAgLy8gcnVubmVycyBhbHNvIHRlY2huaWNhbGx5IHJ1biB1bnRydXN0ZWQgY29kZSBzbyB3ZSBkb24ndCB3YW50IHRvIGdpdmUgdGhlbSBjcmVkZW50aWFscyB0byBjYWxsIEFQSSBvciB0b3VjaCBhIHF1ZXVlIG9yIGFueXRoaW5nIGxpa2UgdGhhdC5cbiAgICBjb25zdCBkZXN0aW5hdGlvbiA9IG5ldyBsb2dzX2Rlc3RpbmF0aW9ucy5MYW1iZGFEZXN0aW5hdGlvbih0aGlzLmhhbmRsZXIsIHsgYWRkUGVybWlzc2lvbnM6IGZhbHNlIC8qIHRvbyBtYW55IHJlc291cmNlcyAqLyB9KTtcbiAgICB0aGlzLmhhbmRsZXIuYWRkUGVybWlzc2lvbignUnVubmVyIFJlcG9ydHMnLCB7XG4gICAgICBwcmluY2lwYWw6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbG9ncy5hbWF6b25hd3MuY29tJyksXG4gICAgICBzb3VyY2VBcm46IGNkay5TdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICBzZXJ2aWNlOiAnbG9ncycsXG4gICAgICAgIHJlc291cmNlOiAnbG9nLWdyb3VwJyxcbiAgICAgICAgcmVzb3VyY2VOYW1lOiAnKicsXG4gICAgICAgIGFybkZvcm1hdDogY2RrLkFybkZvcm1hdC5DT0xPTl9SRVNPVVJDRV9OQU1FLFxuICAgICAgfSksXG4gICAgICBzb3VyY2VBY2NvdW50OiBjZGsuU3RhY2sub2YodGhpcykuYWNjb3VudCxcbiAgICB9KTtcbiAgICBjb25zdCBwZXJtTm9kZSA9IHRoaXMuaGFuZGxlci5ub2RlLmZpbmRDaGlsZCgnUnVubmVyIFJlcG9ydHMnKTtcblxuICAgIGZvciAoY29uc3QgbG9nR3JvdXAgb2YgcHJvcHMucnVubmVyTG9nR3JvdXBzKSB7XG4gICAgICBjb25zdCBzdWIgPSBuZXcgbG9ncy5TdWJzY3JpcHRpb25GaWx0ZXIodGhpcywgYFJ1bm5lciBSZXBvcnRzICR7bG9nR3JvdXAubm9kZS5hZGRyLnNsaWNlKDAsIDgpfWAsIHtcbiAgICAgICAgbG9nR3JvdXAsXG4gICAgICAgIGRlc3RpbmF0aW9uLFxuICAgICAgICBmaWx0ZXJQYXR0ZXJuOiBsb2dzLkZpbHRlclBhdHRlcm4ubGl0ZXJhbCgnXCJDREtHSFIgSk9CIFJVTk5FUj1cIicpLFxuICAgICAgfSk7XG4gICAgICBzdWIubm9kZS5hZGREZXBlbmRlbmN5KHBlcm1Ob2RlKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgZ3JhbnRSZWNvcmRSdW5uZXJzKGZ1bmM6IGxhbWJkYS5GdW5jdGlvbikge1xuICAgIGZ1bmMuYWRkRW52aXJvbm1lbnQoJ1JVTk5FUl9UUkFDS0VSX1RBQkxFJywgdGhpcy50YWJsZS50YWJsZU5hbWUpO1xuICAgIGZ1bmMuYWRkRW52aXJvbm1lbnQoJ1JVTk5FUl9UUkFDS0VSX1RUTF9TRUNPTkRTJywgYCR7dGhpcy50dGxTZWNvbmRzfWApO1xuICAgIHRoaXMudGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGZ1bmMpO1xuICB9XG59XG4iXX0=