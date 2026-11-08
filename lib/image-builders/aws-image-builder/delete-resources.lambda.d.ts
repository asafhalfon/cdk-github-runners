import * as AWSLambda from 'aws-lambda';
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
export declare const CLEANER_PHYSICAL_RESOURCE_ID = "runner-images-deleted-when-builder-is-removed";
/**
 * Everything we need to find the images of one builder, and the one image of those that's still in use.
 *
 * @internal
 */
export interface CleanerTarget {
    /**
     * Recipe whose images we clean up. EC2 Image Builder names images after the recipe that built them.
     *
     * Missing on a builder removed by the very deployment that upgrades from version 0.16.0 or below, as CloudFormation hands a `Delete` the
     * properties of the last template that deployed successfully. `ImageVersionArn` is used to find the recipe in that case.
     */
    readonly RecipeName?: string;
    /**
     * Launch template that EC2 Image Builder points at the latest AMI. We never delete the AMI of its default version, or runners still starting from
     * it would fail. Not set for Docker image builders.
     */
    readonly LaunchTemplateId?: string;
    /**
     * Current version of the recipe, as an image version ARN.
     *
     * This is the only property version 0.16.0 and below wrote, and the only one they read. We keep writing it for two reasons. It tells us the recipe
     * when we get a `Delete` carrying their properties. And should their code ever run against our properties -- a downgrade replaces the custom
     * resource, and the old code then handles the delete of the resource it superseded -- it has something scoped to work with. Without it, they call
     * ListImageBuildVersions with no image version, which lists every image build version in the account and deletes all of them.
     */
    readonly ImageVersionArn?: string;
}
/**
 * @internal
 */
export interface DeleteResourcesProps extends CleanerTarget {
    readonly ServiceToken: string;
}
/**
 * Scheduled event sent by the EventBridge rule of a single builder.
 *
 * @internal
 */
export interface ScheduledCleanupEvent extends CleanerTarget {
    readonly RequestType: 'Scheduled';
}
export declare function handler(event: ScheduledCleanupEvent | AWSLambda.CloudFormationCustomResourceEvent, _context: AWSLambda.Context): Promise<void>;
