"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticRunnerImage = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const constructs_1 = require("constructs");
const base_image_1 = require("./aws-image-builder/base-image");
const codebuild_1 = require("./codebuild");
const providers_1 = require("../providers");
/**
 * Helper class with methods to use static images that are built outside the context of this project.
 */
class StaticRunnerImage {
    static [JSII_RTTI_SYMBOL_1] = { fqn: "@cloudsnorkel/cdk-github-runners.StaticRunnerImage", version: "0.0.0" };
    /**
     * Create a builder (that doesn't actually build anything) from an existing image in an existing repository. The image must already have GitHub Actions runner installed. You are responsible to update it and remove it when done.
     *
     * @param repository ECR repository
     * @param tag image tag
     * @param architecture image architecture
     * @param os image OS
     */
    static fromEcrRepository(repository, tag = 'latest', architecture = providers_1.Architecture.X86_64, os = providers_1.Os.LINUX) {
        return {
            bindDockerImage() {
                return {
                    imageRepository: repository,
                    imageTag: tag,
                    architecture,
                    os,
                    runnerVersion: providers_1.RunnerVersion.latest(),
                    // the image already exists, so there is nothing to wait for. we still need a dependable, or
                    // providers that require one (like Lambda) will refuse to use this image.
                    _dependable: new constructs_1.DependencyGroup(),
                };
            },
            bindAmi() {
                throw new Error('fromEcrRepository() cannot be used to build AMIs');
            },
        };
    }
    /**
     * Create a builder from an existing Docker Hub image. The image must already have GitHub Actions runner installed. You are responsible to update it and remove it when done.
     *
     * We create a CodeBuild image builder behind the scenes to copy the image over to ECR. This helps avoid Docker Hub rate limits and prevent failures.
     *
     * @param scope
     * @param id
     * @param image Docker Hub image with optional tag
     * @param architecture image architecture
     * @param os image OS
     */
    static fromDockerHub(scope, id, image, architecture = providers_1.Architecture.X86_64, os = providers_1.Os.LINUX) {
        return new codebuild_1.CodeBuildRunnerImageBuilder(scope, id, {
            os,
            architecture,
            baseDockerImage: base_image_1.BaseContainerImage.fromString(image),
        });
    }
}
exports.StaticRunnerImage = StaticRunnerImage;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdGljLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL3N0YXRpYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7O0FBQ0EsMkNBQXdEO0FBQ3hELCtEQUFvRTtBQUNwRSwyQ0FBMEQ7QUFFMUQsNENBQXVGO0FBRXZGOztHQUVHO0FBQ0gsTUFBYSxpQkFBaUI7O0lBQzVCOzs7Ozs7O09BT0c7SUFDSSxNQUFNLENBQUMsaUJBQWlCLENBQUMsVUFBMkIsRUFBRSxNQUFjLFFBQVEsRUFBRSxZQUFZLEdBQUcsd0JBQVksQ0FBQyxNQUFNLEVBQUUsRUFBRSxHQUFHLGNBQUUsQ0FBQyxLQUFLO1FBQ3BJLE9BQU87WUFDTCxlQUFlO2dCQUNiLE9BQU87b0JBQ0wsZUFBZSxFQUFFLFVBQVU7b0JBQzNCLFFBQVEsRUFBRSxHQUFHO29CQUNiLFlBQVk7b0JBQ1osRUFBRTtvQkFDRixhQUFhLEVBQUUseUJBQWEsQ0FBQyxNQUFNLEVBQUU7b0JBQ3JDLDRGQUE0RjtvQkFDNUYsMEVBQTBFO29CQUMxRSxXQUFXLEVBQUUsSUFBSSw0QkFBZSxFQUFFO2lCQUNuQyxDQUFDO1lBQ0osQ0FBQztZQUVELE9BQU87Z0JBQ0wsTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsQ0FBQyxDQUFDO1lBQ3RFLENBQUM7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSSxNQUFNLENBQUMsYUFBYSxDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWEsRUFBRSxZQUFZLEdBQUcsd0JBQVksQ0FBQyxNQUFNLEVBQUUsRUFBRSxHQUFHLGNBQUUsQ0FBQyxLQUFLO1FBQ3hILE9BQU8sSUFBSSx1Q0FBMkIsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQ2hELEVBQUU7WUFDRixZQUFZO1lBQ1osZUFBZSxFQUFFLCtCQUFrQixDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUM7U0FDdEQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQzs7QUEvQ0gsOENBZ0RDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXdzX2VjciBhcyBlY3IgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QsIERlcGVuZGVuY3lHcm91cCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQmFzZUNvbnRhaW5lckltYWdlIH0gZnJvbSAnLi9hd3MtaW1hZ2UtYnVpbGRlci9iYXNlLWltYWdlJztcbmltcG9ydCB7IENvZGVCdWlsZFJ1bm5lckltYWdlQnVpbGRlciB9IGZyb20gJy4vY29kZWJ1aWxkJztcbmltcG9ydCB7IElSdW5uZXJJbWFnZUJ1aWxkZXIgfSBmcm9tICcuL2NvbW1vbic7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIE9zLCBSdW5uZXJBbWksIFJ1bm5lckltYWdlLCBSdW5uZXJWZXJzaW9uIH0gZnJvbSAnLi4vcHJvdmlkZXJzJztcblxuLyoqXG4gKiBIZWxwZXIgY2xhc3Mgd2l0aCBtZXRob2RzIHRvIHVzZSBzdGF0aWMgaW1hZ2VzIHRoYXQgYXJlIGJ1aWx0IG91dHNpZGUgdGhlIGNvbnRleHQgb2YgdGhpcyBwcm9qZWN0LlxuICovXG5leHBvcnQgY2xhc3MgU3RhdGljUnVubmVySW1hZ2Uge1xuICAvKipcbiAgICogQ3JlYXRlIGEgYnVpbGRlciAodGhhdCBkb2Vzbid0IGFjdHVhbGx5IGJ1aWxkIGFueXRoaW5nKSBmcm9tIGFuIGV4aXN0aW5nIGltYWdlIGluIGFuIGV4aXN0aW5nIHJlcG9zaXRvcnkuIFRoZSBpbWFnZSBtdXN0IGFscmVhZHkgaGF2ZSBHaXRIdWIgQWN0aW9ucyBydW5uZXIgaW5zdGFsbGVkLiBZb3UgYXJlIHJlc3BvbnNpYmxlIHRvIHVwZGF0ZSBpdCBhbmQgcmVtb3ZlIGl0IHdoZW4gZG9uZS5cbiAgICpcbiAgICogQHBhcmFtIHJlcG9zaXRvcnkgRUNSIHJlcG9zaXRvcnlcbiAgICogQHBhcmFtIHRhZyBpbWFnZSB0YWdcbiAgICogQHBhcmFtIGFyY2hpdGVjdHVyZSBpbWFnZSBhcmNoaXRlY3R1cmVcbiAgICogQHBhcmFtIG9zIGltYWdlIE9TXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21FY3JSZXBvc2l0b3J5KHJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeSwgdGFnOiBzdHJpbmcgPSAnbGF0ZXN0JywgYXJjaGl0ZWN0dXJlID0gQXJjaGl0ZWN0dXJlLlg4Nl82NCwgb3MgPSBPcy5MSU5VWCk6IElSdW5uZXJJbWFnZUJ1aWxkZXIge1xuICAgIHJldHVybiB7XG4gICAgICBiaW5kRG9ja2VySW1hZ2UoKTogUnVubmVySW1hZ2Uge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGltYWdlUmVwb3NpdG9yeTogcmVwb3NpdG9yeSxcbiAgICAgICAgICBpbWFnZVRhZzogdGFnLFxuICAgICAgICAgIGFyY2hpdGVjdHVyZSxcbiAgICAgICAgICBvcyxcbiAgICAgICAgICBydW5uZXJWZXJzaW9uOiBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpLFxuICAgICAgICAgIC8vIHRoZSBpbWFnZSBhbHJlYWR5IGV4aXN0cywgc28gdGhlcmUgaXMgbm90aGluZyB0byB3YWl0IGZvci4gd2Ugc3RpbGwgbmVlZCBhIGRlcGVuZGFibGUsIG9yXG4gICAgICAgICAgLy8gcHJvdmlkZXJzIHRoYXQgcmVxdWlyZSBvbmUgKGxpa2UgTGFtYmRhKSB3aWxsIHJlZnVzZSB0byB1c2UgdGhpcyBpbWFnZS5cbiAgICAgICAgICBfZGVwZW5kYWJsZTogbmV3IERlcGVuZGVuY3lHcm91cCgpLFxuICAgICAgICB9O1xuICAgICAgfSxcblxuICAgICAgYmluZEFtaSgpOiBSdW5uZXJBbWkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2Zyb21FY3JSZXBvc2l0b3J5KCkgY2Fubm90IGJlIHVzZWQgdG8gYnVpbGQgQU1JcycpO1xuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIGJ1aWxkZXIgZnJvbSBhbiBleGlzdGluZyBEb2NrZXIgSHViIGltYWdlLiBUaGUgaW1hZ2UgbXVzdCBhbHJlYWR5IGhhdmUgR2l0SHViIEFjdGlvbnMgcnVubmVyIGluc3RhbGxlZC4gWW91IGFyZSByZXNwb25zaWJsZSB0byB1cGRhdGUgaXQgYW5kIHJlbW92ZSBpdCB3aGVuIGRvbmUuXG4gICAqXG4gICAqIFdlIGNyZWF0ZSBhIENvZGVCdWlsZCBpbWFnZSBidWlsZGVyIGJlaGluZCB0aGUgc2NlbmVzIHRvIGNvcHkgdGhlIGltYWdlIG92ZXIgdG8gRUNSLiBUaGlzIGhlbHBzIGF2b2lkIERvY2tlciBIdWIgcmF0ZSBsaW1pdHMgYW5kIHByZXZlbnQgZmFpbHVyZXMuXG4gICAqXG4gICAqIEBwYXJhbSBzY29wZVxuICAgKiBAcGFyYW0gaWRcbiAgICogQHBhcmFtIGltYWdlIERvY2tlciBIdWIgaW1hZ2Ugd2l0aCBvcHRpb25hbCB0YWdcbiAgICogQHBhcmFtIGFyY2hpdGVjdHVyZSBpbWFnZSBhcmNoaXRlY3R1cmVcbiAgICogQHBhcmFtIG9zIGltYWdlIE9TXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21Eb2NrZXJIdWIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgaW1hZ2U6IHN0cmluZywgYXJjaGl0ZWN0dXJlID0gQXJjaGl0ZWN0dXJlLlg4Nl82NCwgb3MgPSBPcy5MSU5VWCk6IElSdW5uZXJJbWFnZUJ1aWxkZXIge1xuICAgIHJldHVybiBuZXcgQ29kZUJ1aWxkUnVubmVySW1hZ2VCdWlsZGVyKHNjb3BlLCBpZCwge1xuICAgICAgb3MsXG4gICAgICBhcmNoaXRlY3R1cmUsXG4gICAgICBiYXNlRG9ja2VySW1hZ2U6IEJhc2VDb250YWluZXJJbWFnZS5mcm9tU3RyaW5nKGltYWdlKSxcbiAgICB9KTtcbiAgfVxufVxuIl19