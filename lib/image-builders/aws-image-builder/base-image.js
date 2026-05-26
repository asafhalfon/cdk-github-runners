"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseContainerImage = exports.BaseImage = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = require("aws-cdk-lib");
const providers_1 = require("../../providers");
/**
 * Represents a base image that is used to start from in EC2 Image Builder image builds.
 *
 * This class is adapted from AWS CDK's BaseImage class to support both string and object inputs.
 */
class BaseImage {
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
    constructor(image) {
        this.image = image;
    }
}
exports.BaseImage = BaseImage;
_a = JSII_RTTI_SYMBOL_1;
BaseImage[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.BaseImage", version: "0.0.0" };
/**
 * Represents a base container image that is used to start from in EC2 Image Builder container builds.
 *
 * This class is adapted from AWS CDK's BaseContainerImage class to support both string and object inputs.
 */
class BaseContainerImage {
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
    constructor(image, ecrRepository) {
        this.image = image;
        this.ecrRepository = ecrRepository;
    }
}
exports.BaseContainerImage = BaseContainerImage;
_b = JSII_RTTI_SYMBOL_1;
BaseContainerImage[_b] = { fqn: "@cloudsnorkel/cdk-github-runners.BaseContainerImage", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1pbWFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9hd3MtaW1hZ2UtYnVpbGRlci9iYXNlLWltYWdlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsbUNBQW1DO0FBSW5DLCtDQUFtRDtBQVduRDs7OztHQUlHO0FBQ0gsTUFBYSxTQUFTO0lBQ3BCOzs7O09BSUc7SUFDSSxNQUFNLENBQUMsU0FBUyxDQUFDLEtBQWE7UUFDbkMsT0FBTyxJQUFJLFNBQVMsQ0FBQyxLQUFLLENBQUMsQ0FBQztJQUM5QixDQUFDO0lBRUQ7Ozs7Ozs7O09BUUc7SUFDSSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsS0FBZ0IsRUFBRSxZQUFvQixFQUFFLFVBQWtCLE9BQU87UUFDOUYsTUFBTSxLQUFLLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDbEMsT0FBTyxJQUFJLFNBQVMsQ0FBQyxLQUFLLENBQUMsU0FBUyxDQUFDO1lBQ25DLE9BQU8sRUFBRSxjQUFjO1lBQ3ZCLFFBQVEsRUFBRSxPQUFPO1lBQ2pCLE9BQU8sRUFBRSxLQUFLO1lBQ2QsWUFBWSxFQUFFLEdBQUcsWUFBWSxJQUFJLE9BQU8sRUFBRTtTQUMzQyxDQUFDLENBQUMsQ0FBQztJQUNOLENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksTUFBTSxDQUFDLHdCQUF3QixDQUFDLFNBQWlCO1FBQ3RELE9BQU8sSUFBSSxTQUFTLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDbEMsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsU0FBeUI7UUFDdEQsT0FBTyxJQUFJLFNBQVMsQ0FBQyxPQUFPLFNBQVMsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxDQUFDO0lBQ3hELENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksTUFBTSxDQUFDLG9CQUFvQixDQUFDLGFBQXFCO1FBQ3RELE9BQU8s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Qyx3QkFBZ0M7UUFDdkQsT0FBTyxJQUFJLGtCQUFrQixDQUFDLHdCQUF3QixDQUFDLENBQUM7SUFDMUQsQ0FBQztJQWFELFlBQXNCLEtBQWEsRUFBRSxhQUErQjtRQUNsRSxJQUFJLENBQUMsS0FBSyxHQUFHLEtBQUssQ0FBQztRQUNuQixJQUFJLENBQUMsYUFBYSxHQUFHLGFBQWEsQ0FBQztJQUNyQyxDQUFDOztBQXhESCxnREF5REMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgZWNyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1lY3InO1xuaW1wb3J0ICogYXMgc3NtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zc20nO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIE9zIH0gZnJvbSAnLi4vLi4vcHJvdmlkZXJzJztcblxuLyoqXG4gKiBUeXBlIHRoYXQgY2FuIGJlIHVzZWQgdG8gc3BlY2lmeSBhIGJhc2UgaW1hZ2UgLSBlaXRoZXIgYSBzdHJpbmcgKGRlcHJlY2F0ZWQpIG9yIGEgQmFzZUltYWdlIG9iamVjdC5cbiAqXG4gKiBUbyBjcmVhdGUgYSBCYXNlSW1hZ2Ugb2JqZWN0LCB1c2UgdGhlIHN0YXRpYyBmYWN0b3J5IG1ldGhvZHMgbGlrZSBCYXNlSW1hZ2UuZnJvbUFtaUlkKCkuXG4gKlxuICogTm90ZTogU3RyaW5nIHN1cHBvcnQgaXMgZGVwcmVjYXRlZCBhbmQgd2lsbCBiZSByZW1vdmVkIGluIGEgZnV0dXJlIHZlcnNpb24uIFVzZSBCYXNlSW1hZ2Ugc3RhdGljIGZhY3RvcnkgbWV0aG9kcyBpbnN0ZWFkLlxuICovXG5leHBvcnQgdHlwZSBCYXNlSW1hZ2VJbnB1dCA9IHN0cmluZyB8IEJhc2VJbWFnZTtcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgYmFzZSBpbWFnZSB0aGF0IGlzIHVzZWQgdG8gc3RhcnQgZnJvbSBpbiBFQzIgSW1hZ2UgQnVpbGRlciBpbWFnZSBidWlsZHMuXG4gKlxuICogVGhpcyBjbGFzcyBpcyBhZGFwdGVkIGZyb20gQVdTIENESydzIEJhc2VJbWFnZSBjbGFzcyB0byBzdXBwb3J0IGJvdGggc3RyaW5nIGFuZCBvYmplY3QgaW5wdXRzLlxuICovXG5leHBvcnQgY2xhc3MgQmFzZUltYWdlIHtcbiAgLyoqXG4gICAqIFRoZSBBTUkgSUQgdG8gdXNlIGFzIGEgYmFzZSBpbWFnZSBpbiBhbiBpbWFnZSByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIGFtaUlkIFRoZSBBTUkgSUQgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21BbWlJZChhbWlJZDogc3RyaW5nKTogQmFzZUltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShhbWlJZCk7XG4gIH1cblxuICAvKipcbiAgICogQW4gQVdTLXByb3ZpZGVkIEVDMiBJbWFnZSBCdWlsZGVyIGltYWdlIHRvIHVzZSBhcyBhIGJhc2UgaW1hZ2UgaW4gYW4gaW1hZ2UgcmVjaXBlLlxuICAgKlxuICAgKiBUaGlzIGNvbnN0cnVjdHMgYW4gSW1hZ2UgQnVpbGRlciBBUk4gZm9yIEFXUy1wcm92aWRlZCBpbWFnZXMgbGlrZSBgdWJ1bnR1LXNlcnZlci0yMi1sdHMteDg2L3gueC54YC5cbiAgICpcbiAgICogQHBhcmFtIHNjb3BlIFRoZSBjb25zdHJ1Y3Qgc2NvcGUgKHVzZWQgdG8gZGV0ZXJtaW5lIHRoZSBzdGFjayBhbmQgcmVnaW9uKVxuICAgKiBAcGFyYW0gcmVzb3VyY2VOYW1lIFRoZSBJbWFnZSBCdWlsZGVyIHJlc291cmNlIG5hbWUgcGF0dGVybiAoZS5nLiwgYHVidW50dS1zZXJ2ZXItMjItbHRzLXg4NmAgb3IgYHVidW50dS1zZXJ2ZXItMjItbHRzLSR7YXJjaH1gKVxuICAgKiBAcGFyYW0gdmVyc2lvbiBUaGUgdmVyc2lvbiBwYXR0ZXJuIChkZWZhdWx0cyB0byBgeC54LnhgIHRvIHVzZSB0aGUgbGF0ZXN0IHZlcnNpb24pXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21JbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgcmVzb3VyY2VOYW1lOiBzdHJpbmcsIHZlcnNpb246IHN0cmluZyA9ICd4LngueCcpOiBCYXNlSW1hZ2Uge1xuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHNjb3BlKTtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShzdGFjay5mb3JtYXRBcm4oe1xuICAgICAgc2VydmljZTogJ2ltYWdlYnVpbGRlcicsXG4gICAgICByZXNvdXJjZTogJ2ltYWdlJyxcbiAgICAgIGFjY291bnQ6ICdhd3MnLFxuICAgICAgcmVzb3VyY2VOYW1lOiBgJHtyZXNvdXJjZU5hbWV9LyR7dmVyc2lvbn1gLFxuICAgIH0pKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbWFya2V0cGxhY2UgcHJvZHVjdCBJRCBmb3IgYW4gQU1JIHByb2R1Y3QgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlIGluIGFuIGltYWdlIHJlY2lwZVxuICAgKlxuICAgKiBAcGFyYW0gcHJvZHVjdElkIFRoZSBNYXJrZXRwbGFjZSBBTUkgcHJvZHVjdCBJRCB0byB1c2UgYXMgdGhlIGJhc2UgaW1hZ2VcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbU1hcmtldHBsYWNlUHJvZHVjdElkKHByb2R1Y3RJZDogc3RyaW5nKTogQmFzZUltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShwcm9kdWN0SWQpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBTU00gcGFyYW1ldGVyIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhbiBpbWFnZSByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlciBUaGUgU1NNIHBhcmFtZXRlciB0byB1c2UgYXMgdGhlIGJhc2UgaW1hZ2VcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbVNzbVBhcmFtZXRlcihwYXJhbWV0ZXI6IHNzbS5JUGFyYW1ldGVyKTogQmFzZUltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShgc3NtOiR7cGFyYW1ldGVyLnBhcmFtZXRlckFybn1gKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgcGFyYW1ldGVyIG5hbWUgZm9yIHRoZSBTU00gcGFyYW1ldGVyIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhbiBpbWFnZSByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlck5hbWUgVGhlIG5hbWUgb2YgdGhlIFNTTSBwYXJhbWV0ZXIgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21Tc21QYXJhbWV0ZXJOYW1lKHBhcmFtZXRlck5hbWU6IHN0cmluZyk6IEJhc2VJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlSW1hZ2UoYHNzbToke3BhcmFtZXRlck5hbWV9YCk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIGRpcmVjdCBzdHJpbmcgdmFsdWUgb2YgdGhlIGJhc2UgaW1hZ2UgdG8gdXNlIGluIGFuIGltYWdlIHJlY2lwZS4gVGhpcyBjYW4gYmUgYW4gRUMyIEltYWdlIEJ1aWxkZXIgaW1hZ2UgQVJOLFxuICAgKiBhbiBTU00gcGFyYW1ldGVyLCBhbiBBV1MgTWFya2V0cGxhY2UgcHJvZHVjdCBJRCwgb3IgYW4gQU1JIElELlxuICAgKlxuICAgKiBAcGFyYW0gYmFzZUltYWdlU3RyaW5nIFRoZSBiYXNlIGltYWdlIGFzIGEgZGlyZWN0IHN0cmluZyB2YWx1ZVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tU3RyaW5nKGJhc2VJbWFnZVN0cmluZzogc3RyaW5nKTogQmFzZUltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShiYXNlSW1hZ2VTdHJpbmcpO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgYmFzZSBBTUkgd2l0aCBOVklESUEgZHJpdmVycyBwcmUtaW5zdGFsbGVkIGZvciBHUFUgd29ya2xvYWRzLlxuICAgKlxuICAgKiBVc2VzIEFXUyBEZWVwIExlYXJuaW5nIEFNSXMgZm9yIExpbnV4IChVYnVudHUsIEFtYXpvbiBMaW51eCAyLCBBbWF6b24gTGludXggMjAyMykuXG4gICAqIEZvciBXaW5kb3dzLCBzdWJzY3JpYmUgdG8gTlZJRElBIFJUWCBWaXJ0dWFsIFdvcmtzdGF0aW9uIGluIEFXUyBNYXJrZXRwbGFjZSwgdGhlbiB1c2VcbiAgICoge0BsaW5rIGZyb21NYXJrZXRwbGFjZVByb2R1Y3RJZH0gd2l0aCB0aGUgcHJvZHVjdCBJRC5cbiAgICpcbiAgICogQHBhcmFtIG9zIFRhcmdldCBvcGVyYXRpbmcgc3lzdGVtXG4gICAqIEBwYXJhbSBhcmNoaXRlY3R1cmUgVGFyZ2V0IGFyY2hpdGVjdHVyZVxuICAgKiBAdGhyb3dzIEVycm9yIGlmIHRoZSBPUy9hcmNoaXRlY3R1cmUgY29tYm8gaGFzIG5vIEdQVSBiYXNlIEFNSVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tR3B1QmFzZShvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogQmFzZUltYWdlIHtcbiAgICBjb25zdCBhcmNoID0gYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpID8gJ3g4Nl82NCcgOiAnYXJtNjQnO1xuXG4gICAgaWYgKG9zLmlzKE9zLkxJTlVYX1VCVU5UVSkgfHwgb3MuaXMoT3MuTElOVVhfVUJVTlRVXzIyMDQpIHx8IG9zLmlzKE9zLkxJTlVYKSkge1xuICAgICAgcmV0dXJuIEJhc2VJbWFnZS5mcm9tU3NtUGFyYW1ldGVyTmFtZShgL2F3cy9zZXJ2aWNlL2RlZXBsZWFybmluZy9hbWkvJHthcmNofS9iYXNlLW9zcy1udmlkaWEtZHJpdmVyLWdwdS11YnVudHUtMjIuMDQvbGF0ZXN0L2FtaS1pZGApO1xuICAgIH1cbiAgICBpZiAob3MuaXMoT3MuTElOVVhfVUJVTlRVXzI0MDQpKSB7XG4gICAgICByZXR1cm4gQmFzZUltYWdlLmZyb21Tc21QYXJhbWV0ZXJOYW1lKGAvYXdzL3NlcnZpY2UvZGVlcGxlYXJuaW5nL2FtaS8ke2FyY2h9L2Jhc2Utb3NzLW52aWRpYS1kcml2ZXItZ3B1LXVidW50dS0yNC4wNC9sYXRlc3QvYW1pLWlkYCk7XG4gICAgfVxuICAgIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMikpIHtcbiAgICAgIHJldHVybiBCYXNlSW1hZ2UuZnJvbVNzbVBhcmFtZXRlck5hbWUoYC9hd3Mvc2VydmljZS9kZWVwbGVhcm5pbmcvYW1pLyR7YXJjaH0vYmFzZS1vc3MtbnZpZGlhLWRyaXZlci1hbWF6b24tbGludXgtMi9sYXRlc3QvYW1pLWlkYCk7XG4gICAgfVxuICAgIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMjAyMykpIHtcbiAgICAgIHJldHVybiBCYXNlSW1hZ2UuZnJvbVNzbVBhcmFtZXRlck5hbWUoYC9hd3Mvc2VydmljZS9kZWVwbGVhcm5pbmcvYW1pLyR7YXJjaH0vYmFzZS1vc3MtbnZpZGlhLWRyaXZlci1ncHUtYW1hem9uLWxpbnV4LTIwMjMvbGF0ZXN0L2FtaS1pZGApO1xuICAgIH1cbiAgICBpZiAob3MuaXMoT3MuV0lORE9XUykgJiYgYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5YODZfNjQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICdObyBHUFUgYmFzZSBBTUkgZm9yIFdpbmRvd3MuIFN1YnNjcmliZSB0byBOVklESUEgUlRYIFZpcnR1YWwgV29ya3N0YXRpb24gKFdpblNlcnZlciAyMDIyKSBhdCAnICtcbiAgICAgICAgJ2h0dHBzOi8vYXdzLmFtYXpvbi5jb20vbWFya2V0cGxhY2UvcHAvcHJvZHZpZXctZjRyZXlnd210eGlwdSAoZnJlZSksIHRoZW4gdXNlICcgK1xuICAgICAgICBcImBiYXNlQW1pOiBCYXNlSW1hZ2UuZnJvbU1hcmtldHBsYWNlUHJvZHVjdElkKCdwcm9kLTc3dTJlZWIzM2xtcm0nKWAgKG90aGVyIEFNSXMgd2l0aCBOVklESUEgZHJpdmVycyBpbnN0YWxsZWQgY2FuIGFsc28gYmUgdXNlZCkuXCIsXG4gICAgICApO1xuICAgIH1cblxuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBObyBHUFUgYmFzZSBBTUkgZm9yICR7b3MubmFtZX0gLyAke2FyY2hpdGVjdHVyZS5uYW1lfS5gLFxuICAgICk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIHJlbmRlcmVkIGJhc2UgaW1hZ2UgdG8gdXNlXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgaW1hZ2U6IHN0cmluZztcblxuICBwcm90ZWN0ZWQgY29uc3RydWN0b3IoaW1hZ2U6IHN0cmluZykge1xuICAgIHRoaXMuaW1hZ2UgPSBpbWFnZTtcbiAgfVxufVxuXG4vKipcbiAqIFR5cGUgdGhhdCBjYW4gYmUgdXNlZCB0byBzcGVjaWZ5IGEgYmFzZSBjb250YWluZXIgaW1hZ2UgLSBlaXRoZXIgYSBzdHJpbmcgKGRlcHJlY2F0ZWQpIG9yIGEgQmFzZUNvbnRhaW5lckltYWdlIG9iamVjdC5cbiAqXG4gKiBUbyBjcmVhdGUgYSBCYXNlQ29udGFpbmVySW1hZ2Ugb2JqZWN0LCB1c2UgdGhlIHN0YXRpYyBmYWN0b3J5IG1ldGhvZHMgbGlrZSBCYXNlQ29udGFpbmVySW1hZ2UuZnJvbUVjcigpLlxuICpcbiAqIE5vdGU6IFN0cmluZyBzdXBwb3J0IGlzIGRlcHJlY2F0ZWQgYW5kIHdpbGwgYmUgcmVtb3ZlZCBpbiBhIGZ1dHVyZSB2ZXJzaW9uLiBVc2UgQmFzZUNvbnRhaW5lckltYWdlIHN0YXRpYyBmYWN0b3J5IG1ldGhvZHMgaW5zdGVhZC5cbiAqL1xuZXhwb3J0IHR5cGUgQmFzZUNvbnRhaW5lckltYWdlSW5wdXQgPSBzdHJpbmcgfCBCYXNlQ29udGFpbmVySW1hZ2U7XG5cbi8qKlxuICogUmVwcmVzZW50cyBhIGJhc2UgY29udGFpbmVyIGltYWdlIHRoYXQgaXMgdXNlZCB0byBzdGFydCBmcm9tIGluIEVDMiBJbWFnZSBCdWlsZGVyIGNvbnRhaW5lciBidWlsZHMuXG4gKlxuICogVGhpcyBjbGFzcyBpcyBhZGFwdGVkIGZyb20gQVdTIENESydzIEJhc2VDb250YWluZXJJbWFnZSBjbGFzcyB0byBzdXBwb3J0IGJvdGggc3RyaW5nIGFuZCBvYmplY3QgaW5wdXRzLlxuICovXG5leHBvcnQgY2xhc3MgQmFzZUNvbnRhaW5lckltYWdlIHtcbiAgLyoqXG4gICAqIFRoZSBEb2NrZXJIdWIgaW1hZ2UgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlIGluIGEgY29udGFpbmVyIHJlY2lwZVxuICAgKlxuICAgKiBAcGFyYW0gcmVwb3NpdG9yeSBUaGUgRG9ja2VySHViIHJlcG9zaXRvcnkgd2hlcmUgdGhlIGJhc2UgaW1hZ2UgcmVzaWRlcyBpblxuICAgKiBAcGFyYW0gdGFnIFRoZSB0YWcgb2YgdGhlIGJhc2UgaW1hZ2UgaW4gdGhlIERvY2tlckh1YiByZXBvc2l0b3J5XG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21Eb2NrZXJIdWIocmVwb3NpdG9yeTogc3RyaW5nLCB0YWc6IHN0cmluZyk6IEJhc2VDb250YWluZXJJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlQ29udGFpbmVySW1hZ2UoYCR7cmVwb3NpdG9yeX06JHt0YWd9YCk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIEVDUiBjb250YWluZXIgaW1hZ2UgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlIGluIGEgY29udGFpbmVyIHJlY2lwZVxuICAgKlxuICAgKiBAcGFyYW0gcmVwb3NpdG9yeSBUaGUgRUNSIHJlcG9zaXRvcnkgd2hlcmUgdGhlIGJhc2UgaW1hZ2UgcmVzaWRlcyBpblxuICAgKiBAcGFyYW0gdGFnIFRoZSB0YWcgb2YgdGhlIGJhc2UgaW1hZ2UgaW4gdGhlIEVDUiByZXBvc2l0b3J5XG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21FY3IocmVwb3NpdG9yeTogZWNyLklSZXBvc2l0b3J5LCB0YWc6IHN0cmluZyk6IEJhc2VDb250YWluZXJJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlQ29udGFpbmVySW1hZ2UocmVwb3NpdG9yeS5yZXBvc2l0b3J5VXJpRm9yVGFnKHRhZyksIHJlcG9zaXRvcnkpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBFQ1IgcHVibGljIGNvbnRhaW5lciBpbWFnZSB0byB1c2UgYXMgdGhlIGJhc2UgaW1hZ2UgaW4gYSBjb250YWluZXIgcmVjaXBlXG4gICAqXG4gICAqIEBwYXJhbSByZWdpc3RyeUFsaWFzIFRoZSBhbGlhcyBvZiB0aGUgRUNSIHB1YmxpYyByZWdpc3RyeSB3aGVyZSB0aGUgYmFzZSBpbWFnZSByZXNpZGVzIGluXG4gICAqIEBwYXJhbSByZXBvc2l0b3J5TmFtZSBUaGUgbmFtZSBvZiB0aGUgRUNSIHB1YmxpYyByZXBvc2l0b3J5LCB3aGVyZSB0aGUgYmFzZSBpbWFnZSByZXNpZGVzIGluXG4gICAqIEBwYXJhbSB0YWcgVGhlIHRhZyBvZiB0aGUgYmFzZSBpbWFnZSBpbiB0aGUgRUNSIHB1YmxpYyByZXBvc2l0b3J5XG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21FY3JQdWJsaWMocmVnaXN0cnlBbGlhczogc3RyaW5nLCByZXBvc2l0b3J5TmFtZTogc3RyaW5nLCB0YWc6IHN0cmluZyk6IEJhc2VDb250YWluZXJJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlQ29udGFpbmVySW1hZ2UoYHB1YmxpYy5lY3IuYXdzLyR7cmVnaXN0cnlBbGlhc30vJHtyZXBvc2l0b3J5TmFtZX06JHt0YWd9YCk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIHN0cmluZyB2YWx1ZSBvZiB0aGUgYmFzZSBpbWFnZSB0byB1c2UgaW4gYSBjb250YWluZXIgcmVjaXBlLiBUaGlzIGNhbiBiZSBhbiBFQzIgSW1hZ2UgQnVpbGRlciBpbWFnZSBBUk4sXG4gICAqIGFuIEVDUiBvciBFQ1IgcHVibGljIGltYWdlLCBvciBhIGNvbnRhaW5lciBVUkkgc291cmNlZCBmcm9tIGEgdGhpcmQtcGFydHkgY29udGFpbmVyIHJlZ2lzdHJ5IHN1Y2ggYXMgRG9ja2VySHViLlxuICAgKlxuICAgKiBAcGFyYW0gYmFzZUNvbnRhaW5lckltYWdlU3RyaW5nIFRoZSBiYXNlIGltYWdlIGFzIGEgZGlyZWN0IHN0cmluZyB2YWx1ZVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tU3RyaW5nKGJhc2VDb250YWluZXJJbWFnZVN0cmluZzogc3RyaW5nKTogQmFzZUNvbnRhaW5lckltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VDb250YWluZXJJbWFnZShiYXNlQ29udGFpbmVySW1hZ2VTdHJpbmcpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSByZW5kZXJlZCBiYXNlIGltYWdlIHRvIHVzZVxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGltYWdlOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIFRoZSBFQ1IgcmVwb3NpdG9yeSBpZiB0aGlzIGltYWdlIHdhcyBjcmVhdGVkIGZyb20gYW4gRUNSIHJlcG9zaXRvcnkuXG4gICAqIFRoaXMgYWxsb3dzIGF1dG9tYXRpYyBwZXJtaXNzaW9uIGdyYW50aW5nIGZvciBDb2RlQnVpbGQuXG4gICAqL1xuICBwdWJsaWMgcmVhZG9ubHkgZWNyUmVwb3NpdG9yeT86IGVjci5JUmVwb3NpdG9yeTtcblxuICBwcm90ZWN0ZWQgY29uc3RydWN0b3IoaW1hZ2U6IHN0cmluZywgZWNyUmVwb3NpdG9yeT86IGVjci5JUmVwb3NpdG9yeSkge1xuICAgIHRoaXMuaW1hZ2UgPSBpbWFnZTtcbiAgICB0aGlzLmVjclJlcG9zaXRvcnkgPSBlY3JSZXBvc2l0b3J5O1xuICB9XG59XG4iXX0=