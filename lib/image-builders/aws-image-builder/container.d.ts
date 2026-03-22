import * as cdk from 'aws-cdk-lib';
import { aws_ecr as ecr } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BaseContainerImage } from './base-image';
import { ImageBuilderComponent } from './builder';
import { Os } from '../../providers';
/**
 * Properties for ContainerRecipe construct.
 *
 * @internal
 */
export interface ContainerRecipeProperties {
    /**
     * Target platform. Must match builder platform.
     */
    readonly platform: 'Linux' | 'Windows';
    /**
     * Components to add to target container image.
     */
    readonly components: ImageBuilderComponent[];
    /**
     * ECR repository where resulting container image will be uploaded.
     */
    readonly targetRepository: ecr.IRepository;
    /**
     * Dockerfile template where all the components will be added.
     *
     * Must contain at least the following placeholders:
     *
     * ```
     * FROM {{{ imagebuilder:parentImage }}}
     * {{{ imagebuilder:environments }}}
     * {{{ imagebuilder:components }}}
     * ```
     */
    readonly dockerfileTemplate: string;
    /**
     * Parent image for the new Docker Image.
     */
    readonly parentImage: string;
    /**
     * Tags to apply to the recipe and image.
     */
    readonly tags: {
        [key: string]: string;
    };
}
/**
 * Image builder recipe for a Docker container image.
 *
 * @internal
 */
export declare class ContainerRecipe extends cdk.Resource {
    readonly arn: string;
    readonly name: string;
    readonly version: string;
    constructor(scope: Construct, id: string, props: ContainerRecipeProperties);
}
/**
 * Default base Docker image for given OS.
 *
 * @internal
 */
export declare function defaultBaseDockerImage(os: Os): BaseContainerImage;
