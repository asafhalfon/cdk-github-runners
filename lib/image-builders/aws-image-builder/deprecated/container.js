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
exports.ContainerImageBuilder = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = __importStar(require("aws-cdk-lib"));
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
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.ContainerImageBuilder", version: "0.0.0" };
    repository;
    parentImage;
    boundImage;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2RlcHJlY2F0ZWQvY29udGFpbmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsNkNBU3FCO0FBQ3JCLGlEQUErRDtBQUUvRCxxQ0FBNEM7QUFDNUMseURBQTJEO0FBQzNELDZEQUF5RDtBQUN6RCxrREFBNkY7QUFDN0YsMENBQWlEO0FBQ2pELHFFQUFnRTtBQUNoRSx5Q0FBc0Q7QUFFdEQsNENBQStDO0FBRS9DLE1BQU0sa0JBQWtCLEdBQUc7OztnQ0FHSyxDQUFDO0FBbUdqQzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7R0F1Qkc7QUFDSCxNQUFhLHFCQUFzQixTQUFRLHlCQUFnQjs7SUFDaEQsVUFBVSxDQUFrQjtJQUNwQixXQUFXLENBQVM7SUFDN0IsVUFBVSxDQUFlO0lBRWpDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBa0M7UUFDMUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7WUFDZixFQUFFLEVBQUUsS0FBSyxFQUFFLEVBQUU7WUFDYixXQUFXLEVBQUUsQ0FBQyxjQUFFLENBQUMsT0FBTyxDQUFDO1lBQ3pCLFlBQVksRUFBRSxLQUFLLEVBQUUsWUFBWTtZQUNqQyxzQkFBc0IsRUFBRSxDQUFDLHdCQUFZLENBQUMsTUFBTSxDQUFDO1lBQzdDLFlBQVksRUFBRSxLQUFLLEVBQUUsWUFBWTtZQUNqQyxHQUFHLEVBQUUsS0FBSyxFQUFFLEdBQUc7WUFDZixjQUFjLEVBQUUsS0FBSyxFQUFFLGFBQWEsQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssRUFBRSxjQUFjO1lBQ3BGLGVBQWUsRUFBRSxLQUFLLEVBQUUsZUFB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RjtRQUM1Riw2SkFBNko7UUFDN0osSUFBQSx1QkFBZSxFQUFDLHlDQUFrQixFQUFFLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDdkQsV0FBVyxFQUFFLHdFQUF3RTtZQUNyRixPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQ2hDLFlBQVksRUFBRSxzQkFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTO1NBQzNDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRCxPQUFPO1FBQ0wsTUFBTSxJQUFJLEtBQUssQ0FBQyxvREFBb0QsQ0FBQyxDQUFDO0lBQ3hFLENBQUM7O0FBdktILHNEQXdLQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQge1xuICBhd3NfZWMyIGFzIGVjMixcbiAgYXdzX2VjciBhcyBlY3IsXG4gIGF3c19pYW0gYXMgaWFtLFxuICBhd3NfaW1hZ2VidWlsZGVyIGFzIGltYWdlYnVpbGRlcixcbiAgYXdzX2xvZ3MgYXMgbG9ncyxcbiAgRHVyYXRpb24sXG4gIFJlbW92YWxQb2xpY3ksXG4gIFN0YWNrLFxufSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBUYWdNdXRhYmlsaXR5LCBUYWdTdGF0dXMgfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgSW1hZ2VCdWlsZGVyQmFzZSB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IExpbnV4VWJ1bnR1Q29tcG9uZW50cyB9IGZyb20gJy4vbGludXgtY29tcG9uZW50cyc7XG5pbXBvcnQgeyBXaW5kb3dzQ29tcG9uZW50cyB9IGZyb20gJy4vd2luZG93cy1jb21wb25lbnRzJztcbmltcG9ydCB7IEFyY2hpdGVjdHVyZSwgT3MsIFJ1bm5lckFtaSwgUnVubmVySW1hZ2UsIFJ1bm5lclZlcnNpb24gfSBmcm9tICcuLi8uLi8uLi9wcm92aWRlcnMnO1xuaW1wb3J0IHsgc2luZ2xldG9uTGFtYmRhIH0gZnJvbSAnLi4vLi4vLi4vdXRpbHMnO1xuaW1wb3J0IHsgQnVpbGRJbWFnZUZ1bmN0aW9uIH0gZnJvbSAnLi4vLi4vYnVpbGQtaW1hZ2UtZnVuY3Rpb24nO1xuaW1wb3J0IHsgdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSB9IGZyb20gJy4uLy4uL2NvbW1vbic7XG5pbXBvcnQgeyBJbWFnZUJ1aWxkZXJDb21wb25lbnQgfSBmcm9tICcuLi9idWlsZGVyJztcbmltcG9ydCB7IENvbnRhaW5lclJlY2lwZSB9IGZyb20gJy4uL2NvbnRhaW5lcic7XG5cbmNvbnN0IGRvY2tlcmZpbGVUZW1wbGF0ZSA9IGBGUk9NIHt7eyBpbWFnZWJ1aWxkZXI6cGFyZW50SW1hZ2UgfX19XG5FTlYgUlVOTkVSX1ZFUlNJT049X19fUlVOTkVSX1ZFUlNJT05fX19cbnt7eyBpbWFnZWJ1aWxkZXI6ZW52aXJvbm1lbnRzIH19fVxue3t7IGltYWdlYnVpbGRlcjpjb21wb25lbnRzIH19fWA7XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgQ29udGFpbmVySW1hZ2VCdWlsZGVyIGNvbnN0cnVjdC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb250YWluZXJJbWFnZUJ1aWxkZXJQcm9wcyB7XG4gIC8qKlxuICAgKiBJbWFnZSBhcmNoaXRlY3R1cmUuXG4gICAqXG4gICAqIEBkZWZhdWx0IEFyY2hpdGVjdHVyZS5YODZfNjRcbiAgICovXG4gIHJlYWRvbmx5IGFyY2hpdGVjdHVyZT86IEFyY2hpdGVjdHVyZTtcblxuICAvKipcbiAgICogSW1hZ2UgT1MuXG4gICAqXG4gICAqIEBkZWZhdWx0IE9TLkxJTlVYXG4gICAqL1xuICByZWFkb25seSBvcz86IE9zO1xuXG4gIC8qKlxuICAgKiBQYXJlbnQgaW1hZ2UgZm9yIHRoZSBuZXcgRG9ja2VyIEltYWdlLiBZb3UgY2FuIHVzZSBlaXRoZXIgSW1hZ2UgQnVpbGRlciBpbWFnZSBBUk4gb3IgcHVibGljIHJlZ2lzdHJ5IGltYWdlLlxuICAgKlxuICAgKiBAZGVmYXVsdCAnbWNyLm1pY3Jvc29mdC5jb20vd2luZG93cy9zZXJ2ZXJjb3JlOmx0c2MyMDE5LWFtZDY0J1xuICAgKi9cbiAgcmVhZG9ubHkgcGFyZW50SW1hZ2U/OiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFZlcnNpb24gb2YgR2l0SHViIFJ1bm5lcnMgdG8gaW5zdGFsbC5cbiAgICpcbiAgICogQGRlZmF1bHQgbGF0ZXN0IHZlcnNpb24gYXZhaWxhYmxlXG4gICAqL1xuICByZWFkb25seSBydW5uZXJWZXJzaW9uPzogUnVubmVyVmVyc2lvbjtcblxuICAvKipcbiAgICogU2NoZWR1bGUgdGhlIGltYWdlIHRvIGJlIHJlYnVpbHQgZXZlcnkgZ2l2ZW4gaW50ZXJ2YWwuIFVzZWZ1bCBmb3Iga2VlcGluZyB0aGUgaW1hZ2UgdXAtZG8tZGF0ZSB3aXRoIHRoZSBsYXRlc3QgR2l0SHViIHJ1bm5lciB2ZXJzaW9uIGFuZCBsYXRlc3QgT1MgdXBkYXRlcy5cbiAgICpcbiAgICogU2V0IHRvIHplcm8gdG8gZGlzYWJsZS5cbiAgICpcbiAgICogQGRlZmF1bHQgRHVyYXRpb24uZGF5cyg3KVxuICAgKi9cbiAgcmVhZG9ubHkgcmVidWlsZEludGVydmFsPzogRHVyYXRpb247XG5cbiAgLyoqXG4gICAqIFZQQyB0byBsYXVuY2ggdGhlIHJ1bm5lcnMgaW4uXG4gICAqXG4gICAqIEBkZWZhdWx0IGRlZmF1bHQgYWNjb3VudCBWUENcbiAgICovXG4gIHJlYWRvbmx5IHZwYz86IGVjMi5JVnBjO1xuXG4gIC8qKlxuICAgKiBTZWN1cml0eSBncm91cCB0byBhc3NpZ24gdG8gbGF1bmNoZWQgYnVpbGRlciBpbnN0YW5jZXMuXG4gICAqXG4gICAqIEBkZWZhdWx0IG5ldyBzZWN1cml0eSBncm91cFxuICAgKlxuICAgKiBAZGVwcmVjYXRlZCB1c2Uge0BsaW5rIHNlY3VyaXR5R3JvdXBzfVxuICAgKi9cbiAgcmVhZG9ubHkgc2VjdXJpdHlHcm91cD86IGVjMi5JU2VjdXJpdHlHcm91cDtcblxuICAvKipcbiAgICogU2VjdXJpdHkgZ3JvdXBzIHRvIGFzc2lnbiB0byBsYXVuY2hlZCBidWlsZGVyIGluc3RhbmNlcy5cbiAgICpcbiAgICogQGRlZmF1bHQgbmV3IHNlY3VyaXR5IGdyb3VwXG4gICAqL1xuICByZWFkb25seSBzZWN1cml0eUdyb3Vwcz86IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuXG4gIC8qKlxuICAgKiBXaGVyZSB0byBwbGFjZSB0aGUgbmV0d29yayBpbnRlcmZhY2VzIHdpdGhpbiB0aGUgVlBDLlxuICAgKlxuICAgKiBAZGVmYXVsdCBkZWZhdWx0IFZQQyBzdWJuZXRcbiAgICovXG4gIHJlYWRvbmx5IHN1Ym5ldFNlbGVjdGlvbj86IGVjMi5TdWJuZXRTZWxlY3Rpb247XG5cbiAgLyoqXG4gICAqIFRoZSBpbnN0YW5jZSB0eXBlIHVzZWQgdG8gYnVpbGQgdGhlIGltYWdlLlxuICAgKlxuICAgKiBAZGVmYXVsdCBtNmkubGFyZ2VcbiAgICovXG4gIHJlYWRvbmx5IGluc3RhbmNlVHlwZT86IGVjMi5JbnN0YW5jZVR5cGU7XG5cbiAgLyoqXG4gICAqIFRoZSBudW1iZXIgb2YgZGF5cyBsb2cgZXZlbnRzIGFyZSBrZXB0IGluIENsb3VkV2F0Y2ggTG9ncy4gV2hlbiB1cGRhdGluZ1xuICAgKiB0aGlzIHByb3BlcnR5LCB1bnNldHRpbmcgaXQgZG9lc24ndCByZW1vdmUgdGhlIGxvZyByZXRlbnRpb24gcG9saWN5LiBUb1xuICAgKiByZW1vdmUgdGhlIHJldGVudGlvbiBwb2xpY3ksIHNldCB0aGUgdmFsdWUgdG8gYElORklOSVRFYC5cbiAgICpcbiAgICogQGRlZmF1bHQgbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USFxuICAgKi9cbiAgcmVhZG9ubHkgbG9nUmV0ZW50aW9uPzogbG9ncy5SZXRlbnRpb25EYXlzO1xuXG4gIC8qKlxuICAgKiBSZW1vdmFsIHBvbGljeSBmb3IgbG9ncyBvZiBpbWFnZSBidWlsZHMuIElmIGRlcGxveW1lbnQgZmFpbHMgb24gdGhlIGN1c3RvbSByZXNvdXJjZSwgdHJ5IHNldHRpbmcgdGhpcyB0byBgUmVtb3ZhbFBvbGljeS5SRVRBSU5gLiBUaGlzIHdheSB0aGUgQ29kZUJ1aWxkIGxvZ3MgY2FuIHN0aWxsIGJlIHZpZXdlZCwgYW5kIHlvdSBjYW4gc2VlIHdoeSB0aGUgYnVpbGQgZmFpbGVkLlxuICAgKlxuICAgKiBXZSB0cnkgdG8gbm90IGxlYXZlIGFueXRoaW5nIGJlaGluZCB3aGVuIHJlbW92ZWQuIEJ1dCBzb21ldGltZXMgYSBsb2cgc3RheWluZyBiZWhpbmQgaXMgdXNlZnVsLlxuICAgKlxuICAgKiBAZGVmYXVsdCBSZW1vdmFsUG9saWN5LkRFU1RST1lcbiAgICovXG4gIHJlYWRvbmx5IGxvZ1JlbW92YWxQb2xpY3k/OiBSZW1vdmFsUG9saWN5O1xufVxuXG4vKipcbiAqIEFuIGltYWdlIGJ1aWxkZXIgdGhhdCB1c2VzIEFXUyBJbWFnZSBCdWlsZGVyIHRvIGJ1aWxkIERvY2tlciBpbWFnZXMgcHJlLWJha2VkIHdpdGggYWxsIHRoZSBHaXRIdWIgQWN0aW9ucyBydW5uZXIgcmVxdWlyZW1lbnRzLiBCdWlsZGVycyBjYW4gYmUgdXNlZCB3aXRoIHJ1bm5lciBwcm92aWRlcnMuXG4gKlxuICogVGhlIENvZGVCdWlsZCBidWlsZGVyIGlzIGJldHRlciBhbmQgZmFzdGVyLiBPbmx5IHVzZSB0aGlzIG9uZSBpZiB5b3UgaGF2ZSBubyBjaG9pY2UuIEZvciBleGFtcGxlLCBpZiB5b3UgbmVlZCBXaW5kb3dzIGNvbnRhaW5lcnMuXG4gKlxuICogRWFjaCBidWlsZGVyIHJlLXJ1bnMgYXV0b21hdGljYWxseSBhdCBhIHNldCBpbnRlcnZhbCB0byBtYWtlIHN1cmUgdGhlIGltYWdlcyBjb250YWluIHRoZSBsYXRlc3QgdmVyc2lvbnMgb2YgZXZlcnl0aGluZy5cbiAqXG4gKiBZb3UgY2FuIGNyZWF0ZSBhbiBpbnN0YW5jZSBvZiB0aGlzIGNvbnN0cnVjdCB0byBjdXN0b21pemUgdGhlIGltYWdlIHVzZWQgdG8gc3Bpbi11cCBydW5uZXJzLiBTb21lIHJ1bm5lciBwcm92aWRlcnMgbWF5IHJlcXVpcmUgY3VzdG9tIGNvbXBvbmVudHMuIENoZWNrIHRoZSBydW5uZXIgcHJvdmlkZXIgZG9jdW1lbnRhdGlvbi4gVGhlIGRlZmF1bHQgY29tcG9uZW50cyB3b3JrIHdpdGggQ29kZUJ1aWxkIGFuZCBGYXJnYXRlLlxuICpcbiAqIEZvciBleGFtcGxlLCB0byBzZXQgYSBzcGVjaWZpYyBydW5uZXIgdmVyc2lvbiwgcmVidWlsZCB0aGUgaW1hZ2UgZXZlcnkgMiB3ZWVrcywgYW5kIGFkZCBhIGZldyBwYWNrYWdlcyBmb3IgdGhlIEZhcmdhdGUgcHJvdmlkZXIsIHVzZTpcbiAqXG4gKiBgYGBcbiAqIGNvbnN0IGJ1aWxkZXIgPSBuZXcgQ29udGFpbmVySW1hZ2VCdWlsZGVyKHRoaXMsICdCdWlsZGVyJywge1xuICogICAgIHJ1bm5lclZlcnNpb246IFJ1bm5lclZlcnNpb24uc3BlY2lmaWMoJzIuMjkzLjAnKSxcbiAqICAgICByZWJ1aWxkSW50ZXJ2YWw6IER1cmF0aW9uLmRheXMoMTQpLFxuICogfSk7XG4gKiBuZXcgQ29kZUJ1aWxkUnVubmVyUHJvdmlkZXIodGhpcywgJ0NvZGVCdWlsZCBwcm92aWRlcicsIHtcbiAqICAgICBsYWJlbHM6IFsnY3VzdG9tLWNvZGVidWlsZCddLFxuICogICAgIGltYWdlQnVpbGRlcjogYnVpbGRlcixcbiAqIH0pO1xuICogYGBgXG4gKlxuICogQGRlcHJlY2F0ZWQgdXNlIFJ1bm5lckltYWdlQnVpbGRlclxuICovXG5leHBvcnQgY2xhc3MgQ29udGFpbmVySW1hZ2VCdWlsZGVyIGV4dGVuZHMgSW1hZ2VCdWlsZGVyQmFzZSB7XG4gIHJlYWRvbmx5IHJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcbiAgcHJpdmF0ZSByZWFkb25seSBwYXJlbnRJbWFnZTogc3RyaW5nO1xuICBwcml2YXRlIGJvdW5kSW1hZ2U/OiBSdW5uZXJJbWFnZTtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IENvbnRhaW5lckltYWdlQnVpbGRlclByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCB7XG4gICAgICBvczogcHJvcHM/Lm9zLFxuICAgICAgc3VwcG9ydGVkT3M6IFtPcy5XSU5ET1dTXSxcbiAgICAgIGFyY2hpdGVjdHVyZTogcHJvcHM/LmFyY2hpdGVjdHVyZSxcbiAgICAgIHN1cHBvcnRlZEFyY2hpdGVjdHVyZXM6IFtBcmNoaXRlY3R1cmUuWDg2XzY0XSxcbiAgICAgIGluc3RhbmNlVHlwZTogcHJvcHM/Lmluc3RhbmNlVHlwZSxcbiAgICAgIHZwYzogcHJvcHM/LnZwYyxcbiAgICAgIHNlY3VyaXR5R3JvdXBzOiBwcm9wcz8uc2VjdXJpdHlHcm91cCA/IFtwcm9wcy5zZWN1cml0eUdyb3VwXSA6IHByb3BzPy5zZWN1cml0eUdyb3VwcyxcbiAgICAgIHN1Ym5ldFNlbGVjdGlvbjogcHJvcHM/LnN1Ym5ldFNlbGVjdGlvbixcbiAgICAgIGxvZ1JlbW92YWxQb2xpY3k6IHByb3BzPy5sb2dSZW1vdmFsUG9saWN5LFxuICAgICAgbG9nUmV0ZW50aW9uOiBwcm9wcz8ubG9nUmV0ZW50aW9uLFxuICAgICAgcnVubmVyVmVyc2lvbjogcHJvcHM/LnJ1bm5lclZlcnNpb24sXG4gICAgICByZWJ1aWxkSW50ZXJ2YWw6IHByb3BzPy5yZWJ1aWxkSW50ZXJ2YWwsXG4gICAgICBpbWFnZVR5cGVOYW1lOiAnaW1hZ2UnLFxuICAgIH0pO1xuXG4gICAgdGhpcy5wYXJlbnRJbWFnZSA9IHByb3BzPy5wYXJlbnRJbWFnZSA/PyAnbWNyLm1pY3Jvc29mdC5jb20vd2luZG93cy9zZXJ2ZXJjb3JlOmx0c2MyMDE5LWFtZDY0JztcblxuICAgIC8vIGNyZWF0ZSByZXBvc2l0b3J5IHRoYXQgb25seSBrZWVwcyBvbmUgdGFnXG4gICAgdGhpcy5yZXBvc2l0b3J5ID0gbmV3IGVjci5SZXBvc2l0b3J5KHRoaXMsICdSZXBvc2l0b3J5Jywge1xuICAgICAgaW1hZ2VTY2FuT25QdXNoOiB0cnVlLFxuICAgICAgaW1hZ2VUYWdNdXRhYmlsaXR5OiBUYWdNdXRhYmlsaXR5Lk1VVEFCTEUsXG4gICAgICByZW1vdmFsUG9saWN5OiBSZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBlbXB0eU9uRGVsZXRlOiB0cnVlLFxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGRlc2NyaXB0aW9uOiAnUmVtb3ZlIGFsbCBidXQgdGhlIGxhdGVzdCBpbWFnZScsXG4gICAgICAgICAgdGFnU3RhdHVzOiBUYWdTdGF0dXMuQU5ZLFxuICAgICAgICAgIG1heEltYWdlQ291bnQ6IDEsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gYWRkIGFsbCBiYXNpYyBjb21wb25lbnRzXG4gICAgdGhpcy5hZGRCYXNlV2luZG93c0NvbXBvbmVudHMoKTtcbiAgfVxuXG4gIHByaXZhdGUgYWRkQmFzZVdpbmRvd3NDb21wb25lbnRzKCkge1xuICAgIHRoaXMuYWRkQ29tcG9uZW50KFdpbmRvd3NDb21wb25lbnRzLmF3c0NsaSh0aGlzLCAnQVdTIENMSScpKTtcbiAgICB0aGlzLmFkZENvbXBvbmVudChXaW5kb3dzQ29tcG9uZW50cy5naXRodWJDbGkodGhpcywgJ0dpdEh1YiBDTEknKSk7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuZ2l0KHRoaXMsICdnaXQnKSk7XG4gICAgdGhpcy5hZGRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuZ2l0aHViUnVubmVyKHRoaXMsICdHaXRIdWIgQWN0aW9ucyBSdW5uZXInLCB0aGlzLnJ1bm5lclZlcnNpb24pKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYSBjb21wb25lbnQgdG8gYmUgaW5zdGFsbGVkIGJlZm9yZSBhbnkgb3RoZXIgY29tcG9uZW50cy4gVXNlZnVsIGZvciByZXF1aXJlZCBzeXN0ZW0gc2V0dGluZ3MgbGlrZSBjZXJ0aWZpY2F0ZXMgb3IgcHJveHkgc2V0dGluZ3MuXG4gICAqIEBwYXJhbSBjb21wb25lbnRcbiAgICovXG4gIHByZXBlbmRDb21wb25lbnQoY29tcG9uZW50OiBJbWFnZUJ1aWxkZXJDb21wb25lbnQpIHtcbiAgICBpZiAodGhpcy5ib3VuZEltYWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ltYWdlIGlzIGFscmVhZHkgYm91bmQuIFVzZSB0aGlzIG1ldGhvZCBiZWZvcmUgcGFzc2luZyB0aGUgYnVpbGRlciB0byBhIHJ1bm5lciBwcm92aWRlci4nKTtcbiAgICB9XG4gICAgaWYgKGNvbXBvbmVudC5wbGF0Zm9ybSAhPSB0aGlzLnBsYXRmb3JtKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbXBvbmVudCBwbGF0Zm9ybSBkb2VzblxcJ3QgbWF0Y2ggYnVpbGRlciBwbGF0Zm9ybScpO1xuICAgIH1cbiAgICB0aGlzLmNvbXBvbmVudHMgPSBbY29tcG9uZW50XS5jb25jYXQodGhpcy5jb21wb25lbnRzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYSBjb21wb25lbnQgdG8gYmUgaW5zdGFsbGVkLlxuICAgKiBAcGFyYW0gY29tcG9uZW50XG4gICAqL1xuICBhZGRDb21wb25lbnQoY29tcG9uZW50OiBJbWFnZUJ1aWxkZXJDb21wb25lbnQpIHtcbiAgICBpZiAodGhpcy5ib3VuZEltYWdlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ltYWdlIGlzIGFscmVhZHkgYm91bmQuIFVzZSB0aGlzIG1ldGhvZCBiZWZvcmUgcGFzc2luZyB0aGUgYnVpbGRlciB0byBhIHJ1bm5lciBwcm92aWRlci4nKTtcbiAgICB9XG4gICAgaWYgKGNvbXBvbmVudC5wbGF0Zm9ybSAhPSB0aGlzLnBsYXRmb3JtKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbXBvbmVudCBwbGF0Zm9ybSBkb2VzblxcJ3QgbWF0Y2ggYnVpbGRlciBwbGF0Zm9ybScpO1xuICAgIH1cbiAgICB0aGlzLmNvbXBvbmVudHMucHVzaChjb21wb25lbnQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBleHRyYSB0cnVzdGVkIGNlcnRpZmljYXRlcy4gVGhpcyBoZWxwcyBkZWFsIHdpdGggc2VsZi1zaWduZWQgY2VydGlmaWNhdGVzIGZvciBHaXRIdWIgRW50ZXJwcmlzZSBTZXJ2ZXIuXG4gICAqXG4gICAqIEFsbCBmaXJzdCBwYXJ0eSBEb2NrZXJmaWxlcyBzdXBwb3J0IHRoaXMuIE90aGVycyBtYXkgbm90LlxuICAgKlxuICAgKiBAcGFyYW0gcGF0aCBwYXRoIHRvIGRpcmVjdG9yeSBjb250YWluaW5nIGEgZmlsZSBjYWxsZWQgY2VydHMucGVtIGNvbnRhaW5pbmcgYWxsIHRoZSByZXF1aXJlZCBjZXJ0aWZpY2F0ZXNcbiAgICovXG4gIHB1YmxpYyBhZGRFeHRyYUNlcnRpZmljYXRlcyhwYXRoOiBzdHJpbmcpIHtcbiAgICBpZiAodGhpcy5wbGF0Zm9ybSA9PSAnTGludXgnKSB7XG4gICAgICB0aGlzLnByZXBlbmRDb21wb25lbnQoTGludXhVYnVudHVDb21wb25lbnRzLmV4dHJhQ2VydGlmaWNhdGVzKHRoaXMsICdFeHRyYSBDZXJ0cycsIHBhdGgpKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMucGxhdGZvcm0gPT0gJ1dpbmRvd3MnKSB7XG4gICAgICB0aGlzLnByZXBlbmRDb21wb25lbnQoV2luZG93c0NvbXBvbmVudHMuZXh0cmFDZXJ0aWZpY2F0ZXModGhpcywgJ0V4dHJhIENlcnRzJywgcGF0aCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gcGxhdGZvcm06ICR7dGhpcy5wbGF0Zm9ybX1gKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2FsbGVkIGJ5IElSdW5uZXJQcm92aWRlciB0byBmaW5hbGl6ZSBzZXR0aW5ncyBhbmQgY3JlYXRlIHRoZSBpbWFnZSBidWlsZGVyLlxuICAgKi9cbiAgYmluZERvY2tlckltYWdlKCk6IFJ1bm5lckltYWdlIHtcbiAgICBpZiAodGhpcy5ib3VuZEltYWdlKSB7XG4gICAgICByZXR1cm4gdGhpcy5ib3VuZEltYWdlO1xuICAgIH1cblxuICAgIGNvbnN0IGRpc3QgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24odGhpcywgJ0Rpc3RyaWJ1dGlvbicsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcbiAgICAgIGRpc3RyaWJ1dGlvbnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIHJlZ2lvbjogU3RhY2sub2YodGhpcykucmVnaW9uLFxuICAgICAgICAgIGNvbnRhaW5lckRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgICAgIENvbnRhaW5lclRhZ3M6IFsnbGF0ZXN0J10sXG4gICAgICAgICAgICBUYXJnZXRSZXBvc2l0b3J5OiB7XG4gICAgICAgICAgICAgIFNlcnZpY2U6ICdFQ1InLFxuICAgICAgICAgICAgICBSZXBvc2l0b3J5TmFtZTogdGhpcy5yZXBvc2l0b3J5LnJlcG9zaXRvcnlOYW1lLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlY2lwZSA9IG5ldyBDb250YWluZXJSZWNpcGUodGhpcywgJ0NvbnRhaW5lciBSZWNpcGUnLCB7XG4gICAgICBwbGF0Zm9ybTogdGhpcy5wbGF0Zm9ybSxcbiAgICAgIGNvbXBvbmVudHM6IHRoaXMuY29tcG9uZW50cyxcbiAgICAgIHRhcmdldFJlcG9zaXRvcnk6IHRoaXMucmVwb3NpdG9yeSxcbiAgICAgIGRvY2tlcmZpbGVUZW1wbGF0ZTogZG9ja2VyZmlsZVRlbXBsYXRlLnJlcGxhY2UoJ19fX1JVTk5FUl9WRVJTSU9OX19fJywgdGhpcy5ydW5uZXJWZXJzaW9uLnZlcnNpb24pLFxuICAgICAgcGFyZW50SW1hZ2U6IHRoaXMucGFyZW50SW1hZ2UsXG4gICAgICB0YWdzOiB7fSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGxvZyA9IHRoaXMuY3JlYXRlTG9nKHJlY2lwZS5uYW1lKTtcbiAgICBjb25zdCBpbmZyYSA9IHRoaXMuY3JlYXRlSW5mcmFzdHJ1Y3R1cmUoW1xuICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlJyksXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ0VDMkluc3RhbmNlUHJvZmlsZUZvckltYWdlQnVpbGRlckVDUkNvbnRhaW5lckJ1aWxkcycpLFxuICAgIF0pO1xuICAgIHRoaXMuY3JlYXRlSW1hZ2UoaW5mcmEsIGRpc3QsIGxvZywgdW5kZWZpbmVkLCByZWNpcGUuYXJuKTtcbiAgICB0aGlzLmNyZWF0ZVBpcGVsaW5lKGluZnJhLCBkaXN0LCBsb2csIHVuZGVmaW5lZCwgcmVjaXBlLmFybik7XG5cbiAgICB0aGlzLmltYWdlQ2xlYW5lcigpO1xuXG4gICAgdGhpcy5ib3VuZEltYWdlID0ge1xuICAgICAgaW1hZ2VSZXBvc2l0b3J5OiB0aGlzLnJlcG9zaXRvcnksXG4gICAgICBpbWFnZVRhZzogJ2xhdGVzdCcsXG4gICAgICBvczogdGhpcy5vcyxcbiAgICAgIGFyY2hpdGVjdHVyZTogdGhpcy5hcmNoaXRlY3R1cmUsXG4gICAgICBsb2dHcm91cDogbG9nLFxuICAgICAgcnVubmVyVmVyc2lvbjogdGhpcy5ydW5uZXJWZXJzaW9uLFxuICAgICAgLy8gbm8gZGVwZW5kYWJsZSBhcyBDbG91ZEZvcm1hdGlvbiB3aWxsIGZhaWwgdG8gZ2V0IGltYWdlIEFSTiBvbmNlIHRoZSBpbWFnZSBpcyBkZWxldGVkICh3ZSBkZWxldGUgb2xkIGltYWdlcyBkYWlseSlcbiAgICB9O1xuXG4gICAgcmV0dXJuIHRoaXMuYm91bmRJbWFnZTtcbiAgfVxuXG4gIHByaXZhdGUgaW1hZ2VDbGVhbmVyKCkge1xuICAgIC8vIGNsZWFuaW5nIHVwIGluIHRoZSBpbWFnZSBidWlsZGVyIHdhcyBhbHdheXMgdWdseS4uLiB0aW1lIHRvIGdldCByaWQgb2YgaXRcbiAgICBjZGsuQW5ub3RhdGlvbnMub2YodGhpcykuYWRkV2FybmluZygnVGhlIGltYWdlIGNsZWFuZXIgZm9yIHRoaXMgZGVwcmVjYXRlZCBjbGFzcyBoYXMgYmVlbiBkaXNhYmxlZC4gU29tZSBFQzIgSW1hZ2UgQnVpbGRlciByZXNvdXJjZXMgbWF5IGJlIGxlZnQgYmVoaW5kIG9uY2UgeW91IHJlbW92ZSB0aGlzIGNvbnN0cnVjdC4gWW91IGNhbiBtYW51YWxseSBkZWxldGUgdGhlbSBmcm9tIHRoZSBBV1MgTWFuYWdlbWVudCBDb25zb2xlLicpO1xuXG4gICAgLy8gd2Uga2VlcCB0aGUgbGFtYmRhIGl0c2VsZiBhcm91bmQsIGluIGNhc2UgdGhlIHVzZXIgZG9lc24ndCBoYXZlIGFueSBvdGhlciBpbnN0YW5jZXMgb2YgaXRcbiAgICAvLyBpZiB0aGVyZSBhcmUgbm8gb3RoZXIgaW5zdGFuY2VzIG9mIGl0LCB0aGUgY3VzdG9tIHJlc291cmNlIHdpbGwgYmUgZGVsZXRlZCB3aXRoIHRoZSBvcmlnaW5hbCBsYW1iZGEgc291cmNlIGNvZGUgd2hpY2ggbWF5IGRlbGV0ZSB0aGUgaW1hZ2VzIG9uIGl0cyB3YXkgb3V0XG4gICAgc2luZ2xldG9uTGFtYmRhKEJ1aWxkSW1hZ2VGdW5jdGlvbiwgdGhpcywgJ2J1aWxkLWltYWdlJywge1xuICAgICAgZGVzY3JpcHRpb246ICdDdXN0b20gcmVzb3VyY2UgaGFuZGxlciB0aGF0IHRyaWdnZXJzIENvZGVCdWlsZCB0byBidWlsZCBydW5uZXIgaW1hZ2VzJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDMpLFxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgIH0pO1xuICB9XG5cbiAgYmluZEFtaSgpOiBSdW5uZXJBbWkge1xuICAgIHRocm93IG5ldyBFcnJvcignQ29udGFpbmVySW1hZ2VCdWlsZGVyIGNhbm5vdCBiZSB1c2VkIHRvIGJ1aWxkIEFNSXMnKTtcbiAgfVxufVxuIl19