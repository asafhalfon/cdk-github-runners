"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Ec2Runner = exports.Ec2RunnerProvider = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_logs_1 = require("aws-cdk-lib/aws-logs");
const aws_stepfunctions_1 = require("aws-cdk-lib/aws-stepfunctions");
const common_1 = require("./common");
const image_builders_1 = require("../image-builders");
const utils_1 = require("../utils");
// this script is specifically made so `poweroff` is absolutely always called
// each `{}` is a variable coming from `params` below
const linuxUserDataTemplate = `#!/bin/bash -x
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

heartbeat () {
  while true; do
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
  aws stepfunctions send-task-failure --task-token "$TASK_TOKEN" |& tee -a /var/log/runner.log
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

Start-Job -ScriptBlock {
  while (1) {
    aws stepfunctions send-task-heartbeat --task-token "$using:TASK_TOKEN"
    sleep 60
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
  aws stepfunctions send-task-failure --task-token "$TASK_TOKEN" 2>&1 | Out-File -Encoding ASCII -Append /actions/runner.log
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
        this.defaultLabels = props?.defaultLabels ?? true;
        this.amiBuilder = props?.imageBuilder ?? props?.amiBuilder ?? Ec2RunnerProvider.imageBuilder(this, 'Ami Builder', {
            vpc: props?.vpc,
            subnetSelection: props?.subnetSelection,
            securityGroups: this.securityGroups,
        });
        this.ami = this.amiBuilder.bindAmi();
        if (this.amiBuilder instanceof image_builders_1.AwsImageBuilderRunnerImageBuilder) {
            if (this.amiBuilder.storageSize && this.storageSize.toBytes() < this.amiBuilder.storageSize.toBytes()) {
                throw new Error(`Runner storage size (${this.storageSize.toGibibytes()} GiB) must be at least the same as the image builder storage size (${this.amiBuilder.storageSize.toGibibytes()} GiB)`);
            }
        }
        if (!this.ami.architecture.instanceTypeMatch(this.instanceType)) {
            throw new Error(`AMI architecture (${this.ami.architecture.name}) doesn't match runner instance type (${this.instanceType} / ${this.instanceType.architecture})`);
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
        const passUserData = new aws_cdk_lib_1.aws_stepfunctions.Pass(this, 'Data', {
            stateName: (0, common_1.generateStateName)(this, 'data'),
            parameters: {
                userdataTemplate: this.ami.os.is(common_1.Os.WINDOWS) ? windowsUserDataTemplate : linuxUserDataTemplate,
            },
            resultPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.ec2'),
        });
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
                integrationPattern: aws_stepfunctions_1.IntegrationPattern.WAIT_FOR_TASK_TOKEN,
                service: 'ec2',
                action: 'runInstances',
                heartbeatTimeout: aws_cdk_lib_1.aws_stepfunctions.Timeout.duration(aws_cdk_lib_1.Duration.minutes(10)),
                parameters: {
                    LaunchTemplate: {
                        LaunchTemplateId: this.ami.launchTemplate.launchTemplateId,
                    },
                    MinCount: 1,
                    MaxCount: 1,
                    InstanceType: this.instanceType.toString(),
                    UserData: aws_cdk_lib_1.aws_stepfunctions.JsonPath.base64Encode(aws_cdk_lib_1.aws_stepfunctions.JsonPath.format(aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.ec2.userdataTemplate'), ...params)),
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
                    TagSpecifications: [
                        {
                            ResourceType: 'instance',
                            Tags: [{
                                    Key: 'GitHubRunners:Provider',
                                    Value: this.node.path,
                                }],
                        },
                        {
                            ResourceType: 'volume',
                            Tags: [{
                                    Key: 'GitHubRunners:Provider',
                                    Value: this.node.path,
                                }],
                        },
                    ],
                },
                iamResources: ['*'],
            });
        });
        // start with the first subnet
        passUserData.next(subnetRunners[0]);
        // chain up the rest of the subnets
        for (let i = 1; i < subnetRunners.length; i++) {
            subnetRunners[i - 1].addCatch(subnetRunners[i], {
                errors: ['Ec2.Ec2Exception', 'States.Timeout'],
                resultPath: aws_cdk_lib_1.aws_stepfunctions.JsonPath.stringAt('$.lastSubnetError'),
            });
        }
        return passUserData;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZWMyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL3Byb3ZpZGVycy9lYzIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7QUFBQSxtQ0FBbUM7QUFDbkMsNkNBU3FCO0FBQ3JCLG1EQUFxRDtBQUNyRCxxRUFBbUU7QUFFbkUscUNBYWtCO0FBQ2xCLHNEQU8yQjtBQUMzQixvQ0FBNEU7QUFFNUUsNkVBQTZFO0FBQzdFLHFEQUFxRDtBQUNyRCxNQUFNLHFCQUFxQixHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Q0FpRjdCLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUM7QUFFckUsNkVBQTZFO0FBQzdFLG1HQUFtRztBQUNuRyxNQUFNLHVCQUF1QixHQUFHOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0NBa0YvQixDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxDQUFDO0FBdUhyRTs7OztHQUlHO0FBQ0gsTUFBYSxpQkFBa0IsU0FBUSxxQkFBWTtJQUNqRDs7Ozs7Ozs7Ozs7Ozs7Ozs7O09Ba0JHO0lBQ0ksTUFBTSxDQUFDLFlBQVksQ0FBQyxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUErQjtRQUN0RixPQUFPLG1DQUFrQixDQUFDLEdBQUcsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQ3ZDLEVBQUUsRUFBRSxXQUFFLENBQUMs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LGlCQUFpQjs7QUFBaEQsOEJBQ0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHtcbiAgYXdzX2VjMiBhcyBlYzIsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBhd3Nfc3RlcGZ1bmN0aW9ucyBhcyBzdGVwZnVuY3Rpb25zLFxuICBhd3Nfc3RlcGZ1bmN0aW9uc190YXNrcyBhcyBzdGVwZnVuY3Rpb25zX3Rhc2tzLFxuICBEdXJhdGlvbixcbiAgUmVtb3ZhbFBvbGljeSxcbiAgU3RhY2ssXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFJldGVudGlvbkRheXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBJbnRlZ3JhdGlvblBhdHRlcm4gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3RlcGZ1bmN0aW9ucyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7XG4gIGFtaVJvb3REZXZpY2UsXG4gIEFyY2hpdGVjdHVyZSxcbiAgQmFzZVByb3ZpZGVyLFxuICBJUnVubmVyUHJvdmlkZXIsXG4gIElSdW5uZXJQcm92aWRlclN0YXR1cyxcbiAgT3MsXG4gIFJ1bm5lckFtaSxcbiAgUnVubmVyUHJvdmlkZXJQcm9wcyxcbiAgUnVubmVyUnVudGltZVBhcmFtZXRlcnMsXG4gIFJ1bm5lclZlcnNpb24sXG4gIGdlbmVyYXRlU3RhdGVOYW1lLFxuICBTdG9yYWdlT3B0aW9ucyxcbn0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHtcbiAgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyLFxuICBJUnVubmVySW1hZ2VCdWlsZGVyLFxuICBSdW5uZXJJbWFnZUJ1aWxkZXIsXG4gIFJ1bm5lckltYWdlQnVpbGRlclByb3BzLFxuICBSdW5uZXJJbWFnZUJ1aWxkZXJUeXBlLFxuICBSdW5uZXJJbWFnZUNvbXBvbmVudCxcbn0gZnJvbSAnLi4vaW1hZ2UtYnVpbGRlcnMnO1xuaW1wb3J0IHsgTUlOSU1BTF9FQzJfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UIH0gZnJvbSAnLi4vdXRpbHMnO1xuXG4vLyB0aGlzIHNjcmlwdCBpcyBzcGVjaWZpY2FsbHkgbWFkZSBzbyBgcG93ZXJvZmZgIGlzIGFic29sdXRlbHkgYWx3YXlzIGNhbGxlZFxuLy8gZWFjaCBge31gIGlzIGEgdmFyaWFibGUgY29taW5nIGZyb20gYHBhcmFtc2AgYmVsb3dcbmNvbnN0IGxpbnV4VXNlckRhdGFUZW1wbGF0ZSA9IGAjIS9iaW4vYmFzaCAteFxuVEFTS19UT0tFTj1cInt9XCJcbmxvZ0dyb3VwTmFtZT1cInt9XCJcbnJ1bm5lck5hbWVQYXRoPVwie31cIlxuZ2l0aHViRG9tYWluUGF0aD1cInt9XCJcbm93bmVyUGF0aD1cInt9XCJcbnJlcG9QYXRoPVwie31cIlxucnVubmVyVG9rZW5QYXRoPVwie31cIlxubGFiZWxzPVwie31cIlxucmVnaXN0cmF0aW9uVVJMPVwie31cIlxucnVubmVyR3JvdXAxPVwie31cIlxucnVubmVyR3JvdXAyPVwie31cIlxuZGVmYXVsdExhYmVscz1cInt9XCJcbmppdENvbmZpZz1cInt9XCJcblxuZXhwb3J0IEFXU19SRVRSWV9NT0RFPXN0YW5kYXJkICMgYmV0dGVyIHJldHJ5XG5cbmhlYXJ0YmVhdCAoKSB7XG4gIHdoaWxlIHRydWU7IGRvXG4gICAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLWhlYXJ0YmVhdCAtLXRhc2stdG9rZW4gXCIkVEFTS19UT0tFTlwiXG4gICAgc2xlZXAgNjBcbiAgZG9uZVxufVxuc2V0dXBfbG9ncyAoKSB7XG4gIGNhdCA8PEVPRiA+IC90bXAvbG9nLmNvbmYgfHwgZXhpdCAxXG4gIHtcbiAgICBcImxvZ3NcIjoge1xuICAgICAgXCJsb2dfc3RyZWFtX25hbWVcIjogXCJ1bmtub3duXCIsXG4gICAgICBcImxvZ3NfY29sbGVjdGVkXCI6IHtcbiAgICAgICAgXCJmaWxlc1wiOiB7XG4gICAgICAgICAgXCJjb2xsZWN0X2xpc3RcIjogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBcImZpbGVfcGF0aFwiOiBcIi92YXIvbG9nL3J1bm5lci5sb2dcIixcbiAgICAgICAgICAgICAgXCJsb2dfZ3JvdXBfbmFtZVwiOiBcIiRsb2dHcm91cE5hbWVcIixcbiAgICAgICAgICAgICAgXCJsb2dfc3RyZWFtX25hbWVcIjogXCIkcnVubmVyTmFtZVBhdGhcIixcbiAgICAgICAgICAgICAgXCJ0aW1lem9uZVwiOiBcIlVUQ1wiXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5FT0ZcbiAgL29wdC9hd3MvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQvYmluL2FtYXpvbi1jbG91ZHdhdGNoLWFnZW50LWN0bCAtYSBmZXRjaC1jb25maWcgLW0gZWMyIC1zIC1jIGZpbGU6L3RtcC9sb2cuY29uZiB8fCBleGl0IDJcbn1cbmFjdGlvbiAoKSB7XG4gIGlmIFsgLW4gXCIkaml0Q29uZmlnXCIgXTsgdGhlblxuICAgICMgSklUIG1vZGU6IGNsZWFuZXIgcmVnaXN0cmF0aW9uLCBubyBjb25maWcuc2ggbmVlZGVkXG4gICAgc3VkbyAtLXByZXNlcnZlLWVudj1BV1NfUkVHSU9OIC1IdSBydW5uZXIgL2hvbWUvcnVubmVyL3J1bi5zaCAtLWppdGNvbmZpZyBcIiRqaXRDb25maWdcIiB8fCBleGl0IDJcbiAgZWxzZVxuICAgICMgTGVnYWN5IG1vZGU6IHJlZ2lzdGVyIHJ1bm5lciB0byBwb29sIHdpdGggdG9rZW5cbiAgICAjIERldGVybWluZSB0aGUgdmFsdWUgb2YgUlVOTkVSX0ZMQUdTXG4gICAgaWYgWyBcIiQoPCAvaG9tZS9ydW5uZXIvUlVOTkVSX1ZFUlNJT04pXCIgPSBcImxhdGVzdFwiIF07IHRoZW5cbiAgICAgIFJVTk5FUl9GTEFHUz1cIlwiXG4gICAgZWxzZVxuICAgICAgUlVOTkVSX0ZMQUdTPVwiLS1kaXNhYmxldXBkYXRlXCJcbiAgICBmaVxuXG4gICAgbGFiZWxzVGVtcGxhdGU9XCIkbGFiZWxzLGNka2docjpzdGFydGVkOiQoZGF0ZSArJXMpXCJcblxuICAgICMgRXhlY3V0ZSB0aGUgY29uZmlndXJhdGlvbiBjb21tYW5kIGZvciBydW5uZXIgcmVnaXN0cmF0aW9uXG4gICAgc3VkbyAtSHUgcnVubmVyIC9ob21lL3J1bm5lci9jb25maWcuc2ggLS11bmF0dGVuZGVkIC0tdXJsIFwiJHJlZ2lzdHJhdGlvblVSTFwiIC0tdG9rZW4gXCIkcnVubmVyVG9rZW5QYXRoXCIgLS1lcGhlbWVyYWwgLS13b3JrIF93b3JrIC0tbGFiZWxzIFwiJGxhYmVsc1RlbXBsYXRlXCIgJFJVTk5FUl9GTEFHUyAtLW5hbWUgXCIkcnVubmVyTmFtZVBhdGhcIiAkcnVubmVyR3JvdXAxICRydW5uZXJHcm91cDIgJGRlZmF1bHRMYWJlbHMgfHwgZXhpdCAxXG5cbiAgICAjIEV4ZWN1dGUgdGhlIHJ1biBjb21tYW5kXG4gICAgc3VkbyAtLXByZXNlcnZlLWVudj1BV1NfUkVHSU9OIC1IdSBydW5uZXIgL2hvbWUvcnVubmVyL3J1bi5zaCB8fCBleGl0IDJcbiAgZmlcblxuICAjIFJldHJpZXZlIHRoZSBzdGF0dXNcbiAgU1RBVFVTPSQoZ3JlcCAtUGhvcnMgXCJmaW5pc2ggam9iIHJlcXVlc3QgZm9yIGpvYiBbMC05YS1mLV0rIHdpdGggcmVzdWx0OiAuKlwiIC9ob21lL3J1bm5lci9fZGlhZy8gfCB0YWlsIC1uMSB8IGF3ayAne3ByaW50ICRORn0nKVxuXG4gICMgQ2hlY2sgYW5kIHByaW50IHRoZSBqb2Igc3RhdHVzXG4gIFsgLW4gXCIkU1RBVFVTXCIgXSAmJiBlY2hvIENES0dIQSBKT0IgRE9ORSBcIiRsYWJlbHNcIiBcIiRTVEFUVVNcIlxufVxuaGVhcnRiZWF0ICZcbmlmIHNldHVwX2xvZ3MgJiYgYWN0aW9uIHwmIHRlZSAvdmFyL2xvZy9ydW5uZXIubG9nOyB0aGVuXG4gIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1zdWNjZXNzIC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgLS10YXNrLW91dHB1dCAne1wib2tcIjogdHJ1ZX0nIHwmIHRlZSAtYSAvdmFyL2xvZy9ydW5uZXIubG9nXG5lbHNlXG4gIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1mYWlsdXJlIC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgfCYgdGVlIC1hIC92YXIvbG9nL3J1bm5lci5sb2dcbmZpXG5zbGVlcCAxMCAgIyBnaXZlIGNsb3Vkd2F0Y2ggYWdlbnQgaXRzIGRlZmF1bHQgNSBzZWNvbmRzIGJ1ZmZlciBkdXJhdGlvbiB0byB1cGxvYWQgbG9nc1xucG93ZXJvZmZcbmAucmVwbGFjZSgvey9nLCAnXFxcXHsnKS5yZXBsYWNlKC99L2csICdcXFxcfScpLnJlcGxhY2UoL1xcXFx7XFxcXH0vZywgJ3t9Jyk7XG5cbi8vIHRoaXMgc2NyaXB0IGlzIHNwZWNpZmljYWxseSBtYWRlIHNvIGBwb3dlcm9mZmAgaXMgYWJzb2x1dGVseSBhbHdheXMgY2FsbGVkXG4vLyBlYWNoIGB7fWAgaXMgYSB2YXJpYWJsZSBjb21pbmcgZnJvbSBgcGFyYW1zYCBiZWxvdyBhbmQgdGhlaXIgb3JkZXIgc2hvdWxkIG1hdGNoIHRoZSBsaW51eCBzY3JpcHRcbmNvbnN0IHdpbmRvd3NVc2VyRGF0YVRlbXBsYXRlID0gYDxwb3dlcnNoZWxsPlxuJFRBU0tfVE9LRU4gPSBcInt9XCJcbiRsb2dHcm91cE5hbWU9XCJ7fVwiXG4kcnVubmVyTmFtZVBhdGg9XCJ7fVwiXG4kZ2l0aHViRG9tYWluUGF0aD1cInt9XCJcbiRvd25lclBhdGg9XCJ7fVwiXG4kcmVwb1BhdGg9XCJ7fVwiXG4kcnVubmVyVG9rZW5QYXRoPVwie31cIlxuJGxhYmVscz1cInt9XCJcbiRyZWdpc3RyYXRpb25VUkw9XCJ7fVwiXG4kcnVubmVyR3JvdXAxPVwie31cIlxuJHJ1bm5lckdyb3VwMj1cInt9XCJcbiRkZWZhdWx0TGFiZWxzPVwie31cIlxuJGppdENvbmZpZz1cInt9XCJcblxuJEVudjpBV1NfUkVUUllfTU9ERSA9IFwic3RhbmRhcmRcIiAgIyBiZXR0ZXIgcmV0cnlcblxuIyBFQzJMYXVuY2ggb25seSBzdGFydHMgc3NtIGFnZW50IGFmdGVyIHVzZXIgZGF0YSBpcyBkb25lLCBzbyB3ZSBuZWVkIHRvIHN0YXJ0IGl0IG91cnNlbHZlcyAoaXQgaXMgZGlzYWJsZWQgYnkgZGVmYXVsdClcblNldC1TZXJ2aWNlIC1TdGFydHVwVHlwZSBNYW51YWwgQW1hem9uU1NNQWdlbnRcblN0YXJ0LVNlcnZpY2UgQW1hem9uU1NNQWdlbnRcblxuU3RhcnQtSm9iIC1TY3JpcHRCbG9jayB7XG4gIHdoaWxlICgxKSB7XG4gICAgYXdzIHN0ZXBmdW5jdGlvbnMgc2VuZC10YXNrLWhlYXJ0YmVhdCAtLXRhc2stdG9rZW4gXCIkdXNpbmc6VEFTS19UT0tFTlwiXG4gICAgc2xlZXAgNjBcbiAgfVxufVxuZnVuY3Rpb24gc2V0dXBfbG9ncyAoKSB7XG4gIGVjaG8gXCJ7XG4gICAgXFxgXCJsb2dzXFxgXCI6IHtcbiAgICAgIFxcYFwibG9nX3N0cmVhbV9uYW1lXFxgXCI6IFxcYFwidW5rbm93blxcYFwiLFxuICAgICAgXFxgXCJsb2dzX2NvbGxlY3RlZFxcYFwiOiB7XG4gICAgICAgIFxcYFwiZmlsZXNcXGBcIjoge1xuICAgICAgICAgXFxgXCJjb2xsZWN0X2xpc3RcXGBcIjogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBcXGBcImZpbGVfcGF0aFxcYFwiOiBcXGBcIi9hY3Rpb25zL3J1bm5lci5sb2dcXGBcIixcbiAgICAgICAgICAgICAgXFxgXCJsb2dfZ3JvdXBfbmFtZVxcYFwiOiBcXGBcIiRsb2dHcm91cE5hbWVcXGBcIixcbiAgICAgICAgICAgICAgXFxgXCJsb2dfc3RyZWFtX25hbWVcXGBcIjogXFxgXCIkcnVubmVyTmFtZVBhdGhcXGBcIixcbiAgICAgICAgICAgICAgXFxgXCJ0aW1lem9uZVxcYFwiOiBcXGBcIlVUQ1xcYFwiXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XCIgfCBPdXQtRmlsZSAtRW5jb2RpbmcgQVNDSUkgJEVudjpURU1QL2xvZy5jb25mXG4gICYgXCJDOi9Qcm9ncmFtIEZpbGVzL0FtYXpvbi9BbWF6b25DbG91ZFdhdGNoQWdlbnQvYW1hem9uLWNsb3Vkd2F0Y2gtYWdlbnQtY3RsLnBzMVwiIC1hIGZldGNoLWNvbmZpZyAtbSBlYzIgLXMgLWMgZmlsZTokRW52OlRFTVAvbG9nLmNvbmZcbn1cbmZ1bmN0aW9uIGFjdGlvbiAoKSB7XG4gIGNkIC9hY3Rpb25zXG4gIGlmICgkaml0Q29uZmlnIC1uZSBcIlwiKSB7XG4gICAgIyBKSVQgbW9kZTogY2xlYW5lciByZWdpc3RyYXRpb24sIG5vIGNvbmZpZy5jbWQgbmVlZGVkXG4gICAgLi9ydW4uY21kIC0taml0Y29uZmlnIFwiJGppdENvbmZpZ1wiIDI+JjEgfCBPdXQtRmlsZSAtRW5jb2RpbmcgQVNDSUkgLUFwcGVuZCAvYWN0aW9ucy9ydW5uZXIubG9nXG4gICAgaWYgKCRMQVNURVhJVENPREUgLW5lIDApIHsgcmV0dXJuIDIgfVxuICB9IGVsc2Uge1xuICAgICMgTGVnYWN5IG1vZGU6IHJlZ2lzdGVyIHJ1bm5lciB0byBwb29sIHdpdGggdG9rZW5cbiAgICAkUnVubmVyVmVyc2lvbiA9IEdldC1Db250ZW50IC9hY3Rpb25zL1JVTk5FUl9WRVJTSU9OIC1SYXdcbiAgICBpZiAoJFJ1bm5lclZlcnNpb24gLWVxIFwibGF0ZXN0XCIpIHsgJFJ1bm5lckZsYWdzID0gXCJcIiB9IGVsc2UgeyAkUnVubmVyRmxhZ3MgPSBcIi0tZGlzYWJsZXVwZGF0ZVwiIH1cbiAgICAuL2NvbmZpZy5jbWQgLS11bmF0dGVuZGVkIC0tdXJsIFwiXFwke3JlZ2lzdHJhdGlvblVybH1cIiAtLXRva2VuIFwiXFwke3J1bm5lclRva2VuUGF0aH1cIiAtLWVwaGVtZXJhbCAtLXdvcmsgX3dvcmsgLS1sYWJlbHMgXCJcXCR7bGFiZWxzfSxjZGtnaHI6c3RhcnRlZDokKEdldC1EYXRlIC1VRm9ybWF0ICslcylcIiAkUnVubmVyRmxhZ3MgLS1uYW1lIFwiXFwke3J1bm5lck5hbWVQYXRofVwiIFxcJHtydW5uZXJHcm91cDF9IFxcJHtydW5uZXJHcm91cDJ9IFxcJHtkZWZhdWx0TGFiZWxzfSAyPiYxIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xuXG4gICAgaWYgKCRMQVNURVhJVENPREUgLW5lIDApIHsgcmV0dXJuIDEgfVxuICAgIC4vcnVuLmNtZCAyPiYxIHwgT3V0LUZpbGUgLUVuY29kaW5nIEFTQ0lJIC1BcHBlbmQgL2FjdGlvbnMvcnVubmVyLmxvZ1xuICAgIGlmICgkTEFTVEVYSVRDT0RFIC1uZSAwKSB7IHJldHVybiAyIH1cbiAgfVxuXG4gICRTVEFUVVMgPSBTZWxlY3QtU3RyaW5nIC1QYXRoICcuL19kaWFnLyoubG9nJyAtUGF0dGVybiAnZmluaXNoIGpvYiByZXF1ZXN0IGZvciBqb2IgWzAtOWEtZlxcXFwtXSsgd2l0aCByZXN1bHQ6ICguKiknIHwgJXskXy5NYXRjaGVzLkdyb3Vwc1sxXS5WYWx1ZX0gfCBTZWxlY3QtT2JqZWN0IC1MYXN0IDFcblxuICBpZiAoJFNUQVRVUykge1xuICAgICAgZWNobyBcIkNES0dIQSBKT0IgRE9ORSBcXCR7bGFiZWxzfSAkU1RBVFVTXCIgfCBPdXQtRmlsZSAtRW5jb2RpbmcgQVNDSUkgLUFwcGVuZCAvYWN0aW9ucy9ydW5uZXIubG9nXG4gIH1cblxuICByZXR1cm4gMFxufVxuc2V0dXBfbG9nc1xuJHIgPSBhY3Rpb25cbmlmICgkciAtZXEgMCkge1xuICBhd3Mgc3RlcGZ1bmN0aW9ucyBzZW5kLXRhc2stc3VjY2VzcyAtLXRhc2stdG9rZW4gXCIkVEFTS19UT0tFTlwiIC0tdGFzay1vdXRwdXQgJ3sgfScgMj4mMSB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcbn0gZWxzZSB7XG4gIGF3cyBzdGVwZnVuY3Rpb25zIHNlbmQtdGFzay1mYWlsdXJlIC0tdGFzay10b2tlbiBcIiRUQVNLX1RPS0VOXCIgMj4mMSB8IE91dC1GaWxlIC1FbmNvZGluZyBBU0NJSSAtQXBwZW5kIC9hY3Rpb25zL3J1bm5lci5sb2dcbn1cblN0YXJ0LVNsZWVwIC1TZWNvbmRzIDEwICAjIGdpdmUgY2xvdWR3YXRjaCBhZ2VudCBpdHMgZGVmYXVsdCA1IHNlY29uZHMgYnVmZmVyIGR1cmF0aW9uIHRvIHVwbG9hZCBsb2dzXG5TdG9wLUNvbXB1dGVyIC1Db21wdXRlck5hbWUgbG9jYWxob3N0IC1Gb3JjZVxuPC9wb3dlcnNoZWxsPlxuYC5yZXBsYWNlKC97L2csICdcXFxceycpLnJlcGxhY2UoL30vZywgJ1xcXFx9JykucmVwbGFjZSgvXFxcXHtcXFxcfS9nLCAne30nKTtcblxuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIHtAbGluayBFYzJSdW5uZXJQcm92aWRlcn0gY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEVjMlJ1bm5lclByb3ZpZGVyUHJvcHMgZXh0ZW5kcyBSdW5uZXJQcm92aWRlclByb3BzIHtcbiAgLyoqXG4gICAqIFJ1bm5lciBpbWFnZSBidWlsZGVyIHVzZWQgdG8gYnVpbGQgQU1JIGNvbnRhaW5pbmcgR2l0SHViIFJ1bm5lciBhbmQgYWxsIHJlcXVpcmVtZW50cy5cbiAgICpcbiAgICogVGhlIGltYWdlIGJ1aWxkZXIgZGV0ZXJtaW5lcyB0aGUgT1MgYW5kIGFyY2hpdGVjdHVyZSBvZiB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBFYzJSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIoKVxuICAgKi9cbiAgcmVhZG9ubHkgaW1hZ2VCdWlsZGVyPzogSVJ1bm5lckltYWdlQnVpbGRlcjtcblxuICAvKipcbiAgICogQGRlcHJlY2F0ZWQgdXNlIGltYWdlQnVpbGRlclxuICAgKi9cbiAgcmVhZG9ubHkgYW1pQnVpbGRlcj86IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG5cbiAgLyoqXG4gICAqIEdpdEh1YiBBY3Rpb25zIGxhYmVscyB1c2VkIGZvciB0aGlzIHByb3ZpZGVyLlxuICAgKlxuICAgKiBUaGVzZSBsYWJlbHMgYXJlIHVzZWQgdG8gaWRlbnRpZnkgd2hpY2ggcHJvdmlkZXIgc2hvdWxkIHNwYXduIGEgbmV3IG9uLWRlbWFuZCBydW5uZXIuIEV2ZXJ5IGpvYiBzZW5kcyBhIHdlYmhvb2sgd2l0aCB0aGUgbGFiZWxzIGl0J3MgbG9va2luZyBmb3JcbiAgICogYmFzZWQgb24gcnVucy1vbi4gV2UgbWF0Y2ggdGhlIGxhYmVscyBmcm9tIHRoZSB3ZWJob29rIHdpdGggdGhlIGxhYmVscyBzcGVjaWZpZWQgaGVyZS4gSWYgYWxsIHRoZSBsYWJlbHMgc3BlY2lmaWVkIGhlcmUgYXJlIHByZXNlbnQgaW4gdGhlXG4gICAqIGpvYidzIGxhYmVscywgdGhpcyBwcm92aWRlciB3aWxsIGJlIGNob3NlbiBhbmQgc3Bhd24gYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCBbJ2VjMiddXG4gICAqL1xuICByZWFkb25seSBsYWJlbHM/OiBzdHJpbmdbXTtcblxuICAvKipcbiAgICogR2l0SHViIEFjdGlvbnMgcnVubmVyIGdyb3VwIG5hbWUuXG4gICAqXG4gICAqIElmIHNwZWNpZmllZCwgdGhlIHJ1bm5lciB3aWxsIGJlIHJlZ2lzdGVyZWQgd2l0aCB0aGlzIGdyb3VwIG5hbWUuIFNldHRpbmcgYSBydW5uZXIgZ3JvdXAgY2FuIGhlbHAgbWFuYWdpbmcgYWNjZXNzIHRvIHNlbGYtaG9zdGVkIHJ1bm5lcnMuIEl0XG4gICAqIHJlcXVpcmVzIGEgcGFpZCBHaXRIdWIgYWNjb3VudC5cbiAgICpcbiAgICogVGhlIGdyb3VwIG11c3QgZXhpc3Qgb3IgdGhlIHJ1bm5lciB3aWxsIG5vdCBzdGFydC5cbiAgICpcbiAgICogVXNlcnMgd2lsbCBzdGlsbCBiZSBhYmxlIHRvIHRyaWdnZXIgdGhpcyBydW5uZXIgd2l0aCB0aGUgY29ycmVjdCBsYWJlbHMuIEJ1dCB0aGUgcnVubmVyIHdpbGwgb25seSBiZSBhYmxlIHRvIHJ1biBqb2JzIGZyb20gcmVwb3MgYWxsb3dlZCB0byB1c2UgdGhlIGdyb3VwLlxuICAgKlxuICAgKiBAZGVmYXVsdCB1bmRlZmluZWRcbiAgICovXG4gIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBJbnN0YW5jZSB0eXBlIGZvciBsYXVuY2hlZCBydW5uZXIgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBtNmkubGFyZ2VcbiAgICovXG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZT86IGVjMi5JbnN0YW5jZVR5cGU7XG5cbiAgLyoqXG4gICAqIFNpemUgb2Ygdm9sdW1lIGF2YWlsYWJsZSBmb3IgbGF1bmNoZWQgcnVubmVyIGluc3RhbmNlcy4gVGhpcyBtb2RpZmllcyB0aGUgYm9vdCB2b2x1bWUgc2l6ZSBhbmQgZG9lc24ndCBhZGQgYW55IGFkZGl0aW9uYWwgdm9sdW1lcy5cbiAgICpcbiAgICogQGRlZmF1bHQgMzBHQlxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZVNpemU/OiBjZGsuU2l6ZTtcblxuICAvKipcbiAgICogT3B0aW9ucyBmb3IgcnVubmVyIGluc3RhbmNlIHN0b3JhZ2Ugdm9sdW1lLlxuICAgKi9cbiAgcmVhZG9ubHkgc3RvcmFnZU9wdGlvbnM/OiBTdG9yYWdlT3B0aW9ucztcblxuICAvKipcbiAgICogU2VjdXJpdHkgR3JvdXAgdG8gYXNzaWduIHRvIGxhdW5jaGVkIHJ1bm5lciBpbnN0YW5jZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IGEgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgc2VjdXJpdHlHcm91cHN9XG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwPzogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgdG8gYXNzaWduIHRvIGxhdW5jaGVkIHJ1bm5lciBpbnN0YW5jZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IGEgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3Vwcz86IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIC8qKlxuICAgKiBTdWJuZXQgd2hlcmUgdGhlIHJ1bm5lciBpbnN0YW5jZXMgd2lsbCBiZSBsYXVuY2hlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBzdWJuZXQgb2YgYWNjb3VudCdzIGRlZmF1bHQgVlBDXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgdnBjfSBhbmQge0BsaW5rIHN1Ym5ldFNlbGVjdGlvbn1cbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldD86IGVjMi5JU3VibmV0O1xuXG4gIC8qKlxuICAgKiBWUEMgd2hlcmUgcnVubmVyIGluc3RhbmNlcyB3aWxsIGJlIGxhdW5jaGVkLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IGFjY291bnQgVlBDXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogV2hlcmUgdG8gcGxhY2UgdGhlIG5ldHdvcmsgaW50ZXJmYWNlcyB3aXRoaW4gdGhlIFZQQy4gT25seSB0aGUgZmlyc3QgbWF0Y2hlZCBzdWJuZXQgd2lsbCBiZSB1c2VkLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IFZQQyBzdWJuZXRcbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIFVzZSBzcG90IGluc3RhbmNlcyB0byBzYXZlIG1vbmV5LiBTcG90IGluc3RhbmNlcyBhcmUgY2hlYXBlciBidXQgbm90IGFsd2F5cyBhdmFpbGFibGUgYW5kIGNhbiBiZSBzdG9wcGVkIHByZW1hdHVyZWx5LlxuICAgKlxuICAgKiBAZGVmYXVsdCBmYWxzZVxuICAgKi9cbiAgcmVhZG9ubHkgc3BvdD86IGJvb2xlYW47XG5cbiAgLyoqXG4gICAqIFNldCBhIG1heGltdW0gcHJpY2UgZm9yIHNwb3QgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBubyBtYXggcHJpY2UgKHlvdSB3aWxsIHBheSBjdXJyZW50IHNwb3QgcHJpY2UpXG4gICAqL1xuICByZWFkb25seSBzcG90TWF4UHJpY2U/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogR2l0SHViIEFjdGlvbnMgcnVubmVyIHByb3ZpZGVyIHVzaW5nIEVDMiB0byBleGVjdXRlIGpvYnMuXG4gKlxuICogVGhpcyBjb25zdHJ1Y3QgaXMgbm90IG1lYW50IHRvIGJlIHVzZWQgYnkgaXRzZWxmLiBJdCBzaG91bGQgYmUgcGFzc2VkIGluIHRoZSBwcm92aWRlcnMgcHJvcGVydHkgZm9yIEdpdEh1YlJ1bm5lcnMuXG4gKi9cbmV4cG9ydCBjbGFzcyBFYzJSdW5uZXJQcm92aWRlciBleHRlbmRzIEJhc2VQcm92aWRlciBpbXBsZW1lbnRzIElSdW5uZXJQcm92aWRlciB7XG4gIC8qKlxuICAgKiBDcmVhdGUgbmV3IGltYWdlIGJ1aWxkZXIgdGhhdCBidWlsZHMgRUMyIHNwZWNpZmljIHJ1bm5lciBpbWFnZXMuXG4gICAqXG4gICAqIFlvdSBjYW4gY3VzdG9taXplIHRoZSBPUywgYXJjaGl0ZWN0dXJlLCBWUEMsIHN1Ym5ldCwgc2VjdXJpdHkgZ3JvdXBzLCBldGMuIGJ5IHBhc3NpbmcgaW4gcHJvcHMuXG4gICAqXG4gICAqIFlvdSBjYW4gYWRkIGNvbXBvbmVudHMgdG8gdGhlIGltYWdlIGJ1aWxkZXIgYnkgY2FsbGluZyBgaW1hZ2VCdWlsZGVyLmFkZENvbXBvbmVudCgpYC5cbiAgICpcbiAgICogVGhlIGRlZmF1bHQgT1MgaXMgVWJ1bnR1IHJ1bm5pbmcgb24geDY0IGFyY2hpdGVjdHVyZS5cbiAgICpcbiAgICogSW5jbHVkZWQgY29tcG9uZW50czpcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LnJlcXVpcmVkUGFja2FnZXMoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmNsb3VkV2F0Y2hBZ2VudCgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQucnVubmVyVXNlcigpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0KClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJDbGkoKWBcbiAgICogICogYFJ1bm5lckltYWdlQ29tcG9uZW50LmF3c0NsaSgpYFxuICAgKiAgKiBgUnVubmVySW1hZ2VDb21wb25lbnQuZG9ja2VyKClgXG4gICAqICAqIGBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXRodWJSdW5uZXIoKWBcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgaW1hZ2VCdWlsZGVyKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMpIHtcbiAgICByZXR1cm4gUnVubmVySW1hZ2VCdWlsZGVyLm5ldyhzY29wZSwgaWQsIHtcbiAgICAgIG9zOiBPcy5MSU5VWF9VQlVOVFUsXG4gICAgICBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZS5YODZfNjQsXG4gICAgICBidWlsZGVyVHlwZTogUnVubmVySW1hZ2VCdWlsZGVyVHlwZS5BV1NfSU1BR0VfQlVJTERFUixcbiAgICAgIGNvbXBvbmVudHM6IFtcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucmVxdWlyZWRQYWNrYWdlcygpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5jbG91ZFdhdGNoQWdlbnQoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQucnVubmVyVXNlcigpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5naXQoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViQ2xpKCksXG4gICAgICAgIFJ1bm5lckltYWdlQ29tcG9uZW50LmF3c0NsaSgpLFxuICAgICAgICBSdW5uZXJJbWFnZUNvbXBvbmVudC5kb2NrZXIoKSxcbiAgICAgICAgUnVubmVySW1hZ2VDb21wb25lbnQuZ2l0aHViUnVubmVyKHByb3BzPy5ydW5uZXJWZXJzaW9uID8/IFJ1bm5lclZlcnNpb24ubGF0ZXN0KCkpLFxuICAgICAgXSxcbiAgICAgIC4uLnByb3BzLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIExhYmVscyBhc3NvY2lhdGVkIHdpdGggdGhpcyBwcm92aWRlci5cbiAgICovXG4gIHJlYWRvbmx5IGxhYmVsczogc3RyaW5nW107XG5cbiAgLyoqXG4gICAqIEdyYW50IHByaW5jaXBhbCB1c2VkIHRvIGFkZCBwZXJtaXNzaW9ucyB0byB0aGUgcnVubmVyIHJvbGUuXG4gICAqL1xuICByZWFkb25seSBncmFudFByaW5jaXBhbDogaWFtLklQcmluY2lwYWw7XG5cbiAgLyoqXG4gICAqIExvZyBncm91cCB3aGVyZSBwcm92aWRlZCBydW5uZXJzIHdpbGwgc2F2ZSB0aGVpciBsb2dzLlxuICAgKlxuICAgKiBOb3RlIHRoYXQgdGhpcyBpcyBub3QgdGhlIGpvYiBsb2csIGJ1dCB0aGUgcnVubmVyIGl0c2VsZi4gSXQgd2lsbCBub3QgY29udGFpbiBvdXRwdXQgZnJvbSB0aGUgR2l0SHViIEFjdGlvbiBidXQgb25seSBtZXRhZGF0YSBvbiBpdHMgZXhlY3V0aW9uLlxuICAgKi9cbiAgcmVhZG9ubHkgbG9nR3JvdXA6IGxvZ3MuSUxvZ0dyb3VwO1xuXG4gIHJlYWRvbmx5IHJldHJ5YWJsZUVycm9ycyA9IFtcbiAgICAnRWMyLkVjMkV4Y2VwdGlvbicsXG4gICAgJ1N0YXRlcy5UaW1lb3V0JyxcbiAgXTtcblxuICBwcml2YXRlIHJlYWRvbmx5IGdyb3VwPzogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGFtaUJ1aWxkZXI6IElSdW5uZXJJbWFnZUJ1aWxkZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgYW1pOiBSdW5uZXJBbWk7XG4gIHByaXZhdGUgcmVhZG9ubHkgcm9sZTogaWFtLlJvbGU7XG4gIHByaXZhdGUgcmVhZG9ubHkgaW5zdGFuY2VUeXBlOiBlYzIuSW5zdGFuY2VUeXBlO1xuICBwcml2YXRlIHJlYWRvbmx5IHN0b3JhZ2VTaXplOiBjZGsuU2l6ZTtcbiAgcHJpdmF0ZSByZWFkb25seSBzdG9yYWdlT3B0aW9ucz86IFN0b3JhZ2VPcHRpb25zO1xuICBwcml2YXRlIHJlYWRvbmx5IHNwb3Q6IGJvb2xlYW47XG4gIHByaXZhdGUgcmVhZG9ubHkgc3BvdE1heFByaWNlOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgdnBjOiBlYzIuSVZwYztcbiAgcHJpdmF0ZSByZWFkb25seSBzdWJuZXRzOiBlYzIuSVN1Ym5ldFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBkZWZhdWx0TGFiZWxzOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogRWMyUnVubmVyUHJvdmlkZXJQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgdGhpcy5sYWJlbHMgPSBwcm9wcz8ubGFiZWxzID8/IFsnZWMyJ107XG4gICAgdGhpcy5ncm91cCA9IHByb3BzPy5ncm91cDtcbiAgICB0aGlzLnZwYyA9IHByb3BzPy52cGMgPz8gZWMyLlZwYy5mcm9tTG9va3VwKHRoaXMsICdEZWZhdWx0IFZQQycsIHsgaXNEZWZhdWx0OiB0cnVlIH0pO1xuICAgIHRoaXMuc2VjdXJpdHlHcm91cHMgPSBwcm9wcz8uc2VjdXJpdHlHcm91cCA/IFtwcm9wcy5zZWN1cml0eUdyb3VwXSA6IChwcm9wcz8uc2VjdXJpdHlHcm91cHMgPz8gW25ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnU0cnLCB7IHZwYzogdGhpcy52cGMgfSldKTtcbiAgICB0aGlzLnN1Ym5ldHMgPSBwcm9wcz8uc3VibmV0ID8gW3Byb3BzLnN1Ym5ldF0gOiB0aGlzLnZwYy5zZWxlY3RTdWJuZXRzKHByb3BzPy5zdWJuZXRTZWxlY3Rpb24pLnN1Ym5ldHM7XG4gICAgdGhpcy5pbnN0YW5jZVR5cGUgPSBwcm9wcz8uaW5zdGFuY2VUeXBlID8/IGVjMi5JbnN0YW5jZVR5cGUub2YoZWMyLkluc3RhbmNlQ2xhc3MuTTZJLCBlYzIuSW5zdGFuY2VTaXplLkxBUkdFKTtcbiAgICB0aGlzLnN0b3JhZ2VTaXplID0gcHJvcHM/LnN0b3JhZ2VTaXplID8/IGNkay5TaXplLmdpYmlieXRlcygzMCk7IC8vIDMwIGlzIHRoZSBtaW5pbXVtIGZvciBXaW5kb3dzXG4gICAgdGhpcy5zdG9yYWdlT3B0aW9ucyA9IHByb3BzPy5zdG9yYWdlT3B0aW9ucztcbiAgICB0aGlzLnNwb3QgPSBwcm9wcz8uc3BvdCA/PyBmYWxzZTtcbiAgICB0aGlzLnNwb3RNYXhQcmljZSA9IHByb3BzPy5zcG90TWF4UHJpY2U7XG4gICAgdGhpcy5kZWZhdWx0TGFiZWxzID0gcHJvcHM/LmRlZmF1bHRMYWJlbHMgPz8gdHJ1ZTtcblxuICAgIHRoaXMuYW1pQnVpbGRlciA9IHByb3BzPy5pbWFnZUJ1aWxkZXIgPz8gcHJvcHM/LmFtaUJ1aWxkZXIgPz8gRWMyUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKHRoaXMsICdBbWkgQnVpbGRlcicsIHtcbiAgICAgIHZwYzogcHJvcHM/LnZwYyxcbiAgICAgIHN1Ym5ldFNlbGVjdGlvbjogcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbixcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzLFxuICAgIH0pO1xuICAgIHRoaXMuYW1pID0gdGhpcy5hbWlCdWlsZGVyLmJpbmRBbWkoKTtcblxuICAgIGlmICh0aGlzLmFtaUJ1aWxkZXIgaW5zdGFuY2VvZiBBd3NJbWFnZUJ1aWxkZXJSdW5uZXJJbWFnZUJ1aWxkZXIpIHtcbiAgICAgIGlmICh0aGlzLmFtaUJ1aWxkZXIuc3RvcmFnZVNpemUgJiYgdGhpcy5zdG9yYWdlU2l6ZS50b0J5dGVzKCkgPCB0aGlzLmFtaUJ1aWxkZXIuc3RvcmFnZVNpemUudG9CeXRlcygpKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgUnVubmVyIHN0b3JhZ2Ugc2l6ZSAoJHt0aGlzLnN0b3JhZ2VTaXplLnRvR2liaWJ5dGVzKCl9IEdpQikgbXVzdCBiZSBhdCBsZWFzdCB0aGUgc2FtZSBhcyB0aGUgaW1hZ2UgYnVpbGRlciBzdG9yYWdlIHNpemUgKCR7dGhpcy5hbWlCdWlsZGVyLnN0b3JhZ2VTaXplLnRvR2liaWJ5dGVzKCl9IEdpQilgKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoIXRoaXMuYW1pLmFyY2hpdGVjdHVyZS5pbnN0YW5jZVR5cGVNYXRjaCh0aGlzLmluc3RhbmNlVHlwZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQU1JIGFyY2hpdGVjdHVyZSAoJHt0aGlzLmFtaS5hcmNoaXRlY3R1cmUubmFtZX0pIGRvZXNuJ3QgbWF0Y2ggcnVubmVyIGluc3RhbmNlIHR5cGUgKCR7dGhpcy5pbnN0YW5jZVR5cGV9IC8gJHt0aGlzLmluc3RhbmNlVHlwZS5hcmNoaXRlY3R1cmV9KWApO1xuICAgIH1cblxuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwgPSB0aGlzLnJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ1JvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnZWMyLmFtYXpvbmF3cy5jb20nKSxcbiAgICB9KTtcbiAgICB0aGlzLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnc3RhdGVzOlNlbmRUYXNrRmFpbHVyZScsICdzdGF0ZXM6U2VuZFRhc2tTdWNjZXNzJywgJ3N0YXRlczpTZW5kVGFza0hlYXJ0YmVhdCddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSwgLy8gbm8gc3VwcG9ydCBmb3Igc3RhdGVNYWNoaW5lLnN0YXRlTWFjaGluZUFybiBidXQgdGFzayB0b2tlbnMgYXJlIHZlcnkgbG9uZyBhbmQgdG90YWxseSByYW5kb20gc28gbm90IHRoZSBlbmQgb2YgdGhlIHdvcmxkXG4gICAgfSkpO1xuICAgIHRoaXMuZ3JhbnRQcmluY2lwYWwuYWRkVG9QcmluY2lwYWxQb2xpY3koTUlOSU1BTF9FQzJfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UKTtcblxuICAgIHRoaXMubG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cChcbiAgICAgIHRoaXMsXG4gICAgICAnTG9ncycsXG4gICAgICB7XG4gICAgICAgIHJldGVudGlvbjogcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBSZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgfSxcbiAgICApO1xuICAgIHRoaXMubG9nR3JvdXAuZ3JhbnRXcml0ZSh0aGlzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZSBzdGVwIGZ1bmN0aW9uIHRhc2socykgdG8gc3RhcnQgYSBuZXcgcnVubmVyLlxuICAgKlxuICAgKiBDYWxsZWQgYnkgR2l0aHViUnVubmVycyBhbmQgc2hvdWxkbid0IGJlIGNhbGxlZCBtYW51YWxseS5cbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlcnMgd29ya2Zsb3cgam9iIGRldGFpbHNcbiAgICovXG4gIGdldFN0ZXBGdW5jdGlvblRhc2socGFyYW1ldGVyczogUnVubmVyUnVudGltZVBhcmFtZXRlcnMpOiBzdGVwZnVuY3Rpb25zLklDaGFpbmFibGUge1xuICAgIC8vIHdlIG5lZWQgdG8gYnVpbGQgdXNlciBkYXRhIGluIHR3byBzdGVwcyBiZWNhdXNlIHBhc3NpbmcgdGhlIHRlbXBsYXRlIGFzIHRoZSBmaXJzdCBwYXJhbWV0ZXIgdG8gc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5mb3JtYXQgZmFpbHMgb24gc3ludGF4XG5cbiAgICBjb25zdCBwYXJhbXMgPSBbXG4gICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnRhc2tUb2tlbixcbiAgICAgIHRoaXMubG9nR3JvdXAubG9nR3JvdXBOYW1lLFxuICAgICAgcGFyYW1ldGVycy5ydW5uZXJOYW1lUGF0aCxcbiAgICAgIHBhcmFtZXRlcnMuZ2l0aHViRG9tYWluUGF0aCxcbiAgICAgIHBhcmFtZXRlcnMub3duZXJQYXRoLFxuICAgICAgcGFyYW1ldGVycy5yZXBvUGF0aCxcbiAgICAgIHBhcmFtZXRlcnMucnVubmVyVG9rZW5QYXRoLFxuICAgICAgcGFyYW1ldGVycy5sYWJlbHNQYXRoLFxuICAgICAgcGFyYW1ldGVycy5yZWdpc3RyYXRpb25VcmwsXG4gICAgICB0aGlzLmdyb3VwID8gJy0tcnVubmVyZ3JvdXAnIDogJycsXG4gICAgICAvLyB0aGlzIGlzIHNwbGl0IGludG8gMiBmb3IgcG93ZXJzaGVsbCBvdGhlcndpc2UgaXQgd2lsbCBwYXNzIFwiLS1ydW5uZXJncm91cCBuYW1lXCIgYXMgYSBzaW5nbGUgYXJndW1lbnQgYW5kIGNvbmZpZy5zaCB3aWxsIGZhaWxcbiAgICAgIHRoaXMuZ3JvdXAgPyB0aGlzLmdyb3VwIDogJycsXG4gICAgICB0aGlzLmRlZmF1bHRMYWJlbHMgPyAnJyA6ICctLW5vLWRlZmF1bHQtbGFiZWxzJyxcbiAgICAgIHBhcmFtZXRlcnMuaml0Q29uZmlnUGF0aCxcbiAgICBdO1xuXG4gICAgY29uc3QgcGFzc1VzZXJEYXRhID0gbmV3IHN0ZXBmdW5jdGlvbnMuUGFzcyh0aGlzLCAnRGF0YScsIHtcbiAgICAgIHN0YXRlTmFtZTogZ2VuZXJhdGVTdGF0ZU5hbWUodGhpcywgJ2RhdGEnKSxcbiAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgdXNlcmRhdGFUZW1wbGF0ZTogdGhpcy5hbWkub3MuaXMoT3MuV0lORE9XUykgPyB3aW5kb3dzVXNlckRhdGFUZW1wbGF0ZSA6IGxpbnV4VXNlckRhdGFUZW1wbGF0ZSxcbiAgICAgIH0sXG4gICAgICByZXN1bHRQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLmVjMicpLFxuICAgIH0pO1xuXG4gICAgLy8gd2UgdXNlIGVjMjpSdW5JbnN0YW5jZXMgYmVjYXVzZSB3ZSBtdXN0XG4gICAgLy8gd2UgY2FuJ3QgdXNlIGZsZWV0cyBiZWNhdXNlIHRoZXkgZG9uJ3QgbGV0IHVzIG92ZXJyaWRlIHVzZXIgZGF0YSwgc2VjdXJpdHkgZ3JvdXBzIG9yIGV2ZW4gZGlzayBzaXplXG4gICAgLy8gd2UgY2FuJ3QgdXNlIHJlcXVlc3RTcG90SW5zdGFuY2VzIGJlY2F1c2UgaXQgZG9lc24ndCBzdXBwb3J0IGxhdW5jaCB0ZW1wbGF0ZXMsIGFuZCBpdCdzIGRlcHJlY2F0ZWRcbiAgICAvLyBlYzI6UnVuSW5zdGFuY2VzIGFsc28gc2VlbWVkIGxpa2UgdGhlIG9ubHkgb25lIHRvIGltbWVkaWF0ZWx5IHJldHVybiBhbiBlcnJvciB3aGVuIHNwb3QgY2FwYWNpdHkgaXMgbm90IGF2YWlsYWJsZVxuXG4gICAgLy8gd2UgYnVpbGQgYSBjb21wbGljYXRlZCBjaGFpbiBvZiBzdGF0ZXMgaGVyZSBiZWNhdXNlIGVjMjpSdW5JbnN0YW5jZXMgY2FuIG9ubHkgdHJ5IG9uZSBzdWJuZXQgYXQgYSB0aW1lXG4gICAgLy8gaWYgc29tZW9uZSBjYW4gZmlndXJlIG91dCBhIGdvb2Qgd2F5IHRvIHVzZSBNYXAgZm9yIHRoaXMsIHBsZWFzZSBvcGVuIGEgUFJcblxuICAgIC8vIGJ1aWxkIGEgc3RhdGUgZm9yIGVhY2ggc3VibmV0IHdlIHdhbnQgdG8gdHJ5XG4gICAgY29uc3QgaW5zdGFuY2VQcm9maWxlID0gbmV3IGlhbS5DZm5JbnN0YW5jZVByb2ZpbGUodGhpcywgJ0luc3RhbmNlIFByb2ZpbGUnLCB7XG4gICAgICByb2xlczogW3RoaXMucm9sZS5yb2xlTmFtZV0sXG4gICAgfSk7XG4gICAgY29uc3Qgcm9vdERldmljZVJlc291cmNlID0gYW1pUm9vdERldmljZSh0aGlzLCB0aGlzLmFtaS5sYXVuY2hUZW1wbGF0ZS5sYXVuY2hUZW1wbGF0ZUlkKTtcbiAgICByb290RGV2aWNlUmVzb3VyY2Uubm9kZS5hZGREZXBlbmRlbmN5KHRoaXMuYW1pQnVpbGRlcik7XG4gICAgY29uc3Qgc3VibmV0UnVubmVycyA9IHRoaXMuc3VibmV0cy5tYXAoc3VibmV0ID0+IHtcbiAgICAgIHJldHVybiBuZXcgc3RlcGZ1bmN0aW9uc190YXNrcy5DYWxsQXdzU2VydmljZSh0aGlzLCBzdWJuZXQuc3VibmV0SWQsIHtcbiAgICAgICAgc3RhdGVOYW1lOiBnZW5lcmF0ZVN0YXRlTmFtZSh0aGlzLCBzdWJuZXQuc3VibmV0SWQpLFxuICAgICAgICBjb21tZW50OiBzdWJuZXQuYXZhaWxhYmlsaXR5Wm9uZSxcbiAgICAgICAgaW50ZWdyYXRpb25QYXR0ZXJuOiBJbnRlZ3JhdGlvblBhdHRlcm4uV0FJVF9GT1JfVEFTS19UT0tFTixcbiAgICAgICAgc2VydmljZTogJ2VjMicsXG4gICAgICAgIGFjdGlvbjogJ3J1bkluc3RhbmNlcycsXG4gICAgICAgIGhlYXJ0YmVhdFRpbWVvdXQ6IHN0ZXBmdW5jdGlvbnMuVGltZW91dC5kdXJhdGlvbihEdXJhdGlvbi5taW51dGVzKDEwKSksXG4gICAgICAgIHBhcmFtZXRlcnM6IHtcbiAgICAgICAgICBMYXVuY2hUZW1wbGF0ZToge1xuICAgICAgICAgICAgTGF1bmNoVGVtcGxhdGVJZDogdGhpcy5hbWkubGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVJZCxcbiAgICAgICAgICB9LFxuICAgICAgICAgIE1pbkNvdW50OiAxLFxuICAgICAgICAgIE1heENvdW50OiAxLFxuICAgICAgICAgIEluc3RhbmNlVHlwZTogdGhpcy5pbnN0YW5jZVR5cGUudG9TdHJpbmcoKSxcbiAgICAgICAgICBVc2VyRGF0YTogc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5iYXNlNjRFbmNvZGUoXG4gICAgICAgICAgICBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLmZvcm1hdChcbiAgICAgICAgICAgICAgc3RlcGZ1bmN0aW9ucy5Kc29uUGF0aC5zdHJpbmdBdCgnJC5lYzIudXNlcmRhdGFUZW1wbGF0ZScpLFxuICAgICAgICAgICAgICAuLi5wYXJhbXMsXG4gICAgICAgICAgICApLFxuICAgICAgICAgICksXG4gICAgICAgICAgSW5zdGFuY2VJbml0aWF0ZWRTaHV0ZG93bkJlaGF2aW9yOiBlYzIuSW5zdGFuY2VJbml0aWF0ZWRTaHV0ZG93bkJlaGF2aW9yLlRFUk1JTkFURSxcbiAgICAgICAgICBJYW1JbnN0YW5jZVByb2ZpbGU6IHtcbiAgICAgICAgICAgIEFybjogaW5zdGFuY2VQcm9maWxlLmF0dHJBcm4sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBNZXRhZGF0YU9wdGlvbnM6IHtcbiAgICAgICAgICAgIEh0dHBUb2tlbnM6ICdyZXF1aXJlZCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBTZWN1cml0eUdyb3VwSWRzOiB0aGlzLnNlY3VyaXR5R3JvdXBzLm1hcChzZyA9PiBzZy5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgICAgIFN1Ym5ldElkOiBzdWJuZXQuc3VibmV0SWQsXG4gICAgICAgICAgQmxvY2tEZXZpY2VNYXBwaW5nczogW3tcbiAgICAgICAgICAgIERldmljZU5hbWU6IHJvb3REZXZpY2VSZXNvdXJjZS5yZWYsXG4gICAgICAgICAgICBFYnM6IHtcbiAgICAgICAgICAgICAgRGVsZXRlT25UZXJtaW5hdGlvbjogdHJ1ZSxcbiAgICAgICAgICAgICAgVm9sdW1lU2l6ZTogdGhpcy5zdG9yYWdlU2l6ZS50b0dpYmlieXRlcygpLFxuICAgICAgICAgICAgICBWb2x1bWVUeXBlOiB0aGlzLnN0b3JhZ2VPcHRpb25zPy52b2x1bWVUeXBlLFxuICAgICAgICAgICAgICBJb3BzOiB0aGlzLnN0b3JhZ2VPcHRpb25zPy5pb3BzLFxuICAgICAgICAgICAgICBUaHJvdWdocHV0OiB0aGlzLnN0b3JhZ2VPcHRpb25zPy50aHJvdWdocHV0LFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9XSxcbiAgICAgICAgICBJbnN0YW5jZU1hcmtldE9wdGlvbnM6IHRoaXMuc3BvdCA/IHtcbiAgICAgICAgICAgIE1hcmtldFR5cGU6ICdzcG90JyxcbiAgICAgICAgICAgIFNwb3RPcHRpb25zOiB7XG4gICAgICAgICAgICAgIE1heFByaWNlOiB0aGlzLnNwb3RNYXhQcmljZSxcbiAgICAgICAgICAgICAgU3BvdEluc3RhbmNlVHlwZTogJ29uZS10aW1lJyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSA6IHVuZGVmaW5lZCxcbiAgICAgICAgICBUYWdTcGVjaWZpY2F0aW9uczogWyAvLyBtYW51YWxseSBwcm9wYWdhdGUgdGFnc1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBSZXNvdXJjZVR5cGU6ICdpbnN0YW5jZScsXG4gICAgICAgICAgICAgIFRhZ3M6IFt7XG4gICAgICAgICAgICAgICAgS2V5OiAnR2l0SHViUnVubmVyczpQcm92aWRlcicsXG4gICAgICAgICAgICAgICAgVmFsdWU6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIFJlc291cmNlVHlwZTogJ3ZvbHVtZScsXG4gICAgICAgICAgICAgIFRhZ3M6IFt7XG4gICAgICAgICAgICAgICAgS2V5OiAnR2l0SHViUnVubmVyczpQcm92aWRlcicsXG4gICAgICAgICAgICAgICAgVmFsdWU6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgICAgICAgICB9XSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgaWFtUmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gc3RhcnQgd2l0aCB0aGUgZmlyc3Qgc3VibmV0XG4gICAgcGFzc1VzZXJEYXRhLm5leHQoc3VibmV0UnVubmVyc1swXSk7XG5cbiAgICAvLyBjaGFpbiB1cCB0aGUgcmVzdCBvZiB0aGUgc3VibmV0c1xuICAgIGZvciAobGV0IGkgPSAxOyBpIDwgc3VibmV0UnVubmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgc3VibmV0UnVubmVyc1tpIC0gMV0uYWRkQ2F0Y2goc3VibmV0UnVubmVyc1tpXSwge1xuICAgICAgICBlcnJvcnM6IFsnRWMyLkVjMkV4Y2VwdGlvbicsICdTdGF0ZXMuVGltZW91dCddLFxuICAgICAgICByZXN1bHRQYXRoOiBzdGVwZnVuY3Rpb25zLkpzb25QYXRoLnN0cmluZ0F0KCckLmxhc3RTdWJuZXRFcnJvcicpLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHBhc3NVc2VyRGF0YTtcbiAgfVxuXG4gIGdyYW50U3RhdGVNYWNoaW5lKHN0YXRlTWFjaGluZVJvbGU6IGlhbS5JR3JhbnRhYmxlKSB7XG4gICAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2lhbTpQYXNzUm9sZSddLFxuICAgICAgcmVzb3VyY2VzOiBbdGhpcy5yb2xlLnJvbGVBcm5dLFxuICAgICAgY29uZGl0aW9uczoge1xuICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAnaWFtOlBhc3NlZFRvU2VydmljZSc6ICdlYzIuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIH0sXG4gICAgICB9LFxuICAgIH0pKTtcblxuICAgIHN0YXRlTWFjaGluZVJvbGUuZ3JhbnRQcmluY2lwYWwuYWRkVG9QcmluY2lwYWxQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgYWN0aW9uczogWydlYzI6Y3JlYXRlVGFncyddLFxuICAgICAgcmVzb3VyY2VzOiBbU3RhY2sub2YodGhpcykuZm9ybWF0QXJuKHtcbiAgICAgICAgc2VydmljZTogJ2VjMicsXG4gICAgICAgIHJlc291cmNlOiAnKicsXG4gICAgICB9KV0sXG4gICAgfSkpO1xuXG4gICAgc3RhdGVNYWNoaW5lUm9sZS5ncmFudFByaW5jaXBhbC5hZGRUb1ByaW5jaXBhbFBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBhY3Rpb25zOiBbJ2lhbTpDcmVhdGVTZXJ2aWNlTGlua2VkUm9sZSddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgIGNvbmRpdGlvbnM6IHtcbiAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgJ2lhbTpBV1NTZXJ2aWNlTmFtZSc6ICdzcG90LmFtYXpvbmF3cy5jb20nLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICB9KSk7XG4gIH1cblxuICBzdGF0dXMoc3RhdHVzRnVuY3Rpb25Sb2xlOiBpYW0uSUdyYW50YWJsZSk6IElSdW5uZXJQcm92aWRlclN0YXR1cyB7XG4gICAgc3RhdHVzRnVuY3Rpb25Sb2xlLmdyYW50UHJpbmNpcGFsLmFkZFRvUHJpbmNpcGFsUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGFjdGlvbnM6IFsnZWMyOkRlc2NyaWJlTGF1bmNoVGVtcGxhdGVWZXJzaW9ucyddLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICB9KSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdHlwZTogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgbGFiZWxzOiB0aGlzLmxhYmVscyxcbiAgICAgIGNvbnN0cnVjdFBhdGg6IHRoaXMubm9kZS5wYXRoLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHRoaXMuc2VjdXJpdHlHcm91cHMubWFwKHNnID0+IHNnLnNlY3VyaXR5R3JvdXBJZCksXG4gICAgICByb2xlQXJuOiB0aGlzLnJvbGUucm9sZUFybixcbiAgICAgIGxvZ0dyb3VwOiB0aGlzLmxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGFtaToge1xuICAgICAgICBsYXVuY2hUZW1wbGF0ZTogdGhpcy5hbWkubGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVJZCB8fCAndW5rbm93bicsXG4gICAgICAgIGFtaUJ1aWxkZXJMb2dHcm91cDogdGhpcy5hbWkubG9nR3JvdXA/LmxvZ0dyb3VwTmFtZSxcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbmV0d29yayBjb25uZWN0aW9ucyBhc3NvY2lhdGVkIHdpdGggdGhpcyByZXNvdXJjZS5cbiAgICovXG4gIHB1YmxpYyBnZXQgY29ubmVjdGlvbnMoKTogZWMyLkNvbm5lY3Rpb25zIHtcbiAgICByZXR1cm4gbmV3IGVjMi5Db25uZWN0aW9ucyh7IHNlY3VyaXR5R3JvdXBzOiB0aGlzLnNlY3VyaXR5R3JvdXBzIH0pO1xuICB9XG59XG5cbi8qKlxuICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBFYzJSdW5uZXJQcm92aWRlcn1cbiAqL1xuZXhwb3J0IGNsYXNzIEVjMlJ1bm5lciBleHRlbmRzIEVjMlJ1bm5lclByb3ZpZGVyIHtcbn1cbiJdfQ==