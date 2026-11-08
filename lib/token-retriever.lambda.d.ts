import { StepFunctionLambdaInput } from './lambda-helpers';
/**
 * @internal
 */
export interface TokenRetrieverInput extends StepFunctionLambdaInput {
    /** runner group of the config the orchestrator selected, empty when it has none */
    readonly group: string;
    /** comma separated labels the runner registers with. DEPRECATED: make required in 1.0.0, older executions don't send it */
    readonly labels?: string;
    /** labels config.sh used to add on its own, empty when the provider turned them off. see runnerDefaultLabels() */
    readonly defaultLabels?: string[];
}
export declare function handler(event: TokenRetrieverInput): Promise<{
    domain: string;
    jitConfig: string;
    token?: undefined;
    registrationUrl?: undefined;
} | {
    domain: string;
    token: string;
    registrationUrl: string;
    jitConfig?: undefined;
}>;
