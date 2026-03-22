"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageBuilderBase = void 0;
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const constructs_1 = require("constructs");
const providers_1 = require("../../../providers");
const common_1 = require("../../common");
/**
 * @internal
 */
class ImageBuilderBase extends constructs_1.Construct {
    constructor(scope, id, props) {
        super(scope, id);
        this.components = [];
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
        if (this.rebuildInterval.toDays() > 0) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tbW9uLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2RlcHJlY2F0ZWQvY29tbW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFtQztBQUNuQyw2Q0FBc0o7QUFDdEosMkNBQXVDO0FBQ3ZDLGtEQUE2RjtBQUM3Rix5Q0FBa0c7QUFHbEc7O0dBRUc7QUFDSCxNQUFzQixnQkFBaUIsU0FBUSxzQkFBUztJQW9CdEQsWUFBc0IsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBNEI7UUFDOUUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQztRQVpULGVBQVUsR0FBNEIsRUFBRSxDQUFDO1FBY2pELE9BQU87UUFDUCxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssRUFBRSxZQUFZLElBQUksd0JBQVksQ0FBQyxNQUFNLENBQUM7UUFDL0QsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQyxFQUFFLENBQUM7WUFDMUQsTUFBTSxJQUFJLEtBQUssQ0FBQyw2QkFBNkIsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLCtDQUErQyxDQUFDLENBQUM7UUFDdEgsQ0FBQztRQUVELEtBQUs7UUFDTCxJQUFJLENBQUMsRUFBRSxHQUFHLEtBQUssRUFBRSxFQUFFLElBQUksY0FBRSxDQUFDLEtBQUssQ0FBQztRQUNoQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLFdBQVcsQ0FBQyxFQUFFLENBQUM7WUFDckMsTUFBTSxJQUFJLEtBQUssQ0FBQyxtQkFBbUIsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDO1FBQ3RELENBQUM7UUFFRCxXQUFXO1FBQ1gsSUFBSSxJQUFJLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxjQUFF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SSxDQUFDO1lBQ2xDLFdBQVcsRUFBRSxJQUFJLENBQUMsV0FBVztZQUM3Qiw4QkFBOEIsRUFBRSxLQUFLLENBQUMsT0FBTztZQUM3Qyw0QkFBNEIsRUFBRSxJQUFJLENBQUMsT0FBTztZQUMxQyxjQUFjO1lBQ2Qsa0JBQWtCO1lBQ2xCLFFBQVEsRUFBRSxlQUFlO1lBQ3pCLHVCQUF1QixFQUFFO2dCQUN2QixpQkFBaUIsRUFBRSxLQUFLO2FBQ3pCO1NBQ0YsQ0FBQyxDQUFDO1FBQ0gsUUFBUSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDbkMsUUFBUSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxDQUFDLENBQUM7UUFFakMsT0FBTyxRQUFRLENBQUM7SUFDbEIsQ0FBQztJQUVEOztPQUVHO0lBQ0gsSUFBVyxXQUFXO1FBQ3BCLE9BQU8sSUFBSSxxQkFBRyxDQUFDLFdBQVcsQ0FBQyxFQUFFLGNBQWMsRUFBRSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUMsQ0FBQztJQUN0RSxDQUFDO0NBS0Y7QUF6S0QsNENBeUtDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IGF3c19lYzIgYXMgZWMyLCBhd3NfZXZlbnRzIGFzIGV2ZW50cywgYXdzX2lhbSBhcyBpYW0sIGF3c19pbWFnZWJ1aWxkZXIgYXMgaW1hZ2VidWlsZGVyLCBhd3NfbG9ncyBhcyBsb2dzLCBSZW1vdmFsUG9saWN5IH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBBcmNoaXRlY3R1cmUsIE9zLCBSdW5uZXJBbWksIFJ1bm5lckltYWdlLCBSdW5uZXJWZXJzaW9uIH0gZnJvbSAnLi4vLi4vLi4vcHJvdmlkZXJzJztcbmltcG9ydCB7IEltYWdlQnVpbGRlckJhc2VQcm9wcywgSVJ1bm5lckltYWdlQnVpbGRlciwgdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSB9IGZyb20gJy4uLy4uL2NvbW1vbic7XG5pbXBvcnQgeyBJbWFnZUJ1aWxkZXJDb21wb25lbnQgfSBmcm9tICcuLi9idWlsZGVyJztcblxuLyoqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGFic3RyYWN0IGNsYXNzIEltYWdlQnVpbGRlckJhc2UgZXh0ZW5kcyBDb25zdHJ1Y3QgaW1wbGVtZW50cyBJUnVubmVySW1hZ2VCdWlsZGVyIHtcbiAgcHJvdGVjdGVkIHJlYWRvbmx5IGFyY2hpdGVjdHVyZTogQXJjaGl0ZWN0dXJlO1xuICBwcm90ZWN0ZWQgcmVhZG9ubHkgb3M6IE9zO1xuICBwcm90ZWN0ZWQgcmVhZG9ubHkgcGxhdGZvcm06ICdXaW5kb3dzJyB8ICdMaW51eCc7XG5cbiAgcHJvdGVjdGVkIHJlYWRvbmx5IGRlc2NyaXB0aW9uOiBzdHJpbmc7XG5cbiAgcHJvdGVjdGVkIHJlYWRvbmx5IHJ1bm5lclZlcnNpb246IFJ1bm5lclZlcnNpb247XG5cbiAgcHJvdGVjdGVkIGNvbXBvbmVudHM6IEltYWdlQnVpbGRlckNvbXBvbmVudFtdID0gW107XG5cbiAgcHJpdmF0ZSByZWFkb25seSB2cGM6IGVjMi5JVnBjO1xuICBwcml2YXRlIHJlYWRvbmx5IHN1Ym5ldElkOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VjdXJpdHlHcm91cHM6IGVjMi5JU2VjdXJpdHlHcm91cFtdO1xuICBwcml2YXRlIHJlYWRvbmx5IGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZTtcblxuICBwcml2YXRlIHJlYWRvbmx5IHJlYnVpbGRJbnRlcnZhbDogY2RrLkR1cmF0aW9uO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZ1JlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5O1xuXG4gIHByb3RlY3RlZCBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogSW1hZ2VCdWlsZGVyQmFzZVByb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIC8vIGFyY2hcbiAgICB0aGlzLmFyY2hpdGVjdHVyZSA9IHByb3BzPy5hcmNoaXRlY3R1cmUgPz8gQXJjaGl0ZWN0dXJlLlg4Nl82NDtcbiAgICBpZiAoIXRoaXMuYXJjaGl0ZWN0dXJlLmlzSW4ocHJvcHMuc3VwcG9ydGVkQXJjaGl0ZWN0dXJlcykpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgYXJjaGl0ZWN0dXJlOiAke3RoaXMuYXJjaGl0ZWN0dXJlLm5hbWV9LiBDb25zaWRlciBDb2RlQnVpbGQgZm9yIGZhc3RlciBpbWFnZSBidWlsZHMuYCk7XG4gICAgfVxuXG4gICAgLy8gb3NcbiAgICB0aGlzLm9zID0gcHJvcHM/Lm9zID8/IE9zLkxJTlVYO1xuICAgIGlmICghdGhpcy5vcy5pc0luKHByb3BzLnN1cHBvcnRlZE9zKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBPUzogJHt0aGlzLm9zLm5hbWV9LmApO1xuICAgIH1cblxuICAgIC8vIHBsYXRmb3JtXG4gICAgaWYgKHRoaXMub3MuaXMoT3MuV0lORE9XUykpIHtcbiAgICAgIHRoaXMucGxhdGZvcm0gPSAnV2luZG93cyc7XG4gICAgfSBlbHNlIGlmICh0aGlzLm9zLmlzSW4oT3MuX0FMTF9MSU5VWF9WRVJTSU9OUykpIHtcbiAgICAgIHRoaXMucGxhdGZvcm0gPSAnTGludXgnO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIE9TOiAke3RoaXMub3MubmFtZX0uYCk7XG4gICAgfVxuXG4gICAgLy8gYnVpbGRlciBvcHRpb25zXG4gICAgdGhpcy5yZWJ1aWxkSW50ZXJ2YWwgPSBwcm9wcz8ucmVidWlsZEludGVydmFsID8/IGNkay5EdXJhdGlvbi5kYXlzKDcpO1xuXG4gICAgLy8gdnBjIHNldHRpbmdzXG4gICAgaWYgKHByb3BzPy52cGMpIHtcbiAgICAgIHRoaXMudnBjID0gcHJvcHMudnBjO1xuICAgICAgdGhpcy5zdWJuZXRJZCA9IHByb3BzLnZwYy5zZWxlY3RTdWJuZXRzKHByb3BzLnN1Ym5ldFNlbGVjdGlvbikuc3VibmV0SWRzWzBdO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnZwYyA9IGVjMi5WcGMuZnJvbUxvb2t1cCh0aGlzLCAnRGVmYXVsdCBWUEMnLCB7IGlzRGVmYXVsdDogdHJ1ZSB9KTtcbiAgICB9XG5cbiAgICBpZiAocHJvcHM/LnNlY3VyaXR5R3JvdXBzKSB7XG4gICAgICB0aGlzLnNlY3VyaXR5R3JvdXBzID0gcHJvcHMuc2VjdXJpdHlHcm91cHM7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc2VjdXJpdHlHcm91cHMgPSBbbmV3IGVjMi5TZWN1cml0eUdyb3VwKHRoaXMsICdTRycsIHsgdnBjOiB0aGlzLnZwYyB9KV07XG4gICAgfVxuXG4gICAgLy8gaW5zdGFuY2UgdHlwZVxuICAgIHRoaXMuaW5zdGFuY2VUeXBlID0gcHJvcHM/Lmluc3RhbmNlVHlwZSA/PyBlYzIuSW5zdGFuY2VUeXBlLm9mKGVjMi5JbnN0YW5jZUNsYXNzLk02SSwgZWMyLkluc3RhbmNlU2l6ZS5MQVJHRSk7XG4gICAgaWYgKCF0aGlzLmFyY2hpdGVjdHVyZS5pbnN0YW5jZVR5cGVNYXRjaCh0aGlzLmluc3RhbmNlVHlwZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQnVpbGRlciBhcmNoaXRlY3R1cmUgKCR7dGhpcy5hcmNoaXRlY3R1cmUubmFtZX0pIGRvZXNuJ3QgbWF0Y2ggc2VsZWN0ZWQgaW5zdGFuY2UgdHlwZSAoJHt0aGlzLmluc3RhbmNlVHlwZX0gLyAke3RoaXMuaW5zdGFuY2VUeXBlLmFyY2hpdGVjdHVyZX0pYCk7XG4gICAgfVxuXG4gICAgLy8gbG9nIHNldHRpbmdzXG4gICAgdGhpcy5sb2dSZXRlbnRpb24gPSBwcm9wcz8ubG9nUmV0ZW50aW9uID8/IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEg7XG4gICAgdGhpcy5sb2dSZW1vdmFsUG9saWN5ID0gcHJvcHM/LmxvZ1JlbW92YWxQb2xpY3kgPz8gUmVtb3ZhbFBvbGljeS5ERVNUUk9ZO1xuXG4gICAgLy8gcnVubmVyIHZlcnNpb25cbiAgICB0aGlzLnJ1bm5lclZlcnNpb24gPSBwcm9wcz8ucnVubmVyVmVyc2lvbiA/PyBSdW5uZXJWZXJzaW9uLmxhdGVzdCgpO1xuXG4gICAgLy8gZGVzY3JpcHRpb25cbiAgICB0aGlzLmRlc2NyaXB0aW9uID0gYEJ1aWxkICR7cHJvcHMuaW1hZ2VUeXBlTmFtZX0gZm9yIEdpdEh1YiBBY3Rpb25zIHJ1bm5lciAke3RoaXMubm9kZS5wYXRofSAoJHt0aGlzLm9zLm5hbWV9LyR7dGhpcy5hcmNoaXRlY3R1cmUubmFtZX0pYDtcbiAgfVxuXG4gIHByb3RlY3RlZCBjcmVhdGVMb2cocmVjaXBlTmFtZTogc3RyaW5nKTogbG9ncy5Mb2dHcm91cCB7XG4gICAgcmV0dXJuIG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdMb2cnLCB7XG4gICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2ltYWdlYnVpbGRlci8ke3JlY2lwZU5hbWV9YCxcbiAgICAgIHJldGVudGlvbjogdGhpcy5sb2dSZXRlbnRpb24sXG4gICAgICByZW1vdmFsUG9saWN5OiB0aGlzLmxvZ1JlbW92YWxQb2xpY3ksXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgY3JlYXRlSW5mcmFzdHJ1Y3R1cmUobWFuYWdlZFBvbGljaWVzOiBpYW0uSU1hbmFnZWRQb2xpY3lbXSk6IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24ge1xuICAgIGxldCByb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2VjMi5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IG1hbmFnZWRQb2xpY2llcyxcbiAgICB9KTtcblxuICAgIGZvciAoY29uc3QgY29tcG9uZW50IG9mIHRoaXMuY29tcG9uZW50cykge1xuICAgICAgY29tcG9uZW50LmdyYW50QXNzZXRzUmVhZChyb2xlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24odGhpcywgJ0luZnJhc3RydWN0dXJlJywge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxuICAgICAgc3VibmV0SWQ6IHRoaXMuc3VibmV0SWQsXG4gICAgICBzZWN1cml0eUdyb3VwSWRzOiB0aGlzLnNlY3VyaXR5R3JvdXBzLm1hcChzZyA9PiBzZy5zZWN1cml0eUdyb3VwSWQpLFxuICAgICAgaW5zdGFuY2VUeXBlczogW3RoaXMuaW5zdGFuY2VUeXBlLnRvU3RyaW5nKCldLFxuICAgICAgaW5zdGFuY2VNZXRhZGF0YU9wdGlvbnM6IHtcbiAgICAgICAgaHR0cFRva2VuczogJ3JlcXVpcmVkJyxcbiAgICAgICAgLy8gQ29udGFpbmVyIGJ1aWxkcyByZXF1aXJlIGEgbWluaW11bSBvZiB0d28gaG9wcy5cbiAgICAgICAgaHR0cFB1dFJlc3BvbnNlSG9wTGltaXQ6IDIsXG4gICAgICB9LFxuICAgICAgaW5zdGFuY2VQcm9maWxlTmFtZTogbmV3IGlhbS5DZm5JbnN0YW5jZVByb2ZpbGUodGhpcywgJ0luc3RhbmNlIFByb2ZpbGUnLCB7XG4gICAgICAgIHJvbGVzOiBbXG4gICAgICAgICAgcm9sZS5yb2xlTmFtZSxcbiAgICAgICAgXSxcbiAgICAgIH0pLnJlZixcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBjcmVhdGVJbWFnZShpbmZyYTogaW1hZ2VidWlsZGVyLkNmbkluZnJhc3RydWN0dXJlQ29uZmlndXJhdGlvbiwgZGlzdDogaW1hZ2VidWlsZGVyLkNmbkRpc3RyaWJ1dGlvbkNvbmZpZ3VyYXRpb24sIGxvZzogbG9ncy5Mb2dHcm91cCxcbiAgICBpbWFnZVJlY2lwZUFybj86IHN0cmluZywgY29udGFpbmVyUmVjaXBlQXJuPzogc3RyaW5nKTogaW1hZ2VidWlsZGVyLkNmbkltYWdlIHtcbiAgICBjb25zdCBpbWFnZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2UodGhpcywgJ0ltYWdlJywge1xuICAgICAgaW5mcmFzdHJ1Y3R1cmVDb25maWd1cmF0aW9uQXJuOiBpbmZyYS5hdHRyQXJuLFxuICAgICAgZGlzdHJpYnV0aW9uQ29uZmlndXJhdGlvbkFybjogZGlzdC5hdHRyQXJuLFxuICAgICAgaW1hZ2VSZWNpcGVBcm4sXG4gICAgICBjb250YWluZXJSZWNpcGVBcm4sXG4gICAgICBpbWFnZVRlc3RzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBpbWFnZVRlc3RzRW5hYmxlZDogZmFsc2UsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIGltYWdlLm5vZGUuYWRkRGVwZW5kZW5jeShpbmZyYSk7XG4gICAgaW1hZ2Uubm9kZS5hZGREZXBlbmRlbmN5KGxvZyk7XG5cbiAgICByZXR1cm4gaW1hZ2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgY3JlYXRlUGlwZWxpbmUoaW5mcmE6IGltYWdlYnVpbGRlci5DZm5JbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb24sIGRpc3Q6IGltYWdlYnVpbGRlci5DZm5EaXN0cmlidXRpb25Db25maWd1cmF0aW9uLCBsb2c6IGxvZ3MuTG9nR3JvdXAsXG4gICAgaW1hZ2VSZWNpcGVBcm4/OiBzdHJpbmcsIGNvbnRhaW5lclJlY2lwZUFybj86IHN0cmluZyk6IGltYWdlYnVpbGRlci5DZm5JbWFnZVBpcGVsaW5lIHtcbiAgICBsZXQgc2NoZWR1bGVPcHRpb25zOiBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VQaXBlbGluZS5TY2hlZHVsZVByb3BlcnR5IHwgdW5kZWZpbmVkO1xuICAgIGlmICh0aGlzLnJlYnVpbGRJbnRlcnZhbC50b0RheXMoKSA+IDApIHtcbiAgICAgIHNjaGVkdWxlT3B0aW9ucyA9IHtcbiAgICAgICAgc2NoZWR1bGVFeHByZXNzaW9uOiBldmVudHMuU2NoZWR1bGUucmF0ZSh0aGlzLnJlYnVpbGRJbnRlcnZhbCkuZXhwcmVzc2lvblN0cmluZyxcbiAgICAgICAgcGlwZWxpbmVFeGVjdXRpb25TdGFydENvbmRpdGlvbjogJ0VYUFJFU1NJT05fTUFUQ0hfT05MWScsXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBwaXBlbGluZSA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuSW1hZ2VQaXBlbGluZSh0aGlzLCAnUGlwZWxpbmUnLCB7XG4gICAgICBuYW1lOiB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpLFxuICAgICAgZGVzY3JpcHRpb246IHRoaXMuZGVzY3JpcHRpb24sXG4gICAgICBpbmZyYXN0cnVjdHVyZUNvbmZpZ3VyYXRpb25Bcm46IGluZnJhLmF0dHJBcm4sXG4gICAgICBkaXN0cmlidXRpb25Db25maWd1cmF0aW9uQXJuOiBkaXN0LmF0dHJBcm4sXG4gICAgICBpbWFnZVJlY2lwZUFybixcbiAgICAgIGNvbnRhaW5lclJlY2lwZUFybixcbiAgICAgIHNjaGVkdWxlOiBzY2hlZHVsZU9wdGlvbnMsXG4gICAgICBpbWFnZVRlc3RzQ29uZmlndXJhdGlvbjoge1xuICAgICAgICBpbWFnZVRlc3RzRW5hYmxlZDogZmFsc2UsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHBpcGVsaW5lLm5vZGUuYWRkRGVwZW5kZW5jeShpbmZyYSk7XG4gICAgcGlwZWxpbmUubm9kZS5hZGREZXBlbmRlbmN5KGxvZyk7XG5cbiAgICByZXR1cm4gcGlwZWxpbmU7XG4gIH1cblxuICAvKipcbiAgICogVGhlIG5ldHdvcmsgY29ubmVjdGlvbnMgYXNzb2NpYXRlZCB3aXRoIHRoaXMgcmVzb3VyY2UuXG4gICAqL1xuICBwdWJsaWMgZ2V0IGNvbm5lY3Rpb25zKCk6IGVjMi5Db25uZWN0aW9ucyB7XG4gICAgcmV0dXJuIG5ldyBlYzIuQ29ubmVjdGlvbnMoeyBzZWN1cml0eUdyb3VwczogdGhpcy5zZWN1cml0eUdyb3VwcyB9KTtcbiAgfVxuXG4gIGFic3RyYWN0IGJpbmREb2NrZXJJbWFnZSgpOiBSdW5uZXJJbWFnZTtcblxuICBhYnN0cmFjdCBiaW5kQW1pKCk6IFJ1bm5lckFtaTtcbn1cbiJdfQ==