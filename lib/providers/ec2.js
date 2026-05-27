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

# Resolve AWS region via IMDSv2 so heartbeat/send-task-success calls don't depend
# on IMDS being reachable on each invocation (Docker iptables, transient issues).
# Fall back to us-east-1 if IMDS is unavailable at boot — runners are deployed there.
IMDS_TOKEN=$(curl -s -X PUT -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" \
  http://169.254.169.254/latest/api/token 2>/dev/null || echo "")
export AWS_DEFAULT_REGION=$(curl -s -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" \
  http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || echo "us-east-1")

touch /var/log/runner.log

heartbeat () {
  while true; do
    SPOT_ACTION=$(curl -s -f -H "X-aws-ec2-metadata-token: $(curl -s -f -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 1" 2>/dev/null)" "http://169.254.169.254/latest/meta-data/spot/instance-action" 2>/dev/null) || true
    if [ -n "$SPOT_ACTION" ]; then
      aws stepfunctions send-task-failure --task-token "$TASK_TOKEN" --error SpotInterrupted --cause "EC2 Spot instance interruption: $SPOT_ACTION" || true
      exit 0
    fi
    aws stepfunctions send-task-heartbeat --task-token "$TASK_TOKEN" 2>>/var/log/runner.log
    HEARTBEAT_RC=$?
    if [ $HEARTBEAT_RC -ne 0 ]; then
      echo "[$(date -Iseconds)] heartbeat send-task-heartbeat failed (exit $HEARTBEAT_RC)" >>/var/log/runner.log
    fi
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

# Resolve AWS region via IMDSv2 so heartbeat/send-task-success calls don't depend
# on IMDS being reachable on each invocation (Docker iptables, transient issues).
# Fall back to us-east-1 if IMDS is unavailable at boot.
try {
  $imdsToken = Invoke-RestMethod -Method PUT -Uri "http://169.254.169.254/latest/api/token" -Headers @{"X-aws-ec2-metadata-token-ttl-seconds"="21600"} -TimeoutSec 5
  $Env:AWS_DEFAULT_REGION = Invoke-RestMethod -Uri "http://169.254.169.254/latest/meta-data/placement/region" -Headers @{"X-aws-ec2-metadata-token"=$imdsToken} -TimeoutSec 5
} catch {
  $Env:AWS_DEFAULT_REGION = "us-east-1"
}

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
    $heartbeatResult = aws stepfunctions send-task-heartbeat --task-token "$using:TASK_TOKEN" 2>&1
    if ($LASTEXITCODE -ne 0) {
      $timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK")
      "[$timestamp] heartbeat send-task-heartbeat failed (exit $LASTEXITCODE): $heartbeatResult" | Out-File -Encoding ASCII -Append /actions/runner.log
    }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWMyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9lYzIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxtQ0FBbUM7QUFDbkMsNkNBUXFCO0FBQ3JCLG1EQUFxRDtBQUVyRCxxQ0Fha0I7QUFDbEIsc0RBUTJCO0FBQzNCLG9DQUErRjtBQUUvRiw2RUFBNkU7QUFDN0UscURBQXFEO0FBQ3JELE1BQU0scUJBQXFCLEdBQUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQXNHN0IsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztBQUVyRSw2RUFBNkU7QUFDN0UsbUdBQW1HO0FBQ25HLE1BQU0sdUJBQXVCLEdBQUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztDQXlHL0IsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztBQXlJckU7Ozs7R0FJRztBQUNILE1BQWEsaUJBQWtCLFNBQVEscUJBQVk7SUFDakQ7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQWtCRztJQUNJLE1BQU0sQ0FBQyxZQUFZLENBQUMsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBK0I7UUFDdEYsT0FBTyxtQ0FBa0IsQ0FBQyxHQUFHLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUN2QyxFQUFFLEVBQUUsV0FBRSxDQUFDLFlBQVk7WUFDbkIsWUFBWSxFQUFFLHFCQUFZLENBQUMsTUFBTTtZQUNqQyxXQUFXLEVBQUUsdUNBQXNCLENBQUMsaUJBQWlCO1lBQ3JELFVBQVUsRUFBRTtnQkFDVixxQ0FBb0IsQ0FBQyxnQkFBZ0IsRUFBRTtnQkFDdkMscUNBQW9CLENBQUMsZUFBZSxFQUFFO2dCQUN0QyxxQ0FBb0IsQ0FBQyxVQUFVLEVBQUU7Z0JBQ2pDLHFDQUFvQixDQUFDLEdBQUcsRUFBRTtnQkFDMUIscUNBQW9CLENBQUMsU0FBUyxFQUFFO2dCQUNoQyxxQ0FBb0IsQ0FBQyxNQUFNLEVBQUU7Z0JBQzdCLHFDQUFvQixDQUFDLE1BQU0sRUFBRTtnQkFDN0IscUNBQW9CLENBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxhQUFhLElBQUksc0JBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQzthQUNsRjtZQUNELEdBQUcsS0FBSztTQUNULENBQUMsQ0FBQztJQUNMLENBQUM7SUF1Q0QsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE4QjtRQUN0RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQXJCakIsb0JBQWUsR0FBRztZQUN6QixrQkFBa0I7WUFDbEIsZ0JBQWdCO1NBQ2pCLENBQUM7UUFvQkEsSUFBSSxDQUFDLE1BQU0sR0FBRyxLQUFLLEVBQUUsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDdkMsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLEVBQUUsS0FBSyxDQUFDO1FBQzFCLElBQUksQ0FBQyxHQUFHLEdBQUcsS0FBSyxFQUFFLEdBQUcsSUFBSSxxQkFBRyxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRSxFQUFFLFNBQVMsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3RGLElBQUksQ0FBQyxjQUFjLEdBQUcsS0FBSyxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLGNBQWMsSUFBSSxDQUFDLElBQUkscUJBQUcsQ0FBQyxhQUFhLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxFQUFFLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkosSUFBSSxDQUFDLE9BQU8sR0FBRyxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxhQUFhLENBQUMsS0FBSyxFQUFFLGVBQWUsQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUN2RyxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssRUFBRSxZQUFZLElBQUkscUJBQUcsQ0FBQyxZQUFZLENBQUMsRUFBRSxDQUFDLHFCQUFHLENBQUMsYUFBYSxDQUFDLEdBQUcsRUFBRSxxQkFBRyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUM5RyxJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUssRUFBRSxXQUFXLElBQUksR0FBRyxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxnQ0FBZ0M7UUFDakcsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLEVBQUUsY0FBYyxDQUFDO1FBQzVDLElBQUksQ0FBQyxJQUFJLEdBQUcsS0FBSyxFQUFFLElBQUksSUFBSSxLQUFLLENBQUM7UUFDakMsSUFBSSxDQUFDLFlBQVksR0FBRyxLQUFLLEVBQUUsWUFBWSxDQUFDO1FBQ3hDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxLQUFLLEVBQUUsZ0JBQWdCLElBQUksR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDNUUsSUFBSSxDQUFDLGFBQWEsR0FBRyxLQUFLLEVBQUUsYUFBYSxJQUFJLElBQUksQ0FBQztRQUVsRCxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzlCLEdBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO1FBQ3ZFLENBQUM7UUFFRCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksS0FBSyxxQkFBRyxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMscUJBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLHFCQUFZLENBQUMsTUFBTSxDQUFDO1FBRTNILElBQUksQ0FBQyxVQUFVLEdBQUcsS0FBSyxFQUFFLFlBQVksSUFBSSxLQUFLLEVBQUUsVUFBVSxJQUFJLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ2hILEdBQUcsRUFBRSxLQUFLLEVBQUUsR0FBRztZQUNmLGVBQWUsRUFBRSxLQUFLLEVBQUUsZUFBZTtZQUN2QyxjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWM7WUFDbkMsT0FBTyxFQUFFLElBQUEseUJBQWlCLEVBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQywwQkFBUyxDQUFDLFdBQVcsQ0FBQyxXQUFFLENBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQ3hHLFlBQVksRUFBRSxJQUFJO1lBQ2xCLHNCQUFzQixFQUFFO2dCQUN0QixZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxxQkFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBRyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMscUJBQUcsQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLHFCQUFHLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO2FBQzNIO1NBQ0YsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBRXJDLElBQUksSUFBSSxDQUFDLFVBQVUsWUFBWSxrREFBaUMsRUFBRSxDQUFDO1lBQ2pFLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDO2dCQUN0RyxHQUFHLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsd0JBQXdCLElBQUksQ0FBQyxXQUFXLENBQUMsV0FBVyxFQUFFLHNFQUFzRSxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDbE4sQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7WUFDaEUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLHFCQUFxQixJQUFJLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxJQUFJLHlDQUF5QyxJQUFJLENBQUMsWUFBWSxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxHQUFHLENBQUMsQ0FBQztRQUN0TCxDQUFDO1FBRUQsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUkscUJBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxxQkFBRyxDQUFDLGdCQUFnQixDQUFDLG1CQUFtQixDQUFDO1NBQ3pELENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxjQUFjLENBQUMsb0JBQW9CLENBQUMsSUFBSSxxQkFBRyxDQUFDLGVBQWUsQ0FBQztZQUMvRCxPQUFPLEVBQUUsQ0FBQyx3QkFBd0IsRUFBRSx3QkFBd0IsRUFBRSwwQkFBMEIsQ0FBQztZQUN6RixTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSwySEFBMkg7U0FDOUksQ0FBQyxDQUFDLENBQUM7UUFDSixJQUFJLENBQUMsY0FBYyxDQUFDLG9CQUFvQixDQUFDLHdEQUFnRCxDQUFDLENBQUM7UUFFM0YsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLHNCQUFJLENBQUMsUUFBUSxDQUMvQixJQUFJLEVBQ0osTUFBTSxFQUNOO1lBQ0UsU0FBUyxFQUFFLEtBQUssRUFBRSxZQUFZLElBQUksd0JBQWEsQ0FBQyxTQUFTO1lBQ3pELGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87U0FDckMsQ0FDRixDQUFDO1FBQ0YsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDakMsQ0FBQztJQUVPLGFBQWE7UUFDbkIsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsV0FBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDLENBQUMsa0JBQWtCLENBQUM7SUFDaEYsQ0FBQztJQUVNLHFCQUFxQjtRQUMxQixNQUFNLGdCQUFnQixHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxXQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLHVCQUF1QixDQUFDLENBQUMsQ0FBQyxxQkFBcUIsQ0FBQztRQUN0RyxPQUFPLEVBQUUsQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUMsRUFBRSxnQkFBZ0IsRUFBRSxDQUFDO0lBQ3RELENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCxtQkFBbUIsQ0FBQyxVQUFvQztRQUN0RCwrSUFBK0k7UUFFL0ksTUFBTSxNQUFNLEdBQUc7WUFDYiwrQkFBYSxDQUFDLFFBQVEsQ0FBQyxTQUFTO1lBQ2hDLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWTtZQUMxQixVQUFVLENBQUMsY0FBYztZQUN6QixVQUFVLENBQUMsZ0JBQWdCO1lBQzNCLFVBQVUsQ0FBQyxTQUFTO1lBQ3BCLFVBQVUsQ0FBQyxRQUFRO1lBQ25CLFVBQVUsQ0FBQyxlQUFlO1lBQzFCLFVBQVUsQ0FBQyxVQUFVO1lBQ3JCLFVBQVUsQ0FBQyxlQUFlO1lBQzFCLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLGVBQWUsQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUNqQywrSEFBK0g7WUFDL0gsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRTtZQUM1QixJQUFJLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLHFCQUFxQjtZQUMvQyxVQUFVLENBQUMsYUFBYTtTQUN6QixDQUFDO1FBRUYsMENBQTBDO1FBQzFDLHNHQUFzRztRQUN0RyxxR0FBcUc7UUFDckcsb0hBQW9IO1FBRXBILHlHQUF5RztRQUN6Ryw2RUFBNkU7UUFFN0UsK0NBQStDO1FBQy9DLE1BQU0sZUFBZSxHQUFHLElBQUkscUJBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDM0UsS0FBSyxFQUFFLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUM7U0FDNUIsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxrQkFBa0IsR0FBRyxJQUFBLHNCQUFhLEVBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLGdCQUFnQixDQUFDLENBQUM7UUFDekYsa0JBQWtCLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDdkQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUU7WUFDOUMsT0FBTyxJQUFJLHFDQUFtQixDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDLFFBQVEsRUFBRTtnQkFDbkUsU0FBUyxFQUFFLElBQUEsMEJBQWlCLEVBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQyxRQUFRLENBQUM7Z0JBQ25ELE9BQU8sRUFBRSxNQUFNLENBQUMsZ0JBQWdCO2dCQUNoQyxrQkFBa0IsRUFBRSwrQkFBYSxDQUFDLGtCQUFrQixDQUFDLG1CQUFtQjtnQkFDeEUsT0FBTyxFQUFFLEtBQUs7Z0JBQ2QsTUFBTSxFQUFFLGNBQWM7Z0JBQ3RCLGdCQUFnQixFQUFFLCtCQUFhLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsZ0JBQWdCLENBQUM7Z0JBQ3ZFLFVBQVUsRUFBRTtvQkFDVixjQUFjLEVBQUU7d0JBQ2QsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsZ0JBQWdCO3FCQUMzRDtvQkFDRCxRQUFRLEVBQUUsQ0FBQztvQkFDWCxRQUFRLEVBQUUsQ0FBQztvQkFDWCxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxRQUFRLEVBQUU7b0JBQzFDLFFBQVEsRUFBRSwrQkFBYSxDQUFDLFFBQVEsQ0FBQyxZQUFZLENBQzNDLCtCQUFhLENBQUMsUUFBUSxDQUFDLE1BQU07b0JBQzNCLDhCQUE4QjtvQkFDOUIsK0JBQWEsQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLFlBQVksSUFBSSxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsRUFDbkUsR0FBRyxNQUFNLENBQ1YsQ0FDRjtvQkFDRCxpQ0FBaUMsRUFBRSxxQkFBRyxDQUFDLGlDQUFpQyxDQUFDLFNBQVM7b0JBQ2xGLGtCQUFrQixFQUFFO3dCQUNsQixHQUFHLEVBQUUsZUFBZSxDQUFDLE9BQU87cUJBQzdCO29CQUNELGVBQWUsRUFBRTt3QkFDZixVQUFVLEVBQUUsVUFBVTtxQkFDdkI7b0JBQ0QsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsZUFBZSxDQUFDO29CQUNuRSxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVE7b0JBQ3pCLG1CQUFtQixFQUFFLENBQUM7NEJBQ3BCLFVBQVUsRUFBRSxrQkFBa0IsQ0FBQyxHQUFHOzRCQUNsQyxHQUFHLEVBQUU7Z0NBQ0gsbUJBQW1CLEVBQUUsSUFBSTtnQ0FDekIsVUFBVSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsV0FBVyxFQUFFO2dDQUMxQyxVQUFVLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxVQUFVO2dDQUMzQyxJQUFJLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxJQUFJO2dDQUMvQixVQUFVLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxVQUFVOzZCQUM1Qzt5QkFDRixDQUFDO29CQUNGLHFCQUFxQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO3dCQUNqQyxVQUFVLEVBQUUsTUFBTTt3QkFDbEIsV0FBVyxFQUFFOzRCQUNYLFFBQVEsRUFBRSxJQUFJLENBQUMsWUFBWTs0QkFDM0IsZ0JBQWdCLEVBQUUsVUFBVTt5QkFDN0I7cUJBQ0YsQ0FBQyxDQUFDLENBQUMsU0FBUztvQkFDYixpQkFBaUIsRUFBRSxDQUFDLFVBQVUsRUFBRSxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUU7d0JBQ3RELE9BQU87NEJBQ0wsWUFBWSxFQUFFLE9BQU87NEJBQ3JCLElBQUksRUFBRTtnQ0FDSjtvQ0FDRSxHQUFHLEVBQUUsTUFBTTtvQ0FDWCxLQUFLLEVBQUUsVUFBVSxDQUFDLGNBQWM7aUNBQ2pDO2dDQUNEO29DQUNFLEdBQUcsRUFBRSx3QkFBd0I7b0NBQzdCLEtBQUssRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUk7aUNBQ3RCO2dDQUNEO29DQUNFLEdBQUcsRUFBRSxvQkFBb0I7b0NBQ3pCLEtBQUssRUFBRSwrQkFBYSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLFVBQVUsQ0FBQyxTQUFTLEVBQUUsVUFBVSxDQUFDLFFBQVEsQ0FBQztpQ0FDekY7Z0NBQ0Q7b0NBQ0UsR0FBRyxFQUFFLHNCQUFzQjtvQ0FDM0IsS0FBSyxFQUFFLFVBQVUsQ0FBQyxVQUFVO2lDQUM3Qjs2QkFDRjt5QkFDRixDQUFDO29CQUNKLENBQUMsQ0FBQztpQkFDSDtnQkFDRCxZQUFZLEVBQUUsQ0FBQyxHQUFHLENBQUM7YUFDcEIsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7UUFFSCxNQUFNLElBQUksR0FBRyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDOUIsSUFBSSxPQUFPLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQy9CLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxhQUFhLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7WUFDOUMsTUFBTSxJQUFJLEdBQUcsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzlCLFVBQVUsQ0FBQyxrQkFBa0IsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLENBQUM7WUFDN0MsT0FBTyxHQUFHLElBQUksQ0FBQztRQUNqQixDQUFDO1FBRUQsT0FBTyxJQUFJLGNBQWMsQ0FDdkIsSUFBSSxFQUNKLFVBQVUsRUFDVixJQUFJLEVBQ0osT0FBTyxDQUNSLENBQUM7SUFDSixDQUFDO0lBRUQsaUJBQWlCLENBQUMsZ0JBQWdDO1FBQ2hELGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLHFCQUFHLENBQUMsZUFBZSxDQUFDO1lBQzNFLE9BQU8sRUFBRSxDQUFDLGNBQWMsQ0FBQztZQUN6QixTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQztZQUM5QixVQUFVLEVBQUU7Z0JBQ1YsWUFBWSxFQUFFO29CQUNaLHFCQUFxQixFQUFFLG1CQUFtQjtpQkFDM0M7YUFDRjtTQUNGLENBQUMsQ0FBQyxDQUFDO1FBRUosZ0JBQWdCLENBQUMsY0FBYyxDQUFDLG9CQUFvQixDQUFDLElBQUkscUJBQUcsQ0FBQyxlQUFlLENBQUM7WUFDM0UsT0FBTyxFQUFFLENBQUMsZ0JBQWdCLENBQUM7WUFDM0IsU0FBUyxFQUFFLENBQUMsbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxDQUFDO29CQUNuQyxPQUFPLEVBQUUsS0FBSztvQkFDZCxRQUFRLEVBQUUsR0FBRztpQkFDZCxDQUFDLENBQUM7U0FDSixDQUFDLENBQUMsQ0FBQztRQUVKLGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLHFCQUFHLENBQUMsZUFBZSxDQUFDO1lBQzNFLE9BQU8sRUFBRSxDQUFDLDZCQUE2QixDQUFDO1lBQ3hDLFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztZQUNoQixVQUFVLEVBQUU7Z0JBQ1YsWUFBWSxFQUFFO29CQUNaLG9CQUFvQixFQUFFLG9CQUFvQjtpQkFDM0M7YUFDRjtTQUNGLENBQUMsQ0FBQyxDQUFDO0lBQ04sQ0FBQztJQUVELE1BQU0sQ0FBQyxrQkFBa0M7UUFDdkMsa0JBQWtCLENBQUMsY0FBYyxDQUFDLG9CQUFvQixDQUFDLElBQUkscUJBQUcsQ0FBQyxlQUFlLENBQUM7WUFDN0UsT0FBTyxFQUFFLENBQUMsb0NBQW9DLENBQUM7WUFDL0MsU0FBUyxFQUFFLENBQUMsR0FBRyxDQUFDO1NBQ2pCLENBQUMsQ0FBQyxDQUFDO1FBRUosT0FBTztZQUNMLElBQUksRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUk7WUFDM0IsTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNO1lBQ25CLGFBQWEsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUk7WUFDN0IsY0FBYyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLGVBQWUsQ0FBQztZQUNqRSxPQUFPLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPO1lBQzFCLFFBQVEsRUFBRSxJQUFJLENBQUMsUUFBUSxDQUFDLFlBQVk7WUFDcEMsR0FBRyxFQUFFO2dCQUNILGNBQWMsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsSUFBSSxTQUFTO2dCQUNyRSxrQkFBa0IsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsRUFBRSxZQUFZO2FBQ3BEO1NBQ0YsQ0FBQztJQUNKLENBQUM7SUFFRDs7T0FFRztJQUNILElBQVcsV0FBVztRQUNwQixPQUFPLElBQUkscUJBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUM7SUFDdEUsQ0FBQzs7QUFqVkgsOENBa1ZDOzs7QUFFRDs7R0FFRztBQUNILE1BQWEsU0FBVSxTQUFRLGlCQUFpQjs7QUFBaEQsOEJBQ0M7OztBQUVEOztHQUVHO0FBQ0gsTUFBTSxjQUFlLFNBQVEsK0JBQWEsQ0FBQyxvQkFBb0I7SUFJN0QsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEwQixFQUFFLEdBQTRCO1FBQ2hHLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDakIsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUM7UUFDeEIsSUFBSSxDQUFDLFNBQVMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3pCLENBQUM7Q0FDRiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19sb2dzIGFzIGxvZ3MsXG4gIGF3c19zdGVwZnVuY3Rpb25zIGFzIHN0ZXBmdW5jdGlvbnMsXG4gIGF3c19zdGVwZnVuY3Rpb25zX3Rhc2tzIGFzIHN0ZXBmdW5jdGlvbnNfdGFza3MsXG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrLFxufSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQge1xuICBhbWlSb290RGV2aWNlLFxuICBBcmNoaXRlY3R1cmUsXG4gIEJhc2VQcm92aWRlcixcbiAgZ2VuZXJhdGVTdGF0ZU5hbWUsXG4gIElSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyU3RhdHVzLFxuICBJUnVubmVyUnVudGltZVBhcmFtZXRlcnMsXG4gIE9zLFxuICBSdW5uZXJBbWksXG4gIFJ1bm5lclByb3ZpZGVyUHJvcHMsXG4gIFJ1bm5lclZlcnNpb24sXG4gIFN0b3JhZ2VPcHRpb25zLFxufSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQge1xuICBBd3NJbWFnZUJ1aWxkZXJSdW5uZXJJbWFnZUJ1aWxkZXIsXG4gIEJhc2VJbWFnZSxcbiAgSVJ1bm5lckltYWdlQnVpbGRlcixcbiAgUnVubmVySW1hZ2VCdWlsZGVyLFxuICBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcyxcbiAgUnVubmVySW1hZ2VCdWlsZGVyVHlwZSxcbiAgUnVubmVySW1hZ2VDb21wb25lbnQsXG59IGZyb20gJy4uL2ltYWdlLWJ1aWxkZXJzJztcbmltcG9ydCB7IGlzR3B1SW5zdGFuY2VUeXBlLCBNSU5JTUFMX0VDMl9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQgfSBmcm9tICcuLi91dGlscyc7XG5cbi8vIHRoaXMgc2NyaXB0IGlzIHNwZWNpZmljYWxseSBtYWRlIHNvIGBwb3dlcm9mZmAgaXMgYWJzb2x1dGVseSBhbHdheXMgY2FsbGVkXG4vLyBlYWNoIGB7fWAgaXMgYSB2YXJpYWJsZSBjb21pbmcgZnJvbSBgcGFyYW1zYCBiZWxvd1xuY29uc3QgbGludXhVc2VyRGF0YVRlbXBsYXRlID0gYCMhL2Jpbi9iYXNoXG5zZXQgLXggLW8gcGlwZWZhaWxcblxuVEFTS19UT0tFTj1cInt9XCJcbmxvZ0dyb3VwTmFtZT1cInt9XCJcbnJ1bm5lck5hbWVQYXRoPVwie31cIlxuZ2l0aHViRG9tYWluUGF0aD1cInt9XCJcbm93bmVyUGF0aD1cInt9XCJcbnJlcG9QYXRoPVwie31cIlxucnVubmVyVG9rZW5QYXRoPVwie31cIlxubGFiZWxzPVwie31cIlxucmVnaXN0cmF0aW9uVVJMPVwie31cIlxucnVubmVyR3JvdXAxPVwie31cIlxucnVubmVyR3JvdXAyPVwie31cIlxuZGVmYXVsdExhYmVscz1cInt9XCJcbmppdENvbmZpZz1cInt9XCJcblxuZXhwb3J0IEFXU19SRVRSWV9NT0RFPXN0YW5kYXJkICMgYmV0dGVyIHJldHJ5XG5cbiMgUmVzb2x2ZSBBV1MgcmVnaW9uIHZpYSBJTURTdjIgc28gaGVhcnRiZWF0L3NlbmQtdGFzay1zdWNjZXNzIGNhbGxzIGRvbid0IGRlcGVuZFxuIyBvbiBJTURTIGJlaW5nIHJlYWNoYWJsZSBvbiBlYWNoIGludm9jYXRpb24gKERvY2tlciBpcHRhYmxlcywgdHJhbnNpZW50IGlzc3VlcykuXG4jIEZhbGwgYmFjayB0byB1cy1lYXN0LTEgaWYgSU1EUyBpcyB1bmF2YWlsYWJsZSBhdCBib290IOKAlCBydW5uZXJzIGFyZSBkZXBsb3llZCB0aGVyZS5cbklNRFNfVE9LRU49JChjdXJsIC1zIC1YIFBVVCAtSCBcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlbi10dGwtc2Vjb25kczogMjE2MDBcIiBcXFxuICBodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9hcGkvdG9rZW4gMj4vZGV2L251bGwgfHwgZWNobyBcIlwiKVxuZXhwb3J0IEFXU19ERUZBVUxUX1JFR0lPTj0kKGN1cmwgLXMgLUggXCJYLWF3cy1lYzItbWV0YWRhdGEtdG9rZW46ICRJTURTX1RPS0VOXCIgXFxcbiAgaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvbWV0YS1kYXRhL3BsYWNlbWVudC9yZWdpb24gMj4vZGV2L251bGwgfHwgZWNobyBcInVzLWVhc3QtMVwiKVxuXG50b3VjaCAvdmFyL2xvZy9ydW5uZXIubG9nXG5cbmhlYXJ0YmVhdCAoKSB7XG4gIHdoaWxlIHRydWU7IGRvXG4gICAgU1BPVF9BQ1RJT049JChjdXJsIC1zIC1mIC1IIFwiWC1hd3MtZWMyLW1ldGFkYXRhLXRva2VuOiAkKGN1cmwgLXMgLWYgLVggUFVUIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvYXBpL3Rva2VuXCIgLUggXCJYLWF3cy1lYzItbWV0YWRhdGEtdG9rZW4tdHRsLXNlY29uZHM6IDFcIiAyPi9kZXYvbnVsbClcIiBcImh0dHA6Ly8xNjkuMjU0LjE2OS4yNTQvbGF0ZXN0L21ldGEtZGF0YS9zcG90L2luc3RhbmNlLWFjdGlvblwiIDI+L2Rldi9udWxsKSB8fCB0cnVlXG4gICAgaWYgWyAtbiBcIiRTUE9UX0FDVElPTlwiIF07IHRoZW5cbiAgICAgIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1mYWlsdXJlIC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgLS1lcnJvciBTcG90SW50ZXJydXB0ZWQgLS1jYXVzZSBcIkVDMiBTcG90IGluc3RhbmNlIGludGVycnVwdGlvbjogJFNQT1RfQUNUSU9OXCIgfHwgdHJ1ZVxuICAgICAgZXhpdCAwXG4gICAgZmlcbiAgICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2staGVhcnRiZWF0IC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgMj4+L3Zhci9sb2cvcnVubmVyLmxvZ1xuICAgIEhFQVJUQkVBVF9SQz0kP1xuICAgIGlmIFsgJEhFQVJUQkVBVF9SQyAtbmUgMCBdOyB0aGVuXG4gICAgICBlY2hvIFwiWyQoZGF0ZSAtSXNlY29uZHMpXSBoZWFydGJlYXQgc2VuZC10YXNrLWhlYXJ0YmVhdCBmYWlsZWQgKGV4aXQgJEhFQVJUQkVBVF9SQylcIiA+Pi92YXIvbG9nL3J1bm5lci5sb2dcbiAgICBmaVxuICAgIHNsZWVwIDYwXG4gIGRvbmVcbn1cbnNldHVwX2xvZ3MgKCkge1xuICBjYXQgPDxFT0YgPiAvdG1wL2xvZy5jb25mIHx8IGV4aXQgMVxuICB7XG4gICAgXCJsb2dzXCI6IHtcbiAgICAgIFwibG9nX3N0cmVhbV9uYW1lXCI6IFwidW5rbm93blwiLFxuICAgICAgXCJsb2dzX2NvbGxlY3RlZFwiOiB7XG4gICAgICAgIFwiZmlsZXNcIjoge1xuICAgICAgICAgIFwiY29sbGVjdF9saXN0XCI6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgXCJmaWxlX3BhdGhcIjogXCIvdmFyL2xvZy9ydW5uZXIubG9nXCIsXG4gICAgICAgICAgICAgIFwibG9nX2dyb3VwX25hbWVcIjogXCIkbG9nR3JvdXBOYW1lXCIsXG4gICAgICAgICAgICAgIFwibG9nX3N0cmVhbV9uYW1lXCI6IFwiJHJ1bm5lck5hbWVQYXRoXCIsXG4gICAgICAgICAgICAgIFwidGltZXpvbmVcIjogXCJVVENcIlxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuRU9GXG4gIC9vcHQvYXdzL2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50L2Jpbi9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC1jdGwgLWEgZmV0Y2gtY29uZmlnIC1tIGVjMiAtcyAtYyBmaWxlOi90bXAvbG9nLmNvbmYgfHwgZXhpdCAyXG59XG5hY3Rpb24gKCkge1xuICBpZiBbIC1uIFwiJGppdENvbmZpZ1wiIF07IHRoZW5cbiAgICAjIEpJVCBtb2RlOiBjbGVhbmVyIHJlZ2lzdHJhdGlvbiwgbm8gY29uZmlnLnNoIG5lZWRlZFxuICAgIHN1ZG8gLS1wcmVzZXJ2ZS1lbnY9QVdTX1JFR0lPTiAtSHUgcnVubmVyIC9ob21lL3J1bm5lci9ydW4uc2ggLS1qaXRjb25maWcgXCIkaml0Q29uZmlnXCIgfHwgZXhpdCAyXG4gIGVsc2VcbiAgICAjIExlZ2FjeSBtb2RlOiByZWdpc3RlciBydW5uZXIgdG8gcG9vbCB3aXRoIHRva2VuXG4gICAgIyBEZXRlcm1pbmUgdGhlIHZhbHVlIG9mIFJVTk5FUl9GTEFHU1xuICAgIGlmIFsgXCIkKDwgL2hvbWUvcnVubmVyL1JVTk5FUl9WRVJTSU9OKVwiID0gXCJsYXRlc3RcIiBdOyB0aGVuXG4gICAgICBSVU5ORVJfRkxBR1M9XCJcIlxuICAgIGVsc2VcbiAgICAgIFJVTk5FUl9GTEFHUz1cIi0tZGlzYWJsZXVwZGF0ZVwiXG4gICAgZmlcblxuICAgIGxhYmVsc1RlbXBsYXRlPVwiJGxhYmVscyxjZGtnaHI6c3RhcnRlZDokKGRhdGUgKyVzKVwiXG5cbiAgICAjIEV4ZWN1dGUgdGhlIGNvbmZpZ3VyYXRpb24gY29tbWFuZCBmb3IgcnVubmVyIHJlZ2lzdHJhdGlvblxuICAgIHN1ZG8gLUh1IHJ1bm5lciAvaG9tZS9ydW5uZXIvY29uZmlnLnNoIC0tdW5hdHRlbmRlZCAtLXVybCBcIiRyZWdpc3RyYXRpb25VUkxcIiAtLXRva2VuIFwiJHJ1bm5lclRva2VuUGF0aFwiIC0tZXBoZW1lcmFsIC0td29yayBfd29yayAtLWxhYmVscyBcIiRsYWJlbHNUZW1wbGF0ZVwiICRSVU5ORVJfRkxBR1MgLS1uYW1lIFwiJHJ1bm5lck5hbWVQYXRoXCIgJHJ1bm5lckdyb3VwMSAkcnVubmVyR3JvdXAyICRkZWZhdWx0TGFiZWxzIHx8IGV4aXQgMVxuXG4gICAgIyBFeGVjdXRlIHRoZSBydW4gY29tbWFuZFxuICAgIHN1ZG8gLS1wcmVzZXJ2ZS1lbnY9QVdTX1JFR0lPTiAtSHUgcnVubmVyIC9ob21lL3J1bm5lci9ydW4uc2ggfHwgZXhpdCAyXG4gIGZpXG5cbiAgIyBSZXRyaWV2ZSB0aGUgc3RhdHVzXG4gIFNUQVRVUz0kKGdyZXAgLVBob3JzIFwiZmluaXNoIGpvYiByZXF1ZXN0IGZvciBqb2IgWzAtOWEtZi1dKyB3aXRoIHJlc3VsdDogLipcIiAvaG9tZS9ydW5uZXIvX2RpYWcvIHwgdGFpbCAtbjEgfCBhd2sgJ3twcmludCAkTkZ9JylcblxuICAjIENoZWNrIGFuZCBwcmludCB0aGUgam9iIHN0YXR1c1xuICBbIC1uIFwiJFNUQVRVU1wiIF0gJiYgZWNobyBDREtHSEEgSk9CIERPTkUgXCIkbGFiZWxzXCIgXCIkU1RBVFVTXCJcbn1cbmhlYXJ0YmVhdCAmXG5pZiBzZXR1cF9sb2dzICYmIGFjdGlvbiB8JiB0ZWUgL3Zhci9sb2cvcnVubmVyLmxvZzsgdGhlblxuICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2stc3VjY2VzcyAtLXRhc2stdG9rZW4gXCIkVEFTS19UT0tFTlwiIC0tdGFzay1vdXRwdXQgJ3tcIm9rXCI6IHRydWV9JyB8JiB0ZWUgLWEgL3Zhci9sb2cvcnVubmVyLmxvZ1xuZWxzZVxuICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2stZmFpbHVyZSAtLXRhc2stdG9rZW4gXCIkVEFTS19UT0tFTlwiIC0tZXJyb3IgUnVubmVyLkVycm9yLiQ/IC0tY2F1c2UgXCJDaGVjayBDbG91ZFdhdGNoIGZvciBmdWxsIGxvZyAtLSAkbG9nR3JvdXBOYW1lLyRydW5uZXJOYW1lUGF0aCAtLSAkKHRhaWwgLW4gMSAvdmFyL2xvZy9ydW5uZXIubG9nKVwiIHwmIHRlZSAtYSAvdmFyL2xvZy9ydW5uZXIubG9nXG5maVxuc2xlZXAgMTAgICMgZ2l2ZSBjbG91ZHdhdGNoIGFnZW50IGl0cyBkZWZhdWx0IDUgc2Vjb25kcyBidWZmZXIgZHVyYXRpb24gdG8gdXBsb2FkIGxvZ3NcbnBvd2Vyb2ZmXG5gLnJlcGxhY2UoL3svZywgJ1xcXFx7JykucmVwbGFjZSgvfS9nLCAnXFxcXH0nKS5yZXBsYWNlKC9cXFxce1xcXFx9L2csICd7fScpO1xuXG4vLyB0aGlzIHNjcmlwdCBpcyBzcGVjaWZpY2FsbHkgbWFkZSBzbyBgcG93ZXJvZmZgIGlzIGFic29sdXRlbHkgYWx3YXlzIGNhbGxlZFxuLy8gZWFjaCBge31gIGlzIGEgdmFyaWFibGUgY29taW5nIGZyb20gYHBhcmFtc2AgYmVsb3cgYW5kIHRoZWlyIG9yZGVyIHNob3VsZCBtYXRjaCB0aGUgbGludXggc2NyaXB0XG5jb25zdCB3aW5kb3dzVXNlckRhdGFUZW1wbGF0ZSA9IGA8cG93ZXJzaGVsbD5cbiRUQVNLX1RPS0VOID0gXCJ7fVwiXG4kbG9nR3JvdXBOYW1lPVwie31cIlxuJHJ1bm5lck5hbWVQYXRoPVwie31cIlxuJGdpdGh1YkRvbWFpblBhdGg9XCJ7fVwiXG4kb3duZXJQYXRoPVwie31cIlxuJHJlcG9QYXRoPVwie31cIlxuJHJ1bm5lclRva2VuUGF0aD1cInt9XCJcbiRsYWJlbHM9XCJ7fVwiXG4kcmVnaXN0cmF0aW9uVVJMPVwie31cIlxuJHJ1bm5lckdyb3VwMT1cInt9XCJcbiRydW5uZXJHcm91cDI9XCJ7fVwiXG4kZGVmYXVsdExhYmVscz1cInt9XCJcbiRqaXRDb25maWc9XCJ7fVwiXG5cbiRFbnY6QVdTX1JFVFJZX01PREUgPSBcInN0YW5kYXJkXCIgICMgYmV0dGVyIHJldHJ5XG5cbiMgUmVzb2x2ZSBBV1MgcmVnaW9uIHZpYSBJTURTdjIgc28gaGVhcnRiZWF0L3NlbmQtdGFzay1zdWNjZXNzIGNhbGxzIGRvbid0IGRlcGVuZFxuIyBvbiBJTURTIGJlaW5nIHJlYWNoYWJsZSBvbiBlYWNoIGludm9jYXRpb24gKERvY2tlciBpcHRhYmxlcywgdHJhbnNpZW50IGlzc3VlcykuXG4jIEZhbGwgYmFjayB0byB1cy1lYXN0LTEgaWYgSU1EUyBpcyB1bmF2YWlsYWJsZSBhdCBib290LlxudHJ5IHtcbiAgJGltZHNUb2tlbiA9IEludm9rZS1SZXN0TWV0aG9kIC1NZXRob2QgUFVUIC1VcmkgXCJodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9hcGkvdG9rZW5cIiAtSGVhZGVycyBAe1wiWC1hd3MtZWMyLW1ldGFkYXRhLXRva2VuLXR0bC1zZWNvbmRzXCI9XCIyMTYwMFwifSAtVGltZW91dFNlYyA1XG4gICRFbnY6QVdTX0RFRkFVTFRfUkVHSU9OID0gSW52b2tlLVJlc3RNZXRob2QgLVVyaSBcImh0dHA6Ly8xNjkuMjU0LjE2OS4yNTQvbGF0ZXN0L21ldGEtZGF0YS9wbGFjZW1lbnQvcmVnaW9uXCIgLUhlYWRlcnMgQHtcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlblwiPSRpbWRzVG9rZW59IC1UaW1lb3V0U2VjIDVcbn0gY2F0Y2gge1xuICAkRW52OkFXU19ERUZBVUxUX1JFR0lPTiA9IFwidXMtZWFzdC0xXCJcbn1cblxuIyBFQzJMYXVuY2ggb25seSBzdGFydHMgc3NtIGFnZW50IGFmdGVyIHVzZXIgZGF0YSBpcyBkb25lLCBzbyB3ZSBuZWVkIHRvIHN0YXJ0IGl0IG91cnNlbHZlcyAoaXQgaXMgZGlzYWJsZWQgYnkgZGVmYXVsdClcblNldC1TZXJ2aWNlIC1TdGFydHVwVHlwZSBNYW51YWwgQW1hem9uU1NNQWdlbnRcblN0YXJ0LVNlcnZpY2UgQW1hem9uU1NNQWdlbnRcblxuJEhlYXJ0YmVhdFBhcmVudFBpZCA9ICRQSURcblN0YXJ0LUpvYiAtU2NyaXB0QmxvY2sge1xuICB3aGlsZSAoJHRydWUpIHtcbiAgICB0cnkge1xuICAgICAgJHNwb3QgPSBJbnZva2UtUmVzdE1ldGhvZCAtVXJpIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvbWV0YS1kYXRhL3Nwb3QvaW5zdGFuY2UtYWN0aW9uXCIgLUhlYWRlcnMgQHtcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlblwiPShJbnZva2UtUmVzdE1ldGhvZCAtTWV0aG9kIFBVVCAtVXJpIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvYXBpL3Rva2VuXCIgLUhlYWRlcnMgQHtcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlbi10dGwtc2Vjb25kc1wiPVwiMVwifSAtVGltZW91dFNlYyAyKX0gLVRpbWVvdXRTZWMgMlxuICAgICAgJHNwb3RKc29uID0gaWYgKCRzcG90IC1pcyBbc3RyaW5nXSkgeyAkc3BvdCB9IGVsc2UgeyAkc3BvdCB8IENvbnZlcnRUby1Kc29uIC1Db21wcmVzcyB9XG4gICAgICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2stZmFpbHVyZSAtLXRhc2stdG9rZW4gXCIkdXNpbmc6VEFTS19UT0tFTlwiIC0tZXJyb3IgU3BvdEludGVycnVwdGVkIC0tY2F1c2UgXCJFQzIgU3BvdCBpbnN0YW5jZSBpbnRlcnJ1cHRpb246ICRzcG90SnNvblwiXG4gICAgICBicmVha1xuICAgIH0gY2F0Y2gge1xuICAgIH1cbiAgICAkaGVhcnRiZWF0UmVzdWx0ID0gYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLWhlYXJ0YmVhdCAtLXRhc2stdG9rZW4gXCIkdXNpbmc6VEFTS19UT0tFTlwiIDI+JjFcbiAgICBpZiAoJExBU1RFWElUQ09ERSAtbmUgMCkge1xuICAgICAgJHRpbWVzdGFtcCA9IChHZXQtRGF0ZSAtRm9ybWF0IFwieXl5eS1NTS1kZFRISDptbTpzc0tcIilcbiAgICAgIFwiWyR0aW1lc3RhbXBdIGhlYXJ0YmVhdCBzZW5kLXRhc2staGVhcnRiZWF0IGZhaWxlZCAoZXhpdCAkTEFTVEVYSVRDT0RFKTogJGhlYXJ0YmVhdFJlc3VsdFwiIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xuICAgIH1cbiAgICBTdGFydC1TbGVlcCAtU2Vjb25kcyA2MFxuICB9XG59XG5mdW5jdGlvbiBzZXR1cF9sb2dzICgpIHtcbiAgZWNobyBcIntcbiAgICBcXGBcImxvZ3NcXGBcIjoge1xuICAgICAgXFxgXCJsb2dfc3RyZWFtX25hbWVcXGBcIjogXFxgXCJ1bmtub3duXFxgXCIsXG4gICAgICBcXGBcImxvZ3NfY29sbGVjdGVkXFxgXCI6IHtcbiAgICAgICAgXFxgXCJmaWxlc1xcYFwiOiB7XG4gICAgICAgICBcXGBcImNvbGxlY3RfbGlzdFxcYFwiOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIFxcYFwiZmlsZV9wYXRoXFxgXCI6IFxcYFwiL2FjdGlvbnMvcnVubmVyLmxvZ1xcYFwiLFxuICAgICAgICAgICAgICBcXGBcImxvZ19ncm91cF9uYW1lXFxgXCI6IFxcYFwiJGxvZ0dyb3VwTmFtZVxcYFwiLFxuICAgICAgICAgICAgICBcXGBcImxvZ19zdHJlYW1fbmFtZVxcYFwiOiBcXGBcIiRydW5uZXJOYW1lUGF0aFxcYFwiLFxuICAgICAgICAgICAgICBcXGBcInRpbWV6b25lXFxgXCI6IFxcYFwiVVRDXFxgXCJcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cIiB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAkRW52OlRFTVAvbG9nLmNvbmZcbiAgJiBcIkM6L1Byb2dyYW0gRmlsZXMvQW1hem9uL0FtYXpvbkNsb3VkV2F0Y2hBZ2VudC9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC1jdGwucHMxXCIgLWEgZmV0Y2gtY29uZmlnIC1tIGVjMiAtcyAtYyBmaWxlOiRFbnY6VEVNUC9sb2cuY29uZlxufVxuZnVuY3Rpb24gYWN0aW9uICgpIHtcbiAgY2QgL2FjdGlvbnNcbiAgaWYgKCRqaXRDb25maWcgLW5lIFwiXCIpIHtcbiAgICAjIEpJVCBtb2RlOiBjbGVhbmVyIHJlZ2lzdHJhdGlvbiwgbm8gY29uZmlnLmNtZCBuZWVkZWRcbiAgICAuL3J1bi5jbWQgLS1qaXRjb25maWcgXCIkaml0Q29uZmlnXCIgMj4mMSB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcbiAgICBpZiAoJExBU1RFWElUQ09ERSAtbmUgMCkgeyByZXR1cm4gMiB9XG4gIH0gZWxzZSB7XG4gICAgIyBMZWdhY3kgbW9kZTogcmVnaXN0ZXIgcnVubmVyIHRvIHBvb2wgd2l0aCB0b2tlblxuICAgICRSdW5uZXJWZXJzaW9uID0gR2V0LUNvbnRlbnQgL2FjdGlvbnMvUlVOTkVSX1ZFUlNJT04gLVJhd1xuICAgIGlmICgkUnVubmVyVmVyc2lvbiAtZXEgXCJsYXRlc3RcIikgeyAkUnVubmVyRmxhZ3MgPSBcIlwiIH0gZWxzZSB7ICRSdW5uZXJGbGFncyA9IFwiLS1kaXNhYmxldXBkYXRlXCIgfVxuICAgIC4vY29uZmlnLmNtZCAtLXVuYXR0ZW5kZWQgLS11cmwgXCJcXCR7cmVnaXN0cmF0aW9uVXJsfVwiIC0tdG9rZW4gXCJcXCR7cnVubmVyVG9rZW5QYXRofVwiIC0tZXBoZW1lcmFsIC0td29yayBfd29yayAtLWxhYmVscyBcIlxcJHtsYWJlbHN9LGNka2docjpzdGFydGVkOiQoR2V0LURhdGUgLVVGb3JtYXQgKyVzKVwiICRSdW5uZXJGbGFncyAtLW5hbWUgXCJcXCR7cnVubmVyTmFtZVBhdGh9XCIgXFwke3J1bm5lckdyb3VwMX0gXFwke3J1bm5lckdyb3VwMn0gXFwke2RlZmF1bHRMYWJlbHN9IDI+JjEgfCBPdXQtRmlsZSAtRW5jb2RpbmcgQVNDSUkgLUFwcGVuZCAvYWN0aW9ucy9ydW5uZXIubG9nXG5cbiAgICBpZiAoJExBU1RFWElUQ09ERSAtbmUgMCkgeyByZXR1cm4gMSB9XG4gICAgLi9ydW4uY21kIDI+JjEgfCBPdXQtRmlsZSAtRW5jb2RpbmcgQVNDSUkgLUFwcGVuZCAvYWN0aW9ucy9ydW5uZXIubG9nXG4gICAgaWYgKCRMQVNURVhJVENPREUgLW5lIDApIHsgcmV0dXJuIDIgfVxuICB9XG5cbiAgJFNUQVRVUyA9IFNlbGVjdC1TdHJpbmcgLVBhdGggJy4vX2RpYWcvKi5sb2cnIC1QYXR0ZXJuICdmaW5pc2ggam9iIHJlcXVlc3QgZm9yIGpvYiBbMC05YS1mXFxcXC1dKyB3aXRoIHJlc3VsdDogKC4qKScgfCAleyRfLk1hdGNoZXMuR3JvdXBzWzFdLlZhbHVlfSB8IFNlbGVjdC1PYmplY3QgLUxhc3QgMVxuXG4gIGlmICgkU1RBVFVTKSB7XG4gICAgICBlY2hvIFwiQ0RLR0hBIEpPQiBET05FIFxcJHtsYWJlbHN9ICRTVEFUVVNcIiB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcbiAgfVxuXG4gIHJldHVybiAwXG59XG5zZXR1cF9sb2dzXG4kciA9IGFjdGlvblxuaWYgKCRyIC1lcSAwKSB7XG4gIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1zdWNjZXNzIC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgLS10YXNrLW91dHB1dCAneyB9JyAyPiYxIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xufSBlbHNlIHtcbiAgJGxhc3RMaW5lID0gR2V0LUNvbnRlbnQgLVBhdGggQzovYWN0aW9ucy9ydW5uZXIubG9nIC1UYWlsIDEgLUVycm9yQWN0aW9uIFNpbGVudGx5Q29udGludWVcbiAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLWZhaWx1cmUgLS10YXNrLXRva2VuIFwiJFRBU0tfVE9LRU5cIiAtLWVycm9yIFJ1bm5lci5FcnJvci4kciAtLWNhdXNlIFwiQ2hlY2sgQ2xvdWRXYXRjaCBmb3IgZnVsbCBsb2cgLS0gJGxvZ0dyb3VwTmFtZS8kcnVubmVyTmFtZVBhdGggLS0gJGxhc3RMaW5lXCIgMj4mMSB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcbn1cblN0YXJ0LVNsZWVwIC1TZWNvbmRzIDEwICAjIGdpdmUgY2xvdWR3YXRjaCBhZ2VudCBpdHMgZGVmYXVsdCA1IHNlY29uZHMgYnVmZmVyIGR1cmF0aW9uIHRvIHVwbG9hZCBsb2dzXG5TdG9wLUNvbXB1dGVyIC1Db21wdXRlck5hbWUgbG9jYWxob3N0IC1Gb3JjZVxuPC9wb3dlcnNoZWxsPlxuYC5yZXBsYWNlKC97L2csICdcXFxceycpLnJlcGxhY2UoL30vZywgJ1xcXFx9JykucmVwbGFjZSgvXFxcXHtcXFxcfS9nLCAne30nKTtcblxuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIHtAbGluayBFYzJSdW5uZXJQcm92aWRlcn0gY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVjMlJ1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgQU1JIGNvbnRhaW5pbmcgR2l0SHViIFJ1bm5lciBhbmQgYWxsIHJlcXVpcmVtZW50cy5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgZGV0ZXJtaW5lcyB0aGUgT1MgYW5kIGFyY2hpdGVjdHVyZSBvZiB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBFYzJSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIoKVxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2VCdWlsZGVyPzogSVJ1bm5lckltYWdlQnVpbGRlcjtcblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGltYWdlQnVpbGRlclxuICAgKi9cbiAgcmVhZG9ubHkgYW1pQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2VjMiddXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgcnVubmVyIGdyb3VwIG5hbWUuXG4gICAqXG4gICAqIElmIHNwZWNpZmllZCwgdGhlIHJ1bm5lciB3aWxsIGJlIHJlZ2lzdGVyZWQgd2l0aCB0aGlzIGdyb3VwIG5hbWUuIFNldHRpbmcgYSBydW5uZXIgZ3JvdXAgY2FuIGhlbHAgbWFuYWdpbmcgYWNjZXNzIHRvIHNlbGYtaG9zdGVkIHJ1bm5lcnMuIEl0XG4gICAqIHJlcXVpcmVzIGEgcGFpZCBHaXRIdWIgYWNjb3VudC5cbiAgICpcbiAgICogVGhlIGdyb3VwIG11c3QgZXhpc3Qgb3IgdGhlIHJ1bm5lciB3aWxsIG5vdCBzdGFydC5cbiAgICpcbiAgICogVXNlcnMgd2lsbCBzdGlsbCBiZSBhYmxlIHRvIHRyaWdnZXIgdGhpcyBydW5uZXIgd2l0aCB0aGUgY29ycmVjdCBsYWJlbHMuIEJ1dCB0aGUgcnVubmVyIHdpbGwgb25seSBiZSBhYmxlIHRvIHJ1biBqb2JzIGZyb20gcmVwb3MgYWxsb3dlZCB0byB1c2UgdGhlIGdyb3VwLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBJbnN0YW5jZSB0eXBlIGZvciBsYXVuY2hlZCBydW5uZXIgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBGb3IgR1BVIGluc3RhbmNlIHR5cGVzIChnNGRuLCBnNSwgcDMsIGV0Yy4pLCB3ZSBhdXRvbWF0aWNhbGx5IHVzZSBhIEdQVSBiYXNlIGltYWdlIChBV1MgRGVlcCBMZWFybmluZyBBTUkpXG4gICAqIHdpdGggTlZJRElBIGRyaXZlcnMgcHJlLWluc3RhbGxlZC4gSWYgeW91IHByb3ZpZGUgeW91ciBvd24gaW1hZ2UgYnVpbGRlciwgdXNlXG4gICAqIGBiYXNlQW1pOiBCYXNlSW1hZ2UuZnJvbUdwdUJhc2Uob3MsIGFyY2hpdGVjdHVyZSlgIG9yIGFub3RoZXIgaW1hZ2UgcHJlbG9hZGVkIHdpdGggTlZJRElBIGRyaXZlcnMsIG9yIHVzZVxuICAgKiBhbiBpbWFnZSBjb21wb25lbnQgdG8gaW5zdGFsbCBOVklESUEgZHJpdmVycy5cbiAgICpcbiAgICogQGRlZmF1bHQgbTZpLmxhcmdlXG4gICAqL1xuICByZWFkb25seSBpbnN0YW5jZVR5cGU/OiBlYzIuSW5zdGFuY2VUeXBlO1xuXG4gIC8qKlxuICAgKiBTaXplIG9mIHZvbHVtZSBhdmFpbGFibGUgZm9yIGxhdW5jaGVkIHJ1bm5lciBpbnN0YW5jZXMuIFRoaXMgbW9kaWZpZXMgdGhlIGJvb3Qgdm9sdW1lIHNpemUgYW5kIGRvZXNuJ3QgYWRkIGFueSBhZGRpdGlvbmFsIHZvbHVtZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IDMwR0JcbiAgICovXG4gIHJlYWRvbmx5IHN0b3JhZ2VTaXplPzogY2RrLlNpemU7XG5cbiAgLyoqXG4gICAqIE9wdGlvbnMgZm9yIHJ1bm5lciBpbnN0YW5jZSBzdG9yYWdlIHZvbHVtZS5cbiAgICovXG4gIHJlYWRvbmx5IHN0b3JhZ2VPcHRpb25zPzogU3RvcmFnZU9wdGlvbnM7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IEdyb3VwIHRvIGFzc2lnbiB0byBsYXVuY2hlZCBydW5uZXIgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBzZWN1cml0eSBncm91cFxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIHNlY3VyaXR5R3JvdXBzfVxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cD86IGVjMi5JU2VjdXJpdHlHcm91cDtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXBzIHRvIGFzc2lnbiB0byBsYXVuY2hlZCBydW5uZXIgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBhIG5ldyBzZWN1cml0eSBncm91cFxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogU3VibmV0IHdoZXJlIHRoZSBydW5uZXIgaW5zdGFuY2VzIHdpbGwgYmUgbGF1bmNoZWQuXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgc3VibmV0IG9mIGFjY291bnQncyBkZWZhdWx0IFZQQ1xuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIHZwY30gYW5kIHtAbGluayBzdWJuZXRTZWxlY3Rpb259XG4gICAqL1xuICByZWFkb25seSBzdWJuZXQ/OiBlYzIuSVN1Ym5ldDtcblxuICAvKipcbiAgICogVlBDIHdoZXJlIHJ1bm5lciBpbnN0YW5jZXMgd2lsbCBiZSBsYXVuY2hlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBhY2NvdW50IFZQQ1xuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFdoZXJlIHRvIHBsYWNlIHRoZSBuZXR3b3JrIGludGVyZmFjZXMgd2l0aGluIHRoZSBWUEMuIE9ubHkgdGhlIGZpcnN0IG1hdGNoZWQgc3VibmV0IHdpbGwgYmUgdXNlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBWUEMgc3VibmV0XG4gICAqL1xuICByZWFkb25seSBzdWJuZXRTZWxlY3Rpb24/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBVc2Ugc3BvdCBpbnN0YW5jZXMgdG8gc2F2ZSBtb25leS4gU3BvdCBpbnN0YW5jZXMgYXJlIGNoZWFwZXIgYnV0IG5vdCBhbHdheXMgYXZhaWxhYmxlIGFuZCBjYW4gYmUgc3RvcHBlZCBwcmVtYXR1cmVseS5cbiAgICpcbiAgICogQGRlZmF1bHQgZmFsc2VcbiAgICovXG4gIHJlYWRvbmx5IHNwb3Q/OiBib29sZWFuO1xuXG4gIC8qKlxuICAgKiBTZXQgYSBtYXhpbXVtIHByaWNlIGZvciBzcG90IGluc3RhbmNlcy5cbiAgICpcbiAgICogQGRlZmF1bHQgbm8gbWF4IHByaWNlICh5b3Ugd2lsbCBwYXkgY3VycmVudCBzcG90IHByaWNlKVxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdE1heFByaWNlPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBNYXhpbXVtIHRpbWUgdGhlIFN0ZXAgRnVuY3Rpb25zIHRhc2sgd2FpdHMgYmV0d2VlbiBFQzIgaGVhcnRiZWF0cyBiZWZvcmVcbiAgICogZmFsbGluZyBiYWNrIHRvIHRoZSBuZXh0IHN1Ym5ldCAvIGZhaWxpbmcgdGhlIHRhc2suXG4gICAqXG4gICAqIElmIHlvdXIgam9iIHJ1bnMgbG9uZ2VyIHRoYW4gMTAgbWludXRlcyB5b3UgbXVzdCByYWlzZSB0aGlzIOKAlCB0aGUgcHJldmlvdXNcbiAgICogaGFyZGNvZGVkIDEwLW1pbnV0ZSBkZWZhdWx0IGNhdXNlZCBmYWxzZSBcInN0dWNrXCIgZGV0ZWN0aW9ucyBmb3IgYW55IGpvYlxuICAgKiB0aGF0IHRvb2sgbG9uZ2VyIHRvIGNvbXBsZXRlIHRoYW4gdGhlIGhlYXJ0YmVhdCBpbnRlcnZhbCAoZS5nLiBMb2NhbFN0YWNrXG4gICAqIHNuYXBzaG90IGRlcGxveXMsIGludGVncmF0aW9uIHRlc3RzIHdpdGggbGFyZ2UgZml4dHVyZSBzZXR1cCwgZXRjLikuXG4gICAqXG4gICAqIEBkZWZhdWx0IGNkay5EdXJhdGlvbi5taW51dGVzKDEwKVxuICAgKi9cbiAgcmVhZG9ubHkgaGVhcnRiZWF0VGltZW91dD86IGNkay5EdXJhdGlvbjtcbn1cblxuLyoqXG4gKiBHaXRIdWIgQWN0aW9ucyBydW5uZXIgcHJvdmlkZXIgdXNpbmcgRUMyIHRvIGV4ZWN1dGUgam9icy5cbiAqXG4gKiBUaGlzIGNvbnN0cnVjdCBpcyBub3QgbWVhbnQgdG8gYmUgdXNlZCBieSBpdHNlbGYuIEl0IHNob3VsZCBiZSBwYXNzZWQgaW4gdGhlIHByb3ZpZGVycyBwcm9wZXJ0eSBmb3IgR2l0SHViUnVubmVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIEVjMlJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqXG4gICAqIENyZWF0ZSBuZXcgaW1hZ2UgYnVpbGRlciB0aGF0IGJ1aWxkcyBFQzIgc3BlY2lmaWMgcnVubmVyIGltYWdlcy5cbiAgICpcbiAgICogWW91IGNhbiBjdXN0b21pemUgdGhlIE9TLCBhcmNoaXRlY3R1cmUsIFZQQywgc3VibmV0LCBzZWN1cml0eSBncm91cHMsIGV0Yy4gYnkgcGFzc2luZyBpbiBwcm9wcy5cbiAgICpcbiAgICogWW91IGNhbiBhZGQgY29tcG9uZW50cyB0byB0aGUgaW1hZ2UgYnVpbGRlciBieSBjYWxsaW5nIGBpbWFnZUJ1aWxkZXIuYWRkQ29tcG9uZW50KClgLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBPUyBpcyBVYnVudHUgcnVubmluZyBvbiB4NjQgYXJjaGl0ZWN0dXJlLlxuICAgKlxuICAgKiBJbmNsdWRlZCBjb21wb25lbnRzOlxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuY2xvdWRXYXRjaEFnZW50KClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcigpYFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcykge1xuICAgIHJldHVybiBSdW5uZXJJbWFnZUJ1aWxkZXIubmV3KHNjb3BlLCBpZCwge1xuICAgICAgb3M6IE9zLkxJTlVYX1VCVU5UVSxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGJ1aWxkZXJUeXBlOiBSdW5uZXJJbWFnZUJ1aWxkZXJUeXBlLkFXU19JTUFHRV9CVUlMREVSLFxuICAgICAgY29tcG9uZW50czogW1xuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmNsb3VkV2F0Y2hBZ2VudCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcigpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIocHJvcHM/LnJ1bm5lclZlcnNpb24gPz8gUnVubmVyVmVyc2lvbi5sYXRlc3QoKSksXG4gICAgICBdLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTGFiZWxzIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHByb3ZpZGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR3JhbnQgcHJpbmNpcGFsIHVzZWQgdG8gYWRkIHBlcm1pc3Npb25zIHRvIHRoZSBydW5uZXIgcm9sZS5cbiAgICovXG4gIHJlYWRvbmx5IGdyYW50UHJpbmNpcGFsOiBpYW0uSVByaW5jaXBhbDtcblxuICAvKipcbiAgICogTG9nIGdyb3VwIHdoZXJlIHByb3ZpZGVkIHJ1bm5lcnMgd2lsbCBzYXZlIHRoZWlyIGxvZ3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGlzIG5vdCB0aGUgam9iIGxvZywgYnV0IHRoZSBydW5uZXIgaXRzZWxmLiBJdCB3aWxsIG5vdCBjb250YWluIG91dHB1dCBmcm9tIHRoZSBHaXRIdWIgQWN0aW9uIGJ1dCBvbmx5IG1ldGFkYXRhIG9uIGl0cyBleGVjdXRpb24uXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cDogbG9ncy5JTG9nR3JvdXA7XG5cbiAgcmVhZG9ubHkgcmV0cnlhYmxlRXJyb3JzID0gW1xuICAgICdFYzIuRWMyRXhjZXB0aW9uJyxcbiAgICAnU3RhdGVzLlRpbWVvdXQnLFxuICBdO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgZ3JvdXA/OiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgYW1pQnVpbGRlcjogSVJ1bm5lckltYWdlQnVpbGRlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBhbWk6IFJ1bm5lckFtaTtcbiAgcHJpdmF0ZSByZWFkb25seSByb2xlOiBpYW0uUm9sZTtcbiAgcHJpdmF0ZSByZWFkb25seSBpbnN0YW5jZVR5cGU6IGVjMi5JbnN0YW5jZVR5cGU7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RvcmFnZVNpemU6IGNkay5TaXplO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0b3JhZ2VPcHRpb25zPzogU3RvcmFnZU9wdGlvbnM7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3BvdDogYm9vbGVhbjtcbiAgcHJpdmF0ZSByZWFkb25seSBzcG90TWF4UHJpY2U6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSByZWFkb25seSBoZWFydGJlYXRUaW1lb3V0OiBjZGsuRHVyYXRpb247XG4gIHByaXZhdGUgcmVhZG9ubHkgdnBjOiBlYzIuSVZwYztcbiAgcHJpdmF0ZSByZWFkb25seSBzdWJuZXRzOiBlYzIuSVN1Ym5ldFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBkZWZhdWx0TGFiZWxzOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogRWMyUnVubmVyUHJvdmlkZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgdGhpcy5sYWJlbHMgPSBwcm9wcz8ubGFiZWxzID8/IFsnZWMyJ107XG4gICAgdGhpcy5ncm91cCA9IHByb3BzPy5ncm91cDtcbiAgICB0aGlzLnZwYyA9IHByb3BzPy52cGMgPz8gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdEZWZhdWx0IFZQQycsIHsgaXNEZWZhdWx0OiB0cnVlIH0pO1xuICAgIHRoaXMuc2VjdXJpdHlHcm91cHMgPSBwcm9wcz8uc2VjdXJpdHlHcm91cCA/IFtwcm9wcy5zZWN1cml0eUdyb3VwXSA6IChwcm9wcz8uc2VjdXJpdHlHcm91cHMgPz8gW25ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnU0cnLCB7IHZwYzogdGhpcy52cGMgfSldKTtcbiAgICB0aGlzLnN1Ym5ldHMgPSBwcm9wcz8uc3VibmV0ID8gW3Byb3BzLnN1Ym5ldF0gOiB0aGlzLnZwYy5zZWxlY3RTdWJuZXRzKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24pLnN1Ym5ldHM7XG4gICAgdGhpcy5pbnN0YW5jZVR5cGUgPSBwcm9wcz8uaW5zdGFuY2VUeXBlID8/IGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuTTZJLCBlYzIuSW5zdGFuY2VTaXplLkxBUkdFKTtcbiAgICB0aGlzLnN0b3JhZ2VTaXplID0gcHJvcHM/LnN0b3JhZ2VTaXplID8/IGNkay5TaXplLmdpYmlieXRlcygzMCk7IC8vIDMwIGlzIHRoZSBtaW5pbXVtIGZvciBXaW5kb3dzXG4gICAgdGhpcy5zdG9yYWdlT3B0aW9ucyA9IHByb3BzPy5zdG9yYWdlT3B0aW9ucztcbiAgICB0aGlzLnNwb3QgPSBwcm9wcz8uc3BvdCA/PyBmYWxzZTtcbiAgICB0aGlzLnNwb3RNYXhQcmljZSA9IHByb3BzPy5zcG90TWF4UHJpY2U7XG4gICAgdGhpcy5oZWFydGJlYXRUaW1lb3V0ID0gcHJvcHM/LmhlYXJ0YmVhdFRpbWVvdXQgPz8gY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTApO1xuICAgIHRoaXMuZGVmYXVsdExhYmVscyA9IHByb3BzPy5kZWZhdWx0TGFiZWxzID8/IHRydWU7XG5cbiAgICBpZiAodGhpcy5zdWJuZXRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKCdBdCBsZWFzdCBvbmUgc3VibmV0IGlzIHJlcXVpcmVkJyk7XG4gICAgfVxuXG4gICAgY29uc3QgYXJjaCA9IHRoaXMuaW5zdGFuY2VUeXBlLmFyY2hpdGVjdHVyZSA9PT0gZWMyLkluc3RhbmNlQXJjaGl0ZWN0dXJlLkFSTV82NCA/IEFyY2hpdGVjdHVyZS5BUk02NCA6IEFyY2hpdGVjdHVyZS5YODZfNjQ7XG5cbiAgICB0aGlzLmFtaUJ1aWxkZXIgPSBwcm9wcz8uaW1hZ2VCdWlsZGVyID8/IHByb3BzPy5hbWlCdWlsZGVyID8/IEVjMlJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcih0aGlzLCAnQW1pIEJ1aWxkZXInLCB7XG4gICAgICB2cGM6IHByb3BzPy52cGMsXG4gICAgICBzdWJuZXRTZWxlY3Rpb246IHByb3BzPy5zdWJuZXRTZWxlY3Rpb24sXG4gICAgICBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3VwcyxcbiAgICAgIGJhc2VBbWk6IGlzR3B1SW5zdGFuY2VUeXBlKHRoaXMuaW5zdGFuY2VUeXBlKSA/IEJhc2VJbWFnZS5mcm9tR3B1QmFzZShPcy5MSU5VWF9VQlVOVFUsIGFyY2gpIDogdW5kZWZpbmVkLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBhcmNoLFxuICAgICAgYXdzSW1hZ2VCdWlsZGVyT3B0aW9uczoge1xuICAgICAgICBpbnN0YW5jZVR5cGU6IGFyY2guaXMoQXJjaGl0ZWN0dXJlLkFSTTY0KSA/IGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuTTZHLCBlYzIuSW5zdGFuY2VTaXplLkxBUkdFKSA6IHVuZGVmaW5lZCxcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5hbWkgPSB0aGlzLmFtaUJ1aWxkZXIuYmluZEFtaSgpO1xuXG4gICAgaWYgKHRoaXMuYW1pQnVpbGRlciBpbnN0YW5jZW9mIEF3c0ltYWdlQnVpbGRlclJ1bm5lckltYWdlQnVpbGRlcikge1xuICAgICAgaWYgKHRoaXMuYW1pQnVpbGRlci5zdG9yYWdlU2l6ZSAmJiB0aGlzLnN0b3JhZ2VTaXplLnRvQnl0ZXMoKSA8IHRoaXMuYW1pQnVpbGRlci5zdG9yYWdlU2l6ZS50b0J5dGVzKCkpIHtcbiAgICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKGBSdW5uZXIgc3RvcmFnZSBzaXplICgke3RoaXMuc3RvcmFnZVNpemUudG9HaWJpYnl0ZXMoKX0gR2lCKSBtdXN0IGJlIGF0IGxlYXN0IHRoZSBzYW1lIGFzIHRoZSBpbWFnZSBidWlsZGVyIHN0b3JhZ2Ugc2l6ZSAoJHt0aGlzLmFtaUJ1aWxkZXIuc3RvcmFnZVNpemUudG9HaWJpYnl0ZXMoKX0gR2lCKWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICghdGhpcy5hbWkuYXJjaGl0ZWN0dXJlLmluc3RhbmNlVHlwZU1hdGNoKHRoaXMuaW5zdGFuY2VUeXBlKSkge1xuICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKGBBTUkgYXJjaGl0ZWN0dXJlICgke3RoaXMuYW1pLmFyY2hpdGVjdHVyZS5uYW1lfSkgZG9lc24ndCBtYXRjaCBydW5uZXIgaW5zdGFuY2UgdHlwZSAoJHt0aGlzLmluc3RhbmNlVHlwZX0gLyAke3RoaXMuaW5zdGFuY2VUeXBlLmFyY2hpdGVjdHVyZX0pYCk7XG4gICAgfVxuXG4gICAgdGhpcy5ncmFudFByaW5jaXBhbCA9IHRoaXMucm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlYzIuYW1hem9uYXdzLmNvbScpLFxuICAgIH0pO1xuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwuYWRkVG9QcmluY2lwYWxQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydzdGF0ZXM6U2VuZFRhc2tGYWlsdXJlJywgJ3N0YXRlczpTZW5kVGFza1N1Y2Nlc3MnLCAnc3RhdGVzOlNlbmRUYXNrSGVhcnRiZWF0J10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBubyBzdXBwb3J0IGZvciBzdGF0ZU1hY2hpbmUuc3RhdGVNYWNoaW5lQXJuIGJ1dCB0YXNrIHRva2VucyBhcmUgdmVyeSBsb25nIGFuZCB0b3RhbGx5IHJhbmRvbSBzbyBub3QgdGhlIGVuZCBvZiB0aGUgd29ybGRcbiAgICB9KSk7XG4gICAgdGhpcy5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShNSU5JTUFMX0VDMl9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQpO1xuXG4gICAgdGhpcy5sb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKFxuICAgICAgdGhpcyxcbiAgICAgICdMb2dzJyxcbiAgICAgIHtcbiAgICAgICAgcmV0ZW50aW9uOiBwcm9wcz8ubG9nUmV0ZW50aW9uID8/IFJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB9LFxuICAgICk7XG4gICAgdGhpcy5sb2dHcm91cC5ncmFudFdyaXRlKHRoaXMpO1xuICB9XG5cbiAgcHJpdmF0ZSB1c2VyRGF0YUNvbnN0KCkge1xuICAgIHJldHVybiB0aGlzLmFtaS5vcy5pcyhPcy5XSU5ET1dTKSA/ICdlYzJVc2VyRGF0YVdpbmRvd3MnIDogJ2VjMlVzZXJEYXRhTGludXgnO1xuICB9XG5cbiAgcHVibGljIHN0ZXBGdW5jdGlvbkNvbnN0YW50cygpOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+IHtcbiAgICBjb25zdCB1c2VyZGF0YVRlbXBsYXRlID0gdGhpcy5hbWkub3MuaXMoT3MuV0lORE9XUykgPyB3aW5kb3dzVXNlckRhdGFUZW1wbGF0ZSA6IGxpbnV4VXNlckRhdGFUZW1wbGF0ZTtcbiAgICByZXR1cm4geyBbdGhpcy51c2VyRGF0YUNvbnN0KCldOiB1c2VyZGF0YVRlbXBsYXRlIH07XG4gIH1cblxuICAvKipcbiAgICogR2VuZXJhdGUgc3RlcCBmdW5jdGlvbiB0YXNrKHMpIHRvIHN0YXJ0IGEgbmV3IHJ1bm5lci5cbiAgICpcbiAgICogQ2FsbGVkIGJ5IEdpdGh1YlJ1bm5lcnMgYW5kIHNob3VsZG4ndCBiZSBjYWxsZWQgbWFudWFsbHkuXG4gICAqXG4gICAqIEBwYXJhbSBwYXJhbWV0ZXJzIHdvcmtmbG93IGpvYiBkZXRhaWxzXG4gICAqL1xuICBnZXRTdGVwRnVuY3Rpb25UYXNrKHBhcmFtZXRlcnM6IElSdW5uZXJSdW50aW1lUGFyYW1ldGVycyk6IHN0ZXBmdW5jdGlvbnMuSUNoYWluYWJsZSB7XG4gICAgLy8gd2UgbmVlZCB0byBidWlsZCB1c2VyIGRhdGEgaW4gdHdvIHN0ZXBzIGJlY2F1c2UgcGFzc2luZyB0aGUgdGVtcGxhdGUgYXMgdGhlIGZpcnN0IHBhcmFtZXRlciB0byBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLmZvcm1hdCBmYWlscyBvbiBzeW50YXhcblxuICAgIGNvbnN0IHBhcmFtcyA9IFtcbiAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGgudGFza1Rva2VuLFxuICAgICAgdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBwYXJhbWV0ZXJzLnJ1bm5lck5hbWVQYXRoLFxuICAgICAgcGFyYW1ldGVycy5naXRodWJEb21haW5QYXRoLFxuICAgICAgcGFyYW1ldGVycy5vd25lclBhdGgsXG4gICAgICBwYXJhbWV0ZXJzLnJlcG9QYXRoLFxuICAgICAgcGFyYW1ldGVycy5ydW5uZXJUb2tlblBhdGgsXG4gICAgICBwYXJhbWV0ZXJzLmxhYmVsc1BhdGgsXG4gICAgICBwYXJhbWV0ZXJzLnJlZ2lzdHJhdGlvblVybCxcbiAgICAgIHRoaXMuZ3JvdXAgPyAnLS1ydW5uZXJncm91cCcgOiAnJyxcbiAgICAgIC8vIHRoaXMgaXMgc3BsaXQgaW50byAyIGZvciBwb3dlcnNoZWxsIG90aGVyd2lzZSBpdCB3aWxsIHBhc3MgXCItLXJ1bm5lcmdyb3VwIG5hbWVcIiBhcyBhIHNpbmdsZSBhcmd1bWVudCBhbmQgY29uZmlnLnNoIHdpbGwgZmFpbFxuICAgICAgdGhpcy5ncm91cCA/IHRoaXMuZ3JvdXAgOiAnJyxcbiAgICAgIHRoaXMuZGVmYXVsdExhYmVscyA/ICcnIDogJy0tbm8tZGVmYXVsdC1sYWJlbHMnLFxuICAgICAgcGFyYW1ldGVycy5qaXRDb25maWdQYXRoLFxuICAgIF07XG5cbiAgICAvLyB3ZSB1c2UgZWMyOlJ1bkluc3RhbmNlcyBiZWNhdXNlIHdlIG11c3RcbiAgICAvLyB3ZSBjYW4ndCB1c2UgZmxlZXRzIGJlY2F1c2UgdGhleSBkb24ndCBsZXQgdXMgb3ZlcnJpZGUgdXNlciBkYXRhLCBzZWN1cml0eSBncm91cHMgb3IgZXZlbiBkaXNrIHNpemVcbiAgICAvLyB3ZSBjYW4ndCB1c2UgcmVxdWVzdFNwb3RJbnN0YW5jZXMgYmVjYXVzZSBpdCBkb2Vzbid0IHN1cHBvcnQgbGF1bmNoIHRlbXBsYXRlcywgYW5kIGl0J3MgZGVwcmVjYXRlZFxuICAgIC8vIGVjMjpSdW5JbnN0YW5jZXMgYWxzbyBzZWVtZWQgbGlrZSB0aGUgb25seSBvbmUgdG8gaW1tZWRpYXRlbHkgcmV0dXJuIGFuIGVycm9yIHdoZW4gc3BvdCBjYXBhY2l0eSBpcyBub3QgYXZhaWxhYmxlXG5cbiAgICAvLyB3ZSBidWlsZCBhIGNvbXBsaWNhdGVkIGNoYWluIG9mIHN0YXRlcyBoZXJlIGJlY2F1c2UgZWMyOlJ1bkluc3RhbmNlcyBjYW4gb25seSB0cnkgb25lIHN1Ym5ldCBhdCBhIHRpbWVcbiAgICAvLyBpZiBzb21lb25lIGNhbiBmaWd1cmUgb3V0IGEgZ29vZCB3YXkgdG8gdXNlIE1hcCBmb3IgdGhpcywgcGxlYXNlIG9wZW4gYSBQUlxuXG4gICAgLy8gYnVpbGQgYSBzdGF0ZSBmb3IgZWFjaCBzdWJuZXQgd2Ugd2FudCB0byB0cnlcbiAgICBjb25zdCBpbnN0YW5jZVByb2ZpbGUgPSBuZXcgaWFtLkNmbkluc3RhbmNlUHJvZmlsZSh0aGlzLCAnSW5zdGFuY2UgUHJvZmlsZScsIHtcbiAgICAgIHJvbGVzOiBbdGhpcy5yb2xlLnJvbGVOYW1lXSxcbiAgICB9KTtcbiAgICBjb25zdCByb290RGV2aWNlUmVzb3VyY2UgPSBhbWlSb290RGV2aWNlKHRoaXMsIHRoaXMuYW1pLmxhdW5jaFRlbXBsYXRlLmxhdW5jaFRlbXBsYXRlSWQpO1xuICAgIHJvb3REZXZpY2VSZXNvdXJjZS5ub2RlLmFkZERlcGVuZGVuY3kodGhpcy5hbWlCdWlsZGVyKTtcbiAgICBjb25zdCBzdWJuZXRSdW5uZXJzID0gdGhpcy5zdWJuZXRzLm1hcChzdWJuZXQgPT4ge1xuICAgICAgcmV0dXJuIG5ldyBzdGVwZnVuY3Rpb25zX3Rhc2tzLkNhbGxBd3NTZXJ2aWNlKHRoaXMsIHN1Ym5ldC5zdWJuZXRJZCwge1xuICAgICAgICBzdGF0ZU5hbWU6IGdlbmVyYXRlU3RhdGVOYW1lKHRoaXMsIHN1Ym5ldC5zdWJuZXRJZCksXG4gICAgICAgIGNvbW1lbnQ6IHN1Ym5ldC5hdmFpbGFiaWxpdHlab25lLFxuICAgICAgICBpbnRlZ3JhdGlvblBhdHRlcm46IHN0ZXBmdW5jdGlvbnMuSW50ZWdyYXRpb25QYXR0ZXJuLldBSVRfRk9SX1RBU0tfVE9LRU4sXG4gICAgICAgIHNlcnZpY2U6ICdlYzInLFxuICAgICAgICBhY3Rpb246ICdydW5JbnN0YW5jZXMnLFxuICAgICAgICBoZWFydGJlYXRUaW1lb3V0OiBzdGVwZnVuY3Rpb25zLlRpbWVvdXQuZHVyYXRpb24odGhpcy5oZWFydGJlYXRUaW1lb3V0KSxcbiAgICAgICAgcGFyYW1ldGVyczoge1xuICAgICAgICAgIExhdW5jaFRlbXBsYXRlOiB7XG4gICAgICAgICAgICBMYXVuY2hUZW1wbGF0ZUlkOiB0aGlzLmFtaS5sYXVuY2hUZW1wbGF0ZS5sYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgTWluQ291bnQ6IDEsXG4gICAgICAgICAgTWF4Q291bnQ6IDEsXG4gICAgICAgICAgSW5zdGFuY2VUeXBlOiB0aGlzLmluc3RhbmNlVHlwZS50b1N0cmluZygpLFxuICAgICAgICAgIFVzZXJEYXRhOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLmJhc2U2NEVuY29kZShcbiAgICAgICAgICAgIHN0ZXBmdW5jdGlvbnMuSnNvblBhdGguZm9ybWF0KFxuICAgICAgICAgICAgICAvLyBzZWUgc3RlcEZ1bmN0aW9uQ29uc3RhbnRzKClcbiAgICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdChgJC5jb25zdHMuJHt0aGlzLnVzZXJEYXRhQ29uc3QoKX1gKSxcbiAgICAgICAgICAgICAgLi4ucGFyYW1zLFxuICAgICAgICAgICAgKSxcbiAgICAgICAgICApLFxuICAgICAgICAgIEluc3RhbmNlSW5pdGlhdGVkU2h1dGRvd25CZWhhdmlvcjogZWMyLkluc3RhbmNlSW5pdGlhdGVkU2h1dGRvd25CZWhhdmlvci5URVJNSU5BVEUsXG4gICAgICAgICAgSWFtSW5zdGFuY2VQcm9maWxlOiB7XG4gICAgICAgICAgICBBcm46IGluc3RhbmNlUHJvZmlsZS5hdHRyQXJuLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgTWV0YWRhdGFPcHRpb25zOiB7XG4gICAgICAgICAgICBIdHRwVG9rZW5zOiAncmVxdWlyZWQnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgU2VjdXJpdHlHcm91cElkczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgICAgICBTdWJuZXRJZDogc3VibmV0LnN1Ym5ldElkLFxuICAgICAgICAgIEJsb2NrRGV2aWNlTWFwcGluZ3M6IFt7XG4gICAgICAgICAgICBEZXZpY2VOYW1lOiByb290RGV2aWNlUmVzb3VyY2UucmVmLFxuICAgICAgICAgICAgRWJzOiB7XG4gICAgICAgICAgICAgIERlbGV0ZU9uVGVybWluYXRpb246IHRydWUsXG4gICAgICAgICAgICAgIFZvbHVtZVNpemU6IHRoaXMuc3RvcmFnZVNpemUudG9HaWJpYnl0ZXMoKSxcbiAgICAgICAgICAgICAgVm9sdW1lVHlwZTogdGhpcy5zdG9yYWdlT3B0aW9ucz8udm9sdW1lVHlwZSxcbiAgICAgICAgICAgICAgSW9wczogdGhpcy5zdG9yYWdlT3B0aW9ucz8uaW9wcyxcbiAgICAgICAgICAgICAgVGhyb3VnaHB1dDogdGhpcy5zdG9yYWdlT3B0aW9ucz8udGhyb3VnaHB1dCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfV0sXG4gICAgICAgICAgSW5zdGFuY2VNYXJrZXRPcHRpb25zOiB0aGlzLnNwb3QgPyB7XG4gICAgICAgICAgICBNYXJrZXRUeXBlOiAnc3BvdCcsXG4gICAgICAgICAgICBTcG90T3B0aW9uczoge1xuICAgICAgICAgICAgICBNYXhQcmljZTogdGhpcy5zcG90TWF4UHJpY2UsXG4gICAgICAgICAgICAgIFNwb3RJbnN0YW5jZVR5cGU6ICdvbmUtdGltZScsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0gOiB1bmRlZmluZWQsXG4gICAgICAgICAgVGFnU3BlY2lmaWNhdGlvbnM6IFsnaW5zdGFuY2UnLCAndm9sdW1lJ10ubWFwKHJlc1R5cGUgPT4geyAvLyBtYW51YWxseSBwcm9wYWdhdGUgdGFnc1xuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgUmVzb3VyY2VUeXBlOiByZXNUeXBlLFxuICAgICAgICAgICAgICBUYWdzOiBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgS2V5OiAnTmFtZScsXG4gICAgICAgICAgICAgICAgICBWYWx1ZTogcGFyYW1ldGVycy5ydW5uZXJOYW1lUGF0aCxcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIEtleTogJ0dpdEh1YlJ1bm5lcnM6UHJvdmlkZXInLFxuICAgICAgICAgICAgICAgICAgVmFsdWU6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgS2V5OiAnR2l0SHViUnVubmVyczpSZXBvJyxcbiAgICAgICAgICAgICAgICAgIFZhbHVlOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLmZvcm1hdCgne30ve30nLCBwYXJhbWV0ZXJzLm93bmVyUGF0aCwgcGFyYW1ldGVycy5yZXBvUGF0aCksXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBLZXk6ICdHaXRIdWJSdW5uZXJzOkxhYmVscycsXG4gICAgICAgICAgICAgICAgICBWYWx1ZTogcGFyYW1ldGVycy5sYWJlbHNQYXRoLFxuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9O1xuICAgICAgICAgIH0pLFxuICAgICAgICB9LFxuICAgICAgICBpYW1SZXNvdXJjZXM6IFsnKiddLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICBjb25zdCBoZWFkID0gc3VibmV0UnVubmVyc1swXTtcbiAgICBsZXQgY3VycmVudCA9IHN1Ym5ldFJ1bm5lcnNbMF07XG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBzdWJuZXRSdW5uZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBuZXh0ID0gc3VibmV0UnVubmVyc1tpXTtcbiAgICAgIHBhcmFtZXRlcnMuYWRkQ2F0Y2hBbmRDbGVhblVwKGN1cnJlbnQsIG5leHQpO1xuICAgICAgY3VycmVudCA9IG5leHQ7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBTaW1wbGVGcmFnbWVudChcbiAgICAgIHRoaXMsXG4gICAgICAnRnJhZ21lbnQnLFxuICAgICAgaGVhZCxcbiAgICAgIGN1cnJlbnQsXG4gICAgKTtcbiAgfVxuXG4gIGdyYW50U3RhdGVNYWNoaW5lKHN0YXRlTWFjaGluZVJvbGU6IGlhbS5JR3JhbnRhYmxlKSB7XG4gICAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2lhbTpQYXNzUm9sZSddLFxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5yb2xlLnJvbGVBcm5dLFxuICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAnaWFtOlBhc3NlZFRvU2VydmljZSc6ICdlYzIuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pKTtcblxuICAgIHN0YXRlTWFjaGluZVJvbGUuZ3JhbnRQcmluY2lwYWwuYWRkVG9QcmluY2lwYWxQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydlYzI6Y3JlYXRlVGFncyddLFxuICAgICAgcmVzb3VyY2VzOiBbU3RhY2sub2YodGhpcykuZm9ybWF0QXJuKHtcbiAgICAgICAgc2VydmljZTogJ2VjMicsXG4gICAgICAgIHJlc291cmNlOiAnKicsXG4gICAgICB9KV0sXG4gICAgfSkpO1xuXG4gICAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2lhbTpDcmVhdGVTZXJ2aWNlTGlua2VkUm9sZSddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgJ2lhbTpBV1NTZXJ2aWNlTmFtZSc6ICdzcG90LmFtYXpvbmF3cy5jb20nLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KSk7XG4gIH1cblxuICBzdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1cyB7XG4gICAgc3RhdHVzRnVuY3Rpb25Sb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZWMyOkRlc2NyaWJlTGF1bmNoVGVtcGxhdGVWZXJzaW9ucyddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgbGFiZWxzOiB0aGlzLmxhYmVscyxcbiAgICAgIGNvbnN0cnVjdFBhdGg6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICByb2xlQXJuOiB0aGlzLnJvbGUucm9sZUFybixcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGFtaToge1xuICAgICAgICBsYXVuY2hUZW1wbGF0ZTogdGhpcy5hbWkubGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVJZCB8fCAndW5rbm93bicsXG4gICAgICAgIGFtaUJ1aWxkZXJMb2dHcm91cDogdGhpcy5hbWkubG9nR3JvdXA/LmxvZ0dyb3VwTmFtZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbmV0d29yayBjb25uZWN0aW9ucyBhc3NvY2lhdGVkIHdpdGggdGhpcyByZXNvdXJjZS5cbiAgICovXG4gIHB1YmxpYyBnZXQgY29ubmVjdGlvbnMoKTogZWMyLkNvbm5lY3Rpb25zIHtcbiAgICByZXR1cm4gbmV3IGVjMi5Db25uZWN0aW9ucyh7IHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzIH0pO1xuICB9XG59XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBFYzJSdW5uZXJQcm92aWRlcn1cbiAqL1xuZXhwb3J0IGNsYXNzIEVjMlJ1bm5lciBleHRlbmRzIEVjMlJ1bm5lclByb3ZpZGVyIHtcbn1cblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuY2xhc3MgU2ltcGxlRnJhZ21lbnQgZXh0ZW5kcyBzdGVwZnVuY3Rpb25zLlN0YXRlTWFjaGluZUZyYWdtZW50IHtcbiAgcmVhZG9ubHkgc3RhcnRTdGF0ZTogc3RlcGZ1bmN0aW9ucy5TdGF0ZTtcbiAgcmVhZG9ubHkgZW5kU3RhdGVzOiBzdGVwZnVuY3Rpb25zLklOZXh0YWJsZVtdO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHN0YXJ0OiBzdGVwZnVuY3Rpb25zLlN0YXRlLCBlbmQ6IHN0ZXBmdW5jdGlvbnMuSU5leHRhYmxlKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcbiAgICB0aGlzLnN0YXJ0U3RhdGUgPSBzdGFydDtcbiAgICB0aGlzLmVuZFN0YXRlcyA9IFtlbmRdO1xuICB9XG59XG5cbiJdfQ==