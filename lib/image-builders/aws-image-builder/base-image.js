"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseContainerImage = exports.BaseImage = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const cdk = require("aws-cdk-lib");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS1pbWFnZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9pbWFnZS1idWlsZGVycy9hd3MtaW1hZ2UtYnVpbGRlci9iYXNlLWltYWdlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0FBQUEsbUNBQW1DO0FBY25DOzs7O0dBSUc7QUFDSCxNQUFhLFNBQVM7SUFDcEI7Ozs7T0FJRztJQUNJLE1BQU0sQ0FBQyxTQUFTLENBQUMsS0FBYTtRQUNuQyxPQUFPLElBQUksU0FBUyxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzlCLENBQUM7SUFFRDs7Ozs7Ozs7T0FRRztJQUNJLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFnQixFQUFFLFlBQW9CLEVBQUUsVUFBa0IsT0FBTztRQUM5RixNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUNsQyxPQUFPLElBQUksU0FBUyxDQUFDLEtBQUssQ0FBQyxTQUFTLENBQUM7WUFDbkMsT0FBTyxFQUFFLGNBQWM7WUFDdkIsUUFBUSxFQUFFLE9BQU87WUFDakIsT0FBTyxFQUFFLEtBQUs7WUFDZCxZQUFZLEVBQUUsR0FBRyxZQUFZLElBQUksT0FBTyxFQUFFO1NBQzNDLENBQUMsQ0FBQyxDQUFDO0lBQ04sQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxNQUFNLENBQUMsd0JBQXdCLENBQUMsU0FBaUI7UUFDdEQsT0FBTyxJQUFJLFNBQVMsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNsQyxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNJLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxTQUF5QjtRQUN0RCxPQUFPLElBQUksU0FBUyxDQUFDLE9BQU8sU0FBUyxDQUFDLFlBQVksRUFBRSxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUVEOzs7O09BSUc7SUFDSSxNQUFNLENBQUMsb0JBQW9CLENBQUMsYUFBcUI7UUFDdEQsT0FBTyxJQUFJLFNBQVMsQ0FBQyxPQUFPLGFBQWEsRUFBRSxDQUFDLENBQUM7SUFDL0MsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0ksTUFBTSxDQUFDLFVBQVUsQ0FBQyxlQUF1QjtRQUM5QyxPQUFPLElBQUksU0FBUyxDQUFDLGVBQWUsQ0FBQyxDQUFDO0lBQ3hDLENBQUM7SUFPRCxZQUFzQixLQUFhO1FBQ2pDLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO0lBQ3JCLENBQUM7O0FBekVILDhCQTBFQzs7O0FBV0Q7Ozs7R0FJRztBQUNILE1BQWEsa0JBQWtCO0lBQzdCOzs7OztPQUtHO0lBQ0ksTUFBTSxDQUFDLGFBQWEsQ0FBQyxVQUFrQixFQUFFLEdBQVc7UUFDekQsT0FBTyxJQUFJLGtCQUFrQixDQUFDLEdBQUcsVUFBVSxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUM7SUFDeEQsQ0FBQztJQUVEOzs7OztPQUtHO0lBQ0ksTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUEyQixFQUFFLEdBQVc7UUFDNUQsT0FBTyxJQUFJLGtCQUFrQixDQUFDLFVBQVUsQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsRUFBRSxVQUFVLENBQUMsQ0FBQztJQUNqRixDQUFDO0lBRUQ7Ozs7OztPQU1HO0lBQ0ksTUFBTSxDQUFDLGFBQWEsQ0FBQyxhQUFxQixFQUFFLGNBQXNCLEVBQUUsR0FBVztRQUNwRixPQUFPLElBQUksa0JBQWtCLENBQUMsa0JBQWtCLGFBQWEsSUFBSSxjQUFjLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQztJQUM1RixDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSSxNQUFNLENBQUMsVUFBVSxDQUFDLHdCQUFnQztRQUN2RCxPQUFPLElBQUksa0JBQWtCLENBQUMsd0JBQXdCLENBQUMsQ0FBQztJQUMxRCxDQUFDO0lBYUQsWUFBc0IsS0FBYSxFQUFFLGFBQStCO1FBQ2xFLElBQUksQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1FBQ25CLElBQUksQ0FBQyxhQUFhLEdBQUcsYUFBYSxDQUFDO0lBQ3JDLENBQUM7O0FBeERILGdEQXlEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBlY3IgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjcic7XG5pbXBvcnQgKiBhcyBzc20gZnJvbSAnYXdzLWNkay1saWIvYXdzLXNzbSc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuLyoqXG4gKiBUeXBlIHRoYXQgY2FuIGJlIHVzZWQgdG8gc3BlY2lmeSBhIGJhc2UgaW1hZ2UgLSBlaXRoZXIgYSBzdHJpbmcgKGRlcHJlY2F0ZWQpIG9yIGEgQmFzZUltYWdlIG9iamVjdC5cbiAqXG4gKiBUbyBjcmVhdGUgYSBCYXNlSW1hZ2Ugb2JqZWN0LCB1c2UgdGhlIHN0YXRpYyBmYWN0b3J5IG1ldGhvZHMgbGlrZSBCYXNlSW1hZ2UuZnJvbUFtaUlkKCkuXG4gKlxuICogTm90ZTogU3RyaW5nIHN1cHBvcnQgaXMgZGVwcmVjYXRlZCBhbmQgd2lsbCBiZSByZW1vdmVkIGluIGEgZnV0dXJlIHZlcnNpb24uIFVzZSBCYXNlSW1hZ2Ugc3RhdGljIGZhY3RvcnkgbWV0aG9kcyBpbnN0ZWFkLlxuICovXG5leHBvcnQgdHlwZSBCYXNlSW1hZ2VJbnB1dCA9IHN0cmluZyB8IEJhc2VJbWFnZTtcblxuLyoqXG4gKiBSZXByZXNlbnRzIGEgYmFzZSBpbWFnZSB0aGF0IGlzIHVzZWQgdG8gc3RhcnQgZnJvbSBpbiBFQzIgSW1hZ2UgQnVpbGRlciBpbWFnZSBidWlsZHMuXG4gKlxuICogVGhpcyBjbGFzcyBpcyBhZGFwdGVkIGZyb20gQVdTIENESydzIEJhc2VJbWFnZSBjbGFzcyB0byBzdXBwb3J0IGJvdGggc3RyaW5nIGFuZCBvYmplY3QgaW5wdXRzLlxuICovXG5leHBvcnQgY2xhc3MgQmFzZUltYWdlIHtcbiAgLyoqXG4gICAqIFRoZSBBTUkgSUQgdG8gdXNlIGFzIGEgYmFzZSBpbWFnZSBpbiBhbiBpbWFnZSByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIGFtaUlkIFRoZSBBTUkgSUQgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21BbWlJZChhbWlJZDogc3RyaW5nKTogQmFzZUltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShhbWlJZCk7XG4gIH1cblxuICAvKipcbiAgICogQW4gQVdTLXByb3ZpZGVkIEVDMiBJbWFnZSBCdWlsZGVyIGltYWdlIHRvIHVzZSBhcyBhIGJhc2UgaW1hZ2UgaW4gYW4gaW1hZ2UgcmVjaXBlLlxuICAgKlxuICAgKiBUaGlzIGNvbnN0cnVjdHMgYW4gSW1hZ2UgQnVpbGRlciBBUk4gZm9yIEFXUy1wcm92aWRlZCBpbWFnZXMgbGlrZSBgdWJ1bnR1LXNlcnZlci0yMi1sdHMteDg2L3gueC54YC5cbiAgICpcbiAgICogQHBhcmFtIHNjb3BlIFRoZSBjb25zdHJ1Y3Qgc2NvcGUgKHVzZWQgdG8gZGV0ZXJtaW5lIHRoZSBzdGFjayBhbmQgcmVnaW9uKVxuICAgKiBAcGFyYW0gcmVzb3VyY2VOYW1lIFRoZSBJbWFnZSBCdWlsZGVyIHJlc291cmNlIG5hbWUgcGF0dGVybiAoZS5nLiwgYHVidW50dS1zZXJ2ZXItMjItbHRzLXg4NmAgb3IgYHVidW50dS1zZXJ2ZXItMjItbHRzLSR7YXJjaH1gKVxuICAgKiBAcGFyYW0gdmVyc2lvbiBUaGUgdmVyc2lvbiBwYXR0ZXJuIChkZWZhdWx0cyB0byBgeC54LnhgIHRvIHVzZSB0aGUgbGF0ZXN0IHZlcnNpb24pXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21JbWFnZUJ1aWxkZXIoc2NvcGU6IENvbnN0cnVjdCwgcmVzb3VyY2VOYW1lOiBzdHJpbmcsIHZlcnNpb246IHN0cmluZyA9ICd4LngueCcpOiBCYXNlSW1hZ2Uge1xuICAgIGNvbnN0IHN0YWNrID0gY2RrLlN0YWNrLm9mKHNjb3BlKTtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShzdGFjay5mb3JtYXRBcm4oe1xuICAgICAgc2VydmljZTogJ2ltYWdlYnVpbGRlcicsXG4gICAgICByZXNvdXJjZTogJ2ltYWdlJyxcbiAgICAgIGFjY291bnQ6ICdhd3MnLFxuICAgICAgcmVzb3VyY2VOYW1lOiBgJHtyZXNvdXJjZU5hbWV9LyR7dmVyc2lvbn1gLFxuICAgIH0pKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbWFya2V0cGxhY2UgcHJvZHVjdCBJRCBmb3IgYW4gQU1JIHByb2R1Y3QgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlIGluIGFuIGltYWdlIHJlY2lwZVxuICAgKlxuICAgKiBAcGFyYW0gcHJvZHVjdElkIFRoZSBNYXJrZXRwbGFjZSBBTUkgcHJvZHVjdCBJRCB0byB1c2UgYXMgdGhlIGJhc2UgaW1hZ2VcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbU1hcmtldHBsYWNlUHJvZHVjdElkKHByb2R1Y3RJZDogc3RyaW5nKTogQmFzZUltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShwcm9kdWN0SWQpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBTU00gcGFyYW1ldGVyIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhbiBpbWFnZSByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlciBUaGUgU1NNIHBhcmFtZXRlciB0byB1c2UgYXMgdGhlIGJhc2UgaW1hZ2VcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbVNzbVBhcmFtZXRlcihwYXJhbWV0ZXI6IHNzbS5JUGFyYW1ldGVyKTogQmFzZUltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShgc3NtOiR7cGFyYW1ldGVyLnBhcmFtZXRlckFybn1gKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgcGFyYW1ldGVyIG5hbWUgZm9yIHRoZSBTU00gcGFyYW1ldGVyIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhbiBpbWFnZSByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHBhcmFtZXRlck5hbWUgVGhlIG5hbWUgb2YgdGhlIFNTTSBwYXJhbWV0ZXIgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21Tc21QYXJhbWV0ZXJOYW1lKHBhcmFtZXRlck5hbWU6IHN0cmluZyk6IEJhc2VJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlSW1hZ2UoYHNzbToke3BhcmFtZXRlck5hbWV9YCk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIGRpcmVjdCBzdHJpbmcgdmFsdWUgb2YgdGhlIGJhc2UgaW1hZ2UgdG8gdXNlIGluIGFuIGltYWdlIHJlY2lwZS4gVGhpcyBjYW4gYmUgYW4gRUMyIEltYWdlIEJ1aWxkZXIgaW1hZ2UgQVJOLFxuICAgKiBhbiBTU00gcGFyYW1ldGVyLCBhbiBBV1MgTWFya2V0cGxhY2UgcHJvZHVjdCBJRCwgb3IgYW4gQU1JIElELlxuICAgKlxuICAgKiBAcGFyYW0gYmFzZUltYWdlU3RyaW5nIFRoZSBiYXNlIGltYWdlIGFzIGEgZGlyZWN0IHN0cmluZyB2YWx1ZVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tU3RyaW5nKGJhc2VJbWFnZVN0cmluZzogc3RyaW5nKTogQmFzZUltYWdlIHtcbiAgICByZXR1cm4gbmV3IEJhc2VJbWFnZShiYXNlSW1hZ2VTdHJpbmcpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSByZW5kZXJlZCBiYXNlIGltYWdlIHRvIHVzZVxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGltYWdlOiBzdHJpbmc7XG5cbiAgcHJvdGVjdGVkIGNvbnN0cnVjdG9yKGltYWdlOiBzdHJpbmcpIHtcbiAgICB0aGlzLmltYWdlID0gaW1hZ2U7XG4gIH1cbn1cblxuLyoqXG4gKiBUeXBlIHRoYXQgY2FuIGJlIHVzZWQgdG8gc3BlY2lmeSBhIGJhc2UgY29udGFpbmVyIGltYWdlIC0gZWl0aGVyIGEgc3RyaW5nIChkZXByZWNhdGVkKSBvciBhIEJhc2VDb250YWluZXJJbWFnZSBvYmplY3QuXG4gKlxuICogVG8gY3JlYXRlIGEgQmFzZUNvbnRhaW5lckltYWdlIG9iamVjdCwgdXNlIHRoZSBzdGF0aWMgZmFjdG9yeSBtZXRob2RzIGxpa2UgQmFzZUNvbnRhaW5lckltYWdlLmZyb21FY3IoKS5cbiAqXG4gKiBOb3RlOiBTdHJpbmcgc3VwcG9ydCBpcyBkZXByZWNhdGVkIGFuZCB3aWxsIGJlIHJlbW92ZWQgaW4gYSBmdXR1cmUgdmVyc2lvbi4gVXNlIEJhc2VDb250YWluZXJJbWFnZSBzdGF0aWMgZmFjdG9yeSBtZXRob2RzIGluc3RlYWQuXG4gKi9cbmV4cG9ydCB0eXBlIEJhc2VDb250YWluZXJJbWFnZUlucHV0ID0gc3RyaW5nIHwgQmFzZUNvbnRhaW5lckltYWdlO1xuXG4vKipcbiAqIFJlcHJlc2VudHMgYSBiYXNlIGNvbnRhaW5lciBpbWFnZSB0aGF0IGlzIHVzZWQgdG8gc3RhcnQgZnJvbSBpbiBFQzIgSW1hZ2UgQnVpbGRlciBjb250YWluZXIgYnVpbGRzLlxuICpcbiAqIFRoaXMgY2xhc3MgaXMgYWRhcHRlZCBmcm9tIEFXUyBDREsncyBCYXNlQ29udGFpbmVySW1hZ2UgY2xhc3MgdG8gc3VwcG9ydCBib3RoIHN0cmluZyBhbmQgb2JqZWN0IGlucHV0cy5cbiAqL1xuZXhwb3J0IGNsYXNzIEJhc2VDb250YWluZXJJbWFnZSB7XG4gIC8qKlxuICAgKiBUaGUgRG9ja2VySHViIGltYWdlIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhIGNvbnRhaW5lciByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHJlcG9zaXRvcnkgVGhlIERvY2tlckh1YiByZXBvc2l0b3J5IHdoZXJlIHRoZSBiYXNlIGltYWdlIHJlc2lkZXMgaW5cbiAgICogQHBhcmFtIHRhZyBUaGUgdGFnIG9mIHRoZSBiYXNlIGltYWdlIGluIHRoZSBEb2NrZXJIdWIgcmVwb3NpdG9yeVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tRG9ja2VySHViKHJlcG9zaXRvcnk6IHN0cmluZywgdGFnOiBzdHJpbmcpOiBCYXNlQ29udGFpbmVySW1hZ2Uge1xuICAgIHJldHVybiBuZXcgQmFzZUNvbnRhaW5lckltYWdlKGAke3JlcG9zaXRvcnl9OiR7dGFnfWApO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBFQ1IgY29udGFpbmVyIGltYWdlIHRvIHVzZSBhcyB0aGUgYmFzZSBpbWFnZSBpbiBhIGNvbnRhaW5lciByZWNpcGVcbiAgICpcbiAgICogQHBhcmFtIHJlcG9zaXRvcnkgVGhlIEVDUiByZXBvc2l0b3J5IHdoZXJlIHRoZSBiYXNlIGltYWdlIHJlc2lkZXMgaW5cbiAgICogQHBhcmFtIHRhZyBUaGUgdGFnIG9mIHRoZSBiYXNlIGltYWdlIGluIHRoZSBFQ1IgcmVwb3NpdG9yeVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tRWNyKHJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeSwgdGFnOiBzdHJpbmcpOiBCYXNlQ29udGFpbmVySW1hZ2Uge1xuICAgIHJldHVybiBuZXcgQmFzZUNvbnRhaW5lckltYWdlKHJlcG9zaXRvcnkucmVwb3NpdG9yeVVyaUZvclRhZyh0YWcpLCByZXBvc2l0b3J5KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgRUNSIHB1YmxpYyBjb250YWluZXIgaW1hZ2UgdG8gdXNlIGFzIHRoZSBiYXNlIGltYWdlIGluIGEgY29udGFpbmVyIHJlY2lwZVxuICAgKlxuICAgKiBAcGFyYW0gcmVnaXN0cnlBbGlhcyBUaGUgYWxpYXMgb2YgdGhlIEVDUiBwdWJsaWMgcmVnaXN0cnkgd2hlcmUgdGhlIGJhc2UgaW1hZ2UgcmVzaWRlcyBpblxuICAgKiBAcGFyYW0gcmVwb3NpdG9yeU5hbWUgVGhlIG5hbWUgb2YgdGhlIEVDUiBwdWJsaWMgcmVwb3NpdG9yeSwgd2hlcmUgdGhlIGJhc2UgaW1hZ2UgcmVzaWRlcyBpblxuICAgKiBAcGFyYW0gdGFnIFRoZSB0YWcgb2YgdGhlIGJhc2UgaW1hZ2UgaW4gdGhlIEVDUiBwdWJsaWMgcmVwb3NpdG9yeVxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tRWNyUHVibGljKHJlZ2lzdHJ5QWxpYXM6IHN0cmluZywgcmVwb3NpdG9yeU5hbWU6IHN0cmluZywgdGFnOiBzdHJpbmcpOiBCYXNlQ29udGFpbmVySW1hZ2Uge1xuICAgIHJldHVybiBuZXcgQmFzZUNvbnRhaW5lckltYWdlKGBwdWJsaWMuZWNyLmF3cy8ke3JlZ2lzdHJ5QWxpYXN9LyR7cmVwb3NpdG9yeU5hbWV9OiR7dGFnfWApO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBzdHJpbmcgdmFsdWUgb2YgdGhlIGJhc2UgaW1hZ2UgdG8gdXNlIGluIGEgY29udGFpbmVyIHJlY2lwZS4gVGhpcyBjYW4gYmUgYW4gRUMyIEltYWdlIEJ1aWxkZXIgaW1hZ2UgQVJOLFxuICAgKiBhbiBFQ1Igb3IgRUNSIHB1YmxpYyBpbWFnZSwgb3IgYSBjb250YWluZXIgVVJJIHNvdXJjZWQgZnJvbSBhIHRoaXJkLXBhcnR5IGNvbnRhaW5lciByZWdpc3RyeSBzdWNoIGFzIERvY2tlckh1Yi5cbiAgICpcbiAgICogQHBhcmFtIGJhc2VDb250YWluZXJJbWFnZVN0cmluZyBUaGUgYmFzZSBpbWFnZSBhcyBhIGRpcmVjdCBzdHJpbmcgdmFsdWVcbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgZnJvbVN0cmluZyhiYXNlQ29udGFpbmVySW1hZ2VTdHJpbmc6IHN0cmluZyk6IEJhc2VDb250YWluZXJJbWFnZSB7XG4gICAgcmV0dXJuIG5ldyBCYXNlQ29udGFpbmVySW1hZ2UoYmFzZUNvbnRhaW5lckltYWdlU3RyaW5nKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgcmVuZGVyZWQgYmFzZSBpbWFnZSB0byB1c2VcbiAgICovXG4gIHB1YmxpYyByZWFkb25seSBpbWFnZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBUaGUgRUNSIHJlcG9zaXRvcnkgaWYgdGhpcyBpbWFnZSB3YXMgY3JlYXRlZCBmcm9tIGFuIEVDUiByZXBvc2l0b3J5LlxuICAgKiBUaGlzIGFsbG93cyBhdXRvbWF0aWMgcGVybWlzc2lvbiBncmFudGluZyBmb3IgQ29kZUJ1aWxkLlxuICAgKi9cbiAgcHVibGljIHJlYWRvbmx5IGVjclJlcG9zaXRvcnk/OiBlY3IuSVJlcG9zaXRvcnk7XG5cbiAgcHJvdGVjdGVkIGNvbnN0cnVjdG9yKGltYWdlOiBzdHJpbmcsIGVjclJlcG9zaXRvcnk/OiBlY3IuSVJlcG9zaXRvcnkpIHtcbiAgICB0aGlzLmltYWdlID0gaW1hZ2U7XG4gICAgdGhpcy5lY3JSZXBvc2l0b3J5ID0gZWNyUmVwb3NpdG9yeTtcbiAgfVxufVxuIl19