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
exports.ImageBuilderBase = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const providers_1 = require("../../../providers");
const common_1 = require("../../common");
/**
 * @internal
 */
class ImageBuilderBase extends constructs_1.Construct {
    architecture;
    os;
    platform;
    description;
    runnerVersion;
    components = [];
    vpc;
    subnetId;
    securityGroups;
    instanceType;
    rebuildInterval;
    logRetention;
    logRemovalPolicy;
    constructor(scope, id, props) {
        super(scope, id);
        // arch
        this.architecture = props?.architecture ?? providers_1.Architecture.X86_64;
        if (!this.architecture.isIn(props.supportedArchitectures)) {
            throw new Error(`Unsupported architecture: ${this.architecture.name}. Consider CodeBuild for faster image builds.`);
        }
        // os
        this.os = props?.os ?? providers_1.Os.LINUX;
        if (!this.os.isIn(props.supportedOs)) {
            throw new Error(`Unsupported OS: ${this.os.name}.`);
        }
        // platform
        if (this.os.is(providers_1.Os.WINDOWS)) {
            this.platform = 'Windows';
        }
        else if (this.os.isIn(providers_1.Os._ALL_LINUX_VERSIONS)) {
            this.platform = 'Linux';
        }
        else {
            throw new Error(`Unsupported OS: ${this.os.name}.`);
        }
        // builder options
        this.rebuildInterval = props?.rebuildInterval ?? cdk.Duration.days(7);
        // vpc settings
        if (props?.vpc) {
            this.vpc = props.vpc;
            this.subnetId = props.vpc.selectSubnets(props.subnetSelection).subnetIds[0];
        }
        else {
            this.vpc = aws_cdk_lib_1.aws_ec2.Vpc.fromLookup(this, 'Default VPC', { isDefault: true });
        }
        if (props?.securityGroups) {
            this.securityGroups = props.securityGroups;
        }
        else {
            this.securityGroups = [new aws_cdk_lib_1.aws_ec2.SecurityGroup(this, 'SG', { vpc: this.vpc })];
        }
        // instance type
        this.instanceType = props?.instanceType ?? aws_cdk_lib_1.aws_ec2.InstanceType.of(aws_cdk_lib_1.aws_ec2.InstanceClass.M6I, aws_cdk_lib_1.aws_ec2.InstanceSize.LARGE);
        if (!this.architecture.instanceTypeMatch(this.instanceType)) {
            throw new Error(`Builder architecture (${this.architecture.name}) doesn't match selected instance type (${this.instanceType} / ${this.instanceType.architecture})`);
        }
        // log settings
        this.logRetention = props?.logRetention ?? aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH;
        this.logRemovalPolicy = props?.logRemovalPolicy ?? aws_cdk_lib_1.RemovalPolicy.DESTROY;
        // runner version
        this.runnerVersion = props?.runnerVersion ?? providers_1.RunnerVersion.latest();
        // description
        this.description = `Build ${props.imageTypeName} for GitHub Actions runner ${this.node.path} (${this.os.name}/${this.architecture.name})`;
    }
    createLog(recipeName) {
        return new aws_cdk_lib_1.aws_logs.LogGroup(this, 'Log', {
            logGroupName: `/aws/imagebuilder/${recipeName}`,
            retention: this.logRetention,
            removalPolicy: this.logRemovalPolicy,
        });
    }
    createInfrastructure(managedPolicies) {
        let role = new aws_cdk_lib_1.aws_iam.Role(this, 'Role', {
            assumedBy: new aws_cdk_lib_1.aws_iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: managedPolicies,
        });
        for (const component of this.components) {
            component.grantAssetsRead(role);
        }
        return new aws_cdk_lib_1.aws_imagebuilder.CfnInfrastructureConfiguration(this, 'Infrastructure', {
            name: (0, common_1.uniqueImageBuilderName)(this),
            description: this.description,
            subnetId: this.subnetId,
            securityGroupIds: this.securityGroups.map(sg => sg.securityGroupId),
            instanceTypes: [this.instanceType.toString()],
            instanceMetadataOptions: {
                httpTokens: 'required',
                // Container builds require a minimum of two hops.
                httpPutResponseHopLimit: 2,
            },
            instanceProfileName: new aws_cdk_lib_1.aws_iam.CfnInstanceProfile(this, 'Instance Profile', {
                roles: [
                    role.roleName,
                ],
            }).ref,
        });
    }
    createImage(infra, dist, log, imageRecipeArn, containerRecipeArn) {
        const image = new aws_cdk_lib_1.aws_imagebuilder.CfnImage(this, 'Image', {
            infrastructureConfigurationArn: infra.attrArn,
            distributionConfigurationArn: dist.attrArn,
            imageRecipeArn,
            containerRecipeArn,
            imageTestsConfiguration: {
                imageTestsEnabled: false,
            },
        });
        image.node.addDependency(infra);
        image.node.addDependency(log);
        return image;
    }
    createPipeline(infra, dist, log, imageRecipeArn, containerRecipeArn) {
        let scheduleOptions;
        if (this.rebuildInterval.toMilliseconds() > 0) {
            scheduleOptions = {
                scheduleExpression: aws_cdk_lib_1.aws_events.Schedule.rate(this.rebuildInterval).expressionString,
                pipelineExecutionStartCondition: 'EXPRESSION_MATCH_ONLY',
            };
        }
        const pipeline = new aws_cdk_lib_1.aws_imagebuilder.CfnImagePipeline(this, 'Pipeline', {
            name: (0, common_1.uniqueImageBuilderName)(this),
            description: this.description,
            infrastructureConfigurationArn: infra.attrArn,
            distributionConfigurationArn: dist.attrArn,
            imageRecipeArn,
            containerRecipeArn,
            schedule: scheduleOptions,
            imageTestsConfiguration: {
                imageTestsEnabled: false,
            },
        });
        pipeline.node.addDependency(infra);
        pipeline.node.addDependency(log);
        return pipeline;
    }
    /**
     * The network connections associated with this resource.
     */
    get connections() {
        return new aws_cdk_lib_1.aws_ec2.Connections({ securityGroups: this.securityGroups });
    }
}
exports.ImageBuilderBase = ImageBuilderBase;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tbW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2RlcHJlY2F0ZWQvY29tbW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyw2Q0FBc0o7QUFDdEosMkNBQXVDO0FBQ3ZDLGtEQUE2RjtBQUM3Rix5Q0FBa0c7QUFHbEc7O0dBRUc7QUFDSCxNQUFzQixnQkFBaUIsU0FBUSxzQkFBUztJQUNuQyxZQUFZLENBQWU7SUFDM0IsRUFBRSxDQUFLO0lBQ1AsUUFBUSxDQUFzQjtJQUU5QixXQUFXLENBQVM7SUFFcEIsYUFBYSxDQUFnQjtJQUV0QyxVQUFVLEdBQTRCLEVBQUUsQ0FBQztJQUVsQyxHQUFHLENBQVc7SUFDZCxRQUFRLENBQXFCO0lBQzdCLGNBQWMsQ0FBdUI7SUFDckMsWUFBWSxDQUFtQjtJQUUvQixlQUFlLENBQWU7SUFDOUIsWUFBWSxDQUFxQjtJQUNqQyxnQkFBZ0IsQ0FBb0I7SUFFckQsWUFBc0IsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBNEI7UUFDOUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQUVqQixPQUFPO1FBQ1AsSUFBSSxDQUFDLFlBQVksR0FBRyxLQUFLLEVBQUUsWUFBWSxJQUFJLHdCQUFZLENBQUMsTUFBTSxDQUFDO1FBQy9ELElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsc0JBQXNCLENBQUMsRUFBRSxDQUFDO1lBQzFELE1BQU0sSUFBSSxLQUFLLENBQUMsNkJBQTZCLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSwrQ0FBK0MsQ0FBQyxDQUFDO1FBQ3RILENBQUM7UUFFRCxLQUFLO1FBQ0wsSUFBSSxDQUFDLEVBQUUsR0FBRyxLQUFLLEVBQUUsRUFBRSxJQUFJLGNB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QkFDaEIsa0JBQWtCLEVBQUUsd0JBQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQyxnQkFBZ0I7Z0JBQy9FLCtCQUErQixFQUFFLHVCQUF1QjthQUN6RCxDQUFDO1FBQ0osQ0FBQztRQUNELE1BQU0sUUFBUSxHQUFHLElBQUksOEJBQVksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQ25FLElBQUksRUFBRSxJQUFBLCtCQUFzQixFQUFDLElBQUksQ0FBQztZQUNsQyxXQUFXLEVBQUUsSUFBSSxDQUFDLFdBQVc7WUFDN0IsOEJBQThCLEVBQUUsS0FBSyxDQUFDLE9BQU87WUFDN0MsNEJBQTRCLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDMUMsY0FBYztZQUNkLGtCQUFrQjtZQUNsQixRQUFRLEVBQUUsZUFBZTtZQUN6Qix1QkFBdUIsRUFBRTtnQkFDdkIsaUJBQWlCLEVBQUUsS0FBSzthQUN6QjtTQUNGLENBQUMsQ0FBQztRQUNILFFBQVEsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDO1FBQ25DLFFBQVEsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBRWpDLE9BQU8sUUFBUSxDQUFDO0lBQ2xCLENBQUM7SUFFRDs7T0FFRztJQUNILElBQVcsV0FBVztRQUNwQixPQUFPLElBQUkscUJBQUcsQ0FBQyxXQUFXLENBQUMsRUFBRSxjQUFjLEVBQUUsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDLENBQUM7SUFDdEUsQ0FBQztDQUtGO0FBektELDRDQXlLQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBhd3NfZWMyIGFzIGVjMiwgYXdzX2V2ZW50cyBhcyBldmVudHMsIGF3c19pYW0gYXMgaWFtLCBhd3NfaW1hZ2VidWlsZGVyIGFzIGltYWdlYnVpbGRlciwgYXdzX2xvZ3MgYXMgbG9ncywgUmVtb3ZhbFBvbGljeSB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgQXJjaGl0ZWN0dXJlLCBPcywgUnVubmVyQW1pLCBSdW5uZXJJbWFnZSwgUnVubmVyVmVyc2lvbiB9IGZyb20gJy4uLy4uLy4uL3Byb3ZpZGVycyc7XG5pbXBvcnQgeyBJbWFnZUJ1aWxkZXJCYXNlUHJvcHMsIElSdW5uZXJJbWFnZUJ1aWxkZXIsIHVuaXF1ZUltYWdlQnVpbGRlck5hbWUgfSBmcm9tICcuLi8uLi9jb21tb24nO1xuaW1wb3J0IHsgSW1hZ2VCdWlsZGVyQ29tcG9uZW50IH0gZnJvbSAnLi4vYnVpbGRlcic7XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBJbWFnZUJ1aWxkZXJCYXNlIGV4dGVuZHMgQ29uc3RydWN0IGltcGxlbWVudHMgSVJ1bm5lckltYWdlQnVpbGRlciB7XG4gIHByb3RlY3RlZCByZWFkb25seSBhcmNoaXRlY3R1cmU6IEFyY2hpdGVjdHVyZTtcbiAgcHJvdGVjdGVkIHJlYWRvbmx5IG9zOiBPcztcbiAgcHJvdGVjdGVkIHJlYWRvbmx5IHBsYXRmb3JtOiAnV2luZG93cycgfCAnTGludXgnO1xuXG4gIHByb3RlY3RlZCByZWFkb25seSBkZXNjcmlwdGlvbjogc3RyaW5nO1xuXG4gIHByb3RlY3RlZCByZWFkb25seSBydW5uZXJWZXJzaW9uOiBSdW5uZXJWZXJzaW9uO1xuXG4gIHByb3RlY3RlZCBjb21wb25lbnRzOiBJbWFnZUJ1aWxkZXJDb21wb25lbnRbXSA9IFtdO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgdnBjOiBlYzIuSVZwYztcbiAgcHJpdmF0ZSByZWFkb25seSBzdWJuZXRJZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlY3VyaXR5R3JvdXBzOiBlYzIuSVNlY3VyaXR5R3JvdXBbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBpbnN0YW5jZVR5cGU6IGVjMi5JbnN0YW5jZVR5cGU7XG5cbiAgcHJpdmF0ZSByZWFkb25seSByZWJ1aWxkSW50ZXJ2YWw6IGNkay5EdXJhdGlvbjtcbiAgcHJpdmF0ZSByZWFkb25seSBsb2dSZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cztcbiAgcHJpdmF0ZSByZWFkb25seSBsb2dSZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeTtcblxuICBwcm90ZWN0ZWQgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEltYWdlQnVpbGRlckJhc2VQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICAvLyBhcmNoXG4gICAgdGhpcy5hcmNoaXRlY3R1cmUgPSBwcm9wcz8uYXJjaGl0ZWN0dXJlID8/IEFyY2hpdGVjdHVyZS5YODZfNjQ7XG4gICAgaWYgKCF0aGlzLmFyY2hpdGVjdHVyZS5pc0luKHByb3BzLnN1cHBvcnRlZEFyY2hpdGVjdHVyZXMpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIGFyY2hpdGVjdHVyZTogJHt0aGlzLmFyY2hpdGVjdHVyZS5uYW1lfS4gQ29uc2lkZXIgQ29kZUJ1aWxkIGZvciBmYXN0ZXIgaW1hZ2UgYnVpbGRzLmApO1xuICAgIH1cblxuICAgIC8vIG9zXG4gICAgdGhpcy5vcyA9IHByb3BzPy5vcyA/PyBPcy5MSU5VWDtcbiAgICBpZiAoIXRoaXMub3MuaXNJbihwcm9wcy5zdXBwb3J0ZWRPcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgT1M6ICR7dGhpcy5vcy5uYW1lfS5gKTtcbiAgICB9XG5cbiAgICAvLyBwbGF0Zm9ybVxuICAgIGlmICh0aGlzLm9zLmlzKE9zLldJTkRPV1MpKSB7XG4gICAgICB0aGlzLnBsYXRmb3JtID0gJ1dpbmRvd3MnO1xuICAgIH0gZWxzZSBpZiAodGhpcy5vcy5pc0luKE9zLl9BTExfTElOVVhfVkVSU0lPTlMpKSB7XG4gICAgICB0aGlzLnBsYXRmb3JtID0gJ0xpbnV4JztcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBPUzogJHt0aGlzLm9zLm5hbWV9LmApO1xuICAgIH1cblxuICAgIC8vIGJ1aWxkZXIgb3B0aW9uc1xuICAgIHRoaXMucmVidWlsZEludGVydmFsID0gcHJvcHM/LnJlYnVpbGRJbnRlcnZhbCA/PyBjZGsuRHVyYXRpb24uZGF5cyg3KTtcblxuICAgIC8vIHZwYyBzZXR0aW5nc1xuICAgIGlmIChwcm9wcz8udnBjKSB7XG4gICAgICB0aGlzLnZwYyA9IHByb3BzLnZwYztcbiAgICAgIHRoaXMuc3VibmV0SWQgPSBwcm9wcy52cGMuc2VsZWN0U3VibmV0cyhwcm9wcy5zdWJuZXRTZWxlY3Rpb24pLnN1Ym5ldElkc1swXTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy52cGMgPSBlYzIuVnBjLmZyb21Mb29rdXAodGhpcywgJ0RlZmF1bHQgVlBDJywgeyBpc0RlZmF1bHQ6IHRydWUgfSk7XG4gICAgfVxuXG4gICAgaWYgKHByb3BzPy5zZWN1cml0eUdyb3Vwcykge1xuICAgICAgdGhpcy5zZWN1cml0eUdyb3VwcyA9IHByb3BzLnNlY3VyaXR5R3JvdXBzO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gW25ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnU0cnLCB7IHZwYzogdGhpcy52cGMgfSldO1xuICAgIH1cblxuICAgIC8vIGluc3RhbmNlIHR5cGVcbiAgICB0aGlzLmluc3RhbmNlVHlwZSA9IHByb3BzPy5pbnN0YW5jZVR5cGUgPz8gZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5NNkksIGVjMi5JbnN0YW5jZVNpemUuTEFSR0UpO1xuICAgIGlmICghdGhpcy5hcmNoaXRlY3R1cmUuaW5zdGFuY2VUeXBlTWF0Y2godGhpcy5pbnN0YW5jZVR5cGUpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEJ1aWxkZXIgYXJjaGl0ZWN0dXJlICgke3RoaXMuYXJjaGl0ZWN0dXJlLm5hbWV9KSBkb2Vzbid0IG1hdGNoIHNlbGVjdGVkIGluc3RhbmNlIHR5cGUgKCR7dGhpcy5pbnN0YW5jZVR5cGV9IC8gJHt0aGlzLmluc3RhbmNlVHlwZS5hcmNoaXRlY3R1cmV9KWApO1xuICAgIH1cblxuICAgIC8vIGxvZyBzZXR0aW5nc1xuICAgIHRoaXMubG9nUmV0ZW50aW9uID0gcHJvcHM/LmxvZ1JldGVudGlvbiA/PyBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRIO1xuICAgIHRoaXMubG9nUmVtb3ZhbFBvbGljeSA9IHByb3BzPy5sb2dSZW1vdmFsUG9saWN5ID8/IFJlbW92YWxQb2xpY3kuREVTVFJPWTtcblxuICAgIC8vIHJ1bm5lciB2ZXJzaW9uXG4gICAgdGhpcy5ydW5uZXJWZXJzaW9uID0gcHJvcHM/LnJ1bm5lclZlcnNpb24gPz8gUnVubmVyVmVyc2lvbi5sYXRlc3QoKTtcblxuICAgIC8vIGRlc2NyaXB0aW9uXG4gICAgdGhpcy5kZXNjcmlwdGlvbiA9IGBCdWlsZCAke3Byb3BzLmltYWdlVHlwZU5hbWV9IGZvciBHaXRIdWIgQWN0aW9ucyBydW5uZXIgJHt0aGlzLm5vZGUucGF0aH0gKCR7dGhpcy5vcy5uYW1lfS8ke3RoaXMuYXJjaGl0ZWN0dXJlLm5hbWV9KWA7XG4gIH1cblxuICBwcm90ZWN0ZWQgY3JlYXRlTG9nKHJlY2lwZU5hbWU6IHN0cmluZyk6IGxvZ3MuTG9nR3JvdXAge1xuICAgIHJldHVybiBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnTG9nJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9pbWFnZWJ1aWxkZXIvJHtyZWNpcGVOYW1lfWAsXG4gICAgICByZXRlbnRpb246IHRoaXMubG9nUmV0ZW50aW9uLFxuICAgICAgcmVtb3ZhbFBvbGljeTogdGhpcy5sb2dSZW1vdmFsUG9saWN5LFxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGNyZWF0ZUluZnJhc3RydWN0dXJlKG1hbmFnZWRQb2xpY2llczogaWFtLklNYW5hZ2VkUG9saWN5W10pOiBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uIHtcbiAgICBsZXQgcm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdlYzIuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBtYW5hZ2VkUG9saWNpZXMsXG4gICAgfSk7XG5cbiAgICBmb3IgKGNvbnN0IGNvbXBvbmVudCBvZiB0aGlzLmNvbXBvbmVudHMpIHtcbiAgICAgIGNvbXBvbmVudC5ncmFudEFzc2V0c1JlYWQocm9sZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uKHRoaXMsICdJbmZyYXN0cnVjdHVyZScsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcbiAgICAgIHN1Ym5ldElkOiB0aGlzLnN1Ym5ldElkLFxuICAgICAgc2VjdXJpdHlHcm91cElkczogdGhpcy5zZWN1cml0eUdyb3Vwcy5tYXAoc2cgPT4gc2cuc2VjdXJpdHlHcm91cElkKSxcbiAgICAgIGluc3RhbmNlVHlwZXM6IFt0aGlzLmluc3RhbmNlVHlwZS50b1N0cmluZygpXSxcbiAgICAgIGluc3RhbmNlTWV0YWRhdGFPcHRpb25zOiB7XG4gICAgICAgIGh0dHBUb2tlbnM6ICdyZXF1aXJlZCcsXG4gICAgICAgIC8vIENvbnRhaW5lciBidWlsZHMgcmVxdWlyZSBhIG1pbmltdW0gb2YgdHdvIGhvcHMuXG4gICAgICAgIGh0dHBQdXRSZXNwb25zZUhvcExpbWl0OiAyLFxuICAgICAgfSxcbiAgICAgIGluc3RhbmNlUHJvZmlsZU5hbWU6IG5ldyBpYW0uQ2ZuSW5zdGFuY2VQcm9maWxlKHRoaXMsICdJbnN0YW5jZSBQcm9maWxlJywge1xuICAgICAgICByb2xlczogW1xuICAgICAgICAgIHJvbGUucm9sZU5hbWUsXG4gICAgICAgIF0sXG4gICAgICB9KS5yZWYsXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgY3JlYXRlSW1hZ2UoaW5mcmE6IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24sIGRpc3Q6IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uLCBsb2c6IGxvZ3MuTG9nR3JvdXAsXG4gICAgaW1hZ2VSZWNpcGVBcm4/OiBzdHJpbmcsIGNvbnRhaW5lclJlY2lwZUFybj86IHN0cmluZyk6IGltYWdlYnVpbGRlci5DZm5JbWFnZSB7XG4gICAgY29uc3QgaW1hZ2UgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbkltYWdlKHRoaXMsICdJbWFnZScsIHtcbiAgICAgIGluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbkFybjogaW5mcmEuYXR0ckFybixcbiAgICAgIGRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb25Bcm46IGRpc3QuYXR0ckFybixcbiAgICAgIGltYWdlUmVjaXBlQXJuLFxuICAgICAgY29udGFpbmVyUmVjaXBlQXJuLFxuICAgICAgaW1hZ2VUZXN0c0NvbmZpZ3VyYXRpb246IHtcbiAgICAgICAgaW1hZ2VUZXN0c0VuYWJsZWQ6IGZhbHNlLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBpbWFnZS5ub2RlLmFkZERlcGVuZGVuY3koaW5mcmEpO1xuICAgIGltYWdlLm5vZGUuYWRkRGVwZW5kZW5jeShsb2cpO1xuXG4gICAgcmV0dXJuIGltYWdlO1xuICB9XG5cbiAgcHJvdGVjdGVkIGNyZWF0ZVBpcGVsaW5lKGluZnJhOiBpbWFnZWJ1aWxkZXIuQ2ZuSW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uLCBkaXN0OiBpbWFnZWJ1aWxkZXIuQ2ZuRGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbiwgbG9nOiBsb2dzLkxvZ0dyb3VwLFxuICAgIGltYWdlUmVjaXBlQXJuPzogc3RyaW5nLCBjb250YWluZXJSZWNpcGVBcm4/OiBzdHJpbmcpOiBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VQaXBlbGluZSB7XG4gICAgbGV0IHNjaGVkdWxlT3B0aW9uczogaW1hZ2VidWlsZGVyLkNmbkltYWdlUGlwZWxpbmUuU2NoZWR1bGVQcm9wZXJ0eSB8IHVuZGVmaW5lZDtcbiAgICBpZiAodGhpcy5yZWJ1aWxkSW50ZXJ2YWwudG9NaWxsaXNlY29uZHMoKSA+IDApIHtcbiAgICAgIHNjaGVkdWxlT3B0aW9ucyA9IHtcbiAgICAgICAgc2NoZWR1bGVFeHByZXNzaW9uOiBldmVudHMuU2NoZWR1bGUucmF0ZSh0aGlzLnJlYnVpbGRJbnRlcnZhbCkuZXhwcmVzc2lvblN0cmluZyxcbiAgICAgICAgcGlwZWxpbmVFeGVjdXRpb25TdGFydENvbmRpdGlvbjogJ0VYUFJFU1NJT05fTUFUQ0hfT05MWScsXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBwaXBlbGluZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VQaXBlbGluZSh0aGlzLCAnUGlwZWxpbmUnLCB7XG4gICAgICBuYW1lOiB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpLFxuICAgICAgZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXG4gICAgICBpbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb25Bcm46IGluZnJhLmF0dHJBcm4sXG4gICAgICBkaXN0cmlidXRpb25Db25maWd1cmF0aW9uQXJuOiBkaXN0LmF0dHJBcm4sXG4gICAgICBpbWFnZVJlY2lwZUFybixcbiAgICAgIGNvbnRhaW5lclJlY2lwZUFybixcbiAgICAgIHNjaGVkdWxlOiBzY2hlZHVsZU9wdGlvbnMsXG4gICAgICBpbWFnZVRlc3RzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBpbWFnZVRlc3RzRW5hYmxlZDogZmFsc2UsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHBpcGVsaW5lLm5vZGUuYWRkRGVwZW5kZW5jeShpbmZyYSk7XG4gICAgcGlwZWxpbmUubm9kZS5hZGREZXBlbmRlbmN5KGxvZyk7XG5cbiAgICByZXR1cm4gcGlwZWxpbmU7XG4gIH1cblxuICAvKipcbiAgICogVGhlIG5ldHdvcmsgY29ubmVjdGlvbnMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcmVzb3VyY2UuXG4gICAqL1xuICBwdWJsaWMgZ2V0IGNvbm5lY3Rpb25zKCk6IGVjMi5Db25uZWN0aW9ucyB7XG4gICAgcmV0dXJuIG5ldyBlYzIuQ29ubmVjdGlvbnMoeyBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3VwcyB9KTtcbiAgfVxuXG4gIGFic3RyYWN0IGJpbmREb2NrZXJJbWFnZSgpOiBSdW5uZXJJbWFnZTtcblxuICBhYnN0cmFjdCBiaW5kQW1pKCk6IFJ1bm5lckFtaTtcbn1cbiJdfQ==