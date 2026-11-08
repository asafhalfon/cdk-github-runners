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
exports.GithubWebhookHandler = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("path"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const access_1 = require("./access");
const lambda_common_1 = require("./lambda-common");
const utils_1 = require("./utils");
const webhook_handler_function_1 = require("./webhook-handler-function");
/**
 * Create a Lambda with a public URL to handle GitHub webhook events. After validating the event with the given secret, the orchestrator step function is called with information about the workflow job.
 *
 * @internal
 */
class GithubWebhookHandler extends constructs_1.Construct {
    /**
     * Public URL of webhook to be used with GitHub.
     */
    url;
    /**
     * Webhook event handler.
     */
    handler;
    constructor(scope, id, props) {
        super(scope, id);
        const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'providers-layer-'));
        let providersLayer;
        try {
            fs.writeFileSync(path.join(workdir, path.posix.basename(lambda_common_1.PROVIDERS_PATH)), JSON.stringify(props.providers));
            providersLayer = new aws_cdk_lib_1.aws_lambda.LayerVersion(this, 'Providers', {
                description: 'Runner providers and their labels',
                code: aws_cdk_lib_1.aws_lambda.Code.fromAsset(workdir),
            });
        }
        finally {
            // Calling `fromAsset()` has copied files to the assembly, so we can delete the temporary directory.
            fs.rmSync(path.join(workdir, path.posix.basename(lambda_common_1.PROVIDERS_PATH)));
            fs.rmdirSync(workdir);
        }
        this.handler = new webhook_handler_function_1.WebhookHandlerFunction(this, 'webhook-handler', {
            description: 'Handle GitHub webhook and start runner orchestrator',
            environment: {
                STEP_FUNCTION_ARN: props.orchestrator.stateMachineArn,
                WEBHOOK_SECRET_ARN: props.secrets.webhook.secretArn,
                GITHUB_SECRET_ARN: props.secrets.github.secretArn,
                GITHUB_PRIVATE_KEY_SECRET_ARN: props.secrets.githubPrivateKey.secretArn,
                REQUIRE_SELF_HOSTED_LABEL: props.requireSelfHostedLabel ? '1' : '0',
                PROVIDER_SELECTOR_ARN: props.providerSelector?.functionArn ?? '',
                IDLE_TIMEOUT_SECONDS: props.idleTimeoutSeconds?.toString() ?? '300', // default 5 minutes
                JOB_ASSIGNMENT_QUEUE_URL: props.stolenRunnerQueue.queueUrl,
                ...props.extraLambdaEnv,
            },
            timeout: cdk.Duration.seconds(31),
            logGroup: (0, utils_1.singletonLogGroup)(this, utils_1.SingletonLogType.ORCHESTRATOR),
            loggingFormat: aws_cdk_lib_1.aws_lambda.LoggingFormat.JSON,
            ...props.extraLambdaProps,
            layers: [...props.extraLambdaProps?.layers ?? [], providersLayer],
        });
        const access = props?.access ?? access_1.LambdaAccess.lambdaUrl();
        this.url = access.bind(this, 'access', this.handler);
        props.secrets.webhook.grantRead(this.handler);
        props.secrets.github.grantRead(this.handler);
        props.secrets.githubPrivateKey.grantRead(this.handler);
        props.orchestrator.grantStartExecution(this.handler);
        props.providerSelector?.grantInvoke(this.handler);
        props.stolenRunnerQueue.grantSendMessages(this.handler);
    }
}
exports.GithubWebhookHandler = GithubWebhookHandler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViaG9vay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy93ZWJob29rLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLHVDQUF5QjtBQUN6Qiw0Q0FBOEI7QUFDOUIsMkNBQTZCO0FBQzdCLGlEQUFtQztBQUNuQyw2Q0FBdUc7QUFDdkcsMkNBQXVDO0FBQ3ZDLHFDQUF3QztBQUN4QyxtREFBaUQ7QUFFakQsbUNBQThEO0FBQzlELHlFQUFvRTtBQWlIcEU7Ozs7R0FJRztBQUNILE1BQWEsb0JBQXFCLFNBQVEsc0JBQVM7SUFFakQ7O09BRUc7SUFDTSxHQUFHLENBQVM7SUFFckI7O09BRUc7SUFDTSxPQUFPLENBQXlCO0lBRXpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBZ0M7UUFDeEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixNQUFNLE9BQU8sR0FBRyxFQUFFLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLE1BQU0sRUFBRSxFQUFFLGtCQUFrQixDQUFDLENBQUMsQ0FBQztRQUMzRSxJQUFJLGNBQW1DLENBQUM7UUFDeEMsSUFBSSxDQUFDO1lBQ0gsRUFBRSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQyw4QkFBYyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO1lBQzNHLGNBQWMsR0FBRyxJQUFJLHdCQUFNLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxXQUFXLEVBQUU7Z0JBQzFELFdBQVcsRUFBRSxtQ0FBbUM7Z0JBQ2hELElBQUksRUFBRSx3QkFBTSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDO2FBQ3JDLENBQUMsQ0FBQztRQUNMLENBQUM7Z0JBQVMsQ0FBQztZQUNULG9HQUFvRztZQUNwRyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLDhCQUFjLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDbkUsRUFBRSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUN4QixDQUFDO1FBRUQsSUFBSSxDQUFDLE9BQU8sR0FBRyxJQUFJLGlEQUFzQixDQUN2QyxJQUFJLEVBQ0osaUJBQWlCLEVBQ2pCO1lBQ0UsV0FBVyxFQUFFLHFEQUFxRDtZQUNsRSxXQUFXLEVBQUU7Z0JBQ1gsaUJBQWlCLEVBQUUsS0FBSyxDQUFDLFlBQVksQ0FBQyxlQUFlO2dCQUNyRCxrQkFBa0IsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTO2dCQUNuRCxpQkFBaUIsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTO2dCQUNqRCw2QkFBNkIsRUFBRSxLQUFLLENBQUMsT0FBTyxDQUFDLGdCQUFnQixDQUFDLFNBQVM7Z0JBQ3ZFLHlCQUF5QixFQUFFLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHO2dCQUNuRSxxQkFBcUIsRUFBRSxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsV0FBVyxJQUFJLEVBQUU7Z0JBQ2hFLG9CQUFvQixFQUFFLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxRQUFRLEVBQUUsSUFBSSxLQUFLLEVBQUUsb0JBQW9CO2dCQUN6Rix3QkFBd0IsRUFBRSxLQUFLLENBQUMsaUJBQWlCLENBQUMsUUFBUTtnQkFDMUQsR0FBRyxLQUFLLENBQUMsY0FBYzthQUN4QjtZQUNELE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDakMsUUFBUSxFQUFFLElBQUEseUJBQWlCLEVBQUMsSUFBSSxFQUFFLHdCQUFnQixDQUFDLFlBQVksQ0FBQztZQUNoRSxhQUFhLEVBQUUsd0JBQU0sQ0FBQyxhQUFhLENBQUMsSUFBSTtZQUN4QyxHQUFHLEtBQUssQ0FBQyxnQkFBZ0I7WUFDekIsTUFBTSxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsZ0JBQWdCLEVBQUUsTUFBTSxJQUFJLEVBQUUsRUFBRSxjQUFjLENBQUM7U0FDbEUsQ0FDRixDQUFDO1FBRUYsTUFBTSxNQUFNLEdBQUcsS0FBSyxFQUFFLE1BQU0sSUFBSSxxQkFBWSxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ3pELElBQUksQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUVyRCxLQUFLLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzlDLEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDN0MsS0FBSyxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZELEtBQUssQ0FBQyxZQUFZLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3JELEtBQUssQ0FBQyxnQkFBZ0IsRUFBRSxXQUFXLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ2xELEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDMUQsQ0FBQztDQUNGO0FBL0RELG9EQStEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ25vZGU6b3MnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBhd3NfbGFtYmRhIGFzIGxhbWJkYSwgYXdzX3NxcyBhcyBzcXMsIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IExhbWJkYUFjY2VzcyB9IGZyb20gJy4vYWNjZXNzJztcbmltcG9ydCB7IFBST1ZJREVSU19QQVRIIH0gZnJvbSAnLi9sYW1iZGEtY29tbW9uJztcbmltcG9ydCB7IFNlY3JldHMgfSBmcm9tICcuL3NlY3JldHMnO1xuaW1wb3J0IHsgc2luZ2xldG9uTG9nR3JvdXAsIFNpbmdsZXRvbkxvZ1R5cGUgfSBmcm9tICcuL3V0aWxzJztcbmltcG9ydCB7IFdlYmhvb2tIYW5kbGVyRnVuY3Rpb24gfSBmcm9tICcuL3dlYmhvb2staGFuZGxlci1mdW5jdGlvbic7XG5cbi8qKlxuICogSW5wdXQgdG8gdGhlIHByb3ZpZGVyIHNlbGVjdG9yIExhbWJkYSBmdW5jdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQcm92aWRlclNlbGVjdG9ySW5wdXQge1xuICAvKipcbiAgICogRnVsbCBHaXRIdWIgd2ViaG9vayBwYXlsb2FkICh3b3JrZmxvd19qb2IgZXZlbnQgc3RydWN0dXJlIHdpdGggYWN0aW9uPVwicXVldWVkXCIpLlxuICAgKlxuICAgKiAqIE9yaWdpbmFsIGxhYmVscyByZXF1ZXN0ZWQgYnkgdGhlIHdvcmtmbG93IGpvYiBjYW4gYmUgZm91bmQgYXQgYHBheWxvYWQud29ya2Zsb3dfam9iLmxhYmVsc2AuXG4gICAqICogUmVwb3NpdG9yeSBwYXRoIChlLmcuIENsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMpIGlzIGF0IGBwYXlsb2FkLnJlcG9zaXRvcnkuZnVsbF9uYW1lYC5cbiAgICogKiBDb21taXQgaGFzaCBpcyBhdCBgcGF5bG9hZC53b3JrZmxvd19qb2IuaGVhZF9zaGFgLlxuICAgKlxuICAgKiBAc2VlIGh0dHBzOi8vZG9jcy5naXRodWIuY29tL2VuL3dlYmhvb2tzL3dlYmhvb2stZXZlbnRzLWFuZC1wYXlsb2Fkcz9hY3Rpb25UeXBlPXF1ZXVlZCN3b3JrZmxvd19qb2JcbiAgICovXG4gIHJlYWRvbmx5IHBheWxvYWQ6IGFueTtcblxuICAvKipcbiAgICogTWFwIG9mIGF2YWlsYWJsZSBwcm92aWRlciBub2RlIHBhdGhzIHRvIHRoZWlyIGNvbmZpZ3VyZWQgbGFiZWxzLlxuICAgKiBFeGFtcGxlOiB7IFwiTXlTdGFjay9TbWFsbFwiOiBbXCJsaW51eFwiLCBcInNtYWxsXCJdLCBcIk15U3RhY2svTGFyZ2VcIjogW1wibGludXhcIiwgXCJsYXJnZVwiXSB9XG4gICAqL1xuICByZWFkb25seSBwcm92aWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPjtcblxuICAvKipcbiAgICogUHJvdmlkZXIgbm9kZSBwYXRoIHRoYXQgd291bGQgaGF2ZSBiZWVuIHNlbGVjdGVkIGJ5IGRlZmF1bHQgbGFiZWwgbWF0Y2hpbmcuXG4gICAqIFVzZSB0aGlzIHRvIGVhc2lseSByZXR1cm4gdGhlIGRlZmF1bHQgc2VsZWN0aW9uOiBgeyBwcm92aWRlcjogaW5wdXQuZGVmYXVsdFByb3ZpZGVyLCBsYWJlbHM6IGlucHV0LmRlZmF1bHRMYWJlbHMgfWBcbiAgICogTWF5IGJlIHVuZGVmaW5lZCBpZiBubyBwcm92aWRlciBtYXRjaGVkIGJ5IGRlZmF1bHQuXG4gICAqL1xuICByZWFkb25seSBkZWZhdWx0UHJvdmlkZXI/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIExhYmVscyB0aGF0IHdvdWxkIGhhdmUgYmVlbiB1c2VkIGJ5IGRlZmF1bHQgKHRoZSBzZWxlY3RlZCBwcm92aWRlcidzIGxhYmVscykuXG4gICAqIE1heSBiZSB1bmRlZmluZWQgaWYgbm8gcHJvdmlkZXIgbWF0Y2hlZCBieSBkZWZhdWx0LlxuICAgKi9cbiAgcmVhZG9ubHkgZGVmYXVsdExhYmVscz86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIFJlc3VsdCBmcm9tIHRoZSBwcm92aWRlciBzZWxlY3RvciBMYW1iZGEgZnVuY3Rpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHJvdmlkZXJTZWxlY3RvclJlc3VsdCB7XG4gIC8qKlxuICAgKiBOb2RlIHBhdGggb2YgdGhlIHByb3ZpZGVyIHRvIHVzZSAoZS5nLiwgXCJNeVN0YWNrL015UHJvdmlkZXJcIikuXG4gICAqIE11c3QgbWF0Y2ggb25lIG9mIHRoZSBjb25maWd1cmVkIHByb3ZpZGVyIG5vZGUgcGF0aHMgZnJvbSB0aGUgaW5wdXQuXG4gICAqIElmIG5vdCBwcm92aWRlZCwgdGhlIGpvYiB3aWxsIGJlIHNraXBwZWQgKG5vIHJ1bm5lciBjcmVhdGVkKS5cbiAgICovXG4gIHJlYWRvbmx5IHByb3ZpZGVyPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBMYWJlbHMgdG8gdXNlIHdoZW4gcmVnaXN0ZXJpbmcgdGhlIHJ1bm5lci5cbiAgICogTXVzdCBiZSByZXR1cm5lZCB3aGVuIGEgcHJvdmlkZXIgaXMgc2VsZWN0ZWQuXG4gICAqIENhbiBiZSB1c2VkIHRvIGFkZCwgcmVtb3ZlLCBvciBtb2RpZnkgbGFiZWxzLlxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzPzogc3RyaW5nW107XG59XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgR2l0aHViV2ViaG9va0hhbmRsZXJcbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBHaXRodWJXZWJob29rSGFuZGxlclByb3BzIHtcbiAgLyoqXG4gICAqIFN0ZXAgZnVuY3Rpb24gaW4gY2hhcmdlIG9mIGhhbmRsaW5nIHRoZSB3b3JrZmxvdyBqb2IgZXZlbnRzIGFuZCBzdGFydCB0aGUgcnVubmVycy5cbiAgICovXG4gIHJlYWRvbmx5IG9yY2hlc3RyYXRvcjogc3RlcGZ1bmN0aW9ucy5TdGF0ZU1hY2hpbmU7XG5cbiAgLyoqXG4gICAqIFNlY3JldHMgdXNlZCB0byBjb21tdW5pY2F0ZSB3aXRoIEdpdEh1Yi5cbiAgICovXG4gIHJlYWRvbmx5IHNlY3JldHM6IFNlY3JldHM7XG5cbiAgLyoqXG4gICAqIENvbmZpZ3VyZSBhY2Nlc3MgdG8gd2ViaG9vayBmdW5jdGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGFjY2Vzcz86IExhbWJkYUFjY2VzcztcblxuICAvKipcbiAgICogTWFwcGluZyBvZiBwcm92aWRlciBub2RlIHBhdGhzIHRvIHRoZWlyIHN1cHBvcnRlZCBsYWJlbHMuXG4gICAqL1xuICByZWFkb25seSBwcm92aWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZ1tdPjtcblxuICAvKipcbiAgICogT3B0aW9uYWwgTGFtYmRhIGZ1bmN0aW9uIHRvIGN1c3RvbWl6ZSBwcm92aWRlciBzZWxlY3Rpb24uXG4gICAqL1xuICByZWFkb25seSBwcm92aWRlclNlbGVjdG9yPzogbGFtYmRhLklGdW5jdGlvbjtcblxuICAvKipcbiAgICogV2hldGhlciB0byByZXF1aXJlIHRoZSBcInNlbGYtaG9zdGVkXCIgbGFiZWwuXG4gICAqL1xuICByZWFkb25seSByZXF1aXJlU2VsZkhvc3RlZExhYmVsOiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBJZGxlIHRpbWVvdXQgZm9yIHJ1bm5lcnMgaW4gc2Vjb25kcy5cbiAgICovXG4gIHJlYWRvbmx5IGlkbGVUaW1lb3V0U2Vjb25kcz86IG51bWJlcjtcblxuICAvKipcbiAgICogU3RvbGVuIHJ1bm5lciBkZXRlY3RvciBxdWV1ZS5cbiAgICovXG4gIHJlYWRvbmx5IHN0b2xlblJ1bm5lclF1ZXVlOiBzcXMuSVF1ZXVlO1xuXG4gIC8qKlxuICAgKiBBZGRpdGlvbmFsIExhbWJkYSBmdW5jdGlvbiBvcHRpb25zIChWUEMsIHNlY3VyaXR5IGdyb3VwcywgbGF5ZXJzLCBldGMuKS5cbiAgICovXG4gIHJlYWRvbmx5IGV4dHJhTGFtYmRhUHJvcHM/OiBsYW1iZGEuRnVuY3Rpb25PcHRpb25zO1xuXG4gIC8qKlxuICAgKiBBZGRpdGlvbmFsIGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3IgdGhlIExhbWJkYSBmdW5jdGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGV4dHJhTGFtYmRhRW52PzogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBMYW1iZGEgd2l0aCBhIHB1YmxpYyBVUkwgdG8gaGFuZGxlIEdpdEh1YiB3ZWJob29rIGV2ZW50cy4gQWZ0ZXIgdmFsaWRhdGluZyB0aGUgZXZlbnQgd2l0aCB0aGUgZ2l2ZW4gc2VjcmV0LCB0aGUgb3JjaGVzdHJhdG9yIHN0ZXAgZnVuY3Rpb24gaXMgY2FsbGVkIHdpdGggaW5mb3JtYXRpb24gYWJvdXQgdGhlIHdvcmtmbG93IGpvYi5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNsYXNzIEdpdGh1YldlYmhvb2tIYW5kbGVyIGV4dGVuZHMgQ29uc3RydWN0IHtcblxuICAvKipcbiAgICogUHVibGljIFVSTCBvZiB3ZWJob29rIHRvIGJlIHVzZWQgd2l0aCBHaXRIdWIuXG4gICAqL1xuICByZWFkb25seSB1cmw6IHN0cmluZztcblxuICAvKipcbiAgICogV2ViaG9vayBldmVudCBoYW5kbGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgaGFuZGxlcjogV2ViaG9va0hhbmRsZXJGdW5jdGlvbjtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogR2l0aHViV2ViaG9va0hhbmRsZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBjb25zdCB3b3JrZGlyID0gZnMubWtkdGVtcFN5bmMocGF0aC5qb2luKG9zLnRtcGRpcigpLCAncHJvdmlkZXJzLWxheWVyLScpKTtcbiAgICBsZXQgcHJvdmlkZXJzTGF5ZXI6IGxhbWJkYS5MYXllclZlcnNpb247XG4gICAgdHJ5IHtcbiAgICAgIGZzLndyaXRlRmlsZVN5bmMocGF0aC5qb2luKHdvcmtkaXIsIHBhdGgucG9zaXguYmFzZW5hbWUoUFJPVklERVJTX1BBVEgpKSwgSlNPTi5zdHJpbmdpZnkocHJvcHMucHJvdmlkZXJzKSk7XG4gICAgICBwcm92aWRlcnNMYXllciA9IG5ldyBsYW1iZGEuTGF5ZXJWZXJzaW9uKHRoaXMsICdQcm92aWRlcnMnLCB7XG4gICAgICAgIGRlc2NyaXB0aW9uOiAnUnVubmVyIHByb3ZpZGVycyBhbmQgdGhlaXIgbGFiZWxzJyxcbiAgICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KHdvcmtkaXIpLFxuICAgICAgfSk7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIC8vIENhbGxpbmcgYGZyb21Bc3NldCgpYCBoYXMgY29waWVkIGZpbGVzIHRvIHRoZSBhc3NlbWJseSwgc28gd2UgY2FuIGRlbGV0ZSB0aGUgdGVtcG9yYXJ5IGRpcmVjdG9yeS5cbiAgICAgIGZzLnJtU3luYyhwYXRoLmpvaW4od29ya2RpciwgcGF0aC5wb3NpeC5iYXNlbmFtZShQUk9WSURFUlNfUEFUSCkpKTtcbiAgICAgIGZzLnJtZGlyU3luYyh3b3JrZGlyKTtcbiAgICB9XG5cbiAgICB0aGlzLmhhbmRsZXIgPSBuZXcgV2ViaG9va0hhbmRsZXJGdW5jdGlvbihcbiAgICAgIHRoaXMsXG4gICAgICAnd2ViaG9vay1oYW5kbGVyJyxcbiAgICAgIHtcbiAgICAgICAgZGVzY3JpcHRpb246ICdIYW5kbGUgR2l0SHViIHdlYmhvb2sgYW5kIHN0YXJ0IHJ1bm5lciBvcmNoZXN0cmF0b3InLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIFNURVBfRlVOQ1RJT05fQVJOOiBwcm9wcy5vcmNoZXN0cmF0b3Iuc3RhdGVNYWNoaW5lQXJuLFxuICAgICAgICAgIFdFQkhPT0tfU0VDUkVUX0FSTjogcHJvcHMuc2VjcmV0cy53ZWJob29rLnNlY3JldEFybixcbiAgICAgICAgICBHSVRIVUJfU0VDUkVUX0FSTjogcHJvcHMuc2VjcmV0cy5naXRodWIuc2VjcmV0QXJuLFxuICAgICAgICAgIEdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOOiBwcm9wcy5zZWNyZXRzLmdpdGh1YlByaXZhdGVLZXkuc2VjcmV0QXJuLFxuICAgICAgICAgIFJFUVVJUkVfU0VMRl9IT1NURURfTEFCRUw6IHByb3BzLnJlcXVpcmVTZWxmSG9zdGVkTGFiZWwgPyAnMScgOiAnMCcsXG4gICAgICAgICAgUFJPVklERVJfU0VMRUNUT1JfQVJOOiBwcm9wcy5wcm92aWRlclNlbGVjdG9yPy5mdW5jdGlvbkFybiA/PyAnJyxcbiAgICAgICAgICBJRExFX1RJTUVPVVRfU0VDT05EUzogcHJvcHMuaWRsZVRpbWVvdXRTZWNvbmRzPy50b1N0cmluZygpID8/ICczMDAnLCAvLyBkZWZhdWx0IDUgbWludXRlc1xuICAgICAgICAgIEpPQl9BU1NJR05NRU5UX1FVRVVFX1VSTDogcHJvcHMuc3RvbGVuUnVubmVyUXVldWUucXVldWVVcmwsXG4gICAgICAgICAgLi4ucHJvcHMuZXh0cmFMYW1iZGFFbnYsXG4gICAgICAgIH0sXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMxKSxcbiAgICAgICAgbG9nR3JvdXA6IHNpbmdsZXRvbkxvZ0dyb3VwKHRoaXMsIFNpbmdsZXRvbkxvZ1R5cGUuT1JDSEVTVFJBVE9SKSxcbiAgICAgICAgbG9nZ2luZ0Zvcm1hdDogbGFtYmRhLkxvZ2dpbmdGb3JtYXQuSlNPTixcbiAgICAgICAgLi4ucHJvcHMuZXh0cmFMYW1iZGFQcm9wcyxcbiAgICAgICAgbGF5ZXJzOiBbLi4ucHJvcHMuZXh0cmFMYW1iZGFQcm9wcz8ubGF5ZXJzID8/IFtdLCBwcm92aWRlcnNMYXllcl0sXG4gICAgICB9LFxuICAgICk7XG5cbiAgICBjb25zdCBhY2Nlc3MgPSBwcm9wcz8uYWNjZXNzID8/IExhbWJkYUFjY2Vzcy5sYW1iZGFVcmwoKTtcbiAgICB0aGlzLnVybCA9IGFjY2Vzcy5iaW5kKHRoaXMsICdhY2Nlc3MnLCB0aGlzLmhhbmRsZXIpO1xuXG4gICAgcHJvcHMuc2VjcmV0cy53ZWJob29rLmdyYW50UmVhZCh0aGlzLmhhbmRsZXIpO1xuICAgIHByb3BzLnNlY3JldHMuZ2l0aHViLmdyYW50UmVhZCh0aGlzLmhhbmRsZXIpO1xuICAgIHByb3BzLnNlY3JldHMuZ2l0aHViUHJpdmF0ZUtleS5ncmFudFJlYWQodGhpcy5oYW5kbGVyKTtcbiAgICBwcm9wcy5vcmNoZXN0cmF0b3IuZ3JhbnRTdGFydEV4ZWN1dGlvbih0aGlzLmhhbmRsZXIpO1xuICAgIHByb3BzLnByb3ZpZGVyU2VsZWN0b3I/LmdyYW50SW52b2tlKHRoaXMuaGFuZGxlcik7XG4gICAgcHJvcHMuc3RvbGVuUnVubmVyUXVldWUuZ3JhbnRTZW5kTWVzc2FnZXModGhpcy5oYW5kbGVyKTtcbiAgfVxufVxuIl19