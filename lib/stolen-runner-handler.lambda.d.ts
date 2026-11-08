import * as AWSLambda from 'aws-lambda';
import { RunnerReportMessage } from './lambda-tracker';
/**
 * Limit the amount of times we try to replace a stolen runner. Mostly so we don't end up in a replacement loop.
 *
 * @internal
 */
export declare const MAX_REPLACEMENTS = 3;
/**
 * @internal
 */
export declare function replacementRunnerName(stolenRunnerName: string): [string, number];
/**
 * @internal
 */
export declare function parseRunnerReport(line: string): RunnerReportMessage | undefined;
export declare function handler(event: AWSLambda.SQSEvent | AWSLambda.CloudWatchLogsEvent): Promise<AWSLambda.SQSBatchResponse | void>;
