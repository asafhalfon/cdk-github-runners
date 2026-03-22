interface Input {
    readonly lambdaName: string;
    readonly repositoryUri: string;
    readonly repositoryTag: string;
}
export declare function handler(event: Input): Promise<void>;
export {};
