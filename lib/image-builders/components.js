"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerImageComponent = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const crypto = require("crypto");
const path = require("path");
const cdk = require("aws-cdk-lib");
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
            constructor() {
                super(...arguments);
                this.name = 'RequiredPackages';
            }
            getCommands(os, _architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    return [
                        'apt-get update',
                        'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y',
                        'DEBIAN_FRONTEND=noninteractive apt-get install -y curl sudo jq bash zip unzip iptables software-properties-common ca-certificates',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
                    return [
                        'yum update -y',
                        'yum install -y jq tar gzip bzip2 which binutils zip unzip sudo shadow-utils',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
                    return [
                        'dnf upgrade -y',
                        'dnf install -y jq tar gzip bzip2 which binutils zip unzip sudo shadow-utils findutils',
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
            constructor() {
                super(...arguments);
                this.name = 'CloudWatchAgent';
            }
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
                        `curl -sfLo /tmp/amazon-cloudwatch-agent.deb https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/${archUrl}/latest/amazon-cloudwatch-agent.deb`,
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
            constructor() {
                super(...arguments);
                this.name = 'RunnerUser';
            }
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
            constructor() {
                super(...arguments);
                this.name = 'AwsCli';
            }
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
                        `curl -fsSL "https://awscli.amazonaws.com/${zipName}" -o awscliv2.zip`,
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
            constructor() {
                super(...arguments);
                this.name = 'GithubCli';
            }
            getCommands(os, architecture) {
                if (useVersion && !os.is(providers_1.Os.WINDOWS)) {
                    throw new Error('RunnerImageComponent.githubCli(version): version is only used on Windows. On Linux the package manager (apt/yum/dnf) is used. Omit the version for Linux images.');
                }
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    return [
                        'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
                        'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] ' +
                            '  https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
                        'apt-get update',
                        'DEBIAN_FRONTEND=noninteractive apt-get install -y gh',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
                    return [
                        'curl -fsSSL https://cli.github.com/packages/rpm/gh-cli.repo -o /etc/yum.repos.d/gh-cli.repo',
                        'yum install -y gh',
                    ];
                }
                else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
                    return [
                        'curl -fsSSL https://cli.github.com/packages/rpm/gh-cli.repo -o /etc/yum.repos.d/gh-cli.repo',
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
                        'cmd /c curl -w "%{redirect_url}" -fsS https://github.com/cli/cli/releases/latest > $Env:TEMP\\latest-gh',
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
            constructor() {
                super(...arguments);
                this.name = 'Git';
            }
            getCommands(os, architecture) {
                if (useVersion && !os.is(providers_1.Os.WINDOWS)) {
                    throw new Error('RunnerImageComponent.git(version): version is only used on Windows. On Linux the package manager (apt/yum/dnf) is used. Omit the version for Linux images.');
                }
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    return [
                        'add-apt-repository ppa:git-core/ppa',
                        'apt-get update',
                        'DEBIAN_FRONTEND=noninteractive apt-get install -y git',
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
                        'cmd /c curl -w "%{redirect_url}" -fsS https://github.com/git-for-windows/git/releases/latest > $Env:TEMP\\latest-git',
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
            constructor() {
                super(...arguments);
                this.name = 'GithubRunner';
            }
            getCommands(os, architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS) || os.isIn(providers_1.Os._ALL_LINUX_AMAZON_VERSIONS)) {
                    let versionCommand;
                    if (runnerVersion.is(providers_1.RunnerVersion.latest())) {
                        versionCommand = 'RUNNER_VERSION=`curl -w "%{redirect_url}" -fsS https://github.com/actions/runner/releases/latest | grep -oE "[^/v]+$"`';
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
                        `curl -fsSLO "https://github.com/actions/runner/releases/download/v\${RUNNER_VERSION}/actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz"`,
                        `tar -C /home/runner -xzf "actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz"`,
                        `rm actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz`,
                        `echo -n ${runnerVersion.version} > /home/runner/RUNNER_VERSION`,
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
                            'cmd /c curl -w "%{redirect_url}" -fsS https://github.com/actions/runner/releases/latest > $Env:TEMP\\latest-gha',
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
                        'cmd /c curl -w "%{redirect_url}" -fsS https://github.com/facebook/zstd/releases/latest > $Env:TEMP\\latest-zstd',
                        '$LatestUrl = Get-Content $Env:TEMP\\latest-zstd',
                        '$ZSTD_VERSION = ($LatestUrl -Split \'/\')[-1].substring(1)',
                        'Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/facebook/zstd/releases/download/v$ZSTD_VERSION/zstd-v$ZSTD_VERSION-win64.zip" -OutFile zstd.zip',
                        'Expand-Archive zstd.zip -DestinationPath C:\\tools',
                        'Move-Item -Path C:\\tools\\zstd-v$ZSTD_VERSION-win64\\zstd.exe C:\\tools',
                        'Remove-Item -LiteralPath "C:\\tools\\zstd-v$ZSTD_VERSION-win64" -Force -Recurse',
                        'del zstd.zip',
                        // add C:\tools to PATH
                        '$persistedPaths = [Environment]::GetEnvironmentVariable(\'Path\', [EnvironmentVariableTarget]::Machine)',
                        '[Environment]::SetEnvironmentVariable("PATH", $persistedPaths + ";C:\\tools", [EnvironmentVariableTarget]::Machine)',
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
            constructor() {
                super(...arguments);
                this.name = 'Docker';
            }
            getCommands(os, architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_UBUNTU_VERSIONS)) {
                    if (useVersion) {
                        throw new Error('RunnerImageComponent.docker(version): version is only used on Windows. On Ubuntu the apt package version format is not reliably predictable; use latest (omit version) for Ubuntu images.');
                    }
                    return [
                        'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg',
                        'echo ' +
                            '  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ' +
                            '  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
                        'apt-get update',
                        'DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin',
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
                        'curl -sfLo /usr/bin/docker-compose https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s | tr \'[:upper:]\' \'[:lower:]\')-$(uname -m)',
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
                        'curl -sfLo /usr/bin/docker-compose https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s | tr \'[:upper:]\' \'[:lower:]\')-$(uname -m)',
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
                        'cmd /c curl -w "%{redirect_url}" -fsS https://github.com/docker/compose/releases/latest > $Env:TEMP\\latest-docker-compose',
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
            constructor() {
                super(...arguments);
                this.name = `Extra-Certificates-${sanitizedName}`;
            }
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
            constructor() {
                super(...arguments);
                this.name = 'Lambda-Entrypoint';
            }
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
        Object.entries(vars).forEach(e => {
            if (e[0].includes('\n') || e[1].includes('\n')) {
                throw new Error(`Environment variable cannot contain newlines: ${e}`);
            }
        });
        return new class extends RunnerImageComponent {
            constructor() {
                super(...arguments);
                this.name = 'EnvironmentVariables';
            }
            getCommands(os, _architecture) {
                if (os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
                    return Object.entries(vars).map(e => `echo '${e[0]}=${e[1].replace(/'/g, "'\"'\"'")}' >> /home/runner/.env`);
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
        const cacheKey = this._getCacheKey(os, architecture, commands, assets, reboot);
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
     * @internal
     */
    _getCacheKey(os, architecture, commands, assets, reboot) {
        // Create a hash of the component properties
        const assetKeys = assets.map(a => `${a.source}:${a.target}`).sort().join('|');
        const keyData = `${this.name}:${os.name}:${architecture.name}:${commands.join('\n')}:${assetKeys}:${reboot}`;
        return crypto.createHash('md5').update(keyData).digest('hex');
    }
}
exports.RunnerImageComponent = RunnerImageComponent;
_a = JSII_RTTI_SYMBOL_1;
RunnerImageComponent[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.RunnerImageComponent", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcG9uZW50cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9jb21wb25lbnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsaUNBQWlDO0FBQ2pDLDZCQUE2QjtBQUM3QixtQ0FBbUM7QUFDbkMsNkNBQXlEO0FBRXpELG9DQUFvRDtBQUNwRCwyREFBNEQ7QUFFNUQsNENBQStEO0FBOEIvRDs7OztHQUlHO0FBQ0gsU0FBUyxlQUFlLENBQUMsT0FBMkI7SUFDbEQsSUFBSSxPQUFPLEtBQUssU0FBUyxJQUFJLE9BQU8sS0FBSyxJQUFJO1FBQUUsT0FBTyxTQUFTLENBQUM7SUFDaEUsTUFBTSxPQUFPLEdBQUcsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO0lBQy9CLElBQUksT0FBTyxLQUFLLEVBQUUsSUFBSSxPQUFPLENBQUMsV0FBVyxFQUFFLEtBQUssUUFBUTtRQUFFLE9BQU8sU0FBUyxDQUFDO0lBQzNFLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUN2QyxNQUFNLElBQUksS0FBSyxDQUNiLG9CQUFvQixPQUFPLDZFQUE2RSxDQUN6RyxDQUFDO0lBQ0osQ0FBQztJQUNELE9BQU8sT0FBTyxDQUFDO0FBQ2pCLENBQUM7QUFFRDs7O0dBR0c7QUFDSCxTQUFTLDBCQUEwQixDQUFDLE9BQWU7SUFDakQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxRQUFRLENBQUMsV0FBVyxDQUFDO1FBQUUsT0FBTyxPQUFPLENBQUM7SUFDbkQsTUFBTSxLQUFLLEdBQUcsT0FBTyxDQUFDLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUN6QyxJQUFJLEtBQUssQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztRQUFFLE9BQU8sT0FBTyxDQUFDO0lBQ3BELE1BQU0sSUFBSSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMs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TUFBTSxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQ2hFLENBQUM7O0FBM3VCSCxvREE0dUJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY3J5cHRvIGZyb20gJ2NyeXB0byc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IGF3c19zM19hc3NldHMgYXMgczNfYXNzZXRzIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBkaXNjb3ZlckNlcnRpZmljYXRlRmlsZXMgfSBmcm9tICcuLi91dGlscyc7XG5pbXBvcnQgeyBJbWFnZUJ1aWxkZXJDb21wb25lbnQgfSBmcm9tICcuL2F3cy1pbWFnZS1idWlsZGVyJztcbmltcG9ydCB7IFJ1bm5lckltYWdlQXNzZXQgfSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIE9zLCBSdW5uZXJWZXJzaW9uIH0gZnJvbSAnLi4vcHJvdmlkZXJzJztcblxuZXhwb3J0IGludGVyZmFjZSBSdW5uZXJJbWFnZUNvbXBvbmVudEN1c3RvbVByb3BzIHtcbiAgLyoqXG4gICAqIENvbXBvbmVudCBuYW1lIHVzZWQgZm9yICgxKSBpbWFnZSBidWlsZCBsb2dnaW5nIGFuZCAoMikgaWRlbnRpZmllciBmb3Ige0BsaW5rIElDb25maWd1cmFibGVSdW5uZXJJbWFnZUJ1aWxkZXIucmVtb3ZlQ29tcG9uZW50fS5cbiAgICpcbiAgICogTmFtZSBtdXN0IG9ubHkgY29udGFpbiBhbHBoYW51bWVyaWMgY2hhcmFjdGVycyBhbmQgZGFzaGVzLlxuICAgKi9cbiAgcmVhZG9ubHkgbmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogQ29tbWFuZHMgdG8gcnVuIGluIHRoZSBidWlsdCBpbWFnZS5cbiAgICovXG4gIHJlYWRvbmx5IGNvbW1hbmRzPzogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEFzc2V0cyB0byBjb3B5IGludG8gdGhlIGJ1aWx0IGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgYXNzZXRzPzogUnVubmVySW1hZ2VBc3NldFtdO1xuXG4gIC8qKlxuICAgKiBEb2NrZXIgY29tbWFuZHMgdG8gcnVuIGluIHRoZSBidWlsdCBpbWFnZS5cbiAgICpcbiAgICogRm9yIGV4YW1wbGU6IGBbJ0VOViBmb289YmFyJywgJ1JVTiBlY2hvICRmb28nXWBcbiAgICpcbiAgICogVGhlc2UgY29tbWFuZHMgYXJlIGlnbm9yZWQgd2hlbiBidWlsZGluZyBBTUlzLlxuICAgKi9cbiAgcmVhZG9ubHkgZG9ja2VyQ29tbWFuZHM/OiBzdHJpbmdbXTtcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYW5kIG5vcm1hbGl6ZXMgYSB2ZXJzaW9uIHN0cmluZyBmb3IgdXNlIGluIGRvd25sb2FkIFVSTHMuXG4gKiBSZXR1cm5zIHVuZGVmaW5lZCBpZiB2ZXJzaW9uIGlzIGVtcHR5IG9yIFwibGF0ZXN0XCIgKGNhbGxlciBzaG91bGQgdXNlIGxhdGVzdCkuXG4gKiBUaHJvd3MgaWYgdmVyc2lvbiBjb250YWlucyBhbnkgY2hhcmFjdGVyIG90aGVyIHRoYW4gYWxwaGFudW1lcmljLCBkb3RzLCBkYXNoZXMsIG9yIHVuZGVyc2NvcmVzLlxuICovXG5mdW5jdGlvbiB2YWxpZGF0ZVZlcnNpb24odmVyc2lvbjogc3RyaW5nIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHZlcnNpb24gPT09IHVuZGVmaW5lZCB8fCB2ZXJzaW9uID09PSBudWxsKSByZXR1cm4gdW5kZWZpbmVkO1xuICBjb25zdCB0cmltbWVkID0gdmVyc2lvbi50cmltKCk7XG4gIGlmICh0cmltbWVkID09PSAnJyB8fCB0cmltbWVkLnRvTG93ZXJDYXNlKCkgPT09ICdsYXRlc3QnKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAoIS9eW2EtekEtWjAtOS5fLV0rJC8udGVzdCh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBJbnZhbGlkIHZlcnNpb24gXCIke3ZlcnNpb259XCI6IG9ubHkgYWxwaGFudW1lcmljIGNoYXJhY3RlcnMsIGRvdHMsIGRhc2hlcywgYW5kIHVuZGVyc2NvcmVzIGFyZSBhbGxvd2VkLmAsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBHaXQgZm9yIFdpbmRvd3MgdmVyc2lvbiBmb3JtYXQ6IFwiMi40My4wLndpbmRvd3MuMVwiIOKGkiBcIjIuNDMuMFwiIChyZXZpc2lvbiAxIG9taXR0ZWQpLFxuICogXCIyLjQzLjAud2luZG93cy4yXCIg4oaSIFwiMi40My4wLjJcIiAocmV2aXNpb24gMisgYXBwZW5kZWQpLiBWZXJzaW9ucyB3aXRob3V0IFwiLndpbmRvd3MuXCIgYXJlIHJldHVybmVkIGFzLWlzLlxuICovXG5mdW5jdGlvbiBmb3JtYXRHaXRGb3JXaW5kb3dzVmVyc2lvbih2ZXJzaW9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIXZlcnNpb24uaW5jbHVkZXMoJy53aW5kb3dzLicpKSByZXR1cm4gdmVyc2lvbjtcbiAgY29uc3QgcGFydHMgPSB2ZXJzaW9uLnNwbGl0KCcud2luZG93cy4nKTtcbiAgaWYgKHBhcnRzLmxlbmd0aCAhPT0gMiB8fCAhcGFydHNbMV0pIHJldHVybiB2ZXJzaW9uO1xuICBjb25zdCBiYXNlID0gcGFydHNbMF07XG4gIGNvbnN0IHJldmlzaW9uID0gcGFyc2VJbnQocGFydHNbMV0sIDEwKTtcbiAgaWYgKGlzTmFOKHJldmlzaW9uKSkgcmV0dXJuIHZlcnNpb247XG4gIHJldHVybiByZXZpc2lvbiA+IDEgPyBgJHtiYXNlfS4ke3JldmlzaW9ufWAgOiBiYXNlO1xufVxuXG4vKipcbiAqIENvbXBvbmVudHMgYXJlIHVzZWQgdG8gYnVpbGQgcnVubmVyIGltYWdlcy4gVGhleSBjYW4gcnVuIGNvbW1hbmRzIGluIHRoZSBpbWFnZSwgY29weSBmaWxlcyBpbnRvIHRoZSBpbWFnZSwgYW5kIHJ1biBzb21lIERvY2tlciBjb21tYW5kcy5cbiAqL1xuZXhwb3J0IGFic3RyYWN0IGNsYXNzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgLyoqXG4gICAqIERlZmluZSBhIGN1c3RvbSBjb21wb25lbnQgdGhhdCBjYW4gcnVuIGNvbW1hbmRzIGluIHRoZSBpbWFnZSwgY29weSBmaWxlcyBpbnRvIHRoZSBpbWFnZSwgYW5kIHJ1biBzb21lIERvY2tlciBjb21tYW5kcy5cbiAgICpcbiAgICogVGhlIG9yZGVyIG9mIG9wZXJhdGlvbnMgaXMgKDEpIGFzc2V0cyAoMikgY29tbWFuZHMgKDMpIGRvY2tlciBjb21tYW5kcy5cbiAgICpcbiAgICogVXNlIHRoaXMgdG8gY3VzdG9taXplIHRoZSBpbWFnZSBmb3IgdGhlIHJ1bm5lci5cbiAgICpcbiAgICogKipXQVJOSU5HOioqIERvY2tlciBjb21tYW5kcyBhcmUgbm90IGd1YXJhbnRlZWQgdG8gYmUgaW5jbHVkZWQgYmVmb3JlIHRoZSBuZXh0IGNvbXBvbmVudFxuICAgKi9cbiAgc3RhdGljIGN1c3RvbShwcm9wczogUnVubmVySW1hZ2VDb21wb25lbnRDdXN0b21Qcm9wcyk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICByZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgICAgZ2V0IG5hbWUoKSB7XG4gICAgICAgIGlmIChwcm9wcy5uYW1lICYmICFwcm9wcy5uYW1lLm1hdGNoKC9bYS16QS1aMC05XFwtXS8pKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGNvbXBvbmVudCBuYW1lOiAke3Byb3BzLm5hbWV9LiBOYW1lIG11c3Qgb25seSBjb250YWluIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFuZCBkYXNoZXMuYCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGBDdXN0b20tJHtwcm9wcy5uYW1lID8/ICdVbmRlZmluZWQnfWA7XG4gICAgICB9XG5cbiAgICAgIGdldENvbW1hbmRzKF9vczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICByZXR1cm4gcHJvcHMuY29tbWFuZHMgPz8gW107XG4gICAgICB9XG4gICAgICBnZXRBc3NldHMoX29zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgICAgIHJldHVybiBwcm9wcy5hc3NldHMgPz8gW107XG4gICAgICB9XG5cbiAgICAgIGdldERvY2tlckNvbW1hbmRzKF9vczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICByZXR1cm4gcHJvcHMuZG9ja2VyQ29tbWFuZHMgPz8gW107XG4gICAgICB9XG4gICAgfSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY29tcG9uZW50IHRvIGluc3RhbGwgdGhlIHJlcXVpcmVkIHBhY2thZ2VzIGZvciB0aGUgcnVubmVyLlxuICAgKi9cbiAgc3RhdGljIHJlcXVpcmVkUGFja2FnZXMoKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gJ1JlcXVpcmVkUGFja2FnZXMnO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IHN0cmluZ1tdIHtcbiAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdhcHQtZ2V0IHVwZGF0ZScsXG4gICAgICAgICAgICAnREVCSUFOX0ZST05URU5EPW5vbmludGVyYWN0aXZlIGFwdC1nZXQgdXBncmFkZSAteScsXG4gICAgICAgICAgICAnREVCSUFOX0ZST05URU5EPW5vbmludGVyYWN0aXZlIGFwdC1nZXQgaW5zdGFsbCAteSBjdXJsIHN1ZG8ganEgYmFzaCB6aXAgdW56aXAgaXB0YWJsZXMgc29mdHdhcmUtcHJvcGVydGllcy1jb21tb24gY2EtY2VydGlmaWNhdGVzJyxcbiAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLkxJTlVYX0FNQVpPTl8yKSkge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAneXVtIHVwZGF0ZSAteScsXG4gICAgICAgICAgICAneXVtIGluc3RhbGwgLXkganEgdGFyIGd6aXAgYnppcDIgd2hpY2ggYmludXRpbHMgemlwIHVuemlwIHN1ZG8gc2hhZG93LXV0aWxzJyxcbiAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLkxJTlVYX0FNQVpPTl8yMDIzKSkge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnZG5mIHVwZ3JhZGUgLXknLFxuICAgICAgICAgICAgJ2RuZiBpbnN0YWxsIC15IGpxIHRhciBnemlwIGJ6aXAyIHdoaWNoIGJpbnV0aWxzIHppcCB1bnppcCBzdWRvIHNoYWRvdy11dGlscyBmaW5kdXRpbHMnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIE9TIGZvciByZXF1aXJlZCBwYWNrYWdlczogJHtvcy5uYW1lfWApO1xuICAgICAgfVxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gaW5zdGFsbCBDbG91ZFdhdGNoIEFnZW50IGZvciB0aGUgcnVubmVyIHNvIHdlIGNhbiBzZW5kIGxvZ3MuXG4gICAqL1xuICBzdGF0aWMgY2xvdWRXYXRjaEFnZW50KCk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICByZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgICAgbmFtZSA9ICdDbG91ZFdhdGNoQWdlbnQnO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogc3RyaW5nW10ge1xuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICBsZXQgYXJjaFVybDtcbiAgICAgICAgICBpZiAoYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICAgICAgICBhcmNoVXJsID0gJ2FtZDY0JztcbiAgICAgICAgICB9IGVsc2UgaWYgKGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgICAgICBhcmNoVXJsID0gJ2FybTY0JztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgZm9yIHJlcXVpcmVkIHBhY2thZ2VzOiAke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICBgY3VybCAtc2ZMbyAvdG1wL2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LmRlYiBodHRwczovL3MzLmFtYXpvbmF3cy5jb20vYW1hem9uY2xvdWR3YXRjaC1hZ2VudC91YnVudHUvJHthcmNoVXJsfS9sYXRlc3QvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQuZGViYCxcbiAgICAgICAgICAgICdkcGtnIC1pIC1FIC90bXAvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQuZGViJyxcbiAgICAgICAgICAgICdybSAvdG1wL2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LmRlYicsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMikpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ3l1bSBpbnN0YWxsIC15IGFtYXpvbi1jbG91ZHdhdGNoLWFnZW50JyxcbiAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLkxJTlVYX0FNQVpPTl8yMDIzKSkge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnZG5mIGluc3RhbGwgLXkgYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJyRwID0gU3RhcnQtUHJvY2VzcyBtc2lleGVjLmV4ZSAtUGFzc1RocnUgLVdhaXQgLUFyZ3VtZW50TGlzdCBcXCcvaSBodHRwczovL3MzLmFtYXpvbmF3cy5jb20vYW1hem9uY2xvdWR3YXRjaC1hZ2VudC93aW5kb3dzL2FtZDY0L2xhdGVzdC9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC5tc2kgL3FuXFwnJyxcbiAgICAgICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBPUyBmb3IgcmVxdWlyZWQgcGFja2FnZXM6ICR7b3MubmFtZX1gKTtcbiAgICAgIH1cbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY29tcG9uZW50IHRvIHByZXBhcmUgdGhlIHJlcXVpcmVkIHJ1bm5lciB1c2VyLlxuICAgKi9cbiAgc3RhdGljIHJ1bm5lclVzZXIoKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gJ1J1bm5lclVzZXInO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IHN0cmluZ1tdIHtcbiAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdhZGRncm91cCBydW5uZXInLFxuICAgICAgICAgICAgJ2FkZHVzZXIgLS1zeXN0ZW0gLS1kaXNhYmxlZC1wYXNzd29yZCAtLWhvbWUgL2hvbWUvcnVubmVyIC0taW5ncm91cCBydW5uZXIgcnVubmVyJyxcbiAgICAgICAgICAgICdlY2hvIFwiJXJ1bm5lciAgIEFMTD0oQUxMOkFMTCkgTk9QQVNTV0Q6IEFMTFwiID4gL2V0Yy9zdWRvZXJzLmQvcnVubmVyJyxcbiAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9BTUFaT05fVkVSU0lPTlMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICcvdXNyL3NiaW4vZ3JvdXBhZGQgcnVubmVyJyxcbiAgICAgICAgICAgICcvdXNyL3NiaW4vdXNlcmFkZCAtLXN5c3RlbSAtLXNoZWxsIC91c3Ivc2Jpbi9ub2xvZ2luIC0taG9tZS1kaXIgL2hvbWUvcnVubmVyIC0tZ2lkIHJ1bm5lciBydW5uZXInLFxuICAgICAgICAgICAgJ21rZGlyIC1wIC9ob21lL3J1bm5lcicsXG4gICAgICAgICAgICAnY2hvd24gcnVubmVyIC9ob21lL3J1bm5lcicsXG4gICAgICAgICAgICAnZWNobyBcIiVydW5uZXIgICBBTEw9KEFMTDpBTEwpIE5PUEFTU1dEOiBBTExcIiA+IC9ldGMvc3Vkb2Vycy5kL3J1bm5lcicsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgT1MgZm9yIHJ1bm5lciB1c2VyOiAke29zLm5hbWV9YCk7XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGNvbXBvbmVudCB0byBpbnN0YWxsIHRoZSBBV1MgQ0xJLlxuICAgKlxuICAgKiBAcGFyYW0gdmVyc2lvbiBTb2Z0d2FyZSB2ZXJzaW9uIHRvIGluc3RhbGwgKGUuZy4gJzIuMTUuMCcpLiBEZWZhdWx0OiBsYXRlc3QuXG4gICAqL1xuICBzdGF0aWMgYXdzQ2xpKHZlcnNpb24/OiBzdHJpbmcpOiBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgY29uc3QgdXNlVmVyc2lvbiA9IHZhbGlkYXRlVmVyc2lvbih2ZXJzaW9uKTtcbiAgICByZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgICAgbmFtZSA9ICdBd3NDbGknO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgICAgIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfVUJVTlRVX1ZFUlNJT05TKSB8fCBvcy5pc0luKE9zLl9BTExfTElOVVhfQU1BWk9OX1ZFUlNJT05TKSkge1xuICAgICAgICAgIGxldCBhcmNoVXJsOiBzdHJpbmc7XG4gICAgICAgICAgaWYgKGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgICAgICAgYXJjaFVybCA9ICd4ODZfNjQnO1xuICAgICAgICAgIH0gZWxzZSBpZiAoYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgICAgICAgIGFyY2hVcmwgPSAnYWFyY2g2NCc7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIGZvciBhd3NjbGk6ICR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgemlwTmFtZSA9IHVzZVZlcnNpb25cbiAgICAgICAgICAgID8gYGF3c2NsaS1leGUtbGludXgtJHthcmNoVXJsfS0ke3VzZVZlcnNpb259LnppcGBcbiAgICAgICAgICAgIDogYGF3c2NsaS1leGUtbGludXgtJHthcmNoVXJsfS56aXBgO1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICBgY3VybCAtZnNTTCBcImh0dHBzOi8vYXdzY2xpLmFtYXpvbmF3cy5jb20vJHt6aXBOYW1lfVwiIC1vIGF3c2NsaXYyLnppcGAsXG4gICAgICAgICAgICAndW56aXAgLXEgYXdzY2xpdjIuemlwJyxcbiAgICAgICAgICAgICcuL2F3cy9pbnN0YWxsIC0tdXBkYXRlJyxcbiAgICAgICAgICAgICdybSAtcmYgYXdzY2xpdjIuemlwIGF3cycsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIGNvbnN0IG1zaVVybCA9IHVzZVZlcnNpb25cbiAgICAgICAgICAgID8gYGh0dHBzOi8vYXdzY2xpLmFtYXpvbmF3cy5jb20vQVdTQ0xJVjItJHt1c2VWZXJzaW9ufS5tc2lgXG4gICAgICAgICAgICA6ICdodHRwczovL2F3c2NsaS5hbWF6b25hd3MuY29tL0FXU0NMSVYyLm1zaSc7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIGAkcCA9IFN0YXJ0LVByb2Nlc3MgbXNpZXhlYy5leGUgLVBhc3NUaHJ1IC1XYWl0IC1Bcmd1bWVudExpc3QgJy9pICR7bXNpVXJsfSAvcW4nYCxcbiAgICAgICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgICAgICBdO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9zL2FyY2hpdGVjdHVyZSBjb21ibyBmb3IgYXdzY2xpOiAke29zLm5hbWV9LyR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgICB9XG4gICAgfSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY29tcG9uZW50IHRvIGluc3RhbGwgdGhlIEdpdEh1YiBDTEkuXG4gICAqXG4gICAqIEBwYXJhbSB2ZXJzaW9uIFNvZnR3YXJlIHZlcnNpb24gdG8gaW5zdGFsbCAoZS5nLiAnMi40MC4wJykuIERlZmF1bHQ6IGxhdGVzdC4gT25seSB1c2VkIG9uIFdpbmRvd3MgKHg2NC93aW5kb3dzX2FtZDY0KTsgb24gTGludXggdGhlIHBhY2thZ2UgbWFuYWdlciBpcyB1c2VkLlxuICAgKi9cbiAgc3RhdGljIGdpdGh1YkNsaSh2ZXJzaW9uPzogc3RyaW5nKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIGNvbnN0IHVzZVZlcnNpb24gPSB2YWxpZGF0ZVZlcnNpb24odmVyc2lvbik7XG4gICAgcmV0dXJuIG5ldyBjbGFzcyBleHRlbmRzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAgIG5hbWUgPSAnR2l0aHViQ2xpJztcblxuICAgICAgZ2V0Q29tbWFuZHMob3M6IE9zLCBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICBpZiAodXNlVmVyc2lvbiAmJiAhb3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAnUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKHZlcnNpb24pOiB2ZXJzaW9uIGlzIG9ubHkgdXNlZCBvbiBXaW5kb3dzLiBPbiBMaW51eCB0aGUgcGFja2FnZSBtYW5hZ2VyIChhcHQveXVtL2RuZikgaXMgdXNlZC4gT21pdCB0aGUgdmVyc2lvbiBmb3IgTGludXggaW1hZ2VzLicsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2N1cmwgLWZzU0wgaHR0cHM6Ly9jbGkuZ2l0aHViLmNvbS9wYWNrYWdlcy9naXRodWJjbGktYXJjaGl2ZS1rZXlyaW5nLmdwZyB8IHN1ZG8gZGQgb2Y9L3Vzci9zaGFyZS9rZXlyaW5ncy9naXRodWJjbGktYXJjaGl2ZS1rZXlyaW5nLmdwZycsXG4gICAgICAgICAgICAnZWNobyBcImRlYiBbYXJjaD0kKGRwa2cgLS1wcmludC1hcmNoaXRlY3R1cmUpIHNpZ25lZC1ieT0vdXNyL3NoYXJlL2tleXJpbmdzL2dpdGh1YmNsaS1hcmNoaXZlLWtleXJpbmcuZ3BnXSAnICtcbiAgICAgICAgICAgICcgIGh0dHBzOi8vY2xpLmdpdGh1Yi5jb20vcGFja2FnZXMgc3RhYmxlIG1haW5cIiB8IHN1ZG8gdGVlIC9ldGMvYXB0L3NvdXJjZXMubGlzdC5kL2dpdGh1Yi1jbGkubGlzdCA+IC9kZXYvbnVsbCcsXG4gICAgICAgICAgICAnYXB0LWdldCB1cGRhdGUnLFxuICAgICAgICAgICAgJ0RFQklBTl9GUk9OVEVORD1ub25pbnRlcmFjdGl2ZSBhcHQtZ2V0IGluc3RhbGwgLXkgZ2gnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdjdXJsIC1mc1NTTCBodHRwczovL2NsaS5naXRodWIuY29tL3BhY2thZ2VzL3JwbS9naC1jbGkucmVwbyAtbyAvZXRjL3l1bS5yZXBvcy5kL2doLWNsaS5yZXBvJyxcbiAgICAgICAgICAgICd5dW0gaW5zdGFsbCAteSBnaCcsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMjAyMykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2N1cmwgLWZzU1NMIGh0dHBzOi8vY2xpLmdpdGh1Yi5jb20vcGFja2FnZXMvcnBtL2doLWNsaS5yZXBvIC1vIC9ldGMveXVtLnJlcG9zLmQvZ2gtY2xpLnJlcG8nLFxuICAgICAgICAgICAgJ2RuZiBpbnN0YWxsIC15IGdoJyxcbiAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgaWYgKHVzZVZlcnNpb24pIHtcbiAgICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAgIGBJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgXCJodHRwczovL2dpdGh1Yi5jb20vY2xpL2NsaS9yZWxlYXNlcy9kb3dubG9hZC92JHt1c2VWZXJzaW9ufS9naF8ke3VzZVZlcnNpb259X3dpbmRvd3NfYW1kNjQubXNpXCIgLU91dEZpbGUgZ2gubXNpYCxcbiAgICAgICAgICAgICAgJyRwID0gU3RhcnQtUHJvY2VzcyBtc2lleGVjLmV4ZSAtUGFzc1RocnUgLVdhaXQgLUFyZ3VtZW50TGlzdCBcXCcvaSBnaC5tc2kgL3FuXFwnJyxcbiAgICAgICAgICAgICAgJ2lmICgkcC5FeGl0Q29kZSAtbmUgMCkgeyB0aHJvdyBcIkV4aXQgY29kZSBpcyAkcC5FeGl0Q29kZVwiIH0nLFxuICAgICAgICAgICAgICAnZGVsIGdoLm1zaScsXG4gICAgICAgICAgICBdO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2NtZCAvYyBjdXJsIC13IFwiJXtyZWRpcmVjdF91cmx9XCIgLWZzUyBodHRwczovL2dpdGh1Yi5jb20vY2xpL2NsaS9yZWxlYXNlcy9sYXRlc3QgPiAkRW52OlRFTVBcXFxcbGF0ZXN0LWdoJyxcbiAgICAgICAgICAgICckTGF0ZXN0VXJsID0gR2V0LUNvbnRlbnQgJEVudjpURU1QXFxcXGxhdGVzdC1naCcsXG4gICAgICAgICAgICAnJEdIX1ZFUlNJT04gPSAoJExhdGVzdFVybCAtU3BsaXQgXFwnL1xcJylbLTFdLnN1YnN0cmluZygxKScsXG4gICAgICAgICAgICAnSW52b2tlLVdlYlJlcXVlc3QgLVVzZUJhc2ljUGFyc2luZyAtVXJpIFwiaHR0cHM6Ly9naXRodWIuY29tL2NsaS9jbGkvcmVsZWFzZXMvZG93bmxvYWQvdiR7R0hfVkVSU0lPTn0vZ2hfJHtHSF9WRVJTSU9OfV93aW5kb3dzX2FtZDY0Lm1zaVwiIC1PdXRGaWxlIGdoLm1zaScsXG4gICAgICAgICAgICAnJHAgPSBTdGFydC1Qcm9jZXNzIG1zaWV4ZWMuZXhlIC1QYXNzVGhydSAtV2FpdCAtQXJndW1lbnRMaXN0IFxcJy9pIGdoLm1zaSAvcW5cXCcnLFxuICAgICAgICAgICAgJ2lmICgkcC5FeGl0Q29kZSAtbmUgMCkgeyB0aHJvdyBcIkV4aXQgY29kZSBpcyAkcC5FeGl0Q29kZVwiIH0nLFxuICAgICAgICAgICAgJ2RlbCBnaC5tc2knLFxuICAgICAgICAgIF07XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3MvYXJjaGl0ZWN0dXJlIGNvbWJvIGZvciBnaXRodWIgY2xpOiAke29zLm5hbWV9LyR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgICB9XG4gICAgfSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY29tcG9uZW50IHRvIGluc3RhbGwgR2l0LlxuICAgKlxuICAgKiBAcGFyYW0gdmVyc2lvbiBTb2Z0d2FyZSB2ZXJzaW9uIHRvIGluc3RhbGwgKGUuZy4gJzIuNDMuMC53aW5kb3dzLjEnKS4gRGVmYXVsdDogbGF0ZXN0LiBPbmx5IHVzZWQgb24gV2luZG93czsgb24gTGludXggdGhlIHBhY2thZ2UgbWFuYWdlciBpcyB1c2VkLlxuICAgKi9cbiAgc3RhdGljIGdpdCh2ZXJzaW9uPzogc3RyaW5nKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIGNvbnN0IHVzZVZlcnNpb24gPSB2YWxpZGF0ZVZlcnNpb24odmVyc2lvbik7XG4gICAgcmV0dXJuIG5ldyBjbGFzcyBleHRlbmRzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAgIG5hbWUgPSAnR2l0JztcblxuICAgICAgZ2V0Q29tbWFuZHMob3M6IE9zLCBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgICAgICBpZiAodXNlVmVyc2lvbiAmJiAhb3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICAnUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KHZlcnNpb24pOiB2ZXJzaW9uIGlzIG9ubHkgdXNlZCBvbiBXaW5kb3dzLiBPbiBMaW51eCB0aGUgcGFja2FnZSBtYW5hZ2VyIChhcHQveXVtL2RuZikgaXMgdXNlZC4gT21pdCB0aGUgdmVyc2lvbiBmb3IgTGludXggaW1hZ2VzLicsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2FkZC1hcHQtcmVwb3NpdG9yeSBwcGE6Z2l0LWNvcmUvcHBhJyxcbiAgICAgICAgICAgICdhcHQtZ2V0IHVwZGF0ZScsXG4gICAgICAgICAgICAnREVCSUFOX0ZST05URU5EPW5vbmludGVyYWN0aXZlIGFwdC1nZXQgaW5zdGFsbCAteSBnaXQnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICd5dW0gaW5zdGFsbCAteSBnaXQnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIwMjMpKSB7XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgICdkbmYgaW5zdGFsbCAteSBnaXQnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICBpZiAodXNlVmVyc2lvbikge1xuICAgICAgICAgICAgY29uc3QgdmVyc2lvblNob3J0ID0gZm9ybWF0R2l0Rm9yV2luZG93c1ZlcnNpb24odXNlVmVyc2lvbik7XG4gICAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgICBgSW52b2tlLVdlYlJlcXVlc3QgLVVzZUJhc2ljUGFyc2luZyAtVXJpIFwiaHR0cHM6Ly9naXRodWIuY29tL2dpdC1mb3Itd2luZG93cy9naXQvcmVsZWFzZXMvZG93bmxvYWQvdiR7dXNlVmVyc2lvbn0vR2l0LSR7dmVyc2lvblNob3J0fS02NC1iaXQuZXhlXCIgLU91dEZpbGUgZ2l0LXNldHVwLmV4ZWAsXG4gICAgICAgICAgICAgICckcCA9IFN0YXJ0LVByb2Nlc3MgZ2l0LXNldHVwLmV4ZSAtUGFzc1RocnUgLVdhaXQgLUFyZ3VtZW50TGlzdCBcXCcvVkVSWVNJTEVOVFxcJycsXG4gICAgICAgICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgICAgICAgICAgJ2RlbCBnaXQtc2V0dXAuZXhlJyxcbiAgICAgICAgICAgIF07XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnY21kIC9jIGN1cmwgLXcgXCIle3JlZGlyZWN0X3VybH1cIiAtZnNTIGh0dHBzOi8vZ2l0aHViLmNvbS9naXQtZm9yLXdpbmRvd3MvZ2l0L3JlbGVhc2VzL2xhdGVzdCA+ICRFbnY6VEVNUFxcXFxsYXRlc3QtZ2l0JyxcbiAgICAgICAgICAgICckTGF0ZXN0VXJsID0gR2V0LUNvbnRlbnQgJEVudjpURU1QXFxcXGxhdGVzdC1naXQnLFxuICAgICAgICAgICAgJyRHSVRfVkVSU0lPTiA9ICgkTGF0ZXN0VXJsIC1TcGxpdCBcXCcvXFwnKVstMV0uc3Vic3RyaW5nKDEpJyxcbiAgICAgICAgICAgICckR0lUX1ZFUlNJT05fU0hPUlQgPSAoJEdJVF9WRVJTSU9OIC1TcGxpdCBcXCcud2luZG93cy5cXCcpWzBdJyxcbiAgICAgICAgICAgICckR0lUX1JFVklTSU9OID0gKCRHSVRfVkVSU0lPTiAtU3BsaXQgXFwnLndpbmRvd3MuXFwnKVsxXScsXG4gICAgICAgICAgICAnSWYgKCRHSVRfUkVWSVNJT04gLWd0IDEpIHskR0lUX1ZFUlNJT05fU0hPUlQgPSBcIiRHSVRfVkVSU0lPTl9TSE9SVC4kR0lUX1JFVklTSU9OXCJ9JyxcbiAgICAgICAgICAgICdJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgaHR0cHM6Ly9naXRodWIuY29tL2dpdC1mb3Itd2luZG93cy9naXQvcmVsZWFzZXMvZG93bmxvYWQvdiR7R0lUX1ZFUlNJT059L0dpdC0ke0dJVF9WRVJTSU9OX1NIT1JUfS02NC1iaXQuZXhlIC1PdXRGaWxlIGdpdC1zZXR1cC5leGUnLFxuICAgICAgICAgICAgJyRwID0gU3RhcnQtUHJvY2VzcyBnaXQtc2V0dXAuZXhlIC1QYXNzVGhydSAtV2FpdCAtQXJndW1lbnRMaXN0IFxcJy9WRVJZU0lMRU5UXFwnJyxcbiAgICAgICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgICAgICAgICdkZWwgZ2l0LXNldHVwLmV4ZScsXG4gICAgICAgICAgXTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcy9hcmNoaXRlY3R1cmUgY29tYm8gZm9yIGdpdDogJHtvcy5uYW1lfS8ke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgICAgfVxuICAgIH0oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGNvbXBvbmVudCB0byBpbnN0YWxsIHRoZSBHaXRIdWIgQWN0aW9ucyBSdW5uZXIuIFRoaXMgaXMgdGhlIGFjdHVhbCBleGVjdXRhYmxlIHRoYXQgY29ubmVjdHMgdG8gR2l0SHViIHRvIGFzayBmb3Igam9icyBhbmQgdGhlbiBleGVjdXRlIHRoZW0uXG4gICAqXG4gICAqIEBwYXJhbSBydW5uZXJWZXJzaW9uIFRoZSB2ZXJzaW9uIG9mIHRoZSBydW5uZXIgdG8gaW5zdGFsbC4gVXN1YWxseSB5b3Ugd291bGQgc2V0IHRoaXMgdG8gbGF0ZXN0LlxuICAgKi9cbiAgc3RhdGljIGdpdGh1YlJ1bm5lcihydW5uZXJWZXJzaW9uOiBSdW5uZXJWZXJzaW9uKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gJ0dpdGh1YlJ1bm5lcic7XG5cbiAgICAgIGdldENvbW1hbmRzKG9zOiBPcywgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpIHtcbiAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpIHx8IG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9BTUFaT05fVkVSU0lPTlMpKSB7XG4gICAgICAgICAgbGV0IHZlcnNpb25Db21tYW5kOiBzdHJpbmc7XG4gICAgICAgICAgaWYgKHJ1bm5lclZlcnNpb24uaXMoUnVubmVyVmVyc2lvbi5sYXRlc3QoKSkpIHtcbiAgICAgICAgICAgIHZlcnNpb25Db21tYW5kID0gJ1JVTk5FUl9WRVJTSU9OPWBjdXJsIC13IFwiJXtyZWRpcmVjdF91cmx9XCIgLWZzUyBodHRwczovL2dpdGh1Yi5jb20vYWN0aW9ucy9ydW5uZXIvcmVsZWFzZXMvbGF0ZXN0IHwgZ3JlcCAtb0UgXCJbXi92XSskXCJgJztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmVyc2lvbkNvbW1hbmQgPSBgUlVOTkVSX1ZFUlNJT049JyR7cnVubmVyVmVyc2lvbi52ZXJzaW9ufSdgO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGxldCBhcmNoVXJsO1xuICAgICAgICAgIGlmIChhcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICAgICAgICAgIGFyY2hVcmwgPSAneDY0JztcbiAgICAgICAgICB9IGVsc2UgaWYgKGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpKSB7XG4gICAgICAgICAgICBhcmNoVXJsID0gJ2FybTY0JztcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBhcmNoaXRlY3R1cmUgZm9yIEdpdEh1YiBSdW5uZXI6ICR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgbGV0IGNvbW1hbmRzID0gW1xuICAgICAgICAgICAgdmVyc2lvbkNvbW1hbmQsXG4gICAgICAgICAgICBgY3VybCAtZnNTTE8gXCJodHRwczovL2dpdGh1Yi5jb20vYWN0aW9ucy9ydW5uZXIvcmVsZWFzZXMvZG93bmxvYWQvdlxcJHtSVU5ORVJfVkVSU0lPTn0vYWN0aW9ucy1ydW5uZXItbGludXgtJHthcmNoVXJsfS1cXCR7UlVOTkVSX1ZFUlNJT059LnRhci5nelwiYCxcbiAgICAgICAgICAgIGB0YXIgLUMgL2hvbWUvcnVubmVyIC14emYgXCJhY3Rpb25zLXJ1bm5lci1saW51eC0ke2FyY2hVcmx9LVxcJHtSVU5ORVJfVkVSU0lPTn0udGFyLmd6XCJgLFxuICAgICAgICAgICAgYHJtIGFjdGlvbnMtcnVubmVyLWxpbnV4LSR7YXJjaFVybH0tXFwke1JVTk5FUl9WRVJTSU9OfS50YXIuZ3pgLFxuICAgICAgICAgICAgYGVjaG8gLW4gJHtydW5uZXJWZXJzaW9uLnZlcnNpb259ID4gL2hvbWUvcnVubmVyL1JVTk5FUl9WRVJTSU9OYCxcbiAgICAgICAgICBdO1xuXG4gICAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpKSB7XG4gICAgICAgICAgICBjb21tYW5kcy5wdXNoKCcvaG9tZS9ydW5uZXIvYmluL2luc3RhbGxkZXBlbmRlbmNpZXMuc2gnKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLkxJTlVYX0FNQVpPTl8yKSkge1xuICAgICAgICAgICAgY29tbWFuZHMucHVzaCgneXVtIGluc3RhbGwgLXkgb3BlbnNzbC1saWJzIGtyYjUtbGlicyB6bGliIGxpYmljdTYwJyk7XG4gICAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMjAyMykpIHtcbiAgICAgICAgICAgIGNvbW1hbmRzLnB1c2goJ2RuZiBpbnN0YWxsIC15IG9wZW5zc2wtbGlicyBrcmI1LWxpYnMgemxpYiBsaWJpY3UtNjcuMScpO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGNvbW1hbmRzLnB1c2goJ21rZGlyIC1wIC9vcHQvaG9zdGVkdG9vbGNhY2hlJywgJ2Nob3duIHJ1bm5lciAvb3B0L2hvc3RlZHRvb2xjYWNoZScpO1xuXG4gICAgICAgICAgcmV0dXJuIGNvbW1hbmRzO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgbGV0IHJ1bm5lckNvbW1hbmRzOiBzdHJpbmdbXTtcbiAgICAgICAgICBpZiAocnVubmVyVmVyc2lvbi5pcyhSdW5uZXJWZXJzaW9uLmxhdGVzdCgpKSkge1xuICAgICAgICAgICAgcnVubmVyQ29tbWFuZHMgPSBbXG4gICAgICAgICAgICAgICdjbWQgL2MgY3VybCAtdyBcIiV7cmVkaXJlY3RfdXJsfVwiIC1mc1MgaHR0cHM6Ly9naXRodWIuY29tL2FjdGlvbnMvcnVubmVyL3JlbGVhc2VzL2xhdGVzdCA+ICRFbnY6VEVNUFxcXFxsYXRlc3QtZ2hhJyxcbiAgICAgICAgICAgICAgJyRMYXRlc3RVcmwgPSBHZXQtQ29udGVudCAkRW52OlRFTVBcXFxcbGF0ZXN0LWdoYScsXG4gICAgICAgICAgICAgICckUlVOTkVSX1ZFUlNJT04gPSAoJExhdGVzdFVybCAtU3BsaXQgXFwnL1xcJylbLTFdLnN1YnN0cmluZygxKScsXG4gICAgICAgICAgICBdO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBydW5uZXJDb21tYW5kcyA9IFtgJFJVTk5FUl9WRVJTSU9OID0gJyR7cnVubmVyVmVyc2lvbi52ZXJzaW9ufSdgXTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBydW5uZXJDb21tYW5kcyA9IHJ1bm5lckNvbW1hbmRzLmNvbmNhdChbXG4gICAgICAgICAgICAvLyBjcmVhdGUgZGlyZWN0b3JpZXNcbiAgICAgICAgICAgICdta2RpciBDOlxcXFxob3N0ZWR0b29sY2FjaGVcXFxcd2luZG93cycsXG4gICAgICAgICAgICAnbWtkaXIgQzpcXFxcdG9vbHMnLFxuICAgICAgICAgICAgLy8gZG93bmxvYWQgenN0ZCBhbmQgZXh0cmFjdCB0byBDOlxcdG9vbHNcbiAgICAgICAgICAgICdjbWQgL2MgY3VybCAtdyBcIiV7cmVkaXJlY3RfdXJsfVwiIC1mc1MgaHR0cHM6Ly9naXRodWIuY29tL2ZhY2Vib29rL3pzdGQvcmVsZWFzZXMvbGF0ZXN0ID4gJEVudjpURU1QXFxcXGxhdGVzdC16c3RkJyxcbiAgICAgICAgICAgICckTGF0ZXN0VXJsID0gR2V0LUNvbnRlbnQgJEVudjpURU1QXFxcXGxhdGVzdC16c3RkJyxcbiAgICAgICAgICAgICckWlNURF9WRVJTSU9OID0gKCRMYXRlc3RVcmwgLVNwbGl0IFxcJy9cXCcpWy0xXS5zdWJzdHJpbmcoMSknLFxuICAgICAgICAgICAgJ0ludm9rZS1XZWJSZXF1ZXN0IC1Vc2VCYXNpY1BhcnNpbmcgLVVyaSBcImh0dHBzOi8vZ2l0aHViLmNvbS9mYWNlYm9vay96c3RkL3JlbGVhc2VzL2Rvd25sb2FkL3YkWlNURF9WRVJTSU9OL3pzdGQtdiRaU1REX1ZFUlNJT04td2luNjQuemlwXCIgLU91dEZpbGUgenN0ZC56aXAnLFxuICAgICAgICAgICAgJ0V4cGFuZC1BcmNoaXZlIHpzdGQuemlwIC1EZXN0aW5hdGlvblBhdGggQzpcXFxcdG9vbHMnLFxuICAgICAgICAgICAgJ01vdmUtSXRlbSAtUGF0aCBDOlxcXFx0b29sc1xcXFx6c3RkLXYkWlNURF9WRVJTSU9OLXdpbjY0XFxcXHpzdGQuZXhlIEM6XFxcXHRvb2xzJyxcbiAgICAgICAgICAgICdSZW1vdmUtSXRlbSAtTGl0ZXJhbFBhdGggXCJDOlxcXFx0b29sc1xcXFx6c3RkLXYkWlNURF9WRVJTSU9OLXdpbjY0XCIgLUZvcmNlIC1SZWN1cnNlJyxcbiAgICAgICAgICAgICdkZWwgenN0ZC56aXAnLFxuICAgICAgICAgICAgLy8gYWRkIEM6XFx0b29scyB0byBQQVRIXG4gICAgICAgICAgICAnJHBlcnNpc3RlZFBhdGhzID0gW0Vudmlyb25tZW50XTo6R2V0RW52aXJvbm1lbnRWYXJpYWJsZShcXCdQYXRoXFwnLCBbRW52aXJvbm1lbnRWYXJpYWJsZVRhcmdldF06Ok1hY2hpbmUpJyxcbiAgICAgICAgICAgICdbRW52aXJvbm1lbnRdOjpTZXRFbnZpcm9ubWVudFZhcmlhYmxlKFwiUEFUSFwiLCAkcGVyc2lzdGVkUGF0aHMgKyBcIjtDOlxcXFx0b29sc1wiLCBbRW52aXJvbm1lbnRWYXJpYWJsZVRhcmdldF06Ok1hY2hpbmUpJyxcbiAgICAgICAgICBdKTtcblxuICAgICAgICAgIHJldHVybiBydW5uZXJDb21tYW5kcy5jb25jYXQoW1xuICAgICAgICAgICAgJ0ludm9rZS1XZWJSZXF1ZXN0IC1Vc2VCYXNpY1BhcnNpbmcgLVVyaSBcImh0dHBzOi8vZ2l0aHViLmNvbS9hY3Rpb25zL3J1bm5lci9yZWxlYXNlcy9kb3dubG9hZC92JHtSVU5ORVJfVkVSU0lPTn0vYWN0aW9ucy1ydW5uZXItd2luLXg2NC0ke1JVTk5FUl9WRVJTSU9OfS56aXBcIiAtT3V0RmlsZSBhY3Rpb25zLnppcCcsXG4gICAgICAgICAgICAnRXhwYW5kLUFyY2hpdmUgYWN0aW9ucy56aXAgLURlc3RpbmF0aW9uUGF0aCBDOlxcXFxhY3Rpb25zJyxcbiAgICAgICAgICAgICdkZWwgYWN0aW9ucy56aXAnLFxuICAgICAgICAgICAgYGVjaG8gJHtydW5uZXJWZXJzaW9uLnZlcnNpb259IHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1Ob05ld2xpbmUgQzpcXFxcYWN0aW9uc1xcXFxSVU5ORVJfVkVSU0lPTmAsXG4gICAgICAgICAgXSk7XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3MvYXJjaGl0ZWN0dXJlIGNvbWJvIGZvciBnaXRodWIgcnVubmVyOiAke29zLm5hbWV9LyR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgICB9XG5cbiAgICAgIGdldERvY2tlckNvbW1hbmRzKF9vczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IHN0cmluZ1tdIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICBgRU5WIFJVTk5FUl9WRVJTSU9OPSR7cnVubmVyVmVyc2lvbi52ZXJzaW9ufWAsXG4gICAgICAgIF07XG4gICAgICB9XG4gICAgfSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY29tcG9uZW50IHRvIGluc3RhbGwgRG9ja2VyLlxuICAgKlxuICAgKiBPbiBXaW5kb3dzIHRoaXMgc2V0cyB1cCBkb2NrZXJkIGZvciBXaW5kb3dzIGNvbnRhaW5lcnMgd2l0aG91dCBEb2NrZXIgRGVza3RvcC4gSWYgeW91IG5lZWQgTGludXggY29udGFpbmVycyBvbiBXaW5kb3dzLCB5b3UnbGwgbmVlZCB0byBpbnN0YWxsIERvY2tlciBEZXNrdG9wIHdoaWNoIGRvZXNuJ3Qgc2VlbSB0byBwbGF5IHdlbGwgd2l0aCBzZXJ2ZXJzIChQUnMgd2VsY29tZSkuXG4gICAqXG4gICAqIEBwYXJhbSB2ZXJzaW9uIFNvZnR3YXJlIHZlcnNpb24gdG8gaW5zdGFsbCAoZS5nLiAnMjkuMS41JykuIERlZmF1bHQ6IGxhdGVzdC4gT25seSB1c2VkIG9uIFdpbmRvd3M7IG9uIExpbnV4IChVYnVudHUsIEFtYXpvbiBMaW51eCAyIGFuZCBBbWF6b24gTGludXggMjAyMykgdGhlIHBhY2thZ2UgdmVyc2lvbiBmb3JtYXQgaXMgbm90IHJlbGlhYmx5IHByZWRpY3RhYmxlIHNvIGxhdGVzdCBpcyBhbHdheXMgdXNlZC5cbiAgICovXG4gIHN0YXRpYyBkb2NrZXIodmVyc2lvbj86IHN0cmluZyk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICBjb25zdCB1c2VWZXJzaW9uID0gdmFsaWRhdGVWZXJzaW9uKHZlcnNpb24pO1xuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gJ0RvY2tlcic7XG5cbiAgICAgIGdldENvbW1hbmRzKG9zOiBPcywgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpIHtcbiAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpKSB7XG4gICAgICAgICAgaWYgKHVzZVZlcnNpb24pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgJ1J1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcih2ZXJzaW9uKTogdmVyc2lvbiBpcyBvbmx5IHVzZWQgb24gV2luZG93cy4gT24gVWJ1bnR1IHRoZSBhcHQgcGFja2FnZSB2ZXJzaW9uIGZvcm1hdCBpcyBub3QgcmVsaWFibHkgcHJlZGljdGFibGU7IHVzZSBsYXRlc3QgKG9taXQgdmVyc2lvbikgZm9yIFVidW50dSBpbWFnZXMuJyxcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAnY3VybCAtZnNTTCBodHRwczovL2Rvd25sb2FkLmRvY2tlci5jb20vbGludXgvdWJ1bnR1L2dwZyB8IHN1ZG8gZ3BnIC0tZGVhcm1vciAtbyAvdXNyL3NoYXJlL2tleXJpbmdzL2RvY2tlci5ncGcnLFxuICAgICAgICAgICAgJ2VjaG8gJyArXG4gICAgICAgICAgICAnICBcImRlYiBbYXJjaD0kKGRwa2cgLS1wcmludC1hcmNoaXRlY3R1cmUpIHNpZ25lZC1ieT0vdXNyL3NoYXJlL2tleXJpbmdzL2RvY2tlci5ncGddIGh0dHBzOi8vZG93bmxvYWQuZG9ja2VyLmNvbS9saW51eC91YnVudHUgJyArXG4gICAgICAgICAgICAnICAkKGxzYl9yZWxlYXNlIC1jcykgc3RhYmxlXCIgfCBzdWRvIHRlZSAvZXRjL2FwdC9zb3VyY2VzLmxpc3QuZC9kb2NrZXIubGlzdCA+IC9kZXYvbnVsbCcsXG4gICAgICAgICAgICAnYXB0LWdldCB1cGRhdGUnLFxuICAgICAgICAgICAgJ0RFQklBTl9GUk9OVEVORD1ub25pbnRlcmFjdGl2ZSBhcHQtZ2V0IGluc3RhbGwgLXkgZG9ja2VyLWNlIGRvY2tlci1jZS1jbGkgY29udGFpbmVyZC5pbyBkb2NrZXItY29tcG9zZS1wbHVnaW4nLFxuICAgICAgICAgICAgJ3VzZXJtb2QgLWFHIGRvY2tlciBydW5uZXInLFxuICAgICAgICAgICAgJ2xuIC1zIC91c3IvbGliZXhlYy9kb2NrZXIvY2xpLXBsdWdpbnMvZG9ja2VyLWNvbXBvc2UgL3Vzci9iaW4vZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIpKSB7XG4gICAgICAgICAgaWYgKHVzZVZlcnNpb24pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgJ1J1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcih2ZXJzaW9uKTogdmVyc2lvbiBpcyBvbmx5IHVzZWQgb24gV2luZG93cy4gT24gQW1hem9uIExpbnV4IHRoZSBwYWNrYWdlIHZlcnNpb24gaXMgbm90IHByZWRpY3RhYmxlOyB1c2UgbGF0ZXN0IChvbWl0IHZlcnNpb24pIGZvciBBbWF6b24gTGludXggaW1hZ2VzLicsXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2FtYXpvbi1saW51eC1leHRyYXMgaW5zdGFsbCBkb2NrZXInLFxuICAgICAgICAgICAgJ3VzZXJtb2QgLWEgLUcgZG9ja2VyIHJ1bm5lcicsXG4gICAgICAgICAgICAnY3VybCAtc2ZMbyAvdXNyL2Jpbi9kb2NrZXItY29tcG9zZSBodHRwczovL2dpdGh1Yi5jb20vZG9ja2VyL2NvbXBvc2UvcmVsZWFzZXMvbGF0ZXN0L2Rvd25sb2FkL2RvY2tlci1jb21wb3NlLSQodW5hbWUgLXMgfCB0ciBcXCdbOnVwcGVyOl1cXCcgXFwnWzpsb3dlcjpdXFwnKS0kKHVuYW1lIC1tKScsXG4gICAgICAgICAgICAnY2htb2QgK3ggL3Vzci9iaW4vZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgICAgICAgJ2xuIC1zIC91c3IvYmluL2RvY2tlci1jb21wb3NlIC91c3IvbGliZXhlYy9kb2NrZXIvY2xpLXBsdWdpbnMvZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgICAgIF07XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIwMjMpKSB7XG4gICAgICAgICAgaWYgKHVzZVZlcnNpb24pIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgJ1J1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcih2ZXJzaW9uKTogdmVyc2lvbiBpcyBvbmx5IHVzZWQgb24gV2luZG93cy4gT24gQW1hem9uIExpbnV4IHRoZSBwYWNrYWdlIHZlcnNpb24gaXMgbm90IHByZWRpY3RhYmxlOyB1c2UgbGF0ZXN0IChvbWl0IHZlcnNpb24pIGZvciBBbWF6b24gTGludXggaW1hZ2VzLicsXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgJ2RuZiBpbnN0YWxsIC15IGRvY2tlcicsXG4gICAgICAgICAgICAndXNlcm1vZCAtYSAtRyBkb2NrZXIgcnVubmVyJyxcbiAgICAgICAgICAgICdjdXJsIC1zZkxvIC91c3IvYmluL2RvY2tlci1jb21wb3NlIGh0dHBzOi8vZ2l0aHViLmNvbS9kb2NrZXIvY29tcG9zZS9yZWxlYXNlcy9sYXRlc3QvZG93bmxvYWQvZG9ja2VyLWNvbXBvc2UtJCh1bmFtZSAtcyB8IHRyIFxcJ1s6dXBwZXI6XVxcJyBcXCdbOmxvd2VyOl1cXCcpLSQodW5hbWUgLW0pJyxcbiAgICAgICAgICAgICdjaG1vZCAreCAvdXNyL2Jpbi9kb2NrZXItY29tcG9zZScsXG4gICAgICAgICAgICAnbG4gLXMgL3Vzci9iaW4vZG9ja2VyLWNvbXBvc2UgL3Vzci9saWJleGVjL2RvY2tlci9jbGktcGx1Z2lucy9kb2NrZXItY29tcG9zZScsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgICAgIGNvbnN0IGRvd25sb2FkQ29tbWFuZHMgPSB1c2VWZXJzaW9uID8gW1xuICAgICAgICAgICAgYEludm9rZS1XZWJSZXF1ZXN0IC1Vc2VCYXNpY1BhcnNpbmcgLVVyaSBcImh0dHBzOi8vZG93bmxvYWQuZG9ja2VyLmNvbS93aW4vc3RhdGljL3N0YWJsZS94ODZfNjQvZG9ja2VyLSR7dXNlVmVyc2lvbn0uemlwXCIgLU91dEZpbGUgZG9ja2VyLnppcGAsXG4gICAgICAgICAgXSA6IFtcbiAgICAgICAgICAgICckQmFzZVVybCA9IFwiaHR0cHM6Ly9kb3dubG9hZC5kb2NrZXIuY29tL3dpbi9zdGF0aWMvc3RhYmxlL3g4Nl82NC9cIicsXG4gICAgICAgICAgICAnJGh0bWwgPSBJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgJEJhc2VVcmwnLFxuICAgICAgICAgICAgJyRmaWxlcyA9ICRodG1sLkxpbmtzLmhyZWYgfCBXaGVyZS1PYmplY3QgeyAkXyAtbWF0Y2ggXFwnXmRvY2tlci1bMC05XFxcXC5dK1xcXFwuemlwJFxcJyB9JyxcbiAgICAgICAgICAgICdpZiAoLW5vdCAkZmlsZXMpIHsgV3JpdGUtRXJyb3IgXCJObyBkb2NrZXItKi56aXAgZmlsZXMgZm91bmQuXCIgOyBleGl0IDEgfScsXG4gICAgICAgICAgICAnJGxhdGVzdCA9ICRmaWxlcyB8IFNvcnQtT2JqZWN0IHsgdHJ5IHsgW1ZlcnNpb25dKCRfIC1yZXBsYWNlIFxcJ15kb2NrZXItfFxcXFwuemlwJFxcJykgfSBjYXRjaCB7IFtWZXJzaW9uXVwiMC4wLjBcIiB9IH0gLURlc2NlbmRpbmcgfCBTZWxlY3QtT2JqZWN0IC1GaXJzdCAxJyxcbiAgICAgICAgICAgICdJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgJEJhc2VVcmwkbGF0ZXN0IC1PdXRGaWxlIGRvY2tlci56aXAnLFxuICAgICAgICAgIF07XG4gICAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIC8vIGRvd25sb2FkIHN0YXRpYyBiaW5hcmllc1xuICAgICAgICAgICAgLi4uZG93bmxvYWRDb21tYW5kcyxcbiAgICAgICAgICAgIC8vIGV4dHJhY3QgdG8gQzpcXFByb2dyYW0gRmlsZXNcXERvY2tlclxuICAgICAgICAgICAgJ0V4cGFuZC1BcmNoaXZlIGRvY2tlci56aXAgLURlc3RpbmF0aW9uUGF0aCBcIiRFbnY6UHJvZ3JhbUZpbGVzXCInLFxuICAgICAgICAgICAgJ2RlbCBkb2NrZXIuemlwJyxcbiAgICAgICAgICAgIC8vIGFkZCB0byBwYXRoXG4gICAgICAgICAgICAnJHBlcnNpc3RlZFBhdGhzID0gW0Vudmlyb25tZW50XTo6R2V0RW52aXJvbm1lbnRWYXJpYWJsZShcXCdQYXRoXFwnLCBbRW52aXJvbm1lbnRWYXJpYWJsZVRhcmdldF06Ok1hY2hpbmUpJyxcbiAgICAgICAgICAgICdbRW52aXJvbm1lbnRdOjpTZXRFbnZpcm9ubWVudFZhcmlhYmxlKFwiUEFUSFwiLCAkcGVyc2lzdGVkUGF0aHMgKyBcIjskRW52OlByb2dyYW1GaWxlc1xcXFxEb2NrZXJcIiwgW0Vudmlyb25tZW50VmFyaWFibGVUYXJnZXRdOjpNYWNoaW5lKScsXG4gICAgICAgICAgICAnJGVudjpQQVRIID0gJGVudjpQQVRIICsgXCI7JEVudjpQcm9ncmFtRmlsZXNcXFxcRG9ja2VyXCInLFxuICAgICAgICAgICAgLy8gcmVnaXN0ZXIgZG9ja2VyIHNlcnZpY2VcbiAgICAgICAgICAgICdkb2NrZXJkIC0tcmVnaXN0ZXItc2VydmljZScsXG4gICAgICAgICAgICAnaWYgKCRMQVNURVhJVENPREUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJExBU1RFWElUQ09ERVwiIH0nLFxuICAgICAgICAgICAgLy8gZW5hYmxlIGNvbnRhaW5lcnMgZmVhdHVyZVxuICAgICAgICAgICAgJ0VuYWJsZS1XaW5kb3dzT3B0aW9uYWxGZWF0dXJlIC1PbmxpbmUgLUZlYXR1cmVOYW1lIGNvbnRhaW5lcnMgLUFsbCAtTm9SZXN0YXJ0JyxcbiAgICAgICAgICAgIC8vIGluc3RhbGwgZG9ja2VyLWNvbXBvc2VcbiAgICAgICAgICAgICdjbWQgL2MgY3VybCAtdyBcIiV7cmVkaXJlY3RfdXJsfVwiIC1mc1MgaHR0cHM6Ly9naXRodWIuY29tL2RvY2tlci9jb21wb3NlL3JlbGVhc2VzL2xhdGVzdCA+ICRFbnY6VEVNUFxcXFxsYXRlc3QtZG9ja2VyLWNvbXBvc2UnLFxuICAgICAgICAgICAgJyRMYXRlc3RVcmwgPSBHZXQtQ29udGVudCAkRW52OlRFTVBcXFxcbGF0ZXN0LWRvY2tlci1jb21wb3NlJyxcbiAgICAgICAgICAgICckTGF0ZXN0RG9ja2VyQ29tcG9zZSA9ICgkTGF0ZXN0VXJsIC1TcGxpdCBcXCcvXFwnKVstMV0nLFxuICAgICAgICAgICAgJ0ludm9rZS1XZWJSZXF1ZXN0IC1Vc2VCYXNpY1BhcnNpbmcgLVVyaSAgXCJodHRwczovL2dpdGh1Yi5jb20vZG9ja2VyL2NvbXBvc2UvcmVsZWFzZXMvZG93bmxvYWQvJHtMYXRlc3REb2NrZXJDb21wb3NlfS9kb2NrZXItY29tcG9zZS1XaW5kb3dzLXg4Nl82NC5leGVcIiAtT3V0RmlsZSAkRW52OlByb2dyYW1GaWxlc1xcXFxEb2NrZXJcXFxcZG9ja2VyLWNvbXBvc2UuZXhlJyxcbiAgICAgICAgICAgICdOZXctSXRlbSAtSXRlbVR5cGUgZGlyZWN0b3J5IC1QYXRoIFwiJEVudjpQcm9ncmFtRmlsZXNcXFxcRG9ja2VyXFxcXGNsaS1wbHVnaW5zXCInLFxuICAgICAgICAgICAgJ0NvcHktSXRlbSAtUGF0aCBcIiRFbnY6UHJvZ3JhbUZpbGVzXFxcXERvY2tlclxcXFxkb2NrZXItY29tcG9zZS5leGVcIiAtRGVzdGluYXRpb24gXCIkRW52OlByb2dyYW1GaWxlc1xcXFxEb2NrZXJcXFxcY2xpLXBsdWdpbnNcXFxcZG9ja2VyLWNvbXBvc2UuZXhlXCInLFxuICAgICAgICAgIF07XG4gICAgICAgIH1cblxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3MvYXJjaGl0ZWN0dXJlIGNvbWJvIGZvciBkb2NrZXI6ICR7b3MubmFtZX0vJHthcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICAgIH1cblxuICAgICAgc2hvdWxkUmVib290KG9zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogYm9vbGVhbiB7XG4gICAgICAgIHJldHVybiBvcy5pcyhPcy5XSU5ET1dTKTtcbiAgICAgIH1cbiAgICB9KCk7XG4gIH1cblxuICAvKipcbiAgICogQSBjb21wb25lbnQgdG8gaW5zdGFsbCBEb2NrZXItaW4tRG9ja2VyLlxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgYGRvY2tlcigpYFxuICAgKiBAcGFyYW0gdmVyc2lvbiBTb2Z0d2FyZSB2ZXJzaW9uIHRvIGluc3RhbGwgKGUuZy4gJzI5LjEuNScpLiBEZWZhdWx0OiBsYXRlc3QuXG4gICAqL1xuICBzdGF0aWMgZG9ja2VySW5Eb2NrZXIodmVyc2lvbj86IHN0cmluZyk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICByZXR1cm4gUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyKHZlcnNpb24pO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY29tcG9uZW50IHRvIGFkZCBhIHRydXN0ZWQgY2VydGlmaWNhdGUgYXV0aG9yaXR5LiBUaGlzIGNhbiBiZSB1c2VkIHRvIHN1cHBvcnQgR2l0SHViIEVudGVycHJpc2UgU2VydmVyIHdpdGggc2VsZi1zaWduZWQgY2VydGlmaWNhdGUuXG4gICAqXG4gICAqIEBwYXJhbSBzb3VyY2UgcGF0aCB0byBjZXJ0aWZpY2F0ZSBmaWxlIGluIFBFTSBmb3JtYXQsIG9yIGEgZGlyZWN0b3J5IGNvbnRhaW5pbmcgY2VydGlmaWNhdGUgZmlsZXMgKC5wZW0gb3IgLmNydClcbiAgICogQHBhcmFtIG5hbWUgdW5pcXVlIGNlcnRpZmljYXRlIG5hbWUgdG8gYmUgdXNlZCBvbiBydW5uZXIgZmlsZSBzeXN0ZW1cbiAgICovXG4gIHN0YXRpYyBleHRyYUNlcnRpZmljYXRlcyhzb3VyY2U6IHN0cmluZywgbmFtZTogc3RyaW5nKTogUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgIC8vIFNhbml0aXplIHRoZSBuYW1lIHRvIG9ubHkgY29udGFpbiBhbHBoYW51bWVyaWMgY2hhcmFjdGVycywgZGFzaGVzIGFuZCB1bmRlcnNjb3Jlc1xuICAgIGNvbnN0IHNhbml0aXplZE5hbWUgPSBuYW1lLnJlcGxhY2UoL1teYS16QS1aMC05Xy1dL2csICctJyk7XG5cbiAgICAvLyBEaXNjb3ZlciBjZXJ0aWZpY2F0ZSBmaWxlcyAoc3VwcG9ydHMgYm90aCBmaWxlIGFuZCBkaXJlY3RvcnkpXG4gICAgY29uc3QgY2VydGlmaWNhdGVGaWxlcyA9IGRpc2NvdmVyQ2VydGlmaWNhdGVGaWxlcyhzb3VyY2UpO1xuXG4gICAgcmV0dXJuIG5ldyBjbGFzcyBleHRlbmRzIFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICAgIG5hbWUgPSBgRXh0cmEtQ2VydGlmaWNhdGVzLSR7c2FuaXRpemVkTmFtZX1gO1xuXG4gICAgICBnZXRDb21tYW5kcyhvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgICAgIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfVUJVTlRVX1ZFUlNJT05TKSkge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAndXBkYXRlLWNhLWNlcnRpZmljYXRlcycsXG4gICAgICAgICAgXTtcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfQU1BWk9OX1ZFUlNJT05TKSkge1xuICAgICAgICAgIHJldHVybiBbXG4gICAgICAgICAgICAndXBkYXRlLWNhLXRydXN0JyxcbiAgICAgICAgICBdO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgY29uc3QgY29tbWFuZHM6IHN0cmluZ1tdID0gW107XG4gICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBjZXJ0aWZpY2F0ZUZpbGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBjZXJ0TmFtZSA9IGAke3Nhbml0aXplZE5hbWV9LSR7aX1gO1xuICAgICAgICAgICAgY29tbWFuZHMucHVzaChcbiAgICAgICAgICAgICAgYEltcG9ydC1DZXJ0aWZpY2F0ZSAtRmlsZVBhdGggQzpcXFxcJHtjZXJ0TmFtZX0uY3J0IC1DZXJ0U3RvcmVMb2NhdGlvbiBDZXJ0OlxcXFxMb2NhbE1hY2hpbmVcXFxcUm9vdGAsXG4gICAgICAgICAgICAgIGBSZW1vdmUtSXRlbSBDOlxcXFwke2NlcnROYW1lfS5jcnRgLFxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIGNvbW1hbmRzO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9zL2FyY2hpdGVjdHVyZSBjb21ibyBmb3IgZXh0cmEgY2VydGlmaWNhdGVzOiAke29zLm5hbWV9LyR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgICB9XG5cbiAgICAgIGdldEFzc2V0cyhvczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IFJ1bm5lckltYWdlQXNzZXRbXSB7XG4gICAgICAgIGNvbnN0IGFzc2V0czogUnVubmVySW1hZ2VBc3NldFtdID0gW107XG5cbiAgICAgICAgbGV0IHRhcmdldERpcjogc3RyaW5nO1xuICAgICAgICBpZiAob3MuaXNJbihPcy5fQUxMX0xJTlVYX1VCVU5UVV9WRVJTSU9OUykpIHtcbiAgICAgICAgICB0YXJnZXREaXIgPSAnL3Vzci9sb2NhbC9zaGFyZS9jYS1jZXJ0aWZpY2F0ZXMvJztcbiAgICAgICAgfSBlbHNlIGlmIChvcy5pc0luKE9zLl9BTExfTElOVVhfQU1BWk9OX1ZFUlNJT05TKSkge1xuICAgICAgICAgIHRhcmdldERpciA9ICcvZXRjL3BraS9jYS10cnVzdC9zb3VyY2UvYW5jaG9ycy8nO1xuICAgICAgICB9IGVsc2UgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICAgICAgdGFyZ2V0RGlyID0gJ0M6XFxcXCc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBPUyBmb3IgZXh0cmEgY2VydGlmaWNhdGVzOiAke29zLm5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNlcnRpZmljYXRlRmlsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICBjb25zdCBjZXJ0TmFtZSA9IGAke3Nhbml0aXplZE5hbWV9LSR7aX1gO1xuICAgICAgICAgIGFzc2V0cy5wdXNoKHtcbiAgICAgICAgICAgIHNvdXJjZTogY2VydGlmaWNhdGVGaWxlc1tpXSxcbiAgICAgICAgICAgIHRhcmdldDogYCR7dGFyZ2V0RGlyfSR7Y2VydE5hbWV9LmNydGAsXG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gYXNzZXRzO1xuICAgICAgfVxuICAgIH0oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGNvbXBvbmVudCB0byBzZXQgdXAgdGhlIHJlcXVpcmVkIExhbWJkYSBlbnRyeXBvaW50IGZvciBMYW1iZGEgcnVubmVycy5cbiAgICovXG4gIHN0YXRpYyBsYW1iZGFFbnRyeXBvaW50KCk6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICByZXR1cm4gbmV3IGNsYXNzIGV4dGVuZHMgUnVubmVySW1hZ2VDb21wb25lbnQge1xuICAgICAgbmFtZSA9ICdMYW1iZGEtRW50cnlwb2ludCc7XG5cbiAgICAgIGdldENvbW1hbmRzKG9zOiBPcywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgICAgIGlmICghb3MuaXNJbihPcy5fQUxMX0xJTlVYX1ZFUlNJT05TKSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgT1MgZm9yIExhbWJkYSBlbnRyeXBvaW50OiAke29zLm5hbWV9YCk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gW107XG4gICAgICB9XG5cbiAgICAgIGdldEFzc2V0cyhfb3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpOiBSdW5uZXJJbWFnZUFzc2V0W10ge1xuICAgICAgICByZXR1cm4gW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNvdXJjZTogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Fzc2V0cycsICdwcm92aWRlcnMnLCAnbGFtYmRhLWJvb3RzdHJhcC5zaCcpLFxuICAgICAgICAgICAgdGFyZ2V0OiAnL2Jvb3RzdHJhcC5zaCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzb3VyY2U6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdhc3NldHMnLCAncHJvdmlkZXJzJywgJ2xhbWJkYS1ydW5uZXIuc2gnKSxcbiAgICAgICAgICAgIHRhcmdldDogJy9ydW5uZXIuc2gnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF07XG4gICAgICB9XG5cbiAgICAgIGdldERvY2tlckNvbW1hbmRzKF9vczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IHN0cmluZ1tdIHtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAnTEFCRUwgRElTQUJMRV9TT0NJPTEnLCAvLyBoYWNreSB3YXkgdG8gZGlzYWJsZSBzb2NpIHYyIGluZGV4aW5nIG9uIGxhbWJkYSBhcyBsYW1iZGEgd2lsbCBmYWlsIHRvIHN0YXJ0IHdpdGggYW4gaW5kZXhcbiAgICAgICAgICAnRU5UUllQT0lOVCBbXCJiYXNoXCIsIFwiL2Jvb3RzdHJhcC5zaFwiXScsXG4gICAgICAgIF07XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGNvbXBvbmVudCB0byBhZGQgZW52aXJvbm1lbnQgdmFyaWFibGVzIGZvciBqb2JzIHRoZSBydW5uZXIgZXhlY3V0ZXMuXG4gICAqXG4gICAqIFRoZXNlIHZhcmlhYmxlcyBvbmx5IGFmZmVjdCB0aGUgam9icyByYW4gYnkgdGhlIHJ1bm5lci4gVGhleSBhcmUgbm90IGdsb2JhbC4gVGhleSBkbyBub3QgYWZmZWN0IG90aGVyIGNvbXBvbmVudHMuXG4gICAqXG4gICAqIEl0IGlzIG5vdCByZWNvbW1lbmRlZCB0byB1c2UgdGhpcyBjb21wb25lbnQgdG8gcGFzcyBzZWNyZXRzLiBJbnN0ZWFkLCB1c2UgR2l0SHViIFNlY3JldHMgb3IgQVdTIFNlY3JldHMgTWFuYWdlci5cbiAgICpcbiAgICogTXVzdCBiZSB1c2VkIGFmdGVyIHRoZSB7QGxpbmsgZ2l0aHViUnVubmVyfSBjb21wb25lbnQuXG4gICAqL1xuICBzdGF0aWMgZW52aXJvbm1lbnRWYXJpYWJsZXModmFyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPik6IFJ1bm5lckltYWdlQ29tcG9uZW50IHtcbiAgICBPYmplY3QuZW50cmllcyh2YXJzKS5mb3JFYWNoKGUgPT4ge1xuICAgICAgaWYgKGVbMF0uaW5jbHVkZXMoJ1xcbicpIHx8IGVbMV0uaW5jbHVkZXMoJ1xcbicpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgRW52aXJvbm1lbnQgdmFyaWFibGUgY2Fubm90IGNvbnRhaW4gbmV3bGluZXM6ICR7ZX1gKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiBuZXcgY2xhc3MgZXh0ZW5kcyBSdW5uZXJJbWFnZUNvbXBvbmVudCB7XG4gICAgICBuYW1lID0gJ0Vudmlyb25tZW50VmFyaWFibGVzJztcblxuICAgICAgZ2V0Q29tbWFuZHMob3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpIHtcbiAgICAgICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgICAgICByZXR1cm4gT2JqZWN0LmVudHJpZXModmFycykubWFwKGUgPT4gYGVjaG8gJyR7ZVswXX09JHtlWzFdLnJlcGxhY2UoLycvZywgXCInXFxcIidcXFwiJ1wiKX0nID4+IC9ob21lL3J1bm5lci8uZW52YCk7XG4gICAgICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgICAgICByZXR1cm4gT2JqZWN0LmVudHJpZXModmFycykubWFwKGUgPT4gYEFkZC1Db250ZW50IC1QYXRoIEM6XFxcXGFjdGlvbnNcXFxcLmVudiAtVmFsdWUgJyR7ZVswXX09JHtlWzFdLnJlcGxhY2UoLycvZywgXCInJ1wiKX0nYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBPUyBmb3IgZW52aXJvbm1lbnQgdmFyaWFibGVzIGNvbXBvbmVudDogJHtvcy5uYW1lfWApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb21wb25lbnQgbmFtZS5cbiAgICpcbiAgICogVXNlZCB0byBpZGVudGlmeSBjb21wb25lbnQgaW4gaW1hZ2UgYnVpbGQgbG9ncywgYW5kIGZvciB7QGxpbmsgSUNvbmZpZ3VyYWJsZVJ1bm5lckltYWdlQnVpbGRlci5yZW1vdmVDb21wb25lbnR9XG4gICAqL1xuICBhYnN0cmFjdCByZWFkb25seSBuYW1lOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFJldHVybnMgY29tbWFuZHMgdG8gcnVuIHRvIGluIGJ1aWx0IGltYWdlLiBDYW4gYmUgdXNlZCB0byBpbnN0YWxsIHBhY2thZ2VzLCBzZXR1cCBidWlsZCBwcmVyZXF1aXNpdGVzLCBldGMuXG4gICAqL1xuICBhYnN0cmFjdCBnZXRDb21tYW5kcyhfb3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpOiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogUmV0dXJucyBhc3NldHMgdG8gY29weSBpbnRvIHRoZSBidWlsdCBpbWFnZS4gQ2FuIGJlIHVzZWQgdG8gY29weSBmaWxlcyBpbnRvIHRoZSBpbWFnZS5cbiAgICovXG4gIGdldEFzc2V0cyhfb3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpOiBSdW5uZXJJbWFnZUFzc2V0W10ge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIERvY2tlciBjb21tYW5kcyB0byBydW4gdG8gaW4gYnVpbHQgaW1hZ2UuIENhbiBiZSB1c2VkIHRvIGFkZCBjb21tYW5kcyBsaWtlIGBWT0xVTUVgLCBgRU5UUllQT0lOVGAsIGBDTURgLCBldGMuXG4gICAqXG4gICAqIERvY2tlciBjb21tYW5kcyBhcmUgYWRkZWQgYWZ0ZXIgYXNzZXRzIGFuZCBub3JtYWwgY29tbWFuZHMuXG4gICAqL1xuICBnZXREb2NrZXJDb21tYW5kcyhfb3M6IE9zLCBfYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpOiBzdHJpbmdbXSB7XG4gICAgcmV0dXJuIFtdO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgdHJ1ZSBpZiB0aGUgaW1hZ2UgYnVpbGRlciBzaG91bGQgYmUgcmVib290ZWQgYWZ0ZXIgdGhpcyBjb21wb25lbnQgaXMgaW5zdGFsbGVkLlxuICAgKi9cbiAgc2hvdWxkUmVib290KF9vczogT3MsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0IGNvbXBvbmVudCB0byBhbiBBV1MgSW1hZ2UgQnVpbGRlciBjb21wb25lbnQuXG4gICAqXG4gICAqIENvbXBvbmVudHMgYXJlIGNhY2hlZCBhbmQgcmV1c2VkIHdoZW4gdGhlIHNhbWUgY29tcG9uZW50IGlzIHJlcXVlc3RlZCB3aXRoIHRoZSBzYW1lXG4gICAqIE9TIGFuZCBhcmNoaXRlY3R1cmUsIHJlZHVjaW5nIHN0YWNrIHRlbXBsYXRlIHNpemUgYW5kIG51bWJlciBvZiByZXNvdXJjZXMuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgX2FzQXdzSW1hZ2VCdWlsZGVyQ29tcG9uZW50KHNjb3BlOiBDb25zdHJ1Y3QsIG9zOiBPcywgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUpIHtcbiAgICBsZXQgcGxhdGZvcm06ICdMaW51eCcgfCAnV2luZG93cyc7XG4gICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9VQlVOVFVfVkVSU0lPTlMpIHx8IG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9BTUFaT05fVkVSU0lPTlMpKSB7XG4gICAgICBwbGF0Zm9ybSA9ICdMaW51eCc7XG4gICAgfSBlbHNlIGlmIChvcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgcGxhdGZvcm0gPSAnV2luZG93cyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcy9hcmNoaXRlY3R1cmUgY29tYm8gZm9yIGltYWdlIGJ1aWxkZXIgY29tcG9uZW50OiAke29zLm5hbWV9LyR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgfVxuXG4gICAgLy8gR2V0IGNvbXBvbmVudCBwcm9wZXJ0aWVzIHRvIGNyZWF0ZSBhIGNhY2hlIGtleVxuICAgIGNvbnN0IGNvbW1hbmRzID0gdGhpcy5nZXRDb21tYW5kcyhvcywgYXJjaGl0ZWN0dXJlKTtcbiAgICBjb25zdCBhc3NldHMgPSB0aGlzLmdldEFzc2V0cyhvcywgYXJjaGl0ZWN0dXJlKTtcbiAgICBjb25zdCByZWJvb3QgPSB0aGlzLnNob3VsZFJlYm9vdChvcywgYXJjaGl0ZWN0dXJlKTtcblxuICAgIC8vIENyZWF0ZSBhIGNhY2hlIGtleSBiYXNlZCBvbiBjb21wb25lbnQgaWRlbnRpdHkgYW5kIHByb3BlcnRpZXNcbiAgICBjb25zdCBzdGFjayA9IGNkay5TdGFjay5vZihzY29wZSk7XG4gICAgY29uc3QgY2FjaGVLZXkgPSB0aGlzLl9nZXRDYWNoZUtleShvcywgYXJjaGl0ZWN0dXJlLCBjb21tYW5kcywgYXNzZXRzLCByZWJvb3QpO1xuXG4gICAgLy8gQ3JlYXRlIGEgY29uc2lzdGVudCBJRCBiYXNlZCBvbiB0aGUgY2FjaGUga2V5IHRvIGVuc3VyZSB0aGUgc2FtZSBjb21wb25lbnRcbiAgICAvLyBhbHdheXMgZ2V0cyB0aGUgc2FtZSBJRCwgcmVnYXJkbGVzcyBvZiB0aGUgcGFzc2VkLWluIGlkIHBhcmFtZXRlclxuICAgIC8vIFRoZSBjYWNoZSBrZXkgaXMgYWxyZWFkeSBhIGhhc2gsIHNvIHdlIGNhbiB1c2UgaXQgZGlyZWN0bHlcbiAgICAvLyBQcmVmaXggd2l0aCBHSFJJbnRlcm5hbC8gdG8gYXZvaWQgY29uZmxpY3RzIHdpdGggdXNlci1kZWZpbmVkIGNvbnN0cnVjdHNcbiAgICBjb25zdCBjb25zaXN0ZW50SWQgPSBgR0hSSW50ZXJuYWwvQ29tcG9uZW50LSR7dGhpcy5uYW1lfS0ke29zLm5hbWV9LSR7YXJjaGl0ZWN0dXJlLm5hbWV9LSR7Y2FjaGVLZXkuc3Vic3RyaW5nKDAsIDEwKX1gLnJlcGxhY2UoL1teYS16QS1aMC05LS9dL2csICctJyk7XG5cbiAgICAvLyBVc2UgdGhlIGNvbnN0cnVjdCB0cmVlIGFzIHRoZSBjYWNoZSAtIGNoZWNrIGlmIGNvbXBvbmVudCBhbHJlYWR5IGV4aXN0cyBpbiB0aGUgc3RhY2tcbiAgICBjb25zdCBleGlzdGluZyA9IHN0YWNrLm5vZGUudHJ5RmluZENoaWxkKGNvbnNpc3RlbnRJZCk7XG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAvLyBDb21wb25lbnQgYWxyZWFkeSBleGlzdHMgaW4gdGhpcyBzdGFjaywgcmV1c2UgaXRcbiAgICAgIHJldHVybiBleGlzdGluZyBhcyBJbWFnZUJ1aWxkZXJDb21wb25lbnQ7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIG5ldyBjb21wb25lbnQgaW4gdGhlIHN0YWNrIHNjb3BlIHNvIGl0IGNhbiBiZSBzaGFyZWQgYWNyb3NzIGFsbCBzY29wZXMgaW4gdGhlIHNhbWUgc3RhY2tcbiAgICBjb25zdCBjb21wb25lbnQgPSBuZXcgSW1hZ2VCdWlsZGVyQ29tcG9uZW50KHN0YWNrLCBjb25zaXN0ZW50SWQsIHtcbiAgICAgIHBsYXRmb3JtOiBwbGF0Zm9ybSxcbiAgICAgIGNvbW1hbmRzOiBjb21tYW5kcyxcbiAgICAgIGFzc2V0czogYXNzZXRzLm1hcCgoYXNzZXQsIGluZGV4KSA9PiB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgYXNzZXQ6IG5ldyBzM19hc3NldHMuQXNzZXQoc3RhY2ssIGBHSFJJbnRlcm5hbC8ke2NvbnNpc3RlbnRJZH0vQXNzZXQke2luZGV4fWAsIHsgcGF0aDogYXNzZXQuc291cmNlIH0pLFxuICAgICAgICAgIHBhdGg6IGFzc2V0LnRhcmdldCxcbiAgICAgICAgfTtcbiAgICAgIH0pLFxuICAgICAgZGlzcGxheU5hbWU6IGAke3RoaXMubmFtZX0gKCR7b3MubmFtZX0vJHthcmNoaXRlY3R1cmUubmFtZX0pYCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgJHt0aGlzLm5hbWV9IGNvbXBvbmVudCBmb3IgJHtvcy5uYW1lfS8ke2FyY2hpdGVjdHVyZS5uYW1lfWAsXG4gICAgICByZWJvb3Q6IHJlYm9vdCxcbiAgICB9KTtcblxuICAgIHJldHVybiBjb21wb25lbnQ7XG4gIH1cblxuICAvKipcbiAgICogR2VuZXJhdGUgYSBjYWNoZSBrZXkgZm9yIGNvbXBvbmVudCByZXVzZS5cbiAgICogQ29tcG9uZW50cyB3aXRoIHRoZSBzYW1lIG5hbWUsIE9TLCBhcmNoaXRlY3R1cmUsIGNvbW1hbmRzLCBhc3NldHMsIGFuZCByZWJvb3QgZmxhZyB3aWxsIHNoYXJlIHRoZSBzYW1lIGtleS5cbiAgICogUmV0dXJucyBhIGhhc2ggb2YgYWxsIGNvbXBvbmVudCBwcm9wZXJ0aWVzIHRvIGVuc3VyZSB1bmlxdWVuZXNzLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIHByaXZhdGUgX2dldENhY2hlS2V5KG9zOiBPcywgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUsIGNvbW1hbmRzOiBzdHJpbmdbXSwgYXNzZXRzOiBSdW5uZXJJbWFnZUFzc2V0W10sIHJlYm9vdDogYm9vbGVhbik6IHN0cmluZyB7XG4gICAgLy8gQ3JlYXRlIGEgaGFzaCBvZiB0aGUgY29tcG9uZW50IHByb3BlcnRpZXNcbiAgICBjb25zdCBhc3NldEtleXMgPSBhc3NldHMubWFwKGEgPT4gYCR7YS5zb3VyY2V9OiR7YS50YXJnZXR9YCkuc29ydCgpLmpvaW4oJ3wnKTtcbiAgICBjb25zdCBrZXlEYXRhID0gYCR7dGhpcy5uYW1lfToke29zLm5hbWV9OiR7YXJjaGl0ZWN0dXJlLm5hbWV9OiR7Y29tbWFuZHMuam9pbignXFxuJyl9OiR7YXNzZXRLZXlzfToke3JlYm9vdH1gO1xuICAgIHJldHVybiBjcnlwdG8uY3JlYXRlSGFzaCgnbWQ1JykudXBkYXRlKGtleURhdGEpLmRpZ2VzdCgnaGV4Jyk7XG4gIH1cbn1cblxuIl19