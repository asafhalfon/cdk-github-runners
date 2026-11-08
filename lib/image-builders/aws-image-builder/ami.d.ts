import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseImage } from './base-image';
import { ImageBuilderComponent } from './builder';
import { Architecture, Os } from '../../providers';
/**
 * Properties for AmiRecipe construct.
 *
 * @internal
 */
interface AmiRecipeProperties {
    /**
     * Target platform. Must match builder platform.
     */
    readonly platform: 'Linux' | 'Windows';
    /**
     * Target architecture. Must match builder platform.
     */
    readonly architecture: Architecture;
    /**
     * Base AMI to use for the new runner AMI.
     */
    readonly baseAmi: BaseImage;
    /**
     * Storage size for the builder.
     */
    readonly storageSize?: cdk.Size;
    /**
     * Components to add to target container image.
     */
    readonly components: ImageBuilderComponent[];
    /**
     * Tags to apply to the recipe and image.
     */
    readonly tags: {
        [key: string]: string;
    };
}
/**
 * Image builder recipe for Amazon Machine Image (AMI).
 *
 * @internal
 */
export declare class AmiRecipe extends cdk.Resource {
    readonly arn: string;
    readonly name: string;
    readonly version: string;
    constructor(scope: Construct, id: string, props: AmiRecipeProperties);
}
/**
 * Default base AMI for given OS and architecture.
 *
 * @internal
 */
export declare function defaultBaseAmi(scope: Construct, os: Os, architecture: Architecture): BaseImage;
export {};
