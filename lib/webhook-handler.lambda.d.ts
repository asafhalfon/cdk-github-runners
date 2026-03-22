import * as AWSLambda from 'aws-lambda';
import { ProviderSelectorResult } from './webhook';
/**
 * Exported for unit testing.
 * @internal
 */
export declare function verifyBody(event: AWSLambda.APIGatewayProxyEventV2, secret: any): string;
/**
 * Call the provider selector Lambda function if configured.
 * @internal
 */
export declare function callProviderSelector(payload: any, providers: Record<string, string[]>, defaultSelection: ProviderSelectorResult): Promise<ProviderSelectorResult | undefined>;
/**
 * Exported for unit testing.
 * @internal
 */
export declare function selectProvider(payload: any, jobLabels: string[], hook?: typeof callProviderSelector): Promise<ProviderSelectorResult>;
/**
 * Generate a unique execution name which is limited to 64 characters (also used as runner name).
 *
 * Exported for unit testing.
 *
 * @internal
 */
export declare function generateExecutionName(event: any, payload: any): string;
export declare function handler(event: AWSLambda.APIGatewayProxyEventV2): Promise<AWSLambda.APIGatewayProxyResultV2>;
