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
exports.Ec2Runner = exports.Ec2RunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const constructs_1 = require("constructs");
const common_1 = require("./common");
const image_builders_1 = require("../image-builders");
const lambda_common_1 = require("../lambda-common");
const utils_1 = require("../utils");
// this script is specifically made so `poweroff` is absolutely always called
// each `{}` is a variable coming from `params` below
const linuxUserDataTemplate = `#!/bin/bash
trap 'sleep 10; poweroff' EXIT # give cloudwatch agent 10 seconds to upload logs and ALWAYS poweroff on any type of exit

set -x -o pipefail

echo -n "{}" > /tmp/task-token # aws cli reads --task-token from here so set -x doesn't log it
chmod 600 /tmp/task-token

logGroupName="{}"
runnerNamePath="{}"
githubDomainPath="{}"
ownerPath="{}"
repoPath="{}"
export ACTIONS_RUNNER_INPUT_JITCONFIG="{}" # run.sh reads --jitconfig from here so set -x doesn't log it
labels="{}"

export AWS_RETRY_MODE=standard # better retry

# resolve the region once at boot, so heartbeats and send-task-* don't depend on IMDS being reachable on every call
# (docker iptables or a transient IMDS failure made every later aws call fail with "You must specify a region")
IMDS_TOKEN=$(curl -s -f -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600" 2>/dev/null) || true
IMDS_REGION=$(curl -s -f -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" "http://169.254.169.254/latest/meta-data/placement/region" 2>/dev/null) || true
if [ -n "$IMDS_REGION" ]; then export AWS_DEFAULT_REGION="$IMDS_REGION"; fi

touch /var/log/runner.log

heartbeat () {
  while true; do
    SPOT_ACTION=$(curl -s -f -H "X-aws-ec2-metadata-token: $(curl -s -f -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 1" 2>/dev/null)" "http://169.254.169.254/latest/meta-data/spot/instance-action" 2>/dev/null) || true
    if [ -n "$SPOT_ACTION" ]; then
      aws stepfunctions send-task-failure --task-token file:///tmp/task-token --error SpotInterrupted --cause "EC2 Spot instance interruption: $SPOT_ACTION" || true
      exit 0
    fi
    aws stepfunctions send-task-heartbeat --task-token file:///tmp/task-token 2>>/var/log/runner.log
    HEARTBEAT_RC=$?
    if [ $HEARTBEAT_RC -ne 0 ]; then
      echo "[$(date -Iseconds)] heartbeat send-task-heartbeat failed (exit $HEARTBEAT_RC)" >>/var/log/runner.log
    fi
    sleep 60
  done
}
setup_logs () {
  cat <<EOF > /tmp/log.conf || return 1
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
            },
            {
              "file_path": "/var/log/workflow.log",
              "log_group_name": "$logGroupName",
              "log_stream_name": "$runnerNamePath-workflow",
              "timezone": "UTC"
            }
          ]
        }
      }
    }
  }
EOF
  /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -s -c file:/tmp/log.conf || return 2
}
action () {
  # Report workflow id for stolen runner detection (to separate log so it doesn't hang this bash function)
  /home/runner/job-reporter.sh "$runnerNamePath" /var/log/workflow.log

  # Execute the run command
  sudo --preserve-env=ACTIONS_RUNNER_INPUT_JITCONFIG,AWS_REGION -Hu runner /home/runner/run.sh || exit 2

  # Retrieve the status
  STATUS=$(grep -Phors "finish job request for job [0-9a-f-]+ with result: .*" /home/runner/_diag/ | tail -n1 | awk '{print $NF}')

  # Check and print the job status
  if [ -n "$STATUS" ]; then
    echo CDKGHA JOB DONE "$labels" "$STATUS"
  fi
}
heartbeat &

setup_logs
setup_logs_status=$?
if [ $setup_logs_status -ne 0 ]; then
  aws stepfunctions send-task-failure --task-token file:///tmp/task-token --error Runner.SetupLogs.$setup_logs_status --cause "Failed to configure CloudWatch agent (exit $setup_logs_status), no runner log was uploaded"
elif action |& tee /var/log/runner.log; then
  aws stepfunctions send-task-success --task-token file:///tmp/task-token --task-output '{"ok": true}' |& tee -a /var/log/runner.log
else
  aws stepfunctions send-task-failure --task-token file:///tmp/task-token --error Runner.Error.$? --cause "Check CloudWatch for full log -- $logGroupName/$runnerNamePath -- $(tail -n 1 /var/log/runner.log)" |& tee -a /var/log/runner.log
fi
`.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\\{\\}/g, '{}');
// this script is specifically made so `poweroff` is absolutely always called
// each `{}` is a variable coming from `params` below and their order should match the linux script
const windowsUserDataTemplate = `<powershell>
$TASK_TOKEN = "{}"
$logGroupName="{}"
$runnerNamePath="{}"
$githubDomainPath="{}"
$ownerPath="{}"
$repoPath="{}"
$jitConfig="{}"
$labels="{}"

$Env:AWS_RETRY_MODE = "standard"  # better retry

# resolve the region once at boot, so aws calls don't depend on IMDS being reachable every time
try {
  $imdsToken = Invoke-RestMethod -Method PUT -Uri "http://169.254.169.254/latest/api/token" -Headers @{"X-aws-ec2-metadata-token-ttl-seconds"="21600"} -TimeoutSec 5
  $Env:AWS_DEFAULT_REGION = Invoke-RestMethod -Uri "http://169.254.169.254/latest/meta-data/placement/region" -Headers @{"X-aws-ec2-metadata-token"=$imdsToken} -TimeoutSec 5
} catch {
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
    aws stepfunctions send-task-heartbeat --task-token "$using:TASK_TOKEN"
    Start-Sleep -Seconds 60
  }
}
function setup_logs () {
  # the runner report can't go in runner.log: run.cmd's Out-File holds that file open for as long as the runner is
  # running, which is exactly when the report is written. one file per stream, so it gets its own stream. the
  # subscription filter is on the log group, so the detector doesn't care.
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
            },
            {
              \`"file_path\`": \`"/actions/workflow.log\`",
              \`"log_group_name\`": \`"$logGroupName\`",
              \`"log_stream_name\`": \`"$runnerNamePath-workflow\`",
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

  & ./job-reporter.ps1 "\${runnerNamePath}" /actions/workflow.log 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log

  ./run.cmd --jitconfig "\${jitConfig}" 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log
  if ($LASTEXITCODE -ne 0) { return 2 }

  $STATUS = Select-String -Path './_diag/*.log' -Pattern 'finish job request for job [0-9a-f\\-]+ with result: (.*)' | %{$_.Matches.Groups[1].Value} | Select-Object -Last 1

  if ($STATUS) {
      echo "CDKGHA JOB DONE \${labels} $STATUS" | Out-File -Encoding ASCII -Append /actions/runner.log
  }

  return 0
}
try {
  setup_logs
  $setupLogsStatus = $LASTEXITCODE
  if ($setupLogsStatus -ne 0) {
    aws stepfunctions send-task-failure --task-token "$TASK_TOKEN" --error Runner.SetupLogs.$setupLogsStatus --cause "Failed to configure CloudWatch agent (exit $setupLogsStatus), no runner log was uploaded"
    return
  }
  $r = action
  if ($r -eq 0) {
    aws stepfunctions send-task-success --task-token "$TASK_TOKEN" --task-output '{ }' 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log
  } else {
    $lastLine = Get-Content -Path C:/actions/runner.log -Tail 1 -ErrorAction SilentlyContinue
    aws stepfunctions send-task-failure --task-token "$TASK_TOKEN" --error Runner.Error.$r --cause "Check CloudWatch for full log -- $logGroupName/$runnerNamePath -- $lastLine" 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log
  }
} finally {
  Start-Sleep -Seconds 10  # give cloudwatch agent its default 5 seconds buffer duration to upload logs
  Stop-Computer -ComputerName localhost -Force
}
</powershell>
`.replace(/\\/g, '\\\\').replace(/{/g, '\\{').replace(/}/g, '\\}').replace(/\\{\\}/g, '{}');
/**
 * GitHub Actions runner provider using EC2 to execute jobs.
 *
 * This construct is not meant to be used by itself. It should be passed in the providers property for GitHubRunners.
 */
class Ec2RunnerProvider extends common_1.BaseProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.Ec2RunnerProvider", version: "0.0.0" };
    /** @internal */
    static _FAMILY = 'ec2';
    /**
     * Big static strings the EC2 fragment reads from `$.config`. We always include both userdata templates because
     * the fragment puts both in a States.Array() and picks one by index at runtime.
     *
     * @internal
     */
    static _stateMachineConstants() {
        return {
            ec2UserDataLinux: linuxUserDataTemplate,
            ec2UserDataWindows: windowsUserDataTemplate,
        };
    }
    /**
     * The fragment that runs any EC2 provider. Reads the config {@link _runnerConfig} generated for it from
     * `$.providerParams`, and launches into whatever subnet is at `$.providerParams.subnet`.
     *
     * Multiple subnets are a chain of fallback configs instead of the chain of states we used to render, see
     * {@link Ec2RunnerProvider._runnerConfig}.
     *
     * @internal
     */
    static _stateMachineFragment(scope) {
        const p = (common_1.providerParam);
        return new aws_cdk_lib_1.aws_stepfunctions.CustomState(scope, 'EC2 Runner', {
            stateJson: {
                Type: 'Task',
                Resource: `arn:${cdk.Aws.PARTITION}:states:::aws-sdk:ec2:runInstances.waitForTaskToken`,
                'HeartbeatSecondsPath': p('heartbeatSeconds'),
                Parameters: {
                    'LaunchTemplate': {
                        'LaunchTemplateId.$': p('launchTemplateId'),
                    },
                    'MinCount': 1,
                    'MaxCount': 1,
                    'InstanceType.$': p('instanceType'),
                    'UserData.$': 'States.Base64Encode(States.Format(' +
                        `States.ArrayGetItem(States.Array($ec2UserDataLinux, $ec2UserDataWindows), ${p('userDataTemplateIdx')}), ` +
                        `$$.Task.Token, ${p('logGroupName')}, ${common_1.RUNNER_INPUT.name}, ${common_1.RUNNER_INPUT.domain}, ${common_1.RUNNER_INPUT.owner}, ${common_1.RUNNER_INPUT.repo}, ` +
                        `${common_1.RUNNER_INPUT.jitConfig}, ${common_1.RUNNER_INPUT.labels}))`,
                    'InstanceInitiatedShutdownBehavior': 'terminate',
                    'IamInstanceProfile': {
                        'Arn.$': p('instanceProfileArn'),
                    },
                    'MetadataOptions': {
                        HttpTokens: 'required',
                    },
                    'SecurityGroupIds.$': p('securityGroupIds'),
                    'SubnetId.$': p('subnet'),
                    'BlockDeviceMappings.$': p('blockDeviceMappings'),
                    'InstanceMarketOptions.$': p('instanceMarketOptions'),
                    // the provider's tags, already merged with the standard runner tags by the orchestrator
                    'TagSpecifications': [
                        { 'ResourceType': 'instance', 'Tags.$': p('tags') },
                        { 'ResourceType': 'volume', 'Tags.$': p('tags') },
                    ],
                },
            },
        });
    }
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
    /**
     * Labels associated with this provider.
     */
    labels;
    /**
     * Grant principal used to add permissions to the runner role.
     */
    grantPrincipal;
    /**
     * Log group where provided runners will save their logs.
     *
     * Note that this is not the job log, but the runner itself. It will not contain output from the GitHub Action but only metadata on its execution.
     */
    logGroup;
    group;
    amiBuilder;
    ami;
    role;
    instanceType;
    storageSize;
    storageOptions;
    spot;
    spotMaxPrice;
    heartbeatTimeout;
    vpc;
    subnets;
    securityGroups;
    defaultLabels;
    tags;
    instanceProfile;
    rootDeviceResource;
    constructor(scope, id, props) {
        super(scope, id, props);
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
        this.tags = props?.tags ?? {};
        // reserved, because cleanup terminates instances by a tag with this prefix
        Object.keys(this.tags).filter(key => key.startsWith(lambda_common_1.ReservedTags.PREFIX)).forEach(tag => {
            cdk.Annotations.of(this).addError(`Tag "${tag}" can't be set: the "${lambda_common_1.ReservedTags.PREFIX}" prefix is reserved.`);
        });
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
        this.instanceProfile = new aws_cdk_lib_1.aws_iam.CfnInstanceProfile(this, 'Instance Profile', {
            roles: [this.role.roleName],
        });
        this.rootDeviceResource = (0, common_1.amiRootDevice)(this, this.ami.launchTemplate.launchTemplateId, this.ami.cacheKey);
        if (constructs_1.Construct.isConstruct(this.amiBuilder)) {
            // if the user didn't create a static image builder and it's a real construct, we need to wait for it
            this.rootDeviceResource.node.addDependency(this.amiBuilder);
        }
    }
    /**
     * @internal
     */
    _grantStateMachine(stateMachineRole) {
        // we use ec2:RunInstances because we must
        // we can't use fleets because they don't let us override user data, security groups or even disk size
        // we can't use requestSpotInstances because it doesn't support launch templates, and it's deprecated
        // ec2:RunInstances also seemed like the only one to immediately return an error when spot capacity is not available
        stateMachineRole.grantPrincipal.addToPrincipalPolicy(new aws_cdk_lib_1.aws_iam.PolicyStatement({
            actions: ['ec2:runInstances'],
            resources: ['*'],
        }));
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
    /**
     * Config for the shared EC2 fragment.
     *
     * ec2:RunInstances can only try one subnet at a time, so every subnet gets a config that falls back to the next
     * one. Same chain we used to render as states.
     *
     * @internal
     */
    _runnerConfig() {
        const base = {
            family: Ec2RunnerProvider._FAMILY,
            provider: this.node.path,
            launchTemplateId: this.ami.launchTemplate.launchTemplateId,
            instanceType: this.instanceType.toString(),
            securityGroupIds: this.securityGroups.map(sg => sg.securityGroupId),
            instanceProfileArn: this.instanceProfile.attrArn,
            logGroupName: this.logGroup.logGroupName,
            // already in the shape ec2:runInstances wants, so the fragment can splice it in as-is
            blockDeviceMappings: [{
                    DeviceName: this.rootDeviceResource.ref,
                    Ebs: {
                        DeleteOnTermination: true,
                        VolumeSize: this.storageSize.toGibibytes(),
                        VolumeType: this.storageOptions?.volumeType,
                        Iops: this.storageOptions?.iops,
                        Throughput: this.storageOptions?.throughput,
                    },
                }],
            // empty and not missing for on-demand
            // the state reads this path no matter what, and a missing reference path fails at runtime
            instanceMarketOptions: this.spot ? {
                MarketType: 'spot',
                SpotOptions: {
                    MaxPrice: this.spotMaxPrice,
                    SpotInstanceType: 'one-time',
                },
            } : {},
            // index into States.Array($ec2UserDataLinux, $ec2UserDataWindows)
            userDataTemplateIdx: this.ami.os.is(common_1.Os.WINDOWS) ? 1 : 0,
            // always here, even when empty, because that's what opts us into the standard runner tags
            // see selectProviderParams() in runner.ts, which merges them in at runtime
            tags: Object.entries(this.tags).map(([Key, Value]) => ({ Key, Value })),
            runnerGroup: this.group ?? '',
            heartbeatSeconds: this.heartbeatTimeout.toSeconds(),
            defaultLabels: (0, common_1.runnerDefaultLabels)(this.ami.os, this.ami.architecture, this.defaultLabels),
        };
        let config = undefined;
        for (let i = this.subnets.length - 1; i >= 0; i--) {
            config = {
                ...base,
                subnet: this.subnets[i].subnetId,
                ...config ? { fallback: config } : {},
            };
        }
        return config;
    }
    /**
     * @internal
     */
    _status(statusFunctionRole) {
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
/**
 * @deprecated use {@link Ec2RunnerProvider}
 */
class Ec2Runner extends Ec2RunnerProvider {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.Ec2Runner", version: "0.0.0" };
}
exports.Ec2Runner = Ec2Runner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWMyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9lYzIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyw2Q0FBeUk7QUFDekksbURBQXFEO0FBQ3JELDJDQUF1QztBQUN2QyxxQ0FnQmtCO0FBQ2xCLHNEQVEyQjtBQUMzQixvREFBZ0Q7QUFDaEQsb0NBQStGO0FBRS9GLDZFQUE2RTtBQUM3RSxxREFBcUQ7QUFDckQsTUFBTSxxQkFBcUIsR0FBRzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Q0ErRjdCLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsQ0FBQztBQUU1Riw2RUFBNkU7QUFDN0UsbUdBQW1HO0FBQ25HLE1BQU0sdUJBQXVCLEdBQUc7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NBcUcvQixDQUFDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsTUFBTSxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFvSzVGOzs7O0dBSUc7QUFDSCxNQUFhLGlCQUFrQixTQUFRLHFCQUFZOztJQUNqRCxnQkFBZ0I7SUFDVCxNQUFNLENBQVUsT0FBTyxHQUFHLEtBQUssQ0FBQztJQUV2Qzs7Ozs7T0FLRztJQUNJLE1BQU0sQ0FBQyxzQkFBc0I7UUFDbEMsT0FBTztZQUNMLGdCQUFnQixFQUFFLHFCQUFxQjtZQUN2QyxrQkFBa0IsRUFBRSx1QkFBdUI7U0FDNUMsQ0FBQztJQUNKLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNJLE1BQU0sQ0FBQyxxQkFBcUIsQ0FBQyxLQUFnQjtRQUNsRCxNQUFNLENBQUMsR0FBRyxDQUFBLHNCQUE4QixDQUFBLENBQUM7UUFDekMsT0FBTyxJQUFJLCtCQUFhLENBQUMsV0FBVyxDQUFDLEtBQUssRUFBRSxZQUFZLEVBQUU7WUFDeEQsU0FBUyxFQUFFO2dCQUNULElBQUksRUFBRSxNQUFNO2dCQUNaLFFBQVEsRUFBRSxPQUFPLEdBQUcsQ0FBQyxHQUFHLENBQUMsU0FBUyxxREFBcUQ7Z0JBQ3ZGLHNCQUFzQixFQUFFLENBQUMsQ0FBQyxrQkFBa0IsQ0FBQztnQkFDN0MsVUFBVSxFQUFFO29CQUNWLGdCQUFnQixFQUFFO3dCQUNoQixvQkFBb0IsRUFBRSxDQUFDLENBQUMsa0JBQWtCLENBQUM7cUJBQzVDO29CQUNELFVBQVUsRUFBRSxDQUFDO29CQUNiLFVBQVUsRUFBRSxDQUFDO29CQUNiLGdCQUFnQixFQUFFLENBQUMsQ0FBQyxjQUFjLENBQUM7b0JBQ25DLFlBQVksRUFBRSxvQ0FBb0M7d0JBQ2hELDZFQUE2RSxDQUFDLENBQUMscUJBQXFCLENBQUMsS0FBSzt3QkFDMUcsa0JBQWtCLENBQUMsQ0FBQyxjQUFjLENBQUMsS0FBSyxxQkFBWSxDQUFDLElBQUksS0FBSyxxQkFBWSxDQUFDLE1BQU0sS0FBSyxxQkFBWSxDQUFDLEtBQUssS0FBSyxxQkFBWSxDQUFDLElBQUksSUFBSTt3QkFDbEksR0FBRyxxQkFBWSxDQUFDLFNBQVMsS0FBSyxxQkFBWSxDQUFDLE1BQU0sSUFBSTtvQkFDdkQsbUNBQW1DLEVBQUUsV0FBVztvQkFDaEQsb0JBQW9CLEVBQUU7d0JBQ3BCLE9BQU8sRUFBRSxDQUFDLENBQUMsb0JBQW9CLENBQUM7cUJBQ2pDO29CQUNELGlCQUFpQixFQUFFO3dCQUNqQixVQUFVLEVBQUUsVUFBVTtxQkFDdkI7b0JBQ0Qsb0JBQW9CLEVBQUUsQ0FBQyxDQUFDLGtCQUFrQixDQUFDO29CQUMzQyxZQUFZLEVBQUUsQ0FBQyxDQUFDLFFBQVEsQ0FBQztvQkFDekIsdUJBQXVCLEVBQUUsQ0FBQyxDQUFDLHFCQUFxQixDQUFDO29CQUNqRCx5QkFBeUIsRUFBRSxDQUFDLENBQUMsdUJBQXVCLENBQUM7b0JBQ3JELHdGQUF3RjtvQkFDeEYsbUJBQW1CLEVBQUU7d0JBQ25CLEVBQUUsY0FBYyxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxFQUFFO3dCQUNuRCxFQUFFLGNBQWMsRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsRUFBRTtxQkFDbEQ7aUJBQ0Y7YUFDRjtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7O09Ba0JHO0lBQ0ksTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUErQjtRQUN0RixPQUFPLG1DQUFrQixDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQ3ZDLEVBQUUsRUFBRSxXQUFFLENBQUMsWUFBWTtZQUNuQixZQUFZLEVBQUUscUJBQVksQ0FBQyxNQUFNO1lBQ2pDLFdBQVcsRUFBRSx1Q0FBc0IsQ0FBQyxpQkFBaUI7WUFDckQsVUFBVSxFQUFFO2dCQUNWLHFDQUFvQixDQUFDLGdCQUFnQixFQUFFO2dCQUN2QyxxQ0FBb0IsQ0FBQyxlQUFlLEVBQUU7Z0JBQ3RDLHFDQUFvQixDQUFDLFVBQVUsRUFBRTtnQkFDakMscUNBQW9CLENBQUMsR0FBRyxFQUFFO2dCQUMxQixxQ0FBb0IsQ0FBQyxTQUFTLEVBQUU7Z0JBQ2hDLHFDQUFvQixDQUFDLE1BQU0sRUFBRTtnQkFDN0IscUNBQW9CLENBQUMsTUFBTSxFQUFFO2dCQUM3QixxQ0FBb0IsQ0FBQyxZQUFZLENBQUMsS0FBSyxFQUFFLGFBQWEsSUFBSSxzQkFBYSxDQUFDLE1BQU0sRUFBRSxDQUFDO2FBQ2xGO1lBQ0QsR0FBRyxLQUFLO1NBQ1QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVEOztPQUVHO0lBQ00sTUFBTSxDQUFXO0lBRTFCOztPQUVHO0lBQ00sY0FBYyxDQUFpQjtJQUV4Qzs7OztPQUlHO0lBQ00sUUFBUSxDQUFpQjtJQUVqQixLQUFLLENBQVU7SUFDZixVQUFVLENBQXNCO0lBQ2hDLEdBQUcsQ0FBWTtJQUNmLElBQUksQ0FBVztJQUNmLFlBQVksQ0FBbUI7SUFDL0IsV0FBVyxDQUFXO0lBQ3RCLGNBQWMsQ0FBa0I7SUFDaEMsSUFBSSxDQUFVO0lBQ2QsWUFBWSxDQUFxQjtJQUNqQyxnQkFBZ0IsQ0FBZTtJQUMvQixHQUFHLENBQVc7SUFDZCxPQUFPLENBQWdCO0lBQ3ZCLGNBQWMsQ0FBdUI7SUFDckMsYUFBYSxDQUFVO0lBQ3ZCLElBQUksQ0FBNEI7SUFDaEMsZUFBZSxDQUF5QjtJQUN4QyxrQkFBa0IsQ0FBcUI7SUFFeEQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE4QjtRQUN0RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixJQUFJLENBQUMsTUFBTSxHQUFHLEtBQUssRUFBRSxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN2QyxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssRUFBRSxLQUFLLENBQUM7UUFDMUIsSUFBSSxDQUFDLEdBQUcsR0FBRyxLQUFLLEVBQUUsR0FBRyxJQUFJLHFCQUFHLENBQUMsR0FBRyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDdEYsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsY0FBYyxJQUFJLENBQUMsSUFBSSxxQkFBRyxDQUFDLGFBQWEsQ0FBQyxJQUFJLEVBQUUsSUFBSSxFQUFFLEVBQUUsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN2SixJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssRUFBRSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxLQUFLLEVBQUUsZUFBZSxDQUFDLENBQUMsT0FBTyxDQUFDO1FBQ3ZHLElBQUksQ0FBQyxZQUFZLEdBQUcsS0FBSyxFQUFFLFlBQVksSUFBSSxxQkFBRyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMscUJBQUcsQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLHFCQUFHLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzlHLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSyxFQUFFLFdBQVcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLGdDQUFnQztRQUNqRyxJQUFJLENBQUMsY0FBYyxHQUFHLEtBQUssRUFBRSxjQUFjLENBQUM7UUFDNUMsSUFBSSxDQUFDLElBQUksR0FBRyxLQUFLLEVBQUUsSUFBSSxJQUFJLEtBQUssQ0FBQztRQUNqQyxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssRUFBRSxZQUFZLENBQUM7UUFDeEMsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEtBQUssRUFBRSxnQkFBZ0IsSUFBSSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsQ0FBQztRQUM1RSxJQUFJLENBQUMsYUFBYSxHQUFHLEtBQUssRUFBRSxhQUFhLElBQUksSUFBSSxDQUFDO1FBQ2xELElBQUksQ0FBQyxJQUFJLEdBQUcsS0FBSyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUM7UUFFOUIsMkVBQTJFO1FBQzNFLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxVQUFVLENBQUMsNEJBQVksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsRUFBRTtZQUN0RixHQUFHLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQy9CLFFBQVEsR0FBRyx3QkFBd0IsNEJBQVksQ0FBQyxNQUFNLHVCQUF1QixDQUM5RSxDQUFDO1FBQ0osQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzlCLEdBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxDQUFDLFFBQVEsQ0FBQyxpQ0FBaUMsQ0FBQyxDQUFDO1FBQ3ZFLENBQUM7UUFFRCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksS0FBSyxxQkFBRyxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMscUJBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLHFCQUFZLENBQUMsTUFBTSxDQUFDO1FBRTNILElBQUksQ0FBQyxVQUFVLEdBQUcsS0FBSyxFQUFFLFlBQVksSUFBSSxLQUFLLEVBQUUsVUFBVSxJQUFJLGlCQUFpQixDQUFDLFlBQVksQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ2hILEdBQUcsRUFBRSxLQUFLLEVBQUUsR0FBRztZQUNmLGVBQWUsRUFBRSxLQUFLLEVBQUUsZUFBZTtZQUN2QyxjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWM7WUFDbkMsT0FBTyxFQUFFLElBQUEseUJBQWlCLEVBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsQ0FBQywwQkFBUyxDQUFDLFdBQVcsQ0FBQyxXQUFFLENBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO1lBQ3hHLFlBQVksRUFBRSxJQUFJO1lBQ2xCLHNCQUFzQixFQUFFO2dCQUN0QixZQUFZLEVBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBQyxxQkFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxxQkFBRyxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUMscUJBQUcsQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLHFCQUFHLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxTQUFTO2FBQzNIO1NBQ0YsQ0FBQyxDQUFDO1FBQ0gsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBRXJDLElBQUksSUFBSSxDQUFDLFVBQVUsWUFBWSxrREFBaUMsRUFBRSxDQUFDO1lBQ2pFLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDO2dCQUN0RyxHQUFHLENBQUMsV0FBVyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsQ0FBQyxRQUFRLENBQUMsd0JBQXdCLElBQUksQ0FBQyxXQUFXLENBQUMsV0FBVyxFQUFFLHNFQUFzRSxJQUFJLENBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQyxXQUFXLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDbE4sQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUMsaUJBQWlCLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxFQUFFLENBQUM7WUFDaEUsR0FBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsUUFBUSxDQUFDLHFCQUFxQixJQUFJLENBQUMsR0FBRyxDQUFDLFlBQVksQ0FBQyxJQUFJLHlDQUF5QyxJQUFJLENBQUMsWUFBWSxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxHQUFHLENBQUMsQ0FBQztRQUN0TCxDQUFDO1FBRUQsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUkscUJBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLE1BQU0sRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxxQkFBRyxDQUFDLGdCQUFnQixDQUFDLG1CQUFtQixDQUFDO1NBQ3pELENBQUMsQ0FBQztRQUNILElBQUksQ0FBQyxjQUFjLENBQUMsb0JBQW9CLENBQUMsSUFBSSxxQkFBRyxDQUFDLGVBQWUsQ0FBQztZQUMvRCxPQUFPLEVBQUUsQ0FBQyx3QkFBd0IsRUFBRSx3QkFBd0IsRUFBRSwwQkFBMEIsQ0FBQztZQUN6RixTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSwySEFBMkg7U0FDOUksQ0FBQyxDQUFDLENBQUM7UUFDSixJQUFJLENBQUMsY0FBYyxDQUFDLG9CQUFvQixDQUFDLHdEQUFnRCxDQUFDLENBQUM7UUFFM0YsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLHNCQUFJLENBQUMsUUFBUSxDQUMvQixJQUFJLEVBQ0osTUFBTSxFQUNOO1lBQ0UsU0FBUyxFQUFFLEtBQUssRUFBRSxZQUFZLElBQUksd0JBQWEsQ0FBQyxTQUFTO1lBQ3pELGFBQWEsRUFBRSwyQkFBYSxDQUFDLE9BQU87U0FDckMsQ0FDRixDQUFDO1FBQ0YsSUFBSSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFL0IsSUFBSSxDQUFDLGVBQWUsR0FBRyxJQUFJLHFCQUFHLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFO1lBQzFFLEtBQUssRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO1NBQzVCLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFBLHNCQUFhLEVBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLGdCQUFnQixFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDM0csSUFBSSxzQkFBUyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQztZQUMzQyxxR0FBcUc7WUFDckcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzlELENBQUM7SUFDSCxDQUFDO0lBRUQ7O09BRUc7SUFDSCxrQkFBa0IsQ0FBQyxnQkFBZ0M7UUFDakQsMENBQTBDO1FBQzFDLHNHQUFzRztRQUN0RyxxR0FBcUc7UUFDckcsb0hBQW9IO1FBQ3BILGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLHFCQUFHLENBQUMsZUFBZSxDQUFDO1lBQzNFLE9BQU8sRUFBRSxDQUFDLGtCQUFrQixDQUFDO1lBQzdCLFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztTQUNqQixDQUFDLENBQUMsQ0FBQztRQUVKLGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLHFCQUFHLENBQUMsZUFBZSxDQUFDO1lBQzNFLE9BQU8sRUFBRSxDQUFDLGNBQWMsQ0FBQztZQUN6QixTQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQztZQUM5QixVQUFVLEVBQUU7Z0JBQ1YsWUFBWSxFQUFFO29CQUNaLHFCQUFxQixFQUFFLG1CQUFtQjtpQkFDM0M7YUFDRjtTQUNGLENBQUMsQ0FBQyxDQUFDO1FBRUosZ0JBQWdCLENBQUMsY0FBYyxDQUFDLG9CQUFvQixDQUFDLElBQUkscUJBQUcsQ0FBQyxlQUFlLENBQUM7WUFDM0UsT0FBTyxFQUFFLENBQUMsZ0JBQWdCLENBQUM7WUFDM0IsU0FBUyxFQUFFLENBQUMsbUJBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsU0FBUyxDQUFDO29CQUNuQyxPQUFPLEVBQUUsS0FBSztvQkFDZCxRQUFRLEVBQUUsR0FBRztpQkFDZCxDQUFDLENBQUM7U0FDSixDQUFDLENBQUMsQ0FBQztRQUVKLGdCQUFnQixDQUFDLGNBQWMsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLHFCQUFHLENBQUMsZUFBZSxDQUFDO1lBQzNFLE9BQU8sRUFBRSxDQUFDLDZCQUE2QixDQUFDO1lBQ3hDLFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztZQUNoQixVQUFVLEVBQUU7Z0JBQ1YsWUFBWSxFQUFFO29CQUNaLG9CQUFvQixFQUFFLG9CQUFvQjtpQkFDM0M7YUFDRjtTQUNGLENBQUMsQ0FBQyxDQUFDO0lBQ04sQ0FBQztJQUVEOzs7Ozs7O09BT0c7SUFDSCxhQUFhO1FBQ1gsTUFBTSxJQUFJLEdBQUc7WUFDWCxNQUFNLEVBQUUsaUJBQWlCLENBQUMsT0FBTztZQUNqQyxRQUFRLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJO1lBQ3hCLGdCQUFnQixFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLGdCQUFnQjtZQUMxRCxZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVksQ0FBQyxRQUFRLEVBQUU7WUFDMUMsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsZUFBZSxDQUFDO1lBQ25FLGtCQUFrQixFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsT0FBTztZQUNoRCxZQUFZLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZO1lBQ3hDLHNGQUFzRjtZQUN0RixtQkFBbUIsRUFBRSxDQUFDO29CQUNwQixVQUFVLEVBQUUsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUc7b0JBQ3ZDLEdBQUcsRUFBRTt3QkFDSCxtQkFBbUIsRUFBRSxJQUFJO3dCQUN6QixVQUFVLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxXQUFXLEVBQUU7d0JBQzFDLFVBQVUsRUFBRSxJQUFJLENBQUMsY0FBYyxFQUFFLFVBQVU7d0JBQzNDLElBQUksRUFBRSxJQUFJLENBQUMsY0FBYyxFQUFFLElBQUk7d0JBQy9CLFVBQVUsRUFBRSxJQUFJLENBQUMsY0FBYyxFQUFFLFVBQVU7cUJBQzVDO2lCQUNGLENBQUM7WUFDRixzQ0FBc0M7WUFDdEMsMEZBQTBGO1lBQzFGLHFCQUFxQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO2dCQUNqQyxVQUFVLEVBQUUsTUFBTTtnQkFDbEIsV0FBVyxFQUFFO29CQUNYLFFBQVEsRUFBRSxJQUFJLENBQUMsWUFBWTtvQkFDM0IsZ0JBQWdCLEVBQUUsVUFBVTtpQkFDN0I7YUFDRixDQUFDLENBQUMsQ0FBQyxFQUFFO1lBQ04sa0VBQWtFO1lBQ2xFLG1CQUFtQixFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxXQUFFLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN2RCwwRkFBMEY7WUFDMUYsMkVBQTJFO1lBQzNFLElBQUksRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ3ZFLFdBQVcsRUFBRSxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUU7WUFDN0IsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLGdCQUFnQixDQUFDLFNBQVMsRUFBRTtZQUNuRCxhQUFhLEVBQUUsSUFBQSw0QkFBbUIsRUFBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLFlBQVksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDO1NBQzNGLENBQUM7UUFFRixJQUFJLE1BQU0sR0FBUSxTQUFTLENBQUM7UUFDNUIsS0FBSyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ2xELE1BQU0sR0FBRztnQkFDUCxHQUFHLElBQUk7Z0JBQ1AsTUFBTSxFQUFFLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsUUFBUTtnQkFDaEMsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFO2FBQ3RDLENBQUM7UUFDSixDQUFDO1FBQ0QsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsT0FBTyxDQUFDLGtCQUFrQztRQUN4QyxrQkFBa0IsQ0FBQyxjQUFjLENBQUMsb0JBQW9CLENBQUMsSUFBSSxxQkFBRyxDQUFDLGVBQWUsQ0FBQztZQUM3RSxPQUFPLEVBQUUsQ0FBQyxvQ0FBb0MsQ0FBQztZQUMvQyxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUFDLENBQUM7UUFFSixPQUFPO1lBQ0wsSUFBSSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSTtZQUMzQixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU07WUFDbkIsYUFBYSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSTtZQUM3QixjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsZUFBZSxDQUFDO1lBQ2pFLE9BQU8sRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU87WUFDMUIsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsWUFBWTtZQUNwQyxHQUFHLEVBQUU7Z0JBQ0gsY0FBYyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLGdCQUFnQixJQUFJLFNBQVM7Z0JBQ3JFLGtCQUFrQixFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxFQUFFLFlBQVk7YUFDcEQ7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVEOztPQUVHO0lBQ0gsSUFBVyxXQUFXO1FBQ3BCLE9BQU8sSUFBSSxxQkFBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLGNBQWMsRUFBRSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQztJQUN0RSxDQUFDOztBQTVWSCw4Q0E2VkM7QUFFRDs7R0FFRztBQUNILE1BQWEsU0FBVSxTQUFRLGlCQUFpQjs7O0FBQWhELDhCQUNDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IGF3c19lYzIgYXMgZWMyLCBhd3NfaWFtIGFzIGlhbSwgYXdzX2xvZ3MgYXMgbG9ncywgYXdzX3N0ZXBmdW5jdGlvbnMgYXMgc3RlcGZ1bmN0aW9ucywgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBSZXRlbnRpb25EYXlzIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQge1xuICBhbWlSb290RGV2aWNlLFxuICBBcmNoaXRlY3R1cmUsXG4gIEJhc2VQcm92aWRlcixcbiAgSVBhcmFtZXRlcml6ZWRSdW5uZXJQcm92aWRlcixcbiAgSVJ1bm5lclByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXJTdGF0dXMsXG4gIE9zLFxuICBwcm92aWRlclBhcmFtLFxuICBSVU5ORVJfSU5QVVQsXG4gIFJ1bm5lckFtaSxcbiAgUnVubmVyQ29uZmlnLFxuICBydW5uZXJEZWZhdWx0TGFiZWxzLFxuICBSdW5uZXJQcm92aWRlclByb3BzLFxuICBSdW5uZXJWZXJzaW9uLFxuICBTdG9yYWdlT3B0aW9ucyxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHtcbiAgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyLFxuICBCYXNlSW1hZ2UsXG4gIElSdW5uZXJJbWFnZUJ1aWxkZXIsXG4gIFJ1bm5lckltYWdlQnVpbGRlcixcbiAgUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMsXG4gIFJ1bm5lckltYWdlQnVpbGRlclR5cGUsXG4gIFJ1bm5lckltYWdlQ29tcG9uZW50LFxufSBmcm9tICcuLi9pbWFnZS1idWlsZGVycyc7XG5pbXBvcnQgeyBSZXNlcnZlZFRhZ3MgfSBmcm9tICcuLi9sYW1iZGEtY29tbW9uJztcbmltcG9ydCB7IGlzR3B1SW5zdGFuY2VUeXBlLCBNSU5JTUFMX0VDMl9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQgfSBmcm9tICcuLi91dGlscyc7XG5cbi8vIHRoaXMgc2NyaXB0IGlzIHNwZWNpZmljYWxseSBtYWRlIHNvIGBwb3dlcm9mZmAgaXMgYWJzb2x1dGVseSBhbHdheXMgY2FsbGVkXG4vLyBlYWNoIGB7fWAgaXMgYSB2YXJpYWJsZSBjb21pbmcgZnJvbSBgcGFyYW1zYCBiZWxvd1xuY29uc3QgbGludXhVc2VyRGF0YVRlbXBsYXRlID0gYCMhL2Jpbi9iYXNoXG50cmFwICdzbGVlcCAxMDsgcG93ZXJvZmYnIEVYSVQgIyBnaXZlIGNsb3Vkd2F0Y2ggYWdlbnQgMTAgc2Vjb25kcyB0byB1cGxvYWQgbG9ncyBhbmQgQUxXQVlTIHBvd2Vyb2ZmIG9uIGFueSB0eXBlIG9mIGV4aXRcblxuc2V0IC14IC1vIHBpcGVmYWlsXG5cbmVjaG8gLW4gXCJ7fVwiID4gL3RtcC90YXNrLXRva2VuICMgYXdzIGNsaSByZWFkcyAtLXRhc2stdG9rZW4gZnJvbSBoZXJlIHNvIHNldCAteCBkb2Vzbid0IGxvZyBpdFxuY2htb2QgNjAwIC90bXAvdGFzay10b2tlblxuXG5sb2dHcm91cE5hbWU9XCJ7fVwiXG5ydW5uZXJOYW1lUGF0aD1cInt9XCJcbmdpdGh1YkRvbWFpblBhdGg9XCJ7fVwiXG5vd25lclBhdGg9XCJ7fVwiXG5yZXBvUGF0aD1cInt9XCJcbmV4cG9ydCBBQ1RJT05TX1JVTk5FUl9JTlBVVF9KSVRDT05GSUc9XCJ7fVwiICMgcnVuLnNoIHJlYWRzIC0taml0Y29uZmlnIGZyb20gaGVyZSBzbyBzZXQgLXggZG9lc24ndCBsb2cgaXRcbmxhYmVscz1cInt9XCJcblxuZXhwb3J0IEFXU19SRVRSWV9NT0RFPXN0YW5kYXJkICMgYmV0dGVyIHJldHJ5XG5cbiMgcmVzb2x2ZSB0aGUgcmVnaW9uIG9uY2UgYXQgYm9vdCwgc28gaGVhcnRiZWF0cyBhbmQgc2VuZC10YXNrLSogZG9uJ3QgZGVwZW5kIG9uIElNRFMgYmVpbmcgcmVhY2hhYmxlIG9uIGV2ZXJ5IGNhbGxcbiMgKGRvY2tlciBpcHRhYmxlcyBvciBhIHRyYW5zaWVudCBJTURTIGZhaWx1cmUgbWFkZSBldmVyeSBsYXRlciBhd3MgY2FsbCBmYWlsIHdpdGggXCJZb3UgbXVzdCBzcGVjaWZ5IGEgcmVnaW9uXCIpXG5JTURTX1RPS0VOPSQoY3VybCAtcyAtZiAtWCBQVVQgXCJodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9hcGkvdG9rZW5cIiAtSCBcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlbi10dGwtc2Vjb25kczogMjE2MDBcIiAyPi9kZXYvbnVsbCkgfHwgdHJ1ZVxuSU1EU19SRUdJT049JChjdXJsIC1zIC1mIC1IIFwiWC1hd3MtZWMyLW1ldGFkYXRhLXRva2VuOiAkSU1EU19UT0tFTlwiIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvbWV0YS1kYXRhL3BsYWNlbWVudC9yZWdpb25cIiAyPi9kZXYvbnVsbCkgfHwgdHJ1ZVxuaWYgWyAtbiBcIiRJTURTX1JFR0lPTlwiIF07IHRoZW4gZXhwb3J0IEFXU19ERUZBVUxUX1JFR0lPTj1cIiRJTURTX1JFR0lPTlwiOyBmaVxuXG50b3VjaCAvdmFyL2xvZy9ydW5uZXIubG9nXG5cbmhlYXJ0YmVhdCAoKSB7XG4gIHdoaWxlIHRydWU7IGRvXG4gICAgU1BPVF9BQ1RJT049JChjdXJsIC1zIC1mIC1IIFwiWC1hd3MtZWMyLW1ldGFkYXRhLXRva2VuOiAkKGN1cmwgLXMgLWYgLVggUFVUIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvYXBpL3Rva2VuXCIgLUggXCJYLWF3cy1lYzItbWV0YWRhdGEtdG9rZW4tdHRsLXNlY29uZHM6IDFcIiAyPi9kZXYvbnVsbClcIiBcImh0dHA6Ly8xNjkuMjU0LjE2OS4yNTQvbGF0ZXN0L21ldGEtZGF0YS9zcG90L2luc3RhbmNlLWFjdGlvblwiIDI+L2Rldi9udWxsKSB8fCB0cnVlXG4gICAgaWYgWyAtbiBcIiRTUE9UX0FDVElPTlwiIF07IHRoZW5cbiAgICAgIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1mYWlsdXJlIC0tdGFzay10b2tlbiBmaWxlOi8vL3RtcC90YXNrLXRva2VuIC0tZXJyb3IgU3BvdEludGVycnVwdGVkIC0tY2F1c2UgXCJFQzIgU3BvdCBpbnN0YW5jZSBpbnRlcnJ1cHRpb246ICRTUE9UX0FDVElPTlwiIHx8IHRydWVcbiAgICAgIGV4aXQgMFxuICAgIGZpXG4gICAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLWhlYXJ0YmVhdCAtLXRhc2stdG9rZW4gZmlsZTovLy90bXAvdGFzay10b2tlbiAyPj4vdmFyL2xvZy9ydW5uZXIubG9nXG4gICAgSEVBUlRCRUFUX1JDPSQ/XG4gICAgaWYgWyAkSEVBUlRCRUFUX1JDIC1uZSAwIF07IHRoZW5cbiAgICAgIGVjaG8gXCJbJChkYXRlIC1Jc2Vjb25kcyldIGhlYXJ0YmVhdCBzZW5kLXRhc2staGVhcnRiZWF0IGZhaWxlZCAoZXhpdCAkSEVBUlRCRUFUX1JDKVwiID4+L3Zhci9sb2cvcnVubmVyLmxvZ1xuICAgIGZpXG4gICAgc2xlZXAgNjBcbiAgZG9uZVxufVxuc2V0dXBfbG9ncyAoKSB7XG4gIGNhdCA8PEVPRiA+IC90bXAvbG9nLmNvbmYgfHwgcmV0dXJuIDFcbiAge1xuICAgIFwibG9nc1wiOiB7XG4gICAgICBcImxvZ19zdHJlYW1fbmFtZVwiOiBcInVua25vd25cIixcbiAgICAgIFwibG9nc19jb2xsZWN0ZWRcIjoge1xuICAgICAgICBcImZpbGVzXCI6IHtcbiAgICAgICAgICBcImNvbGxlY3RfbGlzdFwiOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIFwiZmlsZV9wYXRoXCI6IFwiL3Zhci9sb2cvcnVubmVyLmxvZ1wiLFxuICAgICAgICAgICAgICBcImxvZ19ncm91cF9uYW1lXCI6IFwiJGxvZ0dyb3VwTmFtZVwiLFxuICAgICAgICAgICAgICBcImxvZ19zdHJlYW1fbmFtZVwiOiBcIiRydW5uZXJOYW1lUGF0aFwiLFxuICAgICAgICAgICAgICBcInRpbWV6b25lXCI6IFwiVVRDXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIFwiZmlsZV9wYXRoXCI6IFwiL3Zhci9sb2cvd29ya2Zsb3cubG9nXCIsXG4gICAgICAgICAgICAgIFwibG9nX2dyb3VwX25hbWVcIjogXCIkbG9nR3JvdXBOYW1lXCIsXG4gICAgICAgICAgICAgIFwibG9nX3N0cmVhbV9uYW1lXCI6IFwiJHJ1bm5lck5hbWVQYXRoLXdvcmtmbG93XCIsXG4gICAgICAgICAgICAgIFwidGltZXpvbmVcIjogXCJVVENcIlxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuRU9GXG4gIC9vcHQvYXdzL2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50L2Jpbi9hbWF6b24tY2xvdWR3YXRjaC1hZ2VudC1jdGwgLWEgZmV0Y2gtY29uZmlnIC1tIGVjMiAtcyAtYyBmaWxlOi90bXAvbG9nLmNvbmYgfHwgcmV0dXJuIDJcbn1cbmFjdGlvbiAoKSB7XG4gICMgUmVwb3J0IHdvcmtmbG93IGlkIGZvciBzdG9sZW4gcnVubmVyIGRldGVjdGlvbiAodG8gc2VwYXJhdGUgbG9nIHNvIGl0IGRvZXNuJ3QgaGFuZyB0aGlzIGJhc2ggZnVuY3Rpb24pXG4gIC9ob21lL3J1bm5lci9qb2ItcmVwb3J0ZXIuc2ggXCIkcnVubmVyTmFtZVBhdGhcIiAvdmFyL2xvZy93b3JrZmxvdy5sb2dcblxuICAjIEV4ZWN1dGUgdGhlIHJ1biBjb21tYW5kXG4gIHN1ZG8gLS1wcmVzZXJ2ZS1lbnY9QUNUSU9OU19SVU5ORVJfSU5QVVRfSklUQ09ORklHLEFXU19SRUdJT04gLUh1IHJ1bm5lciAvaG9tZS9ydW5uZXIvcnVuLnNoIHx8IGV4aXQgMlxuXG4gICMgUmV0cmlldmUgdGhlIHN0YXR1c1xuICBTVEFUVVM9JChncmVwIC1QaG9ycyBcImZpbmlzaCBqb2IgcmVxdWVzdCBmb3Igam9iIFswLTlhLWYtXSsgd2l0aCByZXN1bHQ6IC4qXCIgL2hvbWUvcnVubmVyL19kaWFnLyB8IHRhaWwgLW4xIHwgYXdrICd7cHJpbnQgJE5GfScpXG5cbiAgIyBDaGVjayBhbmQgcHJpbnQgdGhlIGpvYiBzdGF0dXNcbiAgaWYgWyAtbiBcIiRTVEFUVVNcIiBdOyB0aGVuXG4gICAgZWNobyBDREtHSEEgSk9CIERPTkUgXCIkbGFiZWxzXCIgXCIkU1RBVFVTXCJcbiAgZmlcbn1cbmhlYXJ0YmVhdCAmXG5cbnNldHVwX2xvZ3NcbnNldHVwX2xvZ3Nfc3RhdHVzPSQ/XG5pZiBbICRzZXR1cF9sb2dzX3N0YXR1cyAtbmUgMCBdOyB0aGVuXG4gIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1mYWlsdXJlIC0tdGFzay10b2tlbiBmaWxlOi8vL3RtcC90YXNrLXRva2VuIC0tZXJyb3IgUnVubmVyLlNldHVwTG9ncy4kc2V0dXBfbG9nc19zdGF0dXMgLS1jYXVzZSBcIkZhaWxlZCB0byBjb25maWd1cmUgQ2xvdWRXYXRjaCBhZ2VudCAoZXhpdCAkc2V0dXBfbG9nc19zdGF0dXMpLCBubyBydW5uZXIgbG9nIHdhcyB1cGxvYWRlZFwiXG5lbGlmIGFjdGlvbiB8JiB0ZWUgL3Zhci9sb2cvcnVubmVyLmxvZzsgdGhlblxuICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2stc3VjY2VzcyAtLXRhc2stdG9rZW4gZmlsZTovLy90bXAvdGFzay10b2tlbiAtLXRhc2stb3V0cHV0ICd7XCJva1wiOiB0cnVlfScgfCYgdGVlIC1hIC92YXIvbG9nL3J1bm5lci5sb2dcbmVsc2VcbiAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLWZhaWx1cmUgLS10YXNrLXRva2VuIGZpbGU6Ly8vdG1wL3Rhc2stdG9rZW4gLS1lcnJvciBSdW5uZXIuRXJyb3IuJD8gLS1jYXVzZSBcIkNoZWNrIENsb3VkV2F0Y2ggZm9yIGZ1bGwgbG9nIC0tICRsb2dHcm91cE5hbWUvJHJ1bm5lck5hbWVQYXRoIC0tICQodGFpbCAtbiAxIC92YXIvbG9nL3J1bm5lci5sb2cpXCIgfCYgdGVlIC1hIC92YXIvbG9nL3J1bm5lci5sb2dcbmZpXG5gLnJlcGxhY2UoL1xcXFwvZywgJ1xcXFxcXFxcJykucmVwbGFjZSgvey9nLCAnXFxcXHsnKS5yZXBsYWNlKC99L2csICdcXFxcfScpLnJlcGxhY2UoL1xcXFx7XFxcXH0vZywgJ3t9Jyk7XG5cbi8vIHRoaXMgc2NyaXB0IGlzIHNwZWNpZmljYWxseSBtYWRlIHNvIGBwb3dlcm9mZmAgaXMgYWJzb2x1dGVseSBhbHdheXMgY2FsbGVkXG4vLyBlYWNoIGB7fWAgaXMgYSB2YXJpYWJsZSBjb21pbmcgZnJvbSBgcGFyYW1zYCBiZWxvdyBhbmQgdGhlaXIgb3JkZXIgc2hvdWxkIG1hdGNoIHRoZSBsaW51eCBzY3JpcHRcbmNvbnN0IHdpbmRvd3NVc2VyRGF0YVRlbXBsYXRlID0gYDxwb3dlcnNoZWxsPlxuJFRBU0tfVE9LRU4gPSBcInt9XCJcbiRsb2dHcm91cE5hbWU9XCJ7fVwiXG4kcnVubmVyTmFtZVBhdGg9XCJ7fVwiXG4kZ2l0aHViRG9tYWluUGF0aD1cInt9XCJcbiRvd25lclBhdGg9XCJ7fVwiXG4kcmVwb1BhdGg9XCJ7fVwiXG4kaml0Q29uZmlnPVwie31cIlxuJGxhYmVscz1cInt9XCJcblxuJEVudjpBV1NfUkVUUllfTU9ERSA9IFwic3RhbmRhcmRcIiAgIyBiZXR0ZXIgcmV0cnlcblxuIyByZXNvbHZlIHRoZSByZWdpb24gb25jZSBhdCBib290LCBzbyBhd3MgY2FsbHMgZG9uJ3QgZGVwZW5kIG9uIElNRFMgYmVpbmcgcmVhY2hhYmxlIGV2ZXJ5IHRpbWVcbnRyeSB7XG4gICRpbWRzVG9rZW4gPSBJbnZva2UtUmVzdE1ldGhvZCAtTWV0aG9kIFBVVCAtVXJpIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvYXBpL3Rva2VuXCIgLUhlYWRlcnMgQHtcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlbi10dGwtc2Vjb25kc1wiPVwiMjE2MDBcIn0gLVRpbWVvdXRTZWMgNVxuICAkRW52OkFXU19ERUZBVUxUX1JFR0lPTiA9IEludm9rZS1SZXN0TWV0aG9kIC1VcmkgXCJodHRwOi8vMTY5LjI1NC4xNjkuMjU0L2xhdGVzdC9tZXRhLWRhdGEvcGxhY2VtZW50L3JlZ2lvblwiIC1IZWFkZXJzIEB7XCJYLWF3cy1lYzItbWV0YWRhdGEtdG9rZW5cIj0kaW1kc1Rva2VufSAtVGltZW91dFNlYyA1XG59IGNhdGNoIHtcbn1cblxuIyBFQzJMYXVuY2ggb25seSBzdGFydHMgc3NtIGFnZW50IGFmdGVyIHVzZXIgZGF0YSBpcyBkb25lLCBzbyB3ZSBuZWVkIHRvIHN0YXJ0IGl0IG91cnNlbHZlcyAoaXQgaXMgZGlzYWJsZWQgYnkgZGVmYXVsdClcblNldC1TZXJ2aWNlIC1TdGFydHVwVHlwZSBNYW51YWwgQW1hem9uU1NNQWdlbnRcblN0YXJ0LVNlcnZpY2UgQW1hem9uU1NNQWdlbnRcblxuJEhlYXJ0YmVhdFBhcmVudFBpZCA9ICRQSURcblN0YXJ0LUpvYiAtU2NyaXB0QmxvY2sge1xuICB3aGlsZSAoJHRydWUpIHtcbiAgICB0cnkge1xuICAgICAgJHNwb3QgPSBJbnZva2UtUmVzdE1ldGhvZCAtVXJpIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvbWV0YS1kYXRhL3Nwb3QvaW5zdGFuY2UtYWN0aW9uXCIgLUhlYWRlcnMgQHtcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlblwiPShJbnZva2UtUmVzdE1ldGhvZCAtTWV0aG9kIFBVVCAtVXJpIFwiaHR0cDovLzE2OS4yNTQuMTY5LjI1NC9sYXRlc3QvYXBpL3Rva2VuXCIgLUhlYWRlcnMgQHtcIlgtYXdzLWVjMi1tZXRhZGF0YS10b2tlbi10dGwtc2Vjb25kc1wiPVwiMVwifSAtVGltZW91dFNlYyAyKX0gLVRpbWVvdXRTZWMgMlxuICAgICAgJHNwb3RKc29uID0gaWYgKCRzcG90IC1pcyBbc3RyaW5nXSkgeyAkc3BvdCB9IGVsc2UgeyAkc3BvdCB8IENvbnZlcnRUby1Kc29uIC1Db21wcmVzcyB9XG4gICAgICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2stZmFpbHVyZSAtLXRhc2stdG9rZW4gXCIkdXNpbmc6VEFTS19UT0tFTlwiIC0tZXJyb3IgU3BvdEludGVycnVwdGVkIC0tY2F1c2UgXCJFQzIgU3BvdCBpbnN0YW5jZSBpbnRlcnJ1cHRpb246ICRzcG90SnNvblwiXG4gICAgICBicmVha1xuICAgIH0gY2F0Y2gge1xuICAgIH1cbiAgICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2staGVhcnRiZWF0IC0tdGFzay10b2tlbiBcIiR1c2luZzpUQVNLX1RPS0VOXCJcbiAgICBTdGFydC1TbGVlcCAtU2Vjb25kcyA2MFxuICB9XG59XG5mdW5jdGlvbiBzZXR1cF9sb2dzICgpIHtcbiAgIyB0aGUgcnVubmVyIHJlcG9ydCBjYW4ndCBnbyBpbiBydW5uZXIubG9nOiBydW4uY21kJ3MgT3V0LUZpbGUgaG9sZHMgdGhhdCBmaWxlIG9wZW4gZm9yIGFzIGxvbmcgYXMgdGhlIHJ1bm5lciBpc1xuICAjIHJ1bm5pbmcsIHdoaWNoIGlzIGV4YWN0bHkgd2hlbiB0aGUgcmVwb3J0IGlzIHdyaXR0ZW4uIG9uZSBmaWxlIHBlciBzdHJlYW0sIHNvIGl0IGdldHMgaXRzIG93biBzdHJlYW0uIHRoZVxuICAjIHN1YnNjcmlwdGlvbiBmaWx0ZXIgaXMgb24gdGhlIGxvZyBncm91cCwgc28gdGhlIGRldGVjdG9yIGRvZXNuJ3QgY2FyZS5cbiAgZWNobyBcIntcbiAgICBcXGBcImxvZ3NcXGBcIjoge1xuICAgICAgXFxgXCJsb2dfc3RyZWFtX25hbWVcXGBcIjogXFxgXCJ1bmtub3duXFxgXCIsXG4gICAgICBcXGBcImxvZ3NfY29sbGVjdGVkXFxgXCI6IHtcbiAgICAgICAgXFxgXCJmaWxlc1xcYFwiOiB7XG4gICAgICAgICBcXGBcImNvbGxlY3RfbGlzdFxcYFwiOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIFxcYFwiZmlsZV9wYXRoXFxgXCI6IFxcYFwiL2FjdGlvbnMvcnVubmVyLmxvZ1xcYFwiLFxuICAgICAgICAgICAgICBcXGBcImxvZ19ncm91cF9uYW1lXFxgXCI6IFxcYFwiJGxvZ0dyb3VwTmFtZVxcYFwiLFxuICAgICAgICAgICAgICBcXGBcImxvZ19zdHJlYW1fbmFtZVxcYFwiOiBcXGBcIiRydW5uZXJOYW1lUGF0aFxcYFwiLFxuICAgICAgICAgICAgICBcXGBcInRpbWV6b25lXFxgXCI6IFxcYFwiVVRDXFxgXCJcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIFxcYFwiZmlsZV9wYXRoXFxgXCI6IFxcYFwiL2FjdGlvbnMvd29ya2Zsb3cubG9nXFxgXCIsXG4gICAgICAgICAgICAgIFxcYFwibG9nX2dyb3VwX25hbWVcXGBcIjogXFxgXCIkbG9nR3JvdXBOYW1lXFxgXCIsXG4gICAgICAgICAgICAgIFxcYFwibG9nX3N0cmVhbV9uYW1lXFxgXCI6IFxcYFwiJHJ1bm5lck5hbWVQYXRoLXdvcmtmbG93XFxgXCIsXG4gICAgICAgICAgICAgIFxcYFwidGltZXpvbmVcXGBcIjogXFxgXCJVVENcXGBcIlxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVwiIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJICRFbnY6VEVNUC9sb2cuY29uZlxuICAmIFwiQzovUHJvZ3JhbSBGaWxlcy9BbWF6b24vQW1hem9uQ2xvdWRXYXRjaEFnZW50L2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LWN0bC5wczFcIiAtYSBmZXRjaC1jb25maWcgLW0gZWMyIC1zIC1jIGZpbGU6JEVudjpURU1QL2xvZy5jb25mXG59XG5mdW5jdGlvbiBhY3Rpb24gKCkge1xuICBjZCAvYWN0aW9uc1xuXG4gICYgLi9qb2ItcmVwb3J0ZXIucHMxIFwiXFwke3J1bm5lck5hbWVQYXRofVwiIC9hY3Rpb25zL3dvcmtmbG93LmxvZyAyPiYxIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xuXG4gIC4vcnVuLmNtZCAtLWppdGNvbmZpZyBcIlxcJHtqaXRDb25maWd9XCIgMj4mMSB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcbiAgaWYgKCRMQVNURVhJVENPREUgLW5lIDApIHsgcmV0dXJuIDIgfVxuXG4gICRTVEFUVVMgPSBTZWxlY3QtU3RyaW5nIC1QYXRoICcuL19kaWFnLyoubG9nJyAtUGF0dGVybiAnZmluaXNoIGpvYiByZXF1ZXN0IGZvciBqb2IgWzAtOWEtZlxcXFwtXSsgd2l0aCByZXN1bHQ6ICguKiknIHwgJXskXy5NYXRjaGVzLkdyb3Vwc1sxXS5WYWx1ZX0gfCBTZWxlY3QtT2JqZWN0IC1MYXN0IDFcblxuICBpZiAoJFNUQVRVUykge1xuICAgICAgZWNobyBcIkNES0dIQSBKT0IgRE9ORSBcXCR7bGFiZWxzfSAkU1RBVFVTXCIgfCBPdXQtRmlsZSAtRW5jb2RpbmcgQVNDSUkgLUFwcGVuZCAvYWN0aW9ucy9ydW5uZXIubG9nXG4gIH1cblxuICByZXR1cm4gMFxufVxudHJ5IHtcbiAgc2V0dXBfbG9nc1xuICAkc2V0dXBMb2dzU3RhdHVzID0gJExBU1RFWElUQ09ERVxuICBpZiAoJHNldHVwTG9nc1N0YXR1cyAtbmUgMCkge1xuICAgIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1mYWlsdXJlIC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgLS1lcnJvciBSdW5uZXIuU2V0dXBMb2dzLiRzZXR1cExvZ3NTdGF0dXMgLS1jYXVzZSBcIkZhaWxlZCB0byBjb25maWd1cmUgQ2xvdWRXYXRjaCBhZ2VudCAoZXhpdCAkc2V0dXBMb2dzU3RhdHVzKSwgbm8gcnVubmVyIGxvZyB3YXMgdXBsb2FkZWRcIlxuICAgIHJldHVyblxuICB9XG4gICRyID0gYWN0aW9uXG4gIGlmICgkciAtZXEgMCkge1xuICAgIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1zdWNjZXNzIC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgLS10YXNrLW91dHB1dCAneyB9JyAyPiYxIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xuICB9IGVsc2Uge1xuICAgICRsYXN0TGluZSA9IEdldC1Db250ZW50IC1QYXRoIEM6L2FjdGlvbnMvcnVubmVyLmxvZyAtVGFpbCAxIC1FcnJvckFjdGlvbiBTaWxlbnRseUNvbnRpbnVlXG4gICAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLWZhaWx1cmUgLS10YXNrLXRva2VuIFwiJFRBU0tfVE9LRU5cIiAtLWVycm9yIFJ1bm5lci5FcnJvci4kciAtLWNhdXNlIFwiQ2hlY2sgQ2xvdWRXYXRjaCBmb3IgZnVsbCBsb2cgLS0gJGxvZ0dyb3VwTmFtZS8kcnVubmVyTmFtZVBhdGggLS0gJGxhc3RMaW5lXCIgMj4mMSB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcbiAgfVxufSBmaW5hbGx5IHtcbiAgU3RhcnQtU2xlZXAgLVNlY29uZHMgMTAgICMgZ2l2ZSBjbG91ZHdhdGNoIGFnZW50IGl0cyBkZWZhdWx0IDUgc2Vjb25kcyBidWZmZXIgZHVyYXRpb24gdG8gdXBsb2FkIGxvZ3NcbiAgU3RvcC1Db21wdXRlciAtQ29tcHV0ZXJOYW1lIGxvY2FsaG9zdCAtRm9yY2Vcbn1cbjwvcG93ZXJzaGVsbD5cbmAucmVwbGFjZSgvXFxcXC9nLCAnXFxcXFxcXFwnKS5yZXBsYWNlKC97L2csICdcXFxceycpLnJlcGxhY2UoL30vZywgJ1xcXFx9JykucmVwbGFjZSgvXFxcXHtcXFxcfS9nLCAne30nKTtcblxuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIHtAbGluayBFYzJSdW5uZXJQcm92aWRlcn0gY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVjMlJ1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgQU1JIGNvbnRhaW5pbmcgR2l0SHViIFJ1bm5lciBhbmQgYWxsIHJlcXVpcmVtZW50cy5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgZGV0ZXJtaW5lcyB0aGUgT1MgYW5kIGFyY2hpdGVjdHVyZSBvZiB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBFYzJSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIoKVxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2VCdWlsZGVyPzogSVJ1bm5lckltYWdlQnVpbGRlcjtcblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGltYWdlQnVpbGRlclxuICAgKi9cbiAgcmVhZG9ubHkgYW1pQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2VjMiddXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgcnVubmVyIGdyb3VwIG5hbWUuXG4gICAqXG4gICAqIElmIHNwZWNpZmllZCwgdGhlIHJ1bm5lciB3aWxsIGJlIHJlZ2lzdGVyZWQgd2l0aCB0aGlzIGdyb3VwIG5hbWUuIFNldHRpbmcgYSBydW5uZXIgZ3JvdXAgY2FuIGhlbHAgbWFuYWdpbmcgYWNjZXNzIHRvIHNlbGYtaG9zdGVkIHJ1bm5lcnMuIEl0XG4gICAqIHJlcXVpcmVzIGEgcGFpZCBHaXRIdWIgYWNjb3VudCBhbmQgb3JnYW5pemF0aW9uIGxldmVsIHJ1bm5lciByZWdpc3RyYXRpb24uXG4gICAqXG4gICAqIFRoZSBncm91cCBtdXN0IGV4aXN0IG9yIHRoZSBydW5uZXIgd2lsbCBub3Qgc3RhcnQuXG4gICAqXG4gICAqIFVzZXJzIHdpbGwgc3RpbGwgYmUgYWJsZSB0byB0cmlnZ2VyIHRoaXMgcnVubmVyIHdpdGggdGhlIGNvcnJlY3QgbGFiZWxzLiBCdXQgdGhlIHJ1bm5lciB3aWxsIG9ubHkgYmUgYWJsZSB0byBydW4gam9icyBmcm9tIHJlcG9zIGFsbG93ZWQgdG8gdXNlIHRoZSBncm91cC5cbiAgICpcbiAgICogQGRlZmF1bHQgdW5kZWZpbmVkXG4gICAqL1xuICByZWFkb25seSBncm91cD86IHN0cmluZztcblxuICAvKipcbiAgICogSW5zdGFuY2UgdHlwZSBmb3IgbGF1bmNoZWQgcnVubmVyIGluc3RhbmNlcy5cbiAgICpcbiAgICogRm9yIEdQVSBpbnN0YW5jZSB0eXBlcyAoZzRkbiwgZzUsIHAzLCBldGMuKSwgd2UgYXV0b21hdGljYWxseSB1c2UgYSBHUFUgYmFzZSBpbWFnZSAoQVdTIERlZXAgTGVhcm5pbmcgQU1JKVxuICAgKiB3aXRoIE5WSURJQSBkcml2ZXJzIHByZS1pbnN0YWxsZWQuIElmIHlvdSBwcm92aWRlIHlvdXIgb3duIGltYWdlIGJ1aWxkZXIsIHVzZVxuICAgKiBgYmFzZUFtaTogQmFzZUltYWdlLmZyb21HcHVCYXNlKG9zLCBhcmNoaXRlY3R1cmUpYCBvciBhbm90aGVyIGltYWdlIHByZWxvYWRlZCB3aXRoIE5WSURJQSBkcml2ZXJzLCBvciB1c2VcbiAgICogYW4gaW1hZ2UgY29tcG9uZW50IHRvIGluc3RhbGwgTlZJRElBIGRyaXZlcnMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG02aS5sYXJnZVxuICAgKi9cbiAgcmVhZG9ubHkgaW5zdGFuY2VUeXBlPzogZWMyLkluc3RhbmNlVHlwZTtcblxuICAvKipcbiAgICogU2l6ZSBvZiB2b2x1bWUgYXZhaWxhYmxlIGZvciBsYXVuY2hlZCBydW5uZXIgaW5zdGFuY2VzLiBUaGlzIG1vZGlmaWVzIHRoZSBib290IHZvbHVtZSBzaXplIGFuZCBkb2Vzbid0IGFkZCBhbnkgYWRkaXRpb25hbCB2b2x1bWVzLlxuICAgKlxuICAgKiBAZGVmYXVsdCAzMEdCXG4gICAqL1xuICByZWFkb25seSBzdG9yYWdlU2l6ZT86IGNkay5TaXplO1xuXG4gIC8qKlxuICAgKiBPcHRpb25zIGZvciBydW5uZXIgaW5zdGFuY2Ugc3RvcmFnZSB2b2x1bWUuXG4gICAqL1xuICByZWFkb25seSBzdG9yYWdlT3B0aW9ucz86IFN0b3JhZ2VPcHRpb25zO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBHcm91cCB0byBhc3NpZ24gdG8gbGF1bmNoZWQgcnVubmVyIGluc3RhbmNlcy5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBzZWN1cml0eUdyb3Vwc31cbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA/OiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwcyB0byBhc3NpZ24gdG8gbGF1bmNoZWQgcnVubmVyIGluc3RhbmNlcy5cbiAgICpcbiAgICogQGRlZmF1bHQgYSBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgLyoqXG4gICAqIFN1Ym5ldCB3aGVyZSB0aGUgcnVubmVyIGluc3RhbmNlcyB3aWxsIGJlIGxhdW5jaGVkLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IHN1Ym5ldCBvZiBhY2NvdW50J3MgZGVmYXVsdCBWUENcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayB2cGN9IGFuZCB7QGxpbmsgc3VibmV0U2VsZWN0aW9ufVxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0PzogZWMyLklTdWJuZXQ7XG5cbiAgLyoqXG4gICAqIFZQQyB3aGVyZSBydW5uZXIgaW5zdGFuY2VzIHdpbGwgYmUgbGF1bmNoZWQuXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgYWNjb3VudCBWUENcbiAgICovXG4gIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBXaGVyZSB0byBwbGFjZSB0aGUgbmV0d29yayBpbnRlcmZhY2VzIHdpdGhpbiB0aGUgVlBDLiBPbmx5IHRoZSBmaXJzdCBtYXRjaGVkIHN1Ym5ldCB3aWxsIGJlIHVzZWQuXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgVlBDIHN1Ym5ldFxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogVXNlIHNwb3QgaW5zdGFuY2VzIHRvIHNhdmUgbW9uZXkuIFNwb3QgaW5zdGFuY2VzIGFyZSBjaGVhcGVyIGJ1dCBub3QgYWx3YXlzIGF2YWlsYWJsZSBhbmQgY2FuIGJlIHN0b3BwZWQgcHJlbWF0dXJlbHkuXG4gICAqXG4gICAqIEBkZWZhdWx0IGZhbHNlXG4gICAqL1xuICByZWFkb25seSBzcG90PzogYm9vbGVhbjtcblxuICAvKipcbiAgICogU2V0IGEgbWF4aW11bSBwcmljZSBmb3Igc3BvdCBpbnN0YW5jZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIG1heCBwcmljZSAoeW91IHdpbGwgcGF5IGN1cnJlbnQgc3BvdCBwcmljZSlcbiAgICovXG4gIHJlYWRvbmx5IHNwb3RNYXhQcmljZT86IHN0cmluZztcblxuICAvKipcbiAgICogTWF4aW11bSB0aW1lIHRoZSBTdGVwIEZ1bmN0aW9ucyB0YXNrIHdhaXRzIGJldHdlZW4gaGVhcnRiZWF0cyBmcm9tIHRoZSBydW5uZXIgaW5zdGFuY2UgYmVmb3JlIGl0IGNvbnNpZGVycyB0aGVcbiAgICogcnVubmVyIHN0dWNrIGFuZCBmYWlscyB0aGUgdGFzay5cbiAgICpcbiAgICogUmFpc2UgdGhpcyBpZiB5b3VyIGluc3RhbmNlcyBjYW4gZ28gbG9uZ2VyIHRoYW4gdGhlIGRlZmF1bHQgd2l0aG91dCBhIGhlYXJ0YmVhdCwgZm9yIGV4YW1wbGUgZHVyaW5nIGxvbmcgc25hcHNob3RcbiAgICogZGVwbG95cyBvciBoZWF2eSBmaXh0dXJlIHNldHVwLlxuICAgKlxuICAgKiBAZGVmYXVsdCBEdXJhdGlvbi5taW51dGVzKDEwKVxuICAgKi9cbiAgcmVhZG9ubHkgaGVhcnRiZWF0VGltZW91dD86IGNkay5EdXJhdGlvbjtcblxuICAvKipcbiAgICogQWRkaXRpb25hbCB0YWdzIHRvIGFwcGx5IHRvIGxhdW5jaGVkIHJ1bm5lciBpbnN0YW5jZXMgYW5kIHRoZWlyIHZvbHVtZXMuXG4gICAqXG4gICAqIFRoZXNlIGFkZGl0aW9uYWwgdGFncyBhcmUgc2V0IG9uIHRvcCBvZiBgTmFtZWAsIGBHaXRIdWJSdW5uZXJzOlByb3ZpZGVyYCwgYEdpdEh1YlJ1bm5lcnM6UmVwb2AsIGFuZCBgR2l0SHViUnVubmVyczpMYWJlbHNgLCBhbmRcbiAgICogYEdpdEh1YlJ1bm5lcnM6UnVubmVyYC4gWW91IG1heSBvbmx5IG92ZXJyaWRlIGBOYW1lYC4gVGFncyBwcmVmaXhlZCBgR2l0SHViUnVubmVyczpgIGFyZSByZXNlcnZlZCBhbmQgcmVqZWN0ZWQuIFNvbWUgb2Ygb3VyIHJlc2VydmVkIHRhZ3MgYXJlXG4gICAqIHVzZWQgZm9yIGhvdXNlLWtlZXBpbmcgcHVycG9zZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5vIGFkZGl0aW9uYWwgdGFnc1xuICAgKi9cbiAgcmVhZG9ubHkgdGFncz86IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG59XG5cbi8qKlxuICogUnVubmVyIGNvbmZpZyBmb3IgdGhlIEVjMiBmYW1pbHkgZnJhZ21lbnQuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmludGVyZmFjZSBFYzJSdW5uZXJDb25maWcgZXh0ZW5kcyBSdW5uZXJDb25maWcge1xuICByZWFkb25seSBsYXVuY2hUZW1wbGF0ZUlkOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZTogc3RyaW5nO1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwSWRzOiBzdHJpbmdbXTtcbiAgcmVhZG9ubHkgaW5zdGFuY2VQcm9maWxlQXJuOiBzdHJpbmc7XG4gIHJlYWRvbmx5IGxvZ0dyb3VwTmFtZTogc3RyaW5nO1xuICByZWFkb25seSBibG9ja0RldmljZU1hcHBpbmdzOiBhbnlbXTtcbiAgcmVhZG9ubHkgaW5zdGFuY2VNYXJrZXRPcHRpb25zOiBhbnk7XG4gIHJlYWRvbmx5IHVzZXJEYXRhVGVtcGxhdGVJZHg6IG51bWJlcjtcbiAgcmVhZG9ubHkgc3VibmV0OiBzdHJpbmc7XG4gIHJlYWRvbmx5IGhlYXJ0YmVhdFNlY29uZHM6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBHaXRIdWIgQWN0aW9ucyBydW5uZXIgcHJvdmlkZXIgdXNpbmcgRUMyIHRvIGV4ZWN1dGUgam9icy5cbiAqXG4gKiBUaGlzIGNvbnN0cnVjdCBpcyBub3QgbWVhbnQgdG8gYmUgdXNlZCBieSBpdHNlbGYuIEl0IHNob3VsZCBiZSBwYXNzZWQgaW4gdGhlIHByb3ZpZGVycyBwcm9wZXJ0eSBmb3IgR2l0SHViUnVubmVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIEVjMlJ1bm5lclByb3ZpZGVyIGV4dGVuZHMgQmFzZVByb3ZpZGVyIGltcGxlbWVudHMgSVJ1bm5lclByb3ZpZGVyLCBJUGFyYW1ldGVyaXplZFJ1bm5lclByb3ZpZGVyIHtcbiAgLyoqIEBpbnRlcm5hbCAqL1xuICBwdWJsaWMgc3RhdGljIHJlYWRvbmx5IF9GQU1JTFkgPSAnZWMyJztcblxuICAvKipcbiAgICogQmlnIHN0YXRpYyBzdHJpbmdzIHRoZSBFQzIgZnJhZ21lbnQgcmVhZHMgZnJvbSBgJC5jb25maWdgLiBXZSBhbHdheXMgaW5jbHVkZSBib3RoIHVzZXJkYXRhIHRlbXBsYXRlcyBiZWNhdXNlXG4gICAqIHRoZSBmcmFnbWVudCBwdXRzIGJvdGggaW4gYSBTdGF0ZXMuQXJyYXkoKSBhbmQgcGlja3Mgb25lIGJ5IGluZGV4IGF0IHJ1bnRpbWUuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBfc3RhdGVNYWNoaW5lQ29uc3RhbnRzKCk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICAgIHJldHVybiB7XG4gICAgICBlYzJVc2VyRGF0YUxpbnV4OiBsaW51eFVzZXJEYXRhVGVtcGxhdGUsXG4gICAgICBlYzJVc2VyRGF0YVdpbmRvd3M6IHdpbmRvd3NVc2VyRGF0YVRlbXBsYXRlLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogVGhlIGZyYWdtZW50IHRoYXQgcnVucyBhbnkgRUMyIHByb3ZpZGVyLiBSZWFkcyB0aGUgY29uZmlnIHtAbGluayBfcnVubmVyQ29uZmlnfSBnZW5lcmF0ZWQgZm9yIGl0IGZyb21cbiAgICogYCQucHJvdmlkZXJQYXJhbXNgLCBhbmQgbGF1bmNoZXMgaW50byB3aGF0ZXZlciBzdWJuZXQgaXMgYXQgYCQucHJvdmlkZXJQYXJhbXMuc3VibmV0YC5cbiAgICpcbiAgICogTXVsdGlwbGUgc3VibmV0cyBhcmUgYSBjaGFpbiBvZiBmYWxsYmFjayBjb25maWdzIGluc3RlYWQgb2YgdGhlIGNoYWluIG9mIHN0YXRlcyB3ZSB1c2VkIHRvIHJlbmRlciwgc2VlXG4gICAqIHtAbGluayBFYzJSdW5uZXJQcm92aWRlci5fcnVubmVyQ29uZmlnfS5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIF9zdGF0ZU1hY2hpbmVGcmFnbWVudChzY29wZTogQ29uc3RydWN0KTogc3RlcGZ1bmN0aW9ucy5JQ2hhaW5hYmxlIHtcbiAgICBjb25zdCBwID0gcHJvdmlkZXJQYXJhbTxFYzJSdW5uZXJDb25maWc+O1xuICAgIHJldHVybiBuZXcgc3RlcGZ1bmN0aW9ucy5DdXN0b21TdGF0ZShzY29wZSwgJ0VDMiBSdW5uZXInLCB7XG4gICAgICBzdGF0ZUpzb246IHtcbiAgICAgICAgVHlwZTogJ1Rhc2snLFxuICAgICAgICBSZXNvdXJjZTogYGFybjoke2Nkay5Bd3MuUEFSVElUSU9OfTpzdGF0ZXM6Ojphd3Mtc2RrOmVjMjpydW5JbnN0YW5jZXMud2FpdEZvclRhc2tUb2tlbmAsXG4gICAgICAgICdIZWFydGJlYXRTZWNvbmRzUGF0aCc6IHAoJ2hlYXJ0YmVhdFNlY29uZHMnKSxcbiAgICAgICAgUGFyYW1ldGVyczoge1xuICAgICAgICAgICdMYXVuY2hUZW1wbGF0ZSc6IHtcbiAgICAgICAgICAgICdMYXVuY2hUZW1wbGF0ZUlkLiQnOiBwKCdsYXVuY2hUZW1wbGF0ZUlkJyksXG4gICAgICAgICAgfSxcbiAgICAgICAgICAnTWluQ291bnQnOiAxLFxuICAgICAgICAgICdNYXhDb3VudCc6IDEsXG4gICAgICAgICAgJ0luc3RhbmNlVHlwZS4kJzogcCgnaW5zdGFuY2VUeXBlJyksXG4gICAgICAgICAgJ1VzZXJEYXRhLiQnOiAnU3RhdGVzLkJhc2U2NEVuY29kZShTdGF0ZXMuRm9ybWF0KCcgK1xuICAgICAgICAgICAgYFN0YXRlcy5BcnJheUdldEl0ZW0oU3RhdGVzLkFycmF5KCRlYzJVc2VyRGF0YUxpbnV4LCAkZWMyVXNlckRhdGFXaW5kb3dzKSwgJHtwKCd1c2VyRGF0YVRlbXBsYXRlSWR4Jyl9KSwgYCArXG4gICAgICAgICAgICBgJCQuVGFzay5Ub2tlbiwgJHtwKCdsb2dHcm91cE5hbWUnKX0sICR7UlVOTkVSX0lOUFVULm5hbWV9LCAke1JVTk5FUl9JTlBVVC5kb21haW59LCAke1JVTk5FUl9JTlBVVC5vd25lcn0sICR7UlVOTkVSX0lOUFVULnJlcG99LCBgICtcbiAgICAgICAgICAgIGAke1JVTk5FUl9JTlBVVC5qaXRDb25maWd9LCAke1JVTk5FUl9JTlBVVC5sYWJlbHN9KSlgLFxuICAgICAgICAgICdJbnN0YW5jZUluaXRpYXRlZFNodXRkb3duQmVoYXZpb3InOiAndGVybWluYXRlJyxcbiAgICAgICAgICAnSWFtSW5zdGFuY2VQcm9maWxlJzoge1xuICAgICAgICAgICAgJ0Fybi4kJzogcCgnaW5zdGFuY2VQcm9maWxlQXJuJyksXG4gICAgICAgICAgfSxcbiAgICAgICAgICAnTWV0YWRhdGFPcHRpb25zJzoge1xuICAgICAgICAgICAgSHR0cFRva2VuczogJ3JlcXVpcmVkJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgICdTZWN1cml0eUdyb3VwSWRzLiQnOiBwKCdzZWN1cml0eUdyb3VwSWRzJyksXG4gICAgICAgICAgJ1N1Ym5ldElkLiQnOiBwKCdzdWJuZXQnKSxcbiAgICAgICAgICAnQmxvY2tEZXZpY2VNYXBwaW5ncy4kJzogcCgnYmxvY2tEZXZpY2VNYXBwaW5ncycpLFxuICAgICAgICAgICdJbnN0YW5jZU1hcmtldE9wdGlvbnMuJCc6IHAoJ2luc3RhbmNlTWFya2V0T3B0aW9ucycpLFxuICAgICAgICAgIC8vIHRoZSBwcm92aWRlcidzIHRhZ3MsIGFscmVhZHkgbWVyZ2VkIHdpdGggdGhlIHN0YW5kYXJkIHJ1bm5lciB0YWdzIGJ5IHRoZSBvcmNoZXN0cmF0b3JcbiAgICAgICAgICAnVGFnU3BlY2lmaWNhdGlvbnMnOiBbXG4gICAgICAgICAgICB7ICdSZXNvdXJjZVR5cGUnOiAnaW5zdGFuY2UnLCAnVGFncy4kJzogcCgndGFncycpIH0sXG4gICAgICAgICAgICB7ICdSZXNvdXJjZVR5cGUnOiAndm9sdW1lJywgJ1RhZ3MuJCc6IHAoJ3RhZ3MnKSB9LFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBuZXcgaW1hZ2UgYnVpbGRlciB0aGF0IGJ1aWxkcyBFQzIgc3BlY2lmaWMgcnVubmVyIGltYWdlcy5cbiAgICpcbiAgICogWW91IGNhbiBjdXN0b21pemUgdGhlIE9TLCBhcmNoaXRlY3R1cmUsIFZQQywgc3VibmV0LCBzZWN1cml0eSBncm91cHMsIGV0Yy4gYnkgcGFzc2luZyBpbiBwcm9wcy5cbiAgICpcbiAgICogWW91IGNhbiBhZGQgY29tcG9uZW50cyB0byB0aGUgaW1hZ2UgYnVpbGRlciBieSBjYWxsaW5nIGBpbWFnZUJ1aWxkZXIuYWRkQ29tcG9uZW50KClgLlxuICAgKlxuICAgKiBUaGUgZGVmYXVsdCBPUyBpcyBVYnVudHUgcnVubmluZyBvbiB4NjQgYXJjaGl0ZWN0dXJlLlxuICAgKlxuICAgKiBJbmNsdWRlZCBjb21wb25lbnRzOlxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuY2xvdWRXYXRjaEFnZW50KClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YkNsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdGh1YlJ1bm5lcigpYFxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBpbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcykge1xuICAgIHJldHVybiBSdW5uZXJJbWFnZUJ1aWxkZXIubmV3KHNjb3BlLCBpZCwge1xuICAgICAgb3M6IE9zLkxJTlVYX1VCVU5UVSxcbiAgICAgIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlLlg4Nl82NCxcbiAgICAgIGJ1aWxkZXJUeXBlOiBSdW5uZXJJbWFnZUJ1aWxkZXJUeXBlLkFXU19JTUFHRV9CVUlMREVSLFxuICAgICAgY29tcG9uZW50czogW1xuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5yZXF1aXJlZFBhY2thZ2VzKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmNsb3VkV2F0Y2hBZ2VudCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5ydW5uZXJVc2VyKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmdpdCgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuYXdzQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmRvY2tlcigpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIocHJvcHM/LnJ1bm5lclZlcnNpb24gPz8gUnVubmVyVmVyc2lvbi5sYXRlc3QoKSksXG4gICAgICBdLFxuICAgICAgLi4ucHJvcHMsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogTGFiZWxzIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHByb3ZpZGVyLlxuICAgKi9cbiAgcmVhZG9ubHkgbGFiZWxzOiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR3JhbnQgcHJpbmNpcGFsIHVzZWQgdG8gYWRkIHBlcm1pc3Npb25zIHRvIHRoZSBydW5uZXIgcm9sZS5cbiAgICovXG4gIHJlYWRvbmx5IGdyYW50UHJpbmNpcGFsOiBpYW0uSVByaW5jaXBhbDtcblxuICAvKipcbiAgICogTG9nIGdyb3VwIHdoZXJlIHByb3ZpZGVkIHJ1bm5lcnMgd2lsbCBzYXZlIHRoZWlyIGxvZ3MuXG4gICAqXG4gICAqIE5vdGUgdGhhdCB0aGlzIGlzIG5vdCB0aGUgam9iIGxvZywgYnV0IHRoZSBydW5uZXIgaXRzZWxmLiBJdCB3aWxsIG5vdCBjb250YWluIG91dHB1dCBmcm9tIHRoZSBHaXRIdWIgQWN0aW9uIGJ1dCBvbmx5IG1ldGFkYXRhIG9uIGl0cyBleGVjdXRpb24uXG4gICAqL1xuICByZWFkb25seSBsb2dHcm91cDogbG9ncy5JTG9nR3JvdXA7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBncm91cD86IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBhbWlCdWlsZGVyOiBJUnVubmVySW1hZ2VCdWlsZGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IGFtaTogUnVubmVyQW1pO1xuICBwcml2YXRlIHJlYWRvbmx5IHJvbGU6IGlhbS5Sb2xlO1xuICBwcml2YXRlIHJlYWRvbmx5IGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdG9yYWdlU2l6ZTogY2RrLlNpemU7XG4gIHByaXZhdGUgcmVhZG9ubHkgc3RvcmFnZU9wdGlvbnM/OiBTdG9yYWdlT3B0aW9ucztcbiAgcHJpdmF0ZSByZWFkb25seSBzcG90OiBib29sZWFuO1xuICBwcml2YXRlIHJlYWRvbmx5IHNwb3RNYXhQcmljZTogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IGhlYXJ0YmVhdFRpbWVvdXQ6IGNkay5EdXJhdGlvbjtcbiAgcHJpdmF0ZSByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuICBwcml2YXRlIHJlYWRvbmx5IHN1Ym5ldHM6IGVjMi5JU3VibmV0W107XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM6IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlZmF1bHRMYWJlbHM6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgdGFnczogeyBba2V5OiBzdHJpbmddOiBzdHJpbmcgfTtcbiAgcHJpdmF0ZSByZWFkb25seSBpbnN0YW5jZVByb2ZpbGU6IGlhbS5DZm5JbnN0YW5jZVByb2ZpbGU7XG4gIHByaXZhdGUgcmVhZG9ubHkgcm9vdERldmljZVJlc291cmNlOiBjZGsuQ3VzdG9tUmVzb3VyY2U7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBFYzJSdW5uZXJQcm92aWRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICB0aGlzLmxhYmVscyA9IHByb3BzPy5sYWJlbHMgPz8gWydlYzInXTtcbiAgICB0aGlzLmdyb3VwID0gcHJvcHM/Lmdyb3VwO1xuICAgIHRoaXMudnBjID0gcHJvcHM/LnZwYyA/PyBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ0RlZmF1bHQgVlBDJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzPy5zZWN1cml0eUdyb3VwID8gW3Byb3BzLnNlY3VyaXR5R3JvdXBdIDogKHByb3BzPy5zZWN1cml0eUdyb3VwcyA/PyBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdTRycsIHsgdnBjOiB0aGlzLnZwYyB9KV0pO1xuICAgIHRoaXMuc3VibmV0cyA9IHByb3BzPy5zdWJuZXQgPyBbcHJvcHMuc3VibmV0XSA6IHRoaXMudnBjLnNlbGVjdFN1Ym5ldHMocHJvcHM/LnN1Ym5ldFNlbGVjdGlvbikuc3VibmV0cztcbiAgICB0aGlzLmluc3RhbmNlVHlwZSA9IHByb3BzPy5pbnN0YW5jZVR5cGUgPz8gZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5NNkksIGVjMi5JbnN0YW5jZVNpemUuTEFSR0UpO1xuICAgIHRoaXMuc3RvcmFnZVNpemUgPSBwcm9wcz8uc3RvcmFnZVNpemUgPz8gY2RrLlNpemUuZ2liaWJ5dGVzKDMwKTsgLy8gMzAgaXMgdGhlIG1pbmltdW0gZm9yIFdpbmRvd3NcbiAgICB0aGlzLnN0b3JhZ2VPcHRpb25zID0gcHJvcHM/LnN0b3JhZ2VPcHRpb25zO1xuICAgIHRoaXMuc3BvdCA9IHByb3BzPy5zcG90ID8/IGZhbHNlO1xuICAgIHRoaXMuc3BvdE1heFByaWNlID0gcHJvcHM/LnNwb3RNYXhQcmljZTtcbiAgICB0aGlzLmhlYXJ0YmVhdFRpbWVvdXQgPSBwcm9wcz8uaGVhcnRiZWF0VGltZW91dCA/PyBjZGsuRHVyYXRpb24ubWludXRlcygxMCk7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcbiAgICB0aGlzLnRhZ3MgPSBwcm9wcz8udGFncyA/PyB7fTtcblxuICAgIC8vIHJlc2VydmVkLCBiZWNhdXNlIGNsZWFudXAgdGVybWluYXRlcyBpbnN0YW5jZXMgYnkgYSB0YWcgd2l0aCB0aGlzIHByZWZpeFxuICAgIE9iamVjdC5rZXlzKHRoaXMudGFncykuZmlsdGVyKGtleSA9PiBrZXkuc3RhcnRzV2l0aChSZXNlcnZlZFRhZ3MuUFJFRklYKSkuZm9yRWFjaCh0YWcgPT4ge1xuICAgICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZEVycm9yKFxuICAgICAgICBgVGFnIFwiJHt0YWd9XCIgY2FuJ3QgYmUgc2V0OiB0aGUgXCIke1Jlc2VydmVkVGFncy5QUkVGSVh9XCIgcHJlZml4IGlzIHJlc2VydmVkLmAsXG4gICAgICApO1xuICAgIH0pO1xuXG4gICAgaWYgKHRoaXMuc3VibmV0cy5sZW5ndGggPT09IDApIHtcbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcignQXQgbGVhc3Qgb25lIHN1Ym5ldCBpcyByZXF1aXJlZCcpO1xuICAgIH1cblxuICAgIGNvbnN0IGFyY2ggPSB0aGlzLmluc3RhbmNlVHlwZS5hcmNoaXRlY3R1cmUgPT09IGVjMi5JbnN0YW5jZUFyY2hpdGVjdHVyZS5BUk1fNjQgPyBBcmNoaXRlY3R1cmUuQVJNNjQgOiBBcmNoaXRlY3R1cmUuWDg2XzY0O1xuXG4gICAgdGhpcy5hbWlCdWlsZGVyID0gcHJvcHM/LmltYWdlQnVpbGRlciA/PyBwcm9wcz8uYW1pQnVpbGRlciA/PyBFYzJSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIodGhpcywgJ0FtaSBCdWlsZGVyJywge1xuICAgICAgdnBjOiBwcm9wcz8udnBjLFxuICAgICAgc3VibmV0U2VsZWN0aW9uOiBwcm9wcz8uc3VibmV0U2VsZWN0aW9uLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMsXG4gICAgICBiYXNlQW1pOiBpc0dwdUluc3RhbmNlVHlwZSh0aGlzLmluc3RhbmNlVHlwZSkgPyBCYXNlSW1hZ2UuZnJvbUdwdUJhc2UoT3MuTElOVVhfVUJVTlRVLCBhcmNoKSA6IHVuZGVmaW5lZCxcbiAgICAgIGFyY2hpdGVjdHVyZTogYXJjaCxcbiAgICAgIGF3c0ltYWdlQnVpbGRlck9wdGlvbnM6IHtcbiAgICAgICAgaW5zdGFuY2VUeXBlOiBhcmNoLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkgPyBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLk02RywgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSkgOiB1bmRlZmluZWQsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMuYW1pID0gdGhpcy5hbWlCdWlsZGVyLmJpbmRBbWkoKTtcblxuICAgIGlmICh0aGlzLmFtaUJ1aWxkZXIgaW5zdGFuY2VvZiBBd3NJbWFnZUJ1aWxkZXJSdW5uZXJJbWFnZUJ1aWxkZXIpIHtcbiAgICAgIGlmICh0aGlzLmFtaUJ1aWxkZXIuc3RvcmFnZVNpemUgJiYgdGhpcy5zdG9yYWdlU2l6ZS50b0J5dGVzKCkgPCB0aGlzLmFtaUJ1aWxkZXIuc3RvcmFnZVNpemUudG9CeXRlcygpKSB7XG4gICAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcihgUnVubmVyIHN0b3JhZ2Ugc2l6ZSAoJHt0aGlzLnN0b3JhZ2VTaXplLnRvR2liaWJ5dGVzKCl9IEdpQikgbXVzdCBiZSBhdCBsZWFzdCB0aGUgc2FtZSBhcyB0aGUgaW1hZ2UgYnVpbGRlciBzdG9yYWdlIHNpemUgKCR7dGhpcy5hbWlCdWlsZGVyLnN0b3JhZ2VTaXplLnRvR2liaWJ5dGVzKCl9IEdpQilgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuYW1pLmFyY2hpdGVjdHVyZS5pbnN0YW5jZVR5cGVNYXRjaCh0aGlzLmluc3RhbmNlVHlwZSkpIHtcbiAgICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRFcnJvcihgQU1JIGFyY2hpdGVjdHVyZSAoJHt0aGlzLmFtaS5hcmNoaXRlY3R1cmUubmFtZX0pIGRvZXNuJ3QgbWF0Y2ggcnVubmVyIGluc3RhbmNlIHR5cGUgKCR7dGhpcy5pbnN0YW5jZVR5cGV9IC8gJHt0aGlzLmluc3RhbmNlVHlwZS5hcmNoaXRlY3R1cmV9KWApO1xuICAgIH1cblxuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwgPSB0aGlzLnJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWMyLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcbiAgICB0aGlzLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnc3RhdGVzOlNlbmRUYXNrRmFpbHVyZScsICdzdGF0ZXM6U2VuZFRhc2tTdWNjZXNzJywgJ3N0YXRlczpTZW5kVGFza0hlYXJ0YmVhdCddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSwgLy8gbm8gc3VwcG9ydCBmb3Igc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFybiBidXQgdGFzayB0b2tlbnMgYXJlIHZlcnkgbG9uZyBhbmQgdG90YWxseSByYW5kb20gc28gbm90IHRoZSBlbmQgb2YgdGhlIHdvcmxkXG4gICAgfSkpO1xuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwuYWRkVG9QcmluY2lwYWxQb2xpY3koTUlOSU1BTF9FQzJfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UKTtcblxuICAgIHRoaXMubG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cChcbiAgICAgIHRoaXMsXG4gICAgICAnTG9ncycsXG4gICAgICB7XG4gICAgICAgIHJldGVudGlvbjogcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgfSxcbiAgICApO1xuICAgIHRoaXMubG9nR3JvdXAuZ3JhbnRXcml0ZSh0aGlzKTtcblxuICAgIHRoaXMuaW5zdGFuY2VQcm9maWxlID0gbmV3IGlhbS5DZm5JbnN0YW5jZVByb2ZpbGUodGhpcywgJ0luc3RhbmNlIFByb2ZpbGUnLCB7XG4gICAgICByb2xlczogW3RoaXMucm9sZS5yb2xlTmFtZV0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnJvb3REZXZpY2VSZXNvdXJjZSA9IGFtaVJvb3REZXZpY2UodGhpcywgdGhpcy5hbWkubGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVJZCwgdGhpcy5hbWkuY2FjaGVLZXkpO1xuICAgIGlmIChDb25zdHJ1Y3QuaXNDb25zdHJ1Y3QodGhpcy5hbWlCdWlsZGVyKSkge1xuICAgICAgLy8gaWYgdGhlIHVzZXIgZGlkbid0IGNyZWF0ZSBhIHN0YXRpYyBpbWFnZSBidWlsZGVyIGFuZCBpdCdzIGEgcmVhbCBjb25zdHJ1Y3QsIHdlIG5lZWQgdG8gd2FpdCBmb3IgaXRcbiAgICAgIHRoaXMucm9vdERldmljZVJlc291cmNlLm5vZGUuYWRkRGVwZW5kZW5jeSh0aGlzLmFtaUJ1aWxkZXIpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG4gIF9ncmFudFN0YXRlTWFjaGluZShzdGF0ZU1hY2hpbmVSb2xlOiBpYW0uSUdyYW50YWJsZSkge1xuICAgIC8vIHdlIHVzZSBlYzI6UnVuSW5zdGFuY2VzIGJlY2F1c2Ugd2UgbXVzdFxuICAgIC8vIHdlIGNhbid0IHVzZSBmbGVldHMgYmVjYXVzZSB0aGV5IGRvbid0IGxldCB1cyBvdmVycmlkZSB1c2VyIGRhdGEsIHNlY3VyaXR5IGdyb3VwcyBvciBldmVuIGRpc2sgc2l6ZVxuICAgIC8vIHdlIGNhbid0IHVzZSByZXF1ZXN0U3BvdEluc3RhbmNlcyBiZWNhdXNlIGl0IGRvZXNuJ3Qgc3VwcG9ydCBsYXVuY2ggdGVtcGxhdGVzLCBhbmQgaXQncyBkZXByZWNhdGVkXG4gICAgLy8gZWMyOlJ1bkluc3RhbmNlcyBhbHNvIHNlZW1lZCBsaWtlIHRoZSBvbmx5IG9uZSB0byBpbW1lZGlhdGVseSByZXR1cm4gYW4gZXJyb3Igd2hlbiBzcG90IGNhcGFjaXR5IGlzIG5vdCBhdmFpbGFibGVcbiAgICBzdGF0ZU1hY2hpbmVSb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZWMyOnJ1bkluc3RhbmNlcyddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICBzdGF0ZU1hY2hpbmVSb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnaWFtOlBhc3NSb2xlJ10sXG4gICAgICByZXNvdXJjZXM6IFt0aGlzLnJvbGUucm9sZUFybl0sXG4gICAgICBjb25kaXRpb25zOiB7XG4gICAgICAgIFN0cmluZ0VxdWFsczoge1xuICAgICAgICAgICdpYW06UGFzc2VkVG9TZXJ2aWNlJzogJ2VjMi5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSkpO1xuXG4gICAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2VjMjpjcmVhdGVUYWdzJ10sXG4gICAgICByZXNvdXJjZXM6IFtTdGFjay5vZih0aGlzKS5mb3JtYXRBcm4oe1xuICAgICAgICBzZXJ2aWNlOiAnZWMyJyxcbiAgICAgICAgcmVzb3VyY2U6ICcqJyxcbiAgICAgIH0pXSxcbiAgICB9KSk7XG5cbiAgICBzdGF0ZU1hY2hpbmVSb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnaWFtOkNyZWF0ZVNlcnZpY2VMaW5rZWRSb2xlJ10sXG4gICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAnaWFtOkFXU1NlcnZpY2VOYW1lJzogJ3Nwb3QuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDb25maWcgZm9yIHRoZSBzaGFyZWQgRUMyIGZyYWdtZW50LlxuICAgKlxuICAgKiBlYzI6UnVuSW5zdGFuY2VzIGNhbiBvbmx5IHRyeSBvbmUgc3VibmV0IGF0IGEgdGltZSwgc28gZXZlcnkgc3VibmV0IGdldHMgYSBjb25maWcgdGhhdCBmYWxscyBiYWNrIHRvIHRoZSBuZXh0XG4gICAqIG9uZS4gU2FtZSBjaGFpbiB3ZSB1c2VkIHRvIHJlbmRlciBhcyBzdGF0ZXMuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cbiAgX3J1bm5lckNvbmZpZygpOiBFYzJSdW5uZXJDb25maWcge1xuICAgIGNvbnN0IGJhc2UgPSB7XG4gICAgICBmYW1pbHk6IEVjMlJ1bm5lclByb3ZpZGVyLl9GQU1JTFksXG4gICAgICBwcm92aWRlcjogdGhpcy5ub2RlLnBhdGgsXG4gICAgICBsYXVuY2hUZW1wbGF0ZUlkOiB0aGlzLmFtaS5sYXVuY2hUZW1wbGF0ZS5sYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgaW5zdGFuY2VUeXBlOiB0aGlzLmluc3RhbmNlVHlwZS50b1N0cmluZygpLFxuICAgICAgc2VjdXJpdHlHcm91cElkczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIGluc3RhbmNlUHJvZmlsZUFybjogdGhpcy5pbnN0YW5jZVByb2ZpbGUuYXR0ckFybixcbiAgICAgIGxvZ0dyb3VwTmFtZTogdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICAvLyBhbHJlYWR5IGluIHRoZSBzaGFwZSBlYzI6cnVuSW5zdGFuY2VzIHdhbnRzLCBzbyB0aGUgZnJhZ21lbnQgY2FuIHNwbGljZSBpdCBpbiBhcy1pc1xuICAgICAgYmxvY2tEZXZpY2VNYXBwaW5nczogW3tcbiAgICAgICAgRGV2aWNlTmFtZTogdGhpcy5yb290RGV2aWNlUmVzb3VyY2UucmVmLFxuICAgICAgICBFYnM6IHtcbiAgICAgICAgICBEZWxldGVPblRlcm1pbmF0aW9uOiB0cnVlLFxuICAgICAgICAgIFZvbHVtZVNpemU6IHRoaXMuc3RvcmFnZVNpemUudG9HaWJpYnl0ZXMoKSxcbiAgICAgICAgICBWb2x1bWVUeXBlOiB0aGlzLnN0b3JhZ2VPcHRpb25zPy52b2x1bWVUeXBlLFxuICAgICAgICAgIElvcHM6IHRoaXMuc3RvcmFnZU9wdGlvbnM/LmlvcHMsXG4gICAgICAgICAgVGhyb3VnaHB1dDogdGhpcy5zdG9yYWdlT3B0aW9ucz8udGhyb3VnaHB1dCxcbiAgICAgICAgfSxcbiAgICAgIH1dLFxuICAgICAgLy8gZW1wdHkgYW5kIG5vdCBtaXNzaW5nIGZvciBvbi1kZW1hbmRcbiAgICAgIC8vIHRoZSBzdGF0ZSByZWFkcyB0aGlzIHBhdGggbm8gbWF0dGVyIHdoYXQsIGFuZCBhIG1pc3NpbmcgcmVmZXJlbmNlIHBhdGggZmFpbHMgYXQgcnVudGltZVxuICAgICAgaW5zdGFuY2VNYXJrZXRPcHRpb25zOiB0aGlzLnNwb3QgPyB7XG4gICAgICAgIE1hcmtldFR5cGU6ICdzcG90JyxcbiAgICAgICAgU3BvdE9wdGlvbnM6IHtcbiAgICAgICAgICBNYXhQcmljZTogdGhpcy5zcG90TWF4UHJpY2UsXG4gICAgICAgICAgU3BvdEluc3RhbmNlVHlwZTogJ29uZS10aW1lJyxcbiAgICAgICAgfSxcbiAgICAgIH0gOiB7fSxcbiAgICAgIC8vIGluZGV4IGludG8gU3RhdGVzLkFycmF5KCRlYzJVc2VyRGF0YUxpbnV4LCAkZWMyVXNlckRhdGFXaW5kb3dzKVxuICAgICAgdXNlckRhdGFUZW1wbGF0ZUlkeDogdGhpcy5hbWkub3MuaXMoT3MuV0lORE9XUykgPyAxIDogMCxcbiAgICAgIC8vIGFsd2F5cyBoZXJlLCBldmVuIHdoZW4gZW1wdHksIGJlY2F1c2UgdGhhdCdzIHdoYXQgb3B0cyB1cyBpbnRvIHRoZSBzdGFuZGFyZCBydW5uZXIgdGFnc1xuICAgICAgLy8gc2VlIHNlbGVjdFByb3ZpZGVyUGFyYW1zKCkgaW4gcnVubmVyLnRzLCB3aGljaCBtZXJnZXMgdGhlbSBpbiBhdCBydW50aW1lXG4gICAgICB0YWdzOiBPYmplY3QuZW50cmllcyh0aGlzLnRhZ3MpLm1hcCgoW0tleSwgVmFsdWVdKSA9PiAoeyBLZXksIFZhbHVlIH0pKSxcbiAgICAgIHJ1bm5lckdyb3VwOiB0aGlzLmdyb3VwID8/ICcnLFxuICAgICAgaGVhcnRiZWF0U2Vjb25kczogdGhpcy5oZWFydGJlYXRUaW1lb3V0LnRvU2Vjb25kcygpLFxuICAgICAgZGVmYXVsdExhYmVsczogcnVubmVyRGVmYXVsdExhYmVscyh0aGlzLmFtaS5vcywgdGhpcy5hbWkuYXJjaGl0ZWN0dXJlLCB0aGlzLmRlZmF1bHRMYWJlbHMpLFxuICAgIH07XG5cbiAgICBsZXQgY29uZmlnOiBhbnkgPSB1bmRlZmluZWQ7XG4gICAgZm9yIChsZXQgaSA9IHRoaXMuc3VibmV0cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgY29uZmlnID0ge1xuICAgICAgICAuLi5iYXNlLFxuICAgICAgICBzdWJuZXQ6IHRoaXMuc3VibmV0c1tpXS5zdWJuZXRJZCxcbiAgICAgICAgLi4uY29uZmlnID8geyBmYWxsYmFjazogY29uZmlnIH0gOiB7fSxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiBjb25maWc7XG4gIH1cblxuICAvKipcbiAgICogQGludGVybmFsXG4gICAqL1xuICBfc3RhdHVzKHN0YXR1c0Z1bmN0aW9uUm9sZTogaWFtLklHcmFudGFibGUpOiBJUnVubmVyUHJvdmlkZXJTdGF0dXMge1xuICAgIHN0YXR1c0Z1bmN0aW9uUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2VjMjpEZXNjcmliZUxhdW5jaFRlbXBsYXRlVmVyc2lvbnMnXSxcbiAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHR5cGU6IHRoaXMuY29uc3RydWN0b3IubmFtZSxcbiAgICAgIGxhYmVsczogdGhpcy5sYWJlbHMsXG4gICAgICBjb25zdHJ1Y3RQYXRoOiB0aGlzLm5vZGUucGF0aCxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzLm1hcChzZyA9PiBzZy5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgcm9sZUFybjogdGhpcy5yb2xlLnJvbGVBcm4sXG4gICAgICBsb2dHcm91cDogdGhpcy5sb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBhbWk6IHtcbiAgICAgICAgbGF1bmNoVGVtcGxhdGU6IHRoaXMuYW1pLmxhdW5jaFRlbXBsYXRlLmxhdW5jaFRlbXBsYXRlSWQgfHwgJ3Vua25vd24nLFxuICAgICAgICBhbWlCdWlsZGVyTG9nR3JvdXA6IHRoaXMuYW1pLmxvZ0dyb3VwPy5sb2dHcm91cE5hbWUsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogVGhlIG5ldHdvcmsgY29ubmVjdGlvbnMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcmVzb3VyY2UuXG4gICAqL1xuICBwdWJsaWMgZ2V0IGNvbm5lY3Rpb25zKCk6IGVjMi5Db25uZWN0aW9ucyB7XG4gICAgcmV0dXJuIG5ldyBlYzIuQ29ubmVjdGlvbnMoeyBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3VwcyB9KTtcbiAgfVxufVxuXG4vKipcbiAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgRWMyUnVubmVyUHJvdmlkZXJ9XG4gKi9cbmV4cG9ydCBjbGFzcyBFYzJSdW5uZXIgZXh0ZW5kcyBFYzJSdW5uZXJQcm92aWRlciB7XG59XG5cbiJdfQ==