"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Workflow = void 0;
exports.generateBuildWorkflowWithDockerSetupCommands = generateBuildWorkflowWithDockerSetupCommands;
const cdk = require("aws-cdk-lib");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const common_1 = require("../../providers/common");
const common_2 = require("../common");
/**
 * Image builder workflow.
 *
 * @internal
 */
class Workflow extends cdk.Resource {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid29ya2Zsb3cuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaW1hZ2UtYnVpbGRlcnMvYXdzLWltYWdlLWJ1aWxkZXIvd29ya2Zsb3cudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBdURBLG9HQThEQztBQXJIRCxtQ0FBbUM7QUFDbkMsNkNBQStEO0FBRS9ELG1EQUE0QztBQUM1QyxzQ0FBbUQ7QUFtQm5EOzs7O0dBSUc7QUFDSCxNQUFhLFFBQVMsU0FBUSxHQUFHLENBQUMsUUFBUTtJQUl4QyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXlCO1FBQ2pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFFakIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFBLCtCQUFzQixFQUFDLElBQUksQ0FBQyxDQUFDO1FBRXpDLE1BQU0sUUFBUSxHQUFHLElBQUksOEJBQVksQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLFVBQVUsRUFBRTtZQUM5RCxJQUFJLEVBQUUsSUFBQSwrQkFBc0IsRUFBQyxJQUFJLENBQUM7WUFDbEMsT0FBTyxFQUFFLE9BQU87WUFDaEIsSUFBSSxFQUFFLEtBQUssQ0FBQyxJQUFJO1lBQ2hCLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUM7U0FDakMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLEdBQUcsR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDO0lBQzlCLENBQUM7Q0FDRjtBQWxCRCw0QkFrQkM7QUFFRDs7Ozs7O0dBTUc7QUFDSCxTQUFnQiw0Q0FBNEMsQ0FBQyxLQUFnQixFQUFFLEVBQVUsRUFBRSxFQUFNLEVBQUUsbUJBQTZCO0lBQzlILE9BQU8sSUFBSSxRQUFRLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRTtRQUM3QixJQUFJLEVBQUUsT0FBTztRQUNiLElBQUksRUFBRTtZQUNKLElBQUksRUFBRSxpQkFBaUI7WUFDdkIsV0FBVyxFQUFFLHFDQUFxQztZQUNsRCxhQUFhLEVBQUUsQ0FBQztZQUNoQixLQUFLLEVBQUU7Z0JBQ0w7b0JBQ0UsSUFBSSxFQUFFLHFCQUFxQjtvQkFDM0IsTUFBTSxFQUFFLGdCQUFnQjtvQkFDeEIsU0FBUyxFQUFFLE9BQU87b0JBQ2xCLE1BQU0sRUFBRTt3QkFDTixPQUFPLEVBQUUsVUFBVTtxQkFDcEI7aUJBQ0Y7Z0JBQ0Q7b0JBQ0UsSUFBSSxFQUFFLHdCQUF3QjtvQkFDOUIsTUFBTSxFQUFFLCtCQUErQjtvQkFDdkMsU0FBUyxFQUFFLE9BQU87b0JBQ2xCLEVBQUUsRUFBRTt3QkFDRixZQUFZLEVBQUUsUUFBUTt3QkFDdEIsS0FBSyxFQUFFLDBCQUEwQjtxQkFDbEM7b0JBQ0QsTUFBTSxFQUFFO3dCQUNOLGNBQWMsRUFBRSw4Q0FBOEM7cUJBQy9EO2lCQUNGO2dCQUNEO29CQUNFLDBCQUEwQjtvQkFDMUIsSUFBSSxFQUFFLGFBQWE7b0JBQ25CLE1BQU0sRUFBRSxZQUFZO29CQUNwQixTQUFTLEVBQUUsT0FBTztvQkFDbEIsRUFBRSxFQUFFO3dCQUNGLFlBQVksRUFBRSxRQUFRO3dCQUN0QixLQUFLLEVBQUUsMEJBQTBCO3FCQUNsQztvQkFDRCxNQUFNLEVBQUU7d0JBQ04sY0FBYyxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsV0FBRSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyx5QkFBeUIsQ0FBQyxDQUFDLENBQUMsb0JBQW9CO3dCQUNwRixZQUFZLEVBQUU7NEJBQ1osUUFBUSxFQUFFLG1CQUFtQjt5QkFDOUI7d0JBQ0QsY0FBYyxFQUFFLDhDQUE4QztxQkFDL0Q7aUJBQ0Y7Z0JBQ0Q7b0JBQ0UsSUFBSSxFQUFFLHNCQUFzQjtvQkFDNUIsTUFBTSxFQUFFLG1CQUFtQjtvQkFDM0IsU0FBUyxFQUFFLE9BQU87b0JBQ2xCLE1BQU0sRUFBRTt3QkFDTixjQUFjLEVBQUUsOENBQThDO3FCQUMvRDtpQkFDRjthQUNGO1lBQ0QsT0FBTyxFQUFFO2dCQUNQO29CQUNFLElBQUksRUFBRSxZQUFZO29CQUNsQixLQUFLLEVBQUUsOENBQThDO2lCQUN0RDthQUNGO1NBQ0Y7S0FDRixDQUFDLENBQUM7QUFDTCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCB7IGF3c19pbWFnZWJ1aWxkZXIgYXMgaW1hZ2VidWlsZGVyIH0gZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBPcyB9IGZyb20gJy4uLy4uL3Byb3ZpZGVycy9jb21tb24nO1xuaW1wb3J0IHsgdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSB9IGZyb20gJy4uL2NvbW1vbic7XG5cbi8qKlxuICogUHJvcGVydGllcyBmb3IgV29ya2Zsb3cgY29uc3RydWN0LlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIFdvcmtmbG93UHJvcGVydGllcyB7XG4gIC8qKlxuICAgKiBXb3JrZmxvdyB0eXBlLlxuICAgKi9cbiAgcmVhZG9ubHkgdHlwZTogJ0JVSUxEJyB8ICdURVNUJyB8ICdESVNUUklCVVRJT04nO1xuXG4gIC8qKlxuICAgKiBZQU1MIG9yIEpTT04gZGF0YSBmb3IgdGhlIHdvcmtmbG93LlxuICAgKi9cbiAgcmVhZG9ubHkgZGF0YTogYW55O1xufVxuXG4vKipcbiAqIEltYWdlIGJ1aWxkZXIgd29ya2Zsb3cuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjbGFzcyBXb3JrZmxvdyBleHRlbmRzIGNkay5SZXNvdXJjZSB7XG4gIHB1YmxpYyByZWFkb25seSBhcm46IHN0cmluZztcbiAgcHVibGljIHJlYWRvbmx5IG5hbWU6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogV29ya2Zsb3dQcm9wZXJ0aWVzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkKTtcblxuICAgIHRoaXMubmFtZSA9IHVuaXF1ZUltYWdlQnVpbGRlck5hbWUodGhpcyk7XG5cbiAgICBjb25zdCB3b3JrZmxvdyA9IG5ldyBpbWFnZWJ1aWxkZXIuQ2ZuV29ya2Zsb3codGhpcywgJ1dvcmtmbG93Jywge1xuICAgICAgbmFtZTogdW5pcXVlSW1hZ2VCdWlsZGVyTmFtZSh0aGlzKSxcbiAgICAgIHZlcnNpb246ICcxLjAuMCcsXG4gICAgICB0eXBlOiBwcm9wcy50eXBlLFxuICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkocHJvcHMuZGF0YSksXG4gICAgfSk7XG5cbiAgICB0aGlzLmFybiA9IHdvcmtmbG93LmF0dHJBcm47XG4gIH1cbn1cblxuLyoqXG4gKiBSZXR1cm5zIGEgbmV3IGJ1aWxkIHdvcmtmbG93IGJhc2VkIG9uIGFybjphd3M6aW1hZ2VidWlsZGVyOnVzLWVhc3QtMTphd3M6d29ya2Zsb3cvYnVpbGQvYnVpbGQtY29udGFpbmVyLzEuMC4xLzEuXG4gKlxuICogSXQgYWRkcyBhIERvY2tlclNldHVwIHN0ZXAgYWZ0ZXIgYm9vdHN0cmFwcGluZyBidXQgYmVmb3JlIHRoZSBEb2NrZXIgaW1hZ2UgaXMgYnVpbHQuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZW5lcmF0ZUJ1aWxkV29ya2Zsb3dXaXRoRG9ja2VyU2V0dXBDb21tYW5kcyhzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBvczogT3MsIGRvY2tlclNldHVwQ29tbWFuZHM6IHN0cmluZ1tdKSB7XG4gIHJldHVybiBuZXcgV29ya2Zsb3coc2NvcGUsIGlkLCB7XG4gICAgdHlwZTogJ0JVSUxEJyxcbiAgICBkYXRhOiB7XG4gICAgICBuYW1lOiAnYnVpbGQtY29udGFpbmVyJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnV29ya2Zsb3cgdG8gYnVpbGQgYSBjb250YWluZXIgaW1hZ2UnLFxuICAgICAgc2NoZW1hVmVyc2lvbjogMSxcbiAgICAgIHN0ZXBzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnTGF1bmNoQnVpbGRJbnN0YW5jZScsXG4gICAgICAgICAgYWN0aW9uOiAnTGF1bmNoSW5zdGFuY2UnLFxuICAgICAgICAgIG9uRmFpbHVyZTogJ0Fib3J0JyxcbiAgICAgICAgICBpbnB1dHM6IHtcbiAgICAgICAgICAgIHdhaXRGb3I6ICdzc21BZ2VudCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdCb290c3RyYXBCdWlsZEluc3RhbmNlJyxcbiAgICAgICAgICBhY3Rpb246ICdCb290c3RyYXBJbnN0YW5jZUZvckNvbnRhaW5lcicsXG4gICAgICAgICAgb25GYWlsdXJlOiAnQWJvcnQnLFxuICAgICAgICAgIGlmOiB7XG4gICAgICAgICAgICBzdHJpbmdFcXVhbHM6ICdET0NLRVInLFxuICAgICAgICAgICAgdmFsdWU6ICckLmltYWdlYnVpbGRlci5pbWFnZVR5cGUnLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaW5wdXRzOiB7XG4gICAgICAgICAgICAnaW5zdGFuY2VJZC4kJzogJyQuc3RlcE91dHB1dHMuTGF1bmNoQnVpbGRJbnN0YW5jZS5pbnN0YW5jZUlkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgLy8gdGhpcyBpcyB0aGUgcGFydCB3ZSBhZGRcbiAgICAgICAgICBuYW1lOiAnRG9ja2VyU2V0dXAnLFxuICAgICAgICAgIGFjdGlvbjogJ1J1bkNvbW1hbmQnLFxuICAgICAgICAgIG9uRmFpbHVyZTogJ0Fib3J0JyxcbiAgICAgICAgICBpZjoge1xuICAgICAgICAgICAgc3RyaW5nRXF1YWxzOiAnRE9DS0VSJyxcbiAgICAgICAgICAgIHZhbHVlOiAnJC5pbWFnZWJ1aWxkZXIuaW1hZ2VUeXBlJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGlucHV0czoge1xuICAgICAgICAgICAgJ2RvY3VtZW50TmFtZSc6IG9zLmlzKE9zLldJTkRPV1MpID8gJ0FXUy1SdW5Qb3dlclNoZWxsU2NyaXB0JyA6ICdBV1MtUnVuU2hlbGxTY3JpcHQnLFxuICAgICAgICAgICAgJ3BhcmFtZXRlcnMnOiB7XG4gICAgICAgICAgICAgIGNvbW1hbmRzOiBkb2NrZXJTZXR1cENvbW1hbmRzLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICdpbnN0YW5jZUlkLiQnOiAnJC5zdGVwT3V0cHV0cy5MYXVuY2hCdWlsZEluc3RhbmNlLmluc3RhbmNlSWQnLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBuYW1lOiAnQXBwbHlCdWlsZENvbXBvbmVudHMnLFxuICAgICAgICAgIGFjdGlvbjogJ0V4ZWN1dGVDb21wb25lbnRzJyxcbiAgICAgICAgICBvbkZhaWx1cmU6ICdBYm9ydCcsXG4gICAgICAgICAgaW5wdXRzOiB7XG4gICAgICAgICAgICAnaW5zdGFuY2VJZC4kJzogJyQuc3RlcE91dHB1dHMuTGF1bmNoQnVpbGRJbnN0YW5jZS5pbnN0YW5jZUlkJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgXSxcbiAgICAgIG91dHB1dHM6IFtcbiAgICAgICAge1xuICAgICAgICAgIG5hbWU6ICdJbnN0YW5jZUlkJyxcbiAgICAgICAgICB2YWx1ZTogJyQuc3RlcE91dHB1dHMuTGF1bmNoQnVpbGRJbnN0YW5jZS5pbnN0YW5jZUlkJyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSxcbiAgfSk7XG59XG4iXX0=