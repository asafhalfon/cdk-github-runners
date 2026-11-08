import * as AWSLambda from 'aws-lambda';
type ApiGatewayEvent = AWSLambda.APIGatewayProxyEvent | AWSLambda.APIGatewayProxyEventV2;
export declare function handler(event: ApiGatewayEvent): Promise<AWSLambda.APIGatewayProxyResultV2>;
export {};
