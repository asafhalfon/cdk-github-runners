import { aws_ec2 as ec2, aws_iam as iam, aws_lambda as lambda, aws_logs as logs } from 'aws-cdk-lib';
import { Construct } from 'constructs';
/**
 * Initialize or return a singleton Lambda function instance.
 *
 * @internal
 */
export declare function singletonLambda<FunctionType extends lambda.Function>(functionType: new (s: Construct, i: string, p?: lambda.FunctionOptions) => FunctionType, scope: Construct, id: string, props?: lambda.FunctionOptions): FunctionType;
/**
 * Central log group type.
 *
 * @internal
 */
export declare enum SingletonLogType {
    RUNNER_IMAGE_BUILD = "Runner Image Build Helpers Log",
    ORCHESTRATOR = "Orchestrator Log",
    SETUP = "Setup Log"
}
/**
 * Initialize or return central log group instance.
 *
 * @internal
 */
export declare function singletonLogGroup(scope: Construct, type: SingletonLogType): logs.ILogGroup;
/**
 * The absolute minimum permissions required for SSM Session Manager to work. Unlike `AmazonSSMManagedInstanceCore`, it doesn't give permission to read all SSM parameters.
 *
 * @internal
 */
export declare const MINIMAL_SSM_SESSION_MANAGER_POLICY_STATEMENT: iam.PolicyStatement;
/**
 * The absolute minimum permissions required for SSM Session Manager on ECS to work. Unlike `AmazonSSMManagedInstanceCore`, it doesn't give permission to read all SSM parameters.
 *
 * @internal
 */
export declare const MINIMAL_ECS_SSM_SESSION_MANAGER_POLICY_STATEMENT: iam.PolicyStatement;
/**
 * The absolute minimum permissions required for SSM Session Manager on EC2 to work. Unlike `AmazonSSMManagedInstanceCore`, it doesn't give permission to read all SSM parameters.
 *
 * @internal
 */
export declare const MINIMAL_EC2_SSM_SESSION_MANAGER_POLICY_STATEMENT: iam.PolicyStatement;
/**
 * Discovers certificate files from a given path (file or directory).
 *
 * If the path is a directory, finds all .pem and .crt files in it.
 * If the path is a file, returns it as a single certificate file.
 *
 * @param sourcePath path to a certificate file or directory containing certificate files
 * @returns array of certificate file paths, sorted alphabetically
 * @throws Error if path doesn't exist, is neither file nor directory, or directory has no certificate files
 *
 * @internal
 */
export declare function discoverCertificateFiles(sourcePath: string): string[];
/**
 * Returns true if the instance type has an NVIDIA GPU.
 *
 * Uses AWS naming convention: most NVIDIA GPU instances use 'g' (g4dn, g5, g6, g9...) or 'p' (p3, p4d, p5, p6...)
 * prefix followed by a digit. Explicitly excludes known non-NVIDIA GPU families such as g4ad (AMD).
 *
 * @internal
 */
export declare function isGpuInstanceType(instanceType: ec2.InstanceType): boolean;
