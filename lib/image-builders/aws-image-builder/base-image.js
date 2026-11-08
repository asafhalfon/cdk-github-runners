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
exports.BaseContainerImage = exports.BaseImage = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = __importStar(require("aws-cdk-lib"));
const providers_1 = require("../../providers");
/**
 * Represents a base image that is used to start from in EC2 Image Builder image builds.
 *
 * This class is adapted from AWS CDK's BaseImage class to support both string and object inputs.
 */
class BaseImage {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.BaseImage", version: "0.0.0" };
    /**
     * The AMI ID to use as a base image in an image recipe
     *
     * @param amiId The AMI ID to use as the base image
     */
    static fromAmiId(amiId) {
        return new BaseImage(amiId);
    }
    /**
     * An AWS-provided EC2 Image Builder image to use as a base image in an image recipe.
     *
     * This constructs an Image Builder ARN for AWS-provided images like `ubuntu-server-22-lts-x86/x.x.x`.
     *
     * @param scope The construct scope (used to determine the stack and region)
     * @param resourceName The Image Builder resource name pattern (e.g., `ubuntu-server-22-lts-x86` or `ubuntu-server-22-lts-${arch}`)
     * @param version The version pattern (defaults to `x.x.x` to use the latest version)
     */
    static fromImageBuilder(scope, resourceName, version = 'x.x.x') {
        const stack = cdk.Stack.of(scope);
        return new BaseImage(stack.formatArn({
            service: 'imagebuilder',
            resource: 'image',
            account: 'aws',
            resourceName: `${resourceName}/${version}`,
        }));
    }
    /**
     * The marketplace product ID for an AMI product to use as the base image in an image recipe
     *
     * @param productId The Marketplace AMI product ID to use as the base image
     */
    static fromMarketplaceProductId(productId) {
        return new BaseImage(productId);
    }
    /**
     * The SSM parameter to use as the base image in an image recipe
     *
     * @param parameter The SSM parameter to use as the base image
     */
    static fromSsmParameter(parameter) {
        return new BaseImage(`ssm:${parameter.parameterArn}`);
    }
    /**
     * The parameter name for the SSM parameter to use as the base image in an image recipe
     *
     * @param parameterName The name of the SSM parameter to use as the base image
     */
    static fromSsmParameterName(parameterName) {
        return new BaseImage(`ssm:${parameterName}`);
    }
    /**
     * The direct string value of the base image to use in an image recipe. This can be an EC2 Image Builder image ARN,
     * an SSM parameter, an AWS Marketplace product ID, or an AMI ID.
     *
     * @param baseImageString The base image as a direct string value
     */
    static fromString(baseImageString) {
        return new BaseImage(baseImageString);
    }
    /**
     * A base AMI with NVIDIA drivers pre-installed for GPU workloads.
     *
     * Uses AWS Deep Learning AMIs for Linux (Ubuntu, Amazon Linux 2, Amazon Linux 2023).
     * For Windows, subscribe to NVIDIA RTX Virtual Workstation in AWS Marketplace, then use
     * {@link fromMarketplaceProductId} with the product ID.
     *
     * @param os Target operating system
     * @param architecture Target architecture
     * @throws Error if the OS/architecture combo has no GPU base AMI
     */
    static fromGpuBase(os, architecture) {
        const arch = architecture.is(providers_1.Architecture.X86_64) ? 'x86_64' : 'arm64';
        if (os.is(providers_1.Os.LINUX_UBUNTU) || os.is(providers_1.Os.LINUX_UBUNTU_2204) || os.is(providers_1.Os.LINUX)) {
            return BaseImage.fromSsmParameterName(`/aws/service/deeplearning/ami/${arch}/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id`);
        }
        if (os.is(providers_1.Os.LINUX_UBUNTU_2404)) {
            return BaseImage.fromSsmParameterName(`/aws/service/deeplearning/ami/${arch}/base-oss-nvidia-driver-gpu-ubuntu-24.04/latest/ami-id`);
        }
        if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
            return BaseImage.fromSsmParameterName(`/aws/service/deeplearning/ami/${arch}/base-oss-nvidia-driver-amazon-linux-2/latest/ami-id`);
        }
        if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
            return BaseImage.fromSsmParameterName(`/aws/service/deeplearning/ami/${arch}/base-oss-nvidia-driver-gpu-amazon-linux-2023/latest/ami-id`);
        }
        if (os.is(providers_1.Os.WINDOWS) && architecture.is(providers_1.Architecture.X86_64)) {
            throw new Error('No GPU base AMI for Windows. Subscribe to NVIDIA RTX Virtual Workstation (WinServer 2022) at ' +
                'https://aws.amazon.com/marketplace/pp/prodview-f4reygwmtxipu (free), then use ' +
                "`baseAmi: BaseImage.fromMarketplaceProductId('prod-77u2eeb33lmrm')` (other AMIs with NVIDIA drivers installed can also be used).");
        }
        throw new Error(`No GPU base AMI for ${os.name} / ${architecture.name}.`);
    }
    /**
     * The rendered base image to use
     */
    image;
    constructor(image) {
        this.image = image;
    }
}
exports.BaseImage = BaseImage;
/**
 * Represents a base container image that is used to start from in EC2 Image Builder container builds.
 *
 * This class is adapted from AWS CDK's BaseContainerImage class to support both string and object inputs.
 */
class BaseContainerImage {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.BaseContainerImage", version: "0.0.0" };
    /**
     * The DockerHub image to use as the base image in a container recipe
     *
     * @param repository The DockerHub repository where the base image resides in
     * @param tag The tag of the base image in the DockerHub repository
     */
    static fromDockerHub(repository, tag) {
        return new BaseContainerImage(`${repository}:${tag}`);
    }
    /**
     * The ECR container image to use as the base image in a container recipe
     *
     * @param repository The ECR repository where the base image resides in
     * @param tag The tag of the base image in the ECR repository
     */
    static fromEcr(repository, tag) {
        return new BaseContainerImage(repository.repositoryUriForTag(tag), repository);
    }
    /**
     * The ECR public container image to use as the base image in a container recipe
     *
     * @param registryAlias The alias of the ECR public registry where the base image resides in
     * @param repositoryName The name of the ECR public repository, where the base image resides in
     * @param tag The tag of the base image in the ECR public repository
     */
    static fromEcrPublic(registryAlias, repositoryName, tag) {
        return new BaseContainerImage(`public.ecr.aws/${registryAlias}/${repositoryName}:${tag}`);
    }
    /**
     * The string value of the base image to use in a container recipe. This can be an EC2 Image Builder image ARN,
     * an ECR or ECR public image, or a container URI sourced from a third-party container registry such as DockerHub.
     *
     * @param baseContainerImageString The base image as a direct string value
     */
    static fromString(baseContainerImageString) {
        return new BaseContainerImage(baseContainerImageString);
    }
    /**
     * The rendered base image to use
     */
    image;
    /**
     * The ECR repository if this image was created from an ECR repository.
     * This allows automatic permission granting for CodeBuild.
     */
    ecrRepository;
    constructor(image, ecrRepository) {
        this.image = image;
        this.ecrRepository = ecrRepository;
    }
}
exports.BaseContainerImage = BaseContainerImage;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1pbWFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9hd3MtaW1hZ2UtYnVpbGRlci9iYXNlLWltYWdlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFJbkMsK0NBQW1EO0FBV25EOzs7O0dBSUc7QUFDSCxNQUFhLFNBQVM7O0lBQ3BCOzs7O09BSUc7SUFDSSxNQUFNLENBQUMsU0FBUyxDQUFDLEtBQWE7UUFDbkMsT0FBTyxJQUFJLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM5QixDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsS0FBZ0IsRUFBRSxZQUFvQixFQUFFLFVBQWtCLE9BQU87UUFDOUYsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDbEMsT0FBTyxJQUFJLFNBQVMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQ25DLE9BQU8sRUFBRSxjQUFjO1lBQ3ZCLFFBQVEsRUFBRSxPQUFPO1lBQ2pCLE9BQU8sRUFBRSxLQUFLO1lBQ2QsWUFBWSxFQUFFLEdBQUcsWUFBWSxJQUFJLE9BQU8sRUFBRTtTQUMzQyxDQUFDLENBQUMsQ0FBQztJQUNOLENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksTUFBTSxDQUFDLHdCQUF3QixDQUFDLFNBQWlCO1FBQ3RELE9BQU8sSUFBSSxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsU0FBeUI7UUFDdEQsT0FBTyxJQUFJLFNBQVMsQ0FBQyxPQUFPLFNBQVMsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFDO0lBQ3hELENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksTUFBTSxD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LENBQUMsQ0FBQztJQUM1RixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSSxNQUFNLENBQUMsVUFBVSxDQUFDLHdCQUFnQztRQUN2RCxPQUFPLElBQUksa0JBQWtCLENBQUMsd0JBQXdCLENBQUMsQ0FBQztJQUMxRCxDQUFDO0lBRUQ7O09BRUc7SUFDYSxLQUFLLENBQVM7SUFFOUI7OztPQUdHO0lBQ2EsYUFBYSxDQUFtQjtJQUVoRCxZQUFzQixLQUFhLEVBQUUsYUFBK0I7UUFDbEUsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUM7SUFDckMsQ0FBQzs7QUF4REgsZ0RBeURDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGVjciBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZWNyJztcbmltcG9ydCAqIGFzIHNzbSBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc3NtJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBPcyB9IGZyb20gJy4uLy4uL3Byb3ZpZGVycyc7XG5cbi8qKlxuICogVHlwZSB0aGF0IGNhbiBiZSB1c2VkIHRvIHNwZWNpZnkgYSBiYXNlIGltYWdlIC0gZWl0aGVyIGEgc3RyaW5nIChkZXByZWNhdGVkKSBvciBhIEJhc2VJbWFnZSBvYmplY3QuXG4gKlxuICogVG8gY3JlYXRlIGEgQmFzZUltYWdlIG9iamVjdCwgdXNlIHRoZSBzdGF0aWMgZmFjdG9yeSBtZXRob2RzIGxpa2UgQmFzZUltYWdlLmZyb21BbWlJZCgpLlxuICpcbiAqIE5vdGU6IFN0cmluZyBzdXBwb3J0IGlzIGRlcHJlY2F0ZWQgYW5kIHdpbGwgYmUgcmVtb3ZlZCBpbiBhIGZ1dHVyZSB2ZXJzaW9uLiBVc2UgQmFzZUltYWdlIHN0YXRpYyBmYWN0b3J5IG1ldGhvZHMgaW5zdGVhZC5cbiAqL1xuZXhwb3J0IHR5cGUgQmFzZUltYWdlSW5wdXQgPSBzdHJpbmcgfCBCYXNlSW1hZ2U7XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIGJhc2UgaW1hZ2UgdGhhdCBpcyB1c2VkIHRvIHN0YXJ0IGZyb20gaW4gRUMyIEltYWdlIEJ1aWxkZXIgaW1hZ2UgYnVpbGRzLlxuICpcbiAqIFRoaXMgY2xhc3MgaXMgYWRhcHRlZCBmcm9tIEFXUyBDREsncyBCYXNlSW1hZ2UgY2xhc3MgdG8gc3VwcG9ydCBib3RoIHN0cmluZyBhbmQgb2JqZWN0IGlucHV0cy5cbiAqL1xuZXhwb3J0IGNsYXNzIEJhc2VJbWFnZSB7XG4gIC8qKlxuICAgKiBUaGUgQU1JIElEIHRvIHVzZSBhcyBhIGJhc2UgaW1hZ2UgaW4gYW4gaW1hZ2UgcmVjaXBlXG4gICAqXG4gICAqIEBwYXJhbSBhbWlJZCBUaGUgQU1JIElEIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tQW1pSWQoYW1pSWQ6IHN0cmluZyk6IEJhc2VJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlSW1hZ2UoYW1pSWQpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFuIEFXUy1wcm92aWRlZCBFQzIgSW1hZ2UgQnVpbGRlciBpbWFnZSB0byB1c2UgYXMgYSBiYXNlIGltYWdlIGluIGFuIGltYWdlIHJlY2lwZS5cbiAgICpcbiAgICogVGhpcyBjb25zdHJ1Y3RzIGFuIEltYWdlIEJ1aWxkZXIgQVJOIGZvciBBV1MtcHJvdmlkZWQgaW1hZ2VzIGxpa2UgYHVidW50dS1zZXJ2ZXItMjItbHRzLXg4Ni94LngueGAuXG4gICAqXG4gICAqIEBwYXJhbSBzY29wZSBUaGUgY29uc3RydWN0IHNjb3BlICh1c2VkIHRvIGRldGVybWluZSB0aGUgc3RhY2sgYW5kIHJlZ2lvbilcbiAgICogQHBhcmFtIHJlc291cmNlTmFtZSBUaGUgSW1hZ2UgQnVpbGRlciByZXNvdXJjZSBuYW1lIHBhdHRlcm4gKGUuZy4sIGB1YnVudHUtc2VydmVyLTIyLWx0cy14ODZgIG9yIGB1YnVudHUtc2VydmVyLTIyLWx0cy0ke2FyY2h9YClcbiAgICogQHBhcmFtIHZlcnNpb24gVGhlIHZlcnNpb24gcGF0dGVybiAoZGVmYXVsdHMgdG8gYHgueC54YCB0byB1c2UgdGhlIGxhdGVzdCB2ZXJzaW9uKVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tSW1hZ2VCdWlsZGVyKHNjb3BlOiBDb25zdHJ1Y3QsIHJlc291cmNlTmFtZTogc3RyaW5nLCB2ZXJzaW9uOiBzdHJpbmcgPSAneC54LngnKTogQmFzZUltYWdlIHtcbiAgICBjb25zdCBzdGFjayA9IGNkay5TdGFjay5vZihzY29wZSk7XG4gICAgcmV0dXJuIG5ldyBCYXNlSW1hZ2Uoc3RhY2suZm9ybWF0QXJuKHtcbiAgICAgIHNlcnZpY2U6ICdpbWFnZWJ1aWxkZXInLFxuICAgICAgcmVzb3VyY2U6ICdpbWFnZScsXG4gICAgICBhY2NvdW50OiAnYXdzJyxcbiAgICAgIHJlc291cmNlTmFtZTogYCR7cmVzb3VyY2VOYW1lfS8ke3ZlcnNpb259YCxcbiAgICB9KSk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIG1hcmtldHBsYWNlIHByb2R1Y3QgSUQgZm9yIGFuIEFNSSBwcm9kdWN0IHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhbiBpbWFnZSByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHByb2R1Y3RJZCBUaGUgTWFya2V0cGxhY2UgQU1JIHByb2R1Y3QgSUQgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21NYXJrZXRwbGFjZVByb2R1Y3RJZChwcm9kdWN0SWQ6IHN0cmluZyk6IEJhc2VJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlSW1hZ2UocHJvZHVjdElkKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgU1NNIHBhcmFtZXRlciB0byB1c2UgYXMgdGhlIGJhc2UgaW1hZ2UgaW4gYW4gaW1hZ2UgcmVjaXBlXG4gICAqXG4gICAqIEBwYXJhbSBwYXJhbWV0ZXIgVGhlIFNTTSBwYXJhbWV0ZXIgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21Tc21QYXJhbWV0ZXIocGFyYW1ldGVyOiBzc20uSVBhcmFtZXRlcik6IEJhc2VJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlSW1hZ2UoYHNzbToke3BhcmFtZXRlci5wYXJhbWV0ZXJBcm59YCk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIHBhcmFtZXRlciBuYW1lIGZvciB0aGUgU1NNIHBhcmFtZXRlciB0byB1c2UgYXMgdGhlIGJhc2UgaW1hZ2UgaW4gYW4gaW1hZ2UgcmVjaXBlXG4gICAqXG4gICAqIEBwYXJhbSBwYXJhbWV0ZXJOYW1lIFRoZSBuYW1lIG9mIHRoZSBTU00gcGFyYW1ldGVyIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tU3NtUGFyYW1ldGVyTmFtZShwYXJhbWV0ZXJOYW1lOiBzdHJpbmcpOiBCYXNlSW1hZ2Uge1xuICAgIHJldHVybiBuZXcgQmFzZUltYWdlKGBzc206JHtwYXJhbWV0ZXJOYW1lfWApO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBkaXJlY3Qgc3RyaW5nIHZhbHVlIG9mIHRoZSBiYXNlIGltYWdlIHRvIHVzZSBpbiBhbiBpbWFnZSByZWNpcGUuIFRoaXMgY2FuIGJlIGFuIEVDMiBJbWFnZSBCdWlsZGVyIGltYWdlIEFSTixcbiAgICogYW4gU1NNIHBhcmFtZXRlciwgYW4gQVdTIE1hcmtldHBsYWNlIHByb2R1Y3QgSUQsIG9yIGFuIEFNSSBJRC5cbiAgICpcbiAgICogQHBhcmFtIGJhc2VJbWFnZVN0cmluZyBUaGUgYmFzZSBpbWFnZSBhcyBhIGRpcmVjdCBzdHJpbmcgdmFsdWVcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbVN0cmluZyhiYXNlSW1hZ2VTdHJpbmc6IHN0cmluZyk6IEJhc2VJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlSW1hZ2UoYmFzZUltYWdlU3RyaW5nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBIGJhc2UgQU1JIHdpdGggTlZJRElBIGRyaXZlcnMgcHJlLWluc3RhbGxlZCBmb3IgR1BVIHdvcmtsb2Fkcy5cbiAgICpcbiAgICogVXNlcyBBV1MgRGVlcCBMZWFybmluZyBBTUlzIGZvciBMaW51eCAoVWJ1bnR1LCBBbWF6b24gTGludXggMiwgQW1hem9uIExpbnV4IDIwMjMpLlxuICAgKiBGb3IgV2luZG93cywgc3Vic2NyaWJlIHRvIE5WSURJQSBSVFggVmlydHVhbCBXb3Jrc3RhdGlvbiBpbiBBV1MgTWFya2V0cGxhY2UsIHRoZW4gdXNlXG4gICAqIHtAbGluayBmcm9tTWFya2V0cGxhY2VQcm9kdWN0SWR9IHdpdGggdGhlIHByb2R1Y3QgSUQuXG4gICAqXG4gICAqIEBwYXJhbSBvcyBUYXJnZXQgb3BlcmF0aW5nIHN5c3RlbVxuICAgKiBAcGFyYW0gYXJjaGl0ZWN0dXJlIFRhcmdldCBhcmNoaXRlY3R1cmVcbiAgICogQHRocm93cyBFcnJvciBpZiB0aGUgT1MvYXJjaGl0ZWN0dXJlIGNvbWJvIGhhcyBubyBHUFUgYmFzZSBBTUlcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbUdwdUJhc2Uob3M6IE9zLCBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZSk6IEJhc2VJbWFnZSB7XG4gICAgY29uc3QgYXJjaCA9IGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSA/ICd4ODZfNjQnIDogJ2FybTY0JztcblxuICAgIGlmIChvcy5pcyhPcy5MSU5VWF9VQlVOVFUpIHx8IG9zLmlzKE9zLkxJTlVYX1VCVU5UVV8yMjA0KSB8fCBvcy5pcyhPcy5MSU5VWCkpIHtcbiAgICAgIHJldHVybiBCYXNlSW1hZ2UuZnJvbVNzbVBhcmFtZXRlck5hbWUoYC9hd3Mvc2VydmljZS9kZWVwbGVhcm5pbmcvYW1pLyR7YXJjaH0vYmFzZS1vc3MtbnZpZGlhLWRyaXZlci1ncHUtdWJ1bnR1LTIyLjA0L2xhdGVzdC9hbWktaWRgKTtcbiAgICB9XG4gICAgaWYgKG9zLmlzKE9zLkxJTlVYX1VCVU5UVV8yNDA0KSkge1xuICAgICAgcmV0dXJuIEJhc2VJbWFnZS5mcm9tU3NtUGFyYW1ldGVyTmFtZShgL2F3cy9zZXJ2aWNlL2RlZXBsZWFybmluZy9hbWkvJHthcmNofS9iYXNlLW9zcy1udmlkaWEtZHJpdmVyLWdwdS11YnVudHUtMjQuMDQvbGF0ZXN0L2FtaS1pZGApO1xuICAgIH1cbiAgICBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIpKSB7XG4gICAgICByZXR1cm4gQmFzZUltYWdlLmZyb21Tc21QYXJhbWV0ZXJOYW1lKGAvYXdzL3NlcnZpY2UvZGVlcGxlYXJuaW5nL2FtaS8ke2FyY2h9L2Jhc2Utb3NzLW52aWRpYS1kcml2ZXItYW1hem9uLWxpbnV4LTIvbGF0ZXN0L2FtaS1pZGApO1xuICAgIH1cbiAgICBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIwMjMpKSB7XG4gICAgICByZXR1cm4gQmFzZUltYWdlLmZyb21Tc21QYXJhbWV0ZXJOYW1lKGAvYXdzL3NlcnZpY2UvZGVlcGxlYXJuaW5nL2FtaS8ke2FyY2h9L2Jhc2Utb3NzLW52aWRpYS1kcml2ZXItZ3B1LWFtYXpvbi1saW51eC0yMDIzL2xhdGVzdC9hbWktaWRgKTtcbiAgICB9XG4gICAgaWYgKG9zLmlzKE9zLldJTkRPV1MpICYmIGFyY2hpdGVjdHVyZS5pcyhBcmNoaXRlY3R1cmUuWDg2XzY0KSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnTm8gR1BVIGJhc2UgQU1JIGZvciBXaW5kb3dzLiBTdWJzY3JpYmUgdG8gTlZJRElBIFJUWCBWaXJ0dWFsIFdvcmtzdGF0aW9uIChXaW5TZXJ2ZXIgMjAyMikgYXQgJyArXG4gICAgICAgICdodHRwczovL2F3cy5hbWF6b24uY29tL21hcmtldHBsYWNlL3BwL3Byb2R2aWV3LWY0cmV5Z3dtdHhpcHUgKGZyZWUpLCB0aGVuIHVzZSAnICtcbiAgICAgICAgXCJgYmFzZUFtaTogQmFzZUltYWdlLmZyb21NYXJrZXRwbGFjZVByb2R1Y3RJZCgncHJvZC03N3UyZWViMzNsbXJtJylgIChvdGhlciBBTUlzIHdpdGggTlZJRElBIGRyaXZlcnMgaW5zdGFsbGVkIGNhbiBhbHNvIGJlIHVzZWQpLlwiLFxuICAgICAgKTtcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTm8gR1BVIGJhc2UgQU1JIGZvciAke29zLm5hbWV9IC8gJHthcmNoaXRlY3R1cmUubmFtZX0uYCxcbiAgICApO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSByZW5kZXJlZCBiYXNlIGltYWdlIHRvIHVzZVxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGltYWdlOiBzdHJpbmc7XG5cbiAgcHJvdGVjdGVkIGNvbnN0cnVjdG9yKGltYWdlOiBzdHJpbmcpIHtcbiAgICB0aGlzLmltYWdlID0gaW1hZ2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUeXBlIHRoYXQgY2FuIGJlIHVzZWQgdG8gc3BlY2lmeSBhIGJhc2UgY29udGFpbmVyIGltYWdlIC0gZWl0aGVyIGEgc3RyaW5nIChkZXByZWNhdGVkKSBvciBhIEJhc2VDb250YWluZXJJbWFnZSBvYmplY3QuXG4gKlxuICogVG8gY3JlYXRlIGEgQmFzZUNvbnRhaW5lckltYWdlIG9iamVjdCwgdXNlIHRoZSBzdGF0aWMgZmFjdG9yeSBtZXRob2RzIGxpa2UgQmFzZUNvbnRhaW5lckltYWdlLmZyb21FY3IoKS5cbiAqXG4gKiBOb3RlOiBTdHJpbmcgc3VwcG9ydCBpcyBkZXByZWNhdGVkIGFuZCB3aWxsIGJlIHJlbW92ZWQgaW4gYSBmdXR1cmUgdmVyc2lvbi4gVXNlIEJhc2VDb250YWluZXJJbWFnZSBzdGF0aWMgZmFjdG9yeSBtZXRob2RzIGluc3RlYWQuXG4gKi9cbmV4cG9ydCB0eXBlIEJhc2VDb250YWluZXJJbWFnZUlucHV0ID0gc3RyaW5nIHwgQmFzZUNvbnRhaW5lckltYWdlO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBiYXNlIGNvbnRhaW5lciBpbWFnZSB0aGF0IGlzIHVzZWQgdG8gc3RhcnQgZnJvbSBpbiBFQzIgSW1hZ2UgQnVpbGRlciBjb250YWluZXIgYnVpbGRzLlxuICpcbiAqIFRoaXMgY2xhc3MgaXMgYWRhcHRlZCBmcm9tIEFXUyBDREsncyBCYXNlQ29udGFpbmVySW1hZ2UgY2xhc3MgdG8gc3VwcG9ydCBib3RoIHN0cmluZyBhbmQgb2JqZWN0IGlucHV0cy5cbiAqL1xuZXhwb3J0IGNsYXNzIEJhc2VDb250YWluZXJJbWFnZSB7XG4gIC8qKlxuICAgKiBUaGUgRG9ja2VySHViIGltYWdlIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhIGNvbnRhaW5lciByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHJlcG9zaXRvcnkgVGhlIERvY2tlckh1YiByZXBvc2l0b3J5IHdoZXJlIHRoZSBiYXNlIGltYWdlIHJlc2lkZXMgaW5cbiAgICogQHBhcmFtIHRhZyBUaGUgdGFnIG9mIHRoZSBiYXNlIGltYWdlIGluIHRoZSBEb2NrZXJIdWIgcmVwb3NpdG9yeVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tRG9ja2VySHViKHJlcG9zaXRvcnk6IHN0cmluZywgdGFnOiBzdHJpbmcpOiBCYXNlQ29udGFpbmVySW1hZ2Uge1xuICAgIHJldHVybiBuZXcgQmFzZUNvbnRhaW5lckltYWdlKGAke3JlcG9zaXRvcnl9OiR7dGFnfWApO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBFQ1IgY29udGFpbmVyIGltYWdlIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhIGNvbnRhaW5lciByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHJlcG9zaXRvcnkgVGhlIEVDUiByZXBvc2l0b3J5IHdoZXJlIHRoZSBiYXNlIGltYWdlIHJlc2lkZXMgaW5cbiAgICogQHBhcmFtIHRhZyBUaGUgdGFnIG9mIHRoZSBiYXNlIGltYWdlIGluIHRoZSBFQ1IgcmVwb3NpdG9yeVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tRWNyKHJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeSwgdGFnOiBzdHJpbmcpOiBCYXNlQ29udGFpbmVySW1hZ2Uge1xuICAgIHJldHVybiBuZXcgQmFzZUNvbnRhaW5lckltYWdlKHJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaUZvclRhZyh0YWcpLCByZXBvc2l0b3J5KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgRUNSIHB1YmxpYyBjb250YWluZXIgaW1hZ2UgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlIGluIGEgY29udGFpbmVyIHJlY2lwZVxuICAgKlxuICAgKiBAcGFyYW0gcmVnaXN0cnlBbGlhcyBUaGUgYWxpYXMgb2YgdGhlIEVDUiBwdWJsaWMgcmVnaXN0cnkgd2hlcmUgdGhlIGJhc2UgaW1hZ2UgcmVzaWRlcyBpblxuICAgKiBAcGFyYW0gcmVwb3NpdG9yeU5hbWUgVGhlIG5hbWUgb2YgdGhlIEVDUiBwdWJsaWMgcmVwb3NpdG9yeSwgd2hlcmUgdGhlIGJhc2UgaW1hZ2UgcmVzaWRlcyBpblxuICAgKiBAcGFyYW0gdGFnIFRoZSB0YWcgb2YgdGhlIGJhc2UgaW1hZ2UgaW4gdGhlIEVDUiBwdWJsaWMgcmVwb3NpdG9yeVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tRWNyUHVibGljKHJlZ2lzdHJ5QWxpYXM6IHN0cmluZywgcmVwb3NpdG9yeU5hbWU6IHN0cmluZywgdGFnOiBzdHJpbmcpOiBCYXNlQ29udGFpbmVySW1hZ2Uge1xuICAgIHJldHVybiBuZXcgQmFzZUNvbnRhaW5lckltYWdlKGBwdWJsaWMuZWNyLmF3cy8ke3JlZ2lzdHJ5QWxpYXN9LyR7cmVwb3NpdG9yeU5hbWV9OiR7dGFnfWApO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBzdHJpbmcgdmFsdWUgb2YgdGhlIGJhc2UgaW1hZ2UgdG8gdXNlIGluIGEgY29udGFpbmVyIHJlY2lwZS4gVGhpcyBjYW4gYmUgYW4gRUMyIEltYWdlIEJ1aWxkZXIgaW1hZ2UgQVJOLFxuICAgKiBhbiBFQ1Igb3IgRUNSIHB1YmxpYyBpbWFnZSwgb3IgYSBjb250YWluZXIgVVJJIHNvdXJjZWQgZnJvbSBhIHRoaXJkLXBhcnR5IGNvbnRhaW5lciByZWdpc3RyeSBzdWNoIGFzIERvY2tlckh1Yi5cbiAgICpcbiAgICogQHBhcmFtIGJhc2VDb250YWluZXJJbWFnZVN0cmluZyBUaGUgYmFzZSBpbWFnZSBhcyBhIGRpcmVjdCBzdHJpbmcgdmFsdWVcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbVN0cmluZyhiYXNlQ29udGFpbmVySW1hZ2VTdHJpbmc6IHN0cmluZyk6IEJhc2VDb250YWluZXJJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlQ29udGFpbmVySW1hZ2UoYmFzZUNvbnRhaW5lckltYWdlU3RyaW5nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgcmVuZGVyZWQgYmFzZSBpbWFnZSB0byB1c2VcbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBpbWFnZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgRUNSIHJlcG9zaXRvcnkgaWYgdGhpcyBpbWFnZSB3YXMgY3JlYXRlZCBmcm9tIGFuIEVDUiByZXBvc2l0b3J5LlxuICAgKiBUaGlzIGFsbG93cyBhdXRvbWF0aWMgcGVybWlzc2lvbiBncmFudGluZyBmb3IgQ29kZUJ1aWxkLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGVjclJlcG9zaXRvcnk/OiBlY3IuSVJlcG9zaXRvcnk7XG5cbiAgcHJvdGVjdGVkIGNvbnN0cnVjdG9yKGltYWdlOiBzdHJpbmcsIGVjclJlcG9zaXRvcnk/OiBlY3IuSVJlcG9zaXRvcnkpIHtcbiAgICB0aGlzLmltYWdlID0gaW1hZ2U7XG4gICAgdGhpcy5lY3JSZXBvc2l0b3J5ID0gZWNyUmVwb3NpdG9yeTtcbiAgfVxufVxuIl19