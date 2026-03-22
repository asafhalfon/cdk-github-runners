"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerImageBuilder = void 0;
const JSII_RTTI_SYMBOL_1 = Symbol.for("jsii.rtti");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const aws_image_builder_1 = require("./aws-image-builder");
const codebuild_1 = require("./codebuild");
const common_1 = require("./common");
const providers_1 = require("../providers");
/**
 * GitHub Runner image builder. Builds a Docker image or AMI with GitHub Runner and other requirements installed.
 *
 * Images can be customized before passed into the provider by adding or removing components to be installed.
 *
 * Images are rebuilt every week by default to ensure that the latest security patches are applied.
 */
class RunnerImageBuilder extends common_1.RunnerImageBuilderBase {
    /**
     * Create a new image builder based on the provided properties. The implementation will differ based on the OS, architecture, and requested builder type.
     */
    static new(scope, id, props) {
        if (props?.components && props.runnerVersion) {
            aws_cdk_lib_1.Annotations.of(scope).addWarning('runnerVersion is ignored when components are specified. The runner version will be determined by the components.');
        }
        if (props?.builderType === common_1.RunnerImageBuilderType.CODE_BUILD) {
            return new codebuild_1.CodeBuildRunnerImageBuilder(scope, id, props);
        }
        else if (props?.builderType === common_1.RunnerImageBuilderType.AWS_IMAGE_BUILDER) {
            return new aws_image_builder_1.AwsImageBuilderRunnerImageBuilder(scope, id, props);
        }
        const os = props?.os ?? providers_1.Os.LINUX_UBUNTU;
        if (os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
            return new codebuild_1.CodeBuildRunnerImageBuilder(scope, id, props);
        }
        else if (os.is(providers_1.Os.WINDOWS)) {
            return new aws_image_builder_1.AwsImageBuilderRunnerImageBuilder(scope, id, props);
        }
        else {
            throw new Error(`Unable to find runner image builder implementation for ${os.name}`);
        }
    }
}
exports.RunnerImageBuilder = RunnerImageBuilder;
_a = JSII_RTTI_SYMBOL_1;
RunnerImageBuilder[_a] = { fqn: "@cloudsnorkel/cdk-github-runners.RunnerImageBuilder", version: "0.0.0" };
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2FwaS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLDZDQUEwQztBQUUxQywyREFBd0U7QUFDeEUsMkNBQTBEO0FBQzFELHFDQUFvSTtBQUNwSSw0Q0FBa0M7QUFFbEM7Ozs7OztHQU1HO0FBQ0gsTUFBc0Isa0JBQW1CLFNBQVEsK0JBQXNCO0lBQ3JFOztPQUVHO0lBQ0gsTUFBTSxDQUFDLEdBQUcsQ0FBQyxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUErQjtRQUN0RSxJQUFJLEtBQUssRUFBRSxVQUFVLElBQUksS0FBSyxDQUFDLGFBQWEsRUFBRSxDQUFDO1lBQzdDLHlCQUFXLENBQUMsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLFVBQVUsQ0FBQyxrSEFBa0gsQ0FBQyxDQUFDO1FBQ3ZKLENBQUM7UUFFRCxJQUFJLEtBQUssRUFBRSxXQUFXLEtBQUssK0JBQXNCLENBQUMsVUFBVSxFQUFFLENBQUM7WUFDN0QsT0FBTyxJQUFJLHVDQUEyQixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0QsQ0FBQzthQUFNLElBQUksS0FBSyxFQUFFLFdBQVcsS0FBSywrQkFBc0IsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQzNFLE9BQU8sSUFBSSxxREFBaUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ2pFLENBQUM7UUFFRCxNQUFNLEVBQUUsR0FBRyxLQUFLLEVBQUUsRUFBRSxJQUFJLGNBQUUsQ0FBQyxZQUFZLENBQUM7UUFDeEMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLGNBQUUsQ0FBQyxtQkFBbUIsQ0FBQyxFQUFFLENBQUM7WUFDcEMsT0FBTyxJQUFJLHVDQUEyQixDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDM0QsQ0FBQzthQUFNLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxjQUFFLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUM3QixPQUFPLElBQUkscURBQWlDLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNqRSxDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sSUFBSSxLQUFLLENBQUMsMERBQTBELEVBQUUsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBQ3ZGLENBQUM7SUFDSCxDQUFDOztBQXZCSCxnREF3QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBBbm5vdGF0aW9ucyB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyIH0gZnJvbSAnLi9hd3MtaW1hZ2UtYnVpbGRlcic7XG5pbXBvcnQgeyBDb2RlQnVpbGRSdW5uZXJJbWFnZUJ1aWxkZXIgfSBmcm9tICcuL2NvZGVidWlsZCc7XG5pbXBvcnQgeyBJQ29uZmlndXJhYmxlUnVubmVySW1hZ2VCdWlsZGVyLCBSdW5uZXJJbWFnZUJ1aWxkZXJCYXNlLCBSdW5uZXJJbWFnZUJ1aWxkZXJQcm9wcywgUnVubmVySW1hZ2VCdWlsZGVyVHlwZSB9IGZyb20gJy4vY29tbW9uJztcbmltcG9ydCB7IE9zIH0gZnJvbSAnLi4vcHJvdmlkZXJzJztcblxuLyoqXG4gKiBHaXRIdWIgUnVubmVyIGltYWdlIGJ1aWxkZXIuIEJ1aWxkcyBhIERvY2tlciBpbWFnZSBvciBBTUkgd2l0aCBHaXRIdWIgUnVubmVyIGFuZCBvdGhlciByZXF1aXJlbWVudHMgaW5zdGFsbGVkLlxuICpcbiAqIEltYWdlcyBjYW4gYmUgY3VzdG9taXplZCBiZWZvcmUgcGFzc2VkIGludG8gdGhlIHByb3ZpZGVyIGJ5IGFkZGluZyBvciByZW1vdmluZyBjb21wb25lbnRzIHRvIGJlIGluc3RhbGxlZC5cbiAqXG4gKiBJbWFnZXMgYXJlIHJlYnVpbHQgZXZlcnkgd2VlayBieSBkZWZhdWx0IHRvIGVuc3VyZSB0aGF0IHRoZSBsYXRlc3Qgc2VjdXJpdHkgcGF0Y2hlcyBhcmUgYXBwbGllZC5cbiAqL1xuZXhwb3J0IGFic3RyYWN0IGNsYXNzIFJ1bm5lckltYWdlQnVpbGRlciBleHRlbmRzIFJ1bm5lckltYWdlQnVpbGRlckJhc2Uge1xuICAvKipcbiAgICogQ3JlYXRlIGEgbmV3IGltYWdlIGJ1aWxkZXIgYmFzZWQgb24gdGhlIHByb3ZpZGVkIHByb3BlcnRpZXMuIFRoZSBpbXBsZW1lbnRhdGlvbiB3aWxsIGRpZmZlciBiYXNlZCBvbiB0aGUgT1MsIGFyY2hpdGVjdHVyZSwgYW5kIHJlcXVlc3RlZCBidWlsZGVyIHR5cGUuXG4gICAqL1xuICBzdGF0aWMgbmV3KHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogUnVubmVySW1hZ2VCdWlsZGVyUHJvcHMpOiBJQ29uZmlndXJhYmxlUnVubmVySW1hZ2VCdWlsZGVyIHtcbiAgICBpZiAocHJvcHM/LmNvbXBvbmVudHMgJiYgcHJvcHMucnVubmVyVmVyc2lvbikge1xuICAgICAgQW5ub3RhdGlvbnMub2Yoc2NvcGUpLmFkZFdhcm5pbmcoJ3J1bm5lclZlcnNpb24gaXMgaWdub3JlZCB3aGVuIGNvbXBvbmVudHMgYXJlIHNwZWNpZmllZC4gVGhlIHJ1bm5lciB2ZXJzaW9uIHdpbGwgYmUgZGV0ZXJtaW5lZCBieSB0aGUgY29tcG9uZW50cy4nKTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHM/LmJ1aWxkZXJUeXBlID09PSBSdW5uZXJJbWFnZUJ1aWxkZXJUeXBlLkNPREVfQlVJTEQpIHtcbiAgICAgIHJldHVybiBuZXcgQ29kZUJ1aWxkUnVubmVySW1hZ2VCdWlsZGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuICAgIH0gZWxzZSBpZiAocHJvcHM/LmJ1aWxkZXJUeXBlID09PSBSdW5uZXJJbWFnZUJ1aWxkZXJUeXBlLkFXU19JTUFHRV9CVUlMREVSKSB7XG4gICAgICByZXR1cm4gbmV3IEF3c0ltYWdlQnVpbGRlclJ1bm5lckltYWdlQnVpbGRlcihzY29wZSwgaWQsIHByb3BzKTtcbiAgICB9XG5cbiAgICBjb25zdCBvcyA9IHByb3BzPy5vcyA/PyBPcy5MSU5VWF9VQlVOVFU7XG4gICAgaWYgKG9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgIHJldHVybiBuZXcgQ29kZUJ1aWxkUnVubmVySW1hZ2VCdWlsZGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuICAgIH0gZWxzZSBpZiAob3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHJldHVybiBuZXcgQXdzSW1hZ2VCdWlsZGVyUnVubmVySW1hZ2VCdWlsZGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuYWJsZSB0byBmaW5kIHJ1bm5lciBpbWFnZSBidWlsZGVyIGltcGxlbWVudGF0aW9uIGZvciAke29zLm5hbWV9YCk7XG4gICAgfVxuICB9XG59XG4iXX0=