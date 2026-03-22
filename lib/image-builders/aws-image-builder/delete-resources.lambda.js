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
            error: `${e}`,
        });
        await (0, lambda_helpers_1.customResourceRespond)(event, 'FAILED', e.message || 'Internal Error', 'FAIL', {});
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLXJlc291cmNlcy5sYW1iZGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaW1hZ2UtYnVpbGRlcnMvYXdzLWltYWdlLWJ1aWxkZXIvZGVsZXRlLXJlc291cmNlcy5sYW1iZGEudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFzSUEsMEJBZ0NDO0FBdEtELG9EQUErRjtBQUMvRixvREFBeUU7QUFDekUsc0VBQXFKO0FBRXJKLHlEQUE2RDtBQUU3RCxNQUFNLEdBQUcsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztBQUM1QixNQUFNLEdBQUcsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztBQUM1QixNQUFNLEVBQUUsR0FBRyxJQUFJLHdDQUFrQixFQUFFLENBQUM7QUFVcEMsS0FBSyxVQUFVLGVBQWUsQ0FBQyxLQUEyQjtJQUN4RCxNQUFNLGNBQWMsR0FBYSxFQUFFLENBQUM7SUFDcEMsTUFBTSxZQUFZLEdBQWEsRUFBRSxDQUFDO0lBQ2xDLE1BQU0sb0JBQW9CLEdBQWEsRUFBRSxDQUFDO0lBRTFDLElBQUksTUFBTSxHQUFtQyxFQUFFLENBQUM7SUFDaEQsR0FBRyxDQUFDO1FBQ0YsTUFBTSxHQUFHLE1BQU0sRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLG1EQUE2QixDQUFDO1lBQ3ZELGVBQWUsRUFBRSxLQUFLLENBQUMsZUFBZTtZQUN0QyxTQUFTLEVBQUUsTUFBTSxDQUFDLFNBQVM7U0FDNUIsQ0FBQyxDQUFDLENBQUM7UUFDSixJQUFJLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO1lBQzVCLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxDQUFDLGdCQUFnQixFQUFFLENBQUM7Z0JBQzVDLElBQUksS0FBSyxDQUFDLEdBQUcsRUFBRSxDQUFDO29CQUNkLGNBQWMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDO2dCQUNqQyxDQUFDO2dCQUNELEtBQUssTUFBTSxNQUFNLElBQUks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LENBQUM7Z0JBQy9CLENBQUM7Z0JBQ0QsTUFBTSxJQUFBLHNDQUFxQixFQUFDLEtBQUssRUFBRSxTQUFTLEVBQUUsSUFBSSxFQUFFLEtBQUssQ0FBQyxrQkFBa0IsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDbEYsTUFBTTtRQUNWLENBQUM7SUFDSCxDQUFDO0lBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztRQUNYLE9BQU8sQ0FBQyxLQUFLLENBQUM7WUFDWixNQUFNLEVBQUUsMENBQTBDO1lBQ2xELEtBQUssRUFBRSxHQUFHLENBQUMsRUFBRTtTQUNkLENBQUMsQ0FBQztRQUNILE1BQU0sSUFBQSxzQ0FBcUIsRUFBQyxLQUFLLEVBQUUsUUFBUSxFQUFHLENBQVcsQ0FBQyxPQUFPLElBQUksZ0JBQWdCLEVBQUUsTUFBTSxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ3JHLENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRGVyZWdpc3RlckltYWdlQ29tbWFuZCwgRGVzY3JpYmVJbWFnZXNDb21tYW5kLCBFQzJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZWMyJztcbmltcG9ydCB7IEJhdGNoRGVsZXRlSW1hZ2VDb21tYW5kLCBFQ1JDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZWNyJztcbmltcG9ydCB7IERlbGV0ZUltYWdlQ29tbWFuZCwgSW1hZ2VidWlsZGVyQ2xpZW50LCBMaXN0SW1hZ2VCdWlsZFZlcnNpb25zQ29tbWFuZCwgTGlzdEltYWdlQnVpbGRWZXJzaW9uc1Jlc3BvbnNlIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWltYWdlYnVpbGRlcic7XG5pbXBvcnQgKiBhcyBBV1NMYW1iZGEgZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBjdXN0b21SZXNvdXJjZVJlc3BvbmQgfSBmcm9tICcuLi8uLi9sYW1iZGEtaGVscGVycyc7XG5cbmNvbnN0IGVjMiA9IG5ldyBFQzJDbGllbnQoKTtcbmNvbnN0IGVjciA9IG5ldyBFQ1JDbGllbnQoKTtcbmNvbnN0IGliID0gbmV3IEltYWdlYnVpbGRlckNsaWVudCgpO1xuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIERlbGV0ZVJlc291cmNlc1Byb3BzIHtcbiAgU2VydmljZVRva2VuOiBzdHJpbmc7XG4gIEltYWdlVmVyc2lvbkFybjogc3RyaW5nO1xufVxuXG5hc3luYyBmdW5jdGlvbiBkZWxldGVSZXNvdXJjZXMocHJvcHM6IERlbGV0ZVJlc291cmNlc1Byb3BzKSB7XG4gIGNvbnN0IGJ1aWxkc1RvRGVsZXRlOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBhbWlzVG9EZWxldGU6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGRvY2tlckltYWdlc1RvRGVsZXRlOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGxldCByZXN1bHQ6IExpc3RJbWFnZUJ1aWxkVmVyc2lvbnNSZXNwb25zZSA9IHt9O1xuICBkbyB7XG4gICAgcmVzdWx0ID0gYXdhaXQgaWIuc2VuZChuZXcgTGlzdEltYWdlQnVpbGRWZXJzaW9uc0NvbW1hbmQoe1xuICAgICAgaW1hZ2VWZXJzaW9uQXJuOiBwcm9wcy5JbWFnZVZlcnNpb25Bcm4sXG4gICAgICBuZXh0VG9rZW46IHJlc3VsdC5uZXh0VG9rZW4sXG4gICAgfSkpO1xuICAgIGlmIChyZXN1bHQuaW1hZ2VTdW1tYXJ5TGlzdCkge1xuICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiByZXN1bHQuaW1hZ2VTdW1tYXJ5TGlzdCkge1xuICAgICAgICBpZiAoaW1hZ2UuYXJuKSB7XG4gICAgICAgICAgYnVpbGRzVG9EZWxldGUucHVzaChpbWFnZS5hcm4pO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3Qgb3V0cHV0IG9mIGltYWdlLm91dHB1dFJlc291cmNlcz8uYW1pcyA/PyBbXSkge1xuICAgICAgICAgIGlmIChvdXRwdXQuaW1hZ2UpIHtcbiAgICAgICAgICAgIGFtaXNUb0RlbGV0ZS5wdXNoKG91dHB1dC5pbWFnZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3Qgb3V0cHV0IG9mIGltYWdlLm91dHB1dFJlc291cmNlcz8uY29udGFpbmVycyA/PyBbXSkge1xuICAgICAgICAgIGlmIChvdXRwdXQuaW1hZ2VVcmlzKSB7XG4gICAgICAgICAgICBkb2NrZXJJbWFnZXNUb0RlbGV0ZS5wdXNoKC4uLm91dHB1dC5pbWFnZVVyaXMpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfSB3aGlsZSAocmVzdWx0Lm5leHRUb2tlbik7XG5cbiAgLy8gZGVsZXRlIGFtaXNcbiAgZm9yIChjb25zdCBpbWFnZUlkIG9mIGFtaXNUb0RlbGV0ZSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ0RlbGV0aW5nIEFNSScsXG4gICAgICAgIGltYWdlOiBpbWFnZUlkLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGltYWdlRGVzYyA9IGF3YWl0IGVjMi5zZW5kKG5ldyBEZXNjcmliZUltYWdlc0NvbW1hbmQoe1xuICAgICAgICBPd25lcnM6IFsnc2VsZiddLFxuICAgICAgICBJbWFnZUlkczogW2ltYWdlSWRdLFxuICAgICAgfSkpO1xuXG4gICAgICBpZiAoaW1hZ2VEZXNjLkltYWdlcz8ubGVuZ3RoICE9PSAxKSB7XG4gICAgICAgIGNvbnNvbGUud2Fybih7XG4gICAgICAgICAgbm90aWNlOiAnVW5hYmxlIHRvIGZpbmQgQU1JJyxcbiAgICAgICAgICBpbWFnZTogaW1hZ2VJZCxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBhd2FpdCBlYzIuc2VuZChuZXcgRGVyZWdpc3RlckltYWdlQ29tbWFuZCh7XG4gICAgICAgIEltYWdlSWQ6IGltYWdlSWQsXG4gICAgICAgIERlbGV0ZUFzc29jaWF0ZWRTbmFwc2hvdHM6IHRydWUsXG4gICAgICB9KSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKHtcbiAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIGRlbGV0ZSBBTUknLFxuICAgICAgICBpbWFnZTogaW1hZ2VJZCxcbiAgICAgICAgZXJyb3I6IGUsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBkZWxldGUgZG9ja2VyIGltYWdlc1xuICBmb3IgKGNvbnN0IGltYWdlIG9mIGRvY2tlckltYWdlc1RvRGVsZXRlKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnRGVsZXRpbmcgRG9ja2VyIEltYWdlJyxcbiAgICAgICAgaW1hZ2UsXG4gICAgICB9KTtcblxuICAgICAgLy8gaW1hZ2UgbG9va3MgbGlrZSAwMTIzNDU2Nzg5LmRrci5lY3IudXMtZWFzdC0xLmFtYXpvbmF3cy5jb20vZ2l0aHViLXJ1bm5lcnMtdGVzdC13aW5kb3dzaW1hZ2VidWlsZGVycmVwb3NpdG9yeWE0Y2JiNmQ4LWhlaGRsOTlyN3MzZDoxLjAuMTAtMVxuICAgICAgY29uc3QgcGFydHMgPSBpbWFnZS5zcGxpdCgnLycpWzFdLnNwbGl0KCc6Jyk7XG4gICAgICBjb25zdCByZXBvID0gcGFydHNbMF07XG4gICAgICBjb25zdCB0YWcgPSBwYXJ0c1sxXTtcblxuICAgICAgLy8gZGVsZXRlIGltYWdlXG4gICAgICBhd2FpdCBlY3Iuc2VuZChuZXcgQmF0Y2hEZWxldGVJbWFnZUNvbW1hbmQoe1xuICAgICAgICByZXBvc2l0b3J5TmFtZTogcmVwbyxcbiAgICAgICAgaW1hZ2VJZHM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBpbWFnZVRhZzogdGFnLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9KSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKHtcbiAgICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIGRlbGV0ZSBkb2NrZXIgaW1hZ2UnLFxuICAgICAgICBpbWFnZSxcbiAgICAgICAgZXJyb3I6IGUsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyBkZWxldGUgYnVpbGRzIChsYXN0IHNvIHJldHJpZXMgd291bGQgc3RpbGwgd29yaylcbiAgZm9yIChjb25zdCBidWlsZCBvZiBidWlsZHNUb0RlbGV0ZSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zb2xlLmxvZyh7XG4gICAgICAgIG5vdGljZTogJ0RlbGV0aW5nIEltYWdlIEJ1aWxkJyxcbiAgICAgICAgYnVpbGQsXG4gICAgICB9KTtcblxuICAgICAgYXdhaXQgaWIuc2VuZChuZXcgRGVsZXRlSW1hZ2VDb21tYW5kKHtcbiAgICAgICAgaW1hZ2VCdWlsZFZlcnNpb25Bcm46IGJ1aWxkLFxuICAgICAgfSkpO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGNvbnNvbGUud2Fybih7XG4gICAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBkZWxldGUgaW1hZ2UgdmVyc2lvbiBidWlsZCcsXG4gICAgICAgIGJ1aWxkLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogQVdTTGFtYmRhLkNsb3VkRm9ybWF0aW9uQ3VzdG9tUmVzb3VyY2VFdmVudCwgX2NvbnRleHQ6IEFXU0xhbWJkYS5Db250ZXh0KSB7XG4gIHRyeSB7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnQ2xvdWRGb3JtYXRpb24gY3VzdG9tIHJlc291cmNlIHJlcXVlc3QnLFxuICAgICAgLi4uZXZlbnQsXG4gICAgICBSZXNwb25zZVVSTDogJy4uLicsXG4gICAgfSk7XG5cbiAgICBjb25zdCBwcm9wcyA9IGV2ZW50LlJlc291cmNlUHJvcGVydGllcyBhcyBEZWxldGVSZXNvdXJjZXNQcm9wcztcblxuICAgIHN3aXRjaCAoZXZlbnQuUmVxdWVzdFR5cGUpIHtcbiAgICAgIGNhc2UgJ0NyZWF0ZSc6XG4gICAgICBjYXNlICdVcGRhdGUnOlxuICAgICAgICAvLyB3ZSBqdXN0IHJldHVybiB0aGUgYXJuIGFzIHRoZSBwaHlzaWNhbCBpZFxuICAgICAgICAvLyB0aGlzIHdheSBhIGNoYW5nZSBpbiB0aGUgdmVyc2lvbiB3aWxsIHRyaWdnZXIgZGVsZXRlIG9mIHRoZSBvbGQgdmVyc2lvbiBvbiBjbGVhbnVwIG9mIHN0YWNrXG4gICAgICAgIC8vIGl0IHdpbGwgYWxzbyB0cmlnZ2VyIGRlbGV0ZSBvbiBzdGFjayBkZWxldGlvblxuICAgICAgICBhd2FpdCBjdXN0b21SZXNvdXJjZVJlc3BvbmQoZXZlbnQsICdTVUNDRVNTJywgJ09LJywgcHJvcHMuSW1hZ2VWZXJzaW9uQXJuLCB7fSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnRGVsZXRlJzpcbiAgICAgICAgaWYgKGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCAhPSAnRkFJTCcpIHtcbiAgICAgICAgICBhd2FpdCBkZWxldGVSZXNvdXJjZXMocHJvcHMpO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IGN1c3RvbVJlc291cmNlUmVzcG9uZChldmVudCwgJ1NVQ0NFU1MnLCAnT0snLCBldmVudC5QaHlzaWNhbFJlc291cmNlSWQsIHt9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdGYWlsZWQgdG8gZGVsZXRlIEltYWdlIEJ1aWxkZXIgcmVzb3VyY2VzJyxcbiAgICAgIGVycm9yOiBgJHtlfWAsXG4gICAgfSk7XG4gICAgYXdhaXQgY3VzdG9tUmVzb3VyY2VSZXNwb25kKGV2ZW50LCAnRkFJTEVEJywgKGUgYXMgRXJyb3IpLm1lc3NhZ2UgfHwgJ0ludGVybmFsIEVycm9yJywgJ0ZBSUwnLCB7fSk7XG4gIH1cbn1cbiJdfQ==