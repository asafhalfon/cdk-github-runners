"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticRunnerImage = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const base_image_1 = require("./aws-image-builder/base-image");
const codebuild_1 = require("./codebuild");
const providers_1 = require("../providers");
/**
 * Helper class with methods to use static images that are built outside the context of this project.
 */
class StaticRunnerImage {
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
                    _dependable: repository.repositoryArn,
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
_a = JSII_RTTI_SYMBOL_1;
StaticRunnerImage[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.StaticRunnerImage", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdGljLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL3N0YXRpYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUVBLCtEQUFvRTtBQUNwRSwyQ0FBMEQ7QUFFMUQsNENBQXVGO0FBRXZGOztHQUVHO0FBQ0gsTUFBYSxpQkFBaUI7SUFDNUI7Ozs7Ozs7T0FPRztJQUNJLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQyxVQUEyQixFQUFFLE1BQWMsUUFBUSxFQUFFLFlBQVksR0FBRyx3QkFBWSxDQUFDLE1BQU0sRUFBRSxFQUFFLEdBQUcsY0FBRSxDQUFDLEtBQUs7UUFDcEksT0FBTztZQUNMLGVBQWU7Z0JBQ2IsT0FBTztvQkFDTCxlQUFlLEVBQUUsVUFBVTtvQkFDM0IsUUFBUSxFQUFFLEdBQUc7b0JBQ2IsWUFBWTtvQkFDWixFQUFFO29CQUNGLGFBQWEsRUFBRSx5QkFBYSxDQUFDLE1BQU0sRUFBRTtvQkFDckMsV0FBVyxFQUFFLFVBQVUsQ0FBQyxhQUFhO2lCQUN0QyxDQUFDO1lBQ0osQ0FBQztZQUVELE9BQU87Z0JBQ0wsTUFBTSxJQUFJLEtBQUssQ0FBQyxrREFBa0QsQ0FBQyxDQUFDO1lBQ3RFLENBQUM7U0FDRixDQUFDO0lBQ0osQ0FBQztJQUVEOzs7Ozs7Ozs7O09BVUc7SUFDSSxNQUFNLENBQUMsYUFBYSxDQUFDLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWEsRUFBRSxZQUFZLEdBQUcsd0JBQVksQ0FBQyxNQUFNLEVBQUUsRUFBRSxHQUFHLGNBQUUsQ0FBQyxLQUFLO1FBQ3hILE9BQU8sSUFBSSx1Q0FBMkIsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFO1lBQ2hELEVBQUU7WUFDRixZQUFZO1lBQ1osZUFBZSxFQUFFLCtCQUFrQixDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUM7U0FDdEQsQ0FBQyxDQUFDO0lBQ0wsQ0FBQzs7QUE3Q0gsOENBOENDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgYXdzX2VjciBhcyBlY3IgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEJhc2VDb250YWluZXJJbWFnZSB9IGZyb20gJy4vYXdzLWltYWdlLWJ1aWxkZXIvYmFzZS1pbWFnZSc7XG5pbXBvcnQgeyBDb2RlQnVpbGRSdW5uZXJJbWFnZUJ1aWxkZXIgfSBmcm9tICcuL2NvZGVidWlsZCc7XG5pbXBvcnQgeyBJUnVubmVySW1hZ2VCdWlsZGVyIH0gZnJvbSAnLi9jb21tb24nO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBPcywgUnVubmVyQW1pLCBSdW5uZXJJbWFnZSwgUnVubmVyVmVyc2lvbiB9IGZyb20gJy4uL3Byb3ZpZGVycyc7XG5cbi8qKlxuICogSGVscGVyIGNsYXNzIHdpdGggbWV0aG9kcyB0byB1c2Ugc3RhdGljIGltYWdlcyB0aGF0IGFyZSBidWlsdCBvdXRzaWRlIHRoZSBjb250ZXh0IG9mIHRoaXMgcHJvamVjdC5cbiAqL1xuZXhwb3J0IGNsYXNzIFN0YXRpY1J1bm5lckltYWdlIHtcbiAgLyoqXG4gICAqIENyZWF0ZSBhIGJ1aWxkZXIgKHRoYXQgZG9lc24ndCBhY3R1YWxseSBidWlsZCBhbnl0aGluZykgZnJvbSBhbiBleGlzdGluZyBpbWFnZSBpbiBhbiBleGlzdGluZyByZXBvc2l0b3J5LiBUaGUgaW1hZ2UgbXVzdCBhbHJlYWR5IGhhdmUgR2l0SHViIEFjdGlvbnMgcnVubmVyIGluc3RhbGxlZC4gWW91IGFyZSByZXNwb25zaWJsZSB0byB1cGRhdGUgaXQgYW5kIHJlbW92ZSBpdCB3aGVuIGRvbmUuXG4gICAqXG4gICAqIEBwYXJhbSByZXBvc2l0b3J5IEVDUiByZXBvc2l0b3J5XG4gICAqIEBwYXJhbSB0YWcgaW1hZ2UgdGFnXG4gICAqIEBwYXJhbSBhcmNoaXRlY3R1cmUgaW1hZ2UgYXJjaGl0ZWN0dXJlXG4gICAqIEBwYXJhbSBvcyBpbWFnZSBPU1xuICAgKi9cbiAgcHVibGljIHN0YXRpYyBmcm9tRWNyUmVwb3NpdG9yeShyZXBvc2l0b3J5OiBlY3IuSVJlcG9zaXRvcnksIHRhZzogc3RyaW5nID0gJ2xhdGVzdCcsIGFyY2hpdGVjdHVyZSA9IEFyY2hpdGVjdHVyZS5YODZfNjQsIG9zID0gT3MuTElOVVgpOiBJUnVubmVySW1hZ2VCdWlsZGVyIHtcbiAgICByZXR1cm4ge1xuICAgICAgYmluZERvY2tlckltYWdlKCk6IFJ1bm5lckltYWdlIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBpbWFnZVJlcG9zaXRvcnk6IHJlcG9zaXRvcnksXG4gICAgICAgICAgaW1hZ2VUYWc6IHRhZyxcbiAgICAgICAgICBhcmNoaXRlY3R1cmUsXG4gICAgICAgICAgb3MsXG4gICAgICAgICAgcnVubmVyVmVyc2lvbjogUnVubmVyVmVyc2lvbi5sYXRlc3QoKSxcbiAgICAgICAgICBfZGVwZW5kYWJsZTogcmVwb3NpdG9yeS5yZXBvc2l0b3J5QXJuLFxuICAgICAgICB9O1xuICAgICAgfSxcblxuICAgICAgYmluZEFtaSgpOiBSdW5uZXJBbWkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2Zyb21FY3JSZXBvc2l0b3J5KCkgY2Fubm90IGJlIHVzZWQgdG8gYnVpbGQgQU1JcycpO1xuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIGJ1aWxkZXIgZnJvbSBhbiBleGlzdGluZyBEb2NrZXIgSHViIGltYWdlLiBUaGUgaW1hZ2UgbXVzdCBhbHJlYWR5IGhhdmUgR2l0SHViIEFjdGlvbnMgcnVubmVyIGluc3RhbGxlZC4gWW91IGFyZSByZXNwb25zaWJsZSB0byB1cGRhdGUgaXQgYW5kIHJlbW92ZSBpdCB3aGVuIGRvbmUuXG4gICAqXG4gICAqIFdlIGNyZWF0ZSBhIENvZGVCdWlsZCBpbWFnZSBidWlsZGVyIGJlaGluZCB0aGUgc2NlbmVzIHRvIGNvcHkgdGhlIGltYWdlIG92ZXIgdG8gRUNSLiBUaGlzIGhlbHBzIGF2b2lkIERvY2tlciBIdWIgcmF0ZSBsaW1pdHMgYW5kIHByZXZlbnQgZmFpbHVyZXMuXG4gICAqXG4gICAqIEBwYXJhbSBzY29wZVxuICAgKiBAcGFyYW0gaWRcbiAgICogQHBhcmFtIGltYWdlIERvY2tlciBIdWIgaW1hZ2Ugd2l0aCBvcHRpb25hbCB0YWdcbiAgICogQHBhcmFtIGFyY2hpdGVjdHVyZSBpbWFnZSBhcmNoaXRlY3R1cmVcbiAgICogQHBhcmFtIG9zIGltYWdlIE9TXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGZyb21Eb2NrZXJIdWIoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgaW1hZ2U6IHN0cmluZywgYXJjaGl0ZWN0dXJlID0gQXJjaGl0ZWN0dXJlLlg4Nl82NCwgb3MgPSBPcy5MSU5VWCk6IElSdW5uZXJJbWFnZUJ1aWxkZXIge1xuICAgIHJldHVybiBuZXcgQ29kZUJ1aWxkUnVubmVySW1hZ2VCdWlsZGVyKHNjb3BlLCBpZCwge1xuICAgICAgb3MsXG4gICAgICBhcmNoaXRlY3R1cmUsXG4gICAgICBiYXNlRG9ja2VySW1hZ2U6IEJhc2VDb250YWluZXJJbWFnZS5mcm9tU3RyaW5nKGltYWdlKSxcbiAgICB9KTtcbiAgfVxufVxuIl19