"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompositeProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const common_1 = require("./common");
/**
 * A composite runner provider that implements fallback and distribution strategies.
 */
class CompositeProvider {
    /**
     * Creates a fallback runner provider that tries each provider in order until one succeeds.
     *
     * For example, given providers A, B, C:
     * - Try A first
     * - If A fails, try B
     * - If B fails, try C
     *
     * You can use this to try spot instance first, and switch to on-demand instances if spot is unavailable.
     *
     * Or you can use this to try different instance types in order of preference.
     *
     * @param scope The scope in which to define this construct
     * @param id The scoped construct ID
     * @param providers List of runner providers to try in order
     */
    static fallback(scope, id, providers) {
        if (providers.length < 2) {
            throw new Error('At least two providers must be specified for fallback');
        }
        this.validateLabels(providers);
        return new FallbackRunnerProvider(scope, id, providers);
    }
    /**
     * Creates a weighted distribution runner provider that randomly selects a provider based on weights.
     *
     * For example, given providers A (weight 10), B (weight 20), C (weight 30):
     * - Total weight = 60
     * - Probability of selecting A = 10/60 = 16.67%
     * - Probability of selecting B = 20/60 = 33.33%
     * - Probability of selecting C = 30/60 = 50%
     *
     * You can use this to distribute load across multiple instance types or availability zones.
     *
     * @param scope The scope in which to define this construct
     * @param id The scoped construct ID
     * @param weightedProviders List of weighted runner providers
     */
    static distribute(scope, id, weightedProviders) {
        if (weightedProviders.length < 2) {
            throw new Error('At least two providers must be specified for distribution');
        }
        // Validate labels
        this.validateLabels(weightedProviders.map(wp => wp.provider));
        // Validate weights
        for (const wp of weightedProviders) {
            if (wp.weight <= 0) {
                throw new Error('All weights must be positive numbers');
            }
        }
        return new DistributedRunnerProvider(scope, id, weightedProviders);
    }
    /**
     * Validates that all providers have the exact same labels.
     * This is required so that any provisioned runner can match the labels requested by the GitHub workflow job.
     *
     * @param providers Providers to validate
     */
    static validateLabels(providers) {
        const firstLabels = new Set(providers[0].labels);
        for (const provider of providers.slice(1)) {
            const providerLabels = new Set(provider.labels);
            if (firstLabels.size !== providerLabels.size || ![...firstLabels].every(label => providerLabels.has(label))) {
                throw new Error(`All providers must have the exact same labels (${[...firstLabels].join(', ')} != ${[...providerLabels].join(', ')})`);
            }
        }
    }
}
exports.CompositeProvider = CompositeProvider;
_a = JSII_RTTI_SYMBOL_1;
CompositeProvider[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.CompositeProvider", version: "0.0.0" };
/**
 * Internal implementation of fallback runner provider.
 *
 * @internal
 */
class FallbackRunnerProvider extends constructs_1.Construct {
    constructor(scope, id, providers) {
        super(scope, id);
        this.labels = providers[0].labels;
        this.providers = providers;
    }
    /**
     * Builds a Step Functions state machine that implements a fallback strategy.
     *
     * This method constructs a chain where each provider catches errors and falls back
     * to the next provider in sequence. We iterate forward through providers, attaching
     * catch handlers to each one (except the last) that route to the next provider.
     *
     * Example with providers [A, B, C]:
     * - Save firstProvider = A (this will be returned)
     * - Iteration 1 (i=0, provider A): A catches errors → falls back to B
     * - Iteration 2 (i=1, provider B): B catches errors → falls back to C
     * - Result: A → (on error) → B → (on error) → C
     *
     * Some providers generate one state while others (like EC2) may generate more complex chains.
     * We try to avoid creating a complicated state machine, but complex chains may require wrapping in Parallel.
     *
     * @param parameters Runtime parameters for the step function task
     * @returns A Step Functions chainable that implements the fallback logic
     */
    getStepFunctionTask(parameters) {
        const providerChainables = this.providers.map(p => p.getStepFunctionTask(parameters));
        // Wrap providers with multiple end states in a Parallel state
        const wrappedProviderChainables = providerChainables.map((p, i) => {
            if (this.canAddCatchDirectly(p)) {
                return p;
            }
            return new aws_cdk_lib_1.aws_stepfunctions.Parallel(this, `Attempt #${i + 1}`, {
                stateName: (0, common_1.generateStateName)(this, `attempt #${i + 1}`),
            }).branch(p);
        });
        // Attach catch handlers to each provider (except the last) to fall back to the next provider
        for (let i = 0; i < this.providers.length - 1; i++) {
            const currentProvider = wrappedProviderChainables[i];
            const nextProvider = wrappedProviderChainables[i + 1];
            const endState = currentProvider.endStates[0];
            parameters.addCatchAndCleanUp(endState, nextProvider);
        }
        return wrappedProviderChainables[0];
    }
    /**
     * Checks if we can add a catch handler directly to the provider's end state.
     * This avoids wrapping in a Parallel state when possible.
     */
    canAddCatchDirectly(provider) {
        if (provider instanceof aws_cdk_lib_1.aws_stepfunctions.StateMachineFragment) {
            return provider.endStates.length === 1;
        }
        if (provider instanceof aws_cdk_lib_1.aws_stepfunctions.State) {
            return provider.endStates.length === 1;
        }
        return false;
    }
    stepFunctionConstants() {
        return (0, common_1.mergeConstMaps)(...this.providers.map(p => p.stepFunctionConstants()));
    }
    grantStateMachine(stateMachineRole) {
        for (const provider of this.providers) {
            provider.grantStateMachine(stateMachineRole);
        }
    }
    status(statusFunctionRole) {
        return this.providers.map(provider => provider.status(statusFunctionRole));
    }
}
/**
 * Internal implementation of distributed runner provider.
 *
 * @internal
 */
class DistributedRunnerProvider extends constructs_1.Construct {
    constructor(scope, id, weightedProviders) {
        super(scope, id);
        this.weightedProviders = weightedProviders;
        this.labels = weightedProviders[0].provider.labels;
        this.providers = weightedProviders.map(wp => wp.provider);
    }
    /**
     * Weighted random selection algorithm:
     * 1. Generate a random number in [1, totalWeight+1)
     * 2. Build cumulative weight ranges for each provider (e.g., weights [10,20,30] -> ranges [1-10, 11-30, 31-60])
     * 3. Use Step Functions Choice state to route to the provider whose range contains the random number
     *    The first matching condition wins, so we check if rand <= cumulativeWeight for each provider in order
     *
     * Note: States.MathRandom returns a value in [start, end) where end is exclusive. We use [1, totalWeight+1)
     * to ensure the random value can be up to totalWeight (inclusive), which allows the last provider to be selected
     * when rand equals totalWeight.
     */
    getStepFunctionTask(parameters) {
        const totalWeight = this.weightedProviders.reduce((sum, wp) => sum + wp.weight, 0);
        const rand = new aws_cdk_lib_1.aws_stepfunctions.Pass(this, 'Rand', {
            stateName: (0, common_1.generateStateName)(this, 'rand'),
            parameters: {
                rand: aws_cdk_lib_1.aws_stepfunctions.JsonPath.mathRandom(1, totalWeight + 1),
            },
            resultPath: '$.composite',
        });
        const choice = new aws_cdk_lib_1.aws_stepfunctions.Choice(this, 'Choice', {
            stateName: (0, common_1.generateStateName)(this, 'choice'),
        });
        rand.next(choice);
        let rollingWeight = 0;
        for (const wp of this.weightedProviders) {
            rollingWeight += wp.weight;
            choice.when(aws_cdk_lib_1.aws_stepfunctions.Condition.numberLessThanEquals('$.composite.rand', rollingWeight), wp.provider.getStepFunctionTask(parameters));
        }
        return rand;
    }
    stepFunctionConstants() {
        return (0, common_1.mergeConstMaps)(...this.providers.map(p => p.stepFunctionConstants()));
    }
    grantStateMachine(stateMachineRole) {
        for (const wp of this.weightedProviders) {
            wp.provider.grantStateMachine(stateMachineRole);
        }
    }
    status(statusFunctionRole) {
        return this.providers.map(provider => provider.status(statusFunctionRole));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcG9zaXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9jb21wb3NpdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSw2Q0FBaUY7QUFDakYsMkNBQXVDO0FBQ3ZDLHFDQU9rQjtBQWtCbEI7O0dBRUc7QUFDSCxNQUFhLGlCQUFpQjtJQUM1Qjs7Ozs7Ozs7Ozs7Ozs7O09BZUc7SUFDSSxNQUFNLENBQUMsUUFBUSxDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFNBQTRCO1FBQy9FLElBQUksU0FBUyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN6QixNQUFNLElBQUksS0FBSyxDQUFDLHVEQUF1RCxDQUFDLENBQUM7UUFDM0UsQ0FBQztRQUVELElBQUksQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFL0IsT0FBTyxJQUFJLHNCQUFzQixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsU0FBUyxDQUFDLENBQUM7SUFDMUQsQ0FBQztJQUVEOzs7Ozs7Ozs7Ozs7OztPQWNHO0lBQ0ksTUFBTSxDQUFDLFVBQVUsQ0FBQyxLQUFnQixFQUFFLEVBQVUsRUFBRSxpQkFBMkM7UUFDaEcsSUFBSSxpQkFBaUIsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDakMsTUFBTSxJQUFJLEtBQUssQ0FBQywyREFBMkQsQ0FBQyxDQUFDO1FBQy9FLENBQUM7UUFFRCxrQkFBa0I7UUFDbEIsSUFBSSxDQUFDLGNBQWMsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztRQUU5RCxtQkFBbUI7UUFDbkIsS0FBSyxNQUFNLEVBQUUsSUFBSSxpQkFBaUIsRUFBRSxDQUFDO1lBQ25DLElBQUksRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDbkIsTUFBTSxJQUFJLEtBQUssQ0FB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QUFFLENBQUM7WUFDeEMsYUFBYSxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUM7WUFDM0IsTUFBTSxDQUFDLElBQUksQ0FDVCwrQkFBYSxDQUFDLFNBQVMsQ0FBQyxvQkFBb0IsQ0FBQyxrQkFBa0IsRUFBRSxhQUFhLENBQUMsRUFDL0UsRUFBRSxDQUFDLFFBQVEsQ0FBQyxtQkFBbUIsQ0FBQyxVQUFVLENBQUMsQ0FDNUMsQ0FBQztRQUNKLENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFRCxxQkFBcUI7UUFDbkIsT0FBTyxJQUFBLHVCQUFjLEVBQUMsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxxQkFBcUIsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUMvRSxDQUFDO0lBRUQsaUJBQWlCLENBQUMsZ0JBQWdDO1FBQ2hELEtBQUssTUFBTSxFQUFFLElBQUksSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDeEMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ2xELENBQUM7SUFDSCxDQUFDO0lBRUQsTUFBTSxDQUFDLGtCQUFrQztRQUN2QyxPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUM7SUFDN0UsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXdzX2lhbSBhcyBpYW0sIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gIGdlbmVyYXRlU3RhdGVOYW1lLFxuICBJQ29tcG9zaXRlUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyU3RhdHVzLFxuICBJUnVubmVyUnVudGltZVBhcmFtZXRlcnMsXG4gIG1lcmdlQ29uc3RNYXBzLFxufSBmcm9tICcuL2NvbW1vbic7XG5cbi8qKlxuICogQ29uZmlndXJhdGlvbiBmb3Igd2VpZ2h0ZWQgZGlzdHJpYnV0aW9uIG9mIHJ1bm5lcnMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV2VpZ2h0ZWRSdW5uZXJQcm92aWRlciB7XG4gIC8qKlxuICAgKiBUaGUgcnVubmVyIHByb3ZpZGVyIHRvIHVzZS5cbiAgICovXG4gIHJlYWRvbmx5IHByb3ZpZGVyOiBJUnVubmVyUHJvdmlkZXI7XG5cbiAgLyoqXG4gICAqIFdlaWdodCBmb3IgdGhpcyBwcm92aWRlci4gSGlnaGVyIHdlaWdodHMgbWVhbiBoaWdoZXIgcHJvYmFiaWxpdHkgb2Ygc2VsZWN0aW9uLlxuICAgKiBNdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyLlxuICAgKi9cbiAgcmVhZG9ubHkgd2VpZ2h0OiBudW1iZXI7XG59XG5cbi8qKlxuICogQSBjb21wb3NpdGUgcnVubmVyIHByb3ZpZGVyIHRoYXQgaW1wbGVtZW50cyBmYWxsYmFjayBhbmQgZGlzdHJpYnV0aW9uIHN0cmF0ZWdpZXMuXG4gKi9cbmV4cG9ydCBjbGFzcyBDb21wb3NpdGVQcm92aWRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgZmFsbGJhY2sgcnVubmVyIHByb3ZpZGVyIHRoYXQgdHJpZXMgZWFjaCBwcm92aWRlciBpbiBvcmRlciB1bnRpbCBvbmUgc3VjY2VlZHMuXG4gICAqXG4gICAqIEZvciBleGFtcGxlLCBnaXZlbiBwcm92aWRlcnMgQSwgQiwgQzpcbiAgICogLSBUcnkgQSBmaXJzdFxuICAgKiAtIElmIEEgZmFpbHMsIHRyeSBCXG4gICAqIC0gSWYgQiBmYWlscywgdHJ5IENcbiAgICpcbiAgICogWW91IGNhbiB1c2UgdGhpcyB0byB0cnkgc3BvdCBpbnN0YW5jZSBmaXJzdCwgYW5kIHN3aXRjaCB0byBvbi1kZW1hbmQgaW5zdGFuY2VzIGlmIHNwb3QgaXMgdW5hdmFpbGFibGUuXG4gICAqXG4gICAqIE9yIHlvdSBjYW4gdXNlIHRoaXMgdG8gdHJ5IGRpZmZlcmVudCBpbnN0YW5jZSB0eXBlcyBpbiBvcmRlciBvZiBwcmVmZXJlbmNlLlxuICAgKlxuICAgKiBAcGFyYW0gc2NvcGUgVGhlIHNjb3BlIGluIHdoaWNoIHRvIGRlZmluZSB0aGlzIGNvbnN0cnVjdFxuICAgKiBAcGFyYW0gaWQgVGhlIHNjb3BlZCBjb25zdHJ1Y3QgSURcbiAgICogQHBhcmFtIHByb3ZpZGVycyBMaXN0IG9mIHJ1bm5lciBwcm92aWRlcnMgdG8gdHJ5IGluIG9yZGVyXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZhbGxiYWNrKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3ZpZGVyczogSVJ1bm5lclByb3ZpZGVyW10pOiBJQ29tcG9zaXRlUHJvdmlkZXIge1xuICAgIGlmIChwcm92aWRlcnMubGVuZ3RoIDwgMikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdBdCBsZWFzdCB0d28gcHJvdmlkZXJzIG11c3QgYmUgc3BlY2lmaWVkIGZvciBmYWxsYmFjaycpO1xuICAgIH1cblxuICAgIHRoaXMudmFsaWRhdGVMYWJlbHMocHJvdmlkZXJzKTtcblxuICAgIHJldHVybiBuZXcgRmFsbGJhY2tSdW5uZXJQcm92aWRlcihzY29wZSwgaWQsIHByb3ZpZGVycyk7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIHdlaWdodGVkIGRpc3RyaWJ1dGlvbiBydW5uZXIgcHJvdmlkZXIgdGhhdCByYW5kb21seSBzZWxlY3RzIGEgcHJvdmlkZXIgYmFzZWQgb24gd2VpZ2h0cy5cbiAgICpcbiAgICogRm9yIGV4YW1wbGUsIGdpdmVuIHByb3ZpZGVycyBBICh3ZWlnaHQgMTApLCBCICh3ZWlnaHQgMjApLCBDICh3ZWlnaHQgMzApOlxuICAgKiAtIFRvdGFsIHdlaWdodCA9IDYwXG4gICAqIC0gUHJvYmFiaWxpdHkgb2Ygc2VsZWN0aW5nIEEgPSAxMC82MCA9IDE2LjY3JVxuICAgKiAtIFByb2JhYmlsaXR5IG9mIHNlbGVjdGluZyBCID0gMjAvNjAgPSAzMy4zMyVcbiAgICogLSBQcm9iYWJpbGl0eSBvZiBzZWxlY3RpbmcgQyA9IDMwLzYwID0gNTAlXG4gICAqXG4gICAqIFlvdSBjYW4gdXNlIHRoaXMgdG8gZGlzdHJpYnV0ZSBsb2FkIGFjcm9zcyBtdWx0aXBsZSBpbnN0YW5jZSB0eXBlcyBvciBhdmFpbGFiaWxpdHkgem9uZXMuXG4gICAqXG4gICAqIEBwYXJhbSBzY29wZSBUaGUgc2NvcGUgaW4gd2hpY2ggdG8gZGVmaW5lIHRoaXMgY29uc3RydWN0XG4gICAqIEBwYXJhbSBpZCBUaGUgc2NvcGVkIGNvbnN0cnVjdCBJRFxuICAgKiBAcGFyYW0gd2VpZ2h0ZWRQcm92aWRlcnMgTGlzdCBvZiB3ZWlnaHRlZCBydW5uZXIgcHJvdmlkZXJzXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGRpc3RyaWJ1dGUoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgd2VpZ2h0ZWRQcm92aWRlcnM6IFdlaWdodGVkUnVubmVyUHJvdmlkZXJbXSk6IElDb21wb3NpdGVQcm92aWRlciB7XG4gICAgaWYgKHdlaWdodGVkUHJvdmlkZXJzLmxlbmd0aCA8IDIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQXQgbGVhc3QgdHdvIHByb3ZpZGVycyBtdXN0IGJlIHNwZWNpZmllZCBmb3IgZGlzdHJpYnV0aW9uJyk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgbGFiZWxzXG4gICAgdGhpcy52YWxpZGF0ZUxhYmVscyh3ZWlnaHRlZFByb3ZpZGVycy5tYXAod3AgPT4gd3AucHJvdmlkZXIpKTtcblxuICAgIC8vIFZhbGlkYXRlIHdlaWdodHNcbiAgICBmb3IgKGNvbnN0IHdwIG9mIHdlaWdodGVkUHJvdmlkZXJzKSB7XG4gICAgICBpZiAod3Aud2VpZ2h0IDw9IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdBbGwgd2VpZ2h0cyBtdXN0IGJlIHBvc2l0aXZlIG51bWJlcnMnKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IERpc3RyaWJ1dGVkUnVubmVyUHJvdmlkZXIoc2NvcGUsIGlkLCB3ZWlnaHRlZFByb3ZpZGVycyk7XG4gIH1cblxuICAvKipcbiAgICogVmFsaWRhdGVzIHRoYXQgYWxsIHByb3ZpZGVycyBoYXZlIHRoZSBleGFjdCBzYW1lIGxhYmVscy5cbiAgICogVGhpcyBpcyByZXF1aXJlZCBzbyB0aGF0IGFueSBwcm92aXNpb25lZCBydW5uZXIgY2FuIG1hdGNoIHRoZSBsYWJlbHMgcmVxdWVzdGVkIGJ5IHRoZSBHaXRIdWIgd29ya2Zsb3cgam9iLlxuICAgKlxuICAgKiBAcGFyYW0gcHJvdmlkZXJzIFByb3ZpZGVycyB0byB2YWxpZGF0ZVxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgdmFsaWRhdGVMYWJlbHMocHJvdmlkZXJzOiBJUnVubmVyUHJvdmlkZXJbXSk6IHZvaWQge1xuICAgIGNvbnN0IGZpcnN0TGFiZWxzID0gbmV3IFNldChwcm92aWRlcnNbMF0ubGFiZWxzKTtcbiAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIHByb3ZpZGVycy5zbGljZSgxKSkge1xuICAgICAgY29uc3QgcHJvdmlkZXJMYWJlbHMgPSBuZXcgU2V0KHByb3ZpZGVyLmxhYmVscyk7XG4gICAgICBpZiAoZmlyc3RMYWJlbHMuc2l6ZSAhPT0gcHJvdmlkZXJMYWJlbHMuc2l6ZSB8fCAhWy4uLmZpcnN0TGFiZWxzXS5ldmVyeShsYWJlbCA9PiBwcm92aWRlckxhYmVscy5oYXMobGFiZWwpKSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEFsbCBwcm92aWRlcnMgbXVzdCBoYXZlIHRoZSBleGFjdCBzYW1lIGxhYmVscyAoJHtbLi4uZmlyc3RMYWJlbHNdLmpvaW4oJywgJyl9ICE9ICR7Wy4uLnByb3ZpZGVyTGFiZWxzXS5qb2luKCcsICcpfSlgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBJbnRlcm5hbCBpbXBsZW1lbnRhdGlvbiBvZiBmYWxsYmFjayBydW5uZXIgcHJvdmlkZXIuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmNsYXNzIEZhbGxiYWNrUnVubmVyUHJvdmlkZXIgZXh0ZW5kcyBDb25zdHJ1Y3QgaW1wbGVtZW50cyBJQ29tcG9zaXRlUHJvdmlkZXIge1xuICBwdWJsaWMgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcbiAgcHVibGljIHJlYWRvbmx5IHByb3ZpZGVyczogSVJ1bm5lclByb3ZpZGVyW107XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvdmlkZXJzOiBJUnVubmVyUHJvdmlkZXJbXSkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG4gICAgdGhpcy5sYWJlbHMgPSBwcm92aWRlcnNbMF0ubGFiZWxzO1xuICAgIHRoaXMucHJvdmlkZXJzID0gcHJvdmlkZXJzO1xuICB9XG5cbiAgLyoqXG4gICAqIEJ1aWxkcyBhIFN0ZXAgRnVuY3Rpb25zIHN0YXRlIG1hY2hpbmUgdGhhdCBpbXBsZW1lbnRzIGEgZmFsbGJhY2sgc3RyYXRlZ3kuXG4gICAqXG4gICAqIFRoaXMgbWV0aG9kIGNvbnN0cnVjdHMgYSBjaGFpbiB3aGVyZSBlYWNoIHByb3ZpZGVyIGNhdGNoZXMgZXJyb3JzIGFuZCBmYWxscyBiYWNrXG4gICAqIHRvIHRoZSBuZXh0IHByb3ZpZGVyIGluIHNlcXVlbmNlLiBXZSBpdGVyYXRlIGZvcndhcmQgdGhyb3VnaCBwcm92aWRlcnMsIGF0dGFjaGluZ1xuICAgKiBjYXRjaCBoYW5kbGVycyB0byBlYWNoIG9uZSAoZXhjZXB0IHRoZSBsYXN0KSB0aGF0IHJvdXRlIHRvIHRoZSBuZXh0IHByb3ZpZGVyLlxuICAgKlxuICAgKiBFeGFtcGxlIHdpdGggcHJvdmlkZXJzIFtBLCBCLCBDXTpcbiAgICogLSBTYXZlIGZpcnN0UHJvdmlkZXIgPSBBICh0aGlzIHdpbGwgYmUgcmV0dXJuZWQpXG4gICAqIC0gSXRlcmF0aW9uIDEgKGk9MCwgcHJvdmlkZXIgQSk6IEEgY2F0Y2hlcyBlcnJvcnMg4oaSIGZhbGxzIGJhY2sgdG8gQlxuICAgKiAtIEl0ZXJhdGlvbiAyIChpPTEsIHByb3ZpZGVyIEIpOiBCIGNhdGNoZXMgZXJyb3JzIOKGkiBmYWxscyBiYWNrIHRvIENcbiAgICogLSBSZXN1bHQ6IEEg4oaSIChvbiBlcnJvcikg4oaSIEIg4oaSIChvbiBlcnJvcikg4oaSIENcbiAgICpcbiAgICogU29tZSBwcm92aWRlcnMgZ2VuZXJhdGUgb25lIHN0YXRlIHdoaWxlIG90aGVycyAobGlrZSBFQzIpIG1heSBnZW5lcmF0ZSBtb3JlIGNvbXBsZXggY2hhaW5zLlxuICAgKiBXZSB0cnkgdG8gYXZvaWQgY3JlYXRpbmcgYSBjb21wbGljYXRlZCBzdGF0ZSBtYWNoaW5lLCBidXQgY29tcGxleCBjaGFpbnMgbWF5IHJlcXVpcmUgd3JhcHBpbmcgaW4gUGFyYWxsZWwuXG4gICAqXG4gICAqIEBwYXJhbSBwYXJhbWV0ZXJzIFJ1bnRpbWUgcGFyYW1ldGVycyBmb3IgdGhlIHN0ZXAgZnVuY3Rpb24gdGFza1xuICAgKiBAcmV0dXJucyBBIFN0ZXAgRnVuY3Rpb25zIGNoYWluYWJsZSB0aGF0IGltcGxlbWVudHMgdGhlIGZhbGxiYWNrIGxvZ2ljXG4gICAqL1xuICBnZXRTdGVwRnVuY3Rpb25UYXNrKHBhcmFtZXRlcnM6IElSdW5uZXJSdW50aW1lUGFyYW1ldGVycyk6IHN0ZXBmdW5jdGlvbnMuSUNoYWluYWJsZSB7XG4gICAgY29uc3QgcHJvdmlkZXJDaGFpbmFibGVzID0gdGhpcy5wcm92aWRlcnMubWFwKHAgPT4gcC5nZXRTdGVwRnVuY3Rpb25UYXNrKHBhcmFtZXRlcnMpKTtcblxuICAgIC8vIFdyYXAgcHJvdmlkZXJzIHdpdGggbXVsdGlwbGUgZW5kIHN0YXRlcyBpbiBhIFBhcmFsbGVsIHN0YXRlXG4gICAgY29uc3Qgd3JhcHBlZFByb3ZpZGVyQ2hhaW5hYmxlcyA9IHByb3ZpZGVyQ2hhaW5hYmxlcy5tYXAoKHAsIGkpID0+IHtcbiAgICAgIGlmICh0aGlzLmNhbkFkZENhdGNoRGlyZWN0bHkocCkpIHtcbiAgICAgICAgcmV0dXJuIHA7XG4gICAgICB9XG4gICAgICByZXR1cm4gbmV3IHN0ZXBmdW5jdGlvbnMuUGFyYWxsZWwodGhpcywgYEF0dGVtcHQgIyR7aSArIDF9YCwge1xuICAgICAgICBzdGF0ZU5hbWU6IGdlbmVyYXRlU3RhdGVOYW1lKHRoaXMsIGBhdHRlbXB0ICMke2kgKyAxfWApLFxuICAgICAgfSkuYnJhbmNoKHApO1xuICAgIH0pO1xuXG4gICAgLy8gQXR0YWNoIGNhdGNoIGhhbmRsZXJzIHRvIGVhY2ggcHJvdmlkZXIgKGV4Y2VwdCB0aGUgbGFzdCkgdG8gZmFsbCBiYWNrIHRvIHRoZSBuZXh0IHByb3ZpZGVyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnByb3ZpZGVycy5sZW5ndGggLSAxOyBpKyspIHtcbiAgICAgIGNvbnN0IGN1cnJlbnRQcm92aWRlciA9IHdyYXBwZWRQcm92aWRlckNoYWluYWJsZXNbaV07XG4gICAgICBjb25zdCBuZXh0UHJvdmlkZXIgPSB3cmFwcGVkUHJvdmlkZXJDaGFpbmFibGVzW2kgKyAxXTtcblxuICAgICAgY29uc3QgZW5kU3RhdGUgPSBjdXJyZW50UHJvdmlkZXIuZW5kU3RhdGVzWzBdIGFzIHN0ZXBmdW5jdGlvbnMuVGFza1N0YXRlQmFzZSB8IHN0ZXBmdW5jdGlvbnMuUGFyYWxsZWw7XG4gICAgICBwYXJhbWV0ZXJzLmFkZENhdGNoQW5kQ2xlYW5VcChlbmRTdGF0ZSwgbmV4dFByb3ZpZGVyKTtcbiAgICB9XG5cbiAgICByZXR1cm4gd3JhcHBlZFByb3ZpZGVyQ2hhaW5hYmxlc1swXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgd2UgY2FuIGFkZCBhIGNhdGNoIGhhbmRsZXIgZGlyZWN0bHkgdG8gdGhlIHByb3ZpZGVyJ3MgZW5kIHN0YXRlLlxuICAgKiBUaGlzIGF2b2lkcyB3cmFwcGluZyBpbiBhIFBhcmFsbGVsIHN0YXRlIHdoZW4gcG9zc2libGUuXG4gICAqL1xuICBwcml2YXRlIGNhbkFkZENhdGNoRGlyZWN0bHkocHJvdmlkZXI6IHN0ZXBmdW5jdGlvbnMuSUNoYWluYWJsZSk6IGJvb2xlYW4ge1xuICAgIGlmIChwcm92aWRlciBpbnN0YW5jZW9mIHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lRnJhZ21lbnQpIHtcbiAgICAgIHJldHVybiBwcm92aWRlci5lbmRTdGF0ZXMubGVuZ3RoID09PSAxO1xuICAgIH1cbiAgICBpZiAocHJvdmlkZXIgaW5zdGFuY2VvZiBzdGVwZnVuY3Rpb25zLlN0YXRlKSB7XG4gICAgICByZXR1cm4gcHJvdmlkZXIuZW5kU3RhdGVzLmxlbmd0aCA9PT0gMTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgc3RlcEZ1bmN0aW9uQ29uc3RhbnRzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiBtZXJnZUNvbnN0TWFwcyguLi50aGlzLnByb3ZpZGVycy5tYXAocCA9PiBwLnN0ZXBGdW5jdGlvbkNvbnN0YW50cygpKSk7XG4gIH1cblxuICBncmFudFN0YXRlTWFjaGluZShzdGF0ZU1hY2hpbmVSb2xlOiBpYW0uSUdyYW50YWJsZSk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgdGhpcy5wcm92aWRlcnMpIHtcbiAgICAgIHByb3ZpZGVyLmdyYW50U3RhdGVNYWNoaW5lKHN0YXRlTWFjaGluZVJvbGUpO1xuICAgIH1cbiAgfVxuXG4gIHN0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGU6IGlhbS5JR3JhbnRhYmxlKTogSVJ1bm5lclByb3ZpZGVyU3RhdHVzW10ge1xuICAgIHJldHVybiB0aGlzLnByb3ZpZGVycy5tYXAocHJvdmlkZXIgPT4gcHJvdmlkZXIuc3RhdHVzKHN0YXR1c0Z1bmN0aW9uUm9sZSkpO1xuICB9XG59XG5cbi8qKlxuICogSW50ZXJuYWwgaW1wbGVtZW50YXRpb24gb2YgZGlzdHJpYnV0ZWQgcnVubmVyIHByb3ZpZGVyLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5jbGFzcyBEaXN0cmlidXRlZFJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQ29uc3RydWN0IGltcGxlbWVudHMgSUNvbXBvc2l0ZVByb3ZpZGVyIHtcbiAgcHVibGljIHJlYWRvbmx5IGxhYmVsczogc3RyaW5nW107XG4gIHB1YmxpYyByZWFkb25seSBwcm92aWRlcnM6IElSdW5uZXJQcm92aWRlcltdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByaXZhdGUgcmVhZG9ubHkgd2VpZ2h0ZWRQcm92aWRlcnM6IFdlaWdodGVkUnVubmVyUHJvdmlkZXJbXSkge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG4gICAgdGhpcy5sYWJlbHMgPSB3ZWlnaHRlZFByb3ZpZGVyc1swXS5wcm92aWRlci5sYWJlbHM7XG4gICAgdGhpcy5wcm92aWRlcnMgPSB3ZWlnaHRlZFByb3ZpZGVycy5tYXAod3AgPT4gd3AucHJvdmlkZXIpO1xuICB9XG5cbiAgLyoqXG4gICAqIFdlaWdodGVkIHJhbmRvbSBzZWxlY3Rpb24gYWxnb3JpdGhtOlxuICAgKiAxLiBHZW5lcmF0ZSBhIHJhbmRvbSBudW1iZXIgaW4gWzEsIHRvdGFsV2VpZ2h0KzEpXG4gICAqIDIuIEJ1aWxkIGN1bXVsYXRpdmUgd2VpZ2h0IHJhbmdlcyBmb3IgZWFjaCBwcm92aWRlciAoZS5nLiwgd2VpZ2h0cyBbMTAsMjAsMzBdIC0+IHJhbmdlcyBbMS0xMCwgMTEtMzAsIDMxLTYwXSlcbiAgICogMy4gVXNlIFN0ZXAgRnVuY3Rpb25zIENob2ljZSBzdGF0ZSB0byByb3V0ZSB0byB0aGUgcHJvdmlkZXIgd2hvc2UgcmFuZ2UgY29udGFpbnMgdGhlIHJhbmRvbSBudW1iZXJcbiAgICogICAgVGhlIGZpcnN0IG1hdGNoaW5nIGNvbmRpdGlvbiB3aW5zLCBzbyB3ZSBjaGVjayBpZiByYW5kIDw9IGN1bXVsYXRpdmVXZWlnaHQgZm9yIGVhY2ggcHJvdmlkZXIgaW4gb3JkZXJcbiAgICpcbiAgICogTm90ZTogU3RhdGVzLk1hdGhSYW5kb20gcmV0dXJucyBhIHZhbHVlIGluIFtzdGFydCwgZW5kKSB3aGVyZSBlbmQgaXMgZXhjbHVzaXZlLiBXZSB1c2UgWzEsIHRvdGFsV2VpZ2h0KzEpXG4gICAqIHRvIGVuc3VyZSB0aGUgcmFuZG9tIHZhbHVlIGNhbiBiZSB1cCB0byB0b3RhbFdlaWdodCAoaW5jbHVzaXZlKSwgd2hpY2ggYWxsb3dzIHRoZSBsYXN0IHByb3ZpZGVyIHRvIGJlIHNlbGVjdGVkXG4gICAqIHdoZW4gcmFuZCBlcXVhbHMgdG90YWxXZWlnaHQuXG4gICAqL1xuICBnZXRTdGVwRnVuY3Rpb25UYXNrKHBhcmFtZXRlcnM6IElSdW5uZXJSdW50aW1lUGFyYW1ldGVycyk6IHN0ZXBmdW5jdGlvbnMuSUNoYWluYWJsZSB7XG4gICAgY29uc3QgdG90YWxXZWlnaHQgPSB0aGlzLndlaWdodGVkUHJvdmlkZXJzLnJlZHVjZSgoc3VtLCB3cCkgPT4gc3VtICsgd3Aud2VpZ2h0LCAwKTtcbiAgICBjb25zdCByYW5kID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFzcyh0aGlzLCAnUmFuZCcsIHtcbiAgICAgIHN0YXRlTmFtZTogZ2VuZXJhdGVTdGF0ZU5hbWUodGhpcywgJ3JhbmQnKSxcbiAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgcmFuZDogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5tYXRoUmFuZG9tKDEsIHRvdGFsV2VpZ2h0ICsgMSksXG4gICAgICB9LFxuICAgICAgcmVzdWx0UGF0aDogJyQuY29tcG9zaXRlJyxcbiAgICB9KTtcbiAgICBjb25zdCBjaG9pY2UgPSBuZXcgc3RlcGZ1bmN0aW9ucy5DaG9pY2UodGhpcywgJ0Nob2ljZScsIHtcbiAgICAgIHN0YXRlTmFtZTogZ2VuZXJhdGVTdGF0ZU5hbWUodGhpcywgJ2Nob2ljZScpLFxuICAgIH0pO1xuICAgIHJhbmQubmV4dChjaG9pY2UpO1xuXG4gICAgbGV0IHJvbGxpbmdXZWlnaHQgPSAwO1xuICAgIGZvciAoY29uc3Qgd3Agb2YgdGhpcy53ZWlnaHRlZFByb3ZpZGVycykge1xuICAgICAgcm9sbGluZ1dlaWdodCArPSB3cC53ZWlnaHQ7XG4gICAgICBjaG9pY2Uud2hlbihcbiAgICAgICAgc3RlcGZ1bmN0aW9ucy5Db25kaXRpb24ubnVtYmVyTGVzc1RoYW5FcXVhbHMoJyQuY29tcG9zaXRlLnJhbmQnLCByb2xsaW5nV2VpZ2h0KSxcbiAgICAgICAgd3AucHJvdmlkZXIuZ2V0U3RlcEZ1bmN0aW9uVGFzayhwYXJhbWV0ZXJzKSxcbiAgICAgICk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJhbmQ7XG4gIH1cblxuICBzdGVwRnVuY3Rpb25Db25zdGFudHMoKTogUmVjb3JkPHN0cmluZywgc3RyaW5nPiB7XG4gICAgcmV0dXJuIG1lcmdlQ29uc3RNYXBzKC4uLnRoaXMucHJvdmlkZXJzLm1hcChwID0+IHAuc3RlcEZ1bmN0aW9uQ29uc3RhbnRzKCkpKTtcbiAgfVxuXG4gIGdyYW50U3RhdGVNYWNoaW5lKHN0YXRlTWFjaGluZVJvbGU6IGlhbS5JR3JhbnRhYmxlKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCB3cCBvZiB0aGlzLndlaWdodGVkUHJvdmlkZXJzKSB7XG4gICAgICB3cC5wcm92aWRlci5ncmFudFN0YXRlTWFjaGluZShzdGF0ZU1hY2hpbmVSb2xlKTtcbiAgICB9XG4gIH1cblxuICBzdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1c1tdIHtcbiAgICByZXR1cm4gdGhpcy5wcm92aWRlcnMubWFwKHByb3ZpZGVyID0+IHByb3ZpZGVyLnN0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGUpKTtcbiAgfVxufVxuIl19