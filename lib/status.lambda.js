"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_cloudformation_1 = require("@aws-sdk/client-cloudformation");
const client_ec2_1 = require("@aws-sdk/client-ec2");
const client_ecr_1 = require("@aws-sdk/client-ecr");
const client_sfn_1 = require("@aws-sdk/client-sfn");
const lambda_github_1 = require("./lambda-github");
const lambda_helpers_1 = require("./lambda-helpers");
const cfn = new client_cloudformation_1.CloudFormationClient();
const ec2 = new client_ec2_1.EC2Client();
const ecr = new client_ecr_1.ECRClient();
const sf = new client_sfn_1.SFNClient();
function secretArnToUrl(arn) {
    const parts = arn.split(':'); // arn:aws:secretsmanager:us-east-1:12345678:secret:secret-name-REVISION
    const region = parts[3];
    const fullName = parts[6];
    const name = fullName.slice(0, fullName.lastIndexOf('-'));
    return `https://${region}.console.aws.amazon.com/secretsmanager/home?region=${region}#!/secret?name=${name}`;
}
function lambdaArnToUrl(arn) {
    const parts = arn.split(':'); // arn:aws:lambda:us-east-1:12345678:function:name-XYZ
    const region = parts[3];
    const name = parts[6];
    return `https://${region}.console.aws.amazon.com/lambda/home?region=${region}#/functions/${name}?tab=monitoring`;
}
function lambdaArnToLogGroup(arn) {
    const parts = arn.split(':'); // arn:aws:lambda:us-east-1:12345678:function:name-XYZ
    const name = parts[6];
    return `/aws/lambda/${name}`;
}
function stepFunctionArnToUrl(arn) {
    const parts = arn.split(':'); // arn:aws:states:us-east-1:12345678:stateMachine:name-XYZ
    const region = parts[3];
    return `https://${region}.console.aws.amazon.com/states/home?region=${region}#/statemachines/view/${arn}`;
}
async function generateProvidersStatus(stack, logicalId) {
    const resource = await cfn.send(new client_cloudformation_1.DescribeStackResourceCommand({ StackName: stack, LogicalResourceId: logicalId }));
    const providers = JSON.parse(resource.StackResourceDetail?.Metadata ?? '{}').providers;
    if (!providers) {
        return {};
    }
    return Promise.all(providers.map(async (p) => {
        // add ECR data, if image is from ECR
        if (p.image?.imageRepository?.match(/[0-9]+\.dkr\.ecr\.[a-z0-9\-]+\.amazonaws\.com\/.+/)) {
            const tags = await ecr.send(new client_ecr_1.DescribeImagesCommand({
                repositoryName: p.image.imageRepository.split('/')[1],
                filter: {
                    tagStatus: 'TAGGED',
                },
                maxResults: 1,
            }));
            if (tags.imageDetails && tags.imageDetails?.length >= 1) {
                p.image.latestImage = {
                    tags: tags.imageDetails[0].imageTags,
                    digest: tags.imageDetails[0].imageDigest,
                    date: tags.imageDetails[0].imagePushedAt,
                };
            }
        }
        // add AMI data, if image is AMI
        if (p.ami?.launchTemplate) {
            const versions = await ec2.send(new client_ec2_1.DescribeLaunchTemplateVersionsCommand({
                LaunchTemplateId: p.ami.launchTemplate,
                Versions: ['$Default'],
            }));
            if (versions.LaunchTemplateVersions && versions.LaunchTemplateVersions.length >= 1) {
                p.ami.latestAmi = versions.LaunchTemplateVersions[0].LaunchTemplateData?.ImageId;
            }
        }
        return p;
    }));
}
function safeReturnValue(event, status) {
    if (event.path) {
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(status),
        };
    }
    return status;
}
async function handler(event) {
    // confirm required environment variables
    if (!process.env.WEBHOOK_SECRET_ARN || !process.env.GITHUB_SECRET_ARN || !process.env.GITHUB_PRIVATE_KEY_SECRET_ARN || !process.env.LOGICAL_ID ||
        !process.env.WEBHOOK_HANDLER_ARN || !process.env.STEP_FUNCTION_ARN || !process.env.SETUP_SECRET_ARN ||
        !process.env.STACK_NAME) {
        throw new Error('Missing environment variables');
    }
    const [core, authApp] = await Promise.all([
        (0, lambda_github_1.loadOctokitCore)(),
        (0, lambda_github_1.loadOctokitAuthApp)(),
    ]);
    const { Octokit } = core;
    const { createAppAuth } = authApp;
    // base status
    const status = {
        github: {
            setup: {
                status: 'Unknown',
                url: '',
                secretArn: process.env.SETUP_SECRET_ARN,
                secretUrl: secretArnToUrl(process.env.SETUP_SECRET_ARN),
            },
            domain: 'Unknown',
            runnerLevel: 'Unknown',
            webhook: {
                url: process.env.WEBHOOK_URL,
                configuredUrl: 'Unknown',
                status: 'Unable to check',
                secretArn: process.env.WEBHOOK_SECRET_ARN,
                secretUrl: secretArnToUrl(process.env.WEBHOOK_SECRET_ARN),
            },
            auth: {
                type: 'Unknown',
                status: 'Unknown',
                secretArn: process.env.GITHUB_SECRET_ARN,
                secretUrl: secretArnToUrl(process.env.GITHUB_SECRET_ARN),
                privateKeySecretArn: process.env.GITHUB_PRIVATE_KEY_SECRET_ARN,
                privateKeySecretUrl: secretArnToUrl(process.env.GITHUB_PRIVATE_KEY_SECRET_ARN),
                app: {
                    id: -1,
                    url: '',
                    installations: [],
                },
                personalAuthToken: '',
                personalAuthTokenScopes: '',
            },
        },
        providers: await generateProvidersStatus(process.env.STACK_NAME, process.env.LOGICAL_ID),
        troubleshooting: {
            webhookHandlerArn: process.env.WEBHOOK_HANDLER_ARN,
            webhookHandlerUrl: lambdaArnToUrl(process.env.WEBHOOK_HANDLER_ARN),
            webhookHandlerLogGroup: lambdaArnToLogGroup(process.env.WEBHOOK_HANDLER_ARN),
            stepFunctionArn: process.env.STEP_FUNCTION_ARN,
            stepFunctionUrl: stepFunctionArnToUrl(process.env.STEP_FUNCTION_ARN),
            stepFunctionLogGroup: process.env.STEP_FUNCTION_LOG_GROUP,
            recentRuns: [],
        },
    };
    // setup url
    if (process.env.SETUP_FUNCTION_URL) {
        const setupToken = (await (0, lambda_helpers_1.getSecretJsonValue)(process.env.SETUP_SECRET_ARN)).token;
        if (setupToken) {
            status.github.setup.status = 'Pending';
            status.github.setup.url = `${process.env.SETUP_FUNCTION_URL}?token=${setupToken}`;
        }
        else {
            status.github.setup.status = 'Complete';
        }
    }
    else {
        status.github.setup.status = 'Disabled';
    }
    // list last 10 executions and their status
    try {
        const executions = await sf.send(new client_sfn_1.ListExecutionsCommand({
            stateMachineArn: process.env.STEP_FUNCTION_ARN,
            maxResults: 10,
        }));
        for (const execution of executions.executions ?? []) {
            const executionDetails = await sf.send(new client_sfn_1.DescribeExecutionCommand({
                executionArn: execution.executionArn,
            }));
            const input = JSON.parse(executionDetails.input || '{}');
            status.troubleshooting.recentRuns.push({
                executionArn: execution.executionArn,
                status: execution.status ?? '<unknown>',
                owner: input.owner,
                repo: input.repo,
                jobId: input.jobId,
            });
        }
    }
    catch (e) {
        status.troubleshooting.recentRuns.push({ status: `Error getting executions: ${e}` });
    }
    // get secrets
    let githubSecrets;
    try {
        githubSecrets = await (0, lambda_helpers_1.getSecretJsonValue)(process.env.GITHUB_SECRET_ARN);
    }
    catch (e) {
        status.github.auth.status = `Unable to read secret: ${e}`;
        return safeReturnValue(event, status);
    }
    let privateKey;
    try {
        privateKey = await (0, lambda_helpers_1.getSecretValue)(process.env.GITHUB_PRIVATE_KEY_SECRET_ARN);
    }
    catch (e) {
        status.github.auth.status = `Unable to read private key secret: ${e}`;
        return safeReturnValue(event, status);
    }
    // calculate base url
    let baseUrl = (0, lambda_github_1.baseUrlFromDomain)(githubSecrets.domain);
    status.github.domain = githubSecrets.domain;
    // copy runner level
    status.github.runnerLevel = githubSecrets.runnerLevel ?? 'repo';
    if (githubSecrets.personalAuthToken) {
        // try authenticating with personal access token
        status.github.auth.type = 'Personal Access Token';
        status.github.auth.personalAuthToken = '*redacted*';
        let octokit;
        try {
            octokit = new Octokit({ baseUrl, auth: githubSecrets.personalAuthToken });
        }
        catch (e) {
            status.github.auth.status = `Unable to authenticate using personal auth token: ${e}`;
            return safeReturnValue(event, status);
        }
        let user;
        try {
            user = await octokit.request('GET /user');
            status.github.auth.personalAuthToken = `username: ${user.data.login}`;
        }
        catch (e) {
            status.github.auth.status = `Unable to call /user with personal auth token: ${e}`;
            return safeReturnValue(event, status);
        }
        status.github.auth.status = 'OK';
        // classic tokens report their scopes in a header, so we can check them against the configured runner level
        // fine-grained tokens don't report their permissions, so there is nothing to check for them
        const scopesHeader = user.headers['x-oauth-scopes'];
        if (scopesHeader === undefined) {
            status.github.auth.personalAuthTokenScopes = 'Unable to check (expected for fine-grained tokens)';
        }
        else {
            const scopes = String(scopesHeader).split(',').map(s => s.trim()).filter(s => s);
            status.github.auth.personalAuthTokenScopes = scopes.join(', ');
            const runnerLevel = githubSecrets.runnerLevel === 'org' ? 'org' : 'repo';
            const requiredScopes = runnerLevel === 'repo' ? ['repo'] : ['admin:org', 'manage_runners:org'];
            if (!requiredScopes.some(s => scopes.includes(s))) {
                status.github.auth.status = `OK, but token has none of the scopes required to register runners on ${runnerLevel} level: ${requiredScopes.join(' or ')}`;
            }
        }
        status.github.webhook.status = 'Unable to verify automatically';
    }
    else {
        // try authenticating with GitHub app
        status.github.auth.type = 'GitHub App';
        status.github.auth.app.id = githubSecrets.appId;
        let appOctokit;
        try {
            appOctokit = new Octokit({
                baseUrl,
                authStrategy: createAppAuth,
                auth: {
                    appId: githubSecrets.appId,
                    privateKey: privateKey,
                },
            });
        }
        catch (e) {
            status.github.auth.status = `Unable to authenticate app: ${e}`;
            return safeReturnValue(event, status);
        }
        // get app url
        try {
            const appRes = await appOctokit.request('GET /app');
            const app = appRes.data;
            if (!app) {
                status.github.auth.status = `Unable to get app: ${appRes}`;
                return safeReturnValue(event, status);
            }
            status.github.auth.app.url = app.html_url;
        }
        catch (e) {
            status.github.auth.status = `Unable to get app details: ${e}`;
            return safeReturnValue(event, status);
        }
        // list all app installations
        try {
            const installations = (await appOctokit.request('GET /app/installations')).data;
            for (const installation of installations) {
                let installationDetails = {
                    id: installation.id,
                    url: installation.html_url,
                    status: 'Unable to query',
                    repositories: [],
                };
                let token;
                try {
                    token = (await appOctokit.auth({
                        type: 'installation',
                        installationId: installation.id,
                    })).token;
                }
                catch (e) {
                    installationDetails.status = `Unable to authenticate app installation: ${e}`;
                    continue;
                }
                let octokit;
                try {
                    octokit = new Octokit({ baseUrl, auth: token });
                }
                catch (e) {
                    installationDetails.status = `Unable to authenticate using app: ${e}`;
                    continue;
                }
                try {
                    const repositories = (await octokit.request('GET /installation/repositories')).data.repositories;
                    for (const repo of repositories) {
                        installationDetails.repositories.push(repo.full_name);
                    }
                }
                catch (e) {
                    installationDetails.status = `Unable to authenticate using installation token: ${e}`;
                    continue;
                }
                installationDetails.status = 'OK';
                status.github.auth.app.installations.push(installationDetails);
            }
        }
        catch (e) {
            status.github.auth.status = 'Unable to list app installations';
            return safeReturnValue(event, status);
        }
        status.github.auth.status = 'OK';
        // check webhook config
        try {
            const response = await appOctokit.request('GET /app/hook/config', {});
            status.github.webhook.configuredUrl = response.data.url || '(none)';
            if (response.data.url !== process.env.WEBHOOK_URL) {
                status.github.webhook.status = 'GitHub has wrong webhook URL configured. Runners will fail to start with a '
                    + 'token error. Use the webhook created by the app itself. A webhook configured by hand in repository '
                    + 'or organization settings cannot carry the required app installation id.';
            }
            else {
                // TODO check secret by doing a dummy delivery? force apply secret?
                status.github.webhook.status = 'OK (note that secret cannot be checked automatically)';
            }
        }
        catch (e) {
            status.github.webhook.status = `Unable to check app configuration. This probably means the app webhook is not turned on or has been replaced '
        + 'by a manually configured webhook. Runners will fail to start with a token error. [${e}]`;
            return safeReturnValue(event, status);
        }
    }
    return safeReturnValue(event, status);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RhdHVzLmxhbWJkYS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NyYy9zdGF0dXMubGFtYmRhLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBaUhBLDBCQTZRQztBQTlYRCwwRUFBb0c7QUFDcEcsb0RBQXVGO0FBQ3ZGLG9EQUF1RTtBQUN2RSxvREFBaUc7QUFFakcsbURBQXdHO0FBQ3hHLHFEQUFzRTtBQUV0RSxNQUFNLEdBQUcsR0FBRyxJQUFJLDRDQUFvQixFQUFFLENBQUM7QUFDdkMsTUFBTSxHQUFHLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFDNUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFDNUIsTUFBTSxFQUFFLEdBQUcsSUFBSSxzQkFBUyxFQUFFLENBQUM7QUFFM0IsU0FBUyxjQUFjLENBQUMsR0FBVztJQUNqQyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsd0VBQXdFO0lBQ3RHLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN4QixNQUFNLFFBQVEsR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFDMUIsTUFBTSxJQUFJLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDO0lBRTFELE9BQU8sV0FBVyxNQUFNLHNEQUFzRCxNQUFNLGtCQUFrQixJQUFJLEVBQUUsQ0FBQztBQUMvRyxDQUFDO0FBRUQsU0FBUyxjQUFjLENBQUMsR0FBVztJQUNqQyxNQUFNLEtBQUssR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsc0RBQXNEO0lBQ3BGLE1BQU0sTUFBTSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN4QixNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsQ0FBQyxDQUFD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LENBQUM7Z0JBQ2xELE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sR0FBRyw2RUFBNkU7c0JBQ3hHLHFHQUFxRztzQkFDckcseUVBQXlFLENBQUM7WUFDaEYsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLG1FQUFtRTtnQkFDbkUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsTUFBTSxHQUFHLHVEQUF1RCxDQUFDO1lBQ3pGLENBQUM7UUFDSCxDQUFDO1FBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUNYLE1BQU0sQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sR0FBRzsrRkFDMEQsQ0FBQyxHQUFHLENBQUM7WUFDOUYsT0FBTyxlQUFlLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0lBRUQsT0FBTyxlQUFlLENBQUMsS0FBSyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0FBQ3hDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDbG91ZEZvcm1hdGlvbkNsaWVudCwgRGVzY3JpYmVTdGFja1Jlc291cmNlQ29tbWFuZCB9IGZyb20gJ0Bhd3Mtc2RrL2NsaWVudC1jbG91ZGZvcm1hdGlvbic7XG5pbXBvcnQgeyBEZXNjcmliZUxhdW5jaFRlbXBsYXRlVmVyc2lvbnNDb21tYW5kLCBFQzJDbGllbnQgfSBmcm9tICdAYXdzLXNkay9jbGllbnQtZWMyJztcbmltcG9ydCB7IEVDUkNsaWVudCwgRGVzY3JpYmVJbWFnZXNDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LWVjcic7XG5pbXBvcnQgeyBEZXNjcmliZUV4ZWN1dGlvbkNvbW1hbmQsIExpc3RFeGVjdXRpb25zQ29tbWFuZCwgU0ZOQ2xpZW50IH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXNmbic7XG5pbXBvcnQgKiBhcyBBV1NMYW1iZGEgZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBiYXNlVXJsRnJvbURvbWFpbiwgR2l0SHViU2VjcmV0cywgbG9hZE9jdG9raXRBdXRoQXBwLCBsb2FkT2N0b2tpdENvcmUgfSBmcm9tICcuL2xhbWJkYS1naXRodWInO1xuaW1wb3J0IHsgZ2V0U2VjcmV0SnNvblZhbHVlLCBnZXRTZWNyZXRWYWx1ZSB9IGZyb20gJy4vbGFtYmRhLWhlbHBlcnMnO1xuXG5jb25zdCBjZm4gPSBuZXcgQ2xvdWRGb3JtYXRpb25DbGllbnQoKTtcbmNvbnN0IGVjMiA9IG5ldyBFQzJDbGllbnQoKTtcbmNvbnN0IGVjciA9IG5ldyBFQ1JDbGllbnQoKTtcbmNvbnN0IHNmID0gbmV3IFNGTkNsaWVudCgpO1xuXG5mdW5jdGlvbiBzZWNyZXRBcm5Ub1VybChhcm46IHN0cmluZykge1xuICBjb25zdCBwYXJ0cyA9IGFybi5zcGxpdCgnOicpOyAvLyBhcm46YXdzOnNlY3JldHNtYW5hZ2VyOnVzLWVhc3QtMToxMjM0NTY3ODpzZWNyZXQ6c2VjcmV0LW5hbWUtUkVWSVNJT05cbiAgY29uc3QgcmVnaW9uID0gcGFydHNbM107XG4gIGNvbnN0IGZ1bGxOYW1lID0gcGFydHNbNl07XG4gIGNvbnN0IG5hbWUgPSBmdWxsTmFtZS5zbGljZSgwLCBmdWxsTmFtZS5sYXN0SW5kZXhPZignLScpKTtcblxuICByZXR1cm4gYGh0dHBzOi8vJHtyZWdpb259LmNvbnNvbGUuYXdzLmFtYXpvbi5jb20vc2VjcmV0c21hbmFnZXIvaG9tZT9yZWdpb249JHtyZWdpb259IyEvc2VjcmV0P25hbWU9JHtuYW1lfWA7XG59XG5cbmZ1bmN0aW9uIGxhbWJkYUFyblRvVXJsKGFybjogc3RyaW5nKSB7XG4gIGNvbnN0IHBhcnRzID0gYXJuLnNwbGl0KCc6Jyk7IC8vIGFybjphd3M6bGFtYmRhOnVzLWVhc3QtMToxMjM0NTY3ODpmdW5jdGlvbjpuYW1lLVhZWlxuICBjb25zdCByZWdpb24gPSBwYXJ0c1szXTtcbiAgY29uc3QgbmFtZSA9IHBhcnRzWzZdO1xuXG4gIHJldHVybiBgaHR0cHM6Ly8ke3JlZ2lvbn0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9sYW1iZGEvaG9tZT9yZWdpb249JHtyZWdpb259Iy9mdW5jdGlvbnMvJHtuYW1lfT90YWI9bW9uaXRvcmluZ2A7XG59XG5cbmZ1bmN0aW9uIGxhbWJkYUFyblRvTG9nR3JvdXAoYXJuOiBzdHJpbmcpIHtcbiAgY29uc3QgcGFydHMgPSBhcm4uc3BsaXQoJzonKTsgLy8gYXJuOmF3czpsYW1iZGE6dXMtZWFzdC0xOjEyMzQ1Njc4OmZ1bmN0aW9uOm5hbWUtWFlaXG4gIGNvbnN0IG5hbWUgPSBwYXJ0c1s2XTtcblxuICByZXR1cm4gYC9hd3MvbGFtYmRhLyR7bmFtZX1gO1xufVxuXG5mdW5jdGlvbiBzdGVwRnVuY3Rpb25Bcm5Ub1VybChhcm46IHN0cmluZykge1xuICBjb25zdCBwYXJ0cyA9IGFybi5zcGxpdCgnOicpOyAvLyBhcm46YXdzOnN0YXRlczp1cy1lYXN0LTE6MTIzNDU2Nzg6c3RhdGVNYWNoaW5lOm5hbWUtWFlaXG4gIGNvbnN0IHJlZ2lvbiA9IHBhcnRzWzNdO1xuXG4gIHJldHVybiBgaHR0cHM6Ly8ke3JlZ2lvbn0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9zdGF0ZXMvaG9tZT9yZWdpb249JHtyZWdpb259Iy9zdGF0ZW1hY2hpbmVzL3ZpZXcvJHthcm59YDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVQcm92aWRlcnNTdGF0dXMoc3RhY2s6IHN0cmluZywgbG9naWNhbElkOiBzdHJpbmcpIHtcbiAgY29uc3QgcmVzb3VyY2UgPSBhd2FpdCBjZm4uc2VuZChuZXcgRGVzY3JpYmVTdGFja1Jlc291cmNlQ29tbWFuZCh7IFN0YWNrTmFtZTogc3RhY2ssIExvZ2ljYWxSZXNvdXJjZUlkOiBsb2dpY2FsSWQgfSkpO1xuICBjb25zdCBwcm92aWRlcnMgPSBKU09OLnBhcnNlKHJlc291cmNlLlN0YWNrUmVzb3VyY2VEZXRhaWw/Lk1ldGFkYXRhID8/ICd7fScpLnByb3ZpZGVycyBhcyBhbnlbXSB8IHVuZGVmaW5lZDtcblxuICBpZiAoIXByb3ZpZGVycykge1xuICAgIHJldHVybiB7fTtcbiAgfVxuXG4gIHJldHVybiBQcm9taXNlLmFsbChwcm92aWRlcnMubWFwKGFzeW5jIChwKSA9PiB7XG4gICAgLy8gYWRkIEVDUiBkYXRhLCBpZiBpbWFnZSBpcyBmcm9tIEVDUlxuICAgIGlmIChwLmltYWdlPy5pbWFnZVJlcG9zaXRvcnk/Lm1hdGNoKC9bMC05XStcXC5ka3JcXC5lY3JcXC5bYS16MC05XFwtXStcXC5hbWF6b25hd3NcXC5jb21cXC8uKy8pKSB7XG4gICAgICBjb25zdCB0YWdzID0gYXdhaXQgZWNyLnNlbmQobmV3IERlc2NyaWJlSW1hZ2VzQ29tbWFuZCh7XG4gICAgICAgIHJlcG9zaXRvcnlOYW1lOiBwLmltYWdlLmltYWdlUmVwb3NpdG9yeS5zcGxpdCgnLycpWzFdLFxuICAgICAgICBmaWx0ZXI6IHtcbiAgICAgICAgICB0YWdTdGF0dXM6ICdUQUdHRUQnLFxuICAgICAgICB9LFxuICAgICAgICBtYXhSZXN1bHRzOiAxLFxuICAgICAgfSkpO1xuICAgICAgaWYgKHRhZ3MuaW1hZ2VEZXRhaWxzICYmIHRhZ3MuaW1hZ2VEZXRhaWxzPy5sZW5ndGggPj0gMSkge1xuICAgICAgICBwLmltYWdlLmxhdGVzdEltYWdlID0ge1xuICAgICAgICAgIHRhZ3M6IHRhZ3MuaW1hZ2VEZXRhaWxzWzBdLmltYWdlVGFncyxcbiAgICAgICAgICBkaWdlc3Q6IHRhZ3MuaW1hZ2VEZXRhaWxzWzBdLmltYWdlRGlnZXN0LFxuICAgICAgICAgIGRhdGU6IHRhZ3MuaW1hZ2VEZXRhaWxzWzBdLmltYWdlUHVzaGVkQXQsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfVxuICAgIC8vIGFkZCBBTUkgZGF0YSwgaWYgaW1hZ2UgaXMgQU1JXG4gICAgaWYgKHAuYW1pPy5sYXVuY2hUZW1wbGF0ZSkge1xuICAgICAgY29uc3QgdmVyc2lvbnMgPSBhd2FpdCBlYzIuc2VuZChuZXcgRGVzY3JpYmVMYXVuY2hUZW1wbGF0ZVZlcnNpb25zQ29tbWFuZCh7XG4gICAgICAgIExhdW5jaFRlbXBsYXRlSWQ6IHAuYW1pLmxhdW5jaFRlbXBsYXRlLFxuICAgICAgICBWZXJzaW9uczogWyckRGVmYXVsdCddLFxuICAgICAgfSkpO1xuICAgICAgaWYgKHZlcnNpb25zLkxhdW5jaFRlbXBsYXRlVmVyc2lvbnMgJiYgdmVyc2lvbnMuTGF1bmNoVGVtcGxhdGVWZXJzaW9ucy5sZW5ndGggPj0gMSkge1xuICAgICAgICBwLmFtaS5sYXRlc3RBbWkgPSB2ZXJzaW9ucy5MYXVuY2hUZW1wbGF0ZVZlcnNpb25zWzBdLkxhdW5jaFRlbXBsYXRlRGF0YT8uSW1hZ2VJZDtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHA7XG4gIH0pKTtcbn1cblxuaW50ZXJmYWNlIEFwcEluc3RhbGxhdGlvbiB7XG4gIHJlYWRvbmx5IGlkOiBudW1iZXI7XG4gIHJlYWRvbmx5IHVybDogc3RyaW5nO1xuICByZWFkb25seSBzdGF0dXM6IHN0cmluZztcbiAgcmVhZG9ubHkgcmVwb3NpdG9yaWVzOiBzdHJpbmdbXTtcbn1cblxuaW50ZXJmYWNlIFJlY2VudFJ1biB7XG4gIHJlYWRvbmx5IG93bmVyPzogc3RyaW5nO1xuICByZWFkb25seSByZXBvPzogc3RyaW5nO1xuICByZWFkb25seSBqb2JJZD86IHN0cmluZztcbiAgcmVhZG9ubHkgZXhlY3V0aW9uQXJuPzogc3RyaW5nO1xuICByZWFkb25seSBzdGF0dXM6IHN0cmluZztcbn1cblxuZnVuY3Rpb24gc2FmZVJldHVyblZhbHVlKGV2ZW50OiBQYXJ0aWFsPEFXU0xhbWJkYS5BUElHYXRld2F5UHJveHlFdmVudD4sIHN0YXR1czogYW55KSB7XG4gIGlmIChldmVudC5wYXRoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShzdGF0dXMpLFxuICAgIH07XG4gIH1cblxuICByZXR1cm4gc3RhdHVzO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlcihldmVudDogUGFydGlhbDxBV1NMYW1iZGEuQVBJR2F0ZXdheVByb3h5RXZlbnQ+KSB7XG4gIC8vIGNvbmZpcm0gcmVxdWlyZWQgZW52aXJvbm1lbnQgdmFyaWFibGVzXG4gIGlmICghcHJvY2Vzcy5lbnYuV0VCSE9PS19TRUNSRVRfQVJOIHx8ICFwcm9jZXNzLmVudi5HSVRIVUJfU0VDUkVUX0FSTiB8fCAhcHJvY2Vzcy5lbnYuR0lUSFVCX1BSSVZBVEVfS0VZX1NFQ1JFVF9BUk4gfHwgIXByb2Nlc3MuZW52LkxPR0lDQUxfSUQgfHxcbiAgICAgICFwcm9jZXNzLmVudi5XRUJIT09LX0hBTkRMRVJfQVJOIHx8ICFwcm9jZXNzLmVudi5TVEVQX0ZVTkNUSU9OX0FSTiB8fCAhcHJvY2Vzcy5lbnYuU0VUVVBfU0VDUkVUX0FSTiB8fFxuICAgICAgIXByb2Nlc3MuZW52LlNUQUNLX05BTUUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ01pc3NpbmcgZW52aXJvbm1lbnQgdmFyaWFibGVzJyk7XG4gIH1cblxuICBjb25zdCBbY29yZSwgYXV0aEFwcF0gPSBhd2FpdCBQcm9taXNlLmFsbChbXG4gICAgbG9hZE9jdG9raXRDb3JlKCksXG4gICAgbG9hZE9jdG9raXRBdXRoQXBwKCksXG4gIF0pO1xuICBjb25zdCB7IE9jdG9raXQgfSA9IGNvcmU7XG4gIGNvbnN0IHsgY3JlYXRlQXBwQXV0aCB9ID0gYXV0aEFwcDtcblxuICAvLyBiYXNlIHN0YXR1c1xuICBjb25zdCBzdGF0dXMgPSB7XG4gICAgZ2l0aHViOiB7XG4gICAgICBzZXR1cDoge1xuICAgICAgICBzdGF0dXM6ICdVbmtub3duJyxcbiAgICAgICAgdXJsOiAnJyxcbiAgICAgICAgc2VjcmV0QXJuOiBwcm9jZXNzLmVudi5TRVRVUF9TRUNSRVRfQVJOLFxuICAgICAgICBzZWNyZXRVcmw6IHNlY3JldEFyblRvVXJsKHByb2Nlc3MuZW52LlNFVFVQX1NFQ1JFVF9BUk4pLFxuICAgICAgfSxcbiAgICAgIGRvbWFpbjogJ1Vua25vd24nLFxuICAgICAgcnVubmVyTGV2ZWw6ICdVbmtub3duJyxcbiAgICAgIHdlYmhvb2s6IHtcbiAgICAgICAgdXJsOiBwcm9jZXNzLmVudi5XRUJIT09LX1VSTCxcbiAgICAgICAgY29uZmlndXJlZFVybDogJ1Vua25vd24nLFxuICAgICAgICBzdGF0dXM6ICdVbmFibGUgdG8gY2hlY2snLFxuICAgICAgICBzZWNyZXRBcm46IHByb2Nlc3MuZW52LldFQkhPT0tfU0VDUkVUX0FSTixcbiAgICAgICAgc2VjcmV0VXJsOiBzZWNyZXRBcm5Ub1VybChwcm9jZXNzLmVudi5XRUJIT09LX1NFQ1JFVF9BUk4pLFxuICAgICAgfSxcbiAgICAgIGF1dGg6IHtcbiAgICAgICAgdHlwZTogJ1Vua25vd24nLFxuICAgICAgICBzdGF0dXM6ICdVbmtub3duJyxcbiAgICAgICAgc2VjcmV0QXJuOiBwcm9jZXNzLmVudi5HSVRIVUJfU0VDUkVUX0FSTixcbiAgICAgICAgc2VjcmV0VXJsOiBzZWNyZXRBcm5Ub1VybChwcm9jZXNzLmVudi5HSVRIVUJfU0VDUkVUX0FSTiksXG4gICAgICAgIHByaXZhdGVLZXlTZWNyZXRBcm46IHByb2Nlc3MuZW52LkdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOLFxuICAgICAgICBwcml2YXRlS2V5U2VjcmV0VXJsOiBzZWNyZXRBcm5Ub1VybChwcm9jZXNzLmVudi5HSVRIVUJfUFJJVkFURV9LRVlfU0VDUkVUX0FSTiksXG4gICAgICAgIGFwcDoge1xuICAgICAgICAgIGlkOiAtMSxcbiAgICAgICAgICB1cmw6ICcnLFxuICAgICAgICAgIGluc3RhbGxhdGlvbnM6IFtdIGFzIEFwcEluc3RhbGxhdGlvbltdLFxuICAgICAgICB9LFxuICAgICAgICBwZXJzb25hbEF1dGhUb2tlbjogJycsXG4gICAgICAgIHBlcnNvbmFsQXV0aFRva2VuU2NvcGVzOiAnJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBwcm92aWRlcnM6IGF3YWl0IGdlbmVyYXRlUHJvdmlkZXJzU3RhdHVzKHByb2Nlc3MuZW52LlNUQUNLX05BTUUsIHByb2Nlc3MuZW52LkxPR0lDQUxfSUQpLFxuICAgIHRyb3VibGVzaG9vdGluZzoge1xuICAgICAgd2ViaG9va0hhbmRsZXJBcm46IHByb2Nlc3MuZW52LldFQkhPT0tfSEFORExFUl9BUk4sXG4gICAgICB3ZWJob29rSGFuZGxlclVybDogbGFtYmRhQXJuVG9VcmwocHJvY2Vzcy5lbnYuV0VCSE9PS19IQU5ETEVSX0FSTiksXG4gICAgICB3ZWJob29rSGFuZGxlckxvZ0dyb3VwOiBsYW1iZGFBcm5Ub0xvZ0dyb3VwKHByb2Nlc3MuZW52LldFQkhPT0tfSEFORExFUl9BUk4pLFxuICAgICAgc3RlcEZ1bmN0aW9uQXJuOiBwcm9jZXNzLmVudi5TVEVQX0ZVTkNUSU9OX0FSTixcbiAgICAgIHN0ZXBGdW5jdGlvblVybDogc3RlcEZ1bmN0aW9uQXJuVG9VcmwocHJvY2Vzcy5lbnYuU1RFUF9GVU5DVElPTl9BUk4pLFxuICAgICAgc3RlcEZ1bmN0aW9uTG9nR3JvdXA6IHByb2Nlc3MuZW52LlNURVBfRlVOQ1RJT05fTE9HX0dST1VQLFxuICAgICAgcmVjZW50UnVuczogW10gYXMgUmVjZW50UnVuW10sXG4gICAgfSxcbiAgfTtcblxuICAvLyBzZXR1cCB1cmxcbiAgaWYgKHByb2Nlc3MuZW52LlNFVFVQX0ZVTkNUSU9OX1VSTCkge1xuICAgIGNvbnN0IHNldHVwVG9rZW4gPSAoYXdhaXQgZ2V0U2VjcmV0SnNvblZhbHVlKHByb2Nlc3MuZW52LlNFVFVQX1NFQ1JFVF9BUk4pKS50b2tlbjtcbiAgICBpZiAoc2V0dXBUb2tlbikge1xuICAgICAgc3RhdHVzLmdpdGh1Yi5zZXR1cC5zdGF0dXMgPSAnUGVuZGluZyc7XG4gICAgICBzdGF0dXMuZ2l0aHViLnNldHVwLnVybCA9IGAke3Byb2Nlc3MuZW52LlNFVFVQX0ZVTkNUSU9OX1VSTH0/dG9rZW49JHtzZXR1cFRva2VufWA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHN0YXR1cy5naXRodWIuc2V0dXAuc3RhdHVzID0gJ0NvbXBsZXRlJztcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgc3RhdHVzLmdpdGh1Yi5zZXR1cC5zdGF0dXMgPSAnRGlzYWJsZWQnO1xuICB9XG5cbiAgLy8gbGlzdCBsYXN0IDEwIGV4ZWN1dGlvbnMgYW5kIHRoZWlyIHN0YXR1c1xuICB0cnkge1xuICAgIGNvbnN0IGV4ZWN1dGlvbnMgPSBhd2FpdCBzZi5zZW5kKG5ldyBMaXN0RXhlY3V0aW9uc0NvbW1hbmQoe1xuICAgICAgc3RhdGVNYWNoaW5lQXJuOiBwcm9jZXNzLmVudi5TVEVQX0ZVTkNUSU9OX0FSTixcbiAgICAgIG1heFJlc3VsdHM6IDEwLFxuICAgIH0pKTtcbiAgICBmb3IgKGNvbnN0IGV4ZWN1dGlvbiBvZiBleGVjdXRpb25zLmV4ZWN1dGlvbnMgPz8gW10pIHtcbiAgICAgIGNvbnN0IGV4ZWN1dGlvbkRldGFpbHMgPSBhd2FpdCBzZi5zZW5kKG5ldyBEZXNjcmliZUV4ZWN1dGlvbkNvbW1hbmQoe1xuICAgICAgICBleGVjdXRpb25Bcm46IGV4ZWN1dGlvbi5leGVjdXRpb25Bcm4sXG4gICAgICB9KSk7XG4gICAgICBjb25zdCBpbnB1dCA9IEpTT04ucGFyc2UoZXhlY3V0aW9uRGV0YWlscy5pbnB1dCB8fCAne30nKTtcblxuICAgICAgc3RhdHVzLnRyb3VibGVzaG9vdGluZy5yZWNlbnRSdW5zLnB1c2goe1xuICAgICAgICBleGVjdXRpb25Bcm46IGV4ZWN1dGlvbi5leGVjdXRpb25Bcm4sXG4gICAgICAgIHN0YXR1czogZXhlY3V0aW9uLnN0YXR1cyA/PyAnPHVua25vd24+JyxcbiAgICAgICAgb3duZXI6IGlucHV0Lm93bmVyLFxuICAgICAgICByZXBvOiBpbnB1dC5yZXBvLFxuICAgICAgICBqb2JJZDogaW5wdXQuam9iSWQsXG4gICAgICB9KTtcbiAgICB9XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBzdGF0dXMudHJvdWJsZXNob290aW5nLnJlY2VudFJ1bnMucHVzaCh7IHN0YXR1czogYEVycm9yIGdldHRpbmcgZXhlY3V0aW9uczogJHtlfWAgfSk7XG4gIH1cblxuICAvLyBnZXQgc2VjcmV0c1xuICBsZXQgZ2l0aHViU2VjcmV0czogR2l0SHViU2VjcmV0cztcbiAgdHJ5IHtcbiAgICBnaXRodWJTZWNyZXRzID0gYXdhaXQgZ2V0U2VjcmV0SnNvblZhbHVlKHByb2Nlc3MuZW52LkdJVEhVQl9TRUNSRVRfQVJOKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHN0YXR1cy5naXRodWIuYXV0aC5zdGF0dXMgPSBgVW5hYmxlIHRvIHJlYWQgc2VjcmV0OiAke2V9YDtcbiAgICByZXR1cm4gc2FmZVJldHVyblZhbHVlKGV2ZW50LCBzdGF0dXMpO1xuICB9XG5cbiAgbGV0IHByaXZhdGVLZXk7XG4gIHRyeSB7XG4gICAgcHJpdmF0ZUtleSA9IGF3YWl0IGdldFNlY3JldFZhbHVlKHByb2Nlc3MuZW52LkdJVEhVQl9QUklWQVRFX0tFWV9TRUNSRVRfQVJOKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIHN0YXR1cy5naXRodWIuYXV0aC5zdGF0dXMgPSBgVW5hYmxlIHRvIHJlYWQgcHJpdmF0ZSBrZXkgc2VjcmV0OiAke2V9YDtcbiAgICByZXR1cm4gc2FmZVJldHVyblZhbHVlKGV2ZW50LCBzdGF0dXMpO1xuICB9XG5cbiAgLy8gY2FsY3VsYXRlIGJhc2UgdXJsXG4gIGxldCBiYXNlVXJsID0gYmFzZVVybEZyb21Eb21haW4oZ2l0aHViU2VjcmV0cy5kb21haW4pO1xuICBzdGF0dXMuZ2l0aHViLmRvbWFpbiA9IGdpdGh1YlNlY3JldHMuZG9tYWluO1xuXG4gIC8vIGNvcHkgcnVubmVyIGxldmVsXG4gIHN0YXR1cy5naXRodWIucnVubmVyTGV2ZWwgPSBnaXRodWJTZWNyZXRzLnJ1bm5lckxldmVsID8/ICdyZXBvJztcblxuICBpZiAoZ2l0aHViU2VjcmV0cy5wZXJzb25hbEF1dGhUb2tlbikge1xuICAgIC8vIHRyeSBhdXRoZW50aWNhdGluZyB3aXRoIHBlcnNvbmFsIGFjY2VzcyB0b2tlblxuICAgIHN0YXR1cy5naXRodWIuYXV0aC50eXBlID0gJ1BlcnNvbmFsIEFjY2VzcyBUb2tlbic7XG4gICAgc3RhdHVzLmdpdGh1Yi5hdXRoLnBlcnNvbmFsQXV0aFRva2VuID0gJypyZWRhY3RlZConO1xuXG4gICAgbGV0IG9jdG9raXQ7XG4gICAgdHJ5IHtcbiAgICAgIG9jdG9raXQgPSBuZXcgT2N0b2tpdCh7IGJhc2VVcmwsIGF1dGg6IGdpdGh1YlNlY3JldHMucGVyc29uYWxBdXRoVG9rZW4gfSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgc3RhdHVzLmdpdGh1Yi5hdXRoLnN0YXR1cyA9IGBVbmFibGUgdG8gYXV0aGVudGljYXRlIHVzaW5nIHBlcnNvbmFsIGF1dGggdG9rZW46ICR7ZX1gO1xuICAgICAgcmV0dXJuIHNhZmVSZXR1cm5WYWx1ZShldmVudCwgc3RhdHVzKTtcbiAgICB9XG5cbiAgICBsZXQgdXNlcjtcbiAgICB0cnkge1xuICAgICAgdXNlciA9IGF3YWl0IG9jdG9raXQucmVxdWVzdCgnR0VUIC91c2VyJyk7XG4gICAgICBzdGF0dXMuZ2l0aHViLmF1dGgucGVyc29uYWxBdXRoVG9rZW4gPSBgdXNlcm5hbWU6ICR7dXNlci5kYXRhLmxvZ2lufWA7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgc3RhdHVzLmdpdGh1Yi5hdXRoLnN0YXR1cyA9IGBVbmFibGUgdG8gY2FsbCAvdXNlciB3aXRoIHBlcnNvbmFsIGF1dGggdG9rZW46ICR7ZX1gO1xuICAgICAgcmV0dXJuIHNhZmVSZXR1cm5WYWx1ZShldmVudCwgc3RhdHVzKTtcbiAgICB9XG5cbiAgICBzdGF0dXMuZ2l0aHViLmF1dGguc3RhdHVzID0gJ09LJztcblxuICAgIC8vIGNsYXNzaWMgdG9rZW5zIHJlcG9ydCB0aGVpciBzY29wZXMgaW4gYSBoZWFkZXIsIHNvIHdlIGNhbiBjaGVjayB0aGVtIGFnYWluc3QgdGhlIGNvbmZpZ3VyZWQgcnVubmVyIGxldmVsXG4gICAgLy8gZmluZS1ncmFpbmVkIHRva2VucyBkb24ndCByZXBvcnQgdGhlaXIgcGVybWlzc2lvbnMsIHNvIHRoZXJlIGlzIG5vdGhpbmcgdG8gY2hlY2sgZm9yIHRoZW1cbiAgICBjb25zdCBzY29wZXNIZWFkZXIgPSB1c2VyLmhlYWRlcnNbJ3gtb2F1dGgtc2NvcGVzJ107XG4gICAgaWYgKHNjb3Blc0hlYWRlciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBzdGF0dXMuZ2l0aHViLmF1dGgucGVyc29uYWxBdXRoVG9rZW5TY29wZXMgPSAnVW5hYmxlIHRvIGNoZWNrIChleHBlY3RlZCBmb3IgZmluZS1ncmFpbmVkIHRva2VucyknO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBzY29wZXMgPSBTdHJpbmcoc2NvcGVzSGVhZGVyKS5zcGxpdCgnLCcpLm1hcChzID0+IHMudHJpbSgpKS5maWx0ZXIocyA9PiBzKTtcbiAgICAgIHN0YXR1cy5naXRodWIuYXV0aC5wZXJzb25hbEF1dGhUb2tlblNjb3BlcyA9IHNjb3Blcy5qb2luKCcsICcpO1xuXG4gICAgICBjb25zdCBydW5uZXJMZXZlbCA9IGdpdGh1YlNlY3JldHMucnVubmVyTGV2ZWwgPT09ICdvcmcnID8gJ29yZycgOiAncmVwbyc7XG4gICAgICBjb25zdCByZXF1aXJlZFNjb3BlcyA9IHJ1bm5lckxldmVsID09PSAncmVwbycgPyBbJ3JlcG8nXSA6IFsnYWRtaW46b3JnJywgJ21hbmFnZV9ydW5uZXJzOm9yZyddO1xuICAgICAgaWYgKCFyZXF1aXJlZFNjb3Blcy5zb21lKHMgPT4gc2NvcGVzLmluY2x1ZGVzKHMpKSkge1xuICAgICAgICBzdGF0dXMuZ2l0aHViLmF1dGguc3RhdHVzID0gYE9LLCBidXQgdG9rZW4gaGFzIG5vbmUgb2YgdGhlIHNjb3BlcyByZXF1aXJlZCB0byByZWdpc3RlciBydW5uZXJzIG9uICR7cnVubmVyTGV2ZWx9IGxldmVsOiAke3JlcXVpcmVkU2NvcGVzLmpvaW4oJyBvciAnKX1gO1xuICAgICAgfVxuICAgIH1cblxuICAgIHN0YXR1cy5naXRodWIud2ViaG9vay5zdGF0dXMgPSAnVW5hYmxlIHRvIHZlcmlmeSBhdXRvbWF0aWNhbGx5JztcbiAgfSBlbHNlIHtcbiAgICAvLyB0cnkgYXV0aGVudGljYXRpbmcgd2l0aCBHaXRIdWIgYXBwXG4gICAgc3RhdHVzLmdpdGh1Yi5hdXRoLnR5cGUgPSAnR2l0SHViIEFwcCc7XG4gICAgc3RhdHVzLmdpdGh1Yi5hdXRoLmFwcC5pZCA9IGdpdGh1YlNlY3JldHMuYXBwSWQ7XG5cbiAgICBsZXQgYXBwT2N0b2tpdDtcbiAgICB0cnkge1xuICAgICAgYXBwT2N0b2tpdCA9IG5ldyBPY3Rva2l0KHtcbiAgICAgICAgYmFzZVVybCxcbiAgICAgICAgYXV0aFN0cmF0ZWd5OiBjcmVhdGVBcHBBdXRoLFxuICAgICAgICBhdXRoOiB7XG4gICAgICAgICAgYXBwSWQ6IGdpdGh1YlNlY3JldHMuYXBwSWQsXG4gICAgICAgICAgcHJpdmF0ZUtleTogcHJpdmF0ZUtleSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHN0YXR1cy5naXRodWIuYXV0aC5zdGF0dXMgPSBgVW5hYmxlIHRvIGF1dGhlbnRpY2F0ZSBhcHA6ICR7ZX1gO1xuICAgICAgcmV0dXJuIHNhZmVSZXR1cm5WYWx1ZShldmVudCwgc3RhdHVzKTtcbiAgICB9XG5cbiAgICAvLyBnZXQgYXBwIHVybFxuICAgIHRyeSB7XG4gICAgICBjb25zdCBhcHBSZXMgPSBhd2FpdCBhcHBPY3Rva2l0LnJlcXVlc3QoJ0dFVCAvYXBwJyk7XG4gICAgICBjb25zdCBhcHAgPSBhcHBSZXMuZGF0YTtcbiAgICAgIGlmICghYXBwKSB7XG4gICAgICAgIHN0YXR1cy5naXRodWIuYXV0aC5zdGF0dXMgPSBgVW5hYmxlIHRvIGdldCBhcHA6ICR7YXBwUmVzfWA7XG4gICAgICAgIHJldHVybiBzYWZlUmV0dXJuVmFsdWUoZXZlbnQsIHN0YXR1cyk7XG4gICAgICB9XG4gICAgICBzdGF0dXMuZ2l0aHViLmF1dGguYXBwLnVybCA9IGFwcC5odG1sX3VybDtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBzdGF0dXMuZ2l0aHViLmF1dGguc3RhdHVzID0gYFVuYWJsZSB0byBnZXQgYXBwIGRldGFpbHM6ICR7ZX1gO1xuICAgICAgcmV0dXJuIHNhZmVSZXR1cm5WYWx1ZShldmVudCwgc3RhdHVzKTtcbiAgICB9XG5cbiAgICAvLyBsaXN0IGFsbCBhcHAgaW5zdGFsbGF0aW9uc1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBpbnN0YWxsYXRpb25zID0gKGF3YWl0IGFwcE9jdG9raXQucmVxdWVzdCgnR0VUIC9hcHAvaW5zdGFsbGF0aW9ucycpKS5kYXRhO1xuICAgICAgZm9yIChjb25zdCBpbnN0YWxsYXRpb24gb2YgaW5zdGFsbGF0aW9ucykge1xuICAgICAgICBsZXQgaW5zdGFsbGF0aW9uRGV0YWlscyA9IHtcbiAgICAgICAgICBpZDogaW5zdGFsbGF0aW9uLmlkLFxuICAgICAgICAgIHVybDogaW5zdGFsbGF0aW9uLmh0bWxfdXJsLFxuICAgICAgICAgIHN0YXR1czogJ1VuYWJsZSB0byBxdWVyeScsXG4gICAgICAgICAgcmVwb3NpdG9yaWVzOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgICAgfTtcblxuICAgICAgICBsZXQgdG9rZW47XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgdG9rZW4gPSAoYXdhaXQgYXBwT2N0b2tpdC5hdXRoKHtcbiAgICAgICAgICAgIHR5cGU6ICdpbnN0YWxsYXRpb24nLFxuICAgICAgICAgICAgaW5zdGFsbGF0aW9uSWQ6IGluc3RhbGxhdGlvbi5pZCxcbiAgICAgICAgICB9KSBhcyBhbnkpLnRva2VuO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgaW5zdGFsbGF0aW9uRGV0YWlscy5zdGF0dXMgPSBgVW5hYmxlIHRvIGF1dGhlbnRpY2F0ZSBhcHAgaW5zdGFsbGF0aW9uOiAke2V9YDtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCBvY3Rva2l0O1xuICAgICAgICB0cnkge1xuICAgICAgICAgIG9jdG9raXQgPSBuZXcgT2N0b2tpdCh7IGJhc2VVcmwsIGF1dGg6IHRva2VuIH0pO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgaW5zdGFsbGF0aW9uRGV0YWlscy5zdGF0dXMgPSBgVW5hYmxlIHRvIGF1dGhlbnRpY2F0ZSB1c2luZyBhcHA6ICR7ZX1gO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCByZXBvc2l0b3JpZXMgPSAoYXdhaXQgb2N0b2tpdC5yZXF1ZXN0KCdHRVQgL2luc3RhbGxhdGlvbi9yZXBvc2l0b3JpZXMnKSkuZGF0YS5yZXBvc2l0b3JpZXM7XG4gICAgICAgICAgZm9yIChjb25zdCByZXBvIG9mIHJlcG9zaXRvcmllcykge1xuICAgICAgICAgICAgaW5zdGFsbGF0aW9uRGV0YWlscy5yZXBvc2l0b3JpZXMucHVzaChyZXBvLmZ1bGxfbmFtZSBhcyBzdHJpbmcpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIGluc3RhbGxhdGlvbkRldGFpbHMuc3RhdHVzID0gYFVuYWJsZSB0byBhdXRoZW50aWNhdGUgdXNpbmcgaW5zdGFsbGF0aW9uIHRva2VuOiAke2V9YDtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGluc3RhbGxhdGlvbkRldGFpbHMuc3RhdHVzID0gJ09LJztcbiAgICAgICAgc3RhdHVzLmdpdGh1Yi5hdXRoLmFwcC5pbnN0YWxsYXRpb25zLnB1c2goaW5zdGFsbGF0aW9uRGV0YWlscyk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgc3RhdHVzLmdpdGh1Yi5hdXRoLnN0YXR1cyA9ICdVbmFibGUgdG8gbGlzdCBhcHAgaW5zdGFsbGF0aW9ucyc7XG4gICAgICByZXR1cm4gc2FmZVJldHVyblZhbHVlKGV2ZW50LCBzdGF0dXMpO1xuICAgIH1cblxuICAgIHN0YXR1cy5naXRodWIuYXV0aC5zdGF0dXMgPSAnT0snO1xuXG4gICAgLy8gY2hlY2sgd2ViaG9vayBjb25maWdcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBhcHBPY3Rva2l0LnJlcXVlc3QoJ0dFVCAvYXBwL2hvb2svY29uZmlnJywge30pO1xuXG4gICAgICBzdGF0dXMuZ2l0aHViLndlYmhvb2suY29uZmlndXJlZFVybCA9IHJlc3BvbnNlLmRhdGEudXJsIHx8ICcobm9uZSknO1xuXG4gICAgICBpZiAocmVzcG9uc2UuZGF0YS51cmwgIT09IHByb2Nlc3MuZW52LldFQkhPT0tfVVJMKSB7XG4gICAgICAgIHN0YXR1cy5naXRodWIud2ViaG9vay5zdGF0dXMgPSAnR2l0SHViIGhhcyB3cm9uZyB3ZWJob29rIFVSTCBjb25maWd1cmVkLiBSdW5uZXJzIHdpbGwgZmFpbCB0byBzdGFydCB3aXRoIGEgJ1xuICAgICAgICAgICsgJ3Rva2VuIGVycm9yLiBVc2UgdGhlIHdlYmhvb2sgY3JlYXRlZCBieSB0aGUgYXBwIGl0c2VsZi4gQSB3ZWJob29rIGNvbmZpZ3VyZWQgYnkgaGFuZCBpbiByZXBvc2l0b3J5ICdcbiAgICAgICAgICArICdvciBvcmdhbml6YXRpb24gc2V0dGluZ3MgY2Fubm90IGNhcnJ5IHRoZSByZXF1aXJlZCBhcHAgaW5zdGFsbGF0aW9uIGlkLic7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBUT0RPIGNoZWNrIHNlY3JldCBieSBkb2luZyBhIGR1bW15IGRlbGl2ZXJ5PyBmb3JjZSBhcHBseSBzZWNyZXQ/XG4gICAgICAgIHN0YXR1cy5naXRodWIud2ViaG9vay5zdGF0dXMgPSAnT0sgKG5vdGUgdGhhdCBzZWNyZXQgY2Fubm90IGJlIGNoZWNrZWQgYXV0b21hdGljYWxseSknO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHN0YXR1cy5naXRodWIud2ViaG9vay5zdGF0dXMgPSBgVW5hYmxlIHRvIGNoZWNrIGFwcCBjb25maWd1cmF0aW9uLiBUaGlzIHByb2JhYmx5IG1lYW5zIHRoZSBhcHAgd2ViaG9vayBpcyBub3QgdHVybmVkIG9uIG9yIGhhcyBiZWVuIHJlcGxhY2VkICdcbiAgICAgICAgKyAnYnkgYSBtYW51YWxseSBjb25maWd1cmVkIHdlYmhvb2suIFJ1bm5lcnMgd2lsbCBmYWlsIHRvIHN0YXJ0IHdpdGggYSB0b2tlbiBlcnJvci4gWyR7ZX1dYDtcbiAgICAgIHJldHVybiBzYWZlUmV0dXJuVmFsdWUoZXZlbnQsIHN0YXR1cyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHNhZmVSZXR1cm5WYWx1ZShldmVudCwgc3RhdHVzKTtcbn1cbiJdfQ==