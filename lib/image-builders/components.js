"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerImageComponent = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const crypto = __importStar(require("crypto"));
const path = __importStar(require("path"));
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const utils_1 = require("../utils");
const aws_image_builder_1 = require("./aws-image-builder");
const providers_1 = require("../providers");
/**
 * Validates and normalizes a version string for use in download URLs.
 * Returns undefined if version is empty or "latest" (caller should use latest).
 * Throws if version contains any character other than alphanumeric, dots, dashes, or underscores.
 */
function validateVersion(version) {
    if (version === undefined || version === null)
        return undefined;
    const trimmed = version.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'latest')
        return undefined;
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
        throw new Error(`Invalid version "${version}": only alphanumeric characters, dots, dashes, and underscores are allowed.`);
    }
    return trimmed;
}
/**
 * Git for Windows version format: "2.43.0.windows.1" → "2.43.0" (revision 1 omitted),
 * "2.43.0.windows.2" → "2.43.0.2" (revision 2+ appended). Versions without ".windows." are returned as-is.
 */
function formatGitForWindowsVersion(version) {
    if (!version.includes('.windows.'))
        return version;
    const parts = version.split('.windows.');
    if (parts.length !== 2 || !parts[1])
        return version;
    const base = parts[0];
    const revision = parseInt(parts[1], 10);
    if (isNaN(revision))
        return version;
    return revision > 1 ? `${base}.${revision}` : base;
}
/**
 * Components are used to build runner images. They can run commands in the image, copy files into the image, and run some Docker commands.
 */
class RunnerImageComponent {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.RunnerImageComponent", version: "0.0.0" };
    /**
     * Define a custom component that can run commands in the image, copy files into the image, and run some Docker commands.
     *
     * The order of operations is (1) assets (2) commands (3) docker commands.
     *
     * Use this to customize the image for the runner.
     *
     * **WARNING:** Docker commands are not guaranteed to be included before the next component
     */
    static custom(props) {
        return new class extends RunnerImageComponent {
            get name() {
                if (props.name && !props.name.match(/[a-zA-Z0-9\-]/)) {
                    throw new Error(`Invalid component name: ${props.name}. Name must only contain alphanumeric characters and dashes.`);
                }
                return `Custom-${props.name ?? 'Undefined'}`;
            }
            getCommands(_os, _architecture) {
                return props.commands ?? [];
            }
            getAssets(_os, _architecture) {
                return props.assets ?? [];
            }
            getDockerCommands(_os, _architecture) {
                return props.dockerCommands ?? [];
            }
        }();
    }
    /**
     * A component to install the required packages for the runner.
     */
    static requiredPackages() {
        return new class extends RunnerImageComponent {
            name = 'RequiredPackages';
            getCommands(os, _architecture) {
                // libatomic is needed by Node.js 26 and the runner doesn't install it (actions/runner#4591)
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    return [
                        'apt-get -o Acquire::Retries=5 update',
                        'DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 upgrade -y',
                        'DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 install -y curl sudo jq bash zip unzip iptables software-properties-common ca-certificates libatomic1',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
                    return [
                        'yum update -y',
                        'yum install -y jq tar gzip bzip2 which binutils zip unzip sudo shadow-utils libatomic',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
                    return [
                        'dnf upgrade -y',
                        'dnf install -y jq tar gzip bzip2 which binutils zip unzip sudo shadow-utils findutils libatomic',
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    return [];
                }
                throw new Error(`Unsupported OS for required packages: ${os.name}`);
            }
        };
    }
    /**
     * A component to install CloudWatch Agent for the runner so we can send logs.
     */
    static cloudWatchAgent() {
        return new class extends RunnerImageComponent {
            name = 'CloudWatchAgent';
            getCommands(os, architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    let archUrl;
                    if (architecture.is(providers_1.Architecture.X86_64)) {
                        archUrl = 'amd64';
                    }
                    else if (architecture.is(providers_1.Architecture.ARM64)) {
                        archUrl = 'arm64';
                    }
                    else {
                        throw new Error(`Unsupported architecture for required packages: ${architecture.name}`);
                    }
                    return [
                        `curl --retry 5 --retry-delay 30 --retry-all-errors -sfLo /tmp/amazon-cloudwatch-agent.deb https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/${archUrl}/latest/amazon-cloudwatch-agent.deb`,
                        'dpkg -i -E /tmp/amazon-cloudwatch-agent.deb',
                        'rm /tmp/amazon-cloudwatch-agent.deb',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
                    return [
                        'yum install -y amazon-cloudwatch-agent',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
                    return [
                        'dnf install -y amazon-cloudwatch-agent',
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    return [
                        '$p = Start-Process msiexec.exe -PassThru -Wait -ArgumentList \'/i https://s3.amazonaws.com/amazoncloudwatch-agent/windows/amd64/latest/amazon-cloudwatch-agent.msi /qn\'',
                        'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
                    ];
                }
                throw new Error(`Unsupported OS for required packages: ${os.name}`);
            }
        };
    }
    /**
     * A component to prepare the required runner user.
     */
    static runnerUser() {
        return new class extends RunnerImageComponent {
            name = 'RunnerUser';
            getCommands(os, _architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    return [
                        'addgroup runner',
                        'adduser --system --disabled-password --home /home/runner --ingroup runner runner',
                        'echo "%runner   ALL=(ALL:ALL) NOPASSWD: ALL" > /etc/sudoers.d/runner',
                    ];
                }
                else if (os.isIn(providers_1.Os._ALL_LINUX_AMAZON_VERSIONS)) {
                    return [
                        '/usr/sbin/groupadd runner',
                        '/usr/sbin/useradd --system --shell /usr/sbin/nologin --home-dir /home/runner --gid runner runner',
                        'mkdir -p /home/runner',
                        'chown runner /home/runner',
                        'echo "%runner   ALL=(ALL:ALL) NOPASSWD: ALL" > /etc/sudoers.d/runner',
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    return [];
                }
                throw new Error(`Unsupported OS for runner user: ${os.name}`);
            }
        };
    }
    /**
     * A component to install the AWS CLI.
     *
     * @param version Software version to install (e.g. '2.15.0'). Default: latest.
     */
    static awsCli(version) {
        const useVersion = validateVersion(version);
        return new class extends RunnerImageComponent {
            name = 'AwsCli';
            getCommands(os, architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS) || os.isIn(providers_1.Os._ALL_LINUX_AMAZON_VERSIONS)) {
                    let archUrl;
                    if (architecture.is(providers_1.Architecture.X86_64)) {
                        archUrl = 'x86_64';
                    }
                    else if (architecture.is(providers_1.Architecture.ARM64)) {
                        archUrl = 'aarch64';
                    }
                    else {
                        throw new Error(`Unsupported architecture for awscli: ${architecture.name}`);
                    }
                    const zipName = useVersion
                        ? `awscli-exe-linux-${archUrl}-${useVersion}.zip`
                        : `awscli-exe-linux-${archUrl}.zip`;
                    return [
                        `curl --retry 5 --retry-delay 30 --retry-all-errors -fsSL "https://awscli.amazonaws.com/${zipName}" -o awscliv2.zip`,
                        'unzip -q awscliv2.zip',
                        './aws/install --update',
                        'rm -rf awscliv2.zip aws',
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    const msiUrl = useVersion
                        ? `https://awscli.amazonaws.com/AWSCLIV2-${useVersion}.msi`
                        : 'https://awscli.amazonaws.com/AWSCLIV2.msi';
                    return [
                        `$p = Start-Process msiexec.exe -PassThru -Wait -ArgumentList '/i ${msiUrl} /qn'`,
                        'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
                    ];
                }
                throw new Error(`Unknown os/architecture combo for awscli: ${os.name}/${architecture.name}`);
            }
        }();
    }
    /**
     * A component to install the GitHub CLI.
     *
     * @param version Software version to install (e.g. '2.40.0'). Default: latest. Only used on Windows (x64/windows_amd64); on Linux the package manager is used.
     */
    static githubCli(version) {
        const useVersion = validateVersion(version);
        return new class extends RunnerImageComponent {
            name = 'GithubCli';
            getCommands(os, architecture) {
                if (useVersion && !os.is(providers_1.Os.WINDOWS)) {
                    throw new Error('RunnerImageComponent.githubCli(version): version is only used on Windows. On Linux the package manager (apt/yum/dnf) is used. Omit the version for Linux images.');
                }
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    return [
                        'curl --retry 5 --retry-delay 30 --retry-all-errors -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
                        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] ' +
                            '  https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
                        'apt-get -o Acquire::Retries=5 update',
                        'DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 install -y gh',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
                    return [
                        'curl --retry 5 --retry-delay 30 --retry-all-errors -fsSSL https://cli.github.com/packages/rpm/gh-cli.repo -o /etc/yum.repos.d/gh-cli.repo',
                        'yum install -y gh',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
                    return [
                        'curl --retry 5 --retry-delay 30 --retry-all-errors -fsSSL https://cli.github.com/packages/rpm/gh-cli.repo -o /etc/yum.repos.d/gh-cli.repo',
                        'dnf install -y gh',
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    if (useVersion) {
                        return [
                            `Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/cli/cli/releases/download/v${useVersion}/gh_${useVersion}_windows_amd64.msi" -OutFile gh.msi`,
                            '$p = Start-Process msiexec.exe -PassThru -Wait -ArgumentList \'/i gh.msi /qn\'',
                            'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
                            'del gh.msi',
                        ];
                    }
                    return [
                        'cmd /c curl --retry 5 --retry-delay 30 -fsSL -o NUL -w "%{url_effective}" https://github.com/cli/cli/releases/latest > $Env:TEMP\\latest-gh',
                        '$LatestUrl = Get-Content $Env:TEMP\\latest-gh',
                        '$GH_VERSION = ($LatestUrl -Split \'/\')[-1].substring(1)',
                        'Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_windows_amd64.msi" -OutFile gh.msi',
                        '$p = Start-Process msiexec.exe -PassThru -Wait -ArgumentList \'/i gh.msi /qn\'',
                        'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
                        'del gh.msi',
                    ];
                }
                throw new Error(`Unknown os/architecture combo for github cli: ${os.name}/${architecture.name}`);
            }
        }();
    }
    /**
     * A component to install Git.
     *
     * @param version Software version to install (e.g. '2.43.0.windows.1'). Default: latest. Only used on Windows; on Linux the package manager is used.
     */
    static git(version) {
        const useVersion = validateVersion(version);
        return new class extends RunnerImageComponent {
            name = 'Git';
            getCommands(os, architecture) {
                if (useVersion && !os.is(providers_1.Os.WINDOWS)) {
                    throw new Error('RunnerImageComponent.git(version): version is only used on Windows. On Linux the package manager (apt/yum/dnf) is used. Omit the version for Linux images.');
                }
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    return [
                        'add-apt-repository ppa:git-core/ppa',
                        'apt-get -o Acquire::Retries=5 update',
                        'DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 install -y git',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
                    return [
                        'yum install -y git',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
                    return [
                        'dnf install -y git',
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    if (useVersion) {
                        const versionShort = formatGitForWindowsVersion(useVersion);
                        return [
                            `Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/git-for-windows/git/releases/download/v${useVersion}/Git-${versionShort}-64-bit.exe" -OutFile git-setup.exe`,
                            '$p = Start-Process git-setup.exe -PassThru -Wait -ArgumentList \'/VERYSILENT\'',
                            'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
                            'del git-setup.exe',
                        ];
                    }
                    return [
                        'cmd /c curl --retry 5 --retry-delay 30 -fsSL -o NUL -w "%{url_effective}" https://github.com/git-for-windows/git/releases/latest > $Env:TEMP\\latest-git',
                        '$LatestUrl = Get-Content $Env:TEMP\\latest-git',
                        '$GIT_VERSION = ($LatestUrl -Split \'/\')[-1].substring(1)',
                        '$GIT_VERSION_SHORT = ($GIT_VERSION -Split \'.windows.\')[0]',
                        '$GIT_REVISION = ($GIT_VERSION -Split \'.windows.\')[1]',
                        'If ($GIT_REVISION -gt 1) {$GIT_VERSION_SHORT = "$GIT_VERSION_SHORT.$GIT_REVISION"}',
                        'Invoke-WebRequest -UseBasicParsing -Uri https://github.com/git-for-windows/git/releases/download/v${GIT_VERSION}/Git-${GIT_VERSION_SHORT}-64-bit.exe -OutFile git-setup.exe',
                        '$p = Start-Process git-setup.exe -PassThru -Wait -ArgumentList \'/VERYSILENT\'',
                        'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
                        'del git-setup.exe',
                    ];
                }
                throw new Error(`Unknown os/architecture combo for git: ${os.name}/${architecture.name}`);
            }
        }();
    }
    /**
     * A component to install the GitHub Actions Runner. This is the actual executable that connects to GitHub to ask for jobs and then execute them.
     *
     * @param runnerVersion The version of the runner to install. Usually you would set this to latest.
     */
    static githubRunner(runnerVersion) {
        return new class extends RunnerImageComponent {
            name = 'GithubRunner';
            getAssets(os, _architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
                    return [
                        {
                            source: path.join(__dirname, '..', '..', 'assets', 'providers', 'job-reporter.sh'),
                            target: '/home/runner/job-reporter.sh',
                        },
                        {
                            source: path.join(__dirname, '..', '..', 'assets', 'providers', 'job-started-hook.sh'),
                            target: '/home/runner/job-started-hook.sh',
                        },
                        {
                            source: path.join(__dirname, '..', '..', 'assets', 'providers', 'job-completed-hook.sh'),
                            target: '/home/runner/job-completed-hook.sh',
                        },
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    return [
                        {
                            source: path.join(__dirname, '..', '..', 'assets', 'providers', 'job-reporter.ps1'),
                            target: '/actions/job-reporter.ps1',
                        },
                        {
                            source: path.join(__dirname, '..', '..', 'assets', 'providers', 'job-started-hook.ps1'),
                            target: '/actions/job-started-hook.ps1',
                        },
                        {
                            source: path.join(__dirname, '..', '..', 'assets', 'providers', 'job-completed-hook.ps1'),
                            target: '/actions/job-completed-hook.ps1',
                        },
                    ];
                }
                return [];
            }
            getCommands(os, architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS) || os.isIn(providers_1.Os._ALL_LINUX_AMAZON_VERSIONS)) {
                    let versionCommand;
                    if (runnerVersion.is(providers_1.RunnerVersion.latest())) {
                        versionCommand = 'RUNNER_VERSION=`curl --retry 5 --retry-delay 30 --retry-all-errors -fsSL -o /dev/null -w "%{url_effective}" https://github.com/actions/runner/releases/latest | grep -oE "[^/v]+$"`';
                    }
                    else {
                        versionCommand = `RUNNER_VERSION='${runnerVersion.version}'`;
                    }
                    let archUrl;
                    if (architecture.is(providers_1.Architecture.X86_64)) {
                        archUrl = 'x64';
                    }
                    else if (architecture.is(providers_1.Architecture.ARM64)) {
                        archUrl = 'arm64';
                    }
                    else {
                        throw new Error(`Unsupported architecture for GitHub Runner: ${architecture.name}`);
                    }
                    let commands = [
                        versionCommand,
                        `curl --retry 5 --retry-delay 30 --retry-all-errors -fsSLO "https://github.com/actions/runner/releases/download/v\${RUNNER_VERSION}/actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz"`,
                        `tar -C /home/runner -xzf "actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz"`,
                        `rm actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz`,
                        `echo -n ${runnerVersion.version} > /home/runner/RUNNER_VERSION`,
                        'chmod +x /home/runner/job-reporter.sh',
                        'chmod +x /home/runner/job-started-hook.sh',
                        'chmod +x /home/runner/job-completed-hook.sh',
                        'echo ACTIONS_RUNNER_HOOK_JOB_STARTED=/home/runner/job-started-hook.sh >> /home/runner/.env',
                        'echo ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/home/runner/job-completed-hook.sh >> /home/runner/.env',
                        'chown runner /home/runner/.env', // env.sh modifies .env
                        'touch /home/runner/.workflowid && chown runner /home/runner/.workflowid',
                    ];
                    if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                        commands.push('/home/runner/bin/installdependencies.sh');
                    }
                    else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
                        commands.push('yum install -y openssl-libs krb5-libs zlib libicu60');
                    }
                    else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
                        commands.push('dnf install -y openssl-libs krb5-libs zlib libicu-67.1');
                    }
                    commands.push('mkdir -p /opt/hostedtoolcache', 'chown runner /opt/hostedtoolcache');
                    return commands;
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    let runnerCommands;
                    if (runnerVersion.is(providers_1.RunnerVersion.latest())) {
                        runnerCommands = [
                            'cmd /c curl --retry 5 --retry-delay 30 -fsSL -o NUL -w "%{url_effective}" https://github.com/actions/runner/releases/latest > $Env:TEMP\\latest-gha',
                            '$LatestUrl = Get-Content $Env:TEMP\\latest-gha',
                            '$RUNNER_VERSION = ($LatestUrl -Split \'/\')[-1].substring(1)',
                        ];
                    }
                    else {
                        runnerCommands = [`$RUNNER_VERSION = '${runnerVersion.version}'`];
                    }
                    runnerCommands = runnerCommands.concat([
                        // create directories
                        'mkdir C:\\hostedtoolcache\\windows',
                        'mkdir C:\\tools',
                        // download zstd and extract to C:\tools
                        'cmd /c curl --retry 5 --retry-delay 30 -fsSL -o NUL -w "%{url_effective}" https://github.com/meta/zstd/releases/latest > $Env:TEMP\\latest-zstd',
                        '$LatestUrl = Get-Content $Env:TEMP\\latest-zstd',
                        '$ZSTD_VERSION = ($LatestUrl -Split \'/\')[-1].substring(1)',
                        'Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/meta/zstd/releases/download/v$ZSTD_VERSION/zstd-v$ZSTD_VERSION-win64.zip" -OutFile zstd.zip',
                        'Expand-Archive zstd.zip -DestinationPath C:\\tools',
                        'Move-Item -Path C:\\tools\\zstd-v$ZSTD_VERSION-win64\\zstd.exe C:\\tools',
                        'Remove-Item -LiteralPath "C:\\tools\\zstd-v$ZSTD_VERSION-win64" -Force -Recurse',
                        'del zstd.zip',
                        // add C:\tools to PATH
                        '$persistedPaths = [Environment]::GetEnvironmentVariable(\'Path\', [EnvironmentVariableTarget]::Machine)',
                        '[Environment]::SetEnvironmentVariable("PATH", $persistedPaths + ";C:\\tools", [EnvironmentVariableTarget]::Machine)',
                        // setup hooks
                        "Add-Content -Path C:\\actions\\.env -Value 'ACTIONS_RUNNER_HOOK_JOB_STARTED=C:\\actions\\job-started-hook.ps1'",
                        "Add-Content -Path C:\\actions\\.env -Value 'ACTIONS_RUNNER_HOOK_JOB_COMPLETED=C:\\actions\\job-completed-hook.ps1'",
                        "Set-Content -Path C:\\actions\\.workflowid -Value '' -NoNewline",
                    ]);
                    return runnerCommands.concat([
                        'Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-win-x64-${RUNNER_VERSION}.zip" -OutFile actions.zip',
                        'Expand-Archive actions.zip -DestinationPath C:\\actions',
                        'del actions.zip',
                        `echo ${runnerVersion.version} | Out-File -Encoding ASCII -NoNewline C:\\actions\\RUNNER_VERSION`,
                    ]);
                }
                throw new Error(`Unknown os/architecture combo for github runner: ${os.name}/${architecture.name}`);
            }
            getDockerCommands(_os, _architecture) {
                return [
                    `ENV RUNNER_VERSION=${runnerVersion.version}`,
                ];
            }
        }();
    }
    /**
     * A component to install Docker.
     *
     * On Windows this sets up dockerd for Windows containers without Docker Desktop. If you need Linux containers on Windows, you'll need to install Docker Desktop which doesn't seem to play well with servers (PRs welcome).
     *
     * @param version Software version to install (e.g. '29.1.5'). Default: latest. Only used on Windows; on Linux (Ubuntu, Amazon Linux 2 and Amazon Linux 2023) the package version format is not reliably predictable so latest is always used.
     */
    static docker(version) {
        const useVersion = validateVersion(version);
        return new class extends RunnerImageComponent {
            name = 'Docker';
            getCommands(os, architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    if (useVersion) {
                        throw new Error('RunnerImageComponent.docker(version): version is only used on Windows. On Ubuntu the apt package version format is not reliably predictable; use latest (omit version) for Ubuntu images.');
                    }
                    return [
                        'curl --retry 5 --retry-delay 30 --retry-all-errors -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg',
                        'echo ' +
                            '  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ' +
                            '  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
                        'apt-get -o Acquire::Retries=5 update',
                        'DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin',
                        'usermod -aG docker runner',
                        'ln -s /usr/libexec/docker/cli-plugins/docker-compose /usr/bin/docker-compose',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
                    if (useVersion) {
                        throw new Error('RunnerImageComponent.docker(version): version is only used on Windows. On Amazon Linux the package version is not predictable; use latest (omit version) for Amazon Linux images.');
                    }
                    return [
                        'amazon-linux-extras install docker',
                        'usermod -a -G docker runner',
                        'curl --retry 5 --retry-delay 30 --retry-all-errors -sfLo /usr/bin/docker-compose https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s | tr \'[:upper:]\' \'[:lower:]\')-$(uname -m)',
                        'chmod +x /usr/bin/docker-compose',
                        'ln -s /usr/bin/docker-compose /usr/libexec/docker/cli-plugins/docker-compose',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
                    if (useVersion) {
                        throw new Error('RunnerImageComponent.docker(version): version is only used on Windows. On Amazon Linux the package version is not predictable; use latest (omit version) for Amazon Linux images.');
                    }
                    return [
                        'dnf install -y docker',
                        'usermod -a -G docker runner',
                        'curl --retry 5 --retry-delay 30 --retry-all-errors -sfLo /usr/bin/docker-compose https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s | tr \'[:upper:]\' \'[:lower:]\')-$(uname -m)',
                        'chmod +x /usr/bin/docker-compose',
                        'ln -s /usr/bin/docker-compose /usr/libexec/docker/cli-plugins/docker-compose',
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    const downloadCommands = useVersion ? [
                        `Invoke-WebRequest -UseBasicParsing -Uri "https://download.docker.com/win/static/stable/x86_64/docker-${useVersion}.zip" -OutFile docker.zip`,
                    ] : [
                        '$BaseUrl = "https://download.docker.com/win/static/stable/x86_64/"',
                        '$html = Invoke-WebRequest -UseBasicParsing -Uri $BaseUrl',
                        '$files = $html.Links.href | Where-Object { $_ -match \'^docker-[0-9\\.]+\\.zip$\' }',
                        'if (-not $files) { Write-Error "No docker-*.zip files found." ; exit 1 }',
                        '$latest = $files | Sort-Object { try { [Version]($_ -replace \'^docker-|\\.zip$\') } catch { [Version]"0.0.0" } } -Descending | Select-Object -First 1',
                        'Invoke-WebRequest -UseBasicParsing -Uri $BaseUrl$latest -OutFile docker.zip',
                    ];
                    return [
                        // download static binaries
                        ...downloadCommands,
                        // extract to C:\Program Files\Docker
                        'Expand-Archive docker.zip -DestinationPath "$Env:ProgramFiles"',
                        'del docker.zip',
                        // add to path
                        '$persistedPaths = [Environment]::GetEnvironmentVariable(\'Path\', [EnvironmentVariableTarget]::Machine)',
                        '[Environment]::SetEnvironmentVariable("PATH", $persistedPaths + ";$Env:ProgramFiles\\Docker", [EnvironmentVariableTarget]::Machine)',
                        '$env:PATH = $env:PATH + ";$Env:ProgramFiles\\Docker"',
                        // register docker service
                        'dockerd --register-service',
                        'if ($LASTEXITCODE -ne 0) { throw "Exit code is $LASTEXITCODE" }',
                        // enable containers feature
                        'Enable-WindowsOptionalFeature -Online -FeatureName containers -All -NoRestart',
                        // install docker-compose
                        'cmd /c curl --retry 5 --retry-delay 30 -fsSL -o NUL -w "%{url_effective}" https://github.com/docker/compose/releases/latest > $Env:TEMP\\latest-docker-compose',
                        '$LatestUrl = Get-Content $Env:TEMP\\latest-docker-compose',
                        '$LatestDockerCompose = ($LatestUrl -Split \'/\')[-1]',
                        'Invoke-WebRequest -UseBasicParsing -Uri  "https://github.com/docker/compose/releases/download/${LatestDockerCompose}/docker-compose-Windows-x86_64.exe" -OutFile $Env:ProgramFiles\\Docker\\docker-compose.exe',
                        'New-Item -ItemType directory -Path "$Env:ProgramFiles\\Docker\\cli-plugins"',
                        'Copy-Item -Path "$Env:ProgramFiles\\Docker\\docker-compose.exe" -Destination "$Env:ProgramFiles\\Docker\\cli-plugins\\docker-compose.exe"',
                    ];
                }
                throw new Error(`Unknown os/architecture combo for docker: ${os.name}/${architecture.name}`);
            }
            shouldReboot(os, _architecture) {
                return os.is(providers_1.Os.WINDOWS);
            }
        }();
    }
    /**
     * A component to install Docker-in-Docker.
     *
     * @deprecated use `docker()`
     * @param version Software version to install (e.g. '29.1.5'). Default: latest.
     */
    static dockerInDocker(version) {
        return RunnerImageComponent.docker(version);
    }
    /**
     * A component to add a trusted certificate authority. This can be used to support GitHub Enterprise Server with self-signed certificate.
     *
     * @param source path to certificate file in PEM format, or a directory containing certificate files (.pem or .crt)
     * @param name unique certificate name to be used on runner file system
     */
    static extraCertificates(source, name) {
        // Sanitize the name to only contain alphanumeric characters, dashes and underscores
        const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '-');
        // Discover certificate files (supports both file and directory)
        const certificateFiles = (0, utils_1.discoverCertificateFiles)(source);
        return new class extends RunnerImageComponent {
            name = `Extra-Certificates-${sanitizedName}`;
            getCommands(os, architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    return [
                        'update-ca-certificates',
                    ];
                }
                else if (os.isIn(providers_1.Os._ALL_LINUX_AMAZON_VERSIONS)) {
                    return [
                        'update-ca-trust',
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    const commands = [];
                    for (let i = 0; i < certificateFiles.length; i++) {
                        const certName = `${sanitizedName}-${i}`;
                        commands.push(`Import-Certificate -FilePath C:\\${certName}.crt -CertStoreLocation Cert:\\LocalMachine\\Root`, `Remove-Item C:\\${certName}.crt`);
                    }
                    return commands;
                }
                throw new Error(`Unknown os/architecture combo for extra certificates: ${os.name}/${architecture.name}`);
            }
            getAssets(os, _architecture) {
                const assets = [];
                let targetDir;
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    targetDir = '/usr/local/share/ca-certificates/';
                }
                else if (os.isIn(providers_1.Os._ALL_LINUX_AMAZON_VERSIONS)) {
                    targetDir = '/etc/pki/ca-trust/source/anchors/';
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    targetDir = 'C:\\';
                }
                else {
                    throw new Error(`Unsupported OS for extra certificates: ${os.name}`);
                }
                for (let i = 0; i < certificateFiles.length; i++) {
                    const certName = `${sanitizedName}-${i}`;
                    assets.push({
                        source: certificateFiles[i],
                        target: `${targetDir}${certName}.crt`,
                    });
                }
                return assets;
            }
        }();
    }
    /**
     * A component to set up the required Lambda entrypoint for Lambda runners.
     */
    static lambdaEntrypoint() {
        return new class extends RunnerImageComponent {
            name = 'Lambda-Entrypoint';
            getCommands(os, _architecture) {
                if (!os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
                    throw new Error(`Unsupported OS for Lambda entrypoint: ${os.name}`);
                }
                return [];
            }
            getAssets(_os, _architecture) {
                return [
                    {
                        source: path.join(__dirname, '..', '..', 'assets', 'providers', 'lambda-bootstrap.sh'),
                        target: '/bootstrap.sh',
                    },
                    {
                        source: path.join(__dirname, '..', '..', 'assets', 'providers', 'lambda-runner.sh'),
                        target: '/runner.sh',
                    },
                ];
            }
            getDockerCommands(_os, _architecture) {
                return [
                    'LABEL DISABLE_SOCI=1', // hacky way to disable soci v2 indexing on lambda as lambda will fail to start with an index
                    'ENTRYPOINT ["bash", "/bootstrap.sh"]',
                ];
            }
        };
    }
    /**
     * A component to add environment variables for jobs the runner executes.
     *
     * These variables only affect the jobs ran by the runner. They are not global. They do not affect other components.
     *
     * It is not recommended to use this component to pass secrets. Instead, use GitHub Secrets or AWS Secrets Manager.
     *
     * Must be used after the {@link githubRunner} component.
     */
    static environmentVariables(vars) {
        Object.entries(vars).forEach(([key, value]) => {
            if (key.includes('\n') || value.includes('\n')) {
                throw new Error(`Environment variable cannot contain newlines: ${key}=${value}`);
            }
            if (key == 'ACTIONS_RUNNER_HOOK_JOB_STARTED' || key == 'ACTIONS_RUNNER_HOOK_JOB_COMPLETED') {
                throw new Error('Cannot override ACTIONS_RUNNER_HOOK_JOB_STARTED or ACTIONS_RUNNER_HOOK_JOB_COMPLETED. Use RunnerImageComponent.jobStartedHook() or RunnerImageComponent.jobCompletedHook() instead.');
            }
        });
        return new class extends RunnerImageComponent {
            name = 'EnvironmentVariables';
            getCommands(os, _architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
                    if (Object.keys(vars).length === 0) {
                        return [];
                    }
                    return [
                        ...Object.entries(vars).map(e => `echo '${e[0]}=${e[1].replace(/'/g, "'\"'\"'")}' >> /home/runner/.env`),
                        'chown runner /home/runner/.env', // env.sh modifies .env
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    return Object.entries(vars).map(e => `Add-Content -Path C:\\actions\\.env -Value '${e[0]}=${e[1].replace(/'/g, "''")}'`);
                }
                else {
                    throw new Error(`Unsupported OS for environment variables component: ${os.name}`);
                }
            }
        };
    }
    /**
     * A component that runs a script before every job the runner executes.
     *
     * Point this at a local script file. It is copied into the image, made executable, and the runner is
     * configured to run it before each job through the
     * [`ACTIONS_RUNNER_HOOK_JOB_STARTED`](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts)
     * environment variable. GitHub passes job context to the script as environment variables such as `GITHUB_REPOSITORY` and `GITHUB_RUN_ID`.
     *
     * Must be used after the {@link githubRunner} component.
     *
     * @param sourcePath path to a local script file to run before every job
     */
    static jobStartedHook(sourcePath) {
        return RunnerImageComponent.jobHook('Job-Started-Hook', 'job-started-hook-user', sourcePath);
    }
    /**
     * A component that runs a script after every job the runner executes.
     *
     * Point this at a local script file. It is copied into the image, made executable, and the runner is
     * configured to run it after each job through the
     * [`ACTIONS_RUNNER_HOOK_JOB_COMPLETED`](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/run-scripts)
     * environment variable. GitHub passes job context to the script as environment variables such as `GITHUB_REPOSITORY` and `GITHUB_RUN_ID`.
     *
     * Must be used after the {@link githubRunner} component.
     *
     * @param sourcePath path to a local script file to run after every job
     */
    static jobCompletedHook(sourcePath) {
        return RunnerImageComponent.jobHook('Job-Completed-Hook', 'job-completed-hook-user', sourcePath);
    }
    static jobHook(name, scriptName, sourcePath) {
        const scriptPath = (os) => {
            if (os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
                return `/home/runner/${scriptName}.sh`;
            }
            else if (os.is(providers_1.Os.WINDOWS)) {
                return `C:\\actions\\${scriptName}.ps1`;
            }
            throw new Error(`Unsupported OS for job hook component: ${os.name}`);
        };
        return new class extends RunnerImageComponent {
            name = name;
            getAssets(os, _architecture) {
                return [{
                        source: sourcePath,
                        target: scriptPath(os),
                    }];
            }
            getCommands(os, _architecture) {
                const target = scriptPath(os);
                if (os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
                    return [
                        `chmod +x '${target}'`,
                    ];
                }
                else if (os.is(providers_1.Os.WINDOWS)) {
                    return [];
                }
                throw new Error(`Unsupported OS for job hook component: ${os.name}`);
            }
        }();
    }
    /**
     * Returns assets to copy into the built image. Can be used to copy files into the image.
     */
    getAssets(_os, _architecture) {
        return [];
    }
    /**
     * Returns Docker commands to run to in built image. Can be used to add commands like `VOLUME`, `ENTRYPOINT`, `CMD`, etc.
     *
     * Docker commands are added after assets and normal commands.
     */
    getDockerCommands(_os, _architecture) {
        return [];
    }
    /**
     * Returns true if the image builder should be rebooted after this component is installed.
     */
    shouldReboot(_os, _architecture) {
        return false;
    }
    /**
     * Convert component to an AWS Image Builder component.
     *
     * Components are cached and reused when the same component is requested with the same
     * OS and architecture, reducing stack template size and number of resources.
     *
     * @internal
     */
    _asAwsImageBuilderComponent(scope, os, architecture) {
        let platform;
        if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS) || os.isIn(providers_1.Os._ALL_LINUX_AMAZON_VERSIONS)) {
            platform = 'Linux';
        }
        else if (os.is(providers_1.Os.WINDOWS)) {
            platform = 'Windows';
        }
        else {
            throw new Error(`Unknown os/architecture combo for image builder component: ${os.name}/${architecture.name}`);
        }
        // Get component properties to create a cache key
        const commands = this.getCommands(os, architecture);
        const assets = this.getAssets(os, architecture);
        const reboot = this.shouldReboot(os, architecture);
        // Create a cache key based on component identity and properties
        const stack = cdk.Stack.of(scope);
        const cacheKey = this._getCacheKey(stack, os, architecture, commands, assets, reboot);
        // Create a consistent ID based on the cache key to ensure the same component
        // always gets the same ID, regardless of the passed-in id parameter
        // The cache key is already a hash, so we can use it directly
        // Prefix with GHRInternal/ to avoid conflicts with user-defined constructs
        const consistentId = `GHRInternal/Component-${this.name}-${os.name}-${architecture.name}-${cacheKey.substring(0, 10)}`.replace(/[^a-zA-Z0-9-/]/g, '-');
        // Use the construct tree as the cache - check if component already exists in the stack
        const existing = stack.node.tryFindChild(consistentId);
        if (existing) {
            // Component already exists in this stack, reuse it
            return existing;
        }
        // Create new component in the stack scope so it can be shared across all scopes in the same stack
        const component = new aws_image_builder_1.ImageBuilderComponent(stack, consistentId, {
            platform: platform,
            commands: commands,
            assets: assets.map((asset, index) => {
                return {
                    asset: new aws_cdk_lib_1.aws_s3_assets.Asset(stack, `GHRInternal/${consistentId}/Asset${index}`, { path: asset.source }),
                    path: asset.target,
                };
            }),
            displayName: `${this.name} (${os.name}/${architecture.name})`,
            description: `${this.name} component for ${os.name}/${architecture.name}`,
            reboot: reboot,
        });
        return component;
    }
    /**
     * Generate a cache key for component reuse.
     * Components with the same name, OS, architecture, commands, assets, and reboot flag will share the same key.
     * Returns a hash of all component properties to ensure uniqueness.
     *
     * The key is built from a *canonical* representation of the inputs so it stays stable across synths
     * and machines:
     *  - Commands are resolved through the stack so CDK tokens (e.g. `Ref`/`Fn::GetAtt`) are hashed by
     *    their stable intrinsic form, not by the `${Token[TOKEN.NN]}` placeholder whose counter changes
     *    between synths.
     *  - Assets are hashed by file content (path-independent) rather than by their local source path, so
     *    the same file produces the same key regardless of where it lives on disk.
     *
     * @internal
     */
    _getCacheKey(stack, os, architecture, commands, assets, reboot) {
        // Create a hash of the component properties. Only tokenized commands are resolved (plain commands
        // are left as-is so their key is unchanged), and assets are keyed by content instead of path.
        const commandKeys = commands.map(c => cdk.Token.isUnresolved(c) ? JSON.stringify(stack.resolve(c)) : c).join('\n');
        const assetKeys = assets.map(a => `${cdk.FileSystem.fingerprint(a.source)}:${a.target}`).sort().join('|');
        const keyData = `${this.name}:${os.name}:${architecture.name}:${commandKeys}:${assetKeys}:${reboot}`;
        return crypto.createHash('md5').update(keyData).digest('hex');
    }
}
exports.RunnerImageComponent = RunnerImageComponent;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcG9uZW50cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9jb21wb25lbnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSwrQ0FBaUM7QUFDakMsMkNBQTZCO0FBQzdCLGlEQUFtQztBQUNuQyw2Q0FBeUQ7QUFFekQsb0NBQW9EO0FBQ3BELDJEQUE0RDtBQUU1RCw0Q0FBK0Q7QUE4Qi9EOzs7O0dBSUc7QUFDSCxTQUFTLGVBQWUsQ0FBQyxPQUEyQjtJQUNsRCxJQUFJLE9BQU8sS0FBSyxTQUFTLElBQUksT0FBTyxLQUFLLElBQUk7UUFBRSxPQUFPLFNBQVMsQ0FBQztJQUNoRSxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDL0IsSUFBSSxPQUFPLEtBQUssRUFBRSxJQUFJLE9BQU8sQ0FBQyxXQUFXLEVBQUUsS0FBSyxRQUFRO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFDM0UsSUFBSSxDQUFDLG1CQUFtQixDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ3ZDLE1BQU0sSUFBSSxLQUFLLENBQ2Isb0JBQW9CLE9BQU8sNkVBQTZFLENBQ3pHLENBQUM7SUFDSixDQUFDO0lBQ0QsT0FBTyxPQUFPLENBQUM7QUFDakIsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQVMsMEJBQTBCLENBQUMsT0FBZTtJQUNqRCxJQUFJLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUM7UUFBRSxPQUFPLE9BQU8sQ0FBQztJQUNuRCxNQUFNLEtBQUssR0FBRyxPQUFPLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0lBQ3pDLElBQUksS0FBSyxDQUFDLE1BQU0sS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBQUUsT0FBTyxPQUFPLENBQUM7SUFDcEQsTUFB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QyxHQUFHLENBQUMsQ0FBQztRQUMxRyxNQUFNLE9BQU8sR0FBRyxHQUFHLElBQUksQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDLElBQUksSUFBSSxZQUFZLENBQUMsSUFBSSxJQUFJLFdBQVcsSUFBSSxTQUFTLElBQUksTUFBTSxFQUFFLENBQUM7UUFDckcsT0FBTyxNQUFNLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDaEUsQ0FBQzs7QUEvMkJILG9EQWczQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjcnlwdG8gZnJvbSAnY3J5cHRvJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgYXdzX3MzX2Fzc2V0cyBhcyBzM19hc3NldHMgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IGRpc2NvdmVyQ2VydGlmaWNhdGVGaWxlcyB9IGZyb20gJy4uL3V0aWxzJztcbmltcG9ydCB7IEltYWdlQnVpbGRlckNvbXBvbmVudCB9IGZyb20gJy4vYXdzLWltYWdlLWJ1aWxkZXInO1xuaW1wb3J0IHsgUnVubmVySW1hZ2VBc3NldCB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IEFyY2hpdGVjdHVyZSwgT3MsIFJ1bm5lclZlcnNpb24gfSBmcm9tICcuLi9wcm92aWRlcnMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFJ1bm5lckltYWdlQ29tcG9uZW50Q3VzdG9tUHJvcHMge1xuICAvKipcbiAgICogQ29tcG9uZW50IG5hbWUgdXNlZCBmb3IgKDEpIGltYWdlIGJ1aWxkIGxvZ2dpbmcgYW5kICgyKSBpZGVudGlmaWVyIGZvciB7QGxpbmsgSUNvbmZpZ3VyYWJsZVJ1bm5lckltYWdlQnVpbGRlci5yZW1vdmVDb21wb25lbnR9LlxuICAgKlxuICAgKiBOYW1lIG11c3Qgb25seSBjb250YWluIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFuZCBkYXNoZXMuXG4gICAqL1xuICByZWFkb25seSBuYW1lPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBDb21tYW5kcyB0byBydW4gaW4gdGhlIGJ1aWx0IGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgY29tbWFuZHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogQXNzZXRzIHRvIGNvcHkgaW50byB0aGUgYnVpbHQgaW1hZ2UuXG4gICAqL1xuICByZWFkb25seSBhc3NldHM/OiBSdW5uZXJJbWFnZUFzc2V0W107XG5cbiAgLyoqXG4gICAqIERvY2tlciBjb21tYW5kcyB0byBydW4gaW4gdGhlIGJ1aWx0IGltYWdlLlxuICAgKlxuICAgKiBGb3IgZXhhbXBsZTogYFsnRU5WIGZvbz1iYXInLCAnUlVOIGVjaG8gJGZvbyddYFxuICAgKlxuICAgKiBUaGVzZSBjb21tYW5kcyBhcmUgaWdub3JlZCB3aGVuIGJ1aWxkaW5nIEFNSXMuXG4gICAqL1xuICByZWFkb25seSBkb2NrZXJDb21tYW5kcz86IHN0cmluZ1tdO1xufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhbmQgbm9ybWFsaXplcyBhIHZlcnNpb24gc3RyaW5nIGZvciB1c2UgaW4gZG93bmxvYWQgVVJMcy5cbiAqIFJldHVybnMgdW5kZWZpbmVkIGlmIHZlcnNpb24gaXMgZW1wdHkgb3IgXCJsYXRlc3RcIiAoY2FsbGVyIHNob3VsZCB1c2UgbGF0ZXN0KS5cbiAqIFRocm93cyBpZiB2ZXJzaW9uIGNvbnRhaW5zIGFueSBjaGFyYWN0ZXIgb3RoZXIgdGhhbiBhbHBoYW51bWVyaWMsIGRvdHMsIGRhc2hlcywgb3IgdW5kZXJzY29yZXMuXG4gKi9cbmZ1bmN0aW9uIHZhbGlkYXRlVmVyc2lvbih2ZXJzaW9uOiBzdHJpbmcgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodmVyc2lvbiA9PT0gdW5kZWZpbmVkIHx8IHZlcnNpb24gPT09IG51bGwpIHJldHVybiB1bmRlZmluZWQ7XG4gIGNvbnN0IHRyaW1tZWQgPSB2ZXJzaW9uLnRyaW0oKTtcbiAgaWYgKHRyaW1tZWQgPT09ICcnIHx8IHRyaW1tZWQudG9Mb3dlckNhc2UoKSA9PT0gJ2xhdGVzdCcpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmICghL15bYS16QS1aMC05Ll8tXSskLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYEludmFsaWQgdmVyc2lvbiBcIiR7dmVyc2lvbn1cIjogb25seSBhbHBoYW51bWVyaWMgY2hhcmFjdGVycywgZG90cywgZGFzaGVzLCBhbmQgdW5kZXJzY29yZXMgYXJlIGFsbG93ZWQuYCxcbiAgICApO1xuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIEdpdCBmb3IgV2luZG93cyB2ZXJzaW9uIGZvcm1hdDogXCIyLjQzLjAud2luZG93cy4xXCIg4oaSIFwiMi40My4wXCIgKHJldmlzaW9uIDEgb21pdHRlZCksXG4gKiBcIjIuNDMuMC53aW5kb3dzLjJcIiDihpIgXCIyLjQzLjAuMlwiIChyZXZpc2lvbiAyKyBhcHBlbmRlZCkuIFZlcnNpb25zIHdpdGhvdXQgXCIud2luZG93cy5cIiBhcmUgcmV0dXJuZWQgYXMtaXMuXG4gKi9cbmZ1bmN0aW9uIGZvcm1hdEdpdEZvcldpbmRvd3NWZXJzaW9uKHZlcnNpb246IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghdmVyc2lvbi5pbmNsdWRlcygnLndpbmRvd3MuJykpIHJldHVybiB2ZXJzaW9uO1xuICBjb25zdCBwYXJ0cyA9IHZlcnNpb24uc3BsaXQoJy53aW5kb3dzLicpO1xuICBpZiAocGFydHMubGVuZ3RoICE9PSAyIHx8ICFwYXJ0c1sxXSkgcmV0dXJuIHZlcnNpb247XG4gIGNvbnN0IGJhc2UgPSBwYXJ0c1swXTtcbiAgY29uc3QgcmV2aXNpb24gPSBwYXJzZUludChwYXJ0c1sxXSwgMTApO1xuICBpZiAoaXNOYU4ocmV2aXNpb24pKSByZXR1cm4gdmVyc2lvbjtcbiAgcmV0dXJuIHJldmlzaW9uID4gMSA/IGAke2Jhc2V9LiR7cmV2aXNpb259YCA6IGJhc2U7XG59XG5cbi8qKlxuICogQ29tcG9uZW50cyBhcmUgdXNlZCB0byBidWlsZCBydW5uZXIgaW1hZ2VzLiBUaGV5IGNhbiBydW4gY29tbWFuZHMgaW4gdGhlIGltYWdlLCBjb3B5IGZpbGVzIGludG8gdGhlIGltYWdlLCBhbmQgcnVuIHNvbWUgRG9ja2VyIGNvbW1hbmRzLlxuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAvKipcbiAgICogRGVmaW5lIGEgY3VzdG9tIGNvbXBvbmVudCB0aGF0IGNhbiBydW4gY29tbWFuZHMgaW4gdGhlIGltYWdlLCBjb3B5IGZpbGVzIGludG8gdGhlIGltYWdlLCBhbmQgcnVuIHNvbWUgRG9ja2VyIGNvbW1hbmRzLlxuICAgKlxuICAgKiBUaGUgb3JkZXIgb2Ygb3BlcmF0aW9ucyBpcyAoMSkgYXNzZXRzICgyKSBjb21tYW5kcyAoMykgZG9ja2VyIGNvbW1hbmRzLlxuICAgKlxuICAgKiBVc2UgdGhpcyB0byBjdXN0b21pemUgdGhlIGltYWdlIGZvciB0aGUgcnVubmVyLlxuICAgKlxuICAgKiAqKldBUk5JTkc6KiogRG9ja2VyIGNvbW1hbmRzIGFyZSBub3QgZ3VhcmFudGVlZCB0byBiZSBpbmNsdWRlZCBiZWZvcmUgdGhlIG5leHQgY29tcG9uZW50XG4gICAqL1xuICBzdGF0aWMgY3VzdG9tKHByb3BzOiBSdW5uZXJJbWFnZUNvbXBvbmVudEN1c3RvbVByb3BzKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBnZXQgbmFtZSgpIHtcbiAgICAgICAgaWYgKHByb3BzLm5hbWUgJiYgIXByb3BzLm5hbWUubWF0Y2goL1thLXpBLVowLTlcXC1dLykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgY29tcG9uZW50IG5hbWU6ICR7cHJvcHMubmFtZX0uIE5hbWUgbXVzdCBvbmx5IGNvbnRhaW4gYWxwaGFudW1lcmljIGNoYXJhY3RlcnMgYW5kIGRhc2hlcy5gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYEN1c3RvbS0ke3Byb3BzLm5hbWUgPz8gJ1VuZGVmaW5lZCd9YDtcbiAgICAgIH1cblxuICAgICAgZ2V0Q29tbWFuZHMoX29zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgICAgIHJldHVybiBwcm9wcy5jb21tYW5kcyA/PyBbXTtcbiAgICAgIH1cbiAgICAgIGdldEFzc2V0cyhfb3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpIHtcbiAgICAgICAgcmV0dXJuIHByb3BzLmFzc2V0cyA/PyBbXTtcbiAgICAgIH1cblxuICAgICAgZ2V0RG9ja2VyQ29tbWFuZHMoX29zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgICAgIHJldHVybiBwcm9wcy5kb2NrZXJDb21tYW5kcyA/PyBbXTtcbiAgICAgIH1cbiAgICB9KCk7XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gaW5zdGFsbCB0aGUgcmVxdWlyZWQgcGFja2FnZXMgZm9yIHRoZSBydW5uZXIuXG4gICAqL1xuICBzdGF0aWMgcmVxdWlyZWRQYWNrYWdlcygpOiBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgcmV0dXJuIG5ldyBjbGFzcyBleHRlbmRzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAgIG5hbWUgPSAnUmVxdWlyZWRQYWNrYWdlcyc7XG5cbiAgICAgIGdldENvbW1hbmRzKG9zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogc3RyaW5nW10ge1xuICAgICAgICAvLyBsaWJhdG9taWMgaXMgbmVlZGVkIGJ5IE5vZGUuanMgMjYgYW5kIHRoZSBydW5uZXIgZG9lc24ndCBpbnN0YWxsIGl0IChhY3Rpb25zL3J1bm5lciM0NTkxKVxuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2FwdC1nZXQgLW8gQWNxdWlyZTo6UmV0cmllcz01IHVwZGF0ZScsXG4gICAgICAgICAgICAnREVCSUFOX0ZST05URU5EPW5vbmludGVyYWN0aXZlIGFwdC1nZXQgLW8gQWNxdWlyZTo6UmV0cmllcz01IHVwZ3JhZGUgLXknLFxuICAgICAgICAgICAgJ0RFQklBTl9GUk9OVEVORD1ub25pbnRlcmFjdGl2ZSBhcHQtZ2V0IC1vIEFjcXVpcmU6OlJldHJpZXM9NSBpbnN0YWxsIC15IGN1cmwgc3VkbyBqcSBiYXNoIHppcCB1bnppcCBpcHRhYmxlcyBzb2Z0d2FyZS1wcm9wZXJ0aWVzLWNvbW1vbiBjYS1jZXJ0aWZpY2F0ZXMgbGliYXRvbWljMScsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMikpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ3l1bSB1cGRhdGUgLXknLFxuICAgICAgICAgICAgJ3l1bSBpbnN0YWxsIC15IGpxIHRhciBnemlwIGJ6aXAyIHdoaWNoIGJpbnV0aWxzIHppcCB1bnppcCBzdWRvIHNoYWRvdy11dGlscyBsaWJhdG9taWMnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIwMjMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdkbmYgdXBncmFkZSAteScsXG4gICAgICAgICAgICAnZG5mIGluc3RhbGwgLXkganEgdGFyIGd6aXAgYnppcDIgd2hpY2ggYmludXRpbHMgemlwIHVuemlwIHN1ZG8gc2hhZG93LXV0aWxzIGZpbmR1dGlscyBsaWJhdG9taWMnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIE9TIGZvciByZXF1aXJlZCBwYWNrYWdlczogJHtvcy5uYW1lfWApO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gaW5zdGFsbCBDbG91ZFdhdGNoIEFnZW50IGZvciB0aGUgcnVubmVyIHNvIHdlIGNhbiBzZW5kIGxvZ3MuXG4gICAqL1xuICBzdGF0aWMgY2xvdWRXYXRjaEFnZW50KCk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICByZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgICAgbmFtZSA9ICdDbG91ZFdhdGNoQWdlbnQnO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogc3RyaW5nW10ge1xuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICBsZXQgYXJjaFVybDtcbiAgICAgICAgICBpZiAoYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgICAgICBhcmNoVXJsID0gJ2FtZDY0JztcbiAgICAgICAgICB9IGVsc2UgaWYgKGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgICAgICBhcmNoVXJsID0gJ2FybTY0JztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgZm9yIHJlcXVpcmVkIHBhY2thZ2VzOiAke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICBgY3VybCAtLXJldHJ5IDUgLS1yZXRyeS1kZWxheSAzMCAtLXJldHJ5LWFsbC1lcnJvcnMgLXNmTG8gL3RtcC9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC5kZWIgaHR0cHM6Ly9zMy5hbWF6b25hd3MuY29tL2FtYXpvbmNsb3Vkd2F0Y2gtYWdlbnQvdWJ1bnR1LyR7YXJjaFVybH0vbGF0ZXN0L2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LmRlYmAsXG4gICAgICAgICAgICAnZHBrZyAtaSAtRSAvdG1wL2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LmRlYicsXG4gICAgICAgICAgICAncm0gL3RtcC9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC5kZWInLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICd5dW0gaW5zdGFsbCAteSBhbWF6b24tY2xvdWR3YXRjaC1hZ2VudCcsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMjAyMykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2RuZiBpbnN0YWxsIC15IGFtYXpvbi1jbG91ZHdhdGNoLWFnZW50JyxcbiAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICckcCA9IFN0YXJ0LVByb2Nlc3MgbXNpZXhlYy5leGUgLVBhc3NUaHJ1IC1XYWl0IC1Bcmd1bWVudExpc3QgXFwnL2kgaHR0cHM6Ly9zMy5hbWF6b25hd3MuY29tL2FtYXpvbmNsb3Vkd2F0Y2gtYWdlbnQvd2luZG93cy9hbWQ2NC9sYXRlc3QvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQubXNpIC9xblxcJycsXG4gICAgICAgICAgICAnaWYgKCRwLkV4aXRDb2RlIC1uZSAwKSB7IHRocm93IFwiRXhpdCBjb2RlIGlzICRwLkV4aXRDb2RlXCIgfScsXG4gICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgT1MgZm9yIHJlcXVpcmVkIHBhY2thZ2VzOiAke29zLm5hbWV9YCk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGNvbXBvbmVudCB0byBwcmVwYXJlIHRoZSByZXF1aXJlZCBydW5uZXIgdXNlci5cbiAgICovXG4gIHN0YXRpYyBydW5uZXJVc2VyKCk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICByZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgICAgbmFtZSA9ICdSdW5uZXJVc2VyJztcblxuICAgICAgZ2V0Q29tbWFuZHMob3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpOiBzdHJpbmdbXSB7XG4gICAgICAgIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfVUJVTlRVX1ZFUlNJT05TKSkge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnYWRkZ3JvdXAgcnVubmVyJyxcbiAgICAgICAgICAgICdhZGR1c2VyIC0tc3lzdGVtIC0tZGlzYWJsZWQtcGFzc3dvcmQgLS1ob21lIC9ob21lL3J1bm5lciAtLWluZ3JvdXAgcnVubmVyIHJ1bm5lcicsXG4gICAgICAgICAgICAnZWNobyBcIiVydW5uZXIgICBBTEw9KEFMTDpBTEwpIE5PUEFTU1dEOiBBTExcIiA+IC9ldGMvc3Vkb2Vycy5kL3J1bm5lcicsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfQU1BWk9OX1ZFUlNJT05TKSkge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnL3Vzci9zYmluL2dyb3VwYWRkIHJ1bm5lcicsXG4gICAgICAgICAgICAnL3Vzci9zYmluL3VzZXJhZGQgLS1zeXN0ZW0gLS1zaGVsbCAvdXNyL3NiaW4vbm9sb2dpbiAtLWhvbWUtZGlyIC9ob21lL3J1bm5lciAtLWdpZCBydW5uZXIgcnVubmVyJyxcbiAgICAgICAgICAgICdta2RpciAtcCAvaG9tZS9ydW5uZXInLFxuICAgICAgICAgICAgJ2Nob3duIHJ1bm5lciAvaG9tZS9ydW5uZXInLFxuICAgICAgICAgICAgJ2VjaG8gXCIlcnVubmVyICAgQUxMPShBTEw6QUxMKSBOT1BBU1NXRDogQUxMXCIgPiAvZXRjL3N1ZG9lcnMuZC9ydW5uZXInLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIE9TIGZvciBydW5uZXIgdXNlcjogJHtvcy5uYW1lfWApO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gaW5zdGFsbCB0aGUgQVdTIENMSS5cbiAgICpcbiAgICogQHBhcmFtIHZlcnNpb24gU29mdHdhcmUgdmVyc2lvbiB0byBpbnN0YWxsIChlLmcuICcyLjE1LjAnKS4gRGVmYXVsdDogbGF0ZXN0LlxuICAgKi9cbiAgc3RhdGljIGF3c0NsaSh2ZXJzaW9uPzogc3RyaW5nKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIGNvbnN0IHVzZVZlcnNpb24gPSB2YWxpZGF0ZVZlcnNpb24odmVyc2lvbik7XG4gICAgcmV0dXJuIG5ldyBjbGFzcyBleHRlbmRzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAgIG5hbWUgPSAnQXdzQ2xpJztcblxuICAgICAgZ2V0Q29tbWFuZHMob3M6IE9zLCBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykgfHwgb3MuaXNJbihPcy5fQUxMX0xJTlVYX0FNQVpPTl9WRVJTSU9OUykpIHtcbiAgICAgICAgICBsZXQgYXJjaFVybDogc3RyaW5nO1xuICAgICAgICAgIGlmIChhcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgICAgICAgIGFyY2hVcmwgPSAneDg2XzY0JztcbiAgICAgICAgICB9IGVsc2UgaWYgKGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgICAgICBhcmNoVXJsID0gJ2FhcmNoNjQnO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZSBmb3IgYXdzY2xpOiAke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbnN0IHppcE5hbWUgPSB1c2VWZXJzaW9uXG4gICAgICAgICAgICA/IGBhd3NjbGktZXhlLWxpbnV4LSR7YXJjaFVybH0tJHt1c2VWZXJzaW9ufS56aXBgXG4gICAgICAgICAgICA6IGBhd3NjbGktZXhlLWxpbnV4LSR7YXJjaFVybH0uemlwYDtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgYGN1cmwgLS1yZXRyeSA1IC0tcmV0cnktZGVsYXkgMzAgLS1yZXRyeS1hbGwtZXJyb3JzIC1mc1NMIFwiaHR0cHM6Ly9hd3NjbGkuYW1hem9uYXdzLmNvbS8ke3ppcE5hbWV9XCIgLW8gYXdzY2xpdjIuemlwYCxcbiAgICAgICAgICAgICd1bnppcCAtcSBhd3NjbGl2Mi56aXAnLFxuICAgICAgICAgICAgJy4vYXdzL2luc3RhbGwgLS11cGRhdGUnLFxuICAgICAgICAgICAgJ3JtIC1yZiBhd3NjbGl2Mi56aXAgYXdzJyxcbiAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgY29uc3QgbXNpVXJsID0gdXNlVmVyc2lvblxuICAgICAgICAgICAgPyBgaHR0cHM6Ly9hd3NjbGkuYW1hem9uYXdzLmNvbS9BV1NDTElWMi0ke3VzZVZlcnNpb259Lm1zaWBcbiAgICAgICAgICAgIDogJ2h0dHBzOi8vYXdzY2xpLmFtYXpvbmF3cy5jb20vQVdTQ0xJVjIubXNpJztcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgYCRwID0gU3RhcnQtUHJvY2VzcyBtc2lleGVjLmV4ZSAtUGFzc1RocnUgLVdhaXQgLUFyZ3VtZW50TGlzdCAnL2kgJHttc2lVcmx9IC9xbidgLFxuICAgICAgICAgICAgJ2lmICgkcC5FeGl0Q29kZSAtbmUgMCkgeyB0aHJvdyBcIkV4aXQgY29kZSBpcyAkcC5FeGl0Q29kZVwiIH0nLFxuICAgICAgICAgIF07XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3MvYXJjaGl0ZWN0dXJlIGNvbWJvIGZvciBhd3NjbGk6ICR7b3MubmFtZX0vJHthcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICAgIH1cbiAgICB9KCk7XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gaW5zdGFsbCB0aGUgR2l0SHViIENMSS5cbiAgICpcbiAgICogQHBhcmFtIHZlcnNpb24gU29mdHdhcmUgdmVyc2lvbiB0byBpbnN0YWxsIChlLmcuICcyLjQwLjAnKS4gRGVmYXVsdDogbGF0ZXN0LiBPbmx5IHVzZWQgb24gV2luZG93cyAoeDY0L3dpbmRvd3NfYW1kNjQpOyBvbiBMaW51eCB0aGUgcGFja2FnZSBtYW5hZ2VyIGlzIHVzZWQuXG4gICAqL1xuICBzdGF0aWMgZ2l0aHViQ2xpKHZlcnNpb24/OiBzdHJpbmcpOiBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgY29uc3QgdXNlVmVyc2lvbiA9IHZhbGlkYXRlVmVyc2lvbih2ZXJzaW9uKTtcbiAgICByZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgICAgbmFtZSA9ICdHaXRodWJDbGknO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgICAgIGlmICh1c2VWZXJzaW9uICYmICFvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICdSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkodmVyc2lvbik6IHZlcnNpb24gaXMgb25seSB1c2VkIG9uIFdpbmRvd3MuIE9uIExpbnV4IHRoZSBwYWNrYWdlIG1hbmFnZXIgKGFwdC95dW0vZG5mKSBpcyB1c2VkLiBPbWl0IHRoZSB2ZXJzaW9uIGZvciBMaW51eCBpbWFnZXMuJyxcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfVUJVTlRVX1ZFUlNJT05TKSkge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnY3VybCAtLXJldHJ5IDUgLS1yZXRyeS1kZWxheSAzMCAtLXJldHJ5LWFsbC1lcnJvcnMgLWZzU0wgaHR0cHM6Ly9jbGkuZ2l0aHViLmNvbS9wYWNrYWdlcy9naXRodWJjbGktYXJjaGl2ZS1rZXlyaW5nLmdwZyB8IHN1ZG8gZGQgb2Y9L3Vzci9zaGFyZS9rZXlyaW5ncy9naXRodWJjbGktYXJjaGl2ZS1rZXlyaW5nLmdwZycsXG4gICAgICAgICAgICAnZWNobyBcImRlYiBbYXJjaD0kKGRwa2cgLS1wcmludC1hcmNoaXRlY3R1cmUpIHNpZ25lZC1ieT0vdXNyL3NoYXJlL2tleXJpbmdzL2dpdGh1YmNsaS1hcmNoaXZlLWtleXJpbmcuZ3BnXSAnICtcbiAgICAgICAgICAgICcgIGh0dHBzOi8vY2xpLmdpdGh1Yi5jb20vcGFja2FnZXMgc3RhYmxlIG1haW5cIiB8IHN1ZG8gdGVlIC9ldGMvYXB0L3NvdXJjZXMubGlzdC5kL2dpdGh1Yi1jbGkubGlzdCA+IC9kZXYvbnVsbCcsXG4gICAgICAgICAgICAnYXB0LWdldCAtbyBBY3F1aXJlOjpSZXRyaWVzPTUgdXBkYXRlJyxcbiAgICAgICAgICAgICdERUJJQU5fRlJPTlRFTkQ9bm9uaW50ZXJhY3RpdmUgYXB0LWdldCAtbyBBY3F1aXJlOjpSZXRyaWVzPTUgaW5zdGFsbCAteSBnaCcsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMikpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2N1cmwgLS1yZXRyeSA1IC0tcmV0cnktZGVsYXkgMzAgLS1yZXRyeS1hbGwtZXJyb3JzIC1mc1NTTCBodHRwczovL2NsaS5naXRodWIuY29tL3BhY2thZ2VzL3JwbS9naC1jbGkucmVwbyAtbyAvZXRjL3l1bS5yZXBvcy5kL2doLWNsaS5yZXBvJyxcbiAgICAgICAgICAgICd5dW0gaW5zdGFsbCAteSBnaCcsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMjAyMykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2N1cmwgLS1yZXRyeSA1IC0tcmV0cnktZGVsYXkgMzAgLS1yZXRyeS1hbGwtZXJyb3JzIC1mc1NTTCBodHRwczovL2NsaS5naXRodWIuY29tL3BhY2thZ2VzL3JwbS9naC1jbGkucmVwbyAtbyAvZXRjL3l1bS5yZXBvcy5kL2doLWNsaS5yZXBvJyxcbiAgICAgICAgICAgICdkbmYgaW5zdGFsbCAteSBnaCcsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIGlmICh1c2VWZXJzaW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICBgSW52b2tlLVdlYlJlcXVlc3QgLVVzZUJhc2ljUGFyc2luZyAtVXJpIFwiaHR0cHM6Ly9naXRodWIuY29tL2NsaS9jbGkvcmVsZWFzZXMvZG93bmxvYWQvdiR7dXNlVmVyc2lvbn0vZ2hfJHt1c2VWZXJzaW9ufV93aW5kb3dzX2FtZDY0Lm1zaVwiIC1PdXRGaWxlIGdoLm1zaWAsXG4gICAgICAgICAgICAgICckcCA9IFN0YXJ0LVByb2Nlc3MgbXNpZXhlYy5leGUgLVBhc3NUaHJ1IC1XYWl0IC1Bcmd1bWVudExpc3QgXFwnL2kgZ2gubXNpIC9xblxcJycsXG4gICAgICAgICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgICAgICAgICAgJ2RlbCBnaC5tc2knLFxuICAgICAgICAgICAgXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdjbWQgL2MgY3VybCAtLXJldHJ5IDUgLS1yZXRyeS1kZWxheSAzMCAtZnNTTCAtbyBOVUwgLXcgXCIle3VybF9lZmZlY3RpdmV9XCIgaHR0cHM6Ly9naXRodWIuY29tL2NsaS9jbGkvcmVsZWFzZXMvbGF0ZXN0ID4gJEVudjpURU1QXFxcXGxhdGVzdC1naCcsXG4gICAgICAgICAgICAnJExhdGVzdFVybCA9IEdldC1Db250ZW50ICRFbnY6VEVNUFxcXFxsYXRlc3QtZ2gnLFxuICAgICAgICAgICAgJyRHSF9WRVJTSU9OID0gKCRMYXRlc3RVcmwgLVNwbGl0IFxcJy9cXCcpWy0xXS5zdWJzdHJpbmcoMSknLFxuICAgICAgICAgICAgJ0ludm9rZS1XZWJSZXF1ZXN0IC1Vc2VCYXNpY1BhcnNpbmcgLVVyaSBcImh0dHBzOi8vZ2l0aHViLmNvbS9jbGkvY2xpL3JlbGVhc2VzL2Rvd25sb2FkL3Yke0dIX1ZFUlNJT059L2doXyR7R0hfVkVSU0lPTn1fd2luZG93c19hbWQ2NC5tc2lcIiAtT3V0RmlsZSBnaC5tc2knLFxuICAgICAgICAgICAgJyRwID0gU3RhcnQtUHJvY2VzcyBtc2lleGVjLmV4ZSAtUGFzc1RocnUgLVdhaXQgLUFyZ3VtZW50TGlzdCBcXCcvaSBnaC5tc2kgL3FuXFwnJyxcbiAgICAgICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgICAgICAgICdkZWwgZ2gubXNpJyxcbiAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9zL2FyY2hpdGVjdHVyZSBjb21ibyBmb3IgZ2l0aHViIGNsaTogJHtvcy5uYW1lfS8ke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgICAgfVxuICAgIH0oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGNvbXBvbmVudCB0byBpbnN0YWxsIEdpdC5cbiAgICpcbiAgICogQHBhcmFtIHZlcnNpb24gU29mdHdhcmUgdmVyc2lvbiB0byBpbnN0YWxsIChlLmcuICcyLjQzLjAud2luZG93cy4xJykuIERlZmF1bHQ6IGxhdGVzdC4gT25seSB1c2VkIG9uIFdpbmRvd3M7IG9uIExpbnV4IHRoZSBwYWNrYWdlIG1hbmFnZXIgaXMgdXNlZC5cbiAgICovXG4gIHN0YXRpYyBnaXQodmVyc2lvbj86IHN0cmluZyk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICBjb25zdCB1c2VWZXJzaW9uID0gdmFsaWRhdGVWZXJzaW9uKHZlcnNpb24pO1xuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gJ0dpdCc7XG5cbiAgICAgIGdldENvbW1hbmRzKG9zOiBPcywgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpIHtcbiAgICAgICAgaWYgKHVzZVZlcnNpb24gJiYgIW9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgJ1J1bm5lckltYWdlQ29tcG9uZW50LmdpdCh2ZXJzaW9uKTogdmVyc2lvbiBpcyBvbmx5IHVzZWQgb24gV2luZG93cy4gT24gTGludXggdGhlIHBhY2thZ2UgbWFuYWdlciAoYXB0L3l1bS9kbmYpIGlzIHVzZWQuIE9taXQgdGhlIHZlcnNpb24gZm9yIExpbnV4IGltYWdlcy4nLFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdhZGQtYXB0LXJlcG9zaXRvcnkgcHBhOmdpdC1jb3JlL3BwYScsXG4gICAgICAgICAgICAnYXB0LWdldCAtbyBBY3F1aXJlOjpSZXRyaWVzPTUgdXBkYXRlJyxcbiAgICAgICAgICAgICdERUJJQU5fRlJPTlRFTkQ9bm9uaW50ZXJhY3RpdmUgYXB0LWdldCAtbyBBY3F1aXJlOjpSZXRyaWVzPTUgaW5zdGFsbCAteSBnaXQnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICd5dW0gaW5zdGFsbCAteSBnaXQnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIwMjMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdkbmYgaW5zdGFsbCAteSBnaXQnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICBpZiAodXNlVmVyc2lvbikge1xuICAgICAgICAgICAgY29uc3QgdmVyc2lvblNob3J0ID0gZm9ybWF0R2l0Rm9yV2luZG93c1ZlcnNpb24odXNlVmVyc2lvbik7XG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICBgSW52b2tlLVdlYlJlcXVlc3QgLVVzZUJhc2ljUGFyc2luZyAtVXJpIFwiaHR0cHM6Ly9naXRodWIuY29tL2dpdC1mb3Itd2luZG93cy9naXQvcmVsZWFzZXMvZG93bmxvYWQvdiR7dXNlVmVyc2lvbn0vR2l0LSR7dmVyc2lvblNob3J0fS02NC1iaXQuZXhlXCIgLU91dEZpbGUgZ2l0LXNldHVwLmV4ZWAsXG4gICAgICAgICAgICAgICckcCA9IFN0YXJ0LVByb2Nlc3MgZ2l0LXNldHVwLmV4ZSAtUGFzc1RocnUgLVdhaXQgLUFyZ3VtZW50TGlzdCBcXCcvVkVSWVNJTEVOVFxcJycsXG4gICAgICAgICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgICAgICAgICAgJ2RlbCBnaXQtc2V0dXAuZXhlJyxcbiAgICAgICAgICAgIF07XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnY21kIC9jIGN1cmwgLS1yZXRyeSA1IC0tcmV0cnktZGVsYXkgMzAgLWZzU0wgLW8gTlVMIC13IFwiJXt1cmxfZWZmZWN0aXZlfVwiIGh0dHBzOi8vZ2l0aHViLmNvbS9naXQtZm9yLXdpbmRvd3MvZ2l0L3JlbGVhc2VzL2xhdGVzdCA+ICRFbnY6VEVNUFxcXFxsYXRlc3QtZ2l0JyxcbiAgICAgICAgICAgICckTGF0ZXN0VXJsID0gR2V0LUNvbnRlbnQgJEVudjpURU1QXFxcXGxhdGVzdC1naXQnLFxuICAgICAgICAgICAgJyRHSVRfVkVSU0lPTiA9ICgkTGF0ZXN0VXJsIC1TcGxpdCBcXCcvXFwnKVstMV0uc3Vic3RyaW5nKDEpJyxcbiAgICAgICAgICAgICckR0lUX1ZFUlNJT05fU0hPUlQgPSAoJEdJVF9WRVJTSU9OIC1TcGxpdCBcXCcud2luZG93cy5cXCcpWzBdJyxcbiAgICAgICAgICAgICckR0lUX1JFVklTSU9OID0gKCRHSVRfVkVSU0lPTiAtU3BsaXQgXFwnLndpbmRvd3MuXFwnKVsxXScsXG4gICAgICAgICAgICAnSWYgKCRHSVRfUkVWSVNJT04gLWd0IDEpIHskR0lUX1ZFUlNJT05fU0hPUlQgPSBcIiRHSVRfVkVSU0lPTl9TSE9SVC4kR0lUX1JFVklTSU9OXCJ9JyxcbiAgICAgICAgICAgICdJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgaHR0cHM6Ly9naXRodWIuY29tL2dpdC1mb3Itd2luZG93cy9naXQvcmVsZWFzZXMvZG93bmxvYWQvdiR7R0lUX1ZFUlNJT059L0dpdC0ke0dJVF9WRVJTSU9OX1NIT1JUfS02NC1iaXQuZXhlIC1PdXRGaWxlIGdpdC1zZXR1cC5leGUnLFxuICAgICAgICAgICAgJyRwID0gU3RhcnQtUHJvY2VzcyBnaXQtc2V0dXAuZXhlIC1QYXNzVGhydSAtV2FpdCAtQXJndW1lbnRMaXN0IFxcJy9WRVJZU0lMRU5UXFwnJyxcbiAgICAgICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgICAgICAgICdkZWwgZ2l0LXNldHVwLmV4ZScsXG4gICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcy9hcmNoaXRlY3R1cmUgY29tYm8gZm9yIGdpdDogJHtvcy5uYW1lfS8ke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgICAgfVxuICAgIH0oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGNvbXBvbmVudCB0byBpbnN0YWxsIHRoZSBHaXRIdWIgQWN0aW9ucyBSdW5uZXIuIFRoaXMgaXMgdGhlIGFjdHVhbCBleGVjdXRhYmxlIHRoYXQgY29ubmVjdHMgdG8gR2l0SHViIHRvIGFzayBmb3Igam9icyBhbmQgdGhlbiBleGVjdXRlIHRoZW0uXG4gICAqXG4gICAqIEBwYXJhbSBydW5uZXJWZXJzaW9uIFRoZSB2ZXJzaW9uIG9mIHRoZSBydW5uZXIgdG8gaW5zdGFsbC4gVXN1YWxseSB5b3Ugd291bGQgc2V0IHRoaXMgdG8gbGF0ZXN0LlxuICAgKi9cbiAgc3RhdGljIGdpdGh1YlJ1bm5lcihydW5uZXJWZXJzaW9uOiBSdW5uZXJWZXJzaW9uKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gJ0dpdGh1YlJ1bm5lcic7XG5cbiAgICAgIGdldEFzc2V0cyhvczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IFJ1bm5lckltYWdlQXNzZXRbXSB7XG4gICAgICAgIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc291cmNlOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnYXNzZXRzJywgJ3Byb3ZpZGVycycsICdqb2ItcmVwb3J0ZXIuc2gnKSxcbiAgICAgICAgICAgICAgdGFyZ2V0OiAnL2hvbWUvcnVubmVyL2pvYi1yZXBvcnRlci5zaCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzb3VyY2U6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAncHJvdmlkZXJzJywgJ2pvYi1zdGFydGVkLWhvb2suc2gnKSxcbiAgICAgICAgICAgICAgdGFyZ2V0OiAnL2hvbWUvcnVubmVyL2pvYi1zdGFydGVkLWhvb2suc2gnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgc291cmNlOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnYXNzZXRzJywgJ3Byb3ZpZGVycycsICdqb2ItY29tcGxldGVkLWhvb2suc2gnKSxcbiAgICAgICAgICAgICAgdGFyZ2V0OiAnL2hvbWUvcnVubmVyL2pvYi1jb21wbGV0ZWQtaG9vay5zaCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzb3VyY2U6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAncHJvdmlkZXJzJywgJ2pvYi1yZXBvcnRlci5wczEnKSxcbiAgICAgICAgICAgICAgdGFyZ2V0OiAnL2FjdGlvbnMvam9iLXJlcG9ydGVyLnBzMScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBzb3VyY2U6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAncHJvdmlkZXJzJywgJ2pvYi1zdGFydGVkLWhvb2sucHMxJyksXG4gICAgICAgICAgICAgIHRhcmdldDogJy9hY3Rpb25zL2pvYi1zdGFydGVkLWhvb2sucHMxJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHNvdXJjZTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Fzc2V0cycsICdwcm92aWRlcnMnLCAnam9iLWNvbXBsZXRlZC1ob29rLnBzMScpLFxuICAgICAgICAgICAgICB0YXJnZXQ6ICcvYWN0aW9ucy9qb2ItY29tcGxldGVkLWhvb2sucHMxJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG5cbiAgICAgIGdldENvbW1hbmRzKG9zOiBPcywgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpIHtcbiAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpIHx8IG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9BTUFaT05fVkVSU0lPTlMpKSB7XG4gICAgICAgICAgbGV0IHZlcnNpb25Db21tYW5kOiBzdHJpbmc7XG4gICAgICAgICAgaWYgKHJ1bm5lclZlcnNpb24uaXMoUnVubmVyVmVyc2lvbi5sYXRlc3QoKSkpIHtcbiAgICAgICAgICAgIHZlcnNpb25Db21tYW5kID0gJ1JVTk5FUl9WRVJTSU9OPWBjdXJsIC0tcmV0cnkgNSAtLXJldHJ5LWRlbGF5IDMwIC0tcmV0cnktYWxsLWVycm9ycyAtZnNTTCAtbyAvZGV2L251bGwgLXcgXCIle3VybF9lZmZlY3RpdmV9XCIgaHR0cHM6Ly9naXRodWIuY29tL2FjdGlvbnMvcnVubmVyL3JlbGVhc2VzL2xhdGVzdCB8IGdyZXAgLW9FIFwiW14vdl0rJFwiYCc7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZlcnNpb25Db21tYW5kID0gYFJVTk5FUl9WRVJTSU9OPScke3J1bm5lclZlcnNpb24udmVyc2lvbn0nYDtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBsZXQgYXJjaFVybDtcbiAgICAgICAgICBpZiAoYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgICAgICBhcmNoVXJsID0gJ3g2NCc7XG4gICAgICAgICAgfSBlbHNlIGlmIChhcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgICAgICAgYXJjaFVybCA9ICdhcm02NCc7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIGZvciBHaXRIdWIgUnVubmVyOiAke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGxldCBjb21tYW5kcyA9IFtcbiAgICAgICAgICAgIHZlcnNpb25Db21tYW5kLFxuICAgICAgICAgICAgYGN1cmwgLS1yZXRyeSA1IC0tcmV0cnktZGVsYXkgMzAgLS1yZXRyeS1hbGwtZXJyb3JzIC1mc1NMTyBcImh0dHBzOi8vZ2l0aHViLmNvbS9hY3Rpb25zL3J1bm5lci9yZWxlYXNlcy9kb3dubG9hZC92XFwke1JVTk5FUl9WRVJTSU9OfS9hY3Rpb25zLXJ1bm5lci1saW51eC0ke2FyY2hVcmx9LVxcJHtSVU5ORVJfVkVSU0lPTn0udGFyLmd6XCJgLFxuICAgICAgICAgICAgYHRhciAtQyAvaG9tZS9ydW5uZXIgLXh6ZiBcImFjdGlvbnMtcnVubmVyLWxpbnV4LSR7YXJjaFVybH0tXFwke1JVTk5FUl9WRVJTSU9OfS50YXIuZ3pcImAsXG4gICAgICAgICAgICBgcm0gYWN0aW9ucy1ydW5uZXItbGludXgtJHthcmNoVXJsfS1cXCR7UlVOTkVSX1ZFUlNJT059LnRhci5nemAsXG4gICAgICAgICAgICBgZWNobyAtbiAke3J1bm5lclZlcnNpb24udmVyc2lvbn0gPiAvaG9tZS9ydW5uZXIvUlVOTkVSX1ZFUlNJT05gLFxuICAgICAgICAgICAgJ2NobW9kICt4IC9ob21lL3J1bm5lci9qb2ItcmVwb3J0ZXIuc2gnLFxuICAgICAgICAgICAgJ2NobW9kICt4IC9ob21lL3J1bm5lci9qb2Itc3RhcnRlZC1ob29rLnNoJyxcbiAgICAgICAgICAgICdjaG1vZCAreCAvaG9tZS9ydW5uZXIvam9iLWNvbXBsZXRlZC1ob29rLnNoJyxcbiAgICAgICAgICAgICdlY2hvIEFDVElPTlNfUlVOTkVSX0hPT0tfSk9CX1NUQVJURUQ9L2hvbWUvcnVubmVyL2pvYi1zdGFydGVkLWhvb2suc2ggPj4gL2hvbWUvcnVubmVyLy5lbnYnLFxuICAgICAgICAgICAgJ2VjaG8gQUNUSU9OU19SVU5ORVJfSE9PS19KT0JfQ09NUExFVEVEPS9ob21lL3J1bm5lci9qb2ItY29tcGxldGVkLWhvb2suc2ggPj4gL2hvbWUvcnVubmVyLy5lbnYnLFxuICAgICAgICAgICAgJ2Nob3duIHJ1bm5lciAvaG9tZS9ydW5uZXIvLmVudicsIC8vIGVudi5zaCBtb2RpZmllcyAuZW52XG4gICAgICAgICAgICAndG91Y2ggL2hvbWUvcnVubmVyLy53b3JrZmxvd2lkICYmIGNob3duIHJ1bm5lciAvaG9tZS9ydW5uZXIvLndvcmtmbG93aWQnLFxuICAgICAgICAgIF07XG5cbiAgICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICAgIGNvbW1hbmRzLnB1c2goJy9ob21lL3J1bm5lci9iaW4vaW5zdGFsbGRlcGVuZGVuY2llcy5zaCcpO1xuICAgICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIpKSB7XG4gICAgICAgICAgICBjb21tYW5kcy5wdXNoKCd5dW0gaW5zdGFsbCAteSBvcGVuc3NsLWxpYnMga3JiNS1saWJzIHpsaWIgbGliaWN1NjAnKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLkxJTlVYX0FNQVpPTl8yMDIzKSkge1xuICAgICAgICAgICAgY29tbWFuZHMucHVzaCgnZG5mIGluc3RhbGwgLXkgb3BlbnNzbC1saWJzIGtyYjUtbGlicyB6bGliIGxpYmljdS02Ny4xJyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29tbWFuZHMucHVzaCgnbWtkaXIgLXAgL29wdC9ob3N0ZWR0b29sY2FjaGUnLCAnY2hvd24gcnVubmVyIC9vcHQvaG9zdGVkdG9vbGNhY2hlJyk7XG5cbiAgICAgICAgICByZXR1cm4gY29tbWFuZHM7XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICBsZXQgcnVubmVyQ29tbWFuZHM6IHN0cmluZ1tdO1xuICAgICAgICAgIGlmIChydW5uZXJWZXJzaW9uLmlzKFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkpKSB7XG4gICAgICAgICAgICBydW5uZXJDb21tYW5kcyA9IFtcbiAgICAgICAgICAgICAgJ2NtZCAvYyBjdXJsIC0tcmV0cnkgNSAtLXJldHJ5LWRlbGF5IDMwIC1mc1NMIC1vIE5VTCAtdyBcIiV7dXJsX2VmZmVjdGl2ZX1cIiBodHRwczovL2dpdGh1Yi5jb20vYWN0aW9ucy9ydW5uZXIvcmVsZWFzZXMvbGF0ZXN0ID4gJEVudjpURU1QXFxcXGxhdGVzdC1naGEnLFxuICAgICAgICAgICAgICAnJExhdGVzdFVybCA9IEdldC1Db250ZW50ICRFbnY6VEVNUFxcXFxsYXRlc3QtZ2hhJyxcbiAgICAgICAgICAgICAgJyRSVU5ORVJfVkVSU0lPTiA9ICgkTGF0ZXN0VXJsIC1TcGxpdCBcXCcvXFwnKVstMV0uc3Vic3RyaW5nKDEpJyxcbiAgICAgICAgICAgIF07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJ1bm5lckNvbW1hbmRzID0gW2AkUlVOTkVSX1ZFUlNJT04gPSAnJHtydW5uZXJWZXJzaW9uLnZlcnNpb259J2BdO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJ1bm5lckNvbW1hbmRzID0gcnVubmVyQ29tbWFuZHMuY29uY2F0KFtcbiAgICAgICAgICAgIC8vIGNyZWF0ZSBkaXJlY3Rvcmllc1xuICAgICAgICAgICAgJ21rZGlyIEM6XFxcXGhvc3RlZHRvb2xjYWNoZVxcXFx3aW5kb3dzJyxcbiAgICAgICAgICAgICdta2RpciBDOlxcXFx0b29scycsXG4gICAgICAgICAgICAvLyBkb3dubG9hZCB6c3RkIGFuZCBleHRyYWN0IHRvIEM6XFx0b29sc1xuICAgICAgICAgICAgJ2NtZCAvYyBjdXJsIC0tcmV0cnkgNSAtLXJldHJ5LWRlbGF5IDMwIC1mc1NMIC1vIE5VTCAtdyBcIiV7dXJsX2VmZmVjdGl2ZX1cIiBodHRwczovL2dpdGh1Yi5jb20vbWV0YS96c3RkL3JlbGVhc2VzL2xhdGVzdCA+ICRFbnY6VEVNUFxcXFxsYXRlc3QtenN0ZCcsXG4gICAgICAgICAgICAnJExhdGVzdFVybCA9IEdldC1Db250ZW50ICRFbnY6VEVNUFxcXFxsYXRlc3QtenN0ZCcsXG4gICAgICAgICAgICAnJFpTVERfVkVSU0lPTiA9ICgkTGF0ZXN0VXJsIC1TcGxpdCBcXCcvXFwnKVstMV0uc3Vic3RyaW5nKDEpJyxcbiAgICAgICAgICAgICdJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgXCJodHRwczovL2dpdGh1Yi5jb20vbWV0YS96c3RkL3JlbGVhc2VzL2Rvd25sb2FkL3YkWlNURF9WRVJTSU9OL3pzdGQtdiRaU1REX1ZFUlNJT04td2luNjQuemlwXCIgLU91dEZpbGUgenN0ZC56aXAnLFxuICAgICAgICAgICAgJ0V4cGFuZC1BcmNoaXZlIHpzdGQuemlwIC1EZXN0aW5hdGlvblBhdGggQzpcXFxcdG9vbHMnLFxuICAgICAgICAgICAgJ01vdmUtSXRlbSAtUGF0aCBDOlxcXFx0b29sc1xcXFx6c3RkLXYkWlNURF9WRVJTSU9OLXdpbjY0XFxcXHpzdGQuZXhlIEM6XFxcXHRvb2xzJyxcbiAgICAgICAgICAgICdSZW1vdmUtSXRlbSAtTGl0ZXJhbFBhdGggXCJDOlxcXFx0b29sc1xcXFx6c3RkLXYkWlNURF9WRVJTSU9OLXdpbjY0XCIgLUZvcmNlIC1SZWN1cnNlJyxcbiAgICAgICAgICAgICdkZWwgenN0ZC56aXAnLFxuICAgICAgICAgICAgLy8gYWRkIEM6XFx0b29scyB0byBQQVRIXG4gICAgICAgICAgICAnJHBlcnNpc3RlZFBhdGhzID0gW0Vudmlyb25tZW50XTo6R2V0RW52aXJvbm1lbnRWYXJpYWJsZShcXCdQYXRoXFwnLCBbRW52aXJvbm1lbnRWYXJpYWJsZVRhcmdldF06Ok1hY2hpbmUpJyxcbiAgICAgICAgICAgICdbRW52aXJvbm1lbnRdOjpTZXRFbnZpcm9ubWVudFZhcmlhYmxlKFwiUEFUSFwiLCAkcGVyc2lzdGVkUGF0aHMgKyBcIjtDOlxcXFx0b29sc1wiLCBbRW52aXJvbm1lbnRWYXJpYWJsZVRhcmdldF06Ok1hY2hpbmUpJyxcbiAgICAgICAgICAgIC8vIHNldHVwIGhvb2tzXG4gICAgICAgICAgICBcIkFkZC1Db250ZW50IC1QYXRoIEM6XFxcXGFjdGlvbnNcXFxcLmVudiAtVmFsdWUgJ0FDVElPTlNfUlVOTkVSX0hPT0tfSk9CX1NUQVJURUQ9QzpcXFxcYWN0aW9uc1xcXFxqb2Itc3RhcnRlZC1ob29rLnBzMSdcIixcbiAgICAgICAgICAgIFwiQWRkLUNvbnRlbnQgLVBhdGggQzpcXFxcYWN0aW9uc1xcXFwuZW52IC1WYWx1ZSAnQUNUSU9OU19SVU5ORVJfSE9PS19KT0JfQ09NUExFVEVEPUM6XFxcXGFjdGlvbnNcXFxcam9iLWNvbXBsZXRlZC1ob29rLnBzMSdcIixcbiAgICAgICAgICAgIFwiU2V0LUNvbnRlbnQgLVBhdGggQzpcXFxcYWN0aW9uc1xcXFwud29ya2Zsb3dpZCAtVmFsdWUgJycgLU5vTmV3bGluZVwiLFxuICAgICAgICAgIF0pO1xuXG4gICAgICAgICAgcmV0dXJuIHJ1bm5lckNvbW1hbmRzLmNvbmNhdChbXG4gICAgICAgICAgICAnSW52b2tlLVdlYlJlcXVlc3QgLVVzZUJhc2ljUGFyc2luZyAtVXJpIFwiaHR0cHM6Ly9naXRodWIuY29tL2FjdGlvbnMvcnVubmVyL3JlbGVhc2VzL2Rvd25sb2FkL3Yke1JVTk5FUl9WRVJTSU9OfS9hY3Rpb25zLXJ1bm5lci13aW4teDY0LSR7UlVOTkVSX1ZFUlNJT059LnppcFwiIC1PdXRGaWxlIGFjdGlvbnMuemlwJyxcbiAgICAgICAgICAgICdFeHBhbmQtQXJjaGl2ZSBhY3Rpb25zLnppcCAtRGVzdGluYXRpb25QYXRoIEM6XFxcXGFjdGlvbnMnLFxuICAgICAgICAgICAgJ2RlbCBhY3Rpb25zLnppcCcsXG4gICAgICAgICAgICBgZWNobyAke3J1bm5lclZlcnNpb24udmVyc2lvbn0gfCBPdXQtRmlsZSAtRW5jb2RpbmcgQVNDSUkgLU5vTmV3bGluZSBDOlxcXFxhY3Rpb25zXFxcXFJVTk5FUl9WRVJTSU9OYCxcbiAgICAgICAgICBdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcy9hcmNoaXRlY3R1cmUgY29tYm8gZm9yIGdpdGh1YiBydW5uZXI6ICR7b3MubmFtZX0vJHthcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICAgIH1cblxuICAgICAgZ2V0RG9ja2VyQ29tbWFuZHMoX29zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogc3RyaW5nW10ge1xuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgIGBFTlYgUlVOTkVSX1ZFUlNJT049JHtydW5uZXJWZXJzaW9uLnZlcnNpb259YCxcbiAgICAgICAgXTtcbiAgICAgIH1cbiAgICB9KCk7XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gaW5zdGFsbCBEb2NrZXIuXG4gICAqXG4gICAqIE9uIFdpbmRvd3MgdGhpcyBzZXRzIHVwIGRvY2tlcmQgZm9yIFdpbmRvd3MgY29udGFpbmVycyB3aXRob3V0IERvY2tlciBEZXNrdG9wLiBJZiB5b3UgbmVlZCBMaW51eCBjb250YWluZXJzIG9uIFdpbmRvd3MsIHlvdSdsbCBuZWVkIHRvIGluc3RhbGwgRG9ja2VyIERlc2t0b3Agd2hpY2ggZG9lc24ndCBzZWVtIHRvIHBsYXkgd2VsbCB3aXRoIHNlcnZlcnMgKFBScyB3ZWxjb21lKS5cbiAgICpcbiAgICogQHBhcmFtIHZlcnNpb24gU29mdHdhcmUgdmVyc2lvbiB0byBpbnN0YWxsIChlLmcuICcyOS4xLjUnKS4gRGVmYXVsdDogbGF0ZXN0LiBPbmx5IHVzZWQgb24gV2luZG93czsgb24gTGludXggKFVidW50dSwgQW1hem9uIExpbnV4IDIgYW5kIEFtYXpvbiBMaW51eCAyMDIzKSB0aGUgcGFja2FnZSB2ZXJzaW9uIGZvcm1hdCBpcyBub3QgcmVsaWFibHkgcHJlZGljdGFibGUgc28gbGF0ZXN0IGlzIGFsd2F5cyB1c2VkLlxuICAgKi9cbiAgc3RhdGljIGRvY2tlcih2ZXJzaW9uPzogc3RyaW5nKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIGNvbnN0IHVzZVZlcnNpb24gPSB2YWxpZGF0ZVZlcnNpb24odmVyc2lvbik7XG4gICAgcmV0dXJuIG5ldyBjbGFzcyBleHRlbmRzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAgIG5hbWUgPSAnRG9ja2VyJztcblxuICAgICAgZ2V0Q29tbWFuZHMob3M6IE9zLCBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICBpZiAodXNlVmVyc2lvbikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAnUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyKHZlcnNpb24pOiB2ZXJzaW9uIGlzIG9ubHkgdXNlZCBvbiBXaW5kb3dzLiBPbiBVYnVudHUgdGhlIGFwdCBwYWNrYWdlIHZlcnNpb24gZm9ybWF0IGlzIG5vdCByZWxpYWJseSBwcmVkaWN0YWJsZTsgdXNlIGxhdGVzdCAob21pdCB2ZXJzaW9uKSBmb3IgVWJ1bnR1IGltYWdlcy4nLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdjdXJsIC0tcmV0cnkgNSAtLXJldHJ5LWRlbGF5IDMwIC0tcmV0cnktYWxsLWVycm9ycyAtZnNTTCBodHRwczovL2Rvd25sb2FkLmRvY2tlci5jb20vbGludXgvdWJ1bnR1L2dwZyB8IHN1ZG8gZ3BnIC0tZGVhcm1vciAtbyAvdXNyL3NoYXJlL2tleXJpbmdzL2RvY2tlci5ncGcnLFxuICAgICAgICAgICAgJ2VjaG8gJyArXG4gICAgICAgICAgICAnICBcImRlYiBbYXJjaD0kKGRwa2cgLS1wcmludC1hcmNoaXRlY3R1cmUpIHNpZ25lZC1ieT0vdXNyL3NoYXJlL2tleXJpbmdzL2RvY2tlci5ncGddIGh0dHBzOi8vZG93bmxvYWQuZG9ja2VyLmNvbS9saW51eC91YnVudHUgJyArXG4gICAgICAgICAgICAnICAkKGxzYl9yZWxlYXNlIC1jcykgc3RhYmxlXCIgfCBzdWRvIHRlZSAvZXRjL2FwdC9zb3VyY2VzLmxpc3QuZC9kb2NrZXIubGlzdCA+IC9kZXYvbnVsbCcsXG4gICAgICAgICAgICAnYXB0LWdldCAtbyBBY3F1aXJlOjpSZXRyaWVzPTUgdXBkYXRlJyxcbiAgICAgICAgICAgICdERUJJQU5fRlJPTlRFTkQ9bm9uaW50ZXJhY3RpdmUgYXB0LWdldCAtbyBBY3F1aXJlOjpSZXRyaWVzPTUgaW5zdGFsbCAteSBkb2NrZXItY2UgZG9ja2VyLWNlLWNsaSBjb250YWluZXJkLmlvIGRvY2tlci1jb21wb3NlLXBsdWdpbicsXG4gICAgICAgICAgICAndXNlcm1vZCAtYUcgZG9ja2VyIHJ1bm5lcicsXG4gICAgICAgICAgICAnbG4gLXMgL3Vzci9saWJleGVjL2RvY2tlci9jbGktcGx1Z2lucy9kb2NrZXItY29tcG9zZSAvdXNyL2Jpbi9kb2NrZXItY29tcG9zZScsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMikpIHtcbiAgICAgICAgICBpZiAodXNlVmVyc2lvbikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgICAnUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyKHZlcnNpb24pOiB2ZXJzaW9uIGlzIG9ubHkgdXNlZCBvbiBXaW5kb3dzLiBPbiBBbWF6b24gTGludXggdGhlIHBhY2thZ2UgdmVyc2lvbiBpcyBub3QgcHJlZGljdGFibGU7IHVzZSBsYXRlc3QgKG9taXQgdmVyc2lvbikgZm9yIEFtYXpvbiBMaW51eCBpbWFnZXMuJyxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnYW1hem9uLWxpbnV4LWV4dHJhcyBpbnN0YWxsIGRvY2tlcicsXG4gICAgICAgICAgICAndXNlcm1vZCAtYSAtRyBkb2NrZXIgcnVubmVyJyxcbiAgICAgICAgICAgICdjdXJsIC0tcmV0cnkgNSAtLXJldHJ5LWRlbGF5IDMwIC0tcmV0cnktYWxsLWVycm9ycyAtc2ZMbyAvdXNyL2Jpbi9kb2NrZXItY29tcG9zZSBodHRwczovL2dpdGh1Yi5jb20vZG9ja2VyL2NvbXBvc2UvcmVsZWFzZXMvbGF0ZXN0L2Rvd25sb2FkL2RvY2tlci1jb21wb3NlLSQodW5hbWUgLXMgfCB0ciBcXCdbOnVwcGVyOl1cXCcgXFwnWzpsb3dlcjpdXFwnKS0kKHVuYW1lIC1tKScsXG4gICAgICAgICAgICAnY2htb2QgK3ggL3Vzci9iaW4vZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgICAgICAgJ2xuIC1zIC91c3IvYmluL2RvY2tlci1jb21wb3NlIC91c3IvbGliZXhlYy9kb2NrZXIvY2xpLXBsdWdpbnMvZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIwMjMpKSB7XG4gICAgICAgICAgaWYgKHVzZVZlcnNpb24pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgJ1J1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcih2ZXJzaW9uKTogdmVyc2lvbiBpcyBvbmx5IHVzZWQgb24gV2luZG93cy4gT24gQW1hem9uIExpbnV4IHRoZSBwYWNrYWdlIHZlcnNpb24gaXMgbm90IHByZWRpY3RhYmxlOyB1c2UgbGF0ZXN0IChvbWl0IHZlcnNpb24pIGZvciBBbWF6b24gTGludXggaW1hZ2VzLicsXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2RuZiBpbnN0YWxsIC15IGRvY2tlcicsXG4gICAgICAgICAgICAndXNlcm1vZCAtYSAtRyBkb2NrZXIgcnVubmVyJyxcbiAgICAgICAgICAgICdjdXJsIC0tcmV0cnkgNSAtLXJldHJ5LWRlbGF5IDMwIC0tcmV0cnktYWxsLWVycm9ycyAtc2ZMbyAvdXNyL2Jpbi9kb2NrZXItY29tcG9zZSBodHRwczovL2dpdGh1Yi5jb20vZG9ja2VyL2NvbXBvc2UvcmVsZWFzZXMvbGF0ZXN0L2Rvd25sb2FkL2RvY2tlci1jb21wb3NlLSQodW5hbWUgLXMgfCB0ciBcXCdbOnVwcGVyOl1cXCcgXFwnWzpsb3dlcjpdXFwnKS0kKHVuYW1lIC1tKScsXG4gICAgICAgICAgICAnY2htb2QgK3ggL3Vzci9iaW4vZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgICAgICAgJ2xuIC1zIC91c3IvYmluL2RvY2tlci1jb21wb3NlIC91c3IvbGliZXhlYy9kb2NrZXIvY2xpLXBsdWdpbnMvZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICBjb25zdCBkb3dubG9hZENvbW1hbmRzID0gdXNlVmVyc2lvbiA/IFtcbiAgICAgICAgICAgIGBJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgXCJodHRwczovL2Rvd25sb2FkLmRvY2tlci5jb20vd2luL3N0YXRpYy9zdGFibGUveDg2XzY0L2RvY2tlci0ke3VzZVZlcnNpb259LnppcFwiIC1PdXRGaWxlIGRvY2tlci56aXBgLFxuICAgICAgICAgIF0gOiBbXG4gICAgICAgICAgICAnJEJhc2VVcmwgPSBcImh0dHBzOi8vZG93bmxvYWQuZG9ja2VyLmNvbS93aW4vc3RhdGljL3N0YWJsZS94ODZfNjQvXCInLFxuICAgICAgICAgICAgJyRodG1sID0gSW52b2tlLVdlYlJlcXVlc3QgLVVzZUJhc2ljUGFyc2luZyAtVXJpICRCYXNlVXJsJyxcbiAgICAgICAgICAgICckZmlsZXMgPSAkaHRtbC5MaW5rcy5ocmVmIHwgV2hlcmUtT2JqZWN0IHsgJF8gLW1hdGNoIFxcJ15kb2NrZXItWzAtOVxcXFwuXStcXFxcLnppcCRcXCcgfScsXG4gICAgICAgICAgICAnaWYgKC1ub3QgJGZpbGVzKSB7IFdyaXRlLUVycm9yIFwiTm8gZG9ja2VyLSouemlwIGZpbGVzIGZvdW5kLlwiIDsgZXhpdCAxIH0nLFxuICAgICAgICAgICAgJyRsYXRlc3QgPSAkZmlsZXMgfCBTb3J0LU9iamVjdCB7IHRyeSB7IFtWZXJzaW9uXSgkXyAtcmVwbGFjZSBcXCdeZG9ja2VyLXxcXFxcLnppcCRcXCcpIH0gY2F0Y2ggeyBbVmVyc2lvbl1cIjAuMC4wXCIgfSB9IC1EZXNjZW5kaW5nIHwgU2VsZWN0LU9iamVjdCAtRmlyc3QgMScsXG4gICAgICAgICAgICAnSW52b2tlLVdlYlJlcXVlc3QgLVVzZUJhc2ljUGFyc2luZyAtVXJpICRCYXNlVXJsJGxhdGVzdCAtT3V0RmlsZSBkb2NrZXIuemlwJyxcbiAgICAgICAgICBdO1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAvLyBkb3dubG9hZCBzdGF0aWMgYmluYXJpZXNcbiAgICAgICAgICAgIC4uLmRvd25sb2FkQ29tbWFuZHMsXG4gICAgICAgICAgICAvLyBleHRyYWN0IHRvIEM6XFxQcm9ncmFtIEZpbGVzXFxEb2NrZXJcbiAgICAgICAgICAgICdFeHBhbmQtQXJjaGl2ZSBkb2NrZXIuemlwIC1EZXN0aW5hdGlvblBhdGggXCIkRW52OlByb2dyYW1GaWxlc1wiJyxcbiAgICAgICAgICAgICdkZWwgZG9ja2VyLnppcCcsXG4gICAgICAgICAgICAvLyBhZGQgdG8gcGF0aFxuICAgICAgICAgICAgJyRwZXJzaXN0ZWRQYXRocyA9IFtFbnZpcm9ubWVudF06OkdldEVudmlyb25tZW50VmFyaWFibGUoXFwnUGF0aFxcJywgW0Vudmlyb25tZW50VmFyaWFibGVUYXJnZXRdOjpNYWNoaW5lKScsXG4gICAgICAgICAgICAnW0Vudmlyb25tZW50XTo6U2V0RW52aXJvbm1lbnRWYXJpYWJsZShcIlBBVEhcIiwgJHBlcnNpc3RlZFBhdGhzICsgXCI7JEVudjpQcm9ncmFtRmlsZXNcXFxcRG9ja2VyXCIsIFtFbnZpcm9ubWVudFZhcmlhYmxlVGFyZ2V0XTo6TWFjaGluZSknLFxuICAgICAgICAgICAgJyRlbnY6UEFUSCA9ICRlbnY6UEFUSCArIFwiOyRFbnY6UHJvZ3JhbUZpbGVzXFxcXERvY2tlclwiJyxcbiAgICAgICAgICAgIC8vIHJlZ2lzdGVyIGRvY2tlciBzZXJ2aWNlXG4gICAgICAgICAgICAnZG9ja2VyZCAtLXJlZ2lzdGVyLXNlcnZpY2UnLFxuICAgICAgICAgICAgJ2lmICgkTEFTVEVYSVRDT0RFIC1uZSAwKSB7IHRocm93IFwiRXhpdCBjb2RlIGlzICRMQVNURVhJVENPREVcIiB9JyxcbiAgICAgICAgICAgIC8vIGVuYWJsZSBjb250YWluZXJzIGZlYXR1cmVcbiAgICAgICAgICAgICdFbmFibGUtV2luZG93c09wdGlvbmFsRmVhdHVyZSAtT25saW5lIC1GZWF0dXJlTmFtZSBjb250YWluZXJzIC1BbGwgLU5vUmVzdGFydCcsXG4gICAgICAgICAgICAvLyBpbnN0YWxsIGRvY2tlci1jb21wb3NlXG4gICAgICAgICAgICAnY21kIC9jIGN1cmwgLS1yZXRyeSA1IC0tcmV0cnktZGVsYXkgMzAgLWZzU0wgLW8gTlVMIC13IFwiJXt1cmxfZWZmZWN0aXZlfVwiIGh0dHBzOi8vZ2l0aHViLmNvbS9kb2NrZXIvY29tcG9zZS9yZWxlYXNlcy9sYXRlc3QgPiAkRW52OlRFTVBcXFxcbGF0ZXN0LWRvY2tlci1jb21wb3NlJyxcbiAgICAgICAgICAgICckTGF0ZXN0VXJsID0gR2V0LUNvbnRlbnQgJEVudjpURU1QXFxcXGxhdGVzdC1kb2NrZXItY29tcG9zZScsXG4gICAgICAgICAgICAnJExhdGVzdERvY2tlckNvbXBvc2UgPSAoJExhdGVzdFVybCAtU3BsaXQgXFwnL1xcJylbLTFdJyxcbiAgICAgICAgICAgICdJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgIFwiaHR0cHM6Ly9naXRodWIuY29tL2RvY2tlci9jb21wb3NlL3JlbGVhc2VzL2Rvd25sb2FkLyR7TGF0ZXN0RG9ja2VyQ29tcG9zZX0vZG9ja2VyLWNvbXBvc2UtV2luZG93cy14ODZfNjQuZXhlXCIgLU91dEZpbGUgJEVudjpQcm9ncmFtRmlsZXNcXFxcRG9ja2VyXFxcXGRvY2tlci1jb21wb3NlLmV4ZScsXG4gICAgICAgICAgICAnTmV3LUl0ZW0gLUl0ZW1UeXBlIGRpcmVjdG9yeSAtUGF0aCBcIiRFbnY6UHJvZ3JhbUZpbGVzXFxcXERvY2tlclxcXFxjbGktcGx1Z2luc1wiJyxcbiAgICAgICAgICAgICdDb3B5LUl0ZW0gLVBhdGggXCIkRW52OlByb2dyYW1GaWxlc1xcXFxEb2NrZXJcXFxcZG9ja2VyLWNvbXBvc2UuZXhlXCIgLURlc3RpbmF0aW9uIFwiJEVudjpQcm9ncmFtRmlsZXNcXFxcRG9ja2VyXFxcXGNsaS1wbHVnaW5zXFxcXGRvY2tlci1jb21wb3NlLmV4ZVwiJyxcbiAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9zL2FyY2hpdGVjdHVyZSBjb21ibyBmb3IgZG9ja2VyOiAke29zLm5hbWV9LyR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgICB9XG5cbiAgICAgIHNob3VsZFJlYm9vdChvczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IGJvb2xlYW4ge1xuICAgICAgICByZXR1cm4gb3MuaXMoT3MuV0lORE9XUyk7XG4gICAgICB9XG4gICAgfSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY29tcG9uZW50IHRvIGluc3RhbGwgRG9ja2VyLWluLURvY2tlci5cbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGBkb2NrZXIoKWBcbiAgICogQHBhcmFtIHZlcnNpb24gU29mdHdhcmUgdmVyc2lvbiB0byBpbnN0YWxsIChlLmcuICcyOS4xLjUnKS4gRGVmYXVsdDogbGF0ZXN0LlxuICAgKi9cbiAgc3RhdGljIGRvY2tlckluRG9ja2VyKHZlcnNpb24/OiBzdHJpbmcpOiBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgcmV0dXJuIFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcih2ZXJzaW9uKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGNvbXBvbmVudCB0byBhZGQgYSB0cnVzdGVkIGNlcnRpZmljYXRlIGF1dGhvcml0eS4gVGhpcyBjYW4gYmUgdXNlZCB0byBzdXBwb3J0IEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlciB3aXRoIHNlbGYtc2lnbmVkIGNlcnRpZmljYXRlLlxuICAgKlxuICAgKiBAcGFyYW0gc291cmNlIHBhdGggdG8gY2VydGlmaWNhdGUgZmlsZSBpbiBQRU0gZm9ybWF0LCBvciBhIGRpcmVjdG9yeSBjb250YWluaW5nIGNlcnRpZmljYXRlIGZpbGVzICgucGVtIG9yIC5jcnQpXG4gICAqIEBwYXJhbSBuYW1lIHVuaXF1ZSBjZXJ0aWZpY2F0ZSBuYW1lIHRvIGJlIHVzZWQgb24gcnVubmVyIGZpbGUgc3lzdGVtXG4gICAqL1xuICBzdGF0aWMgZXh0cmFDZXJ0aWZpY2F0ZXMoc291cmNlOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAvLyBTYW5pdGl6ZSB0aGUgbmFtZSB0byBvbmx5IGNvbnRhaW4gYWxwaGFudW1lcmljIGNoYXJhY3RlcnMsIGRhc2hlcyBhbmQgdW5kZXJzY29yZXNcbiAgICBjb25zdCBzYW5pdGl6ZWROYW1lID0gbmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOV8tXS9nLCAnLScpO1xuXG4gICAgLy8gRGlzY292ZXIgY2VydGlmaWNhdGUgZmlsZXMgKHN1cHBvcnRzIGJvdGggZmlsZSBhbmQgZGlyZWN0b3J5KVxuICAgIGNvbnN0IGNlcnRpZmljYXRlRmlsZXMgPSBkaXNjb3ZlckNlcnRpZmljYXRlRmlsZXMoc291cmNlKTtcblxuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gYEV4dHJhLUNlcnRpZmljYXRlcy0ke3Nhbml0aXplZE5hbWV9YDtcblxuICAgICAgZ2V0Q29tbWFuZHMob3M6IE9zLCBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ3VwZGF0ZS1jYS1jZXJ0aWZpY2F0ZXMnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX0FNQVpPTl9WRVJTSU9OUykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ3VwZGF0ZS1jYS10cnVzdCcsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIGNvbnN0IGNvbW1hbmRzOiBzdHJpbmdbXSA9IFtdO1xuICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY2VydGlmaWNhdGVGaWxlcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgY2VydE5hbWUgPSBgJHtzYW5pdGl6ZWROYW1lfS0ke2l9YDtcbiAgICAgICAgICAgIGNvbW1hbmRzLnB1c2goXG4gICAgICAgICAgICAgIGBJbXBvcnQtQ2VydGlmaWNhdGUgLUZpbGVQYXRoIEM6XFxcXCR7Y2VydE5hbWV9LmNydCAtQ2VydFN0b3JlTG9jYXRpb24gQ2VydDpcXFxcTG9jYWxNYWNoaW5lXFxcXFJvb3RgLFxuICAgICAgICAgICAgICBgUmVtb3ZlLUl0ZW0gQzpcXFxcJHtjZXJ0TmFtZX0uY3J0YCxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBjb21tYW5kcztcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcy9hcmNoaXRlY3R1cmUgY29tYm8gZm9yIGV4dHJhIGNlcnRpZmljYXRlczogJHtvcy5uYW1lfS8ke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgICAgfVxuXG4gICAgICBnZXRBc3NldHMob3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpOiBSdW5uZXJJbWFnZUFzc2V0W10ge1xuICAgICAgICBjb25zdCBhc3NldHM6IFJ1bm5lckltYWdlQXNzZXRbXSA9IFtdO1xuXG4gICAgICAgIGxldCB0YXJnZXREaXI6IHN0cmluZztcbiAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpKSB7XG4gICAgICAgICAgdGFyZ2V0RGlyID0gJy91c3IvbG9jYWwvc2hhcmUvY2EtY2VydGlmaWNhdGVzLyc7XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX0FNQVpPTl9WRVJTSU9OUykpIHtcbiAgICAgICAgICB0YXJnZXREaXIgPSAnL2V0Yy9wa2kvY2EtdHJ1c3Qvc291cmNlL2FuY2hvcnMvJztcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIHRhcmdldERpciA9ICdDOlxcXFwnO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgT1MgZm9yIGV4dHJhIGNlcnRpZmljYXRlczogJHtvcy5uYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjZXJ0aWZpY2F0ZUZpbGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgY29uc3QgY2VydE5hbWUgPSBgJHtzYW5pdGl6ZWROYW1lfS0ke2l9YDtcbiAgICAgICAgICBhc3NldHMucHVzaCh7XG4gICAgICAgICAgICBzb3VyY2U6IGNlcnRpZmljYXRlRmlsZXNbaV0sXG4gICAgICAgICAgICB0YXJnZXQ6IGAke3RhcmdldERpcn0ke2NlcnROYW1lfS5jcnRgLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIGFzc2V0cztcbiAgICAgIH1cbiAgICB9KCk7XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gc2V0IHVwIHRoZSByZXF1aXJlZCBMYW1iZGEgZW50cnlwb2ludCBmb3IgTGFtYmRhIHJ1bm5lcnMuXG4gICAqL1xuICBzdGF0aWMgbGFtYmRhRW50cnlwb2ludCgpOiBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgcmV0dXJuIG5ldyBjbGFzcyBleHRlbmRzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAgIG5hbWUgPSAnTGFtYmRhLUVudHJ5cG9pbnQnO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICBpZiAoIW9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIE9TIGZvciBMYW1iZGEgZW50cnlwb2ludDogJHtvcy5uYW1lfWApO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgfVxuXG4gICAgICBnZXRBc3NldHMoX29zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogUnVubmVySW1hZ2VBc3NldFtdIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzb3VyY2U6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAncHJvdmlkZXJzJywgJ2xhbWJkYS1ib290c3RyYXAuc2gnKSxcbiAgICAgICAgICAgIHRhcmdldDogJy9ib290c3RyYXAuc2gnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc291cmNlOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnYXNzZXRzJywgJ3Byb3ZpZGVycycsICdsYW1iZGEtcnVubmVyLnNoJyksXG4gICAgICAgICAgICB0YXJnZXQ6ICcvcnVubmVyLnNoJyxcbiAgICAgICAgICB9LFxuICAgICAgICBdO1xuICAgICAgfVxuXG4gICAgICBnZXREb2NrZXJDb21tYW5kcyhfb3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpOiBzdHJpbmdbXSB7XG4gICAgICAgIHJldHVybiBbXG4gICAgICAgICAgJ0xBQkVMIERJU0FCTEVfU09DST0xJywgLy8gaGFja3kgd2F5IHRvIGRpc2FibGUgc29jaSB2MiBpbmRleGluZyBvbiBsYW1iZGEgYXMgbGFtYmRhIHdpbGwgZmFpbCB0byBzdGFydCB3aXRoIGFuIGluZGV4XG4gICAgICAgICAgJ0VOVFJZUE9JTlQgW1wiYmFzaFwiLCBcIi9ib290c3RyYXAuc2hcIl0nLFxuICAgICAgICBdO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gYWRkIGVudmlyb25tZW50IHZhcmlhYmxlcyBmb3Igam9icyB0aGUgcnVubmVyIGV4ZWN1dGVzLlxuICAgKlxuICAgKiBUaGVzZSB2YXJpYWJsZXMgb25seSBhZmZlY3QgdGhlIGpvYnMgcmFuIGJ5IHRoZSBydW5uZXIuIFRoZXkgYXJlIG5vdCBnbG9iYWwuIFRoZXkgZG8gbm90IGFmZmVjdCBvdGhlciBjb21wb25lbnRzLlxuICAgKlxuICAgKiBJdCBpcyBub3QgcmVjb21tZW5kZWQgdG8gdXNlIHRoaXMgY29tcG9uZW50IHRvIHBhc3Mgc2VjcmV0cy4gSW5zdGVhZCwgdXNlIEdpdEh1YiBTZWNyZXRzIG9yIEFXUyBTZWNyZXRzIE1hbmFnZXIuXG4gICAqXG4gICAqIE11c3QgYmUgdXNlZCBhZnRlciB0aGUge0BsaW5rIGdpdGh1YlJ1bm5lcn0gY29tcG9uZW50LlxuICAgKi9cbiAgc3RhdGljIGVudmlyb25tZW50VmFyaWFibGVzKHZhcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4pOiBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgT2JqZWN0LmVudHJpZXModmFycykuZm9yRWFjaCgoW2tleSwgdmFsdWVdKSA9PiB7XG4gICAgICBpZiAoa2V5LmluY2x1ZGVzKCdcXG4nKSB8fCB2YWx1ZS5pbmNsdWRlcygnXFxuJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBFbnZpcm9ubWVudCB2YXJpYWJsZSBjYW5ub3QgY29udGFpbiBuZXdsaW5lczogJHtrZXl9PSR7dmFsdWV9YCk7XG4gICAgICB9XG4gICAgICBpZiAoa2V5ID09ICdBQ1RJT05TX1JVTk5FUl9IT09LX0pPQl9TVEFSVEVEJyB8fCBrZXkgPT0gJ0FDVElPTlNfUlVOTkVSX0hPT0tfSk9CX0NPTVBMRVRFRCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3Qgb3ZlcnJpZGUgQUNUSU9OU19SVU5ORVJfSE9PS19KT0JfU1RBUlRFRCBvciBBQ1RJT05TX1JVTk5FUl9IT09LX0pPQl9DT01QTEVURUQuIFVzZSBSdW5uZXJJbWFnZUNvbXBvbmVudC5qb2JTdGFydGVkSG9vaygpIG9yIFJ1bm5lckltYWdlQ29tcG9uZW50LmpvYkNvbXBsZXRlZEhvb2soKSBpbnN0ZWFkLicpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmV0dXJuIG5ldyBjbGFzcyBleHRlbmRzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAgIG5hbWUgPSAnRW52aXJvbm1lbnRWYXJpYWJsZXMnO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1ZFUlNJT05TKSkge1xuICAgICAgICAgIGlmIChPYmplY3Qua2V5cyh2YXJzKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIC4uLk9iamVjdC5lbnRyaWVzKHZhcnMpLm1hcChlID0+IGBlY2hvICcke2VbMF19PSR7ZVsxXS5yZXBsYWNlKC8nL2csIFwiJ1xcXCInXFxcIidcIil9JyA+PiAvaG9tZS9ydW5uZXIvLmVudmApLFxuICAgICAgICAgICAgJ2Nob3duIHJ1bm5lciAvaG9tZS9ydW5uZXIvLmVudicsIC8vIGVudi5zaCBtb2RpZmllcyAuZW52XG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIHJldHVybiBPYmplY3QuZW50cmllcyh2YXJzKS5tYXAoZSA9PiBgQWRkLUNvbnRlbnQgLVBhdGggQzpcXFxcYWN0aW9uc1xcXFwuZW52IC1WYWx1ZSAnJHtlWzBdfT0ke2VbMV0ucmVwbGFjZSgvJy9nLCBcIicnXCIpfSdgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIE9TIGZvciBlbnZpcm9ubWVudCB2YXJpYWJsZXMgY29tcG9uZW50OiAke29zLm5hbWV9YCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY29tcG9uZW50IHRoYXQgcnVucyBhIHNjcmlwdCBiZWZvcmUgZXZlcnkgam9iIHRoZSBydW5uZXIgZXhlY3V0ZXMuXG4gICAqXG4gICAqIFBvaW50IHRoaXMgYXQgYSBsb2NhbCBzY3JpcHQgZmlsZS4gSXQgaXMgY29waWVkIGludG8gdGhlIGltYWdlLCBtYWRlIGV4ZWN1dGFibGUsIGFuZCB0aGUgcnVubmVyIGlzXG4gICAqIGNvbmZpZ3VyZWQgdG8gcnVuIGl0IGJlZm9yZSBlYWNoIGpvYiB0aHJvdWdoIHRoZVxuICAgKiBbYEFDVElPTlNfUlVOTkVSX0hPT0tfSk9CX1NUQVJURURgXShodHRwczovL2RvY3MuZ2l0aHViLmNvbS9lbi9hY3Rpb25zL2hvdy10b3MvbWFuYWdlLXJ1bm5lcnMvc2VsZi1ob3N0ZWQtcnVubmVycy9ydW4tc2NyaXB0cylcbiAgICogZW52aXJvbm1lbnQgdmFyaWFibGUuIEdpdEh1YiBwYXNzZXMgam9iIGNvbnRleHQgdG8gdGhlIHNjcmlwdCBhcyBlbnZpcm9ubWVudCB2YXJpYWJsZXMgc3VjaCBhcyBgR0lUSFVCX1JFUE9TSVRPUllgIGFuZCBgR0lUSFVCX1JVTl9JRGAuXG4gICAqXG4gICAqIE11c3QgYmUgdXNlZCBhZnRlciB0aGUge0BsaW5rIGdpdGh1YlJ1bm5lcn0gY29tcG9uZW50LlxuICAgKlxuICAgKiBAcGFyYW0gc291cmNlUGF0aCBwYXRoIHRvIGEgbG9jYWwgc2NyaXB0IGZpbGUgdG8gcnVuIGJlZm9yZSBldmVyeSBqb2JcbiAgICovXG4gIHN0YXRpYyBqb2JTdGFydGVkSG9vayhzb3VyY2VQYXRoOiBzdHJpbmcpOiBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgcmV0dXJuIFJ1bm5lckltYWdlQ29tcG9uZW50LmpvYkhvb2soJ0pvYi1TdGFydGVkLUhvb2snLCAnam9iLXN0YXJ0ZWQtaG9vay11c2VyJywgc291cmNlUGF0aCk7XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdGhhdCBydW5zIGEgc2NyaXB0IGFmdGVyIGV2ZXJ5IGpvYiB0aGUgcnVubmVyIGV4ZWN1dGVzLlxuICAgKlxuICAgKiBQb2ludCB0aGlzIGF0IGEgbG9jYWwgc2NyaXB0IGZpbGUuIEl0IGlzIGNvcGllZCBpbnRvIHRoZSBpbWFnZSwgbWFkZSBleGVjdXRhYmxlLCBhbmQgdGhlIHJ1bm5lciBpc1xuICAgKiBjb25maWd1cmVkIHRvIHJ1biBpdCBhZnRlciBlYWNoIGpvYiB0aHJvdWdoIHRoZVxuICAgKiBbYEFDVElPTlNfUlVOTkVSX0hPT0tfSk9CX0NPTVBMRVRFRGBdKGh0dHBzOi8vZG9jcy5naXRodWIuY29tL2VuL2FjdGlvbnMvaG93LXRvcy9tYW5hZ2UtcnVubmVycy9zZWxmLWhvc3RlZC1ydW5uZXJzL3J1bi1zY3JpcHRzKVxuICAgKiBlbnZpcm9ubWVudCB2YXJpYWJsZS4gR2l0SHViIHBhc3NlcyBqb2IgY29udGV4dCB0byB0aGUgc2NyaXB0IGFzIGVudmlyb25tZW50IHZhcmlhYmxlcyBzdWNoIGFzIGBHSVRIVUJfUkVQT1NJVE9SWWAgYW5kIGBHSVRIVUJfUlVOX0lEYC5cbiAgICpcbiAgICogTXVzdCBiZSB1c2VkIGFmdGVyIHRoZSB7QGxpbmsgZ2l0aHViUnVubmVyfSBjb21wb25lbnQuXG4gICAqXG4gICAqIEBwYXJhbSBzb3VyY2VQYXRoIHBhdGggdG8gYSBsb2NhbCBzY3JpcHQgZmlsZSB0byBydW4gYWZ0ZXIgZXZlcnkgam9iXG4gICAqL1xuICBzdGF0aWMgam9iQ29tcGxldGVkSG9vayhzb3VyY2VQYXRoOiBzdHJpbmcpOiBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgcmV0dXJuIFJ1bm5lckltYWdlQ29tcG9uZW50LmpvYkhvb2soJ0pvYi1Db21wbGV0ZWQtSG9vaycsICdqb2ItY29tcGxldGVkLWhvb2stdXNlcicsIHNvdXJjZVBhdGgpO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgam9iSG9vayhuYW1lOiBzdHJpbmcsIHNjcmlwdE5hbWU6IHN0cmluZywgc291cmNlUGF0aDogc3RyaW5nKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIGNvbnN0IHNjcmlwdFBhdGggPSAob3M6IE9zKTogc3RyaW5nID0+IHtcbiAgICAgIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICAgIHJldHVybiBgL2hvbWUvcnVubmVyLyR7c2NyaXB0TmFtZX0uc2hgO1xuICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICByZXR1cm4gYEM6XFxcXGFjdGlvbnNcXFxcJHtzY3JpcHROYW1lfS5wczFgO1xuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBPUyBmb3Igam9iIGhvb2sgY29tcG9uZW50OiAke29zLm5hbWV9YCk7XG4gICAgfTtcblxuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gbmFtZTtcblxuICAgICAgZ2V0QXNzZXRzKG9zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogUnVubmVySW1hZ2VBc3NldFtdIHtcbiAgICAgICAgcmV0dXJuIFt7XG4gICAgICAgICAgc291cmNlOiBzb3VyY2VQYXRoLFxuICAgICAgICAgIHRhcmdldDogc2NyaXB0UGF0aChvcyksXG4gICAgICAgIH1dO1xuICAgICAgfVxuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IHN0cmluZ1tdIHtcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gc2NyaXB0UGF0aChvcyk7XG4gICAgICAgIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIGBjaG1vZCAreCAnJHt0YXJnZXR9J2AsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIE9TIGZvciBqb2IgaG9vayBjb21wb25lbnQ6ICR7b3MubmFtZX1gKTtcbiAgICAgIH1cbiAgICB9KCk7XG4gIH1cblxuICAvKipcbiAgICogQ29tcG9uZW50IG5hbWUuXG4gICAqXG4gICAqIFVzZWQgdG8gaWRlbnRpZnkgY29tcG9uZW50IGluIGltYWdlIGJ1aWxkIGxvZ3MsIGFuZCBmb3Ige0BsaW5rIElDb25maWd1cmFibGVSdW5uZXJJbWFnZUJ1aWxkZXIucmVtb3ZlQ29tcG9uZW50fVxuICAgKi9cbiAgYWJzdHJhY3QgcmVhZG9ubHkgbmFtZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGNvbW1hbmRzIHRvIHJ1biB0byBpbiBidWlsdCBpbWFnZS4gQ2FuIGJlIHVzZWQgdG8gaW5zdGFsbCBwYWNrYWdlcywgc2V0dXAgYnVpbGQgcHJlcmVxdWlzaXRlcywgZXRjLlxuICAgKi9cbiAgYWJzdHJhY3QgZ2V0Q29tbWFuZHMoX29zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYXNzZXRzIHRvIGNvcHkgaW50byB0aGUgYnVpbHQgaW1hZ2UuIENhbiBiZSB1c2VkIHRvIGNvcHkgZmlsZXMgaW50byB0aGUgaW1hZ2UuXG4gICAqL1xuICBnZXRBc3NldHMoX29zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogUnVubmVySW1hZ2VBc3NldFtdIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBEb2NrZXIgY29tbWFuZHMgdG8gcnVuIHRvIGluIGJ1aWx0IGltYWdlLiBDYW4gYmUgdXNlZCB0byBhZGQgY29tbWFuZHMgbGlrZSBgVk9MVU1FYCwgYEVOVFJZUE9JTlRgLCBgQ01EYCwgZXRjLlxuICAgKlxuICAgKiBEb2NrZXIgY29tbWFuZHMgYXJlIGFkZGVkIGFmdGVyIGFzc2V0cyBhbmQgbm9ybWFsIGNvbW1hbmRzLlxuICAgKi9cbiAgZ2V0RG9ja2VyQ29tbWFuZHMoX29zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogc3RyaW5nW10ge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIHRydWUgaWYgdGhlIGltYWdlIGJ1aWxkZXIgc2hvdWxkIGJlIHJlYm9vdGVkIGFmdGVyIHRoaXMgY29tcG9uZW50IGlzIGluc3RhbGxlZC5cbiAgICovXG4gIHNob3VsZFJlYm9vdChfb3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpOiBib29sZWFuIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogQ29udmVydCBjb21wb25lbnQgdG8gYW4gQVdTIEltYWdlIEJ1aWxkZXIgY29tcG9uZW50LlxuICAgKlxuICAgKiBDb21wb25lbnRzIGFyZSBjYWNoZWQgYW5kIHJldXNlZCB3aGVuIHRoZSBzYW1lIGNvbXBvbmVudCBpcyByZXF1ZXN0ZWQgd2l0aCB0aGUgc2FtZVxuICAgKiBPUyBhbmQgYXJjaGl0ZWN0dXJlLCByZWR1Y2luZyBzdGFjayB0ZW1wbGF0ZSBzaXplIGFuZCBudW1iZXIgb2YgcmVzb3VyY2VzLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9hc0F3c0ltYWdlQnVpbGRlckNvbXBvbmVudChzY29wZTogQ29uc3RydWN0LCBvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgbGV0IHBsYXRmb3JtOiAnTGludXgnIHwgJ1dpbmRvd3MnO1xuICAgIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfVUJVTlRVX1ZFUlNJT05TKSB8fCBvcy5pc0luKE9zLl9BTExfTElOVVhfQU1BWk9OX1ZFUlNJT05TKSkge1xuICAgICAgcGxhdGZvcm0gPSAnTGludXgnO1xuICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHBsYXRmb3JtID0gJ1dpbmRvd3MnO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3MvYXJjaGl0ZWN0dXJlIGNvbWJvIGZvciBpbWFnZSBidWlsZGVyIGNvbXBvbmVudDogJHtvcy5uYW1lfS8ke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgIH1cblxuICAgIC8vIEdldCBjb21wb25lbnQgcHJvcGVydGllcyB0byBjcmVhdGUgYSBjYWNoZSBrZXlcbiAgICBjb25zdCBjb21tYW5kcyA9IHRoaXMuZ2V0Q29tbWFuZHMob3MsIGFyY2hpdGVjdHVyZSk7XG4gICAgY29uc3QgYXNzZXRzID0gdGhpcy5nZXRBc3NldHMob3MsIGFyY2hpdGVjdHVyZSk7XG4gICAgY29uc3QgcmVib290ID0gdGhpcy5zaG91bGRSZWJvb3Qob3MsIGFyY2hpdGVjdHVyZSk7XG5cbiAgICAvLyBDcmVhdGUgYSBjYWNoZSBrZXkgYmFzZWQgb24gY29tcG9uZW50IGlkZW50aXR5IGFuZCBwcm9wZXJ0aWVzXG4gICAgY29uc3Qgc3RhY2sgPSBjZGsuU3RhY2sub2Yoc2NvcGUpO1xuICAgIGNvbnN0IGNhY2hlS2V5ID0gdGhpcy5fZ2V0Q2FjaGVLZXkoc3RhY2ssIG9zLCBhcmNoaXRlY3R1cmUsIGNvbW1hbmRzLCBhc3NldHMsIHJlYm9vdCk7XG5cbiAgICAvLyBDcmVhdGUgYSBjb25zaXN0ZW50IElEIGJhc2VkIG9uIHRoZSBjYWNoZSBrZXkgdG8gZW5zdXJlIHRoZSBzYW1lIGNvbXBvbmVudFxuICAgIC8vIGFsd2F5cyBnZXRzIHRoZSBzYW1lIElELCByZWdhcmRsZXNzIG9mIHRoZSBwYXNzZWQtaW4gaWQgcGFyYW1ldGVyXG4gICAgLy8gVGhlIGNhY2hlIGtleSBpcyBhbHJlYWR5IGEgaGFzaCwgc28gd2UgY2FuIHVzZSBpdCBkaXJlY3RseVxuICAgIC8vIFByZWZpeCB3aXRoIEdIUkludGVybmFsLyB0byBhdm9pZCBjb25mbGljdHMgd2l0aCB1c2VyLWRlZmluZWQgY29uc3RydWN0c1xuICAgIGNvbnN0IGNvbnNpc3RlbnRJZCA9IGBHSFJJbnRlcm5hbC9Db21wb25lbnQtJHt0aGlzLm5hbWV9LSR7b3MubmFtZX0tJHthcmNoaXRlY3R1cmUubmFtZX0tJHtjYWNoZUtleS5zdWJzdHJpbmcoMCwgMTApfWAucmVwbGFjZSgvW15hLXpBLVowLTktL10vZywgJy0nKTtcblxuICAgIC8vIFVzZSB0aGUgY29uc3RydWN0IHRyZWUgYXMgdGhlIGNhY2hlIC0gY2hlY2sgaWYgY29tcG9uZW50IGFscmVhZHkgZXhpc3RzIGluIHRoZSBzdGFja1xuICAgIGNvbnN0IGV4aXN0aW5nID0gc3RhY2subm9kZS50cnlGaW5kQ2hpbGQoY29uc2lzdGVudElkKTtcbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIC8vIENvbXBvbmVudCBhbHJlYWR5IGV4aXN0cyBpbiB0aGlzIHN0YWNrLCByZXVzZSBpdFxuICAgICAgcmV0dXJuIGV4aXN0aW5nIGFzIEltYWdlQnVpbGRlckNvbXBvbmVudDtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgbmV3IGNvbXBvbmVudCBpbiB0aGUgc3RhY2sgc2NvcGUgc28gaXQgY2FuIGJlIHNoYXJlZCBhY3Jvc3MgYWxsIHNjb3BlcyBpbiB0aGUgc2FtZSBzdGFja1xuICAgIGNvbnN0IGNvbXBvbmVudCA9IG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc3RhY2ssIGNvbnNpc3RlbnRJZCwge1xuICAgICAgcGxhdGZvcm06IHBsYXRmb3JtLFxuICAgICAgY29tbWFuZHM6IGNvbW1hbmRzLFxuICAgICAgYXNzZXRzOiBhc3NldHMubWFwKChhc3NldCwgaW5kZXgpID0+IHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBhc3NldDogbmV3IHMzX2Fzc2V0cy5Bc3NldChzdGFjaywgYEdIUkludGVybmFsLyR7Y29uc2lzdGVudElkfS9Bc3NldCR7aW5kZXh9YCwgeyBwYXRoOiBhc3NldC5zb3VyY2UgfSksXG4gICAgICAgICAgcGF0aDogYXNzZXQudGFyZ2V0LFxuICAgICAgICB9O1xuICAgICAgfSksXG4gICAgICBkaXNwbGF5TmFtZTogYCR7dGhpcy5uYW1lfSAoJHtvcy5uYW1lfS8ke2FyY2hpdGVjdHVyZS5uYW1lfSlgLFxuICAgICAgZGVzY3JpcHRpb246IGAke3RoaXMubmFtZX0gY29tcG9uZW50IGZvciAke29zLm5hbWV9LyR7YXJjaGl0ZWN0dXJlLm5hbWV9YCxcbiAgICAgIHJlYm9vdDogcmVib290LFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNvbXBvbmVudDtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZSBhIGNhY2hlIGtleSBmb3IgY29tcG9uZW50IHJldXNlLlxuICAgKiBDb21wb25lbnRzIHdpdGggdGhlIHNhbWUgbmFtZSwgT1MsIGFyY2hpdGVjdHVyZSwgY29tbWFuZHMsIGFzc2V0cywgYW5kIHJlYm9vdCBmbGFnIHdpbGwgc2hhcmUgdGhlIHNhbWUga2V5LlxuICAgKiBSZXR1cm5zIGEgaGFzaCBvZiBhbGwgY29tcG9uZW50IHByb3BlcnRpZXMgdG8gZW5zdXJlIHVuaXF1ZW5lc3MuXG4gICAqXG4gICAqIFRoZSBrZXkgaXMgYnVpbHQgZnJvbSBhICpjYW5vbmljYWwqIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBpbnB1dHMgc28gaXQgc3RheXMgc3RhYmxlIGFjcm9zcyBzeW50aHNcbiAgICogYW5kIG1hY2hpbmVzOlxuICAgKiAgLSBDb21tYW5kcyBhcmUgcmVzb2x2ZWQgdGhyb3VnaCB0aGUgc3RhY2sgc28gQ0RLIHRva2VucyAoZS5nLiBgUmVmYC9gRm46OkdldEF0dGApIGFyZSBoYXNoZWQgYnlcbiAgICogICAgdGhlaXIgc3RhYmxlIGludHJpbnNpYyBmb3JtLCBub3QgYnkgdGhlIGAke1Rva2VuW1RPS0VOLk5OXX1gIHBsYWNlaG9sZGVyIHdob3NlIGNvdW50ZXIgY2hhbmdlc1xuICAgKiAgICBiZXR3ZWVuIHN5bnRocy5cbiAgICogIC0gQXNzZXRzIGFyZSBoYXNoZWQgYnkgZmlsZSBjb250ZW50IChwYXRoLWluZGVwZW5kZW50KSByYXRoZXIgdGhhbiBieSB0aGVpciBsb2NhbCBzb3VyY2UgcGF0aCwgc29cbiAgICogICAgdGhlIHNhbWUgZmlsZSBwcm9kdWNlcyB0aGUgc2FtZSBrZXkgcmVnYXJkbGVzcyBvZiB3aGVyZSBpdCBsaXZlcyBvbiBkaXNrLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByaXZhdGUgX2dldENhY2hlS2V5KHN0YWNrOiBjZGsuU3RhY2ssIG9zOiBPcywgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUsIGNvbW1hbmRzOiBzdHJpbmdbXSwgYXNzZXRzOiBSdW5uZXJJbWFnZUFzc2V0W10sIHJlYm9vdDogYm9vbGVhbikge1xuICAgIC8vIENyZWF0ZSBhIGhhc2ggb2YgdGhlIGNvbXBvbmVudCBwcm9wZXJ0aWVzLiBPbmx5IHRva2VuaXplZCBjb21tYW5kcyBhcmUgcmVzb2x2ZWQgKHBsYWluIGNvbW1hbmRzXG4gICAgLy8gYXJlIGxlZnQgYXMtaXMgc28gdGhlaXIga2V5IGlzIHVuY2hhbmdlZCksIGFuZCBhc3NldHMgYXJlIGtleWVkIGJ5IGNvbnRlbnQgaW5zdGVhZCBvZiBwYXRoLlxuICAgIGNvbnN0IGNvbW1hbmRLZXlzID0gY29tbWFuZHMubWFwKGMgPT4gY2RrLlRva2VuLmlzVW5yZXNvbHZlZChjKSA/IEpTT04uc3RyaW5naWZ5KHN0YWNrLnJlc29sdmUoYykpIDogYykuam9pbignXFxuJyk7XG4gICAgY29uc3QgYXNzZXRLZXlzID0gYXNzZXRzLm1hcChhID0+IGAke2Nkay5GaWxlU3lzdGVtLmZpbmdlcnByaW50KGEuc291cmNlKX06JHthLnRhcmdldH1gKS5zb3J0KCkuam9pbignfCcpO1xuICAgIGNvbnN0IGtleURhdGEgPSBgJHt0aGlzLm5hbWV9OiR7b3MubmFtZX06JHthcmNoaXRlY3R1cmUubmFtZX06JHtjb21tYW5kS2V5c306JHthc3NldEtleXN9OiR7cmVib290fWA7XG4gICAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoa2V5RGF0YSkuZGlnZXN0KCdoZXgnKTtcbiAgfVxufVxuIl19