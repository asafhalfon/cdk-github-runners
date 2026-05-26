"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ec2Runner = exports.Ec2RunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const common_1 = require("./common");
const image_builders_1 = require("../image-builders");
const utils_1 = require("../utils");
// this script is specifically made so `poweroff` is absolutely always called
// each `{}` is a variable coming from `params` below
const linuxUserDataTemplate = `#!/bin/bash
set -x -o pipefail

TASK_TOKEN="{}"
logGroupName="{}"
runnerNamePath="{}"
githubDomainPath="{}"
ownerPath="{}"
repoPath="{}"
runnerTokenPath="{}"
labels="{}"
registrationURL="{}"
runnerGroup1="{}"
runnerGroup2="{}"
defaultLabels="{}"
jitConfig="{}"

export AWS_RETRY_MODE=standard # better retry
touch /var/log/runner.log

heartbeat () {
  while true; do
    SPOT_ACTION=$(curl -s -f -H "X-aws-ec2-metadata-token: $(curl -s -f -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 1" 2>/dev/null)" "http://169.254.169.254/latest/meta-data/spot/instance-action" 2>/dev/null) || true
    if [ -n "$SPOT_ACTION" ]; then
      aws stepfunctions send-task-failure --task-token "$TASK_TOKEN" --error SpotInterrupted --cause "EC2 Spot instance interruption: $SPOT_ACTION" || true
      exit 0
    fi
    aws stepfunctions send-task-heartbeat --task-token "$TASK_TOKEN"
    sleep 60
  done
}
setup_logs () {
  cat <<EOF > /tmp/log.conf || exit 1
  {
    "logs": {
      "log_stream_name": "unknown",
      "logs_collected": {
        "files": {
          "collect_list": [
            {
              "file_path": "/var/log/runner.log",
              "log_group_name": "$logGroupName",
              "log_stream_name": "$runnerNamePath",
              "timezone": "UTC"
            }
          ]
        }
      }
    }
  }
EOF
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/tmp/log.conf || exit 2
}
action () {
  if [ -n "$jitConfig" ]; then
    # JIT mode: cleaner registration, no config.sh needed
    sudo --preserve-env=AWS_REGION -Hu runner /home/runner/run.sh --jitconfig "$jitConfig" || exit 2
  else
    # Legacy mode: register runner to pool with token
    # Determine the value of RUNNER_FLAGS
    if [ "$(< /home/runner/RUNNER_VERSION)" = "latest" ]; then
      RUNNER_FLAGS=""
    else
      RUNNER_FLAGS="--disableupdate"
    fi

    labelsTemplate="$labels,cdkghr:started:$(date +%s)"

    # Execute the configuration command for runner registration
    sudo -Hu runner /home/runner/config.sh --unattended --url "$registrationURL" --token "$runnerTokenPath" --ephemeral --work _work --labels "$labelsTemplate" $RUNNER_FLAGS --name "$runnerNamePath" $runnerGroup1 $runnerGroup2 $defaultLabels || exit 1

    # Execute the run command
    sudo --preserve-env=AWS_REGION -Hu runner /home/runner/run.sh || exit 2
  fi

  # Retrieve the status
  STATUS=$(grep -Phors "finish job request for job [0-9a-f-]+ with result: .*" /home/runner/_diag/ | tail -n1 | awk '{print $NF}')

  # Check and print the job status
  [ -n "$STATUS" ] && echo CDKGHA JOB DONE "$labels" "$STATUS"
}
heartbeat &
if setup_logs && action |& tee /var/log/runner.log; then
  aws stepfunctions send-task-success --task-token "$TASK_TOKEN" --task-output '{"ok": true}' |& tee -a /var/log/runner.log
else
  aws stepfunctions send-task-failure --task-token "$TASK_TOKEN" --error Runner.Error.$? --cause "Check CloudWatch for full log -- $logGroupName/$runnerNamePath -- $(tail -n 1 /var/log/runner.log)" |& tee -a /var/log/runner.log
fi
sleep 10  # give cloudwatch agent its default 5 seconds buffer duration to upload logs
poweroff
`.replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\\{\\}/g, '{}');
// this script is specifically made so `poweroff` is absolutely always called
// each `{}` is a variable coming from `params` below and their order should match the linux script
const windowsUserDataTemplate = `<powershell>
$TASK_TOKEN = "{}"
$logGroupName="{}"
$runnerNamePath="{}"
$githubDomainPath="{}"
$ownerPath="{}"
$repoPath="{}"
$runnerTokenPath="{}"
$labels="{}"
$registrationURL="{}"
$runnerGroup1="{}"
$runnerGroup2="{}"
$defaultLabels="{}"
$jitConfig="{}"

$Env:AWS_RETRY_MODE = "standard"  # better retry

# EC2Launch only starts ssm agent after user data is done, so we need to start it ourselves (it is disabled by default)
Set-Service -StartupType Manual AmazonSSMAgent
Start-Service AmazonSSMAgent

$HeartbeatParentPid = $PID
Start-Job -ScriptBlock {
  while ($true) {
    try {
      $spot = Invoke-RestMethod -Uri "http://169.254.169.254/latest/meta-data/spot/instance-action" -Headers @{"X-aws-ec2-metadata-token"=(Invoke-RestMethod -Method PUT -Uri "http://169.254.169.254/latest/api/token" -Headers @{"X-aws-ec2-metadata-token-ttl-seconds"="1"} -TimeoutSec 2)} -TimeoutSec 2
      $spotJson = if ($spot -is [string]) { $spot } else { $spot | ConvertTo-Json -Compress }
      aws stepfunctions send-task-failure --task-token "$using:TASK_TOKEN" --error SpotInterrupted --cause "EC2 Spot instance interruption: $spotJson"
      break
    } catch {
    }
    aws stepfunctions send-task-heartbeat --task-token "$using:TASK_TOKEN"
    Start-Sleep -Seconds 60
  }
}
function setup_logs () {
  echo "{
    \`"logs\`": {
      \`"log_stream_name\`": \`"unknown\`",
      \`"logs_collected\`": {
        \`"files\`": {
         \`"collect_list\`": [
            {
              \`"file_path\`": \`"/actions/runner.log\`",
              \`"log_group_name\`": \`"$logGroupName\`",
              \`"log_stream_name\`": \`"$runnerNamePath\`",
              \`"timezone\`": \`"UTC\`"
            }
          ]
        }
      }
    }
  }" | Out-File -Encoding ASCII $Env:TEMP/log.conf
  & "C:/Program Files/Amazon/AmazonCloudWatchAgent/amazon-cloudwatch-agent-ctl.ps1" -a fetch-config -m ec2 -s -c file:$Env:TEMP/log.conf
}
function action () {
  cd /actions
  if ($jitConfig -ne "") {
    # JIT mode: cleaner registration, no config.cmd needed
    ./run.cmd --jitconfig "$jitConfig" 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log
    if ($LASTEXITCODE -ne 0) { return 2 }
  } else {
    # Legacy mode: register runner to pool with token
    $RunnerVersion = Get-Content /actions/RUNNER_VERSION -Raw
    if ($RunnerVersion -eq "latest") { $RunnerFlags = "" } else { $RunnerFlags = "--disableupdate" }
    ./config.cmd --unattended --url "\${registrationUrl}" --token "\${runnerTokenPath}" --ephemeral --work _work --labels "\${labels},cdkghr:started:$(Get-Date -UFormat +%s)" $RunnerFlags --name "\${runnerNamePath}" \${runnerGroup1} \${runnerGroup2} \${defaultLabels} 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log

    if ($LASTEXITCODE -ne 0) { return 1 }
    ./run.cmd 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log
    if ($LASTEXITCODE -ne 0) { return 2 }
  }

  $STATUS = Select-String -Path './_diag/*.log' -Pattern 'finish job request for job [0-9a-f\\-]+ with result: (.*)' | %{$_.Matches.Groups[1].Value} | Select-Object -Last 1

  if ($STATUS) {
      echo "CDKGHA JOB DONE \${labels} $STATUS" | Out-File -Encoding ASCII -Append /actions/runner.log
  }

  return 0
}
setup_logs
$r = action
if ($r -eq 0) {
  aws stepfunctions send-task-success --task-token "$TASK_TOKEN" --task-output '{ }' 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log
} else {
  $lastLine = Get-Content -Path C:/actions/runner.log -Tail 1 -ErrorAction SilentlyContinue
  aws stepfunctions send-task-failure --task-token "$TASK_TOKEN" --error Runner.Error.$r --cause "Check CloudWatch for full log -- $logGroupName/$runnerNamePath -- $lastLine" 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log
}
Start-Sleep -Seconds 10  # give cloudwatch agent its default 5 seconds buffer duration to upload logs
Stop-Computer -ComputerName localhost -Force
</powershell>
`.replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\\{\\}/g, '{}');
/**
 * GitHub Actions runner provider using EC2 to execute jobs.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
class Ec2RunnerProvider extends common_1.BaseProvider {
    /**
     * Create new image builder that builds EC2 specific runner images.
     *
     * You can customize the OS, architecture, VPC, subnet, security groups, etc. by passing in props.
     *
     * You can add components to the image builder by calling `imageBuilder.addComponent()`.
     *
     * The default OS is Ubuntu running on x64 architecture.
     *
     * Included components:
     *  * `RunnerImageComponent.requiredPackages()`
     *  * `RunnerImageComponent.cloudWatchAgent()`
     *  * `RunnerImageComponent.runnerUser()`
     *  * `RunnerImageComponent.git()`
     *  * `RunnerImageComponent.githubCli()`
     *  * `RunnerImageComponent.awsCli()`
     *  * `RunnerImageComponent.docker()`
     *  * `RunnerImageComponent.githubRunner()`
     */
    static imageBuilder(scope, id, props) {
        return image_builders_1.RunnerImageBuilder.new(scope, id, {
            os: common_1.Os.LINUX_UBUNTU,
            architecture: common_1.Architecture.X86_64,
            builderType: image_builders_1.RunnerImageBuilderType.AWS_IMAGE_BUILDER,
            components: [
                image_builders_1.RunnerImageComponent.requiredPackages(),
                image_builders_1.RunnerImageComponent.cloudWatchAgent(),
                image_builders_1.RunnerImageComponent.runnerUser(),
                image_builders_1.RunnerImageComponent.git(),
                image_builders_1.RunnerImageComponent.githubCli(),
                image_builders_1.RunnerImageComponent.awsCli(),
                image_builders_1.RunnerImageComponent.docker(),
                image_builders_1.RunnerImageComponent.githubRunner(props?.runnerVersion ?? common_1.RunnerVersion.latest()),
            ],
            ...props,
        });
    }
    constructor(scope, id, props) {
        super(scope, id, props);
        this.retryableErrors = [
            'Ec2.Ec2Exception',
            'States.Timeout',
        ];
        this.labels = props?.labels ?? ['ec2'];
        this.group = props?.group;
        this.vpc = props?.vpc ?? aws_cdk_lib_1.aws_ec2.Vpc.fromLookup(this, 'Default VPC', { isDefault: true });
        this.securityGroups = props?.securityGroup ? [props.securityGroup] : (props?.securityGroups ?? [new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, 'SG', { vpc: this.vpc })]);
        this.subnets = props?.subnet ? [props.subnet] : this.vpc.selectSubnets(props?.subnetSelection).subnets;
        this.instanceType = props?.instanceType ?? aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.M6I, aws_cdk_lib_1.aws_ec2.InstanceSize.LARGE);
        this.storageSize = props?.storageSize ?? cdk.Size.gibibytes(30); // 30 is the minimum for Windows
        this.storageOptions = props?.storageOptions;
        this.spot = props?.spot ?? false;
        this.spotMaxPrice = props?.spotMaxPrice;
        this.heartbeatTimeout = props?.heartbeatTimeout ?? cdk.Duration.minutes(10);
        this.defaultLabels = props?.defaultLabels ?? true;
        if (this.subnets.length === 0) {
            cdk.Annotations.of(this).addError('At least one subnet is required');
        }
        const arch = this.instanceType.architecture === aws_cdk_lib_1.aws_ec2.InstanceArchitecture.ARM_64 ? common_1.Architecture.ARM64 : common_1.Architecture.X86_64;
        this.amiBuilder = props?.imageBuilder ?? props?.amiBuilder ?? Ec2RunnerProvider.imageBuilder(this, 'Ami Builder', {
            vpc: props?.vpc,
            subnetSelection: props?.subnetSelection,
            securityGroups: this.securityGroups,
            baseAmi: (0, utils_1.isGpuInstanceType)(this.instanceType) ? image_builders_1.BaseImage.fromGpuBase(common_1.Os.LINUX_UBUNTU, arch) : undefined,
            architecture: arch,
            awsImageBuilderOptions: {
                instanceType: arch.is(common_1.Architecture.ARM64) ? aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.M6G, aws_cdk_lib_1.aws_ec2.InstanceSize.LARGE) : undefined,
            },
        });
        this.ami = this.amiBuilder.bindAmi();
        if (this.amiBuilder instanceof image_builders_1.AwsImageBuilderRunnerImageBuilder) {
            if (this.amiBuilder.storageSize && this.storageSize.toBytes() < this.amiBuilder.storageSize.toBytes()) {
                cdk.Annotations.of(this).addError(`Runner storage size (${this.storageSize.toGibibytes()} GiB) must be at least the same as the image builder storage size (${this.amiBuilder.storageSize.toGibibytes()} GiB)`);
            }
        }
        if (!this.ami.architecture.instanceTypeMatch(this.instanceType)) {
            cdk.Annotations.of(this).addError(`AMI architecture (${this.ami.architecture.name}) doesn't match runner instance type (${this.instanceType} / ${this.instanceType.architecture})`);
        }
        this.grantPrincipal = this.role = new aws_cdk_lib_1.aws_iam.Role(this, 'Role', {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('ec2.amazonaws.com'),
        });
        this.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['states:SendTaskFailure', 'states:SendTaskSuccess', 'states:SendTaskHeartbeat'],
            resources: ['*'], // no support for stateMachine.stateMachineArn but task tokens are very long and totally random so not the end of the world
        }));
        this.grantPrincipal.addToPrincipalPolicy(utils_1.MINIMAL_EC2_SSM_SESSION_MANAGER_POLICY_STATEMENT);
        this.logGroup = new aws_cdk_lib_1.aws_logs.LogGroup(this, 'Logs', {
            retention: props?.logRetention ?? aws_logs_1.RetentionDays.ONE_MONTH,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
        });
        this.logGroup.grantWrite(this);
    }
    userDataConst() {
        return this.ami.os.is(common_1.Os.WINDOWS) ? 'ec2UserDataWindows' : 'ec2UserDataLinux';
    }
    stepFunctionConstants() {
        const userdataTemplate = this.ami.os.is(common_1.Os.WINDOWS) ? windowsUserDataTemplate : linuxUserDataTemplate;
        return { [this.userDataConst()]: userdataTemplate };
    }
    /**
     * Generate step function task(s) to start a new runner.
     *
     * Called by GithubRunners and shouldn't be called manually.
     *
     * @param parameters workflow job details
     */
    getStepFunctionTask(parameters) {
        // we need to build user data in two steps because passing the template as the first parameter to stepfunctions.JsonPath.format fails on syntax
        const params = [
            aws_cdk_lib_1.aws_stepfunctions.JsonPath.taskToken,
            this.logGroup.logGroupName,
            parameters.runnerNamePath,
            parameters.githubDomainPath,
            parameters.ownerPath,
            parameters.repoPath,
            parameters.runnerTokenPath,
            parameters.labelsPath,
            parameters.registrationUrl,
            this.group ? '--runnergroup' : '',
            // this is split into 2 for powershell otherwise it will pass "--runnergroup name" as a single argument and config.sh will fail
            this.group ? this.group : '',
            this.defaultLabels ? '' : '--no-default-labels',
            parameters.jitConfigPath,
        ];
        // we use ec2:RunInstances because we must
        // we can't use fleets because they don't let us override user data, security groups or even disk size
        // we can't use requestSpotInstances because it doesn't support launch templates, and it's deprecated
        // ec2:RunInstances also seemed like the only one to immediately return an error when spot capacity is not available
        // we build a complicated chain of states here because ec2:RunInstances can only try one subnet at a time
        // if someone can figure out a good way to use Map for this, please open a PR
        // build a state for each subnet we want to try
        const instanceProfile = new aws_cdk_lib_1.aws_iam.CfnInstanceProfile(this, 'Instance Profile', {
            roles: [this.role.roleName],
        });
        const rootDeviceResource = (0, common_1.amiRootDevice)(this, this.ami.launchTemplate.launchTemplateId);
        rootDeviceResource.node.addDependency(this.amiBuilder);
        const subnetRunners = this.subnets.map(subnet => {
            return new aws_cdk_lib_1.aws_stepfunctions_tasks.CallAwsService(this, subnet.subnetId, {
                stateName: (0, common_1.generateStateName)(this, subnet.subnetId),
                comment: subnet.availabilityZone,
                integrationPattern: aws_cdk_lib_1.aws_stepfunctions.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
                service: 'ec2',
                action: 'runInstances',
                heartbeatTimeout: aws_cdk_lib_1.aws_stepfunctions.Timeout.duration(this.heartbeatTimeout),
                parameters: {
                    LaunchTemplate: {
                        LaunchTemplateId: this.ami.launchTemplate.launchTemplateId,
                    },
                    MinCount: 1,
                    MaxCount: 1,
                    InstanceType: this.instanceType.toString(),
                    UserData: aws_cdk_lib_1.aws_stepfunctions.JsonPath.base64Encode(aws_cdk_lib_1.aws_stepfunctions.JsonPath.format(
                    // see stepFunctionConstants()
                    aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt(`$.consts.${this.userDataConst()}`), ...params)),
                    InstanceInitiatedShutdownBehavior: aws_cdk_lib_1.aws_ec2.InstanceInitiatedShutdownBehavior.TERMINATE,
                    IamInstanceProfile: {
                        Arn: instanceProfile.attrArn,
                    },
                    MetadataOptions: {
                        HttpTokens: 'required',
                    },
                    SecurityGroupIds: this.securityGroups.map(sg => sg.securityGroupId),
                    SubnetId: subnet.subnetId,
                    BlockDeviceMappings: [{
                            DeviceName: rootDeviceResource.ref,
                            Ebs: {
                                DeleteOnTermination: true,
                                VolumeSize: this.storageSize.toGibibytes(),
                                VolumeType: this.storageOptions?.volumeType,
                                Iops: this.storageOptions?.iops,
                                Throughput: this.storageOptions?.throughput,
                            },
                        }],
                    InstanceMarketOptions: this.spot ? {
                        MarketType: 'spot',
                        SpotOptions: {
                            MaxPrice: this.spotMaxPrice,
                            SpotInstanceType: 'one-time',
                        },
                    } : undefined,
                    TagSpecifications: ['instance', 'volume'].map(resType => {
                        return {
                            ResourceType: resType,
                            Tags: [
                                {
                                    Key: 'Name',
                                    Value: parameters.runnerNamePath,
                                },
                                {
                                    Key: 'GitHubRunners:Provider',
                                    Value: this.node.path,
                                },
                                {
                                    Key: 'GitHubRunners:Repo',
                                    Value: aws_cdk_lib_1.aws_stepfunctions.JsonPath.format('{}/{}', parameters.ownerPath, parameters.repoPath),
                                },
                                {
                                    Key: 'GitHubRunners:Labels',
                                    Value: parameters.labelsPath,
                                },
                            ],
                        };
                    }),
                },
                iamResources: ['*'],
            });
        });
        const head = subnetRunners[0];
        let current = subnetRunners[0];
        for (let i = 1; i < subnetRunners.length; i++) {
            const next = subnetRunners[i];
            parameters.addCatchAndCleanUp(current, next);
            current = next;
        }
        return new SimpleFragment(this, 'Fragment', head, current);
    }
    grantStateMachine(stateMachineRole) {
        stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['iam:PassRole'],
            resources: [this.role.roleArn],
            conditions: {
                StringEquals: {
                    'iam:PassedToService': 'ec2.amazonaws.com',
                },
            },
        }));
        stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['ec2:createTags'],
            resources: [aws_cdk_lib_1.Stack.of(this).formatArn({
                    service: 'ec2',
                    resource: '*',
                })],
        }));
        stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['iam:CreateServiceLinkedRole'],
            resources: ['*'],
            conditions: {
                StringEquals: {
                    'iam:AWSServiceName': 'spot.amazonaws.com',
                },
            },
        }));
    }
    status(statusFunctionRole) {
        statusFunctionRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['ec2:DescribeLaunchTemplateVersions'],
            resources: ['*'],
        }));
        return {
            type: this.constructor.name,
            labels: this.labels,
            constructPath: this.node.path,
            securityGroups: this.securityGroups.map(sg => sg.securityGroupId),
            roleArn: this.role.roleArn,
            logGroup: this.logGroup.logGroupName,
            ami: {
                launchTemplate: this.ami.launchTemplate.launchTemplateId || 'unknown',
                amiBuilderLogGroup: this.ami.logGroup?.logGroupName,
            },
        };
    }
    /**
     * The network connections associated with this resource.
     */
    get connections() {
        return new aws_cdk_lib_1.aws_ec2.Connections({ securityGroups: this.securityGroups });
    }
}
exports.Ec2RunnerProvider = Ec2RunnerProvider;
_a = JSII_RTTI_SYMBOL_1;
Ec2RunnerProvider[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.Ec2RunnerProvider", version: "0.0.0" };
/**
 * @deprecated use {@link Ec2RunnerProvider}
 */
class Ec2Runner extends Ec2RunnerProvider {
}
exports.Ec2Runner = Ec2Runner;
_b = JSII_RTTI_SYMBOL_1;
Ec2Runner[_b] = { fqn: "@cloudsnorkel/cdk-github-runners.Ec2Runner", version: "0.0.0" };
/**
 * @internal
 */
class SimpleFragment extends aws_cdk_lib_1.aws_stepfunctions.StateMachineFragment {
    constructor(scope, id, start, end) {
        super(scope, id);
        this.startState = start;
        this.endStates = [end];
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWMyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9lYzIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxtQ0FBbUM7QUFDbkMsNkNBUXFCO0FBQ3JCLG1EQUFxRDtBQUVyRCxxQ0Fha0I7QUFDbEIsc0RBUTJCO0FBQzNCLG9DQUErRjtBQUUvRiw2RUFBNkU7QUFDN0UscURBQXFEO0FBQ3JELE1BQU0scUJBQXFCLEdBQUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NBeUY3QixDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxDQUFDO0FBRXJFLDZFQUE2RTtBQUM3RSxtR0FBbUc7QUFDbkcsTUFBTSx1QkFBdUIsR0FBRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQTJGL0IsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztBQXlJckU7Ozs7R0FJRztBQUNILE1BQWEsaUJBQWtCLFNBQVEscUJBQVk7SUFDakQ7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQWtCRztJQUNJLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBK0I7UUFDdEYsT0FBTyxtQ0FBa0IsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUN2QyxFQUFFLEVBQUUsV0FBRSxD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O2FBQ3BEO1NBQ0YsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILElBQVcsV0FBVztRQUNwQixPQUFPLElBQUkscUJBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUM7SUFDdEUsQ0FBQzs7QUFqVkgsOENBa1ZDOzs7QUFFRDs7R0FFRztBQUNILE1BQWEsU0FBVSxTQUFRLGlCQUFpQjs7QUFBaEQsOEJBQ0M7OztBQUVEOztHQUVHO0FBQ0gsTUFBTSxjQUFlLFNBQVEsK0JBQWEsQ0FBQyxvQkFBb0I7SUFJN0QsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEwQixFQUFFLEdBQTRCO1FBQ2hHLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDakIsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUM7UUFDeEIsSUFBSSxDQUFDLFNBQVMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3pCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMsXG4gIGF3c19zdGVwZnVuY3Rpb25zX3Rhc2tzIGFzIHN0ZXBmdW5jdGlvbnNfdGFza3MsXG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrLFxufSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQge1xuICBhbWlSb290RGV2aWNlLFxuICBBcmNoaXRlY3R1cmUsXG4gIEJhc2VQcm92aWRlcixcbiAgZ2VuZXJhdGVTdGF0ZU5hbWUsXG4gIElSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyU3RhdHVzLFxuICBJUnVubmVyUnVudGltZVBhcmFtZXRlcnMsXG4gIE9zLFxuICBSdW5uZXJBbWksXG4gIFJ1bm5lclByb3ZpZGVyUHJvcHMsXG4gIFJ1bm5lclZlcnNpb24sXG4gIFN0b3JhZ2VPcHRpb25zLFxufSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQge1xuICBBd3NJbWFnZUJ1aWxkZXJSdW5uZXJJbWFnZUJ1aWxkZXIsXG4gIEJhc2VJbWFnZSxcbiAgSVJ1bm5lckltYWdlQnVpbGRlcixcbiAgUnVubmVySW1hZ2VCdWlsZGVyLFxuICBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcyxcbiAgUnVubmVySW1hZ2VCdWlsZGVyVHlwZSxcbiAgUnVubmVySW1hZ2VDb21wb25lbnQsXG59IGZyb20gJy4uL2ltYWdlLWJ1aWxkZXJzJztcbmltcG9ydCB7IGlzR3B1SW5zdGFuY2VUeXBlLCBNSU5JTUFMX0VDMl9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQgfSBmcm9tICcuLi91dGlscyc7XG5cbi8vIHRoaXMgc2NyaXB0IGlzIHNwZWNpZmljYWxseSBtYWRlIHNvIGBwb3dlcm9mZmAgaXMgYWJzb2x1dGVseSBhbHdheXMgY2FsbGVkXG4vLyBlYWNoIGB7fWAgaXMgYSB2YXJpYWJsZSBjb21pbmcgZnJvbSBgcGFyYW1zYCBiZWxvd1xuY29uc3QgbGludXhVc2VyRGF0YVRlbXBsYXRlID0gYCMhL2Jpbi9iYXNoXG5zZXQgLXggLW8gcGlwZWZhaWxcblxuVEFTS19UT0tFTj1cInt9XCJcbmxvZ0dyb3VwTmFtZT1cInt9XCJcbnJ1bm5lck5hbWVQYXRoPVwie31cIlxuZ2l0aHViRG9tYWluUGF0aD1cInt9XCJcbm93bmVyUGF0aD1cInt9XCJcbnJlcG9QYXRoPVwie31cIlxucnVubmVyVG9rZW5QYXRoPVwie31cIlxubGFiZWxzPVwie31cIlxucmVnaXN0cmF0aW9uVVJMPVwie31cIlxucnVubmVyR3JvdXAxPVwie31cIlxucnVubmVyR3JvdXAyPVwie31cIlxuZGVmYXVsdExhYmVscz1cInt9XCJcbmppdENvbmZpZz1cInt9XCJcblxuZXhwb3J0IEFXU19SRVRSWV9NT0RFPXN0YW5kYXJkICMgYmV0dGVyIHJldHJ5XG50b3VjaCAvdmFyL2xvZy9ydW5uZXIubG9nXG5cbmhlYXJ0YmVhdCAoKSB7XG4gIHdoaWxlIHRydWU7IGRvXG4gICAgU1BPVF9BQ1RJT049JChjdXJsIC1zIC1mIC1IIFwiWC1hd3MtZWMyLW1ldGFkYXRhLXRva2VuOiAkKGN1cmwgLXMgLWYgLVggUFVUIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvYXBpL3Rva2VuXCIgLUggXCJYLWF3cy1lYzItbWV0YWRhdGEtdG9rZW4tdHRsLXNlY29uZHM6IDFcIiAyPi9kZXYvbnVsbClcIiBcImh0dHA6Ly8xNjkuMjU0LjE2OS4yNTQvbGF0ZXN0L21ldGEtZGF0YS9zcG90L2luc3RhbmNlLWFjdGlvblwiIDI+L2Rldi9udWxsKSB8fCB0cnVlXG4gICAgaWYgWyAtbiBcIiRTUE9UX0FDVElPTlwiIF07IHRoZW5cbiAgICAgIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1mYWlsdXJlIC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgLS1lcnJvciBTcG90SW50ZXJydXB0ZWQgLS1jYXVzZSBcIkVDMiBTcG90IGluc3RhbmNlIGludGVycnVwdGlvbjogJFNQT1RfQUNUSU9OXCIgfHwgdHJ1ZVxuICAgICAgZXhpdCAwXG4gICAgZmlcbiAgICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2staGVhcnRiZWF0IC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCJcbiAgICBzbGVlcCA2MFxuICBkb25lXG59XG5zZXR1cF9sb2dzICgpIHtcbiAgY2F0IDw8RU9GID4gL3RtcC9sb2cuY29uZiB8fCBleGl0IDFcbiAge1xuICAgIFwibG9nc1wiOiB7XG4gICAgICBcImxvZ19zdHJlYW1fbmFtZVwiOiBcInVua25vd25cIixcbiAgICAgIFwibG9nc19jb2xsZWN0ZWRcIjoge1xuICAgICAgICBcImZpbGVzXCI6IHtcbiAgICAgICAgICBcImNvbGxlY3RfbGlzdFwiOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIFwiZmlsZV9wYXRoXCI6IFwiL3Zhci9sb2cvcnVubmVyLmxvZ1wiLFxuICAgICAgICAgICAgICBcImxvZ19ncm91cF9uYW1lXCI6IFwiJGxvZ0dyb3VwTmFtZVwiLFxuICAgICAgICAgICAgICBcImxvZ19zdHJlYW1fbmFtZVwiOiBcIiRydW5uZXJOYW1lUGF0aFwiLFxuICAgICAgICAgICAgICBcInRpbWV6b25lXCI6IFwiVVRDXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cbkVPRlxuICAvb3B0L2F3cy9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC9iaW4vYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQtY3RsIC1hIGZldGNoLWNvbmZpZyAtbSBlYzIgLXMgLWMgZmlsZTovdG1wL2xvZy5jb25mIHx8IGV4aXQgMlxufVxuYWN0aW9uICgpIHtcbiAgaWYgWyAtbiBcIiRqaXRDb25maWdcIiBdOyB0aGVuXG4gICAgIyBKSVQgbW9kZTogY2xlYW5lciByZWdpc3RyYXRpb24sIG5vIGNvbmZpZy5zaCBuZWVkZWRcbiAgICBzdWRvIC0tcHJlc2VydmUtZW52PUFXU19SRUdJT04gLUh1IHJ1bm5lciAvaG9tZS9ydW5uZXIvcnVuLnNoIC0taml0Y29uZmlnIFwiJGppdENvbmZpZ1wiIHx8IGV4aXQgMlxuICBlbHNlXG4gICAgIyBMZWdhY3kgbW9kZTogcmVnaXN0ZXIgcnVubmVyIHRvIHBvb2wgd2l0aCB0b2tlblxuICAgICMgRGV0ZXJtaW5lIHRoZSB2YWx1ZSBvZiBSVU5ORVJfRkxBR1NcbiAgICBpZiBbIFwiJCg8IC9ob21lL3J1bm5lci9SVU5ORVJfVkVSU0lPTilcIiA9IFwibGF0ZXN0XCIgXTsgdGhlblxuICAgICAgUlVOTkVSX0ZMQUdTPVwiXCJcbiAgICBlbHNlXG4gICAgICBSVU5ORVJfRkxBR1M9XCItLWRpc2FibGV1cGRhdGVcIlxuICAgIGZpXG5cbiAgICBsYWJlbHNUZW1wbGF0ZT1cIiRsYWJlbHMsY2RrZ2hyOnN0YXJ0ZWQ6JChkYXRlICslcylcIlxuXG4gICAgIyBFeGVjdXRlIHRoZSBjb25maWd1cmF0aW9uIGNvbW1hbmQgZm9yIHJ1bm5lciByZWdpc3RyYXRpb25cbiAgICBzdWRvIC1IdSBydW5uZXIgL2hvbWUvcnVubmVyL2NvbmZpZy5zaCAtLXVuYXR0ZW5kZWQgLS11cmwgXCIkcmVnaXN0cmF0aW9uVVJMXCIgLS10b2tlbiBcIiRydW5uZXJUb2tlblBhdGhcIiAtLWVwaGVtZXJhbCAtLXdvcmsgX3dvcmsgLS1sYWJlbHMgXCIkbGFiZWxzVGVtcGxhdGVcIiAkUlVOTkVSX0ZMQUdTIC0tbmFtZSBcIiRydW5uZXJOYW1lUGF0aFwiICRydW5uZXJHcm91cDEgJHJ1bm5lckdyb3VwMiAkZGVmYXVsdExhYmVscyB8fCBleGl0IDFcblxuICAgICMgRXhlY3V0ZSB0aGUgcnVuIGNvbW1hbmRcbiAgICBzdWRvIC0tcHJlc2VydmUtZW52PUFXU19SRUdJT04gLUh1IHJ1bm5lciAvaG9tZS9ydW5uZXIvcnVuLnNoIHx8IGV4aXQgMlxuICBmaVxuXG4gICMgUmV0cmlldmUgdGhlIHN0YXR1c1xuICBTVEFUVVM9JChncmVwIC1QaG9ycyBcImZpbmlzaCBqb2IgcmVxdWVzdCBmb3Igam9iIFswLTlhLWYtXSsgd2l0aCByZXN1bHQ6IC4qXCIgL2hvbWUvcnVubmVyL19kaWFnLyB8IHRhaWwgLW4xIHwgYXdrICd7cHJpbnQgJE5GfScpXG5cbiAgIyBDaGVjayBhbmQgcHJpbnQgdGhlIGpvYiBzdGF0dXNcbiAgWyAtbiBcIiRTVEFUVVNcIiBdICYmIGVjaG8gQ0RLR0hBIEpPQiBET05FIFwiJGxhYmVsc1wiIFwiJFNUQVRVU1wiXG59XG5oZWFydGJlYXQgJlxuaWYgc2V0dXBfbG9ncyAmJiBhY3Rpb24gfCYgdGVlIC92YXIvbG9nL3J1bm5lci5sb2c7IHRoZW5cbiAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLXN1Y2Nlc3MgLS10YXNrLXRva2VuIFwiJFRBU0tfVE9LRU5cIiAtLXRhc2stb3V0cHV0ICd7XCJva1wiOiB0cnVlfScgfCYgdGVlIC1hIC92YXIvbG9nL3J1bm5lci5sb2dcbmVsc2VcbiAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLWZhaWx1cmUgLS10YXNrLXRva2VuIFwiJFRBU0tfVE9LRU5cIiAtLWVycm9yIFJ1bm5lci5FcnJvci4kPyAtLWNhdXNlIFwiQ2hlY2sgQ2xvdWRXYXRjaCBmb3IgZnVsbCBsb2cgLS0gJGxvZ0dyb3VwTmFtZS8kcnVubmVyTmFtZVBhdGggLS0gJCh0YWlsIC1uIDEgL3Zhci9sb2cvcnVubmVyLmxvZylcIiB8JiB0ZWUgLWEgL3Zhci9sb2cvcnVubmVyLmxvZ1xuZmlcbnNsZWVwIDEwICAjIGdpdmUgY2xvdWR3YXRjaCBhZ2VudCBpdHMgZGVmYXVsdCA1IHNlY29uZHMgYnVmZmVyIGR1cmF0aW9uIHRvIHVwbG9hZCBsb2dzXG5wb3dlcm9mZlxuYC5yZXBsYWNlKC97L2csICdcXFxceycpLnJlcGxhY2UoL30vZywgJ1xcXFx9JykucmVwbGFjZSgvXFxcXHtcXFxcfS9nLCAne30nKTtcblxuLy8gdGhpcyBzY3JpcHQgaXMgc3BlY2lmaWNhbGx5IG1hZGUgc28gYHBvd2Vyb2ZmYCBpcyBhYnNvbHV0ZWx5IGFsd2F5cyBjYWxsZWRcbi8vIGVhY2ggYHt9YCBpcyBhIHZhcmlhYmxlIGNvbWluZyBmcm9tIGBwYXJhbXNgIGJlbG93IGFuZCB0aGVpciBvcmRlciBzaG91bGQgbWF0Y2ggdGhlIGxpbnV4IHNjcmlwdFxuY29uc3Qgd2luZG93c1VzZXJEYXRhVGVtcGxhdGUgPSBgPHBvd2Vyc2hlbGw+XG4kVEFTS19UT0tFTiA9IFwie31cIlxuJGxvZ0dyb3VwTmFtZT1cInt9XCJcbiRydW5uZXJOYW1lUGF0aD1cInt9XCJcbiRnaXRodWJEb21haW5QYXRoPVwie31cIlxuJG93bmVyUGF0aD1cInt9XCJcbiRyZXBvUGF0aD1cInt9XCJcbiRydW5uZXJUb2tlblBhdGg9XCJ7fVwiXG4kbGFiZWxzPVwie31cIlxuJHJlZ2lzdHJhdGlvblVSTD1cInt9XCJcbiRydW5uZXJHcm91cDE9XCJ7fVwiXG4kcnVubmVyR3JvdXAyPVwie31cIlxuJGRlZmF1bHRMYWJlbHM9XCJ7fVwiXG4kaml0Q29uZmlnPVwie31cIlxuXG4kRW52OkFXU19SRVRSWV9NT0RFID0gXCJzdGFuZGFyZFwiICAjIGJldHRlciByZXRyeVxuXG4jIEVDMkxhdW5jaCBvbmx5IHN0YXJ0cyBzc20gYWdlbnQgYWZ0ZXIgdXNlciBkYXRhIGlzIGRvbmUsIHNvIHdlIG5lZWQgdG8gc3RhcnQgaXQgb3Vyc2VsdmVzIChpdCBpcyBkaXNhYmxlZCBieSBkZWZhdWx0KVxuU2V0LVNlcnZpY2UgLVN0YXJ0dXBUeXBlIE1hbnVhbCBBbWF6b25TU01BZ2VudFxuU3RhcnQtU2VydmljZSBBbWF6b25TU01BZ2VudFxuXG4kSGVhcnRiZWF0UGFyZW50UGlkID0gJFBJRFxuU3RhcnQtSm9iIC1TY3JpcHRCbG9jayB7XG4gIHdoaWxlICgkdHJ1ZSkge1xuICAgIHRyeSB7XG4gICAgICAkc3BvdCA9IEludm9rZS1SZXN0TWV0aG9kIC1VcmkgXCJodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9tZXRhLWRhdGEvc3BvdC9pbnN0YW5jZS1hY3Rpb25cIiAtSGVhZGVycyBAe1wiWC1hd3MtZWMyLW1ldGFkYXRhLXRva2VuXCI9KEludm9rZS1SZXN0TWV0aG9kIC1NZXRob2QgUFVUIC1VcmkgXCJodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9hcGkvdG9rZW5cIiAtSGVhZGVycyBAe1wiWC1hd3MtZWMyLW1ldGFkYXRhLXRva2VuLXR0bC1zZWNvbmRzXCI9XCIxXCJ9IC1UaW1lb3V0U2VjIDIpfSAtVGltZW91dFNlYyAyXG4gICAgICAkc3BvdEpzb24gPSBpZiAoJHNwb3QgLWlzIFtzdHJpbmddKSB7ICRzcG90IH0gZWxzZSB7ICRzcG90IHwgQ29udmVydFRvLUpzb24gLUNvbXByZXNzIH1cbiAgICAgIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1mYWlsdXJlIC0tdGFzay10b2tlbiBcIiR1c2luZzpUQVNLX1RPS0VOXCIgLS1lcnJvciBTcG90SW50ZXJydXB0ZWQgLS1jYXVzZSBcIkVDMiBTcG90IGluc3RhbmNlIGludGVycnVwdGlvbjogJHNwb3RKc29uXCJcbiAgICAgIGJyZWFrXG4gICAgfSBjYXRjaCB7XG4gICAgfVxuICAgIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1oZWFydGJlYXQgLS10YXNrLXRva2VuIFwiJHVzaW5nOlRBU0tfVE9LRU5cIlxuICAgIFN0YXJ0LVNsZWVwIC1TZWNvbmRzIDYwXG4gIH1cbn1cbmZ1bmN0aW9uIHNldHVwX2xvZ3MgKCkge1xuICBlY2hvIFwie1xuICAgIFxcYFwibG9nc1xcYFwiOiB7XG4gICAgICBcXGBcImxvZ19zdHJlYW1fbmFtZVxcYFwiOiBcXGBcInVua25vd25cXGBcIixcbiAgICAgIFxcYFwibG9nc19jb2xsZWN0ZWRcXGBcIjoge1xuICAgICAgICBcXGBcImZpbGVzXFxgXCI6IHtcbiAgICAgICAgIFxcYFwiY29sbGVjdF9saXN0XFxgXCI6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgXFxgXCJmaWxlX3BhdGhcXGBcIjogXFxgXCIvYWN0aW9ucy9ydW5uZXIubG9nXFxgXCIsXG4gICAgICAgICAgICAgIFxcYFwibG9nX2dyb3VwX25hbWVcXGBcIjogXFxgXCIkbG9nR3JvdXBOYW1lXFxgXCIsXG4gICAgICAgICAgICAgIFxcYFwibG9nX3N0cmVhbV9uYW1lXFxgXCI6IFxcYFwiJHJ1bm5lck5hbWVQYXRoXFxgXCIsXG4gICAgICAgICAgICAgIFxcYFwidGltZXpvbmVcXGBcIjogXFxgXCJVVENcXGBcIlxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVwiIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJICRFbnY6VEVNUC9sb2cuY29uZlxuICAmIFwiQzovUHJvZ3JhbSBGaWxlcy9BbWF6b24vQW1hem9uQ2xvdWRXYXRjaEFnZW50L2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LWN0bC5wczFcIiAtYSBmZXRjaC1jb25maWcgLW0gZWMyIC1zIC1jIGZpbGU6JEVudjpURU1QL2xvZy5jb25mXG59XG5mdW5jdGlvbiBhY3Rpb24gKCkge1xuICBjZCAvYWN0aW9uc1xuICBpZiAoJGppdENvbmZpZyAtbmUgXCJcIikge1xuICAgICMgSklUIG1vZGU6IGNsZWFuZXIgcmVnaXN0cmF0aW9uLCBubyBjb25maWcuY21kIG5lZWRlZFxuICAgIC4vcnVuLmNtZCAtLWppdGNvbmZpZyBcIiRqaXRDb25maWdcIiAyPiYxIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xuICAgIGlmICgkTEFTVEVYSVRDT0RFIC1uZSAwKSB7IHJldHVybiAyIH1cbiAgfSBlbHNlIHtcbiAgICAjIExlZ2FjeSBtb2RlOiByZWdpc3RlciBydW5uZXIgdG8gcG9vbCB3aXRoIHRva2VuXG4gICAgJFJ1bm5lclZlcnNpb24gPSBHZXQtQ29udGVudCAvYWN0aW9ucy9SVU5ORVJfVkVSU0lPTiAtUmF3XG4gICAgaWYgKCRSdW5uZXJWZXJzaW9uIC1lcSBcImxhdGVzdFwiKSB7ICRSdW5uZXJGbGFncyA9IFwiXCIgfSBlbHNlIHsgJFJ1bm5lckZsYWdzID0gXCItLWRpc2FibGV1cGRhdGVcIiB9XG4gICAgLi9jb25maWcuY21kIC0tdW5hdHRlbmRlZCAtLXVybCBcIlxcJHtyZWdpc3RyYXRpb25Vcmx9XCIgLS10b2tlbiBcIlxcJHtydW5uZXJUb2tlblBhdGh9XCIgLS1lcGhlbWVyYWwgLS13b3JrIF93b3JrIC0tbGFiZWxzIFwiXFwke2xhYmVsc30sY2RrZ2hyOnN0YXJ0ZWQ6JChHZXQtRGF0ZSAtVUZvcm1hdCArJXMpXCIgJFJ1bm5lckZsYWdzIC0tbmFtZSBcIlxcJHtydW5uZXJOYW1lUGF0aH1cIiBcXCR7cnVubmVyR3JvdXAxfSBcXCR7cnVubmVyR3JvdXAyfSBcXCR7ZGVmYXVsdExhYmVsc30gMj4mMSB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcblxuICAgIGlmICgkTEFTVEVYSVRDT0RFIC1uZSAwKSB7IHJldHVybiAxIH1cbiAgICAuL3J1bi5jbWQgMj4mMSB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcbiAgICBpZiAoJExBU1RFWElUQ09ERSAtbmUgMCkgeyByZXR1cm4gMiB9XG4gIH1cblxuICAkU1RBVFVTID0gU2VsZWN0LVN0cmluZyAtUGF0aCAnLi9fZGlhZy8qLmxvZycgLVBhdHRlcm4gJ2ZpbmlzaCBqb2IgcmVxdWVzdCBmb3Igam9iIFswLTlhLWZcXFxcLV0rIHdpdGggcmVzdWx0OiAoLiopJyB8ICV7JF8uTWF0Y2hlcy5Hcm91cHNbMV0uVmFsdWV9IHwgU2VsZWN0LU9iamVjdCAtTGFzdCAxXG5cbiAgaWYgKCRTVEFUVVMpIHtcbiAgICAgIGVjaG8gXCJDREtHSEEgSk9CIERPTkUgXFwke2xhYmVsc30gJFNUQVRVU1wiIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xuICB9XG5cbiAgcmV0dXJuIDBcbn1cbnNldHVwX2xvZ3NcbiRyID0gYWN0aW9uXG5pZiAoJHIgLWVxIDApIHtcbiAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLXN1Y2Nlc3MgLS10YXNrLXRva2VuIFwiJFRBU0tfVE9LRU5cIiAtLXRhc2stb3V0cHV0ICd7IH0nIDI+JjEgfCBPdXQtRmlsZSAtRW5jb2RpbmcgQVNDSUkgLUFwcGVuZCAvYWN0aW9ucy9ydW5uZXIubG9nXG59IGVsc2Uge1xuICAkbGFzdExpbmUgPSBHZXQtQ29udGVudCAtUGF0aCBDOi9hY3Rpb25zL3J1bm5lci5sb2cgLVRhaWwgMSAtRXJyb3JBY3Rpb24gU2lsZW50bHlDb250aW51ZVxuICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2stZmFpbHVyZSAtLXRhc2stdG9rZW4gXCIkVEFTS19UT0tFTlwiIC0tZXJyb3IgUnVubmVyLkVycm9yLiRyIC0tY2F1c2UgXCJDaGVjayBDbG91ZFdhdGNoIGZvciBmdWxsIGxvZyAtLSAkbG9nR3JvdXBOYW1lLyRydW5uZXJOYW1lUGF0aCAtLSAkbGFzdExpbmVcIiAyPiYxIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xufVxuU3RhcnQtU2xlZXAgLVNlY29uZHMgMTAgICMgZ2l2ZSBjbG91ZHdhdGNoIGFnZW50IGl0cyBkZWZhdWx0IDUgc2Vjb25kcyBidWZmZXIgZHVyYXRpb24gdG8gdXBsb2FkIGxvZ3NcblN0b3AtQ29tcHV0ZXIgLUNvbXB1dGVyTmFtZSBsb2NhbGhvc3QgLUZvcmNlXG48L3Bvd2Vyc2hlbGw+XG5gLnJlcGxhY2UoL3svZywgJ1xcXFx7JykucmVwbGFjZSgvfS9nLCAnXFxcXH0nKS5yZXBsYWNlKC9cXFxce1xcXFx9L2csICd7fScpO1xuXG5cbi8qKlxuICogUHJvcGVydGllcyBmb3Ige0BsaW5rIEVjMlJ1bm5lclByb3ZpZGVyfSBjb25zdHJ1Y3QuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRWMyUnVubmVyUHJvdmlkZXJQcm9wcyBleHRlbmRzIFJ1bm5lclByb3ZpZGVyUHJvcHMge1xuICAvKipcbiAgICogUnVubmVyIGltYWdlIGJ1aWxkZXIgdXNlZCB0byBidWlsZCBBTUkgY29udGFpbmluZyBHaXRIdWIgUnVubmVyIGFuZCBhbGwgcmVxdWlyZW1lbnRzLlxuICAgKlxuICAgKiBUaGUgaW1hZ2UgYnVpbGRlciBkZXRlcm1pbmVzIHRoZSBPUyBhbmQgYXJjaGl0ZWN0dXJlIG9mIHRoZSBydW5uZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IEVjMlJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcigpXG4gICAqL1xuICByZWFkb25seSBpbWFnZUJ1aWxkZXI/OiBJUnVubmVySW1hZ2VCdWlsZGVyO1xuXG4gIC8qKlxuICAgKiBAZGVwcmVjYXRlZCB1c2UgaW1hZ2VCdWlsZGVyXG4gICAqL1xuICByZWFkb25seSBhbWlCdWlsZGVyPzogSVJ1bm5lckltYWdlQnVpbGRlcjtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgbGFiZWxzIHVzZWQgZm9yIHRoaXMgcHJvdmlkZXIuXG4gICAqXG4gICAqIFRoZXNlIGxhYmVscyBhcmUgdXNlZCB0byBpZGVudGlmeSB3aGljaCBwcm92aWRlciBzaG91bGQgc3Bhd24gYSBuZXcgb24tZGVtYW5kIHJ1bm5lci4gRXZlcnkgam9iIHNlbmRzIGEgd2ViaG9vayB3aXRoIHRoZSBsYWJlbHMgaXQncyBsb29raW5nIGZvclxuICAgKiBiYXNlZCBvbiBydW5zLW9uLiBXZSBtYXRjaCB0aGUgbGFiZWxzIGZyb20gdGhlIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIHNwZWNpZmllZCBoZXJlLiBJZiBhbGwgdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZSBhcmUgcHJlc2VudCBpbiB0aGVcbiAgICogam9iJ3MgbGFiZWxzLCB0aGlzIHByb3ZpZGVyIHdpbGwgYmUgY2hvc2VuIGFuZCBzcGF3biBhIG5ldyBydW5uZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IFsnZWMyJ11cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVscz86IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBHaXRIdWIgQWN0aW9ucyBydW5uZXIgZ3JvdXAgbmFtZS5cbiAgICpcbiAgICogSWYgc3BlY2lmaWVkLCB0aGUgcnVubmVyIHdpbGwgYmUgcmVnaXN0ZXJlZCB3aXRoIHRoaXMgZ3JvdXAgbmFtZS4gU2V0dGluZyBhIHJ1bm5lciBncm91cCBjYW4gaGVscCBtYW5hZ2luZyBhY2Nlc3MgdG8gc2VsZi1ob3N0ZWQgcnVubmVycy4gSXRcbiAgICogcmVxdWlyZXMgYSBwYWlkIEdpdEh1YiBhY2NvdW50LlxuICAgKlxuICAgKiBUaGUgZ3JvdXAgbXVzdCBleGlzdCBvciB0aGUgcnVubmVyIHdpbGwgbm90IHN0YXJ0LlxuICAgKlxuICAgKiBVc2VycyB3aWxsIHN0aWxsIGJlIGFibGUgdG8gdHJpZ2dlciB0aGlzIHJ1bm5lciB3aXRoIHRoZSBjb3JyZWN0IGxhYmVscy4gQnV0IHRoZSBydW5uZXIgd2lsbCBvbmx5IGJlIGFibGUgdG8gcnVuIGpvYnMgZnJvbSByZXBvcyBhbGxvd2VkIHRvIHVzZSB0aGUgZ3JvdXAuXG4gICAqXG4gICAqIEBkZWZhdWx0IHVuZGVmaW5lZFxuICAgKi9cbiAgcmVhZG9ubHkgZ3JvdXA/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIEluc3RhbmNlIHR5cGUgZm9yIGxhdW5jaGVkIHJ1bm5lciBpbnN0YW5jZXMuXG4gICAqXG4gICAqIEZvciBHUFUgaW5zdGFuY2UgdHlwZXMgKGc0ZG4sIGc1LCBwMywgZXRjLiksIHdlIGF1dG9tYXRpY2FsbHkgdXNlIGEgR1BVIGJhc2UgaW1hZ2UgKEFXUyBEZWVwIExlYXJuaW5nIEFNSSlcbiAgICogd2l0aCBOVklESUEgZHJpdmVycyBwcmUtaW5zdGFsbGVkLiBJZiB5b3UgcHJvdmlkZSB5b3VyIG93biBpbWFnZSBidWlsZGVyLCB1c2VcbiAgICogYGJhc2VBbWk6IEJhc2VJbWFnZS5mcm9tR3B1QmFzZShvcywgYXJjaGl0ZWN0dXJlKWAgb3IgYW5vdGhlciBpbWFnZSBwcmVsb2FkZWQgd2l0aCBOVklESUEgZHJpdmVycywgb3IgdXNlXG4gICAqIGFuIGltYWdlIGNvbXBvbmVudCB0byBpbnN0YWxsIE5WSURJQSBkcml2ZXJzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBtNmkubGFyZ2VcbiAgICovXG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZT86IGVjMi5JbnN0YW5jZVR5cGU7XG5cbiAgLyoqXG4gICAqIFNpemUgb2Ygdm9sdW1lIGF2YWlsYWJsZSBmb3IgbGF1bmNoZWQgcnVubmVyIGluc3RhbmNlcy4gVGhpcyBtb2RpZmllcyB0aGUgYm9vdCB2b2x1bWUgc2l6ZSBhbmQgZG9lc24ndCBhZGQgYW55IGFkZGl0aW9uYWwgdm9sdW1lcy5cbiAgICpcbiAgICogQGRlZmF1bHQgMzBHQlxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcblxuICAvKipcbiAgICogT3B0aW9ucyBmb3IgcnVubmVyIGluc3RhbmNlIHN0b3JhZ2Ugdm9sdW1lLlxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZU9wdGlvbnM/OiBTdG9yYWdlT3B0aW9ucztcblxuICAvKipcbiAgICogU2VjdXJpdHkgR3JvdXAgdG8gYXNzaWduIHRvIGxhdW5jaGVkIHJ1bm5lciBpbnN0YW5jZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IGEgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgc2VjdXJpdHlHcm91cHN9XG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwPzogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgdG8gYXNzaWduIHRvIGxhdW5jaGVkIHJ1bm5lciBpbnN0YW5jZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IGEgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3Vwcz86IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIC8qKlxuICAgKiBTdWJuZXQgd2hlcmUgdGhlIHJ1bm5lciBpbnN0YW5jZXMgd2lsbCBiZSBsYXVuY2hlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBzdWJuZXQgb2YgYWNjb3VudCdzIGRlZmF1bHQgVlBDXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgdnBjfSBhbmQge0BsaW5rIHN1Ym5ldFNlbGVjdGlvbn1cbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldD86IGVjMi5JU3VibmV0O1xuXG4gIC8qKlxuICAgKiBWUEMgd2hlcmUgcnVubmVyIGluc3RhbmNlcyB3aWxsIGJlIGxhdW5jaGVkLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IGFjY291bnQgVlBDXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogV2hlcmUgdG8gcGxhY2UgdGhlIG5ldHdvcmsgaW50ZXJmYWNlcyB3aXRoaW4gdGhlIFZQQy4gT25seSB0aGUgZmlyc3QgbWF0Y2hlZCBzdWJuZXQgd2lsbCBiZSB1c2VkLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IFZQQyBzdWJuZXRcbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIFVzZSBzcG90IGluc3RhbmNlcyB0byBzYXZlIG1vbmV5LiBTcG90IGluc3RhbmNlcyBhcmUgY2hlYXBlciBidXQgbm90IGFsd2F5cyBhdmFpbGFibGUgYW5kIGNhbiBiZSBzdG9wcGVkIHByZW1hdHVyZWx5LlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFNldCBhIG1heGltdW0gcHJpY2UgZm9yIHNwb3QgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBubyBtYXggcHJpY2UgKHlvdSB3aWxsIHBheSBjdXJyZW50IHNwb3QgcHJpY2UpXG4gICAqL1xuICByZWFkb25seSBzcG90TWF4UHJpY2U/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIE1heGltdW0gdGltZSB0aGUgU3RlcCBGdW5jdGlvbnMgdGFzayB3YWl0cyBiZXR3ZWVuIEVDMiBoZWFydGJlYXRzIGJlZm9yZVxuICAgKiBmYWxsaW5nIGJhY2sgdG8gdGhlIG5leHQgc3VibmV0IC8gZmFpbGluZyB0aGUgdGFzay5cbiAgICpcbiAgICogSWYgeW91ciBqb2IgcnVucyBsb25nZXIgdGhhbiAxMCBtaW51dGVzIHlvdSBtdXN0IHJhaXNlIHRoaXMg4oCUIHRoZSBwcmV2aW91c1xuICAgKiBoYXJkY29kZWQgMTAtbWludXRlIGRlZmF1bHQgY2F1c2VkIGZhbHNlIFwic3R1Y2tcIiBkZXRlY3Rpb25zIGZvciBhbnkgam9iXG4gICAqIHRoYXQgdG9vayBsb25nZXIgdG8gY29tcGxldGUgdGhhbiB0aGUgaGVhcnRiZWF0IGludGVydmFsIChlLmcuIExvY2FsU3RhY2tcbiAgICogc25hcHNob3QgZGVwbG95cywgaW50ZWdyYXRpb24gdGVzdHMgd2l0aCBsYXJnZSBmaXh0dXJlIHNldHVwLCBldGMuKS5cbiAgICpcbiAgICogQGRlZmF1bHQgY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApXG4gICAqL1xuICByZWFkb25seSBoZWFydGJlYXRUaW1lb3V0PzogY2RrLkR1cmF0aW9uO1xufVxuXG4vKipcbiAqIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciBwcm92aWRlciB1c2luZyBFQzIgdG8gZXhlY3V0ZSBqb2JzLlxuICpcbiAqIFRoaXMgY29uc3RydWN0IGlzIG5vdCBtZWFudCB0byBiZSB1c2VkIGJ5IGl0c2VsZi4gSXQgc2hvdWxkIGJlIHBhc3NlZCBpbiB0aGUgcHJvdmlkZXJzIHByb3BlcnR5IGZvciBHaXRIdWJSdW5uZXJzLlxuICovXG5leHBvcnQgY2xhc3MgRWMyUnVubmVyUHJvdmlkZXIgZXh0ZW5kcyBCYXNlUHJvdmlkZXIgaW1wbGVtZW50cyBJUnVubmVyUHJvdmlkZXIge1xuICAvKipcbiAgICogQ3JlYXRlIG5ldyBpbWFnZSBidWlsZGVyIHRoYXQgYnVpbGRzIEVDMiBzcGVjaWZpYyBydW5uZXIgaW1hZ2VzLlxuICAgKlxuICAgKiBZb3UgY2FuIGN1c3RvbWl6ZSB0aGUgT1MsIGFyY2hpdGVjdHVyZSwgVlBDLCBzdWJuZXQsIHNlY3VyaXR5IGdyb3VwcywgZXRjLiBieSBwYXNzaW5nIGluIHByb3BzLlxuICAgKlxuICAgKiBZb3UgY2FuIGFkZCBjb21wb25lbnRzIHRvIHRoZSBpbWFnZSBidWlsZGVyIGJ5IGNhbGxpbmcgYGltYWdlQnVpbGRlci5hZGRDb21wb25lbnQoKWAuXG4gICAqXG4gICAqIFRoZSBkZWZhdWx0IE9TIGlzIFVidW50dSBydW5uaW5nIG9uIHg2NCBhcmNoaXRlY3R1cmUuXG4gICAqXG4gICAqIEluY2x1ZGVkIGNvbXBvbmVudHM6XG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5jbG91ZFdhdGNoQWdlbnQoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcigpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViUnVubmVyKClgXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGltYWdlQnVpbGRlcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IFJ1bm5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgcmV0dXJuIFJ1bm5lckltYWdlQnVpbGRlci5uZXcoc2NvcGUsIGlkLCB7XG4gICAgICBvczogT3MuTElOVVhfVUJVTlRVLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBBcmNoaXRlY3R1cmUuWDg2XzY0LFxuICAgICAgYnVpbGRlclR5cGU6IFJ1bm5lckltYWdlQnVpbGRlclR5cGUuQVdTX0lNQUdFX0JVSUxERVIsXG4gICAgICBjb21wb25lbnRzOiBbXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LnJlcXVpcmVkUGFja2FnZXMoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuY2xvdWRXYXRjaEFnZW50KCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LnJ1bm5lclVzZXIoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5hd3NDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcihwcm9wcz8ucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpKSxcbiAgICAgIF0sXG4gICAgICAuLi5wcm9wcyxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYWJlbHMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcHJvdmlkZXIuXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM6IHN0cmluZ1tdO1xuXG4gIC8qKlxuICAgKiBHcmFudCBwcmluY2lwYWwgdXNlZCB0byBhZGQgcGVybWlzc2lvbnMgdG8gdGhlIHJ1bm5lciByb2xlLlxuICAgKi9cbiAgcmVhZG9ubHkgZ3JhbnRQcmluY2lwYWw6IGlhbS5JUHJpbmNpcGFsO1xuXG4gIC8qKlxuICAgKiBMb2cgZ3JvdXAgd2hlcmUgcHJvdmlkZWQgcnVubmVycyB3aWxsIHNhdmUgdGhlaXIgbG9ncy5cbiAgICpcbiAgICogTm90ZSB0aGF0IHRoaXMgaXMgbm90IHRoZSBqb2IgbG9nLCBidXQgdGhlIHJ1bm5lciBpdHNlbGYuIEl0IHdpbGwgbm90IGNvbnRhaW4gb3V0cHV0IGZyb20gdGhlIEdpdEh1YiBBY3Rpb24gYnV0IG9ubHkgbWV0YWRhdGEgb24gaXRzIGV4ZWN1dGlvbi5cbiAgICovXG4gIHJlYWRvbmx5IGxvZ0dyb3VwOiBsb2dzLklMb2dHcm91cDtcblxuICByZWFkb25seSByZXRyeWFibGVFcnJvcnMgPSBbXG4gICAgJ0VjMi5FYzJFeGNlcHRpb24nLFxuICAgICdTdGF0ZXMuVGltZW91dCcsXG4gIF07XG5cbiAgcHJpdmF0ZSByZWFkb25seSBncm91cD86IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBhbWlCdWlsZGVyOiBJUnVubmVySW1hZ2VCdWlsZGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IGFtaTogUnVubmVyQW1pO1xuICBwcml2YXRlIHJlYWRvbmx5IHJvbGU6IGlhbS5Sb2xlO1xuICBwcml2YXRlIHJlYWRvbmx5IGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdG9yYWdlU2l6ZTogY2RrLlNpemU7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RvcmFnZU9wdGlvbnM/OiBTdG9yYWdlT3B0aW9ucztcbiAgcHJpdmF0ZSByZWFkb25seSBzcG90OiBib29sZWFuO1xuICBwcml2YXRlIHJlYWRvbmx5IHNwb3RNYXhQcmljZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IGhlYXJ0YmVhdFRpbWVvdXQ6IGNkay5EdXJhdGlvbjtcbiAgcHJpdmF0ZSByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuICBwcml2YXRlIHJlYWRvbmx5IHN1Ym5ldHM6IGVjMi5JU3VibmV0W107XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM6IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBFYzJSdW5uZXJQcm92aWRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICB0aGlzLmxhYmVscyA9IHByb3BzPy5sYWJlbHMgPz8gWydlYzInXTtcbiAgICB0aGlzLmdyb3VwID0gcHJvcHM/Lmdyb3VwO1xuICAgIHRoaXMudnBjID0gcHJvcHM/LnZwYyA/PyBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ0RlZmF1bHQgVlBDJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwID8gW3Byb3BzLnNlY3VyaXR5R3JvdXBdIDogKHByb3BzPy5zZWN1cml0eUdyb3VwcyA/PyBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdTRycsIHsgdnBjOiB0aGlzLnZwYyB9KV0pO1xuICAgIHRoaXMuc3VibmV0cyA9IHByb3BzPy5zdWJuZXQgPyBbcHJvcHMuc3VibmV0XSA6IHRoaXMudnBjLnNlbGVjdFN1Ym5ldHMocHJvcHM/LnN1Ym5ldFNlbGVjdGlvbikuc3VibmV0cztcbiAgICB0aGlzLmluc3RhbmNlVHlwZSA9IHByb3BzPy5pbnN0YW5jZVR5cGUgPz8gZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5NNkksIGVjMi5JbnN0YW5jZVNpemUuTEFSR0UpO1xuICAgIHRoaXMuc3RvcmFnZVNpemUgPSBwcm9wcz8uc3RvcmFnZVNpemUgPz8gY2RrLlNpemUuZ2liaWJ5dGVzKDMwKTsgLy8gMzAgaXMgdGhlIG1pbmltdW0gZm9yIFdpbmRvd3NcbiAgICB0aGlzLnN0b3JhZ2VPcHRpb25zID0gcHJvcHM/LnN0b3JhZ2VPcHRpb25zO1xuICAgIHRoaXMuc3BvdCA9IHByb3BzPy5zcG90ID8/IGZhbHNlO1xuICAgIHRoaXMuc3BvdE1heFByaWNlID0gcHJvcHM/LnNwb3RNYXhQcmljZTtcbiAgICB0aGlzLmhlYXJ0YmVhdFRpbWVvdXQgPSBwcm9wcz8uaGVhcnRiZWF0VGltZW91dCA/PyBjZGsuRHVyYXRpb24ubWludXRlcygxMCk7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcblxuICAgIGlmICh0aGlzLnN1Ym5ldHMubGVuZ3RoID09PSAwKSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoJ0F0IGxlYXN0IG9uZSBzdWJuZXQgaXMgcmVxdWlyZWQnKTtcbiAgICB9XG5cbiAgICBjb25zdCBhcmNoID0gdGhpcy5pbnN0YW5jZVR5cGUuYXJjaGl0ZWN0dXJlID09PSBlYzIuSW5zdGFuY2VBcmNoaXRlY3R1cmUuQVJNXzY0ID8gQXJjaGl0ZWN0dXJlLkFSTTY0IDogQXJjaGl0ZWN0dXJlLlg4Nl82NDtcblxuICAgIHRoaXMuYW1pQnVpbGRlciA9IHByb3BzPy5pbWFnZUJ1aWxkZXIgPz8gcHJvcHM/LmFtaUJ1aWxkZXIgPz8gRWMyUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKHRoaXMsICdBbWkgQnVpbGRlcicsIHtcbiAgICAgIHZwYzogcHJvcHM/LnZwYyxcbiAgICAgIHN1Ym5ldFNlbGVjdGlvbjogcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbixcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzLFxuICAgICAgYmFzZUFtaTogaXNHcHVJbnN0YW5jZVR5cGUodGhpcy5pbnN0YW5jZVR5cGUpID8gQmFzZUltYWdlLmZyb21HcHVCYXNlKE9zLkxJTlVYX1VCVU5UVSwgYXJjaCkgOiB1bmRlZmluZWQsXG4gICAgICBhcmNoaXRlY3R1cmU6IGFyY2gsXG4gICAgICBhd3NJbWFnZUJ1aWxkZXJPcHRpb25zOiB7XG4gICAgICAgIGluc3RhbmNlVHlwZTogYXJjaC5pcyhBcmNoaXRlY3R1cmUuQVJNNjQpID8gZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5NNkcsIGVjMi5JbnN0YW5jZVNpemUuTEFSR0UpIDogdW5kZWZpbmVkLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmFtaSA9IHRoaXMuYW1pQnVpbGRlci5iaW5kQW1pKCk7XG5cbiAgICBpZiAodGhpcy5hbWlCdWlsZGVyIGluc3RhbmNlb2YgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyKSB7XG4gICAgICBpZiAodGhpcy5hbWlCdWlsZGVyLnN0b3JhZ2VTaXplICYmIHRoaXMuc3RvcmFnZVNpemUudG9CeXRlcygpIDwgdGhpcy5hbWlCdWlsZGVyLnN0b3JhZ2VTaXplLnRvQnl0ZXMoKSkge1xuICAgICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoYFJ1bm5lciBzdG9yYWdlIHNpemUgKCR7dGhpcy5zdG9yYWdlU2l6ZS50b0dpYmlieXRlcygpfSBHaUIpIG11c3QgYmUgYXQgbGVhc3QgdGhlIHNhbWUgYXMgdGhlIGltYWdlIGJ1aWxkZXIgc3RvcmFnZSBzaXplICgke3RoaXMuYW1pQnVpbGRlci5zdG9yYWdlU2l6ZS50b0dpYmlieXRlcygpfSBHaUIpYCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLmFtaS5hcmNoaXRlY3R1cmUuaW5zdGFuY2VUeXBlTWF0Y2godGhpcy5pbnN0YW5jZVR5cGUpKSB7XG4gICAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkRXJyb3IoYEFNSSBhcmNoaXRlY3R1cmUgKCR7dGhpcy5hbWkuYXJjaGl0ZWN0dXJlLm5hbWV9KSBkb2Vzbid0IG1hdGNoIHJ1bm5lciBpbnN0YW5jZSB0eXBlICgke3RoaXMuaW5zdGFuY2VUeXBlfSAvICR7dGhpcy5pbnN0YW5jZVR5cGUuYXJjaGl0ZWN0dXJlfSlgKTtcbiAgICB9XG5cbiAgICB0aGlzLmdyYW50UHJpbmNpcGFsID0gdGhpcy5yb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2VjMi5hbWF6b25hd3MuY29tJyksXG4gICAgfSk7XG4gICAgdGhpcy5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ3N0YXRlczpTZW5kVGFza0ZhaWx1cmUnLCAnc3RhdGVzOlNlbmRUYXNrU3VjY2VzcycsICdzdGF0ZXM6U2VuZFRhc2tIZWFydGJlYXQnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sIC8vIG5vIHN1cHBvcnQgZm9yIHN0YXRlTWFjaGluZS5zdGF0ZU1hY2hpbmVBcm4gYnV0IHRhc2sgdG9rZW5zIGFyZSB2ZXJ5IGxvbmcgYW5kIHRvdGFsbHkgcmFuZG9tIHNvIG5vdCB0aGUgZW5kIG9mIHRoZSB3b3JsZFxuICAgIH0pKTtcbiAgICB0aGlzLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KE1JTklNQUxfRUMyX1NTTV9TRVNTSU9OX01BTkFHRVJfUE9MSUNZX1NUQVRFTUVOVCk7XG5cbiAgICB0aGlzLmxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAoXG4gICAgICB0aGlzLFxuICAgICAgJ0xvZ3MnLFxuICAgICAge1xuICAgICAgICByZXRlbnRpb246IHByb3BzPy5sb2dSZXRlbnRpb24gPz8gUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0sXG4gICAgKTtcbiAgICB0aGlzLmxvZ0dyb3VwLmdyYW50V3JpdGUodGhpcyk7XG4gIH1cblxuICBwcml2YXRlIHVzZXJEYXRhQ29uc3QoKSB7XG4gICAgcmV0dXJuIHRoaXMuYW1pLm9zLmlzKE9zLldJTkRPV1MpID8gJ2VjMlVzZXJEYXRhV2luZG93cycgOiAnZWMyVXNlckRhdGFMaW51eCc7XG4gIH1cblxuICBwdWJsaWMgc3RlcEZ1bmN0aW9uQ29uc3RhbnRzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIGNvbnN0IHVzZXJkYXRhVGVtcGxhdGUgPSB0aGlzLmFtaS5vcy5pcyhPcy5XSU5ET1dTKSA/IHdpbmRvd3NVc2VyRGF0YVRlbXBsYXRlIDogbGludXhVc2VyRGF0YVRlbXBsYXRlO1xuICAgIHJldHVybiB7IFt0aGlzLnVzZXJEYXRhQ29uc3QoKV06IHVzZXJkYXRhVGVtcGxhdGUgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZSBzdGVwIGZ1bmN0aW9uIHRhc2socykgdG8gc3RhcnQgYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBDYWxsZWQgYnkgR2l0aHViUnVubmVycyBhbmQgc2hvdWxkbid0IGJlIGNhbGxlZCBtYW51YWxseS5cbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlcnMgd29ya2Zsb3cgam9iIGRldGFpbHNcbiAgICovXG4gIGdldFN0ZXBGdW5jdGlvblRhc2socGFyYW1ldGVyczogSVJ1bm5lclJ1bnRpbWVQYXJhbWV0ZXJzKTogc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlIHtcbiAgICAvLyB3ZSBuZWVkIHRvIGJ1aWxkIHVzZXIgZGF0YSBpbiB0d28gc3RlcHMgYmVjYXVzZSBwYXNzaW5nIHRoZSB0ZW1wbGF0ZSBhcyB0aGUgZmlyc3QgcGFyYW1ldGVyIHRvIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguZm9ybWF0IGZhaWxzIG9uIHN5bnRheFxuXG4gICAgY29uc3QgcGFyYW1zID0gW1xuICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC50YXNrVG9rZW4sXG4gICAgICB0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIHBhcmFtZXRlcnMucnVubmVyTmFtZVBhdGgsXG4gICAgICBwYXJhbWV0ZXJzLmdpdGh1YkRvbWFpblBhdGgsXG4gICAgICBwYXJhbWV0ZXJzLm93bmVyUGF0aCxcbiAgICAgIHBhcmFtZXRlcnMucmVwb1BhdGgsXG4gICAgICBwYXJhbWV0ZXJzLnJ1bm5lclRva2VuUGF0aCxcbiAgICAgIHBhcmFtZXRlcnMubGFiZWxzUGF0aCxcbiAgICAgIHBhcmFtZXRlcnMucmVnaXN0cmF0aW9uVXJsLFxuICAgICAgdGhpcy5ncm91cCA/ICctLXJ1bm5lcmdyb3VwJyA6ICcnLFxuICAgICAgLy8gdGhpcyBpcyBzcGxpdCBpbnRvIDIgZm9yIHBvd2Vyc2hlbGwgb3RoZXJ3aXNlIGl0IHdpbGwgcGFzcyBcIi0tcnVubmVyZ3JvdXAgbmFtZVwiIGFzIGEgc2luZ2xlIGFyZ3VtZW50IGFuZCBjb25maWcuc2ggd2lsbCBmYWlsXG4gICAgICB0aGlzLmdyb3VwID8gdGhpcy5ncm91cCA6ICcnLFxuICAgICAgdGhpcy5kZWZhdWx0TGFiZWxzID8gJycgOiAnLS1uby1kZWZhdWx0LWxhYmVscycsXG4gICAgICBwYXJhbWV0ZXJzLmppdENvbmZpZ1BhdGgsXG4gICAgXTtcblxuICAgIC8vIHdlIHVzZSBlYzI6UnVuSW5zdGFuY2VzIGJlY2F1c2Ugd2UgbXVzdFxuICAgIC8vIHdlIGNhbid0IHVzZSBmbGVldHMgYmVjYXVzZSB0aGV5IGRvbid0IGxldCB1cyBvdmVycmlkZSB1c2VyIGRhdGEsIHNlY3VyaXR5IGdyb3VwcyBvciBldmVuIGRpc2sgc2l6ZVxuICAgIC8vIHdlIGNhbid0IHVzZSByZXF1ZXN0U3BvdEluc3RhbmNlcyBiZWNhdXNlIGl0IGRvZXNuJ3Qgc3VwcG9ydCBsYXVuY2ggdGVtcGxhdGVzLCBhbmQgaXQncyBkZXByZWNhdGVkXG4gICAgLy8gZWMyOlJ1bkluc3RhbmNlcyBhbHNvIHNlZW1lZCBsaWtlIHRoZSBvbmx5IG9uZSB0byBpbW1lZGlhdGVseSByZXR1cm4gYW4gZXJyb3Igd2hlbiBzcG90IGNhcGFjaXR5IGlzIG5vdCBhdmFpbGFibGVcblxuICAgIC8vIHdlIGJ1aWxkIGEgY29tcGxpY2F0ZWQgY2hhaW4gb2Ygc3RhdGVzIGhlcmUgYmVjYXVzZSBlYzI6UnVuSW5zdGFuY2VzIGNhbiBvbmx5IHRyeSBvbmUgc3VibmV0IGF0IGEgdGltZVxuICAgIC8vIGlmIHNvbWVvbmUgY2FuIGZpZ3VyZSBvdXQgYSBnb29kIHdheSB0byB1c2UgTWFwIGZvciB0aGlzLCBwbGVhc2Ugb3BlbiBhIFBSXG5cbiAgICAvLyBidWlsZCBhIHN0YXRlIGZvciBlYWNoIHN1Ym5ldCB3ZSB3YW50IHRvIHRyeVxuICAgIGNvbnN0IGluc3RhbmNlUHJvZmlsZSA9IG5ldyBpYW0uQ2ZuSW5zdGFuY2VQcm9maWxlKHRoaXMsICdJbnN0YW5jZSBQcm9maWxlJywge1xuICAgICAgcm9sZXM6IFt0aGlzLnJvbGUucm9sZU5hbWVdLFxuICAgIH0pO1xuICAgIGNvbnN0IHJvb3REZXZpY2VSZXNvdXJjZSA9IGFtaVJvb3REZXZpY2UodGhpcywgdGhpcy5hbWkubGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVJZCk7XG4gICAgcm9vdERldmljZVJlc291cmNlLm5vZGUuYWRkRGVwZW5kZW5jeSh0aGlzLmFtaUJ1aWxkZXIpO1xuICAgIGNvbnN0IHN1Ym5ldFJ1bm5lcnMgPSB0aGlzLnN1Ym5ldHMubWFwKHN1Ym5ldCA9PiB7XG4gICAgICByZXR1cm4gbmV3IHN0ZXBmdW5jdGlvbnNfdGFza3MuQ2FsbEF3c1NlcnZpY2UodGhpcywgc3VibmV0LnN1Ym5ldElkLCB7XG4gICAgICAgIHN0YXRlTmFtZTogZ2VuZXJhdGVTdGF0ZU5hbWUodGhpcywgc3VibmV0LnN1Ym5ldElkKSxcbiAgICAgICAgY29tbWVudDogc3VibmV0LmF2YWlsYWJpbGl0eVpvbmUsXG4gICAgICAgIGludGVncmF0aW9uUGF0dGVybjogc3RlcGZ1bmN0aW9ucy5JbnRlZ3JhdGlvblBhdHRlcm4uV0FJVF9GT1JfVEFTS19UT0tFTixcbiAgICAgICAgc2VydmljZTogJ2VjMicsXG4gICAgICAgIGFjdGlvbjogJ3J1bkluc3RhbmNlcycsXG4gICAgICAgIGhlYXJ0YmVhdFRpbWVvdXQ6IHN0ZXBmdW5jdGlvbnMuVGltZW91dC5kdXJhdGlvbih0aGlzLmhlYXJ0YmVhdFRpbWVvdXQpLFxuICAgICAgICBwYXJhbWV0ZXJzOiB7XG4gICAgICAgICAgTGF1bmNoVGVtcGxhdGU6IHtcbiAgICAgICAgICAgIExhdW5jaFRlbXBsYXRlSWQ6IHRoaXMuYW1pLmxhdW5jaFRlbXBsYXRlLmxhdW5jaFRlbXBsYXRlSWQsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBNaW5Db3VudDogMSxcbiAgICAgICAgICBNYXhDb3VudDogMSxcbiAgICAgICAgICBJbnN0YW5jZVR5cGU6IHRoaXMuaW5zdGFuY2VUeXBlLnRvU3RyaW5nKCksXG4gICAgICAgICAgVXNlckRhdGE6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguYmFzZTY0RW5jb2RlKFxuICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5mb3JtYXQoXG4gICAgICAgICAgICAgIC8vIHNlZSBzdGVwRnVuY3Rpb25Db25zdGFudHMoKVxuICAgICAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KGAkLmNvbnN0cy4ke3RoaXMudXNlckRhdGFDb25zdCgpfWApLFxuICAgICAgICAgICAgICAuLi5wYXJhbXMsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICksXG4gICAgICAgICAgSW5zdGFuY2VJbml0aWF0ZWRTaHV0ZG93bkJlaGF2aW9yOiBlYzIuSW5zdGFuY2VJbml0aWF0ZWRTaHV0ZG93bkJlaGF2aW9yLlRFUk1JTkFURSxcbiAgICAgICAgICBJYW1JbnN0YW5jZVByb2ZpbGU6IHtcbiAgICAgICAgICAgIEFybjogaW5zdGFuY2VQcm9maWxlLmF0dHJBcm4sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBNZXRhZGF0YU9wdGlvbnM6IHtcbiAgICAgICAgICAgIEh0dHBUb2tlbnM6ICdyZXF1aXJlZCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBTZWN1cml0eUdyb3VwSWRzOiB0aGlzLnNlY3VyaXR5R3JvdXBzLm1hcChzZyA9PiBzZy5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgICAgIFN1Ym5ldElkOiBzdWJuZXQuc3VibmV0SWQsXG4gICAgICAgICAgQmxvY2tEZXZpY2VNYXBwaW5nczogW3tcbiAgICAgICAgICAgIERldmljZU5hbWU6IHJvb3REZXZpY2VSZXNvdXJjZS5yZWYsXG4gICAgICAgICAgICBFYnM6IHtcbiAgICAgICAgICAgICAgRGVsZXRlT25UZXJtaW5hdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgICAgVm9sdW1lU2l6ZTogdGhpcy5zdG9yYWdlU2l6ZS50b0dpYmlieXRlcygpLFxuICAgICAgICAgICAgICBWb2x1bWVUeXBlOiB0aGlzLnN0b3JhZ2VPcHRpb25zPy52b2x1bWVUeXBlLFxuICAgICAgICAgICAgICBJb3BzOiB0aGlzLnN0b3JhZ2VPcHRpb25zPy5pb3BzLFxuICAgICAgICAgICAgICBUaHJvdWdocHV0OiB0aGlzLnN0b3JhZ2VPcHRpb25zPy50aHJvdWdocHV0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9XSxcbiAgICAgICAgICBJbnN0YW5jZU1hcmtldE9wdGlvbnM6IHRoaXMuc3BvdCA/IHtcbiAgICAgICAgICAgIE1hcmtldFR5cGU6ICdzcG90JyxcbiAgICAgICAgICAgIFNwb3RPcHRpb25zOiB7XG4gICAgICAgICAgICAgIE1heFByaWNlOiB0aGlzLnNwb3RNYXhQcmljZSxcbiAgICAgICAgICAgICAgU3BvdEluc3RhbmNlVHlwZTogJ29uZS10aW1lJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBUYWdTcGVjaWZpY2F0aW9uczogWydpbnN0YW5jZScsICd2b2x1bWUnXS5tYXAocmVzVHlwZSA9PiB7IC8vIG1hbnVhbGx5IHByb3BhZ2F0ZSB0YWdzXG4gICAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgICBSZXNvdXJjZVR5cGU6IHJlc1R5cGUsXG4gICAgICAgICAgICAgIFRhZ3M6IFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBLZXk6ICdOYW1lJyxcbiAgICAgICAgICAgICAgICAgIFZhbHVlOiBwYXJhbWV0ZXJzLnJ1bm5lck5hbWVQYXRoLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgS2V5OiAnR2l0SHViUnVubmVyczpQcm92aWRlcicsXG4gICAgICAgICAgICAgICAgICBWYWx1ZTogdGhpcy5ub2RlLnBhdGgsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBLZXk6ICdHaXRIdWJSdW5uZXJzOlJlcG8nLFxuICAgICAgICAgICAgICAgICAgVmFsdWU6IHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguZm9ybWF0KCd7fS97fScsIHBhcmFtZXRlcnMub3duZXJQYXRoLCBwYXJhbWV0ZXJzLnJlcG9QYXRoKSxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIEtleTogJ0dpdEh1YlJ1bm5lcnM6TGFiZWxzJyxcbiAgICAgICAgICAgICAgICAgIFZhbHVlOiBwYXJhbWV0ZXJzLmxhYmVsc1BhdGgsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSksXG4gICAgICAgIH0sXG4gICAgICAgIGlhbVJlc291cmNlczogWycqJ10sXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGhlYWQgPSBzdWJuZXRSdW5uZXJzWzBdO1xuICAgIGxldCBjdXJyZW50ID0gc3VibmV0UnVubmVyc1swXTtcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8IHN1Ym5ldFJ1bm5lcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGNvbnN0IG5leHQgPSBzdWJuZXRSdW5uZXJzW2ldO1xuICAgICAgcGFyYW1ldGVycy5hZGRDYXRjaEFuZENsZWFuVXAoY3VycmVudCwgbmV4dCk7XG4gICAgICBjdXJyZW50ID0gbmV4dDtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFNpbXBsZUZyYWdtZW50KFxuICAgICAgdGhpcyxcbiAgICAgICdGcmFnbWVudCcsXG4gICAgICBoZWFkLFxuICAgICAgY3VycmVudCxcbiAgICApO1xuICB9XG5cbiAgZ3JhbnRTdGF0ZU1hY2hpbmUoc3RhdGVNYWNoaW5lUm9sZTogaWFtLklHcmFudGFibGUpIHtcbiAgICBzdGF0ZU1hY2hpbmVSb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnaWFtOlBhc3NSb2xlJ10sXG4gICAgICByZXNvdXJjZXM6IFt0aGlzLnJvbGUucm9sZUFybl0sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICdpYW06UGFzc2VkVG9TZXJ2aWNlJzogJ2VjMi5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2VjMjpjcmVhdGVUYWdzJ10sXG4gICAgICByZXNvdXJjZXM6IFtTdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICBzZXJ2aWNlOiAnZWMyJyxcbiAgICAgICAgcmVzb3VyY2U6ICcqJyxcbiAgICAgIH0pXSxcbiAgICB9KSk7XG5cbiAgICBzdGF0ZU1hY2hpbmVSb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnaWFtOkNyZWF0ZVNlcnZpY2VMaW5rZWRSb2xlJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAnaWFtOkFXU1NlcnZpY2VOYW1lJzogJ3Nwb3QuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pKTtcbiAgfVxuXG4gIHN0YXR1cyhzdGF0dXNGdW5jdGlvblJvbGU6IGlhbS5JR3JhbnRhYmxlKTogSVJ1bm5lclByb3ZpZGVyU3RhdHVzIHtcbiAgICBzdGF0dXNGdW5jdGlvblJvbGUuZ3JhbnRQcmluY2lwYWwuYWRkVG9QcmluY2lwYWxQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydlYzI6RGVzY3JpYmVMYXVuY2hUZW1wbGF0ZVZlcnNpb25zJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgIH0pKTtcblxuICAgIHJldHVybiB7XG4gICAgICB0eXBlOiB0aGlzLmNvbnN0cnVjdG9yLm5hbWUsXG4gICAgICBsYWJlbHM6IHRoaXMubGFiZWxzLFxuICAgICAgY29uc3RydWN0UGF0aDogdGhpcy5ub2RlLnBhdGgsXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIHJvbGVBcm46IHRoaXMucm9sZS5yb2xlQXJuLFxuICAgICAgbG9nR3JvdXA6IHRoaXMubG9nR3JvdXAubG9nR3JvdXBOYW1lLFxuICAgICAgYW1pOiB7XG4gICAgICAgIGxhdW5jaFRlbXBsYXRlOiB0aGlzLmFtaS5sYXVuY2hUZW1wbGF0ZS5sYXVuY2hUZW1wbGF0ZUlkIHx8ICd1bmtub3duJyxcbiAgICAgICAgYW1pQnVpbGRlckxvZ0dyb3VwOiB0aGlzLmFtaS5sb2dHcm91cD8ubG9nR3JvdXBOYW1lLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBuZXR3b3JrIGNvbm5lY3Rpb25zIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHJlc291cmNlLlxuICAgKi9cbiAgcHVibGljIGdldCBjb25uZWN0aW9ucygpOiBlYzIuQ29ubmVjdGlvbnMge1xuICAgIHJldHVybiBuZXcgZWMyLkNvbm5lY3Rpb25zKHsgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMgfSk7XG4gIH1cbn1cblxuLyoqXG4gKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIEVjMlJ1bm5lclByb3ZpZGVyfVxuICovXG5leHBvcnQgY2xhc3MgRWMyUnVubmVyIGV4dGVuZHMgRWMyUnVubmVyUHJvdmlkZXIge1xufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5jbGFzcyBTaW1wbGVGcmFnbWVudCBleHRlbmRzIHN0ZXBmdW5jdGlvbnMuU3RhdGVNYWNoaW5lRnJhZ21lbnQge1xuICByZWFkb25seSBzdGFydFN0YXRlOiBzdGVwZnVuY3Rpb25zLlN0YXRlO1xuICByZWFkb25seSBlbmRTdGF0ZXM6IHN0ZXBmdW5jdGlvbnMuSU5leHRhYmxlW107XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgc3RhcnQ6IHN0ZXBmdW5jdGlvbnMuU3RhdGUsIGVuZDogc3RlcGZ1bmN0aW9ucy5JTmV4dGFibGUpIHtcbiAgICBzdXBlcihzY29wZSwgaWQpO1xuICAgIHRoaXMuc3RhcnRTdGF0ZSA9IHN0YXJ0O1xuICAgIHRoaXMuZW5kU3RhdGVzID0gW2VuZF07XG4gIH1cbn1cblxuIl19