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
exports.ScheduledWarmRunner = exports.AlwaysOnWarmRunner = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const crypto = __importStar(require("crypto"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const cron_parser_1 = require("cron-parser");
function buildWarmRunner(scope, props, schedule, duration, createInitialFill) {
    const registrationLevel = props.registrationLevel ?? 'repo';
    if (registrationLevel === 'org' && props.repo) {
        cdk.Annotations.of(scope).addError('Do not specify repo when registrationLevel is \'org\'');
    }
    if (registrationLevel === 'repo' && !props.repo) {
        cdk.Annotations.of(scope).addError('repo is required when registrationLevel is \'repo\'');
    }
    const providerPath = props.provider.node.path;
    if (!props.runners.providers.some(p => p.node.path === providerPath)) {
        cdk.Annotations.of(scope).addError(`Provider ${providerPath} is not in the providers list of the GitHubRunners construct`);
    }
    const labels = props.provider.labels;
    const repo = registrationLevel === 'repo' ? (props.repo ?? '') : '';
    const configHash = crypto.createHash('sha256')
        .update(JSON.stringify({ providerPath, providerLabels: labels, count: props.count, duration, owner: props.owner, repo }))
        .digest('hex')
        .slice(0, 16);
    const fillPayload = {
        action: 'fill',
        providerPath,
        providerLabels: labels,
        count: props.count,
        duration,
        owner: props.owner,
        repo,
        configHash,
    };
    const { lambda: managerFn, queue } = props.runners._ensureWarmRunnerInfra();
    props.runners._registerWarmConfigHash(configHash, duration);
    // Schedule to fill the warm pool (usually daily). Sends to SQS so we get stable messageId for idempotent fills.
    new aws_cdk_lib_1.aws_events.Rule(scope, 'Schedule', {
        schedule,
        targets: [new aws_cdk_lib_1.aws_events_targets.SqsQueue(queue, {
                message: aws_cdk_lib_1.aws_events.RuleTargetInput.fromObject(fillPayload),
            })],
    });
    // Fill the warm pool immediately on deploy (AlwaysOnWarmRunner only).
    // ScheduledWarmRunner does not get deployment-fill. First fill happens at the next schedule fire.
    if (createInitialFill) {
        new cdk.CustomResource(scope, 'Initial Fill', {
            serviceToken: managerFn.functionArn,
            resourceType: 'Custom::WarmRunnerFill',
            properties: fillPayload,
        });
    }
    return fillPayload;
}
/**
 * Warm runners that run 24/7. Fills at midnight UTC and each runner stays alive for 24 hours.
 *
 * Runners will be provisioned using the specified provider and registered in the specified repository or organization.
 *
 * Registration level must match the one selected during setup.
 *
 * @see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md
 *
 * **Limitations**
 *
 * - Jobs will still trigger provisioning of on-demand runners, even if a warm runner ends up being used.
 * - You may briefly see more than `count` runners when changing config or at rotation.
 * - To remove: set `count` to 0, deploy, wait for warm runners to stop, then remove and deploy again.
 *   If you don't follow this procedure, warm runners may linger until they expire.
 * - Provider failures or timeouts (like Lambda provider timing out after 15 minutes) will result in a
 *   gap in coverage until the retry succeeds. Current retry mechanism has built-in back-off rate and
 *   can be tweaked using `retryOptions`. This will be improved in the future.
 *
 * ```typescript
 * new AlwaysOnWarmRunner(stack, 'AlwaysOnLinux', {
 *   runners,
 *   provider: myProvider,
 *   count: 3,
 *   owner: 'my-org',
 *   repo: 'my-repo',
 * });
 * ```
 */
class AlwaysOnWarmRunner extends constructs_1.Construct {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.AlwaysOnWarmRunner", version: "0.0.0" };
    /**
     * The fill payload for this warm runner configuration.
     * @internal
     */
    _fillPayload;
    constructor(scope, id, props) {
        super(scope, id);
        this._fillPayload = buildWarmRunner(this, props, aws_cdk_lib_1.aws_events.Schedule.cron({ hour: '0', minute: '0' }), cdk.Duration.days(1).toSeconds(), true);
    }
}
exports.AlwaysOnWarmRunner = AlwaysOnWarmRunner;
/**
 * Convert AWS EventBridge cron format to cron-parser format.
 * AWS: cron(min hour dom month dow year), cron-parser: sec min hour dom month dow
 */
function awsCronToParserFormat(expressionString) {
    const match = expressionString.match(/^cron\((.+)\)$/);
    if (!match)
        return expressionString;
    const [, inner] = match;
    const parts = inner.trim().split(/\s+/);
    if (parts.length !== 6)
        return expressionString;
    const [minute, hour, dom, month, dow] = parts;
    return `0 ${minute} ${hour} ${dom} ${month} ${dow}`;
}
/**
 * Parse AWS EventBridge rate expression and return interval in seconds.
 * Format: rate(value unit) e.g. rate(2 hours), rate(5 minutes), rate(1 day)
 */
function parseRateInterval(expressionString) {
    const match = expressionString.match(/^rate\((\d+)\s+(minute|minutes|hour|hours|day|days)\)$/i);
    if (!match)
        return undefined;
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (value <= 0)
        return undefined;
    const secondsPerUnit = {
        minute: 60,
        minutes: 60,
        hour: 3600,
        hours: 3600,
        day: 86400,
        days: 86400,
    };
    return value * secondsPerUnit[unit];
}
/**
 * Get the interval between schedule occurrences in seconds.
 * Supports both cron and rate expressions.
 */
function getScheduleIntervalSeconds(expressionString) {
    const rateInterval = parseRateInterval(expressionString);
    if (rateInterval !== undefined)
        return rateInterval;
    try {
        const cronExpression = cron_parser_1.CronExpressionParser.parse(awsCronToParserFormat(expressionString));
        const next = cronExpression.take(2);
        return (next[1].getTime() - next[0].getTime()) / 1000;
    }
    catch {
        return undefined;
    }
}
/**
 * Warm runners active during a time window specified by start time (`schedule`) and duration (`duration`).
 *
 * Runners will be provisioned using the specified provider and registered in the specified repository or organization.
 *
 * Registration level must match the one selected during setup.
 *
 * @see https://github.com/CloudSnorkel/cdk-github-runners/blob/main/SETUP_GITHUB.md
 *
 * **Limitations**
 *
 * - **No deployment-fill**: Unlike `AlwaysOnWarmRunner`, scheduled warm runners do not get an initial
 *   fill on deploy. The first fill happens at the next schedule occurrence. If you deploy at 1pm for
 *   a 2pm schedule, runners will not appear until 2pm.
 * - Jobs will still trigger provisioning of on-demand runners, even if a warm runner ends up being used.
 * - You may briefly see more than `count` runners when changing config or at rotation.
 * - To remove: set `count` to 0, deploy, wait for warm runners to stop, then remove and deploy again.
 *   If you don't follow this procedure, warm runners may linger until they expire.
 * - Provider failures or timeouts (like Lambda provider timing out after 15 minutes) will result in a
 *   gap in coverage until the retry succeeds. Current retry mechanism has built-in back-off rate and
 *   can be tweaked using `retryOptions`. This will be improved in the future.
 *
 * ```typescript
 * // Cron: fill at 1pm on weekdays
 * new ScheduledWarmRunner(stack, 'Business Hours', {
 *   runners,
 *   provider: myProvider,
 *   count: 3,
 *   owner: 'my-org',
 *   repo: 'my-repo',
 *   schedule: events.Schedule.cron({ hour: '13', minute: '0', weekDay: 'MON-FRI' }),
 *   duration: cdk.Duration.hours(2),
 * });
 * ```
 *
 * ```typescript
 * // Rate: fill every 12 hours
 * new ScheduledWarmRunner(stack, 'Every 12 Hours', {
 *   runners,
 *   provider: myProvider,
 *   count: 2,
 *   owner: 'my-org',
 *   repo: 'my-repo',
 *   schedule: events.Schedule.rate(cdk.Duration.hours(5)),
 *   duration: cdk.Duration.hours(12),
 * });
 * ```
 */
class ScheduledWarmRunner extends constructs_1.Construct {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.ScheduledWarmRunner", version: "0.0.0" };
    /**
     * The fill payload for this warm runner configuration.
     * @internal
     */
    _fillPayload;
    constructor(scope, id, props) {
        super(scope, id);
        // make sure the duration is not longer than the interval between next two schedule occurrences
        const interval = getScheduleIntervalSeconds(props.schedule.expressionString);
        if (interval !== undefined && interval < props.duration.toSeconds()) {
            cdk.Annotations.of(this).addError(`ScheduledWarmRunner duration ${props.duration.toHumanString()} is longer than the interval ${cdk.Duration.seconds(interval).toHumanString()} between next two schedule occurrences. This will result in overlapping warm runners at the start of the next schedule occurrence.`);
        }
        // warn for short interval
        if (interval !== undefined && interval < cdk.Duration.hours(1).toSeconds()) {
            cdk.Annotations.of(this).addWarningV2('@cloudsnorkel/cdk-github-runners:ScheduledWarmRunner.intervalTooShort', `ScheduledWarmRunner interval ${cdk.Duration.seconds(interval).toHumanString()} is less than 1 hour, which may result in more warm runners than expected`);
        }
        this._fillPayload = buildWarmRunner(this, props, props.schedule, props.duration.toSeconds(), false);
    }
}
exports.ScheduledWarmRunner = ScheduledWarmRunner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2FybS1ydW5uZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvd2FybS1ydW5uZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLCtDQUFpQztBQUNqQyxpREFBbUM7QUFDbkMsNkNBR3FCO0FBQ3JCLDJDQUF1QztBQUN2Qyw2Q0FBbUQ7QUFxRW5ELFNBQVMsZUFBZSxDQUFDLEtBQWdCLEVBQUUsS0FBMEIsRUFBRSxRQUF5QixFQUFFLFFBQWdCLEVBQUUsaUJBQTBCO0lBQzVJLE1BQU0saUJBQWlCLEdBQUcsS0FBSyxDQUFDLGlCQUFpQixJQUFJLE1BQU0sQ0FBQztJQUM1RCxJQUFJLGlCQUFpQixLQUFLLEtBQUssSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDOUMsR0FBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLHVEQUF1RCxDQUFDLENBQUM7SUFDOUYsQ0FBQztJQUNELElBQUksaUJBQWlCLEtBQUssTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ2hELEdBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLFFBQVEsQ0FBQyxxREFBcUQsQ0FBQyxDQUFDO0lBQzVGLENBQUM7SUFFRCxNQUFNLFlBQVksR0FBRyxLQUFLLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDOUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxLQUFLLFlBQVksQ0FBQyxFQUFFLENBQUM7UUFDckUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsUUFBUSxDQUFDLFlBQVksWUFBWSw4REFB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LEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLGFBQWEsRUFBRSxvSUFBb0ksQ0FBQyxDQUFDO1FBQ3RULENBQUM7UUFFRCwwQkFBMEI7UUFDMUIsSUFBSSxRQUFRLEtBQUssU0FBUyxJQUFJLFFBQVEsR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDO1lBQzNFLEdBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLFlBQVksQ0FDbkMsdUVBQXVFLEVBQ3ZFLGdDQUFnQyxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQyxhQUFhLEVBQUUsMkVBQTJFLENBQzFKLENBQUM7UUFDSixDQUFDO1FBRUQsSUFBSSxDQUFDLFlBQVksR0FBRyxlQUFlLENBQUMsSUFBSSxFQUFFLEtBQUssRUFBRSxLQUFLLENBQUMsUUFBUSxFQUFFLEtBQUssQ0FBQyxRQUFRLENBQUMsU0FBUyxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDdEcsQ0FBQzs7QUF6Qkgsa0RBMEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHtcbiAgYXdzX2V2ZW50cyBhcyBldmVudHMsXG4gIGF3c19ldmVudHNfdGFyZ2V0cyBhcyBldmVudHNfdGFyZ2V0cyxcbn0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBDcm9uRXhwcmVzc2lvblBhcnNlciB9IGZyb20gJ2Nyb24tcGFyc2VyJztcbmltcG9ydCB7IElDb21wb3NpdGVQcm92aWRlciwgSVJ1bm5lclByb3ZpZGVyIH0gZnJvbSAnLi9wcm92aWRlcnMnO1xuaW1wb3J0IHsgR2l0SHViUnVubmVycyB9IGZyb20gJy4vcnVubmVyJztcbmltcG9ydCB7IFdhcm1SdW5uZXJGaWxsUGF5bG9hZCB9IGZyb20gJy4vd2FybS1ydW5uZXItbWFuYWdlci5sYW1iZGEnO1xuXG4vKipcbiAqIENvbW1vbiBwcm9wZXJ0aWVzIGZvciB3YXJtIHJ1bm5lciBjb25zdHJ1Y3RzLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFdhcm1SdW5uZXJCYXNlUHJvcHMge1xuICAvKipcbiAgICogVGhlIEdpdEh1YlJ1bm5lcnMgY29uc3RydWN0IHRoYXQgb3ducyB0aGUgc2hhcmVkIHdhcm0gcnVubmVyIGluZnJhc3RydWN0dXJlLlxuICAgKi9cbiAgcmVhZG9ubHkgcnVubmVyczogR2l0SHViUnVubmVycztcblxuICAvKipcbiAgICogUHJvdmlkZXIgdG8gdXNlLiBXYXJtIHJ1bm5lcnMgYnlwYXNzIHRoZSBwcm92aWRlciBzZWxlY3RvciDigJQgdGhleSBhbHdheXMgdXNlXG4gICAqIHRoaXMgcHJvdmlkZXIsIHJlZ2FyZGxlc3Mgb2Ygam9iIGNoYXJhY3RlcmlzdGljcy4gTGFiZWxzIGNhbm5vdCBiZSBtb2RpZmllZC5cbiAgICovXG4gIHJlYWRvbmx5IHByb3ZpZGVyOiBJUnVubmVyUHJvdmlkZXIgfCBJQ29tcG9zaXRlUHJvdmlkZXI7XG5cbiAgLyoqXG4gICAqIE51bWJlciBvZiB3YXJtIHJ1bm5lcnMgdG8gbWFpbnRhaW4uXG4gICAqL1xuICByZWFkb25seSBjb3VudDogbnVtYmVyO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgb3duZXIgd2hlcmUgcnVubmVycyB3aWxsIGJlIHJlZ2lzdGVyZWQgKG9yZyBvciB1c2VyIGxvZ2luKS5cbiAgICovXG4gIHJlYWRvbmx5IG93bmVyOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFJlZ2lzdHJhdGlvbiBsZXZlbCDigJQgbXVzdCBtYXRjaCBob3cgeW91ciBydW5uZXJzIGFyZSBzZXQgdXAgaW4gR2l0SHViLiBDaG9vc2VcbiAgICogJ29yZycgZm9yIG9yZy13aWRlIHJ1bm5lcnMsICdyZXBvJyBmb3IgcmVwby1sZXZlbC4gU2VlIHRoZSBzZXR1cCB3aXphcmQgZm9yIGNob29zaW5nIHJlcG8gdnMgb3JnLlxuICAgKlxuICAgKiBAc2VlIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzL2Jsb2IvbWFpbi9TRVRVUF9HSVRIVUIubWRcbiAgICpcbiAgICogQGRlZmF1bHQgJ3JlcG8nXG4gICAqL1xuICByZWFkb25seSByZWdpc3RyYXRpb25MZXZlbD86ICdvcmcnIHwgJ3JlcG8nO1xuXG4gIC8qKlxuICAgKiBSZXBvc2l0b3J5IG5hbWUgKHdpdGhvdXQgb3duZXIpIHdoZXJlIHJ1bm5lcnMgd2lsbCBiZSByZWdpc3RlcmVkLiBSZXF1aXJlZCB3aGVuIGByZWdpc3RyYXRpb25MZXZlbGAgaXMgJ3JlcG8nLlxuICAgKi9cbiAgcmVhZG9ubHkgcmVwbz86IHN0cmluZztcbn1cblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBhbHdheXMgb24gd2FybSBydW5uZXJzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEFsd2F5c09uV2FybVJ1bm5lclByb3BzIGV4dGVuZHMgV2FybVJ1bm5lckJhc2VQcm9wcyB7IH1cblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBzY2hlZHVsZWQgd2FybSBydW5uZXJzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNjaGVkdWxlZFdhcm1SdW5uZXJQcm9wcyBleHRlbmRzIFdhcm1SdW5uZXJCYXNlUHJvcHMge1xuICAvKipcbiAgICogV2hlbiB0byBzdGFydCBmaWxsaW5nIHRoZSBwb29sIChlLmcuIHN0YXJ0IG9mIGJ1c2luZXNzIGhvdXJzKS5cbiAgICovXG4gIHJlYWRvbmx5IHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGU7XG5cbiAgLyoqXG4gICAqIEhvdyBsb25nIHRoZSB3YXJtIHJ1bm5lcnMgc2hvdWxkIGJlIG1haW50YWluZWQgZnJvbSB0aGUgZmlsbCB0aW1lIChzY2hlZHVsZSkuIERlZmluZXMgdGhlIGVuZCBvZiB0aGVcbiAgICogd2luZG93IChzY2hlZHVsZSB0aW1lICsgZHVyYXRpb24pLlxuICAgKi9cbiAgcmVhZG9ubHkgZHVyYXRpb246IGNkay5EdXJhdGlvbjtcbn1cblxuZnVuY3Rpb24gYnVpbGRXYXJtUnVubmVyKHNjb3BlOiBDb25zdHJ1Y3QsIHByb3BzOiBXYXJtUnVubmVyQmFzZVByb3BzLCBzY2hlZHVsZTogZXZlbnRzLlNjaGVkdWxlLCBkdXJhdGlvbjogbnVtYmVyLCBjcmVhdGVJbml0aWFsRmlsbDogYm9vbGVhbikge1xuICBjb25zdCByZWdpc3RyYXRpb25MZXZlbCA9IHByb3BzLnJlZ2lzdHJhdGlvbkxldmVsID8/ICdyZXBvJztcbiAgaWYgKHJlZ2lzdHJhdGlvbkxldmVsID09PSAnb3JnJyAmJiBwcm9wcy5yZXBvKSB7XG4gICAgY2RrLkFubm90YXRpb25zLm9mKHNjb3BlKS5hZGRFcnJvcignRG8gbm90IHNwZWNpZnkgcmVwbyB3aGVuIHJlZ2lzdHJhdGlvbkxldmVsIGlzIFxcJ29yZ1xcJycpO1xuICB9XG4gIGlmIChyZWdpc3RyYXRpb25MZXZlbCA9PT0gJ3JlcG8nICYmICFwcm9wcy5yZXBvKSB7XG4gICAgY2RrLkFubm90YXRpb25zLm9mKHNjb3BlKS5hZGRFcnJvcigncmVwbyBpcyByZXF1aXJlZCB3aGVuIHJlZ2lzdHJhdGlvbkxldmVsIGlzIFxcJ3JlcG9cXCcnKTtcbiAgfVxuXG4gIGNvbnN0IHByb3ZpZGVyUGF0aCA9IHByb3BzLnByb3ZpZGVyLm5vZGUucGF0aDtcbiAgaWYgKCFwcm9wcy5ydW5uZXJzLnByb3ZpZGVycy5zb21lKHAgPT4gcC5ub2RlLnBhdGggPT09IHByb3ZpZGVyUGF0aCkpIHtcbiAgICBjZGsuQW5ub3RhdGlvbnMub2Yoc2NvcGUpLmFkZEVycm9yKGBQcm92aWRlciAke3Byb3ZpZGVyUGF0aH0gaXMgbm90IGluIHRoZSBwcm92aWRlcnMgbGlzdCBvZiB0aGUgR2l0SHViUnVubmVycyBjb25zdHJ1Y3RgKTtcbiAgfVxuXG4gIGNvbnN0IGxhYmVscyA9IHByb3BzLnByb3ZpZGVyLmxhYmVscztcblxuICBjb25zdCByZXBvID0gcmVnaXN0cmF0aW9uTGV2ZWwgPT09ICdyZXBvJyA/IChwcm9wcy5yZXBvID8/ICcnKSA6ICcnO1xuICBjb25zdCBjb25maWdIYXNoID0gY3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpXG4gICAgLnVwZGF0ZShKU09OLnN0cmluZ2lmeSh7IHByb3ZpZGVyUGF0aCwgcHJvdmlkZXJMYWJlbHM6IGxhYmVscywgY291bnQ6IHByb3BzLmNvdW50LCBkdXJhdGlvbiwgb3duZXI6IHByb3BzLm93bmVyLCByZXBvIH0pKVxuICAgIC5kaWdlc3QoJ2hleCcpXG4gICAgLnNsaWNlKDAsIDE2KTtcblxuICBjb25zdCBmaWxsUGF5bG9hZDogV2FybVJ1bm5lckZpbGxQYXlsb2FkID0ge1xuICAgIGFjdGlvbjogJ2ZpbGwnIGFzIGNvbnN0LFxuICAgIHByb3ZpZGVyUGF0aCxcbiAgICBwcm92aWRlckxhYmVsczogbGFiZWxzLFxuICAgIGNvdW50OiBwcm9wcy5jb3VudCxcbiAgICBkdXJhdGlvbixcbiAgICBvd25lcjogcHJvcHMub3duZXIsXG4gICAgcmVwbyxcbiAgICBjb25maWdIYXNoLFxuICB9O1xuXG4gIGNvbnN0IHsgbGFtYmRhOiBtYW5hZ2VyRm4sIHF1ZXVlIH0gPSBwcm9wcy5ydW5uZXJzLl9lbnN1cmVXYXJtUnVubmVySW5mcmEoKTtcbiAgcHJvcHMucnVubmVycy5fcmVnaXN0ZXJXYXJtQ29uZmlnSGFzaChjb25maWdIYXNoLCBkdXJhdGlvbik7XG5cbiAgLy8gU2NoZWR1bGUgdG8gZmlsbCB0aGUgd2FybSBwb29sICh1c3VhbGx5IGRhaWx5KS4gU2VuZHMgdG8gU1FTIHNvIHdlIGdldCBzdGFibGUgbWVzc2FnZUlkIGZvciBpZGVtcG90ZW50IGZpbGxzLlxuICBuZXcgZXZlbnRzLlJ1bGUoc2NvcGUsICdTY2hlZHVsZScsIHtcbiAgICBzY2hlZHVsZSxcbiAgICB0YXJnZXRzOiBbbmV3IGV2ZW50c190YXJnZXRzLlNxc1F1ZXVlKHF1ZXVlLCB7XG4gICAgICBtZXNzYWdlOiBldmVudHMuUnVsZVRhcmdldElucHV0LmZyb21PYmplY3QoZmlsbFBheWxvYWQpLFxuICAgIH0pXSxcbiAgfSk7XG5cbiAgLy8gRmlsbCB0aGUgd2FybSBwb29sIGltbWVkaWF0ZWx5IG9uIGRlcGxveSAoQWx3YXlzT25XYXJtUnVubmVyIG9ubHkpLlxuICAvLyBTY2hlZHVsZWRXYXJtUnVubmVyIGRvZXMgbm90IGdldCBkZXBsb3ltZW50LWZpbGwuIEZpcnN0IGZpbGwgaGFwcGVucyBhdCB0aGUgbmV4dCBzY2hlZHVsZSBmaXJlLlxuICBpZiAoY3JlYXRlSW5pdGlhbEZpbGwpIHtcbiAgICBuZXcgY2RrLkN1c3RvbVJlc291cmNlKHNjb3BlLCAnSW5pdGlhbCBGaWxsJywge1xuICAgICAgc2VydmljZVRva2VuOiBtYW5hZ2VyRm4uZnVuY3Rpb25Bcm4sXG4gICAgICByZXNvdXJjZVR5cGU6ICdDdXN0b206Oldhcm1SdW5uZXJGaWxsJyxcbiAgICAgIHByb3BlcnRpZXM6IGZpbGxQYXlsb2FkLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIGZpbGxQYXlsb2FkO1xufVxuXG4vKipcbiAqIFdhcm0gcnVubmVycyB0aGF0IHJ1biAyNC83LiBGaWxscyBhdCBtaWRuaWdodCBVVEMgYW5kIGVhY2ggcnVubmVyIHN0YXlzIGFsaXZlIGZvciAyNCBob3Vycy5cbiAqXG4gKiBSdW5uZXJzIHdpbGwgYmUgcHJvdmlzaW9uZWQgdXNpbmcgdGhlIHNwZWNpZmllZCBwcm92aWRlciBhbmQgcmVnaXN0ZXJlZCBpbiB0aGUgc3BlY2lmaWVkIHJlcG9zaXRvcnkgb3Igb3JnYW5pemF0aW9uLlxuICpcbiAqIFJlZ2lzdHJhdGlvbiBsZXZlbCBtdXN0IG1hdGNoIHRoZSBvbmUgc2VsZWN0ZWQgZHVyaW5nIHNldHVwLlxuICpcbiAqIEBzZWUgaHR0cHM6Ly9naXRodWIuY29tL0Nsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMvYmxvYi9tYWluL1NFVFVQX0dJVEhVQi5tZFxuICpcbiAqICoqTGltaXRhdGlvbnMqKlxuICpcbiAqIC0gSm9icyB3aWxsIHN0aWxsIHRyaWdnZXIgcHJvdmlzaW9uaW5nIG9mIG9uLWRlbWFuZCBydW5uZXJzLCBldmVuIGlmIGEgd2FybSBydW5uZXIgZW5kcyB1cCBiZWluZyB1c2VkLlxuICogLSBZb3UgbWF5IGJyaWVmbHkgc2VlIG1vcmUgdGhhbiBgY291bnRgIHJ1bm5lcnMgd2hlbiBjaGFuZ2luZyBjb25maWcgb3IgYXQgcm90YXRpb24uXG4gKiAtIFRvIHJlbW92ZTogc2V0IGBjb3VudGAgdG8gMCwgZGVwbG95LCB3YWl0IGZvciB3YXJtIHJ1bm5lcnMgdG8gc3RvcCwgdGhlbiByZW1vdmUgYW5kIGRlcGxveSBhZ2Fpbi5cbiAqICAgSWYgeW91IGRvbid0IGZvbGxvdyB0aGlzIHByb2NlZHVyZSwgd2FybSBydW5uZXJzIG1heSBsaW5nZXIgdW50aWwgdGhleSBleHBpcmUuXG4gKiAtIFByb3ZpZGVyIGZhaWx1cmVzIG9yIHRpbWVvdXRzIChsaWtlIExhbWJkYSBwcm92aWRlciB0aW1pbmcgb3V0IGFmdGVyIDE1IG1pbnV0ZXMpIHdpbGwgcmVzdWx0IGluIGFcbiAqICAgZ2FwIGluIGNvdmVyYWdlIHVudGlsIHRoZSByZXRyeSBzdWNjZWVkcy4gQ3VycmVudCByZXRyeSBtZWNoYW5pc20gaGFzIGJ1aWx0LWluIGJhY2stb2ZmIHJhdGUgYW5kXG4gKiAgIGNhbiBiZSB0d2Vha2VkIHVzaW5nIGByZXRyeU9wdGlvbnNgLiBUaGlzIHdpbGwgYmUgaW1wcm92ZWQgaW4gdGhlIGZ1dHVyZS5cbiAqXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiBuZXcgQWx3YXlzT25XYXJtUnVubmVyKHN0YWNrLCAnQWx3YXlzT25MaW51eCcsIHtcbiAqICAgcnVubmVycyxcbiAqICAgcHJvdmlkZXI6IG15UHJvdmlkZXIsXG4gKiAgIGNvdW50OiAzLFxuICogICBvd25lcjogJ215LW9yZycsXG4gKiAgIHJlcG86ICdteS1yZXBvJyxcbiAqIH0pO1xuICogYGBgXG4gKi9cbmV4cG9ydCBjbGFzcyBBbHdheXNPbldhcm1SdW5uZXIgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICAvKipcbiAgICogVGhlIGZpbGwgcGF5bG9hZCBmb3IgdGhpcyB3YXJtIHJ1bm5lciBjb25maWd1cmF0aW9uLlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBfZmlsbFBheWxvYWQ6IFdhcm1SdW5uZXJGaWxsUGF5bG9hZDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQWx3YXlzT25XYXJtUnVubmVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuICAgIHRoaXMuX2ZpbGxQYXlsb2FkID0gYnVpbGRXYXJtUnVubmVyKHRoaXMsIHByb3BzLCBldmVudHMuU2NoZWR1bGUuY3Jvbih7IGhvdXI6ICcwJywgbWludXRlOiAnMCcgfSksIGNkay5EdXJhdGlvbi5kYXlzKDEpLnRvU2Vjb25kcygpLCB0cnVlKTtcbiAgfVxufVxuXG4vKipcbiAqIENvbnZlcnQgQVdTIEV2ZW50QnJpZGdlIGNyb24gZm9ybWF0IHRvIGNyb24tcGFyc2VyIGZvcm1hdC5cbiAqIEFXUzogY3JvbihtaW4gaG91ciBkb20gbW9udGggZG93IHllYXIpLCBjcm9uLXBhcnNlcjogc2VjIG1pbiBob3VyIGRvbSBtb250aCBkb3dcbiAqL1xuZnVuY3Rpb24gYXdzQ3JvblRvUGFyc2VyRm9ybWF0KGV4cHJlc3Npb25TdHJpbmc6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG1hdGNoID0gZXhwcmVzc2lvblN0cmluZy5tYXRjaCgvXmNyb25cXCgoLispXFwpJC8pO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gZXhwcmVzc2lvblN0cmluZztcbiAgY29uc3QgWywgaW5uZXJdID0gbWF0Y2g7XG4gIGNvbnN0IHBhcnRzID0gaW5uZXIudHJpbSgpLnNwbGl0KC9cXHMrLyk7XG4gIGlmIChwYXJ0cy5sZW5ndGggIT09IDYpIHJldHVybiBleHByZXNzaW9uU3RyaW5nO1xuICBjb25zdCBbbWludXRlLCBob3VyLCBkb20sIG1vbnRoLCBkb3ddID0gcGFydHM7XG4gIHJldHVybiBgMCAke21pbnV0ZX0gJHtob3VyfSAke2RvbX0gJHttb250aH0gJHtkb3d9YDtcbn1cblxuLyoqXG4gKiBQYXJzZSBBV1MgRXZlbnRCcmlkZ2UgcmF0ZSBleHByZXNzaW9uIGFuZCByZXR1cm4gaW50ZXJ2YWwgaW4gc2Vjb25kcy5cbiAqIEZvcm1hdDogcmF0ZSh2YWx1ZSB1bml0KSBlLmcuIHJhdGUoMiBob3VycyksIHJhdGUoNSBtaW51dGVzKSwgcmF0ZSgxIGRheSlcbiAqL1xuZnVuY3Rpb24gcGFyc2VSYXRlSW50ZXJ2YWwoZXhwcmVzc2lvblN0cmluZzogc3RyaW5nKTogbnVtYmVyIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgbWF0Y2ggPSBleHByZXNzaW9uU3RyaW5nLm1hdGNoKC9ecmF0ZVxcKChcXGQrKVxccysobWludXRlfG1pbnV0ZXN8aG91cnxob3Vyc3xkYXl8ZGF5cylcXCkkL2kpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCB2YWx1ZSA9IHBhcnNlSW50KG1hdGNoWzFdLCAxMCk7XG4gIGNvbnN0IHVuaXQgPSBtYXRjaFsyXS50b0xvd2VyQ2FzZSgpO1xuICBpZiAodmFsdWUgPD0gMCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgY29uc3Qgc2Vjb25kc1BlclVuaXQ6IFJlY29yZDxzdHJpbmcsIG51bWJlcj4gPSB7XG4gICAgbWludXRlOiA2MCxcbiAgICBtaW51dGVzOiA2MCxcbiAgICBob3VyOiAzNjAwLFxuICAgIGhvdXJzOiAzNjAwLFxuICAgIGRheTogODY0MDAsXG4gICAgZGF5czogODY0MDAsXG4gIH07XG4gIHJldHVybiB2YWx1ZSAqIHNlY29uZHNQZXJVbml0W3VuaXRdO1xufVxuXG4vKipcbiAqIEdldCB0aGUgaW50ZXJ2YWwgYmV0d2VlbiBzY2hlZHVsZSBvY2N1cnJlbmNlcyBpbiBzZWNvbmRzLlxuICogU3VwcG9ydHMgYm90aCBjcm9uIGFuZCByYXRlIGV4cHJlc3Npb25zLlxuICovXG5mdW5jdGlvbiBnZXRTY2hlZHVsZUludGVydmFsU2Vjb25kcyhleHByZXNzaW9uU3RyaW5nOiBzdHJpbmcpOiBudW1iZXIgfCB1bmRlZmluZWQge1xuICBjb25zdCByYXRlSW50ZXJ2YWwgPSBwYXJzZVJhdGVJbnRlcnZhbChleHByZXNzaW9uU3RyaW5nKTtcbiAgaWYgKHJhdGVJbnRlcnZhbCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gcmF0ZUludGVydmFsO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgY3JvbkV4cHJlc3Npb24gPSBDcm9uRXhwcmVzc2lvblBhcnNlci5wYXJzZShhd3NDcm9uVG9QYXJzZXJGb3JtYXQoZXhwcmVzc2lvblN0cmluZykpO1xuICAgIGNvbnN0IG5leHQgPSBjcm9uRXhwcmVzc2lvbi50YWtlKDIpO1xuICAgIHJldHVybiAobmV4dFsxXS5nZXRUaW1lKCkgLSBuZXh0WzBdLmdldFRpbWUoKSkgLyAxMDAwO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8qKlxuICogV2FybSBydW5uZXJzIGFjdGl2ZSBkdXJpbmcgYSB0aW1lIHdpbmRvdyBzcGVjaWZpZWQgYnkgc3RhcnQgdGltZSAoYHNjaGVkdWxlYCkgYW5kIGR1cmF0aW9uIChgZHVyYXRpb25gKS5cbiAqXG4gKiBSdW5uZXJzIHdpbGwgYmUgcHJvdmlzaW9uZWQgdXNpbmcgdGhlIHNwZWNpZmllZCBwcm92aWRlciBhbmQgcmVnaXN0ZXJlZCBpbiB0aGUgc3BlY2lmaWVkIHJlcG9zaXRvcnkgb3Igb3JnYW5pemF0aW9uLlxuICpcbiAqIFJlZ2lzdHJhdGlvbiBsZXZlbCBtdXN0IG1hdGNoIHRoZSBvbmUgc2VsZWN0ZWQgZHVyaW5nIHNldHVwLlxuICpcbiAqIEBzZWUgaHR0cHM6Ly9naXRodWIuY29tL0Nsb3VkU25vcmtlbC9jZGstZ2l0aHViLXJ1bm5lcnMvYmxvYi9tYWluL1NFVFVQX0dJVEhVQi5tZFxuICpcbiAqICoqTGltaXRhdGlvbnMqKlxuICpcbiAqIC0gKipObyBkZXBsb3ltZW50LWZpbGwqKjogVW5saWtlIGBBbHdheXNPbldhcm1SdW5uZXJgLCBzY2hlZHVsZWQgd2FybSBydW5uZXJzIGRvIG5vdCBnZXQgYW4gaW5pdGlhbFxuICogICBmaWxsIG9uIGRlcGxveS4gVGhlIGZpcnN0IGZpbGwgaGFwcGVucyBhdCB0aGUgbmV4dCBzY2hlZHVsZSBvY2N1cnJlbmNlLiBJZiB5b3UgZGVwbG95IGF0IDFwbSBmb3JcbiAqICAgYSAycG0gc2NoZWR1bGUsIHJ1bm5lcnMgd2lsbCBub3QgYXBwZWFyIHVudGlsIDJwbS5cbiAqIC0gSm9icyB3aWxsIHN0aWxsIHRyaWdnZXIgcHJvdmlzaW9uaW5nIG9mIG9uLWRlbWFuZCBydW5uZXJzLCBldmVuIGlmIGEgd2FybSBydW5uZXIgZW5kcyB1cCBiZWluZyB1c2VkLlxuICogLSBZb3UgbWF5IGJyaWVmbHkgc2VlIG1vcmUgdGhhbiBgY291bnRgIHJ1bm5lcnMgd2hlbiBjaGFuZ2luZyBjb25maWcgb3IgYXQgcm90YXRpb24uXG4gKiAtIFRvIHJlbW92ZTogc2V0IGBjb3VudGAgdG8gMCwgZGVwbG95LCB3YWl0IGZvciB3YXJtIHJ1bm5lcnMgdG8gc3RvcCwgdGhlbiByZW1vdmUgYW5kIGRlcGxveSBhZ2Fpbi5cbiAqICAgSWYgeW91IGRvbid0IGZvbGxvdyB0aGlzIHByb2NlZHVyZSwgd2FybSBydW5uZXJzIG1heSBsaW5nZXIgdW50aWwgdGhleSBleHBpcmUuXG4gKiAtIFByb3ZpZGVyIGZhaWx1cmVzIG9yIHRpbWVvdXRzIChsaWtlIExhbWJkYSBwcm92aWRlciB0aW1pbmcgb3V0IGFmdGVyIDE1IG1pbnV0ZXMpIHdpbGwgcmVzdWx0IGluIGFcbiAqICAgZ2FwIGluIGNvdmVyYWdlIHVudGlsIHRoZSByZXRyeSBzdWNjZWVkcy4gQ3VycmVudCByZXRyeSBtZWNoYW5pc20gaGFzIGJ1aWx0LWluIGJhY2stb2ZmIHJhdGUgYW5kXG4gKiAgIGNhbiBiZSB0d2Vha2VkIHVzaW5nIGByZXRyeU9wdGlvbnNgLiBUaGlzIHdpbGwgYmUgaW1wcm92ZWQgaW4gdGhlIGZ1dHVyZS5cbiAqXG4gKiBgYGB0eXBlc2NyaXB0XG4gKiAvLyBDcm9uOiBmaWxsIGF0IDFwbSBvbiB3ZWVrZGF5c1xuICogbmV3IFNjaGVkdWxlZFdhcm1SdW5uZXIoc3RhY2ssICdCdXNpbmVzcyBIb3VycycsIHtcbiAqICAgcnVubmVycyxcbiAqICAgcHJvdmlkZXI6IG15UHJvdmlkZXIsXG4gKiAgIGNvdW50OiAzLFxuICogICBvd25lcjogJ215LW9yZycsXG4gKiAgIHJlcG86ICdteS1yZXBvJyxcbiAqICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5jcm9uKHsgaG91cjogJzEzJywgbWludXRlOiAnMCcsIHdlZWtEYXk6ICdNT04tRlJJJyB9KSxcbiAqICAgZHVyYXRpb246IGNkay5EdXJhdGlvbi5ob3VycygyKSxcbiAqIH0pO1xuICogYGBgXG4gKlxuICogYGBgdHlwZXNjcmlwdFxuICogLy8gUmF0ZTogZmlsbCBldmVyeSAxMiBob3Vyc1xuICogbmV3IFNjaGVkdWxlZFdhcm1SdW5uZXIoc3RhY2ssICdFdmVyeSAxMiBIb3VycycsIHtcbiAqICAgcnVubmVycyxcbiAqICAgcHJvdmlkZXI6IG15UHJvdmlkZXIsXG4gKiAgIGNvdW50OiAyLFxuICogICBvd25lcjogJ215LW9yZycsXG4gKiAgIHJlcG86ICdteS1yZXBvJyxcbiAqICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5yYXRlKGNkay5EdXJhdGlvbi5ob3Vycyg1KSksXG4gKiAgIGR1cmF0aW9uOiBjZGsuRHVyYXRpb24uaG91cnMoMTIpLFxuICogfSk7XG4gKiBgYGBcbiAqL1xuZXhwb3J0IGNsYXNzIFNjaGVkdWxlZFdhcm1SdW5uZXIgZXh0ZW5kcyBDb25zdHJ1Y3Qge1xuICAvKipcbiAgICogVGhlIGZpbGwgcGF5bG9hZCBmb3IgdGhpcyB3YXJtIHJ1bm5lciBjb25maWd1cmF0aW9uLlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBfZmlsbFBheWxvYWQ6IFdhcm1SdW5uZXJGaWxsUGF5bG9hZDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU2NoZWR1bGVkV2FybVJ1bm5lclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIC8vIG1ha2Ugc3VyZSB0aGUgZHVyYXRpb24gaXMgbm90IGxvbmdlciB0aGFuIHRoZSBpbnRlcnZhbCBiZXR3ZWVuIG5leHQgdHdvIHNjaGVkdWxlIG9jY3VycmVuY2VzXG4gICAgY29uc3QgaW50ZXJ2YWwgPSBnZXRTY2hlZHVsZUludGVydmFsU2Vjb25kcyhwcm9wcy5zY2hlZHVsZS5leHByZXNzaW9uU3RyaW5nKTtcbiAgICBpZiAoaW50ZXJ2YWwgIT09IHVuZGVmaW5lZCAmJiBpbnRlcnZhbCA8IHByb3BzLmR1cmF0aW9uLnRvU2Vjb25kcygpKSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoYFNjaGVkdWxlZFdhcm1SdW5uZXIgZHVyYXRpb24gJHtwcm9wcy5kdXJhdGlvbi50b0h1bWFuU3RyaW5nKCl9IGlzIGxvbmdlciB0aGFuIHRoZSBpbnRlcnZhbCAke2Nkay5EdXJhdGlvbi5zZWNvbmRzKGludGVydmFsKS50b0h1bWFuU3RyaW5nKCl9IGJldHdlZW4gbmV4dCB0d28gc2NoZWR1bGUgb2NjdXJyZW5jZXMuIFRoaXMgd2lsbCByZXN1bHQgaW4gb3ZlcmxhcHBpbmcgd2FybSBydW5uZXJzIGF0IHRoZSBzdGFydCBvZiB0aGUgbmV4dCBzY2hlZHVsZSBvY2N1cnJlbmNlLmApO1xuICAgIH1cblxuICAgIC8vIHdhcm4gZm9yIHNob3J0IGludGVydmFsXG4gICAgaWYgKGludGVydmFsICE9PSB1bmRlZmluZWQgJiYgaW50ZXJ2YWwgPCBjZGsuRHVyYXRpb24uaG91cnMoMSkudG9TZWNvbmRzKCkpIHtcbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nVjIoXG4gICAgICAgICdAY2xvdWRzbm9ya2VsL2Nkay1naXRodWItcnVubmVyczpTY2hlZHVsZWRXYXJtUnVubmVyLmludGVydmFsVG9vU2hvcnQnLFxuICAgICAgICBgU2NoZWR1bGVkV2FybVJ1bm5lciBpbnRlcnZhbCAke2Nkay5EdXJhdGlvbi5zZWNvbmRzKGludGVydmFsKS50b0h1bWFuU3RyaW5nKCl9IGlzIGxlc3MgdGhhbiAxIGhvdXIsIHdoaWNoIG1heSByZXN1bHQgaW4gbW9yZSB3YXJtIHJ1bm5lcnMgdGhhbiBleHBlY3RlZGAsXG4gICAgICApO1xuICAgIH1cblxuICAgIHRoaXMuX2ZpbGxQYXlsb2FkID0gYnVpbGRXYXJtUnVubmVyKHRoaXMsIHByb3BzLCBwcm9wcy5zY2hlZHVsZSwgcHJvcHMuZHVyYXRpb24udG9TZWNvbmRzKCksIGZhbHNlKTtcbiAgfVxufVxuIl19