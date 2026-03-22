import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Os } from '../../providers/common';
/**
 * Properties for Workflow construct.
 *
 * @internal
 */
export interface WorkflowProperties {
    /**
     * Workflow type.
     */
    readonly type: 'BUILD' | 'TEST' | 'DISTRIBUTION';
    /**
     * YAML or JSON data for the workflow.
     */
    readonly data: any;
}
/**
 * Image builder workflow.
 *
 * @internal
 */
export declare class Workflow extends cdk.Resource {
    readonly arn: string;
    readonly name: string;
    constructor(scope: Construct, id: string, props: WorkflowProperties);
}
/**
 * Returns a new build workflow based on arn:aws:imagebuilder:us-east-1:aws:workflow/build/build-container/1.0.1/1.
 *
 * It adds a DockerSetup step after bootstrapping but before the Docker image is built.
 *
 * @internal
 */
export declare function generateBuildWorkflowWithDockerSetupCommands(scope: Construct, id: string, os: Os, dockerSetupCommands: string[]): Workflow;
