import { aws_secretsmanager as secretsmanager } from 'aws-cdk-lib';
import { Construct } from 'constructs';
/**
 * Secrets required for GitHub runners operation.
 */
export declare class Secrets extends Construct {
    /**
     * Webhook secret used to confirm events are coming from GitHub and nowhere else.
     */
    readonly webhook: secretsmanager.Secret;
    /**
     * Authentication secret for GitHub containing either app details or personal access token. This secret is used to register runners and
     * cancel jobs when the runner fails to start.
     *
     * This secret is meant to be edited by the user after being created.
     */
    readonly github: secretsmanager.Secret;
    /**
     * GitHub app private key. Not needed when using personal access tokens.
     *
     * This secret is meant to be edited by the user after being created. It is separate than the main GitHub secret because inserting private keys into JSON is hard.
     */
    readonly githubPrivateKey: secretsmanager.Secret;
    /**
     * Setup secret used to authenticate user for our setup wizard. Should be empty after setup has been completed.
     */
    readonly setup: secretsmanager.Secret;
    constructor(scope: Construct, id: string);
}
