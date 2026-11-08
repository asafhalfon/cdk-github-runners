"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLEANER_PHYSICAL_RESOURCE_ID = void 0;
exports.handler = handler;
const client_ec2_1 = require("@aws-sdk/client-ec2");
const client_ecr_1 = require("@aws-sdk/client-ecr");
const client_imagebuilder_1 = require("@aws-sdk/client-imagebuilder");
const lambda_helpers_1 = require("../../lambda-helpers");
const ec2 = new client_ec2_1.EC2Client();
const ecr = new client_ecr_1.ECRClient();
const ib = new client_imagebuilder_1.ImagebuilderClient();
/**
 * Physical resource id we hand out when the custom resource is first created.
 *
 * The id itself matters less than the fact that it never changes. We never want to see a replacement as that would cause us to delete all images, and
 * they might still be in use. That's also why on `Update` we just echo back whatever id came in (and it will be different for upgrades). Updates, and
 * rollbacks of updates, leave the resource alone. That's what makes it safe to delete everything we find on `Delete`.
 *
 * Stacks that predate this version keep the image version ARN they were given as their id, forever, and that's fine. What tells a real removal from a
 * leftover of the old behavior is the properties, not the id. See `deleteAllResources`.
 *
 * @internal
 */
exports.CLEANER_PHYSICAL_RESOURCE_ID = 'runner-images-deleted-when-builder-is-removed';
/**
 * Number of finished images we keep around on the scheduled cleanup, on top of the image that's currently in use. It gives us something to fall back
 * on, and keeps an image built by a deployment that later rolled back from being collected the moment it's built.
 */
const KEEP_IMAGES = 2;
/**
 * Images that are done building. Anything else is still on its way to the launch template, as distribution is one of the build steps, so we never
 * touch it. The full list of states also has PENDING, CREATING, BUILDING, TESTING, DISTRIBUTING, and INTEGRATING.
 */
const DELETABLE_IMAGE_STATUSES = [
    'AVAILABLE',
    'DEPRECATED',
    'FAILED',
    'CANCELLED',
];
/**
 * The launch template is gone for good, so there is no AMI left for us to protect. Any other error means we simply don't know which AMI is in use,
 * which is not the same as knowing no AMI is in use.
 */
const MISSING_LAUNCH_TEMPLATE_ERRORS = [
    'InvalidLaunchTemplateId.NotFound',
    'InvalidLaunchTemplateId.Malformed',
];
/**
 * Someone already deregistered the AMI, or Image Builder recorded an id we can never act on. Either way there is nothing left of it to lose track of,
 * so the build that points at it can go. DescribeImages raises these rather than returning an empty list when it is given an explicit image id.
 *
 * Treating them as anything else would leave the build behind forever, failing every scheduled run and every delete for an AMI that is already gone.
 */
const MISSING_AMI_ERRORS = [
    'InvalidAMIID.NotFound',
    'InvalidAMIID.Unavailable',
    'InvalidAMIID.Malformed',
];
/**
 * The repository, or the image in it, is already gone. Same reasoning as `MISSING_AMI_ERRORS`.
 */
const MISSING_DOCKER_IMAGE_ERRORS = [
    'RepositoryNotFoundException',
    'ImageNotFoundException',
];
/**
 * The image build is already gone, so there is nothing left to delete. Same reasoning as `MISSING_AMI_ERRORS`.
 */
const MISSING_BUILD_ERRORS = [
    'ResourceNotFoundException',
];
/**
 * Get the AMI the launch template points at, so we know not to delete an image that's still in use.
 *
 * EC2 Image Builder sets the default version of the launch template outside of CloudFormation, and RunInstances uses that same default version, so
 * it's the only reliable answer to "which AMI is in use". Note this is `$Default` and not `$Latest`.
 *
 * Returns undefined when the launch template is gone, or when its default version has no AMI yet, as neither leaves an AMI in use. Throws on any
 * other error so the caller can leave everything alone.
 */
async function launchTemplateAmi(launchTemplateId) {
    try {
        const versions = await ec2.send(new client_ec2_1.DescribeLaunchTemplateVersionsCommand({
            LaunchTemplateId: launchTemplateId,
            Versions: ['$Default'],
        }));
        return versions.LaunchTemplateVersions?.[0]?.LaunchTemplateData?.ImageId;
    }
    catch (e) {
        if (MISSING_LAUNCH_TEMPLATE_ERRORS.includes(e.name)) {
            console.log({
                notice: 'Launch template is gone or empty, so no AMI needs to be protected',
                launchTemplate: launchTemplateId,
                error: e.name,
            });
            return undefined;
        }
        throw e;
    }
}
/**
 * Get the image builds of every version of the recipe.
 *
 * Every version is listed and not just the current one. Recipe versions change with every component change, so leftovers from interrupted deployments
 * would otherwise stay around forever. `includeDeprecated` is required or deprecated versions are never returned and can never be cleaned up.
 *
 * The `name` filter is case-sensitive, so it has to be the recipe name as written and not the lowercased form that image ARNs use.
 */
async function recipeBuilds(recipeName) {
    const builds = [];
    let listed = 0;
    let versions = {};
    do {
        versions = await ib.send(new client_imagebuilder_1.ListImagesCommand({
            owner: 'Self',
            filters: [{ name: 'name', values: [recipeName] }],
            includeDeprecated: true,
            nextToken: versions.nextToken,
        }));
        for (const version of versions.imageVersionList ?? []) {
            if (!version.arn) {
                continue;
            }
            listed++;
            let result = {};
            do {
                result = await ib.send(new client_imagebuilder_1.ListImageBuildVersionsCommand({
                    imageVersionArn: version.arn,
                    nextToken: result.nextToken,
                }));
                builds.push(...result.imageSummaryList ?? []);
            } while (result.nextToken);
        }
    } while (versions.nextToken);
    console.log({
        notice: 'Listed image versions',
        recipe: recipeName,
        versions: listed,
        builds: builds.length,
    });
    return builds;
}
function buildDate(build) {
    return (build.dateCreated ? Date.parse(build.dateCreated) : 0) || 0;
}
/**
 * Returns false if the AMI is still out there, so the caller knows to keep the build that points at it. An AMI we can no longer find is not a
 * failure, as there is nothing left to lose track of.
 */
async function deleteAmi(imageId) {
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
            return true;
        }
        await ec2.send(new client_ec2_1.DeregisterImageCommand({
            ImageId: imageId,
            DeleteAssociatedSnapshots: true,
        }));
        return true;
    }
    catch (e) {
        if (MISSING_AMI_ERRORS.includes(e.name)) {
            console.log({
                notice: 'AMI is already gone',
                image: imageId,
                error: e.name,
            });
            return true;
        }
        console.warn({
            notice: 'Failed to delete AMI',
            image: imageId,
            error: e,
        });
        return false;
    }
}
/**
 * Returns false if the tag is still out there, so the caller knows to keep the build that points at it. Skipping 'latest' is not a failure, as it is
 * never ours to delete and every Docker build carries it.
 */
async function deleteDockerImage(image) {
    try {
        console.log({
            notice: 'Deleting Docker Image',
            image,
        });
        // image looks like 0123456789.dkr.ecr.us-east-1.amazonaws.com/github-runners-test-windowsimagebuilderrepositorya4cbb6d8-hehdl99r7s3d:1.0.10-1
        const parts = image.split('/')[1].split(':');
        const repo = parts[0];
        const tag = parts[1];
        // skip 'latest' as it's a shared tag across recipe versions.
        // without this skip, simple recipe upgrades will end up with latest being gone and runners not starting.
        // old image versions will still point to 'latest' even when a new one replaced it.
        // the repository is a child of the builder, so removing the builder or destroying the stack takes it with them and
        // ecr.Repository(... emptyOnDelete: true ...) takes care of the tag.
        if (tag === 'latest') {
            console.log({
                notice: 'Skipping latest tag as it is shared and still in use',
                image,
            });
            return true;
        }
        await ecr.send(new client_ecr_1.BatchDeleteImageCommand({
            repositoryName: repo,
            imageIds: [
                {
                    imageTag: tag,
                },
            ],
        }));
        return true;
    }
    catch (e) {
        if (MISSING_DOCKER_IMAGE_ERRORS.includes(e.name)) {
            console.log({
                notice: 'Docker image is already gone',
                image,
                error: e.name,
            });
            return true;
        }
        console.warn({
            notice: 'Failed to delete docker image',
            image,
            error: e,
        });
        return false;
    }
}
/**
 * Returns false if the build is still there, so the caller knows something was left behind.
 */
async function deleteBuild(build) {
    try {
        console.log({
            notice: 'Deleting Image Build',
            build,
        });
        await ib.send(new client_imagebuilder_1.DeleteImageCommand({
            imageBuildVersionArn: build,
        }));
        return true;
    }
    catch (e) {
        if (MISSING_BUILD_ERRORS.includes(e.name)) {
            console.log({
                notice: 'Image build is already gone',
                build,
                error: e.name,
            });
            return true;
        }
        console.warn({
            notice: 'Failed to delete image version build',
            build,
            error: e,
        });
        return false;
    }
}
/**
 * Delete the given builds along with everything they produced. The EC2 Image Builder resource is the only way back to an AMI or a Docker image, so a
 * build is deleted last and only once everything it points at is gone. Leave one behind and whatever it produced leaks with no way to find it again.
 *
 * Deletes everything it can first, and only then reports what was left behind. A scheduled run is retried by Lambda and then again the next day. A
 * custom resource responds FAILED, which CloudFormation retries every few minutes before it gives up and skips the resource, and which the user sees
 * either way instead of quietly paying for AMIs nothing will ever come back for.
 *
 * Every one of those retries relists the recipe, so it picks up exactly what the last attempt could not delete. That only works because the builds
 * pointing at those leftovers were kept: delete a build and its AMI is unreachable, so the retry would find nothing left to do.
 */
async function deleteBuilds(builds) {
    const leftBehind = new Set();
    for (const build of builds) {
        for (const output of build.outputResources?.amis ?? []) {
            if (output.image && !await deleteAmi(output.image)) {
                leftBehind.add(build);
            }
        }
        for (const output of build.outputResources?.containers ?? []) {
            for (const image of output.imageUris ?? []) {
                if (!await deleteDockerImage(image)) {
                    leftBehind.add(build);
                }
            }
        }
    }
    for (const build of builds) {
        if (!build.arn) {
            continue;
        }
        if (leftBehind.has(build)) {
            // keep it, so the next run can still find what we could not delete
            console.warn({
                notice: 'Keeping image build as not everything it produced could be deleted',
                build: build.arn,
            });
            continue;
        }
        if (!await deleteBuild(build.arn)) {
            leftBehind.add(build);
        }
    }
    if (leftBehind.size > 0) {
        throw new Error(`Failed to delete ${leftBehind.size} of ${builds.length} runner image builds. See the log for the error of each one.`);
    }
}
/**
 * Scheduled cleanup of one builder. Keeps the image that's in use, the newest few images, and anything that hasn't finished building.
 */
async function deleteOldResources(target) {
    if (!target.RecipeName) {
        console.warn({
            notice: 'No recipe name, nothing to clean up',
        });
        return;
    }
    let protectedAmi;
    if (target.LaunchTemplateId) {
        try {
            protectedAmi = await launchTemplateAmi(target.LaunchTemplateId);
        }
        catch (e) {
            // we can't tell which AMI is in use, so we leave everything alone and try again tomorrow
            console.warn({
                notice: 'Unable to read launch template, skipping cleanup so an AMI in use is not deleted',
                launchTemplate: target.LaunchTemplateId,
                error: e,
            });
            return;
        }
    }
    // unfinished builds may still be on their way to the launch template, so they are never deleted and never counted
    const finished = (await recipeBuilds(target.RecipeName)).filter(build => {
        if (build.state?.status && DELETABLE_IMAGE_STATUSES.includes(build.state.status)) {
            return true;
        }
        console.log({
            notice: 'Keeping build as it has not finished yet',
            build: build.arn,
            status: build.state?.status,
        });
        return false;
    });
    // newest first, so the newest few can be kept
    finished.sort((a, b) => buildDate(b) - buildDate(a));
    // remove any non-successful build + all successful builds after the first KEEP_IMAGES, but skip protectedAmi
    const successful = finished.filter(build => build.state?.status === 'AVAILABLE');
    const unsuccessful = finished.filter(build => build.state?.status !== 'AVAILABLE');
    const oldBuilds = unsuccessful.concat(successful.slice(KEEP_IMAGES)).filter(build => {
        if (protectedAmi && (build.outputResources?.amis ?? []).some(ami => ami.image === protectedAmi)) {
            console.log({
                notice: 'Keeping build as its AMI is used by the launch template',
                build: build.arn,
                image: protectedAmi,
            });
            return false;
        }
        return true;
    });
    console.log({
        notice: 'Deleting old images',
        recipe: target.RecipeName,
        found: finished.length,
        deleting: oldBuilds.length,
    });
    await deleteBuilds(oldBuilds);
}
/**
 * Name of the recipe that built a given image version, read off one of its builds.
 *
 * EC2 Image Builder names an image after the recipe that built it, and unlike the name inside the ARN this one keeps the original casing that the
 * ListImages filter needs. One page is enough, as every build of a version carries the same name.
 */
async function recipeOfImageVersion(imageVersionArn) {
    try {
        const builds = await ib.send(new client_imagebuilder_1.ListImageBuildVersionsCommand({ imageVersionArn }));
        return builds.imageSummaryList?.find(build => build.name)?.name;
    }
    catch (e) {
        console.warn({
            notice: 'Failed to look up the recipe of an image version',
            image: imageVersionArn,
            error: e,
        });
        return undefined;
    }
}
/**
 * The builder is being removed, so nothing it built is in use anymore. Delete all of it, including the AMI of the launch template.
 *
 * Nothing else can get us here. The physical resource id never changes, so CloudFormation never replaces this resource, and a `Delete` can only mean
 * the builder is gone from the template or the stack is being deleted.
 */
async function deleteAllResources(target) {
    let recipeName = target.RecipeName;
    if (!recipeName) {
        // properties written by version 0.16.0 or below, which named the image version instead of the recipe. we get those for a builder removed by the
        // very deployment that upgrades, as its last successful template is still the old one.
        if (!target.ImageVersionArn) {
            console.warn({
                notice: 'Neither a recipe name nor an image version to clean up',
            });
            return;
        }
        recipeName = await recipeOfImageVersion(target.ImageVersionArn);
        if (!recipeName) {
            console.warn({
                notice: 'No builds left to tell us which recipe to clean up',
                image: target.ImageVersionArn,
            });
            return;
        }
        console.log({
            notice: 'Found the recipe of a builder last deployed by an older version of this construct',
            image: target.ImageVersionArn,
            recipe: recipeName,
        });
    }
    const builds = await recipeBuilds(recipeName);
    console.log({
        notice: 'Deleting all images',
        recipe: recipeName,
        deleting: builds.length,
    });
    await deleteBuilds(builds);
}
async function handler(event, _context) {
    if (event.RequestType === 'Scheduled') {
        console.log({
            notice: 'Scheduled image cleanup request',
            ...event,
        });
        await deleteOldResources(event);
        return;
    }
    try {
        console.log({
            notice: 'CloudFormation custom resource request',
            ...event,
            ResponseURL: '...',
        });
        switch (event.RequestType) {
            case 'Create':
                await (0, lambda_helpers_1.customResourceRespond)(event, 'SUCCESS', 'OK', exports.CLEANER_PHYSICAL_RESOURCE_ID, {});
                break;
            case 'Update':
                // echo the id back rather than returning our own, so it never changes -- not even on the deployment that upgrades from a version that used
                // the image version ARN as the id. a changed id is a replacement, and CloudFormation backs a replacement out by deleting the new physical
                // resource, which would have us delete every image of a builder that is still very much in use.
                await (0, lambda_helpers_1.customResourceRespond)(event, 'SUCCESS', 'OK', event.PhysicalResourceId, {});
                break;
            case 'Delete':
                // the id never changes, so a Delete can only mean this builder is going away
                await deleteAllResources(event.ResourceProperties);
                await (0, lambda_helpers_1.customResourceRespond)(event, 'SUCCESS', 'OK', event.PhysicalResourceId, {});
                break;
        }
    }
    catch (e) {
        console.error({
            notice: 'Failed to delete Image Builder resources',
            error: e,
        });
        // never hand back an id other than the one we were given. a changed id is a replacement, and CloudFormation backs a replacement out by deleting
        // the new physical resource, which would have us delete every image of a builder that is still in use. a failed Create has no id yet, and the
        // constant below is the one a successful Create would have returned anyway, so its rollback still deletes whatever the failed create did build.
        const physicalResourceId = ('PhysicalResourceId' in event && event.PhysicalResourceId) || exports.CLEANER_PHYSICAL_RESOURCE_ID;
        await (0, lambda_helpers_1.customResourceRespond)(event, 'FAILED', e.message || 'Internal Error', physicalResourceId, {});
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsZXRlLXJlc291cmNlcy5sYW1iZGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaW1hZ2UtYnVpbGRlcnMvYXdzLWltYWdlLWJ1aWxkZXIvZGVsZXRlLXJlc291cmNlcy5sYW1iZGEudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBa2lCQSwwQkE2Q0M7QUEva0JELG9EQUFzSTtBQUN0SSxvREFBeUU7QUFDekUsc0VBUXNDO0FBRXRDLHlEQUE2RDtBQUU3RCxNQUFNLEdBQUcsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztBQUM1QixNQUFNLEdBQUcsR0FBRyxJQUFJLHNCQUFTLEVBQUUsQ0FBQztBQUM1QixNQUFNLEVBQUUsR0FBRyxJQUFJLHdDQUFrQixFQUFFLENBQUM7QUFFcEM7Ozs7Ozs7Ozs7O0dBV0c7QUFDVSxRQUFBLDRCQUE0QixHQUFHLCtDQUErQyxDQUFDO0FBRTVGOzs7R0FHRztBQUNILE1BQU0sV0FBVyxHQUFHLENBQUMsQ0FBQztBQUV0Qjs7O0dBR0c7QUFDSCxNQUFNLHdCQUF3QixHQUFHO0lBQy9CLFdBQVc7SUFDWCxZQUFZO0lBQ1osUUFBUTtJQUNSLFdBQVc7Q0FDWixDQUFDO0FBRUY7OztHQUdHO0FBQ0gsTUFBTSw4QkFBOEIsR0FBRztJQUNyQyxrQ0FBa0M7SUFDbEMsbUNBQW1DO0NBQ3BDLENBQUM7QUFFRjs7Ozs7R0FLRztBQUNILE1BQU0sa0JBQWtCLEdBQUc7SUFDekIsdUJBQXVCO0lBQ3ZCLDBCQUEwQjtJQUMxQix3QkFBd0I7Q0FDekIsQ0FBQztBQUVGOztHQUVHO0FBQ0gsTUFBTSwyQkFBMkIsR0FBRztJQUNsQyw2QkFBNkI7SUFDN0Isd0JBQXdCO0NBQ3pCLENBQUM7QUFFRjs7R0FFRztBQUNILE1BQU0sb0JBQW9CLEdBQUc7SUFDM0IsMkJBQTJCO0NBQzVCLENBQUM7QUFpREY7Ozs7Ozs7O0dBUUc7QUFDSCxLQUFLLFVBQVUsaUJBQWlCLENBQUMsZ0JBQXdCO0lBQ3ZELElB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QUNqSCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IERlcmVnaXN0ZXJJbWFnZUNvbW1hbmQsIERlc2NyaWJlSW1hZ2VzQ29tbWFuZCwgRGVzY3JpYmVMYXVuY2hUZW1wbGF0ZVZlcnNpb25zQ29tbWFuZCwgRUMyQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWVjMic7XG5pbXBvcnQgeyBCYXRjaERlbGV0ZUltYWdlQ29tbWFuZCwgRUNSQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWVjcic7XG5pbXBvcnQge1xuICBEZWxldGVJbWFnZUNvbW1hbmQsXG4gIEltYWdlYnVpbGRlckNsaWVudCxcbiAgSW1hZ2VTdW1tYXJ5LFxuICBMaXN0SW1hZ2VCdWlsZFZlcnNpb25zQ29tbWFuZCxcbiAgTGlzdEltYWdlQnVpbGRWZXJzaW9uc1Jlc3BvbnNlLFxuICBMaXN0SW1hZ2VzQ29tbWFuZCxcbiAgTGlzdEltYWdlc1Jlc3BvbnNlLFxufSBmcm9tICdAYXdzLXNkay9jbGllbnQtaW1hZ2VidWlsZGVyJztcbmltcG9ydCAqIGFzIEFXU0xhbWJkYSBmcm9tICdhd3MtbGFtYmRhJztcbmltcG9ydCB7IGN1c3RvbVJlc291cmNlUmVzcG9uZCB9IGZyb20gJy4uLy4uL2xhbWJkYS1oZWxwZXJzJztcblxuY29uc3QgZWMyID0gbmV3IEVDMkNsaWVudCgpO1xuY29uc3QgZWNyID0gbmV3IEVDUkNsaWVudCgpO1xuY29uc3QgaWIgPSBuZXcgSW1hZ2VidWlsZGVyQ2xpZW50KCk7XG5cbi8qKlxuICogUGh5c2ljYWwgcmVzb3VyY2UgaWQgd2UgaGFuZCBvdXQgd2hlbiB0aGUgY3VzdG9tIHJlc291cmNlIGlzIGZpcnN0IGNyZWF0ZWQuXG4gKlxuICogVGhlIGlkIGl0c2VsZiBtYXR0ZXJzIGxlc3MgdGhhbiB0aGUgZmFjdCB0aGF0IGl0IG5ldmVyIGNoYW5nZXMuIFdlIG5ldmVyIHdhbnQgdG8gc2VlIGEgcmVwbGFjZW1lbnQgYXMgdGhhdCB3b3VsZCBjYXVzZSB1cyB0byBkZWxldGUgYWxsIGltYWdlcywgYW5kXG4gKiB0aGV5IG1pZ2h0IHN0aWxsIGJlIGluIHVzZS4gVGhhdCdzIGFsc28gd2h5IG9uIGBVcGRhdGVgIHdlIGp1c3QgZWNobyBiYWNrIHdoYXRldmVyIGlkIGNhbWUgaW4gKGFuZCBpdCB3aWxsIGJlIGRpZmZlcmVudCBmb3IgdXBncmFkZXMpLiBVcGRhdGVzLCBhbmRcbiAqIHJvbGxiYWNrcyBvZiB1cGRhdGVzLCBsZWF2ZSB0aGUgcmVzb3VyY2UgYWxvbmUuIFRoYXQncyB3aGF0IG1ha2VzIGl0IHNhZmUgdG8gZGVsZXRlIGV2ZXJ5dGhpbmcgd2UgZmluZCBvbiBgRGVsZXRlYC5cbiAqXG4gKiBTdGFja3MgdGhhdCBwcmVkYXRlIHRoaXMgdmVyc2lvbiBrZWVwIHRoZSBpbWFnZSB2ZXJzaW9uIEFSTiB0aGV5IHdlcmUgZ2l2ZW4gYXMgdGhlaXIgaWQsIGZvcmV2ZXIsIGFuZCB0aGF0J3MgZmluZS4gV2hhdCB0ZWxscyBhIHJlYWwgcmVtb3ZhbCBmcm9tIGFcbiAqIGxlZnRvdmVyIG9mIHRoZSBvbGQgYmVoYXZpb3IgaXMgdGhlIHByb3BlcnRpZXMsIG5vdCB0aGUgaWQuIFNlZSBgZGVsZXRlQWxsUmVzb3VyY2VzYC5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNvbnN0IENMRUFORVJfUEhZU0lDQUxfUkVTT1VSQ0VfSUQgPSAncnVubmVyLWltYWdlcy1kZWxldGVkLXdoZW4tYnVpbGRlci1pcy1yZW1vdmVkJztcblxuLyoqXG4gKiBOdW1iZXIgb2YgZmluaXNoZWQgaW1hZ2VzIHdlIGtlZXAgYXJvdW5kIG9uIHRoZSBzY2hlZHVsZWQgY2xlYW51cCwgb24gdG9wIG9mIHRoZSBpbWFnZSB0aGF0J3MgY3VycmVudGx5IGluIHVzZS4gSXQgZ2l2ZXMgdXMgc29tZXRoaW5nIHRvIGZhbGwgYmFja1xuICogb24sIGFuZCBrZWVwcyBhbiBpbWFnZSBidWlsdCBieSBhIGRlcGxveW1lbnQgdGhhdCBsYXRlciByb2xsZWQgYmFjayBmcm9tIGJlaW5nIGNvbGxlY3RlZCB0aGUgbW9tZW50IGl0J3MgYnVpbHQuXG4gKi9cbmNvbnN0IEtFRVBfSU1BR0VTID0gMjtcblxuLyoqXG4gKiBJbWFnZXMgdGhhdCBhcmUgZG9uZSBidWlsZGluZy4gQW55dGhpbmcgZWxzZSBpcyBzdGlsbCBvbiBpdHMgd2F5IHRvIHRoZSBsYXVuY2ggdGVtcGxhdGUsIGFzIGRpc3RyaWJ1dGlvbiBpcyBvbmUgb2YgdGhlIGJ1aWxkIHN0ZXBzLCBzbyB3ZSBuZXZlclxuICogdG91Y2ggaXQuIFRoZSBmdWxsIGxpc3Qgb2Ygc3RhdGVzIGFsc28gaGFzIFBFTkRJTkcsIENSRUFUSU5HLCBCVUlMRElORywgVEVTVElORywgRElTVFJJQlVUSU5HLCBhbmQgSU5URUdSQVRJTkcuXG4gKi9cbmNvbnN0IERFTEVUQUJMRV9JTUFHRV9TVEFUVVNFUyA9IFtcbiAgJ0FWQUlMQUJMRScsXG4gICdERVBSRUNBVEVEJyxcbiAgJ0ZBSUxFRCcsXG4gICdDQU5DRUxMRUQnLFxuXTtcblxuLyoqXG4gKiBUaGUgbGF1bmNoIHRlbXBsYXRlIGlzIGdvbmUgZm9yIGdvb2QsIHNvIHRoZXJlIGlzIG5vIEFNSSBsZWZ0IGZvciB1cyB0byBwcm90ZWN0LiBBbnkgb3RoZXIgZXJyb3IgbWVhbnMgd2Ugc2ltcGx5IGRvbid0IGtub3cgd2hpY2ggQU1JIGlzIGluIHVzZSxcbiAqIHdoaWNoIGlzIG5vdCB0aGUgc2FtZSBhcyBrbm93aW5nIG5vIEFNSSBpcyBpbiB1c2UuXG4gKi9cbmNvbnN0IE1JU1NJTkdfTEFVTkNIX1RFTVBMQVRFX0VSUk9SUyA9IFtcbiAgJ0ludmFsaWRMYXVuY2hUZW1wbGF0ZUlkLk5vdEZvdW5kJyxcbiAgJ0ludmFsaWRMYXVuY2hUZW1wbGF0ZUlkLk1hbGZvcm1lZCcsXG5dO1xuXG4vKipcbiAqIFNvbWVvbmUgYWxyZWFkeSBkZXJlZ2lzdGVyZWQgdGhlIEFNSSwgb3IgSW1hZ2UgQnVpbGRlciByZWNvcmRlZCBhbiBpZCB3ZSBjYW4gbmV2ZXIgYWN0IG9uLiBFaXRoZXIgd2F5IHRoZXJlIGlzIG5vdGhpbmcgbGVmdCBvZiBpdCB0byBsb3NlIHRyYWNrIG9mLFxuICogc28gdGhlIGJ1aWxkIHRoYXQgcG9pbnRzIGF0IGl0IGNhbiBnby4gRGVzY3JpYmVJbWFnZXMgcmFpc2VzIHRoZXNlIHJhdGhlciB0aGFuIHJldHVybmluZyBhbiBlbXB0eSBsaXN0IHdoZW4gaXQgaXMgZ2l2ZW4gYW4gZXhwbGljaXQgaW1hZ2UgaWQuXG4gKlxuICogVHJlYXRpbmcgdGhlbSBhcyBhbnl0aGluZyBlbHNlIHdvdWxkIGxlYXZlIHRoZSBidWlsZCBiZWhpbmQgZm9yZXZlciwgZmFpbGluZyBldmVyeSBzY2hlZHVsZWQgcnVuIGFuZCBldmVyeSBkZWxldGUgZm9yIGFuIEFNSSB0aGF0IGlzIGFscmVhZHkgZ29uZS5cbiAqL1xuY29uc3QgTUlTU0lOR19BTUlfRVJST1JTID0gW1xuICAnSW52YWxpZEFNSUlELk5vdEZvdW5kJyxcbiAgJ0ludmFsaWRBTUlJRC5VbmF2YWlsYWJsZScsXG4gICdJbnZhbGlkQU1JSUQuTWFsZm9ybWVkJyxcbl07XG5cbi8qKlxuICogVGhlIHJlcG9zaXRvcnksIG9yIHRoZSBpbWFnZSBpbiBpdCwgaXMgYWxyZWFkeSBnb25lLiBTYW1lIHJlYXNvbmluZyBhcyBgTUlTU0lOR19BTUlfRVJST1JTYC5cbiAqL1xuY29uc3QgTUlTU0lOR19ET0NLRVJfSU1BR0VfRVJST1JTID0gW1xuICAnUmVwb3NpdG9yeU5vdEZvdW5kRXhjZXB0aW9uJyxcbiAgJ0ltYWdlTm90Rm91bmRFeGNlcHRpb24nLFxuXTtcblxuLyoqXG4gKiBUaGUgaW1hZ2UgYnVpbGQgaXMgYWxyZWFkeSBnb25lLCBzbyB0aGVyZSBpcyBub3RoaW5nIGxlZnQgdG8gZGVsZXRlLiBTYW1lIHJlYXNvbmluZyBhcyBgTUlTU0lOR19BTUlfRVJST1JTYC5cbiAqL1xuY29uc3QgTUlTU0lOR19CVUlMRF9FUlJPUlMgPSBbXG4gICdSZXNvdXJjZU5vdEZvdW5kRXhjZXB0aW9uJyxcbl07XG5cbi8qKlxuICogRXZlcnl0aGluZyB3ZSBuZWVkIHRvIGZpbmQgdGhlIGltYWdlcyBvZiBvbmUgYnVpbGRlciwgYW5kIHRoZSBvbmUgaW1hZ2Ugb2YgdGhvc2UgdGhhdCdzIHN0aWxsIGluIHVzZS5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDbGVhbmVyVGFyZ2V0IHtcbiAgLyoqXG4gICAqIFJlY2lwZSB3aG9zZSBpbWFnZXMgd2UgY2xlYW4gdXAuIEVDMiBJbWFnZSBCdWlsZGVyIG5hbWVzIGltYWdlcyBhZnRlciB0aGUgcmVjaXBlIHRoYXQgYnVpbHQgdGhlbS5cbiAgICpcbiAgICogTWlzc2luZyBvbiBhIGJ1aWxkZXIgcmVtb3ZlZCBieSB0aGUgdmVyeSBkZXBsb3ltZW50IHRoYXQgdXBncmFkZXMgZnJvbSB2ZXJzaW9uIDAuMTYuMCBvciBiZWxvdywgYXMgQ2xvdWRGb3JtYXRpb24gaGFuZHMgYSBgRGVsZXRlYCB0aGVcbiAgICogcHJvcGVydGllcyBvZiB0aGUgbGFzdCB0ZW1wbGF0ZSB0aGF0IGRlcGxveWVkIHN1Y2Nlc3NmdWxseS4gYEltYWdlVmVyc2lvbkFybmAgaXMgdXNlZCB0byBmaW5kIHRoZSByZWNpcGUgaW4gdGhhdCBjYXNlLlxuICAgKi9cbiAgcmVhZG9ubHkgUmVjaXBlTmFtZT86IHN0cmluZztcblxuICAvKipcbiAgICogTGF1bmNoIHRlbXBsYXRlIHRoYXQgRUMyIEltYWdlIEJ1aWxkZXIgcG9pbnRzIGF0IHRoZSBsYXRlc3QgQU1JLiBXZSBuZXZlciBkZWxldGUgdGhlIEFNSSBvZiBpdHMgZGVmYXVsdCB2ZXJzaW9uLCBvciBydW5uZXJzIHN0aWxsIHN0YXJ0aW5nIGZyb21cbiAgICogaXQgd291bGQgZmFpbC4gTm90IHNldCBmb3IgRG9ja2VyIGltYWdlIGJ1aWxkZXJzLlxuICAgKi9cbiAgcmVhZG9ubHkgTGF1bmNoVGVtcGxhdGVJZD86IHN0cmluZztcblxuICAvKipcbiAgICogQ3VycmVudCB2ZXJzaW9uIG9mIHRoZSByZWNpcGUsIGFzIGFuIGltYWdlIHZlcnNpb24gQVJOLlxuICAgKlxuICAgKiBUaGlzIGlzIHRoZSBvbmx5IHByb3BlcnR5IHZlcnNpb24gMC4xNi4wIGFuZCBiZWxvdyB3cm90ZSwgYW5kIHRoZSBvbmx5IG9uZSB0aGV5IHJlYWQuIFdlIGtlZXAgd3JpdGluZyBpdCBmb3IgdHdvIHJlYXNvbnMuIEl0IHRlbGxzIHVzIHRoZSByZWNpcGVcbiAgICogd2hlbiB3ZSBnZXQgYSBgRGVsZXRlYCBjYXJyeWluZyB0aGVpciBwcm9wZXJ0aWVzLiBBbmQgc2hvdWxkIHRoZWlyIGNvZGUgZXZlciBydW4gYWdhaW5zdCBvdXIgcHJvcGVydGllcyAtLSBhIGRvd25ncmFkZSByZXBsYWNlcyB0aGUgY3VzdG9tXG4gICAqIHJlc291cmNlLCBhbmQgdGhlIG9sZCBjb2RlIHRoZW4gaGFuZGxlcyB0aGUgZGVsZXRlIG9mIHRoZSByZXNvdXJjZSBpdCBzdXBlcnNlZGVkIC0tIGl0IGhhcyBzb21ldGhpbmcgc2NvcGVkIHRvIHdvcmsgd2l0aC4gV2l0aG91dCBpdCwgdGhleSBjYWxsXG4gICAqIExpc3RJbWFnZUJ1aWxkVmVyc2lvbnMgd2l0aCBubyBpbWFnZSB2ZXJzaW9uLCB3aGljaCBsaXN0cyBldmVyeSBpbWFnZSBidWlsZCB2ZXJzaW9uIGluIHRoZSBhY2NvdW50IGFuZCBkZWxldGVzIGFsbCBvZiB0aGVtLlxuICAgKi9cbiAgcmVhZG9ubHkgSW1hZ2VWZXJzaW9uQXJuPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgaW50ZXJmYWNlIERlbGV0ZVJlc291cmNlc1Byb3BzIGV4dGVuZHMgQ2xlYW5lclRhcmdldCB7XG4gIHJlYWRvbmx5IFNlcnZpY2VUb2tlbjogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNjaGVkdWxlZCBldmVudCBzZW50IGJ5IHRoZSBFdmVudEJyaWRnZSBydWxlIG9mIGEgc2luZ2xlIGJ1aWxkZXIuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NoZWR1bGVkQ2xlYW51cEV2ZW50IGV4dGVuZHMgQ2xlYW5lclRhcmdldCB7XG4gIHJlYWRvbmx5IFJlcXVlc3RUeXBlOiAnU2NoZWR1bGVkJztcbn1cblxuLyoqXG4gKiBHZXQgdGhlIEFNSSB0aGUgbGF1bmNoIHRlbXBsYXRlIHBvaW50cyBhdCwgc28gd2Uga25vdyBub3QgdG8gZGVsZXRlIGFuIGltYWdlIHRoYXQncyBzdGlsbCBpbiB1c2UuXG4gKlxuICogRUMyIEltYWdlIEJ1aWxkZXIgc2V0cyB0aGUgZGVmYXVsdCB2ZXJzaW9uIG9mIHRoZSBsYXVuY2ggdGVtcGxhdGUgb3V0c2lkZSBvZiBDbG91ZEZvcm1hdGlvbiwgYW5kIFJ1bkluc3RhbmNlcyB1c2VzIHRoYXQgc2FtZSBkZWZhdWx0IHZlcnNpb24sIHNvXG4gKiBpdCdzIHRoZSBvbmx5IHJlbGlhYmxlIGFuc3dlciB0byBcIndoaWNoIEFNSSBpcyBpbiB1c2VcIi4gTm90ZSB0aGlzIGlzIGAkRGVmYXVsdGAgYW5kIG5vdCBgJExhdGVzdGAuXG4gKlxuICogUmV0dXJucyB1bmRlZmluZWQgd2hlbiB0aGUgbGF1bmNoIHRlbXBsYXRlIGlzIGdvbmUsIG9yIHdoZW4gaXRzIGRlZmF1bHQgdmVyc2lvbiBoYXMgbm8gQU1JIHlldCwgYXMgbmVpdGhlciBsZWF2ZXMgYW4gQU1JIGluIHVzZS4gVGhyb3dzIG9uIGFueVxuICogb3RoZXIgZXJyb3Igc28gdGhlIGNhbGxlciBjYW4gbGVhdmUgZXZlcnl0aGluZyBhbG9uZS5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gbGF1bmNoVGVtcGxhdGVBbWkobGF1bmNoVGVtcGxhdGVJZDogc3RyaW5nKSB7XG4gIHRyeSB7XG4gICAgY29uc3QgdmVyc2lvbnMgPSBhd2FpdCBlYzIuc2VuZChuZXcgRGVzY3JpYmVMYXVuY2hUZW1wbGF0ZVZlcnNpb25zQ29tbWFuZCh7XG4gICAgICBMYXVuY2hUZW1wbGF0ZUlkOiBsYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgVmVyc2lvbnM6IFsnJERlZmF1bHQnXSxcbiAgICB9KSk7XG5cbiAgICByZXR1cm4gdmVyc2lvbnMuTGF1bmNoVGVtcGxhdGVWZXJzaW9ucz8uWzBdPy5MYXVuY2hUZW1wbGF0ZURhdGE/LkltYWdlSWQ7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoTUlTU0lOR19MQVVOQ0hfVEVNUExBVEVfRVJST1JTLmluY2x1ZGVzKChlIGFzIEVycm9yKS5uYW1lKSkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdMYXVuY2ggdGVtcGxhdGUgaXMgZ29uZSBvciBlbXB0eSwgc28gbm8gQU1JIG5lZWRzIHRvIGJlIHByb3RlY3RlZCcsXG4gICAgICAgIGxhdW5jaFRlbXBsYXRlOiBsYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgICBlcnJvcjogKGUgYXMgRXJyb3IpLm5hbWUsXG4gICAgICB9KTtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgdGhyb3cgZTtcbiAgfVxufVxuXG4vKipcbiAqIEdldCB0aGUgaW1hZ2UgYnVpbGRzIG9mIGV2ZXJ5IHZlcnNpb24gb2YgdGhlIHJlY2lwZS5cbiAqXG4gKiBFdmVyeSB2ZXJzaW9uIGlzIGxpc3RlZCBhbmQgbm90IGp1c3QgdGhlIGN1cnJlbnQgb25lLiBSZWNpcGUgdmVyc2lvbnMgY2hhbmdlIHdpdGggZXZlcnkgY29tcG9uZW50IGNoYW5nZSwgc28gbGVmdG92ZXJzIGZyb20gaW50ZXJydXB0ZWQgZGVwbG95bWVudHNcbiAqIHdvdWxkIG90aGVyd2lzZSBzdGF5IGFyb3VuZCBmb3JldmVyLiBgaW5jbHVkZURlcHJlY2F0ZWRgIGlzIHJlcXVpcmVkIG9yIGRlcHJlY2F0ZWQgdmVyc2lvbnMgYXJlIG5ldmVyIHJldHVybmVkIGFuZCBjYW4gbmV2ZXIgYmUgY2xlYW5lZCB1cC5cbiAqXG4gKiBUaGUgYG5hbWVgIGZpbHRlciBpcyBjYXNlLXNlbnNpdGl2ZSwgc28gaXQgaGFzIHRvIGJlIHRoZSByZWNpcGUgbmFtZSBhcyB3cml0dGVuIGFuZCBub3QgdGhlIGxvd2VyY2FzZWQgZm9ybSB0aGF0IGltYWdlIEFSTnMgdXNlLlxuICovXG5hc3luYyBmdW5jdGlvbiByZWNpcGVCdWlsZHMocmVjaXBlTmFtZTogc3RyaW5nKSB7XG4gIGNvbnN0IGJ1aWxkczogSW1hZ2VTdW1tYXJ5W10gPSBbXTtcbiAgbGV0IGxpc3RlZCA9IDA7XG5cbiAgbGV0IHZlcnNpb25zOiBMaXN0SW1hZ2VzUmVzcG9uc2UgPSB7fTtcbiAgZG8ge1xuICAgIHZlcnNpb25zID0gYXdhaXQgaWIuc2VuZChuZXcgTGlzdEltYWdlc0NvbW1hbmQoe1xuICAgICAgb3duZXI6ICdTZWxmJyxcbiAgICAgIGZpbHRlcnM6IFt7IG5hbWU6ICduYW1lJywgdmFsdWVzOiBbcmVjaXBlTmFtZV0gfV0sXG4gICAgICBpbmNsdWRlRGVwcmVjYXRlZDogdHJ1ZSxcbiAgICAgIG5leHRUb2tlbjogdmVyc2lvbnMubmV4dFRva2VuLFxuICAgIH0pKTtcblxuICAgIGZvciAoY29uc3QgdmVyc2lvbiBvZiB2ZXJzaW9ucy5pbWFnZVZlcnNpb25MaXN0ID8/IFtdKSB7XG4gICAgICBpZiAoIXZlcnNpb24uYXJuKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBsaXN0ZWQrKztcblxuICAgICAgbGV0IHJlc3VsdDogTGlzdEltYWdlQnVpbGRWZXJzaW9uc1Jlc3BvbnNlID0ge307XG4gICAgICBkbyB7XG4gICAgICAgIHJlc3VsdCA9IGF3YWl0IGliLnNlbmQobmV3IExpc3RJbWFnZUJ1aWxkVmVyc2lvbnNDb21tYW5kKHtcbiAgICAgICAgICBpbWFnZVZlcnNpb25Bcm46IHZlcnNpb24uYXJuLFxuICAgICAgICAgIG5leHRUb2tlbjogcmVzdWx0Lm5leHRUb2tlbixcbiAgICAgICAgfSkpO1xuICAgICAgICBidWlsZHMucHVzaCguLi5yZXN1bHQuaW1hZ2VTdW1tYXJ5TGlzdCA/PyBbXSk7XG4gICAgICB9IHdoaWxlIChyZXN1bHQubmV4dFRva2VuKTtcbiAgICB9XG4gIH0gd2hpbGUgKHZlcnNpb25zLm5leHRUb2tlbik7XG5cbiAgY29uc29sZS5sb2coe1xuICAgIG5vdGljZTogJ0xpc3RlZCBpbWFnZSB2ZXJzaW9ucycsXG4gICAgcmVjaXBlOiByZWNpcGVOYW1lLFxuICAgIHZlcnNpb25zOiBsaXN0ZWQsXG4gICAgYnVpbGRzOiBidWlsZHMubGVuZ3RoLFxuICB9KTtcblxuICByZXR1cm4gYnVpbGRzO1xufVxuXG5mdW5jdGlvbiBidWlsZERhdGUoYnVpbGQ6IEltYWdlU3VtbWFyeSkge1xuICByZXR1cm4gKGJ1aWxkLmRhdGVDcmVhdGVkID8gRGF0ZS5wYXJzZShidWlsZC5kYXRlQ3JlYXRlZCkgOiAwKSB8fCAwO1xufVxuXG4vKipcbiAqIFJldHVybnMgZmFsc2UgaWYgdGhlIEFNSSBpcyBzdGlsbCBvdXQgdGhlcmUsIHNvIHRoZSBjYWxsZXIga25vd3MgdG8ga2VlcCB0aGUgYnVpbGQgdGhhdCBwb2ludHMgYXQgaXQuIEFuIEFNSSB3ZSBjYW4gbm8gbG9uZ2VyIGZpbmQgaXMgbm90IGFcbiAqIGZhaWx1cmUsIGFzIHRoZXJlIGlzIG5vdGhpbmcgbGVmdCB0byBsb3NlIHRyYWNrIG9mLlxuICovXG5hc3luYyBmdW5jdGlvbiBkZWxldGVBbWkoaW1hZ2VJZDogc3RyaW5nKSB7XG4gIHRyeSB7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnRGVsZXRpbmcgQU1JJyxcbiAgICAgIGltYWdlOiBpbWFnZUlkLFxuICAgIH0pO1xuXG4gICAgY29uc3QgaW1hZ2VEZXNjID0gYXdhaXQgZWMyLnNlbmQobmV3IERlc2NyaWJlSW1hZ2VzQ29tbWFuZCh7XG4gICAgICBPd25lcnM6IFsnc2VsZiddLFxuICAgICAgSW1hZ2VJZHM6IFtpbWFnZUlkXSxcbiAgICB9KSk7XG5cbiAgICBpZiAoaW1hZ2VEZXNjLkltYWdlcz8ubGVuZ3RoICE9PSAxKSB7XG4gICAgICBjb25zb2xlLndhcm4oe1xuICAgICAgICBub3RpY2U6ICdVbmFibGUgdG8gZmluZCBBTUknLFxuICAgICAgICBpbWFnZTogaW1hZ2VJZCxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgYXdhaXQgZWMyLnNlbmQobmV3IERlcmVnaXN0ZXJJbWFnZUNvbW1hbmQoe1xuICAgICAgSW1hZ2VJZDogaW1hZ2VJZCxcbiAgICAgIERlbGV0ZUFzc29jaWF0ZWRTbmFwc2hvdHM6IHRydWUsXG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoTUlTU0lOR19BTUlfRVJST1JTLmluY2x1ZGVzKChlIGFzIEVycm9yKS5uYW1lKSkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdBTUkgaXMgYWxyZWFkeSBnb25lJyxcbiAgICAgICAgaW1hZ2U6IGltYWdlSWQsXG4gICAgICAgIGVycm9yOiAoZSBhcyBFcnJvcikubmFtZSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgY29uc29sZS53YXJuKHtcbiAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBkZWxldGUgQU1JJyxcbiAgICAgIGltYWdlOiBpbWFnZUlkLFxuICAgICAgZXJyb3I6IGUsXG4gICAgfSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBmYWxzZSBpZiB0aGUgdGFnIGlzIHN0aWxsIG91dCB0aGVyZSwgc28gdGhlIGNhbGxlciBrbm93cyB0byBrZWVwIHRoZSBidWlsZCB0aGF0IHBvaW50cyBhdCBpdC4gU2tpcHBpbmcgJ2xhdGVzdCcgaXMgbm90IGEgZmFpbHVyZSwgYXMgaXQgaXNcbiAqIG5ldmVyIG91cnMgdG8gZGVsZXRlIGFuZCBldmVyeSBEb2NrZXIgYnVpbGQgY2FycmllcyBpdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGVsZXRlRG9ja2VySW1hZ2UoaW1hZ2U6IHN0cmluZykge1xuICB0cnkge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ0RlbGV0aW5nIERvY2tlciBJbWFnZScsXG4gICAgICBpbWFnZSxcbiAgICB9KTtcblxuICAgIC8vIGltYWdlIGxvb2tzIGxpa2UgMDEyMzQ1Njc4OS5ka3IuZWNyLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tL2dpdGh1Yi1ydW5uZXJzLXRlc3Qtd2luZG93c2ltYWdlYnVpbGRlcnJlcG9zaXRvcnlhNGNiYjZkOC1oZWhkbDk5cjdzM2Q6MS4wLjEwLTFcbiAgICBjb25zdCBwYXJ0cyA9IGltYWdlLnNwbGl0KCcvJylbMV0uc3BsaXQoJzonKTtcbiAgICBjb25zdCByZXBvID0gcGFydHNbMF07XG4gICAgY29uc3QgdGFnID0gcGFydHNbMV07XG5cbiAgICAvLyBza2lwICdsYXRlc3QnIGFzIGl0J3MgYSBzaGFyZWQgdGFnIGFjcm9zcyByZWNpcGUgdmVyc2lvbnMuXG4gICAgLy8gd2l0aG91dCB0aGlzIHNraXAsIHNpbXBsZSByZWNpcGUgdXBncmFkZXMgd2lsbCBlbmQgdXAgd2l0aCBsYXRlc3QgYmVpbmcgZ29uZSBhbmQgcnVubmVycyBub3Qgc3RhcnRpbmcuXG4gICAgLy8gb2xkIGltYWdlIHZlcnNpb25zIHdpbGwgc3RpbGwgcG9pbnQgdG8gJ2xhdGVzdCcgZXZlbiB3aGVuIGEgbmV3IG9uZSByZXBsYWNlZCBpdC5cbiAgICAvLyB0aGUgcmVwb3NpdG9yeSBpcyBhIGNoaWxkIG9mIHRoZSBidWlsZGVyLCBzbyByZW1vdmluZyB0aGUgYnVpbGRlciBvciBkZXN0cm95aW5nIHRoZSBzdGFjayB0YWtlcyBpdCB3aXRoIHRoZW0gYW5kXG4gICAgLy8gZWNyLlJlcG9zaXRvcnkoLi4uIGVtcHR5T25EZWxldGU6IHRydWUgLi4uKSB0YWtlcyBjYXJlIG9mIHRoZSB0YWcuXG4gICAgaWYgKHRhZyA9PT0gJ2xhdGVzdCcpIHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnU2tpcHBpbmcgbGF0ZXN0IHRhZyBhcyBpdCBpcyBzaGFyZWQgYW5kIHN0aWxsIGluIHVzZScsXG4gICAgICAgIGltYWdlLFxuICAgICAgfSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBhd2FpdCBlY3Iuc2VuZChuZXcgQmF0Y2hEZWxldGVJbWFnZUNvbW1hbmQoe1xuICAgICAgcmVwb3NpdG9yeU5hbWU6IHJlcG8sXG4gICAgICBpbWFnZUlkczogW1xuICAgICAgICB7XG4gICAgICAgICAgaW1hZ2VUYWc6IHRhZyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSkpO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAoTUlTU0lOR19ET0NLRVJfSU1BR0VfRVJST1JTLmluY2x1ZGVzKChlIGFzIEVycm9yKS5uYW1lKSkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdEb2NrZXIgaW1hZ2UgaXMgYWxyZWFkeSBnb25lJyxcbiAgICAgICAgaW1hZ2UsXG4gICAgICAgIGVycm9yOiAoZSBhcyBFcnJvcikubmFtZSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgY29uc29sZS53YXJuKHtcbiAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBkZWxldGUgZG9ja2VyIGltYWdlJyxcbiAgICAgIGltYWdlLFxuICAgICAgZXJyb3I6IGUsXG4gICAgfSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKlxuICogUmV0dXJucyBmYWxzZSBpZiB0aGUgYnVpbGQgaXMgc3RpbGwgdGhlcmUsIHNvIHRoZSBjYWxsZXIga25vd3Mgc29tZXRoaW5nIHdhcyBsZWZ0IGJlaGluZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGVsZXRlQnVpbGQoYnVpbGQ6IHN0cmluZykge1xuICB0cnkge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ0RlbGV0aW5nIEltYWdlIEJ1aWxkJyxcbiAgICAgIGJ1aWxkLFxuICAgIH0pO1xuXG4gICAgYXdhaXQgaWIuc2VuZChuZXcgRGVsZXRlSW1hZ2VDb21tYW5kKHtcbiAgICAgIGltYWdlQnVpbGRWZXJzaW9uQXJuOiBidWlsZCxcbiAgICB9KSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChNSVNTSU5HX0JVSUxEX0VSUk9SUy5pbmNsdWRlcygoZSBhcyBFcnJvcikubmFtZSkpIHtcbiAgICAgIGNvbnNvbGUubG9nKHtcbiAgICAgICAgbm90aWNlOiAnSW1hZ2UgYnVpbGQgaXMgYWxyZWFkeSBnb25lJyxcbiAgICAgICAgYnVpbGQsXG4gICAgICAgIGVycm9yOiAoZSBhcyBFcnJvcikubmFtZSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgY29uc29sZS53YXJuKHtcbiAgICAgIG5vdGljZTogJ0ZhaWxlZCB0byBkZWxldGUgaW1hZ2UgdmVyc2lvbiBidWlsZCcsXG4gICAgICBidWlsZCxcbiAgICAgIGVycm9yOiBlLFxuICAgIH0pO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIERlbGV0ZSB0aGUgZ2l2ZW4gYnVpbGRzIGFsb25nIHdpdGggZXZlcnl0aGluZyB0aGV5IHByb2R1Y2VkLiBUaGUgRUMyIEltYWdlIEJ1aWxkZXIgcmVzb3VyY2UgaXMgdGhlIG9ubHkgd2F5IGJhY2sgdG8gYW4gQU1JIG9yIGEgRG9ja2VyIGltYWdlLCBzbyBhXG4gKiBidWlsZCBpcyBkZWxldGVkIGxhc3QgYW5kIG9ubHkgb25jZSBldmVyeXRoaW5nIGl0IHBvaW50cyBhdCBpcyBnb25lLiBMZWF2ZSBvbmUgYmVoaW5kIGFuZCB3aGF0ZXZlciBpdCBwcm9kdWNlZCBsZWFrcyB3aXRoIG5vIHdheSB0byBmaW5kIGl0IGFnYWluLlxuICpcbiAqIERlbGV0ZXMgZXZlcnl0aGluZyBpdCBjYW4gZmlyc3QsIGFuZCBvbmx5IHRoZW4gcmVwb3J0cyB3aGF0IHdhcyBsZWZ0IGJlaGluZC4gQSBzY2hlZHVsZWQgcnVuIGlzIHJldHJpZWQgYnkgTGFtYmRhIGFuZCB0aGVuIGFnYWluIHRoZSBuZXh0IGRheS4gQVxuICogY3VzdG9tIHJlc291cmNlIHJlc3BvbmRzIEZBSUxFRCwgd2hpY2ggQ2xvdWRGb3JtYXRpb24gcmV0cmllcyBldmVyeSBmZXcgbWludXRlcyBiZWZvcmUgaXQgZ2l2ZXMgdXAgYW5kIHNraXBzIHRoZSByZXNvdXJjZSwgYW5kIHdoaWNoIHRoZSB1c2VyIHNlZXNcbiAqIGVpdGhlciB3YXkgaW5zdGVhZCBvZiBxdWlldGx5IHBheWluZyBmb3IgQU1JcyBub3RoaW5nIHdpbGwgZXZlciBjb21lIGJhY2sgZm9yLlxuICpcbiAqIEV2ZXJ5IG9uZSBvZiB0aG9zZSByZXRyaWVzIHJlbGlzdHMgdGhlIHJlY2lwZSwgc28gaXQgcGlja3MgdXAgZXhhY3RseSB3aGF0IHRoZSBsYXN0IGF0dGVtcHQgY291bGQgbm90IGRlbGV0ZS4gVGhhdCBvbmx5IHdvcmtzIGJlY2F1c2UgdGhlIGJ1aWxkc1xuICogcG9pbnRpbmcgYXQgdGhvc2UgbGVmdG92ZXJzIHdlcmUga2VwdDogZGVsZXRlIGEgYnVpbGQgYW5kIGl0cyBBTUkgaXMgdW5yZWFjaGFibGUsIHNvIHRoZSByZXRyeSB3b3VsZCBmaW5kIG5vdGhpbmcgbGVmdCB0byBkby5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGVsZXRlQnVpbGRzKGJ1aWxkczogSW1hZ2VTdW1tYXJ5W10pIHtcbiAgY29uc3QgbGVmdEJlaGluZCA9IG5ldyBTZXQ8SW1hZ2VTdW1tYXJ5PigpO1xuXG4gIGZvciAoY29uc3QgYnVpbGQgb2YgYnVpbGRzKSB7XG4gICAgZm9yIChjb25zdCBvdXRwdXQgb2YgYnVpbGQub3V0cHV0UmVzb3VyY2VzPy5hbWlzID8/IFtdKSB7XG4gICAgICBpZiAob3V0cHV0LmltYWdlICYmICFhd2FpdCBkZWxldGVBbWkob3V0cHV0LmltYWdlKSkge1xuICAgICAgICBsZWZ0QmVoaW5kLmFkZChidWlsZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBvdXRwdXQgb2YgYnVpbGQub3V0cHV0UmVzb3VyY2VzPy5jb250YWluZXJzID8/IFtdKSB7XG4gICAgICBmb3IgKGNvbnN0IGltYWdlIG9mIG91dHB1dC5pbWFnZVVyaXMgPz8gW10pIHtcbiAgICAgICAgaWYgKCFhd2FpdCBkZWxldGVEb2NrZXJJbWFnZShpbWFnZSkpIHtcbiAgICAgICAgICBsZWZ0QmVoaW5kLmFkZChidWlsZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBmb3IgKGNvbnN0IGJ1aWxkIG9mIGJ1aWxkcykge1xuICAgIGlmICghYnVpbGQuYXJuKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAobGVmdEJlaGluZC5oYXMoYnVpbGQpKSB7XG4gICAgICAvLyBrZWVwIGl0LCBzbyB0aGUgbmV4dCBydW4gY2FuIHN0aWxsIGZpbmQgd2hhdCB3ZSBjb3VsZCBub3QgZGVsZXRlXG4gICAgICBjb25zb2xlLndhcm4oe1xuICAgICAgICBub3RpY2U6ICdLZWVwaW5nIGltYWdlIGJ1aWxkIGFzIG5vdCBldmVyeXRoaW5nIGl0IHByb2R1Y2VkIGNvdWxkIGJlIGRlbGV0ZWQnLFxuICAgICAgICBidWlsZDogYnVpbGQuYXJuLFxuICAgICAgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBpZiAoIWF3YWl0IGRlbGV0ZUJ1aWxkKGJ1aWxkLmFybikpIHtcbiAgICAgIGxlZnRCZWhpbmQuYWRkKGJ1aWxkKTtcbiAgICB9XG4gIH1cblxuICBpZiAobGVmdEJlaGluZC5zaXplID4gMCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgRmFpbGVkIHRvIGRlbGV0ZSAke2xlZnRCZWhpbmQuc2l6ZX0gb2YgJHtidWlsZHMubGVuZ3RofSBydW5uZXIgaW1hZ2UgYnVpbGRzLiBTZWUgdGhlIGxvZyBmb3IgdGhlIGVycm9yIG9mIGVhY2ggb25lLmApO1xuICB9XG59XG5cbi8qKlxuICogU2NoZWR1bGVkIGNsZWFudXAgb2Ygb25lIGJ1aWxkZXIuIEtlZXBzIHRoZSBpbWFnZSB0aGF0J3MgaW4gdXNlLCB0aGUgbmV3ZXN0IGZldyBpbWFnZXMsIGFuZCBhbnl0aGluZyB0aGF0IGhhc24ndCBmaW5pc2hlZCBidWlsZGluZy5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGVsZXRlT2xkUmVzb3VyY2VzKHRhcmdldDogQ2xlYW5lclRhcmdldCkge1xuICBpZiAoIXRhcmdldC5SZWNpcGVOYW1lKSB7XG4gICAgY29uc29sZS53YXJuKHtcbiAgICAgIG5vdGljZTogJ05vIHJlY2lwZSBuYW1lLCBub3RoaW5nIHRvIGNsZWFuIHVwJyxcbiAgICB9KTtcbiAgICByZXR1cm47XG4gIH1cblxuICBsZXQgcHJvdGVjdGVkQW1pOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gIGlmICh0YXJnZXQuTGF1bmNoVGVtcGxhdGVJZCkge1xuICAgIHRyeSB7XG4gICAgICBwcm90ZWN0ZWRBbWkgPSBhd2FpdCBsYXVuY2hUZW1wbGF0ZUFtaSh0YXJnZXQuTGF1bmNoVGVtcGxhdGVJZCk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgLy8gd2UgY2FuJ3QgdGVsbCB3aGljaCBBTUkgaXMgaW4gdXNlLCBzbyB3ZSBsZWF2ZSBldmVyeXRoaW5nIGFsb25lIGFuZCB0cnkgYWdhaW4gdG9tb3Jyb3dcbiAgICAgIGNvbnNvbGUud2Fybih7XG4gICAgICAgIG5vdGljZTogJ1VuYWJsZSB0byByZWFkIGxhdW5jaCB0ZW1wbGF0ZSwgc2tpcHBpbmcgY2xlYW51cCBzbyBhbiBBTUkgaW4gdXNlIGlzIG5vdCBkZWxldGVkJyxcbiAgICAgICAgbGF1bmNoVGVtcGxhdGU6IHRhcmdldC5MYXVuY2hUZW1wbGF0ZUlkLFxuICAgICAgICBlcnJvcjogZSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxuXG4gIC8vIHVuZmluaXNoZWQgYnVpbGRzIG1heSBzdGlsbCBiZSBvbiB0aGVpciB3YXkgdG8gdGhlIGxhdW5jaCB0ZW1wbGF0ZSwgc28gdGhleSBhcmUgbmV2ZXIgZGVsZXRlZCBhbmQgbmV2ZXIgY291bnRlZFxuICBjb25zdCBmaW5pc2hlZCA9IChhd2FpdCByZWNpcGVCdWlsZHModGFyZ2V0LlJlY2lwZU5hbWUpKS5maWx0ZXIoYnVpbGQgPT4ge1xuICAgIGlmIChidWlsZC5zdGF0ZT8uc3RhdHVzICYmIERFTEVUQUJMRV9JTUFHRV9TVEFUVVNFUy5pbmNsdWRlcyhidWlsZC5zdGF0ZS5zdGF0dXMpKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdLZWVwaW5nIGJ1aWxkIGFzIGl0IGhhcyBub3QgZmluaXNoZWQgeWV0JyxcbiAgICAgIGJ1aWxkOiBidWlsZC5hcm4sXG4gICAgICBzdGF0dXM6IGJ1aWxkLnN0YXRlPy5zdGF0dXMsXG4gICAgfSk7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9KTtcblxuICAvLyBuZXdlc3QgZmlyc3QsIHNvIHRoZSBuZXdlc3QgZmV3IGNhbiBiZSBrZXB0XG4gIGZpbmlzaGVkLnNvcnQoKGEsIGIpID0+IGJ1aWxkRGF0ZShiKSAtIGJ1aWxkRGF0ZShhKSk7XG5cbiAgLy8gcmVtb3ZlIGFueSBub24tc3VjY2Vzc2Z1bCBidWlsZCArIGFsbCBzdWNjZXNzZnVsIGJ1aWxkcyBhZnRlciB0aGUgZmlyc3QgS0VFUF9JTUFHRVMsIGJ1dCBza2lwIHByb3RlY3RlZEFtaVxuICBjb25zdCBzdWNjZXNzZnVsID0gZmluaXNoZWQuZmlsdGVyKGJ1aWxkID0+IGJ1aWxkLnN0YXRlPy5zdGF0dXMgPT09ICdBVkFJTEFCTEUnKTtcbiAgY29uc3QgdW5zdWNjZXNzZnVsID0gZmluaXNoZWQuZmlsdGVyKGJ1aWxkID0+IGJ1aWxkLnN0YXRlPy5zdGF0dXMgIT09ICdBVkFJTEFCTEUnKTtcbiAgY29uc3Qgb2xkQnVpbGRzID0gdW5zdWNjZXNzZnVsLmNvbmNhdChzdWNjZXNzZnVsLnNsaWNlKEtFRVBfSU1BR0VTKSkuZmlsdGVyKGJ1aWxkID0+IHtcbiAgICBpZiAocHJvdGVjdGVkQW1pICYmIChidWlsZC5vdXRwdXRSZXNvdXJjZXM/LmFtaXMgPz8gW10pLnNvbWUoYW1pID0+IGFtaS5pbWFnZSA9PT0gcHJvdGVjdGVkQW1pKSkge1xuICAgICAgY29uc29sZS5sb2coe1xuICAgICAgICBub3RpY2U6ICdLZWVwaW5nIGJ1aWxkIGFzIGl0cyBBTUkgaXMgdXNlZCBieSB0aGUgbGF1bmNoIHRlbXBsYXRlJyxcbiAgICAgICAgYnVpbGQ6IGJ1aWxkLmFybixcbiAgICAgICAgaW1hZ2U6IHByb3RlY3RlZEFtaSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHJldHVybiB0cnVlO1xuICB9KTtcblxuICBjb25zb2xlLmxvZyh7XG4gICAgbm90aWNlOiAnRGVsZXRpbmcgb2xkIGltYWdlcycsXG4gICAgcmVjaXBlOiB0YXJnZXQuUmVjaXBlTmFtZSxcbiAgICBmb3VuZDogZmluaXNoZWQubGVuZ3RoLFxuICAgIGRlbGV0aW5nOiBvbGRCdWlsZHMubGVuZ3RoLFxuICB9KTtcblxuICBhd2FpdCBkZWxldGVCdWlsZHMob2xkQnVpbGRzKTtcbn1cblxuLyoqXG4gKiBOYW1lIG9mIHRoZSByZWNpcGUgdGhhdCBidWlsdCBhIGdpdmVuIGltYWdlIHZlcnNpb24sIHJlYWQgb2ZmIG9uZSBvZiBpdHMgYnVpbGRzLlxuICpcbiAqIEVDMiBJbWFnZSBCdWlsZGVyIG5hbWVzIGFuIGltYWdlIGFmdGVyIHRoZSByZWNpcGUgdGhhdCBidWlsdCBpdCwgYW5kIHVubGlrZSB0aGUgbmFtZSBpbnNpZGUgdGhlIEFSTiB0aGlzIG9uZSBrZWVwcyB0aGUgb3JpZ2luYWwgY2FzaW5nIHRoYXQgdGhlXG4gKiBMaXN0SW1hZ2VzIGZpbHRlciBuZWVkcy4gT25lIHBhZ2UgaXMgZW5vdWdoLCBhcyBldmVyeSBidWlsZCBvZiBhIHZlcnNpb24gY2FycmllcyB0aGUgc2FtZSBuYW1lLlxuICovXG5hc3luYyBmdW5jdGlvbiByZWNpcGVPZkltYWdlVmVyc2lvbihpbWFnZVZlcnNpb25Bcm46IHN0cmluZykge1xuICB0cnkge1xuICAgIGNvbnN0IGJ1aWxkcyA9IGF3YWl0IGliLnNlbmQobmV3IExpc3RJbWFnZUJ1aWxkVmVyc2lvbnNDb21tYW5kKHsgaW1hZ2VWZXJzaW9uQXJuIH0pKTtcbiAgICByZXR1cm4gYnVpbGRzLmltYWdlU3VtbWFyeUxpc3Q/LmZpbmQoYnVpbGQgPT4gYnVpbGQubmFtZSk/Lm5hbWU7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBjb25zb2xlLndhcm4oe1xuICAgICAgbm90aWNlOiAnRmFpbGVkIHRvIGxvb2sgdXAgdGhlIHJlY2lwZSBvZiBhbiBpbWFnZSB2ZXJzaW9uJyxcbiAgICAgIGltYWdlOiBpbWFnZVZlcnNpb25Bcm4sXG4gICAgICBlcnJvcjogZSxcbiAgICB9KTtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG59XG5cbi8qKlxuICogVGhlIGJ1aWxkZXIgaXMgYmVpbmcgcmVtb3ZlZCwgc28gbm90aGluZyBpdCBidWlsdCBpcyBpbiB1c2UgYW55bW9yZS4gRGVsZXRlIGFsbCBvZiBpdCwgaW5jbHVkaW5nIHRoZSBBTUkgb2YgdGhlIGxhdW5jaCB0ZW1wbGF0ZS5cbiAqXG4gKiBOb3RoaW5nIGVsc2UgY2FuIGdldCB1cyBoZXJlLiBUaGUgcGh5c2ljYWwgcmVzb3VyY2UgaWQgbmV2ZXIgY2hhbmdlcywgc28gQ2xvdWRGb3JtYXRpb24gbmV2ZXIgcmVwbGFjZXMgdGhpcyByZXNvdXJjZSwgYW5kIGEgYERlbGV0ZWAgY2FuIG9ubHkgbWVhblxuICogdGhlIGJ1aWxkZXIgaXMgZ29uZSBmcm9tIHRoZSB0ZW1wbGF0ZSBvciB0aGUgc3RhY2sgaXMgYmVpbmcgZGVsZXRlZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGVsZXRlQWxsUmVzb3VyY2VzKHRhcmdldDogQ2xlYW5lclRhcmdldCkge1xuICBsZXQgcmVjaXBlTmFtZSA9IHRhcmdldC5SZWNpcGVOYW1lO1xuXG4gIGlmICghcmVjaXBlTmFtZSkge1xuICAgIC8vIHByb3BlcnRpZXMgd3JpdHRlbiBieSB2ZXJzaW9uIDAuMTYuMCBvciBiZWxvdywgd2hpY2ggbmFtZWQgdGhlIGltYWdlIHZlcnNpb24gaW5zdGVhZCBvZiB0aGUgcmVjaXBlLiB3ZSBnZXQgdGhvc2UgZm9yIGEgYnVpbGRlciByZW1vdmVkIGJ5IHRoZVxuICAgIC8vIHZlcnkgZGVwbG95bWVudCB0aGF0IHVwZ3JhZGVzLCBhcyBpdHMgbGFzdCBzdWNjZXNzZnVsIHRlbXBsYXRlIGlzIHN0aWxsIHRoZSBvbGQgb25lLlxuICAgIGlmICghdGFyZ2V0LkltYWdlVmVyc2lvbkFybikge1xuICAgICAgY29uc29sZS53YXJuKHtcbiAgICAgICAgbm90aWNlOiAnTmVpdGhlciBhIHJlY2lwZSBuYW1lIG5vciBhbiBpbWFnZSB2ZXJzaW9uIHRvIGNsZWFuIHVwJyxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHJlY2lwZU5hbWUgPSBhd2FpdCByZWNpcGVPZkltYWdlVmVyc2lvbih0YXJnZXQuSW1hZ2VWZXJzaW9uQXJuKTtcbiAgICBpZiAoIXJlY2lwZU5hbWUpIHtcbiAgICAgIGNvbnNvbGUud2Fybih7XG4gICAgICAgIG5vdGljZTogJ05vIGJ1aWxkcyBsZWZ0IHRvIHRlbGwgdXMgd2hpY2ggcmVjaXBlIHRvIGNsZWFuIHVwJyxcbiAgICAgICAgaW1hZ2U6IHRhcmdldC5JbWFnZVZlcnNpb25Bcm4sXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zb2xlLmxvZyh7XG4gICAgICBub3RpY2U6ICdGb3VuZCB0aGUgcmVjaXBlIG9mIGEgYnVpbGRlciBsYXN0IGRlcGxveWVkIGJ5IGFuIG9sZGVyIHZlcnNpb24gb2YgdGhpcyBjb25zdHJ1Y3QnLFxuICAgICAgaW1hZ2U6IHRhcmdldC5JbWFnZVZlcnNpb25Bcm4sXG4gICAgICByZWNpcGU6IHJlY2lwZU5hbWUsXG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBidWlsZHMgPSBhd2FpdCByZWNpcGVCdWlsZHMocmVjaXBlTmFtZSk7XG5cbiAgY29uc29sZS5sb2coe1xuICAgIG5vdGljZTogJ0RlbGV0aW5nIGFsbCBpbWFnZXMnLFxuICAgIHJlY2lwZTogcmVjaXBlTmFtZSxcbiAgICBkZWxldGluZzogYnVpbGRzLmxlbmd0aCxcbiAgfSk7XG5cbiAgYXdhaXQgZGVsZXRlQnVpbGRzKGJ1aWxkcyk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoYW5kbGVyKGV2ZW50OiBTY2hlZHVsZWRDbGVhbnVwRXZlbnQgfCBBV1NMYW1iZGEuQ2xvdWRGb3JtYXRpb25DdXN0b21SZXNvdXJjZUV2ZW50LCBfY29udGV4dDogQVdTTGFtYmRhLkNvbnRleHQpIHtcbiAgaWYgKGV2ZW50LlJlcXVlc3RUeXBlID09PSAnU2NoZWR1bGVkJykge1xuICAgIGNvbnNvbGUubG9nKHtcbiAgICAgIG5vdGljZTogJ1NjaGVkdWxlZCBpbWFnZSBjbGVhbnVwIHJlcXVlc3QnLFxuICAgICAgLi4uZXZlbnQsXG4gICAgfSk7XG5cbiAgICBhd2FpdCBkZWxldGVPbGRSZXNvdXJjZXMoZXZlbnQpO1xuICAgIHJldHVybjtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc29sZS5sb2coe1xuICAgICAgbm90aWNlOiAnQ2xvdWRGb3JtYXRpb24gY3VzdG9tIHJlc291cmNlIHJlcXVlc3QnLFxuICAgICAgLi4uZXZlbnQsXG4gICAgICBSZXNwb25zZVVSTDogJy4uLicsXG4gICAgfSk7XG5cbiAgICBzd2l0Y2ggKGV2ZW50LlJlcXVlc3RUeXBlKSB7XG4gICAgICBjYXNlICdDcmVhdGUnOlxuICAgICAgICBhd2FpdCBjdXN0b21SZXNvdXJjZVJlc3BvbmQoZXZlbnQsICdTVUNDRVNTJywgJ09LJywgQ0xFQU5FUl9QSFlTSUNBTF9SRVNPVVJDRV9JRCwge30pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1VwZGF0ZSc6XG4gICAgICAgIC8vIGVjaG8gdGhlIGlkIGJhY2sgcmF0aGVyIHRoYW4gcmV0dXJuaW5nIG91ciBvd24sIHNvIGl0IG5ldmVyIGNoYW5nZXMgLS0gbm90IGV2ZW4gb24gdGhlIGRlcGxveW1lbnQgdGhhdCB1cGdyYWRlcyBmcm9tIGEgdmVyc2lvbiB0aGF0IHVzZWRcbiAgICAgICAgLy8gdGhlIGltYWdlIHZlcnNpb24gQVJOIGFzIHRoZSBpZC4gYSBjaGFuZ2VkIGlkIGlzIGEgcmVwbGFjZW1lbnQsIGFuZCBDbG91ZEZvcm1hdGlvbiBiYWNrcyBhIHJlcGxhY2VtZW50IG91dCBieSBkZWxldGluZyB0aGUgbmV3IHBoeXNpY2FsXG4gICAgICAgIC8vIHJlc291cmNlLCB3aGljaCB3b3VsZCBoYXZlIHVzIGRlbGV0ZSBldmVyeSBpbWFnZSBvZiBhIGJ1aWxkZXIgdGhhdCBpcyBzdGlsbCB2ZXJ5IG11Y2ggaW4gdXNlLlxuICAgICAgICBhd2FpdCBjdXN0b21SZXNvdXJjZVJlc3BvbmQoZXZlbnQsICdTVUNDRVNTJywgJ09LJywgZXZlbnQuUGh5c2ljYWxSZXNvdXJjZUlkLCB7fSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnRGVsZXRlJzpcbiAgICAgICAgLy8gdGhlIGlkIG5ldmVyIGNoYW5nZXMsIHNvIGEgRGVsZXRlIGNhbiBvbmx5IG1lYW4gdGhpcyBidWlsZGVyIGlzIGdvaW5nIGF3YXlcbiAgICAgICAgYXdhaXQgZGVsZXRlQWxsUmVzb3VyY2VzKGV2ZW50LlJlc291cmNlUHJvcGVydGllcyBhcyBEZWxldGVSZXNvdXJjZXNQcm9wcyk7XG4gICAgICAgIGF3YWl0IGN1c3RvbVJlc291cmNlUmVzcG9uZChldmVudCwgJ1NVQ0NFU1MnLCAnT0snLCBldmVudC5QaHlzaWNhbFJlc291cmNlSWQsIHt9KTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuICB9IGNhdGNoIChlKSB7XG4gICAgY29uc29sZS5lcnJvcih7XG4gICAgICBub3RpY2U6ICdGYWlsZWQgdG8gZGVsZXRlIEltYWdlIEJ1aWxkZXIgcmVzb3VyY2VzJyxcbiAgICAgIGVycm9yOiBlLFxuICAgIH0pO1xuICAgIC8vIG5ldmVyIGhhbmQgYmFjayBhbiBpZCBvdGhlciB0aGFuIHRoZSBvbmUgd2Ugd2VyZSBnaXZlbi4gYSBjaGFuZ2VkIGlkIGlzIGEgcmVwbGFjZW1lbnQsIGFuZCBDbG91ZEZvcm1hdGlvbiBiYWNrcyBhIHJlcGxhY2VtZW50IG91dCBieSBkZWxldGluZ1xuICAgIC8vIHRoZSBuZXcgcGh5c2ljYWwgcmVzb3VyY2UsIHdoaWNoIHdvdWxkIGhhdmUgdXMgZGVsZXRlIGV2ZXJ5IGltYWdlIG9mIGEgYnVpbGRlciB0aGF0IGlzIHN0aWxsIGluIHVzZS4gYSBmYWlsZWQgQ3JlYXRlIGhhcyBubyBpZCB5ZXQsIGFuZCB0aGVcbiAgICAvLyBjb25zdGFudCBiZWxvdyBpcyB0aGUgb25lIGEgc3VjY2Vzc2Z1bCBDcmVhdGUgd291bGQgaGF2ZSByZXR1cm5lZCBhbnl3YXksIHNvIGl0cyByb2xsYmFjayBzdGlsbCBkZWxldGVzIHdoYXRldmVyIHRoZSBmYWlsZWQgY3JlYXRlIGRpZCBidWlsZC5cbiAgICBjb25zdCBwaHlzaWNhbFJlc291cmNlSWQgPSAoJ1BoeXNpY2FsUmVzb3VyY2VJZCcgaW4gZXZlbnQgJiYgZXZlbnQuUGh5c2ljYWxSZXNvdXJjZUlkKSB8fCBDTEVBTkVSX1BIWVNJQ0FMX1JFU09VUkNFX0lEO1xuICAgIGF3YWl0IGN1c3RvbVJlc291cmNlUmVzcG9uZChldmVudCwgJ0ZBSUxFRCcsIChlIGFzIEVycm9yKS5tZXNzYWdlIHx8ICdJbnRlcm5hbCBFcnJvcicsIHBoeXNpY2FsUmVzb3VyY2VJZCwge30pO1xuICB9XG59XG4iXX0=