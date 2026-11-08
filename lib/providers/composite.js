"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompositeProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const constructs_1 = require("constructs");
const common_1 = require("./common");
/**
 * Add a fallback at the end of a config's fallback chain.
 */
function appendFallback(config, fallback) {
    return {
        ...config,
        fallback: config.fallback ? appendFallback(config.fallback, fallback) : fallback,
    };
}
/**
 * A composite runner provider that implements fallback and distribution strategies.
 */
class CompositeProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.CompositeProvider", version: "0.0.0" };
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
        this.validateParameterized(providers);
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
        this.validateParameterized(weightedProviders.map(wp => wp.provider));
        // Validate weights
        let totalWeight = 0;
        for (const wp of weightedProviders) {
            if (!Number.isFinite(wp.weight) || wp.weight <= 0) {
                throw new Error('All weights must be positive finite numbers');
            }
            totalWeight += wp.weight;
        }
        if (!Number.isFinite(totalWeight)) {
            throw new Error('Total weight must be a finite number');
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
    /**
     * Make sure every provider is one of the built-in ones we know how to run.
     *
     * @param providers Providers to validate
     */
    static validateParameterized(providers) {
        for (const provider of providers) {
            if (!(0, common_1.isParameterizedRunnerProvider)(provider)) {
                throw new Error(`${provider.node.path} is not a built-in runner provider. Only built-in providers are supported.`);
            }
        }
    }
}
exports.CompositeProvider = CompositeProvider;
/**
 * Internal implementation of fallback runner provider.
 *
 * The state machine does the actual falling back at runtime: every config can chain another one at `fallback`
 * to try when it fails. All we do here is chain the sub-provider configs in order.
 *
 * @internal
 */
class FallbackRunnerProvider extends constructs_1.Construct {
    labels;
    providers;
    parameterized;
    constructor(scope, id, providers) {
        super(scope, id);
        this.labels = providers[0].labels;
        this.providers = providers;
        this.parameterized = providers;
    }
    /**
     * @internal
     */
    _runnerConfig() {
        // chain all sub-provider configs
        // sub-providers can have their own fallback chains (EC2 subnets), so each one goes at the end of the last
        // fallback() only takes providers, never composites, so none of these is a distributed config
        return this.parameterized
            .map(p => p._runnerConfig())
            .reduceRight((fallback, config) => appendFallback(config, fallback));
    }
    /**
     * @internal
     */
    _grantStateMachine(stateMachineRole) {
        for (const provider of this.parameterized) {
            provider._grantStateMachine(stateMachineRole);
        }
    }
    /**
     * @internal
     */
    _status(statusFunctionRole) {
        return this.parameterized.flatMap(provider => provider._status(statusFunctionRole));
    }
}
/**
 * Internal implementation of distributed runner provider.
 *
 * The state machine does the actual distributing at runtime: a config with a `distribute` list makes it pick one
 * of them at random by weight before running it.
 *
 * @internal
 */
class DistributedRunnerProvider extends constructs_1.Construct {
    weightedProviders;
    labels;
    providers;
    parameterized;
    constructor(scope, id, weightedProviders) {
        super(scope, id);
        this.weightedProviders = weightedProviders;
        this.labels = weightedProviders[0].provider.labels;
        this.providers = weightedProviders.map(wp => wp.provider);
        this.parameterized = this.providers;
    }
    /**
     * @internal
     */
    _runnerConfig() {
        // roll up the weights here so the state machine just picks the first config whose threshold is above a random
        // number in [0, totalWeight). both sums add the weights in the same order, so the last threshold always comes
        // out exactly equal to totalWeight and there is always a match
        let runningWeightSum = 0;
        return {
            totalWeight: this.weightedProviders.reduce((sum, wp) => sum + wp.weight, 0),
            distribute: this.weightedProviders.map(wp => ({
                threshold: runningWeightSum += wp.weight,
                config: wp.provider._runnerConfig(),
            })),
        };
    }
    /**
     * @internal
     */
    _grantStateMachine(stateMachineRole) {
        for (const provider of this.parameterized) {
            provider._grantStateMachine(stateMachineRole);
        }
    }
    /**
     * @internal
     */
    _status(statusFunctionRole) {
        return this.parameterized.flatMap(provider => provider._status(statusFunctionRole));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcG9zaXRlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9jb21wb3NpdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQUNBLDJDQUF1QztBQUN2QyxxQ0FRa0I7QUFrQmxCOztHQUVHO0FBQ0gsU0FBUyxjQUFjLENBQUMsTUFBb0IsRUFBRSxRQUFzQjtJQUNsRSxPQUFPO1FBQ0wsR0FBRyxNQUFNO1FBQ1QsUUFBUSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRO0tBQ2pGLENBQUM7QUFDSixDQUFDO0FBRUQ7O0dBRUc7QUFDSCxNQUFhLGlCQUFpQjs7SUFDNUI7Ozs7Ozs7Ozs7Ozs7OztPQWVHO0lBQ0ksTUFBTSxDQUFDLFFBQVEsQ0FBQyxLQUFnQixFQUFFLEVBQVUsRUFBRSxTQUE0QjtRQUMvRSxJQUFJLFNBQVMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDekIsTUFBTSxJQUFJLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFDO1FBQzNFLENBQUM7UUFFRCxJQUFJLENBQUMsY0FBYyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQy9CLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUV0QyxPQUFPLElBQUksc0JBQXNCLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxTQUFTLENBQUMsQ0FBQztJQUMxRCxDQUFDO0lBRUQ7Ozs7Ozs7Ozs7Ozs7O09BY0c7SUFDSSxNQUFNLENBQUMsVUFBVSxDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLGlCQUEyQztRQUNoRyxJQUFJLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUNqQyxNQUFNLElBQUksS0FBSyxDQUFDLDJEQUEyRCxDQUFDLENBQUM7UUFDL0UsQ0FBQztRQUVELGtCQUFrQjtRQUNsQixJQUFJLENBQUMsY0FBYyxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO1FBQzlELElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxpQkFBaUIsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQztRQUVyRSxtQkFBbUI7UUFDbkIsSUFBSSxXQUFXLEdBQUcsQ0FBQyxDQUFDO1FBQ3BCLEtBQUssTUFBTSxFQUFFLElBQUksaUJBQWlCLEVBQUUsQ0FBQztZQUNuQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDbEQsTUFBTSxJQUFJLEtBQUssQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDO1lBQ2pFLENBQUM7WUFDRCxXQUFXLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQztRQUMzQixDQUFDO1FBQ0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQztZQUNsQyxNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxDQUFDLENBQUM7UUFDMUQsQ0FBQztRQUVELE9BQU8sSUFBSSx5QkFBeUIsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLGlCQUFpQixDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0ssTUFBTSxDQUFDLGNBQWMsQ0FBQyxTQUE0QjtRQUN4RCxNQUFNLFdBQVcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDakQsS0FBSyxNQUFNLFFBQVEsSUFBSSxTQUFTLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7WUFDMUMsTUFBTSxjQUFjLEdBQUcsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ2hELElBQUksV0FBVyxDQUFDLElBQUksS0FBSyxjQUFjLENBQUMsSUFBSSxJQUFJLENBQUMsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUM1RyxNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLEdBQUcsV0FBVyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsR0FBRyxjQUFjLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1lBQ3pJLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDSyxNQUFNLENBQUMscUJBQXFCLENBQUMsU0FBNEI7UUFDL0QsS0FBSyxNQUFNLFFBQVEsSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUNqQyxJQUFJLENBQUMsSUFBQSxzQ0FBNkIsRUFBQyxRQUFRLENBQUMsRUFBRSxDQUFDO2dCQUM3QyxNQUFNLElBQUksS0FBSyxDQUFDLEdBQUcsUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLDRFQUE0RSxDQUFDLENBQUM7WUFDckgsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDOztBQTlGSCw4Q0ErRkM7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsTUFBTSxzQkFBdUIsU0FBUSxzQkFBUztJQUM1QixNQUFNLENBQVc7SUFDakIsU0FBUyxDQUFvQjtJQUM1QixhQUFhLENBQWlDO0lBRS9ELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsU0FBNEI7UUFDcEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNqQixJQUFJLENBQUMsTUFBTSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUM7UUFDbEMsSUFBSSxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUM7UUFDM0IsSUFBSSxDQUFDLGFBQWEsR0FBRyxTQUFzRCxDQUFDO0lBQzlFLENBQUM7SUFFRDs7T0FFRztJQUNILGFBQWE7UUFDWCxpQ0FBaUM7UUFDakMsMEdBQTBHO1FBQzFHLDhGQUE4RjtRQUM5RixPQUFPLElBQUksQ0FBQyxhQUFhO2FBQ3RCLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxhQUFhLEVBQWtCLENBQUM7YUFDM0MsV0FBVyxDQUFDLENBQUMsUUFBUSxFQUFFLE1BQU0sRUFBRSxFQUFFLENBQUMsY0FBYyxDQUFDLE1BQU0sRUFBRSxRQUFRLENBQUMsQ0FBQyxDQUFDO0lBQ3pFLENBQUM7SUFFRDs7T0FFRztJQUNILGtCQUFrQixDQUFDLGdCQUFnQztRQUNqRCxLQUFLLE1BQU0sUUFBUSxJQUFJLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztZQUMxQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztRQUNoRCxDQUFDO0lBQ0gsQ0FBQztJQUVEOztPQUVHO0lBQ0gsT0FBTyxDQUFDLGtCQUFrQztRQUN4QyxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDLENBQUM7SUFDdEYsQ0FBQztDQUNGO0FBRUQ7Ozs7Ozs7R0FPRztBQUNILE1BQU0seUJBQTBCLFNBQVEsc0JBQVM7SUFLWTtJQUozQyxNQUFNLENBQVc7SUFDakIsU0FBUyxDQUFvQjtJQUM1QixhQUFhLENBQWlDO0lBRS9ELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQW1CLGlCQUEyQztRQUNwRyxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRHdDLHNCQUFpQixHQUFqQixpQkFBaUIsQ0FBMEI7UUFFcEcsSUFBSSxDQUFDLE1BQU0sR0FBRyxpQkFBaUIsQ0FBQyxDQUFDLENBQUMsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDO1FBQ25ELElBQUksQ0FBQyxTQUFTLEdBQUcsaUJBQWlCLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQzFELElBQUksQ0FBQyxhQUFhLEdBQUcsSUFBSSxDQUFDLFNBQXNELENBQUM7SUFDbkYsQ0FBQztJQUVEOztPQUVHO0lBQ0gsYUFBYTtRQUNYLDhHQUE4RztRQUM5Ryw4R0FBOEc7UUFDOUcsK0RBQStEO1FBQy9ELElBQUksZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO1FBQ3pCLE9BQU87WUFDTCxXQUFXLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFDLEdBQUcsRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUMzRSxVQUFVLEVBQUUsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQzVDLFNBQVMsRUFBRSxnQkFBZ0IsSUFBSSxFQUFFLENBQUMsTUFBTTtnQkFDeEMsTUFBTSxFQUFHLEVBQUUsQ0FBQyxRQUFvRCxDQUFDLGFBQWEsRUFBRTthQUNqRixDQUFDLENBQUM7U0FDSixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ0gsa0JBQWtCLENBQUMsZ0JBQWdDO1FBQ2pELEtBQUssTUFBTSxRQUFRLElBQUksSUFBSSxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQzFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO1FBQ2hELENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxPQUFPLENBQUMsa0JBQWtDO1FBQ3hDLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLGtCQUFrQixDQUFDLENBQUMsQ0FBQztJQUN0RixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBhd3NfaWFtIGFzIGlhbSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHtcbiAgSUNvbXBvc2l0ZVByb3ZpZGVyLFxuICBJUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlclN0YXR1cyxcbiAgaXNQYXJhbWV0ZXJpemVkUnVubmVyUHJvdmlkZXIsXG4gIERpc3RyaWJ1dGVkUnVubmVyQ29uZmlnLFxuICBSdW5uZXJDb25maWcsXG59IGZyb20gJy4vY29tbW9uJztcblxuLyoqXG4gKiBDb25maWd1cmF0aW9uIGZvciB3ZWlnaHRlZCBkaXN0cmlidXRpb24gb2YgcnVubmVycy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBXZWlnaHRlZFJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqXG4gICAqIFRoZSBydW5uZXIgcHJvdmlkZXIgdG8gdXNlLlxuICAgKi9cbiAgcmVhZG9ubHkgcHJvdmlkZXI6IElSdW5uZXJQcm92aWRlcjtcblxuICAvKipcbiAgICogV2VpZ2h0IGZvciB0aGlzIHByb3ZpZGVyLiBIaWdoZXIgd2VpZ2h0cyBtZWFuIGhpZ2hlciBwcm9iYWJpbGl0eSBvZiBzZWxlY3Rpb24uXG4gICAqIE11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXIuXG4gICAqL1xuICByZWFkb25seSB3ZWlnaHQ6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBBZGQgYSBmYWxsYmFjayBhdCB0aGUgZW5kIG9mIGEgY29uZmlnJ3MgZmFsbGJhY2sgY2hhaW4uXG4gKi9cbmZ1bmN0aW9uIGFwcGVuZEZhbGxiYWNrKGNvbmZpZzogUnVubmVyQ29uZmlnLCBmYWxsYmFjazogUnVubmVyQ29uZmlnKTogUnVubmVyQ29uZmlnIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5jb25maWcsXG4gICAgZmFsbGJhY2s6IGNvbmZpZy5mYWxsYmFjayA/IGFwcGVuZEZhbGxiYWNrKGNvbmZpZy5mYWxsYmFjaywgZmFsbGJhY2spIDogZmFsbGJhY2ssXG4gIH07XG59XG5cbi8qKlxuICogQSBjb21wb3NpdGUgcnVubmVyIHByb3ZpZGVyIHRoYXQgaW1wbGVtZW50cyBmYWxsYmFjayBhbmQgZGlzdHJpYnV0aW9uIHN0cmF0ZWdpZXMuXG4gKi9cbmV4cG9ydCBjbGFzcyBDb21wb3NpdGVQcm92aWRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgZmFsbGJhY2sgcnVubmVyIHByb3ZpZGVyIHRoYXQgdHJpZXMgZWFjaCBwcm92aWRlciBpbiBvcmRlciB1bnRpbCBvbmUgc3VjY2VlZHMuXG4gICAqXG4gICAqIEZvciBleGFtcGxlLCBnaXZlbiBwcm92aWRlcnMgQSwgQiwgQzpcbiAgICogLSBUcnkgQSBmaXJzdFxuICAgKiAtIElmIEEgZmFpbHMsIHRyeSBCXG4gICAqIC0gSWYgQiBmYWlscywgdHJ5IENcbiAgICpcbiAgICogWW91IGNhbiB1c2UgdGhpcyB0byB0cnkgc3BvdCBpbnN0YW5jZSBmaXJzdCwgYW5kIHN3aXRjaCB0byBvbi1kZW1hbmQgaW5zdGFuY2VzIGlmIHNwb3QgaXMgdW5hdmFpbGFibGUuXG4gICAqXG4gICAqIE9yIHlvdSBjYW4gdXNlIHRoaXMgdG8gdHJ5IGRpZmZlcmVudCBpbnN0YW5jZSB0eXBlcyBpbiBvcmRlciBvZiBwcmVmZXJlbmNlLlxuICAgKlxuICAgKiBAcGFyYW0gc2NvcGUgVGhlIHNjb3BlIGluIHdoaWNoIHRvIGRlZmluZSB0aGlzIGNvbnN0cnVjdFxuICAgKiBAcGFyYW0gaWQgVGhlIHNjb3BlZCBjb25zdHJ1Y3QgSURcbiAgICogQHBhcmFtIHByb3ZpZGVycyBMaXN0IG9mIHJ1bm5lciBwcm92aWRlcnMgdG8gdHJ5IGluIG9yZGVyXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZhbGxiYWNrKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3ZpZGVyczogSVJ1bm5lclByb3ZpZGVyW10pOiBJQ29tcG9zaXRlUHJvdmlkZXIge1xuICAgIGlmIChwcm92aWRlcnMubGVuZ3RoIDwgMikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdBdCBsZWFzdCB0d28gcHJvdmlkZXJzIG11c3QgYmUgc3BlY2lmaWVkIGZvciBmYWxsYmFjaycpO1xuICAgIH1cblxuICAgIHRoaXMudmFsaWRhdGVMYWJlbHMocHJvdmlkZXJzKTtcbiAgICB0aGlzLnZhbGlkYXRlUGFyYW1ldGVyaXplZChwcm92aWRlcnMpO1xuXG4gICAgcmV0dXJuIG5ldyBGYWxsYmFja1J1bm5lclByb3ZpZGVyKHNjb3BlLCBpZCwgcHJvdmlkZXJzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgd2VpZ2h0ZWQgZGlzdHJpYnV0aW9uIHJ1bm5lciBwcm92aWRlciB0aGF0IHJhbmRvbWx5IHNlbGVjdHMgYSBwcm92aWRlciBiYXNlZCBvbiB3ZWlnaHRzLlxuICAgKlxuICAgKiBGb3IgZXhhbXBsZSwgZ2l2ZW4gcHJvdmlkZXJzIEEgKHdlaWdodCAxMCksIEIgKHdlaWdodCAyMCksIEMgKHdlaWdodCAzMCk6XG4gICAqIC0gVG90YWwgd2VpZ2h0ID0gNjBcbiAgICogLSBQcm9iYWJpbGl0eSBvZiBzZWxlY3RpbmcgQSA9IDEwLzYwID0gMTYuNjclXG4gICAqIC0gUHJvYmFiaWxpdHkgb2Ygc2VsZWN0aW5nIEIgPSAyMC82MCA9IDMzLjMzJVxuICAgKiAtIFByb2JhYmlsaXR5IG9mIHNlbGVjdGluZyBDID0gMzAvNjAgPSA1MCVcbiAgICpcbiAgICogWW91IGNhbiB1c2UgdGhpcyB0byBkaXN0cmlidXRlIGxvYWQgYWNyb3NzIG11bHRpcGxlIGluc3RhbmNlIHR5cGVzIG9yIGF2YWlsYWJpbGl0eSB6b25lcy5cbiAgICpcbiAgICogQHBhcmFtIHNjb3BlIFRoZSBzY29wZSBpbiB3aGljaCB0byBkZWZpbmUgdGhpcyBjb25zdHJ1Y3RcbiAgICogQHBhcmFtIGlkIFRoZSBzY29wZWQgY29uc3RydWN0IElEXG4gICAqIEBwYXJhbSB3ZWlnaHRlZFByb3ZpZGVycyBMaXN0IG9mIHdlaWdodGVkIHJ1bm5lciBwcm92aWRlcnNcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZGlzdHJpYnV0ZShzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCB3ZWlnaHRlZFByb3ZpZGVyczogV2VpZ2h0ZWRSdW5uZXJQcm92aWRlcltdKTogSUNvbXBvc2l0ZVByb3ZpZGVyIHtcbiAgICBpZiAod2VpZ2h0ZWRQcm92aWRlcnMubGVuZ3RoIDwgMikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdBdCBsZWFzdCB0d28gcHJvdmlkZXJzIG11c3QgYmUgc3BlY2lmaWVkIGZvciBkaXN0cmlidXRpb24nKTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSBsYWJlbHNcbiAgICB0aGlzLnZhbGlkYXRlTGFiZWxzKHdlaWdodGVkUHJvdmlkZXJzLm1hcCh3cCA9PiB3cC5wcm92aWRlcikpO1xuICAgIHRoaXMudmFsaWRhdGVQYXJhbWV0ZXJpemVkKHdlaWdodGVkUHJvdmlkZXJzLm1hcCh3cCA9PiB3cC5wcm92aWRlcikpO1xuXG4gICAgLy8gVmFsaWRhdGUgd2VpZ2h0c1xuICAgIGxldCB0b3RhbFdlaWdodCA9IDA7XG4gICAgZm9yIChjb25zdCB3cCBvZiB3ZWlnaHRlZFByb3ZpZGVycykge1xuICAgICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUod3Aud2VpZ2h0KSB8fCB3cC53ZWlnaHQgPD0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FsbCB3ZWlnaHRzIG11c3QgYmUgcG9zaXRpdmUgZmluaXRlIG51bWJlcnMnKTtcbiAgICAgIH1cbiAgICAgIHRvdGFsV2VpZ2h0ICs9IHdwLndlaWdodDtcbiAgICB9XG4gICAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodG90YWxXZWlnaHQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RvdGFsIHdlaWdodCBtdXN0IGJlIGEgZmluaXRlIG51bWJlcicpO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgRGlzdHJpYnV0ZWRSdW5uZXJQcm92aWRlcihzY29wZSwgaWQsIHdlaWdodGVkUHJvdmlkZXJzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgdGhhdCBhbGwgcHJvdmlkZXJzIGhhdmUgdGhlIGV4YWN0IHNhbWUgbGFiZWxzLlxuICAgKiBUaGlzIGlzIHJlcXVpcmVkIHNvIHRoYXQgYW55IHByb3Zpc2lvbmVkIHJ1bm5lciBjYW4gbWF0Y2ggdGhlIGxhYmVscyByZXF1ZXN0ZWQgYnkgdGhlIEdpdEh1YiB3b3JrZmxvdyBqb2IuXG4gICAqXG4gICAqIEBwYXJhbSBwcm92aWRlcnMgUHJvdmlkZXJzIHRvIHZhbGlkYXRlXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyB2YWxpZGF0ZUxhYmVscyhwcm92aWRlcnM6IElSdW5uZXJQcm92aWRlcltdKTogdm9pZCB7XG4gICAgY29uc3QgZmlyc3RMYWJlbHMgPSBuZXcgU2V0KHByb3ZpZGVyc1swXS5sYWJlbHMpO1xuICAgIGZvciAoY29uc3QgcHJvdmlkZXIgb2YgcHJvdmlkZXJzLnNsaWNlKDEpKSB7XG4gICAgICBjb25zdCBwcm92aWRlckxhYmVscyA9IG5ldyBTZXQocHJvdmlkZXIubGFiZWxzKTtcbiAgICAgIGlmIChmaXJzdExhYmVscy5zaXplICE9PSBwcm92aWRlckxhYmVscy5zaXplIHx8ICFbLi4uZmlyc3RMYWJlbHNdLmV2ZXJ5KGxhYmVsID0+IHByb3ZpZGVyTGFiZWxzLmhhcyhsYWJlbCkpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQWxsIHByb3ZpZGVycyBtdXN0IGhhdmUgdGhlIGV4YWN0IHNhbWUgbGFiZWxzICgke1suLi5maXJzdExhYmVsc10uam9pbignLCAnKX0gIT0gJHtbLi4ucHJvdmlkZXJMYWJlbHNdLmpvaW4oJywgJyl9KWApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBNYWtlIHN1cmUgZXZlcnkgcHJvdmlkZXIgaXMgb25lIG9mIHRoZSBidWlsdC1pbiBvbmVzIHdlIGtub3cgaG93IHRvIHJ1bi5cbiAgICpcbiAgICogQHBhcmFtIHByb3ZpZGVycyBQcm92aWRlcnMgdG8gdmFsaWRhdGVcbiAgICovXG4gIHByaXZhdGUgc3RhdGljIHZhbGlkYXRlUGFyYW1ldGVyaXplZChwcm92aWRlcnM6IElSdW5uZXJQcm92aWRlcltdKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBwcm92aWRlciBvZiBwcm92aWRlcnMpIHtcbiAgICAgIGlmICghaXNQYXJhbWV0ZXJpemVkUnVubmVyUHJvdmlkZXIocHJvdmlkZXIpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgJHtwcm92aWRlci5ub2RlLnBhdGh9IGlzIG5vdCBhIGJ1aWx0LWluIHJ1bm5lciBwcm92aWRlci4gT25seSBidWlsdC1pbiBwcm92aWRlcnMgYXJlIHN1cHBvcnRlZC5gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBJbnRlcm5hbCBpbXBsZW1lbnRhdGlvbiBvZiBmYWxsYmFjayBydW5uZXIgcHJvdmlkZXIuXG4gKlxuICogVGhlIHN0YXRlIG1hY2hpbmUgZG9lcyB0aGUgYWN0dWFsIGZhbGxpbmcgYmFjayBhdCBydW50aW1lOiBldmVyeSBjb25maWcgY2FuIGNoYWluIGFub3RoZXIgb25lIGF0IGBmYWxsYmFja2BcbiAqIHRvIHRyeSB3aGVuIGl0IGZhaWxzLiBBbGwgd2UgZG8gaGVyZSBpcyBjaGFpbiB0aGUgc3ViLXByb3ZpZGVyIGNvbmZpZ3MgaW4gb3JkZXIuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmNsYXNzIEZhbGxiYWNrUnVubmVyUHJvdmlkZXIgZXh0ZW5kcyBDb25zdHJ1Y3QgaW1wbGVtZW50cyBJQ29tcG9zaXRlUHJvdmlkZXIge1xuICBwdWJsaWMgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcbiAgcHVibGljIHJlYWRvbmx5IHByb3ZpZGVyczogSVJ1bm5lclByb3ZpZGVyW107XG4gIHByaXZhdGUgcmVhZG9ubHkgcGFyYW1ldGVyaXplZDogSVBhcmFtZXRlcml6ZWRSdW5uZXJQcm92aWRlcltdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3ZpZGVyczogSVJ1bm5lclByb3ZpZGVyW10pIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuICAgIHRoaXMubGFiZWxzID0gcHJvdmlkZXJzWzBdLmxhYmVscztcbiAgICB0aGlzLnByb3ZpZGVycyA9IHByb3ZpZGVycztcbiAgICB0aGlzLnBhcmFtZXRlcml6ZWQgPSBwcm92aWRlcnMgYXMgdW5rbm93biBhcyBJUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyW107XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfcnVubmVyQ29uZmlnKCk6IGFueSB7XG4gICAgLy8gY2hhaW4gYWxsIHN1Yi1wcm92aWRlciBjb25maWdzXG4gICAgLy8gc3ViLXByb3ZpZGVycyBjYW4gaGF2ZSB0aGVpciBvd24gZmFsbGJhY2sgY2hhaW5zIChFQzIgc3VibmV0cyksIHNvIGVhY2ggb25lIGdvZXMgYXQgdGhlIGVuZCBvZiB0aGUgbGFzdFxuICAgIC8vIGZhbGxiYWNrKCkgb25seSB0YWtlcyBwcm92aWRlcnMsIG5ldmVyIGNvbXBvc2l0ZXMsIHNvIG5vbmUgb2YgdGhlc2UgaXMgYSBkaXN0cmlidXRlZCBjb25maWdcbiAgICByZXR1cm4gdGhpcy5wYXJhbWV0ZXJpemVkXG4gICAgICAubWFwKHAgPT4gcC5fcnVubmVyQ29uZmlnKCkgYXMgUnVubmVyQ29uZmlnKVxuICAgICAgLnJlZHVjZVJpZ2h0KChmYWxsYmFjaywgY29uZmlnKSA9PiBhcHBlbmRGYWxsYmFjayhjb25maWcsIGZhbGxiYWNrKSk7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lUm9sZTogaWFtLklHcmFudGFibGUpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIHRoaXMucGFyYW1ldGVyaXplZCkge1xuICAgICAgcHJvdmlkZXIuX2dyYW50U3RhdGVNYWNoaW5lKHN0YXRlTWFjaGluZVJvbGUpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9zdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1c1tdIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbWV0ZXJpemVkLmZsYXRNYXAocHJvdmlkZXIgPT4gcHJvdmlkZXIuX3N0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGUpKTtcbiAgfVxufVxuXG4vKipcbiAqIEludGVybmFsIGltcGxlbWVudGF0aW9uIG9mIGRpc3RyaWJ1dGVkIHJ1bm5lciBwcm92aWRlci5cbiAqXG4gKiBUaGUgc3RhdGUgbWFjaGluZSBkb2VzIHRoZSBhY3R1YWwgZGlzdHJpYnV0aW5nIGF0IHJ1bnRpbWU6IGEgY29uZmlnIHdpdGggYSBgZGlzdHJpYnV0ZWAgbGlzdCBtYWtlcyBpdCBwaWNrIG9uZVxuICogb2YgdGhlbSBhdCByYW5kb20gYnkgd2VpZ2h0IGJlZm9yZSBydW5uaW5nIGl0LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5jbGFzcyBEaXN0cmlidXRlZFJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQ29uc3RydWN0IGltcGxlbWVudHMgSUNvbXBvc2l0ZVByb3ZpZGVyIHtcbiAgcHVibGljIHJlYWRvbmx5IGxhYmVsczogc3RyaW5nW107XG4gIHB1YmxpYyByZWFkb25seSBwcm92aWRlcnM6IElSdW5uZXJQcm92aWRlcltdO1xuICBwcml2YXRlIHJlYWRvbmx5IHBhcmFtZXRlcml6ZWQ6IElQYXJhbWV0ZXJpemVkUnVubmVyUHJvdmlkZXJbXTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcml2YXRlIHJlYWRvbmx5IHdlaWdodGVkUHJvdmlkZXJzOiBXZWlnaHRlZFJ1bm5lclByb3ZpZGVyW10pIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuICAgIHRoaXMubGFiZWxzID0gd2VpZ2h0ZWRQcm92aWRlcnNbMF0ucHJvdmlkZXIubGFiZWxzO1xuICAgIHRoaXMucHJvdmlkZXJzID0gd2VpZ2h0ZWRQcm92aWRlcnMubWFwKHdwID0+IHdwLnByb3ZpZGVyKTtcbiAgICB0aGlzLnBhcmFtZXRlcml6ZWQgPSB0aGlzLnByb3ZpZGVycyBhcyB1bmtub3duIGFzIElQYXJhbWV0ZXJpemVkUnVubmVyUHJvdmlkZXJbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9ydW5uZXJDb25maWcoKTogRGlzdHJpYnV0ZWRSdW5uZXJDb25maWcge1xuICAgIC8vIHJvbGwgdXAgdGhlIHdlaWdodHMgaGVyZSBzbyB0aGUgc3RhdGUgbWFjaGluZSBqdXN0IHBpY2tzIHRoZSBmaXJzdCBjb25maWcgd2hvc2UgdGhyZXNob2xkIGlzIGFib3ZlIGEgcmFuZG9tXG4gICAgLy8gbnVtYmVyIGluIFswLCB0b3RhbFdlaWdodCkuIGJvdGggc3VtcyBhZGQgdGhlIHdlaWdodHMgaW4gdGhlIHNhbWUgb3JkZXIsIHNvIHRoZSBsYXN0IHRocmVzaG9sZCBhbHdheXMgY29tZXNcbiAgICAvLyBvdXQgZXhhY3RseSBlcXVhbCB0byB0b3RhbFdlaWdodCBhbmQgdGhlcmUgaXMgYWx3YXlzIGEgbWF0Y2hcbiAgICBsZXQgcnVubmluZ1dlaWdodFN1bSA9IDA7XG4gICAgcmV0dXJuIHtcbiAgICAgIHRvdGFsV2VpZ2h0OiB0aGlzLndlaWdodGVkUHJvdmlkZXJzLnJlZHVjZSgoc3VtLCB3cCkgPT4gc3VtICsgd3Aud2VpZ2h0LCAwKSxcbiAgICAgIGRpc3RyaWJ1dGU6IHRoaXMud2VpZ2h0ZWRQcm92aWRlcnMubWFwKHdwID0+ICh7XG4gICAgICAgIHRocmVzaG9sZDogcnVubmluZ1dlaWdodFN1bSArPSB3cC53ZWlnaHQsXG4gICAgICAgIGNvbmZpZzogKHdwLnByb3ZpZGVyIGFzIHVua25vd24gYXMgSVBhcmFtZXRlcml6ZWRSdW5uZXJQcm92aWRlcikuX3J1bm5lckNvbmZpZygpLFxuICAgICAgfSkpLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lUm9sZTogaWFtLklHcmFudGFibGUpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIHRoaXMucGFyYW1ldGVyaXplZCkge1xuICAgICAgcHJvdmlkZXIuX2dyYW50U3RhdGVNYWNoaW5lKHN0YXRlTWFjaGluZVJvbGUpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9zdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1c1tdIHtcbiAgICByZXR1cm4gdGhpcy5wYXJhbWV0ZXJpemVkLmZsYXRNYXAocHJvdmlkZXIgPT4gcHJvdmlkZXIuX3N0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGUpKTtcbiAgfVxufVxuIl19