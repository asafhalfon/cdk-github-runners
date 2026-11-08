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
exports.ContainerRecipe = void 0;
exports.defaultBaseDockerImage = defaultBaseDockerImage;
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const base_image_1 = require("./base-image");
const providers_1 = require("../../providers");
const common_1 = require("../common");
/**
 * Image builder recipe for a Docker container image.
 *
 * @internal
 */
class ContainerRecipe extends cdk.Resource {
    arn;
    name;
    version;
    constructor(scope, id, props) {
        super(scope, id);
        let components = props.components.map(component => {
            return {
                componentArn: component.arn,
            };
        });
        this.name = (0, common_1.uniqueImageBuilderName)(this);
        const recipe = new aws_cdk_lib_1.aws_imagebuilder.CfnContainerRecipe(this, 'Recipe', {
            name: this.name,
            version: '1.0.x',
            parentImage: props.parentImage,
            platformOverride: props.platform == 'Linux' ? 'Linux' : undefined,
            components,
            containerType: 'DOCKER',
            targetRepository: {
                service: 'ECR',
                repositoryName: props.targetRepository.repositoryName,
            },
            dockerfileTemplateData: props.dockerfileTemplate,
            tags: props.tags,
        });
        this.arn = recipe.attrArn;
        this.version = recipe.getAtt('Version', cdk.ResolutionTypeHint.STRING).toString();
    }
}
exports.ContainerRecipe = ContainerRecipe;
/**
 * Default base Docker image for given OS.
 *
 * @internal
 */
function defaultBaseDockerImage(os) {
    if (os.is(providers_1.Os.WINDOWS)) {
        return base_image_1.BaseContainerImage.fromString('mcr.microsoft.com/windows/servercore:ltsc2019-amd64');
    }
    else if (os.is(providers_1.Os.LINUX_UBUNTU) || os.is(providers_1.Os.LINUX_UBUNTU_2204)) {
        return base_image_1.BaseContainerImage.fromEcrPublic('lts', 'ubuntu', '22.04');
    }
    else if (os.is(providers_1.Os.LINUX_UBUNTU_2404)) {
        return base_image_1.BaseContainerImage.fromEcrPublic('lts', 'ubuntu', '24.04');
    }
    else if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
        return base_image_1.BaseContainerImage.fromEcrPublic('amazonlinux', 'amazonlinux', '2');
    }
    else if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
        return base_image_1.BaseContainerImage.fromEcrPublic('amazonlinux', 'amazonlinux', '2023');
    }
    else {
        throw new Error(`OS ${os.name} not supported for Docker runner image`);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29udGFpbmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2NvbnRhaW5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFtR0Esd0RBY0M7QUFqSEQsaURBQW1DO0FBQ25DLDZDQUErRTtBQUUvRSw2Q0FBa0Q7QUFFbEQsK0NBQXFDO0FBQ3JDLHNDQUFtRDtBQStDbkQ7Ozs7R0FJRztBQUNILE1BQWEsZUFBZ0IsU0FBUSxHQUFHLENBQUMsUUFBUTtJQUMvQixHQUFHLENBQVM7SUFDWixJQUFJLENBQVM7SUFDYixPQUFPLENBQVM7SUFFaEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFnQztRQUN4RSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksVUFBVSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFO1lBQ2hELE9BQU87Z0JBQ0wsWUFBWSxFQUFFLFNBQVMsQ0FBQyxHQUFHO2FBQzVCLENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBQSwrQkFBc0IsRUFBQyxJQUFJLENBQUMsQ0FBQztRQUV6QyxNQUFNLE1BQU0sR0FBRyxJQUFJLDhCQUFZLENBQUMsa0JBQWtCLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUNqRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDZixPQUFPLEVBQUUsT0FBTztZQUNoQixXQUFXLEVBQUUsS0FBSyxDQUFDLFdBQVc7WUFDOUIsZ0JBQWdCLEVBQUUsS0FBSyxDQUFDLFFBQVEsSUFBSSxPQUFPLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsU0FBUztZQUNqRSxVQUFVO1lBQ1YsYUFBYSxFQUFFLFFBQVE7WUFDdkIsZ0JBQWdCLEVBQUU7Z0JBQ2hCLE9BQU8sRUFBRSxLQUFLO2dCQUNkLGNBQWMsRUFBRSxLQUFLLENBQUMsZ0JBQWdCLENBQUMsY0FBYzthQUN0RDtZQUNELHNCQUFzQixFQUFFLEtBQUssQ0FBQyxrQkFBa0I7WUFDaEQsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1NBQ2pCLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDLE9BQU8sQ0FBQztRQUMxQixJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztJQUNwRixDQUFDO0NBQ0Y7QUFsQ0QsMENBa0NDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQWdCLHNCQUFzQixDQUFDLEVBQU07SUFDM0MsSUFBSSxFQUFFLENBQUMsRUFBRSxDQUFDLGNBQUUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1FBQ3RCLE9BQU8sK0JBQWtCLENBQUMsVUFBVSxDQUFDLHFEQUFxRCxDQUFDLENBQUM7SUFDOUYsQ0FBQztTQUFNLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxjQUFFLENBQUMsWUFBWSxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxjQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDO1FBQ2pFLE9BQU8sK0JBQWtCLENBQUMsYUFBYSxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDcEUsQ0FBQztTQUFNLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxjQUFFLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDO1FBQ3ZDLE9BQU8sK0JBQWtCLENBQUMsYUFBYSxDQUFDLEtBQUssRUFBRSxRQUFRLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDcEUsQ0FBQztTQUFNLElBQUksRUFBRSxDQUFDLEVBQUUsQ0FBQyxjQUFFLENBQUMsY0FBYyxDQUFDLEVBQUUsQ0FBQztRQUNwQyxPQUFPLCtCQUFrQixDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsYUFBYSxFQUFFLEdBQUcsQ0FBQyxDQUFDO0lBQzdFLENBQUM7U0FBTSxJQUFJLEVBQUUsQ0FBQyxFQUFFLENBQUMsY0FBRSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQztRQUN2QyxPQUFPLCtCQUFrQixDQUFDLGFBQWEsQ0FBQyxhQUFhLEVBQUUsYUFBYSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ2hGLENBQUM7U0FBTSxDQUFDO1FBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxJQUFJLHdDQUF3QyxDQUFDLENBQUM7SUFDekUsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgYXdzX2VjciBhcyBlY3IsIGF3c19pbWFnZWJ1aWxkZXIgYXMgaW1hZ2VidWlsZGVyIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBCYXNlQ29udGFpbmVySW1hZ2UgfSBmcm9tICcuL2Jhc2UtaW1hZ2UnO1xuaW1wb3J0IHsgSW1hZ2VCdWlsZGVyQ29tcG9uZW50IH0gZnJvbSAnLi9idWlsZGVyJztcbmltcG9ydCB7IE9zIH0gZnJvbSAnLi4vLi4vcHJvdmlkZXJzJztcbmltcG9ydCB7IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUgfSBmcm9tICcuLi9jb21tb24nO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIENvbnRhaW5lclJlY2lwZSBjb25zdHJ1Y3QuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29udGFpbmVyUmVjaXBlUHJvcGVydGllcyB7XG4gIC8qKlxuICAgKiBUYXJnZXQgcGxhdGZvcm0uIE11c3QgbWF0Y2ggYnVpbGRlciBwbGF0Zm9ybS5cbiAgICovXG4gIHJlYWRvbmx5IHBsYXRmb3JtOiAnTGludXgnIHwgJ1dpbmRvd3MnO1xuXG4gIC8qKlxuICAgKiBDb21wb25lbnRzIHRvIGFkZCB0byB0YXJnZXQgY29udGFpbmVyIGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgY29tcG9uZW50czogSW1hZ2VCdWlsZGVyQ29tcG9uZW50W107XG5cbiAgLyoqXG4gICAqIEVDUiByZXBvc2l0b3J5IHdoZXJlIHJlc3VsdGluZyBjb250YWluZXIgaW1hZ2Ugd2lsbCBiZSB1cGxvYWRlZC5cbiAgICovXG4gIHJlYWRvbmx5IHRhcmdldFJlcG9zaXRvcnk6IGVjci5JUmVwb3NpdG9yeTtcblxuICAvKipcbiAgICogRG9ja2VyZmlsZSB0ZW1wbGF0ZSB3aGVyZSBhbGwgdGhlIGNvbXBvbmVudHMgd2lsbCBiZSBhZGRlZC5cbiAgICpcbiAgICogTXVzdCBjb250YWluIGF0IGxlYXN0IHRoZSBmb2xsb3dpbmcgcGxhY2Vob2xkZXJzOlxuICAgKlxuICAgKiBgYGBcbiAgICogRlJPTSB7e3sgaW1hZ2VidWlsZGVyOnBhcmVudEltYWdlIH19fVxuICAgKiB7e3sgaW1hZ2VidWlsZGVyOmVudmlyb25tZW50cyB9fX1cbiAgICoge3t7IGltYWdlYnVpbGRlcjpjb21wb25lbnRzIH19fVxuICAgKiBgYGBcbiAgICovXG4gIHJlYWRvbmx5IGRvY2tlcmZpbGVUZW1wbGF0ZTogc3RyaW5nO1xuXG4gIC8qKlxuICAgKiBQYXJlbnQgaW1hZ2UgZm9yIHRoZSBuZXcgRG9ja2VyIEltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgcGFyZW50SW1hZ2U6IHN0cmluZztcblxuICAvKipcbiAgICogVGFncyB0byBhcHBseSB0byB0aGUgcmVjaXBlIGFuZCBpbWFnZS5cbiAgICovXG4gIHJlYWRvbmx5IHRhZ3M6IHsgW2tleTogc3RyaW5nXTogc3RyaW5nIH07XG59XG5cbi8qKlxuICogSW1hZ2UgYnVpbGRlciByZWNpcGUgZm9yIGEgRG9ja2VyIGNvbnRhaW5lciBpbWFnZS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNsYXNzIENvbnRhaW5lclJlY2lwZSBleHRlbmRzIGNkay5SZXNvdXJjZSB7XG4gIHB1YmxpYyByZWFkb25seSBhcm46IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IHZlcnNpb246IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQ29udGFpbmVyUmVjaXBlUHJvcGVydGllcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBsZXQgY29tcG9uZW50cyA9IHByb3BzLmNvbXBvbmVudHMubWFwKGNvbXBvbmVudCA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb21wb25lbnRBcm46IGNvbXBvbmVudC5hcm4sXG4gICAgICB9O1xuICAgIH0pO1xuXG4gICAgdGhpcy5uYW1lID0gdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKTtcblxuICAgIGNvbnN0IHJlY2lwZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuQ29udGFpbmVyUmVjaXBlKHRoaXMsICdSZWNpcGUnLCB7XG4gICAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgICB2ZXJzaW9uOiAnMS4wLngnLFxuICAgICAgcGFyZW50SW1hZ2U6IHByb3BzLnBhcmVudEltYWdlLFxuICAgICAgcGxhdGZvcm1PdmVycmlkZTogcHJvcHMucGxhdGZvcm0gPT0gJ0xpbnV4JyA/ICdMaW51eCcgOiB1bmRlZmluZWQsXG4gICAgICBjb21wb25lbnRzLFxuICAgICAgY29udGFpbmVyVHlwZTogJ0RPQ0tFUicsXG4gICAgICB0YXJnZXRSZXBvc2l0b3J5OiB7XG4gICAgICAgIHNlcnZpY2U6ICdFQ1InLFxuICAgICAgICByZXBvc2l0b3J5TmFtZTogcHJvcHMudGFyZ2V0UmVwb3NpdG9yeS5yZXBvc2l0b3J5TmFtZSxcbiAgICAgIH0sXG4gICAgICBkb2NrZXJmaWxlVGVtcGxhdGVEYXRhOiBwcm9wcy5kb2NrZXJmaWxlVGVtcGxhdGUsXG4gICAgICB0YWdzOiBwcm9wcy50YWdzLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hcm4gPSByZWNpcGUuYXR0ckFybjtcbiAgICB0aGlzLnZlcnNpb24gPSByZWNpcGUuZ2V0QXR0KCdWZXJzaW9uJywgY2RrLlJlc29sdXRpb25UeXBlSGludC5TVFJJTkcpLnRvU3RyaW5nKCk7XG4gIH1cbn1cblxuLyoqXG4gKiBEZWZhdWx0IGJhc2UgRG9ja2VyIGltYWdlIGZvciBnaXZlbiBPUy5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRCYXNlRG9ja2VySW1hZ2Uob3M6IE9zKTogQmFzZUNvbnRhaW5lckltYWdlIHtcbiAgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgcmV0dXJuIEJhc2VDb250YWluZXJJbWFnZS5mcm9tU3RyaW5nKCdtY3IubWljcm9zb2Z0LmNvbS93aW5kb3dzL3NlcnZlcmNvcmU6bHRzYzIwMTktYW1kNjQnKTtcbiAgfSBlbHNlIGlmIChvcy5pcyhPcy5MSU5VWF9VQlVOVFUpIHx8IG9zLmlzKE9zLkxJTlVYX1VCVU5UVV8yMjA0KSkge1xuICAgIHJldHVybiBCYXNlQ29udGFpbmVySW1hZ2UuZnJvbUVjclB1YmxpYygnbHRzJywgJ3VidW50dScsICcyMi4wNCcpO1xuICB9IGVsc2UgaWYgKG9zLmlzKE9zLkxJTlVYX1VCVU5UVV8yNDA0KSkge1xuICAgIHJldHVybiBCYXNlQ29udGFpbmVySW1hZ2UuZnJvbUVjclB1YmxpYygnbHRzJywgJ3VidW50dScsICcyNC4wNCcpO1xuICB9IGVsc2UgaWYgKG9zLmlzKE9zLkxJTlVYX0FNQVpPTl8yKSkge1xuICAgIHJldHVybiBCYXNlQ29udGFpbmVySW1hZ2UuZnJvbUVjclB1YmxpYygnYW1hem9ubGludXgnLCAnYW1hem9ubGludXgnLCAnMicpO1xuICB9IGVsc2UgaWYgKG9zLmlzKE9zLkxJTlVYX0FNQVpPTl8yMDIzKSkge1xuICAgIHJldHVybiBCYXNlQ29udGFpbmVySW1hZ2UuZnJvbUVjclB1YmxpYygnYW1hem9ubGludXgnLCAnYW1hem9ubGludXgnLCAnMjAyMycpO1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBFcnJvcihgT1MgJHtvcy5uYW1lfSBub3Qgc3VwcG9ydGVkIGZvciBEb2NrZXIgcnVubmVyIGltYWdlYCk7XG4gIH1cbn1cblxuIl19