"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinuxUbuntuComponents = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const providers_1 = require("../../../providers");
const index_1 = require("../index");
/**
 * Components for Ubuntu Linux that can be used with AWS Image Builder based builders. These cannot be used by {@link CodeBuildImageBuilder}.
 *
 * @deprecated Use `RunnerImageComponent` instead.
 */
class LinuxUbuntuComponents {
    static requiredPackages(scope, id, architecture) {
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
        return new index_1.ImageBuilderComponent(scope, id, {
            platform: 'Linux',
            displayName: 'Required packages',
            description: 'Install packages required for GitHub Runner and upgrade all packages',
            commands: [
                'apt-get update',
                'DEBIAN_FRONTEND=noninteractive apt-get upgrade -y',
                'DEBIAN_FRONTEND=noninteractive apt-get install -y curl sudo jq bash zip unzip iptables software-properties-common ca-certificates',
                `curl -sfLo /tmp/amazon-cloudwatch-agent.deb https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/${archUrl}/latest/amazon-cloudwatch-agent.deb`,
                'dpkg -i -E /tmp/amazon-cloudwatch-agent.deb',
                'rm /tmp/amazon-cloudwatch-agent.deb',
            ],
        });
    }
    static runnerUser(scope, id, _architecture) {
        return new index_1.ImageBuilderComponent(scope, id, {
            platform: 'Linux',
            displayName: 'GitHub Runner user',
            description: 'Install latest version of AWS CLI',
            commands: [
                'addgroup runner',
                'adduser --system --disabled-password --home /home/runner --ingroup runner runner',
                'echo "%runner   ALL=(ALL:ALL) NOPASSWD: ALL" > /etc/sudoers.d/runner',
            ],
        });
    }
    static awsCli(scope, id, architecture) {
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
        return new index_1.ImageBuilderComponent(scope, id, {
            platform: 'Linux',
            displayName: 'AWS CLI',
            description: 'Install latest version of AWS CLI',
            commands: [
                `curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${archUrl}.zip" -o awscliv2.zip`,
                'unzip -q awscliv2.zip',
                './aws/install',
                'rm -rf awscliv2.zip aws',
            ],
        });
    }
    static githubCli(scope, id, _architecture) {
        return new index_1.ImageBuilderComponent(scope, id, {
            platform: 'Linux',
            displayName: 'GitHub CLI',
            description: 'Install latest version of gh',
            commands: [
                'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg',
                'echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] ' +
                    '  https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null',
                'apt-get update',
                'DEBIAN_FRONTEND=noninteractive apt-get install -y gh',
            ],
        });
    }
    static git(scope, id, _architecture) {
        return new index_1.ImageBuilderComponent(scope, id, {
            platform: 'Linux',
            displayName: 'Git',
            description: 'Install latest version of git',
            commands: [
                'add-apt-repository ppa:git-core/ppa',
                'apt-get update',
                'DEBIAN_FRONTEND=noninteractive apt-get install -y git',
            ],
        });
    }
    static githubRunner(scope, id, runnerVersion, architecture) {
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
        return new index_1.ImageBuilderComponent(scope, id, {
            platform: 'Linux',
            displayName: 'GitHub Actions Runner',
            description: 'Install latest version of GitHub Actions Runner',
            commands: [
                versionCommand,
                `curl -fsSLO "https://github.com/actions/runner/releases/download/v\${RUNNER_VERSION}/actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz"`,
                `tar xzf "actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz"`,
                `rm actions-runner-linux-${archUrl}-\${RUNNER_VERSION}.tar.gz`,
                './bin/installdependencies.sh',
                `echo -n ${runnerVersion.version} > RUNNER_VERSION`,
            ],
        });
    }
    static docker(scope, id, _architecture) {
        return new index_1.ImageBuilderComponent(scope, id, {
            platform: 'Linux',
            displayName: 'Docker',
            description: 'Install latest version of Docker',
            commands: [
                'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg',
                'echo ' +
                    '  "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ' +
                    '  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null',
                'apt-get update',
                'DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin',
                'usermod -aG docker runner',
                'ln -s /usr/libexec/docker/cli-plugins/docker-compose /usr/bin/docker-compose',
            ],
        });
    }
    static extraCertificates(scope, id, path) {
        return new index_1.ImageBuilderComponent(scope, id, {
            platform: 'Linux',
            displayName: 'Extra certificates',
            description: 'Install self-signed certificates to provide access to GitHub Enterprise Server',
            commands: [
                'cp certs/certs.pem /usr/local/share/ca-certificates/github-enterprise-server.crt',
                'update-ca-certificates',
            ],
            assets: [
                {
                    path: 'certs',
                    asset: new aws_cdk_lib_1.aws_s3_assets.Asset(scope, `${id} Asset`, { path }),
                },
            ],
        });
    }
}
exports.LinuxUbuntuComponents = LinuxUbuntuComponents;
_a = JSII_RTTI_SYMBOL_1;
LinuxUbuntuComponents[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.LinuxUbuntuComponents", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGludXgtY29tcG9uZW50cy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9hd3MtaW1hZ2UtYnVpbGRlci9kZXByZWNhdGVkL2xpbnV4LWNvbXBvbmVudHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSw2Q0FBeUQ7QUFFekQsa0RBQWlFO0FBQ2pFLG9DQUFpRDtBQUVqRDs7OztHQUlHO0FBQ0gsTUFBYSxxQkFBcUI7SUFDekIsTUFBTSxDQUFDLGdCQUFnQixDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLFlBQTBCO1FBQ3JGLElBQUksT0FBTyxDQUFDO1FBQ1osSUFBSSxZQUFZLENBQUMsRUFBRSxDQUFDLHdCQUFZLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQztZQUN6QyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3BCLENBQUM7YUFBTSxJQUFJLFlBQVksQ0FBQyxFQUFFLENBQUMsd0JBQVksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQy9DLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDcEIsQ0FBQzthQUFNLENBQUM7WUFDTixNQUFNLElBQUksS0FBSyxDQUFDLG1EQUFtRCxZQUFZLENBQUMsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMxRixDQUFDO1FBRUQsT0FBTyxJQUFJLDZCQUFxQixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDMUMsUUFBUSxFQUFFLE9BQU87WUFDakIsV0FBVyxFQUFFLG1CQUFtQjtZQUNoQyxXQUFXLEVBQUUsc0VBQXNFO1lBQ25GLFFBQVEsRUFBRTtnQkFDUixnQkFBZ0I7Z0JBQ2hCLG1EQUFtRDtnQkFDbkQsbUlBQW1JO2dCQUNuSSxzR0FBc0csT0FBTyxxQ0FBcUM7Z0JBQ2xKLDZDQUE2QztnQkFDN0MscUNBQXFDO2FBQ3RDO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVNLE1BQU0sQ0FBQyxVQUFVLENBQUMsS0FBZ0IsRUFBRSxFQUFV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bEYsd0JBQXdCO2FBQ3pCO1lBQ0QsTUFBTSxFQUFFO2dCQUNOO29CQUNFLElBQUksRUFBRSxPQUFPO29CQUNiLEtBQUssRUFBRSxJQUFJLDJCQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUM7aUJBQzNEO2FBQ0Y7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDOztBQTVKSCxzREE2SkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBhd3NfczNfYXNzZXRzIGFzIHMzX2Fzc2V0cyB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBSdW5uZXJWZXJzaW9uIH0gZnJvbSAnLi4vLi4vLi4vcHJvdmlkZXJzJztcbmltcG9ydCB7IEltYWdlQnVpbGRlckNvbXBvbmVudCB9IGZyb20gJy4uL2luZGV4JztcblxuLyoqXG4gKiBDb21wb25lbnRzIGZvciBVYnVudHUgTGludXggdGhhdCBjYW4gYmUgdXNlZCB3aXRoIEFXUyBJbWFnZSBCdWlsZGVyIGJhc2VkIGJ1aWxkZXJzLiBUaGVzZSBjYW5ub3QgYmUgdXNlZCBieSB7QGxpbmsgQ29kZUJ1aWxkSW1hZ2VCdWlsZGVyfS5cbiAqXG4gKiBAZGVwcmVjYXRlZCBVc2UgYFJ1bm5lckltYWdlQ29tcG9uZW50YCBpbnN0ZWFkLlxuICovXG5leHBvcnQgY2xhc3MgTGludXhVYnVudHVDb21wb25lbnRzIHtcbiAgcHVibGljIHN0YXRpYyByZXF1aXJlZFBhY2thZ2VzKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgbGV0IGFyY2hVcmw7XG4gICAgaWYgKGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgYXJjaFVybCA9ICdhbWQ2NCc7XG4gICAgfSBlbHNlIGlmIChhcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgYXJjaFVybCA9ICdhcm02NCc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIGZvciByZXF1aXJlZCBwYWNrYWdlczogJHthcmNoaXRlY3R1cmUubmFtZX1gKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IEltYWdlQnVpbGRlckNvbXBvbmVudChzY29wZSwgaWQsIHtcbiAgICAgIHBsYXRmb3JtOiAnTGludXgnLFxuICAgICAgZGlzcGxheU5hbWU6ICdSZXF1aXJlZCBwYWNrYWdlcycsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgcGFja2FnZXMgcmVxdWlyZWQgZm9yIEdpdEh1YiBSdW5uZXIgYW5kIHVwZ3JhZGUgYWxsIHBhY2thZ2VzJyxcbiAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICdhcHQtZ2V0IHVwZGF0ZScsXG4gICAgICAgICdERUJJQU5fRlJPTlRFTkQ9bm9uaW50ZXJhY3RpdmUgYXB0LWdldCB1cGdyYWRlIC15JyxcbiAgICAgICAgJ0RFQklBTl9GUk9OVEVORD1ub25pbnRlcmFjdGl2ZSBhcHQtZ2V0IGluc3RhbGwgLXkgY3VybCBzdWRvIGpxIGJhc2ggemlwIHVuemlwIGlwdGFibGVzIHNvZnR3YXJlLXByb3BlcnRpZXMtY29tbW9uIGNhLWNlcnRpZmljYXRlcycsXG4gICAgICAgIGBjdXJsIC1zZkxvIC90bXAvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQuZGViIGh0dHBzOi8vczMuYW1hem9uYXdzLmNvbS9hbWF6b25jbG91ZHdhdGNoLWFnZW50L3VidW50dS8ke2FyY2hVcmx9L2xhdGVzdC9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC5kZWJgLFxuICAgICAgICAnZHBrZyAtaSAtRSAvdG1wL2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LmRlYicsXG4gICAgICAgICdybSAvdG1wL2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LmRlYicsXG4gICAgICBdLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBydW5uZXJVc2VyKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgIHJldHVybiBuZXcgSW1hZ2VCdWlsZGVyQ29tcG9uZW50KHNjb3BlLCBpZCwge1xuICAgICAgcGxhdGZvcm06ICdMaW51eCcsXG4gICAgICBkaXNwbGF5TmFtZTogJ0dpdEh1YiBSdW5uZXIgdXNlcicsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgbGF0ZXN0IHZlcnNpb24gb2YgQVdTIENMSScsXG4gICAgICBjb21tYW5kczogW1xuICAgICAgICAnYWRkZ3JvdXAgcnVubmVyJyxcbiAgICAgICAgJ2FkZHVzZXIgLS1zeXN0ZW0gLS1kaXNhYmxlZC1wYXNzd29yZCAtLWhvbWUgL2hvbWUvcnVubmVyIC0taW5ncm91cCBydW5uZXIgcnVubmVyJyxcbiAgICAgICAgJ2VjaG8gXCIlcnVubmVyICAgQUxMPShBTEw6QUxMKSBOT1BBU1NXRDogQUxMXCIgPiAvZXRjL3N1ZG9lcnMuZC9ydW5uZXInLFxuICAgICAgXSxcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgYXdzQ2xpKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgbGV0IGFyY2hVcmw7XG4gICAgaWYgKGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgYXJjaFVybCA9ICd4ODZfNjQnO1xuICAgIH0gZWxzZSBpZiAoYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICAgIGFyY2hVcmwgPSAnYWFyY2g2NCc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIGZvciBhd3NjbGk6ICR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc2NvcGUsIGlkLCB7XG4gICAgICBwbGF0Zm9ybTogJ0xpbnV4JyxcbiAgICAgIGRpc3BsYXlOYW1lOiAnQVdTIENMSScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgbGF0ZXN0IHZlcnNpb24gb2YgQVdTIENMSScsXG4gICAgICBjb21tYW5kczogW1xuICAgICAgICBgY3VybCAtZnNTTCBcImh0dHBzOi8vYXdzY2xpLmFtYXpvbmF3cy5jb20vYXdzY2xpLWV4ZS1saW51eC0ke2FyY2hVcmx9LnppcFwiIC1vIGF3c2NsaXYyLnppcGAsXG4gICAgICAgICd1bnppcCAtcSBhd3NjbGl2Mi56aXAnLFxuICAgICAgICAnLi9hd3MvaW5zdGFsbCcsXG4gICAgICAgICdybSAtcmYgYXdzY2xpdjIuemlwIGF3cycsXG4gICAgICBdLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBnaXRodWJDbGkoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgcmV0dXJuIG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc2NvcGUsIGlkLCB7XG4gICAgICBwbGF0Zm9ybTogJ0xpbnV4JyxcbiAgICAgIGRpc3BsYXlOYW1lOiAnR2l0SHViIENMSScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgbGF0ZXN0IHZlcnNpb24gb2YgZ2gnLFxuICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgJ2N1cmwgLWZzU0wgaHR0cHM6Ly9jbGkuZ2l0aHViLmNvbS9wYWNrYWdlcy9naXRodWJjbGktYXJjaGl2ZS1rZXlyaW5nLmdwZyB8IHN1ZG8gZGQgb2Y9L3Vzci9zaGFyZS9rZXlyaW5ncy9naXRodWJjbGktYXJjaGl2ZS1rZXlyaW5nLmdwZycsXG4gICAgICAgICdlY2hvIFwiZGViIFthcmNoPSQoZHBrZyAtLXByaW50LWFyY2hpdGVjdHVyZSkgc2lnbmVkLWJ5PS91c3Ivc2hhcmUva2V5cmluZ3MvZ2l0aHViY2xpLWFyY2hpdmUta2V5cmluZy5ncGddICcgK1xuICAgICAgICAnICBodHRwczovL2NsaS5naXRodWIuY29tL3BhY2thZ2VzIHN0YWJsZSBtYWluXCIgfCBzdWRvIHRlZSAvZXRjL2FwdC9zb3VyY2VzLmxpc3QuZC9naXRodWItY2xpLmxpc3QgPiAvZGV2L251bGwnLFxuICAgICAgICAnYXB0LWdldCB1cGRhdGUnLFxuICAgICAgICAnREVCSUFOX0ZST05URU5EPW5vbmludGVyYWN0aXZlIGFwdC1nZXQgaW5zdGFsbCAteSBnaCcsXG4gICAgICBdLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBnaXQoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgX2FyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKSB7XG4gICAgcmV0dXJuIG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc2NvcGUsIGlkLCB7XG4gICAgICBwbGF0Zm9ybTogJ0xpbnV4JyxcbiAgICAgIGRpc3BsYXlOYW1lOiAnR2l0JyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSW5zdGFsbCBsYXRlc3QgdmVyc2lvbiBvZiBnaXQnLFxuICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgJ2FkZC1hcHQtcmVwb3NpdG9yeSBwcGE6Z2l0LWNvcmUvcHBhJyxcbiAgICAgICAgJ2FwdC1nZXQgdXBkYXRlJyxcbiAgICAgICAgJ0RFQklBTl9GUk9OVEVORD1ub25pbnRlcmFjdGl2ZSBhcHQtZ2V0IGluc3RhbGwgLXkgZ2l0JyxcbiAgICAgIF0sXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgc3RhdGljIGdpdGh1YlJ1bm5lcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBydW5uZXJWZXJzaW9uOiBSdW5uZXJWZXJzaW9uLCBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgIGxldCB2ZXJzaW9uQ29tbWFuZDogc3RyaW5nO1xuICAgIGlmIChydW5uZXJWZXJzaW9uLmlzKFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkpKSB7XG4gICAgICB2ZXJzaW9uQ29tbWFuZCA9ICdSVU5ORVJfVkVSU0lPTj1gY3VybCAtdyBcIiV7cmVkaXJlY3RfdXJsfVwiIC1mc1MgaHR0cHM6Ly9naXRodWIuY29tL2FjdGlvbnMvcnVubmVyL3JlbGVhc2VzL2xhdGVzdCB8IGdyZXAgLW9FIFwiW14vdl0rJFwiYCc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZlcnNpb25Db21tYW5kID0gYFJVTk5FUl9WRVJTSU9OPScke3J1bm5lclZlcnNpb24udmVyc2lvbn0nYDtcbiAgICB9XG5cbiAgICBsZXQgYXJjaFVybDtcbiAgICBpZiAoYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICBhcmNoVXJsID0gJ3g2NCc7XG4gICAgfSBlbHNlIGlmIChhcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSkge1xuICAgICAgYXJjaFVybCA9ICdhcm02NCc7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlIGZvciBHaXRIdWIgUnVubmVyOiAke2FyY2hpdGVjdHVyZS5uYW1lfWApO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgSW1hZ2VCdWlsZGVyQ29tcG9uZW50KHNjb3BlLCBpZCwge1xuICAgICAgcGxhdGZvcm06ICdMaW51eCcsXG4gICAgICBkaXNwbGF5TmFtZTogJ0dpdEh1YiBBY3Rpb25zIFJ1bm5lcicsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgbGF0ZXN0IHZlcnNpb24gb2YgR2l0SHViIEFjdGlvbnMgUnVubmVyJyxcbiAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgIHZlcnNpb25Db21tYW5kLFxuICAgICAgICBgY3VybCAtZnNTTE8gXCJodHRwczovL2dpdGh1Yi5jb20vYWN0aW9ucy9ydW5uZXIvcmVsZWFzZXMvZG93bmxvYWQvdlxcJHtSVU5ORVJfVkVSU0lPTn0vYWN0aW9ucy1ydW5uZXItbGludXgtJHthcmNoVXJsfS1cXCR7UlVOTkVSX1ZFUlNJT059LnRhci5nelwiYCxcbiAgICAgICAgYHRhciB4emYgXCJhY3Rpb25zLXJ1bm5lci1saW51eC0ke2FyY2hVcmx9LVxcJHtSVU5ORVJfVkVSU0lPTn0udGFyLmd6XCJgLFxuICAgICAgICBgcm0gYWN0aW9ucy1ydW5uZXItbGludXgtJHthcmNoVXJsfS1cXCR7UlVOTkVSX1ZFUlNJT059LnRhci5nemAsXG4gICAgICAgICcuL2Jpbi9pbnN0YWxsZGVwZW5kZW5jaWVzLnNoJyxcbiAgICAgICAgYGVjaG8gLW4gJHtydW5uZXJWZXJzaW9uLnZlcnNpb259ID4gUlVOTkVSX1ZFUlNJT05gLFxuICAgICAgXSxcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgZG9ja2VyKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIF9hcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSkge1xuICAgIHJldHVybiBuZXcgSW1hZ2VCdWlsZGVyQ29tcG9uZW50KHNjb3BlLCBpZCwge1xuICAgICAgcGxhdGZvcm06ICdMaW51eCcsXG4gICAgICBkaXNwbGF5TmFtZTogJ0RvY2tlcicsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgbGF0ZXN0IHZlcnNpb24gb2YgRG9ja2VyJyxcbiAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICdjdXJsIC1mc1NMIGh0dHBzOi8vZG93bmxvYWQuZG9ja2VyLmNvbS9saW51eC91YnVudHUvZ3BnIHwgc3VkbyBncGcgLS1kZWFybW9yIC1vIC91c3Ivc2hhcmUva2V5cmluZ3MvZG9ja2VyLmdwZycsXG4gICAgICAgICdlY2hvICcgK1xuICAgICAgICAnICBcImRlYiBbYXJjaD0kKGRwa2cgLS1wcmludC1hcmNoaXRlY3R1cmUpIHNpZ25lZC1ieT0vdXNyL3NoYXJlL2tleXJpbmdzL2RvY2tlci5ncGddIGh0dHBzOi8vZG93bmxvYWQuZG9ja2VyLmNvbS9saW51eC91YnVudHUgJyArXG4gICAgICAgICcgICQobHNiX3JlbGVhc2UgLWNzKSBzdGFibGVcIiB8IHN1ZG8gdGVlIC9ldGMvYXB0L3NvdXJjZXMubGlzdC5kL2RvY2tlci5saXN0ID4gL2Rldi9udWxsJyxcbiAgICAgICAgJ2FwdC1nZXQgdXBkYXRlJyxcbiAgICAgICAgJ0RFQklBTl9GUk9OVEVORD1ub25pbnRlcmFjdGl2ZSBhcHQtZ2V0IGluc3RhbGwgLXkgZG9ja2VyLWNlIGRvY2tlci1jZS1jbGkgY29udGFpbmVyZC5pbyBkb2NrZXItY29tcG9zZS1wbHVnaW4nLFxuICAgICAgICAndXNlcm1vZCAtYUcgZG9ja2VyIHJ1bm5lcicsXG4gICAgICAgICdsbiAtcyAvdXNyL2xpYmV4ZWMvZG9ja2VyL2NsaS1wbHVnaW5zL2RvY2tlci1jb21wb3NlIC91c3IvYmluL2RvY2tlci1jb21wb3NlJyxcbiAgICAgIF0sXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgc3RhdGljIGV4dHJhQ2VydGlmaWNhdGVzKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHBhdGg6IHN0cmluZykge1xuICAgIHJldHVybiBuZXcgSW1hZ2VCdWlsZGVyQ29tcG9uZW50KHNjb3BlLCBpZCwge1xuICAgICAgcGxhdGZvcm06ICdMaW51eCcsXG4gICAgICBkaXNwbGF5TmFtZTogJ0V4dHJhIGNlcnRpZmljYXRlcycsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgc2VsZi1zaWduZWQgY2VydGlmaWNhdGVzIHRvIHByb3ZpZGUgYWNjZXNzIHRvIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlcicsXG4gICAgICBjb21tYW5kczogW1xuICAgICAgICAnY3AgY2VydHMvY2VydHMucGVtIC91c3IvbG9jYWwvc2hhcmUvY2EtY2VydGlmaWNhdGVzL2dpdGh1Yi1lbnRlcnByaXNlLXNlcnZlci5jcnQnLFxuICAgICAgICAndXBkYXRlLWNhLWNlcnRpZmljYXRlcycsXG4gICAgICBdLFxuICAgICAgYXNzZXRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwYXRoOiAnY2VydHMnLFxuICAgICAgICAgIGFzc2V0OiBuZXcgczNfYXNzZXRzLkFzc2V0KHNjb3BlLCBgJHtpZH0gQXNzZXRgLCB7IHBhdGggfSksXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICB9XG59XG4iXX0=