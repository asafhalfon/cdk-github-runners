import { Construct } from 'constructs';
import { ICompositeProvider, IRunnerProvider } from './common';
/**
 * Configuration for weighted distribution of runners.
 */
export interface WeightedRunnerProvider {
    /**
     * The runner provider to use.
     */
    readonly provider: IRunnerProvider;
    /**
     * Weight for this provider. Higher weights mean higher probability of selection.
     * Must be a positive number.
     */
    readonly weight: number;
}
/**
 * A composite runner provider that implements fallback and distribution strategies.
 */
export declare class CompositeProvider {
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
    static fallback(scope: Construct, id: string, providers: IRunnerProvider[]): ICompositeProvider;
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
    static distribute(scope: Construct, id: string, weightedProviders: WeightedRunnerProvider[]): ICompositeProvider;
    /**
     * Validates that all providers have the exact same labels.
     * This is required so that any provisioned runner can match the labels requested by the GitHub workflow job.
     *
     * @param providers Providers to validate
     */
    private static validateLabels;
}
