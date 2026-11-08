import { StepFunctionLambdaInput } from './lambda-helpers';
interface DeleteFailedRunnerInput extends StepFunctionLambdaInput {
    /**
     * Family of the provider config that was tried, straight out of `$.providerParams.family`. A fallback chain hits
     * this Lambda once per attempt, so this is the family of that attempt and not of the whole chain.
     *
     * Undefined for executions started before this field existed.
     */
    readonly family?: string;
    /**
     * The error that failed this attempt, straight out of the catch in `$.error`. We only log it, so failure reasons can be seen without state machine
     * logging enabled.
     *
     * Undefined for executions started before this field existed.
     */
    readonly error?: {
        readonly Error?: string;
        readonly Cause?: string;
    };
}
/**
 * Outcome of the clean-up, stored in `$.delete` by the step function so the execution history says what happened.
 *
 * The original error that got us here is re-raised by a separate `Rethrow Error` state, so a red `Delete Failed Runner`
 * state always means the clean-up itself had a problem. We only throw when we can't be sure the runner is gone.
 */
interface DeleteFailedRunnerResult {
    /**
     * Was a runner still registered on GitHub Actions when we looked for it?
     */
    readonly runnerFound: boolean;
    /**
     * Did we delete the runner? Always false when no runner was found, as there is nothing to delete.
     */
    readonly runnerDeleted: boolean;
    /**
     * Instances we terminated because they outlived the runner. Usually empty: an EC2 runner should power itself off so any instance listed here failed
     * to do that for some reason. Other providers are not affected because AWS handles turning them off for us.
     */
    readonly instancesTerminated: string[];
}
export declare function handler(event: DeleteFailedRunnerInput): Promise<DeleteFailedRunnerResult>;
export {};
