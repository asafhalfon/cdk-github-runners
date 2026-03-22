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
            error: `${e}`,
        });
        await (0, lambda_helpers_1.customResourceRespond)(event, 'FAILED', e.message || 'Internal Error', context.logStreamName, {});
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVpbGQtaW1hZ2UubGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2J1aWxkLWltYWdlLmxhbWJkYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQWdCQSwwQkF5Q0M7QUF6REQsZ0VBQStFO0FBRS9FLHNEQUEwRDtBQUUxRCxNQUFNLFNBQVMsR0FBRyxJQUFJLGtDQUFlLEVBQUUsQ0FBQztBQVlqQyxLQUFLLFVBQVUsT0FBTyxDQUFDLEtBQWtELEVBQUUsT0FBMEI7SUFDMUcsSUFBSSxDQUFDO1FBQ0gsT0FBTyxDQUFDLEdBQUcsQ0FBQztZQUNWLE1BQU0sRUFBRSx3Q0FBd0M7WUFDaEQsR0FBRyxLQUFLO1lBQ1IsV0FBVyxFQUFFLEtBQUs7U0FDbkIsQ0FBQyxDQUFDO1FBRUgsTUFBTSxLQUFLLEdBQUcsS0FBSyxDQUFDLGtCQUFrRCxDQUFDO1FBRXZFLFFBQVEsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQzFCLEtBQUssUUFBUSxDQUFDO1lBQ2QsS0FBSyxRQUFRO2dCQUNYLE9BQU8sQ0FBQyxHQUFHLENBQUM7b0JBQ1YsTUFBTSxFQUFFLDRCQUE0QjtvQkFDcEMsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO29CQUM5QixRQUFRLEVBQUUsS0FBSyxDQUFDLFFBQVE7aUJBQ3pCLENBQUMsQ0FBQztnQkFDSCxNQUFNLEtBQUssR0FBRyxNQUFNLFNBQVMsQ0FBQyxJQUFJLENBQUMsSUFBSSxvQ0FBaUIsQ0FBQztvQkFDdkQsV0FBVyxFQUFFLEtBQUssQ0FBQyxXQUFXO29CQUM5Qiw0QkFBNEIsRUFBRTt3QkFDNUI7NEJBQ0UsSUFBSSxFQUFFLFdBQVc7NEJBQ2pCLElBQUksRUFBRSxhQUFhOzRCQUNuQixLQUFLLEVBQUUsS0FBSyxDQUFDLFVBQVU7eUJBQ3hCO3FCQUNGO2lCQUNGLENBQUMsQ0FBQyxDQUFDO2dCQUNKLE1BQU0sSUFBQSxzQ0FBcUIsRUFBQyxLQUFLLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsSUFBSSxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQ3BGLE1BQU07WUFDUixLQUFLLFFBQVE7Z0JBQ1gsTUFBTSxJQUFBLHNDQUFxQixFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDbEYsTUFBTTtRQUNWLENBQUM7SUFDSCxDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsbUNBQW1DO1lBQzNDLEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRTtTQUNkLENBQUMsQ0FBQztRQUNILE1BQU0sSUFBQSxzQ0FBcUIsRUFBQyxLQUFLLEVBQUUsUUFBUSxFQUFHLENBQVcsQ0FBQyxPQUFPLElBQUksZ0JBQWdCLEVBQUUsT0FBTyxDQUFDLGFBQWEsRUFBRSxFQUFFLENBQUMsQ0FBQztJQUNwSCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IENvZGVCdWlsZENsaWVudCwgU3RhcnRCdWlsZENvbW1hbmQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtY29kZWJ1aWxkJztcbmltcG9ydCAqIGFzIEFXU0xhbWJkYSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGN1c3RvbVJlc291cmNlUmVzcG9uZCB9IGZyb20gJy4uL2xhbWJkYS1oZWxwZXJzJztcblxuY29uc3QgY29kZWJ1aWxkID0gbmV3IENvZGVCdWlsZENsaWVudCgpO1xuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIEJ1aWxkSW1hZ2VGdW5jdGlvblByb3BlcnRpZXMge1xuICBTZXJ2aWNlVG9rZW46IHN0cmluZztcbiAgUmVwb05hbWU6IHN0cmluZztcbiAgUHJvamVjdE5hbWU6IHN0cmluZztcbiAgV2FpdEhhbmRsZTogc3RyaW5nO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogQVdTTGFtYmRhLkNsb3VkRm9ybWF0aW9uQ3VzdG9tUmVzb3VyY2VFdmVudCwgY29udGV4dDogQVdTTGFtYmRhLkNvbnRleHQpIHtcbiAgdHJ5IHtcbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdDbG91ZEZvcm1hdGlvbiBjdXN0b20gcmVzb3VyY2UgcmVxdWVzdCcsXG4gICAgICAuLi5ldmVudCxcbiAgICAgIFJlc3BvbnNlVVJMOiAnLi4uJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IHByb3BzID0gZXZlbnQuUmVzb3VyY2VQcm9wZXJ0aWVzIGFzIEJ1aWxkSW1hZ2VGdW5jdGlvblByb3BlcnRpZXM7XG5cbiAgICBzd2l0Y2ggKGV2ZW50LlJlcXVlc3RUeXBlKSB7XG4gICAgICBjYXNlICdDcmVhdGUnOlxuICAgICAgY2FzZSAnVXBkYXRlJzpcbiAgICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICAgIG5vdGljZTogJ1N0YXJ0aW5nIENvZGVCdWlsZCBwcm9qZWN0JyxcbiAgICAgICAgICBwcm9qZWN0TmFtZTogcHJvcHMuUHJvamVjdE5hbWUsXG4gICAgICAgICAgcmVwb05hbWU6IHByb3BzLlJlcG9OYW1lLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uc3QgY2JSZXMgPSBhd2FpdCBjb2RlYnVpbGQuc2VuZChuZXcgU3RhcnRCdWlsZENvbW1hbmQoe1xuICAgICAgICAgIHByb2plY3ROYW1lOiBwcm9wcy5Qcm9qZWN0TmFtZSxcbiAgICAgICAgICBlbnZpcm9ubWVudFZhcmlhYmxlc092ZXJyaWRlOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHR5cGU6ICdQTEFJTlRFWFQnLFxuICAgICAgICAgICAgICBuYW1lOiAnV0FJVF9IQU5ETEUnLFxuICAgICAgICAgICAgICB2YWx1ZTogcHJvcHMuV2FpdEhhbmRsZSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSkpO1xuICAgICAgICBhd2FpdCBjdXN0b21SZXNvdXJjZVJlc3BvbmQoZXZlbnQsICdTVUNDRVNTJywgJ09LJywgY2JSZXMuYnVpbGQ/LmlkID8/ICdidWlsZCcsIHt9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdEZWxldGUnOlxuICAgICAgICBhd2FpdCBjdXN0b21SZXNvdXJjZVJlc3BvbmQoZXZlbnQsICdTVUNDRVNTJywgJ09LJywgZXZlbnQuUGh5c2ljYWxSZXNvdXJjZUlkLCB7fSk7XG4gICAgICAgIGJyZWFrO1xuICAgIH1cbiAgfSBjYXRjaCAoZSkge1xuICAgIGNvbnNvbGUuZXJyb3Ioe1xuICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIHN0YXJ0IENvZGVCdWlsZCBwcm9qZWN0JyxcbiAgICAgIGVycm9yOiBgJHtlfWAsXG4gICAgfSk7XG4gICAgYXdhaXQgY3VzdG9tUmVzb3VyY2VSZXNwb25kKGV2ZW50LCAnRkFJTEVEJywgKGUgYXMgRXJyb3IpLm1lc3NhZ2UgfHwgJ0ludGVybmFsIEVycm9yJywgY29udGV4dC5sb2dTdHJlYW1OYW1lLCB7fSk7XG4gIH1cbn1cbiJdfQ==