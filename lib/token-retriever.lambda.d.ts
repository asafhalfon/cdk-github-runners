import { StepFunctionLambdaInput } from './lambda-helpers';
export declare function handler(event: StepFunctionLambdaInput): Promise<{
    domain: string;
    skip: boolean;
    token: string;
    registrationUrl: string;
    jitConfig: string;
    runnerId: number;
}>;
