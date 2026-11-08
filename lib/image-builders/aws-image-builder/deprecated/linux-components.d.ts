import { Construct } from 'constructs';
import { Architecture, RunnerVersion } from '../../../providers';
import { ImageBuilderComponent } from '../index';
/**
 * Components for Ubuntu Linux that can be used with AWS Image Builder based builders. These cannot be used by {@link CodeBuildImageBuilder}.
 *
 * @deprecated Use `RunnerImageComponent` instead.
 */
export declare class LinuxUbuntuComponents {
    static requiredPackages(scope: Construct, id: string, architecture: Architecture): ImageBuilderComponent;
    static runnerUser(scope: Construct, id: string, _architecture: Architecture): ImageBuilderComponent;
    static awsCli(scope: Construct, id: string, architecture: Architecture): ImageBuilderComponent;
    static githubCli(scope: Construct, id: string, _architecture: Architecture): ImageBuilderComponent;
    static git(scope: Construct, id: string, _architecture: Architecture): ImageBuilderComponent;
    static githubRunner(scope: Construct, id: string, runnerVersion: RunnerVersion, architecture: Architecture): ImageBuilderComponent;
    static docker(scope: Construct, id: string, _architecture: Architecture): ImageBuilderComponent;
    static extraCertificates(scope: Construct, id: string, path: string): ImageBuilderComponent;
}
