"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINIMAL_EC2_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.MINIMAL_ECS_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.MINIMAL_SSM_SESSION_MANAGER_POLICY_STATEMENT = exports.SingletonLogType = void 0;
exports.singletonLambda = singletonLambda;
exports.singletonLogGroup = singletonLogGroup;
exports.discoverCertificateFiles = discoverCertificateFiles;
const fs = require("fs");
const path = require("path");
const aws_cdk_lib_1 = require("aws-cdk-lib");
const cdk = require("aws-cdk-lib");
/**
 * Initialize or return a singleton Lambda function instance.
 *
 * @internal
 */
function singletonLambda(functionType, scope, id, props) {
    const constructName = `${id}-dcc036c8-876b-451e-a2c1-552f9e06e9e1`;
    const existing = cdk.Stack.of(scope).node.tryFindChild(constructName);
    if (existing) {
        // Just assume this is true
        return existing;
    }
    return new functionType(cdk.Stack.of(scope), constructName, props);
}
/**
 * Central log group type.
 *
 * @internal
 */
var SingletonLogType;
(function (SingletonLogType) {
    SingletonLogType["RUNNER_IMAGE_BUILD"] = "Runner Image Build Helpers Log";
    SingletonLogType["ORCHESTRATOR"] = "Orchestrator Log";
    SingletonLogType["SETUP"] = "Setup Log";
})(SingletonLogType || (exports.SingletonLogType = SingletonLogType = {}));
/**
 * Initialize or return central log group instance.
 *
 * @internal
 */
function singletonLogGroup(scope, type) {
    const existing = cdk.Stack.of(scope).node.tryFindChild(type);
    if (existing) {
        // Just assume this is true
        return existing;
    }
    return new aws_cdk_lib_1.aws_logs.LogGroup(cdk.Stack.of(scope), type, {
        retention: aws_cdk_lib_1.aws_logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
}
/**
 * The absolute minimum permissions required for SSM Session Manager to work. Unlike `AmazonSSMManagedInstanceCore`, it doesn't give permission to read all SSM parameters.
 *
 * @internal
 */
exports.MINIMAL_SSM_SESSION_MANAGER_POLICY_STATEMENT = new aws_cdk_lib_1.aws_iam.PolicyStatement({
    actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
    ],
    resources: ['*'],
});
/**
 * The absolute minimum permissions required for SSM Session Manager on ECS to work. Unlike `AmazonSSMManagedInstanceCore`, it doesn't give permission to read all SSM parameters.
 *
 * @internal
 */
exports.MINIMAL_ECS_SSM_SESSION_MANAGER_POLICY_STATEMENT = new aws_cdk_lib_1.aws_iam.PolicyStatement({
    actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
        's3:GetEncryptionConfiguration',
    ],
    resources: ['*'],
});
/**
 * The absolute minimum permissions required for SSM Session Manager on EC2 to work. Unlike `AmazonSSMManagedInstanceCore`, it doesn't give permission to read all SSM parameters.
 *
 * @internal
 */
exports.MINIMAL_EC2_SSM_SESSION_MANAGER_POLICY_STATEMENT = new aws_cdk_lib_1.aws_iam.PolicyStatement({
    actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
        's3:GetEncryptionConfiguration',
        'ssm:UpdateInstanceInformation',
    ],
    resources: ['*'],
});
/**
 * Discovers certificate files from a given path (file or directory).
 *
 * If the path is a directory, finds all .pem and .crt files in it.
 * If the path is a file, returns it as a single certificate file.
 *
 * @param sourcePath path to a certificate file or directory containing certificate files
 * @returns array of certificate file paths, sorted alphabetically
 * @throws Error if path doesn't exist, is neither file nor directory, or directory has no certificate files
 *
 * @internal
 */
function discoverCertificateFiles(sourcePath) {
    let certificateFiles = [];
    try {
        const stat = fs.statSync(sourcePath);
        if (stat.isDirectory()) {
            // Read directory and find all .pem and .crt files
            const files = fs.readdirSync(sourcePath);
            certificateFiles = files
                .filter(file => file.endsWith('.pem') || file.endsWith('.crt'))
                .map(file => path.join(sourcePath, file))
                .sort(); // Sort for consistent ordering
            if (certificateFiles.length === 0) {
                throw new Error(`No certificate files (.pem or .crt) found in directory: ${sourcePath}`);
            }
        }
        else if (stat.isFile()) {
            // Single file - backwards compatible
            certificateFiles = [sourcePath];
        }
        else {
            throw new Error(`Certificate source path is neither a file nor a directory: ${sourcePath}`);
        }
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Certificate source path does not exist: ${sourcePath}`);
        }
        throw error;
    }
    return certificateFiles;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXRpbHMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvdXRpbHMudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBV0EsMENBWUM7QUFrQkQsOENBV0M7QUE4REQsNERBOEJDO0FBaEpELHlCQUF5QjtBQUN6Qiw2QkFBNkI7QUFDN0IsNkNBQXFGO0FBQ3JGLG1DQUFtQztBQUduQzs7OztHQUlHO0FBQ0gsU0FBZ0IsZUFBZSxDQUM3QixZQUF1RixFQUN2RixLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUE4QjtJQUU1RCxNQUFNLGFBQWEsR0FBRyxHQUFHLEVBQUUsdUNBQXVDLENBQUM7SUFDbkUsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLENBQUMsQ0FBQztJQUN0RSxJQUFJLFFBQVEsRUFBRSxDQUFDO1FBQ2IsMkJBQTJCO1FBQzNCLE9BQU8sUUFBd0IsQ0FBQztJQUNsQyxDQUFDO0lBRUQsT0FBTyxJQUFJLFlBQVksQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsRUFBRSxhQUFhLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDckUsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxJQUFZLGdCQUlYO0FBSkQsV0FBWSxnQkFBZ0I7SUFDMUIseUVBQXFELENBQUE7SUFDckQscURBQWlDLENBQUE7SUFDakMsdUNBQW1CLENBQUE7QUFDckIsQ0FBQyxFQUpXLGdCQUFnQixnQ0FBaEIsZ0JBQWdCLFFBSTNCO0FBRUQ7Ozs7R0FJRztBQUNILFNBQWdCLGlCQUFpQixDQUFDLEtBQWdCLEVBQUUsSUFBc0I7SUFDeEUsTUFBTSxRQUFRLEdBQUcsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsS0FBSyxDQUFDLENBQUMsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM3RCxJQUFJLFFBQVEs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LENBQUM7SUFDZCxDQUFDO0lBRUQsT0FBTyxnQkFBZ0IsQ0FBQztBQUMxQixDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IGF3c19pYW0gYXMgaWFtLCBhd3NfbGFtYmRhIGFzIGxhbWJkYSwgYXdzX2xvZ3MgYXMgbG9ncyB9IGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuLyoqXG4gKiBJbml0aWFsaXplIG9yIHJldHVybiBhIHNpbmdsZXRvbiBMYW1iZGEgZnVuY3Rpb24gaW5zdGFuY2UuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaW5nbGV0b25MYW1iZGE8RnVuY3Rpb25UeXBlIGV4dGVuZHMgbGFtYmRhLkZ1bmN0aW9uPihcbiAgZnVuY3Rpb25UeXBlOiBuZXcgKHM6IENvbnN0cnVjdCwgaTogc3RyaW5nLCBwPzogbGFtYmRhLkZ1bmN0aW9uT3B0aW9ucykgPT4gRnVuY3Rpb25UeXBlLFxuICBzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGxhbWJkYS5GdW5jdGlvbk9wdGlvbnMpOiBGdW5jdGlvblR5cGUge1xuXG4gIGNvbnN0IGNvbnN0cnVjdE5hbWUgPSBgJHtpZH0tZGNjMDM2YzgtODc2Yi00NTFlLWEyYzEtNTUyZjllMDZlOWUxYDtcbiAgY29uc3QgZXhpc3RpbmcgPSBjZGsuU3RhY2sub2Yoc2NvcGUpLm5vZGUudHJ5RmluZENoaWxkKGNvbnN0cnVjdE5hbWUpO1xuICBpZiAoZXhpc3RpbmcpIHtcbiAgICAvLyBKdXN0IGFzc3VtZSB0aGlzIGlzIHRydWVcbiAgICByZXR1cm4gZXhpc3RpbmcgYXMgRnVuY3Rpb25UeXBlO1xuICB9XG5cbiAgcmV0dXJuIG5ldyBmdW5jdGlvblR5cGUoY2RrLlN0YWNrLm9mKHNjb3BlKSwgY29uc3RydWN0TmFtZSwgcHJvcHMpO1xufVxuXG4vKipcbiAqIENlbnRyYWwgbG9nIGdyb3VwIHR5cGUuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBlbnVtIFNpbmdsZXRvbkxvZ1R5cGUge1xuICBSVU5ORVJfSU1BR0VfQlVJTEQgPSAnUnVubmVyIEltYWdlIEJ1aWxkIEhlbHBlcnMgTG9nJyxcbiAgT1JDSEVTVFJBVE9SID0gJ09yY2hlc3RyYXRvciBMb2cnLFxuICBTRVRVUCA9ICdTZXR1cCBMb2cnLFxufVxuXG4vKipcbiAqIEluaXRpYWxpemUgb3IgcmV0dXJuIGNlbnRyYWwgbG9nIGdyb3VwIGluc3RhbmNlLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgZnVuY3Rpb24gc2luZ2xldG9uTG9nR3JvdXAoc2NvcGU6IENvbnN0cnVjdCwgdHlwZTogU2luZ2xldG9uTG9nVHlwZSk6IGxvZ3MuSUxvZ0dyb3VwIHtcbiAgY29uc3QgZXhpc3RpbmcgPSBjZGsuU3RhY2sub2Yoc2NvcGUpLm5vZGUudHJ5RmluZENoaWxkKHR5cGUpO1xuICBpZiAoZXhpc3RpbmcpIHtcbiAgICAvLyBKdXN0IGFzc3VtZSB0aGlzIGlzIHRydWVcbiAgICByZXR1cm4gZXhpc3RpbmcgYXMgbG9ncy5JTG9nR3JvdXA7XG4gIH1cblxuICByZXR1cm4gbmV3IGxvZ3MuTG9nR3JvdXAoY2RrLlN0YWNrLm9mKHNjb3BlKSwgdHlwZSwge1xuICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9NT05USCxcbiAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICB9KTtcbn1cblxuLyoqXG4gKiBUaGUgYWJzb2x1dGUgbWluaW11bSBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgU1NNIFNlc3Npb24gTWFuYWdlciB0byB3b3JrLiBVbmxpa2UgYEFtYXpvblNTTU1hbmFnZWRJbnN0YW5jZUNvcmVgLCBpdCBkb2Vzbid0IGdpdmUgcGVybWlzc2lvbiB0byByZWFkIGFsbCBTU00gcGFyYW1ldGVycy5cbiAqXG4gKiBAaW50ZXJuYWxcbiAqL1xuZXhwb3J0IGNvbnN0IE1JTklNQUxfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICBhY3Rpb25zOiBbXG4gICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZUNvbnRyb2xDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6Q3JlYXRlRGF0YUNoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpPcGVuQ29udHJvbENoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpPcGVuRGF0YUNoYW5uZWwnLFxuICBdLFxuICByZXNvdXJjZXM6IFsnKiddLFxufSk7XG5cbi8qKlxuICogVGhlIGFic29sdXRlIG1pbmltdW0gcGVybWlzc2lvbnMgcmVxdWlyZWQgZm9yIFNTTSBTZXNzaW9uIE1hbmFnZXIgb24gRUNTIHRvIHdvcmsuIFVubGlrZSBgQW1hem9uU1NNTWFuYWdlZEluc3RhbmNlQ29yZWAsIGl0IGRvZXNuJ3QgZ2l2ZSBwZXJtaXNzaW9uIHRvIHJlYWQgYWxsIFNTTSBwYXJhbWV0ZXJzLlxuICpcbiAqIEBpbnRlcm5hbFxuICovXG5leHBvcnQgY29uc3QgTUlOSU1BTF9FQ1NfU1NNX1NFU1NJT05fTUFOQUdFUl9QT0xJQ1lfU1RBVEVNRU5UID0gbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICBhY3Rpb25zOiBbXG4gICAgJ3NzbW1lc3NhZ2VzOkNyZWF0ZUNvbnRyb2xDaGFubmVsJyxcbiAgICAnc3NtbWVzc2FnZXM6Q3JlYXRlRGF0YUNoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpPcGVuQ29udHJvbENoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpPcGVuRGF0YUNoYW5uZWwnLFxuICAgICdzMzpHZXRFbmNyeXB0aW9uQ29uZmlndXJhdGlvbicsXG4gIF0sXG4gIHJlc291cmNlczogWycqJ10sXG59KTtcblxuLyoqXG4gKiBUaGUgYWJzb2x1dGUgbWluaW11bSBwZXJtaXNzaW9ucyByZXF1aXJlZCBmb3IgU1NNIFNlc3Npb24gTWFuYWdlciBvbiBFQzIgdG8gd29yay4gVW5saWtlIGBBbWF6b25TU01NYW5hZ2VkSW5zdGFuY2VDb3JlYCwgaXQgZG9lc24ndCBnaXZlIHBlcm1pc3Npb24gdG8gcmVhZCBhbGwgU1NNIHBhcmFtZXRlcnMuXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBjb25zdCBNSU5JTUFMX0VDMl9TU01fU0VTU0lPTl9NQU5BR0VSX1BPTElDWV9TVEFURU1FTlQgPSBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gIGFjdGlvbnM6IFtcbiAgICAnc3NtbWVzc2FnZXM6Q3JlYXRlQ29udHJvbENoYW5uZWwnLFxuICAgICdzc21tZXNzYWdlczpDcmVhdGVEYXRhQ2hhbm5lbCcsXG4gICAgJ3NzbW1lc3NhZ2VzOk9wZW5Db250cm9sQ2hhbm5lbCcsXG4gICAgJ3NzbW1lc3NhZ2VzOk9wZW5EYXRhQ2hhbm5lbCcsXG4gICAgJ3MzOkdldEVuY3J5cHRpb25Db25maWd1cmF0aW9uJyxcbiAgICAnc3NtOlVwZGF0ZUluc3RhbmNlSW5mb3JtYXRpb24nLFxuICBdLFxuICByZXNvdXJjZXM6IFsnKiddLFxufSk7XG5cbi8qKlxuICogRGlzY292ZXJzIGNlcnRpZmljYXRlIGZpbGVzIGZyb20gYSBnaXZlbiBwYXRoIChmaWxlIG9yIGRpcmVjdG9yeSkuXG4gKlxuICogSWYgdGhlIHBhdGggaXMgYSBkaXJlY3RvcnksIGZpbmRzIGFsbCAucGVtIGFuZCAuY3J0IGZpbGVzIGluIGl0LlxuICogSWYgdGhlIHBhdGggaXMgYSBmaWxlLCByZXR1cm5zIGl0IGFzIGEgc2luZ2xlIGNlcnRpZmljYXRlIGZpbGUuXG4gKlxuICogQHBhcmFtIHNvdXJjZVBhdGggcGF0aCB0byBhIGNlcnRpZmljYXRlIGZpbGUgb3IgZGlyZWN0b3J5IGNvbnRhaW5pbmcgY2VydGlmaWNhdGUgZmlsZXNcbiAqIEByZXR1cm5zIGFycmF5IG9mIGNlcnRpZmljYXRlIGZpbGUgcGF0aHMsIHNvcnRlZCBhbHBoYWJldGljYWxseVxuICogQHRocm93cyBFcnJvciBpZiBwYXRoIGRvZXNuJ3QgZXhpc3QsIGlzIG5laXRoZXIgZmlsZSBub3IgZGlyZWN0b3J5LCBvciBkaXJlY3RvcnkgaGFzIG5vIGNlcnRpZmljYXRlIGZpbGVzXG4gKlxuICogQGludGVybmFsXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkaXNjb3ZlckNlcnRpZmljYXRlRmlsZXMoc291cmNlUGF0aDogc3RyaW5nKTogc3RyaW5nW10ge1xuICBsZXQgY2VydGlmaWNhdGVGaWxlczogc3RyaW5nW10gPSBbXTtcblxuICB0cnkge1xuICAgIGNvbnN0IHN0YXQgPSBmcy5zdGF0U3luYyhzb3VyY2VQYXRoKTtcbiAgICBpZiAoc3RhdC5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAvLyBSZWFkIGRpcmVjdG9yeSBhbmQgZmluZCBhbGwgLnBlbSBhbmQgLmNydCBmaWxlc1xuICAgICAgY29uc3QgZmlsZXMgPSBmcy5yZWFkZGlyU3luYyhzb3VyY2VQYXRoKTtcbiAgICAgIGNlcnRpZmljYXRlRmlsZXMgPSBmaWxlc1xuICAgICAgICAuZmlsdGVyKGZpbGUgPT4gZmlsZS5lbmRzV2l0aCgnLnBlbScpIHx8IGZpbGUuZW5kc1dpdGgoJy5jcnQnKSlcbiAgICAgICAgLm1hcChmaWxlID0+IHBhdGguam9pbihzb3VyY2VQYXRoLCBmaWxlKSlcbiAgICAgICAgLnNvcnQoKTsgLy8gU29ydCBmb3IgY29uc2lzdGVudCBvcmRlcmluZ1xuXG4gICAgICBpZiAoY2VydGlmaWNhdGVGaWxlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBjZXJ0aWZpY2F0ZSBmaWxlcyAoLnBlbSBvciAuY3J0KSBmb3VuZCBpbiBkaXJlY3Rvcnk6ICR7c291cmNlUGF0aH1gKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHN0YXQuaXNGaWxlKCkpIHtcbiAgICAgIC8vIFNpbmdsZSBmaWxlIC0gYmFja3dhcmRzIGNvbXBhdGlibGVcbiAgICAgIGNlcnRpZmljYXRlRmlsZXMgPSBbc291cmNlUGF0aF07XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2VydGlmaWNhdGUgc291cmNlIHBhdGggaXMgbmVpdGhlciBhIGZpbGUgbm9yIGEgZGlyZWN0b3J5OiAke3NvdXJjZVBhdGh9YCk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmICgoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSAnRU5PRU5UJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDZXJ0aWZpY2F0ZSBzb3VyY2UgcGF0aCBkb2VzIG5vdCBleGlzdDogJHtzb3VyY2VQYXRofWApO1xuICAgIH1cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIHJldHVybiBjZXJ0aWZpY2F0ZUZpbGVzO1xufVxuIl19