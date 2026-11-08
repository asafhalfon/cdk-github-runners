"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_sns_1 = require("@aws-sdk/client-sns");
const sns = new client_sns_1.SNSClient();
/**
 * Short readable summary of a failed build notification from CodeBuild or EC2 Image Builder.
 */
function summarize(message) {
    if (message.source === 'aws.codebuild') {
        const detail = message.detail;
        const info = detail['additional-information'] ?? {};
        const failedPhase = (info.phases ?? []).find((p) => p['phase-status'] && p['phase-status'] !== 'SUCCEEDED');
        return {
            subject: `Runner image build failed: ${detail['project-name']}`,
            text: [
                'Runner image build failed in CodeBuild.',
                '',
                `Project: ${detail['project-name']}`,
                `Failed phase: ${failedPhase?.['phase-type'] ?? 'unknown'}`,
                `Reason: ${failedPhase?.['phase-context']?.join(' ') || 'unknown'}`,
                `Logs: ${info.logs?.['deep-link'] ?? 'unknown'}`,
                `Build: ${detail['build-id']}`,
            ].join('\n'),
        };
    }
    if (message.state?.status === 'FAILED') {
        const region = message.arn.split(':')[3];
        const logGroup = `/aws/imagebuilder/${message.name}`;
        const logGroupLink = encodeURIComponent(encodeURIComponent(logGroup)).replace(/%/g, '$');
        return {
            subject: `Runner image build failed: ${message.name}`,
            text: [
                'Runner image build failed in EC2 Image Builder.',
                '',
                `Recipe: ${message.name} ${message.version}`,
                `Reason: ${message.state.reason ?? 'unknown'}`,
                `Logs: https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#logsV2:log-groups/log-group/${logGroupLink}`,
                `Image: ${message.arn}`,
            ].join('\n'),
        };
    }
    return undefined;
}
async function handler(event) {
    console.log({
        notice: 'Received SNS event',
        recordCount: event.Records.length,
    });
    for (const record of event.Records) {
        const message = JSON.parse(record.Sns.Message);
        const summary = summarize(message);
        if (summary) {
            // email subscribers get the readable summary, everything else keeps getting the original JSON
            await sns.send(new client_sns_1.PublishCommand({
                TopicArn: process.env.TARGET_TOPIC_ARN,
                Subject: summary.subject.slice(0, 100),
                MessageStructure: 'json',
                Message: JSON.stringify({
                    default: record.Sns.Message,
                    email: `${summary.text}\n\nRunners keep using the last successfully built image until a build succeeds.\n\nFull notification:\n${JSON.stringify(message, null, 2)}`,
                }),
            }));
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmlsdGVyLWZhaWxlZC1idWlsZHMubGFtYmRhLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2ltYWdlLWJ1aWxkZXJzL2F3cy1pbWFnZS1idWlsZGVyL2ZpbHRlci1mYWlsZWQtYnVpbGRzLmxhbWJkYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQStDQSwwQkFxQkM7QUFwRUQsb0RBQWdFO0FBR2hFLE1BQU0sR0FBRyxHQUFHLElBQUksc0JBQVMsRUFBRSxDQUFDO0FBRTVCOztHQUVHO0FBQ0gsU0FBUyxTQUFTLENBQUMsT0FBWTtJQUM3QixJQUFJLE9BQU8sQ0FBQyxNQUFNLEtBQUssZUFBZSxFQUFFLENBQUM7UUFDdkMsTUFBTSxNQUFNLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQztRQUM5QixNQUFNLElBQUksR0FBRyxNQUFNLENBQUMsd0JBQXdCLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDcEQsTUFBTSxXQUFXLEdBQUcsQ0FBQyxJQUFJLENBQUMsTUFBTSxJQUFJLEVBQUUsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxjQUFjLENBQUMsS0FBSyxXQUFXLENBQUMsQ0FBQztRQUNqSCxPQUFPO1lBQ0wsT0FBTyxFQUFFLDhCQUE4QixNQUFNLENBQUMsY0FBYyxDQUFDLEVBQUU7WUFDL0QsSUFBSSxFQUFFO2dCQUNKLHlDQUF5QztnQkFDekMsRUFBRTtnQkFDRixZQUFZLE1BQU0sQ0FBQyxjQUFjLENBQUMsRUFBRTtnQkFDcEMsaUJBQWlCLFdBQVcsRUFBRSxDQUFDLFlBQVksQ0FBQyxJQUFJLFNBQVMsRUFBRTtnQkFDM0QsV0FBVyxXQUFXLEVBQUUsQ0FBQyxlQUFlLENBQUMsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksU0FBUyxFQUFFO2dCQUNuRSxTQUFTLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQyxXQUFXLENBQUMsSUFBSSxTQUFTLEVBQUU7Z0JBQ2hELFVBQVUsTUFBTSxDQUFDLFVBQVUsQ0FBQyxFQUFFO2FBQy9CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztTQUNiLENBQUM7SUFDSixDQUFDO0lBRUQsSUFBSSxPQUFPLENBQUMsS0FBSyxFQUFFLE1BQU0sS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN2QyxNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUN6QyxNQUFNLFFBQVEsR0FBRyxxQkFBcUIsT0FBTyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ3JELE1BQU0sWUFBWSxHQUFHLGtCQUFrQixDQUFDLGtCQUFrQixDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztRQUN6RixPQUFPO1lBQ0wsT0FBTyxFQUFFLDhCQUE4QixPQUFPLENBQUMsSUFBSSxFQUFFO1lBQ3JELElBQUksRUFBRTtnQkFDSixpREFBaUQ7Z0JBQ2pELEVBQUU7Z0JBQ0YsV0FBVyxPQUFPLENBQUMsSUFBSSxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUU7Z0JBQzVDLFdBQVcsT0FBTyxDQUFDLEtBQUssQ0FBQyxNQUFNLElBQUksU0FBUyxFQUFFO2dCQUM5QyxpQkFBaUIsTUFBTSxrREFBa0QsTUFBTSxnQ0FBZ0MsWUFBWSxFQUFFO2dCQUM3SCxVQUFVLE9BQU8sQ0FBQyxHQUFHLEVBQUU7YUFDeEIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1NBQ2IsQ0FBQztJQUNKLENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBRU0sS0FBSyxVQUFVLE9BQU8sQ0FBQyxLQUF5QjtJQUNyRCxPQUFPLENBQUMsR0FBRyxDQUFDO1FBQ1YsTUFBTSxFQUFFLG9CQUFvQjtRQUM1QixXQUFXLEVBQUUsS0FBSyxDQUFDLE9BQU8sQ0FBQyxNQUFNO0tBQ2xDLENBQUMsQ0FBQztJQUNILEtBQUssTUFBTSxNQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ25DLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMvQyxNQUFNLE9BQU8sR0FBRyxTQUFTLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDbkMsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNaLDhGQUE4RjtZQUM5RixNQUFNLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSwyQkFBYyxDQUFDO2dCQUNoQyxRQUFRLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxnQkFBZ0I7Z0JBQ3RDLE9BQU8sRUFBRSxPQUFPLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDO2dCQUN0QyxnQkFBZ0IsRUFBRSxNQUFNO2dCQUN4QixPQUFPLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDdEIsT0FBTyxFQUFFLE1BQU0sQ0FBQyxHQUFHLENBQUMsT0FBTztvQkFDM0IsS0FBSyxFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksMkdBQTJHLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUMsRUFBRTtpQkFDcEssQ0FBQzthQUNILENBQUMsQ0FBQyxDQUFDO1FBQ04sQ0FBQztJQUNILENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU05TQ2xpZW50LCBQdWJsaXNoQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1zbnMnO1xuaW1wb3J0ICogYXMgQVdTTGFtYmRhIGZyb20gJ2F3cy1sYW1iZGEnO1xuXG5jb25zdCBzbnMgPSBuZXcgU05TQ2xpZW50KCk7XG5cbi8qKlxuICogU2hvcnQgcmVhZGFibGUgc3VtbWFyeSBvZiBhIGZhaWxlZCBidWlsZCBub3RpZmljYXRpb24gZnJvbSBDb2RlQnVpbGQgb3IgRUMyIEltYWdlIEJ1aWxkZXIuXG4gKi9cbmZ1bmN0aW9uIHN1bW1hcml6ZShtZXNzYWdlOiBhbnkpOiB7IHN1YmplY3Q6IHN0cmluZzsgdGV4dDogc3RyaW5nIH0gfCB1bmRlZmluZWQge1xuICBpZiAobWVzc2FnZS5zb3VyY2UgPT09ICdhd3MuY29kZWJ1aWxkJykge1xuICAgIGNvbnN0IGRldGFpbCA9IG1lc3NhZ2UuZGV0YWlsO1xuICAgIGNvbnN0IGluZm8gPSBkZXRhaWxbJ2FkZGl0aW9uYWwtaW5mb3JtYXRpb24nXSA/PyB7fTtcbiAgICBjb25zdCBmYWlsZWRQaGFzZSA9IChpbmZvLnBoYXNlcyA/PyBbXSkuZmluZCgocDogYW55KSA9PiBwWydwaGFzZS1zdGF0dXMnXSAmJiBwWydwaGFzZS1zdGF0dXMnXSAhPT0gJ1NVQ0NFRURFRCcpO1xuICAgIHJldHVybiB7XG4gICAgICBzdWJqZWN0OiBgUnVubmVyIGltYWdlIGJ1aWxkIGZhaWxlZDogJHtkZXRhaWxbJ3Byb2plY3QtbmFtZSddfWAsXG4gICAgICB0ZXh0OiBbXG4gICAgICAgICdSdW5uZXIgaW1hZ2UgYnVpbGQgZmFpbGVkIGluIENvZGVCdWlsZC4nLFxuICAgICAgICAnJyxcbiAgICAgICAgYFByb2plY3Q6ICR7ZGV0YWlsWydwcm9qZWN0LW5hbWUnXX1gLFxuICAgICAgICBgRmFpbGVkIHBoYXNlOiAke2ZhaWxlZFBoYXNlPy5bJ3BoYXNlLXR5cGUnXSA/PyAndW5rbm93bid9YCxcbiAgICAgICAgYFJlYXNvbjogJHtmYWlsZWRQaGFzZT8uWydwaGFzZS1jb250ZXh0J10/LmpvaW4oJyAnKSB8fCAndW5rbm93bid9YCxcbiAgICAgICAgYExvZ3M6ICR7aW5mby5sb2dzPy5bJ2RlZXAtbGluayddID8/ICd1bmtub3duJ31gLFxuICAgICAgICBgQnVpbGQ6ICR7ZGV0YWlsWydidWlsZC1pZCddfWAsXG4gICAgICBdLmpvaW4oJ1xcbicpLFxuICAgIH07XG4gIH1cblxuICBpZiAobWVzc2FnZS5zdGF0ZT8uc3RhdHVzID09PSAnRkFJTEVEJykge1xuICAgIGNvbnN0IHJlZ2lvbiA9IG1lc3NhZ2UuYXJuLnNwbGl0KCc6JylbM107XG4gICAgY29uc3QgbG9nR3JvdXAgPSBgL2F3cy9pbWFnZWJ1aWxkZXIvJHttZXNzYWdlLm5hbWV9YDtcbiAgICBjb25zdCBsb2dHcm91cExpbmsgPSBlbmNvZGVVUklDb21wb25lbnQoZW5jb2RlVVJJQ29tcG9uZW50KGxvZ0dyb3VwKSkucmVwbGFjZSgvJS9nLCAnJCcpO1xuICAgIHJldHVybiB7XG4gICAgICBzdWJqZWN0OiBgUnVubmVyIGltYWdlIGJ1aWxkIGZhaWxlZDogJHttZXNzYWdlLm5hbWV9YCxcbiAgICAgIHRleHQ6IFtcbiAgICAgICAgJ1J1bm5lciBpbWFnZSBidWlsZCBmYWlsZWQgaW4gRUMyIEltYWdlIEJ1aWxkZXIuJyxcbiAgICAgICAgJycsXG4gICAgICAgIGBSZWNpcGU6ICR7bWVzc2FnZS5uYW1lfSAke21lc3NhZ2UudmVyc2lvbn1gLFxuICAgICAgICBgUmVhc29uOiAke21lc3NhZ2Uuc3RhdGUucmVhc29uID8/ICd1bmtub3duJ31gLFxuICAgICAgICBgTG9nczogaHR0cHM6Ly8ke3JlZ2lvbn0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9jbG91ZHdhdGNoL2hvbWU/cmVnaW9uPSR7cmVnaW9ufSNsb2dzVjI6bG9nLWdyb3Vwcy9sb2ctZ3JvdXAvJHtsb2dHcm91cExpbmt9YCxcbiAgICAgICAgYEltYWdlOiAke21lc3NhZ2UuYXJufWAsXG4gICAgICBdLmpvaW4oJ1xcbicpLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogQVdTTGFtYmRhLlNOU0V2ZW50KSB7XG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdSZWNlaXZlZCBTTlMgZXZlbnQnLFxuICAgIHJlY29yZENvdW50OiBldmVudC5SZWNvcmRzLmxlbmd0aCxcbiAgfSk7XG4gIGZvciAoY29uc3QgcmVjb3JkIG9mIGV2ZW50LlJlY29yZHMpIHtcbiAgICBjb25zdCBtZXNzYWdlID0gSlNPTi5wYXJzZShyZWNvcmQuU25zLk1lc3NhZ2UpO1xuICAgIGNvbnN0IHN1bW1hcnkgPSBzdW1tYXJpemUobWVzc2FnZSk7XG4gICAgaWYgKHN1bW1hcnkpIHtcbiAgICAgIC8vIGVtYWlsIHN1YnNjcmliZXJzIGdldCB0aGUgcmVhZGFibGUgc3VtbWFyeSwgZXZlcnl0aGluZyBlbHNlIGtlZXBzIGdldHRpbmcgdGhlIG9yaWdpbmFsIEpTT05cbiAgICAgIGF3YWl0IHNucy5zZW5kKG5ldyBQdWJsaXNoQ29tbWFuZCh7XG4gICAgICAgIFRvcGljQXJuOiBwcm9jZXNzLmVudi5UQVJHRVRfVE9QSUNfQVJOLFxuICAgICAgICBTdWJqZWN0OiBzdW1tYXJ5LnN1YmplY3Quc2xpY2UoMCwgMTAwKSxcbiAgICAgICAgTWVzc2FnZVN0cnVjdHVyZTogJ2pzb24nLFxuICAgICAgICBNZXNzYWdlOiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgZGVmYXVsdDogcmVjb3JkLlNucy5NZXNzYWdlLFxuICAgICAgICAgIGVtYWlsOiBgJHtzdW1tYXJ5LnRleHR9XFxuXFxuUnVubmVycyBrZWVwIHVzaW5nIHRoZSBsYXN0IHN1Y2Nlc3NmdWxseSBidWlsdCBpbWFnZSB1bnRpbCBhIGJ1aWxkIHN1Y2NlZWRzLlxcblxcbkZ1bGwgbm90aWZpY2F0aW9uOlxcbiR7SlNPTi5zdHJpbmdpZnkobWVzc2FnZSwgbnVsbCwgMil9YCxcbiAgICAgICAgfSksXG4gICAgICB9KSk7XG4gICAgfVxuICB9XG59XG4iXX0=