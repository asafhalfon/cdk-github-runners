"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_codebuild_1 = require("@aws-sdk/client-codebuild");
const lambda_helpers_1 = require("../lambda-helpers");
const codebuild = new client_codebuild_1.CodeBuildClient();
async function handler(event, context) {
    try {
        console.log({
            notice: 'CloudFormation custom resource request',
            ...event,
            ResponseURL: '...',
        });
        const props = event.ResourceProperties;
        switch (event.RequestType) {
            case 'Create':
            case 'Update':
                console.log({
                    notice: 'Starting CodeBuild project',
                    projectName: props.ProjectName,
                    repoName: props.RepoName,
                });
                const cbRes = await codebuild.send(new client_codebuild_1.StartBuildCommand({
                    projectName: props.ProjectName,
                    environmentVariablesOverride: [
                        {
                            type: 'PLAINTEXT',
                            name: 'WAIT_HANDLE',
                            value: props.WaitHandle,
                        },
                    ],
                }));
                await (0, lambda_helpers_1.customResourceRespond)(event, 'SUCCESS', 'OK', cbRes.build?.id ?? 'build', {});
                break;
            case 'Delete':
                await (0, lambda_helpers_1.customResourceRespond)(event, 'SUCCESS', 'OK', event.PhysicalResourceId, {});
                break;
        }
    }
    catch (e) {
        console.error({
            notice: 'Failed to start CodeBuild project',
            error: e,
        });
        await (0, lambda_helpers_1.customResourceRespond)(event, 'FAILED', e.message || 'Internal Error', context.logStreamName, {});
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGQtaW1hZ2UubGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2J1aWxkLWltYWdlLmxhbWJkYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWdCQSwwQkF5Q0M7QUF6REQsZ0VBQStFO0FBRS9FLHNEQUEwRDtBQUUxRCxNQUFNLFNBQVMsR0FBRyxJQUFJLGtDQUFlLEVBQUUsQ0FBQztBQVlqQyxLQUFLLFVBQVUsT0FBTyxDQUFDLEtBQWtELEVBQUUsT0FBMEI7SUFDMUcsSUFBSSxDQUFDO1FBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUNWLE1BQU0sRUFBRSx3Q0FBd0M7WUFDaEQsR0FBRyxLQUFLO1lBQ1IsV0FBVyxFQUFFLEtBQUs7U0FDbkIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLGtCQUFrRCxDQUFDO1FBRXZFLFFBQVEsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQzFCLEtBQUssUUFBUSxDQUFDO1lBQ2QsS0FBSyxRQUFRO2dCQUNYLE9BQU8sQ0FBQyxHQUFHLENBQUM7b0JBQ1YsTUFBTSxFQUFFLDRCQUE0QjtvQkFDcEMsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO29CQUM5QixRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7aUJBQ3pCLENBQUMsQ0FBQztnQkFDSCxNQUFNLEtBQUssR0FBRyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxvQ0FBaUIsQ0FBQztvQkFDdkQsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO29CQUM5Qiw0QkFBNEIsRUFBRTt3QkFDNUI7NEJBQ0UsSUFBSSxFQUFFLFdBQVc7NEJBQ2pCLElBQUksRUFBRSxhQUFhOzRCQUNuQixLQUFLLEVBQUUsS0FBSyxDQUFDLFVBQVU7eUJBQ3hCO3FCQUNGO2lCQUNGLENBQUMsQ0FBQyxDQUFDO2dCQUNKLE1BQU0sSUFBQSxzQ0FBcUIsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsSUFBSSxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQ3BGLE1BQU07WUFDUixLQUFLLFFBQVE7Z0JBQ1gsTUFBTSxJQUFBLHNDQUFxQixFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDbEYsTUFBTTtRQUNWLENBQUM7SUFDSCxDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsbUNBQW1DO1lBQzNDLEtBQUssRUFBRSxDQUFDO1NBQ1QsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxJQUFBLHNDQUFxQixFQUFDLEtBQUssRUFBRSxRQUFRLEVBQUcsQ0FBVyxDQUFDLE9BQU8sSUFBSSxnQkFBZ0IsRUFBRSxPQUFPLENBQUMsYUFBYSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ3BILENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29kZUJ1aWxkQ2xpZW50LCBTdGFydEJ1aWxkQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1jb2RlYnVpbGQnO1xuaW1wb3J0ICogYXMgQVdTTGFtYmRhIGZyb20gJ2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgY3VzdG9tUmVzb3VyY2VSZXNwb25kIH0gZnJvbSAnLi4vbGFtYmRhLWhlbHBlcnMnO1xuXG5jb25zdCBjb2RlYnVpbGQgPSBuZXcgQ29kZUJ1aWxkQ2xpZW50KCk7XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQnVpbGRJbWFnZUZ1bmN0aW9uUHJvcGVydGllcyB7XG4gIFNlcnZpY2VUb2tlbjogc3RyaW5nO1xuICBSZXBvTmFtZTogc3RyaW5nO1xuICBQcm9qZWN0TmFtZTogc3RyaW5nO1xuICBXYWl0SGFuZGxlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKGV2ZW50OiBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50LCBjb250ZXh0OiBBV1NMYW1iZGEuQ29udGV4dCkge1xuICB0cnkge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ0Nsb3VkRm9ybWF0aW9uIGN1c3RvbSByZXNvdXJjZSByZXF1ZXN0JyxcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgUmVzcG9uc2VVUkw6ICcuLi4nLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcHJvcHMgPSBldmVudC5SZXNvdXJjZVByb3BlcnRpZXMgYXMgQnVpbGRJbWFnZUZ1bmN0aW9uUHJvcGVydGllcztcblxuICAgIHN3aXRjaCAoZXZlbnQuUmVxdWVzdFR5cGUpIHtcbiAgICAgIGNhc2UgJ0NyZWF0ZSc6XG4gICAgICBjYXNlICdVcGRhdGUnOlxuICAgICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgICAgbm90aWNlOiAnU3RhcnRpbmcgQ29kZUJ1aWxkIHByb2plY3QnLFxuICAgICAgICAgIHByb2plY3ROYW1lOiBwcm9wcy5Qcm9qZWN0TmFtZSxcbiAgICAgICAgICByZXBvTmFtZTogcHJvcHMuUmVwb05hbWUsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCBjYlJlcyA9IGF3YWl0IGNvZGVidWlsZC5zZW5kKG5ldyBTdGFydEJ1aWxkQ29tbWFuZCh7XG4gICAgICAgICAgcHJvamVjdE5hbWU6IHByb3BzLlByb2plY3ROYW1lLFxuICAgICAgICAgIGVudmlyb25tZW50VmFyaWFibGVzT3ZlcnJpZGU6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgdHlwZTogJ1BMQUlOVEVYVCcsXG4gICAgICAgICAgICAgIG5hbWU6ICdXQUlUX0hBTkRMRScsXG4gICAgICAgICAgICAgIHZhbHVlOiBwcm9wcy5XYWl0SGFuZGxlLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9KSk7XG4gICAgICAgIGF3YWl0IGN1c3RvbVJlc291cmNlUmVzcG9uZChldmVudCwgJ1NVQ0NFU1MnLCAnT0snLCBjYlJlcy5idWlsZD8uaWQgPz8gJ2J1aWxkJywge30pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0RlbGV0ZSc6XG4gICAgICAgIGF3YWl0IGN1c3RvbVJlc291cmNlUmVzcG9uZChldmVudCwgJ1NVQ0NFU1MnLCAnT0snLCBldmVudC5QaHlzaWNhbFJlc291cmNlSWQsIHt9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdGYWlsZWQgdG8gc3RhcnQgQ29kZUJ1aWxkIHByb2plY3QnLFxuICAgICAgZXJyb3I6IGUsXG4gICAgfSk7XG4gICAgYXdhaXQgY3VzdG9tUmVzb3VyY2VSZXNwb25kKGV2ZW50LCAnRkFJTEVEJywgKGUgYXMgRXJyb3IpLm1lc3NhZ2UgfHwgJ0ludGVybmFsIEVycm9yJywgY29udGV4dC5sb2dTdHJlYW1OYW1lLCB7fSk7XG4gIH1cbn1cbiJdfQ==