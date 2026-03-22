"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmiBuilder = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const common_1 = require("./common");
const linux_components_1 = require("./linux-components");
const windows_components_1 = require("./windows-components");
const providers_1 = require("../../../providers");
const utils_1 = require("../../../utils");
const common_2 = require("../../common");
const ami_1 = require("../ami");
const delete_resources_function_1 = require("../delete-resources-function");
/**
 * An AMI builder that uses AWS Image Builder to build AMIs pre-baked with all the GitHub Actions runner requirements. Builders can be used with {@link Ec2RunnerProvider}.
 *
 * Each builder re-runs automatically at a set interval to make sure the AMIs contain the latest versions of everything.
 *
 * You can create an instance of this construct to customize the AMI used to spin-up runners. Some runner providers may require custom components. Check the runner provider documentation.
 *
 * For example, to set a specific runner version, rebuild the image every 2 weeks, and add a few packages for the EC2 provider, use:
 *
 * ```
 * const builder = new AmiBuilder(this, 'Builder', {
 *     runnerVersion: RunnerVersion.specific('2.293.0'),
 *     rebuildInterval: Duration.days(14),
 * });
 * builder.addComponent(new ImageBuilderComponent(scope, id, {
 *   platform: 'Linux',
 *   displayName: 'p7zip',
 *   description: 'Install some more packages',
 *   commands: [
 *     'apt-get install p7zip',
 *   ],
 * }));
 * new Ec2RunnerProvider(this, 'EC2 provider', {
 *     labels: ['custom-ec2'],
 *     amiBuilder: builder,
 * });
 * ```
 *
 * @deprecated use RunnerImageBuilder, e.g. with Ec2RunnerProvider.imageBuilder()
 */
class AmiBuilder extends common_1.ImageBuilderBase {
    constructor(scope, id, props) {
        super(scope, id, {
            os: props?.os,
            supportedOs: [providers_1.Os.LINUX, providers_1.Os.LINUX_UBUNTU, providers_1.Os.LINUX_UBUNTU_2204, providers_1.Os.LINUX_AMAZON_2, providers_1.Os.WINDOWS],
            architecture: props?.architecture,
            supportedArchitectures: [providers_1.Architecture.X86_64, providers_1.Architecture.ARM64],
            instanceType: props?.instanceType,
            vpc: props?.vpc,
            securityGroups: props?.securityGroup ? [props.securityGroup] : props?.securityGroups,
            subnetSelection: props?.subnetSelection,
            logRemovalPolicy: props?.logRemovalPolicy,
            logRetention: props?.logRetention,
            runnerVersion: props?.runnerVersion,
            rebuildInterval: props?.rebuildInterval,
            imageTypeName: 'AMI',
        });
        // add all basic components
        if (this.os.is(providers_1.Os.WINDOWS)) {
            this.addBaseWindowsComponents(props?.installDocker ?? true);
        }
        else if (this.os.is(providers_1.Os.LINUX) || this.os.is(providers_1.Os.LINUX_UBUNTU_2204)) {
            this.addBaseLinuxComponents(props?.installDocker ?? true);
        }
        else {
            throw new Error(`Unsupported OS for AMI builder: ${this.os.name}`);
        }
    }
    addBaseWindowsComponents(installDocker) {
        this.addComponent(windows_components_1.WindowsComponents.cloudwatchAgent(this, 'CloudWatch agent'));
        this.addComponent(windows_components_1.WindowsComponents.awsCli(this, 'AWS CLI'));
        this.addComponent(windows_components_1.WindowsComponents.githubCli(this, 'GitHub CLI'));
        this.addComponent(windows_components_1.WindowsComponents.git(this, 'git'));
        this.addComponent(windows_components_1.WindowsComponents.githubRunner(this, 'GitHub Actions Runner', this.runnerVersion));
        if (installDocker) {
            this.addComponent(windows_components_1.WindowsComponents.docker(this, 'Docker'));
        }
    }
    addBaseLinuxComponents(installDocker) {
        this.addComponent(linux_components_1.LinuxUbuntuComponents.requiredPackages(this, 'Upgrade packages and install basics', this.architecture));
        this.addComponent(linux_components_1.LinuxUbuntuComponents.runnerUser(this, 'User', this.architecture));
        this.addComponent(linux_components_1.LinuxUbuntuComponents.awsCli(this, 'AWS CLI', this.architecture));
        this.addComponent(linux_components_1.LinuxUbuntuComponents.githubCli(this, 'GitHub CLI', this.architecture));
        this.addComponent(linux_components_1.LinuxUbuntuComponents.git(this, 'git', this.architecture));
        this.addComponent(linux_components_1.LinuxUbuntuComponents.githubRunner(this, 'GitHub Actions Runner', this.runnerVersion, this.architecture));
        if (installDocker) {
            this.addComponent(linux_components_1.LinuxUbuntuComponents.docker(this, 'Docker', this.architecture));
        }
    }
    /**
     * Add a component to be installed before any other components. Useful for required system settings like certificates or proxy settings.
     * @param component
     */
    prependComponent(component) {
        if (this.boundAmi) {
            throw new Error('AMI is already bound. Use this method before passing the builder to a runner provider.');
        }
        if (component.platform != this.platform) {
            throw new Error('Component platform doesn\'t match builder platform');
        }
        this.components = [component].concat(this.components);
    }
    /**
     * Add a component to be installed.
     * @param component
     */
    addComponent(component) {
        if (this.boundAmi) {
            throw new Error('AMI is already bound. Use this method before passing the builder to a runner provider.');
        }
        if (component.platform != this.platform) {
            throw new Error('Component platform doesn\'t match builder platform');
        }
        this.components.push(component);
    }
    /**
     * Add extra trusted certificates. This helps deal with self-signed certificates for GitHub Enterprise Server.
     *
     * @param path path to directory containing a file called certs.pem containing all the required certificates
     */
    addExtraCertificates(path) {
        if (this.platform == 'Linux') {
            this.prependComponent(linux_components_1.LinuxUbuntuComponents.extraCertificates(this, 'Extra Certs', path));
        }
        else if (this.platform == 'Windows') {
            this.prependComponent(windows_components_1.WindowsComponents.extraCertificates(this, 'Extra Certs', path));
        }
        else {
            throw new Error(`Unknown platform: ${this.platform}`);
        }
    }
    /**
     * Called by IRunnerProvider to finalize settings and create the AMI builder.
     */
    bindAmi() {
        if (this.boundAmi) {
            return this.boundAmi;
        }
        const launchTemplate = new aws_cdk_lib_1.aws_ec2.LaunchTemplate(this, 'Launch template', {
            requireImdsv2: true,
        });
        const stackName = cdk.Stack.of(this).stackName;
        const builderName = this.node.path;
        const dist = new aws_cdk_lib_1.aws_imagebuilder.CfnDistributionConfiguration(this, 'Distribution', {
            name: (0, common_2.uniqueImageBuilderName)(this),
            description: this.description,
            distributions: [
                {
                    region: aws_cdk_lib_1.Stack.of(this).region,
                    amiDistributionConfiguration: {
                        Name: `${cdk.Names.uniqueResourceName(this, {
                            maxLength: 100,
                            separator: '-',
                            allowedSpecialCharacters: '_-',
                        })}-{{ imagebuilder:buildDate }}`,
                        AmiTags: {
                            'Name': this.node.id,
                            'GitHubRunners:Stack': stackName,
                            'GitHubRunners:Builder': builderName,
                        },
                    },
                    launchTemplateConfigurations: [
                        {
                            launchTemplateId: launchTemplate.launchTemplateId,
                        },
                    ],
                },
            ],
        });
        const recipe = new ami_1.AmiRecipe(this, 'Ami Recipe', {
            platform: this.platform,
            components: this.components,
            architecture: this.architecture,
            baseAmi: (0, ami_1.defaultBaseAmi)(this, this.os, this.architecture),
            tags: {
                'GitHubRunners:Stack': stackName,
                'GitHubRunners:Builder': builderName,
            },
        });
        const log = this.createLog(recipe.name);
        const infra = this.createInfrastructure([
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilder'),
        ]);
        this.createImage(infra, dist, log, recipe.arn, undefined);
        this.createPipeline(infra, dist, log, recipe.arn, undefined);
        this.boundAmi = {
            launchTemplate: launchTemplate,
            architecture: this.architecture,
            os: this.os,
            logGroup: log,
            runnerVersion: this.runnerVersion,
        };
        this.imageCleaner();
        return this.boundAmi;
    }
    imageCleaner() {
        // the lambda no longer implements the schedule feature
        // this hasn't worked since https://github.com/CloudSnorkel/cdk-github-runners/pull/476
        cdk.Annotations.of(this).addWarning('The AMI cleaner for this deprecated class has been broken since v0.12.0 (PR #476) and will not delete any AMIs. Please manually delete old AMIs and upgrade to e.g. Ec2RunnerProvider.imageBuilder() instead of AmiBuilder.');
        // we keep the lambda itself around, in case the user doesn't have any other instances of it
        // if there are no other instances of it, the custom resource will be deleted with the original lambda source code which may delete the AMIs on its way out
        (0, utils_1.singletonLambda)(delete_resources_function_1.DeleteResourcesFunction, this, 'delete-ami', {
            description: 'Delete old GitHub Runner AMIs (defunct)',
            timeout: cdk.Duration.minutes(5),
            logRetention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
        });
    }
    bindDockerImage() {
        throw new Error('AmiBuilder cannot be used to build Docker images');
    }
}
exports.AmiBuilder = AmiBuilder;
_a = JSII_RTTI_SYMBOL_1;
AmiBuilder[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.AmiBuilder", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW1pLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2RlcHJlY2F0ZWQvYW1pLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsbUNBQW1DO0FBQ25DLDZDQUFpSjtBQUVqSixxQ0FBNEM7QUFDNUMseURBQTJEO0FBQzNELDZEQUF5RDtBQUN6RCxrREFBNkY7QUFDN0YsMENBQWlEO0FBQ2pELHlDQUFzRDtBQUN0RCxnQ0FBbUQ7QUFFbkQsNEVBQXVFO0FBbUd2RTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0E2Qkc7QUFDSCxNQUFhLFVBQVcsU0FBUSx5QkFBZ0I7SUFHOUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUNmLEVBQUUsRUFBRSxLQUFLLEVBQUUsRUFBRTtZQUNiLFdBQVcsRUFBRSxDQUFDLGNBQUUsQ0FBQyxLQUFLLEVBQUUsY0FBRSxDQUFDLFlBQVksRUFBRSxjQUFFLENBQUMsaUJBQWlCLEVBQUUsY0FBRSxDQUFDLGNBQWMsRUFBRSxjQUFFLENBQUMsT0FBTyxDQUFDO1lBQzdGLFlBQVksRUFBRSxLQUFLLEVBQUUsWUFBWTtZQUNqQyxzQkFBc0IsRUFBRSxDQUFDLHdCQUFZLENBQUMsTUFBTSxFQUFFLHdCQUFZLENBQUMsS0FBSyxDQUFDO1lBQ2pFLFlBQVksRUFBRSxLQUFLLEVBQUUsWUFBWTtZQUNqQyxHQUFHLEVBQUUsS0FBSyxFQUFFLEdBQUc7WUFDZixjQUFjLEVBQUUsS0FBSyxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxjQUFjO1lBQ3BGLGVBQWUsRUFBRSxLQUFLLEVBQUUsZUFBZTtZQUN2QyxnQkFBZ0IsRUFBRSxLQUFLLEVBQUUsZ0JBQWdC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LEdBQUcsRUFBRSxNQUFNLENBQUMsR0FBRyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1FBQzFELElBQUksQ0FBQyxjQUFjLENBQUMsS0FBSyxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsTUFBTSxDQUFDLEdBQUcsRUFBRSxTQUFTLENBQUMsQ0FBQztRQUU3RCxJQUFJLENBQUMsUUFBUSxHQUFHO1lBQ2QsY0FBYyxFQUFFLGNBQWM7WUFDOUIsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZO1lBQy9CLEVBQUUsRUFBRSxJQUFJLENBQUMsRUFBRTtZQUNYLFFBQVEsRUFBRSxHQUFHO1lBQ2IsYUFBYSxFQUFFLElBQUksQ0FBQyxhQUFhO1NBQ2xDLENBQUM7UUFFRixJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7UUFFcEIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDO0lBQ3ZCLENBQUM7SUFFTyxZQUFZO1FBQ2xCLHVEQUF1RDtRQUN2RCx1RkFBdUY7UUFDdkYsR0FBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsVUFBVSxDQUFDLDZOQUE2TixDQUFDLENBQUM7UUFFblEsNEZBQTRGO1FBQzVGLDJKQUEySjtRQUMzSixJQUFBLHVCQUFlLEVBQUMsbURBQXVCLEVBQUUsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUMzRCxXQUFXLEVBQUUseUNBQXlDO1lBQ3RELE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDaEMsWUFBWSxFQUFFLHNCQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7U0FDM0MsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELGVBQWU7UUFDYixNQUFNLElBQUksS0FBSyxDQUFDLGtEQUFrRCxDQUFDLENBQUM7SUFDdEUsQ0FBQzs7QUExTEgsZ0NBMkxDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IGF3c19lYzIgYXMgZWMyLCBhd3NfaWFtIGFzIGlhbSwgYXdzX2ltYWdlYnVpbGRlciBhcyBpbWFnZWJ1aWxkZXIsIGF3c19sb2dzIGFzIGxvZ3MsIER1cmF0aW9uLCBSZW1vdmFsUG9saWN5LCBTdGFjayB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgSW1hZ2VCdWlsZGVyQmFzZSB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IExpbnV4VWJ1bnR1Q29tcG9uZW50cyB9IGZyb20gJy4vbGludXgtY29tcG9uZW50cyc7XG5pbXBvcnQgeyBXaW5kb3dzQ29tcG9uZW50cyB9IGZyb20gJy4vd2luZG93cy1jb21wb25lbnRzJztcbmltcG9ydCB7IEFyY2hpdGVjdHVyZSwgT3MsIFJ1bm5lckFtaSwgUnVubmVySW1hZ2UsIFJ1bm5lclZlcnNpb24gfSBmcm9tICcuLi8uLi8uLi9wcm92aWRlcnMnO1xuaW1wb3J0IHsgc2luZ2xldG9uTGFtYmRhIH0gZnJvbSAnLi4vLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSB9IGZyb20gJy4uLy4uL2NvbW1vbic7XG5pbXBvcnQgeyBBbWlSZWNpcGUsIGRlZmF1bHRCYXNlQW1pIH0gZnJvbSAnLi4vYW1pJztcbmltcG9ydCB7IEltYWdlQnVpbGRlckNvbXBvbmVudCB9IGZyb20gJy4uL2J1aWxkZXInO1xuaW1wb3J0IHsgRGVsZXRlUmVzb3VyY2VzRnVuY3Rpb24gfSBmcm9tICcuLi9kZWxldGUtcmVzb3VyY2VzLWZ1bmN0aW9uJztcblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciB7QGxpbmsgQW1pQnVpbGRlcn0gY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEFtaUJ1aWxkZXJQcm9wcyB7XG4gIC8qKlxuICAgKiBJbWFnZSBhcmNoaXRlY3R1cmUuXG4gICAqXG4gICAqIEBkZWZhdWx0IEFyY2hpdGVjdHVyZS5YODZfNjRcbiAgICovXG4gIHJlYWRvbmx5IGFyY2hpdGVjdHVyZT86IEFyY2hpdGVjdHVyZTtcblxuICAvKipcbiAgICogSW1hZ2UgT1MuXG4gICAqXG4gICAqIEBkZWZhdWx0IE9TLkxJTlVYXG4gICAqL1xuICByZWFkb25seSBvcz86IE9zO1xuXG4gIC8qKlxuICAgKiBWZXJzaW9uIG9mIEdpdEh1YiBSdW5uZXJzIHRvIGluc3RhbGwuXG4gICAqXG4gICAqIEBkZWZhdWx0IGxhdGVzdCB2ZXJzaW9uIGF2YWlsYWJsZVxuICAgKi9cbiAgcmVhZG9ubHkgcnVubmVyVmVyc2lvbj86IFJ1bm5lclZlcnNpb247XG5cbiAgLyoqXG4gICAqIFNjaGVkdWxlIHRoZSBBTUkgdG8gYmUgcmVidWlsdCBldmVyeSBnaXZlbiBpbnRlcnZhbC4gVXNlZnVsIGZvciBrZWVwaW5nIHRoZSBBTUkgdXAtZG8tZGF0ZSB3aXRoIHRoZSBsYXRlc3QgR2l0SHViIHJ1bm5lciB2ZXJzaW9uIGFuZCBsYXRlc3QgT1MgdXBkYXRlcy5cbiAgICpcbiAgICogU2V0IHRvIHplcm8gdG8gZGlzYWJsZS5cbiAgICpcbiAgICogQGRlZmF1bHQgRHVyYXRpb24uZGF5cyg3KVxuICAgKi9cbiAgcmVhZG9ubHkgcmVidWlsZEludGVydmFsPzogRHVyYXRpb247XG5cbiAgLyoqXG4gICAqIFZQQyB3aGVyZSBidWlsZGVyIGluc3RhbmNlcyB3aWxsIGJlIGxhdW5jaGVkLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IGFjY291bnQgVlBDXG4gICAqL1xuICByZWFkb25seSB2cGM/OiBlYzIuSVZwYztcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXAgdG8gYXNzaWduIHRvIGxhdW5jaGVkIGJ1aWxkZXIgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICpcbiAgICogQGRlcHJlY2F0ZWQgdXNlIHtAbGluayBzZWN1cml0eUdyb3Vwc31cbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXA/OiBlYzIuSVNlY3VyaXR5R3JvdXA7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwcyB0byBhc3NpZ24gdG8gbGF1bmNoZWQgYnVpbGRlciBpbnN0YW5jZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5ldyBzZWN1cml0eSBncm91cFxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM/OiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcblxuICAvKipcbiAgICogV2hlcmUgdG8gcGxhY2UgdGhlIG5ldHdvcmsgaW50ZXJmYWNlcyB3aXRoaW4gdGhlIFZQQy4gT25seSB0aGUgZmlyc3QgbWF0Y2hlZCBzdWJuZXQgd2lsbCBiZSB1c2VkLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IFZQQyBzdWJuZXRcbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIFRoZSBpbnN0YW5jZSB0eXBlIHVzZWQgdG8gYnVpbGQgdGhlIGltYWdlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBtNmkubGFyZ2VcbiAgICovXG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZT86IGVjMi5JbnN0YW5jZVR5cGU7XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgZGF5cyBsb2cgZXZlbnRzIGFyZSBrZXB0IGluIENsb3VkV2F0Y2ggTG9ncy4gV2hlbiB1cGRhdGluZ1xuICAgKiB0aGlzIHByb3BlcnR5LCB1bnNldHRpbmcgaXQgZG9lc24ndCByZW1vdmUgdGhlIGxvZyByZXRlbnRpb24gcG9saWN5LiBUb1xuICAgKiByZW1vdmUgdGhlIHJldGVudGlvbiBwb2xpY3ksIHNldCB0aGUgdmFsdWUgdG8gYElORklOSVRFYC5cbiAgICpcbiAgICogQGRlZmF1bHQgbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USFxuICAgKi9cbiAgcmVhZG9ubHkgbG9nUmV0ZW50aW9uPzogbG9ncy5SZXRlbnRpb25EYXlzO1xuXG4gIC8qKlxuICAgKiBSZW1vdmFsIHBvbGljeSBmb3IgbG9ncyBvZiBpbWFnZSBidWlsZHMuIElmIGRlcGxveW1lbnQgZmFpbHMgb24gdGhlIGN1c3RvbSByZXNvdXJjZSwgdHJ5IHNldHRpbmcgdGhpcyB0byBgUmVtb3ZhbFBvbGljeS5SRVRBSU5gLiBUaGlzIHdheSB0aGUgbG9ncyBjYW4gc3RpbGwgYmUgdmlld2VkLCBhbmQgeW91IGNhbiBzZWUgd2h5IHRoZSBidWlsZCBmYWlsZWQuXG4gICAqXG4gICAqIFdlIHRyeSB0byBub3QgbGVhdmUgYW55dGhpbmcgYmVoaW5kIHdoZW4gcmVtb3ZlZC4gQnV0IHNvbWV0aW1lcyBhIGxvZyBzdGF5aW5nIGJlaGluZCBpcyB1c2VmdWwuXG4gICAqXG4gICAqIEBkZWZhdWx0IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgKi9cbiAgcmVhZG9ubHkgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG5cbiAgLyoqXG4gICAqIEluc3RhbGwgRG9ja2VyIGluc2lkZSB0aGUgaW1hZ2UsIHNvIGl0IGNhbiBiZSB1c2VkIGJ5IHRoZSBydW5uZXIuXG4gICAqXG4gICAqIEBkZWZhdWx0IHRydWVcbiAgICovXG4gIHJlYWRvbmx5IGluc3RhbGxEb2NrZXI/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIEFuIEFNSSBidWlsZGVyIHRoYXQgdXNlcyBBV1MgSW1hZ2UgQnVpbGRlciB0byBidWlsZCBBTUlzIHByZS1iYWtlZCB3aXRoIGFsbCB0aGUgR2l0SHViIEFjdGlvbnMgcnVubmVyIHJlcXVpcmVtZW50cy4gQnVpbGRlcnMgY2FuIGJlIHVzZWQgd2l0aCB7QGxpbmsgRWMyUnVubmVyUHJvdmlkZXJ9LlxuICpcbiAqIEVhY2ggYnVpbGRlciByZS1ydW5zIGF1dG9tYXRpY2FsbHkgYXQgYSBzZXQgaW50ZXJ2YWwgdG8gbWFrZSBzdXJlIHRoZSBBTUlzIGNvbnRhaW4gdGhlIGxhdGVzdCB2ZXJzaW9ucyBvZiBldmVyeXRoaW5nLlxuICpcbiAqIFlvdSBjYW4gY3JlYXRlIGFuIGluc3RhbmNlIG9mIHRoaXMgY29uc3RydWN0IHRvIGN1c3RvbWl6ZSB0aGUgQU1JIHVzZWQgdG8gc3Bpbi11cCBydW5uZXJzLiBTb21lIHJ1bm5lciBwcm92aWRlcnMgbWF5IHJlcXVpcmUgY3VzdG9tIGNvbXBvbmVudHMuIENoZWNrIHRoZSBydW5uZXIgcHJvdmlkZXIgZG9jdW1lbnRhdGlvbi5cbiAqXG4gKiBGb3IgZXhhbXBsZSwgdG8gc2V0IGEgc3BlY2lmaWMgcnVubmVyIHZlcnNpb24sIHJlYnVpbGQgdGhlIGltYWdlIGV2ZXJ5IDIgd2Vla3MsIGFuZCBhZGQgYSBmZXcgcGFja2FnZXMgZm9yIHRoZSBFQzIgcHJvdmlkZXIsIHVzZTpcbiAqXG4gKiBgYGBcbiAqIGNvbnN0IGJ1aWxkZXIgPSBuZXcgQW1pQnVpbGRlcih0aGlzLCAnQnVpbGRlcicsIHtcbiAqICAgICBydW5uZXJWZXJzaW9uOiBSdW5uZXJWZXJzaW9uLnNwZWNpZmljKCcyLjI5My4wJyksXG4gKiAgICAgcmVidWlsZEludGVydmFsOiBEdXJhdGlvbi5kYXlzKDE0KSxcbiAqIH0pO1xuICogYnVpbGRlci5hZGRDb21wb25lbnQobmV3IEltYWdlQnVpbGRlckNvbXBvbmVudChzY29wZSwgaWQsIHtcbiAqICAgcGxhdGZvcm06ICdMaW51eCcsXG4gKiAgIGRpc3BsYXlOYW1lOiAncDd6aXAnLFxuICogICBkZXNjcmlwdGlvbjogJ0luc3RhbGwgc29tZSBtb3JlIHBhY2thZ2VzJyxcbiAqICAgY29tbWFuZHM6IFtcbiAqICAgICAnYXB0LWdldCBpbnN0YWxsIHA3emlwJyxcbiAqICAgXSxcbiAqIH0pKTtcbiAqIG5ldyBFYzJSdW5uZXJQcm92aWRlcih0aGlzLCAnRUMyIHByb3ZpZGVyJywge1xuICogICAgIGxhYmVsczogWydjdXN0b20tZWMyJ10sXG4gKiAgICAgYW1pQnVpbGRlcjogYnVpbGRlcixcbiAqIH0pO1xuICogYGBgXG4gKlxuICogQGRlcHJlY2F0ZWQgdXNlIFJ1bm5lckltYWdlQnVpbGRlciwgZS5nLiB3aXRoIEVjMlJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcigpXG4gKi9cbmV4cG9ydCBjbGFzcyBBbWlCdWlsZGVyIGV4dGVuZHMgSW1hZ2VCdWlsZGVyQmFzZSB7XG4gIHByaXZhdGUgYm91bmRBbWk/OiBSdW5uZXJBbWk7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBBbWlCdWlsZGVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHtcbiAgICAgIG9zOiBwcm9wcz8ub3MsXG4gICAgICBzdXBwb3J0ZWRPczogW09zLkxJTlVYLCBPcy5MSU5VWF9VQlVOVFUsIE9zLkxJTlVYX1VCVU5UVV8yMjA0LCBPcy5MSU5VWF9BTUFaT05fMiwgT3MuV0lORE9XU10sXG4gICAgICBhcmNoaXRlY3R1cmU6IHByb3BzPy5hcmNoaXRlY3R1cmUsXG4gICAgICBzdXBwb3J0ZWRBcmNoaXRlY3R1cmVzOiBbQXJjaGl0ZWN0dXJlLlg4Nl82NCwgQXJjaGl0ZWN0dXJlLkFSTTY0XSxcbiAgICAgIGluc3RhbmNlVHlwZTogcHJvcHM/Lmluc3RhbmNlVHlwZSxcbiAgICAgIHZwYzogcHJvcHM/LnZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBwcm9wcz8uc2VjdXJpdHlHcm91cCA/IFtwcm9wcy5zZWN1cml0eUdyb3VwXSA6IHByb3BzPy5zZWN1cml0eUdyb3VwcyxcbiAgICAgIHN1Ym5ldFNlbGVjdGlvbjogcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbixcbiAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IHByb3BzPy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgbG9nUmV0ZW50aW9uOiBwcm9wcz8ubG9nUmV0ZW50aW9uLFxuICAgICAgcnVubmVyVmVyc2lvbjogcHJvcHM/LnJ1bm5lclZlcnNpb24sXG4gICAgICByZWJ1aWxkSW50ZXJ2YWw6IHByb3BzPy5yZWJ1aWxkSW50ZXJ2YWwsXG4gICAgICBpbWFnZVR5cGVOYW1lOiAnQU1JJyxcbiAgICB9KTtcblxuICAgIC8vIGFkZCBhbGwgYmFzaWMgY29tcG9uZW50c1xuICAgIGlmICh0aGlzLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICB0aGlzLmFkZEJhc2VXaW5kb3dzQ29tcG9uZW50cyhwcm9wcz8uaW5zdGFsbERvY2tlciA/PyB0cnVlKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMub3MuaXMoT3MuTElOVVgpIHx8IHRoaXMub3MuaXMoT3MuTElOVVhfVUJVTlRVXzIyMDQpKSB7XG4gICAgICB0aGlzLmFkZEJhc2VMaW51eENvbXBvbmVudHMocHJvcHM/Lmluc3RhbGxEb2NrZXIgPz8gdHJ1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgT1MgZm9yIEFNSSBidWlsZGVyOiAke3RoaXMub3MubmFtZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFkZEJhc2VXaW5kb3dzQ29tcG9uZW50cyhpbnN0YWxsRG9ja2VyOiBib29sZWFuKSB7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuY2xvdWR3YXRjaEFnZW50KHRoaXMsICdDbG91ZFdhdGNoIGFnZW50JykpO1xuICAgIHRoaXMuYWRkQ29tcG9uZW50KFdpbmRvd3NDb21wb25lbnRzLmF3c0NsaSh0aGlzLCAnQVdTIENMSScpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChXaW5kb3dzQ29tcG9uZW50cy5naXRodWJDbGkodGhpcywgJ0dpdEh1YiBDTEknKSk7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuZ2l0KHRoaXMsICdnaXQnKSk7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuZ2l0aHViUnVubmVyKHRoaXMsICdHaXRIdWIgQWN0aW9ucyBSdW5uZXInLCB0aGlzLnJ1bm5lclZlcnNpb24pKTtcbiAgICBpZiAoaW5zdGFsbERvY2tlcikge1xuICAgICAgdGhpcy5hZGRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuZG9ja2VyKHRoaXMsICdEb2NrZXInKSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhZGRCYXNlTGludXhDb21wb25lbnRzKGluc3RhbGxEb2NrZXI6IGJvb2xlYW4pIHtcbiAgICB0aGlzLmFkZENvbXBvbmVudChMaW51eFVidW50dUNvbXBvbmVudHMucmVxdWlyZWRQYWNrYWdlcyh0aGlzLCAnVXBncmFkZSBwYWNrYWdlcyBhbmQgaW5zdGFsbCBiYXNpY3MnLCB0aGlzLmFyY2hpdGVjdHVyZSkpO1xuICAgIHRoaXMuYWRkQ29tcG9uZW50KExpbnV4VWJ1bnR1Q29tcG9uZW50cy5ydW5uZXJVc2VyKHRoaXMsICdVc2VyJywgdGhpcy5hcmNoaXRlY3R1cmUpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChMaW51eFVidW50dUNvbXBvbmVudHMuYXdzQ2xpKHRoaXMsICdBV1MgQ0xJJywgdGhpcy5hcmNoaXRlY3R1cmUpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChMaW51eFVidW50dUNvbXBvbmVudHMuZ2l0aHViQ2xpKHRoaXMsICdHaXRIdWIgQ0xJJywgdGhpcy5hcmNoaXRlY3R1cmUpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChMaW51eFVidW50dUNvbXBvbmVudHMuZ2l0KHRoaXMsICdnaXQnLCB0aGlzLmFyY2hpdGVjdHVyZSkpO1xuICAgIHRoaXMuYWRkQ29tcG9uZW50KExpbnV4VWJ1bnR1Q29tcG9uZW50cy5naXRodWJSdW5uZXIodGhpcywgJ0dpdEh1YiBBY3Rpb25zIFJ1bm5lcicsIHRoaXMucnVubmVyVmVyc2lvbiwgdGhpcy5hcmNoaXRlY3R1cmUpKTtcbiAgICBpZiAoaW5zdGFsbERvY2tlcikge1xuICAgICAgdGhpcy5hZGRDb21wb25lbnQoTGludXhVYnVudHVDb21wb25lbnRzLmRvY2tlcih0aGlzLCAnRG9ja2VyJywgdGhpcy5hcmNoaXRlY3R1cmUpKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQWRkIGEgY29tcG9uZW50IHRvIGJlIGluc3RhbGxlZCBiZWZvcmUgYW55IG90aGVyIGNvbXBvbmVudHMuIFVzZWZ1bCBmb3IgcmVxdWlyZWQgc3lzdGVtIHNldHRpbmdzIGxpa2UgY2VydGlmaWNhdGVzIG9yIHByb3h5IHNldHRpbmdzLlxuICAgKiBAcGFyYW0gY29tcG9uZW50XG4gICAqL1xuICBwcmVwZW5kQ29tcG9uZW50KGNvbXBvbmVudDogSW1hZ2VCdWlsZGVyQ29tcG9uZW50KSB7XG4gICAgaWYgKHRoaXMuYm91bmRBbWkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQU1JIGlzIGFscmVhZHkgYm91bmQuIFVzZSB0aGlzIG1ldGhvZCBiZWZvcmUgcGFzc2luZyB0aGUgYnVpbGRlciB0byBhIHJ1bm5lciBwcm92aWRlci4nKTtcbiAgICB9XG4gICAgaWYgKGNvbXBvbmVudC5wbGF0Zm9ybSAhPSB0aGlzLnBsYXRmb3JtKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbXBvbmVudCBwbGF0Zm9ybSBkb2VzblxcJ3QgbWF0Y2ggYnVpbGRlciBwbGF0Zm9ybScpO1xuICAgIH1cbiAgICB0aGlzLmNvbXBvbmVudHMgPSBbY29tcG9uZW50XS5jb25jYXQodGhpcy5jb21wb25lbnRzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYSBjb21wb25lbnQgdG8gYmUgaW5zdGFsbGVkLlxuICAgKiBAcGFyYW0gY29tcG9uZW50XG4gICAqL1xuICBhZGRDb21wb25lbnQoY29tcG9uZW50OiBJbWFnZUJ1aWxkZXJDb21wb25lbnQpIHtcbiAgICBpZiAodGhpcy5ib3VuZEFtaSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdBTUkgaXMgYWxyZWFkeSBib3VuZC4gVXNlIHRoaXMgbWV0aG9kIGJlZm9yZSBwYXNzaW5nIHRoZSBidWlsZGVyIHRvIGEgcnVubmVyIHByb3ZpZGVyLicpO1xuICAgIH1cbiAgICBpZiAoY29tcG9uZW50LnBsYXRmb3JtICE9IHRoaXMucGxhdGZvcm0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29tcG9uZW50IHBsYXRmb3JtIGRvZXNuXFwndCBtYXRjaCBidWlsZGVyIHBsYXRmb3JtJyk7XG4gICAgfVxuICAgIHRoaXMuY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGV4dHJhIHRydXN0ZWQgY2VydGlmaWNhdGVzLiBUaGlzIGhlbHBzIGRlYWwgd2l0aCBzZWxmLXNpZ25lZCBjZXJ0aWZpY2F0ZXMgZm9yIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlci5cbiAgICpcbiAgICogQHBhcmFtIHBhdGggcGF0aCB0byBkaXJlY3RvcnkgY29udGFpbmluZyBhIGZpbGUgY2FsbGVkIGNlcnRzLnBlbSBjb250YWluaW5nIGFsbCB0aGUgcmVxdWlyZWQgY2VydGlmaWNhdGVzXG4gICAqL1xuICBwdWJsaWMgYWRkRXh0cmFDZXJ0aWZpY2F0ZXMocGF0aDogc3RyaW5nKSB7XG4gICAgaWYgKHRoaXMucGxhdGZvcm0gPT0gJ0xpbnV4Jykge1xuICAgICAgdGhpcy5wcmVwZW5kQ29tcG9uZW50KExpbnV4VWJ1bnR1Q29tcG9uZW50cy5leHRyYUNlcnRpZmljYXRlcyh0aGlzLCAnRXh0cmEgQ2VydHMnLCBwYXRoKSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLnBsYXRmb3JtID09ICdXaW5kb3dzJykge1xuICAgICAgdGhpcy5wcmVwZW5kQ29tcG9uZW50KFdpbmRvd3NDb21wb25lbnRzLmV4dHJhQ2VydGlmaWNhdGVzKHRoaXMsICdFeHRyYSBDZXJ0cycsIHBhdGgpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIHBsYXRmb3JtOiAke3RoaXMucGxhdGZvcm19YCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENhbGxlZCBieSBJUnVubmVyUHJvdmlkZXIgdG8gZmluYWxpemUgc2V0dGluZ3MgYW5kIGNyZWF0ZSB0aGUgQU1JIGJ1aWxkZXIuXG4gICAqL1xuICBiaW5kQW1pKCk6IFJ1bm5lckFtaSB7XG4gICAgaWYgKHRoaXMuYm91bmRBbWkpIHtcbiAgICAgIHJldHVybiB0aGlzLmJvdW5kQW1pO1xuICAgIH1cblxuICAgIGNvbnN0IGxhdW5jaFRlbXBsYXRlID0gbmV3IGVjMi5MYXVuY2hUZW1wbGF0ZSh0aGlzLCAnTGF1bmNoIHRlbXBsYXRlJywge1xuICAgICAgcmVxdWlyZUltZHN2MjogdHJ1ZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHN0YWNrTmFtZSA9IGNkay5TdGFjay5vZih0aGlzKS5zdGFja05hbWU7XG4gICAgY29uc3QgYnVpbGRlck5hbWUgPSB0aGlzLm5vZGUucGF0aDtcblxuICAgIGNvbnN0IGRpc3QgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24odGhpcywgJ0Rpc3RyaWJ1dGlvbicsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcbiAgICAgIGRpc3RyaWJ1dGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHJlZ2lvbjogU3RhY2sub2YodGhpcykucmVnaW9uLFxuICAgICAgICAgIGFtaURpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgIE5hbWU6IGAke2Nkay5OYW1lcy51bmlxdWVSZXNvdXJjZU5hbWUodGhpcywge1xuICAgICAgICAgICAgICBtYXhMZW5ndGg6IDEwMCxcbiAgICAgICAgICAgICAgc2VwYXJhdG9yOiAnLScsXG4gICAgICAgICAgICAgIGFsbG93ZWRTcGVjaWFsQ2hhcmFjdGVyczogJ18tJyxcbiAgICAgICAgICAgIH0pfS17eyBpbWFnZWJ1aWxkZXI6YnVpbGREYXRlIH19YCxcbiAgICAgICAgICAgIEFtaVRhZ3M6IHtcbiAgICAgICAgICAgICAgJ05hbWUnOiB0aGlzLm5vZGUuaWQsXG4gICAgICAgICAgICAgICdHaXRIdWJSdW5uZXJzOlN0YWNrJzogc3RhY2tOYW1lLFxuICAgICAgICAgICAgICAnR2l0SHViUnVubmVyczpCdWlsZGVyJzogYnVpbGRlck5hbWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgICAgbGF1bmNoVGVtcGxhdGVDb25maWd1cmF0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBsYXVuY2hUZW1wbGF0ZUlkOiBsYXVuY2hUZW1wbGF0ZS5sYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlY2lwZSA9IG5ldyBBbWlSZWNpcGUodGhpcywgJ0FtaSBSZWNpcGUnLCB7XG4gICAgICBwbGF0Zm9ybTogdGhpcy5wbGF0Zm9ybSxcbiAgICAgIGNvbXBvbmVudHM6IHRoaXMuY29tcG9uZW50cyxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBiYXNlQW1pOiBkZWZhdWx0QmFzZUFtaSh0aGlzLCB0aGlzLm9zLCB0aGlzLmFyY2hpdGVjdHVyZSksXG4gICAgICB0YWdzOiB7XG4gICAgICAgICdHaXRIdWJSdW5uZXJzOlN0YWNrJzogc3RhY2tOYW1lLFxuICAgICAgICAnR2l0SHViUnVubmVyczpCdWlsZGVyJzogYnVpbGRlck5hbWUsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgbG9nID0gdGhpcy5jcmVhdGVMb2cocmVjaXBlLm5hbWUpO1xuICAgIGNvbnN0IGluZnJhID0gdGhpcy5jcmVhdGVJbmZyYXN0cnVjdHVyZShbXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSxcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnRUMySW5zdGFuY2VQcm9maWxlRm9ySW1hZ2VCdWlsZGVyJyksXG4gICAgXSk7XG4gICAgdGhpcy5jcmVhdGVJbWFnZShpbmZyYSwgZGlzdCwgbG9nLCByZWNpcGUuYXJuLCB1bmRlZmluZWQpO1xuICAgIHRoaXMuY3JlYXRlUGlwZWxpbmUoaW5mcmEsIGRpc3QsIGxvZywgcmVjaXBlLmFybiwgdW5kZWZpbmVkKTtcblxuICAgIHRoaXMuYm91bmRBbWkgPSB7XG4gICAgICBsYXVuY2hUZW1wbGF0ZTogbGF1bmNoVGVtcGxhdGUsXG4gICAgICBhcmNoaXRlY3R1cmU6IHRoaXMuYXJjaGl0ZWN0dXJlLFxuICAgICAgb3M6IHRoaXMub3MsXG4gICAgICBsb2dHcm91cDogbG9nLFxuICAgICAgcnVubmVyVmVyc2lvbjogdGhpcy5ydW5uZXJWZXJzaW9uLFxuICAgIH07XG5cbiAgICB0aGlzLmltYWdlQ2xlYW5lcigpO1xuXG4gICAgcmV0dXJuIHRoaXMuYm91bmRBbWk7XG4gIH1cblxuICBwcml2YXRlIGltYWdlQ2xlYW5lcigpIHtcbiAgICAvLyB0aGUgbGFtYmRhIG5vIGxvbmdlciBpbXBsZW1lbnRzIHRoZSBzY2hlZHVsZSBmZWF0dXJlXG4gICAgLy8gdGhpcyBoYXNuJ3Qgd29ya2VkIHNpbmNlIGh0dHBzOi8vZ2l0aHViLmNvbS9DbG91ZFNub3JrZWwvY2RrLWdpdGh1Yi1ydW5uZXJzL3B1bGwvNDc2XG4gICAgY2RrLkFubm90YXRpb25zLm9mKHRoaXMpLmFkZFdhcm5pbmcoJ1RoZSBBTUkgY2xlYW5lciBmb3IgdGhpcyBkZXByZWNhdGVkIGNsYXNzIGhhcyBiZWVuIGJyb2tlbiBzaW5jZSB2MC4xMi4wIChQUiAjNDc2KSBhbmQgd2lsbCBub3QgZGVsZXRlIGFueSBBTUlzLiBQbGVhc2UgbWFudWFsbHkgZGVsZXRlIG9sZCBBTUlzIGFuZCB1cGdyYWRlIHRvIGUuZy4gRWMyUnVubmVyUHJvdmlkZXIuaW1hZ2VCdWlsZGVyKCkgaW5zdGVhZCBvZiBBbWlCdWlsZGVyLicpO1xuXG4gICAgLy8gd2Uga2VlcCB0aGUgbGFtYmRhIGl0c2VsZiBhcm91bmQsIGluIGNhc2UgdGhlIHVzZXIgZG9lc24ndCBoYXZlIGFueSBvdGhlciBpbnN0YW5jZXMgb2YgaXRcbiAgICAvLyBpZiB0aGVyZSBhcmUgbm8gb3RoZXIgaW5zdGFuY2VzIG9mIGl0LCB0aGUgY3VzdG9tIHJlc291cmNlIHdpbGwgYmUgZGVsZXRlZCB3aXRoIHRoZSBvcmlnaW5hbCBsYW1iZGEgc291cmNlIGNvZGUgd2hpY2ggbWF5IGRlbGV0ZSB0aGUgQU1JcyBvbiBpdHMgd2F5IG91dFxuICAgIHNpbmdsZXRvbkxhbWJkYShEZWxldGVSZXNvdXJjZXNGdW5jdGlvbiwgdGhpcywgJ2RlbGV0ZS1hbWknLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0RlbGV0ZSBvbGQgR2l0SHViIFJ1bm5lciBBTUlzIChkZWZ1bmN0KScsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICB9KTtcbiAgfVxuXG4gIGJpbmREb2NrZXJJbWFnZSgpOiBSdW5uZXJJbWFnZSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdBbWlCdWlsZGVyIGNhbm5vdCBiZSB1c2VkIHRvIGJ1aWxkIERvY2tlciBpbWFnZXMnKTtcbiAgfVxufVxuIl19