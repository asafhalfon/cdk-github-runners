import { Construct } from 'constructs';
import { RunnerVersion } from '../../../providers';
import { ImageBuilderComponent } from '../builder';
/**
 * Components for Windows that can be used with AWS Image Builder based builders. These cannot be used by {@link CodeBuildImageBuilder}.
 *
 * @deprecated Use `RunnerImageComponent` instead.
 */
export declare class WindowsComponents {
    static cloudwatchAgent(scope: Construct, id: string): ImageBuilderComponent;
    static awsCli(scope: Construct, id: string): ImageBuilderComponent;
    static githubCli(scope: Construct, id: string): ImageBuilderComponent;
    static git(scope: Construct, id: string): ImageBuilderComponent;
    static githubRunner(scope: Construct, id: string, runnerVersion: RunnerVersion): ImageBuilderComponent;
    static docker(scope: Construct, id: string): ImageBuilderComponent;
    static extraCertificates(scope: Construct, id: string, path: string): ImageBuilderComponent;
}
