"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContainerImageBuilder = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_ecr_1 = require("aws-cdk-lib/aws-ecr");
const common_1 = require("./common");
const linux_components_1 = require("./linux-components");
const windows_components_1 = require("./windows-components");
const providers_1 = require("../../../providers");
const utils_1 = require("../../../utils");
const build_image_function_1 = require("../../build-image-function");
const common_2 = require("../../common");
const container_1 = require("../container");
const dockerfileTemplate = `FROM {{{ imagebuilder:parentImage }}}
ENV RUNNER_VERSION=___RUNNER_VERSION___
{{{ imagebuilder:environments }}}
{{{ imagebuilder:components }}}`;
/**
 * An image builder that uses AWS Image Builder to build Docker images pre-baked with all the GitHub Actions runner requirements. Builders can be used with runner providers.
 *
 * The CodeBuild builder is better and faster. Only use this one if you have no choice. For example, if you need Windows containers.
 *
 * Each builder re-runs automatically at a set interval to make sure the images contain the latest versions of everything.
 *
 * You can create an instance of this construct to customize the image used to spin-up runners. Some runner providers may require custom components. Check the runner provider documentation. The default components work with CodeBuild and Fargate.
 *
 * For example, to set a specific runner version, rebuild the image every 2 weeks, and add a few packages for the Fargate provider, use:
 *
 * ```
 * const builder = new ContainerImageBuilder(this, 'Builder', {
 *     runnerVersion: RunnerVersion.specific('2.293.0'),
 *     rebuildInterval: Duration.days(14),
 * });
 * new CodeBuildRunnerProvider(this, 'CodeBuild provider', {
 *     labels: ['custom-codebuild'],
 *     imageBuilder: builder,
 * });
 * ```
 *
 * @deprecated use RunnerImageBuilder
 */
class ContainerImageBuilder extends common_1.ImageBuilderBase {
    constructor(scope, id, props) {
        super(scope, id, {
            os: props?.os,
            supportedOs: [providers_1.Os.WINDOWS],
            architecture: props?.architecture,
            supportedArchitectures: [providers_1.Architecture.X86_64],
            instanceType: props?.instanceType,
            vpc: props?.vpc,
            securityGroups: props?.securityGroup ? [props.securityGroup] : props?.securityGroups,
            subnetSelection: props?.subnetSelection,
            logRemovalPolicy: props?.logRemovalPolicy,
            logRetention: props?.logRetention,
            runnerVersion: props?.runnerVersion,
            rebuildInterval: props?.rebuildInterval,
            imageTypeName: 'image',
        });
        this.parentImage = props?.parentImage ?? 'mcr.microsoft.com/windows/servercore:ltsc2019-amd64';
        // create repository that only keeps one tag
        this.repository = new aws_cdk_lib_1.aws_ecr.Repository(this, 'Repository', {
            imageScanOnPush: true,
            imageTagMutability: aws_ecr_1.TagMutability.MUTABLE,
            removalPolicy: aws_cdk_lib_1.RemovalPolicy.DESTROY,
            emptyOnDelete: true,
            lifecycleRules: [
                {
                    description: 'Remove all but the latest image',
                    tagStatus: aws_ecr_1.TagStatus.ANY,
                    maxImageCount: 1,
                },
            ],
        });
        // add all basic components
        this.addBaseWindowsComponents();
    }
    addBaseWindowsComponents() {
        this.addComponent(windows_components_1.WindowsComponents.awsCli(this, 'AWS CLI'));
        this.addComponent(windows_components_1.WindowsComponents.githubCli(this, 'GitHub CLI'));
        this.addComponent(windows_components_1.WindowsComponents.git(this, 'git'));
        this.addComponent(windows_components_1.WindowsComponents.githubRunner(this, 'GitHub Actions Runner', this.runnerVersion));
    }
    /**
     * Add a component to be installed before any other components. Useful for required system settings like certificates or proxy settings.
     * @param component
     */
    prependComponent(component) {
        if (this.boundImage) {
            throw new Error('Image is already bound. Use this method before passing the builder to a runner provider.');
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
        if (this.boundImage) {
            throw new Error('Image is already bound. Use this method before passing the builder to a runner provider.');
        }
        if (component.platform != this.platform) {
            throw new Error('Component platform doesn\'t match builder platform');
        }
        this.components.push(component);
    }
    /**
     * Add extra trusted certificates. This helps deal with self-signed certificates for GitHub Enterprise Server.
     *
     * All first party Dockerfiles support this. Others may not.
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
     * Called by IRunnerProvider to finalize settings and create the image builder.
     */
    bindDockerImage() {
        if (this.boundImage) {
            return this.boundImage;
        }
        const dist = new aws_cdk_lib_1.aws_imagebuilder.CfnDistributionConfiguration(this, 'Distribution', {
            name: (0, common_2.uniqueImageBuilderName)(this),
            description: this.description,
            distributions: [
                {
                    region: aws_cdk_lib_1.Stack.of(this).region,
                    containerDistributionConfiguration: {
                        ContainerTags: ['latest'],
                        TargetRepository: {
                            Service: 'ECR',
                            RepositoryName: this.repository.repositoryName,
                        },
                    },
                },
            ],
        });
        const recipe = new container_1.ContainerRecipe(this, 'Container Recipe', {
            platform: this.platform,
            components: this.components,
            targetRepository: this.repository,
            dockerfileTemplate: dockerfileTemplate.replace('___RUNNER_VERSION___', this.runnerVersion.version),
            parentImage: this.parentImage,
            tags: {},
        });
        const log = this.createLog(recipe.name);
        const infra = this.createInfrastructure([
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
            aws_cdk_lib_1.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('EC2InstanceProfileForImageBuilderECRContainerBuilds'),
        ]);
        this.createImage(infra, dist, log, undefined, recipe.arn);
        this.createPipeline(infra, dist, log, undefined, recipe.arn);
        this.imageCleaner();
        this.boundImage = {
            imageRepository: this.repository,
            imageTag: 'latest',
            os: this.os,
            architecture: this.architecture,
            logGroup: log,
            runnerVersion: this.runnerVersion,
            // no dependable as CloudFormation will fail to get image ARN once the image is deleted (we delete old images daily)
        };
        return this.boundImage;
    }
    imageCleaner() {
        // cleaning up in the image builder was always ugly... time to get rid of it
        cdk.Annotations.of(this).addWarning('The image cleaner for this deprecated class has been disabled. Some EC2 Image Builder resources may be left behind once you remove this construct. You can manually delete them from the AWS Management Console.');
        // we keep the lambda itself around, in case the user doesn't have any other instances of it
        // if there are no other instances of it, the custom resource will be deleted with the original lambda source code which may delete the images on its way out
        (0, utils_1.singletonLambda)(build_image_function_1.BuildImageFunction, this, 'build-image', {
            description: 'Custom resource handler that triggers CodeBuild to build runner images',
            timeout: cdk.Duration.minutes(3),
            logRetention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
        });
    }
    bindAmi() {
        throw new Error('ContainerImageBuilder cannot be used to build AMIs');
    }
}
exports.ContainerImageBuilder = ContainerImageBuilder;
_a = JSII_RTTI_SYMBOL_1;
ContainerImageBuilder[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.ContainerImageBuilder", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2RlcHJlY2F0ZWQvY29udGFpbmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsbUNBQW1DO0FBQ25DLDZDQVNxQjtBQUNyQixpREFBK0Q7QUFFL0QscUNBQTRDO0FBQzVDLHlEQUEyRDtBQUMzRCw2REFBeUQ7QUFDekQsa0RBQTZGO0FBQzdGLDBDQUFpRDtBQUNqRCxxRUFBZ0U7QUFDaEUseUNBQXNEO0FBRXRELDRDQUErQztBQUUvQyxNQUFNLGtCQUFrQixHQUFHOzs7Z0NBR0ssQ0FBQztBQW1HakM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0dBdUJHO0FBQ0gsTUFBYSxxQkFBc0IsU0FBUSx5QkFBZ0I7SUFLekQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFrQztRQUMxRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtZQUNmLEVBQUUsRUFBRSxLQUFLLEVBQUUsRUFBRTtZQUNiLFdBQVcsRUFBRSxDQUFDLGNBQUUsQ0FBQyxPQUFPLENBQUM7WUFDekIsWUFBWSxFQUFFLEtBQUssRUFBRSxZQUFZO1lBQ2pDLHNCQUFzQixFQUFFLENBQUMsd0JBQVksQ0FBQyxNQUFNLENBQUM7WUFDN0MsWUFBWSxFQUFFLEtBQUssRUFBRSxZQUFZO1lBQ2pDLEdBQUcsRUFBRSxLQUFLLEVBQUUsR0FBRztZQUNmLGNBQWMsRUFBRSxLQUFLLEVBQUUsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLENBQUMsS0FBSyxFQUFFLGNBQWM7WUFDcEYsZUFBZSxFQUFFLEtBQUssRUFBRSxlQUFlO1lBQ3ZDLGdCQUFnQixFQUFFLEtBQUssRUFBRSxnQkFBZ0I7WUFDekMsWUFBWSxFQUFFLEtBQUssRUFBRSxZQUFZO1lBQ2pDLGFBQWEsRUFB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QUUsd0VBQXdFO1lBQ3JGLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7WUFDaEMsWUFBWSxFQUFFLHNCQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7U0FDM0MsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVELE9BQU87UUFDTCxNQUFNLElBQUksS0FBSyxDQUFDLG9EQUFvRCxDQUFDLENBQUM7SUFDeEUsQ0FBQzs7QUF2S0gsc0RBd0tDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7XG4gIGF3c19lYzIgYXMgZWMyLFxuICBhd3NfZWNyIGFzIGVjcixcbiAgYXdzX2lhbSBhcyBpYW0sXG4gIGF3c19pbWFnZWJ1aWxkZXIgYXMgaW1hZ2VidWlsZGVyLFxuICBhd3NfbG9ncyBhcyBsb2dzLFxuICBEdXJhdGlvbixcbiAgUmVtb3ZhbFBvbGljeSxcbiAgU3RhY2ssXG59IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IFRhZ011dGFiaWxpdHksIFRhZ1N0YXR1cyB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBJbWFnZUJ1aWxkZXJCYXNlIH0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgTGludXhVYnVudHVDb21wb25lbnRzIH0gZnJvbSAnLi9saW51eC1jb21wb25lbnRzJztcbmltcG9ydCB7IFdpbmRvd3NDb21wb25lbnRzIH0gZnJvbSAnLi93aW5kb3dzLWNvbXBvbmVudHMnO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBPcywgUnVubmVyQW1pLCBSdW5uZXJJbWFnZSwgUnVubmVyVmVyc2lvbiB9IGZyb20gJy4uLy4uLy4uL3Byb3ZpZGVycyc7XG5pbXBvcnQgeyBzaW5nbGV0b25MYW1iZGEgfSBmcm9tICcuLi8uLi8uLi91dGlscyc7XG5pbXBvcnQgeyBCdWlsZEltYWdlRnVuY3Rpb24gfSBmcm9tICcuLi8uLi9idWlsZC1pbWFnZS1mdW5jdGlvbic7XG5pbXBvcnQgeyB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lIH0gZnJvbSAnLi4vLi4vY29tbW9uJztcbmltcG9ydCB7IEltYWdlQnVpbGRlckNvbXBvbmVudCB9IGZyb20gJy4uL2J1aWxkZXInO1xuaW1wb3J0IHsgQ29udGFpbmVyUmVjaXBlIH0gZnJvbSAnLi4vY29udGFpbmVyJztcblxuY29uc3QgZG9ja2VyZmlsZVRlbXBsYXRlID0gYEZST00ge3t7IGltYWdlYnVpbGRlcjpwYXJlbnRJbWFnZSB9fX1cbkVOViBSVU5ORVJfVkVSU0lPTj1fX19SVU5ORVJfVkVSU0lPTl9fX1xue3t7IGltYWdlYnVpbGRlcjplbnZpcm9ubWVudHMgfX19XG57e3sgaW1hZ2VidWlsZGVyOmNvbXBvbmVudHMgfX19YDtcblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBDb250YWluZXJJbWFnZUJ1aWxkZXIgY29uc3RydWN0LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbnRhaW5lckltYWdlQnVpbGRlclByb3BzIHtcbiAgLyoqXG4gICAqIEltYWdlIGFyY2hpdGVjdHVyZS5cbiAgICpcbiAgICogQGRlZmF1bHQgQXJjaGl0ZWN0dXJlLlg4Nl82NFxuICAgKi9cbiAgcmVhZG9ubHkgYXJjaGl0ZWN0dXJlPzogQXJjaGl0ZWN0dXJlO1xuXG4gIC8qKlxuICAgKiBJbWFnZSBPUy5cbiAgICpcbiAgICogQGRlZmF1bHQgT1MuTElOVVhcbiAgICovXG4gIHJlYWRvbmx5IG9zPzogT3M7XG5cbiAgLyoqXG4gICAqIFBhcmVudCBpbWFnZSBmb3IgdGhlIG5ldyBEb2NrZXIgSW1hZ2UuIFlvdSBjYW4gdXNlIGVpdGhlciBJbWFnZSBCdWlsZGVyIGltYWdlIEFSTiBvciBwdWJsaWMgcmVnaXN0cnkgaW1hZ2UuXG4gICAqXG4gICAqIEBkZWZhdWx0ICdtY3IubWljcm9zb2Z0LmNvbS93aW5kb3dzL3NlcnZlcmNvcmU6bHRzYzIwMTktYW1kNjQnXG4gICAqL1xuICByZWFkb25seSBwYXJlbnRJbWFnZT86IHN0cmluZztcblxuICAvKipcbiAgICogVmVyc2lvbiBvZiBHaXRIdWIgUnVubmVycyB0byBpbnN0YWxsLlxuICAgKlxuICAgKiBAZGVmYXVsdCBsYXRlc3QgdmVyc2lvbiBhdmFpbGFibGVcbiAgICovXG4gIHJlYWRvbmx5IHJ1bm5lclZlcnNpb24/OiBSdW5uZXJWZXJzaW9uO1xuXG4gIC8qKlxuICAgKiBTY2hlZHVsZSB0aGUgaW1hZ2UgdG8gYmUgcmVidWlsdCBldmVyeSBnaXZlbiBpbnRlcnZhbC4gVXNlZnVsIGZvciBrZWVwaW5nIHRoZSBpbWFnZSB1cC1kby1kYXRlIHdpdGggdGhlIGxhdGVzdCBHaXRIdWIgcnVubmVyIHZlcnNpb24gYW5kIGxhdGVzdCBPUyB1cGRhdGVzLlxuICAgKlxuICAgKiBTZXQgdG8gemVybyB0byBkaXNhYmxlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBEdXJhdGlvbi5kYXlzKDcpXG4gICAqL1xuICByZWFkb25seSByZWJ1aWxkSW50ZXJ2YWw/OiBEdXJhdGlvbjtcblxuICAvKipcbiAgICogVlBDIHRvIGxhdW5jaCB0aGUgcnVubmVycyBpbi5cbiAgICpcbiAgICogQGRlZmF1bHQgZGVmYXVsdCBhY2NvdW50IFZQQ1xuICAgKi9cbiAgcmVhZG9ubHkgdnBjPzogZWMyLklWcGM7XG5cbiAgLyoqXG4gICAqIFNlY3VyaXR5IGdyb3VwIHRvIGFzc2lnbiB0byBsYXVuY2hlZCBidWlsZGVyIGluc3RhbmNlcy5cbiAgICpcbiAgICogQGRlZmF1bHQgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqXG4gICAqIEBkZXByZWNhdGVkIHVzZSB7QGxpbmsgc2VjdXJpdHlHcm91cHN9XG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3VwPzogZWMyLklTZWN1cml0eUdyb3VwO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cHMgdG8gYXNzaWduIHRvIGxhdW5jaGVkIGJ1aWxkZXIgaW5zdGFuY2VzLlxuICAgKlxuICAgKiBAZGVmYXVsdCBuZXcgc2VjdXJpdHkgZ3JvdXBcbiAgICovXG4gIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzPzogZWMyLklTZWN1cml0eUdyb3VwW107XG5cbiAgLyoqXG4gICAqIFdoZXJlIHRvIHBsYWNlIHRoZSBuZXR3b3JrIGludGVyZmFjZXMgd2l0aGluIHRoZSBWUEMuXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgVlBDIHN1Ym5ldFxuICAgKi9cbiAgcmVhZG9ubHkgc3VibmV0U2VsZWN0aW9uPzogZWMyLlN1Ym5ldFNlbGVjdGlvbjtcblxuICAvKipcbiAgICogVGhlIGluc3RhbmNlIHR5cGUgdXNlZCB0byBidWlsZCB0aGUgaW1hZ2UuXG4gICAqXG4gICAqIEBkZWZhdWx0IG02aS5sYXJnZVxuICAgKi9cbiAgcmVhZG9ubHkgaW5zdGFuY2VUeXBlPzogZWMyLkluc3RhbmNlVHlwZTtcblxuICAvKipcbiAgICogVGhlIG51bWJlciBvZiBkYXlzIGxvZyBldmVudHMgYXJlIGtlcHQgaW4gQ2xvdWRXYXRjaCBMb2dzLiBXaGVuIHVwZGF0aW5nXG4gICAqIHRoaXMgcHJvcGVydHksIHVuc2V0dGluZyBpdCBkb2Vzbid0IHJlbW92ZSB0aGUgbG9nIHJldGVudGlvbiBwb2xpY3kuIFRvXG4gICAqIHJlbW92ZSB0aGUgcmV0ZW50aW9uIHBvbGljeSwgc2V0IHRoZSB2YWx1ZSB0byBgSU5GSU5JVEVgLlxuICAgKlxuICAgKiBAZGVmYXVsdCBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRIXG4gICAqL1xuICByZWFkb25seSBsb2dSZXRlbnRpb24/OiBsb2dzLlJldGVudGlvbkRheXM7XG5cbiAgLyoqXG4gICAqIFJlbW92YWwgcG9saWN5IGZvciBsb2dzIG9mIGltYWdlIGJ1aWxkcy4gSWYgZGVwbG95bWVudCBmYWlscyBvbiB0aGUgY3VzdG9tIHJlc291cmNlLCB0cnkgc2V0dGluZyB0aGlzIHRvIGBSZW1vdmFsUG9saWN5LlJFVEFJTmAuIFRoaXMgd2F5IHRoZSBDb2RlQnVpbGQgbG9ncyBjYW4gc3RpbGwgYmUgdmlld2VkLCBhbmQgeW91IGNhbiBzZWUgd2h5IHRoZSBidWlsZCBmYWlsZWQuXG4gICAqXG4gICAqIFdlIHRyeSB0byBub3QgbGVhdmUgYW55dGhpbmcgYmVoaW5kIHdoZW4gcmVtb3ZlZC4gQnV0IHNvbWV0aW1lcyBhIGxvZyBzdGF5aW5nIGJlaGluZCBpcyB1c2VmdWwuXG4gICAqXG4gICAqIEBkZWZhdWx0IFJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgKi9cbiAgcmVhZG9ubHkgbG9nUmVtb3ZhbFBvbGljeT86IFJlbW92YWxQb2xpY3k7XG59XG5cbi8qKlxuICogQW4gaW1hZ2UgYnVpbGRlciB0aGF0IHVzZXMgQVdTIEltYWdlIEJ1aWxkZXIgdG8gYnVpbGQgRG9ja2VyIGltYWdlcyBwcmUtYmFrZWQgd2l0aCBhbGwgdGhlIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciByZXF1aXJlbWVudHMuIEJ1aWxkZXJzIGNhbiBiZSB1c2VkIHdpdGggcnVubmVyIHByb3ZpZGVycy5cbiAqXG4gKiBUaGUgQ29kZUJ1aWxkIGJ1aWxkZXIgaXMgYmV0dGVyIGFuZCBmYXN0ZXIuIE9ubHkgdXNlIHRoaXMgb25lIGlmIHlvdSBoYXZlIG5vIGNob2ljZS4gRm9yIGV4YW1wbGUsIGlmIHlvdSBuZWVkIFdpbmRvd3MgY29udGFpbmVycy5cbiAqXG4gKiBFYWNoIGJ1aWxkZXIgcmUtcnVucyBhdXRvbWF0aWNhbGx5IGF0IGEgc2V0IGludGVydmFsIHRvIG1ha2Ugc3VyZSB0aGUgaW1hZ2VzIGNvbnRhaW4gdGhlIGxhdGVzdCB2ZXJzaW9ucyBvZiBldmVyeXRoaW5nLlxuICpcbiAqIFlvdSBjYW4gY3JlYXRlIGFuIGluc3RhbmNlIG9mIHRoaXMgY29uc3RydWN0IHRvIGN1c3RvbWl6ZSB0aGUgaW1hZ2UgdXNlZCB0byBzcGluLXVwIHJ1bm5lcnMuIFNvbWUgcnVubmVyIHByb3ZpZGVycyBtYXkgcmVxdWlyZSBjdXN0b20gY29tcG9uZW50cy4gQ2hlY2sgdGhlIHJ1bm5lciBwcm92aWRlciBkb2N1bWVudGF0aW9uLiBUaGUgZGVmYXVsdCBjb21wb25lbnRzIHdvcmsgd2l0aCBDb2RlQnVpbGQgYW5kIEZhcmdhdGUuXG4gKlxuICogRm9yIGV4YW1wbGUsIHRvIHNldCBhIHNwZWNpZmljIHJ1bm5lciB2ZXJzaW9uLCByZWJ1aWxkIHRoZSBpbWFnZSBldmVyeSAyIHdlZWtzLCBhbmQgYWRkIGEgZmV3IHBhY2thZ2VzIGZvciB0aGUgRmFyZ2F0ZSBwcm92aWRlciwgdXNlOlxuICpcbiAqIGBgYFxuICogY29uc3QgYnVpbGRlciA9IG5ldyBDb250YWluZXJJbWFnZUJ1aWxkZXIodGhpcywgJ0J1aWxkZXInLCB7XG4gKiAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5zcGVjaWZpYygnMi4yOTMuMCcpLFxuICogICAgIHJlYnVpbGRJbnRlcnZhbDogRHVyYXRpb24uZGF5cygxNCksXG4gKiB9KTtcbiAqIG5ldyBDb2RlQnVpbGRSdW5uZXJQcm92aWRlcih0aGlzLCAnQ29kZUJ1aWxkIHByb3ZpZGVyJywge1xuICogICAgIGxhYmVsczogWydjdXN0b20tY29kZWJ1aWxkJ10sXG4gKiAgICAgaW1hZ2VCdWlsZGVyOiBidWlsZGVyLFxuICogfSk7XG4gKiBgYGBcbiAqXG4gKiBAZGVwcmVjYXRlZCB1c2UgUnVubmVySW1hZ2VCdWlsZGVyXG4gKi9cbmV4cG9ydCBjbGFzcyBDb250YWluZXJJbWFnZUJ1aWxkZXIgZXh0ZW5kcyBJbWFnZUJ1aWxkZXJCYXNlIHtcbiAgcmVhZG9ubHkgcmVwb3NpdG9yeTogZWNyLklSZXBvc2l0b3J5O1xuICBwcml2YXRlIHJlYWRvbmx5IHBhcmVudEltYWdlOiBzdHJpbmc7XG4gIHByaXZhdGUgYm91bmRJbWFnZT86IFJ1bm5lckltYWdlO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogQ29udGFpbmVySW1hZ2VCdWlsZGVyUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHtcbiAgICAgIG9zOiBwcm9wcz8ub3MsXG4gICAgICBzdXBwb3J0ZWRPczogW09zLldJTkRPV1NdLFxuICAgICAgYXJjaGl0ZWN0dXJlOiBwcm9wcz8uYXJjaGl0ZWN0dXJlLFxuICAgICAgc3VwcG9ydGVkQXJjaGl0ZWN0dXJlczogW0FyY2hpdGVjdHVyZS5YODZfNjRdLFxuICAgICAgaW5zdGFuY2VUeXBlOiBwcm9wcz8uaW5zdGFuY2VUeXBlLFxuICAgICAgdnBjOiBwcm9wcz8udnBjLFxuICAgICAgc2VjdXJpdHlHcm91cHM6IHByb3BzPy5zZWN1cml0eUdyb3VwID8gW3Byb3BzLnNlY3VyaXR5R3JvdXBdIDogcHJvcHM/LnNlY3VyaXR5R3JvdXBzLFxuICAgICAgc3VibmV0U2VsZWN0aW9uOiBwcm9wcz8uc3VibmV0U2VsZWN0aW9uLFxuICAgICAgbG9nUmVtb3ZhbFBvbGljeTogcHJvcHM/LmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgICBsb2dSZXRlbnRpb246IHByb3BzPy5sb2dSZXRlbnRpb24sXG4gICAgICBydW5uZXJWZXJzaW9uOiBwcm9wcz8ucnVubmVyVmVyc2lvbixcbiAgICAgIHJlYnVpbGRJbnRlcnZhbDogcHJvcHM/LnJlYnVpbGRJbnRlcnZhbCxcbiAgICAgIGltYWdlVHlwZU5hbWU6ICdpbWFnZScsXG4gICAgfSk7XG5cbiAgICB0aGlzLnBhcmVudEltYWdlID0gcHJvcHM/LnBhcmVudEltYWdlID8/ICdtY3IubWljcm9zb2Z0LmNvbS93aW5kb3dzL3NlcnZlcmNvcmU6bHRzYzIwMTktYW1kNjQnO1xuXG4gICAgLy8gY3JlYXRlIHJlcG9zaXRvcnkgdGhhdCBvbmx5IGtlZXBzIG9uZSB0YWdcbiAgICB0aGlzLnJlcG9zaXRvcnkgPSBuZXcgZWNyLlJlcG9zaXRvcnkodGhpcywgJ1JlcG9zaXRvcnknLCB7XG4gICAgICBpbWFnZVNjYW5PblB1c2g6IHRydWUsXG4gICAgICBpbWFnZVRhZ011dGFiaWxpdHk6IFRhZ011dGFiaWxpdHkuTVVUQUJMRSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IFJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIGVtcHR5T25EZWxldGU6IHRydWUsXG4gICAgICBsaWZlY3ljbGVSdWxlczogW1xuICAgICAgICB7XG4gICAgICAgICAgZGVzY3JpcHRpb246ICdSZW1vdmUgYWxsIGJ1dCB0aGUgbGF0ZXN0IGltYWdlJyxcbiAgICAgICAgICB0YWdTdGF0dXM6IFRhZ1N0YXR1cy5BTlksXG4gICAgICAgICAgbWF4SW1hZ2VDb3VudDogMSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBhZGQgYWxsIGJhc2ljIGNvbXBvbmVudHNcbiAgICB0aGlzLmFkZEJhc2VXaW5kb3dzQ29tcG9uZW50cygpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRCYXNlV2luZG93c0NvbXBvbmVudHMoKSB7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuYXdzQ2xpKHRoaXMsICdBV1MgQ0xJJykpO1xuICAgIHRoaXMuYWRkQ29tcG9uZW50KFdpbmRvd3NDb21wb25lbnRzLmdpdGh1YkNsaSh0aGlzLCAnR2l0SHViIENMSScpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChXaW5kb3dzQ29tcG9uZW50cy5naXQodGhpcywgJ2dpdCcpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChXaW5kb3dzQ29tcG9uZW50cy5naXRodWJSdW5uZXIodGhpcywgJ0dpdEh1YiBBY3Rpb25zIFJ1bm5lcicsIHRoaXMucnVubmVyVmVyc2lvbikpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBhIGNvbXBvbmVudCB0byBiZSBpbnN0YWxsZWQgYmVmb3JlIGFueSBvdGhlciBjb21wb25lbnRzLiBVc2VmdWwgZm9yIHJlcXVpcmVkIHN5c3RlbSBzZXR0aW5ncyBsaWtlIGNlcnRpZmljYXRlcyBvciBwcm94eSBzZXR0aW5ncy5cbiAgICogQHBhcmFtIGNvbXBvbmVudFxuICAgKi9cbiAgcHJlcGVuZENvbXBvbmVudChjb21wb25lbnQ6IEltYWdlQnVpbGRlckNvbXBvbmVudCkge1xuICAgIGlmICh0aGlzLmJvdW5kSW1hZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW1hZ2UgaXMgYWxyZWFkeSBib3VuZC4gVXNlIHRoaXMgbWV0aG9kIGJlZm9yZSBwYXNzaW5nIHRoZSBidWlsZGVyIHRvIGEgcnVubmVyIHByb3ZpZGVyLicpO1xuICAgIH1cbiAgICBpZiAoY29tcG9uZW50LnBsYXRmb3JtICE9IHRoaXMucGxhdGZvcm0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29tcG9uZW50IHBsYXRmb3JtIGRvZXNuXFwndCBtYXRjaCBidWlsZGVyIHBsYXRmb3JtJyk7XG4gICAgfVxuICAgIHRoaXMuY29tcG9uZW50cyA9IFtjb21wb25lbnRdLmNvbmNhdCh0aGlzLmNvbXBvbmVudHMpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBhIGNvbXBvbmVudCB0byBiZSBpbnN0YWxsZWQuXG4gICAqIEBwYXJhbSBjb21wb25lbnRcbiAgICovXG4gIGFkZENvbXBvbmVudChjb21wb25lbnQ6IEltYWdlQnVpbGRlckNvbXBvbmVudCkge1xuICAgIGlmICh0aGlzLmJvdW5kSW1hZ2UpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW1hZ2UgaXMgYWxyZWFkeSBib3VuZC4gVXNlIHRoaXMgbWV0aG9kIGJlZm9yZSBwYXNzaW5nIHRoZSBidWlsZGVyIHRvIGEgcnVubmVyIHByb3ZpZGVyLicpO1xuICAgIH1cbiAgICBpZiAoY29tcG9uZW50LnBsYXRmb3JtICE9IHRoaXMucGxhdGZvcm0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29tcG9uZW50IHBsYXRmb3JtIGRvZXNuXFwndCBtYXRjaCBidWlsZGVyIHBsYXRmb3JtJyk7XG4gICAgfVxuICAgIHRoaXMuY29tcG9uZW50cy5wdXNoKGNvbXBvbmVudCk7XG4gIH1cblxuICAvKipcbiAgICogQWRkIGV4dHJhIHRydXN0ZWQgY2VydGlmaWNhdGVzLiBUaGlzIGhlbHBzIGRlYWwgd2l0aCBzZWxmLXNpZ25lZCBjZXJ0aWZpY2F0ZXMgZm9yIEdpdEh1YiBFbnRlcnByaXNlIFNlcnZlci5cbiAgICpcbiAgICogQWxsIGZpcnN0IHBhcnR5IERvY2tlcmZpbGVzIHN1cHBvcnQgdGhpcy4gT3RoZXJzIG1heSBub3QuXG4gICAqXG4gICAqIEBwYXJhbSBwYXRoIHBhdGggdG8gZGlyZWN0b3J5IGNvbnRhaW5pbmcgYSBmaWxlIGNhbGxlZCBjZXJ0cy5wZW0gY29udGFpbmluZyBhbGwgdGhlIHJlcXVpcmVkIGNlcnRpZmljYXRlc1xuICAgKi9cbiAgcHVibGljIGFkZEV4dHJhQ2VydGlmaWNhdGVzKHBhdGg6IHN0cmluZykge1xuICAgIGlmICh0aGlzLnBsYXRmb3JtID09ICdMaW51eCcpIHtcbiAgICAgIHRoaXMucHJlcGVuZENvbXBvbmVudChMaW51eFVidW50dUNvbXBvbmVudHMuZXh0cmFDZXJ0aWZpY2F0ZXModGhpcywgJ0V4dHJhIENlcnRzJywgcGF0aCkpO1xuICAgIH0gZWxzZSBpZiAodGhpcy5wbGF0Zm9ybSA9PSAnV2luZG93cycpIHtcbiAgICAgIHRoaXMucHJlcGVuZENvbXBvbmVudChXaW5kb3dzQ29tcG9uZW50cy5leHRyYUNlcnRpZmljYXRlcyh0aGlzLCAnRXh0cmEgQ2VydHMnLCBwYXRoKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBwbGF0Zm9ybTogJHt0aGlzLnBsYXRmb3JtfWApO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsZWQgYnkgSVJ1bm5lclByb3ZpZGVyIHRvIGZpbmFsaXplIHNldHRpbmdzIGFuZCBjcmVhdGUgdGhlIGltYWdlIGJ1aWxkZXIuXG4gICAqL1xuICBiaW5kRG9ja2VySW1hZ2UoKTogUnVubmVySW1hZ2Uge1xuICAgIGlmICh0aGlzLmJvdW5kSW1hZ2UpIHtcbiAgICAgIHJldHVybiB0aGlzLmJvdW5kSW1hZ2U7XG4gICAgfVxuXG4gICAgY29uc3QgZGlzdCA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbih0aGlzLCAnRGlzdHJpYnV0aW9uJywge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxuICAgICAgZGlzdHJpYnV0aW9uczogW1xuICAgICAgICB7XG4gICAgICAgICAgcmVnaW9uOiBTdGFjay5vZih0aGlzKS5yZWdpb24sXG4gICAgICAgICAgY29udGFpbmVyRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbjoge1xuICAgICAgICAgICAgQ29udGFpbmVyVGFnczogWydsYXRlc3QnXSxcbiAgICAgICAgICAgIFRhcmdldFJlcG9zaXRvcnk6IHtcbiAgICAgICAgICAgICAgU2VydmljZTogJ0VDUicsXG4gICAgICAgICAgICAgIFJlcG9zaXRvcnlOYW1lOiB0aGlzLnJlcG9zaXRvcnkucmVwb3NpdG9yeU5hbWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmVjaXBlID0gbmV3IENvbnRhaW5lclJlY2lwZSh0aGlzLCAnQ29udGFpbmVyIFJlY2lwZScsIHtcbiAgICAgIHBsYXRmb3JtOiB0aGlzLnBsYXRmb3JtLFxuICAgICAgY29tcG9uZW50czogdGhpcy5jb21wb25lbnRzLFxuICAgICAgdGFyZ2V0UmVwb3NpdG9yeTogdGhpcy5yZXBvc2l0b3J5LFxuICAgICAgZG9ja2VyZmlsZVRlbXBsYXRlOiBkb2NrZXJmaWxlVGVtcGxhdGUucmVwbGFjZSgnX19fUlVOTkVSX1ZFUlNJT05fX18nLCB0aGlzLnJ1bm5lclZlcnNpb24udmVyc2lvbiksXG4gICAgICBwYXJlbnRJbWFnZTogdGhpcy5wYXJlbnRJbWFnZSxcbiAgICAgIHRhZ3M6IHt9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgbG9nID0gdGhpcy5jcmVhdGVMb2cocmVjaXBlLm5hbWUpO1xuICAgIGNvbnN0IGluZnJhID0gdGhpcy5jcmVhdGVJbmZyYXN0cnVjdHVyZShbXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0FtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmUnKSxcbiAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZSgnRUMySW5zdGFuY2VQcm9maWxlRm9ySW1hZ2VCdWlsZGVyRUNSQ29udGFpbmVyQnVpbGRzJyksXG4gICAgXSk7XG4gICAgdGhpcy5jcmVhdGVJbWFnZShpbmZyYSwgZGlzdCwgbG9nLCB1bmRlZmluZWQsIHJlY2lwZS5hcm4pO1xuICAgIHRoaXMuY3JlYXRlUGlwZWxpbmUoaW5mcmEsIGRpc3QsIGxvZywgdW5kZWZpbmVkLCByZWNpcGUuYXJuKTtcblxuICAgIHRoaXMuaW1hZ2VDbGVhbmVyKCk7XG5cbiAgICB0aGlzLmJvdW5kSW1hZ2UgPSB7XG4gICAgICBpbWFnZVJlcG9zaXRvcnk6IHRoaXMucmVwb3NpdG9yeSxcbiAgICAgIGltYWdlVGFnOiAnbGF0ZXN0JyxcbiAgICAgIG9zOiB0aGlzLm9zLFxuICAgICAgYXJjaGl0ZWN0dXJlOiB0aGlzLmFyY2hpdGVjdHVyZSxcbiAgICAgIGxvZ0dyb3VwOiBsb2csXG4gICAgICBydW5uZXJWZXJzaW9uOiB0aGlzLnJ1bm5lclZlcnNpb24sXG4gICAgICAvLyBubyBkZXBlbmRhYmxlIGFzIENsb3VkRm9ybWF0aW9uIHdpbGwgZmFpbCB0byBnZXQgaW1hZ2UgQVJOIG9uY2UgdGhlIGltYWdlIGlzIGRlbGV0ZWQgKHdlIGRlbGV0ZSBvbGQgaW1hZ2VzIGRhaWx5KVxuICAgIH07XG5cbiAgICByZXR1cm4gdGhpcy5ib3VuZEltYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBpbWFnZUNsZWFuZXIoKSB7XG4gICAgLy8gY2xlYW5pbmcgdXAgaW4gdGhlIGltYWdlIGJ1aWxkZXIgd2FzIGFsd2F5cyB1Z2x5Li4uIHRpbWUgdG8gZ2V0IHJpZCBvZiBpdFxuICAgIGNkay5Bbm5vdGF0aW9ucy5vZih0aGlzKS5hZGRXYXJuaW5nKCdUaGUgaW1hZ2UgY2xlYW5lciBmb3IgdGhpcyBkZXByZWNhdGVkIGNsYXNzIGhhcyBiZWVuIGRpc2FibGVkLiBTb21lIEVDMiBJbWFnZSBCdWlsZGVyIHJlc291cmNlcyBtYXkgYmUgbGVmdCBiZWhpbmQgb25jZSB5b3UgcmVtb3ZlIHRoaXMgY29uc3RydWN0LiBZb3UgY2FuIG1hbnVhbGx5IGRlbGV0ZSB0aGVtIGZyb20gdGhlIEFXUyBNYW5hZ2VtZW50IENvbnNvbGUuJyk7XG5cbiAgICAvLyB3ZSBrZWVwIHRoZSBsYW1iZGEgaXRzZWxmIGFyb3VuZCwgaW4gY2FzZSB0aGUgdXNlciBkb2Vzbid0IGhhdmUgYW55IG90aGVyIGluc3RhbmNlcyBvZiBpdFxuICAgIC8vIGlmIHRoZXJlIGFyZSBubyBvdGhlciBpbnN0YW5jZXMgb2YgaXQsIHRoZSBjdXN0b20gcmVzb3VyY2Ugd2lsbCBiZSBkZWxldGVkIHdpdGggdGhlIG9yaWdpbmFsIGxhbWJkYSBzb3VyY2UgY29kZSB3aGljaCBtYXkgZGVsZXRlIHRoZSBpbWFnZXMgb24gaXRzIHdheSBvdXRcbiAgICBzaW5nbGV0b25MYW1iZGEoQnVpbGRJbWFnZUZ1bmN0aW9uLCB0aGlzLCAnYnVpbGQtaW1hZ2UnLCB7XG4gICAgICBkZXNjcmlwdGlvbjogJ0N1c3RvbSByZXNvdXJjZSBoYW5kbGVyIHRoYXQgdHJpZ2dlcnMgQ29kZUJ1aWxkIHRvIGJ1aWxkIHJ1bm5lciBpbWFnZXMnLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMyksXG4gICAgICBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgfSk7XG4gIH1cblxuICBiaW5kQW1pKCk6IFJ1bm5lckFtaSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDb250YWluZXJJbWFnZUJ1aWxkZXIgY2Fubm90IGJlIHVzZWQgdG8gYnVpbGQgQU1JcycpO1xuICB9XG59XG4iXX0=