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
exports.AmiRecipe = void 0;
exports.defaultBaseAmi = defaultBaseAmi;
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const base_image_1 = require("./base-image");
const providers_1 = require("../../providers");
const common_1 = require("../common");
/**
 * Image builder recipe for Amazon Machine Image (AMI).
 *
 * @internal
 */
class AmiRecipe extends cdk.Resource {
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
        const blockDeviceMappings = props.storageSize ? [
            {
                deviceName: (0, providers_1.amiRootDevice)(this, props.baseAmi.image).ref,
                ebs: {
                    volumeSize: props.storageSize.toGibibytes(),
                    deleteOnTermination: true,
                },
            },
        ] : undefined;
        this.name = (0, common_1.uniqueImageBuilderName)(this);
        let workingDirectory;
        if (props.platform == 'Linux') {
            workingDirectory = '/home/runner';
        }
        else if (props.platform == 'Windows') {
            workingDirectory = 'C:/'; // must exist or Image Builder fails and must not be empty or git will stall installing from the default windows\system32
        }
        else {
            throw new Error(`Unsupported AMI recipe platform: ${props.platform}`);
        }
        const recipe = new aws_cdk_lib_1.aws_imagebuilder.CfnImageRecipe(this, 'Recipe', {
            name: this.name,
            version: '1.0.x',
            parentImage: props.baseAmi.image,
            components,
            workingDirectory,
            tags: props.tags,
            blockDeviceMappings,
        });
        this.arn = recipe.attrArn;
        this.version = recipe.getAtt('Version', cdk.ResolutionTypeHint.STRING).toString();
    }
}
exports.AmiRecipe = AmiRecipe;
/**
 * Default base AMI for given OS and architecture.
 *
 * @internal
 */
function defaultBaseAmi(scope, os, architecture) {
    let arch;
    if (architecture.is(providers_1.Architecture.X86_64)) {
        arch = 'x86';
    }
    else if (architecture.is(providers_1.Architecture.ARM64)) {
        arch = 'arm64';
    }
    else {
        throw new Error(`Unsupported architecture for base AMI: ${architecture.name}`);
    }
    if (os.is(providers_1.Os.LINUX_UBUNTU) || os.is(providers_1.Os.LINUX_UBUNTU_2204) || os.is(providers_1.Os.LINUX)) {
        return base_image_1.BaseImage.fromImageBuilder(scope, `ubuntu-server-22-lts-${arch}`);
    }
    if (os.is(providers_1.Os.LINUX_UBUNTU_2404)) {
        return base_image_1.BaseImage.fromImageBuilder(scope, `ubuntu-server-24-lts-${arch}`);
    }
    if (os.is(providers_1.Os.LINUX_AMAZON_2)) {
        return base_image_1.BaseImage.fromImageBuilder(scope, `amazon-linux-2-${arch}`);
    }
    if (os.is(providers_1.Os.LINUX_AMAZON_2023)) {
        return base_image_1.BaseImage.fromImageBuilder(scope, `amazon-linux-2023-${arch}`);
    }
    if (os.is(providers_1.Os.WINDOWS)) {
        return base_image_1.BaseImage.fromImageBuilder(scope, `windows-server-2022-english-full-base-${arch}`);
    }
    throw new Error(`OS ${os.name} not supported for AMI runner image`);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYW1pLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2FtaS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUF5R0Esd0NBK0JDO0FBeElELGlEQUFtQztBQUNuQyw2Q0FBK0Q7QUFFL0QsNkNBQXlDO0FBRXpDLCtDQUFrRTtBQUNsRSxzQ0FBbUQ7QUF1Q25EOzs7O0dBSUc7QUFDSCxNQUFhLFNBQVUsU0FBUSxHQUFHLENBQUMsUUFBUTtJQUN6QixHQUFHLENBQVM7SUFDWixJQUFJLENBQVM7SUFDYixPQUFPLENBQVM7SUFFaEMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUEwQjtRQUNsRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksVUFBVSxHQUFHLEtBQUssQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFO1lBQ2hELE9BQU87Z0JBQ0wsWUFBWSxFQUFFLFNBQVMsQ0FBQyxHQUFHO2FBQzVCLENBQUM7UUFDSixDQUFDLENBQUMsQ0FBQztRQUVILE1BQU0sbUJBQW1CLEdBQUcsS0FBSyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUM7WUFDOUM7Z0JBQ0UsVUFBVSxFQUFFLElBQUEseUJBQWEsRUFBQyxJQUFJLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHO2dCQUN4RCxHQUFHLEVBQUU7b0JBQ0gsVUFBVSxFQUFFLEtBQUssQ0FBQyxXQUFXLENBQUMsV0FBVyxFQUFFO29CQUMzQyxtQkFBbUIsRUFBRSxJQUFJO2lCQUMxQjthQUNGO1NBQ0YsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1FBRWQsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFBLCtCQUFzQixFQUFDLElBQUksQ0FBQyxDQUFDO1FBRXpDLElBQUks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Q0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLEVBQUUseUNBQXlDLElBQUksRUFBRSxDQUFDLENBQUM7SUFDNUYsQ0FBQztJQUVELE1BQU0sSUFBSSxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsSUFBSSxxQ0FBcUMsQ0FBQyxDQUFDO0FBQ3RFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgYXdzX2ltYWdlYnVpbGRlciBhcyBpbWFnZWJ1aWxkZXIgfSBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEJhc2VJbWFnZSB9IGZyb20gJy4vYmFzZS1pbWFnZSc7XG5pbXBvcnQgeyBJbWFnZUJ1aWxkZXJDb21wb25lbnQgfSBmcm9tICcuL2J1aWxkZXInO1xuaW1wb3J0IHsgYW1pUm9vdERldmljZSwgQXJjaGl0ZWN0dXJlLCBPcyB9IGZyb20gJy4uLy4uL3Byb3ZpZGVycyc7XG5pbXBvcnQgeyB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lIH0gZnJvbSAnLi4vY29tbW9uJztcblxuLyoqXG4gKiBQcm9wZXJ0aWVzIGZvciBBbWlSZWNpcGUgY29uc3RydWN0LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5pbnRlcmZhY2UgQW1pUmVjaXBlUHJvcGVydGllcyB7XG4gIC8qKlxuICAgKiBUYXJnZXQgcGxhdGZvcm0uIE11c3QgbWF0Y2ggYnVpbGRlciBwbGF0Zm9ybS5cbiAgICovXG4gIHJlYWRvbmx5IHBsYXRmb3JtOiAnTGludXgnIHwgJ1dpbmRvd3MnO1xuXG4gIC8qKlxuICAgKiBUYXJnZXQgYXJjaGl0ZWN0dXJlLiBNdXN0IG1hdGNoIGJ1aWxkZXIgcGxhdGZvcm0uXG4gICAqL1xuICByZWFkb25seSBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZTtcblxuICAvKipcbiAgICogQmFzZSBBTUkgdG8gdXNlIGZvciB0aGUgbmV3IHJ1bm5lciBBTUkuXG4gICAqL1xuICByZWFkb25seSBiYXNlQW1pOiBCYXNlSW1hZ2U7XG5cbiAgLyoqXG4gICAqIFN0b3JhZ2Ugc2l6ZSBmb3IgdGhlIGJ1aWxkZXIuXG4gICAqL1xuICByZWFkb25seSBzdG9yYWdlU2l6ZT86IGNkay5TaXplO1xuXG4gIC8qKlxuICAgKiBDb21wb25lbnRzIHRvIGFkZCB0byB0YXJnZXQgY29udGFpbmVyIGltYWdlLlxuICAgKi9cbiAgcmVhZG9ubHkgY29tcG9uZW50czogSW1hZ2VCdWlsZGVyQ29tcG9uZW50W107XG5cbiAgLyoqXG4gICAqIFRhZ3MgdG8gYXBwbHkgdG8gdGhlIHJlY2lwZSBhbmQgaW1hZ2UuXG4gICAqL1xuICByZWFkb25seSB0YWdzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9O1xufVxuXG4vKipcbiAqIEltYWdlIGJ1aWxkZXIgcmVjaXBlIGZvciBBbWF6b24gTWFjaGluZSBJbWFnZSAoQU1JKS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNsYXNzIEFtaVJlY2lwZSBleHRlbmRzIGNkay5SZXNvdXJjZSB7XG4gIHB1YmxpYyByZWFkb25seSBhcm46IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IHZlcnNpb246IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQW1pUmVjaXBlUHJvcGVydGllcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICBsZXQgY29tcG9uZW50cyA9IHByb3BzLmNvbXBvbmVudHMubWFwKGNvbXBvbmVudCA9PiB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBjb21wb25lbnRBcm46IGNvbXBvbmVudC5hcm4sXG4gICAgICB9O1xuICAgIH0pO1xuXG4gICAgY29uc3QgYmxvY2tEZXZpY2VNYXBwaW5ncyA9IHByb3BzLnN0b3JhZ2VTaXplID8gW1xuICAgICAge1xuICAgICAgICBkZXZpY2VOYW1lOiBhbWlSb290RGV2aWNlKHRoaXMsIHByb3BzLmJhc2VBbWkuaW1hZ2UpLnJlZixcbiAgICAgICAgZWJzOiB7XG4gICAgICAgICAgdm9sdW1lU2l6ZTogcHJvcHMuc3RvcmFnZVNpemUudG9HaWJpYnl0ZXMoKSxcbiAgICAgICAgICBkZWxldGVPblRlcm1pbmF0aW9uOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICBdIDogdW5kZWZpbmVkO1xuXG4gICAgdGhpcy5uYW1lID0gdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKTtcblxuICAgIGxldCB3b3JraW5nRGlyZWN0b3J5O1xuICAgIGlmIChwcm9wcy5wbGF0Zm9ybSA9PSAnTGludXgnKSB7XG4gICAgICB3b3JraW5nRGlyZWN0b3J5ID0gJy9ob21lL3J1bm5lcic7XG4gICAgfSBlbHNlIGlmIChwcm9wcy5wbGF0Zm9ybSA9PSAnV2luZG93cycpIHtcbiAgICAgIHdvcmtpbmdEaXJlY3RvcnkgPSAnQzovJzsgLy8gbXVzdCBleGlzdCBvciBJbWFnZSBCdWlsZGVyIGZhaWxzIGFuZCBtdXN0IG5vdCBiZSBlbXB0eSBvciBnaXQgd2lsbCBzdGFsbCBpbnN0YWxsaW5nIGZyb20gdGhlIGRlZmF1bHQgd2luZG93c1xcc3lzdGVtMzJcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBBTUkgcmVjaXBlIHBsYXRmb3JtOiAke3Byb3BzLnBsYXRmb3JtfWApO1xuICAgIH1cblxuICAgIGNvbnN0IHJlY2lwZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VSZWNpcGUodGhpcywgJ1JlY2lwZScsIHtcbiAgICAgIG5hbWU6IHRoaXMubmFtZSxcbiAgICAgIHZlcnNpb246ICcxLjAueCcsXG4gICAgICBwYXJlbnRJbWFnZTogcHJvcHMuYmFzZUFtaS5pbWFnZSxcbiAgICAgIGNvbXBvbmVudHMsXG4gICAgICB3b3JraW5nRGlyZWN0b3J5LFxuICAgICAgdGFnczogcHJvcHMudGFncyxcbiAgICAgIGJsb2NrRGV2aWNlTWFwcGluZ3MsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFybiA9IHJlY2lwZS5hdHRyQXJuO1xuICAgIHRoaXMudmVyc2lvbiA9IHJlY2lwZS5nZXRBdHQoJ1ZlcnNpb24nLCBjZGsuUmVzb2x1dGlvblR5cGVIaW50LlNUUklORykudG9TdHJpbmcoKTtcbiAgfVxufVxuXG4vKipcbiAqIERlZmF1bHQgYmFzZSBBTUkgZm9yIGdpdmVuIE9TIGFuZCBhcmNoaXRlY3R1cmUuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0QmFzZUFtaShzY29wZTogQ29uc3RydWN0LCBvczogT3MsIGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlKTogQmFzZUltYWdlIHtcbiAgbGV0IGFyY2g7XG4gIGlmIChhcmNoaXRlY3R1cmUuaXMoQXJjaGl0ZWN0dXJlLlg4Nl82NCkpIHtcbiAgICBhcmNoID0gJ3g4Nic7XG4gIH0gZWxzZSBpZiAoYXJjaGl0ZWN0dXJlLmlzKEFyY2hpdGVjdHVyZS5BUk02NCkpIHtcbiAgICBhcmNoID0gJ2FybTY0JztcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZSBmb3IgYmFzZSBBTUk6ICR7YXJjaGl0ZWN0dXJlLm5hbWV9YCk7XG4gIH1cblxuICBpZiAob3MuaXMoT3MuTElOVVhfVUJVTlRVKSB8fCBvcy5pcyhPcy5MSU5VWF9VQlVOVFVfMjIwNCkgfHwgb3MuaXMoT3MuTElOVVgpKSB7XG4gICAgcmV0dXJuIEJhc2VJbWFnZS5mcm9tSW1hZ2VCdWlsZGVyKHNjb3BlLCBgdWJ1bnR1LXNlcnZlci0yMi1sdHMtJHthcmNofWApO1xuICB9XG5cbiAgaWYgKG9zLmlzKE9zLkxJTlVYX1VCVU5UVV8yNDA0KSkge1xuICAgIHJldHVybiBCYXNlSW1hZ2UuZnJvbUltYWdlQnVpbGRlcihzY29wZSwgYHVidW50dS1zZXJ2ZXItMjQtbHRzLSR7YXJjaH1gKTtcbiAgfVxuXG4gIGlmIChvcy5pcyhPcy5MSU5VWF9BTUFaT05fMikpIHtcbiAgICByZXR1cm4gQmFzZUltYWdlLmZyb21JbWFnZUJ1aWxkZXIoc2NvcGUsIGBhbWF6b24tbGludXgtMi0ke2FyY2h9YCk7XG4gIH1cblxuICBpZiAob3MuaXMoT3MuTElOVVhfQU1BWk9OXzIwMjMpKSB7XG4gICAgcmV0dXJuIEJhc2VJbWFnZS5mcm9tSW1hZ2VCdWlsZGVyKHNjb3BlLCBgYW1hem9uLWxpbnV4LTIwMjMtJHthcmNofWApO1xuICB9XG5cbiAgaWYgKG9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgcmV0dXJuIEJhc2VJbWFnZS5mcm9tSW1hZ2VCdWlsZGVyKHNjb3BlLCBgd2luZG93cy1zZXJ2ZXItMjAyMi1lbmdsaXNoLWZ1bGwtYmFzZS0ke2FyY2h9YCk7XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYE9TICR7b3MubmFtZX0gbm90IHN1cHBvcnRlZCBmb3IgQU1JIHJ1bm5lciBpbWFnZWApO1xufVxuXG4iXX0=