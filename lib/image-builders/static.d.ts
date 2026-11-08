import { aws_ecr as ecr } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IRunnerImageBuilder } from './common';
import { Architecture, Os } from '../providers';
/**
 * Helper class with methods to use static images that are built outside the context of this project.
 */
export declare class StaticRunnerImage {
    /**
     * Create a builder (that doesn't actually build anything) from an existing image in an existing repository. The image must already have GitHub Actions runner installed. You are responsible to update it and remove it when done.
     *
     * @param repository ECR repository
     * @param tag image tag
     * @param architecture image architecture
     * @param os image OS
     */
    static fromEcrRepository(repository: ecr.IRepository, tag?: string, architecture?: Architecture, os?: Os): IRunnerImageBuilder;
    /**
     * Create a builder from an existing Docker Hub image. The image must already have GitHub Actions runner installed. You are responsible to update it and remove it when done.
     *
     * We create a CodeBuild image builder behind the scenes to copy the image over to ECR. This helps avoid Docker Hub rate limits and prevent failures.
     *
     * @param scope
     * @param id
     * @param image Docker Hub image with optional tag
     * @param architecture image architecture
     * @param os image OS
     */
    static fromDockerHub(scope: Construct, id: string, image: string, architecture?: Architecture, os?: Os): IRunnerImageBuilder;
}
