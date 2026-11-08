"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_lambda_1 = require("@aws-sdk/client-lambda");
const lambda = new client_lambda_1.LambdaClient();
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
async function handler(event) {
    console.log({
        notice: 'Updating Lambda function code from container image',
        lambdaName: event.lambdaName,
        repositoryUri: event.repositoryUri,
        repositoryTag: event.repositoryTag,
    });
    while (true) {
        try {
            await lambda.send(new client_lambda_1.UpdateFunctionCodeCommand({
                FunctionName: event.lambdaName,
                ImageUri: `${event.repositoryUri}:${event.repositoryTag}`,
                Publish: true,
            }));
            break;
        }
        catch (e) {
            if (e instanceof client_lambda_1.ResourceConflictException) {
                // keep trying if function is already being updated by CloudFormation
                // this can happen if we update some settings on the function and the image code at the same time
                await sleep(10000);
            }
            else {
                throw e;
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXBkYXRlLWxhbWJkYS5sYW1iZGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvcHJvdmlkZXJzL3VwZGF0ZS1sYW1iZGEubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBY0EsMEJBMEJDO0FBeENELDBEQUE0RztBQUU1RyxNQUFNLE1BQU0sR0FBRyxJQUFJLDRCQUFZLEVBQUUsQ0FBQztBQVFsQyxTQUFTLEtBQUssQ0FBQyxFQUFVO0lBQ3ZCLE9BQU8sSUFBSSxPQUFPLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7QUFDekQsQ0FBQztBQUVNLEtBQUssVUFBVSxPQUFPLENBQUMsS0FBWTtJQUN4QyxPQUFPLENBQUMsR0FBRyxDQUFDO1FBQ1YsTUFBTSxFQUFFLG9EQUFvRDtRQUM1RCxVQUFVLEVBQUUsS0FBSyxDQUFDLFVBQVU7UUFDNUIsYUFBYSxFQUFFLEtBQUssQ0FBQyxhQUFhO1FBQ2xDLGFBQWEsRUFBRSxLQUFLLENBQUMsYUFBYTtLQUNuQyxDQUFDLENBQUM7SUFFSCxPQUFPLElBQUksRUFBRSxDQUFDO1FBQ1osSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUkseUNBQXlCLENBQUM7Z0JBQzlDLFlBQVksRUFBRSxLQUFLLENBQUMsVUFBVTtnQkFDOUIsUUFBUSxFQUFFLEdBQUcsS0FBSyxDQUFDLGFBQWEsSUFBSSxLQUFLLENBQUMsYUFBYSxFQUFFO2dCQUN6RCxPQUFPLEVBQUUsSUFBSTthQUNkLENBQUMsQ0FBQyxDQUFDO1lBQ0osTUFBTTtRQUNSLENBQUM7UUFBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQ1gsSUFBSSxDQUFDLFlBQVkseUNBQXlCLEVBQUUsQ0FBQztnQkFDM0MscUVBQXFFO2dCQUNyRSxpR0FBaUc7Z0JBQ2pHLE1BQU0sS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3JCLENBQUM7aUJBQU0sQ0FBQztnQkFDTixNQUFNLENBQUMsQ0FBQztZQUNWLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBMYW1iZGFDbGllbnQsIFVwZGF0ZUZ1bmN0aW9uQ29kZUNvbW1hbmQsIFJlc291cmNlQ29uZmxpY3RFeGNlcHRpb24gfSBmcm9tICdAYXdzLXNkay9jbGllbnQtbGFtYmRhJztcblxuY29uc3QgbGFtYmRhID0gbmV3IExhbWJkYUNsaWVudCgpO1xuXG5pbnRlcmZhY2UgSW5wdXQge1xuICByZWFkb25seSBsYW1iZGFOYW1lOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHJlcG9zaXRvcnlVcmk6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVwb3NpdG9yeVRhZzogc3RyaW5nO1xufVxuXG5mdW5jdGlvbiBzbGVlcChtczogbnVtYmVyKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQ6IElucHV0KSB7XG4gIGNvbnNvbGUubG9nKHtcbiAgICBub3RpY2U6ICdVcGRhdGluZyBMYW1iZGEgZnVuY3Rpb24gY29kZSBmcm9tIGNvbnRhaW5lciBpbWFnZScsXG4gICAgbGFtYmRhTmFtZTogZXZlbnQubGFtYmRhTmFtZSxcbiAgICByZXBvc2l0b3J5VXJpOiBldmVudC5yZXBvc2l0b3J5VXJpLFxuICAgIHJlcG9zaXRvcnlUYWc6IGV2ZW50LnJlcG9zaXRvcnlUYWcsXG4gIH0pO1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGxhbWJkYS5zZW5kKG5ldyBVcGRhdGVGdW5jdGlvbkNvZGVDb21tYW5kKHtcbiAgICAgICAgRnVuY3Rpb25OYW1lOiBldmVudC5sYW1iZGFOYW1lLFxuICAgICAgICBJbWFnZVVyaTogYCR7ZXZlbnQucmVwb3NpdG9yeVVyaX06JHtldmVudC5yZXBvc2l0b3J5VGFnfWAsXG4gICAgICAgIFB1Ymxpc2g6IHRydWUsXG4gICAgICB9KSk7XG4gICAgICBicmVhaztcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAoZSBpbnN0YW5jZW9mIFJlc291cmNlQ29uZmxpY3RFeGNlcHRpb24pIHtcbiAgICAgICAgLy8ga2VlcCB0cnlpbmcgaWYgZnVuY3Rpb24gaXMgYWxyZWFkeSBiZWluZyB1cGRhdGVkIGJ5IENsb3VkRm9ybWF0aW9uXG4gICAgICAgIC8vIHRoaXMgY2FuIGhhcHBlbiBpZiB3ZSB1cGRhdGUgc29tZSBzZXR0aW5ncyBvbiB0aGUgZnVuY3Rpb24gYW5kIHRoZSBpbWFnZSBjb2RlIGF0IHRoZSBzYW1lIHRpbWVcbiAgICAgICAgYXdhaXQgc2xlZXAoMTAwMDApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiJdfQ==