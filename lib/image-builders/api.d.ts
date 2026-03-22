import { Construct } from 'constructs';
import { IConfigurableRunnerImageBuilder, RunnerImageBuilderBase, RunnerImageBuilderProps } from './common';
/**
 * GitHub Runner image builder. Builds a Docker image or AMI with GitHub Runner and other requirements installed.
 *
 * Images can be customized before passed into the provider by adding or removing components to be installed.
 *
 * Images are rebuilt every week by default to ensure that the latest security patches are applied.
 */
export declare abstract class RunnerImageBuilder extends RunnerImageBuilderBase {
    /**
     * Create a new image builder based on the provided properties. The implementation will differ based on the OS, architecture, and requested builder type.
     */
    static new(scope: Construct, id: string, props?: RunnerImageBuilderProps): IConfigurableRunnerImageBuilder;
}
