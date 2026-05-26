"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_ec2_1 = require("@aws-sdk/client-ec2");
const client_ecr_1 = require("@aws-sdk/client-ecr");
const client_imagebuilder_1 = require("@aws-sdk/client-imagebuilder");
const lambda_helpers_1 = require("../../lambda-helpers");
const ec2 = new client_ec2_1.EC2Client();
const ecr = new client_ecr_1.ECRClient();
const ib = new client_imagebuilder_1.ImagebuilderClient();
async function deleteResources(props) {
    const buildsToDelete = [];
    const amisToDelete = [];
    const dockerImagesToDelete = [];
    let result = {};
    do {
        result = await ib.send(new client_imagebuilder_1.ListImageBuildVersionsCommand({
            imageVersionArn: props.ImageVersionArn,
            nextToken: result.nextToken,
        }));
        if (result.imageSummaryList) {
            for (const image of result.imageSummaryList) {
                if (image.arn) {
                    buildsToDelete.push(image.arn);
                }
                for (const output of image.outputResources?.amis ?? []) {
                    if (output.image) {
                        amisToDelete.push(output.image);
                    }
                }
                for (const output of image.outputResources?.containers ?? []) {
                    if (output.imageUris) {
                        dockerImagesToDelete.push(...output.imageUris);
                    }
                }
            }
        }
    } while (result.nextToken);
    // delete amis
    for (const imageId of amisToDelete) {
        try {
            console.log({
                notice: 'Deleting AMI',
                image: imageId,
            });
            const imageDesc = await ec2.send(new client_ec2_1.DescribeImagesCommand({
                Owners: ['self'],
                ImageIds: [imageId],
            }));
            if (imageDesc.Images?.length !== 1) {
                console.warn({
                    notice: 'Unable to find AMI',
                    image: imageId,
                });
                continue;
            }
            await ec2.send(new client_ec2_1.DeregisterImageCommand({
                ImageId: imageId,
                DeleteAssociatedSnapshots: true,
            }));
        }
        catch (e) {
            console.warn({
                notice: 'Failed to delete AMI',
                image: imageId,
                error: e,
            });
        }
    }
    // delete docker images
    for (const image of dockerImagesToDelete) {
        try {
            console.log({
                notice: 'Deleting Docker Image',
                image,
            });
            // image looks like 0123456789.dkr.ecr.us-east-1.amazonaws.com/github-runners-test-windowsimagebuilderrepositorya4cbb6d8-hehdl99r7s3d:1.0.10-1
            const parts = image.split('/')[1].split(':');
            const repo = parts[0];
            const tag = parts[1];
            // delete image
            await ecr.send(new client_ecr_1.BatchDeleteImageCommand({
                repositoryName: repo,
                imageIds: [
                    {
                        imageTag: tag,
                    },
                ],
            }));
        }
        catch (e) {
            console.warn({
                notice: 'Failed to delete docker image',
                image,
                error: e,
            });
        }
    }
    // delete builds (last so retries would still work)
    for (const build of buildsToDelete) {
        try {
            console.log({
                notice: 'Deleting Image Build',
                build,
            });
            await ib.send(new client_imagebuilder_1.DeleteImageCommand({
                imageBuildVersionArn: build,
            }));
        }
        catch (e) {
            console.warn({
                notice: 'Failed to delete image version build',
                build,
                error: e,
            });
        }
    }
}
async function handler(event, _context) {
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
                // we just return the arn as the physical id
                // this way a change in the version will trigger delete of the old version on cleanup of stack
                // it will also trigger delete on stack deletion
                await (0, lambda_helpers_1.customResourceRespond)(event, 'SUCCESS', 'OK', props.ImageVersionArn, {});
                break;
            case 'Delete':
                if (event.PhysicalResourceId != 'FAIL') {
                    await deleteResources(props);
                }
                await (0, lambda_helpers_1.customResourceRespond)(event, 'SUCCESS', 'OK', event.PhysicalResourceId, {});
                break;
        }
    }
    catch (e) {
        console.error({
            notice: 'Failed to delete Image Builder resources',
            error: e,
        });
        await (0, lambda_helpers_1.customResourceRespond)(event, 'FAILED', e.message || 'Internal Error', 'FAIL', {});
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLXJlc291cmNlcy5sYW1iZGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaW1hZ2UtYnVpbGRlcnMvYXdzLWltYWdlLWJ1aWxkZXIvZGVsZXRlLXJlc291cmNlcy5sYW1iZGEudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFzSUEsMEJBZ0NDO0FBdEtELG9EQUErRjtBQUMvRixvREFBeUU7QUFDekUsc0VBQXFKO0FBRXJKLHlEQUE2RDtBQUU3RCxNQUFNLEdBQUcsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztBQUM1QixNQUFNLEdBQUcsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztBQUM1QixNQUFNLEVBQUUsR0FBRyxJQUFJLHdDQUFrQixFQUFFLENBQUM7QUFVcEMsS0FBSyxVQUFVLGVBQWUsQ0FBQyxLQUEyQjtJQUN4RCxNQUFNLGNBQWMsR0FBYSxFQUFFLENBQUM7SUFDcEMsTUFBTSxZQUFZLEdBQWEsRUFBRSxDQUFDO0lBQ2xDLE1BQU0sb0JBQW9CLEdBQWEsRUFBRSxDQUFDO0lBRTFDLElBQUksTUFBTSxHQUFtQyxFQUFFLENBQUM7SUFDaEQsR0FBRyxDQUFDO1FBQ0YsTUFBTSxHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLG1EQUE2QixDQUFDO1lBQ3ZELGVBQWUsRUFBRSxLQUFLLENBQUMsZUFBZTtZQUN0QyxTQUFTLEVBQUUsTUFBTSxDQUFDLFNBQVM7U0FDNUIsQ0FBQyxDQUFDLENBQUM7UUFDSixJQUFJLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQzVCLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxDQUFDLGdCQUFnQixFQUFFLENBQUM7Z0JBQzVDLElBQUksS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDO29CQUNkLGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNqQyxDQUFDO2dCQUNELEtBQUssTUFBTSxNQUFNLElBQUks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LENBQUM7Z0JBQy9CLENBQUM7Z0JBQ0QsTUFBTSxJQUFBLHNDQUFxQixFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDbEYsTUFBTTtRQUNWLENBQUM7SUFDSCxDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsMENBQTBDO1lBQ2xELEtBQUssRUFBRSxDQUFDO1NBQ1QsQ0FBQyxDQUFDO1FBQ0gsTUFBTSxJQUFBLHNDQUFxQixFQUFDLEtBQUssRUFBRSxRQUFRLEVBQUcsQ0FBVyxDQUFDLE9BQU8sSUFBSSxnQkFBZ0IsRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDckcsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBEZXJlZ2lzdGVySW1hZ2VDb21tYW5kLCBEZXNjcmliZUltYWdlc0NvbW1hbmQsIEVDMkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1lYzInO1xuaW1wb3J0IHsgQmF0Y2hEZWxldGVJbWFnZUNvbW1hbmQsIEVDUkNsaWVudCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1lY3InO1xuaW1wb3J0IHsgRGVsZXRlSW1hZ2VDb21tYW5kLCBJbWFnZWJ1aWxkZXJDbGllbnQsIExpc3RJbWFnZUJ1aWxkVmVyc2lvbnNDb21tYW5kLCBMaXN0SW1hZ2VCdWlsZFZlcnNpb25zUmVzcG9uc2UgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtaW1hZ2VidWlsZGVyJztcbmltcG9ydCAqIGFzIEFXU0xhbWJkYSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGN1c3RvbVJlc291cmNlUmVzcG9uZCB9IGZyb20gJy4uLy4uL2xhbWJkYS1oZWxwZXJzJztcblxuY29uc3QgZWMyID0gbmV3IEVDMkNsaWVudCgpO1xuY29uc3QgZWNyID0gbmV3IEVDUkNsaWVudCgpO1xuY29uc3QgaWIgPSBuZXcgSW1hZ2VidWlsZGVyQ2xpZW50KCk7XG5cbi8qKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlUmVzb3VyY2VzUHJvcHMge1xuICBTZXJ2aWNlVG9rZW46IHN0cmluZztcbiAgSW1hZ2VWZXJzaW9uQXJuOiBzdHJpbmc7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRlbGV0ZVJlc291cmNlcyhwcm9wczogRGVsZXRlUmVzb3VyY2VzUHJvcHMpIHtcbiAgY29uc3QgYnVpbGRzVG9EZWxldGU6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGFtaXNUb0RlbGV0ZTogc3RyaW5nW10gPSBbXTtcbiAgY29uc3QgZG9ja2VySW1hZ2VzVG9EZWxldGU6IHN0cmluZ1tdID0gW107XG5cbiAgbGV0IHJlc3VsdDogTGlzdEltYWdlQnVpbGRWZXJzaW9uc1Jlc3BvbnNlID0ge307XG4gIGRvIHtcbiAgICByZXN1bHQgPSBhd2FpdCBpYi5zZW5kKG5ldyBMaXN0SW1hZ2VCdWlsZFZlcnNpb25zQ29tbWFuZCh7XG4gICAgICBpbWFnZVZlcnNpb25Bcm46IHByb3BzLkltYWdlVmVyc2lvbkFybixcbiAgICAgIG5leHRUb2tlbjogcmVzdWx0Lm5leHRUb2tlbixcbiAgICB9KSk7XG4gICAgaWYgKHJlc3VsdC5pbWFnZVN1bW1hcnlMaXN0KSB7XG4gICAgICBmb3IgKGNvbnN0IGltYWdlIG9mIHJlc3VsdC5pbWFnZVN1bW1hcnlMaXN0KSB7XG4gICAgICAgIGlmIChpbWFnZS5hcm4pIHtcbiAgICAgICAgICBidWlsZHNUb0RlbGV0ZS5wdXNoKGltYWdlLmFybik7XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBvdXRwdXQgb2YgaW1hZ2Uub3V0cHV0UmVzb3VyY2VzPy5hbWlzID8/IFtdKSB7XG4gICAgICAgICAgaWYgKG91dHB1dC5pbWFnZSkge1xuICAgICAgICAgICAgYW1pc1RvRGVsZXRlLnB1c2gob3V0cHV0LmltYWdlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBvdXRwdXQgb2YgaW1hZ2Uub3V0cHV0UmVzb3VyY2VzPy5jb250YWluZXJzID8/IFtdKSB7XG4gICAgICAgICAgaWYgKG91dHB1dC5pbWFnZVVyaXMpIHtcbiAgICAgICAgICAgIGRvY2tlckltYWdlc1RvRGVsZXRlLnB1c2goLi4ub3V0cHV0LmltYWdlVXJpcyk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9IHdoaWxlIChyZXN1bHQubmV4dFRva2VuKTtcblxuICAvLyBkZWxldGUgYW1pc1xuICBmb3IgKGNvbnN0IGltYWdlSWQgb2YgYW1pc1RvRGVsZXRlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnRGVsZXRpbmcgQU1JJyxcbiAgICAgICAgaW1hZ2U6IGltYWdlSWQsXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgaW1hZ2VEZXNjID0gYXdhaXQgZWMyLnNlbmQobmV3IERlc2NyaWJlSW1hZ2VzQ29tbWFuZCh7XG4gICAgICAgIE93bmVyczogWydzZWxmJ10sXG4gICAgICAgIEltYWdlSWRzOiBbaW1hZ2VJZF0sXG4gICAgICB9KSk7XG5cbiAgICAgIGlmIChpbWFnZURlc2MuSW1hZ2VzPy5sZW5ndGggIT09IDEpIHtcbiAgICAgICAgY29uc29sZS53YXJuKHtcbiAgICAgICAgICBub3RpY2U6ICdVbmFibGUgdG8gZmluZCBBTUknLFxuICAgICAgICAgIGltYWdlOiBpbWFnZUlkLFxuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGF3YWl0IGVjMi5zZW5kKG5ldyBEZXJlZ2lzdGVySW1hZ2VDb21tYW5kKHtcbiAgICAgICAgSW1hZ2VJZDogaW1hZ2VJZCxcbiAgICAgICAgRGVsZXRlQXNzb2NpYXRlZFNuYXBzaG90czogdHJ1ZSxcbiAgICAgIH0pKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oe1xuICAgICAgICBub3RpY2U6ICdGYWlsZWQgdG8gZGVsZXRlIEFNSScsXG4gICAgICAgIGltYWdlOiBpbWFnZUlkLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIGRlbGV0ZSBkb2NrZXIgaW1hZ2VzXG4gIGZvciAoY29uc3QgaW1hZ2Ugb2YgZG9ja2VySW1hZ2VzVG9EZWxldGUpIHtcbiAgICB0cnkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdEZWxldGluZyBEb2NrZXIgSW1hZ2UnLFxuICAgICAgICBpbWFnZSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBpbWFnZSBsb29rcyBsaWtlIDAxMjM0NTY3ODkuZGtyLmVjci51cy1lYXN0LTEuYW1hem9uYXdzLmNvbS9naXRodWItcnVubmVycy10ZXN0LXdpbmRvd3NpbWFnZWJ1aWxkZXJyZXBvc2l0b3J5YTRjYmI2ZDgtaGVoZGw5OXI3czNkOjEuMC4xMC0xXG4gICAgICBjb25zdCBwYXJ0cyA9IGltYWdlLnNwbGl0KCcvJylbMV0uc3BsaXQoJzonKTtcbiAgICAgIGNvbnN0IHJlcG8gPSBwYXJ0c1swXTtcbiAgICAgIGNvbnN0IHRhZyA9IHBhcnRzWzFdO1xuXG4gICAgICAvLyBkZWxldGUgaW1hZ2VcbiAgICAgIGF3YWl0IGVjci5zZW5kKG5ldyBCYXRjaERlbGV0ZUltYWdlQ29tbWFuZCh7XG4gICAgICAgIHJlcG9zaXRvcnlOYW1lOiByZXBvLFxuICAgICAgICBpbWFnZUlkczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGltYWdlVGFnOiB0YWcsXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgIH0pKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBjb25zb2xlLndhcm4oe1xuICAgICAgICBub3RpY2U6ICdGYWlsZWQgdG8gZGVsZXRlIGRvY2tlciBpbWFnZScsXG4gICAgICAgIGltYWdlLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIGRlbGV0ZSBidWlsZHMgKGxhc3Qgc28gcmV0cmllcyB3b3VsZCBzdGlsbCB3b3JrKVxuICBmb3IgKGNvbnN0IGJ1aWxkIG9mIGJ1aWxkc1RvRGVsZXRlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnRGVsZXRpbmcgSW1hZ2UgQnVpbGQnLFxuICAgICAgICBidWlsZCxcbiAgICAgIH0pO1xuXG4gICAgICBhd2FpdCBpYi5zZW5kKG5ldyBEZWxldGVJbWFnZUNvbW1hbmQoe1xuICAgICAgICBpbWFnZUJ1aWxkVmVyc2lvbkFybjogYnVpbGQsXG4gICAgICB9KSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKHtcbiAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIGRlbGV0ZSBpbWFnZSB2ZXJzaW9uIGJ1aWxkJyxcbiAgICAgICAgYnVpbGQsXG4gICAgICAgIGVycm9yOiBlLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKGV2ZW50OiBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50LCBfY29udGV4dDogQVdTTGFtYmRhLkNvbnRleHQpIHtcbiAgdHJ5IHtcbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdDbG91ZEZvcm1hdGlvbiBjdXN0b20gcmVzb3VyY2UgcmVxdWVzdCcsXG4gICAgICAuLi5ldmVudCxcbiAgICAgIFJlc3BvbnNlVVJMOiAnLi4uJyxcbiAgICB9KTtcblxuICAgIGNvbnN0IHByb3BzID0gZXZlbnQuUmVzb3VyY2VQcm9wZXJ0aWVzIGFzIERlbGV0ZVJlc291cmNlc1Byb3BzO1xuXG4gICAgc3dpdGNoIChldmVudC5SZXF1ZXN0VHlwZSkge1xuICAgICAgY2FzZSAnQ3JlYXRlJzpcbiAgICAgIGNhc2UgJ1VwZGF0ZSc6XG4gICAgICAgIC8vIHdlIGp1c3QgcmV0dXJuIHRoZSBhcm4gYXMgdGhlIHBoeXNpY2FsIGlkXG4gICAgICAgIC8vIHRoaXMgd2F5IGEgY2hhbmdlIGluIHRoZSB2ZXJzaW9uIHdpbGwgdHJpZ2dlciBkZWxldGUgb2YgdGhlIG9sZCB2ZXJzaW9uIG9uIGNsZWFudXAgb2Ygc3RhY2tcbiAgICAgICAgLy8gaXQgd2lsbCBhbHNvIHRyaWdnZXIgZGVsZXRlIG9uIHN0YWNrIGRlbGV0aW9uXG4gICAgICAgIGF3YWl0IGN1c3RvbVJlc291cmNlUmVzcG9uZChldmVudCwgJ1NVQ0NFU1MnLCAnT0snLCBwcm9wcy5JbWFnZVZlcnNpb25Bcm4sIHt9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdEZWxldGUnOlxuICAgICAgICBpZiAoZXZlbnQuUGh5c2ljYWxSZXNvdXJjZUlkICE9ICdGQUlMJykge1xuICAgICAgICAgIGF3YWl0IGRlbGV0ZVJlc291cmNlcyhwcm9wcyk7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgY3VzdG9tUmVzb3VyY2VSZXNwb25kKGV2ZW50LCAnU1VDQ0VTUycsICdPSycsIGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCwge30pO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLmVycm9yKHtcbiAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBkZWxldGUgSW1hZ2UgQnVpbGRlciByZXNvdXJjZXMnLFxuICAgICAgZXJyb3I6IGUsXG4gICAgfSk7XG4gICAgYXdhaXQgY3VzdG9tUmVzb3VyY2VSZXNwb25kKGV2ZW50LCAnRkFJTEVEJywgKGUgYXMgRXJyb3IpLm1lc3NhZ2UgfHwgJ0ludGVybmFsIEVycm9yJywgJ0ZBSUwnLCB7fSk7XG4gIH1cbn1cbiJdfQ==