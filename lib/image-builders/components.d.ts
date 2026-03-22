import { Construct } from 'constructs';
import { ImageBuilderComponent } from './aws-image-builder';
import { RunnerImageAsset } from './common';
import { Architecture, Os, RunnerVersion } from '../providers';
export interface RunnerImageComponentCustomProps {
    /**
     * Component name used for (1) image build logging and (2) identifier for {@link IConfigurableRunnerImageBuilder.removeComponent}.
     *
     * Name must only contain alphanumeric characters and dashes.
     */
    readonly name?: string;
    /**
     * Commands to run in the built image.
     */
    readonly commands?: string[];
    /**
     * Assets to copy into the built image.
     */
    readonly assets?: RunnerImageAsset[];
    /**
     * Docker commands to run in the built image.
     *
     * For example: `['ENV foo=bar', 'RUN echo $foo']`
     *
     * These commands are ignored when building AMIs.
     */
    readonly dockerCommands?: string[];
}
/**
 * Components are used to build runner images. They can run commands in the image, copy files into the image, and run some Docker commands.
 */
export declare abstract class RunnerImageComponent {
    /**
     * Define a custom component that can run commands in the image, copy files into the image, and run some Docker commands.
     *
     * The order of operations is (1) assets (2) commands (3) docker commands.
     *
     * Use this to customize the image for the runner.
     *
     * **WARNING:** Docker commands are not guaranteed to be included before the next component
     */
    static custom(props: RunnerImageComponentCustomProps): RunnerImageComponent;
    /**
     * A component to install the required packages for the runner.
     */
    static requiredPackages(): RunnerImageComponent;
    /**
     * A component to install CloudWatch Agent for the runner so we can send logs.
     */
    static cloudWatchAgent(): RunnerImageComponent;
    /**
     * A component to prepare the required runner user.
     */
    static runnerUser(): RunnerImageComponent;
    /**
     * A component to install the AWS CLI.
     *
     * @param version Software version to install (e.g. '2.15.0'). Default: latest.
     */
    static awsCli(version?: string): RunnerImageComponent;
    /**
     * A component to install the GitHub CLI.
     *
     * @param version Software version to install (e.g. '2.40.0'). Default: latest. Only used on Windows (x64/windows_amd64); on Linux the package manager is used.
     */
    static githubCli(version?: string): RunnerImageComponent;
    /**
     * A component to install Git.
     *
     * @param version Software version to install (e.g. '2.43.0.windows.1'). Default: latest. Only used on Windows; on Linux the package manager is used.
     */
    static git(version?: string): RunnerImageComponent;
    /**
     * A component to install the GitHub Actions Runner. This is the actual executable that connects to GitHub to ask for jobs and then execute them.
     *
     * @param runnerVersion The version of the runner to install. Usually you would set this to latest.
     */
    static githubRunner(runnerVersion: RunnerVersion): RunnerImageComponent;
    /**
     * A component to install Docker.
     *
     * On Windows this sets up dockerd for Windows containers without Docker Desktop. If you need Linux containers on Windows, you'll need to install Docker Desktop which doesn't seem to play well with servers (PRs welcome).
     *
     * @param version Software version to install (e.g. '29.1.5'). Default: latest. Only used on Windows; on Linux (Ubuntu, Amazon Linux 2 and Amazon Linux 2023) the package version format is not reliably predictable so latest is always used.
     */
    static docker(version?: string): RunnerImageComponent;
    /**
     * A component to install Docker-in-Docker.
     *
     * @deprecated use `docker()`
     * @param version Software version to install (e.g. '29.1.5'). Default: latest.
     */
    static dockerInDocker(version?: string): RunnerImageComponent;
    /**
     * A component to add a trusted certificate authority. This can be used to support GitHub Enterprise Server with self-signed certificate.
     *
     * @param source path to certificate file in PEM format, or a directory containing certificate files (.pem or .crt)
     * @param name unique certificate name to be used on runner file system
     */
    static extraCertificates(source: string, name: string): RunnerImageComponent;
    /**
     * A component to set up the required Lambda entrypoint for Lambda runners.
     */
    static lambdaEntrypoint(): RunnerImageComponent;
    /**
     * A component to add environment variables for jobs the runner executes.
     *
     * These variables only affect the jobs ran by the runner. They are not global. They do not affect other components.
     *
     * It is not recommended to use this component to pass secrets. Instead, use GitHub Secrets or AWS Secrets Manager.
     *
     * Must be used after the {@link githubRunner} component.
     */
    static environmentVariables(vars: Record<string, string>): RunnerImageComponent;
    /**
     * Component name.
     *
     * Used to identify component in image build logs, and for {@link IConfigurableRunnerImageBuilder.removeComponent}
     */
    abstract readonly name: string;
    /**
     * Returns commands to run to in built image. Can be used to install packages, setup build prerequisites, etc.
     */
    abstract getCommands(_os: Os, _architecture: Architecture): string[];
    /**
     * Returns assets to copy into the built image. Can be used to copy files into the image.
     */
    getAssets(_os: Os, _architecture: Architecture): RunnerImageAsset[];
    /**
     * Returns Docker commands to run to in built image. Can be used to add commands like `VOLUME`, `ENTRYPOINT`, `CMD`, etc.
     *
     * Docker commands are added after assets and normal commands.
     */
    getDockerCommands(_os: Os, _architecture: Architecture): string[];
    /**
     * Returns true if the image builder should be rebooted after this component is installed.
     */
    shouldReboot(_os: Os, _architecture: Architecture): boolean;
    /**
     * Convert component to an AWS Image Builder component.
     *
     * Components are cached and reused when the same component is requested with the same
     * OS and architecture, reducing stack template size and number of resources.
     *
     * @internal
     */
    _asAwsImageBuilderComponent(scope: Construct, os: Os, architecture: Architecture): ImageBuilderComponent;
    /**
     * Generate a cache key for component reuse.
     * Components with the same name, OS, architecture, commands, assets, and reboot flag will share the same key.
     * Returns a hash of all component properties to ensure uniqueness.
     *
     * @internal
     */
    private _getCacheKey;
}
