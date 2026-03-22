"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WindowsComponents = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const providers_1 = require("../../../providers");
const components_1 = require("../../components");
const builder_1 = require("../builder");
/**
 * Components for Windows that can be used with AWS Image Builder based builders. These cannot be used by {@link CodeBuildImageBuilder}.
 *
 * @deprecated Use `RunnerImageComponent` instead.
 */
class WindowsComponents {
    static cloudwatchAgent(scope, id) {
        return new builder_1.ImageBuilderComponent(scope, id, {
            platform: 'Windows',
            displayName: 'CloudWatch agent',
            description: 'Install latest version of CloudWatch agent for sending logs to CloudWatch',
            commands: [
                '$p = Start-Process msiexec.exe -PassThru -Wait -ArgumentList \'/i https://s3.amazonaws.com/amazoncloudwatch-agent/windows/amd64/latest/amazon-cloudwatch-agent.msi /qn\'',
                'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
            ],
        });
    }
    static awsCli(scope, id) {
        return new builder_1.ImageBuilderComponent(scope, id, {
            platform: 'Windows',
            displayName: 'AWS CLI',
            description: 'Install latest version of AWS CLI',
            commands: [
                '$p = Start-Process msiexec.exe -PassThru -Wait -ArgumentList \'/i https://awscli.amazonaws.com/AWSCLIV2.msi /qn\'',
                'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
            ],
        });
    }
    static githubCli(scope, id) {
        return new builder_1.ImageBuilderComponent(scope, id, {
            platform: 'Windows',
            displayName: 'GitHub CLI',
            description: 'Install latest version of gh',
            commands: [
                'cmd /c curl -w "%{redirect_url}" -fsS https://github.com/cli/cli/releases/latest > $Env:TEMP\\latest-gh',
                '$LatestUrl = Get-Content $Env:TEMP\\latest-gh',
                '$GH_VERSION = ($LatestUrl -Split \'/\')[-1].substring(1)',
                'Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_windows_amd64.msi" -OutFile gh.msi',
                '$p = Start-Process msiexec.exe -PassThru -Wait -ArgumentList \'/i gh.msi /qn\'',
                'if ($p.ExitCode -ne 0) { throw "Exit code is $p.ExitCode" }',
                'del gh.msi',
            ],
        });
    }
    static git(scope, id) {
        return new builder_1.ImageBuilderComponent(scope, id, {
            platform: 'Windows',
            displayName: 'Git',
            description: 'Install latest version of git',
            commands: [
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
            ],
        });
    }
    static githubRunner(scope, id, runnerVersion) {
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
        return new builder_1.ImageBuilderComponent(scope, id, {
            platform: 'Windows',
            displayName: 'GitHub Actions Runner',
            description: 'Install latest version of GitHub Actions Runner',
            commands: runnerCommands.concat([
                'Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-win-x64-${RUNNER_VERSION}.zip" -OutFile actions.zip',
                'Expand-Archive actions.zip -DestinationPath C:\\actions',
                'del actions.zip',
                `echo ${runnerVersion.version} | Out-File -Encoding ASCII -NoNewline C:\\actions\\RUNNER_VERSION`,
            ]),
        });
    }
    static docker(scope, id) {
        return new builder_1.ImageBuilderComponent(scope, id, {
            platform: 'Windows',
            displayName: 'Docker',
            description: 'Install latest version of Docker',
            commands: components_1.RunnerImageComponent.docker().getCommands(providers_1.Os.WINDOWS, providers_1.Architecture.X86_64),
            reboot: true,
        });
    }
    static extraCertificates(scope, id, path) {
        return new builder_1.ImageBuilderComponent(scope, id, {
            platform: 'Windows',
            displayName: 'Extra certificates',
            description: 'Install self-signed certificates to provide access to GitHub Enterprise Server',
            commands: [
                'Import-Certificate -FilePath certs\\certs.pem -CertStoreLocation Cert:\\LocalMachine\\Root',
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
exports.WindowsComponents = WindowsComponents;
_a = JSII_RTTI_SYMBOL_1;
WindowsComponents[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.WindowsComponents", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2luZG93cy1jb21wb25lbnRzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2RlcHJlY2F0ZWQvd2luZG93cy1jb21wb25lbnRzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsNkNBQXlEO0FBRXpELGtEQUFxRTtBQUNyRSxpREFBd0Q7QUFDeEQsd0NBQW1EO0FBRW5EOzs7O0dBSUc7QUFDSCxNQUFhLGlCQUFpQjtJQUNyQixNQUFNLENBQUMsZUFBZSxDQUFDLEtBQWdCLEVBQUUsRUFBVTtRQUN4RCxPQUFPLElBQUksK0JBQXFCLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUMxQyxRQUFRLEVBQUUsU0FBUztZQUNuQixXQUFXLEVBQUUsa0JBQWtCO1lBQy9CLFdBQVcsRUFBRSwyRUFBMkU7WUFDeEYsUUFBUSxFQUFFO2dCQUNSLDBLQUEwSztnQkFDMUssNkRBQTZEO2FBQzlEO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVNLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBZ0IsRUFBRSxFQUFVO1FBQy9DLE9BQU8sSUFBSSwrQkFBcUIsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQzFDLFFBQVEsRUFBRSxTQUFTO1lBQ25CLFdBQVcsRUFBRSxTQUFTO1lBQ3RCLFdBQVcsRUFBRSxtQ0FBbUM7WUFDaEQsUUFBUSxFQUFFO2dCQUNSLG1IQUFtSDtnQkFDbkgsNkRBQTZEO2FBQzlEO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVNLE1BQU0sQ0FBQyxTQUFTLENBQUMsS0FBZ0IsRUFBRSxFQUFVO1FBQ2xELE9BQU8sSUFBSSwrQkFBcUIsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQzFDLFFBQVEsRUFBRSxTQUFTO1lBQ25CLFdBQVcsRUFBRSxZQUFZO1lBQ3pCLFdBQVcsRUFBRSw4QkFBOEI7WUFDM0MsUUFBUSxFQUFFO2dCQUNSLHlHQUF5RztnQkFDekcsK0NBQStDO2dCQUMvQywwREFBMEQ7Z0JBQzFELDBKQUEwSjtnQkFDMUosZ0ZBQWdGO2dCQUNoRiw2REFBNkQ7Z0JBQzdELFlBQVk7YUFDYjtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTSxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQWdCLEVBQUUsRUFBVTtRQUM1QyxPQUFPLElBQUksK0JBQXFCLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUMxQyxRQUFRLEVBQUUsU0FBUztZQUNuQixXQUFXLEVBQUUsS0FBSztZQUNsQixXQUFXLEVBQUUsK0JBQStCO1lBQzVDLFFBQVEsRUFBRTtnQkFDUixzSEFBc0g7Z0JBQ3RILGdEQUFnRDtnQkFDaEQsMkRBQTJEO2dCQUMzRCw2REFBNkQ7Z0JBQzdELHdEQUF3RDtnQkFDeEQsb0ZBQW9GO2dCQUNwRiw2S0FBNks7Z0JBQzdLLGdGQUFnRjtnQkFDaEYsNkRBQTZEO2dCQUM3RCxtQkFBbUI7YUFDcEI7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU0sTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFnQixFQUFFLEVBQVUsRUFBRSxhQUE0QjtRQUNuRixJQUFJLGNBQXdCLENBQUM7UUFDN0IsSUFBSSxhQUFhLENBQUMsRUFBRSxDQUFDLHlCQUFhLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxDQUFDO1lBQzdDLGNBQWMsR0FBRztnQkFDZixpSEFBaUg7Z0JBQ2pILGdEQUFnRDtnQkFDaEQsOERBQThEO2FBQy9ELENBQUM7UUFDSixDQUFDO2FBQU0sQ0FBQztZQUNOLGNBQWMsR0FBRyxDQUFDLHNCQUFzQixhQUFhLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQztRQUNwRSxDQUFDO1FBRUQsT0FBTyxJQUFJLCtCQUFxQixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDMUMsUUFBUSxFQUFFLFNBQVM7WUFDbkIsV0FBVyxFQUFFLHVCQUF1QjtZQUNwQyxXQUFXLEVBQUUsaURBQWlEO1lBQzlELFFBQVEsRUFBRSxjQUFjLENBQUMsTUFBTSxDQUFDO2dCQUM5QixvTEFBb0w7Z0JBQ3BMLHlEQUF5RDtnQkFDekQsaUJBQWlCO2dCQUNqQixRQUFRLGFBQWEsQ0FBQyxPQUFPLG9FQUFvRTthQUNsRyxDQUFDO1NBQ0gsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVNLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FBZ0IsRUFBRSxFQUFVO1FBQy9DLE9BQU8sSUFBSSwrQkFBcUIsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQzFDLFFBQVEsRUFBRSxTQUFTO1lBQ25CLFdBQVcsRUFBRSxRQUFRO1lBQ3JCLFdBQVcsRUFBRSxrQ0FBa0M7WUFDL0MsUUFBUSxFQUFFLGlDQUFvQixDQUFDLE1BQU0sRUFBRSxDQUFDLFdBQVcsQ0FBQyxjQUFFLENBQUMsT0FBTyxFQUFFLHdCQUFZLENBQUMsTUFBTSxDQUFDO1lBQ3BGLE1BQU0sRUFBRSxJQUFJO1NBQ2IsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVNLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxLQUFnQixFQUFFLEVBQVUsRUFBRSxJQUFZO1FBQ3hFLE9BQU8sSUFBSSwrQkFBcUIsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQzFDLFFBQVEsRUFBRSxTQUFTO1lBQ25CLFdBQVcsRUFBRSxvQkFBb0I7WUFDakMsV0FBVyxFQUFFLGdGQUFnRjtZQUM3RixRQUFRLEVBQUU7Z0JBQ1IsNEZBQTRGO2FBQzdGO1lBQ0QsTUFBTSxFQUFFO2dCQUNOO29CQUNFLElBQUksRUFBRSxPQUFPO29CQUNiLEtBQUssRUFBRSxJQUFJLDJCQUFTLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxHQUFHLEVBQUUsUUFBUSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUM7aUJBQzNEO2FBQ0Y7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDOztBQWhISCw4Q0FpSEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBhd3NfczNfYXNzZXRzIGFzIHMzX2Fzc2V0cyB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBPcywgUnVubmVyVmVyc2lvbiB9IGZyb20gJy4uLy4uLy4uL3Byb3ZpZGVycyc7XG5pbXBvcnQgeyBSdW5uZXJJbWFnZUNvbXBvbmVudCB9IGZyb20gJy4uLy4uL2NvbXBvbmVudHMnO1xuaW1wb3J0IHsgSW1hZ2VCdWlsZGVyQ29tcG9uZW50IH0gZnJvbSAnLi4vYnVpbGRlcic7XG5cbi8qKlxuICogQ29tcG9uZW50cyBmb3IgV2luZG93cyB0aGF0IGNhbiBiZSB1c2VkIHdpdGggQVdTIEltYWdlIEJ1aWxkZXIgYmFzZWQgYnVpbGRlcnMuIFRoZXNlIGNhbm5vdCBiZSB1c2VkIGJ5IHtAbGluayBDb2RlQnVpbGRJbWFnZUJ1aWxkZXJ9LlxuICpcbiAqIEBkZXByZWNhdGVkIFVzZSBgUnVubmVySW1hZ2VDb21wb25lbnRgIGluc3RlYWQuXG4gKi9cbmV4cG9ydCBjbGFzcyBXaW5kb3dzQ29tcG9uZW50cyB7XG4gIHB1YmxpYyBzdGF0aWMgY2xvdWR3YXRjaEFnZW50KHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gbmV3IEltYWdlQnVpbGRlckNvbXBvbmVudChzY29wZSwgaWQsIHtcbiAgICAgIHBsYXRmb3JtOiAnV2luZG93cycsXG4gICAgICBkaXNwbGF5TmFtZTogJ0Nsb3VkV2F0Y2ggYWdlbnQnLFxuICAgICAgZGVzY3JpcHRpb246ICdJbnN0YWxsIGxhdGVzdCB2ZXJzaW9uIG9mIENsb3VkV2F0Y2ggYWdlbnQgZm9yIHNlbmRpbmcgbG9ncyB0byBDbG91ZFdhdGNoJyxcbiAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICckcCA9IFN0YXJ0LVByb2Nlc3MgbXNpZXhlYy5leGUgLVBhc3NUaHJ1IC1XYWl0IC1Bcmd1bWVudExpc3QgXFwnL2kgaHR0cHM6Ly9zMy5hbWF6b25hd3MuY29tL2FtYXpvbmNsb3Vkd2F0Y2gtYWdlbnQvd2luZG93cy9hbWQ2NC9sYXRlc3QvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQubXNpIC9xblxcJycsXG4gICAgICAgICdpZiAoJHAuRXhpdENvZGUgLW5lIDApIHsgdGhyb3cgXCJFeGl0IGNvZGUgaXMgJHAuRXhpdENvZGVcIiB9JyxcbiAgICAgIF0sXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgc3RhdGljIGF3c0NsaShzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc2NvcGUsIGlkLCB7XG4gICAgICBwbGF0Zm9ybTogJ1dpbmRvd3MnLFxuICAgICAgZGlzcGxheU5hbWU6ICdBV1MgQ0xJJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnSW5zdGFsbCBsYXRlc3QgdmVyc2lvbiBvZiBBV1MgQ0xJJyxcbiAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICckcCA9IFN0YXJ0LVByb2Nlc3MgbXNpZXhlYy5leGUgLVBhc3NUaHJ1IC1XYWl0IC1Bcmd1bWVudExpc3QgXFwnL2kgaHR0cHM6Ly9hd3NjbGkuYW1hem9uYXdzLmNvbS9BV1NDTElWMi5tc2kgL3FuXFwnJyxcbiAgICAgICAgJ2lmICgkcC5FeGl0Q29kZSAtbmUgMCkgeyB0aHJvdyBcIkV4aXQgY29kZSBpcyAkcC5FeGl0Q29kZVwiIH0nLFxuICAgICAgXSxcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgZ2l0aHViQ2xpKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gbmV3IEltYWdlQnVpbGRlckNvbXBvbmVudChzY29wZSwgaWQsIHtcbiAgICAgIHBsYXRmb3JtOiAnV2luZG93cycsXG4gICAgICBkaXNwbGF5TmFtZTogJ0dpdEh1YiBDTEknLFxuICAgICAgZGVzY3JpcHRpb246ICdJbnN0YWxsIGxhdGVzdCB2ZXJzaW9uIG9mIGdoJyxcbiAgICAgIGNvbW1hbmRzOiBbXG4gICAgICAgICdjbWQgL2MgY3VybCAtdyBcIiV7cmVkaXJlY3RfdXJsfVwiIC1mc1MgaHR0cHM6Ly9naXRodWIuY29tL2NsaS9jbGkvcmVsZWFzZXMvbGF0ZXN0ID4gJEVudjpURU1QXFxcXGxhdGVzdC1naCcsXG4gICAgICAgICckTGF0ZXN0VXJsID0gR2V0LUNvbnRlbnQgJEVudjpURU1QXFxcXGxhdGVzdC1naCcsXG4gICAgICAgICckR0hfVkVSU0lPTiA9ICgkTGF0ZXN0VXJsIC1TcGxpdCBcXCcvXFwnKVstMV0uc3Vic3RyaW5nKDEpJyxcbiAgICAgICAgJ0ludm9rZS1XZWJSZXF1ZXN0IC1Vc2VCYXNpY1BhcnNpbmcgLVVyaSBcImh0dHBzOi8vZ2l0aHViLmNvbS9jbGkvY2xpL3JlbGVhc2VzL2Rvd25sb2FkL3Yke0dIX1ZFUlNJT059L2doXyR7R0hfVkVSU0lPTn1fd2luZG93c19hbWQ2NC5tc2lcIiAtT3V0RmlsZSBnaC5tc2knLFxuICAgICAgICAnJHAgPSBTdGFydC1Qcm9jZXNzIG1zaWV4ZWMuZXhlIC1QYXNzVGhydSAtV2FpdCAtQXJndW1lbnRMaXN0IFxcJy9pIGdoLm1zaSAvcW5cXCcnLFxuICAgICAgICAnaWYgKCRwLkV4aXRDb2RlIC1uZSAwKSB7IHRocm93IFwiRXhpdCBjb2RlIGlzICRwLkV4aXRDb2RlXCIgfScsXG4gICAgICAgICdkZWwgZ2gubXNpJyxcbiAgICAgIF0sXG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgc3RhdGljIGdpdChzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc2NvcGUsIGlkLCB7XG4gICAgICBwbGF0Zm9ybTogJ1dpbmRvd3MnLFxuICAgICAgZGlzcGxheU5hbWU6ICdHaXQnLFxuICAgICAgZGVzY3JpcHRpb246ICdJbnN0YWxsIGxhdGVzdCB2ZXJzaW9uIG9mIGdpdCcsXG4gICAgICBjb21tYW5kczogW1xuICAgICAgICAnY21kIC9jIGN1cmwgLXcgXCIle3JlZGlyZWN0X3VybH1cIiAtZnNTIGh0dHBzOi8vZ2l0aHViLmNvbS9naXQtZm9yLXdpbmRvd3MvZ2l0L3JlbGVhc2VzL2xhdGVzdCA+ICRFbnY6VEVNUFxcXFxsYXRlc3QtZ2l0JyxcbiAgICAgICAgJyRMYXRlc3RVcmwgPSBHZXQtQ29udGVudCAkRW52OlRFTVBcXFxcbGF0ZXN0LWdpdCcsXG4gICAgICAgICckR0lUX1ZFUlNJT04gPSAoJExhdGVzdFVybCAtU3BsaXQgXFwnL1xcJylbLTFdLnN1YnN0cmluZygxKScsXG4gICAgICAgICckR0lUX1ZFUlNJT05fU0hPUlQgPSAoJEdJVF9WRVJTSU9OIC1TcGxpdCBcXCcud2luZG93cy5cXCcpWzBdJyxcbiAgICAgICAgJyRHSVRfUkVWSVNJT04gPSAoJEdJVF9WRVJTSU9OIC1TcGxpdCBcXCcud2luZG93cy5cXCcpWzFdJyxcbiAgICAgICAgJ0lmICgkR0lUX1JFVklTSU9OIC1ndCAxKSB7JEdJVF9WRVJTSU9OX1NIT1JUID0gXCIkR0lUX1ZFUlNJT05fU0hPUlQuJEdJVF9SRVZJU0lPTlwifScsXG4gICAgICAgICdJbnZva2UtV2ViUmVxdWVzdCAtVXNlQmFzaWNQYXJzaW5nIC1VcmkgaHR0cHM6Ly9naXRodWIuY29tL2dpdC1mb3Itd2luZG93cy9naXQvcmVsZWFzZXMvZG93bmxvYWQvdiR7R0lUX1ZFUlNJT059L0dpdC0ke0dJVF9WRVJTSU9OX1NIT1JUfS02NC1iaXQuZXhlIC1PdXRGaWxlIGdpdC1zZXR1cC5leGUnLFxuICAgICAgICAnJHAgPSBTdGFydC1Qcm9jZXNzIGdpdC1zZXR1cC5leGUgLVBhc3NUaHJ1IC1XYWl0IC1Bcmd1bWVudExpc3QgXFwnL1ZFUllTSUxFTlRcXCcnLFxuICAgICAgICAnaWYgKCRwLkV4aXRDb2RlIC1uZSAwKSB7IHRocm93IFwiRXhpdCBjb2RlIGlzICRwLkV4aXRDb2RlXCIgfScsXG4gICAgICAgICdkZWwgZ2l0LXNldHVwLmV4ZScsXG4gICAgICBdLFxuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBnaXRodWJSdW5uZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbikge1xuICAgIGxldCBydW5uZXJDb21tYW5kczogc3RyaW5nW107XG4gICAgaWYgKHJ1bm5lclZlcnNpb24uaXMoUnVubmVyVmVyc2lvbi5sYXRlc3QoKSkpIHtcbiAgICAgIHJ1bm5lckNvbW1hbmRzID0gW1xuICAgICAgICAnY21kIC9jIGN1cmwgLXcgXCIle3JlZGlyZWN0X3VybH1cIiAtZnNTIGh0dHBzOi8vZ2l0aHViLmNvbS9hY3Rpb25zL3J1bm5lci9yZWxlYXNlcy9sYXRlc3QgPiAkRW52OlRFTVBcXFxcbGF0ZXN0LWdoYScsXG4gICAgICAgICckTGF0ZXN0VXJsID0gR2V0LUNvbnRlbnQgJEVudjpURU1QXFxcXGxhdGVzdC1naGEnLFxuICAgICAgICAnJFJVTk5FUl9WRVJTSU9OID0gKCRMYXRlc3RVcmwgLVNwbGl0IFxcJy9cXCcpWy0xXS5zdWJzdHJpbmcoMSknLFxuICAgICAgXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcnVubmVyQ29tbWFuZHMgPSBbYCRSVU5ORVJfVkVSU0lPTiA9ICcke3J1bm5lclZlcnNpb24udmVyc2lvbn0nYF07XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc2NvcGUsIGlkLCB7XG4gICAgICBwbGF0Zm9ybTogJ1dpbmRvd3MnLFxuICAgICAgZGlzcGxheU5hbWU6ICdHaXRIdWIgQWN0aW9ucyBSdW5uZXInLFxuICAgICAgZGVzY3JpcHRpb246ICdJbnN0YWxsIGxhdGVzdCB2ZXJzaW9uIG9mIEdpdEh1YiBBY3Rpb25zIFJ1bm5lcicsXG4gICAgICBjb21tYW5kczogcnVubmVyQ29tbWFuZHMuY29uY2F0KFtcbiAgICAgICAgJ0ludm9rZS1XZWJSZXF1ZXN0IC1Vc2VCYXNpY1BhcnNpbmcgLVVyaSBcImh0dHBzOi8vZ2l0aHViLmNvbS9hY3Rpb25zL3J1bm5lci9yZWxlYXNlcy9kb3dubG9hZC92JHtSVU5ORVJfVkVSU0lPTn0vYWN0aW9ucy1ydW5uZXItd2luLXg2NC0ke1JVTk5FUl9WRVJTSU9OfS56aXBcIiAtT3V0RmlsZSBhY3Rpb25zLnppcCcsXG4gICAgICAgICdFeHBhbmQtQXJjaGl2ZSBhY3Rpb25zLnppcCAtRGVzdGluYXRpb25QYXRoIEM6XFxcXGFjdGlvbnMnLFxuICAgICAgICAnZGVsIGFjdGlvbnMuemlwJyxcbiAgICAgICAgYGVjaG8gJHtydW5uZXJWZXJzaW9uLnZlcnNpb259IHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1Ob05ld2xpbmUgQzpcXFxcYWN0aW9uc1xcXFxSVU5ORVJfVkVSU0lPTmAsXG4gICAgICBdKSxcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgZG9ja2VyKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gbmV3IEltYWdlQnVpbGRlckNvbXBvbmVudChzY29wZSwgaWQsIHtcbiAgICAgIHBsYXRmb3JtOiAnV2luZG93cycsXG4gICAgICBkaXNwbGF5TmFtZTogJ0RvY2tlcicsXG4gICAgICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgbGF0ZXN0IHZlcnNpb24gb2YgRG9ja2VyJyxcbiAgICAgIGNvbW1hbmRzOiBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKS5nZXRDb21tYW5kcyhPcy5XSU5ET1dTLCBBcmNoaXRlY3R1cmUuWDg2XzY0KSxcbiAgICAgIHJlYm9vdDogdHJ1ZSxcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgZXh0cmFDZXJ0aWZpY2F0ZXMoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcGF0aDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc2NvcGUsIGlkLCB7XG4gICAgICBwbGF0Zm9ybTogJ1dpbmRvd3MnLFxuICAgICAgZGlzcGxheU5hbWU6ICdFeHRyYSBjZXJ0aWZpY2F0ZXMnLFxuICAgICAgZGVzY3JpcHRpb246ICdJbnN0YWxsIHNlbGYtc2lnbmVkIGNlcnRpZmljYXRlcyB0byBwcm92aWRlIGFjY2VzcyB0byBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXInLFxuICAgICAgY29tbWFuZHM6IFtcbiAgICAgICAgJ0ltcG9ydC1DZXJ0aWZpY2F0ZSAtRmlsZVBhdGggY2VydHNcXFxcY2VydHMucGVtIC1DZXJ0U3RvcmVMb2NhdGlvbiBDZXJ0OlxcXFxMb2NhbE1hY2hpbmVcXFxcUm9vdCcsXG4gICAgICBdLFxuICAgICAgYXNzZXRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBwYXRoOiAnY2VydHMnLFxuICAgICAgICAgIGFzc2V0OiBuZXcgczNfYXNzZXRzLkFzc2V0KHNjb3BlLCBgJHtpZH0gQXNzZXRgLCB7IHBhdGggfSksXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuICB9XG59XG4iXX0=