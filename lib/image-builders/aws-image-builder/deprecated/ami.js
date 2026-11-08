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
exports.AmiBuilder = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = __importStar(require("aws-cdk-lib"));
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
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.AmiBuilder", version: "0.0.0" };
    boundAmi;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW1pLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2RlcHJlY2F0ZWQvYW1pLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsNkNBQWlKO0FBRWpKLHFDQUE0QztBQUM1Qyx5REFBMkQ7QUFDM0QsNkRBQXlEO0FBQ3pELGtEQUE2RjtBQUM3RiwwQ0FBaUQ7QUFDakQseUNBQXNEO0FBQ3RELGdDQUFtRDtBQUVuRCw0RUFBdUU7QUFtR3ZFOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztHQTZCRztBQUNILE1BQWEsVUFBVyxTQUFRLHlCQUFnQjs7SUFDdEMsUUFBUSxDQUFhO0lBRTdCLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBdUI7UUFDL0QsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDZixFQUFFLEVBQUUsS0FBSyxFQUFFLEVBQUU7WUFDYixXQUFXLEVBQUUsQ0FBQyxjQUFFLENBQUMsS0FBSyxFQUFFLGNBQUUsQ0FBQyxZQUFZLEVBQUUsY0FBRSxDQUFDLGlCQUFpQixFQUFFLGNBQUUsQ0FBQyxjQUFjLEVBQUUsY0FBRSxDQUFDLE9BQU8sQ0FBQztZQUM3RixZQUFZLEVBQUUsS0FBSyxFQUFFLFlBQVk7WUFDakMsc0JBQXNCLEVBQUUsQ0FBQyx3QkFBWSxDQUFDLE1BQU0sRUFBRSx3QkFBWSxDQUFDLEtBQUssQ0FBQztZQUNqRSxZQUFZLEVBQUUsS0FBSyxFQUFFLFlBQVk7WUFDakMsR0FBRyxFQUFFLEtBQUssRUFBRSxHQUFHO1lBQ2YsY0FBYyxFQUFFLEtBQUssRUFBRSxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLEVBQUUsY0FBYztZQUNwRixlQUFlLEVBQUUs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XG5pbXBvcnQgeyBhd3NfZWMyIGFzIGVjMiwgYXdzX2lhbSBhcyBpYW0sIGF3c19pbWFnZWJ1aWxkZXIgYXMgaW1hZ2VidWlsZGVyLCBhd3NfbG9ncyBhcyBsb2dzLCBEdXJhdGlvbiwgUmVtb3ZhbFBvbGljeSwgU3RhY2sgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEltYWdlQnVpbGRlckJhc2UgfSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQgeyBMaW51eFVidW50dUNvbXBvbmVudHMgfSBmcm9tICcuL2xpbnV4LWNvbXBvbmVudHMnO1xuaW1wb3J0IHsgV2luZG93c0NvbXBvbmVudHMgfSBmcm9tICcuL3dpbmRvd3MtY29tcG9uZW50cyc7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIE9zLCBSdW5uZXJBbWksIFJ1bm5lckltYWdlLCBSdW5uZXJWZXJzaW9uIH0gZnJvbSAnLi4vLi4vLi4vcHJvdmlkZXJzJztcbmltcG9ydCB7IHNpbmdsZXRvbkxhbWJkYSB9IGZyb20gJy4uLy4uLy4uL3V0aWxzJztcbmltcG9ydCB7IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUgfSBmcm9tICcuLi8uLi9jb21tb24nO1xuaW1wb3J0IHsgQW1pUmVjaXBlLCBkZWZhdWx0QmFzZUFtaSB9IGZyb20gJy4uL2FtaSc7XG5pbXBvcnQgeyBJbWFnZUJ1aWxkZXJDb21wb25lbnQgfSBmcm9tICcuLi9idWlsZGVyJztcbmltcG9ydCB7IERlbGV0ZVJlc291cmNlc0Z1bmN0aW9uIH0gZnJvbSAnLi4vZGVsZXRlLXJlc291cmNlcy1mdW5jdGlvbic7XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3Ige0BsaW5rIEFtaUJ1aWxkZXJ9IGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBBbWlCdWlsZGVyUHJvcHMge1xuICAvKipcbiAgICogSW1hZ2UgYXJjaGl0ZWN0dXJlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBBcmNoaXRlY3R1cmUuWDg2XzY0XG4gICAqL1xuICByZWFkb25seSBhcmNoaXRlY3R1cmU/OiBBcmNoaXRlY3R1cmU7XG5cbiAgLyoqXG4gICAqIEltYWdlIE9TLlxuICAgKlxuICAgKiBAZGVmYXVsdCBPUy5MSU5VWFxuICAgKi9cbiAgcmVhZG9ubHkgb3M/OiBPcztcblxuICAvKipcbiAgICogVmVyc2lvbiBvZiBHaXRIdWIgUnVubmVycyB0byBpbnN0YWxsLlxuICAgKlxuICAgKiBAZGVmYXVsdCBsYXRlc3QgdmVyc2lvbiBhdmFpbGFibGVcbiAgICovXG4gIHJlYWRvbmx5IHJ1bm5lclZlcnNpb24/OiBSdW5uZXJWZXJzaW9uO1xuXG4gIC8qKlxuICAgKiBTY2hlZHVsZSB0aGUgQU1JIHRvIGJlIHJlYnVpbHQgZXZlcnkgZ2l2ZW4gaW50ZXJ2YWwuIFVzZWZ1bCBmb3Iga2VlcGluZyB0aGUgQU1JIHVwLWRvLWRhdGUgd2l0aCB0aGUgbGF0ZXN0IEdpdEh1YiBydW5uZXIgdmVyc2lvbiBhbmQgbGF0ZXN0IE9TIHVwZGF0ZXMuXG4gICAqXG4gICAqIFNldCB0byB6ZXJvIHRvIGRpc2FibGUuXG4gICAqXG4gICAqIEBkZWZhdWx0IER1cmF0aW9uLmRheXMoNylcbiAgICovXG4gIHJlYWRvbmx5IHJlYnVpbGRJbnRlcnZhbD86IER1cmF0aW9uO1xuXG4gIC8qKlxuICAgKiBWUEMgd2hlcmUgYnVpbGRlciBpbnN0YW5jZXMgd2lsbCBiZSBsYXVuY2hlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBhY2NvdW50IFZQQ1xuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwIHRvIGFzc2lnbiB0byBsYXVuY2hlZCBidWlsZGVyIGluc3RhbmNlcy5cbiAgICpcbiAgICogQGRlZmF1bHQgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgc2VjdXJpdHlHcm91cHN9XG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwPzogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgdG8gYXNzaWduIHRvIGxhdW5jaGVkIGJ1aWxkZXIgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgLyoqXG4gICAqIFdoZXJlIHRvIHBsYWNlIHRoZSBuZXR3b3JrIGludGVyZmFjZXMgd2l0aGluIHRoZSBWUEMuIE9ubHkgdGhlIGZpcnN0IG1hdGNoZWQgc3VibmV0IHdpbGwgYmUgdXNlZC5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBWUEMgc3VibmV0XG4gICAqL1xuICByZWFkb25seSBzdWJuZXRTZWxlY3Rpb24/OiBlYzIuU3VibmV0U2VsZWN0aW9uO1xuXG4gIC8qKlxuICAgKiBUaGUgaW5zdGFuY2UgdHlwZSB1c2VkIHRvIGJ1aWxkIHRoZSBpbWFnZS5cbiAgICpcbiAgICogQGRlZmF1bHQgbTZpLmxhcmdlXG4gICAqL1xuICByZWFkb25seSBpbnN0YW5jZVR5cGU/OiBlYzIuSW5zdGFuY2VUeXBlO1xuXG4gIC8qKlxuICAgKiBUaGUgbnVtYmVyIG9mIGRheXMgbG9nIGV2ZW50cyBhcmUga2VwdCBpbiBDbG91ZFdhdGNoIExvZ3MuIFdoZW4gdXBkYXRpbmdcbiAgICogdGhpcyBwcm9wZXJ0eSwgdW5zZXR0aW5nIGl0IGRvZXNuJ3QgcmVtb3ZlIHRoZSBsb2cgcmV0ZW50aW9uIHBvbGljeS4gVG9cbiAgICogcmVtb3ZlIHRoZSByZXRlbnRpb24gcG9saWN5LCBzZXQgdGhlIHZhbHVlIHRvIGBJTkZJTklURWAuXG4gICAqXG4gICAqIEBkZWZhdWx0IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEhcbiAgICovXG4gIHJlYWRvbmx5IGxvZ1JldGVudGlvbj86IGxvZ3MuUmV0ZW50aW9uRGF5cztcblxuICAvKipcbiAgICogUmVtb3ZhbCBwb2xpY3kgZm9yIGxvZ3Mgb2YgaW1hZ2UgYnVpbGRzLiBJZiBkZXBsb3ltZW50IGZhaWxzIG9uIHRoZSBjdXN0b20gcmVzb3VyY2UsIHRyeSBzZXR0aW5nIHRoaXMgdG8gYFJlbW92YWxQb2xpY3kuUkVUQUlOYC4gVGhpcyB3YXkgdGhlIGxvZ3MgY2FuIHN0aWxsIGJlIHZpZXdlZCwgYW5kIHlvdSBjYW4gc2VlIHdoeSB0aGUgYnVpbGQgZmFpbGVkLlxuICAgKlxuICAgKiBXZSB0cnkgdG8gbm90IGxlYXZlIGFueXRoaW5nIGJlaGluZCB3aGVuIHJlbW92ZWQuIEJ1dCBzb21ldGltZXMgYSBsb2cgc3RheWluZyBiZWhpbmQgaXMgdXNlZnVsLlxuICAgKlxuICAgKiBAZGVmYXVsdCBSZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICovXG4gIHJlYWRvbmx5IGxvZ1JlbW92YWxQb2xpY3k/OiBSZW1vdmFsUG9saWN5O1xuXG4gIC8qKlxuICAgKiBJbnN0YWxsIERvY2tlciBpbnNpZGUgdGhlIGltYWdlLCBzbyBpdCBjYW4gYmUgdXNlZCBieSB0aGUgcnVubmVyLlxuICAgKlxuICAgKiBAZGVmYXVsdCB0cnVlXG4gICAqL1xuICByZWFkb25seSBpbnN0YWxsRG9ja2VyPzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBBbiBBTUkgYnVpbGRlciB0aGF0IHVzZXMgQVdTIEltYWdlIEJ1aWxkZXIgdG8gYnVpbGQgQU1JcyBwcmUtYmFrZWQgd2l0aCBhbGwgdGhlIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciByZXF1aXJlbWVudHMuIEJ1aWxkZXJzIGNhbiBiZSB1c2VkIHdpdGgge0BsaW5rIEVjMlJ1bm5lclByb3ZpZGVyfS5cbiAqXG4gKiBFYWNoIGJ1aWxkZXIgcmUtcnVucyBhdXRvbWF0aWNhbGx5IGF0IGEgc2V0IGludGVydmFsIHRvIG1ha2Ugc3VyZSB0aGUgQU1JcyBjb250YWluIHRoZSBsYXRlc3QgdmVyc2lvbnMgb2YgZXZlcnl0aGluZy5cbiAqXG4gKiBZb3UgY2FuIGNyZWF0ZSBhbiBpbnN0YW5jZSBvZiB0aGlzIGNvbnN0cnVjdCB0byBjdXN0b21pemUgdGhlIEFNSSB1c2VkIHRvIHNwaW4tdXAgcnVubmVycy4gU29tZSBydW5uZXIgcHJvdmlkZXJzIG1heSByZXF1aXJlIGN1c3RvbSBjb21wb25lbnRzLiBDaGVjayB0aGUgcnVubmVyIHByb3ZpZGVyIGRvY3VtZW50YXRpb24uXG4gKlxuICogRm9yIGV4YW1wbGUsIHRvIHNldCBhIHNwZWNpZmljIHJ1bm5lciB2ZXJzaW9uLCByZWJ1aWxkIHRoZSBpbWFnZSBldmVyeSAyIHdlZWtzLCBhbmQgYWRkIGEgZmV3IHBhY2thZ2VzIGZvciB0aGUgRUMyIHByb3ZpZGVyLCB1c2U6XG4gKlxuICogYGBgXG4gKiBjb25zdCBidWlsZGVyID0gbmV3IEFtaUJ1aWxkZXIodGhpcywgJ0J1aWxkZXInLCB7XG4gKiAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygnMi4yOTMuMCcpLFxuICogICAgIHJlYnVpbGRJbnRlcnZhbDogRHVyYXRpb24uZGF5cygxNCksXG4gKiB9KTtcbiAqIGJ1aWxkZXIuYWRkQ29tcG9uZW50KG5ldyBJbWFnZUJ1aWxkZXJDb21wb25lbnQoc2NvcGUsIGlkLCB7XG4gKiAgIHBsYXRmb3JtOiAnTGludXgnLFxuICogICBkaXNwbGF5TmFtZTogJ3A3emlwJyxcbiAqICAgZGVzY3JpcHRpb246ICdJbnN0YWxsIHNvbWUgbW9yZSBwYWNrYWdlcycsXG4gKiAgIGNvbW1hbmRzOiBbXG4gKiAgICAgJ2FwdC1nZXQgaW5zdGFsbCBwN3ppcCcsXG4gKiAgIF0sXG4gKiB9KSk7XG4gKiBuZXcgRWMyUnVubmVyUHJvdmlkZXIodGhpcywgJ0VDMiBwcm92aWRlcicsIHtcbiAqICAgICBsYWJlbHM6IFsnY3VzdG9tLWVjMiddLFxuICogICAgIGFtaUJ1aWxkZXI6IGJ1aWxkZXIsXG4gKiB9KTtcbiAqIGBgYFxuICpcbiAqIEBkZXByZWNhdGVkIHVzZSBSdW5uZXJJbWFnZUJ1aWxkZXIsIGUuZy4gd2l0aCBFYzJSdW5uZXJQcm92aWRlci5pbWFnZUJ1aWxkZXIoKVxuICovXG5leHBvcnQgY2xhc3MgQW1pQnVpbGRlciBleHRlbmRzIEltYWdlQnVpbGRlckJhc2Uge1xuICBwcml2YXRlIGJvdW5kQW1pPzogUnVubmVyQW1pO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogQW1pQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCB7XG4gICAgICBvczogcHJvcHM/Lm9zLFxuICAgICAgc3VwcG9ydGVkT3M6IFtPcy5MSU5VWCwgT3MuTElOVVhfVUJVTlRVLCBPcy5MSU5VWF9VQlVOVFVfMjIwNCwgT3MuTElOVVhfQU1BWk9OXzIsIE9zLldJTkRPV1NdLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBwcm9wcz8uYXJjaGl0ZWN0dXJlLFxuICAgICAgc3VwcG9ydGVkQXJjaGl0ZWN0dXJlczogW0FyY2hpdGVjdHVyZS5YODZfNjQsIEFyY2hpdGVjdHVyZS5BUk02NF0sXG4gICAgICBpbnN0YW5jZVR5cGU6IHByb3BzPy5pbnN0YW5jZVR5cGUsXG4gICAgICB2cGM6IHByb3BzPy52cGMsXG4gICAgICBzZWN1cml0eUdyb3VwczogcHJvcHM/LnNlY3VyaXR5R3JvdXAgPyBbcHJvcHMuc2VjdXJpdHlHcm91cF0gOiBwcm9wcz8uc2VjdXJpdHlHcm91cHMsXG4gICAgICBzdWJuZXRTZWxlY3Rpb246IHByb3BzPy5zdWJuZXRTZWxlY3Rpb24sXG4gICAgICBsb2dSZW1vdmFsUG9saWN5OiBwcm9wcz8ubG9nUmVtb3ZhbFBvbGljeSxcbiAgICAgIGxvZ1JldGVudGlvbjogcHJvcHM/LmxvZ1JldGVudGlvbixcbiAgICAgIHJ1bm5lclZlcnNpb246IHByb3BzPy5ydW5uZXJWZXJzaW9uLFxuICAgICAgcmVidWlsZEludGVydmFsOiBwcm9wcz8ucmVidWlsZEludGVydmFsLFxuICAgICAgaW1hZ2VUeXBlTmFtZTogJ0FNSScsXG4gICAgfSk7XG5cbiAgICAvLyBhZGQgYWxsIGJhc2ljIGNvbXBvbmVudHNcbiAgICBpZiAodGhpcy5vcy5pcyhPcy5XSU5ET1dTKSkge1xuICAgICAgdGhpcy5hZGRCYXNlV2luZG93c0NvbXBvbmVudHMocHJvcHM/Lmluc3RhbGxEb2NrZXIgPz8gdHJ1ZSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLm9zLmlzKE9zLkxJTlVYKSB8fCB0aGlzLm9zLmlzKE9zLkxJTlVYX1VCVU5UVV8yMjA0KSkge1xuICAgICAgdGhpcy5hZGRCYXNlTGludXhDb21wb25lbnRzKHByb3BzPy5pbnN0YWxsRG9ja2VyID8/IHRydWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIE9TIGZvciBBTUkgYnVpbGRlcjogJHt0aGlzLm9zLm5hbWV9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhZGRCYXNlV2luZG93c0NvbXBvbmVudHMoaW5zdGFsbERvY2tlcjogYm9vbGVhbikge1xuICAgIHRoaXMuYWRkQ29tcG9uZW50KFdpbmRvd3NDb21wb25lbnRzLmNsb3Vkd2F0Y2hBZ2VudCh0aGlzLCAnQ2xvdWRXYXRjaCBhZ2VudCcpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChXaW5kb3dzQ29tcG9uZW50cy5hd3NDbGkodGhpcywgJ0FXUyBDTEknKSk7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuZ2l0aHViQ2xpKHRoaXMsICdHaXRIdWIgQ0xJJykpO1xuICAgIHRoaXMuYWRkQ29tcG9uZW50KFdpbmRvd3NDb21wb25lbnRzLmdpdCh0aGlzLCAnZ2l0JykpO1xuICAgIHRoaXMuYWRkQ29tcG9uZW50KFdpbmRvd3NDb21wb25lbnRzLmdpdGh1YlJ1bm5lcih0aGlzLCAnR2l0SHViIEFjdGlvbnMgUnVubmVyJywgdGhpcy5ydW5uZXJWZXJzaW9uKSk7XG4gICAgaWYgKGluc3RhbGxEb2NrZXIpIHtcbiAgICAgIHRoaXMuYWRkQ29tcG9uZW50KFdpbmRvd3NDb21wb25lbnRzLmRvY2tlcih0aGlzLCAnRG9ja2VyJykpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYWRkQmFzZUxpbnV4Q29tcG9uZW50cyhpbnN0YWxsRG9ja2VyOiBib29sZWFuKSB7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoTGludXhVYnVudHVDb21wb25lbnRzLnJlcXVpcmVkUGFja2FnZXModGhpcywgJ1VwZ3JhZGUgcGFja2FnZXMgYW5kIGluc3RhbGwgYmFzaWNzJywgdGhpcy5hcmNoaXRlY3R1cmUpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChMaW51eFVidW50dUNvbXBvbmVudHMucnVubmVyVXNlcih0aGlzLCAnVXNlcicsIHRoaXMuYXJjaGl0ZWN0dXJlKSk7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoTGludXhVYnVudHVDb21wb25lbnRzLmF3c0NsaSh0aGlzLCAnQVdTIENMSScsIHRoaXMuYXJjaGl0ZWN0dXJlKSk7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoTGludXhVYnVudHVDb21wb25lbnRzLmdpdGh1YkNsaSh0aGlzLCAnR2l0SHViIENMSScsIHRoaXMuYXJjaGl0ZWN0dXJlKSk7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoTGludXhVYnVudHVDb21wb25lbnRzLmdpdCh0aGlzLCAnZ2l0JywgdGhpcy5hcmNoaXRlY3R1cmUpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChMaW51eFVidW50dUNvbXBvbmVudHMuZ2l0aHViUnVubmVyKHRoaXMsICdHaXRIdWIgQWN0aW9ucyBSdW5uZXInLCB0aGlzLnJ1bm5lclZlcnNpb24sIHRoaXMuYXJjaGl0ZWN0dXJlKSk7XG4gICAgaWYgKGluc3RhbGxEb2NrZXIpIHtcbiAgICAgIHRoaXMuYWRkQ29tcG9uZW50KExpbnV4VWJ1bnR1Q29tcG9uZW50cy5kb2NrZXIodGhpcywgJ0RvY2tlcicsIHRoaXMuYXJjaGl0ZWN0dXJlKSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBhIGNvbXBvbmVudCB0byBiZSBpbnN0YWxsZWQgYmVmb3JlIGFueSBvdGhlciBjb21wb25lbnRzLiBVc2VmdWwgZm9yIHJlcXVpcmVkIHN5c3RlbSBzZXR0aW5ncyBsaWtlIGNlcnRpZmljYXRlcyBvciBwcm94eSBzZXR0aW5ncy5cbiAgICogQHBhcmFtIGNvbXBvbmVudFxuICAgKi9cbiAgcHJlcGVuZENvbXBvbmVudChjb21wb25lbnQ6IEltYWdlQnVpbGRlckNvbXBvbmVudCkge1xuICAgIGlmICh0aGlzLmJvdW5kQW1pKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0FNSSBpcyBhbHJlYWR5IGJvdW5kLiBVc2UgdGhpcyBtZXRob2QgYmVmb3JlIHBhc3NpbmcgdGhlIGJ1aWxkZXIgdG8gYSBydW5uZXIgcHJvdmlkZXIuJyk7XG4gICAgfVxuICAgIGlmIChjb21wb25lbnQucGxhdGZvcm0gIT0gdGhpcy5wbGF0Zm9ybSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb21wb25lbnQgcGxhdGZvcm0gZG9lc25cXCd0IG1hdGNoIGJ1aWxkZXIgcGxhdGZvcm0nKTtcbiAgICB9XG4gICAgdGhpcy5jb21wb25lbnRzID0gW2NvbXBvbmVudF0uY29uY2F0KHRoaXMuY29tcG9uZW50cyk7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGEgY29tcG9uZW50IHRvIGJlIGluc3RhbGxlZC5cbiAgICogQHBhcmFtIGNvbXBvbmVudFxuICAgKi9cbiAgYWRkQ29tcG9uZW50KGNvbXBvbmVudDogSW1hZ2VCdWlsZGVyQ29tcG9uZW50KSB7XG4gICAgaWYgKHRoaXMuYm91bmRBbWkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQU1JIGlzIGFscmVhZHkgYm91bmQuIFVzZSB0aGlzIG1ldGhvZCBiZWZvcmUgcGFzc2luZyB0aGUgYnVpbGRlciB0byBhIHJ1bm5lciBwcm92aWRlci4nKTtcbiAgICB9XG4gICAgaWYgKGNvbXBvbmVudC5wbGF0Zm9ybSAhPSB0aGlzLnBsYXRmb3JtKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbXBvbmVudCBwbGF0Zm9ybSBkb2VzblxcJ3QgbWF0Y2ggYnVpbGRlciBwbGF0Zm9ybScpO1xuICAgIH1cbiAgICB0aGlzLmNvbXBvbmVudHMucHVzaChjb21wb25lbnQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBleHRyYSB0cnVzdGVkIGNlcnRpZmljYXRlcy4gVGhpcyBoZWxwcyBkZWFsIHdpdGggc2VsZi1zaWduZWQgY2VydGlmaWNhdGVzIGZvciBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIuXG4gICAqXG4gICAqIEBwYXJhbSBwYXRoIHBhdGggdG8gZGlyZWN0b3J5IGNvbnRhaW5pbmcgYSBmaWxlIGNhbGxlZCBjZXJ0cy5wZW0gY29udGFpbmluZyBhbGwgdGhlIHJlcXVpcmVkIGNlcnRpZmljYXRlc1xuICAgKi9cbiAgcHVibGljIGFkZEV4dHJhQ2VydGlmaWNhdGVzKHBhdGg6IHN0cmluZykge1xuICAgIGlmICh0aGlzLnBsYXRmb3JtID09ICdMaW51eCcpIHtcbiAgICAgIHRoaXMucHJlcGVuZENvbXBvbmVudChMaW51eFVidW50dUNvbXBvbmVudHMuZXh0cmFDZXJ0aWZpY2F0ZXModGhpcywgJ0V4dHJhIENlcnRzJywgcGF0aCkpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wbGF0Zm9ybSA9PSAnV2luZG93cycpIHtcbiAgICAgIHRoaXMucHJlcGVuZENvbXBvbmVudChXaW5kb3dzQ29tcG9uZW50cy5leHRyYUNlcnRpZmljYXRlcyh0aGlzLCAnRXh0cmEgQ2VydHMnLCBwYXRoKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwbGF0Zm9ybTogJHt0aGlzLnBsYXRmb3JtfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgSVJ1bm5lclByb3ZpZGVyIHRvIGZpbmFsaXplIHNldHRpbmdzIGFuZCBjcmVhdGUgdGhlIEFNSSBidWlsZGVyLlxuICAgKi9cbiAgYmluZEFtaSgpOiBSdW5uZXJBbWkge1xuICAgIGlmICh0aGlzLmJvdW5kQW1pKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib3VuZEFtaTtcbiAgICB9XG5cbiAgICBjb25zdCBsYXVuY2hUZW1wbGF0ZSA9IG5ldyBlYzIuTGF1bmNoVGVtcGxhdGUodGhpcywgJ0xhdW5jaCB0ZW1wbGF0ZScsIHtcbiAgICAgIHJlcXVpcmVJbWRzdjI6IHRydWUsXG4gICAgfSk7XG5cbiAgICBjb25zdCBzdGFja05hbWUgPSBjZGsuU3RhY2sub2YodGhpcykuc3RhY2tOYW1lO1xuICAgIGNvbnN0IGJ1aWxkZXJOYW1lID0gdGhpcy5ub2RlLnBhdGg7XG5cbiAgICBjb25zdCBkaXN0ID0gbmV3IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uKHRoaXMsICdEaXN0cmlidXRpb24nLCB7XG4gICAgICBuYW1lOiB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpLFxuICAgICAgZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXG4gICAgICBkaXN0cmlidXRpb25zOiBbXG4gICAgICAgIHtcbiAgICAgICAgICByZWdpb246IFN0YWNrLm9mKHRoaXMpLnJlZ2lvbixcbiAgICAgICAgICBhbWlEaXN0cmlidXRpb25Db25maWd1cmF0aW9uOiB7XG4gICAgICAgICAgICBOYW1lOiBgJHtjZGsuTmFtZXMudW5pcXVlUmVzb3VyY2VOYW1lKHRoaXMsIHtcbiAgICAgICAgICAgICAgbWF4TGVuZ3RoOiAxMDAsXG4gICAgICAgICAgICAgIHNlcGFyYXRvcjogJy0nLFxuICAgICAgICAgICAgICBhbGxvd2VkU3BlY2lhbENoYXJhY3RlcnM6ICdfLScsXG4gICAgICAgICAgICB9KX0te3sgaW1hZ2VidWlsZGVyOmJ1aWxkRGF0ZSB9fWAsXG4gICAgICAgICAgICBBbWlUYWdzOiB7XG4gICAgICAgICAgICAgICdOYW1lJzogdGhpcy5ub2RlLmlkLFxuICAgICAgICAgICAgICAnR2l0SHViUnVubmVyczpTdGFjayc6IHN0YWNrTmFtZSxcbiAgICAgICAgICAgICAgJ0dpdEh1YlJ1bm5lcnM6QnVpbGRlcic6IGJ1aWxkZXJOYW1lLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGxhdW5jaFRlbXBsYXRlQ29uZmlndXJhdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgbGF1bmNoVGVtcGxhdGVJZDogbGF1bmNoVGVtcGxhdGUubGF1bmNoVGVtcGxhdGVJZCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICBjb25zdCByZWNpcGUgPSBuZXcgQW1pUmVjaXBlKHRoaXMsICdBbWkgUmVjaXBlJywge1xuICAgICAgcGxhdGZvcm06IHRoaXMucGxhdGZvcm0sXG4gICAgICBjb21wb25lbnRzOiB0aGlzLmNvbXBvbmVudHMsXG4gICAgICBhcmNoaXRlY3R1cmU6IHRoaXMuYXJjaGl0ZWN0dXJlLFxuICAgICAgYmFzZUFtaTogZGVmYXVsdEJhc2VBbWkodGhpcywgdGhpcy5vcywgdGhpcy5hcmNoaXRlY3R1cmUpLFxuICAgICAgdGFnczoge1xuICAgICAgICAnR2l0SHViUnVubmVyczpTdGFjayc6IHN0YWNrTmFtZSxcbiAgICAgICAgJ0dpdEh1YlJ1bm5lcnM6QnVpbGRlcic6IGJ1aWxkZXJOYW1lLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxvZyA9IHRoaXMuY3JlYXRlTG9nKHJlY2lwZS5uYW1lKTtcbiAgICBjb25zdCBpbmZyYSA9IHRoaXMuY3JlYXRlSW5mcmFzdHJ1Y3R1cmUoW1xuICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlJyksXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0VDMkluc3RhbmNlUHJvZmlsZUZvckltYWdlQnVpbGRlcicpLFxuICAgIF0pO1xuICAgIHRoaXMuY3JlYXRlSW1hZ2UoaW5mcmEsIGRpc3QsIGxvZywgcmVjaXBlLmFybiwgdW5kZWZpbmVkKTtcbiAgICB0aGlzLmNyZWF0ZVBpcGVsaW5lKGluZnJhLCBkaXN0LCBsb2csIHJlY2lwZS5hcm4sIHVuZGVmaW5lZCk7XG5cbiAgICB0aGlzLmJvdW5kQW1pID0ge1xuICAgICAgbGF1bmNoVGVtcGxhdGU6IGxhdW5jaFRlbXBsYXRlLFxuICAgICAgYXJjaGl0ZWN0dXJlOiB0aGlzLmFyY2hpdGVjdHVyZSxcbiAgICAgIG9zOiB0aGlzLm9zLFxuICAgICAgbG9nR3JvdXA6IGxvZyxcbiAgICAgIHJ1bm5lclZlcnNpb246IHRoaXMucnVubmVyVmVyc2lvbixcbiAgICB9O1xuXG4gICAgdGhpcy5pbWFnZUNsZWFuZXIoKTtcblxuICAgIHJldHVybiB0aGlzLmJvdW5kQW1pO1xuICB9XG5cbiAgcHJpdmF0ZSBpbWFnZUNsZWFuZXIoKSB7XG4gICAgLy8gdGhlIGxhbWJkYSBubyBsb25nZXIgaW1wbGVtZW50cyB0aGUgc2NoZWR1bGUgZmVhdHVyZVxuICAgIC8vIHRoaXMgaGFzbid0IHdvcmtlZCBzaW5jZSBodHRwczovL2dpdGh1Yi5jb20vQ2xvdWRTbm9ya2VsL2Nkay1naXRodWItcnVubmVycy9wdWxsLzQ3NlxuICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdUaGUgQU1JIGNsZWFuZXIgZm9yIHRoaXMgZGVwcmVjYXRlZCBjbGFzcyBoYXMgYmVlbiBicm9rZW4gc2luY2UgdjAuMTIuMCAoUFIgIzQ3NikgYW5kIHdpbGwgbm90IGRlbGV0ZSBhbnkgQU1Jcy4gUGxlYXNlIG1hbnVhbGx5IGRlbGV0ZSBvbGQgQU1JcyBhbmQgdXBncmFkZSB0byBlLmcuIEVjMlJ1bm5lclByb3ZpZGVyLmltYWdlQnVpbGRlcigpIGluc3RlYWQgb2YgQW1pQnVpbGRlci4nKTtcblxuICAgIC8vIHdlIGtlZXAgdGhlIGxhbWJkYSBpdHNlbGYgYXJvdW5kLCBpbiBjYXNlIHRoZSB1c2VyIGRvZXNuJ3QgaGF2ZSBhbnkgb3RoZXIgaW5zdGFuY2VzIG9mIGl0XG4gICAgLy8gaWYgdGhlcmUgYXJlIG5vIG90aGVyIGluc3RhbmNlcyBvZiBpdCwgdGhlIGN1c3RvbSByZXNvdXJjZSB3aWxsIGJlIGRlbGV0ZWQgd2l0aCB0aGUgb3JpZ2luYWwgbGFtYmRhIHNvdXJjZSBjb2RlIHdoaWNoIG1heSBkZWxldGUgdGhlIEFNSXMgb24gaXRzIHdheSBvdXRcbiAgICBzaW5nbGV0b25MYW1iZGEoRGVsZXRlUmVzb3VyY2VzRnVuY3Rpb24sIHRoaXMsICdkZWxldGUtYW1pJywge1xuICAgICAgZGVzY3JpcHRpb246ICdEZWxldGUgb2xkIEdpdEh1YiBSdW5uZXIgQU1JcyAoZGVmdW5jdCknLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgfSk7XG4gIH1cblxuICBiaW5kRG9ja2VySW1hZ2UoKTogUnVubmVySW1hZ2Uge1xuICAgIHRocm93IG5ldyBFcnJvcignQW1pQnVpbGRlciBjYW5ub3QgYmUgdXNlZCB0byBidWlsZCBEb2NrZXIgaW1hZ2VzJyk7XG4gIH1cbn1cbiJdfQ==