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
exports.Workflow = void 0;
exports.generateBuildWorkflowWithDockerSetupCommands = generateBuildWorkflowWithDockerSetupCommands;
const cdk = __importStar(require("aws-cdk-lib"));
const aws_cdk_lib_1 = require("aws-cdk-lib");
const common_1 = require("../../providers/common");
const common_2 = require("../common");
/**
 * Image builder workflow.
 *
 * @internal
 */
class Workflow extends cdk.Resource {
    arn;
    name;
    constructor(scope, id, props) {
        super(scope, id);
        this.name = (0, common_2.uniqueImageBuilderName)(this);
        const workflow = new aws_cdk_lib_1.aws_imagebuilder.CfnWorkflow(this, 'Workflow', {
            name: (0, common_2.uniqueImageBuilderName)(this),
            version: '1.0.0',
            type: props.type,
            data: JSON.stringify(props.data),
        });
        this.arn = workflow.attrArn;
    }
}
exports.Workflow = Workflow;
/**
 * Returns a new build workflow based on arn:aws:imagebuilder:us-east-1:aws:workflow/build/build-container/1.0.1/1.
 *
 * It adds a DockerSetup step after bootstrapping but before the Docker image is built.
 *
 * @internal
 */
function generateBuildWorkflowWithDockerSetupCommands(scope, id, os, dockerSetupCommands) {
    return new Workflow(scope, id, {
        type: 'BUILD',
        data: {
            name: 'build-container',
            description: 'Workflow to build a container image',
            schemaVersion: 1,
            steps: [
                {
                    name: 'LaunchBuildInstance',
                    action: 'LaunchInstance',
                    onFailure: 'Abort',
                    inputs: {
                        waitFor: 'ssmAgent',
                    },
                },
                {
                    name: 'BootstrapBuildInstance',
                    action: 'BootstrapInstanceForContainer',
                    onFailure: 'Abort',
                    if: {
                        stringEquals: 'DOCKER',
                        value: '$.imagebuilder.imageType',
                    },
                    inputs: {
                        'instanceId.$': '$.stepOutputs.LaunchBuildInstance.instanceId',
                    },
                },
                {
                    // this is the part we add
                    name: 'DockerSetup',
                    action: 'RunCommand',
                    onFailure: 'Abort',
                    if: {
                        stringEquals: 'DOCKER',
                        value: '$.imagebuilder.imageType',
                    },
                    inputs: {
                        'documentName': os.is(common_1.Os.WINDOWS) ? 'AWS-RunPowerShellScript' : 'AWS-RunShellScript',
                        'parameters': {
                            commands: dockerSetupCommands,
                        },
                        'instanceId.$': '$.stepOutputs.LaunchBuildInstance.instanceId',
                    },
                },
                {
                    name: 'ApplyBuildComponents',
                    action: 'ExecuteComponents',
                    onFailure: 'Abort',
                    inputs: {
                        'instanceId.$': '$.stepOutputs.LaunchBuildInstance.instanceId',
                    },
                },
            ],
            outputs: [
                {
                    name: 'InstanceId',
                    value: '$.stepOutputs.LaunchBuildInstance.instanceId',
                },
            ],
        },
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2Zsb3cuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaW1hZ2UtYnVpbGRlcnMvYXdzLWltYWdlLWJ1aWxkZXIvd29ya2Zsb3cudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBdURBLG9HQThEQztBQXJIRCxpREFBbUM7QUFDbkMsNkNBQStEO0FBRS9ELG1EQUE0QztBQUM1QyxzQ0FBbUQ7QUFtQm5EOzs7O0dBSUc7QUFDSCxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsUUFBUTtJQUN4QixHQUFHLENBQVM7SUFDWixJQUFJLENBQVM7SUFFN0IsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF5QjtRQUNqRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRWpCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBQSwrQkFBc0IsRUFBQyxJQUFJLENBQUMsQ0FBQztRQUV6QyxNQUFNLFFBQVEsR0FBRyxJQUFJLDhCQUFZLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxVQUFVLEVBQUU7WUFDOUQsSUFBSSxFQUFFLElBQUEsK0JBQXNCLEVBQUMsSUFBSSxDQUFDO1lBQ2xDLE9BQU8sRUFBRSxPQUFPO1lBQ2hCLElBQUksRUFBRSxLQUFLLENBQUMsSUFBSTtZQUNoQixJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDO1NBQ2pDLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxHQUFHLEdBQUcsUUFBUSxDQUFDLE9BQU8sQ0FBQztJQUM5QixDQUFDO0NBQ0Y7QUFsQkQsNEJBa0JDO0FBRUQ7Ozs7OztHQU1HO0FBQ0gsU0FBZ0IsNENBQTRDLENBQUMsS0FBZ0IsRUFBRSxFQUFVLEVBQUUsRUFBTSxFQUFFLG1CQUE2QjtJQUM5SCxPQUFPLElBQUksUUFBUSxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUU7UUFDN0IsSUFBSSxFQUFFLE9BQU87UUFDYixJQUFJLEVBQUU7WUFDSixJQUFJLEVBQUUsaUJBQWlCO1lBQ3ZCLFdBQVcsRUFBRSxxQ0FBcUM7WUFDbEQsYUFBYSxFQUFFLENBQUM7WUFDaEIsS0FBSyxFQUFFO2dCQUNMO29CQUNFLElBQUksRUFBRSxxQkFBcUI7b0JBQzNCLE1BQU0sRUFBRSxnQkFBZ0I7b0JBQ3hCLFNBQVMsRUFBRSxPQUFPO29CQUNsQixNQUFNLEVBQUU7d0JBQ04sT0FBTyxFQUFFLFVBQVU7cUJBQ3BCO2lCQUNGO2dCQUNEO29CQUNFLElBQUksRUFBRSx3QkFBd0I7b0JBQzlCLE1BQU0sRUFBRSwrQkFBK0I7b0JBQ3ZDLFNBQVMsRUFBRSxPQUFPO29CQUNsQixFQUFFLEVBQUU7d0JBQ0YsWUFBWSxFQUFFLFFBQVE7d0JBQ3RCLEtBQUssRUFBRSwwQkFBMEI7cUJBQ2xDO29CQUNELE1BQU0sRUFBRTt3QkFDTixjQUFjLEVBQUUsOENBQThDO3FCQUMvRDtpQkFDRjtnQkFDRDtvQkFDRSwwQkFBMEI7b0JBQzFCLElBQUksRUFBRSxhQUFhO29CQUNuQixNQUFNLEVBQUUsWUFBWTtvQkFDcEIsU0FBUyxFQUFFLE9BQU87b0JBQ2xCLEVBQUUsRUFBRTt3QkFDRixZQUFZLEVBQUUsUUFBUTt3QkFDdEIsS0FBSyxFQUFFLDBCQUEwQjtxQkFDbEM7b0JBQ0QsTUFBTSxFQUFFO3dCQUNOLGNBQWMsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDLFdBQUUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMseUJBQXlCLENBQUMsQ0FBQyxDQUFDLG9CQUFvQjt3QkFDcEYsWUFBWSxFQUFFOzRCQUNaLFFBQVEsRUFBRSxtQkFBbUI7eUJBQzlCO3dCQUNELGNBQWMsRUFBRSw4Q0FBOEM7cUJBQy9EO2lCQUNGO2dCQUNEO29CQUNFLElBQUksRUFBRSxzQkFBc0I7b0JBQzVCLE1BQU0sRUFBRSxtQkFBbUI7b0JBQzNCLFNBQVMsRUFBRSxPQUFPO29CQUNsQixNQUFNLEVBQUU7d0JBQ04sY0FBYyxFQUFFLDhDQUE4QztxQkFDL0Q7aUJBQ0Y7YUFDRjtZQUNELE9BQU8sRUFBRTtnQkFDUDtvQkFDRSxJQUFJLEVBQUUsWUFBWTtvQkFDbEIsS0FBSyxFQUFFLDhDQUE4QztpQkFDdEQ7YUFDRjtTQUNGO0tBQ0YsQ0FBQyxDQUFDO0FBQ0wsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBhd3NfaW1hZ2VidWlsZGVyIGFzIGltYWdlYnVpbGRlciB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgT3MgfSBmcm9tICcuLi8uLi9wcm92aWRlcnMvY29tbW9uJztcbmltcG9ydCB7IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUgfSBmcm9tICcuLi9jb21tb24nO1xuXG4vKipcbiAqIFByb3BlcnRpZXMgZm9yIFdvcmtmbG93IGNvbnN0cnVjdC5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBXb3JrZmxvd1Byb3BlcnRpZXMge1xuICAvKipcbiAgICogV29ya2Zsb3cgdHlwZS5cbiAgICovXG4gIHJlYWRvbmx5IHR5cGU6ICdCVUlMRCcgfCAnVEVTVCcgfCAnRElTVFJJQlVUSU9OJztcblxuICAvKipcbiAgICogWUFNTCBvciBKU09OIGRhdGEgZm9yIHRoZSB3b3JrZmxvdy5cbiAgICovXG4gIHJlYWRvbmx5IGRhdGE6IGFueTtcbn1cblxuLyoqXG4gKiBJbWFnZSBidWlsZGVyIHdvcmtmbG93LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY2xhc3MgV29ya2Zsb3cgZXh0ZW5kcyBjZGsuUmVzb3VyY2Uge1xuICBwdWJsaWMgcmVhZG9ubHkgYXJuOiBzdHJpbmc7XG4gIHB1YmxpYyByZWFkb25seSBuYW1lOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IFdvcmtmbG93UHJvcGVydGllcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCk7XG5cbiAgICB0aGlzLm5hbWUgPSB1bmlxdWVJbWFnZUJ1aWxkZXJOYW1lKHRoaXMpO1xuXG4gICAgY29uc3Qgd29ya2Zsb3cgPSBuZXcgaW1hZ2VidWlsZGVyLkNmbldvcmtmbG93KHRoaXMsICdXb3JrZmxvdycsIHtcbiAgICAgIG5hbWU6IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyksXG4gICAgICB2ZXJzaW9uOiAnMS4wLjAnLFxuICAgICAgdHlwZTogcHJvcHMudHlwZSxcbiAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHByb3BzLmRhdGEpLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hcm4gPSB3b3JrZmxvdy5hdHRyQXJuO1xuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBhIG5ldyBidWlsZCB3b3JrZmxvdyBiYXNlZCBvbiBhcm46YXdzOmltYWdlYnVpbGRlcjp1cy1lYXN0LTE6YXdzOndvcmtmbG93L2J1aWxkL2J1aWxkLWNvbnRhaW5lci8xLjAuMS8xLlxuICpcbiAqIEl0IGFkZHMgYSBEb2NrZXJTZXR1cCBzdGVwIGFmdGVyIGJvb3RzdHJhcHBpbmcgYnV0IGJlZm9yZSB0aGUgRG9ja2VyIGltYWdlIGlzIGJ1aWx0LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2VuZXJhdGVCdWlsZFdvcmtmbG93V2l0aERvY2tlclNldHVwQ29tbWFuZHMoc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgb3M6IE9zLCBkb2NrZXJTZXR1cENvbW1hbmRzOiBzdHJpbmdbXSkge1xuICByZXR1cm4gbmV3IFdvcmtmbG93KHNjb3BlLCBpZCwge1xuICAgIHR5cGU6ICdCVUlMRCcsXG4gICAgZGF0YToge1xuICAgICAgbmFtZTogJ2J1aWxkLWNvbnRhaW5lcicsXG4gICAgICBkZXNjcmlwdGlvbjogJ1dvcmtmbG93IHRvIGJ1aWxkIGEgY29udGFpbmVyIGltYWdlJyxcbiAgICAgIHNjaGVtYVZlcnNpb246IDEsXG4gICAgICBzdGVwczogW1xuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ0xhdW5jaEJ1aWxkSW5zdGFuY2UnLFxuICAgICAgICAgIGFjdGlvbjogJ0xhdW5jaEluc3RhbmNlJyxcbiAgICAgICAgICBvbkZhaWx1cmU6ICdBYm9ydCcsXG4gICAgICAgICAgaW5wdXRzOiB7XG4gICAgICAgICAgICB3YWl0Rm9yOiAnc3NtQWdlbnQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnQm9vdHN0cmFwQnVpbGRJbnN0YW5jZScsXG4gICAgICAgICAgYWN0aW9uOiAnQm9vdHN0cmFwSW5zdGFuY2VGb3JDb250YWluZXInLFxuICAgICAgICAgIG9uRmFpbHVyZTogJ0Fib3J0JyxcbiAgICAgICAgICBpZjoge1xuICAgICAgICAgICAgc3RyaW5nRXF1YWxzOiAnRE9DS0VSJyxcbiAgICAgICAgICAgIHZhbHVlOiAnJC5pbWFnZWJ1aWxkZXIuaW1hZ2VUeXBlJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGlucHV0czoge1xuICAgICAgICAgICAgJ2luc3RhbmNlSWQuJCc6ICckLnN0ZXBPdXRwdXRzLkxhdW5jaEJ1aWxkSW5zdGFuY2UuaW5zdGFuY2VJZCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIC8vIHRoaXMgaXMgdGhlIHBhcnQgd2UgYWRkXG4gICAgICAgICAgbmFtZTogJ0RvY2tlclNldHVwJyxcbiAgICAgICAgICBhY3Rpb246ICdSdW5Db21tYW5kJyxcbiAgICAgICAgICBvbkZhaWx1cmU6ICdBYm9ydCcsXG4gICAgICAgICAgaWY6IHtcbiAgICAgICAgICAgIHN0cmluZ0VxdWFsczogJ0RPQ0tFUicsXG4gICAgICAgICAgICB2YWx1ZTogJyQuaW1hZ2VidWlsZGVyLmltYWdlVHlwZScsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBpbnB1dHM6IHtcbiAgICAgICAgICAgICdkb2N1bWVudE5hbWUnOiBvcy5pcyhPcy5XSU5ET1dTKSA/ICdBV1MtUnVuUG93ZXJTaGVsbFNjcmlwdCcgOiAnQVdTLVJ1blNoZWxsU2NyaXB0JyxcbiAgICAgICAgICAgICdwYXJhbWV0ZXJzJzoge1xuICAgICAgICAgICAgICBjb21tYW5kczogZG9ja2VyU2V0dXBDb21tYW5kcyxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAnaW5zdGFuY2VJZC4kJzogJyQuc3RlcE91dHB1dHMuTGF1bmNoQnVpbGRJbnN0YW5jZS5pbnN0YW5jZUlkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgbmFtZTogJ0FwcGx5QnVpbGRDb21wb25lbnRzJyxcbiAgICAgICAgICBhY3Rpb246ICdFeGVjdXRlQ29tcG9uZW50cycsXG4gICAgICAgICAgb25GYWlsdXJlOiAnQWJvcnQnLFxuICAgICAgICAgIGlucHV0czoge1xuICAgICAgICAgICAgJ2luc3RhbmNlSWQuJCc6ICckLnN0ZXBPdXRwdXRzLkxhdW5jaEJ1aWxkSW5zdGFuY2UuaW5zdGFuY2VJZCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBvdXRwdXRzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnSW5zdGFuY2VJZCcsXG4gICAgICAgICAgdmFsdWU6ICckLnN0ZXBPdXRwdXRzLkxhdW5jaEJ1aWxkSW5zdGFuY2UuaW5zdGFuY2VJZCcsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0sXG4gIH0pO1xufVxuIl19